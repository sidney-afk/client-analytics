#!/usr/bin/env node
'use strict';

/*
 * Back-fill of client review-page notes that exist only in a card's comment
 * column and never reached production_comments (OPEN_REPAIRS 452).
 *
 * Until the fix in that entry, a plain note written on the client review page
 * was saved to the card row only. This finds those notes (client role, root,
 * video or thumbnail part, on a card linked to a deliverable) and, with
 * --apply, adds each one through the documented canonical path: the same
 * planner as the F42 import (scripts/f42-card-comment-import.js) and the same
 * service-only `production_comment_card_import` RPC. That RPC is idempotent on
 * (surface, card, part, note id): a second run changes nothing. It keeps the
 * note's author, role, audience, part and original time. Note: the RPC stores
 * the production note under a composite id (pc_card_<hash>) and keeps the
 * note's own id in provenance; this is the established mapping, not a new one.
 *
 * A note is skipped when production already holds it: the same id, or exactly
 * one same-words root (same role, audience, part, within 15 minutes) -- the
 * rule from the reply fix. More than one match is skipped as ambiguous and
 * counted, never guessed.
 *
 * DEFAULT IS A DRY RUN. It reads only, and prints counts per card id (no
 * names, no text). --apply needs F42_CONFIRM_CARD_COMMENT_IMPORT=IMPORT_CARD_COMMENTS.
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Usage: node scripts/review-note-backfill.js [--since 2026-10-01] [--exclude-card id,id] [--apply]
 *        node scripts/review-note-backfill.js --rollback review-note-backfill-<since> [--apply]
 * Rollback deletes only rows of that run (import_run_id) and refuses the whole
 * thing if any gained a reply, edit, resolve, delete or version change.
 */
const { planSurface } = require('./f42-card-comment-import');

const CONFIRM_ENV = 'F42_CONFIRM_CARD_COMMENT_IMPORT';
const CONFIRM_TOKEN = 'IMPORT_CARD_COMMENTS';
const WINDOW_MS = 15 * 60 * 1000;
const PARTS = { video: 'video_tweaks', graphic: 'graphic_tweaks' };

const clean = v => String(v == null ? '' : v).trim();

/* { list, malformed }: an empty column is an empty list; anything populated
   that is not a JSON array is MALFORMED, never silently empty. */
function parseList(value) {
  if (Array.isArray(value)) return { list: value, malformed: false };
  if (value == null || !clean(value)) return { list: [], malformed: false };
  if (typeof value !== 'string') return { list: [], malformed: true };
  try { const out = JSON.parse(value); return Array.isArray(out) ? { list: out, malformed: false } : { list: [], malformed: true }; } catch (e) { return { list: [], malformed: true }; }
}

function twinsOf(note, part, canonical) {
  const t = Date.parse(note.created_at || '');
  return canonical.filter(r => r && !clean(r.parent_id)
    && clean(r.body) === clean(note.body) && clean(r.role) === clean(note.role)
    && (!clean(r.audience) || !clean(note.audience) || clean(r.audience) === clean(note.audience))
    && (!clean(r.component) || clean(r.component) === part)
    && (() => { const u = Date.parse(r.source_created_at || r.created_at || ''); return !isFinite(t) || !isFinite(u) || Math.abs(t - u) <= WINDOW_MS; })());
}

/* Pure: cards, deliverables and canonical rows in; the orphan notes out, as
   card-shaped rows holding only those notes so the F42 planner can plan them. */
function findOrphans({ cards, canonicalByDeliverable, since, exclude }) {
  const counts = { notes_seen: 0, already_in_production: 0, has_twin: 0, ambiguous_twin: 0, orphan: 0 };
  const perCard = {};
  const rows = [];
  const malformed = [];
  const skip = new Set(exclude || []);
  for (const card of cards || []) {
    if (skip.has(card.id)) continue;
    const row = { id: card.id, client: card.client, client_slug: card.client_slug,
      video_deliverable_id: card.video_deliverable_id, graphic_deliverable_id: card.graphic_deliverable_id };
    let any = false;
    for (const [part, field] of Object.entries(PARTS)) {
      const parsed = parseList(card[field]);
      if (parsed.malformed) { malformed.push({ card_id: card.id, part }); continue; }
      const deliverable = clean(card[part + '_deliverable_id']);
      if (!deliverable) continue;
      const canonical = (canonicalByDeliverable && canonicalByDeliverable.get(deliverable)) || [];
      const keep = [];
      for (const note of parsed.list) {
        if (!note || clean(note.role) !== 'client' || clean(note.parent_id) || note.deleted === true || note.hidden === true) continue;
        if (since && clean(note.created_at) < since) continue;
        counts.notes_seen++;
        if (canonical.some(r => clean(r.id) === clean(note.id) || clean(r.native_comment_id) === clean(note.id))) { counts.already_in_production++; continue; }
        const twins = twinsOf(note, part, canonical);
        if (twins.length === 1) { counts.has_twin++; continue; }
        if (twins.length > 1) { counts.ambiguous_twin++; continue; }
        keep.push(note); counts.orphan++;
        perCard[card.id] = (perCard[card.id] || 0) + 1;
      }
      if (keep.length) { row[field] = keep; any = true; }
    }
    if (any) rows.push(row);
  }
  return { rows, counts, perCard, malformed };
}

