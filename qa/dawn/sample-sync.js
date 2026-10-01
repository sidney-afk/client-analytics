// sample-sync.js — is any sample's own status behind its work item?
//
// Why (owner, 2026-10-01): a sample status change saves in two steps, the work
// item first (production-write) and the sample's own record second
// (sample-review-upsert). If the page goes away in between, only the first step
// lands, and the browser keeps a note that only the SAME browser can finish when
// it reopens the page. Until then the work item is ahead of the sample, and the
// sample never reaches the client. Two throwaway-browser hand tests produced
// exactly that; this check makes any real one visible every weekday morning.
//
// A component (video or graphic) is "stuck" when its linked work item maps to a
// sample status that differs from the sample's own, the work item changed at or
// after the sample's own stamp (the work item is ahead), and that has stood for
// longer than the grace period (a save in flight takes seconds). Samples that
// are archived, components with no work item, and work items with no sample
// equivalent (canceled, duplicate, triage, scheduled, posted) are left out.
//
// Read-only. Returns COUNTS only: the dawn report is public (dawn-report.js), so
// no client, card or sample name or id ever leaves this module.
'use strict';

// Mirror of the page's own mapping for samples: _calMapNativeStatusStrict(status,
// 'samples') in src/index/134-calendar-prefs-mount.js.part. test/sample-sync.js
// reads the page source and fails if the two ever differ.
const SAMPLE_STATUS_FOR = Object.freeze({
  in_progress: 'In Progress',
  backlog: 'In Progress',
  todo: 'In Progress',
  smm_approval: 'For SMM Approval',
  kasper_approval: 'Kasper Approval',
  client_approval: 'Client Approval',
  tweak: 'Tweaks Needed',
  approved: 'Approved',
});
const GRACE_MINUTES = 30;
const COMPONENTS = ['video', 'graphic'];
const READ_TIMEOUT_MS = 20000;
const PAGE = 1000;
const ID_CHUNK = 80;

const stamp = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };

// samples: rows { status, video_status, graphic_status, video_status_at,
//   graphic_status_at, video_deliverable_id, graphic_deliverable_id }.
// workItems: rows { id, status, status_at }.
// Returns { samples, compared, stuck, stuckSamples, held, sampleAhead }.
function stuckSamples({ samples, workItems, now = Date.now(), graceMinutes = GRACE_MINUTES }) {
  const byId = new Map();
  for (const w of workItems || []) if (w && w.id != null) byId.set(String(w.id), w);
  let live = 0, compared = 0, stuck = 0, held = 0, sampleAhead = 0;
  const stuckIds = new Set();
  (samples || []).forEach((s, i) => {
    if (!s || String(s.status || '') === 'Archived') return;
    live++;
    for (const c of COMPONENTS) {
      const did = s[c + '_deliverable_id'];
      if (did == null || did === '') continue;
      const w = byId.get(String(did));
      if (!w) continue;
      const want = SAMPLE_STATUS_FOR[String(w.status || '').toLowerCase()];
      if (!want) continue;
      compared++;
      const own = s[c + '_status'] || null;
      if (own === want) continue;
      const sAt = stamp(s[c + '_status_at']), wAt = stamp(w.status_at);
      // The sample changed after the work item did: it is the one ahead.
      if (sAt !== null && wAt !== null && sAt > wAt) { sampleAhead++; continue; }
      // A save in flight, or one a returning browser is about to finish.
      if (wAt !== null && now - wAt < graceMinutes * 60000) { held++; continue; }
      stuck++;
      stuckIds.add(i);
    }
  });
  return { samples: live, compared, stuck, stuckSamples: stuckIds.size, held, sampleAhead };
}

async function pagedRead(fetchImpl, url, headers, signal, what) {
  const out = [];
  for (let off = 0; ; off += PAGE) {
    const r = await fetchImpl(`${url}&limit=${PAGE}&offset=${off}`, { headers, signal: signal() });
    if (!r.ok) throw new Error(what);
    const rows = await r.json();
    if (!Array.isArray(rows)) throw new Error(what);
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

// Live read (the browser publishable key; the work item view is one of the
// relations the owner decided stays browser-readable). Throws on any read failure.
async function readSampleSync({ supa, key, fetchImpl = fetch, timeoutMs = READ_TIMEOUT_MS, now = Date.now() }) {
  const h = { apikey: key, authorization: 'Bearer ' + key };
  const sig = () => (AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined);
  const samples = await pagedRead(fetchImpl,
    `${supa}/rest/v1/sample_reviews?status=neq.Archived&select=status,video_status,graphic_status,video_status_at,graphic_status_at,video_deliverable_id,graphic_deliverable_id&order=id`,
    h, sig, 'sample_reviews');
  const ids = [...new Set(samples.flatMap(s => COMPONENTS.map(c => s[c + '_deliverable_id'])).filter(v => v != null && v !== ''))];
  const workItems = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const list = ids.slice(i, i + ID_CHUNK).map(v => encodeURIComponent(String(v))).join(',');
    const r = await fetchImpl(`${supa}/rest/v1/production_deliverables_browser_v1?select=id,status,status_at&id=in.(${list})`, { headers: h, signal: sig() });
    if (!r.ok) throw new Error('work-items');
    const rows = await r.json();
    if (!Array.isArray(rows)) throw new Error('work-items');
    workItems.push(...rows);
  }
  return stuckSamples({ samples, workItems, now });
}

module.exports = { stuckSamples, readSampleSync, SAMPLE_STATUS_FOR, GRACE_MINUTES };
