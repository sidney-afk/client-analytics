// ot4_t1_smm_calendar_writes.js — TIER 1: the SMM's DAILY CALENDAR PLANNING
// journey, cold-open, all through the real Sheet UI on #calendar/sidneylaruel:
//   click "+" → type the name (blur commits) → row born in the DB → add a
//   scheduled date → paste a thumbnail URL (commit-on-blur) → type a caption →
//   flip the video sub-status pill For SMM Approval → every write polled into
//   calendar_posts → hard reload renders every value from server truth →
//   0 app JS errors → archive verified.
'use strict';
const H = require('./ot4_lib.js');
const { launch, smmCal, archiveCalSafe, appErrs } = H;

const C = H.counter(); const t = C.t;
const TS = Date.now();
const NAME = 'OT4 SMM Plan ' + TS;
const CAP = 'OT4 caption draft ' + TS;
const THUMB = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg';
const DATE = new Date(Date.now() + 3 * 86400e3).toISOString().slice(0, 10);
const POLL = 35000;
const rowByName = (cols) => {
  try { const r = H.supaCal('client=eq.sidneylaruel&name=eq.' + encodeURIComponent(NAME) + '&select=' + cols); return (Array.isArray(r) && r[0]) || null; } catch { return null; }
};

(async () => {
  const browser = await launch();
  let id = null;
  try {
    const p = await smmCal(browser);
    await p.waitForFunction(() => !!document.querySelector('#calStrip .cal-card-add'), { timeout: 20000 });

    // 1) CREATE via the real "+" and typed name.
    const plussed = await p.evaluate(() => {
      const add = document.querySelector('#calStrip .cal-card-add');
      if (!add) return 'no-add-btn';
      add.click(); return 'ok';
    });
    t(plussed === 'ok', 'SMM clicks the calendar "+"', plussed);
    await H.sleep(600);
    const created = await p.evaluate((nm) => {
      const blanks = [...document.querySelectorAll('#calStrip .cal-card[data-pid^="__blank__"]')];
      const card = blanks[blanks.length - 1];
      if (!card) return 'no-blank-card';
      const inp = card.querySelector('.cal-fld-name');
      if (!inp) return 'no-name-field';
      inp.focus(); inp.value = nm;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.blur();
      return 'ok';
    }, NAME);
    t(created === 'ok', 'SMM creates a post via the real "+" + typed name', created);
    const born = await H.pollRow(() => rowByName('id,name,status'), r => !!r.id, POLL);
    t(!!born, 'DB: the typed post is born as a real row', JSON.stringify(born));
    id = born && born.id;
    if (!id) throw new Error('no row id — cannot continue');

    // 2) DATE via the real date input.
    const dated = await p.evaluate((args) => {
      const [pid, iso] = args;
      const inp = document.querySelector(`#calStrip input.cal-fld-date-input[data-pid="${pid}"]`);
      if (!inp) return 'no-date-input';
      inp.value = iso;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    }, [id, DATE]);
    t(dated === 'ok', 'SMM sets the scheduled date via the real control', dated);
    const r2 = await H.pollRow(() => H.rowCal(id, 'scheduled_date'), r => r.scheduled_date === DATE, POLL);
    t(!!r2 && r2.scheduled_date === DATE, 'DB: scheduled_date landed', r2 && r2.scheduled_date);

    // 3) THUMBNAIL pasted into the link field (commit on blur).
    const thumbed = await p.evaluate((args) => {
      const [pid, url] = args;
      const inp = document.querySelector(`#calStrip .cal-link-input[data-pid="${pid}"][data-fld="thumbnail_url"]`);
      if (!inp) return 'no-thumb-input';
      inp.focus(); inp.value = url;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.blur();
      return 'ok';
    }, [id, THUMB]);
    t(thumbed === 'ok', 'SMM pastes the thumbnail URL (blur commits)', thumbed);
    const r3 = await H.pollRow(() => H.rowCal(id, 'thumbnail_url'), r => (r.thumbnail_url || '').includes('ytimg'), POLL);
    t(!!r3 && (r3.thumbnail_url || '').includes('ytimg'), 'DB: thumbnail_url landed');

    // 4) CAPTION typed into the real textarea (blur commits).
    const capped = await p.evaluate((args) => {
      const [pid, txt] = args;
      const ta = document.querySelector(`#calStrip textarea.cal-fld-cap[data-pid="${pid}"][data-fld="caption"]`);
      if (!ta) return 'no-caption';
      if (ta.readOnly) return 'readonly';
      ta.focus();
      const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      set.call(ta, txt); ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.blur();
      return 'ok';
    }, [id, CAP]);
    t(capped === 'ok', 'SMM types a caption (blur commits)', capped);
    const r4 = await H.pollRow(() => H.rowCal(id, 'caption'), r => (r.caption || '').includes('OT4 caption draft'), POLL);
    t(!!r4 && (r4.caption || '').includes('OT4 caption draft'), 'DB: caption landed');

    // 5) VIDEO SUB-STATUS via the real pill → menu → item.
    // 4b) The video/graphic pills are LOCKED until a Linear sub-issue is
    // linked ("Link a Linear sub-issue first" — design gate). Do what a real
    // SMM does: paste the VID sub-issue link (adoption webhook is MOCKED by
    // the harness), which unlocks the pill.
    const LIN = 'https://linear.app/synchro-social/issue/VID-7' + (TS % 9000 + 1000) + '/ot4';
    const linked = await p.evaluate((args) => {
      const [pid, url] = args;
      try { _calLinearEdit(pid, 'video'); } catch (e) { return 'edit-err: ' + e.message; }
      const inp = document.querySelector(`[data-title-row="${pid}"] input.cal-linear-input`);
      if (!inp) return 'no-linear-input';
      inp.value = url; inp.blur();
      return 'ok';
    }, [id, LIN]);
    t(linked === 'ok', 'SMM pastes the VID Linear sub-issue link (blur commits)', linked);
    const r4b = await H.pollRow(() => H.rowCal(id, 'linear_issue_id'), r => (r.linear_issue_id || '').includes('VID-7'), POLL);
    t(!!r4b && (r4b.linear_issue_id || '').includes('VID-7'), 'DB: linear_issue_id landed');
    await p.waitForFunction((pid) => {
      const b = document.querySelector(`.cal-fld-substatus-wrap[data-substatus-pid="${pid}"][data-substatus-comp="video"] .cal-fld-substatus-trigger`);
      return !!(b && !b.disabled);
    }, id, { timeout: 20000 }).catch(() => {});

    // A synthetic .click() bubbles to the document-level menu closer in the
    // same tick — use a REAL mouse click on the pill, then pick from the
    // body-appended .cal-fld-status-menu in a second step.
    await p.click(`.cal-fld-substatus-wrap[data-substatus-pid="${id}"][data-substatus-comp="video"] .cal-fld-substatus-trigger`);
    await H.sleep(500);
    const flipped = await p.evaluate(() => {
      const items = [...document.querySelectorAll('.cal-fld-status-menu .cal-fld-status-item')];
      const item = items.find(i => (i.getAttribute('onclick') || '').includes("'For SMM Approval'"));
      if (!item) return 'no-menu-item(' + items.length + ')';
      item.click(); return 'ok';
    });
    t(flipped === 'ok', 'SMM flips video sub-status via the real pill menu', flipped);
    const r5 = await H.pollRow(() => H.rowCal(id, 'video_status,status'), r => r.video_status === 'For SMM Approval', POLL);
    t(!!r5 && r5.video_status === 'For SMM Approval', 'DB: video_status = For SMM Approval');

    t(appErrs(p).length === 0, '0 app JS errors on the planning page', (appErrs(p)[0] || ''));
    await p.context().close();

    // 6) HARD RELOAD — every value renders back from server truth.
    const p2 = await smmCal(browser);
    await p2.waitForFunction((pid) => !!document.querySelector(`#calStrip .cal-card[data-pid="${pid}"]`), id, { timeout: 25000 }).catch(() => {});
    const re = await p2.evaluate((pid) => {
      const card = document.querySelector(`#calStrip .cal-card[data-pid="${pid}"]`);
      if (!card) return { card: false };
      const val = (sel) => { const e = card.querySelector(sel); return e ? (e.value !== undefined ? e.value : e.textContent) : null; };
      const subWrap = document.querySelector(`.cal-fld-substatus-wrap[data-substatus-pid="${pid}"][data-substatus-comp="video"]`);
      return {
        card: true,
        name: val('.cal-fld-name'),
        date: val('input.cal-fld-date-input'),
        thumb: val('.cal-link-input[data-fld="thumbnail_url"]'),
        caption: val('textarea.cal-fld-cap[data-fld="caption"]'),
        videoPill: subWrap && subWrap.getAttribute('data-val'),
      };
    }, id);
    t(re.card, 'reload: card renders from server truth');
    t(re.name === NAME, 'reload: name persisted', re.name);
    t(re.date === DATE, 'reload: date persisted', re.date);
    t((re.thumb || '').includes('ytimg'), 'reload: thumbnail persisted');
    t((re.caption || '').includes('OT4 caption draft'), 'reload: caption persisted');
    t(re.videoPill === 'For SMM Approval', 'reload: video pill shows For SMM Approval', re.videoPill);
    t(appErrs(p2).length === 0, '0 app JS errors on the reloaded page', (appErrs(p2)[0] || ''));
  } catch (e) {
    t(false, 'EXCEPTION: ' + (e && e.message || e));
  } finally {
    try { await browser.close(); } catch {}
    if (id) t(archiveCalSafe(id), 'cleanup: UI-born post archived + verified');
  }
  console.log(`\npass=${C.ok} fail=${C.fail}`);
  process.exit(C.fail ? 1 : 0);
})();
