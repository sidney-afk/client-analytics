'use strict';
/* Fictional posts and notes. Made-up names and text only. */
const SLUG = 'samplebakery';
const t = (d, h) => `2026-10-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00Z`;
const post = (i, name, over) => Object.assign({
  id: 'p' + i, client: SLUG, client_slug: SLUG, name, status: 'In Progress', post_type: 'Reel', type: 'Reel', platforms: ['instagram'],
  scheduled_date: '2026-10-' + String(17 + i).padStart(2, '0'), order_index: i,
  video_status: 'Client Approval', graphic_status: 'Client Approval', caption_status: 'Client Approval',
  caption: 'Three small swaps for a calmer morning. Which one are you trying first?', thumbnail_url: `https://img.example.invalid/${i}.png`,
  asset_url: 'https://f.io/sample' + i, comments: [], graphic_comments: [], caption_comments: [], tweaks: [], updated_at: t(15, 12)
}, over || {});
const posts = () => [
  post(1, 'Morning routine, 3 swaps', { video_status: 'Tweaks Needed' }),
  post(2, 'Behind the counter', { graphic_status: 'Kasper Approval' }),
  post(3, 'Weekend specials', { video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved' }),
  post(4, 'Meet the bakers'),
  post(5, 'Sourdough in 60 seconds', { caption_status: 'For SMM Approval' })
];
const m = (id, role, author, body, d, h, extra) => Object.assign({ id, parent_id: null, role, author, body, created_at: t(d, h), updated_at: t(d, h), done: false }, extra || {});
/* Thread for post 1. `long` adds an older run of messages. */
function notes(long) {
  const video = [
    m('v1', 'smm', 'Alex', 'Cut the first 2 seconds, the hook starts late.', 14, 14, { audience: 'internal', is_tweak: true, round: 2 }),
    m('v2', 'kasper', 'Kasper', 'Agree. Also lift the music under the voice.', 14, 16, { parent_id: 'v1', audience: 'internal', is_tweak: false }),
    m('v3', 'smm', 'Mia', 'Can this one go out Friday instead of Thursday?', 16, 13, { audience: 'internal', is_tweak: false })
  ];
  const graphic = [
    m('g1', 'client', 'Client', 'Love this one! Could the text be a bit bigger?', 16, 12, { audience: 'client', is_tweak: false }),
  ];
  const caption = [
    m('c1', 'client', 'Client', 'Can we mention the weekend opening hours?', 13, 15, { audience: 'client', is_tweak: false }),
    m('c2', 'smm', 'Alex', 'Added. Have a look at the new line.', 13, 17, { parent_id: 'c1', audience: 'client', is_tweak: false })
  ];
  if (long) for (let i = 0; i < 10; i++) video.unshift(m('o' + i, i % 2 ? 'kasper' : 'smm', i % 2 ? 'Kasper' : 'Alex', ['First cut is up.', 'Pacing feels slow in the middle.', 'Trimmed 4 seconds.', 'Better. Colour looks a little cold.', 'Warmed it up.', 'Good. Check the subtitles.', 'Fixed two typos.', 'Logo is too small at the end.', 'Made it bigger.', 'Great, send to the client.'][i], 8 + Math.floor(i / 2), 10 + i, { audience: 'internal', is_tweak: false }));
  return { comments: video, graphic_comments: graphic, caption_comments: caption };
}
/* What the client's store holds for post 1 under the new rule: client-audience
   notes only (team notes live in the server-filtered store and never arrive). */
function clientNotes() {
  return {
    comments: [],
    graphic_comments: [
      m('g1', 'client', 'Client', 'Love this one! Could the text be a bit bigger?', 15, 12, { audience: 'client', is_tweak: false }),
      m('g2', 'smm', 'Synchro team', 'Bigger text is in. Does it read well on your phone?', 16, 13, { parent_id: 'g1', audience: 'client', is_tweak: false })
    ],
    caption_comments: [
      m('c1', 'client', 'Client', 'Can we mention the weekend opening hours?', 13, 15, { audience: 'client', is_tweak: false }),
      m('c2', 'smm', 'Synchro team', 'Added. Have a look at the new line.', 16, 14, { parent_id: 'c1', audience: 'client', is_tweak: false })
    ]
  };
}
module.exports = { posts, notes, clientNotes, SLUG };
