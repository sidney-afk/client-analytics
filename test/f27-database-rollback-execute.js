'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  CONFIRMATION,
  executeRollback,
  parseArgs,
  publicFailure,
  sanitizedChildEnvironment,
} = require('../scripts/f27-database-rollback-execute');
const {
  BOUNDARY_FUNCTIONS,
  buildRecipe,
} = require('../scripts/f27-database-rollback-recipe');
const { WINDOWS_PRIVATE_ACL_FORMAT } = require('../scripts/f27-mirror-outbox-snapshot');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log(`  ok  ${message}`);
  else { failures += 1; console.error(`FAIL  ${message}`); }
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function errorCode(fn) {
  try { fn(); return null; }
  catch (error) { return error && error.code; }
}

const ACL_USER_SID = 'S-1-5-21-111-222-333-1001';
function aclAdapter(overrides = {}) {
  const calls = [];
  return {
    calls,
    run(action, target) {
      calls.push({ action, target });
      return {
        format: WINDOWS_PRIVATE_ACL_FORMAT,
        action,
        path_kind: 'file',
        current_user_sid: ACL_USER_SID,
        owner_sid: ACL_USER_SID,
        allowed_sids: [ACL_USER_SID, 'S-1-5-18', 'S-1-5-32-544'].sort(),
        access_rule_count: 3,
        access_rules_protected: true,
        unexpected_access_rule_count: 0,
        deny_rule_count: 0,
        current_user_full_control: true,
        ...overrides,
      };
    },
  };
}

const PROJECT_REF = 'abcdefghijklmnopqrst';
const RELEASE_SHA = 'a'.repeat(40);
const MIGRATION_SHA = 'b'.repeat(64);
const SNAPSHOT_SHA = 'c'.repeat(64);
const PASSWORD = 'fixture-db-password';
const SECRET = 'private psql failure row-body fixture';
const FLAGS = {
  linear_legacy_parity_enabled: { enabled: false },
  linear_outbound_enabled: { mode: 'off' },
  prod_authority: { graphics: 'linear', video: 'linear' },
};

function recipeText() {
  const row = {
    id: 1,
    deliverable_id: 'private-fixture-deliverable',
    payload: { body: 'private fixture body' },
    created_at: '2026-07-22T13:00:00+00:00',
    team: 'video',
    status: 'pending',
    dedup_key: 'private-fixture-dedup',
  };
  return buildRecipe({
    rows: [{ raw: JSON.stringify(row), value: row }],
    projection: ['id', 'deliverable_id', 'payload', 'created_at', 'team', 'status', 'dedup_key'],
    runtime: { flags: FLAGS, flagFlipsCount: 17 },
    functions: [
      {
        name: 'mirror_outbox_enqueue', identity: BOUNDARY_FUNCTIONS[0].identity,
        owner: 'postgres', acl: null, config: ['search_path=public'],
        definition: 'CREATE OR REPLACE FUNCTION public.mirror_outbox_enqueue(text,text,text,jsonb,text,timestamp with time zone,text,text,text,text,text,text,text,bigint,boolean) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;\n',
      },
      {
        name: 'production_assert_authority', identity: BOUNDARY_FUNCTIONS[1].identity,
        owner: 'postgres', acl: ['postgres=X/postgres'], config: ['search_path=public'],
        definition: 'CREATE OR REPLACE FUNCTION public.production_assert_authority(text,text,boolean,boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN NULL; END $$;\n',
      },
    ],
  }, {
    releaseSha: RELEASE_SHA,
    projectRef: PROJECT_REF,
    database: 'postgres',
    expectedBundleSha256: SNAPSHOT_SHA,
  });
}

function privateDirectory(root, name) {
  const target = path.join(root, name);
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(target, 0o700);
  return target;
}

function writePrivate(root, name, bytes) {
  const target = path.join(root, name);
  fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
  fs.chmodSync(target, 0o400);
  return target;
}

