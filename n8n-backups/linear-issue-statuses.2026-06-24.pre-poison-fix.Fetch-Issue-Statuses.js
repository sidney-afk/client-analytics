// Backup of n8n workflow "SyncView Calendar — Linear Issue Statuses" (GP8CSZDNcy5sGdFr),
// node "Fetch Issue Statuses", BEFORE the 2026-06-24 batch-poison fix.
// See THUMBNAIL_DESYNC_INCIDENT_2026-06-24.md.
//
// BUG: a single aliased GraphQL query (`a0: issue(id:"X") …`). Linear nulls the ENTIRE
// response if ANY one id doesn't exist (deleted issue / stale link), and this code did
// `const data = (resp && resp.data) || {}` → empty → returned {ok:true, statuses:{}}.
// One dead link therefore blanked every issue batched with it, and the caller couldn't
// tell that apart from "Linear is fine, these just have no status". The reconciler then
// marked all of them "missing" and never reconciled them (132 live components/run).
const body = ($input.first() && $input.first().json && $input.first().json.body) || {};
const issues = Array.isArray(body.issues) ? body.issues : [];
const ids = [];
const seen = {};
for (let i = 0; i < issues.length; i++) {
  const m = String(issues[i] || '').match(/([A-Za-z]+-\d+)/);
  if (m) { const id = m[1].toUpperCase(); if (!seen[id]) { seen[id] = true; ids.push(id); } }
}
if (!ids.length) return [{ json: { ok: true, statuses: {}, meta: {} } }];
const capped = ids.slice(0, 100);
const LINEAR_KEY = 'lin_api_REDACTED'; // real key lives only in the live n8n workflow node; redacted in this repo backup
const parts = capped.map((id, i) => 'a' + i + ': issue(id: "' + id + '") { identifier state { name } dueDate assignee { id } project { name } parent { id project { name } } }');
const query = '{ ' + parts.join(' ') + ' }';
let resp;
try {
  resp = await this.helpers.httpRequest({ method: 'POST', url: 'https://api.linear.app/graphql', headers: { Authorization: LINEAR_KEY, 'Content-Type': 'application/json' }, body: { query }, json: true });
} catch (e) { return [{ json: { ok: false, error: 'Could not reach the Linear API.' } }]; }
const data = (resp && resp.data) || {};
const statuses = {};
const meta = {};
for (let i = 0; i < capped.length; i++) {
  const issue = data['a' + i];
  if (issue && issue.identifier) {
    const ident = String(issue.identifier).toUpperCase();
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
}
return [{ json: { ok: true, statuses, meta } }];
