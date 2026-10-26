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
    .trp-sw.on i{background:var(--sv-slot-video-fg,#db2777)}
    .trp-sw.on i::after{left:12px}
    .trp-off .trp-sw{opacity:.45}
    .trp-off:hover .trp-sw{opacity:.9}
    .trp-main .cal-link-pill-open{min-width:0}
    .trp-main .cal-link-label{display:flex;align-items:baseline;gap:7px;min-width:0;white-space:nowrap;overflow:hidden}
    .trp-state{font-size:10.5px;font-weight:700;opacity:.75;overflow:hidden;text-overflow:ellipsis}
    .trp-chev{flex:none;align-self:center;display:grid;place-items:center;width:16px;height:14px;margin-right:2px;border-radius:5px;color:inherit;cursor:pointer;opacity:.8}
    .trp-chev svg{width:10px;height:10px;transition:transform .15s}
    .trp-open .trp-chev svg{transform:rotate(180deg)}
    .trp-list{display:flex;flex-direction:column;gap:3px;margin:-2px 0 8px 10px;padding-left:8px;border-left:2px solid var(--sv-slot-video-border,rgba(219,39,119,.25))}
    .trp-v{display:flex;align-items:center;gap:8px;min-height:24px;padding:2px 6px 2px 8px;border-radius:7px;font-size:11.5px;font-weight:600;color:var(--sv-slot-video-fg,#9d174d);background:color-mix(in srgb,var(--sv-slot-video-bg,#fce7f3) 55%,transparent)}
    .trp-v .trp-l{flex:none}
    .trp-v .trp-go{flex:none;opacity:.7;display:inline-flex}
    .trp-v .trp-go svg{width:11px;height:11px}
    .trp-v .trp-paste{font-weight:500;font-style:italic;opacity:.65;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .trp-v.trp-dropped .trp-l{text-decoration:line-through;opacity:.55}
    .trp-v .trp-pick{flex:none;border:0;background:none;color:inherit;font:inherit;font-size:10.5px;font-weight:700;opacity:.85;cursor:pointer;padding:0}
    .trp-lab{margin-left:auto;flex:none;border-radius:999px;padding:1px 7px;font-size:10px;font-weight:700;white-space:nowrap}
    .trp-lab{--c:var(--cal-status-n-a-fg,#6b7280);color:var(--c);background:color-mix(in srgb,var(--c) 13%,transparent)}
    .trp-lab[data-l="approved"]{--c:var(--ok-solid-bg,#16a34a)}
    .trp-lab[data-l="change asked"]{--c:var(--warn-solid-deep-bg,#ea580c)}
    .trp-lab[data-l="on trial"]{--c:var(--sv-slot-video-fg,#7c3aed)}
    .trp-lab[data-l="winner"]{--c:var(--wl-progress-accent-hover,#ca8a04)}
    /* Notes: the version switch reuses the look of the Notes "About the…" switch */
    .trp-notes-sw{display:flex;align-items:center;gap:8px}
    .trp-notes-sw .cal-cm-aud-btn{min-width:28px}
    .trp-notes-bar{justify-content:center;padding:8px 16px 4px}
    .trp-notes-bar .cal-cm-aud-btn{min-width:38px}
    .fv-stage-foot.trp-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
    /* Production */
    .trp-prod-v .prod-asset-label{padding-left:12px;font-weight:500;opacity:.75}
    .trp-prod-v .trp-lab{margin-left:auto}
    .trp-prod-toggle{border:0;background:none;color:inherit;font:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:0}
    .trp-prod-toggle svg{width:10px;height:10px;transition:transform .15s}
    .trp-prod-open .trp-prod-toggle svg{transform:rotate(180deg)}
  `;
  const CHEV = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5"/></svg>';
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
    if (state === 'due') return { main: 'Video · ' + LETTERS.length, tiny: 'Pick the winner' };
    return { main: 'Video C', tiny: '★ winner' };
  }
  // state: 'off' | 'review' | 'trial' | 'due' | 'winner'; open: the versions list is expanded
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
          + (state === 'due' && L[l] === 'on trial' ? '<button type="button" class="trp-pick">★ Make winner</button>' : '')
          + '<span class="trp-lab" data-l="' + L[l] + '">' + L[l] + '</span>';
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
  // Production: state 'review' | 'winner'; open: the versions list is expanded.
  function production(state, open) {
    addCss();
    const row = document.querySelector('.prod-asset-row[data-prod-asset-slot="deliverable_file"]');
    if (!row || row.dataset.trp) return;
    row.dataset.trp = '1';
    const a = row.querySelector('.prod-asset-value a');
    if (a) a.textContent = state === 'winner' ? 'Video C' : 'Video A';
    const L = LABELS[state];
    const ok = LETTERS.filter(l => L[l] === 'approved').length;
    const live = LETTERS.filter(l => L[l] !== 'dropped').length;
    const vrow = document.createElement('div');
    vrow.className = 'prod-asset-row trp-prod-vrow' + (open ? ' trp-prod-open' : '');
    vrow.innerHTML = '<span class="prod-asset-label">Versions</span><span class="prod-asset-value"><button type="button" class="trp-prod-toggle"></button></span>';
    vrow.querySelector('button').innerHTML = (state === 'winner' ? '5 · Video C won' : '5 · ' + ok + '/' + live + ' approved') + ' ' + CHEV;
    row.after(vrow);
    if (!open) return;
    // Each version is an ordinary Assets row, so it sits on the panel's own columns at every width.
    let after = vrow;
    const linkLabel = typeof _prodFileLinkLabel === 'function' ? _prodFileLinkLabel : () => 'Open Frame.io';
    for (const l of LETTERS) {
      const linked = !LINKED[state] || LINKED[state].includes(l);
      const url = 'https://f.io/fixture-version-' + l.toLowerCase();
      const v = document.createElement('div');
      v.className = 'prod-asset-row trp-prod-v';
      v.innerHTML = '<span class="prod-asset-label">Video ' + l + '</span><span class="prod-asset-value">'
        + (linked ? '<a href="#" onclick="return false"></a>' : '<span>Not provided</span>') + '</span>'
        + '<span class="trp-lab" data-l="' + L[l] + '">' + L[l] + '</span>';
      if (linked) v.querySelector('a').textContent = linkLabel(url);
      after.after(v);
      after = v;
    }
  }
  window.svTrialPreview = { card, notes, production };
})();
