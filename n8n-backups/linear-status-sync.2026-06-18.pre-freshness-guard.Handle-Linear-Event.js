// SNAPSHOT — 'Handle Linear Event' code node of workflow MJbMZ789B5ExZz9x
// (SyncView Calendar — Linear Status Sync), BEFORE the bug-A freshness guard.
// Captured 2026-06-18. ROLLBACK: republish n8n version cedf2b13-ec20-4ce5-a601-f21b3f1840db
// (new active version with the guard: 3f99f865-bc1b-4b72-ab8f-6e153236100e).
// NOTE: the live LINEAR_KEY and service keys are REDACTED here — they live only in n8n.
// ---------------------------------------------------------------------------
const body = ($input.first() && $input.first().json && $input.first().json.body) || {};
if (body.type !== 'Issue') return [{ json: { ok: true, skipped: 'not an issue event' } }];
const action = body.action;
const issueId = (body.data && body.data.id) || '';
if (!issueId) return [{ json: { ok: true, skipped: 'no issue id' } }];
if (action === 'create') return [{ json: { ok: true, skipped: 'card creation handled by frontend' } }];
const LINEAR_KEY = '<REDACTED_LINEAR_API_KEY>';
const GET_URL = 'https://synchrosocial.app.n8n.cloud/webhook/calendar-get';
const UPSERT_URL = 'https://synchrosocial.app.n8n.cloud/webhook/calendar-upsert-post';
const SUPA_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co/rest/v1/calendar_posts';
const SUPA_KEY = 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA';
const slugify = (name) => {
  let s = String(name || '').toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/^dr\.?\s+/, '');
  s = s.replace(/\s+(?:and|&)\s+/g, '&');
  s = s.replace(/[^a-z0-9&]+/g, '');
  return s;
};
const mapStatus = (stateName) => {
  const s = String(stateName || '').trim().toLowerCase();
  if (s.indexOf('tweak') >= 0) return 'Tweaks Needed';
  if (s.indexOf('scheduled') >= 0) return 'Scheduled';
  if (s === 'posted') return 'Posted';
  if (s === 'approved') return 'Approved';
  if (s.indexOf('smm') >= 0) return 'For SMM Approval';
  if (s.indexOf('kasper') >= 0) return 'Kasper Approval';
  if (s.indexOf('client') >= 0) return 'Client Approval';
  if (s === 'backlog' || s === 'todo' || s === 'to do' || s.indexOf('in progress') >= 0 || s.indexOf('in process') >= 0) return 'In Progress';
  return null;
};
const gql = async (query) => await this.helpers.httpRequest({ method: 'POST', url: 'https://api.linear.app/graphql', headers: { Authorization: LINEAR_KEY, 'Content-Type': 'application/json' }, body: { query }, json: true, timeout: 15000 });
const getCalendar = async (slug) => await this.helpers.httpRequest({ method: 'GET', url: GET_URL + '?client=' + encodeURIComponent(slug), json: true, timeout: 15000 });
// Lightened read: fetch ONLY the candidate rows whose Linear link contains this
// issue identifier, instead of every row for the client. ilike '*ident*' is
// deliberately BROADER than the strict word-boundary regex applied below, so the
// candidate set is a superset and the downstream match is identical — just over a
// handful of rows instead of hundreds. Returns null on a non-array so the caller
// can fall back to the full read (never less reliable than before).
const supaCandidates = async (slug, identifier) => {
  const safe = String(identifier || '').replace(/[%,()*\s]/g, '');
  const qs = 'select=*&client=eq.' + encodeURIComponent(slug)
    + '&or=(linear_issue_id.ilike.*' + safe + '*,graphic_linear_issue_id.ilike.*' + safe + '*)';
  const rows = await this.helpers.httpRequest({ method: 'GET', url: SUPA_URL + '?' + qs, headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY }, json: true, timeout: 15000 });
  return Array.isArray(rows) ? rows : null;
};
const upsert = async (slug, post) => await this.helpers.httpRequest({ method: 'POST', url: UPSERT_URL, headers: { 'Content-Type': 'application/json' }, body: { client: slug, post: post }, json: true });

