'use strict';
/* The server-side completion of a committed client review action
 * (scripts/client-signoff-reconcile.js, OPEN_REPAIRS 195).
 *
 * Every case below is driven through the real module — the same detection and
 * patch construction the job runs in production — with the world supplied as
 * fixtures, so no credentials and no network are involved.
 *
 * The cases that matter most are the ones that must NOT repair. This job writes
 * to client-facing cards unattended; a false positive here republishes settled
 * work or duplicates a client's own words back at them. Item 190's sweep was
 * wrong eight times running because its checks were biased toward finding
 * something, so the negative cases are asserted first and in the most detail. */
const assert = require('node:assert/strict');
const {
  detect, patchFor, parseComments, normText, stampSurvives,
} = require('../scripts/client-signoff-reconcile.js');

const CARD = (over) => Object.assign({
  id: 'card-1', client: 'testclient', name: 'card', status: 'Client Approval',
  video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved',
  video_tweaks: '', graphic_tweaks: '', caption_tweaks: '',
  client_video_approved_at: null, client_graphic_approved_at: null,
  client_caption_approved_at: null, kasper_approved_at: null,
  updated_at: '2026-09-01T00:00:00.000Z',
}, over || {});
const DEL = (over) => Object.assign({
  id: 'del-1', card_id: 'card-1', kind: 'video', client_slug: 'testclient',
}, over || {});
const APPROVE = (over) => Object.assign({
  entity_id: 'del-1', entity: 'deliverable', operation: 'status', status: 'written',
  role: 'client', payload: { status: 'approved' },
  source_edited_at: '2026-09-05T10:00:00.000Z',
  created_at: '2026-09-05T10:00:00.000Z',
  processed_at: '2026-09-05T10:00:00.000Z', test_only: false,
}, over || {});
const TWEAK = (over) => Object.assign({
  id: 'pc_x1', deliverable_id: 'del-1', component: 'video', body: 'Please fix the intro',
  author_name: 'A Client', role: 'client', is_tweak: true, round: 1, audience: 'client',
  created_at: '2026-09-05T10:00:00.000Z', updated_at: '2026-09-05T10:00:00.000Z', deleted_at: null,
}, over || {});
const world = (o) => ({ outbox: o.outbox || [], comments: o.comments || [], deliverables: o.deliverables || [DEL()], cards: o.cards || [CARD()] });

let checks = 0;
const check = (label, fn) => { fn(); checks++; console.log('  ok — ' + label); };

/* ── it must not repair ───────────────────────────────────────────────── */

check('a card that moved below client approval keeps no resurrected stamp', () => {
  for (const status of ['Tweaks Needed', 'In Progress']) {
    const { findings, skipped } = detect(world({
      outbox: [APPROVE()], cards: [CARD({ video_status: status })],
    }));
    assert.equal(findings.length, 0, status + ' must not be stamped');
    assert.equal(skipped[0].reason, 'superseded_status');
  }
});

check('no committed approve means no stamp is ever written', () => {
  const { findings } = detect(world({ outbox: [] }));
  assert.equal(findings.length, 0, 'a status alone must never produce a sign-off');
});

check('a tweak-only client write is not read as an approval', () => {
  const { findings } = detect(world({ outbox: [APPROVE({ payload: { status: 'tweak' } })] }));
  assert.equal(findings.length, 0);
});

check('an already-stamped card is left alone', () => {
  const { findings } = detect(world({
    outbox: [APPROVE()], cards: [CARD({ client_video_approved_at: '2026-09-04T00:00:00.000Z' })],
  }));
  assert.equal(findings.length, 0);
});

check('a test-only outbox row is not a client action', () => {
  const { findings } = detect(world({ outbox: [APPROVE({ test_only: true })] }));
  assert.equal(findings.length, 0);
});

check('an archived card is never touched', () => {
  const { findings } = detect(world({ outbox: [APPROVE()], cards: [CARD({ status: 'Archived' })] }));
  assert.equal(findings.length, 0);
});

check('a change request is not re-delivered once the round has closed', () => {
  const { findings, skipped } = detect(world({
    comments: [TWEAK()], cards: [CARD({ video_status: 'Approved' })],
  }));
  assert.equal(findings.length, 0, 'reopening settled work is worse than the omission');
  assert.equal(skipped[0].reason, 'review_round_closed');
});

/* THE FALSE POSITIVE THAT STARTED THIS. Comparing the card's raw cell as text
   reports a miss on every request containing a quote or a newline, because the
   cell stores them JSON-escaped. A first pass over live data called 78 of 82
   requests lost on exactly that mistake; the true number was a handful. */
