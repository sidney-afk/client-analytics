'use strict';
/*
 * qa/master.js — THE MASTER TESTER.
 *
 * One command that runs EVERY kind of test we have, against the REAL app in
 * headless Chromium + the LIVE backend, and rolls them into a single pass/fail
 * with one report. It does not reimplement the existing testers — it unifies
 * them behind one entry point, one server, one summary, one exit code.
 *
 * LANES (each is one of our existing testers, now a lane of the master):
 *   unit      — node test/run-all.js                  fast pure-logic, no browser
 *   parity    — _cal vs _sxr clone-parity probes       logic + DOM + render CSS
 *   probes    — calendar headless probes               (qa/probes/nightly-manifest.txt)
 *   scenarios — Samples multi-actor REAL-interaction    branching scenario tree, flattened
 *   temporal  — flicker / UI-latency probes             reaction speed + no-revert
 *   visual    — drives the flow with REAL clicks, screenshots every step, and
 *               emits a gallery + manifest for the VISION pass (the "eyes"):
 *               a reviewer (a human, or Claude via the /master-test skill) looks
 *               at the shots and judges "does it LOOK right AND did it DO the
 *               right thing." This is the lane that replaces manually opening
 *               the page and clicking around.
 *
 * PROFILES (how much to run):
 *   fast (default) — unit + parity(logic) + a scenario smoke set + a visual smoke
 *                    set. Meant to run on every change.
 *   full           — every lane, the whole scenario library, all nightly probes.
 *                    Meant for nightly / pre-release.
 *
 * USAGE:
 *   node qa/master.js                              # fast profile
 *   node qa/master.js --profile=full
 *   node qa/master.js --lane=unit,visual           # explicit lanes
 *   node qa/master.js --lane=visual --scn=clean_both,notes_audiences
 *   node qa/master.js --no-server                  # reuse an already-running :8000
 *
 * VISION: the visual lane CAPTURES; it does not auto-judge unless a vision
 * backend is wired up. After a run it prints "VISION REVIEW PENDING: N shots"
 * and writes qa/visual/manifest.json + qa/visual/VISUAL_REVIEW.md. The
 * /master-test skill (Claude in the loop) reads those shots and writes verdicts.
 *
 * SAFETY (same contract as docs/HEADLESS-TESTING-GUIDE.md §5):
 *   test client `sidneylaruel` ONLY · unique ids · archive on exit ·
 *   Linear ALWAYS mocked · assert 0 app JS errors.
 */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const VIS = require('./visual.js');
const VJUDGE = require('./vision_judge.js');

const ROOT = path.resolve(__dirname, '..');
const QA = __dirname;
const PROBES = path.join(QA, 'probes');
const TEST = path.join(ROOT, 'test');
const PORT = 8000;
const SHOT_DIR = process.env.SXR_SCN_SHOTS || '/tmp/qa/scn';
const VISUAL_DIR = path.join(QA, 'visual');
const PROBE_ATTEMPTS = Number(process.env.PROBE_ATTEMPTS || 3);
const PROBE_TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 240000);
const SCN_TIMEOUT_MS = Number(process.env.SCN_TIMEOUT_MS || 1800000); // suites loop in one process

// ---------------------------------------------------------------- arg parsing
function parseArgs(argv) {
  const a = { profile: 'fast', lanes: null, scn: null, server: true, repeat: 1, untilMs: 0, untilFail: false };
  for (const tok of argv) {
    if (tok === '--no-server') a.server = false;
    else if (tok.startsWith('--profile=')) a.profile = tok.slice(10);
    else if (tok.startsWith('--lane=')) a.lanes = tok.slice(7).split(',').map(s => s.trim()).filter(Boolean);
    else if (tok.startsWith('--scn=')) a.scn = tok.slice(6);
    else if (tok.startsWith('--repeat=')) a.repeat = Math.max(1, Number(tok.slice(9)) || 1);
    else if (tok.startsWith('--until=')) {
      // --until=fail  → loop until a lane fails
      // --until=90m / --until=6h / --until=45s → loop for a duration
      const v = tok.slice(8);
      if (v === 'fail') { a.untilFail = true; a.repeat = Infinity; }
      else { const m = v.match(/^(\d+)([smh])$/); if (m) { a.untilMs = Number(m[1]) * (m[2] === 's' ? 1e3 : m[2] === 'm' ? 6e4 : 36e5); a.repeat = Infinity; } }
    }
  }
  return a;
}

