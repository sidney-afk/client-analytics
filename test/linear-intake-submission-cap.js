'use strict';
/*
 * A REFUSAL THE SERVER CAN NAME, AND A FALLBACK WRITTEN BEFORE IT IS NEEDED.
 *
 * 2026-08-26, from the edge logs: a videographer on the client link was refused
 * eleven times between 19:53 and 20:39, every one a 413 `public_intake_too_large`
 * from `production-write`. His request was 7,743 bytes — nothing was too large
 * except the COUNT. Video+thumbnail mode sends two deliverables per video, so a
 * shoot past twelve videos crosses the 25-item public cap and the gateway
 * refuses the whole submission before writing anything.
 *
 * Two things went wrong, and each has its own half of this file:
 *
 *   1. The form said "Submission was not completed. Your exact request is
 *      saved; retry to resume safely." That names no cause and, worse, its
 *      advice is WRONG here — retrying an oversized submission can only be
 *      refused again, which is exactly what happened eleven times. The count is
 *      known in the browser before anything is sent, so it is said there.
 *
 *   2. The `Linear Submissions` sheet — the fallback the owner reaches for when
 *      a submission does not land — was only appended AFTER the gateway
 *      accepted. The one case that needs a fallback wrote nothing, so the only
 *      copy of the work was in the videographer's own browser.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const gateway = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'production-write', 'index.ts'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// ---- 1. the two numbers are the same number -------------------------------
/* The browser can only warn early by knowing the server's cap, and a mirrored
   constant that drifts is worse than none: it would refuse submissions the
   server would have taken, or promise ones it will not. */
const gatewayCap = (gateway.match(/const MAX_PUBLIC_INTAKE_ITEMS = (\d+);/) || [])[1];
const browserCap = (html.match(/const LINEAR_INTAKE_MAX_ITEMS = (\d+);/) || [])[1];
ok(!!gatewayCap && !!browserCap, 'both caps are findable (harness is not vacuous)');
ok(gatewayCap === browserCap,
  'the form and the gateway agree on the cap (gateway ' + gatewayCap + ', browser ' + browserCap + ')');
ok(/MAX_PUBLIC_INTAKE_ITEMS/.test(html),
  'and the browser copy names the gateway constant it mirrors, so the next reader finds both');

// ---- 2. the message, EXECUTED ---------------------------------------------
const capSrc = html.slice(
  html.indexOf('const LINEAR_INTAKE_MAX_ITEMS ='),
  html.indexOf('\n    }', html.indexOf('function _linearIntakeTooLargeMessage')) + 6);
const scope = new Function(capSrc + '\nreturn { _linearIntakeTooLargeMessage, _linearIntakeItemsPerVideo, LINEAR_INTAKE_MAX_ITEMS };')();

ok(scope._linearIntakeItemsPerVideo('both') === 2,
  'video + thumbnail counts TWO deliverables per video — the whole reason twelve videos is the limit');
ok(scope._linearIntakeItemsPerVideo('video') === 1 && scope._linearIntakeItemsPerVideo('thumbnail') === 1,
  'and a single-team submission counts one');

const bothMessage = scope._linearIntakeTooLargeMessage('both', 30);
ok(/\b30\b/.test(bothMessage), 'the message says how many deliverables the submission actually is');
ok(/\b25\b/.test(bothMessage), 'and what the limit is');
ok(/\b12 videos\b/.test(bothMessage),
  'and converts the limit into the unit the person is working in — videos, not deliverables');
ok(/two per video/.test(bothMessage),
  'and explains WHY twelve, so "but I only added twelve" has an answer');

const videoMessage = scope._linearIntakeTooLargeMessage('video', 26);
ok(/\b25 videos\b/.test(videoMessage),
  'video-only mode gets its own number rather than the both-mode one');
ok(!/two per video/.test(videoMessage),
  'and is not told about a thumbnail it did not ask for');

ok(/[Nn]othing was sent/.test(bothMessage),
  'every version promises nothing was sent — true, because the cap is checked before any write');
ok(!/retry|try again/i.test(bothMessage),
  'and none of them advises a retry, which for this refusal can only fail again');

// ---- 3. it is said BEFORE the request is sent ------------------------------
const submitStart = html.indexOf('const publicIntake = !identity;');
ok(submitStart > -1, 'the pre-flight is present');
const preflight = html.slice(submitStart, submitStart + 500);
ok(/if \(publicIntake && intakeItemCount > LINEAR_INTAKE_MAX_ITEMS\)/.test(preflight),
  'oversized submissions are stopped in the form, not by a round trip');
ok(/_linearIntakeTooLargeMessage\(mode, intakeItemCount\)/.test(preflight),
  'and stopped with the same words the server refusal would produce');
ok(submitStart < html.indexOf('operation: \'intake_create\', surface: \'submission\''),
  'the check runs before the request is even built');
/* Keyed on the same condition the server uses. A signed-in staff submission
   takes the authenticated path, where the cap is MAX_INTAKE_ITEMS (100), so
   applying the public cap to staff would refuse work the server would accept. */
ok(/const publicIntake = !identity;/.test(preflight),
  'the cap applies only to the credential-less link, exactly as the gateway applies it');

// ---- 4. and named if the server is the one that catches it -----------------
ok(/String\(error && error\.code \|\| ''\) === 'public_intake_too_large'/.test(html),
  'a server refusal is recognised by code rather than falling into the generic message');

// ---- 5. the fallback is written FIRST --------------------------------------
const runStart = html.indexOf('async function _runNativeIntakeJob(job)');
const runSrc = html.slice(runStart, html.indexOf('\n    }', runStart));
ok(runStart > -1 && runSrc.includes('PROD_WRITE_EF_URL'),
  'the intake runner is findable and contains the gateway call (harness is not vacuous)');
ok(runSrc.indexOf('_linearIntakeLogSubmissionRequest(job)') > -1
  && runSrc.indexOf('_linearIntakeLogSubmissionRequest(job)') < runSrc.indexOf('fetch(PROD_WRITE_EF_URL'),
  'the submission is logged to the sheet BEFORE the gateway is called — the only ordering that survives a refusal');

const logStart = html.indexOf('function _linearIntakeLogSubmissionRequest(job)');
const logSrc = html.slice(logStart, html.indexOf('\n    }', logStart));
ok(/job\.request_logged/.test(logSrc),
  'one row per job in a page session, so a retry does not append a second');
ok(/\}\)\.catch\(\(\) => \{\}\);/.test(logSrc) && !/await fetch/.test(logSrc),
  'fire-and-forget: the log can never delay or fail a submission that would otherwise succeed');
ok(/try \{/.test(logSrc) && /catch \(error\) \{\}/.test(logSrc),
  'and it is wrapped, so a broken log cannot throw into the submit path');
ok(/items: payload\.items/.test(logSrc) && /batch: payload\.batch/.test(logSrc),
  'the row carries the whole request — the point is that the work can be rebuilt by hand from it');
ok(/request_id: payload\.request_id/.test(logSrc),
  'and the request id, so a duplicate row is recognisable as one');
/* The success telemetry row still follows; this adds a row, it does not
   replace one. */
ok(/source: 'production-write', request_id: job\.payload\.request_id/.test(html),
  'the post-success telemetry row is untouched');

if (failures) {
  console.error(`\n${failures} intake submission-cap check(s) failed`);
  process.exit(1);
}
console.log('\nintake submission cap and sheet fallback checks passed');
