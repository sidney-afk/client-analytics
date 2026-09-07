// Read-only staff projection. Source cells remain owned by their existing writers.
// The five-field F42 crosswalk and its composite comment identity are preserved;
// content comparison is permitted only AFTER a stable identity has matched.
import { clean, normalizeTeam, safeAttachments } from './policy.mjs';

export const FEEDBACK_LIMIT = 500;
const BYTE_LIMIT = 1024 * 1024;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const truthy = value => value === true || value === 1 || ['true', '1', 'yes'].includes(clean(value).toLowerCase());
const stable = value => Array.isArray(value) ? value.map(stable) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const stamp = value => clean(value) && Number.isFinite(Date.parse(clean(value))) ? new Date(value).toISOString() : null;
const state = (status, rows = [], scope = null) => ({ version: 1, status, complete: status === 'complete', scope, rows });

export function feedbackScope(target) {
  const surface = target?.origin === 'calendar' ? 'calendar' : target?.origin === 'samples' ? 'sxr' : '';
  const team = normalizeTeam(target?.team);
  if (!surface || !clean(target?.id) || !clean(target?.client_slug) || !clean(target?.card_id) || !team) return null;
  return { surface, card_id: clean(target.card_id), component: team === 'graphics' ? 'graphic' : 'video',
    deliverable_id: clean(target.id), client_slug: clean(target.client_slug) };
}

export function feedbackCardMatches(card, scope) {
  return !!object(card) && clean(card.id) === scope.card_id && clean(card.client) === scope.client_slug
    && clean(card[scope.component + '_deliverable_id']) === scope.deliverable_id;
}

