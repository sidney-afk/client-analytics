'use strict';
// OPEN_REPAIRS 382. production-write answered 500 about 520 times between
// 2026-10-07 21:58 and 2026-10-08 19:10 UTC, all on comment saves: its round
// check refused only round < 0, so round 0 reached production_comments, whose
// CHECK (round IS NULL OR round > 0) threw. Round 0 must be saved as no round,
// never a 500; anything that is not a whole number of 0 or more stays a 400.
//   1. the rule itself (policy.mjs normalizeCommentRound), executed
//   2. both comment paths in index.ts go through it, and no `round < 0` check is left
//   3. on a real PostgreSQL 16 (when installed), the migration's own round
//      column refuses 0 (the 500) and accepts what the rule turns 0 into
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const FN = path.join(ROOT, 'supabase/functions/production-write');
let passed = 0;
let failed = 0;
const ok = (cond, msg) => { if (cond) { passed++; console.log('  ok  ' + msg); } else { failed++; console.log('FAIL  ' + msg); } };

(async () => {
  const policy = await import(pathToFileURL(path.join(FN, 'policy.mjs')).href + '?comment-round');
  const n = policy.normalizeCommentRound;
  ok(typeof n === 'function', 'policy.mjs exports normalizeCommentRound');
  const table = [[0, null], ['0', null], [null, null], [undefined, null], ['', null], [1, 1], [2, 2], ['3', 3],
    [-1, undefined], [1.5, undefined], ['x', undefined], [Number.NaN, undefined]];
  for (const [input, want] of table) {
    ok(Object.is(n(input), want), `round ${typeof input === "string" ? JSON.stringify(input) : String(input)} -> ${want === undefined ? 'refused (400)' : JSON.stringify(want)}`);
  }

  const src = fs.readFileSync(path.join(FN, 'index.ts'), 'utf8');
  const uses = src.match(/const round = commentRoundOrRefuse\(commentInput\.round\);/g) || [];
  ok(uses.length === 2, 'both comment paths (add reconstruction and the operation handler) read the round through the rule (' + uses.length + ')');
  ok(!/round\s*<\s*0\)\)\s*\{\s*throw new GatewayError\(400, "invalid_comment_round"\)/.test(src), 'the old check that let round 0 through is gone');
  const helper = src.match(/function commentRoundOrRefuse\(value: unknown\): number \| null \{([\s\S]*?)\n\}/);
  ok(helper && /round === undefined\) throw new GatewayError\(400, "invalid_comment_round"\)/.test(helper[1]),
    'only a value the rule refuses becomes an error, and that error is a 400, never a 500');
  ok(!/round: Number\.isInteger\(Number\(row\.round\)\)/.test(src) && /round: normalizeCommentRound\(row\.round\) \?\? null,/.test(src),
    'a comment the function sends back with no round says null, not 0 (Number(null) is 0)');
  ok(/normalizeCommentRound,/.test(src.slice(0, src.indexOf('} from "./policy.mjs"'))), 'index.ts imports the rule from policy.mjs');

  // 3. The table's own rule, from the migration that created it.
  const migration = fs.readFileSync(path.join(ROOT, 'migrations/2026-07-12-production-comments.sql'), 'utf8');
  const column = (migration.match(/^\s*round integer check \(round is null or round > 0\),/m) || [])[0];
  ok(!!column, 'production_comments still declares round integer check (round is null or round > 0)');
  const PG_BIN = '/usr/lib/postgresql/16/bin';
  if (!column || !fs.existsSync(path.join(PG_BIN, 'initdb'))) {
    console.log('SKIP PostgreSQL leg: PostgreSQL 16 not installed');
  } else {
    const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    const base = fs.mkdtempSync(path.join(asRoot ? '/var/tmp' : os.tmpdir(), 'comment-round-'));
    fs.chmodSync(base, 0o755);
    if (asRoot) spawnSync('chown', ['postgres', base]);
    const port = String(55000 + Math.floor(Math.random() * 4000));
    const as = (cmd, args) => asRoot
      ? spawnSync('runuser', ['-u', 'postgres', '--', cmd, ...args], { encoding: 'utf8' })
      : spawnSync(cmd, args, { encoding: 'utf8' });
    const data = path.join(base, 'data');
    let started = false;
    const psql = (sql) => spawnSync(path.join(PG_BIN, 'psql'),
      ['-h', base, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-At'],
      { input: sql, encoding: 'utf8' });
    try {
      assert.equal(as(path.join(PG_BIN, 'initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale']).status, 0);
      assert.equal(as(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-o', `-p ${port} -k ${base} -c listen_addresses=''`, '-l', path.join(base, 'log'), '-w', 'start']).status, 0);
      started = true;
      assert.equal(psql(`create table c (id serial primary key, ${column.trim().replace(/,$/, '')});`).status, 0);
      const zero = psql('insert into c(round) values (0);');
      ok(zero.status !== 0 && /check constraint/.test(zero.stderr), 'the table refuses round 0 (the error the function turned into a 500)');
      const normalized = n(0);
      const saved = psql(`insert into c(round) values (${normalized === null ? 'null' : normalized}) returning coalesce(round::text, 'null');`);
      ok(saved.status === 0 && saved.stdout.trim() === 'null', 'round 0 through the rule is saved, as no round');
      ok(psql('insert into c(round) values (2);').status === 0, 'a real round (2) is still saved as itself');
    } catch (e) {
      ok(false, 'PostgreSQL leg: ' + String(e && e.message || e));
    } finally {
      if (started) as(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop']);
      fs.rmSync(base, { recursive: true, force: true });
    }
  }

  console.log(`\nproduction-write comment round: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
