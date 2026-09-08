'use strict';

/*
 * The native naming mint — migrations/2026-09-07-native-identifier-mint.sql.
 *
 * Two layers, deliberately. The offline layer below always runs and holds the
 * contracts a source file can actually carry: additive-only DDL, a flag that
 * seeds inert, a capability that self-guards, and a browser that needs no
 * change. The behavioural layer lives in qa/native-identifier-mint/sql-proof.js
 * and runs against a disposable PostgreSQL 16 when one is explicitly provided,
 * because concurrency, flag flips and a provider write arriving after a native
 * mint are not things a regex can settle.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'migrations/2026-09-07-native-identifier-mint.sql'), 'utf8');
/* The DDL assertions below must read STATEMENTS, not prose. This migration's own
   header says "No DROP, no RENAME", and a check that matched the comment saying
   so would be the purest form of testing nothing. */
const statements = migration.replace(/--[^\n]*/g, '');
/* assert.doesNotMatch prints the whole subject on failure, which for a 250-line
   migration buries the message it is trying to deliver. */
function refutes(re, subject, message) { assert.ok(!re.test(subject), message); }

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`OK  ${name}`); }

check('additive only: the sole DROP is the idempotent trigger re-create in the same transaction', () => {
  const drops = statements.match(/drop\s+\w+/gi) || [];
  assert.deepEqual(drops.map(d => d.toLowerCase().replace(/\s+/g, ' ')), ['drop trigger']);
  assert.match(statements, /drop trigger if exists zzz_production_native_identifier_mint on public\.deliverables;\s*create trigger zzz_production_native_identifier_mint/);
  refutes(/\brename\b/i, statements, 'the migration renames something');
  refutes(/alter\s+table[\s\S]{0,120}\b(drop|alter)\s+column/i, statements, 'the migration drops or retypes a column');
  refutes(/\btruncate\b/i, statements, 'the migration truncates something');
  assert.match(statements, /^\s*begin;/);
  assert.match(statements, /commit;\s*$/);
});

check('it replaces no function another lane owns', () => {
  for (const fn of ['production_deliverable_write', 'production_intake_append', 'production_intake_root_begin',
    'production_component_fill', 'mirror_outbox_enqueue', 'production_labels_write', 'production_label_catalog_capability']) {
    assert.ok(!statements.includes(`function public.${fn}`), `migration touches ${fn}`);
  }
});

check('installing it is a no-op: both teams seed as provider', () => {
  const seed = statements.split("insert into public.syncview_runtime_flags")[1].split(';')[0];
  assert.match(seed, /'production_native_identifier_mint'/);
  assert.match(seed, /"video":\{"mode":"provider"\}/);
  assert.match(seed, /"graphics":\{"mode":"provider"\}/);
  assert.match(seed, /on conflict \(key\) do nothing/);
});

check('the capability self-guards — it is not the label trap again', () => {
  const body = statements.split('production_native_identifier_capability(p_team text)')[1].split('$fn$;')[0];
  /* it must read BOTH the flag and the seed table, and must return provider
     when the seed is absent however the flag reads. OPEN_REPAIRS 165.6. */
  assert.match(body, /syncview_runtime_flags[\s\S]*production_native_identifier_mint/);
  assert.match(body, /from public\.production_native_identifier_mint where team = p_team/);
  assert.match(body, /if v_team->>'mode' <> 'native' or not found then[\s\S]*'mode', 'provider'/);
  const labels = path.join(root, 'migrations/2026-09-06-native-label-writes.sql');
  if (fs.existsSync(labels)) {
    const capability = fs.readFileSync(labels, 'utf8').split('production_label_catalog_capability() returns jsonb')[1].split('$$;')[0];
    refutes(/production_label_catalog_versions/, capability,
      'the label capability now self-guards too; the contrast this test documents needs revisiting');
  }
});

check('name stability is NOT flag-gated: the update branch runs whatever the flag says', () => {
  const body = statements.split('production_native_identifier_guard()')[1].split('$fn$;')[0];
  /* split on the two branch openings rather than on `end if;`, which appears
     several times inside the insert branch itself */
  const insertAt = body.indexOf("if tg_op = 'INSERT' then");
  const updateAt = body.indexOf('if coalesce(btrim(old.linear_identifier)');
  assert.ok(insertAt >= 0 && updateAt > insertAt, 'the guard no longer has the two branches this test reads');
  const insertBranch = body.slice(insertAt, updateAt);
  assert.match(insertBranch, /production_native_identifier_capability/);
  assert.match(insertBranch, /production_native_identifier_allocate\(new\.team, new\.id\)/);
  const updateBranch = body.slice(updateAt);
  refutes(/capability/, updateBranch,
    'the update branch consults the flag; a flag flip could then rename a published card');
  assert.match(updateBranch, /new\.linear_identifier := old\.linear_identifier/);
  assert.match(updateBranch, /provider_identifier_refused = new\.linear_identifier/);
});

check('a provider-named row is left alone, so linear-inbound:810 still refreshes today', () => {
  const body = statements.split('production_native_identifier_guard()')[1].split('$fn$;')[0];
  assert.match(body, /from public\.production_native_identifier_grants\s*\n?\s*where identifier = old\.linear_identifier and deliverable_id = old\.id;\s*\n?\s*if not found then return new; end if;/);
});

