'use strict';

/*
 * F27 pre-DDL mirror_outbox capture.
 *
 * This tool is intentionally database-read-only. It opens one psql session and
 * takes every database item inside one REPEATABLE READ, READ ONLY transaction.
 * Private rows and definitions are written only below the explicitly supplied
 * private output directory; stdout receives a redacted receipt only.
 *
 * Usage (future owner-gated install window only):
 *   F27_DATABASE_URL='postgresql://...' \
 *   F27_CONFIRM_MIRROR_OUTBOX_SNAPSHOT=1 \
 *   node scripts/f27-mirror-outbox-snapshot.js \
 *     --output-dir /absolute/empty/private/directory \
 *     --confirm-project-ref <project-ref> \
 *     --confirm-database postgres \
 *     --release-sha <40-lowercase-hex>
 *
 * The receipt's snapshot_bundle_sha256 deterministically names the private
 * handoff file as f27-mirror-outbox-<sha256>.snapshot below --output-dir. The
 * private path itself is never printed. `--mode fingerprint-post` reads a
 * loopback disposable database to produce the normalized source-contract hash
 * plus a private raw seven-category inventory. `--mode verify-after` requires
 * that private inventory and its hash, the normalized hash, the sealed
 * pre-DDL bundle, and an empty private mismatch transcript directory.
 *
 * No live invocation is part of this source-only change.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATION_RELATIVE_PATH = 'migrations/2026-07-20-f27-team-rollback.sql';
const PRE_F27_AUTHORITY_MIGRATION_RELATIVE_PATH =
  'migrations/2026-07-12-write-ui-outbox-parity.sql';
const FORMAT = 'syncview-f27-mirror-outbox-snapshot-v1';
const TOOL_RELEASE = 'f27-mirror-outbox-snapshot-v1';
const POST_CONTRACT_FORMAT = `${FORMAT}-post-contract-v2`;
const RAW_POST_INVENTORY_FORMAT = 'syncview-f27-post-contract-raw-inventory-v1';
const HASH_RE = /^[a-f0-9]{64}$/;
const SHA_RE = /^[a-f0-9]{40}$/;
const PROJECT_REF_RE = /^[a-z0-9]{20}$/;
const SAFE_DATABASE_RE = /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/;
const NEWEST_LIMIT = 5;
const REQUIRED_SECTIONS = [
  'metadata',
  'runtime_safety',
  'pre_f27_baseline',
  'table',
  'columns',
  'constraints',
  'triggers',
  'functions',
  'indexes',
  'policies',
  'grants',
  'rows',
  'aggregates',
  'newest',
];
const REQUIRED_COLUMNS = ['id', 'payload', 'created_at', 'team', 'status', 'dedup_key'];
const REQUIRED_FUNCTION_NAMES = ['mirror_outbox_enqueue', 'track_b_f27_write_authorization'];
const REQUIRED_BOUNDARY_FUNCTION_IDENTITIES = [
  'public.mirror_outbox_enqueue(text,text,text,jsonb,text,timestamp with time zone,text,text,text,text,text,text,text,bigint,boolean)',
  'public.track_b_f27_write_authorization(text)',
  'public.production_assert_authority(text,text,boolean,boolean)',
];
const PRE_F27_FENCE_TABLE_NAME = 'track_b_f27_team_fences';
const PRE_F27_FENCE_TABLE_IDENTITY = `public.${PRE_F27_FENCE_TABLE_NAME}`;
const PRE_F27_MIRROR_ENQUEUE_IDENTITY = REQUIRED_BOUNDARY_FUNCTION_IDENTITIES[0];
const PRE_F27_WRITE_AUTHORIZATION_IDENTITY = 'public.track_b_f27_write_authorization(text)';
const PRE_F27_PRODUCTION_AUTHORITY_IDENTITY =
  'public.production_assert_authority(text,text,boolean,boolean)';
const EXPECTED_RUNTIME_FLAGS = {
  linear_legacy_parity_enabled: { enabled: false },
  linear_outbound_enabled: { mode: 'off' },
  prod_authority: { graphics: 'linear', video: 'linear' },
};
const EXPECTED_WINDOW_P_RUNTIME_FLAGS = {
  linear_legacy_parity_enabled: { enabled: true },
  linear_outbound_enabled: { mode: 'off' },
  prod_authority: { graphics: 'linear', video: 'linear' },
};
const F27_FUNCTION_NAMES = [
  'mirror_outbox_enqueue',
  'track_b_f27_write_authorization',
  'track_b_f27_requeue',
  'track_b_f27_hold_guard',
  'production_assert_authority',
  'track_b_f27_begin',
  'track_b_f27_begin_drill',
  'track_b_f27_classify',
  'track_b_f27_execute_drill_replay',
  'track_b_f27_record_terminal',
  'track_b_f27_finalize',
  'track_b_f27_finalize_drill',
];
const F27_CONSTRAINT_NAMES = [
  'mirror_outbox_f27_drill_rollback_id_fkey',
  'mirror_outbox_f27_drill_scope_check',
  'mirror_outbox_f27_generation_check',
];
const F27_OUTBOX_COLUMN_NAMES = ['authority_generation', 'f27_drill_rollback_id'];
const F27_OUTBOX_INDEX_NAME = 'mirror_outbox_one_f27_drill_row_idx';
const F27_OUTBOX_TRIGGER_NAME = 'track_b_f27_hold_guard';
const F27_TABLE_NAMES = [
  'track_b_f27_team_fences',
  'track_b_team_rollbacks',
  'track_b_team_rollback_intents',
];
const F27_EXECUTE_FUNCTION_IDENTITIES = [
  'public.track_b_f27_write_authorization(text)',
  'public.track_b_f27_requeue(bigint,bigint)',
  'public.track_b_f27_begin(text,jsonb,text)',
  'public.track_b_f27_begin_drill(jsonb,text)',
  'public.track_b_f27_classify(uuid,bigint,text,text,text,jsonb)',
  'public.track_b_f27_execute_drill_replay(uuid,bigint,uuid)',
  'public.track_b_f27_record_terminal(uuid,bigint,jsonb)',
  'public.track_b_f27_finalize(uuid,jsonb,text)',
  'public.track_b_f27_finalize_drill(uuid,jsonb,text)',
];
const F27_MUTATING_FUNCTION_IDENTITIES = F27_EXECUTE_FUNCTION_IDENTITIES
  .filter(identity => identity !== PRE_F27_WRITE_AUTHORIZATION_IDENTITY);
const PRISTINE_PRE_F27_ENTRY_STATE = 'pristine_pre_f27';
const POST_SECTION7_ENTRY_STATE = 'exact_post_section7';
const EMPTY_F27_AUDIT_STATE_SHA256 = sha256(Buffer.from(stableJson({
  intents: [],
  rollbacks: [],
}), 'utf8'));
const F27_ROLLBACK_BOUNDARY_RECEIPT_SHA256 =
  'c4fa6e8e34feb187980a616a076d2aa1f5b7580a4c76204d2661ba3e208296d9';
const F27_ROLLBACK_TRANSCRIPT_RECEIPT_SHA256 =
  'e884b7d369389388ed5e55c376f3518f4fdc4379e64c683596adf4cb9ab2772c';
const SAFE_TEAMS = new Set(['video', 'graphics']);
const SAFE_STATUSES = new Set(['pending', 'shadow_ok', 'written', 'failed', 'skipped', 'stale']);
const TERMINAL_STATUSES = new Set(['written', 'skipped', 'stale']);
const WINDOWS_PRIVATE_ACL_FORMAT = 'syncview-f27-windows-private-acl-v1';
const WINDOWS_SYSTEM_SID = 'S-1-5-18';
const WINDOWS_ADMINISTRATORS_SID = 'S-1-5-32-544';
const WINDOWS_PRIVATE_ACL_ACTIONS = new Set(['protect-directory', 'verify-file']);
const WINDOWS_PRIVATE_ACL_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  "$target = [Environment]::GetEnvironmentVariable('F27_PRIVATE_ACL_TARGET', 'Process')",
  "$action = [Environment]::GetEnvironmentVariable('F27_PRIVATE_ACL_ACTION', 'Process')",
  "if ([string]::IsNullOrWhiteSpace($target)) { throw 'missing ACL target' }",
  "$item = Get-Item -LiteralPath $target -Force",
  "$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
  "$allowedSids = @($currentSid, 'S-1-5-18', 'S-1-5-32-544') | Select-Object -Unique",
  "if ($action -eq 'protect-directory') {",
  "  if (-not $item.PSIsContainer) { throw 'ACL target is not a directory' }",
  "  $secureAcl = New-Object Security.AccessControl.DirectorySecurity",
  "  $secureAcl.SetOwner((New-Object Security.Principal.SecurityIdentifier($currentSid)))",
  "  $secureAcl.SetAccessRuleProtection($true, $false)",
  "  $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit",
  "  foreach ($sidValue in $allowedSids) {",
  "    $sid = New-Object Security.Principal.SecurityIdentifier($sidValue)",
  "    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, [Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)",
  "    [void]$secureAcl.AddAccessRule($rule)",
  "  }",
  "  [IO.Directory]::SetAccessControl($target, $secureAcl)",
  "} elseif ($action -eq 'verify-file') {",
  "  if ($item.PSIsContainer) { throw 'ACL target is not a file' }",
  "} else { throw 'invalid ACL action' }",
  "$acl = Get-Acl -LiteralPath $target",
  "$ownerSid = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value",
  "$rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))",
  "$unexpected = 0",
  "$denied = 0",
  "$currentRights = [Security.AccessControl.FileSystemRights]0",
  "foreach ($rule in $rules) {",
  "  $sidValue = $rule.IdentityReference.Value",
  "  if ($allowedSids -notcontains $sidValue) { $unexpected += 1 }",
  "  if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { $denied += 1 }",
  "  if ($sidValue -eq $currentSid -and $rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow) {",
  "    $currentRights = [Security.AccessControl.FileSystemRights]([int64]$currentRights -bor [int64]$rule.FileSystemRights)",
  "  }",
  "}",
  "$fullControl = (([int64]$currentRights -band [int64][Security.AccessControl.FileSystemRights]::FullControl) -eq [int64][Security.AccessControl.FileSystemRights]::FullControl)",
  "[ordered]@{",
  `  format = '${WINDOWS_PRIVATE_ACL_FORMAT}'`,
  "  action = $action",
  "  path_kind = $(if ($item.PSIsContainer) { 'directory' } else { 'file' })",
  "  current_user_sid = $currentSid",
  "  owner_sid = $ownerSid",
  "  allowed_sids = @($allowedSids | Sort-Object)",
  "  access_rule_count = $rules.Count",
  "  access_rules_protected = [bool]$acl.AreAccessRulesProtected",
  "  unexpected_access_rule_count = $unexpected",
  "  deny_rule_count = $denied",
  "  current_user_full_control = [bool]$fullControl",
  "} | ConvertTo-Json -Compress -Depth 4",
].join('\n');

function normalizeFunctionSource(source) {
  return String(source == null ? '' : source).replace(/\r\n?/g, '\n');
}

function reviewedFunctionSource(relativePath, signature, failureLabel) {
  let migration;
  try {
    migration = fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
  } catch (_) {
    fail('MIGRATION_READ_FAILED', `The reviewed ${failureLabel} source could not be read.`);
  }
  const signatureAt = migration.indexOf(signature);
  const bodyStartMarker = 'as $fn$';
  const bodyStart = migration.indexOf(bodyStartMarker, signatureAt);
  const bodyEnd = migration.indexOf('$fn$;', bodyStart + bodyStartMarker.length);
  if (signatureAt < 0 || bodyStart < 0 || bodyEnd <= bodyStart) {
    fail('MIGRATION_CONTRACT_INVALID', `The reviewed ${failureLabel} source could not be extracted.`);
  }
  return normalizeFunctionSource(migration.slice(bodyStart + bodyStartMarker.length, bodyEnd));
}

function reviewedWriteAuthorizationSource() {
  return reviewedFunctionSource(
    MIGRATION_RELATIVE_PATH,
    'create or replace function public.track_b_f27_write_authorization(p_team text)',
    'F27 write-authorization',
  );
}

function reviewedProductionAuthoritySource() {
  return reviewedFunctionSource(
    PRE_F27_AUTHORITY_MIGRATION_RELATIVE_PATH,
    'create or replace function public.production_assert_authority(',
    'pre-F27 production authority',
  );
}

function reviewedPreF27SubsetContract() {
  const functionAccess = {
    owner: 'postgres',
    owner_privileges: 'SERVER_ACLDEFAULT',
    exact_non_owner_grant: {
      grantee: 'service_role',
      grantor: 'owner',
      privilege: 'EXECUTE',
      grantable: false,
    },
    dynamic_server_privilege_vocabulary: true,
  };
  return {
    format: 'syncview-f27-preinstall-reviewed-subset-v4',
    fence_table: {
      identity: PRE_F27_FENCE_TABLE_IDENTITY,
      owner: 'postgres',
      access: {
        owner: 'postgres',
        exact_non_owner_grant: {
          grantee: 'service_role',
          grantor: 'owner',
          privilege: 'SELECT',
          grantable: false,
        },
        effective_denied_roles: ['PUBLIC', 'anon', 'authenticated'],
        dynamic_server_privilege_vocabulary: true,
        column_grants: false,
      },
      columns: [
        ['team', 'text', true, null],
        ['generation', 'bigint', true, '0'],
        ['updated_at', 'timestamp with time zone', true, 'now()'],
        ['updated_by', 'text', true, null],
      ],
      constraints: [
        'track_b_f27_team_fences_generation_check',
        'track_b_f27_team_fences_pkey',
        'track_b_f27_team_fences_team_check',
      ],
      rows: { graphics: 0, video: 0 },
      updated_by: 'f27-migration',
    },
    mirror_outbox_enqueue: {
      identity: PRE_F27_MIRROR_ENQUEUE_IDENTITY,
      owner: 'postgres',
      access: functionAccess,
      preservation: 'source-exact-preinstall-acl',
    },
    write_authorization: {
      identity: PRE_F27_WRITE_AUTHORIZATION_IDENTITY,
      owner: 'postgres',
      access: functionAccess,
      result: 'jsonb',
      language: 'plpgsql',
      security_definer: true,
      volatility: 'stable',
      parallel: 'unsafe',
      config: ['search_path=public'],
      source_sha256: sha256(Buffer.from(reviewedWriteAuthorizationSource(), 'utf8')),
    },
    production_authority: {
      identity: PRE_F27_PRODUCTION_AUTHORITY_IDENTITY,
      source_migration: PRE_F27_AUTHORITY_MIGRATION_RELATIVE_PATH,
      owner: 'postgres',
      access: functionAccess,
      result: 'void',
      language: 'plpgsql',
      security_definer: true,
      volatility: 'volatile',
      parallel: 'unsafe',
      config: ['search_path=public'],
      source_sha256: sha256(Buffer.from(reviewedProductionAuthoritySource(), 'utf8')),
    },
  };
}

function reviewedPreF27SubsetContractSha256() {
  return sha256(Buffer.from(stableJson(reviewedPreF27SubsetContract()), 'utf8'));
}

const RETAINED_F27_FUNCTIONS = [
  ['track_b_f27_requeue', 'public.track_b_f27_requeue(bigint,bigint)', 'boolean', 'volatile'],
  ['track_b_f27_hold_guard', 'public.track_b_f27_hold_guard()', 'trigger', 'volatile'],
  ['track_b_f27_begin', 'public.track_b_f27_begin(text,jsonb,text)', 'jsonb', 'volatile'],
  ['track_b_f27_begin_drill', 'public.track_b_f27_begin_drill(jsonb,text)', 'jsonb', 'volatile'],
  ['track_b_f27_classify', 'public.track_b_f27_classify(uuid,bigint,text,text,text,jsonb)', 'jsonb', 'volatile'],
  ['track_b_f27_execute_drill_replay', 'public.track_b_f27_execute_drill_replay(uuid,bigint,uuid)', 'jsonb', 'volatile'],
  ['track_b_f27_record_terminal', 'public.track_b_f27_record_terminal(uuid,bigint,jsonb)', 'jsonb', 'volatile'],
  ['track_b_f27_finalize', 'public.track_b_f27_finalize(uuid,jsonb,text)', 'jsonb', 'volatile'],
  ['track_b_f27_finalize_drill', 'public.track_b_f27_finalize_drill(uuid,jsonb,text)', 'jsonb', 'volatile'],
];
function reviewedRetainedFunctionSource(name) {
  return reviewedFunctionSource(
    MIGRATION_RELATIVE_PATH,
    `create or replace function public.${name}(`,
    `retained ${name}`,
  );
}

function reviewedPostSection7Contract() {
  return {
    format: 'syncview-f27-post-section7-reviewed-boundary-v1',
    entry_state: POST_SECTION7_ENTRY_STATE,
    corroborating_production_receipts: {
      restored_boundary_sha256: F27_ROLLBACK_BOUNDARY_RECEIPT_SHA256,
      rollback_transcript_sha256: F27_ROLLBACK_TRANSCRIPT_RECEIPT_SHA256,
      role: 'corroborating-not-allowlist',
    },
    retained_inventory: {
      tables: [...F27_TABLE_NAMES],
      outbox_columns: [...F27_OUTBOX_COLUMN_NAMES],
      outbox_constraints: [...F27_CONSTRAINT_NAMES],
      outbox_index: F27_OUTBOX_INDEX_NAME,
      hold_trigger: { name: F27_OUTBOX_TRIGGER_NAME, enabled: 'D' },
      functions: [...F27_FUNCTION_NAMES],
    },
    boundary_functions: {
      identities: [...REQUIRED_BOUNDARY_FUNCTION_IDENTITIES],
      source: 'exact-captured-preinstall-boundary',
      access: 'owner-default-plus-exact-service-role-only-execute',
    },
    retained_functions: RETAINED_F27_FUNCTIONS.map(([name, identity, result, volatility]) => ({
      name,
      identity,
      result,
      language: 'plpgsql',
      security_definer: true,
      volatility,
      parallel: 'unsafe',
      config: ['search_path=public'],
      source_sha256: sha256(Buffer.from(reviewedRetainedFunctionSource(name), 'utf8')),
    })),
    table_access: {
      owner_privileges: 'SERVER_ACLDEFAULT',
      exact_non_owner_grants: [{
        grantee: 'service_role', grantor: 'owner', privilege: 'SELECT', grantable: false,
      }],
    },
    mutating_execute_access: {
      identities: [...F27_MUTATING_FUNCTION_IDENTITIES],
      owner_access_only: true,
      accepted_hold_guard_acl_variants: [
        {
          name: 'legacy_2026_08_01_acldefault_public_execute',
          contract: 'proacl-null-exact-acldefault-including-public-execute',
        },
        {
          name: 'current_owner_only',
          contract: 'owner-default-execute-only-with-zero-non-owner-grants',
        },
      ],
    },
    state: {
      fences: 'exact-video-graphics-nonnegative-preserved',
      open_rollbacks: 0,
      unresolved_intents: 0,
      completed_real_chain: 'contiguous-zero-through-generation-minus-one',
      completed_drill_audit: 'retained-no-generation-advance',
    },
  };
}

function reviewedPostSection7ContractSha256() {
  return sha256(Buffer.from(stableJson(reviewedPostSection7Contract()), 'utf8'));
}

function reviewedPostSection7SqlGate() {
  let migration;
  try {
    migration = normalizeFunctionSource(fs.readFileSync(
      path.join(REPO_ROOT, MIGRATION_RELATIVE_PATH),
      'utf8',
    ));
  } catch (_) {
    fail('MIGRATION_READ_FAILED', 'The reviewed retained-state SQL gate could not be read.');
  }
  const startMarker = "  if v_entry_state = 'retained_post_rollback' then\n"
    + '    -- Section 7 deliberately retains';
  const endMarker = '\n  if exists (\n    select 1\n    from pg_proc p\n'
    + '    where p.oid = v_mirror_enqueue_oid';
  const start = migration.indexOf(startMarker);
  const end = migration.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end <= start) {
    fail('MIGRATION_CONTRACT_INVALID', 'The reviewed retained-state SQL gate could not be extracted.');
  }
  return migration.slice(start, end).trimEnd();
}

function reviewedFenceTableSqlGate() {
  let migration;
  try {
    migration = normalizeFunctionSource(fs.readFileSync(
      path.join(REPO_ROOT, MIGRATION_RELATIVE_PATH),
      'utf8',
    ));
  } catch (_) {
    fail('MIGRATION_READ_FAILED', 'The reviewed common fence-table SQL gate could not be read.');
  }
  const startMarker = '\n  if exists (\n       select 1\n       from pg_class c\n'
    + '       join pg_namespace n on n.oid = c.relnamespace\n'
    + '       join pg_am am on am.oid = c.relam\n'
    + '       where c.oid = v_fence_oid';
  const endMarker = "\n\n  if v_entry_state = 'retained_post_rollback' then";
  const start = migration.indexOf(startMarker);
  const end = migration.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end <= start) {
    fail('MIGRATION_CONTRACT_INVALID', 'The reviewed common fence-table SQL gate could not be extracted.');
  }
  const gate = migration.slice(start + 1, end).trimEnd();
  if (!gate.endsWith("raise exception 'F27_PREINSTALL_GATE_FENCE_SUBSET_DRIFT';\n  end if;")) {
    fail('MIGRATION_CONTRACT_INVALID', 'The reviewed common fence-table SQL gate lost its fail-closed terminal.');
  }
  return gate;
}

function reviewedBoundaryFunctionSqlGate() {
  let migration;
  try {
    migration = normalizeFunctionSource(fs.readFileSync(
      path.join(REPO_ROOT, MIGRATION_RELATIVE_PATH),
      'utf8',
    ));
  } catch (_) {
    fail('MIGRATION_READ_FAILED', 'The reviewed boundary-function SQL gate could not be read.');
  }
  const startMarker = '\n  if exists (\n    select 1\n    from pg_proc p\n'
    + '    where p.oid = v_mirror_enqueue_oid';
  const endMarker = '\n  if exists (\n       select 1\n       from pg_namespace';
  const start = migration.indexOf(startMarker);
  const end = migration.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end <= start) {
    fail('MIGRATION_CONTRACT_INVALID', 'The reviewed boundary-function SQL gate could not be extracted.');
  }
  return migration.slice(start + 1, end).trimEnd();
}

function reviewedUnexpectedObjectSqlGate() {
  let migration;
  try {
    migration = normalizeFunctionSource(fs.readFileSync(
      path.join(REPO_ROOT, MIGRATION_RELATIVE_PATH),
      'utf8',
    ));
  } catch (_) {
    fail('MIGRATION_READ_FAILED', 'The reviewed unexpected-object SQL gate could not be read.');
  }
  const startMarker = '\n  if exists (\n       select 1\n       from pg_namespace';
  const endMarker = "\n\n  raise notice 'F27_PREINSTALL_EXACT_SUBSET_GATE_PASS';";
  const start = migration.indexOf(startMarker);
  const end = migration.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end <= start) {
    fail('MIGRATION_CONTRACT_INVALID', 'The reviewed unexpected-object SQL gate could not be extracted.');
  }
  return migration.slice(start + 1, end).trimEnd();
}

class SnapshotCaptureError extends Error {
  constructor(code, message, publicSafeReceipt = null) {
    super(message);
    this.name = 'SnapshotCaptureError';
    this.code = code;
    this.publicSafeReceipt = publicSafeReceipt;
  }
}

function fail(code, message, publicSafeReceipt = null) {
  throw new SnapshotCaptureError(code, message, publicSafeReceipt);
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((output, key) => {
      output[key] = stableValue(value[key]);
      return output;
    }, {});
  }
  return value;
}

function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function defaultWindowsPrivateAclAdapter({
  spawn = spawnSync,
  environment = process.env,
} = {}) {
  const systemRoot = clean(environment && (environment.SystemRoot || environment.SYSTEMROOT));
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) {
    fail('WINDOWS_PRIVATE_ACL_REQUIRED', 'The Windows private-path ACL boundary could not be established.');
  }
  const executable = path.win32.join(
    systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe',
  );
  const encoded = Buffer.from(WINDOWS_PRIVATE_ACL_SCRIPT, 'utf16le').toString('base64');
  return {
    run(action, target) {
      const childEnv = {
        SystemRoot: systemRoot,
        WINDIR: systemRoot,
        F27_PRIVATE_ACL_ACTION: action,
        F27_PRIVATE_ACL_TARGET: target,
      };
      const result = spawn(executable, [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', encoded,
      ], {
        env: childEnv,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 64 * 1024,
      });
      if (!result || result.error || result.signal || result.status !== 0) {
        fail('WINDOWS_PRIVATE_ACL_REQUIRED', 'The Windows private-path ACL boundary could not be established.');
      }
      const output = clean(result.stdout);
      if (!output || output.includes('\n') || clean(result.stderr)) {
        fail('WINDOWS_PRIVATE_ACL_REQUIRED', 'The Windows private-path ACL proof was malformed.');
      }
      try { return JSON.parse(output); }
      catch (_) {
        fail('WINDOWS_PRIVATE_ACL_REQUIRED', 'The Windows private-path ACL proof was malformed.');
      }
    },
  };
}

function assertWindowsPrivateAcl(target, action, options = {}) {
  const platform = clean(options.aclPlatform || options.platform || process.platform).toLowerCase();
  if (platform !== 'win32') return { status: 'SKIPPED', platform };
  if (!WINDOWS_PRIVATE_ACL_ACTIONS.has(action)) {
    fail('WINDOWS_PRIVATE_ACL_REQUIRED', 'The Windows private-path ACL action was invalid.');
  }
  const adapter = options.privateAclAdapter || defaultWindowsPrivateAclAdapter();
  if (!adapter || typeof adapter.run !== 'function') {
    fail('WINDOWS_PRIVATE_ACL_REQUIRED', 'The Windows private-path ACL verifier was unavailable.');
  }
  let proof;
  try { proof = adapter.run(action, path.resolve(target)); }
  catch (error) {
    if (error instanceof SnapshotCaptureError) throw error;
    fail('WINDOWS_PRIVATE_ACL_REQUIRED', 'The Windows private-path ACL boundary could not be established.');
  }
  const currentSid = clean(proof && proof.current_user_sid);
  const expectedAllowed = [...new Set([
    currentSid, WINDOWS_SYSTEM_SID, WINDOWS_ADMINISTRATORS_SID,
  ])].sort();
  const observedAllowed = Array.isArray(proof && proof.allowed_sids)
    ? proof.allowed_sids.map(clean).sort() : [];
  const expectedKind = action === 'protect-directory' ? 'directory' : 'file';
  if (!proof || proof.format !== WINDOWS_PRIVATE_ACL_FORMAT || proof.action !== action
      || proof.path_kind !== expectedKind || !/^S-\d+(?:-\d+)+$/.test(currentSid)
      || proof.owner_sid !== currentSid
      || JSON.stringify(observedAllowed) !== JSON.stringify(expectedAllowed)
      || !Number.isSafeInteger(Number(proof.access_rule_count))
      || Number(proof.access_rule_count) < 1
      || Number(proof.unexpected_access_rule_count) !== 0
      || Number(proof.deny_rule_count) !== 0
      || proof.current_user_full_control !== true
      || (action === 'protect-directory' && proof.access_rules_protected !== true)) {
    fail('WINDOWS_PRIVATE_ACL_REQUIRED', 'The Windows private path permits a broad principal or lacks owner full control.');
  }
  return proof;
}

function protectWindowsPrivateDirectory(target, options = {}) {
  return assertWindowsPrivateAcl(target, 'protect-directory', options);
}

function assertWindowsPrivateFileAcl(target, options = {}) {
  return assertWindowsPrivateAcl(target, 'verify-file', options);
}

function normalized(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!path.isAbsolute(relative)
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`));
}

function lstatOrNull(value) {
  try {
    return fs.lstatSync(value);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    fail('OUTPUT_INSPECTION_FAILED', 'The private output directory could not be inspected safely.');
  }
}

function assertNoSymlinkComponents(absolutePath) {
  const parsed = path.parse(absolutePath);
  const tail = absolutePath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let cursor = parsed.root;
  for (const segment of tail) {
    cursor = path.join(cursor, segment);
    const stat = lstatOrNull(cursor);
    if (!stat) break;
    if (stat.isSymbolicLink()) {
      fail('SYMLINK_REJECTED', 'The private output directory must not contain a symbolic link or junction.');
    }
    let real;
    try {
      real = fs.realpathSync.native(cursor);
    } catch (_) {
      fail('OUTPUT_INSPECTION_FAILED', 'The private output directory could not be resolved safely.');
    }
    if (normalized(real) !== normalized(cursor)) {
      fail('SYMLINK_REJECTED', 'The private output directory must not contain a symbolic link or junction.');
    }
  }
}

function discoverRegisteredWorktrees(repoRoot = REPO_ROOT) {
  let output;
  try {
    output = execFileSync('git', ['-C', repoRoot, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_) {
    fail('WORKTREE_DISCOVERY_FAILED', 'Git worktrees could not be enumerated; refusing private output.');
  }
  const roots = output.split(/\r?\n/)
    .filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length).trim())
    .filter(Boolean);
  if (!roots.length) fail('WORKTREE_DISCOVERY_FAILED', 'Git returned no worktrees; refusing private output.');
  return roots;
}

function containingGitWorktree(value) {
  let cursor = path.resolve(value);
  let stat = lstatOrNull(cursor);
  while (!stat) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
    stat = lstatOrNull(cursor);
  }
  if (stat && !stat.isDirectory()) cursor = path.dirname(cursor);
  try {
    return clean(execFileSync('git', ['-C', cursor, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    })) || null;
  } catch (_) {
    return null;
  }
}

function assertPrivateEmptyOutput(outputDir, worktreeRoots) {
  if (!outputDir || !path.isAbsolute(outputDir)) {
    fail('ABSOLUTE_OUTPUT_REQUIRED', 'Output must be an explicit absolute private directory.');
  }
  const resolved = path.resolve(outputDir);
  assertNoSymlinkComponents(resolved);
  for (const root of worktreeRoots) {
    if (isWithin(root, resolved)) {
      fail('WORKTREE_PATH_REJECTED', 'The private output directory must be outside every registered Git worktree.');
    }
  }
  const containing = containingGitWorktree(resolved);
  if (containing && isWithin(containing, resolved)) {
    fail('WORKTREE_PATH_REJECTED', 'The private output directory must be outside every Git worktree.');
  }
  const stat = lstatOrNull(resolved);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
    fail('OUTPUT_DIRECTORY_REQUIRED', 'Output must already exist as a regular private directory.');
  }
  let entries;
  try {
    entries = fs.readdirSync(resolved);
  } catch (_) {
    fail('OUTPUT_INSPECTION_FAILED', 'The private output directory could not be enumerated safely.');
  }
  if (entries.length) fail('DIRTY_OUTPUT_REJECTED', 'The private output directory must be empty.');
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    fail('PRIVATE_PERMISSIONS_REQUIRED', 'The private output directory must not grant group or other access.');
  }
  return resolved;
}

function parseDatabaseUrl(input, projectRef, databaseName) {
  if (!PROJECT_REF_RE.test(projectRef)) {
    fail('PROJECT_CONFIRMATION_INVALID', 'Project confirmation must be one exact 20-character lowercase project ref.');
  }
  if (!SAFE_DATABASE_RE.test(databaseName)) {
    fail('DATABASE_CONFIRMATION_INVALID', 'Database confirmation is missing or malformed.');
  }
  let parsed;
  try {
    parsed = new URL(input);
  } catch (_) {
    fail('DATABASE_URL_INVALID', 'F27_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    fail('DATABASE_URL_INVALID', 'F27_DATABASE_URL must use the PostgreSQL protocol.');
  }
  const urlDatabase = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (urlDatabase !== databaseName) {
    fail('DATABASE_CONFIRMATION_MISMATCH', 'The confirmed database does not match the database URL.');
  }
  const username = decodeURIComponent(parsed.username);
  const hostname = parsed.hostname.toLowerCase();
  const port = parsed.port || '5432';
  const directConnection = hostname === `db.${projectRef}.supabase.co`
    && username === 'postgres' && port === '5432';
  const pooledConnection = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(hostname)
    && username === `postgres.${projectRef}` && ['5432', '6543'].includes(port);
  if (!directConnection && !pooledConnection) {
    fail('PROJECT_CONFIRMATION_MISMATCH', 'The confirmed project ref is not exactly bound by the database URL.');
  }
  if (!parsed.hostname || !username) fail('DATABASE_URL_INVALID', 'The database URL is incomplete.');
  const allowedParameters = new Set(['sslmode']);
  for (const key of parsed.searchParams.keys()) {
    if (!allowedParameters.has(key)) {
      fail('DATABASE_URL_INVALID', 'The database URL contains an unsupported connection option.');
    }
  }
  const sslmode = parsed.searchParams.get('sslmode') || 'require';
  if (!['require', 'verify-full'].includes(sslmode)) {
    fail('DATABASE_URL_INVALID', 'The live database URL must require TLS.');
  }
  return {
    PGHOST: parsed.hostname,
    PGPORT: port,
    PGDATABASE: urlDatabase,
    PGUSER: username,
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGSSLMODE: sslmode,
    PGCLIENTENCODING: 'UTF8',
    PGCONNECT_TIMEOUT: '15',
    PGAPPNAME: 'f27-mirror-outbox-snapshot',
    PGOPTIONS: '',
  };
}

function parseDisposableDatabaseUrl(input, databaseName) {
  if (!SAFE_DATABASE_RE.test(databaseName) || !/^f27[_$-]/.test(databaseName)) {
    fail('DISPOSABLE_DATABASE_CONFIRMATION_INVALID', 'Disposable database confirmation must be an explicit f27-prefixed database.');
  }
  let parsed;
  try { parsed = new URL(input); } catch (_) { fail('DATABASE_URL_INVALID', 'F27_DISPOSABLE_DATABASE_URL must be a valid PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
      || !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname.toLowerCase())) {
    fail('DISPOSABLE_DATABASE_REJECTED', 'Post-contract fingerprinting is restricted to an explicit loopback disposable database.');
  }
  const urlDatabase = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (urlDatabase !== databaseName || !parsed.username) {
    fail('DATABASE_CONFIRMATION_MISMATCH', 'The disposable database URL did not match the explicit confirmation.');
  }
  return {
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGDATABASE: urlDatabase,
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGSSLMODE: parsed.searchParams.get('sslmode') || 'disable',
    PGCLIENTENCODING: 'UTF8',
    PGCONNECT_TIMEOUT: '15',
    PGAPPNAME: 'f27-mirror-outbox-post-contract',
    PGOPTIONS: '',
  };
}

function assertRelease(options) {
  const requested = clean(options.releaseSha);
  if (!SHA_RE.test(requested)) fail('RELEASE_SHA_INVALID', 'Release SHA must be exactly 40 lowercase hexadecimal characters.');
  if (options.releaseInfo) {
    if (options.releaseInfo.headSha !== requested) fail('RELEASE_SHA_MISMATCH', 'Release SHA does not match the checked-out HEAD.');
    if (options.releaseInfo.originMainSha != null && options.releaseInfo.originMainSha !== requested) {
      fail('RELEASE_SHA_MISMATCH', 'Release SHA does not match the independently fetched origin/main.');
    }
    if (options.releaseInfo.dirty) fail('DIRTY_SOURCE_REJECTED', 'The source worktree must be clean.');
    if (!HASH_RE.test(options.releaseInfo.migrationSha256)) fail('MIGRATION_HASH_INVALID', 'Migration SHA-256 could not be proven.');
    return options.releaseInfo;
  }
  const repoRoot = options.repoRoot || REPO_ROOT;
  let headSha;
  let originMainSha;
  let status;
  try {
    headSha = clean(execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    }));
    originMainSha = clean(execFileSync('git', ['-C', repoRoot, 'rev-parse', 'origin/main'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    }));
    status = execFileSync('git', ['-C', repoRoot, 'status', '--porcelain=v1', '--untracked-files=all'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_) {
    fail('RELEASE_PROOF_FAILED', 'The checked-out release could not be proven.');
  }
  if (headSha !== requested || originMainSha !== requested) {
    fail('RELEASE_SHA_MISMATCH', 'Release SHA must match both checked-out HEAD and independently fetched origin/main.');
  }
  if (clean(status)) fail('DIRTY_SOURCE_REJECTED', 'The source worktree must be clean.');
  let migrationBytes;
  try {
    migrationBytes = fs.readFileSync(path.join(repoRoot, MIGRATION_RELATIVE_PATH));
  } catch (_) {
    fail('MIGRATION_READ_FAILED', 'The exact F27 migration bytes could not be read.');
  }
  return { headSha, originMainSha, dirty: false, migrationSha256: sha256(migrationBytes) };
}

function sqlText() {
  const f27TableNames = quotedSqlStrings(F27_TABLE_NAMES);
  const f27ColumnNames = quotedSqlStrings(F27_OUTBOX_COLUMN_NAMES);
  const f27ConstraintNames = quotedSqlStrings(F27_CONSTRAINT_NAMES);
  const f27FunctionNames = quotedSqlStrings(F27_FUNCTION_NAMES);
  const reviewedWriteAuthorizationBody = reviewedWriteAuthorizationSource().replace(/'/g, "''");
  const reviewedProductionAuthorityBody = reviewedProductionAuthoritySource().replace(/'/g, "''");
  const reviewedSubsetContractSha256 = reviewedPreF27SubsetContractSha256();
  const reviewedPostSection7ContractHash = reviewedPostSection7ContractSha256();
  const fenceTableSqlGate = reviewedFenceTableSqlGate();
  const postSection7SqlGate = reviewedPostSection7SqlGate();
  const boundaryFunctionSqlGate = reviewedBoundaryFunctionSqlGate();
  const unexpectedObjectSqlGate = reviewedUnexpectedObjectSqlGate();
  const allowedBoundaryFunctionPredicate = REQUIRED_BOUNDARY_FUNCTION_IDENTITIES
    .map(identity => `p.oid IS DISTINCT FROM to_regprocedure('${identity.replace(/'/g, "''")}')::oid`)
    .join('\n      AND ');
  return String.raw`\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;

DO $f27$
DECLARE
  v_pk text[];
  v_entry_state text := '${PRISTINE_PRE_F27_ENTRY_STATE}';
  v_hold_guard_acl_variant text;
  v_retained_exact boolean := false;
  v_baseline jsonb;
  v_rollbacks_oid oid;
  v_intents_oid oid;
  v_mirror_enqueue_oid oid;
  v_write_authorization_oid oid;
  v_production_authority_oid oid;
  v_fence_oid oid;
  v_fence_rowtype oid;
  v_object_pattern constant text :=
    'f27|track_b_team_rollback|production_assert_authority|authority_generation';
  v_function_body_pattern constant text :=
    'track_b_f27_|track_b_team_rollback|authority_generation|f27_drill_rollback_id|_f27_';
BEGIN
  IF to_regclass('public.mirror_outbox') IS NULL THEN
    RAISE EXCEPTION 'F27_SNAPSHOT_MISSING_MIRROR_OUTBOX';
  END IF;
  IF to_regclass('public.syncview_runtime_flags') IS NULL
     OR to_regclass('public.flag_flips') IS NULL THEN
    RAISE EXCEPTION 'F27_SNAPSHOT_MISSING_RUNTIME_SAFETY_TABLE';
  END IF;
  v_rollbacks_oid := to_regclass('public.track_b_team_rollbacks');
  v_intents_oid := to_regclass('public.track_b_team_rollback_intents');
  v_mirror_enqueue_oid := to_regprocedure('${PRE_F27_MIRROR_ENQUEUE_IDENTITY}');
  v_write_authorization_oid := to_regprocedure('${PRE_F27_WRITE_AUTHORIZATION_IDENTITY}');
  v_production_authority_oid := to_regprocedure('${PRE_F27_PRODUCTION_AUTHORITY_IDENTITY}');
  SELECT c.oid,c.reltype INTO v_fence_oid,v_fence_rowtype
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='${PRE_F27_FENCE_TABLE_NAME}' AND c.relkind='r';
  IF v_rollbacks_oid IS NOT NULL AND v_intents_oid IS NOT NULL THEN
    v_entry_state := 'retained_post_rollback';
    BEGIN
${fenceTableSqlGate}
${postSection7SqlGate}
${boundaryFunctionSqlGate}
${unexpectedObjectSqlGate}
      v_retained_exact := true;
    EXCEPTION WHEN OTHERS THEN
      v_retained_exact := false;
    END;
  ELSIF (v_rollbacks_oid IS NULL) IS DISTINCT FROM (v_intents_oid IS NULL) THEN
    v_retained_exact := false;
  END IF;
  IF (to_regprocedure('public.mirror_outbox_enqueue(text,text,text,jsonb,text,timestamp with time zone,text,text,text,text,text,text,text,bigint,boolean)') IS NULL
     OR to_regprocedure('${PRE_F27_WRITE_AUTHORIZATION_IDENTITY}') IS NULL
     OR to_regprocedure('${PRE_F27_PRODUCTION_AUTHORITY_IDENTITY}') IS NULL
     OR to_regclass('${PRE_F27_FENCE_TABLE_IDENTITY}') IS NULL
     OR EXISTS (
       SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname NOT IN ('pg_catalog','information_schema')
         AND n.nspname !~ '^pg_toast'
          AND c.relkind IN ('r','p','v','m','f','S','i')
          AND (
            c.relname IN (${f27TableNames})
            OR c.relname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
          )
         AND NOT (
           n.nspname='public'
           AND (
             c.relname='${PRE_F27_FENCE_TABLE_NAME}' AND c.relkind='r'
             OR c.relname='track_b_f27_team_fences_pkey' AND c.relkind='i'
           )
         )
     )
     OR EXISTS (
       SELECT 1 FROM pg_namespace n
        WHERE n.nspname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_type t
       JOIN pg_namespace n ON n.oid=t.typnamespace
       WHERE n.nspname NOT IN ('pg_catalog','information_schema')
         AND n.nspname !~ '^pg_toast'
          AND (
            t.typname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
         )
         AND NOT (
           n.nspname='public'
           AND (
             t.typname='${PRE_F27_FENCE_TABLE_NAME}'
             AND t.typtype='c'
             AND t.typrelid='${PRE_F27_FENCE_TABLE_IDENTITY}'::regclass
             AND t.typelem=0
             AND t.typbasetype=0
             AND NOT t.typnotnull
             AND t.typdefault IS NULL
             AND t.typcollation=0
             AND pg_get_userbyid(t.typowner)='postgres'
             AND t.typacl IS NULL
             AND t.typarray=(
               SELECT allowed_array.oid
               FROM pg_type allowed_array
               JOIN pg_namespace allowed_array_n ON allowed_array_n.oid=allowed_array.typnamespace
               WHERE allowed_array_n.nspname='public'
                 AND allowed_array.typname='_${PRE_F27_FENCE_TABLE_NAME}'
             )
           OR t.typname='_${PRE_F27_FENCE_TABLE_NAME}'
             AND t.typtype='b'
             AND t.typrelid=0
             AND t.typelem=(
               SELECT allowed.oid
               FROM pg_type allowed
               JOIN pg_namespace allowed_n ON allowed_n.oid=allowed.typnamespace
               WHERE allowed_n.nspname='public'
                 AND allowed.typname='${PRE_F27_FENCE_TABLE_NAME}'
             )
             AND t.typarray=0
             AND t.typbasetype=0
             AND NOT t.typnotnull
             AND t.typdefault IS NULL
             AND t.typcollation=0
             AND pg_get_userbyid(t.typowner)='postgres'
             AND t.typacl IS NULL
           )
         )
     )
     OR EXISTS (
       SELECT 1 FROM pg_attribute a
       WHERE a.attrelid='public.mirror_outbox'::regclass AND a.attnum>0 AND NOT a.attisdropped
         AND (
           a.attname IN (${f27ColumnNames})
           OR a.attname
             ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
         )
     )
     OR EXISTS (
       SELECT 1 FROM pg_constraint c
       WHERE c.conrelid='public.mirror_outbox'::regclass
         AND (c.conname IN (${f27ConstraintNames}) OR c.conname ~* 'f27')
     )
     OR EXISTS (
       SELECT 1
       FROM pg_index i
       JOIN pg_class c ON c.oid=i.indexrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE i.indrelid='public.mirror_outbox'::regclass
         AND n.nspname='public'
         AND (c.relname='${F27_OUTBOX_INDEX_NAME}' OR c.relname ~* 'f27')
     )
     OR EXISTS (
       SELECT 1 FROM pg_trigger t
       WHERE t.tgrelid='public.mirror_outbox'::regclass AND NOT t.tgisinternal
         AND (t.tgname='${F27_OUTBOX_TRIGGER_NAME}' OR t.tgname ~* 'f27')
     )
     OR EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname NOT IN ('pg_catalog','information_schema')
         AND n.nspname !~ '^pg_toast'
          AND (
            p.proname IN (${f27FunctionNames})
            OR p.proname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
            OR CASE
              WHEN p.prokind IN ('f','p') THEN
                pg_get_functiondef(p.oid)
                  ~* 'track_b_f27_|track_b_team_rollback|authority_generation|f27_drill_rollback_id|_f27_'
              ELSE false
            END
          )
          AND ${allowedBoundaryFunctionPredicate}
      )
      OR EXISTS (
        SELECT 1
        FROM pg_constraint c
        LEFT JOIN pg_namespace n ON n.oid=c.connamespace
        WHERE (
            COALESCE(n.nspname,'')
              ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
            OR c.conname
              ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
            OR pg_get_constraintdef(c.oid,true)
              ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
          )
          AND NOT (
            c.conrelid='${PRE_F27_FENCE_TABLE_IDENTITY}'::regclass
            AND c.conname IN (
              'track_b_f27_team_fences_pkey',
              'track_b_f27_team_fences_team_check',
              'track_b_f27_team_fences_generation_check'
            )
          )
      )
      OR EXISTS (
        SELECT 1
        FROM pg_index i
        JOIN pg_class ci ON ci.oid=i.indexrelid
        JOIN pg_namespace n ON n.oid=ci.relnamespace
        WHERE (
            n.nspname
              ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
            OR ci.relname
              ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
            OR pg_get_indexdef(i.indexrelid)
              ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
          )
          AND i.indexrelid IS DISTINCT FROM
            'public.track_b_f27_team_fences_pkey'::regclass
      )
      OR EXISTS (
        SELECT 1
        FROM pg_trigger t
        JOIN pg_class c ON c.oid=t.tgrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE NOT t.tgisinternal
          AND (
            n.nspname
              ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
            OR t.tgname
              ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
            OR pg_get_triggerdef(t.oid,true)
              ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
          )
      )
      OR EXISTS (
        SELECT 1
        FROM pg_rewrite r
        JOIN pg_class c ON c.oid=r.ev_class
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname
                ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
           OR r.rulename
                ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
           OR pg_get_ruledef(r.oid,true)
                ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
      )
      OR EXISTS (
        SELECT 1
        FROM pg_policy p
        JOIN pg_class c ON c.oid=p.polrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname
                ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
           OR p.polname
                ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
           OR COALESCE(pg_get_expr(p.polqual,p.polrelid,true),'')
                ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
           OR COALESCE(pg_get_expr(p.polwithcheck,p.polrelid,true),'')
                ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
      )
      OR EXISTS (
        SELECT 1
        FROM pg_inherits i
        JOIN pg_class child ON child.oid=i.inhrelid
        JOIN pg_namespace child_n ON child_n.oid=child.relnamespace
        JOIN pg_class parent ON parent.oid=i.inhparent
        JOIN pg_namespace parent_n ON parent_n.oid=parent.relnamespace
        WHERE i.inhrelid='${PRE_F27_FENCE_TABLE_IDENTITY}'::regclass
           OR i.inhparent='${PRE_F27_FENCE_TABLE_IDENTITY}'::regclass
           OR child_n.nspname
                ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
           OR child.relname
                ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
           OR parent_n.nspname
                ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
           OR parent.relname
                ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
      )
      OR EXISTS (
        SELECT 1
        FROM pg_collation c
        JOIN pg_namespace n ON n.oid=c.collnamespace
        WHERE n.nspname
                ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
           OR c.collname
                ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
      )
      OR EXISTS (
        SELECT 1
        FROM pg_opclass o
        JOIN pg_namespace n ON n.oid=o.opcnamespace
        WHERE n.nspname
                ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
           OR o.opcname
                ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
           OR o.opcintype IN (
             (
               SELECT reltype
               FROM pg_class
               WHERE oid='${PRE_F27_FENCE_TABLE_IDENTITY}'::regclass
             ),
             (
               SELECT typarray
               FROM pg_type
               WHERE oid=(
                 SELECT reltype
                 FROM pg_class
                 WHERE oid='${PRE_F27_FENCE_TABLE_IDENTITY}'::regclass
               )
             )
           )
      )
      OR EXISTS (
        SELECT 1
        FROM pg_opfamily o
        JOIN pg_namespace n ON n.oid=o.opfnamespace
        WHERE n.nspname
                ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
           OR o.opfname
                ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
      )
      OR EXISTS (
       SELECT 1
       FROM pg_class c
       JOIN pg_namespace n ON n.oid=c.relnamespace
       JOIN pg_am table_am ON table_am.oid=c.relam
       WHERE c.oid='${PRE_F27_FENCE_TABLE_IDENTITY}'::regclass
          AND (
            n.nspname IS DISTINCT FROM 'public'
            OR c.relname IS DISTINCT FROM '${PRE_F27_FENCE_TABLE_NAME}'
            OR c.relkind IS DISTINCT FROM 'r'
            OR c.relpersistence IS DISTINCT FROM 'p'
            OR table_am.amname IS DISTINCT FROM 'heap'
            OR pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres'
            OR c.relrowsecurity IS DISTINCT FROM false
            OR c.relforcerowsecurity IS DISTINCT FROM false
            OR c.relreplident IS DISTINCT FROM 'd'
            OR c.relispartition
            OR c.relpartbound IS NOT NULL
            OR c.relhasrules
            OR c.relhastriggers
            OR c.relhassubclass
            OR c.relchecks IS DISTINCT FROM 2
            OR c.relnatts IS DISTINCT FROM 4
            OR c.reltablespace IS DISTINCT FROM 0::oid
            OR c.reloptions IS NOT NULL
            OR (
              SELECT count(*)
              FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) granted
              WHERE granted.grantee IS DISTINCT FROM c.relowner
            ) IS DISTINCT FROM 1
            OR EXISTS (
              SELECT 1
              FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) granted
              WHERE granted.grantee IS DISTINCT FROM c.relowner
                AND (
                  granted.grantee IS DISTINCT FROM (
                    SELECT oid FROM pg_roles WHERE rolname='service_role'
                  )
                  OR granted.grantor IS DISTINCT FROM c.relowner
                  OR granted.privilege_type IS DISTINCT FROM 'SELECT'
                  OR granted.is_grantable
                )
            )
            OR (
              SELECT count(*)
              FROM pg_roles
              WHERE rolname IN ('anon','authenticated','service_role')
            ) IS DISTINCT FROM 3
            OR EXISTS (
              SELECT 1
              FROM pg_roles checked_role
              CROSS JOIN LATERAL (
                SELECT DISTINCT granted.privilege_type
                FROM aclexplode(acldefault('r',c.relowner)) granted
                WHERE granted.grantee=c.relowner
              ) supported_privilege
              WHERE checked_role.rolname IN ('anon','authenticated','service_role')
                AND has_table_privilege(
                  checked_role.oid,
                  c.oid,
                  supported_privilege.privilege_type
                )
                AND (
                  checked_role.rolname IN ('anon','authenticated')
                  OR supported_privilege.privilege_type IS DISTINCT FROM 'SELECT'
                )
            )
            OR NOT has_table_privilege(
              (SELECT oid FROM pg_roles WHERE rolname='service_role'),
              c.oid,
              'SELECT'
            )
            OR has_table_privilege(
              (SELECT oid FROM pg_roles WHERE rolname='service_role'),
              c.oid,
              'SELECT WITH GRANT OPTION'
            )
         )
     )
     OR EXISTS (
       SELECT 1 FROM pg_attribute a
       LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
       WHERE a.attrelid='${PRE_F27_FENCE_TABLE_IDENTITY}'::regclass
         AND a.attnum>0
         AND (
            a.attisdropped
            OR a.attidentity IS DISTINCT FROM ''
            OR a.attgenerated IS DISTINCT FROM ''
            OR a.attacl IS NOT NULL
            OR a.attinhcount IS DISTINCT FROM 0
            OR a.attislocal IS DISTINCT FROM true
            OR a.atthasmissing IS DISTINCT FROM false
            OR NOT (
              a.attname='team'
                AND a.attnum=1
                AND a.atttypid='text'::regtype AND a.atttypmod=-1
                AND a.attcollation='pg_catalog.default'::regcollation
                AND a.attnotnull AND NOT a.atthasdef AND d.oid IS NULL
                AND a.attstorage='x'
              OR a.attname='generation'
                AND a.attnum=2
                AND a.atttypid='bigint'::regtype AND a.atttypmod=-1
                AND a.attcollation=0
                AND a.attnotnull AND a.atthasdef
                AND a.attstorage='p'
                AND replace(
                 regexp_replace(lower(COALESCE(pg_get_expr(d.adbin,d.adrelid,true),'')), '[[:space:]()]', '', 'g'),
                 '::bigint',''
               )='0'
             OR a.attname='updated_at'
                AND a.attnum=3
                AND a.atttypid='timestamp with time zone'::regtype AND a.atttypmod=-1
                AND a.attcollation=0
                AND a.attnotnull AND a.atthasdef
                AND a.attstorage='p'
                AND regexp_replace(
                 lower(COALESCE(pg_get_expr(d.adbin,d.adrelid,true),'')),
                 '[[:space:]()]','','g'
               )='now'
             OR a.attname='updated_by'
                AND a.attnum=4
                AND a.atttypid='text'::regtype AND a.atttypmod=-1
                AND a.attcollation='pg_catalog.default'::regcollation
                AND a.attnotnull AND NOT a.atthasdef AND d.oid IS NULL
                AND a.attstorage='x'
           )
         )
     )
     OR (
       SELECT count(*) FROM pg_attribute
       WHERE attrelid='${PRE_F27_FENCE_TABLE_IDENTITY}'::regclass
         AND attnum>0 AND NOT attisdropped
     ) <> 4
     OR (
       SELECT count(*) FROM pg_constraint
       WHERE conrelid='${PRE_F27_FENCE_TABLE_IDENTITY}'::regclass
     ) <> 3
     OR EXISTS (
       SELECT 1 FROM pg_constraint c
       WHERE c.conrelid='${PRE_F27_FENCE_TABLE_IDENTITY}'::regclass
          AND (
            c.connamespace IS DISTINCT FROM 'public'::regnamespace
            OR NOT c.convalidated
            OR c.condeferrable
            OR c.condeferred
            OR NOT c.conislocal
            OR c.coninhcount <> 0
            OR c.conparentid <> 0
            OR NOT (
              c.conname='track_b_f27_team_fences_pkey'
                AND c.contype='p'
                AND c.connoinherit
                AND c.conkey IS NOT DISTINCT FROM ARRAY[(
                 SELECT attnum FROM pg_attribute
                 WHERE attrelid='${PRE_F27_FENCE_TABLE_IDENTITY}'::regclass
                   AND attname='team' AND NOT attisdropped
               )]::smallint[]
              OR c.conname='track_b_f27_team_fences_team_check'
                AND c.contype='c'
                AND NOT c.connoinherit
                AND regexp_replace(
                 lower(pg_get_expr(c.conbin,c.conrelid,true)),
                 '[[:space:]()]','','g'
               )='team=anyarray[''video''::text,''graphics''::text]'
              OR c.conname='track_b_f27_team_fences_generation_check'
                AND c.contype='c'
                AND NOT c.connoinherit
                AND regexp_replace(
                 lower(pg_get_expr(c.conbin,c.conrelid,true)),
                 '[[:space:]()]','','g'
               )='generation>=0'
           )
         )
     )
     OR (
       SELECT count(*) FROM pg_index
       WHERE indrelid='${PRE_F27_FENCE_TABLE_IDENTITY}'::regclass
     ) <> 1
     OR EXISTS (
       SELECT 1
       FROM pg_index i
       JOIN pg_class ci ON ci.oid=i.indexrelid
       JOIN pg_namespace ni ON ni.oid=ci.relnamespace
       JOIN pg_am am ON am.oid=ci.relam
       WHERE i.indrelid='${PRE_F27_FENCE_TABLE_IDENTITY}'::regclass
          AND (
            ni.nspname IS DISTINCT FROM 'public'
            OR ci.relname IS DISTINCT FROM 'track_b_f27_team_fences_pkey'
            OR ci.relkind IS DISTINCT FROM 'i'
            OR ci.relpersistence IS DISTINCT FROM 'p'
            OR pg_get_userbyid(ci.relowner) IS DISTINCT FROM 'postgres'
            OR ci.reltablespace IS DISTINCT FROM 0::oid
            OR ci.reloptions IS NOT NULL
            OR ci.relacl IS NOT NULL
            OR am.amname IS DISTINCT FROM 'btree'
            OR NOT i.indisunique OR i.indnullsnotdistinct OR NOT i.indisprimary
           OR i.indisexclusion OR NOT i.indimmediate
           OR i.indisclustered OR NOT i.indisvalid OR NOT i.indisready
            OR NOT i.indislive OR i.indisreplident
            OR i.indcheckxmin
           OR i.indnkeyatts <> 1 OR i.indnatts <> 1
           OR i.indpred IS NOT NULL OR i.indexprs IS NOT NULL
           OR i.indcollation::text IS DISTINCT FROM (
             SELECT a.attcollation::text
             FROM pg_attribute a
             WHERE a.attrelid='${PRE_F27_FENCE_TABLE_IDENTITY}'::regclass
               AND a.attname='team' AND NOT a.attisdropped
           )
           OR i.indclass::text IS DISTINCT FROM (
             SELECT opc.oid::text
             FROM pg_opclass opc
             JOIN pg_am expected_am ON expected_am.oid=opc.opcmethod
             JOIN pg_namespace opc_n ON opc_n.oid=opc.opcnamespace
             WHERE expected_am.amname='btree'
               AND opc_n.nspname='pg_catalog'
               AND opc.opcname='text_ops'
           )
           OR i.indoption::text IS DISTINCT FROM '0'
           OR i.indkey::text IS DISTINCT FROM (
             SELECT attnum::text FROM pg_attribute
             WHERE attrelid='${PRE_F27_FENCE_TABLE_IDENTITY}'::regclass
               AND attname='team' AND NOT attisdropped
           )
         )
     )
     OR EXISTS (
       SELECT 1 FROM pg_inherits
       WHERE inhrelid='${PRE_F27_FENCE_TABLE_IDENTITY}'::regclass
          OR inhparent='${PRE_F27_FENCE_TABLE_IDENTITY}'::regclass
     )
     OR EXISTS (
       SELECT 1 FROM pg_rewrite
       WHERE ev_class='${PRE_F27_FENCE_TABLE_IDENTITY}'::regclass
     )
     OR EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgrelid='${PRE_F27_FENCE_TABLE_IDENTITY}'::regclass AND NOT tgisinternal
     )
     OR EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname='public' AND tablename='${PRE_F27_FENCE_TABLE_NAME}'
     )
     OR (
       SELECT count(*) FROM public.track_b_f27_team_fences
     ) <> 2
     OR EXISTS (
       SELECT 1 FROM public.track_b_f27_team_fences
       WHERE team NOT IN ('video','graphics')
          OR generation IS DISTINCT FROM 0
          OR updated_by IS DISTINCT FROM 'f27-migration'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.track_b_f27_team_fences WHERE team='video'
     )
      OR NOT EXISTS (
        SELECT 1 FROM public.track_b_f27_team_fences WHERE team='graphics'
      )
      OR EXISTS (
        SELECT 1
        FROM pg_proc p
        WHERE p.oid=to_regprocedure('${PRE_F27_MIRROR_ENQUEUE_IDENTITY}')
          AND (
            pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
            OR EXISTS (
              (SELECT a.grantor,a.grantee,a.privilege_type,a.is_grantable
               FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
               WHERE a.grantee=p.proowner)
              EXCEPT
              (SELECT d.grantor,d.grantee,d.privilege_type,d.is_grantable
               FROM aclexplode(acldefault('f',p.proowner)) d
               WHERE d.grantee=p.proowner)
            )
            OR EXISTS (
              (SELECT d.grantor,d.grantee,d.privilege_type,d.is_grantable
               FROM aclexplode(acldefault('f',p.proowner)) d
               WHERE d.grantee=p.proowner)
              EXCEPT
              (SELECT a.grantor,a.grantee,a.privilege_type,a.is_grantable
               FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
               WHERE a.grantee=p.proowner)
            )
            OR (SELECT count(*)
                FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
                WHERE a.grantee IS DISTINCT FROM p.proowner) IS DISTINCT FROM 1
            OR EXISTS (
              SELECT 1
              FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
              WHERE a.grantee IS DISTINCT FROM p.proowner
                AND (
                  a.grantee IS DISTINCT FROM (
                    SELECT oid FROM pg_roles WHERE rolname='service_role'
                  )
                  OR a.grantor IS DISTINCT FROM p.proowner
                  OR a.privilege_type IS DISTINCT FROM 'EXECUTE'
                  OR a.is_grantable
                )
            )
          )
      )
      OR EXISTS (
        SELECT 1
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid=p.pronamespace
       JOIN pg_language l ON l.oid=p.prolang
       WHERE p.oid=to_regprocedure('${PRE_F27_WRITE_AUTHORIZATION_IDENTITY}')
         AND (
           n.nspname IS DISTINCT FROM 'public'
           OR p.proname IS DISTINCT FROM 'track_b_f27_write_authorization'
           OR p.prokind IS DISTINCT FROM 'f'
           OR p.prorettype IS DISTINCT FROM 'jsonb'::regtype
           OR p.proretset
            OR p.pronargs IS DISTINCT FROM 1
            OR p.pronargdefaults IS DISTINCT FROM 0
            OR p.proargnames IS DISTINCT FROM ARRAY['p_team']::text[]
            OR p.proallargtypes IS NOT NULL
            OR p.proargmodes IS NOT NULL
            OR p.protrftypes IS NOT NULL
            OR p.provariadic <> 0
            OR p.prosupport <> 0
           OR l.lanname IS DISTINCT FROM 'plpgsql'
           OR NOT p.prosecdef
           OR p.proleakproof
           OR p.provolatile IS DISTINCT FROM 's'
           OR p.proparallel IS DISTINCT FROM 'u'
           OR p.proisstrict
           OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
           OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
            OR replace(replace(p.prosrc,E'\r\n',E'\n'),E'\r',E'\n')
              IS DISTINCT FROM replace(
                replace('${reviewedWriteAuthorizationBody}',E'\r\n',E'\n'),
                E'\r',
                E'\n'
              )
            OR EXISTS (
              (SELECT a.grantor,a.grantee,a.privilege_type,a.is_grantable
               FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
               WHERE a.grantee=p.proowner)
              EXCEPT
              (SELECT d.grantor,d.grantee,d.privilege_type,d.is_grantable
               FROM aclexplode(acldefault('f',p.proowner)) d
               WHERE d.grantee=p.proowner)
            )
            OR EXISTS (
              (SELECT d.grantor,d.grantee,d.privilege_type,d.is_grantable
               FROM aclexplode(acldefault('f',p.proowner)) d
               WHERE d.grantee=p.proowner)
              EXCEPT
              (SELECT a.grantor,a.grantee,a.privilege_type,a.is_grantable
               FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
               WHERE a.grantee=p.proowner)
            )
            OR (SELECT count(*)
                FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
                WHERE a.grantee IS DISTINCT FROM p.proowner) IS DISTINCT FROM 1
            OR EXISTS (
              SELECT 1
              FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
              WHERE a.grantee IS DISTINCT FROM p.proowner
                AND (
                  a.grantee IS DISTINCT FROM (
                    SELECT oid FROM pg_roles WHERE rolname='service_role'
                  )
                  OR a.grantor IS DISTINCT FROM p.proowner
                  OR a.privilege_type IS DISTINCT FROM 'EXECUTE'
                  OR a.is_grantable
                )
            )
          )
      )
      OR EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid=p.pronamespace
        JOIN pg_language l ON l.oid=p.prolang
        WHERE p.oid=to_regprocedure('${PRE_F27_PRODUCTION_AUTHORITY_IDENTITY}')
          AND (
            n.nspname IS DISTINCT FROM 'public'
            OR p.proname IS DISTINCT FROM 'production_assert_authority'
            OR p.prokind IS DISTINCT FROM 'f'
            OR p.prorettype IS DISTINCT FROM 'void'::regtype
            OR p.proretset
            OR p.pronargs IS DISTINCT FROM 4
            OR p.pronargdefaults IS DISTINCT FROM 0
            OR p.proargnames IS DISTINCT FROM ARRAY[
              'p_client_slug','p_team','p_test_only','p_legacy_parity'
            ]::text[]
            OR p.proallargtypes IS NOT NULL
            OR p.proargmodes IS NOT NULL
            OR p.protrftypes IS NOT NULL
            OR p.provariadic <> 0
            OR p.prosupport <> 0
            OR l.lanname IS DISTINCT FROM 'plpgsql'
            OR NOT p.prosecdef
            OR p.proleakproof
            OR p.provolatile IS DISTINCT FROM 'v'
            OR p.proparallel IS DISTINCT FROM 'u'
            OR p.proisstrict
            OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
            OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
            OR replace(replace(p.prosrc,E'\r\n',E'\n'),E'\r',E'\n')
              IS DISTINCT FROM replace(
                replace('${reviewedProductionAuthorityBody}',E'\r\n',E'\n'),
                E'\r',
                E'\n'
              )
            OR EXISTS (
              (SELECT a.grantor,a.grantee,a.privilege_type,a.is_grantable
               FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
               WHERE a.grantee=p.proowner)
              EXCEPT
              (SELECT d.grantor,d.grantee,d.privilege_type,d.is_grantable
               FROM aclexplode(acldefault('f',p.proowner)) d
               WHERE d.grantee=p.proowner)
            )
            OR EXISTS (
              (SELECT d.grantor,d.grantee,d.privilege_type,d.is_grantable
               FROM aclexplode(acldefault('f',p.proowner)) d
               WHERE d.grantee=p.proowner)
              EXCEPT
              (SELECT a.grantor,a.grantee,a.privilege_type,a.is_grantable
               FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
               WHERE a.grantee=p.proowner)
            )
            OR (SELECT count(*)
                FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
                WHERE a.grantee IS DISTINCT FROM p.proowner) IS DISTINCT FROM 1
            OR EXISTS (
              SELECT 1
              FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
              WHERE a.grantee IS DISTINCT FROM p.proowner
                AND (
                  a.grantee IS DISTINCT FROM (
                    SELECT oid FROM pg_roles WHERE rolname='service_role'
                  )
                  OR a.grantor IS DISTINCT FROM p.proowner
                  OR a.privilege_type IS DISTINCT FROM 'EXECUTE'
                  OR a.is_grantable
                )
            )
          )
      )) AND NOT v_retained_exact THEN
    RAISE EXCEPTION 'F27_SNAPSHOT_PRE_F27_BASELINE_REQUIRED';
  END IF;
  SELECT array_agg(a.attname ORDER BY k.ordinality)
    INTO v_pk
  FROM pg_constraint c
  CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ordinality)
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
  WHERE c.conrelid = 'public.mirror_outbox'::regclass AND c.contype = 'p';
  IF v_pk IS DISTINCT FROM ARRAY['id']::text[] THEN
    RAISE EXCEPTION 'F27_SNAPSHOT_PRIMARY_KEY_NOT_ID';
  END IF;
  IF v_retained_exact THEN
    SELECT jsonb_build_object(
      'allowed_boundary_function_count',${REQUIRED_BOUNDARY_FUNCTION_IDENTITIES.length},
      'allowed_f27_function_count',${F27_FUNCTION_NAMES.length - 2},
      'allowed_f27_table_count',${F27_TABLE_NAMES.length},
      'entry_state','${POST_SECTION7_ENTRY_STATE}',
      'f27_outbox_column_count',${F27_OUTBOX_COLUMN_NAMES.length},
      'f27_outbox_constraint_count',${F27_CONSTRAINT_NAMES.length},
      'f27_outbox_index_count',1,
      'f27_outbox_trigger_count',1,
      'f27_table_count',${F27_TABLE_NAMES.length},
      'fence_generations',COALESCE((
        SELECT jsonb_object_agg(team,generation ORDER BY team)
        FROM public.track_b_f27_team_fences
      ),'{}'::jsonb),
      'fence_row_count',(SELECT count(*) FROM public.track_b_f27_team_fences),
      'generation_chain_invariants','PASS',
      'hold_guard_acl_variant',v_hold_guard_acl_variant,
      'intent_row_count',(SELECT count(*) FROM public.track_b_team_rollback_intents),
      'open_rollback_row_count',(
        SELECT count(*) FROM public.track_b_team_rollbacks WHERE state='open'
      ),
      'retained_intents',COALESCE((
        SELECT jsonb_agg(
          to_jsonb(i) || jsonb_build_object(
            'outbox_id',i.outbox_id::text,
            'row_snapshot_canonical',i.row_snapshot::text,
            'outbox_binding',jsonb_build_object(
              'id',o.id::text,
              'status',o.status,
              'dedup_key',o.dedup_key,
              'operation',o.operation,
              'linear_result',o.linear_result,
              'f27_drill_rollback_id',o.f27_drill_rollback_id,
              'team',o.team,
              'client_slug',o.client_slug,
              'test_only',o.test_only,
              'legacy_parity',o.legacy_parity,
              'authority_generation',o.authority_generation
            )
          )
          ORDER BY i.rollback_id::text,i.outbox_id
        )
        FROM public.track_b_team_rollback_intents i
        JOIN public.mirror_outbox o ON o.id=i.outbox_id
      ),'[]'::jsonb),
      'retained_rollbacks',COALESCE((
        SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id::text)
        FROM public.track_b_team_rollbacks r
      ),'[]'::jsonb),
      'reviewed_contract','PASS',
      'reviewed_contract_sha256','${reviewedPostSection7ContractHash}',
      'rollback_row_count',(SELECT count(*) FROM public.track_b_team_rollbacks),
      'unexpected_f27_function_count',0,
      'unresolved_intent_row_count',(
        SELECT count(*) FROM public.track_b_team_rollback_intents
        WHERE classification IS NULL
           OR (classification='replay' AND terminal_receipt IS NULL)
      )
    ) INTO v_baseline;
  ELSE
    v_baseline := jsonb_build_object(
      'allowed_boundary_function_count',${REQUIRED_BOUNDARY_FUNCTION_IDENTITIES.length},
      'allowed_f27_function_count',1,
      'allowed_f27_table_count',1,
      'audit_state_sha256','${EMPTY_F27_AUDIT_STATE_SHA256}',
      'entry_state','${PRISTINE_PRE_F27_ENTRY_STATE}',
      'f27_outbox_column_count',0,
      'f27_outbox_constraint_count',0,
      'f27_outbox_index_count',0,
      'f27_outbox_trigger_count',0,
      'f27_table_count',1,
      'fence_generations','{"graphics":0,"video":0}'::jsonb,
      'fence_row_count',2,
      'generation_chain_invariants','PASS',
      'hold_guard_acl_variant',NULL,
      'intent_row_count',0,
      'open_rollback_row_count',0,
      'reviewed_contract','PASS',
      'reviewed_contract_sha256','${reviewedSubsetContractSha256}',
      'rollback_row_count',0,
      'unexpected_f27_function_count',0,
      'unresolved_intent_row_count',0
    );
  END IF;
  PERFORM set_config('syncview.f27_snapshot_baseline',v_baseline::text,true);
END
$f27$;

SELECT jsonb_build_object(
  'section','metadata','ordinal',1,'key','metadata',
  'value',jsonb_build_object(
    'current_database',current_database(),
    'current_user',current_user,
    'server_version',version(),
    'server_version_num',current_setting('server_version_num'),
    'transaction_isolation',current_setting('transaction_isolation'),
    'transaction_read_only',current_setting('transaction_read_only'),
    'snapshot_time',transaction_timestamp(),
    'table_regclass','public.mirror_outbox',
    'primary_key_columns',ARRAY['id']::text[]
  )::text
)::text;

SELECT jsonb_build_object(
  'section','runtime_safety','ordinal',1,'key','runtime_safety',
  'value',jsonb_build_object(
    'flags',COALESCE((
      SELECT jsonb_object_agg(key,value ORDER BY key)
      FROM public.syncview_runtime_flags
      WHERE key IN ('prod_authority','linear_outbound_enabled','linear_legacy_parity_enabled')
    ),'{}'::jsonb),
    'flag_flips_count',(SELECT count(*) FROM public.flag_flips)
  )::text
)::text;

SELECT jsonb_build_object(
  'section','pre_f27_baseline','ordinal',1,'key','pre_f27_baseline',
  'value',current_setting('syncview.f27_snapshot_baseline')::jsonb::text
)::text;

-- F27_WINDOW_P_PRIVATE_CAPTURE_BOUNDARY
SELECT jsonb_build_object(
  'section','table','ordinal',1,'key','public.mirror_outbox',
  'value',jsonb_build_object(
    'schema',n.nspname,'name',c.relname,'kind',c.relkind,'persistence',c.relpersistence,
    'owner',pg_get_userbyid(c.relowner),'acl',c.relacl,
    'row_security',c.relrowsecurity,'force_row_security',c.relforcerowsecurity,
    'replica_identity',c.relreplident,'tablespace',COALESCE(t.spcname,'pg_default'),
    'reloptions',c.reloptions
  )::text
)::text
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_tablespace t ON t.oid=c.reltablespace
WHERE c.oid='public.mirror_outbox'::regclass;

SELECT jsonb_build_object(
  'section','columns','ordinal',row_number() OVER (ORDER BY a.attnum),'key',a.attname,
  'value',jsonb_build_object(
    'ordinal',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),
    'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid,true),
    'identity',a.attidentity,'generated',a.attgenerated,'acl',a.attacl,
    'collation',CASE WHEN a.attcollation=0 THEN NULL ELSE quote_ident(cn.nspname)||'.'||quote_ident(co.collname) END,
    'storage',a.attstorage,'compression',a.attcompression
  )::text
)::text
FROM pg_attribute a
LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
LEFT JOIN pg_collation co ON co.oid=a.attcollation
LEFT JOIN pg_namespace cn ON cn.oid=co.collnamespace
WHERE a.attrelid='public.mirror_outbox'::regclass AND a.attnum>0 AND NOT a.attisdropped
ORDER BY a.attnum;

SELECT jsonb_build_object(
  'section','constraints','ordinal',row_number() OVER (ORDER BY c.conname,c.oid),'key',c.conname,
  'value',jsonb_build_object(
    'name',c.conname,'type',c.contype,'validated',c.convalidated,'deferrable',c.condeferrable,
    'initially_deferred',c.condeferred,'no_inherit',c.connoinherit,
    'definition',pg_get_constraintdef(c.oid,true)
  )::text
)::text
FROM pg_constraint c
WHERE c.conrelid='public.mirror_outbox'::regclass
ORDER BY c.conname,c.oid;

SELECT jsonb_build_object(
  'section','triggers','ordinal',row_number() OVER (ORDER BY t.tgname,t.oid),'key',t.tgname,
  'value',jsonb_build_object(
    'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true),
    'function_identity',p.oid::regprocedure::text
  )::text
)::text
FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
WHERE t.tgrelid='public.mirror_outbox'::regclass AND NOT t.tgisinternal
ORDER BY t.tgname,t.oid;

WITH selected AS (
  SELECT DISTINCT p.oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.oid IN (
    SELECT t.tgfoid FROM pg_trigger t
    WHERE t.tgrelid='public.mirror_outbox'::regclass AND NOT t.tgisinternal
  ) OR p.oid IN (
    to_regprocedure('public.mirror_outbox_enqueue(text,text,text,jsonb,text,timestamp with time zone,text,text,text,text,text,text,text,bigint,boolean)'),
    to_regprocedure('${PRE_F27_WRITE_AUTHORIZATION_IDENTITY}'),
    to_regprocedure('${PRE_F27_PRODUCTION_AUTHORITY_IDENTITY}')
  ) OR CASE
    WHEN n.nspname='public' AND p.prokind IN ('f','p')
      THEN pg_get_functiondef(p.oid) ILIKE '%mirror_outbox%'
    ELSE false
  END
), inventory AS (
  SELECT p.*,n.nspname,l.lanname,pg_get_userbyid(p.proowner) AS owner_name
  FROM selected s JOIN pg_proc p ON p.oid=s.oid
  JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
)
SELECT jsonb_build_object(
  'section','functions',
  'ordinal',row_number() OVER (ORDER BY nspname,proname,pg_get_function_identity_arguments(oid)),
  'key',quote_ident(nspname)||'.'||quote_ident(proname)||'('||pg_get_function_identity_arguments(oid)||')',
  'value',jsonb_build_object(
    'schema',nspname,'name',proname,'identity_arguments',pg_get_function_identity_arguments(oid),
    'regprocedure_identity',oid::regprocedure::text,
    'result',pg_get_function_result(oid),'language',lanname,'kind',prokind,
    'security_definer',prosecdef,'leakproof',proleakproof,'volatility',provolatile,
    'parallel',proparallel,'strict',proisstrict,'owner',owner_name,'acl',proacl,
    'config',proconfig,'definition',pg_get_functiondef(oid)
  )::text
)::text
FROM inventory
ORDER BY nspname,proname,pg_get_function_identity_arguments(oid);

SELECT jsonb_build_object(
  'section','indexes','ordinal',row_number() OVER (ORDER BY ni.nspname,ci.relname),'key',ni.nspname||'.'||ci.relname,
  'value',jsonb_build_object(
    'schema',ni.nspname,'name',ci.relname,'owner',pg_get_userbyid(ci.relowner),
    'unique',i.indisunique,'primary',i.indisprimary,'exclusion',i.indisexclusion,
    'immediate',i.indimmediate,'clustered',i.indisclustered,'valid',i.indisvalid,
    'ready',i.indisready,'live',i.indislive,'replica_identity',i.indisreplident,
    'definition',pg_get_indexdef(i.indexrelid,0,true),'tablespace',COALESCE(ts.spcname,'pg_default'),
    'reloptions',ci.reloptions
  )::text
)::text
FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid
JOIN pg_namespace ni ON ni.oid=ci.relnamespace
LEFT JOIN pg_tablespace ts ON ts.oid=ci.reltablespace
WHERE i.indrelid='public.mirror_outbox'::regclass
ORDER BY ni.nspname,ci.relname;

SELECT jsonb_build_object(
  'section','policies',
  'ordinal',row_number() OVER (ORDER BY policyname),'key',policyname,
  'value',jsonb_build_object(
    'schema',schemaname,'table',tablename,'name',policyname,'permissive',permissive,
    'roles',roles,'command',cmd,'using',qual,'with_check',with_check
  )::text
)::text
FROM pg_policies WHERE schemaname='public' AND tablename='mirror_outbox'
ORDER BY policyname;

WITH rel AS (
  SELECT c.*,COALESCE(c.relacl,acldefault('r',c.relowner)) AS effective_acl
  FROM pg_class c WHERE c.oid='public.mirror_outbox'::regclass
), grants AS (
  SELECT CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS grantee,
    pg_get_userbyid(x.grantor) AS grantor,x.privilege_type,x.is_grantable
  FROM rel CROSS JOIN LATERAL aclexplode(rel.effective_acl) x
)
SELECT jsonb_build_object(
  'section','grants',
  'ordinal',row_number() OVER (ORDER BY grantee,grantor,privilege_type,is_grantable),
  'key',grantee||'/'||grantor||'/'||privilege_type||'/'||is_grantable::text,
  'value',jsonb_build_object('grantee',grantee,'grantor',grantor,'privilege',privilege_type,'grantable',is_grantable)::text
)::text
FROM grants ORDER BY grantee,grantor,privilege_type,is_grantable;

SELECT jsonb_build_object(
  'section','rows','ordinal',row_number() OVER (ORDER BY o.id),'key',o.id::text,
  'value',to_jsonb(o)::text
)::text
FROM public.mirror_outbox o ORDER BY o.id;

SELECT jsonb_build_object(
  'section','aggregates',
  'ordinal',row_number() OVER (ORDER BY safe_team,safe_status),'key',safe_team||'/'||safe_status,
  'value',jsonb_build_object('team',safe_team,'status',safe_status,'count',row_count)::text
)::text
FROM (
  SELECT CASE WHEN team IN ('video','graphics') THEN team ELSE 'other' END AS safe_team,
    CASE WHEN status IN ('pending','shadow_ok','written','failed','skipped','stale') THEN status ELSE 'other' END AS safe_status,
    count(*) AS row_count
  FROM public.mirror_outbox GROUP BY 1,2
) grouped ORDER BY safe_team,safe_status;

SELECT jsonb_build_object(
  'section','newest','ordinal',rank,'key',rank::text,
  'value',jsonb_build_object(
    'rank',rank,
    'team',CASE WHEN team IN ('video','graphics') THEN team ELSE 'other' END,
    'status',CASE WHEN status IN ('pending','shadow_ok','written','failed','skipped','stale') THEN status ELSE 'other' END,
    'time',created_at,
    'private_row',row_text
  )::text
)::text
FROM (
  SELECT row_number() OVER (ORDER BY created_at DESC,id DESC) AS rank,team,status,created_at,to_jsonb(o)::text AS row_text
  FROM public.mirror_outbox o
) newest WHERE rank<=${NEWEST_LIMIT} ORDER BY rank;

WITH function_inventory AS (
  SELECT DISTINCT p.oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.oid IN (
    SELECT t.tgfoid FROM pg_trigger t
    WHERE t.tgrelid='public.mirror_outbox'::regclass AND NOT t.tgisinternal
  ) OR p.oid IN (
    to_regprocedure('public.mirror_outbox_enqueue(text,text,text,jsonb,text,timestamp with time zone,text,text,text,text,text,text,text,bigint,boolean)'),
    to_regprocedure('${PRE_F27_WRITE_AUTHORIZATION_IDENTITY}'),
    to_regprocedure('${PRE_F27_PRODUCTION_AUTHORITY_IDENTITY}')
  ) OR CASE
    WHEN n.nspname='public' AND p.prokind IN ('f','p')
      THEN pg_get_functiondef(p.oid) ILIKE '%mirror_outbox%'
    ELSE false
  END
)
SELECT jsonb_build_object(
  'section','inventory','ordinal',1,'key','inventory',
  'value',jsonb_build_object(
    'metadata',1,
    'runtime_safety',1,
    'pre_f27_baseline',1,
    'table',(SELECT count(*) FROM pg_class WHERE oid='public.mirror_outbox'::regclass),
    'columns',(SELECT count(*) FROM pg_attribute WHERE attrelid='public.mirror_outbox'::regclass AND attnum>0 AND NOT attisdropped),
    'constraints',(SELECT count(*) FROM pg_constraint WHERE conrelid='public.mirror_outbox'::regclass),
    'triggers',(SELECT count(*) FROM pg_trigger WHERE tgrelid='public.mirror_outbox'::regclass AND NOT tgisinternal),
    'functions',(SELECT count(*) FROM function_inventory),
    'indexes',(SELECT count(*) FROM pg_index WHERE indrelid='public.mirror_outbox'::regclass),
    'policies',(SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='mirror_outbox'),
    'grants',(SELECT count(*) FROM (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) x WHERE c.oid='public.mirror_outbox'::regclass) q),
    'rows',(SELECT count(*) FROM public.mirror_outbox),
    'aggregates',(SELECT count(*) FROM (SELECT 1 FROM public.mirror_outbox GROUP BY CASE WHEN team IN ('video','graphics') THEN team ELSE 'other' END,CASE WHEN status IN ('pending','shadow_ok','written','failed','skipped','stale') THEN status ELSE 'other' END) q),
    'newest',LEAST(${NEWEST_LIMIT},(SELECT count(*) FROM public.mirror_outbox))
  )::text
)::text;

COMMIT;
`;
}

function quotedIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    fail('PROJECTION_INVALID', 'The captured pre-install projection contained an unsafe identifier.');
  }
  return `"${value}"`;
}

function quotedSqlStrings(values) {
  return values.map(value => `'${value.replace(/'/g, "''")}'`).join(',');
}

function regprocedureExpressions(values) {
  return values.map(value => `to_regprocedure('${value.replace(/'/g, "''")}')`).join(',');
}

function verifyAfterSql(projection, includeRows = true) {
  if (!Array.isArray(projection) || !projection.length || new Set(projection).size !== projection.length
      || projection[0] !== 'id') {
    fail('PROJECTION_INVALID', 'The captured pre-install projection was missing, duplicated, or not primary-key-led.');
  }
  const projected = projection.map(name => `o.${quotedIdentifier(name)}`).join(',');
  const rowsQuery = includeRows ? String.raw`
SELECT jsonb_build_object(
  'section','post_rows','ordinal',row_number() OVER (ORDER BY projected.id),'key',projected.id::text,
  'value',to_jsonb(projected)::text
)::text
FROM (SELECT ${projected} FROM public.mirror_outbox o ORDER BY o.id) projected
ORDER BY projected.id;
` : '';
  const functionNames = quotedSqlStrings(F27_FUNCTION_NAMES);
  const constraintNames = quotedSqlStrings(F27_CONSTRAINT_NAMES);
  const tableNames = quotedSqlStrings(F27_TABLE_NAMES);
  const executeFunctionOids = regprocedureExpressions(F27_EXECUTE_FUNCTION_IDENTITIES);
  return String.raw`\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;

DO $f27$
BEGIN
  IF to_regclass('public.mirror_outbox') IS NULL
     OR to_regclass('public.track_b_f27_team_fences') IS NULL
     OR to_regclass('public.track_b_team_rollbacks') IS NULL
     OR to_regclass('public.track_b_team_rollback_intents') IS NULL
     OR to_regclass('public.syncview_runtime_flags') IS NULL
     OR to_regclass('public.flag_flips') IS NULL THEN
    RAISE EXCEPTION 'F27_VERIFY_REQUIRED_OBJECT_MISSING';
  END IF;
END
$f27$;

SELECT jsonb_build_object(
  'section','post_metadata','ordinal',1,'key','metadata',
  'value',jsonb_build_object(
    'current_database',current_database(),'server_version',version(),
    'server_version_num',current_setting('server_version_num'),
    'transaction_isolation',current_setting('transaction_isolation'),
    'transaction_read_only',current_setting('transaction_read_only'),
    'verified_at',transaction_timestamp()
  )::text
)::text;

SELECT jsonb_build_object(
  'section','post_runtime_safety','ordinal',1,'key','runtime_safety',
  'value',jsonb_build_object(
    'flags',COALESCE((
      SELECT jsonb_object_agg(key,value ORDER BY key)
      FROM public.syncview_runtime_flags
      WHERE key IN ('prod_authority','linear_outbound_enabled','linear_legacy_parity_enabled')
    ),'{}'::jsonb),
    'flag_flips_count',(SELECT count(*) FROM public.flag_flips)
  )::text
)::text;
${rowsQuery}
SELECT jsonb_build_object(
  'section','f27_columns','ordinal',row_number() OVER (ORDER BY a.attnum),'key',a.attname,
  'value',jsonb_build_object(
    'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),
    'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid,true),
    'identity',a.attidentity,'generated',a.attgenerated
  )::text
)::text
FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
WHERE a.attrelid='public.mirror_outbox'::regclass
  AND a.attname IN ('authority_generation','f27_drill_rollback_id')
  AND a.attnum>0 AND NOT a.attisdropped
ORDER BY a.attnum;

SELECT jsonb_build_object(
  'section','f27_constraints','ordinal',row_number() OVER (ORDER BY c.conname),'key',c.conname,
  'value',jsonb_build_object(
    'name',c.conname,'type',c.contype,'validated',c.convalidated,
    'deferrable',c.condeferrable,'initially_deferred',c.condeferred,
    'definition',pg_get_constraintdef(c.oid,true)
  )::text
)::text
FROM pg_constraint c
WHERE c.conrelid='public.mirror_outbox'::regclass AND c.conname IN (${constraintNames})
ORDER BY c.conname;

SELECT jsonb_build_object(
  'section','f27_triggers','ordinal',row_number() OVER (ORDER BY t.tgname),'key',t.tgname,
  'value',jsonb_build_object(
    'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true),
    'function_identity',p.oid::regprocedure::text
  )::text
)::text
FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
WHERE t.tgrelid='public.mirror_outbox'::regclass AND NOT t.tgisinternal
  AND t.tgname='track_b_f27_hold_guard'
ORDER BY t.tgname;

SELECT jsonb_build_object(
  'section','f27_functions',
  'ordinal',row_number() OVER (ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)),
  'key',quote_ident(n.nspname)||'.'||quote_ident(p.proname)||'('||pg_get_function_identity_arguments(p.oid)||')',
  'value',jsonb_build_object(
    'schema',n.nspname,'name',p.proname,'identity_arguments',pg_get_function_identity_arguments(p.oid),
    'regprocedure_identity',p.oid::regprocedure::text,
    'result',pg_get_function_result(p.oid),'language',l.lanname,'kind',p.prokind,
    'security_definer',p.prosecdef,'leakproof',p.proleakproof,'volatility',p.provolatile,
    'parallel',p.proparallel,'strict',p.proisstrict,'owner',pg_get_userbyid(p.proowner),
    'acl_is_null',p.proacl IS NULL,
    'raw_acl',COALESCE((
      SELECT jsonb_agg(raw_acl.acl_entry::text ORDER BY raw_acl.acl_entry::text)
      FROM unnest(p.proacl) AS raw_acl(acl_entry)
    ),'[]'::jsonb),
    'effective_grants',COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
          'grantor',pg_get_userbyid(a.grantor),
          'privilege',a.privilege_type,
          'grantable',a.is_grantable
        ) ORDER BY
          CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
          pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable
      )
      FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
    ),'[]'::jsonb),
    'default_owner_grants',COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'grantee',pg_get_userbyid(a.grantee),
          'grantor',pg_get_userbyid(a.grantor),
          'privilege',a.privilege_type,
          'grantable',a.is_grantable
        ) ORDER BY pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable
      )
      FROM aclexplode(acldefault('f',p.proowner)) a
      WHERE a.grantee=p.proowner
    ),'[]'::jsonb),
    'config',p.proconfig,'definition',pg_get_functiondef(p.oid)
  )::text
)::text
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
WHERE n.nspname='public' AND p.proname IN (${functionNames})
ORDER BY p.proname,pg_get_function_identity_arguments(p.oid);

SELECT jsonb_build_object(
  'section','f27_indexes','ordinal',1,'key',ci.relname,
  'value',jsonb_build_object(
    'name',ci.relname,'unique',i.indisunique,'primary',i.indisprimary,
    'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive,
    'definition',pg_get_indexdef(i.indexrelid,0,true)
  )::text
)::text
FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid
WHERE i.indrelid='public.mirror_outbox'::regclass
  AND ci.relname='mirror_outbox_one_f27_drill_row_idx';

SELECT jsonb_build_object(
  'section','f27_table_boundaries',
  'ordinal',row_number() OVER (ORDER BY c.relname),
  'key',quote_ident(n.nspname)||'.'||quote_ident(c.relname),
  'value',jsonb_build_object(
    'schema',n.nspname,'name',c.relname,'kind',c.relkind,
    'owner',pg_get_userbyid(c.relowner),
    'row_security',c.relrowsecurity,'force_row_security',c.relforcerowsecurity,
    'acl_is_null',c.relacl IS NULL,
    'raw_acl',COALESCE((
      SELECT jsonb_agg(raw_acl.acl_entry::text ORDER BY raw_acl.acl_entry::text)
      FROM unnest(c.relacl) AS raw_acl(acl_entry)
    ),'[]'::jsonb),
    'effective_grants',COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
          'grantor',pg_get_userbyid(a.grantor),
          'privilege',a.privilege_type,
          'grantable',a.is_grantable
        ) ORDER BY
          CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
          pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable
      )
      FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    ),'[]'::jsonb),
    'default_owner_grants',COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'grantee',pg_get_userbyid(a.grantee),
          'grantor',pg_get_userbyid(a.grantor),
          'privilege',a.privilege_type,
          'grantable',a.is_grantable
        ) ORDER BY pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable
      )
      FROM aclexplode(acldefault('r',c.relowner)) a
      WHERE a.grantee=c.relowner
    ),'[]'::jsonb)
  )::text
)::text
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname IN (${tableNames})
ORDER BY c.relname;

SELECT jsonb_build_object(
  'section','f27_function_execute_grants',
  'ordinal',row_number() OVER (ORDER BY p.oid::regprocedure::text),
  'key',p.oid::regprocedure::text,
  'value',jsonb_build_object(
    'schema',n.nspname,'name',p.proname,
    'identity_arguments',pg_get_function_identity_arguments(p.oid),
    'regprocedure_identity',p.oid::regprocedure::text,
    'owner',pg_get_userbyid(p.proowner),
    'acl_is_null',p.proacl IS NULL,
    'raw_acl',COALESCE((
      SELECT jsonb_agg(raw_acl.acl_entry::text ORDER BY raw_acl.acl_entry::text)
      FROM unnest(p.proacl) AS raw_acl(acl_entry)
    ),'[]'::jsonb),
    'effective_execute_grants',COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
          'grantor',pg_get_userbyid(a.grantor),
          'privilege',a.privilege_type,
          'grantable',a.is_grantable
        ) ORDER BY
          CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
          pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable
      )
      FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.privilege_type='EXECUTE'
    ),'[]'::jsonb),
    'default_owner_execute_grants',COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'grantee',pg_get_userbyid(a.grantee),
          'grantor',pg_get_userbyid(a.grantor),
          'privilege',a.privilege_type,
          'grantable',a.is_grantable
        ) ORDER BY pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable
      )
      FROM aclexplode(acldefault('f',p.proowner)) a
      WHERE a.grantee=p.proowner AND a.privilege_type='EXECUTE'
    ),'[]'::jsonb)
  )::text
)::text
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE p.oid IN (${executeFunctionOids})
ORDER BY p.oid::regprocedure::text;

SELECT jsonb_build_object(
  'section','f27_state','ordinal',1,'key','state',
  'value',jsonb_build_object(
    'fences',COALESCE((SELECT jsonb_object_agg(team,generation ORDER BY team) FROM public.track_b_f27_team_fences),'{}'::jsonb),
    'fence_count',(SELECT count(*) FROM public.track_b_f27_team_fences),
    'rollback_count',(SELECT count(*) FROM public.track_b_team_rollbacks),
    'intent_count',(SELECT count(*) FROM public.track_b_team_rollback_intents),
    'open_rollback_count',(
      SELECT count(*) FROM public.track_b_team_rollbacks WHERE state='open'
    ),
    'unresolved_intent_count',(
      SELECT count(*) FROM public.track_b_team_rollback_intents
      WHERE classification IS NULL
         OR (classification='replay' AND terminal_receipt IS NULL)
    ),
    'audit_rows',COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id::text)
      FROM public.track_b_team_rollbacks r
    ),'[]'::jsonb),
    'intent_rows',COALESCE((
      SELECT jsonb_agg(
        to_jsonb(i) || jsonb_build_object(
          'outbox_id',i.outbox_id::text,
          'row_snapshot_canonical',i.row_snapshot::text,
          'outbox_binding',jsonb_build_object(
            'id',o.id::text,
            'status',o.status,
            'dedup_key',o.dedup_key,
            'operation',o.operation,
            'linear_result',o.linear_result,
            'f27_drill_rollback_id',o.f27_drill_rollback_id,
            'team',o.team,
            'client_slug',o.client_slug,
            'test_only',o.test_only,
            'legacy_parity',o.legacy_parity,
            'authority_generation',o.authority_generation
          )
        )
        ORDER BY i.rollback_id::text,i.outbox_id
      )
      FROM public.track_b_team_rollback_intents i
      JOIN public.mirror_outbox o ON o.id=i.outbox_id
    ),'[]'::jsonb),
    'residual_probe_count',(
      SELECT count(*) FROM public.mirror_outbox
      WHERE entity_id='f27-migration-test' OR client_slug='f27-migration-test'
        OR dedup_key LIKE 'f27-migration-test:%'
    )
  )::text
)::text;

COMMIT;
`;
}

function windowPPreflightSqlText() {
  const full = sqlText();
  const marker = '-- F27_WINDOW_P_PRIVATE_CAPTURE_BOUNDARY';
  if (full.split(marker).length !== 2) {
    fail('WINDOW_P_SQL_CONTRACT_INVALID', 'The read-only Window P SQL boundary was not exact.');
  }
  const prefix = full.slice(0, full.indexOf(marker));
  return `${prefix}
SELECT jsonb_build_object(
  'section','window_p_counts','ordinal',1,'key','window_p_counts',
  'value',jsonb_build_object(
    'row_count',count(*),
    'non_terminal_row_count',count(*) FILTER (
      WHERE status IS NULL OR status NOT IN ('written','skipped','stale')
    )
  )::text
)::text
FROM public.mirror_outbox;

COMMIT;
`;
}

function psqlCaptureFailure(stderr) {
  if (String(stderr == null ? '' : stderr).includes('F27_SNAPSHOT_PRE_F27_BASELINE_REQUIRED')) {
    return new SnapshotCaptureError(
      'PRE_F27_BASELINE_REQUIRED',
      'Capture requires the exact reviewed pre-F27 boundary; additional or drifted F27 state was found.',
    );
  }
  return new SnapshotCaptureError('PSQL_CAPTURE_FAILED', 'The read-only psql snapshot transaction failed closed.');
}

function safePsqlEnvironment(connectionEnv = {}, baseEnv = process.env) {
  const names = new Set([
    'PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'ComSpec',
    'PATHEXT', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'LC_CTYPE',
  ]);
  const environment = {};
  for (const [name, value] of Object.entries(baseEnv || {})) {
    if (names.has(name)) environment[name] = value;
  }
  return { ...environment, ...connectionEnv };
}

function defaultPsqlAdapter(psqlPath) {
  return {
    version() {
      let output;
      try {
        output = execFileSync(psqlPath, ['--version'], {
          encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
          env: safePsqlEnvironment(),
        });
      } catch (_) {
        fail('PSQL_VERSION_FAILED', 'The pinned psql client version could not be read.');
      }
      const value = clean(output);
      if (!/^psql \(PostgreSQL\) \d+(?:\.\d+)+/.test(value)) {
        fail('PSQL_VERSION_FAILED', 'The psql version response was malformed.');
      }
      return value;
    },
    capture(sql, connectionEnv) {
      const childEnv = safePsqlEnvironment(connectionEnv);
      const result = spawnSync(psqlPath, ['-X', '--quiet', '--no-align', '--tuples-only', '--set', 'ON_ERROR_STOP=1', '--file', '-'], {
        input: sql,
        encoding: 'utf8',
        windowsHide: true,
        env: childEnv,
        maxBuffer: 1024 * 1024 * 1024,
      });
      if (result.error || result.status !== 0 || result.signal || clean(result.stderr)) {
        throw psqlCaptureFailure(result.stderr);
      }
      return result.stdout;
    },
  };
}

function parseRecord(line) {
  let record;
  try {
    record = JSON.parse(line);
  } catch (_) {
    fail('TRANSCRIPT_MALFORMED', 'The psql snapshot transcript was not complete canonical JSONL.');
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)
      || !clean(record.section) || !Number.isInteger(Number(record.ordinal))
      || Number(record.ordinal) < 1 || !clean(record.key) || typeof record.value !== 'string') {
    fail('TRANSCRIPT_MALFORMED', 'The psql snapshot transcript contained a malformed inventory record.');
  }
  let value;
  try {
    value = JSON.parse(record.value);
  } catch (_) {
    fail('TRANSCRIPT_MALFORMED', 'The psql snapshot transcript contained malformed private JSON.');
  }
  return { section: record.section, ordinal: Number(record.ordinal), key: String(record.key), raw: record.value, value };
}

function parseWindowPPreflightTranscript(stdout, confirmedDatabase) {
  const lines = String(stdout == null ? '' : stdout).split(/\r?\n/).filter(line => line.length);
  const expectedSections = [
    'metadata',
    'runtime_safety',
    'pre_f27_baseline',
    'window_p_counts',
  ];
  if (lines.length !== expectedSections.length) {
    fail('WINDOW_P_TRANSCRIPT_INVALID', 'The read-only Window P transcript was incomplete.');
  }
  const records = lines.map(parseRecord);
  const bySection = new Map();
  for (const record of records) {
    if (!expectedSections.includes(record.section)
        || record.ordinal !== 1
        || bySection.has(record.section)) {
      fail('WINDOW_P_TRANSCRIPT_INVALID', 'The read-only Window P transcript contained an unexpected record.');
    }
    bySection.set(record.section, record);
  }
  if (expectedSections.some(section => !bySection.has(section))) {
    fail('WINDOW_P_TRANSCRIPT_INVALID', 'The read-only Window P transcript was incomplete.');
  }
  const metadata = bySection.get('metadata').value;
  if (!metadata
      || metadata.current_database !== confirmedDatabase
      || metadata.transaction_isolation !== 'repeatable read'
      || metadata.transaction_read_only !== 'on'
      || metadata.table_regclass !== 'public.mirror_outbox'
      || JSON.stringify(metadata.primary_key_columns) !== '["id"]') {
    fail('TRANSACTION_PROOF_FAILED', 'Database identity or Window P read-only transaction proof failed.');
  }
  const runtimeSafety = validateRuntimeSafety(
    bySection.get('runtime_safety').value,
    'RUNTIME_SAFETY_INVALID',
    EXPECTED_WINDOW_P_RUNTIME_FLAGS,
  );
  const preF27Baseline = validatePreF27Baseline(bySection.get('pre_f27_baseline').value);
  const counts = bySection.get('window_p_counts').value;
  const rowCount = Number(counts && counts.row_count);
  const nonTerminalRowCount = Number(counts && counts.non_terminal_row_count);
  if (!Number.isSafeInteger(rowCount) || rowCount < 0
      || !Number.isSafeInteger(nonTerminalRowCount) || nonTerminalRowCount < 0
      || nonTerminalRowCount > rowCount) {
    fail('WINDOW_P_COUNTS_INVALID', 'The Window P queue counts were malformed.');
  }
  return {
    metadata,
    runtimeSafety,
    preF27Baseline,
    rowCount,
    nonTerminalRowCount,
  };
}

function validateRuntimeSafety(value, code, expectedFlags = EXPECTED_RUNTIME_FLAGS) {
  const count = Number(value && value.flag_flips_count);
  const flags = value && value.flags;
  if (!Number.isSafeInteger(count) || count < 0
      || JSON.stringify(stableValue(flags)) !== JSON.stringify(stableValue(expectedFlags))) {
    fail(code, 'Authority, outbound, parity, or flag-flip safety state was missing or outside the required dormant posture.');
  }
  return { flags: stableValue(flags), flagFlipsCount: count };
}

function normalizedFenceGenerations(fences) {
  let entries;
  if (Array.isArray(fences)) {
    entries = fences.map(row => [clean(row && row.team), Number(row && row.generation)]);
  } else if (fences && typeof fences === 'object' && !Array.isArray(fences)) {
    entries = Object.entries(fences).map(([team, generation]) => [clean(team), Number(generation)]);
  } else {
    return null;
  }
  if (entries.length !== 2 || new Set(entries.map(([team]) => team)).size !== 2) return null;
  const result = {};
  for (const [team, generation] of entries) {
    if (!SAFE_TEAMS.has(team) || !Number.isSafeInteger(generation) || generation < 0) return null;
    result[team] = generation;
  }
  if (!Object.prototype.hasOwnProperty.call(result, 'video')
      || !Object.prototype.hasOwnProperty.call(result, 'graphics')) return null;
  return stableValue(result);
}

function auditRowKey(row) {
  return clean(row && row.id);
}

function canonicalPositiveIntegerText(value) {
  if (typeof value === 'bigint') return value > 0n ? value.toString() : null;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  const valueText = typeof value === 'string' ? value : '';
  return /^[1-9][0-9]*$/.test(valueText) ? valueText : null;
}

function auditIntentKey(row) {
  return `${clean(row && row.rollback_id)}\u0000${canonicalPositiveIntegerText(row && row.outbox_id) || ''}`;
}

function compareAuditIntents(left, right) {
  const rollbackOrder = clean(left && left.rollback_id).localeCompare(clean(right && right.rollback_id));
  if (rollbackOrder) return rollbackOrder;
  const leftId = canonicalPositiveIntegerText(left && left.outbox_id);
  const rightId = canonicalPositiveIntegerText(right && right.outbox_id);
  if (!leftId || !rightId) return String(leftId || '').localeCompare(String(rightId || ''));
  const leftBigInt = BigInt(leftId);
  const rightBigInt = BigInt(rightId);
  return leftBigInt < rightBigInt ? -1 : leftBigInt > rightBigInt ? 1 : 0;
}

function postgresJsonbStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(postgresJsonbStringify).join(', ')}]`;
  const keys = Object.keys(value).sort((left, right) => {
    const a = Buffer.from(left, 'utf8');
    const b = Buffer.from(right, 'utf8');
    return a.length - b.length || Buffer.compare(a, b);
  });
  return `{${keys.map(key => `${JSON.stringify(key)}: ${postgresJsonbStringify(value[key])}`).join(', ')}}`;
}

function jsonbEquals(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function jsonbSha256(value) {
  return sha256(Buffer.from(postgresJsonbStringify(value), 'utf8'));
}

function retainedF27AuditInvariant({ fences, rollbacks, intents } = {}) {
  const fenceGenerations = normalizedFenceGenerations(fences);
  if (!fenceGenerations || !Array.isArray(rollbacks) || !Array.isArray(intents)
      || rollbacks.some(row => !row || typeof row !== 'object' || Array.isArray(row))
      || intents.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    fail('PRE_F27_BASELINE_REQUIRED', 'Capture requires one of the two exact reviewed F27 entry states.');
  }
  const sortedRollbacks = [...rollbacks].sort((left, right) =>
    auditRowKey(left).localeCompare(auditRowKey(right)));
  const canonicalIntents = intents.map(intent => {
    const outboxId = canonicalPositiveIntegerText(intent && intent.outbox_id);
    let rowSnapshotCanonical = intent && intent.row_snapshot_canonical;
    if (!outboxId || (rowSnapshotCanonical != null && typeof rowSnapshotCanonical !== 'string')) {
      fail('PRE_F27_BASELINE_REQUIRED', 'Retained intent audit had a non-canonical outbox identity or row snapshot binder.');
    }
    if (rowSnapshotCanonical == null && intent && intent.row_snapshot
        && typeof intent.row_snapshot === 'object' && !Array.isArray(intent.row_snapshot)) {
      rowSnapshotCanonical = postgresJsonbStringify(intent.row_snapshot);
    }
    let parsedCanonical;
    try { parsedCanonical = JSON.parse(rowSnapshotCanonical); } catch (_) {
      fail('PRE_F27_BASELINE_REQUIRED', 'Retained intent row snapshot canonical text was malformed.');
    }
    if (!jsonbEquals(parsedCanonical, intent.row_snapshot)) {
      fail('PRE_F27_BASELINE_REQUIRED', 'Retained intent row snapshot and its PostgreSQL canonical text differed.');
    }
    return stableValue({ ...intent, outbox_id: outboxId, row_snapshot_canonical: rowSnapshotCanonical });
  });
  const sortedIntents = canonicalIntents.sort(compareAuditIntents);
  const rollbackIds = new Set();
  for (const rollback of sortedRollbacks) {
    const id = auditRowKey(rollback);
    if (!id || rollbackIds.has(id) || rollback.state !== 'complete'
        || !clean(rollback.completed_at) || !rollback.terminal_receipt
        || typeof rollback.terminal_receipt !== 'object'
        || Array.isArray(rollback.terminal_receipt)
        || !clean(rollback.correlation_id)
        || !rollback.expected_authority || typeof rollback.expected_authority !== 'object'
        || Array.isArray(rollback.expected_authority)
        || !rollback.prior_outbound || typeof rollback.prior_outbound !== 'object'
        || Array.isArray(rollback.prior_outbound)
        || !rollback.prior_parity || typeof rollback.prior_parity !== 'object'
        || Array.isArray(rollback.prior_parity)) {
      fail('PRE_F27_BASELINE_REQUIRED', 'Retained rollback audit was open, duplicated, or incomplete.');
    }
    rollbackIds.add(id);
  }
  const rollbackById = new Map(sortedRollbacks.map(row => [auditRowKey(row), row]));
  const intentKeys = new Set();
  const intentsByRollback = new Map();
  let unresolvedIntentCount = 0;
  for (const intent of sortedIntents) {
    const key = auditIntentKey(intent);
    const rollbackId = clean(intent.rollback_id);
    const outboxId = canonicalPositiveIntegerText(intent.outbox_id);
    const parentRollback = rollbackById.get(rollbackId);
    const binding = intent.outbox_binding;
    if (!rollbackId || !outboxId || intentKeys.has(key) || !rollbackIds.has(rollbackId)
        || !HASH_RE.test(clean(intent.row_sha256))
        || !intent.row_snapshot || typeof intent.row_snapshot !== 'object'
        || Array.isArray(intent.row_snapshot)
        || sha256(Buffer.from(intent.row_snapshot_canonical, 'utf8')) !== clean(intent.row_sha256)
        || canonicalPositiveIntegerText(intent.row_snapshot.id) !== outboxId
        || !Array.isArray(intent.classification_history)
        || intent.classification_history.length === 0
        || !['replay', 'quarantine', 'discard', 'already_reflected'].includes(intent.classification)
        || !clean(intent.reason) || !clean(intent.classified_by) || !clean(intent.classified_at)
        || clean(intent.row_snapshot.team).toLowerCase() !== parentRollback.team
        || !['pending', 'failed', 'shadow_ok'].includes(clean(intent.row_snapshot.status))
        || !binding || typeof binding !== 'object' || Array.isArray(binding)
        || canonicalPositiveIntegerText(binding.id) !== outboxId) {
      fail('PRE_F27_BASELINE_REQUIRED', 'Retained intent audit was orphaned, duplicated, or malformed.');
    }
    if (parentRollback.is_drill === false) {
      if (clean(intent.row_snapshot.authority_generation)
            !== clean(parentRollback.fence_generation)
          || intent.row_snapshot.f27_drill_rollback_id != null) {
        fail('PRE_F27_BASELINE_REQUIRED', 'Retained real-team intent did not bind its preserved generation.');
      }
    } else if (parentRollback.is_drill === true) {
      if (intent.row_snapshot.team !== '__f27_drill__'
          || intent.row_snapshot.client_slug !== '__f27_drill__'
          || clean(intent.row_snapshot.test_only) !== 'true'
          || clean(intent.row_snapshot.legacy_parity) !== 'false'
          || clean(intent.row_snapshot.authority_generation) !== '0'
          || clean(intent.row_snapshot.f27_drill_rollback_id) !== rollbackId) {
        fail('PRE_F27_BASELINE_REQUIRED', 'Retained drill intent was not bound to the reserved drill row.');
      }
    }
    const finalHistory = intent.classification_history[intent.classification_history.length - 1];
    if (!finalHistory || finalHistory.to !== intent.classification
        || finalHistory.reason !== intent.reason || finalHistory.actor !== intent.classified_by
        || clean(finalHistory.at) !== clean(intent.classified_at)) {
      fail('PRE_F27_BASELINE_REQUIRED', 'Retained intent classification history was inconsistent.');
    }
    intentKeys.add(key);
    if (!intentsByRollback.has(rollbackId)) intentsByRollback.set(rollbackId, []);
    intentsByRollback.get(rollbackId).push(intent);
    const terminalRequired = ['replay', 'already_reflected'].includes(intent.classification);
    if (terminalRequired && (!intent.terminal_receipt
        || typeof intent.terminal_receipt !== 'object'
        || Array.isArray(intent.terminal_receipt))) {
      unresolvedIntentCount += 1;
      fail('PRE_F27_BASELINE_REQUIRED', 'Retained intent audit contained unresolved work.');
    }
    if (!terminalRequired && intent.terminal_receipt != null) {
      fail('PRE_F27_BASELINE_REQUIRED', 'A terminal receipt appeared on a non-terminal classification.');
    }
    if (!terminalRequired && binding.status !== 'skipped') {
      fail('PRE_F27_BASELINE_REQUIRED', 'A quarantined or discarded intent did not retain a skipped outbox row.');
    }
    if (terminalRequired) {
      const terminal = intent.terminal_receipt;
      if (terminal.ok !== true || clean(terminal.rollback_id) !== rollbackId
          || canonicalPositiveIntegerText(terminal.outbox_id) !== outboxId
          || clean(terminal.correlation_id) !== clean(parentRollback.correlation_id)
          || terminal.intent_snapshot_sha256 !== intent.row_sha256
          || terminal.dedup_key !== binding.dedup_key
          || terminal.operation !== binding.operation) {
        fail('PRE_F27_BASELINE_REQUIRED', 'Retained intent terminal receipt was inconsistent.');
      }
      if (intent.classification === 'already_reflected') {
        if (terminal.type !== 'f27_already_reflected_terminal'
            || !clean(terminal.issue_id) || binding.status !== 'written'
            || !jsonbEquals(binding.linear_result, terminal)
            || !terminal.observed_result || typeof terminal.observed_result !== 'object'
            || Array.isArray(terminal.observed_result)
            || terminal.observed_result_sha256 !== jsonbSha256(terminal.observed_result)) {
          fail('PRE_F27_BASELINE_REQUIRED', 'Retained already-reflected receipt was not exact.');
        }
      } else {
        const expectedType = parentRollback.is_drill
          ? 'f27_drill_replay_terminal' : 'linear_write_terminal';
        if (terminal.type !== expectedType || binding.status !== 'written'
            || binding.linear_result == null
            || terminal.linear_result_sha256 !== jsonbSha256(binding.linear_result)) {
          fail('PRE_F27_BASELINE_REQUIRED', 'Retained replay receipt was not exact.');
        }
        if (parentRollback.is_drill && (
          clean(binding.f27_drill_rollback_id) !== rollbackId
          || binding.team !== '__f27_drill__'
          || binding.client_slug !== '__f27_drill__'
          || binding.test_only !== true
          || binding.legacy_parity !== false
          || Number(binding.authority_generation) !== 0
          || binding.linear_result.type !== 'f27_drill_replay_terminal'
          || binding.linear_result.no_external_call !== true
        )) {
          fail('PRE_F27_BASELINE_REQUIRED', 'Retained drill replay did not bind its exact terminal outbox row.');
        }
      }
    }
  }
  if (unresolvedIntentCount !== 0) {
    fail('PRE_F27_BASELINE_REQUIRED', 'Retained intent audit contained unresolved work.');
  }
  for (const rollback of sortedRollbacks) {
    const id = auditRowKey(rollback);
    const relatedIntents = intentsByRollback.get(id) || [];
    const snapshotCount = Number(rollback.snapshot_count);
    const terminal = rollback.terminal_receipt;
    const expectedSnapshotSha256 = sha256(Buffer.from(
      [...relatedIntents]
        .sort(compareAuditIntents)
        .map(intent => intent.row_sha256).join(''),
      'utf8',
    ));
    if (!Number.isSafeInteger(snapshotCount) || snapshotCount < 0
        || snapshotCount !== relatedIntents.length || !HASH_RE.test(clean(rollback.snapshot_sha256))
        || rollback.snapshot_sha256 !== expectedSnapshotSha256
        || terminal.ok !== true || clean(terminal.rollback_id) !== id
        || clean(terminal.correlation_id) !== clean(rollback.correlation_id)
        || terminal.team !== rollback.team
        || terminal.snapshot_count !== snapshotCount
        || terminal.snapshot_sha256 !== rollback.snapshot_sha256
        || JSON.stringify(stableValue(terminal.normal_outbound))
          !== JSON.stringify(stableValue(rollback.prior_outbound))
        || JSON.stringify(stableValue(terminal.legacy_parity))
          !== JSON.stringify(stableValue(rollback.prior_parity))
        || JSON.stringify(stableValue(terminal.authority_before))
          !== JSON.stringify(stableValue(rollback.expected_authority))) {
      fail('PRE_F27_BASELINE_REQUIRED', 'Retained rollback and intent audit counts were inconsistent.');
    }
    if (rollback.is_drill === true) {
      if (rollback.team !== '__f27_drill__' || rollback.fence_generation != null
          || terminal.type !== 'f27_drill_terminal' || terminal.is_drill !== true
          || terminal.audit_history_retained !== true
          || terminal.authority_cas !== 'refused'
          || terminal.authority_cas_reason !== 'f27_drill_authority_cas_refused'
          || snapshotCount !== 1
          || Number(terminal.unclassified) !== 0
          || Number(terminal.unreceipted_replays) !== 0
          || terminal.replay_intents !== snapshotCount
          || terminal.exact_terminal_replays !== snapshotCount
          || Number(terminal.active_drill_rows) !== 0
          || JSON.stringify(stableValue(terminal.authority_after))
            !== JSON.stringify(stableValue(rollback.expected_authority))) {
        fail('PRE_F27_BASELINE_REQUIRED', 'Retained drill audit was not exact.');
      }
    } else if (rollback.is_drill === false) {
      const generation = Number(rollback.fence_generation);
      const expectedAuthorityAfter = stableValue({
        ...rollback.expected_authority,
        [rollback.team]: 'linear',
      });
      if (!SAFE_TEAMS.has(rollback.team) || !Number.isSafeInteger(generation) || generation < 0
          || terminal.type !== 'f27_rollback_terminal'
          || Object.prototype.hasOwnProperty.call(terminal, 'is_drill')
          || terminal.fence_generation_before !== generation
          || terminal.fence_generation_after !== generation + 1
          || Number(terminal.unclassified) !== 0
          || Number(terminal.unreceipted_replays) !== 0
          || Number(terminal.active_team_rows) !== 0
          || JSON.stringify(stableValue(terminal.authority_after))
            !== JSON.stringify(expectedAuthorityAfter)) {
        fail('PRE_F27_BASELINE_REQUIRED', 'Retained real-team audit did not bind one generation transition.');
      }
    } else {
      fail('PRE_F27_BASELINE_REQUIRED', 'Retained rollback audit had an invalid drill discriminator.');
    }
  }
  for (const team of [...SAFE_TEAMS]) {
    const chain = sortedRollbacks
      .filter(row => row.is_drill === false && row.team === team)
      .map(row => Number(row.fence_generation))
      .sort((left, right) => left - right);
    const generation = fenceGenerations[team];
    if (chain.length !== generation
        || chain.some((value, index) => value !== index)) {
      fail('PRE_F27_BASELINE_REQUIRED', 'Retained fence generation lacked its exact contiguous audit chain.');
    }
  }
  const auditStateSha256 = sha256(Buffer.from(stableJson({
    intents: sortedIntents,
    rollbacks: sortedRollbacks,
  }), 'utf8'));
  return stableValue({
    audit_state_sha256: auditStateSha256,
    fence_generations: fenceGenerations,
    fence_row_count: 2,
    generation_chain_invariants: 'PASS',
    intent_row_count: sortedIntents.length,
    open_rollback_row_count: 0,
    rollback_row_count: sortedRollbacks.length,
    unresolved_intent_row_count: 0,
  });
}

function expectedPreF27Baseline() {
  return stableValue({
    allowed_boundary_function_count: REQUIRED_BOUNDARY_FUNCTION_IDENTITIES.length,
    allowed_f27_function_count: 1,
    allowed_f27_table_count: 1,
    audit_state_sha256: EMPTY_F27_AUDIT_STATE_SHA256,
    entry_state: PRISTINE_PRE_F27_ENTRY_STATE,
    f27_outbox_column_count: 0,
    f27_outbox_constraint_count: 0,
    f27_outbox_index_count: 0,
    f27_outbox_trigger_count: 0,
    f27_table_count: 1,
    fence_generations: { graphics: 0, video: 0 },
    fence_row_count: 2,
    generation_chain_invariants: 'PASS',
    hold_guard_acl_variant: null,
    intent_row_count: 0,
    open_rollback_row_count: 0,
    reviewed_contract: 'PASS',
    reviewed_contract_sha256: reviewedPreF27SubsetContractSha256(),
    rollback_row_count: 0,
    unexpected_f27_function_count: 0,
    unresolved_intent_row_count: 0,
  });
}

function postSection7BaselineFromAudit(audit, holdGuardAclVariant) {
  if (!['legacy_2026_08_01_acldefault_public_execute', 'current_owner_only'].includes(holdGuardAclVariant)) {
    fail('PRE_F27_BASELINE_REQUIRED', 'The retained hold-guard ACL was not one of the two reviewed Section 7 forms.');
  }
  return stableValue({
    allowed_boundary_function_count: REQUIRED_BOUNDARY_FUNCTION_IDENTITIES.length,
    allowed_f27_function_count: F27_FUNCTION_NAMES.length - 2,
    allowed_f27_table_count: F27_TABLE_NAMES.length,
    ...audit,
    entry_state: POST_SECTION7_ENTRY_STATE,
    f27_outbox_column_count: F27_OUTBOX_COLUMN_NAMES.length,
    f27_outbox_constraint_count: F27_CONSTRAINT_NAMES.length,
    f27_outbox_index_count: 1,
    f27_outbox_trigger_count: 1,
    f27_table_count: F27_TABLE_NAMES.length,
    hold_guard_acl_variant: holdGuardAclVariant,
    reviewed_contract: 'PASS',
    reviewed_contract_sha256: reviewedPostSection7ContractSha256(),
    unexpected_f27_function_count: 0,
  });
}

function expectedPostSection7Baseline({
  fences = { graphics: 0, video: 0 },
  rollbacks = [],
  intents = [],
  holdGuardAclVariant = 'current_owner_only',
} = {}) {
  const audit = retainedF27AuditInvariant({ fences, rollbacks, intents });
  return postSection7BaselineFromAudit(audit, holdGuardAclVariant);
}

function validateSealedPreF27Baseline(value) {
  const baseline = stableValue(value);
  if (baseline && baseline.entry_state === PRISTINE_PRE_F27_ENTRY_STATE
      && JSON.stringify(baseline) === JSON.stringify(expectedPreF27Baseline())) return baseline;
  if (baseline && baseline.entry_state === POST_SECTION7_ENTRY_STATE) {
    const { retained_rollbacks: rollbacks, retained_intents: intents, ...reported } = baseline;
    const expected = expectedPostSection7Baseline({
      fences: reported.fence_generations,
      rollbacks,
      intents,
      holdGuardAclVariant: reported.hold_guard_acl_variant,
    });
    if (JSON.stringify(reported) === JSON.stringify(expected)) return baseline;
  }
  fail('PRE_F27_BASELINE_REQUIRED', 'The sealed pre-DDL baseline was not one of the two reviewed entry states.');
}

function postSection7BaselineTranscriptValue(options = {}) {
  const baseline = expectedPostSection7Baseline(options);
  return stableValue({
    ...baseline,
    retained_rollbacks: [...(options.rollbacks || [])].sort((left, right) =>
      auditRowKey(left).localeCompare(auditRowKey(right))),
    retained_intents: [...(options.intents || [])].map(intent => stableValue({
      ...intent,
      outbox_id: canonicalPositiveIntegerText(intent && intent.outbox_id),
      row_snapshot_canonical: intent && intent.row_snapshot_canonical != null
        ? intent.row_snapshot_canonical
        : postgresJsonbStringify(intent && intent.row_snapshot),
    })).sort(compareAuditIntents),
  });
}

function validatePreF27Baseline(value) {
  const baseline = stableValue(value);
  if (baseline && baseline.entry_state === PRISTINE_PRE_F27_ENTRY_STATE
      && JSON.stringify(baseline) === JSON.stringify(expectedPreF27Baseline())) return baseline;
  if (baseline && baseline.entry_state === POST_SECTION7_ENTRY_STATE) {
    const { retained_rollbacks: rollbacks, retained_intents: intents, ...reported } = baseline;
    const expected = expectedPostSection7Baseline({
      fences: reported.fence_generations,
      rollbacks,
      intents,
      holdGuardAclVariant: reported.hold_guard_acl_variant,
    });
    const expectedTranscript = { ...expected };
    if (!Object.prototype.hasOwnProperty.call(reported, 'audit_state_sha256')) {
      delete expectedTranscript.audit_state_sha256;
    }
    if (JSON.stringify(reported) === JSON.stringify(stableValue(expectedTranscript))) {
      return stableValue({
        ...expected,
        retained_rollbacks: [...rollbacks].sort((left, right) =>
          auditRowKey(left).localeCompare(auditRowKey(right))),
        retained_intents: [...intents].map(intent => stableValue({
          ...intent,
          outbox_id: canonicalPositiveIntegerText(intent && intent.outbox_id),
          row_snapshot_canonical: intent && intent.row_snapshot_canonical != null
            ? intent.row_snapshot_canonical
            : postgresJsonbStringify(intent && intent.row_snapshot),
        })).sort(compareAuditIntents),
      });
    }
  }
  fail(
    'PRE_F27_BASELINE_REQUIRED',
    'Capture requires one of the two exact reviewed F27 entry states and no hybrid state.',
  );
}

function parseTranscript(stdout, confirmedDatabase, options = {}) {
  const lines = String(stdout == null ? '' : stdout).split(/\r?\n/).filter(line => line.length);
  if (!lines.length) fail('TRANSCRIPT_EMPTY', 'The psql snapshot transcript was empty.');
  const sections = new Map();
  let inventory = null;
  for (const line of lines) {
    const record = parseRecord(line);
    if (record.section === 'inventory') {
      if (inventory) fail('INVENTORY_DUPLICATE', 'The psql inventory terminator was duplicated.');
      inventory = record;
      continue;
    }
    if (!REQUIRED_SECTIONS.includes(record.section)) {
      fail('SECTION_UNEXPECTED', 'The psql snapshot transcript contained an unexpected section.');
    }
    if (!sections.has(record.section)) sections.set(record.section, []);
    sections.get(record.section).push(record);
  }
  if (!inventory || !inventory.value || typeof inventory.value !== 'object') {
    fail('INVENTORY_MISSING', 'The psql snapshot inventory terminator was missing.');
  }
  for (const section of REQUIRED_SECTIONS) {
    const records = sections.get(section) || [];
    const expected = Number(inventory.value[section]);
    if (!Number.isSafeInteger(expected) || expected < 0 || records.length !== expected) {
      fail('INVENTORY_INCOMPLETE', 'A psql snapshot section did not match its independent inventory count.');
    }
    const keys = new Set();
    records.forEach((record, index) => {
      if (record.ordinal !== index + 1) fail('INVENTORY_UNSTABLE', 'A psql snapshot section had unstable ordering.');
      if (keys.has(record.key)) fail('INVENTORY_DUPLICATE', 'A psql snapshot section contained a duplicate identity.');
      keys.add(record.key);
    });
  }
  const metadata = (sections.get('metadata') || [])[0];
  const runtimeRecord = (sections.get('runtime_safety') || [])[0];
  const preF27BaselineRecords = sections.get('pre_f27_baseline') || [];
  const preF27BaselineRecord = preF27BaselineRecords[0];
  const table = (sections.get('table') || [])[0];
  if (!metadata || !runtimeRecord || preF27BaselineRecords.length !== 1 || !table
      || metadata.value.current_database !== confirmedDatabase
      || metadata.value.transaction_isolation !== 'repeatable read'
      || metadata.value.transaction_read_only !== 'on'
      || metadata.value.table_regclass !== 'public.mirror_outbox'
      || JSON.stringify(metadata.value.primary_key_columns) !== '["id"]') {
    fail('TRANSACTION_PROOF_FAILED', 'Database identity or repeatable-read/read-only transaction proof failed.');
  }
  const preF27Baseline = validatePreF27Baseline(preF27BaselineRecord.value);
  const columns = sections.get('columns') || [];
  const columnNames = columns.map(record => clean(record.value && record.value.name));
  if (!REQUIRED_COLUMNS.every(name => columnNames.includes(name)) || new Set(columnNames).size !== columnNames.length) {
    fail('COLUMN_INVENTORY_INVALID', 'The mirror_outbox column projection was missing, malformed, or duplicated.');
  }
  if (!(sections.get('constraints') || []).length
      || !(sections.get('indexes') || []).length || !(sections.get('grants') || []).length) {
    fail('BOUNDARY_INVENTORY_EMPTY', 'A required mirror_outbox boundary inventory was empty.');
  }
  const functions = sections.get('functions') || [];
  const functionNames = new Set(functions.map(record => clean(record.value && record.value.name)));
  const functionIdentities = new Set(functions.map(record => clean(record.value && record.value.regprocedure_identity)));
  if (!REQUIRED_FUNCTION_NAMES.every(name => functionNames.has(name))) {
    fail('FUNCTION_CLOSURE_INCOMPLETE', 'The required mirror_outbox function closure was incomplete.');
  }
  if (!REQUIRED_BOUNDARY_FUNCTION_IDENTITIES.every(identity => functionIdentities.has(identity))) {
    fail('FUNCTION_IDENTITY_INCOMPLETE', 'An exact required boundary-function identity was not captured.');
  }
  for (const section of ['constraints', 'triggers', 'functions', 'indexes']) {
    for (const record of sections.get(section) || []) {
      if (!record.value || !clean(record.value.definition)) {
        fail('DEFINITION_MALFORMED', 'A required boundary definition was missing.');
      }
    }
  }
  const rows = sections.get('rows') || [];
  const rowBodies = new Set(rows.map(record => record.raw));
  const newest = sections.get('newest') || [];
  for (const record of newest) {
    if (!record.value || !Number.isInteger(Number(record.value.rank))
        || !SAFE_TEAMS.has(record.value.team) && record.value.team !== 'other'
        || !SAFE_STATUSES.has(record.value.status) && record.value.status !== 'other'
        || !clean(record.value.time) || !rowBodies.has(record.value.private_row)) {
      fail('NEWEST_PROJECTION_INVALID', 'The newest-row proof was malformed or not bound to the private export.');
    }
  }
  const aggregates = sections.get('aggregates') || [];
  let aggregateCount = 0;
  for (const record of aggregates) {
    const count = Number(record.value && record.value.count);
    if (!Number.isSafeInteger(count) || count < 1
        || !SAFE_TEAMS.has(record.value.team) && record.value.team !== 'other'
        || !SAFE_STATUSES.has(record.value.status) && record.value.status !== 'other') {
      fail('AGGREGATE_PROJECTION_INVALID', 'The aggregate proof was malformed.');
    }
    aggregateCount += count;
  }
  if (aggregateCount !== rows.length) fail('ROW_COUNT_MISMATCH', 'Aggregate counts did not equal the private row export.');
  const runtimeSafety = validateRuntimeSafety(
    runtimeRecord.value,
    'RUNTIME_SAFETY_INVALID',
    options.expectedRuntimeFlags || EXPECTED_RUNTIME_FLAGS,
  );
  return {
    sections, metadata: metadata.value, runtimeSafety, preF27Baseline,
    columnNames, rows, newest, aggregates,
  };
}

function parsePostTranscriptInternal(
  stdout,
  confirmedDatabase,
  includeRows,
  requireSafeState,
) {
  const lines = String(stdout == null ? '' : stdout).split(/\r?\n/).filter(line => line.length);
  if (!lines.length) fail('POST_TRANSCRIPT_EMPTY', 'The post-migration readback transcript was empty.');
  const allowed = new Set([
    'post_metadata', 'post_runtime_safety', 'post_rows', 'f27_columns', 'f27_constraints',
    'f27_triggers', 'f27_functions', 'f27_indexes', 'f27_table_boundaries',
    'f27_function_execute_grants', 'f27_state',
  ]);
  const sections = new Map();
  for (const line of lines) {
    const record = parseRecord(line);
    if (!allowed.has(record.section) || (!includeRows && record.section === 'post_rows')) {
      fail('POST_SECTION_UNEXPECTED', 'The post-migration readback contained an unexpected section.');
    }
    if (!sections.has(record.section)) sections.set(record.section, []);
    sections.get(record.section).push(record);
  }
  for (const [section, records] of sections) {
    const keys = new Set();
    records.forEach((record, index) => {
      if (record.ordinal !== index + 1) fail('POST_INVENTORY_UNSTABLE', 'Post-migration readback ordering was unstable.');
      if (keys.has(record.key)) fail('POST_INVENTORY_DUPLICATE', 'Post-migration readback contained a duplicate identity.');
      keys.add(record.key);
    });
  }
  const metadata = sections.get('post_metadata') || [];
  const runtimeRows = sections.get('post_runtime_safety') || [];
  const stateRows = sections.get('f27_state') || [];
  if (metadata.length !== 1 || runtimeRows.length !== 1 || stateRows.length !== 1
      || metadata[0].value.current_database !== confirmedDatabase
      || !clean(metadata[0].value.server_version)
      || !/^\d+$/.test(clean(metadata[0].value.server_version_num))
      || metadata[0].value.transaction_isolation !== 'repeatable read'
      || metadata[0].value.transaction_read_only !== 'on') {
    fail('POST_TRANSACTION_PROOF_FAILED', 'Post-migration database identity or read-only transaction proof failed.');
  }
  const columns = sections.get('f27_columns') || [];
  if (columns.length !== 2 || columns.map(record => record.key).sort().join(',') !== 'authority_generation,f27_drill_rollback_id') {
    fail('F27_COLUMNS_INVALID', 'The two additive F27 mirror_outbox columns were not exact.');
  }
  const generation = columns.find(record => record.key === 'authority_generation').value;
  const drillId = columns.find(record => record.key === 'f27_drill_rollback_id').value;
  if (generation.type !== 'bigint' || generation.not_null !== true
      || !/^\(?0(?:::bigint)?\)?$/.test(clean(generation.default))
      || drillId.type !== 'uuid' || drillId.not_null !== false || drillId.default != null) {
    fail('F27_COLUMNS_INVALID', 'The additive F27 column types, nullability, or defaults drifted.');
  }
  const constraints = sections.get('f27_constraints') || [];
  if (constraints.length !== F27_CONSTRAINT_NAMES.length
      || constraints.map(record => record.key).sort().join(',') !== [...F27_CONSTRAINT_NAMES].sort().join(',')
      || constraints.some(record => record.value.validated !== true || !clean(record.value.definition))) {
    fail('F27_CONSTRAINTS_INVALID', 'The F27 mirror_outbox constraints were missing, unvalidated, or malformed.');
  }
  const triggers = sections.get('f27_triggers') || [];
  if (triggers.length !== 1 || triggers[0].key !== 'track_b_f27_hold_guard'
      || triggers[0].value.enabled !== 'O' || !clean(triggers[0].value.definition)
      || !clean(triggers[0].value.function_identity).includes('track_b_f27_hold_guard')) {
    fail('F27_TRIGGER_INVALID', 'The enabled F27 server fence trigger was not exact.');
  }
  const validGrant = (grant, expectedPrivilege = '') => grant && typeof grant === 'object'
    && clean(grant.grantee) && clean(grant.grantor) && clean(grant.privilege)
    && (!expectedPrivilege || grant.privilege === expectedPrivilege)
    && typeof grant.grantable === 'boolean';
  const functions = sections.get('f27_functions') || [];
  const functionNames = functions.map(record => clean(record.value && record.value.name));
  if (functions.length !== F27_FUNCTION_NAMES.length
      || [...functionNames].sort().join(',') !== [...F27_FUNCTION_NAMES].sort().join(',')
      || functions.some(record => {
        const value = record.value || {};
        return !clean(value.definition) || !clean(value.owner)
          || typeof value.acl_is_null !== 'boolean'
          || !Array.isArray(value.raw_acl) || value.raw_acl.some(entry => !clean(entry))
          || !Array.isArray(value.effective_grants) || !value.effective_grants.length
          || value.effective_grants.some(grant => !validGrant(grant))
          || !Array.isArray(value.default_owner_grants) || !value.default_owner_grants.length
          || value.default_owner_grants.some(grant => !validGrant(grant))
          || !ownerGrantsMatchDefault(value, 'effective_grants', 'default_owner_grants');
      })) {
    fail('F27_FUNCTIONS_INVALID', 'The complete F27 function definition closure was missing, overloaded, or malformed.');
  }
  const tableBoundaries = sections.get('f27_table_boundaries') || [];
  const expectedTableKeys = F27_TABLE_NAMES.map(name => `public.${name}`).sort();
  if (tableBoundaries.length !== F27_TABLE_NAMES.length
      || tableBoundaries.map(record => record.key).sort().join(',') !== expectedTableKeys.join(',')
      || tableBoundaries.some(record => {
        const value = record.value || {};
        return value.schema !== 'public' || record.key !== `public.${value.name}`
          || !['r', 'p'].includes(value.kind) || !clean(value.owner)
          || typeof value.row_security !== 'boolean' || typeof value.force_row_security !== 'boolean'
          || typeof value.acl_is_null !== 'boolean'
          || !Array.isArray(value.raw_acl) || value.raw_acl.some(entry => !clean(entry))
          || !Array.isArray(value.effective_grants) || !value.effective_grants.length
          || value.effective_grants.some(grant => !validGrant(grant))
          || !Array.isArray(value.default_owner_grants) || !value.default_owner_grants.length
          || value.default_owner_grants.some(grant => !validGrant(grant))
          || !ownerGrantsMatchDefault(value, 'effective_grants', 'default_owner_grants');
      })) {
    fail('F27_TABLE_BOUNDARIES_INVALID', 'The three F27 table owner, RLS, ACL, or effective-grant boundaries were incomplete or malformed.');
  }
  const functionExecuteGrants = sections.get('f27_function_execute_grants') || [];
  const expectedExecuteKeys = [...F27_EXECUTE_FUNCTION_IDENTITIES].sort();
  if (functionExecuteGrants.length !== F27_EXECUTE_FUNCTION_IDENTITIES.length
      || functionExecuteGrants.map(record => record.key).sort().join(',') !== expectedExecuteKeys.join(',')
      || functionExecuteGrants.some(record => {
        const value = record.value || {};
        return value.schema !== 'public' || record.key !== value.regprocedure_identity
          || !clean(value.name) || !clean(value.owner)
          || typeof value.identity_arguments !== 'string' || typeof value.acl_is_null !== 'boolean'
          || !Array.isArray(value.raw_acl) || value.raw_acl.some(entry => !clean(entry))
          || !Array.isArray(value.effective_execute_grants) || !value.effective_execute_grants.length
          || value.effective_execute_grants.some(grant => !validGrant(grant, 'EXECUTE'))
          || !Array.isArray(value.default_owner_execute_grants)
          || !value.default_owner_execute_grants.length
          || value.default_owner_execute_grants.some(grant => !validGrant(grant, 'EXECUTE'))
          || !ownerGrantsMatchDefault(
            value,
            'effective_execute_grants',
            'default_owner_execute_grants',
          );
      })) {
    fail('F27_FUNCTION_EXECUTE_GRANTS_INVALID', 'The nine exact F27 RPC effective-EXECUTE boundaries were incomplete or malformed.');
  }
  const indexes = sections.get('f27_indexes') || [];
  if (indexes.length !== 1 || indexes[0].key !== 'mirror_outbox_one_f27_drill_row_idx'
      || indexes[0].value.unique !== true || indexes[0].value.valid !== true
      || indexes[0].value.ready !== true || indexes[0].value.live !== true
      || !clean(indexes[0].value.definition)) {
    fail('F27_INDEX_INVALID', 'The unique F27 drill binder index was missing or invalid.');
  }
  const state = stateRows[0].value;
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    fail('F27_POST_STATE_INVALID', 'The F27 post-install state receipt was malformed.');
  }
  let normalizedState = stableValue(state);
  if (requireSafeState) {
    let auditInvariant;
    try {
      auditInvariant = retainedF27AuditInvariant({
        fences: state.fences,
        rollbacks: state.audit_rows,
        intents: state.intent_rows,
      });
    } catch (error) {
      if (!(error instanceof SnapshotCaptureError)
          || error.code !== 'PRE_F27_BASELINE_REQUIRED') throw error;
      fail('F27_POST_STATE_INVALID', 'F27 fence generations or retained terminal audit failed the reviewed invariant.');
    }
    if (Number(state.fence_count) !== auditInvariant.fence_row_count
        || Number(state.rollback_count) !== auditInvariant.rollback_row_count
        || Number(state.intent_count) !== auditInvariant.intent_row_count
        || Number(state.open_rollback_count) !== 0
        || Number(state.unresolved_intent_count) !== 0
        || Number(state.residual_probe_count) !== 0) {
      fail('F27_POST_STATE_INVALID', 'F27 open work, audit counts, or migration-probe cleanup did not match the safe post-install state.');
    }
    normalizedState = stableValue({
      ...state,
      audit_state_sha256: auditInvariant.audit_state_sha256,
      fence_generations: auditInvariant.fence_generations,
      generation_chain_invariants: 'PASS',
    });
  }
  const runtimeSafety = validateRuntimeSafety(runtimeRows[0].value, 'POST_RUNTIME_SAFETY_INVALID');
  if (includeRows && !sections.has('post_rows')) sections.set('post_rows', []);
  return {
    sections,
    metadata: metadata[0].value,
    runtimeSafety,
    state: normalizedState,
  };
}

function parsePostTranscript(stdout, confirmedDatabase, includeRows = true) {
  return parsePostTranscriptInternal(stdout, confirmedDatabase, includeRows, true);
}

// The final verifier reads state through its own exact bookended query, where
// open work and monotone audit/generation invariants retain their specific
// failure codes.  This parser is only for hashing the seven structural
// categories from the same read-only transcript; it cannot produce a live
// verify-after PASS.
function parsePostContractTranscript(stdout, confirmedDatabase) {
  return parsePostTranscriptInternal(stdout, confirmedDatabase, false, false);
}

const POST_CONTRACT_CATEGORIES = [
  ['columns', 'f27_columns'],
  ['constraints', 'f27_constraints'],
  ['triggers', 'f27_triggers'],
  ['functions', 'f27_functions'],
  ['indexes', 'f27_indexes'],
  ['table_boundaries', 'f27_table_boundaries'],
  ['function_execute_grants', 'f27_function_execute_grants'],
];

function ownerRelativeGrant(grant, owner) {
  return {
    grantee_is_owner: grant.grantee === owner,
    grantee_role: grant.grantee === owner ? null : grant.grantee,
    grantor_is_owner: grant.grantor === owner,
    grantor_role: grant.grantor === owner ? null : grant.grantor,
    privilege: grant.privilege,
    grantable: grant.grantable,
  };
}

function sortedOwnerRelativeGrants(grants, owner) {
  return grants.map(grant => ownerRelativeGrant(grant, owner)).sort((left, right) => {
    const a = JSON.stringify(stableValue(left));
    const b = JSON.stringify(stableValue(right));
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function ownerGrantsMatchDefault(value, effectiveKey, defaultKey) {
  const owner = clean(value && value.owner);
  const effective = value && value[effectiveKey];
  const defaults = value && value[defaultKey];
  if (!owner || !Array.isArray(effective) || !Array.isArray(defaults)) return false;
  const actualOwner = sortedOwnerRelativeGrants(
    effective.filter(grant => grant && grant.grantee === owner),
    owner,
  );
  const defaultOwner = sortedOwnerRelativeGrants(defaults, owner);
  return JSON.stringify(actualOwner) === JSON.stringify(defaultOwner);
}

function semanticAclValue(value, effectiveKey, defaultKey) {
  if (!ownerGrantsMatchDefault(value, effectiveKey, defaultKey)) {
    fail('F27_OWNER_ACL_DEFAULT_MISMATCH', 'An F27 owner privilege set differed from acldefault on the running server.');
  }
  const omitted = new Set([
    'acl', 'acl_is_null', 'raw_acl', effectiveKey, defaultKey,
  ]);
  const normalized = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!omitted.has(key)) normalized[key] = entry;
  }
  normalized.owner_privileges = 'SERVER_ACLDEFAULT';
  normalized.non_owner_grants = sortedOwnerRelativeGrants(
    value[effectiveKey].filter(grant => grant.grantee !== value.owner),
    value.owner,
  );
  return normalized;
}

function rawPostInventory(parsed) {
  const inventory = { format: RAW_POST_INVENTORY_FORMAT };
  for (const [category, section] of POST_CONTRACT_CATEGORIES) {
    inventory[category] = (parsed.sections.get(section) || []).map(record => ({
      key: record.key,
      value: record.value,
    }));
  }
  return inventory;
}

function normalizePostInventory(rawInventory) {
  const contract = { format: POST_CONTRACT_FORMAT };
  for (const [category] of POST_CONTRACT_CATEGORIES) {
    const records = rawInventory && rawInventory[category];
    if (!Array.isArray(records)) {
      fail('POST_CONTRACT_INVENTORY_INVALID', 'The raw seven-category post-contract inventory was malformed.');
    }
    contract[category] = records.map(record => {
      if (!record || !clean(record.key) || !record.value || typeof record.value !== 'object') {
        fail('POST_CONTRACT_INVENTORY_INVALID', 'The raw seven-category post-contract inventory was malformed.');
      }
      let value = record.value;
      if (category === 'functions') {
        value = semanticAclValue(value, 'effective_grants', 'default_owner_grants');
        value = { ...value, definition: normalizeFunctionSource(value.definition) };
      } else if (category === 'table_boundaries') {
        value = semanticAclValue(value, 'effective_grants', 'default_owner_grants');
      } else if (category === 'function_execute_grants') {
        value = semanticAclValue(
          value,
          'effective_execute_grants',
          'default_owner_execute_grants',
        );
      }
      return { key: record.key, value };
    });
  }
  return contract;
}

function postContract(parsed) {
  const rawInventory = rawPostInventory(parsed);
  const contract = normalizePostInventory(rawInventory);
  const bytes = Buffer.from(stableJson(contract), 'utf8');
  return {
    rawInventory,
    contract,
    bytes,
    sha256: sha256(bytes),
  };
}

function postContractInventoryEnvelope(parsed, release, contract) {
  return {
    format: RAW_POST_INVENTORY_FORMAT,
    release_sha: release.headSha,
    migration_sha256: release.migrationSha256,
    database_server_version: clean(parsed.metadata && parsed.metadata.server_version),
    database_server_version_num: clean(parsed.metadata && parsed.metadata.server_version_num),
    normalized_post_contract_sha256: contract.sha256,
    inventory: contract.rawInventory,
  };
}

function validateRawPostInventoryShape(inventory) {
  const expectedKeys = ['format', ...POST_CONTRACT_CATEGORIES.map(([category]) => category)].sort();
  if (!inventory || typeof inventory !== 'object'
      || inventory.format !== RAW_POST_INVENTORY_FORMAT
      || Object.keys(inventory).sort().join(',') !== expectedKeys.join(',')) {
    fail('POST_CONTRACT_INVENTORY_INVALID', 'The raw seven-category post-contract inventory was malformed.');
  }
  const expectedCounts = {
    columns: 2,
    constraints: F27_CONSTRAINT_NAMES.length,
    triggers: 1,
    functions: F27_FUNCTION_NAMES.length,
    indexes: 1,
    table_boundaries: F27_TABLE_NAMES.length,
    function_execute_grants: F27_EXECUTE_FUNCTION_IDENTITIES.length,
  };
  for (const [category] of POST_CONTRACT_CATEGORIES) {
    const records = inventory[category];
    if (!Array.isArray(records) || records.length !== expectedCounts[category]
        || new Set(records.map(record => clean(record && record.key))).size !== records.length
        || records.some(record => !record || !clean(record.key)
          || !record.value || typeof record.value !== 'object' || Array.isArray(record.value))) {
      fail('POST_CONTRACT_INVENTORY_INVALID', 'The raw seven-category post-contract inventory was malformed.');
    }
  }
}

function validatePostContractInventoryEnvelope(bytes, expected = {}) {
  let envelope;
  try { envelope = JSON.parse(bytes); }
  catch (_) {
    fail('POST_CONTRACT_INVENTORY_INVALID', 'The private expected post-contract inventory was malformed.');
  }
  if (!envelope || envelope.format !== RAW_POST_INVENTORY_FORMAT
      || stableJson(envelope) !== bytes.toString('utf8')
      || envelope.release_sha !== expected.releaseSha
      || envelope.migration_sha256 !== expected.migrationSha256
      || !clean(envelope.database_server_version)
      || !/^\d+$/.test(clean(envelope.database_server_version_num))
      || Math.trunc(Number(envelope.database_server_version_num) / 10000) !== 17
      || !HASH_RE.test(clean(envelope.normalized_post_contract_sha256))) {
    fail('POST_CONTRACT_INVENTORY_INVALID', 'The private expected post-contract inventory binding was malformed.');
  }
  validateRawPostInventoryShape(envelope.inventory);
  const normalized = normalizePostInventory(envelope.inventory);
  const normalizedBytes = Buffer.from(stableJson(normalized), 'utf8');
  const normalizedSha256 = sha256(normalizedBytes);
  if (normalizedSha256 !== envelope.normalized_post_contract_sha256
      || normalizedSha256 !== expected.normalizedSha256) {
    fail('POST_CONTRACT_INVENTORY_HASH_MISMATCH', 'The expected raw inventory did not bind the normalized post-contract SHA-256.');
  }
  return { envelope, normalized, normalizedBytes, normalizedSha256 };
}

function assertPrivatePostContractInventory(
  inventoryPath,
  expectedSha256,
  expectedByteLength,
  worktreeRoots,
  privacyOptions = {},
) {
  if (!inventoryPath || !path.isAbsolute(inventoryPath)
      || !HASH_RE.test(clean(expectedSha256))
      || !/^[1-9]\d*$/.test(clean(expectedByteLength))
      || !Number.isSafeInteger(Number(expectedByteLength))) {
    fail('POST_CONTRACT_INVENTORY_INPUT_INVALID', 'An absolute private expected inventory with exact hash and byte length is required.');
  }
  const resolved = path.resolve(inventoryPath);
  assertNoSymlinkComponents(resolved);
  for (const root of worktreeRoots) {
    if (isWithin(root, resolved)) {
      fail('WORKTREE_PATH_REJECTED', 'The private expected inventory must be outside every Git worktree.');
    }
  }
  const containing = containingGitWorktree(resolved);
  if (containing && isWithin(containing, resolved)) {
    fail('WORKTREE_PATH_REJECTED', 'The private expected inventory must be outside every Git worktree.');
  }
  const stat = lstatOrNull(resolved);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
    fail('POST_CONTRACT_INVENTORY_INPUT_INVALID', 'The private expected inventory must be a regular file.');
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    fail('PRIVATE_PERMISSIONS_REQUIRED', 'The private expected inventory must not grant group or other access.');
  }
  assertWindowsPrivateFileAcl(resolved, privacyOptions);
  let bytes;
  try { bytes = fs.readFileSync(resolved); }
  catch (_) {
    fail('POST_CONTRACT_INVENTORY_READ_FAILED', 'The private expected inventory could not be read safely.');
  }
  if (bytes.length !== Number(expectedByteLength) || sha256(bytes) !== clean(expectedSha256)) {
    fail('POST_CONTRACT_INVENTORY_HASH_MISMATCH', 'The private expected inventory hash or byte length did not match.');
  }
  return { path: resolved, bytes };
}

function writePrivatePostContractInventory(outputDir, bytes, privacyOptions = {}) {
  const digest = sha256(bytes);
  const target = path.join(outputDir, `f27-post-contract-expected-${digest}.inventory.json`);
  let written = false;
  try {
    fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
    written = true;
    fs.chmodSync(target, 0o400);
    assertWindowsPrivateFileAcl(target, privacyOptions);
    const readback = fs.readFileSync(target);
    if (readback.length !== bytes.length || sha256(readback) !== digest || !readback.equals(bytes)) {
      throw new Error('post-contract inventory readback mismatch');
    }
    return { target, sha256: digest, byteLength: bytes.length };
  } catch (_) {
    if (written) {
      try { fs.chmodSync(target, 0o600); fs.unlinkSync(target); } catch (_) { /* exact incomplete artifact only */ }
    }
    fail('POST_CONTRACT_INVENTORY_WRITE_FAILED', 'The private expected post-contract inventory could not be written and read back exactly.');
  }
}

