'use strict';
/*
 * A2 writer parity harness.
 *
 * Compares the live n8n writers with the A2 Edge Functions against the
 * sidneylaruel TEST client only. Every touched row/event is snapshot-restored.
 *
 * Required:
 *   SUPABASE_SERVICE_ROLE_KEY=...
 *   A2_PARITY_CONFIRM=sidneylaruel
 *
 * Optional:
 *   SUPABASE_URL=https://uzltbbrjidmjwwfakwve.supabase.co
 *   A2_PARITY_CLIENT=sidneylaruel
 *   A2_PARITY_SETTLE_MS=750
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const CLIENT = process.env.A2_PARITY_CLIENT || 'sidneylaruel';
const CONFIRM = process.env.A2_PARITY_CONFIRM || '';
const SETTLE_MS = Number(process.env.A2_PARITY_SETTLE_MS || 750);

const OLD_CAL_REORDER_BATCH_URL = process.env.A2_OLD_CAL_REORDER_BATCH_URL || 'https://synchrosocial.app.n8n.cloud/webhook/calendar-reorder-batch';
const OLD_SAMPLE_UPSERT_URL = process.env.A2_OLD_SAMPLE_UPSERT_URL || 'https://synchrosocial.app.n8n.cloud/webhook/sample-review-upsert';
const OLD_SAMPLE_REORDER_URL = process.env.A2_OLD_SAMPLE_REORDER_URL || 'https://synchrosocial.app.n8n.cloud/webhook/sample-review-reorder';
const EF_CAL_REORDER_URL = process.env.A2_EF_CAL_REORDER_URL || `${SUPABASE_URL}/functions/v1/calendar-reorder`;
const EF_SAMPLE_UPSERT_URL = process.env.A2_EF_SAMPLE_UPSERT_URL || `${SUPABASE_URL}/functions/v1/sample-review-upsert`;
const EF_SAMPLE_REORDER_URL = process.env.A2_EF_SAMPLE_REORDER_URL || `${SUPABASE_URL}/functions/v1/sample-review-reorder`;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!SERVICE_KEY) fail('Missing SUPABASE_SERVICE_ROLE_KEY; refusing to run parity writes.');
if (CLIENT !== 'sidneylaruel' && process.env.A2_PARITY_ALLOW_NON_TEST !== '1') {
  fail(`Refusing to run against non-TEST client "${CLIENT}".`);
}
if (CONFIRM !== CLIENT) {
  fail(`Set A2_PARITY_CONFIRM=${CLIENT} to confirm TEST-client parity writes.`);
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

async function readRows(table, client, ids) {
  const out = [];
  for (const id of ids) {
    const rows = await rest(`${table}?client=eq.${enc(client)}&id=eq.${enc(id)}&select=*`);
    if (Array.isArray(rows) && rows[0]) out.push(rows[0]);
  }
  return out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

async function deleteRows(table, client, ids) {
  for (const id of ids) {
    await rest(`${table}?client=eq.${enc(client)}&id=eq.${enc(id)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
  }
}

async function upsertRows(table, rows) {
  if (!rows.length) return;
  await rest(`${table}?on_conflict=client,id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: rows,
  });
}

async function deleteSampleEvents(client, ids) {
  for (const id of ids) {
    try {
      await rest(`sample_review_events?client=eq.${enc(client)}&sample_id=eq.${enc(id)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
    } catch (e) {
      if (!/sample_review_events|404|PGRST/.test(String(e.message || e))) throw e;
    }
  }
}

async function readSampleEvents(client, ids) {
  const out = [];
  for (const id of ids) {
    try {
      const rows = await rest(`sample_review_events?client=eq.${enc(client)}&sample_id=eq.${enc(id)}&select=*&order=ts.asc,id.asc`);
      if (Array.isArray(rows)) out.push(...rows);
    } catch (e) {
      if (!/sample_review_events|404|PGRST/.test(String(e.message || e))) throw e;
    }
  }
  return out;
}

async function restoreTable(table, client, ids, originalRows) {
  if (table === 'sample_reviews') await deleteSampleEvents(client, ids);
  await deleteRows(table, client, ids);
  await upsertRows(table, originalRows);
}

async function callEndpoint(url, payload) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Syncview-Actor': 'A2 parity',
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

function normalizeGenerated(value, path = []) {
  if (Array.isArray(value)) return value.map((v, i) => normalizeGenerated(v, path.concat(String(i))));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    const inEvents = path.includes('sample_review_events') || path.includes('events');
    if (key === 'updated_at' || key === 'created_at' || key === 'ts' || /_status_at$/.test(key)) {
      out[key] = '<generated:timestamp>';
    } else if (key === 'id' && inEvents) {
      out[key] = '<generated:id>';
    } else {
      out[key] = normalizeGenerated(raw, path.concat(key));
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

function calendarRow(id, over = {}) {
  return Object.assign({
    client: CLIENT,
    id,
    updated_at: '2026-07-04T00:00:00.000Z',
    order_index: '0',
    scheduled_date: '2026-07-04',
    name: 'A2 calendar reorder seed',
    status: 'In Progress',
    video_status: 'In Progress',
    graphic_status: 'In Progress',
    caption_status: 'In Progress',
  }, over);
}

function sampleRow(id, over = {}) {
  return Object.assign({
    client: CLIENT,
    id,
    order_index: '0',
    name: 'A2 sample seed',
    asset_url: '',
    thumbnail_url: '',
    creative_direction: '',
    hide_creative_direction: '',
    linear_issue_id: '',
    graphic_linear_issue_id: '',
    status: 'In Progress',
    video_status: 'In Progress',
    graphic_status: 'In Progress',
    video_tweaks: '',
    graphic_tweaks: '',
    client_video_approved_at: '',
    client_graphic_approved_at: '',
    kasper_approved_at: '',
    kasper_approved_by: '',
    kasper_finished_at: '',
    kasper_closed_at: '',
    kasper_seen: '',
    kasper_approved_after_tweaks: '',
    thumb_rev: '',
    created_at: '2026-07-04T00:00:00.000Z',
    updated_at: '2026-07-04T00:00:00.000Z',
  }, over);
}

async function runWriterCase(testCase) {
  const originalRows = await readRows(testCase.table, CLIENT, testCase.ids);
  try {
    const runSide = async (url) => {
      await restoreTable(testCase.table, CLIENT, testCase.ids, originalRows);
      await upsertRows(testCase.table, testCase.seed || []);
      if (testCase.table === 'sample_reviews') await deleteSampleEvents(CLIENT, testCase.ids);
      const response = await callEndpoint(url, testCase.payload);
      await sleep(SETTLE_MS);
      const rows = await readRows(testCase.table, CLIENT, testCase.ids);
      const events = testCase.table === 'sample_reviews' ? await readSampleEvents(CLIENT, testCase.ids) : [];
      return { response, rows, events };
    };

    const oldResult = await runSide(testCase.oldUrl);
    const efResult = await runSide(testCase.efUrl);
    const oldStable = stable(normalizeGenerated({ response: oldResult.response, rows: oldResult.rows }));
    const efStable = stable(normalizeGenerated({ response: efResult.response, rows: efResult.rows }));
    if (oldStable !== efStable) {
      console.error(`\nFAIL ${testCase.name}`);
      console.error('--- n8n comparable ---');
      console.error(oldStable);
      console.error('--- edge comparable ---');
      console.error(efStable);
      if (testCase.table === 'sample_reviews') {
        console.error('--- normalized edge events (diagnostic) ---');
        console.error(stable(normalizeGenerated({ sample_review_events: efResult.events })));
      }
      return false;
    }
    if (typeof testCase.verify === 'function') {
      const err = testCase.verify(oldResult, efResult);
      if (err) {
        console.error(`\nFAIL ${testCase.name}`);
        console.error(err);
        return false;
      }
    }
    console.log(`PASS ${testCase.name}`);
    return true;
  } finally {
    await restoreTable(testCase.table, CLIENT, testCase.ids, originalRows);
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
  }
  return null;
}

function verifyNullDeliverableLinks(rowId, oldResult, efResult) {
  for (const [label, result] of [['n8n', oldResult], ['edge-function', efResult]]) {
    const row = result.rows.find(r => String(r.id) === rowId);
    if (!row) return `${label} missing deliverable-null row ${rowId}`;
    if (row.video_deliverable_id !== null) return `${label} video_deliverable_id stored ${JSON.stringify(row.video_deliverable_id)} instead of NULL`;
    if (row.graphic_deliverable_id !== null) return `${label} graphic_deliverable_id stored ${JSON.stringify(row.graphic_deliverable_id)} instead of NULL`;
  }
  return null;
}

function cases() {
  const run = Date.now().toString(36);
  const p = `a2_parity_${run}`;
  const vid = n => `https://linear.app/synchrosocial/issue/VID-A2P-${run}-${n}/a2-parity-${n}`;
  const gra = n => `https://linear.app/synchrosocial/issue/GRA-A2P-${run}-${n}/a2-parity-${n}`;
  const comment = (suffix, body, at) => ({
    id: `c_${run}_${suffix}`,
    author: 'A2 parity',
    role: 'smm',
    body,
    created_at: at,
    updated_at: at,
    audience: 'internal',
  });
  const keptComment = comment('kept', 'existing visible sample comment', '2026-07-04T01:00:00.000Z');
  const concurrentComment = comment('concurrent', 'stored after editor base', '2026-07-04T01:10:00.000Z');
  const addedComment = comment('added', 'incoming new sample comment', '2026-07-04T01:12:00.000Z');
  const seedComments = JSON.stringify([keptComment, concurrentComment]);
  const incomingComments = JSON.stringify([keptComment, addedComment]);

  return [
    {
      name: 'calendar-reorder-batch-shape',
      table: 'calendar_posts',
      ids: [`${p}_cal_a`, `${p}_cal_b`],
      seed: [
        calendarRow(`${p}_cal_a`, { order_index: '1' }),
        calendarRow(`${p}_cal_b`, { order_index: '2' }),
      ],
      payload: {
        client: CLIENT,
        items: [
          { id: `${p}_cal_a`, order_index: 2 },
          { id: `${p}_cal_b`, order_index: 1 },
        ],
      },
      oldUrl: OLD_CAL_REORDER_BATCH_URL,
      efUrl: EF_CAL_REORDER_URL,
    },
    {
      name: 'calendar-reorder-real-shaped',
      table: 'calendar_posts',
      ids: [`${p}_cal_real_a`, `${p}_cal_real_b`, `${p}_cal_real_c`],
      seed: [
        calendarRow(`${p}_cal_real_a`, { order_index: '10', name: 'Video 1 - Imported/Reorder A', linear_issue_id: vid(20), graphic_linear_issue_id: gra(20), video_status: 'For SMM Approval', graphic_status: 'Approved' }),
        calendarRow(`${p}_cal_real_b`, { order_index: '20', name: 'Video 2 - Imported/Reorder B', linear_issue_id: vid(21), graphic_linear_issue_id: gra(21), video_status: 'Kasper Approval', graphic_status: 'For SMM Approval' }),
        calendarRow(`${p}_cal_real_c`, { order_index: '30', name: 'Video 3 - Imported/Reorder C', linear_issue_id: vid(22), graphic_linear_issue_id: gra(22), video_status: 'In Progress', graphic_status: 'In Progress' }),
      ],
      payload: {
        client: CLIENT,
        items: [
          { id: `${p}_cal_real_c`, order_index: 10 },
          { id: `${p}_cal_real_a`, order_index: 20 },
          { id: `${p}_cal_real_b`, order_index: 30 },
        ],
      },
      oldUrl: OLD_CAL_REORDER_BATCH_URL,
      efUrl: EF_CAL_REORDER_URL,
    },
    {
      name: 'sample-review-reorder',
      table: 'sample_reviews',
      ids: [`${p}_sr_a`, `${p}_sr_b`],
      seed: [
        sampleRow(`${p}_sr_a`, { order_index: '1' }),
        sampleRow(`${p}_sr_b`, { order_index: '2' }),
      ],
      payload: {
        client: CLIENT,
        items: [
          { id: `${p}_sr_a`, order_index: 2 },
          { id: `${p}_sr_b`, order_index: 1 },
        ],
      },
      oldUrl: OLD_SAMPLE_REORDER_URL,
      efUrl: EF_SAMPLE_REORDER_URL,
    },
    {
      name: 'sample-review-reorder-real-shaped',
      table: 'sample_reviews',
      ids: [`${p}_sr_real_a`, `${p}_sr_real_b`, `${p}_sr_real_c`],
      seed: [
        sampleRow(`${p}_sr_real_a`, { order_index: '10', name: 'Sample 1 - Reorder A', asset_url: `https://frame.io/samples/${run}/a`, thumbnail_url: `https://drive.google.com/${run}/a`, linear_issue_id: vid(23), graphic_linear_issue_id: gra(23), video_status: 'For SMM Approval', graphic_status: 'Approved' }),
        sampleRow(`${p}_sr_real_b`, { order_index: '20', name: 'Sample 2 - Reorder B', asset_url: `https://frame.io/samples/${run}/b`, thumbnail_url: `https://drive.google.com/${run}/b`, linear_issue_id: vid(24), graphic_linear_issue_id: gra(24), video_status: 'Kasper Approval', graphic_status: 'For SMM Approval' }),
        sampleRow(`${p}_sr_real_c`, { order_index: '30', name: 'Sample 3 - Reorder C', asset_url: `https://frame.io/samples/${run}/c`, thumbnail_url: `https://drive.google.com/${run}/c`, linear_issue_id: vid(25), graphic_linear_issue_id: gra(25), video_status: 'In Progress', graphic_status: 'In Progress' }),
      ],
      payload: {
        client: CLIENT,
        items: [
          { id: `${p}_sr_real_c`, order_index: 10 },
          { id: `${p}_sr_real_a`, order_index: 20 },
          { id: `${p}_sr_real_b`, order_index: 30 },
        ],
      },
      oldUrl: OLD_SAMPLE_REORDER_URL,
      efUrl: EF_SAMPLE_REORDER_URL,
    },
    {
      name: 'sample-review-upsert-create',
      table: 'sample_reviews',
      ids: [`${p}_sr_create`],
      seed: [],
      payload: {
        client: CLIENT,
        sample: {
          id: `${p}_sr_create`,
          name: 'A2 parity sample create',
          status: 'In Progress',
          video_status: 'In Progress',
          graphic_status: 'In Progress',
          linear_issue_id: vid(1),
          graphic_linear_issue_id: gra(1),
          thumb_rev: run,
        },
      },
      oldUrl: OLD_SAMPLE_UPSERT_URL,
      efUrl: EF_SAMPLE_UPSERT_URL,
    },
    {
      name: 'sample-review-upsert-import-shaped',
      table: 'sample_reviews',
      ids: [`${p}_sr_import`],
      seed: [],
      payload: {
        client: CLIENT,
        sample: {
          id: `${p}_sr_import`,
          order_index: 42,
          name: 'Sample import - Real-client-shaped',
          asset_url: `https://frame.io/reviews/${run}/sample-import`,
          thumbnail_url: `https://drive.google.com/file/d/${run}-sample/view`,
          creative_direction: 'Use testimonial hook, warm background, and clean lower-third.',
          hide_creative_direction: '',
          status: 'In Progress',
          video_status: 'In Progress',
          graphic_status: 'For SMM Approval',
          linear_issue_id: vid(26),
          graphic_linear_issue_id: gra(26),
          thumb_rev: run,
          created_at: '2026-07-04T04:00:00.000Z',
        },
      },
      oldUrl: OLD_SAMPLE_UPSERT_URL,
      efUrl: EF_SAMPLE_UPSERT_URL,
    },
    {
      name: 'sample-review-upsert-kasper-shaped',
      table: 'sample_reviews',
      ids: [`${p}_sr_kasper`],
      seed: [sampleRow(`${p}_sr_kasper`, {
        name: 'A2 parity sample Kasper review',
        status: 'Kasper Approval',
        video_status: 'Kasper Approval',
        graphic_status: 'Approved',
        linear_issue_id: vid(27),
        graphic_linear_issue_id: gra(27),
        video_tweaks: JSON.stringify([comment('kasper_seed', 'SMM asked Kasper to review this sample', '2026-07-04T04:10:00.000Z')]),
        updated_at: '2026-07-04T04:15:00.000Z',
      })],
      payload: {
        client: CLIENT,
        comments_base_at: '2026-07-04T04:15:00.000Z',
        sample: {
          id: `${p}_sr_kasper`,
          status: 'Client Approval',
          video_status: 'Client Approval',
          kasper_approved_at: '2026-07-04T04:22:00.000Z',
          kasper_approved_by: 'Kasper',
          kasper_seen: 'video',
          kasper_approved_after_tweaks: 'video',
          kasper_finished_at: '2026-07-04T04:23:00.000Z',
          video_tweaks: JSON.stringify([
            comment('kasper_seed', 'SMM asked Kasper to review this sample', '2026-07-04T04:10:00.000Z'),
            comment('kasper_ok', 'Kasper approved this sample cut', '2026-07-04T04:22:00.000Z'),
          ]),
        },
      },
      oldUrl: OLD_SAMPLE_UPSERT_URL,
      efUrl: EF_SAMPLE_UPSERT_URL,
    },
    {
      name: 'sample-review-upsert-link-clobber',
      table: 'sample_reviews',
      ids: [`${p}_sr_clobber`],
      seed: [sampleRow(`${p}_sr_clobber`, { linear_issue_id: vid(2), updated_at: '2026-07-04T01:00:00.000Z' })],
      payload: {
        client: CLIENT,
        comments_base_at: '2026-07-04T01:00:00.000Z',
        sample: { id: `${p}_sr_clobber`, name: 'A2 clobber update', linear_issue_id: '', video_status: 'For SMM Approval' },
      },
      oldUrl: OLD_SAMPLE_UPSERT_URL,
      efUrl: EF_SAMPLE_UPSERT_URL,
    },
    {
      name: 'sample-review-upsert-clear-link',
      table: 'sample_reviews',
      ids: [`${p}_sr_clear`],
      seed: [sampleRow(`${p}_sr_clear`, { linear_issue_id: vid(3), updated_at: '2026-07-04T01:00:00.000Z' })],
      payload: {
        client: CLIENT,
        comments_base_at: '2026-07-04T01:00:00.000Z',
        sample: { id: `${p}_sr_clear`, linear_issue_id: '__CLEAR_LINK__', video_status: 'For SMM Approval' },
      },
      oldUrl: OLD_SAMPLE_UPSERT_URL,
      efUrl: EF_SAMPLE_UPSERT_URL,
    },
    {
      name: 'sample-review-upsert-deliverable-empty-string-null',
      table: 'sample_reviews',
      ids: [`${p}_sr_deliverable_null`],
      seed: [],
      payload: {
        client: CLIENT,
        sample: {
          id: `${p}_sr_deliverable_null`,
          name: 'A2 parity sample deliverable null coercion',
          asset_url: `https://frame.io/samples/${run}/deliverable-null`,
          thumbnail_url: `https://drive.google.com/${run}/deliverable-null`,
          creative_direction: 'Verify blank deliverable ids store NULL.',
          status: 'In Progress',
          video_status: 'In Progress',
          graphic_status: 'In Progress',
          video_deliverable_id: '',
          graphic_deliverable_id: '',
        },
      },
      oldUrl: OLD_SAMPLE_UPSERT_URL,
      efUrl: EF_SAMPLE_UPSERT_URL,
      verify: (oldResult, efResult) => verifyNullDeliverableLinks(`${p}_sr_deliverable_null`, oldResult, efResult),
    },
    {
      name: 'sample-review-upsert-conflict',
      table: 'sample_reviews',
      ids: [`${p}_sr_conflict`],
      seed: [sampleRow(`${p}_sr_conflict`, { status: 'In Progress', updated_at: '2026-07-04T02:00:00.000Z' })],
      payload: {
        client: CLIENT,
        comments_base_at: '2026-07-04T01:00:00.000Z',
        sample: { id: `${p}_sr_conflict`, status: 'Approved' },
      },
      oldUrl: OLD_SAMPLE_UPSERT_URL,
      efUrl: EF_SAMPLE_UPSERT_URL,
    },
    {
      name: 'sample-review-upsert-comment-merge',
      table: 'sample_reviews',
      ids: [`${p}_sr_comments`],
      seed: [sampleRow(`${p}_sr_comments`, {
        name: 'A2 parity sample comment merge',
        video_tweaks: seedComments,
        updated_at: '2026-07-04T01:11:00.000Z',
      })],
      payload: {
        client: CLIENT,
        comments_base_at: '2026-07-04T01:05:00.000Z',
        sample: { id: `${p}_sr_comments`, video_tweaks: incomingComments },
      },
      oldUrl: OLD_SAMPLE_UPSERT_URL,
      efUrl: EF_SAMPLE_UPSERT_URL,
      verify: (oldResult, efResult) => verifyMergedComments(
        `${p}_sr_comments`,
        [keptComment.id, concurrentComment.id, addedComment.id],
        oldResult,
        efResult,
      ),
    },
  ];
}

(async () => {
  console.log(`A2 writer parity: client=${CLIENT}`);
  let failed = 0;
  for (const c of cases()) {
    const ok = await runWriterCase(c);
    if (!ok) failed++;
  }
  if (failed) fail(`${failed} parity case(s) failed.`);
  console.log('A2 writer parity passed.');
})().catch(e => fail(e && e.stack ? e.stack : String(e)));
