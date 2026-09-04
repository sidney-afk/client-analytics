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

ok(/wlNormalizeClient/.test(loaderCode),
  'sheet client names and app slugs are matched through one normalizer, not a hand-kept mapping');
ok(!/\{\s*['"][a-z0-9]+['"]\s*:\s*['"][A-Z]/.test(card + loader),
  'no client-to-manager pairs are written into the app — the whole point is that the sheet stays the source of truth');
ok(/_prodSmmDir = new Map\(\)/.test(loaderCode) && /_prodSmmLoading = false/.test(loaderCode),
  'a failed read caches an empty directory rather than retrying inside the render loop');

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
