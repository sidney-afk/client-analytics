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
  detect, patchFor, parseComments, normText, stampSurvives, restRows,
  writePatch, WRITABLE_KINDS,
} = require('../scripts/client-signoff-reconcile.js');

const CARD = (over) => Object.assign({
  id: 'card-1', client: 'testclient', name: 'card', status: 'Client Approval',
  video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved',
  video_tweaks: '', graphic_tweaks: '', caption_tweaks: '',
  client_video_approved_at: null, client_graphic_approved_at: null,
  client_caption_approved_at: null, kasper_approved_at: null,
  /* The card side of the crosswalk. A default fixture is a PROPERLY LINKED
     card: the deliverable names the card and the card names it back. */
  video_deliverable_id: 'del-1', graphic_deliverable_id: null,
  updated_at: '2026-09-01T00:00:00.000Z',
}, over || {});
const DEL = (over) => Object.assign({
  id: 'del-1', card_id: 'card-1', kind: 'video', team: 'video', origin: 'calendar',
  client_slug: 'testclient',
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
/* Async checks run at the end so the synchronous ordering above is untouched. */
const asyncChecks = [];
const checkAsync = (label, fn) => asyncChecks.push([label, fn]);

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
    outbox: [APPROVE()], deliverables: [DEL({ kind: 'thumbnail', team: 'graphics' })],
    /* Graphic work reverse-links through the GRAPHIC slot, which is also the
       team half of the product's crosswalk. */
    cards: [CARD({ video_deliverable_id: null, graphic_deliverable_id: 'del-1' })],
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

/* CODEX ROUND 5. An INCOMPLETE cell is not an empty one. stringifyComments and
   the merge RPC drop entries without ids, so rebuilding an array over a cell
   that holds them destroys real client words that simply predate the id field.
   The browser's own _calLoadCommentsField makes the same judgement. */
check('a cell that is valid JSON but not an array is refused, not emptied', () => {
  for (const cell of ['{"a":1}', '"a string"', '42', 'null']) {
    const { findings, skipped } = detect(world({
      comments: [TWEAK()], cards: [CARD({ video_status: 'Client Approval', video_tweaks: cell })],
    }));
    assert.equal(findings.length, 0, cell + ' must not be treated as no comments');
    assert.equal(skipped[0].reason, 'card_cell_unparseable');
  }
});

check('an array holding an id-less entry is refused, never rewritten', () => {
  const cell = JSON.stringify([
    { id: 'has-id', body: 'kept', role: 'client' },
    { body: 'legacy feedback with no id', role: 'client' },
  ]);
  const { findings, skipped } = detect(world({
    comments: [TWEAK()], cards: [CARD({ video_status: 'Client Approval', video_tweaks: cell })],
  }));
  assert.equal(findings.length, 0, 'a repair here would erase the id-less entry');
  assert.equal(skipped[0].reason, 'card_cell_unparseable');
  assert.equal(parseComments(cell), null);
});

/* 103 of 345 live client requests carry a resolution. Republishing one as open
   work hands the team completed feedback as a fresh task. */
check('a request already resolved travels with its resolution, not as new work', () => {
  const { findings } = detect(world({
    comments: [TWEAK({ resolved_at: '2026-09-07T12:00:00.000Z', resolved_by_name: 'A Reviewer' })],
    cards: [CARD({ video_status: 'Client Approval' })],
  }));
  assert.equal(findings.length, 1, 'it still never reached the card, so it is still missing');
  const entry = parseComments(patchFor(findings[0]).video_tweaks)[0];
  assert.equal(entry.done, true, 'delivered as resolved, not as an open request');
  assert.equal(entry.done_at, '2026-09-07T12:00:00.000Z');
  assert.equal(entry.done_by, 'A Reviewer');
});

check('an unresolved request is still delivered as open', () => {
  const { findings } = detect(world({
    comments: [TWEAK()], cards: [CARD({ video_status: 'Client Approval' })],
  }));
  const entry = parseComments(patchFor(findings[0]).video_tweaks)[0];
  assert.equal(entry.done, false);
  assert.equal(entry.done_at, '');
});

/* The browser's projector and its repair journal both key on
   native_comment_id. Writing the row id instead means a resuming browser
   merges two ids and the client sees their own request twice. */
check('the delivered entry carries the native id the browser will merge on', () => {
  const { findings } = detect(world({
    comments: [TWEAK({ id: 'pc_row', native_comment_id: 'nat-77' })],
    cards: [CARD({ video_status: 'Client Approval' })],
  }));
  const entry = parseComments(patchFor(findings[0]).video_tweaks)[0];
  assert.equal(entry.id, 'nat-77', 'server and browser recovery must converge on one identity');
});

check('and falls back to the row id when there is no native one', () => {
  const { findings } = detect(world({
    comments: [TWEAK({ id: 'pc_row', native_comment_id: null })],
    cards: [CARD({ video_status: 'Client Approval' })],
  }));
  assert.equal(parseComments(patchFor(findings[0]).video_tweaks)[0].id, 'pc_row');
});

/* Offset pagination without a total order can skip a row between pages, and a
   skipped reopen means a stale approval gets restored. */
checkAsync('a paged read refuses to run without a unique order column', async () => {
  await assert.rejects(() => restRows('mirror_outbox', 'select=id'),
    /unique order column/, 'unordered pagination must be impossible to write by accident');
});

/* CODEX ROUND 6. Round 5 carried the resolution into `done` but left the status
   branch unconditional, so a resolved request still flipped the component to
   Tweaks Needed and the stale sweep then stripped the sign-off. The round-5
   test checked `done` and never looked at the status — a real gap, and the
   reason this one asserts the whole patch. */
check('a resolved request is delivered without reopening the round', () => {
  const { findings } = detect(world({
    comments: [TWEAK({ resolved_at: '2026-09-07T12:00:00.000Z', resolved_by_name: 'A Reviewer' })],
    cards: [CARD({ video_status: 'Client Approval', client_video_approved_at: '2026-09-06T00:00:00.000Z' })],
  }));
  assert.equal(findings.length, 1);
  const patch = patchFor(findings[0]);
  assert.equal(patch.video_status, undefined, 'settled work must not be reopened');
  assert.equal(patch.status, undefined, 'and the overall pill must not move');
  assert.equal(patch.client_video_approved_at, undefined,
    'and no sign-off may be stripped on the strength of a resolved request');
  assert.ok(patch.video_tweaks, 'the request itself is still delivered');
  assert.equal(parseComments(patch.video_tweaks)[0].done, true);
});

check('an unresolved request still moves the round, as before', () => {
  const { findings } = detect(world({
    comments: [TWEAK()], cards: [CARD({ video_status: 'Client Approval' })],
  }));
  assert.equal(patchFor(findings[0]).video_status, 'Tweaks Needed');
});

/* calendar-upsert merges comments and updates scalars as two operations. If the
   merge commits and the update fails, the request is on the card with no status
   change, and presence alone would suppress the finding forever. */
check('a request this job delivered without its status leg is finished later', () => {
  const halfRepaired = JSON.stringify([{
    id: 'pc_x1', body: 'Please fix the intro', role: 'client', is_tweak: true,
    recovered_by: 'client-signoff-reconcile',
  }]);
  const { findings } = detect(world({
    comments: [TWEAK()],
    cards: [CARD({ video_status: 'Client Approval', video_tweaks: halfRepaired })],
  }));
  assert.equal(findings.length, 1, 'the status leg is still owed');
  assert.equal(findings[0].kind, 'status_only');
  const patch = patchFor(findings[0]);
  assert.equal(patch.video_status, 'Tweaks Needed');
  assert.equal(patch.video_tweaks, undefined, 'the request is already there; do not append it twice');
});

check('an ordinary card at Client Approval is not mistaken for a half repair', () => {
  const byHuman = JSON.stringify([{
    id: 'pc_x1', body: 'Please fix the intro', role: 'client', is_tweak: true,
  }]);
  const { findings } = detect(world({
    comments: [TWEAK()],
    cards: [CARD({ video_status: 'Client Approval', video_tweaks: byHuman })],
  }));
  assert.equal(findings.length, 0, 'only this job\'s own unfinished work qualifies');
});

check('a half repair of a RESOLVED request is left alone', () => {
  const halfRepaired = JSON.stringify([{
    id: 'pc_x1', body: 'Please fix the intro', role: 'client', is_tweak: true,
    recovered_by: 'client-signoff-reconcile',
  }]);
  const { findings } = detect(world({
    comments: [TWEAK({ resolved_at: '2026-09-07T12:00:00.000Z' })],
    cards: [CARD({ video_status: 'Client Approval', video_tweaks: halfRepaired })],
  }));
  assert.equal(findings.length, 0, 'no status leg was ever owed for a resolved request');
});

/* CODEX ROUND 7. loadWorld may read the source comment BEFORE someone resolves
   it, so pc.resolved_at can be stale while the card already shows the entry
   done. The card was read later, so where the two disagree the card wins. */
check('a claimed entry marked done overrules a stale source snapshot', () => {
  for (const state of [{ done: true }, { deleted: true }]) {
    const halfRepaired = JSON.stringify([Object.assign({
      id: 'pc_x1', body: 'Please fix the intro', role: 'client', is_tweak: true,
      recovered_by: 'client-signoff-reconcile',
    }, state)]);
    const { findings } = detect(world({
      comments: [TWEAK({ resolved_at: null })],
      cards: [CARD({ video_status: 'Client Approval', video_tweaks: halfRepaired })],
    }));
    assert.equal(findings.length, 0,
      `an entry marked ${Object.keys(state)[0]} must not reopen the component`);
  }
});

/* A resolved request on a closed round is REPORTED under its own reason rather
   than written. Measured: 100 such rows live, none of them missing from their
   card, so writing them would repair nothing while making 100 closed cards
   writable. Reported so the row is never silently forgotten. */
check('a resolved request on a closed round is reported under its own reason', () => {
  const { findings, skipped } = detect(world({
    comments: [TWEAK({ resolved_at: '2026-09-07T12:00:00.000Z' })],
    cards: [CARD({ video_status: 'Approved' })],
  }));
  assert.equal(findings.length, 0, 'a closed round is still not written to');
  assert.equal(skipped[0].reason, 'review_round_closed_resolved',
    'and it is distinguishable from an unresolved one, so it is visible');
});

check('an unresolved request on a closed round keeps the plain reason', () => {
  const { skipped } = detect(world({
    comments: [TWEAK()], cards: [CARD({ video_status: 'Approved' })],
  }));
  assert.equal(skipped[0].reason, 'review_round_closed');
});

/* CODEX ROUND 8. An unresolved request whose only body match is a DONE entry is
   genuinely ambiguous: the done entry may be an older request with the same
   words (so the live one is missing), or it may BE this request resolved on the
   card while the source row lagged (so delivering duplicates it). Body text
   cannot tell them apart and 8 live rows sit in this state, so the job reports
   instead of guessing. */
check('an unresolved request matching only a completed entry is reported, not guessed', () => {
  const onCard = JSON.stringify([{
    id: 'cal-old', body: 'Please fix the intro', role: 'client', is_tweak: true, done: true,
  }]);
  const { findings, skipped } = detect(world({
    comments: [TWEAK({ resolved_at: null })],
    cards: [CARD({ video_status: 'Client Approval', video_tweaks: onCard })],
  }));
  assert.equal(findings.length, 0, 'a duplicate must not be written on a guess');
  assert.equal(skipped[0].reason, 'ambiguous_repeat_of_completed_request',
    'and it must not be silently treated as delivered either');
});

check('a RESOLVED request still matches a completed entry normally', () => {
  const onCard = JSON.stringify([{
    id: 'cal-old', body: 'Please fix the intro', role: 'client', is_tweak: true, done: true,
  }]);
  const { findings, skipped } = detect(world({
    comments: [TWEAK({ resolved_at: '2026-09-07T12:00:00.000Z' })],
    cards: [CARD({ video_status: 'Client Approval', video_tweaks: onCard })],
  }));
  assert.equal(findings.length, 0);
  assert.equal(skipped.length, 0, 'lifecycles agree, so this is an ordinary delivery match');
});

check('an unresolved request still matches an OPEN entry normally', () => {
  const onCard = JSON.stringify([{
    id: 'cal-open', body: 'Please fix the intro', role: 'client', is_tweak: true, done: false,
  }]);
  const { findings, skipped } = detect(world({
    comments: [TWEAK()], cards: [CARD({ video_status: 'Client Approval', video_tweaks: onCard })],
  }));
  assert.equal(findings.length, 0);
  assert.equal(skipped.length, 0);
});

/* THE SCOPE DECISION, ENFORCED RATHER THAN DOCUMENTED.
   After eight review rounds the owner narrowed this job to stamp repair;
   change-request delivery is detected and reported but never written. The guard
   sits at the write, so no future edit to detection can make delivery writable
   by accident. */
check('only a stamp repair is writable', () => {
  assert.deepEqual([...WRITABLE_KINDS], ['stamp']);
});

check('every delivery finding is marked report-only at the point it is made', () => {
  const { findings: deliveries } = detect(world({
    comments: [TWEAK()], cards: [CARD({ video_status: 'Client Approval' })],
  }));
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].kind, 'comment');
  assert.equal(deliveries[0].writable, false, 'detected, reported, never written');

  const { findings: stamps } = detect(world({ outbox: [APPROVE()] }));
  assert.equal(stamps[0].writable, true);
});

