'use strict';
/*
 * WHICH CLIENT THREADS LIVE ONLY ON THE LEGACY STORE WHILE THEIR CARD LOOKS
 * CANONICALLY LINKED?
 *
 * A card comment can travel by one of two transports and, until 2026-09-02,
 * NOTHING made the two sides of a thread agree on which:
 *
 *   - A CLIENT's add routes through `_prodClientCommentGatewayContext`
 *     (`index.html`), which fails-legacy unless the deliverable's
 *     origin/team/client_slug/card_id crosswalk describes this exact card.
 *   - A STAFF add routed through `_writeUiUseGatewayWhenReady` ->
 *     `_writeUiRerouteUseGateway(slug)`, which consults ONLY the
 *     `write_ui_reroute_clients` allowlist and never looks at the crosswalk.
 *
 * So on a slot whose crosswalk fails, a client root is written to the legacy
 * card column with NO `production_comments` row, and the staff reply to it was
 * sent to the gateway, which could not find the parent and refused. The reply
 * text was then discarded in `_calAppendComment`'s catch (`return false` runs
 * BEFORE `arr.push(msg)`) and the refusal carried reload advice that can never
 * work. `OPEN_REPAIRS.md` items 99-101 are the write-up.
 *
 * THE ADD LANE WAS REPAIRED THE SAME DAY -- `_calPostLinearComment` and
 * `_sxrPostLinearComment` now take `meta.canonicalUnlinked`, which
 * `_prodCommentAddRoutesLegacy` answers from the CROSSWALK, and route a staff
 * add on a slot the crosswalk proves broken to the legacy store: the fallback
 * its three sibling operations always had. (Deliberately narrower than "the
 * gate says unlinked" -- a slot with no deliverable id keeps its fail-closed
 * `native_link_required` refusal, and a valid link held by the coverage
 * invariant keeps the gateway.) WHAT THIS CHECK COUNTS IS THE RESIDUE, and it
 * does not go away with that repair:
 *
 *   - these threads still exist only on the card column, so the crosswalk
 *     backfill must not land before the comment import (item 103's ordering
 *     hazard) or every one of them breaks again from the browser side;
 *   - any tab loaded before the repair reaches it still routes the old way;
 *   - and item 101 is why a data-derived check had to exist at all: a refused
 *     write reaches NO server -- it is a console line and a 50-entry
 *     localStorage ring in one browser -- so the first signal was the client
 *     complaining.
 *
 * WHAT IT COUNTS, and the narrowing matters more than the count. Measured
 * 2026-09-02 over all 9,681 `calendar_posts` (19,362 video+graphic slots) and
 * all 6,241 `deliverables`:
 *
 *   - 18,180 slots carry no deliverable id. The gate answers `unlinked`, BOTH
 *     sides go legacy, and the thread is consistent. Excluded, and it is the
 *     overwhelming majority: counting them would report a number nine hundred
 *     times larger than the defect.
 *   - 1,182 slots are deliverable-linked. 1,010 of those crosswalk VALID --
 *     both sides go canonical, also consistent. Excluded from the gate and
 *     reported separately (see INVERSE below).
 *   - 172 crosswalk MISMATCH. 152 of them carry no client-authored root, and
 *     those are excluded ON PURPOSE: a STAFF root on a mismatching slot still
 *     went to the gateway, so it HAS a canonical row and a reply to it
 *     resolves. Only a CLIENT root is the poisoned parent. Counting all 172
 *     would report a defect eight and a half times larger than the real one.
 *   - and a mismatch on `card_id` ALONE with the deliverable side UNBOUND is
 *     excluded too, whether or not it carries a client root: that is the one
 *     shape the gateway client front door ADMITS, so the client root there is
 *     canonical. 8 slots mismatch on card_id alone today and all 8 name a
 *     DIFFERENT card, so none is carved out and the 20 below is unchanged --
 *     but without the rule the first card_id-null one to take a client comment
 *     would trip a gate set to the exact current count. See `transportSplit`.
 *
 * What remains is a deliverable-linked slot whose crosswalk fails AND which
 * carries at least one client-authored, non-tombstoned root comment. Measured
 * 2026-09-02: 20 slots across 6 clients, holding 32 client roots.
 *   crosswalk_fields histogram: card_id+origin 16, team 2,
 *   card_id+origin+team 1, origin 1.
 *   per client: jesseisrael 7, bayavoce 5, soniachopra 3,
 *   jessicawinterstern 3, eben&annie 1, jennaphillipsballard 1.
 *
 * LATENT vs LIVE, because the allowlist is the other half of the split. A slug
 * that is NOT in `write_ui_reroute_clients` sends staff to legacy too, so the
 * thread is consistent and no reply is refused -- the row is LATENT and becomes
 * live the moment the slug is added. All 6 affected slugs are on the allowlist
 * today (42 slugs, read live -- never hardcoded), so latent is 0 and gated is
 * 20; the split is still reported because the allowlist moves and a flip would
 * otherwise look like new breakage.
 *
 * REPORTED, NEVER GATED: 9 of the 20 sit on a card that is not Archived or
 * Posted. The other 11 are the same break on a card nobody is waiting on. The
 * gate is the full 20 because the count is the population, not the urgency --
 * the backfill has to carry every one of them, live or not.
 *
 * THE INVERSE, which a naive check misses. 208 crosswalk-VALID slots carry
 * client roots. The gate calls those `linked`, so `Mark done` and `Delete`
 * take the canonical lifecycle lane -- and if the canonical thread was never
 * written, that lane answers 403 `comment_forbidden`, which the browser maps to
 * "ask an SMM or the owner": a permissions escalation for a row that does not
 * exist. Proving coverage needs `production_comments`, which answers 42501 to
 * the publishable key, so this cohort is printed as EXPOSURE, never gated. The
 * one part that IS derivable -- a valid slot whose client is off the reroute
 * allowlist, where the UI can never have written a canonical row -- is measured
 * and is 0 today.
 *
 * NO DISPLAY NAMES, NO TOKENS, NO COMMENT BODIES. This repo is public and this
 * output lands in CI logs. Slugs, card ids, deliverable ids, field names and
 * counts only.
 *
 * READ-ONLY. Public key, no writes, no Linear calls, safe to run anywhere.
 *
 *   node scripts/card-comment-transport-split-check.js [--baseline=20] [--json]
 *
 * Exits 1 above the baseline so it can gate; 0 at or below it; 2 on error.
 */
