'use strict';
/*
 * URGENT ping for a card parked at KASPER APPROVAL — and the "Urgent" section
 * it feeds at the top of Kasper's review tab.
 *
 * Run:  node test/kasper-approval-urgent-ping.js   (exit 0 = all good)
 *
 * CONTEXT. The URGENT ping only ever covered ONE direction: a video at Tweaks
 * Needed, pinging the editor in #video-editing. A card waiting on Kasper had no
 * equivalent — the SMM could only chase him by hand, and nothing on his own
 * screen said which of the cards in his queue could not wait.
 *
 * SHAPE. The second flavour is deliberately the SAME machine, not a parallel
 * one: same button, same confirm -> POST -> latch dispatch, same four-column
 * marker, same "the marker dies with its round" rule. URGENT_PING_KINDS holds
 * the only two things that differ (destination + copy), and ONE predicate,
 * _calKasperUrgentActive, decides both the button's Sent latch and membership
 * of the Urgent section — so the two can never disagree about a ping.
 *
 * WHAT WOULD BREAK WITHOUT THESE CHECKS
 *  · a ping fired from the caption pill posting to #video-editing;
 *  · a spent ping (Kasper decided, or the card left Kasper Approval) leaving
 *    the card stuck in Urgent forever;
 *  · Urgent rendering BELOW "Waiting for your review", which is the whole point;
 *  · the queue-count pills silently shrinking when a card is pinged, because
 *    Urgent is carved out of waiting.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}
function grabConst(name) {
  const m = INDEX.match(new RegExp('^\\s*const ' + name + '\\s*=.*;\\s*$', 'm'));
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}
function grabBlockConst(name) {
  const at = INDEX.indexOf('const ' + name + ' = {');
  if (at < 0) throw new Error('const not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1) + ';'; }
  }
  throw new Error('unbalanced braces: ' + name);
}

let failures = 0;
function check(label, cond) {
  if (!cond) failures++;
  console.log(`${cond ? 'OK  ' : 'FAIL'}  ${label}`);
}

/* ── the real predicates, lifted out of index.html ───────────────────────── */
const PRED = [
  grabConst('CAL_STATUSES'),
  grabConst('CAL_REVIEW_COMPONENTS'),
  grabBlockConst('URGENT_PING_KINDS'),
  grabFunc('_urgentKind'),
  grabFunc('_calNormStatus'),
  grabFunc('_calEsc'),
  grabFunc('_calEscAttr'),
  grabFunc('_calCompLinked'),
  grabFunc('_calShowUrgent'),
  grabFunc('_kasperCompReviewable'),
  grabFunc('_kasperUrgentPingOn'),
  grabFunc('_calShowKasperUrgent'),
  grabFunc('_calKasperUrgentComp'),
  grabFunc('_calKasperUrgentActive'),
  grabFunc('_calKasperUrgentPingComp'),
  grabFunc('_calUrgentSameRound'),
  grabFunc('_calUrgentSentForCurrentRound'),
  grabFunc('_calUrgentButtonHtml'),
  grabFunc('_calBuildKasperUrgentPatch'),
  grabFunc('_calKasperReviewUrl'),
].join('\n\n');

const P = new Function('URGENT_SLACK_URL', 'URGENT_KASPER_SLACK_URL', '_calUrgentActorName', '_kasperUrgentFlagValue', 'calState', 'sxrState',
  PRED + ';return { _calShowUrgent, _calShowKasperUrgent, _calKasperUrgentActive, _calKasperUrgentComp,'
       + ' _calKasperUrgentPingComp, _calUrgentSentForCurrentRound, _calUrgentButtonHtml,'
       + ' _calBuildKasperUrgentPatch, _calKasperReviewUrl, URGENT_PING_KINDS };'
)('http://x/send-urgent-slack', 'http://x/send-urgent-kasper-slack', () => 'SyncView',
  { clients: ['testclient'] }, { client: 'testclient' }, { client: 'testclient' });