// What each profile runs, and the params per lane. A param of `null` filter
// means "everything"; a string filter is passed through to run_scenarios.js.
function profilePlan(profile) {
  if (profile === 'full') {
    return {
      unit: {},
      parity: { files: ['parity_logic.js', 'parity_check.js', 'render_parity.js', 'verify_chooser.js'] },
      realtime: {},   // Layer A (static parity) + Layer B (handler-injection probe)
      probes: { fromManifest: true },
      temporal: { glob: /^ot_temporal_.*\.js$/ },
      scenarios: { filter: null },
      tree: { filter: null },
      visual: { filter: null },
    };
  }
  // fast (default): the cheap, high-signal subset you run on every change.
  return {
    unit: {},
    parity: { files: ['parity_logic.js', 'realtime_parity.js'] },
    scenarios: { filter: 'clean_both,smm_request_video,client_approve_video' },
    visual: { filter: 'clean_both' },
  };
}

const LANE_ORDER = ['unit', 'parity', 'realtime', 'probes', 'temporal', 'scenarios', 'tree', 'visual'];

// ---------------------------------------------------------------- server mgmt
async function serverUp(ms = 2000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch('http://localhost:' + PORT + '/index.html', { signal: ac.signal }); return r.ok; }
  catch { return false; }
  finally { clearTimeout(t); }
}
async function waitForServer(ms = 30000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await serverUp()) return true; await new Promise(x => setTimeout(x, 500)); }
  return false;
}

// ---------------------------------------------------------------- run helpers
// Run one node file (a probe / suite) with retry, parse its "pass=N fail=N"
// summary line. ok is driven by exit code (0 == pass).
function runNode(file, opts = {}) {
  const { cwd = PROBES, args = [], attempts = 1, timeout = PROBE_TIMEOUT_MS, env = {} } = opts;
  let ok = false, lastOut = '', errNote = '', t0 = Date.now();
  for (let attempt = 1; attempt <= attempts && !ok; attempt++) {
    const r = spawnSync(process.execPath, [file, ...args], {
      cwd, encoding: 'utf8', timeout,
      env: { ...process.env, ...env },
      maxBuffer: 64 * 1024 * 1024,
    });
    lastOut = (r.stdout || '') + (r.stderr || '');
    ok = r.status === 0;
    // Distinguish INFRA failures from a plain non-zero exit, so a 30-min timeout
    // or a buffer overflow doesn't masquerade as an assertion failure in the report.
    errNote = '';
    if (!ok && r.error) {
      if (r.error.code === 'ETIMEDOUT') errNote = `timed out after ${Math.round(timeout / 1000)}s`;
      else if (r.error.code === 'ENOBUFS') errNote = 'output exceeded 64MB (truncated)';
      else errNote = 'spawn error: ' + (r.error.code || r.error.message);
    } else if (!ok && r.signal) errNote = 'killed by ' + r.signal;
  }
  const summaryLine = (lastOut.match(/[^\n]*pass=\d+ fail=\d+[^\n]*/g) || []).pop();
  return { ok, out: lastOut, summary: (summaryLine || '').trim(), errNote, ms: Date.now() - t0 };
}

function tail(s, n = 18) { return (s || '').split('\n').slice(-n).join('\n'); }
// Decorate a lane summary with an infra-failure note when present.
function withErr(summary, errNote) { return errNote ? ((summary ? summary + ' · ' : '') + '⚠ ' + errNote) : summary; }

// ---------------------------------------------------------------- lane runners
function laneUnit() {
  const r = runNode(path.join(TEST, 'run-all.js'), { cwd: ROOT, attempts: 1, timeout: 300000 });
  const m = r.out.match(/All (\d+) unit suites passed/);
  return { ok: r.ok, summary: r.ok ? `all ${m ? m[1] : '?'} unit suites passed` : withErr('unit suites FAILED', r.errNote), ms: r.ms, tail: r.ok ? '' : tail(r.out) };
}