async function digest(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function importedCommentId(scope, nativeId) {
  // Same F42 productionId contract; never a title/name/text-derived identity.
  return 'pc_card_' + await digest([scope.surface, scope.card_id, scope.component, nativeId].join(':'));
}

function sourceComment(raw, scope, field, index) {
  const id = clean(raw.id || raw.comment_id || raw.native_comment_id);
  const deleted = truthy(raw.deleted) || truthy(raw.is_deleted) || !!clean(raw.deleted_at);
  const resolved = truthy(raw.done) || truthy(raw.resolved) || !!clean(raw.resolved_at);
  const created = stamp(raw.source_created_at || raw.created_at || raw.createdAt || raw.ts);
  return {
    id: 'source:' + JSON.stringify([scope.surface, scope.card_id, scope.component, field, id, index]),
    native_id: id, parent_native_id: clean(raw.parent_id || raw.parentId),
    author_name: clean(raw.author || raw.author_name) || 'Unknown author',
    role: clean(raw.role) || null,
    body: deleted ? '' : String(raw.body ?? raw.text ?? ''),
    attachments: deleted ? [] : safeAttachments(raw.attachments),
    audience: 'internal', // Staff-only projection, never a grant to client readers.
    component: scope.component, is_tweak: typeof raw.is_tweak === 'boolean' ? raw.is_tweak : null,
    round: raw.round != null && raw.round !== '' && Number.isInteger(Number(raw.round)) && Number(raw.round) > 0 ? Number(raw.round) : null,
    source_created_at: created, source_updated_at: stamp(raw.source_updated_at || raw.updated_at || raw.updatedAt) || created,
    edited_at: stamp(raw.edited_at), deleted, deleted_at: stamp(raw.deleted_at),
    done: resolved, resolved_at: stamp(raw.resolved_at || raw.done_at),
    resolved_by_name: resolved ? clean(raw.resolved_by_name || raw.done_by) || null : null,
    source_only: true, source_surface: scope.surface, source_field: field,
    source_audience: ['client', 'internal'].includes(raw.audience) ? raw.audience : null,
    can_edit: false, can_delete: false, can_resolve: false,
  };
}

function sameCurrentComment(source, canonical) {
  const deleted = !!clean(canonical.deleted_at);
  const resolved = !!clean(canonical.resolved_at);
  return clean(canonical.component) === source.component
    && source.author_name === clean(canonical.author_name)
    && (!source.role || source.role === clean(canonical.role))
    && (!source.source_audience || source.source_audience === canonical.audience)
    && source.body === (deleted ? '' : String(canonical.body ?? ''))
    && source.deleted === deleted && source.done === resolved
    && source.is_tweak === canonical.is_tweak
    && source.round === (canonical.round == null ? null : Number(canonical.round))
    && source.source_created_at === stamp(canonical.source_created_at || canonical.created_at)
    && source.source_updated_at === stamp(canonical.source_updated_at || canonical.source_created_at || canonical.created_at)
    && source.resolved_at === stamp(canonical.resolved_at)
    && source.edited_at === stamp(canonical.edited_at)
    && source.resolved_by_name === (resolved ? clean(canonical.resolved_by_name) || null : null)
    && equal(source.attachments, deleted ? [] : safeAttachments(canonical.attachments));
}

export async function readLegacyFeedback(supabase, target, principal) {
  // Defense in depth: even an explicitly requested projection cannot extend
  // the exact-client canonical endpoint's audience or read a source cell.
  if (principal?.kind !== 'staff') return null;
  const scope = feedbackScope(target);
  if (!scope) return state('unmapped');
  const table = scope.surface === 'calendar' ? 'calendar_posts' : 'sample_reviews';
  const fields = scope.component === 'video' ? ['video_tweaks', 'tweaks'] : ['graphic_tweaks'];
  const columns = ['id', 'client', scope.component + '_deliverable_id', ...fields].join(',');
  const readCard = () => supabase.from(table).select(columns).eq('client', scope.client_slug).eq('id', scope.card_id).maybeSingle();
  try {
    const first = await readCard();
    if (first.error) return state('source_unavailable', [], scope);
    if (!feedbackCardMatches(first.data, scope)) return state('link_changed', [], scope);
    const card = first.data;
    if (new TextEncoder().encode(JSON.stringify(card)).length > BYTE_LIMIT) return { ...state('source_limit', [], scope), retain_previous: true };
    let complete = true;
    let sourcePartial = false, suppressionObserved = false;
    const rows = [];
    const aliases = new Map();
    const parsedFields = new Map(), hiddenIds = new Set(), deletedIds = new Set();
    // Suppression belongs to the stable comment identity across BOTH video
    // aliases, not to whichever row is encountered first. Inspect the whole
    // bounded payload before emitting a body, including beyond the row cap.
    for (const field of fields) {
      const value = card[field];
      if (value == null || value === '') continue;
      let values;
      try { values = typeof value === 'string' ? JSON.parse(value) : value; } catch { complete = false; sourcePartial = true; continue; }
      if (!Array.isArray(values)) { complete = false; sourcePartial = true; continue; }
      parsedFields.set(field, values);
      for (const raw of values) if (object(raw)) {
        const id = clean(raw.id || raw.comment_id || raw.native_comment_id);
        if (truthy(raw.hidden) || clean(raw.component) && clean(raw.component) !== scope.component) {
          suppressionObserved = true; complete = false;
          if (id) hiddenIds.add(id);
        }
        if (truthy(raw.deleted) || truthy(raw.is_deleted) || clean(raw.deleted_at)) {
          suppressionObserved = true;
          if (id) deletedIds.add(id);
        }
      }
    }
    for (const [field, values] of parsedFields) {
      const occurrences = new Map();
      for (const [index, raw] of values.entries()) {
        if (rows.length >= FEEDBACK_LIMIT) {
          complete = false; sourcePartial = true;
          if (object(raw) && (truthy(raw.hidden) || truthy(raw.deleted) || truthy(raw.is_deleted) || clean(raw.deleted_at)
            || clean(raw.component) && clean(raw.component) !== scope.component)) suppressionObserved = true;
          continue;
        }
        if (!object(raw)) { complete = false; sourcePartial = true; continue; }
        const sourceId = clean(raw.id || raw.comment_id || raw.native_comment_id);
        if (sourceId && hiddenIds.has(sourceId)) { complete = false; continue; }
        if (sourceId && deletedIds.has(sourceId)
            && !(truthy(raw.deleted) || truthy(raw.is_deleted) || clean(raw.deleted_at))) {
          // Retain the actual tombstone, never an older unsuppressed alias.
          complete = false; continue;
        }
        // Hidden source content includes deliberate cross-client suppression.
        // Do not resurrect it, even in a staff projection.
        if (truthy(raw.hidden)) { complete = false; suppressionObserved = true; continue; }
        if (clean(raw.component) && clean(raw.component) !== scope.component) { complete = false; suppressionObserved = true; continue; }
        const row = sourceComment(raw, scope, field, index);
        if (row.deleted) suppressionObserved = true;
        if (!row.native_id) complete = false;
        // Video's two persisted aliases may contain the SAME stable identity.
        // Use max multiplicity across aliases, not a text set, and never merge
        // id-less notes or different IDs. Divergent versions remain visible.
        const key = row.native_id ? JSON.stringify(stable([row.native_id, raw])) : '';
        const occurrence = (occurrences.get(key) || 0) + 1;
        occurrences.set(key, occurrence);
        if (key && occurrence <= (aliases.get(key) || 0)) continue;
        rows.push(row);
      }
      for (const [key, count] of occurrences) if (key) aliases.set(key, Math.max(count, aliases.get(key) || 0));
    }
    const nativeIds = [...new Set(rows.map(row => row.native_id).filter(Boolean))];
    let matches = [], links = [];
    if (nativeIds.length) {
      const linkRead = await supabase.from('production_comment_card_links')
        .select('native_comment_id,production_comment_id').eq('source_surface', scope.surface)
        .eq('card_id', scope.card_id).eq('component', scope.component).eq('deliverable_id', scope.deliverable_id)
        .limit(FEEDBACK_LIMIT + 1);
      if (linkRead.error || !Array.isArray(linkRead.data) || linkRead.data.length > FEEDBACK_LIMIT) complete = false;
      else links = linkRead.data;
      const select = 'id,native_comment_id,parent_id,component,author_name,role,audience,body,attachments,is_tweak,round,source_created_at,source_updated_at,created_at,edited_at,deleted_at,resolved_at,resolved_by_name,version,updated_at';
      // One exact-component bounded read avoids oversized ID-list URLs or an
      // unbounded query fan-out. When comparison coverage exceeds the bound,
      // keep every source note and explicitly report incomplete coverage.
      const read = await supabase.from('production_comments').select(select)
        .eq('deliverable_id', scope.deliverable_id).eq('component', scope.component).limit(FEEDBACK_LIMIT + 1);
      if (read.error || !Array.isArray(read.data) || read.data.length > FEEDBACK_LIMIT) complete = false;
      else matches = read.data;
    }
    const byNative = new Map();
    for (const row of rows) if (row.native_id) {
      const permitted = new Set([row.native_id, await importedCommentId(scope, row.native_id),
        ...links.filter(link => link.native_comment_id === row.native_id).map(link => link.production_comment_id)]);
      const candidates = matches.filter(c => (permitted.has(c.id) || c.native_comment_id === row.native_id) && sameCurrentComment(row, c));
      if (candidates.length === 1) byNative.set(row.native_id, candidates[0].id);
    }
    const consumed = new Set();
    const sourceParents = new Map(rows.filter(row => row.native_id).map(row => [row.native_id, row.id]));
    for (const row of rows) {
      const candidate = byNative.get(row.native_id);
      const canonical = matches.find(c => c.id === candidate);
      const expectedParent = row.parent_native_id ? byNative.get(row.parent_native_id) : null;
      // One canonical copy cannot cover two occurrences; replies also require
      // their exact parent identity. Unknown parents stay visible as source.
      if (canonical && Number.isInteger(Number(canonical.version)) && clean(canonical.updated_at) && !consumed.has(candidate)
          && (row.parent_native_id ? expectedParent && canonical.parent_id === expectedParent : !canonical.parent_id)
          && sameCurrentComment(row, canonical)) {
        row.covered_by = candidate;
        row.covered_version = Number(canonical.version);
        row.covered_updated_at = clean(canonical.updated_at);
        consumed.add(candidate);
      }
      row.parent_id = row.parent_native_id ? sourceParents.get(row.parent_native_id) || 'source-parent-unavailable' : null;
      row.parent_unavailable = !!row.parent_native_id && !sourceParents.has(row.parent_native_id);
      delete row.native_id;
      delete row.parent_native_id;
    }
    const second = await readCard();
    if (second.error) return state('source_unavailable', [], scope);
    if (!feedbackCardMatches(second.data, scope)) return state('link_changed', [], scope);
    if (!equal(card, second.data)) return state('source_changed', [], scope);
    return { ...state(complete ? 'complete' : 'source_incomplete', rows, scope),
      retain_previous: sourcePartial && !suppressionObserved };
  } catch { return state('source_unavailable', [], scope); }
}
