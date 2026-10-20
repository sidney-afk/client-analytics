#!/usr/bin/env node
// The Synchro connector's "video_cards" tool: per video card, the batch, number,
// title, brief, status, every note (card, SyncLinear, Frame.io with the time in
// the video), the latest edit link, the raw footage folder and a download link.
// Read only. Offline: the database reads and Frame.io are mocked; every name and
// link below is made up.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'supabase', 'functions', 'higgsfield-mcp');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

const PLAN = { client_slug: 'testclient', client_name: 'Test Client' };
const NEW = { id: 'b2', name: 'Test Client · 12 Oct 2026', status: 'active', purpose: 'calendar', created_at: '2026-10-12T00:00:00Z', footage_folder_url: 'https://drive.google.com/drive/folders/FOLDER_NEW', filming_doc_url: 'https://docs.google.com/document/d/DOC_NEW/edit' };
const OLD = { id: 'b1', name: 'Test Client · 1 Sept 2026', status: 'done', purpose: 'calendar', created_at: '2026-09-01T00:00:00Z', footage_folder_url: 'https://drive.google.com/drive/folders/FOLDER_OLD', filming_doc_url: '' };

const item = (id, batch, title, extra = {}) => ({ id, batch_id: batch, kind: 'video', title, brief: '', status: 'tweak', status_at: null, file_url: null, card_id: null, updated_at: '2026-10-15T00:00:00Z', ...extra });
const ITEMS = [
  item('d7', 'b2', 'Video 7 — Morning routine', { brief: 'Script: say hello. Raw footage at 1:33.' }),
  item('d8', 'b2', 'Video 8'),
  item('d12old', 'b1', 'Video 12 — Old one'),
  item('d7old', 'b1', 'Video 7 — Older seven'),
  item('dx', 'b2', 'Video 9', { status: 'canceled' }),
];
const cardTweaks = JSON.stringify([
  { id: 'c1', body: 'Cut the first two seconds', role: 'client', author: 'Alex Example', is_tweak: true, done: false, round: 1, created_at: '2026-10-14T10:00:00Z', audience: 'client' },
  { id: 'c2', body: 'Old note', role: 'smm', author: 'Sam Sample', is_tweak: false, done: true, created_at: '2026-10-13T10:00:00Z' },
  { id: 'c3', body: 'deleted one', author: 'Sam Sample', deleted: true, created_at: '2026-10-13T11:00:00Z' },
]);
const CARDS = [
  { id: 'p7', name: 'Video 7 — Morning routine', status: 'In Progress', video_status: 'Tweaks Needed', asset_url: 'https://f.io/abcDEF12', video_tweaks: cardTweaks, tweaks: '', video_deliverable_id: 'd7', scheduled_date: '2026-10-20', updated_at: '' },
  { id: 'p8', name: 'Video 8', status: 'In Progress', video_status: 'For SMM Approval', asset_url: '', video_tweaks: '', tweaks: '', video_deliverable_id: 'd8', scheduled_date: '', updated_at: '' },
  { id: 'p30', name: 'Video 30', status: 'Archived', video_status: '', asset_url: '', video_tweaks: '', tweaks: '', video_deliverable_id: null, scheduled_date: '', updated_at: '' },
];
const COMMENTS = [
  // A SyncLinear copy of card note c1: shown once.
  { id: 'x1', native_comment_id: 'c1', deliverable_id: 'd7', author_name: 'Alex Example', role: 'client', body: 'Cut the first two seconds', is_tweak: true, round: 1, resolved_at: null, deleted_at: null, created_at: '2026-10-14T10:00:01Z' },
  { id: 'x2', native_comment_id: null, deliverable_id: 'd7', author_name: 'Robin Reviewer', role: 'admin', body: 'Music too loud at the end', is_tweak: true, round: 1, resolved_at: null, deleted_at: null, component: 'video', created_at: '2026-10-15T09:00:00Z' },
  { id: 'x3', native_comment_id: null, deliverable_id: 'd7', author_name: 'Robin Reviewer', role: 'admin', body: 'Caption note', is_tweak: true, component: 'caption', created_at: '2026-10-15T09:00:00Z' },
];
const FRAME = {
  ok: true,
  video: { url: 'https://assets.frame.io/hq.mp4', renditions: { original: 'https://assets.frame.io/orig.mov', high_quality: 'https://assets.frame.io/hq.mp4', efficient: 'https://assets.frame.io/small.mp4' }, expires_at: '2026-10-20T12:00:00.000Z', name: 'video7_v3.mov' },
  comments: [
    { id: 'f1', text: 'Zoom in here', author: 'Robin Reviewer', created_at: '2026-10-15T08:00:00Z', time_seconds: 75.4, done: false, replies: [{ text: 'On it', author: 'Eddie Editor', created_at: '2026-10-15T08:05:00Z' }] },
    { id: 'f2', text: 'Fixed already', author: '', created_at: '2026-10-14T08:00:00Z', time_seconds: null, done: true, replies: [] },
  ],
  comments_error: '',
};

