'use strict';
/* Behaviour of the client review send queue (src/index/185-client-review-queue.js.part),
   run for real in a sandbox with the page's globals stubbed. Covers the review
   findings on PR 1675: a held Approve never lands on a newer state (including the
   two-device case), every entry has a hard maximum age that survives a reload,
   superseded / early-return paths leave nothing on "Sending...", and the toast is
   taken down even when browser storage is unavailable. */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const { splitModuleFragment } = require('../scripts/index-modules');
// 185 is an ES module source; the served page strips its import header and export footer.
const src = splitModuleFragment(fs.readFileSync(path.join(root, 'src/index/185-client-review-queue.js.part'))).body.toString('utf8');
const c190 = fs.readFileSync(path.join(root, 'src/index/190-calendar-approval-comments.js.part'), 'utf8');

let failed = 0;
const t = (ok, msg) => { console.log((ok ? '  ok  ' : '  ❌  ') + msg); if (!ok) failed++; };

function memStorage() {
    const m = {};
    return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } };
}
function sandbox(opts) {
    const o = Object.assign({ storage: memStorage(), serverRow: null, fetchFails: false, flushError: '' }, opts || {});
    const log = { mints: 0, toasts: [], hides: 0, notes: [], flushes: 0, fetches: 0, tweaks: 0 };
    const post = Object.assign({ id: 'p1', caption_status: 'Client Approval', video_status: 'Approved',
        graphic_status: 'Approved', status: 'Client Approval' }, o.post || {});
    const env = {
        _isClientLink: true,
        calState: { client: 'c', posts: [post] },
        calClientSlug: () => 'c',
        localStorage: o.storage,
        navigator: { onLine: true },
        showToast: (m) => log.toasts.push(m),
        hideToast: () => { log.hides++; },
        showNotify: (a, b) => log.notes.push(a + ' | ' + b),
        _calReviewState: { saving: {}, errors: {}, drafts: {}, draftActionIds: {} },
        _calPendingEdits: {},
        _calRenderBody: () => {},
        _calFlushCardSave: async () => { log.flushes++; if (o.flushError) post._saveError = o.flushError; else delete post._saveError; },
        _writeUiFailureSentence: e => String(e && e.message || e),
        _writeRefusalNewId: () => '0f8fad5b-d9cb-469f-a165-70867728950e',
        _writeRefusalStageAttempt: () => {},
        _calReviewRequestTweak: (pid, comp) => { log.tweaks++; if (o.tweakStarts) env._calReviewState.saving[pid + '|' + comp] = true; },
        CAL_SUPABASE_URL: 'https://example.invalid', CAL_SUPABASE_ANON_KEY: 'k',
        fetch: async () => {
            log.fetches++;
            if (o.fetchFails) throw new TypeError('Failed to fetch');
            return { ok: true, json: async () => (o.serverRow ? [o.serverRow] : []) };
        },
        _calMintCommentId: () => 'm' + (++log.mints),
        setTimeout: () => 0, clearTimeout: () => {},
    };
    const names = Object.keys(env);
    const api = new Function(...names, src + '\nreturn { _calCrqBegin, _calCrqDone, _calCrqFailed, _calCrqResolve, _calCrqResend, _crqMine, _crqRun };')
        (...names.map(n => env[n]));
    return { api, env, log, post, o };
}
const approveData = { edits: { caption_status: 'Approved', status: 'Approved', client_caption_approved_at: 'x' },
    prev: { caption_status: 'Client Approval', status: 'Client Approval' }, serverStatus: { caption: 'Client Approval' } };