check('a request already on the card is not duplicated, quotes and newlines included', () => {
  const body = 'Change "the hook"\nand the last line — please';
  const onCard = JSON.stringify([{ id: 'cal-9', body, is_tweak: true, role: 'client' }]);
  assert.ok(onCard.includes('\\"'), 'fixture must actually exercise JSON escaping');
  assert.equal(onCard.includes(body), false, 'a raw text search would miss this');
  const { findings } = detect(world({
    comments: [TWEAK({ body })], cards: [CARD({ video_status: 'Client Approval', video_tweaks: onCard })],
  }));
  assert.equal(findings.length, 0, 'the body is on the card under a different id');
});

check('the same request is recognised by id after a previous repair (idempotent)', () => {
  const first = detect(world({ comments: [TWEAK()], cards: [CARD({ video_status: 'Client Approval' })] }));
  assert.equal(first.findings.length, 1);
  const repaired = CARD({
    video_status: 'Tweaks Needed',
    video_tweaks: patchFor(first.findings[0]).video_tweaks,
  });
  const second = detect(world({ comments: [TWEAK()], cards: [repaired] }));
  assert.equal(second.findings.length, 0, 'a second run must not append a second copy');
});

check('a deleted request is not delivered', () => {
  const { findings } = detect(world({
    comments: [TWEAK({ deleted_at: '2026-09-06T00:00:00.000Z' })],
    cards: [CARD({ video_status: 'Client Approval' })],
  }));
  assert.equal(findings.length, 0);
});

check('an unparseable comment cell is reported, never overwritten', () => {
  const { findings, skipped } = detect(world({
    comments: [TWEAK()], cards: [CARD({ video_status: 'Client Approval', video_tweaks: '{not json' })],
  }));
  assert.equal(findings.length, 0, 'treating it as empty would erase the cell');
  assert.equal(skipped[0].reason, 'card_cell_unparseable');
});

/* ── it must repair, with the server's own values ─────────────────────── */

check('a missing sign-off is restored at the time the client actually approved', () => {
  const { findings } = detect(world({ outbox: [APPROVE()] }));
  assert.equal(findings.length, 1);
  const patch = patchFor(findings[0]);
  assert.equal(patch.client_video_approved_at, '2026-09-05T10:00:00.000Z',
    'the stamp is the commit time, never "now" and never derived from the status');
  assert.equal(patch.id, 'card-1');
});

check('the latest committed approve is the operative sign-off', () => {
  const { findings } = detect(world({
    outbox: [APPROVE(), APPROVE({ source_edited_at: '2026-09-07T09:00:00.000Z' })],
  }));
  assert.equal(findings.length, 1, 'one component, one stamp');
  assert.equal(patchFor(findings[0]).client_video_approved_at, '2026-09-07T09:00:00.000Z');
});

/* The stamp is the CLIENT's write time, not the outbound delivery time.
   processed_at is set when linear-outbound finishes carrying the row onward,
   which on a retried delivery is much later than the client's action. */
check('the stamp follows the client\'s own clock, not outbound completion', () => {
  const { findings } = detect(world({
    outbox: [APPROVE({
      source_edited_at: '2026-09-05T10:00:00.000Z',
      processed_at: '2026-09-05T18:30:00.000Z',
    })],
  }));
  assert.equal(patchFor(findings[0]).client_video_approved_at, '2026-09-05T10:00:00.000Z');
});

/* SUPERSEDED BY A LATER ROUND. Approve, reopen, staff re-approve: the card
   reads Approved again, but the client never saw the new revision. */
check('an approval superseded by a later reopen is not restored', () => {
  for (const reopen of ['tweak', 'in_progress', 'client_approval', 'kasper_approval', 'canceled']) {
    const { findings, skipped } = detect(world({
      outbox: [
        APPROVE(),
        Object.assign(APPROVE(), {
          role: 'smm', payload: { status: reopen },
          source_edited_at: '2026-09-06T10:00:00.000Z',
        }),
      ],
    }));
    assert.equal(findings.length, 0, reopen + ' after the approval must supersede it');
    assert.equal(skipped[0].reason, 'superseded_by_later_reopen');
  }
});

/* But forward progress is NOT supersession. Every genuine repair measured on
   live rows had exactly such a later transition; treating it as supersession
   would discard all of them. */
