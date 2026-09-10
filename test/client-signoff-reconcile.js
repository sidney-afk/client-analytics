'use strict';
/* The server-side completion of a committed client review action
 * (scripts/client-signoff-reconcile.js, OPEN_REPAIRS 196).
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
const { stripComments } = require('./helpers/strip-comments');
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

/* ROUND 42, and a write-correctness finding rather than a report one. The
   house sweep `_calClearStaleApprovals` reads the WHOLE card and clears a stale
   sign-off on every component. That is right in the app, where it runs on a
   save that just moved one; here it meant a stamp repair copied the sweep's
   whole output into the patch and cleared an UNRELATED component's stamp, on
   the strength of a status this job never touched. The check above could not
   see it because its fixture has no stale sibling stamp — the defect lives
   entirely in the state that fixture omits. */
check('a stamp repair never clears another component\'s stamp', () => {
  const { findings } = detect(world({
    outbox: [APPROVE()],
    cards: [CARD({
      status: 'Approved',
      /* A sibling carrying a sign-off while sitting below Client Approval. */
      graphic_status: 'In Progress',
      client_graphic_approved_at: '2026-08-01T10:00:00.000Z',
    })],
  }));
  assert.equal(findings.length, 1);
  const patch = patchFor(findings[0]);
  assert.deepEqual(Object.keys(patch).sort(), ['client_video_approved_at', 'id'],
    'the repair writes its own stamp and nothing else: ' + JSON.stringify(patch));
  assert.ok(!('client_graphic_approved_at' in patch),
    "another component's sign-off is not this repair's to clear");
});

/* THE SWEEP IS NOT DISABLED, ONLY SCOPED. A repair that actually moves a
   component still writes what the sweep decided — that is the app's own rule
   and the reason the sweep is called at all. */
check('a repair that moves a component still applies the house sweep', () => {
  const { findings } = detect(world({
    comments: [TWEAK()],
    cards: [CARD({
      video_status: 'Client Approval',
      client_video_approved_at: '2026-08-01T10:00:00.000Z',
      /* An UNRELATED stale sibling, so this check distinguishes "the sweep
         still runs" from "the sweep is copied wholesale". The first draft of
         this check had no sibling, so narrowing the rule to the target field
         alone still passed it — a control that would not fire, which this PR
         treats as a broken check rather than a redundant one. */
      graphic_status: 'In Progress',
      client_graphic_approved_at: '2026-08-01T10:00:00.000Z',
    })],
  }));
  const patch = patchFor(findings[0]);
  assert.equal(patch.video_status, 'Tweaks Needed');
  assert.equal(patch.client_video_approved_at, '',
    'the component this repair moved just left the round that sign-off belonged to');
  assert.ok(!('client_graphic_approved_at' in patch),
    'a component this repair did not move is still not its business');
});

/* `kasper_approved_at` is not a component stamp: the app clears it when NO
   component is left above, which can only become true because this repair moved
   one. So it travels with a move and never with a stamp repair. Both directions
   are asserted, because the first draft gated it on a set whose branch could
   not be made to fail. */
check('the kasper sign-off follows a move, and only a move', () => {
  const moved = detect(world({
    comments: [TWEAK()],
    cards: [CARD({
      video_status: 'Client Approval', graphic_status: 'In Progress',
      caption_status: 'In Progress', title_status: '',
      kasper_approved_at: '2026-08-01T10:00:00.000Z',
    })],
  }));
  const movedPatch = patchFor(moved.findings[0]);
  assert.equal(movedPatch.video_status, 'Tweaks Needed');
  assert.equal(movedPatch.kasper_approved_at, '',
    'this repair left no component above, so the app clears it');

  /* THE OTHER DIRECTION IS UNREACHABLE, AND THAT IS THE POINT. A stamp repair
     requires its own component to be ABOVE (stampSurvives), and the app clears
     this field only when NO component is above — so the sweep can never clear
     it on a stamp repair. A first draft guarded the branch on `movedComponent`
     anyway; the sabotage removing that guard could not be made to fail, which
     this PR reads as decoration rather than safety (196u). Asserted as
     reachability instead of as a vacuous "does not write it". */
  const still = detect(world({
    outbox: [APPROVE()],
    cards: [CARD({ status: 'Approved', kasper_approved_at: '2026-08-01T10:00:00.000Z' })],
  }));
  const stampPatch = patchFor(still.findings[0]);
  assert.deepEqual(Object.keys(stampPatch).sort(), ['client_video_approved_at', 'id'],
    'the stamp repair writes its own stamp only, so the question never arises');
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

/* ROUND 36. The renderer hides on TRUTHY `deleted` and exempts `canonical`;
   this predicate tested `deleted === true`, which refuses less than the app
   hides and more. Live every tombstone is boolean and no canonical entry is
   deleted, so no current row moves — the point is that the predicate stops
   drifting from the one it mirrors. */
check('a truthy non-boolean tombstone cannot be a delivery', () => {
  for (const tomb of [1, 'true', 'yes']) {
    const entry = { id: 'x', body: 'Please fix the intro', role: 'client', deleted: tomb };
    const { findings } = detect(world({
      comments: [TWEAK()],
      cards: [CARD({ video_status: 'Client Approval', video_tweaks: JSON.stringify([entry]) })],
    }));
    assert.equal(findings.length, 1,
      `deleted: ${JSON.stringify(tomb)} is hidden by the renderer and must not count as delivery`);
  }
});

check('a canonical entry survives its tombstone, as the renderer lets it', () => {
  const entry = { id: 'x', body: 'Please fix the intro', role: 'client',
    deleted: true, canonical: true };
  const { findings } = detect(world({
    comments: [TWEAK()],
    cards: [CARD({ video_status: 'Client Approval', video_tweaks: JSON.stringify([entry]) })],
  }));
  assert.equal(findings.length, 0,
    'the renderer shows a canonical entry despite deleted, so it can be the delivery');
});

/* ROUND 37. `_calCommentsForView` compares `c.role === 'kasper'` exactly, and
   `_calMsgAudience` compares the role exactly too, so a `role: "Kasper"` entry
   with no explicit audience IS shown to the client. Normalizing the role here
   refused an entry the client can read, which would report a delivered request
   as absent and send an operator to duplicate it. Live every role is an exact
   lowercase string, so no current row moves. */
check('a role variant the renderer still shows counts as delivered', () => {
  for (const role of ['Kasper', ' kasper ', 'KASPER']) {
    const entry = { id: 'x', body: 'Please fix the intro', role };
    const { findings } = detect(world({
      comments: [TWEAK()],
      cards: [CARD({ video_status: 'Client Approval', video_tweaks: JSON.stringify([entry]) })],
    }));
    assert.equal(findings.length, 0,
      `role ${JSON.stringify(role)} is client-visible in the app, so it can be the delivery`);
  }
});

check('the exact renderer role still hides, on both claim passes', () => {
  const byBody = { id: 'x', body: 'Please fix the intro', role: 'kasper', audience: 'client' };
  const byId = { id: 'pc_x1', body: 'Please fix the intro', role: 'kasper', audience: 'client' };
  for (const entry of [byBody, byId]) {
    const { findings } = detect(world({
      comments: [TWEAK()],
      cards: [CARD({ video_status: 'Client Approval', video_tweaks: JSON.stringify([entry]) })],
    }));
    assert.equal(findings.length, 1,
      'an exact kasper role is hard-excluded by the renderer even with audience client');
  }
});

/* THE STRUCTURAL CHECK, and the actual lesson of rounds 32 to 37: the two claim
   passes must not each carry their own copy of the renderer's rules. Six rounds
   were spent on copies drifting from the original and from each other. */
check('both claim passes share one visibility definition', () => {
  const src = require('node:fs')
    .readFileSync(require('node:path').join(__dirname, '../scripts/client-signoff-reconcile.js'), 'utf8');
  /* Strip comments first: this file explains the rule in prose right above it,
     and a prose mention is not a second implementation. Stripped with the shared
     helper, never the raw regex — OPEN_REPAIRS 145: `/\*[\s\S]*?\*\//` opens a
     comment at any "/" followed by "*", including inside a string or a MIME
     type, and deletes to the next delimiter anywhere in the file. A negative
     assertion over a region that has been deleted passes vacuously, which is
     exactly the failure mode this check exists to prevent. */
  const code = stripComments(src);
  const roleTests = code.match(/role[^\n]*===\s*'kasper'/g) || [];
  assert.equal(roleTests.length, 1,
    'the Kasper exclusion must be written once, not once per pass: ' + JSON.stringify(roleTests));
  const audience = code.match(/_calMsgAudience\((?:root|entry|c)\)\s*===\s*'client'/g) || [];
  assert.equal(audience.length, 1,
    'the audience rule must be written once, not once per pass: ' + JSON.stringify(audience));
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

/* ROUND 16, AND THE REASON IT IS THE MOST IMPORTANT CHECK IN THIS FILE.
   Extracting the summary left `main()` referring to bucket names that no longer
   existed in its scope, so EVERY run — dry-run and apply alike — died with
   `ReferenceError: ambiguous is not defined` before writing anything. All 83
   offline checks passed and CI was green, because not one of them ran the entry
   point. A suite that never executes the program cannot tell you the program
   runs. This drives the real CLI, in a real process, over fixtures. */
checkAsync('the entry point actually runs, end to end, and reports what it found', async () => {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
  const fixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'csr-')), 'world.json');
  fs.writeFileSync(fixture, JSON.stringify({
    outbox: [APPROVE(), APPROVE({ entity_id: 'del-2', status: 'stale' }),
      APPROVE({ entity_id: 'del-3', status: 'pending' })],
    comments: [],
    deliverables: [DEL(), DEL({ id: 'del-2', card_id: 'card-2' }),
      DEL({ id: 'del-3', card_id: 'card-3' })],
    cards: [CARD(), CARD({ id: 'card-2', video_deliverable_id: 'del-2' }),
      CARD({ id: 'card-3', video_deliverable_id: 'someone-else' })],
  }));
  const out = execFileSync(process.execPath,
    [path.join(__dirname, '../scripts/client-signoff-reconcile.js'), `--fixtures=${fixture}`],
    { encoding: 'utf8' });
  assert.match(out, /REPAIRS \(written on --apply\): 1 sign-off stamp\(s\)/, out);
  assert.match(out, /NEEDS A PERSON \(never written\): 2\b/, out);
  /* The per-row line, not just the count: a count with no rows tells the
     operator that one approval needs attention and nothing about which one. */
  /* The client is part of the row: calendar_posts is keyed by (client, id) and
     13 live ids are shared across clients, so a card id alone does not say
     whose approval was lost. */
  assert.match(out, /card card-2 \(testclient\) \[video\] a client APPROVE reached neither leg/, out);
  /* Every finding line names its client too: 13 live card ids are shared across
     clients, so a bare id does not say whose card to open. */
  assert.match(out, /· card card-1 \(testclient\) \[video\] sign-off stamp missing/, out);
  assert.match(out, /carrier stale/, out);
  /* And the unresolvable one names what it could not resolve, or the operator
     has nothing to look up. */
  assert.match(out, /deliverable del-3 a client APPROVE was not carried/, out);
  /* A stale link prints as a stale link. The fixture's del-3 card names someone
     else, so the card IS found and only the link back failed. */
  assert.equal(/card-3.*cannot be found/.test(out), false, out);
  assert.match(out, /whether the card leg landed is UNKNOWN/, out);
  assert.match(out, /card_does_not_link_back/, out);
});

/* A dry run must never reach the write path, and the entry point is where that
   is actually decided. Asserted through the CLI for the same reason as above. */
/* ROUND 20, second finding. A crosswalk refusal was produced BEFORE the
   `--client` scope was applied, so a run advertised as limited to one client
   still reported other clients' rows and counted them — sending the operator to
   investigate work outside the scope they asked for. Driven through the CLI
   because the scope is read from the environment at module load. */
checkAsync('a client-scoped run reports nothing outside that client', async () => {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
  const fixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'csr-')), 'world.json');
  fs.writeFileSync(fixture, JSON.stringify({
    /* Every row here belongs to testclient, and two of them are broken in ways
       that WOULD be reported on an unscoped run. */
    outbox: [APPROVE(), APPROVE({ entity_id: 'del-3', status: 'pending' })],
    comments: [],
    deliverables: [DEL(), DEL({ id: 'del-3', card_id: 'card-3' })],
    cards: [CARD(), CARD({ id: 'card-3', video_deliverable_id: 'someone-else' })],
  }));
  const out = execFileSync(process.execPath,
    [path.join(__dirname, '../scripts/client-signoff-reconcile.js'), `--fixtures=${fixture}`],
    { encoding: 'utf8', env: Object.assign({}, process.env, { ONLY_CLIENT: 'someotherclient' }) });
  assert.match(out, /REPAIRS \(written on --apply\): 0 sign-off stamp\(s\)/, out);
  assert.match(out, /NEEDS A PERSON \(never written\): 0\b/, out);
  assert.equal(/testclient|card-1|card-3|del-3/.test(out), false,
    'a scoped run must not name another client\'s rows: ' + out);
});

