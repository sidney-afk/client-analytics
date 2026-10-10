'use strict';
/*
 * The calendar-upsert live-delta lane (.github/workflows/calendar-upsert-live-delta.yml,
 * OPEN_REPAIRS 402). calendar-upsert is frozen: its repo source re-applies the client-link gate and
 * 401s every client review link, so the only allowed deploy is a downloaded LIVE copy plus the one
 * auto-posted line. This suite pins the lane's rules as text (it cannot run Actions) and runs the
 * script's directory modes on invented files:
 *   - dispatch only, production environment, typed confirmation, hashes validated before any secret;
 *   - every deploy is calendar-upsert, from a temp folder outside the checkout, with --no-verify-jwt;
 *     nothing ever deploys the repo's supabase/functions/calendar-upsert;
 *   - verify_jwt must be false before and after; a second download must match by hash;
 *   - idempotent: "already applied" deploys nothing;
 *   - a rollback step redeploys the step-1 original when the deploy or the verification fails.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let passed = 0;
let failed = 0;
const ok = (name, value) => {
  if (value) { passed += 1; console.log(`  ok ${name}`); }
  else { failed += 1; console.log(`  FAIL ${name}`); }
};

const BEFORE = '67511f6763a2e3b7edd951ce473e5b3fa878c53cbf4d25e2efd564d3f2e91185';
const AFTER = '7312f7fc5fbbd3cbcc805800f56a447bef6cd1ac009164b6d3d701f7b6dff843';
const wf = read('.github/workflows/calendar-upsert-live-delta.yml');
const script = read('scripts/calendar-upsert-live-delta.js');
const wfCode = wf.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');

/* ---- the workflow, as text ---- */
const onBlock = wf.slice(wf.indexOf('\non:'), wf.indexOf('\npermissions:'));
ok('dispatch only: no push, schedule, pull_request or workflow_run trigger',
  /^\s{2}workflow_dispatch:/m.test(onBlock) && !/^\s{2}(push|schedule|pull_request|pull_request_target|workflow_run):/m.test(onBlock));
ok('runs in the production environment', /^\s{4}environment: production$/m.test(wf));
ok('typed confirmation is required', wf.includes('if [ "$CONFIRM" != "DEPLOY LIVE CALENDAR-UPSERT DELTA" ]'));
ok('input defaults are the measured v83 hashes', wf.includes(`default: ${BEFORE}`) && wf.includes(`default: ${AFTER}`)
  && script.includes(BEFORE) && script.includes(AFTER));
const steps = wf.split(/\n      - /).slice(1);
const firstSecret = steps.findIndex(s => s.includes('secrets.SUPABASE_ACCESS_TOKEN'));
const validate = steps.findIndex(s => s.startsWith('name: Validate the inputs'));
ok('inputs are validated before any step that holds the access token', validate === 0 && firstSecret > validate
  && !steps[validate].includes('secrets.'));

const deployLines = wf.split('\n').filter(l => /\bsupabase\s+functions\s+deploy\b/.test(l));
ok('two deploy commands exist: the patched copy and the rollback', deployLines.length === 2);
ok('every deploy is calendar-upsert with --no-verify-jwt and --use-api', deployLines.every(l =>
  /supabase functions deploy calendar-upsert --project-ref "\$PROJECT_REF"/.test(l) && l.includes('--no-verify-jwt') && l.includes('--use-api')));
ok('every deploy runs from a temp folder, never the checkout', deployLines.every(l => /--workdir "\$(PATCHED_DIR|LIVE_DIR)"/.test(l))
  && !/GITHUB_WORKSPACE[^\n]*functions deploy|functions deploy[^\n]*GITHUB_WORKSPACE/.test(wf));
ok('no repo-source deploy path: the workflow never names supabase/functions/calendar-upsert',
  !wfCode.includes('supabase/functions/calendar-upsert') && !/--workdir\s+"?\.\/?"?\s/.test(wfCode));
ok('the temp folders are refused if they resolve inside the checkout',
  wf.includes('is inside the checkout') && wf.includes('$RUNNER_TEMP/$d'));
