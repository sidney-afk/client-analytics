'use strict';
/*
 * Move calendar cards from one client to another — the whole card, not just
 * the label.
 *
 *   node scripts/move-card-client.js --cards=p_a,p_b --to=<slug>          # DRY-RUN
 *   APPLY=true node scripts/move-card-client.js --cards=p_a --to=<slug>   # apply
 *
 * WHY A SCRIPT AND NOT SQL. A card is four things wearing one trench coat:
 * the calendar_posts row (what the calendar shows), up to two deliverables
 * rows (what the Production tab shows), the batch those deliverables sit in
 * (how Production groups them and how Create Post appends), and the Linear
 * issues mirroring them. Updating only calendar_posts.client moves the card
 * visually and leaves every other layer claiming the old client — which is
 * the exact client/batch disagreement behind the 2026-08-20
 * batch_parent_mapping incident. This script moves the first three layers
 * atomically per card and PRINTS the Linear moves it cannot do itself.
 *
 * WHAT IT DOES PER CARD
 *   1. calendar_posts.client            -> target slug
 *   2. deliverables.client_slug         -> target slug (video + graphic)
 *   3. batch: the moved deliverables are repointed into a NEW batch owned by
 *      the target client (one per source batch, created on apply, named after
 *      the source batch). The new batch carries an EMPTY linear_parent_ids on
 *      purpose: the source batch's parents live in the SOURCE client's Linear
 *      project, and copying them would make a later "add to previous batch"
 *      file new work under the wrong client's project. An empty map means the
 *      picker refuses appends with the batch-shaped message until someone
 *      starts a fresh batch — honest, and cheap.
 *   4. Linear: printed, not executed. The issues' project must move to the
 *      target client's project (clients.linear_project_ids) close in time to
 *      the apply, or the attribution audit will flag the disagreement.
 *
 * SAFETY
 *   - DRY-RUN by default; APPLY=true to write. Apply re-reads and verifies.
 *   - Refuses a target slug with no active public.clients row.
 *   - Refuses a card whose deliverables already disagree with the card's own
 *     client — that is a pre-existing repair, not a move.
 *   - deliverables updates are audited automatically by the
 *     track_b_deliverable_ledger_guard trigger; nothing here bypasses it.
 *   - Never touches Linear links, statuses, order, or n8n.
 */
const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/$/, '');
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const APPLY = process.argv.includes('--apply') || /^(1|true|yes)$/i.test(process.env.APPLY || '');

const args = new Map(process.argv.slice(2).map(a => {
  const m = String(a).match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] == null ? '1' : m[2]] : [a, '1'];
}));

async function rest(pathname, init) {
  const res = await fetch(SUPA_URL + '/rest/v1/' + pathname, {
    ...init,
    headers: {
      apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY,
      'Content-Type': 'application/json', Prefer: 'return=representation',
      ...(init && init.headers),
    },
  });
  if (!res.ok) throw new Error(pathname.split('?')[0] + ' -> HTTP ' + res.status + ': ' + (await res.text()).slice(0, 300));
  return res.json();
}

function fail(msg) { console.error('REFUSED: ' + msg); process.exit(1); }

