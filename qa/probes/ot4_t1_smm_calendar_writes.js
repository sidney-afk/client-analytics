// ot4_t1_smm_calendar_writes.js — TIER 1: the SMM's DAILY CALENDAR PLANNING
// journey, cold-open, all through the real Sheet UI on #calendar/sidneylaruel:
//   seed a post → add a
//   scheduled date → paste a thumbnail URL (commit-on-blur) → type a caption →
//   flip the video sub-status pill For SMM Approval → every write polled into
//   calendar_posts → hard reload renders every value from server truth →
//   0 app JS errors → archive verified.
'use strict';
const H = require('./ot4_lib.js');
const { launch, smmCal, archiveCalSafe, appErrs } = H;
const NW = require('../native_work_item_fixture.js');

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
    let p = await smmCal(browser);
    await p.waitForFunction(() => !!document.querySelector('#calStrip .cal-card-add'), { timeout: 20000 });

    // 1) CREATE. The staff "+" now opens Create Post, which mints SyncView
    // work items through production-write and is not a lane this probe may
    // write through; so the card is seeded through calendar-upsert, the same
    // write a blank card's first save made, and the page is reopened on it.
    // It carries a video URL: "For SMM Approval" is refused without one.
    H.upCal({ id: 'p_ot4plan_' + TS, name: NAME, asset_url: 'https://frame.io/x/p_ot4plan_' + TS, video_status: 'In Progress', graphic_status: 'In Progress',
      caption_status: 'In Progress', status: 'In Progress' });
    const born = await H.pollRow(() => rowByName('id,name,status'), r => !!r.id, POLL);
    t(!!born, 'DB: the post is born as a real row', JSON.stringify(born));
    await p.context().close();
    p = await smmCal(browser);
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
    // 4b) The video/graphic pills are LOCKED until the card has a SyncView
    // work item for that component. Linear is retired (OPEN_REPAIRS 253): a
    // pasted Linear link no longer links anything, and the Linear control is
    // gone. The card gets a native work item from the shared fixture instead
    // (stamped into this card's reads, never persisted: the id column has a
    // foreign key), and the page is reopened so the stamped read is the one it
    // renders from.
    NW.registerProbeWorkItems([{ id, components: ['video'] }]);
    t(appErrs(p).length === 0, '0 app JS errors before the reopen', (appErrs(p)[0] || ''));
    await p.context().close();
    p = await smmCal(browser);
    // The work item is synthetic, so the real gateway would refuse its status
    // write; answer it with the fixture's committing stub and count the two
    // retired Linear webhooks, which must see nothing.
    const gateway = await NW.stubNativeGateway(p.context());
    const retired = await NW.captureRetiredWebhooks(p.context());
    await p.waitForFunction((pid) => !!document.querySelector(`#calStrip .cal-card[data-pid="${pid}"]`), id, { timeout: 25000 }).catch(() => {});
    const stamped = await p.evaluate((pid) => {
      const post = (calState.posts || []).find(x => x && x.id === pid);
      return String(post && post.video_deliverable_id || '');
    }, id);
    t(stamped === NW.nativeDeliverableId(id, 'video'), 'the card carries its SyncView video work item', stamped);
    await p.waitForFunction((pid) => {
      const b = document.querySelector(`.cal-fld-substatus-wrap[data-substatus-pid="${pid}"][data-substatus-comp="video"] .cal-fld-substatus-trigger`);
      return !!(b && !b.disabled);
    }, id, { timeout: 20000 }).catch(() => {});

    // A synthetic .click() bubbles to the document-level menu closer in the
    // same tick — use a REAL mouse click on the pill, then pick from the
    // body-appended .cal-fld-status-menu in a second step.
    // The reopened page may still re-render once its background refresh lands,
    // which closes an open menu; so open and pick up to three times.
    const pill = `.cal-fld-substatus-wrap[data-substatus-pid="${id}"][data-substatus-comp="video"] .cal-fld-substatus-trigger`;
    let flipped = 'not-tried';
    for (let attempt = 0; attempt < 3 && !/^(ok|item-disabled)/.test(flipped); attempt++) {
      await H.sleep(1500);
      await p.click(pill);
      await H.sleep(500);
      flipped = await p.evaluate(() => {
        const items = [...document.querySelectorAll('.cal-fld-status-menu .cal-fld-status-item')];
        const item = items.find(i => (i.getAttribute('onclick') || '').includes("'For SMM Approval'"));
        if (!item) return 'no-menu-item(' + items.length + ')';
        if (item.disabled) return 'item-disabled: ' + item.title;
        item.click(); return 'ok';
      });
    }
    t(flipped === 'ok', 'SMM flips video sub-status via the real pill menu', flipped);
    const vid = NW.nativeDeliverableId(id, 'video');
    const t0 = Date.now();
    while (!NW.statusCalls(gateway, vid).length && Date.now() - t0 < 15000) await H.sleep(300);
    const vcall = NW.statusCalls(gateway, vid)[0];
    t(!!vcall && vcall.surface === 'calendar', 'the status change went to the SyncView gateway for the video work item', vcall && vcall.status);
    t(NW.retiredCallCount(retired) === 0, 'the retired Linear webhooks received nothing');
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
