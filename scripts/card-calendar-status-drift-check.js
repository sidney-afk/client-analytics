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
 *   pre_bridge      the two disagree, but the deliverable last moved BEFORE the
 *                   trigger existed (see BRIDGE_GO_LIVE). The trigger fires on
 *                   a change and does not reconcile history, so this is the
 *                   backlog the bridge was built to stop growing, not a failure
 *                   of the bridge. Counted and LISTED, never gating.
 *   DRIFT           everything else: the deliverable moved at or after go-live,
 *                   the trigger would have written this slot, and it does not
 *                   hold the projected value.
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
 * exits 1 on any DRIFT, which is how CI runs it -- never on a pre-bridge row,
 * which is a backlog this gate cannot speak to and which would otherwise hold
 * the lane permanently red.
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

/* WHEN THE BRIDGE TRIGGER WENT LIVE.
 *
 * `migrations/2026-09-18-native-calendar-status-bridge.sql` was applied to
 * production at this instant, measured by the storage session that applied it
 * and recorded in docs/ops/LINEAR_EXIT_JOURNAL.md and REPO_MAP.md. It is the
 * moment `production_native_calendar_status_after` began to exist.
 *
 * It is a constant here, once, rather than a literal repeated at each use: this
 * value is the whole boundary between "the bridge failed" and "the bridge was
 * not there yet", and a second copy that drifted from the first would move that
 * boundary silently. If the trigger is ever dropped and reinstalled, this is
 * the one line to change, and the fixture either side of it will say whether
 * the change took. */
const BRIDGE_GO_LIVE = '2026-09-18T22:38:14Z';
const BRIDGE_GO_LIVE_MS = Date.parse(BRIDGE_GO_LIVE);

