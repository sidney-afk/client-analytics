'use strict';
/*
 * A post description could not be saved by ANYONE, on ANY post, ever.
 *
 * SECOND report from the same SMM, 2026-09-01, after the first fix shipped.
 * The first report ("the new description he's trying to make isn't saving") was
 * the browser gate refusing `batch_description` at the door; that is fixed and
 * deployed (production-write v65), and the screenshot for THIS report proves it
 * -- the save now reaches the database. What came back:
 *
 *   "A service the write depends on did not answer, and nothing was committed.
 *    Try again in a moment; if it keeps failing, send this code to the owner."
 *
 * Nothing was down. Two independent bugs in the SQL half compounded into that
 * sentence, and this file pins both.
 *
 * ---------------------------------------------------------------------------
 * BUG 1 -- THE COMPARE-AND-SWAP WAS UNSATISFIABLE.
 *
 * `production_batch_description_write` declared `p_expected_updated_at text`
 * (the only writer in the estate that does; every other one declares
 * timestamptz) and compared `v_current.updated_at::text` against it. Those are
 * two different renderings of the same instant:
 *
 *   PostgREST -> browser -> gateway -> RPC   2026-08-31T20:18:54.574498+00:00
 *   PostgreSQL `updated_at::text`            2026-08-31 20:18:54.574498+00
 *
 * `T` against a space, `+00:00` against `+00`. `is distinct from` was therefore
 * TRUE on a row nobody else had touched, so the CAS refused every save the
 * product has ever attempted. The gateway's own pre-check passed, because it
 * compares the PostgREST rendering against itself -- which is why the failure
 * only ever surfaced at the very last step.
 *
 * Both strings above are REAL, measured 2026-09-01: the first from the live
 * batch row behind the report, the second from PostgreSQL 16 rendering that
 * same instant. They are pinned as data below and the test asserts they differ
 * as text while naming the same moment -- which is the entire bug, provable
 * with no database attached.
 *
 * ---------------------------------------------------------------------------
 * BUG 2 -- THE REFUSALS WERE UNREADABLE TO THE GATEWAY.
 *
 * All three `raise exception` messages were English with spaces
 * ('production batch description write conflict'), while the gateway's RPC
 * error mapper matches underscore tokens (/write_conflict/i, /batch_not_found/i).
 * None matched, so every refusal -- including correct ones -- fell through to
 * `GatewayError(500, "native_write_failed")`, which the browser classifies as
 * `wait`. A conflict was reported as a dependency outage.
 *
 * The mapping is checked by EXECUTING the deployed mapper's own regex literals,
 * lifted out of production-write/index.ts, against the migration's own raise
 * strings. Nothing here is re-typed from either side, so the pairing cannot rot
 * silently: change a token in the SQL or a regex in the gateway and this fails.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SQL-ONLY. The parameter stays `text`. Widening it to timestamptz
 * changes the function's identity, so `create or replace` would install a
 * SECOND overload beside the broken one, and PostgREST -- which resolves an RPC
 * by the argument names in the JSON body, not by type -- would answer PGRST203
 * ambiguous. The cast moved inside the body instead. No edge-function redeploy
 * is required for any part of this, and the test asserts the signature is
 * byte-identical to the one it replaces so that stays true.
 *
 * ---------------------------------------------------------------------------
 * OPTIONAL EXECUTED PROOF. Set BATCH_DESCRIPTION_CAS_PROBE=1 with a reachable
 * PostgreSQL (standard PG* env) to additionally install both function bodies
 * into a throwaway database and run the real save. Opt-in on purpose: the
 * offline assertions below are deterministic and sufficient for CI, and this
 * suite must never depend on a service being up. The probe was run against
 * PostgreSQL 16.13 on 2026-09-01 and is what the header's claims are measured
 * from -- shipped body refuses the untouched row, replacement commits it.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FIXED_PATH = path.join(ROOT, 'migrations', '2026-09-01-batch-description-cas-timestamptz.sql');
const SHIPPED_PATH = path.join(ROOT, 'migrations', '2026-09-01-batch-description-write.sql');
const FIXED = fs.readFileSync(FIXED_PATH, 'utf8');
const SHIPPED = fs.readFileSync(SHIPPED_PATH, 'utf8');
const GATEWAY = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'production-write', 'index.ts'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Structural checks read CODE, never prose. Both files explain themselves at
   length and name every string they are about, so a guard that matched the
   header would report success against its own documentation. */