function deps(opts = {}) {
  const calls = { frameio: [], comments: [] };
  return {
    calls,
    findClient: async (q) => {
      if (/^test/i.test(q)) return { plan: PLAN };
      if (/^t$/i.test(q)) return { choices: ['Test Client', 'Two Client'] };
      return { choices: [] };
    },
    batches: async () => [OLD, NEW],
    deliverables: async () => ITEMS,
    cards: async () => CARDS,
    comments: async (ids) => { calls.comments.push(ids); return COMMENTS.filter((c) => ids.includes(c.deliverable_id)); },
    frameio: opts.noFrame ? undefined : async (link) => { calls.frameio.push(link); if (opts.frameFails) throw new Error('Frame.io is busy right now. Try again in a minute.'); return FRAME; },
  };
}
const parse = (text) => JSON.parse(text.slice(text.indexOf('\n') + 1));

(async () => {
  const v = await import(path.join(dir, 'videocards.mjs'));
  const who = await import(path.join(dir, 'who.mjs'));

  // Small helpers.
  assert.strictEqual(v.videoNumber('Video 7 — x'), 7);
  assert.strictEqual(v.videoNumber('Thumbnail 7'), null);
  assert.strictEqual(v.videoNumber('', 'video#12'), 12);
  assert.strictEqual(v.titleOf('Video 6 — Video 6 - Short 3'), 'Short 3');
  assert.strictEqual(v.titleOf('Video 8'), '');
  assert.strictEqual(v.clock(75.4), '1:15');
  assert.strictEqual(v.clock(3725), '1:02:05');
  assert.deepStrictEqual(v.parseVideos([12, 7, 8]), [7, 8, 12]);
  assert.deepStrictEqual(v.parseVideos('7, 8 and 12'), [7, 8, 12]);
  assert.deepStrictEqual(v.parseVideos('7-9'), [7, 8, 9]);
  assert.deepStrictEqual(v.parseVideos(undefined), []);
  assert.strictEqual(v.parseVideos('the funny ones'), null);
  assert.strictEqual(v.parseVideos([1.5]), null);

  // Ambiguous or unknown client: asks which, like every other client tool.
  let out = await v.videoCards(deps(), { client: 't', videos: [7] });
  assert.ok(out.startsWith('Which client? Options: Test Client, Two Client'), out);
  assert.strictEqual(who.outcomeOf('video_cards', out).ok, false, 'an ask is logged as not done');
  out = await v.videoCards(deps(), { client: 'Test', videos: 'the funny ones' });
  assert.ok(out.startsWith('Give videos'), out);

  // Videos 7, 8 and 12: 7 and 8 from the newest batch, 12 only in the older one.
  let d = deps();
  out = await v.videoCards(d, { client: 'Test Client', videos: [7, 8, 12] });
  assert.ok(out.startsWith('Test Client: 3 video cards from SyncView (read only).'), out);
  assert.strictEqual(who.outcomeOf('video_cards', out).ok, true);
  let body = parse(out);
  assert.deepStrictEqual(body.videos.map((x) => [x.video, x.batch]), [[7, NEW.name], [8, NEW.name], [12, OLD.name]]);
  assert.ok(body.notes.some((n) => n.includes('Video 12 is not in') && n.includes(OLD.name)), 'says 12 came from another batch');
  assert.ok(body.notes.some((n) => n.includes('Video 7 is also in') && n.includes(OLD.name)), 'says 7 is in another batch too');
  assert.deepStrictEqual(d.calls.frameio, ['https://f.io/abcDEF12'], 'Frame.io asked only for the card that has a Frame.io link');

  const seven = body.videos[0];
  assert.strictEqual(seven.title, 'Morning routine');
  assert.strictEqual(seven.status, 'Tweaks Needed');
  assert.strictEqual(seven.work_item_status, 'tweak');
  assert.strictEqual(seven.brief, 'Script: say hello. Raw footage at 1:33.');
  assert.strictEqual(seven.latest_edit, 'https://f.io/abcDEF12');
  assert.strictEqual(seven.raw_footage, NEW.footage_folder_url);
  assert.strictEqual(seven.filming_doc, NEW.filming_doc_url);
  assert.strictEqual(seven.syncview_card, 'https://syncview.synchrosocial.com/#calendar/testclient/p7');
  assert.strictEqual(seven.synclinear, 'https://syncview.synchrosocial.com/?prod=1&d=d7#production');
  // Notes: card notes and SyncLinear notes merged, the copy shown once, deleted and caption notes left out, oldest first.
  assert.deepStrictEqual(seven.notes.map((n) => n.text), ['Old note', 'Cut the first two seconds', 'Music too loud at the end']);
  assert.deepStrictEqual(seven.notes.map((n) => n.from), ['SyncView card', 'SyncView card', 'SyncLinear']);
  assert.strictEqual(seven.notes[1].who, 'Alex Example');
  assert.strictEqual(seven.notes[1].when, '2026-10-14 10:00 UTC');
  assert.strictEqual(seven.notes[1].tweak, true);
  assert.strictEqual(seven.notes[1].for_client, true);
  // Frame.io: time in the video, replies, done flag.
  assert.strictEqual(seven.frameio_notes[0].time_in_video, '1:15');
  assert.strictEqual(seven.frameio_notes[0].replies[0].text, 'On it');
  assert.strictEqual(seven.frameio_notes[1].who, 'a guest');
  assert.strictEqual(seven.frameio_notes[1].done, true);
  // Open tweaks: 2 open change requests plus 1 open Frame.io note.
  assert.strictEqual(seven.open_tweaks, 3);
  assert.deepStrictEqual(seven.download, { edit_video: 'https://assets.frame.io/orig.mov', edit_video_small: 'https://assets.frame.io/small.mp4', file_name: 'video7_v3.mov', link_expires: '2026-10-20T12:00:00.000Z' });
  assert.ok(/import_file/.test(body.how_to_download) && /client_filming_plan/.test(body.how_to_download));
  // Video 8 has no edit link yet.
  assert.strictEqual(body.videos[1].latest_edit, null);
  assert.strictEqual(body.videos[1].download, null);

  // A batch asked for by its date: only that batch.
  out = await v.videoCards(deps(), { client: 'Test', videos: [7], batch: '1 Sept' });
  body = parse(out);
  assert.deepStrictEqual(body.videos.map((x) => [x.video, x.title]), [[7, 'Older seven']]);
  // A batch that matches nothing asks which, listing the batches newest first.
  out = await v.videoCards(deps(), { client: 'Test', batch: 'March' });
  assert.ok(out.startsWith('Which batch?'), out);
  assert.ok(out.indexOf(NEW.name) < out.indexOf(OLD.name));
  assert.strictEqual(who.outcomeOf('video_cards', out).ok, false);
  // No videos: the whole newest batch, canceled ones left out, in number order.
  out = await v.videoCards(deps(), { client: 'Test' });
  assert.deepStrictEqual(parse(out).videos.map((x) => x.video), [7, 8]);
  // A number nobody has.
  out = await v.videoCards(deps(), { client: 'Test', videos: [40] });
  assert.ok(out.startsWith('Could not find video 40 for Test Client'), out);
  out = await v.videoCards(deps(), { client: 'Test', videos: [7, 40] });
  assert.ok(parse(out).notes.includes('Not found: video 40.'));

  // Frame.io failing, or switched off: the rest still answers.
  out = await v.videoCards(deps({ frameFails: true }), { client: 'Test', videos: [7] });
  body = parse(out);
  assert.strictEqual(body.videos[0].frameio_problem, 'Frame.io is busy right now. Try again in a minute.');
  assert.strictEqual(body.videos[0].notes.length, 3);
  d = deps();
  out = await v.videoCards(d, { client: 'Test', videos: [7], frameio: false });
  assert.strictEqual(d.calls.frameio.length, 0);
  assert.ok(parse(out).notes.some((n) => n.includes('frameio false')));
  out = await v.videoCards(deps({ noFrame: true }), { client: 'Test', videos: [7] });
  assert.deepStrictEqual(parse(out).videos[0].frameio_notes, []);

  // Too many videos asked for.
  out = await v.videoCards(deps(), { client: 'Test', videos: Array.from({ length: 31 }, (_, i) => i + 1) });
  assert.ok(out.startsWith('At most 30'), out);

  // Long notes are shortened with a named list, never cut silently (lessons rule 8).
  const huge = { ...CARDS[0], video_tweaks: JSON.stringify(Array.from({ length: 120 }, (_, i) => ({ id: 'h' + i, body: 'x'.repeat(900), author: 'A', is_tweak: true, created_at: '2026-10-14T10:00:00Z' }))) };
  const big = deps();
  big.cards = async () => [huge, CARDS[1]];
  out = await v.videoCards(big, { client: 'Test', videos: [7] });
  body = parse(out);
  assert.ok(out.length <= v.MAX_CHARS + 200, 'stays inside the answer limit');
  assert.ok(body.notes.some((n) => n.includes('[cut]') && n.includes('video 7')));

  // Review finding 1: a card is joined only when both links agree.
  {
    const dd = deps();
    // d7 names card p7; a stale card p7old also points back at d7 and comes first.
    const stale = { ...CARDS[0], id: 'p7old', video_status: 'Approved', asset_url: 'https://f.io/STALE999', video_tweaks: '' };
    dd.cards = async () => [stale, ...CARDS];
    dd.deliverables = async () => ITEMS.map((x) => (x.id === 'd7' ? { ...x, card_id: 'p7' } : x));
    let b = parse(await v.videoCards(dd, { client: 'Test', videos: [7] }));
    assert.strictEqual(b.videos[0].syncview_card.endsWith('/p7'), true, 'the card the work item names wins over a stale back link');
    assert.strictEqual(b.videos[0].latest_edit, 'https://f.io/abcDEF12');
    assert.strictEqual(b.videos.length, 1, 'the stale card is not shown on its own');
    // card_id names a card that points elsewhere: no card is joined, and it says so.
    dd.deliverables = async () => ITEMS.map((x) => (x.id === 'd7' ? { ...x, card_id: 'p8' } : x));
    b = parse(await v.videoCards(dd, { client: 'Test', videos: [7] }));
    assert.strictEqual(b.videos[0].syncview_card, null);
    assert.strictEqual(b.videos[0].latest_edit, null);
    assert.ok(/do not point at each other/.test(b.videos[0].card_problem));
    assert.strictEqual(b.videos[0].brief, 'Script: say hello. Raw footage at 1:33.', 'the work item itself still answers');
    // No card_id and two cards pointing back: none is picked (no reliance on row order).
    dd.deliverables = async () => ITEMS;
    b = parse(await v.videoCards(dd, { client: 'Test', videos: [7] }));
    assert.strictEqual(b.videos[0].syncview_card, null);
    assert.ok(/More than one Calendar card/.test(b.videos[0].card_problem));
  }

  // Review finding 2: legacy flags. A note in a *_tweaks column is a change
  // request even with is_tweak false or missing; resolved / resolved_at / "true" mean done.
  {
    const notes = v.cardNotes({ video_tweaks: JSON.stringify([
      { id: 'a', body: 'no flag', created_at: '2026-10-01T00:00:00Z' },
      { id: 'b', body: 'stale false', is_tweak: false, created_at: '2026-10-02T00:00:00Z' },
      { id: 'c', body: 'resolved flag', resolved: true, created_at: '2026-10-03T00:00:00Z' },
      { id: 'd', body: 'resolved at', resolved_at: '2026-10-04T00:00:00Z', created_at: '2026-10-03T00:00:00Z' },
      { id: 'e', body: 'string done', done: 'true', created_at: '2026-10-03T00:00:00Z' },
      { id: 'f', body: 'graphic note', component: 'graphic', created_at: '2026-10-03T00:00:00Z' },
    ]) });
    assert.deepStrictEqual(notes.map((n) => [n.id, n.tweak, n.done]), [['a', true, false], ['b', true, false], ['c', true, true], ['d', true, true], ['e', true, true]]);
    const dd = deps({ noFrame: true });
    dd.cards = async () => [{ ...CARDS[0], video_tweaks: JSON.stringify([{ id: 'a', body: 'no flag' }, { id: 'c', body: 'resolved', resolved: 1 }]) }, CARDS[1]];
    dd.comments = async () => [];
    const b = parse(await v.videoCards(dd, { client: 'Test', videos: [7] }));
    assert.strictEqual(b.videos[0].open_tweaks, 1);
  }

  // Review finding 3: plain text in the column is an older single note, not nothing.
  {
    const legacy = v.cardNotes({ video_tweaks: '', tweaks: 'Make the intro faster' });
    assert.strictEqual(legacy.length, 1);
    assert.strictEqual(legacy[0].text, 'Make the intro faster');
    assert.strictEqual(legacy[0].tweak, true);
    assert.strictEqual(legacy[0].done, false);
    assert.strictEqual(legacy[0].legacy_text, true);
    assert.strictEqual(legacy[0].who, v.LEGACY_AUTHOR);
    assert.strictEqual(v.cardNotes({ video_tweaks: '[not json' })[0].text, '[not json', 'unreadable JSON is kept as text too');
    assert.deepStrictEqual(v.cardNotes({ video_tweaks: '', tweaks: '' }), []);
  }

  // Review finding 4: every tombstone shape hides the note.
  {
    const notes = v.cardNotes({ video_tweaks: JSON.stringify([
      { id: 'a', body: 'gone 1', is_deleted: true },
      { id: 'b', body: 'gone 2', deleted_at: '2026-10-01T00:00:00Z' },
      { id: 'c', body: 'gone 3', deleted: 'yes' },
      { id: 'd', body: 'gone 4', hidden: 1 },
      { id: 'e', body: 'kept', deleted: false, is_deleted: 0 },
    ]) });
    assert.deepStrictEqual(notes.map((n) => n.id), ['e']);
  }
  // The rules above are the feedback reader's; fail loudly if that reader changes them.
  {
    const fb = fs.readFileSync(path.join(root, 'supabase', 'functions', 'production-comments', 'feedback.mjs'), 'utf8');
    assert.ok(fb.includes("const deleted = truthy(raw.deleted) || truthy(raw.is_deleted) || !!clean(raw.deleted_at);"), 'feedback.mjs tombstone rule unchanged');
    assert.ok(fb.includes("const resolved = truthy(raw.done) || truthy(raw.resolved) || !!clean(raw.resolved_at);"), 'feedback.mjs done rule unchanged');
    assert.ok(fb.includes("raw.is_tweak === true || /_tweaks$/.test(field) ? true"), 'feedback.mjs tweak rule unchanged');
    assert.ok(fb.includes("['true', '1', 'yes'].includes(clean(value).toLowerCase())"), 'feedback.mjs truthy rule unchanged');
  }

  // Review finding 5: a cut Frame.io list says so.
  {
    const dd = deps();
    dd.frameio = async () => ({ ...FRAME, comments_truncated: true });
    const b = parse(await v.videoCards(dd, { client: 'Test', videos: [7] }));
    assert.ok(/more than 2 Frame\.io notes; only the first 2 are listed/.test(b.videos[0].frameio_problem), b.videos[0].frameio_problem);
  }

  // Wiring: the tool is listed, routed, read only, and reuses the Frame.io lookup.
  const index = read('index.ts');
  assert.ok(/name: "video_cards"/.test(index), 'tool listed');
  assert.ok(/if \(name === "video_cards"\) return await videoCards\(videoCardDeps\(\), args\)/.test(index), 'tool routed');
  assert.ok(/from "\.\.\/frameio-view\/logic\.mjs"/.test(index), 'reuses the Watch here Frame.io lookup');
  const depsSrc = index.slice(index.indexOf('function videoCardDeps()'), index.indexOf('// One fp_settings value'));
  assert.ok(depsSrc.length > 100);
  assert.ok(!/\.(insert|update|upsert|delete|rpc)\(/.test(depsSrc), 'video_cards deps never write');
  const mod = read('videocards.mjs');
  assert.ok(!/\b(insert|upsert)\(|\.delete\(/.test(mod), 'videocards.mjs never writes');
  assert.ok(who.FAILURE_OPENINGS.includes('Which batch?'));

  console.log('higgsfield-video-cards: ok');
})().catch((e) => { console.error(e); process.exit(1); });