checkAsync('the write itself refuses anything that is not a stamp', async () => {
  for (const kind of ['comment', 'status_only', '', undefined]) {
    await assert.rejects(() => writePatch({ id: 'card-1', client: 'testclient' }, { id: 'card-1' }, kind),
      /writes stamps only/, `a ${kind} repair must be refused at the write`);
  }
});

/* CODEX ROUND 9, ON THE NARROWED JOB. Two P1s landed on the STAMP path, which
   I had described as the simple, stable half — worth recording, because it was
   not as settled as the round-8 argument implied. */

/* move-card-client.js rewrites calendar_posts.client and
   deliverables.client_slug but leaves historical outbox rows on the ORIGINAL
   client. Resolving purely through the deliverable's CURRENT client would stamp
   the new client's card with the previous client's sign-off. */
check('an approval belonging to another client never stamps this one', () => {
  const { findings, skipped } = detect(world({
    outbox: [APPROVE({ client_slug: 'previousclient' })],
    cards: [CARD({ client: 'testclient' })],
  }));
  assert.equal(findings.length, 0);
  assert.equal(skipped[0].reason, 'approval_belongs_to_another_client');
});

/* ROUND 10. The same hole, one table over: production_comments rows also keep
   the client they were written for when a card is moved. Round 9 fixed the
   outbox inline, which is why round 10 found the identical thing in comments —
   so the check now lives in resolve(), once, for every source. */
