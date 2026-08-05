#!/usr/bin/env node
'use strict';

/*
 * B3 exact-scope card-linkage repair planner and RPC runner.
 *
 * This is deliberately a separate lane from b3-linkage-backfill.js. The
 * original B3 global-zero gate remains byte-for-byte unchanged and continues
 * to report the unrelated global residue as BLOCKED. This runner can declare
 * only an owner-reviewed exact cohort READY, and can write only
 * calendar_posts.graphic_deliverable_id through the separately installed
 * transactional RPC.
 *
 * Dry-run is the default. Ambient APPLY is rejected; only the literal --apply
 * argument can request the mutation path. Archive promotion and deliverable
 * creation are outside this contract and are always rejected.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  extractIdentifier,
  normalizeUrl,
  planLinkageBackfill,
  strictActiveCalendarSweep,
  summarizeStrictSweep,
} = require('./b3-linkage-backfill');
const {
  clean,
  deliverableArchivedOrDeleted,
} = require('./linear-deliverables-reconcile-lib');

const ROOT = path.resolve(__dirname, '..');
const ROOT_REAL = (fs.realpathSync.native || fs.realpathSync)(ROOT);
const MANIFEST_CONTRACT = 'syncview-b3-scoped-linkage-manifest-v2';
const SNAPSHOT_CONTRACT = 'syncview-b3-scoped-linkage-snapshot-v1';
const PLAN_CONTRACT = 'b3-scoped-card-linkage/v2';
const ROLLBACK_CONTRACT = 'b3-scoped-card-linkage-rollback/v2';
const SCOPE_POLICY = 'exact_calendar_graphic_url_to_native_cohort_bound_v2';
const OWNER_CONFIRM_ENV = 'B3_SCOPED_LINKAGE_CONFIRM';
const OWNER_CONFIRM_TOKEN = 'APPLY_EXACT_CARD_POINTER_SCOPE';
const APPLY_RPC = 'b3_scoped_card_linkage_apply';
const PREFLIGHT_RPC = 'b3_scoped_card_linkage_preflight';
const PUBLIC_DATABASE_FAILURES = Object.freeze({
  B3P01: 'REFUSED_PLAN',
  B3P02: 'REFUSED_LIVE_DRIFT',
  B3P03: 'REFUSED_CROSSWALK',
  B3C01: 'REFUSED_CONTENTION',
  B3C02: 'EXECUTION_INTERRUPTED',
  B3P04: 'REFUSED_REPLAY',
  B3P05: 'FAILED_INTERNAL',
  B3P06: 'REFUSED_COHORT_POPULATION',
  B3F01: 'PREFLIGHT_FAILED_INTERNAL',
  B3R01: 'ROLLBACK_INPUT_REFUSED',
  B3R02: 'ROLLBACK_RECEIPT_REFUSED',
  B3R03: 'ROLLBACK_ACTIVITY_REFUSED',
  B3R04: 'ROLLBACK_STATE_REFUSED',
  B3R05: 'ROLLBACK_REPLAY_REFUSED',
  B3R06: 'ROLLBACK_FAILED_INTERNAL',
});
const APPLY_DATABASE_FAILURE_CODES = new Set([
  'B3P01', 'B3P02', 'B3P03', 'B3C01', 'B3C02', 'B3P04', 'B3P05', 'B3P06',
]);
const PREFLIGHT_DATABASE_FAILURE_CODES = new Set(['B3C01', 'B3C02', 'B3F01']);
const DEFAULT_SUPABASE_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co';
const EMPTY_COMMENT_DIGEST = stableDigest([]);
const MAX_MANIFEST_AGE_MS = 6 * 60 * 60 * 1000;

const ALLOWED_ARGUMENTS = new Set([
  'scope-manifest',
  'snapshot',
  'private-plan',
  'apply',
  'expected-writes',
  'expected-scope-digest',
  'expected-plan-digest',
  'expected-global-failures',
  'expected-global-digest',
  'expected-runner-sha256',
  'rollback-artifact',
  'release-sha',
  'help',
]);

const CARD_BEFORE_FIELDS = Object.freeze([
  'status',
  'graphic_status',
  'updated_at',
  'posted_at',
  'graphic_linear_issue_id',
  'graphic_tweaks',
]);

const DELIVERABLE_BEFORE_FIELDS = Object.freeze([
  'id',
  'client_slug',
  'team',
  'kind',
  'origin',
  'card_id',
  'status',
  'updated_at',
  'linear_issue_uuid',
  'linear_identifier',
  'linear_issue_url',
]);

function lower(value) {
  return clean(value).toLowerCase();
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function exactValue(value) {
  return value === undefined ? null : value;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value === undefined ? null : value;
  return Object.fromEntries(Object.keys(value).sort().map(function mapKey(key) {
    return [key, stable(value[key])];
  }));
}

function stableDigest(value) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value == null ? '' : value)).digest('hex');
}

function snapshotContentDigest(snapshotInput) {
  const snapshot = snapshotInput && typeof snapshotInput === 'object' ? snapshotInput : {};
  return stableDigest({
    project_ref: exactValue(snapshot.project_ref),
    release_sha: exactValue(snapshot.release_sha),
    runner_sha256: exactValue(snapshot.runner_sha256),
    clients: Array.isArray(snapshot.clients) ? snapshot.clients : [],
    prodAuthority: snapshot.prodAuthority || snapshot.prod_authority || null,
    calendarPosts: Array.isArray(snapshot.calendarPosts) ? snapshot.calendarPosts : [],
    sampleReviews: Array.isArray(snapshot.sampleReviews) ? snapshot.sampleReviews : [],
    deliverables: Array.isArray(snapshot.deliverables) ? snapshot.deliverables : [],
    linearArchive: Array.isArray(snapshot.linearArchive) ? snapshot.linearArchive : [],
    productionComments: Array.isArray(snapshot.productionComments)
      ? snapshot.productionComments
      : [],
  });
}

function exactEqual(left, right) {
  return JSON.stringify(stable(exactValue(left))) === JSON.stringify(stable(exactValue(right)));
}

function canonicalizeLinearIssue(value) {
  const raw = clean(value);
  return {
    raw_url: raw,
    canonical_url: normalizeUrl(raw),
    identifier: extractIdentifier(raw),
  };
}

function truthyEnv(value) {
  return /^(1|true|yes|on)$/i.test(clean(value));
}

function containsForbiddenDescriptor(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsForbiddenDescriptor);
  const forbiddenKeys = new Set([
    'promote',
    'promote_archive',
    'archive',
    'archive_promotion',
    'archive_descriptor',
    'promotion',
    'promote_descriptor',
    'promotion_descriptor',
    'create_deliverable',
    'create_batch',
    'create_descriptor',
    'create',
  ]);
  return Object.entries(value).some(function forbidden(entry) {
    const normalizedKey = clean(entry[0])
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[-\s]+/g, '_')
      .toLowerCase();
    return forbiddenKeys.has(normalizedKey) || containsForbiddenDescriptor(entry[1]);
  });
}

function terminalStatus(value) {
  const status = lower(value).replace(/[\s-]+/g, '_');
  return status === 'posted'
    || status === 'published'
    || status === 'archived'
    || status === 'canceled'
    || status === 'cancelled'
    || status === 'duplicate';
}

function activeCard(row) {
  return Boolean(row) && !terminalStatus(row.status);
}

function parseArgs(argv, _env) {
  const args = { apply: false };
  const values = Array.isArray(argv) ? argv : [];
  for (let index = 0; index < values.length; index++) {
    const token = String(values[index]);
    if (!token.startsWith('--')) throw new Error('unexpected_argument');
    const inline = token.match(/^--([^=]+)=(.*)$/);
    let key;
    let value;
    if (inline) {
      key = inline[1];
      value = inline[2];
    } else {
      key = token.slice(2);
      const next = values[index + 1];
      if (next !== undefined && !String(next).startsWith('--')) {
        value = String(next);
        index++;
      } else {
        value = true;
      }
    }
    args[key] = key === 'apply' ? value === true : value;
  }
  args.apply = args.apply === true;
  return args;
}

function assertArgumentPolicy(args) {
  const keys = Object.keys(args || {});
  if (keys.some(function forbidden(key) {
    return /(^|[-_])(promote|archive|create)([-_]|$)/i.test(key);
  })) {
    throw new Error('archive_or_create_semantics_forbidden');
  }
  if (keys.some(function unknown(key) {
    return key !== 'apply' && !ALLOWED_ARGUMENTS.has(key);
  })) {
    throw new Error('unexpected_argument');
  }
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function physicalTarget(candidate) {
  let cursor = path.resolve(candidate);
  const suffix = [];
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  const physicalBase = fs.existsSync(cursor)
    ? (fs.realpathSync.native || fs.realpathSync)(cursor)
    : cursor;
  return path.resolve(physicalBase, ...suffix);
}

function assertPrivatePath(file) {
  const raw = clean(file);
  if (!raw || !path.isAbsolute(raw)) throw new Error('private_absolute_path_required');
  const resolved = path.resolve(raw);
  if (isInside(ROOT, resolved)) throw new Error('private_path_must_be_outside_repository');
  if (isInside(ROOT_REAL, physicalTarget(resolved))) {
    throw new Error('private_path_must_be_outside_repository');
  }
  return resolved;
}

function readPrivateJson(file, deps) {
  const io = deps || {};
  const resolved = (io.assertPrivatePath || assertPrivatePath)(file);
  const readFileSync = io.readFileSync || fs.readFileSync;
  return JSON.parse(readFileSync(resolved, 'utf8'));
}

function writePrivateJsonExclusive(file, value, deps) {
  const io = deps || {};
  const resolved = (io.assertPrivatePath || assertPrivatePath)(file);
  const existsSync = io.existsSync || fs.existsSync;
  if (existsSync(resolved)) throw new Error('private_artifact_already_exists');
  const mkdirSync = io.mkdirSync || fs.mkdirSync;
  mkdirSync(path.dirname(resolved), { recursive: true });
  if (io.writeFileSync) {
    io.writeFileSync(resolved, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return resolved;
  }
  const descriptor = fs.openSync(resolved, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, JSON.stringify(value, null, 2) + '\n');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return resolved;
}

function legacyCommentState(card) {
  let comments;
  if (Array.isArray(card && card.graphic_comments)) {
    comments = card.graphic_comments;
  } else {
    const raw = card && card.graphic_tweaks;
    if (raw === null || raw === undefined || raw === '') {
      comments = [];
    } else if (Array.isArray(raw)) {
      comments = raw;
    } else {
      try {
        const parsed = JSON.parse(String(raw));
        comments = Array.isArray(parsed) ? parsed : [parsed];
      } catch (_error) {
        comments = [String(raw)];
      }
    }
  }
  return {
    count: comments.length,
    digest: stableDigest(comments),
    raw: own(card, 'graphic_tweaks') ? card.graphic_tweaks : null,
  };
}

function nativeCommentState(snapshot, deliverableInput) {
  const deliverable = deliverableInput && typeof deliverableInput === 'object'
    ? deliverableInput
    : { id: deliverableInput };
  const deliverableId = clean(deliverable.id);
  const issueUuid = lower(deliverable.linear_issue_uuid);
  const issueIdentifier = extractIdentifier(deliverable.linear_identifier)
    || extractIdentifier(deliverable.linear_issue_url);
  const rows = (snapshot && snapshot.productionComments || [])
    .filter(function relevant(row) {
      return (deliverableId && clean(row && row.deliverable_id) === deliverableId)
        || (issueUuid && lower(row && row.linear_issue_uuid) === issueUuid)
        || (issueIdentifier
          && extractIdentifier(row && row.linear_identifier) === issueIdentifier);
    })
    .map(function metadata(row) {
      return {
        id: exactValue(row.id),
        deliverable_id: exactValue(row.deliverable_id),
        team: exactValue(row.team),
        component: exactValue(row.component),
        linear_issue_uuid: exactValue(row.linear_issue_uuid),
        linear_identifier: exactValue(row.linear_identifier),
        deleted_at: exactValue(row.deleted_at),
        version: exactValue(row.version),
        source_updated_at: exactValue(row.source_updated_at),
        updated_at: exactValue(row.updated_at),
      };
    })
    .sort(function byDigest(left, right) {
      return JSON.stringify(stable(left)).localeCompare(JSON.stringify(stable(right)));
    });
  return { count: rows.length, digest: stableDigest(rows) };
}

function pointerState(value) {
  if (value === null || value === undefined) return { state: 'null', value: null };
  if (value === '') return { state: 'empty', value: '' };
  return { state: 'populated', value: String(value) };
}

function entryIdentity(entry) {
  const card = entry && entry.card || {};
  return {
    client_slug: clean(entry && entry.client_slug || card.client || card.client_slug),
    card_id: clean(entry && entry.card_id || card.id),
    component: lower(entry && entry.component),
  };
}

function scopeKey(entry) {
  const identity = entryIdentity(entry);
  return [
    lower(identity.client_slug),
    identity.card_id,
    identity.component,
  ].join('\u0000');
}

function normalizeManifestEntry(entry) {
  const raw = entry && typeof entry === 'object' ? entry : {};
  const nestedCard = raw.card && typeof raw.card === 'object' ? raw.card : {};
  const flatCard = raw.card_before && typeof raw.card_before === 'object' ? raw.card_before : {};
  const nestedDeliverable = raw.deliverable && typeof raw.deliverable === 'object' ? raw.deliverable : {};
  const flatDeliverable = raw.deliverable_before && typeof raw.deliverable_before === 'object'
    ? raw.deliverable_before
    : {};
  const cardSource = Object.keys(nestedCard).length ? nestedCard : flatCard;
  const deliverableSource = Object.keys(nestedDeliverable).length ? nestedDeliverable : flatDeliverable;
  const missingFields = [];
  for (const field of [
    'surface',
    'component',
    'table',
    'link_column',
    'deliverable_column',
    'operation',
  ]) {
    if (!own(raw, field) || !clean(raw[field])) missingFields.push(field);
  }
  for (const field of CARD_BEFORE_FIELDS.concat([
    'graphic_deliverable_id',
    'graphic_comment_count',
    'graphic_comment_digest',
    'native_comment_count',
    'native_comment_digest',
  ])) {
    const aliases = {
      graphic_comment_count: ['graphic_comment_count', 'graphic_comments_count'],
      graphic_comment_digest: ['graphic_comment_digest', 'graphic_comments_sha256'],
    };
    const accepted = aliases[field] || [field];
    if (!accepted.some(function present(name) { return own(cardSource, name); })) {
      missingFields.push('card_before.' + field);
    }
  }
  for (const field of DELIVERABLE_BEFORE_FIELDS) {
    if (!own(deliverableSource, field)) missingFields.push('deliverable_before.' + field);
  }
  if (!own(raw, 'link_canonical_url')
      && !own(raw, 'linear_canonical_url')
      && !own(cardSource, 'graphic_linear_issue_canonical')) {
    missingFields.push('link_canonical_url');
  }
  if (!own(raw, 'link_identifier')) missingFields.push('link_identifier');
  const pointer = cardSource.graphic_deliverable_id;
  const pointerValue = pointer && typeof pointer === 'object' && own(pointer, 'value')
    ? pointer.value
    : pointer;
  const clientSlug = clean(raw.client_slug || nestedCard.client || nestedCard.client_slug);
  const cardId = clean(raw.card_id || nestedCard.id);
  const linkUrl = clean(raw.link_url || cardSource.graphic_linear_issue_id);
  const canonicalSource = own(raw, 'link_canonical_url')
    ? raw.link_canonical_url
    : (own(raw, 'linear_canonical_url')
      ? raw.linear_canonical_url
      : cardSource.graphic_linear_issue_canonical);
  const canonical = clean(canonicalSource);
  const identifier = clean(own(raw, 'link_identifier') ? raw.link_identifier : null).toUpperCase();
  const targetId = clean(raw.target_deliverable_id || deliverableSource.id);
  return {
    raw,
    surface: lower(raw.surface),
    component: lower(raw.component),
    table: clean(raw.table),
    link_column: clean(raw.link_column),
    deliverable_column: clean(raw.deliverable_column),
    operation: clean(raw.operation),
    missing_fields: missingFields,
    pointer_contract_invalid: Boolean(
      !pointer
      || typeof pointer !== 'object'
      || Array.isArray(pointer)
      || clean(pointer.state) !== 'null'
      || pointer.value !== null
    ),
    client_slug: clientSlug,
    card_id: cardId,
    link_url: linkUrl,
    link_canonical_url: canonical,
    link_identifier: identifier,
    target_deliverable_id: targetId,
    card_before: {
      status: cardSource.status,
      graphic_status: cardSource.graphic_status,
      updated_at: cardSource.updated_at,
      posted_at: cardSource.posted_at,
      graphic_linear_issue_id: own(cardSource, 'graphic_linear_issue_id')
        ? cardSource.graphic_linear_issue_id
        : linkUrl,
      graphic_tweaks: own(cardSource, 'graphic_tweaks') ? cardSource.graphic_tweaks : null,
      graphic_deliverable_id: pointerValue,
      graphic_comment_count: Number(
        cardSource.graphic_comment_count !== undefined
          ? cardSource.graphic_comment_count
          : cardSource.graphic_comments_count,
      ),
      graphic_comment_digest: clean(
        cardSource.graphic_comment_digest || cardSource.graphic_comments_sha256,
      ),
      native_comment_count: Number(cardSource.native_comment_count),
      native_comment_digest: clean(cardSource.native_comment_digest),
    },
    deliverable_before: Object.fromEntries(DELIVERABLE_BEFORE_FIELDS.map(function fieldValue(field) {
      return [field, deliverableSource[field]];
    })),
  };
}

function manifestEntryMissing(entry) {
  const missing = (entry.missing_fields || []).slice();
  if (!entry.client_slug) missing.push('client_slug');
  if (!entry.card_id) missing.push('card_id');
  if (!entry.link_url) missing.push('link_url');
  if (!entry.link_canonical_url) missing.push('link_canonical_url');
  if (!entry.link_identifier) missing.push('link_identifier');
  if (!entry.target_deliverable_id) missing.push('target_deliverable_id');
  for (const field of CARD_BEFORE_FIELDS) {
    if (!own(entry.card_before, field)) missing.push('card_before.' + field);
  }
  if (!own(entry.card_before, 'graphic_deliverable_id')) {
    missing.push('card_before.graphic_deliverable_id');
  }
  if (!Number.isInteger(entry.card_before.graphic_comment_count)) {
    missing.push('card_before.graphic_comment_count');
  }
  if (!entry.card_before.graphic_comment_digest) {
    missing.push('card_before.graphic_comment_digest');
  }
  if (!Number.isInteger(entry.card_before.native_comment_count)) {
    missing.push('card_before.native_comment_count');
  }
  if (!entry.card_before.native_comment_digest) {
    missing.push('card_before.native_comment_digest');
  }
  if (entry.pointer_contract_invalid) missing.push('card_before.graphic_deliverable_id.contract');
  for (const field of DELIVERABLE_BEFORE_FIELDS) {
    if (!own(entry.deliverable_before, field)) missing.push('deliverable_before.' + field);
  }
  return missing;
}

function globalFailureDigest(sweep) {
  const failures = Array.isArray(sweep) ? sweep : (sweep && sweep.failures || []);
  const tokens = failures.map(function failureToken(row) {
    return [
      clean(row && row.source),
      clean(row && row.component),
      clean(row && row.client_slug),
      clean(row && row.card_id),
      clean(row && row.link_identifier),
      clean(row && row.reason),
      String(Number(row && row.candidate_count || 0)),
    ].map(function hex(value) {
      return Buffer.from(value, 'utf8').toString('hex');
    }).join(':');
  }).sort();
  return sha256Text(tokens.join('\n'));
}

function projectedSnapshot(snapshot, writes) {
  const projected = Object.assign({}, snapshot, {
    calendarPosts: (snapshot && snapshot.calendarPosts || []).map(function cloneCard(card) {
      return Object.assign({}, card);
    }),
  });
  const cards = new Map(projected.calendarPosts.map(function byCard(card) {
    return [[lower(card.client || card.client_slug), clean(card.id)].join('\u0000'), card];
  }));
  for (const write of writes || []) {
    const card = cards.get([lower(write.card.client), clean(write.card.id)].join('\u0000'));
    if (card) card.graphic_deliverable_id = write.deliverable.id;
  }
  return projected;
}

function allConsumers(snapshot, deliverableId) {
  const rows = [];
  const visit = function visit(surface, cards) {
    for (const card of cards || []) {
      for (const column of ['video_deliverable_id', 'graphic_deliverable_id']) {
        if (clean(card && card[column]) === clean(deliverableId)) {
          rows.push({
            surface,
            component: column === 'graphic_deliverable_id' ? 'graphic' : 'video',
            client_slug: clean(card.client || card.client_slug),
            card_id: clean(card.id || card.sample_id),
          });
        }
      }
    }
  };
  visit('calendar', snapshot && snapshot.calendarPosts);
  visit('samples', snapshot && snapshot.sampleReviews);
  return rows;
}

function activeClientRows(snapshot, clientSlug) {
  const clients = snapshot && (snapshot.clients || snapshot.activeClients) || [];
  return clients.filter(function sameClient(row) {
    return clean(row && row.slug) === clean(clientSlug)
      && row.active === true
      && lower(row.kind) === 'client';
  });
}

function cohortClientSlugs(value) {
  return (Array.isArray(value) ? value : []).map(function normalizedClient(row) {
    return clean(row);
  });
}

function cohortPopulationKey(row) {
  return [
    lower(row && row.client_slug),
    clean(row && row.card_id),
    'graphic',
  ].join('\u0000');
}

function cohortPopulationDigest(rowsInput) {
  const tokens = (Array.isArray(rowsInput) ? rowsInput : []).map(function populationToken(row) {
    return [
      clean(row && row.client_slug),
      clean(row && row.card_id),
      'graphic',
    ].map(function hex(value) {
      return Buffer.from(value, 'utf8').toString('hex');
    }).join(':');
  }).sort();
  return sha256Text(tokens.join('\n'));
}

// The cohort population is deliberately broader than the B3 planner's
// successful rows. It is every live, unposted Calendar Graphics source defect
// for the explicitly reviewed clients. A skipped/archive-only/unresolved row
// therefore cannot disappear outside the manifest merely because B3 cannot
// repair it; the exact-scope lane blocks instead.
function cohortPopulationRows(snapshotInput, clientSlugsInput) {
  const snapshot = snapshotInput && typeof snapshotInput === 'object' ? snapshotInput : {};
  const clients = new Set(cohortClientSlugs(clientSlugsInput));
  return (snapshot.calendarPosts || []).filter(function populationCard(card) {
    const clientSlug = clean(card && (card.client || card.client_slug));
    return clients.has(clientSlug)
      && activeClientRows(snapshot, clientSlug).length === 1
      && clean(card && card.status) !== ''
      && activeCard(card)
      && !clean(card && card.posted_at)
      && clean(card && card.graphic_status) !== ''
      && !terminalStatus(card && card.graphic_status)
      && clean(card && card.graphic_linear_issue_id) !== ''
      && (card.graphic_deliverable_id === null
        || card.graphic_deliverable_id === undefined
        || card.graphic_deliverable_id === '');
  }).map(function populationIdentity(card) {
    return {
      client_slug: clean(card.client || card.client_slug),
      card_id: clean(card.id),
      component: 'graphic',
    };
  }).sort(function sortPopulation(left, right) {
    return cohortPopulationKey(left).localeCompare(cohortPopulationKey(right));
  });
}

function b3PlanKey(row) {
  return [
    lower(row && row.client_slug),
    clean(row && row.card_id),
    lower(row && row.component),
  ].join('\u0000');
}

function addReason(reasons, reason) {
  if (reason && !reasons.includes(reason)) reasons.push(reason);
}

function buildScopedPlan(snapshotInput, manifestInput, options) {
  const snapshot = snapshotInput && typeof snapshotInput === 'object' ? snapshotInput : {};
  const manifest = manifestInput && typeof manifestInput === 'object' ? manifestInput : {};
  const opts = options || {};
  const reasons = [];
  const privateErrors = [];
  const expectedCount = Number(opts.expectedCount !== undefined ? opts.expectedCount : manifest.expected_count);
  const rawEntries = Array.isArray(manifest.entries) ? manifest.entries : [];
  const entries = rawEntries.map(normalizeManifestEntry);
  const rawCohortClients = manifest.scope_clients;
  const cohortClients = cohortClientSlugs(rawCohortClients);

  if (clean(snapshot.contract) !== SNAPSHOT_CONTRACT) addReason(reasons, 'snapshot_contract_mismatch');
  const snapshotGenerated = Date.parse(clean(snapshot.generated_at));
  if (!Number.isFinite(snapshotGenerated)) addReason(reasons, 'snapshot_generated_at_invalid');
  if (clean(manifest.contract) !== MANIFEST_CONTRACT) addReason(reasons, 'manifest_contract_mismatch');
  if (containsForbiddenDescriptor(manifest)) {
    addReason(reasons, 'archive_or_create_semantics_forbidden');
  }
  if (clean(manifest.scope_policy) !== SCOPE_POLICY) addReason(reasons, 'scope_policy_mismatch');
  if (!Number.isInteger(expectedCount) || expectedCount <= 0 || expectedCount > 100
      || Number(manifest.expected_count) !== expectedCount
      || rawEntries.length !== expectedCount) {
    addReason(reasons, 'expected_count_mismatch');
  }
  if (rawEntries.length !== expectedCount) addReason(reasons, 'scope_membership_mismatch');
  if (!Array.isArray(rawCohortClients)
      || cohortClients.length < 1
      || cohortClients.length > 100
      || rawCohortClients.some(function invalidClient(value, index) {
        return typeof value !== 'string'
          || !cohortClients[index]
          || value !== cohortClients[index];
      })
      || new Set(cohortClients).size !== cohortClients.length
      || !exactEqual(cohortClients, cohortClients.slice().sort())) {
    addReason(reasons, 'scope_clients_invalid');
  }
  if (cohortClients.some(function inactiveScopeClient(clientSlug) {
    return activeClientRows(snapshot, clientSlug).length !== 1;
  })) {
    addReason(reasons, 'scope_client_not_active');
  }
  if (clean(manifest.snapshot_digest) !== snapshotContentDigest(snapshot)) {
    addReason(reasons, 'snapshot_digest_drift');
  }
  if (clean(manifest.project_ref) !== clean(snapshot.project_ref)) {
    addReason(reasons, 'project_ref_mismatch');
  }
  if (clean(manifest.release_sha) !== clean(snapshot.release_sha)
      || !/^[0-9a-f]{40}$/i.test(clean(manifest.release_sha))) {
    addReason(reasons, 'release_sha_mismatch');
  }
  const runnerSha256 = clean(opts.runnerSha256 || snapshot.runner_sha256);
  if (!/^[0-9a-f]{64}$/i.test(runnerSha256)
      || clean(manifest.runner_sha256) !== runnerSha256) {
    addReason(reasons, 'runner_sha256_mismatch');
  }
  if (opts.nowMs !== undefined) {
    const generated = Date.parse(clean(manifest.generated_at));
    if (!Number.isFinite(generated)
        || generated > Number(opts.nowMs) + 60000
        || Number(opts.nowMs) - generated > MAX_MANIFEST_AGE_MS) {
      addReason(reasons, 'manifest_not_fresh');
    }
    if (!Number.isFinite(snapshotGenerated)
        || snapshotGenerated > Number(opts.nowMs) + 60000
        || Number(opts.nowMs) - snapshotGenerated > MAX_MANIFEST_AGE_MS) {
      addReason(reasons, 'snapshot_not_fresh');
    }
  }

  const keys = entries.map(scopeKey);
  if (new Set(keys).size !== keys.length) addReason(reasons, 'duplicate_scope_entry');
  const targetIds = entries.map(function target(entry) { return entry.target_deliverable_id; });
  if (new Set(targetIds).size !== targetIds.length) addReason(reasons, 'duplicate_target_deliverable');
  const sortedKeys = keys.slice().sort();
  if (!exactEqual(keys, sortedKeys)) addReason(reasons, 'scope_entries_not_sorted');

  const population = cohortPopulationRows(snapshot, cohortClients);
  const populationKeys = population.map(cohortPopulationKey);
  const populationDigest = cohortPopulationDigest(population);
  const manifestUniqueKeys = new Set(keys);
  const populationUniqueKeys = new Set(populationKeys);
  const populationMissingFromManifest = populationKeys.filter(function missing(key) {
    return !manifestUniqueKeys.has(key);
  }).length;
  const manifestExtraFromPopulation = [...manifestUniqueKeys].filter(function extra(key) {
    return !populationUniqueKeys.has(key);
  }).length;
  const duplicateManifestEntries = keys.length - manifestUniqueKeys.size;
  if (!Number.isInteger(Number(manifest.cohort_population_count))
      || Number(manifest.cohort_population_count) !== expectedCount
      || Number(manifest.cohort_population_count) !== population.length
      || clean(manifest.cohort_population_digest) !== populationDigest
      || populationMissingFromManifest !== 0
      || manifestExtraFromPopulation !== 0
      || duplicateManifestEntries !== 0) {
    addReason(reasons, 'cohort_population_mismatch');
  }

  for (const entry of entries) {
    if (entry.surface !== 'calendar') addReason(reasons, 'scope_surface_must_be_calendar');
    if (entry.component !== 'graphic') addReason(reasons, 'scope_component_must_be_graphic');
    if (entry.table !== 'calendar_posts'
        || entry.link_column !== 'graphic_linear_issue_id'
        || entry.deliverable_column !== 'graphic_deliverable_id') {
      addReason(reasons, 'scope_write_shape_forbidden');
    }
    if (entry.operation !== 'link_existing_deliverable') {
      addReason(reasons, 'archive_or_create_semantics_forbidden');
    }
    if (manifestEntryMissing(entry).length) addReason(reasons, 'manifest_entry_incomplete');
  }

  const authority = snapshot.prodAuthority || snapshot.prod_authority || {};
  if (lower(authority.graphics) !== 'linear') addReason(reasons, 'graphics_authority_not_linear');

  const globalBefore = strictActiveCalendarSweep(snapshot);
  const beforeGlobalDigest = globalFailureDigest(globalBefore);
  if (globalBefore.failures.length < 1) addReason(reasons, 'global_gate_must_remain_blocked');
  if (Number(manifest.global_failure_count) !== globalBefore.failures.length) {
    addReason(reasons, 'global_failure_count_drift');
  }
  if (clean(manifest.global_failure_digest) !== beforeGlobalDigest) {
    addReason(reasons, 'global_failure_digest_drift');
  }

  const fullB3Plan = planLinkageBackfill(snapshot);
  const b3ByKey = new Map();
  for (const row of fullB3Plan.planned || []) {
    const key = b3PlanKey(row);
    if (!b3ByKey.has(key)) b3ByKey.set(key, []);
    b3ByKey.get(key).push(row);
  }
  const cohortB3Eligible = population.filter(function b3Eligible(row) {
    return (b3ByKey.get(cohortPopulationKey(row)) || []).length === 1;
  }).length;
  const cohortB3Skipped = population.length - cohortB3Eligible;
  if (cohortB3Skipped !== 0) addReason(reasons, 'cohort_contains_non_b3_row');

  const writes = [];
  for (const entry of entries) {
    let rowInvalid = false;
    const rowReason = function scopedRowReason(reason) {
      rowInvalid = true;
      addReason(reasons, reason);
    };
    const cards = (snapshot.calendarPosts || []).filter(function sameCard(card) {
      return clean(card && (card.client || card.client_slug)) === entry.client_slug
        && clean(card && card.id) === entry.card_id;
    });
    if (cards.length !== 1) {
      rowReason('scope_membership_mismatch');
      privateErrors.push({ type: 'card_cardinality', count: cards.length });
      continue;
    }
    const card = cards[0];

    if (activeClientRows(snapshot, entry.client_slug).length !== 1) {
      rowReason('client_not_active');
    }
    if (!clean(card.status) || !activeCard(card) || clean(card.posted_at)) rowReason('card_terminal');
    if (!clean(card.graphic_status) || terminalStatus(card.graphic_status)) {
      rowReason('graphic_status_terminal');
    }
    if (!exactEqual(card.graphic_deliverable_id, entry.card_before.graphic_deliverable_id)) {
      rowReason('card_pointer_before_drift');
    }
    const currentPointer = pointerState(card.graphic_deliverable_id);
    if (currentPointer.state !== 'null') {
      rowReason('card_pointer_must_be_null');
    }
    if (clean(card.graphic_linear_issue_id) !== entry.link_url) {
      rowReason('card_linear_url_drift');
    }
    if (normalizeUrl(card.graphic_linear_issue_id) !== entry.link_canonical_url
        || extractIdentifier(card.graphic_linear_issue_id) !== entry.link_identifier) {
      rowReason('card_linear_identity_drift');
    }
    if (!exactEqual(card.updated_at, entry.card_before.updated_at)) {
      rowReason('card_updated_at_drift');
    }
    for (const field of ['status', 'graphic_status', 'posted_at', 'graphic_tweaks']) {
      if (!exactEqual(card[field], entry.card_before[field])) {
        rowReason(field === 'graphic_tweaks'
          ? 'card_graphic_comments_drift'
          : 'card_before_state_drift');
      }
    }

    const legacyComments = legacyCommentState(card);
    if (legacyComments.count !== 0
        || entry.card_before.graphic_comment_count !== 0
        || entry.card_before.graphic_comment_digest !== EMPTY_COMMENT_DIGEST
        || legacyComments.digest !== entry.card_before.graphic_comment_digest) {
      rowReason('legacy_comments_not_zero');
    }

    const targets = (snapshot.deliverables || []).filter(function byId(deliverable) {
      return clean(deliverable && deliverable.id) === entry.target_deliverable_id;
    });
    if (targets.length !== 1) {
      rowReason('target_deliverable_cardinality');
      continue;
    }
    const deliverable = targets[0];
    for (const field of DELIVERABLE_BEFORE_FIELDS) {
      if (!exactEqual(deliverable[field], entry.deliverable_before[field])) {
        rowReason('deliverable_before_state_drift');
      }
    }

    const archived = deliverableArchivedOrDeleted(deliverable)
      || terminalStatus(deliverable.status);
    if (archived) rowReason('target_deliverable_archived');
    if (lower(deliverable.origin) !== 'calendar') rowReason('deliverable_origin_mismatch');
    if (lower(deliverable.team) !== 'graphics') rowReason('deliverable_team_mismatch');
    if (lower(deliverable.kind) !== 'thumbnail') rowReason('deliverable_kind_mismatch');
    if (clean(deliverable.client_slug) !== entry.client_slug) {
      rowReason('deliverable_client_mismatch');
    }
    if (clean(deliverable.card_id) !== entry.card_id) rowReason('deliverable_card_mismatch');

    const deliverableCanonical = canonicalizeLinearIssue(deliverable.linear_issue_url);
    const deliverableIdentifier = extractIdentifier(deliverable.linear_identifier)
      || deliverableCanonical.identifier;
    if (deliverableCanonical.canonical_url !== entry.link_canonical_url
        || deliverableIdentifier !== entry.link_identifier) {
      rowReason('deliverable_linear_identity_mismatch');
    }

    const exactCandidates = (snapshot.deliverables || []).filter(function exactCandidate(candidate) {
      return !deliverableArchivedOrDeleted(candidate)
        && !terminalStatus(candidate && candidate.status)
        && clean(candidate && candidate.client_slug) === entry.client_slug
        && lower(candidate && candidate.kind) === 'thumbnail'
        && normalizeUrl(candidate && candidate.linear_issue_url) === entry.link_canonical_url;
    });
    if (exactCandidates.length !== 1) {
      rowReason(exactCandidates.length > 1
        ? 'ambiguous_exact_url_candidate'
        : 'unresolved_exact_url_candidate');
    } else if (clean(exactCandidates[0].id) !== entry.target_deliverable_id) {
      rowReason('target_deliverable_changed');
    }

    const duplicateLinks = (snapshot.calendarPosts || []).filter(function duplicateLink(otherCard) {
      if (!activeCard(otherCard)) return false;
      if (clean(otherCard.client || otherCard.client_slug) !== entry.client_slug) return false;
      return ['linear_issue_id', 'graphic_linear_issue_id'].some(function sameLink(column) {
        return normalizeUrl(otherCard[column]) === entry.link_canonical_url;
      });
    });
    if (duplicateLinks.length !== 1) rowReason('duplicate_live_link');

    const slotOccupants = (snapshot.deliverables || []).filter(function slotOccupant(candidate) {
      return clean(candidate && candidate.client_slug) === entry.client_slug
        && lower(candidate && candidate.origin) === 'calendar'
        && clean(candidate && candidate.card_id) === entry.card_id
        && lower(candidate && candidate.kind) === 'thumbnail';
    });
    if (slotOccupants.length !== 1
        || clean(slotOccupants[0] && slotOccupants[0].id) !== entry.target_deliverable_id) {
      rowReason('card_slot_occupied');
    }

    if (allConsumers(snapshot, entry.target_deliverable_id).length !== 0) {
      rowReason('deliverable_has_other_consumer');
    }

    const nativeComments = nativeCommentState(snapshot, deliverable);
    if (nativeComments.count !== 0
        || entry.card_before.native_comment_count !== 0
        || entry.card_before.native_comment_digest !== EMPTY_COMMENT_DIGEST
        || nativeComments.digest !== entry.card_before.native_comment_digest) {
      rowReason('native_comments_not_zero');
    }

    const matchingB3 = b3ByKey.get(scopeKey(entry)) || [];
    if (matchingB3.length !== 1) {
      rowReason('scope_membership_mismatch');
    } else if (clean(matchingB3[0].deliverable_id) !== entry.target_deliverable_id) {
      rowReason('b3_target_disagrees');
    }

    if (!rowInvalid) {
      writes.push({
        surface: 'calendar',
        component: 'graphic',
        table: 'calendar_posts',
        link_column: 'graphic_linear_issue_id',
        deliverable_column: 'graphic_deliverable_id',
        operation: 'link_existing_deliverable',
        card: {
          client: entry.client_slug,
          id: entry.card_id,
          status: exactValue(card.status),
          graphic_status: exactValue(card.graphic_status),
          updated_at: exactValue(card.updated_at),
          posted_at: exactValue(card.posted_at),
          graphic_linear_issue_id: entry.link_url,
          graphic_linear_issue_canonical: entry.link_canonical_url,
          graphic_tweaks: exactValue(card.graphic_tweaks),
          graphic_deliverable_id: currentPointer,
          graphic_comments_count: legacyComments.count,
          graphic_comments_sha256: legacyComments.digest,
          native_comment_count: nativeComments.count,
          native_comment_digest: nativeComments.digest,
        },
        deliverable: {
          id: entry.target_deliverable_id,
          client_slug: exactValue(deliverable.client_slug),
          team: exactValue(deliverable.team),
          kind: exactValue(deliverable.kind),
          origin: exactValue(deliverable.origin),
          card_id: exactValue(deliverable.card_id),
          status: exactValue(deliverable.status),
          updated_at: exactValue(deliverable.updated_at),
          linear_issue_uuid: exactValue(deliverable.linear_issue_uuid),
          linear_identifier: exactValue(deliverable.linear_identifier),
          linear_issue_url: exactValue(deliverable.linear_issue_url),
          linear_issue_canonical: deliverableCanonical.canonical_url,
        },
      });
    }
  }

  if (writes.length !== expectedCount) addReason(reasons, 'scope_membership_mismatch');
  writes.sort(function sortWrites(left, right) {
    return [left.card.client, left.card.id].join('\u0000')
      .localeCompare([right.card.client, right.card.id].join('\u0000'));
  });

  const globalProjected = strictActiveCalendarSweep(projectedSnapshot(snapshot, writes));
  const projectedGlobalDigest = globalFailureDigest(globalProjected);
  if (globalProjected.failures.length !== globalBefore.failures.length
      || projectedGlobalDigest !== beforeGlobalDigest) {
    addReason(reasons, 'global_failure_multiset_changed');
  }
  const expectedShift = writes.length;
  if (globalBefore.resolved_by_exact_url - globalProjected.resolved_by_exact_url !== expectedShift
      || globalProjected.resolved_by_id - globalBefore.resolved_by_id !== expectedShift
      || globalBefore.checked !== globalProjected.checked
      || globalBefore.resolved !== globalProjected.resolved) {
    addReason(reasons, 'projected_resolution_shift_mismatch');
  }

  const scopeDigest = stableDigest({
    contract: MANIFEST_CONTRACT,
    scope_policy: SCOPE_POLICY,
    expected_count: expectedCount,
    scope_clients: cohortClients,
    cohort_population_count: population.length,
    cohort_population_digest: populationDigest,
    entries: entries.map(function digestEntry(entry) {
      return {
        surface: entry.surface,
        component: entry.component,
        client_slug: entry.client_slug,
        card_id: entry.card_id,
        link_url: entry.link_url,
        link_canonical_url: entry.link_canonical_url,
        link_identifier: entry.link_identifier,
        target_deliverable_id: entry.target_deliverable_id,
        card_before: entry.card_before,
        deliverable_before: entry.deliverable_before,
      };
    }),
  });
  const snapshotDigest = snapshotContentDigest(snapshot);
  const planDigest = stableDigest({
    contract: PLAN_CONTRACT,
    scope_policy: SCOPE_POLICY,
    expected_count: expectedCount,
    release_sha: clean(manifest.release_sha),
    runner_sha256: runnerSha256,
    prod_authority: stable(authority),
    prod_authority_digest: stableDigest(authority),
    snapshot_digest: snapshotDigest,
    scope_digest: scopeDigest,
    scope_clients: cohortClients,
    cohort_population_count: population.length,
    cohort_population_digest: populationDigest,
    global_failure_count: globalBefore.failures.length,
    global_failure_digest: beforeGlobalDigest,
    global_projected_failure_digest: projectedGlobalDigest,
    writes,
  });

  reasons.sort();
  const status = reasons.length ? 'BLOCKED' : 'READY';
  return {
    contract: PLAN_CONTRACT,
    status,
    reasons,
    private_errors: privateErrors,
    scope_policy: SCOPE_POLICY,
    expected_count: expectedCount,
    release_sha: clean(manifest.release_sha),
    runner_sha256: runnerSha256,
    prod_authority: stable(authority),
    prod_authority_digest: stableDigest(authority),
    snapshot_digest: snapshotDigest,
    scope_digest: scopeDigest,
    scope_clients: cohortClients,
    cohort_population_count: population.length,
    cohort_population_digest: populationDigest,
    plan_digest: planDigest,
    global_failure_count: globalBefore.failures.length,
    global_failure_digest: beforeGlobalDigest,
    global_projected_failure_digest: projectedGlobalDigest,
    global_gate: globalBefore.failures.length ? 'BLOCKED' : 'READY',
    exact_scope_gate: status,
    counts: {
      manifest_entries: rawEntries.length,
      cohort_population: population.length,
      cohort_missing_from_manifest: populationMissingFromManifest,
      cohort_extra_in_manifest: manifestExtraFromPopulation,
      cohort_duplicate_entries: duplicateManifestEntries,
      cohort_b3_eligible: cohortB3Eligible,
      cohort_b3_skipped: cohortB3Skipped,
      cohort_full_crosswalk_eligible: writes.length,
      planned_writes: writes.length,
      expected_writes: expectedCount,
      b3_global_planned: (fullB3Plan.planned || []).length,
      b3_global_skipped: (fullB3Plan.skipped || []).length,
    },
    global_before: globalBefore,
    global_projected: globalProjected,
    global_before_summary: summarizeStrictSweep(globalBefore),
    global_projected_summary: summarizeStrictSweep(globalProjected),
    writes,
  };
}

function validateApplyGates(argsInput, envInput, plan, deps) {
  const args = argsInput || {};
  const env = envInput || {};
  const io = deps || {};
  const reasons = [];
  const required = [
    ['scope-manifest', 'scope_manifest_required_for_apply'],
    ['expected-writes', 'expected_writes_required_for_apply'],
    ['expected-scope-digest', 'expected_scope_digest_required_for_apply'],
    ['expected-plan-digest', 'expected_plan_digest_required_for_apply'],
    ['expected-global-failures', 'expected_global_failures_required_for_apply'],
    ['expected-global-digest', 'expected_global_digest_required_for_apply'],
    ['expected-runner-sha256', 'expected_runner_sha256_required_for_apply'],
    ['rollback-artifact', 'rollback_artifact_required_for_apply'],
  ];
  if (args.apply !== true) addReason(reasons, 'literal_apply_flag_required');
  for (const pair of required) {
    if (args[pair[0]] === undefined || args[pair[0]] === '') addReason(reasons, pair[1]);
  }
  if (truthyEnv(env.APPLY)) addReason(reasons, 'ambient_apply_forbidden');
  if (truthyEnv(env.PROMOTE_ARCHIVE)
      || Object.keys(args).some(function forbidden(key) {
        return /(^|[-_])(promote|archive|create)([-_]|$)/i.test(key);
      })) {
    addReason(reasons, 'archive_or_create_semantics_forbidden');
  }
  for (const key of Object.keys(args)) {
    if (key === 'apply') continue;
    if (!ALLOWED_ARGUMENTS.has(key)) addReason(reasons, 'unknown_apply_argument');
  }
  if (!plan || plan.status !== 'READY') addReason(reasons, 'exact_scope_not_ready');
  if (Number(args['expected-writes']) !== Number(plan && plan.writes && plan.writes.length)) {
    addReason(reasons, 'expected_writes_mismatch');
  }
  if (clean(args['expected-scope-digest']) !== clean(plan && plan.scope_digest)) {
    addReason(reasons, 'expected_scope_digest_mismatch');
  }
  if (clean(args['expected-plan-digest']) !== clean(plan && plan.plan_digest)) {
    addReason(reasons, 'expected_plan_digest_mismatch');
  }
  if (Number(args['expected-global-failures']) !== Number(plan && plan.global_failure_count)) {
    addReason(reasons, 'expected_global_failures_mismatch');
  }
  if (clean(args['expected-global-digest']) !== clean(plan && plan.global_failure_digest)) {
    addReason(reasons, 'expected_global_digest_mismatch');
  }
  if (clean(args['expected-runner-sha256']) !== clean(plan && plan.runner_sha256)) {
    addReason(reasons, 'expected_runner_sha256_mismatch');
  }
  if (clean(env[OWNER_CONFIRM_ENV]) !== OWNER_CONFIRM_TOKEN) {
    addReason(reasons, 'owner_confirmation_required');
  }
  for (const key of ['scope-manifest', 'rollback-artifact']) {
    if (!args[key]) continue;
    try {
      (io.assertPrivatePath || assertPrivatePath)(String(args[key]));
    } catch (_error) {
      addReason(reasons, key === 'scope-manifest'
        ? 'scope_manifest_must_be_private'
        : 'rollback_artifact_must_be_private');
    }
  }
  if (args['scope-manifest'] && args['rollback-artifact']
      && path.resolve(String(args['scope-manifest'])) === path.resolve(String(args['rollback-artifact']))) {
    addReason(reasons, 'rollback_artifact_path_collision');
  }
  const existsSync = io.existsSync || fs.existsSync;
  if (args['rollback-artifact'] && existsSync(String(args['rollback-artifact']))) {
    addReason(reasons, 'rollback_artifact_already_exists');
  }
  if (args.snapshot) addReason(reasons, 'snapshot_apply_forbidden');
  reasons.sort();
  return { eligible: reasons.length === 0, reasons };
}

function buildPublicSummary(planInput, options) {
  const plan = planInput || {};
  const opts = options || {};
  const publicFailure = publicDatabaseFailure(
    plan.rpc_failure_code,
    plan.rpc_failure_class,
  );
  const reasonCounts = {};
  for (const reason of plan.reasons || []) {
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  }
  return {
    contract: PLAN_CONTRACT,
    mode: opts.mode === 'apply' ? 'apply' : 'dry-run',
    status: clean(opts.status || plan.status || 'BLOCKED'),
    global_gate: clean(plan.global_gate || 'BLOCKED'),
    exact_scope_gate: clean(plan.exact_scope_gate || plan.status || 'BLOCKED'),
    scope_policy: clean(plan.scope_policy || SCOPE_POLICY),
    release_sha: clean(plan.release_sha),
    runner_sha256: clean(plan.runner_sha256),
    counts: {
      manifest_entries: Number(plan.counts && plan.counts.manifest_entries || 0),
      cohort_population: Number(plan.counts && plan.counts.cohort_population || 0),
      cohort_missing_from_manifest: Number(
        plan.counts && plan.counts.cohort_missing_from_manifest || 0,
      ),
      cohort_extra_in_manifest: Number(
        plan.counts && plan.counts.cohort_extra_in_manifest || 0,
      ),
      cohort_duplicate_entries: Number(
        plan.counts && plan.counts.cohort_duplicate_entries || 0,
      ),
      cohort_b3_eligible: Number(plan.counts && plan.counts.cohort_b3_eligible || 0),
      cohort_b3_skipped: Number(plan.counts && plan.counts.cohort_b3_skipped || 0),
      cohort_full_crosswalk_eligible: Number(
        plan.counts && plan.counts.cohort_full_crosswalk_eligible || 0,
      ),
      planned_writes: Number(plan.counts && plan.counts.planned_writes || 0),
      expected_writes: Number(plan.counts && plan.counts.expected_writes || 0),
      global_failures: Number(plan.global_failure_count || 0),
      global_checked_slots: Number(plan.global_before_summary && plan.global_before_summary.checked_slots || 0),
      global_resolved_by_id_before: Number(plan.global_before_summary && plan.global_before_summary.resolved_by_id || 0),
      global_resolved_by_id_projected: Number(plan.global_projected_summary && plan.global_projected_summary.resolved_by_id || 0),
      global_resolved_by_exact_url_before: Number(plan.global_before_summary && plan.global_before_summary.resolved_by_exact_url || 0),
      global_resolved_by_exact_url_projected: Number(plan.global_projected_summary && plan.global_projected_summary.resolved_by_exact_url || 0),
    },
    scope_digest: clean(plan.scope_digest),
    cohort_population_digest: clean(plan.cohort_population_digest),
    plan_digest: clean(plan.plan_digest),
    global_failure_count: Number(plan.global_failure_count || 0),
    global_failure_digest: clean(plan.global_failure_digest),
    global_projected_failure_digest: clean(plan.global_projected_failure_digest),
    rpc_failure_code: publicFailure.code,
    rpc_failure_class: publicFailure.failure_class,
    reasons_by_code: reasonCounts,
  };
}

function publicDatabaseFailure(codeInput, classInput) {
  const code = clean(codeInput);
  const failureClass = clean(classInput);
  if (PUBLIC_DATABASE_FAILURES[code] !== failureClass) {
    return { code: '', failure_class: '' };
  }
  return { code, failure_class: failureClass };
}

function databaseFailureFromBody(bodyInput, allowedCodes) {
  const body = bodyInput && typeof bodyInput === 'object' ? bodyInput : {};
  const failure = publicDatabaseFailure(body.code, body.message);
  if (allowedCodes instanceof Set && !allowedCodes.has(failure.code)) {
    return { code: '', failure_class: '' };
  }
  return failure;
}

function rpcGlobalState(sweep) {
  return {
    checked: Number(sweep && sweep.checked || 0),
    resolved: Number(sweep && sweep.resolved || 0),
    resolved_by_id: Number(sweep && sweep.resolved_by_id || 0),
    resolved_by_exact_url: Number(sweep && sweep.resolved_by_exact_url || 0),
    failure_count: Number(sweep && sweep.failures && sweep.failures.length || 0),
    failure_digest: globalFailureDigest(sweep),
  };
}

function rpcPlan(plan) {
  return {
    contract: PLAN_CONTRACT,
    scope_policy: SCOPE_POLICY,
    global_gate: plan.global_gate,
    exact_scope_gate: plan.exact_scope_gate,
    expected_count: plan.expected_count,
    scope_digest: plan.scope_digest,
    plan_digest: plan.plan_digest,
    global_failure_count: plan.global_failure_count,
    global_failure_digest: plan.global_failure_digest,
    prod_authority: stable(plan.prod_authority),
    prod_authority_digest: clean(plan.prod_authority_digest),
    scope_clients: Array.isArray(plan.scope_clients) ? plan.scope_clients.slice() : [],
    cohort_population_count: Number(plan.cohort_population_count || 0),
    cohort_population_digest: clean(plan.cohort_population_digest),
    global_before: rpcGlobalState(plan.global_before),
    global_projected: rpcGlobalState(plan.global_projected),
    entries: plan.writes,
  };
}

function rollbackDigest(plan) {
  const tokens = (plan.writes || []).map(function rollbackToken(write) {
    return [
      clean(write.card && write.card.client),
      clean(write.card && write.card.id),
      clean(write.card && write.card.graphic_deliverable_id
        && write.card.graphic_deliverable_id.state),
      write.card && write.card.graphic_deliverable_id
        && write.card.graphic_deliverable_id.value === null
        ? '<NULL>'
        : clean(write.card && write.card.graphic_deliverable_id
          && write.card.graphic_deliverable_id.value),
      clean(write.deliverable && write.deliverable.id),
    ].map(function hex(value) {
      return Buffer.from(value, 'utf8').toString('hex');
    }).join(':');
  }).sort();
  return sha256Text([
    ROLLBACK_CONTRACT,
    clean(plan.plan_digest),
    tokens.join('\n'),
  ].join('\n'));
}

function rollbackArtifact(plan) {
  const exactRpcPlan = rpcPlan(plan);
  const digest = rollbackDigest(plan);
  return {
    contract: ROLLBACK_CONTRACT,
    created_at: new Date().toISOString(),
    scope_policy: SCOPE_POLICY,
    expected_count: plan.expected_count,
    scope_digest: plan.scope_digest,
    plan_digest: plan.plan_digest,
    global_failure_count: plan.global_failure_count,
    global_failure_digest: plan.global_failure_digest,
    rollback_digest: digest,
    instruction: 'Invoke the separately reviewed b3_scoped_card_linkage_rollback RPC only after fresh readback and owner approval.',
    rollback_rpc: {
      function: 'b3_scoped_card_linkage_rollback',
      p_plan: exactRpcPlan,
      p_expected_count: plan.expected_count,
      p_expected_scope_digest: plan.scope_digest,
      p_expected_plan_digest: plan.plan_digest,
      p_expected_global_failures: plan.global_failure_count,
      p_expected_global_digest: plan.global_failure_digest,
      p_expected_rollback_digest: digest,
    },
    entries: plan.writes.map(function rollbackEntry(write) {
      return {
        surface: write.surface,
        component: write.component,
        table: write.table,
        deliverable_column: write.deliverable_column,
        operation: 'restore_exact_graphic_deliverable_pointer',
        card: {
          client: write.card.client,
          id: write.card.id,
          graphic_linear_issue_id: write.card.graphic_linear_issue_id,
          updated_at: write.card.updated_at,
          before: write.card.graphic_deliverable_id,
          applied: write.deliverable.id,
        },
        deliverable: write.deliverable,
      };
    }),
  };
}

function postgrestLiteral(value) {
  const quoted = '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  return encodeURIComponent(quoted);
}

function keysetAfterFilter(columns, row) {
  if (columns.length === 1) {
    return columns[0] + '=gt.' + postgrestLiteral(row[columns[0]]);
  }
  if (columns.length === 2) {
    const first = columns[0];
    const second = columns[1];
    return 'or=('
      + first + '.gt.' + postgrestLiteral(row[first])
      + ',and('
      + first + '.eq.' + postgrestLiteral(row[first])
      + ',' + second + '.gt.' + postgrestLiteral(row[second])
      + '))';
  }
  throw new Error('unsupported_keyset_shape');
}

async function restRows(baseUrl, key, table, select, query, keyColumns, fetchImpl) {
  const rows = [];
  const columns = Array.isArray(keyColumns) ? keyColumns : [];
  if (!columns.length || columns.length > 2) throw new Error('snapshot_keyset_required');
  const limit = 1000;
  let after = '';
  let previousToken = '';
  for (;;) {
    let url = baseUrl + '/rest/v1/' + table + '?select=' + encodeURIComponent(select)
      + '&limit=' + limit
      + '&order=' + columns.map(function ordered(column) {
        return column + '.asc';
      }).join(',');
    if (query) url += '&' + query;
    if (after) url += '&' + after;
    const response = await fetchImpl(url, {
      headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('snapshot_read_' + table + '_' + response.status);
    const batch = await response.json().catch(function invalid() { return null; });
    if (!Array.isArray(batch)) throw new Error('snapshot_read_' + table + '_invalid');
    rows.push.apply(rows, batch);
    if (batch.length < limit) break;
    const last = batch[batch.length - 1];
    if (columns.some(function missing(column) {
      return last[column] === null || last[column] === undefined;
    })) {
      throw new Error('snapshot_read_' + table + '_key_missing');
    }
    const token = columns.map(function value(column) { return String(last[column]); }).join('\u0000');
    if (token === previousToken) throw new Error('snapshot_read_' + table + '_keyset_stalled');
    previousToken = token;
    after = keysetAfterFilter(columns, last);
  }
  return rows;
}

function releaseSha(env) {
  const candidate = clean(env && (env.GITHUB_SHA || env.RELEASE_SHA));
  if (/^[0-9a-f]{40}$/i.test(candidate)) return candidate;
  try {
    return clean(execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }));
  } catch (_error) {
    return '';
  }
}

function serviceRoleProjectRef(token) {
  const parts = clean(token).split('.');
  if (parts.length !== 3) return '';
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (clean(payload && payload.role) !== 'service_role') return '';
    return clean(payload && payload.ref);
  } catch (_error) {
    return '';
  }
}

function runnerSha256() {
  return crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
}

function productionDeps(config, fetchImpl) {
  const baseUrl = clean(config && config.url || DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
  const key = clean(config && config.serviceKey);
  if (!baseUrl || !key) throw new Error('supabase_configuration_required');
  const fetcher = fetchImpl || globalThis.fetch;
  if (typeof fetcher !== 'function') throw new Error('fetch_required');
  return {
    async loadLiveData(metadata) {
      const results = await Promise.all([
        restRows(baseUrl, key, 'deliverables',
          'id,client_slug,team,kind,origin,card_id,status,updated_at,linear_issue_uuid,linear_identifier,linear_issue_url,linear_aliases,linear_raw',
          '', ['id'], fetcher),
        restRows(baseUrl, key, 'calendar_posts',
          'id,client,status,graphic_status,updated_at,posted_at,linear_issue_id,graphic_linear_issue_id,video_deliverable_id,graphic_deliverable_id,graphic_tweaks',
          '', ['client', 'id'], fetcher),
        restRows(baseUrl, key, 'sample_reviews',
          'id,client,status,linear_issue_id,graphic_linear_issue_id,video_deliverable_id,graphic_deliverable_id',
          '', ['client', 'id'], fetcher),
        restRows(baseUrl, key, 'linear_archive', 'linear_uuid,identifier',
          '', ['linear_uuid'], fetcher),
        restRows(baseUrl, key, 'clients', 'slug,active,kind', '', ['slug'], fetcher),
        restRows(baseUrl, key, 'production_comments',
          'id,deliverable_id,team,component,linear_issue_uuid,linear_identifier,deleted_at,version,source_updated_at,updated_at',
          '', ['id'], fetcher),
        restRows(baseUrl, key, 'syncview_runtime_flags', 'key,value',
          'key=eq.prod_authority', ['key'], fetcher),
      ]);
      const authorityRows = results[6];
      if (authorityRows.length !== 1) throw new Error('prod_authority_cardinality');
      const authority = typeof authorityRows[0].value === 'string'
        ? JSON.parse(authorityRows[0].value)
        : authorityRows[0].value;
      const snapshot = {
        contract: SNAPSHOT_CONTRACT,
        generated_at: new Date().toISOString(),
        project_ref: clean(metadata && metadata.projectRef),
        release_sha: clean(metadata && metadata.releaseSha),
        runner_sha256: clean(metadata && metadata.runnerSha256),
        deliverables: results[0],
        calendarPosts: results[1],
        sampleReviews: results[2],
        linearArchive: results[3],
        clients: results[4],
        productionComments: results[5],
        prodAuthority: authority,
      };
      return snapshot;
    },
    async applyRpc(plan) {
      const response = await fetcher(baseUrl + '/rest/v1/rpc/' + APPLY_RPC, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          p_plan: rpcPlan(plan),
          p_expected_count: plan.expected_count,
          p_expected_scope_digest: plan.scope_digest,
          p_expected_plan_digest: plan.plan_digest,
          p_expected_global_failures: plan.global_failure_count,
          p_expected_global_digest: plan.global_failure_digest,
        }),
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(function invalidError() { return null; });
        const failure = databaseFailureFromBody(errorBody, APPLY_DATABASE_FAILURE_CODES);
        return {
          acknowledged: false,
          code: failure.code || 'rpc_http_' + response.status,
          failure_class: failure.failure_class,
        };
      }
      const body = await response.json().catch(function invalid() { return null; });
      if (!body
          || Number(body.applied_count) !== plan.expected_count
          || Number(body.receipt_count) !== 1
          || clean(body.scope_digest) !== plan.scope_digest
          || clean(body.plan_digest) !== plan.plan_digest
          || Number(body.global_failure_count) !== plan.global_failure_count
          || clean(body.global_failure_digest) !== plan.global_failure_digest
          || !/^[0-9a-f]{64}$/.test(clean(body.calendar_event_digest))) {
        return { acknowledged: false, code: 'rpc_response_unconfirmed' };
      }
      return {
        acknowledged: true,
        applied_count: Number(body.applied_count),
        scope_digest: clean(body.scope_digest),
        plan_digest: clean(body.plan_digest),
      };
    },
    async loadApplyReceipt(plan) {
      const eventKey = 'b3-scoped-card-linkage:' + clean(plan && plan.plan_digest);
      const url = baseUrl + '/rest/v1/deliverable_events'
        + '?select=' + encodeURIComponent(
          'id,deliverable_id,batch_id,client_slug,actor,role,action,source,payload,event_key',
        )
        + '&event_key=eq.' + encodeURIComponent(eventKey)
        + '&limit=2';
      const response = await fetcher(url, {
        headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('receipt_readback_' + response.status);
      const body = await response.json().catch(function invalid() { return null; });
      if (!Array.isArray(body)) throw new Error('receipt_readback_invalid');
      return body;
    },
    async preflightRpc() {
      const response = await fetcher(baseUrl + '/rest/v1/rpc/' + PREFLIGHT_RPC, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: '{}',
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(function invalidError() { return null; });
        const failure = databaseFailureFromBody(errorBody, PREFLIGHT_DATABASE_FAILURE_CODES);
        const error = new Error(failure.code
          ? 'database_preflight_refused'
          : 'database_preflight_' + response.status);
        error.public_database_failure_code = failure.code;
        error.public_database_failure_class = failure.failure_class;
        throw error;
      }
      const body = await response.json().catch(function invalid() { return null; });
      if (!body || typeof body !== 'object') throw new Error('database_preflight_invalid');
      return body;
    },
  };
}

function verifyReadback(plan, snapshot) {
  const problems = [];
  const authority = snapshot.prodAuthority || snapshot.prod_authority || {};
  if (lower(authority.graphics) !== 'linear') addReason(problems, 'readback_authority_drift');
  if (!exactEqual(authority, plan.prod_authority)) addReason(problems, 'readback_authority_drift');
  for (const write of plan.writes || []) {
    const cards = (snapshot.calendarPosts || []).filter(function cardMatch(card) {
      return clean(card.client || card.client_slug) === write.card.client
        && clean(card.id) === write.card.id;
    });
    if (cards.length !== 1) {
      addReason(problems, 'readback_card_cardinality');
      continue;
    }
    const card = cards[0];
    if (clean(card.graphic_deliverable_id) !== write.deliverable.id) {
      addReason(problems, 'readback_pointer_mismatch');
    }
    if (clean(card.graphic_linear_issue_id) !== write.card.graphic_linear_issue_id) {
      addReason(problems, 'readback_linear_url_drift');
    }
    for (const field of ['status', 'graphic_status', 'updated_at', 'posted_at', 'graphic_tweaks']) {
      if (!exactEqual(card[field], write.card[field])) {
        addReason(problems, 'readback_card_state_drift');
      }
    }
    const deliverables = (snapshot.deliverables || []).filter(function deliverableMatch(row) {
      return clean(row.id) === write.deliverable.id;
    });
    if (deliverables.length !== 1) {
      addReason(problems, 'readback_deliverable_cardinality');
      continue;
    }
    const deliverable = deliverables[0];
    for (const field of DELIVERABLE_BEFORE_FIELDS) {
      if (!exactEqual(deliverable[field], write.deliverable[field])) {
        addReason(problems, 'readback_deliverable_state_drift');
      }
    }
    if (lower(deliverable.origin) !== 'calendar'
        || lower(deliverable.team) !== 'graphics'
        || lower(deliverable.kind) !== 'thumbnail'
        || clean(deliverable.client_slug) !== write.card.client
        || clean(deliverable.card_id) !== write.card.id) {
      addReason(problems, 'readback_crosswalk_mismatch');
    }
    const readbackIdentity = canonicalizeLinearIssue(deliverable.linear_issue_url);
    const readbackIdentifier = extractIdentifier(deliverable.linear_identifier)
      || readbackIdentity.identifier;
    if (readbackIdentity.canonical_url !== write.deliverable.linear_issue_canonical
        || readbackIdentifier !== extractIdentifier(write.card.graphic_linear_issue_id)) {
      addReason(problems, 'readback_deliverable_identity_drift');
    }
    const consumers = allConsumers(snapshot, write.deliverable.id);
    if (consumers.length !== 1
        || consumers[0].surface !== 'calendar'
        || consumers[0].component !== 'graphic'
        || consumers[0].client_slug !== write.card.client
        || consumers[0].card_id !== write.card.id) {
      addReason(problems, 'readback_consumer_mismatch');
    }
    if (legacyCommentState(card).count !== 0
        || nativeCommentState(snapshot, deliverable).count !== 0) {
      addReason(problems, 'readback_comment_visibility_drift');
    }
  }
  const sweep = strictActiveCalendarSweep(snapshot);
  if (sweep.failures.length !== plan.global_failure_count
      || globalFailureDigest(sweep) !== plan.global_failure_digest) {
    addReason(problems, 'readback_global_failure_drift');
  }
  if (sweep.resolved_by_exact_url !== plan.global_projected.resolved_by_exact_url
      || sweep.resolved_by_id !== plan.global_projected.resolved_by_id) {
    addReason(problems, 'readback_resolution_shift_mismatch');
  }
  return { ok: problems.length === 0, reasons: problems.sort() };
}

function verifyApplyReceipt(plan, rowsInput) {
  const rows = Array.isArray(rowsInput) ? rowsInput : [];
  const problems = [];
  if (rows.length !== 1) return { ok: false, reasons: ['apply_receipt_cardinality'] };
  const row = rows[0] || {};
  const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
    ? row.payload
    : {};
  if (row.deliverable_id !== null
      || row.batch_id !== null
      || clean(row.client_slug) !== '_system'
      || clean(row.actor) !== 'b3-scoped-runner'
      || clean(row.role) !== 'service_role'
      || clean(row.action) !== 'b3_scoped_card_linkage_apply'
      || clean(row.source) !== 'reconcile'
      || clean(row.event_key) !== 'b3-scoped-card-linkage:' + clean(plan && plan.plan_digest)
      || clean(payload.contract) !== PLAN_CONTRACT
      || Number(payload.applied_count) !== Number(plan && plan.expected_count)
      || clean(payload.scope_digest) !== clean(plan && plan.scope_digest)
      || clean(payload.plan_digest) !== clean(plan && plan.plan_digest)
      || Number(payload.global_failure_count) !== Number(plan && plan.global_failure_count)
      || clean(payload.global_failure_digest) !== clean(plan && plan.global_failure_digest)
      || !/^[0-9a-f]{64}$/.test(clean(payload.calendar_event_digest))
      || payload.identity_fields !== false
      || clean(payload.mutation) !== 'calendar_graphic_pointer_only') {
    addReason(problems, 'apply_receipt_mismatch');
  }
  return { ok: problems.length === 0, reasons: problems.sort() };
}

async function executeApplyOnceAndReadback(plan, liveDepsInput, metadata, verifierInput) {
  const liveDeps = liveDepsInput || {};
  const verifier = typeof verifierInput === 'function' ? verifierInput : verifyReadback;
  if (typeof liveDeps.applyRpc !== 'function'
      || typeof liveDeps.loadLiveData !== 'function'
      || typeof liveDeps.loadApplyReceipt !== 'function') {
    throw new Error('production_rpc_and_readback_required');
  }

  let rpcResult;
  try {
    rpcResult = await liveDeps.applyRpc(plan);
  } catch (_error) {
    // A lost response is never permission to retry. Exactly one RPC attempt is
    // followed by an independent readback, whose result alone confirms state.
    rpcResult = { acknowledged: false, code: 'rpc_outcome_unknown' };
  }
  if (!rpcResult || typeof rpcResult !== 'object') {
    rpcResult = { acknowledged: false, code: 'rpc_response_unconfirmed' };
  }

  let stateReadback;
  try {
    const readbackSnapshot = await liveDeps.loadLiveData(metadata || {});
    stateReadback = verifier(plan, readbackSnapshot);
    if (!stateReadback || typeof stateReadback.ok !== 'boolean'
        || !Array.isArray(stateReadback.reasons)) {
      throw new Error('state_readback_invalid');
    }
  } catch (_error) {
    stateReadback = { ok: false, reasons: ['readback_unavailable'] };
  }

  let receiptReadback;
  try {
    receiptReadback = verifyApplyReceipt(plan, await liveDeps.loadApplyReceipt(plan));
  } catch (_error) {
    receiptReadback = { ok: false, reasons: ['receipt_readback_unavailable'] };
  }
  const readbackReasons = [...stateReadback.reasons, ...receiptReadback.reasons]
    .filter(function unique(reason, index, all) { return all.indexOf(reason) === index; })
    .sort();
  const readback = {
    ok: stateReadback.ok && receiptReadback.ok,
    reasons: readbackReasons,
  };

  return {
    rpc_result: rpcResult,
    readback,
    status: readback.ok
      ? (rpcResult.acknowledged ? 'APPLIED' : 'APPLIED_CONFIRMED_BY_READBACK')
      : (rpcResult.acknowledged ? 'GAPS' : 'OUTCOME_UNKNOWN'),
  };
}

async function run(argv, envInput, depsInput) {
  const env = envInput || process.env;
  const deps = depsInput || {};
  const args = parseArgs(argv || process.argv.slice(2), env);
  assertArgumentPolicy(args);
  if (truthyEnv(env.APPLY)) throw new Error('ambient_apply_forbidden');
  if (truthyEnv(env.PROMOTE_ARCHIVE)) throw new Error('archive_or_create_semantics_forbidden');
  if (!args['scope-manifest']) throw new Error('scope_manifest_required');
  const manifest = readPrivateJson(String(args['scope-manifest']), deps);
  const actualRunnerSha = clean(deps.runnerSha256 || runnerSha256());
  const actualReleaseSha = clean(args['release-sha'] || deps.releaseSha || releaseSha(env));
  const configuredSupabaseUrl = clean(env.SUPABASE_URL || DEFAULT_SUPABASE_URL);
  const urlProjectMatch = configuredSupabaseUrl.match(/^https:\/\/([^.]+)\.supabase\.co(?:\/|$)/i);
  const projectRef = clean(urlProjectMatch && urlProjectMatch[1]);
  if (!args.snapshot) {
    const explicitProjectRef = clean(env.SUPABASE_PROJECT_REF);
    const keyProjectRef = serviceRoleProjectRef(env.SUPABASE_SERVICE_ROLE_KEY);
    if (!projectRef
        || (explicitProjectRef && explicitProjectRef !== projectRef)
        || !keyProjectRef
        || keyProjectRef !== projectRef) {
      throw new Error('supabase_project_binding_mismatch');
    }
  }

  let snapshot;
  let liveDeps = deps;
  if (args.snapshot) {
    snapshot = readPrivateJson(String(args.snapshot), deps);
  } else {
    if (typeof liveDeps.loadLiveData !== 'function') {
      liveDeps = Object.assign({}, liveDeps, productionDeps({
        url: configuredSupabaseUrl,
        serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
      }, deps.fetch || globalThis.fetch));
    }
    snapshot = await liveDeps.loadLiveData({
      projectRef,
      releaseSha: actualReleaseSha,
      runnerSha256: actualRunnerSha,
    });
  }

  let plan = buildScopedPlan(snapshot, manifest, {
    expectedCount: manifest.expected_count,
    runnerSha256: actualRunnerSha,
    nowMs: Date.now(),
  });
  if (!args.snapshot) {
    let preflightReason = '';
    let preflightFailure = { code: '', failure_class: '' };
    try {
      if (typeof liveDeps.preflightRpc !== 'function') throw new Error('database_preflight_unavailable');
      const databaseState = await liveDeps.preflightRpc();
      if (!exactEqual(databaseState, rpcGlobalState(plan.global_before))) {
        preflightReason = 'database_preflight_mismatch';
      }
    } catch (error) {
      preflightFailure = publicDatabaseFailure(
        error && error.public_database_failure_code,
        error && error.public_database_failure_class,
      );
      preflightReason = preflightFailure.code
        ? 'database_preflight_refused'
        : 'database_preflight_unavailable';
    }
    if (preflightReason) {
      const reasons = (plan.reasons || []).slice();
      addReason(reasons, preflightReason);
      reasons.sort();
      plan = Object.assign({}, plan, {
        status: 'BLOCKED',
        exact_scope_gate: 'BLOCKED',
        reasons,
        rpc_failure_code: preflightFailure.code,
        rpc_failure_class: preflightFailure.failure_class,
      });
    }
  }
  if (args['private-plan']) {
    writePrivateJsonExclusive(String(args['private-plan']), plan, deps);
  }
  if (!args.apply) return buildPublicSummary(plan, { mode: 'dry-run' });

  const gates = validateApplyGates(args, env, plan, deps);
  if (!gates.eligible) {
    const blocked = Object.assign({}, plan, { status: 'BLOCKED', exact_scope_gate: 'BLOCKED', reasons: gates.reasons });
    return buildPublicSummary(blocked, { mode: 'apply', status: 'BLOCKED' });
  }

  writePrivateJsonExclusive(String(args['rollback-artifact']), rollbackArtifact(plan), deps);
  const outcome = await executeApplyOnceAndReadback(plan, liveDeps, {
      projectRef,
      releaseSha: actualReleaseSha,
      runnerSha256: actualRunnerSha,
  });
  const publicFailure = publicDatabaseFailure(
    outcome.rpc_result && outcome.rpc_result.code,
    outcome.rpc_result && outcome.rpc_result.failure_class,
  );
  const resultPlan = Object.assign({}, plan, {
    status: outcome.status,
    exact_scope_gate: outcome.readback.ok ? 'APPLIED' : outcome.status,
    reasons: outcome.readback.reasons,
    rpc_failure_code: publicFailure.code,
    rpc_failure_class: publicFailure.failure_class,
  });
  return buildPublicSummary(resultPlan, { mode: 'apply', status: outcome.status });
}

if (require.main === module) {
  run(process.argv.slice(2), process.env).then(function print(result) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (result.status === 'BLOCKED'
        || result.status === 'GAPS'
        || result.status === 'OUTCOME_UNKNOWN') process.exitCode = 1;
  }).catch(function report(error) {
    const rawCode = clean(error && error.message);
    const safeCode = /^[a-z][a-z0-9_:-]{0,95}$/i.test(rawCode)
      ? rawCode
      : 'scoped_linkage_runner_failed';
    process.stderr.write(JSON.stringify({
      status: 'FAIL',
      code: safeCode,
    }) + '\n');
    process.exitCode = 1;
  });
}

module.exports = {
  APPLY_RPC,
  EMPTY_COMMENT_DIGEST,
  MANIFEST_CONTRACT,
  MAX_MANIFEST_AGE_MS,
  OWNER_CONFIRM_ENV,
  OWNER_CONFIRM_TOKEN,
  PREFLIGHT_RPC,
  PUBLIC_DATABASE_FAILURES,
  PLAN_CONTRACT,
  ROLLBACK_CONTRACT,
  SCOPE_POLICY,
  SNAPSHOT_CONTRACT,
  assertArgumentPolicy,
  assertPrivatePath,
  buildPublicSummary,
  buildScopedPlan,
  canonicalizeLinearIssue,
  cohortPopulationDigest,
  cohortPopulationRows,
  databaseFailureFromBody,
  executeApplyOnceAndReadback,
  globalFailureDigest,
  legacyCommentState,
  nativeCommentState,
  parseArgs,
  pointerState,
  productionDeps,
  publicDatabaseFailure,
  rpcPlan,
  rollbackArtifact,
  rollbackDigest,
  run,
  serviceRoleProjectRef,
  sha256Text,
  snapshotContentDigest,
  stableDigest,
  validateApplyGates,
  verifyApplyReceipt,
  verifyReadback,
  writePrivateJsonExclusive,
};
