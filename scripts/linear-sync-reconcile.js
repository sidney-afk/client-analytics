'use strict';
/*
 * SyncView ⇄ Linear status reconciler — the convergence backbone.
 *
 *   node scripts/linear-sync-reconcile.js            # DRY-RUN: report only, no writes
 *   node scripts/linear-sync-reconcile.js --apply    # apply corrections + persist ledger
 *   APPLY=true CAP=15 node scripts/linear-sync-reconcile.js   # env form (used by CI)
 *
 * WHY THIS EXISTS
 *   The real-time webhook syncs (Linear→card and card→Linear) are best-effort and
 *   occasionally drop an event, leaving one side silently stale. Events are the
 *   fast path; THIS job is the guarantee. It runs on a timer, compares every
 *   linked card-component against its Linear issue, and converges them.
 *
 * THE RULE — most-recent-action-wins (NOT "Linear always wins")
 *   Status genuinely changes on BOTH sides: editors/designers drive the review
 *   lifecycle in Linear; the SMM/client drive approvals, scheduling and posting in
 *   SyncView. A persistent ledger records, per card-component, the status last
 *   seen on each side and WHEN it changed. The CARD side uses the EXACT change time
 *   (calendar_posts.video_status_at / graphic_status_at, DB-stamped — see
 *   migrations/calendar-status-at-migration.sql) when present, else falls back to polling
 *   granularity; Linear is polling-timed (fine at the 10-min n8n cadence). When the
 *   two disagree the side whose value changed more recently wins. Near-concurrent
 *   changes tie-break to: a Tweaks-Needed request never loses, else the
 *   more-advanced lifecycle state wins.
 *
 * SAFETY
 *   - Writes go ONLY through the existing safe endpoints (calendar-upsert-post,
 *     linear-set-status). Nothing here touches index.html or the DB schema.
 *   - linear-set-status silently SKIPS a state a team doesn't have, so an
 *     unrepresentable status (e.g. a calendar-only state) is never forced.
 *   - Archived cards are skipped; unmapped Linear states (Canceled/Triage/…) are
 *     never propagated.
 *   - SAFETY_CAP: if a single run wants more corrections than the cap it ABORTS
 *     without writing — a mass divergence means a dropped-bulk-event or a bug, and
 *     a human should look before hundreds of rows move.
 *   - Mapping + overall-status logic is EXTRACTED from index.html at runtime, so
 *     it stays in lock-step with the shipping app.
 */
const fs = require('fs');
const path = require('path');
const { authorityForTeam, loadAuthority } = require('./prod-authority-guard');

const APPLY = process.argv.includes('--apply') || /^(1|true|yes)$/i.test(process.env.APPLY || '');
const LEDGER_PATH = process.env.LEDGER_PATH || path.join(__dirname, '..', '.sync-ledger', 'linear-reconcile.json');
const AUTHORITY_CACHE_PATH = process.env.PROD_AUTHORITY_CACHE_PATH
  || path.join(path.dirname(LEDGER_PATH), 'linear-reconcile-authority.json');
const SAFETY_CAP = Number(process.env.CAP || 15);
const TIE_MS = 120 * 1000;
const SYNCVIEW_STAFF_KEY = String(process.env.SYNCVIEW_STAFF_KEY || '').trim();

const SUPA_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co/rest/v1/calendar_posts';
const SUPA_KEY = 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA';   // publishable/anon key — already public in index.html
const LINEAR_STATUSES_URL = 'https://synchrosocial.app.n8n.cloud/webhook/linear-issue-statuses';
const UPSERT_N8N_URL = 'https://synchrosocial.app.n8n.cloud/webhook/calendar-upsert-post';
const UPSERT_URL = UPSERT_N8N_URL; // legacy fallback alias; do not fetch directly
const UPSERT_EF_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/calendar-upsert';
const UPSERT_FLAG_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co/rest/v1/syncview_runtime_flags?select=value&key=eq.calendar_upsert_ef_clients&limit=1';
const SET_STATUS_URL = 'https://synchrosocial.app.n8n.cloud/webhook/linear-set-status';
let UPSERT_EF_CLIENTS = new Set();

