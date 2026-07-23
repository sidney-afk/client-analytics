'use strict';

/*
 * F200 roster-owned Linear issue attribution.
 *
 * The active SyncView roster and its persisted linear_project_ids values are
 * the only project-to-client authority. Linear names and titles are never
 * interpreted as client identity. Unknown, provisional, and conflicting
 * families stay explicit repair states.
 */

const crypto = require('crypto');

const ATTRIBUTION_SCHEMA = 'syncview_attribution_v1';
const OWNER_MANIFEST_SCHEMA = 'syncview_f200_owner_classifications_v1';
const ALLOWED_KINDS = new Set(['client', 'internal', 'test']);
const TEAM_KEYS = new Set(['video', 'vid', 'graphics', 'graphic', 'gra', 'thumbnail']);
const ID_KEYS = Object.freeze(['id', 'project_id', 'linear_project_id']);
const EXPLICIT_ROSTER_MODES = new Set(['explicit_roster', 'explicit_roster_classification']);
const EXPLICIT_INTERNAL_TEST_MODES = new Set([
  'explicit_internal_test',
  'explicit_internal_test_classification',
]);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(canonical(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex');
}

function active(value) {
  return value === true || clean(value).toLowerCase() === 'true';
}

function recognizedIds(value) {
  if (typeof value === 'string') return clean(value) ? [clean(value)] : [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return [...new Set(ID_KEYS.map(key => clean(value[key])).filter(Boolean))];
}

/*
 * Read only documented project-id shapes. Arbitrary nested metadata is
 * deliberately ignored so a note that resembles an ID cannot become
 * attribution authority.
 */
function configuredProjectIds(value) {
  if (typeof value === 'string') {
    const text = clean(value);
    if (!text) return [];
    try {
      return configuredProjectIds(JSON.parse(text));
    } catch (_error) {
      return [text];
    }
  }
  if (!value || typeof value !== 'object') return [];

  const found = new Set();
  const add = entry => recognizedIds(entry).forEach(id => found.add(id));
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string') {
        if (clean(entry)) found.add(clean(entry));
      } else {
        add(entry);
      }
    }
  } else {
    add(value);
    for (const [key, entry] of Object.entries(value)) {
      if (!TEAM_KEYS.has(clean(key).toLowerCase())) continue;
      if (typeof entry === 'string') {
        if (clean(entry)) found.add(clean(entry));
      } else {
        add(entry);
      }
    }
    if (Array.isArray(value.projects)) {
      for (const entry of value.projects) add(entry);
    }
  }
  return [...found].sort();
}

function buildProjectIndex(clients) {
  const clientBySlug = new Map();
  const projectOwners = new Map();
  const entries = [];

  for (const row of clients || []) {
    const slug = clean(row && row.slug);
    const kind = clean(row && row.kind || 'client').toLowerCase();
    if (!slug || !active(row && row.active) || !ALLOWED_KINDS.has(kind)) continue;
    if (clientBySlug.has(slug)) throw new Error(`duplicate active roster slug: ${slug}`);
    const client = { slug, kind };
    clientBySlug.set(slug, client);

    for (const projectId of configuredProjectIds(row.linear_project_ids)) {
      const prior = projectOwners.get(projectId);
      if (prior && prior.slug !== slug) {
        throw new Error(`Linear project ${projectId} is mapped to multiple active roster owners`);
      }
      projectOwners.set(projectId, client);
    }
  }

  for (const [projectId, owner] of projectOwners) {
    entries.push({ project_id: projectId, client_slug: owner.slug, kind: owner.kind });
  }
  entries.sort((a, b) => a.project_id.localeCompare(b.project_id)
    || a.client_slug.localeCompare(b.client_slug));
  const roster = [...clientBySlug.values()]
    .map(owner => ({ client_slug: owner.slug, kind: owner.kind }))
    .sort((a, b) => a.client_slug.localeCompare(b.client_slug)
      || a.kind.localeCompare(b.kind));

  return {
    clientBySlug,
    projectOwners,
    entries,
    roster,
    mapping_revision: sha256({ schema: ATTRIBUTION_SCHEMA, roster, entries }),
  };
}

