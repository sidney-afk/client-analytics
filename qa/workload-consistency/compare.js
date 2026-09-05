'use strict';
// Pure normalized-snapshot comparison. No fetch, file writes, raw rows or IDs in
// the public result. Input adapters must establish semantics and completeness.
const { cardStatus, workStatus, workloadEligibility } = require('./source-harness');
const own = (row, key) => Object.prototype.hasOwnProperty.call(row, key);
const text = value => String(value == null ? '' : value).trim();
const day = value => text(value).slice(0, 10);
const surfaces = ['native', 'production', 'provider', 'workload', 'calendar', 'samples'];
const normalizeStatus = value => text(value).toLowerCase().replace(/\s+/g, ' ');
const normalizeWorkStatus = value => normalizeStatus(value).replace(/^to do$/, 'todo').replace(/^tweaks needed$/, 'tweak needed');
function compare(snapshot) {
  if (!snapshot || snapshot.schema !== 'workload-consistency/v1'
      || !surfaces.every(s => Array.isArray(snapshot[s]))
      || !Array.isArray(snapshot.members) || !Array.isArray(snapshot.expected)) {
    throw new Error('INVALID_NORMALIZED_SNAPSHOT');
  }
  const counts = Object.create(null), findings = [];
  const workloadEligibilityCounts = { eligible: 0, excluded: 0, unknown: 0 };
  // Ordinal references reveal neither identities nor hashes of enumerable IDs.
  const refs = new Map();
  const reference = row => {
    if (!refs.has(row)) refs.set(row, 'r' + String(refs.size + 1).padStart(4, '0'));
    return refs.get(row);
  };
  function add(code, row, surface) {
    counts[code] = (counts[code] || 0) + 1;
    findings.push({ code, ref: reference(row), ...(surface ? { surface } : {}) });
  }
  const complete = s => snapshot.coverage?.[s]?.complete === true;
  for (const s of [...surfaces, 'members', 'expected']) {
    if (!complete(s)) add('incomplete_input', snapshot, s);
  }
  const memberAliases = new Map();
  for (const m of snapshot.members) {
    for (const alias of new Set([m.id, m.linearId, ...(m.legacyIds || [])].map(text).filter(Boolean))) {
      if (!memberAliases.has(alias)) memberAliases.set(alias, []);
      memberAliases.get(alias).push(m);
    }
  }
  function owner(row, surface) {
    if (!own(row, 'ownerId')) { add('missing_field_proof', row, surface); return undefined; }
    const key = text(row.ownerId);
    if (!key) return null;
    const matches = memberAliases.get(key) || [];
    if (matches.length !== 1) {
      add(matches.length ? 'ambiguous_owner_identity' : 'unknown_owner_identity', row, surface);
      return undefined;
    }
    return matches[0];
  }
  const nativeByAlias = new Map();
  const nativeIds = new Set();
  for (const row of snapshot.native) {
    if (nativeIds.has(text(row.id))) add('duplicate_native_identity', row, 'native');
    nativeIds.add(text(row.id));
    for (const alias of new Set([row.id, row.linearId, ...(row.legacyIds || [])].map(text).filter(Boolean))) {
      if (!nativeByAlias.has(alias)) nativeByAlias.set(alias, []);
      nativeByAlias.get(alias).push(row);
    }
  }
  function candidates(row) {
    // Explicit native and provider identities must both agree; never choose a
    // convenient alias when the other pointer names a different work item.
    const keys = [row.nativeId, row.linearId].map(text).filter(Boolean);
    return [...new Set(keys.flatMap(k => nativeByAlias.get(k) || []))];
  }
  const linked = new Map(snapshot.native.map(row => [row, Object.create(null)]));
  const ambiguousLinks = new Map(snapshot.native.map(row => [row, new Set()]));
  for (const s of surfaces.filter(s => s !== 'native')) {
    const identities = new Map();
    for (const row of snapshot[s]) {
      const identity = JSON.stringify([text(row.scope), text(row.id), text(row.kind)]);
      identities.set(identity, (identities.get(identity) || 0) + 1);
      if (identities.get(identity) > 1) add('duplicate_record', row, s);
      if (!text(row.nativeId) && !text(row.linearId)) { add('record_identity_unproven', row, s); continue; }
      const matches = candidates(row);
      if (matches.length > 1) {
        for (const native of matches) ambiguousLinks.get(native).add(s);
        add('ambiguous_record_identity', row, s); continue;
      }
      if (!matches.length) {
        if (s === 'provider') add(complete('native') ? 'provider_only' : 'native_absence_unproven', row, s);
        else if (s === 'calendar' || s === 'samples') add('binding_target_missing_or_unproven', row, s);
        else add(s === 'production' ? 'unbound_production_record' : 'unbound_workload_record', row, s);
        continue;
      }
      const native = matches[0];
      (linked.get(native)[s] ||= []).push(row);
      if ((row.nativeId && text(row.nativeId) !== text(native.id)
          && !(native.legacyIds || []).includes(row.nativeId))
          || (row.linearId && text(row.linearId) !== text(native.linearId)
          && !(native.legacyIds || []).includes(row.linearId))) {
        add('conflicting_identity_pointer', row, s);
      }
      if (!text(row.kind) || !text(native.kind) || !text(row.scope) || !text(native.scope)) add('binding_scope_or_kind_unproven', row, s);
      else if (row.kind !== native.kind || text(row.scope) !== text(native.scope)) add('binding_scope_or_kind_mismatch', row, s);
      const a = owner(native, 'native'), b = owner(row, s);
      if (a !== undefined && b !== undefined && a !== b) add('owner_mismatch', row, s);
      const expectedStatus = (s === 'calendar' || s === 'samples')
        ? cardStatus(native.status, s) : s === 'production' ? native.status : workStatus[native.status];
      if (!own(row, 'status') || !own(native, 'status')) add('missing_field_proof', row, s);
      else if (expectedStatus == null) add('status_mapping_unrepresented', row, s);
      else {
        const normalize = ['workload', 'provider'].includes(s) ? normalizeWorkStatus : normalizeStatus;
        if (normalize(row.status) !== normalize(expectedStatus)) add('status_mismatch', row, s);
      }
      // Calendar publish dates and internal Workload days are separate concepts.
      if (!own(row, 'dueDate') || !own(native, 'dueDate') || !row.dateSemantics) add('missing_field_proof', row, s);
      else if (row.dateSemantics === 'canonical_due') {
        if (day(row.dueDate) !== day(native.dueDate)) add('canonical_due_mismatch', row, s);
      } else if (['publish_date', 'internal_plan'].includes(row.dateSemantics)) add('intentional_date_semantics', row, s);
      else add('unknown_date_semantics', row, s);
    }
  }
  for (const native of snapshot.native) {
    const matches = linked.get(native);
    const person = owner(native, 'native');
    if (person && (typeof person.active !== 'boolean' || !Array.isArray(person.teams) || !Array.isArray(person.roles))) add('owner_membership_unproven', native);
    if (person && person.active === false) add('inactive_owner', native);
    if (person && Array.isArray(person.teams) && Array.isArray(person.roles)
        && (!person.teams.includes(native.team) || !person.roles.includes('creative'))) add('owner_role_or_team_mismatch', native);
    if (typeof native.archived !== 'boolean' || typeof native.container !== 'boolean') {
      workloadEligibilityCounts.unknown++;
      add('structural_visibility_unproven', native); continue;
    }
    if (!own(workStatus, native.status)) { workloadEligibilityCounts.unknown++; add('native_status_unproven', native); continue; }
    if (native.archived || native.container || !['todo', 'in_progress', 'tweak'].includes(native.status)) {
      workloadEligibilityCounts.excluded++;
      add('legitimate_workload_exclusion', native); continue;
    }
    if (!text(native.linearId)) add('native_only', native);
    if (!matches.production?.length) add(complete('production') && !ambiguousLinks.get(native).has('production') ? 'native_missing_from_production' : 'production_absence_unproven', native);
    const eligibility = workloadEligibility(native, snapshot.workloadRoster).state;
    workloadEligibilityCounts[eligibility]++;
    if (eligibility === 'excluded') add('legitimate_workload_exclusion', native);
    if (eligibility === 'unknown') add('workload_eligibility_unproven', native);
    if (!matches.workload?.length && eligibility !== 'excluded') add(eligibility === 'eligible'
      && complete('workload') && !ambiguousLinks.get(native).has('workload') ? 'native_missing_from_workload' : 'workload_absence_unproven', native);
    for (const row of matches.workload || []) {
      if (row.visible === false && eligibility === 'eligible') add('native_stored_but_filtered', row, 'workload');
      else if (row.visible === true && eligibility === 'excluded') add('workload_visibility_policy_mismatch', row, 'workload');
      else if (typeof row.visible !== 'boolean') add('render_visibility_unproven', row, 'workload');
    }
    if ((matches.workload || []).length > 1) add('duplicate_workload_binding', native);
    // Expected bindings are explicit: a deliverable need not appear in BOTH
    // Calendar and Samples. Scope and kind are part of a card's identity.
  }
  for (const expected of snapshot.expected) {
    const matches = nativeByAlias.get(text(expected.nativeId)) || [];
    if (matches.length !== 1) {
      const providerPresent = snapshot.provider.some(row => text(row.nativeId) === text(expected.nativeId)
        || (expected.linearId && text(row.linearId) === text(expected.linearId)));
      add(matches.length ? 'ambiguous_expected_identity' : (providerPresent ? 'expected_provider_only'
        : (complete('native') && complete('provider') ? 'genuinely_absent' : 'expected_absence_unproven')), expected);
      continue;
    }
    if (!['calendar', 'samples'].includes(expected.surface)) { add('invalid_expected_surface', expected); continue; }
    const cards = snapshot[expected.surface].filter(row => text(row.id) === text(expected.cardId)
      && text(row.scope) === text(expected.scope) && row.kind === expected.kind);
    if (!cards.length) add(complete(expected.surface) ? 'expected_card_missing' : 'card_absence_unproven', expected, expected.surface);
    else if (cards.length > 1) add('duplicate_card_binding', expected, expected.surface);
    else if (text(cards[0].nativeId) !== text(matches[0].id)) add('card_binding_gap', cards[0], expected.surface);
  }
  return { schema: snapshot.schema, evidence: 'OFFLINE_TEST',
    populationVerdict: 'UNPROVEN', // Normalized input cannot attest its own origin.
    inputCounts: Object.fromEntries(surfaces.map(s => [s, snapshot[s].length])),
    workloadEligibilityCounts, counts, findings };
}
module.exports = { compare };