function adapter(result = {}) {
  const calls = [];
  return {
    calls,
    version() { calls.push({ type: 'version' }); return result.version || 'psql (PostgreSQL) 16.4'; },
    execute(argv, env, input) {
      calls.push({ type: 'execute', argv, env, input });
      if (result.throwError) throw result.throwError;
      return {
        status: Object.prototype.hasOwnProperty.call(result, 'status') ? result.status : 0,
        signal: result.signal || null,
        error: result.error || null,
        stdout: result.stdout || Buffer.alloc(0),
        stderr: result.stderr || Buffer.alloc(0),
      };
    },
  };
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'f27-db-executor-test-'));
const simulatedWorktree = privateDirectory(tempRoot, 'public-worktree');
const privateRoot = privateDirectory(tempRoot, 'private-vault');
const recipeBytes = Buffer.from(recipeText(), 'utf8');
const recipePath = writePrivate(privateRoot, 'rollback.sql', recipeBytes);
const recipeHash = sha256(recipeBytes);
let transcriptIndex = 0;

function options(psqlAdapter, overrides = {}) {
  return {
    confirmation: CONFIRMATION,
    databaseUrl: `postgresql://postgres:${PASSWORD}@db.${PROJECT_REF}.supabase.co:5432/postgres?sslmode=require`,
    recipePath,
    expectedRecipeSha256: recipeHash,
    transcriptPath: path.join(privateRoot, `rollback-${transcriptIndex += 1}.transcript`),
    releaseSha: RELEASE_SHA,
    projectRef: PROJECT_REF,
    database: 'postgres',
    snapshotBundleSha256: SNAPSHOT_SHA,
    psqlAdapter,
    baseEnv: {
      PATH: process.env.PATH || '',
      SystemRoot: process.env.SystemRoot || '',
      PGHOST: 'attacker.invalid',
      pgpassword: 'hostile-lowercase-password',
      PGSERVICE: 'hostile-service',
      F27_DATABASE_URL: 'postgresql://should-not-reach-child',
      SUPABASE_ACCESS_TOKEN: 'must-not-reach-child',
    },
    worktreeRoots: [simulatedWorktree],
    releaseInfo: {
      headSha: RELEASE_SHA, originMainSha: RELEASE_SHA, dirty: false, migrationSha256: MIGRATION_SHA,
    },
    aclPlatform: 'linux',
    ...overrides,
  };
}

