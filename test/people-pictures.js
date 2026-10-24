'use strict';
/* people-pictures.js -- the Slack profile photos the Messages inbox hands to signed-in staff
 * (production-comments/pictures.mjs, unread badges round 5).
 *
 * Fictional people and a faked Slack only:
 *   - only active staff with a Slack id and unarchived clients with a Slack contact are looked up
 *   - each Slack id is looked up once, and only https photo links are kept
 *   - a deleted Slack user, a failed or unreadable answer means no picture, never an error
 *   - first names map to a picture only when they are unique
 *   - the bot token goes only into the Authorization header
 *   - a slow cold lookup does not hold the inbox, and the answer is cached afterwards
 *   - the inbox wiring adds pictures without making them required
 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
let failures = 0;
const ok = (c, m) => { if (c) console.log('  ok  ' + m); else { failures++; console.error('FAIL  ' + m); } };

(async () => {
  const P = await import(require('node:url').pathToFileURL(path.join(root, 'supabase/functions/production-comments/pictures.mjs')).href);
  const staff = [
    { id: 'm-robin', name: 'Robin Sample', slack_user_id: 'UFIXT00001', active: true },
    { id: 'm-robin2', name: 'Robin Other', slack_user_id: 'UFIXT00002', active: true },
    { id: 'm-alex', name: 'Alex', slack_user_id: 'UFIXT00003', active: true },
    { id: 'm-plain', name: 'Plain Link', slack_user_id: 'UFIXT00005', active: true },
    { id: 'm-gone', name: 'Gone Person', slack_user_id: 'UFIXT00004', active: false },
    { id: 'm-noslack', name: 'No Slack', slack_user_id: null, active: true },
    { id: 'm-bad', name: 'Bad Id', slack_user_id: 'not-an-id', active: true },
    { id: 'm-dup', name: 'Same Person', slack_user_id: 'UFIXT00001', active: true },
  ];
  const contacts = [
    { slug: 'alphafixture', slack_mention_user_id: 'UFIXT00010', archived_at: null },
    { slug: 'betafixture', slack_mention_user_id: 'UFIXT00011', archived_at: '2026-01-01T00:00:00Z' },
    { slug: 'gammafixture', slack_mention_user_id: 'UFIXT00012', archived_at: null },
    { slug: 'deltafixture', slack_mention_user_id: '', archived_at: null },
  ];
  const plan = P.picturePlan(staff, contacts);
  ok(plan.members.map(m => m.id).join() === 'm-robin,m-robin2,m-alex,m-plain,m-dup', 'only active staff with a real Slack id are planned');
  ok(plan.clients.map(c => c.slug).join() === 'alphafixture,gammafixture', 'only unarchived clients with a Slack contact are planned');

  const calls = [];
  const answers = {
    UFIXT00001: { ok: true, user: { profile: { image_72: 'https://avatars.example.test/robin_72.png' } } },
    UFIXT00002: { ok: true, user: { profile: { image_72: 'https://avatars.example.test/robin2_72.png' } } },
    UFIXT00005: { ok: true, user: { profile: { image_72: 'http://insecure.example.test/x.png' } } },
    UFIXT00003: { ok: true, user: { profile: { image_48: 'https://avatars.example.test/alex_48.png' } } },
    UFIXT00010: { ok: true, user: { profile: { image_72: 'https://avatars.example.test/alpha_72.png' } } },
    UFIXT00012: { ok: true, user: { deleted: true, profile: { image_72: 'https://avatars.example.test/gamma.png' } } },
  };
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    const id = new URL(url).searchParams.get('user');
    const body = JSON.stringify(answers[id] || { ok: false, error: 'user_not_found' });
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const got = await P.resolvePictures(plan, 'xoxb-fixture-token', fakeFetch);
  ok(calls.length === 6, 'each Slack id is asked once (6 distinct ids)');
  ok(calls.every(c => !c.url.includes('xoxb') && c.init.headers.authorization === 'Bearer xoxb-fixture-token'), 'the token is only in the Authorization header');
  ok(calls.every(c => c.url.startsWith('https://slack.com/api/users.info?') && c.init.redirect === 'error'), 'only users.info, no redirects');
  ok(got.members['m-robin'] === 'https://avatars.example.test/robin_72.png' && got.members['m-dup'] === got.members['m-robin'], 'staff get their Slack photo, shared ids share it');
  ok(!got.members['m-plain'] && got.members['m-robin2'], 'a non-https link is dropped');
  ok(got.members['m-alex'] === 'https://avatars.example.test/alex_48.png', 'a smaller size is used when 72 px is missing');
  ok(got.clients.alphafixture === 'https://avatars.example.test/alpha_72.png' && !got.clients.gammafixture, 'clients get their contact photo; a deleted Slack user gets none');
  ok(got.names['robin sample'] && got.names.alex && !got.names.robin, 'names map to photos; a first name shared by two people does not');

  const broken = await P.resolvePictures(plan, 't', async () => { throw new Error('offline'); });
  ok(Object.keys(broken.members).length === 0 && Object.keys(broken.clients).length === 0, 'Slack unreachable: no pictures, no error');
  const huge = await P.resolvePictures({ members: [{ id: 'm', name: 'x', slack: 'UFIXT00001' }], clients: [] }, 't',
    async () => new Response('{"ok":true,"pad":"' + 'x'.repeat(70000) + '"}'));
  ok(!huge.members.m, 'an oversized answer is refused');

  // The cache: a slow cold lookup answers null at the wait limit, later calls get the stored answer.
  let t = 1000;
  const cache = P.makePictureCache(() => t);
  let loads = 0;
  const slow = () => { loads++; return new Promise(r => setTimeout(() => r({ members: { a: 'https://x.test/a.png' } }), 60)); };
  ok(await cache.get(slow, 10) === null, 'a slow cold lookup does not hold the inbox');
  await new Promise(r => setTimeout(r, 80));
  const warm = await cache.get(slow, 10);
  ok(warm && warm.members.a && loads === 1, 'the finished lookup is cached and not repeated');
  t += P.PICTURES_TTL_MS + 1;
  await cache.get(slow, 200);
  ok(loads === 2, 'the cache is refreshed after its lifetime');
  const failing = P.makePictureCache(() => 0);
  ok(await failing.get(() => Promise.reject(new Error('x')), 50) === null, 'a failed lookup answers no pictures');

  const src = fs.readFileSync(path.join(root, 'supabase/functions/production-comments/index.ts'), 'utf8');
  ok(/wantPictures \? peoplePictures\(supabase\) : Promise\.resolve\(null\)/.test(src) && /\.\.\.\(pictures \? \{ pictures \} : \{\}\)/.test(src), 'the inbox looks pictures up only when the page asks, and adds them only when they are there');
  ok(/const wantPictures = body\.pictures === true \|\| body\.pictures === 1 \|\| body\.pictures === "1";/.test(src), 'asking is explicit: pictures true, 1 or "1"');
  ok(/catch \(_e\) \{\s*return null;/.test(src.slice(src.indexOf('async function peoplePictures'))), 'a pictures failure never fails the inbox');
  ok(!/people_pictures|insert|upsert/.test(fs.readFileSync(path.join(root, 'supabase/functions/production-comments/pictures.mjs'), 'utf8')), 'nothing is stored');

  if (failures) { console.error(`people-pictures: ${failures} failed`); process.exit(1); }
  console.log('people-pictures: all passed');
})().catch(e => { console.error(e); process.exit(1); });
