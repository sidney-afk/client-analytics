#!/usr/bin/env node
'use strict';

// F42 source-only planner for Calendar/Samples card comment arrays.
// It never connects to Supabase or mutates a source row. The owner-approved
// import step feeds `imports[].link/comment/event` to the service-only
// production_comment_card_import RPC after reviewing every conflict.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// v2 adds the required `deliverables` crosswalk projection. The import RPC
// validates every comment against the LIVE deliverables row — it must exist, and
// its origin/team/client_slug/card_id must match the card the comment came from
// — but a v1 snapshot carried only the card surfaces, so the planner could not
// see those facts and certified plans the RPC then rejected on the first call.
// Carrying the crosswalk into the snapshot is what makes the plan authoritative.
const SNAPSHOT_CONTRACT = 'syncview-f42-card-comment-snapshot-v2';
const SURFACES = Object.freeze(['calendar', 'sxr']);

// The deliverable fields the import RPC compares against. Mirrors the crosswalk
// guard in production_comment_card_import exactly.
const DELIVERABLE_FIELDS = Object.freeze([
  'id', 'client_slug', 'team', 'origin', 'card_id',
]);

// The RPC derives the expected deliverable origin from the request surface.
const SURFACE_ORIGIN = Object.freeze({ calendar: 'calendar', sxr: 'samples' });

// Import scope. A plan sorts every non-importable row into exactly one of three
// buckets, and only the first one blocks:
//
//   CONFLICTS  — blocking. The plan is not certifiable until the owner fixes
//                these: malformed timestamps, invalid rounds, NUL bytes,
//                audience quarantines, duplicate identities, parent cycles,
//                coverage mismatches, missing client slugs, missing comment ids.
//
//   DEFERRALS  — out of scope, non-blocking. The card has no target for the
//                canonical crosswalk to address (no native deliverable binding,
//                or a binding that names a deliverable which does not exist).
//                No owner action during the window makes them plannable; a later
//                plan picks them up automatically once the card gains a binding.
//
//   DEFECTS    — link defects, non-blocking. The deliverable EXISTS but
//                describes a different card/client/team/origin, so importing the
//                row would attach the comment to the WRONG deliverable. These
//                need a linkage-repair session, not an import fix. They are
//                never imported and never enter the apply digest — exactly like
//                deferrals — but they are reported separately because the
//                remedy is different: a deferral resolves itself when the card
//                is linked, a defect needs someone to repair a bad link.
//
// Blocking on defects kept the whole linked cohort unimportable while the
// mis-linked rows sat there; the RPC's own crosswalk refusal remains in place as
// the apply-time backstop, so nothing can reach the wrong deliverable even if
// this classification were ever wrong.
const IMPORT_SCOPE_POLICY = 'linked-cohort';
const DEFERRED_CLASSIFICATIONS = Object.freeze([
  'missing_deliverable_id',
  'deliverable_not_found',
]);
const DEFECT_CLASSIFICATIONS = Object.freeze(['deliverable_crosswalk_mismatch']);
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

// Strict, timezone-independent calendar validation. The lifecycle fields are
// cast to timestamptz mid-apply, and `Date.parse` silently NORMALIZES junk
// (2026-02-30 -> Mar 2, hour 24 -> next day, "2026/1/1", "July 3"), which would
// let an apply-unsafe or meaning-shifted value certify. Require a canonical
// ISO-8601 instant and confirm every calendar component is in range for its
// month/year, so anything Date.parse would rewrite is rejected instead.
function isValidTimestampValue(value) {
  if (value == null) return true;
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text) return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(text);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] == null ? 0 : Number(match[8]);
  const offsetMinute = match[9] == null ? 0 : Number(match[9]);
  // PostgreSQL has no year zero and accepts numeric UTC displacements only
  // through 15:59. Match those bounds before Date.parse can normalize a value
  // that the import RPC's timestamptz cast would reject mid-cohort.
  if (year < 1) return false;
  if (month < 1 || month > 12) return false;
  // Day 0 of the following month is the last calendar day of `month`.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (offsetHour > 15 || offsetMinute > 59) return false;
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

// `round` is optional (historical comments legitimately omit it), but when the
// source supplies one it must be a POSITIVE INTEGER. The old normalization
// silently collapsed null/""/0/"3.5"/-1 to null, which erased the reviewer's
// ability to see a bad round before the cohort was applied. Surface a present
// but non-positive-integer round as a blocking conflict instead. An absent
// field stays a legitimate null.
function isPresentRound(raw) {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    && Object.prototype.hasOwnProperty.call(raw, 'round');
}

// production_comments.round is a PostgreSQL `integer` (int4). A positive
// JavaScript integer above 2^31-1 passes every JS-side check and is then
// rejected mid-apply by the column type ("value ... is out of range for type
// integer"), so bound it here.
const PG_INT4_MAX = 2147483647;

