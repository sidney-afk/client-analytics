'use strict';
/*
 * Edge Functions on merge (deploy-edge-functions-on-merge.yml,
 * scripts/ef-auto-deploy-plan.js) and the Section 4 lane's in-run capture.
 *
 * 1. The plan, on a throwaway git repository: what a merge changes (its folder
 *    or anything it imports), the order, the Section 4 three as one unit, the
 *    holds (migration, stale pins, JWT config, a held predecessor) and the
 *    manual-only functions.
 * 2. The merge lane's YAML keeps the safety the manual lanes have.
 * 3. The Section 4 lane seals the live three itself only through the reviewed
 *    capture, store and fetch path, and never on a restore.
 * 4. The failure notice passes the relay's public-safety screen.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function ok(cond, msg) { if (cond) console.log('  ok  ' + msg); else { failures++; console.error('FAIL  ' + msg); } }
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

(async () => {
// ---- 1. the plan, on a throwaway repository ---------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ef-auto-plan-'));
try {
  const g = (...args) => execFileSync('git', ['-C', tmp, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true }); fs.writeFileSync(path.join(tmp, rel), text); };
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'test');
  for (const f of ['ef-fingerprint.js', 'ef-auto-deploy-plan.js', 'ef-deploy-manifest.js', 'repo-vs-live.js']) {
    put(`scripts/${f}`, read(`scripts/${f}`));
  }
  put('supabase/config.toml', 'project_id = "uzltbbrjidmjwwfakwve"\n');
  put('supabase/functions/_shared/x.ts', 'export const x = 1;\n');
  for (const slug of ['alpha', 'beta', 'notify', 'production-write', 'deliverable-write', 'batch-write', 'production-comments', 'calendar-upsert']) {
    put(`supabase/functions/${slug}/index.ts`, slug === 'alpha' ? 'import { x } from "../_shared/x.ts";\nDeno.serve(() => new Response(String(x)));\n' : `Deno.serve(() => new Response("${slug}"));\n`);
  }
  const plan = path.join(tmp, 'scripts', 'ef-auto-deploy-plan.js');
  const fp = (sha) => JSON.parse(execFileSync(process.execPath, [path.join(tmp, 'scripts', 'ef-fingerprint.js'), sha, '--expected-only', '--format=json'], { cwd: tmp, encoding: 'utf8' })).results;
  const pinLane = () => {
    g('add', '.'); g('commit', '-q', '-m', 'functions');
    const rows = fp(g('rev-parse', 'HEAD'));
    const pin = slug => rows.find(r => r.slug === slug).expected_fingerprint;
    put('.github/workflows/deploy-f27-section4-closures.yml', [
      'jobs:', '  deploy:', '    env:',
      `      BATCH_WRITE_SOURCE_SHA256: ${pin('batch-write')}`,
      `      DELIVERABLE_WRITE_SOURCE_SHA256: ${pin('deliverable-write')}`,
      `      PRODUCTION_WRITE_SOURCE_SHA256: ${pin('production-write')}`, '',
    ].join('\n'));
    g('add', '.'); g('commit', '-q', '-m', 'pin');
    return g('rev-parse', 'HEAD');
  };
  const run = (base, head, extra = []) => JSON.parse(execFileSync(process.execPath, [plan, 'plan', `--base=${base}`, `--head=${head}`, `--root=${tmp}`, ...extra], { cwd: tmp, encoding: 'utf8' }));
  const units = p => require(path.join(ROOT, 'scripts', 'ef-auto-deploy-plan.js')).units(p);
  const decision = (p, slug) => (p.functions.find(r => r.slug === slug) || {}).decision;

  const c0 = pinLane();

  put('supabase/functions/_shared/x.ts', 'export const x = 2;\n');
  g('add', '.'); g('commit', '-q', '-m', 'shared');
  const c1 = g('rev-parse', 'HEAD');
  let p = run(c0, c1);
  ok(JSON.stringify(units(p)) === '["alpha"]', 'a change to a shared import deploys exactly the functions that import it');

  put('supabase/functions/notify/index.ts', 'Deno.serve(() => new Response("notify 2"));\n');
  put('supabase/functions/production-write/index.ts', 'Deno.serve(() => new Response("pw 2"));\n');
  put('supabase/functions/production-comments/index.ts', 'Deno.serve(() => new Response("pc 2"));\n');
  put('supabase/functions/beta/index.ts', 'Deno.serve(() => new Response("beta 2"));\n');
  const c2 = pinLane();
  p = run(c1, c2);
  ok(JSON.stringify(units(p)) === '["beta","notify","@f27-section4","production-comments"]',
    'order: notify before the Section 4 lane, the comment reader after it, the rest by name: ' + units(p).join(' '));
  ok(!units(p).includes('production-write') && decision(p, 'production-write') === 'f27-lane',
    'production-write is never a unit of this lane; it goes through the Section 4 lane');

  put('supabase/functions/production-write/index.ts', 'Deno.serve(() => new Response("pw 3"));\n');
  put('supabase/functions/production-comments/index.ts', 'Deno.serve(() => new Response("pc 3"));\n');
  g('add', '.'); g('commit', '-q', '-m', 'unpinned');
  const c3 = g('rev-parse', 'HEAD');
  p = run(c2, c3);
  ok(decision(p, 'production-write') === 'held' && /pin/.test(p.functions.find(r => r.slug === 'production-write').reason),
    'a Section 4 change without a matching lane pin is held, not dispatched');
  ok(decision(p, 'production-comments') === 'held' && /waits for production-write/.test(p.functions.find(r => r.slug === 'production-comments').reason),
    'a reader whose gateway is held is held too');

  put('supabase/functions/calendar-upsert/index.ts', 'Deno.serve(() => new Response("frozen 2"));\n');
  put('migrations/2026-10-16-new-table.sql', 'create table if not exists t (id int);\n');
  put('supabase/functions/beta/index.ts', 'Deno.serve(() => new Response("beta 3"));\n');
  g('add', '.'); g('commit', '-q', '-m', 'migration');
  const c4 = g('rev-parse', 'HEAD');
  p = run(c3, c4, ['--functions=beta,calendar-upsert']);
  ok(decision(p, 'calendar-upsert') === 'manual', 'a frozen function is manual even when named by hand');
  ok(decision(p, 'beta') === 'held' && /migration/.test(p.functions.find(r => r.slug === 'beta').reason),
    'a merge that adds a migration holds its functions');
  p = run(c3, c4, ['--functions=beta', '--migrations-applied']);
  ok(decision(p, 'beta') === 'deploy', 'and the manual run with migrations_applied releases them');

  put('migrations/2026-10-17-optional.sql', '-- ef-auto-deploy: functions-cope-without-this\nalter table t add column if not exists n int;\n');
  put('supabase/functions/beta/index.ts', 'Deno.serve(() => new Response("beta 4"));\n');
  g('add', '.'); g('commit', '-q', '-m', 'optional migration');
  const c5 = g('rev-parse', 'HEAD');
  p = run(c4, c5);
  ok(decision(p, 'beta') === 'deploy', 'a migration that says the functions cope without it does not hold them');

  put('supabase/config.toml', 'project_id = "uzltbbrjidmjwwfakwve"\n\n[functions.beta]\nverify_jwt = true\n');
  put('supabase/functions/beta/index.ts', 'Deno.serve(() => new Response("beta 5"));\n');
  g('add', '.'); g('commit', '-q', '-m', 'jwt');
  const c6 = g('rev-parse', 'HEAD');
  p = run(c5, c6);
  ok(decision(p, 'beta') === 'held', 'a function whose config asks for verify_jwt = true is held (this lane deploys JWT-off only)');

  // A run can span several merges: a migration holds only the functions its own merge changed.
  put('migrations/2026-10-18-needs-apply.sql', 'create table if not exists u (id int);\n');
  put('supabase/functions/beta/index.ts', 'Deno.serve(() => new Response("beta 6"));\n');
  g('add', '.'); g('commit', '-q', '-m', 'merge with migration');
  const c7 = g('rev-parse', 'HEAD');
  put('supabase/functions/_shared/x.ts', 'export const x = 3;\n');
  g('add', '.'); g('commit', '-q', '-m', 'later unrelated merge');
  const c8 = g('rev-parse', 'HEAD');
  p = run(c6, c8);
  ok(decision(p, 'beta') === 'held' && decision(p, 'alpha') === 'deploy',
    'over two merges the migration holds the function its merge changed and not the function a later merge changed');

  // Order across runs: a follower planned alone is held unless its predecessor is live at the head's source.
  const fpOf = (sha, slug) => fp(sha).find(r => r.slug === slug).expected_fingerprint;
  put('supabase/functions/production-comments/index.ts', 'Deno.serve(() => new Response("pc 4"));\n');
  g('add', '.'); g('commit', '-q', '-m', 'comments only');
  const c9 = g('rev-parse', 'HEAD');
  // The gate runs inside the throwaway repository (its own copy of the scripts), with the live reads supplied.
  const gateWith = async (pwLivePasses, dispatch = false) => {
    const live = {
      'production-write': pwLivePasses
        ? { result: 'PASS', verify_jwt: false, live_fingerprint: fpOf(c9, 'production-write'), version: 7 }
        : { result: 'FAIL', verify_jwt: false, live_fingerprint: fpOf(c2, 'production-write'), version: 6 },
      '*': { result: 'FAIL', verify_jwt: false, live_fingerprint: fpOf(c8, 'production-comments'), version: 1 },
    };
    const r = spawnSync(process.execPath, ['-e', `
      const m = require(${JSON.stringify(path.join(tmp, 'scripts', 'ef-auto-deploy-plan.js'))});
      const live = ${JSON.stringify(live)};
      const p = m.plan({ root: ${JSON.stringify(tmp)}, base: ${JSON.stringify(c8)}, head: ${JSON.stringify(c9)} });
      m.gate({ root: ${JSON.stringify(tmp)}, p, dispatch: ${dispatch},
        readLive: (root, sha, slugs) => new Map(slugs.map(slug => [slug, { slug, ...(live[slug] || live['*']) }])),
        checks: new Proxy({}, { get: () => async () => null }) })
        .then(g => { g.__summary = m.summary(g); process.stdout.write(JSON.stringify(g)); }).catch(e => { console.error(e); process.exit(1); });`], { cwd: tmp, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr);
    return JSON.parse(r.stdout);
  };
  let gated = await gateWith(false);
  ok(JSON.stringify(units(run(c8, c9))) === '["production-comments"]' && decision(gated, 'production-comments') === 'held'
    && /waits for production-write/.test(gated.functions[0].reason),
    'a later merge touching only production-comments is held while the live production-write is older than the head');
  gated = await gateWith(true);
  ok(decision(gated, 'production-comments') === 'deploy', 'and it deploys once the live production-write is the head source');
  gated = await gateWith(false, true);
  ok(decision(gated, 'production-comments') === 'held' && /skipped/.test(gated.drift_guard)
    && /Drift guard: skipped/.test(gated.__summary), 'a manual run keeps the order rule, and its summary says it skipped the drift guard');
  gated = await gateWith(true, true);
  ok(/DRIFT|recent main version/.test(gated.functions[0].drift) && gated.functions[0].decision === 'deploy', 'a manual run reports drift per function instead of holding');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---- 2. the merge lane keeps the manual lanes' safety ------------------------
const lane = read('.github/workflows/deploy-edge-functions-on-merge.yml');
const at = s => lane.indexOf(s);
ok(/^  push:\n    branches: \[main\]/m.test(lane) && /^  workflow_dispatch:/m.test(lane), 'runs on a merge to main and keeps a manual dispatch');
ok(/\n    environment: production\n/.test(lane) && /cancel-in-progress: false/.test(lane), 'production Environment, one run at a time, never cancelled midway');
ok(at('merge-base --is-ancestor "$DEPLOY_COMMIT" origin/main') > 0 && at('merge-base --is-ancestor "$DEPLOY_COMMIT" origin/main') < lane.search(/secrets\./)
  && at('ref: ${{ github.event.repository.default_branch }}') < at('ref: ${{ env.DEPLOY_COMMIT }}'),
'main ancestry is proven from the trusted default branch before any secret or checkout of the commit');
ok(!/^    env:\n(?:      [^\n]*\n)*      SUPABASE_ACCESS_TOKEN:/m.test(lane), 'the token is never job-wide');
const deployLines = lane.match(/supabase functions deploy [^\n]*/g) || [];
ok(deployLines.length === 1 && deployLines[0].includes('--no-verify-jwt'), 'one deploy command, verify_jwt off');
ok(/production-write\|deliverable-write\|batch-write\|calendar-upsert\|sample-review-upsert\|linear-inbound\|linear-outbound\|client-token-verify\)\n\s+# Defense in depth/.test(lane),
  'the Section 4 three and every manual function are refused by name before the deploy command');
