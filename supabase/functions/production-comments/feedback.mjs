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

// The F42 importer (`scripts/f42-card-comment-import.js`) treats the source
// field as durable tweak provenance: an entry read out of a `*_tweaks` cell is
// imported as a tweak even when the historical row omitted the redundant flag,
// and an explicit `true` wins anywhere. Match that rule EXACTLY rather than
// inventing a second one — recording such an entry as `null` here meant
// `sameCurrentComment`'s strict equality could never meet the imported
// canonical row's `true`, so an otherwise exact imported comment kept a
// permanent duplicate in Feedback & tweaks. `calendar_posts.tweaks` is the one
// cell the importer never reads, so it has no importer rule to match and its
// tweak metadata stays honestly unknown.
const tweakFlag = (raw, field) => raw.is_tweak === true || /_tweaks$/.test(field) ? true
  : typeof raw.is_tweak === 'boolean' ? raw.is_tweak : null;

// Every identity field below is derived by executing the F42 importer's rule,
// not a second rule that resembles it. `sameCurrentComment` compares these
// strictly, so any divergence makes coverage impossible and the note duplicates
// forever. Three such divergences were found one at a time by review before
// `test/component-feedback-read.js` grew the parity matrix that now drives both
// real functions over every raw shape a historical card contains.
//
// The importer defaults a missing role to `smm` purely to pick the author label,
// and that default is used HERE for the same purpose only: the emitted `role`
// stays null when the entry has none, because an unknown role is deliberately
// non-disqualifying in the match and inventing one would start refusing
// coverage rather than granting it.
function sourceComment(raw, scope, field, index) {
  const id = clean(raw.id || raw.comment_id || raw.native_comment_id);
  const deleted = truthy(raw.deleted) || truthy(raw.is_deleted) || !!clean(raw.deleted_at);
  const resolved = truthy(raw.done) || truthy(raw.resolved) || !!clean(raw.resolved_at);
  const importerRole = clean(raw.role || 'smm').toLowerCase();
  // Same shape as the tweak-flag rule above, and the same failure if it drifts:
  // the F42 importer accepts an entry that carries only `updated_at` and writes
  // that value as `source_created_at`
  // (`scripts/f42-card-comment-import.js` — `normalizeComment`). Recording
  // `null` here instead meant `sameCurrentComment`'s strict equality on
  // `source_created_at` could never meet the imported canonical row, so an
  // already-imported historical note stayed visible TWICE forever and could
  // push a genuinely source-only tweak out of the Workload popover's three-row
  // preview. The fallback list mirrors the importer's exactly — `updated_at`
  // last, and snake case only, so a camelCase-only row still projects the same
  // absence the importer records for it.
  const created = stamp(raw.source_created_at || raw.created_at || raw.createdAt || raw.ts
    || raw.updated_at);
  const updated = stamp(raw.source_updated_at || raw.updated_at || raw.updatedAt) || created;
  // BRANCH ORDER, not just the fallback. When either boolean says resolved the
  // importer takes `done_at || sourceUpdatedAt` and never consults
  // `resolved_at`; only an entry with no boolean at all is dated from
  // `resolved_at`. Preferring the explicit `resolved_at` here looked more
  // accurate and was wrong twice over: `sameCurrentComment` rejected the twin,
  // so the note duplicated forever, and the "accuracy" bought nothing because a
  // source row's resolved_at is consumed as a BOOLEAN and never rendered as a
  // time (the popover filters resolved rows out entirely; the panel reads it as
  // `done`). This field's job is matching, not reporting.
  const resolvedAt = truthy(raw.done) || truthy(raw.resolved)
    ? stamp(raw.done_at) || updated
    : stamp(raw.resolved_at);
  return {
    id: 'source:' + JSON.stringify([scope.surface, scope.card_id, scope.component, field, id, index]),
    native_id: id, parent_native_id: clean(raw.parent_id || raw.parentId),
    // An entry with no author is labelled by the importer from its role, not as
    // "Unknown author" -- and the canonical twin already carries that label, so
    // this is the value both surfaces have to agree on.
    author_name: clean(raw.author || raw.author_name) || (importerRole === 'client' ? 'Client' : 'SyncView'),
    role: clean(raw.role).toLowerCase() || null,
    body: deleted ? '' : String(raw.body ?? raw.text ?? ''),
    attachments: deleted ? [] : safeAttachments(raw.attachments),
    audience: 'internal', // Staff-only projection, never a grant to client readers.
    component: scope.component, is_tweak: tweakFlag(raw, field),
    round: raw.round != null && raw.round !== '' && Number.isInteger(Number(raw.round)) && Number(raw.round) > 0 ? Number(raw.round) : null,
    source_created_at: created, source_updated_at: updated,
    edited_at: stamp(raw.edited_at), deleted, deleted_at: stamp(raw.deleted_at),
    done: resolved, resolved_at: resolvedAt,
    // `done_by` first, as the importer has it. The reversed order only shows on
    // a row carrying BOTH with different values, which is exactly the row the
    // strict comparison then refuses to cover.
    resolved_by_name: resolved ? clean(raw.done_by || raw.resolved_by_name) || null : null,
    source_only: true, source_surface: scope.surface, source_field: field,
    source_audience: ['client', 'internal'].includes(raw.audience) ? raw.audience : null,
    can_edit: false, can_delete: false, can_resolve: false,
  };
}

