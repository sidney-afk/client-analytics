'use strict';
/*
 * The overnight runner uses the scenario/probe label in a per-command log file.
 * On Windows a single path component over ~255 chars makes the shell redirection
 * fail before the test command starts, which can turn a real scenario batch into
 * an empty, unactionable FAIL. Exercise the runner's own slug() helper against
 * the longest current scenario label so future batches stay below that limit.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const bashCheck = spawnSync('bash', ['--version'], { encoding: 'utf8' });
if (bashCheck.error && bashCheck.error.code === 'ENOENT') {
  console.log('overnight-runner-output-path: skipped (bash unavailable)');
  process.exit(0);
}

const root = path.resolve(__dirname, '..');
const runner = path.join(root, 'qa', 'overnight_runner.sh');
const src = fs.readFileSync(runner, 'utf8');
const match = src.match(/(?:^|\n)slug\(\) \{[\s\S]*?\n\}/);
if (!match) {
  console.error('Could not find slug() in qa/overnight_runner.sh');
  process.exit(1);
}

const worstLabel = 'scn:resolve_via_kasper_video,resolve_via_client_video,resolve_via_approved_video,resolve_via_stay_video,resolve_via_kasper_graphic,reopen_tweak_video,delete_comment_video,kasper_undo_video,kasper_finish_video,kasper_close_resurface_video';
const bash = [
  'set -e',
  match[0].trim(),
  'slug "$1"',
].join('\n');
const r = spawnSync('bash', ['-lc', bash, 'bash', worstLabel], { encoding: 'utf8' });
if (r.status !== 0) {
  console.error(r.stderr || r.stdout || 'slug() failed');
  process.exit(r.status || 1);
}
const safe = r.stdout.trim();
const basename = `20260703T000000Z_${safe}.log`;
if (safe.length > 160 || basename.length > 200) {
  console.error(`overnight output slug too long: safe=${safe.length}, basename=${basename.length}`);
  process.exit(1);
}
console.log(`overnight-runner-output-path: safe=${safe.length}, basename=${basename.length} ✅`);
