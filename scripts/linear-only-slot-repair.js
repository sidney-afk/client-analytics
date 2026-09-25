#!/usr/bin/env node
'use strict';
/*
 * Linear-only Calendar slots: find the ones an EXISTING SyncView deliverable
 * could be connected to, and propose that connection. NOT APPLIED.
 *
 * Since Linear was retired (owner + Lighthouse, 2026-09-24) a Calendar card's
 * video or thumbnail slot is "linked" only by its own deliverable id
 * (video_deliverable_id / graphic_deliverable_id). A slot that still holds an
 * old Linear URL but no deliverable id now reads as absent. Some of those may
 * name a Linear issue that was imported into SyncView as a deliverable and
 * simply never connected to the card; this finds them.
 *
 * READ-ONLY. It reads calendar_posts and production_deliverables_browser_v1
 * with the publishable key and never writes anything. It prints COUNTS only
 * (the repo and CI output are public); the per-card plan, with ids and the
 * guarded SQL a reviewer would run, goes to a local file named by --out, which
 * must be outside the repository. Applying is Lighthouse's call, test client
 * first.
 *
 * A slot is classified as:
 *   exact      exactly one deliverable for that Linear issue with the slot's
 *              team and client, origin 'calendar' (the Calendar crosswalk
 *              _prodCrosswalkMismatchFields compares), and not connected to
 *              a different card. Proposed.
 *   ambiguous  more than one same-team, same-client deliverable, free or
 *              taken. Not proposed; needs a person.
 *   taken      the only match is already connected to another card.
 *   unbound    the only match is free but its origin is not 'calendar', so
 *              connecting card_id alone would leave the crosswalk invalid.
 *              Not proposed; needs the binding contract, not this script.
 *   mismatch   a deliverable exists for the issue but is the other team or
 *              another client (for example a video slot holding its own
 *              thumbnail's Linear link). Not proposed.
 *   none       no SyncView deliverable exists for that Linear issue.
 *
 * "Current" (the default scope) means not archived, not posted, and dated on
 * or after the cutoff (default: 30 days before today). Undated slots are
 * counted separately and never proposed.
 *
 * Usage:
 *   SUPABASE_PUBLISHABLE_KEY=... node scripts/linear-only-slot-repair.js \
 *       [--client=<slug>] [--since=YYYY-MM-DD] [--out=/path/outside/repo.json]
 */
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co';
const SLOTS = [
  { comp: 'video', urlField: 'linear_issue_id', idField: 'video_deliverable_id', team: 'video' },
  { comp: 'graphic', urlField: 'graphic_linear_issue_id', idField: 'graphic_deliverable_id', team: 'graphics' },
];

