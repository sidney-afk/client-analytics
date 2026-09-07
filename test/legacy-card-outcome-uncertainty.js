'use strict';
// Actual retained browser writer and queue; synthetic accepting receiver only.
// No server/trigger/deployment assertion and no external transport.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const cp = require('node:child_process'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const current = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const baseSha = '9e75f4dcd3d5680da9d1c962498d6a79ed497922';
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
env.GIT_NO_LAZY_FETCH = '1';
const base = cp.execFileSync('git', ['--no-replace-objects', 'show', baseSha + ':index.html'], { cwd: root, env, encoding: 'utf8', maxBuffer: 12e6 });
const ownerHarness = fs.readFileSync(path.join(__dirname, 'calendar-card-write-jobs.js'), 'utf8');
const parts = ownerHarness.split('(async () => {');
assert.equal(parts.length, 2, 'exact existing writer fixture boundary');
const declaration = "const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');";
assert.equal(parts[0].split(declaration).length, 2);
function fixture(source) {
  const context = vm.createContext({ require, __dirname, console: { log() {}, warn() {}, error() {} } });
  vm.runInContext(parts[0].replace(declaration, () => 'const INDEX = ' + JSON.stringify(source) + ';'), context);
  return fn => vm.runInContext('(' + fn.toString() + ')()', context);
}
let passed = 0;
const counts = [];
async function check(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
async function outcome(source, linked, candidate) {
  const run = fixture(source);
  run(function () { globalThis.modelLinked = false; globalThis.modelCandidate = false; });
  run(new Function('modelLinked=' + linked + ';modelCandidate=' + candidate + ';'));
  return run(async function () {
    const assert = require('node:assert/strict'); reset();
    linearResponses = modelLinked ? [issuesFor('T', [1])] : ['throw'];
    const rows = new Map(); let first = true;
    fetchOkFor = post => {
      if (modelCandidate) {
        const persisted = _calCardJobsRead()[0].card_attempts[0];
        assert.equal(persisted.outcome, 'unconfirmed');
        assert.equal(JSON.stringify(persisted.payload.post), JSON.stringify(post));
      }
      rows.set(post.id, JSON.parse(JSON.stringify(post)));
      if (first) { first = false; throw Error('synthetic_lost_response_after_modeled_acceptance'); }
      return true;
    };
    const job = await _calCardJobCreate('Fixture Client', [{ number: 1 }], 'T', 'video');
    await _writeLinearVideoCardsToCalendar(job.clientName, job.videos, job.formTitle, { mode: job.mode, job });
    assert.equal(rows.size, 1); assert.equal(_calCardJobsRead()[0].done.length, 0);
    const firstId = [...rows.keys()][0]; rows.get(firstId).caption = 'synthetic_human_edit';
    const pending = _calCardJobsRead()[0]; pending.heartbeatAt = 0; await _calCardJobSave(pending);
    const raw = localStorage.getItem(CAL_CARD_JOBS_KEY);
    await _resumePendingCalCardJobs({ video: 'syncview', graphics: 'syncview' });
    await _resumePendingCalCardJobs({ video: 'linear', graphics: 'linear' });
    if (modelCandidate) {
      assert.equal(fetchLog.length, 1); assert.equal(rows.size, 1);
      assert.equal(rows.get(firstId).caption, 'synthetic_human_edit');
      assert.equal(localStorage.getItem(CAL_CARD_JOBS_KEY), raw);
      assert.ok(notifications.every(n => !/Create Post|retry.*automatically/i.test(n.msg)));
    } else {
      assert.equal(fetchLog.length, 2); assert.equal(_calCardJobsRead().length, 0);
      if (modelLinked) { assert.equal(fetchLog[1].body.post.id, firstId); assert.equal(rows.get(firstId).caption, ''); }
      else { assert.notEqual(fetchLog[1].body.post.id, firstId); assert.equal(rows.size, 2); }
      assert.ok(notifications.some(n => /Create Post/.test(n.msg)));
    }
    return { linked: modelLinked, candidate: modelCandidate, requests: fetchLog.length, modeled_rows: rows.size };
  });
}
async function main() {
  for (const linked of [false, true]) {
    await check('BASELINE lost response ' + (linked ? 'resends initial fields' : 'mints a second modeled row'), async () => counts.push(await outcome(base, linked, false)));
    await check('candidate retains ' + (linked ? 'linked' : 'unlinked') + ' exact attempt across authority reversal without replay', async () => counts.push(await outcome(current, linked, true)));
  }
  const run = fixture(current);
  await check('successful first attempts retain provider pairing and normal completion', () => run(async function () {
    const assert = require('node:assert/strict'); reset();
    const videos = [{ number: 1, notes: 'fictional retained source' }, { number: 2 }];
    const job = await _calCardJobCreate('Fixture Client', videos, 'T', 'both');
    await _writeLinearVideoCardsToCalendar(job.clientName, videos, job.formTitle, { mode: job.mode, job });
    assert.equal(fetchLog.length, 2); assert.equal(_calCardJobsRead().length, 0);
    assert.ok(fetchLog.every(row => row.body.post.linear_issue_id && row.body.post.graphic_linear_issue_id));
    assert.equal(notifications.length, 0);
  }));
  await check('preexisting provably unattempted job remains eligible', () => run(async function () {
    const assert = require('node:assert/strict'); reset();
    const job = await _calCardJobCreate('Fixture Client', [{ number: 1 }], 'T', 'video');
    delete job.card_attempt_protocol; delete job.card_attempts; await _calCardJobSave(job);
    await _resumePendingCalCardJobs({ video: 'linear', graphics: 'linear' });
    assert.equal(fetchLog.length, 1); assert.equal(_calCardJobsRead().length, 0);
  }));
  await check('preexisting attempts, partial checkpoints and malformed protocol stay held', () => run(async function () {
    const assert = require('node:assert/strict');
    for (const changes of [{ runs: 1 }, { heartbeatAt: 123 }, { done: [1] }, { runs: undefined }, { card_attempt_protocol: 2 }, { card_attempt_protocol: 1 }]) {
      reset(); const row = { id: 'old', clientName: 'Fixture Client', formTitle: 'T', mode: 'video', videos: [{ number: 1 }, { number: 2 }], done: [], runs: 0, heartbeatAt: 0, createdAt: Date.now(), ...changes };
      _calCardJobsWrite([row]); const raw = localStorage.getItem(CAL_CARD_JOBS_KEY);
      await _resumePendingCalCardJobs({ video: 'linear', graphics: 'linear' });
      assert.equal(fetchLog.length, 0); assert.equal(linearForceLog.length, 0); assert.equal(localStorage.getItem(CAL_CARD_JOBS_KEY), raw);
    }
  }));
  await check('attempt evidence disagreement cannot be cleaned as completed', () => run(async function () {
    const assert = require('node:assert/strict'); reset();
    const job = await _calCardJobCreate('Fixture Client', [{ number: 1 }], 'T', 'video');
    job.done = [1]; job.card_attempts = [{ number: 1, payload: { client: 'fixtureclient', post: { id: 'kept' } }, outcome: 'unconfirmed' }];
    await _calCardJobSave(job); const raw = localStorage.getItem(CAL_CARD_JOBS_KEY);
    await _resumePendingCalCardJobs({ video: 'linear', graphics: 'linear' });
    assert.equal(fetchLog.length, 0); assert.equal(localStorage.getItem(CAL_CARD_JOBS_KEY), raw);
  }));
  await check('registration failure prevents transport and preserves earlier fragments', () => run(async function () {
    const assert = require('node:assert/strict'); reset();
    const raw = JSON.stringify([null, { id: 'earlier', opaque: 'synthetic fragment' }]); localStorage.setItem(CAL_CARD_JOBS_KEY, raw);
    const original = localStorage.setItem; localStorage.setItem = () => { throw Error('synthetic_quota'); };
    try { await assert.rejects(_calCardJobCreate('Fixture Client', [{ number: 1 }], 'T', 'video'), /storage/); }
    finally { localStorage.setItem = original; }
    assert.equal(fetchLog.length, 0); assert.equal(linearForceLog.length, 0); assert.equal(localStorage.getItem(CAL_CARD_JOBS_KEY), raw);
  }));
  await check('corrupt array cannot be replaced to manufacture durable registration', () => run(async function () {
    const assert = require('node:assert/strict'); reset(); localStorage.setItem(CAL_CARD_JOBS_KEY, '{synthetic-broken');
    await assert.rejects(_calCardJobCreate('Fixture Client', [{ number: 1 }], 'T', 'video'), /storage/);
    assert.equal(localStorage.getItem(CAL_CARD_JOBS_KEY), '{synthetic-broken'); assert.equal(fetchLog.length, 0);
  }));
  await check('write-ahead persistence failure prevents the first card send', () => run(async function () {
    const assert = require('node:assert/strict'); reset(); const job = await _calCardJobCreate('Fixture Client', [{ number: 1 }], 'T', 'video');
    const original = localStorage.setItem;
    localStorage.setItem = (key, raw) => { if (JSON.parse(raw).some(row => row && row.card_attempts && row.card_attempts.length)) throw Error('synthetic_attempt_quota'); return original(key, raw); };
    try { await assert.rejects(_writeLinearVideoCardsToCalendar(job.clientName, job.videos, job.formTitle, { mode: job.mode, job }), /storage/); }
    finally { localStorage.setItem = original; }
    assert.equal(fetchLog.length, 0); assert.equal(_calCardJobsRead()[0].card_attempts.length, 0);
  }));
  await check('lost readback refuses send even when setItem returned', () => run(async function () {
    const assert = require('node:assert/strict'); reset(); const job = await _calCardJobCreate('Fixture Client', [{ number: 1 }], 'T', 'video');
    const original = localStorage.getItem; let falsify = false;
    localStorage.getItem = key => { const raw = original(key); if (!falsify && raw && JSON.parse(raw)[0].card_attempts.length) { falsify = true; return '[]'; } return raw; };
    try { await assert.rejects(_writeLinearVideoCardsToCalendar(job.clientName, job.videos, job.formTitle, { mode: job.mode, job }), /storage/); }
    finally { localStorage.getItem = original; }
    assert.equal(fetchLog.length, 0); assert.equal(_calCardJobsRead()[0].card_attempts[0].outcome, 'unconfirmed');
  }));
  await check('acknowledgement checkpoint failure stops following cards and keeps original attempt', () => run(async function () {
    const assert = require('node:assert/strict'); reset(); const job = await _calCardJobCreate('Fixture Client', [{ number: 1 }, { number: 2 }], 'T', 'video');
    const original = localStorage.setItem;
    localStorage.setItem = (key, raw) => { if (JSON.parse(raw).some(row => row && row.done && row.done.length)) throw Error('synthetic_ack_quota'); return original(key, raw); };
    try { await assert.rejects(_writeLinearVideoCardsToCalendar(job.clientName, job.videos, job.formTitle, { mode: job.mode, job }), /storage/); }
    finally { localStorage.setItem = original; }
    assert.equal(fetchLog.length, 1); const saved = _calCardJobsRead()[0]; assert.equal(saved.done.length, 0); assert.equal(saved.card_attempts[0].outcome, 'unconfirmed');
    await _resumePendingCalCardJobs({ video: 'linear', graphics: 'linear' }); assert.equal(fetchLog.length, 1);
  }));
  await check('successful siblings and unconfirmed card all retain their original payloads', () => run(async function () {
    const assert = require('node:assert/strict'); reset(); fetchOkFor = row => row.name !== 'Video 2';
    const job = await _calCardJobCreate('Fixture Client', [{ number: 1 }, { number: 2 }, { number: 3 }], 'T', 'both');
    await _writeLinearVideoCardsToCalendar(job.clientName, job.videos, job.formTitle, { mode: job.mode, job });
    const saved = _calCardJobsRead()[0]; assert.equal(JSON.stringify(saved.done), '[1,3]'); assert.equal(saved.card_attempts.length, 3);
    assert.equal(saved.card_attempts[1].outcome, 'unconfirmed');
    saved.card_attempts.forEach((row, i) => assert.equal(JSON.stringify(row.payload), JSON.stringify(fetchLog[i].body)));
  }));
  await check('same-job concurrent callers cannot send twice', () => run(async function () {
    const assert = require('node:assert/strict'); reset(); const job = await _calCardJobCreate('Fixture Client', [{ number: 1 }], 'T', 'video');
    await Promise.all([1, 2].map(() => _writeLinearVideoCardsToCalendar(job.clientName, job.videos, job.formTitle, { mode: job.mode, job })));
    assert.equal(fetchLog.length, 1); assert.equal(_calCardJobsRead().length, 0);
  }));
  await check('concurrent registration retains both jobs and opaque siblings', () => run(async function () {
    const assert = require('node:assert/strict'); reset(); _calCardJobsWrite([null, { id: 'opaque', fragment: 'retained' }]);
    const jobs = await Promise.all(['T1', 'T2'].map(title => _calCardJobCreate('Fixture Client', [{ number: 1 }], title, 'video')));
    const rows = _calCardJobsRead(); assert.equal(rows.length, 4); assert.equal(rows[0], null); assert.equal(rows[1].fragment, 'retained');
    jobs.forEach(job => assert.ok(rows.some(row => row && row.id === job.id)));
  }));
  await check('missing Web Locks refuse registration without transport', () => run(async function () {
    const assert = require('node:assert/strict'); reset(); const saved = navigator.locks; navigator.locks = null;
    try { await assert.rejects(_calCardJobCreate('Fixture Client', [{ number: 1 }], 'T', 'video'), /lock/); }
    finally { navigator.locks = saved; }
    assert.equal(fetchLog.length, 0); assert.equal(_calCardJobsRead().length, 0);
  }));
  await check('same ID with changed client cannot adopt a queued request', () => run(async function () {
    const assert = require('node:assert/strict'); reset(); const job = await _calCardJobCreate('Fixture Client', [{ number: 1 }], 'T', 'video');
    const replacement = { ...job, clientName: 'Other Fixture' }; await _calCardJobSave(replacement);
    const raw = localStorage.getItem(CAL_CARD_JOBS_KEY);
    await _writeLinearVideoCardsToCalendar(job.clientName, job.videos, job.formTitle, { mode: job.mode, job });
    assert.equal(fetchLog.length, 0); assert.equal(linearForceLog.length, 0); assert.equal(localStorage.getItem(CAL_CARD_JOBS_KEY), raw);
  }));
  await check('unavailable Web Locks retain an already saved fresh job', () => run(async function () {
    const assert = require('node:assert/strict'); reset(); const job = await _calCardJobCreate('Fixture Client', [{ number: 1 }], 'T', 'video');
    const raw = localStorage.getItem(CAL_CARD_JOBS_KEY), locks = navigator.locks; navigator.locks = null;
    try { await _resumePendingCalCardJobs({ video: 'linear', graphics: 'linear' }); }
    finally { navigator.locks = locks; }
    assert.equal(localStorage.getItem(CAL_CARD_JOBS_KEY), raw); assert.equal(fetchLog.length, 0); assert.equal(linearForceLog.length, 0);
    assert.ok(notifications.some(row => /unconfirmed/.test(row.msg)));
  }));
  await check('same-ID replacement before initial checkpoint cannot be overwritten or sent', () => run(async function () {
    const assert = require('node:assert/strict'); reset(); const job = await _calCardJobCreate('Fixture Client', [{ number: 1 }], 'T', 'video');
    const replacement = { ...job, card_attempts: [{ number: 1, payload: { client: 'fixtureclient', post: { id: 'uncertain-original' } }, outcome: 'unconfirmed' }] };
    const raw = JSON.stringify([replacement]), request = navigator.locks.request; let changed = false;
    navigator.locks.request = (name, options, fn) => request(name, options, () => {
      if (!changed && name.endsWith(':store')) { changed = true; localStorage.setItem(CAL_CARD_JOBS_KEY, raw); }
      return fn();
    });
    try { await assert.rejects(_writeLinearVideoCardsToCalendar(job.clientName, job.videos, job.formTitle, { mode: job.mode, job }), /storage/); }
    finally { navigator.locks.request = request; }
    assert.equal(fetchLog.length, 0); assert.equal(linearForceLog.length, 0); assert.equal(localStorage.getItem(CAL_CARD_JOBS_KEY), raw);
  }));
  await check('same-ID replacement after discovery survives the pre-send checkpoint', () => run(async function () {
    const assert = require('node:assert/strict'); reset(); const job = await _calCardJobCreate('Fixture Client', [{ number: 1 }], 'T', 'video');
    const load = globalThis.loadLinearIssues; let raw;
    globalThis.loadLinearIssues = async force => {
      const found = await load(force), replacement = _calCardJobsRead()[0];
      replacement.card_attempts = [{ number: 1, payload: { client: 'fixtureclient', post: { id: 'uncertain-original' } }, outcome: 'unconfirmed' }];
      raw = JSON.stringify([replacement]); localStorage.setItem(CAL_CARD_JOBS_KEY, raw); return found;
    };
    try { await assert.rejects(_writeLinearVideoCardsToCalendar(job.clientName, job.videos, job.formTitle, { mode: job.mode, job }), /storage/); }
    finally { globalThis.loadLinearIssues = load; }
    assert.equal(fetchLog.length, 0); assert.equal(localStorage.getItem(CAL_CARD_JOBS_KEY), raw);
  }));
  await check('completed cleanup cannot remove a later same-ID uncertain replacement', () => run(async function () {
    const assert = require('node:assert/strict'); reset(); const job = await _calCardJobCreate('Fixture Client', [{ number: 1 }], 'T', 'video');
    delete job.card_attempt_protocol; delete job.card_attempts; job.done = [1]; await _calCardJobSave(job);
    const replacement = { ...job, done: [], runs: 1 }, raw = JSON.stringify([replacement]);
    const request = navigator.locks.request;
    navigator.locks.request = (name, options, fn) => request(name, options, () => { if (name.endsWith(':store')) localStorage.setItem(CAL_CARD_JOBS_KEY, raw); return fn(); });
    try { await _resumePendingCalCardJobs({ video: 'linear', graphics: 'linear' }); }
    finally { navigator.locks.request = request; }
    assert.equal(fetchLog.length, 0); assert.equal(localStorage.getItem(CAL_CARD_JOBS_KEY), raw);
    assert.ok(notifications.some(row => /unconfirmed/.test(row.msg)));
  }));
  await check('removing the exact save CAS reproduces the reviewer replacement defect', async () => {
    const guard = "                if (typeof expected === 'string' && JSON.stringify(found[0]) !== expected) return false;\n";
    assert.equal(current.split(guard).length, 2);
    const unsafe = fixture(current.replace(guard, ''));
    await unsafe(async function () {
      const assert = require('node:assert/strict'); reset(); const job = await _calCardJobCreate('Fixture Client', [{ number: 1 }], 'T', 'video');
      const load = globalThis.loadLinearIssues;
      globalThis.loadLinearIssues = async force => {
        const found = await load(force), replacement = _calCardJobsRead()[0];
        replacement.card_attempts = [{ number: 1, payload: { client: 'fixtureclient', post: { id: 'uncertain-original' } }, outcome: 'unconfirmed' }];
        localStorage.setItem(CAL_CARD_JOBS_KEY, JSON.stringify([replacement])); return found;
      };
      await _writeLinearVideoCardsToCalendar(job.clientName, job.videos, job.formTitle, { mode: job.mode, job });
      assert.equal(fetchLog.length, 1); assert.equal(_calCardJobsRead().length, 0);
    });
  });
  console.log(JSON.stringify({ passed, scenarios: counts, classification: 'ACTUAL_BROWSER_SOURCE_MODELED_RECEIVER', external_requests: 0, server_trigger_execution: false }));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
