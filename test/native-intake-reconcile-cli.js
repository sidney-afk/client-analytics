'use strict';
/*
 * The reconcile runner's PUBLIC OUTPUT must never carry an identifier.
 *
 * Independent review of PR1308's first head found that the runner printed the
 * whole report, request ids and raw RPC error bodies to a public Actions log.
 * This suite runs the ACTUAL CLI (scripts/native-intake-reconcile/run.js) as a
 * child process against a local fake REST endpoint whose every response is
 * seeded with unique forbidden strings in the places a leak could come from:
 * client slug, request id, nested result ids and reasons, summary keys, and an
 * HTTP error body. Then it reads exactly what the CLI wrote to stdout and
 * stderr. Offline; no PostgreSQL, no network beyond 127.0.0.1.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const lib = require('../scripts/native-intake-reconcile/reconcile-lib');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ok  ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }

const CANARY = {
  client: 'CANARY_CLIENT_qz7a1',
  request: 'CANARY_REQUEST_qz7a2',
  nestedId: 'del_CANARY_ID_qz7a3',
  nestedReason: 'CANARY_REASON_qz7a4 with details Key (x)=(y)',
  cardId: 'p_CANARY_CARD_qz7a5',
  outcomeKey: 'cards:CANARY_OUTCOME_qz7a6',
  errorBody: '{"message":"CANARY_ERROR_qz7a7 relation does not exist","hint":"CANARY_HINT_qz7a8"}',
  owner: 'CANARY_OWNER_qz7a9',
};
const forbidden = Object.values(CANARY).flatMap(v => String(v).match(/CANARY_[A-Z_]+_qz7a[0-9]/g) || []);

function respond(name, mode) {
  if (mode === 'error') return { status: 500, body: CANARY.errorBody };
  const bodies = {
    production_intake_reconcile_backlog: {
      items: [{ request_id: CANARY.request, client_slug: CANARY.client, surface: 'calendar',
        owed: { children_native: 1, children_provider: 0, cards: 1, identity_conflicts: 0, missing_terminal_receipts: 0 } }],
      next_after: CANARY.request, exhausted: true, examined: 3,
    },
    production_intake_reconcile_children: {
      stage: 'children', request_id: CANARY.request, applied: mode === 'apply', outcome: 'unresolved',
      plan: [CANARY.nestedId], complete: [], recovered: [],
      conflicts: [{ id: CANARY.nestedId, reason: 'child_identity_conflict', owner: 'operator' }],
      unresolved: [{ ids: [CANARY.nestedId], reason: CANARY.nestedReason, owner: CANARY.owner }],
    },
    production_intake_reconcile_cards: {
      stage: 'cards', request_id: CANARY.request, applied: false, outcome: 'unresolved', plan: [],
      complete: [], created: [], bound: [], conflicts: [],
      unresolved: [{ card_id: CANARY.cardId, reason: 'card_slot_occupied', owner: 'operator' }],
    },
    production_intake_reconcile_summary: {
      manifests: 4, requests_complete: 2, requests_owed: 2,
      owed: { children_native: 1, children_provider: 1, cards: 2, identity_conflicts: 1, missing_terminal_receipts: 1 },
      backlog_oldest_recorded_at: '2026-09-05T20:00:00Z', backlog_age_seconds: 4200,
      latest_outcomes: { 'children:unresolved': 1, [CANARY.outcomeKey]: 1 }, observed_at: '2026-09-05T21:00:00Z',
    },
  };
  return { status: 200, body: JSON.stringify(bodies[name] || null) };
}

function startServer(mode) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const name = String(req.url || '').replace(/^\/rest\/v1\/rpc\//, '').split('?')[0];
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const out = respond(name, mode);
        res.writeHead(out.status, { 'Content-Type': 'application/json' });
        res.end(out.body);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/* Asynchronous on purpose: the fake endpoint lives in THIS process, so a
   synchronous spawn would block the event loop the server needs to answer. */
