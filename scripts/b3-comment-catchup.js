'use strict';
/*
 * Track B B3 Stage 4: operational comment catch-up.
 *
 * Default mode is DRY-RUN. It reads existing live deliverables, fetches Linear
 * issue comments, and updates only linear_raw.issue.comments through the
 * deliverable_write RPC. It does not write Linear, cards, flags, n8n, or
 * non-comment deliverable fields.
 *
 *   node scripts/b3-comment-catchup.js
 *   APPLY=true CAP=1200 node scripts/b3-comment-catchup.js
 */
const fs = require('fs');
const path = require('path');
const { clean, parseJson, deliverableArchivedOrDeleted } = require('./linear-deliverables-reconcile-lib');

const args = new Map(process.argv.slice(2).map(a => {
  const m = String(a).match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] == null ? '1' : m[2]] : [a, '1'];
}));

const APPLY = process.argv.includes('--apply') || /^(1|true|yes)$/i.test(process.env.APPLY || '');
const SAFETY_CAP = Number(process.env.CAP || args.get('cap') || 1200);
const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/$/, '');
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const LINEAR_API_KEY = String(process.env.LINEAR_API_KEY || process.env.LINEAR_API_TOKEN || process.env.LINEAR_KEY || process.env.LINEAR_TOKEN || '');
const PAGE_DELAY_MS = Math.max(0, Number(args.get('page-delay-ms') || process.env.PAGE_DELAY_MS || 120));
const DETAILS_JSON = args.get('details-json') || '';

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function stableJson(v) {
  return JSON.stringify(v == null ? null : v);
}

function commentsSignature(comments) {
  const nodes = comments && Array.isArray(comments.nodes) ? comments.nodes : [];
  return stableJson(nodes.map(c => ({
    id: clean(c && c.id),
    body: String(c && c.body || ''),
    createdAt: clean(c && c.createdAt),
    user: c && c.user ? { id: clean(c.user.id), name: clean(c.user.name), email: clean(c.user.email) } : null,
  })));
}

function mergeCommentCatchupRaw(existingRaw, comments) {
  const raw = parseJson(existingRaw);
  const issue = raw.issue && typeof raw.issue === 'object' ? raw.issue : {};
  return Object.assign({}, raw, {
    issue: Object.assign({}, issue, { comments }),
    comment_catchup: {
      source: 'b3_stage4',
      fetched_at: new Date().toISOString(),
      node_count: Array.isArray(comments && comments.nodes) ? comments.nodes.length : 0,
      has_next_page: !!(comments && comments.pageInfo && comments.pageInfo.hasNextPage),
    },
  });
}

function planCommentCatchup(deliverables, commentByIssueId) {
  const planned = [];
  const skipped = [];
  for (const row of deliverables || []) {
    const issueId = clean(row.linear_issue_uuid);
    if (!issueId) {
      skipped.push({ reason: 'missing_linear_issue_uuid' });
      continue;
    }
    if (deliverableArchivedOrDeleted(row)) {
      skipped.push({ reason: 'archived_or_deleted' });
      continue;
    }
    const comments = commentByIssueId.get(issueId);
    if (!comments) {
      skipped.push({ reason: 'linear_issue_missing' });
      continue;
    }
    const raw = parseJson(row.linear_raw);
    const existingComments = raw.issue && raw.issue.comments ? raw.issue.comments : null;
    if (commentsSignature(existingComments) === commentsSignature(comments)) {
      skipped.push({ reason: 'comments_unchanged' });
      continue;
    }
    planned.push({
      id: clean(row.id),
      identifier: clean(row.identifier || row.linear_identifier),
      row: Object.assign({}, row, { linear_raw: mergeCommentCatchupRaw(row.linear_raw, comments) }),
      comment_count: Array.isArray(comments.nodes) ? comments.nodes.length : 0,
      has_next_page: !!(comments.pageInfo && comments.pageInfo.hasNextPage),
    });
  }
  return { planned, skipped };
}

