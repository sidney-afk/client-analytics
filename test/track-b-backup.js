'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  PRODUCTION_REF,
  TABLES,
  alertMarkerName,
  assertDriveReadback,
  assertExactTableManifest,
  assertProductionSource,
  authenticatedGeneratedAt,
  buildAlertMarker,
  buildManifest,
  canonicalJson,
  connectionProjectRef,
  inspectPlainDump,
  isSnapshotName,
  listBackups,
  md5,
  packSnapshot,
  parseHmacKey,
  parseDriveCredentials,
  parseStrictPgDump,
  pgDumpArgs,
  postgresEnvironment,
  readOnlyPrivilegeSql,
  readAlertMarker,
  readSnapshotBytes,
  readSnapshotFile,
  renderSafeCopySections,
  runOpaqueTool,
  selectAuthenticatedCandidates,
  snapshotName,
  strictConnectionInfo,
  verifyReadOnlyPrivilegeOutput,
  verifySnapshotFile,
} = require('../scripts/track-b-backup');
const {
  INTEGRITY_CHECKS,
  assertScratchTarget,
  restoreSql,
  verifyCounts,
  verifySql,
} = require('../scripts/track-b-restore-rehearsal');

function ok(condition, message) {
  if (!condition) {
    console.error('FAIL track-b-backup:', message);
    process.exit(1);
  }
}

function fixtureDump(rowsPerTable = 1) {
  const lines = [
    '-- PostgreSQL database dump',
    '-- Dumped from database version 15',
    '-- Data-only dump',
    '\\restrict TrackBFixture123',
    'SET statement_timeout = 0;',
    'SET lock_timeout = 0;',
    "SET client_encoding = 'UTF8';",
    'SET standard_conforming_strings = on;',
    "SELECT pg_catalog.set_config('search_path', '', false);",
    'SET row_security = off;',
    '',
  ];
  for (const config of TABLES) {
    lines.push(`-- Data for Name: ${config.name}; Type: TABLE DATA; Schema: public; Owner: backup_reader`);
    lines.push(`COPY public.${config.name} (${config.pk}) FROM stdin;`);
    for (let i = 1; i <= rowsPerTable; i += 1) lines.push(config.identity ? String(i) : `${config.name}_${i}`);
    lines.push('\\.', '');
  }
  lines.push('\\unrestrict TrackBFixture123', '-- PostgreSQL database dump complete', '');
  return Buffer.from(lines.join('\n'), 'utf8');
}

const HMAC_KEY = Buffer.alloc(32, 7).toString('base64');
const WRONG_HMAC_KEY = Buffer.alloc(32, 8).toString('base64');
const hostileProcessResult = {
  status: 17,
  stdout: 'review_token=secret-review-token',
  stderr: 'comment body: highly sensitive client feedback',
  error: new Error('connection password=do-not-log'),
};
let opaqueLogged = '';
try {
  runOpaqueTool('Track-B restore apply', 'psql', [], {}, () => hostileProcessResult);
} catch (error) {
  opaqueLogged = `${error && error.message}\n${error && error.stack}`;
}
ok(/Track-B restore apply failed \(psql; exit=17\)/.test(opaqueLogged)
  && !/secret-review-token|highly sensitive|do-not-log|review_token|comment body|password=/i.test(opaqueLogged),
'tool failures expose only stage, tool, and exit code even when stdout/stderr/error contain secrets');

ok(TABLES.length === 14, 'backup allowlist covers every canonical/security/ledger Track-B table');
ok(isSnapshotName('syncview-track-b-20260713T123456Z.snapshot')
  && !isSnapshotName('syncview-track-b-20260713T123456Z.json.gz'),
'freshness and restore consider only the transactional snapshot format');
ok(TABLES.some(row => row.name === 'client_access')
  && TABLES.some(row => row.name === 'production_comments')
  && TABLES.some(row => row.name === 'mirror_outbox'),
'service-only token, comment, and retry state are included');
ok(canonicalJson({ z: 1, a: { y: 2, x: 1 } }) === '{"a":{"x":1,"y":2},"z":1}',
  'manifest encoding uses stable key ordering');