check('work advancing past Approved does not cancel the sign-off', () => {
  for (const forward of ['posted', 'scheduled', 'approved']) {
    const { findings } = detect(world({
      outbox: [
        APPROVE(),
        Object.assign(APPROVE(), {
          role: 'smm', payload: { status: forward },
          source_edited_at: '2026-09-06T10:00:00.000Z',
        }),
      ],
      cards: [CARD({ video_status: 'Posted' })],
    }));
    assert.equal(findings.length, 1, forward + ' is progress, not a reopen');
  }
});

/* A client repeating the same request in a later round is a NEW request. Body
   matching alone would match it against the first round's entry and leave the
   new one invisible, so entries are consumed one-for-one. */
check('a repeated request is delivered rather than swallowed by the first', () => {
  const onCard = JSON.stringify([{ id: 'cal-1', body: 'Please fix the intro', is_tweak: true, role: 'client' }]);
  const { findings } = detect(world({
    comments: [
      TWEAK({ id: 'pc_r1', created_at: '2026-09-01T09:00:00.000Z' }),
      TWEAK({ id: 'pc_r2', round: 3, created_at: '2026-09-06T09:00:00.000Z' }),
    ],
    cards: [CARD({ video_status: 'Client Approval', video_tweaks: onCard })],
  }));
  assert.equal(findings.length, 1, 'one on the card, two on the server, one missing');
  const list = parseComments(patchFor(findings[0]).video_tweaks);
  assert.deepEqual(list.map(c => c.id), ['cal-1', 'pc_r2'], 'the LATER request is the missing one');
});

check('the card entry is recognised by its native comment id', () => {
  const onCard = JSON.stringify([{ id: 'nat-77', body: 'totally different text', is_tweak: true }]);
  const { findings } = detect(world({
    comments: [TWEAK({ native_comment_id: 'nat-77' })],
    cards: [CARD({ video_status: 'Client Approval', video_tweaks: onCard })],
  }));
  assert.equal(findings.length, 0, 'the card stores the native id, not the row id');
});

check('a thumbnail deliverable stamps the graphic component', () => {
  const { findings } = detect(world({
    outbox: [APPROVE()], deliverables: [DEL({ kind: 'thumbnail' })],
  }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].component, 'graphic');
  assert.equal(patchFor(findings[0]).client_graphic_approved_at, '2026-09-05T10:00:00.000Z');
});

/* A stamp repair moves no component, so it must not touch the overall pill.
   Caught by a fixture run, not by review: repairing a stamp on a card reading
   Approved proposed status="In Progress", because computeOverallStatus derives
   from the whole component set and infers anything the read did not carry. */
check('restoring a sign-off never rewrites the overall status', () => {
  const { findings } = detect(world({
    outbox: [APPROVE()],
    cards: [CARD({ status: 'Approved', caption_status: undefined })],
  }));
  const patch = patchFor(findings[0]);
  assert.deepEqual(Object.keys(patch).sort(), ['client_video_approved_at', 'id'],
    'a stamp repair touches the stamp and nothing else');
});

check('a lost change request reaches the card and moves it to Tweaks Needed', () => {
  const { findings } = detect(world({
    comments: [TWEAK()], cards: [CARD({ video_status: 'Client Approval' })],
  }));
  assert.equal(findings.length, 1);
  const patch = patchFor(findings[0]);
  assert.equal(patch.video_status, 'Tweaks Needed');
  const list = parseComments(patch.video_tweaks);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'pc_x1', 'carry the server id so a later run sees it as delivered');
  assert.equal(list[0].body, 'Please fix the intro', 'the body is the client\'s, not reconstructed');
  assert.equal(list[0].role, 'client');
  assert.equal(list[0].recovered_by, 'client-signoff-reconcile', 'provenance stays on the row');
});

check('an existing request on the card is preserved when another is delivered', () => {
  const existing = JSON.stringify([{ id: 'cal-1', body: 'earlier note', is_tweak: true, role: 'client' }]);
  const { findings } = detect(world({
    comments: [TWEAK()], cards: [CARD({ video_status: 'Tweaks Needed', video_tweaks: existing })],
  }));
  const list = parseComments(patchFor(findings[0]).video_tweaks);
  assert.deepEqual(list.map(c => c.id), ['cal-1', 'pc_x1'], 'append, never replace the cell');
});

check('delivering a change request clears the sign-off it invalidates', () => {
  const { findings } = detect(world({
    comments: [TWEAK()],
    cards: [CARD({ video_status: 'Client Approval', client_video_approved_at: '2026-09-02T00:00:00.000Z' })],
  }));
  const patch = patchFor(findings[0]);
  assert.equal(patch.video_status, 'Tweaks Needed');
  assert.equal(patch.client_video_approved_at, '',
    'a component asked to change cannot keep the approval from the round it left');
});