function writePostContractMismatchEvidence(
  outputDir,
  expectedBytes,
  observedBytes,
  privacyOptions = {},
) {
  const expectedSha256 = sha256(expectedBytes);
  const observedSha256 = sha256(observedBytes);
  const entries = [
    [`f27-post-contract-expected-raw-${expectedSha256}.json`, expectedBytes],
    [`f27-post-contract-observed-raw-${observedSha256}.json`, observedBytes],
  ];
  const written = [];
  try {
    for (const [name, bytes] of entries) {
      const target = path.join(outputDir, name);
      fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
      written.push(target);
    }
    for (const target of written) fs.chmodSync(target, 0o400);
    for (let index = 0; index < entries.length; index += 1) {
      const target = written[index];
      const bytes = entries[index][1];
      assertWindowsPrivateFileAcl(target, privacyOptions);
      const readback = fs.readFileSync(target);
      if (readback.length !== bytes.length || sha256(readback) !== sha256(bytes)
          || !readback.equals(bytes)) {
        throw new Error('post-contract mismatch evidence readback mismatch');
      }
    }
    return {
      private_contract_evidence: 'PASS',
      expected_raw_inventory_sha256: expectedSha256,
      expected_raw_inventory_byte_length: expectedBytes.length,
      observed_raw_inventory_sha256: observedSha256,
      observed_raw_inventory_byte_length: observedBytes.length,
    };
  } catch (_) {
    for (const target of written.reverse()) {
      try { fs.chmodSync(target, 0o600); fs.unlinkSync(target); } catch (_) { /* exact incomplete evidence only */ }
    }
    fail('POST_CONTRACT_EVIDENCE_WRITE_FAILED', 'Both private raw post-contract inventories could not be durably retained.');
  }
}

