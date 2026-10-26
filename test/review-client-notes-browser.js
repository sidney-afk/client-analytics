'use strict';
/*
 * THE CLIENT'S NOTES IN THE QUIET DESIGN, behind review_client_polish (session Porch, 2026-10-24; the staff side's
 * round 6 by session Beacon). Real browser, fully offline, the shared mocked backend of the review-stage tests
 * (fictional client, cards, people and conversation).
 *
 * Messages are rows, as in Slack: picture, first name (full name in the hover), relative time (full date in the
 * hover), the words. Day lines carry the day, so no message repeats a date. A follow-up by the same person within five
 * minutes shows the picture and name once. Status is a quiet coloured word with a hover that explains it, never a pill.
 * Reply shows on hover on a comment from the team, never on a change request or on one's own note, and sends a plain
 * comment on that note's part. Switch off: the bubbles as before.
 * SHOTS=<dir> writes the PR screenshots (light and dark, 1440 and 390 wide); POLISH=0 takes the "before" set.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, TOKEN, open, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const SHOTS = process.env.SHOTS || '';
const ONLY = process.env.SHOTS_ONLY === '1';
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

async function openClient(browser, origin, o) {
  const t = await open(browser, origin, Object.assign({ stage: 'client', flags: 'on', polish: true, thread: true }, o));
  await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, v: 'calendar', tab: 'review', t: TOKEN }), { waitUntil: 'domcontentloaded' });
  await waitNew(t); await sleep(1200);
  return t;
}
const R = (page, fn, arg) => page.evaluate(([src, a]) => { const r = document.getElementById('svReviewStage').shadowRoot; return (0, eval)('(' + src + ')')(r, a); }, [fn.toString(), arg]);
const notes = (row, col) => { try { return JSON.parse(String(row[col] || '[]')); } catch (e) { return []; } };

async function shots(browser, origin) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const polish = process.env.POLISH !== '0';
  const tag = polish ? 'after' : 'before';
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    for (const dark of [false, true]) {
      const name = (n) => path.join(SHOTS, tag + '-' + n + '-' + w + '-' + (dark ? 'dark' : 'light') + '.png');
      const t = await openClient(browser, origin, { width: w, height: h, dark, polish });
      const fold = inS(t.page, '#foldBtn');
      if (await fold.count()) { await fold.click(); await sleep(250); }
      const team = inS(t.page, polish ? '.cpm:not(.me):not(.chg)' : '.bub.team').last();
      await team.scrollIntoViewIfNeeded(); await team.hover(); await sleep(250);
      await t.page.screenshot({ path: name('7-notes'), fullPage: w < 800 });
      await t.ctx.close();
      // round 2: a reply under the team's message, two changes in a row, and the delete cross on hover
      const u = await openClient(browser, origin, { width: w, height: h, dark, polish });
      const fold2 = inS(u.page, '#foldBtn');
      if (await fold2.count()) { await fold2.click(); await sleep(250); }
      const g1 = inS(u.page, polish ? '.cpm:has([data-cp-reply])' : '.bub.team').filter({ hasText: 'Thumbnail text is bigger' });
      if (polish && await g1.count()) {
        await g1.hover(); await g1.locator('[data-cp-reply]').click(); await sleep(150);
        await u.page.keyboard.type('Thanks, that works for us.'); await u.page.keyboard.press('Enter');
      } else {
        await inS(u.page, '#ta').fill('Thanks, that works for us.'); await inS(u.page, '[data-pc="graphic"]').click(); await sleep(100); await inS(u.page, '[data-pc="graphic"]').click(); await inS(u.page, '#cmtBtn').click();
      }
      await sleep(1200);
      const repRow = inS(u.page, polish ? '.cpm' : '.bub').filter({ hasText: 'that works for us' }).last();
      await repRow.scrollIntoViewIfNeeded(); await u.page.mouse.move(2, 2); await sleep(250);
      await u.page.screenshot({ path: name('8-reply'), fullPage: w < 800 });
      for (const words of ['Lets do this', 'and this']) {
        await inS(u.page, '#ta').fill(words);
        if (!(await inS(u.page, '[data-pc="caption"][aria-pressed="true"]').count())) await inS(u.page, '[data-pc="caption"]').click();
        await sleep(120);
        await inS(u.page, '#sendBtn').click();
        await sleep(2200);
      }
      const mine = inS(u.page, polish ? '.cpm.me' : '.bub.you').last();
      await mine.scrollIntoViewIfNeeded(); await mine.hover(); await sleep(250);
      await u.page.screenshot({ path: name('9-followup-cross'), fullPage: w < 800 });
      await u.ctx.close();
    }
  }
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    if (SHOTS) await shots(browser, origin);
    if (ONLY) return;

    console.log('--- rows, first names, day lines, quiet words ---');
    {
      const t = await openClient(browser, origin, {});
      await inS(t.page, '#foldBtn').click().catch(() => {});
      await sleep(250);
      const v = await R(t.page, (r) => {
        const rows = Array.from(r.querySelectorAll('#chat .cpm'));
        const heads = rows.filter(x => !x.classList.contains('cont')).map(x => x.querySelector('.cpm-h b'));
        const words = Array.from(r.querySelectorAll('#chat .cpm-k'));
        const times = Array.from(r.querySelectorAll('#chat .cpm-t'));
        const days = Array.from(r.querySelectorAll('#chat .cpm-day')).map(d => d.innerText.trim());
        return {
          rows: rows.length, bubbles: r.querySelectorAll('#chat .bub').length,
          names: heads.map(b => b.textContent + (b.title ? '(' + b.title + ')' : '')),
          words: words.map(w => w.textContent + '|' + (w.title ? 'hover' : '') + '|' + getComputedStyle(w).backgroundColor + '|' + getComputedStyle(w).borderRadius),
          times: times.map(x => x.textContent + '|' + (x.title ? 'hover' : '')),
          days, chatText: r.getElementById('tscroll').innerText,
        };
      });
      expect(v.rows > 0 && v.bubbles === 0, 'the conversation is rows, not bubbles (' + v.rows + ' rows)');
      expect(v.names.length > 0 && v.names.every(n => /^\S+(\(.*\))?$/.test(n) || /^Synchro team/.test(n)), 'people by first name (the team keeps its name; a client link never names the staff): ' + v.names.join(', '));
      expect(v.words.some(w => /^Change request\|hover/.test(w)) && v.words.some(w => /^Done\|hover/.test(w)), 'status as quiet words with a hover that explains them: ' + v.words.map(w => w.split('|')[0]).join(', '));
      expect(v.words.every(w => /rgba\(0, 0, 0, 0\)|transparent/.test(w.split('|')[2])), 'never a pill (no fill behind a status word)');
      expect(v.times.length && v.times.every(x => /(ago|just now)\|hover$/.test(x)), 'each message shows a relative time, the full date in its hover: ' + v.times.slice(0, 3).join(', '));
      const dayRe = /^(Today|Yesterday|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2} [A-Z][a-z]{2}( \d{4})?)$/;
      expect(v.days.length >= 2 && v.days.every(d => dayRe.test(d)) && new Set(v.days).size === v.days.length, 'one day line per day: ' + v.days.join(', '));
      const dated = await R(t.page, (r) => Array.from(r.querySelectorAll('#chat .cpm')).map(x => x.innerText).join('\n').match(/\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b|\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b|Yesterday|Today/g) || []);
      expect(!dated.length, 'no message repeats a date the day line carries (' + dated.join(', ') + ')');
      expect(!/Delete note|Sending/.test(v.chatText), 'no "Delete note" or "Sending" text');
      await t.ctx.close();
    }

    console.log('--- Reply on a team comment only ---');
    {
      const t = await openClient(browser, origin, {});
      await inS(t.page, '#foldBtn').click().catch(() => {});
      await sleep(250);
      const where = await R(t.page, (r) => Array.from(r.querySelectorAll('#chat .cpm')).map(x => ({ id: x.dataset.cpNote || '', me: x.classList.contains('me'), chg: x.classList.contains('chg'), reply: !!x.querySelector('[data-cp-reply]') })));
      expect(where.filter(x => x.reply).length > 0 && where.every(x => !x.reply || (!x.me && !x.chg)), 'Reply is offered on team comments and never on a change request or one\'s own note');
      const row = inS(t.page, '#chat .cpm:has([data-cp-reply])').filter({ hasText: 'Thumbnail text is bigger' });
      await t.page.mouse.move(2, 2); await sleep(200);
      const before = await row.locator('.cpm-acts').evaluate(e => getComputedStyle(e).opacity);
      await row.hover(); await sleep(200);
      const after = await row.locator('.cpm-acts').evaluate(e => getComputedStyle(e).opacity);
      expect(before === '0' && after === '1', 'it shows on hover only (' + before + ' to ' + after + ')');
      await row.locator('[data-cp-reply]').click(); await sleep(250);
      const box = await R(t.page, (r) => ({ line: (r.getElementById('reLine') || {}).innerText || '', ph: (r.getElementById('ta') || {}).placeholder || '', focus: r.activeElement && r.activeElement.id }));
      box.line = box.line.replace(/\s+/g, ' ').trim();
      expect(/^Replying to \S+/.test(box.line) && /^Reply to /.test(box.ph) && box.focus === 'ta', 'the box says whom it answers and takes the typing (' + box.line.trim() + ' / ' + box.ph + ')');
      const n0 = t.state.upserts.length;
      await t.page.keyboard.type('Thank you, that works for us.');
      await t.page.keyboard.press('Enter');
      let saved = null;
      for (let i = 0; i < 60 && !saved; i++) { await sleep(100); for (const u of t.state.upserts.slice(n0)) for (const col of ['video_tweaks', 'graphic_tweaks', 'caption_tweaks']) { const n = notes(u, col).find(x => /that works for us/.test(x.body)); if (n) saved = { col, n }; } }
      expect(!!saved && !saved.n.is_tweak && saved.col === 'graphic_tweaks', 'the reply is a plain comment on that note\'s part (' + (saved ? saved.col + ', change request ' + saved.n.is_tweak : 'not saved') + ')');
      expect(!!saved && saved.n.parent_id === 'g1', 'and it is threaded: saved under the message it answers (parent ' + (saved && saved.n.parent_id) + ')');
      const card = t.state.cards.find(c => c.id === 'rs1');
      expect(card.graphic_status === 'Client Approval', 'and asks for nothing: the thumbnail is still waiting for the client');
      await sleep(500);
      const nest = await R(t.page, (r) => { const rows = Array.from(r.querySelectorAll('#chat .cpm')); const i = rows.findIndex(x => /Thumbnail text is bigger/.test(x.innerText)), j = rows.findIndex(x => /that works for us/.test(x.innerText)); return { i, j, rep: j >= 0 && rows[j].classList.contains('rep'), between: j > i ? rows.slice(i + 1, j).every(x => x.classList.contains('rep')) : false, indent: j >= 0 ? Math.round(rows[j].getBoundingClientRect().left - rows[i].getBoundingClientRect().left) : 0 }; });
      expect(nest.rep && nest.between && nest.indent > 20, 'and it shows under that message, indented (' + JSON.stringify(nest) + ')');
      const days = await R(t.page, (r) => Array.from(r.querySelectorAll('#chat .cpm-day')).map(d => d.innerText.trim()));
      expect(new Set(days).size === days.length, 'a reply from today does not split its day: one line per day (' + days.join(', ') + ')');
      const gone = await R(t.page, (r) => !r.getElementById('reLine'));
      expect(gone, 'the box is a plain box again after sending');
      await t.ctx.close();
    }

    console.log('--- a reply kept as a draft keeps whom it answers ---');
    {
      const t = await openClient(browser, origin, {});
      await inS(t.page, '#foldBtn').click().catch(() => {});
      await sleep(250);
      const row = inS(t.page, '#chat .cpm:has([data-cp-reply])').filter({ hasText: 'Thumbnail text is bigger' });
      await row.hover(); await row.locator('[data-cp-reply]').click(); await sleep(200);
      await t.page.keyboard.type('Kept for later, about the thumbnail.');
      await sleep(300);
      await t.page.reload({ waitUntil: 'domcontentloaded' });
      await waitNew(t); await sleep(1500);
      const box = await R(t.page, (r) => ({ val: (r.getElementById('ta') || {}).value || '', line: ((r.getElementById('reLine') || {}).innerText || '').replace(/\s+/g, ' ').trim() }));
      expect(/Kept for later/.test(box.val) && /^Replying to/.test(box.line), 'after a reload the words and their reply target come back (' + box.line + ')');
      const n0 = t.state.upserts.length;
      await inS(t.page, '#cmtBtn').click();
      let saved = null;
      for (let i = 0; i < 60 && !saved; i++) { await sleep(100); for (const u of t.state.upserts.slice(n0)) for (const col of ['video_tweaks', 'graphic_tweaks', 'caption_tweaks']) { const n = notes(u, col).find(x => /Kept for later/.test(x.body)); if (n) saved = { col, n }; } }
      expect(!!saved && saved.col === 'graphic_tweaks' && !saved.n.is_tweak, 'and it is saved as a comment on the thumbnail, not the part on stage (' + (saved ? saved.col : 'not saved') + ')');
      await t.ctx.close();
    }

    console.log('--- a follow-up within five minutes shows the name once ---');
    {
      const t = await openClient(browser, origin, { thread: false });
      for (const w of ['First thought on this one.', 'And a second one.']) {
        await inS(t.page, '#ta').fill(w);
        await inS(t.page, '#cmtBtn').click();
        await sleep(900);
      }
      const g = await R(t.page, (r) => Array.from(r.querySelectorAll('#chat .cpm.me')).map(x => (x.classList.contains('cont') ? 'cont' : 'head') + ':' + (x.querySelector('.cpm-x') || {}).textContent));
      expect(g.length >= 2 && /^head:First/.test(g[g.length - 2]) && /^cont:And a second/.test(g[g.length - 1]), 'the second message has no repeated picture or name (' + g.join(' | ') + ')');
      await t.ctx.close();
    }

    console.log('--- a follow-up of the same kind does not repeat "Change request" ---');
    {
      const t = await openClient(browser, origin, { thread: false });
      for (const w of ['Lets do this', 'and this']) {
        await inS(t.page, '#ta').fill(w);
        // the box stays on the thumbnail after the first change; pick it only when it is not picked already
        if (!(await inS(t.page, '[data-pc="graphic"][aria-pressed="true"]').count())) await inS(t.page, '[data-pc="graphic"]').click();
        await sleep(120);
        await inS(t.page, '#sendBtn').click();
        await sleep(2500);
      }
      const rows = await R(t.page, (r) => Array.from(r.querySelectorAll('#chat .cpm.me')).map(x => ({ cont: x.classList.contains('cont'), text: (x.querySelector('.cpm-x') || {}).textContent, words: x.querySelectorAll('.cpm-k.chg').length })));
      const a = rows.find(x => x.text === 'Lets do this'), b = rows.find(x => x.text === 'and this');
      expect(a && b && a.words === 1 && b.cont && b.words === 0, 'the first says "Change request" once; the follow-up does not repeat it (' + JSON.stringify(rows) + ')');
      await t.ctx.close();
    }

    console.log('--- the delete cross is just a cross ---');
    {
      const t = await openClient(browser, origin, {});
      const own = inS(t.page, '#chat .cpm.me[data-cp-note]').last();
      await own.hover(); await sleep(250);
      const x = await own.locator('.cp-x').evaluate(e => { const c = getComputedStyle(e); return { bg: c.backgroundColor, shadow: c.boxShadow, border: c.borderTopWidth, op: c.opacity }; });
      expect(x.op === '1' && /rgba\(0, 0, 0, 0\)|transparent/.test(x.bg) && x.shadow === 'none' && x.border === '0px', 'no circle, no border, no shadow (' + JSON.stringify(x) + ')');
      await t.ctx.close();
    }

    console.log('--- switch off: the bubbles as before ---');
    {
      const t = await openClient(browser, origin, { polish: false });
      const v = await R(t.page, (r) => ({ rows: r.querySelectorAll('#chat .cpm').length, bubbles: r.querySelectorAll('#chat .bub').length, days: r.querySelectorAll('#chat .cpm-day').length }));
      expect(!v.rows && v.bubbles > 0 && !v.days, 'bubbles, no rows, no day lines (' + JSON.stringify(v) + ')');
      await t.ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\nreview-client-notes-browser: ' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nreview-client-notes-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