const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/$/, '');
const SUPA_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
  || 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const baselineArg = args.find(a => a.startsWith('--baseline='));
const BASELINE = baselineArg ? Number(baselineArg.split('=')[1]) : 20;
/* Mutated constantly by drills; reported, never gated. */
const TEST_CLIENT = String(process.env.SYNCVIEW_TEST_CLIENT || 'sidneylaruel');

/* ---- the crosswalk, mirrored VERBATIM from index.html -------------------
   `_prodCrosswalkMismatchFields` (index.html:25344), its two helpers and
   `PROD_CROSSWALK_SURFACE_ORIGIN` (:25332). origin and team compare
   case-insensitively; client_slug and card_id compare exactly after trimming;
   the reason string uses the planner's `crosswalk_fields:` form.
   test/card-comment-transport-split.js lifts BOTH this copy and the page's own
   and asserts they agree on every row shape, so a check with its own idea of
   "linked" cannot drift into measuring nothing. */
const PROD_CROSSWALK_SURFACE_ORIGIN = { calendar: 'calendar', sxr: 'samples' };
const low = v => String(v == null ? '' : v).trim().toLowerCase();
const exact = v => String(v == null ? '' : v).trim();

function crosswalkTeamForComponent(component) {
  return component === 'graphic' ? 'graphics' : 'video';
}
function crosswalkCardSlug(post) {
  return String((post && (post.client_slug || post.client)) || '').trim();
}
function crosswalkMismatchFields(deliverable, surface, post, component) {
  const expectedOrigin = PROD_CROSSWALK_SURFACE_ORIGIN[low(surface)] || '';
  const fields = [];
  if (low(deliverable && deliverable.origin) !== expectedOrigin) fields.push('origin');
  if (low(deliverable && deliverable.team) !== crosswalkTeamForComponent(component)) fields.push('team');
  if (exact(deliverable && deliverable.client_slug) !== crosswalkCardSlug(post)) fields.push('client_slug');
  if (exact(deliverable && deliverable.card_id) !== exact(post && post.id)) fields.push('card_id');
  return fields.sort();
}
/* `_writeUiNativeId` (index.html:25306) — a slot is the (card, component) pair,
   and only video and graphic carry a deliverable at all. */
function nativeId(post, component) {
  if (!post) return '';
  return exact(component === 'graphic' ? post.graphic_deliverable_id : post.video_deliverable_id);
}

