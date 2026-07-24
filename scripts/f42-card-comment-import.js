#!/usr/bin/env node
'use strict';

// F42 source-only planner for Calendar/Samples card comment arrays.
// It never connects to Supabase or mutates a source row. The owner-approved
// import step feeds `imports[].link/comment/event` to the service-only
// production_comment_card_import RPC after reviewing every conflict.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SNAPSHOT_CONTRACT = 'syncview-f42-card-comment-snapshot-v1';
const SURFACES = Object.freeze(['calendar', 'sxr']);
const COMPONENT_FIELDS = Object.freeze({
  video: ['comments', 'video_comments', 'video_tweaks'],
  graphic: ['graphic_comments', 'graphic_tweaks'],
  caption: ['caption_comments', 'caption_tweaks'],
  title: ['title_comments', 'title_tweaks'],
});

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function parsedArray(value) {
  if (Array.isArray(value)) return { values: value, malformed: false, present: true };
  if (value == null || (typeof value === 'string' && !value.trim())) {
    return { values: [], malformed: false, present: false };
  }
  if (typeof value !== 'string') {
    return { values: [], malformed: true, present: true };
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? { values: parsed, malformed: false, present: true }
      : { values: [], malformed: true, present: true };
  } catch (_error) {
    return { values: [], malformed: true, present: true };
  }
}

function arrayValue(value) {
  return parsedArray(value).values;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function sha(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function productionId(surface, cardId, component, nativeId) {
  return 'pc_card_' + crypto.createHash('sha256')
    .update([surface, cardId, component, nativeId].join(':'))
    .digest('hex');
}

function safeAttachments(value) {
  return arrayValue(value).slice(0, 20).map(raw => {
    const item = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const url = clean(item.url || item.href || item.file_url);
    if (!/^https:\/\/[^\s]+$/i.test(url)) return null;
    return {
      url,
      name: clean(item.name || item.title || item.filename).slice(0, 240) || 'Attachment',
    };
  }).filter(Boolean);
}

// safeAttachments sanitizes silently (a non-array field or a non-object entry
// both collapse to `[]`), which is correct for the read projection but wrong
// for the import planner: an owner-approved plan must never permanently drop
// attachment evidence. This surfaces the structural malformation the sanitizer
// would otherwise swallow — a nonempty non-array/invalid-JSON field, or an array
// entry that is not an object — as a blocking conflict. A well-formed object
// whose URL is merely non-HTTPS stays a policy sanitization, not a malformation.
function attachmentConflicts(value, scope = {}) {
  const out = [];
  const parsed = parsedArray(value);
  if (parsed.malformed) {
    out.push({
      classification: 'malformed_attachment_field',
      surface: clean(scope.surface) || null,
      card_id: clean(scope.cardId) || null,
      component: clean(scope.component) || null,
      native_comment_id: clean(scope.nativeId) || null,
      reason: 'nonempty_attachments_is_not_an_array',
    });
    return out;
  }
  parsed.values.forEach((item, sourceIndex) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      out.push({
        classification: 'malformed_attachment_entry',
        surface: clean(scope.surface) || null,
        card_id: clean(scope.cardId) || null,
        component: clean(scope.component) || null,
        native_comment_id: clean(scope.nativeId) || null,
        source_index: sourceIndex,
        reason: 'attachment_entry_is_not_an_object',
      });
    }
  });
  return out;
}

// Every lifecycle field the planner copies is cast to timestamptz by the import
// RPC. A nonempty malformed value would only fail mid-apply — after earlier
// rows already imported — so validate them at plan time and block instead of
// certifying an apply-unsafe plan.
const LIFECYCLE_TIMESTAMP_FIELDS = Object.freeze([
  'created_at', 'createdAt', 'ts',
  'updated_at', 'updatedAt',
  'edited_at', 'deleted_at', 'done_at', 'resolved_at',
]);

function isValidTimestampValue(value) {
  if (value == null) return true;
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text) return true;
  return Number.isFinite(Date.parse(text));
}

function lifecycleTimestampConflicts(raw, scope = {}) {
  const out = [];
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  for (const field of LIFECYCLE_TIMESTAMP_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) continue;
    if (isValidTimestampValue(source[field])) continue;
    out.push({
      classification: 'malformed_lifecycle_timestamp',
      surface: clean(scope.surface) || null,
      card_id: clean(scope.cardId) || null,
      component: clean(scope.component) || null,
      native_comment_id: clean(scope.nativeId) || null,
      source_field: field,
      reason: typeof source[field] === 'string'
        ? 'unparseable_timestamp'
        : 'timestamp_is_not_a_string',
    });
  }
  return out;
}