async function main() {
  if (!SUPA_KEY) fail('SUPABASE_SERVICE_ROLE_KEY is required');
  const cardIds = String(args.get('cards') || '').split(',').map(s => s.trim()).filter(Boolean);
  const target = String(args.get('to') || '').trim();
  if (!cardIds.length || !target) fail('usage: --cards=<id,id,...> --to=<client-slug>');

  const targetRows = await rest(`clients?slug=eq.${encodeURIComponent(target)}&select=slug,display_name,active,linear_project_ids`);
  if (!targetRows.length) fail(`target client "${target}" has no public.clients row — create it first (onboarding §6f)`);
  if (targetRows[0].active === false) fail(`target client "${target}" is inactive`);
  const targetProjects = targetRows[0].linear_project_ids || {};

  const inList = cardIds.map(encodeURIComponent).join(',');
  const cards = await rest(`calendar_posts?id=in.(${inList})&select=id,client,name,status,video_deliverable_id,graphic_deliverable_id,linear_issue_id,graphic_linear_issue_id`);
  const missing = cardIds.filter(id => !cards.some(c => c.id === id));
  if (missing.length) fail('card(s) not found: ' + missing.join(', '));

  const delivIds = cards.flatMap(c => [c.video_deliverable_id, c.graphic_deliverable_id]).filter(Boolean);
  const delivs = delivIds.length
    ? await rest(`deliverables?id=in.(${delivIds.map(encodeURIComponent).join(',')})&select=id,linear_identifier,client_slug,team,batch_id,status,card_id`)
    : [];

  /* A deliverable disagreeing with its own card is EITHER a pre-existing
     repair (refuse: moving it would bury the evidence) OR the residue of an
     interrupted run of THIS script (converge: the rerun finishes the move).
     Review of #1115 was right that sequential REST writes are not a
     transaction -- PostgREST cannot span one across calls without a dedicated
     RPC -- so instead of pretending, the script is IDEMPOTENT AND RESUMABLE:
     work is ordered per CARD (never per layer), so an interruption strands at
     most one card mid-move, and a row already sitting on the target is
     recognised as progress rather than refused. Rerun the same command until
     the verify passes; every step is a no-op once its row is on the target. */
  for (const d of delivs) {
    const card = cards.find(c => c.id === d.card_id) || cards.find(c => [c.video_deliverable_id, c.graphic_deliverable_id].includes(d.id));
    if (card && d.client_slug !== card.client && d.client_slug !== target) {
      fail(`deliverable ${d.linear_identifier || d.id} says client "${d.client_slug}" but its card says "${card.client}" — repair that first`);
    }
  }

  const sourceBatchIds = [...new Set(delivs.map(d => d.batch_id).filter(Boolean))];
  const batches = sourceBatchIds.length
    ? await rest(`batches?id=in.(${sourceBatchIds.map(encodeURIComponent).join(',')})&select=id,name,client_slug,purpose`)
    : [];

  const plan = {
    mode: APPLY ? 'apply' : 'dry-run',
    target,
    cards: cards.map(c => ({ id: c.id, name: c.name, from: c.client })),
    deliverables: delivs.map(d => ({ id: d.id, linear: d.linear_identifier, team: d.team, from_batch: d.batch_id })),
    new_batches: batches.map(b => ({ from: b.id, name: b.name, note: 'created for ' + target + ' with EMPTY linear_parent_ids' })),
    /* Derived from the deliverables AND the card's own link columns. A legacy
       card can carry linear_issue_id / graphic_linear_issue_id with NO native
       deliverable row (193 such slots at the 2026-08-20 census); reading only
       deliverables would move that card and silently leave its Linear issue
       filed under the source client. */
    linear_moves_to_do_by_hand: (() => {
      const moves = new Map();
      const put = (ident, team) => { if (ident && !moves.has(ident)) moves.set(ident, {
        issue: ident,
        to_project_id: targetProjects[team] || '(target has no project mapped for ' + team + ' — fix clients.linear_project_ids first)',
      }); };
      const identFromUrl = url => (String(url || '').match(/\/issue\/([A-Z]+-\d+)/) || [])[1] || '';
      for (const d of delivs) put(d.linear_identifier, d.team === 'graphics' ? 'graphics' : 'video');
      for (const c of cards) {
        put(identFromUrl(c.linear_issue_id), 'video');
        put(identFromUrl(c.graphic_linear_issue_id), 'graphics');
      }
      return [...moves.values()];
    })(),
  };
  console.log(JSON.stringify(plan, null, 2));
  if (!APPLY) { console.log('\n(dry-run — nothing written. APPLY=true to execute.)'); return; }

  for (const linear of plan.linear_moves_to_do_by_hand) {
    if (String(linear.to_project_id).startsWith('(')) fail('cannot apply: ' + linear.issue + ' ' + linear.to_project_id);
  }

  /* One new batch per source batch, owned by the target. REUSED on resume:
     an earlier interrupted run may already have created it, and a second
     twin would recreate the empty-duplicate mess of the 2026-08-20 picker
     incident. Matched by exact name + target + empty parent map. */
  const batchMap = new Map();
  for (const b of batches) {
    const existing = await rest(`batches?client_slug=eq.${encodeURIComponent(target)}&name=eq.${encodeURIComponent(b.name)}&linear_parent_ids=eq.{}&status=eq.active&select=id`);
    if (existing.length) {
      batchMap.set(b.id, existing[0].id);
      console.log('reusing batch ' + existing[0].id + ' from an earlier run');
      continue;
    }
    const created = await rest('batches', {
      method: 'POST',
      body: JSON.stringify({
        id: 'bat_move_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36),
        name: b.name, client_slug: target,
        purpose: b.purpose || 'calendar',   // NOT NULL in the live schema
        status: 'active',                    // NOT NULL in the live schema
        linear_parent_ids: {},
      }),
    });
    batchMap.set(b.id, created[0].id);
    console.log('created batch ' + created[0].id + ' for ' + target);
  }
  /* Per CARD, so an interruption strands at most one card -- and its rerun
     converges instead of refusing. */
  for (const c of cards) {
    const mine = delivs.filter(d => [c.video_deliverable_id, c.graphic_deliverable_id].includes(d.id));
    for (const d of mine) {
      if (d.client_slug === target && (!d.batch_id || !batchMap.has(d.batch_id))) continue; // already moved
      const patch = { client_slug: target };
      if (d.batch_id && batchMap.has(d.batch_id)) patch.batch_id = batchMap.get(d.batch_id);
      await rest(`deliverables?id=eq.${encodeURIComponent(d.id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
    }
    if (c.client !== target) {
      await rest(`calendar_posts?id=eq.${encodeURIComponent(c.id)}`, { method: 'PATCH', body: JSON.stringify({ client: target }) });
    }
    console.log('moved ' + c.id);
  }
  // verify
  const after = await rest(`calendar_posts?id=in.(${inList})&select=id,client`);
  const wrong = after.filter(c => c.client !== target);
  if (wrong.length) fail('VERIFY FAILED for ' + wrong.map(c => c.id).join(', '));
  const afterD = delivIds.length
    ? await rest(`deliverables?id=in.(${delivIds.map(encodeURIComponent).join(',')})&select=id,client_slug,batch_id`) : [];
  const wrongD = afterD.filter(d => d.client_slug !== target);
  if (wrongD.length) fail('VERIFY FAILED for deliverables ' + wrongD.map(d => d.id).join(', '));
  console.log('\nAPPLIED and verified. NOW move the Linear issues (list above) to the target project — the attribution audit flags the disagreement until you do.');
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
