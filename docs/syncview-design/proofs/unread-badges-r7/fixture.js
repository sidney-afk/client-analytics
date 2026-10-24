'use strict';
/* Fictional notes for the round-7 unread-badges screenshots (session Beacon, 2026-10-24): round 6's cards, plus one
   card holding every state a note or message can be in, for the spacing audit (short, long, several lines, with
   attachments, replies, a change request with a reply under it, a team-only note, an automatic record). Every name,
   title and line is made up. The signed-in harness member is m1 ("Browser Staff"). */
const r6 = require('../unread-badges-r6/fixture');
const { ago } = r6;

let n = 0;
const msg = (o) => {
  const id = o.id || 'a' + (++n);
  const created = ago(o.min || 30);
  return Object.assign({ id, parent_id: null, root_id: id, author: 'Casey Rivera', role: 'client', audience: 'client',
    is_tweak: false, done: false, created_at: created, updated_at: created, round: 1 }, o, { id, created_at: created, updated_at: created });
};
const reply = (root, o) => msg(Object.assign({ parent_id: root.id, root_id: root.id }, o));
const ME = { author: 'Browser Staff', author_member_id: 'm1', role: 'admin' };
const TEAM = { author: 'Robin Sample', role: 'smm' };

function cards() {
  n = 0;
  const out = r6.cards();
  const chg = msg({ min: 400, is_tweak: true, body: 'Swap the second clip for the wider shot.' });
  const q = msg({ min: 300, body: 'Short one.' });
  const parts = {
    video: [
      chg,
      reply(chg, Object.assign({ min: 390, body: 'Done in the next cut.' }, ME)),
      q,
      reply(q, Object.assign({ min: 290, audience: 'client', body: 'Sure.' }, TEAM)),
      msg({ min: 200, body: 'A long note that runs on for a while so that it wraps over several lines in the Notes panel: the intro feels slow, the music comes in late, and the last shot holds a second too long before the logo appears on screen.' }),
      msg({ min: 150, body: 'Three things:\n\n1. Brighter first shot\n2. Bigger subtitles\n3. Logo at the end' }),
      msg({ min: 100, body: 'Here are the photos for the cover.', attachments: [{ name: 'cover-option-1.jpg', url: 'https://example.invalid/cover-1.jpg' }, { name: 'cover-option-2.jpg', url: 'https://example.invalid/cover-2.jpg' }] }),
      msg(Object.assign({ min: 60, audience: 'internal', body: 'Team only: waiting on the music licence before export.' }, TEAM)),
    ],
    caption: [
      msg({ min: 40, body: 'Changed the caption to:\n\nNew drop this Friday.\n\nIt was:\n\nNew drop soon.' }),
      msg({ min: 25, body: 'Can we add the link in bio line?' }),
    ],
  };
  out.push({ id: 'p_audit', name: 'Every kind of note', date: '2026-10-18', parts, seen: 350 });
  return out;
}
module.exports = { cards, ago };
