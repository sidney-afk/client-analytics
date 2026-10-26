/* Trial reels preview on the REAL card (session Trials, 2026-10-26). Loaded into the built page by make-screenshots.js;
 * local only, never shipped. It adds two things to today's card and changes nothing else:
 *   1. a "Trial reels" switch row under the date;
 *   2. the versions list in place of the single Video link: one row per version, cloned from today's Video link row,
 *      each with its hook, its Frame.io link (pasted by whoever uploads that version, as the Video link is today) and
 *      its label.
 * States: 'review' (versions being reviewed), 'trial' (on trial, 24 h timer), 'winner' (the SMM picked one).
 * Every hook and title is fictional. */
(function () {
  const VERSIONS = [
    { l: 'A', hook: 'Nobody tells you this about the first second', link: true },
    { l: 'B', hook: 'You have one second. Here is how to use it', link: true },
    { l: 'C', hook: 'Stop scrolling. Yes, you', link: true },
    { l: 'D', hook: 'The rule every viral video follows', link: true },
    { l: 'E', hook: 'I tested 100 openings. One won', link: false },
  ];
  const LABELS = {
    review: { A: 'approved', B: 'approved', C: 'change asked', D: 'dropped', E: 'waiting' },
    trial: { A: 'on trial', B: 'on trial', C: 'on trial', D: 'dropped', E: 'on trial' },
    winner: { A: 'lost', B: 'lost', C: 'winner', D: 'dropped', E: 'lost' },
  };
  const TONE = {
    'waiting': ['var(--sv-bg-f3f4f6, #f3f4f6)', '#6b7280'], 'approved': ['#dcfce7', '#166534'], 'change asked': ['#ffedd5', '#9a3412'],
    'dropped': ['#f3f4f6', '#9ca3af'], 'on trial': ['#ede9fe', '#5b21b6'], 'winner': ['#fef3c7', '#92400e'], 'lost': ['#f3f4f6', '#6b7280'],
  };
  const css = `
    .tr-row{display:flex;align-items:center;gap:8px;border-radius:8px;background:var(--field-bg,#f3f3f1);padding:6px 10px;margin:0 0 8px;font-size:12px;font-weight:600;color:var(--text-primary,#111)}
    .tr-row .tr-sub{font-weight:500;color:#8b8b84;margin-left:auto}
    .tr-switch{width:30px;height:18px;border-radius:999px;background:#7c3aed;position:relative;flex:none}
    .tr-switch::after{content:"";position:absolute;top:2px;left:14px;width:14px;height:14px;border-radius:50%;background:#fff}
    .tr-head{display:flex;align-items:center;font-size:10px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;color:#8b8b84;margin:2px 2px 6px}
    .tr-head span{margin-left:auto;text-transform:none;letter-spacing:0;font-weight:600}
    .tr-v{margin-bottom:6px !important;height:auto !important;min-height:30px;align-items:stretch}
    .tr-v .cal-link-pill-open{height:auto !important;min-height:30px;padding-top:6px !important;padding-bottom:6px !important;align-items:flex-start !important;text-align:left}
    .tr-v .cal-link-edit{height:auto !important}
    .tr-v .cal-link-label{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;min-width:0;overflow:visible;white-space:normal}
    .tr-letter{flex:none;width:18px;height:18px;border-radius:5px;background:rgba(255,255,255,.75);display:grid;place-items:center;font-size:10px;font-weight:800}
    .tr-hook{flex:1 1 calc(100% - 30px);min-width:0;white-space:normal;line-height:1.3;font-weight:600}
    .tr-lab{flex:none;margin-left:24px;border-radius:999px;padding:1px 7px;font-size:10px;font-weight:700;white-space:nowrap}
    .tr-v.tr-nolink{opacity:1}
    .tr-v.tr-nolink .tr-hook{font-weight:500}
    .tr-v.tr-dropped .tr-hook{text-decoration:line-through;opacity:.6}
    .tr-paste{flex:none;font-size:10px;font-weight:600;color:#9d174d;opacity:.8;margin-left:24px}
    .tr-chip{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:3px 10px;font-size:11px;font-weight:700;margin:0 0 8px}
    .tr-more{font-size:11px;color:#8b8b84;margin:0 2px 8px}
  `;
  function apply(state, opts) {
    opts = opts || {};
    if (!document.getElementById('trPreviewCss')) { const s = document.createElement('style'); s.id = 'trPreviewCss'; s.textContent = css; document.head.appendChild(s); }
    const labels = LABELS[state];
    document.querySelectorAll('.cal-link-field.cal-link-post').forEach(video => {
      if (video.dataset.trDone || !video.offsetParent) return;
      video.dataset.trDone = '1';
      const host = video.parentElement;
      // 1. The switch row, under the date (or before the links on the phone card).
      const meta = host.querySelector('.cal-meta-row');
      const sw = document.createElement('div');
      sw.className = 'tr-row';
      sw.innerHTML = '<span class="tr-switch" role="switch" aria-checked="true"></span>Trial reels<span class="tr-sub">' + VERSIONS.length + ' versions</span>';
      const firstLink = host.querySelector('.cal-link-field');
      (meta && meta.nextSibling ? meta.parentElement.insertBefore(sw, meta.nextSibling) : host.insertBefore(sw, firstLink));
      // The timer or winner chip.
      if (state === 'trial' || state === 'winner') {
        const chip = document.createElement('div');
        chip.className = 'tr-chip';
        const [bg, fg] = TONE[state === 'trial' ? 'on trial' : 'winner'];
        chip.style.background = bg; chip.style.color = fg;
        chip.textContent = state === 'trial' ? 'On trial · 17 h left' : '★ Winner: version C · posts on the calendar date';
        sw.after(chip);
      }
      // 2. The versions, cloned from today's Video link row.
      const head = document.createElement('div');
      head.className = 'tr-head';
      const answered = VERSIONS.filter(v => labels[v.l] !== 'waiting').length;
      head.innerHTML = 'Video versions<span>' + (state === 'review' ? answered + ' of ' + VERSIONS.length + ' answered' : state === 'trial' ? 'posted as trial reels' : 'winner picked') + '</span>';
      video.before(head);
      const list = state === 'winner' && opts.collapsed ? VERSIONS.filter(v => labels[v.l] === 'winner') : VERSIONS;
      for (const v of list) {
        const row = video.cloneNode(true);
        row.querySelectorAll('[onclick],[oninput],[onchange],[onkeydown],[onblur],[onfocus]').forEach(n => { for (const a of ['onclick', 'oninput', 'onchange', 'onkeydown', 'onblur', 'onfocus']) n.removeAttribute(a); });
        row.classList.add('tr-v');
        const lab = labels[v.l];
        if (lab === 'dropped') row.classList.add('tr-dropped');
        const hasLink = v.link || state !== 'review';
        if (!hasLink) row.classList.add('tr-nolink');
        const [bg, fg] = TONE[lab];
        const label = row.querySelector('.cal-link-label');
        label.innerHTML = '<span class="tr-letter">' + v.l + '</span><span class="tr-hook"></span>' +
          '<span class="tr-lab" style="background:' + bg + ';color:' + fg + '">' + lab + '</span>' + (hasLink ? '' : '<span class="tr-paste" style="margin-left:0">Paste Frame link</span>') + (lab === 'on trial' ? '<span class="tr-paste" style="margin-left:0;color:#92400e">★ Make winner</span>' : '');
        label.querySelector('.tr-hook').textContent = v.hook;
        row.querySelector('.cal-link-label').style.width = '100%';
        const pill = row.querySelector('.cal-link-pill-open'); if (pill) pill.style.flex = '1 1 auto';
        video.before(row);
      }
      if (state === 'winner' && opts.collapsed) {
        const more = document.createElement('div');
        more.className = 'tr-more';
        more.textContent = '4 other versions: 3 lost, 1 dropped. Show';
        video.before(more);
      }
      video.style.display = 'none';
    });
  }
  window.svTrialPreview = { apply };
})();
