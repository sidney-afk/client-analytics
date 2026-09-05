#!/usr/bin/env node
'use strict';

// Local JSON in, allowlisted aggregates and opaque handles out. No network,
// subprocess, credentials, export, upload, rescue or persistence operations.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { ROOT, readerHelpers } = require('./reader-helpers');

const CONTRACT = 'syncview-linear-history-coverage-v1';
const REQUIRED = Object.freeze({
  calendar_posts: ['id', 'client', 'status', 'asset_url', 'thumbnail_url', 'thumbnail_folder_url', 'thumbnail_file_id', 'caption', 'cta', 'tweaks', 'video_tweaks', 'graphic_tweaks', 'caption_tweaks', 'title_tweaks'],
  sample_reviews: ['id', 'client', 'status', 'asset_url', 'thumbnail_url', 'thumbnail_folder_url', 'thumbnail_file_id', 'creative_direction', 'hide_creative_direction', 'video_tweaks', 'graphic_tweaks'],
  production_comments: ['id', 'client_slug', 'deliverable_id', 'parent_id', 'audience', 'role', 'body', 'body_format', 'attachments', 'deleted_at', 'resolved_at'],
  deliverables: ['id', 'card_id', 'client_slug', 'origin', 'team', 'brief'],
  thumbnail_media_revisions: ['id', 'surface', 'source_id', 'client', 'status', 'baseline_storage_path', 'latest_storage_path'],
  linear_archive: ['linear_uuid', 'client_slug', 'raw', 'comments'],
  linear_archive_asset_refs: ['ref_id', 'original_url', 'rescued_url', 'state'],
});
const STATES = ['independently_stored', 'provider_dependent', 'inaccessible', 'unsupported', 'unproven'];
const NEXT = Object.freeze({
  independently_stored: 'exact_card_anonymous_render_and_reopen_proof',
  provider_dependent: 'complete_reference_inventory_then_owner_scoped_preservation_gate',
  inaccessible: 'repeat_exact_principal_read_and_check_mapping_or_access',
  unsupported: 'supply_documented_format_and_add_extraction_fixture',
  unproven: 'supply_exact_mapping_and_independent_object_readback',
});
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const stamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const present = (row, field) => Object.prototype.hasOwnProperty.call(row, field);
function providerUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/\.$/, '');
    return host === 'linear.app' || host.endsWith('.linear.app');
  } catch (_) { return false; }
}
function httpUrl(value) {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; }
  catch (_) { return false; }
}