// The importer's own-audience rule, before any inheritance: 'client' only when
// the source says so explicitly or the author is a client.
const ownAudience = raw => clean(raw && raw.audience).toLowerCase() === 'client'
  || clean(raw && raw.role || 'smm').toLowerCase() === 'client' ? 'client' : 'internal';
// The audience the IMPORTER would have written for this row, which is what a
// canonical twin actually carries: a reply takes its thread ROOT's audience —
// "a reply never sets its own client visibility" — and only a root keeps its
// own. Used for MATCHING only. The emitted `source_audience` deliberately stays
// row-local, because the panel renders it as "Card: client-visible" / "Card:
// internal": that label reports what the CARD recorded, and replacing it with an
// inherited value would make a displayed provenance label say something the card
// never said.
function importerAudience(raw, rawById, parentById) {
  const id = clean(raw && (raw.id || raw.comment_id || raw.native_comment_id));
  const parent = clean(raw && (raw.parent_id || raw.parentId));
  if (!parent || !rawById.has(parent)) return ownAudience(raw);
  const seen = new Set();
  let cursor = id;
  while (parentById.has(cursor) && rawById.has(parentById.get(cursor)) && !seen.has(cursor)) {
    seen.add(cursor);
    cursor = parentById.get(cursor);
  }
  return ownAudience(rawById.get(cursor) || {});
}

function sameCurrentComment(source, canonical, matchAudience) {
  const deleted = !!clean(canonical.deleted_at);
  const resolved = !!clean(canonical.resolved_at);
  return clean(canonical.component) === source.component
    && source.author_name === clean(canonical.author_name)
    && (!source.role || source.role === clean(canonical.role))
    && ((matchAudience || source.source_audience || '') === ''
      || (matchAudience || source.source_audience) === canonical.audience)
    && source.body === (deleted ? '' : String(canonical.body ?? ''))
    && source.deleted === deleted && source.done === resolved
    // Unknown tweak metadata is non-disqualifying, exactly as unknown role and
    // unknown audience already are above; a known value must still agree.
    && (source.is_tweak === null || source.is_tweak === canonical.is_tweak)
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
  // `tweaks` is a calendar_posts column only; sample_reviews carries just the two
  // component cells (migrations/live-schema-baseline-2026-07-03.sql). Selecting it
  // against sample_reviews errors the whole read, which surfaces as
  // `source_unavailable` — worded in the panel as a transient failure, so the
  // Samples video path looked flaky rather than unimplemented.
  const fields = scope.component !== 'video' ? ['graphic_tweaks']
    : scope.surface === 'calendar' ? ['video_tweaks', 'tweaks'] : ['video_tweaks'];
  const columns = ['id', 'client', scope.component + '_deliverable_id', ...fields].join(',');
  const readCard = () => supabase.from(table).select(columns).eq('client', scope.client_slug).eq('id', scope.card_id).maybeSingle();
  // Binding columns only. `feedbackCardMatches` needs the reciprocal link and
  // nothing else, so the size refusal below can revalidate the link without
  // pulling the oversized payload a second time.
  const readBinding = () => supabase.from(table).select(['id', 'client', scope.component + '_deliverable_id'].join(','))
    .eq('client', scope.client_slug).eq('id', scope.card_id).maybeSingle();
  try {
    const first = await readCard();
    if (first.error) return state('source_unavailable', [], scope);
    if (!feedbackCardMatches(first.data, scope)) return state('link_changed', [], scope);
    const card = first.data;
    if (new TextEncoder().encode(JSON.stringify(card)).length > BYTE_LIMIT) {
      // `retain_previous` tells the reader to KEEP what it is already showing,
      // so it may only be granted on a binding this response has revalidated —
      // exactly what the second `readCard()` does for every other outcome. This
      // path used to return on the first read alone, so a card detached after
      // that read still authorised retention of its notes, and the popover's
      // one-minute cache was resting on a guarantee this branch did not make.
      const recheck = await readBinding();
      if (recheck.error) return state('source_unavailable', [], scope);
      if (!feedbackCardMatches(recheck.data, scope)) return state('link_changed', [], scope);
      return { ...state('source_limit', [], scope), retain_previous: true };
    }
    let complete = true;
    let sourcePartial = false, suppressionObserved = false;
    const rows = [];
    const aliases = new Map();
    const parsedFields = new Map(), hiddenIds = new Set(), deletedIds = new Set();
    // Thread shape for this component, spanning every alias field exactly as the
    // importer's per-component pass does, so a reply's ROOT is resolvable.
    const rawById = new Map(), parentById = new Map();
    const matchAudienceByRowId = new Map();
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
        const threadId = clean(raw.id || raw.comment_id || raw.native_comment_id);
        if (threadId) {
          if (!rawById.has(threadId)) rawById.set(threadId, raw);
          const threadParent = clean(raw.parent_id || raw.parentId);
          if (threadParent) parentById.set(threadId, threadParent);
        }
      }
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
        matchAudienceByRowId.set(row.id, importerAudience(raw, rawById, parentById));
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
      const candidates = matches.filter(c => (permitted.has(c.id) || c.native_comment_id === row.native_id)
        && sameCurrentComment(row, c, matchAudienceByRowId.get(row.id)));
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
          && sameCurrentComment(row, canonical, matchAudienceByRowId.get(row.id))) {
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