/* ---- which comments a person can actually see and reply to --------------
   `_calLoadComments` (index.html:43715) reads `video_tweaks` and falls back to
   the legacy `tweaks` column when it is empty; `_calCommentsFor` (:27141) reads
   `graphic_tweaks` for graphics. Rows with no `id` are dropped on read, and
   `_calCommentsForView` (:27190) hides tombstoned (`deleted` and not
   `canonical`) and `hidden` rows from everyone -- they never render, so nobody
   will ever reply to them. Excluding them moves 33 client roots to 32 and
   leaves all 20 slots, so the narrowing is honest rather than convenient. */
function commentColumn(post, component) {
  if (component === 'graphic') return exact(post && post.graphic_tweaks);
  return exact(post && post.video_tweaks) || exact(post && post.tweaks);
}
function readComments(post, component) {
  const raw = commentColumn(post, component);
  if (!raw || raw[0] !== '[') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(c => c && c.id) : [];
  } catch (e) { return []; }
}
function clientRootCount(post, component) {
  let n = 0;
  for (const c of readComments(post, component)) {
    if (exact(c.parent_id)) continue;
    if (low(c.role) !== 'client') continue;
    if ((c.deleted && !c.canonical) || c.hidden) continue;
    n++;
  }
  return n;
}

/* ---- the classifier ------------------------------------------------------
   '' means the two transports agree on this slot, for one of five reasons that
   are each counted separately by the caller. Anything else is the reason a
   staff reply to a client root here will be refused.

   THE FRONT-DOOR CARVE-OUT is the one nobody would guess and the one a naive
   check gets wrong. `_prodClientCommentGatewayContext` (index.html) does NOT
   require a clean crosswalk: it also admits a mismatch on `card_id` ALONE when
   the deliverable side is UNBOUND (card_id null/empty — origin, team and slug
   all correct), because that is exactly what the gateway verifies server-side
   in `clientCommentFrontDoorTargetAllowed`. A client root on such a slot went
   to the GATEWAY and HAS a canonical row, so the thread is not one-way and a
   staff reply to it resolves. Counting it would be a false positive on the
   very gate this check arms. It is conditional on the
   `client_comment_gateway_enabled` runtime flag, which is what turns that door
   on at all; with the flag off the client goes legacy and the split is real
   again, so the flag is read live rather than assumed.

   Measured 2026-09-02: 8 slots mismatch on `card_id` alone and every one of
   them names a DIFFERENT card, so `card_unbound` is false for all 8, none is
   carved out, and the headline 20 is unchanged. The carve-out is here because
   the first calendar-origin, right-team, right-slug, NULL-`card_id` slot to
   acquire a client root would otherwise trip a gate that is set to the exact
   current count. */
function transportSplit(post, component, deliverable, onAllowlist, frontDoorOn) {
  if (!nativeId(post, component)) return '';           // unlinked: both sides legacy
  const fields = crosswalkMismatchFields(deliverable, 'calendar', post, component);
  if (!fields.length) return '';                       // valid: both sides canonical
  if (frontDoorOn && fields.length === 1 && fields[0] === 'card_id'
    && exact(deliverable && deliverable.card_id) === '') return '';  // front door admits it
  if (!clientRootCount(post, component)) return '';    // staff-only thread: its root IS canonical
  const reason = 'crosswalk_fields: ' + fields.join(',');
  return onAllowlist ? reason : 'latent, slug off the gateway allowlist — ' + reason;
}