check('a request belonging to another client is never reported against this one', () => {
  const { findings, skipped } = detect(world({
    comments: [TWEAK({ client_slug: 'previousclient' })],
    cards: [CARD({ client: 'testclient', video_status: 'Client Approval' })],
  }));
  assert.equal(findings.length, 0, 'a cross-client repair instruction is a wrong report');
  assert.equal(skipped[0].reason, 'request_belongs_to_another_client');
});

check('a row whose client column is empty is absent, not conflicting', () => {
  const { findings } = detect(world({ comments: [TWEAK({ client_slug: '' })],
    cards: [CARD({ video_status: 'Client Approval' })] }));
  assert.equal(findings.length, 1, 'legacy rows carry no client and must still resolve');
});

check('an approval whose event client matches is stamped normally', () => {
  const { findings } = detect(world({ outbox: [APPROVE({ client_slug: 'testclient' })] }));
  assert.equal(findings.length, 1);
});

check('an outbox row with no client is not treated as a mismatch', () => {
  const { findings } = detect(world({ outbox: [APPROVE({ client_slug: null })] }));
  assert.equal(findings.length, 1, 'absent is not conflicting; live rows all carry one');
});

/* ROUND 11. Same shape again, a third time: identity taken from ONE side.
   `deliverables.card_id` is plain text with no foreign key, written by one side
   only, so following it alone accepts a card that never named this deliverable
   back. The product's own gate (_prodCrosswalkMismatchFields, index.html)
   requires the full crosswalk and refuses a half-link precisely because acting
   on one destroys data. Live shape when this was added: every calendar-origin
   deliverable carrying a card_id reverse-links correctly, and every
   Samples-origin card_id resolves to no same-client calendar card at all — zero
   rows affected, and one re-link creates one silently, as a WRITE. */
