'use strict';
/*
 * repo-vs-live.js: the read-only "repo vs live" shelf report
 * (scripts/repo-vs-live.js, scripts/repo-vs-live-shelf.json). Offline, made-up
 * live facts only; never calls Supabase or GitHub.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const m = require('../scripts/repo-vs-live.js');

let n = 0;
const ok = (c, msg) => { assert.ok(c, msg); n++; };
const throws = (fn, msg) => { assert.throws(fn, Error, msg); n++; };

// 1. Probes may only read.
ok(m.assertReadOnlyProbe("select to_regclass('public.x') is not null"), 'a plain select is accepted');
ok(m.assertReadOnlyProbe("select has_function_privilege('anon', 1::oid, 'EXECUTE')"), 'a privilege name inside quotes is data, not a command');
throws(() => m.assertReadOnlyProbe('update t set a = 1'), 'an update is refused');
throws(() => m.assertReadOnlyProbe('select 1; drop table t'), 'two statements are refused');
throws(() => m.assertReadOnlyProbe('with x as (delete from t returning 1) select * from x'), 'a writing CTE is refused');
throws(() => m.assertReadOnlyProbe('select 1 -- ; drop'), 'comments are refused');
throws(() => m.assertReadOnlyProbe("select pg_read_file('/etc/passwd')"), 'server file reads are refused');
ok(m.assertReadOnlyProbe("select 'a''; drop table t'"), 'a semicolon inside one quoted value is data');
throws(() => m.assertReadOnlyProbe("select 'a'; drop table t"), 'a statement after a closed quote is refused');

// 2. Only yes/no and counts are ever printed.
ok(m.shownValue(true) === 'yes' && m.shownValue(false) === 'no' && m.shownValue('t') === 'yes', 'booleans read as yes/no');
ok(m.shownValue(0) === '0' && m.shownValue('12') === '12', 'counts are printed');
ok(m.shownValue('Some Client Name') === '(hidden: not a yes/no or a count)', 'a text answer (a name) is never printed');
ok(m.shownValue('someone@example.com').startsWith('(hidden'), 'an email is never printed');
ok(m.shownValue({ error: 'HTTP 401 key=abc/def' }).length <= 60 && !m.shownValue({ error: 'x=abc/def' }).includes('/'), 'an error message is shortened and stripped');
ok(m.shownValue({ error: 'HTTP 401' }) === 'could not read (HTTP 401)', 'an error shows its status code');

// 3. Function closures follow local imports only.
const inv = new Set(['supabase/functions/a/index.ts', 'supabase/functions/_shared/x.ts', 'supabase/functions/_shared/y.mjs', 'supabase/functions/b/index.ts']);
const src = { 'supabase/functions/a/index.ts': 'import { x } from "../_shared/x.ts";\nimport z from "npm:zod";', 'supabase/functions/_shared/x.ts': "export * from './y.mjs';", 'supabase/functions/_shared/y.mjs': '' };
ok(JSON.stringify(m.closureFiles('a', inv, f => src[f])) === JSON.stringify(['supabase/functions/_shared/x.ts', 'supabase/functions/_shared/y.mjs', 'supabase/functions/a/index.ts']), 'the closure holds the entry and its local imports, not npm');
ok(m.closureFiles('missing', inv, () => '') === null, 'a folder with no entrypoint has no closure');

// 4. Functions: repo vs live.
const shelf = {
  functions: { held: { hold: 'frozen on purpose' }, waits: { entries: [1], lane: 'deploy-single-function.yml' } },
  owned_elsewhere: { 'other-fn': 'another-repo' },
  probes: [
    { id: 'p-switch', entry: 2, kind: 'switch', what: 'a switch', sql: 'select true', expect: true },
    { id: 'p-held', entry: 3, kind: 'database', what: 'a held change', sql: 'select true', expect: true, hold: 'owner paused it' },
    { id: 'p-count', entry: 4, kind: 'database', what: 'a count', sql: 'select 0', expect: 0 },
    { id: 'p-text', entry: 5, kind: 'database', what: 'a text answer', sql: 'select 1', expect: true },
    { id: 'p-error', entry: 6, kind: 'database', what: 'unreadable', sql: 'select 1', expect: true },
    { id: 'p-manual', entry: 7, kind: 'manual', what: 'a secret', how: 'cannot be read' },
    { id: 'p-lane', entry: 8, kind: 'lane', what: 'a lane', workflow: 'x.yml', expect: 'success' },
    { id: 'p-lane-red', entry: 9, kind: 'lane', what: 'a red lane', workflow: 'y.yml', expect: 'success' },
  ],
};
const repo = [
  { slug: 'same', files: 1, last_commit: 'aaaaaaaa', last_changed_at: '2026-10-01T00:00:00Z' },
  { slug: 'waits', files: 1, last_commit: 'bbbbbbbb', last_changed_at: '2026-10-08T00:00:00Z' },
  { slug: 'close', files: 1, last_commit: 'cccccccc', last_changed_at: '2026-10-02T03:00:00Z' },
  { slug: 'held', files: 1, last_commit: 'dddddddd', last_changed_at: '2026-10-08T00:00:00Z' },
  { slug: 'absent', files: 1, last_commit: 'eeeeeeee', last_changed_at: '2026-10-08T00:00:00Z' },
  { slug: 'bytes', files: 1, last_commit: 'ffffffff', last_changed_at: '2026-10-08T00:00:00Z' },
];
const live = {
  captured_at: '2026-10-09T00:00:00Z', source: 'test',
  functions: [
    { slug: 'same', version: 3, updated_at: '2026-10-02T00:00:00Z' },
    { slug: 'waits', version: 4, updated_at: '2026-10-02T00:00:00Z' },
    { slug: 'close', version: 5, updated_at: Date.parse('2026-10-02T01:00:00Z') },
    { slug: 'held', version: 6, updated_at: '2026-10-02T00:00:00Z' },
    { slug: 'bytes', version: 7, updated_at: '2026-10-02T00:00:00Z' },
    { slug: 'other-fn', version: 1, updated_at: '2026-10-02T00:00:00Z' },
    { slug: 'stray', version: 1, updated_at: '2026-10-02T00:00:00Z' },
  ],
  fingerprints: { bytes: 'PASS' },
  probes: { 'p-switch': false, 'p-held': false, 'p-count': '0', 'p-text': 'Some Client Name', 'p-error': { error: 'HTTP 500' } },
  lanes: { 'p-lane': { conclusion: 'success', created_at: '2026-10-09T01:00:00Z', event: 'schedule' }, 'p-lane-red': { conclusion: 'failure', created_at: '2026-10-09T01:00:00Z', event: 'schedule' } },
};
const report = m.buildReport({ sha: '0'.repeat(40), repo, live, shelf });
const v = id => report.rows.find(r => r.id === id).verdict;
ok(v('same') === 'LIVE', 'deployed after the last repo change reads LIVE');
ok(v('waits') === 'WAITING', 'a repo change days after the live deploy reads WAITING');
ok(v('close') === 'CHECK BYTES', 'a repo change within a day of the deploy asks for a byte check, never guesses');
ok(v('held') === 'HELD', 'a held function reads HELD, not WAITING');
ok(v('absent') === 'WAITING' && report.rows.find(r => r.id === 'absent').live === 'not deployed', 'a function missing live reads WAITING, not deployed');
ok(v('bytes') === 'LIVE', 'a byte PASS wins over a newer repo date');
ok(v('other-fn') === 'ELSEWHERE' && v('stray') === 'UNKNOWN', 'live-only functions are named elsewhere or unknown');
ok(v('p-switch') === 'WAITING' && v('p-held') === 'HELD' && v('p-count') === 'LIVE', 'switches, holds and counts');
ok(v('p-text') === 'WAITING', 'a text answer never counts as a match');
ok(v('p-error') === 'UNKNOWN' && v('p-manual') === 'NOT MEASURED', 'unreadable and manual rows are said so, never passed');
ok(v('p-lane') === 'LIVE' && v('p-lane-red') === 'WAITING', 'lanes read by their latest run');
ok(report.summary.waiting === 5 && report.summary.held === 2, 'the summary counts what waits and what is held');

// 5. The output never carries a name, a key or the token.
for (const format of ['text', 'markdown', 'json']) {
  const out = m.render(report, format);
  ok(!out.includes('Some Client Name'), `${format}: a text probe answer is not printed`);
}
const md = m.render(report, 'markdown');
ok(md.split('\n').filter(l => l.startsWith('| ')).every(l => l.split(' | ').length === 7), 'markdown rows have seven cells');
ok(/Summary: waiting 5,/.test(m.render(report, 'text')), 'the text report ends with the summary');

// 6. The real shelf is valid and every probe in it only reads.
const real = m.loadShelf(path.join(__dirname, '..', 'scripts', 'repo-vs-live-shelf.json'));
ok(real.probes.length >= 10, 'the real shelf lists the waiting items');
ok(real.probes.every(p => p.kind !== 'database' && p.kind !== 'switch' || /^(select|with)\b/i.test(p.sql)), 'every real probe is a select');
ok(!JSON.stringify(real).match(/eyJ[A-Za-z0-9_-]{10,}|sb_secret_|sbp_[0-9a-f]{10,}/), 'the shelf carries no key or token');

// 7. The command line, offline, against this checkout.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rvl-'));
const file = path.join(dir, 'live.json');
fs.writeFileSync(file, JSON.stringify({ captured_at: '2026-10-09T00:00:00Z', source: 'test', functions: [], probes: {}, lanes: {} }));
const env = Object.assign({}, process.env, { SUPABASE_ACCESS_TOKEN: 'sbp_TEST_SENTINEL_NEVER_PRINTED' });
const run = args => spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'repo-vs-live.js'), ...args], { encoding: 'utf8', env });
const plain = run([`--live-json=${file}`]);
ok(plain.status === 0 && /Summary: waiting \d+/.test(plain.stdout), 'the offline report runs and ends with its summary');
ok(!plain.stdout.includes('SENTINEL') && !plain.stderr.includes('SENTINEL'), 'the token is never printed');
ok(run([`--live-json=${file}`, '--strict']).status === 1, '--strict fails while something is waiting');
ok(run(['--bogus']).status === 2, 'an unknown argument is refused');
fs.rmSync(dir, { recursive: true, force: true });

console.log(`repo-vs-live: ${n} checks passed`);
