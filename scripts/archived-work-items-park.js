'use strict';
/*
 * One-time cleanup: park the open work items behind ARCHIVED samples and
 * ARCHIVED calendar posts in Backlog (owner request 2026-09-28).
 *
 * Archiving a calendar post has parked its work items since 2026-08-17, and
 * archiving a sample does too from the PR that adds this script. Items
 * archived before either rule, or whose park failed, are still open on
 * people's lists. This finds them and moves each one to Backlog through the
 * SAME guarded path the page uses: the production-write gateway's `status`
 * operation, under a staff key and a named staff member. Never a direct
 * table write. The card itself is not touched: it is already Archived, and
 * Backlog is a work-item state, not a card state.
 *
 * Every committed change lands in card_change_journal (its capture trigger
 * fires on each `deliverables` write), and --apply reads the journal back per
 * item, so each move can be undone from the journal's row_before.
 *
 * Output is COUNTS ONLY -- by kind (video/graphic), by status, by source
 * (sample/calendar) and by client kind (real/test/internal). Never a client
 * name, slug, title or id. This repo and its CI logs are public.
 *
 * Usage:
 *   node scripts/archived-work-items-park.js            # dry run (default)
 *   node scripts/archived-work-items-park.js --apply    # move them
 *
 * Env:
 *   SUPABASE_URL                 default: the project URL
 *   SUPABASE_READ_KEY            any key that can read the four tables
 *                                (the browser publishable key does today)
 *   SUPABASE_SERVICE_ROLE_KEY    --apply only: reads card_change_journal back
 *   SYNCVIEW_STAFF_KEY           --apply only: staff key for the gateway
 *   SYNCVIEW_ACTOR               --apply only: the staff member the moves are
 *                                attributed to (roster name)
 */