const attest = lane.slice(at('- name: Attest every function this job deployed'), at('- name: Report'));
ok(attest.includes('x.result!=="PASS"||x.verify_jwt!==false') && /^\s+if: always\(\) && steps\.plan\.outputs\.any == 'true' && steps\.deploy_units\.outputs\.deployed != ''/m.test(attest),
  'every deployed function is attested (fingerprint and JWT), also when a later deploy failed, and only what was deployed');
ok(lane.includes('(IFS=,; echo "deployed=${deployed[*]}" >> "$GITHUB_OUTPUT")') && lane.indexOf('deployed+=("$unit")') < lane.indexOf('echo "deployed=${deployed[*]}"'),
  'the deployed list is written after every deploy, so a later failure cannot lose it');
ok(lane.includes('status=success&per_page=1') && !/status=completed/.test(lane) && lane.includes('exit 1') && lane.includes('Failing instead of guessing from the push\'s own before'),
  'a run starts from the last FULLY successful run, and a failed runs lookup fails the run instead of falling back to the push before');
ok(at('- name: Gate on live state') < at('- name: Deploy in order') && at('- name: Deploy in order') < at('- name: Attest every function'), 'gate, then deploy, then attest');
ok(lane.includes('scripts/ef-auto-deploy-notice.js') && lane.includes('SLACK_ALERT_WEBHOOK: ${{ secrets.SLACK_ALERT_WEBHOOK }}'), 'failure or hold pages the owner relay');
for (const old of ['deploy-onboarding-edge-functions', 'deploy-pto-edge-functions', 'deploy-thumbnail-edge-functions', 'deploy-description-image-upload']) {
  const text = read(`.github/workflows/${old}.yml`);
  ok(!/^  push:/m.test(text) && /^  workflow_dispatch:/m.test(text), `${old}.yml is the manual fallback now (no push trigger, dispatch kept)`);
}
for (const file of fs.readdirSync(path.join(ROOT, '.github/workflows'))) {
  const text = read(`.github/workflows/${file}`);
  if (file === 'deploy-f27-section4-closures.yml' || !/^  push:/m.test(text)) continue;
  ok(!/supabase functions deploy[^\n]*\b(production-write|deliverable-write|batch-write)\b/.test(text)
    && !/for fn in [^\n]*\b(production-write|deliverable-write|batch-write)\b/.test(text),
  `${file}: a workflow that runs on a push never deploys a Section 4 function itself`);
}

