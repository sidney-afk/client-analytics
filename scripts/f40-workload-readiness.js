#!/usr/bin/env node
'use strict';

/**
 * F40 — will the Workload lane survive the flip?
 *
 * READ-ONLY. Needs no secret: it reads the same publishable key and the same
 * safe projection the browser itself uses, so it measures exactly what a
 * designer's page would see.
 *
 * WHY THIS EXISTS. After F1 the Workload page stops asking the Linear gateway
 * for a team's due dates and workload weights and reads them natively instead
 * (index.html, wlFetchLinearMetadata: an issue routes native only when
 * `authority[team] === 'syncview'`). While both teams are Linear-authoritative
 * that branch is never taken, so EVERY defect in the native read is invisible
 * until the moment of the flip, when it appears for the whole team at once.
 * Two were found that way on 2026-08-10, after the code had been "done" for
 * weeks:
 *
 *   - 133 of 319 active graphics sub-issues had `workload_labels_complete =
 *     false`, because b1-linear-backfill fetched issues without their `labels`
 *     relation and then replaced `linear_raw` wholesale, erasing the relation
 *     linear-inbound had written.
 *   - 9 more had no row in the projection at all.
 *
 * Both are now handled per row rather than by discarding the read, so neither
 * can blank a whole team's deadlines. They still cost the affected rows their
 * due date and their editability, which is why this stays a gate and not a
 * note: a designer whose deadline silently vanished on flip day will not file a
 * bug, they will lose the deadline.
 *
 * PUBLIC-REPO RULE (F64): counts and Linear identifiers only. No client name,
 * slug, or any other client-identifying value is ever printed.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PAGE = 1000;
const CHUNK = 100;

/* OWNER-ACCEPTED FLOORS. The gate is "at or under the floor", not "zero".
 *
 * graphics: 5 — OWNER RULING 2026-08-11 (canonical record:
 * docs/ops/PRE_FLIP_HEALTH_CHECK.md item 10). The five are GRA-4260, GRA-4261,
 * GRA-4262, GRA-4263 and GRA-4264 — real sub-issues of a current roster client
 * that B1 archives BY DESIGN: its operational filter is
 * `linked || alreadyTracked || created >= cutoff` and all three are false
 * (created 2025-06-16, outside the 12-month window, no card link, no row). No
 * refresh at any changed_since will ever import them. All five have no due
 * date set, so nothing disappears at F1; the only forfeited capability is
 * ADDING a deadline to them from the Workload page. The owner accepted that
 * cost. 5 is PASS; anything ABOVE 5 is a real FAIL — a rise means new damage,
 * not the accepted residue.
 *
 * Before this constant existed the script printed a red ❌ at the ruled-PASS
 * state, contradicting the canonical health check on the eve of the flip —
 * exactly the symbol-vs-ruling mismatch that trains a reader to discount the
 * gate's own output. The floor lives HERE, next to the exit code, so the
 * symbol and the ruling can never drift apart again.
 *
 * FLOOR RETIRED 2026-08-23 — the premise expired, so the number had to go.
 * The 2026-08-11 ruling accepted those five on one stated basis: "All five have
 * no due date set, so nothing disappears at F1; the only forfeited capability is
 * ADDING a deadline to them from the Workload page." On 2026-08-23 Backlog
 * stopped counting as active work in Workload (owner ruling), and all five are
 * Backlog -- so the page no longer loads them, this gate no longer audits them,
 * and they can no longer contribute to `unprovable_total`. The forfeited
 * capability is now forfeited immediately rather than at F1, which is a real
 * cost and is recorded with that ruling; the FLOOR, however, is now an empty
 * allowance, and an empty allowance is a place for five FUTURE graphics
 * failures to hide by count alone. Measured the same day: graphics 6 unprovable
 * -> 0, video 2 -> 0, and every one of those 8 rows was Backlog. The gate is
 * green with no floor at all, so the honest constant is no floor at all.
 *
 * The ruling itself is not retracted and its identifiers stay named above: a
 * future reader needs to see WHICH five were accepted and why the allowance
 * stopped being needed, not just that a number vanished. If Backlog ever
 * returns to Workload, this is the comment that says what to reinstate. */
const ACCEPTED_FLOORS = {};