function runCli(port, extraArgs, extraEnv) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.resolve(__dirname, '../scripts/native-intake-reconcile/run.js'), ...extraArgs], {
      env: {
        PATH: process.env.PATH, SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role-key',
        ...extraEnv,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
    child.on('close', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
}
function leaks(text) { return forbidden.filter(word => String(text || '').includes(word)); }

(async () => {
  // Library-level bounding first: unknown reasons, owners and outcomes collapse.
  ok(lib.boundReason(CANARY.nestedReason) === 'other' && lib.boundReason('card_slot_occupied') === 'card_slot_occupied'
    && lib.boundReason('sql_error:23503') === 'sql_error:23503' && lib.boundReason('sql_error:23503 extra') === 'other',
    'reason codes are bounded to the allowlist and SQLSTATE classes');
  ok(lib.boundOwner(CANARY.owner) === 'other' && lib.boundOutcome('recovered') === 'recovered' && lib.boundOutcome('CANARY') === 'other',
    'owners and outcomes are bounded');
  ok(lib.correlation('a', 'k') !== lib.correlation('b', 'k') && lib.correlation('a', 'k') === lib.correlation('a', 'k')
    && lib.correlation('a', null) === null && /^[0-9a-f]{12}$/.test(lib.correlation('a', 'k')),
    'correlation is keyed, stable, truncated, and absent without a key');

  const { server, port } = await startServer('dry');
  try {
    const dry = await runCli(port, ['--limit=5'], {});
    ok(dry.status === 0, 'dry run exits 0 against the fake endpoint');
    ok(leaks(dry.stdout).length === 0 && leaks(dry.stderr).length === 0,
      'dry run stdout and stderr carry no client, request, id, reason, owner or outcome canary');
    let parsed = null;
    try { parsed = JSON.parse(dry.stdout); } catch (_e) { parsed = null; }
    ok(!!parsed && parsed.processed_count === 1 && parsed.dry_run === true && parsed.correlated === false && !('requests' in parsed),
      'public report is aggregate only without a correlation key');
    // The children stage came back unresolved, so the library never asked the
    // card stage: its only public reason is the skip code.
    ok(!!parsed && parsed.reasons.children.child_identity_conflict === 1 && parsed.reasons.children.other === 1
      && parsed.reasons.cards.children_incomplete === 1 && parsed.counts.cards.skipped === 1
      && parsed.summary.latest_outcomes['cards:other'] === 1
      && parsed.summary.owed.missing_terminal_receipts === 1 && parsed.attention.backlog_age_seconds === 4200,
      'public report keeps counts and bounded codes, collapses unknown text to other');
    ok(!('processed' in (parsed || {})) && !JSON.stringify(parsed || {}).includes('client_slug'),
      'public report carries no per-request detail and no client_slug field');

    const keyed = await runCli(port, ['--limit=5'], { NATIVE_INTAKE_RECONCILE_HASH_KEY: 'fixture-hash-key' });
    let keyedParsed = null;
    try { keyedParsed = JSON.parse(keyed.stdout); } catch (_e) { keyedParsed = null; }
    ok(keyed.status === 0 && leaks(keyed.stdout).length === 0 && leaks(keyed.stderr).length === 0
      && !!keyedParsed && keyedParsed.correlated === true && keyedParsed.requests.length === 1
      && /^[0-9a-f]{12}$/.test(keyedParsed.requests[0].correlation) && keyedParsed.requests[0].children === 'unresolved'
      && /plan  children [0-9a-f]{12} -> unresolved/.test(keyed.stderr),
      'with a key, per-request rows and stderr progress carry only a correlation token and bounded codes');

    const applyRefused = await runCli(port, ['--apply'], {});
    ok(applyRefused.status === 1 && /config_error/.test(applyRefused.stderr) && leaks(applyRefused.stderr).length === 0,
      'apply without the confirmation phrase is refused with a fixed message');
    const applied = await runCli(port, ['--apply', '--strict', '--limit=1'], { NATIVE_INTAKE_RECONCILE_CONFIRM: 'RECONCILE_NATIVE_INTAKE_APPLY' });
    ok(applied.status === 3 && leaks(applied.stdout).length === 0 && leaks(applied.stderr).length === 0,
      'strict apply with unresolved requests exits 3 and still leaks nothing');

    const inside = await runCli(port, ['--private-report=' + path.resolve(__dirname, '../artifacts/should-not-exist.json')], {});
    ok(inside.status === 1 && /refusing to write the private report inside the repository/.test(inside.stderr)
      && !fs.existsSync(path.resolve(__dirname, '../artifacts/should-not-exist.json')),
      'a private report path inside the repository is refused before any call');
    // A path that only LOOKS outside: `<repo>/..private...` begins with two dots
    // yet lives in the tree. And a symlink from a temp directory into the tree
    // resolves inside it. Both are refused before any call is made.
    const dotted = await runCli(port, ['--private-report=' + path.join(path.resolve(__dirname, '..'), '..private-report.json')], {});
    ok(dotted.status === 1 && /refusing to write the private report inside the repository/.test(dotted.stderr)
      && !fs.existsSync(path.join(path.resolve(__dirname, '..'), '..private-report.json')),
      'an in-repository path that starts with two dots is refused');
    const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nir-link-'));
    // The link targets a directory that EXISTS in the tree, so only real-path
    // resolution can tell the write would land inside it.
    fs.symlinkSync(path.resolve(__dirname), path.join(linkDir, 'into-repo'));
    const viaLink = await runCli(port, ['--private-report=' + path.join(linkDir, 'into-repo', 'escaped.json')], {});
    ok(viaLink.status === 1 && /refusing to write the private report inside the repository/.test(viaLink.stderr)
      && !fs.existsSync(path.resolve(__dirname, 'escaped.json')),
      'a symlink from outside that resolves into the repository is refused');
    fs.rmSync(linkDir, { recursive: true, force: true });
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nir-private-'));
    const outsidePath = path.join(outsideDir, 'report.json');
    const outside = await runCli(port, ['--private-report=' + outsidePath], {});
    const written = fs.existsSync(outsidePath) ? fs.readFileSync(outsidePath, 'utf8') : '';
    ok(outside.status === 0 && leaks(outside.stdout).length === 0 && leaks(outside.stderr).length === 0
      && written.includes(CANARY.request) && written.includes(CANARY.client) && written.includes(CANARY.nestedId),
      'the private report outside the repository holds the full detail while public output stays clean');
    fs.rmSync(outsideDir, { recursive: true, force: true });
  } finally {
    server.close();
  }

  const failing = await startServer('error');
  try {
    const errored = await runCli(failing.port, ['--limit=5'], {});
    ok(errored.status === 1 && /^rpc_failed:production_intake_reconcile_backlog:http_500\s*$/m.test(errored.stderr)
      && leaks(errored.stdout).length === 0 && leaks(errored.stderr).length === 0,
      'an RPC failure prints a bounded code, never the response body');
  } finally {
    failing.server.close();
  }

  console.log(`\nnative-intake-reconcile-cli: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})().catch(error => { console.error(String(error && error.stack || error)); process.exit(1); });
