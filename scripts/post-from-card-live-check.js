'use strict';
/*
 * The D6 live check for "From a card" (plan row P1, OPEN_REPAIRS 651), run by hand from
 * .github/workflows/post-from-card-live-check.yml. One run, one side:
 *   1. copy one card's video (and, on Instagram, its thumbnail) through post-source, exactly as the Post tab does;
 *   2. create the post through the side's own function, SCHEDULED at least 8 days ahead (never "now");
 *      on TikTok also Private and sent to drafts, so even a post that somehow survived would not be public;
 *   3. cancel it at once, through the same cancel the Post tab's queue uses;
 *   4. read it back and require "cancelled".
 * It never publishes (D6). If the cancel or the read-back fails it exits 3 and says, in capitals, that a scheduled
 * post may still exist and must be cancelled by hand in the Post tab's queue: that is the stop-and-tell case.
 *
 * Prints only safe facts: the step reached, statuses, the rendition and size, and the queue row id (needed to cancel
 * by hand). Never a client name, account id, caption, address or key: the repository and its CI logs are public.
 *
 * Env (all from the workflow): SYNCVIEW_STAFF_KEY (a staff role key, secret), POST_LIVE_CHECK_CLIENT (the client's
 * display name, secret, so it never appears in a log), POST_LIVE_CHECK_CARD (a card id of that client),
 * POST_LIVE_CHECK_SIDE (instagram or tiktok).
 */
const fs = require('fs');
const path = require('path');

const SUPA = 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/';
const DAY = 24 * 60 * 60 * 1000;
const AHEAD_MS = 8 * DAY;          // D6: 7 days or more ahead; 8 leaves a day of margin
const MIN_AHEAD_MS = 7 * DAY;
const CAPTION = 'SyncView live check. Scheduled and cancelled at once; never published.';
const ACCOUNT_RE = /^spc_[A-Za-z0-9]{6,80}$/;
const COLUMNS = { instagram: 'postforme_instagram_account_id', tiktok: 'postforme_account_id' };

// The client's Post for Me account for the side, from the same Clients Info copy the Post tab reads first.
function accountFromCsv(csv, client, side) {
  const rows = parseCsv(String(csv || ''));
  if (!rows.length) return '';
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const nameAt = head.indexOf('client_name');
  const colAt = head.indexOf(COLUMNS[side]);
  if (nameAt < 0 || colAt < 0) return '';
  const want = String(client || '').trim().toLowerCase();
  const hit = rows.slice(1).find((r) => String(r[nameAt] || '').trim().toLowerCase() === want);
  const id = hit ? String(hit[colAt] || '').trim() : '';
  return ACCOUNT_RE.test(id) ? id : '';
}
function parseCsv(text) {
  const out = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); out.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}

/* The whole run with every outside thing passed in (test/post-from-card-live-check.js drives it against fakes).
   deps: { call(fnName, body) -> { status, json }, readClientsCsv() -> text, now() -> ms, log(line) }. */
