#!/usr/bin/env node
'use strict';
/*
 * Crosswalk Phase 2 RUNNER — the calls that repair the card ↔ deliverable
 * crosswalk through production_comment_card_bind_and_import, planned from a
 * fresh live export and applied only behind the confirm token and a plan
 * digest. OPEN_REPAIRS 147/148/156; CROSSWALK_REPAIR_STRATEGY §5.
 *
 * WHAT IT DOES. For every calendar card of an active client, each filled slot
 * (video / graphic) is compared with the deliverable it names on the four
 * fields `_prodCrosswalkMismatchFields` compares (origin, team, client_slug,
 * card_id). A mismatching slot is classified with the SAME questions the RPC
 * asks, in the same order, so the plan predicts the RPC rather than
 * discovering it: identity proven and agreeing, not another client's row, not
 * bound elsewhere, and whether the slot is held by an occupant the card does
 * not point at (then the call carries evict_occupant='card_wins', the owner's
 * ruling) or by a second projection of the SAME issue (then it is a refusal,
 * never an eviction). The RPC re-checks all of it inside its transaction; the
 * plan is a forecast, the receipts are the record.
 *
 * THE LEGACY THREAD RIDES ALONG. A slot whose card carries legacy comments is
 * bound AND imported in one transaction, or not at all: the import planner
 * (scripts/f42-card-comment-import.js) is run ONE CLIENT AT A TIME over a
 * snapshot in which the deliverable rows of the planned calls are already in
 * their POST-BIND state, so it plans exactly the comments the RPC will accept
 * after binding — and a card id reused by two clients (calendar_posts is keyed
 * on (client, id)) can never mix their threads. A slot
 * whose thread the planner cannot plan cleanly (a conflict or a link defect
 * naming that card+component) is skipped as `thread_not_plannable` rather than
 * bound without its conversation — binding first and importing later is the
 * silent split OPEN_REPAIRS 147 §4 exists to prevent. A slot with a comment
 * the import policy would leave behind is held back too
 * (`thread_partially_planned`): a bound card must never show fewer comments
 * than it did before.
 *
 * PUBLIC SAFETY. The result document carries card ids, client slugs and
 * Linear identifiers and is written to a runner-local file only.
 * renderSummaryMarkdown() is the allowlist projection for the public run log:
 * counts, reason enums, the digest — never an identifier.
 *
 * The database layer is injected (deps.live for the export, deps.rpc for the
 * calls) so the unit test exercises the planner and the apply loop without a
 * live backend.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const commentImport = require('./f42-card-comment-import');
const commentExport = require('./f42-card-comment-export');

const RPC_NAME = 'production_comment_card_bind_and_import';
const CONFIRM_ENV = 'CROSSWALK_CONFIRM_PHASE2_REPAIR';
const CONFIRM_TOKEN = 'REPAIR_CROSSWALK_PHASE2';
const EVICT_MODE = 'card_wins';
const PLAN_CONTRACT = 'syncview-crosswalk-phase2-plan-v1';
// The drill client is named in code by design (see repo-identity-exposure-check).
const TEST_CLIENT = 'sidneylaruel';
const DEFAULT_CAP = 120;
const SLOTS = Object.freeze([
  Object.freeze({ field: 'video_deliverable_id', component: 'video', link: 'linear_issue_id' }),
  Object.freeze({ field: 'graphic_deliverable_id', component: 'graphic', link: 'graphic_linear_issue_id' }),
]);
const DELIVERABLE_SELECT = 'id,client_slug,team,kind,origin,card_id,status,linear_identifier,linear_issue_url,linear_issue_uuid';
const RPC_DETAIL_MAX = 200;

const clean = value => String(value == null ? '' : value).trim();
const low = value => clean(value).toLowerCase();

/* Same two shapes crosswalk_linear_identifier() reads in SQL: a full issue URL
   or a bare identifier. '' is UNPROVEN. */