// The same predicates with the kill-switch OFF, which is the shipped default.
const OFF = new Function('URGENT_SLACK_URL', 'URGENT_KASPER_SLACK_URL', '_calUrgentActorName', '_kasperUrgentFlagValue', 'calState', 'sxrState',
  PRED + ';return { _calShowKasperUrgent };'
)('http://x/send-urgent-slack', 'http://x/send-urgent-kasper-slack', () => 'SyncView',
  null, { client: 'testclient' }, { client: 'testclient' });

// A roster that does NOT name this client is just as closed as no roster at all.
const OTHER = new Function('URGENT_SLACK_URL', 'URGENT_KASPER_SLACK_URL', '_calUrgentActorName', '_kasperUrgentFlagValue', 'calState', 'sxrState',
  PRED + ';return { _calShowKasperUrgent };'
)('http://x/send-urgent-slack', 'http://x/send-urgent-kasper-slack', () => 'SyncView',
  { clients: ['someoneelse'] }, { client: 'testclient' }, { client: 'testclient' });

const R1 = '2026-09-09T12:00:00.000Z';
const R2 = '2026-09-09T13:00:00.000Z';
function card(extra) {
  return Object.assign({
    id: 'p1', name: 'Video 1',
    // Content matters now: the affordance asks _kasperCompReviewable, the same
    // predicate that decides whether Kasper's queue keeps the card at all.
    asset_url: 'https://drive.example/v1.mp4',
    thumbnail_url: 'https://drive.example/t1.jpg',
    caption: 'a caption',
    video_status: 'Kasper Approval', video_status_at: R1,
    graphic_status: 'In Progress', caption_status: 'In Progress', title_status: 'In Progress',
    linear_issue_id: 'https://linear.app/synchro-social/issue/VID-1/v',
    graphic_linear_issue_id: 'https://linear.app/synchro-social/issue/GRA-1/g',
  }, extra || {});
}

console.log('\n-- the affordance: which pill offers the ping --');
check('a component at Kasper Approval offers it', P._calShowKasperUrgent(card(), 'video') === true);
check('a component in progress does not', P._calShowKasperUrgent(card(), 'caption') === false);
check('Tweaks Needed keeps the EDITOR ping, not this one',
  P._calShowKasperUrgent(card({ video_status: 'Tweaks Needed' }), 'video') === false
  && P._calShowUrgent(card({ video_status: 'Tweaks Needed' }), 'video') === true);
check('caption at Kasper Approval offers it (the editor ping never could)',
  P._calShowKasperUrgent(card({ caption_status: 'Kasper Approval' }), 'caption') === true);
check('title at Kasper Approval offers it',
  P._calShowKasperUrgent(card({ title_status: 'Kasper Approval' }), 'title') === true);
check('an UNLINKED thumbnail does not — he could not act on it anyway',
  P._calShowKasperUrgent(card({ graphic_status: 'Kasper Approval', graphic_linear_issue_id: '' }), 'graphic') === false);
check('a linked thumbnail does',
  P._calShowKasperUrgent(card({ graphic_status: 'Kasper Approval' }), 'graphic') === true);
check('the marker records the first waiting component, so one card = one ping',
  P._calKasperUrgentPingComp(card({ caption_status: 'Kasper Approval' })) === 'video');

// Codex P1 on PR 1370: the affordance offered a ping for cards Kasper's queue
// throws away. The DM says "it is in the Urgent section at the top", so a ping
// the queue will not honour is a lie told to the person being escalated to.
check('a video whose FILE never arrived offers no ping — the queue strands it',
  P._calShowKasperUrgent(card({ asset_url: '' }), 'video') === false);
check('an EMPTY caption at Kasper Approval offers no ping either',
  P._calShowKasperUrgent(card({ caption_status: 'Kasper Approval', caption: '', caption_alt: '' }), 'caption') === false);
