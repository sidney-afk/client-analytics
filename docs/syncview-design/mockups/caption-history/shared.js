/* Caption history mockups (session Versions, 2026-10-23). NOT shipped: static design only.
   Fictional post and people; no real client, staff member or caption. */
(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  document.documentElement.setAttribute('data-theme', q.get('theme') === 'dark' ? 'dark' : 'light');

  /* Oldest first. "how" is one of: generated, redo, typed, client, restored. */
  const VERSIONS = [
    { id: 1, how: 'generated', who: 'You', when: 'Tue 20 Oct, 14:02',
      text: "Most people stretch for 30 seconds and call it a warm up.\n\nHere is the 4 minute routine our coaches use before every heavy session: hips, ankles, upper back, then two light sets.\n\nTry it tomorrow and tell us how your first set feels.\n\nComment WARMUP and we'll send you the full routine." },
    { id: 2, how: 'redo', who: 'You', when: 'Tue 20 Oct, 14:06', note: 'shorter, and a hookier first line',
      text: "Your warm up is why your first set feels heavy.\n\nOur coaches spend 4 minutes on hips, ankles and upper back before every session. Then two light sets.\n\nComment WARMUP and we'll send you the full routine." },
    { id: 3, how: 'typed', who: 'Alex', when: 'Wed 21 Oct, 09:40',
      text: "Your warm up is why your first set feels heavy.\n\nOur coaches spend 4 minutes on hips, ankles and upper back before every lift. Then two easy sets.\n\nComment WARMUP and we'll send you the full routine." },
    { id: 4, how: 'client', who: 'Client', when: 'Wed 21 Oct, 18:12',
      text: "Your warm up is why your first set feels heavy.\n\nOur coaches spend 4 minutes on hips, ankles and upper back before every lift. Then two easy sets.\n\nDM us WARMUP and we'll send you the full routine." }
  ];
  const HOW = {
    generated: { label: 'Generated', icon: 'spark' },
    redo: { label: 'Regenerated with note', icon: 'redo' },
    typed: { label: 'Edited by hand', icon: 'pen' },
    client: { label: 'Client edited on the review link', icon: 'person' },
    restored: { label: 'Put back from an earlier version', icon: 'history' }
  };
  const ICONS = {
    spark: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.8 1.8M10.2 10.2 12 12M12 4l-1.8 1.8M5.8 10.2 4 12"/></svg>',
    redo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13.4 8a5.4 5.4 0 1 1-1.7-3.9"/><path d="M13.6 2.2v3.2h-3.2"/></svg>',
    pen: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 2.5l3 3L6 13H3v-3z"/></svg>',
    person: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="5.5" r="2.6"/><path d="M2.8 14c.6-2.7 2.7-4.2 5.2-4.2s4.6 1.5 5.2 4.2"/></svg>',
    history: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 8a5.4 5.4 0 1 0 1.6-3.8"/><path d="M2.4 2.4v2.9h2.9"/><path d="M8 5v3.2l2.1 1.3"/></svg>',
    x: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7"/></svg>',
    chev: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5l3 3 3-3"/></svg>',
    restore: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5 2.5 7 6 10.5"/><path d="M2.8 7H10a3.5 3.5 0 0 1 0 7H8"/></svg>',
    arrow: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h10M9 4l4 4-4 4"/></svg>'
  };

  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /* Word-level diff (longest common subsequence over words, whitespace kept with its word).
     Returns [{t:'same'|'ins'|'del', s:text}]. Captions are a few hundred words, so the table is small. */
  function diffWords(a, b) {
    const A = String(a).match(/\s+|[^\s]+/g) || [], B = String(b).match(/\s+|[^\s]+/g) || [];
    const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = []; let i = 0, j = 0;
    const push = (t, s) => { const last = out[out.length - 1]; if (last && last.t === t) last.s += s; else out.push({ t, s }); };
    while (i < n && j < m) {
      if (A[i] === B[j]) { push('same', A[i]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) { push('del', A[i]); i++; }
      else { push('ins', B[j]); j++; }
    }
    while (i < n) push('del', A[i++]);
    while (j < m) push('ins', B[j++]);
    return out;
  }
  /* Readable regions: [{same:text}] or [{del:text, ins:text}]. A common bit between two changes that is only
     spaces or one short word ("is", "and") is absorbed into the change, so a reworded sentence reads as one
     struck phrase and one new phrase, not as alternating single words. */
  function regions(a, b) {
    const parts = diffWords(a, b), out = [];
    for (let k = 0; k < parts.length; k++) {
      const p = parts[k], last = out[out.length - 1];
      const tiny = p.t === 'same' && /^\s*\S{0,3}\s*$/.test(p.s) && !/\n/.test(p.s);
      if (p.t === 'same' && !(tiny && last && last.del != null && parts[k + 1] && parts[k + 1].t !== 'same')) { out.push({ same: p.s }); continue; }
      const r = last && last.del != null ? last : (out.push({ del: '', ins: '' }), out[out.length - 1]);
      if (p.t === 'same') { r.del += p.s; r.ins += p.s; }
      else r[p.t] += p.s;
    }
    return out;
  }
  /* Spaces and line breaks at the edges of a mark stay outside it, so no empty coloured bars. */
  function mark(tag, s) {
    const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return m[2] ? esc(m[1]) + '<' + tag + '>' + esc(m[2]) + '</' + tag + '>' + esc(m[3]) : esc(s);
  }
  /* Share of the words that changed. Above about 60% a caption was rewritten, and marking every word helps nobody. */
  function changedShare(a, b) {
    const c = counts(a, b), total = Math.max((String(a).match(/\S+/g) || []).length, (String(b).match(/\S+/g) || []).length, 1);
    return Math.min(1, Math.max(c.ins, c.del) / total);
  }
  /* mode: 'inline' (both marks), 'old' (only what was taken out), 'new' (only what was added) */
  function diffHtml(a, b, mode) {
    if (mode === 'inline' && changedShare(a, b) > 0.6) {
      return '<div class="rewrite"><b>Mostly rewritten</b></div>' +
        '<div class="rw-l">Before</div><div class="rw-old">' + esc(a) + '</div><div class="rw-l">After</div><div>' + esc(b) + '</div>';
    }
    return regions(a, b).map(r => {
      if (r.same != null) return esc(r.same);
      return (mode === 'new' ? '' : mark('del', r.del)) + (mode === 'old' ? '' : (r.del && r.ins && mode === 'inline' ? ' ' : '') + mark('ins', r.ins));
    }).join('');
  }
  function counts(a, b) {
    let ins = 0, del = 0;
    diffWords(a, b).forEach(p => { const w = (p.s.match(/[^\s]+/g) || []).length; if (p.t === 'ins') ins += w; if (p.t === 'del') del += w; });
    return { ins, del };
  }
  function howHtml(v, opts) {
    opts = opts || {};
    const h = HOW[v.how];
    if (opts.kindOnly) return '<div class="how"><span class="kind">' + ICONS[h.icon] + esc(h.label) + '</span></div>' +
      (v.note ? '<div class="note"><span class="nl">Note</span>' + esc(v.note) + '</div>' : '');
    return '<div class="how"><span class="kind">' + ICONS[h.icon] + esc(h.label) + '</span>' +
      '<span><b>' + esc(v.who) + '</b></span><span class="dot">·</span><span>' + esc(v.when) + '</span>' +
      (opts.current ? '<span class="dot">·</span><span>in the caption now</span>' : '') + '</div>' +
      (v.note && !opts.noNote ? '<div class="note"><span class="nl">Note</span>' + esc(v.note) + '</div>' : '');
  }
  function shell(title, sub, body, foot) {
    return '<div class="backdrop" aria-hidden="true">' + '<div class="ghost-card"></div>'.repeat(5) + '</div><div class="scrim"></div>' +
      '<div class="hx" role="dialog" aria-modal="true" aria-labelledby="hxT">' +
      '<div class="hx-head"><span class="ptag"><span class="pdot"></span>Caption</span><div><h3 id="hxT">' + esc(title) + '</h3><p>' + esc(sub) + '</p></div><span class="sp"></span>' +
      '<button class="hx-x" aria-label="Close">' + ICONS.x + '</button></div>' +
      '<div class="hx-body">' + body + '</div>' +
      '<div class="hx-foot">' + foot + '</div></div><div class="mock-tag">Mockup, not live</div>';
  }
  const EMPTY = '<div class="empty"><span class="ic">' + ICONS.history + '</span><b>No earlier versions yet</b>' +
    '<p>This caption has not changed since it was first written. From now on, every change (typed, regenerated, or edited by the client) is kept here, and any of them can be put back.</p></div>';

  window.CH = { q, VERSIONS, HOW, ICONS, esc, diffWords, diffHtml, changedShare, counts, howHtml, shell, EMPTY };
})();
