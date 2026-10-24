'use strict';
/* Fictional posts and notes for the phone redesign mockups (session Palm, 2026-10-23).
   Every name, title, caption and line below is made up. Seeds the offline harness
   (docs/syncview-design/tests/lost-work-lib.js) so the REAL page renders them. Times are relative to now. */
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
let n = 0;
const msg = (o) => {
  const id = o.id || 'n' + (++n);
  const created = ago(o.min || 30);
  return Object.assign({ id, parent_id: null, root_id: id, author: 'Sample Client', role: 'client', audience: 'client',
    is_tweak: false, done: false, round: 1 }, o, { id, created_at: created, updated_at: created });
};
const reply = (root, o) => msg(Object.assign({ parent_id: root.id, root_id: root.id, audience: root.audience }, o));
const day = (d) => { const t = new Date(); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };

const CAPTIONS = [
  'Mornings start here. Fresh bread out of the oven at 7, coffee ready at 7:05. Come say hi before work. #localbakery #morningroutine',
  'Meet the people behind the counter. Five faces, one oven, a lot of flour on the floor.',
  'This weekend only: two pastries and a coffee for the price of one. Show this post at the till.',
  'Close-ups of the new spring range. Which one would you pick first?',
];

function cards() {
  n = 0;
  const out = [];
  const card = (o) => out.push(Object.assign({ status: 'In Progress', video: 'In Progress', graphic: 'In Progress', caption: 'In Progress', parts: {} }, o));

  // A long conversation: change, question, team answer, follow-up, staff note, Kasper.
  {
    const c1 = msg({ min: 2900, is_tweak: true, body: 'Can we cut the first two seconds? It starts on an empty counter.' });
    const r1 = reply(c1, { min: 2860, author: 'Robin Sample', role: 'smm', body: 'Yes, trimmed. The new cut opens on the bread coming out of the oven.' });
    const r2 = reply(c1, { min: 2700, body: 'Perfect, much better.' });
    const q = msg({ min: 1500, body: 'Is the music licensed for ads as well, or only for the post?' });
    const q1 = reply(q, { min: 1440, author: 'Robin Sample', role: 'smm', body: 'Only organic for now. If you want to boost it we will swap the track for one from the ads library.' });
    const q2 = reply(q, { min: 1400, body: 'OK. Then let us keep this one organic and do a separate ad version next month.' });
    const s = msg({ min: 900, author: 'Robin Sample', role: 'smm', audience: 'internal', body: 'Editor: please export a 4:5 version too, they may use it in the newsletter.' });
    const k = msg({ min: 620, author: 'Kasper', role: 'kasper', audience: 'internal', is_tweak: true, body: 'Colour on the last shot is a bit green. Warm it up slightly.' });
    const c2 = msg({ min: 45, is_tweak: true, body: 'Last thing: the logo at the end is too small on a phone. Can it be twice as big?' });
    const q3 = msg({ min: 12, body: 'Also, can we post this on Friday instead of Thursday?' });
    card({ id: 'p_morning', name: 'Morning routine reel', date: day(1), video: 'Tweaks Needed', caption: 'Client Approval', graphic: 'Approved',
      parts: { video: [c1, r1, r2, q, q1, q2, s, k, c2], caption: [q3] }, seen: 300 });
  }
  card({ id: 'p_team', name: 'Meet the team carousel', date: day(2), video: 'Client Approval', graphic: 'Client Approval', caption: 'Client Approval',
    parts: { caption: [msg({ min: 200, body: 'Love the second slide, great colours.' })] } });
  card({ id: 'p_offer', name: 'Weekend offer story', date: day(3), video: 'Kasper Approval', graphic: 'In Progress', caption: 'Approved',
    parts: { video: [msg({ min: 3000, is_tweak: true, body: 'Add the store hours at the end.' })] }, seen: 60 });
  card({ id: 'p_close', name: 'Spring range close-ups', date: day(5), video: 'In Progress', graphic: 'In Progress', caption: 'In Progress' });
  card({ id: 'p_recipe', name: 'Recipe teaser: cinnamon buns', date: day(6), video: 'For SMM Approval', graphic: 'For SMM Approval', caption: 'In Progress' });
  card({ id: 'p_tour', name: 'Kitchen tour', date: day(8), video: 'Approved', graphic: 'Approved', caption: 'Approved', status: 'Approved' });
  card({ id: 'p_qa', name: 'Baker Q&A: sourdough', date: day(9), video: 'Client Approval', graphic: 'Approved', caption: 'Client Approval' });
  card({ id: 'p_local', name: 'Local farm visit', date: day(12), video: 'In Progress', graphic: 'In Progress', caption: 'In Progress' });
  card({ id: 'p_old', name: 'Opening day throwback', date: day(-4), video: 'Posted', graphic: 'Posted', caption: 'Posted', status: 'Posted' });
  out.forEach((c, i) => { c.captionText = CAPTIONS[i % CAPTIONS.length]; });
  return out;
}
module.exports = { cards, ago, day };
