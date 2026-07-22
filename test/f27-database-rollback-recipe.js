'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  BOUNDARY_FUNCTIONS,
  MUTATING_F27_FUNCTIONS,
  generateRollbackRecipe,
  parseArgs,
  publicFailure,
} = require('../scripts/f27-database-rollback-recipe');
const {
  WINDOWS_PRIVATE_ACL_FORMAT,
  sealBundle,
} = require('../scripts/f27-mirror-outbox-snapshot');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log(`  ok  ${message}`);
  else { failures += 1; console.error(`FAIL  ${message}`); }
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
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
const SECRET = 'private row body token=fixture-private-secret';
const PROJECTION = ['id', 'deliverable_id', 'payload', 'created_at', 'team', 'status', 'dedup_key'];
const FLAGS = {
  linear_legacy_parity_enabled: { enabled: false },
  linear_outbound_enabled: { mode: 'off' },
  prod_authority: { graphics: 'linear', video: 'linear' },
};
const ROWS = [
  {
    id: 1,
    deliverable_id: 'fixture-private-deliverable',
    payload: { body: SECRET },
    created_at: '2026-07-22T12:00:00+00:00',
    team: 'video',
    status: 'pending',
    dedup_key: 'fixture-private-dedup',
  },
  {
    id: 2,
    deliverable_id: 'fixture-private-deliverable-two',
    payload: { body: 'second private row body' },
    created_at: '2026-07-22T12:01:00+00:00',
    team: 'graphics',
    status: 'written',
    dedup_key: 'fixture-private-dedup-two',
  },
];

const ENQUEUE_DEFINITION = `CREATE OR REPLACE FUNCTION public.mirror_outbox_enqueue(p_entity text, p_entity_id text, p_operation text, p_payload jsonb, p_dedup_key text, p_source_edited_at timestamp with time zone, p_client_slug text, p_team text, p_actor text DEFAULT NULL::text, p_role text DEFAULT NULL::text, p_deliverable_id text DEFAULT NULL::text, p_batch_id text DEFAULT NULL::text, p_comment_id text DEFAULT NULL::text, p_depends_on_id bigint DEFAULT NULL::bigint, p_test_only boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN 1;
END;
$function$
`;

const AUTHORITY_DEFINITION = `CREATE OR REPLACE FUNCTION public.production_assert_authority(p_client_slug text, p_team text, p_test_only boolean, p_legacy_parity boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM 1;
END;
$function$
`;

function fixtureFiles(mutator) {
  const functions = [
    {
      name: 'mirror_outbox_enqueue',
      regprocedure_identity: BOUNDARY_FUNCTIONS[0].identity,
      owner: 'postgres',
      acl: null,
      config: ['search_path=public'],
      definition: ENQUEUE_DEFINITION,
    },
    {
      name: 'production_assert_authority',
      regprocedure_identity: BOUNDARY_FUNCTIONS[1].identity,
      owner: 'postgres',
      acl: ['postgres=X/postgres', 'service_role=X/postgres'],
      config: ['search_path=public'],
      definition: AUTHORITY_DEFINITION,
    },
  ];
  const values = {
    metadata: {
      format: 'syncview-f27-mirror-outbox-snapshot-v1',
      release_sha: RELEASE_SHA,
      migration_sha256: MIGRATION_SHA,
      project_ref: PROJECT_REF,
      database: 'postgres',
    },
    runtime: { flags: FLAGS, flag_flips_count: 17 },
    projection: [...PROJECTION],
    rows: ROWS.map(row => ({ ...row, payload: { ...row.payload } })),
    functions,
  };
  if (mutator) mutator(values);
  return new Map([
    ['database/mirror_outbox.rows.jsonl', Buffer.from(values.rows.map(row => stableJson(row)).join('\n') + (values.rows.length ? '\n' : ''), 'utf8')],
    ['database/mirror_outbox.preinstall-column-projection.json', Buffer.from(stableJson(values.projection), 'utf8')],
    ['database/mirror_outbox.functions.jsonl', Buffer.from(values.functions.map(value => stableJson(value)).join('\n') + (values.functions.length ? '\n' : ''), 'utf8')],
    ['database/runtime-safety-state.json', Buffer.from(stableJson(values.runtime), 'utf8')],
    ['metadata/snapshot.json', Buffer.from(stableJson(values.metadata), 'utf8')],
  ]);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'f27-db-rollback-test-'));
