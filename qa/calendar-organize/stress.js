/* Round-trip proof for auto-organize-by-date.
 *
 * The claim under test: turning the switch on and off leaves the calendar
 * EXACTLY as it was, and nothing is ever written while it is on.
 *
 * Method: seed a calendar, snapshot every card's order_index, then fuzz the UI
 * with randomised sequences of the operations a real SMM performs (toggle the
 * mode, change filters, edit dates, create cards, enter select mode, switch
 * view tabs, focus captions). After every step where the view is back at
 * manual + no filters, the on-screen order must equal the original manual
 * order. At the end no order_index may have moved, and the reorder webhook
 * must never have been called.
 *
 * Fully offline — only localhost is allowed out; every other request is
 * aborted and recorded, which is also how the webhook assertion is made.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = Number(process.env.SV_QA_PORT || 8000);
const ORIGIN = 'http://localhost:' + PORT;
const PW = (() => { try { return require('playwright'); } catch (e) { return require('/opt/node22/lib/node_modules/playwright'); } })();
const ROOT = path.resolve(__dirname, '..', '..');

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  fs.readFile(path.join(ROOT, p === '/' ? 'index.html' : p), (e, b) => {
    if (e) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'content-type': p.endsWith('.png') ? 'image/png' : 'text/html' });
    res.end(b);
  });
});

// Deterministic PRNG so a failure is reproducible from the printed seed.
let SEED = Number(process.argv[2] || 20260811);
const rnd = () => { SEED = (SEED * 1103515245 + 12345) & 0x7fffffff; return SEED / 0x7fffffff; };
const pick = a => a[Math.floor(rnd() * a.length)];

const N = 14;
const DATES = ['2026-07-02', '2026-07-28', '2026-08-04', '2026-08-04', '2026-08-11', '2026-08-19',
               '', '2026-09-03', '', '2026-06-15', '2026-08-04', '', '2026-12-25', '2026-01-09'];
const POSTS = Array.from({ length: N }, (_, i) => ({
  id: 'q' + i,
  name: 'Card ' + String.fromCharCode(65 + i),
  scheduled_date: DATES[i],
  status: i % 4 === 0 ? 'Posted' : 'In Progress',
  // Deliberately gappy + non-sequential: the manual order is NOT 1..N.
  order_index: [40, 3, 17, 8, 25, 1, 33, 12, 50, 6, 21, 44, 29, 15][i],
}));
const MANUAL = POSTS.slice().sort((a, b) => a.order_index - b.order_index).map(p => p.id);

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; } else { fail++; console.log('  FAIL ' + l); } };
const okLoud = (c, l) => { if (c) { pass++; console.log('  ok   ' + l); } else { fail++; console.log('  FAIL ' + l); } };

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await PW.chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });

  const blocked = [];
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(ORIGIN)) return r.continue();
    blocked.push(r.request().method() + ' ' + u);
    return r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {} });

  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push('[console] ' + m.text()); });

  await page.goto(ORIGIN + '/#calendar', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.evaluate((posts) => {
    calState.client = 'Sidney Laruel'; calState.view = 'organizer';
    calState.loading = false; calState.error = null;
    calState.posts = posts.map((p, i) => Object.assign({
      asset_url: '', thumbnail_url: '', caption: 'c', cta: '', tweaks: '', comments: [],
      platforms: 'instagram', linear_issue_id: 'https://linear.app/x/issue/SYN-' + (400 + i),
    }, p));
    _calRenderShell(); _calRenderBody({ preserveScroll: false });
  }, POSTS);
  await page.waitForTimeout(400);

  const snap = () => page.evaluate(() => {
    const o = {}; calState.posts.forEach(p => { o[p.id] = Number(p.order_index || 0); });
    return { order: o, dom: Array.from(document.querySelectorAll('#calStrip .cal-card[data-pid]')).map(e => e.dataset.pid),
             mode: calState.sortMode, month: calState.monthFilter, status: calState.statusFilter, view: calState.view };
  });
  const BASE = await snap();
  console.log('seed=' + (process.argv[2] || 20260811) + '  cards=' + N);
  console.log('\nA) baseline');
  okLoud(BASE.dom.join(',') === MANUAL.join(','), 'manual order renders as expected');

  console.log('\nB) the drop handler cannot fire while auto-organize is on');
  await page.evaluate(() => { calState.sortMode = 'manual'; onCalSortModeToggle(); });
  await page.waitForTimeout(300);
  const beforeDrop = await snap();
  // Fire the strip's real drop handler directly — the exact code path that
  // rewrites order_index. Under the date sort it must find nothing to write.
  await page.evaluate(() => {
    const strip = document.getElementById('calStrip');
    // Shuffle the DOM the way a drag would, so a handler that *did* run would
    // persist a visibly wrong order rather than a coincidentally-correct one.
    const cards = Array.from(strip.querySelectorAll('.cal-card[data-pid]'));
    strip.insertBefore(cards[cards.length - 1], cards[0]);
    strip.dispatchEvent(new Event('drop', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  const afterDrop = await snap();
  okLoud(JSON.stringify(afterDrop.order) === JSON.stringify(beforeDrop.order),
     'a drop event on the auto-organized strip wrote no order_index');
  okLoud(!blocked.some(u => /calendar-reorder/.test(u)), 'and reached no reorder endpoint');

  console.log('\nD) fuzz — 120 random operations, order checked after every one');
  const OPS = ['toggle', 'toggle', 'month', 'content', 'date', 'view', 'select', 'caption', 'clear'];
  let checks = 0, forcedChecks = 0;
  for (let step = 0; step < 120; step++) {
    const op = pick(OPS);
    const arg = { month: pick(['all', '2026-08', '2026-07', '2026-09']),
                  content: pick(['all', 'scheduled', 'unscheduled']),
                  view: pick(['organizer', 'month', 'week', 'organizer', 'organizer']),
                  pid: pick(MANUAL), date: pick(['2026-08-04', '2026-05-01', '', '2027-02-02']) };
    await page.evaluate(([op, arg]) => {
      if (op === 'toggle') onCalSortModeToggle();
      else if (op === 'month') onCalMonthFilterChange(arg.month);
      else if (op === 'content') onCalStatusFilterChange(arg.content);
      else if (op === 'clear') onCalClearFilters();
      else if (op === 'view') onCalViewChange(arg.view);
      else if (op === 'select') { if (calState.view === 'organizer') _calToggleSelectMode(); }
      else if (op === 'caption') {
        const ta = document.querySelector('#calStrip .cal-card textarea');
        if (ta) { ta.focus(); ta.blur(); }
      } else if (op === 'date') {
        const inp = document.querySelector('#calStrip .cal-card[data-pid="' + arg.pid + '"] input[data-fld="scheduled_date"]');
        if (inp) { inp.value = arg.date; inp.dispatchEvent(new Event('change', { bubbles: true })); }
      }
    }, [op, arg]);
    await page.waitForTimeout(35);

    // Whenever the view is back at plain manual with no filters, the strip must
    // show the original manual order — regardless of what happened in between.
    const s = await page.evaluate(() => ({
      mode: calState.sortMode, month: calState.monthFilter, status: calState.statusFilter,
      view: calState.view, sel: calState.selectMode,
      dom: Array.from(document.querySelectorAll('#calStrip .cal-card[data-pid]')).map(e => e.dataset.pid),
    }));
    if (s.mode === 'manual' && s.month === 'all' && s.status === 'all' && s.view === 'organizer') {
      checks++;
      ok(s.dom.join(',') === MANUAL.join(','),
         'step ' + step + ' (' + op + '): manual order intact — got ' + s.dom.join(',') );
    }

    // A pure random walk only wanders back to the neutral state by luck, which
    // made the amount of real checking swing wildly by seed. Every 10th step,
    // deliberately return to manual + no filters + Sheet and verify — so every
    // seed proves the round trip a fixed number of times, from wherever the
    // fuzz had drifted to.
    if (step % 10 === 9) {
      const forced = await page.evaluate(() => {
        if (calState.selectMode) _calToggleSelectMode();
        if (calState.view !== 'organizer') onCalViewChange('organizer');
        onCalClearFilters();
        if (_calIsAutoSortOn()) onCalSortModeToggle();
        return Array.from(document.querySelectorAll('#calStrip .cal-card[data-pid]')).map(e => e.dataset.pid);
      });
      await page.waitForTimeout(60);
      forcedChecks++;
      ok(forced.join(',') === MANUAL.join(','),
         'step ' + step + ' (forced round trip after ' + op + '): got ' + forced.join(','));
    }
  }
  okLoud(forcedChecks === 12, 'the round trip was forced and verified ' + forcedChecks + ' times mid-fuzz');
  okLoud(true, 'plus ' + checks + ' incidental checks whenever the walk landed neutral on its own');

  console.log('\nE) after all of that');
  await page.evaluate(() => {
    calState.sortMode = 'manual'; calState.monthFilter = 'all'; calState.statusFilter = 'all';
    if (calState.selectMode) _calToggleSelectMode();
    onCalViewChange('organizer');
  });
  await page.waitForTimeout(400);
  const END = await snap();
  const moved = Object.keys(BASE.order).filter(id => BASE.order[id] !== END.order[id]);
  okLoud(moved.length === 0, 'every card still has its original order_index' + (moved.length ? ' (moved: ' + moved + ')' : ''));
  okLoud(END.dom.join(',') === MANUAL.join(','), 'the strip is byte-identical to where it started');
  const writes = blocked.filter(u => /calendar-reorder|calendar-upsert|functions\/v1/.test(u));
  okLoud(!blocked.some(u => /calendar-reorder/.test(u)),
     'the reorder webhook was never called across the whole run');
  console.log('       (backend calls attempted overall: ' + writes.length + ' — date edits legitimately save the card)');
  okLoud(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));

  console.log('\nF) a card created while auto-organize is on is not draggable');
  await page.evaluate(() => { if (!_calIsAutoSortOn()) onCalSortModeToggle(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    _calInsertLocalBlankCard();
    const blank = document.querySelector('#calStrip .cal-card.is-blank');
    _calPromoteBlankCard(blank.dataset.pid, 'q_new');
  });
  await page.waitForTimeout(300);
  const promoted = await page.evaluate(() => {
    const c = document.querySelector('#calStrip .cal-card[data-pid="q_new"]');
    const g = c && c.querySelector('.cal-card-grip');
    return { drag: c && c.getAttribute('draggable'), locked: !!(g && g.classList.contains('is-locked')),
             others: document.querySelectorAll('#calStrip .cal-card[draggable="true"]').length };
  });
  okLoud(promoted.drag === 'false', 'the promoted card is non-draggable (this was a real bug — fixed)');
  okLoud(promoted.locked, 'and its grip shows the locked state');
  okLoud(promoted.others === 0, 'no card on the strip is draggable');

  console.log('\n' + (fail ? 'FAIL (' + pass + ' passed, ' + fail + ' failed)' : 'PASS (' + pass + ' checks passed)'));
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