function laneParity(cfg) {
  const files = (cfg.files || []).filter(f => fs.existsSync(path.join(PROBES, f)));
  if (!files.length) return { ok: true, summary: 'no parity files', ms: 0, tail: '', skipped: true };
  let okAll = true, parts = [], detail = '', ms = 0;
  for (const f of files) {
    const r = runNode(path.join(PROBES, f), { cwd: PROBES, attempts: 1 });
    ms += r.ms; okAll = okAll && r.ok;
    parts.push(`${r.ok ? '✓' : '✗'} ${f}${r.errNote ? ' [' + r.errNote + ']' : r.summary ? ' (' + r.summary + ')' : ''}`);
    if (!r.ok) detail += `\n--- ${f} ---\n` + tail(r.out);
  }
  return { ok: okAll, summary: parts.join('  '), ms, tail: detail };
}

// Realtime lane: the STATIC parity guard (Layer A — realtime_parity.js, instant,
// no browser) + the handler-injection probe (Layer B — p88_realtime_handler.js,
// real browser). A proves the WS is WIRED to call the handler; B proves the handler
// updates the never-reloaded UI (and that a no-op echo doesn't rebuild). The real
// WebSocket can't be tunneled headless, so this pair is how realtime gets tested.
// On-demand: `node qa/master.js --lane=realtime`. (Layer A also rides the parity
// lane on every run; Layer B also rides the probes lane via the nightly manifest.)
function laneRealtime() {
  const files = [
    { f: 'realtime_parity.js', browser: false },
    { f: 'p88_realtime_handler.js', browser: true },
  ].filter(x => fs.existsSync(path.join(PROBES, x.f)));
  if (!files.length) return { ok: true, summary: 'no realtime files', ms: 0, tail: '', skipped: true };
  let okAll = true, parts = [], detail = '', ms = 0;
  for (const { f, browser } of files) {
    const r = runNode(path.join(PROBES, f), { cwd: PROBES, attempts: browser ? PROBE_ATTEMPTS : 1, timeout: browser ? PROBE_TIMEOUT_MS : 60000 });
    ms += r.ms; okAll = okAll && r.ok;
    parts.push(`${r.ok ? '✓' : '✗'} ${f}${r.errNote ? ' [' + r.errNote + ']' : ''}`);
    if (!r.ok) detail += `\n--- ${f} ---\n` + tail(r.out, 25);
  }
  return { ok: okAll, summary: parts.join('  '), ms, tail: detail };
}