function validatePostContractEvidenceReceipt(
  receipt,
  outputDir,
  expectedBytes,
  observedBytes,
  privacyOptions = {},
) {
  const expectedKeys = [
    'private_contract_evidence',
    'expected_raw_inventory_sha256',
    'expected_raw_inventory_byte_length',
    'observed_raw_inventory_sha256',
    'observed_raw_inventory_byte_length',
  ].sort();
  const expectedSha256 = sha256(expectedBytes);
  const observedSha256 = sha256(observedBytes);
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
      || Object.keys(receipt).sort().join(',') !== expectedKeys.join(',')
      || receipt.private_contract_evidence !== 'PASS'
      || receipt.expected_raw_inventory_sha256 !== expectedSha256
      || receipt.expected_raw_inventory_byte_length !== expectedBytes.length
      || receipt.observed_raw_inventory_sha256 !== observedSha256
      || receipt.observed_raw_inventory_byte_length !== observedBytes.length) {
    fail('POST_CONTRACT_EVIDENCE_WRITE_FAILED', 'Both private raw post-contract inventories could not be durably retained.');
  }
  const expectedFiles = [
    [`f27-post-contract-expected-raw-${expectedSha256}.json`, expectedBytes],
    [`f27-post-contract-observed-raw-${observedSha256}.json`, observedBytes],
  ];
  let durable = false;
  try {
    const names = fs.readdirSync(outputDir).sort();
    durable = names.join(',') === expectedFiles.map(([name]) => name).sort().join(',')
      && expectedFiles.every(([name, bytes]) => {
        const target = path.join(outputDir, name);
        const stat = fs.lstatSync(target);
        if (!stat.isFile() || stat.isSymbolicLink()
            || (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o400)) return false;
        assertWindowsPrivateFileAcl(target, privacyOptions);
        const readback = fs.readFileSync(target);
        return readback.length === bytes.length && sha256(readback) === sha256(bytes)
          && readback.equals(bytes);
      });
  } catch (_) { durable = false; }
  if (!durable) {
    fail('POST_CONTRACT_EVIDENCE_WRITE_FAILED', 'Both private raw post-contract inventories could not be durably retained.');
  }
  return receipt;
}

