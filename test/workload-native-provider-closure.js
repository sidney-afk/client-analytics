'use strict';
/*
 * Lane A. The Workload board's READ path no longer touches Linear.
 *
 * This is a REACHABILITY test, not a grep for a string. The legacy loader,
 * its snapshot, its silent refetch and its watermark check all still exist in
 * the file -- deleting them is work item A9 and it is blocked on an owner
 * decision about the CON/STR legacy arm -- so a plain "the webhook constant is
 * gone" assertion would be false, and a plain "the constant is present" one
 * would prove nothing. What matters is that nothing CALLS them.
 *
 * The distinction is the whole point of the lane. `public.workload_issues` does
 * not empty when Linear access ends; the n8n reconcile returns [] on a bad read
 * and its safety gate keeps the old rows, so the table FREEZES with ~2,000 rows
 * still marked active and a synced_at that stops advancing. A board that
 * quietly kept one live read into that world would look correct for days.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractFunction } = require('./helpers/extract-function');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };

// Count identifier occurrences outside the retained-but-dead legacy bodies.
const LEGACY = ['_wlLegacyLoadLinearIssues', '_wlLegacyLoadSnapshot',
  '_wlLegacyRefetchSilent', '_wlLegacyCheckWatermark'];
let live = html;
for (const name of LEGACY) live = live.split(extractFunction(html, name)).join('');

// --- 1. the retired legacy loaders are unreachable, not merely unused --------
for (const name of LEGACY) {
  const calls = live.split(name + '(').length - 1;
  ok(calls === 0, `${name} has no reachable caller (it is retained for A9, not wired)`);
}

// --- 2. the n8n Workload source is not reachable from live code -------------
ok(!/LINEAR_ISSUES_WEBHOOK/.test(live.replace(/const LINEAR_ISSUES_WEBHOOK[^\n]*\n/, '')),
  'the linear-issues webhook is referenced only by the dead legacy loader');

// --- 3. the live loader is the native snapshot, and it fetches one URL ------
const loader = extractFunction(html, 'loadLinearIssues');
ok(/return wlFetchNativeSnapshot\(\);/.test(loader),
  'loadLinearIssues delegates to the native snapshot for every caller, forced or not');
ok(!/fetch\(/.test(loader),
  'the retained public symbol performs no transport of its own');

const snapshot = extractFunction(html, 'wlFetchNativeSnapshot');
const urls = [...snapshot.matchAll(/fetch\(\s*([A-Za-z_$][\w$]*)/g)].map(m => m[1]);
assert.deepEqual([...new Set(urls)], ['WORKLOAD_PLAN_URL'],
  'the native snapshot fetches workload-plan and nothing else');
checks++;
ok(/action: 'native_snapshot'/.test(snapshot),
  'and it asks for the versioned native snapshot action by name');

// --- 4. the one provider read it CAN still make is the explicit legacy arm --
// wlFetchForeignLinearMetadata is reached only for rows the snapshot itself
// labelled `legacy`, whose team resolves to VID/GRA, i.e. a team still on
// provider authority. Under {video:syncview, graphics:syncview} that set is
// empty. This asserts the gate, not the emptiness -- the emptiness is a live
// fact this lane could not read.
ok(/issue\.workloadSource === 'legacy'/.test(snapshot)
  && /wlFetchForeignLinearMetadata/.test(snapshot),
  'the only remaining provider read is gated on a row the SERVER called legacy');
ok(snapshot.indexOf("workloadSource === 'legacy'") < snapshot.indexOf('wlFetchForeignLinearMetadata'),
  'the gate is evaluated before the read, not alongside it');

// --- 5. the plan-day write goes native ---------------------------------------
ok(/action: 'native_snapshot'/.test(html) && /workload_native_plan/.test(
    fs.readFileSync(path.join(root, 'supabase/functions/workload-plan/index.ts'), 'utf8')),
  'the plan gateway writes through the native alias RPCs');

console.log(`PASS workload native provider closure: ${checks} focused checks.
NOTE, deliberately not asserted: the Tweak Needed popover (wlFetchTweakComments,
index.html ~19270-19600) still reads the linear-tweak-comments n8n webhook. That
block is lane D's exclusive region and lane A did not edit it; see OPEN_REPAIRS
169. Until lane D lands, "zero Linear requests from Workload" is true of the
board's population, status, assignee, weight, deadline and plan-day surface, and
NOT of the feedback popover.`);
