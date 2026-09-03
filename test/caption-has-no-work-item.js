'use strict';
/*
 * A COMPONENT WITH NO WORK ITEM MUST NEVER BE AIMED AT ANOTHER ONE'S.
 *
 * `video` and `graphic` each own a row in `deliverables`. `caption` and `title`
 * do not, and never have -- their notes live in the card row (`caption_tweaks`
 * / `title_tweaks`) and `_calLinearUrlFor` returns '' for both on purpose.
 *
 * But every comment path collapses its component with
 * `comp === 'graphic' ? 'graphic' : 'video'`, and `_writeUiNativeId` used the
 * same ternary, so a caption note was aimed at the VIDEO deliverable. While
 * video was Linear-authoritative nothing showed: `_writeUiClassifyTargetless`
 * answered `{skipped:true}` and the note saved. The video flip on 2026-08-28
 * turned the identical call into a 409 `native_link_required`:
 *
 *   - card with NO video deliverable (a carousel) -> "Request change" and
 *     "Approve after tweaks" on the caption threw, the row save was abandoned,
 *     and the reviewer got the raw code as a banner. Reported 2026-09-03.
 *   - card WITH one -> the caption note was accepted into the VIDEO
 *     deliverable's canonical thread, filed as a video comment.
 *
 * OPEN_REPAIRS 127. Both halves are pinned here, and every assertion is made
 * against the REAL functions extracted from index.html and executed -- with a
 * MUTANT RUN at the end proving that removing the guard turns this suite red.
 * A source-regex check could not tell these two behaviours apart.
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

/* extractFunction anchors on `function NAME(`, so it drops a leading `async`.
   Restoring it from the file matters here: without it the awaits inside change
   meaning and the whole harness would be measuring a different function. */
function loadFn(ctx, name) {
    const src = new RegExp('async\\s+function\\s+' + name + '\\s*\\(').test(INDEX)
        ? 'async ' + extractFunction(INDEX, name)
        : extractFunction(INDEX, name);
    vm.runInContext(src, ctx);
}

const SOURCE_ONLY_DECL = /const\s+WRITE_UI_SOURCE_ONLY_COMPONENTS\s*=\s*\[[^\]]*\];/.exec(INDEX);

/* `mutate` replaces the guard predicate with one that always answers "this has
   a work item" -- i.e. the code exactly as it stood before the repair. */
function context(authority, mutate) {
    const calls = { gateway: [], legacy: [] };
    const ctx = {
        console, calls,
        _isClientLink: false,
        CAL_SUPABASE_URL: 'https://example.invalid',
        CAL_SUPABASE_ANON_KEY: 'publishable-key-stand-in',
        async _writeUiRefreshAuthority() { return authority; },
        _writeUiAuthoritySnapshot() { return authority; },
        async _writeUiUseGatewayWhenReady() { return true; },
        async _prodClientCommentGatewayContext() { return null; },
        _writeUiSourceClientSlug() { return 'aclient'; },
        _writeUiBuildSourceRepair() { return null; },
        _writeUiIntentId(a, b, parts) { return [a, b].concat(parts || []).join(':'); },
        async _writeUiGatewayWithRepair(intent) { calls.gateway.push(intent); return { native_committed: true }; },
        _calLegacyPostLinearComment(url, body) { calls.legacy.push({ url, body }); },
        _calCurrentAuthor() { return 'Kasper'; },
        // The client-scope lookup the pre-flip path performs: an ordinary
        // active, non-test client.
        fetch: async () => ({ ok: true, status: 200, json: async () => ([{ slug: 'aclient', kind: 'client', active: true }]) }),
    };
    vm.createContext(ctx);
    if (SOURCE_ONLY_DECL) vm.runInContext(SOURCE_ONLY_DECL[0], ctx);
    for (const name of ['_writeUiComponentHasWorkItem', '_writeUiGatewayError', '_writeUiTeam',
                        '_writeUiNativeId', '_calLinearUrlFor', '_writeUiClassifyTargetless',
                        '_calPostLinearComment']) {
        loadFn(ctx, name);
    }
    if (mutate) vm.runInContext('_writeUiComponentHasWorkItem = function () { return true; };', ctx);
    return ctx;
}

async function note(ctx, card, component) {
    const post = Object.assign({ id: 'card-1' }, card);
    const url = vm.runInContext('_calLinearUrlFor', ctx)(post, component);
    try {
        const ack = await vm.runInContext('_calPostLinearComment', ctx)(url, 'a note', 'Kasper', {
            post, component, comment: { id: 'c1' }, audience: 'internal', isTweak: true, round: 1
        });
        return { ok: true, ack };
    } catch (error) {
        return { ok: false, code: error && error.code };
    }
}