// ---- 3. the Section 4 lane's in-run capture ----------------------------------
const f27 = read('.github/workflows/deploy-f27-section4-closures.yml');
const step = name => { const i = f27.indexOf(`- name: ${name}`); return i < 0 ? '' : f27.slice(i, f27.indexOf('\n      - name:', i + 1)); };
const validate = step('Validate the reviewed Section 4 release and operation');
const capture = step('Capture and seal the live prior three (read only)');
const store = step('Store the sealed bundle in the F27 Shared Drive root (independent readback)');
const fetchStep = step('Fetch and independently verify the sealed prior-three source');
ok(/^on:\n  workflow_dispatch:/m.test(f27) && !/^  push:/m.test(f27), 'the Section 4 lane stays dispatch-only');
ok(validate.includes('A restore needs the recorded sealed bundle values, never a new capture')
  && validate.includes('Pass capture as BOTH bundle inputs'), 'a restore never captures, and capture is all or nothing');
ok(f27.indexOf('- name: Validate the reviewed') < f27.indexOf('- name: Capture and seal')
  && f27.indexOf('- name: Capture and seal') < f27.indexOf('- name: Store the sealed bundle')
  && f27.indexOf('- name: Store the sealed bundle') < f27.indexOf('- name: Fetch and independently verify'),
'validate, capture, store, then the unchanged fetch and inspect');
ok(capture.includes("if: env.F27_CAPTURE_IN_RUN == 'true'") && store.includes("if: env.F27_CAPTURE_IN_RUN == 'true'"), 'capture and store run only in capture mode');
ok(capture.includes('node scripts/f27-edge-source-rollback.js capture \\\n            --slugs=production-write,deliverable-write,batch-write')
  && capture.includes("receipt.provider_contract !== 'PASS'") && capture.includes("receipt.provider_source_exactness !== 'PASS'")
  && capture.includes('independent.live_fingerprint !== row.source_closure_sha256'),
'the capture is the owner script itself, exact slugs, and must agree with an independent live fingerprint read');
ok(store.includes('--artifact-kind edge-source') && store.includes("receipt.independent_private_readback !== 'PASS'")
  && store.includes('rm -f -- "$F27_CAPTURED_BUNDLE"'),
'stored content-addressed with an independent readback, and the local copy removed so the fetch reads Drive');
ok(fetchStep.includes('--expected-sha256 "$ROLLBACK_BUNDLE_SHA256"') && fetchStep.includes('--expected-byte-length "$ROLLBACK_BUNDLE_BYTE_LENGTH"')
  && fetchStep.includes('receipt.folder_id_sha256 !== process.env.EXPECTED_F27_SHARED_DRIVE_ROOT_ID_SHA256'),
'the fetch still verifies the exact hash, length and pinned Drive root');
const f27sh = read('scripts/ef-auto-deploy-f27.sh');
ok(f27sh.includes('-f operation=deploy-reviewed-release') && f27sh.includes('-f rollback_bundle_sha256=capture')
  && f27sh.includes('"Validate the reviewed Section 4 release and operation"'),
'the merge lane dispatches the reviewed operation in capture mode, and retries only a refusal at validation');

