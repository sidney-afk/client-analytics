#!/usr/bin/env node
'use strict';
/* Show who runs the client on a SyncLinear sub-issue, without a second copy of
   the roster and without a sign-in dialog.
 *
 * The roster lives in a Google Sheet the owner edits. A nightly n8n job mirrors
 * it into social_media_managers, so the app reads the mirror and never keeps
 * its own list: edit the sheet, and the line follows within a day. That was the
 * owner's actual concern -- "I don't want to hard code which social media
 * manager has which client, because when I change the sheet it wouldn't
 * update."
 *
 * The two things worth pinning are the ones a later edit would plausibly undo.
 */
const fs = require('fs');
const path = require('path');
const { extractFunction, stripNonCode } = require('./helpers/extract-function');
const { stripComments } = require('./helpers/strip-comments');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const EF = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'smm-weekly-reports', 'index.ts'), 'utf8');

let failures = 0;
function ok(cond, msg) {
  console.log((cond ? '  ok  ' : 'FAIL  ') + msg);
  if (!cond) failures++;
}

/* Two views, and which one an assertion reads matters.
   stripNonCode blanks comments AND string contents, so it is what a "does NOT
   mention X" assertion must read -- the comments below explain exactly which
   helpers this deliberately avoids, and asserting against prose would fail on
   the explanation. Assertions that are ABOUT a string literal have to read the
   raw source, because stripNonCode has blanked the very text they check. */
const loader = extractFunction(INDEX, '_prodLoadSmmDirectory');
const card = extractFunction(INDEX, '_prodSmmCardHTML');
const props = extractFunction(INDEX, '_prodProps');
const loaderCode = stripNonCode(loader);
const cardCode = stripNonCode(card);
/* Markup lives in STRING LITERALS, and stripNonCode blanks those -- so a
   negative assertion about emitted HTML must not read cardCode: neither
   `title="` nor `data-prod-tip` can ever appear there, and the check could
   never fail. stripComments removes prose and KEEPS the literals, which is
   the only view that can actually see the markup. Codex on PR 1271, and the
   same could-not-fail class as OPEN_REPAIRS 144. */
const cardMarkup = stripComments(card, ' ');
const dirFromCode = stripNonCode(extractFunction(INDEX, '_prodSmmDirFrom'));
const efCode = stripNonCode(EF);

/* ---- 1. It must never be the reason a sign-in dialog opens -------------- */

ok(!/_srpApi/.test(loaderCode),
  'the loader does not go through _srpApi — that wrapper calls _syncviewRequireStaffIdentity, which OPENS a sign-in dialog when the viewer has no key, and a passive line in a properties column must never do that');
ok(!/_syncviewRequireStaffIdentity|_syncviewOpenStaffIdentity|_syncviewOfferStaffSignIn/.test(loaderCode),
  'and it reaches for no other prompting helper either');
