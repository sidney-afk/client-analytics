'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  EXPECTED_WINDOW_P_RUNTIME_FLAGS,
  SnapshotCaptureError,
  WINDOWS_PRIVATE_ACL_FORMAT,
  assertWindowsPrivateFileAcl,
  captureSnapshot,
  defaultWindowsPrivateAclAdapter,
  expectedPreF27Baseline,
  fingerprintPost,
  normalizeFunctionSource,
  ownerGrantsMatchDefault,
  parseArgs,
  parseDatabaseUrl,
  parsePostTranscript,
  postContract,
  psqlCaptureFailure,
  publicFailure,
  reviewedPreF27SubsetContract,
  reviewedProductionAuthoritySource,
  reviewedWriteAuthorizationSource,
  safePsqlEnvironment,
  sqlText,
  verifyAfter,
  windowPPreflight,
} = require('../scripts/f27-mirror-outbox-snapshot');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures += 1; console.error('FAIL  ' + message); }
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < start) return '';
  return source.slice(start, end + endMarker.length).trim();
}

[
  ['write authorization', reviewedWriteAuthorizationSource()],
  ['production authority', reviewedProductionAuthoritySource()],
].forEach(([label, reviewed]) => {
  const crlf = reviewed.replace(/\n/g, '\r\n');
  const loneCr = reviewed.replace(/\n/g, '\r');
  const mutated = reviewed.replace(/\bbegin\b/, 'begin\n  raise notice \'semantic-drift\';');
  ok(normalizeFunctionSource(reviewed) === normalizeFunctionSource(crlf)
    && normalizeFunctionSource(reviewed) === normalizeFunctionSource(loneCr)
    && sha256(Buffer.from(normalizeFunctionSource(reviewed), 'utf8'))
      === sha256(Buffer.from(normalizeFunctionSource(crlf), 'utf8'))
    && sha256(Buffer.from(normalizeFunctionSource(reviewed), 'utf8'))
      === sha256(Buffer.from(normalizeFunctionSource(loneCr), 'utf8'))
    && normalizeFunctionSource(reviewed) !== normalizeFunctionSource(mutated),
  `${label} reviewed-source equality ignores only line-ending representation`);
});
const reviewedContract = reviewedPreF27SubsetContract();
ok(reviewedContract.format === 'syncview-f27-preinstall-reviewed-subset-v3'
  && reviewedContract.production_authority.identity
    === 'public.production_assert_authority(text,text,boolean,boolean)'
  && reviewedContract.production_authority.source_sha256
    === sha256(Buffer.from(reviewedProductionAuthoritySource(), 'utf8'))
  && !JSON.stringify(reviewedContract).includes('postgres=X/postgres')
  && reviewedContract.write_authorization.access.owner_privileges === 'SERVER_ACLDEFAULT',
'the reviewed baseline contract binds the normalized 2026-07-12 authority source');

const PROJECT_REF = 'abcdefghijklmnopqrst';
const RELEASE_SHA = 'a'.repeat(40);
const MIGRATION_SHA = 'b'.repeat(64);
const SECRET = 'fixture-private-client token=fixture-private-secret';
const EXPECTED_FLAGS = {
  linear_legacy_parity_enabled: { enabled: false },
  linear_outbound_enabled: { mode: 'off' },
  prod_authority: { graphics: 'linear', video: 'linear' },
};
const expectedFlags = () => JSON.parse(JSON.stringify(EXPECTED_FLAGS));

function wrapped(section, ordinal, key, value) {
  return JSON.stringify({ section, ordinal, key, value: JSON.stringify(value) });
}

function transcript(mutator) {
  const rowOne = JSON.stringify({
    id: 1, deliverable_id: 'private-deliverable-one', payload: { body: SECRET },
    created_at: '2026-07-22T10:00:00+00:00', team: 'video', status: 'pending', dedup_key: 'private-one',
  });
  const rowTwo = JSON.stringify({
    id: 2, deliverable_id: 'private-deliverable-two', payload: { body: 'second private body' },
    created_at: '2026-07-22T11:00:00+00:00', team: 'graphics', status: 'written', dedup_key: 'private-two',
  });
  const sections = {
    metadata: [{ key: 'metadata', value: {
      current_database: 'postgres', current_user: 'postgres', server_version: 'PostgreSQL 17.6 fixture',
      server_version_num: '170006', transaction_isolation: 'repeatable read', transaction_read_only: 'on',
      snapshot_time: '2026-07-22T12:00:00+00:00', table_regclass: 'public.mirror_outbox', primary_key_columns: ['id'],
    } }],
    runtime_safety: [{ key: 'runtime_safety', value: {
      flags: expectedFlags(),
      flag_flips_count: 17,
    } }],
    pre_f27_baseline: [{ key: 'pre_f27_baseline', value: expectedPreF27Baseline() }],
    table: [{ key: 'public.mirror_outbox', value: {
      schema: 'public', name: 'mirror_outbox', kind: 'r', owner: 'postgres', acl: null,
      row_security: true, force_row_security: false,
    } }],
    columns: ['id', 'deliverable_id', 'payload', 'created_at', 'team', 'status', 'dedup_key'].map((name, index) => ({
      key: name, value: { ordinal: index + 1, name, type: name === 'id' ? 'bigint' : 'text', not_null: true, default: null },
    })),
    constraints: [
      { key: 'mirror_outbox_pkey', value: { name: 'mirror_outbox_pkey', type: 'p', validated: true, definition: 'PRIMARY KEY (id)' } },
      { key: 'mirror_outbox_status_check', value: { name: 'mirror_outbox_status_check', type: 'c', validated: true, definition: "CHECK (status = ANY (ARRAY['pending'::text]))" } },
    ],
    triggers: [],
    functions: [
      { key: 'public.mirror_outbox_enqueue()', value: { name: 'mirror_outbox_enqueue', regprocedure_identity: 'public.mirror_outbox_enqueue(text,text,text,jsonb,text,timestamp with time zone,text,text,text,text,text,text,text,bigint,boolean)', owner: 'postgres', acl: null, config: ['search_path=public'], definition: 'CREATE OR REPLACE FUNCTION public.mirror_outbox_enqueue() RETURNS bigint LANGUAGE sql AS $$ SELECT 1 $$' } },
      { key: 'public.track_b_f27_write_authorization(text)', value: { name: 'track_b_f27_write_authorization', regprocedure_identity: 'public.track_b_f27_write_authorization(text)', owner: 'postgres', acl: ['postgres=X/postgres', 'service_role=X/postgres'], config: ['search_path=public'], definition: 'CREATE OR REPLACE FUNCTION public.track_b_f27_write_authorization(text) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN RETURN jsonb_build_object(); END $$' } },
      { key: 'public.production_assert_authority(text,text,boolean,boolean)', value: { name: 'production_assert_authority', regprocedure_identity: 'public.production_assert_authority(text,text,boolean,boolean)', owner: 'postgres', acl: ['postgres=X/postgres', 'service_role=X/postgres'], config: ['search_path=public'], definition: 'CREATE OR REPLACE FUNCTION public.production_assert_authority(text,text,boolean,boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$' } },
    ],
    indexes: [{ key: 'public.mirror_outbox_pkey', value: { name: 'mirror_outbox_pkey', primary: true, valid: true, definition: 'CREATE UNIQUE INDEX mirror_outbox_pkey ON public.mirror_outbox USING btree (id)' } }],
    policies: [],
    grants: [{ key: 'postgres/postgres/SELECT/true', value: { grantee: 'postgres', grantor: 'postgres', privilege: 'SELECT', grantable: true } }],
    rows: [
      { key: '1', raw: rowOne },
      { key: '2', raw: rowTwo },
    ],
    aggregates: [
      { key: 'graphics/written', value: { team: 'graphics', status: 'written', count: 1 } },
      { key: 'video/pending', value: { team: 'video', status: 'pending', count: 1 } },
    ],
    newest: [
      { key: '1', value: { rank: 1, team: 'graphics', status: 'written', time: '2026-07-22T11:00:00+00:00', private_row: rowTwo } },
      { key: '2', value: { rank: 2, team: 'video', status: 'pending', time: '2026-07-22T10:00:00+00:00', private_row: rowOne } },
    ],
  };
  if (mutator) mutator(sections);
  const lines = [];
  for (const [section, records] of Object.entries(sections)) {
    records.forEach((record, index) => {
      lines.push(record.raw
        ? JSON.stringify({ section, ordinal: index + 1, key: record.key, value: record.raw })
        : wrapped(section, index + 1, record.key, record.value));
    });
  }
  const inventory = Object.fromEntries(Object.entries(sections).map(([name, records]) => [name, records.length]));
  lines.push(wrapped('inventory', 1, 'inventory', inventory));
  return `${lines.join('\n')}\n`;
}

function windowPTranscript(mutator) {
  const allowed = new Set(['metadata', 'runtime_safety', 'pre_f27_baseline']);
  const lines = transcript(mutator).split(/\r?\n/).filter(Boolean).filter(line => {
    const record = JSON.parse(line);
    return allowed.has(record.section);
  });
  lines.push(wrapped('window_p_counts', 1, 'window_p_counts', {
    row_count: 2,
    non_terminal_row_count: 1,
  }));
  return `${lines.join('\n')}\n`;
}

const POST_FUNCTION_NAMES = [
  'mirror_outbox_enqueue', 'track_b_f27_write_authorization', 'track_b_f27_requeue',
  'track_b_f27_hold_guard', 'production_assert_authority', 'track_b_f27_begin',
  'track_b_f27_begin_drill', 'track_b_f27_classify', 'track_b_f27_execute_drill_replay',
  'track_b_f27_record_terminal', 'track_b_f27_finalize', 'track_b_f27_finalize_drill',
].sort();
const POST_TABLE_NAMES = [
  'track_b_f27_team_fences',
  'track_b_team_rollbacks',
  'track_b_team_rollback_intents',
].sort();
const POST_EXECUTE_FUNCTION_IDENTITIES = [
  'public.track_b_f27_write_authorization(text)',
  'public.track_b_f27_requeue(bigint,bigint)',
  'public.track_b_f27_begin(text,jsonb,text)',
  'public.track_b_f27_begin_drill(jsonb,text)',
  'public.track_b_f27_classify(uuid,bigint,text,text,text,jsonb)',
  'public.track_b_f27_execute_drill_replay(uuid,bigint,uuid)',
  'public.track_b_f27_record_terminal(uuid,bigint,jsonb)',
  'public.track_b_f27_finalize(uuid,jsonb,text)',
  'public.track_b_f27_finalize_drill(uuid,jsonb,text)',
].sort();

