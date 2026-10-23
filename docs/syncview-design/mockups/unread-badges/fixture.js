'use strict';
/* Fictional notes for the unread-badges preview (session Beacon, 2026-10-23). Every name, title and line is made up.
   Seeds the offline harness (docs/syncview-design/tests/lost-work-lib.js) with one card per badge case, plus the
   matching Messages conversations, so the REAL page renders them. Times are relative to now. */
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
let n = 0;
const msg = (o) => {
  const id = o.id || 'n' + (++n);
  const created = ago(o.min || 30);
  return Object.assign({ id, parent_id: null, root_id: id, author: 'Sample Client', role: 'client', audience: 'client',
    is_tweak: false, done: false, created_at: created, updated_at: created, round: 1 }, o, { id, created_at: created, updated_at: created });
};
const reply = (root, o) => msg(Object.assign({ parent_id: root.id, root_id: root.id }, o));

// One card per case. `seen` = minutes ago this browser last opened Notes (undefined = never).
function cards() {
  n = 0;
  const out = [];
  const card = (id, name, date, parts, seen) => out.push({ id, name, date, parts, seen });

  // 1. A new change request
  card('p_new_change', 'Morning routine reel', '2026-10-06', { video: [msg({ min: 12, is_tweak: true, body: 'Cut the first two seconds and start on the logo.' }), msg({ min: 15, is_tweak: true, body: 'Music a bit quieter under the voice, please.' })] });
  // 2. A new comment (a question)
  card('p_new_comment', 'Behind the counter', '2026-10-07', { caption: [msg({ min: 20, body: 'Can we post this one on Friday instead?' })] });
  // 3. Both: a new change and a new comment
  { const t = msg({ min: 9, is_tweak: true, body: 'Swap the end card for the new one.' });
    card('p_both', 'Team intro carousel', '2026-10-08', { video: [t, msg({ min: 25, body: 'Is the music licensed for ads as well?' })], caption: [msg({ min: 40, body: 'Love the second slide, great colours.' })] }); }
  // 4. Read, two changes still open (seen after they were written)
  card('p_open', 'Weekend offer story', '2026-10-09', { video: [msg({ min: 3000, is_tweak: true, body: 'Add the store hours at the end.' })], caption: [msg({ min: 2990, is_tweak: true, body: 'Mention the free parking.' })] }, 60);
  // 5. Read, a comment still waiting for an answer
  card('p_waiting', 'Product close-ups', '2026-10-10', { video: [msg({ min: 1500, body: 'Who picked this song? We love it, can we use it again?' })] }, 600);
  // 6. Answered by a teammate (grey staff message new for you, nothing waiting)
  { const q = msg({ min: 300, body: 'When will the next batch be ready?' });
    card('p_staff', 'Recipe teaser', '2026-10-13', { video: [q, reply(q, { min: 18, author: 'Robin Sample', role: 'smm', audience: 'client', body: 'Thursday morning, we will send the link.' })] }, 200); }
  // 7. Kasper
  card('p_kasper', 'Studio tour', '2026-10-14', { video: [msg({ min: 35, author: 'Kasper', role: 'kasper', audience: 'internal', is_tweak: true, body: 'Colour on the last shot is off.' })] });
  // 8. Nothing new, a done change, a comment marked "No reply needed"
  card('p_calm', 'Q&A clip', '2026-10-15', { video: [msg({ min: 5000, is_tweak: true, done: true, body: 'Make the logo bigger.' })], caption: [msg({ min: 4000, body: 'Great job!', done: true })] }, 100);
  // 9. Four kinds at once: a new change, a new comment, a teammate and Kasper
  { const q = msg({ min: 90, body: 'Could the hook be shorter?' });
    card('p_four', 'Launch day recap', '2026-10-16', { video: [msg({ min: 8, is_tweak: true, body: 'Remove the blurry shot at 0:12.' }), q,
      reply(q, { min: 30, author: 'Robin Sample', role: 'smm', audience: 'client', body: 'Yes, we can trim it to three seconds.' }),
      msg({ min: 22, author: 'Kasper', role: 'kasper', audience: 'internal', is_tweak: true, body: 'Audio peaks at the end.' })],
      caption: [msg({ min: 14, body: 'Please add the link in bio line.' })] }, 120); }
  // 10. A long conversation over two days
  { const parts = { video: [], caption: [] };
    const q1 = msg({ min: 2900, body: 'First impressions: love the pace. A few thoughts below.' }); parts.video.push(q1);
    parts.video.push(reply(q1, { min: 2880, author: 'Robin Sample', role: 'smm', audience: 'client', body: 'Thanks! Send them over, we are on it.' }));
    parts.video.push(msg({ min: 2870, is_tweak: true, body: 'Swap the second clip for the one with the window light.' }));
    const q2 = msg({ min: 2860, body: 'Can we use the brand font for the subtitles?' }); parts.video.push(q2);
    parts.video.push(reply(q2, { min: 2700, author: 'Robin Sample', role: 'smm', audience: 'client', body: 'Yes, that is the plan for the next cut.' }));
    parts.video.push(reply(q2, { min: 2690, body: 'Perfect, thank you.' }));
    parts.video.push(msg({ min: 1500, author: 'Kasper', role: 'kasper', audience: 'internal', body: 'Second cut looks good. One colour fix left.' }));
    parts.caption.push(msg({ min: 1450, body: 'Changed the caption to:\n\nOpen daily from nine.\n\nIt was:\n\nOpen daily.' }));
    parts.caption.push(msg({ min: 1400, author: 'Robin Sample', role: 'smm', audience: 'internal', body: 'Caption updated by the client, looks fine to me.' }));
    const q3 = msg({ min: 60, body: 'Who will post it, you or us?' }); parts.caption.push(q3);
    parts.video.push(msg({ min: 45, body: 'The new version is great, much better light.' }));
    parts.video.push(msg({ min: 12, is_tweak: true, body: 'Last thing: end on the logo for two seconds.' }));
    card('p_long', 'Spring collection teaser', '2026-10-17', parts, 600); }
  return out;
}
module.exports = { cards, ago };
