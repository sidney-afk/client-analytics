'use strict';

/*
 * Linear -> production_comments historical import.
 *
 * Linear is always read-only. Dry-run is the default. Database writes are
 * possible only with --apply and go exclusively through
 * production_comment_upsert(p_comment, p_event).
 *
 * Examples:
 *   node scripts/b4-linear-comment-backfill.js --scope full
 *
 * Apply is deliberately not a copy-paste example. The 2026-07-12 migration is
 * complete, and a historical run ID is not fresh authorization (F103). Any new
 * apply needs a new owner-reviewed runbook and run ID; runtime completed-run
 * rejection is still an open gate.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LINEAR_URL = 'https://api.linear.app/graphql';
const DEFAULT_SUPABASE_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co';
const DEFAULT_COMMENT_TABLE = 'production_comments';
const DEFAULT_COMMENT_RPC = 'production_comment_upsert';
const TEST_CLIENT = 'sidneylaruel';
const TEST_PROJECT_NAMES = new Set(['Sidney Laruel', 'Test Project']);
const TRACK_TEAMS = new Set(['VID', 'GRA']);
const BRIDGE_PREFIX = /^\*\*(.+?) \(via SyncView\):\*\*(?:[ \t]*\r?\n){0,2}/i;
const MIRROR_MARKER = /<!--\s*syncview-mirror:([^>]+?)\s*-->/ig;

const LINEAR_COMMENTS_QUERY = `
query B4LinearCommentBackfill($after: String) {
  comments(
    first: 100
    after: $after
    includeArchived: true
    filter: { issue: { team: { key: { in: ["VID", "GRA"] } } } }
  ) {
    nodes {
      id
      body
      createdAt
      updatedAt
      editedAt
      archivedAt
      parentId
      resolvedAt
      user { id name displayName email }
      externalUser { id name displayName email }
      botActor { id name type }
      onBehalfOf { id name displayName email }
      issue {
        id
        identifier
        team { id key name }
        project { id name }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const COMMENT_SELECT = [
  'id', 'idempotency_key', 'deliverable_id', 'batch_id', 'client_slug', 'team',
  'native_comment_id', 'linear_issue_uuid', 'linear_identifier', 'linear_comment_id', 'parent_id',
  'thread_root_id', 'linear_parent_comment_id', 'linear_thread_root_id', 'body',
  'body_format', 'attachments', 'author_key', 'author_member_id', 'author_name', 'role',
  'linear_author_id', 'transport_actor', 'transport_role', 'transport_linear_user_id',
  'audience', 'component', 'is_tweak', 'round', 'source', 'origin',
  'source_created_at', 'source_updated_at', 'edited_at', 'deleted_at', 'resolved_at',
  'version', 'import_run_id', 'backfill_tag', 'provenance',
].join(',');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function parseArray(value) {
  if (Array.isArray(value)) return value.filter(item => item && typeof item === 'object');
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.filter(item => item && typeof item === 'object') : [];
  } catch (_) {
    return [];
  }
}

function parseArgs(argv) {
  const values = new Map();
  const present = new Set();
  for (let i = 0; i < argv.length; i++) {
    const token = String(argv[i]);
    if (!token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    const key = token.slice(2, eq >= 0 ? eq : undefined);
    let value = eq >= 0 ? token.slice(eq + 1) : '1';
    if (eq < 0 && argv[i + 1] && !String(argv[i + 1]).startsWith('--')) value = String(argv[++i]);
    values.set(key, value);
    present.add(key);
  }
  return { values, present };
}

function optionsFrom(argv, env = process.env) {
  const parsed = parseArgs(argv);
  const scope = lower(parsed.values.get('scope') || 'full');
  const apply = parsed.present.has('apply') || /^(1|true|yes)$/i.test(env.APPLY || '');
  const importRunId = clean(parsed.values.get('import-run-id') || env.IMPORT_RUN_ID);
  const effectiveRunId = importRunId || `linear-comment-backfill-dry-run-${new Date().toISOString().slice(0, 10)}`;
  return {
    apply,
    scope,
    scope_explicit: parsed.present.has('scope'),
    import_run_id: effectiveRunId,
    backfill_tag: clean(parsed.values.get('backfill-tag') || env.BACKFILL_TAG || effectiveRunId),
    cap: Number(parsed.values.get('cap') || env.CAP || 20000),
    write_concurrency: Number(parsed.values.get('write-concurrency') || env.WRITE_CONCURRENCY || 8),
    page_delay_ms: Math.max(0, Number(parsed.values.get('page-delay-ms') || env.PAGE_DELAY_MS || 500)),
    retries: Math.max(0, Number(parsed.values.get('retries') || env.LINEAR_READ_RETRIES || 5)),
    json_report: clean(parsed.values.get('json-report') || parsed.values.get('json-out') || env.JSON_REPORT),
    recover_legacy_native: parsed.present.has('recover-legacy-native'),
    legacy_native_cap: Number(parsed.values.get('legacy-native-cap') || env.LEGACY_NATIVE_CAP || 8),
    legacy_capture_at: canonicalTime(parsed.values.get('legacy-capture-at') || env.LEGACY_CAPTURE_AT),
    confirm_test: clean(parsed.values.get('confirm-test') || env.B4_CONFIRM_TEST_MUTATIONS),
    supabase_url: clean(env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, ''),
    supabase_key: clean(env.SUPABASE_SERVICE_ROLE_KEY),
    linear_key: clean(env.LINEAR_API_KEY || env.LINEAR_API_TOKEN || env.LINEAR_KEY || env.LINEAR_TOKEN),
    comment_table: safeName(parsed.values.get('comment-table') || env.PRODUCTION_COMMENT_TABLE || DEFAULT_COMMENT_TABLE),
    comment_rpc: safeName(parsed.values.get('comment-rpc') || env.PRODUCTION_COMMENT_RPC || DEFAULT_COMMENT_RPC),
  };
}

function safeName(value) {
  const name = clean(value);
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`Unsafe database object name: ${name}`);
  return name;
}

function validateOptions(options) {
  if (!['test', 'full'].includes(options.scope)) throw new Error('--scope must be test or full');
  if (!Number.isFinite(options.cap) || options.cap < 0) throw new Error('--cap must be a non-negative number');
  if (!Number.isInteger(options.write_concurrency) || options.write_concurrency < 1 || options.write_concurrency > 16) {
    throw new Error('--write-concurrency must be an integer from 1 to 16');
  }
  if (!Number.isFinite(options.legacy_native_cap) || options.legacy_native_cap < 0) {
    throw new Error('--legacy-native-cap must be a non-negative number');
  }
  if (options.apply && !options.scope_explicit) throw new Error('--apply requires an explicit --scope test or --scope full');
  if (options.apply && !clean(options.import_run_id)) throw new Error('--apply requires --import-run-id');
  if (options.apply && !clean(options.backfill_tag)) throw new Error('--apply requires a non-empty backfill tag');
  if (options.apply && options.scope === 'test'
      && !['1', TEST_CLIENT].includes(lower(options.confirm_test))) {
    throw new Error(`TEST apply requires B4_CONFIRM_TEST_MUTATIONS=1 or --confirm-test ${TEST_CLIENT}`);
  }
  if (options.apply && options.recover_legacy_native && !options.legacy_capture_at) {
    throw new Error('--recover-legacy-native apply requires --legacy-capture-at');
  }
  if (options.recover_legacy_native && options.scope !== 'full') {
    throw new Error('--recover-legacy-native is a full-scope supplement, not a TEST pilot mode');
  }
  return options;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizeNewlines(value) {
  return String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim();
}

function canonicalTime(value) {
  const raw = clean(value);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : raw;
}

function parseBridgeBody(value) {
  const original = normalizeNewlines(value);
  let marker = '';
  const markerMatch = original.match(/<!--\s*syncview-mirror:([^>]+?)\s*-->/i);
  if (markerMatch) marker = clean(markerMatch[1]);
  const withoutMarker = original.replace(MIRROR_MARKER, '').trim();
  const bridge = withoutMarker.match(BRIDGE_PREFIX);
  return {
    body: bridge ? withoutMarker.slice(bridge[0].length).trim() : withoutMarker,
    bridge_author: bridge ? clean(bridge[1]) : '',
    bridge_wrapped: !!bridge,
    mirror_marker: marker,
  };
}

function actorShape(value, kind) {
  const actor = value && typeof value === 'object' ? value : {};
  return {
    id: clean(actor.id),
    name: clean(actor.displayName || actor.name),
    kind,
  };
}

function personNameKey(value) {
  return lower(value).replace(/\s+/g, ' ');
}

function resolveAuthor(comment, memberByLinearId = new Map(), memberByName = new Map()) {
  const parsed = parseBridgeBody(comment && comment.body);
  const transport = actorShape(comment && comment.user, 'user');
  const onBehalf = actorShape(comment && comment.onBehalfOf, 'on_behalf_of');
  const external = actorShape(comment && comment.externalUser, 'external_user');
  const bot = actorShape(comment && comment.botActor, 'bot');
  const authored = parsed.bridge_author
    ? { id: '', name: parsed.bridge_author, kind: 'legacy_bridge' }
    : [onBehalf, transport, external, bot].find(actor => actor.id || actor.name)
      || { id: '', name: 'Linear', kind: 'unknown' };
  const member = (authored.id && memberByLinearId.get(authored.id))
    || memberByName.get(personNameKey(authored.name)) || null;
  const authorKey = member && member.id
    ? `team:${clean(member.id)}`
    : authored.kind === 'legacy_bridge'
      ? `legacy-bridge:${lower(authored.name).replace(/\s+/g, '-')}`
      : authored.id ? `linear:${authored.id}` : `linear-name:${lower(authored.name).replace(/\s+/g, '-')}`;
  const fallbackRole = authored.kind === 'legacy_bridge' ? 'bridge'
    : ['external_user', 'bot'].includes(authored.kind) ? 'external' : 'linear';
  return {
    body: parsed.body,
    author_key: authorKey,
    author_member_id: member ? clean(member.id) || null : null,
    author_name: member ? clean(member.name) || authored.name : authored.name || 'Linear',
    author_role: member ? clean(member.role) || fallbackRole : fallbackRole,
    linear_author_id: authored.id || null,
    transport_linear_user_id: transport.id || null,
    transport_author_name: transport.name || null,
    author_kind: authored.kind,
    bridge_wrapped: parsed.bridge_wrapped,
    bridge_author: parsed.bridge_author || null,
    mirror_marker: parsed.mirror_marker || null,
  };
}

function parentUuidEntries(raw) {
  const value = parseJson(raw);
  const entries = [];
  for (const [team, item] of Object.entries(value)) {
    if (typeof item === 'string') {
      if (clean(item)) entries.push({ uuid: clean(item), team: lower(team) });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const uuid = clean(item.uuid || item.id || item.linear_issue_uuid);
    if (uuid) entries.push({ uuid, team: lower(team) });
  }
  return entries;
}

function deliverableLinearIdentifier(row) {
  const explicit = clean(row && (row.linear_identifier || row.identifier)).toUpperCase();
  if (/^(VID|GRA)-\d+$/.test(explicit)) return explicit;
  const match = clean(row && row.linear_issue_url).toUpperCase().match(/\b(?:VID|GRA)-\d+\b/);
  return match ? match[0] : '';
}

function buildMappingIndex(data) {
  const byIssue = new Map();
  const byIdentifier = new Map();
  const byDeliverableId = new Map();
  const membersByLinearId = new Map();
  const membersByName = new Map();
  const legacyByDeliverable = new Map();
  for (const member of data.members || []) {
    const id = clean(member.linear_user_id);
    if (id) membersByLinearId.set(id, member);
    const nameKey = personNameKey(member.name);
    if (nameKey && !membersByName.has(nameKey)) membersByName.set(nameKey, member);
  }
  for (const row of data.deliverables || []) {
    const issueId = clean(row.linear_issue_uuid);
    const subject = {
      kind: 'deliverable', id: clean(row.id), deliverable_id: clean(row.id), batch_id: null,
      client_slug: clean(row.client_slug), team: lower(row.team), archive_only: false,
      linear_issue_uuid: issueId, linear_identifier: deliverableLinearIdentifier(row),
    };
    if (issueId) byIssue.set(issueId, subject);
    const identifier = deliverableLinearIdentifier(row);
    if (identifier && !byIdentifier.has(identifier)) byIdentifier.set(identifier, subject);
    byDeliverableId.set(clean(row.id), subject);
    legacyByDeliverable.set(clean(row.id), parseArray(row.comments));
  }
  for (const row of data.batches || []) {
    for (const parent of parentUuidEntries(row.linear_parent_ids)) {
      if (byIssue.has(parent.uuid)) continue;
      byIssue.set(parent.uuid, {
        kind: 'batch', id: clean(row.id), deliverable_id: null, batch_id: clean(row.id),
        client_slug: clean(row.client_slug), team: parent.team, archive_only: false,
      });
    }
  }
  for (const row of data.archive || []) {
    const issueId = clean(row.linear_uuid);
    if (!issueId || byIssue.has(issueId)) continue;
    byIssue.set(issueId, {
      kind: 'archive', id: issueId, deliverable_id: null, batch_id: null,
      client_slug: clean(row.client_slug), team: lower(row.team), archive_only: true,
    });
  }
  return { byIssue, byIdentifier, byDeliverableId, membersByLinearId, membersByName, legacyByDeliverable };
}

function linearThreadRoots(comments) {
  const byId = new Map((comments || []).map(comment => [clean(comment.id), comment]).filter(([id]) => id));
  const roots = new Map();
  const visit = (id, trail = new Set()) => {
    if (!id) return '';
    if (roots.has(id)) return roots.get(id);
    if (trail.has(id)) return id;
    const comment = byId.get(id);
    const parent = clean(comment && comment.parentId);
    if (!parent) {
      roots.set(id, id);
      return id;
    }
    const nextTrail = new Set(trail);
    nextTrail.add(id);
    const root = byId.has(parent) ? visit(parent, nextTrail) : parent;
    roots.set(id, root);
    return root;
  };
  for (const id of byId.keys()) visit(id);
  return roots;
}

function assertUniqueLinearCommentIds(comments) {
  const seen = new Set();
  for (const comment of comments || []) {
    const id = clean(comment && comment.id);
    if (!id) continue;
    if (seen.has(id)) throw new Error(`Duplicate Linear comment id in source cursor: ${id}`);
    seen.add(id);
  }
  return seen.size;
}

function normalizeLinearComments(comments, mapping, options) {
  assertUniqueLinearCommentIds(comments);
  const roots = linearThreadRoots(comments);
  const sourceIds = new Set((comments || []).map(comment => clean(comment && comment.id)).filter(Boolean));
  return sortParentFirst((comments || []).map(comment => {
    const issue = comment && comment.issue && typeof comment.issue === 'object' ? comment.issue : {};
    const issueId = clean(issue.id);
    const commentId = clean(comment.id);
    // Older native rows can have a durable VID/GRA identifier but no issue
    // UUID. Prefer that native target over the archive-only UUID fallback.
    const subject = mapping.byIdentifier.get(clean(issue.identifier).toUpperCase())
      || mapping.byIssue.get(issueId) || null;
    const author = resolveAuthor(comment, mapping.membersByLinearId, mapping.membersByName);
    const linearParentId = clean(comment.parentId) || null;
    const linearRootId = roots.get(commentId) || commentId;
    const parentAvailable = linearParentId && sourceIds.has(linearParentId);
    const rootAvailable = sourceIds.has(linearRootId);
    const team = lower(clean(issue.team && issue.team.key)) === 'gra' ? 'graphics' : 'video';
    const row = {
      id: `linear:${commentId}`,
      idempotency_key: `linear:${commentId}`,
      deliverable_id: subject && subject.deliverable_id || null,
      batch_id: subject && subject.batch_id || null,
      client_slug: subject && subject.client_slug || null,
      team,
      native_comment_id: `linear:${commentId}`,
      linear_issue_uuid: issueId,
      linear_identifier: clean(issue.identifier) || null,
      linear_comment_id: commentId,
      parent_id: parentAvailable ? `linear:${linearParentId}` : null,
      thread_root_id: `linear:${rootAvailable ? linearRootId : commentId}`,
      linear_parent_comment_id: linearParentId,
      linear_thread_root_id: linearRootId,
      body: author.body,
      body_format: 'markdown',
      attachments: [],
      author_key: author.author_key,
      author_member_id: author.author_member_id,
      author_name: author.author_name,
      role: author.author_role,
      linear_author_id: author.linear_author_id,
      transport_linear_user_id: author.transport_linear_user_id,
      transport_actor: author.transport_author_name,
      transport_role: 'linear_transport',
      audience: 'internal',
      component: null,
      is_tweak: false,
      round: null,
      source: 'backfill',
      origin: author.bridge_wrapped ? 'bridge' : 'linear',
      source_created_at: clean(comment.createdAt) || null,
      source_updated_at: clean(comment.updatedAt) || clean(comment.createdAt) || null,
      edited_at: clean(comment.editedAt) || null,
      deleted_at: clean(comment.archivedAt) || null,
      resolved_at: clean(comment.resolvedAt) || null,
      version: 1,
      import_run_id: options.import_run_id,
      backfill_tag: options.backfill_tag,
      provenance: {
        imported_from: 'linear_graphql_comments',
        linear_read_only: true,
        timestamp_provenance: 'linear_source',
        author_kind: author.author_kind,
        bridge_wrapped: author.bridge_wrapped,
        bridge_author: author.bridge_author,
        mirror_marker: author.mirror_marker,
        archive_only_issue: !!(subject && subject.archive_only),
        missing_native_parent: !!(linearParentId && !parentAvailable),
        native_id_provenance: 'linear_derived',
      },
    };
    return {
      row,
      subject,
      issue_project_id: clean(issue.project && issue.project.id),
      issue_project_name: clean(issue.project && issue.project.name),
      team: clean(issue.team && issue.team.key).toUpperCase(),
    };
  }));
}

function sortParentFirst(items) {
  const byId = new Map((items || []).map(item => [clean(item && item.row && item.row.linear_comment_id), item]));
  const depthMemo = new Map();
  const depth = (item, trail = new Set()) => {
    const id = clean(item && item.row && item.row.linear_comment_id);
    if (!id || depthMemo.has(id)) return depthMemo.get(id) || 0;
    const parentId = clean(item.row.linear_parent_comment_id);
    if (!parentId || !byId.has(parentId) || trail.has(id)) {
      depthMemo.set(id, 0);
      return 0;
    }
    const next = new Set(trail);
    next.add(id);
    const result = depth(byId.get(parentId), next) + 1;
    depthMemo.set(id, result);
    return result;
  };
  return (items || []).slice().sort((a, b) => {
    const byDepth = depth(a) - depth(b);
    if (byDepth) return byDepth;
    const byTime = clean(a.row.source_created_at).localeCompare(clean(b.row.source_created_at));
    return byTime || clean(a.row.id).localeCompare(clean(b.row.id));
  });
}

function intrinsicComment(row) {
  const value = row || {};
  return stableValue({
    id: clean(value.id),
    idempotency_key: clean(value.idempotency_key),
    deliverable_id: clean(value.deliverable_id) || null,
    batch_id: clean(value.batch_id) || null,
    client_slug: clean(value.client_slug) || null,
    team: clean(value.team),
    native_comment_id: clean(value.native_comment_id) || null,
    linear_issue_uuid: clean(value.linear_issue_uuid),
    linear_identifier: clean(value.linear_identifier || value.linear_issue_identifier) || null,
    linear_comment_id: clean(value.linear_comment_id),
    parent_id: clean(value.parent_id) || null,
    thread_root_id: clean(value.thread_root_id) || null,
    linear_parent_comment_id: clean(value.linear_parent_comment_id) || null,
    linear_thread_root_id: clean(value.linear_thread_root_id) || null,
    body: String(value.body == null ? '' : value.body),
    body_format: clean(value.body_format) || 'markdown',
    attachments: Array.isArray(value.attachments) ? value.attachments : parseArray(value.attachments),
    author_key: clean(value.author_key),
    author_member_id: clean(value.author_member_id) || null,
    author_name: clean(value.author_name),
    role: clean(value.role || value.author_role),
    linear_author_id: clean(value.linear_author_id) || null,
    transport_linear_user_id: clean(value.transport_linear_user_id) || null,
    transport_actor: clean(value.transport_actor || value.transport_author_name) || null,
    transport_role: clean(value.transport_role) || null,
    audience: clean(value.audience),
    component: clean(value.component) || null,
    is_tweak: value.is_tweak === true || String(value.is_tweak) === 'true',
    round: value.round == null || value.round === '' ? null : Number(value.round),
    source: clean(value.source),
    origin: clean(value.origin),
    source_created_at: canonicalTime(value.source_created_at),
    source_updated_at: canonicalTime(value.source_updated_at),
    edited_at: canonicalTime(value.edited_at),
    deleted_at: canonicalTime(value.deleted_at),
    resolved_at: canonicalTime(value.resolved_at),
  });
}

function contentSignature(row) {
  return sha256(stableJson(intrinsicComment(row)));
}

function exactLegacyKey(body, author) {
  return `${normalizeNewlines(body)}\u0000${personNameKey(author)}`;
}

function legacyIssueBodyKey(issueUuid, body) {
  return `${clean(issueUuid)}\u0000${normalizeNewlines(body)}`;
}

function applyLegacyNativeRecovery(normalized, mapping, existingRows = [], options = {}) {
  if (typeof existingRows === 'number') {
    options = { legacy_native_cap: existingRows };
    existingRows = [];
  }
  const cap = Number(options.legacy_native_cap == null ? 8 : options.legacy_native_cap);
  const captureAt = canonicalTime(options.legacy_capture_at) || new Date().toISOString();
  const candidates = new Map();
  for (const item of normalized) {
    const deliverableId = clean(item.row.deliverable_id);
    if (!deliverableId) continue;
    const key = legacyIssueBodyKey(item.row.linear_issue_uuid || deliverableId, item.row.body);
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push(item);
  }
  const matches = [];
  const standalone = [];
  const skipped = [];
  const usedLinear = new Set();
  const existingNativeIds = new Set((existingRows || []).map(row => clean(row.native_comment_id)).filter(Boolean));
  for (const [deliverableId, comments] of mapping.legacyByDeliverable.entries()) {
    for (let ordinal = 0; ordinal < comments.length; ordinal++) {
      const legacy = comments[ordinal];
      if (legacy.deleted || legacy.hidden) continue;
      const originalNativeId = clean(legacy.id);
      const nativeAlreadyStored = !!originalNativeId && existingNativeIds.has(originalNativeId);
      const subject = mapping.byDeliverableId.get(deliverableId);
      if (!subject) throw new Error(`Legacy comment deliverable mapping missing: ${deliverableId}`);
      const key = legacyIssueBodyKey(subject.linear_issue_uuid || deliverableId, legacy.body);
      const rows = candidates.get(key) || [];
      if (rows.length === 1 && !usedLinear.has(rows[0].row.linear_comment_id)) {
        const item = rows[0];
        usedLinear.add(item.row.linear_comment_id);
        if (originalNativeId) item.row.native_comment_id = originalNativeId;
        item.row.origin = 'legacy';
        item.row.provenance = {
          ...item.row.provenance,
          legacy_native_recovery: true,
          native_original_timestamp: 'unavailable',
          native_timestamp_used: false,
          ingestion_timestamp_only: true,
          native_id_provenance: originalNativeId ? 'legacy_original' : 'linear_derived',
        };
        matches.push(item);
        continue;
      }
      if (nativeAlreadyStored) {
        skipped.push({ reason: 'native_comment_already_stored' });
        continue;
      }
      if (rows.length > 1) skipped.push({ reason: 'ambiguous_exact_match_supplemented' });
      else if (rows.length === 1) skipped.push({ reason: 'linear_comment_already_matched_supplemented' });
      else skipped.push({ reason: 'no_exact_match_supplemented' });

      const authorName = clean(legacy.author) || 'Legacy comment';
      const member = mapping.membersByName.get(personNameKey(authorName)) || null;
      const derivedId = `legacy:${sha256(`${deliverableId}\u0000${authorName}\u0000${normalizeNewlines(legacy.body)}\u0000${ordinal}`).slice(0, 32)}`;
      const id = derivedId;
      standalone.push({
        row: {
          id,
          idempotency_key: id,
          native_comment_id: originalNativeId || id,
          deliverable_id: deliverableId,
          batch_id: null,
          client_slug: subject.client_slug || null,
          team: lower(subject.team) === 'graphics' ? 'graphics' : 'video',
          linear_issue_uuid: subject.linear_issue_uuid || null,
          linear_identifier: subject.linear_identifier || null,
          linear_comment_id: null,
          parent_id: null,
          thread_root_id: id,
          linear_parent_comment_id: null,
          linear_thread_root_id: null,
          author_key: member ? `team:${clean(member.id)}` : `legacy-name:${personNameKey(authorName).replace(/\s+/g, '-')}`,
          author_member_id: member ? clean(member.id) || null : null,
          linear_author_id: null,
          author_name: member ? clean(member.name) || authorName : authorName,
          role: member ? clean(member.role) || 'legacy' : 'legacy',
          transport_actor: null,
          transport_role: null,
          transport_linear_user_id: null,
          body: normalizeNewlines(legacy.body),
          body_format: 'plain',
          attachments: [],
          audience: clean(legacy.audience) === 'client' ? 'client' : 'internal',
          component: clean(legacy.component) || null,
          is_tweak: legacy.is_tweak === true,
          round: Number(legacy.round) > 0 ? Number(legacy.round) : null,
          origin: 'legacy',
          source: 'backfill',
          source_created_at: captureAt,
          source_updated_at: captureAt,
          edited_at: null,
          deleted_at: null,
          resolved_at: legacy.done ? captureAt : null,
          version: 1,
          import_run_id: options.import_run_id || null,
          backfill_tag: options.backfill_tag || options.import_run_id || null,
          provenance: {
            imported_from: 'deliverables.comments',
            legacy_native_recovery: true,
            timestamp_provenance: 'ingestion_only',
            native_original_timestamp: 'unavailable',
            native_timestamp_used: false,
            native_id_provenance: originalNativeId ? 'legacy_original' : 'deterministic_derived',
          },
        },
        subject,
        issue_project_id: '',
        issue_project_name: '',
        team: lower(subject.team) === 'graphics' ? 'GRA' : 'VID',
      });
    }
  }
  if (standalone.length > cap) {
    throw new Error(`Refusing ${standalone.length} standalone legacy-native additions; cap is ${cap}`);
  }
  normalized.push(...standalone);
  return { matches, standalone, skipped };
}

function scopeAllows(item, scope) {
  if (scope === 'full') return true;
  return !!item.subject
    && lower(item.subject.client_slug) === TEST_CLIENT
    && TEST_PROJECT_NAMES.has(item.issue_project_name)
    && TRACK_TEAMS.has(item.team);
}

function planBackfill(normalized, existingRows, options) {
  const byLinearId = new Map();
  const byId = new Map();
  for (const row of existingRows || []) {
    if (clean(row.linear_comment_id)) byLinearId.set(clean(row.linear_comment_id), row);
    if (clean(row.id)) byId.set(clean(row.id), row);
  }
  const planned = [];
  const inserts = [];
  const updates = [];
  const noops = [];
  const staleNoops = [];
  const conflicts = [];
  const skipped = [];
  for (const item of normalized) {
    if (!scopeAllows(item, options.scope)) {
      skipped.push({ reason: 'outside_scope' });
      continue;
    }
    if (!clean(item.row.linear_comment_id) && clean(item.row.origin) !== 'legacy') {
      skipped.push({ reason: 'missing_linear_comment_id' });
      continue;
    }
    const existing = (clean(item.row.linear_comment_id) && byLinearId.get(item.row.linear_comment_id))
      || byId.get(item.row.id) || null;
    if (!existing) {
      planned.push(item);
      inserts.push(item);
      continue;
    }
    if (clean(existing.id) === item.row.id
        && clean(existing.linear_comment_id) !== clean(item.row.linear_comment_id)) {
      conflicts.push({ reason: 'id_collision' });
      continue;
    }
    if (clean(existing.source) === 'backfill' && clean(existing.import_run_id)
        && clean(existing.import_run_id) !== clean(options.import_run_id)) {
      conflicts.push({ reason: 'backfill_run_mismatch' });
      continue;
    }
    const wantedTime = Date.parse(clean(item.row.source_updated_at));
    const existingTime = Date.parse(clean(existing.source_updated_at));
    const transitionAdvanced = ['edited_at', 'deleted_at', 'resolved_at'].some(field => {
      const wantedTransition = Date.parse(clean(item.row[field]));
      const existingTransition = Date.parse(clean(existing[field]));
      return Number.isFinite(wantedTransition)
        && (!Number.isFinite(existingTransition) || wantedTransition > existingTransition);
    });
    const sameContent = contentSignature(existing) === contentSignature(item.row);
    const safelyLinked = clean(existing.linear_comment_id) === clean(item.row.linear_comment_id)
      && normalizeNewlines(existing.body) === normalizeNewlines(item.row.body)
      && (clean(existing.author_key) === clean(item.row.author_key)
        || clean(existing.author_name) === clean(item.row.author_name));
    const recoveryEnrichment = clean(existing.source) === 'backfill'
      && item.row.provenance && item.row.provenance.legacy_native_recovery === true
      && safelyLinked
      && clean(existing.deliverable_id) === clean(item.row.deliverable_id)
      && clean(existing.batch_id) === clean(item.row.batch_id)
      && clean(existing.linear_issue_uuid) === clean(item.row.linear_issue_uuid)
      && ['parent_id', 'thread_root_id', 'linear_parent_comment_id', 'linear_thread_root_id']
        .every(field => clean(existing[field]) === clean(item.row[field]))
      && ['edited_at', 'deleted_at', 'resolved_at']
        .every(field => canonicalTime(existing[field]) === canonicalTime(item.row[field]))
      && wantedTime === existingTime;
    const nativeTargetEnrichment = clean(existing.source) === 'backfill'
      && safelyLinked
      && !clean(existing.deliverable_id)
      && !clean(existing.batch_id)
      && (!!clean(item.row.deliverable_id) || !!clean(item.row.batch_id))
      && clean(existing.linear_issue_uuid) === clean(item.row.linear_issue_uuid)
      && ['parent_id', 'thread_root_id', 'linear_parent_comment_id', 'linear_thread_root_id']
        .every(field => clean(existing[field]) === clean(item.row[field]))
      && ['edited_at', 'deleted_at', 'resolved_at']
        .every(field => canonicalTime(existing[field]) === canonicalTime(item.row[field]))
      && wantedTime === existingTime;
    const standaloneRecoveryReplay = recoveryEnrichment
      && !clean(item.row.linear_comment_id)
      && clean(existing.id) === clean(item.row.id)
      && clean(existing.native_comment_id) === clean(item.row.native_comment_id);
    if (sameContent || standaloneRecoveryReplay
        || (clean(existing.source) !== 'backfill' && safelyLinked)) {
      noops.push(item);
    } else if (Number.isFinite(wantedTime) && Number.isFinite(existingTime) && wantedTime < existingTime) {
      staleNoops.push(item);
    } else if (clean(existing.source) === 'backfill'
        && Number.isFinite(wantedTime) && Number.isFinite(existingTime)
        && (wantedTime > existingTime || (wantedTime === existingTime && transitionAdvanced)
          || recoveryEnrichment || nativeTargetEnrichment)) {
      item.existing = existing;
      planned.push(item);
      updates.push(item);
    } else {
      conflicts.push({ reason: 'content_mismatch' });
    }
  }
  return { planned, inserts, updates, noops, stale_noops: staleNoops, conflicts, skipped };
}

function countBy(rows, keyFn) {
  const out = {};
  for (const row of rows || []) {
    const key = clean(keyFn(row)) || 'unknown';
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function reconcileIds(normalized, existingRows, scope) {
  const source = new Set(normalized.filter(item => scopeAllows(item, scope))
    .map(item => clean(item.row.linear_comment_id)).filter(Boolean));
  const scopeIssues = new Set(normalized.filter(item => scopeAllows(item, scope))
    .map(item => item.row.linear_issue_uuid));
  const stored = new Set((existingRows || [])
    .filter(row => scope === 'full' || scopeIssues.has(clean(row.linear_issue_uuid)))
    .map(row => clean(row.linear_comment_id)).filter(Boolean));
  return {
    source_ids: source.size,
    stored_ids: stored.size,
    missing_from_store: [...source].filter(id => !stored.has(id)).length,
    extra_in_store: [...stored].filter(id => !source.has(id)).length,
  };
}

function publicSummary(normalized, plan, options, pages, legacyRecovery, reconcileBefore, applyResult, reconcileAfter) {
  const scoped = normalized.filter(item => scopeAllows(item, options.scope));
  const rows = scoped.map(item => item.row);
  return {
    ok: plan.conflicts.length === 0 && (!reconcileAfter
      || (reconcileAfter.missing_from_store === 0 && reconcileAfter.extra_in_store === 0)),
    mode: options.apply ? 'apply' : 'dry-run',
    scope: options.scope,
    import_run_id: options.import_run_id,
    backfill_tag: options.backfill_tag,
    write_concurrency: options.write_concurrency,
    linear_read_only: true,
    linear_pages: pages,
    source_comments: normalized.filter(item => clean(item.row.linear_comment_id)).length,
    scoped_comments: scoped.length,
    mapped_deliverables: scoped.filter(item => item.subject && item.subject.kind === 'deliverable').length,
    mapped_batches: scoped.filter(item => item.subject && item.subject.kind === 'batch').length,
    mapped_archive_only: scoped.filter(item => item.subject && item.subject.kind === 'archive').length,
    unmapped: scoped.filter(item => !item.subject).length,
    by_team: countBy(scoped, item => item.team),
    replies: rows.filter(row => row.linear_parent_comment_id).length,
    edited: rows.filter(row => row.edited_at).length,
    deleted_or_archived: rows.filter(row => row.deleted_at).length,
    resolved: rows.filter(row => row.resolved_at).length,
    bridge_wrapped: rows.filter(row => row.provenance && row.provenance.bridge_wrapped).length,
    planned_writes: plan.planned.length,
    planned_inserts: plan.inserts.length,
    planned_updates: plan.updates.length,
    exact_noops: plan.noops.length,
    stale_noops: plan.stale_noops.length,
    conflicts: plan.conflicts.length,
    skipped_by_reason: countBy(plan.skipped, row => row.reason),
    legacy_native_recovery: legacyRecovery ? {
      enabled: true,
      exact_matches: legacyRecovery.matches.length,
      standalone_additions: legacyRecovery.standalone.length,
      skipped_by_reason: countBy(legacyRecovery.skipped, row => row.reason),
      native_original_timestamps_used: 0,
    } : { enabled: false },
    reconcile_before: reconcileBefore,
    apply: applyResult,
    reconcile_after: reconcileAfter,
  };
}

async function loadAllCommentPages(fetchPage, delayMs = 0) {
  const comments = [];
  const cursors = new Set();
  let after = null;
  let pages = 0;
  for (;;) {
    const connection = await fetchPage(after);
    const nodes = connection && Array.isArray(connection.nodes) ? connection.nodes : [];
    const pageInfo = connection && connection.pageInfo || {};
    comments.push(...nodes);
    pages++;
    if (!pageInfo.hasNextPage) break;
    const next = clean(pageInfo.endCursor);
    if (!next || cursors.has(next)) throw new Error('Linear comment pagination returned a missing or repeated cursor');
    cursors.add(next);
    after = next;
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return { comments, pages };
}

async function linearPage(options, after) {
  let attempt = 0;
  for (;;) {
    const response = await fetch(LINEAR_URL, {
      method: 'POST',
      headers: { Authorization: options.linear_key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: LINEAR_COMMENTS_QUERY, variables: { after: after || null } }),
    });
    const json = await response.json().catch(() => null);
    if (response.ok && json && !json.errors && json.data && json.data.comments) return json.data.comments;
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= options.retries) {
      throw new Error(`Linear comment read failed: HTTP ${response.status} ${JSON.stringify(json && json.errors || json).slice(0, 500)}`);
    }
    const retryAfter = Number(response.headers.get('retry-after'));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000 : Math.min(30000, 500 * (2 ** attempt));
    attempt++;
    await new Promise(resolve => setTimeout(resolve, wait));
  }
}

async function supabaseRows(options, table, select, params = '') {
  const rows = [];
  const limit = 1000;
  let offset = 0;
  for (;;) {
    const url = `${options.supabase_url}/rest/v1/${safeName(table)}?select=${encodeURIComponent(select)}&limit=${limit}&offset=${offset}${params ? `&${params}` : ''}`;
    const response = await fetch(url, {
      headers: {
        apikey: options.supabase_key,
        Authorization: `Bearer ${options.supabase_key}`,
        Accept: 'application/json',
      },
    });
    if (!response.ok) throw new Error(`Supabase ${table} read failed: HTTP ${response.status} ${(await response.text()).slice(0, 500)}`);
    const batch = await response.json();
    rows.push(...batch);
    if (!Array.isArray(batch) || batch.length < limit) break;
    offset += limit;
  }
  return rows;
}

async function supabaseRpc(options, name, body) {
  const response = await fetch(`${options.supabase_url}/rest/v1/rpc/${safeName(name)}`, {
    method: 'POST',
    headers: {
      apikey: options.supabase_key,
      Authorization: `Bearer ${options.supabase_key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Supabase RPC ${name} failed: HTTP ${response.status} ${(await response.text()).slice(0, 500)}`);
  return response.json().catch(() => null);
}

function selfContainedEvent(row) {
  return {
    source: 'backfill',
    action: 'linear_comment_backfill',
    actor: 'linear-comment-backfill',
    role: 'system',
    ts: row.source_created_at,
    import_run_id: row.import_run_id,
    backfill_tag: row.backfill_tag,
    payload: {
      import_run_id: row.import_run_id,
      backfill_tag: row.backfill_tag,
      comment: {
        id: row.id,
        idempotency_key: row.idempotency_key,
        deliverable_id: row.deliverable_id,
        batch_id: row.batch_id,
        native_comment_id: row.native_comment_id,
        linear_issue_uuid: row.linear_issue_uuid,
        linear_identifier: row.linear_identifier,
        linear_comment_id: row.linear_comment_id,
        parent_id: row.parent_id,
        thread_root_id: row.thread_root_id,
        body: row.body,
        body_format: row.body_format,
        attachments: row.attachments,
        author_key: row.author_key,
        author_member_id: row.author_member_id,
        author_name: row.author_name,
        role: row.role,
        audience: row.audience,
        source: row.source,
        origin: row.origin,
        source_created_at: row.source_created_at,
        source_updated_at: row.source_updated_at,
        edited_at: row.edited_at,
        deleted_at: row.deleted_at,
        resolved_at: row.resolved_at,
        version: row.version,
        provenance: row.provenance,
      },
    },
  };
}

async function applyPlan(plan, options) {
  if (!options.apply) return { attempted: 0, written: 0, dry_run: true };
  if (plan.conflicts.length) throw new Error(`Refusing apply with ${plan.conflicts.length} comment conflict(s)`);
  if (plan.planned.length > options.cap) {
    throw new Error(`Refusing ${plan.planned.length} comment writes; cap is ${options.cap}`);
  }
  let written = 0;
  const byId = new Map(plan.planned.map(item => [clean(item.row.id), item]));
  const depthMemo = new Map();
  const depthFor = (item, trail = new Set()) => {
    const id = clean(item.row.id);
    if (!id || depthMemo.has(id)) return depthMemo.get(id) || 0;
    const parentId = clean(item.row.parent_id);
    if (!parentId || !byId.has(parentId) || trail.has(id)) {
      depthMemo.set(id, 0);
      return 0;
    }
    const next = new Set(trail);
    next.add(id);
    const depth = depthFor(byId.get(parentId), next) + 1;
    depthMemo.set(id, depth);
    return depth;
  };
  const byDepth = new Map();
  for (const item of plan.planned) {
    const depth = depthFor(item);
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth).push(item);
  }
  const concurrency = Math.max(1, Math.min(16, options.write_concurrency || 8));
  for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
    const items = byDepth.get(depth);
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        const item = items[index];
        await supabaseRpc(options, options.comment_rpc, {
          p_comment: item.row,
          p_event: selfContainedEvent(item.row),
        });
        written++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  }
  return { attempted: plan.planned.length, written, dry_run: false, write_concurrency: concurrency };
}

function sqlLiteral(value) {
  return `'${String(value == null ? '' : value).replace(/'/g, "''")}'`;
}

function renderRollbackSql(importRunId) {
  const run = sqlLiteral(clean(importRunId));
  return `begin;
do $$
begin
  if exists (
    select 1 from public.production_comments
    where import_run_id = ${run} and source <> 'backfill'
  ) then
    raise exception 'rollback refused: tagged comments have non-backfill changes';
  end if;
end $$;
delete from public.deliverable_events
where source = 'backfill'
  and action in ('comment_add', 'comment_edit', 'comment_delete', 'comment_resolve',
                 'comment_unresolve', 'comment_link_linear', 'comment_link_native')
  and coalesce(payload->>'import_run_id', payload#>>'{comment,import_run_id}') = ${run};
delete from public.production_comments
where source = 'backfill' and import_run_id = ${run};
commit;`;
}

function publicReportPathWrite(file, report) {
  if (!file) return;
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  const options = validateOptions(optionsFrom(process.argv.slice(2)));
  if (!options.linear_key) throw new Error('LINEAR_API_KEY is required');
  if (!options.supabase_key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

  const [pageResult, deliverables, batches, archive, members, existingRows] = await Promise.all([
    loadAllCommentPages(after => linearPage(options, after), options.page_delay_ms),
    supabaseRows(options, 'deliverables', 'id,identifier,batch_id,client_slug,team,comments,linear_issue_uuid,linear_identifier,linear_issue_url'),
    supabaseRows(options, 'batches', 'id,client_slug,team,linear_parent_ids'),
    supabaseRows(options, 'linear_archive', 'linear_uuid,identifier,team,client_slug'),
    supabaseRows(options, 'team_members', 'id,name,role,linear_user_id'),
    supabaseRows(options, options.comment_table, COMMENT_SELECT),
  ]);
  const mapping = buildMappingIndex({ deliverables, batches, archive, members });
  const normalized = normalizeLinearComments(pageResult.comments, mapping, options);
  const legacyRecovery = options.recover_legacy_native
    ? applyLegacyNativeRecovery(normalized, mapping, existingRows, options) : null;
  const plan = planBackfill(normalized, existingRows, options);
  const reconcileBefore = reconcileIds(normalized, existingRows, options.scope);
  const applyResult = await applyPlan(plan, options);
  const afterRows = options.apply
    ? await supabaseRows(options, options.comment_table, COMMENT_SELECT)
    : existingRows;
  const reconcileAfter = options.apply ? reconcileIds(normalized, afterRows, options.scope) : null;
  const report = publicSummary(normalized, plan, options, pageResult.pages, legacyRecovery,
    reconcileBefore, applyResult, reconcileAfter);
  publicReportPathWrite(options.json_report, report);
  console.log(JSON.stringify(report, null, 2));
  if (plan.conflicts.length || (reconcileAfter
      && (reconcileAfter.missing_from_store || reconcileAfter.extra_in_store))) process.exitCode = 2;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack || error && error.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  BRIDGE_PREFIX,
  LINEAR_COMMENTS_QUERY,
  MIRROR_MARKER,
  TEST_CLIENT,
  TEST_PROJECT_NAMES,
  applyLegacyNativeRecovery,
  assertUniqueLinearCommentIds,
  buildMappingIndex,
  contentSignature,
  exactLegacyKey,
  intrinsicComment,
  linearThreadRoots,
  loadAllCommentPages,
  normalizeLinearComments,
  optionsFrom,
  parseArgs,
  parseBridgeBody,
  planBackfill,
  publicSummary,
  reconcileIds,
  resolveAuthor,
  renderRollbackSql,
  scopeAllows,
  selfContainedEvent,
  sortParentFirst,
  validateOptions,
};
