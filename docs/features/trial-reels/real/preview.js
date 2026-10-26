/* Trial reels preview on the REAL page (session Trials, 2026-10-26, round 2 after the owner's review).
 * Loaded into the built page by make-screenshots.js and make-notes-screenshots.js; local only, never shipped.
 * It changes nothing of today's page except these additions:
 *   card()       the staff card's Video row: a small Trial reels switch inside the row, before the pencil; with it on
 *                the row reads "Video · 5" with a tiny state ("3/4 approved", "On trial · 17 h left", "Video C"), and a
 *                chevron opens the versions under it ("Video A", "Video B"… each with its link and label). Collapsed,
 *                the card is exactly today's height. No hook text anywhere.
 *   notes(l)     the Notes view: a version switch (Video A B C D E) under the player, styled like the Notes
 *                "About the…" switch; the player and the Frame.io comments are the version on screen.
 *   production() the Production sub-issue's Assets: the Deliverable file row is the one link (version A, then the
 *                winner) and a collapsed "Video versions" row under it lists the versions, read only.
 * Every name, link and label is fictional. */
(function () {
  const LETTERS = ['A', 'B', 'C', 'D', 'E'];
  const LABELS = {
    review: { A: 'approved', B: 'approved', C: 'change asked', D: 'dropped', E: 'waiting' },
    trial: { A: 'on trial', B: 'on trial', C: 'on trial', D: 'dropped', E: 'on trial' },
    due: { A: 'on trial', B: 'on trial', C: 'on trial', D: 'dropped', E: 'on trial' },
    winner: { A: 'lost', B: 'lost', C: 'winner', D: 'dropped', E: 'lost' },
  };
  const LINKED = { review: ['A', 'B', 'C', 'D'] };   // E has no Frame.io link yet in the review state
  // Label tones from today's status tokens, so both themes follow.
  const css = `
    .trp-sw{flex:none;align-self:center;display:inline-flex;align-items:center;margin:0 6px 0 auto;padding:0;border:0;background:none;cursor:pointer;color:inherit;font:inherit}
    .trp-sw i{position:relative;display:block;width:22px;height:12px;border-radius:999px;background:color-mix(in srgb,currentColor 22%,transparent);transition:background .15s}
    .trp-sw i::after{content:"";position:absolute;top:2px;left:2px;width:8px;height:8px;border-radius:50%;background:#fff;box-shadow:0 0 0 .5px rgba(0,0,0,.1);transition:left .15s}
    .trp-sw.on i{background:color-mix(in srgb,currentColor 40%,transparent)}
    .trp-sw.on i::after{background:#fff;box-shadow:0 0 0 .5px rgba(0,0,0,.18)}
    .trp-sw.on i::after{left:12px}
    .trp-off .trp-sw{opacity:.45}
    .trp-off:hover .trp-sw{opacity:.9}
    .trp-main .cal-link-pill-open{min-width:0}
    .trp-main .cal-link-label{display:flex;align-items:center;gap:7px;min-width:0;white-space:nowrap;overflow:hidden}
    .trp-main .trp-state-ico{flex:none;align-self:center;display:grid;place-items:center;width:18px;height:18px;min-height:0!important;border-radius:5px;cursor:pointer;opacity:.85}
    .trp-main .trp-state-ico svg{width:13px;height:13px}
    .trp-main .trp-state-ico:hover{opacity:1;background:color-mix(in srgb,currentColor 12%,transparent)}
    .trp-state{font-size:10.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis}
    .trp-chev{flex:none;align-self:center;display:grid;place-items:center;width:16px;height:14px;margin-right:2px;border-radius:5px;color:inherit;cursor:pointer;opacity:.8}
    .trp-chev svg{width:10px;height:10px;transition:transform .15s}
    .trp-open .trp-chev svg{transform:rotate(180deg)}
    .trp-list{display:flex;flex-direction:column;gap:3px;margin:-2px 0 8px 10px;padding-left:8px;border-left:2px solid var(--sv-slot-video-border,rgba(219,39,119,.25))}
    .trp-v{display:flex;align-items:center;gap:8px;min-height:24px;padding:2px 6px 2px 8px;border-radius:7px;font-size:11.5px;font-weight:600;color:var(--sv-slot-video-fg,#9d174d);background:color-mix(in srgb,var(--sv-slot-video-bg,#fce7f3) 55%,transparent)}
    @media (max-width: 599px){ .trp-v{min-height:44px} }   /* phone tap height, the same on every version row */
    .trp-v .trp-l{flex:none}
    .trp-v .trp-go{flex:none;opacity:.7;display:inline-flex}
    .trp-v .trp-go svg{width:11px;height:11px}
    .trp-v .trp-paste{font-weight:500;font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .trp-v.trp-dropped .trp-l{text-decoration:line-through}
    .trp-v .trp-pick{flex:none;display:grid;place-items:center;width:20px;height:20px;margin-left:-2px;border:0;border-radius:5px;background:none;color:inherit;cursor:pointer;padding:0;opacity:.8}
    .trp-v .trp-pick:hover{opacity:1;background:color-mix(in srgb,currentColor 12%,transparent)}
    .trp-v .trp-pick svg{width:13px;height:13px}
    @media (max-width: 599px){ .trp-v .trp-pick{width:32px;height:32px} .trp-v .trp-pick svg{width:16px;height:16px} }
    .trp-lab-gap{margin-left:auto}
    .trp-lab{margin-left:auto;flex:none;border-radius:999px;padding:1px 7px;font-size:10px;font-weight:700;white-space:nowrap}
    .trp-lab{background:var(--cal-status-n-a-bg,#f3f4f6);color:var(--cal-status-n-a-fg,#4b5563)}
    .trp-lab[data-l="approved"]{background:var(--cal-status-approved-bg,#dcfce7);color:var(--cal-status-approved-fg,#166534)}
    .trp-lab[data-l="change asked"]{background:var(--wl-tweaks-chip-bg,#ffedd5);color:var(--wl-tweaks-chip-fg,#9a3412)}
    .trp-lab[data-l="on trial"]{background:var(--cal-status-scheduled-bg,#ede9fe);color:var(--cal-status-scheduled-fg,#5b21b6)}
    .trp-lab[data-l="winner"]{background:var(--wl-progress-chip-bg,#fef9c3);color:var(--wl-progress-chip-fg,#854d0e)}
    /* Notes: the version switch reuses the look of the Notes "About the…" switch */
    .trp-notes-sw{display:flex;align-items:center;gap:8px}
    .trp-notes-sw .cal-cm-aud-btn{min-width:28px}
    .trp-notes-bar{justify-content:center;padding:8px 16px 4px}
    .trp-notes-bar .cal-cm-aud-btn{min-width:38px}
    .fv-stage-foot.trp-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
    /* Production */
    .trp-prod-v .prod-asset-value{display:flex;align-items:center;gap:8px}
    .trp-prod-v .trp-lab{margin-left:2px}
    .trp-oncard{font-size:11px;font-weight:600;color:var(--prod-strong,inherit)}
  `;
  const CHEV = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5"/></svg>';
  // The pick-the-winner icon: a small trophy (the owner chose it; a checkmark already means "approved" here).
  const TROPHY = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 2.5h6v3.5a3 3 0 0 1-6 0z"/><path d="M5 3.5H3a2 2 0 0 0 2 2.5M11 3.5h2a2 2 0 0 1-2 2.5"/><path d="M8 9v2.5M5.5 13.5h5M6.5 11.5h3"/></svg>';
  const GO = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h4v4"/><path d="M13 3 7 9"/><path d="M12 9.5V13H3V4h3.5"/></svg>';
  function addCss() {
    if (document.getElementById('trpCss')) return;
    const s = document.createElement('style'); s.id = 'trpCss'; s.textContent = css; document.head.appendChild(s);
  }
  function rowState(state) {
    const L = LABELS[state];
    if (state === 'review') {
      const ok = LETTERS.filter(l => L[l] === 'approved').length;
      const live = LETTERS.filter(l => L[l] !== 'dropped').length;
      return { main: 'Video · ' + LETTERS.length, tiny: ok + '/' + live + ' approved' };
    }
    if (state === 'trial') return { main: 'Video · ' + LETTERS.length, tiny: 'On trial · 17 h left' };
    if (state === 'due') return { main: 'Video · ' + LETTERS.length, tiny: '' };
    return { main: 'Video C', tiny: '' };   // the owner: with a winner, the row just says "Video C"
  }
  // state: 'off' | 'review' | 'trial' | 'due' | 'winner'; open: the versions list is expanded
  // A label is shown only where it says something the row does not (owner: no visual noise): one that every live version
  // shares is dropped (the collapsed row already says it), "lost" is dropped once there is a winner, and "dropped",
  // "winner" and "change asked" always stay.
  function labelShown(L, l) {
    const lab = L[l];
    if (lab === 'dropped' || lab === 'winner' || lab === 'change asked') return true;
    if (lab === 'lost') return false;
    const liveLabels = LETTERS.filter(x => L[x] !== 'dropped').map(x => L[x]);
    return new Set(liveLabels).size > 1;
  }
  function card(state, open) {
    addCss();
    document.querySelectorAll('.cal-link-field.cal-link-post').forEach(video => {
      if (video.dataset.trp || !video.offsetParent) return;
      video.dataset.trp = '1';
      const pill = video.querySelector('.cal-link-pill-open');
      // Today's row height, held: the switch, the count and the chevron live inside it.
      video.style.height = video.getBoundingClientRect().height + 'px';
      const sw = document.createElement('span');
      sw.className = 'trp-sw' + (state === 'off' ? '' : ' on');
      sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-checked', state === 'off' ? 'false' : 'true');
      sw.title = state === 'off' ? 'Trial reels: off. Turn on to post this video as several versions' : 'Trial reels: on';
      sw.innerHTML = '<i></i>';
      if (state === 'off') { video.classList.add('trp-off'); pill.appendChild(sw); return; }
      video.classList.add('trp-main');
      if (open) video.classList.add('trp-open');
      const rs = rowState(state);
      const label = pill.querySelector('.cal-link-label');
      label.innerHTML = '<span></span><span class="trp-state"></span>';
      label.children[0].textContent = rs.main;
      label.children[1].textContent = rs.tiny;
      if (state === 'due') {
        // Once the 24 h are up the state slot holds only a small muted trophy (owner: no visual noise, the tooltip
        // explains it). Pressing it opens the list with a trophy on each version. Staff only; a client link never has it.
        const t = label.children[1];
        t.className = 'trp-state-ico';
        t.setAttribute('role', 'button');
        t.setAttribute('aria-label', 'Trial over: pick the winner');
        t.title = 'Trial over: pick the winner';
        t.innerHTML = TROPHY;
      }
      const chev = document.createElement('span');
      chev.className = 'trp-chev';
      chev.title = open ? 'Hide the versions' : 'Show the versions';
      chev.innerHTML = CHEV;
      pill.appendChild(sw);
      pill.appendChild(chev);
      if (!open) return;
      const L = LABELS[state];
      const list = document.createElement('div');
      list.className = 'trp-list';
      for (const l of LETTERS) {
        const linked = !LINKED[state] || LINKED[state].includes(l);
        const v = document.createElement('div');
        v.className = 'trp-v' + (L[l] === 'dropped' ? ' trp-dropped' : '');
        v.innerHTML = (linked ? '<span class="trp-go">' + GO + '</span>' : '') + '<span class="trp-l">Video ' + l + '</span>'
          + (linked ? '' : '<span class="trp-paste">Paste the Frame.io link</span>')
          + (labelShown(L, l) ? '<span class="trp-lab" data-l="' + L[l] + '">' + L[l] + '</span>' : '<span class="trp-lab-gap"></span>')
          + (state === 'due' && L[l] === 'on trial' ? '<button type="button" class="trp-pick" aria-label="Make this the winner" title="Make this the winner">' + TROPHY + '</button>' : '');
        list.appendChild(v);
      }
      video.after(list);
    });
  }
  // The Notes view: the switch under the player, the version on screen marked, the title and the note topic follow.
  function notes(letter) {
    addCss();
    const stage = document.getElementById('calNotesStage');
    const foot = stage && stage.querySelector('.fv-stage-foot');
    document.querySelectorAll('.trp-notes-sw').forEach(n => n.remove());   // rebuilt on every open
    if (stage) {
      const sw = document.createElement('div');
      sw.className = 'trp-notes-sw';
      sw.innerHTML = '<span class="cal-cm-audience-cap">Video</span><div class="cal-cm-aud-seg" role="tablist" aria-label="Versions">'
        + LETTERS.map(l => '<button type="button" class="cal-cm-aud-btn' + (l === letter ? ' is-active' : '') + '" role="tab" aria-selected="' + (l === letter) + '">' + l + '</button>').join('') + '</div>';
      if (innerWidth >= 600 && foot) {
        // Wide: beside "Open in Frame.io", under the player.
        foot.classList.add('trp-foot');
        foot.insertBefore(sw, foot.firstChild);
        const small = foot.querySelector('.fv-small-note'); if (small) small.remove();
      } else {
        // Phone: the stage's own buttons sit over the video, so the switch is a slim bar of its own under it.
        sw.classList.add('trp-notes-bar');
        stage.after(sw);
      }
    }
    const sub = document.querySelector('#calCommentsModal .cal-comments-head-text p');
    if (sub && !/· Video/.test(sub.textContent)) sub.textContent = sub.textContent + ' · Video ' + letter;
    const topic = [...document.querySelectorAll('#calCommentsModal .cal-cm-aud-btn')].find(b => b.textContent.trim() === 'Video');
    if (topic) topic.textContent = 'Video ' + letter;
    const quiet = document.querySelector('#calCommentsModal .cal-cm-quiet');
    if (quiet) quiet.textContent = quiet.textContent.replace(/Video$/, 'Video ' + letter);
  }
  // Production (owner, 2026-10-26: "more videos, more Frame deliverable rows"): each version is its own Deliverable
  // file row, cloned from today's row with its Edit and its availability state, plus the version's label. The row of the
  // version that is the card's link today (Video A, then the winner) is marked "on the card".
  function production(state) {
    addCss();
    const row = document.querySelector('.prod-asset-row[data-prod-asset-slot="deliverable_file"]');
    if (!row || row.dataset.trp) return;
    row.dataset.trp = '1';
    const L = LABELS[state];
    const main = state === 'winner' ? 'C' : 'A';
    const stateLabel = typeof _prodAssetStateLabel === 'function' ? _prodAssetStateLabel : s2 => s2;
    const linkLabel = typeof _prodFileLinkLabel === 'function' ? _prodFileLinkLabel : () => 'Open link';
    let after = row;
    const made = [];
    for (const l of LETTERS) {
      const linked = !LINKED[state] || LINKED[state].includes(l);
      const v = row.cloneNode(true);
      v.removeAttribute('data-trp');
      v.classList.add('trp-prod-v');
      v.querySelectorAll('[onclick]').forEach(n => n.removeAttribute('onclick'));
      v.querySelector('.prod-asset-label').textContent = 'Deliverable file · Video ' + l;
      const val = v.querySelector('.prod-asset-value');
      val.innerHTML = (linked ? '<a href="#" onclick="return false"></a>' : '<span>Not provided</span>')
        + (labelShown(L, l) ? ' <span class="trp-lab" data-l="' + L[l] + '">' + L[l] + '</span>' : '')
        + (l === main && L[l] !== 'winner' ? ' <span class="trp-oncard">on the card</span>' : '');
      if (linked) val.querySelector('a').textContent = linkLabel('https://f.io/fixture-version-' + l.toLowerCase());
      const st = v.querySelector('.prod-asset-state');
      if (st) { const k = linked ? 'available' : 'missing'; st.setAttribute('data-state', k); st.textContent = stateLabel(k); st.removeAttribute('title'); st.removeAttribute('data-prod-tip'); }
      after.after(v); after = v; made.push(v);
    }
    row.remove();
    // One set of columns for every version row, so the links, the states and the Edit buttons line up.
    const cols = getComputedStyle(made[0]).gridTemplateColumns;
    made.forEach(v => { v.style.gridTemplateColumns = cols; });
  }
  function rgba(c) {
    const m = String(c).match(/rgba?\(([^)]+)\)/); if (m) { const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    const n = String(c).match(/color\(srgb ([^)]+)\)/); if (n) { const p = n[1].split(/[ \/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1]; }
    return [0, 0, 0, 0];
  }
  const over = (top, under) => { const a = top[3] + under[3] * (1 - top[3]); return a ? [0, 1, 2].map(i => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a).concat(a) : [0, 0, 0, 0]; };
  function backdrop(el) {   // the colour behind an element: every background up to the page, composited
    const layers = []; for (let n = el; n; n = n.parentElement) layers.push(rgba(getComputedStyle(n).backgroundColor));
    return layers.reverse().reduce((acc, c) => over(c, acc), [255, 255, 255, 1]);
  }
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  function audit() {
    const out = { contrast: [], lefts: [] };
    for (const el of document.querySelectorAll('.trp-lab, .trp-v .trp-l, .trp-v .trp-paste, .trp-prod-v .prod-asset-label, .trp-prod-v .prod-asset-value > span:not(.trp-lab):not(.trp-oncard), .trp-oncard, .trp-main .trp-state')) {
      if (!el.offsetParent) continue;
      const bg = backdrop(el);
      let op = 1; for (let n = el; n; n = n.parentElement) op *= Number(getComputedStyle(n).opacity);
      const fg0 = rgba(getComputedStyle(el).color); const fg = over([fg0[0], fg0[1], fg0[2], fg0[3] * op], bg);
      const a = lum(fg), b = lum(bg);
      out.contrast.push({ text: el.textContent.trim().slice(0, 24), ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100 });
    }
    out.lefts = [...document.querySelectorAll('.trp-prod-v .prod-asset-value, .trp-prod-v .prod-asset-state, .trp-prod-v .prod-asset-edit')]
      .reduce((acc, n) => { const k = n.className.split(' ')[0]; (acc[k] = acc[k] || []).push(Math.round(n.getBoundingClientRect().left * 10) / 10); return acc; }, {});
    return out;
  }
  // The winner pick has no confirm: it happens at once and today's toast offers Undo, as Kasper's approve does.
  function undoToast(letter) {
    if (typeof showToast === 'function') showToast('Video ' + letter + ' is the winner', { actionLabel: 'Undo', onAction: () => {} });
  }
  window.svTrialPreview = { card, notes, production, audit, undoToast };
})();
