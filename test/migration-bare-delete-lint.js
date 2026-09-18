'use strict';
/*
 * A bare `delete from <table>;` inside a routine body cannot run on a Supabase
 * API connection.
 *
 * WHAT THIS GUARDS, AND WHY A FIXTURE COULD NOT.
 *
 * Supabase loads the `safeupdate` guard for the role PostgREST connects as. It
 * rejects any DELETE or UPDATE whose plan carries no qualifier, with SQLSTATE
 * 21000 "DELETE requires a WHERE clause". It applies to statements a routine
 * runs on that connection just as much as to statements the client sends, and
 * it does not exempt a temporary table the routine created itself.
 *
 * `production_native_calendar_status_backfill` shipped with two such statements
 * on 2026-09-18 and refused every live call, in dry-run as well as apply, while
 * 38 disposable-cluster assertions stayed green: a plain PostgreSQL 17 has no
 * guard loaded and no PostgREST in front of it, so the statement is legal
 * there. The lane cannot be fixed by adding another assertion to it -- the
 * difference is the connection, not the SQL -- so the pattern is caught by
 * reading the committed bytes instead.
 *
 * SCOPE. Every routine body in every migration and Edge Function SQL file, not
 * only the ones granted to a role: a trigger function's body runs on whatever
 * connection fired it, which for an API write is the guarded one.
 *
 * Run: node test/migration-bare-delete-lint.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const DIRS = ['migrations', 'supabase'];

/* A statement is bare when it is a DELETE or UPDATE whose only clauses are the
 * target and (for UPDATE) a SET list -- no WHERE anywhere before the
 * terminating semicolon. Matched across newlines, because a wrapped statement
 * is exactly as illegal as a single-line one.
 *
 * The word has to START a statement. `on conflict ... do update set` and
 * `for update skip locked` both contain the word and neither is a bare UPDATE;
 * an unanchored version of this reported 19 such lines across the repo as
 * failures, which is how the anchor got here. So the match must follow a
 * semicolon, a block opener, or the start of the body. */
const BARE = /(?:^|;|\bbegin\b|\bthen\b|\belse\b|\bloop\b|\bdeclare\b)\s*(delete\s+from|update)\s+(?:only\s+)?([a-z_][a-z0-9_$.]*)((?:(?!\bwhere\b)[^;])*);/gis;

/* Superseded definitions. Each entry must name a LATER file that redefines the
 * same routine without the pattern -- proven below, not taken on trust. An
 * applied migration is a historical record and is never edited, so the only
 * honest way to clear one is to replace the routine in a new file. */
const SUPERSEDED = [{
  file: 'migrations/2026-09-18-native-calendar-status-bridge.sql',
  routine: 'production_native_calendar_status_backfill',
  supersededBy: 'migrations/2026-09-18-native-calendar-backfill-temp-table-clear.sql',
  note: 'applied live 22:38Z 2026-09-18; the backfill half refused with 21000 until the file below',
}];

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.sql')) out.push(p);
  }
  return out;
}

/* Comments are stripped before the scan. The bodies here explain themselves at
 * length, and prose about "any DELETE or UPDATE whose plan..." is not a
 * statement — the first draft of this lint matched exactly that and reported a
 * clean file as dirty. */
function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/* Routine bodies only. A bare delete in a plain migration statement is the
 * author's own one-off run on a superuser connection and is not what broke;
 * this is about code that LATER runs as somebody's API call. */
function routineBodies(sql) {
  const bodies = [];
  const re = /create\s+(?:or\s+replace\s+)?function\s+([a-z_][a-z0-9_$.]*)[\s\S]*?as\s+(\$[a-z_]*\$)([\s\S]*?)\2\s*;/gi;
  let m;
  while ((m = re.exec(sql))) bodies.push({ routine: m[1].replace(/^public\./i, ''), body: m[3], scan: stripComments(m[3]) });
  return bodies;
}

const files = [];
for (const d of DIRS) files.push(...walk(path.join(ROOT, d)));
assert.ok(files.length > 0, 'found no SQL to lint — the walk is wrong, not the repo');

const findings = [];
let bodiesSeen = 0;
for (const abs of files) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  for (const { routine, scan } of routineBodies(fs.readFileSync(abs, 'utf8'))) {
    bodiesSeen++;
    BARE.lastIndex = 0;
    let m;
    while ((m = BARE.exec(scan))) {
      findings.push({ file: rel, routine, statement: m[0].replace(/\s+/g, ' ').trim() });
    }
  }
}

