'use strict';

/*
 * Track B B1 best-effort delivery-link sweep.
 *
 * Read-only and non-blocking. This pass reads Linear comments to propose
 * file_url annotations for the B1 backfill. Per spec section 5.6, this must not
 * be used as a constraint gate: if Linear rate limits are hot, skip this pass
 * and leave affected rows flagged for later file_url repair.
 */

const fs = require('fs');
const path = require('path');

const LINEAR_API_KEY = String(process.env.LINEAR_API_KEY
  || process.env.LINEAR_API_TOKEN
  || process.env.LINEAR_KEY
  || process.env.LINEAR_TOKEN
  || '').trim();
const SUPA_URL = process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co';
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args.set(a, process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : '1');
}

function fail(message) {
  console.error('B1 delivery-link sweep failed:', message);
  process.exit(1);
}

function clean(v) {
  return String(v == null ? '' : v).trim();
}

function deliveryLinksFromText(text) {
  const out = new Set();
  const re = /https?:\/\/[^\s)"'<>]+/gi;
  for (const m of clean(text).matchAll(re)) {
    const raw = normalizeDeliveryUrl(m[0]);
    const low = raw.toLowerCase();
    if (low.includes('drive.google.com') || /\bf\.io\//.test(low) || low.includes('app.frame.io')) out.add(raw);
  }
  return out;
}

function normalizeDeliveryUrl(url) {
  return clean(url)
    .split('](')[0]
    .replace(/\\_/g, '_')
    .replace(/[\]),.;]+$/g, '');
}

