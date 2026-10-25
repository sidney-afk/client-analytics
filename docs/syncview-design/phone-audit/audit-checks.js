'use strict';
/* The per-screen checks the phone audits run in the page (session Grip, 2026-10-25): small or crowded taps, overflow,
   cut text and inputs under 16 px. Shared by audit.js and audit2.js. */
function CHECK(rootSel) {
  const host = rootSel ? document.querySelector(rootSel) : null;
  const root = host ? (host.shadowRoot || host) : document;
  const vis = e => { if (!e.checkVisibility || !e.checkVisibility({ checkVisibilityCSS: true })) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
  const desc = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + ' "' + (e.getAttribute('aria-label') || e.textContent || e.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 22) + '"';
  const taps = [...root.querySelectorAll('button,a[href],[role=button],input:not([type=hidden]),textarea,select,summary,[role=tab]')].filter(vis);
  const small = taps.filter(e => { const r = e.getBoundingClientRect(); return r.width < 43.5 || r.height < 43.5; }).map(e => { const r = e.getBoundingClientRect(); return desc(e) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height); });
  const close = [];
  for (let i = 0; i < taps.length; i++) for (let j = i + 1; j < taps.length; j++) {
    const a = taps[i].getBoundingClientRect(), b = taps[j].getBoundingClientRect();
    if (taps[i].contains(taps[j]) || taps[j].contains(taps[i])) continue;
    const gx = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right)), gy = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
    if (Math.max(gx, gy) < 4 && (a.height < 44 || b.height < 44 || a.width < 44 || b.width < 44)) close.push(desc(taps[i]) + ' | ' + desc(taps[j]));
  }
  const wide = [...root.querySelectorAll('*')].filter(vis).filter(e => { const r = e.getBoundingClientRect(); if (r.right <= innerWidth + 1 && r.left >= -1) return false; for (let p = e.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o !== 'visible') return false; } return getComputedStyle(e).position !== 'fixed'; }).map(e => desc(e) + ' ' + Math.round(e.getBoundingClientRect().left) + '..' + Math.round(e.getBoundingClientRect().right));
  const cut = [...root.querySelectorAll('*')].filter(vis).filter(e => e.childElementCount === 0 && e.textContent.trim().length > 2 && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible').map(e => desc(e) + ' ' + e.scrollWidth + '>' + e.clientWidth);
  const zoomFields = [...root.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]),textarea,select')].filter(e => e.checkVisibility && e.checkVisibility()).filter(e => parseFloat(getComputedStyle(e).fontSize) < 16).map(e => desc(e) + ' ' + getComputedStyle(e).fontSize);
  return { pageScrollWidth: document.documentElement.scrollWidth, small: small.slice(0, 20), smallCount: small.length, close: close.slice(0, 10), wide: wide.slice(0, 8), cut: cut.slice(0, 10), zoomFields };
}
module.exports = { CHECK };