function stripSql(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map(line => line.replace(/--.*$/, '')).join('\n');
}
const fixed = stripSql(FIXED);
const shipped = stripSql(SHIPPED);

/* ---- 1. The two renderings, pinned as measured data -------------------- */

/* This is the bug in two lines, and it needs no database to prove. */
const BROWSER_RENDERING = '2026-08-31T20:18:54.574498+00:00';   // PostgREST -> browser -> back
const POSTGRES_RENDERING = '2026-08-31 20:18:54.574498+00';     // updated_at::text

ok(BROWSER_RENDERING !== POSTGRES_RENDERING,
  'the two renderings of one instant are DIFFERENT text — which is why a text CAS refused every save on an untouched row');
ok(new Date(BROWSER_RENDERING).getTime() === new Date(POSTGRES_RENDERING.replace(' ', 'T') + ':00').getTime(),
  'and they are the SAME instant — so the refusal was never about concurrency, it was about string formatting');

/* ---- 2. The CAS compares instants, not strings -------------------------- */

ok(/create or replace function public\.production_batch_description_write\(/.test(fixed),
  'the replacement is a create-or-replace of the same function, not a new one beside it');

const fixedSig = /create or replace function public\.production_batch_description_write\(([\s\S]*?)\)\s*returns/.exec(fixed);
const shippedSig = /create or replace function public\.production_batch_description_write\(([\s\S]*?)\)\s*returns/.exec(shipped);
ok(!!fixedSig && !!shippedSig, 'both signatures were located');
const normalize = s => s.replace(/\s+/g, ' ').trim();
ok(fixedSig && shippedSig && normalize(fixedSig[1]) === normalize(shippedSig[1]),
  'the SIGNATURE IS UNCHANGED — p_expected_updated_at stays `text`, because a timestamptz parameter would install a second overload and PostgREST would answer PGRST203 ambiguous on a body it resolves by argument name');
ok(/p_expected_updated_at text default null/.test(fixedSig ? fixedSig[1] : ''),
  'specifically: still text, so this repair needs no edge-function redeploy');

ok(/nullif\(btrim\(p_expected_updated_at\), ''\)::timestamptz/.test(fixed),
  'the expectation is cast to timestamptz inside the body — the cast moved, the parameter did not');
ok(/v_current\.updated_at is distinct from v_expected/.test(fixed),
  'and the comparison happens in the column\'s own type, so any rendering of the same instant matches');
ok(!/updated_at::text/.test(fixed),
  'nothing in the replacement compares updated_at as text — that comparison is the bug, and its absence is the fix');
ok(/updated_at::text/.test(shipped),
  'while the superseded body does, which is what this file supersedes it for');

ok(/v_expected is not null and/.test(fixed),
  'an EMPTY expectation means no expectation, matching the null arm — the browser sends `` when it could not resolve the row\'s clock, and refusing that would block a save on a batch whose clock is unreadable');

/* btrim is correct on a machine-generated timestamp and WRONG on the
   description, and the distinction has already cost this feature one review. */
ok(/v_description text := nullif\(p_description, ''\);/.test(fixed)
  && !/btrim\(coalesce\(p_description/.test(fixed) && !/btrim\(p_description/.test(fixed),
  'the DESCRIPTION is still never trimmed — btrim there would rewrite validated Markdown, destroying a fenced code block\'s indentation and the trailing spaces that are a hard line break');

/* ---- 3. A malformed expectation cannot become a 500 -------------------- */

ok(/exception when invalid_datetime_format or datetime_field_overflow then/.test(fixed),
  'the cast is guarded by a NARROW handler — a malformed expectation cannot match the row and is refused as the conflict it is, instead of raising 22007 into the generic 500');
ok(!/exception when others then/.test(fixed),
  'and NOT `when others`, which would also swallow a statement timeout or a cancelled query and report it as a conflict — the same class of lie this file exists to remove');

/* ---- 4. Executed: the deployed mapper against the migration's own tokens */

/* The mapper is lifted out of the SHIPPED gateway and its regex literals are
   executed in source order. This is the assertion that matters: it proves the
   new tokens reach the browser as the codes intended, using the gateway that
   is live right now, with no deploy. */
function grabFunc(src, signature) {
  const start = src.indexOf(signature);
  if (start < 0) throw new Error('not found: ' + signature);
  let depth = 0, quote = '', comment = '', escaped = false;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (comment === 'line') { if (c === '\n') comment = ''; continue; }
    if (comment === 'block') { if (c === '*' && n === '/') { comment = ''; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && n === '/') { comment = 'line'; i++; continue; }
    if (c === '/' && n === '*') { comment = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('unclosed: ' + signature);
}

const rpcBody = grabFunc(GATEWAY, 'async function rpc(supabase: SupabaseClient');
/* Every `/.../i.test(clean(error.message))` guard, in the order the gateway
   evaluates them. The literals are compiled from the gateway's own source. */
const guards = [];
const guardRe = /\/((?:[^/\\\n]|\\.)+)\/([a-z]*)\.test\(clean\(error\.message\)\)/g;
let m;
while ((m = guardRe.exec(rpcBody)) !== null) {
  guards.push({ source: m[1], re: new RegExp(m[1], m[2]) });
}
ok(guards.length >= 8,
  'the deployed mapper\'s message guards were extracted from its own source (' + guards.length + ' found)');
ok(/throw new GatewayError\(500, "native_write_failed"\);\s*\}\s*return data;/.test(rpcBody),
  'and its FINAL fallthrough is 500 native_write_failed — the code every unmatched raise became');

// The browser classifies that fallthrough as `wait`, which is the sentence in
// the screenshot: "Try again in a moment."
ok(/'native_write_failed',[\s\S]{0,200}\]/.test(INDEX) || /native_write_failed/.test(INDEX),
  'which the browser carries in its own code table');

function firstGuard(message) {
  for (const g of guards) if (g.re.test(message)) return g;
  return null;
}

// The migration's OWN raise strings, read out of the file rather than retyped.
const raises = (FIXED.match(/raise exception '([a-z_]+)'/g) || [])
  .map(s => /'([a-z_]+)'/.exec(s)[1]);
const uniqueRaises = [...new Set(raises)];
ok(uniqueRaises.length === 3,
  'the replacement raises exactly three distinct tokens (' + uniqueRaises.join(', ') + ')');
ok(uniqueRaises.every(r => /^[a-z_]+$/.test(r)),
  'all of them are UNDERSCORE tokens — the mapper matches tokens, and English with spaces matches nothing');

const conflictToken = uniqueRaises.find(r => /write_conflict$/.test(r));
const notFoundToken = uniqueRaises.find(r => /batch_not_found$/.test(r));
const scopeToken = uniqueRaises.find(r => /scope_required$/.test(r));
ok(!!conflictToken && !!notFoundToken && !!scopeToken,
  'and they are the conflict, the missing target and the blank scope');

const conflictGuard = firstGuard(conflictToken);
ok(conflictGuard && /write_conflict/.test(conflictGuard.source)
  && !/idempotency/.test(conflictGuard.source),
  'A CONFLICT MAPS: ' + conflictToken + ' is caught first by /' + (conflictGuard && conflictGuard.source) + '/ → 409 write_conflict, which the browser answers with "That batch changed while this window was open" and adopts the winning row and clock');

const notFoundGuard = firstGuard(notFoundToken);
ok(notFoundGuard && /batch_not_found/.test(notFoundGuard.source),
  'A MISSING TARGET MAPS: ' + notFoundToken + ' is caught first by /' + (notFoundGuard && notFoundGuard.source) + '/ → 409 batch_not_found, not a 500');
ok(notFoundGuard && !/write_conflict/.test(notFoundGuard.source),
  'and the two do not cross-match — the conflict guard is evaluated first and must not swallow the missing-target token');

ok(firstGuard(scopeToken) === null,
  scopeToken + ' is deliberately unmapped: it is unreachable from the gateway, which refuses a blank id or slug before the call. Named in the same shape so the next reader does not have to wonder whether it was missed');

/* The three it replaces, pinned as the regression. Every one of them fell all
   the way through to native_write_failed — including a correct conflict. */
const supersededMessages = (SHIPPED.match(/raise exception '([^']+)'/g) || [])
  .map(s => /'([^']+)'/.exec(s)[1]);
ok(supersededMessages.length === 3 && supersededMessages.every(s => / /.test(s)),
  'the superseded body raised three SPACED English messages (' + supersededMessages.join(' / ') + ')');
supersededMessages.forEach(msg => {
  ok(firstGuard(msg) === null,
    'THE REGRESSION: "' + msg + '" matched no guard and fell through to 500 native_write_failed — a `wait`-class code telling the user to retry a refusal that can never succeed');
});

/* ---- 5. Nothing else moved -------------------------------------------- */

const vRow = /v_row := ([\s\S]*?);/.exec(fixed);
ok(!!vRow, 'the row handed to batch_write was located');
const rowKeys = (vRow ? vRow[1] : '').match(/'([a-z_]+)',/g) || [];
ok(rowKeys.length === 3
  && /'id',/.test(vRow[1]) && /'client_slug',/.test(vRow[1]) && /'description',/.test(vRow[1]),
  'EXACTLY three keys still reach batch_write: id, client_slug, description');
['footage_folder_url', 'delivery_folder_url', 'filming_doc_url', 'name', 'purpose'].forEach(col => {
  ok(!new RegExp("'" + col + "'").test(vRow[1]),
    'and it still cannot reach ' + col);
});
ok(/'client_slug', v_current\.client_slug/.test(vRow[1]),
  'THE 23502 LESSON survives the rewrite: client_slug is present, because NOT NULL is evaluated on the proposed INSERT tuple before the conflict resolves');

const lockAt = fixed.indexOf('for update;');
const casAt = fixed.indexOf('p_expected_updated_at is not null');
ok(lockAt > -1 && casAt > lockAt,
  'the CAS still sits UNDER the row lock — the only place the comparison is serialised against a concurrent writer');
ok(/foreach v_team in array v_teams loop\s*\n?\s*perform public\.production_assert_authority\(/.test(fixed),
  'authority is still asserted for EVERY team the post serves');
ok(/from public\.deliverables d\s*\n?\s*where d\.batch_id = v_current\.id/.test(fixed),
  'and the team is still derived from the batch AND its deliverables');
ok(/revoke all on function public\.production_batch_description_write[\s\S]*?from public, anon, authenticated/.test(fixed)
  && /grant execute on function public\.production_batch_description_write[\s\S]*?to service_role/.test(fixed),
  'service_role only — never anon or authenticated');
ok(/^begin;$/m.test(fixed) && /^commit;$/m.test(fixed),
  'and the whole file is one transaction');

/* ---- 6. The ledgers name this delta, with the signature a drop needs ---- */

/* Both of these were wrong when this PR opened, and both fail SILENTLY, which
   is why they are pinned rather than trusted. Raised by review on #1216. */

const ROLLBACK = fs.readFileSync(path.join(ROOT, 'ROLLBACK.md'), 'utf8');
const argTypes = normalize(fixedSig ? fixedSig[1] : '')
  .split(',')
  .map(part => (part.trim().split(/\s+/)[1] || '').toLowerCase())
  .filter(Boolean)
  .join(', ');
ok(argTypes === 'text, text, text, text, jsonb',
  'the function takes five argument types (' + argTypes + ')');
const drops = ROLLBACK.match(/drop function if exists\s*\n?\s*public\.production_batch_description_write\(([^)]*)\)/g) || [];
ok(drops.length > 0, 'ROLLBACK.md names a drop for this function');
drops.forEach(d => {
  const named = normalize(/\(([^)]*)\)/.exec(d)[1]).toLowerCase();
  ok(named === argTypes,
    'and it names ALL FIVE types (' + named + ') — `drop function if exists` with a wrong signature matches nothing and EXITS 0, so a four-type drop reports a successful rollback while leaving the real writer installed');
});

const MIG_README = fs.readFileSync(path.join(ROOT, 'migrations', 'README.md'), 'utf8');
ok(MIG_README.includes('2026-09-01-batch-description-cas-timestamptz.sql'),
  'the migration ledger names this delta — an operator rebuilding from the baseline plus deltas must not stop at the superseded body, which refuses every save');
ok(!/production_batch_description_write\(text, text, text, jsonb\)/.test(MIG_README)
  && !/production_batch_description_write\(text, text, text, jsonb\)/.test(ROLLBACK),
  'and neither ledger still documents the four-argument signature that does not exist');

/* ---- 7. Optional executed proof against a real PostgreSQL -------------- */

if (String(process.env.BATCH_DESCRIPTION_CAS_PROBE || '') === '1') {
  /* THE PROBE MUST BE UNABLE TO REACH ANYTHING REAL, and an opt-in flag does not
     establish that. Raised by review on #1216, correctly: the harness below
     `create or replace`s `public.batch_write` and
     `public.production_assert_authority` -- the estate's actual write and
     authorization functions -- with one-purpose stubs. Pointed at a real
     database by ambient PG* variables, it would replace core write logic with a
     stub that only understands `description`. A flag is a promise; what follows
     is proof, and it is the same shape test/f63-flip-runbook-sql-gate.js already
     uses for exactly this reason:

       * the host must be loopback, so there is nothing remote to reach;
       * PGDATABASE must be the `postgres` bootstrap database, PGPORT and PGUSER
         explicit, and the environment handed to psql is rebuilt from scratch --
         no PGSERVICE, no PGOPTIONS, no PGHOSTADDR can redirect it;
       * every statement then runs inside a database CREATED SECONDS EARLIER
         from template0 and dropped in `finally`, never the connected one;
       * and that database is asserted empty of public relations and functions
         before a single DDL statement runs. A real database fails that check
         instantly, which is the guarantee a flag cannot give.

     A guard that fails is a FAILURE, never a skip: the flag was set, so the
     proof was asked for. */
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);
  const pgHost = String(process.env.PGHOST || '').trim().toLowerCase();
  const pgPort = String(process.env.PGPORT || '').trim();
  const pgUser = String(process.env.PGUSER || '').trim();
  const pgDatabase = String(process.env.PGDATABASE || '').trim();

  const guards = [
    [allowedHosts.has(pgHost),
      'the probe refuses a non-loopback PGHOST (' + (pgHost || '(missing)') + ') — there must be nothing remote to reach'],
    [pgDatabase === 'postgres',
      'the probe bootstraps only through the `postgres` database (' + (pgDatabase || '(missing)') + '), never a live one'],
    [/^\d+$/.test(pgPort), 'the probe requires an explicit numeric PGPORT'],
    [!!pgUser, 'the probe requires an explicit PGUSER'],
  ];
  const guarded = guards.every(([pass, message]) => { ok(pass, message); return pass; });

  if (guarded) {
    // Rebuilt from scratch so no PGSERVICE / PGOPTIONS / PGHOSTADDR survives to
    // redirect the connection somewhere this file never checked.
    const psqlEnv = {};
    for (const name of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'LANG', 'LC_ALL']) {
      if (process.env[name] !== undefined) psqlEnv[name] = process.env[name];
    }
    Object.assign(psqlEnv, {
      PGHOST: pgHost,
      PGPORT: pgPort,
      PGUSER: pgUser,
      PGPASSWORD: String(process.env.PGPASSWORD || ''),
      PGDATABASE: 'postgres',
      PGSSLMODE: String(process.env.PGSSLMODE || 'disable'),
    });
    ok(Object.keys(psqlEnv).filter(n => /^PG/.test(n)).sort().join(',')
      === 'PGDATABASE,PGHOST,PGPASSWORD,PGPORT,PGSSLMODE,PGUSER',
      'and psql receives no service, host-address or options override');

    const database = 'bdcas_' + process.pid + '_' + Date.now();

    const psql = (db, args, opts) => spawnSync('psql',
      ['-X', '--quiet', '--no-align', '--tuples-only', '--dbname', db].concat(args),
      Object.assign({ env: psqlEnv, encoding: 'utf8', timeout: 60000 }, opts || {}));
    const run = (db, sql, stop) => psql(db, ['--set', 'ON_ERROR_STOP=' + (stop === false ? '0' : '1'), '--file', '-'], { input: sql });
    const runFile = (db, file) => psql(db, ['--set', 'ON_ERROR_STOP=1', '--file', file]);
    const scalar = (db, sql) => String((run(db, sql + ';\n').stdout || '')).trim();

    const up = psql('postgres', ['--command', 'select 1']);
    if (up.status !== 0) {
      ok(false, 'BATCH_DESCRIPTION_CAS_PROBE=1 was set but psql could not connect: '
        + String(up.stderr || up.error || '').trim());
    } else {
      // Roles are cluster-scoped, so create only the ones that are missing and
      // drop only those again — never a role that was already there.
      const roleNames = ['anon', 'authenticated', 'service_role'];
      const mine = roleNames.filter(r =>
        scalar('postgres', "select count(*) from pg_roles where rolname = '" + r + "'") === '0');
      mine.forEach(r => run('postgres', 'create role "' + r + '";'));

      let created = false;
      try {
        const made = run('postgres', 'create database "' + database + '" template template0;');
        created = made.status === 0;
        ok(created, 'a disposable database was created from template0 for this probe');

        if (created) {
          ok(scalar(database, "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'") === '0'
            && scalar(database, "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'") === '0',
            'and it is PROVEN EMPTY of public relations and functions before any DDL runs — a real database fails this, which is the guarantee the opt-in flag cannot give');
          ok(/^16\d{4}$/.test(scalar(database, 'show server_version_num')),
            'on PostgreSQL 16, the version the estate runs');

          run(database, `
create table public.clients(slug text primary key, active boolean not null default true);
create table public.batches (
  id text primary key, client_slug text not null references public.clients(slug),
  team text check (team in ('video','graphics')), name text not null, description text,
  status text not null default 'active', updated_at timestamptz not null default now());
create table public.deliverables (
  id text primary key, batch_id text not null references public.batches(id),
  client_slug text not null references public.clients(slug), team text not null);
create function public.production_assert_authority(a text, b text, c boolean, d boolean)
returns void language plpgsql as $$ begin
  if b is null then raise exception 'authority_unavailable'; end if; end $$;
create function public.batch_write(p_row jsonb, p_event jsonb)
returns public.batches language plpgsql as $$ declare r public.batches%rowtype; begin
  update public.batches b set
    description = case when p_row ? 'description' then p_row->>'description' else b.description end,
    updated_at = now()
  where b.id = p_row->>'id' returning b.* into r; return r; end $$;
insert into public.clients values ('probe', true);
insert into public.batches(id, client_slug, team, name, description, updated_at)
  values ('probe_b1','probe','video','Post','seed','${BROWSER_RENDERING}');
insert into public.deliverables values ('probe_d1','probe_b1','probe','video');
`);

          const call = (expectation, text) => run(database,
            "select (public.production_batch_description_write('probe_b1','probe','" + text + "',"
            + (expectation === null ? 'null' : "'" + expectation + "'") + ",'{}'::jsonb)).description;\n",
            false);
          const reset = () => run(database,
            "update public.batches set updated_at = '" + BROWSER_RENDERING + "' where id = 'probe_b1';");

          runFile(database, SHIPPED_PATH);
          const before = call(BROWSER_RENDERING, 'probe text');
          ok(/production batch description write conflict/.test(String(before.stderr || '')),
            'EXECUTED: the shipped body refuses an UNTOUCHED row when handed the exact string the browser sends');

          reset();
          runFile(database, FIXED_PATH);
          const after = call(BROWSER_RENDERING, 'probe text');
          ok(String(after.stdout || '').trim() === 'probe text',
            'EXECUTED: the replacement commits that same save');

          ok(/production_batch_description_write_conflict/.test(
            String(call('2020-01-01T00:00:00+00:00', 'nope').stderr || '')),
            'EXECUTED: a genuinely stale expectation is still refused, with the token the gateway maps');

          ok(/production_batch_description_write_conflict/.test(
            String(call('not-a-timestamp', 'nope').stderr || '')),
            'EXECUTED: a malformed expectation is a conflict, not a 22007 into the generic 500');

          // The instant, not the string: a different offset naming the same
          // moment must be accepted, or the fix is only a different formatting
          // coincidence.
          reset();
          const shifted = scalar(database,
            "select to_char(timestamptz '" + BROWSER_RENDERING + "' at time zone 'America/New_York', 'YYYY-MM-DD\"T\"HH24:MI:SS.US') || '-04:00'");
          ok(String(call(shifted, 'via offset').stdout || '').trim() === 'via offset',
            'EXECUTED: and an offset-shifted rendering of the SAME instant (' + shifted + ') is accepted — the proof it compares instants, not strings');

          reset();
          ok(String(call(null, 'via null').stdout || '').trim() === 'via null'
            && String(call('', 'via empty').stdout || '').trim() === 'via empty',
            'EXECUTED: a null or empty expectation means no expectation, so a repair or a backfill can still write');
        }
      } finally {
        if (created) {
          run('postgres', "select pg_terminate_backend(pid) from pg_stat_activity where datname = '"
            + database + "' and pid <> pg_backend_pid();\ndrop database \"" + database + "\";\n");
        }
        mine.forEach(r => run('postgres', 'drop role if exists "' + r + '";'));
      }
    }
  }
} else {
  console.log('  --  executed probe skipped (BATCH_DESCRIPTION_CAS_PROBE=1 with a loopback PG* env runs it)');
}

console.log(failures === 0
  ? '\nbatch description CAS checks passed'
  : '\n' + failures + ' batch description CAS check(s) failed');
process.exit(failures === 0 ? 0 : 1);