ok('downloads go to temp folders only', (wf.match(/supabase functions download calendar-upsert --project-ref "\$PROJECT_REF" --workdir "\$(LIVE_DIR|AFTER_DIR|ROLLBACK_DIR)" --use-api/g) || []).length === 3
  && (wf.match(/supabase functions download/g) || []).length === 3);
ok('verify_jwt must be false before the deploy and after it',
  wf.includes('Refused: live calendar-upsert verify_jwt is $jwt, it must be false') && wf.includes('live verify_jwt is $jwt after the deploy'));
ok('step 2 applies the delta with both hashes', wf.includes('--dir-apply "$LIVE_DIR" "$PATCHED_DIR" --expect-sha="$EXPECT_BEFORE" --expect-after="$EXPECT_AFTER"'));
ok('step 4 verifies against the step-1 snapshot', wf.includes('--dir-verify "$AFTER_DIR" --snapshot="$SNAPSHOT" --expect-after="$EXPECT_AFTER"'));
const gated = (name) => { const s = steps.find(x => x.startsWith('name: ' + name)); return s && s.includes("if: steps.state.outputs.state == 'before'"); };
ok('idempotent: apply, deploy and verify run only when live is the before-hash',
  gated('2. Apply') && gated('3. Deploy') && gated('4. Download again') && wf.includes('already applied: live index.ts is $EXPECT_AFTER; nothing deployed'));
const rollback = steps.find(s => s.startsWith('name: 5. ROLLBACK'));
ok('rollback: redeploys the step-1 original when the deploy or the verification fails, then fails the run',
  !!rollback && rollback.includes("if: failure() && (steps.deploy.outcome == 'success' || steps.deploy.outcome == 'failure') && steps.verify.outcome != 'success'")
  && rollback.includes('--workdir "$LIVE_DIR" --no-verify-jwt') && /exit 1\s*$/.test(rollback.trim()));
ok('rollback proves itself by re-downloading', !!rollback && rollback.includes('--dir-state "$ROLLBACK_DIR"') && rollback.includes('ROLLBACK DID NOT VERIFY'));
ok('the deploy manifest knows the lane and keeps the frozen note',
  read('scripts/ef-deploy-manifest.js').includes("file: '.github/workflows/calendar-upsert-live-delta.yml'")
  && /\| `calendar-upsert` \| \[calendar-upsert-live-delta\]/.test(read('docs/ops/EF_DEPLOY_MANIFEST.md'))
  && read('docs/ops/EF_DEPLOY_MANIFEST.md').includes('FROZEN: the repo source is never deployed'));
