'use strict';
/* A general layout scanner for the review boards (Layoutpass, OPEN_REPAIRS 714). It runs in the page and walks the
   document and every open shadow root, and reports, in CSS pixels:
     - overlap: two visible controls (buttons, links, inputs) whose boxes cross, where neither holds the other. The
       one stacking on purpose is a split button's caret, which sits on its own Approve's padding;
     - clipped: a control cut off by a box that hides its overflow (it is partly unseen and partly unpressable);
     - truncated: a control or a one-line text cut short with "..." or hidden overflow that carries no tooltip (title,
       aria-label or data-tip on itself or a near parent), so the full words cannot be read anywhere;
     - outside: a control past the window's left or right edge;
     - hscroll: the page scrolls sideways.
   `scope` limits the walk to a part of the page (a CSS selector inside the shadow root or the document). `ignore`
   is a list of CSS selectors whose matches are left out (a closed menu's leftovers, a strip that scrolls on purpose);
   `popups` lists the page's own menu classes, whose items may cover the page under them.
   Kept free of test-framework code so any browser test can call it through page.evaluate(layoutScan, opts). */
function layoutScan(opts) {
  opts = opts || {};
  const ignore = (opts.ignore || []).join(',');
  const roots = [];
  (function walk(root) { roots.push(root); for (const e of root.querySelectorAll('*')) if (e.shadowRoot) walk(e.shadowRoot); })(document);
  const CTRL = 'button,a[href],[role="button"],[role="tab"],[role="menuitem"],input:not([type="hidden"]),select,textarea,summary';
  const isVisible = el => {
    if (el.closest('[hidden],[inert]')) return false;
    const st = getComputedStyle(el);
    if (st.visibility !== 'visible' || st.display === 'none' || Number(st.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    for (let p = el; p; p = p.parentElement || (p.getRootNode && p.getRootNode().host) || null) {
      const s = getComputedStyle(p);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) return false;
      if (p === document.documentElement) break;
    }
    return true;
  };
  const deepContains = (a, b) => { for (let n = b; n; n = n.parentNode || n.host) if (n === a) return true; return false; };
  const label = el => {
    const t = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const c = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + (c ? '.' + c : '') + (t ? ' "' + t + '"' : '');
  };
  const hasTip = el => { for (let p = el, i = 0; p && i < 4; p = p.parentElement, i++) if (p.getAttribute && (p.getAttribute('title') || p.getAttribute('aria-label') || p.getAttribute('data-tip') || p.getAttribute('data-tooltip'))) return true; return false; };
  const inScope = el => {
    if (!opts.scope) return true;
    for (let n = el; n; n = n.parentElement || (n.getRootNode && n.getRootNode().host) || null) if (n.matches && n.matches(opts.scope)) return true;
    return false;
  };
  const ignored = el => { if (!ignore) return false; for (let n = el; n; n = n.parentElement || (n.getRootNode && n.getRootNode().host) || null) if (n.matches && n.matches(ignore)) return true; return false; };
  // What of a box can be seen: cut by every box from `from` up that hides or scrolls its overflow. A message
  // scrolled under the composer is out of sight, not under it; `sx` says a parent scrolls sideways.
  const seen = (from, r0) => {
    const v = { left: r0.left, top: r0.top, right: r0.right, bottom: r0.bottom };
    let sx = false;
    for (let p = from; p && p !== document.documentElement; p = p.parentElement || (p.getRootNode && p.getRootNode().host) || null) {
      const s = getComputedStyle(p);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const q = p.getBoundingClientRect();
      if (/auto|scroll/.test(s.overflowX) && p.scrollWidth > p.clientWidth + 1) sx = true;
      if (s.overflowX !== 'visible') { v.left = Math.max(v.left, q.left); v.right = Math.min(v.right, q.right); }
      if (s.overflowY !== 'visible') { v.top = Math.max(v.top, q.top); v.bottom = Math.min(v.bottom, q.bottom); }
    }
    return { v, sx };
  };
  const ctrls = [];
  for (const root of roots) for (const el of root.querySelectorAll(CTRL)) {
    if (!inScope(el) || ignored(el) || !isVisible(el)) continue;
    // A control inside another control (an icon button drawn in a link) is part of it.
    let inner = false;
    for (let p = el.parentElement; p; p = p.parentElement) if (p.matches && p.matches(CTRL)) { inner = true; break; }
    if (inner) continue;
    // What of it can be seen: its box cut by every parent that hides or scrolls its overflow. A message scrolled
    // under the composer is out of sight, not under it.
    const r0 = el.getBoundingClientRect();
    const { v, sx } = seen(el.parentElement || el.getRootNode().host, r0);
    if (v.right - v.left < 2 || v.bottom - v.top < 2) continue;
    ctrls.push({ el, r: v, box: r0, sx });
  }
  const out = { overlap: [], clipped: [], truncated: [], outside: [], hscroll: 0 };
  const POPS = '[role="menu"],[role="dialog"],[role="listbox"],[role="tooltip"]' + (opts.popups ? ',' + opts.popups.join(',') : '');
  const W = innerWidth;
  for (let i = 0; i < ctrls.length; i++) for (let j = i + 1; j < ctrls.length; j++) {
    const a = ctrls[i], b = ctrls[j];
    const ix = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
    const iy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (ix <= 1 || iy <= 1) continue;
    if (deepContains(a.el, b.el) || deepContains(b.el, a.el)) continue;
    // A split button's caret sits over its own Approve's right padding by design.
    // A button set inside a text box's padding (a send arrow in the corner of the message box) covers no text.
    const field = [a, b].find(c => /^(TEXTAREA|INPUT)$/.test(c.el.tagName)), other = field === a ? b : a;
    if (field) {
      const s = getComputedStyle(field.el), f = field.box;
      const cl = f.left + parseFloat(s.paddingLeft), cr = f.right - parseFloat(s.paddingRight), ct = f.top + parseFloat(s.paddingTop), cb = f.bottom - parseFloat(s.paddingBottom);
      if (Math.min(cr, other.r.right) - Math.max(cl, other.r.left) <= 1 || Math.min(cb, other.r.bottom) - Math.max(ct, other.r.top) <= 1) continue;
    }
    const split = a.el.closest('.split');
    if (split && split === b.el.closest('.split') && (a.el.classList.contains('sarr') || b.el.classList.contains('sarr'))) continue;
    // A menu or popover opened over the page covers what is under it on purpose: only its own items are checked
    // against each other. `popups` adds the page's own menu classes to the roles that mark one.
    const POP = '[role="menu"],[role="dialog"],[role="listbox"],[role="tooltip"]' + (opts.popups ? ',' + opts.popups.join(',') : '');
    const pa = a.el.closest(POP), pb = b.el.closest(POP);
    if (pa !== pb) continue;
    const cx = Math.max(a.r.left, b.r.left) + ix / 2, cy = Math.max(a.r.top, b.r.top) + iy / 2;
    out.overlap.push(label(a.el) + ' x ' + label(b.el) + ' (' + Math.round(ix) + 'x' + Math.round(iy) + ' at ' + Math.round(cx) + ',' + Math.round(cy) + ')');
  }
  // Words lying on a control: a label, a date or a badge whose own text crosses a button it is not part of.
  if (opts.texts !== false) for (const root of roots) for (const el of root.querySelectorAll('*')) {
    if (/^(SCRIPT|STYLE|SVG|svg|path|TEXTAREA|INPUT|SELECT|OPTION)$/.test(el.tagName) || el.closest(CTRL)) continue;
    let own = '';
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
    if (!own.trim() || !inScope(el) || ignored(el) || !isVisible(el)) continue;
    // A label a click passes through (pointer-events: none) takes nothing away from the control under it.
    if (getComputedStyle(el).pointerEvents === 'none') continue;
    const range = document.createRange();
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      range.selectNodeContents(n);
      for (const t0 of range.getClientRects()) {
        const t = seen(el, t0).v;
        if (t.right - t.left < 2 || t.bottom - t.top < 2) continue;
        for (const c of ctrls) {
          if (deepContains(c.el, el) || deepContains(el, c.el)) continue;
          if ((c.el.closest(POPS) || null) !== (el.closest(POPS) || null)) continue;
          const ix = Math.min(t.right, c.r.right) - Math.max(t.left, c.r.left), iy = Math.min(t.bottom, c.r.bottom) - Math.max(t.top, c.r.top);
          if (ix > 2 && iy > 2) out.overlap.push('text "' + n.textContent.trim().slice(0, 30) + '" x ' + label(c.el) + ' (' + Math.round(ix) + 'x' + Math.round(iy) + ')');
        }
      }
    }
  }
  for (const { el, box: r, sx } of ctrls) {
    if (r.right < 0 || r.left > W) continue;   // wholly off screen: a strip that scrolls, not a clipped control
    if (!sx && (r.left < -1 || r.right > W + 1)) out.outside.push(label(el) + ' (' + Math.round(r.left) + '-' + Math.round(r.right) + ' of ' + W + ')');
    for (let p = el.parentElement || el.getRootNode().host; p && p !== document.body && p !== document.documentElement; p = p.parentElement || (p.getRootNode && p.getRootNode().host) || null) {
      const s = getComputedStyle(p);
      const hid = v => v === 'hidden' || v === 'clip';
      if (!hid(s.overflowX) && !hid(s.overflowY)) { if (/auto|scroll/.test(s.overflowX + s.overflowY)) break; continue; }
      const q = p.getBoundingClientRect();
      const cutX = hid(s.overflowX) && (r.left < q.left - 1 || r.right > q.right + 1);
      const cutY = hid(s.overflowY) && (r.top < q.top - 1 || r.bottom > q.bottom + 1);
      // Wholly outside the box is a hidden item (a strip's next card), not a cut one.
      const gone = r.right <= q.left || r.left >= q.right || r.bottom <= q.top || r.top >= q.bottom;
      if ((cutX || cutY) && !gone) out.clipped.push(label(el) + ' cut by ' + label(p) + ' (' + [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)].join(',') + ' in ' + [Math.round(q.left), Math.round(q.top), Math.round(q.right), Math.round(q.bottom)].join(',') + ')');
      break;
    }
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && !hasTip(el) && !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) out.truncated.push(label(el) + ' (' + el.scrollWidth + ' > ' + el.clientWidth + ')');
  }
  // One-line texts cut with "..." and no tooltip anywhere near (titles, names, chips).
  if (opts.texts !== false) for (const root of roots) for (const el of root.querySelectorAll('*')) {
    if (el.children.length > 3 || !el.textContent.trim()) continue;
    const s = getComputedStyle(el);
    if (s.textOverflow !== 'ellipsis' || s.whiteSpace !== 'nowrap') continue;
    if (el.scrollWidth <= el.clientWidth + 1 || !inScope(el) || ignored(el) || !isVisible(el)) continue;
    if (hasTip(el)) continue;
    out.truncated.push(label(el) + ' (' + el.scrollWidth + ' > ' + el.clientWidth + ')');
  }
  const se = document.scrollingElement || document.documentElement;
  if (se.scrollWidth > se.clientWidth + 1) out.hscroll = se.scrollWidth - se.clientWidth;
  out.count = ctrls.length;
  return out;
}

module.exports = { layoutScan };