check('a card that does not name the deliverable back is never stamped', () => {
  const { findings, skipped } = detect(world({
    outbox: [APPROVE()],
    cards: [CARD({ video_deliverable_id: 'del-someone-else' })],
  }));
  assert.equal(findings.length, 0, 'a one-way pointer is not a link');
  assert.equal(skipped[0].reason, 'card_does_not_link_back');
});

check('a card with no deliverable link at all is never stamped', () => {
  const { findings, skipped } = detect(world({
    outbox: [APPROVE()],
    cards: [CARD({ video_deliverable_id: null, graphic_deliverable_id: null })],
  }));
  assert.equal(findings.length, 0, 'unknown is treated as not-linked, matching the product gate');
  assert.equal(skipped[0].reason, 'card_does_not_link_back');
});

/* The Samples surface writes its own deliverables with origin='samples'. If one
   ever carries a card_id that names a real same-client calendar card, following
   the pointer would stamp a calendar card from an sxr approval. */
check('a deliverable from another surface never resolves to a calendar card', () => {
  for (const origin of ['samples', 'manual', '', undefined]) {
    const { findings, skipped } = detect(world({
      outbox: [APPROVE()], deliverables: [DEL({ origin })],
    }));
    assert.equal(findings.length, 0, `origin=${origin} must not stamp a calendar card`);
    assert.equal(skipped[0].reason, 'not_a_calendar_deliverable');
  }
});

