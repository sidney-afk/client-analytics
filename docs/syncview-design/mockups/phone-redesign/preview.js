/* Phone redesign preview (session Palm, 2026-10-23). LOCAL ONLY: make-screenshots.js injects this into the real,
   offline SyncView page; the app never loads it and nothing here writes anywhere.
   It reads the page's own data (calState.posts, the notes on each post, _msgState.conversations), uses the page's
   own colour tokens and font, and draws the proposed phone screens over the real page:
     svPhonePreview.sheet('list' | 'grid'), .detail(pid), .notes(pid), .inbox(filter), .chat(pid), .review(rootEl)
   The rules every screen follows: one level of container, hairlines instead of boxes, 4 px corners on chips,
   badges and buttons and 6 px on cards and sheets, colour only where it means something, every tap target 44 px,
   the actions people use often visible, the main action at the bottom where the thumb is.
   Unread badges follow session Beacon's rules (docs/audits/2026-10-23-unread-badges.md, PR #2299): icon plus number,
   filled = new for you, outlined = still needs the team; orange change, blue comment, grey staff, violet Kasper;
   change requests count on the card, never in Messages. */
(function () {
  const ME = 'Browser Staff';
  const DAY = 86400000;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const P = d => '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const I = {
    change: P('<path d="M10.5 2.5l3 3L6 13H3v-3z"/>'),
    comment: P('<path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/>'),
    answer: P('<path d="M6 4L2.5 7.5 6 11"/><path d="M3 7.5h6.5a4 4 0 0 1 4 4v1"/>'),
    staff: P('<circle cx="8" cy="5.5" r="2.5"/><path d="M3 13.5c.8-2.4 2.7-3.5 5-3.5s4.2 1.1 5 3.5"/>'),
    kasper: P('<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.8"/>'),
    lock: P('<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>'),
    eye: P('<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.8"/>'),
    check: P('<path d="M3 8.5l3 3 7-7"/>'),
    chev: P('<path d="M6 3.5L10.5 8 6 12.5"/>'),
    down: P('<path d="M4 6l4 4 4-4"/>'),
    back: P('<path d="M10 3L5 8l5 5"/>'),
    x: P('<path d="M4 4l8 8M12 4l-8 8"/>'),
    plus: P('<path d="M8 3v10M3 8h10"/>'),
    search: P('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>'),
    send: P('<path d="M2.5 8h10M8.5 4l4 4-4 4"/>'),
    more: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.3" fill="currentColor"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="12.5" cy="8" r="1.3" fill="currentColor"/></svg>',
    grid: P('<path d="M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z"/>'),
    list: P('<path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01"/>'),
    cal: P('<rect x="2" y="3" width="12" height="11" rx="1"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"/>'),
    review: P('<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M5 8.2l2 2 4-4.4"/>'),
    menu: P('<path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>'),
    open: P('<path d="M9 2.5h4.5V7"/><path d="M13.5 2.5L7.5 8.5"/><path d="M12 9.5v4H2.5V4h4"/>'),
    card: P('<rect x="2.5" y="2" width="11" height="12" rx="1"/><path d="M5 5.5h6M5 8h6M5 10.5h3.5"/>'),
    play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6l8-4.8z" fill="currentColor"/></svg>',
    folder: P('<path d="M2 4.5V12.5h12V6H8L6.5 4.5z"/>'),
  };
  const CSS = `
:root{--pv-r:4px;--pv-r2:6px;--pv-hair:var(--border-light);--pv-tint:color-mix(in srgb,var(--text-primary) 4%,transparent);
 --pv-change:#c2410c;--pv-comment:#1d4ed8;--pv-staff:#6b6b67;--pv-kasper:#6d28d9;--pv-ok:#15803d;--pv-amber:#a16207;--pv-teal:#0f766e;--pv-on:#ffffff;--pv-page:var(--bg);--pv-raise:var(--white)}
html[data-theme="dark"]{--pv-change:#fb923c;--pv-comment:#60a5fa;--pv-staff:#aeb6c2;--pv-kasper:#c4b5fd;--pv-ok:#4ade80;--pv-amber:#fbbf24;--pv-teal:#5eead4;--pv-on:#111214}
#pvScreen{position:fixed;inset:0;z-index:9000;background:var(--pv-page);color:var(--text-primary);font-family:'Plus Jakarta Sans',system-ui,sans-serif;display:flex;flex-direction:column;-webkit-font-smoothing:antialiased}
:where(#pvScreen,#pvSheet) *{box-sizing:border-box}
:where(#pvScreen,#pvSheet) button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent}
:where(#pvScreen,#pvSheet) svg{width:18px;height:18px;flex-shrink:0}
.pv-top{display:flex;align-items:center;gap:2px;height:56px;padding:0 6px 0 16px;flex-shrink:0}
.pv-top.sub{padding-left:4px;border-bottom:1px solid var(--pv-hair)}
.pv-top h1{font-size:1.12rem;font-weight:750;letter-spacing:-.01em;margin:0;display:flex;align-items:center;gap:6px;min-width:0;flex:1}
.pv-top h1 span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pv-top h1 svg{width:14px;height:14px;color:var(--text-secondary)}
.pv-tt{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.2}
.pv-tt b{font-size:1rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pv-tt small{font-size:.78rem;color:var(--text-secondary);font-weight:500}
.pv-ib{position:relative;width:44px;height:44px;display:inline-flex;align-items:center;justify-content:center;border-radius:var(--pv-r);color:var(--text-primary)}
.pv-ib svg{width:20px;height:20px}
.pv-tb{min-height:44px;padding:0 10px;font-size:.84rem;font-weight:700;border-radius:var(--pv-r);color:var(--text-primary)}
.pv-ib .pv-cnt{position:absolute;top:5px;right:3px}
.pv-cnt{display:inline-flex;align-items:center;justify-content:center;min-width:17px;height:17px;padding:0 4px;border-radius:3px;font-size:.66rem;font-weight:800;background:var(--pv-comment);color:var(--pv-on);box-shadow:0 0 0 2px var(--pv-page)}
.pv-bar{display:flex;align-items:center;justify-content:space-between;height:44px;padding:0 6px 0 16px;flex-shrink:0;color:var(--text-secondary);font-size:.8rem;font-weight:600}
.pv-seg{display:flex}
.pv-seg button{width:44px;height:44px;display:inline-flex;align-items:center;justify-content:center;color:var(--text-muted);border-radius:var(--pv-r)}
.pv-seg button[aria-pressed="true"]{color:var(--text-primary);background:var(--pv-tint)}
.pv-body{flex:1;overflow:auto;min-height:0}
/* rows */
.pv-row{display:flex;align-items:center;gap:12px;width:100%;min-height:76px;padding:8px 16px;text-align:left;position:relative}
.pv-row+.pv-row::before{content:'';position:absolute;top:0;left:72px;right:0;border-top:1px solid var(--pv-hair)}
.pv-th{width:44px;height:58px;border-radius:var(--pv-r);background:var(--pv-tint) center/cover no-repeat;flex-shrink:0}
.pv-rm{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.pv-rm b{font-size:.95rem;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pv-meta{display:flex;align-items:center;gap:6px;font-size:.8rem;color:var(--text-secondary);font-weight:500;min-width:0;white-space:nowrap}
.pv-meta .pv-dt{color:var(--text-muted)}
.pv-st{display:inline-flex;align-items:center;gap:6px}
.pv-st i{width:7px;height:7px;border-radius:2px;background:var(--pc,var(--text-muted));flex-shrink:0}
.pv-bs{display:flex;gap:4px;flex-shrink:0;align-items:center}
.pv-b{display:inline-flex;align-items:center;gap:3px;height:22px;padding:0 5px 0 4px;border-radius:var(--pv-r);font-size:.72rem;font-weight:800;background:var(--bc);color:var(--pv-on)}
.pv-b svg{width:13px!important;height:13px!important}
.pv-b.o{background:transparent;color:var(--bc);box-shadow:inset 0 0 0 1.5px var(--bc)}
.pv-b.more{background:transparent;color:var(--text-secondary);padding:0 2px}
/* grid */
.pv-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:2px;padding:0 0 12px}
.pv-tile{position:relative;aspect-ratio:3/4;background:var(--pv-tint) center/cover no-repeat;border-radius:0;overflow:hidden}
.pv-tile .pv-tl{position:absolute;left:6px;bottom:6px;font-size:.7rem;font-weight:700;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.6);display:flex;align-items:center;gap:5px}
.pv-tile .pv-tl i{width:7px;height:7px;border-radius:2px;background:var(--pc);box-shadow:0 0 0 1.5px rgba(255,255,255,.85)}
.pv-tile .pv-bs{position:absolute;top:5px;right:5px}
.pv-tile .pv-b{height:20px;box-shadow:0 0 0 1.5px rgba(255,255,255,.9)}
.pv-tile .pv-b.o{background:rgba(255,255,255,.92);box-shadow:inset 0 0 0 1.5px var(--bc)}
/* bottom tabs */
.pv-tabs{display:flex;flex-shrink:0;border-top:1px solid var(--pv-hair);background:var(--pv-raise);padding-bottom:env(safe-area-inset-bottom)}
.pv-tabs button{flex:1;height:58px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:.68rem;font-weight:650;color:var(--text-muted);position:relative}
.pv-tabs button svg{width:21px;height:21px}
.pv-tabs button[aria-current="page"]{color:var(--text-primary)}
.pv-tabs .pv-cnt{position:absolute;top:6px;left:calc(50% + 6px);background:var(--pv-amber)}
.pv-fab{position:absolute;right:16px;bottom:74px;height:44px;padding:0 16px 0 12px;display:inline-flex!important;align-items:center;gap:6px;border-radius:var(--pv-r)!important;background:var(--text-primary)!important;color:var(--pv-page)!important;font-weight:700!important;font-size:.86rem!important}
/* detail */
.pv-media{display:flex;gap:8px;padding:12px 16px 4px}
.pv-mt{flex:1;display:flex;flex-direction:column;gap:6px}
.pv-mt .pv-mi{aspect-ratio:4/5;border-radius:var(--pv-r2);background:var(--pv-tint) center/cover no-repeat;position:relative;display:flex;align-items:center;justify-content:center;color:#fff}
.pv-mt .pv-mi svg{width:30px;height:30px;filter:drop-shadow(0 1px 4px rgba(0,0,0,.5))}
.pv-mt span{display:flex;align-items:center;justify-content:space-between;font-size:.8rem;font-weight:650;color:var(--text-secondary);min-height:32px}
.pv-mt span svg{width:15px;height:15px}
.pv-h{display:flex;align-items:center;justify-content:space-between;padding:18px 16px 4px;font-size:.7rem;font-weight:750;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted)}
.pv-h button{font-size:.8rem;font-weight:650;letter-spacing:0;text-transform:none;color:var(--text-secondary);min-height:44px;padding:0 4px}
.pv-li{display:flex;align-items:center;gap:10px;width:100%;min-height:52px;padding:0 12px 0 16px;font-size:.95rem;font-weight:600;position:relative;text-align:left}
.pv-li+.pv-li::before{content:'';position:absolute;top:0;left:16px;right:0;border-top:1px solid var(--pv-hair)}
.pv-li .pv-lv{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:.86rem;font-weight:600;color:var(--text-secondary)}
.pv-li .pv-lv>svg{width:15px;height:15px;color:var(--text-muted)}
.pv-li>svg{color:var(--text-secondary)}
.pv-cap{padding:6px 16px 4px;font-size:.95rem;line-height:1.5;color:var(--text-primary)}
.pv-qb{display:flex;gap:4px;padding:0 10px}
.pv-qb button{min-height:44px;padding:0 8px;font-size:.84rem;font-weight:650;color:var(--text-secondary);display:inline-flex;align-items:center;gap:6px}
.pv-qb button svg{width:15px;height:15px}
/* sheet (Notes) */
#pvSheet{position:fixed;inset:0;z-index:9100;display:flex;flex-direction:column;justify-content:flex-end;background:rgba(0,0,0,.32);font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:var(--text-primary)}
.pv-sh{height:calc(100% - 28px);background:var(--pv-raise);border-radius:8px 8px 0 0;display:flex;flex-direction:column;overflow:hidden}
.pv-ptabs{display:flex;gap:0;padding:0 8px;border-bottom:1px solid var(--pv-hair);flex-shrink:0;overflow-x:auto;scrollbar-width:none}
.pv-ptabs button{height:44px;padding:0 10px;font-size:.84rem;font-weight:650;color:var(--text-secondary);white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
.pv-ptabs button[aria-pressed="true"]{color:var(--text-primary);box-shadow:inset 0 -2px 0 var(--text-primary)}
.pv-ptabs button em{font-style:normal;color:var(--text-muted);font-weight:600}
.pv-grp{padding:16px 16px 2px;font-size:.7rem;font-weight:750;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted)}
.pv-m{padding:10px 16px 2px;display:flex;flex-direction:column;gap:3px;position:relative}
.pv-m.rep{padding-left:30px}
.pv-m.rep::before{content:'';position:absolute;left:20px;top:6px;bottom:0;border-left:2px solid var(--pv-hair)}
.pv-mh{display:flex;align-items:center;gap:6px;font-size:.8rem;color:var(--text-muted);font-weight:550;min-width:0}
.pv-mh b{color:var(--text-primary);font-size:.86rem;font-weight:700}
.pv-mh svg{width:14px!important;height:14px!important}
.pv-k{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:var(--pv-r);color:var(--kc);box-shadow:inset 0 0 0 1.5px var(--kc)}
.pv-k.new{background:var(--kc);color:var(--pv-on);box-shadow:none}
.pv-mt2{font-size:.95rem;line-height:1.45;color:var(--text-primary);overflow-wrap:anywhere}
.pv-m.done .pv-mt2{color:var(--text-secondary)}
.pv-acts{display:flex;gap:2px;margin-left:-8px}
.pv-acts button{min-height:40px;padding:0 8px;font-size:.8rem;font-weight:700;color:var(--text-secondary);display:inline-flex;align-items:center;gap:5px}
.pv-acts button svg{width:14px!important;height:14px!important}
.pv-acts button.pri{color:var(--text-primary)}
.pv-done{display:inline-flex;align-items:center;gap:4px;color:var(--pv-ok);font-weight:700;font-size:.76rem}
.pv-done svg{width:13px!important;height:13px!important}
.pv-fold{display:flex;align-items:center;gap:8px;width:100%;min-height:44px;padding:0 16px 0 30px;font-size:.8rem;font-weight:650;color:var(--text-secondary)}
.pv-comp{flex-shrink:0;border-top:1px solid var(--pv-hair);padding:6px 10px calc(8px + env(safe-area-inset-bottom));background:var(--pv-raise)}
.pv-chips{display:flex;gap:6px;padding:2px 0 6px}
.pv-chip{height:36px;padding:0 8px 0 10px;border-radius:var(--pv-r);background:var(--pv-tint);display:inline-flex;align-items:center;gap:6px;font-size:.8rem;font-weight:650;color:var(--text-primary)}
.pv-chip svg{width:13px!important;height:13px!important;color:var(--text-secondary)}
.pv-chip i{width:7px;height:7px;border-radius:2px;background:var(--pc)}
.pv-in{display:flex;align-items:flex-end;gap:6px}
.pv-in .pv-ta{flex:1;min-height:44px;padding:11px 12px;border-radius:var(--pv-r2);background:var(--pv-tint);font-size:16px;color:var(--text-muted);line-height:1.35}
.pv-in .pv-send{width:44px;height:44px;border-radius:var(--pv-r);display:inline-flex;align-items:center;justify-content:center;background:var(--text-primary);color:var(--pv-page)}
/* messages */
.pv-ftabs{display:flex;gap:4px;padding:0 10px;border-bottom:1px solid var(--pv-hair);flex-shrink:0}
.pv-ftabs button{height:44px;padding:0 8px;font-size:.86rem;font-weight:650;color:var(--text-secondary);display:inline-flex;align-items:center;gap:6px}
.pv-ftabs button[aria-pressed="true"]{color:var(--text-primary);box-shadow:inset 0 -2px 0 var(--text-primary)}
.pv-ftabs .pv-b{height:20px}
.pv-conv{display:flex;gap:12px;width:100%;padding:10px 16px;text-align:left;position:relative;align-items:flex-start}
.pv-conv+.pv-conv::before{content:'';position:absolute;top:0;left:72px;right:0;border-top:1px solid var(--pv-hair)}
.pv-conv .pv-rm{gap:2px}
.pv-l1{display:flex;align-items:baseline;gap:8px}
.pv-l1 b{flex:1}
.pv-l1 time{font-size:.74rem;color:var(--text-muted);font-weight:600;flex-shrink:0}
.pv-cl{font-size:.76rem;color:var(--text-muted);font-weight:600}
.pv-l3{display:flex;align-items:center;gap:8px}
.pv-pre{flex:1;min-width:0;font-size:.86rem;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pv-conv.unread .pv-pre{color:var(--text-primary);font-weight:600}
.pv-day{text-align:center;font-size:.72rem;font-weight:700;color:var(--text-muted);padding:16px 0 4px}
.pv-new{display:flex;align-items:center;gap:8px;padding:14px 16px 0;font-size:.7rem;font-weight:800;color:var(--pv-change);text-transform:uppercase;letter-spacing:.06em}
.pv-new::after{content:'';flex:1;border-top:1px solid var(--pv-change)}
.pv-av{width:28px;height:28px;border-radius:var(--pv-r);display:inline-flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:800;background:var(--pv-tint);color:var(--ac,var(--text-secondary));flex-shrink:0}
.pv-cm{display:flex;gap:10px;padding:8px 16px 0}
.pv-cm.cont{padding-top:2px}
.pv-cm.cont .pv-av{visibility:hidden;height:0}
.pv-cm .pv-cb{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.pv-cm.internal .pv-mt2{color:var(--text-secondary)}
.pv-chg{display:flex;align-items:center;gap:10px;margin:8px 16px 0;padding:8px 6px 8px 10px;border-radius:var(--pv-r2);box-shadow:inset 3px 0 0 var(--pv-change);background:color-mix(in srgb,var(--pv-change) 7%,transparent);font-size:.84rem;color:var(--text-primary)}
.pv-chg>svg{color:var(--pv-change);width:16px!important;height:16px!important}
.pv-chg div{flex:1;min-width:0}
.pv-chg small{display:block;color:var(--text-secondary);font-size:.76rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pv-chg button{min-height:40px;padding:0 8px;font-weight:700;font-size:.8rem;color:var(--pv-change)!important;display:inline-flex;align-items:center;gap:2px}
.pv-chg button svg{width:14px!important;height:14px!important}
.pv-rto{display:flex;align-items:center;gap:6px;font-size:.78rem;color:var(--text-secondary);padding:2px 2px 6px;font-weight:550}
.pv-rto b{color:var(--text-primary);font-weight:700}
.pv-rto button{margin-left:auto;width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;color:var(--text-muted)}
`;
  function css() { if (!document.getElementById('pvCss')) { const s = document.createElement('style'); s.id = 'pvCss'; s.textContent = CSS; document.head.appendChild(s); } }
  const thumb = id => 'https://lh3.googleusercontent.com/d/mock_' + id + '=w320';
  const ST = {
    'Tweaks Needed': ['Tweaks needed', '--pv-change'], 'For SMM Approval': ['Ready for you', '--pv-amber'], 'Kasper Approval': ['With Kasper', '--pv-kasper'],
    'Client Approval': ['With client', '--pv-comment'], 'In Progress': ['In progress', '--text-muted'], 'Approved': ['Approved', '--pv-ok'],
    'Scheduled': ['Scheduled', '--pv-teal'], 'Posted': ['Posted', '--text-secondary'],
  };
  const ORDER = ['Tweaks Needed', 'For SMM Approval', 'Kasper Approval', 'Client Approval', 'In Progress', 'Approved', 'Scheduled', 'Posted'];
  const PARTS = [['video', 'Video'], ['graphic', 'Thumbnail'], ['caption', 'Caption']];
  function overall(p) {
    const s = PARTS.map(([c]) => p[c + '_status'] || 'In Progress');
    if (p.status === 'Posted') return 'Posted';
    return ORDER.find(o => s.includes(o)) || 'In Progress';
  }
  const stHtml = (s, cls) => { const st = ST[s] || [s, '--text-muted']; return '<span class="pv-st ' + (cls || '') + '" style="--pc:var(' + st[1] + ')"><i></i>' + esc(st[0]) + '</span>'; };
  const dShort = iso => { if (!iso) return 'No date'; const d = new Date(iso + 'T12:00:00Z'); return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }); };
  const ago = iso => { const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 60 ? m + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd'; };
  // The read state as the page loaded: the 'before' shots open Notes, which marks it read, so the 'after' shots use the stamps from load.
  let SEEN0 = null;
  const seenMap = () => { if (!SEEN0) { try { SEEN0 = JSON.parse(localStorage.getItem('syncview_notes_seen_v1') || '{}'); } catch (e) { SEEN0 = {}; } } return SEEN0; };

  /* ---- the notes model (Beacon's rules) ---- */
  function notes(p) {
    const out = [];
    for (const [c, label] of [['video', 'Video'], ['graphic', 'Thumbnail'], ['caption', 'Caption']]) for (const m of (p[c + '_comments'] || [])) out.push(Object.assign({ comp: c, compLabel: label }, m));
    return out.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  function kindOf(m) {
    if (m.role === 'client') return m.is_tweak ? 'change' : 'comment';
    if (m.role === 'kasper') return 'kasper';
    return m.author === ME ? 'mine' : 'staff';
  }
  function model(p) {
    const all = notes(p);
    const seen = seenMap()[p.id] || '';
    const floor = new Date(Date.now() - 14 * DAY).toISOString();
    const byRoot = {};
    all.forEach(m => { const r = m.parent_id || m.id; (byRoot[r] = byRoot[r] || []).push(m); });
    all.forEach(m => {
      m.kind = kindOf(m);
      const root = all.find(x => x.id === (m.parent_id || m.id)) || m;
      m.rootKind = kindOf(root);
      if (m.parent_id && m.role === 'client') m.kind = m.rootKind === 'change' ? 'change' : 'comment';
      m.isNew = m.kind !== 'mine' && m.created_at > seen && m.created_at > floor;
      if (!m.parent_id) {
        const rs = byRoot[m.id] || [];
        m.replies = rs.filter(x => x.id !== m.id);
        m.open = m.kind === 'change' && !m.done;
        m.waiting = m.kind === 'comment' && !m.done && !m.replies.some(x => x.role !== 'client');   // Beacon: a team reply answers it
      }
    });
    const roots = all.filter(m => !m.parent_id);
    const c = { newChange: all.filter(m => m.isNew && m.kind === 'change').length, open: roots.filter(m => m.open).length,
      newComment: all.filter(m => m.isNew && m.kind === 'comment').length, waiting: roots.filter(m => m.waiting).length,
      staff: all.filter(m => m.isNew && m.kind === 'staff').length, kasper: all.filter(m => m.isNew && m.kind === 'kasper').length };
    return { all, roots, c, seen };
  }
  const KC = { change: '--pv-change', comment: '--pv-comment', staff: '--pv-staff', kasper: '--pv-kasper', mine: '--pv-staff' };
  const badge = (kind, n, outline, icon) => '<span class="pv-b' + (outline ? ' o' : '') + '" style="--bc:var(' + KC[kind] + ')" title="">' + I[icon || kind] + n + '</span>';
  function badges(c, max) {
    const list = [];
    if (c.newChange) list.push(badge('change', c.newChange));
    else if (c.open) list.push(badge('change', c.open, true));
    if (c.newComment) list.push(badge('comment', c.newComment));
    else if (c.waiting) list.push(badge('comment', c.waiting, true, 'answer'));
    if (c.staff) list.push(badge('staff', c.staff));
    if (c.kasper) list.push(badge('kasper', c.kasper));
    const m = max || 3;
    return '<span class="pv-bs">' + list.slice(0, m).join('') + (list.length > m ? '<span class="pv-b more">+' + (list.length - m) + '</span>' : '') + '</span>';
  }

  function screen(html) {
    css();
    let s = document.getElementById('pvScreen');
    if (!s) { s = document.createElement('div'); s.id = 'pvScreen'; document.body.appendChild(s); }
    s.innerHTML = html; return s;
  }
  function msgCount() {
    const cs = (typeof _msgState !== 'undefined' && _msgState.conversations) || [];
    const n = cs.filter(c => c.unread > 0).length;
    return n ? '<span class="pv-cnt">' + n + '</span>' : '';
  }
  function topBar() {
    const client = (window.calState && calState.client) ? 'Sample Bakery' : 'Calendar';
    return '<div class="pv-top"><h1><button style="display:flex;align-items:center;gap:6px;min-height:44px" aria-label="Change client"><span>' + esc(client) + '</span>' + I.down + '</button></h1>'
      + '<button class="pv-ib" aria-label="New post">' + I.plus + '</button><button class="pv-ib" aria-label="Messages">' + I.comment + msgCount() + '</button>'
      + '<button class="pv-ib" aria-label="All tabs">' + I.menu + '</button></div>';
  }
  function bottomTabs(active) {
    const n = (calState.posts || []).filter(p => PARTS.some(([c]) => p[c + '_status'] === 'For SMM Approval')).length;
    const t = [['sheet', 'Sheet', I.grid], ['calendar', 'Calendar', I.cal], ['review', 'Review', I.review]];
    return '<nav class="pv-tabs">' + t.map(([k, l, ic]) => '<button' + (k === active ? ' aria-current="page"' : '') + '>' + ic + l + (k === 'review' && n ? '<span class="pv-cnt">' + n + '</span>' : '') + '</button>').join('') + '</nav>';
  }
  const posts = () => (calState.posts || []).slice().sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

  /* (a) Sheet */
  function sheet(mode) {
    const ps = posts();
    let body;
    if (mode === 'grid') {
      body = '<div class="pv-grid">' + ps.map(p => { const m = model(p); const s = ST[overall(p)] || ST['In Progress'];
        return '<button class="pv-tile" style="background-image:url(' + thumb(p.id) + ')" aria-label="' + esc(p.name) + '">' + badges(m.c, 1).replace('pv-bs', 'pv-bs') + '<span class="pv-tl" style="--pc:var(' + s[1] + ')"><i></i>' + esc(dShort(p.scheduled_date).replace(/^\w+ /, '')) + '</span></button>'; }).join('') + '</div>';
    } else {
      body = ps.map(p => { const m = model(p);
        return '<button class="pv-row"><span class="pv-th" style="background-image:url(' + thumb(p.id) + ')"></span><span class="pv-rm"><b>' + esc(p.name) + '</b><span class="pv-meta">' + stHtml(overall(p)) + '<span class="pv-dt">· ' + esc(dShort(p.scheduled_date)) + '</span></span></span>' + badges(m.c) + '</button>'; }).join('');
    }
    screen(topBar() + '<div class="pv-bar"><span>' + ps.length + ' posts</span><div class="pv-seg"><button aria-pressed="' + (mode !== 'grid') + '" aria-label="List">' + I.list + '</button><button aria-pressed="' + (mode === 'grid') + '" aria-label="Grid">' + I.grid + '</button></div></div>'
      + '<div class="pv-body">' + body + '<div style="height:16px"></div></div>' + bottomTabs('sheet'));
  }

  /* (a2) one post, opened from the Sheet */
  function detail(pid) {
    const p = calState.posts.find(x => x.id === pid); const m = model(p);
    const parts = PARTS.map(([c, l]) => '<button class="pv-li"><span>' + l + '</span><span class="pv-lv">' + stHtml(p[c + '_status'] || 'In Progress') + I.chev + '</span></button>').join('');
    screen('<div class="pv-top sub"><button class="pv-ib" aria-label="Back">' + I.back + '</button><div class="pv-tt"><b>' + esc(p.name) + '</b><small>' + esc(dShort(p.scheduled_date)) + ' · Instagram</small></div><button class="pv-ib" aria-label="More">' + I.more + '</button></div>'
      + '<div class="pv-body">'
      + '<div class="pv-media"><div class="pv-mt"><button class="pv-mi" style="background-image:url(' + thumb(p.id) + ')" aria-label="Play the video">' + I.play + '</button><span>Video' + I.open + '</span></div>'
      + '<div class="pv-mt"><button class="pv-mi" style="background-image:url(' + thumb(p.id) + ');filter:saturate(1.3)" aria-label="Open the thumbnail"></button><span>Thumbnail' + I.open + '</span></div></div>'
      + '<button class="pv-li" style="margin-top:8px">' + I.comment + '<span>Notes</span><span class="pv-lv">' + badges(m.c) + I.chev + '</span></button>'
      + '<div class="pv-h"><span>Status</span><button>Set all</button></div>' + parts
      + '<div class="pv-h"><span>Date</span></div><button class="pv-li">' + I.cal + '<span>' + esc(dShort(p.scheduled_date)) + ' 2026</span><span class="pv-lv">' + I.chev + '</span></button>'
      + '<div class="pv-h"><span>Caption</span><button>Edit</button></div><div class="pv-cap">' + esc(p.caption) + '</div>'
      + '<div class="pv-qb"><button>' + I.plus + 'Alt caption</button><button>' + I.plus + 'Call to action</button></div>'
      + '<div class="pv-h"><span>Files</span></div><button class="pv-li">' + I.folder + '<span>Raw footage</span><span class="pv-lv">' + I.open + '</span></button><button class="pv-li">' + I.folder + '<span>Thumbnail folder</span><span class="pv-lv">' + I.open + '</span></button>'
      + '<div style="height:24px"></div></div>');
  }

  /* (b) Notes on a card */
  function noteHtml(m, isReply) {
    const k = m.kind === 'mine' ? 'staff' : m.kind;
    const icon = m.kind === 'change' ? 'change' : m.kind === 'comment' ? (m.waiting && !m.isNew ? 'answer' : 'comment') : m.kind === 'kasper' ? 'kasper' : 'staff';
    const kindBox = '<span class="pv-k' + (m.isNew ? ' new' : '') + '" style="--kc:var(' + KC[k] + ')">' + I[icon] + '</span>';
    const team = m.audience === 'internal' ? '<span style="display:inline-flex;align-items:center;gap:3px" title="Only the team sees this">' + I.lock + 'Team</span>' : '';
    const acts = [];
    acts.push('<button class="pri">' + I.answer + 'Reply</button>');
    if (!isReply && m.kind === 'change' && !m.done) acts.push('<button>' + I.check + 'Mark done</button>');
    if (!isReply && m.waiting) acts.push('<button>No reply needed</button>');
    return '<div class="pv-m' + (isReply ? ' rep' : '') + (m.done ? ' done' : '') + '"><div class="pv-mh">' + (isReply ? '' : kindBox) + '<b>' + esc(m.author === ME ? 'You' : m.author) + '</b>'
      + (isReply ? '' : '<span>' + m.compLabel + '</span>') + '<span>' + ago(m.created_at) + '</span>' + team + (m.done ? '<span class="pv-done">' + I.check + 'Done</span>' : '') + '</div>'
      + '<div class="pv-mt2">' + esc(m.body) + '</div>' + (isReply ? '' : '<div class="pv-acts">' + acts.join('') + '</div>') + '</div>';
  }
  function threadHtml(r, opts) {
    let h = noteHtml(r, false);
    const reps = r.replies || [];
    if (reps.length > 2 && !(opts && opts.full)) h += '<button class="pv-fold">' + reps.length + ' replies, latest ' + ago(reps[reps.length - 1].created_at) + ' ago</button>';
    else h += reps.map(x => noteHtml(x, true)).join('');
    return h;
  }
  function notesSheet(pid, filter) {
    css();
    const p = calState.posts.find(x => x.id === pid); const md = model(p);
    const roots = md.roots.filter(r => !filter || r.comp === filter);
    const needs = roots.filter(r => r.open || r.waiting || r.isNew || (r.replies || []).some(x => x.isNew));
    const rest = roots.filter(r => !needs.includes(r));
    const count = c => md.roots.filter(r => !c || r.comp === c).length;
    const tabs = [['', 'All'], ['video', 'Video'], ['graphic', 'Thumbnail'], ['caption', 'Caption']].filter(([c]) => !c || count(c)).map(([c, l]) => '<button aria-pressed="' + ((filter || '') === c) + '">' + l + ' <em>' + count(c) + '</em></button>').join('');
    let s = document.getElementById('pvSheet');
    if (!s) { s = document.createElement('div'); s.id = 'pvSheet'; document.body.appendChild(s); }
    s.innerHTML = '<div class="pv-sh"><div class="pv-top" style="padding-left:16px"><div class="pv-tt"><b>Notes</b><small>' + esc(p.name) + '</small></div><button class="pv-ib" aria-label="Close">' + I.x + '</button></div>'
      + '<div class="pv-ptabs">' + tabs + '</div>'
      + '<div class="pv-body" style="padding-bottom:12px">'
      + (needs.length ? '<div class="pv-grp">Needs you</div>' + needs.slice().reverse().map(r => threadHtml(r)).join('') : '')
      + (rest.length ? '<div class="pv-grp">Earlier</div>' + rest.slice().reverse().map(r => threadHtml(r)).join('') : '')
      + '</div>'
      + '<div class="pv-comp"><div class="pv-chips"><button class="pv-chip">Video' + I.down + '</button><button class="pv-chip">' + I.lock + 'Team only' + I.down + '</button><button class="pv-chip">' + I.comment + 'Comment' + I.down + '</button></div>'
      + '<div class="pv-in"><div class="pv-ta">Write a note…</div><button class="pv-send" aria-label="Send">' + I.send + '</button></div></div></div>';
  }

  /* (c) Messages */
  function convBadges(c) {
    const p = calState.posts.find(x => x.id === c.post_id);
    if (!p) return '';
    const md = model(p); const cc = md.c;
    // Messages never counts change requests (Beacon D2).
    return badges({ newChange: 0, open: 0, newComment: cc.newComment, waiting: cc.waiting, staff: cc.staff, kasper: cc.kasper }, 2);
  }
  function inbox(filter) {
    const cs = (_msgState.conversations || []).slice();
    const isNew = c => c.unread > 0;
    const waits = c => { const p = calState.posts.find(x => x.id === c.post_id); return p && model(p).c.waiting > 0; };
    const nNew = cs.filter(isNew).length, nAns = cs.filter(waits).length;
    const shown = cs.filter(c => filter === 'all' ? true : filter === 'answer' ? waits(c) : isNew(c));
    const tab = (k, l, n, b) => '<button aria-pressed="' + (filter === k) + '">' + l + (n ? b : '') + '</button>';
    const rows = shown.map(c => {
      const last = c.last_role === 'client' ? 'Client' : (c.last_author === ME ? 'You' : String(c.last_author || '').split(' ')[0]);
      return '<button class="pv-conv' + (isNew(c) ? ' unread' : '') + '"><span class="pv-th" style="width:40px;height:52px;background-image:url(' + thumb(c.post_id) + ')"></span><span class="pv-rm"><span class="pv-l1"><b>' + esc(c.title) + '</b><time>' + ago(c.last_at) + '</time></span>'
        + '<span class="pv-cl">' + esc(c.client_name) + '</span><span class="pv-l3"><span class="pv-pre">' + esc(last) + ': ' + esc(c.last_body) + '</span>' + convBadges(c) + '</span></span></button>';
    }).join('') || '<div style="padding:40px 16px;text-align:center;color:var(--text-secondary);font-size:.9rem">Nothing new. You are up to date.</div>';
    screen('<div class="pv-top" style="padding-left:4px"><button class="pv-ib" aria-label="Back">' + I.back + '</button><h1>Messages</h1><button class="pv-ib" aria-label="Search">' + I.search + '</button></div>'
      + '<div class="pv-ftabs">' + tab('new', 'New', nNew, '<span class="pv-b" style="--bc:var(--pv-comment)">' + I.comment + nNew + '</span>')
      + tab('answer', 'To answer', nAns, '<span class="pv-b o" style="--bc:var(--pv-comment)">' + I.answer + nAns + '</span>') + tab('all', 'All', 0, '') + '</div>'
      + '<div class="pv-body">' + rows + '</div>');
  }
  function chat(pid) {
    const p = calState.posts.find(x => x.id === pid); const md = model(p);
    const conv = (_msgState.conversations || []).find(c => c.post_id === pid) || { client_name: 'Sample Bakery' };
    let h = ''; let lastDay = ''; let lastAuthor = ''; let newShown = false;
    const AC = { client: '--pv-comment', kasper: '--pv-kasper' };
    const flat = md.all;
    for (const m of flat) {
      const day = new Date(m.created_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      if (day !== lastDay) { h += '<div class="pv-day">' + day + '</div>'; lastDay = day; lastAuthor = ''; }
      if (m.isNew && !newShown) { h += '<div class="pv-new">New</div>'; newShown = true; lastAuthor = ''; }
      const root = m.parent_id ? flat.find(x => x.id === m.parent_id) : m;
      if (!m.parent_id && m.kind === 'change') {   // a change request lives on the card: one line here
        h += '<div class="pv-chg">' + I.change + '<div><b style="font-weight:700">Change asked</b> · ' + m.compLabel + (m.done ? ' · <span class="pv-done" style="display:inline-flex">' + I.check + 'Done</span>' : '') + '<small>' + esc(m.body) + '</small></div><button>Card' + I.chev + '</button></div>';
        lastAuthor = ''; continue;
      }
      if (m.parent_id && root && root.kind === 'change') continue;   // its replies are on the card too
      const who = m.author === ME ? 'You' : m.author;
      const cont = who === lastAuthor;
      lastAuthor = who;
      const ini = who.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      const team = m.audience === 'internal' ? '<span style="display:inline-flex;align-items:center;gap:3px">' + I.lock + 'Team only</span>' : '';
      const wait = (!m.parent_id && m.waiting) ? '<span class="pv-k" style="--kc:var(--pv-comment);width:18px;height:18px" title="Waiting for an answer">' + I.answer + '</span>' : '';
      const acts = (!m.parent_id && m.waiting) ? '<div class="pv-acts"><button class="pri">' + I.answer + 'Reply</button><button>No reply needed</button></div>' : '';
      h += '<div class="pv-cm' + (cont ? ' cont' : '') + (m.audience === 'internal' ? ' internal' : '') + '"><span class="pv-av" style="--ac:var(' + (AC[m.role] || '--text-secondary') + ')">' + ini + '</span><div class="pv-cb">'
        + (cont ? '' : '<div class="pv-mh"><b>' + esc(who) + '</b>' + wait + '<span>' + m.compLabel + '</span><span>' + ago(m.created_at) + '</span>' + team + '</div>')
        + '<div class="pv-mt2">' + esc(m.body) + '</div>' + acts + '</div></div>';
    }
    screen('<div class="pv-top sub"><button class="pv-ib" aria-label="Back">' + I.back + '</button><div class="pv-tt"><b>' + esc(p.name) + '</b><small>' + esc(conv.client_name) + '</small></div><button class="pv-tb">Open card</button><button class="pv-ib" aria-label="Mark unread">' + I.more + '</button></div>'
      + '<div class="pv-body" id="pvChatBody" style="padding-bottom:12px">' + h + '</div>'
      + '<div class="pv-comp"><div class="pv-rto">' + I.answer + 'Reply to <b>Sample Client</b> · Caption<button aria-label="Cancel reply">' + I.x + '</button></div>'
      + '<div class="pv-in"><div class="pv-ta">Reply…</div><button class="pv-send" aria-label="Send">' + I.send + '</button></div></div>');
    const b = document.getElementById('pvChatBody'); b.scrollTop = b.scrollHeight;
  }

  /* (d) the client's review page: the real page, restyled inside its shadow root */
  const RS = `
.app{padding-left:16px;padding-right:16px;padding-block:8px 96px;gap:8px}
.hdr{gap:2px!important}
.hdr-who{align-items:center;justify-content:space-between;width:100%}
.hdr-who h1{font-size:1.15rem!important;letter-spacing:-.01em}
.hdr .sub{display:none}
.hdr-r{gap:0!important;border-bottom:1px solid var(--border-light);width:100%!important;min-width:0}
.tabs{background:transparent!important;border-radius:0!important;padding:0!important;flex:1;gap:0;min-width:0;overflow:hidden}
.tabs .cal-view-btn{border-radius:0!important;background:transparent!important;box-shadow:none!important;min-height:44px;padding:0 8px!important;font-size:.86rem;color:var(--text-secondary)}
.tabs .cal-view-btn.active{color:var(--text-primary)!important;box-shadow:inset 0 -2px 0 var(--text-primary)!important}
.cal-view-btn .badge{border-radius:3px!important;min-width:17px;height:17px;font-size:.64rem}
.theme-btn{border-radius:4px!important;background:transparent!important;width:44px!important;height:44px!important}
.strip{gap:4px!important;margin-top:4px}
.sk-head .num{font-size:.7rem!important;font-weight:750!important;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted)!important}
.sk-list{gap:6px!important}
.chipp{width:auto!important;max-width:210px;height:48px!important;border-radius:6px!important;box-shadow:inset 0 0 0 1px var(--border-light)!important;background:transparent!important;padding:4px 12px 4px 4px!important}
.chipp.cur{box-shadow:inset 0 0 0 1.5px var(--text-primary)!important}
.chipp .si{height:40px!important;width:22px!important;border-radius:3px!important}
.chipp .cd i{border-radius:2px!important}
.side{padding:0!important;gap:0!important}
.sd-t h2{font-size:1.2rem!important;letter-spacing:-.01em}
.card{background:transparent!important;border:0!important;box-shadow:none!important;padding:0!important;gap:10px!important;border-radius:0!important}
.sdate{font-size:.8rem!important;color:var(--text-secondary)!important;margin-top:-6px;padding:0!important}
.sdate svg{display:none}
.stepper{display:grid!important;grid-template-columns:repeat(3,1fr);gap:0!important;border-bottom:1px solid var(--border-light);margin:0!important}
.stepper .ln{display:none!important}
.stepper li{display:flex}
.stp{width:100%;justify-content:center;height:44px!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;padding:0 4px!important;gap:6px!important;font-size:.84rem!important}
.stp[aria-current="step"]{color:var(--text-primary)!important;box-shadow:inset 0 -2px 0 var(--text-primary)!important}
.stp .sd{width:16px!important;height:16px!important;border-radius:3px!important;font-size:.6rem!important}
.tcard{border-radius:6px!important;box-shadow:none!important;background:transparent!important;padding:4px 0 0!important;width:100%!important}
.tc-lbl{display:none!important}
.tc-text{font-size:1rem!important;line-height:1.55!important}
.tc-foot{display:none!important}
.b-edit{border-radius:4px!important;box-shadow:none!important;background:transparent!important;padding:0 2px!important;min-height:44px;color:var(--text-secondary)!important}
.player,.bigthumb{border-radius:6px!important}
.mpill{border-radius:3px!important}
.drow{position:fixed;left:0;right:0;bottom:0;box-sizing:border-box;width:auto!important;z-index:30;background:var(--white)!important;border-top:1px solid var(--border-light);padding:10px 16px calc(10px + env(safe-area-inset-bottom));gap:8px!important}
.dec{flex-direction:row-reverse!important;flex-wrap:nowrap!important;gap:8px!important;width:100%}
.dwrap{width:100%}
.b-ok,.b-ask{flex:1;justify-content:center;height:48px!important;border-radius:4px!important;font-size:.9rem!important;padding:0 10px!important}
.b-ask{box-shadow:inset 0 0 0 1px var(--border)!important;color:var(--text-primary)!important;background:transparent!important}
.drow2{padding-top:0!important;border-top:0!important}
.finish{height:40px!important;border-radius:4px!important;box-shadow:none!important;font-size:.8rem!important}
.chat{border-radius:0!important;box-shadow:none!important;border:0!important;background:transparent!important;margin-top:8px}
.ch-head{padding:14px 0 8px!important}
.bub.you .bb{background:var(--pv-tint,color-mix(in srgb,var(--text-primary) 5%,transparent))!important;box-shadow:none!important}
.bub.you.is-chg .bb{box-shadow:inset -3px 0 0 var(--cmp-chg-line)!important}
.bub.team .bb{box-shadow:inset 0 0 0 1px var(--border-light)!important;background:transparent!important}
.bfoot{display:none!important}
.bub .av{border-radius:4px!important}
.ch-head{border-bottom:1px solid var(--border-light)!important}
.ch-head .avs{display:none}
.bb{border-radius:6px!important}
.bh .kchg,.bh .tag{border-radius:3px!important}
.cbox{border-radius:6px!important}
.pchip,.fold,.btn-quiet{border-radius:4px!important}
`;
  function review() {
    const host = document.getElementById('svReviewStage');
    const root = host && host.shadowRoot;
    if (!root) return false;
    if (!root.getElementById('pvRs')) { const s = document.createElement('style'); s.id = 'pvRs'; s.textContent = RS; root.appendChild(s); }
    // "Finish reviewing" joins the bottom bar only when it can be used; until then the bar is the two answers.
    const fin = root.getElementById('finishBtn'); if (fin && fin.disabled) fin.closest('.drow2').style.display = 'none';
    return true;
  }

  seenMap();
  window.svPhonePreview = { sheet, detail, notes: notesSheet, inbox, chat, review,
    close() { ['pvScreen', 'pvSheet'].forEach(id => { const e = document.getElementById(id); if (e) e.remove(); }); } };
})();
