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
    '**Prior bundle sealed before dispatch**:',
    '`sealed_bundle_sha256 = 3010578bb45a80a5eba29b3c499274f27708da62171c3dc2925bbaf3bb919652`,',
    '`byte_length = 524885`.',
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

/* The bundle the receipt sealed, named correctly, but claiming the WRONG
   captured version — the one-step property alone. */
const twoBack = run(fixture('twoback', LOG, rollback({ captures: '64' })));
ok(twoBack.code === 1, 'a bundle that captures TWO releases back fails even when every version matches');
ok(twoBack.json && /step back more than once/.test(twoBack.json.failures.join(' ')),
    'and says plainly that restoring it would step back more than once');

/* Codex P1: the captured VERSION matching is not the BUNDLE matching. With the
   right version the row could name any digest at all. */
const wrongBundle = run(fixture('wrongbundle', LOG, rollback({ bundleSha: 'deadbeef', bundleBytes: '1' })));
ok(wrongBundle.code === 1
    && /names a different bundle from the one that deploy captured/.test(wrongBundle.json.failures.join(' ')),
    'a row naming a digest the deploy never sealed fails, even with the captured version right');
const wrongBytes = run(fixture('wrongbytes', LOG, rollback({ bundleBytes: '999999' })));
ok(wrongBytes.code === 1 && /bytes, the receipt records/.test(wrongBytes.json.failures.join(' ')),
    'and so does the right digest with the wrong byte length');
