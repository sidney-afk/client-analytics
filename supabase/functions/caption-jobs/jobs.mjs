// Pure logic for the caption-jobs Edge Function (docs/plans/2026-09-30-n8n-exit-phase-2.md, step B).
// Mirrors the two n8n webhooks it replaces (caption-job-status and caption-job-update) key for key, so the
// Calendar page and the Generate Caption workflow see the same shapes. Nothing here touches a network.

export const JOB_ID_MAX = 120;
export const CAPTION_MAX = 5000;
export const ERROR_MAX = 600;
export const STATUS_WINDOW_MS = 24 * 3600 * 1000;   // no jobId given: rows touched in the last 24 hours
export const PRUNE_AFTER_MS = 14 * 24 * 3600 * 1000;
export const STATUS_LIMIT = 200;

const clean = (v) => String(v == null ? '' : v).trim();
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// A partial patch: only the keys the caller sent are written. Returns { ok, patch } or { ok:false, error }.
export function buildPatch(body, nowIso) {
  const b = body && typeof body === 'object' ? body : {};
  const jobId = clean(has(b, 'jobId') ? b.jobId : b.job_id);
  if (!jobId) return { ok: false, error: 'jobId required' };
  if (jobId.length > JOB_ID_MAX) return { ok: false, error: 'jobId too long' };
  const patch = { job_id: jobId, updated_at: nowIso };
  if (has(b, 'client')) patch.client = clean(b.client);
  if (has(b, 'postId') || has(b, 'post_id')) patch.post_id = clean(has(b, 'postId') ? b.postId : b.post_id);
  if (has(b, 'status')) patch.status = clean(b.status);
  if (has(b, 'stage')) patch.stage = clean(b.stage);
  if (has(b, 'caption')) patch.caption = String(b.caption == null ? '' : b.caption).slice(0, CAPTION_MAX);
  if (has(b, 'error')) patch.error = String(b.error == null ? '' : b.error).slice(0, ERROR_MAX);
  if (has(b, 'cancel_requested')) patch.cancel_requested = b.cancel_requested === true || b.cancel_requested === 'true';
  if (has(b, 'started_at')) patch.started_at = b.started_at ? clean(b.started_at) : null;
  return { ok: true, patch };
}

export function pruneCutoffIso(nowMs) { return new Date(nowMs - PRUNE_AFTER_MS).toISOString(); }

// One table row to the shape the page reads.
export function shapeRow(r) {
  return {
    jobId: r.job_id,
    client: r.client || '',
    postId: r.post_id || '',
    status: r.status || '',
    stage: r.stage || '',
    caption: r.caption || '',
    error: r.error || '',
    cancel_requested: r.cancel_requested === true,
    started_at: r.started_at || '',
    updated_at: r.updated_at || '',
  };
}

// Same selection the n8n status flow made: by client, optionally by postId and jobId; with no jobId only
// rows touched in the last 24 hours; newest first.
export function selectJobs(rows, query, nowMs) {
  const q = query || {};
  const postId = clean(q.postId), jobId = clean(q.jobId);
  return (rows || [])
    .filter((r) => r && r.job_id)
    .filter((r) => (postId ? (r.post_id || '') === postId : true))
    .filter((r) => (jobId ? r.job_id === jobId : (nowMs - Date.parse(r.updated_at || 0)) <= STATUS_WINDOW_MS))
    .sort((a, b) => Date.parse(b.updated_at || 0) - Date.parse(a.updated_at || 0))
    .slice(0, STATUS_LIMIT)
    .map(shapeRow);
}