function linearIdentifier(value) {
  const text = clean(value);
  const match = text.match(/\/issue\/([A-Za-z][A-Za-z0-9]*-[0-9]+)/) || text.match(/^([A-Za-z][A-Za-z0-9]*-[0-9]+)$/);
  return match ? match[1].toUpperCase() : '';
}
function deliverableIdentity(row) {
  return linearIdentifier(row && row.linear_identifier) || linearIdentifier(row && row.linear_issue_url);
}
function teamForComponent(component) { return component === 'graphic' ? 'graphics' : 'video'; }
function kindForSlot(component) { return component === 'graphic' ? 'thumbnail' : 'video'; }
function cardSlug(card) { return clean(card && (card.client_slug || card.client)); }
function slotKey(client, cardId, component) { return `${clean(client)}|${clean(cardId)}|${clean(component)}`; }

/* Mirrors _prodCrosswalkMismatchFields (index.html) and
   deliverableCrosswalkIssues (f42-card-comment-import.js): origin/team compare
   case-insensitively, client_slug/card_id exactly after trimming. */
function mismatchFields(deliverable, card, component) {
  const fields = [];
  if (low(deliverable && deliverable.origin) !== 'calendar') fields.push('origin');
  if (low(deliverable && deliverable.team) !== teamForComponent(component)) fields.push('team');
  if (clean(deliverable && deliverable.client_slug) !== cardSlug(card)) fields.push('client_slug');
  if (clean(deliverable && deliverable.card_id) !== clean(card && card.id)) fields.push('card_id');
  return fields.sort();
}

/* ---- live export -------------------------------------------------------- */

/* Each table is paged on its OWN key. `clients` is keyed on slug and has no id
   column at all -- ordering it by id is a 400 and the first live plan run died
   on exactly that before writing a result. calendar_posts is keyed on
   (client, id) and the bare id repeats across clients, so a page ordered by id
   alone is not stable across offsets; it is ordered by the full key. */
const TABLE_ORDER = Object.freeze({
  clients: 'slug.asc',
  calendar_posts: 'client.asc,id.asc',
  deliverables: 'id.asc',
});