ok(/_syncviewStaffIdentityForHeaders\(\)/.test(loaderCode) && /if \(!ident/.test(loaderCode),
  'it reads an identity that already exists and returns silently when there is none');
ok(/_syncviewStaffCan\('weekly-report-submit'\)/.test(loader),
  'and it checks the capability rather than discovering it as a 403');

/* ---- 2. It must not weaken the endpoint to get the data ---------------- */

ok(/'X-Syncview-Key': ident\.key/.test(loader),
  'the request is signed with the staff key, so ?action=options stays Admin/SMM');
ok(!/social_media_managers/.test(loaderCode),
  'the browser does not read social_media_managers directly — F88 revoked that anon grant on purpose, and a manager roster is not worth undoing it for');

/* ---- 3. The roster is derived, never held ------------------------------ */

ok(/wlNormalizeClient/.test(dirFromCode),
  'sheet client names and app slugs are matched through one normalizer, not a hand-kept mapping');
ok(!/\{\s*['"][a-z0-9]+['"]\s*:\s*['"][A-Z]/.test(card + loader),
  'no client-to-manager pairs are written into the app — the whole point is that the sheet stays the source of truth');
/* ---- 3b. It makes no unprompted staff read the tab cannot afford -------- */

ok(/_srpState\.managersLoaded\)/.test(loaderCode)
  && loaderCode.indexOf('_srpState.managersLoaded') < loaderCode.indexOf('_syncviewStaffIdentityForHeaders'),
  'an already-loaded roster is used BEFORE any request is considered — the Production tab makes no unprompted staff-authenticated read, and one that can 401 is counted as a failed read by its own console audit');
ok(/_srpState\.managersLoaded = true/.test(stripNonCode(INDEX.slice(INDEX.indexOf('async function _srpLoadOptions'), INDEX.indexOf('async function _srpLoadOptions') + 600))),
  'and the weekly-reports page primes that cache, so the two surfaces answer from one roster rather than fetching twice');

/* ---- 3c. Admin/SMM data must not outlive the identity that fetched it --- */

const purge = stripNonCode(extractFunction(INDEX, '_prodSmmPurgeSensitiveState'));
ok(/_prodSmmDir = null/.test(purge) && /managersLoaded = false/.test(purge),
  'a purge drops both the directory and the shared roster');
ok(/_prodSmmPurgeSensitiveState/.test(stripNonCode(extractFunction(INDEX, '_syncviewStaffPurgeSensitiveState'))),
  'and the sign-out/account-switch purge actually calls it — otherwise an Admin signs out and the next reader still sees a client-to-manager assignment their identity could not have fetched');

/* ---- 3d. Bounded: neither an answer nor a failure is cached forever ----- */

ok(/PROD_SMM_TTL_MS/.test(loaderCode) && /Date\.now\(\) - _prodSmmDirAt/.test(loaderCode),
  'the directory expires — cached forever would make "the line follows within a day" quietly require a page reload');
ok(/_prodSmmFailures\+\+/.test(loaderCode) && !/_prodSmmDir = new Map\(\);\s*$/m.test(loaderCode),
  'a failed read is counted and retried rather than cached as an answer, so one transient 401 does not hide the row for the session');
ok(/_prodSmmFailures >= PROD_SMM_MAX_FAILURES/.test(loaderCode),
  'and it gives up after a bounded number of failures, because a key the endpoint keeps refusing will not start working');

/* ---- 3e. The staleness signal must reach a keyboard and a phone -------- */

ok(!/data-prod-smm-provenance/.test(card),
  'the card carries no provenance line — the owner asked for it removed, twice; the name is the answer the reader came for and a second line of bookkeeping under every sub-issue is noise');
ok(!/data-prod-tip|title="/.test(cardMarkup),
  'and it carries no tooltip either, so the provenance cannot come back as a title attribute — the Production tooltip layer is mouseover-only, which reaches neither a keyboard nor a phone (Codex on PR 1265)');

/* ---- 4. It renders under Project, and only with an answer -------------- */

ok(props.indexOf('_prodSmmCardHTML(d)') > props.indexOf('data-prod-detail-card="project"'),
  'the card renders BELOW the Project card, which is where the owner asked for it');
ok(/if \(!hit\) return/.test(cardCode) && /if \(!_prodSmmDir \|\| !_prodSmmDir\.size\) return/.test(cardCode),
  'and renders nothing at all when the manager is unknown — an empty row would be a worse answer than no row');

/* ---- 5. The endpoint actually returns what the line needs -------------- */

ok(/\.select\("slug,name,email,active,source_clients,synced_at"\)/.test(EF),
  'loadOptions selects source_clients and synced_at');
ok(/source_clients: Array\.isArray\(row\.source_clients\)/.test(efCode) && /synced_at: row\.synced_at/.test(efCode),
  'and serializeManager hands both back — they were stored all along and never returned, which is why this could not be answered before');
ok(/authorizeStaffKey\(given, \["admin", "smm"\]/.test(EF),
  'the endpoint keeps its Admin/SMM audience — this change adds fields, not access');

if (failures) { console.log('\n' + failures + ' check(s) failed.'); process.exit(1); }
console.log('\nproduction SMM line checks passed');