// ---- canonical logic, extracted verbatim from index.html (stays in lock-step) ----
const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const grabFunc = (name) => {
  const at = SRC.indexOf('function ' + name + '('); if (at < 0) throw new Error('fn ' + name);
  let depth = 0; for (let j = SRC.indexOf('{', at); j < SRC.length; j++) {
    if (SRC[j] === '{') depth++; else if (SRC[j] === '}' && --depth === 0) return SRC.slice(at, j + 1);
  } throw new Error('braces ' + name);
};
const grabConst = (name) => SRC.match(new RegExp('^\\s*const ' + name + '\\s*=.*;\\s*$', 'm'))[0];
const mod = new Function([
  grabConst('CAL_STATUSES'), grabConst('CAL_PRIORITY'), grabConst('CAL_COMPONENTS'),
  grabFunc('_calNormStatus'), grabFunc('computeOverallStatus'),
  grabFunc('_calClearStaleApprovals'), grabFunc('_calMapLinearStatusStrict'), grabFunc('_calIdentFromUrl'),
].join('\n') + `;return { CAL_PRIORITY, _calNormStatus, computeOverallStatus, _calClearStaleApprovals, _calMapLinearStatusStrict, _calIdentFromUrl };`)();
const { CAL_PRIORITY, _calNormStatus, computeOverallStatus, _calClearStaleApprovals, _calMapLinearStatusStrict, _calIdentFromUrl } = mod;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const NOW = () => new Date().toISOString();

async function fetchAllCards() {
  const base = ['id','name','client','status','video_status','graphic_status','caption_status',
    'linear_issue_id','graphic_linear_issue_id','order_index','updated_at',
    'client_video_approved_at','client_graphic_approved_at','client_caption_approved_at','kasper_approved_at'];
  // Exact per-component change-timestamps (migrations/calendar-status-at-migration.sql). OPTIONAL:
  // if those columns aren't there yet, PostgREST errors the select, so we drop them and
  // fall back to the base set + poll-timing — making this safe to ship in either order.
  const ext = base.concat(['video_status_at', 'graphic_status_at']);
  let cols = ext, fellBack = false;
  const out = []; let offset = 0; const page = 1000;
  for (;;) {
    const rows = await fetch(`${SUPA_URL}?select=${cols.join(',')}&order=client.asc&limit=${page}&offset=${offset}`,
      { headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY } }).then(r => r.json());
    if (!Array.isArray(rows)) {
      if (cols === ext && !fellBack) { cols = base; fellBack = true; offset = 0; out.length = 0; continue; }
      throw new Error('supabase: ' + JSON.stringify(rows).slice(0, 200));
    }
    out.push(...rows); if (rows.length < page) break; offset += page;
  }
  return out;
}
async function postStatuses(slice) {
  let last;
  for (let a = 0; a < 3; a++) {
    try { const j = await fetch(LINEAR_STATUSES_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ issues: slice }) }).then(r => r.json());
      if (j && j.ok && j.statuses) return j.statuses; last = j; } catch (e) { last = { error: e.message }; }
    await sleep(500 * (a + 1));
  }
  throw new Error('linear-issue-statuses failed: ' + JSON.stringify(last).slice(0, 120));
}
// Resolve every link to its Linear state. The shared `linear-issue-statuses` webhook
// packs a batch into ONE aliased GraphQL query, and Linear nulls the ENTIRE response if
// any single id doesn't exist (a deleted issue / stale link). The webhook can't tell that
// apart from "no statuses" and returns {ok:true, statuses:{}} — so a single dead link
// would silently blind every card in its batch (the 2026-06-24 thumbnail-drift incident).
// Guard: any identifier a batch failed to return is retried INDIVIDUALLY, so a dead link
// can only ever drop itself, never its batch-mates. (Caller passes LIVE links only — see
// the main block — so in practice this fallback rarely fires.)
async function resolveLinear(urls) {
  // Only links with a resolvable ABC-123 ident may enter a batch: a UUID-form
  // link yields a garbage ident inside the webhook, which poisons the whole
  // aliased batch and triggers its slow per-id fallback (F139).
  const all = [...new Set(urls.filter(Boolean))];
  const uniq = all.filter(u => _calIdentFromUrl(u));
  if (uniq.length !== all.length) log(`  resolveLinear: ${all.length - uniq.length} link(s) skipped — no ABC-123 ident in the URL (UUID-form or malformed Linear link, F139)`);
  const statuses = {}; const C = 50;
  for (let i = 0; i < uniq.length; i += C) {
    const slice = uniq.slice(i, i + C);
    Object.assign(statuses, await postStatuses(slice));
    await sleep(100);
  }
  // Heal poisoned batches: re-resolve any requested id still missing, one link at a time.
  const missing = uniq.filter(u => { const id = _calIdentFromUrl(u); return id && statuses[id] === undefined; });
  let healed = 0;
  for (const u of missing) {
    try { const s = await postStatuses([u]); const before = Object.keys(statuses).length; Object.assign(statuses, s); if (Object.keys(statuses).length > before) healed++; } catch {}
    await sleep(30);
  }
  if (missing.length) log(`  resolveLinear: ${missing.length} link(s) dropped by batch, ${healed} healed individually, ${missing.length - healed} genuinely unresolvable (deleted issue / stale link)`);
  return statuses;
}