/* ROUND 21, second finding. After `move-card-client.js`, historical outbox rows
   still carry the PREVIOUS client while the deliverable carries the new one.
   Scoping on the deliverable put the old client's rows in the NEW client's run
   and hid them from their own — the opposite of row-owned scope, which is what
   the comment beside it claimed. */
checkAsync('a moved row is scoped by its own client, not the deliverable\'s', async () => {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
  const fixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'csr-')), 'world.json');
  /* The deliverable has moved to newclient; the approval row still carries
     oldclient, which is whose approval it was. */
  fs.writeFileSync(fixture, JSON.stringify({
    outbox: [APPROVE({ client_slug: 'oldclient' })], comments: [],
    deliverables: [DEL({ client_slug: 'newclient' })],
    cards: [CARD({ client: 'newclient' })],
  }));
  const run = (client) => execFileSync(process.execPath,
    [path.join(__dirname, '../scripts/client-signoff-reconcile.js'), `--fixtures=${fixture}`],
    { encoding: 'utf8', env: Object.assign({}, process.env, { ONLY_CLIENT: client }) });
  assert.match(run('oldclient'), /del-1/, 'the row belongs to the client it names');
  assert.equal(/del-1/.test(run('newclient')), false,
    'the new owner did not ask about the previous client\'s historical rows');
});

/* ROUND 28. The contradiction row knows its card, so the shared renderer saying
   "its card cannot be found" sent the operator after a broken crosswalk instead
   of the actual question: which of two known reviews the client meant. */
checkAsync('a component contradiction is described as an ambiguity, not a missing card', async () => {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
  const fixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'csr-')), 'world.json');
  fs.writeFileSync(fixture, JSON.stringify({
    outbox: [], comments: [TWEAK({ component: 'video' })],
    deliverables: [DEL({ kind: 'thumbnail', team: 'graphics' })],
    cards: [CARD({ video_deliverable_id: null, graphic_deliverable_id: 'del-1',
      graphic_status: 'Client Approval', video_status: 'Client Approval' })],
  }));
  const out = execFileSync(process.execPath,
    [path.join(__dirname, '../scripts/client-signoff-reconcile.js'), `--fixtures=${fixture}`],
    { encoding: 'utf8' });
  assert.match(out, /card card-1 \(testclient\) request pc_x1 names \[video\]/, out);
  assert.match(out, /linked as \[graphic\]/, out);
  assert.equal(/cannot be found/.test(out), false, 'the card is known: ' + out);
  assert.match(out, /NEEDS A PERSON \(never written\): 1\b/, out);
});

checkAsync('a dry run writes nothing, proven through the entry point', async () => {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
  const fixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'csr-')), 'world.json');
  fs.writeFileSync(fixture, JSON.stringify({
    outbox: [APPROVE()], comments: [], deliverables: [DEL()], cards: [CARD()],
  }));
  const out = execFileSync(process.execPath,
    [path.join(__dirname, '../scripts/client-signoff-reconcile.js'), `--fixtures=${fixture}`],
    { encoding: 'utf8' });
  assert.match(out, /DRY-RUN/, out);
  assert.equal(/→ wrote|applied 1/.test(out), false, 'a dry run must not report a write');
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
/* ROUND 22 changed this from a reported refusal to a SILENT skip, and moved it
   ahead of the card lookup. A Samples deliverable's card is not missing — it
   lives on the Samples surface, which this job does not read — so escalating it
   as a lost Calendar approval is a false alert, and false alerts bury the real
   ones. Live: 2 of the 227 committed client approvals are Samples, and both were
   being reported as lost. */
check('a deliverable from another surface is out of scope, silently', () => {
  for (const origin of ['samples', 'manual', '', undefined]) {
    const { findings, skipped } = detect(world({
      outbox: [APPROVE()], deliverables: [DEL({ origin })],
    }));
    assert.equal(findings.length, 0, `origin=${origin} must not stamp a calendar card`);
    assert.equal(skipped.length, 0, `origin=${origin} is another surface, not a broken crosswalk`);
  }
});

/* The ORDER is the fix: with no calendar card present at all, a Samples
   deliverable must still be silent rather than reported as card_not_found. */