function assertPrivateBundle(bundlePath, expectedSha256, worktreeRoots, privacyOptions = {}) {
  if (!bundlePath || !path.isAbsolute(bundlePath) || !HASH_RE.test(clean(expectedSha256))) {
    fail('PRIVATE_BUNDLE_INPUT_INVALID', 'An absolute private bundle and its exact SHA-256 are required.');
  }
  const resolved = path.resolve(bundlePath);
  assertNoSymlinkComponents(resolved);
  for (const root of worktreeRoots) {
    if (isWithin(root, resolved)) fail('WORKTREE_PATH_REJECTED', 'The private bundle must be outside every Git worktree.');
  }
  const containing = containingGitWorktree(resolved);
  if (containing && isWithin(containing, resolved)) fail('WORKTREE_PATH_REJECTED', 'The private bundle must be outside every Git worktree.');
  const stat = lstatOrNull(resolved);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) fail('PRIVATE_BUNDLE_INPUT_INVALID', 'The private bundle must be a regular file.');
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    fail('PRIVATE_PERMISSIONS_REQUIRED', 'The private bundle must not grant group or other access.');
  }
  assertWindowsPrivateFileAcl(resolved, privacyOptions);
  let bytes;
  try { bytes = fs.readFileSync(resolved); } catch (_) { fail('PRIVATE_BUNDLE_READ_FAILED', 'The private bundle could not be read safely.'); }
  if (sha256(bytes) !== expectedSha256) fail('PRIVATE_BUNDLE_HASH_MISMATCH', 'The private bundle SHA-256 did not match.');
  let bundle;
  let manifestBytes;
  let manifest;
  try {
    bundle = JSON.parse(bytes);
    manifestBytes = Buffer.from(bundle.manifest_base64, 'base64');
    manifest = JSON.parse(manifestBytes);
  } catch (_) {
    fail('PRIVATE_BUNDLE_MALFORMED', 'The private bundle or manifest was malformed.');
  }
  if (!bundle || bundle.format !== `${FORMAT}-bundle` || !manifest
      || bundle.manifest_sha256 !== sha256(manifestBytes)
      || bundle.manifest_sha256 !== clean(bundle.manifest_sha256)
      || !Array.isArray(bundle.files) || !Array.isArray(manifest.files)
      || bundle.files.length !== manifest.files.length) {
    fail('PRIVATE_BUNDLE_MALFORMED', 'The private bundle manifest binding was incomplete.');
  }
  const files = new Map();
  for (let index = 0; index < manifest.files.length; index += 1) {
    const entry = manifest.files[index];
    const bundled = bundle.files[index];
    if (!entry || !bundled || entry.path !== bundled.path || files.has(entry.path)
        || !/^[a-z0-9_.\/-]+$/.test(entry.path) || path.posix.isAbsolute(entry.path)
        || entry.path.split('/').some(segment => segment === '..')) {
      fail('PRIVATE_BUNDLE_MALFORMED', 'The private bundle file inventory was unsafe or duplicated.');
    }
    let content;
    try { content = Buffer.from(bundled.content_base64, 'base64'); } catch (_) { fail('PRIVATE_BUNDLE_MALFORMED', 'A private bundle member was malformed.'); }
    if (content.length !== Number(entry.byte_length) || content.length !== Number(bundled.byte_length)
        || sha256(content) !== entry.sha256 || sha256(content) !== bundled.sha256) {
      fail('PRIVATE_BUNDLE_HASH_MISMATCH', 'A private bundle member failed byte-length or SHA-256 verification.');
    }
    files.set(entry.path, content);
  }
  for (const required of [
    'database/mirror_outbox.rows.jsonl',
    'database/mirror_outbox.preinstall-column-projection.json',
    'database/pre-f27-baseline.json',
    'database/runtime-safety-state.json',
    'metadata/snapshot.json',
  ]) {
    if (!files.has(required)) fail('PRIVATE_BUNDLE_INCOMPLETE', 'The private bundle lacked a required pre-install proof member.');
  }
  return { bytes, bundle, manifest, files };
}

