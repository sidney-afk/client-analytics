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

async function auditTeam(team) {
  const issues = await restAll(
    'workload_issues',
    'active=eq.true&is_sub_issue=eq.true&select=id,identifier,team_key,team_name',
  );
  const mine = issues.filter(row => teamBucket(row.team_key, row.team_name) === team);
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
    // has no write route even when its labels are sound.
    if (!String(row.id || '').trim()
        || !String(row.client_slug || '').trim()
        || !['video', 'graphics'].includes(String(row.team || ''))
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

  const results = [];
  for (const team of teams) results.push(await auditTeam(team));

  if (asJson) {
    console.log(JSON.stringify({ schema: 'syncview.f40-workload-readiness.v1', results }, null, 2));
  } else {
    for (const result of results) {
      const verdict = result.unprovable_total === 0 ? 'READY' : 'NOT READY';
      console.log(`\nF40 workload readiness — ${result.team}: ${verdict}`);
      console.log(`  active sub-issues            ${result.active_sub_issues}`);
      console.log(`  provable after the flip      ${result.provable_total}`);
      console.log(`  UNPROVABLE                   ${result.unprovable_total}`);
      console.log(`    missing from projection    ${result.missing_from_projection}`);
      console.log(`    label state incomplete     ${result.label_state_incomplete}`);
      console.log(`    native target unprovable   ${result.native_target_unprovable}`);
      console.log(`    ambiguous projection rows  ${result.ambiguous_projection_rows}`);
      for (const [reason, sample] of Object.entries(result.sample)) {
        if (sample.length) console.log(`    e.g. ${reason}: ${sample.join(', ')}`);
      }
      if (result.unprovable_total) {
        console.log('  Each unprovable row loses its due date and its editability at F1.');
        console.log('  Repair: run the B1 refresh over a full window BEFORE F1 — B1 refuses to');
        console.log('  write a team it does not own, so it cannot repair graphics afterwards.');
      }
    }
  }

  const blocked = results.filter(result => result.unprovable_total > 0);
  if (blocked.length) {
    console.error(`\nF40 gate: ${blocked.map(r => `${r.team}=${r.unprovable_total}`).join(' ')} unprovable row(s) ❌`);
    process.exit(1);
  }
  console.log('\nF40 gate: every active sub-issue is provable natively ✅');
}

main().catch(error => {
  console.error(`f40-workload-readiness failed: ${error && error.message}`);
  process.exit(2);
});