/* The gate covers the report half too: a cross-linked REPAIR INSTRUCTION is a
   wrong report, and reporting is the whole deliverable for change requests. */
check('a change request on a half-linked card is not reported against it', () => {
  const { findings, skipped } = detect(world({
    comments: [TWEAK()],
    cards: [CARD({ video_status: 'Client Approval', video_deliverable_id: 'del-other' })],
  }));
  assert.equal(findings.length, 0);
  assert.equal(skipped[0].reason, 'card_does_not_link_back');
});

/* `other` is a live kind that this job maps to no component, but its TEAM says
   graphics, so after round 12 it has a defensible slot rather than needing the
   weaker "either slot will do" rule. Refusing it outright would be the
   over-correction. */
check('a kind with no component mapping resolves through its team', () => {
  const { findings, skipped } = detect(world({
    comments: [TWEAK({ component: 'graphic' })],
    deliverables: [DEL({ kind: 'other', team: 'graphics' })],
    cards: [CARD({ graphic_status: 'Client Approval', graphic_deliverable_id: 'del-1' })],
  }));
  assert.equal(skipped.filter(x => x.reason === 'card_does_not_link_back').length, 0,
    'team names the slot when the kind cannot');
  assert.equal(findings.length, 1);
});

/* ROUND 12. I claimed the reverse link subsumed the team half of the crosswalk.
   It does not: `kind` and `team` are independently constrained columns, and the
   slot was derived from `kind`, so a row carrying kind='video' with
   team='graphics' passed on a matching `video_deliverable_id` and would have
   written a client VIDEO stamp. The slot is now derived from TEAM — the app's
   own `_prodCrosswalkTeamForComponent`, inverted — and a kind that maps to a
   different component is refused outright. */