function sectionJsonl(records) {
  return Buffer.from(records.map(record => record.raw).join(records.length ? '\n' : '') + (records.length ? '\n' : ''), 'utf8');
}

function buildFiles(parsed, localMetadata) {
  const files = new Map();
  files.set('database/mirror_outbox.rows.jsonl', sectionJsonl(parsed.rows));
  files.set('database/mirror_outbox.preinstall-column-projection.json', Buffer.from(stableJson(parsed.columnNames), 'utf8'));
  files.set('database/pre-f27-baseline.json', Buffer.from(stableJson(parsed.preF27Baseline), 'utf8'));
  for (const section of ['table', 'columns', 'constraints', 'triggers', 'functions', 'indexes', 'policies', 'grants']) {
    files.set(`database/mirror_outbox.${section}.jsonl`, sectionJsonl(parsed.sections.get(section) || []));
  }
  const safeProof = {
    row_count: parsed.rows.length,
    non_terminal_row_count: parsed.aggregates.reduce((count, record) =>
      count + (TERMINAL_STATUSES.has(record.value.status) ? 0 : Number(record.value.count)), 0),
    aggregates: parsed.aggregates.map(record => record.value),
    newest: parsed.newest.map(record => ({
      rank: Number(record.value.rank),
      team: record.value.team,
      status: record.value.status,
      time: record.value.time,
      private_row_sha256: sha256(Buffer.from(record.value.private_row, 'utf8')),
    })),
  };
  files.set('database/mirror_outbox.public-safe-proof.json', Buffer.from(stableJson(safeProof), 'utf8'));
  files.set('database/runtime-safety-state.json', Buffer.from(stableJson({
    flags: parsed.runtimeSafety.flags,
    flag_flips_count: parsed.runtimeSafety.flagFlipsCount,
  }), 'utf8'));
  files.set('metadata/snapshot.json', Buffer.from(stableJson({
    format: FORMAT,
    tool_release: TOOL_RELEASE,
    node_version: process.version,
    psql_version: localMetadata.psqlVersion,
    release_sha: localMetadata.releaseSha,
    migration_path: MIGRATION_RELATIVE_PATH,
    migration_sha256: localMetadata.migrationSha256,
    project_ref: localMetadata.projectRef,
    database: localMetadata.database,
    database_server_version: parsed.metadata.server_version,
    database_server_version_num: parsed.metadata.server_version_num,
    snapshot_time: parsed.metadata.snapshot_time,
    transaction_isolation: parsed.metadata.transaction_isolation,
    transaction_read_only: parsed.metadata.transaction_read_only,
    primary_key_columns: parsed.metadata.primary_key_columns,
  }), 'utf8'));
  return { files, safeProof, runtimeSafety: parsed.runtimeSafety };
}

