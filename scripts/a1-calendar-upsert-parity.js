'use strict';
/*
 * A1 calendar-upsert parity harness.
 *
 * This compares the live n8n calendar-upsert webhook with the A1 Edge Function
 * against the TEST client only. It snapshots/restores every row it touches.
 *
 * Required:
 *   SUPABASE_SERVICE_ROLE_KEY=...
 *   A1_PARITY_CONFIRM=sidneylaruel
 *
 * Optional:
 *   SUPABASE_URL=https://uzltbbrjidmjwwfakwve.supabase.co
 *   A1_OLD_UPSERT_URL=https://synchrosocial.app.n8n.cloud/webhook/calendar-upsert-post
 *   A1_EF_UPSERT_URL=https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/calendar-upsert
 *   A1_PARITY_CLIENT=sidneylaruel
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const OLD_URL = process.env.A1_OLD_UPSERT_URL || 'https://synchrosocial.app.n8n.cloud/webhook/calendar-upsert-post';
const EF_URL = process.env.A1_EF_UPSERT_URL || `${SUPABASE_URL}/functions/v1/calendar-upsert`;
const CLIENT = process.env.A1_PARITY_CLIENT || 'sidneylaruel';
const CONFIRM = process.env.A1_PARITY_CONFIRM || '';
const SETTLE_MS = Number(process.env.A1_PARITY_SETTLE_MS || 750);

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!SERVICE_KEY) fail('Missing SUPABASE_SERVICE_ROLE_KEY; refusing to run parity writes.');
if (CLIENT !== 'sidneylaruel' && process.env.A1_PARITY_ALLOW_NON_TEST !== '1') {
  fail(`Refusing to run against non-TEST client "${CLIENT}".`);
}
if (CONFIRM !== CLIENT) {
  fail(`Set A1_PARITY_CONFIRM=${CLIENT} to confirm TEST-client parity writes.`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function enc(v) {
  return encodeURIComponent(String(v));
}

async function rest(path, opts = {}) {
  const headers = Object.assign({
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }, opts.headers || {});
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await resp.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch (_e) { json = text; }
  }
  if (!resp.ok) {
    throw new Error(`Supabase ${opts.method || 'GET'} ${path} failed: HTTP ${resp.status} ${text.slice(0, 400)}`);
  }
  return json;
}

async function readRows(client, ids) {
  const out = [];
  for (const id of ids) {
    const rows = await rest(`calendar_posts?client=eq.${enc(client)}&id=eq.${enc(id)}&select=*`);
    if (Array.isArray(rows) && rows[0]) out.push(rows[0]);
  }
  return out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

async function deleteRows(client, ids) {
  for (const id of ids) {
    await rest(`calendar_posts?client=eq.${enc(client)}&id=eq.${enc(id)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
  }
}

async function upsertRows(rows) {
  if (!rows.length) return;
  await rest('calendar_posts?on_conflict=client,id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: rows,
  });
}

async function deleteEvents(client, ids) {
  for (const id of ids) {
    try {
      await rest(`calendar_post_events?client=eq.${enc(client)}&post_id=eq.${enc(id)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
    } catch (e) {
      if (!/calendar_post_events|404|PGRST/.test(String(e.message || e))) throw e;
    }
  }
}

async function readEvents(client, ids) {
  const out = [];
  for (const id of ids) {
    try {
      const rows = await rest(`calendar_post_events?client=eq.${enc(client)}&post_id=eq.${enc(id)}&select=*&order=ts.asc,id.asc`);
      if (Array.isArray(rows)) out.push(...rows);
    } catch (e) {
      if (!/calendar_post_events|404|PGRST/.test(String(e.message || e))) throw e;
    }
  }
  return out;
}

async function restore(client, ids, originalRows) {
  await deleteEvents(client, ids);
  await deleteRows(client, ids);
  await upsertRows(originalRows);
}

async function callEndpoint(url, payload, label) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Syncview-Actor': 'A1 parity',
      'X-Syncview-Role': 'system',
      'X-Syncview-Source': 'qa',
    },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (_e) { body = text; }
  return { http_status: resp.status, body };
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = sortObject(value[key]);
    return acc;
  }, {});
}

function normalizeGenerated(value, opts = {}, path = []) {
  if (Array.isArray(value)) return value.map((v, i) => normalizeGenerated(v, opts, path.concat(String(i))));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    const nextPath = path.concat(key);
    const inEvent = path.includes('events') || path.includes('calendar_post_events');
    if (key === 'updated_at' || key === 'created_at' || key === 'ts' || /_status_at$/.test(key)) {
      out[key] = '<generated:timestamp>';
    } else if (key === 'id' && (inEvent || opts.normalizePostId)) {
      out[key] = '<generated:id>';
    } else {
      out[key] = normalizeGenerated(raw, opts, nextPath);
    }
  }
  return sortObject(out);
}

function stable(value) {
  return JSON.stringify(sortObject(value), null, 2);
}

function parseCell(value) {
  try {
    const rows = JSON.parse(value || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch (_e) {
    return [];
  }
}

function verifyMergedComments(rowId, expectedIds, oldResult, efResult) {
  for (const [label, result] of [['n8n', oldResult], ['edge-function', efResult]]) {
    const row = result.rows.find(r => String(r.id) === rowId);
    if (!row) return `${label} missing merged comment row ${rowId}`;
    const ids = new Set(parseCell(row.video_tweaks).map(c => String(c && c.id)));
    for (const id of expectedIds) {
      if (!ids.has(id)) return `${label} merged comments missing ${id}`;
    }
    if (row.tweaks !== row.video_tweaks) return `${label} legacy tweaks mirror differs from video_tweaks`;
  }
  return null;
}

function baseRow(id, over = {}) {
  return Object.assign({
    client: CLIENT,
    id,
    updated_at: '2026-07-03T00:00:00.000Z',
    scheduled_date: '2026-07-03',
    name: 'A1 parity seed',
    status: 'In Progress',
    video_status: 'In Progress',
    graphic_status: 'In Progress',
    caption_status: 'In Progress',
    linear_issue_id: '',
    graphic_linear_issue_id: '',
    video_tweaks: '',
    graphic_tweaks: '',
    caption_tweaks: '',
    title_tweaks: '',
  }, over);
}

function cases() {
  const run = Date.now().toString(36);
  const p = `a1_parity_${run}`;
  const vid = n => `https://linear.app/synchrosocial/issue/VID-A1P-${run}-${n}/a1-parity-${n}`;
  const gra = n => `https://linear.app/synchrosocial/issue/GRA-A1P-${run}-${n}/a1-parity-${n}`;
  const comment = (suffix, body, at) => ({
    id: `c_${run}_${suffix}`,
    author: 'A1 parity',
    role: 'smm',
    body,
    created_at: at,
    updated_at: at,
    audience: 'internal',
  });
  const keptComment = comment('kept', 'existing visible comment', '2026-07-03T01:00:00.000Z');
  const concurrentComment = comment('concurrent', 'stored after editor base', '2026-07-03T01:10:00.000Z');
  const addedComment = comment('added', 'incoming new comment', '2026-07-03T01:12:00.000Z');
  const seedComments = JSON.stringify([keptComment, concurrentComment]);
  const incomingComments = JSON.stringify([keptComment, addedComment]);
  return [
    {
      name: 'create-basic',
      ids: [`${p}_create`],
      seed: [],
      payload: {
        client: CLIENT,
        post: {
          id: `${p}_create`,
          scheduled_date: '2026-07-03',
          name: 'A1 parity create',
          status: 'In Progress',
          video_status: 'In Progress',
          graphic_status: 'In Progress',
          caption_status: 'In Progress',
          linear_issue_id: vid(1),
          graphic_linear_issue_id: gra(1),
          thumb_rev: run,
        },
      },
    },
    {
      name: 'linear-import-real-shaped',
      ids: [`${p}_import_v1`],
      seed: [],
      payload: {
        client: CLIENT,
        post: {
          id: `${p}_import_v1`,
          order_index: 17,
          scheduled_date: '2026-07-09',
          name: 'Video 1 - Real-client-shaped import',
          asset_url: `https://frame.io/reviews/${run}/video-1`,
          thumbnail_url: `https://drive.google.com/file/d/${run}/view`,
          caption: 'Imported caption body with a CTA and emoji-free copy.',
          cta: 'Book the consultation',
          status: 'In Progress',
          video_status: 'In Progress',
          graphic_status: 'For SMM Approval',
          caption_status: 'In Progress',
          title_status: 'In Progress',
          linear_issue_id: vid(7),
          graphic_linear_issue_id: gra(7),
          platform: 'instagram',
          platforms: 'instagram,tiktok',
          color: '#f97316',
          thumb_rev: run,
        },
      },
    },
    {
      name: 'kasper-real-shaped-approval',
      ids: [`${p}_kasper`],
      seed: [baseRow(`${p}_kasper`, {
        name: 'A1 parity Kasper review',
        status: 'Kasper Approval',
        video_status: 'Kasper Approval',
        graphic_status: 'Approved',
        caption_status: 'Approved',
        title_status: 'Approved',
        linear_issue_id: vid(8),
        graphic_linear_issue_id: gra(8),
        video_tweaks: JSON.stringify([comment('kasper_seed', 'SMM sent this to Kasper', '2026-07-03T03:00:00.000Z')]),
        updated_at: '2026-07-03T03:05:00.000Z',
      })],
      payload: {
        client: CLIENT,
        comments_base_at: '2026-07-03T03:05:00.000Z',
        post: {
          id: `${p}_kasper`,
          status: 'Client Approval',
          video_status: 'Client Approval',
          kasper_approved_at: '2026-07-03T03:12:00.000Z',
          kasper_seen: 'video',
          kasper_approved_after_tweaks: 'video',
          kasper_finished_at: '2026-07-03T03:13:00.000Z',
          video_tweaks: JSON.stringify([
            comment('kasper_seed', 'SMM sent this to Kasper', '2026-07-03T03:00:00.000Z'),
            comment('kasper_ok', 'Kasper approved the video cut', '2026-07-03T03:12:00.000Z'),
          ]),
        },
      },
    },
    {
      name: 'link-clobber-guard',
      ids: [`${p}_clobber`],
      seed: [baseRow(`${p}_clobber`, { linear_issue_id: vid(2), updated_at: '2026-07-03T01:00:00.000Z' })],
      payload: {
        client: CLIENT,
        comments_base_at: '2026-07-03T01:00:00.000Z',
        post: { id: `${p}_clobber`, name: 'A1 parity clobber update', linear_issue_id: '', video_status: 'For SMM Approval' },
      },
    },
    {
      name: 'clear-link-sentinel',
      ids: [`${p}_clear`],
      seed: [baseRow(`${p}_clear`, { linear_issue_id: vid(3), updated_at: '2026-07-03T01:00:00.000Z' })],
      payload: {
        client: CLIENT,
        comments_base_at: '2026-07-03T01:00:00.000Z',
        post: { id: `${p}_clear`, linear_issue_id: '__CLEAR_LINK__', video_status: 'For SMM Approval' },
      },
    },
    {
      name: 'duplicate-link-guard',
      ids: [`${p}_dupe_target`, `${p}_dupe_twin`],
      seed: [baseRow(`${p}_dupe_twin`, { name: 'A1 parity dupe twin', linear_issue_id: vid(4) })],
      payload: {
        client: CLIENT,
        post: {
          id: `${p}_dupe_target`,
          name: 'A1 parity dupe target',
          scheduled_date: '2026-07-03',
          linear_issue_id: vid(4),
          status: 'In Progress',
        },
      },
    },
    {
      name: 'stale-scalar-conflict',
      ids: [`${p}_conflict`],
      seed: [baseRow(`${p}_conflict`, { status: 'In Progress', updated_at: '2026-07-03T02:00:00.000Z' })],
      payload: {
        client: CLIENT,
        comments_base_at: '2026-07-03T01:00:00.000Z',
        post: { id: `${p}_conflict`, status: 'Approved' },
      },
    },
    {
      name: 'comment-merge-video-tweaks',
      ids: [`${p}_comments`],
      seed: [baseRow(`${p}_comments`, {
        name: 'A1 parity comment merge',
        video_tweaks: seedComments,
        tweaks: seedComments,
        updated_at: '2026-07-03T01:11:00.000Z',
      })],
      payload: {
        client: CLIENT,
        comments_base_at: '2026-07-03T01:05:00.000Z',
        post: { id: `${p}_comments`, video_tweaks: incomingComments, tweaks: incomingComments },
      },
      verify: (oldResult, efResult) => verifyMergedComments(
        `${p}_comments`,
        [keptComment.id, concurrentComment.id, addedComment.id],
        oldResult,
        efResult,
      ),
    },
  ];
}

async function runSide(testCase, label, url, originalRows) {
  await restore(CLIENT, testCase.ids, originalRows);
  await upsertRows(testCase.seed);
  const response = await callEndpoint(url, testCase.payload, label);
  await sleep(SETTLE_MS);
  const rows = await readRows(CLIENT, testCase.ids);
  const events = await readEvents(CLIENT, testCase.ids);
  return { response, rows, events };
}

async function runCase(testCase) {
  const originalRows = await readRows(CLIENT, testCase.ids);
  try {
    const oldResult = await runSide(testCase, 'n8n', OLD_URL, originalRows);
    const efResult = await runSide(testCase, 'edge-function', EF_URL, originalRows);
    const normalizePostId = !testCase.payload.post || !testCase.payload.post.id;
    const oldComparable = normalizeGenerated({
      response: oldResult.response,
      rows: oldResult.rows,
    }, { normalizePostId });
    const efComparable = normalizeGenerated({
      response: efResult.response,
      rows: efResult.rows,
    }, { normalizePostId });
    const oldStable = stable(oldComparable);
    const efStable = stable(efComparable);
    if (oldStable !== efStable) {
      console.error(`\nFAIL ${testCase.name}`);
      console.error('--- n8n comparable ---');
      console.error(oldStable);
      console.error('--- edge comparable ---');
      console.error(efStable);
      console.error('--- normalized edge events (not compared to n8n) ---');
      console.error(stable(normalizeGenerated({ calendar_post_events: efResult.events })));
      return false;
    }
    if (typeof testCase.verify === 'function') {
      const verificationError = testCase.verify(oldResult, efResult);
      if (verificationError) {
        console.error(`\nFAIL ${testCase.name}`);
        console.error(verificationError);
        return false;
      }
    }
    console.log(`PASS ${testCase.name}`);
    return true;
  } finally {
    await restore(CLIENT, testCase.ids, originalRows);
  }
}

(async () => {
  console.log(`A1 calendar-upsert parity: client=${CLIENT}`);
  let failed = 0;
  for (const c of cases()) {
    const ok = await runCase(c);
    if (!ok) failed++;
  }
  if (failed) fail(`${failed} parity case(s) failed.`);
  console.log('A1 calendar-upsert parity passed.');
})().catch(e => fail(e && e.stack ? e.stack : String(e)));