function postTranscript(mutator) {
  const preLines = transcript().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const privateRows = preLines.filter(record => record.section === 'rows');
  const sections = {
    post_metadata: [{ key: 'metadata', value: {
      current_database: 'postgres', server_version: 'PostgreSQL 17.6 fixture',
      server_version_num: '170006',
      transaction_isolation: 'repeatable read', transaction_read_only: 'on',
      verified_at: '2026-07-22T12:05:00+00:00',
    } }],
    post_runtime_safety: [{ key: 'runtime_safety', value: {
      flags: expectedFlags(),
      flag_flips_count: 17,
    } }],
    post_rows: privateRows.map(record => ({ key: record.key, raw: record.value })),
    f27_columns: [
      { key: 'authority_generation', value: { name: 'authority_generation', type: 'bigint', not_null: true, default: '0', identity: '', generated: '' } },
      { key: 'f27_drill_rollback_id', value: { name: 'f27_drill_rollback_id', type: 'uuid', not_null: false, default: null, identity: '', generated: '' } },
    ],
    f27_constraints: [
      'mirror_outbox_f27_drill_rollback_id_fkey',
      'mirror_outbox_f27_drill_scope_check',
      'mirror_outbox_f27_generation_check',
    ].map(name => ({ key: name, value: { name, type: name.endsWith('_fkey') ? 'f' : 'c', validated: true, deferrable: false, initially_deferred: false, definition: `fixture exact ${name} definition` } })),
    f27_triggers: [{ key: 'track_b_f27_hold_guard', value: {
      name: 'track_b_f27_hold_guard', enabled: 'O',
      definition: 'CREATE TRIGGER track_b_f27_hold_guard BEFORE INSERT OR UPDATE ON public.mirror_outbox FOR EACH ROW EXECUTE FUNCTION track_b_f27_hold_guard()',
      function_identity: 'track_b_f27_hold_guard()',
    } }],
    f27_functions: POST_FUNCTION_NAMES.map(name => ({ key: `public.${name}()`, value: {
      schema: 'public', name, identity_arguments: '', result: 'void', language: 'plpgsql', kind: 'f',
      regprocedure_identity: `public.${name}()`,
      security_definer: true, leakproof: false, volatility: 'v', parallel: 'u', strict: false,
      owner: 'postgres', acl_is_null: false,
      raw_acl: name === 'track_b_f27_hold_guard'
        ? ['postgres=X/postgres']
        : ['postgres=X/postgres', 'service_role=X/postgres'],
      effective_grants: [
        { grantee: 'postgres', grantor: 'postgres', privilege: 'EXECUTE', grantable: false },
        ...(name === 'track_b_f27_hold_guard' ? [] : [
          { grantee: 'service_role', grantor: 'postgres', privilege: 'EXECUTE', grantable: false },
        ]),
      ],
      default_owner_grants: [
        { grantee: 'postgres', grantor: 'postgres', privilege: 'EXECUTE', grantable: false },
      ],
      config: ['search_path=public'],
      definition: `CREATE OR REPLACE FUNCTION public.${name}() RETURNS void LANGUAGE plpgsql AS $$ BEGIN NULL; END $$`,
    } })),
    f27_indexes: [{ key: 'mirror_outbox_one_f27_drill_row_idx', value: {
      name: 'mirror_outbox_one_f27_drill_row_idx', unique: true, primary: false,
      valid: true, ready: true, live: true,
      definition: 'CREATE UNIQUE INDEX mirror_outbox_one_f27_drill_row_idx ON public.mirror_outbox USING btree (f27_drill_rollback_id) WHERE (f27_drill_rollback_id IS NOT NULL)',
    } }],
    f27_table_boundaries: POST_TABLE_NAMES.map(name => ({ key: `public.${name}`, value: {
      schema: 'public', name, kind: 'r', owner: 'postgres',
      row_security: false, force_row_security: false, acl_is_null: false,
      raw_acl: ['postgres=arwdDxtm/postgres', 'service_role=r/postgres'],
      effective_grants: [
        { grantee: 'postgres', grantor: 'postgres', privilege: 'DELETE', grantable: false },
        { grantee: 'postgres', grantor: 'postgres', privilege: 'INSERT', grantable: false },
        { grantee: 'postgres', grantor: 'postgres', privilege: 'MAINTAIN', grantable: false },
        { grantee: 'postgres', grantor: 'postgres', privilege: 'REFERENCES', grantable: false },
        { grantee: 'postgres', grantor: 'postgres', privilege: 'SELECT', grantable: false },
        { grantee: 'postgres', grantor: 'postgres', privilege: 'TRIGGER', grantable: false },
        { grantee: 'postgres', grantor: 'postgres', privilege: 'TRUNCATE', grantable: false },
        { grantee: 'postgres', grantor: 'postgres', privilege: 'UPDATE', grantable: false },
        { grantee: 'service_role', grantor: 'postgres', privilege: 'SELECT', grantable: false },
      ],
      default_owner_grants: [
        { grantee: 'postgres', grantor: 'postgres', privilege: 'DELETE', grantable: false },
        { grantee: 'postgres', grantor: 'postgres', privilege: 'INSERT', grantable: false },
        { grantee: 'postgres', grantor: 'postgres', privilege: 'MAINTAIN', grantable: false },
        { grantee: 'postgres', grantor: 'postgres', privilege: 'REFERENCES', grantable: false },
        { grantee: 'postgres', grantor: 'postgres', privilege: 'SELECT', grantable: false },
        { grantee: 'postgres', grantor: 'postgres', privilege: 'TRIGGER', grantable: false },
        { grantee: 'postgres', grantor: 'postgres', privilege: 'TRUNCATE', grantable: false },
        { grantee: 'postgres', grantor: 'postgres', privilege: 'UPDATE', grantable: false },
      ],
    } })),
    f27_function_execute_grants: POST_EXECUTE_FUNCTION_IDENTITIES.map(identity => {
      const match = /^public\.([^()]+)\((.*)\)$/.exec(identity);
      return { key: identity, value: {
        schema: 'public', name: match[1], identity_arguments: match[2],
        regprocedure_identity: identity, owner: 'postgres', acl_is_null: false,
        raw_acl: ['postgres=X/postgres', 'service_role=X/postgres'],
        effective_execute_grants: [
          { grantee: 'postgres', grantor: 'postgres', privilege: 'EXECUTE', grantable: false },
          { grantee: 'service_role', grantor: 'postgres', privilege: 'EXECUTE', grantable: false },
        ],
        default_owner_execute_grants: [
          { grantee: 'postgres', grantor: 'postgres', privilege: 'EXECUTE', grantable: false },
        ],
      } };
    }),
    f27_state: [{ key: 'state', value: {
      fences: { graphics: 0, video: 0 }, fence_count: 2,
      rollback_count: 0, intent_count: 0, residual_probe_count: 0,
    } }],
  };
  if (mutator) mutator(sections);
  const lines = [];
  for (const [section, records] of Object.entries(sections)) {
    records.forEach((record, index) => {
      lines.push(record.raw
        ? JSON.stringify({ section, ordinal: index + 1, key: record.key, value: record.raw })
        : wrapped(section, index + 1, record.key, record.value));
    });
  }
  return `${lines.join('\n')}\n`;
}

function adapter(output, overrides = {}) {
  const calls = [];
  return {
    calls,
    version() { calls.push({ type: 'version' }); return overrides.version || 'psql (PostgreSQL) 16.4'; },
    capture(sql, env) {
      calls.push({ type: 'capture', sql, env });
      if (overrides.error) throw overrides.error;
      return output;
    },
  };
}

function options(outputDir, psqlAdapter, overrides = {}) {
  return {
    outputDir,
    projectRef: PROJECT_REF,
    database: 'postgres',
    databaseUrl: `postgresql://postgres:fixture-password@db.${PROJECT_REF}.supabase.co:5432/postgres?sslmode=require`,
    releaseSha: RELEASE_SHA,
    confirmed: true,
    psqlAdapter,
    aclPlatform: 'linux',
    worktreeRoots: [path.join(path.dirname(outputDir), 'simulated-public-worktree')],
    releaseInfo: { headSha: RELEASE_SHA, originMainSha: RELEASE_SHA, dirty: false, migrationSha256: MIGRATION_SHA },
    ...overrides,
  };
}

const FIXTURE_USER_SID = 'S-1-5-21-111-222-333-1001';
function aclProof(action, overrides = {}) {
  return {
    format: WINDOWS_PRIVATE_ACL_FORMAT,
    action,
    path_kind: action === 'protect-directory' ? 'directory' : 'file',
    current_user_sid: FIXTURE_USER_SID,
    owner_sid: FIXTURE_USER_SID,
    allowed_sids: [FIXTURE_USER_SID, 'S-1-5-18', 'S-1-5-32-544'].sort(),
    access_rule_count: 3,
    access_rules_protected: action === 'protect-directory',
    unexpected_access_rule_count: 0,
    deny_rule_count: 0,
    current_user_full_control: true,
    ...overrides,
  };
}

function aclAdapter(overrides = {}) {
  const calls = [];
  return {
    calls,
    run(action, target) {
      calls.push({ action, target });
      return aclProof(action, overrides[action] || overrides);
    },
  };
}