const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/+$/, '');
const READ_KEY = String(process.env.SUPABASE_READ_KEY || 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA');
const WRITE_URL = SUPA_URL + '/functions/v1/production-write';

/* Open = still on someone's list. Everything else is either already parked
   (backlog), finished (approved/scheduled/posted) or closed
   (canceled/duplicate), and is left alone. */
const OPEN_STATUSES = new Set(['triage', 'todo', 'in_progress', 'smm_approval', 'kasper_approval', 'client_approval', 'tweak']);
const SOURCES = [
  { table: 'sample_reviews', surface: 'sxr', source: 'sample' },
  { table: 'calendar_posts', surface: 'calendar', source: 'calendar' },
];
const COMPONENTS = [
  { column: 'video_deliverable_id', kind: 'video' },
  { column: 'graphic_deliverable_id', kind: 'graphic' },
];

const clean = value => String(value == null ? '' : value).trim();

/*
 * Pure planner. Given archived cards per source, the deliverables they point
 * at, and the client roster, returns the items to park. A deliverable is
 * parked only if it is open AND still bound to that same card (its card_id,
 * when set, must match), so a work item that moved to another card is never
 * touched.
 */
function plan({ cards, deliverables, clients }) {
  const kindBySlug = new Map((clients || []).map(c => [clean(c.slug), clean(c.kind) || 'client']));
  const byId = new Map((deliverables || []).map(d => [clean(d.id), d]));
  const items = [];
  const seen = new Set();
  for (const { source, surface, rows } of cards) {
    for (const card of rows || []) {
      if (clean(card.status).toLowerCase() !== 'archived') continue;
      for (const { column, kind } of COMPONENTS) {
        const id = clean(card[column]);
        if (!id || seen.has(id)) continue;
        const d = byId.get(id);
        if (!d) continue;
        const status = clean(d.status).toLowerCase();
        if (!OPEN_STATUSES.has(status)) continue;
        if (clean(d.card_id) && clean(d.card_id) !== clean(card.id)) continue;
        seen.add(id);
        const clientKind = kindBySlug.get(clean(d.client_slug || card.client)) || 'unknown';
        items.push({
          id, source, surface, kind, status,
          client_kind: clientKind === 'client' ? 'real' : clientKind,
          has_card: !!clean(d.card_id),
          updated_at: clean(d.updated_at),
        });
      }
    }
  }
  return items;
}

function counts(items) {
  const tally = key => items.reduce((acc, item) => { const k = key(item); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  return {
    total: items.length,
    by_source_kind_status: tally(i => `${i.source}/${i.kind}/${i.status}`),
    by_client_kind: tally(i => i.client_kind),
    by_client_kind_source_kind_status: tally(i => `${i.client_kind}/${i.source}/${i.kind}/${i.status}`),
    with_card: items.filter(i => i.has_card).length,
  };
}

async function read(table, select, filter, orderBy) {
  const rows = [];
  const pageSize = 1000;
  for (let page = 0; page < 100; page++) {
    const url = `${SUPA_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}${filter ? '&' + filter : ''}&order=${orderBy || 'id'}.asc&limit=${pageSize}&offset=${page * pageSize}`;
    const response = await fetch(url, { headers: { apikey: READ_KEY, Authorization: `Bearer ${READ_KEY}`, Accept: 'application/json' } });
    if (!response.ok) throw new Error(`${table} read failed: HTTP ${response.status}`);
    const batch = await response.json();
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
  throw new Error(`${table} read exceeded its page cap`);
}

async function gather() {
  const cards = [];
  const ids = new Set();
  for (const s of SOURCES) {
    const rows = await read(s.table, 'id,client,status,video_deliverable_id,graphic_deliverable_id', 'status=eq.Archived');
    cards.push({ source: s.source, surface: s.surface, rows });
    rows.forEach(r => COMPONENTS.forEach(({ column }) => { if (clean(r[column])) ids.add(clean(r[column])); }));
  }
  const deliverables = [];
  const list = [...ids];
  for (let i = 0; i < list.length; i += 150) {
    const chunk = list.slice(i, i + 150).map(encodeURIComponent).join(',');
    deliverables.push(...await read('deliverables', 'id,status,card_id,client_slug,updated_at', `id=in.(${chunk})`));
  }
  const clients = await read('clients', 'slug,kind', '', 'slug');
  return { cards, deliverables, clients };
}

async function parkOne(item, runId) {
  const staffKey = clean(process.env.SYNCVIEW_STAFF_KEY);
  const actor = clean(process.env.SYNCVIEW_ACTOR);
  const response = await fetch(WRITE_URL, {
    method: 'POST',
    headers: {
      apikey: READ_KEY, Authorization: `Bearer ${READ_KEY}`, 'Content-Type': 'application/json',
      'x-syncview-key': staffKey, 'x-syncview-actor': actor, 'x-syncview-source': 'archived-work-items-park',
    },
    body: JSON.stringify({
      operation: 'status', surface: item.surface, entity: 'deliverable', id: item.id, status: 'backlog',
      // Deterministic per item and run: a re-run of the same run is an exact
      // replay, never a second change.
      request_id: `archived-park:${runId}:${item.id}`,
      source_edited_at: new Date().toISOString(),
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    const error = new Error(clean(body.error || body.code) || `http_${response.status}`);
    error.code = clean(body.error || body.code) || `http_${response.status}`;
    throw error;
  }
  return body;
}

async function journalHas(id, since) {
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!key) return null;
  const url = `${SUPA_URL}/rest/v1/card_change_journal?select=id&relation_name=eq.deliverables`
    + `&entity_key_after->>id=eq.${encodeURIComponent(id)}&recorded_at=gte.${encodeURIComponent(since)}&limit=1`;
  const response = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' } });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

async function main(argv) {
  const apply = argv.includes('--apply');
  const data = await gather();
  const items = plan(data);
  const summary = { mode: apply ? 'apply' : 'dry_run', archived_cards: Object.fromEntries(data.cards.map(c => [c.source, c.rows.length])), open_work_items: counts(items) };
  if (!apply) { console.log(JSON.stringify(summary, null, 2)); return summary; }

  if (!clean(process.env.SYNCVIEW_STAFF_KEY) || !clean(process.env.SYNCVIEW_ACTOR)) {
    throw new Error('--apply needs SYNCVIEW_STAFF_KEY and SYNCVIEW_ACTOR (the guarded gateway path)');
  }
  const runId = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const started = new Date().toISOString();
  const outcome = { parked: 0, failed: {}, journal_confirmed: 0, journal_missing: 0, journal_unchecked: 0 };
  for (const item of items) {
    try {
      await parkOne(item, runId);
      outcome.parked += 1;
      const journaled = await journalHas(item.id, started);
      if (journaled === true) outcome.journal_confirmed += 1;
      else if (journaled === false) outcome.journal_missing += 1;
      else outcome.journal_unchecked += 1;
    } catch (error) {
      const code = clean(error && error.code).replace(/[^a-z0-9_]/gi, '').slice(0, 60) || 'error';
      outcome.failed[code] = (outcome.failed[code] || 0) + 1;
    }
  }
  const result = Object.assign(summary, { run: outcome });
  console.log(JSON.stringify(result, null, 2));
  if (Object.keys(outcome.failed).length || outcome.journal_missing) process.exitCode = 1;
  return result;
}

module.exports = { plan, counts, main, OPEN_STATUSES };

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    // The message is ours (a fixed code or an HTTP status); nothing live.
    console.error('archived-work-items-park failed: ' + clean(error && error.message).slice(0, 120));
    process.exit(1);
  });
}
