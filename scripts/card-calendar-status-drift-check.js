'use strict';
/*
 * DOES THE CALENDAR STILL AGREE WITH THE CARD?
 *
 * Every linked calendar slot is compared against the deliverable it points at,
 * through the SAME mapping the native bridge trigger applies, and any slot the
 * trigger WOULD have projected but which does not hold the projected value is
 * reported as drift.
 *
 * ------------------------------------------------------------------
 * WHY THIS IS NOT ALREADY COVERED.
 *
 * `scripts/linear-sync-reconcile.js` has compared these two surfaces on a
 * 15-minute tick for months, and it is still correct — but it compares them
 * THROUGH LINEAR. It resolves the card's Linear link, reads the state Linear
 * holds, and decides direction from that. Native receipts send nothing to
 * Linear, so since the ordinary-receipts flip the middle of that chain has been
 * empty: the reconciler reads a state that never moved, its provenance test
 * (correctly) refuses to write a stale value over live work, and it reports
 * nothing wrong. A card whose calendar copy is hours behind its deliverable is
 * invisible to it, because from Linear's point of view nothing happened.
 *
 * That is exactly the hole `migrations/2026-09-18-native-calendar-status-bridge.sql`
 * closes going forward. This check is the measurement that the bridge is in
 * fact holding — the reconciler cannot be that measurement, for the reason
 * above, and a trigger nobody measures is a trigger nobody will notice has
 * stopped.
 *
 * ------------------------------------------------------------------
 * THE MAPPING IS NOT COPIED HERE.
 *
 * `_calMapNativeStatusStrict` is extracted verbatim out of `index.html` at
 * load, the same way `scripts/linear-sync-reconcile.js` and
 * `scripts/sample-linear-reconcile.js` take it. A private re-implementation
 * would be a third copy of the table, and the failure it would produce — this
 * report calling a correct card drifted, or missing a real one — is precisely
 * the failure it exists to catch. `test/native-calendar-status-bridge.js`
 * already pins the SQL `production_native_calendar_status_map` to that same JS
 * function, so extracting the JS transitively binds this to the SQL the trigger
 * actually runs.
 *
 * ------------------------------------------------------------------
 * WHAT COUNTS AS DRIFT, AND WHAT DELIBERATELY DOES NOT.
 *
 * A slot is only drift if the trigger would have written it. Every exclusion
 * below is one the trigger itself makes, mirrored so this cannot report a card
 * the bridge was never going to touch:
 *
 *   out_of_scope    the deliverable's origin is not 'calendar'. Samples-origin
 *                   rows link to sample_reviews and manual rows link to no card
 *                   at all; the trigger returns before mapping anything.
 *   link_asymmetric the card points at the deliverable but the deliverable does
 *                   not point back at that card and client. The trigger's
 *                   lookup joins on card_id AND client_slug, so it finds no row
 *                   and projects nothing. This is a REAL defect — the bridge is
 *                   silently inert for that slot — but it is a linkage defect,
 *                   not a stale value, and mixing the two hides both.
 *   archived        the card is archived. Out of scope in the trigger, in the
 *                   backfill and in the reconciler alike.
 *   unmapped        the status has no calendar equivalent (triage, canceled,
 *                   duplicate, unrecognised, and scheduled/posted on a
 *                   samples-origin row). The trigger maps these to null and
 *                   leaves the card exactly as it was, so the card holding
 *                   something else is CORRECT, not drifted.
 *   shadowed        the same deliverable id sits in both slots of one card. The
 *                   trigger's `case when video_deliverable_id = new.id` resolves
 *                   that to 'video' and never projects the graphic slot.
 *   unresolved      the card names a deliverable id that did not read back.
 *   agree           the slot already holds the mapped value.
 *   DRIFT           everything else: the trigger would have written this slot
 *                   and it does not hold the projected value.
 *
 * The comparison is an exact string comparison, because the trigger's guard is
 * `p.video_status is distinct from v_target` on the raw column. A case-folded
 * comparison here would call a card clean that the trigger would still rewrite.
 *
 * ------------------------------------------------------------------
 * READ-ONLY. There is no apply path in this file and no write of any kind —
 * not a repair, not an event row, not a heartbeat. It is a report. Repairing a
 * drifted card means re-running the backfill
 * (`public.production_native_calendar_status_backfill`), which is the routine
 * that owns that write and honours the urgent-ping dedupe key; a second writer
 * of `calendar_posts.video_status` is the last thing this surface needs.
 *
 *   node scripts/card-calendar-status-drift-check.js [--json] [--gate] [--limit=N]
 *
 * Exit 0 by default, so a human can read it without the shell arguing. `--gate`
 * exits 1 on any drift, which is how CI runs it.
 *
 * ------------------------------------------------------------------
 * PUBLIC SAFETY. The report prints calendar post ids, deliverable ids,
 * component names and status values, and NOTHING else — no client slug, no card
 * name, no caption, no actor. That holds in `--json` too. The sibling reports
 * put the client in their JSON for local triage; this one does not, because a
 * drift report is the kind of thing that gets pasted into an issue, and a
 * status value plus a card id is enough to open the right card.
 */