const productionDirect = `postgresql://backup_reader:pw@db.${PRODUCTION_REF}.supabase.co:5432/postgres`;
const productionPooler = `postgresql://backup_reader.${PRODUCTION_REF}:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;
ok(connectionProjectRef(productionDirect) === PRODUCTION_REF
  && connectionProjectRef(productionPooler) === PRODUCTION_REF,
'direct and read-only-role pooler URLs retain an enforceable production project ref');
ok(assertProductionSource(productionDirect) === PRODUCTION_REF, 'production backup source is accepted');
ok(strictConnectionInfo(`${productionDirect}?sslmode=verify-full`).ref === PRODUCTION_REF,
'strict URL parser permits only a safe TLS query setting');
let wrongSourceRejected = false;
try { assertProductionSource('postgresql://reader.scratchref:pw@aws-0-us-east-1.pooler.supabase.com/postgres'); } catch (_) { wrongSourceRejected = true; }
ok(wrongSourceRejected, 'backup source hard-rejects a non-production project');
const redirectUrls = [
  `${productionDirect}?host=db.scratchref.supabase.co`,
  `${productionDirect}?hostaddr=127.0.0.1`,
  `${productionDirect}?user=postgres.scratchref`,
  `${productionDirect}?service=attacker`,
  `${productionDirect}?dbname=other`,
  `${productionDirect}?options=-csearch_path%3Dattacker`,
  `${productionDirect}?sslmode=disable`,
  `${productionDirect}?sslmode=require&sslmode=verify-full`,
  `${productionDirect}#host=db.scratchref.supabase.co`,
  productionDirect.replace('/postgres', '/other'),
];
ok(redirectUrls.every(url => {
  try { strictConnectionInfo(url); return false; } catch (_) { return true; }
}), 'libpq redirection, unsafe TLS, duplicate query, fragment, and database overrides are rejected');
const oldPgHost = process.env.PGHOST;
const oldPgService = process.env.PGSERVICE;
process.env.PGHOST = 'attacker.invalid';
process.env.PGSERVICE = 'attacker';
const scrubbedEnvironment = postgresEnvironment(productionDirect, 'track-b-test');
if (oldPgHost === undefined) delete process.env.PGHOST; else process.env.PGHOST = oldPgHost;
if (oldPgService === undefined) delete process.env.PGSERVICE; else process.env.PGSERVICE = oldPgService;
ok(!scrubbedEnvironment.PGSERVICE
  && scrubbedEnvironment.PGHOST === `db.${PRODUCTION_REF}.supabase.co`
  && scrubbedEnvironment.PGPORT === '5432'
  && scrubbedEnvironment.PGUSER === 'backup_reader'
  && scrubbedEnvironment.PGPASSWORD === 'pw'
  && scrubbedEnvironment.PGDATABASE === 'postgres'
  && scrubbedEnvironment.PGSSLMODE === 'require',
'PostgreSQL child environment removes inherited redirectors and uses exact validated connection fields');
const scratchUrl = 'postgresql://restore_reader.scratchref:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres';
ok(assertScratchTarget(scratchUrl, 'scratchref', 'SCRATCH_ONLY') === 'scratchref',
'scratch guard accepts the exact validated non-production target');
let scratchRedirectRejected = false;
try { assertScratchTarget(`${scratchUrl}?host=db.${PRODUCTION_REF}.supabase.co`, 'scratchref', 'SCRATCH_ONLY'); } catch (_) { scratchRedirectRejected = true; }
ok(scratchRedirectRejected, 'scratch guard rejects a query that could redirect libpq after the ref check');

const dump = fixtureDump(2);
const inspected = inspectPlainDump(dump);
ok(Object.keys(inspected).length === TABLES.length
  && Object.values(inspected).every(meta => meta.rows === 2),
'row-count evidence is parsed from every COPY section in the one pg_dump snapshot');
const currentPgDumpSequence = Buffer.from(dump.toString('utf8').replace(
  '-- PostgreSQL database dump complete',
  "SELECT pg_catalog.setval('public.client_access_events_id_seq', 42, true);\n-- PostgreSQL database dump complete",
));
ok(parseStrictPgDump(currentPgDumpSequence),
  'strict parser accepts PostgreSQL 17 setval output without an explicit regclass cast');
let unexpectedSequenceRejected = false;
try {
  parseStrictPgDump(Buffer.from(dump.toString('utf8').replace(
    '-- PostgreSQL database dump complete',
    "SELECT pg_catalog.setval('public.unexpected_id_seq', 42, true);\n-- PostgreSQL database dump complete",
  )));
} catch (_) { unexpectedSequenceRejected = true; }
ok(unexpectedSequenceRejected, 'strict parser still rejects sequence state outside the fixed Track-B corpus');
const emptyDump = fixtureDump(0);
ok(Object.values(inspectPlainDump(emptyDump)).every(meta => meta.rows === 0),
  'valid zero-row COPY sections remain valid evidence rather than being converted to an error item');
