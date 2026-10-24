'use strict';
/* Fictional notes for the round-6 unread-badges screenshots (session Beacon, 2026-10-24). Every name, title and line is
   made up. The signed-in harness member is m1 ("Browser Staff"); "Casey Rivera" stands for a client contact. */
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
let n = 0;
const msg = (o) => {
  const id = o.id || 'n' + (++n);
  const created = ago(o.min || 30);
  return Object.assign({ id, parent_id: null, root_id: id, author: 'Casey Rivera', role: 'client', audience: 'client',
    is_tweak: false, done: false, created_at: created, updated_at: created, round: 1 }, o, { id, created_at: created, updated_at: created });
};
const reply = (root, o) => msg(Object.assign({ parent_id: root.id, root_id: root.id }, o));
const ME = { author: 'Browser Staff', author_member_id: 'm1', role: 'admin' };
const TEAM = { author: 'Robin Sample', role: 'smm' };
const KASPER = { author: 'Kasper', role: 'kasper', audience: 'internal' };

function cards() {
  n = 0;
  const out = [];
  const card = (id, name, date, parts, seen) => out.push({ id, name, date, parts, seen });
  // Busy card: a new change, a comment waiting, a teammate's reply, Kasper, and one change still open from before.
  { const q = msg({ min: 90, body: 'Could the hook be shorter?' });
    card('p_four', 'Launch day recap', '2026-10-16', {
      video: [msg({ min: 3000, is_tweak: true, body: 'Add the store hours at the end.' }), msg({ min: 8, is_tweak: true, body: 'Remove the blurry shot at 0:12.' }), q,
        reply(q, Object.assign({ min: 30, audience: 'client', body: 'Yes, we can trim it to three seconds.' }, TEAM)),
        msg(Object.assign({ min: 22, is_tweak: true, body: 'Audio peaks at the end.' }, KASPER))],
      caption: [msg({ min: 14, body: 'Please add the link in bio line.' })] }, 120); }
  // A long conversation over two weeks, with your own messages, Kasper's change request and a team-only note.
  { const parts = { video: [], caption: [] };
    const q1 = msg({ min: 20200, body: 'First impressions: love the pace. A few thoughts below.' }); parts.video.push(q1);
    parts.video.push(reply(q1, Object.assign({ min: 20100, audience: 'client', body: 'Thanks! Send them over, we are on it.' }, ME)));
    parts.video.push(msg(Object.assign({ min: 14500, is_tweak: true, body: 'Colour on the last shot is a little warm.' }, KASPER)));
    parts.video.push(msg(Object.assign({ min: 14400, audience: 'internal', body: 'On it, new export tonight.' }, ME)));
    const q2 = msg({ min: 2860, body: 'Can we use the brand font for the subtitles?' }); parts.video.push(q2);
    parts.video.push(reply(q2, Object.assign({ min: 2700, audience: 'client', body: 'Yes, that is the plan for the next cut.' }, TEAM)));
    parts.video.push(reply(q2, { min: 2690, body: 'Perfect, thank you.' }));
    parts.caption.push(msg(Object.assign({ min: 1400, audience: 'internal', body: 'Caption updated by the client, looks fine to me.' }, TEAM)));
    parts.caption.push(msg(Object.assign({ min: 1398, audience: 'internal', body: 'I will schedule it for Friday morning.' }, TEAM)));
    parts.caption.push(msg({ min: 60, body: 'Who will post it, you or us?' }));
    parts.video.push(msg({ min: 45, body: 'The new version is great, much better light.' }));
    parts.video.push(msg({ min: 12, is_tweak: true, body: 'Last thing: end on the logo for two seconds.' }));
    card('p_long', 'Spring collection teaser', '2026-10-17', parts, 600); }
  card('p_new_comment', 'Behind the counter', '2026-10-07', { caption: [msg({ min: 20, body: 'Can we post this one on Friday instead?' })] });
  card('p_staff', 'Recipe teaser', '2026-10-13', { video: [msg(Object.assign({ min: 18, audience: 'internal', body: 'Thursday morning, we will send the link.' }, TEAM))] }, 200);
  return out;
}
module.exports = { cards, ago };