// Section 4 is dispatched only at the planned commit, or at a tip with nothing the lane plans from changed since.
ok(f27sh.includes('tip_is_safe "$tip" || exit $?') && f27sh.includes('return 3') && lane.includes('"$rc" = 3') && lane.includes('handed-over'),
  'Section 4 hands over to the tip\'s own run instead of dispatching a commit that was not planned');
{
  const fn = f27sh.slice(f27sh.indexOf('tip_is_safe() {'), f27sh.indexOf('\n}\n', f27sh.indexOf('tip_is_safe() {')) + 3);
  const w = f27sh.slice(f27sh.indexOf('watched=('), f27sh.indexOf('\n\npins_match'));
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ef-auto-tip-'));
  try {
    const g2 = (...a) => execFileSync('git', ['-C', tmp2, ...a], { encoding: 'utf8' }).trim();
    g2('init', '-q', '-b', 'main'); g2('config', 'user.email', 't@example.invalid'); g2('config', 'user.name', 't');
    fs.mkdirSync(path.join(tmp2, 'supabase/functions/a'), { recursive: true });
    fs.writeFileSync(path.join(tmp2, 'supabase/functions/a/index.ts'), '1');
    g2('add', '.'); g2('commit', '-q', '-m', 'planned'); const planned = g2('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(tmp2, 'README.md'), 'docs'); g2('add', '.'); g2('commit', '-q', '-m', 'docs'); const docs = g2('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(tmp2, 'supabase/functions/a/index.ts'), '2'); g2('add', '.'); g2('commit', '-q', '-m', 'function'); const fnTip = g2('rev-parse', 'HEAD');
    const rc = tip => spawnSync('bash', ['-c', `${w}\npins_match() { return 0; }\n${fn}\ntip_is_safe ${tip}`], { cwd: tmp2, encoding: 'utf8', env: { ...process.env, DEPLOY_COMMIT: planned, GITHUB_STEP_SUMMARY: '/dev/null' } }).status;
    ok(rc(planned) === 0, 'the planned commit is dispatched');
    ok(rc(docs) === 0, 'a tip that only added docs is dispatched (its three functions and migrations are the planned ones)');
    ok(rc(fnTip) === 3, 'a tip with a function change since the plan is handed over (exit 3), never dispatched');
  } finally { fs.rmSync(tmp2, { recursive: true, force: true }); }
}