// Most-recent-wins, with a tie-break for near-concurrent changes.
function decide(led, cardCal, linCal) {
  const dt = Date.parse(led.cardAt) - Date.parse(led.linAt);
  if (Math.abs(dt) <= TIE_MS) {
    if (cardCal === 'Tweaks Needed') return 'card';      // never silently drop a tweak request
    if (linCal === 'Tweaks Needed') return 'linear';
    return (CAL_PRIORITY[cardCal] ?? -1) >= (CAL_PRIORITY[linCal] ?? -1) ? 'card' : 'linear';
  }
  return dt > 0 ? 'card' : 'linear';
}

async function pushCardToLinear(url, cal) {
  return fetch(SET_STATUS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ issue: url, status: cal }) }).then(r => r.json());
}
function routeSlug(s) {
  return String(s || '').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^dr\.?\s+/, '').replace(/\s+(?:and|&)\s+/g, '&').replace(/[^a-z0-9&]+/g, '');
}
async function loadUpsertEfClients() {
  try {
    const rows = await fetch(UPSERT_FLAG_URL, { headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY, Accept: 'application/json' } }).then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
    const value = Array.isArray(rows) && rows[0] ? rows[0].value : null;
    const raw = Array.isArray(value) ? value : (value && Array.isArray(value.clients) ? value.clients : []);
    UPSERT_EF_CLIENTS = new Set(raw.map(routeSlug).filter(Boolean));
  } catch (e) {
    UPSERT_EF_CLIENTS = new Set();
    log(`calendar-upsert EF flag read failed; using n8n fallback (${e.message})`);
  }
  log(`calendar-upsert EF clients: ${[...UPSERT_EF_CLIENTS].join(',') || '(none)'}`);
}
function upsertUrlForClient(client) {
  return UPSERT_EF_CLIENTS.has(routeSlug(client)) ? UPSERT_EF_URL : UPSERT_N8N_URL;
}
/* F50: the outbound-mirror mode decides whether a SyncView-authoritative team
 * may be reconciled at all.
 *
 * Post-flip (prod_authority.graphics = "syncview") the designer's status
 * change lands in `deliverables`, the outbound mirror carries it to Linear
 * within minutes (F2 stays "live" after the flip; the runbook never reverts
 * it), and THIS job projects it onto the card by pulling Linear→card — the
 * same proven pull it has always performed, F50 closed with machinery that
 * already runs every 15 minutes.
 *
 * That chain is only sound while the mirror is actually delivering. If F2 is
 * killed (the §F2 emergency stop) Linear goes stale, and pulling stale Linear
 * onto cards would REVERT work the authoritative side has advanced — the
 * wrong-direction failure this file exists to prevent. So: mode "live" is the
 * licence to pull for a syncview team; anything else (off/shadow/unreadable)
 * freezes that team back to detect-only. Fail-closed, like every flag read
 * here. */