let missingTableRejected = false;
try { inspectPlainDump(Buffer.from(dump.toString('utf8').replace(/COPY public\.clients[\s\S]+?\\\.\n/, ''))); } catch (_) { missingTableRejected = true; }
ok(missingTableRejected, 'snapshot validation rejects a missing allowlisted table');
const exactManifest = buildManifest(dump, new Date().toISOString(), productionDirect);
ok(assertExactTableManifest(exactManifest), 'manifest declares the exact fixed Track-B corpus count');
let extraManifestTableRejected = false;
try {
  assertExactTableManifest({
    ...exactManifest,
    table_count: exactManifest.table_count + 1,
    tables: { ...exactManifest.tables, unexpected_table: { rows: 0, primary_key: 'id' } },
  });
} catch (_) { extraManifestTableRejected = true; }
ok(extraManifestTableRejected,
  'workflow-count/corpus-count drift and extra manifest tables fail before last-known-good advancement');
for (const attack of [
  '\\! touch /tmp/track-b-pwned',
  'DROP TABLE public.clients;',
  'COPY public.not_track_b (id) FROM stdin;\n1\n\\.',
  'SELECT pg_catalog.set_config(\'search_path\', \'attacker\', false);',
]) {
  const malicious = Buffer.from(dump.toString('utf8').replace('-- PostgreSQL database dump complete', `${attack}\n-- PostgreSQL database dump complete`));
  let parserRejected = false;
  let restoreRejected = false;
  try { parseStrictPgDump(malicious); } catch (_) { parserRejected = true; }
  try { restoreSql(malicious); } catch (_) { restoreRejected = true; }
  ok(parserRejected && restoreRejected, `strict restore rejects injected input: ${attack.split(' ')[0]}`);
}
const secretBearingDump = Buffer.from(dump.toString('utf8').replace(
  '-- PostgreSQL database dump complete',
  "DROP TABLE public.clients; -- review_token=secret-review-token comment body=private\n-- PostgreSQL database dump complete",
));
let secretBearingError = '';
try { restoreSql(secretBearingDump); } catch (error) { secretBearingError = `${error && error.message}\n${error && error.stack}`; }
ok(secretBearingError && !/secret-review-token|review_token|comment body|private/i.test(secretBearingError),
'strict restore rejection never echoes hostile SQL or row context');
const renderedCopy = renderSafeCopySections(dump);
ok(!/PostgreSQL database dump|\\restrict|SET row_security|\\!|DROP TABLE/.test(renderedCopy)
  && TABLES.every(config => renderedCopy.includes(`COPY public."${config.name}"`)),
'restore renderer emits only validated COPY sections for allowlisted Track-B tables');
ok(parseHmacKey(HMAC_KEY).length === 32, 'snapshot HMAC key requires at least 256 bits');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'track-b-test-'));
try {
  const dumpFile = path.join(tempDir, 'fixture.sql');
  const packageFile = path.join(tempDir, 'fixture.snapshot');
  const extractedFile = path.join(tempDir, 'extracted.sql');
  fs.writeFileSync(dumpFile, dump);
  const generatedAt = new Date(Date.now() - 60_000).toISOString();
  const manifest = packSnapshot(dumpFile, packageFile, generatedAt, productionDirect, HMAC_KEY);
  const verified = verifySnapshotFile(packageFile, extractedFile, HMAC_KEY);
  ok(verified.snapshot.isolation === 'serializable-deferrable'
    && verified.snapshot.sha256 === manifest.snapshot.sha256
    && fs.readFileSync(extractedFile).equals(dump),
  'self-contained private package verifies both manifest and exact PostgreSQL dump bytes');
  const validPackageBytes = fs.readFileSync(packageFile);
  const driveName = snapshotName(manifest.generated_at);
  const currentMs = Date.now();
  const freshSelection = selectAuthenticatedCandidates([{
    file: { id: 'fresh', name: driveName, createdTime: '2099-01-01T00:00:00.000Z' },
    bytes: validPackageBytes,
  }], HMAC_KEY, currentMs);
  ok(freshSelection.latest
    && freshSelection.latest.generatedMs === authenticatedGeneratedAt(manifest, currentMs),
  'freshness uses the authenticated manifest timestamp, not untrusted Drive createdTime');
  const replayNow = authenticatedGeneratedAt(manifest, currentMs) + (27 * 60 * 60 * 1000);
  const replaySelection = selectAuthenticatedCandidates([{
    file: { id: 'replayed', name: driveName, createdTime: new Date(replayNow).toISOString() },
    bytes: validPackageBytes,
  }], HMAC_KEY, replayNow);
  ok(replaySelection.latest
    && ((replayNow - replaySelection.latest.generatedMs) / 3600000) > 26,
  'newly uploading an old signed package cannot reset its authenticated age');
  const corruptCandidate = Buffer.from(validPackageBytes);
  corruptCandidate[corruptCandidate.length - 1] ^= 1;
  const corruptSelection = selectAuthenticatedCandidates([{
    file: { id: 'corrupt', name: driveName, createdTime: new Date(replayNow).toISOString() },
    bytes: corruptCandidate,
  }], HMAC_KEY, replayNow);
  ok(!corruptSelection.latest && corruptSelection.invalidCount === 1,
    'arbitrary or corrupt newly-created Drive files cannot count as a fresh snapshot');
  const futureSelection = selectAuthenticatedCandidates([{
    file: { id: 'future', name: driveName, createdTime: manifest.generated_at },
    bytes: validPackageBytes,
  }], HMAC_KEY, Date.parse(manifest.generated_at) - (11 * 60 * 1000));
  ok(!futureSelection.latest && futureSelection.invalidCount === 1,
    'authenticated timestamps beyond the allowed future skew are rejected');
  const priorCandidate = {
    file: { id: 'prior-lkg', name: driveName, createdTime: manifest.generated_at },
    bytes: validPackageBytes,
  };
  const truncatedSelection = selectAuthenticatedCandidates([{
    file: { id: 'newer-truncated', name: driveName, createdTime: new Date().toISOString() },
    bytes: validPackageBytes.subarray(0, validPackageBytes.length - 1),
  }, priorCandidate], HMAC_KEY, currentMs);
  ok(truncatedSelection.latest && truncatedSelection.latest.file.id === 'prior-lkg',
    'a truncated newer package fails closed and cannot advance the last-known-good pointer');
  const errorItemSelection = selectAuthenticatedCandidates([{
    file: { id: 'newer-error', name: driveName, createdTime: new Date().toISOString() },
    error: true,
  }, priorCandidate], HMAC_KEY, currentMs);
  ok(errorItemSelection.latest && errorItemSelection.latest.file.id === 'prior-lkg',
    'a Drive error-item fails closed and cannot advance the last-known-good pointer');
  const localMd5 = md5(validPackageBytes);
  const readbackMeta = {
    id: 'drive-file', name: driveName, parents: ['private-folder'],
    size: String(validPackageBytes.length), md5Checksum: localMd5,
  };
  ok(assertDriveReadback(readbackMeta, validPackageBytes, validPackageBytes, driveName, 'private-folder', 'drive-file'),
    'post-upload readback requires matching Drive identity, parent, size, md5, and bytes');
  let readbackMismatchRejected = false;
  try { assertDriveReadback({ ...readbackMeta, md5Checksum: '0'.repeat(32) }, validPackageBytes, validPackageBytes, driveName, 'private-folder', 'drive-file'); } catch (_) { readbackMismatchRejected = true; }
  ok(readbackMismatchRejected, 'post-upload readback rejects untrusted or mismatched Drive metadata');
  const afterReadbackFailure = selectAuthenticatedCandidates([priorCandidate], HMAC_KEY, currentMs);
  ok(afterReadbackFailure.latest && afterReadbackFailure.latest.file.id === 'prior-lkg',
    'a readback mismatch leaves the prior last-known-good package selected');
  let wrongKeyRejected = false;
  try { readSnapshotFile(packageFile, WRONG_HMAC_KEY); } catch (_) { wrongKeyRejected = true; }
  ok(wrongKeyRejected, 'a Drive writer without the HMAC key cannot authenticate a replacement package');
  const tampered = fs.readFileSync(packageFile);
  tampered[tampered.length - 1] ^= 1;
  fs.writeFileSync(packageFile, tampered);
  let tamperRejected = false;
  try { verifySnapshotFile(packageFile, '', HMAC_KEY); } catch (_) { tamperRejected = true; }
  ok(tamperRejected, 'package HMAC rejects modified private snapshot data before restore');

  const observed = Object.fromEntries(TABLES.map(config => [config.name, 2]));
  for (const key of Object.keys(INTEGRITY_CHECKS)) observed[key] = 0;
  ok(verifyCounts(manifest, observed), 'restore verification requires exact snapshot row counts and zero relational orphans');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

const privilegeSql = readOnlyPrivilegeSql();
ok(TABLES.every(config => privilegeSql.includes(`public.${config.name}`))
  && /'INSERT'/.test(privilegeSql) && /'TRUNCATE'/.test(privilegeSql)
  && /rolbypassrls/.test(privilegeSql),
'preflight tests complete reads, RLS bypass, and forbidden writes for every allowlisted table');
const readOnlyOutput = TABLES.map(config => `${config.name}|t|f|f|f|f|t`).join('\n');
ok(verifyReadOnlyPrivilegeOutput(readOnlyOutput), 'dedicated SELECT-only source role passes the preflight');
let writerRejected = false;
try { verifyReadOnlyPrivilegeOutput(readOnlyOutput.replace('clients|t|f|f|f|f|t', 'clients|t|t|f|f|f|t')); } catch (_) { writerRejected = true; }
ok(writerRejected, 'source credential is rejected when it can write a covered table');
let partialRlsRejected = false;
try { verifyReadOnlyPrivilegeOutput(readOnlyOutput.replace('client_access|t|f|f|f|f|t', 'client_access|t|f|f|f|f|f')); } catch (_) { partialRlsRejected = true; }
ok(partialRlsRejected, 'source credential is rejected when RLS could produce a partial snapshot');

const dumpArgs = pgDumpArgs('/tmp/track-b.sql');
ok(dumpArgs.includes('--data-only')
  && dumpArgs.includes('--serializable-deferrable')
  && TABLES.every(config => dumpArgs.includes(`--table=public.${config.name}`)),
'one non-parallel pg_dump transaction covers the complete fixed allowlist');

const userCred = parseDriveCredentials(JSON.stringify({
  type: 'authorized_user', client_id: 'id', client_secret: 'secret', refresh_token: 'refresh',
}));
ok(userCred.refresh_token === 'refresh' && userCred.token_uri.includes('googleapis.com'),
  'private Drive auth supports a scoped authorized-user refresh credential');
const serviceCred = parseDriveCredentials(Buffer.from(JSON.stringify({
  type: 'service_account', client_email: 'backup@example.invalid', private_key: 'key', token_uri: 'https://oauth2.googleapis.com/token',
})).toString('base64'));
ok(serviceCred.client_email === 'backup@example.invalid', 'private Drive auth accepts base64 service-account JSON');

const sql = restoreSql(dump);
ok(/^begin;/.test(sql)
  && /track_b_restore_set_user_triggers\(false\)/.test(sql)
  && /truncate table[\s\S]+cascade/.test(sql)
  && !/restart identity|session_replication_role/.test(sql)
  && !/\\ir |\\!|DROP TABLE|SET row_security/.test(sql)
  && TABLES.every(config => sql.includes(`COPY public."${config.name}"`))
  && /pg_get_serial_sequence/.test(sql)
  && /set constraints all immediate;\nselect public\.track_b_restore_set_user_triggers\(true\);\ncommit;/.test(sql),
'restore regenerates only allowlisted COPY data with scratch user triggers disabled transactionally');
const verificationSql = verifySql();
ok(Object.keys(INTEGRITY_CHECKS).every(key => verificationSql.includes(`select '${key}'`)),
  'restore verification covers every core foreign-key join in the Track-B graph');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'track-b-backup.yml'), 'utf8');
const backupSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'track-b-backup.js'), 'utf8');
const restoreSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'track-b-restore-rehearsal.js'), 'utf8');
const opsDoc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ops', 'TRACK_B_BACKUP.md'), 'utf8');
const postgresToolSources = `${backupSource}\n${restoreSource}`;
ok(/cron: '23 \*\/6 \* \* \*'/.test(workflow), 'private snapshot is scheduled every six hours');
ok(/TRACK_B_BACKUP_DATABASE_URL/.test(workflow)
  && /TRACK_B_BACKUP_HMAC_KEY/.test(workflow)
  && /TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON/.test(workflow)
  && /TRACK_B_BACKUP_DRIVE_FOLDER_ID/.test(workflow)
  && /SLACK_ALERT_WEBHOOK/.test(workflow),
'workflow names the read-only database, HMAC, private Drive, and freshness credentials');
ok(/Install PostgreSQL snapshot client/.test(workflow)
  && /postgresql-client/.test(workflow),
'GitHub runner explicitly installs pg_dump and psql');
ok(/TRACK_B_RESTORE_CONFIRM: SCRATCH_ONLY/.test(workflow)
  && /TRACK_B_RESTORE_EXPECTED_PROJECT_REF/.test(workflow),
'manual restore job is explicitly scratch-bound');
ok(!/upload-artifact/.test(workflow), 'sensitive snapshot package is never published as a GitHub artifact');
ok(!/result\.stderr|throw result\.error/.test(postgresToolSources)
  && /runOpaqueTool/.test(backupSource)
  && /runOpaqueTool/.test(restoreSource),
'PostgreSQL wrappers never copy captured diagnostics into thrown or logged errors');
ok(/PGHOST: info\.host/.test(backupSource)
  && /PGPASSWORD: info\.password/.test(backupSource)
  && /PGDATABASE: info\.database/.test(backupSource)
  && /timingSafeEqual/.test(backupSource)
  && /createHmac\('sha256'/.test(backupSource)
  && /pg_dump/.test(backupSource)
  && /serializable-deferrable/.test(backupSource)
  && !/function supabaseRows/.test(backupSource),
'export uses an authenticated database snapshot without a REST pagination fallback');
ok(/supportsAllDrives: 'true'/.test(backupSource)
  && /includeItemsFromAllDrives: 'true'/.test(backupSource)
  && /uploadType=multipart&supportsAllDrives=true/.test(backupSource)
  && /alt=media&supportsAllDrives=true/.test(backupSource),
'Drive list, upload, and download explicitly support the configured Shared Drive folder');
ok(/driveFileMetadata/.test(backupSource)
  && /assertDriveReadback/.test(backupSource)
  && /readback_verified: true/.test(backupSource)
  && /authenticated_generated_at/.test(backupSource)
  && /downloadDriveCandidates/.test(backupSource),
'upload success requires metadata/content readback and freshness downloads authenticated candidates');
ok(/FRESHNESS_HOURS[\s\S]+7/.test(backupSource) && /syncview-track-b-alert-/.test(backupSource),
  'freshness monitor pages after seven hours and deduplicates with a signed private-Drive marker');
ok(restoreSource.includes(`const {\n  PRODUCTION_REF,`)
  && /Production project ref is forbidden/.test(restoreSource)
  && /renderSafeCopySections/.test(restoreSource)
  && !/\\ir/.test(restoreSource),
'restore hard-blocks production and never includes downloaded SQL or psql commands');
ok(/owner explicitly opted out of the paid PITR add-on[\s\S]+do not invent a[\s\S]+verification timestamp/.test(opsDoc),
'runbook records the owner-approved PITR opt-out without fabricating gate evidence');

async function asyncChecks() {
  const pages = [
    { files: [{ id: 'ignore', name: 'not-a-snapshot.txt' }], nextPageToken: 'page-2' },
    { files: [{ id: 'backup', name: 'syncview-track-b-20260713T123456Z.snapshot' }] },
  ];
  let pageCalls = 0;
  const paged = await listBackups('fixture-token', async url => {
    const expectedToken = pageCalls === 0 ? '' : 'page-2';
    ok((new URL(url).searchParams.get('pageToken') || '') === expectedToken,
      'Drive pagination passes the exact next-page token');
    const body = pages[pageCalls];
    pageCalls += 1;
    return { ok: true, status: 200, json: async () => body };
  }, 'private-folder');
  ok(pageCalls === 2 && paged.length === 1 && paged[0].id === 'backup',
    'Drive discovery exhausts pagination before deriving last-known-good');

  let repeatedTokenRejected = false;
  try {
    await listBackups('fixture-token', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ files: [], nextPageToken: 'repeat' }),
    }), 'private-folder');
  } catch (_) { repeatedTokenRejected = true; }
  ok(repeatedTokenRejected,
    'repeated Drive pagination tokens fail closed instead of advancing last-known-good from a truncated list');

  const staleKey = 'snapshot:fixture';
  const marker = buildAlertMarker(staleKey, 8, new Date().toISOString(), HMAC_KEY);
  ok(alertMarkerName(staleKey).startsWith('syncview-track-b-alert-')
    && readAlertMarker(marker, staleKey, HMAC_KEY).stale_key === staleKey,
  'freshness dedupe marker is HMAC-authenticated outside the production database');
}

asyncChecks().then(() => {
  console.log('track-b-backup checks passed');
}).catch(error => {
  console.error(error && error.stack || error && error.message || String(error));
  process.exit(1);
});