const noSealed = run(fixture('nosealed',
    LOG.replace(/`sealed_bundle_sha256[^`]*`,\n/, ''), rollback()));
ok(noSealed.code === 1 && /records no sealed_bundle_sha256/.test(noSealed.json.failures.join(' ')),
    'and a receipt that records no sealed bundle fails, because then there is nothing to match against');

/* Both SIDES of the provenance rule, not just the row's. */
const receiptNoCommit = run(fixture('receiptnocommit',
    LOG.replace('dispatched by the owner from\n`152c050e0179ee127e02d0ea50853960d9019eab`.',
        'dispatched by the owner.'),
    rollback()));
ok(receiptNoCommit.code === 1
    && /newest receipt.*records no dispatched commit/.test(receiptNoCommit.json.failures.join(' ')),
    'a RECEIPT with no dispatched commit fails too — otherwise the row could name an arbitrary one and pass');

const noBytes = run(fixture('nobytes',
    LOG.replace(/`byte_length = \d+`\.?/, ''), rollback()));
ok(noBytes.code === 1 && /no byte_length/.test(noBytes.json.failures.join(' ')),
    'and a sealed digest with no byte length fails — half an identity is not an identity');

/* Provenance must be present, not merely consistent when it happens to be there. */
const noRunClaim = run(fixture('norunclaim', LOG,
    rollback().replace(/run `\d+` /, '')));
ok(noRunClaim.code === 1 && /names no run id/.test(noRunClaim.json.failures.join(' ')),
    'a live claim with no run id fails — absence is not agreement');
ok(noRunClaim.json && !/33111111111/.test(JSON.stringify(noRunClaim.json.rollback)),
    'and it does NOT borrow the run id from the superseded history in the same cell');
const noCommitClaim = run(fixture('nocommitclaim', LOG,
    rollback().replace(/from `[0-9a-f]+`/, '')));
ok(noCommitClaim.code === 1 && /names no dispatched commit/.test(noCommitClaim.json.failures.join(' ')),
    'and so does one with no dispatched commit');

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

/* ---- 5b. FILE POSITION IS NOT CHRONOLOGY (Codex P1) -------------------- */

/* EXECUTION_LOG.md is reverse-chronological at the top and forward-
   chronological further down. The newest deploy written at the top the way the
   top section is written must still be the one compared against — taking the
   last receipt in the file is right today only by luck. */
const NEWEST_FIRST = [
    '# Execution log',
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
].join('\n')
    .replace('Run `33684111985`, dispatched by the owner from',
        '`sealed_bundle_sha256 = 3010578bb45a80a5eba29b3c499274f27708da62171c3dc2925bbaf3bb919652`,\n'
        + '`byte_length = 524885`.\nRun `33684111985`, dispatched by the owner from');

const reversed = run(fixture('reversed', NEWEST_FIRST, rollback()));
ok(reversed.code === 0 && reversed.json && reversed.json.live.run === '33684111985',
    'the NEWEST deploy is selected by run id even when it is written FIRST in the file');
const reversedStale = run(fixture('reversedstale', NEWEST_FIRST, rollback({
    date: '2026-09-01', deploy: '#24', run: '33555586230', commit: 'da2195f0',
    pw: '65', pwh: '2af7fe6d', lo: '46', loh: 'd83f0d7c', dw: '34', bw: '34', captures: '64',
})));
ok(reversedStale.code === 1,
    'and a stale row against a reverse-ordered log still fails — the case that passed by luck before');

/* Chronology must be ESTABLISHED. A receipt with no run id cannot be placed in
   time, so it cannot be ruled out as the newest. */
const noRun = LOG.replace('Run `33684111985`, dispatched by the owner from', 'Dispatched by the owner from');
const unplaceable = run(fixture('norun', noRun, rollback()));
ok(unplaceable.code === 1
    && unplaceable.json.failures.some(f => /cannot be placed in time/.test(f)),
    'a receipt carrying no run id fails the check rather than being silently ordered by position');

/* Two signals, because one is a single point of failure. */
const skewed = NEWEST_FIRST.replace('## 2026-09-02 — F27', '## 2026-08-02 — F27');
const disagree = run(fixture('skew', skewed, rollback()));
ok(disagree.code === 1 && disagree.json.failures.some(f => /chronology signals disagree/.test(f)),
    'and run-id order disagreeing with the entry dates fails, rather than one signal quietly winning');

/* Folding must be by deployment IDENTITY, not by proximity. A JSON-backed
   deploy followed closely by a table-only deploy is two deploys; the first
   version of this check discarded the newer one as the older one's duplicate
   because their shapes differed and they sat near each other. */
const ADJACENT = [
    '# Execution log',
    '',
    '## 2026-09-01 — F27 Section 4 forward deploy executed',
    '',
    'Run `33555586230`, dispatched from `da2195f0b9bb8febd5c8e3d01bc80a91fb3b71b9`.',
    '',
    '```json',
    JSON.stringify({
        schema: 'syncview_f27_section4_deployed_versions_v1',
        deploy_commit: 'da2195f0b9bb8febd5c8e3d01bc80a91fb3b71b9',
        github_run_id: '33555586230',
        functions: [
            { slug: 'batch-write', active_version: '34', source_closure_sha256: H.bw },
            { slug: 'deliverable-write', active_version: '34', source_closure_sha256: H.dw },
            { slug: 'linear-outbound', active_version: '46', source_closure_sha256: H.lo46 },
            { slug: 'production-write', active_version: '65', source_closure_sha256: H.pw65 },
        ],
    }),
    '```',
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
    '**Prior bundle sealed before dispatch**:',
    '`sealed_bundle_sha256 = 3010578bb45a80a5eba29b3c499274f27708da62171c3dc2925bbaf3bb919652`,',
    '`byte_length = 524885`.',
    '',
].join('\n');
const adjacent = run(fixture('adjacent', ADJACENT, rollback()));
ok(adjacent.code === 0 && adjacent.json.receipts === 2,
    'a JSON deploy and a table-only deploy sitting close together are TWO receipts, not one folded pair');
ok(adjacent.json && adjacent.json.live.run === '33684111985' && adjacent.json.live.source === 'summary table',
    'and the newer table-only one is the live receipt, not discarded as the older block\'s duplicate');

/* ---- 5c. incomplete receipts and unverifiable bundles fail (Codex P1) --- */

const truncated = NEWEST_FIRST.replace(
    '| `production-write` | 65 → **66** | `' + H.pw66 + '` | `verify_jwt=false` |\n', '');
const short = run(fixture('truncated', truncated, rollback()));
ok(short.code === 1 && short.json.failures.some(f => /production-write is missing from the newest receipt/.test(f)),
    'a receipt naming only three of the four functions fails closed — the lane deploys them as one set');

/* Codex P1: a >= 3 cutoff DROPPED shorter tables, so a badly truncated newest
   receipt disappeared and the deploy before it silently became "live" — which
   is a stale ROLLBACK row passing. Every detected table is retained now, and
   fails on its missing functions instead of vanishing. */
const veryShort = NEWEST_FIRST
    .replace('| `batch-write` | 34 → **35** | `' + H.bw + '` | `verify_jwt=false` |\n', '')
    .replace('| `deliverable-write` | 34 → **35** | `' + H.dw + '` | `verify_jwt=false` |\n', '')
    .replace('| `linear-outbound` | 46 → **47** | `' + H.lo47 + '` | `verify_jwt=false` |\n', '');
const oneRow = run(fixture('onerow', veryShort, rollback()));
ok(oneRow.code === 1, 'a newest receipt truncated to ONE function fails');
ok(oneRow.json && oneRow.json.live.run === '33684111985',
    'and it is still read as the newest receipt — it does not vanish and hand the title to the deploy before it');
ok(oneRow.json && oneRow.json.failures.filter(f => /is missing from the newest receipt/.test(f)).length === 3,
    'failing for the three functions it does not name');

const noBundle = rollback().replace(/\*\*The newest sealed[^*]*\*\* /, '');
const unverifiable = run(fixture('nobundle', LOG, noBundle));
ok(unverifiable.code === 1 && unverifiable.json.failures.some(f => /one-step restore unverified/.test(f)),
    'a row that updates the live versions while naming no readable bundle FAILS — "could not check" must not print as "fine"');

const soloLog = LOG.slice(LOG.indexOf('## 2026-09-02'));
const noPrior = run(fixture('noprior', '# Execution log\n\n' + soloLog, rollback()));
ok(noPrior.code === 1 && noPrior.json.failures.some(f => /no receipt older than the newest one/.test(f)),
    'and so does a log with nothing older to measure "one release back" against');

/* ---- 5d. one heading, two deploys (Codex P1) --------------------------- */

/* A single `##` entry can hold many deploys — the real 2026-08-05 one names
   TWELVE run ids. Reading the FIRST run/dispatch mention in the entry gives a
   later table-only receipt the identity of the oldest deploy in it, after which
   grouping by run folds it away as a duplicate and the newest deploy can
   disappear entirely, letting a stale row pass. */
const TWO_IN_ONE = [
    '# Execution log',
    '',
    '## 2026-09-02 — F27 Section 4: two dispatches, one entry',
    '',
    'First, run `33555586230`, dispatched from `da2195f0b9bb8febd5c8e3d01bc80a91fb3b71b9`.',
    '',
    '| function | active version | source closure SHA-256 | JWT |',
    '|---|---|---|---|',
    '| `batch-write` | 34 | `' + H.bw + '` | `verify_jwt=false` |',
    '| `deliverable-write` | 34 | `' + H.dw + '` | `verify_jwt=false` |',
    '| `linear-outbound` | 46 | `' + H.lo46 + '` | `verify_jwt=false` |',
    '| `production-write` | **65** | `' + H.pw65 + '` | `verify_jwt=false` |',
    '',
    'Then, run `33684111985`, dispatched by the owner from',
    '`152c050e0179ee127e02d0ea50853960d9019eab`.',
    '',
    '| function | active version | source closure SHA-256 | JWT |',
    '|---|---|---|---|',
    '| `batch-write` | 34 → **35** | `' + H.bw + '` | `verify_jwt=false` |',
    '| `deliverable-write` | 34 → **35** | `' + H.dw + '` | `verify_jwt=false` |',
    '| `linear-outbound` | 46 → **47** | `' + H.lo47 + '` | `verify_jwt=false` |',
    '| `production-write` | 65 → **66** | `' + H.pw66 + '` | `verify_jwt=false` |',
    '',
    '`sealed_bundle_sha256 = 3010578bb45a80a5eba29b3c499274f27708da62171c3dc2925bbaf3bb919652`,',
    '`byte_length = 524885`.',
    '',
].join('\n');
const twoInOne = run(fixture('twoinone', TWO_IN_ONE, rollback()));
ok(twoInOne.json && twoInOne.json.receipts === 2,
    'two deploys under one heading are two receipts, not one');
ok(twoInOne.code === 0 && twoInOne.json.live.run === '33684111985',
    'and the SECOND one is live — its identity comes from the nearest preceding dispatch, not the entry\'s first');
const twoInOneStale = run(fixture('twoinonestale', TWO_IN_ONE, rollback({
    date: '2026-09-01', deploy: '#24', run: '33555586230', commit: 'da2195f0',
    pw: '65', pwh: '2af7fe6d', lo: '46', loh: 'd83f0d7c', dw: '34', bw: '34', captures: '64',
})));
ok(twoInOneStale.code === 1,
    'so a row stuck on the FIRST of the two still fails, which is the case that passed before');

/* ---- 5e. a receipt must actually record what it claims ----------------- */

const holedJson = LOG + [
    '```json',
    JSON.stringify({
        schema: 'syncview_f27_section4_deployed_versions_v1',
        deploy_commit: '152c050e0179ee127e02d0ea50853960d9019eab',
        github_run_id: '33684111985',
        functions: [
            { slug: 'batch-write', active_version: '35', source_closure_sha256: H.bw },
            { slug: 'deliverable-write', active_version: '35', source_closure_sha256: H.dw },
            { slug: 'linear-outbound', active_version: '47', source_closure_sha256: H.lo47 },
            { slug: 'production-write', active_version: '66' },   // closure omitted
        ],
    }, null, 2),
    '```',
    '',
].join('\n');
const holed = run(fixture('holedjson', holedJson, rollback()));
ok(holed.code === 1
    && /production-write: the newest receipt records no usable source closure/.test(holed.json.failures.join(' ')),
    'an attestation block missing ONE closure fails for that function — two empty strings must not compare equal');

const undated = run(fixture('undated',
    LOG.replace('## 2026-09-02 — F27 Section 4 forward deploy executed',
        '## F27 Section 4 forward deploy executed'), rollback()));
ok(undated.code === 1 && /usable YYYY-MM-DD date/.test(undated.json.failures.join(' ')),
    'and a newest receipt under an undated heading fails, rather than quietly dropping to one chronology signal');

const impossible = run(fixture('impossible',
    LOG.replace('## 2026-09-02 — F27', '## 2026-99-99 — F27'), rollback()));
ok(impossible.code === 1 && /usable YYYY-MM-DD date/.test(impossible.json.failures.join(' ')),
    'a heading date shaped right but impossible (2026-99-99) fails — it would sort after every real date');

/* ---- 5f. the concise prose shape, which produced no receipt at all ------ */

/* EXECUTION_LOG.md opens with one of these and run 33434655418 was simply
   absent from this guard's history. If the next dispatch is logged that way,
   the deploy before it stays live and its stale row exits 0. */
const CONCISE = [
    '# Execution log',
    '',
    '## 2026-09-01 — Deploy: something',
    '',
    '**Section 4 forward from `da2195f0`, run `33555586230`, PASS.** `production-write`',
    '64 → **65**, closure',
    '`' + H.pw65 + '`. The other three were byte-identical redeploys.',
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
    '`sealed_bundle_sha256 = 3010578bb45a80a5eba29b3c499274f27708da62171c3dc2925bbaf3bb919652`,',
    '`byte_length = 524885`.',
    '',
].join('\n');
const concise = run(fixture('concise', CONCISE, rollback()));
ok(concise.json && concise.json.receipts === 2,
    'a concise-prose dispatch IS a receipt — it used to produce none at all');
ok(concise.code === 0 && concise.json.live.run === '33684111985',
    'and the table-backed newest deploy is still the live one');

/* When the concise shape IS the newest, it fails as incomplete rather than
   being ignored — it names one function and cannot be reconstructed. */
const CONCISE_NEWEST = [
    '# Execution log',
    '',
    '## 2026-09-02 — F27 Section 4 forward deploy executed',
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
    '## 2026-09-03 — Deploy: logged the short way',
    '',
    '**Section 4 forward from `152c050e`, run `33684111985`, PASS.** `production-write`',
    '65 → **66**, closure',
    '`' + H.pw66 + '`. The other three were byte-identical redeploys.',
    '',
].join('\n');
const conciseNewest = run(fixture('concisenewest', CONCISE_NEWEST, rollback()));
ok(conciseNewest.code === 1 && conciseNewest.json.live.run === '33684111985',
    'a concise entry that IS the newest is read as the newest, not skipped over');
ok(conciseNewest.json.failures.filter(f => /is missing from the newest receipt/.test(f)).length === 3,
    'and fails by name for the three functions it does not record');

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