function issueId(issue) {
  return clean(issue && (issue.id || issue.uuid || issue.linear_issue_uuid));
}

function issueProjectId(issue) {
  return clean(issue && (
    issue.project_id
    || issue.projectId
    || issue.project && (issue.project.id || issue.project.project_id || issue.project.linear_project_id)
  ));
}

function parentId(issue) {
  return clean(issue && (
    issue.parent_id
    || issue.parentId
    || issue.parent && (issue.parent.id || issue.parent.uuid || issue.parent.linear_issue_uuid)
  ));
}

function normalizeExplicitClassifications(value, projectIndex) {
  const root = value && typeof value === 'object' ? value : {};
  const rawRules = root.issues && typeof root.issues === 'object' && !Array.isArray(root.issues)
    ? root.issues
    : root;
  const defaultDecisionRef = clean(root.decision_ref || root.approval_ref);
  const defaultManifestSha = clean(root.manifest_sha256);
  const defaultOwnerApproved = root.owner_approved === true;
  const rules = new Map();

  for (const [rawIssueId, rawRule] of Object.entries(rawRules || {})) {
    if (rawIssueId === 'schema' || rawIssueId === 'owner_approved'
        || rawIssueId === 'snapshot_sha256' || rawIssueId === 'expected_count') continue;
    const id = clean(rawIssueId);
    const rule = typeof rawRule === 'string' ? { client_slug: rawRule } : rawRule;
    const mode = clean(rule && (rule.classification || rule.resolution || rule.source)).toLowerCase();
    if (['mapped_project', 'direct_project', 'mapped_ancestor', 'nearest_mapped_ancestor'].includes(mode)) {
      continue;
    }
    if (!EXPLICIT_ROSTER_MODES.has(mode) && !EXPLICIT_INTERNAL_TEST_MODES.has(mode)) {
      throw new Error(`explicit classification mode is invalid for ${id || '(missing issue id)'}`);
    }
    const clientSlug = clean(rule && rule.client_slug);
    const owner = projectIndex.clientBySlug.get(clientSlug);
    if (!id || !clientSlug) throw new Error('explicit issue classifications require issue id and client_slug');
    if (!owner) throw new Error(`explicit classification for ${id} does not name an active roster owner`);
    if ((EXPLICIT_ROSTER_MODES.has(mode) && owner.kind !== 'client')
        || (EXPLICIT_INTERNAL_TEST_MODES.has(mode) && !['internal', 'test'].includes(owner.kind))) {
      throw new Error(`explicit classification mode does not match owner kind for ${id}`);
    }
    rules.set(id, {
      client_slug: clientSlug,
      kind: owner.kind,
      reason: clean(rule.reason || rule.classification_reason || 'owner_classified'),
      decision_ref: clean(rule.decision_ref || rule.approval_ref || defaultDecisionRef),
      manifest_sha256: clean(rule.manifest_sha256 || defaultManifestSha),
      owner_approved: rule.owner_approved === true || defaultOwnerApproved,
    });
  }
  return rules;
}

