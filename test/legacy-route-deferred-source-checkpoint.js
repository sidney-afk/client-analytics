'use strict';
/*
 * A LEGACY-ROUTE REVIEW COMMENT MUST STILL GET ITS DURABLE SOURCE CHECKPOINT.
 *
 * `_calReviewRequestTweak` (190) and `_sxrReviewRequestTweak` (280) call the
 * comment writer with `deferLegacyUntilSourceSave: true` and then branch on
 * `deferred_until_source_save` coming back. That flag is the ONLY thing that
 * makes them run `_writeUiQueueDeferredLegacyTweak`, which writes the durable
 * source-gate ledger row before the card upsert.
 *
 * The row is what makes a lost upsert RESPONSE survivable. The upsert can
 * COMMIT server-side and still fail to answer -- a dropped connection, a
 * timeout, a closed laptop. Without the row the reviewer's comment is rolled
 * back off their screen and their retry mints a SECOND comment id against the
 * change that already committed: the note appears twice, in the thread and in
 * the history. Codex caught that on PR #1245; the fix was to carry the flag
 * out of every source-only exit, and the comment above the caption exit in
 * `_calPostLinearComment` records it.
 *
 * OPEN_REPAIRS 239 retired the legacy Linear transports. Its first revision
 * returned a bare `{ skipped, legacy_transport_retired }` from the legacy
 * branches, with no `deferred_until_source_save` even when the caller asked
 * for one. Samples happened to survive it (its Kasper path reads the new flag
 * directly); Calendar did not -- `190-calendar-approval-comments.js.part` has
 * no reference to it, so a legacy-route card stopped staging the row and PR
 * #1245's defect came back on the ~213 live client-facing slots OPEN_REPAIRS
 * 237 measured.
 *
 * Why `caption-has-no-work-item.js` did not catch it: that suite pins the same
 * checkpoint, but only on the CAPTION exit -- the `!_writeUiComponentHasWorkItem`
 * branch, which 239 never touched. It never drives a video or graphic
 * component down the legacy route, so the exit that broke was outside it.
 * This suite drives that exit, on both surfaces, against the REAL extracted
 * functions.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { extractFunction } = require('./helpers/extract-function.js');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(cond, msg) {
    console.log((cond ? '  ok  ' : 'FAIL  ') + msg);
    if (!cond) failures++;
}

/* extractFunction anchors on `function NAME(` and drops a leading `async`;
   restoring it matters, or the awaits inside change meaning. Same helper the
   caption suite uses, for the same reason. */
function loadFn(ctx, name) {
    const src = new RegExp('async\\s+function\\s+' + name + '\\s*\\(').test(INDEX)
        ? 'async ' + extractFunction(INDEX, name)
        : extractFunction(INDEX, name);
    vm.runInContext(src, ctx);
}

/* A card on the live legacy route: it carries a Linear URL and NO deliverable
   id, which is exactly the population OPEN_REPAIRS 237 measured. */
const LEGACY_CARD = {
    id: 'card-legacy-1',
    linear_issue_id: 'https://linear.app/x/issue/VID-1',
    video_status: 'Tweaks Needed',
    status: 'Tweaks Needed',
    video_comments: [],
};

function writerContext(surface) {
    const calls = { gateway: [], legacy: [] };
    const ctx = {
        console, calls,
        _isClientLink: false,
        async _writeUiRefreshAuthority() { return { video: 'syncview', graphics: 'syncview' }; },
        _writeUiAuthoritySnapshot() { return { video: 'syncview', graphics: 'syncview' }; },
        /* THE LEGACY ROUTE: this client is not enrolled, so the writer takes
           the branch OPEN_REPAIRS 239 retired. */
        async _writeUiUseGatewayWhenReady() { return false; },
        async _prodClientCommentGatewayContext() { return null; },
        _prodCanonicalCommentGate() { return { linked: false, ready: false, client: false }; },
        _prodVerifiedClientCommentMutationContext() { return null; },
        _writeUiSourceClientSlug() { return 'aclient'; },
        _writeUiBuildSourceRepair() { return null; },
        _writeUiIntentId(a, b, parts) { return [a, b].concat(parts || []).join(':'); },
        async _writeUiGatewayWithRepair(intent) { calls.gateway.push(intent); return { native_committed: true }; },
        async _writeUiClassifyTargetless() { return { skipped: true }; },
        _calCurrentAuthor() { return 'Client'; },
        _sxrCurrentAuthor() { return 'Client'; },
        Date, Promise, Object, String, Number, JSON,
    };
    vm.createContext(ctx);
    for (const name of ['_writeUiComponentHasWorkItem', '_writeUiGatewayError', '_writeUiTeam',
                        '_writeUiNativeId', '_calLinearUrlFor', '_sxrLinearUrlFor',
                        surface === 'sxr' ? '_sxrPostLinearComment' : '_calPostLinearComment',
                        surface === 'sxr' ? '_sxrPushStatusToLinear' : '_calPushStatusToLinear']) {
        loadFn(ctx, name);
    }
    return ctx;
}

