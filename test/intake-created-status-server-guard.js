'use strict';
/*
 * Work that has just been created has not been started — enforced on the SERVER.
 *
 * WHAT THIS FIXES (2026-08-24, OPEN_REPAIRS item 35). PR #1073 established this
 * rule on 2026-08-17, after an editor reported sub-issues arriving already
 * "In Progress" that he had never touched. It fixed four BROWSER call sites and
 * stopped there, and its own comment promised the gateway's matching default
 * would be "corrected in the gateway on the next deploy". Three deploys later
 * it had not been, and a second person reported the identical symptom: 30 rows
 * born started, from a tab still holding pre-#1073 code.
 *
 * The lesson this file encodes: a client-side default is a suggestion. This app
 * is a single 4.6 MB `index.html` that people leave open for days, so "every UI
 * path sends it explicitly" is only true of UI paths that have been RELOADED.
 * An invariant about what the data may contain has to live where it cannot be
 * out of date, which is the server.
 *
 * The behaviour is NORMALISE, not refuse (owner decision the same day): a
 * submission is often someone's whole shoot, and refusing it mid-flight to
 * punish a stale tab costs a person real work to fix something they cannot see.
 * The correction is COUNTED in the response so a stale client stays visible.
 */
const fs = require('node:fs');
const path = require('node:path');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const ROOT = path.join(__dirname, '..');
const gateway = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'production-write', 'index.ts'), 'utf8');
const browser = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// ---- The rule exists on the server, and says todo ---------------------------
ok(/const INTAKE_CREATED_STATUS = "todo";/.test(gateway),
  'the gateway has its own created-status constant, and it is todo');
ok(/const STARTED_STATUSES_AT_CREATE = new Set\(\["in_progress"\]\);/.test(gateway),
  'and names the statuses that mean "already started" rather than testing a string inline');

// ---- The old default is GONE, which is the actual regression risk -----------
ok(!/lower\(item\.status \|\| "in_progress"\)/.test(gateway),
  'no intake path still defaults an absent status to in_progress — the exact line #1073 left behind');
ok(!/\|\| "in_progress"\)/.test(gateway),
  'and in_progress is not the fallback of any remaining expression in this gateway');

// ---- Normalise, not refuse --------------------------------------------------
const helper = gateway.slice(
  gateway.indexOf('function intakeCreateStatus('),
  gateway.indexOf('const PUBLIC_INTAKE_FLAG'),
);
ok(/return INTAKE_CREATED_STATUS;/.test(helper),
  'a started status at create is CORRECTED, so the submission still succeeds');
ok(!/throw new GatewayError/.test(helper),
  'and never refused — refusing costs the submitter their whole shoot for something they cannot see');
ok(/counter\.normalized \+= 1;/.test(helper),
  'every correction is counted, so a stale client is visible rather than silently accommodated');

// ---- The TEST drill keeps its deliberate started state ----------------------
ok(/if \(testOnly \|\| !STARTED_STATUSES_AT_CREATE\.has\(status\)\) return status;/.test(helper),
  'the TEST path is exempt — the drill creates started work on purpose');
ok(/intakeCreateStatus\(item\.status, principal\.testOnly, startedAtCreate\)/.test(gateway),
  'and the exemption is driven by the authenticated principal, never by a caller-supplied field');

// ---- The count reaches the caller ------------------------------------------
const responses = (gateway.match(/started_at_create_normalized: startedAtCreate\.normalized,/g) || []).length;
ok(responses === 2,
  `both intake responses report the count (found ${responses}) — the create path and the append path`);

// ---- The browser rule is unchanged, and the two agree ----------------------
ok(/const PROD_CREATED_STATUS = 'todo';/.test(browser),
  'the browser still sends todo, so the server correction is a backstop and not the primary path');
const browserValue = (browser.match(/const PROD_CREATED_STATUS = '([a-z_]+)';/) || [])[1];
const serverValue = (gateway.match(/const INTAKE_CREATED_STATUS = "([a-z_]+)";/) || [])[1];
ok(browserValue && browserValue === serverValue,
  `client and server agree on the created status (${browserValue} / ${serverValue}) — two copies that must not drift`);

if (failures) {
  console.error(`\n${failures} intake created-status guard check(s) failed`);
  process.exit(1);
}
console.log('\nintake created-status server guard checks passed');
