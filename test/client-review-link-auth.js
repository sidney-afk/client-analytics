'use strict';

const fs = require('fs');
const path = require('path');
const { extractFunction } = require('./helpers/extract-function.js');
const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const issuer = fs.readFileSync(path.join(root, 'supabase/functions/client-review-link/index.ts'), 'utf8');
let failures = 0;
const ok = (value, message) => value ? console.log('  ok  ' + message) : (failures++, console.error('FAIL  ' + message));

ok(/function _syncviewClientWriteToken\(\)[\s\S]{0,180}\.get\('t'\)/.test(index),
  'client writes source their bearer token from the current ?t= URL parameter');
ok(/if \(token\) out\['X-Syncview-Client-Token'\] = token/.test(index),
  'a valid ?t= value is attached to protected client writes');
ok(/CLIENT_REVIEW_LINK_URL[\s\S]{0,2600}json\.token/.test(index),
  'share links obtain the current token from the private issuer');
// Scoped by the extractor, not a 900-character window: _sxrCopyShareLink is 478
// characters long, so the old window read 422 characters of the next function.
const SHARE_FNS = ['copyShareLink', 'smCopyShareLink', 'calCopyShareLink', '_sxrCopyShareLink'];
const shareBody = fn => { try { return extractFunction(index, fn); } catch (e) { return ''; } };
ok(!SHARE_FNS.map(shareBody).join('\n').includes('client_review_token'),
  'share-link generation no longer depends on the removed Clients Info token column');
for (const fn of SHARE_FNS) {
  ok(shareBody(fn).includes('_syncviewIssueClientShareUrl'),
    fn + ' uses the secure review-link issuer');
}
ok(/authorizeBrowserWrite\(supabase, req, slug, "client-review-link"\)/.test(issuer)
    && /principal\.kind !== "staff"/.test(issuer),
  'issuer requires a valid staff principal before returning a token');
ok(/\.from\("client_access"\)\.select\("review_token"\)/.test(issuer)
    && /review_token_missing/.test(issuer),
  'issuer reads only the exact current token and still fails closed when it cannot read one back');
// A client onboarded after the one-time B0 seed has no client_access row, so
// the read above finds nothing and the share button used to dead-end there.
// The issuer now mints that one missing token — and only that one.
ok(/reviewTokenAction/.test(issuer) && /provisionReviewToken/.test(issuer),
  'issuer provisions a missing token for an already-authorized active client');
ok(issuer.indexOf('principal.kind !== "staff"') < issuer.indexOf('const stored = await readAccessRow')
    && issuer.indexOf('client.active !== true') < issuer.indexOf('const stored = await readAccessRow'),
  'provisioning is gated behind the staff principal and the active-client check');
ok((issuer.match(/\.update\(/g) || []).length === 1
    && /repair\.eq\("review_token", decision\.staleToken\)/.test(issuer),
  'the sole update is guarded on a blank token, so a live client link is never rotated');

if (failures) process.exit(1);
console.log('\nClient review-link auth checks passed');
