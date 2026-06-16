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
 *   seen on each side and WHEN it changed (to polling granularity). When the two
 *   disagree the side whose value changed more recently wins. Near-concurrent
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

const APPLY = process.argv.includes('--apply') || /^(1|true|yes)$/i.test(process.env.APPLY || '');
const LEDGER_PATH = process.env.LEDGER_PATH || path.join(__dirname, '..', '.sync-ledger', 'linear-reconcile.json');
const SAFETY_CAP = Number(process.env.CAP || 15);
const TIE_MS = 120 * 1000;

const SUPA_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co/rest/v1/calendar_posts';
const SUPA_KEY = 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA';   // publishable/anon key — already public in index.html
const LINEAR_STATUSES_URL = 'https://synchrosocial.app.n8n.cloud/webhook/linear-issue-statuses';
const UPSERT_URL = 'https://synchrosocial.app.n8n.cloud/webhook/calendar-upsert-post';
const SET_STATUS_URL = 'https://synchrosocial.app.n8n.cloud/webhook/linear-set-status';

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
  const cols = ['id','name','client','status','video_status','graphic_status','caption_status',
    'linear_issue_id','graphic_linear_issue_id','order_index','updated_at',
    'client_video_approved_at','client_graphic_approved_at','client_caption_approved_at','kasper_approved_at'];
  const out = []; let offset = 0; const page = 1000;
  for (;;) {
    const rows = await fetch(`${SUPA_URL}?select=${cols.join(',')}&order=client.asc&limit=${page}&offset=${offset}`,
      { headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY } }).then(r => r.json());
    if (!Array.isArray(rows)) throw new Error('supabase: ' + JSON.stringify(rows).slice(0, 200));
    out.push(...rows); if (rows.length < page) break; offset += page;
  }
  return out;
}
async function resolveLinear(urls) {
  const uniq = [...new Set(urls.filter(Boolean))]; const statuses = {}; const C = 50;
  for (let i = 0; i < uniq.length; i += C) {
    const slice = uniq.slice(i, i + C); let ok = false;
    for (let a = 0; a < 3 && !ok; a++) {
      try { const j = await fetch(LINEAR_STATUSES_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ issues: slice }) }).then(r => r.json());
        if (j && j.ok && j.statuses) { Object.assign(statuses, j.statuses); ok = true; } } catch {}
      if (!ok) await sleep(500 * (a + 1));
    }
    if (!ok) throw new Error('linear-issue-statuses failed @' + i); await sleep(100);
  }
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
async function pullLinearToCard(card, comp, linCal) {
  const clone = JSON.parse(JSON.stringify(card)); const pending = {};
  clone[comp + '_status'] = linCal; pending[comp + '_status'] = linCal;
  _calClearStaleApprovals(clone, pending);
  const overall = computeOverallStatus(clone);
  const patch = { id: card.id, [comp + '_status']: linCal };
  for (const k of Object.keys(pending)) if (/_approved_at$/.test(k)) patch[k] = pending[k];
  if (_calNormStatus(card.status || '') !== overall) patch.status = overall;
  const res = await fetch(UPSERT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client: card.client, post: patch }) }).then(r => r.json());
  return { res, patch };
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
  const ledger = loadLedger();
  const fresh = !Object.keys(ledger).length;
  const cards = await fetchAllCards();
  const urls = [];
  for (const p of cards) { if (p.linear_issue_id) urls.push(p.linear_issue_id); if (p.graphic_linear_issue_id) urls.push(p.graphic_linear_issue_id); }
  const statuses = await resolveLinear(urls);
  log(`${cards.length} cards · ${new Set(urls).size} linked issues · ${Object.keys(statuses).length} Linear states · ledger ${fresh ? 'FRESH' : Object.keys(ledger).length + ' keys'}`);

  const corrections = []; let inSync = 0, archived = 0, unmapped = 0, missing = 0; const t = NOW();
  for (const card of cards) {
    if (String(card.status || '').toLowerCase() === 'archived') { archived++; continue; }
    for (const comp of ['video', 'graphic']) {
      const url = comp === 'video' ? card.linear_issue_id : card.graphic_linear_issue_id;
      const ident = _calIdentFromUrl(url); if (!ident) continue;
      const linRaw = statuses[ident];
      if (linRaw === undefined) { missing++; continue; }
      const linCal = _calMapLinearStatusStrict(linRaw);
      if (!linCal) { unmapped++; continue; }
      const cardCal = _calNormStatus(card[comp + '_status'] || '');
      const key = `${card.client}|${card.id}|${comp}`;
      let led = ledger[key];
      if (!led) led = ledger[key] = { cardCal, cardAt: t, linCal, linAt: t };
      else { if (cardCal !== led.cardCal) { led.cardCal = cardCal; led.cardAt = t; } if (linCal !== led.linCal) { led.linCal = linCal; led.linAt = t; } }
      if (cardCal === linCal) { inSync++; continue; }
      corrections.push({ card, comp, ident, url, cardCal, linCal, winner: decide(led, cardCal, linCal), led });
    }
  }

  const toLinear = corrections.filter(c => c.winner === 'card');
  const toCard = corrections.filter(c => c.winner === 'linear');
  log(`IN SYNC ${inSync} · archived ${archived} · unmapped ${unmapped} · missing ${missing} · corrections ${corrections.length}`);
  toLinear.forEach(c => log(`  → Linear ${c.ident} := "${c.cardCal}"  (was "${c.linCal}")  ${c.card.client}/${c.card.id}`));
  toCard.forEach(c => log(`  ← card ${c.card.id} ${c.comp} := "${c.linCal}"  (was "${c.cardCal}")  ${c.card.client}`));

  if (corrections.length > SAFETY_CAP) {
    log(`\n⛔ ABORT: ${corrections.length} corrections > cap ${SAFETY_CAP}. Refusing to write — investigate (mass event or bug). Override with CAP=${corrections.length + 1}.`);
    writeSummary(`⛔ ABORT — ${corrections.length} corrections exceeded cap ${SAFETY_CAP}; nothing written.`);
    process.exit(2);
  }

  if (!APPLY) { log('\n(dry-run — no writes)'); writeSummary(`Dry-run: ${corrections.length} corrections (${toLinear.length}→Linear, ${toCard.length}→card). In sync: ${inSync}.`); return; }

  let ok = 0, fail = 0;
  for (const c of corrections) {
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
    await sleep(150);
  }
  saveLedger(ledger);
  log(`\napplied ok=${ok} fail=${fail} · ledger saved (${Object.keys(ledger).length} keys)`);
  writeSummary(`Applied **${ok}** corrections (${toLinear.length}→Linear, ${toCard.length}→card), ${fail} failed. In sync: ${inSync}.`);
  if (fail) process.exit(1);
})().catch(e => { console.error('FATAL', e); writeSummary('FATAL: ' + e.message); process.exit(1); });

function writeSummary(md) {
  if (process.env.GITHUB_STEP_SUMMARY) { try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Linear ⇄ SyncView reconcile\n${md}\n\n<details><summary>log</summary>\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n</details>\n`); } catch {} }
}