const str = v => String(v == null ? '' : v).trim();
function linearIdentifier(url) {
  const m = str(url).match(/\/issue\/([A-Za-z]+-\d+)/);
  return m ? m[1].toUpperCase() : '';
}
function isoDaysAgo(days, now) {
  const d = new Date(now || Date.now());
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function classify(posts, deliverables, opts) {
  const o = opts || {};
  const since = o.since || isoDaysAgo(30, o.now);
  const byIdent = new Map();
  const byUrl = new Map();
  const push = (map, key, d) => { if (!key) return; if (!map.has(key)) map.set(key, []); map.get(key).push(d); };
  for (const d of deliverables || []) {
    push(byIdent, str(d.linear_identifier).toUpperCase(), d);
    push(byUrl, str(d.linear_issue_url).toLowerCase(), d);
  }
  const result = { since, slots: 0, undated: 0, current: 0, exact: [], ambiguous: [], taken: [], unbound: [], mismatch: [], none: [] };
  for (const p of posts || []) {
    if (str(p.status).toLowerCase() === 'archived') continue;
    if (o.client && str(p.client) !== o.client) continue;
    for (const slot of SLOTS) {
      const url = str(p[slot.urlField]);
      if (!url || str(p[slot.idField])) continue;
      result.slots++;
      const date = str(p.scheduled_date).slice(0, 10);
      if (!date) { result.undated++; continue; }
      if (str(p.status).toLowerCase() === 'posted' || date < since) continue;
      result.current++;
      const entry = { card_id: str(p.id), client: str(p.client), comp: slot.comp, id_field: slot.idField };
      const ident = linearIdentifier(url);
      const cands = (ident && byIdent.get(ident)) || byUrl.get(url.toLowerCase()) || [];
      const fits = cands.filter(d => str(d.team) === slot.team && str(d.client_slug) === entry.client);
      // Ambiguity is decided over ALL fitting candidates, free or taken: one
      // Linear issue behind two deliverables must never back a card by luck.
      if (!cands.length) result.none.push(entry);
      else if (!fits.length) result.mismatch.push(entry);
      else if (fits.length > 1) result.ambiguous.push(Object.assign(entry, { candidates: fits.map(d => str(d.id)) }));
      else {
        const d = fits[0];
        if (str(d.card_id) && str(d.card_id) !== entry.card_id) result.taken.push(entry);
        else if (str(d.origin) !== 'calendar') result.unbound.push(entry);
        else result.exact.push(Object.assign(entry, { deliverable_id: str(d.id), deliverable_card_id: str(d.card_id) }));
      }
    }
  }
  return result;
}

/* Guarded SQL for the reviewer. Each connection is ONE block that locks both
   rows, re-checks at apply time exactly the state this read saw -- the card
   (matched on its full key, client AND id, since bare ids repeat across
   clients) still has the slot empty, and the deliverable is still the same
   client and team, origin 'calendar', and unconnected or already this card's
   -- and raises, rolling the whole plan back, unless BOTH sides are still
   eligible. A one-sided crosswalk cannot be produced. */
function proposedSql(exact) {
  if (!exact.length) return '';
  const q = v => "'" + String(v).replace(/'/g, "''") + "'";
  const team = e => e.comp === 'graphic' ? 'graphics' : 'video';
  const blocks = exact.map(e => [
    '-- ' + e.comp + ' slot',
    'do $$ begin',
    '  perform 1 from public.calendar_posts where client = ' + q(e.client) + ' and id = ' + q(e.card_id)
      + ' and coalesce(' + e.id_field + ", '') = '' for update;",
    "  if not found then raise exception 'card slot no longer empty'; end if;",
    '  perform 1 from public.deliverables where id = ' + q(e.deliverable_id) + ' and client_slug = ' + q(e.client)
      + ' and team = ' + q(team(e)) + " and origin = 'calendar' and (card_id is null or card_id = " + q(e.card_id) + ') for update;',
    "  if not found then raise exception 'deliverable no longer eligible'; end if;",
    '  update public.calendar_posts set ' + e.id_field + ' = ' + q(e.deliverable_id)
      + ' where client = ' + q(e.client) + ' and id = ' + q(e.card_id) + ';',
    '  update public.deliverables set card_id = ' + q(e.card_id) + ' where id = ' + q(e.deliverable_id) + ';',
    'end $$;',
  ].join('\n'));
  return ['begin;'].concat(blocks, ['commit;']).join('\n\n');
}

function counts(list) {
  return { video: list.filter(x => x.comp === 'video').length, graphic: list.filter(x => x.comp === 'graphic').length };
}

async function readAll(key, table, select) {
  let rows = [];
  for (let offset = 0; ; offset += 1000) {
    const resp = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?select=' + select + '&order=id&limit=1000&offset=' + offset,
      { headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' } });
    if (!resp.ok) throw new Error(table + ' read ' + resp.status);
    const page = await resp.json();
    rows = rows.concat(page);
    if (page.length < 1000) return rows;
  }
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]; }));
  const key = str(process.env.SUPABASE_PUBLISHABLE_KEY);
  if (!key) { console.error('SUPABASE_PUBLISHABLE_KEY is not set'); process.exit(2); }
  if (args.out) {
    const repo = path.resolve(__dirname, '..');
    if (path.resolve(String(args.out)).startsWith(repo + path.sep)) {
      console.error('--out must be outside the repository: the plan carries card ids');
      process.exit(2);
    }
  }
  const posts = await readAll(key, 'calendar_posts',
    'id,client,status,scheduled_date,linear_issue_id,graphic_linear_issue_id,video_deliverable_id,graphic_deliverable_id');
  const dels = await readAll(key, 'production_deliverables_browser_v1',
    'id,team,client_slug,card_id,origin,linear_identifier,linear_issue_url');
  const r = classify(posts, dels, { client: args.client ? String(args.client) : '', since: args.since ? String(args.since) : '' });
  console.log('linear-only-slot-repair (NOT APPLIED, read-only)' + (args.client ? ' for one client' : ''));
  console.log('  linear-only slots, not archived: ' + r.slots + '  (undated, never proposed: ' + r.undated + ')');
  console.log('  current (not posted, dated on/after ' + r.since + '): ' + r.current);
  for (const k of ['exact', 'ambiguous', 'taken', 'unbound', 'mismatch', 'none']) {
    const c = counts(r[k]);
    console.log('  ' + k.padEnd(9) + ' video ' + c.video + '  graphic ' + c.graphic);
  }
  if (args.out) {
    fs.writeFileSync(String(args.out), JSON.stringify({ generated_at: new Date().toISOString(), applied: false, result: r, sql: proposedSql(r.exact) }, null, 1), { mode: 0o600 });
    console.log('  plan written (ids + guarded SQL) to the --out file');
  }
}

module.exports = { classify, proposedSql, linearIdentifier, isoDaysAgo };
if (require.main === module) main().catch(e => { console.error('linear-only-slot-repair failed:', e.message); process.exit(1); });
