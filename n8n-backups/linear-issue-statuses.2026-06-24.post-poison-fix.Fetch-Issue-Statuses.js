// Deployed code for n8n workflow "SyncView Calendar — Linear Issue Statuses"
// (GP8CSZDNcy5sGdFr), node "Fetch Issue Statuses", AFTER the 2026-06-24 batch-poison fix.
// See THUMBNAIL_DESYNC_INCIDENT_2026-06-24.md.
//
// FIX: a dead Linear id nulls the WHOLE aliased GraphQL response. Resolve the batch in one
// aliased call; if Linear poisons it, fall back to resolving each id on its own IN PARALLEL
// (bounded ~2 round-trips) so a dead link only ever drops itself, never the live cards
// batched with it. Output shape is unchanged ({ok, statuses, meta}) plus an additive
// `missing` array; ok:false is returned ONLY when Linear is genuinely unreachable (no
// longer when a dead id poisoned the batch).
const body = ($input.first() && $input.first().json && $input.first().json.body) || {};
const issues = Array.isArray(body.issues) ? body.issues : [];
const ids = [];
const seen = {};
for (let i = 0; i < issues.length; i++) {
  const m = String(issues[i] || '').match(/([A-Za-z]+-\d+)/);
  if (m) { const id = m[1].toUpperCase(); if (!seen[id]) { seen[id] = true; ids.push(id); } }
}
if (!ids.length) return [{ json: { ok: true, statuses: {}, meta: {}, missing: [] } }];
const capped = ids.slice(0, 100);
const LINEAR_KEY = 'lin_api_REDACTED'; // real key lives only in the live n8n workflow node; redacted in this repo backup
const FIELDS = '{ identifier state { name } dueDate assignee { id } project { name } parent { id project { name } } }';

// Resolve one chunk via a single aliased query. Returns {issues} on success, {poisoned}
// when Linear nulled the whole response (some id doesn't exist), or {network} if Linear
// was unreachable.
const gqlChunk = async (chunk) => {
  const parts = chunk.map((id, i) => 'a' + i + ': issue(id: "' + id + '") ' + FIELDS);
  let resp;
  try {
    resp = await this.helpers.httpRequest({ method: 'POST', url: 'https://api.linear.app/graphql', headers: { Authorization: LINEAR_KEY, 'Content-Type': 'application/json' }, body: { query: '{ ' + parts.join(' ') + ' }' }, json: true });
  } catch (e) { return { network: true }; }
  const data = resp && resp.data;
  if (!data || (resp.errors && resp.errors.length)) return { poisoned: true };
  const out = {};
  for (let i = 0; i < chunk.length; i++) { const it = data['a' + i]; if (it && it.identifier) out[String(it.identifier).toUpperCase()] = it; }
  return { issues: out };
};

const found = {};
let networkFailed = false;
const first = await gqlChunk(capped);
if (first.issues) { Object.assign(found, first.issues); }
else if (first.network) { networkFailed = true; }
else {
  // Poisoned: a dead id nulled the whole batch. Resolve each id on its own, in parallel,
  // so a single dead link resolves to nothing instead of blanking everything with it.
  const results = await Promise.all(capped.map((id) => gqlChunk([id])));
  for (const r of results) { if (r.issues) Object.assign(found, r.issues); else if (r.network) networkFailed = true; }
}
if (networkFailed && !Object.keys(found).length) {
  return [{ json: { ok: false, error: 'Could not reach the Linear API.' } }];
}

const statuses = {};
const meta = {};
for (const ident of Object.keys(found)) {
  const issue = found[ident];
  const stateName = (issue.state && issue.state.name) || '';
  statuses[ident] = stateName;
  meta[ident] = {
    state: stateName,
    isSubIssue: !!(issue.parent && issue.parent.id),
    hasProject: !!((issue.project && issue.project.name) || (issue.parent && issue.parent.project && issue.parent.project.name)),
    hasDue: !!issue.dueDate,
    hasEditor: !!(issue.assignee && issue.assignee.id)
  };
}
const missing = capped.filter((id) => statuses[id] === undefined);
return [{ json: { ok: true, statuses, meta, missing } }];