const FLIPPED = { video: 'syncview', graphics: 'syncview' };
/* The reported card: a carousel. A thumbnail, no video at all. */
const CAROUSEL = { graphic_deliverable_id: 'del-graphic', graphic_linear_issue_id: 'https://linear.app/x/GRA-1' };
const WITH_VIDEO = Object.assign({ video_deliverable_id: 'del-video', linear_issue_id: 'https://linear.app/x/VID-1' }, CAROUSEL);

(async () => {
    /* ---- the predicate itself --------------------------------------------- */
    {
        const has = vm.runInContext('_writeUiComponentHasWorkItem', context(FLIPPED));
        ok(has('video') && has('graphic'), 'video and graphic own a work item');
        ok(!has('caption') && !has('title'), 'caption and title do not');
        ok(!has('CAPTION') && !has(' Caption '), 'and the answer does not depend on casing or padding');
        ok(has('') && has(undefined) && has('somethingnew'),
            'an unknown or absent component keeps the historic default of video — this rule can only ever '
            + 'make caption and title source-only, never a real work item');
    }

    /* ---- a caption is not "linked to" the video deliverable ---------------- */
    {
        const ctx = context(FLIPPED);
        const nativeId = vm.runInContext('_writeUiNativeId', ctx);
        ok(nativeId(WITH_VIDEO, 'video') === 'del-video' && nativeId(WITH_VIDEO, 'graphic') === 'del-graphic',
            'the deliverable id of a real component is unchanged');
        ok(nativeId(WITH_VIDEO, 'caption') === '' && nativeId(WITH_VIDEO, 'title') === '',
            'a caption or title answers NO deliverable id even on a card whose video component has one');
    }

    /* ---- the reported defect, both halves ---------------------------------- */
    {
        const ctx = context(FLIPPED);
        const carousel = await note(ctx, CAROUSEL, 'caption');
        ok(carousel.ok && carousel.ack && carousel.ack.source_only === true,
            'a caption note on a card with no video deliverable is accepted as source-only, not refused'
                + (carousel.ok ? '' : ' (got ' + carousel.code + ')'));
        const title = await note(ctx, CAROUSEL, 'title');
        ok(title.ok && title.ack && title.ack.source_only === true, 'and so is a title note');
        ok(ctx.calls.gateway.length === 0 && ctx.calls.legacy.length === 0,
            'neither one is sent anywhere — there is no work item to deliver to, and the card row is the home');
    }
    {
        const ctx = context(FLIPPED);
        const mixed = await note(ctx, WITH_VIDEO, 'caption');
        ok(mixed.ok && mixed.ack && mixed.ack.source_only === true,
            'on a card that HAS a video deliverable the caption note is source-only too');
        ok(ctx.calls.gateway.length === 0,
            'and is NOT filed against the video deliverable — the second half of the defect, which looked '
            + 'like success and put caption feedback in the video thread');
    }

    /* ---- what must NOT change ---------------------------------------------- */
    {
        const ctx = context(FLIPPED);
        const graphic = await note(ctx, CAROUSEL, 'graphic');
        ok(graphic.ok, 'the thumbnail pane on the same card still commits');
        ok(ctx.calls.gateway.length === 1
            && ctx.calls.gateway[0].team === 'graphics'
            && ctx.calls.gateway[0].nativeId === 'del-graphic',
            'through the gateway, on its own team and its own deliverable');
    }
    {
        const ctx = context(FLIPPED);
        const unlinkedVideo = await note(ctx, { video_deliverable_id: '', linear_issue_id: '' }, 'video');
        ok(!unlinkedVideo.ok && unlinkedVideo.code === 'native_link_required',
            'a VIDEO note on a card with no video work item is still refused native_link_required — the '
            + 'documented fail-closed refusal (OPEN_REPAIRS 87.14) is untouched');
    }

    /* ---- the mutant: prove the assertions are load-bearing ------------------ */
    {
        const ctx = context(FLIPPED, true);
        const carousel = await note(ctx, CAROUSEL, 'caption');
        ok(!carousel.ok && carousel.code === 'native_link_required',
            'MUTANT (guard removed): the caption note on the carousel refuses again — so the assertions '
            + 'above are measuring the repair and not the weather');
        const mixedCtx = context(FLIPPED, true);
        const mixed = await note(mixedCtx, WITH_VIDEO, 'caption');
        ok(mixed.ok && mixedCtx.calls.gateway.length === 1
            && mixedCtx.calls.gateway[0].nativeId === 'del-video'
            && mixedCtx.calls.gateway[0].comment.component === 'video',
            'MUTANT: and the caption note on a video-linked card goes to the VIDEO deliverable as a video '
            + 'comment, which is exactly the mis-filing the repair removes');
    }

    /* ---- every collapse site carries the rule, not just the reported one --- */
    {
        const COLLAPSE = /=== 'graphic' \? 'graphic' : 'video'/;
        const sites = ['_calPostLinearComment', '_sxrPostLinearComment',
                       '_calPushStatusToLinear', '_sxrPushStatusToLinear'];
        const collapsing = sites.filter(name => COLLAPSE.test(extractFunction(INDEX, name)));
        ok(collapsing.length === sites.length,
            'all four writers still collapse their component onto video — the shape this rule exists for');
        const unguarded = collapsing.filter(name =>
            !/_writeUiComponentHasWorkItem\(/.test(extractFunction(INDEX, name)));
        ok(unguarded.length === 0,
            'and every one of them asks first whether the component owns a work item'
                + (unguarded.length ? ' — missing in: ' + unguarded.join(', ') : '')
                + '. One rule on both surfaces and both operations: items 87.8 and 87.16 are what it '
                + 'costs when a rule lives on one of two identical sites.');
    }

    /* ---- and the banner is a sentence, not a code -------------------------- */
    {
        const ctx = vm.createContext({ console });
        for (const name of ['WRITE_UI_FAILURE_CODE_TEXT', 'WRITE_UI_FAILURE_CLASS_TEXT', 'WRITE_UI_FAILURE_CODE_CLASS']) {
            const decl = new RegExp('const ' + name + ' = \\{[\\s\\S]*?\\n    \\};').exec(INDEX);
            if (decl) vm.runInContext(decl[0], ctx);
        }
        loadFn(ctx, '_writeUiFailureText');
        loadFn(ctx, '_writeUiFailureSentence');
        const text = vm.runInContext('_writeUiFailureSentence', ctx);
        const refusal = Object.assign(new Error('native_link_required'), { code: 'native_link_required', status: 409 });
        ok(text(refusal) !== 'native_link_required' && /work item/.test(text(refusal)),
            'a gateway refusal reaches the reviewer as the sentence from WRITE_UI_FAILURE_CODE_TEXT, not as '
            + 'its own code — which is what the caption banner showed on 2026-09-03');
        ok(text(new Error('Save failed: the network went away')) === 'Save failed: the network went away',
            'while a transport error, which carries a real sentence and no code, is passed through');
        /* And a gateway error whose message was DELIBERATELY overwritten with a
           sentence keeps that sentence: _writeUiLegacyDeliveryUnconfirmedError
           does exactly this, because its sentence says more than the table
           entry for its code. Only a message that IS the code gets replaced. */
        const authored = Object.assign(new Error('Team delivery could not be confirmed. Your draft is preserved; retry.'),
            { code: 'legacy_tweak_delivery_unconfirmed', status: 409 });
        ok(text(authored) === 'Team delivery could not be confirmed. Your draft is preserved; retry.',
            'and a code-carrying error whose message was authored on purpose keeps its own sentence');
        ok(text(null) === 'Save failed', 'and nothing at all still says something');
        ok(text(null, 'save failed') === 'save failed', 'with the caller\'s own fallback when it has one');
    }

    /* ---- and no inline banner is left painting a raw code ------------------ */
    {
        /* The reported symptom was a code in a red box, and Kasper's panel was
           only one of the places that did it. Every INLINE catch that paints a
           failure must read the message table; the ones that did not were both
           review panes and both card save chips. Pinned by shape rather than by
           count, so a NEW catch of the same shape fails this too. */
        const RAW = [
            /_saveError\s*=\s*(?:e|error)\s*(?:&&\s*(?:e|error)\.message\s*)?(?:\?\s*)?(?:\|\|\s*)?(?:e|error)?\.?message/,
            /errors\[[^\]]+\]\s*=\s*\((?:e|error)\s*&&\s*(?:e|error)\.message\)/,
            /_errors\[[^\]]+\]\s*=\s*(?:e|error)\s*&&\s*(?:e|error)\.message/,
        ];
        const offenders = RAW.map(re => (INDEX.match(re) || [])[0]).filter(Boolean);
        ok(offenders.length === 0,
            'no inline failure banner assigns a raw error message any more'
                + (offenders.length ? ' — found: ' + offenders.join(' | ') : ''));
        // And prove the pattern can still catch one, on a fixture.
        ok(RAW.some(re => re.test("item._errors[comp] = e && e.message ? e.message : 'Save failed';")),
            'and the pattern still catches the shape it was written for — proven on a fixture, not assumed');
        const sentence = /_writeUiFailureSentence\(/g;
        const uses = (INDEX.match(sentence) || []).length;
        ok(uses >= 10,
            'the shared sentence helper is read by its definition plus all nine inline sites (' + uses + ' references)');
    }

    if (failures) {
        console.error('\nCaption work-item checks FAILED');
        console.error('caption and title own no deliverable; a note on one must never be aimed at the video row.');
        process.exit(1);
    }
    console.log('\nCaption work-item checks passed');
})();
