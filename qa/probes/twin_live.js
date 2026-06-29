// twin_live.js — LIVE journey twin sweep. Drives each scenario from
// qa/scenarios.js on BOTH the calendar (source of truth, no ?sxr=1) and the
// samples rebuild (?sxr=1) against the LIVE backend, and after each step diffs
// the normalized observable snapshot + the DB row. A second SMM tab per surface
// is opened ONCE and NEVER reloaded, so we also record whether a change shows up
// cross-tab without a refresh (under the headless courier the realtime WebSocket
// can't be tunnelled, so this is expected to be false on BOTH surfaces — the
// authoritative realtime check is qa/probes/twin_realtime.js).
//
// Usage: node qa/probes/twin_live.js [keyFilter] [--max N]
//   keyFilter: comma-separated substrings of scenario keys (default: all)
// Writes /tmp/twin_live_result.json with the full deduped divergence catalog.
const fs = require('fs');
const L = require('../sxr_courier_lib.js');
const T = require('../twin_live_lib.js');
const { base } = require('../scenarios.js');
const { SXR, CAL } = T;

const filter = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const maxIdx = process.argv.indexOf('--max');
const MAX = maxIdx >= 0 ? parseInt(process.argv[maxIdx + 1], 10) : Infinity;
const OUT = process.env.TWIN_OUT || '/tmp/twin_live_result.json';

// Which tab/region a verb acts on, per surface.
function regionFor(verb) {
  if (verb.startsWith('kasper.')) return { actor: 'kasper', mode: 'kasper' };
  if (verb === 'smm.approve' || verb === 'smm.request') return { actor: 'smm', mode: 'review' };
  if (verb.startsWith('client.')) return { actor: 'client', mode: 'review' };
  if (verb === 'smm.status' || verb === 'smm.note' || verb === 'smm.markDone') return { actor: 'smm', mode: 'sheet' };
  return null;
}

class Surface {
  constructor(browser, S) { this.b = browser; this.S = S; this._smm = null; this._smm2 = null; this._kasper = null; this._client = null; }
  async smm() { if (!this._smm) this._smm = await this.S.openSmm(this.b); return this._smm; }
  async smm2() { if (!this._smm2) { this._smm2 = await this.S.openSmm(this.b); await this._smm2.evaluate((s) => { const b = document.querySelector('#' + s.view + ' .cal-view-btn[data-cal-view="organizer"]'); if (b) b.click(); }, T.ser(this.S)); await this._smm2.waitForTimeout(800); } return this._smm2; }
  async kasper() { if (!this._kasper) this._kasper = await this.S.openKasper(this.b); return this._kasper; }
  async client() { if (!this._client) this._client = await this.S.openClient(this.b); return this._client; }
  async page(actor) { return actor === 'kasper' ? this.kasper() : actor === 'client' ? this.client() : this.smm(); }
  async closeAll() { for (const p of [this._smm, this._smm2, this._kasper, this._client]) { if (p) { try { await p.context().close(); } catch {} } } this._smm = this._smm2 = this._kasper = this._client = null; }
}

async function runVerb(surf, S, id, name, step) {
  const [verb, ...a] = step;
  if (verb === 'smm.status') return T.vSmmStatus(await surf.smm(), S, id, a[0], a[1]);
  if (verb === 'smm.approve') return T.vSmmApprove(await surf.smm(), S, name, a[0], a[1]);
  if (verb === 'smm.request') return T.vSmmRequest(await surf.smm(), S, name, a[0], a[1]);
  if (verb === 'smm.note') return T.vSmmNote(await surf.smm(), S, id, a[0], a[1], a[2]);
  if (verb === 'smm.markDone') return T.vSmmMarkDone(await surf.smm(), S, id, a[0]);
  if (verb === 'kasper.approve') return T.vKasper(await surf.kasper(), S, name, a[0], 'approve');
  if (verb === 'kasper.request') return T.vKasper(await surf.kasper(), S, name, a[0], 'request', a[1]);
  if (verb === 'kasper.aat') return T.vKasper(await surf.kasper(), S, name, a[0], 'aat', a[1]);
  if (verb === 'client.approve') return T.vClient(await surf.client(), S, name, a[0], 'approve');
  if (verb === 'client.request') return T.vClient(await surf.client(), S, name, a[0], 'request', a[1]);
  return 'skip';
}