function countBy(rows, keyFn) {
  const out = {};
  for (const row of rows || []) {
    const key = keyFn(row) || 'unknown';
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function summarizePlan(plan, checked) {
  return {
    deliverables_checked: checked,
    planned_writes: plan.planned.length,
    skipped: plan.skipped.length,
    planned_with_comment_overflow: plan.planned.filter(p => p.has_next_page).length,
    skipped_by_reason: countBy(plan.skipped, r => r.reason),
  };
}

async function linear(query, variables) {
  if (!LINEAR_API_KEY) fail('LINEAR_API_KEY is required');
  const resp = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { Authorization: LINEAR_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.errors) {
    throw new Error(`Linear GraphQL failed: HTTP ${resp.status} ${JSON.stringify(json && json.errors || json).slice(0, 500)}`);
  }
  return json.data;
}

function safeGraphqlString(v) {
  const s = clean(v);
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error(`Unsafe Linear id: ${s.slice(0, 20)}`);
  return JSON.stringify(s);
}

async function loadLinearComments(ids) {
  const out = new Map();
  const unique = [...new Set(ids.map(clean).filter(Boolean))];
  const chunkSize = 25;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const aliases = chunk.map((id, idx) => `i${idx}: issue(id: ${safeGraphqlString(id)}) { id identifier comments(first: 50) { nodes { id body createdAt user { id name email } } pageInfo { hasNextPage endCursor } } }`).join('\n');
    const data = await linear(`query B3CommentCatchup { ${aliases} }`);
    chunk.forEach((id, idx) => {
      const issue = data[`i${idx}`] || null;
      if (issue && issue.comments) out.set(id, issue.comments);
    });
    if (PAGE_DELAY_MS) await sleep(PAGE_DELAY_MS);
  }
  return out;
}

async function supabaseRows(table, select, params = '') {
  if (!SUPA_KEY) fail('SUPABASE_SERVICE_ROLE_KEY is required');
  const rows = [];
  let offset = 0;
  const limit = 1000;
  for (;;) {
    const url = `${SUPA_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=${limit}&offset=${offset}${params ? `&${params}` : ''}`;
    const resp = await fetch(url, { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Accept: 'application/json' } });
    if (!resp.ok) throw new Error(`Supabase ${table} HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
    const batch = await resp.json();
    rows.push(...batch);
    if (!Array.isArray(batch) || batch.length < limit) break;
    offset += limit;
  }
  return rows;
}

async function supabaseRpc(name, body) {
  const resp = await fetch(`${SUPA_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Supabase rpc ${name} HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
  return resp.json();
}

async function loadDeliverables() {
  return supabaseRows('deliverables',
    'id,identifier,batch_id,client_slug,team,kind,title,brief,status,status_at,assignee_id,due_date,priority,file_url,comments,origin,card_id,sort_key,sync_state,created_by,created_at,linear_issue_uuid,linear_identifier,linear_issue_url,linear_aliases,linear_raw',
    'order=team.asc,identifier.asc');
}

async function applyPlan(plan) {
  if (!APPLY) return { attempted: 0, skipped: plan.planned.length };
  if (plan.planned.length > SAFETY_CAP) {
    throw new Error(`Refusing to apply ${plan.planned.length} comment catch-up write(s); cap is ${SAFETY_CAP}`);
  }
  let attempted = 0;
  for (const item of plan.planned) {
    await supabaseRpc('deliverable_write', {
      p_row: item.row,
      p_event: {
        source: 'system',
        action: 'linear_comment_catchup',
        actor: 'codex-b3-comment-catchup',
        payload: {
          b3_stage4: true,
          linear_issue_uuid: item.row.linear_issue_uuid,
          comment_count: item.comment_count,
          has_next_page: item.has_next_page,
        },
      },
    });
    attempted++;
  }
  return { attempted, skipped: 0 };
}

function writeDetails(file, plan, summary, apply) {
  if (!file) return;
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(path.resolve(file), JSON.stringify({ summary, apply, plan }, null, 2));
}

async function main() {
  const deliverables = (await loadDeliverables()).filter(row => clean(row.linear_issue_uuid) && !deliverableArchivedOrDeleted(row));
  const comments = await loadLinearComments(deliverables.map(row => row.linear_issue_uuid));
  const plan = planCommentCatchup(deliverables, comments);
  const summary = summarizePlan(plan, deliverables.length);
  const apply = await applyPlan(plan);
  writeDetails(DETAILS_JSON, plan, summary, apply);
  console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', summary, apply }, null, 2));
}

if (require.main === module) {
  main().catch(err => {
    console.error(err && err.stack || err && err.message || String(err));
    process.exit(1);
  });
}

module.exports = {
  mergeCommentCatchupRaw,
  planCommentCatchup,
  summarizePlan,
};
