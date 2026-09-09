'use strict';
/*
 * The composed native-intake artifact, EXECUTED.
 *
 * scripts/native-intake-named-append-compose.js splices
 * 2026-09-05-native-only-intake.sql and 2026-09-07-native-intake-named-append.sql
 * into ONE transaction, and that composed file is what an operator actually
 * applies: neither half may be applied alone, because both declare the same
 * production_intake_append signature and whichever lands second silently
 * replaces the other. Until now the composition was only ever CHECKED offline
 * (test/native-intake-named-append.js reports executed:false); nothing applied
 * it to a database. This does, against a disposable PostgreSQL 16 with
 * check_function_bodies on.
 *
 * It also PINS the composed digest and byte length. docs/independence/LINEAR_EXIT_BRIEF_B.md
 * publishes both and tells the operator to REFUSE on a mismatch, so a change to
 * either half that does not update the published numbers is a change that would
 * make the owner reject the correct artifact mid-install. That is a CI failure,
 * not a review comment. If you are here because this test failed: re-run the
 * composer, then update the numbers below AND every published copy (brief B,
 * OPEN_REPAIRS, and docs/audits/2026-09-07-native-named-append-evidence.json)
 * in the same commit.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { bootCluster, MIGRATIONS } = require('../scripts/native-intake-manifest/harness');
const { fromRepository } = require('../scripts/native-intake-named-append-compose');

const COMPOSED_SHA256 = '2571a909971f2bc52ef270400b7666c2b529d36ab4f6a56044f00d1b2ecf61ec';
const COMPOSED_BYTES = 66665;
const COMPOSED_CHARACTERS = 66659;

const checks = [];
function ok(label, condition) {
  assert.ok(condition, label);
  checks.push(label);
  console.log('  ok  ' + label);
}

const built = fromRepository();
ok('the composer still returns the digest the brief publishes', built.manifest.composed_sha256 === COMPOSED_SHA256);
ok('and the byte length it publishes, which is not the character count',
  Buffer.byteLength(built.sql, 'utf8') === COMPOSED_BYTES && built.sql.length === COMPOSED_CHARACTERS);
ok('one outer transaction, not two', built.manifest.outer_transactions === 1);

if (process.env.F63_REQUIRE_POSTGRES !== '1' && process.env.INTAKE_MANIFEST_REQUIRE_POSTGRES !== '1') {
  console.log('SKIP applying the composed artifact: explicit disposable PostgreSQL required');
  console.log(JSON.stringify({ status: 'PASS', passed: checks.length, classification: 'OFFLINE_DIGEST_PIN_ONLY' }));
  process.exit(0);
}
const host = process.env.F42_REHEARSAL_SOCKET || process.env.F42_REHEARSAL_PGHOST || process.env.PGHOST || '';
if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw Error('disposable loopback PostgreSQL required');
for (const key of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE']) delete process.env[key];

const artifact = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'composed-')), 'composed.sql');
fs.writeFileSync(artifact, built.sql);
let cluster;
try {
  cluster = bootCluster();
  // The composed file exists because neither half may be applied alone. Prove the
  // hybrid half's own prerequisite guard is what refuses, on a database that has
  // the real mirror_outbox but not the native half -- which is the only state
  // where that guard is the thing under test. Its transaction aborts, so this
  // leaves the database exactly as bootCluster built it.
  let refusal = '';
  try {
    cluster.runFile(path.join(MIGRATIONS, '2026-09-07-native-intake-named-append.sql'));
  } catch (error) { refusal = error.message; }
  ok('the hybrid half applied ALONE refuses on its own prerequisite guard',
    /native_intake_named_append_prerequisite_missing/.test(refusal));
  ok('and refusing left the append body the chain already had, not the named one',
    cluster.exec("select prosrc like '%(?: — .+)?$%' from pg_proc where proname = 'production_intake_append';", undefined).includes('f'));
  cluster.runFile(path.join(MIGRATIONS, '2026-09-05-native-intake-root-manifest.sql'));
  cluster.exec('alter database ' + cluster.db + ' set check_function_bodies = on;');
  cluster.runFile(artifact);
  ok('the composed artifact applies with function bodies compiled', true);

  ok('exactly one production_intake_append survives the two replacements',
    cluster.exec("select count(*) from pg_proc where proname = 'production_intake_append';", undefined).includes('1'));
  // Both halves create_or_replace the same signature inside the one transaction,
  // so the surviving body has to carry BOTH properties: the native routing from
  // the native half and the named-title tolerance from the hybrid half. Either
  // one missing means the wrong body won.
  ok('the surviving body carries the named-title tolerance',
    cluster.exec("select prosrc like '%(?: — .+)?$%' from pg_proc where proname = 'production_intake_append';", undefined).includes('t'));
  ok('and the native routing, so the last replacement did not drop the first',
    cluster.exec("select prosrc like '%_native_intake_epoch%' from pg_proc where proname = 'production_intake_append';", undefined).includes('t'));
  ok('the receipt guard the hybrid half requires is installed and enabled',
    cluster.exec("select tgenabled from pg_trigger where tgname = 'zz_native_intake_receipt_guard';", undefined).includes('O'));
  ok('and admission is OFF for both teams on a fresh install',
    cluster.exec('select public.production_native_intake_epochs();', undefined).includes('{"video": "", "graphics": ""}'));

  console.log(JSON.stringify({ status: 'PASS', passed: checks.length,
    classification: 'EXECUTED_REAL_POSTGRES16_COMPOSED_ARTIFACT',
    composed_sha256: COMPOSED_SHA256, composed_bytes: COMPOSED_BYTES, provider_attempts: 0,
    limits: ['Applies the artifact and inspects the resulting objects; the gateway and its authenticated path are proved by the other native lanes',
      'A fresh install only: it does not rehearse applying over an older native install'] }));
} finally {
  if (cluster) cluster.stop();
  try { fs.rmSync(path.dirname(artifact), { recursive: true, force: true }); } catch { /* best effort */ }
}