const simulatedWorktree = path.join(tempRoot, 'public-worktree');
const privateRoot = path.join(tempRoot, 'private-vault');
fs.mkdirSync(simulatedWorktree, { recursive: true, mode: 0o700 });
fs.mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
if (process.platform !== 'win32') {
  fs.chmodSync(simulatedWorktree, 0o700);
  fs.chmodSync(privateRoot, 0o700);
}

let bundleIndex = 0;
function writeBundle(mutator) {
  const sealed = sealBundle(fixtureFiles(mutator), { snapshot_time: '2026-07-22T12:02:00+00:00' });
  const bundlePath = path.join(privateRoot, `fixture-${bundleIndex += 1}.snapshot`);
  fs.writeFileSync(bundlePath, sealed.bundleBytes, { flag: 'wx', mode: 0o600 });
  fs.chmodSync(bundlePath, 0o400);
  return { bundlePath, bundleSha256: sealed.bundleSha256, bundleBytes: sealed.bundleBytes };
}

function options(bundle, outputName) {
  return {
    confirmed: true,
    bundlePath: bundle.bundlePath,
    expectedBundleSha256: bundle.bundleSha256,
    outputPath: path.join(privateRoot, outputName),
    projectRef: PROJECT_REF,
    database: 'postgres',
    releaseSha: RELEASE_SHA,
    worktreeRoots: [simulatedWorktree],
    releaseInfo: {
      headSha: RELEASE_SHA, originMainSha: RELEASE_SHA, dirty: false, migrationSha256: MIGRATION_SHA,
    },
    aclPlatform: 'linux',
  };
}

