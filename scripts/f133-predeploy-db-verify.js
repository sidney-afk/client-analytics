#!/usr/bin/env node
'use strict';

// Read-only compatibility gate for deploying the F133-aware closures before
// the additive database migration. It emits only the public-safe flag state
// and aggregate open-title-intent count.

const { spawnSync } = require('child_process');

const GATE = 'f133_predeploy_database_exact';
const SQL = String.raw`
begin isolation level repeatable read read only;
select jsonb_build_object(
  'transaction_exact', current_setting('transaction_isolation') = 'repeatable read'
    and current_setting('transaction_read_only') = 'on',
  'flag_state', case
    when not exists (
      select 1 from public.syncview_runtime_flags
      where key='f133_canonical_title_enabled'
    ) then 'absent'
    when (select count(*) from public.syncview_runtime_flags
          where key='f133_canonical_title_enabled') = 1
      and exists (
        select 1 from public.syncview_runtime_flags
        where key='f133_canonical_title_enabled'
          and value='{"enabled":false}'::jsonb
      ) then 'off'
    else 'invalid'
  end,
  'open_title_intent_count', (
    select count(*) from public.mirror_outbox
    where operation='title' and status in ('pending','failed','shadow_ok')
  )
);
commit;`;

function main(env = process.env, deps = {}) {
  const databaseUrl = String(env.F133_DATABASE_URL || '').trim();
  if (!databaseUrl) throw new Error('F133_DATABASE_URL_REQUIRED');
  const exec = deps.spawnSync || spawnSync;
  const command = env.PSQL_BIN || (process.platform === 'win32' ? 'psql.exe' : 'psql');
  const result = exec(command, [
    '--no-psqlrc', '--quiet', '--tuples-only', '--no-align',
    '--set=ON_ERROR_STOP=1', databaseUrl, '--command', SQL,
  ], { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
  if (!result || result.status !== 0) throw new Error('F133_PREDEPLOY_DATABASE_CHECK_FAILED');
  const lines = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  let observed;
  try { observed = JSON.parse(lines[lines.length - 1] || '{}'); }
  catch (_) { throw new Error('F133_PREDEPLOY_RECEIPT_INVALID'); }

  const exactKeys = ['flag_state', 'open_title_intent_count', 'transaction_exact'];
  const shapeExact = Object.keys(observed).sort().join(',') === exactKeys.sort().join(',');
  const flagState = ['absent', 'off', 'invalid'].includes(observed.flag_state)
    ? observed.flag_state : 'invalid';
  const openCount = Number.isSafeInteger(observed.open_title_intent_count)
    && observed.open_title_intent_count >= 0 ? observed.open_title_intent_count : -1;
  const pass = shapeExact && observed.transaction_exact === true
    && ['absent', 'off'].includes(flagState) && openCount === 0;
  const receipt = {
    status: pass ? 'PASS' : 'FAIL',
    gate: GATE,
    flag_state: flagState,
    open_title_intent_count: openCount,
    transaction: observed.transaction_exact === true ? 'PASS' : 'FAIL',
  };
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  if (!pass) process.exitCode = 1;
  return receipt;
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stdout.write(`${JSON.stringify({
      status: 'FAIL', gate: GATE,
      code: String(error && error.message || 'F133_PREDEPLOY_DATABASE_FAILED'),
    })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { GATE, SQL, main };