const OUTBOUND_FLAG_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co/rest/v1/syncview_runtime_flags?select=value&key=eq.linear_outbound_enabled&limit=1';
async function loadOutboundMode() {
  // Same retry discipline as every other transient read in this loop:
  // loadAuthority gets 3 attempts + backoff, postStatuses gets 3. A single
  // un-retried blip here would freeze an APPLY run (exit 1, nothing applied,
  // ledger unsaved) on a lane the pre-flip health check requires green.
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const rows = await fetch(OUTBOUND_FLAG_URL, { headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY, Accept: 'application/json' } }).then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
      const value = Array.isArray(rows) && rows[0] ? rows[0].value : null;
      const mode = String((value && value.mode) || '').toLowerCase();
      return ['off', 'shadow', 'live'].includes(mode) ? mode : 'off';
    } catch (e) {
      last = e;
      await sleep(400 * (attempt + 1));
    }
  }
  log(`linear_outbound_enabled unreadable after 3 attempts; treating as off (${last && last.message})`);
  return 'off';
}
function upsertHeaders(url) {
  const headers = { 'Content-Type': 'application/json', 'X-Syncview-Source': 'reconcile' };
  if (url === UPSERT_EF_URL) {
    if (!SYNCVIEW_STAFF_KEY) throw new Error('SYNCVIEW_STAFF_KEY is required for calendar-upsert EF writes');
    headers['X-Syncview-Key'] = SYNCVIEW_STAFF_KEY;
  }
  return headers;
}
async function pullLinearToCard(card, comp, linCal) {
  const clone = JSON.parse(JSON.stringify(card)); const pending = {};
  clone[comp + '_status'] = linCal; pending[comp + '_status'] = linCal;
  _calClearStaleApprovals(clone, pending);
  const overall = computeOverallStatus(clone);
  const patch = { id: card.id, [comp + '_status']: linCal };
  for (const k of Object.keys(pending)) if (/_approved_at$/.test(k)) patch[k] = pending[k];
  if (_calNormStatus(card.status || '') !== overall) patch.status = overall;
  const url = upsertUrlForClient(card.client);
  const res = await fetch(url, { method: 'POST', headers: upsertHeaders(url), body: JSON.stringify({ client: card.client, post: patch }) }).then(r => r.json());
  return { res, patch };
}

// Collapse rows that share a linear_issue_id to the ONE the calendar actually
// displays — mirror of index.html `_calDedupeByLinearIssue`: most-recent
// updated_at wins (order_index tiebreak). Writing only this canonical row is
// essential: touching a stale duplicate bumps its updated_at and flips which
// row the calendar shows. Caller passes non-archived rows only.
function dedupeByLinearIssue(cards) {
  const score = (p) => { const t = Date.parse((p && p.updated_at) || ''); return isFinite(t) ? t : 0; };
  const best = new Map();
  for (const p of cards) {
    const link = (p.linear_issue_id || '').trim();
    if (!link) continue;
    const prev = best.get(link);
    if (!prev || score(p) > score(prev) || (score(p) === score(prev) && Number(p.order_index || 0) > Number(prev.order_index || 0))) best.set(link, p);
  }
  const winners = new Set(best.values());
  return cards.filter(p => { const link = (p.linear_issue_id || '').trim(); return !link || winners.has(p); });
}

function loadLedger() {
  try { return JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8')); } catch { return {}; }
}
function saveLedger(ledger) {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));
}
const lines = [];
const log = (s) => { console.log(s); lines.push(s); };