check('allocation is serialised by a row lock, not by a read-then-write', () => {
  const body = statements.split('production_native_identifier_allocate(p_team text, p_deliverable_id text)')[1].split('$fn$;')[0];
  assert.match(body, /update public\.production_native_identifier_mint\s*\n?\s*set next_ordinal = next_ordinal \+ 1/);
  assert.match(body, /returning prefix, next_ordinal - 1 into v_prefix, v_ordinal/);
  refutes(/select\s+next_ordinal\s+into/i, body, 'reads the cursor before updating it, which races');
  assert.match(body, /not exists \(select 1 from public\.deliverables where linear_identifier = v_identifier\)/);
});

check('the seed derives its prefix and refuses to guess between two', () => {
  const body = statements.split('production_native_identifier_seed(p_team text, p_gap bigint default 100000)')[1].split('$fn$;')[0];
  assert.match(body, /native_identifier_prefix_ambiguous/);
  assert.match(body, /native_identifier_no_provider_names/);
  assert.match(body, /native_identifier_already_seeded/);
  assert.match(body, /from public\.deliverables d/);
  refutes(/LINEAR_VIDEO_TEAM_ID|'VID'|'GRA'/, body, 'the prefix is hard-coded rather than derived');
});

check('the new tables are revoked from the browser roles', () => {
  for (const table of ['production_native_identifier_mint', 'production_native_identifier_grants']) {
    assert.match(statements, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated, service_role`));
    assert.match(statements, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(statements, /grant execute on function public\.production_native_identifier_capability\(text\),\s*\n?\s*public\.production_native_identifier_seed\(text, bigint\) to service_role/);
  refutes(/grant[\s\S]{0,200}production_native_identifier_allocate[\s\S]{0,80}to service_role/, statements,
    'the allocator is grantable directly; it should only ever run from the trigger');
});

check('the browser needs no change — displayId already prefers linear_identifier', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(html.includes("displayId: linearIdent || importIdent || String(d.id || '')"),
    'index.html no longer resolves displayId from linear_identifier first; the mint would stop being visible');
  assert.ok(html.includes("const linearIdent = String(d.linear_identifier || '');"));
});

check('the provider writers this replaces are still where the ledger says, and both reach the table', () => {
  const outbound = fs.readFileSync(path.join(root, 'supabase/functions/linear-outbound/index.ts'), 'utf8');
  const inbound = fs.readFileSync(path.join(root, 'supabase/functions/linear-inbound/index.ts'), 'utf8');
  /* OPEN_REPAIRS 162's correction names linear-outbound:857 and :868 as the mint
     for SyncView-native cards. On origin/main the two sites carry the minted
     value as `completeIssue.identifier`: one into production_issue_create_linkage
     as `p_issue.identifier`, one into deliverable_write as `linear_identifier`.
     BOTH are RPCs that write public.deliverables, which is why the mint is a
     trigger on the table and not a change to either function. */
  const mints = (outbound.match(/clean\(completeIssue\.identifier\)/g) || []).length;
  assert.equal(mints, 2, `expected the two outbound mint sites, found ${mints}`);
  assert.match(outbound, /supabase\.rpc\("production_issue_create_linkage"/);
  assert.match(outbound, /supabase\.rpc\("deliverable_write"/);
  /* linear-inbound:810 is the refresh, the third writer */
  assert.match(inbound, /row\.linear_identifier = linearIdentifier\(issue\) \|\| clean\(existing\.linear_identifier\)/);
  /* production-write mints nothing. It writes `identifier: null` on create and
     only ever COPIES an existing linear_identifier through (index.ts:1576).
     That is the hole this migration closes. */
  const write = fs.readFileSync(path.join(root, 'supabase/functions/production-write/index.ts'), 'utf8');
  assert.ok(write.includes('identifier: null'), 'production-write no longer creates rows with a null identifier');
  const copies = write.match(/linear_identifier:[^\n]*/g) || [];
  assert.deepEqual(copies, ['linear_identifier: clean(row.linear_identifier) || null,'],
    `production-write writes linear_identifier somewhere new: ${copies.join(' | ')}`);
});

/* ------------------------------------------------------------------------- */

if (process.env.F63_REQUIRE_POSTGRES === '1') {
  const proof = path.join(root, 'qa/native-identifier-mint/sql-proof.js');
  const result = spawnSync(process.execPath, [proof], {
    env: { ...process.env, NATIVE_IDENTIFIER_MINT_CONFIRM: 'LOCAL_DISPOSABLE_ONLY' },
    stdio: 'inherit', windowsHide: true, timeout: 300000,
  });
  assert.equal(result.status, 0, 'the disposable-PostgreSQL proof failed');
  passed += 1;
  console.log('OK  the disposable-PostgreSQL behavioural proof passed');
} else {
  console.log('SKIP behavioural proof: set F63_REQUIRE_POSTGRES=1 with a disposable PostgreSQL 16 to run qa/native-identifier-mint/sql-proof.js');
}

console.log(`\nnative-identifier-mint: ${passed} passed, 0 failed ✅`);