async function supabaseRows(table, select, params = '') {
  if (!SUPA_KEY) fail('SUPABASE_SERVICE_ROLE_KEY is required for --apply');
  const rows = [];
  let offset = 0;
  const limit = 1000;
  for (;;) {
    const resp = await fetch(`${SUPA_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=${limit}&offset=${offset}${params ? `&${params}` : ''}`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Accept: 'application/json' },
    });
    if (!resp.ok) throw new Error(`Supabase ${table} HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    const batch = await resp.json();
    rows.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return rows;
}

async function patchDeliverableFileUrl(id, fileUrl) {
  if (!SUPA_KEY) fail('SUPABASE_SERVICE_ROLE_KEY is required for --apply');
  const resp = await fetch(`${SUPA_URL}/rest/v1/deliverables?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ file_url: fileUrl }),
  });
  if (!resp.ok) throw new Error(`Supabase patch deliverables HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
  return resp.json();
}

async function linear(query, variables) {
  if (!LINEAR_API_KEY) fail('LINEAR_API_KEY or a supported Linear token env var is required');
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

async function loadIssuesWithComments() {
  const nodes = [];
  let after = null;
  const delay = Math.max(0, Number(args.get('--page-delay-ms') || 500));
  const maxPages = Math.max(0, Number(args.get('--max-pages') || 0));
  const query = `
    query B1DeliveryLinks($after: String) {
      issues(first: 100, after: $after, includeArchived: true) {
        nodes {
          id identifier title url createdAt completedAt archivedAt canceledAt
          team { key }
          state { type }
          comments(first: 50) {
            nodes { id body createdAt }
            pageInfo { hasNextPage endCursor }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`;
  for (let page = 1;; page++) {
    const data = await linear(query, { after });
    nodes.push(...data.issues.nodes);
    if (!data.issues.pageInfo.hasNextPage || (maxPages && page >= maxPages)) break;
    after = data.issues.pageInfo.endCursor;
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  }
  return nodes;
}

function isOpenTrackIssue(issue) {
  const team = issue && issue.team && issue.team.key;
  const type = issue && issue.state && issue.state.type;
  return (team === 'VID' || team === 'GRA')
    && !issue.archivedAt
    && !issue.completedAt
    && !issue.canceledAt
    && type !== 'completed'
    && type !== 'canceled';
}

function render(result) {
  const lines = [];
  lines.push('# B1 Delivery-Link Sweep');
  lines.push('');
  lines.push(`Generated: ${result.generated_at}`);
  lines.push('Status: best-effort, non-blocking; not part of the B1 constraint gate');
  lines.push(`Open VID/GRA issues scanned: ${result.open_track_issues_scanned}`);
  lines.push(`Issues with delivery links: ${result.with_delivery_links}`);
  lines.push(`Issues with 2+ distinct delivery links: ${result.multi_delivery_links}`);
  lines.push(`Issues with additional comment pages: ${result.comments_page_incomplete_count}`);
  lines.push(`Eligible single-link annotations: ${result.eligible_annotations}`);
  lines.push(`Applied file_url annotations: ${result.applied_annotations}`);
  lines.push(`Skipped because deliverable missing: ${result.missing_deliverables}`);
  lines.push(`Skipped because file_url already differed: ${result.file_url_conflicts}`);
  lines.push('');
  lines.push('Rows with multiple or incomplete comment-link evidence should keep `file_url` flagged for later repair.');
  if (result.samples.length) {
    lines.push('');
    lines.push('## Samples');
    lines.push('```json');
    lines.push(JSON.stringify(result.samples, null, 2));
    lines.push('```');
  }
  return lines.join('\n');
}

async function main() {
  const apply = args.has('--apply');
  const issues = await loadIssuesWithComments();
  const deliverables = apply
    ? await supabaseRows('deliverables', 'id,linear_issue_uuid,file_url')
    : [];
  const deliverableByUuid = new Map(deliverables.map(d => [clean(d.linear_issue_uuid), d]).filter(([k]) => k));
  const annotations = [];
  let truncated = 0;
  let applied = 0;
  let missingDeliverables = 0;
  let fileUrlConflicts = 0;
  for (const issue of issues.filter(isOpenTrackIssue)) {
    const links = [];
    const seen = new Set();
    const conn = issue.comments || { nodes: [], pageInfo: {} };
    if (conn.pageInfo && conn.pageInfo.hasNextPage) truncated++;
    for (const comment of conn.nodes || []) {
      for (const url of deliveryLinksFromText(comment.body)) {
        if (seen.has(url)) continue;
        seen.add(url);
        links.push({ url, comment_id: comment.id, comment_created_at: comment.createdAt });
      }
    }
    if (links.length) {
      const needsReview = links.length > 1 || !!(conn.pageInfo && conn.pageInfo.hasNextPage);
      const deliverable = deliverableByUuid.get(clean(issue.id));
      if (apply && !needsReview) {
        if (!deliverable) {
          missingDeliverables++;
        } else if (clean(deliverable.file_url) && normalizeDeliveryUrl(deliverable.file_url) !== links[links.length - 1].url) {
          fileUrlConflicts++;
        } else if (!clean(deliverable.file_url) || clean(deliverable.file_url) !== links[links.length - 1].url) {
          await patchDeliverableFileUrl(deliverable.id, links[links.length - 1].url);
          applied++;
        }
      }
      annotations.push({
        linear_issue_uuid: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        proposed_file_url: links[links.length - 1].url,
        link_count: links.length,
        needs_file_url_repair_review: needsReview,
        apply_status: !apply
          ? 'not_applied'
          : needsReview
            ? 'needs_review'
            : !deliverable
              ? 'missing_deliverable'
              : clean(deliverable.file_url) && normalizeDeliveryUrl(deliverable.file_url) !== links[links.length - 1].url
                ? 'existing_file_url_conflict'
                : clean(deliverable.file_url)
                  ? 'already_set'
                  : 'applied',
        links,
      });
    }
  }
  const result = {
    generated_at: new Date().toISOString(),
    status: 'best_effort_non_blocking',
    open_track_issues_scanned: issues.filter(isOpenTrackIssue).length,
    with_delivery_links: annotations.length,
    multi_delivery_links: annotations.filter(a => a.link_count > 1).length,
    comments_page_incomplete_count: truncated,
    eligible_annotations: annotations.filter(a => !a.needs_file_url_repair_review).length,
    applied_annotations: applied,
    missing_deliverables: missingDeliverables,
    file_url_conflicts: fileUrlConflicts,
    annotations,
    samples: annotations.filter(a => a.needs_file_url_repair_review).slice(0, 20),
  };
  const jsonPath = args.get('--json-out');
  if (jsonPath) {
    fs.mkdirSync(path.dirname(path.resolve(jsonPath)), { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  }
  const out = args.get('--out');
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, render(result));
  }
  console.log(render(result));
}

main().catch(err => fail(err && err.stack ? err.stack : String(err)));