async function runCheck(input, deps) {
  const side = input.side === 'tiktok' ? 'tiktok' : 'instagram';
  const report = { side, step: 'start' };
  const done = (code, extra) => { Object.assign(report, extra || {}); deps.log('post-from-card live check: ' + JSON.stringify(report)); return code; };
  if (!input.client || !input.card) return done(2, { step: 'input', error: 'client and card are required' });

  report.step = 'account';
  const account = accountFromCsv(await deps.readClientsCsv(), input.client, side);
  if (!account) return done(2, { error: 'no ' + side + ' account on file for this client' });

  report.step = 'copy';
  const copy = await deps.call('post-source', { client: input.client, post_id: input.card, side });
  const c = copy.json || {};
  if (copy.status !== 200 || !c.ok || !c.media_url) return done(1, { http_status: copy.status, error: String(c.error || 'copy_failed') });
  Object.assign(report, { rendition: c.rendition, bytes: c.bytes, thumb_copied: !!c.thumb_url });

  const at = new Date(deps.now() + AHEAD_MS).toISOString();
  if (Date.parse(at) - deps.now() < MIN_AHEAD_MS) return done(2, { error: 'refused: not 7 days ahead' });
  const key = 'livecheck' + deps.now().toString(36) + Math.random().toString(36).slice(2, 8);

  report.step = 'create';
  const create = side === 'instagram'
    ? await deps.call('instagram-upload', { action: 'create', clientName: input.client, socialAccountId: account, title: CAPTION,
        mediaUrl: c.media_url, coverUrl: c.thumb_url || '', options: { cover_timestamp_ms: 0 }, scheduledAtUTC: at, timezone: 'UTC', idempotencyKey: key })
    : await deps.call('tiktok-upload', { action: 'create', clientName: input.client, socialAccountId: account, title: CAPTION,
        options: { privacy_level: 'SELF_ONLY', post_mode: 'MEDIA_UPLOAD', disable_comment: true, disable_duet: true, disable_stitch: true },
        scheduledAt: '', scheduledAtUTC: at, timezone: 'UTC', idempotencyKey: key, mediaUrl: c.media_url });
  const row = (create.json && create.json.row) || null;
  const rowId = row && row.id ? String(row.id) : (side === 'tiktok' ? key : '');
  report.row_id = rowId;
  report.created_status = row ? row.status : null;
  if (!create.json || !create.json.ok) {
    // A refusal (4xx) made nothing. Anything else may have made a post: try to cancel it all the same.
    if (create.status >= 400 && create.status < 500) return done(1, { http_status: create.status, error: String(create.json && create.json.error || 'create refused') });
  }

  report.step = 'cancel';
  const cancel = side === 'instagram'
    ? await deps.call('instagram-upload', { action: 'cancel', id: rowId })
    : await deps.call('tiktok-upload-cancel', { id: rowId });
  const cj = cancel.json || {};
  const cancelled = !!cj.ok && (side === 'instagram' || cj.code === 'cancelled' || cj.code === 'already_cancelled');
  report.cancel_status = cancel.status;
  if (!cancelled) {
    return done(3, { alarm: 'CANCEL FAILED: A SCHEDULED POST MAY STILL EXIST (for ' + at.slice(0, 10) + '). Cancel row ' + rowId + ' by hand in the Post tab queue NOW and tell the supervisor.', error: String(cj.error || cj.code || 'cancel_failed') });
  }

  report.step = 'read_back';
  const back = await deps.call(side === 'instagram' ? 'instagram-upload' : 'tiktok-upload', { action: 'status', id: rowId });
  const status = back.json && back.json.row ? String(back.json.row.status || '') : '';
  report.read_back_status = status;
  if (status !== 'cancelled') {
    return done(3, { alarm: 'READ-BACK DID NOT SAY CANCELLED: check row ' + rowId + ' in the Post tab queue NOW and tell the supervisor.' });
  }
  return done(0, { step: 'done', ok: true });
}

async function main() {
  const key = String(process.env.SYNCVIEW_STAFF_KEY || '').trim();
  const input = {
    client: String(process.env.POST_LIVE_CHECK_CLIENT || '').trim(),
    card: String(process.env.POST_LIVE_CHECK_CARD || '').trim(),
    side: String(process.env.POST_LIVE_CHECK_SIDE || 'instagram').trim(),
  };
  if (!key) { console.error('Set SYNCVIEW_STAFF_KEY.'); process.exit(2); }
  const sheet = fs.readFileSync(path.join(__dirname, '..', 'src', 'index', '040-shared-briefs.js.part'), 'utf8').match(/const SHEET_ID\s*=\s*'([^']+)'/);
  const deps = {
    call: async (fn, body) => {
      const r = await fetch(SUPA + fn, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Syncview-Key': key }, body: JSON.stringify(body), signal: AbortSignal.timeout(170000) })
        .catch(() => null);
      if (!r) return { status: 0, json: null };
      return { status: r.status, json: await r.json().catch(() => null) };
    },
    readClientsCsv: async () => {
      if (!sheet) return '';
      const r = await fetch('https://docs.google.com/spreadsheets/d/' + sheet[1] + '/gviz/tq?tqx=out:csv&sheet=Clients%20Info').catch(() => null);
      return r && r.ok ? r.text() : '';
    },
    now: Date.now,
    log: (line) => console.log(line),
  };
  process.exit(await runCheck(input, deps));
}

if (require.main === module) main().catch((e) => { console.error('post-from-card live check failed:', e && e.name); process.exit(1); });
module.exports = { runCheck, accountFromCsv, AHEAD_MS, MIN_AHEAD_MS };