const fs = require('fs');
const path = require('path');

/* No default project, deliberately.
 *
 * A hard-coded `https://<ref>.supabase.co` is a public identifier for the
 * production database sitting in a public repository, and — the part that
 * actually bites — it means an unset or misspelled SUPABASE_URL silently aims a
 * live read at production instead of refusing. This script therefore has no
 * fallback for either value. The same defect is recorded against
 * `scripts/native-calendar-status-backfill.js` and
 * `scripts/linear-label-catalog-export.cli.js` in docs/ops/OPEN_REPAIRS.md. */
const SUPA_URL = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
/* Any read credential, in the order of least privilege that can still see both
   tables. `deliverables` is not fully readable with the browser publishable key
   on every roster, and a report that silently sees a subset of the estate would
   under-count drift — the one direction a monitor must never fail in — so CI
   passes the service role key. Nothing here writes, whichever key arrives. */
const SUPA_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const args = new Map(process.argv.slice(2).map(a => {
  const m = String(a).match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] == null ? '1' : m[2]] : [a, '1'];
}));
const AS_JSON = args.has('json');
const GATE = args.has('gate');
const LIMIT = Math.max(1, Number(args.get('limit') || 40) || 40);

/* ---- the canonical mapper, extracted verbatim from index.html ----
   Same extraction the two reconcilers use. If the function is renamed or
   restructured in the page, this throws rather than falling back to a guess. */
function loadMapper(srcPath) {
  const SRC = fs.readFileSync(srcPath, 'utf8');
  const at = SRC.indexOf('function _calMapNativeStatusStrict(');
  if (at < 0) throw new Error('_calMapNativeStatusStrict is not in index.html — it was renamed, and this report cannot guess the mapping');
  let depth = 0;
  for (let j = SRC.indexOf('{', at); j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}' && --depth === 0) {
      const body = SRC.slice(at, j + 1);
      return new Function(body + ';return _calMapNativeStatusStrict;')();
    }
  }
  throw new Error('_calMapNativeStatusStrict did not close — the extraction is wrong, not the page');
}

const MAP_SRC = process.env.NATIVE_STATUS_MAP_SRC || path.join(__dirname, '..', 'index.html');

/* The two component slots, named exactly as the trigger and the shipped page
   name them, so a rename there fails this rather than drifting past it. */
const SLOTS = Object.freeze([
  Object.freeze({ component: 'video', deliverableColumn: 'video_deliverable_id', statusColumn: 'video_status' }),
  Object.freeze({ component: 'graphic', deliverableColumn: 'graphic_deliverable_id', statusColumn: 'graphic_status' }),
]);

const BUCKETS = Object.freeze([
  'drift', 'agree', 'unmapped', 'archived', 'out_of_scope', 'link_asymmetric', 'shadowed', 'unresolved',
]);

