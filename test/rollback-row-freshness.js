#!/usr/bin/env node
'use strict';
/**
 * The guard for OPEN_REPAIRS 118's dangerous row.
 *
 * scripts/rollback-row-freshness-check.js compares ROLLBACK.md's "what is
 * live" row against EXECUTION_LOG.md's newest deploy receipt. Asserting only
 * that today's two files agree would prove nothing: a check that always exits
 * 0 passes that test too. So every case below drives the real script against a
 * FIXTURE PAIR built to be wrong in one specific way, and asserts it goes red
 * for that reason and names it.
 *
 * The fixture text is deliberately shaped like the real files — the same
 * "65 → **66**" version cell, the same superseded-history paragraph sitting in
 * the same table cell as the live claim — because those two shapes are exactly
 * where a naive parser reports the wrong number and still looks green.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'rollback-row-freshness-check.js');
let failures = 0;
function ok(cond, msg) {
    console.log((cond ? '  ok  ' : 'FAIL  ') + msg);
    if (!cond) failures++;
}

function run(dir) {
    try {
        const out = execFileSync(process.execPath, [SCRIPT, '--root=' + dir, '--json'], { encoding: 'utf8' });
        return { code: 0, json: JSON.parse(out) };
    } catch (e) {
        const stdout = String(e.stdout || '');
        let json = null;
        try { json = JSON.parse(stdout); } catch (_) { /* a crash, not a verdict */ }
        return { code: e.status === undefined ? -1 : e.status, json, stdout, stderr: String(e.stderr || '') };
    }
}

/* ---- fixtures ----------------------------------------------------------- */

const H = {
    pw65: '2af7fe6d2590dc092fd0e011e57a2634fe88d25deae1858a7e3befb6da84e8c4',
    pw66: 'cc44bf938fd666595061972c27721fbf10d17cb11b184e417f59478b0add5370',
    lo46: 'd83f0d7c08ec39ad8897ab8323b3896235e8a39c6ea7c6cdde96f6b25ed4480b',
    lo47: '1489a4c276ca343554df2f4840c4f4b8ac77c33914098ee59a5d8b5cdec6ce39',
    dw: '78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575',
    bw: '86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a',
};

// Two receipts: an older release (production-write v65) and the newest (v66),
// the newest written in the arrow shape a real forward deploy uses.
const LOG = [
    '# Execution log',
    '',
    '## 2026-09-01 — F27 Section 4 forward deploy executed',
    '',
    'Run `33555586230`, dispatched from `da2195f0b9bb8febd5c8e3d01bc80a91fb3b71b9`.',
    '',
    '| function | active version | source closure SHA-256 | JWT |',
    '|---|---|---|---|',
    '| `batch-write` | 34 | `' + H.bw + '` | `verify_jwt=false` |',
    '| `deliverable-write` | 34 | `' + H.dw + '` | `verify_jwt=false` |',
    '| `linear-outbound` | 46 | `' + H.lo46 + '` | `verify_jwt=false` |',
    '| `production-write` | **65** | `' + H.pw65 + '` | `verify_jwt=false` |',
    '',
    '## 2026-09-02 — F27 Section 4 forward deploy executed',
    '',
    'Run `33684111985`, dispatched by the owner from',
    '`152c050e0179ee127e02d0ea50853960d9019eab`.',
    '',
    '| function | active version | source closure SHA-256 | JWT |',
    '|---|---|---|---|',
    '| `batch-write` | 34 → **35** | `' + H.bw + '` | `verify_jwt=false` |',
    '| `deliverable-write` | 34 → **35** | `' + H.dw + '` | `verify_jwt=false` |',
    '| `linear-outbound` | 46 → **47** | `' + H.lo47 + '` | `verify_jwt=false` |',
    '| `production-write` | 65 → **66** | `' + H.pw66 + '` | `verify_jwt=false` |',
    '',
].join('\n');

function rollback(o) {
    const c = Object.assign({
        date: '2026-09-02', deploy: '#25', run: '33684111985', commit: '152c050e',
        pw: '66', pwh: 'cc44bf93', lo: '47', loh: '1489a4c2', dw: '35', bw: '35',
        bundleSha: '3010578b', bundleBytes: '524885', captures: '65',
    }, o || {});
    return [
        '# Rollback',
        '',
        '| Area | What is live | Hazard | Last updated |',
        '|---|---|---|---|',
        '| F27 Section 4 four-function deploy provenance | **Live as of ' + c.date
            + ' (§4 lane, deploy ' + c.deploy + ', run `' + c.run + '` from `' + c.commit + '`): '
            + '`production-write` v' + c.pw + ' / `' + c.pwh + '…`, '
            + '`linear-outbound` v' + c.lo + ' / `' + c.loh + '…`, '
            + '`deliverable-write` v' + c.dw + ' / `' + H.dw.slice(0, 8) + '…`, '
            + '`batch-write` v' + c.bw + ' / `' + H.bw.slice(0, 8) + '…`.** '
            + '**The newest sealed §4 rollback bundle is `' + c.bundleSha + '…` / ' + c.bundleBytes
            + ' bytes and it captures `production-write` at v' + c.captures + '.** '
            + '*Superseded history below, retained deliberately.* Live as of 2026-08-25 '
            + '(run `33111111111` from `aaaaaaaa`): `production-write` v51 / `0deb6b81…`, '
            + '`linear-outbound` v45 / `d83f0d7c…`, `deliverable-write` v33 / `78df060b…`, '
            + '`batch-write` v33 / `86f9f187…`. | Take a fresh capture. | ' + c.date + ' |',
        '',
    ].join('\n');
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-freshness-'));
function fixture(name, log, rb) {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'EXECUTION_LOG.md'), log);
    fs.writeFileSync(path.join(dir, 'ROLLBACK.md'), rb);
    return dir;
}