function sealBundle(files, metadata) {
  const entries = [...files.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([relativePath, bytes]) => ({
    path: relativePath.replace(/\\/g, '/'),
    byte_length: bytes.length,
    sha256: sha256(bytes),
  }));
  if (!entries.length || new Set(entries.map(entry => entry.path)).size !== entries.length) {
    fail('MANIFEST_INVALID', 'The private manifest inventory was empty or duplicated.');
  }
  const manifestBytes = Buffer.from(stableJson({
    format: `${FORMAT}-manifest`,
    snapshot_time: metadata.snapshot_time,
    files: entries,
  }), 'utf8');
  const manifestSha256 = sha256(manifestBytes);
  const bundleBytes = Buffer.from(stableJson({
    format: `${FORMAT}-bundle`,
    manifest_sha256: manifestSha256,
    manifest_base64: manifestBytes.toString('base64'),
    files: entries.map(entry => ({
      path: entry.path,
      byte_length: entry.byte_length,
      sha256: entry.sha256,
      content_base64: files.get(entry.path).toString('base64'),
    })),
  }), 'utf8');
  return { entries, manifestBytes, manifestSha256, bundleBytes, bundleSha256: sha256(bundleBytes) };
}

function writePrivateFiles(outputDir, files, sealed) {
  const written = [];
  try {
    for (const [relativePath, bytes] of [...files.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      const target = path.join(outputDir, ...relativePath.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
      written.push(target);
    }
    const manifestTarget = path.join(outputDir, 'manifest.json');
    fs.writeFileSync(manifestTarget, sealed.manifestBytes, { flag: 'wx', mode: 0o600 });
    written.push(manifestTarget);
    const bundleTarget = path.join(outputDir, `f27-mirror-outbox-${sealed.bundleSha256}.snapshot`);
    fs.writeFileSync(bundleTarget, sealed.bundleBytes, { flag: 'wx', mode: 0o600 });
    written.push(bundleTarget);
    for (const target of written) fs.chmodSync(target, 0o400);
    return bundleTarget;
  } catch (_) {
    for (const target of written.reverse()) {
      try { fs.chmodSync(target, 0o600); fs.unlinkSync(target); } catch (_) { /* exact incomplete capture only */ }
    }
    fail('PRIVATE_WRITE_FAILED', 'The sealed private snapshot could not be written atomically.');
  }
}

function captureSnapshot(options) {
  if (!options || options.confirmed !== true) {
    fail('CONFIRMATION_REQUIRED', 'Explicit mirror_outbox snapshot confirmation is required.');
  }
  const projectRef = clean(options.projectRef);
  const database = clean(options.database);
  const connectionEnv = parseDatabaseUrl(options.databaseUrl, projectRef, database);
  const release = assertRelease(options);
  const worktreeRoots = options.worktreeRoots || discoverRegisteredWorktrees(options.repoRoot || REPO_ROOT);
  const outputDir = assertPrivateEmptyOutput(options.outputDir, worktreeRoots);
  const privacyOptions = {
    aclPlatform: options.aclPlatform,
    privateAclAdapter: options.privateAclAdapter,
  };
  protectWindowsPrivateDirectory(outputDir, privacyOptions);
  const adapter = options.psqlAdapter || defaultPsqlAdapter(options.psqlPath || 'psql');
  const psqlVersion = clean(adapter.version());
  if (!/^psql \(PostgreSQL\) \d+(?:\.\d+)+/.test(psqlVersion)) {
    fail('PSQL_VERSION_FAILED', 'The psql version response was malformed.');
  }
  let transcript;
  try {
    transcript = adapter.capture(sqlText(), connectionEnv);
  } catch (error) {
    if (error instanceof SnapshotCaptureError) throw error;
    fail('PSQL_CAPTURE_FAILED', 'The read-only psql snapshot transaction failed closed.');
  }
  const parsed = parseTranscript(transcript, database);
  const built = buildFiles(parsed, {
    psqlVersion,
    releaseSha: release.headSha,
    migrationSha256: release.migrationSha256,
    projectRef,
    database,
  });
  const sealed = sealBundle(built.files, parsed.metadata);
  const bundleTarget = writePrivateFiles(outputDir, built.files, sealed);
  assertWindowsPrivateFileAcl(bundleTarget, privacyOptions);
  const readback = fs.readFileSync(bundleTarget);
  if (readback.length !== sealed.bundleBytes.length || sha256(readback) !== sealed.bundleSha256) {
    fail('LOCAL_READBACK_MISMATCH', 'The local sealed bundle did not pass an independent byte readback.');
  }
  const hashes = Object.fromEntries(sealed.entries.map(entry => [entry.path, entry.sha256]));
  return {
    status: 'PASS',
    snapshot_manifest_sha256: sealed.manifestSha256,
    snapshot_bundle_sha256: sealed.bundleSha256,
    mirror_outbox_row_count: built.safeProof.row_count,
    mirror_outbox_non_terminal_row_count: built.safeProof.non_terminal_row_count,
    pre_f27_baseline: 'PASS',
    pre_f27_entry_state: parsed.preF27Baseline.entry_state,
    preserved_fence_generations_sha256: sha256(Buffer.from(
      stableJson(parsed.preF27Baseline.fence_generations), 'utf8',
    )),
    retained_audit_sha256: parsed.preF27Baseline.audit_state_sha256,
    runtime_flags: built.runtimeSafety.flags,
    flag_flips_count: built.runtimeSafety.flagFlipsCount,
    runtime_safety_state_sha256: hashes['database/runtime-safety-state.json'],
    pre_f27_baseline_sha256: hashes['database/pre-f27-baseline.json'],
    newest_public_safe_rows: built.safeProof.newest,
    newest_public_safe_aggregates: built.safeProof.aggregates,
    constraint_definition_sha256: hashes['database/mirror_outbox.constraints.jsonl'],
    trigger_definition_sha256: hashes['database/mirror_outbox.triggers.jsonl'],
    dependent_function_closure_sha256: hashes['database/mirror_outbox.functions.jsonl'],
    table_boundary_definition_sha256: sha256(Buffer.from(stableJson({
      table: hashes['database/mirror_outbox.table.jsonl'],
      columns: hashes['database/mirror_outbox.columns.jsonl'],
      projection: hashes['database/mirror_outbox.preinstall-column-projection.json'],
      constraints: hashes['database/mirror_outbox.constraints.jsonl'],
      triggers: hashes['database/mirror_outbox.triggers.jsonl'],
      functions: hashes['database/mirror_outbox.functions.jsonl'],
      indexes: hashes['database/mirror_outbox.indexes.jsonl'],
      policies: hashes['database/mirror_outbox.policies.jsonl'],
      grants: hashes['database/mirror_outbox.grants.jsonl'],
    }), 'utf8')),
    local_private_readback: 'PASS',
  };
}

function windowPPreflight(options) {
  if (!options || options.confirmed !== true) {
    fail('WINDOW_P_CONFIRMATION_REQUIRED', 'Explicit read-only Window P preflight confirmation is required.');
  }
  const projectRef = clean(options.projectRef);
  const database = clean(options.database);
  const connectionEnv = parseDatabaseUrl(options.databaseUrl, projectRef, database);
  const release = assertRelease(options);
  const adapter = options.psqlAdapter || defaultPsqlAdapter(options.psqlPath || 'psql');
  const psqlVersion = clean(adapter.version());
  if (!/^psql \(PostgreSQL\) \d+(?:\.\d+)+/.test(psqlVersion)) {
    fail('PSQL_VERSION_FAILED', 'The psql version response was malformed.');
  }
  let transcript;
  try {
    transcript = adapter.capture(windowPPreflightSqlText(), connectionEnv);
  } catch (error) {
    if (error instanceof SnapshotCaptureError) throw error;
    fail('PSQL_CAPTURE_FAILED', 'The read-only Window P preflight transaction failed closed.');
  }
  const parsed = parseWindowPPreflightTranscript(transcript, database);
  const runtimeSafetyBytes = Buffer.from(stableJson({
    flags: parsed.runtimeSafety.flags,
    flag_flips_count: parsed.runtimeSafety.flagFlipsCount,
  }), 'utf8');
  return {
    status: 'PASS',
    mode: 'window_p_preflight_read_only',
    release_sha: release.headSha,
    migration_sha256: release.migrationSha256,
    psql_version: psqlVersion,
    pre_f27_baseline: 'PASS',
    pre_f27_entry_state: parsed.preF27Baseline.entry_state,
    preserved_fence_generations_sha256: sha256(Buffer.from(
      stableJson(parsed.preF27Baseline.fence_generations), 'utf8',
    )),
    retained_audit_sha256: parsed.preF27Baseline.audit_state_sha256,
    pre_f27_baseline_sha256: sha256(Buffer.from(stableJson(parsed.preF27Baseline), 'utf8')),
    runtime_flags: parsed.runtimeSafety.flags,
    flag_flips_count: parsed.runtimeSafety.flagFlipsCount,
    runtime_safety_state_sha256: sha256(runtimeSafetyBytes),
    mirror_outbox_row_count: parsed.rowCount,
    mirror_outbox_non_terminal_row_count: parsed.nonTerminalRowCount,
    network_mutation_calls: 0,
  };
}

function verifyAfter(options) {
  if (!options || options.confirmed !== true) {
    fail('VERIFY_CONFIRMATION_REQUIRED', 'Explicit post-migration readback confirmation is required.');
  }
  const projectRef = clean(options.projectRef);
  const database = clean(options.database);
  const expectedContractSha256 = clean(options.expectedPostContractSha256);
  if (!HASH_RE.test(expectedContractSha256)) {
    fail('POST_CONTRACT_HASH_REQUIRED', 'The disposable-source post-contract SHA-256 is required.');
  }
  const connectionEnv = parseDatabaseUrl(options.databaseUrl, projectRef, database);
  const release = assertRelease(options);
  const worktreeRoots = options.worktreeRoots || discoverRegisteredWorktrees(options.repoRoot || REPO_ROOT);
  const privacyOptions = {
    aclPlatform: options.aclPlatform,
    privateAclAdapter: options.privateAclAdapter,
  };
  const privateBundle = assertPrivateBundle(
    options.bundlePath,
    clean(options.expectedBundleSha256),
    worktreeRoots,
    privacyOptions,
  );
  const expectedInventoryInput = assertPrivatePostContractInventory(
    options.expectedPostContractInventoryPath,
    clean(options.expectedPostContractInventorySha256),
    options.expectedPostContractInventoryByteLength,
    worktreeRoots,
    privacyOptions,
  );
  const evidenceOutputDir = assertPrivateEmptyOutput(options.outputDir, worktreeRoots);
  protectWindowsPrivateDirectory(evidenceOutputDir, privacyOptions);
  const expectedInventory = validatePostContractInventoryEnvelope(
    expectedInventoryInput.bytes,
    {
      releaseSha: release.headSha,
      migrationSha256: release.migrationSha256,
      normalizedSha256: expectedContractSha256,
    },
  );
  let projection;
  let snapshotMetadata;
  let baselineRuntimeSafety;
  let baselinePreF27;
  try {
    projection = JSON.parse(privateBundle.files.get('database/mirror_outbox.preinstall-column-projection.json'));
    snapshotMetadata = JSON.parse(privateBundle.files.get('metadata/snapshot.json'));
    baselineRuntimeSafety = JSON.parse(privateBundle.files.get('database/runtime-safety-state.json'));
    baselinePreF27 = validateSealedPreF27Baseline(JSON.parse(
      privateBundle.files.get('database/pre-f27-baseline.json'),
    ));
  } catch (_) {
    fail('PRIVATE_BUNDLE_MALFORMED', 'The captured projection, baseline, or metadata member was malformed.');
  }
  if (!snapshotMetadata || snapshotMetadata.release_sha !== release.headSha
      || snapshotMetadata.migration_sha256 !== release.migrationSha256
      || snapshotMetadata.project_ref !== projectRef || snapshotMetadata.database !== database) {
    fail('PRIVATE_BUNDLE_RELEASE_MISMATCH', 'The private baseline was not bound to this exact release/project/database.');
  }
  const adapter = options.psqlAdapter || defaultPsqlAdapter(options.psqlPath || 'psql');
  const psqlVersion = clean(adapter.version());
  if (!/^psql \(PostgreSQL\) \d+(?:\.\d+)+/.test(psqlVersion)) {
    fail('PSQL_VERSION_FAILED', 'The psql version response was malformed.');
  }
  let transcript;
  try { transcript = adapter.capture(verifyAfterSql(projection, true), connectionEnv); }
  catch (error) {
    if (error instanceof SnapshotCaptureError) throw error;
    fail('POST_PSQL_CAPTURE_FAILED', 'The post-migration read-only transaction failed closed.');
  }
  const parsed = parsePostTranscript(transcript, database, true);
  const postAuditState = stableValue({
    audit_state_sha256: parsed.state.audit_state_sha256,
    fence_generations: parsed.state.fence_generations,
    intent_row_count: Number(parsed.state.intent_count),
    rollback_row_count: Number(parsed.state.rollback_count),
  });
  const baselineAuditState = stableValue({
    audit_state_sha256: baselinePreF27.audit_state_sha256,
    fence_generations: baselinePreF27.fence_generations,
    intent_row_count: baselinePreF27.intent_row_count,
    rollback_row_count: baselinePreF27.rollback_row_count,
  });
  if (JSON.stringify(postAuditState) !== JSON.stringify(baselineAuditState)) {
    fail('F27_POST_STATE_INVALID', 'F27 generation fences or retained terminal audit changed across installation.');
  }
  const baselineSafety = validateRuntimeSafety(baselineRuntimeSafety, 'PRIVATE_BUNDLE_RUNTIME_SAFETY_INVALID');
  if (JSON.stringify(stableValue(parsed.runtimeSafety.flags)) !== JSON.stringify(stableValue(baselineSafety.flags))
      || parsed.runtimeSafety.flagFlipsCount !== baselineSafety.flagFlipsCount) {
    fail('RUNTIME_SAFETY_DRIFT', 'Authority, outbound, parity, or flag-flip state changed across the migration window.');
  }
  const postRows = sectionJsonl(parsed.sections.get('post_rows') || []);
  const preRows = privateBundle.files.get('database/mirror_outbox.rows.jsonl');
  if (postRows.length !== preRows.length || sha256(postRows) !== sha256(preRows)
      || (parsed.sections.get('post_rows') || []).length !== (preRows.length ? preRows.toString('utf8').trimEnd().split('\n').length : 0)) {
    fail('PREEXISTING_ROWS_CHANGED', 'Pre-existing rows changed when projected through the captured old-column list.');
  }
  const contract = postContract(parsed);
  if (contract.sha256 !== expectedContractSha256) {
    const observedEnvelope = postContractInventoryEnvelope(parsed, release, contract);
    const observedBytes = Buffer.from(stableJson(observedEnvelope), 'utf8');
    let evidence;
    try {
      evidence = validatePostContractEvidenceReceipt(
        (options.postContractEvidenceWriter || writePostContractMismatchEvidence)(
          evidenceOutputDir,
          expectedInventoryInput.bytes,
          observedBytes,
          privacyOptions,
        ),
        evidenceOutputDir,
        expectedInventoryInput.bytes,
        observedBytes,
        privacyOptions,
      );
    } catch (_) {
      fail('POST_CONTRACT_EVIDENCE_WRITE_FAILED', 'Both private raw post-contract inventories could not be durably retained.');
    }
    fail(
      'POST_CONTRACT_MISMATCH',
      'The installed F27 schema, function, table-security, or execute-grant contract did not match exact source.',
      {
        ...evidence,
        expected_post_contract_sha256: expectedInventory.normalizedSha256,
        observed_post_contract_sha256: contract.sha256,
      },
    );
  }
  return {
    status: 'PASS',
    mirror_outbox_row_count_preserved: (parsed.sections.get('post_rows') || []).length,
    preexisting_projection_sha256: sha256(postRows),
    residual_synthetic_probe_count: 0,
    runtime_flags: parsed.runtimeSafety.flags,
    flag_flips_count_delta: parsed.runtimeSafety.flagFlipsCount - baselineSafety.flagFlipsCount,
    f27_fence_generation_invariants: 'PASS',
    f27_no_open_or_unresolved_work: 'PASS',
    f27_baseline_state_preserved: 'PASS',
    f27_table_security_boundaries: 'PASS',
    f27_function_execute_grants: 'PASS',
    f27_post_contract_sha256: contract.sha256,
    transaction: 'repeatable_read_read_only',
  };
}

function fingerprintPost(options) {
  if (!options || options.confirmed !== true) {
    fail('DISPOSABLE_CONFIRMATION_REQUIRED', 'Explicit disposable post-contract confirmation is required.');
  }
  const database = clean(options.database);
  const connectionEnv = parseDisposableDatabaseUrl(options.databaseUrl, database);
  const release = assertRelease(options);
  const worktreeRoots = options.worktreeRoots || discoverRegisteredWorktrees(options.repoRoot || REPO_ROOT);
  const outputDir = assertPrivateEmptyOutput(options.outputDir, worktreeRoots);
  const privacyOptions = {
    aclPlatform: options.aclPlatform,
    privateAclAdapter: options.privateAclAdapter,
  };
  protectWindowsPrivateDirectory(outputDir, privacyOptions);
  const adapter = options.psqlAdapter || defaultPsqlAdapter(options.psqlPath || 'psql');
  const psqlVersion = clean(adapter.version());
  if (!/^psql \(PostgreSQL\) \d+(?:\.\d+)+/.test(psqlVersion)) {
    fail('PSQL_VERSION_FAILED', 'The psql version response was malformed.');
  }
  let transcript;
  try { transcript = adapter.capture(verifyAfterSql(['id'], false), connectionEnv); }
  catch (error) {
    if (error instanceof SnapshotCaptureError) throw error;
    fail('POST_PSQL_CAPTURE_FAILED', 'The disposable post-contract read-only transaction failed closed.');
  }
  const parsed = parsePostTranscript(transcript, database, false);
  if (Math.trunc(Number(parsed.metadata.server_version_num) / 10000) !== 17) {
    fail('POSTGRESQL_17_REQUIRED', 'Disposable post-contract fingerprinting requires PostgreSQL major 17.');
  }
  const contract = postContract(parsed);
  const envelope = postContractInventoryEnvelope(parsed, release, contract);
  const inventoryBytes = Buffer.from(stableJson(envelope), 'utf8');
  const inventoryReceipt = writePrivatePostContractInventory(
    outputDir,
    inventoryBytes,
    privacyOptions,
  );
  return {
    status: 'PASS',
    f27_post_contract_sha256: contract.sha256,
    post_contract_raw_inventory_sha256: inventoryReceipt.sha256,
    post_contract_raw_inventory_byte_length: inventoryReceipt.byteLength,
    local_private_readback: 'PASS',
    f27_table_security_boundaries: 'PASS',
    f27_function_execute_grants: 'PASS',
    release_sha: release.headSha,
    migration_sha256: release.migrationSha256,
    source: 'disposable_postgresql_read_only',
  };
}

function parseArgs(argv) {
  const accepted = new Set([
    '--mode', '--output-dir', '--bundle', '--expected-bundle-sha256',
    '--expected-post-contract-sha256', '--confirm-project-ref', '--confirm-database',
    '--expected-post-contract-inventory', '--expected-post-contract-inventory-sha256',
    '--expected-post-contract-inventory-byte-length', '--release-sha', '--psql',
  ]);
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!accepted.has(name) || Object.prototype.hasOwnProperty.call(values, name)) {
      fail('ARGUMENT_REJECTED', 'Only unique documented snapshot options are accepted.');
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail('ARGUMENT_REJECTED', 'Every snapshot option requires one value.');
    values[name] = value;
    index += 1;
  }
  const mode = values['--mode'] || 'capture';
  if (!['capture', 'window-p-preflight', 'verify-after', 'fingerprint-post'].includes(mode)) {
    fail('ARGUMENT_REJECTED', '--mode must be capture, window-p-preflight, verify-after, or fingerprint-post.');
  }
  for (const required of ['--confirm-database', '--release-sha']) {
    if (!values[required]) fail('ARGUMENT_REJECTED', 'All required snapshot options must be explicit.');
  }
  if (mode !== 'fingerprint-post' && !values['--confirm-project-ref']) {
    fail('ARGUMENT_REJECTED', 'Live capture/readback modes require an explicit project ref.');
  }
  if (mode === 'capture' && !values['--output-dir']) {
    fail('ARGUMENT_REJECTED', 'Capture mode requires --output-dir.');
  }
  if (mode === 'capture' && (values['--bundle'] || values['--expected-bundle-sha256']
      || values['--expected-post-contract-sha256'] || values['--expected-post-contract-inventory']
      || values['--expected-post-contract-inventory-sha256']
      || values['--expected-post-contract-inventory-byte-length'])) {
    fail('ARGUMENT_REJECTED', 'Capture mode rejects verify-after inputs.');
  }
  if (mode === 'verify-after' && (!values['--bundle'] || !values['--expected-bundle-sha256']
      || !values['--expected-post-contract-sha256'] || !values['--output-dir']
      || !values['--expected-post-contract-inventory']
      || !values['--expected-post-contract-inventory-sha256']
      || !values['--expected-post-contract-inventory-byte-length'])) {
    fail('ARGUMENT_REJECTED', 'Verify-after mode requires the private baseline, expected raw inventory, exact binders, and transcript directory.');
  }
  if (mode === 'window-p-preflight' && (values['--output-dir'] || values['--bundle']
      || values['--expected-bundle-sha256'] || values['--expected-post-contract-sha256']
      || values['--expected-post-contract-inventory']
      || values['--expected-post-contract-inventory-sha256']
      || values['--expected-post-contract-inventory-byte-length'])) {
    fail('ARGUMENT_REJECTED', 'Window P preflight is read-only and rejects private capture/readback inputs.');
  }
  if (mode === 'fingerprint-post' && (!values['--output-dir'] || values['--bundle']
      || values['--expected-bundle-sha256'] || values['--expected-post-contract-sha256']
      || values['--expected-post-contract-inventory']
      || values['--expected-post-contract-inventory-sha256']
      || values['--expected-post-contract-inventory-byte-length']
      || values['--confirm-project-ref'])) {
    fail('ARGUMENT_REJECTED', 'Disposable post-contract mode requires private output and rejects live-project or prior-artifact inputs.');
  }
  return {
    mode,
    outputDir: values['--output-dir'],
    bundlePath: values['--bundle'],
    expectedBundleSha256: values['--expected-bundle-sha256'],
    expectedPostContractSha256: values['--expected-post-contract-sha256'],
    expectedPostContractInventoryPath: values['--expected-post-contract-inventory'],
    expectedPostContractInventorySha256: values['--expected-post-contract-inventory-sha256'],
    expectedPostContractInventoryByteLength:
      values['--expected-post-contract-inventory-byte-length'],
    projectRef: values['--confirm-project-ref'],
    database: values['--confirm-database'],
    releaseSha: values['--release-sha'],
    psqlPath: values['--psql'] || 'psql',
  };
}

function publicFailure(error) {
  if (error instanceof SnapshotCaptureError) {
    const receiptValidators = {
      private_contract_evidence: value => value === 'PASS',
      expected_raw_inventory_sha256: value => HASH_RE.test(clean(value)),
      expected_raw_inventory_byte_length: value => Number.isSafeInteger(value) && value > 0,
      observed_raw_inventory_sha256: value => HASH_RE.test(clean(value)),
      observed_raw_inventory_byte_length: value => Number.isSafeInteger(value) && value > 0,
      expected_post_contract_sha256: value => HASH_RE.test(clean(value)),
      observed_post_contract_sha256: value => HASH_RE.test(clean(value)),
    };
    const receipt = error.publicSafeReceipt && typeof error.publicSafeReceipt === 'object'
      ? Object.entries(error.publicSafeReceipt).reduce((safe, [key, value]) => {
        if (receiptValidators[key] && receiptValidators[key](value)) safe[key] = value;
        return safe;
      }, {})
      : {};
    return {
      ...receipt,
      status: 'FAIL',
      code: error.code,
      message: error.message,
    };
  }
  return { status: 'FAIL', code: 'UNEXPECTED_FAILURE', message: 'The private mirror_outbox capture failed closed.' };
}

function runFromEnvironment(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const common = {
    ...args,
    databaseUrl: env.F27_DATABASE_URL,
  };
  if (args.mode === 'verify-after') {
    return verifyAfter({
      ...common,
      confirmed: clean(env.F27_CONFIRM_MIRROR_OUTBOX_VERIFY_AFTER) === '1',
    });
  }
  if (args.mode === 'fingerprint-post') {
    return fingerprintPost({
      ...args,
      databaseUrl: env.F27_DISPOSABLE_DATABASE_URL,
      confirmed: clean(env.F27_CONFIRM_DISPOSABLE_POST_CONTRACT) === '1',
    });
  }
  if (args.mode === 'window-p-preflight') {
    return windowPPreflight({
      ...common,
      confirmed: clean(env.F27_CONFIRM_WINDOW_P_PREFLIGHT) === '1',
    });
  }
  return captureSnapshot({
    ...common,
    confirmed: clean(env.F27_CONFIRM_MIRROR_OUTBOX_SNAPSHOT) === '1',
  });
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(runFromEnvironment())}${os.EOL}`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify(publicFailure(error))}${os.EOL}`);
    process.exitCode = 1;
  }
}