check('a caption with only caption_alt still counts as content',
  P._calShowKasperUrgent(card({ caption_status: 'Kasper Approval', caption: '', caption_alt: 'alt text' }), 'caption') === true);
check('a thumbnail with no file offers no ping',
  P._calShowKasperUrgent(card({ graphic_status: 'Kasper Approval', thumbnail_url: '' }), 'graphic') === false);
// The MARKER deliberately does not repeat the content check. Section membership
// comes from _kasperState.items, which the queue has already stranded such a card
// out of, and the button is hidden by the affordance gate above — so re-asking
// here would only add a second place for the two answers to disagree.
check('the marker itself stays keyed to status, not to content',
  P._calKasperUrgentActive(card({
    asset_url: '', kasper_urgent_pinged_at: R1, kasper_urgent_status_at: R1, kasper_urgent_comp: 'video',
  })) === true);

// The kill-switch is what lets this merge before its Edge Function half exists.
// With it off the feature is inert: no button, so no click, no updated_at-only
// write, and no DM pointing at a section that cannot populate.
check('the kill-switch OFF hides the affordance entirely',
  OFF._calShowKasperUrgent(card(), 'video') === false);
// The roster is what lets a rollout start with one client instead of everybody.
const gate = (v, slug) => new Function('_kasperUrgentFlagValue',
  grabFunc('_kasperUrgentPingOn') + ';return _kasperUrgentPingOn(' + JSON.stringify(slug) + ');')(v);
check('a roster naming this client opens it', gate({ clients: ['testclient'] }, 'testclient') === true);
check('a roster NOT naming it keeps it shut',
  OTHER._calShowKasperUrgent(card(), 'video') === false
  && gate({ clients: ['someoneelse'] }, 'testclient') === false);
check('enabled:true opens it for everyone', gate({ enabled: true }, 'anyclient') === true);
check('and it fails CLOSED on every other shape',
  gate(null, 'testclient') === false
  && gate(undefined, 'testclient') === false
  && gate('yes', 'testclient') === false
  && gate({ enabled: 'true' }, 'testclient') === false
  && gate({ clients: ['testclient'] }, '') === false);

console.log('\n-- the round: a ping outlives neither his decision nor the round --');
const pinged = card({ kasper_urgent_pinged_at: R1, kasper_urgent_status_at: R1, kasper_urgent_comp: 'video' });
check('a live ping reads as urgent', P._calKasperUrgentActive(pinged) === true);
check('an un-pinged card does not', P._calKasperUrgentActive(card()) === false);
check('once he decides the component, the ping is spent',
  P._calKasperUrgentActive(Object.assign({}, pinged, { video_status: 'Approved' })) === false);
check('a NEW Kasper Approval round does not inherit the old ping',
  P._calKasperUrgentActive(Object.assign({}, pinged, { video_status_at: R2 })) === false);
check('a ping on the caption tracks the CAPTION round, not the video',
  P._calKasperUrgentActive(card({
    caption_status: 'Kasper Approval', caption_status_at: R1,
    kasper_urgent_pinged_at: R1, kasper_urgent_status_at: R1, kasper_urgent_comp: 'caption',
  })) === true);
check('an unstamped row (pre-migration) stays urgent rather than vanishing',
  P._calKasperUrgentActive({
    id: 'p2', video_status: 'Kasper Approval',
    kasper_urgent_pinged_at: R1, kasper_urgent_status_at: '', kasper_urgent_comp: 'video',
  }) === true);
check('a junk component name falls back to video rather than throwing',
  P._calKasperUrgentComp({ kasper_urgent_comp: 'nonsense' }) === 'video');

console.log('\n-- the button --');
const btn = P._calUrgentButtonHtml('p1', '_calSendKasperUrgentSlack', card(), '', false, 'kasper');
check('carries the kasper kind', btn.includes('data-urgent-kind="kasper"'));
check('wires the kasper handler', btn.includes('_calSendKasperUrgentSlack(event'));
check('says URGENT, unsent', btn.includes('>URGENT<') && btn.includes('data-urgent-sent="0"'));
check('its tooltip names Kasper, not the editor',
  btn.includes('waiting on his review') && !btn.includes('#video-editing'));
