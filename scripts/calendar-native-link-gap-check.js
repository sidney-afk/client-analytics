'use strict';
/*
 * WHICH CALENDAR CARDS CANNOT HAVE THEIR STATUS CHANGED — and who made them.
 *
 * The shipped calendar refuses a status write with `native_link_required` at
 * `_writeUiGatewayPost`'s `makePayload`:
 *
 *     if (!intent.legacyOnly && !legacyParity && !intent.nativeId)
 *         throw _writeUiGatewayError(409, 'native_link_required');
 *
 * and `legacyParity` is true whenever that component's team is still
 * Linear-authoritative. So the refusal needs three things at once: the team is
 * SyncView-authoritative, the card carries a Linear link for that component,
 * and the card carries NO deliverable id for it. A card with neither a link nor
 * an id never reaches the throw — `_calPushStatusToLinear` classifies it as
 * targetless first — so "unlinked" is a DIFFERENT defect, measured by
 * `scripts/card-linkage-leak-check.js`. This one is the half-linked card: it
 * looks connected, it shows a Linear issue, and it fails on use.
 *
 * WHY IT KEEPS HAPPENING. `link_set` — an SMM pasting a Linear URL into a card's
 * link slot, and the bulk "match cards to sub-issues" flow — writes the link
 * column and nothing else. Before the 2026-08-16 graphics flip that was
 * complete: authority was Linear, `legacyParity` was true, and the URL WAS the
 * write target. After it, the same paste manufactures a card whose thumbnail
 * status can never be changed from the calendar, and the person who pasted it
 * is usually the person who later gets blocked.
 *
 * WHAT IT COUNTS, per card and component:
 *
 *   blocked      link present, deliverable id absent, team SyncView-authoritative
 *   archived     the card is archived — real, but nobody will ever hit it
 *   settled      card and component are both at a terminal posted state
 *   actionable   everything else: someone can still open this and be refused
 *   post-flip    actionable AND the link was set after the team flipped, which
 *                is the only bucket that proves the leak is still open
 *
 * READ-ONLY. Publishable key, no writes, no Linear calls, safe to run anywhere.
 *
 *   node scripts/calendar-native-link-gap-check.js [--json] [--since=ISO] [--gate]
 *
 * Exit 0 by default: this is a CONTEXT report like its sibling. `--gate` makes
 * it exit 1 when any post-flip actionable gap exists, for wiring into a check
 * once the creation path is fixed and the count is meant to stay at zero.
 *
 * PUBLIC SAFETY: the text report prints card ids, Linear identifiers, actor
 * names and counts — never a client slug, card name or caption. `--json` adds
 * the client for local triage, because resolving one means opening that
 * client's calendar. Keep the JSON off any log that leaves the machine.
 */
const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/$/, '');
const SUPA_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
  || 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA');

const args = new Map(process.argv.slice(2).map(a => {
  const m = String(a).match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] == null ? '1' : m[2]] : [a, '1'];
}));
const AS_JSON = args.has('json');
const GATE = args.has('gate');
const TEST_CLIENT = String(args.get('test-client') || 'sidneylaruel');
// The graphics authority flip. A link set before it was a complete, correct
// link at the time; only what came after proves the creation path is still open.
const FLIP_AT = String(args.get('since') || '2026-08-16T19:58:55Z');

/* The two component slots, named exactly as the shipped `_writeUiNativeId` and
   `_writeUiTeam` name them, so a rename there fails this rather than drifting. */
const SLOTS = [
  { component: 'video', team: 'video', linkColumn: 'linear_issue_id', deliverableColumn: 'video_deliverable_id', statusColumn: 'video_status' },
  { component: 'graphic', team: 'graphics', linkColumn: 'graphic_linear_issue_id', deliverableColumn: 'graphic_deliverable_id', statusColumn: 'graphic_status' },
];

const TERMINAL = new Set(['posted', 'archived']);

function clean(value) { return String(value == null ? '' : value).trim(); }
function lower(value) { return clean(value).toLowerCase(); }

function identifierFrom(url) {
  const m = clean(url).match(/\b([A-Z]{2,5}-\d+)\b/i);
  return m ? m[1].toUpperCase() : '';
}

/* Mirrors `_writeUiGatewayPost`: a Linear-authoritative team takes the legacy
   parity lane, where the URL itself is the write target and no deliverable id
   is required. Only a SyncView-authoritative team can produce this refusal. */
function slotBlocked(card, slot, authority) {
  if (lower(authority && authority[slot.team]) !== 'syncview') return false;
  if (!clean(card && card[slot.linkColumn])) return false;      // targetless, a different classification
  return !clean(card && card[slot.deliverableColumn]);
}

function bucketFor(card, slot) {
  if (lower(card.status) === 'archived') return 'archived';
  if (TERMINAL.has(lower(card.status)) && TERMINAL.has(lower(card[slot.statusColumn]))) return 'settled';
  return 'actionable';
}

/* The whole judgement as one pure function over rows the caller has joined, so
   a test can EXECUTE it instead of re-describing it. `linkSetAt` maps
   `cardId|component` to the ISO time that link was last set, from
   calendar_post_events; a card with no event is treated as pre-flip, which is
   the conservative direction — it cannot inflate the post-flip count. */
