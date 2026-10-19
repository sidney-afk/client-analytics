'use strict';

/*
 * FICTIONAL BOARD FOR THE CALM WORKLOAD VIEW (suite, gallery and goldens).
 *
 * Everything here is invented: editors are "editor-1", "editor-2", "designer-1",
 * clients are "Client A/B/C" (the three names the shared harness widens the app's
 * allow-lists to). The pinned week is Monday 2026-09-14 .. Friday 2026-09-18 and
 * "today" is that Monday, so the same board shows every state the calm view has to
 * carry: a busy day with three people, an overdue card, in-progress work, tweaks
 * with notes, an unassigned card, a card with no work day, a pinned (manual) day
 * and an automatic one.
 */

const L = require('./workload-harness-lib.js');
const { issueRow, parentRow, MON, TUE, WED, THU, FRI, EDITOR_1, EDITOR_2, DESIGNER_1 } = L;

const PAST = '2026-09-10';
const ed1 = { assignee_id: EDITOR_1.id, assignee_name: EDITOR_1.name };
const ed2 = { assignee_id: EDITOR_2.id, assignee_name: EDITOR_2.name };
const des = { assignee_id: DESIGNER_1.id, assignee_name: DESIGNER_1.name, team_key: 'DES', team_name: 'Graphics' };
const none = { assignee_id: null, assignee_name: null };

function card(id, title, client, over) {
  return issueRow({
    id, identifier: 'VID-' + id.toUpperCase(), title, client_name: client,
    parent_id: 'parent-' + client.slice(-1).toLowerCase(), parent_identifier: 'VID-P' + client.slice(-1),
    url: '', ...over,
  });
}

function fixtureIssues() {
  return [
    parentRow({ id: 'parent-a', identifier: 'VID-PA', title: 'Client A batch', client_name: 'Client A' }),
    parentRow({ id: 'parent-b', identifier: 'VID-PB', title: 'Client B batch', client_name: 'Client B' }),
    parentRow({ id: 'parent-c', identifier: 'VID-PC', title: 'Client C batch', client_name: 'Client C' }),
    // Wednesday: three people, five clients' worth of cards.
    card('a1', 'Spring promo cut', 'Client A', { ...ed1, due_date: THU }),
    card('a2', 'Behind the scenes reel', 'Client A', { ...ed1, due_date: THU }),
    card('b1', 'Launch teaser', 'Client B', { ...ed1, due_date: THU }),
    card('b2', 'Customer story', 'Client B', { ...ed2, due_date: THU }),
    card('c1', 'Quick tip, part one', 'Client C', { ...ed2, due_date: FRI }),
    card('c2', 'Quick tip, part two', 'Client C', { ...ed2, due_date: FRI }),
    card('d1', 'Carousel cover set', 'Client A', { ...des, due_date: THU }),
    // Today (Monday): overdue, in progress, tweaks.
    card('o1', 'Welcome message edit', 'Client C', { ...ed2, due_date: PAST }),
    card('p1', 'Product walk-through', 'Client B', { ...ed1, due_date: FRI, status: 'In Progress', status_type: 'started' }),
    card('p2', 'Founder interview', 'Client A', { ...ed2, due_date: WED, status: 'In Progress', status_type: 'started' }),
    card('t1', 'Holiday greeting', 'Client A', { ...ed1, due_date: PAST, status: 'Tweak Needed', status_type: 'started' }),
    card('t2', 'Studio tour', 'Client A', { ...ed1, due_date: TUE, status: 'Tweak Needed', status_type: 'started' }),
    card('t3', 'Event recap', 'Client B', { ...ed2, due_date: WED, status: 'Tweak Needed', status_type: 'started' }),
    // Needs assignment / needs a work day / hidden.
    card('u1', 'Team intro clip', 'Client B', { ...none, due_date: THU }),
    card('u2', 'Month-end summary', 'Client C', { ...none, due_date: FRI }),
    card('u3', 'Client C teaser', 'Client C', { ...none, due_date: THU }),
    card('n1', 'Seasonal b-roll', 'Client A', { ...ed1, due_date: null }),
    card('x1', 'Draft with no owner or date', 'Client B', { ...none, due_date: null }),
  ];
}

// Pinned days spread the week; everything unpinned lands where the automatic plan puts it.
const fixturePlans = () => [
  { issue_id: 'a1', plan_date: WED }, { issue_id: 'a2', plan_date: TUE }, { issue_id: 'b1', plan_date: WED },
  { issue_id: 'b2', plan_date: WED }, { issue_id: 'c1', plan_date: THU }, { issue_id: 'c2', plan_date: FRI },
  { issue_id: 'd1', plan_date: WED },
];

const COMMENTS = {
  t1: [
    { author: 'Reviewer', body: 'Trim the first two seconds and keep the logo on screen a little longer.', created_at: '2026-09-13T10:00:00.000Z' },
    { author: 'Reviewer', body: 'Music is too loud under the voice.', created_at: '2026-09-12T16:30:00.000Z' },
  ],
  t2: [{ author: 'Reviewer', body: 'Swap the second shot for the wide one.', created_at: '2026-09-13T09:15:00.000Z' }],
  t3: [{ author: 'Reviewer', body: 'Captions cut off on the last line.', created_at: '2026-09-13T08:00:00.000Z' }],
};

const CALM_FLAG = { key: 'workload_calm_staff', value: { staff: ['qa_staff'] } };

/* One boot of the shared harness on this board. `calm` adds the switch row for the
   harness' signed-in staff member; `flagRows` can replace it for the off-state tests. */
async function launchCalmBoard(options) {
  const o = options || {};
  const h = await L.launchWorkloadHarness({
    nativeSnapshot: true,
    issues: o.issues || fixtureIssues(),
    plans: o.plans || fixturePlans(),
    comments: o.comments || COMMENTS,
    flagRows: o.flagRows || (o.calm ? [CALM_FLAG] : []),
    flagResponse: o.flagResponse,
    query: o.query,
  });
  if (o.viewport) await h.page.setViewportSize(o.viewport);
  if (o.theme === 'dark') await h.page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); });
  await L.waitForPlanSettled(h.page);
  return h;
}

module.exports = { fixtureIssues, fixturePlans, COMMENTS, CALM_FLAG, launchCalmBoard, ...L };
