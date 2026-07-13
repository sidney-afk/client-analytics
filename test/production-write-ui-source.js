'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let failures = 0;
function ok(value, label) {
  if (value) console.log('  ok  ' + label);
  else { failures++; console.error('FAIL  ' + label); }
}
function extract(name) {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`missing ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unclosed ${name}`);
}

const context = {
  identity: { role: 'smm', member: { team: null } },
  clientKind: 'video',
  _prodState: { authority: { video: 'linear', graphics: 'syncview' } },
};
context._syncviewStaffIdentityForHeaders = () => context.identity;
context._prodClient = () => ({ raw: { active: true, kind: context.clientKind } });
vm.createContext(context);
vm.runInContext([
  extract('_prodAuthorityValue'),
  extract('_prodWriteTeam'),
  extract('_prodTestWriteOverride'),
  extract('_prodRoleCanWrite'),
  extract('_prodCanWrite'),
].join('\n'), context);

const video = { id: 'v', team: 'video', project: 'client' };
const graphics = { id: 'g', team: 'graphics', project: 'client' };
ok(context._prodAuthorityValue({ video: 'linear', graphics: 'syncview' }).graphics === 'syncview', 'strict authority parser accepts the two known team stances');
ok(context._prodAuthorityValue({ video: 'linear' }) === null
  && context._prodAuthorityValue({ video: 'linear', graphics: 'other' }) === null
  && context._prodAuthorityValue(null) === null,
'missing, malformed, or unknown authority fails closed');
ok(context._prodCanWrite(video, 'status') === false && context._prodCanWrite(graphics, 'status') === true,
'team controls follow independent video/graphics authority stances');
context.clientKind = 'test';
ok(context._prodCanWrite(video, 'status') === true, 'active TEST clients can exercise the pre-flip browser override');
context.clientKind = 'video';
context.identity = { role: 'creative', member: { team: 'video' } };
ok(context._prodCanWrite(video, 'status') === false, 'authority still blocks an otherwise compatible creative');
context._prodState.authority.video = 'syncview';
ok(context._prodCanWrite(video, 'status') === true
  && context._prodCanWrite(video, 'comment') === true
  && context._prodCanWrite(video, 'due') === false
  && context._prodCanWrite(graphics, 'comment') === false,
'creative access is own-team status/comment only; due, assignee, and cross-team remain closed');
context.identity = null;
ok(context._prodCanWrite(video, 'status') === false, 'missing verified staff identity fails closed');

ok(/PROD_WRITE_EF_URL\s*=\s*CAL_SUPABASE_URL \+ '\/functions\/v1\/production-write'/.test(source), 'browser uses the one authenticated Production write gateway');
ok(/operation,\s*surface: 'production',\s*entity: 'deliverable',\s*id: issue\.id/.test(source), 'gateway envelope pins Production surface and native deliverable identity');
ok(/payload\.expected_updated_at = issue\.updatedRaw/.test(source)
  && /payload\.expected_status = issue\.sourceStatus/.test(source),
'scalar writes carry current-row CAS and status transitions carry current status');
ok(/headers: _syncviewEfHeaders\(\{[\s\S]{0,320}\}, PROD_WRITE_EF_URL\)/.test(source), 'verified staff role key and roster actor are attached by the shared EF header path');
ok(/if \(_prodTestWriteOverride\(issue\)\) payload\.test_override = true/.test(source)
  && !/legacy_parity\s*=|legacy_parity:/.test(source.slice(source.indexOf('async function _prodGatewayWrite'), source.indexOf('async function _prodRunPickerWrite'))),
'TEST override is derived from the target client and Production never requests legacy parity');
ok(/json\.native_committed !== true/.test(source) && /_prodApplyGatewayRow\(json\.row\)/.test(source), 'UI accepts success only after the gateway proves a native commit');
ok(/team_is_linear_authoritative[\s\S]{0,220}_prodRefreshAuthority/.test(source), 'a stale-tab authority rejection immediately refreshes the local stance');
ok(/setInterval\([\s\S]{0,220}_prodRefreshAuthority\(\{ silent: true \}\)[\s\S]{0,80}30000/.test(source)
  && /_prodRefreshAuthority\(\{ silent: true \}\);\s*_prodLoadData/.test(source),
'open tabs re-read authority on a bounded timer and every focus/refresh path');
ok(/kind === 'assign' \? 'assignee' : kind/.test(source)
  && /PROD_STATUS_FROM_ARTIFACT\[value\]/.test(source)
  && /_prodDueIso\(value\)/.test(source),
'status, assignee, and ISO due-date pickers route through gateway operations');
ok(/editors\[k\]\.active !== false[\s\S]{0,120}editors\[k\]\.raw\.team/.test(source), 'assignee choices are active and scoped to the deliverable team');
ok(/data-prod-comment-form/.test(source)
  && /audience: draft\.audience/.test(source)
  && /maxlength="20000"/.test(source),
'native composer sends bounded body plus explicit internal/client audience');
ok(/if \(draft\.body !== body\) draft\.requestId = ''/.test(source)
  && /if \(!draft\.requestId\) draft\.requestId = _prodWriteRequestId\('comment'\)/.test(source),
'an ambiguous comment retry keeps one request id until the semantic draft changes');
ok(!/localStorage[\s\S]{0,100}commentDrafts|commentDrafts[\s\S]{0,100}localStorage/.test(source), 'comment drafts remain memory-only');
ok(/code === 'write_conflict'/.test(source) && /Current values were reloaded/.test(source), 'conflicts surface the reloaded-current-row retry path');
ok(/data-prod-write=\\?"/.test(source) && /aria-disabled=\\?"/.test(source), 'write controls expose their gated state to styling and accessibility');

if (failures) {
  console.error(`\n${failures} Production write UI check(s) failed`);
  process.exit(1);
}
console.log('\nProduction write UI checks passed');
