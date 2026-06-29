// temporal_lib.js — instrument the page to measure SPEED and detect FLICKER/REVERT
// for any interaction, then deliberately fire the conditions that could cause a
// snap-back (background reloads + a realtime echo) and analyse the timeline.
//
// A "signature" is a short string describing the user-visible state at a moment
// (e.g. "v:Kasper Approval|g:Approved", or "comments:3 resolved:1"). A
// MutationObserver records {t, sig} on every DOM change. From that timeline we
// derive: firstChangeMs (how fast the UI reacted), flips (oscillation count), and
// reverted (did it return to an earlier state after settling — i.e. flicker).
const { execSync } = require('child_process');

// Install the observer. sigExpr is a STRING JS expression returning the signature
// (evaluated in the page on every mutation). Resets the log.
async function track(page, containerSel, sigExpr) {
  await page.evaluate(({ sel, expr }) => {
    const sig = new Function('return (' + expr + ')');
    window.__tl = [];
    let last = null;
    const push = () => { let s; try { s = String(sig()); } catch (e) { s = 'ERR'; } if (s !== last) { last = s; window.__tl.push({ t: performance.now(), sig: s }); } };
    push();
    const el = document.querySelector(sel) || document.body;
    window.__tlObs && window.__tlObs.disconnect();
    window.__tlObs = new MutationObserver(push);
    window.__tlObs.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
    window.__tlSig = sig;
  }, { sel: containerSel, expr: sigExpr });
}
async function timeline(page) { return page.evaluate(() => window.__tl || []); }
async function curSig(page) { return page.evaluate(() => { try { return String(window.__tlSig()); } catch (e) { return 'ERR'; } }); }

// Fire the flicker triggers: staggered background reloads + one realtime echo,
// spanning the optimistic-guard window. Returns when done (~6s).
async function fireFlickerTriggers(page, slug) {
  const delays = [300, 1500, 3500, 6000];
  for (const d of delays) {
    await page.waitForTimeout(d === delays[0] ? d : d - delays[delays.indexOf(d) - 1]);
    await page.evaluate(() => { if (typeof loadSxrCards === 'function') loadSxrCards({ background: true }); });
    if (d === 1500) await page.evaluate((s) => { if (typeof _sxrV2OnRealtimeChange === 'function') _sxrV2OnRealtimeChange(s); }, slug || 'sidneylaruel');
  }
  await page.waitForTimeout(1200);
}

// Analyse a timeline relative to a target signature the action was meant to reach.
// reverted = after first reaching target, it ever showed a DIFFERENT signature.
function analyse(tl, targetSig) {
  const sigs = tl.map(e => e.sig);
  let flips = 0; for (let i = 1; i < sigs.length; i++) if (sigs[i] !== sigs[i - 1]) flips++;
  const firstIdx = tl.findIndex(e => e.sig === targetSig);
  const firstChangeMs = (tl[0] && tl[1]) ? +(tl[1].t - tl[0].t).toFixed(1) : 0;
  const afterTarget = firstIdx >= 0 ? tl.slice(firstIdx) : [];
  const reverted = afterTarget.some(e => e.sig !== targetSig);
  return { reachedTarget: firstIdx >= 0, reverted, flips, statesAfter: [...new Set(afterTarget.map(e => e.sig))], allStates: [...new Set(sigs)], firstChangeMs };
}

module.exports = { track, timeline, curSig, fireFlickerTriggers, analyse };
