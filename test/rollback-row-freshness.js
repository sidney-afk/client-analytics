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

/* ---- 7. round five: a mention is not a claim ---------------------------- */

/* THE FAILED RUN BEFORE THE TABLE. Codex P1 on #1253, and the shape is verbatim
   from EXECUTION_LOG.md: deploy #5's own heading names its run, and its first
   sentence names the run whose verification step FAILED. Taking the nearest
   preceding run token files the table under the failed run — two identities for
   one deploy with the JSON block present, and the wrong one without it. */
const FAILED_RUN_FIRST = [
    '# Execution log',
    '',
    '## 2026-09-01 — F27 Section 4 deploys',
    '',
    '### Deploy #24 — RECORDED (run `33555586230`, 2026-09-01)',
    '',
    'Dispatched from `da2195f0b9bb8febd5c8e3d01bc80a91fb3b71b9`.',
    '',
    '| function | active version | source closure SHA-256 | JWT |',
    '|---|---|---|---|',
    '| `batch-write` | 34 | `' + H.bw + '` | `verify_jwt=false` |',
    '| `deliverable-write` | 34 | `' + H.dw + '` | `verify_jwt=false` |',
    '| `linear-outbound` | 46 | `' + H.lo46 + '` | `verify_jwt=false` |',
    '| `production-write` | **65** | `' + H.pw65 + '` | `verify_jwt=false` |',
    '',
    '```',
    'rollback_bundle_sha256        1111111111111111111111111111111111111111111111111111111111111111',
    'rollback_bundle_byte_length   111111',
    '```',
    '',
    '### Deploy #25 — RECORDED (run `33684111985`, 2026-09-02)',
    '',
    'Owner-dispatched from `152c050e0179ee127e02d0ea50853960d9019eab`. **Fully green,',
    'including the final four-function verification step that failed on run',
    '`33555586230`.**',
    '',
    '| function | active version | source closure SHA-256 | JWT |',
    '|---|---|---|---|',
    '| `batch-write` | 34 → **35** | `' + H.bw + '` | `verify_jwt=false` |',
    '| `deliverable-write` | 34 → **35** | `' + H.dw + '` | `verify_jwt=false` |',
    '| `linear-outbound` | 46 → **47** | `' + H.lo47 + '` | `verify_jwt=false` |',
    '| `production-write` | 65 → **66** | `' + H.pw66 + '` | `verify_jwt=false` |',
    '',
    'The TEST drill (run `33684999999`) exercised it end to end minutes later.',
    '',
    '```',
    'rollback_bundle_sha256        3010578bb45a80a5eba29b3c499274f27708da62171c3dc2925bbaf3bb919652',
    'rollback_bundle_byte_length   524885',
    '```',
    '',
].join('\n');

const failedFirst = run(fixture('failedfirst', FAILED_RUN_FIRST, rollback()));
ok(failedFirst.json && failedFirst.json.receipts === 2,
    'a deploy whose prose names an earlier FAILED run is still one receipt, not two');
ok(failedFirst.json && failedFirst.json.live.run === '33684111985',
    'and it is filed under the run its own heading claims, not the failed one it mentions');
ok(failedFirst.code === 0,
    'so the matching row passes — before this, the newest deploy wore the failed run\'s identity');

/* THE DRILL RUN BETWEEN THE RECEIPT AND ITS BUNDLE. Same fixture: deploy #25's
   bundle sits after a TEST-drill run mention. Bounding the section by run tokens
   ended it at the drill and fell back to the entry, whose FIRST bundle belongs
   to deploy #24 — the wrong digest presented as this deploy's. */
ok(failedFirst.json && failedFirst.json.live && failedFirst.json.rollback
    && failedFirst.json.rollback.bundle.sha === '3010578b',
    'and its bundle is its own, read past a drill-run mention rather than borrowed from the deploy above');
const borrowed = run(fixture('borrowed', FAILED_RUN_FIRST,
    rollback({ bundleSha: '11111111', bundleBytes: '111111' })));
ok(borrowed.code === 1
    && /names a different bundle from the one that deploy captured/.test(borrowed.json.failures.join(' ')),
    'naming the PREVIOUS dispatch\'s bundle in a multi-deploy entry fails, which is the borrow it used to permit');

/* Both spellings. `rollback_bundle_sha256 <hex>` — no equals sign — is what the
   capture receipt prints and what EXECUTION_LOG.md overwhelmingly carries; the
   first version read only `sealed_bundle_sha256 = <hex>`, so the bundle
   comparison was silently skipped for almost every real entry. */
ok(failedFirst.json && failedFirst.json.live.run === '33684111985'
    && borrowed.json && /3010578bb4/.test(borrowed.json.failures.join(' ')),
    'the `rollback_bundle_sha256` spelling is read, not just the `sealed_bundle_sha256 =` one');

/* ---- 8. a lane this guard cannot read is still a deploy ----------------- */