function persistedExplicitClassifications(deliverables, clients) {
  const projectIndex = buildProjectIndex(clients);
  const issues = {};
  const rejected = [];

  for (const row of deliverables || []) {
    const raw = parseJson(row && row.linear_raw);
    const attribution = parseJson(raw.attribution);
    const id = clean(row && row.linear_issue_uuid || raw.issue && issueId(raw.issue));
    const clientSlug = clean(attribution.client_slug);
    const owner = projectIndex.clientBySlug.get(clientSlug);
    const source = clean(attribution.source);
    const expectedSource = owner && owner.kind === 'client'
      ? 'explicit_roster_classification'
      : 'explicit_internal_test_classification';
    const decisionRef = clean(attribution.explicit_decision_ref);
    const manifestSha = clean(attribution.explicit_manifest_sha256).toLowerCase();
    const candidate = attribution.schema === ATTRIBUTION_SCHEMA
      && attribution.state === 'resolved'
      && ['explicit_roster_classification', 'explicit_internal_test_classification'].includes(source);
    if (!candidate) continue;

    const valid = !!id
      && !!owner
      && clean(row && row.client_slug) === clientSlug
      && clean(attribution.owner_kind) === owner.kind
      && source === expectedSource
      && attribution.explicit_owner_approved === true
      && !!decisionRef
      && /^[a-f0-9]{64}$/.test(manifestSha);
    if (!valid) {
      rejected.push({
        linear_issue_uuid: id || null,
        reason: 'persisted_explicit_owner_proof_invalid',
      });
      continue;
    }
    if (issues[id] && issues[id].client_slug !== clientSlug) {
      throw new Error(`persisted explicit classifications conflict for ${id}`);
    }
    issues[id] = {
      classification: source,
      client_slug: clientSlug,
      reason: clean(attribution.reason) || 'owner_classified',
      decision_ref: decisionRef,
      manifest_sha256: manifestSha,
      owner_approved: true,
    };
  }

  return {
    schema: OWNER_MANIFEST_SCHEMA,
    owner_approved: true,
    issues,
    rejected,
  };
}

function baseResult(mappingRevision, issue) {
  const directProjectId = issueProjectId(issue);
  return {
    schema: ATTRIBUTION_SCHEMA,
    state: 'needs_attribution',
    client_slug: null,
    owner_kind: null,
    source: 'none',
    project_id: null,
    direct_project_id: directProjectId || null,
    ancestor_issue_id: null,
    ancestor_distance: null,
    mapping_revision: mappingRevision,
    repair_required: true,
    reason: directProjectId ? 'direct_project_unmapped' : 'no_mapped_project_or_explicit_classification',
  };
}

function resolvedResult(base, owner, source, details = {}) {
  return Object.assign({}, base, {
    state: 'resolved',
    client_slug: owner.slug,
    owner_kind: owner.kind,
    source,
    project_id: details.project_id || null,
    ancestor_issue_id: details.ancestor_issue_id || null,
    ancestor_distance: details.ancestor_distance == null ? null : details.ancestor_distance,
    repair_required: !!details.repair_required,
    reason: details.reason || source,
  });
}

function conflictResult(base, reason, details = {}) {
  return Object.assign({}, base, details, {
    state: 'conflict',
    client_slug: null,
    owner_kind: null,
    source: 'conflict',
    repair_required: true,
    reason,
  });
}