const btnSent = P._calUrgentButtonHtml('p1', '_calSendKasperUrgentSlack', pinged, '', false, 'kasper');
check('latches to Sent + disabled while the ping is live',
  btnSent.includes('>Sent<') && btnSent.includes('disabled') && btnSent.includes('is-sent'));
const btnEditor = P._calUrgentButtonHtml('p1', '_calSendUrgentSlack', card({ video_status: 'Tweaks Needed' }));
check('the editor button is untouched by all of this',
  btnEditor.includes('data-urgent-kind="editor"') && btnEditor.includes('#video-editing'));

console.log('\n-- the marker written to the row --');
const patch = P._calBuildKasperUrgentPatch(card(), 'video', { sentAt: R2, by: 'SyncView' });
check('stamps when, which component, and that component\'s round',
  patch.kasper_urgent_pinged_at === R2 && patch.kasper_urgent_comp === 'video' && patch.kasper_urgent_status_at === R1);
check('links his review tab; samples get their own subtab',
  P._calKasperReviewUrl('calendar') === 'https://syncview.synchrosocial.com/#kasper'
  && P._calKasperReviewUrl('samples') === 'https://syncview.synchrosocial.com/#kasper/samples');

console.log('\n-- the dispatch: right webhook, right copy, right payload --');
const DISPATCH = [
  grabBlockConst('URGENT_PING_KINDS'),
  grabFunc('_urgentKind'),
  grabFunc('_calUrgentSlackDispatch'),
].join('\n\n');
const sent = { fetches: [], confirms: [], notes: [] };
const D = new Function('URGENT_SLACK_URL', 'URGENT_KASPER_SLACK_URL', 'showConfirm', 'showNotify', 'fetch',
  DISPATCH + ';return _calUrgentSlackDispatch;')(
  'http://x/send-urgent-slack', 'http://x/send-urgent-kasper-slack',
  (title, bodyText, onYes, cta) => { sent.confirms.push({ title, bodyText, cta }); onYes(); },
  (t, m) => sent.notes.push({ t, m }),
  (url, opts) => { sent.fetches.push({ url, body: JSON.parse(opts.body) }); return Promise.resolve({ ok: true, json: async () => ({ ok: true }) }); },
);

const fakeBtn = { dataset: {}, disabled: false, textContent: 'URGENT', classList: { _s: new Set(), add(c) { this._s.add(c); } } };
// Fixture slug only. Real client slugs are not allowed in this repo — the
// identity-exposure gate fails on any slug a change adds (CLAUDE.md).
D(fakeBtn, 'https://linear.app/synchro-social/issue/VID-1/v', 'testclient', 'Video 1', {
  kind: 'kasper',
  payload: { url: 'https://syncview.synchrosocial.com/#kasper', surface: 'calendar', component: 'video' },
  persist: () => Promise.resolve({}),
});