function clean(value) { return String(value == null ? '' : value).trim(); }
function lower(value) { return clean(value).toLowerCase(); }

/* Which bucket one card slot falls in, in the trigger's own order of refusal.
   Pure, and exported, so the unit test can execute this rather than restate it. */
function classifySlot(card, slot, deliverable, mapNative) {
  const deliverableId = clean(card[slot.deliverableColumn]);
  if (!deliverableId) return null;                       // not a linked slot at all

  // The trigger resolves a deliverable sitting in both slots to 'video' and
  // never reaches the graphic branch for it.
  if (slot.component === 'graphic' && clean(card.video_deliverable_id) === deliverableId) {
    return { bucket: 'shadowed', target: null };
  }
  if (!deliverable) return { bucket: 'unresolved', target: null };
  if (lower(card.status) === 'archived') return { bucket: 'archived', target: null };
  if (clean(deliverable.origin) !== 'calendar') return { bucket: 'out_of_scope', target: null };

  // The trigger's lookup joins on card_id AND client_slug. A deliverable that
  // does not point back is one the bridge can never project.
  if (clean(deliverable.card_id) !== clean(card.id)
      || clean(deliverable.client_slug) !== clean(card.client)) {
    return { bucket: 'link_asymmetric', target: null };
  }

  const target = mapNative(deliverable.status, deliverable.origin);
  if (target == null || target === '') return { bucket: 'unmapped', target: null };

  // Exactly the trigger's `is distinct from` on the raw column.
  return { bucket: clean(card[slot.statusColumn]) === target ? 'agree' : 'drift', target };
}

/* The whole judgement over rows the caller has already read, so a fixture can
   drive it with no network. `deliverablesById` maps deliverable id -> row. */
function classify(cards, deliverablesById, mapNative) {
  const totals = {};
  for (const b of BUCKETS) totals[b] = 0;
  const byComponent = { video: 0, graphic: 0 };
  const drift = [];

  for (const card of cards || []) {
    for (const slot of SLOTS) {
      const verdict = classifySlot(card, slot, (deliverablesById || {})[clean(card[slot.deliverableColumn])], mapNative);
      if (!verdict) continue;
      totals[verdict.bucket]++;
      if (verdict.bucket !== 'drift') continue;
      byComponent[slot.component]++;
      drift.push({
        post_id: clean(card.id),
        deliverable_id: clean(card[slot.deliverableColumn]),
        component: slot.component,
        calendar_status: clean(card[slot.statusColumn]) || null,
        deliverable_status: clean((deliverablesById[clean(card[slot.deliverableColumn])] || {}).status) || null,
        expected: verdict.target,
      });
    }
  }
  drift.sort((a, b) => a.post_id.localeCompare(b.post_id) || a.component.localeCompare(b.component));
  return { totals, by_component: byComponent, drift };
}

async function rest(pathAndQuery) {
  const res = await fetch(SUPA_URL + '/rest/v1/' + pathAndQuery, {
    headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY },
  });
  if (!res.ok) {
    throw new Error(pathAndQuery.split('?')[0] + ' -> HTTP ' + res.status + ': ' + (await res.text()).slice(0, 200));
  }
  return res.json();
}

async function pageAll(table, select, extra = '', size = 500) {
  const out = [];
  for (let offset = 0; offset < 200000; offset += size) {
    const page = await rest(table + '?select=' + select + extra + '&order=id.asc&limit=' + size + '&offset=' + offset);
    out.push(...page);
    if (page.length < size) break;
  }
  return out;
}

