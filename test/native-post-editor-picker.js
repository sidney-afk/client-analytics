'use strict';
/*
 * WHO EDITS THIS POST — the Create Post video-editor picker.
 *
 * Owner request 2026-08-24: "there should be a drop-down for the editor. By
 * default, it should be the one that is the freest, and it should disclaim it,
 * but people should be able to choose a different video editor."
 *
 * Before this, the gateway picked an editor silently and nobody creating a post
 * could see who was about to receive the work, let alone say otherwise.
 *
 * Three properties are pinned here, and the third is the one that will break
 * first if someone edits only one side:
 *
 *   1. The default is genuinely the freest, and it SAYS it is a suggestion.
 *   2. Any editor can be chosen instead.
 *   3. The browser and the gateway count the SAME work. The dialog names a
 *      person and a number and then leaves the default unsent, so a browser
 *      counting different rows from the server would display a suggestion the
 *      server would never have made — and nobody would find out, because both
 *      halves would look correct on their own.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const gateway = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'production-write', 'index.ts'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// ---- 3 first: the two sides must agree on what "open work" is --------------
const browserStatuses = (html.match(/const CAL_NATIVE_LIVE_VIDEO_STATUSES = \[([^\]]*)\]/) || [])[1];
const serverStatuses = (gateway.match(/const INTAKE_LOAD_LIVE_STATUSES = Object\.freeze\(\[([^\]]*)\]\)/) || [])[1];
const normalise = raw => String(raw || '').split(',')
  .map(part => part.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean).sort().join(',');
ok(!!browserStatuses && !!serverStatuses,
  'both sides declare their live-status list as a findable constant');
ok(normalise(browserStatuses) === normalise(serverStatuses),
  `browser and gateway count the same live statuses (${normalise(browserStatuses)} / ${normalise(serverStatuses)})`);
ok(normalise(serverStatuses) === 'in_progress,todo,tweak',
  'and that list is work still owed — not approved, scheduled, posted or terminal work');

// ---- The gateway stopped counting finished work ----------------------------
ok(!/\.neq\("status", "duplicate"\)/.test(gateway),
  'the lifetime tally is gone — it never fell, so it ranked seniority rather than freedom');
ok(/\.in\("status", INTAKE_LOAD_LIVE_STATUSES/.test(gateway),
  'the balancer reads only open video work');

// ---- 2: an override is accepted, validated, and video-only ------------------
ok(/normalizeTeam\(item\.team\) !== "video"/.test(gateway),
  'a graphics override is still refused — that team has one default designer, so there is nothing to choose');
ok(/await assertEligibleAssignee\(supabase, requestedByTeam\[team\], team, nativeEpochByTeam\[team\]\)/.test(gateway),
  'a chosen editor goes through the same eligibility check as every other assignee write');
ok(/intake_assignee_override_conflict/.test(gateway),
  'two items naming different editors is refused before anything is written, not resolved by item order');
{
  const plan = gateway.slice(gateway.indexOf('const assigneeByTeam'), gateway.indexOf('const plannedItems'));
  ok(plan.indexOf('gatewayAssignees.size === 1') < plan.indexOf('requestedByTeam[team]'),
    'a prior attempt still wins over a fresh choice, so a retry cannot move work someone already started');
}

// ---- 1: the default is the freest, and the option says so ------------------
/*
 * THE EXPLANATORY PARAGRAPH IS GONE (owner, 2026-09-08). It used to sit under
 * the picker and restate, in prose, what the option beside it already showed.
 * `_calNativeEditorDisclaimer` went with it -- it had no other caller.
 *
 * What that paragraph existed to guarantee still has to hold, so it is
 * asserted here against the OPTION LABEL, which is now the only place it
 * lives: the suggestion is marked as a suggestion, and the number it was
 * derived from is visible. The 2026-08-25 report -- an SMM reading
 * "Suggested was X, but you have chosen someone else" as a refusal -- is why
 * the paragraph must not quietly come back in another form: an override is
 * accepted by this picker AND by the gateway, and nothing on this surface may
 * imply otherwise.
 */
const editorItems = html.slice(
  html.indexOf('const editorItems = '),
  html.indexOf('const editorPickerHtml'),
);
ok(editorItems.length > 0, 'the option builder is findable (harness is not vacuous)');
ok(/open video'/.test(editorItems) && /open videos'/.test(editorItems),
  'the option carries the open count the suggestion is based on, singular and plural');
ok(/\(suggested\)/.test(editorItems),
  'and marks which one is suggested, so the default is never unexplained');