function commentsFor(row, component, conflicts = null, scope = {}) {
  const comments = [];
  for (const field of COMPONENT_FIELDS[component] || []) {
    const parsed = parsedArray(row && row[field]);
    if (parsed.malformed && Array.isArray(conflicts)) {
      conflicts.push({
        classification: 'malformed_comment_field',
        surface: clean(scope.surface) || null,
        card_id: clean(scope.cardId) || null,
        row_index: Number.isInteger(scope.rowIndex) ? scope.rowIndex : null,
        component,
        source_field: field,
        reason: 'nonempty_field_is_not_an_array',
      });
    }
    parsed.values.forEach((item, sourceIndex) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        if (Array.isArray(conflicts)) {
          conflicts.push({
            classification: 'malformed_comment_field',
            surface: clean(scope.surface) || null,
            card_id: clean(scope.cardId) || null,
            row_index: Number.isInteger(scope.rowIndex) ? scope.rowIndex : null,
            component,
            source_field: field,
            source_index: sourceIndex,
            reason: 'comment_entry_is_not_an_object',
          });
        }
        return;
      }
      // Preserve duplicates until fingerprint classification. The same card
      // shape commonly aliases `comments` and `video_comments`; exact copies
      // collapse later, while divergent copies of one id become a visible
      // duplicate_identity conflict instead of first-row-wins data loss.
      comments.push({ ...item, _source_field: field, _source_index: sourceIndex });
    });
  }
  return comments;
}

function deliverableId(row, component) {
  return clean(component === 'graphic'
    ? row && row.graphic_deliverable_id
    : row && row.video_deliverable_id);
}

function teamForComponent(component) {
  return component === 'graphic' ? 'graphics' : 'video';
}

function sourceCoverage(input, surface) {
  const rows = Array.isArray(input) ? input : [];
  const normalizedSurface = clean(surface).toLowerCase();
  if (!SURFACES.includes(normalizedSurface)) {
    throw new Error('surface must be calendar or sxr');
  }
  const comments = Object.fromEntries(Object.keys(COMPONENT_FIELDS).map(component => [component, 0]));
  for (const row of rows) {
    for (const component of Object.keys(COMPONENT_FIELDS)) {
      for (const field of COMPONENT_FIELDS[component]) {
        comments[component] += parsedArray(row && row[field]).values.length;
      }
    }
  }
  return {
    cards: rows.length,
    comments,
    source_sha256: sha({
      contract: SNAPSHOT_CONTRACT,
      surface: normalizedSurface,
      rows,
    }),
  };
}

function manifestMismatches(expected, actual) {
  const mismatches = [];
  const row = expected && typeof expected === 'object' && !Array.isArray(expected)
    ? expected
    : {};
  if (!Number.isInteger(row.cards) || row.cards < 0) mismatches.push('cards:invalid');
  else if (row.cards !== actual.cards) mismatches.push('cards');
  const comments = row.comments && typeof row.comments === 'object' && !Array.isArray(row.comments)
    ? row.comments
    : {};
  for (const component of Object.keys(COMPONENT_FIELDS)) {
    if (!Number.isInteger(comments[component]) || comments[component] < 0) {
      mismatches.push(`comments.${component}:invalid`);
    } else if (comments[component] !== actual.comments[component]) {
      mismatches.push(`comments.${component}`);
    }
  }
  if (!/^[a-f0-9]{64}$/.test(clean(row.source_sha256).toLowerCase())) {
    mismatches.push('source_sha256:invalid');
  } else if (clean(row.source_sha256).toLowerCase() !== actual.source_sha256) {
    mismatches.push('source_sha256');
  }
  return mismatches;
}

