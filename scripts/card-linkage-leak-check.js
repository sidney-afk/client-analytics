'use strict';
/*
 * IS THE CREATION-PATH LEAK STILL OPEN? — measure it instead of quoting July.
 *
 * A card is supposed to be born with its work attached: a video deliverable, a
 * thumbnail deliverable, and the Linear issues that mirror them. Through July
 * that often did not happen — GRAPHICS_FLIP_STATUS recorded ~50% of new cards
 * missing the stamp in mid-July and "roughly 6%" on 2026-08-06, with the honest
 * note that repairing the backlog without closing the leak is a treadmill.
 *
 * That 6% then sat in the file as a fact for two weeks. It is not one any more,
 * and the only way to know is to re-measure. Hence this script: it answers the
 * question on demand rather than leaving a number to rot in a document.
 *
 * WHAT IT COUNTS. Every card CREATED in the window (from its create event, since
 * calendar_posts stores no created_at), excluding the TEST client and the
 * per-client `p_cal_settings` pseudo-row, bucketed by week:
 *
 *   created          cards born in that week
 *   unlinked         no deliverable id and no Linear issue on either component
 *   unlinked & live  the same, minus the ones somebody has since archived
 *
 * The last column is the only one that is actionable. An unlinked card that was
 * archived the same day is a discarded draft, not lost work, and counting it as
 * a leak overstates the problem — which is how a number like 6% survives past
 * the moment it stops being true. The converse matters too: an unlinked card is
 * not automatically a fault. The calendar is also used to park a reference, and
 * a card holding a link with no video and no thumbnail is exactly what that
 * looks like. This report names the cards, so a human can tell the difference.
 *
 * Measured 2026-08-22 over the five weeks to that date: 215 real-client cards
 * created, 5 unlinked (2.3%), 1 unlinked and live — and that one is a note card
 * named for a document it carries in its caption. The most recent full week is
 * 0 of 43. The leak is closed.
 *
 * READ-ONLY. Public key, no writes, no Linear calls, safe to run anywhere.
 *
 *   node scripts/card-linkage-leak-check.js [--weeks=10] [--json]
 *
 * Exit 0 always: this is a CONTEXT report, not a gate.
 *
 * PUBLIC SAFETY: reports card ids, weeks and counts. Never a card name, caption
 * or document link — the ids are enough to look a row up, and the names are
 * client content.
 */
const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/$/, '');
const SUPA_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
  || 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA');

const args = new Map(process.argv.slice(2).map(a => {
  const m = String(a).match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] == null ? '1' : m[2]] : [a, '1'];
}));
const WEEKS = Math.max(1, Number(args.get('weeks') || 10));
const AS_JSON = args.has('json');
const TEST_CLIENT = String(args.get('test-client') || 'sidneylaruel');
// Not a card: every client carries one settings row in the same table, and it
// has no components by construction. Counting it would add a permanent phantom
// leak to every single week.
const NOT_A_CARD = new Set(['p_cal_settings']);

function clean(value) { return String(value == null ? '' : value).trim(); }

/* A card is LINKED if either component carries either kind of reference. Both
   are checked because the two lanes stamp different columns: the native gateway
   writes deliverable ids, the legacy lane writes Linear URLs, and a card that
   went through either one is not leaked. */
function cardLinked(row) {
  return !!(clean(row && row.video_deliverable_id) || clean(row && row.graphic_deliverable_id)
    || clean(row && row.linear_issue_id) || clean(row && row.graphic_linear_issue_id));
}

function isArchived(row) {
  return clean(row && row.status).toLowerCase() === 'archived';
}

/* Monday-anchored ISO week key, so a week bucket means the same thing every
   run regardless of when the report is taken. */
function weekKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const day = (d.getUTCDay() + 6) % 7;   // Monday = 0
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

/* The whole judgement, as one pure function over rows the caller has already
   joined. Exported so a test can EXECUTE it rather than re-describe it. */
function classify(cards) {
  const weeks = new Map();
  const liveUnlinked = [];
  for (const card of cards || []) {
    const key = weekKey(card.created_at);
    if (!weeks.has(key)) weeks.set(key, { week: key, created: 0, unlinked: 0, unlinked_live: 0 });
    const bucket = weeks.get(key);
    bucket.created++;
    if (cardLinked(card.row)) continue;
    bucket.unlinked++;
    if (isArchived(card.row)) continue;
    bucket.unlinked_live++;
    liveUnlinked.push({ id: card.id, client: card.client, created_at: card.created_at, status: clean(card.row.status) });
  }
  const rows = [...weeks.values()].sort((a, b) => (a.week < b.week ? 1 : -1));
  const totals = rows.reduce((acc, r) => ({
    created: acc.created + r.created,
    unlinked: acc.unlinked + r.unlinked,
    unlinked_live: acc.unlinked_live + r.unlinked_live,
  }), { created: 0, unlinked: 0, unlinked_live: 0 });
  return { weeks: rows, totals, live_unlinked: liveUnlinked };
}