ok(/editor\.openCount == null \? '' :/.test(editorItems),
  'an unread workload shows no number rather than a zero it did not measure');
ok(!/_calNativeEditorDisclaimer/.test(html),
  'and the removed paragraph left no dead builder behind');
ok(!/cal-native-editor-hint"/.test(html),
  'no paragraph under the picker re-explains the option above it');

const pool = html.slice(
  html.indexOf('async function _calNativeVideoEditorPool('),
  html.indexOf('const CAL_NATIVE_MAX_INTAKE_ITEMS'),
);
/*
 * Caught in review (P1): the pool was built from the shared sign-in roster,
 * which selects id/name/role/team and NOT linear_user_id — while the gateway
 * requires one. An unmapped video editor therefore appeared here, and having
 * no rows assigned to them scored ZERO open videos and sorted FIRST, so the
 * dialog would have suggested exactly the person the gateway can never assign.
 * The pool now applies the gateway's own filter in the query itself.
 */
ok(/team=eq\.video/.test(pool) && /role=eq\.editor/.test(pool),
  'the pool is video editors only — graphics designers are never offered');
ok(/linear_user_id=not\.is\.null/.test(pool),
  'and only editors the gateway can actually assign, matching its linear_user_id requirement');
/* Targets a CALL, not a mention: the comment above this function in index.html
   explains why it stopped using the sign-in roster, and an assertion that
   scanned for the bare name would fail on that explanation. Source pins in
   this repo have been bitten by prose more than once. */
ok(!/_syncviewStaffRoster\(/.test(pool),
  'built from its own eligibility-filtered read, not the sign-in roster projection that lacks that column');
ok(/counts \? Number\(counts\.get/.test(pool) && /openCount: counts \?/.test(pool),
  'a failed load read leaves openCount null rather than pretending everyone has zero work');
ok(/left\.name\.localeCompare\(right\.name\) \|\| left\.id\.localeCompare\(right\.id\)/.test(pool),
  'ties break by name then id — the same order the gateway uses, so both sides pick the same person');

// ---- The read cannot hang the picker open ----------------------------------
/*
 * Also caught in review: an unbounded promise left videoEditorStatus on
 * 'loading' for the life of the dialog if either fetch stalled — picker
 * disabled, Create still enabled, so staff could not choose and the post fell
 * back to server assignment with no way to say otherwise.
 */
ok(/CAL_NATIVE_EDITOR_POOL_TIMEOUT_MS/.test(html)
  && /Promise\.race\(\[\s*\n?\s*_calNativeVideoEditorPool\(\)/.test(html),
  'the pool read is raced against a timeout, so a stall degrades like a failure instead of disabling the picker forever');

// ---- The control is the documented primitive, not an OS menu ---------------
ok(/_svSelectHtml\('calNativeEditor'/.test(html),
  'the picker is the documented sv-select primitive — UI_DESIGN_STANDARDS forbids OS-native menus on branded surfaces');
ok(!/cal-native-editor-select/.test(html),
  'and the native select it replaced is gone, along with its styling');

// ---- The default path stays payload-identical until the gateway ships ------
/*
 * index.html reaches users the moment it merges; production-write is deployed
 * by hand. Between those two moments the live gateway still refuses every
 * intake assignee, so an always-sent choice would fail EVERY video Create Post
 * in that window — for a default that changes nothing.
 */
const submit = html.slice(html.indexOf('const suggestedEditorId ='), html.indexOf('const dueISO = wlAddWorkingDays'));
ok(/chosenEditorId !== suggestedEditorId/.test(submit),
  'the chosen editor is sent ONLY when it differs from the suggestion');
ok(/\(mode === 'video' \|\| mode === 'both'\)/.test(submit),
  'and never on a Thumbnail-only post, which creates no video work to assign');
ok(/\.\.\.\(chosenEditor \? \{ assignee_id: chosenEditor \} : \{\}\)/.test(html),
  'an unchosen editor omits the field entirely, keeping the payload byte-identical to the pre-picker shape');
ok(/video_assignee_id: videoAssigneeId,/.test(html),
  'the choice is part of the idempotency signature — a different editor is a different submission');

// ---- The refusal is explained rather than shown raw ------------------------
ok(/Choosing a different editor is not live on this workspace yet/.test(html),
  'and if the gateway has not been redeployed yet, the person is told what to do about it');

if (failures) {
  console.error(`\n${failures} editor-picker check(s) failed`);
  process.exit(1);
}
console.log('\nnative post editor picker checks passed');
