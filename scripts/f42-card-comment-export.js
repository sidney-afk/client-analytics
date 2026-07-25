#!/usr/bin/env node
'use strict';

// F42 card-comment EXPORTER. Reads the live Calendar and Samples/SXR source
// cards through the service-only PostgREST endpoint and emits the exact
// two-surface snapshot (+ its self-consistent coverage manifest) the source-only
// planner and apply runner consume. It projects each card down to ONLY the F42
// fields — identity, client slug, the video/graphic deliverable crosswalk, and
// the per-component comment/tweak arrays — so the snapshot never carries briefs,
// linear_raw, or other unrelated columns.
//
// This is what lets the import window run entirely from GitHub Actions with the
// repo's existing Supabase secrets: the plan and apply dispatches export a fresh
// snapshot from the pinned commit, never an improvised local dump. The database
// layer is injected (deps.fetch) so tests exercise the projection and manifest
// without a live backend.

const fs = require('fs');
const path = require('path');
const {
  COMPONENT_FIELDS,
  DELIVERABLE_FIELDS,
  SNAPSHOT_CONTRACT,
  sourceCoverage,
} = require('./f42-card-comment-import');

// The exact source fields the planner reads. Everything else on the row (brief,
// linear_raw, attachments the planner does not import, timestamps, etc.) is
// dropped so the private snapshot stays scoped to the comment import.
const IDENTITY_FIELDS = Object.freeze([
  'id', 'client_slug', 'client', 'video_deliverable_id', 'graphic_deliverable_id',
]);
const COMMENT_FIELDS = Object.freeze(
  [...new Set(Object.values(COMPONENT_FIELDS).flat())].sort(),
);
const PROJECTED_FIELDS = Object.freeze([...IDENTITY_FIELDS, ...COMMENT_FIELDS]);

const SURFACE_TABLES = Object.freeze({ calendar: 'calendar_posts', sxr: 'sample_reviews' });

function clean(value) {
  return String(value == null ? '' : value).trim();
}

// Keep only the F42 fields that are actually present on the row.
function projectCard(row) {
  const source = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
  const card = {};
  for (const field of PROJECTED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, field)) card[field] = source[field];
  }
  return card;
}

// A card is worth exporting only if it carries at least one non-empty comment
// array; comment-free cards contribute nothing to the import and only bloat the
// snapshot. Identity validation is the planner's job, not the exporter's.
function cardHasComments(card) {
  return COMMENT_FIELDS.some(field => {
    const value = card[field];
    if (Array.isArray(value)) return value.length > 0;
    return typeof value === 'string' && !!value.trim();
  });
}

async function fetchAllRows(config, table, fetchImpl) {
  const pageSize = Number(config.pageSize) > 0 ? Number(config.pageSize) : 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const url = `${config.url}/rest/v1/${table}?select=*&order=id.asc&limit=${pageSize}&offset=${offset}`;
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
        Accept: 'application/json',
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(payload)) {
      const error = new Error(`export_read_${table}_${response.status}`);
      error.payload = payload;
      throw error;
    }
    rows.push(...payload);
    if (payload.length < pageSize) break;
  }
  return rows;
}

async function exportSurface(config, surface, fetchImpl) {
  const table = SURFACE_TABLES[surface];
  if (!table) throw new Error(`unsupported_export_surface_${surface}`);
  const rows = await fetchAllRows(config, table, fetchImpl);
  return rows.map(projectCard).filter(cardHasComments);
}

// The deliverable crosswalk the import RPC validates every comment against: the
// row must exist, and its origin/team/client_slug/card_id must match the card
// the comment came from. Carrying it in the snapshot is what lets the planner
// certify a plan the RPC will actually accept. Projected to exactly the five
// crosswalk fields — never briefs, titles, linear_raw or other columns.
function projectDeliverable(row) {
  const source = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
  const record = {};
  for (const field of DELIVERABLE_FIELDS) {
    record[field] = source[field] == null ? null : source[field];
  }
  return record;
}

async function exportDeliverables(config, fetchImpl) {
  const rows = await fetchAllRows(config, 'deliverables', fetchImpl);
  return rows
    .map(projectDeliverable)
    .filter(row => clean(row.id))
    .sort((a, b) => clean(a.id).localeCompare(clean(b.id)));
}

async function exportSnapshot(config = {}, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch_unavailable');
  if (!clean(config.url) || !clean(config.serviceKey)) throw new Error('supabase_configuration_required');
  const calendar = await exportSurface(config, 'calendar', fetchImpl);
  const sxr = await exportSurface(config, 'sxr', fetchImpl);
  const deliverables = await exportDeliverables(config, fetchImpl);
  return {
    contract: SNAPSHOT_CONTRACT,
    surfaces: { calendar, sxr },
    deliverables,
    manifest: {
      surfaces: {
        calendar: sourceCoverage(calendar, 'calendar'),
        sxr: sourceCoverage(sxr, 'sxr'),
      },
    },
  };
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
    url: clean(env.SUPABASE_URL),
    serviceKey: clean(env.SUPABASE_SERVICE_ROLE_KEY),
    pageSize: env.F42_EXPORT_PAGE_SIZE,
  }, deps);
  const output = JSON.stringify(snapshot, null, 2) + '\n';
  if (args.output) fs.writeFileSync(path.resolve(String(args.output)), output);
  else process.stdout.write(output);
  return {
    contract: snapshot.contract,
    calendar_cards: snapshot.surfaces.calendar.length,
    sxr_cards: snapshot.surfaces.sxr.length,
    deliverables: snapshot.deliverables.length,
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
  COMMENT_FIELDS,
  PROJECTED_FIELDS,
  exportDeliverables,
  projectDeliverable,
  SURFACE_TABLES,
  cardHasComments,
  exportSnapshot,
  projectCard,
  run,
};