async function pageAll(path) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${SUPA_URL}/rest/v1/${path}&offset=${offset}&limit=1000`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
    });
    if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error(`${path} -> not an array`);
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

(async () => {
  /* `deliverables` refuses `select=*` to the publishable key, so the column
     list is explicit and is exactly PROD_CROSSWALK_SELECT. Both tables are far
     past the REST default of 1000 rows: unpaged, this check would read 1,000 of
     9,681 cards and report a reassuring, wrong number. */
  const [posts, deliverables, flagRows] = await Promise.all([
    pageAll('calendar_posts?select=id,client,status,video_deliverable_id,graphic_deliverable_id,'
      + 'video_tweaks,graphic_tweaks,tweaks&order=id'),
    pageAll('deliverables?select=id,client_slug,team,origin,card_id&order=id'),
    pageAll('syncview_runtime_flags?select=key,value&order=key'),
  ]);
  const byDeliverableId = new Map();
  for (const row of deliverables) if (row.id) byDeliverableId.set(String(row.id), row);
  const flag = flagRows.find(r => r && r.key === 'write_ui_reroute_clients');
  const allowlist = new Set((flag && flag.value && Array.isArray(flag.value.clients) ? flag.value.clients : [])
    .map(s => String(s).trim()));
  /* The client front door only exists while this flag is on; with it off a
     client root on a card_unbound slot goes legacy like every other, and the
     carve-out below must not apply. Mirrors `_clientCommentGatewaySetFlagValue`
     (index.html): anything but an object with `enabled === true` is off. */
  const gatewayFlag = flagRows.find(r => r && r.key === 'client_comment_gateway_enabled');
  const frontDoorOn = !!(gatewayFlag && gatewayFlag.value && typeof gatewayFlag.value === 'object'
    && !Array.isArray(gatewayFlag.value) && gatewayFlag.value.enabled === true);

  let unlinked = 0, linked = 0, crosswalkValid = 0, mismatchNoClientRoot = 0, deliverableRowAbsent = 0;
  let frontDoorAdmitted = 0, frontDoorAdmittedWithRoots = 0;
  const atRisk = [];
  const inverse = [];
  for (const post of posts) {
    const slug = crosswalkCardSlug(post);
    const onAllowlist = allowlist.has(slug);
    for (const component of ['video', 'graphic']) {
      const deliverableId = nativeId(post, component);
      if (!deliverableId) { unlinked++; continue; }
      linked++;
      const deliverable = byDeliverableId.get(deliverableId) || null;
      if (!deliverable) deliverableRowAbsent++;
      const fields = crosswalkMismatchFields(deliverable, 'calendar', post, component);
      const roots = clientRootCount(post, component);
      if (!fields.length) {
        crosswalkValid++;
        // The inverse cohort: the gate says `linked`, so the lifecycle lane is
        // canonical-only for these. Whether a canonical row exists is NOT
        // readable here, so this is exposure, never a gated defect.
        if (roots) {
          inverse.push({ card_id: post.id, component, deliverable_id: deliverableId,
            client: slug, client_roots: roots, on_allowlist: onAllowlist });
        }
        continue;
      }
      // The front door admits this exact mismatch, so the client root here is
      // canonical and the thread is consistent. Counted apart from the
      // staff-only exclusion because it is a different reason.
      if (frontDoorOn && fields.length === 1 && fields[0] === 'card_id'
        && exact(deliverable && deliverable.card_id) === '') {
        frontDoorAdmitted++;
        if (roots) frontDoorAdmittedWithRoots++;
        continue;
      }
      const why = transportSplit(post, component, deliverable, onAllowlist, frontDoorOn);
      if (!why) { mismatchNoClientRoot++; continue; }
      atRisk.push({ card_id: post.id, component, deliverable_id: deliverableId, client: slug,
        crosswalk_fields: fields.join(','), client_roots: roots, card_status: String(post.status || ''),
        deliverable_row_present: !!deliverable, on_allowlist: onAllowlist, why });
    }
  }

  atRisk.sort((a, b) => (a.client.localeCompare(b.client) || a.card_id.localeCompare(b.card_id)
    || a.component.localeCompare(b.component)));
  inverse.sort((a, b) => (a.client.localeCompare(b.client) || a.card_id.localeCompare(b.card_id)));

  const real = atRisk.filter(r => r.client !== TEST_CLIENT);
  const testRows = atRisk.filter(r => r.client === TEST_CLIENT);
  const gated = real.filter(r => r.on_allowlist);
  const latent = real.filter(r => !r.on_allowlist);
  const parked = new Set(['Archived', 'Posted']);
  const liveCards = gated.filter(r => !parked.has(r.card_status));

  const tally = (rows, key) => {
    const out = {};
    for (const r of rows) out[r[key]] = (out[r[key]] || 0) + 1;
    return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  };
  const perClient = tally(gated, 'client');
  const perReason = tally(gated, 'crosswalk_fields');
  const rootsHeld = gated.reduce((sum, r) => sum + r.client_roots, 0);
  const inverseOffAllowlist = inverse.filter(r => !r.on_allowlist);
  const failed = gated.length > BASELINE;

  if (asJson) {
    console.log(JSON.stringify({
      baseline: BASELINE, gated_count: gated.length,
      at_risk: gated, latent_off_allowlist: latent, test_client: testRows,
      per_client: perClient, per_crosswalk_reason: perReason,
      client_roots_held: rootsHeld,
      live_card_subset: liveCards.map(r => r.card_id + '|' + r.component),
      slots_examined: unlinked + linked, unlinked_excluded: unlinked,
      deliverable_linked: linked, crosswalk_valid_excluded: crosswalkValid,
      mismatch_without_client_root_excluded: mismatchNoClientRoot,
      deliverable_row_absent: deliverableRowAbsent,
      front_door_admitted_excluded: frontDoorAdmitted,
      front_door_admitted_with_client_roots: frontDoorAdmittedWithRoots,
      client_comment_gateway_enabled: frontDoorOn,
      allowlist_size: allowlist.size,
      inverse_valid_with_client_roots: inverse.length,
      inverse_valid_off_allowlist: inverseOffAllowlist,
      inverse_per_client: tally(inverse, 'client'),
    }, null, 2));
  } else {
    console.log('Card comment transport split — client threads living only on the legacy store\n'
      + '  while their card looks canonically linked.\n');
    console.log(`  card/component slots examined       ${unlinked + linked}`);
    console.log(`    excluded, no deliverable id       ${unlinked}   (gate says unlinked; both sides legacy)`);
    console.log(`  deliverable-linked slots            ${linked}`);
    console.log(`    excluded, crosswalk valid         ${crosswalkValid}   (both sides canonical)`);
    console.log(`    excluded, mismatch, no client root${String(mismatchNoClientRoot).padStart(5)}   (a staff root IS canonical; a reply to it resolves)`);
    console.log(`    excluded, front door admits it    ${String(frontDoorAdmitted).padStart(5)}   `
      + `(card_id alone + deliverable unbound; client_comment_gateway_enabled=${frontDoorOn}`
      + `${frontDoorAdmittedWithRoots ? ', ' + frontDoorAdmittedWithRoots + ' carry client roots' : ''})`);
    if (deliverableRowAbsent) {
      console.log(`    deliverable row not readable      ${deliverableRowAbsent}   (counts as a mismatch on all four fields)`);
    }
    console.log(`  ONE-WAY THREADS                     ${gated.length}   (baseline ${BASELINE}, holding ${rootsHeld} client roots)\n`);
    const show = (title, list) => {
      if (!list.length) return;
      console.log(`  ${title} — ${list.length}`);
      for (const r of list) {
        console.log(`    ${r.card_id.padEnd(18)} ${r.component.padEnd(8)} ${String(r.client).padEnd(22)}`
          + `${String(r.crosswalk_fields).padEnd(22)} roots=${r.client_roots}  card=${r.card_status}`);
      }
      console.log('');
    };
    show('AT RISK — client root on the legacy store, no canonical row behind it', gated);
    show(`LATENT — same break, slug off the ${allowlist.size}-client reroute allowlist, so staff go legacy too`, latent);
    show(`TEST CLIENT (${TEST_CLIENT}) — reported, not gated`, testRows);
    const line = (label, obj) => console.log(`  ${label} ${Object.entries(obj).map(([k, v]) => k + ' ' + v).join(', ')}`);
    if (gated.length) {
      line('per client        ', perClient);
      line('crosswalk_fields  ', perReason);
      console.log(`  on a card that is neither Archived nor Posted   ${liveCards.length} of ${gated.length}`
        + '   (the rest are the same break where nobody is waiting)\n');
    }
    console.log(`  INVERSE, reported never gated: crosswalk-VALID slots carrying client roots   ${inverse.length}`);
    console.log('    The gate calls these `linked`, so Mark done / Delete take the canonical');
    console.log('    lifecycle lane and answer 403 comment_forbidden ("ask an SMM or the owner")');
    console.log('    if no canonical row was ever written. Proving coverage needs');
    console.log('    production_comments, which answers 42501 to this key — so this is exposure,');
    console.log('    not a measured defect. The derivable part, a valid slot whose slug is off');
    console.log(`    the reroute allowlist and so can never have been written canonically:  ${inverseOffAllowlist.length}\n`);
    console.log(failed
      ? `FAIL: ${gated.length} above the baseline of ${BASELINE} — more client threads have gone one-way ❌`
      : `At or under the baseline of ${BASELINE} ✅`);
    if (gated.length) {
      console.log('Membership can move without the count moving — compare the card ids, not just the number.');
    }
  }
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error('card comment transport split check failed:', err.message); process.exit(2); });
