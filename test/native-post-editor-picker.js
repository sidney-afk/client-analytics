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
ok(/await assertEligibleAssignee\(supabase, requestedByTeam\[team\], team\)/.test(gateway),
  'a chosen editor goes through the same eligibility check as every other assignee write');
ok(/intake_assignee_override_conflict/.test(gateway),
  'two items naming different editors is refused before anything is written, not resolved by item order');
{
  const plan = gateway.slice(gateway.indexOf('const assigneeByTeam'), gateway.indexOf('const plannedItems'));
  ok(plan.indexOf('gatewayAssignees.size === 1') < plan.indexOf('requestedByTeam[team]'),
    'a prior attempt still wins over a fresh choice, so a retry cannot move work someone already started');
}

// ---- 1: the default is the freest, and it is disclaimed --------------------
const disclaimer = html.slice(
  html.indexOf('function _calNativeEditorDisclaimer('),
  html.indexOf('const CAL_NATIVE_MAX_INTAKE_ITEMS'),
);
ok(/has the least on right now/.test(disclaimer),
  'the disclaimer names the person and why they were chosen');
ok(/suggestion/.test(disclaimer),
  'and calls it a suggestion in words, which is what the owner asked to be disclaimed');
ok(/you have chosen someone else/.test(disclaimer),
  'and changes its wording once the suggestion has been overridden, rather than still claiming the default');
ok(/Current workloads could not be read/.test(disclaimer),
  'an unranked list says so instead of presenting an alphabetical first as if it were the freest');

const pool = html.slice(
  html.indexOf('async function _calNativeVideoEditorPool('),
  html.indexOf('function _calNativeEditorDisclaimer('),
);
ok(/=== 'video'/.test(pool) && /=== 'editor'/.test(pool),
  'the pool is video editors only — graphics designers are never offered');
ok(/counts \? Number\(counts\.get/.test(pool) && /openCount: counts \?/.test(pool),
  'a failed load read leaves openCount null rather than pretending everyone has zero work');
ok(/left\.name\.localeCompare\(right\.name\) \|\| left\.id\.localeCompare\(right\.id\)/.test(pool),
  'ties break by name then id — the same order the gateway uses, so both sides pick the same person');

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