assert.ok(bodiesSeen > 5, `only ${bodiesSeen} routine bodies parsed — the body regex is not matching`);

/* Every superseded entry must be real: the pattern is genuinely there, the
 * named later file genuinely redefines that routine, and that redefinition is
 * genuinely clean. An entry that stops being true stops exempting anything. */
const exempt = new Set();
for (const s of SUPERSEDED) {
  const hit = findings.find(f => f.file === s.file && f.routine === s.routine);
  assert.ok(hit, `SUPERSEDED lists ${s.routine} in ${s.file} but the pattern is not there — drop the entry`);

  const laterAbs = path.join(ROOT, s.supersededBy);
  assert.ok(fs.existsSync(laterAbs), `${s.supersededBy} does not exist, so nothing supersedes ${s.routine}`);
  /* Ordering is proved against the install manifest's dependency order, not
   * against the filenames. Both files carry the same date, and filename order
   * is not what decides which definition survives -- the dependency edge is. */
  const order = require('../scripts/linear-exit-install-manifest.js').build().dependency_order;
  const iOld = order.indexOf(path.basename(s.file));
  const iNew = order.indexOf(path.basename(s.supersededBy));
  assert.ok(iOld >= 0 && iNew >= 0,
    `both files must be CANDIDATEs for the order to mean anything (${iOld}, ${iNew})`);
  assert.ok(iNew > iOld,
    `${s.supersededBy} installs at ${iNew}, before ${s.file} at ${iOld} — the bare-delete version would win`);

  const later = routineBodies(fs.readFileSync(laterAbs, 'utf8')).filter(b => b.routine === s.routine);
  assert.equal(later.length, 1, `${s.supersededBy} must define ${s.routine} exactly once`);
  assert.ok(!findings.some(f => f.file === s.supersededBy && f.routine === s.routine),
    `${s.supersededBy} carries the same pattern it is supposed to clear`);

  exempt.add(`${s.file}|${s.routine}`);
}

const live = findings.filter(f => !exempt.has(`${f.file}|${f.routine}`));
if (live.length) {
  for (const f of live) console.error(`FAIL ${f.file}  ${f.routine}()  ${f.statement}`);
}
assert.equal(live.length, 0,
  `${live.length} routine statement(s) would refuse with 21000 on an API connection`);

/* The repair is only a repair if the rest of the body is byte-identical. The
 * replacement was produced by patching the applied file, not by retyping it,
 * and this holds the two to that: the two clearing statements differ, and
 * nothing else does. */
{
  const old = routineBodies(fs.readFileSync(path.join(ROOT, SUPERSEDED[0].file), 'utf8'))
    .find(b => b.routine === SUPERSEDED[0].routine).body;
  const neu = routineBodies(fs.readFileSync(path.join(ROOT, SUPERSEDED[0].supersededBy), 'utf8'))
    .find(b => b.routine === SUPERSEDED[0].routine).body;
  assert.notEqual(old, neu, 'the replacement body is identical — nothing was fixed');
  for (const t of ['native_calendar_backfill_scope', 'native_calendar_backfill_applied']) {
    assert.ok(new RegExp(`truncate table ${t};`).test(neu), `${t} is not cleared by truncate`);
    assert.ok(!new RegExp(`delete from ${t};`).test(neu), `${t} is still cleared by a bare delete`);
  }
  const norm = s => s
    .replace(/truncate table (native_calendar_backfill_\w+);/g, 'CLEAR $1')
    .replace(/delete from (native_calendar_backfill_\w+);/g, 'CLEAR $1');
  assert.equal(norm(neu), norm(old),
    'the replacement differs from the applied body by more than the clearing statements');
}

/* `where true` was the other candidate and is deliberately not used: the
 * planner folds it away before the guard inspects the plan. */
assert.ok(!/where\s+true\s*;/i.test(fs.readFileSync(path.join(ROOT, SUPERSEDED[0].supersededBy), 'utf8')),
  'the replacement leans on `where true`, which is constant-folded away');

console.log(JSON.stringify({
  marker: 'MIGRATION_BARE_DELETE_LINT_OK',
  sql_files: files.length,
  routine_bodies: bodiesSeen,
  findings: findings.length,
  superseded_exemptions: exempt.size,
  unexempted: live.length,
}));
