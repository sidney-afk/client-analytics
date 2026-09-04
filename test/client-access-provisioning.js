'use strict';
/*
 * client-access-provisioning.js — the review token a new client must have.
 *
 * `public.client_access` rows had only ever been created by the one-time
 * 2026-07-05/06 B0 seed, so every client onboarded after it (first:
 * `lukecutting`, roster row 2026-07-29) reached "Share with client" with no
 * token and got a bare `review_token_missing`. Three layers close that, and
 * this suite holds each of them to the same non-negotiable rule: a stored
 * token is never rotated, because rotating one silently 401s every link the
 * client already holds (ROLLBACK.md F35 / AGENTS.md frozen-writer callout).
 *
 *   1. `_shared/client-review-token-policy.mjs` — the pure decision + mint.
 *   2. `client-review-link` — provisions on demand for a verified staff caller.
 *   3. `migrations/2026-08-04-client-access-auto-provision.sql` — mints at
 *      client-creation time, plus the one-time backfill.
 *      `scripts/provision-client-access.js` closes the gap without a deploy.
 *
 * The migration's own execution proof is opt-in against a disposable
 * PostgreSQL 16 (CLIENT_ACCESS_REQUIRE_POSTGRES=1), exactly like the F63 gate;
 * every other check here is offline.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const { stripBlockComments } = require('./helpers/strip-comments');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const POLICY_PATH = 'supabase/functions/_shared/client-review-token-policy.mjs';
const MIGRATION_PATH = 'migrations/2026-08-04-client-access-auto-provision.sql';
const SCRIPT_PATH = 'scripts/provision-client-access.js';

const edge = read('supabase/functions/client-review-link/index.ts');
const migration = read(MIGRATION_PATH);
const tool = read(SCRIPT_PATH);
const index = read('index.html');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// Assertions about what the code DOES must not be satisfiable — or defeated —
// by what a comment happens to say about it.
function executableOnly(source) {
  return stripBlockComments(source, ' ')
    .split('\n')
    .filter(line => !/^\s*(?:\/\/|--|#)/.test(line))
    .join('\n');
}

// ---------------------------------------------------------------- 1. policy
async function checkPolicy() {
  const policy = await import(pathToFileURL(path.join(ROOT, POLICY_PATH)).href);

  ok(policy.REVIEW_TOKEN_BYTES === 24, 'a review token is minted from 24 random bytes');

  const minted = policy.mintReviewToken(length => crypto.randomBytes(length));
  ok(policy.isReviewTokenShape(minted) && minted.length === 32,
    'a minted token is 32 unpadded base64url characters, the B0 seeder shape');
  ok(minted === Buffer.from(minted.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
  'the minted token round-trips through base64url without loss');

  // Whole-byte-space coverage: every byte value must survive the encoder.
  const spread = policy.encodeReviewToken(Uint8Array.from(
    Array.from({ length: 24 }, (_value, i) => i * 11 % 256),
  ));
  ok(policy.isReviewTokenShape(spread), 'high and URL-unsafe bytes still encode to base64url');
  assert.throws(() => policy.encodeReviewToken(Uint8Array.from([1, 2, 3])), /exactly 24 random bytes/);
  assert.throws(() => policy.mintReviewToken(null), /random-bytes source/);
  ok(true, 'a short or missing entropy source is refused rather than shortening the token');

  const unique = new Set(Array.from({ length: 500 }, () =>
    policy.mintReviewToken(length => crypto.randomBytes(length))));
  ok(unique.size === 500, '500 consecutive mints collide zero times');

  // The decision table. `reuse` is the only outcome that must never write.
  assert.deepStrictEqual(policy.reviewTokenAction(null),
    { action: 'mint', token: '', staleToken: null });
  ok(true, 'a client with no client_access row is minted a token');
  assert.deepStrictEqual(policy.reviewTokenAction({ review_token: ' stored-token ' }),
    { action: 'reuse', token: 'stored-token', staleToken: null });
  ok(true, 'a stored token is reused verbatim, never re-minted');
  assert.deepStrictEqual(policy.reviewTokenAction({ review_token: '   ' }),
    { action: 'repair', token: '', staleToken: '   ' });
  ok(true, 'a blank stored token is repaired, guarded on the exact blank read');
  assert.deepStrictEqual(policy.reviewTokenAction({ review_token: null }),
    { action: 'repair', token: '', staleToken: null });
  ok(true, 'a null stored token repairs against IS NULL, not an empty string');
}

// ------------------------------------------------------- 2. the Edge Function
function checkEdgeFunction() {
  ok(edge.includes('from "../_shared/client-review-token-policy.mjs"'),
    'the issuer mints through the shared, CI-testable policy');
  ok(/if \(decision\.action !== "reuse"\) \{\s*\n\s*const write = await provisionReviewToken/.test(edge),
    'the issuer provisions only when nothing is stored to reuse');
  ok(/\.from\("client_access"\)\.insert\(\{/.test(edge),
    'the mint path is an INSERT');

  const update = edge.slice(edge.indexOf('let repair = supabase'), edge.indexOf('// Minting a credential'));
  ok(/\.eq\("slug", slug\)/.test(update)
    && /repair\.is\("review_token", null\)/.test(update)
    && /repair\.eq\("review_token", decision\.staleToken\)/.test(update),
  'the only UPDATE is guarded on the exact blank token the row was read as');
  const edgeCode = executableOnly(edge);
  ok((edgeCode.match(/\.update\(/g) || []).length === 1,
    'there is exactly one UPDATE against client_access in the whole issuer');
  ok((edgeCode.match(/review_token:/g) || []).length === 2
    && edgeCode.indexOf('review_token:') > edgeCode.indexOf('async function provisionReviewToken'),
  'review_token is written from nowhere but the guarded provisioning helper');
  ok(!/\bupsert\b/.test(edgeCode) && !/resolution=merge-duplicates/.test(edgeCode),
    'the issuer never reaches for an upsert, which could overwrite a stored token');

  ok(edge.includes('const DUPLICATE_KEY = "23505"') && /code !== DUPLICATE_KEY/.test(edge),
    'losing the insert race to a concurrent staff copy is not an error');
  ok(/const reread = await readAccessRow\(supabase, slug\);[\s\S]{0,220}decision = reviewTokenAction\(reread\.row\)/.test(edge),
    'the token returned is always the one read back from the database');
  ok(/if \(decision\.action !== "reuse"\) return json\(\{ ok: false, error: "review_token_missing" \}, 409\)/.test(edge),
    'a token that cannot be read back still fails closed with review_token_missing');

  const provisionGate = edge.indexOf('const stored = await readAccessRow');
  ok(edge.indexOf('principal.kind !== "staff"') < provisionGate
    && edge.indexOf('client.active !== true') < provisionGate,
  'provisioning happens only after the staff principal and active client are proven');

  const audit = edge.slice(edge.indexOf('syncview_auth_events'), edge.indexOf('} catch (_error)'));
  ok(/reason: "review_token_provisioned"/.test(audit) && /client_slug: slug/.test(audit),
    'a mint is recorded in the auth-event ledger');
  const auditFields = audit.replace(/reason: "review_token_provisioned",/, '');
  ok(!/\btoken\b\s*:|review_token|decision\.token|\bminted\b/.test(auditFields),
    'the audit row never carries the token value');
  ok(!/console\./.test(edge), 'the issuer still logs nothing');
}

// --------------------------------------------------------- 3. the SQL delta
function checkMigration() {
  ok(/create trigger client_access_provision_for_client\s*\n\s*after insert on public\.clients/.test(migration),
    'a new clients row provisions its token in the same transaction');
  ok(/if new\.kind = 'internal' then\s*\n\s*return new;/.test(migration),
    'internal bookkeeping rows are skipped, as the B0 seeder skipped them');
  ok(/security definer/.test(migration) && /set search_path = public, pg_temp/.test(migration),
    'the trigger function runs security definer with a pinned search_path');

  // Regression guard, 2026-08-10. The mint function calls gen_random_bytes
  // (pgcrypto), which on Supabase lives in `extensions`, not `public`. Without
  // its own search_path it gets inlined into the trigger function — pinned to
  // `public, pg_temp` — and every §6f roster insert dies with
  // `42883: function gen_random_bytes(integer) does not exist`.
  const mintFn = (migration.match(
    /create or replace function public\.client_access_mint_review_token\(\)[\s\S]*?\$\$;/,
  ) || [''])[0];
  ok(mintFn, 'the mint function is still defined in the delta');
  ok(/set search_path\s*=\s*[^\n]*\bextensions\b/.test(mintFn),
    'the mint function names a search_path that can reach pgcrypto in `extensions`');
  ok(/\bpublic\b[\s\S]*?\bextensions\b/.test(
    (mintFn.match(/set search_path\s*=\s*([^\n]*)/) || ['', ''])[1]),
    'that search_path still tries `public` first, for installs with pgcrypto in public');

  const statements = migration.split(';');
  const inserts = statements.filter(s => /insert\s+into\s+public\.client_access/i.test(s));
  ok(inserts.length >= 2, 'the delta both backfills and installs the per-client mint');
  ok(inserts.every(s => /on conflict \(slug\) do nothing/i.test(s)),
    'every client_access INSERT is ON CONFLICT DO NOTHING');

  const executable = migration.split('\n').filter(line => !/^\s*--/.test(line)).join('\n');
  ok(!/update\s+public\.client_access/i.test(executable),
    'the delta contains no UPDATE against client_access');
  ok(!/delete\s+from\s+public\.client_access/i.test(executable),
    'the delta deletes no token, which would revoke a live client link');
  ok(/where c\.active is true[\s\S]{0,60}and c\.kind <> 'internal'/.test(migration),
    'the backfill is scoped to active, non-internal clients');
  ok(/drop trigger if exists client_access_provision_for_client/.test(migration)
    && /alter table public\.client_access alter column review_token drop default/.test(migration),
  'a one-command rollback block is included');
}

// ------------------------------------------------------- 4. the ops backfill
function checkTool() {
  const toolCode = executableOnly(tool);
  ok(/resolution=ignore-duplicates/.test(toolCode),
    'the backfill tool writes ON CONFLICT DO NOTHING and so cannot rotate');
  ok(!/--rotate/.test(toolCode) && !/'PATCH'|'PUT'|'DELETE'/.test(toolCode),
    'the backfill tool has no rotate flag and issues no update or delete request');
  ok(/const APPLY = ARGS\.includes\('--apply'\)/.test(tool) && /if \(!APPLY\) \{/.test(tool),
    'the tool reads and reports by default; writing needs --apply');
  ok(/if \(CHECK\) process\.exitCode = 1/.test(tool),
    '--check exits non-zero when any active client lacks a token');
  ok(/active=is\.true&kind=neq\.internal/.test(tool),
    'the tool targets exactly the clients that can receive a share link');
  ok(/const after = await provisionedSlugs\(\)/.test(tool),
    'the tool proves the result with an independent readback, not the write response');
  ok(!/console\.log\([^)]*review_token/.test(tool) && /Slugs, never tokens/.test(tool),
    'the tool never prints a token value');
  ok(tool.includes(POLICY_PATH.split('/').pop()),
    'the tool mints through the same shared policy as the issuer');
}

// ------------------------------------------- 5. the message the SMM actually sees
function checkBrowserMessage() {
  const start = index.indexOf('function _syncviewShareLinkErrorMessage(');
  ok(start >= 0, 'the browser maps issuer error codes to an actionable message');
  const source = index.slice(start, index.indexOf('\n    }', start) + 6);
  const context = {};
  vm.createContext(context);
  vm.runInContext(source, context);
  const message = context._syncviewShareLinkErrorMessage;

  for (const code of ['review_token_missing', 'inactive_client', 'staff_required',
    'credentials_required', 'authorization_unavailable', 'invalid_client']) {
    const text = message(code, 500);
    ok(!text.includes(code) && /[a-z]\s[a-z]/i.test(text) && text.length > 25,
      `${code} reaches the SMM as a sentence, not a machine code`);
  }
  ok(/provision-client-access/.test(message('review_token_missing', 409)),
    'the missing-token toast names the tool that fixes it');
  ok(/step 6f/.test(message('inactive_client', 410)),
    'the missing-roster-row toast names the onboarding step that fixes it');
  ok(/unknown_code/.test(message('unknown_code', 500)) && /503/.test(message('', 503)),
    'an unmapped code and a bodiless failure still surface something diagnosable');

  const issuer = index.slice(index.indexOf('async function _syncviewIssueClientShareUrl('));
  ok(/throw new Error\(_syncviewShareLinkErrorMessage\(json && json\.error, resp\.status\)\)/
    .test(issuer.slice(0, 1200)),
  'every share button throws the mapped message');
}

// ------------------------------- 6. optional disposable-PostgreSQL execution
function checkMigrationExecutes() {
  if (process.env.CLIENT_ACCESS_REQUIRE_POSTGRES !== '1') {
    console.log('  --  SKIP disposable-PostgreSQL execution proof (set CLIENT_ACCESS_REQUIRE_POSTGRES=1)');
    return;
  }
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);
  const host = String(process.env.PGHOST || '').trim().toLowerCase();
  assert.ok(allowedHosts.has(host), `refusing a non-loopback PGHOST: ${host || '(missing)'}`);
  assert.ok(/^\d+$/.test(String(process.env.PGPORT || '')), 'an explicit numeric PGPORT is required');

  const database = `client_access_${process.pid}_${Date.now()}`;
  assert.match(database, /^client_access_[a-z0-9_]+$/, 'the disposable database name is a safe identifier');
  const env = {
    PATH: process.env.PATH,
    PGHOST: host,
    PGPORT: String(process.env.PGPORT),
    PGUSER: String(process.env.PGUSER || 'postgres'),
    PGPASSWORD: String(process.env.PGPASSWORD || ''),
    PGDATABASE: 'postgres',
    PGSSLMODE: 'disable',
  };
  const psql = (dbname, sql) => {
    const result = spawnSync('psql', ['-X', '--quiet', '--no-align', '--tuples-only',
      '--set', 'ON_ERROR_STOP=1', '--dbname', dbname, '--file', '-'],
    { env, input: sql, encoding: 'utf8', timeout: 60000 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`psql failed: ${(result.stderr || result.stdout || '').trim()}`);
    return String(result.stdout || '').trim();
  };

  psql('postgres', `create database ${database};`);
  try {
    psql(database, `
      create extension if not exists pgcrypto;
      create table public.clients (
        slug text primary key,
        display_name text not null,
        active boolean not null default true,
        kind text not null default 'client' check (kind in ('client','internal','test'))
      );
      create table public.client_access (
        slug text primary key references public.clients(slug),
        review_token text not null,
        token_rotated_at timestamptz not null default now(),
        notes text
      );
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'service_role')
          then create role service_role; end if;
      end $$;
      insert into public.clients (slug, display_name, active, kind) values
        ('seeded', 'Seeded', true, 'client'),
        ('postseed', 'Post Seed', true, 'client'),
        ('archived', 'Archived', false, 'client'),
        ('bookkeeping', 'Bookkeeping', true, 'internal');
      insert into public.client_access (slug, review_token, notes)
        values ('seeded', 'ORIGINAL-SEEDED-TOKEN', 'B0 seed');
    `);

    psql(database, migration);
    const afterApply = psql(database, `
      select slug || '=' || (review_token = 'ORIGINAL-SEEDED-TOKEN')::text
      from public.client_access order by slug;`).split('\n').filter(Boolean);
    assert.deepStrictEqual(afterApply, ['postseed=false', 'seeded=true']);
    ok(true, 'apply backfills the post-seed client and leaves the seeded token byte-identical');
    ok(psql(database, `select count(*) from public.client_access
      where review_token !~ '^[A-Za-z0-9_-]{32}$' and slug <> 'seeded';`) === '0',
    'every backfilled token is a well-formed 32-character base64url value');

    psql(database, `insert into public.clients (slug, display_name, kind)
      values ('brandnew','Brand New','client'), ('internaltwo','Internal Two','internal');`);
    assert.deepStrictEqual(
      psql(database, `select slug from public.client_access order by slug;`).split('\n'),
      ['brandnew', 'postseed', 'seeded']);
    ok(true, 'a new client row provisions its own token and an internal row does not');

    const before = psql(database, `select md5(string_agg(review_token, ',' order by slug))
      from public.client_access;`);
    psql(database, migration);
    ok(psql(database, `select md5(string_agg(review_token, ',' order by slug))
      from public.client_access;`) === before,
    're-applying the delta changes not one stored token');

    psql(database, `
      begin;
      drop trigger if exists client_access_provision_for_client on public.clients;
      drop function if exists public.client_access_provision_for_client();
      alter table public.client_access alter column review_token drop default;
      drop function if exists public.client_access_mint_review_token();
      commit;`);
    ok(psql(database, 'select count(*) from public.client_access;') === '3'
      && psql(database, `select count(*) from pg_trigger
        where tgname = 'client_access_provision_for_client';`) === '0',
    'the rollback block removes the automation and revokes no live client link');
  } finally {
    spawnSync('psql', ['-X', '--quiet', '--dbname', 'postgres', '--command',
      `drop database if exists ${database} with (force);`], { env, encoding: 'utf8', timeout: 60000 });
  }
}

(async () => {
  await checkPolicy();
  checkEdgeFunction();
  checkMigration();
  checkTool();
  checkBrowserMessage();
  checkMigrationExecutes();
  if (failures) {
    console.error(`\n${failures} client-access provisioning check(s) failed`);
    process.exit(1);
  }
  console.log('\nClient review-token provisioning checks passed');
})().catch(error => { console.error(error); process.exit(1); });
