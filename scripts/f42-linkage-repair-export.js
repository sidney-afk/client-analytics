#!/usr/bin/env node
'use strict';

// F42 Brick 1 — link-defect repair EXPORTER.
//
// Produces exactly the input shape scripts/f42-linkage-defect-repair.js plans
// from, plus the independent manifest that runner verifies before planning.
// The F42 comment exporter cannot be reused as-is: the repair planner needs
// per-component comment COUNTS (not bodies), the deliverable `kind` and Linear
// identity columns, and the card Linear link columns the fixture-exclusion
// policy reads — and it must NOT carry comment bodies at all.
//
// Public-safety: this snapshot is PRIVATE. It carries card ids, client slugs
// and Linear links. It must never be uploaded to a public Actions log or
// committed. It deliberately carries NO comment bodies — only counts — so even
// a mishandled snapshot cannot leak what anyone wrote.

const fs = require('fs');
const path = require('path');
const {
  SNAPSHOT_CONTRACT,
  buildSnapshotManifest,
} = require('./f42-linkage-defect-repair');

// Mirrors COMPONENT_FIELDS in scripts/f42-card-comment-import.js.
const COMPONENT_FIELDS = Object.freeze({
  video: ['comments', 'video_comments', 'video_tweaks'],
  graphic: ['graphic_comments', 'graphic_tweaks'],
  caption: ['caption_comments', 'caption_tweaks'],
  title: ['title_comments', 'title_tweaks'],
});

const CARD_FIELDS = Object.freeze([
  'id', 'client_slug', 'client', 'status',
  'video_deliverable_id', 'graphic_deliverable_id',
  'linear_issue_id', 'graphic_linear_issue_id',
]);

// The five crosswalk fields plus what Class A/B authority actually needs:
// `kind` (the card slot implies it) and the Linear identity columns.
const DELIVERABLE_FIELDS = Object.freeze([
  'id', 'client_slug', 'team', 'kind', 'origin', 'card_id', 'status',
  'linear_identifier', 'linear_issue_url',
]);

const SURFACE_TABLES = Object.freeze({ calendar: 'calendar_posts', sxr: 'sample_reviews' });

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function parsedArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || (typeof value === 'string' && !value.trim())) return [];
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

/* Comment COUNTS only. The repair planner needs to know whether a defect blocks
   real comments and how many; it never needs the text, so the text never enters
   the snapshot. */
function commentCounts(row) {
  const counts = {};
  for (const component of Object.keys(COMPONENT_FIELDS)) {
    let total = 0;
    for (const field of COMPONENT_FIELDS[component]) total += parsedArray(row && row[field]).length;
    counts[component] = total;
  }
  return counts;
}

function projectCard(row) {
  const source = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
  const card = { comment_counts: commentCounts(source) };
  for (const field of CARD_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, field)) card[field] = source[field];
  }
  return card;
}

function projectDeliverable(row) {
  const source = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
  const record = {};
  for (const field of DELIVERABLE_FIELDS) {
    record[field] = source[field] == null ? null : source[field];
  }
  return record;
}

async function fetchAllRows(config, table, fetchImpl) {
  const pageSize = Number(config.pageSize) > 0 ? Number(config.pageSize) : 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const url = `${config.url}/rest/v1/${table}?select=*&order=id.asc&limit=${pageSize}&offset=${offset}`;
    // eslint-disable-next-line no-await-in-loop
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
        Accept: 'application/json',
      },
    });
    // eslint-disable-next-line no-await-in-loop
    const payload = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(payload)) {
      throw new Error(`export_read_${table}_${response.status}`);
    }
    rows.push(...payload);
    if (payload.length < pageSize) break;
  }
  return rows;
}

/* A card is worth exporting only when it names a deliverable: the repair
   planner has nothing to say about a card with no link at all, and dropping
   them keeps the private snapshot as small as the job allows. */
function cardWorthExporting(card) {
  return !!(clean(card.video_deliverable_id) || clean(card.graphic_deliverable_id));
}

async function exportSnapshot(config = {}, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch_unavailable');
  if (!clean(config.url) || !clean(config.serviceKey)) throw new Error('supabase_configuration_required');
  const cards = {};
  for (const surface of Object.keys(SURFACE_TABLES)) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await fetchAllRows(config, SURFACE_TABLES[surface], fetchImpl);
    cards[surface] = rows.map(projectCard).filter(cardWorthExporting);
  }
  const deliverables = (await fetchAllRows(config, 'deliverables', fetchImpl))
    .map(projectDeliverable)
    .filter(row => clean(row.id))
    .sort((a, b) => clean(a.id).localeCompare(clean(b.id)));

  const snapshot = { contract: SNAPSHOT_CONTRACT, cards, deliverables };
  const generatedAt = typeof deps.now === 'function'
    ? deps.now()
    : new Date().toISOString();
  snapshot.manifest = buildSnapshotManifest(snapshot, generatedAt);
  return snapshot;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return args;
}

async function run(argv = process.argv.slice(2), env = process.env, deps = {}) {
  const args = parseArgs(argv);
  const snapshot = await exportSnapshot({
    url: clean(env.SUPABASE_URL).replace(/\/+$/, ''),
    serviceKey: clean(env.SUPABASE_SERVICE_ROLE_KEY),
    pageSize: env.F42_EXPORT_PAGE_SIZE,
  }, deps);
  const output = JSON.stringify(snapshot, null, 2) + '\n';
  if (args.output) (deps.writeFileSync || fs.writeFileSync)(path.resolve(String(args.output)), output);
  else process.stdout.write(output);
  // Counts only on stderr — safe for a run log.
  return {
    contract: snapshot.contract,
    calendar_cards: snapshot.cards.calendar.length,
    sxr_cards: snapshot.cards.sxr.length,
    deliverables: snapshot.deliverables.length,
    content_sha256: snapshot.manifest.content_sha256,
  };
}

if (require.main === module) {
  run().then(summary => {
    process.stderr.write(`${JSON.stringify(summary)}\n`);
  }).catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: clean(error && error.message) || 'export_failed' })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  CARD_FIELDS,
  COMPONENT_FIELDS,
  DELIVERABLE_FIELDS,
  SURFACE_TABLES,
  cardWorthExporting,
  commentCounts,
  exportSnapshot,
  projectCard,
  projectDeliverable,
  run,
};