function plan({ cards, deliverables, canonicalByDeliverable, since, importRunId, exclude }) {
  const found = findOrphans({ cards, canonicalByDeliverable, since, exclude });
  const deliverablesById = new Map((deliverables || []).map(d => [clean(d.id), d]));
  const planned = planSurface(found.rows, { surface: 'calendar', importRunId, deliverablesById });
  return { ...found, planned };
}

async function getAll(config, fetchImpl, table, select, filter) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetchImpl(`${config.url}/rest/v1/${table}?select=${select}${filter || ''}`, {
      headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, Range: `${from}-${from + 999}`, 'Range-Unit': 'items' },
    });
    if (!res.ok) throw new Error(`read_${table}_${res.status}`);
    const page = await res.json();
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

/* Pure: which rows of a run may be deleted. A row that gained any later
   activity (a reply, an edit, a resolve, a delete, a version bump) is
   refused, and one refusal stops the whole rollback. */
function rollbackVerdict(rows, replyParentIds) {
  const replied = new Set(replyParentIds || []);
  const refused = [];
  for (const r of rows) {
    const reasons = [];
    if (replied.has(r.id)) reasons.push('has_reply');
    if (clean(r.edited_at)) reasons.push('edited');
    if (clean(r.resolved_at)) reasons.push('resolved');
    if (clean(r.deleted_at)) reasons.push('deleted');
    if (Number(r.version) !== 1) reasons.push('version_changed');
    if (reasons.length) refused.push({ id: r.id, reasons });
  }
  return { deletable: rows.length - refused.length, refused };
}
const ROLLBACK_MAX = 500;

async function rollback(args, env, config, fetchImpl, deps, out) {
  const runId = clean(args.rollback);
  if (!/^review-note-backfill-[0-9-]+$/.test(runId)) throw new Error('--rollback needs a run id like review-note-backfill-2026-10-01');
  const apply = args.apply === true;
  if (apply && clean(env[CONFIRM_ENV]) !== CONFIRM_TOKEN) throw new Error(`--apply needs ${CONFIRM_ENV}=${CONFIRM_TOKEN}`);
  const rows = deps.runRows || await getAll(config, fetchImpl, 'production_comments',
    'id,version,edited_at,resolved_at,deleted_at', `&import_run_id=eq.${encodeURIComponent(runId)}&backfill_tag=eq.f42-card-thread`);
  if (rows.length > ROLLBACK_MAX) throw new Error(`rollback refused: ${rows.length} rows is more than ${ROLLBACK_MAX}`);
  const ids = rows.map(r => r.id);
  const replies = deps.replyParents || (ids.length ? (await getAll(config, fetchImpl, 'production_comments', 'parent_id',
    `&parent_id=in.(${ids.map(i => '"' + i + '"').join(',')})`)).map(r => r.parent_id) : []);
  const verdict = rollbackVerdict(rows, replies);
  out(`mode: ROLLBACK ${apply ? 'APPLY' : 'dry run (nothing deleted)'}`);
  out(`run: ${runId}`);
  out(`rows_of_this_run: ${rows.length}`);
  out(`deletable: ${verdict.deletable}`);
  out(`refused: ${verdict.refused.length}`);
  verdict.refused.forEach(x => out(`refused ${x.id}: ${x.reasons.join(',')}`));
  if (verdict.refused.length) throw new Error('rollback refused: some rows gained later activity; nothing deleted');
  if (!apply) return verdict;
  const del = deps.deleteOne || (async id => {
    for (const url of [
      `${config.url}/rest/v1/production_comment_card_links?production_comment_id=eq.${encodeURIComponent(id)}`,
      `${config.url}/rest/v1/production_comments?id=eq.${encodeURIComponent(id)}&import_run_id=eq.${encodeURIComponent(runId)}&version=eq.1`,
    ]) {
      const res = await fetchImpl(url, { method: 'DELETE', headers: { apikey: config.key, Authorization: `Bearer ${config.key}` } });
      if (!res.ok) throw new Error(`delete_${res.status}`);
    }
  });
  let deleted = 0;
  for (const id of ids) { await del(id); deleted++; }
  out(`deleted: ${deleted}`);
  return verdict;
}