check('another surface is decided before the calendar card is looked up', () => {
  const { findings, skipped } = detect(world({
    outbox: [APPROVE()], deliverables: [DEL({ origin: 'samples' })], cards: [],
  }));
  assert.equal(findings.length, 0);
  assert.equal(skipped.length, 0, 'its card is on another surface, not missing');
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

/* ROUND 14. Round 13's contract — every refused approval appears in the report —
   did not reach the narrow write filter, which exited before any reporting.
   A client approval whose carrier never wrote is exactly what an operator is
   hunting when BOTH legs failed, and silence there reads as "nothing to
   investigate". The write policy is unchanged; only the report grew.
   Live: 5 such rows, 4 already stamped (noise), 1 a genuinely lost approval
   this job named nowhere. */
check('an approval whose carrier never wrote is reported, never written', () => {
  for (const carrier of ['pending', 'skipped', 'stale', 'failed', '']) {
    const { findings, skipped } = detect(world({ outbox: [APPROVE({ status: carrier })] }));
    assert.equal(findings.length, 0, `carrier=${carrier} must never produce a write`);
    assert.equal(skipped.length, 1, `carrier=${carrier} must produce a report line`);
    assert.equal(skipped[0].reason, 'carrier_did_not_write');
    assert.equal(skipped[0].component, 'video');
  }
});

/* The four-of-five case: an approval the carrier never wrote, on a card that
   already carries the stamp, is not a lead — it is noise in a report a person
   has to read. */
check('an unwritten approval on an already-stamped card is not reported', () => {
  const { findings, skipped } = detect(world({
    outbox: [APPROVE({ status: 'stale' })],
    cards: [CARD({ client_video_approved_at: '2026-09-04T00:00:00.000Z' })],
  }));
  assert.equal(findings.length, 0);
  assert.equal(skipped.length, 0, 'a report nobody can act on is worse than a shorter report');
});

/* ROUND 15. The round-14 report ran BEFORE the supersession checks, so a
   sign-off that is missing on purpose — reopened after the client approved, or
   on a component that has since moved below Approved — produced an
   actionable-looking "lost approval". A false lead in a report a person reads is
   the same class of harm as a false repair. The unwritten candidates now go
   through the same two tests as the written ones. */
check('a superseded approval whose carrier never wrote is not reported as lost', () => {
  const reopen = { entity_id: 'del-1', entity: 'deliverable', operation: 'status', status: 'pending',
    role: 'designer', payload: { status: 'tweak' }, source_edited_at: '2026-09-06T10:00:00.000Z',
    created_at: '2026-09-06T10:00:00.000Z', test_only: false };
  const { findings, skipped } = detect(world({ outbox: [APPROVE({ status: 'stale' }), reopen] }));
  assert.equal(findings.length, 0);
  assert.equal(skipped.length, 0, 'a stamp absent by design is not a lost approval');
});

check('a carrier failure on a component that moved on is not reported as lost', () => {
  const { findings, skipped } = detect(world({
    outbox: [APPROVE({ status: 'skipped' })],
    cards: [CARD({ video_status: 'Tweaks Needed' })],
  }));
  assert.equal(findings.length, 0);
  assert.equal(skipped.length, 0);
});

/* A written approve for the same review is the operative one; the unwritten row
   must not also raise a lead against the repair that is about to be made. */
check('a written approve for the same review supersedes the unwritten report', () => {
  const { findings, skipped } = detect(world({
    outbox: [APPROVE({ status: 'stale', source_edited_at: '2026-09-04T10:00:00.000Z' }), APPROVE()],
  }));
  assert.equal(findings.length, 1, 'the written approve is still repaired');
  assert.equal(skipped.filter(x => x.reason === 'carrier_did_not_write').length, 0);
});

/* ROUND 16. The suppression key names a (card, component), not a review. An
   older WRITTEN approve, then a reopen, then a NEWER client approve whose
   carrier failed: the old written one is rejected by the reopen test, and its
   mere presence in the key suppressed the new one — so the current loss was
   reported nowhere. Compare the clocks, not the presence of a key. */
check('an older written approve does not suppress a newer lost one', () => {
  const reopen = { entity_id: 'del-1', entity: 'deliverable', operation: 'status', status: 'written',
    role: 'designer', payload: { status: 'tweak' }, source_edited_at: '2026-09-06T00:00:00.000Z',
    created_at: '2026-09-06T00:00:00.000Z', test_only: false };
  const { findings, skipped } = detect(world({
    outbox: [
      APPROVE({ source_edited_at: '2026-09-05T00:00:00.000Z', created_at: '2026-09-05T00:00:00.000Z' }),
      reopen,
      APPROVE({ status: 'stale', source_edited_at: '2026-09-07T00:00:00.000Z',
        created_at: '2026-09-07T00:00:00.000Z' }),
    ],
  }));
  assert.equal(findings.length, 0, 'the old written approve is superseded by the reopen');
  assert.equal(skipped.filter(x => x.reason === 'carrier_did_not_write').length, 1,
    'the newer lost approval must still be reported');
});

/* ROUND 17. A client change request commits its comment leg and its status leg
   SEPARATELY. When the status leg fails there is no transition for the reopen
   test to find, and the card can still read Approved — so an apply run would
   restore the older sign-off while the same run reported the newer request as
   `review_round_closed`. Two halves of one contradiction, and the falsest
   positive this job could produce: claiming a client signed off on work they
   had asked to change. Live: none of the four repair candidates has a later
   client request, so this changes no repair today. */
check('a client request after the approval blocks the stamp', () => {
  const { findings, skipped } = detect(world({
    outbox: [APPROVE()],
    comments: [TWEAK({ created_at: '2026-09-06T10:00:00.000Z' })],
    cards: [CARD({ video_status: 'Approved' })],
  }));
  assert.equal(findings.filter(f => f.kind === 'stamp').length, 0,
    'the card reads Approved, and the client has since asked for changes');
  assert.equal(skipped.some(x => x.reason === 'superseded_by_later_client_request'), true);
});

check('a client request BEFORE the approval does not block it', () => {
  const { findings } = detect(world({
    outbox: [APPROVE()],
    comments: [TWEAK({ created_at: '2026-09-04T10:00:00.000Z' })],
  }));
  assert.equal(findings.filter(f => f.kind === 'stamp' && f.writable).length, 1,
    'approving after asking for changes is the normal flow');
});

/* The unwritten path shares the rule: a lost approval the client has since
   superseded is not a lead either. */
check('a superseded lost approval is not reported as needing a person', () => {
  const { skipped } = detect(world({
    outbox: [APPROVE({ status: 'stale' })],
    comments: [TWEAK({ created_at: '2026-09-06T10:00:00.000Z' })],
  }));
  assert.equal(skipped.some(x => x.reason === 'carrier_did_not_write'), false);
});

/* The unwritten branch accepted only RESOLVED rows and then continued, so an
   approval that failed both delivery legs AND has a stale crosswalk appeared in
   neither findings nor skipped — the rows where nothing else in the system names
   the approval either. The written path reported these all along. */
check('a lost approval that cannot resolve a card is still reported', () => {
  for (const [over, reason] of [
    [{ cards: [CARD({ video_deliverable_id: 'other' })] }, 'card_does_not_link_back'],
    [{ deliverables: [DEL({ team: '' })] }, 'unknown_team'],
  ]) {
    const { skipped } = detect(world(Object.assign({ outbox: [APPROVE({ status: 'pending' })] }, over)));
    assert.equal(skipped.length, 1, reason + ' must not vanish on the unwritten path');
    /* ROUND 38. Both refusals are raised AFTER resolve() located the card, so
       the reason may not say the card is unknown while the row prints it. What
       is unknown is the card LEG, which is what still forbids "reached neither
       leg" here and keeps the row in the same bucket. */
    assert.equal(skipped[0].reason, 'carrier_did_not_write_and_crosswalk_refused');
    assert.equal(skipped[0].card, 'card-1', 'the card was located; the crosswalk is what refused');
    assert.equal(skipped[0].refusal, reason);
    assert.equal(skipped[0].deliverable, 'del-1', 'the row must name what it could not resolve');
  }
});

/* ROUND 18. Round 17 made committed client requests a fifth source detection
   reads, and revalidation kept refreshing four. The doc's own rule is that
   revalidation refreshes EVERY source detection uses or it is validating
   against a partial snapshot — written down, then not applied, for the fifth
   time in this PR. A request committing between loadWorld and the write, whose
   own status leg then fails, leaves the fresh card reading Approved with no
   reopen in the refreshed outbox, and the stamp goes back over it.

   Asserted against the SOURCE, like the projections check, because the failure
   mode is a read that never happens — a fixture cannot show you a query the
   code does not make. */
check('revalidation refreshes every source detection reads', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../scripts/client-signoff-reconcile.js'), 'utf8');
  const body = src.slice(src.indexOf('async function revalidate('),
    src.indexOf('async function writePatch('));
  for (const [table, why] of [
    ['calendar_posts', 'the card'],
    ['deliverables', 'the crosswalk, mid card-move'],
    ['mirror_outbox', 'a reopen that landed after the scan'],
    ['production_comments', 'a client request that landed after the scan'],
  ]) {
    assert.ok(body.includes(`restRows('${table}'`), `revalidation must re-read ${table} (${why})`);
  }
  /* Keyed to the deliverable, not the one comment id: the stamp path has no
     finding.comment, which is exactly how the fifth source was missed. */
  assert.match(body, /deliverable_id=eq\.\$\{encodeURIComponent\(finding\.deliverable_id\)\}/,
    'client requests must be refreshed for stamp findings, which carry no comment');
});

/* The crosswalk-refusal rows landed under "left alone (a card that moved on is
   never overwritten)", which is the opposite of what they are: both delivery
   legs failed AND the crosswalk is stale, so nothing else names that approval.
   Bucketed on the carrier status the row carries rather than on the reason, so
   a future refusal reason cannot silently fall out again. */
check('a lost approval that could not resolve a card counts as needing a person', () => {
  const { classify } = require('../scripts/client-signoff-reconcile.js');
  const { carrierFailed, leftAlone, lines } = classify({ findings: [], skipped: [
    { kind: 'stamp', reason: 'carrier_did_not_write_and_card_unknown',
      refusal: 'card_does_not_link_back', carrier_status: 'pending',
      card: '(unidentified)', deliverable: 'del-9', component: '' },
    { kind: 'stamp', reason: 'superseded_status', card: 'card-2', component: 'video' },
  ] });
  assert.equal(carrierFailed.length, 1, 'a refusal on the unwritten path is carrier-failure work');
  assert.equal(leftAlone.length, 1);
  /* Counted under the UNKNOWN term, not "reached neither leg": only the carrier
     failure is established here, and the headline must not assert the leg the
     detail line explicitly calls unknown. */
  assert.match(lines.find(l => l.startsWith('NEEDS A PERSON')), /card leg unknown 1/);
  assert.match(lines.find(l => l.startsWith('NEEDS A PERSON')), /reached neither leg 0/);
});

/* ROUND 19. The refusal row claimed the approval "reached neither leg" — but the
   four qualifying tests (stamp already present, later reopen, later client
   request, current status) ALL need a card, and this row has none. Asserting
   their conclusion anyway sends the operator after a loss that may not exist.
   The row is kept, since nothing else in the system names that approval, and
   its claim is narrowed to what is known. */
check('a lost approval with no identifiable card does not claim the card leg failed', () => {
  /* ROUND 38 CORRECTED THIS FIXTURE'S PREMISE. It used `unknown_team` as the
     case that "genuinely identifies no card" — but resolve() looks the card up
     BEFORE the team mapping, so that refusal always had one and the check was
     asserting a belief the code order contradicted. The case that truly
     identifies no card is one where the lookup itself fails. */
  const { skipped } = detect(world({
    outbox: [APPROVE({ status: 'pending' })],
    deliverables: [DEL({ card_id: 'no-such-card' })],
  }));
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].reason, 'carrier_did_not_write_and_card_unknown');
  assert.equal(skipped[0].refusal, 'card_not_found');
  assert.equal(skipped[0].card, '(unidentified)', 'not "(unlinked)": the claim is about knowledge');
});