/* CODEX ROUND 2. A row exists in mirror_outbox because the NATIVE write
   committed; its status describes what the Linear carrier did afterwards. A
   reopen whose delivery is pending or skipped is still a reopen. */
check('a reopen the carrier has not delivered still supersedes', () => {
  for (const carrier of ['pending', 'skipped', 'stale']) {
    const { findings, skipped } = detect(world({
      outbox: [
        APPROVE(),
        Object.assign(APPROVE(), {
          role: 'smm', status: carrier, payload: { status: 'tweak' },
          source_edited_at: '2026-09-06T10:00:00.000Z',
        }),
      ],
    }));
    assert.equal(findings.length, 0, carrier + ' reopen must not be invisible');
    assert.equal(skipped[0].reason, 'superseded_by_later_reopen');
  }
});

check('but an approval the carrier never wrote is not acted on', () => {
  const { findings } = detect(world({ outbox: [APPROVE({ status: 'pending' })] }));
  assert.equal(findings.length, 0, 'broad evidence to leave alone, narrow evidence to repair');
});

/* Ids are exact, so they claim their entry before ANY body fallback runs.
   Two requests share a body; the card holds only the LATER one, under its
   native id. A single pass in date order lets the earlier request consume it
   by body and then delivers the later one again. */
check('an exact id claims its entry before any body fallback', () => {
  const onCard = JSON.stringify([
    { id: 'nat-late', body: 'Please fix the intro', is_tweak: true, role: 'client' },
  ]);
  const { findings } = detect(world({
    comments: [
      TWEAK({ id: 'pc_early', created_at: '2026-09-01T09:00:00.000Z' }),
      TWEAK({ id: 'pc_late', native_comment_id: 'nat-late', created_at: '2026-09-06T09:00:00.000Z' }),
    ],
    cards: [CARD({ video_status: 'Client Approval', video_tweaks: onCard })],
  }));
  assert.equal(findings.length, 1, 'exactly one of the two is missing');
  assert.equal(findings[0].comment.id, 'pc_early',
    'the EARLIER request is the missing one; the later one owns the entry by id');
});

/* A staff note, a reply or a deleted entry carrying the same words is not a
   delivery of the client's request. */
check('the body fallback will not consume an entry that is not the client\'s', () => {
  const cases = [
    { id: 'x', body: 'Please fix the intro', role: 'smm' },
    { id: 'x', body: 'Please fix the intro', role: 'kasper' },
    { id: 'x', body: 'Please fix the intro', role: 'client', parent_id: 'root-1' },
    { id: 'x', body: 'Please fix the intro', role: 'client', deleted: true },
  ];
  for (const entry of cases) {
    const { findings } = detect(world({
      comments: [TWEAK()],
      cards: [CARD({ video_status: 'Client Approval', video_tweaks: JSON.stringify([entry]) })],
    }));
    assert.equal(findings.length, 1,
      `a ${entry.role}${entry.parent_id ? ' reply' : ''}${entry.deleted ? ' deleted' : ''} entry must not count as delivery`);
  }
});

check('a client root with is_tweak false still counts as delivered', () => {
  const onCard = JSON.stringify([
    { id: 'cal-1', body: 'Please fix the intro', role: 'client', is_tweak: false },
  ]);
  const { findings } = detect(world({
    comments: [TWEAK()],
    cards: [CARD({ video_status: 'Client Approval', video_tweaks: onCard })],
  }));
  assert.equal(findings.length, 0, '18 of 327 live matches carry is_tweak:false');
});

/* CODEX ROUND 3. A request NAMES its component. Guessing from the deliverable
   kind when that name is unrecognised puts title feedback in video_tweaks and
   drags video_status to Tweaks Needed: the wrong review, mutated on a guess. */
check('a title request lands on the title component, not the video one', () => {
  const { findings } = detect(world({
    comments: [TWEAK({ component: 'title' })],
    cards: [CARD({ title_status: 'Client Approval', video_status: 'Approved' })],
  }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].component, 'title');
  const patch = patchFor(findings[0]);
  assert.ok(patch.title_tweaks, 'the request goes to title_tweaks');
  assert.equal(patch.video_tweaks, undefined, 'and never to the video review');
  assert.equal(patch.video_status, undefined, 'the video component is not moved');
  assert.equal(patch.title_status, 'Tweaks Needed');
});

check('a named component that cannot be mapped is reported, never guessed', () => {
  const { findings, skipped } = detect(world({
    comments: [TWEAK({ component: 'sizzle-reel' })],
    cards: [CARD({ video_status: 'Client Approval' })],
  }));
  assert.equal(findings.length, 0, 'the deliverable kind must not stand in for it');
  assert.equal(skipped[0].reason, 'unmapped_component');
});