async function run(argv = process.argv.slice(2), env = process.env, deps = {}) {
  const args = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  const apply = args.apply === true;
  if (apply && clean(env[CONFIRM_ENV]) !== CONFIRM_TOKEN) throw new Error(`--apply needs ${CONFIRM_ENV}=${CONFIRM_TOKEN}`);
  const config = { url: clean(env.SUPABASE_URL).replace(/\/$/, ''), key: clean(env.SUPABASE_SERVICE_ROLE_KEY) };
  if (!config.url || !config.key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const fetchImpl = deps.fetch || globalThis.fetch;
  const out = deps.out || (s => process.stdout.write(s + '\n'));
  if (args.rollback) return rollback(args, env, config, fetchImpl, deps, out);
  const since = clean(args.since) || '2026-10-01';
  const exclude = clean(args['exclude-card'] === true ? '' : args['exclude-card']).split(',').map(clean).filter(Boolean);
  const cards = deps.cards || await getAll(config, fetchImpl, 'calendar_posts',
    'id,client,client_slug,video_deliverable_id,graphic_deliverable_id,video_tweaks,graphic_tweaks',
    '&or=(video_tweaks.not.is.null,graphic_tweaks.not.is.null)');
  const deliverables = deps.deliverables || await getAll(config, fetchImpl, 'deliverables', 'id,client_slug,team,origin,card_id');
  const canonical = deps.canonical || await getAll(config, fetchImpl, 'production_comments',
    'id,native_comment_id,deliverable_id,parent_id,body,role,audience,component,source_created_at,created_at');
  const canonicalByDeliverable = new Map();
  canonical.forEach(r => { const k = clean(r.deliverable_id); if (!canonicalByDeliverable.has(k)) canonicalByDeliverable.set(k, []); canonicalByDeliverable.get(k).push(r); });
  const result = plan({ cards, deliverables, canonicalByDeliverable, since, exclude, importRunId: 'review-note-backfill-' + since });
  out(`mode: ${apply ? 'APPLY' : 'dry run (nothing written)'}`);
  out(`since: ${since}`);
  Object.entries(result.counts).forEach(([k, v]) => out(`${k}: ${v}`));
  out(`planned_imports: ${result.planned.imports.length}`);
  out(`deferred (no usable deliverable): ${result.planned.deferrals.length}, link_defects: ${result.planned.defects.length}, conflicts: ${result.planned.conflicts.length}`);
  const perCard = {};
  result.planned.imports.forEach(i => { perCard[i.link.card_id] = (perCard[i.link.card_id] || 0) + 1; });
  Object.keys(perCard).sort().forEach(id => out(`card ${id}: ${perCard[id]}`));
  out(`excluded_cards: ${exclude.length}`);
  out(`malformed_columns: ${result.malformed.length}`);
  result.malformed.forEach(m => out(`malformed ${m.card_id} ${m.part}: not a JSON array; fix or --exclude-card`));
  if (result.malformed.length) throw new Error('malformed comment columns block --apply; fix them or exclude those cards');
  if (result.planned.conflicts.length) throw new Error('plan has conflicts; nothing applied');
  if (!apply) return result;
  const rpc = deps.importOne || (async (link, comment, event) => {
    const res = await fetchImpl(`${config.url}/rest/v1/rpc/production_comment_card_import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: config.key, Authorization: `Bearer ${config.key}` },
      body: JSON.stringify({ p_link: link, p_comment: comment, p_event: event || {} }),
    });
    if (!res.ok) throw new Error(`rpc_production_comment_card_import_${res.status}`);
    return res.json();
  });
  let applied = 0;
  for (const item of result.planned.imports) { await rpc(item.link, item.comment, item.event); applied++; }
  out(`applied: ${applied} (re-running changes nothing)`);
  return result;
}

if (require.main === module) run().catch(e => { console.error(String(e && e.message || e)); process.exit(1); });

module.exports = { findOrphans, plan, run, twinsOf, rollbackVerdict };