/* ROUND 30. resolve() had already located the exact (client, id) card before
   refusing on the reverse link, and returning a bare string threw that identity
   away — so the row printed "its card cannot be found" about a card sitting
   right there, sending an operator after a missing-card problem that does not
   exist. The refusal carries the card it found. */
check('a stale reverse link names the card it found', () => {
  const { skipped } = detect(world({
    outbox: [APPROVE({ status: 'pending' })],
    cards: [CARD({ video_deliverable_id: 'other' })],
  }));
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].reason, 'carrier_did_not_write_and_crosswalk_refused');
  assert.equal(skipped[0].card, 'card-1', 'the card was located; only the link failed');
  assert.equal(skipped[0].client, 'testclient');
});

check('a written approve on a half-linked card names the card too', () => {
  const { skipped } = detect(world({
    outbox: [APPROVE()], cards: [CARD({ video_deliverable_id: 'other' })],
  }));
  assert.equal(skipped[0].reason, 'card_does_not_link_back');
  assert.equal(skipped[0].card, 'card-1');
  assert.equal(skipped[0].client, 'testclient');
});

/* Deliberately NOT done, and recorded so the next session meets the decision
   rather than rediscovering it: following the half-link to read the stamp
   anyway would let a mis-linked card SUPPRESS a real loss, and it is the exact
   trust the crosswalk gate exists to refuse. A resolvable row still gets all
   four tests — that path is unchanged. */
check('a resolvable carrier failure still gets the full qualification', () => {
  const { skipped } = detect(world({
    outbox: [APPROVE({ status: 'stale' })],
    cards: [CARD({ client_video_approved_at: '2026-09-04T00:00:00.000Z' })],
  }));
  assert.equal(skipped.length, 0, 'an already-stamped card is not a lost approval');
});

/* ROUND 20. `null` from resolve() meant two opposite things: "deliberately out
   of scope" (archived, another client on a scoped run) and "the crosswalk is
   structurally broken" (deliverable missing, no card id, no client, card gone).
   Both vanished. The second is a lost client approval nobody will hear about.
   From here `null` means only the first, and every structural failure names
   itself. Live: 0 unwritten approvals hit these today; 2 written ones name a
   card that is not there, and they were silent until now. */
check('a structurally broken crosswalk is reported, not silently dropped', () => {
  for (const [over, reason] of [
    [{ deliverables: [] }, 'deliverable_unknown'],
    [{ deliverables: [DEL({ card_id: '' })] }, 'deliverable_names_no_card'],
    [{ deliverables: [DEL({ client_slug: '' })] }, 'deliverable_names_no_client'],
    [{ cards: [] }, 'card_not_found'],
  ]) {
    for (const carrier of ['written', 'pending']) {
      const { findings, skipped } = detect(world(Object.assign(
        { outbox: [APPROVE({ status: carrier })] }, over)));
      assert.equal(findings.length, 0, reason);
      assert.equal(skipped.length, 1, `${reason} must be reported on the ${carrier} path`);
      assert.equal(skipped[0].reason === reason
        || skipped[0].refusal === reason, true, JSON.stringify(skipped[0]));
    }
  }
});

/* An archived card is a DECISION, not a breakage. It must stay silent, or the
   report fills with rows nobody intends to act on and the real ones drown. */
check('an archived card stays out of the report entirely', () => {
  for (const carrier of ['written', 'pending']) {
    const { findings, skipped } = detect(world({
      outbox: [APPROVE({ status: carrier })], cards: [CARD({ status: 'Archived' })],
    }));
    assert.equal(findings.length, 0);
    assert.equal(skipped.length, 0, 'archived is deliberate, not a lost approval');
  }
});

/* ROUND 21. The structural failures round 20 surfaced landed in `left alone`
   with no identity, printing as `card (unlinked) [] left alone: card_not_found`
   — indistinguishable rows an operator cannot act on, which is exactly what
   round 20 set out to prevent. They are WORK, in their own bucket: the carrier
   WROTE, so this is not a carrier failure, and the card is missing, so it is
   not a card that moved on. */
check('a carried approve whose card is missing is operator work, with identity', () => {
  const { classify } = require('../scripts/client-signoff-reconcile.js');
  const { skipped } = detect(world({
    outbox: [APPROVE({ client_slug: 'testclient' })], cards: [],
  }));
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].reason, 'card_not_found');
  assert.equal(skipped[0].deliverable, 'del-1', 'the operator needs something to look up');
  assert.equal(skipped[0].client, 'testclient');
  assert.equal(skipped[0].carrier_status, undefined, 'the carrier wrote; do not claim otherwise');
  const { crosswalkBroken, leftAlone, carrierFailed, lines } = classify({ findings: [], skipped });
  assert.equal(crosswalkBroken.length, 1);
  assert.equal(carrierFailed.length, 0, 'a written approve is not a carrier failure');
  assert.equal(leftAlone.length, 0, 'this is not a card that moved on');
  assert.match(lines.find(l => l.startsWith('NEEDS A PERSON')), /card is missing 1/);
});

/* A cross-client row is a different thing: the card exists and belongs to
   someone else, so it stays out of the actionable bucket. */
check('a cross-client approval is not counted as a broken crosswalk', () => {
  const { classify } = require('../scripts/client-signoff-reconcile.js');
  const { skipped } = detect(world({
    outbox: [APPROVE({ client_slug: 'previousclient' })], cards: [CARD({ client: 'testclient' })],
  }));
  assert.equal(skipped[0].reason, 'approval_belongs_to_another_client');
  assert.equal(classify({ findings: [], skipped }).crosswalkBroken.length, 0);
});

/* ROUND 23. Two consistency failures in rows the last four rounds made
   actionable: the identity and the headline. */

/* The unwritten refusal discarded the EVENT's client while the renderer already
   printed one. After a card move the deliverable's client and the approval's
   differ, so the line named a deliverable and an unidentified card and never
   said whose approval failed. */
check('an unresolved lost approval names the client whose approval it was', () => {
  const { skipped } = detect(world({
    outbox: [APPROVE({ status: 'pending', client_slug: 'oldclient' })],
    deliverables: [DEL({ client_slug: 'testclient' })],
    cards: [CARD({ video_deliverable_id: 'other' })],
  }));
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].client, 'oldclient',
    "the row belongs to whoever approved, not to the deliverable's current owner");
  assert.equal(skipped[0].deliverable, 'del-1');
});

/* The headline counted both shapes as "reached neither leg" while the detail
   line for one of them said the card leg is UNKNOWN. A summary that asserts
   what the detail explicitly disclaims is the round-19 defect one level up. */
check('the headline does not assert a card leg the detail calls unknown', () => {
  const { classify } = require('../scripts/client-signoff-reconcile.js');
  const { lines, carrierFailedKnown, carrierFailedUnknownCard } = classify({ findings: [], skipped: [
    { kind: 'stamp', reason: 'carrier_did_not_write', carrier_status: 'stale',
      card: 'card-1', client: 'testclient', component: 'video' },
    { kind: 'stamp', reason: 'carrier_did_not_write_and_card_unknown', refusal: 'unknown_team',
      carrier_status: 'pending', card: '(unidentified)', deliverable: 'del-9', component: '' },
  ] });
  assert.equal(carrierFailedKnown.length, 1);
  assert.equal(carrierFailedUnknownCard.length, 1);
  const needs = lines.find(l => l.startsWith('NEEDS A PERSON'));
  assert.match(needs, /reached neither leg 1/, needs);
  assert.match(needs, /card leg unknown 1/, needs);
  assert.match(needs, /NEEDS A PERSON \(never written\): 2\b/, needs);
});

/* ROUND 24. A written approve followed by a NEWER committed approve whose
   carrier did not write: the repair used the older time, so an apply run would
   stamp an obsolete moment while the same run reported the newer one as lost.

   The fix is NOT to suppress the repair. Measured on live data, all three such
   pairs are a client re-clicking about two seconds later after the
   `operation_forbidden` error — OPEN_REPAIRS 189's own incident, and one of them
   is the card this job was written for. Suppressing would have discarded that
   repair. It is the same event, not a new decision, so the CLOCK moves and the
   repair stands. */
check('the stamp carries the latest committed approval, written or not', () => {
  const { findings, skipped } = detect(world({
    outbox: [
      APPROVE({ source_edited_at: '2026-09-05T10:00:00.000Z', created_at: '2026-09-05T10:00:00.000Z' }),
      APPROVE({ status: 'skipped', source_edited_at: '2026-09-05T10:00:02.000Z',
        created_at: '2026-09-05T10:00:02.000Z' }),
    ],
  }));
  assert.equal(findings.length, 1, 'a re-click two seconds later is not a supersession');
  assert.equal(findings[0].stamp_at, '2026-09-05T10:00:02.000Z', 'the later act is the operative one');
  assert.equal(skipped.some(x => x.reason === 'carrier_did_not_write'), false,
    'the run must not report as lost the event it is about to stamp');
});

/* THE ASYMMETRY SURVIVES. An unwritten approve may correct the clock; it must
   never rescue a stamp that a reopen has already refused, because a written
   approve is the only evidence narrow enough to repair on. */
check('a later unwritten approve cannot rescue a stamp a reopen refused', () => {
  const reopen = { entity_id: 'del-1', entity: 'deliverable', operation: 'status', status: 'written',
    role: 'designer', payload: { status: 'tweak' }, source_edited_at: '2026-09-06T00:00:00.000Z',
    created_at: '2026-09-06T00:00:00.000Z', test_only: false };
  const { findings, skipped } = detect(world({
    outbox: [
      APPROVE({ source_edited_at: '2026-09-05T00:00:00.000Z', created_at: '2026-09-05T00:00:00.000Z' }),
      reopen,
      APPROVE({ status: 'stale', source_edited_at: '2026-09-07T00:00:00.000Z',
        created_at: '2026-09-07T00:00:00.000Z' }),
    ],
  }));
  assert.equal(findings.length, 0, 'the written approve is superseded; the unwritten one cannot repair');
  assert.equal(skipped.filter(x => x.reason === 'carrier_did_not_write').length, 1,
    'and the newer loss is still reported');
});

