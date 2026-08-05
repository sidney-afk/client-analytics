'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

(async () => {
  const contract = await import(pathToFileURL(path.join(
    __dirname, '..', 'supabase', 'functions', 'production-comments', 'read-contract.mjs',
  )).href);

  const thousand = Array.from({ length: 1_000 }, (_, index) => ({ id: `c-${index}` }));
  ok(contract.COMPLETE_THREAD_MAX_ROWS === 1_000, 'complete canonical thread keeps the existing 1000-row ceiling');
  ok(contract.completeThreadVerdict(1_000, thousand).ok === true, 'exact 1000-row thread is accepted');

  const overflow = contract.completeThreadVerdict(1_001, thousand);
  ok(overflow.ok === false && overflow.status === 409 && overflow.error === 'canonical_thread_overflow',
    '1001-row thread fails closed as overflow');

  const truncated = contract.completeThreadVerdict(2, [{ id: 'only-one' }]);
  ok(truncated.ok === false && truncated.status === 503 && truncated.error === 'canonical_thread_incomplete',
    'count and row mismatch fails closed');

  const duplicate = contract.completeThreadVerdict(2, [{ id: 'same' }, { id: 'same' }]);
  ok(duplicate.ok === false && duplicate.error === 'canonical_thread_incomplete',
    'duplicate stable IDs fail closed');

  const missing = contract.completeThreadVerdict(1, [{ id: '' }]);
  ok(missing.ok === false && missing.error === 'canonical_thread_incomplete',
    'missing stable ID fails closed');

  for (const malformedTotal of [null, false, '']) {
    const malformed = contract.completeThreadVerdict(malformedTotal, []);
    ok(malformed.ok === false && malformed.error === 'canonical_thread_incomplete',
      `non-numeric exact total ${JSON.stringify(malformedTotal)} fails closed`);
  }

  let calls = 0;
  const recovered = await contract.readWithStatementTimeoutRetry(async () => {
    calls++;
    return calls === 1 ? { error: { code: '57014' } } : { data: [{ id: 'ok' }], error: null };
  }, true);
  ok(calls === 2 && recovered.retry_count === 1 && !recovered.result.error,
    'complete read retries one statement timeout and recovers');

  calls = 0;
  const repeatedTimeout = await contract.readWithStatementTimeoutRetry(async () => {
    calls++;
    return { error: { code: '57014' } };
  }, true);
  ok(calls === 2 && repeatedTimeout.retry_count === 1 && repeatedTimeout.result.error.code === '57014',
    'second statement timeout is returned fail-closed without a third attempt');

  calls = 0;
  const unrelated = await contract.readWithStatementTimeoutRetry(async () => {
    calls++;
    return { error: { code: '42501' } };
  }, true);
  ok(calls === 1 && unrelated.retry_count === 0 && unrelated.result.error.code === '42501',
    'non-timeout database errors are never retried');

  calls = 0;
  await contract.readWithStatementTimeoutRetry(async () => {
    calls++;
    return { error: { code: '57014' } };
  }, false);
  ok(calls === 1, 'ordinary paged reads do not gain hidden retries');

  if (failures) {
    console.error(`\n${failures} production comment read contract check(s) failed`);
    process.exit(1);
  }
  console.log('\nProduction comment read contract checks passed');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