if (action === 'update') {
  const uf = body.updatedFrom || {};
  if (!Object.prototype.hasOwnProperty.call(uf, 'stateId')) return [{ json: { ok: true, skipped: 'not a state change' } }];
  let resp;
  try { resp = await gql('{ issue(id: "' + issueId + '") { identifier state { name } team { key } project { name } parent { project { name } } } }'); }
  catch (e) { return [{ json: { ok: false, error: 'Linear API unreachable' } }]; }
  const issue = resp && resp.data && resp.data.issue;
  if (!issue) return [{ json: { ok: true, skipped: 'issue not found' } }];
  const status = mapStatus(issue.state && issue.state.name);
  if (!status) return [{ json: { ok: true, skipped: 'state not mapped' } }];
  const projectName = (issue.project && issue.project.name) || (issue.parent && issue.parent.project && issue.parent.project.name) || '';
  const slug = slugify(projectName);
  if (!slug) return [{ json: { ok: true, skipped: 'no client project' } }];
  const ident = String(issue.identifier || '').toUpperCase();
  if (!ident) return [{ json: { ok: true, skipped: 'no identifier' } }];
  const teamKey = String((issue.team && issue.team.key) || '').toUpperCase();
  let posts = null;
  try { posts = await supaCandidates(slug, ident); }
  catch (e) { posts = null; }
  if (!posts) {
    // Fallback to the original full read so a Supabase blip never makes sync worse.
    try { const getResp = await getCalendar(slug); posts = (getResp && getResp.posts) || []; }
    catch (e) { return [{ json: { ok: false, error: 'calendar read failed' } }]; }
  }
  const re = new RegExp('(^|[^A-Z0-9])' + ident + '([^0-9]|$)');
  const scoreTs = (p) => { const t = Date.parse(p && p.updated_at || ''); return isFinite(t) ? t : 0; };
  const bestByLink = new Map();
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i] || {};
    if (!p.id) continue;
    const vLink = String(p.linear_issue_id || '').toUpperCase();
    const gLink = String(p.graphic_linear_issue_id || '').toUpperCase();
    const matchVideo = vLink && re.test(vLink);
    const matchGraphic = gLink && re.test(gLink);
    if (!matchVideo && !matchGraphic) continue;
    const key = matchVideo ? ('V:' + vLink) : ('G:' + gLink);
    const prev = bestByLink.get(key);
    if (!prev) { bestByLink.set(key, { post: p, matchVideo, matchGraphic }); continue; }
    const prevArchived = String(prev.post.status || '').toLowerCase() === 'archived';
    const curArchived = String(p.status || '').toLowerCase() === 'archived';
    if (!curArchived && prevArchived) { bestByLink.set(key, { post: p, matchVideo, matchGraphic }); continue; }
    if (curArchived && !prevArchived) continue;
    const tsCur = scoreTs(p), tsPrev = scoreTs(prev.post);
    if (tsCur > tsPrev) { bestByLink.set(key, { post: p, matchVideo, matchGraphic }); continue; }
    if (tsCur === tsPrev && Number(p.order_index || 0) > Number(prev.post.order_index || 0)) {
      bestByLink.set(key, { post: p, matchVideo, matchGraphic });
    }
  }
  let updated = 0, skippedArchived = 0, skippedPosted = 0;
  for (const entry of bestByLink.values()) {
    const p = entry.post;
    const cur = String(p.status || '');
    if (cur.toLowerCase() === 'archived') { skippedArchived++; continue; }
    const patch = { id: p.id };
    if (entry.matchVideo)   patch.video_status   = status;
    if (entry.matchGraphic) patch.graphic_status = status;
    if (entry.matchVideo   && String(p.video_status   || '') === 'Posted' && patch.video_status   !== 'Posted') delete patch.video_status;
    if (entry.matchGraphic && String(p.graphic_status || '') === 'Posted' && patch.graphic_status !== 'Posted') delete patch.graphic_status;
    if (!patch.video_status && !patch.graphic_status) { skippedPosted++; continue; }
    const sameVideo = !patch.video_status || patch.video_status === String(p.video_status || '');
    const sameGraphic = !patch.graphic_status || patch.graphic_status === String(p.graphic_status || '');
    if (sameVideo && sameGraphic) continue;
    try { await upsert(slug, patch); updated++; }
    catch (e) {}
  }
  return [{ json: { ok: true, updated: updated, skippedArchived: skippedArchived, skippedPosted: skippedPosted, identifier: ident, status: status, teamKey: teamKey } }];
}

return [{ json: { ok: true, skipped: 'unhandled action ' + String(action) } }];