/* The ambiguity gate used a bare body match while the fallback beside it applies
   `couldBeClientTweak`. A staff note, reply or deleted entry sharing the wording
   cannot be a delivery of the client's request, so calling it an ambiguous
   repeat tells the operator duplication is possible when the request is simply
   absent — two answers from the same facts, one line apart. */
check('a completed STAFF twin is not an ambiguous repeat', () => {
  const onCard = JSON.stringify([
    { id: 'cal-1', body: 'Please fix the intro', done: true, role: 'kasper' },
  ]);
  const { findings, skipped } = detect(world({
    comments: [TWEAK()],
    cards: [CARD({ video_status: 'Client Approval', video_tweaks: onCard })],
  }));
  assert.equal(skipped.some(x => x.reason === 'ambiguous_repeat_of_completed_request'), false,
    'a staff note cannot be a delivery of the client\'s request');
  assert.equal(findings.length, 1, 'the request is absent, and is reported as such');
});

check('a completed CLIENT twin is still an ambiguous repeat', () => {
  const onCard = JSON.stringify([
    { id: 'cal-1', body: 'Please fix the intro', done: true, role: 'client' },
  ]);
  const { skipped } = detect(world({
    comments: [TWEAK()],
    cards: [CARD({ video_status: 'Client Approval', video_tweaks: onCard })],
  }));
  assert.equal(skipped.some(x => x.reason === 'ambiguous_repeat_of_completed_request'), true);
});

/* ROUND 25. The same two defects rounds 21 and 23 fixed on the stamp path,
   unfixed one function below on the COMMENT path — which is where they matter
   most, since reporting lost requests is the entire delivery-side result. */
check('a lost change request with no identifiable card is operator work', () => {
  const { classify } = require('../scripts/client-signoff-reconcile.js');
  const { skipped } = detect(world({
    comments: [TWEAK({ client_slug: 'testclient' })],
    cards: [CARD({ video_status: 'Client Approval', video_deliverable_id: 'other' })],
  }));
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].reason, 'card_does_not_link_back');
  assert.equal(skipped[0].deliverable, 'del-1');
  assert.equal(skipped[0].client, 'testclient');
  assert.equal(skipped[0].comment, 'pc_x1', 'the operator needs the request, not just the card');
  const { crosswalkBroken, leftAlone } = classify({ findings: [], skipped });
  assert.equal(crosswalkBroken.length, 1, 'a lost request is the delivery half\'s whole result');
  assert.equal(leftAlone.length, 0);
});

check('a cross-client request is still not counted as a broken crosswalk', () => {
  const { classify } = require('../scripts/client-signoff-reconcile.js');
  const { skipped } = detect(world({
    comments: [TWEAK({ client_slug: 'previousclient' })],
    cards: [CARD({ client: 'testclient', video_status: 'Client Approval' })],
  }));
  assert.equal(skipped[0].reason, 'request_belongs_to_another_client');
  assert.equal(classify({ findings: [], skipped }).crosswalkBroken.length, 0);
});

/* ROUND 26. Three more of the same shape, and the third is answered
   structurally rather than per row. */

/* An archived card is DELIBERATELY out of scope, so a stale reverse link on one
   must not be escalated as a broken crosswalk. Same ordering lesson as round 22:
   decide "is this in scope at all" before producing a refusal about it. */
check('an archived card with a broken link is still silent', () => {
  for (const over of [
    { cards: [CARD({ status: 'Archived', video_deliverable_id: 'other' })] },
    { cards: [CARD({ status: 'Archived' })], deliverables: [DEL({ team: '' })] },
  ]) {
    const { findings, skipped } = detect(world(Object.assign({ outbox: [APPROVE()] }, over)));
    assert.equal(findings.length, 0);
    assert.equal(skipped.length, 0, 'the report promises to suppress archived cards');
  }
});

/* `production_comments.component` has no constraint tying it to the
   deliverable's team, so a malformed row can name `video` on work whose
   validated binding is graphic. Trusting the label reports the request absent
   from the WRONG review. */
check('a named component that contradicts the validated link is refused', () => {
  const { findings, skipped } = detect(world({
    comments: [TWEAK({ component: 'video' })],
    deliverables: [DEL({ kind: 'thumbnail', team: 'graphics' })],
    cards: [CARD({ video_deliverable_id: null, graphic_deliverable_id: 'del-1',
      graphic_status: 'Client Approval', video_status: 'Client Approval' })],
  }));
  assert.equal(findings.length, 0, 'the request could never have been delivered to video');
  assert.equal(skipped[0].reason, 'named_component_contradicts_link');
  assert.equal(skipped[0].linked_component, 'graphic');
});

check('a named component that agrees with the link is still honoured', () => {
  const { findings } = detect(world({
    comments: [TWEAK({ component: 'caption' })],
    cards: [CARD({ caption_status: 'Client Approval' })],
  }));
  assert.equal(findings.length, 1, 'caption has no reverse link and must still work');
  assert.equal(findings[0].component, 'caption');
});

/* THE STRUCTURAL ONE. Three rounds running have found a skip row printing a
   card id with no client, each fixed at the push site I was looking at. The
   contract is enforced now: a row that names a card without naming a client
   throws, so a future push site cannot omit it quietly. */
check('every skip row that names a card names its client', () => {
  const worlds = [
    { outbox: [APPROVE()], cards: [CARD({ video_status: 'Tweaks Needed' })] },
    { outbox: [APPROVE()], comments: [TWEAK({ created_at: '2026-09-09T00:00:00.000Z' })],
      cards: [CARD({ video_status: 'Approved' })] },
    { comments: [TWEAK()], cards: [CARD({ video_status: 'Approved' })] },
    { comments: [TWEAK()], cards: [CARD({ video_status: 'Client Approval', video_tweaks: '{' })] },
    { comments: [TWEAK({ component: 'nonsense' })], cards: [CARD({ video_status: 'Client Approval' })] },
  ];
  let seen = 0;
  for (const w of worlds) {
    for (const row of detect(world(w)).skipped) {
      if (!row.card || row.card === '(unidentified)') continue;
      seen++;
      assert.ok(row.client, `${row.reason} names a card and no client`);
    }
  }
  assert.ok(seen >= 4, `the fixtures must actually produce card-bearing skips (saw ${seen})`);
});

/* ROUND 27. The supersession clock was keyed by DELIVERABLE, but one deliverable
   carries the video work and the caption and title reviews, so an unrelated
   request suppressed a sign-off it had nothing to do with — including, after
   round 26, a request the same run refuses as unusable. A request supersedes the
   review it belongs to, and no other. */
check('a caption request does not supersede the video sign-off', () => {
  const { findings } = detect(world({
    outbox: [APPROVE()],
    comments: [TWEAK({ component: 'caption', created_at: '2026-09-06T10:00:00.000Z' })],
  }));
  assert.equal(findings.filter(f => f.kind === 'stamp' && f.writable).length, 1,
    'one deliverable carries several reviews; a caption request is not a video reopen');
});

check('a request refused as contradicting the link supersedes nothing', () => {
  const { findings, skipped } = detect(world({
    outbox: [APPROVE({ entity_id: 'del-1' })],
    comments: [TWEAK({ component: 'video', created_at: '2026-09-06T10:00:00.000Z' })],
    deliverables: [DEL({ kind: 'thumbnail', team: 'graphics' })],
    cards: [CARD({ video_deliverable_id: null, graphic_deliverable_id: 'del-1',
      graphic_status: 'Approved', video_status: 'Client Approval' })],
  }));
  assert.equal(findings.filter(f => f.kind === 'stamp').length, 1,
    'a request the run cannot place must not silently block a repair');
  assert.equal(findings[0].component, 'graphic');
  assert.equal(skipped.some(x => x.reason === 'named_component_contradicts_link'), true);
});

/* And that refusal is a person's decision, not an intentional skip: the card has
   not moved on, the report simply cannot say which review the client meant. */
check('a contradicting component is counted as needing a person', () => {
  const { classify } = require('../scripts/client-signoff-reconcile.js');
  const { skipped } = detect(world({
    comments: [TWEAK({ component: 'video' })],
    deliverables: [DEL({ kind: 'thumbnail', team: 'graphics' })],
    cards: [CARD({ video_deliverable_id: null, graphic_deliverable_id: 'del-1',
      graphic_status: 'Client Approval', video_status: 'Client Approval' })],
  }));
  const { crosswalkBroken, leftAlone } = classify({ findings: [], skipped });
  assert.equal(crosswalkBroken.length, 1, 'the card has not moved on');
  assert.equal(leftAlone.length, 0);
});

/* A component request still supersedes its OWN review, or round 17's fix would
   have been undone by round 27's narrowing. */
check('a video request still supersedes the video sign-off', () => {
  const { findings, skipped } = detect(world({
    outbox: [APPROVE()],
    comments: [TWEAK({ component: 'video', created_at: '2026-09-06T10:00:00.000Z' })],
    cards: [CARD({ video_status: 'Approved' })],
  }));
  assert.equal(findings.filter(f => f.kind === 'stamp').length, 0);
  assert.equal(skipped.some(x => x.reason === 'superseded_by_later_client_request'), true);
});

/* ROUND 28. The round-26 contradiction rule fired only when BOTH components had
   a reverse link, so a caption or title request on graphics-linked work slipped
   through — and caption and title have no reverse link, so the rule could never
   have caught them. `scripts/f42-card-comment-import.js` states the canonical
   contract: "graphic -> Graphics; every video/caption/title thread shares the
   Video deliverable." Live, all 347 client tweaks conform to it exactly, so this
   refuses nothing today. */