async function snapRegion(surf, S, id, name, region) {
  if (!region) return null;
  const page = await surf.page(region.actor);
  // Kasper needs a longer settle: an approve/request triggers a remove-animation
  // + an async partition (Waiting / Tweaks-pending / Approved-history) re-render
  // on the calendar; snapshot too early and a card mid-transition reads absent.
  await page.waitForTimeout(region.mode === 'kasper' ? 1400 : 700);
  const spec = region.mode === 'sheet'
    ? { mode: 'sheet', strip: S.strip, id }
    : region.mode === 'kasper'
      ? { mode: 'kasper', kasperPidAttr: S.kasperPidAttr, name }
      : { mode: 'review', name };
  return T.snap(page, spec);
}

async function runScenario(browser, scn) {
  const id = scn.id, name = scn.name;
  const divergences = [];
  const stepLog = [];
  const calSurf = new Surface(browser, CAL);
  const sxrSurf = new Surface(browser, SXR);

  // seed BOTH tables identically
  const seed = Object.assign({ id, name, order_index: 1, asset_url: 'https://frame.io/x/' + id, thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg' }, scn.seed);
  CAL.seed(seed); SXR.seed(seed);
  await L.poll(() => { const c = CAL.readRow(id, 'id'), s = SXR.readRow(id, 'id'); return (c && s) ? true : null; }, 14000, 700);

  try {
    let si = 0;
    for (const step of scn.steps) {
      si++;
      const [verb, ...args] = step;
      if (verb === 'expect' || verb === 'expectComment') {
        // DB-parity assertion on BOTH surfaces
        if (verb === 'expect') {
          const colMap = { video_status: 'video', graphic_status: 'graphic', status: 'status', kasper_approved_after_tweaks: 'aat' };
          const calOk = await T.waitCol(CAL, id, args[0], args[1], 14000);
          const sxrOk = await T.waitCol(SXR, id, args[0], args[1], 14000);
          if (calOk !== sxrOk) divergences.push({ step: si, verb, region: 'db', kind: 'db-expect', detail: `${args[0]}=${args[1]}: calendar ${calOk ? 'reached' : 'MISSED'}, samples ${sxrOk ? 'reached' : 'MISSED'}` });
          stepLog.push({ step: si, verb, args, calOk, sxrOk });
        } else {
          const cc = T.lastComment(CAL, id, args[0]); const sc = T.lastComment(SXR, id, args[0]); const want = args[1] || {};
          const ck = !!cc && (!want.role || cc.role === want.role) && (want.is_tweak === undefined || cc.is_tweak === want.is_tweak);
          const sk = !!sc && (!want.role || sc.role === want.role) && (want.is_tweak === undefined || sc.is_tweak === want.is_tweak);
          if (ck !== sk) divergences.push({ step: si, verb, region: 'db', kind: 'db-comment', detail: `${args[0]} ${JSON.stringify(want)}: calendar ${ck ? 'ok' : 'NO'} (role=${cc && cc.role}), samples ${sk ? 'ok' : 'NO'} (role=${sc && sc.role})` });
          stepLog.push({ step: si, verb, args, calOk: ck, sxrOk: sk });
        }
        continue;
      }

      const region = regionFor(verb);
      // drive the verb on BOTH surfaces (calendar = source of truth first)
      let calRes = 'err', sxrRes = 'err';
      try { calRes = await runVerb(calSurf, CAL, id, name, step); } catch (e) { calRes = 'EXC:' + (e.message || e); }
      try { sxrRes = await runVerb(sxrSurf, SXR, id, name, step); } catch (e) { sxrRes = 'EXC:' + (e.message || e); }

      // observable snapshot of the acting region on each surface
      let calSnap = null, sxrSnap = null, snapDiff = null;
      try { calSnap = await snapRegion(calSurf, CAL, id, name, region); } catch {}
      try { sxrSnap = await snapRegion(sxrSurf, SXR, id, name, region); } catch {}
      if (region && calSnap && sxrSnap) {
        snapDiff = T.diffSnap(calSnap, sxrSnap, region.mode);
        if (snapDiff) divergences.push({ step: si, verb, args, region: region.mode, kind: snapDiff.kind, snapDiff, verbRes: { cal: calRes, sxr: sxrRes } });
      }

      // DB-state diff after the step
      const calDb = T.dbState(CAL, id), sxrDb = T.dbState(SXR, id);
      const dbDiff = T.diffDb(calDb, sxrDb);
      if (dbDiff) divergences.push({ step: si, verb, args, region: 'db', kind: 'db-state', detail: dbDiff });

      // never-reloaded second tab — did it auto-reflect (no refresh)?
      let secondTab = null;
      if (region && region.mode !== 'kasper') {
        try {
          const c2 = await calSurf.smm2(); const s2 = await sxrSurf.smm2();
          const cSnap2 = await T.snap(c2, { mode: 'sheet', strip: CAL.strip, id });
          const sSnap2 = await T.snap(s2, { mode: 'sheet', strip: SXR.strip, id });
          secondTab = { calReflected: cSnap2.found ? cSnap2.stateLabels : null, sxrReflected: sSnap2.found ? sSnap2.stateLabels : null };
        } catch {}
      }
      stepLog.push({ step: si, verb, args, calRes, sxrRes, calDb, sxrDb, snapDiff: snapDiff ? { missing: snapDiff.missing, extra: snapDiff.extra, stMissing: snapDiff.stMissing, kind: snapDiff.kind, detail: snapDiff.detail } : null, secondTab });
      process.stdout.write(snapDiff || dbDiff ? '✗' : '·');
    }
  } catch (e) { divergences.push({ step: -1, verb: 'SCENARIO', kind: 'exception', detail: String(e.message || e) }); }
  finally {
    await calSurf.closeAll(); await sxrSurf.closeAll();
    try { CAL.archive(id); } catch {}
    try { SXR.archive(id); } catch {}
  }
  return { key: scn.key, title: scn.title, divergences, stepLog };
}

(async () => {
  const ts = Date.now();
  let specs = base();
  if (filter) { const parts = filter.split(','); specs = specs.filter(s => parts.some(p => s.key.includes(p))); }
  specs = specs.slice(0, MAX).map((s, i) => ({ ...s, id: 'sr_twin_' + s.key + '_' + ts + '_' + i, name: 'TWIN ' + s.key + ' ' + ts }));

  console.log(`TWIN-LIVE: ${specs.length} scenarios × {calendar, samples} against the LIVE backend\n`);
  const browser = await L.launch();
  const all = [];
  try {
    for (const scn of specs) {
      const t0 = Date.now();
      process.stdout.write(`[${scn.key.padEnd(28)}] `);
      const r = await runScenario(browser, scn);
      r.ms = Date.now() - t0;
      all.push(r);
      const nd = r.divergences.length;
      console.log(`  ${nd ? nd + ' DIVERGENCE(S)' : 'parity'}  (${(r.ms / 1000).toFixed(0)}s)`);
      r.divergences.forEach(d => {
        if (d.kind === 'snapshot') console.log(`     ✗ step ${d.step} ${d.verb}(${(d.args || []).join(',')}) [${d.region}]  missing=${JSON.stringify(d.snapDiff.missing)} extra=${JSON.stringify(d.snapDiff.extra)} stMissing=${JSON.stringify(d.snapDiff.stMissing)}${d.snapDiff.imgDiff ? ' img=' + d.snapDiff.imgDiff : ''}`);
        else if (d.kind === 'presence') console.log(`     ✗ step ${d.step} ${d.verb} [${d.region}] PRESENCE: ${d.snapDiff.detail}`);
        else console.log(`     ✗ step ${d.step} ${d.verb} [${d.region || ''}] ${d.kind}: ${typeof d.detail === 'object' ? JSON.stringify(d.detail) : d.detail}`);
      });
    }
  } finally { await browser.close(); }

  const totalDiv = all.reduce((n, r) => n + r.divergences.length, 0);
  console.log('\n================ TWIN-LIVE SUMMARY ================');
  console.log(`scenarios: ${all.length}, with divergences: ${all.filter(r => r.divergences.length).length}, total divergence records: ${totalDiv}`);
  fs.writeFileSync(OUT, JSON.stringify({ ts, specs: specs.map(s => s.key), results: all }, null, 2));
  console.log('wrote ' + OUT);
  process.exit(0);
})().catch(e => { console.error('TWIN-LIVE ERROR', e && e.stack || e); process.exit(2); });