ok('the one-function lane still refuses calendar-upsert', !/calendar-upsert\b(?!-)/.test(
  read('.github/workflows/deploy-single-function.yml').replace(/^#.*$/gm, '')));
ok('script header names the lane as the deploy route', script.includes('.github/workflows/calendar-upsert-live-delta.yml')
  && /the deploy route/i.test(script));

/* ---- the directory modes, on invented files ---- */
const D = require(path.join(ROOT, 'scripts/calendar-upsert-live-delta.js'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-lane-'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const tree = (dir, files) => {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
};
const entrySrc = 'import { x } from "../_shared/thumbnail-revisions.ts";\nfunction actorFrom() {\n' + D.ANCHOR + '\n}\n';
const shared = 'export const x = 1;\n';
const live = tree(path.join(tmp, 'live'), { 'supabase/functions/calendar-upsert/index.ts': entrySrc, 'supabase/functions/_shared/thumbnail-revisions.ts': shared, 'supabase/config.toml': 'project_id = "x"\n' });
const before = sha(entrySrc);
const patchedText = D.applyDelta(entrySrc).text;
const after = sha(patchedText);
const quiet = (fn) => { const l = console.log; console.log = () => {}; try { return fn(); } catch (e) { return 'refused: ' + e.message; } finally { console.log = l; } };
const snap = D.snapshot(live);
ok('snapshot: every function file hashed, the CLI project stub ignored',
  Object.keys(snap).join() === 'supabase/functions/_shared/thumbnail-revisions.ts,supabase/functions/calendar-upsert/index.ts' && snap['supabase/functions/calendar-upsert/index.ts'] === before);
const snapFile = path.join(tmp, 'snap.json');
fs.writeFileSync(snapFile, JSON.stringify({ files: snap }));
const out = path.join(tmp, 'patched');
ok('apply: patched copy hashes to the after-hash', quiet(() => D.dirMain('--dir-apply', [live, out, '--expect-sha=' + before, '--expect-after=' + after])) === 0
  && sha(fs.readFileSync(path.join(out, 'supabase/functions/calendar-upsert/index.ts'))) === after);
ok('apply: refuses when the after-hash does not match', /not the expected after-hash/.test(String(quiet(() => D.dirMain('--dir-apply', [live, path.join(tmp, 'p2'), '--expect-sha=' + before, '--expect-after=' + 'b'.repeat(64)])))));
ok('apply: refuses a live source that is not the before-hash', /is not the expected/.test(String(quiet(() => D.dirMain('--dir-apply', [live, path.join(tmp, 'p3'), '--expect-sha=' + 'c'.repeat(64), '--expect-after=' + after])))));
ok('apply: refuses an output folder inside the repository', /inside the repository/.test(String(quiet(() => D.dirMain('--dir-apply', [live, path.join(ROOT, 'tmp-lane-out'), '--expect-sha=' + before, '--expect-after=' + after]))))
  && !fs.existsSync(path.join(ROOT, 'tmp-lane-out')));
const gatedTree = tree(path.join(tmp, 'gated'), { 'supabase/functions/calendar-upsert/index.ts': 'authorizeBrowserWrite();\n' + entrySrc, 'supabase/functions/_shared/thumbnail-revisions.ts': shared });
ok('any file carrying authorizeBrowserWrite is refused', /authorizeBrowserWrite/.test(String(quiet(() => D.dirMain('--snapshot', [gatedTree])))));
const odd = tree(path.join(tmp, 'odd'), { 'functions/calendar-upsert/index.ts': entrySrc, 'functions/_shared/thumbnail-revisions.ts': shared });
ok('an unexpected download layout is refused before anything else', /expected exactly one entrypoint/.test(String(quiet(() => D.dirMain('--snapshot', [odd])))));
const missingImport = tree(path.join(tmp, 'noimport'), { 'supabase/functions/calendar-upsert/index.ts': entrySrc });
ok('a download missing an imported file is refused', /not in the downloaded tree/.test(String(quiet(() => D.dirMain('--snapshot', [missingImport])))));
ok('state: before, then after, else refused',
  quiet(() => D.dirMain('--dir-state', [live, '--expect-sha=' + before, '--expect-after=' + after])) === 0
  && /neither/.test(String(quiet(() => D.dirMain('--dir-state', [live, '--expect-sha=' + 'd'.repeat(64), '--expect-after=' + after])))));
ok('verify: passes on the patched tree', quiet(() => D.dirMain('--dir-verify', [out, '--snapshot=' + snapFile, '--expect-after=' + after])) === 0);
ok('verify: fails when live still has the old index.ts', /index.ts is/.test(String(quiet(() => D.dirMain('--dir-verify', [live, '--snapshot=' + snapFile, '--expect-after=' + after])))));
fs.writeFileSync(path.join(out, 'supabase/functions/_shared/thumbnail-revisions.ts'), shared + '// drift\n');
ok('verify: fails when any other file changed', /changed after deploy/.test(String(quiet(() => D.dirMain('--dir-verify', [out, '--snapshot=' + snapFile, '--expect-after=' + after])))));
fs.writeFileSync(path.join(out, 'supabase/functions/_shared/thumbnail-revisions.ts'), shared);
fs.writeFileSync(path.join(out, 'supabase/functions/_shared/extra.ts'), 'x');
ok('verify: fails when a file was added', /new after deploy/.test(String(quiet(() => D.dirMain('--dir-verify', [out, '--snapshot=' + snapFile, '--expect-after=' + after])))));
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
assert.equal(failed, 0);