// Plain text, Markdown inline links/images, autolinks, reference definitions,
// and bare HTTP(S). Balanced parentheses remain part of the URL; punctuation
// is trimmed only at the end. No signed-query interpretation or HTTP probing.
function textUrls(value) {
  const refs = [];
  const re = /https?:\/\/[^\s<>"'\[\]`]+/gi;
  for (const match of value.matchAll(re)) {
    let url = match[0].replace(/[.,;!]+$/, '');
    while (url.endsWith(')') && (url.match(/\)/g) || []).length > (url.match(/\(/g) || []).length) url = url.slice(0, -1);
    refs.push(url);
  }
  return refs;
}

function inputCoverage(input) {
  const gaps = [];
  const m = object(input.metadata) ? input.metadata : {};
  if (!object(m.source) || !['synthetic', 'private_snapshot'].includes(m.source.kind)
      || typeof m.source.description !== 'string' || !m.source.description.trim()
      || !hex(m.source.artifact_sha256) || !stamp(m.captured_at)) gaps.push('source_metadata_missing');
  if (!Array.isArray(m.known_omissions)) gaps.push('omissions_metadata_missing');
  else if (m.known_omissions.length) gaps.push('known_omissions');
  const tables = [];
  for (const [table, fields] of Object.entries(REQUIRED)) {
    const spec = m.tables && m.tables[table];
    const rows = input.data && input.data[table];
    const p = spec && spec.pagination;
    const missingFields = fields.filter(f => !Array.isArray(spec && spec.fields) || !spec.fields.includes(f));
    const malformedRows = Array.isArray(rows) ? rows.filter(r => !object(r) || fields.some(f => !present(r, f))).length : 0;
    const idField = table === 'linear_archive' ? 'linear_uuid' : table === 'linear_archive_asset_refs' ? 'ref_id' : 'id';
    const identities = Array.isArray(rows) ? rows.filter(object).map(r => JSON.stringify([r.client || r.client_slug || '', r[idField]])) : [];
    const identityInvalid = Array.isArray(rows) && (rows.some(r => !object(r) || typeof r[idField] !== 'string' || !r[idField])
      || new Set(identities).size !== identities.length);
    const complete = !!(object(spec) && Array.isArray(rows) && !missingFields.length && !malformedRows
      && !identityInvalid
      && object(p) && p.complete === true && p.next_cursor === null
      && Number.isSafeInteger(p.expected_rows) && p.expected_rows >= 0
      && p.expected_rows === rows.length && p.returned_rows === rows.length);
    tables.push({ table, included: Array.isArray(rows), supplied_rows: Array.isArray(rows) ? rows.length : null,
      missing_required_fields: missingFields, malformed_rows: malformedRows, invalid_or_duplicate_identity: !!identityInvalid, declared_complete: complete });
    if (!complete) gaps.push('table_incomplete:' + table);
  }
  if (!Array.isArray(input.mappings)) gaps.push('mapping_evidence_not_supplied');
  if (!Array.isArray(input.observations)) gaps.push('retrieval_observations_not_supplied');
  if (object(input.data) && Object.keys(input.data).some(k => !present(REQUIRED, k))) gaps.push('unsupported_table');
  return { status: gaps.length ? 'incomplete' : 'declared_complete', gaps, tables,
    authority: 'supplier_declaration_not_independent_export_certification' };
}

function locatorEqual(a, b) {
  return object(a) && ['table', 'client_scope', 'row_id', 'field', 'ordinal'].every(k => a[k] === b[k]);
}
function validObservation(o, ref, capturedAt) {
  return locatorEqual(o.locator, ref.locator) && o.url === ref.value
    && o.principal === 'anonymous_client' && stamp(o.observed_at)
    && Date.parse(o.observed_at) <= Date.parse(capturedAt) && hex(o.evidence_sha256)
    && ['failure', 'retrieved'].includes(o.result);
}
function storageEvidence(mapping, ref, capturedAt) {
  const s = mapping.storage;
  return locatorEqual(mapping.locator, ref.locator) && mapping.source_url === ref.value
    && httpUrl(mapping.target_url) && !providerUrl(mapping.target_url)
    && object(mapping.mapping_observation) && stamp(mapping.mapping_observation.observed_at)
    && Date.parse(mapping.mapping_observation.observed_at) <= Date.parse(capturedAt)
    && hex(mapping.mapping_observation.evidence_sha256) && object(s)
    && s.provider_independent === true && stamp(s.observed_at)
    && Date.parse(s.observed_at) <= Date.parse(capturedAt)
    && hex(s.evidence_sha256) && hex(s.source_sha256) && s.source_sha256 === s.readback_sha256
    && Number.isSafeInteger(s.byte_length) && s.byte_length > 0;
}

async function scan(input, { key = crypto.randomBytes(32) } = {}) {
  if (!object(input) || input.contract !== CONTRACT) throw new Error('invalid_input_contract');
  const coverage = inputCoverage(input);
  const helpers = readerHelpers();
  const policy = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/production-comments/policy.mjs')).href);
  const opaque = value => crypto.createHmac('sha256', key).update(String(value)).digest('hex');
  const refs = [], gaps = [], threadCounts = { client_card_rows: 0, client_canonical_candidates: 0,
    staff_internal_rows: 0, archived_card_rows: 0, hidden_or_deleted_rows: 0, orphan_reply_rows: 0, resolved_roots: 0, reply_rows: 0 };
  const data = object(input.data) ? input.data : {};
  let sourceScope = '';
  const rows = table => Array.isArray(data[table]) ? data[table].filter(object) : [];
  function gap(code, table, row, field) {
    gaps.push({ code, table, location_hash: opaque(JSON.stringify([table, sourceScope, row, field])), next_gate: NEXT.unsupported });
  }
  function add(table, id, field, value, category, scope, lifecycle = 'not_thread') {
    refs.push({ locator: { table, client_scope: sourceScope, row_id: String(id || ''), field, ordinal: 0 }, value,
      category, scope, lifecycle, unsupported: !httpUrl(value) && category !== 'thumbnail_storage' });
  }
  function body(table, id, field, value, category, scope, lifecycle, format = 'text') {
    if (value == null || value === '') return;
    if (typeof value !== 'string' || !['text', 'plain', 'plaintext', 'markdown'].includes(format)) {
      gap('unsupported_body', table, id, field);
      refs.push({ locator: { table, client_scope: sourceScope, row_id: String(id || ''), field, ordinal: 0 }, value: JSON.stringify(value),
        category, scope, lifecycle, unsupported: true });
      return;
    }
    const found = textUrls(value);
    found.forEach((url, ordinal) => { add(table, id, field, url, category, scope, lifecycle); refs.at(-1).locator.ordinal = ordinal; });
    // Guard the supplementary F34 extractor's occurrences against scanner loss.
    // Parentheses can make F34's truncated token a prefix of the full token.
    const f34 = helpers.urlsFromText(value);
    if (f34.length > found.filter(providerUrl).length) gap('f34_extraction_disagreement', table, id, field);
    if (/\b(?:data|blob|ftp):|\]\((?!https?:\/\/)|<\s*(?:img|video|iframe)\b/i.test(value)) {
      gap('unsupported_embedded_reference', table, id, field);
      refs.push({ locator: { table, client_scope: sourceScope, row_id: String(id || ''), field, ordinal: found.length }, value,
        category, scope, lifecycle, unsupported: true });
    }
  }
  function attachments(table, id, field, value, scope, lifecycle) {
    if (value == null) return;
    if (!Array.isArray(value)) { body(table, id, field, value, 'attachment', scope, lifecycle, 'unsupported'); return; }
    value.forEach((a, i) => {
      const f = field + '.' + i;
      if (object(a) && typeof (a.url || a.href || a.file_url) === 'string') {
        add(table, id, f, a.url || a.href || a.file_url, 'attachment', scope, lifecycle);
        if (i >= 20) gap('attachment_beyond_canonical_reader_limit', table, id, f);
      } else body(table, id, f, a, 'attachment', scope, lifecycle, 'unsupported');
    });
  }
  function comments(table, id, field, list, canonical = false, archived = false) {
    const projected = canonical ? list.map(r => policy.publicComment(r, 'client')).filter(Boolean)
      .map(r => helpers._prodCanonicalCardComment(r)) : list;
    const client = canonical ? projected : helpers._prodRootAudienceClientRows(list);
    const roots = helpers._calCommentRoots(client);
    const visibleIds = new Set(roots.flatMap(r => [r, ...helpers._calCommentReplies(client, r.id)]).map(r => r.id));
    const byId = new Map(list.map(r => [r.id, r]));
    list.forEach((c, i) => {
      const loc = field + '.' + i;
      const deleted = !!(c.deleted || c.hidden || c.deleted_at);
      const orphan = !!(c.parent_id && !byId.has(c.parent_id));
      const scope = deleted ? 'hidden_or_deleted' : archived ? 'archived_card' : visibleIds.has(c.id)
        ? canonical ? 'client_canonical_candidate' : 'client_card_candidate'
        : orphan ? 'unproven_scope' : 'staff_internal';
      const root = c.parent_id && byId.get(c.parent_id) || c;
      const lifecycle = deleted ? 'hidden_or_deleted' : (root.done || root.resolved_at) ? 'resolved_history' : 'active_thread';
      if (deleted) threadCounts.hidden_or_deleted_rows++;
      else if (archived) threadCounts.archived_card_rows++;
      else if (scope === 'client_card_candidate') threadCounts.client_card_rows++;
      else if (scope === 'client_canonical_candidate') threadCounts.client_canonical_candidates++;
      else threadCounts.staff_internal_rows++;
      if (orphan) { threadCounts.orphan_reply_rows++; gap('orphan_reply_projection_unproven', table, id, loc); }
      if (c.parent_id) threadCounts.reply_rows++;
      if (!c.parent_id && (c.done || c.resolved_at)) threadCounts.resolved_roots++;
      body(table, id, loc + '.body', c.body, 'comment_body', scope, lifecycle, c.body_format || 'text');
      attachments(table, id, loc + '.attachments', c.attachments, scope, lifecycle);
    });
  }
  for (const table of ['calendar_posts', 'sample_reviews']) {
    for (const row of rows(table)) {
      sourceScope = String(row.client || '');
      const archived = String(row.status || '').toLowerCase() === 'archived';
      const cardScope = archived ? 'archived_card' : 'client_card_candidate';
      for (const field of ['asset_url', 'thumbnail_url', 'thumbnail_folder_url']) {
        if (row[field]) add(table, row.id, field, String(row[field]), 'card_media', cardScope);
      }
      if (row.thumbnail_file_id) body(table, row.id, 'thumbnail_file_id', row.thumbnail_file_id, 'card_media', cardScope, 'not_thread', 'unsupported');
      for (const field of ['caption', 'cta']) body(table, row.id, field, row[field], 'card_text', cardScope, 'not_thread');
      body(table, row.id, 'creative_direction', row.creative_direction, 'card_text', 'unproven_scope', 'not_thread');
      const sample = table === 'sample_reviews' ? helpers._sxrMigrateShape({ ...row }) : null;
      for (const comp of table === 'calendar_posts' ? ['video', 'graphic', 'caption', 'title'] : ['video', 'graphic']) {
        const field = comp + '_tweaks';
        const temp = { [field]: row[field] };
        // Calendar seeds legacy prose; Samples deliberately does not. Exercise
        // each real reader instead of importing Calendar's fallback into SXR.
        const list = sample ? sample[comp + '_comments'] : helpers._calLoadCommentsField(temp, field, comp === 'video' ? row.tweaks : '');
        if ((sample || temp)._incompleteByComponent?.[comp]) {
          gap('legacy_comment_parse_incomplete', table, row.id, field);
          body(table, row.id, field, row[field], 'comment_body', 'unproven_scope', 'unknown', 'unsupported');
        }
        comments(table, row.id, field, list, false, archived);
      }
    }
  }
  // Group canonical rows by deliverable so replies never inherit across issues.
  const groups = new Map();
  rows('production_comments').forEach(row => {
    const k = JSON.stringify([row.client_slug || '', row.deliverable_id || '']);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(row);
  });
  for (const [key, list] of groups) { const [client, id] = JSON.parse(key); sourceScope = client; comments('production_comments', id, 'thread', list, true); }
  for (const row of rows('deliverables')) { sourceScope = String(row.client_slug || ''); body('deliverables', row.id, 'brief', row.brief, 'deliverable_brief', 'staff_archive', 'not_thread'); }
  function archive(value, table, id, field, depth = 0) {
    if (depth > 20) { gap('archive_depth_unsupported', table, id, field); return; }
    if (typeof value === 'string') body(table, id, field, value, 'archive_reference', 'staff_archive', 'not_thread');
    else if (Array.isArray(value)) value.forEach((v, i) => archive(v, table, id, field + '.' + i, depth + 1));
    else if (object(value)) Object.entries(value).forEach(([k, v]) => archive(v, table, id, field + '.' + k, depth + 1));
  }
  rows('linear_archive').forEach(row => { sourceScope = String(row.client_slug || ''); archive(row, 'linear_archive', row.linear_uuid, 'archive'); });
  for (const row of rows('thumbnail_media_revisions')) {
    sourceScope = String(row.client || '');
    for (const field of ['baseline_storage_path', 'latest_storage_path']) {
      if (typeof row[field] === 'string' && row[field]) add('thumbnail_media_revisions', row.id, field, row[field], 'thumbnail_storage', 'client_history_candidate');
      else gap('thumbnail_object_path_missing', 'thumbnail_media_revisions', row.id, field);
    }
  }
  const mappings = Array.isArray(input.mappings) ? input.mappings.filter(object) : [];
  const observations = Array.isArray(input.observations) ? input.observations.filter(object) : [];
  const capturedAt = input.metadata && input.metadata.captured_at;
  // Future asset-bearing fields must be visible as coverage gaps, even when
  // a supplier declares pagination complete. Full archive JSON is handled above.
  for (const table of Object.keys(REQUIRED).filter(t => !['linear_archive', 'linear_archive_asset_refs'].includes(t))) {
    for (const row of rows(table)) {
      sourceScope = String(row.client || row.client_slug || '');
      for (const [field, value] of Object.entries(row)) {
        if (REQUIRED[table].includes(field) || ['caption', 'cta', 'creative_direction'].includes(field)) continue;
        if (/https?:\/\/|\b(?:blob|data|ftp):/i.test(JSON.stringify(value) || '')) {
          gap('unsupported_reference_field', table, row.id, field);
          body(table, row.id, field, value, 'unsupported_field', 'unproven_scope', 'unknown', 'unsupported');
        }
      }
    }
  }
  const duplicateLocations = new Set();
  const seenLocations = new Set();
  for (const ref of refs) {
    const loc = JSON.stringify(ref.locator);
    if (seenLocations.has(loc)) duplicateLocations.add(loc);
    seenLocations.add(loc);
  }
  const resultRows = refs.map(ref => {
    const matching = mappings.filter(m => locatorEqual(m.locator, ref.locator) && m.source_url === ref.value);
    const sidecarHint = rows('linear_archive_asset_refs').some(r => r.original_url === ref.value && r.rescued_url);
    const ambiguousLocation = duplicateLocations.has(JSON.stringify(ref.locator));
    const independent = !ambiguousLocation && matching.length === 1 && storageEvidence(matching[0], ref, capturedAt);
    const obs = ambiguousLocation ? [] : observations.filter(o => validObservation(o, ref, capturedAt));
    const mappedObs = ambiguousLocation || matching.length !== 1 ? [] : observations.filter(o =>
      validObservation(o, { ...ref, value: matching[0].target_url }, capturedAt));
    const observationConflict = new Set(obs.map(o => o.result)).size > 1;
    const failure = !observationConflict && obs.some(o => o.result === 'failure');
    const retrieval = !observationConflict && obs.some(o => o.result === 'retrieved' && hex(o.content_sha256) && o.rendered_correct === true);
    const state = ref.unsupported ? 'unsupported' : failure ? 'inaccessible' : independent ? 'independently_stored'
      : providerUrl(ref.value) && matching.length === 0 && !sidecarHint ? 'provider_dependent' : 'unproven';
    return {
      reference_hash: opaque(JSON.stringify(ref.locator)), resource_hash: opaque(ref.value),
      table: ref.locator.table, category: ref.category, scope: ref.scope, lifecycle: ref.lifecycle,
      classification: state, storage_independence: independent ? 'supplied_mapping_and_readback' : 'unproven',
      client_accessibility: observationConflict ? 'conflicting_observations' : failure ? 'supplied_failure'
        : retrieval ? 'supplied_retrieval_and_render_observation' : 'unproven',
      mapped_copy_accessibility: new Set(mappedObs.map(o => o.result)).size > 1 ? 'conflicting_observations'
        : mappedObs.some(o => o.result === 'failure') ? 'supplied_failure'
        : mappedObs.some(o => o.result === 'retrieved' && hex(o.content_sha256) && o.rendered_correct === true)
          ? 'supplied_retrieval_and_render_observation' : 'unproven',
      observed_at: obs.map(o => new Date(o.observed_at).toISOString()).sort(),
      observation_receipt_hashes: obs.map(o => o.evidence_sha256),
      storage_observed_at: independent ? new Date(matching[0].storage.observed_at).toISOString() : null,
      evidence_basis: ref.unsupported ? 'extraction_not_implemented' : failure ? 'supplied_observation'
        : independent ? 'supplied_mapping_and_storage_receipts'
        : state === 'provider_dependent' ? 'only_known_path_linear' : 'insufficient_evidence',
      next_gate: NEXT[state],
    };
  });
  const counts = Object.fromEntries(STATES.map(state => [state, resultRows.filter(r => r.classification === state).length]));
  const categoryCounts = {};
  for (const category of ['card_media', 'card_text', 'comment_body', 'attachment', 'deliverable_brief', 'archive_reference', 'thumbnail_storage', 'unsupported_field']) {
    categoryCounts[category] = resultRows.filter(r => r.category === category).length;
  }
  const scopeCounts = {};
  for (const scope of ['client_card_candidate', 'client_canonical_candidate', 'client_history_candidate', 'staff_internal', 'staff_archive', 'archived_card', 'hidden_or_deleted', 'unproven_scope']) {
    scopeCounts[scope] = Object.fromEntries(STATES.map(state => [state, resultRows.filter(r => r.scope === scope && r.classification === state).length]));
  }
  const incomplete = coverage.status === 'incomplete' || gaps.length > 0 || counts.unsupported > 0;
  return { contract: CONTRACT, evidence_class: 'OFFLINE_TEST', source_kind: input.metadata?.source?.kind === 'synthetic' ? 'synthetic' : 'private_snapshot',
    snapshot_digest: hash(JSON.stringify(input)), handle_scheme: 'per_run_random_hmac_sha256',
    input_coverage: coverage, status: incomplete ? 'incomplete' : 'bounded_inventory',
    estate_total_references: null, supplied_reference_occurrences: counts.unsupported ? null : resultRows.length,
    known_reference_occurrences: resultRows.length - counts.unsupported, unsupported_input_units: counts.unsupported,
    supplied_unique_resources: new Set(resultRows.filter(r => r.classification !== 'unsupported').map(r => r.resource_hash)).size,
    full_linear_independence: 'UNPROVEN', current_client_retrieval: 'NOT_TESTED', restore_drill: 'NOT_TESTED',
    counts, category_counts: categoryCounts, scope_counts: scopeCounts, thread_counts: threadCounts,
    sidecar_rows_supplied: rows('linear_archive_asset_refs').length,
    sidecar_note: 'sidecar_state_alone_not_verified_mapping_or_client_retrieval',
    extraction_gaps: gaps, references: resultRows };
}

async function main(argv) {
  if (argv.length !== 2 || argv[0] !== '--input' || !argv[1]) throw new Error('input_path_required');
  const filename = path.resolve(argv[1]);
  const size = fs.statSync(filename).size;
  if (size < 2 || size > 25 * 1024 * 1024) throw new Error('input_size_invalid');
  const input = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
  const report = await scan(input);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  return report.status === 'incomplete' ? 2 : 0;
}
if (require.main === module) main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(() => {
  // Parser/filesystem error messages can contain a private filename or body.
  process.stderr.write('{"status":"invalid_input","evidence_class":"OFFLINE_TEST","code":"input_or_helper_invalid"}\n');
  process.exitCode = 1;
});
module.exports = { CONTRACT, REQUIRED, scan, textUrls, providerUrl, inputCoverage, hash };