try {
  const successAdapter = adapter({
    stdout: Buffer.from('private-success-detail\n', 'utf8'),
    stderr: Buffer.from('NOTICE: private operator notice\n', 'utf8'),
  });
  const successOptions = options(successAdapter);
  const receipt = executeRollback(successOptions);
  const receiptText = JSON.stringify(receipt);
  const executeCall = successAdapter.calls.find(call => call.type === 'execute');
  const transcriptBytes = fs.readFileSync(successOptions.transcriptPath);
  const transcript = JSON.parse(transcriptBytes.toString('utf8'));

  ok(receipt.status === 'PASS'
    && receipt.rollback_recipe_sha256 === recipeHash
    && receipt.snapshot_bundle_sha256 === SNAPSHOT_SHA
    && /^[a-f0-9]{64}$/.test(receipt.private_transcript_sha256)
    && receipt.execution === 'PASS'
    && receipt.private_transcript_readback === 'PASS'
    && receipt.private_transcript_sha256 === sha256(transcriptBytes),
  'executor emits only hash and PASS evidence after private transcript readback');
  ok(Object.keys(receipt).sort().join(',') === [
    'execution', 'private_transcript_readback', 'private_transcript_sha256',
    'rollback_recipe_sha256', 'snapshot_bundle_sha256', 'status',
  ].sort().join(',')
    && !receiptText.includes(PROJECT_REF) && !receiptText.includes(RELEASE_SHA)
    && !receiptText.includes(PASSWORD) && !receiptText.includes(privateRoot),
  'public PASS receipt contains no project, release, credential, or private path');
  ok(transcript.format === 'syncview-f27-database-rollback-transcript-v1'
    && transcript.exit_status === 0 && transcript.signal === null && transcript.spawn_error_code === null
    && Buffer.from(transcript.stdout_base64, 'base64').toString('utf8') === 'private-success-detail\n'
    && Buffer.from(transcript.stderr_base64, 'base64').toString('utf8') === 'NOTICE: private operator notice\n',
  'private transcript captures exact psql output and terminal state without publishing it');
  ok(executeCall
    && executeCall.argv.includes(`f27_release_sha=${RELEASE_SHA}`)
    && executeCall.argv.includes(`f27_project_ref=${PROJECT_REF}`)
    && executeCall.argv.includes('f27_database=postgres')
    && executeCall.argv.includes(`f27_snapshot_bundle_sha256=${SNAPSHOT_SHA}`)
    && executeCall.argv.slice(-2).join(',') === '--file,-'
    && Buffer.isBuffer(executeCall.input) && executeCall.input.equals(recipeBytes)
    && !executeCall.argv.includes(recipePath)
    && !executeCall.argv.includes('-d')
    && !executeCall.argv.some(value => value === successOptions.databaseUrl || value === PASSWORD),
  'psql argv carries exact binders but no URL, password, path, or -d; verified bytes stream on stdin');
  ok(executeCall.env.PGHOST === `db.${PROJECT_REF}.supabase.co`
    && executeCall.env.PGPORT === '5432'
    && executeCall.env.PGDATABASE === 'postgres'
    && executeCall.env.PGUSER === 'postgres'
    && executeCall.env.PGPASSWORD === PASSWORD
    && executeCall.env.PGSSLMODE === 'require'
    && executeCall.env.PGAPPNAME === 'f27-database-rollback-executor'
    && !Object.keys(executeCall.env).includes('SUPABASE_ACCESS_TOKEN')
    && !Object.keys(executeCall.env).some(key => key.toLowerCase() === 'pgservice')
    && !Object.keys(executeCall.env).some(key => key.toLowerCase() === 'f27_database_url')
    && !Object.values(executeCall.env).includes('hostile-lowercase-password'),
  'connection exists only in a scrubbed PG environment derived from the exact URL parser');

  const safeAcl = aclAdapter();
  const safeAclPsql = adapter();
  const safeAclOptions = options(safeAclPsql, {
    aclPlatform: 'win32', privateAclAdapter: safeAcl,
  });
  const safeAclReceipt = executeRollback(safeAclOptions);
  ok(safeAclReceipt.status === 'PASS'
      && safeAcl.calls.length === 1
      && safeAcl.calls[0].action === 'verify-file'
      && safeAcl.calls[0].target === path.resolve(recipePath),
  'rollback execution proves the private recipe Windows ACL before reading embedded row bodies');

  const broadAcl = aclAdapter({ unexpected_access_rule_count: 1 });
  const broadAclPsql = adapter();
  const broadAclOptions = options(broadAclPsql, {
    aclPlatform: 'win32', privateAclAdapter: broadAcl,
  });
  ok(errorCode(() => executeRollback(broadAclOptions)) === 'WINDOWS_PRIVATE_ACL_REQUIRED'
      && broadAcl.calls.length === 1
      && broadAclPsql.calls.length === 0
      && !fs.existsSync(broadAclOptions.transcriptPath),
  'a broad recipe ACL refuses rollback execution before psql or transcript creation');

  const sanitized = sanitizedChildEnvironment(
    { PgHoSt: 'evil', pgpassword: 'evil', F27_DATABASE_URL: 'secret', SAFE: 'no', PATH: 'safe-path' },
    { PGHOST: 'exact', PGPASSWORD: 'exact-secret' },
  );
  ok(sanitized.PGHOST === 'exact' && sanitized.PGPASSWORD === 'exact-secret'
    && sanitized.PATH === 'safe-path' && sanitized.SAFE === undefined
    && !Object.keys(sanitized).some(key => key === 'PgHoSt' || key === 'pgpassword')
    && !Object.keys(sanitized).some(key => key.toLowerCase() === 'f27_database_url'),
  'case-insensitive inherited PG and F27 connection variables are scrubbed');

  const noCall = adapter();
  ok(errorCode(() => executeRollback(options(noCall, { confirmation: '1' }))) === 'CONFIRMATION_REQUIRED'
    && noCall.calls.length === 0, 'exact high-friction confirmation is mandatory before psql');
  ok(errorCode(() => executeRollback(options(adapter(), { recipePath: 'relative.sql' })))
    === 'PRIVATE_RECIPE_INPUT_INVALID', 'recipe path must be absolute');

  const publicRecipe = writePrivate(simulatedWorktree, 'rollback.sql', recipeBytes);
  ok(errorCode(() => executeRollback(options(adapter(), { recipePath: publicRecipe })))
    === 'PRIVATE_RECIPE_WORKTREE_REJECTED', 'recipe inside any Git worktree is rejected');
  ok(errorCode(() => executeRollback(options(adapter(), { expectedRecipeSha256: 'd'.repeat(64) })))
    === 'PRIVATE_RECIPE_HASH_MISMATCH', 'wrong recipe hash fails before psql');

  const wrongBinderBytes = Buffer.from(recipeText().replace(
    `SELECT :'f27_project_ref' = '${PROJECT_REF}'`,
    "SELECT :'f27_project_ref' = 'zyxwvutsrqponmlkjihg'",
  ), 'utf8');
  const wrongBinderPath = writePrivate(privateRoot, 'wrong-binder.sql', wrongBinderBytes);
  ok(errorCode(() => executeRollback(options(adapter(), {
    recipePath: wrongBinderPath, expectedRecipeSha256: sha256(wrongBinderBytes),
  }))) === 'PRIVATE_RECIPE_CONTRACT_MISMATCH', 'recipe binder mismatch fails before psql');

  const metaBytes = Buffer.from(`${recipeText()}\\! echo forbidden\n`, 'utf8');
  const metaPath = writePrivate(privateRoot, 'meta-command.sql', metaBytes);
  ok(errorCode(() => executeRollback(options(adapter(), {
    recipePath: metaPath, expectedRecipeSha256: sha256(metaBytes),
  }))) === 'PRIVATE_RECIPE_CONTRACT_MISMATCH', 'unsafe psql meta-command is rejected even with a matching hash');
  const backtickBytes = Buffer.from(`${recipeText()}\\set hostile \`echo forbidden\`\n`, 'utf8');
  const backtickPath = writePrivate(privateRoot, 'backtick-command.sql', backtickBytes);
  ok(errorCode(() => executeRollback(options(adapter(), {
    recipePath: backtickPath, expectedRecipeSha256: sha256(backtickBytes),
  }))) === 'PRIVATE_RECIPE_CONTRACT_MISMATCH', 'psql backtick command substitution is rejected even with a matching hash');

  ok(errorCode(() => executeRollback(options(adapter(), {
    transcriptPath: path.join(simulatedWorktree, 'public.transcript'),
  }))) === 'PRIVATE_TRANSCRIPT_WORKTREE_REJECTED', 'transcript inside any worktree is rejected');
  const existingTranscript = writePrivate(privateRoot, 'existing.transcript', Buffer.from('existing', 'utf8'));
  ok(errorCode(() => executeRollback(options(adapter(), { transcriptPath: existingTranscript })))
    === 'PRIVATE_TRANSCRIPT_EXISTS'
    && fs.readFileSync(existingTranscript, 'utf8') === 'existing',
  'existing transcript is never overwritten');

  const originAdapter = adapter();
  ok(errorCode(() => executeRollback(options(originAdapter, {
    releaseInfo: {
      headSha: RELEASE_SHA, originMainSha: 'e'.repeat(40), dirty: false, migrationSha256: MIGRATION_SHA,
    },
  }))) === 'ORIGIN_MAIN_MISMATCH' && originAdapter.calls.length === 0,
  'executor also requires local origin/main, HEAD, and requested release equality');

  for (const hostileUrl of [
    `postgresql://postgres:${PASSWORD}@db.${PROJECT_REF}.supabase.co.evil.invalid:5432/postgres?sslmode=require`,
    `postgresql://attacker.${PROJECT_REF}:${PASSWORD}@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require`,
    `postgresql://postgres:${PASSWORD}@db.${PROJECT_REF}.supabase.co:6543/postgres?sslmode=require`,
    `postgresql://postgres:${PASSWORD}@db.${PROJECT_REF}.supabase.co:5432/postgres?sslmode=disable`,
  ]) {
    const hostileAdapter = adapter();
    const code = errorCode(() => executeRollback(options(hostileAdapter, { databaseUrl: hostileUrl })));
    ok(['PROJECT_CONFIRMATION_MISMATCH', 'DATABASE_URL_INVALID'].includes(code)
      && hostileAdapter.calls.length === 0, 'host, user, port, and TLS mismatch fails before psql');
  }
  ok(errorCode(() => executeRollback(options(adapter(), {
    databaseUrl: `postgresql://postgres@db.${PROJECT_REF}.supabase.co:5432/postgres?sslmode=require`,
  }))) === 'DATABASE_URL_PASSWORD_REQUIRED', 'passwordless live database URL is rejected');

  const failedAdapter = adapter({ status: 3, stderr: Buffer.from(`${SECRET} ${PASSWORD}`, 'utf8') });
  const failedOptions = options(failedAdapter);
  let executionError;
  try { executeRollback(failedOptions); } catch (error) { executionError = error; }
  const safeFailure = JSON.stringify(publicFailure(executionError));
  const failedTranscript = fs.readFileSync(failedOptions.transcriptPath);
  ok(executionError && executionError.code === 'PSQL_EXECUTION_FAILED'
    && safeFailure === '{"status":"FAIL","code":"PSQL_EXECUTION_FAILED"}'
    && !safeFailure.includes(SECRET) && !safeFailure.includes(PASSWORD)
    && failedTranscript.includes(Buffer.from(`${SECRET} ${PASSWORD}`, 'utf8').toString('base64')),
  'psql failure is public-safe while its exact diagnostic remains in the private transcript');

  const thrownAdapter = adapter({ throwError: new Error(`${SECRET} ${PASSWORD}`) });
  const thrownOptions = options(thrownAdapter);
  ok(errorCode(() => executeRollback(thrownOptions)) === 'PSQL_EXECUTION_FAILED'
    && fs.existsSync(thrownOptions.transcriptPath),
  'spawn exceptions still produce a reserved private transcript and sanitized failure');

  ok(errorCode(() => parseArgs([
    '--recipe=a', '--recipe=b', '--expected-recipe-sha256=' + recipeHash,
    '--transcript=c', '--release-sha=' + RELEASE_SHA, '--confirm-project-ref=' + PROJECT_REF,
    '--confirm-database=postgres', '--snapshot-bundle-sha256=' + SNAPSHOT_SHA,
  ])) === 'ARGUMENT_REJECTED'
    && errorCode(() => parseArgs(['--unknown=value'])) === 'ARGUMENT_REJECTED',
  'duplicate, incomplete, and unknown CLI arguments fail closed');

  const publicError = JSON.stringify(publicFailure(new Error(`${SECRET} ${PASSWORD} ${privateRoot}`)));
  ok(publicError === '{"status":"FAIL","code":"ROLLBACK_EXECUTOR_FAILED"}'
    && !publicError.includes(SECRET) && !publicError.includes(PASSWORD) && !publicError.includes(privateRoot),
  'unexpected failures expose no credentials, transcript, or private path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'f27-database-rollback-execute.js'), 'utf8');
  ok(!source.includes('console.log') && !source.includes('console.error')
    && source.includes('process.stdout.write') && source.includes('process.stderr.write')
    && !/['"]-d['"]/.test(source),
  'CLI exposes one bounded JSON receipt channel and never constructs a -d argument');
} finally {
  if (process.platform !== 'win32') fs.chmodSync(privateRoot, 0o700);
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} F27 database rollback executor test(s) failed.`);
  process.exit(1);
}
console.log('\nF27 database rollback executor tests passed.');