function topologicallyOrder(candidates, conflicts) {
  const byId = new Map(candidates.map(candidate => [candidate.comment.id, candidate]));
  const state = new Map();
  const ordered = [];
  const cycleIds = new Set();
  const missing = new Set();

  function visit(candidate, stack) {
    const id = candidate.comment.id;
    const status = state.get(id);
    if (status === 'done') return;
    if (status === 'visiting') {
      const start = stack.indexOf(id);
      (start >= 0 ? stack.slice(start) : [id]).forEach(value => cycleIds.add(value));
      cycleIds.add(id);
      return;
    }
    state.set(id, 'visiting');
    const parentId = clean(candidate.comment.parent_id);
    if (parentId) {
      const parent = byId.get(parentId);
      if (!parent) {
        if (!missing.has(id)) {
          missing.add(id);
          conflicts.push({
            classification: 'missing_parent',
            identity: candidate.identity,
            native_comment_id: candidate.nativeId,
            parent_production_id: parentId,
          });
        }
      } else {
        visit(parent, [...stack, id]);
      }
    }
    state.set(id, 'done');
    ordered.push(candidate);
  }

  candidates.slice().sort((a, b) => a.identity.localeCompare(b.identity))
    .forEach(candidate => visit(candidate, []));
  if (cycleIds.size) {
    conflicts.push({
      classification: 'parent_cycle',
      identities: [...cycleIds]
        .map(id => byId.get(id))
        .filter(Boolean)
        .map(candidate => candidate.identity)
        .sort(),
    });
  }
  const invalid = new Set([...cycleIds, ...missing]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of candidates) {
      if (invalid.has(candidate.comment.id)) continue;
      if (invalid.has(clean(candidate.comment.parent_id))) {
        invalid.add(candidate.comment.id);
        changed = true;
      }
    }
  }
  return ordered.filter(candidate => !invalid.has(candidate.comment.id));
}

function normalizeComment(raw, scope, parentProductionId) {
  const sourceCreatedAt = clean(raw.created_at || raw.createdAt || raw.ts || raw.updated_at);
  const sourceUpdatedAt = clean(raw.updated_at || raw.updatedAt || sourceCreatedAt);
  const deletedAt = raw.deleted === true || raw.is_deleted === true
    ? sourceUpdatedAt
    : clean(raw.deleted_at) || null;
  const resolvedAt = raw.done === true || raw.resolved === true
    ? clean(raw.done_at || sourceUpdatedAt)
    : clean(raw.resolved_at) || null;
  const role = clean(raw.role || 'smm').toLowerCase();
  const audience = clean(raw.audience).toLowerCase() === 'client' || role === 'client'
    ? 'client'
    : 'internal';
  return {
    id: scope.productionId,
    // The legacy id is only unique inside its card/component store. Keep that
    // raw identity in the crosswalk/provenance and use the composite-derived
    // canonical id for the globally-unique production_comments native key.
    native_comment_id: scope.productionId,
    deliverable_id: scope.deliverableId,
    team: scope.team || null,
    operation: 'upsert',
    author_key: `legacy:${scope.surface}:${scope.cardId}:${clean(raw.author || raw.author_name || role) || 'unknown'}`,
    author_name: clean(raw.author || raw.author_name) || (role === 'client' ? 'Client' : 'SyncView'),
    role,
    body: deletedAt ? '' : String(raw.body == null ? '' : raw.body),
    body_format: 'markdown',
    attachments: safeAttachments(raw.attachments),
    audience,
    parent_id: parentProductionId || null,
    component: scope.component,
    // Historical tweak arrays often omitted the redundant flag. The source
    // field is durable provenance, while an explicit flag remains preserved.
    is_tweak: raw.is_tweak === true || /_tweaks$/.test(clean(raw._source_field)),
    round: Number.isInteger(Number(raw.round)) ? Number(raw.round) : null,
    source_created_at: sourceCreatedAt || sourceUpdatedAt || new Date(0).toISOString(),
    source_updated_at: sourceUpdatedAt || sourceCreatedAt || new Date(0).toISOString(),
    edited_at: clean(raw.edited_at) || null,
    deleted_at: deletedAt,
    resolved_at: resolvedAt,
    resolved_by_name: resolvedAt ? clean(raw.done_by || raw.resolved_by_name) || null : null,
    import_run_id: scope.importRunId,
    backfill_tag: 'f42-card-thread',
  };
}