/* ---- 1. the honest pair ------------------------------------------------- */

const agree = run(fixture('agree', LOG, rollback()));
ok(agree.code === 0, 'a row that matches the newest receipt passes');
ok(agree.json && agree.json.live && agree.json.live.functions['production-write'].version === '66',
    'the ARROW cell "65 → **66**" is read as v66 — the deployed version, not the one it replaced');
ok(agree.json && agree.json.rollback.fns['production-write'].version === '66'
    && agree.json.rollback.fns['linear-outbound'].version === '47',
    'the live claim is read from the bold row, not from the superseded history in the same cell');
ok(agree.json && agree.json.receipts === 2, 'both receipts in the log are found, not just the last');

/* ---- 2. the failure this whole check exists for ------------------------- */

const stale = run(fixture('stale', LOG, rollback({
    date: '2026-09-01', deploy: '#24', run: '33555586230', commit: 'da2195f0',
    pw: '65', pwh: '2af7fe6d', lo: '46', loh: 'd83f0d7c', dw: '34', bw: '34', captures: '64',
})));
ok(stale.code === 1, 'a row left describing the PREVIOUS deploy fails');
const staleText = stale.json ? stale.json.failures.join(' | ') : '';
ok(/production-write: ROLLBACK says v65, live is v66/.test(staleText),
    'and names the function, the version it claims and the version that is actually live');
ok(/run id: ROLLBACK says 33555586230, live|run id: ROLLBACK says 33555586230, newest receipt says 33684111985/.test(staleText),
    'and names the run it is stuck on');
ok(/deploy commit/.test(staleText), 'and that the dispatched commit disagrees too');

/* ---- 3. one step back, not two ----------------------------------------- */

const twoBack = run(fixture('twoback', LOG, rollback({ captures: '64', bundleSha: '08e9f50c' })));
ok(twoBack.code === 1, 'a bundle that captures TWO releases back fails even when every version matches');
ok(twoBack.json && /step back more than once/.test(twoBack.json.failures.join(' ')),
    'and says plainly that restoring it would step back more than once');

const oneBack = run(fixture('oneback', LOG, rollback({ captures: '65' })));
ok(oneBack.code === 0, 'a bundle capturing the release immediately before live is accepted');

/* ---- 4. a single wrong hash is not a rounding error --------------------- */

const badHash = run(fixture('badhash', LOG, rollback({ loh: 'deadbeef' })));
ok(badHash.code === 1, 'a closure hash that does not prefix-match the receipt fails');
ok(badHash.json && /linear-outbound: ROLLBACK closure deadbeef/.test(badHash.json.failures.join(' ')),
    'and names which function and which hash');

/* ---- 5. the attestation block is preferred and reported ---------------- */

const withJson = LOG + [
    '```json',
    JSON.stringify({
        schema: 'syncview_f27_section4_deployed_versions_v1',
        deploy_commit: '152c050e0179ee127e02d0ea50853960d9019eab',
        github_run_id: '33684111985',
        functions: [
            { slug: 'batch-write', active_version: '35', source_closure_sha256: H.bw },
            { slug: 'deliverable-write', active_version: '35', source_closure_sha256: H.dw },
            { slug: 'linear-outbound', active_version: '47', source_closure_sha256: H.lo47 },
            { slug: 'production-write', active_version: '66', source_closure_sha256: H.pw66 },
        ],
    }, null, 2),
    '```',
    '',
].join('\n');
const jsonRun = run(fixture('json', withJson, rollback()));
ok(jsonRun.code === 0, 'the same pair passes when the entry carries the full attestation block');
ok(jsonRun.json && jsonRun.json.live.source === 'attestation block',
    'and the block is what gets read, not the table beside it');
ok(jsonRun.json && !jsonRun.json.notes.some(n => /thinner than the record/.test(n)),
    'so the "thinner than the record" note is absent');
ok(agree.json && agree.json.notes.some(n => /thinner than the record/.test(n)),
    'while a table-only entry still says so, because the lane asks for the block');

/* ---- 6. nothing to compare is a failure, not a pass -------------------- */

const empty = run(fixture('empty', '# Execution log\n\nNo deploys yet.\n', rollback()));
ok(empty.code === 1, 'a log with no receipt at all fails rather than passing vacuously');
const noRow = run(fixture('norow', LOG, '# Rollback\n\nNothing here.\n'));
ok(noRow.code === 1, 'and so does a ROLLBACK.md with no live claim');

/* ---- 7. the real repository -------------------------------------------- */

const real = run(ROOT);
ok(real.code === 0, 'and the repository as it stands right now is consistent');

fs.rmSync(tmp, { recursive: true, force: true });

if (failures) {
    console.log('\n' + failures + ' check(s) failed.');
    process.exit(1);
}
console.log('\nROLLBACK row freshness checks passed');
