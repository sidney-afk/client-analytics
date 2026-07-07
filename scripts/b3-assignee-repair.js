'use strict';
/*
 * Track B B3 Stage 3: unknown-assignee repair helper.
 *
 * Default mode is DRY-RUN. It inspects reconciler v2 repair rows, maps unknown
 * Linear users to existing team_members rows by email/name, and only null-fills
 * team_members.linear_user_id plus email when that email is currently blank.
 *
 *   node scripts/b3-assignee-repair.js
 *   APPLY=true CAP=20 node scripts/b3-assignee-repair.js
 */
const fs = require('fs');
const path = require('path');
const { clean } = require('./linear-deliverables-reconcile-lib');
const { buildPlan, loadLiveData } = require('./linear-deliverables-reconcile');

const args = new Map(process.argv.slice(2).map(a => {
  const m = String(a).match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] == null ? '1' : m[2]] : [a, '1'];
}));

const APPLY = process.argv.includes('--apply') || /^(1|true|yes)$/i.test(process.env.APPLY || '');
const SAFETY_CAP = Number(process.env.CAP || args.get('cap') || 20);
const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/$/, '');
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const DETAILS_JSON = args.get('details-json') || '';

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function lower(v) {
  return clean(v).toLowerCase();
}

function normName(v) {
  return lower(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function uniqueBy(arr, keyFn) {
  const out = [];
  const seen = new Set();
  for (const item of arr || []) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function countBy(rows, keyFn) {
  const out = {};
  for (const row of rows || []) {
    const key = keyFn(row) || 'unknown';
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function buildMemberIndexes(members) {
  const byEmail = new Map();
  const byName = new Map();
  for (const m of members || []) {
    const email = lower(m.email);
    if (email) {
      if (!byEmail.has(email)) byEmail.set(email, []);
      byEmail.get(email).push(m);
    }
    const name = normName(m.name);
    if (name) {
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(m);
    }
  }
  return { byEmail, byName };
}

function issueForResult(data, result) {
  const deliverable = (data.deliverables || []).find(d => clean(d.id) === clean(result.id));
  if (!deliverable) return null;
  return data.linearIssues.get(clean(deliverable.linear_issue_uuid)) || null;
}

function chooseMember(user, indexes) {
  const byEmail = indexes.byEmail.get(lower(user && user.email)) || [];
  if (byEmail.length === 1) return { member: byEmail[0], match: 'email' };
  if (byEmail.length > 1) return { insertInactive: true, reason: 'multiple_email_matches' };
  const byName = indexes.byName.get(normName(user && user.name)) || [];
  if (byName.length === 1) return { member: byName[0], match: 'name' };
  if (byName.length > 1) return { insertInactive: true, reason: 'multiple_name_matches' };
  return { insertInactive: true, reason: 'no_existing_member_match' };
}

function planAssigneeRepairs(data) {
  const plan = buildPlan(data);
  const indexes = buildMemberIndexes(data.members || []);
  const repairResults = plan.results.filter(r => r.repairs.some(x => x.reason === 'unknown_assignee'));
  const users = uniqueBy(repairResults.map(r => {
    const issue = issueForResult(data, r);
    return {
      result: r,
      user: issue && issue.assignee || null,
      team_key: clean(issue && issue.team && issue.team.key),
    };
  }).filter(x => x.user && clean(x.user.id)), x => clean(x.user.id));

  const planned = [];
  const inserts = [];
  const skipped = [];
  for (const item of users) {
    const user = item.user;
    const choice = chooseMember(user, indexes);
    if (choice.conflict) {
      skipped.push({ reason: choice.conflict, linear_user_id: clean(user.id), team_key: item.team_key });
      continue;
    }
    if (choice.insertInactive) {
      const team = clean(item.team_key).toUpperCase() === 'GRA' ? 'graphics' : 'video';
      const name = clean(user.name || user.email || user.id);
      if (indexes.byName.get(normName(name)) && indexes.byName.get(normName(name)).some(m => clean(m.role) === 'editor' && clean(m.team) === team)) {
        skipped.push({ reason: 'insert_name_would_conflict', linear_user_id: clean(user.id), team_key: item.team_key });
        continue;
      }
      inserts.push({
        name,
        email: clean(user.email) || null,
        role: 'editor',
        team,
        active: false,
        linear_user_id: clean(user.id),
        reason: choice.reason,
      });
      continue;
    }
    const member = choice.member;
    if (clean(member.linear_user_id) && clean(member.linear_user_id) !== clean(user.id)) {
      skipped.push({ reason: 'existing_different_linear_user_id', member_id: clean(member.id), team_key: item.team_key });
      continue;
    }
    const patch = {};
    if (!clean(member.linear_user_id)) patch.linear_user_id = clean(user.id);
    if (!clean(member.email) && clean(user.email)) patch.email = clean(user.email);
    if (!Object.keys(patch).length) {
      skipped.push({ reason: 'already_linked', member_id: clean(member.id), team_key: item.team_key });
      continue;
    }
    planned.push({
      member_id: clean(member.id),
      team: clean(member.team),
      role: clean(member.role),
      active: member.active === true,
      match: choice.match,
      patch,
    });
  }

  return {
    reconciler_summary: plan.summary,
    repair_rows: repairResults.length,
    distinct_users: users.length,
    planned,
    inserts,
    skipped,
    private_users: users.map(item => ({
      id: clean(item.user.id),
      name: clean(item.user.name),
      email: clean(item.user.email),
      team_key: item.team_key,
    })),
  };
}

function summarizeRepairPlan(plan) {
  const plannedRows = [...(plan.planned || []), ...(plan.inserts || [])];
  return {
    repair_rows: plan.repair_rows,
    distinct_users: plan.distinct_users,
    planned_updates: plan.planned.length,
    planned_inserts: plan.inserts.length,
    skipped: plan.skipped.length,
    planned_by_role_team: countBy(plannedRows, r => `${r.team || 'unknown'}:${r.role || 'unknown'}:${r.active ? 'active' : 'inactive'}`),
    skipped_by_reason: countBy(plan.skipped, r => r.reason),
  };
}

async function supabasePatchMember(id, patch) {
  if (!SUPA_KEY) fail('SUPABASE_SERVICE_ROLE_KEY is required');
  const resp = await fetch(`${SUPA_URL}/rest/v1/team_members?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(patch),
  });
  if (!resp.ok) throw new Error(`Supabase team_members patch HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
}

async function supabaseInsertMembers(rows) {
  if (!rows.length) return [];
  if (!SUPA_KEY) fail('SUPABASE_SERVICE_ROLE_KEY is required');
  const payload = rows.map(r => ({
    name: r.name,
    email: r.email,
    role: r.role,
    team: r.team,
    active: r.active,
    linear_user_id: r.linear_user_id,
  }));
  const resp = await fetch(`${SUPA_URL}/rest/v1/team_members`, {
    method: 'POST',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`Supabase team_members insert HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
  return resp.json();
}

async function supabaseInsert(table, rows) {
  if (!rows.length) return [];
  const resp = await fetch(`${SUPA_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(rows),
  });
  if (!resp.ok) throw new Error(`Supabase insert ${table} HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
  return resp.json();
}

async function applyRepairPlan(plan) {
  if (!APPLY) return { attempted: 0, skipped: plan.planned.length + plan.inserts.length };
  const total = plan.planned.length + plan.inserts.length;
  if (total > SAFETY_CAP) {
    throw new Error(`Refusing to apply ${total} assignee repair(s); cap is ${SAFETY_CAP}`);
  }
  let attempted = 0;
  for (const item of plan.planned) {
    await supabasePatchMember(item.member_id, item.patch);
    attempted++;
  }
  const inserted = await supabaseInsertMembers(plan.inserts || []);
  attempted += inserted.length;
  await supabaseInsert('deliverable_events', [{
    client_slug: '_system',
    action: 'b3_assignee_repair',
    source: 'reconcile',
    actor: 'codex-b3-stage3',
    payload: {
      dry_run: false,
      applied: attempted,
      inserted: inserted.length,
      summary: summarizeRepairPlan(plan),
    },
  }]);
  return { attempted, skipped: 0 };
}

function writeDetails(file, plan, summary, apply) {
  if (!file) return;
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(path.resolve(file), JSON.stringify({ summary, apply, plan }, null, 2));
}

async function main() {
  const data = await loadLiveData();
  const plan = planAssigneeRepairs(data);
  const summary = summarizeRepairPlan(plan);
  const apply = await applyRepairPlan(plan);
  writeDetails(DETAILS_JSON, plan, summary, apply);
  console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', summary, apply }, null, 2));
}

if (require.main === module) {
  main().catch(err => {
    console.error(err && err.stack || err && err.message || String(err));
    process.exit(1);
  });
}

module.exports = {
  normName,
  planAssigneeRepairs,
  summarizeRepairPlan,
};
