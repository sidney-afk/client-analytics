'use strict';
/*
 * REGRESSION GUARD: when the Pages source cannot be read, a push to main goes
 * red instead of skipping the deploy with a green run (OPEN_REPAIRS 398,
 * Digger bug archaeology 2026-10-10).
 *
 * Since 2026-09-30 the live site is published only by pages-site.yml's deploy
 * job, which runs only when the build job read the Pages source as
 * "workflow". One failed `gh api` call made it "unknown": the deploy was
 * skipped, the run stayed green with a warning, and a merged fix was simply
 * not live until the next push touching the site. Same shape as the
 * lane-ticker of 2026-10-09 (a tool failure read as "nothing to do").
 *
 * This runs the workflow step's own shell with a stand-in `gh` (and `sleep`)
 * on PATH. Linux/macOS only (needs bash); it is skipped elsewhere.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

if (process.platform === 'win32') { console.log('pages-deploy-source-unreadable: skipped on Windows (needs bash)'); process.exit(0); }
const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'pages-site.yml'), 'utf8');
const lines = yml.split('\n');
const at = lines.findIndex(l => /- name: Read the Pages source/.test(l));
assert.ok(at >= 0, 'the "Read the Pages source" step exists');
const runAt = lines.findIndex((l, i) => i > at && /^\s+run: \|\s*$/.test(l));
const indent = lines[runAt + 1].match(/^\s*/)[0];
const body = [];
for (let i = runAt + 1; i < lines.length && (lines[i].startsWith(indent) || lines[i].trim() === ''); i++) body.push(lines[i].slice(indent.length));
const script = body.join('\n');

function run({ ghAnswers, event, ref }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-src-'));
  const state = path.join(dir, 'calls');
  fs.writeFileSync(state, '0');
  // gh answers from a list, one per call; "fail" exits non-zero.
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env bash
n=$(cat "${state}"); n=$((n+1)); echo $n > "${state}"
answers=(${ghAnswers.map(a => JSON.stringify(a)).join(' ')})
a=\${answers[$((n-1))]:-fail}
# gh on an HTTP error prints the error body to stdout, then exits non-zero.
if [ "$a" = fail ]; then echo '{"message":"Server Error","status":"502"}'; exit 1; fi
echo "$a"
`, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'sleep'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  const out = path.join(dir, 'out'), summary = path.join(dir, 'summary');
  const text = script.replace(/\$\{\{\s*github\.event_name\s*\}\}/g, event).replace(/\$\{\{\s*github\.ref\s*\}\}/g, ref);
  const r = spawnSync('bash', ['-e', '-c', text], { env: { PATH: dir + ':' + process.env.PATH, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary, GITHUB_REPOSITORY: 'owner/repo' }, encoding: 'utf8' });
  const output = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  const calls = Number(fs.readFileSync(state, 'utf8'));
  fs.rmSync(dir, { recursive: true, force: true });
  return { code: r.status, output, calls, stdout: r.stdout + r.stderr };
}

const mainPush = { event: 'push', ref: 'refs/heads/main' };
let r = run({ ghAnswers: ['fail', 'fail', 'fail'], ...mainPush });
assert.notStrictEqual(r.code, 0, 'main push, source unreadable three times: the run fails (it used to pass and deploy nothing)');
assert.ok(/NOT deployed/.test(r.stdout), 'and it says main was not deployed');
assert.strictEqual(r.calls, 3, 'after three tries');

r = run({ ghAnswers: ['fail', 'workflow'], ...mainPush });
assert.strictEqual(r.code, 0, 'one failed read then a good one: the run carries on');
assert.ok(/^source=workflow$/m.test(r.output) && r.output.trim().split('\n').length === 1, 'with the source it read, on one line, so the deploy job runs');

r = run({ ghAnswers: ['workflow'], ...mainPush });
assert.strictEqual(r.code, 0, 'a readable source on main: as before');
assert.strictEqual(r.calls, 1, 'read once');

r = run({ ghAnswers: ['null', 'null', 'null'], ...mainPush });
assert.notStrictEqual(r.code, 0, 'an answer that is neither "workflow" nor "legacy" counts as unreadable on main too');

r = run({ ghAnswers: ['fail', 'fail', 'fail'], event: 'pull_request', ref: 'refs/pull/1/merge' });
assert.strictEqual(r.code, 0, 'a pull request never deploys, so an unreadable source only warns');
assert.ok(/source=unknown/.test(r.output), 'and reports unknown');

console.log('pages-deploy-source-unreadable: an unreadable Pages source turns a main push red, never a quiet skip ✅');
