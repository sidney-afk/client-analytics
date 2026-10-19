'use strict';
/*
 * scripts/ci-lanes.js runs several browser suites side by side in one CI job
 * (session Express, 2026-10-19). What must hold: every command runs even after
 * one fails, the job fails when any did, commands really overlap, each gets its
 * own TMPDIR, the order listed is the order started, and the line format is strict.
 * Offline: only sleeps and echoes.
 */
const assert = require('assert/strict');
const path = require('path');
const { parseLines, runLanes } = require('../scripts/ci-lanes');
let checks = 0;
const ok = (c, m) => { assert(c, m); checks++; };

(async () => {
  const lines = parseLines('# comment\n\nOne|echo a | cat\nTwo: with colon|exit 3\n');
  ok(lines.length === 2 && lines[0].name === 'One' && lines[0].cmd === 'echo a | cat', 'a line is name|command and the command may hold pipes');
  ok(lines[1].name === 'Two: with colon', 'a name may hold a colon');
  assert.throws(() => parseLines('no separator here'), /name\|command/); checks++;

  const quiet = () => {};
  const t0 = Date.now();
  const r = await runLanes(parseLines('a|sleep 1\nb|sleep 1\nc|sleep 1'), { lanes: 3, log: quiet });
  const wall = (Date.now() - t0) / 1000;
  ok(r.failed.length === 0 && r.results.length === 3, 'three passing commands all pass');
  ok(wall < 2.4, 'three one-second commands on three lanes overlap (took ' + wall.toFixed(1) + ' s, serial would be 3 s)');

  const f = await runLanes(parseLines('bad|exit 3\ngood1|true\ngood2|true\ngood3|true'), { lanes: 1, log: quiet });
  ok(f.results.length === 4, 'a failure does not stop the commands after it');
  ok(f.failed.length === 1 && f.failed[0].name === 'bad' && f.failed[0].code === 3, 'the failed command and its exit code are reported');

  const out = [];
  const o = await runLanes(parseLines('first|echo FIRST\nsecond|echo SECOND'), { lanes: 1, log: s => out.push(s) });
  const text = out.join('\n');
  ok(text.indexOf('FIRST') < text.indexOf('SECOND'), 'commands start in the order listed');
  ok(/::group::PASS first/.test(text) && /::endgroup::/.test(text), 'each command prints as a collapsed group');
  ok(o.results[0].lane === 1, 'lane numbers start at 1');

  const t = await runLanes(parseLines('x|echo "$TMPDIR"\ny|echo "$TMPDIR"'), { lanes: 2, log: s => out.push(s) });
  const dirs = out.filter(s => /ci-lanes-.*job-\d/.test(s) && !s.startsWith('$'));
  ok(new Set(dirs).size === 2, 'every command gets its own TMPDIR');
  ok(t.failed.length === 0, 'the TMPDIR commands passed');

  const m = await runLanes(parseLines('nope|this-command-does-not-exist-xyz'), { lanes: 2, log: quiet });
  ok(m.failed.length === 1 && m.failed[0].code !== 0, 'a command that cannot start is a failure');

  console.log(`ci-lanes: ${checks} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