module.exports = {
  EXPECTED_WINDOW_P_RUNTIME_FLAGS,
  FORMAT,
  POST_CONTRACT_FORMAT,
  RAW_POST_INVENTORY_FORMAT,
  SnapshotCaptureError,
  WINDOWS_PRIVATE_ACL_FORMAT,
  assertPrivateBundle,
  assertPrivateEmptyOutput,
  assertPrivatePostContractInventory,
  assertWindowsPrivateAcl,
  assertWindowsPrivateFileAcl,
  buildFiles,
  captureSnapshot,
  defaultWindowsPrivateAclAdapter,
  expectedPreF27Baseline,
  expectedPostSection7Baseline,
  fingerprintPost,
  parseArgs,
  parseDatabaseUrl,
  parseDisposableDatabaseUrl,
  parseTranscript,
  parseWindowPPreflightTranscript,
  parsePostContractTranscript,
  parsePostTranscript,
  postContract,
  postSection7BaselineTranscriptValue,
  psqlCaptureFailure,
  publicFailure,
  protectWindowsPrivateDirectory,
  normalizeFunctionSource,
  normalizePostInventory,
  ownerGrantsMatchDefault,
  postContractInventoryEnvelope,
  rawPostInventory,
  reviewedFenceTableSqlGate,
  reviewedPreF27SubsetContract,
  reviewedPostSection7Contract,
  reviewedProductionAuthoritySource,
  reviewedWriteAuthorizationSource,
  sealBundle,
  retainedF27AuditInvariant,
  safePsqlEnvironment,
  sqlText,
  validatePreF27Baseline,
  verifyAfter,
  verifyAfterSql,
  validatePostContractInventoryEnvelope,
  validateSealedPreF27Baseline,
  writePostContractMismatchEvidence,
  windowPPreflight,
  windowPPreflightSqlText,
};
