'use strict';
/* Builds the 2026-10 Notes + Messages mockups from the REAL app.
 * Run from the repo root:  node docs/syncview-design/mockups/2026-10-notes-messages/tools/build.js
 * Each screen is the live index.html with fictional data; only the parts named
 * in new-parts.css (and injected below) are new. Output: ../*.html, ../screens/*.png */
const fs = require('fs'), path = require('path');
const { serve, open, settle, freeze, chromium, CLIENT, ART_URI } = require('./base');
const F = require('./fixtures');
const OUT = path.resolve(__dirname, '..'), SHOTS = path.join(OUT, 'screens');
const NEW_CSS = fs.readFileSync(path.join(__dirname, 'new-parts.css'), 'utf8');
fs.mkdirSync(SHOTS, { recursive: true });
const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const LOCK = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6.5" width="8" height="5" rx="1"/><path d="M4.75 6.5V5a2.25 2.25 0 0 1 4.5 0v1.5"/></svg>';

async function addNew(page) { await page.addStyleTag({ content: NEW_CSS }); }

/* ---------- Staff: Calendar Sheet + Notes ---------- */
async function staffCalendar(b, origin, { width, theme, notes, state }) {
  const { page, errors } = await open(b, { width, theme, posts: F.posts(), url: origin + '/index.html?v=calendar' });
  await page.waitForFunction(() => typeof _calSavePins === 'function', null, { timeout: 30000 });
  await page.evaluate(c => { _syncviewStaffIdentityVerified = true; _calSavePins([c]); navTo('calendar'); }, CLIENT);
  await page.waitForFunction(() => calState.posts && calState.posts.length === 5, null, { timeout: 20000 });
  await page.evaluate(n => { const p = calState.posts.find(x => x.id === 'p1'); Object.assign(p, n, { video_comments: n.comments || [] }); if (window._notesMarkSeen) {} onCalViewChange('organizer'); }, notes);
  await page.waitForTimeout(700);
  await addNew(page);
  // SMMs reach the same inbox from a Messages button by their account
  // (Kasper keeps his Messages tab). Only their own clients' conversations.
  await page.evaluate(() => {
    const host = document.querySelector('.header-actions'); if (!host) return;
    host.insertAdjacentHTML('afterbegin', '<button type="button" class="header-nav-btn" id="navMessages" title="Messages (2 unread)" aria-label="Messages, 2 unread"><svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.5h11a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H7l-3 2.5V12H2.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/></svg><span class="msg-unread">2</span></button>');
  });
  if (state !== 'sheet') {
    await page.evaluate(() => openCalComments('p1')); await page.waitForSelector('#calCommentsModal .cal-cm-composer-wrap');
    await page.addScriptTag({ path: path.join(__dirname, 'decorate.js') });
    await page.evaluate(([state, LOCK]) => decorateNotes(state, LOCK), [state, LOCK]);
  }
  await settle(page);
  return { page, errors };
}

/* ---------- Kasper: Messages tab ---------- */
async function kasperMessages(b, origin, { width, theme, state }) {
  const { page, errors } = await open(b, { width, theme, posts: F.posts(), url: origin + '/#kasper' });
  await page.waitForFunction(() => typeof _kasperGotoTab === 'function', null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { document.getElementById('content').innerHTML = renderKasperView(); mountKasperView(); _kasperGotoTab('replies'); });
  await page.waitForTimeout(500);
  await addNew(page);
  await page.addScriptTag({ path: path.join(__dirname, 'decorate.js') });
  const arts = [0, 1, 2, 3, 4].map(ART_URI);
  await page.evaluate(([state, LOCK, arts]) => paintInbox(state, LOCK, arts), [state, LOCK, arts]);
  await settle(page);
  return { page, errors };
}