function classify(cards, authority, linkSetAt, flipAt) {
  const totals = { blocked: 0, archived: 0, settled: 0, actionable: 0, post_flip: 0 };
  const byComponent = {};
  const actionable = [];
  const postFlip = [];
  for (const card of cards || []) {
    if (lower(card.client) === lower(TEST_CLIENT)) continue;
    for (const slot of SLOTS) {
      if (!slotBlocked(card, slot, authority)) continue;
      totals.blocked++;
      byComponent[slot.component] = (byComponent[slot.component] || 0) + 1;
      const bucket = bucketFor(card, slot);
      totals[bucket]++;
      if (bucket !== 'actionable') continue;
      const setAt = clean((linkSetAt || {})[clean(card.id) + '|' + slot.component]);
      const entry = {
        id: clean(card.id),
        client: clean(card.client),
        component: slot.component,
        identifier: identifierFrom(card[slot.linkColumn]),
        card_status: clean(card.status),
        component_status: clean(card[slot.statusColumn]),
        link_set_at: setAt || null,
        link_set_by: clean((linkSetAt || {})[clean(card.id) + '|' + slot.component + '|actor']) || null,
      };
      actionable.push(entry);
      if (setAt && setAt >= flipAt) { totals.post_flip++; postFlip.push(entry); }
    }
  }
  const order = (a, b) => clean(b.link_set_at).localeCompare(clean(a.link_set_at));
  return { totals, by_component: byComponent, actionable: actionable.sort(order), post_flip: postFlip.sort(order) };
}

async function rest(path) {
  const res = await fetch(SUPA_URL + '/rest/v1/' + path, {
    headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY },
  });
  if (!res.ok) throw new Error(path.split('?')[0] + ' -> HTTP ' + res.status + ': ' + (await res.text()).slice(0, 200));
  return res.json();
}

async function pageAll(table, select, extra = '', size = 500) {
  const out = [];
  for (let offset = 0; offset < 100000; offset += size) {
    const page = await rest(table + '?select=' + select + extra + '&order=id.asc&limit=' + size + '&offset=' + offset);
    out.push(...page);
    if (page.length < size) break;
  }
  return out;
}

async function main() {
  const flags = await rest('syncview_runtime_flags?select=key,value&key=eq.prod_authority');
  const authority = (flags[0] && flags[0].value) || {};
  if (!clean(authority.video) || !clean(authority.graphics)) {
    throw new Error('prod_authority did not read back both teams; refusing to guess an authority world');
  }

  const cards = await pageAll('calendar_posts',
    'id,client,status,video_status,graphic_status,linear_issue_id,video_deliverable_id,graphic_linear_issue_id,graphic_deliverable_id');

  // Last link_set per card+component. Ascending so the last write wins.
  const linkSetAt = {};
  const PAGE = 1000;
  for (let offset = 0; offset < 100000; offset += PAGE) {
    const page = await rest('calendar_post_events'
      + '?select=post_id,component,ts,actor&action=eq.link_set'
      + '&order=ts.asc&limit=' + PAGE + '&offset=' + offset);
    for (const ev of page) {
      const key = clean(ev.post_id) + '|' + clean(ev.component);
      if (!clean(ev.post_id) || !clean(ev.component)) continue;
      linkSetAt[key] = clean(ev.ts);
      linkSetAt[key + '|actor'] = clean(ev.actor);
    }
    if (page.length < PAGE) break;
  }

  const report = Object.assign(
    { generated_at: new Date().toISOString(), authority, flip_at: FLIP_AT, cards_scanned: cards.length },
    classify(cards, authority, linkSetAt, FLIP_AT));

  if (AS_JSON) { console.log(JSON.stringify(report, null, 2)); }
  else {
    const t = report.totals;
    console.log('Authority: video=' + authority.video + ', graphics=' + authority.graphics
      + '  (a Linear-authoritative team cannot produce this refusal at all)');
    console.log('Cards scanned, excluding the TEST client: ' + report.cards_scanned);
    console.log('');
    console.log('Component slots that would throw native_link_required: ' + t.blocked
      + '  ' + JSON.stringify(report.by_component));
    console.log('  on an archived card      ' + t.archived + '   real, but nobody will hit it');
    console.log('  card and component done  ' + t.settled + '   both at a terminal posted state');
    console.log('  ACTIONABLE               ' + t.actionable + '   someone can still open this and be refused');
    console.log('  ...set after the flip    ' + t.post_flip + '   the only number that proves the leak is still open');
    if (report.actionable.length) {
      console.log('');
      console.log('Actionable slots, newest link first:');
      for (const r of report.actionable.slice(0, 40)) {
        console.log('  ' + r.id.padEnd(40) + ' ' + r.component.padEnd(8) + ' ' + (r.identifier || '(no identifier)').padEnd(12)
          + ' card ' + (r.card_status || '(none)').padEnd(18) + ' component ' + (r.component_status || '(none)').padEnd(18)
          + ' link set ' + (r.link_set_at ? r.link_set_at.slice(0, 19) + ' by ' + (r.link_set_by || '?') : 'before events were kept'));
      }
      if (report.actionable.length > 40) console.log('  ... and ' + (report.actionable.length - 40) + ' more (use --json)');
    }
    console.log('');
    if (!t.post_flip) {
      console.log('No slot was half-linked after the flip. The creation path is not adding new ones.');
    } else {
      console.log('Each post-flip slot is a card someone linked by hand after the authority moved.');
      console.log('Binding the link to a deliverable at link time is what closes this; repairing');
      console.log('the backlog without that is a treadmill.');
    }
  }

  if (GATE && report.totals.post_flip > 0) process.exit(1);
}

if (require.main === module) {
  main().catch(e => { console.error('calendar-native-link-gap-check failed: ' + (e && e.message || e)); process.exit(1); });
}

module.exports = { slotBlocked, bucketFor, classify, identifierFrom, SLOTS };