/* Codex P1 on #1253. `deploy-onboarding-edge-functions` also deploys
   `linear-outbound` and `production-write`, and it emits an ef-fingerprint
   attestation rather than the §4 receipt shape — so a dispatch through it moves
   the live versions where this check cannot see them. ROLLBACK.md's own row
   records that this is how the row went stale on 2026-08-27. */
const OTHER_LANE = LOG + [
    '## 2026-09-03 — Staff-sensitive edge functions redeployed',
    '',
    'A `deploy-onboarding-edge-functions` dispatch went out from `abc1234`; it',
    'carries `production-write` and `linear-outbound` in its Track-B step.',
    '',
].join('\n');
const otherLane = run(fixture('otherlane', OTHER_LANE, rollback()));
ok(otherLane.code === 1,
    'a dispatch of another lane that owns these functions, recorded after the newest receipt, FAILS');
const otherText = otherLane.json ? otherLane.json.failures.join(' | ') : '';
ok(/deploy-onboarding-edge-functions/.test(otherText)
    && /production-write/.test(otherText) && /linear-outbound/.test(otherText),
    'and names the lane and which of the four it can move');
ok(/2026-09-03/.test(otherText) && /33684111985/.test(otherText),
    'and both dates, so the reader can see which deploy the row was compared against');

/* Narrow on purpose: a rollback guard that cries wolf gets skimmed, which is
   the failure this repository documents more than any other. */
const laneProse = run(fixture('laneprose', LOG + [
    '## 2026-09-03 — A note about lanes',
    '',
    'This one went through the proper section 4 lane, not the onboarding one,',
    'so `production-write` provenance is intact.',
    '',
].join('\n'), rollback()));
ok(laneProse.code === 0,
    'while prose that merely mentions the onboarding lane, without naming the workflow, does not fire');
const laneBefore = run(fixture('lanebefore', [
    '# Execution log',
    '',
    '## 2026-08-20 — Staff-sensitive edge functions redeployed',
    '',
    'A `deploy-onboarding-edge-functions` dispatch carrying `production-write`.',
    '',
].join('\n') + '\n' + LOG.replace('# Execution log\n\n', ''), rollback()));
ok(laneBefore.code === 0,
    'and neither does one recorded BEFORE the newest receipt — that deploy is already accounted for');

/* The lane roster is DERIVED from the workflow files, not written here: a third
   workflow that starts deploying one of the four has to be picked up without
   anyone remembering to add it. */
const mod = require(SCRIPT);
const lanes = mod.otherOwningLanes();
ok(lanes.length >= 1 && lanes.every(l => l.slugs.length),
    'the other-lane roster is read out of .github/workflows, not listed in the script (' + lanes.length + ' found)');
ok(lanes.some(l => l.base === 'deploy-onboarding-edge-functions'),
    'and it finds the onboarding lane, which is the one that has already made this row stale');
ok(!lanes.some(l => l.base.indexOf('section4') >= 0),
    'while the §4 lane itself is excluded, because its receipts are exactly what this guard reads');

/* Both phrasings the unreadable-entry sweep uses: a table it could not parse
   ("cannot read") and a deploy heading with nothing readable under it ("no
   receipt this guard can read"). A negative that matched only one would pass
   vacuously on the other. */
const UNREADABLE = /no receipt this guard can read|this guard cannot read/;

/* ---- 8b. a deploy entry the guard cannot read is NAMED, not skipped ------ */
/* Codex P1 on #1306. The two 2026-09-05 deploys were logged with unquoted slugs,
   no run id in the heading and no attestation block; none of the three receipt
   parsers saw them, so the guard compared against the 2026-09-02 receipt and the
   Live State row sat two releases stale with this check green. The fixtures
   below append exactly that shape to the REAL files. */