check('a caption request on graphics-linked work is refused', () => {
  for (const named of ['caption', 'title']) {
    const { findings, skipped } = detect(world({
      comments: [TWEAK({ component: named })],
      deliverables: [DEL({ kind: 'thumbnail', team: 'graphics' })],
      cards: [CARD({ video_deliverable_id: null, graphic_deliverable_id: 'del-1',
        graphic_status: 'Client Approval', caption_status: 'Client Approval' })],
    }));
    assert.equal(findings.length, 0, `${named} is not a review graphics work carries`);
    assert.equal(skipped[0].reason, 'named_component_contradicts_link');
  }
});

/* THE RELATIONSHIP THAT MUST SURVIVE: caption and title legitimately share the
   VIDEO deliverable, which is the normal live shape (74 of 347 client tweaks). */
check('caption and title on video-linked work are still honoured', () => {
  for (const named of ['caption', 'video']) {
    const { findings } = detect(world({
      comments: [TWEAK({ component: named })],
      cards: [CARD({ video_status: 'Client Approval', caption_status: 'Client Approval' })],
    }));
    assert.equal(findings.length, 1, `${named} shares the video deliverable by design`);
  }
});

check('a caption request on graphics work supersedes no sign-off', () => {
  const { findings } = detect(world({
    outbox: [APPROVE()],
    comments: [TWEAK({ component: 'caption', created_at: '2026-09-06T10:00:00.000Z' })],
    deliverables: [DEL({ kind: 'thumbnail', team: 'graphics' })],
    cards: [CARD({ video_deliverable_id: null, graphic_deliverable_id: 'del-1',
      graphic_status: 'Approved' })],
  }));
  assert.equal(findings.filter(f => f.kind === 'stamp' && f.writable).length, 1,
    'a request the run refuses as unplaceable must not block a repair');
});

/* The write-failure line runs only on an APPLY run against a live backend, so
   nothing offline reaches it. Extracted as a pure function so it can be
   asserted rather than trusted: a repair that was attempted and FAILED is the
   one record an operator has, and a bare card id does not say whose. */
/* --json suppresses every detail line, so the projection is all a consumer
   gets. Driven through the CLI because that flag is read at module load. */
checkAsync('every JSON finding names its client', async () => {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
  const fixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'csr-')), 'world.json');
  fs.writeFileSync(fixture, JSON.stringify({
    outbox: [APPROVE()], comments: [], deliverables: [DEL()], cards: [CARD()],
  }));
  const out = execFileSync(process.execPath,
    [path.join(__dirname, '../scripts/client-signoff-reconcile.js'),
      `--fixtures=${fixture}`, '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0].client, 'testclient',
    'a card id alone does not say whose card: ' + out);
});

check('a failed write names the client and component', () => {
  const { failureLine } = require('../scripts/client-signoff-reconcile.js');
  const line = failureLine({ card: CARD(), component: 'video' }, 'HTTP 500');
  assert.match(line, /card card-1 \(testclient\) \[video\]: HTTP 500/, line);
});

/* ROUND 29. The supersession clock fell back to the deliverable's linked
   component for a request naming something this job cannot map (`sizzle-reel`).
   The request path reports exactly that row as `unmapped_component` and refuses
   to say which review it belongs to — so the clock was deciding the question the
   report declines to answer, and suppressing a valid missing approval on the
   strength of it. The fallback is now reserved for an EMPTY name. */
check('a request naming an unmapped component supersedes nothing', () => {
  const { findings, skipped } = detect(world({
    outbox: [APPROVE()],
    comments: [TWEAK({ component: 'sizzle-reel', created_at: '2026-09-06T10:00:00.000Z' })],
  }));
  assert.equal(findings.filter(f => f.kind === 'stamp' && f.writable).length, 1,
    'the clock must not decide what the report refuses to decide');
  assert.equal(skipped.some(x => x.reason === 'unmapped_component'), true);
});

check('a request with NO component still supersedes its deliverable\'s review', () => {
  const { findings, skipped } = detect(world({
    outbox: [APPROVE()],
    comments: [TWEAK({ component: '', created_at: '2026-09-06T10:00:00.000Z' })],
    cards: [CARD({ video_status: 'Approved' })],
  }));
  assert.equal(findings.filter(f => f.kind === 'stamp').length, 0,
    'an empty name has nothing to contradict; the link is the answer');
  assert.equal(skipped.some(x => x.reason === 'superseded_by_later_client_request'), true);
});

/* The headline lumped a contradicting component in with missing cards. They are
   different work: one card cannot be found, the other is right there and the
   question is which of two known reviews the client meant. */
check('the headline separates a missing card from an ambiguous review', () => {
  const { classify } = require('../scripts/client-signoff-reconcile.js');
  const { cardMissing, componentAmbiguous, lines } = classify({ findings: [], skipped: [
    { kind: 'stamp', reason: 'card_not_found', crosswalk_broken: true,
      card: '(unidentified)', client: 'testclient', deliverable: 'del-9', component: '' },
    { kind: 'comment', reason: 'named_component_contradicts_link', crosswalk_broken: true,
      card: 'card-1', client: 'testclient', component: 'video',
      linked_component: 'graphic', comment: 'pc_x1' },
  ] });
  assert.equal(cardMissing.length, 1);
  assert.equal(componentAmbiguous.length, 1);
  const needs = lines.find(l => l.startsWith('NEEDS A PERSON'));
  assert.match(needs, /card is missing 1/, needs);
  assert.match(needs, /cannot carry 1/, needs);
});

/* ROUND 30. `hidden` is the app's audit-suppression flag: `_calCommentsForView`
   filters it out for EVERY audience, and index.html names the case it exists
   for — "legacy cross-client feedback that bled onto the wrong client's row".
   A hidden twin claiming a request declares it delivered while the client
   cannot see it, and does so most readily on exactly the cross-client mess the
   flag was created to bury. Live: 4 cells carry one. */
check('a hidden entry is not a delivery, by id or by body', () => {
  for (const key of ['pc_x1', 'nat-77']) {
    const onCard = JSON.stringify([
      { id: key, body: 'Please fix the intro', role: 'client', is_tweak: true, hidden: true },
    ]);
    const { findings } = detect(world({
      comments: [TWEAK({ native_comment_id: 'nat-77' })],
      cards: [CARD({ video_status: 'Client Approval', video_tweaks: onCard })],
    }));
    assert.equal(findings.length, 1,
      `a hidden entry matched by ${key === 'pc_x1' ? 'id' : 'native id'} is invisible to the client`);
  }
});

/* THE RULE IT MUST NOT SWALLOW: a DELETED entry claimed by id is still a claim.
   The client withdrew their own request, and re-delivering it would reopen a
   component over something they took back. A first draft of the hidden fix
   broke exactly this, which is why the round-6 check caught it. */
check('a deleted entry claimed by id is still a claim', () => {
  const onCard = JSON.stringify([
    { id: 'pc_x1', body: 'Please fix the intro', role: 'client', is_tweak: true, deleted: true },
  ]);
  const { findings } = detect(world({
    comments: [TWEAK()],
    cards: [CARD({ video_status: 'Client Approval', video_tweaks: onCard })],
  }));
  assert.equal(findings.length, 0, 'withdrawn is not the same as unseen');
});

/* ROUND 31. `hidden` is tested for TRUTH, not for `=== true`, because
   `_calCommentsForView` filters on `!c.hidden` and these cells hold schema-less
   JSON. A legacy or imported entry carrying `hidden: 1` or `hidden: "true"` is
   invisible in the app, so the strict test would have let exactly the entry
   round 30 refused claim a request. */
check('any truthy hidden value refuses the claim, as the app does', () => {
  for (const hidden of [true, 1, 'true', 'yes', {}]) {
    const onCard = JSON.stringify([
      { id: 'pc_x1', body: 'Please fix the intro', role: 'client', is_tweak: true, hidden },
    ]);
    const { findings } = detect(world({
      comments: [TWEAK()],
      cards: [CARD({ video_status: 'Client Approval', video_tweaks: onCard })],
    }));
    assert.equal(findings.length, 1, `hidden: ${JSON.stringify(hidden)} is invisible in the app`);
  }
});

check('a falsy hidden value is not hidden', () => {
  for (const hidden of [false, 0, '', null, undefined]) {
    /* A DIFFERENT body, so only the ID pass can claim it — otherwise the body
       fallback answers and this proves nothing about the id pass, which is
       where the truthiness test lives. A first version of this check passed
       while sabotaged for exactly that reason. */
    const onCard = JSON.stringify([
      { id: 'pc_x1', body: 'totally different text', role: 'client', is_tweak: true, hidden },
    ]);
    const { findings } = detect(world({
      comments: [TWEAK()],
      cards: [CARD({ video_status: 'Client Approval', video_tweaks: onCard })],
    }));
    assert.equal(findings.length, 0, `hidden: ${JSON.stringify(hidden)} renders normally`);
  }
});

/* A STALE LINK IS NOT A MISSING CARD. Round 30 put the located card on the row
   and left it counted and printed as "cannot be found" — the fix applied where
   I was looking, one more time. */
check('a stale reverse link is counted as a stale link, not a missing card', () => {
  const { classify } = require('../scripts/client-signoff-reconcile.js');
  const { skipped } = detect(world({
    outbox: [APPROVE()], cards: [CARD({ video_deliverable_id: 'other' })],
  }));
  const { cardMissing, linkStale, lines } = classify({ findings: [], skipped });
  assert.equal(cardMissing.length, 0, 'the card was found');
  assert.equal(linkStale.length, 1);
  assert.match(lines.find(l => l.startsWith('NEEDS A PERSON')), /link back is stale 1/);
});

