'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { stableJson, writePrivateFailure } = require('../scripts/production-write-drill');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

ok(stableJson({ b: 2, a: 1 }) === stableJson({ a: 1, b: 2 }), 'flag comparison is key-order independent');

const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'production-write-drill.js'), 'utf8');
const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'production-write-drill.yml'), 'utf8');
for (const token of [
  "operation: 'intake_create'",
  "request('status'",
  "request('comment'",
  "request('due'",
  "request('assignee'",
  "test_override: true",
  "confirm: 'B4_TEST_ONLY'",
  'skip_graphic_generation',
]) ok(source.includes(token), `drill uses real gateway contract: ${token}`);
ok(!source.includes('legacy_parity'), 'normal service TEST drill does not impersonate legacy-parity traffic');
ok(source.includes('expected exactly one active TEST client'), 'drill discovers the sole active TEST client server-side');
ok(!source.includes('PRODUCTION_WRITE_TEST_'), 'drill adds no unavailable GitHub TEST secrets');
ok(source.includes('production_comments?select=id'), 'drill verifies exactly-once native comment storage');
ok(source.includes("audience: 'internal'") && !source.includes("audience: 'staff'"), 'drill uses the gateway comment-audience vocabulary');
ok(source.includes("row.brief === 'Video 1' && issue.description === 'Video 1'"), 'drill verifies the TEST graphics fallback in native and Linear');
ok(source.includes('foreign_write_detected'), 'drill checks for echo/foreign-write storms');
ok(source.includes('--test-authority-client='), 'drill runs the TEST-only authority reconciler');
ok(source.includes('diff_count') && source.includes('repair_list_size') && source.includes('linkage_actionable'), 'drill requires final 0/0/0 reconciliation');
ok(source.includes("operation: 'archive'") && source.includes("test_override: { client_slug: TEST_CLIENT, mode: 'live', authority: 'syncview' }"), 'cleanup archives through the TEST-only outbox path');
ok(source.includes('stableJson(flagsBefore) === stableJson(flagsAfter)'), 'drill proves runtime flags unchanged');
ok(source.includes('select=key,value,updated_at'), 'flag proof detects a flip-away-and-back during the drill');
ok(source.includes("action: 'production_write_drill'"), 'drill emits the pager summary event');
ok(source.includes('error_code:') && !source.includes('clean(failure.message).slice'), 'public drill telemetry reports an aggregate stage code, never a raw failure body');
const privateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'production-write-drill-private-'));
const privateLog = path.join(privateDir, 'failure.json');
ok(writePrivateFailure(new Error('private fixture detail'), 'video_mutations', privateLog), 'private failure detail can be written to a caller-supplied path');
const privatePayload = JSON.parse(fs.readFileSync(privateLog, 'utf8'));
ok(privatePayload.stage === 'video_mutations' && privatePayload.message === 'private fixture detail' && privatePayload.stack.includes('private fixture detail'), 'private log preserves the failure stage, message, and stack');
let repoPathRejected = false;
try { writePrivateFailure(new Error('must not land in repo'), 'fixture', path.join(__dirname, 'private-failure.json')); } catch (_) { repoPathRejected = true; }
ok(repoPathRejected && !fs.existsSync(path.join(__dirname, 'private-failure.json')), 'private failure log is refused inside the public repository');
ok(!source.includes('console.log(privatePayload)') && !source.includes('error: failure ?'), 'raw private failure detail is absent from console and public payload wiring');
ok(!/Sidney Laruel|Test Project|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(source), 'drill contains no client/project names or private ids');
ok(/cron: '17 4 \* \* \*'/.test(workflow) && /workflow_dispatch:/.test(workflow), 'drill has daily and manual triggers');
ok(/secrets\.SUPABASE_SERVICE_ROLE_KEY/.test(workflow) && /secrets\.LINEAR_API_KEY/.test(workflow), 'drill uses existing service/read secrets');
ok(!/PRODUCTION_WRITE_TEST_/.test(workflow), 'drill workflow introduces no missing TEST secret dependency');

if (failures) process.exit(1);
console.log('\nProduction write drill scaffold checks passed');