function readManifest() {
  const mf = path.join(PROBES, 'nightly-manifest.txt');
  if (!fs.existsSync(mf)) return fs.readdirSync(PROBES).filter(f => /^p.*\.js$/.test(f) && f !== 'lib.js').sort();
  return fs.readFileSync(mf, 'utf8').split('\n').map(l => l.replace(/#.*$/, '').trim()).filter(Boolean)
    .map(n => (n.endsWith('.js') ? n : n + '.js'));
}

function laneProbes() {
  const probes = readManifest().filter(f => fs.existsSync(path.join(PROBES, f)));
  if (!probes.length) return { ok: true, summary: 'no probes', ms: 0, tail: '', skipped: true };
  const failed = []; let ms = 0;
  for (const f of probes) {
    const r = runNode(path.join(PROBES, f), { cwd: PROBES, attempts: PROBE_ATTEMPTS });
    ms += r.ms; if (!r.ok) failed.push(f + (r.errNote ? ' [' + r.errNote + ']' : ''));
  }
  return {
    ok: failed.length === 0, ms,
    summary: failed.length ? `${failed.length}/${probes.length} FAILED: ${failed.join(', ')}` : `all ${probes.length} probes passed`,
    tail: '',
  };
}

function laneTemporal(cfg) {
  const files = fs.readdirSync(PROBES).filter(f => cfg.glob.test(f)).sort();
  if (!files.length) return { ok: true, summary: 'no temporal probes', ms: 0, tail: '', skipped: true };
  const failed = []; let ms = 0;
  for (const f of files) {
    const r = runNode(path.join(PROBES, f), { cwd: PROBES, attempts: 2 });
    ms += r.ms; if (!r.ok) failed.push(f + (r.errNote ? ' [' + r.errNote + ']' : ''));
  }
  return { ok: failed.length === 0, ms, summary: failed.length ? `${failed.length}/${files.length} FAILED: ${failed.join(', ')}` : `all ${files.length} temporal probes passed`, tail: '' };
}

function laneScenarios(cfg) {
  const args = []; if (cfg.filter) args.push(cfg.filter);
  const r = runNode(path.join(PROBES, 'run_scenarios.js'), { cwd: ROOT, args, attempts: 1, timeout: SCN_TIMEOUT_MS });
  const scn = (r.out.match(/scenarios:\s*([^\n]+)/) || [])[1] || '';
  const asr = (r.out.match(/assertions:\s*([^\n]+)/) || [])[1] || '';
  const base = [scn && 'scenarios ' + scn.trim(), asr && 'assertions ' + asr.trim()].filter(Boolean).join(' · ') || (r.ok ? 'passed' : 'FAILED');
  return { ok: r.ok, summary: withErr(base, r.errNote), ms: r.ms, tail: r.ok ? '' : tail(r.out, 25) };
}

// Same engine as scenarios, but specs come from the BRANCHING scenario tree
// (qa/scenario_tree.js, compiled to flat paths) via run_scenarios.js --tree.
function laneTree(cfg) {
  const args = []; if (cfg.filter) args.push(cfg.filter); args.push('--tree');
  const r = runNode(path.join(PROBES, 'run_scenarios.js'), { cwd: ROOT, args, attempts: 1, timeout: SCN_TIMEOUT_MS });
  const scn = (r.out.match(/scenarios:\s*([^\n]+)/) || [])[1] || '';
  const asr = (r.out.match(/assertions:\s*([^\n]+)/) || [])[1] || '';
  const base = [scn && 'tree paths ' + scn.trim(), asr && 'assertions ' + asr.trim()].filter(Boolean).join(' · ') || (r.ok ? 'passed' : 'FAILED');
  return { ok: r.ok, summary: withErr(base, r.errNote), ms: r.ms, tail: r.ok ? '' : tail(r.out, 25) };
}

// Visual lane: drive scenarios WITH screenshots, then build a manifest + review
// doc for the vision pass. Capture failing != lane failing; the lane only fails
// if the capture run itself errored (so a UI bug surfaces in the vision pass,
// not as a false green/red here).
function laneVisual(cfg) {
  try { fs.rmSync(SHOT_DIR, { recursive: true, force: true }); } catch {}
  const args = [cfg.filter || '', '--shots'].filter(Boolean);
  const r = runNode(path.join(PROBES, 'run_scenarios.js'), { cwd: ROOT, args, attempts: 1, timeout: SCN_TIMEOUT_MS });
  const manifest = VIS.writeArtifacts(SHOT_DIR, VISUAL_DIR, process.env.MASTER_CHANGE_NOTE || '');
  const nShots = VIS.countShots(manifest);
  const scn = (r.out.match(/scenarios:\s*([^\n]+)/) || [])[1] || '';
  const asr = (r.out.match(/assertions:\s*([^\n]+)/) || [])[1] || '';
  // captureOk = the flow actually ran to completion AND produced shots. A flow
  // that crashed or failed mid-way is a REAL failure that counts toward the run —
  // distinct from "shots captured, awaiting the vision verdict" (never fails).
  // Relying on nShots>0 alone would let a flow that dies after step 1 ride through
  // green, because the engine still wrote that first frame.
  const captureOk = r.ok && nShots > 0;
  const bits = [];
  if (nShots) bits.push(`${nShots} screenshots across ${manifest.length} flow(s)`);
  if (scn) bits.push('scenarios ' + scn.trim());
  if (asr) bits.push('assertions ' + asr.trim());
  if (!r.ok) bits.push('⚠ capture ' + (r.errNote || 'exited non-zero'));

  // Optional automated vision pass (MASTER_VISION=cli|api|auto; off by default).
  // When it runs, a `broken` verdict fails the run; otherwise the lane just pends
  // the verdict for a human / the /master-test skill.
  let visionRan = false, visionOk = true;
  if (captureOk) {
    const vres = VJUDGE.judgeAndWrite(manifest, VISUAL_DIR, { changeNote: process.env.MASTER_CHANGE_NOTE || '' });
    if (vres.backend !== 'off') {
      visionRan = true;
      visionOk = vres.broken === 0;
      bits.push(`vision[${vres.backend}] ${vres.broken} broken · ${vres.warn} warn`);
    }
  }
  const needsVision = captureOk && !visionRan;
  if (needsVision) bits.push('VISION REVIEW PENDING');
  return {
    ok: captureOk && visionOk,      // capture failed, OR the auto-vision pass found something broken
    needsVision,                    // pend a human/Claude verdict only when not auto-judged
    summary: bits.join(' · ') || 'no screenshots captured',
    ms: r.ms,
    tail: captureOk ? '' : tail(r.out, 25),
    manifest,
  };
}

// ---------------------------------------------------------------- orchestrator
(async () => {
  const args = parseArgs(process.argv.slice(2));
  const plan = profilePlan(args.profile);
  if (args.scn != null) { if (plan.scenarios) plan.scenarios.filter = args.scn; if (plan.tree) plan.tree.filter = args.scn; if (plan.visual) plan.visual.filter = args.scn; }
  let lanes = args.lanes || LANE_ORDER.filter(l => plan[l]);
  const unknown = lanes.filter(l => !LANE_ORDER.includes(l));
  lanes = lanes.filter(l => LANE_ORDER.includes(l));
  // A --lane list that resolves to nothing is a usage bug, not a green run.
  if (unknown.length) console.error(`Unknown lane(s): ${unknown.join(', ')} — known: ${LANE_ORDER.join(', ')}`);
  if (!lanes.length) { console.error('No known lanes selected — exiting.'); process.exit(2); }

  const needsBrowser = lanes.some(l => l !== 'unit');
  console.log(`\n🧪 MASTER TESTER — profile=${args.profile}  lanes=[${lanes.join(', ')}]\n`);

  let srv = null, killServer = () => {};
  if (needsBrowser && args.server) {
    if (await serverUp()) { console.log('Static server already up on :' + PORT + '.'); }
    else {
      console.log('Starting static server on :' + PORT + ' …');
      srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore', detached: true });
      killServer = () => { try { process.kill(-srv.pid); } catch { try { srv.kill('SIGKILL'); } catch {} } };
      process.on('exit', killServer);
      if (!(await waitForServer())) { console.error('Server never came up on :' + PORT); killServer(); process.exit(2); }
    }
  }

  function runLanesOnce() {
    const results = {};
    for (const lane of lanes) {
      process.stdout.write(`▶ ${lane} … `);
      let res;
      try {
        if (lane === 'unit') res = laneUnit();
        else if (lane === 'parity') res = laneParity(plan.parity || { files: [] });
        else if (lane === 'realtime') res = laneRealtime();
        else if (lane === 'probes') res = laneProbes();
        else if (lane === 'temporal') res = laneTemporal(plan.temporal || { glob: /^ot_temporal_.*\.js$/ });
        else if (lane === 'scenarios') res = laneScenarios(plan.scenarios || { filter: null });
        else if (lane === 'tree') res = laneTree(plan.tree || { filter: null });
        else if (lane === 'visual') res = laneVisual(plan.visual || { filter: null });
      } catch (e) { res = { ok: false, summary: 'LANE CRASHED: ' + (e.message || e), ms: 0, tail: '' }; }
      results[lane] = res;
      const tag = res.skipped ? '∅' : res.needsVision ? '👁' : res.ok ? '✅' : '❌';
      console.log(`${tag}  ${res.summary}  (${(res.ms / 1000).toFixed(0)}s)`);
      if (res.tail) console.log(res.tail + '\n');
    }
    return results;
  }

  // Marathon loop: --repeat=N re-runs the lane set N times; --until=<dur> loops
  // for a time budget; --until=fail loops until something breaks. Each iteration
  // stamps fresh scenario ids (the runner does that per invocation), so repeats
  // never collide. Aggregate exit: non-zero if ANY iteration hard-failed.
  const startedAt = Date.now();
  const iterations = [];
  let results = null, anyFail = false, iter = 0;
  for (;;) {
    iter++;
    if (args.repeat !== 1 || args.untilMs || args.untilFail) console.log(`\n══════ ITERATION ${iter}${Number.isFinite(args.repeat) ? ' / ' + args.repeat : ''} ══════`);
    results = runLanesOnce();
    const iterFail = Object.entries(results).some(([, r]) => !r.skipped && !r.ok);
    anyFail = anyFail || iterFail;
    iterations.push({ n: iter, failed: iterFail, ms: Date.now() - startedAt, lanes: Object.fromEntries(Object.entries(results).map(([k, r]) => [k, { ok: !!r.ok, skipped: !!r.skipped, needsVision: !!r.needsVision, summary: r.summary, ms: r.ms }])) });
    writeJsonReport(args, lanes, iterations, anyFail, startedAt);   // durable after EVERY iteration
    if (args.untilFail && iterFail) break;
    if (args.untilMs && Date.now() - startedAt >= args.untilMs) break;
    if (!args.untilMs && !args.untilFail && iter >= args.repeat) break;
  }

  killServer();

  // A lane fails the run if it failed and wasn't skipped. For the visual lane, `ok`
  // means CAPTURE succeeded — a clean capture sets needsVision (shown as 👁, NOT a
  // fail); only a crashed/incomplete capture marks visual !ok and fails the run.
  // (The vision VERDICT itself is downstream — the /master-test skill / a human.)
  const hardFail = anyFail;
  const vis = results.visual;

  console.log('\n================= MASTER SUMMARY =================');
  if (iterations.length > 1) console.log(`  iterations: ${iterations.length} (${iterations.filter(i => i.failed).length} failed)`);
  for (const lane of lanes) {
    const r = results[lane];
    const tag = r.skipped ? '∅ skip' : r.needsVision ? '👁 vision' : r.ok ? '✅ pass' : '❌ FAIL';
    console.log(`  ${lane.padEnd(10)} ${tag.padEnd(10)} ${r.summary}`);
  }
  if (vis && vis.needsVision) {
    console.log(`\n👁  VISION REVIEW PENDING — ${VIS.countShots(vis.manifest)} shots in ${SHOT_DIR}`);
    console.log(`    checklist: ${path.join(VISUAL_DIR, 'VISUAL_REVIEW.md')}  ·  manifest: ${path.join(VISUAL_DIR, 'manifest.json')}`);
    console.log(`    run the /master-test skill to have Claude review them, or open them yourself.`);
  }
  console.log('\n' + (hardFail ? '❌ MASTER: one or more lanes FAILED' : '✅ MASTER: all pass/fail lanes green'));
  writeReport(args, lanes, results, hardFail, iterations);
  process.exit(hardFail ? 1 : 0);
})().catch(e => { console.error('MASTER ERROR', e && e.stack || e); process.exit(2); });

// Machine-readable run report, rewritten after every iteration so a killed
// marathon still leaves its full history on disk.
function writeJsonReport(args, lanes, iterations, anyFail, startedAt) {
  try {
    const dir = path.join(QA, 'reports');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'master-' + new Date(startedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json');
    fs.writeFileSync(f, JSON.stringify({ startedAt: new Date(startedAt).toISOString(), profile: args.profile, scn: args.scn, lanes, repeat: args.repeat === Infinity ? 'until' : args.repeat, failed: anyFail, iterations }, null, 1));
  } catch {}
}

function writeReport(args, lanes, results, hardFail, iterations) {
  const L = [];
  L.push('# Master tester report');
  L.push('');
  L.push(`- profile: \`${args.profile}\``);
  L.push(`- lanes: \`${lanes.join(', ')}\``);
  if (iterations && iterations.length > 1) L.push(`- iterations: ${iterations.length} (${iterations.filter(i => i.failed).length} failed)`);
  L.push(`- result: ${hardFail ? '❌ FAILED' : '✅ green'}`);
  L.push('');
  L.push('| lane | status | summary | time |');
  L.push('|------|--------|---------|------|');
  for (const lane of lanes) {
    const r = results[lane];
    const st = r.skipped ? '∅ skip' : r.needsVision ? '👁 vision pending' : r.ok ? '✅ pass' : '❌ FAIL';
    L.push(`| ${lane} | ${st} | ${(r.summary || '').replace(/\|/g, '\\|')} | ${(r.ms / 1000).toFixed(0)}s |`);
  }
  L.push('');
  if (results.visual && results.visual.needsVision) {
    L.push(`> 👁 Visual lane captured screenshots in \`${SHOT_DIR}\`. See \`qa/visual/VISUAL_REVIEW.md\` for the per-shot checklist; the \`/master-test\` skill has Claude judge them.`);
    L.push('');
  }
  try { fs.writeFileSync(path.join(QA, 'MASTER_REPORT.md'), L.join('\n')); } catch {}
}