function readPublicConfig() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_ANON_KEY || '').trim();
  if (url && key) return { url: url.replace(/\/+$/, ''), key };
  // Fall back to the values the shipped browser uses, so this runs with no
  // configuration at all and cannot drift from what a designer would see.
  const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const urlMatch = source.match(/const CAL_SUPABASE_URL\s*=\s*'([^']+)'/);
  const keyMatch = source.match(/const CAL_SUPABASE_ANON_KEY\s*=\s*'([^']+)'/);
  if (!urlMatch || !keyMatch) throw new Error('could not read the public Supabase config from index.html');
  return { url: urlMatch[1].replace(/\/+$/, ''), key: keyMatch[1] };
}

const CONFIG = readPublicConfig();

/* The gate must audit exactly the population the Workload page loads, no more
 * and no less. wlFetchLinearMetadata filters active issues through
 * `wlIsActiveStatus` and `wlIsAllowedClient` (index.html) before anything
 * reaches the native reader, so an issue that fails either filter can never
 * produce the failure this gate predicts. Counting it anyway produces a
 * permanent nonzero reading for work no designer can see — a gate nobody can
 * ever satisfy, which is the failure PRE_FLIP_HEALTH_CHECK.md exists to avoid.
 * These lists are read from the shipped app so they cannot drift from it. */
