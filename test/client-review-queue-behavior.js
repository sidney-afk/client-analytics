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
const src = fs.readFileSync(path.join(root, 'src/index/185-client-review-queue.js.part'), 'utf8');
const c190 = fs.readFileSync(path.join(root, 'src/index/190-calendar-approval-comments.js.part'), 'utf8');

let failed = 0;
const t = (ok, msg) => { console.log((ok ? '  ok  ' : '  ❌  ') + msg); if (!ok) failed++; };

function memStorage() {
    const m = {};
    return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } };
}
function sandbox(opts) {
    const o = Object.assign({ storage: memStorage(), serverRow: null, fetchFails: false, flushError: '' }, opts || {});
    const log = { toasts: [], hides: 0, notes: [], flushes: 0, fetches: 0, tweaks: 0 };
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
        _calReviewRequestTweak: (pid, comp) => { log.tweaks++; if (o.tweakStarts) env._calReviewState.saving[pid + '|' + comp] = true; },
        CAL_SUPABASE_URL: 'https://example.invalid', CAL_SUPABASE_ANON_KEY: 'k',
        fetch: async () => {
            log.fetches++;
            if (o.fetchFails) throw new TypeError('Failed to fetch');
            return { ok: true, json: async () => (o.serverRow ? [o.serverRow] : []) };
        },
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
    if (failed) { console.error('client-review-queue-behavior: ' + failed + ' check(s) failed'); process.exit(1); }
    console.log('client-review-queue-behavior: all checks passed');
})();
