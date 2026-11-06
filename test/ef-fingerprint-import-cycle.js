'use strict';
/*
 * Regression: scripts/ef-fingerprint.js hung at 100% CPU on a function whose
 * files import each other (higgsfield-mcp isolate.mjs <-> voice.mjs, 2026-11-06).
 * The closure walk checked its visited map with the full path while the map is
 * keyed with 'supabase/' stripped, so the check never matched and a cycle looped
 * forever. Builds a throwaway git repo with an A <-> B cycle plus a self-import
 * and requires the walk to finish in seconds with every file counted once.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ef-cycle-'));
const run = (args, opts = {}) => spawnSync('git', args, { cwd: tmp, encoding: 'utf8', ...opts });
const write = (rel, text) => {
  const file = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
try {
  write('scripts/ef-fingerprint.js', fs.readFileSync(path.join(__dirname, '..', 'scripts', 'ef-fingerprint.js')));
  write('supabase/config.toml', 'project_id = "abcdefghijklmnopqrst"\n');
  write('supabase/functions/cyc/index.ts', 'import { a } from "./a.mjs";\nexport const x = a;\n');
  write('supabase/functions/cyc/a.mjs', 'import { b } from "./b.mjs";\nimport { a as self } from "./a.mjs";\nexport const a = 1;\n');
  write('supabase/functions/cyc/b.mjs', 'import { a } from "./a.mjs";\nexport const b = 2;\n');
  run(['init', '-q']);
  run(['add', '-A']);
  run(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'cycle']);
  const sha = run(['rev-parse', 'HEAD']).stdout.trim();
  const r = spawnSync(process.execPath, ['scripts/ef-fingerprint.js', sha, '--slugs=cyc', '--expected-only', '--format=json'],
    { cwd: tmp, encoding: 'utf8', timeout: 15000 });
  assert.ok(!r.error, 'the closure walk must finish, not hang: ' + (r.error && r.error.message));
  assert.strictEqual(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout).results[0];
  assert.strictEqual(result.expected_files, 3, 'index, a and b once each');
  assert.match(result.expected_fingerprint, /^[0-9a-f]{64}$/);
  console.log('ef-fingerprint-import-cycle: ok');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
