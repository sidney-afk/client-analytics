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
      const team = inS(t.page, polish ? '.sl:not(.me):not(.chg)' : '.bub.team').last();
      await team.scrollIntoViewIfNeeded(); await team.hover(); await sleep(250);
      await t.page.screenshot({ path: name('7-notes'), fullPage: w < 800 });
      await t.ctx.close();
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
        const rows = Array.from(r.querySelectorAll('#chat .sl'));
        const heads = rows.filter(x => !x.classList.contains('cont')).map(x => x.querySelector('.sl-h b'));
        const words = Array.from(r.querySelectorAll('#chat .sl-k'));
        const times = Array.from(r.querySelectorAll('#chat .sl-t'));
        const days = Array.from(r.querySelectorAll('#chat .sl-day')).map(d => d.innerText.trim());
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
      const dated = await R(t.page, (r) => Array.from(r.querySelectorAll('#chat .sl')).map(x => x.innerText).join('\n').match(/\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b|\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b|Yesterday|Today/g) || []);
      expect(!dated.length, 'no message repeats a date the day line carries (' + dated.join(', ') + ')');
      expect(!/Delete note|Sending/.test(v.chatText), 'no "Delete note" or "Sending" text');
      await t.ctx.close();
    }

    console.log('--- Reply on a team comment only ---');
    {
      const t = await openClient(browser, origin, {});
      await inS(t.page, '#foldBtn').click().catch(() => {});
      await sleep(250);
      const where = await R(t.page, (r) => Array.from(r.querySelectorAll('#chat .sl')).map(x => ({ id: x.dataset.cpNote || '', me: x.classList.contains('me'), chg: x.classList.contains('chg'), reply: !!x.querySelector('[data-cp-reply]') })));
      expect(where.filter(x => x.reply).length > 0 && where.every(x => !x.reply || (!x.me && !x.chg)), 'Reply is offered on team comments and never on a change request or one\'s own note');
      const row = inS(t.page, '#chat .sl:has([data-cp-reply])').filter({ hasText: 'Thumbnail text is bigger' });
      await t.page.mouse.move(2, 2); await sleep(200);
      const before = await row.locator('.sl-acts').evaluate(e => getComputedStyle(e).opacity);
      await row.hover(); await sleep(200);
      const after = await row.locator('.sl-acts').evaluate(e => getComputedStyle(e).opacity);
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
      const card = t.state.cards.find(c => c.id === 'rs1');
      expect(card.graphic_status === 'Client Approval', 'and asks for nothing: the thumbnail is still waiting for the client');
      const gone = await R(t.page, (r) => !r.getElementById('reLine'));
      expect(gone, 'the box is a plain box again after sending');
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
      const g = await R(t.page, (r) => Array.from(r.querySelectorAll('#chat .sl.me')).map(x => (x.classList.contains('cont') ? 'cont' : 'head') + ':' + (x.querySelector('.sl-x') || {}).textContent));
      expect(g.length >= 2 && /^head:First/.test(g[g.length - 2]) && /^cont:And a second/.test(g[g.length - 1]), 'the second message has no repeated picture or name (' + g.join(' | ') + ')');
      await t.ctx.close();
    }

    console.log('--- switch off: the bubbles as before ---');
    {
      const t = await openClient(browser, origin, { polish: false });
      const v = await R(t.page, (r) => ({ rows: r.querySelectorAll('#chat .sl').length, bubbles: r.querySelectorAll('#chat .bub').length, days: r.querySelectorAll('#chat .sl-day').length }));
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
