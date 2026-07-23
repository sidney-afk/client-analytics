'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const edge = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/production-write/index.ts'), 'utf8');
let failures = 0;
function ok(value, label) {
  if (value) console.log('  ok  ' + label);
  else { failures++; console.error('FAIL  ' + label); }
}
function extract(name) {
  const match = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
  if (!match) throw new Error(`missing ${name}`);
  const start = match.index;
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
context._calEscAttr = value => String(value || '');
context._prodTeamLabel = value => value === 'graphics' ? 'Graphics' : 'Video';
context._syncviewStaffIdentityForHeaders = () => context.identity;
context._prodClient = () => ({ raw: { active: true, kind: context.clientKind } });
vm.createContext(context);
vm.runInContext([
  extract('_prodAuthorityValue'),
  extract('_prodWriteTeam'),
  extract('_prodAttributionResolved'),
  extract('_prodAttributionGateText'),
  extract('_prodTestWriteOverride'),
  extract('_prodRoleCanWrite'),
  extract('_prodCanWrite'),
  extract('_prodWriteGateText'),
  extract('_prodWriteGateAttrs'),
].join('\n'), context);

const video = { id: 'v', team: 'video', project: 'client', authorityProject: 'client', attribution: { state: 'resolved' } };
const graphics = { id: 'g', team: 'graphics', project: 'client', authorityProject: 'client', attribution: { state: 'resolved' } };
ok(context._prodAuthorityValue({ video: 'linear', graphics: 'syncview' }).graphics === 'syncview', 'strict authority parser accepts the two known team stances');
ok(context._prodAuthorityValue({ video: 'linear' }) === null
  && context._prodAuthorityValue({ video: 'linear', graphics: 'other' }) === null
  && context._prodAuthorityValue(null) === null,
'missing, malformed, or unknown authority fails closed');
ok(context._prodCanWrite(video, 'status') === false && context._prodCanWrite(graphics, 'status') === true,
'team controls follow independent video/graphics authority stances');
context.clientKind = 'test';
ok(context._prodCanWrite(video, 'status') === true, 'active TEST clients reach the fail-closed pre-flip browser override boundary');
const provisionalTest = { id: 'p', team: 'video', project: 'client', attribution: { state: 'provisional_child_family' } };
ok(context._prodCanWrite(provisionalTest, 'status') === false
  && context._prodTestWriteOverride(provisionalTest) === false
  && /provisional/.test(context._prodWriteGateText(provisionalTest, 'status')),
'provisional/repair attribution stays fail-closed and cannot inherit the TEST override');
context.clientKind = 'video';
context.identity = { role: 'creative', member: { team: 'video' } };
ok(context._prodCanWrite(video, 'status') === false, 'authority still blocks an otherwise compatible creative');
context._prodState.authority.video = 'syncview';
ok(context._prodCanWrite(video, 'status') === true
  && context._prodCanWrite(video, 'comment') === true
  && context._prodCanWrite(video, 'due') === false
  && context._prodCanWrite(video, 'labels') === false
  && context._prodCanWrite(graphics, 'comment') === false,
'creative access is own-team status/comment only; labels, due, assignee, and cross-team remain closed');
context.identity = null;
ok(context._prodCanWrite(video, 'status') === false, 'missing verified staff identity fails closed');
const deniedAttrs = context._prodWriteGateAttrs(video, 'due', { tip: 'Set due date' });
ok(deniedAttrs.includes('data-prod-write="off"')
  && deniedAttrs.includes('aria-disabled="true"')
  && deniedAttrs.includes('title="Sign in with your staff account to write."')
  && deniedAttrs.includes('data-prod-tip="Sign in with your staff account to write."'),
'signed-out controls expose the exact staff sign-in lock to styling, accessibility, and tooltips');
context.identity = { role: 'smm', member: { team: null } };
context._prodState.authority.video = 'syncview';
const allowedAttrs = context._prodWriteGateAttrs(video, 'assignee', { title: 'Alex Editor', tip: 'Assignee: Alex Editor' });
ok(allowedAttrs.includes('data-prod-write="on"')
  && allowedAttrs.includes('aria-disabled="false"')
  && allowedAttrs.includes('title="Alex Editor"')
  && allowedAttrs.includes('data-prod-tip="Assignee: Alex Editor"'),
'writable controls preserve their allowed-state title and tooltip copy');

ok(/PROD_WRITE_EF_URL\s*=\s*CAL_SUPABASE_URL \+ '\/functions\/v1\/production-write'/.test(source), 'browser uses the one authenticated Production write gateway');
ok(/operation,\s*surface: 'production',\s*entity: 'deliverable',\s*id: issue\.id/.test(source), 'gateway envelope pins Production surface and native deliverable identity');
ok(/payload\.expected_updated_at = issue\.updatedRaw/.test(source)
  && /payload\.expected_status = issue\.sourceStatus/.test(source),
'scalar writes carry current-row CAS and status transitions carry current status');
ok(/headers: _syncviewEfHeaders\(\{[\s\S]{0,320}\}, PROD_WRITE_EF_URL\)/.test(source), 'verified staff role key and roster actor are attached by the shared EF header path');
const corsBlock = (edge.match(/"Access-Control-Allow-Headers":\s*\[([\s\S]*?)\]\.join\("[, ]+"\)/) || [])[1] || '';
const allowedHeaders = new Set(Array.from(corsBlock.matchAll(/"([^"]+)"/g), match => match[1].toLowerCase()));
const callerHeaders = new Set();
const productionWriteCallers = [
  ['_writeUiGatewayPost', 'WRITE_UI_PRODUCTION_WRITE_URL'],
  ['_writeUiReadRepairReceipt', 'WRITE_UI_PRODUCTION_WRITE_URL'],
  ['_runNativeIntakeJob', 'PROD_WRITE_EF_URL'],
  ['_prodGatewayWrite', 'PROD_WRITE_EF_URL'],
];
let parsedProductionWriteCallers = 0;
for (const [name, urlConstant] of productionWriteCallers) {
  const body = extract(name);
  const pattern = new RegExp(`headers:\\s*_syncviewEfHeaders\\(\\{([\\s\\S]*?)\\}\\s*,\\s*${urlConstant}\\)`);
  const object = (body.match(pattern) || [])[1] || '';
  if (object) parsedProductionWriteCallers++;
  for (const match of object.matchAll(/(?:^|[,\n])\s*(?:['"]([^'"]+)['"]|([A-Za-z][A-Za-z0-9-]*))\s*:/g)) {
    callerHeaders.add(String(match[1] || match[2]).toLowerCase());
  }
}
for (const match of extract('_syncviewEfHeaders').matchAll(/out\[['"]([^'"]+)['"]\]\s*=/g)) {
  callerHeaders.add(match[1].toLowerCase());
}
ok(parsedProductionWriteCallers === productionWriteCallers.length,
  'the CORS contract enumerates every SPA production-write caller');
ok(callerHeaders.size > 0 && Array.from(callerHeaders).every(header => allowedHeaders.has(header)),
  'production-write CORS allows every explicit header added by all SPA callers and the shared credential helper');
ok(callerHeaders.has('x-syncview-source') && allowedHeaders.has('x-syncview-source'),
  'write-UI source attribution survives browser preflight');
ok(/if \(_prodTestWriteOverride\(issue\)\) payload\.test_override = true/.test(source)
  && !/legacy_parity\s*=|legacy_parity:/.test(source.slice(source.indexOf('async function _prodGatewayWrite'), source.indexOf('async function _prodRunPickerWrite'))),
'TEST override is derived from the target client and Production never requests legacy parity');
ok(/json\.native_committed !== true/.test(source) && /_prodApplyGatewayRow\(json\.row\)/.test(source), 'UI accepts success only after the gateway proves a native commit');
ok(/operation === 'due' && json\.row && typeof wlPublishNativeDueReceipt === 'function'[\s\S]{0,100}wlPublishNativeDueReceipt\(json\.row\)/.test(extract('_prodGatewayWrite')),
'an exact Production due receipt broadcasts through the same native sibling-tab convergence signal as Workload');
ok(/team_is_linear_authoritative[\s\S]{0,220}_prodRefreshAuthority/.test(source), 'a stale-tab authority rejection immediately refreshes the local stance');
ok(/setInterval\([\s\S]{0,220}_prodRefreshAuthority\(\{ silent: true \}\)[\s\S]{0,80}30000/.test(source)
  && /_prodRefreshAuthority\(\{ silent: true \}\);\s*_prodLoadData/.test(source),
'open tabs re-read authority on a bounded timer and every focus/refresh path');
ok(/kind === 'assign' \? 'assignee' : kind/.test(source)
  && /PROD_STATUS_FROM_ARTIFACT\[value\]/.test(source)
  && /_prodDueIso\(value\)/.test(source),
'status, assignee, and ISO due-date pickers route through gateway operations');
ok(/action: 'labels_read', surface: 'production', id/.test(source)
  && /json\.complete !== true/.test(extract('_prodEnsureLabels'))
  && /selected_label_ids/.test(extract('_prodAdoptLabelPayload'))
  && /selected_labels/.test(extract('_prodAdoptLabelPayload')),
'labels use a protected complete catalog/selection read and reject partial state');
ok(/const verificationEpoch = _syncviewStaffVerificationEpoch/.test(extract('_prodEnsureLabels'))
  && /const requestToken = _prodNextLabelRequestToken\(id\)/.test(extract('_prodEnsureLabels'))
  && (extract('_prodEnsureLabels').match(/if \(!requestStillCurrent\(\)\) return null;/g) || []).length === 2,
'label reads discard stale responses and errors after sign-out or a newer same-issue read');
ok(/const verificationEpoch = _syncviewStaffVerificationEpoch/.test(extract('_prodRunLabelsWrite'))
  && /const requestToken = _prodNextLabelRequestToken\(id\)/.test(extract('_prodRunLabelsWrite'))
  && /if \(!json\) \{[\s\S]*current\.saving = false;[\s\S]*_prodEnsureLabels\(id, true\)/.test(extract('_prodRunLabelsWrite'))
  && /if \(!requestStillCurrent\(\)\) \{[\s\S]*if \(identityStillCurrent\(\)\) _prodEnsureLabels\(id, true\)/.test(extract('_prodRunLabelsWrite')),
'label write acknowledgements cannot repopulate state after identity or request generation changes');
ok(/_prodState\.writes\.has\(id \+ ':labels'\)/.test(extract('_prodEnsureLabels'))
  && /_prodState\.labels = new Map\(\[\.\.\._prodState\.labels\]\.filter/.test(extract('_prodRefresh')),
'Production refreshes preserve a pending label write and do not race it with an older protected read');
ok(/_prodGatewayWrite\(issue, 'labels', \{ label_ids: labelIds \}\)/.test(source)
  && /payload\.expected_updated_at = issue\.updatedRaw/.test(source)
  && /_prodWriteRequestId\(operation\)/.test(extract('_prodGatewayWrite')),
'label toggles send one full selected-id set through the existing CAS/idempotency envelope');
ok(/data-prod-label-search-input/.test(source)
  && /role="checkbox"/.test(source)
  && /_prodLabelColorStyle\(label\)/.test(source)
  && /label\.description \|\| label\.name/.test(source)
  && /layer\.innerHTML && !layer\.contains\(el\)/.test(source),
'label picker exposes search, colors, checkbox selection, and description tooltips inside the active layer');
ok(/_prodState\.labels = new Map\(\[\.\.\._prodState\.labels\]\.filter/.test(extract('_prodRefresh'))
  && /_prodEnsureLabels\(_prodState\.openId, false\)/.test(extract('_prodRender')),
'refresh discards non-pending label state and reopens from the protected source');
ok(/linear_project_ids/.test(source)
  && /raw_project_id:linear_raw->issue->project->>id/.test(source)
  && /raw_attribution_state:linear_raw->attribution->>state/.test(source)
  && /client\.active !== true/.test(extract('_prodResolveAttributions')),
'F200 attribution reads only active-roster project IDs plus lightweight project/attribution aliases');
ok(/'direct_project'/.test(extract('_prodResolveAttributions'))
  && /'nearest_mapped_ancestor'/.test(extract('_prodResolveAttributions'))
  && /'provisional_child_family'/.test(extract('_prodResolveAttributions'))
  && /persisted\.schema === 'syncview_attribution_v1'/.test(extract('_prodResolveAttributions'))
  && /persisted\.explicit_owner_approved === true/.test(extract('_prodResolveAttributions'))
  && /\^\[a-f0-9\]\{64\}\$/.test(extract('_prodResolveAttributions'))
  && /PROD_ATTRIBUTION_NEEDS/.test(extract('_prodAdapter'))
  && /PROD_ATTRIBUTION_CONFLICT/.test(extract('_prodAdapter')),
'F200 resolves direct, ancestor, owner-proved explicit, provisional, needs-repair, and conflict display states');
ok(/!_prodAttributionResolved\(issue\)/.test(extract('_prodCanWrite'))
  && /if \(!_prodAttributionResolved\(issue\)\) return false/.test(extract('_prodTestWriteOverride'))
  && /data-prod-attribution-chip/.test(source)
  && /This is an attribution repair group, not a client project/.test(extract('_prodOpenProject')),
'non-resolved attribution is visibly repair-only, non-navigable, and excluded from writes including TEST override');
ok(/'id,brief,updated_at'/.test(extract('_prodEnsureDescription'))
  && /requestToken !== _prodState\.descriptionRequestTokens\.get\(id\)/.test(extract('_prodEnsureDescription'))
  && /Description could not refresh\. The text shown may be outdated\./.test(extract('_prodEnsureDescription'))
  && /_prodMarkDescriptionsStale\(\)/.test(extract('_prodRefresh')),
'description reads expose stale/error truth and discard late completions after a light refresh');
ok(/_prodGatewayWrite\(issue, 'description', \{ description \}, state\.requestId\)/.test(extract('_prodSaveDescription'))
  && /if \(!state\.requestId\) state\.requestId = _prodWriteRequestId\('description'\)/.test(extract('_prodSaveDescription'))
  && /_prodNextDescriptionRequestToken\(id\)/.test(extract('_prodSaveDescription'))
  && /description\.includes\('\\0'\)/.test(extract('_prodSaveDescription'))
  && /\['status', 'status_at', 'due_date', 'assignee_id', 'brief', 'updated_at', 'linear_raw'\]/.test(extract('_prodApplyGatewayRow')),
'description edits preserve exact Markdown, reject NUL, invalidate stale reads, and adopt the guarded gateway brief');
ok(/state\.draft = value/.test(extract('_prodDescriptionDraftInput'))
  && /state\.error = state\.remoteChanged/.test(extract('_prodDescriptionDraftInput'))
  && /state\.remoteChanged = !!serverRow/.test(extract('_prodSaveDescription'))
  && /state\.requestId = ''/.test(extract('_prodSaveDescription'))
  && /_prodFocusDescriptionControl\(id, 'source'\)/.test(extract('_prodSaveDescription')),
'description write errors retain the draft while conflict rows replace the server baseline and CAS cursor');
ok(/const descriptionTokens = new Map\(_prodState\.descriptionRequestTokens\)/.test(extract('_prodLoadBriefs'))
  && /state\.saving \|\| state\.editing \|\| startedToken !== currentToken/.test(extract('_prodLoadBriefs')),
'bulk brief hydration cannot overwrite an active draft, pending save, or newer per-issue description result');
ok(/data-prod-description-control="source"/.test(source)
  && /data-prod-description-control="preview"/.test(source)
  && /maxlength="100000"/.test(source)
  && /event\.key === 'Escape'/.test(extract('_prodDescriptionEditorKeydown'))
  && /_prodFocusDescriptionControl\(id, 'edit'\)/.test(extract('_prodCancelDescriptionEdit'))
  && /_prodCaptureDescriptionFocus\(root\)/.test(extract('_prodRender')),
'description source/preview editing is bounded, keyboard accessible, and preserves focus/caret across rerenders');
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
const rowRenderers = ['_prodRow', '_prodSubIssueRowHTML', '_prodProjectIssueRowHTML'].map(extract);
ok(rowRenderers.every(body => /_prodWriteGateAttrs\([^,]+, 'due'/.test(body)
  && /_prodWriteGateAttrs\([^,]+, 'assignee'/.test(body)),
'list, sub-issue, and project-issue rows share due and assignee gate attributes');
ok(/_prodWriteGateAttrs\(issue, 'status'/.test(extract('_prodStatusIcon'))
  && ['status', 'assignee', 'due'].every(operation => extract('_prodProps').includes(`_prodWriteGateAttrs(d, '${operation}'`)),
'status icons and detail properties reuse the shared write-gate attribute helper');

if (failures) {
  console.error(`\n${failures} Production write UI check(s) failed`);
  process.exit(1);
}
console.log('\nProduction write UI checks passed');
