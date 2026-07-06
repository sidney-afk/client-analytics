'use strict';
/*
 * The overnight runner mutates the shared sidneylaruel live test client. Two
 * copies running at once make otherwise-good browser scenarios race each other
 * and produce false product failures. The runner must acquire a singleton lock,
 * skip when another live runner owns it, and recover stale locks.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const bashCheck = spawnSync('bash', ['--version'], { encoding: 'utf8' });
if (bashCheck.error && bashCheck.error.code === 'ENOENT') {
  console.log('overnight-runner-singleton-lock: skipped (bash unavailable)');
  process.exit(0);
}

const root = path.resolve(__dirname, '..');
const runner = path.join(root, 'qa', 'overnight_runner.sh');
const src = fs.readFileSync(runner, 'utf8');

function extractFunction(name) {
  const start = src.indexOf(name + '()');
  if (start < 0) throw new Error('missing function ' + name);
  const brace = src.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unterminated function ' + name);
}

let lockFn;
try {
  lockFn = extractFunction('acquire_runner_lock');
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

if (!/kill -0/.test(lockFn) || !/LOCK_DIR/.test(lockFn)) {
  console.error('acquire_runner_lock must verify a live owner pid and use LOCK_DIR');
  process.exit(1);
}

function run(body) {
  const script = [
    'set -u',
    'TMPROOT="$(mktemp -d)"',
    'LOG="$TMPROOT/log"',
    'OUTDIR="$TMPROOT/out"',
    'mkdir -p "$OUTDIR"',
    'LOCK_DIR="$TMPROOT/runner.lock"',
    'stamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }',
    'log() { echo "[$(stamp)] $*" >> "$LOG"; }',
    lockFn,
    body,
  ].join('\n');
  return spawnSync('bash', ['-lc', script], { encoding: 'utf8' });
}

let r = run('acquire_runner_lock; test -f "$LOCK_DIR/pid"; echo acquired');
if (r.status !== 0 || !/acquired/.test(r.stdout)) {
  console.error('fresh lock was not acquired');
  console.error(r.stdout || r.stderr);
  process.exit(1);
}

r = run('mkdir "$LOCK_DIR"; echo $$ > "$LOCK_DIR/pid"; acquire_runner_lock; echo after_duplicate');
if (r.status !== 0 || /after_duplicate/.test(r.stdout)) {
  console.error('duplicate live lock did not exit before running work');
  console.error(r.stdout || r.stderr);
  process.exit(1);
}

r = run('mkdir "$LOCK_DIR"; echo 999999 > "$LOCK_DIR/pid"; acquire_runner_lock; test "$(cat "$LOCK_DIR/pid")" = "$$"; echo stale_recovered');
if (r.status !== 0 || !/stale_recovered/.test(r.stdout)) {
  console.error('stale lock was not recovered');
  console.error(r.stdout || r.stderr);
  process.exit(1);
}

console.log('overnight-runner-singleton-lock: fresh, duplicate, and stale-lock paths passed ✅');
