/* Unread badges preview (session Beacon, 2026-10-23). LOCAL ONLY: loaded into the real page by make-screenshots.js,
   never by the app. It swaps a few of today's renderers for the proposed design so the screenshots show the real
   Calendar card, Notes panel, Messages button, list and chat. Nothing here writes anywhere: "No reply needed" and
   "Mark unread" only change this page's memory. The real build computes the same states on the server. */
(function () {
  'use strict';
  if (window.svUnreadPreview) return;

  /* ---------- the rules (the proposal, in one place) ---------- */
  const AUTO_ROLES = new Set(['system', 'automatic', 'auto', 'bot']);
  const CAPTION_RECORD = /^Changed the caption to:\r?\n\r?\n[\s\S]*\r?\n\r?\nIt was(?: empty\.|:\r?\n\r?\n)/;
  const noReply = new Set();     // comments marked "No reply needed" on this page
  const markedUnread = new Set(); // cards put back to unread on this page
  const role = m => String(m && m.role || '').toLowerCase();
  const isClient = m => role(m) === 'client';
  const isAuto = m => AUTO_ROLES.has(role(m)) || (isClient(m) && CAPTION_RECORD.test(String(m.body || '')));
  const isMine = m => {
    try {
      const id = String(m.author_member_id || '');
      if (id) return id === _msgMyId();
      if (isClient(m)) return false;
      return String(m.author || '').trim().toLowerCase() === String(_msgMe() || '').trim().toLowerCase();
    } catch (e) { return false; }
  };
  const isTweak = m => m && m.is_tweak !== false;
  const COMPS = ['video', 'graphic', 'caption', 'title'];
  const LABEL = c => (typeof COMP_LABELS !== 'undefined' && COMP_LABELS[c]) || c;

  // Every note on a card, with its thread root and part, oldest first.
  function notesOf(post) {
    const out = [];
    for (const comp of COMPS) {
      let list = [];
      try { list = _calCommentsForView(post, comp) || []; } catch (e) { list = []; }
      const byId = new Map(list.map(m => [m.id, m]));
      for (const m of list) {
        if (!m || m.deleted || m.hidden) continue;
        const root = m.parent_id ? (byId.get(m.root_id || m.parent_id) || byId.get(m.parent_id) || m) : m;
        out.push({ m, root, comp });
      }
    }
    return out.sort((a, b) => String(a.m.created_at).localeCompare(String(b.m.created_at)));
  }
  function kindOf(n) {
    if (isClient(n.m)) return isTweak(n.root) && !n.root.parent_id && isClient(n.root) ? 'change' : 'comment';
    return role(n.m) === 'kasper' ? 'kasper' : 'staff';
  }
  // The state of one card for the signed-in person. `seen` is when they last opened its Notes.
  function stateOf(post, seenOverride) {
    const seen = seenOverride != null ? seenOverride : (markedUnread.has(post.id) ? '' : (_notesGetSeen(post.id) || ''));
    const notes = notesOf(post);
    const s = { change: 0, comment: 0, staff: 0, kasper: 0, open: 0, waiting: 0, items: [], newIds: new Set(), waitingIds: new Set(), openIds: new Set() };
    for (const n of notes) {
      if (isMine(n.m) || isAuto(n.m)) continue;
      if (String(n.m.created_at) > seen) { const k = kindOf(n); s[k]++; s.newIds.add(n.m.id); s.items.push({ kind: k, n }); }
    }
    const roots = notes.filter(n => n.m === n.root);
    for (const r of roots) {
      if (isAuto(r.m)) continue;
      if (isTweak(r.m) && !r.m.done) { s.openIds.add(r.m.id); if (!s.newIds.has(r.m.id)) s.open++; }
      if (isClient(r.m) && !isTweak(r.m) && !r.m.done && !noReply.has(r.m.id)) {
        const answered = notes.some(n => n.root === r.m && n.m !== r.m && !isClient(n.m) && !isAuto(n.m));
        if (!answered) { s.waitingIds.add(r.m.id); if (!s.newIds.has(r.m.id)) { s.waiting++; s.items.push({ kind: 'waiting', n: r }); } }
      }
    }
    s.items.sort((a, b) => String(b.n.m.created_at).localeCompare(String(a.n.m.created_at)));
    return s;
  }

  /* ---------- the badge words ---------- */
  const ICO = {
    change: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 2.5l3 3L6 13H3v-3z"/></svg>',
    comment: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M2.5 3.5h11a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H7l-3 2.5V12H2.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/></svg>',
    waiting: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4L2.5 7.5 6 11 M2.5 7.5H10a3.5 3.5 0 0 1 3.5 3.5v1"/></svg>',
    staff: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="8" cy="5.3" r="2.5"/><path stroke-linecap="round" d="M3.2 13.2c.35-2.35 2.1-3.7 4.8-3.7s4.45 1.35 4.8 3.7"/></svg>',
    kasper: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"/><circle cx="8" cy="8" r="2.2"/></svg>',
  };
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const WORDS = {
    change: n => plural(n, 'new change', 'new changes'),
    open: n => plural(n, 'change open', 'changes open'),
    comment: n => plural(n, 'new comment', 'new comments'),
    waiting: n => n + ' to answer',
    staff: n => n + ' from team',
    kasper: n => n + ' from Kasper',
  };
  const chip = (kind, n, extra) => `<span class="svu-chip svu-${kind}${extra || ''}">${ICO[kind === 'open' ? 'change' : kind]}${WORDS[kind](n)}</span>`;
  function chipsFor(s, max) {
    const order = [['change', s.change], ['open', s.open], ['comment', s.comment], ['waiting', s.waiting], ['staff', s.staff], ['kasper', s.kasper]].filter(x => x[1] > 0);
    const shown = order.slice(0, max).map(([k, n]) => chip(k, n));
    if (order.length > max) shown.push(`<span class="svu-chip svu-more">+${order.length - max} more</span>`);
    return shown.join('');
  }

  /* ---------- Calendar card: the Notes button ---------- */
  const NOTES_ICO = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.5h11a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H7l-3 2.5V12H2.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/></svg>';
  function notesBtnHtml(post, pid) {
    const s = stateOf(post);
    const any = s.change + s.comment + s.staff + s.kasper > 0;
    const chips = chipsFor(s, 3);
    return `<span class="cal-foot-tweaks svu-foot" data-comments-wrap="${pid}"><button type="button" class="cal-comments-btn svu-notes${any ? ' svu-has-new' : ''}" data-comments-btn="${pid}" onclick="openCalComments('${pid}')" onpointerenter="svUnreadPreview.hoverCard('${pid}', this)" onpointerleave="svUnreadPreview.hideHover()" aria-label="Notes">${NOTES_ICO}<span class="cal-comments-label">Notes</span></button>${chips ? `<span class="svu-chips" onclick="openCalComments('${pid}')">${chips}</span>` : ''}</span>`;
  }

  /* ---------- the hover card ---------- */
  const WHO = m => isClient(m) ? 'Client' : (role(m) === 'kasper' ? 'Kasper' : String(m.author || 'Team').split(' ')[0]);
  const KIND_LINE = { change: 'New change', comment: 'New comment', waiting: 'Waiting for your answer', staff: 'From the team', kasper: 'From Kasper' };
  function hoverHtml(post) {
    const s = stateOf(post);
    const items = s.items.slice(0, 4).map(({ kind, n }) => `<div class="svu-pv-item"><span class="svu-pv-dot svu-${kind}">${ICO[kind]}</span><div class="svu-pv-main"><div class="svu-pv-top"><b>${_calEsc(KIND_LINE[kind])}</b><span>${_calEsc(WHO(n.m))} · ${_calEsc(LABEL(n.comp))}</span><span class="svu-pv-time">${_calEsc(_calFmtCommentTime(n.m.created_at))}</span></div><div class="svu-pv-text">${_calEsc(n.m.body || '')}</div></div></div>`).join('');
    const foot = s.open ? `<span>Also <b>${plural(s.open, 'change', 'changes')}</b> still open</span>` : '<span></span>';
    return `<div class="svu-pv-head">${_calEsc(post.name || 'Post')}</div>${items || '<div class="svu-pv-empty">Nothing new</div>'}<div class="svu-pv-foot">${foot}<span class="svu-pv-open">Click to open Notes</span></div>`;
  }
  let hoverEl = null;
  function hoverCard(pid, anchor) {
    const post = calState.posts.find(p => p.id === pid);
    if (!post) return;
    hideHover();
    hoverEl = document.createElement('div');
    hoverEl.className = 'svu-pv';
    hoverEl.setAttribute('role', 'tooltip');
    hoverEl.innerHTML = hoverHtml(post);
    document.body.appendChild(hoverEl);
    const r = anchor.getBoundingClientRect();
    const w = Math.min(360, innerWidth - 24);
    hoverEl.style.width = w + 'px';
    hoverEl.style.left = Math.max(12, Math.min(r.left, innerWidth - w - 12)) + 'px';
    const h = hoverEl.offsetHeight;
    hoverEl.style.top = (r.top - h - 8 > 8 ? r.top - h - 8 : r.bottom + 8) + 'px';
  }
  function hideHover() { if (hoverEl) { hoverEl.remove(); hoverEl = null; } }

  /* ---------- Calendar summary line ---------- */
  let stripFilter = '';
  function stripHtml() {
    const t = { change: 0, comment: 0, waiting: 0, open: 0 };
    for (const p of calState.posts || []) { const s = stateOf(p); t.change += s.change; t.comment += s.comment; t.waiting += s.waiting + 0; t.open += s.open + s.change; }
    const b = (k, n, words) => n ? `<button type="button" class="svu-strip-btn${stripFilter === k ? ' is-on' : ''}" onclick="svUnreadPreview.filter('${k}')"><span class="svu-chip svu-${k}">${ICO[k === 'open' ? 'change' : k]}${n}</span>${words}</button>` : '';
    const parts = [b('change', t.change, t.change === 1 ? 'new change' : 'new changes'), b('comment', t.comment, t.comment === 1 ? 'new comment' : 'new comments'),
      b('waiting', t.waiting, 'to answer'), b('open', t.open, t.open === 1 ? 'change not done yet' : 'changes not done yet')].filter(Boolean).join('');
    return `<span class="svu-strip-label">Waiting for you</span>${parts || '<span class="svu-strip-calm">Nothing new</span>'}${stripFilter ? '<button type="button" class="svu-strip-clear" onclick="svUnreadPreview.filter(\'\')">Show all posts</button>' : ''}`;
  }
  function placeStrip() {
    const bar = document.querySelector('#calView .cal-toolbar') || document.querySelector('#calView .thumb-collection-bar')?.previousElementSibling;
    if (!bar) return;
    let el = document.querySelector('.svu-strip');
    if (!el) { el = document.createElement('div'); el.className = 'svu-strip'; }
    if (el.previousElementSibling !== bar) bar.after(el);
    const html = stripHtml();
    if (el.innerHTML !== html) el.innerHTML = html;
    applyFilter();
  }
  function filter(k) { stripFilter = stripFilter === k ? '' : k; placeStrip(); }
  function applyFilter() {
    document.querySelectorAll('#calView .cal-card[data-pid]').forEach(card => {
      const post = calState.posts.find(p => p.id === card.getAttribute('data-pid'));
      const s = post ? stateOf(post) : null;
      const hit = !stripFilter || (s && (stripFilter === 'open' ? (s.open + s.change) > 0 : s[stripFilter] > 0));
      card.classList.toggle('svu-dim', !hit);
    });
  }

  /* ---------- Phone grid tiles: small, so colour + icon + number; the long-press card says it in words ---------- */
  function decorateTiles() {
    document.querySelectorAll('.thumb-grid-card[data-pid]').forEach(card => {
      const post = calState.posts.find(p => p.id === card.getAttribute('data-pid'));
      const info = card.querySelector('.thumb-tile-info');
      if (!post || !info) return;
      const s = stateOf(post);
      const mini = (k, n) => n ? `<span class="svu-chip svu-${k} svu-mini">${ICO[k === 'open' ? 'change' : k]}${n}</span>` : '';
      const html = [mini('change', s.change), mini('comment', s.comment), mini('waiting', s.waiting), mini('open', s.open), mini('staff', s.staff), mini('kasper', s.kasper)].filter(Boolean).slice(0, 3).join('');
      let row = info.querySelector('.svu-tile-chips');
      if (!row && html) { row = document.createElement('span'); row.className = 'svu-tile-chips'; info.prepend(row); }
      if (row && row.innerHTML !== html) row.innerHTML = html;
      if (row) row.hidden = !html;
    });
  }

  /* ---------- Notes panel ---------- */
  let notesSnap = null; // the state just before Notes opened (opening clears "new")
  function decorateNotes() {
    const modal = document.getElementById('calCommentsModal');
    if (!modal || !notesSnap) return;
    const post = calState.posts.find(p => p.id === notesSnap.pid);
    if (!post) return;
    const live = stateOf(post, notesSnap.seen);
    const feed = modal.querySelector('.cal-cm-thread') && modal.querySelector('.cal-cm-thread').parentElement;
    if (!feed) return;
    // The bar at the top: what still needs you, with the card-level action.
    const need = [];
    if (live.change) need.push(chip('change', live.change));
    const openRead = live.openIds.size - live.change;
    if (openRead > 0) need.push(chip('open', openRead));
    if (live.comment) need.push(chip('comment', live.comment));
    const wait = [...live.waitingIds].filter(id => !live.newIds.has(id)).length;
    if (wait) need.push(chip('waiting', wait));
    if (live.staff) need.push(chip('staff', live.staff));
    if (live.kasper) need.push(chip('kasper', live.kasper));
    let bar = modal.querySelector('.svu-need');
    const barHtml = `<div class="svu-need-row"><b>Needs you</b>${need.join('') || '<span class="svu-need-calm">Nothing. All caught up.</span>'}</div><button type="button" class="cal-cm-action svu-act" onclick="svUnreadPreview.markUnread('${post.id}')">${ICO.comment}<span>Mark unread</span></button>`;
    if (!bar) { bar = document.createElement('div'); bar.className = 'svu-need'; feed.prepend(bar); }
    if (bar.innerHTML !== barHtml) bar.innerHTML = barHtml;
    // Each thread: what it is, in words, and its actions on the row itself.
    feed.querySelectorAll('.cal-cm-thread[data-thread]').forEach(th => {
      const id = th.getAttribute('data-thread');
      const row = th.querySelector(`.cal-cm-row[data-cm-row="${CSS.escape(id)}"]`);
      if (!row) return;
      const n = notesOf(post).find(x => x.m.id === id);
      if (!n) return;
      const k = kindOf(n);
      const tags = [];
      if (live.newIds.has(id)) tags.push(`<span class="svu-tag svu-${k}">${k === 'comment' ? 'New comment' : k === 'kasper' ? 'New from Kasper' : 'New'}</span>`);
      else if (k === 'comment' && isClient(n.m)) tags.push('<span class="svu-tag svu-plain">Comment</span>');
      if (live.waitingIds.has(id)) tags.push('<span class="svu-tag svu-waiting-o">Waiting for your answer</span>');
      if (live.openIds.has(id) && !live.newIds.has(id)) tags.push('<span class="svu-tag svu-open-o">Not done yet</span>');
      if (noReply.has(id)) tags.push('<span class="svu-tag svu-plain">No reply needed</span>');
      const html = tags.join('');
      const head = row.querySelector('.cal-cm-head-line');
      let holder = row.querySelector('.svu-tags');
      if (!holder && head) { holder = document.createElement('div'); holder.className = 'svu-tags'; head.after(holder); }
      if (holder && holder.innerHTML !== html) holder.innerHTML = html;
      if (holder) holder.hidden = !html;
      th.classList.toggle('svu-th-waiting', live.waitingIds.has(id));
      th.classList.toggle('svu-th-new', live.newIds.has(id));
      // The actions that matter now, always on screen under the text (not only on hover).
      const want = live.waitingIds.has(id)
        ? `<button type="button" class="svu-btn svu-primary" onclick="_calBeginReply(${JSON.stringify(id).replace(/"/g, '&quot;')})">${ICO.waiting}Reply</button><button type="button" class="svu-btn" onclick="svUnreadPreview.noReply('${id}')">No reply needed</button>`
        : (live.openIds.has(id) ? `<button type="button" class="svu-btn" onclick="_calBeginReply(${JSON.stringify(id).replace(/"/g, '&quot;')})">${ICO.waiting}Reply</button><button type="button" class="svu-btn" onclick="_calToggleCommentDone(${JSON.stringify(id).replace(/"/g, '&quot;')})">Mark done</button>` : '');
      let actRow = row.querySelector('.svu-row-acts');
      const body = row.querySelector('.cal-cm-row-body');
      if (!actRow && body && want) { actRow = document.createElement('div'); actRow.className = 'svu-row-acts'; body.after(actRow); }
      if (actRow && actRow.innerHTML !== want) actRow.innerHTML = want;
      if (actRow) actRow.hidden = !want;
    });
  }

  /* ---------- Messages ---------- */
  // A conversation's state, from its messages and the person's read mark (the mock sends `last_read_at`).
  function convState(c) {
    const s = { comment: 0, staff: 0, kasper: 0, waiting: 0, newIds: new Set(), waitingIds: new Set() };
    const msgs = Array.isArray(c.messages) ? c.messages : [];
    const seen = markedUnread.has(c.post_id) ? '' : String(c.last_read_at || '');
    const byId = new Map(msgs.map(m => [m.id, m]));
    for (const m of msgs) {
      if (isMine(m) || isAuto(m) || m.deleted) continue;
      const root = byId.get(m.root_id) || m;
      if (isClient(m) && isTweak(root) && isClient(root)) continue;   // change requests live on the card (D2)
      if (String(m.created_at) > seen) { const k = isClient(m) ? 'comment' : role(m) === 'kasper' ? 'kasper' : 'staff'; s[k]++; s.newIds.add(m.id); }
    }
    for (const r of msgs.filter(m => m.root_id === m.id)) {
      if (!isClient(r) || isTweak(r) || r.done || noReply.has(r.id) || isAuto(r)) continue;
      if (!msgs.some(m => m.root_id === r.id && m !== r && !isClient(m))) { s.waitingIds.add(r.id); if (!s.newIds.has(r.id)) s.waiting++; }
    }
    s.newTotal = s.comment + s.staff + s.kasper;
    return s;
  }
  const origListHtml = window._msgListHtml;
  window._msgListHtml = function () {
    const f = _msgState.filter;
    const keep = c => { const s = convState(c); return f === 'all' || c.post_id === _msgState.openId || (f === 'answer' ? s.waitingIds.size > 0 : s.newTotal > 0); };
    const list = _msgState.conversations.filter(keep);
    if (!list.length) return `<div class="msg-list-empty">${f === 'answer' ? 'Nothing waiting for your answer' : f === 'new' ? 'No new messages' : 'No conversations yet.'}</div>`;
    return list.map(c => {
      const s = convState(c);
      const byId = new Map((c.messages || []).map(m => [m.id, m]));
      const last = (c.messages || []).filter(m => !isAuto(m) && !(isClient(m) && isTweak(byId.get(m.root_id) || m) && isClient(byId.get(m.root_id) || m))).slice(-1)[0] || {};
      const who = isMine(last) ? 'You' : WHO(last);
      const chips = [s.comment && chip('comment', s.comment), s.waiting && chip('waiting', s.waiting), s.staff && chip('staff', s.staff), s.kasper && chip('kasper', s.kasper)].filter(Boolean).join('');
      return `<button type="button" class="msg-conv${c.post_id === _msgState.openId ? ' is-active' : ''}${s.newTotal ? ' is-unread' : ''}" data-msg-conv="${_calEscAttr(c.post_id)}" onclick="_msgOpen(${_jsAttrArg(c.post_id)})">
        ${_msgThumb(c)}
        <span class="msg-conv-main">
          <span class="msg-conv-top"><span class="msg-conv-client">${_calEsc(_msgClientName(c))}</span><span class="msg-conv-time">${_calEsc(_calFmtCommentTime(last.created_at || c.last_at))}</span></span>
          <span class="msg-conv-sub">${_calEsc(c.title || 'Untitled post')}</span>
          <span class="msg-conv-last">${_calEsc(who + ': ' + (last.body || ''))}</span>
          ${chips ? `<span class="svu-chips svu-row-chips">${chips}</span>` : ''}
        </span>
      </button>`;
    }).join('');
  };
  window._msgUnreadConversations = function () { return _msgState.conversations.filter(c => convState(c).newTotal > 0).length; };
  window._msgSetFilter = function (f) { _msgState.filter = f === 'all' ? 'all' : f === 'answer' ? 'answer' : 'new'; _msgPaint(); };
  window._msgPaintCounts = function () {
    if (_msgState.unavailable) return;
    let newConvs = 0, waitConvs = 0, k = { comment: 0, staff: 0, kasper: 0 };
    for (const c of _msgState.conversations) { const s = convState(c); if (s.newTotal) newConvs++; if (s.waitingIds.size) waitConvs++; k.comment += s.comment; k.staff += s.staff; k.kasper += s.kasper; }
    const kind = k.comment ? 'comment' : k.staff ? 'staff' : k.kasper ? 'kasper' : 'waiting';
    document.querySelectorAll('[data-msg-count]').forEach(el => {
      const n = newConvs || waitConvs;
      el.textContent = String(n);
      el.hidden = n === 0;
      el.className = 'msg-unread svu-count svu-count-' + (newConvs ? kind : 'waiting-o');
    });
    document.querySelectorAll('[data-kasper-count="replies"]').forEach(el => { el.textContent = String(newConvs); el.classList.toggle('is-unread', newConvs > 0); });
    window.__svuCounts = { newConvs, waitConvs, k };
  };
  function decorateMessages() {
    const root = document.querySelector('#msgPage [data-msg-root], #msgPage .msg-page-body');
    if (!root) return;
    // Three views: New, To answer, All.
    const filters = root.querySelector('.msg-filters');
    if (filters && !filters.querySelector('[data-svu-answer]')) {
      const waitConvs = _msgState.conversations.filter(c => convState(c).waitingIds.size > 0).length;
      const btn = document.createElement('button');
      btn.type = 'button'; btn.setAttribute('data-svu-answer', '1');
      btn.textContent = 'To answer' + (waitConvs ? ' · ' + waitConvs : '');
      btn.onclick = () => _msgSetFilter('answer');
      const all = filters.lastElementChild;
      filters.insertBefore(btn, all);
      [...filters.children].forEach(b => b.classList.toggle('is-active', (b === btn && _msgState.filter === 'answer') || (b.textContent.startsWith('New') && _msgState.filter === 'new') || (b === all && _msgState.filter === 'all')));
    }
    // The chat: what each message is, in words; actions on the message itself; changes as a line to the card.
    const c = _msgState.conversations.find(x => x.post_id === _msgState.openId);
    if (!c || !Array.isArray(c.messages)) return;
    const s = convState(c);
    const byId = new Map(c.messages.map(m => [m.id, m]));
    root.querySelectorAll('.msg-b[data-msg-id]').forEach(b => {
      if (b.hasAttribute('data-svu')) return;
      b.setAttribute('data-svu', '1');
      const m = byId.get(b.getAttribute('data-msg-id'));
      if (!m) return;
      const rootM = byId.get(m.root_id) || m;
      if (isClient(m) && isTweak(rootM) && isClient(rootM)) {
        if (m === rootM) b.outerHTML = `<div class="svu-change-line">${ICO.change}<span>Client asked for a change on the ${_calEsc(String(LABEL(m.component || 'video')).toLowerCase())}. Changes are handled on the card.</span><button type="button" class="svu-link" onclick="_msgOpenCard()">Open card</button></div>`;
        else b.remove();
        return;
      }
      const meta = b.querySelector('.msg-b-meta');
      const tags = [];
      if (s.newIds.has(m.id)) tags.push(`<span class="svu-tag svu-${isClient(m) ? 'comment' : role(m) === 'kasper' ? 'kasper' : 'staff'}">New</span>`);
      if (s.waitingIds.has(m.id)) tags.push('<span class="svu-tag svu-waiting-o">Waiting for your answer</span>');
      if (noReply.has(m.id)) tags.push('<span class="svu-tag svu-plain">No reply needed</span>');
      if (meta && tags.length) meta.insertAdjacentHTML('beforeend', tags.join(''));
      if (s.waitingIds.has(m.id)) {
        b.classList.add('svu-b-waiting');
        b.insertAdjacentHTML('beforeend', `<div class="svu-b-acts"><button type="button" class="svu-btn svu-primary" onclick="_msgSetReplyTo(${_jsAttrArg(m.root_id)});document.getElementById('msgReplyBox')&&document.getElementById('msgReplyBox').focus()">${ICO.waiting}Reply</button><button type="button" class="svu-btn" onclick="svUnreadPreview.noReply('${m.id}')">No reply needed</button></div>`);
      }
    });
    // The two conversation actions are plain buttons in the head, on a phone too (today a phone hides them behind "•••").
    root.querySelectorAll('.msg-chat-actions .msg-act').forEach(a => { if (/unread/i.test(a.textContent)) a.textContent = 'Mark unread'; });
    const more = root.querySelector('.msg-chat-actions .thumb-msg-options');
    if (more) {
      const head = more.closest('.msg-chat-head');
      more.remove();
      if (head && !head.nextElementSibling?.classList.contains('svu-phone-acts')) head.insertAdjacentHTML('afterend', '<div class="svu-phone-acts"><button type="button" class="svu-btn" onclick="_msgMarkUnread()">Mark unread</button><button type="button" class="svu-btn" onclick="_msgOpenCard()">Open card</button></div>');
    }
  }
  const origPaint = window._msgPaint;
  window._msgPaint = function () { const r = origPaint.apply(this, arguments); try { decorateMessages(); } catch (e) { console.warn('svu', e); } return r; };

  /* ---------- the Messages button's hover ---------- */
  let btnTip = null;
  function showButtonTip() {
    hideButtonTip();
    const btn = document.getElementById('navMessages');
    const c = window.__svuCounts || { newConvs: 0, waitConvs: 0, k: {} };
    if (!btn) return;
    btnTip = document.createElement('div');
    btnTip.className = 'svu-pv svu-btn-tip';
    const line = (cls, text) => `<div class="svu-tip-line"><span class="svu-tip-sw ${cls}"></span>${text}</div>`;
    btnTip.innerHTML = `<div class="svu-pv-head">Messages</div>${c.newConvs ? line('svu-comment', plural(c.newConvs, 'conversation', 'conversations') + ' with something new') : ''}${c.k.comment ? line('svu-comment', plural(c.k.comment, 'new client comment', 'new client comments')) : ''}${c.k.staff ? line('svu-staff', plural(c.k.staff, 'new message', 'new messages') + ' from the team') : ''}${c.k.kasper ? line('svu-kasper', plural(c.k.kasper, 'new message', 'new messages') + ' from Kasper') : ''}${c.waitConvs ? line('svu-waiting-o', plural(c.waitConvs, 'client is', 'clients are') + ' waiting for your answer') : ''}<div class="svu-tip-note">Change requests are not here: they are on the cards.</div>`;
    document.body.appendChild(btnTip);
    const r = btn.getBoundingClientRect();
    const w = Math.min(320, innerWidth - 24);
    btnTip.style.width = w + 'px';
    btnTip.style.left = Math.max(12, Math.min(r.right - w, innerWidth - w - 12)) + 'px';
    btnTip.style.top = (r.bottom + 8) + 'px';
  }
  function hideButtonTip() { if (btnTip) { btnTip.remove(); btnTip = null; } }

  /* ---------- actions (this page only) ---------- */
  function noReplyAction(id) { noReply.add(id); refresh(); }
  function markUnread(pid) { markedUnread.add(pid); refresh(); if (typeof showToast === 'function') showToast('Marked unread. It stays in your new list.'); }
  function refresh() {
    try { (calState.posts || []).forEach(p => _calRefreshCommentsBtn(p.id)); } catch (e) {}
    placeStrip(); decorateNotes(); decorateTiles(); try { _msgPaintCounts(); _msgPaint(); } catch (e) {}
  }

  /* ---------- styles: the proposed tokens, light and dark ---------- */
  const CSS_TEXT = `
  :root { --svu-change: #ea580c; --svu-change-fg: #fff; --svu-change-ink: #c2410c; --svu-change-soft: #fff1e6;
    --svu-comment: #2563eb; --svu-comment-fg: #fff; --svu-comment-ink: #1d4ed8; --svu-comment-soft: #eaf1ff;
    --svu-staff: #3f3f46; --svu-staff-fg: #fff; --svu-staff-ink: #3f3f46; --svu-staff-soft: #efeff1;
    --svu-kasper: #6c5ce7; --svu-kasper-fg: #fff; --svu-kasper-ink: #5a4bd1; --svu-kasper-soft: #f0eeff; }
  html[data-theme="dark"] { --svu-change: #fb923c; --svu-change-fg: #1f1004; --svu-change-ink: #fdba74; --svu-change-soft: rgba(251,146,60,.16);
    --svu-comment: #60a5fa; --svu-comment-fg: #0b1220; --svu-comment-ink: #93c5fd; --svu-comment-soft: rgba(96,165,250,.16);
    --svu-staff: #d4d4d8; --svu-staff-fg: #18181b; --svu-staff-ink: #e4e4e7; --svu-staff-soft: rgba(212,212,216,.14);
    --svu-kasper: #a094f8; --svu-kasper-fg: #140f33; --svu-kasper-ink: #c3b5ff; --svu-kasper-soft: rgba(160,148,248,.18); }
  .svu-foot { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
  .cal-comments-btn.svu-notes.svu-has-new { color: var(--text-primary); font-weight: 600; }
  .cal-comments-btn.svu-notes.svu-has-new svg { opacity: 1; }
  .svu-chips { display: inline-flex; gap: 4px; flex-wrap: wrap; cursor: pointer; }
  .svu-chip { display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 8px 0 6px; border-radius: 99px; font-size: 0.68rem; font-weight: 700; white-space: nowrap; line-height: 1; font-variant-numeric: tabular-nums; letter-spacing: 0; }
  .svu-chip svg { width: 11px; height: 11px; flex: none; }
  .svu-chip.svu-change { background: var(--svu-change); color: var(--svu-change-fg); }
  .svu-chip.svu-comment { background: var(--svu-comment); color: var(--svu-comment-fg); }
  .svu-chip.svu-staff { background: var(--svu-staff); color: var(--svu-staff-fg); }
  .svu-chip.svu-kasper { background: var(--svu-kasper); color: var(--svu-kasper-fg); }
  .svu-chip.svu-open { background: transparent; color: var(--svu-change-ink); box-shadow: inset 0 0 0 1.5px var(--svu-change); font-weight: 600; }
  .svu-chip.svu-waiting { background: transparent; color: var(--svu-comment-ink); box-shadow: inset 0 0 0 1.5px var(--svu-comment); font-weight: 600; }
  .svu-chip.svu-more { background: var(--surface-subtle, #f3f3f1); color: var(--text-secondary); font-weight: 600; }
  .svu-dim { opacity: .3; transition: opacity .15s; }
  .svu-strip { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 10px 0 2px; padding: 8px 12px; background: var(--white); border: 1px solid var(--border); border-radius: 12px; }
  .svu-strip-label { font-size: .8rem; font-weight: 700; color: var(--text-primary); margin-right: 4px; }
  .svu-strip-btn { display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--border); background: var(--white); color: var(--text-primary); border-radius: 99px; padding: 3px 11px 3px 4px; font: inherit; font-size: .78rem; font-weight: 500; cursor: pointer; }
  .svu-strip-btn:hover { background: var(--surface-hover); }
  .svu-strip-btn.is-on { box-shadow: inset 0 0 0 1.5px var(--text-primary); }
  .svu-strip-calm { font-size: .78rem; color: var(--text-secondary); }
  .svu-strip-clear { margin-left: auto; border: 0; background: transparent; color: var(--text-secondary); font: inherit; font-size: .76rem; text-decoration: underline; cursor: pointer; }
  .svu-pv { position: fixed; z-index: 9999; background: var(--surface-raised, var(--white)); color: var(--text-primary); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow-md); padding: 8px; font-size: .8rem; }
  .svu-pv-head { font-size: .74rem; font-weight: 700; color: var(--text-secondary); padding: 2px 6px 6px; }
  .svu-pv-item { display: flex; gap: 9px; padding: 7px 6px; border-top: 1px solid var(--border-light); }
  .svu-pv-dot { width: 24px; height: 24px; border-radius: 99px; display: grid; place-items: center; flex: none; }
  .svu-pv-dot svg { width: 13px; height: 13px; }
  .svu-pv-dot.svu-change { background: var(--svu-change-soft); color: var(--svu-change-ink); }
  .svu-pv-dot.svu-comment, .svu-pv-dot.svu-waiting { background: var(--svu-comment-soft); color: var(--svu-comment-ink); }
  .svu-pv-dot.svu-staff { background: var(--svu-staff-soft); color: var(--svu-staff-ink); }
  .svu-pv-dot.svu-kasper { background: var(--svu-kasper-soft); color: var(--svu-kasper-ink); }
  .svu-pv-main { min-width: 0; flex: 1; }
  .svu-pv-top { display: flex; gap: 6px; align-items: baseline; font-size: .76rem; color: var(--text-secondary); }
  .svu-pv-top b { color: var(--text-primary); }
  .svu-pv-time { margin-left: auto; color: var(--text-muted); font-size: .7rem; white-space: nowrap; }
  .svu-pv-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-primary); margin-top: 1px; }
  .svu-pv-foot { display: flex; justify-content: space-between; gap: 8px; padding: 8px 6px 2px; border-top: 1px solid var(--border-light); color: var(--text-secondary); font-size: .74rem; }
  .svu-pv-foot b { color: var(--text-primary); }
  .svu-pv-empty { padding: 6px; color: var(--text-secondary); }
  .svu-tip-line { display: flex; align-items: center; gap: 8px; padding: 3px 6px; color: var(--text-primary); }
  .svu-tip-sw { width: 9px; height: 9px; border-radius: 99px; flex: none; }
  .svu-tip-sw.svu-comment { background: var(--svu-comment); } .svu-tip-sw.svu-staff { background: var(--svu-staff); } .svu-tip-sw.svu-kasper { background: var(--svu-kasper); }
  .svu-tip-sw.svu-waiting-o { box-shadow: inset 0 0 0 2px var(--svu-comment); }
  .svu-tip-note { padding: 6px 6px 2px; margin-top: 4px; border-top: 1px solid var(--border-light); color: var(--text-secondary); font-size: .74rem; }
  .msg-nav-btn > .svu-count { box-shadow: 0 0 0 2px var(--white); }
  .msg-unread.svu-count-comment { background: var(--svu-comment); color: var(--svu-comment-fg); }
  .msg-unread.svu-count-staff { background: var(--svu-staff); color: var(--svu-staff-fg); }
  .msg-unread.svu-count-kasper { background: var(--svu-kasper); color: var(--svu-kasper-fg); }
  .msg-unread.svu-count-waiting-o { background: var(--white); color: var(--svu-comment-ink); box-shadow: 0 0 0 2px var(--white), inset 0 0 0 1.5px var(--svu-comment); }
  .svu-need { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 10px 12px; margin: 0 0 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-subtle, var(--bg)); }
  .svu-need-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: .8rem; }
  .svu-need-row b { margin-right: 4px; }
  .svu-need-calm { color: var(--text-secondary); }
  .svu-tag { font-size: .66rem; font-weight: 700; padding: 2px 7px; border-radius: 99px; white-space: nowrap; line-height: 1.4; }
  .svu-tag.svu-change { background: var(--svu-change); color: var(--svu-change-fg); }
  .svu-tag.svu-comment { background: var(--svu-comment); color: var(--svu-comment-fg); }
  .svu-tag.svu-staff { background: var(--svu-staff); color: var(--svu-staff-fg); }
  .svu-tag.svu-kasper { background: var(--svu-kasper); color: var(--svu-kasper-fg); }
  .svu-tag.svu-waiting-o { color: var(--svu-comment-ink); box-shadow: inset 0 0 0 1.5px var(--svu-comment); }
  .svu-tag.svu-open-o { color: var(--svu-change-ink); box-shadow: inset 0 0 0 1.5px var(--svu-change); }
  .svu-tag.svu-plain { background: var(--surface-subtle, var(--bg)); color: var(--text-secondary); }
  .svu-th-waiting { box-shadow: inset 3px 0 0 var(--svu-comment); border-radius: 8px; }
  .svu-th-new .cal-cm-row-body { font-weight: 600; }
  .svu-tags { display: flex; gap: 4px; flex-wrap: wrap; margin: 3px 0 2px; }
  .svu-row-acts { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 7px; }
  .svu-act svg { width: 13px; height: 13px; }
  .svu-row-chips { margin-top: 5px; }
  .svu-chip svg { width: 11px !important; height: 11px !important; }
  .svu-head-act { font-size: .74rem !important; padding: 6px 9px !important; white-space: nowrap; }
  @media (max-width: 767px) {
    .cal-cm-row:has(> .cal-cm-body-col .svu-row-acts:not([hidden])) > .cal-cm-actions { display: none !important; }
    .svu-change-line { border-radius: 12px !important; padding: 8px 10px !important; }
    .svu-phone-acts { display: flex; gap: 8px; padding: 8px 16px; border-bottom: 1px solid var(--border-light); }
  }
  .svu-tile-chips { display: flex; gap: 3px; flex-wrap: wrap; margin-bottom: 4px; }
  .svu-chip.svu-mini { height: 18px; padding: 0 6px 0 4px; font-size: .66rem; box-shadow: 0 0 0 1.5px rgba(0,0,0,.25); }
  .svu-chip.svu-mini.svu-open, .svu-chip.svu-mini.svu-waiting { background: #fff; }
  html[data-theme="dark"] .svu-chip.svu-mini.svu-open, html[data-theme="dark"] .svu-chip.svu-mini.svu-waiting { background: #181a1f; }
  .svu-change-line { align-self: center; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center; font-size: .76rem; color: var(--svu-change-ink); background: var(--svu-change-soft); border-radius: 99px; padding: 5px 6px 5px 12px; margin: 6px auto; max-width: 92%; }
  .svu-change-line svg { width: 12px; height: 12px; flex: none; }
  .svu-link { border: 0; background: var(--white); color: var(--text-primary); border-radius: 99px; padding: 3px 10px; font: inherit; font-size: .74rem; font-weight: 600; cursor: pointer; }
  .svu-b-waiting .msg-b-text { box-shadow: inset 3px 0 0 var(--svu-comment); }
  .svu-b-acts { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
  .svu-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); background: var(--white); color: var(--text-primary); border-radius: 8px; padding: 5px 11px; font: inherit; font-size: .76rem; font-weight: 600; cursor: pointer; }
  .svu-btn svg { width: 12px; height: 12px; }
  .svu-btn.svu-primary { background: var(--text-primary); color: var(--white); border-color: var(--text-primary); }
  .svu-b-waiting .msg-b-reply { display: none; }
  `;

  function apply() {
    if (!document.getElementById('svu-style')) {
      const st = document.createElement('style'); st.id = 'svu-style'; st.textContent = CSS_TEXT; document.head.appendChild(st);
    }
    window._calCommentsBtnHtml = notesBtnHtml;
    const origOpen = window.openCalComments;
    if (!origOpen.__svu) {
      window.openCalComments = function (pid) {
        const post = calState.posts.find(p => p.id === pid);
        notesSnap = { pid, seen: markedUnread.has(pid) ? '' : (_notesGetSeen(pid) || '') };
        markedUnread.delete(pid);
        hideHover();
        const r = origOpen.apply(this, arguments);
        setTimeout(decorateNotes, 0);
        return r;
      };
      window.openCalComments.__svu = true;
    }
    const mo = new MutationObserver(() => { mo.disconnect(); try { placeStrip(); decorateNotes(); decorateTiles(); } catch (e) {} mo.observe(document.body, { childList: true, subtree: true }); });
    mo.observe(document.body, { childList: true, subtree: true });
    const nb = document.getElementById('navMessages');
    if (nb && !nb.__svu) { nb.__svu = true; nb.removeAttribute('title'); nb.addEventListener('pointerenter', showButtonTip); nb.addEventListener('pointerleave', hideButtonTip); }
    refresh();
  }

  window.svUnreadPreview = { apply, hoverCard, hideHover, filter, noReply: noReplyAction, markUnread, showButtonTip, hideButtonTip, stateOf, refresh };
})();