try {
  const bundle = writeBundle();
  const outputPath = path.join(privateRoot, 'rollback.sql');
  const receipt = generateRollbackRecipe(options(bundle, 'rollback.sql'));
  const receiptText = JSON.stringify(receipt);
  const recipe = fs.readFileSync(outputPath, 'utf8');

  ok(receipt.status === 'PASS'
    && receipt.snapshot_bundle_sha256 === bundle.bundleSha256
    && /^[a-f0-9]{64}$/.test(receipt.rollback_recipe_sha256)
    && receipt.captured_preinstall_row_count === ROWS.length
    && receipt.restored_boundary_function_count === BOUNDARY_FUNCTIONS.length
    && receipt.static_validation === 'PASS'
    && receipt.private_readback === 'PASS',
  'generator emits only public-safe hash, count, and PASS evidence');
  ok(Object.keys(receipt).sort().join(',') === [
    'captured_preinstall_row_count', 'private_readback', 'restored_boundary_function_count',
    'rollback_recipe_sha256', 'snapshot_bundle_sha256', 'static_validation', 'status',
  ].sort().join(',') && !receiptText.includes(SECRET) && !receiptText.includes(privateRoot)
    && !receiptText.includes(PROJECT_REF) && !receiptText.includes(RELEASE_SHA),
  'public receipt excludes private paths, binders, and row bodies');
  ok(sha256(Buffer.from(recipe, 'utf8')) === receipt.rollback_recipe_sha256,
    'private recipe readback hash matches the public receipt');
  ok((recipe.match(/\bBEGIN;/g) || []).length === 1
    && (recipe.match(/\bCOMMIT;/g) || []).length === 1
    && recipe.indexOf('LOCK TABLE public.mirror_outbox IN ACCESS EXCLUSIVE MODE;')
      < recipe.indexOf('ALTER TABLE public.mirror_outbox DISABLE TRIGGER track_b_f27_hold_guard;')
    && recipe.includes('F27_ROLLBACK_GUARD_TRIGGER_MISMATCH')
    && recipe.includes("t.tgenabled='O'")
    && recipe.includes("v_trigger_enabled IS DISTINCT FROM 'D'"),
  'one transaction locks the queue, asserts the fence, and leaves the guard disabled');
  ok(recipe.includes("\\if :{?f27_release_sha}")
    && recipe.includes(`SELECT :'f27_release_sha' = '${RELEASE_SHA}'`)
    && recipe.includes(`SELECT :'f27_project_ref' = '${PROJECT_REF}'`)
    && recipe.includes("SELECT :'f27_database' = 'postgres'")
    && recipe.includes(`SELECT :'f27_snapshot_bundle_sha256' = '${bundle.bundleSha256}'`)
    && recipe.includes("current_database() IS DISTINCT FROM 'postgres'"),
  'recipe is bound to the exact release, project, snapshot, and database');
  ok(BOUNDARY_FUNCTIONS.every(fn => recipe.includes(fn.identity))
    && recipe.includes('EXECUTE f.definition;')
    && recipe.includes("ALTER FUNCTION %s OWNER TO %I")
    && recipe.includes("ALTER FUNCTION %s RESET ALL")
    && recipe.includes("ALTER FUNCTION %s SET %I FROM CURRENT")
    && recipe.includes('raw_acl aclitem[]')
    && recipe.includes('p.proacl IS DISTINCT FROM f.raw_acl')
    && recipe.includes('F27_ROLLBACK_BOUNDARY_OWNER_OR_ACL_DRIFT')
    && recipe.includes('F27_ROLLBACK_BOUNDARY_FUNCTION_READBACK_MISMATCH'),
  'captured definitions, owners, config, and exact raw ACL form are restored or fail closed');
  ok(MUTATING_F27_FUNCTIONS.every(identity => recipe.includes(
    `REVOKE EXECUTE ON FUNCTION ${identity} FROM PUBLIC, anon, authenticated, service_role;`,
  )) && recipe.includes('F27_ROLLBACK_MUTATING_RPC_GRANT_RETAINED'),
  'every mutating F27 RPC loses service_role EXECUTE and is verified');
  ok(PROJECTION.every(column => recipe.includes(`o."${column}" AS "${column}"`))
    && recipe.includes('F27_ROLLBACK_PREINSTALL_ROW_PROJECTION_CHANGED')
    && !recipe.includes(SECRET)
    && !recipe.includes(ROWS[0].dedup_key)
    && recipe.includes(Buffer.from(stableJson(ROWS[0]), 'utf8').toString('base64')),
  'every captured row is embedded privately and compared on its exact old-column projection');
  ok(recipe.includes('F27_ROLLBACK_ADDITIVE_OBJECTS_NOT_RETAINED')
    && recipe.includes('F27_ROLLBACK_AUDIT_ROWS_CHANGED')
    && recipe.includes('F27_ROLLBACK_RUNTIME_SAFETY_CHANGED')
    && recipe.includes('public.flag_flips')
    && !/DROP\s+(?:TABLE|SCHEMA|COLUMN)/i.test(recipe)
    && !/DELETE\s+FROM\s+(?:public\.)?track_b_/i.test(recipe)
    && !/TRUNCATE\s+(?:public\.)?track_b_/i.test(recipe),
  'additive schema, audit history, runtime flags, and flag-flip count are retained');

  const safeAcl = aclAdapter();
  const aclReceipt = generateRollbackRecipe({
    ...options(bundle, 'windows-acl.sql'),
    aclPlatform: 'win32',
    privateAclAdapter: safeAcl,
  });
  ok(aclReceipt.status === 'PASS'
      && safeAcl.calls.length === 1
      && safeAcl.calls[0].action === 'verify-file'
      && safeAcl.calls[0].target === path.resolve(bundle.bundlePath),
  'rollback recipe generation proves the sealed snapshot Windows ACL before reading row bodies');

  const broadAclOutput = path.join(privateRoot, 'windows-broad.sql');
  const broadAcl = aclAdapter({ unexpected_access_rule_count: 1 });
  ok(errorCode(() => generateRollbackRecipe({
    ...options(bundle, 'windows-broad.sql'),
    aclPlatform: 'win32',
    privateAclAdapter: broadAcl,
  })) === 'WINDOWS_PRIVATE_ACL_REQUIRED'
      && broadAcl.calls.length === 1
      && !fs.existsSync(broadAclOutput),
  'a broad snapshot ACL refuses rollback recipe generation before private output is written');

  const tampered = writeBundle();
  fs.chmodSync(tampered.bundlePath, 0o600);
  fs.appendFileSync(tampered.bundlePath, 'x');
  fs.chmodSync(tampered.bundlePath, 0o400);
  ok(errorCode(() => generateRollbackRecipe(options(tampered, 'tampered.sql')))
    === 'PRIVATE_BUNDLE_HASH_MISMATCH', 'tampered sealed bundle fails closed before output');
  ok(errorCode(() => generateRollbackRecipe({
    ...options(bundle, 'wrong-hash.sql'), expectedBundleSha256: 'c'.repeat(64),
  })) === 'PRIVATE_BUNDLE_HASH_MISMATCH', 'wrong expected bundle hash fails closed');

  const wrongProject = writeBundle(values => { values.metadata.project_ref = 'zyxwvutsrqponmlkjihg'; });
  ok(errorCode(() => generateRollbackRecipe(options(wrongProject, 'wrong-project.sql')))
    === 'PRIVATE_BUNDLE_BINDING_MISMATCH', 'snapshot project mismatch fails closed');
  const wrongDatabase = writeBundle(values => { values.metadata.database = 'other_database'; });
  ok(errorCode(() => generateRollbackRecipe(options(wrongDatabase, 'wrong-database.sql')))
    === 'PRIVATE_BUNDLE_BINDING_MISMATCH', 'snapshot database mismatch fails closed');
  const wrongRelease = writeBundle(values => { values.metadata.release_sha = 'd'.repeat(40); });
  ok(errorCode(() => generateRollbackRecipe(options(wrongRelease, 'wrong-release.sql')))
    === 'PRIVATE_BUNDLE_BINDING_MISMATCH', 'snapshot release mismatch fails closed');

  const missingFunction = writeBundle(values => { values.functions.pop(); });
  ok(errorCode(() => generateRollbackRecipe(options(missingFunction, 'missing-function.sql')))
    === 'PRIVATE_BOUNDARY_FUNCTION_MISSING', 'missing boundary-function capture fails closed');
  const malformedAcl = writeBundle(values => { values.functions[1].acl = [{}]; });
  ok(errorCode(() => generateRollbackRecipe(options(malformedAcl, 'bad-acl.sql')))
    === 'PRIVATE_BOUNDARY_FUNCTION_INVALID', 'malformed captured ACL fails closed');
  ok(errorCode(() => generateRollbackRecipe({
    ...options(bundle, 'dirty.sql'),
    releaseInfo: {
      headSha: RELEASE_SHA, originMainSha: RELEASE_SHA, dirty: true, migrationSha256: MIGRATION_SHA,
    },
  })) === 'DIRTY_SOURCE_REJECTED', 'dirty release source fails closed');
  ok(errorCode(() => generateRollbackRecipe({
    ...options(bundle, 'origin-main-mismatch.sql'),
    releaseInfo: {
      headSha: RELEASE_SHA, originMainSha: 'f'.repeat(40), dirty: false, migrationSha256: MIGRATION_SHA,
    },
  })) === 'ORIGIN_MAIN_MISMATCH', 'local origin/main must equal HEAD and the requested release');
  ok(errorCode(() => generateRollbackRecipe({ ...options(bundle, 'unconfirmed.sql'), confirmed: false }))
    === 'CONFIRMATION_REQUIRED', 'explicit confirmation is mandatory');

  const publicBundle = path.join(simulatedWorktree, 'snapshot.snapshot');
  fs.writeFileSync(publicBundle, bundle.bundleBytes, { flag: 'wx', mode: 0o600 });
  fs.chmodSync(publicBundle, 0o400);
  ok(errorCode(() => generateRollbackRecipe({
    ...options(bundle, 'public-input.sql'), bundlePath: publicBundle,
  })) === 'PRIVATE_BUNDLE_WORKTREE_REJECTED', 'bundle inside any worktree is rejected');
  ok(errorCode(() => generateRollbackRecipe({
    ...options(bundle, 'ignored.sql'), outputPath: path.join(simulatedWorktree, 'rollback.sql'),
  })) === 'PRIVATE_OUTPUT_WORKTREE_REJECTED', 'recipe output inside any worktree is rejected');
  ok(errorCode(() => generateRollbackRecipe(options(bundle, 'rollback.sql')))
    === 'PRIVATE_OUTPUT_EXISTS', 'existing private recipe is never overwritten');

  ok(errorCode(() => parseArgs([
    '--bundle=a', '--bundle=b', '--expected-bundle-sha256=' + bundle.bundleSha256,
    '--output=c', '--confirm-project-ref=' + PROJECT_REF, '--confirm-database=postgres',
    '--release-sha=' + RELEASE_SHA,
  ])) === 'ARGUMENT_REJECTED'
    && errorCode(() => parseArgs(['--unknown=value'])) === 'ARGUMENT_REJECTED',
  'duplicate and unknown CLI arguments fail closed');
  const publicErrorText = JSON.stringify(publicFailure(new Error(`${SECRET} ${privateRoot}`)));
  ok(publicErrorText === '{"status":"FAIL","code":"ROLLBACK_RECIPE_FAILED"}'
    && !publicErrorText.includes(SECRET) && !publicErrorText.includes(privateRoot),
  'unexpected failures expose no private values');

  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'f27-database-rollback-recipe.js'), 'utf8');
  ok(!source.includes('console.log') && !source.includes('console.error')
    && source.includes('process.stdout.write') && source.includes('process.stderr.write'),
  'CLI has one public JSON success channel and one sanitized failure channel');
} finally {
  if (process.platform !== 'win32') fs.chmodSync(privateRoot, 0o700);
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} F27 database rollback recipe test(s) failed.`);
  process.exit(1);
}
console.log('\nF27 database rollback recipe tests passed.');