async function rest(path) {
  const res = await fetch(SUPA_URL + '/rest/v1/' + path, {
    headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY },
  });
  if (!res.ok) throw new Error(path.split('?')[0] + ' -> HTTP ' + res.status + ': ' + (await res.text()).slice(0, 200));
  return res.json();
}

async function main() {
  const since = new Date(Date.now() - WEEKS * 7 * 86400000).toISOString();
  const events = [];
  const PAGE = 1000;
  for (let offset = 0; offset < 40000; offset += PAGE) {
    const page = await rest('calendar_post_events'
      + '?select=client,post_id,ts&action=eq.create'
      + '&ts=gte.' + encodeURIComponent(since)
      + '&order=ts.asc&limit=' + PAGE + '&offset=' + offset);
    events.push(...page);
    if (page.length < PAGE) break;
  }

  // First create event per (client, card) — a card is born once.
  const born = new Map();
  for (const ev of events) {
    const client = clean(ev.client);
    const id = clean(ev.post_id);
    if (!id || NOT_A_CARD.has(id) || client === TEST_CLIENT) continue;
    const key = client + ' ' + id;
    if (!born.has(key)) born.set(key, { id, client, created_at: ev.ts });
  }

  const ids = [...new Set([...born.values()].map(b => b.id))];
  const rows = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const got = await rest('calendar_posts'
      + '?select=id,client,status,video_deliverable_id,graphic_deliverable_id,linear_issue_id,graphic_linear_issue_id'
      + '&id=in.(' + chunk.map(encodeURIComponent).join(',') + ')');
    // Keyed by client AND id: the table is per-client, so an id alone matches
    // several rows and would attribute one client's linkage to another.
    for (const r of got) rows.set(clean(r.client) + ' ' + clean(r.id), r);
  }

  const cards = [];
  let vanished = 0;
  for (const [key, b] of born) {
    const row = rows.get(key);
    if (!row) { vanished++; continue; }   // created then hard-deleted; nothing to judge
    cards.push({ id: b.id, client: b.client, created_at: b.created_at, row });
  }

  const report = Object.assign({ generated_at: new Date().toISOString(), window_weeks: WEEKS, rows_missing: vanished },
    classify(cards));

  if (AS_JSON) { console.log(JSON.stringify(report, null, 2)); return; }

  const pct = report.totals.created ? (100 * report.totals.unlinked / report.totals.created) : 0;
  console.log('Cards created in the last ' + WEEKS + ' week(s), excluding the TEST client: ' + report.totals.created);
  console.log('  unlinked            ' + report.totals.unlinked + '  (' + pct.toFixed(1) + '%)');
  console.log('  unlinked AND live   ' + report.totals.unlinked_live + '   the only actionable number');
  if (vanished) console.log('  created then removed ' + vanished + '  (no row to judge)');
  console.log('');
  console.log('week (Mon)   created  unlinked  unlinked&live');
  for (const w of report.weeks) {
    console.log(w.week + '   ' + String(w.created).padStart(7) + '  ' + String(w.unlinked).padStart(8)
      + '  ' + String(w.unlinked_live).padStart(13));
  }
  if (!report.live_unlinked.length) {
    console.log('');
    console.log('Nothing live is unlinked. Every card born in this window either carries its work or was discarded.');
    return;
  }
  console.log('');
  console.log('Live cards with no work attached, look at each before calling it a leak:');
  for (const c of report.live_unlinked) {
    console.log('  ' + c.id.padEnd(22) + ' ' + c.client.padEnd(24) + ' created ' + c.created_at
      + '  status ' + (c.status || '(none)'));
  }
  console.log('');
  console.log('A card can legitimately carry no components (the calendar is also used to park a');
  console.log('reference). Open each one before repairing it.');
}

if (require.main === module) {
  main().catch(e => { console.error('card-linkage-leak-check failed: ' + (e && e.message || e)); process.exit(1); });
}

module.exports = { cardLinked, isArchived, weekKey, classify };