setTimeout(() => {
  check('posts to the KASPER webhook, not #video-editing\'s',
    sent.fetches.length === 1 && sent.fetches[0].url === 'http://x/send-urgent-kasper-slack');
  const b = sent.fetches[0] ? sent.fetches[0].body : {};
  check('sends the card context and the review-tab link',
    b.client === 'testclient' && b.name === 'Video 1'
    && b.url === 'https://syncview.synchrosocial.com/#kasper'
    && b.surface === 'calendar' && b.component === 'video');
  check('sends NO recipient — the workflow resolves Kasper itself',
    !('slack_user_id' in b) && !('recipient' in b) && !('user' in b));
  check('the confirm asks about Kasper, not the editor',
    sent.confirms.length === 1 && /Kasper/.test(sent.confirms[0].title)
    && !/video-editing/.test(sent.confirms[0].bodyText) && sent.confirms[0].cta === 'Ping Kasper');
  check('the success notice says a DM went out', sent.notes.some(n => /Kasper/.test(n.t) && /DM/.test(n.m)));

  /* ── the section ─────────────────────────────────────────────────────── */
  console.log('\n-- the Urgent section --');
  const PART = [grabFunc('_calNormStatus'), grabConst('CAL_STATUSES'), grabConst('CAL_REVIEW_COMPONENTS'),
    grabFunc('_calUrgentSameRound'), grabFunc('_calKasperUrgentComp'), grabFunc('_calKasperUrgentActive'),
    grabFunc('_kasperPartitionItems')].join('\n\n');
  const part = new Function('_kasperIsFinished', PART + ';return _kasperPartitionItems;')(
    (p) => !!(p && p.kasper_finished_at));
  const items = [
    { post: pinged },                                            // urgent
    { post: card({ id: 'p2' }) },                                // waiting
    { post: card({ id: 'p3', kasper_finished_at: R1 }) },        // tweaks pending
    { post: Object.assign({}, pinged, { id: 'p4', kasper_finished_at: R1 }) },  // finished beats urgent
  ];
  const parts = part(items);
  check('a pinged card lands in urgent, not waiting',
    parts.urgent.length === 1 && parts.urgent[0].post.id === 'p1' && !parts.waiting.some(x => x.post.id === 'p1'));
  check('un-pinged cards are untouched', parts.waiting.length === 1 && parts.waiting[0].post.id === 'p2');
  check('a FINISHED card stays in Tweaks pending even when pinged',
    parts.tweaks.length === 2 && parts.tweaks.some(x => x.post.id === 'p4'));
  check('urgent is a split of waiting — no card is lost or duplicated',
    parts.urgent.length + parts.waiting.length + parts.tweaks.length === items.length);

  /* ── source guards: order and counts, which only the real file can prove ─ */
  console.log('\n-- source guards --');
  const calBody = INDEX.indexOf('_kasperRenderUrgentSection(urgent) + waitingHtml');
  check('review tab renders Urgent ABOVE Waiting for your review', calBody > 0);
  check('samples queue renders Urgent above Waiting too',
    INDEX.includes('_sxrKasperRenderUrgentSection(urgent) + waitingHtml'));
  check('both sections hide when empty',
    /_kasperRenderUrgentSection\(urgent\) \{\s*\n\s*if \(!urgent\.length\) return '';/.test(INDEX)
    && /_sxrKasperRenderUrgentSection\(urgent\) \{\s*\n\s*if \(!urgent\.length\) return '';/.test(INDEX));
  check('the review count pill adds urgent back to waiting',
    INDEX.includes("_parts.urgent.length + _parts.waiting.length")
    && INDEX.includes('const openCount = urgent.length + waiting.length;'));
  check('the samples count pill does too',
    INDEX.includes('_sxrParts.urgent.length + _sxrParts.waiting.length'));
  check('both SMM surfaces offer the kasper button',
    INDEX.includes("_calUrgentButtonHtml(pid, '_calSendKasperUrgentSlack', p, '', false, 'kasper')")
    && INDEX.includes("_calUrgentButtonHtml(pid, '_sxrSendKasperUrgentSlack', p, '', false, 'kasper')"));
  check('an in-place status change swaps the button rather than re-aiming it',
    (INDEX.match(/urgentEl\.dataset\.urgentKind \|\| 'editor'\) !== wantKind/g) || []).length === 2);

  // Codex P1: the sub-status row maps CAL_COMPONENTS (video/graphic/caption).
  // The title has no pill there, so its ping has to dock beside the title square
  // or a title-only Kasper Approval is unreachable.
  check('the TITLE gets the ping beside its status square, not only on a pill',
    INDEX.includes("_calShowKasperUrgent(p, 'title')")
    && INDEX.includes("_calUrgentButtonHtml(pid, '_calSendKasperUrgentSlack', p, 'cal-title-urgent-btn', true, 'kasper')"));
  check('and the in-place updater reconciles that one too',
    INDEX.includes('cal-title-urgent-btn') && INDEX.includes("_calShowKasperUrgent(post, 'title')"));

  // Codex P2: two redundant .is-kasper rules sat AFTER :disabled and .is-sent at
  // equal specificity, so they repainted a finished ping orange. The fix is that
  // the Kasper button carries no background rules of its own at all.
  // Matched as a RULE (`.cal-urgent-btn.is-kasper {`), not as a mention: the
  // stylesheet comment above the deletion names the class on purpose, so that a
  // future reader re-adding it knows exactly what it broke.
  check('the Kasper button declares no background that could outrank Sent/disabled',
    !/^\s*\.cal-urgent-btn\.is-kasper[^{\n]*\{/m.test(INDEX) && !INDEX.includes("' is-kasper'"));
  check('.cal-urgent-btn still owns the disabled and is-sent states',
    INDEX.includes('.cal-urgent-btn:disabled') && INDEX.includes('.cal-urgent-btn.is-sent'));

  // Codex P2: a click-only div is mouse-only. Both new heads are operable and
  // announce their state, and a focusable head has a visible ring.
  check('both Urgent heads are keyboard-operable and announce collapsed state',
    (INDEX.match(/_svSectionHeadA11y\(/g) || []).length === 3);   // 1 definition + 2 uses
  check('Enter and Space activate the head, and Space does not scroll',
    /_svSectionHeadKey\(ev\)[\s\S]{0,320}ev\.preventDefault\(\)/.test(INDEX));
  // Scoped to the two toggles themselves — aria-expanded is set in ~26 unrelated
  // places, so a repo-wide count proves nothing about these.
  check('toggling keeps aria-expanded honest on both queues',
    [grabFunc('_kasperToggleUrgent'), grabFunc('_sxrKasperToggleUrgent')]
      .every(fn => /setAttribute\('aria-expanded',\s*_\w+\.urgentCollapsed \? 'false' : 'true'\)/.test(fn)));
  check('a focusable head has a visible focus ring',
    INDEX.includes('.kasper-urgent-wrap .kasper-history-head:focus-visible'));

  // Codex P1, the dangerous one: the frozen writers must not carry a
  // copy-pasteable deploy line, and must say why.
  for (const slug of ['calendar-upsert', 'sample-review-upsert']) {
    const ef = fs.readFileSync(path.join(ROOT, 'supabase/functions', slug, 'index.ts'), 'utf8');
    check(slug + ' carries no bare deploy command to copy',
      !new RegExp('supabase functions deploy ' + slug + ' --project-ref').test(ef));
    check(slug + ' says it is FROZEN and why deploying it re-gates clients',
      ef.includes('⛔ FROZEN') && ef.includes('authorizeBrowserWrite') && ef.includes('NO CI DEPLOY PATH'));
  }
  // Codex round 2, all four findings.
  check('the switch is re-read again INSIDE the confirm, before any side effect',
    /confirm can sit[\s\S]{0,400}await _kasperUrgentPingOnLive\(client\)/.test(INDEX));
  check('the switch is re-read at CLICK time, not just cached at boot',
    INDEX.includes('async function _kasperUrgentPingOnLive(slug)')
    && (INDEX.match(/await _kasperUrgentPingOnLive\(/g) || []).length === 3);   // 2 handlers + inside the confirm
  check('activation repaints, so it does not need a reload',
    INDEX.includes('_kasperUrgentRepaintSurfaces()'));
  // The whole point of the feature: ONE machine, not two that merely resemble
  // each other. No flavour may reorder the two side effects.
  check('both flavours send Slack first, with no per-flavour ordering left',
    !INDEX.includes('persistFirst')
    && INDEX.includes('SLACK FIRST, for BOTH flavours'));
  check('a card with two waiting components reconciles ALL its buttons after saving',
    /_calPersistKasperUrgentForPost[\s\S]{0,2200}_calUpdateCardStatusDisplay\(post\.id\)/.test(INDEX));
  check('the EF strips all four *_status_at before writing, not just two',
    ['caption_status_at', 'title_status_at', 'video_status_at', 'graphic_status_at'].every(c =>
      fs.readFileSync(path.join(ROOT, 'supabase/functions/calendar-upsert/index.ts'), 'utf8')
        .includes('delete out.' + c + ';')));

  check('the flag read fails closed on every error path',
    /_kasperUrgentFlagValue = null;\s*\/\/ fail closed/.test(INDEX)
    && INDEX.includes("(row && row.value && typeof row.value === 'object') ? row.value : null"));
  check('both affordances are gated on it, each asking about ITS OWN client',
    INDEX.includes("_kasperUrgentPingOn(calState && calState.client)")
    && INDEX.includes("_kasperUrgentPingOn(sxrState && sxrState.client)"));
  check('the migration ships the flag row COMMENTED OUT, so schema alone is inert',
    /^-- insert into public\.syncview_runtime_flags/m.test(
      fs.readFileSync(path.join(ROOT, 'migrations/2026-09-09-kasper-urgent-pings.sql'), 'utf8')));

  const ledger = fs.readFileSync(path.join(ROOT, 'docs/ops/OPEN_REPAIRS.md'), 'utf8');
  check('the two port-blocking defects are recorded, not silently carried',
    ledger.includes('kasper_urgent_delivered_at') && ledger.includes('MUST BE FIXED *IN* THE PORT'));
  // Anchored on the item's TITLE, not its number. The number has already moved
  // twice (186 -> 187 -> 188) as concurrent branches claimed it on merge, and a
  // number-anchored slice silently starts reading somebody else's item -- which
  // is how this check passed for two merges while pointing at the wrong entry.
  const head = ledger.indexOf('The URGENT ping only ever pointed one way');
  check('the ledger item is findable by its own title, not by a number that moves', head > 0);
  const item = ledger.slice(head);
  check('the ledger item does not tell the owner to deploy the frozen writers',
    !/supabase functions deploy calendar-upsert --project-ref/.test(item)
    && item.includes('NOT deployable from this branch'));

  for (const [slug, comps] of [['calendar-upsert', 4], ['sample-review-upsert', 2]]) {
    const ef = fs.readFileSync(path.join(ROOT, 'supabase/functions', slug, 'index.ts'), 'utf8');
    check(slug + ' allow-lists the four marker columns',
      (ef.match(/"kasper_urgent_pinged_at", "kasper_urgent_status_at", "kasper_urgent_comp", "kasper_urgent_by"/g) || []).length >= 3);
    check(slug + ' refuses a marker whose component is not at Kasper Approval',
      ef.includes('if (status !== "Kasper Approval")') && ef.includes('applyKasperUrgentMarkerGuards(row, incoming, existing);'));
    check(slug + ' re-derives the round key server-side',
      ef.includes('const statusAtCol = comp + "_status_at";'));
    check(slug + ' knows its ' + comps + ' components',
      (ef.match(/const KASPER_URGENT_COMPONENTS = \[([^\]]*)\]/) || [, ''])[1].split(',').length === comps);
    check(slug + ' writes a ledger row for the ping', ef.includes('ev("kasper_urgent_ping"'));
  }

  const mig = fs.readFileSync(path.join(ROOT, 'migrations/2026-09-09-kasper-urgent-pings.sql'), 'utf8');
  check('migration adds the marker columns to both tables',
    (mig.match(/kasper_urgent_pinged_at timestamptz/g) || []).length === 2);
  check('migration stamps caption/title changes so their rounds can expire',
    mig.includes('caption_status_at := now();') && mig.includes('title_status_at := now();'));

  console.log(failures ? `\n${failures} check(s) FAILED.` : '\nAll Kasper-approval urgent-ping checks passed.');
  process.exit(failures ? 1 : 0);
}, 0);