const realLog = fs.readFileSync(path.join(ROOT, 'EXECUTION_LOG.md'), 'utf8');
const realRb = fs.readFileSync(path.join(ROOT, 'ROLLBACK.md'), 'utf8');
const malformed = [
    '',
    '## 2026-09-06 — F27 Section 4 deploy, run #40: production-write 68 → 69',
    '',
    'Deployed from commit `0123456789abcdef0123456789abcdef01234567`.',
    '',
    '| function | active version | source closure SHA-256 | JWT |',
    '|---|---|---|---|',
    '| batch-write | 35 | `' + H.bw + '` | verify_jwt=false |',
    '| deliverable-write | 35 | `' + H.dw + '` | verify_jwt=false |',
    '| linear-outbound | 47 | `' + H.lo47 + '` | verify_jwt=false |',
    '| **production-write** | **69** | `' + 'e'.repeat(64) + '` | verify_jwt=false |',
    '',
].join('\n');
const unread = run(fixture('unreadable-entry', realLog + malformed, realRb));
ok(unread.code === 1 && unread.json
    && unread.json.failures.some(f => /section at line \d+ \("2026-09-06 — F27 Section 4 deploy, run #40/.test(f) && /4 versions-table row\(s\) this guard cannot read/.test(f)),
    'THE SHAPE THAT BLINDED THE GUARD: a Section 4 deploy entry with unquoted slugs, no run id and no attestation is named as unreadable, by line and heading, instead of being silently skipped');
ok(unread.json && unread.json.live && unread.json.live.run === '33991332628',
    'and the verdict still shows the last receipt it COULD read, so the writer sees both what it saw and what it could not');
const headless = malformed.replace(
    '## 2026-09-06 — F27 Section 4 deploy, run #40: production-write 68 → 69',
    '## 2026-09-06 — production-write 68 → 69 shipped');
const headlessRun = run(fixture('unreadable-table', realLog + headless, realRb));
ok(headlessRun.code === 1 && headlessRun.json
    && headlessRun.json.failures.some(f => /section at line \d+ \("2026-09-06 — production-write 68 → 69 shipped/.test(f) && /4 versions-table row\(s\) this guard cannot read/.test(f)),
    'a four-function versions table the guard cannot read is caught even when the heading never says Section 4');
const readable = malformed
    .replace('run #40', 'run `33999999999`')
    .replace('Deployed from commit', 'Dispatched from')
    .replace('| batch-write |', '| `batch-write` |')
    .replace('| deliverable-write |', '| `deliverable-write` |')
    .replace('| linear-outbound |', '| `linear-outbound` |')
    .replace('| **production-write** | **69** |', '| `production-write` | 68 → **69** |');
const readableRun = run(fixture('readable-entry', realLog + readable, realRb));
ok(readableRun.code === 1 && readableRun.json
    && !readableRun.json.failures.some(f => UNREADABLE.test(f))
    && readableRun.json.failures.some(f => /production-write: ROLLBACK says v68, live is v69/.test(f)),
    'the same entry in the parsed shape is READ: the unreadable finding goes away and the stale-row finding takes its place, which is the one the row is then fixed for');

/* ---- 8c. per SECTION, not per entry (Codex, second round on #1306) ------- */
/* One `##` entry legitimately holds several deploys as `###` subsections (the
   2026-08-05 entry carries six). A sweep that accepted a whole entry because
   some receipt sat inside it let a malformed subsection ride on a readable
   sibling: Codex appended the v69 reproduction as a `###` under the v68 entry
   and the guard stayed green. The real log's last entry IS the v68 entry, so
   appending to the file appends inside it. */
const subsection = malformed.replace(
    '## 2026-09-06 — F27 Section 4 deploy, run #40: production-write 68 → 69',
    '### Later the same day, deploy #40: production-write 68 → 69');
const subRun = run(fixture('unreadable-subsection', realLog + subsection, realRb));
ok(subRun.code === 1 && subRun.json
    && subRun.json.failures.some(f => /section at line \d+ \("Later the same day, deploy #40/.test(f) && /4 versions-table row\(s\) this guard cannot read/.test(f)),
    'THE RIDE-ALONG: a malformed deploy written as a ### subsection under an entry that already holds a readable receipt is named on its own, by its own heading');
const sameBlock = malformed.split('\n').filter(l => !/^## /.test(l) && !/^Deployed from commit/.test(l)).join('\n');
const sameBlockRun = run(fixture('unreadable-same-block', realLog + sameBlock, realRb));
ok(sameBlockRun.code === 1 && sameBlockRun.json
    && sameBlockRun.json.failures.some(f => /section at line \d+ \("2026-09-05 — F27 Section 4 deploy, run `33991332628`/.test(f) && /4 versions-table row\(s\) this guard cannot read/.test(f)),
    'and a malformed table appended to the readable entry with no heading at all is caught in the same block, because unreadable rows are counted against parsed rows rather than excused by a neighbour');
const container = [
    '',
    '## 2026-09-07 — F27 Section 4 deploys #40–#41: two in one day',
    '',
    'Both dispatched by the owner; each subsection carries its own receipt.',
    '',
    '### Deploy #40, run `33999999901`',
    '',
    'Dispatched from `0123456789abcdef0123456789abcdef01234567`.',
    '',
    '| function | active version | source closure SHA-256 | JWT |',
    '|---|---|---|---|',
    '| `batch-write` | 35 | `' + H.bw + '` | verify_jwt=false |',
    '| `deliverable-write` | 35 | `' + H.dw + '` | verify_jwt=false |',
    '| `linear-outbound` | 47 | `' + H.lo47 + '` | verify_jwt=false |',
    '| `production-write` | 68 → **69** | `' + 'e'.repeat(64) + '` | verify_jwt=false |',
    '',
    '### Deploy #41, run `33999999902`',
    '',
    'Dispatched from `89abcdef0123456789abcdef0123456789abcdef`.',
    '',
    '| function | active version | source closure SHA-256 | JWT |',
    '|---|---|---|---|',
    '| `batch-write` | 35 | `' + H.bw + '` | verify_jwt=false |',
    '| `deliverable-write` | 35 | `' + H.dw + '` | verify_jwt=false |',
    '| `linear-outbound` | 47 | `' + H.lo47 + '` | verify_jwt=false |',
    '| `production-write` | 69 → **70** | `' + 'f'.repeat(64) + '` | verify_jwt=false |',
    '',
].join('\n');
const containerRun = run(fixture('container-heading', realLog + container, realRb));
ok(containerRun.json && !containerRun.json.failures.some(f => UNREADABLE.test(f))
    && containerRun.json.failures.some(f => /production-write: ROLLBACK says v68, live is v70/.test(f)),
    'a container heading that names Section 4 deploys over two READABLE subsections is not flagged -- the receipts under it count for it -- and the guard moves on to the row, which is stale');

/* ---- 8d. a nested deploy heading needs its OWN receipt (Codex, third round) -- */
/* A `### Deploy #40` under a Section 4 container, with only prose beneath it,
   does not repeat "Section 4" in its own heading; judged on its own text alone
   it looked like commentary, and the container passed on its sibling's receipt.
   Section 4 context is inherited from ancestor headings now. */
const nestedProse = [
    '',
    '### Deploy #40 — RECORDED',
    '',
    'Deployed v69 by hand after the row above; the attestation will follow.',
    '',
].join('\n');
const nestedRun = run(fixture('nested-deploy-heading', realLog + nestedProse, realRb));
ok(nestedRun.code === 1 && nestedRun.json
    && nestedRun.json.failures.some(f => /section at line \d+ \("Deploy #40 — RECORDED"\) reads as a Section 4 deploy \(under a Section 4 heading\) but holds no receipt/.test(f)),
    'THE NESTED RIDE-ALONG: a ### heading that names a deploy under a Section 4 entry, with only prose beneath it, is required to carry its own receipt and is named when it does not');
const nestedCommentary = nestedProse.replace('### Deploy #40 — RECORDED', '### What the first attempt taught');
const commentaryRun = run(fixture('nested-commentary', realLog + nestedCommentary, realRb));
ok(commentaryRun.json && !commentaryRun.json.failures.some(f => UNREADABLE.test(f)),
    'while a nested heading under the same entry that does not name a deploy is commentary, and asks for nothing');
const supersedes = nestedProse.replace('### Deploy #40 — RECORDED', '### Deploy #40 — supersedes run `33991332628`');
const supersedesRun = run(fixture('nested-mention', realLog + supersedes, realRb));
ok(supersedesRun.code === 1 && supersedesRun.json
    && supersedesRun.json.failures.some(f => /\("Deploy #40 — supersedes run `33991332628`"\) reads as a Section 4 deploy/.test(f)),
    'A MENTION IS NOT AN IDENTITY (Codex, fifth round): a nested deploy heading that names a receipted run it merely SUPERSEDES is still unreadable -- there is no readable-by-reference softening, because no text rule can tell "this is run X" from "this comes after run X"');
/* Mixed ordering: the log is reverse-chronological at the top and forward
   further down, so a new entry can legitimately be written after an older one.
   The entry date has to come from the section's OWN heading; a slice that stops
   short of it reads the previous entry's date and softens a brand-new deploy
   into history. Codex reproduced exactly that with 2026-08-31 before 2026-09-06. */
const olderAt = realLog.indexOf('\n## 2026-08-31');
const afterOlder = realLog.indexOf('\n## ', olderAt + 1);
ok(olderAt > 0 && afterOlder > olderAt, 'the real log has a 2026-08-31 entry followed by another entry, which the next case needs');
const misordered = realLog.slice(0, afterOlder) + '\n' + malformed.replace('2026-09-06 — F27 Section 4 deploy, run #40', '2026-09-06 — F27 Section 4 deploy, run #41') + realLog.slice(afterOlder);
const misorderedRun = run(fixture('misordered-new-entry', misordered, realRb));
ok(misorderedRun.code === 1 && misorderedRun.json
    && misorderedRun.json.failures.some(f => /\("2026-09-06 — F27 Section 4 deploy, run #41/.test(f) && UNREADABLE.test(f))
    && !misorderedRun.json.notes.some(n => /run #41/.test(n)),
    'a brand-new unreadable `##` deploy entry written after an OLDER entry is dated by its own heading (2026-09-06) and FAILS -- it is not softened into history by the 2026-08-31 entry above it');

/* ---- 8e. the concise-prose layout (Codex, sixth round) ------------------- */
/* The top of this log records deploys under generic "Deploy: ..." headings and
   names Section 4 only in the body: "**Section 4 forward from `<sha>`, run
   `<id>`, PASS.**". A heading-only rule never saw such an entry, so one written
   with an unparseable run id vanished. Section 4 in the BODY now counts. */
const conciseEntry = [
    '',
    '## 2026-09-06 — Deploy: the reuse window widened',
    '',
    '**Section 4 forward from `0123456789abcdef`, run #40, PASS.** `production-write`',
    '68 → **69**, closure `' + 'e'.repeat(64) + '`. The other',
    'three were byte-identical redeploys.',
    '',
].join('\n');
const conciseRun = run(fixture('concise-unreadable', realLog + conciseEntry, realRb));
ok(conciseRun.code === 1 && conciseRun.json
    && conciseRun.json.failures.some(f => /\("2026-09-06 — Deploy: the reuse window widened"\) reads as a Section 4 deploy \(Section 4 named in its body\)/.test(f) && UNREADABLE.test(f)),
    'THE CONCISE LAYOUT: a generic "Deploy" heading whose body claims a Section 4 forward with an unparseable run id is named as unreadable, because Section 4 in the body counts');
const unrelated = conciseEntry
    .replace('## 2026-09-06 — Deploy: the reuse window widened', '## 2026-09-06 — Deploy notes for the website')
    .replace(/\*\*Section 4 forward[^\n]*\n[^\n]*\n[^\n]*\n/, 'Pages redeployed the site from main; nothing about the four functions.\n');
const unrelatedRun = run(fixture('unrelated-deploy-heading', realLog + unrelated, realRb));
ok(unrelatedRun.json && !unrelatedRun.json.failures.some(f => UNREADABLE.test(f)),
    'while a "Deploy" heading whose body never names Section 4 is some other lane\'s business and asks for nothing');

/* ---- 8f. body-defined Section 4 context reaches the children (round seven) -- */
/* A generic "Deploys" container that names F27 Section 4 only in its body, over
   a readable ### Deploy #39 and an unreceipted ### Deploy #40. The context has
   to travel down from the body, not only from heading text, or #40 rides on
   #39's receipt through the parent. */
const bodyContext = [
    '',
    '## 2026-09-06 — Deploys: two in one evening',
    '',
    'Both through the F27 Section 4 lane, dispatched by the owner.',
    '',
    '### Deploy #39, run `33999999901`',
    '',
    'Dispatched from `0123456789abcdef0123456789abcdef01234567`.',
    '',
    '| function | active version | source closure SHA-256 | JWT |',
    '|---|---|---|---|',
    '| `batch-write` | 35 | `' + H.bw + '` | verify_jwt=false |',
    '| `deliverable-write` | 35 | `' + H.dw + '` | verify_jwt=false |',
    '| `linear-outbound` | 47 | `' + H.lo47 + '` | verify_jwt=false |',
    '| `production-write` | 68 → **69** | `' + 'e'.repeat(64) + '` | verify_jwt=false |',
    '',
    '### Deploy #40 — RECORDED',
    '',
    'Deployed v70 an hour later; the attestation will follow.',
    '',
].join('\n');
const bodyContextRun = run(fixture('body-context-children', realLog + bodyContext, realRb));
ok(bodyContextRun.code === 1 && bodyContextRun.json
    && bodyContextRun.json.failures.some(f => /\("Deploy #40 — RECORDED"\) reads as a Section 4 deploy \(under a Section 4 heading\)/.test(f) && UNREADABLE.test(f)),
    'THE BODY CONTEXT TRAVELS DOWN: under a generic "Deploys" container that names Section 4 only in its body, an unreceipted ### Deploy #40 is named even though a readable ### Deploy #39 sits beside it');
ok(bodyContextRun.json && !bodyContextRun.json.failures.some(f => /\("Deploy #39, run `33999999901`"\)/.test(f) && UNREADABLE.test(f)),
    'and the readable ### Deploy #39 beside it is not');

/* ---- 8g. nested sections are dated by themselves; abbreviated closures ----- */
/* Codex, eighth round. The real 2026-08-05 container holds deploy subsections
   dated through 2026-08-19, so an unreadable "### Deploy #40 (run `34000000000`,
   2026-09-06)" written inside it took the container's date and was softened
   into history. A nested section is dated by its own heading only, and a run
   id at or past the newest receipt's is newer by construction. Separately, the
   candidate-row detector required a 64-hex closure, so a table whose closures
   were abbreviated was invisible to it. */
const containerAt = realLog.indexOf('\n## 2026-08-05 — F27 Section 4 four-function deploy');
const afterContainer = realLog.indexOf('\n## ', containerAt + 1);
ok(containerAt > 0 && afterContainer > containerAt, 'the real log has the 2026-08-05 container the next cases write into');
const insertInto = text => realLog.slice(0, afterContainer) + '\n' + text + realLog.slice(afterContainer);
const nestedDated = ['### Deploy #40 — RECORDED (run `34000000000`, 2026-09-06)', '', 'Deployed v69 by hand; the attestation will follow.', ''].join('\n');
const nestedDatedRun = run(fixture('nested-own-date', insertInto(nestedDated), realRb));
ok(nestedDatedRun.code === 1 && nestedDatedRun.json
    && nestedDatedRun.json.failures.some(f => /\("Deploy #40 — RECORDED \(run `34000000000`, 2026-09-06\)"\)/.test(f) && UNREADABLE.test(f))
    && !nestedDatedRun.json.notes.some(n => /Deploy #40/.test(n)),
    'A NESTED SECTION IS DATED BY ITSELF: an unreadable dated ### deploy inside the 2026-08-05 container FAILS on its own 2026-09-06, not softened by the container\'s date');
const nestedRunOnly = ['### Deploy #41 — RECORDED (run `34000000001`)', '', 'Deployed later the same night.', ''].join('\n');
const nestedRunOnlyRun = run(fixture('nested-newer-run', insertInto(nestedRunOnly), realRb));
ok(nestedRunOnlyRun.code === 1 && nestedRunOnlyRun.json
    && nestedRunOnlyRun.json.failures.some(f => /\("Deploy #41 — RECORDED \(run `34000000001`\)"\)/.test(f) && UNREADABLE.test(f)),
    'and one with no date of its own but a run id past the newest receipt\'s is newer by construction and FAILS');
const nestedUndated = ['### Deploy #42 — RECORDED', '', 'Deployed; details to follow.', ''].join('\n');
const nestedUndatedRun = run(fixture('nested-undated', insertInto(nestedUndated), realRb));
ok(nestedUndatedRun.code === 1 && nestedUndatedRun.json
    && nestedUndatedRun.json.failures.some(f => /\("Deploy #42 — RECORDED"\)/.test(f) && UNREADABLE.test(f)),
    'and one with neither a date nor a run id of its own cannot be placed in time and FAILS -- the container\'s date is not inherited');
const abbreviated = [
    '',
    '## 2026-09-06 — production-write 68 → 69 shipped',
    '',
    '| function | active version | source closure SHA-256 | JWT |',
    '|---|---|---|---|',
    '| batch-write | 35 | `86f9f187...` | verify_jwt=false |',
    '| deliverable-write | 35 | `78df060b...` | verify_jwt=false |',
    '| linear-outbound | 47 | `1489a4c2...` | verify_jwt=false |',
    '| **production-write** | **69** | `eeeeeeee...` | verify_jwt=false |',
    '',
].join('\n');
const abbreviatedRun = run(fixture('abbreviated-closures', realLog + abbreviated, realRb));
ok(abbreviatedRun.code === 1 && abbreviatedRun.json
    && abbreviatedRun.json.failures.some(f => /\("2026-09-06 — production-write 68 → 69 shipped"\) carries 4 versions-table row\(s\) this guard cannot read/.test(f)),
    'ABBREVIATED CLOSURES: a four-function table whose closures are shortened is still a table, and one the guard cannot read, so it is named -- a 64-hex closure is not a precondition for being counted');

/* ---- 8h. "accepted by the parser", not "looks strict" (round nine) --------- */
/* A row with a quoted slug and a full closure but a version cell of "unknown"
   is rejected by receiptsFromTables (it needs a number), yet a lookalike regex
   in the detector called it strict and excused the whole group. The detector
   now asks the parser which rows it accepted, by position. */
const unknownVersion = [
    '',
    '## 2026-09-06 — production-write 68 → 69 shipped',
    '',
    '| function | active version | source closure SHA-256 | JWT |',
    '|---|---|---|---|',
    '| `production-write` | unknown | `' + 'e'.repeat(64) + '` | verify_jwt=false |',
    '| batch-write | 35 | `86f9f187...` | verify_jwt=false |',
    '| deliverable-write | 35 | `78df060b...` | verify_jwt=false |',
    '| linear-outbound | 47 | `1489a4c2...` | verify_jwt=false |',
    '',
].join('\n');
const unknownVersionRun = run(fixture('unknown-version-row', realLog + unknownVersion, realRb));
ok(unknownVersionRun.code === 1 && unknownVersionRun.json
    && unknownVersionRun.json.failures.some(f => /\("2026-09-06 — production-write 68 → 69 shipped"\) carries 4 versions-table row\(s\) this guard cannot read/.test(f)),
    'ACCEPTED, NOT LOOKALIKE: a group whose one strict-looking row the parser actually rejected (version "unknown") is wholly unreadable and named -- the detector defers to the parser by position');

/* ---- 8i. one accepted row does not excuse three rejected ones (round ten) --- */
/* A second table in the v68 entry with one parser-accepted production-write
   row and three abbreviated rows: the accepted row inherits the entry's run id,
   folds into that run's JSON receipt at deduplication, and disappears, so
   "some row accepted" excused a table nobody could read. Every row has to be
   accepted; the rejected ones are counted. */
const mixedGroup = [
    '',
    '| function | active version | source closure SHA-256 | JWT |',
    '|---|---|---|---|',
    '| `production-write` | 69 | `' + 'e'.repeat(64) + '` | verify_jwt=false |',
    '| batch-write | 35 | `86f9f187...` | verify_jwt=false |',
    '| deliverable-write | 35 | `78df060b...` | verify_jwt=false |',
    '| linear-outbound | 47 | `1489a4c2...` | verify_jwt=false |',
    '',
].join('\n');
const mixedRun = run(fixture('mixed-group', realLog + mixedGroup, realRb));
ok(mixedRun.code === 1 && mixedRun.json
    && mixedRun.json.failures.some(f => /\("2026-09-05 — F27 Section 4 deploy, run `33991332628`/.test(f) && /carries 3 versions-table row\(s\) this guard cannot read/.test(f)),
    'ONE ACCEPTED ROW EXCUSES NOTHING: a second table under the v68 entry with one parsed row and three abbreviated ones is named for its three unreadable rows');

/* ---- 8j. indented tables (round eleven) ------------------------------------ */
/* Markdown tables inside list content are routinely indented by a space or
   more. Both the strict parser and the candidate-row sweep required the pipe
   in column 1, so an indented table was invisible to both. */
const indentedMalformed = [
    '',
    '## 2026-09-06 — production-write 68 → 69 shipped',
    '',
    ' | function | active version | source closure SHA-256 | JWT |',
    ' |---|---|---|---|',
    ' | batch-write | 35 | `86f9f187...` | verify_jwt=false |',
    ' | deliverable-write | 35 | `78df060b...` | verify_jwt=false |',
    ' | linear-outbound | 47 | `1489a4c2...` | verify_jwt=false |',
    ' | **production-write** | **69** | `eeeeeeee...` | verify_jwt=false |',
    '',
].join('\n');
const indentedMalformedRun = run(fixture('indented-malformed', realLog + indentedMalformed, realRb));
ok(indentedMalformedRun.code === 1 && indentedMalformedRun.json
    && indentedMalformedRun.json.failures.some(f => /\("2026-09-06 — production-write 68 → 69 shipped"\) carries 4 versions-table row\(s\) this guard cannot read/.test(f)),
    'INDENTATION HIDES NOTHING: a malformed four-function table indented by one space is still counted, four rows, under a heading with no Section 4 signal of its own');
const indentedReadable = [
    '',
    '## 2026-09-06 — F27 Section 4 deploy, run `33999999903`: production-write 68 → 69',
    '',
    'Dispatched from `0123456789abcdef0123456789abcdef01234567`.',
    '',
    '  | function | active version | source closure SHA-256 | JWT |',
    '  |---|---|---|---|',
    '  | `batch-write` | 35 | `' + H.bw + '` | verify_jwt=false |',
    '  | `deliverable-write` | 35 | `' + H.dw + '` | verify_jwt=false |',
    '  | `linear-outbound` | 47 | `' + H.lo47 + '` | verify_jwt=false |',
    '  | `production-write` | 68 → **69** | `' + 'e'.repeat(64) + '` | verify_jwt=false |',
    '',
].join('\n');
const indentedReadableRun = run(fixture('indented-readable', realLog + indentedReadable, realRb));
ok(indentedReadableRun.json && !indentedReadableRun.json.failures.some(f => UNREADABLE.test(f))
    && indentedReadableRun.json.failures.some(f => /production-write: ROLLBACK says v68, live is v69/.test(f)),
    'and a well-formed table indented by two spaces is READ by the strict parser, so the entry becomes the newest receipt and the row is what fails');

/* ---- 8k. parsed rows that fold away; nested receipts dated by themselves --- */
/* Codex, twelfth round. (1) A second, syntactically valid one-row v69 table
   appended to the v68 entry: every row parses, the row inherits the entry's run
   id and folds into that run's attestation at deduplication. Two guards now:
   a candidate group must name all four functions once each, and two receipts
   for one run must agree. (2) A READABLE nested deploy dated by its own heading
   inside the 2026-08-05 container was dated by the container, so the newest
   deploy by run id failed chronology instead of comparing against the row. */
const oneRowValid = [
    '',
    '| function | active version | source closure SHA-256 | JWT |',
    '|---|---|---|---|',
    '| `production-write` | 69 | `' + 'e'.repeat(64) + '` | verify_jwt=false |',
    '',
].join('\n');
const oneRowRun = run(fixture('one-row-valid', realLog + oneRowValid, realRb));
ok(oneRowRun.code === 1 && oneRowRun.json
    && oneRowRun.json.failures.some(f => /\("2026-09-05 — F27 Section 4 deploy, run `33991332628`/.test(f) && /1 versions table\(s\) that do not name all four functions/.test(f))
    && oneRowRun.json.failures.some(f => /two receipts claim run 33991332628 but disagree on production-write: the attestation block says v68, a summary table .* says v69/.test(f)),
    'A PARSED ROW THAT FOLDS AWAY IS CAUGHT TWICE: a valid one-row v69 table under the v68 entry is a truncated table, and its inherited run id disagrees with the surviving attestation');
const fullValidNoHeading = [
    '',
    '| function | active version | source closure SHA-256 | JWT |',
    '|---|---|---|---|',
    '| `batch-write` | 35 | `' + H.bw + '` | verify_jwt=false |',
    '| `deliverable-write` | 35 | `' + H.dw + '` | verify_jwt=false |',
    '| `linear-outbound` | 47 | `' + H.lo47 + '` | verify_jwt=false |',
    '| `production-write` | 69 | `' + 'e'.repeat(64) + '` | verify_jwt=false |',
    '',
].join('\n');
const fullNoHeadingRun = run(fixture('full-valid-no-heading', realLog + fullValidNoHeading, realRb));
ok(fullNoHeadingRun.code === 1 && fullNoHeadingRun.json
    && fullNoHeadingRun.json.failures.some(f => /two receipts claim run 33991332628 but disagree on production-write/.test(f)),
    'and a COMPLETE valid table appended under the v68 entry without its own heading is still caught, by the disagreement alone -- the table is well-formed, its identity is borrowed');
const nestedReadable = [
    '### 2026-09-06 — Deploy #40, run `34000000000`',
    '',
    'Dispatched from `0123456789abcdef0123456789abcdef01234567`.',
    '',
    '| function | active version | source closure SHA-256 | JWT |',
    '|---|---|---|---|',
    '| `batch-write` | 35 | `' + H.bw + '` | verify_jwt=false |',
    '| `deliverable-write` | 35 | `' + H.dw + '` | verify_jwt=false |',
    '| `linear-outbound` | 47 | `' + H.lo47 + '` | verify_jwt=false |',
    '| `production-write` | 68 → **69** | `' + 'e'.repeat(64) + '` | verify_jwt=false |',
    '',
    'sealed_bundle_sha256 = `' + 'f'.repeat(64) + '`, sealed_bundle_byte_length = `1`.',
    '',
].join('\n');
const nestedReadableRun = run(fixture('nested-readable-dated', insertInto(nestedReadable), realRb));
ok(nestedReadableRun.json && nestedReadableRun.json.live && nestedReadableRun.json.live.run === '34000000000'
    && !nestedReadableRun.json.failures.some(f => /not the newest by\s+date|chronology signals disagree|carries no receipt/.test(f))
    && nestedReadableRun.json.failures.some(f => /production-write: ROLLBACK says v68, live is v69/.test(f)),
    'A READABLE NESTED DEPLOY IS DATED BY ITS OWN HEADING: inserted into the 2026-08-05 container it becomes the newest receipt on 2026-09-06 with no chronology complaint, and the row is what fails');

/* ---- 8l. truncated attestations; deeper headings (round thirteen) ------------ */
const shortAttestation = [
    '',
    'Later the same evening `production-write` 68 → **69** shipped; attestation:',
    '',
    '```json',
    JSON.stringify({
        schema: 'syncview_f27_section4_deployed_versions_v1',
        deploy_commit: '3d534cfa5598ef16e61c5ee7dc8072afaa9963c7',
        github_run_id: '33991332628',
        functions: [
            { slug: 'batch-write', active_version: '35', source_closure_sha256: H.bw, verify_jwt: false },
            { slug: 'deliverable-write', active_version: '35', source_closure_sha256: H.dw, verify_jwt: false },
            { slug: 'linear-outbound', active_version: '47', source_closure_sha256: H.lo47, verify_jwt: false },
        ],
    }, null, 2),
    '```',
    '',
].join('\n');
const shortRun = run(fixture('short-attestation', realLog + shortAttestation, realRb));
ok(shortRun.code === 1 && shortRun.json
    && shortRun.json.failures.some(f => /an attestation block at character \d+ .*\(run 33991332628\) names 3 of the four functions and omits production-write/.test(f))
    && shortRun.json.failures.some(f => /two receipts claim run 33991332628 but disagree on production-write: the attestation block says v68, an attestation block .* does not name it/.test(f)),
    'A TRUNCATED ATTESTATION IS CAUGHT TWICE: a three-function block under the v68 run is named for the function it omits, and its keyset disagreement with the complete block is a conflict');
const deepHeading = nestedReadable.replace('### 2026-09-06 — Deploy #40, run `34000000000`', '##### 2026-09-06 — Deploy #40, run `34000000000`');
const deepRun = run(fixture('deep-heading', insertInto(deepHeading), realRb));
ok(deepRun.json && deepRun.json.live && deepRun.json.live.run === '34000000000'
    && !deepRun.json.failures.some(f => /not the newest by\s+date|chronology signals disagree|carries no receipt/.test(f))
    && deepRun.json.failures.some(f => /production-write: ROLLBACK says v68, live is v69/.test(f)),
    'and a receipt under a level-five heading is dated by that heading, so it is the newest on 2026-09-06 with no chronology complaint and the row is what fails');

/* ---- 9. the real repository -------------------------------------------- */

const real = run(ROOT);
ok(real.code === 0, 'and the repository as it stands right now is consistent');
ok(real.json && real.json.notes.some(n => /Deploy: batch folder links, after two blockers on one call stack/.test(n) && /1 versions-table row\(s\)/.test(n) && /before the newest readable receipt/.test(n)),
    'the 2026-08-31 entry, whose table abbreviates one closure beside three full ones (its receipt is the concise prose), is a NOTE for that one row rather than a failure, because it predates the newest receipt');
ok(real.json && real.json.notes.some(n => /Deploys #9-#13 — GAP/.test(n) && /before the newest readable receipt/.test(n)),
    'the historical "Deploys #9-#13 — GAP" section, whose four un-receipted runs can never be read, is a NOTE rather than a failure because its entry predates the newest receipt -- an old gap cannot make the row stale, and a guard that failed on it forever would be ignored');
ok(real.json && !real.json.failures.some(f => UNREADABLE.test(f)),
    'and every Section 4 deploy entry in the real log is one the guard can read, today included');

fs.rmSync(tmp, { recursive: true, force: true });

if (failures) {
    console.log('\n' + failures + ' check(s) failed.');
    process.exit(1);
}
console.log('\nROLLBACK row freshness checks passed');