check('a request naming nothing still falls back to the deliverable kind', () => {
  const { findings } = detect(world({
    comments: [TWEAK({ component: '' })],
    cards: [CARD({ video_status: 'Client Approval' })],
  }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].component, 'video');
});

/* CODEX ROUND 4, AND THE MOST DANGEROUS CLASS IN THIS FILE.
   calendar_posts is keyed by (client, id), not by id alone: 13 live card ids
   are used by more than one client and 17 deliverables point at one of them.
   Keying by id alone lets one client's card stand in for another's, and on an
   apply run that writes a client's approval, or their words, onto a DIFFERENT
   CLIENT'S CARD. */
check('a card id shared by two clients never crosses between them', () => {
  const shared = [
    CARD({ id: 'dup-1', client: 'clienta', video_status: 'Approved', client_video_approved_at: null }),
    CARD({ id: 'dup-1', client: 'clientb', video_status: 'Approved', client_video_approved_at: null }),
  ];
  const { findings } = detect({
    outbox: [APPROVE()],
    comments: [],
    deliverables: [DEL({ card_id: 'dup-1', client_slug: 'clientb' })],
    cards: shared,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].card.client, 'clientb',
    'the deliverable belongs to clientb, so clienta must not be touched');
});

check('a request crosses to no other client either', () => {
  const shared = [
    CARD({ id: 'dup-2', client: 'clienta', video_status: 'Client Approval' }),
    CARD({ id: 'dup-2', client: 'clientb', video_status: 'Client Approval' }),
  ];
  const { findings } = detect({
    outbox: [],
    comments: [TWEAK()],
    deliverables: [DEL({ card_id: 'dup-2', client_slug: 'clienta' })],
    cards: shared,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].card.client, 'clienta');
});

/* Doubly enforced: the explicit guard, and the composite key itself, which a
   blank client can never match. Asserted against a card whose client IS blank,
   so the composite key alone would resolve it and only the guard refuses. */
check('a deliverable naming no client resolves to no card at all', () => {
  const { findings } = detect({
    outbox: [APPROVE()],
    comments: [],
    deliverables: [DEL({ client_slug: '' })],
    cards: [CARD({ client: '' })],
  });
  assert.equal(findings.length, 0, 'an unidentifiable card must never be guessed');
});

/* BOTH cards must already hold the request, so that a tally shared between the
   two clients would let the first client consume the entry and leave the second
   looking undelivered — a duplicate written onto the second client's card.
   Giving only one client the entry does NOT discriminate: the other client's
   list is empty either way. */
check('two clients sharing an id each keep their own consumption tally', () => {
  const onCard = () => JSON.stringify([
    { id: 'x1', body: 'Please fix the intro', role: 'client' },
  ]);
  const { findings } = detect({
    outbox: [],
    comments: [
      TWEAK({ id: 'pc_a', deliverable_id: 'del-a' }),
      TWEAK({ id: 'pc_b', deliverable_id: 'del-b' }),
    ],
    deliverables: [
      DEL({ id: 'del-a', card_id: 'dup-3', client_slug: 'clienta' }),
      DEL({ id: 'del-b', card_id: 'dup-3', client_slug: 'clientb' }),
    ],
    cards: [
      CARD({ id: 'dup-3', client: 'clienta', video_status: 'Client Approval', video_tweaks: onCard() }),
      CARD({ id: 'dup-3', client: 'clientb', video_status: 'Client Approval', video_tweaks: onCard() }),
    ],
  });
  assert.equal(findings.length, 0,
    'each client already holds its own copy; a shared tally would duplicate one');
});

/* ── the shared rule ──────────────────────────────────────────────────── */

check('staleness is decided by the app\'s own rule, for every status', () => {
  for (const status of ['Approved', 'Scheduled', 'Posted']) {
    assert.equal(stampSurvives(CARD({ video_status: status }), 'video', 'T'), true, status);
  }
  for (const status of ['Tweaks Needed', 'In Progress']) {
    assert.equal(stampSurvives(CARD({ video_status: status }), 'video', 'T'), false, status);
  }
});

check('body comparison ignores only whitespace shape', () => {
  assert.equal(normText('  a   b \n c '), 'a b c');
  assert.notEqual(normText('fix the intro'), normText('fix the outro'));
});

console.log(`PASS: ${checks} checks — committed client actions are completed from server evidence, and a card that moved on is never overwritten`);