(async () => {
    /* ---- 1. the checkpoint the review lane reads back ---------------------- */
    for (const [surface, commentFn, statusFn, urlFn] of [
        ['calendar', '_calPostLinearComment', '_calPushStatusToLinear', '_calLinearUrlFor'],
        ['sxr', '_sxrPostLinearComment', '_sxrPushStatusToLinear', '_sxrLinearUrlFor'],
    ]) {
        const ctx = writerContext(surface);
        const post = Object.assign({}, LEGACY_CARD);
        const url = vm.runInContext(urlFn, ctx)(post, 'video');
        ok(String(url || '').trim() !== '',
            `${surface}: the fixture really is a linked card, so this is the legacy route and not the targetless exit`);

        const deferred = await vm.runInContext(commentFn, ctx)(url, 'Please revise', 'Client', {
            post, component: 'video', comment: { id: 'c1' }, audience: 'client', isTweak: true, round: 1,
            deferLegacyUntilSourceSave: true,
        });
        ok(deferred && deferred.deferred_until_source_save === true,
            `${surface}: a legacy-route comment whose caller asked to defer reports the checkpoint, so the `
            + 'review lane still stages its durable source-gate row');
        ok(deferred && deferred.source_only === true,
            `${surface}: and reports source_only, the same shape every other source-only exit returns, so no `
            + 'caller has to learn a transport-specific flag');
        ok(deferred && deferred.legacy_transport_retired === true,
            `${surface}: while still recording that the retired lane is why`);

        const plain = await vm.runInContext(commentFn, ctx)(url, 'Please revise', 'Client', {
            post, component: 'video', comment: { id: 'c2' }, audience: 'client', isTweak: true, round: 1,
        });
        ok(plain && plain.deferred_until_source_save === undefined,
            `${surface}: a caller that did NOT ask to defer is not given a checkpoint it never requested`);

        const deferredStatus = await vm.runInContext(statusFn, ctx)(url, 'Tweaks Needed', {
            post, component: 'video', deferLegacyUntilSourceSave: true,
        });
        ok(deferredStatus && deferredStatus.deferred_until_source_save === true,
            `${surface}: the status writer answers the same way, so a deferring status caller keeps its checkpoint too`);

        ok(calls_of(ctx).gateway.length === 0 && calls_of(ctx).legacy.length === 0,
            `${surface}: and none of it reaches the gateway or any legacy transport`);
    }

    /* ---- 2. what the checkpoint buys: a lost upsert RESPONSE --------------- */
    /* The staging + decision machinery, executed. The scenario is the PR #1245
       one: the card upsert COMMITS server-side and its response is lost, so the
       reviewer retries the same action. The ledger row staged before the upsert
       is what lets the retry recognise its own committed work instead of
       minting a second comment id. */
    {
        const staged = [];
        let committedRows = [];
        const stageCtx = {
            console,
            _calLinearUrlFor: post => post.linear_issue_id || '',
            _sxrLinearUrlFor: () => '',
            async _calPrimeUpsertRoutingFlag() {},
            async _sxrPrimeSampleRoutingFlag() {},
            _calUpsertUseEf: () => true,
            _sxrSampleUseEf: () => false,
            _writeUiSourceClientSlug: () => 'aclient',
            _writeUiPrincipalKey: () => 'client:aclient',
            _calCurrentAuthor: () => 'Client',
            _sxrCurrentAuthor: () => 'Client',
            _calCommentsFor: post => post.video_comments || [],
            _sxrCommentsFor: post => post.video_comments || [],
            _calNormStatus: value => String(value || '').toLowerCase(),
            _sxrNormStatus: value => String(value || '').toLowerCase(),
            _writeUiLegacyOutboxItems: () => JSON.parse(JSON.stringify(staged)),
            _writeUiLegacyCommittedTweakRead: () => JSON.parse(JSON.stringify(committedRows)),
            _writeUiLegacyOutboxWrite: (_surface, items) => {
                staged.length = 0;
                for (const item of JSON.parse(JSON.stringify(items))) staged.push(item);
                return true;
            },
            _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
            navigator: {
                locks: { request: async (_name, _options, callback) => callback({ mode: 'exclusive' }) },
            },
            Date, JSON, Object, String, Array, Error, Promise, Map, Set,
        };
        vm.createContext(stageCtx);
        for (const name of ['_writeUiLegacyApprovalClears', '_writeUiLegacyApprovalClearsFromEdits',
                            '_writeUiLegacyApprovalClearsValid', '_writeUiLegacyApprovalClearsForReconcile',
                            '_writeUiLegacyItemSignature', '_writeUiLegacyItemMatches', '_writeUiLegacyTweakKey',
                            '_writeUiLegacyGateTargetIdentity', '_writeUiLegacySourceCommentReflected',
                            '_writeUiLegacyGateStatusMatches', '_writeUiLegacyGateReflected',
                            '_writeUiLegacyGateSignature', '_writeUiLegacyTargetPair',
                            '_writeUiLegacySupersededSourceItem', '_writeUiLegacySupersededTeamItem',
                            '_writeUiLegacyTeamDeliveryReceiptItem',
                            '_writeUiLegacyRecordedTeamDeliveryReceiptItem',
                            '_writeUiLegacyStoredTeamTerminalItem', '_writeUiLegacyTargetDecision',
                            '_writeUiLegacyTeamRearmValid', '_writeUiLegacyDrainWithLock',
                            '_writeUiLegacyOutboxWithLock', '_writeUiLegacyTargetLedgerWithLock',
                            '_writeUiLegacyInspectTargetTweak', '_writeUiBuildDeferredLegacyTweakRecords',
                            '_writeUiQueueDeferredLegacyTweak']) {
            loadFn(stageCtx, name);
        }

        const post = {
            id: 'card-legacy-1',
            linear_issue_id: 'https://linear.app/x/issue/VID-1',
            video_status: 'Tweaks Needed',
            video_comments: [],
        };
        const comment = { id: 'client-action-1', role: 'client', audience: 'client', is_tweak: true };
        const edits = { video_status: 'Tweaks Needed', status: 'Tweaks Needed' };

        /* The caller's own branch, reproduced exactly: `_calReviewRequestTweak`
           asks the writer to defer, and stages ONLY if the acknowledgement
           says the checkpoint was granted. Routing the staging through the
           real acknowledgement is what makes this half a regression detector
           rather than a description -- calling the staging function directly
           would stage even on a head whose writer drops the flag. */
        const writerCtx = writerContext('calendar');
        const ack = await vm.runInContext('_calPostLinearComment', writerCtx)(
            post.linear_issue_id, 'Please revise', 'Client',
            { post, component: 'video', comment, audience: 'client', isTweak: true, round: 1,
              deferLegacyUntilSourceSave: true }
        );
        const first = ack && ack.deferred_until_source_save
            ? await vm.runInContext('_writeUiQueueDeferredLegacyTweak', stageCtx)(
                'calendar', post, 'video', comment, 'Please revise', 'Client', edits, { state: 'new' }
            )
            : { state: 'not-staged', ids: [] };
        ok(first.state === 'staged' && (first.ids || []).length === 1,
            'the legacy-route request-change stages exactly one durable row before its card upsert');
        ok(staged.length === 1 && staged[0].transport === 'source_only' && staged[0].kind === 'source_only',
            'and that row is a SOURCE gate, never a legacy_n8n record, so nothing is sent or retried');
        ok(!staged.some(item => item.transport === 'legacy_n8n'),
            'no staged record carries the retired transport');

        /* THE LOST RESPONSE. The upsert committed; the browser never heard.
           The reviewer clicks the same action again with the same comment id. */
        const retry = await vm.runInContext('_writeUiLegacyInspectTargetTweak', stageCtx)(
            'calendar', 'aclient', post.id, 'video', post, 'Please revise', comment.id
        );
        ok(retry.state === 'active',
            'the retry after a lost upsert response recognises its own in-flight action instead of starting a new one');
        ok(retry.comment_id === comment.id,
            'and it reuses the EXACT comment id, so the committed note cannot be duplicated in the thread');
        ok(retry.state !== 'new',
            'it is NOT treated as a fresh action -- a `new` verdict here is the PR #1245 defect: the reviewer\'s '
            + 'committed note is rolled back off their screen and the retry mints a second comment id');

        const second = await vm.runInContext('_writeUiQueueDeferredLegacyTweak', stageCtx)(
            'calendar', post, 'video', comment, 'Please revise', 'Client', edits,
            { state: retry.state, pair: retry.pair, rearmed_team_delivery: retry.rearmed_team_delivery }
        );
        ok(second.state === 'active' && JSON.stringify(second.ids) === JSON.stringify(first.ids),
            'restaging the retry reuses the same row and the same id rather than minting a second one');
        ok(staged.length === 1,
            'and leaves exactly one row, so the reviewer sees one note and the history records one');
    }

    if (failures) {
        console.error(`\n${failures} legacy-route deferred source checkpoint check(s) failed`);
        process.exit(1);
    }
    console.log('\nlegacy-route deferred source checkpoint checks passed');
})().catch(error => {
    console.error('FAIL  harness crashed: ' + (error && error.stack || error));
    process.exit(1);
});

function calls_of(ctx) {
    return vm.runInContext('calls', ctx);
}