function privateDir(root, name) {
  const value = path.join(root, name);
  fs.mkdirSync(value, { mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(value, 0o700);
  return value;
}

function rejectsCode(fn, code) {
  try { fn(); return false; } catch (error) { return Boolean(error && error.code === code); }
}

function captureThrownError(fn) {
  try { fn(); return null; } catch (error) { return error; }
}

function makeWritableTree(root) {
  if (!fs.existsSync(root)) return;
  for (const value of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, value.name);
    if (value.isDirectory()) makeWritableTree(target);
    else { try { fs.chmodSync(target, 0o600); } catch (_) { /* best effort fixture cleanup */ } }
  }
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'f27-mirror-snapshot-'));

try {
  const aclOrder = [];
  const orderedAcl = {
    run(action, target) {
      aclOrder.push(action);
      return aclProof(action);
    },
  };
  const orderedPsql = {
    version() { aclOrder.push('psql-version'); return 'psql (PostgreSQL) 16.4'; },
    capture() { aclOrder.push('psql-capture'); return transcript(); },
  };
  const windowsCaptureDir = privateDir(tempRoot, 'windows-acl-capture');
  const windowsReceipt = captureSnapshot(options(windowsCaptureDir, orderedPsql, {
    aclPlatform: 'win32',
    privateAclAdapter: orderedAcl,
  }));
  ok(windowsReceipt.status === 'PASS'
      && aclOrder.join(',') === 'protect-directory,psql-version,psql-capture,verify-file',
  'Windows capture protects its dedicated empty directory before psql and verifies the sealed row-body bundle after writing');

  const broadAcl = aclAdapter({
    'protect-directory': {
      unexpected_access_rule_count: 1,
      allowed_sids: [FIXTURE_USER_SID, 'S-1-1-0', 'S-1-5-18', 'S-1-5-32-544'].sort(),
      access_rule_count: 4,
    },
  });
  const aclRefusedPsql = adapter(transcript());
  ok(rejectsCode(() => captureSnapshot(options(
    privateDir(tempRoot, 'windows-broad-acl'),
    aclRefusedPsql,
    { aclPlatform: 'win32', privateAclAdapter: broadAcl },
  )), 'WINDOWS_PRIVATE_ACL_REQUIRED') && aclRefusedPsql.calls.length === 0,
  'a broad Windows principal fails before psql receives database credentials');

  const ownerMismatch = aclAdapter({ owner_sid: 'S-1-5-21-111-222-333-1002' });
  const noFullControl = aclAdapter({ current_user_full_control: false });
  ok(rejectsCode(() => assertWindowsPrivateFileAcl('C:\\private\\snapshot', {
    aclPlatform: 'win32', privateAclAdapter: ownerMismatch,
  }), 'WINDOWS_PRIVATE_ACL_REQUIRED')
      && rejectsCode(() => assertWindowsPrivateFileAcl('C:\\private\\snapshot', {
        aclPlatform: 'win32', privateAclAdapter: noFullControl,
      }), 'WINDOWS_PRIVATE_ACL_REQUIRED'),
  'Windows private files require the current user as owner with aggregate full control');

  let spawnedAcl;
  const hostileLookingPath = 'C:\\private path\\snapshot;Write-Output PWNED.snapshot';
  const defaultAcl = defaultWindowsPrivateAclAdapter({
    environment: { SystemRoot: 'C:\\Windows', SUPABASE_ACCESS_TOKEN: 'must-not-reach-powershell' },
    spawn(executable, argv, spawnOptions) {
      spawnedAcl = { executable, argv, spawnOptions };
      return { status: 0, signal: null, stdout: `${JSON.stringify(aclProof('verify-file'))}\n`, stderr: '' };
    },
  });
  defaultAcl.run('verify-file', hostileLookingPath);
  const decodedAclScript = Buffer.from(
    spawnedAcl.argv[spawnedAcl.argv.indexOf('-EncodedCommand') + 1], 'base64',
  ).toString('utf16le');
  ok(spawnedAcl.executable === 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      && !spawnedAcl.argv.some(value => String(value).includes(hostileLookingPath))
      && spawnedAcl.spawnOptions.env.F27_PRIVATE_ACL_TARGET === hostileLookingPath
      && spawnedAcl.spawnOptions.env.SUPABASE_ACCESS_TOKEN === undefined
      && !decodedAclScript.includes(hostileLookingPath)
      && decodedAclScript.includes("$ProgressPreference = 'SilentlyContinue'")
      && decodedAclScript.includes("Get-Acl -LiteralPath $target")
      && decodedAclScript.includes("'S-1-5-18'")
      && decodedAclScript.includes("'S-1-5-32-544'"),
  'default Windows ACL adapter uses fixed PowerShell and SIDs while passing the literal path only through a sanitized child environment');

  const firstDir = privateDir(tempRoot, 'capture-one');
  const fake = adapter(transcript());
  const receipt = captureSnapshot(options(firstDir, fake));
  const rendered = JSON.stringify(receipt);
  ok(receipt.status === 'PASS'
    && receipt.mirror_outbox_row_count === 2
    && receipt.mirror_outbox_non_terminal_row_count === 1
    && receipt.pre_f27_baseline === 'PASS'
    && /^[a-f0-9]{64}$/.test(receipt.pre_f27_baseline_sha256)
    && receipt.flag_flips_count === 17
    && JSON.stringify(receipt.runtime_flags) === JSON.stringify(EXPECTED_FLAGS)
    && /^[a-f0-9]{64}$/.test(receipt.snapshot_manifest_sha256)
    && /^[a-f0-9]{64}$/.test(receipt.snapshot_bundle_sha256)
    && receipt.local_private_readback === 'PASS',
  'capture emits a public-safe manifest/bundle receipt after independent local readback');
  ok(!rendered.includes(SECRET)
    && !rendered.includes('private-deliverable')
    && !rendered.includes('private-one')
    && !rendered.includes('fixture-password')
    && !rendered.includes(PROJECT_REF)
    && !rendered.includes(firstDir),
  'public receipt contains no row body, client-like value, dedup key, credential, project ref, or private path');
  ok(receipt.newest_public_safe_rows.length === 2
    && receipt.newest_public_safe_rows.every(row => Object.keys(row).sort().join(',') === 'private_row_sha256,rank,status,team,time')
    && receipt.newest_public_safe_rows[0].team === 'graphics'
    && receipt.newest_public_safe_rows[0].private_row_sha256 === sha256(Buffer.from(
      JSON.parse(transcript().split('\n').find(line => line.includes('"section":"rows"') && line.includes('"key":"2"'))).value,
    )),
  'newest-row evidence exposes only rank/team/status/time and the exact private-row SHA-256');
  ok(fake.calls.filter(call => call.type === 'capture').length === 1
    && fake.calls.filter(call => call.type === 'version').length === 1
    && fake.calls.find(call => call.type === 'capture').env.PGPASSWORD === 'fixture-password',
  'one psql capture session receives the connection only through its private environment');

  const windowPReadback = windowPTranscript(sections => {
    sections.runtime_safety[0].value.flags = JSON.parse(
      JSON.stringify(EXPECTED_WINDOW_P_RUNTIME_FLAGS),
    );
  });
  const windowPAdapter = adapter(windowPReadback);
  const windowPReceipt = windowPPreflight(options(firstDir, windowPAdapter));
  const renderedWindowPReceipt = JSON.stringify(windowPReceipt);
  ok(windowPReceipt.status === 'PASS'
    && windowPReceipt.mode === 'window_p_preflight_read_only'
    && windowPReceipt.pre_f27_baseline === 'PASS'
    && windowPReceipt.mirror_outbox_row_count === 2
    && windowPReceipt.mirror_outbox_non_terminal_row_count === 1
    && windowPReceipt.network_mutation_calls === 0
    && JSON.stringify(windowPReceipt.runtime_flags)
      === JSON.stringify(EXPECTED_WINDOW_P_RUNTIME_FLAGS)
    && /^[a-f0-9]{64}$/.test(windowPReceipt.pre_f27_baseline_sha256)
    && /^[a-f0-9]{64}$/.test(windowPReceipt.runtime_safety_state_sha256)
    && windowPAdapter.calls.filter(call => call.type === 'capture').length === 1,
  'Window P has an executable read-only exact-subset gate that preserves the owner-approved armed parity posture');
  const windowPSql = windowPAdapter.calls.find(call => call.type === 'capture').sql;
  ok(!/['\"]section['\"],['\"]rows['\"]/.test(windowPSql)
    && !/FROM public\.mirror_outbox o ORDER BY o\.id/.test(windowPSql)
    && /'section','runtime_safety'/.test(windowPSql)
    && /'section','pre_f27_baseline'/.test(windowPSql)
    && /count\(\*\) FILTER/.test(windowPSql)
    && /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/.test(windowPSql),
  'Window P preflight emits the validated catalog and flag records plus aggregate queue counts, never row bodies');
  ok(!renderedWindowPReceipt.includes(SECRET)
    && !renderedWindowPReceipt.includes('private-deliverable')
    && !renderedWindowPReceipt.includes('private-one')
    && !renderedWindowPReceipt.includes('fixture-password')
    && !renderedWindowPReceipt.includes(PROJECT_REF)
    && !renderedWindowPReceipt.includes(firstDir),
  'Window P preflight publishes only flags, counts, release/hash evidence, and PASS state');
  ok(rejectsCode(
    () => windowPPreflight(options(firstDir, adapter(windowPTranscript()))),
    'RUNTIME_SAFETY_INVALID',
  ), 'Window P exact preflight requires F4 armed and never treats the later F4-off posture as equivalent');
  ok(rejectsCode(
    () => windowPPreflight(options(firstDir, adapter(windowPTranscript(sections => {
      sections.pre_f27_baseline[0].value.fence_generations.video = 1;
      sections.runtime_safety[0].value.flags = JSON.parse(
        JSON.stringify(EXPECTED_WINDOW_P_RUNTIME_FLAGS),
      );
    })))),
    'PRE_F27_BASELINE_REQUIRED',
  ), 'Window P exact preflight hard-fails subset drift instead of warning or skipping it');
  const captureCall = fake.calls.find(call => call.type === 'capture');
  ok(!captureCall.sql.includes('fixture-password')
    && /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/.test(captureCall.sql)
    && (captureCall.sql.match(/\bBEGIN TRANSACTION\b/g) || []).length === 1
    && (captureCall.sql.match(/\bCOMMIT;/g) || []).length === 1
    && /FROM public\.mirror_outbox o ORDER BY o\.id/.test(captureCall.sql),
  'database inventory and full primary-key-ordered export share one repeatable-read read-only transaction');
  ok(/pg_get_constraintdef\(c\.oid,true\)/.test(captureCall.sql)
    && /pg_get_triggerdef\(t\.oid,true\)/.test(captureCall.sql)
    && /pg_get_functiondef\(p\.oid\) ILIKE '%mirror_outbox%'/.test(captureCall.sql)
    && /aclexplode/.test(captureCall.sql)
    && /pg_policies/.test(captureCall.sql),
  'SQL captures constraints, triggers, dependent definitions, grants, RLS policies, and table boundary metadata');
  ok(/jsonb_object_agg\(key,value ORDER BY key\)/.test(captureCall.sql)
    && /SELECT count\(\*\) FROM public\.flag_flips/.test(captureCall.sql)
    && captureCall.sql.indexOf("'section','runtime_safety'") > captureCall.sql.indexOf('BEGIN TRANSACTION')
    && captureCall.sql.indexOf("'section','runtime_safety'") < captureCall.sql.lastIndexOf('COMMIT;'),
  'authority, outbound, parity, and flag-flip baseline share the row/schema repeatable-read transaction');
  ok(/F27_SNAPSHOT_PRE_F27_BASELINE_REQUIRED/.test(captureCall.sql)
    && /c\.relname IN \('track_b_f27_team_fences','track_b_team_rollbacks','track_b_team_rollback_intents'\)/.test(captureCall.sql)
    && /c\.relname='track_b_f27_team_fences' AND c\.relkind='r'/.test(captureCall.sql)
    && /c\.relname='track_b_f27_team_fences_pkey' AND c\.relkind='i'/.test(captureCall.sql)
    && /a\.attname IN \('authority_generation','f27_drill_rollback_id'\)/.test(captureCall.sql)
    && (captureCall.sql.match(
      /a\.attname\s+~\* 'f27\|track_b_team_rollback\|production_assert_authority\|authority_generation'/g,
    ) || []).length >= 2
    && /c\.conname IN \('mirror_outbox_f27_drill_rollback_id_fkey','mirror_outbox_f27_drill_scope_check','mirror_outbox_f27_generation_check'\)/.test(captureCall.sql)
    && /c\.relname='mirror_outbox_one_f27_drill_row_idx'/.test(captureCall.sql)
    && /t\.tgname='track_b_f27_hold_guard'/.test(captureCall.sql)
    && /p\.oid IS DISTINCT FROM to_regprocedure\('public\.mirror_outbox_enqueue/.test(captureCall.sql)
    && /p\.oid IS DISTINCT FROM to_regprocedure\('public\.track_b_f27_write_authorization\(text\)'/.test(captureCall.sql)
    && /p\.oid IS DISTINCT FROM to_regprocedure\('public\.production_assert_authority\(text,text,boolean,boolean\)'/.test(captureCall.sql)
    && /p\.proname ~\* 'f27\|/.test(captureCall.sql)
    && /pg_get_functiondef\(p\.oid\)\s+~\* 'track_b_f27_\|track_b_team_rollback\|authority_generation\|f27_drill_rollback_id\|_f27_'/.test(captureCall.sql)
    && !/pg_get_functiondef\(p\.oid\)\s+~\* 'f27\|track_b_team_rollback\|production_assert_authority\|authority_generation'/.test(captureCall.sql)
    && /FROM pg_namespace n[\s\S]*n\.nspname ~\* 'f27\|/.test(captureCall.sql)
    && /FROM pg_type t[\s\S]*t\.typname ~\* 'f27\|/.test(captureCall.sql)
    && /FROM pg_inherits/.test(captureCall.sql)
    && /FROM pg_rewrite/.test(captureCall.sql)
    && /FROM pg_policy p/.test(captureCall.sql)
    && /FROM pg_collation c/.test(captureCall.sql)
    && /FROM pg_opclass o/.test(captureCall.sql)
    && /FROM pg_opfamily o/.test(captureCall.sql)
    && /a\.attcollation='pg_catalog\.default'::regcollation/.test(captureCall.sql)
    && /i\.indclass::text IS DISTINCT FROM/.test(captureCall.sql)
    && /opc\.opcname='text_ops'/.test(captureCall.sql)
    && captureCall.sql.includes("'production_assert_authority'")
    && captureCall.sql.includes("to_regprocedure('public.production_assert_authority(text,text,boolean,boolean)') IS NULL"),
  'capture SQL requires the exact pre-F27 authority boundary while rejecting mixed-case outbox columns and every other F27 object class');

  ok(/replace\(replace\(p\.prosrc,E'\\r\\n',E'\\n'\),E'\\r',E'\\n'\)/.test(captureCall.sql)
    && /f27_write_authorization_unavailable/.test(captureCall.sql)
    && /legacy_parity_gate_unavailable/.test(captureCall.sql)
    && /table_am\.amname IS DISTINCT FROM 'heap'/.test(captureCall.sql)
    && /c\.relpartbound IS NOT NULL/.test(captureCall.sql)
    && /c\.relchecks IS DISTINCT FROM 2/.test(captureCall.sql)
    && /c\.relnatts IS DISTINCT FROM 4/.test(captureCall.sql)
    && /c\.reltablespace IS DISTINCT FROM 0::oid/.test(captureCall.sql)
    && /a\.attinhcount IS DISTINCT FROM 0/.test(captureCall.sql)
    && /a\.attislocal IS DISTINCT FROM true/.test(captureCall.sql)
    && /a\.atthasmissing IS DISTINCT FROM false/.test(captureCall.sql)
    && /a\.attstorage='[xp]'/.test(captureCall.sql)
    && /c\.connamespace IS DISTINCT FROM 'public'::regnamespace/.test(captureCall.sql)
    && /NOT c\.conislocal/.test(captureCall.sql)
    && /c\.coninhcount <> 0/.test(captureCall.sql)
    && /c\.conparentid <> 0/.test(captureCall.sql)
    && /c\.conname='track_b_f27_team_fences_pkey'[\s\S]*?c\.contype='p'[\s\S]*?c\.connoinherit[\s\S]*?c\.conkey/.test(captureCall.sql)
    && /c\.conname='track_b_f27_team_fences_team_check'[\s\S]*?c\.contype='c'[\s\S]*?NOT c\.connoinherit[\s\S]*?pg_get_expr/.test(captureCall.sql)
    && /c\.conname='track_b_f27_team_fences_generation_check'[\s\S]*?c\.contype='c'[\s\S]*?NOT c\.connoinherit[\s\S]*?pg_get_expr/.test(captureCall.sql)
    && /ni\.nspname IS DISTINCT FROM 'public'/.test(captureCall.sql)
    && /ci\.relkind IS DISTINCT FROM 'i'/.test(captureCall.sql)
    && /ci\.reloptions IS NOT NULL/.test(captureCall.sql)
    && /ci\.relacl IS NOT NULL/.test(captureCall.sql)
    && /i\.indnullsnotdistinct/.test(captureCall.sql)
    && /i\.indcheckxmin/.test(captureCall.sql)
    && /p\.proallargtypes IS NOT NULL/.test(captureCall.sql)
    && /p\.proargmodes IS NOT NULL/.test(captureCall.sql)
    && /p\.protrftypes IS NOT NULL/.test(captureCall.sql)
    && /p\.provariadic <> 0/.test(captureCall.sql)
    && /p\.prosupport <> 0/.test(captureCall.sql)
    && /aclexplode\(COALESCE\(c\.relacl,acldefault\('r',c\.relowner\)\)\)/.test(captureCall.sql)
    && !captureCall.sql.includes("'postgres=arwdDxt/postgres'")
    && /granted\.grantor IS DISTINCT FROM c\.relowner/.test(captureCall.sql)
    && /granted\.privilege_type IS DISTINCT FROM 'SELECT'/.test(captureCall.sql)
    && /has_table_privilege\([\s\S]*supported_privilege\.privilege_type/.test(captureCall.sql)
    && /'SELECT WITH GRANT OPTION'/.test(captureCall.sql)
    && (captureCall.sql.match(/aclexplode\(COALESCE\(p\.proacl,acldefault\('f',p\.proowner\)\)\)/g) || []).length >= 8
    && (captureCall.sql.match(/\bEXCEPT\b/g) || []).length >= 4
    && /SELECT oid FROM pg_roles WHERE rolname='service_role'/.test(captureCall.sql)
    && !captureCall.sql.includes("'postgres=X/postgres'")
    && !captureCall.sql.includes("'service_role=X/postgres'")
    && /SELECT count\(\*\) FROM public\.track_b_f27_team_fences/.test(captureCall.sql)
    && /generation IS DISTINCT FROM 0/.test(captureCall.sql)
    && /updated_by IS DISTINCT FROM 'f27-migration'/.test(captureCall.sql),
  'the server gate binds PostgreSQL-native shape, normalized reviewed function definitions, semantic service-only grants, and exactly two generation-zero fence rows');

  const parentMigration = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '2026-07-20-f27-team-rollback.sql'),
    'utf8',
  );
  const subsetMigration = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '2026-07-28-f27-write-authorization-only.sql'),
    'utf8',
  );
  const reviewedSubsetBlocks = [
    [
      'create table if not exists public.track_b_f27_team_fences (',
      '\n);',
    ],
    [
      'insert into public.track_b_f27_team_fences (team, generation, updated_by)',
      'on conflict (team) do nothing;',
    ],
    [
      'create or replace function public.track_b_f27_write_authorization(p_team text)',
      '$fn$;',
    ],
  ];
  const reviewedSubsetStatements = [
    'revoke all on table public.track_b_f27_team_fences from public, anon, authenticated, service_role;',
    'grant select on table public.track_b_f27_team_fences to service_role;',
    'revoke all on function public.track_b_f27_write_authorization(text)\n  from public, anon, authenticated;',
    'grant execute on function public.track_b_f27_write_authorization(text) to service_role;',
  ];
  ok(reviewedSubsetBlocks.every(([start, end]) => {
    const parentBlock = sourceBlock(parentMigration, start, end);
    const subsetBlock = sourceBlock(subsetMigration, start, end);
    return parentBlock && parentBlock === subsetBlock;
  })
    && reviewedSubsetStatements.every(statement =>
      parentMigration.includes(statement) && subsetMigration.includes(statement))
    && /create table if not exists/i.test(subsetMigration)
    && /on conflict \(team\) do nothing/i.test(subsetMigration)
    && /create or replace function/i.test(subsetMigration),
  'the two preinstalled objects remain byte-identical/idempotent subsets of the once-only parent migration');

  const snapshots = fs.readdirSync(firstDir).filter(name => name.endsWith('.snapshot'));
  ok(snapshots.length === 1
    && snapshots[0] === `f27-mirror-outbox-${receipt.snapshot_bundle_sha256}.snapshot`,
  'capture produces one deterministic content-addressed handoff bundle for the private store tool');
  const bundleBytes = fs.readFileSync(path.join(firstDir, snapshots[0]));
  const bundle = JSON.parse(bundleBytes);
  const manifestBytes = Buffer.from(bundle.manifest_base64, 'base64');
  const manifest = JSON.parse(manifestBytes);
  ok(sha256(bundleBytes) === receipt.snapshot_bundle_sha256
    && sha256(manifestBytes) === receipt.snapshot_manifest_sha256
    && bundle.manifest_sha256 === receipt.snapshot_manifest_sha256
    && manifest.files.every(file => {
      const stored = bundle.files.find(item => item.path === file.path);
      const bytes = stored && Buffer.from(stored.content_base64, 'base64');
      return stored && bytes.length === file.byte_length && sha256(bytes) === file.sha256;
    }),
  'sealed bundle independently binds the stable manifest, every relative path, byte length, SHA-256, and payload');
  ok(manifest.files.some(file => file.path === 'database/mirror_outbox.rows.jsonl')
    && manifest.files.some(file => file.path === 'database/mirror_outbox.preinstall-column-projection.json')
    && manifest.files.some(file => file.path === 'database/pre-f27-baseline.json')
    && manifest.files.some(file => file.path === 'database/mirror_outbox.functions.jsonl')
    && manifest.files.some(file => file.path === 'database/runtime-safety-state.json')
    && manifest.files.some(file => file.path === 'metadata/snapshot.json'),
  'private manifest contains rows, ordered old projection, dependent function closure, and release/tool/database metadata');

  const bundlePath = path.join(firstDir, snapshots[0]);
  const expectedPostContract = postContract(parsePostTranscript(postTranscript(), 'postgres', true)).sha256;
  const pg16ShapedPostContract = postContract(parsePostTranscript(postTranscript(sections => {
    sections.post_metadata[0].value.server_version = 'PostgreSQL 16 fixture';
    sections.post_metadata[0].value.server_version_num = '160004';
    for (const boundary of sections.f27_table_boundaries) {
      boundary.value.raw_acl = boundary.value.raw_acl.map(entry =>
        entry.replace('arwdDxtm', 'arwdDxt'));
      boundary.value.effective_grants = boundary.value.effective_grants
        .filter(grant => grant.grantee !== 'postgres' || grant.privilege !== 'MAINTAIN');
      boundary.value.default_owner_grants = boundary.value.default_owner_grants
        .filter(grant => grant.privilege !== 'MAINTAIN');
    }
    for (const fn of sections.f27_functions) fn.value.raw_acl = ['owner-representation-only'];
    for (const fn of sections.f27_function_execute_grants) {
      fn.value.raw_acl = ['owner-representation-only'];
    }
  }), 'postgres', true));
  const normalizedPostContract = postContract(parsePostTranscript(postTranscript(), 'postgres', true));
  const normalizedRendered = JSON.stringify(normalizedPostContract.contract);
  ok(pg16ShapedPostContract.sha256 === expectedPostContract
      && !normalizedRendered.includes('raw_acl')
      && !normalizedRendered.includes('acl_is_null')
      && !normalizedRendered.includes('arwdDxtm')
      && normalizedRendered.includes('SERVER_ACLDEFAULT')
      && normalizedRendered.includes('non_owner_grants'),
  'PG17 owner MAINTAIN and raw table/function ACL vocabulary normalize relative to the running server default');
  ok(!ownerGrantsMatchDefault({
    owner: 'postgres',
    effective_grants: [
      { grantee: 'postgres', grantor: 'owner', privilege: 'EXECUTE', grantable: false },
    ],
    default_owner_grants: [
      { grantee: 'postgres', grantor: 'postgres', privilege: 'EXECUTE', grantable: false },
    ],
  }, 'effective_grants', 'default_owner_grants'),
  'a distinct grantor role literally named owner cannot collide with the owner-relative encoding');
  const disposableTranscript = postTranscript(sections => {
    delete sections.post_rows;
    sections.post_metadata[0].value.current_database = 'f27_operator';
  });
  const fingerprintDir = privateDir(tempRoot, 'post-contract-expected');
  const disposableFingerprint = fingerprintPost(options(fingerprintDir, adapter(disposableTranscript), {
    database: 'f27_operator',
    databaseUrl: 'postgresql://postgres@127.0.0.1:5432/f27_operator',
  }));
  const expectedInventoryPath = path.join(
    fingerprintDir,
    `f27-post-contract-expected-${disposableFingerprint.post_contract_raw_inventory_sha256}.inventory.json`,
  );
  ok(disposableFingerprint.status === 'PASS'
    && disposableFingerprint.f27_post_contract_sha256 === expectedPostContract
    && /^[a-f0-9]{64}$/.test(disposableFingerprint.post_contract_raw_inventory_sha256)
    && disposableFingerprint.post_contract_raw_inventory_byte_length > 0
    && disposableFingerprint.local_private_readback === 'PASS'
    && fs.existsSync(expectedInventoryPath)
    && disposableFingerprint.f27_table_security_boundaries === 'PASS'
    && disposableFingerprint.f27_function_execute_grants === 'PASS'
    && disposableFingerprint.release_sha === RELEASE_SHA
    && disposableFingerprint.migration_sha256 === MIGRATION_SHA
    && disposableFingerprint.source === 'disposable_postgresql_read_only',
  'loopback disposable PostgreSQL readback generates the exact public contract hash required by live verify-after');
  ok(rejectsCode(() => fingerprintPost(options(privateDir(tempRoot, 'nonloopback-fingerprint'), adapter(disposableTranscript), {
    database: 'f27_operator',
    databaseUrl: 'postgresql://postgres@db.example.invalid:5432/f27_operator',
  })), 'DISPOSABLE_DATABASE_REJECTED'),
  'post-contract fingerprint mode cannot target a non-loopback database');
  const pg16FingerprintTranscript = postTranscript(sections => {
    delete sections.post_rows;
    sections.post_metadata[0].value.current_database = 'f27_operator';
    sections.post_metadata[0].value.server_version = 'PostgreSQL 16.4 fixture';
    sections.post_metadata[0].value.server_version_num = '160004';
  });
  const pg16FingerprintDir = privateDir(tempRoot, 'pg16-fingerprint');
  ok(rejectsCode(() => fingerprintPost(options(
    pg16FingerprintDir,
    adapter(pg16FingerprintTranscript),
    {
      database: 'f27_operator',
      databaseUrl: 'postgresql://postgres@127.0.0.1:5432/f27_operator',
    },
  )), 'POSTGRESQL_17_REQUIRED') && fs.readdirSync(pg16FingerprintDir).length === 0,
  'post-contract fingerprinting rejects PostgreSQL 16 before retaining an expected inventory');
  let verifyEvidenceCounter = 0;
  function verifyOptions(psqlAdapter, overrides = {}) {
    verifyEvidenceCounter += 1;
    return options(privateDir(tempRoot, `verify-evidence-${verifyEvidenceCounter}`), psqlAdapter, {
      bundlePath,
      expectedBundleSha256: receipt.snapshot_bundle_sha256,
      expectedPostContractSha256: expectedPostContract,
      expectedPostContractInventoryPath: expectedInventoryPath,
      expectedPostContractInventorySha256:
        disposableFingerprint.post_contract_raw_inventory_sha256,
      expectedPostContractInventoryByteLength:
        disposableFingerprint.post_contract_raw_inventory_byte_length,
      ...overrides,
    });
  }
  const verifyAdapter = adapter(postTranscript());
  const bundleAcl = aclAdapter();
  const passOptions = verifyOptions(verifyAdapter, {
    aclPlatform: 'win32',
    privateAclAdapter: bundleAcl,
  });
  const afterReceipt = verifyAfter(passOptions);
  const afterRendered = JSON.stringify(afterReceipt);
  ok(afterReceipt.status === 'PASS'
    && afterReceipt.mirror_outbox_row_count_preserved === 2
    && afterReceipt.preexisting_projection_sha256 === sha256(Buffer.from(
      manifest.files.find(file => file.path === 'database/mirror_outbox.rows.jsonl')
        ? bundle.files.find(file => file.path === 'database/mirror_outbox.rows.jsonl').content_base64
        : '',
      'base64',
    ))
    && afterReceipt.residual_synthetic_probe_count === 0
    && afterReceipt.flag_flips_count_delta === 0
    && JSON.stringify(afterReceipt.runtime_flags) === JSON.stringify(EXPECTED_FLAGS)
    && afterReceipt.f27_fences_generation_zero === 'PASS'
    && afterReceipt.f27_empty_ledgers === 'PASS'
    && afterReceipt.f27_table_security_boundaries === 'PASS'
    && afterReceipt.f27_function_execute_grants === 'PASS'
    && afterReceipt.f27_post_contract_sha256 === expectedPostContract,
  'verify-after proves old-projection equality, dormant state, and the exact F27 schema/privilege contract');
  ok(bundleAcl.calls.filter(call => call.action === 'verify-file').length === 2
      && bundleAcl.calls.some(call => call.target === path.resolve(bundlePath))
      && bundleAcl.calls.some(call => call.target === path.resolve(expectedInventoryPath))
      && bundleAcl.calls.some(call => call.action === 'protect-directory'
        && call.target === path.resolve(passOptions.outputDir))
      && fs.readdirSync(passOptions.outputDir).length === 0,
  'verify-after proves both private inputs and protects an empty mismatch directory before reading production');
  const unsafeBundleAcl = aclAdapter({
    unexpected_access_rule_count: 1,
    allowed_sids: [FIXTURE_USER_SID, 'S-1-1-0', 'S-1-5-18', 'S-1-5-32-544'].sort(),
    access_rule_count: 4,
  });
  const bundleAclRefusedPsql = adapter(postTranscript());
  ok(rejectsCode(() => verifyAfter(verifyOptions(bundleAclRefusedPsql, {
    aclPlatform: 'win32',
    privateAclAdapter: unsafeBundleAcl,
  })), 'WINDOWS_PRIVATE_ACL_REQUIRED') && bundleAclRefusedPsql.calls.length === 0,
  'a sealed bundle with a broad Windows ACL is refused before psql or private row parsing');
  ok(!afterRendered.includes(SECRET)
    && !afterRendered.includes('private-deliverable')
    && !afterRendered.includes(bundlePath)
    && !afterRendered.includes(PROJECT_REF),
  'verify-after PASS is public-safe and contains no private row, path, or project identity');
  const afterSql = verifyAdapter.calls.find(call => call.type === 'capture').sql;
  ok(/BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/.test(afterSql)
    && (afterSql.match(/\bBEGIN TRANSACTION\b/g) || []).length === 1
    && (afterSql.match(/\bCOMMIT;/g) || []).length === 1
    && /SELECT o\."id",o\."deliverable_id",o\."payload",o\."created_at",o\."team",o\."status",o\."dedup_key"/.test(afterSql)
    && /residual_probe_count/.test(afterSql)
    && /'section','post_runtime_safety'/.test(afterSql)
    && /SELECT count\(\*\) FROM public\.flag_flips/.test(afterSql)
    && /track_b_f27_hold_guard/.test(afterSql)
    && /'section','f27_table_boundaries'/.test(afterSql)
    && /relrowsecurity/.test(afterSql) && /relforcerowsecurity/.test(afterSql)
    && /'section','f27_function_execute_grants'/.test(afterSql)
    && /acldefault\('r',c\.relowner\)/.test(afterSql)
    && /acldefault\('f',p\.proowner\)/.test(afterSql)
    && /to_regprocedure\('public\.track_b_f27_finalize_drill\(uuid,jsonb,text\)'\)/.test(afterSql)
    && !/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE TABLE)\b/.test(afterSql.replace(/CREATE TRIGGER/g, '')),
  'verify-after reads exact table/RLS/ACL and nine RPC execute boundaries in one non-mutating transaction');

  const flagDrift = postTranscript(sections => {
    sections.post_runtime_safety[0].value.flags.linear_outbound_enabled = { mode: 'write' };
  });
  ok(rejectsCode(() => verifyAfter(verifyOptions(adapter(flagDrift))), 'POST_RUNTIME_SAFETY_INVALID'),
  'authority, outbound, or parity drift fails inside the post-migration readback gate');

  const flipCountDrift = postTranscript(sections => {
    sections.post_runtime_safety[0].value.flag_flips_count = 18;
  });
  ok(rejectsCode(() => verifyAfter(verifyOptions(adapter(flipCountDrift))), 'RUNTIME_SAFETY_DRIFT'),
  'a flag_flips count change across the migration window fails even when all three values still match');

  const changedRows = postTranscript(sections => {
    const row = JSON.parse(sections.post_rows[0].raw);
    row.payload.body = 'changed after migration';
    sections.post_rows[0].raw = JSON.stringify(row);
  });
  ok(rejectsCode(() => verifyAfter(verifyOptions(adapter(changedRows))), 'PREEXISTING_ROWS_CHANGED'),
  'a single changed pre-existing value fails the old-column row hash comparison');

  const residualProbe = postTranscript(sections => { sections.f27_state[0].value.residual_probe_count = 1; });
  ok(rejectsCode(() => verifyAfter(verifyOptions(adapter(residualProbe))), 'F27_POST_STATE_INVALID'),
  'a residual synthetic migration probe fails closed');

  const definitionDrift = postTranscript(sections => {
    sections.f27_functions[0].value.definition += ' -- drift';
  });
  const mismatchOptions = verifyOptions(adapter(definitionDrift));
  const mismatchError = captureThrownError(() => verifyAfter(mismatchOptions));
  const mismatchFailure = publicFailure(mismatchError);
  const mismatchFiles = fs.readdirSync(mismatchOptions.outputDir).sort();
  ok(mismatchError && mismatchError.code === 'POST_CONTRACT_MISMATCH'
      && mismatchFailure.private_contract_evidence === 'PASS'
      && /^[a-f0-9]{64}$/.test(mismatchFailure.expected_raw_inventory_sha256)
      && /^[a-f0-9]{64}$/.test(mismatchFailure.observed_raw_inventory_sha256)
      && mismatchFailure.expected_raw_inventory_byte_length > 0
      && mismatchFailure.observed_raw_inventory_byte_length > 0
      && mismatchFiles.length === 2
      && mismatchFiles.some(name => name.startsWith('f27-post-contract-expected-raw-'))
      && mismatchFiles.some(name => name.startsWith('f27-post-contract-observed-raw-'))
      && !JSON.stringify(mismatchFailure).includes(mismatchOptions.outputDir)
      && !JSON.stringify(mismatchFailure).includes(PROJECT_REF)
      && !JSON.stringify(mismatchFailure).includes('CREATE OR REPLACE FUNCTION'),
  'an exact definition mismatch durably retains both raw seven-category inventories before failing');
  const retainedInventories = mismatchFiles.map(name => JSON.parse(
    fs.readFileSync(path.join(mismatchOptions.outputDir, name), 'utf8'),
  ));
  ok(retainedInventories.every(item => item.inventory
      && item.inventory.functions.length === POST_FUNCTION_NAMES.length
      && item.inventory.table_boundaries.length === POST_TABLE_NAMES.length
      && item.inventory.function_execute_grants.length === POST_EXECUTE_FUNCTION_IDENTITIES.length
      && item.inventory.functions.some(record => Array.isArray(record.value.raw_acl)))
      && JSON.stringify(retainedInventories).includes('CREATE OR REPLACE FUNCTION'),
  'retained mismatch evidence preserves the raw definitions and ACL records in all seven categories');
  const evidenceWriteFailureOptions = verifyOptions(adapter(definitionDrift), {
    postContractEvidenceWriter() { throw new Error('fixture persistence failure'); },
  });
  const evidenceWriteFailure = captureThrownError(
    () => verifyAfter(evidenceWriteFailureOptions),
  );
  ok(evidenceWriteFailure
      && evidenceWriteFailure.code === 'POST_CONTRACT_EVIDENCE_WRITE_FAILED'
      && fs.readdirSync(evidenceWriteFailureOptions.outputDir).length === 0,
  'a mismatch cannot emit POST_CONTRACT_MISMATCH unless both raw inventories were retained');
  const forgedEvidenceOptions = verifyOptions(adapter(definitionDrift), {
    postContractEvidenceWriter() {
      return {
        private_contract_evidence: 'PASS',
        expected_raw_inventory_sha256: 'a'.repeat(64),
        expected_raw_inventory_byte_length: 1,
        observed_raw_inventory_sha256: 'b'.repeat(64),
        observed_raw_inventory_byte_length: 1,
      };
    },
  });
  const forgedEvidenceFailure = captureThrownError(
    () => verifyAfter(forgedEvidenceOptions),
  );
  ok(forgedEvidenceFailure
      && forgedEvidenceFailure.code === 'POST_CONTRACT_EVIDENCE_WRITE_FAILED'
      && fs.readdirSync(forgedEvidenceOptions.outputDir).length === 0,
  'a no-write or forged evidence receipt cannot substitute for two independently read-back files');

  const invalidInventoryAdapter = adapter(postTranscript());
  ok(rejectsCode(() => verifyAfter(verifyOptions(invalidInventoryAdapter, {
    expectedPostContractInventorySha256: '0'.repeat(64),
  })), 'POST_CONTRACT_INVENTORY_HASH_MISMATCH') && invalidInventoryAdapter.calls.length === 0,
  'an expected raw-inventory binder mismatch fails before PostgreSQL receives credentials');

  const tablePrivilegeDrift = postTranscript(sections => {
    sections.f27_table_boundaries[0].value.effective_grants.push({
      grantee: 'anon', grantor: 'postgres', privilege: 'SELECT', grantable: false,
    });
  });
  ok(rejectsCode(() => verifyAfter(verifyOptions(adapter(tablePrivilegeDrift))), 'POST_CONTRACT_MISMATCH'),
  'an accidental table grant to anon changes the exact disposable-source contract hash');

  const functionPrivilegeDrift = postTranscript(sections => {
    sections.f27_function_execute_grants[0].value.effective_execute_grants.push({
      grantee: 'authenticated', grantor: 'postgres', privilege: 'EXECUTE', grantable: false,
    });
  });
  ok(rejectsCode(() => verifyAfter(verifyOptions(adapter(functionPrivilegeDrift))), 'POST_CONTRACT_MISMATCH'),
  'an accidental RPC execute grant to authenticated changes the exact disposable-source contract hash');

  const functionClosurePrivilegeDrift = postTranscript(sections => {
    sections.f27_functions.find(record => record.value.name === 'track_b_f27_hold_guard')
      .value.effective_grants.push({
        grantee: 'anon', grantor: 'postgres', privilege: 'EXECUTE', grantable: false,
      });
  });
  ok(rejectsCode(
    () => verifyAfter(verifyOptions(adapter(functionClosurePrivilegeDrift))),
    'POST_CONTRACT_MISMATCH',
  ), 'a foreign grant on a function outside the nine-RPC execute section still fails exact closure');

  const publicPrivilegeDrift = postTranscript(sections => {
    sections.f27_table_boundaries[0].value.effective_grants.push({
      grantee: 'PUBLIC', grantor: 'postgres', privilege: 'SELECT', grantable: false,
    });
  });
  ok(rejectsCode(() => verifyAfter(verifyOptions(adapter(publicPrivilegeDrift))), 'POST_CONTRACT_MISMATCH'),
  'an accidental table grant to PUBLIC changes the exact disposable-source contract hash');

  const serviceRolePrivilegeDrift = postTranscript(sections => {
    const serviceGrant = sections.f27_function_execute_grants[0].value.effective_execute_grants
      .find(grant => grant.grantee === 'service_role');
    serviceGrant.grantable = true;
  });
  ok(rejectsCode(() => verifyAfter(verifyOptions(adapter(serviceRolePrivilegeDrift))), 'POST_CONTRACT_MISMATCH'),
  'service-role RPC execute-grant drift changes the exact disposable-source contract hash');

  const tableRlsDrift = postTranscript(sections => {
    sections.f27_table_boundaries[1].value.row_security = true;
  });
  ok(rejectsCode(() => verifyAfter(verifyOptions(adapter(tableRlsDrift))), 'POST_CONTRACT_MISMATCH'),
  'table relrowsecurity drift changes the exact disposable-source contract hash');

  const remainingTableBoundaryDrifts = [
    postTranscript(sections => {
      const value = sections.f27_table_boundaries[0].value;
      value.owner = 'other_owner';
      for (const grants of [value.effective_grants, value.default_owner_grants]) {
        for (const grant of grants) {
          if (grant.grantee === 'postgres') grant.grantee = 'other_owner';
          if (grant.grantor === 'postgres') grant.grantor = 'other_owner';
        }
      }
    }),
    postTranscript(sections => { sections.f27_table_boundaries[0].value.force_row_security = true; }),
  ];
  ok(remainingTableBoundaryDrifts.every(output => rejectsCode(
    () => verifyAfter(verifyOptions(adapter(output))),
    'POST_CONTRACT_MISMATCH',
  )),
  'table owner and force-RLS drift each change the exact disposable-source contract hash');

  const ownerDefaultDrift = postTranscript(sections => {
    sections.f27_table_boundaries[0].value.effective_grants =
      sections.f27_table_boundaries[0].value.effective_grants
        .filter(grant => grant.grantee !== 'postgres' || grant.privilege !== 'MAINTAIN');
  });
  ok(rejectsCode(
    () => verifyAfter(verifyOptions(adapter(ownerDefaultDrift))),
    'F27_TABLE_BOUNDARIES_INVALID',
  ), 'an owner privilege set that differs from the running server acldefault fails closed');

  const missingFunction = postTranscript(sections => { sections.f27_functions.pop(); });
  ok(rejectsCode(() => verifyAfter(verifyOptions(adapter(missingFunction))), 'F27_FUNCTIONS_INVALID'),
  'an incomplete F27 runtime function closure cannot pass post-COMMIT readback');

  const missingTableBoundary = postTranscript(sections => { sections.f27_table_boundaries.pop(); });
  ok(rejectsCode(() => verifyAfter(verifyOptions(adapter(missingTableBoundary))), 'F27_TABLE_BOUNDARIES_INVALID'),
  'all three exact F27 table owner/RLS/ACL boundary records are mandatory');

  const missingExecuteBoundary = postTranscript(sections => { sections.f27_function_execute_grants.pop(); });
  ok(rejectsCode(() => verifyAfter(verifyOptions(adapter(missingExecuteBoundary))), 'F27_FUNCTION_EXECUTE_GRANTS_INVALID'),
  'all nine exact F27 RPC effective-EXECUTE boundary records are mandatory');

  const tamperedBundlePath = path.join(tempRoot, 'tampered.snapshot');
  const tamperedBytes = Buffer.from(bundleBytes);
  tamperedBytes[tamperedBytes.length - 2] ^= 1;
  fs.writeFileSync(tamperedBundlePath, tamperedBytes, { mode: 0o600 });
  const noPostCall = adapter(postTranscript());
  ok(rejectsCode(() => verifyAfter(verifyOptions(noPostCall, {
    bundlePath: tamperedBundlePath,
  })), 'PRIVATE_BUNDLE_HASH_MISMATCH')
    && noPostCall.calls.length === 0,
  'tampered private baseline fails before psql post-COMMIT readback');

  const secondDir = privateDir(tempRoot, 'capture-two');
  const second = captureSnapshot(options(secondDir, adapter(transcript())));
  ok(second.snapshot_manifest_sha256 === receipt.snapshot_manifest_sha256
    && second.snapshot_bundle_sha256 === receipt.snapshot_bundle_sha256,
  'identical transaction transcripts seal to byte-identical deterministic manifests and bundles');

  const dirtyDir = privateDir(tempRoot, 'dirty');
  fs.writeFileSync(path.join(dirtyDir, 'existing'), 'do not overwrite');
  const neverCalled = adapter(transcript());
  ok(rejectsCode(() => captureSnapshot(options(dirtyDir, neverCalled)), 'DIRTY_OUTPUT_REJECTED')
    && neverCalled.calls.length === 0,
  'dirty output is refused before psql or any write');

  const repoDir = privateDir(tempRoot, 'simulated-public-worktree');
  const insideRepo = path.join(repoDir, 'private-output');
  fs.mkdirSync(insideRepo, { mode: 0o700 });
  ok(rejectsCode(() => captureSnapshot(options(insideRepo, adapter(transcript()), { worktreeRoots: [repoDir] })), 'WORKTREE_PATH_REJECTED'),
    'an output directory inside any Git worktree is rejected');

  const incompleteDir = privateDir(tempRoot, 'incomplete');
  const incomplete = transcript(sections => { sections.functions.pop(); sections.functions.pop(); });
  ok(rejectsCode(() => captureSnapshot(options(incompleteDir, adapter(incomplete))), 'FUNCTION_CLOSURE_INCOMPLETE')
    && fs.readdirSync(incompleteDir).length === 0,
  'missing mandatory function closure fails closed and writes no private artifact');

  const wrongIdentityDir = privateDir(tempRoot, 'wrong-function-identity');
  const wrongIdentity = transcript(sections => {
    sections.functions.find(item => item.value.name === 'track_b_f27_write_authorization').value.regprocedure_identity = 'public.track_b_f27_write_authorization(jsonb)';
  });
  ok(rejectsCode(() => captureSnapshot(options(wrongIdentityDir, adapter(wrongIdentity))), 'FUNCTION_IDENTITY_INCOMPLETE'),
    'a same-name wrong overload cannot substitute for the required pre-F27 boundary-function identity');

  const unsafeFlagsDir = privateDir(tempRoot, 'unsafe-flags');
  const unsafeFlags = transcript(sections => {
    sections.runtime_safety[0].value.flags.prod_authority = { video: 'syncview', graphics: 'linear' };
  });
  ok(rejectsCode(() => captureSnapshot(options(unsafeFlagsDir, adapter(unsafeFlags))), 'RUNTIME_SAFETY_INVALID')
    && fs.readdirSync(unsafeFlagsDir).length === 0,
  'capture refuses an authority/F2/F4 posture outside the exact dormant invariant');

  const partialF27Mutators = [
    sections => { sections.pre_f27_baseline[0].value.f27_table_count = 2; },
    sections => { sections.pre_f27_baseline[0].value.allowed_f27_table_count = 0; },
    sections => { sections.pre_f27_baseline[0].value.fence_row_count = 3; },
    sections => { sections.pre_f27_baseline[0].value.fence_generations.video = 1; },
    sections => { sections.pre_f27_baseline[0].value.open_rollback_row_count = 1; },
    sections => { sections.pre_f27_baseline[0].value.reviewed_subset_contract = 'FAIL'; },
    sections => { sections.pre_f27_baseline[0].value.reviewed_subset_contract_sha256 = '0'.repeat(64); },
    sections => { sections.pre_f27_baseline[0].value.f27_outbox_column_count = 1; },
    sections => { sections.pre_f27_baseline[0].value.f27_outbox_constraint_count = 1; },
    sections => { sections.pre_f27_baseline[0].value.f27_outbox_index_count = 1; },
    sections => { sections.pre_f27_baseline[0].value.f27_outbox_trigger_count = 1; },
    sections => { sections.pre_f27_baseline[0].value.unexpected_f27_function_count = 1; },
    sections => { sections.pre_f27_baseline[0].value.allowed_boundary_function_count = 1; },
    sections => { sections.pre_f27_baseline[0].value.allowed_f27_function_count = 0; },
  ];
  ok(partialF27Mutators.every((mutator, index) => {
    const outputDir = privateDir(tempRoot, `partial-f27-${index}`);
    const rejected = rejectsCode(
      () => captureSnapshot(options(outputDir, adapter(transcript(mutator)))),
      'PRE_F27_BASELINE_REQUIRED',
    );
    return rejected && fs.readdirSync(outputDir).length === 0;
  }),
  'any subset definition/row drift, open rollback, added outbox object, unexpected function, or missing allowed identity fails before private write');

  const duplicateDir = privateDir(tempRoot, 'duplicate');
  const duplicate = transcript(sections => { sections.constraints.push({ ...sections.constraints[0] }); });
  ok(rejectsCode(() => captureSnapshot(options(duplicateDir, adapter(duplicate))), 'INVENTORY_DUPLICATE')
    && fs.readdirSync(duplicateDir).length === 0,
  'duplicate inventory identities fail before any snapshot file is written');

  const malformedDir = privateDir(tempRoot, 'malformed');
  const malformed = transcript(sections => { sections.constraints[0].value.definition = ''; });
  ok(rejectsCode(() => captureSnapshot(options(malformedDir, adapter(malformed))), 'DEFINITION_MALFORMED'),
    'missing definitions in a present constraint/function/index/trigger inventory fail closed while a complete zero-trigger inventory is valid');

  const wrongDbDir = privateDir(tempRoot, 'wrong-db');
  const wrongDb = transcript(sections => { sections.metadata[0].value.current_database = 'wrong'; });
  ok(rejectsCode(() => captureSnapshot(options(wrongDbDir, adapter(wrongDb))), 'TRANSACTION_PROOF_FAILED'),
    'database readback must exactly match the explicit database confirmation');

  const adapterFailureDir = privateDir(tempRoot, 'adapter-failure');
  const leakedError = new Error(`${SECRET} fixture-password ${adapterFailureDir}`);
  let capturedError;
  try { captureSnapshot(options(adapterFailureDir, adapter('', { error: leakedError }))); } catch (error) { capturedError = error; }
  const safeFailure = JSON.stringify(publicFailure(capturedError));
  ok(capturedError instanceof SnapshotCaptureError
    && capturedError.code === 'PSQL_CAPTURE_FAILED'
    && !safeFailure.includes(SECRET)
    && !safeFailure.includes('fixture-password')
    && !safeFailure.includes(adapterFailureDir),
  'psql faults are reduced to a stable row-, credential-, and path-free failure');

  const partialPsqlError = psqlCaptureFailure(`ERROR: F27_SNAPSHOT_PRE_F27_BASELINE_REQUIRED ${SECRET}`);
  const publicPartialFailure = JSON.stringify(publicFailure(partialPsqlError));
  ok(partialPsqlError.code === 'PRE_F27_BASELINE_REQUIRED'
    && /PRE_F27_BASELINE_REQUIRED/.test(publicPartialFailure)
    && !publicPartialFailure.includes(SECRET),
  'server-side partial-F27 refusal maps to one stable public-safe failure without stderr disclosure');
  const hostileReceipt = publicFailure(new SnapshotCaptureError('SAFE_CODE', 'safe message', {
    status: 'PASS',
    code: 'OVERRIDDEN',
    private_path: `${SECRET}/private`,
    expected_raw_inventory_sha256: `${SECRET}/not-a-hash`,
  }));
  ok(hostileReceipt.status === 'FAIL'
      && hostileReceipt.code === 'SAFE_CODE'
      && !JSON.stringify(hostileReceipt).includes(SECRET)
      && !Object.prototype.hasOwnProperty.call(hostileReceipt, 'private_path')
      && !Object.prototype.hasOwnProperty.call(hostileReceipt, 'expected_raw_inventory_sha256'),
  'an exported error cannot override the failure terminal or smuggle arbitrary receipt fields');

  ok(rejectsCode(() => captureSnapshot(options(privateDir(tempRoot, 'unconfirmed'), adapter(transcript()), { confirmed: false })), 'CONFIRMATION_REQUIRED'),
    'missing explicit capture confirmation refuses all work');
  ok(rejectsCode(() => captureSnapshot(options(privateDir(tempRoot, 'project-mismatch'), adapter(transcript()), { projectRef: 'z'.repeat(20) })), 'PROJECT_CONFIRMATION_MISMATCH'),
    'database URL must exactly bind the explicit project confirmation');
  const pooledEnv = parseDatabaseUrl(
    `postgresql://postgres.${PROJECT_REF}:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require`,
    PROJECT_REF,
    'postgres',
  );
  ok(pooledEnv.PGHOST === 'aws-0-us-east-1.pooler.supabase.com'
      && pooledEnv.PGPORT === '6543'
      && pooledEnv.PGUSER === `postgres.${PROJECT_REF}`
      && pooledEnv.PGSSLMODE === 'require',
  'an exact project-bound Supabase pooler endpoint is accepted with mandatory TLS');
  for (const hostileUrl of [
    `postgresql://postgres.${PROJECT_REF}:secret@credential-collector.invalid/postgres`,
    `postgresql://attacker.${PROJECT_REF}:secret@aws-0-us-east-1.pooler.supabase.com/postgres`,
    `postgresql://postgres:secret@db.${PROJECT_REF}.supabase.co:6543/postgres`,
    `postgresql://postgres:secret@db.${PROJECT_REF}.supabase.co/postgres?sslmode=disable`,
  ]) {
    ok(rejectsCode(() => parseDatabaseUrl(hostileUrl, PROJECT_REF, 'postgres'), 'PROJECT_CONFIRMATION_MISMATCH')
        || rejectsCode(() => parseDatabaseUrl(hostileUrl, PROJECT_REF, 'postgres'), 'DATABASE_URL_INVALID'),
    'host, user, port, and TLS binding reject a credential-exfiltration database URL');
  }
  const childEnvironment = safePsqlEnvironment(
    { PGHOST: 'exact-host', PGPASSWORD: 'exact-password' },
    {
      PATH: 'safe-path', PGHOSTADDR: '203.0.113.9', pgservice: 'hostile',
      F27_DATABASE_URL: 'private-url', SUPABASE_ACCESS_TOKEN: 'private-token',
    },
  );
  ok(childEnvironment.PATH === 'safe-path'
      && childEnvironment.PGHOST === 'exact-host'
      && childEnvironment.PGPASSWORD === 'exact-password'
      && childEnvironment.PGHOSTADDR === undefined
      && childEnvironment.pgservice === undefined
      && childEnvironment.F27_DATABASE_URL === undefined
      && childEnvironment.SUPABASE_ACCESS_TOKEN === undefined,
  'psql receives an allowlisted process environment and cannot inherit a host-address override or unrelated secret');
  ok(rejectsCode(() => captureSnapshot(options(privateDir(tempRoot, 'dirty-source'), adapter(transcript()), { releaseInfo: { headSha: RELEASE_SHA, originMainSha: RELEASE_SHA, dirty: true, migrationSha256: MIGRATION_SHA } })), 'DIRTY_SOURCE_REJECTED'),
    'dirty source refuses a release-bound operational snapshot');
  ok(rejectsCode(() => captureSnapshot(options(privateDir(tempRoot, 'wrong-origin-main'), adapter(transcript()), { releaseInfo: { headSha: RELEASE_SHA, originMainSha: 'b'.repeat(40), dirty: false, migrationSha256: MIGRATION_SHA } })), 'RELEASE_SHA_MISMATCH'),
    'capture release must match the independently fetched origin/main SHA');

  let argsRejected = false;
  try { parseArgs(['--output-dir', firstDir, '--output-dir', firstDir]); } catch (error) { argsRejected = error && error.code === 'ARGUMENT_REJECTED'; }
  ok(argsRejected, 'ambiguous, duplicate, or incomplete CLI options are rejected');
  const windowPArgs = parseArgs([
    '--mode', 'window-p-preflight',
    '--confirm-project-ref', PROJECT_REF,
    '--confirm-database', 'postgres',
    '--release-sha', RELEASE_SHA,
  ]);
  ok(windowPArgs.mode === 'window-p-preflight' && windowPArgs.outputDir === undefined,
    'CLI exposes Window P preflight as a read-only no-artifact mode');
  ok(rejectsCode(() => parseArgs([
    '--mode', 'window-p-preflight',
    '--confirm-project-ref', PROJECT_REF,
    '--confirm-database', 'postgres',
    '--release-sha', RELEASE_SHA,
    '--output-dir', firstDir,
  ]), 'ARGUMENT_REJECTED'),
  'Window P preflight rejects snapshot/verify artifact inputs');
  const fingerprintArgs = parseArgs([
    '--mode', 'fingerprint-post',
    '--output-dir', fingerprintDir,
    '--confirm-database', 'f27_operator',
    '--release-sha', RELEASE_SHA,
  ]);
  ok(fingerprintArgs.mode === 'fingerprint-post' && fingerprintArgs.outputDir === fingerprintDir,
    'fingerprint-post requires a private directory for the expected raw inventory handoff');
  ok(rejectsCode(() => parseArgs([
    '--mode', 'verify-after',
    '--output-dir', firstDir,
    '--bundle', bundlePath,
    '--expected-bundle-sha256', receipt.snapshot_bundle_sha256,
    '--expected-post-contract-sha256', expectedPostContract,
    '--confirm-project-ref', PROJECT_REF,
    '--confirm-database', 'postgres',
    '--release-sha', RELEASE_SHA,
  ]), 'ARGUMENT_REJECTED'),
  'verify-after cannot discard the expected raw inventory by accepting only its normalized hash');
  const verifyArgs = parseArgs([
    '--mode', 'verify-after',
    '--output-dir', firstDir,
    '--bundle', bundlePath,
    '--expected-bundle-sha256', receipt.snapshot_bundle_sha256,
    '--expected-post-contract-sha256', expectedPostContract,
    '--expected-post-contract-inventory', expectedInventoryPath,
    '--expected-post-contract-inventory-sha256',
    disposableFingerprint.post_contract_raw_inventory_sha256,
    '--expected-post-contract-inventory-byte-length',
    String(disposableFingerprint.post_contract_raw_inventory_byte_length),
    '--confirm-project-ref', PROJECT_REF,
    '--confirm-database', 'postgres',
    '--release-sha', RELEASE_SHA,
  ]);
  ok(verifyArgs.mode === 'verify-after'
      && verifyArgs.expectedPostContractInventoryPath === expectedInventoryPath
      && verifyArgs.expectedPostContractInventorySha256
        === disposableFingerprint.post_contract_raw_inventory_sha256,
  'verify-after CLI binds the expected raw inventory and a private mismatch transcript directory');

  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'f27-mirror-outbox-snapshot.js'), 'utf8');
  ok(!/console\.(?:log|error|warn)\s*\(/.test(source)
    && /process\.stdout\.write\(`\$\{JSON\.stringify\(runFromEnvironment\(\)\)\}/.test(source)
    && /process\.stderr\.write\(`\$\{JSON\.stringify\(publicFailure\(error\)\)\}/.test(source),
  'CLI has no raw logging path; it prints only the bounded receipt or sanitised failure');
} finally {
  makeWritableTree(tempRoot);
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

if (failures) process.exit(1);
console.log('\nF27 mirror_outbox private snapshot checks passed');
