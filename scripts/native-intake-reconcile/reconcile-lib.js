'use strict';
/*
 * Native intake reconciliation driver: the part of the runner that decides
 * WHAT to call and in WHICH order. It owns no persistence, no transport and no
 * business rule. Every decision about a request (what is owed, what is safe to
 * write, what is a conflict) is made inside the SQL functions of
 * migrations/2026-09-05-native-intake-reconcile.sql under the request lock;
 * this module only pages the backlog, calls the two stages in order, and folds
 * the returned facts into one report.
 *
 * `rpc(name, args)` is injected: production uses the Supabase REST rpc endpoint
 * with the service role (run.js); the proof lane injects the same calls over
 * psql against the disposable database. Nothing else differs between the two.
 *
 * Dry-run is the default. With apply=false no function writes anything and no
 * reason event is recorded; the report is the plan.
 */

const STAGE_KEYS = Object.freeze({
  children: ['recovered', 'complete', 'conflict', 'unresolved', 'planned'],
  cards: ['materialized', 'complete', 'conflict', 'unresolved', 'planned'],
});

function emptyCounts() {
  const out = {};
  for (const [stage, keys] of Object.entries(STAGE_KEYS)) {
    out[stage] = Object.fromEntries(keys.map(key => [key, 0]));
    out[stage].calls = 0;
    out[stage].skipped = 0;
  }
  out.children.recovered_children = 0;
  out.cards.created_cards = 0;
  out.cards.bound_cards = 0;
  return out;
}

function tally(counts, stage, result) {
  counts[stage].calls += 1;
  const outcome = String(result && result.outcome || '');
  if (Object.prototype.hasOwnProperty.call(counts[stage], outcome)) counts[stage][outcome] += 1;
  if (stage === 'children') counts.children.recovered_children += Array.isArray(result.recovered) ? result.recovered.length : 0;
  if (stage === 'cards') {
    counts.cards.created_cards += Array.isArray(result.created) ? result.created.length : 0;
    counts.cards.bound_cards += Array.isArray(result.bound) ? result.bound.length : 0;
  }
}

/* Stage 2 is only asked when stage 1 left nothing missing for this request:
   'recovered' (it just wrote them) or 'complete' (they were already there).
   A conflict or an unresolved child makes the card question premature, and the
   SQL would answer children_incomplete anyway; not calling it keeps the reason
   ledger to one row per real decision. */
function cardsEligible(children) {
  return !!children && (children.outcome === 'recovered' || children.outcome === 'complete');
}

async function runReconcile(options) {
  const rpc = options.rpc;
  if (typeof rpc !== 'function') throw new Error('rpc transport required');
  const actor = String(options.actor || '').trim();
  if (!actor) throw new Error('actor required');
  const apply = options.apply === true;
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 25));
  const pageSize = Math.max(1, Math.min(500, Number(options.pageSize) || 50));
  const only = Array.isArray(options.requestIds) && options.requestIds.length ? new Set(options.requestIds.map(String)) : null;
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : () => {};

  const counts = emptyCounts();
  const processed = [];
  let after = null;
  let examined = 0;
  let exhausted = false;
  let pages = 0;
  while (!exhausted && processed.length < limit) {
    const page = await rpc('production_intake_reconcile_backlog', { p_limit: pageSize, p_after: after });
    pages += 1;
    examined += Number(page.examined || 0);
    for (const item of page.items || []) {
      if (processed.length >= limit) break;
      const requestId = String(item.request_id);
      if (only && !only.has(requestId)) continue;
      const entry = { request_id: requestId, client_slug: item.client_slug, surface: item.surface, owed: item.owed };
      entry.children = await rpc('production_intake_reconcile_children', { p_request_id: requestId, p_actor: actor, p_apply: apply });
      tally(counts, 'children', entry.children);
      onEvent('children', entry);
      if (cardsEligible(entry.children)) {
        entry.cards = await rpc('production_intake_reconcile_cards', { p_request_id: requestId, p_actor: actor, p_apply: apply });
        tally(counts, 'cards', entry.cards);
      } else {
        entry.cards = { stage: 'cards', request_id: requestId, applied: false, outcome: 'skipped', reason: 'children_incomplete' };
        counts.cards.skipped += 1;
      }
      onEvent('cards', entry);
      processed.push(entry);
    }
    after = page.next_after || after;
    exhausted = page.exhausted === true;
    if (!page.items || !page.items.length) break;
  }
  const summary = await rpc('production_intake_reconcile_summary', {});
  return {
    dry_run: !apply,
    actor,
    limit,
    pages,
    examined,
    exhausted,
    processed,
    counts,
    summary,
    // Operators read these first. Anything conflicted or unresolved after an
    // apply run needs a human decision or a different owner (see the reason
    // ledger); a growing backlog age means the reconciler is not keeping up.
    attention: {
      conflicted: counts.children.conflict + counts.cards.conflict,
      unresolved: counts.children.unresolved + counts.cards.unresolved,
      backlog_age_seconds: Number(summary && summary.backlog_age_seconds || 0),
      missing_terminal_receipts: Number(summary && summary.owed && summary.owed.missing_terminal_receipts || 0),
    },
  };
}

module.exports = { runReconcile, cardsEligible, emptyCounts, STAGE_KEYS };
