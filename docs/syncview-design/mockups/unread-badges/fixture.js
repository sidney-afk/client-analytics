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
  return out;
}
module.exports = { cards, ago };