const BUCKETS = Object.freeze([
  'drift', 'pre_bridge', 'agree', 'unmapped', 'archived', 'out_of_scope', 'link_asymmetric', 'shadowed', 'unresolved',
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

  /* The trigger's `is distinct from` against the RAW column, untrimmed.
     `clean()` here would be wrong in the one direction that matters: a stored
     `"Approved "` is not equal to `"Approved"` as far as the trigger is
     concerned, so the trigger WOULD rewrite it -- and trimming would report it
     agreeing, hiding that whole class of rows behind this report's own claim to
     compare exactly. A null column is distinct from any non-null target, in the
     trigger and here alike. */
  const raw = card[slot.statusColumn] == null ? null : String(card[slot.statusColumn]);
  if (raw === target) return { bucket: 'agree', target };

  /* A disagreement the bridge was never present for.
     ------------------------------------------------------------------
     The trigger fires on a CHANGE. It does not reconcile history, and it never
     claimed to: the cards that were already behind when it was installed are
     the backfill's job. The backfill has run twice against production --
     2026-09-18 23:45Z (16 posts) and 2026-09-19 01:10Z (1 post).
     `pre_bridge` here is purely a date cutoff (below) -- it says nothing about
     WHY a given row still disagrees, and the backfill applies no
     component-aware exclusion of its own. At least some of the rows still
     listed below are posts that were published without the component being
     compared, which is a real reason a backfill has nothing correct to write
     for them (OPEN_REPAIRS 212) -- but that is a property of those specific
     rows, not a blanket reason for the whole pre-bridge list, and the rest of
     the backlog is not accounted for by it. So a slot whose deliverable last
     moved BEFORE the trigger existed is not evidence that the bridge is
     failing -- it is
     evidence of the gap the bridge was built to stop widening.

     The first live run of this lane went red on exactly that: 27 slots, 25 of
     them last changed between April and 2026-08-24. Gating on those would have
     made the lane permanently red for a backlog it cannot speak to, which is
     the same crying-wolf failure the buckets above exist to prevent -- a gate
     that is always red is a gate nobody reads.

     They are counted and LISTED, not hidden. The backlog is real and somebody
     should decide about it; it is simply not this gate's question.

     A missing `status_at` is treated as pre-bridge, because it cannot be shown
     to be at or after go-live and the conservative direction for a gate is to
     under-report. The backfill draws the same line the same way, with
     `d.status_at is not null and d.status_at >= p_since`. */
  const movedAt = Date.parse(clean(deliverable.status_at));
  if (!Number.isFinite(movedAt) || movedAt < BRIDGE_GO_LIVE_MS) {
    return { bucket: 'pre_bridge', target };
  }

  return { bucket: 'drift', target };
}

/* The wording of a PASSING run, as a pure function so it can be tested.
   It has to stay true in the presence of a pre-bridge backlog: "no linked slot
   disagrees" is false when the backlog below disagrees, and a passing run that
   contradicts its own listing is a run people stop trusting. Raised by Codex on
   #1426. */
function cleanSummary(totals) {
  const pre = (totals && totals.pre_bridge) || 0;
  if (!pre) return ['No linked slot disagrees with its deliverable. The bridge is holding.'];
  return [
    'No POST-GO-LIVE drift: every slot the bridge was responsible for agrees.',
    'The ' + pre + ' pre-bridge slot(s) below still disagree and are listed, not gated.',
  ];
}

/* Re-judge drift candidates against a FRESH read of both sides.
   Pure, and exported, so the race this exists for can be tested offline
   instead of only being argued about in a comment. A candidate survives only
   if it still disagrees on rows read after the original scan; anything else --
   it now agrees, the card moved to archived, the deliverable became unmapped,
   the card is gone -- is counted as settled and never reported. */
function resettle(candidates, freshCards, freshDeliverables, mapNative) {
  const survivors = [];
  let settled = 0;
  for (const d of candidates || []) {
    const card = (freshCards || {})[d.post_id];
    const slot = SLOTS.find(s => s.component === d.component);
    if (!card || !slot) { settled++; continue; }
    const deliverable = (freshDeliverables || {})[clean(card[slot.deliverableColumn])];
    const verdict = classifySlot(card, slot, deliverable, mapNative);
    if (!verdict || verdict.bucket !== 'drift') { settled++; continue; }
    survivors.push(Object.assign({}, d, {
      calendar_status: card[slot.statusColumn] == null ? null : String(card[slot.statusColumn]),
      deliverable_status: clean((deliverable || {}).status) || null,
      expected: verdict.target,
    }));
  }
  return { survivors, settled };
}

/* The whole judgement over rows the caller has already read, so a fixture can
   drive it with no network. `deliverablesById` maps deliverable id -> row. */
function classify(cards, deliverablesById, mapNative) {
  const totals = {};
  for (const b of BUCKETS) totals[b] = 0;
  const byComponent = { video: 0, graphic: 0 };
  const drift = [];
  const preBridge = [];

  for (const card of cards || []) {
    for (const slot of SLOTS) {
      const deliverable = (deliverablesById || {})[clean(card[slot.deliverableColumn])];
      const verdict = classifySlot(card, slot, deliverable, mapNative);
      if (!verdict) continue;
      totals[verdict.bucket]++;
      if (verdict.bucket !== 'drift' && verdict.bucket !== 'pre_bridge') continue;

      const row = {
        post_id: clean(card.id),
        deliverable_id: clean(card[slot.deliverableColumn]),
        component: slot.component,
        /* Raw, not trimmed, for the same reason the comparison is: if the
           reason this row drifted is a stray space, a trimmed report would
           show the two sides as identical and read like a bug in the check. */
        calendar_status: card[slot.statusColumn] == null ? null : String(card[slot.statusColumn]),
        deliverable_status: clean((deliverable || {}).status) || null,
        /* The date is the WHOLE argument for a pre-bridge row, so it is
           reported rather than left for somebody to go and look up. */
        deliverable_status_at: clean((deliverable || {}).status_at) || null,
        expected: verdict.target,
      };

      if (verdict.bucket === 'pre_bridge') { preBridge.push(row); continue; }
      byComponent[slot.component]++;
      drift.push(row);
    }
  }
  const order = (a, b) => a.post_id.localeCompare(b.post_id) || a.component.localeCompare(b.component);
  drift.sort(order);
  /* Oldest first: the top of this list is the oldest thing the calendar has
     been wrong about, which is the one worth deciding about. */
  preBridge.sort((a, b) => clean(a.deliverable_status_at).localeCompare(clean(b.deliverable_status_at)) || order(a, b));
  return { totals, by_component: byComponent, drift, pre_bridge: preBridge };
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

  /* Two different counts, deliberately. `wanted` is the set of deliverable ids
     to FETCH, so it is distinct. `linkedSlots` is the scope this report
     publishes, and that is per slot: the shadowed case puts one deliverable in
     two slots of one card, `classify` buckets both, and counting the set would
     under-state what was actually measured. */
  const wanted = new Set();
  let linkedSlots = 0;
  for (const card of cards) {
    for (const slot of SLOTS) {
      const id = clean(card[slot.deliverableColumn]);
      if (!id) continue;
      linkedSlots++;
      wanted.add(id);
    }
  }

  /* Read the deliverables side whole rather than querying per card: one paged
     scan is a few requests, a per-card lookup is thousands. */
  const deliverablesById = {};
  for (const row of await pageAll('deliverables', 'id,status,status_at,origin,card_id,client_slug')) {
    const id = clean(row.id);
    if (wanted.has(id)) deliverablesById[id] = row;
  }

  const first = classify(cards, deliverablesById, mapNative);

  /* Settle the scan's own race before calling anything drift.
     ------------------------------------------------------------------
     The two sides are read by two separate paged scans. The trigger updates
     `deliverables` and `calendar_posts` in ONE transaction, so a status change
     landing between the scans leaves this process holding the old card and the
     new deliverable -- which looks exactly like drift and is not. On a live
     estate an ordinary editor edit would therefore fail the gate and page the
     watchdog, which is the crying-wolf failure this report was shaped to avoid.

     So every candidate is re-read as a pair and re-judged, and only a candidate
     that disagrees BOTH times is reported. An in-flight edit settles, because
     the re-read sees the card the trigger already wrote. Real drift survives,
     because nothing is writing that card.

     This narrows the window rather than abolishing it -- a genuine repeatable
     snapshot would need one transaction, which PostgREST does not give us. An
     edit landing inside the re-read too would have to be a second write to the
     same slot in that instant, and the next hourly run reports it. Erring
     toward under-reporting is the right direction for a gate: a missed row is
     caught an hour later, a false red teaches people to ignore the lane. */
  let settledByRecheck = 0;
  let drift = first.drift;
  if (drift.length) {
    const survivors = [];
    for (let i = 0; i < drift.length; i += 100) {
      const batch = drift.slice(i, i + 100);
      const cardIds = [...new Set(batch.map(d => d.post_id))];
      const dlvIds = [...new Set(batch.map(d => d.deliverable_id))];
      const freshCards = {};
      for (const row of await rest('calendar_posts?select=id,client,status,video_status,graphic_status,'
        + 'video_deliverable_id,graphic_deliverable_id&id=in.(' + cardIds.map(encodeURIComponent).join(',') + ')')) {
        freshCards[clean(row.id)] = row;
      }
      const freshDlv = {};
      for (const row of await rest('deliverables?select=id,status,status_at,origin,card_id,client_slug'
        + '&id=in.(' + dlvIds.map(encodeURIComponent).join(',') + ')')) {
        freshDlv[clean(row.id)] = row;
      }
      const settled = resettle(batch, freshCards, freshDlv, mapNative);
      survivors.push(...settled.survivors);
      settledByRecheck += settled.settled;
    }
    /* Settled candidates are counted in their own field, not folded into
       `agree`. On the re-read one may well be agreeing, but it may equally have
       become archived or unmapped, and quietly reclassifying it as agreement
       would be a precision this process did not measure. */
    drift = survivors;
    first.totals.drift = drift.length;
  }

  const report = Object.assign(
    {
      generated_at: new Date().toISOString(),
      bridge_go_live: BRIDGE_GO_LIVE,
      cards_scanned: cards.length,
      linked_slots_scanned: linkedSlots,
      distinct_deliverables_linked: wanted.size,
      settled_by_recheck: settledByRecheck,
    },
    first, { drift });

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const t = report.totals;
    console.log('Calendar posts scanned: ' + report.cards_scanned
      + '   linked slots: ' + report.linked_slots_scanned
      + '   deliverables resolved: ' + Object.keys(deliverablesById).length + '/' + report.distinct_deliverables_linked);
    if (report.settled_by_recheck) {
      console.log('Candidates that settled on re-read (an edit was in flight mid-scan): ' + report.settled_by_recheck);
    }
    console.log('');
    console.log('  DRIFT            ' + t.drift + '   moved at/after go-live, the bridge would have written it, and it holds something else');
    console.log('  pre-bridge       ' + t.pre_bridge + '   disagrees, but last moved before the trigger existed (' + BRIDGE_GO_LIVE + ')');
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
          /* Quoted, so a stray leading or trailing space -- which is a whole
             reason a row can drift -- is visible instead of looking identical
             to the expected value and reading like a bug in this report. */
          + ' ' + (d.calendar_status == null ? '(none)' : JSON.stringify(d.calendar_status)).padEnd(20) + ' -> ' + d.expected
          + '   [card ' + (d.deliverable_status || '(none)') + ']');
      }
      if (report.drift.length > LIMIT) console.log('  ... and ' + (report.drift.length - LIMIT) + ' more (use --json or --limit=N)');
      console.log('');
      console.log('Drift means the bridge did not fire, or fired and lost. Re-running');
      console.log('public.production_native_calendar_status_backfill is the repair — it owns this');
      console.log('write and honours the urgent-ping dedupe key. Do not hand-edit the cards.');
    } else {
      console.log('');
      /* The clean message has to be true in the presence of a pre-bridge
         backlog, and "no linked slot disagrees" is not: the backlog listed
         below disagrees, it is simply not this gate's question. Printing that
         line above a list of disagreeing slots would make a passing run read as
         self-contradictory, and the most likely thing a reader does with a
         contradiction is stop trusting the whole report. Raised by Codex on
         #1426. */
      for (const line of cleanSummary(t)) console.log(line);
    }
    if (report.pre_bridge && report.pre_bridge.length) {
      console.log('');
      console.log('Pre-bridge backlog, oldest first (post id, deliverable id, component, calendar -> expected, last moved):');
      for (const d of report.pre_bridge.slice(0, LIMIT)) {
        console.log('  ' + d.post_id.padEnd(40) + ' ' + d.deliverable_id.padEnd(40) + ' ' + d.component.padEnd(8)
          + ' ' + (d.calendar_status == null ? '(none)' : JSON.stringify(d.calendar_status)).padEnd(20) + ' -> ' + String(d.expected).padEnd(18)
          + ' ' + (d.deliverable_status_at || '(no status_at)'));
      }
      if (report.pre_bridge.length > LIMIT) console.log('  ... and ' + (report.pre_bridge.length - LIMIT) + ' more (use --json or --limit=N)');
      console.log('');
      console.log('These are NOT gating and never will be: the trigger fires on a change and does');
      console.log('not reconcile history. production_native_calendar_status_backfill has run twice');
      console.log('against production (2026-09-18 23:45Z, 16 posts; 2026-09-19 01:10Z, 1 post). At');
      console.log('least some of the rows still listed here are posts published without the');
      console.log('component being compared, so there is no correct value a backfill could write for');
      console.log('them -- but that is a reason for those specific rows, not a blanket explanation for');
      console.log('this whole list; the rest of the backlog remains open (OPEN_REPAIRS 212).');
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

module.exports = { classify, classifySlot, resettle, cleanSummary, loadMapper, SLOTS, BUCKETS };