function planSurface(input, options = {}) {
  const rows = Array.isArray(input) ? input : [];
  const surface = clean(options.surface || 'calendar').toLowerCase();
  if (!SURFACES.includes(surface)) throw new Error('surface must be calendar or sxr');
  const importRunId = clean(options.importRunId) || `f42-card-thread-${surface}-dry-run`;
  const candidates = [];
  const conflicts = [];

  rows.forEach((row, rowIndex) => {
    const cardId = clean(row && row.id);
    if (!cardId) {
      conflicts.push({ classification: 'missing_card_id', row_index: rowIndex });
      return;
    }
    for (const component of Object.keys(COMPONENT_FIELDS)) {
      const list = commentsFor(row, component, conflicts, {
        surface,
        cardId,
        rowIndex,
      });
      if (!list.length) continue;
      const sourceClientSlug = clean(row && (row.client_slug || row.client) || options.clientSlug);
      if (!sourceClientSlug) {
        list.forEach(raw => conflicts.push({
          classification: 'missing_client_slug',
          surface, card_id: cardId, component,
          native_comment_id: clean(raw.id || raw.comment_id || raw.native_comment_id) || null,
        }));
        continue;
      }
      const targetId = deliverableId(row, component);
      if (!targetId) {
        list.forEach(raw => conflicts.push({
          classification: 'missing_deliverable_id',
          surface, card_id: cardId, component,
          native_comment_id: clean(raw.id || raw.comment_id || raw.native_comment_id) || null,
        }));
        continue;
      }
      const idMap = new Map();
      list.forEach(raw => {
        const nativeId = clean(raw.id || raw.comment_id || raw.native_comment_id);
        if (nativeId) idMap.set(nativeId, productionId(surface, cardId, component, nativeId));
      });
      list.forEach(raw => {
        const nativeId = clean(raw.id || raw.comment_id || raw.native_comment_id);
        if (!nativeId) {
          conflicts.push({ classification: 'missing_comment_id', surface, card_id: cardId, component });
          return;
        }
        const parentNativeId = clean(raw.parent_id || raw.parentId);
        if (parentNativeId && !idMap.has(parentNativeId)) {
          conflicts.push({
            classification: 'missing_parent', surface, card_id: cardId,
            component, native_comment_id: nativeId, parent_id: parentNativeId,
          });
          return;
        }
        const scope = {
          surface, cardId, component, nativeId, deliverableId: targetId,
          productionId: idMap.get(nativeId), importRunId,
          // Card exports do not reliably carry a row-level team. The linked
          // slot is the canonical contract: graphic -> Graphics; every
          // video/caption/title thread shares the Video deliverable.
          team: teamForComponent(component),
        };
        const comment = normalizeComment(raw, scope, parentNativeId ? idMap.get(parentNativeId) : null);
        if (!comment.body && !comment.deleted_at) {
          conflicts.push({
            classification: 'invalid_comment', surface, card_id: cardId,
            component, native_comment_id: nativeId, reason: 'empty_body',
          });
          return;
        }
        // Block apply-unsafe rows before they can be certified: malformed
        // lifecycle timestamps would fail the timestamptz cast mid-apply, and
        // structurally malformed attachments would silently drop evidence.
        const unsafe = [
          ...lifecycleTimestampConflicts(raw, scope),
          ...attachmentConflicts(raw.attachments, scope),
        ];
        if (unsafe.length) {
          unsafe.forEach(conflict => conflicts.push(conflict));
          return;
        }
        // Run identity is operational provenance, not source content. Keeping
        // it out of the fingerprint makes an identical owner-approved rerun
        // idempotent instead of conflicting solely because the run id changed.
        const { import_run_id: _runId, ...fingerprintComment } = comment;
        const sourceFingerprint = sha({
          surface, cardId, component, nativeId, deliverableId: targetId,
          clientSlug: sourceClientSlug, comment: fingerprintComment,
        });
        candidates.push({
          identity: [surface, cardId, component, nativeId].join('|'),
          nativeId,
          link: {
            source_surface: surface,
            card_id: cardId,
            component,
            native_comment_id: nativeId,
            deliverable_id: targetId,
            client_slug: sourceClientSlug,
            team: teamForComponent(component),
            source_fingerprint: sourceFingerprint,
          },
          comment,
          event: {
            source: 'backfill',
            action: 'f42_card_comment_import',
            actor: 'f42-card-comment-import',
            role: 'service',
            import_run_id: importRunId,
          },
        });
      });
    }
  });

  const byIdentity = new Map();
  const imports = [];
  for (const candidate of candidates) {
    const existing = byIdentity.get(candidate.identity);
    if (existing) {
      if (existing.link.source_fingerprint !== candidate.link.source_fingerprint) {
        conflicts.push({
          classification: 'duplicate_identity',
          identity: candidate.identity,
          fingerprints: [existing.link.source_fingerprint, candidate.link.source_fingerprint],
        });
      }
      continue;
    }
    byIdentity.set(candidate.identity, candidate);
    imports.push(candidate);
  }

  const orderedImports = topologicallyOrder(imports, conflicts);
  return {
    source_only: true,
    surface,
    import_run_id: importRunId,
    input_rows: rows.length,
    coverage: sourceCoverage(rows, surface),
    imports: orderedImports,
    conflicts,
    complete: conflicts.length === 0,
  };
}