(async () => {
  log(`MODE: ${APPLY ? 'APPLY' : 'DRY-RUN'}  cap=${SAFETY_CAP}  ledger=${LEDGER_PATH}`);
  await loadUpsertEfClients();
  const authorityState = await loadAuthority({ cachePath: AUTHORITY_CACHE_PATH });
  const prodAuthority = authorityState.authority;
  const outboundMode = await loadOutboundMode();
  log(`prod_authority: video=${prodAuthority.video} graphics=${prodAuthority.graphics} source=${authorityState.source} · outbound=${outboundMode}`);
  if (authorityState.warning) log(`prod_authority live read warning: ${authorityState.warning}`);
  const ledger = loadLedger();
  const fresh = !Object.keys(ledger).length;
  const cards = await fetchAllCards();
  const live = cards.filter(c => String(c.status || '').toLowerCase() !== 'archived');
  const archived = cards.length - live.length;
  const canonical = dedupeByLinearIssue(live);   // only ever act on the row the calendar shows

  // Resolve Linear ONLY for the live cards we actually reconcile. Resolving archived
  // cards' links was pure waste AND the source of batch poisoning: ~289 dead links live
  // on archived cards (deleted issues + synthetic QA links), and one dead link nulls its
  // whole 50-link batch (see resolveLinear + THUMBNAIL_DESYNC_INCIDENT_2026-06-24.md),
  // dropping the healthy live cards batched alongside it.
  const urls = [];
  for (const p of canonical) { if (p.linear_issue_id) urls.push(p.linear_issue_id); if (p.graphic_linear_issue_id) urls.push(p.graphic_linear_issue_id); }
  const statuses = await resolveLinear(urls);
  log(`${cards.length} cards · ${live.length} live · ${new Set(urls).size} live linked issues · ${Object.keys(statuses).length} Linear states · ledger ${fresh ? 'FRESH' : Object.keys(ledger).length + ' keys'}`);
  const corrections = []; const naParked = []; let inSync = 0, unmapped = 0, missing = 0; const t = NOW();
  for (const card of canonical) {
    for (const comp of ['video', 'graphic']) {
      const url = comp === 'video' ? card.linear_issue_id : card.graphic_linear_issue_id;
      const ident = _calIdentFromUrl(url); if (!ident) continue;
      const linRaw = statuses[ident];
      if (linRaw === undefined) { missing++; continue; }
      const linCal = _calMapLinearStatusStrict(linRaw);
      if (!linCal) { unmapped++; continue; }
      const cardCal = _calNormStatus(card[comp + '_status'] || '');
      // EXACT card change-time from the DB trigger (migrations/calendar-status-at-migration.sql)
      // when present, else fall back to poll-time `t`. This is what stops a stale card
      // from looking "newer" than a Linear issue that advanced between polls — the
      // GRA-6339 wrong-direction regression. Linear stays poll-timed (fine at 10-min).
      const stampRaw = card[comp + '_status_at'];
      const cardAtExact = (stampRaw && isFinite(Date.parse(stampRaw))) ? new Date(stampRaw).toISOString() : null;
      const key = `${card.client}|${card.id}|${comp}`;
      const authority = authorityForTeam(prodAuthority, comp);
      /* F50 authority modes, per component:
       *   linear                       -> bidirectional, exactly as always.
       *   syncview + outbound "live"   -> PULL-ONLY. Linear→card repairs run
       *     (that is the flip's status projection); card→Linear pushes are
       *     suppressed, because the native gateway + outbound mirror own that
       *     direction now — pushing here through the legacy set-status webhook
       *     would make this job a second, unaudited Linear writer racing the
       *     outbox.
       *   syncview + outbound off/shadow -> detect-only, as before the flip.
       *     Linear may be stale in that state, and pulling stale Linear onto a
       *     card would revert authoritative work.
       *   write_safe false             -> detect-only, everything, as always.
       */
      const pullOnly = authorityState.write_safe === true && authority === 'syncview' && outboundMode === 'live';
      const gated = authorityState.write_safe !== true || (authority === 'syncview' && !pullOnly);
      let led = ledger[key] ? { ...ledger[key] } : null;
      /* D-26 recovery guard: clocks recorded while this key was PULL-ONLY must
       * not decide a bidirectional run. After an F2 kill, owner adjudication
       * (classify/replay/discard every pending intent) and authority back to
       * linear, an inherited stale linAt would make the card win and PUSH a
       * discarded status through the legacy webhook — regressing the
       * adjudicated Linear issue outside F27's accounting. A linear-authority
       * run therefore treats pull-era entries as absent and re-reads real
       * state, which is exactly the invariant the pre-F50 code kept by never
       * persisting syncview keys at all. */
      if (led && !pullOnly && led.mode === 'pull-only') led = null;
      if (!led) led = { cardCal, cardAt: cardAtExact || t, linCal, linAt: t };
      else {
        if (cardAtExact) { led.cardCal = cardCal; led.cardAt = cardAtExact; }
        else if (cardCal !== led.cardCal) { led.cardCal = cardCal; led.cardAt = t; }
        if (linCal !== led.linCal) { led.linCal = linCal; led.linAt = t; }
      }
      // A gated (detect-only) key does not persist its observed clocks: a later
      // D-26 pause back to Linear must re-read and reconcile the real state
      // instead of inheriting a synthetic poll time. A pull-only key DOES
      // persist, mode-tagged so a bidirectional run can recognise and discard
      // its pull-era clocks (see the D-26 guard above).
      led.mode = pullOnly ? 'pull-only' : 'bidirectional';
      if (cardCal === linCal) {
        // Converged — the mirror delivered (or the sides agree for any other
        // reason), so a standing mirror-owned latch has done its job.
        if (led.mirrorOwned) delete led.mirrorOwned;
        if (!gated) ledger[key] = led;
        inSync++; continue;
      }
      if (String(cardCal).trim().toUpperCase() === 'N/A') {
        /* N/A PARKS the pair (owner ruling 2026-08-19). N/A is a manual,
         * SyncView-only SMM choice: Linear has no such state, so pushing it
         * through the legacy webhook can only fail (the browser's own push
         * guard refuses the same write), and pulling Linear's old status onto
         * the card would silently undo the SMM's deliberate parking minutes
         * after they chose it. Neither direction moves while the card reads
         * N/A; the pair logs visibly every run and resumes normal
         * reconciliation the moment someone changes it off N/A in SyncView.
         * On 2026-08-19, 21 freshly parked components did exactly this fight,
         * blew the safety cap, and aborted every run for an hour -- during
         * which NOTHING reconciled, including legitimate corrections. */
        if (!gated) ledger[key] = led;
        naParked.push({ card, comp, ident, cardCal, linCal });
        continue;
      }
      let winner = decide(led, cardCal, linCal);
      if (pullOnly) {
        /* Mirror-owned LATCH. A card-side win in pull-only mode is suppressed
         * (the mirror owns card→Linear) — but suppression alone self-destructs:
         * one later Linear-side move flips most-recent-wins to linear and the
         * suppressed card edit (an SMM's "Tweaks Needed", a client approval)
         * would be silently overwritten by the pull, log line gone. With
         * card→Linear structurally severed, most-recent-wins degenerates to
         * "Linear always wins, delayed" — the charter's named forbidden
         * failure. So the suppression LATCHES in the ledger: while a card-side
         * win is waiting for the mirror (or a human), Linear-side wins on that
         * key are also held, visibly, every run. The latch clears only on
         * convergence above. */
        if (winner === 'card') {
          if (!led.mirrorOwned) led.mirrorOwned = NOW();
        } else if (led.mirrorOwned) {
          winner = 'card';
        }
      } else if (led.mirrorOwned) {
        // Bidirectional again (D-26 fresh-treatment normally clears these, but
        // belt-and-braces): the latch has no meaning when pushes are allowed.
        delete led.mirrorOwned;
      }
      if (!gated) ledger[key] = led;
      corrections.push({ card, comp, ident, url, cardCal, linCal, winner, led, authority, gated, pullOnly });
    }
  }

  const toLinear = corrections.filter(c => c.winner === 'card');
  const toCard = corrections.filter(c => c.winner === 'linear');
  const gated = corrections.filter(c => c.gated);
  // A pull-only component whose CARD side won is the mirror's job, not ours:
  // the card edit reached `deliverables` through the gateway leg and the
  // outbound mirror carries it to Linear. Suppressed here, visibly — if Linear
  // never catches up (an unenrolled client's card edit that has no gateway
  // leg), this line keeps reappearing every run, which is the signal a human
  // needs, instead of a silent legacy-webhook write racing the outbox.
  const mirrorOwned = corrections.filter(c => !c.gated && c.pullOnly && c.winner === 'card');
  const actionable = corrections.filter(c => !c.gated && !(c.pullOnly && c.winner === 'card'));
  log(`IN SYNC ${inSync} · archived ${archived} · unmapped ${unmapped} · missing ${missing} · corrections ${corrections.length} · authority-gated ${gated.length} · mirror-owned ${mirrorOwned.length} · n/a-parked ${naParked.length}`);
  toLinear.forEach(c => log(`  → Linear ${c.ident} := "${c.cardCal}"  (was "${c.linCal}")  ${c.card.client}/${c.card.id}`));
  toCard.forEach(c => log(`  ← card ${c.card.id} ${c.comp} := "${c.linCal}"  (was "${c.cardCal}")  ${c.card.client}`));
  gated.forEach(c => log(`  ⛔ detect-only ${c.ident} ${c.comp}: prod_authority=${c.authority} source=${authorityState.source}`));
  mirrorOwned.forEach(c => log(`  ⏭ mirror-owned ${c.ident} ${c.comp}: card→Linear suppressed (syncview authority; outbound mirror carries it)`));
  naParked.forEach(c => log(`  ⏸ n/a-parked ${c.ident} ${c.comp}: card is N/A (SyncView-only status; Linear untouched)`));

  if (actionable.length > SAFETY_CAP) {
    log(`\n⛔ ABORT: ${actionable.length} actionable corrections > cap ${SAFETY_CAP}. Refusing to write — investigate (mass event or bug). Override with CAP=${actionable.length + 1}.`);
    writeSummary(`⛔ ABORT — ${actionable.length} actionable corrections exceeded cap ${SAFETY_CAP}; nothing written. ${gated.length} SyncView-authoritative differences remained detect-only.`);
    process.exit(2);
  }

  if (!APPLY) { log('\n(dry-run — no writes)'); writeSummary(`Dry-run: ${corrections.length} corrections (${toLinear.length}→Linear, ${toCard.length}→card), ${gated.length} authority-gated, ${mirrorOwned.length} mirror-owned, ${naParked.length} N/A-parked. In sync: ${inSync}.`); return; }

  let ok = 0, fail = 0, authorityFrozen = false;
  for (const c of actionable) {
    let freshAuthority = null;
    try {
      freshAuthority = await loadAuthority({ cachePath: AUTHORITY_CACHE_PATH });
    } catch (e) {
      authorityFrozen = true;
      fail++;
      log(`  authority freeze ${c.comp}: live prod_authority unavailable`);
      break;
    }
    /* Each correction re-proves, against a LIVE flag read, the exact world it
     * was classified under. A bidirectional item still requires the team to be
     * Linear-authoritative; a pull-only item still requires syncview authority
     * AND a live outbound mirror. Any mismatch means the world moved mid-run
     * (a flip, a rollback, an emergency F2 kill) — freeze everything rather
     * than apply corrections classified under a world that no longer exists. */
    const liveTeamAuthority = authorityForTeam(freshAuthority.authority, c.comp);
    const stillValid = freshAuthority.write_safe === true && (c.pullOnly
      ? (liveTeamAuthority === 'syncview' && (await loadOutboundMode()) === 'live')
      : liveTeamAuthority === 'linear');
    if (!stillValid) {
      authorityFrozen = true;
      fail++;
      log(`  authority freeze ${c.comp}: live state no longer matches ${c.pullOnly ? 'pull-only (syncview + outbound live)' : 'Linear-authoritative'} classification`);
      break;
    }
    try {
      if (c.winner === 'card') {
        const r = await pushCardToLinear(c.url, c.cardCal);
        if (r && r.ok !== false && !r.skipped) { c.led.linCal = c.cardCal; c.led.linAt = NOW(); ok++; }
        else if (r && r.skipped) log(`  ⏭ ${c.ident} skip (${r.reason || 'state not on team'})`);
        else { fail++; log(`  ❌ ${c.ident} ${JSON.stringify(r).slice(0, 120)}`); }
      } else {
        const { res } = await pullLinearToCard(c.card, c.comp, c.linCal);
        if (res && (res.ok === true || res.post)) { c.led.cardCal = c.linCal; c.led.cardAt = NOW(); ok++; }
        else { fail++; log(`  ❌ ${c.card.id} ${JSON.stringify(res).slice(0, 120)}`); }
      }
    } catch (e) { fail++; log(`  ❌ ${c.ident} ${e.message}`); }
    if (fail) break;
    await sleep(150);
  }
  if (authorityFrozen) {
    log('\nauthority changed or became unavailable during APPLY; ledger not saved');
    writeSummary(`Authority freeze after **${ok}** corrections; ledger clocks were not advanced. Re-run after a live Linear-authoritative read.`);
    process.exit(1);
  }
  saveLedger(ledger);
  log(`\napplied ok=${ok} fail=${fail} · authority-gated=${gated.length} · ledger saved (${Object.keys(ledger).length} keys)`);
  writeSummary(`Applied **${ok}** corrections, ${fail} failed, kept **${gated.length}** authority-gated differences detect-only and left **${mirrorOwned.length}** card-side changes to the outbound mirror; **${naParked.length}** N/A-parked pairs untouched. In sync: ${inSync}.`);
  if (fail) process.exit(1);
})().catch(e => { console.error('FATAL', e); writeSummary('FATAL: ' + e.message); process.exit(1); });

function writeSummary(md) {
  if (process.env.GITHUB_STEP_SUMMARY) { try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Linear ⇄ SyncView reconcile\n${md}\n\n<details><summary>log</summary>\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n</details>\n`); } catch {} }
}