/* ROUND 32, CORRECTED BY ROUND 33. Eligibility is `_calMsgAudience`, the
   function `_calCommentsForView` actually calls — extracted, not restated.
   Round 32 replaced a staff-role blacklist with the PRODUCTION surface's
   normalization, which defaults every non-client role to internal; Calendar
   defaults only `kasper` and `smm` to internal, so a `creative` note or an
   entry with no role at all IS client-visible there. Restating the wrong rule
   would have reported delivered requests as absent. */
check('an internal entry never delivers a client request, whatever its role', () => {
  for (const over of [
    { role: 'kasper' },                         // internal by Calendar's default
    { role: 'smm' },                            // the other default-internal role
    { role: 'client', audience: 'internal' },   // explicitly internal, 4 live rows
  ]) {
    const onCard = JSON.stringify([Object.assign(
      { id: 'cal-9', body: 'Please fix the intro', is_tweak: true }, over)]);
    const { findings } = detect(world({
      comments: [TWEAK()],
      cards: [CARD({ video_status: 'Client Approval', video_tweaks: onCard })],
    }));
    assert.equal(findings.length, 1,
      `${JSON.stringify(over)} is internal; the client never saw it`);
  }
});

/* And the other side of Calendar's rule: anything that is NOT kasper or smm,
   without an explicit audience, is client-visible — including a role this job
   has never seen and an entry carrying no role at all. */
check('a role Calendar does not default to internal still delivers', () => {
  for (const over of [{ role: 'creative' }, { role: 'designer' }, {}]) {
    const onCard = JSON.stringify([Object.assign(
      { id: 'cal-9', body: 'Please fix the intro', is_tweak: true }, over)]);
    const { findings } = detect(world({
      comments: [TWEAK()],
      cards: [CARD({ video_status: 'Client Approval', video_tweaks: onCard })],
    }));
    assert.equal(findings.length, 0,
      `${JSON.stringify(over)} is client-visible on Calendar; the request reached the client`);
  }
});

check('an explicit client audience delivers even on a staff role', () => {
  const onCard = JSON.stringify([
    { id: 'cal-9', body: 'Please fix the intro', is_tweak: true,
      role: 'smm', audience: 'client' },
  ]);
  const { findings } = detect(world({
    comments: [TWEAK()],
    cards: [CARD({ video_status: 'Client Approval', video_tweaks: onCard })],
  }));
  assert.equal(findings.length, 0,
    'the app shows it to the client, so it can be the delivery — 779 live rows look like this');
});

/* ROUND 33, second finding. The ID pass claimed an entry the client cannot see.
   An exact id match is the strongest evidence this job has and it is still not
   evidence of DELIVERY: `_calCommentsForView` hides an internal root from the
   client exactly as it hides a `hidden` one. */
check('an internal entry does not deliver even on an exact id match', () => {
  const onCard = JSON.stringify([
    { id: 'pc_x1', body: 'totally different text', role: 'kasper', is_tweak: true },
  ]);
  const { findings } = detect(world({
    comments: [TWEAK()],
    cards: [CARD({ video_status: 'Client Approval', video_tweaks: onCard })],
  }));
  assert.equal(findings.length, 1, 'the id matches, but the client sees nothing');
});

/* AND THE RULE THAT MUST SURVIVE IT, again: a DELETED entry claimed by id is
   still a claim. Round 30's first draft broke this; so could this one. */
check('a deleted CLIENT entry claimed by id is still a claim after the audience rule', () => {
  const onCard = JSON.stringify([
    { id: 'pc_x1', body: 'Please fix the intro', role: 'client', is_tweak: true, deleted: true },
  ]);
  const { findings } = detect(world({
    comments: [TWEAK()],
    cards: [CARD({ video_status: 'Client Approval', video_tweaks: onCard })],
  }));
  assert.equal(findings.length, 0, 'withdrawn is still not unseen');
});

/* ROUND 34. `_calCommentsForView` applies THREE rules and round 33 mirrored one.
   It also drops every `role: 'kasper'` message outright — "never expose Kasper
   authorship", a hard exclusion that overrides an explicit client audience —
   and it judges a REPLY by its thread ROOT's audience, not its own. */
check('a Kasper entry never delivers, even tagged audience client', () => {
  for (const key of ['pc_x1', 'body']) {
    const onCard = JSON.stringify([{
      id: key === 'pc_x1' ? 'pc_x1' : 'cal-9',
      body: key === 'pc_x1' ? 'totally different text' : 'Please fix the intro',
      role: 'kasper', audience: 'client', is_tweak: true,
    }]);
    const { findings } = detect(world({
      comments: [TWEAK()],
      cards: [CARD({ video_status: 'Client Approval', video_tweaks: onCard })],
    }));
    assert.equal(findings.length, 1,
      `matched by ${key}: the app never shows Kasper authorship to a client`);
  }
});

check('a reply is judged by its root, as the renderer judges it', () => {
  /* The reply itself would read as client-visible; its root is internal, and
     `_calCommentsForView` resolves replies through the root. */
  const onCard = JSON.stringify([
    { id: 'root-1', body: 'internal thread', role: 'smm', is_tweak: false },
    { id: 'pc_x1', body: 'totally different text', role: 'client',
      parent_id: 'root-1', is_tweak: true },
  ]);
  const { findings } = detect(world({
    comments: [TWEAK()],
    cards: [CARD({ video_status: 'Client Approval', video_tweaks: onCard })],
  }));
  assert.equal(findings.length, 1, 'the client sees neither the root nor its reply');
});

/* ROUND 35. The root map was built from the RAW cell; `_calCommentsForView`
   drops tombstoned and hidden entries FIRST and only then indexes by id. So a
   hidden root is absent from the renderer's map and its surviving reply is
   judged by its own audience — while my map resurrected the hidden root and
   judged the reply by it. A hidden client-addressed root with an internal reply
   was therefore called visible, and claimed. */
check('a reply under a HIDDEN root is judged by itself, as the renderer judges it', () => {
  const onCard = JSON.stringify([
    { id: 'root-1', body: 'hidden but client-addressed', role: 'client',
      audience: 'client', hidden: true },
    { id: 'pc_x1', body: 'totally different text', role: 'smm',
      audience: 'internal', parent_id: 'root-1', is_tweak: true },
  ]);
  const { findings } = detect(world({
    comments: [TWEAK()],
    cards: [CARD({ video_status: 'Client Approval', video_tweaks: onCard })],
  }));
  assert.equal(findings.length, 1,
    'the root is hidden, so the reply stands alone and is internal');
});

/* And the reply-under-a-VISIBLE-root case still resolves through the root, or
   the prefilter would have quietly undone round 34. */
