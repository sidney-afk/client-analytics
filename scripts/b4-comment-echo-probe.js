'use strict';

/*
 * B4 gate probe for the B3 legacy-comment echo filter.
 *
 * The probe is deliberately TEST-only and fail-closed. It snapshots the
 * mirrored deliverable thread, adds one app-side comment through
 * deliverable_write, sends the matching legacy Linear comment, proves the
 * inbound webhook did not duplicate it, then deletes the Linear comment and
 * restores the original Supabase thread. Audit events remain as evidence.
 *
 * Required: B4_CONFIRM_TEST_MUTATIONS=1, B4_TEST_ISSUE,
 * SUPABASE_SERVICE_ROLE_KEY, LINEAR_API_KEY.
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const LINEAR_KEY = process.env.LINEAR_API_KEY || '';
const ISSUE = String(process.env.B4_TEST_ISSUE || '').trim().toUpperCase();
const LEGACY_COMMENT_URL = process.env.LINEAR_ADD_COMMENT_URL || 'https://synchrosocial.app.n8n.cloud/webhook/linear-add-comment';
const CONFIRMED = process.env.B4_CONFIRM_TEST_MUTATIONS === '1';
const MARKER = `b4-echo-${Date.now().toString(36)}`;
const STARTED_AT = new Date().toISOString();

if (!CONFIRMED) throw new Error('Set B4_CONFIRM_TEST_MUTATIONS=1 to run the TEST-only mutation probe');
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
if (!LINEAR_KEY) throw new Error('LINEAR_API_KEY is required for verification and cleanup');
if (!/^(VID|GRA)-\d+$/.test(ISSUE)) throw new Error('B4_TEST_ISSUE must be a TEST Linear identifier');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseThread(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

async function supabase(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${options.method || 'GET'} ${path} failed: HTTP ${response.status} ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : null;
}

async function deliverableWrite(snapshot, comments, action) {
  return supabase('rpc/deliverable_write', {
    method: 'POST',
    body: JSON.stringify({
      p_row: { ...snapshot, comments: JSON.stringify(comments) },
      p_event: {
        actor: 'B4 TEST probe',
        role: 'system',
        action,
        source: 'ui',
        probe: 'b4_comment_echo',
        marker: MARKER,
      },
    }),
  });
}

async function linear(query, variables) {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: LINEAR_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  if (!response.ok || body.errors) throw new Error(`Linear request failed: HTTP ${response.status} ${JSON.stringify(body.errors || body).slice(0, 240)}`);
  return body.data;
}

async function readLinearIssue() {
  const data = await linear(`
    query B4EchoIssue($id: String!) {
      issue(id: $id) {
        id identifier archivedAt canceledAt
        project { name }
        comments(first: 100) { nodes { id body createdAt } }
      }
    }
  `, { id: ISSUE });
  return data.issue;
}

async function deleteLinearComment(id) {
  const data = await linear(`
    mutation B4EchoCleanup($id: String!) {
      commentDelete(id: $id) { success }
    }
  `, { id });
  if (!data.commentDelete || data.commentDelete.success !== true) throw new Error('Linear comment cleanup was not acknowledged');
}

async function poll(fn, accept, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    latest = await fn();
    if (accept(latest)) return latest;
    await sleep(1000);
  }
  throw new Error(`${label} timed out`);
}

async function main() {
  const rows = await supabase(`deliverables?select=*&linear_identifier=eq.${encodeURIComponent(ISSUE)}&limit=2`);
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('TEST issue must resolve to exactly one deliverable');
  const row = rows[0];
  if (row.client_slug !== 'sidneylaruel') throw new Error('Refusing to mutate a non-TEST deliverable');

  const issue = await readLinearIssue();
  if (!issue || issue.identifier !== ISSUE || issue.archivedAt || issue.canceledAt) throw new Error('TEST Linear issue is unavailable or inactive');
  if (String(issue.project && issue.project.name || '').trim().toLowerCase() !== 'sidney laruel') {
    throw new Error('Refusing to mutate an issue outside the TEST project');
  }

  const originalThread = parseThread(row.comments);
  if (JSON.stringify(originalThread).includes(MARKER)) throw new Error('Probe marker unexpectedly exists before the run');
  const appComment = {
    role: 'admin',
    audience: 'internal',
    is_tweak: false,
    done: false,
    round: null,
    parent_id: null,
    author: 'B4 TEST probe',
    body: MARKER,
  };

  let linearCommentId = '';
  let cleanupError = null;
  const started = Date.now();
  try {
    await deliverableWrite(row, [...originalThread, appComment], 'b4_echo_probe_seed');

    const legacyResponse = await fetch(LEGACY_COMMENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue: ISSUE, body: MARKER, author: 'B4 TEST probe' }),
    });
    const legacyText = await legacyResponse.text();
    if (!legacyResponse.ok) throw new Error(`Legacy comment bridge failed: HTTP ${legacyResponse.status} ${legacyText.slice(0, 160)}`);

    const linearIssue = await poll(
      readLinearIssue,
      current => current.comments.nodes.filter(comment => String(comment.body || '').includes(MARKER)).length === 1,
      30000,
      'Linear comment creation',
    );
    const matches = linearIssue.comments.nodes.filter(comment => String(comment.body || '').includes(MARKER));
    linearCommentId = matches[0].id;
    const linearLatencyMs = Date.now() - started;

    // Give both subscribed Comments webhooks time to settle before checking the
    // app-side thread and mirror-event ledger.
    await sleep(8000);
    const afterRows = await supabase(`deliverables?select=id,comments&linear_identifier=eq.${encodeURIComponent(ISSUE)}&limit=2`);
    const afterThread = parseThread(afterRows[0] && afterRows[0].comments);
    const appCopies = afterThread.filter(comment => String(comment && comment.body || '').includes(MARKER)).length;
    if (appCopies !== 1) throw new Error(`Expected one app-side copy after echo settlement; found ${appCopies}`);

    const mirrorEvents = await supabase(
      `deliverable_events?select=id,action,payload&deliverable_id=eq.${encodeURIComponent(row.id)}` +
      `&action=eq.mirror_in_comment_add&ts=gte.${encodeURIComponent(STARTED_AT)}&order=id.asc`,
    );
    const duplicateEvents = (Array.isArray(mirrorEvents) ? mirrorEvents : []).filter(event =>
      event.payload && event.payload.linear_comment_id === linearCommentId,
    );
    if (duplicateEvents.length !== 0) throw new Error('Legacy echo produced a mirror_in_comment_add event instead of being dropped');

    console.log(JSON.stringify({
      ok: true,
      identifier: ISSUE,
      linear_comment_count: 1,
      app_comment_count: appCopies,
      duplicate_mirror_events: duplicateEvents.length,
      linear_create_latency_ms: linearLatencyMs,
      settled_after_ms: Date.now() - started,
      cleanup: 'pending',
    }, null, 2));
  } finally {
    try {
      if (linearCommentId) await deleteLinearComment(linearCommentId);
      await sleep(3000);
      await deliverableWrite(row, originalThread, 'b4_echo_probe_cleanup');
      const restored = await supabase(`deliverables?select=id,comments&linear_identifier=eq.${encodeURIComponent(ISSUE)}&limit=2`);
      if (JSON.stringify(parseThread(restored[0] && restored[0].comments)) !== JSON.stringify(originalThread)) {
        throw new Error('Supabase comment thread did not restore exactly');
      }
      const finalIssue = await readLinearIssue();
      if (finalIssue.comments.nodes.some(comment => String(comment.body || '').includes(MARKER))) {
        throw new Error('Linear probe comment still exists after cleanup');
      }
    } catch (error) {
      cleanupError = error;
    }
  }

  if (cleanupError) throw cleanupError;
  console.log(JSON.stringify({ ok: true, cleanup: 'complete', identifier: ISSUE }, null, 2));
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