async function main() {
  if (!SUPA_URL) {
    throw new Error('SUPABASE_URL is required — this script has no default project, so that an unset variable refuses rather than reading production by accident.');
  }
  if (!/^https:\/\/[^/]+$/.test(SUPA_URL)) {
    throw new Error('SUPABASE_URL must be an https origin with no path, e.g. https://<project-ref>.supabase.co');
  }
  if (!SUPA_KEY) {
    throw new Error('A read credential is required: set SUPABASE_ANON_KEY, SUPABASE_PUBLISHABLE_KEY or SUPABASE_SERVICE_ROLE_KEY. This script has no default key.');
  }

  const mapNative = loadMapper(MAP_SRC);

  const cards = await pageAll('calendar_posts',
    'id,client,status,video_status,graphic_status,video_deliverable_id,graphic_deliverable_id');

  const wanted = new Set();
  for (const card of cards) {
    for (const slot of SLOTS) {
      const id = clean(card[slot.deliverableColumn]);
      if (id) wanted.add(id);
    }
  }

  /* Read the deliverables side whole rather than querying per card: one paged
     scan is a few requests, a per-card lookup is thousands. */
  const deliverablesById = {};
  for (const row of await pageAll('deliverables', 'id,status,origin,card_id,client_slug')) {
    const id = clean(row.id);
    if (wanted.has(id)) deliverablesById[id] = row;
  }

  const report = Object.assign(
    {
      generated_at: new Date().toISOString(),
      cards_scanned: cards.length,
      linked_slots_scanned: wanted.size,
    },
    classify(cards, deliverablesById, mapNative));

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const t = report.totals;
    console.log('Calendar posts scanned: ' + report.cards_scanned
      + '   linked deliverables resolved: ' + Object.keys(deliverablesById).length + '/' + report.linked_slots_scanned);
    console.log('');
    console.log('  DRIFT            ' + t.drift + '   the bridge would have written this slot and it holds something else');
    console.log('  agree            ' + t.agree + '   already holds the mapped value');
    console.log('  unmapped         ' + t.unmapped + '   no calendar equivalent; the card is left as it was, correctly');
    console.log('  archived         ' + t.archived + '   out of scope for the trigger, the backfill and the reconciler');
    console.log('  out of scope     ' + t.out_of_scope + '   the deliverable origin is not calendar');
    console.log('  link asymmetric  ' + t.link_asymmetric + '   the deliverable does not point back; the bridge is inert here');
    console.log('  shadowed         ' + t.shadowed + '   same deliverable in both slots; the trigger resolves it to video');
    console.log('  unresolved       ' + t.unresolved + '   the card names a deliverable id that did not read back');
    if (report.drift.length) {
      console.log('');
      console.log('Drifted slots (post id, deliverable id, component, calendar -> expected):');
      for (const d of report.drift.slice(0, LIMIT)) {
        console.log('  ' + d.post_id.padEnd(40) + ' ' + d.deliverable_id.padEnd(40) + ' ' + d.component.padEnd(8)
          + ' ' + (d.calendar_status || '(none)').padEnd(18) + ' -> ' + d.expected
          + '   [card ' + (d.deliverable_status || '(none)') + ']');
      }
      if (report.drift.length > LIMIT) console.log('  ... and ' + (report.drift.length - LIMIT) + ' more (use --json or --limit=N)');
      console.log('');
      console.log('Drift means the bridge did not fire, or fired and lost. Re-running');
      console.log('public.production_native_calendar_status_backfill is the repair — it owns this');
      console.log('write and honours the urgent-ping dedupe key. Do not hand-edit the cards.');
    } else {
      console.log('');
      console.log('No linked slot disagrees with its deliverable. The bridge is holding.');
    }
    if (t.link_asymmetric) {
      console.log('');
      console.log('Note: ' + t.link_asymmetric + ' slot(s) are link-asymmetric. Those are not stale values —');
      console.log('the bridge is structurally inert for them and always will be until the link is repaired.');
    }
  }

  if (GATE && report.totals.drift > 0) process.exit(1);
}

if (require.main === module) {
  main().catch(e => {
    console.error('card-calendar-status-drift-check failed: ' + ((e && e.message) || e));
    process.exit(1);
  });
}

module.exports = { classify, classifySlot, loadMapper, SLOTS, BUCKETS };