/* ---------- Client link ---------- */
async function clientLink(b, origin, { width, theme, state }) {
  const posts = F.posts(); Object.assign(posts[2], F.clientNotes()); posts[2].video_comments = posts[2].comments;
  const { page, errors } = await open(b, { width, theme, posts, url: origin + '/index.html?c=Sample%20Bakery&t=sampletoken&v=calendar', clientLink: true });
  await page.waitForFunction(() => typeof calState !== 'undefined' && calState.posts && calState.posts.length === 5, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  await page.evaluate(n => { const p = calState.posts.find(x => x.id === 'p3'); Object.assign(p, n, { video_comments: [] }); }, F.clientNotes());
  if (state !== 'review' && state !== 'none') { await page.evaluate(() => onCalViewChange('organizer')); await page.waitForTimeout(700); }
  await addNew(page);
  await page.addScriptTag({ path: path.join(__dirname, 'decorate.js') });
  await page.evaluate(state => paintClient(state), state);
  if (state === 'notes') { await page.evaluate(() => openCalComments('p3')); await page.waitForTimeout(400); await page.evaluate(() => paintClientNotes()); }
  await settle(page);
  return { page, errors };
}

const SCREENS = [
  ['notes-comment-team', staffCalendar, { notes: F.notes(false), state: 'team' }, 'Notes, staff: Comment to Kasper / team (default)'],
  ['notes-comment-client', staffCalendar, { notes: F.notes(false), state: 'client' }, 'Notes, staff: Comment to the client'],
  ['notes-request-change', staffCalendar, { notes: F.notes(false), state: 'tweak' }, 'Notes, staff: Request change (always team only)'],
  ['notes-empty', staffCalendar, { notes: { comments: [], graphic_comments: [], caption_comments: [] }, state: 'team' }, 'Notes, staff: no notes yet'],
  ['notes-long', staffCalendar, { notes: F.notes(true), state: 'team' }, 'Notes, staff: long thread'],
  ['sheet-staff', staffCalendar, { notes: F.notes(false), state: 'sheet' }, 'Calendar Sheet, staff: Messages in the top bar, unread dot on Notes'],
  ['inbox-unread', kasperMessages, { state: 'unread' }, 'Kasper, Messages tab: unread conversations'],
  ['inbox-long', kasperMessages, { state: 'long' }, 'Kasper, Messages tab: long conversation'],
  ['inbox-empty', kasperMessages, { state: 'empty' }, 'Kasper, Messages tab: nothing to read'],
  ['inbox-phone-chat', kasperMessages, { state: 'chat' }, 'Kasper, Messages tab: conversation open (phone)'],
  ['client-review-strip', clientLink, { state: 'review' }, 'Client link: new messages strip on Review'],
  ['client-sheet-dot', clientLink, { state: 'sheet' }, 'Client link: strip + dot on the card Notes button'],
  ['client-notes', clientLink, { state: 'notes' }, 'Client link: Notes shows only client messages, signed Synchro team'],
  ['client-none', clientLink, { state: 'none' }, 'Client link: nothing new (no strip)'],
];
const FROZEN = { 'notes-comment-team': 'notes-panel', 'inbox-unread': 'messages-inbox', 'client-sheet-dot': 'client-view' };

(async () => {
  const srv = await serve(); const origin = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const problems = [];
  for (const [name, fn, opts, note] of SCREENS) {
    if (only && !only.split(',').includes(name)) continue;
    for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
      if (name === 'inbox-phone-chat' && width !== 390) continue;
      const { page, errors } = await fn(b, origin, Object.assign({ width, theme }, opts));
      const shot = path.join(SHOTS, `${name}-${theme}-${width < 700 ? 'phone' : 'desktop'}.png`);
      await page.screenshot({ path: shot });
      if (width === 1440 && FROZEN[name]) await freeze(page, path.join(OUT, FROZEN[name] + (theme === 'dark' ? '-dark' : '') + '.html'), note + ' · ' + theme + ' · static copy of the real page, new parts added');
      if (errors.length) problems.push(name + ': ' + errors.join(' | '));
      await page.context().close();
      console.log('wrote', path.basename(shot));
    }
  }
  console.log(problems.length ? problems : 'no page errors');
  await b.close(); srv.close();
})();