function resolveAttributionGraph(issues, clients, options = {}) {
  const projectIndex = options.projectIndex || buildProjectIndex(clients);
  const explicit = normalizeExplicitClassifications(options.explicitClassifications || {}, projectIndex);
  const issueById = new Map();

  for (const issue of issues || []) {
    const id = issueId(issue);
    if (!id) throw new Error('every attribution issue requires a Linear issue id');
    if (issueById.has(id)) throw new Error(`duplicate Linear issue in attribution graph: ${id}`);
    issueById.set(id, issue);
  }
  for (const id of explicit.keys()) {
    if (!issueById.has(id)) throw new Error(`explicit classification is outside the issue scope: ${id}`);
  }

  const initial = new Map();
  for (const [id, issue] of issueById) {
    const base = baseResult(projectIndex.mapping_revision, issue);
    const directProjectId = issueProjectId(issue);
    const directOwner = directProjectId ? projectIndex.projectOwners.get(directProjectId) : null;
    let result = directOwner
      ? resolvedResult(base, directOwner, 'direct_project', {
        project_id: directProjectId,
        reason: 'direct_project_mapped',
      })
      : null;

    const seen = new Set([id]);
    let cursor = issue;
    let distance = 0;
    const unmappedProjectIds = directProjectId && !directOwner ? [directProjectId] : [];
    while (!result) {
      const embeddedParent = cursor && cursor.parent && typeof cursor.parent === 'object'
        ? cursor.parent
        : null;
      const nextId = parentId(cursor);
      if (!nextId && !embeddedParent) break;
      distance++;
      if (nextId && seen.has(nextId)) {
        result = conflictResult(base, 'hierarchy_cycle', { hierarchy_issue_ids: [...seen, nextId] });
        break;
      }
      if (nextId) seen.add(nextId);
      const ancestor = nextId && issueById.get(nextId) || embeddedParent;
      if (!ancestor) {
        result = Object.assign({}, base, {
          reason: 'ancestor_not_in_snapshot',
          missing_ancestor_issue_id: nextId || null,
        });
        break;
      }
      const ancestorProjectId = issueProjectId(ancestor);
      const owner = ancestorProjectId ? projectIndex.projectOwners.get(ancestorProjectId) : null;
      if (ancestorProjectId && !owner) unmappedProjectIds.push(ancestorProjectId);
      if (owner) {
        result = resolvedResult(base, owner, 'nearest_mapped_ancestor', {
          project_id: ancestorProjectId,
          ancestor_issue_id: issueId(ancestor) || nextId,
          ancestor_distance: distance,
          repair_required: unmappedProjectIds.length > 0,
          reason: unmappedProjectIds.length
            ? 'ancestor_mapped_direct_project_needs_mapping'
            : 'nearest_ancestor_project_mapped',
        });
        break;
      }
      cursor = ancestor;
    }

    const rule = explicit.get(id);
    if (result && result.state === 'resolved' && rule && result.client_slug !== rule.client_slug) {
      result = conflictResult(base, 'explicit_classification_disagrees_with_project_mapping', {
        mapped_client_slug: result.client_slug,
        explicit_client_slug: rule.client_slug,
      });
    } else if (result && result.state === 'resolved' && rule) {
      result.explicit_confirmation = true;
      result.explicit_decision_ref = rule.decision_ref || null;
      result.explicit_manifest_sha256 = rule.manifest_sha256 || null;
      result.explicit_owner_approved = rule.owner_approved === true;
    } else if ((!result || result.state === 'needs_attribution') && rule) {
      const owner = projectIndex.clientBySlug.get(rule.client_slug);
      const source = owner.kind === 'client'
        ? 'explicit_roster_classification'
        : 'explicit_internal_test_classification';
      result = resolvedResult(base, owner, source, {
        reason: rule.reason,
      });
      result.explicit_decision_ref = rule.decision_ref || null;
      result.explicit_manifest_sha256 = rule.manifest_sha256 || null;
      result.explicit_owner_approved = rule.owner_approved === true;
    }

    if (!result) result = base;
    if (unmappedProjectIds.length) result.unmapped_project_ids = [...new Set(unmappedProjectIds)].sort();
    initial.set(id, result);
  }

  const childrenByParent = new Map();
  for (const [id, issue] of issueById) {
    const parent = parentId(issue);
    if (!parent) continue;
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent).push(id);
  }
  for (const ids of childrenByParent.values()) ids.sort();

  const resolved = new Map([...initial].map(([id, value]) => [id, Object.assign({}, value)]));
  if (options.familyComplete === true) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const [parent, childIds] of childrenByParent) {
        const current = resolved.get(parent);
        if (!current || current.state !== 'needs_attribution') continue;
        const childResults = childIds.map(id => resolved.get(id)).filter(Boolean);
        if (childResults.length !== childIds.length) continue;
        if (childResults.some(item => item.state === 'conflict')) {
          resolved.set(parent, conflictResult(current, 'child_family_conflict', {
            child_issue_count: childIds.length,
          }));
          changed = true;
          continue;
        }
        const fullyClassified = childResults.every(item => (
          item.state === 'resolved' && item.client_slug
        ) || (
          item.state === 'provisional_child_family' && item.provisional_client_slug
        ));
        if (!fullyClassified) continue;
        const childSlugs = [...new Set(childResults.map(item => item.state === 'resolved'
          ? item.client_slug
          : item.provisional_client_slug))].sort();
        if (childSlugs.length === 1) {
          resolved.set(parent, Object.assign({}, current, {
            state: 'provisional_child_family',
            source: 'unanimous_child_family',
            provisional_client_slug: childSlugs[0],
            child_issue_count: childIds.length,
            repair_required: true,
            reason: 'projectless_parent_unanimous_child_family',
          }));
        } else {
          resolved.set(parent, conflictResult(current, 'child_family_conflict', {
            child_client_slugs: childSlugs,
            child_issue_count: childIds.length,
          }));
        }
        changed = true;
      }
    }
  }

  let hierarchyChanged = true;
  while (hierarchyChanged) {
    hierarchyChanged = false;
    for (const [parent, childIds] of childrenByParent) {
      for (const child of childIds) {
        const parentResult = resolved.get(parent);
        const childResult = resolved.get(child);
        if (!parentResult || !childResult) continue;

        if (parentResult.state === 'conflict' || childResult.state === 'conflict') {
          if (parentResult.state !== 'conflict') {
            resolved.set(parent, conflictResult(parentResult, 'hierarchy_conflict_propagated', {
              conflicting_child_issue_id: child,
              child_conflict_reason: childResult.reason,
            }));
            hierarchyChanged = true;
          }
          if (childResult.state !== 'conflict') {
            resolved.set(child, conflictResult(childResult, 'hierarchy_conflict_propagated', {
              conflicting_parent_issue_id: parent,
              parent_conflict_reason: parentResult.reason,
            }));
            hierarchyChanged = true;
          }
          continue;
        }

        const parentSlug = parentResult.state === 'resolved'
          ? parentResult.client_slug
          : parentResult.state === 'provisional_child_family'
            ? parentResult.provisional_client_slug
            : '';
        const childSlug = childResult.state === 'resolved'
          ? childResult.client_slug
          : childResult.state === 'provisional_child_family'
            ? childResult.provisional_client_slug
            : '';
        if (!parentSlug || !childSlug || parentSlug === childSlug) continue;
        resolved.set(parent, conflictResult(parentResult, 'parent_child_client_conflict', {
          parent_candidate_client_slug: parentSlug,
          conflicting_child_issue_id: child,
          conflicting_child_client_slug: childSlug,
        }));
        resolved.set(child, conflictResult(childResult, 'parent_child_client_conflict', {
          child_candidate_client_slug: childSlug,
          conflicting_parent_issue_id: parent,
          conflicting_parent_client_slug: parentSlug,
        }));
        hierarchyChanged = true;
      }
    }
  }

  const counts = {};
  for (const result of resolved.values()) counts[result.state] = (counts[result.state] || 0) + 1;
  return {
    schema: ATTRIBUTION_SCHEMA,
    mapping_revision: projectIndex.mapping_revision,
    projectIndex,
    byIssueId: resolved,
    summary: {
      issue_count: resolved.size,
      by_state: counts,
      repair_required: [...resolved.values()].filter(row => row.repair_required).length,
    },
  };
}

function attributionForIssue(graph, issue) {
  return graph && graph.byIssueId && graph.byIssueId.get(issueId(issue)) || null;
}

function storageClientSlug(attribution, fallbackSlug = '') {
  if (attribution && attribution.state === 'resolved' && clean(attribution.client_slug)) {
    return clean(attribution.client_slug);
  }
  return clean(fallbackSlug);
}

function withAttribution(rawValue, attribution) {
  const raw = parseJson(rawValue);
  return Object.assign({}, raw, { attribution: canonical(attribution || {}) });
}

function sameAttribution(left, right) {
  return stableJson(parseJson(left)) === stableJson(parseJson(right));
}

module.exports = {
  ATTRIBUTION_SCHEMA,
  OWNER_MANIFEST_SCHEMA,
  clean,
  parseJson,
  canonical,
  stableJson,
  sha256,
  configuredProjectIds,
  buildProjectIndex,
  persistedExplicitClassifications,
  issueId,
  issueProjectId,
  parentId,
  normalizeExplicitClassifications,
  resolveAttributionGraph,
  attributionForIssue,
  storageClientSlug,
  withAttribution,
  sameAttribution,
};