// ---- 4. the notice is public-safe -------------------------------------------
const { noticeSpec } = require(path.join(ROOT, 'scripts', 'ef-auto-deploy-notice.js'));
const spec = noticeSpec({ head: 'a'.repeat(40), functions: [{ slug: 'beta', decision: 'held' }] }, { alpha: 'failed' });
const r = spawnSync(process.execPath, ['--input-type=module', '-e',
  `import { relayPayload } from ${JSON.stringify(path.join(ROOT, 'supabase/functions/_shared/monitoring-alert-relay-core.mjs'))};
   const p = relayPayload(${JSON.stringify(spec)}); process.stdout.write(p.type + ' ' + p.issue_identifier);`], { encoding: 'utf8' });
ok(r.status === 0 && r.stdout.startsWith('ef_auto_deploy failed_alpha_held_beta'), 'the notice names what failed and what is held, through the relay screen');
ok(noticeSpec({ head: 'a'.repeat(40), functions: [] }, { '@f27-section4': 'handed-over' }, 'success') === null, 'handing Section 4 to the newer tip pages nobody (that run pages if it fails)');
ok(noticeSpec({ head: 'a'.repeat(40), functions: [] }, { '@f27-section4': 'handed-over', alpha: 'failed' }, 'failure') !== null, 'but a real failure alongside it still pages');

if (failures) { console.error(`\n${failures} Edge-Functions-on-merge check(s) failed`); process.exit(1); }
console.log('\nEdge Functions on merge checks passed');
})().catch(e => { console.error(e); process.exit(1); });