function readBrowserContract() {
  const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const parked = source.match(/const WL_PARKED_STATUSES = new Set\(\[([\s\S]*?)\]\);/);
  const names = source.match(/const WL_CLIENT_NAMES = \[([\s\S]*?)\];/);
  // The terminal STATUS TYPES were hard-coded here while the parked list and
  // the client names were read from the app -- so the one filter nobody was
  // reading drifted. On 2026-08-22 the app learned that `duplicate` is terminal
  // (it always was, everywhere else) and this gate went on counting a closed
  // duplicate as a row that would lose its deadline. Read it from the same
  // source as the rest, and the drift cannot happen again.
  const active = source.match(/function wlIsActiveStatus\([\s\S]*?\n {4}\}/);
  if (!parked || !names || !active) throw new Error('could not read the Workload filters from index.html');
  const strings = (block) => (block.match(/'((?:[^'\\]|\\.)*)'/g) || [])
    .map((quoted) => quoted.slice(1, -1).replace(/\\'/g, "'"));
  const terminalTypes = new Set(
    (active[0].match(/t === '([a-z]+)'/g) || []).map((clause) => clause.slice(7, -1)),
  );
  if (!terminalTypes.size) throw new Error('could not read the terminal status types from index.html');
  return {
    parkedStatuses: new Set(strings(parked[1])),
    seedClients: strings(names[1]),
    terminalTypes,
  };
}

const CONTRACT = readBrowserContract();

/* index.html wlNormalizeClient, ported verbatim. */
function normalizeClient(value) {
  if (!value) return '';
  let text = String(value).toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  text = text.replace(/^dr\.?\s+/, '');
  text = text.replace(/\s+(?:and|&)\s+/g, '&');
  text = text.replace(/[^a-z0-9&]+/g, '');
  return text;
}

/* index.html wlIsActiveStatus, with BOTH of its lists read from the app rather
 * than restated here. A parked or terminal issue is never fetched, so it can
 * never break the page. */
function isActiveStatus(statusType, status) {
  const type = String(statusType || '').toLowerCase();
  if (CONTRACT.terminalTypes.has(type)) return false;
  return !CONTRACT.parkedStatuses.has(String(status || '').trim().toLowerCase());
}

async function rest(pathAndQuery) {
  const response = await fetch(`${CONFIG.url}/rest/v1/${pathAndQuery}`, {
    headers: {
      apikey: CONFIG.key,
      Authorization: `Bearer ${CONFIG.key}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`GET ${pathAndQuery.split('?')[0]} -> HTTP ${response.status}`);
  }
  const body = await response.json();
  if (!Array.isArray(body)) throw new Error(`GET ${pathAndQuery.split('?')[0]} -> not an array`);
  return body;
}

async function restAll(table, query) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await rest(`${table}?${query}&limit=${PAGE}&offset=${offset}`);
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

/* The browser's own bucket rule (wlMetadataTeamBucket): a key/name conflict is
 * not a team, and an unrecognized team fails closed. */
function teamBucket(teamKey, teamName) {
  const key = String(teamKey || '').trim().toUpperCase();
  const name = String(teamName || '').trim().toLowerCase();
  const keyBucket = key === 'VID' ? 'video' : key === 'GRA' ? 'graphics' : null;
  const nameBucket = name === 'video' ? 'video' : name === 'graphics' ? 'graphics' : null;
  if (keyBucket && nameBucket && keyBucket !== nameBucket) return null;
  return keyBucket || nameBucket || null;
}

function validRfc3339(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) return false;
  return Number.isFinite(Date.parse(text));
}

async function auditTeam(team, allowedClients) {
  const issues = await restAll(
    'workload_issues',
    'active=eq.true&is_sub_issue=eq.true'
    + '&select=id,identifier,team_key,team_name,client_name,status,status_type',
  );
  const onTeam = issues.filter(row => teamBucket(row.team_key, row.team_name) === team);
  // Mirror the browser's two pre-fetch filters, in its order.
  const parked = onTeam.filter(row => !isActiveStatus(row.status_type, row.status));
  const working = onTeam.filter(row => isActiveStatus(row.status_type, row.status));
  const offRoster = working.filter(row => !allowedClients.has(normalizeClient(row.client_name)));
  const mine = working.filter(row => allowedClients.has(normalizeClient(row.client_name)));

  const ids = [...new Set(mine.map(row => String(row.id || '').trim()).filter(Boolean))];
  const identifierById = new Map(mine.map(row => [String(row.id || '').trim(), String(row.identifier || '')]));

  const found = new Map();
  const duplicated = new Set();
  const select = 'id,identifier,client_slug,team,due_date,updated_at,linear_issue_uuid,workload_labels_complete,workload_labels';
  for (let index = 0; index < ids.length; index += CHUNK) {
    const chunk = ids.slice(index, index + CHUNK);
    const inFilter = `(${chunk.map(id => JSON.stringify(id)).join(',')})`;
    const page = await rest(
      `production_deliverables_browser_v1?select=${select}`
      + `&linear_issue_uuid=in.${encodeURIComponent(inFilter)}&limit=${chunk.length + 1}`,
    );
    for (const row of page) {
      const uuid = String(row.linear_issue_uuid || '').trim();
      if (!uuid) continue;
      if (found.has(uuid)) duplicated.add(uuid);
      found.set(uuid, row);
    }
  }

  const missing = [];
  const labelIncomplete = [];
  const targetUnprovable = [];
  const ambiguous = [];
  for (const id of ids) {
    const row = found.get(id);
    if (!row) { missing.push(identifierById.get(id) || id); continue; }
    if (duplicated.has(id)) { ambiguous.push(identifierById.get(id) || id); continue; }
    // The browser's native-target proof: without every one of these the row
    // has no write route even when its labels are sound. The team test is
    // EQUALITY with the team being audited, not merely "a known team" —
    // wlAdoptLinearMetadata rejects a target whose team differs from the
    // mirrored issue's (index.html:14145), and wlDueWriteRoute withholds the
    // route on the same mismatch. Accepting "either known team" here would let
    // a mislinked or mid-move row read as provable and the gate report READY
    // for a row the page will refuse.
    if (!String(row.id || '').trim()
        || !String(row.client_slug || '').trim()
        || String(row.team || '') !== team
        || !validRfc3339(row.updated_at)) {
      targetUnprovable.push(identifierById.get(id) || id);
      continue;
    }
    if (row.workload_labels_complete !== true || !Array.isArray(row.workload_labels)) {
      labelIncomplete.push(identifierById.get(id) || id);
    }
  }

  const unprovable = missing.length + labelIncomplete.length + targetUnprovable.length + ambiguous.length;
  return {
    team,
    active_sub_issues: ids.length,
    // Reported so the audited population is explainable rather than asserted.
    excluded_parked_or_terminal: parked.length,
    excluded_off_roster: offRoster.length,
    resolved_in_projection: found.size,
    unprovable_total: unprovable,
    provable_total: ids.length - unprovable,
    missing_from_projection: missing.length,
    label_state_incomplete: labelIncomplete.length,
    native_target_unprovable: targetUnprovable.length,
    ambiguous_projection_rows: ambiguous.length,
    sample: {
      missing_from_projection: missing.slice(0, 10),
      label_state_incomplete: labelIncomplete.slice(0, 10),
      native_target_unprovable: targetUnprovable.slice(0, 10),
      ambiguous_projection_rows: ambiguous.slice(0, 10),
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const teamArg = (args.find(value => value.startsWith('--team=')) || '--team=graphics').split('=')[1];
  const teams = teamArg === 'all' ? ['graphics', 'video'] : [teamArg];
  for (const team of teams) {
    if (!['graphics', 'video'].includes(team)) {
      console.error(`unknown --team=${team} (expected graphics, video, or all)`);
      process.exit(2);
    }
  }

  /* WL_CLIENT_NAMES is a hardcoded seed UNION the Clients Info sheet, and the
   * sheet is not reachable from here. Take the union of the seed and the live
   * Supabase rosters instead: a SUPERSET of the browser's allowlist, so this
   * gate can only ever audit MORE than the page loads, never less. A gate that
   * under-reports is the one failure mode a pre-flight must not have. */
  const allowedClients = new Set(CONTRACT.seedClients.map(normalizeClient).filter(Boolean));
  for (const key of ['calendar_upsert_ef_clients', 'sample_review_ef_clients', 'settings_ef_clients']) {
    const flag = await rest(`syncview_runtime_flags?select=value&key=eq.${key}`);
    const value = flag[0] && flag[0].value;
    const list = value && Array.isArray(value.clients) ? value.clients : (Array.isArray(value) ? value : []);
    for (const client of list) {
      const slug = normalizeClient(client);
      if (slug) allowedClients.add(slug);
    }
  }

  const results = [];
  for (const team of teams) results.push(await auditTeam(team, allowedClients));

  if (asJson) {
    console.log(JSON.stringify({ schema: 'syncview.f40-workload-readiness.v1', results }, null, 2));
  } else {
    for (const result of results) {
      const floor = ACCEPTED_FLOORS[result.team] || 0;
      const verdict = result.unprovable_total <= floor ? 'READY' : 'NOT READY';
      console.log(`\nF40 workload readiness — ${result.team}: ${verdict}`);
      console.log(`  audited (what the page loads) ${result.active_sub_issues}`);
      console.log(`    excluded, parked/terminal  ${result.excluded_parked_or_terminal}`);
      console.log(`    excluded, off roster       ${result.excluded_off_roster}`);
      console.log(`  provable after the flip      ${result.provable_total}`);
      console.log(`  UNPROVABLE                   ${result.unprovable_total}${floor ? ` (accepted floor ${floor})` : ''}`);
      console.log(`    missing from projection    ${result.missing_from_projection}`);
      console.log(`    label state incomplete     ${result.label_state_incomplete}`);
      console.log(`    native target unprovable   ${result.native_target_unprovable}`);
      console.log(`    ambiguous projection rows  ${result.ambiguous_projection_rows}`);
      for (const [reason, sample] of Object.entries(result.sample)) {
        if (sample.length) console.log(`    e.g. ${reason}: ${sample.join(', ')}`);
      }
      if (result.unprovable_total > floor) {
        console.log('  Each unprovable row loses its due date and its editability at F1.');
        // The repair used to read "run the B1 refresh over a FULL window".
        // That lane no longer exists: `mode=full` refuses to apply unless a
        // live flag read says BOTH teams are Linear-authoritative, and graphics
        // has been SyncView since 2026-08-16. Prescribing it sends the operator
        // to a dispatch that cannot write. Use the incremental lane with an
        // explicit `changed_since` reaching back past the affected rows' last
        // Linear update — that path applies, and it is the one that re-reads an
        // issue through the GraphQL query WITH its labels relation.
        console.log('  Repair: dispatch b1-linear-incremental-refresh.yml with mode=incremental,');
        console.log('  apply ON, and changed_since set BEFORE these rows last changed in Linear.');
        console.log('  (mode=full cannot apply post-graphics-flip; it needs BOTH teams on Linear.)');
        console.log('  Do it BEFORE F1: B1 refuses to write a team it does not own, so it cannot');
        console.log('  repair this team afterwards.');
      }
    }
  }

  const blocked = results.filter(result => result.unprovable_total > (ACCEPTED_FLOORS[result.team] || 0));
  if (blocked.length) {
    console.error(`\nF40 gate: ${blocked.map(r => `${r.team}=${r.unprovable_total}`).join(' ')} unprovable row(s) above the accepted floor ❌`);
    process.exit(1);
  }
  const atFloor = results.filter(result => result.unprovable_total > 0);
  if (atFloor.length) {
    console.log(`\nF40 gate: ${atFloor.map(r => `${r.team}=${r.unprovable_total}`).join(' ')} unprovable row(s), at or under the owner-accepted floor ✅ PASS`);
  } else {
    console.log('\nF40 gate: every active sub-issue is provable natively ✅');
  }
}

main().catch(error => {
  console.error(`f40-workload-readiness failed: ${error && error.message}`);
  process.exit(2);
});