check('a deliverable whose kind and team disagree is never stamped', () => {
  const { findings, skipped } = detect(world({
    outbox: [APPROVE()], deliverables: [DEL({ kind: 'video', team: 'graphics' })],
  }));
  assert.equal(findings.length, 0, 'a row that cannot say which review it belongs to is not a link');
  assert.equal(skipped[0].reason, 'kind_and_team_disagree');
});

check('a deliverable with no usable team is never stamped', () => {
  for (const team of ['', null, undefined, 'design']) {
    const { findings, skipped } = detect(world({
      outbox: [APPROVE()], deliverables: [DEL({ team })],
    }));
    assert.equal(findings.length, 0, `team=${team} must not resolve`);
    assert.equal(skipped[0].reason, 'unknown_team');
  }
});

/* The slot must come from team, not from kind: with team='graphics' the graphic
   slot is the one that has to name it, and a matching VIDEO slot is not a pass.
   HONEST NOTE ON ITS CONTROL: deriving the slot from `kind` instead fails to
   break this suite on its own, because the only rows where the two choices
   differ are exactly the rows the kind/team agreement rule above already
   refuses. Removing BOTH does fail (measured). So this is one rule with two
   expressions, not two independent rules, and it is not counted as a separate
   control — a control that does not fire is treated here as a broken test. */
check('the reverse slot is chosen by team, not by the card that happens to match', () => {
  const { findings, skipped } = detect(world({
    outbox: [APPROVE()], deliverables: [DEL({ kind: 'thumbnail', team: 'graphics' })],
    cards: [CARD({ video_deliverable_id: 'del-1', graphic_deliverable_id: null })],
  }));
  assert.equal(findings.length, 0, 'graphic work linked only through the video slot is not linked');
  assert.equal(skipped[0].reason, 'card_does_not_link_back');
});

/* ROUND 13. Round 12 gave `kind='other'` a defensible component through its
   team, and then the stamp path derived the component from `kind` anyway, got
   nothing, and `continue`d — so a committed client approval on such a card
   produced NEITHER a repair NOR a line in the report. A silent drop is the one
   outcome this job must not have, since the report is what a person acts on.
   The component now travels with the resolution, from the same validated team
   that chose the reverse-link slot. Live: 147 `other` deliverables, zero
   committed client approvals ever, so this writes nothing today. */
check('an approval on a kind with no component mapping stamps through its team', () => {
  const { findings } = detect(world({
    outbox: [APPROVE()],
    deliverables: [DEL({ kind: 'other', team: 'graphics' })],
    cards: [CARD({ video_deliverable_id: null, graphic_deliverable_id: 'del-1' })],
  }));
  assert.equal(findings.length, 1, 'accepted by resolve() but dropped by the caller is a silent loss');
  assert.equal(findings[0].component, 'graphic');
  assert.equal(patchFor(findings[0]).client_graphic_approved_at, '2026-09-05T10:00:00.000Z');
});

/* Nothing this job refuses may leave the report silent: every rejection path
   must put a line in `skipped`, or a person reading the run learns nothing. */
