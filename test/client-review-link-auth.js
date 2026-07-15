'use strict';

const fs = require('fs');
const path = require('path');
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
const shareSource = ['copyShareLink', 'smCopyShareLink', 'calCopyShareLink', '_sxrCopyShareLink']
  .map(fn => { const start = index.indexOf('function ' + fn + '('); return index.slice(start, start + 900); })
  .join('\n');
ok(!shareSource.includes('client_review_token'),
  'share-link generation no longer depends on the removed Clients Info token column');
for (const fn of ['copyShareLink', 'smCopyShareLink', 'calCopyShareLink', '_sxrCopyShareLink']) {
  const start = index.indexOf('function ' + fn + '(');
  ok(start >= 0 && index.slice(start, start + 900).includes('_syncviewIssueClientShareUrl'),
    fn + ' uses the secure review-link issuer');
}
ok(/authorizeBrowserWrite\(supabase, req, slug, "client-review-link"\)/.test(issuer)
    && /principal\.kind !== "staff"/.test(issuer),
  'issuer requires a valid staff principal before returning a token');
ok(/\.from\("client_access"\)\.select\("review_token"\)/.test(issuer)
    && /review_token_missing/.test(issuer),
  'issuer reads only the exact current token and fails closed when absent');

if (failures) process.exit(1);
console.log('\nClient review-link auth checks passed');