check('a reply under a visible internal root is still judged by that root', () => {
  const onCard = JSON.stringify([
    { id: 'root-1', body: 'internal thread', role: 'smm', is_tweak: false },
    { id: 'pc_x1', body: 'totally different text', role: 'client',
      parent_id: 'root-1', is_tweak: true },
  ]);
  const { findings } = detect(world({
    comments: [TWEAK()],
    cards: [CARD({ video_status: 'Client Approval', video_tweaks: onCard })],
  }));
  assert.equal(findings.length, 1, 'the root is internal and present, so the reply inherits it');
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

/* ROUND 38, first finding. `unmapped_component` and `card_cell_unparseable`
   mean the job could not tell whether or where a request was delivered, on a
   card that is still live. They carried neither a carrier status nor
   `crosswalk_broken`, so `classify()` filed them under "left alone (a card that
   moved on is never overwritten)" and `NEEDS A PERSON` read 0. Live both are 0
   rows today, which is the cheapest moment to fix a report. */
check('an undecidable row needs a person, not the moved-on bucket', () => {
  const { classify } = require('../scripts/client-signoff-reconcile.js');
  const { undecidable, leftAlone, lines } = classify({ findings: [], skipped: [
    { kind: 'comment', reason: 'unmapped_component', card: 'card-1', client: 'testclient',
      component: 'thumbnail', comment: 'pc_1' },
    { kind: 'comment', reason: 'card_cell_unparseable', card: 'card-2', client: 'testclient',
      component: 'video' },
    { kind: 'stamp', reason: 'superseded_status', card: 'card-3', component: 'video' },
  ] });
  assert.equal(undecidable.length, 2);
  assert.equal(leftAlone.length, 1, 'only the genuinely intentional skip is left alone');
  const needs = lines.find(l => l.startsWith('NEEDS A PERSON'));
  assert.match(needs, /NEEDS A PERSON \(never written\): 2\b/, needs);
  assert.match(needs, /undecidable on a live card 2/, needs);
  assert.match(lines.find(l => l.startsWith('left alone')), /left alone: 1\b/);
});

/* ROUND 38, second finding, and the same defect as round 30 three lines up in
   the same function: resolve() locates the card BEFORE the team mapping, so a
   refusal there knows the card. Returned bare, the row printed "(unidentified)"
   and was counted as an action whose card is missing, sending an operator after
   a card that is sitting right there. */
check('a team-mapping refusal names the card it found', () => {
  for (const [over, refusal] of [
    [{ team: '' }, 'unknown_team'],
    [{ team: 'graphics', kind: 'video' }, 'kind_and_team_disagree'],
  ]) {
    const { skipped } = detect(world({
      comments: [TWEAK()],
      deliverables: [DEL(over)],
    }));
    assert.equal(skipped.length, 1, refusal + ' must still be reported');
    assert.equal(skipped[0].reason, refusal);
    assert.equal(skipped[0].card, 'card-1', refusal + ' knows the card it refused on');
    assert.equal(skipped[0].client, 'testclient');
  }
});

check('a team-mapping refusal is not counted as a missing card', () => {
  const { classify } = require('../scripts/client-signoff-reconcile.js');
  const { cardMissing, teamUnknown, kindTeamDisagree, linkStale, lines } =
    classify({ findings: [], skipped: [
      { kind: 'comment', reason: 'unknown_team', crosswalk_broken: true,
        card: 'card-1', client: 'testclient', component: '', comment: 'pc_1' },
      { kind: 'comment', reason: 'kind_and_team_disagree', crosswalk_broken: true,
        card: 'card-2', client: 'testclient', component: '', comment: 'pc_2' },
      { kind: 'comment', reason: 'card_does_not_link_back', crosswalk_broken: true,
        card: 'card-3', client: 'testclient', component: '', comment: 'pc_3' },
      { kind: 'comment', reason: 'card_not_found', crosswalk_broken: true,
        card: '(unidentified)', client: 'testclient', component: '', comment: 'pc_4' },
    ] });
  assert.equal(teamUnknown.length, 1);
  /* ROUND 39. The kind/team row is NOT a "team names no review" row: graphics
     maps to graphic, and it is the kind that disagrees. Separate term. */
  assert.equal(kindTeamDisagree.length, 1);
  /* ROUND 39. A stale reverse link also has a known card, so keying the team
     bucket off "card known" counted it twice and the breakdown claimed both. */
  assert.equal(linkStale.length, 1);
  assert.equal(cardMissing.length, 1, 'only the row whose card really is missing');
  const needs = lines.find(l => l.startsWith('NEEDS A PERSON'));
  assert.match(needs, /NEEDS A PERSON \(never written\): 4\b/, needs);
  assert.match(needs, /whose card is missing 1/, needs);
  assert.match(needs, /team names no review 1/, needs);
  assert.match(needs, /kind and team name different reviews 1/, needs);
  assert.match(needs, /link back is stale 1/, needs);
});

/* ROUND 39. The buckets in the headline must PARTITION the rows: with the team
   bucket keyed off "was the card known", a single stale-link row was counted
   in two terms at once and a one-row run printed both as 1. */
check('the breakdown terms do not overlap', () => {
  const { classify } = require('../scripts/client-signoff-reconcile.js');
  const { lines } = classify({ findings: [], skipped: [
    { kind: 'comment', reason: 'card_does_not_link_back', crosswalk_broken: true,
      card: 'card-1', client: 'testclient', component: '', comment: 'pc_1' },
  ] });
  const needs = lines.find(l => l.startsWith('NEEDS A PERSON'));
  assert.match(needs, /NEEDS A PERSON \(never written\): 1\b/, needs);
  assert.match(needs, /link back is stale 1/, needs);
  assert.match(needs, /team names no review 0/, needs);
  assert.match(needs, /kind and team name different reviews 0/, needs);
  const terms = (needs.match(/ (\d+)[,)]/g) || []).map(t => Number(t.replace(/\D/g, '')));
  assert.equal(terms.reduce((a, b) => a + b, 0), 1,
    'the breakdown must sum to the headline: ' + needs);
});

/* ROUND 39, and the reason it is a CLI check rather than a bucket check: round
   38 taught the COUNT about these rows and left the log silent, so the run
   reported that work exists and named nothing to look at. The workflow
   dispatches without `--json`, so this log is all an operator gets. A row, its
   count and its line are three surfaces — this is the third time in this PR a
   fix reached fewer than all three. */
checkAsync('the run prints the rows behind every count it reports', async () => {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
  const fixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'csr-')), 'world.json');
  fs.writeFileSync(fixture, JSON.stringify({
    outbox: [],
    comments: [
      /* A component name the map does not carry. `thumbnail` looks unmapped and
         is not — it maps to graphic — which is why this fixture names something
         the map genuinely has no entry for. */
      TWEAK({ id: 'pc_u1', component: 'storyboard' }),
      TWEAK({ id: 'pc_u2', deliverable_id: 'del-2' }),
      TWEAK({ id: 'pc_t1', deliverable_id: 'del-3' }),
      TWEAK({ id: 'pc_t2', deliverable_id: 'del-4' }),
    ],
    deliverables: [
      DEL(),
      DEL({ id: 'del-2', card_id: 'card-2' }),
      DEL({ id: 'del-3', card_id: 'card-3', team: '' }),
      DEL({ id: 'del-4', card_id: 'card-4', team: 'graphics', kind: 'video' }),
    ],
    cards: [
      CARD(),
      CARD({ id: 'card-2', video_deliverable_id: 'del-2', video_tweaks: '{not json' }),
      CARD({ id: 'card-3', video_deliverable_id: 'del-3' }),
      CARD({ id: 'card-4', graphic_deliverable_id: 'del-4' }),
    ],
  }));
  const out = execFileSync(process.execPath,
    [path.join(__dirname, '../scripts/client-signoff-reconcile.js'), `--fixtures=${fixture}`],
    { encoding: 'utf8' });
  /* Undecidable: counted AND printed, each naming its card and client. */
  assert.match(out, /undecidable on a live card 2/, out);
  assert.match(out, /card card-1 \(testclient\)[\s\S]*no mapping for/, out);
  /* ROUND 41. The row must name its REQUEST as well as its card: one cell can
     be the target of several committed requests, and without the id every
     reported row for that cell is the same line. */
  assert.match(out, /card card-2 \(testclient\)[^\n]*request pc_u2[^\n]*cannot parse/, out);
  /* Team-mapping refusals: the card was FOUND, so no line may say otherwise. */
  assert.match(out, /card card-3 \(testclient\)[\s\S]*team names no review this job can carry/, out);
  assert.match(out, /card card-4 \(testclient\)[\s\S]*kind and team name different reviews/, out);
  assert.doesNotMatch(out, /card-3[^\n]*cannot be found/, out);
  assert.doesNotMatch(out, /card-4[^\n]*cannot be found/, out);
  /* And none of the four is filed as an intentional skip. */
  assert.match(out, /left alone: 0\b/, out);
});

/* ROUND 40. The supersession clock was keyed by deliverable and component
   only, so a newer request belonging to ANOTHER client suppressed this client's
   missing stamp — while the request path, in the same run, refused that same
   row as belonging to another client. One row, two answers. */
check('another client\'s later request cannot suppress this client\'s stamp', () => {
  const { findings, skipped } = detect(world({
    outbox: [APPROVE()],
    comments: [TWEAK({ id: 'pc_other', client_slug: 'someone-else',
      created_at: '2026-09-06T10:00:00.000Z' })],
  }));
  assert.equal(skipped.filter(r => r.reason === 'superseded_by_later_client_request').length, 0,
    'the request belongs to another client, so it supersedes nothing here');
  assert.equal(findings.filter(f => f.kind === 'stamp').length, 1, 'the repair survives');
});

check('this client\'s own later request still supersedes', () => {
  const { findings, skipped } = detect(world({
    outbox: [APPROVE()],
    comments: [TWEAK({ id: 'pc_same', created_at: '2026-09-06T10:00:00.000Z' })],
  }));
  assert.equal(skipped.filter(r => r.reason === 'superseded_by_later_client_request').length, 1);
  assert.equal(findings.filter(f => f.kind === 'stamp').length, 0, 'the stamp must not be written');
});

/* SUPERSESSION IS THE BROAD SIDE ON PURPOSE: refusing to write leaves the card
   alone, while narrowing it risks stamping an approval the client had already
   superseded. So a request naming NO client still supersedes; only a client
   that is known AND different is excluded. */
check('a request naming no client still supersedes', () => {
  const { skipped } = detect(world({
    outbox: [APPROVE()],
    comments: [TWEAK({ id: 'pc_anon', client_slug: '', created_at: '2026-09-06T10:00:00.000Z' })],
  }));
  assert.equal(skipped.filter(r => r.reason === 'superseded_by_later_client_request').length, 1,
    'erring broad here leaves the card alone, which is the safe direction');
});

/* The client is a REQUIRED argument, enforced by arity like resolve()'s: a
   default would silently answer on every client's requests at once, which is
   the defect the argument exists to close. */
check('the supersession clock refuses to answer without a client', () => {
  const { detect: d } = require('../scripts/client-signoff-reconcile.js');
  const src = require('node:fs')
    .readFileSync(require('node:path').join(__dirname, '../scripts/client-signoff-reconcile.js'), 'utf8');
  /* Matched without the apostrophe: the source escapes it, so a pattern
     containing a bare ' does not match the file even though the string is
     there. The first draft of this check failed for exactly that reason. */
  assert.match(src, /supersededByRequest needs the row/,
    'the arity guard must exist');
  const calls = (stripComments(src).match(/supersededByRequest\(/g) || []).length;
  assert.equal(calls, 3, 'one definition and two call sites, all passing the client');
  assert.ok(typeof d === 'function');
});

check('body comparison ignores only whitespace shape', () => {
  assert.equal(normText('  a   b \n c '), 'a b c');
  assert.notEqual(normText('fix the intro'), normText('fix the outro'));
});

/* ROUND 15, second finding: the reason existed but the SUMMARY buried it under
   "left alone (a card that moved on is never overwritten)", so a run whose only
   result was the lost approval printed `NEEDS A PERSON: 0`. The workflow tells
   the operator to read that line. A reason nobody is pointed at is barely
   better than no reason. */
check('a lost client approval is counted as needing a person, not as left alone', () => {
  const { summaryLines } = require('../scripts/client-signoff-reconcile.js');
  const lines = summaryLines({ findings: [], skipped: [
    { kind: 'stamp', reason: 'carrier_did_not_write', card: 'card-1', component: 'video' },
    { kind: 'stamp', reason: 'superseded_status', card: 'card-2', component: 'video' },
  ] });
  const needs = lines.find(l => l.startsWith('NEEDS A PERSON'));
  const alone = lines.find(l => l.startsWith('left alone'));
  assert.match(needs, /NEEDS A PERSON \(never written\): 1\b/, needs);
  assert.match(needs, /reached neither leg 1/, needs);
  assert.match(alone, /left alone: 1\b/, alone);
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