(async () => {
    // 1. Two devices: approve held on A, change request made on B, A reconnects.
    {
        const s = sandbox({ serverRow: { caption_status: 'Tweaks Needed' } });
        s.api._calCrqBegin('approve', 'p1', 'caption', approveData);
        t(s.api._calCrqFailed('p1', 'caption', 'Failed to fetch') === true, 'two devices: a connection failure holds the approve on device A');
        await s.api._calCrqResend();
        t(s.log.fetches === 1, 'two devices: the re-send reads the row from the server first');
        t(s.log.flushes === 0, 'two devices: the held approve is NOT sent over the change request made on device B');
        t(s.api._crqMine().length === 0, 'two devices: the held approve is dropped');
        t(s.post.caption_status === 'Tweaks Needed', 'two devices: the screen shows the server state (the change request wins)');
        t(/changed while your approval was waiting/.test(s.log.notes.join()), 'two devices: the client is told plainly it was not saved');
    }
    // 1b. The local copy is never trusted: local says waiting, server says moved on.
    {
        const s = sandbox({ serverRow: { caption_status: 'For SMM Approval' } });
        s.api._calCrqBegin('approve', 'p1', 'caption', approveData);
        s.api._calCrqFailed('p1', 'caption', 'Failed to fetch');
        s.post.caption_status = 'Client Approval';
        await s.api._calCrqResend();
        t(s.log.flushes === 0, 'a re-send is decided by the server row, not the local copy');
    }
    // 1c. "Tweaks Needed" and "Approved" no longer count as still waiting.
    {
        const s = sandbox({ serverRow: { caption_status: 'Tweaks Needed' } });
        s.api._calCrqBegin('approve', 'p1', 'caption', Object.assign({}, approveData, { serverStatus: { caption: 'Client Approval' } }));
        s.api._calCrqFailed('p1', 'caption', 'Failed to fetch');
        await s.api._calCrqResend();
        t(s.log.flushes === 0, 'a server now at Tweaks Needed is a newer state, not "still waiting"');
    }
    // 1d. Unchanged on the server: the approve is re-sent once and confirmed.
    {
        const s = sandbox({ serverRow: { caption_status: 'Client Approval' } });
        s.api._calCrqBegin('approve', 'p1', 'caption', approveData);
        s.api._calCrqFailed('p1', 'caption', 'Failed to fetch');
        await s.api._calCrqResend();
        t(s.log.flushes === 1 && s.api._crqMine().length === 0, 'unchanged server status: the approve is re-sent once and cleared');
        t(s.log.toasts[s.log.toasts.length - 1] === 'Approved', 'unchanged server status: the client sees "Approved"');
    }
    // 1e. The first send landed and only its answer was lost: no second write.
    {
        const s = sandbox({ serverRow: { caption_status: 'Approved' } });
        s.api._calCrqBegin('approve', 'p1', 'caption', approveData);
        s.api._calCrqFailed('p1', 'caption', 'Failed to fetch');
        await s.api._calCrqResend();
        t(s.log.flushes === 0 && s.api._crqMine().length === 0, 'already approved on the server: confirmed without a second write');
    }
    // 1f. Still offline: the server read fails, the approve stays held.
    {
        const s = sandbox({ fetchFails: true });
        s.api._calCrqBegin('approve', 'p1', 'caption', approveData);
        s.api._calCrqFailed('p1', 'caption', 'Failed to fetch');
        await s.api._calCrqResend();
        t(s.log.flushes === 0 && s.api._crqMine().length === 1, 'server unreachable: the approve stays held, nothing written');
    }
    // 1g. Key clash: a whole-post approve is replaced by a later per-part change request.
    {
        const s = sandbox();
        s.api._calCrqBegin('approve', 'p1', 'all', { edits: { caption_status: 'Approved' }, serverStatus: { video: 'x', graphic: 'x', caption: 'x' } });
        s.api._calCrqFailed('p1', 'all', 'Failed to fetch');
        s.api._calCrqBegin('request', 'p1', 'caption', { body: 'please change', actionId: 'a1' });
        const kinds = s.api._crqMine().map(e => e.kind + ':' + e.comp).join(',');
        t(kinds === 'request:caption', 'a later change request on a part removes the held whole-post approve (' + kinds + ')');
    }
    // 2. Hard maximum age from the click, surviving a reload (a fresh page on the same storage).
    {
        const storage = memStorage();
        const a = sandbox({ storage, serverRow: { caption_status: 'Client Approval' } });
        a.api._calCrqBegin('approve', 'p1', 'caption', approveData);
        const all = JSON.parse(storage.getItem('sv-client-review-queue-v1'));
        Object.values(all).forEach(e => { e.at = Date.now() - 31 * 60 * 1000; });
        storage.setItem('sv-client-review-queue-v1', JSON.stringify(all));
        const b = sandbox({ storage, serverRow: { caption_status: 'Client Approval' } });   // the reload
        await b.api._calCrqResend();
        t(b.log.flushes === 0 && b.log.fetches === 0, 'max age: an entry older than 30 minutes is not re-sent after a reload');
        t(b.api._crqMine().length === 0, 'max age: the expired entry is dropped');
        t(/was not saved/.test(b.log.notes.join()), 'max age: the client is told plainly it was not saved');
        const c = sandbox({ storage });
        c.api._calCrqBegin('approve', 'p1', 'caption', approveData);
        const all2 = JSON.parse(storage.getItem('sv-client-review-queue-v1'));
        Object.values(all2).forEach(e => { e.at = Date.now() - 31 * 60 * 1000; });
        storage.setItem('sv-client-review-queue-v1', JSON.stringify(all2));
        t(c.api._calCrqFailed('p1', 'caption', 'Failed to fetch') === false, 'max age: a connection failure past the age is final, not held');
    }
    // 3. Superseded / early returns leave nothing behind.
    {
        const s = sandbox();
        s.api._calCrqBegin('request', 'p1', 'caption', { body: 'x', actionId: 'a1' });
        s.api._calCrqResolve('p1', 'caption');
        t(s.api._crqMine().length === 0 && !s.api._crqRun.inflight.size, 'superseded: the entry and its in-flight mark are cleared');
        t(s.log.hides >= 1, 'superseded: "Sending..." is taken down');
        t((c190.match(/_calCrqResolve\(pid, comp\)/g) || []).length >= 2, 'both superseded returns in the change-request handler resolve the queue');
    }
    {
        const s = sandbox({ tweakStarts: false });
        s.api._calCrqBegin('request', 'p1', 'caption', { body: 'x', actionId: 'a1' });
        s.api._calCrqFailed('p1', 'caption', 'Failed to fetch');
        await s.api._calCrqResend();
        t(s.log.tweaks === 1 && s.api._crqMine().length === 0, 'early return on replay: the entry is dropped, not replayed forever');
        t(/changed while your change request was waiting/.test(s.log.notes.join()), 'early return on replay: the client is told');
    }
    {
        const s = sandbox({ tweakStarts: true });
        s.api._calCrqBegin('request', 'p1', 'caption', { body: 'x', actionId: 'a1' });
        const at0 = s.api._crqMine()[0].at;
        s.api._calCrqFailed('p1', 'caption', 'Failed to fetch');
        s.env._calReviewRequestTweak = null;
        t(s.api._crqMine()[0].actionId === 'a1', 'a held change request keeps its action id');
        const s3 = sandbox();
        s3.api._calCrqBegin('request', 'p1', 'caption', { body: 'y' });
        const minted = s3.api._crqMine()[0].actionId;
        t(!!minted && s3.env._calReviewState.draftActionIds['p1|caption'] === minted, 'a new change request gets its action id stored before the first send');
        t(at0 > 0, 'a held change request keeps its click time');
    }
    // 4. Storage unavailable: the toast still comes down after a successful save.
    {
        const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
        const s = sandbox({ storage: broken });
        s.api._calCrqBegin('approve', 'p1', 'caption', approveData);
        t(s.log.toasts[0] === 'Sending...', 'no storage: "Sending..." still shows');
        s.api._calCrqDone('p1', 'caption');
        t(s.log.hides >= 1, 'no storage: "Sending..." is taken down on success');
        const s2 = sandbox({ storage: broken });
        s2.api._calCrqBegin('approve', 'p1', 'caption', approveData);
        s2.api._calCrqFailed('p1', 'caption', 'HTTP 403');
        t(s2.log.hides >= 1, 'no storage: "Sending..." is taken down on failure');
    }
    // 5. A native approval committed, but its source card is awaiting repair.
    // Match the exact queued status and sign-off values; a sibling's success
    // cannot make a refused whole-post approval sound saved.
    {
        const s = sandbox();
        s.api._calCrqBegin('approve', 'p1', 'caption', approveData);
        Object.assign(s.post, approveData.edits, {
            _writeUiRetrySourceAt: '2026-09-26T12:00:00Z',
            _writeUiRetryEdits: { ...approveData.edits },
            _saveError: 'HTTP 403'
        });
        t(s.api._calCrqFailed('p1', 'caption', 'HTTP 403') === false, 'committed approval: refused source save is final for the send queue');
        t(s.log.notes[0] === 'Approval saved; card still syncing | Your approval was saved. The card will retry syncing automatically. If the warning remains, tell your account manager.',
            'committed approval: the notice describes the saved approval and pending card sync');
        t(s.api._crqMine().length === 0 && s.post._writeUiRetrySourceAt && s.post.caption_status === 'Approved',
            'committed approval: the queue is dropped while the card repair stays armed');
    }
    {
        const storage = memStorage();
        const s = sandbox({ storage });
        s.api._calCrqBegin('approve', 'p1', 'caption', approveData);
        Object.assign(s.post, approveData.edits, {
            _writeUiRetrySourceAt: '2026-09-26T12:00:00Z',
            _writeUiRetryEdits: { ...approveData.edits }
        });
        s.api._calCrqFailed('p1', 'caption', 'Failed to fetch');
        const all = JSON.parse(storage.getItem('sv-client-review-queue-v1'));
        Object.values(all).forEach(e => { e.at = Date.now() - 31 * 60 * 1000; });
        storage.setItem('sv-client-review-queue-v1', JSON.stringify(all));
        await s.api._calCrqResend();
        t(s.log.notes[0].startsWith('Approval saved; card still syncing') && s.post.caption_status === 'Approved',
            'aged queue entry: a committed approval remains visible with the honest notice');
        t(s.api._crqMine().length === 0 && s.log.fetches === 0,
            'aged queue entry: the source repair owns syncing without another send');
    }
    {
        const s = sandbox();
        s.api._calCrqBegin('approve', 'p1', 'caption', approveData);
        s.api._calCrqFailed('p1', 'caption', 'HTTP 403');
        t(/Your approval was not saved.*nothing was saved/.test(s.log.notes[0]),
            'pre-commit refusal: the unsaved notice remains');
    }
    {
        const allEdits = {
            status: 'Approved', video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved',
            client_video_approved_at: 'v', client_graphic_approved_at: 'g', client_caption_approved_at: 'c'
        };
        const s = sandbox();
        s.api._calCrqBegin('approve', 'p1', 'all', { edits: allEdits });
        Object.assign(s.post, allEdits, {
            _writeUiRetrySourceAt: '2026-09-26T12:00:00Z',
            _writeUiRetryEdits: { ...allEdits }
        });
        delete s.post._writeUiRetryEdits.graphic_status;
        delete s.post._writeUiRetryEdits.client_graphic_approved_at;
        s.api._calCrqFailed('p1', 'all', 'HTTP 403');
        t(/Your approval was not saved/.test(s.log.notes[0]) && !/card still syncing/.test(s.log.notes[0]),
            'mixed whole-post refusal: a committed sibling cannot certify the refused component');
        const complete = sandbox();
        complete.api._calCrqBegin('approve', 'p1', 'all', { edits: allEdits });
        Object.assign(complete.post, allEdits, {
            _writeUiRetrySourceAt: '2026-09-26T12:00:00Z',
            _writeUiRetryEdits: { ...allEdits }
        });
        complete.api._calCrqFailed('p1', 'all', 'HTTP 403');
        t(/Approval saved; card still syncing/.test(complete.log.notes[0]),
            'complete whole-post approval: every status and sign-off is covered');
    }
    {
        const s = sandbox();
        s.api._calCrqBegin('request', 'p1', 'caption', { body: 'x', actionId: 'a1' });
        s.post._writeUiRetrySourceAt = '2026-09-26T12:00:00Z';
        s.post._writeUiRetryEdits = { ...approveData.edits };
        s.api._calCrqFailed('p1', 'caption', 'HTTP 403');
        t(/Your change request was not saved/.test(s.log.notes[0]),
            'request-change refusal keeps its existing copy');
    }
    if (failed) { console.error('client-review-queue-behavior: ' + failed + ' check(s) failed'); process.exit(1); }
    console.log('client-review-queue-behavior: all checks passed');
})();