async function fetchAllRows(config, table, select, fetchImpl) {
  const pageSize = Number(config.pageSize) > 0 ? Number(config.pageSize) : 1000;
  const order = TABLE_ORDER[table];
  if (!order) throw new Error(`export_order_unknown_${table}`);
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const url = `${config.url}/rest/v1/${table}?select=${encodeURIComponent(select)}&order=${order}&limit=${pageSize}&offset=${offset}`;
    // eslint-disable-next-line no-await-in-loop
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`, Accept: 'application/json' },
    });
    // eslint-disable-next-line no-await-in-loop
    const payload = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(payload)) {
      const error = new Error(`export_read_${table}_${response.status}`);
      throw error;
    }
    rows.push(...payload);
    if (payload.length < pageSize) break;
  }
  return rows;
}

async function exportLive(config = {}, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch_unavailable');
  if (!clean(config.url) || !clean(config.serviceKey)) throw new Error('supabase_configuration_required');
  const clients = await fetchAllRows(config, 'clients', 'slug,active', fetchImpl);
  // Cards need the comment arrays (for the import) and the Linear link columns
  // (for identity), so the full row is read and projected here, not in SQL.
  const cards = await fetchAllRows(config, 'calendar_posts', '*', fetchImpl);
  const deliverables = await fetchAllRows(config, 'deliverables', DELIVERABLE_SELECT, fetchImpl);
  return { clients, cards, deliverables, exported_at: typeof deps.now === 'function' ? deps.now() : new Date().toISOString() };
}

/* ---- classification: the RPC's questions, in the RPC's order --------------- */

function classifySlot(card, slot, deliverable, rowsByCard) {
  const component = slot.component;
  const client = cardSlug(card);
  const cardId = clean(card.id);
  const cardIdent = linearIdentifier(card[slot.link]);
  const delIdent = deliverableIdentity(deliverable);
  const currentClient = clean(deliverable.client_slug);
  const currentCard = clean(deliverable.card_id);
  if (currentClient && currentClient !== client) return { refusal: 'client_mismatch' };
  if (currentCard && currentCard !== cardId) return { refusal: 'already_bound_elsewhere' };
  if (!cardIdent || !delIdent) return { refusal: 'linear_identity_unproven' };
  if (cardIdent !== delIdent) return { refusal: 'linear_identity_disagrees' };

  const other = slot.component === 'video' ? clean(card.graphic_deliverable_id) : clean(card.video_deliverable_id);
  const expectedTeam = teamForComponent(component);
  const kindAfter = kindForSlot(component);
  const occupants = (rowsByCard.get(`${client}|${cardId}`) || []).filter(row => {
    const id = clean(row.id);
    if (!id || id === clean(deliverable.id) || (other && id === other)) return false;
    return low(row.team) === expectedTeam || low(row.kind) === kindAfter;
  });
  for (const occupant of occupants) {
    const ident = deliverableIdentity(occupant);
    if (ident && ident === cardIdent) return { refusal: 'occupant_same_issue' };
  }
  return {
    bind: true,
    linear_identifier: cardIdent,
    kind_before: clean(deliverable.kind) || null,
    kind_after: kindAfter,
    team_after: expectedTeam,
    evict: occupants.length > 0,
    occupants: occupants.map(row => ({
      id: clean(row.id),
      status: clean(row.status) || null,
      linear_identifier: deliverableIdentity(row) || null,
    })).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/* ---- the comment threads, planned against the post-bind crosswalk ----------- */

/* ONE CLIENT PER SNAPSHOT. calendar_posts is keyed on (client, id) and the bare
   card id is reused across clients by design, while the import planner's
   defect and deferral rows carry only card_id + component. Planning each
   client alone is what makes "this card's thread" unambiguous: an import can
   never be attributed to another client's card of the same id, and another
   client's defect can never hold this client's slot back (Codex P1 on #1296). */
function buildCommentSnapshot(live, calls, client) {
  const patched = new Map(calls.filter(call => call.client === client).map(call => [clean(call.deliverable_id), call]));
  const deliverables = (live.deliverables || [])
    .map(row => {
      const projected = commentExport.projectDeliverable(row);
      const call = patched.get(clean(row.id));
      if (call) {
        projected.client_slug = call.client;
        projected.team = call.team_after;
        projected.origin = 'calendar';
        projected.card_id = call.card_id;
      }
      return projected;
    })
    .filter(row => clean(row.id))
    .sort((a, b) => clean(a.id).localeCompare(clean(b.id)));
  const calendar = (live.cards || [])
    .filter(card => cardSlug(card) === client)
    .map(commentExport.projectCard)
    .filter(commentExport.cardHasComments);
  return {
    contract: commentImport.SNAPSHOT_CONTRACT,
    surfaces: { calendar, sxr: [] },
    deliverables,
    manifest: {
      surfaces: {
        calendar: commentImport.sourceCoverage(calendar, 'calendar'),
        sxr: commentImport.sourceCoverage([], 'sxr'),
      },
    },
  };
}

function namesSlot(row, call) {
  if (!row || typeof row !== 'object') return false;
  if (clean(row.card_id) && clean(row.component)) {
    return clean(row.card_id) === call.card_id && clean(row.component) === call.component;
  }
  // A conflict without explicit coordinates (e.g. duplicate_identity carries an
  // identity string) is matched by content: on doubt, the slot is not bound.
  const text = JSON.stringify(row);
  return text.includes(call.card_id) && text.includes(call.component);
}

function attachCommentsForClient(client, calls, commentPlan) {
  const importsBySlot = new Map();
  for (const item of commentPlan.imports || []) {
    const link = item && item.link ? item.link : {};
    if (low(link.source_surface) !== 'calendar') continue;
    // The snapshot held one client; a link naming another would be a planner
    // defect, and is dropped rather than attributed to this client's call.
    if (clean(link.client_slug) !== client) continue;
    const key = `${clean(link.card_id)}|${clean(link.component)}`;
    if (!importsBySlot.has(key)) importsBySlot.set(key, []);
    importsBySlot.get(key).push({
      ...(item.comment || {}),
      native_comment_id: clean(link.native_comment_id),
      source_fingerprint: clean(link.source_fingerprint),
    });
  }
  const problems = [...(commentPlan.conflicts || []), ...(commentPlan.defects || [])];
  const deferrals = commentPlan.deferrals || [];
  const kept = [];
  const skipped = [];
  for (const call of calls) {
    if (call.client !== client) continue;
    const blocking = problems.filter(row => namesSlot(row, call));
    if (blocking.length) {
      skipped.push({
        client: call.client, card_id: call.card_id, component: call.component, deliverable_id: call.deliverable_id,
        reason: 'thread_not_plannable',
        classifications: [...new Set(blocking.map(row => clean(row.classification) || 'unclassified'))].sort(),
      });
      continue;
    }
    const comments = importsBySlot.get(`${call.card_id}|${call.component}`) || [];
    // A deferred row is a comment the import policy would leave behind. On a
    // slot this runner binds that would mean a canonical thread that does not
    // cover the legacy one (_prodCanonicalCoversLegacy) -- the card keeps
    // rendering legacy while new writes land canonically, the exact split
    // OPEN_REPAIRS 147 §4 exists to prevent. By construction a planned slot
    // has a deliverable, so this cannot happen today; it is a hold-back rather
    // than an assumption: a bound card never shows fewer comments than before.
    const deferred = deferrals.filter(row => namesSlot(row, call)).length;
    if (deferred) {
      skipped.push({
        client: call.client, card_id: call.card_id, component: call.component, deliverable_id: call.deliverable_id,
        reason: 'thread_partially_planned',
        deferred_comments: deferred,
      });
      continue;
    }
    kept.push({ ...call, comments, deferred_comments: 0 });
  }
  return { calls: kept, skipped };
}

function attachComments(calls, live, runId) {
  const clients = [...new Set(calls.map(call => call.client))].sort();
  const kept = [];
  const skipped = [];
  for (const client of clients) {
    const commentPlan = commentImport.planCardCommentImport(buildCommentSnapshot(live, calls, client), { importRunId: runId });
    const snapshotLevel = (commentPlan.conflicts || []).filter(row => clean(row.classification) === 'snapshot_contract_required');
    if (snapshotLevel.length) {
      const error = new Error('comment_snapshot_invalid');
      error.reasons = [...new Set(snapshotLevel.map(row => clean(row.reason)))].sort();
      throw error;
    }
    const attached = attachCommentsForClient(client, calls, commentPlan);
    kept.push(...attached.calls);
    skipped.push(...attached.skipped);
  }
  return { calls: kept, skipped };
}

/* ---- the plan --------------------------------------------------------------- */

function planDigest(calls) {
  const identities = calls.map(call => [
    call.client, call.card_id, call.component, call.deliverable_id,
    call.evict ? EVICT_MODE : 'off',
    (call.occupants || []).map(o => o.id).sort(),
    (call.comments || []).map(c => clean(c.native_comment_id)).sort(),
  ]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return crypto.createHash('sha256').update(JSON.stringify(identities)).digest('hex');
}

function planRepair(live, options = {}) {
  const runId = clean(options.runId) || 'crosswalk-phase2-plan';
  const activeClients = new Set((live.clients || [])
    .filter(row => row && row.active !== false && clean(row.slug))
    .map(row => clean(row.slug)));
  if (!options.includeTestClient) activeClients.delete(TEST_CLIENT);

  const byId = new Map();
  const rowsByCard = new Map();
  for (const row of live.deliverables || []) {
    const id = clean(row && row.id);
    if (!id) continue;
    byId.set(id, row);
    if (low(row.origin) === 'calendar' && clean(row.card_id)) {
      const key = `${clean(row.client_slug)}|${clean(row.card_id)}`;
      if (!rowsByCard.has(key)) rowsByCard.set(key, []);
      rowsByCard.get(key).push(row);
    }
  }

  const calls = [];
  const skipped = [];
  let slotsExamined = 0;
  let cleanSlots = 0;
  let cardsExamined = 0;
  for (const card of live.cards || []) {
    const client = cardSlug(card);
    if (!activeClients.has(client)) continue;
    cardsExamined++;
    for (const slot of SLOTS) {
      const deliverableId = clean(card[slot.field]);
      if (!deliverableId) continue;
      slotsExamined++;
      const base = { client, card_id: clean(card.id), component: slot.component, deliverable_id: deliverableId };
      const deliverable = byId.get(deliverableId);
      if (!deliverable) { skipped.push({ ...base, reason: 'deliverable_missing' }); continue; }
      const fields = mismatchFields(deliverable, card, slot.component);
      if (!fields.length) { cleanSlots++; continue; }
      const verdict = classifySlot(card, slot, deliverable, rowsByCard);
      if (verdict.refusal) { skipped.push({ ...base, reason: verdict.refusal, mismatch_fields: fields }); continue; }
      calls.push({ ...base, mismatch_fields: fields, ...verdict });
    }
  }

  const attached = attachComments(calls, live, runId);
  const finalCalls = attached.calls
    .sort((a, b) => (a.client + a.card_id + a.component).localeCompare(b.client + b.card_id + b.component));
  const finalSkipped = [...skipped, ...attached.skipped];
  const digest = planDigest(finalCalls);

  const skippedByReason = {};
  for (const row of finalSkipped) skippedByReason[row.reason] = (skippedByReason[row.reason] || 0) + 1;
  const evictions = finalCalls.filter(call => call.evict);
  const relabels = {};
  for (const call of finalCalls) {
    if (low(call.kind_before) !== call.kind_after) {
      const key = `${low(call.kind_before) || 'null'}->${call.kind_after}`;
      relabels[key] = (relabels[key] || 0) + 1;
    }
  }
  return {
    contract: PLAN_CONTRACT,
    run_id: runId,
    exported_at: clean(live.exported_at) || null,
    include_test_client: !!options.includeTestClient,
    digest,
    counts: {
      active_clients: activeClients.size,
      cards_examined: cardsExamined,
      slots_examined: slotsExamined,
      clean_slots: cleanSlots,
      mismatching_slots: finalCalls.length + finalSkipped.length,
      calls: finalCalls.length,
      calls_with_eviction: evictions.length,
      occupants_to_evict: evictions.reduce((n, call) => n + call.occupants.length, 0),
      calls_with_thread: finalCalls.filter(call => call.comments.length).length,
      comments_to_import: finalCalls.reduce((n, call) => n + call.comments.length, 0),
      comments_deferred: finalCalls.reduce((n, call) => n + (call.deferred_comments || 0), 0),
      relabels,
      skipped: finalSkipped.length,
      skipped_by_reason: skippedByReason,
    },
    calls: finalCalls,
    skipped: finalSkipped,
  };
}

/* ---- apply ------------------------------------------------------------------- */

function publicRpcFailure(error) {
  const detail = error && error.rpc && typeof error.rpc === 'object' ? error.rpc : {};
  const message = clean(detail.message || (error && error.message));
  const match = message.match(/crosswalk_bind_[a-z_]+|production comment card import [a-z ]+/);
  return {
    code: match ? match[0].replace(/^crosswalk_bind_/, '') : (clean(detail.code) || 'rpc_failure'),
    status: Number(detail.status) || 0,
  };
}

function supabaseRpc(config, fetchImpl) {
  return async function rpc(name, body) {
    const response = await fetchImpl(`${config.url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}` },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const row = payload && typeof payload === 'object' ? payload : {};
      const error = new Error(`rpc_${name}_${response.status}`);
      error.rpc = { status: response.status, code: clean(row.code).slice(0, RPC_DETAIL_MAX), message: clean(row.message).slice(0, RPC_DETAIL_MAX) };
      throw error;
    }
    return payload;
  };
}

function bindingFor(call) {
  const binding = {
    source_surface: 'calendar',
    deliverable_id: call.deliverable_id,
    card_id: call.card_id,
    client_slug: call.client,
    component: call.component,
  };
  if (call.evict) binding.evict_occupant = EVICT_MODE;
  return binding;
}

async function applyPlan(plan, rpc, options = {}) {
  if (typeof rpc !== 'function') throw new Error('rpc_required');
  const cap = Number(options.cap) > 0 ? Number(options.cap) : DEFAULT_CAP;
  if (plan.calls.length > cap) {
    const error = new Error('cap_exceeded');
    error.reasons = [`calls=${plan.calls.length}`, `cap=${cap}`];
    throw error;
  }
  const receipts = [];
  const refusals = [];
  for (const call of plan.calls) {
    const body = {
      p_binding: bindingFor(call),
      p_comments: call.comments || [],
      p_event: {
        source: 'backfill',
        action: 'crosswalk_phase2_bind_and_import',
        actor: 'crosswalk-phase2-runner',
        role: 'service',
        import_run_id: plan.run_id,
      },
    };
    let result;
    try {
      // eslint-disable-next-line no-await-in-loop
      result = await rpc(RPC_NAME, body);
    } catch (error) {
      refusals.push({ client: call.client, card_id: call.card_id, component: call.component, deliverable_id: call.deliverable_id, ...publicRpcFailure(error) });
      continue;
    }
    const receipt = result && typeof result === 'object' ? result : {};
    receipts.push({
      client: call.client,
      card_id: call.card_id,
      component: call.component,
      deliverable_id: call.deliverable_id,
      bound: receipt.bound === true,
      kind_before: receipt.kind_before == null ? null : clean(receipt.kind_before),
      kind: clean(receipt.kind) || null,
      evicted: Array.isArray(receipt.evicted) ? receipt.evicted : [],
      processed: Number(receipt.processed) || 0,
      imported: Number(receipt.imported) || 0,
      already_linked: Number(receipt.already_linked) || 0,
    });
  }
  const refusalsByCode = {};
  for (const row of refusals) refusalsByCode[row.code] = (refusalsByCode[row.code] || 0) + 1;
  return {
    applied_count: receipts.filter(r => r.bound).length,
    evicted_count: receipts.reduce((n, r) => n + r.evicted.length, 0),
    evicted_by_mode: receipts.reduce((acc, r) => { for (const e of r.evicted) { const m = clean(e && e.mode) || 'unknown'; acc[m] = (acc[m] || 0) + 1; } return acc; }, {}),
    imported_count: receipts.reduce((n, r) => n + r.imported, 0),
    already_linked_count: receipts.reduce((n, r) => n + r.already_linked, 0),
    refusal_count: refusals.length,
    refusals_by_code: refusalsByCode,
    receipts,
    refusals,
  };
}

/* ---- verify: re-export, re-plan, count what is left ------------------------- */

function verifyAgainst(planAfter) {
  return {
    mismatching_slots_remaining: planAfter.counts.mismatching_slots,
    still_bindable: planAfter.counts.calls,
    remaining_by_reason: planAfter.counts.skipped_by_reason,
  };
}

/* ---- public-safe summary ------------------------------------------------------ */

function renderSummaryMarkdown(result) {
  const doc = result && typeof result === 'object' ? result : {};
  const isApply = doc.apply && typeof doc.apply === 'object';
  const counts = doc.plan && doc.plan.counts ? doc.plan.counts : {};
  const lines = [`## Crosswalk Phase 2 — ${isApply ? 'APPLY' : 'PLAN'}`, '', `- status: ${clean(doc.status) || 'UNKNOWN'}`];
  lines.push(`- plan digest: \`${clean(doc.plan && doc.plan.digest)}\``);
  lines.push(`- slots examined / clean / mismatching: ${Number(counts.slots_examined || 0)} / ${Number(counts.clean_slots || 0)} / ${Number(counts.mismatching_slots || 0)}`);
  lines.push(`- calls planned: ${Number(counts.calls || 0)} (with eviction ${Number(counts.calls_with_eviction || 0)}, occupants ${Number(counts.occupants_to_evict || 0)}; with a legacy thread ${Number(counts.calls_with_thread || 0)}, comments ${Number(counts.comments_to_import || 0)}, deferred ${Number(counts.comments_deferred || 0)})`);
  const relabels = counts.relabels && typeof counts.relabels === 'object' ? counts.relabels : {};
  const relabelText = Object.keys(relabels).sort().map(key => `${key} ${relabels[key]}`).join(', ');
  lines.push(`- relabels on bind: ${relabelText || 'none'}`);
  const skippedBy = counts.skipped_by_reason && typeof counts.skipped_by_reason === 'object' ? counts.skipped_by_reason : {};
  const skippedText = Object.keys(skippedBy).sort().map(key => `${key} ${skippedBy[key]}`).join(', ');
  lines.push(`- skipped (for a person): ${Number(counts.skipped || 0)}${skippedText ? ` — ${skippedText}` : ''}`);
  if (isApply) {
    const apply = doc.apply;
    const evictedBy = apply.evicted_by_mode && typeof apply.evicted_by_mode === 'object' ? apply.evicted_by_mode : {};
    lines.push(`- applied: ${Number(apply.applied_count || 0)} bound, ${Number(apply.evicted_count || 0)} occupants evicted (${Object.keys(evictedBy).sort().map(k => `${k} ${evictedBy[k]}`).join(', ') || 'none'}), ${Number(apply.imported_count || 0)} comments imported, ${Number(apply.already_linked_count || 0)} already linked`);
    const refusedBy = apply.refusals_by_code && typeof apply.refusals_by_code === 'object' ? apply.refusals_by_code : {};
    lines.push(`- refused by the RPC: ${Number(apply.refusal_count || 0)}${Object.keys(refusedBy).length ? ` — ${Object.keys(refusedBy).sort().map(k => `${k} ${refusedBy[k]}`).join(', ')}` : ''}`);
    if (doc.verification) {
      const v = doc.verification;
      const remaining = v.remaining_by_reason && typeof v.remaining_by_reason === 'object' ? v.remaining_by_reason : {};
      lines.push(`- after: ${Number(v.mismatching_slots_remaining || 0)} mismatching slots remain (${Number(v.still_bindable || 0)} still bindable; ${Object.keys(remaining).sort().map(k => `${k} ${remaining[k]}`).join(', ') || 'none'})`);
    }
  }
  lines.push('', 'Per-slot receipts stay in the runner-local result document and are never uploaded.');
  return `${lines.join('\n')}\n`;
}