function normalizedRound(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 && numeric <= PG_INT4_MAX ? numeric : null;
}

function roundConflicts(raw, scope = {}) {
  if (!isPresentRound(raw)) return [];
  if (normalizedRound(raw.round) !== null) return [];
  const numeric = Number(raw.round);
  return [{
    classification: 'invalid_round',
    surface: clean(scope.surface) || null,
    card_id: clean(scope.cardId) || null,
    component: clean(scope.component) || null,
    native_comment_id: clean(scope.nativeId) || null,
    reason: Number.isInteger(numeric) && numeric > PG_INT4_MAX
      ? 'round_exceeds_int4_range'
      : 'round_must_be_a_positive_integer',
  }];
}

// PostgreSQL `text` cannot store a NUL byte. PostgREST/jsonb rejects the WHOLE
// call with "unsupported Unicode escape sequence ... cannot be converted to
// text", so a single such byte anywhere in the cohort fails that row at apply
// time. Every string the planner carries into the link or comment comes from
// source data, so scan the BUILT payload rather than maintaining a field list
// that can silently drift out of date. Returns the first offending JSON path.
const NUL_BYTE = '\u0000';
function firstNulPath(value, trail = []) {
  if (typeof value === 'string') return value.includes(NUL_BYTE) ? trail.join('.') || '(root)' : '';
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const found = firstNulPath(value[index], [...trail, String(index)]);
      if (found) return found;
    }
    return '';
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const found = firstNulPath(value[key], [...trail, key]);
      if (found) return found;
    }
  }
  return '';
}

// Replicate the import RPC's crosswalk guard at plan time. The RPC raises
// 'production comment card import deliverable missing' when the deliverable row
// does not exist, and 'production comment card import crosswalk mismatch' when
// its origin/team/client_slug/card_id disagree with the link — both of which
// abort the whole apply on that row. Validating here is the difference between
// a certified plan and one the RPC rejects on its first call.
//
// A card pointing at a deliverable that does NOT exist is out of scope
// (DEFERRED), because the canonical thread has no target and no owner action
// during the window creates one. A deliverable that DOES exist but describes a
// different card/client/team/origin is a link DEFECT: importing it would attach
// the comment to the wrong deliverable, so the row is never imported — but it
// needs a linkage-repair session rather than an import fix, so it is reported in
// its own bucket instead of blocking the clean cohort. The RPC's own crosswalk
// refusal stays in place as the apply-time backstop.
function deliverableCrosswalkIssues(deliverable, scope = {}) {
  const base = {
    surface: clean(scope.surface) || null,
    card_id: clean(scope.cardId) || null,
    component: clean(scope.component) || null,
    native_comment_id: clean(scope.nativeId) || null,
  };
  if (!deliverable) {
    return {
      deferrals: [{
        ...base,
        classification: 'deliverable_not_found',
        reason: 'card_deliverable_id_has_no_matching_deliverable',
      }],
      defects: [],
    };
  }
  const expectedOrigin = SURFACE_ORIGIN[clean(scope.surface).toLowerCase()] || '';
  const expectedTeam = teamForComponent(scope.component);
  const fields = [];
  if (clean(deliverable.origin).toLowerCase() !== expectedOrigin) fields.push('origin');
  if (clean(deliverable.team).toLowerCase() !== expectedTeam) fields.push('team');
  if (clean(deliverable.client_slug) !== clean(scope.clientSlug)) fields.push('client_slug');
  if (clean(deliverable.card_id) !== clean(scope.cardId)) fields.push('card_id');
  if (!fields.length) return { deferrals: [], defects: [] };
  return {
    deferrals: [],
    defects: [{
      ...base,
      classification: 'deliverable_crosswalk_mismatch',
      // Field NAMES only — never the differing values, which are card ids and
      // client slugs and must not reach a public log. The runner-local plan
      // still carries the per-row card/comment identity for the repair session.
      fields: fields.sort(),
      reason: `crosswalk_fields:${fields.sort().join(',')}`,
    }],
  };
}

