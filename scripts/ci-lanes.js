'use strict';
/*
 * Run several test commands side by side inside ONE CI job (session Express, 2026-10-19).
 *
 * GitHub gives the account 20 jobs at once, and the browser suites spend most of
 * their time waiting (a measured 128 s suite used 39 s of CPU), so a 4-CPU runner
 * can run three or four of them together. Packing them into one job gives a pull
 * request the same coverage with a third of the job-minutes.
 *
 * Usage (the commands arrive on stdin, one per line, `name|command`):
 *   node scripts/ci-lanes.js --lanes=3 <<'LANES'
 *   Dialogs stay open on a press that starts inside them|node test/dialog-backdrop-press-browser.js
 *   LANES
 *
 * What it guarantees:
 *   - every command runs, even after another one fails (one red run names every
 *     broken suite), and the job fails when any command failed;
 *   - the commands start in the order listed, so put the slowest first;
 *   - each command has its own TMPDIR, so two suites never share a temp file;
 *   - each command's output is printed as one collapsed group when it finishes (so
 *     the log of a failed one is whole), with a heartbeat while it runs;
 *   - the end of the log is a table of every command with its time and result;
 *   - a cancelled job stops its children.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function parseLines(text) {
  const out = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('|');
    if (at < 1) throw new Error('lane line needs "name|command": ' + line);
    out.push({ name: line.slice(0, at).trim(), cmd: line.slice(at + 1).trim() });
  }
  return out;
}

function fmt(sec) { return sec >= 60 ? Math.floor(sec / 60) + ' min ' + String(Math.round(sec % 60)).padStart(2, '0') + ' s' : sec.toFixed(1) + ' s'; }

async function runLanes(items, opts) {
  const lanes = Math.max(1, Math.min(opts.lanes || 3, items.length || 1));
  const log = opts.log || (s => process.stdout.write(s + '\n'));
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-lanes-'));
  const results = [];
  const running = new Map();
  const children = new Set();
  let next = 0;
  let stopping = false;
  const t0 = Date.now();

  const beat = setInterval(() => {
    if (!running.size) return;
    const now = Date.now();
    log('... still running: ' + [...running].map(([n, t]) => n + ' (' + fmt((now - t) / 1000) + ')').join('; '));
  }, opts.heartbeatMs || 60000);

  function stop() {
    stopping = true;
    for (const c of children) { try { c.kill('SIGTERM'); } catch (e) { /* already gone */ } }
  }
  process.once('SIGTERM', () => { stop(); });
  process.once('SIGINT', () => { stop(); });

  async function worker(lane) {
    while (!stopping && next < items.length) {
      const idx = next++;
      const item = items[idx];
      const tmp = path.join(tmpRoot, 'job-' + idx);
      fs.mkdirSync(tmp, { recursive: true });
      const start = Date.now();
      running.set(item.name, start);
      const chunks = [];
      const code = await new Promise(resolve => {
        const child = spawn('bash', ['-c', item.cmd], { env: Object.assign({}, process.env, { TMPDIR: tmp }), stdio: ['ignore', 'pipe', 'pipe'] });
        children.add(child);
        child.stdout.on('data', d => chunks.push(d));
        child.stderr.on('data', d => chunks.push(d));
        child.on('error', e => { chunks.push(Buffer.from(String(e) + '\n')); resolve(127); });
        child.on('close', (c, sig) => { children.delete(child); resolve(c === null ? (sig ? 128 : 1) : c); });
      });
      running.delete(item.name);
      const sec = (Date.now() - start) / 1000;
      const r = { name: item.name, cmd: item.cmd, code, sec, lane };
      results[idx] = r;
      log('::group::' + (code === 0 ? 'PASS ' : 'FAIL ') + item.name + ' (' + fmt(sec) + ', lane ' + lane + ')');
      log('$ ' + item.cmd);
      log(Buffer.concat(chunks).toString('utf8').replace(/\s+$/, ''));
      log('::endgroup::');
      if (code !== 0) log('::error title=' + item.name.replace(/[,:\r\n]/g, ' ') + '::exited with code ' + code);
    }
  }

  await Promise.all(Array.from({ length: lanes }, (_, i) => worker(i + 1)));
  clearInterval(beat);
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  const done = results.filter(Boolean);
  const failed = done.filter(r => r.code !== 0);
  const wall = (Date.now() - t0) / 1000;
  const serial = done.reduce((a, r) => a + r.sec, 0);
  const table = [
    '| Result | Time | Lane | Check |', '|---|---|---|---|',
    ...done.map(r => '| ' + (r.code === 0 ? 'pass' : 'FAIL (' + r.code + ')') + ' | ' + fmt(r.sec) + ' | ' + r.lane + ' | ' + r.name.replace(/\|/g, '/') + ' |'),
  ];
  log('');
  log(done.length + ' of ' + items.length + ' commands ran in ' + fmt(wall) + ' on ' + lanes + ' lanes (' + fmt(serial) + ' if run one after another); ' + failed.length + ' failed');
  for (const r of done) log((r.code === 0 ? '  pass ' : '  FAIL ') + fmt(r.sec).padStart(9) + '  ' + r.name);
  if (stopping) log('stopped early by a signal: ' + (items.length - done.length) + ' command(s) never started');
  if (opts.summaryFile) {
    try { fs.appendFileSync(opts.summaryFile, '### ' + (opts.title || 'Lanes') + ': ' + done.length + ' checks in ' + fmt(wall) + ' (' + fmt(serial) + ' one after another)\n\n' + table.join('\n') + '\n\n'); } catch (e) { /* summary is optional */ }
  }
  return { results: done, failed, wall, serial, stopped: stopping, notStarted: items.length - done.length };
}

module.exports = { parseLines, runLanes, fmt };

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = k => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
  const lanes = Number(get('lanes') || 3);
  if (!(lanes >= 1 && lanes <= 8)) throw new Error('--lanes must be 1 to 8');
  const items = parseLines(fs.readFileSync(0, 'utf8'));
  if (!items.length) throw new Error('no commands on stdin');
  runLanes(items, { lanes, title: get('title') || 'Checks', summaryFile: process.env.GITHUB_STEP_SUMMARY })
    .then(r => process.exit(r.failed.length || r.stopped ? 1 : 0), e => { console.error(e); process.exit(2); });
}