check('every refused approval is reported, never silently dropped', () => {
  const cases = [
    ['not_a_calendar_deliverable', { deliverables: [DEL({ origin: 'samples' })] }],
    ['kind_and_team_disagree', { deliverables: [DEL({ kind: 'video', team: 'graphics' })] }],
    ['unknown_team', { deliverables: [DEL({ team: '' })] }],
    ['card_does_not_link_back', { cards: [CARD({ video_deliverable_id: 'other' })] }],
    ['approval_belongs_to_another_client', { outbox: [APPROVE({ client_slug: 'previousclient' })] }],
  ];
  for (const [reason, over] of cases) {
    const { findings, skipped } = detect(world(Object.assign({ outbox: [APPROVE()] }, over)));
    assert.equal(findings.length, 0, reason);
    assert.equal(skipped.length, 1, reason + ' must produce exactly one report line');
    assert.equal(skipped[0].reason, reason);
  }
});

check('a properly linked card is still stamped normally', () => {
  const { findings } = detect(world({ outbox: [APPROVE()] }));
  assert.equal(findings.length, 1, 'the gate must not refuse the intact live shape');
});

check('a stamp finding carries its deliverable so revalidation can refresh it', () => {
  const { findings } = detect(world({ outbox: [APPROVE()] }));
  assert.equal(findings[0].deliverable_id, 'del-1',
    'without it, revalidation cannot re-read the transitions that decide supersession');
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

/* THE ROUND-1 LESSON, AS A TEST. A fixture sets whatever field it likes, so a
   rule can pass every case here while being INERT in production because the
   real query never fetches the column it reads. That is exactly how the first
   `source_edited_at` fix shipped doing nothing. The crosswalk rule reads three
   columns that were not previously projected, so assert the projections. */
check('the crosswalk columns are actually fetched, in every read', () => {
  const src = require('node:fs')
    .readFileSync(require('node:path').join(__dirname, '../scripts/client-signoff-reconcile.js'), 'utf8');
  /* The selects are written as concatenated string literals for readability;
     join those back together before matching, or this check reads only the
     first fragment and passes on a column that is not there. */
  const joined = src.replace(/'\s*\+\s*'/g, '');
  const selects = joined.match(/select=[^`']*/g) || [];
  const deliverableSelects = selects.filter(q => q.includes('card_id'));
  const cardSelects = selects.filter(q => q.includes('client_video_approved_at'));
  assert.ok(deliverableSelects.length >= 2, 'both the scan and the revalidation read deliverables');
  assert.ok(cardSelects.length >= 2, 'both the scan and the revalidation read cards');
  for (const q of deliverableSelects) {
    assert.match(q, /\borigin\b/, 'origin must be projected: ' + q);
    assert.match(q, /\bteam\b/, 'team must be projected: ' + q);
  }
  for (const q of cardSelects) {
    assert.match(q, /video_deliverable_id/, 'reverse link must be projected: ' + q);
    assert.match(q, /graphic_deliverable_id/, 'reverse link must be projected: ' + q);
  }
});

check('body comparison ignores only whitespace shape', () => {
  assert.equal(normText('  a   b \n c '), 'a b c');
  assert.notEqual(normText('fix the intro'), normText('fix the outro'));
});

(async () => {
  for (const [label, fn] of asyncChecks) { await fn(); checks++; console.log('  ok — ' + label); }
  /* THE RUNBOOK'S COUNT IS PART OF THE SUITE. It went stale within one round of
     being written, and a runbook that publishes a stale count is evidence a
     later session plans against. Asserted last, when the real count is known. */
  {
    const doc = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../docs/ops/CLIENT_SIGNOFF_RECONCILE.md'), 'utf8');
    const m = doc.match(/(\d+) checks/);
    assert.ok(m, 'the runbook must publish a check count');
    checks++;
    assert.equal(Number(m[1]), checks,
      `docs/ops/CLIENT_SIGNOFF_RECONCILE.md says ${m[1]} checks; the suite runs ${checks}`);
    console.log('  ok — the runbook publishes the count this suite actually runs');
  }
console.log(`PASS: ${checks} checks — committed client actions are completed from server evidence, and a card that moved on is never overwritten`);
})();