function nulByteConflicts(payload, scope = {}) {
  const path = firstNulPath(payload);
  if (!path) return [];
  return [{
    classification: 'unsupported_text_control_character',
    surface: clean(scope.surface) || null,
    card_id: clean(scope.cardId) || null,
    component: clean(scope.component) || null,
    native_comment_id: clean(scope.nativeId) || null,
    source_field: path,
    reason: 'nul_byte_in_text',
  }];
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

// A comment's own audience from its source role/audience field, before any
// root inheritance. 'client' only when the source says so (explicit client
// audience or a client author); everything else is internal.
function ownAudience(raw) {
  const role = clean(raw && raw.role || 'smm').toLowerCase();
  return clean(raw && raw.audience).toLowerCase() === 'client' || role === 'client'
    ? 'client'
    : 'internal';
}

// A reply is *explicitly* internal only when its source literally marks it so.
// This is the sole case that must QUARANTINE rather than inherit a client-
// visible root: forcing it client-visible would leak an internal note.
function isExplicitlyInternal(raw) {
  return clean(raw && raw.audience).toLowerCase() === 'internal';
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
  // A reply inherits its root's audience (scope.resolvedAudience); a root uses
  // its own. Inheritance is never a silent client-visible flip of an explicitly
  // internal reply — that case is quarantined upstream before we get here.
  const audience = scope.resolvedAudience === 'client' || scope.resolvedAudience === 'internal'
    ? scope.resolvedAudience
    : ownAudience(raw);
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
    round: normalizedRound(raw.round),
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
  // Out-of-scope rows: reported with counts, never plan-blocking. See the
  // missing_deliverable_id branch below for why this class is distinct.
  const deferrals = [];
  // Link-defect rows: the deliverable exists but points elsewhere. Never
  // imported, never blocking; surfaced separately for the repair session.
  const defects = [];
  // Live deliverable crosswalk, keyed by id. The RPC validates every comment
  // against this; without it the planner cannot certify what the RPC will accept.
  const deliverablesById = options.deliverablesById instanceof Map
    ? options.deliverablesById
    : new Map();

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
        // DEFERRED, not blocking. A card with no native deliverable binding has
        // nothing for the canonical crosswalk to point at, so its comments are
        // out of scope for this import rather than defective: there is no
        // owner action that would make them plannable in this run, and holding
        // the whole plan hostage to them blocks the linked cohort forever. They
        // are reported with counts and stay unimported until the card is
        // linked, at which point a later plan picks them up automatically.
        // Every other conflict class remains plan-blocking.
        list.forEach(raw => deferrals.push({
          classification: 'missing_deliverable_id',
          surface, card_id: cardId, component,
          native_comment_id: clean(raw.id || raw.comment_id || raw.native_comment_id) || null,
          reason: 'card_has_no_native_deliverable_binding',
        }));
        continue;
      }
      // The card names a deliverable. Validate the LIVE crosswalk the RPC will
      // check, per component, before any of this component's rows are planned:
      // a missing deliverable DEFERS the whole component, a mismatched one marks
      // it a link DEFECT. Neither blocks, and neither reaches the apply.
      const crosswalk = deliverableCrosswalkIssues(deliverablesById.get(targetId), {
        surface, cardId, component, clientSlug: sourceClientSlug,
      });
      if (crosswalk.deferrals.length || crosswalk.defects.length) {
        list.forEach(raw => {
          const nativeId = clean(raw.id || raw.comment_id || raw.native_comment_id) || null;
          crosswalk.deferrals.forEach(issue => deferrals.push({ ...issue, native_comment_id: nativeId }));
          crosswalk.defects.forEach(issue => defects.push({ ...issue, native_comment_id: nativeId }));
        });
        continue;
      }
      const idMap = new Map();
      const rawByNativeId = new Map();
      const parentNativeById = new Map();
      list.forEach(raw => {
        const nativeId = clean(raw.id || raw.comment_id || raw.native_comment_id);
        if (!nativeId) return;
        if (!idMap.has(nativeId)) idMap.set(nativeId, productionId(surface, cardId, component, nativeId));
        if (!rawByNativeId.has(nativeId)) rawByNativeId.set(nativeId, raw);
        const parentNativeId = clean(raw.parent_id || raw.parentId);
        if (parentNativeId) parentNativeById.set(nativeId, parentNativeId);
      });
      // Resolve the audience of the thread ROOT (topmost reachable ancestor) so
      // every reply inherits it. A reply never sets its own client visibility.
      const rootAudienceFor = (nativeId) => {
        const seen = new Set();
        let cursor = nativeId;
        while (parentNativeById.has(cursor)
          && rawByNativeId.has(parentNativeById.get(cursor))
          && !seen.has(cursor)) {
          seen.add(cursor);
          cursor = parentNativeById.get(cursor);
        }
        return ownAudience(rawByNativeId.get(cursor) || {});
      };
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
        // Audience inheritance: a reply takes its root's audience. An explicitly
        // internal reply under a client-visible root is QUARANTINED (blocking
        // conflict), never silently flipped client-visible — that would leak an
        // internal note. A root keeps its own audience.
        let resolvedAudience = ownAudience(raw);
        if (parentNativeId) {
          const rootAudience = rootAudienceFor(nativeId);
          if (isExplicitlyInternal(raw) && rootAudience === 'client') {
            conflicts.push({
              classification: 'audience_quarantine', surface, card_id: cardId,
              component, native_comment_id: nativeId,
              reason: 'internal_reply_under_client_visible_root',
            });
            return;
          }
          resolvedAudience = rootAudience;
        }
        const scope = {
          surface, cardId, component, nativeId, deliverableId: targetId,
          productionId: idMap.get(nativeId), importRunId,
          resolvedAudience,
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
          ...roundConflicts(raw, scope),
          // Scan the BUILT comment plus the raw identity strings the link
          // carries, so every source string that reaches the RPC — body, author
          // name/key, role, resolver name, attachment url/name, card id, native
          // comment id, client slug — is covered without a drift-prone list.
          ...nulByteConflicts({
            comment,
            link: {
              card_id: cardId,
              native_comment_id: nativeId,
              client_slug: sourceClientSlug,
              deliverable_id: targetId,
            },
          }, scope),
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
    deferrals,
    defects,
    // Complete FOR SCOPE: every in-scope, cleanly-linked row planned cleanly.
    // Deferred out-of-scope rows and link defects are counted, never blocking.
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
      scope: {
        policy: IMPORT_SCOPE_POLICY,
        planned_imports: Array.isArray(plan.imports) ? plan.imports.length : 0,
        deferred_rows: Array.isArray(plan.deferrals) ? plan.deferrals.length : 0,
        defect_rows: Array.isArray(plan.defects) ? plan.defects.length : 0,
      },
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
  const deferrals = [];
  const defects = [];
  const imports = [];
  const coverageSurfaces = {};
  let inputRows = 0;

  // The deliverable crosswalk the import RPC validates against. It is MANDATORY
  // under the v2 contract: without it the planner cannot know what the RPC will
  // accept, and a certified plan can be rejected on its first call.
  const deliverableRows = Array.isArray(snapshot.deliverables) ? snapshot.deliverables : null;
  if (!deliverableRows) {
    conflicts.push({
      classification: 'snapshot_contract_required',
      reason: 'deliverable_crosswalk_required',
    });
  }
  const deliverablesById = new Map();
  for (const row of deliverableRows || []) {
    const record = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
    const id = clean(record.id);
    if (!id) {
      conflicts.push({
        classification: 'snapshot_contract_required',
        reason: 'deliverable_crosswalk_row_requires_id',
      });
      continue;
    }
    if (deliverablesById.has(id)) {
      conflicts.push({
        classification: 'snapshot_contract_required',
        reason: 'deliverable_crosswalk_duplicate_id',
      });
      continue;
    }
    deliverablesById.set(id, record);
  }

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
      deliverablesById,
    });
    inputRows += rows.length;
    imports.push(...surfacePlan.imports);
    conflicts.push(...surfacePlan.conflicts);
    deferrals.push(...surfacePlan.deferrals);
    defects.push(...surfacePlan.defects);
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
    // Stable fingerprint of the exact crosswalk the plan was certified against.
    // If a deliverable is re-pointed to another card/client/team/origin between
    // plan and apply, the RPC would reject the row — this moves the apply digest
    // so the drift guard refuses first.
    deliverables_fingerprint: sha([...deliverablesById.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, row]) => DELIVERABLE_FIELDS.map(field => `${field}=${clean(row[field])}`).join('|') + `#${id}`)),
    imports,
    conflicts,
    deferrals,
    defects,
    // The plan's scope is explicit in the artifact so an operator (and the apply
    // runner) can never mistake a linked-cohort plan for a whole-source one.
    scope: {
      policy: IMPORT_SCOPE_POLICY,
      planned_imports: imports.length,
      deferred_rows: deferrals.length,
      defect_rows: defects.length,
    },
    // Complete FOR SCOPE — see IMPORT_SCOPE_POLICY. Deferred rows are counted
    // and reported but never block; every other conflict class still does.
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
  DEFECT_CLASSIFICATIONS,
  DEFERRED_CLASSIFICATIONS,
  DELIVERABLE_FIELDS,
  IMPORT_SCOPE_POLICY,
  PG_INT4_MAX,
  SNAPSHOT_CONTRACT,
  SURFACES,
  SURFACE_ORIGIN,
  deliverableCrosswalkIssues,
  firstNulPath,
  nulByteConflicts,
  attachmentConflicts,
  commentsFor,
  isExplicitlyInternal,
  isValidTimestampValue,
  lifecycleTimestampConflicts,
  manifestMismatches,
  normalizeComment,
  normalizedRound,
  ownAudience,
  planCardCommentImport,
  planSurface,
  productionId,
  roundConflicts,
  safeAttachments,
  sourceCoverage,
  teamForComponent,
  topologicallyOrder,
};