function planCardCommentImport(input, options = {}) {
  if (Array.isArray(input)) {
    const plan = planSurface(input, options);
    plan.conflicts.unshift({
      classification: 'snapshot_contract_required',
      surface: plan.surface,
      reason: 'both_calendar_and_sxr_with_manifest_required',
    });
    return {
      ...plan,
      contract: null,
      complete: false,
    };
  }

  const snapshot = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const snapshotSurfaces = snapshot.surfaces
    && typeof snapshot.surfaces === 'object'
    && !Array.isArray(snapshot.surfaces)
    ? snapshot.surfaces
    : {};
  const manifest = snapshot.manifest
    && typeof snapshot.manifest === 'object'
    && !Array.isArray(snapshot.manifest)
    ? snapshot.manifest
    : {};
  const manifestSurfaces = manifest.surfaces
    && typeof manifest.surfaces === 'object'
    && !Array.isArray(manifest.surfaces)
    ? manifest.surfaces
    : {};
  const importRunId = clean(options.importRunId) || 'f42-card-thread-snapshot-dry-run';
  const conflicts = [];
  const imports = [];
  const coverageSurfaces = {};
  let inputRows = 0;

  if (clean(snapshot.contract) !== SNAPSHOT_CONTRACT) {
    conflicts.push({
      classification: 'snapshot_contract_required',
      reason: 'unsupported_or_missing_contract',
      expected_contract: SNAPSHOT_CONTRACT,
    });
  }

  for (const surface of SURFACES) {
    const supplied = Object.prototype.hasOwnProperty.call(snapshotSurfaces, surface)
      && Array.isArray(snapshotSurfaces[surface]);
    if (!supplied) {
      conflicts.push({
        classification: 'snapshot_contract_required',
        surface,
        reason: 'surface_array_required',
      });
    }
    const rows = supplied ? snapshotSurfaces[surface] : [];
    const surfacePlan = planSurface(rows, {
      ...options,
      surface,
      importRunId,
    });
    inputRows += rows.length;
    imports.push(...surfacePlan.imports);
    conflicts.push(...surfacePlan.conflicts);
    const expected = manifestSurfaces[surface];
    const mismatches = manifestMismatches(expected, surfacePlan.coverage);
    coverageSurfaces[surface] = {
      actual: surfacePlan.coverage,
      expected: expected && typeof expected === 'object' && !Array.isArray(expected)
        ? expected
        : null,
      matches_manifest: mismatches.length === 0,
    };
    if (mismatches.length) {
      conflicts.push({
        classification: 'coverage_mismatch',
        surface,
        fields: mismatches,
        expected: coverageSurfaces[surface].expected,
        actual: surfacePlan.coverage,
      });
    }
  }

  return {
    source_only: true,
    contract: clean(snapshot.contract) || null,
    surface: 'calendar+sxr',
    import_run_id: importRunId,
    input_rows: inputRows,
    coverage: { surfaces: coverageSurfaces },
    imports,
    conflicts,
    complete: clean(snapshot.contract) === SNAPSHOT_CONTRACT && conflicts.length === 0,
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.apply) throw new Error('F42 planner is source-only; use the owner-gated RPC runbook after merge');
  if (!args.input) throw new Error('usage: node scripts/f42-card-comment-import.js --input two-surface-snapshot.json [--client-slug <slug>] [--output plan.json]');
  const inputPath = path.resolve(String(args.input));
  const snapshot = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (!snapshot || Array.isArray(snapshot) || clean(snapshot.contract) !== SNAPSHOT_CONTRACT) {
    throw new Error(`F42 CLI requires ${SNAPSHOT_CONTRACT} with both Calendar and SXR surfaces`);
  }
  const plan = planCardCommentImport(snapshot, {
    importRunId: args['import-run-id'],
    clientSlug: args['client-slug'],
  });
  const output = JSON.stringify(plan, null, 2) + '\n';
  if (args.output) fs.writeFileSync(path.resolve(String(args.output)), output);
  else process.stdout.write(output);
  if (!plan.complete) process.exitCode = 2;
}

if (require.main === module) main();

module.exports = {
  COMPONENT_FIELDS,
  SNAPSHOT_CONTRACT,
  SURFACES,
  attachmentConflicts,
  commentsFor,
  isValidTimestampValue,
  lifecycleTimestampConflicts,
  manifestMismatches,
  normalizeComment,
  planCardCommentImport,
  planSurface,
  productionId,
  safeAttachments,
  sourceCoverage,
  teamForComponent,
  topologicallyOrder,
};