/* ---- CLI ----------------------------------------------------------------------- */

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
  const mode = clean(args.mode) || 'plan';
  if (!['plan', 'apply'].includes(mode)) throw new Error('usage: --mode plan|apply --run-id <id> [--expect-plan-digest <sha256>] [--cap N] [--include-test-client] [--output file]');
  const runId = clean(args['run-id']);
  if (!runId) throw new Error('run_id_required');
  const config = { url: clean(env.SUPABASE_URL), serviceKey: clean(env.SUPABASE_SERVICE_ROLE_KEY), pageSize: env.CROSSWALK_EXPORT_PAGE_SIZE };
  const options = { runId, includeTestClient: args['include-test-client'] === true, cap: args.cap };
  const exporter = typeof deps.live === 'function' ? deps.live : () => exportLive(config, deps);
  const live = await exporter();
  const plan = planRepair(live, options);
  const result = { status: 'PLANNED', mode, run_id: runId, plan };

  if (mode === 'plan') {
    if (args.output) fs.writeFileSync(path.resolve(String(args.output)), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  }

  if (clean(env[CONFIRM_ENV]) !== CONFIRM_TOKEN) throw new Error('owner_confirmation_required');
  const expected = clean(args['expect-plan-digest']);
  if (!expected) throw new Error('expected_plan_digest_required');
  if (expected !== plan.digest) {
    const error = new Error('expected_plan_digest_mismatch');
    error.reasons = ['the live data moved since the reviewed plan; re-run plan and review again'];
    throw error;
  }
  let rpc = deps.rpc;
  if (typeof rpc !== 'function') {
    if (!config.url || !config.serviceKey) throw new Error('supabase_configuration_required');
    const fetchImpl = deps.fetch || globalThis.fetch;
    if (typeof fetchImpl !== 'function') throw new Error('fetch_unavailable');
    rpc = supabaseRpc(config, fetchImpl);
  }
  const apply = await applyPlan(plan, rpc, options);
  const after = planRepair(await exporter(), { ...options, runId: `${runId}-verify` });
  result.apply = apply;
  result.verification = verifyAgainst(after);
  result.status = apply.refusal_count ? 'PARTIAL' : 'APPLIED';
  if (args.output) fs.writeFileSync(path.resolve(String(args.output)), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  run().then(result => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result && result.status === 'PARTIAL') process.exitCode = 2;
  }).catch(error => {
    process.stderr.write(`${JSON.stringify({
      status: 'FAIL',
      code: clean(error && error.message) || 'unexpected_failure',
      reasons: error && error.reasons || undefined,
      rpc: error && error.rpc || undefined,
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  CONFIRM_ENV,
  DELIVERABLE_SELECT,
  TABLE_ORDER,
  fetchAllRows,
  CONFIRM_TOKEN,
  DEFAULT_CAP,
  EVICT_MODE,
  PLAN_CONTRACT,
  RPC_NAME,
  TEST_CLIENT,
  applyPlan,
  bindingFor,
  buildCommentSnapshot,
  classifySlot,
  exportLive,
  linearIdentifier,
  mismatchFields,
  planDigest,
  planRepair,
  renderSummaryMarkdown,
  run,
};
