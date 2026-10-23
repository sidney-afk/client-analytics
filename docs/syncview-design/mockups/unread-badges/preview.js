/* Unread badges preview, round 4 (session Beacon, 2026-10-23). LOCAL ONLY, DESKTOP: loaded into the real page by make-screenshots.js,
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

  /* ---------- icons ---------- */
  const ICO = {
    change: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 2.5l3 3L6 13H3v-3z"/></svg>',
    comment: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M2.5 3.5h11v8H7l-3 2.5V11.5H2.5z"/></svg>',
    waiting: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4L2.5 7.5 6 11 M2.5 7.5H10a3.5 3.5 0 0 1 3.5 3.5v1"/></svg>',
    staff: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="5.3" r="2.5"/><path stroke-linecap="round" d="M3.2 13.2c.35-2.35 2.1-3.7 4.8-3.7s4.45 1.35 4.8 3.7"/></svg>',
    kasper: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"/><circle cx="8" cy="8" r="2.2"/></svg>',
  };
  ICO.open = ICO.change;
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const SAY = {
    change: n => plural(n, 'new change request', 'new change requests'), open: n => plural(n, 'change request not done yet', 'change requests not done yet'),
    comment: n => plural(n, 'new comment from the client', 'new comments from the client'), waiting: n => plural(n, 'comment waiting for your answer', 'comments waiting for your answer'),
    staff: n => plural(n, 'new message from the team', 'new messages from the team'), kasper: n => plural(n, 'new message from Kasper', 'new messages from Kasper'),
  };

  /* ---------- the badge: one square strip, icon + number only ----------
     Rule for any number of kinds: NEW kinds are joined segments of one strip (change, comment, team, Kasper, in
     that order); what is read but still needs you (changes not done, comments to answer) follows as outlined
     segments of a second strip. At most four segments in all; the rest fold into "+N". The words are in the hover. */
  function badgeHtml(s, max) {
    const filled = [['change', s.change], ['comment', s.comment], ['staff', s.staff], ['kasper', s.kasper]].filter(x => x[1] > 0);
    const outlined = [['open', s.open], ['waiting', s.waiting]].filter(x => x[1] > 0);
    const all = filled.map(x => x.concat('f')).concat(outlined.map(x => x.concat('o')));
    const limit = max || 4;
    const shown = all.length > limit ? all.slice(0, limit - 1) : all;
    const rest = all.length - shown.length;
    const seg = ([k, n]) => `<span class="svu-seg svu-${k}" aria-label="${SAY[k](n)}">${ICO[k]}<b>${n}</b></span>`;
    const f = shown.filter(x => x[2] === 'f'), o = shown.filter(x => x[2] === 'o');
    return (f.length ? `<span class="svu-strip-f">${f.map(seg).join('')}</span>` : '')
      + (o.length ? `<span class="svu-strip-o">${o.map(seg).join('')}</span>` : '')
      + (rest ? `<span class="svu-strip-more">+${rest}</span>` : '');
  }

  /* ---------- Calendar card: the Notes button ---------- */
  const NOTES_ICO = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.5h11v8H7l-3 2.5V11.5H2.5z"/></svg>';
  function notesBtnHtml(post, pid) {
    const s = stateOf(post);
    const any = s.change + s.comment + s.staff + s.kasper > 0;
    const strip = badgeHtml(s);
    return `<span class="cal-foot-tweaks svu-foot" data-comments-wrap="${pid}" onpointerenter="svUnreadPreview.hoverCard('${pid}', this)" onpointerleave="svUnreadPreview.hideHover()"><button type="button" class="cal-comments-btn svu-notes${any ? ' svu-has-new' : ''}" data-comments-btn="${pid}" onclick="openCalComments('${pid}')" aria-label="Notes">${NOTES_ICO}<span class="cal-comments-label">Notes</span></button>${strip ? `<span class="svu-strips" onclick="openCalComments('${pid}')">${strip}</span>` : ''}</span>`;
  }

  /* ---------- the hover: who and what, at once ---------- */
  const WHO = m => isClient(m) ? 'Client' : (role(m) === 'kasper' ? 'Kasper' : String(m.author || 'Team').split(' ')[0]);
  const WHAT = { change: 'Change request', comment: 'Comment', waiting: 'Waiting for your answer', staff: 'Team note', kasper: 'Team note' };
  const whatOf = (kind, m) => (kind === 'staff' || kind === 'kasper') && String(m.audience || '') === 'client' ? 'Reply to the client' : WHAT[kind];
  function hoverHtml(post) {
    const s = stateOf(post);
    const lines = s.items.slice(0, 5).map(({ kind, n }) => `<div class="svu-pv-row svu-k-${kind}"><span class="svu-pv-ico">${ICO[kind]}</span><span class="svu-pv-who">${_calEsc(WHO(n.m))}</span><span class="svu-pv-what">${_calEsc(whatOf(kind, n.m))} · ${_calEsc(LABEL(n.comp))}</span><span class="svu-pv-time">${_calEsc(_calFmtCommentTime(n.m.created_at))}</span><span class="svu-pv-text">${_calEsc(n.m.body || '')}</span></div>`).join('');
    const more = s.items.length > 5 ? `<div class="svu-pv-foot">${s.items.length - 5} more in Notes</div>` : '';
    const open = s.open ? `<div class="svu-pv-foot">${SAY.open(s.open)}</div>` : '';
    return (lines || '<div class="svu-pv-empty">Nothing new</div>') + more + open;
  }
  let hoverEl = null;
  function hoverCard(pid, anchor) {
    const post = calState.posts.find(p => p.id === pid);
    if (!post) return;
    hideHover();
    const s = stateOf(post);
    if (!s.items.length && !s.open) return;
    hoverEl = document.createElement('div');
    hoverEl.className = 'svu-pv';
    hoverEl.setAttribute('role', 'tooltip');
    hoverEl.innerHTML = hoverHtml(post);
    document.body.appendChild(hoverEl);
    const r = anchor.getBoundingClientRect();
    const w = Math.min(380, innerWidth - 24);
    hoverEl.style.width = w + 'px';
    hoverEl.style.left = Math.max(12, Math.min(r.left, innerWidth - w - 12)) + 'px';
    const h = hoverEl.offsetHeight;
    hoverEl.style.top = (r.top - h - 6 > 8 ? r.top - h - 6 : r.bottom + 6) + 'px';
  }
  function hideHover() { if (hoverEl) { hoverEl.remove(); hoverEl = null; } }

  /* ---------- Notes panel ---------- */
  let notesSnap = null;   // the state just before Notes opened (opening clears "new")
  function kindClass(n) { const k = kindOf(n); return k; }
  function decorateNotes() {
    const modal = document.getElementById('calCommentsModal');
    if (!modal || !notesSnap) return;
    const post = calState.posts.find(p => p.id === notesSnap.pid);
    const feed = modal.querySelector('.cal-comments-feed');
    if (!post || !feed) return;
    const live = stateOf(post, notesSnap.seen);
    const notes = notesOf(post);
    // "Needs you", pinned under the title: each line jumps to its note.
    const need = [];
    for (const n of notes) {
      const id = n.m.id;
      if (n.m !== n.root) continue;
      if (live.newIds.has(id) || live.waitingIds.has(id) || live.openIds.has(id)) {
        const k = live.waitingIds.has(id) ? 'waiting' : (live.newIds.has(id) ? kindOf(n) : 'open');
        const label = live.waitingIds.has(id) ? 'Waiting for your answer' : live.newIds.has(id) ? (k === 'change' ? 'New change request' : k === 'comment' ? 'New comment' : k === 'kasper' ? 'New from Kasper' : 'New from the team') : 'Change request not done';
        need.push({ id, k, label, n });
      }
    }
    for (const n of notes) if (n.m !== n.root && live.newIds.has(n.m.id) && !need.some(x => x.id === n.root.id)) need.push({ id: n.root.id, k: kindOf(n), label: 'New reply', n });
    let bar = modal.querySelector('.svu-need');
    const barHtml = need.length
      ? `<div class="svu-need-head"><span>Needs you</span><button type="button" class="svu-text-btn" onclick="svUnreadPreview.markUnread('${post.id}')">Mark unread</button></div>` + need.slice(0, 4).map(x => `<button type="button" class="svu-need-row svu-k-${x.k}" onclick="svUnreadPreview.jump('${x.id}')"><span class="svu-need-ico">${ICO[x.k] || ICO.comment}</span><span class="svu-need-label">${_calEsc(x.label)}</span><span class="svu-need-text">${_calEsc(WHO(x.n.m))} · ${_calEsc(x.n.m.body || '')}</span><span class="svu-need-part">${_calEsc(LABEL(x.n.comp))}</span></button>`).join('') + (need.length > 4 ? `<div class="svu-need-more">${need.length - 4} more below</div>` : '')
      : `<div class="svu-need-head"><span>Nothing needs you on this post</span><button type="button" class="svu-text-btn" onclick="svUnreadPreview.markUnread('${post.id}')">Mark unread</button></div>`;
    if (!bar) { bar = document.createElement('div'); bar.className = 'svu-need'; feed.before(bar); }
    if (bar.innerHTML !== barHtml) bar.innerHTML = barHtml;
    // Each note: a thin colour rule for what it is, quiet words, and the actions that matter, always on screen.
    modal.querySelectorAll('.cal-cm-row[data-cm-row]').forEach(row => {
      const id = row.getAttribute('data-cm-row');
      const n = notes.find(x => x.m.id === id);
      if (!n) return;
      const k = isAuto(n.m) ? 'auto' : kindOf(n);
      row.setAttribute('data-svu-kind', k);
      const tags = [];
      if (live.newIds.has(id)) tags.push(`<span class="svu-tag svu-t-${k}">New</span>`);
      if (live.waitingIds.has(id)) tags.push('<span class="svu-tag svu-t-waiting">Waiting for your answer</span>');
      if (live.openIds.has(id) && !live.newIds.has(id)) tags.push('<span class="svu-tag svu-t-open">Not done</span>');
      if (noReply.has(id)) tags.push('<span class="svu-tag svu-t-plain">No reply needed</span>');
      if (isAuto(n.m)) {
        tags.push('<span class="svu-tag svu-t-plain">Automatic record</span>');
        const b = row.querySelector('.cal-cm-row-body');
        if (b && !b.hasAttribute('data-svu-auto')) { b.setAttribute('data-svu-auto', '1'); b.textContent = 'Changed the caption.'; }
      }
      const html = tags.join('');
      const head = row.querySelector('.cal-cm-head-line');
      let holder = row.querySelector('.svu-tags');
      if (!holder && head) { holder = document.createElement('span'); holder.className = 'svu-tags'; head.insertBefore(holder, head.querySelector('.cal-cm-time')); }
      if (holder && holder.innerHTML !== html) holder.innerHTML = html;
      const q = JSON.stringify(id).replace(/"/g, '&quot;');
      const want = live.waitingIds.has(id)
        ? `<button type="button" class="svu-btn svu-primary" onclick="_calBeginReply(${q})">Reply</button><button type="button" class="svu-text-btn" onclick="svUnreadPreview.noReply('${id}')">No reply needed</button>`
        : (live.openIds.has(id) ? `<button type="button" class="svu-btn" onclick="_calBeginReply(${q})">Reply</button><button type="button" class="svu-text-btn" onclick="_calToggleCommentDone(${q})">Mark done</button>` : '');
      let act = row.querySelector('.svu-row-acts');
      const body = row.querySelector('.cal-cm-row-body');
      if (!act && body && want) { act = document.createElement('div'); act.className = 'svu-row-acts'; body.after(act); }
      if (act && act.innerHTML !== want) act.innerHTML = want;
      if (act) act.hidden = !want;
    });
  }
  function jump(id) {
    const row = document.querySelector(`#calCommentsModal .cal-cm-row[data-cm-row="${CSS.escape(id)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center' });
    row.classList.add('svu-flash'); setTimeout(() => row.classList.remove('svu-flash'), 1200);
  }

  /* ---------- Messages ---------- */
  function convState(c) {
    const s = { comment: 0, staff: 0, kasper: 0, waiting: 0, newIds: new Set(), waitingIds: new Set(), open: 0, change: 0 };
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
  const isChangeMsg = (m, byId) => { const root = byId.get(m.root_id) || m; return isClient(m) && isTweak(root) && isClient(root); };
  window._msgListHtml = function () {
    const f = _msgState.filter;
    const keep = c => { const s = convState(c); return f === 'all' || c.post_id === _msgState.openId || (f === 'answer' ? s.waitingIds.size > 0 : s.newTotal > 0); };
    const list = _msgState.conversations.filter(keep);
    if (!list.length) return `<div class="msg-list-empty">${f === 'answer' ? 'Nothing is waiting for your answer' : f === 'new' ? 'Nothing new' : 'No conversations yet'}</div>`;
    return list.map(c => {
      const s = convState(c);
      const byId = new Map((c.messages || []).map(m => [m.id, m]));
      const last = (c.messages || []).filter(m => !isAuto(m) && !isChangeMsg(m, byId)).slice(-1)[0] || {};
      const who = isMine(last) ? 'You' : WHO(last);
      return `<button type="button" class="msg-conv svu-conv${c.post_id === _msgState.openId ? ' is-active' : ''}${s.newTotal ? ' is-unread' : ''}" data-msg-conv="${_calEscAttr(c.post_id)}" onclick="_msgOpen(${_jsAttrArg(c.post_id)})">
        <span class="svu-conv-main">
          <span class="svu-conv-top"><span class="svu-conv-title">${_calEsc(c.title || 'Untitled post')}</span><span class="svu-conv-time">${_calEsc(_calFmtCommentTime(last.created_at || c.last_at))}</span></span>
          <span class="svu-conv-client">${_calEsc(_msgClientName(c))}</span>
          <span class="svu-conv-last">${_calEsc(who + ': ' + (last.body || ''))}</span>
        </span>
        <span class="svu-conv-badge">${badgeHtml(s, 3)}</span>
      </button>`;
    }).join('');
  };
  window._msgUnreadConversations = function () { return _msgState.conversations.filter(c => convState(c).newTotal > 0).length; };
  window._msgSetFilter = function (f) { _msgState.filter = f === 'all' ? 'all' : f === 'answer' ? 'answer' : 'new'; _msgPaint(); };
  window._msgPaintCounts = function () {
    if (_msgState.unavailable) return;
    let newConvs = 0, waitConvs = 0; const k = { comment: 0, staff: 0, kasper: 0 };
    for (const c of _msgState.conversations) { const s = convState(c); if (s.newTotal) newConvs++; if (s.waitingIds.size) waitConvs++; k.comment += s.comment; k.staff += s.staff; k.kasper += s.kasper; }
    const kind = k.comment ? 'comment' : k.staff ? 'staff' : k.kasper ? 'kasper' : 'waiting';
    document.querySelectorAll('[data-msg-count]').forEach(el => {
      const n = newConvs || waitConvs;
      el.textContent = String(n);
      el.hidden = n === 0;
      el.className = 'msg-unread svu-count svu-count-' + (newConvs ? kind : 'waiting');
    });
    window.__svuCounts = { newConvs, waitConvs, k };
  };
  function decorateMessages() {
    const root = document.querySelector('#msgPage [data-msg-root], #msgPage .msg-page-body');
    if (!root) return;
    const filters = root.querySelector('.msg-filters');
    if (filters && !filters.querySelector('[data-svu-answer]')) {
      const waitConvs = _msgState.conversations.filter(c => convState(c).waitingIds.size > 0).length;
      const newConvs = _msgUnreadConversations();
      filters.innerHTML = [['new', 'New', newConvs], ['answer', 'To answer', waitConvs], ['all', 'All', 0]].map(([k, t, n]) =>
        `<button type="button" data-svu-${k}="1" class="${_msgState.filter === k ? 'is-active' : ''}" aria-pressed="${_msgState.filter === k}" onclick="_msgSetFilter('${k}')">${t}${n ? ` <span>${n}</span>` : ''}</button>`).join('');
    }
    const c = _msgState.conversations.find(x => x.post_id === _msgState.openId);
    if (!c || !Array.isArray(c.messages)) return;
    const s = convState(c);
    const byId = new Map(c.messages.map(m => [m.id, m]));
    root.querySelectorAll('.msg-b[data-msg-id]').forEach(b => {
      if (b.hasAttribute('data-svu')) return;
      b.setAttribute('data-svu', '1');
      const m = byId.get(b.getAttribute('data-msg-id'));
      if (!m) return;
      if (isChangeMsg(m, byId)) {
        if (m.root_id === m.id) b.outerHTML = `<div class="svu-change-line">${ICO.change}<span>The client asked for a change on the ${_calEsc(String(LABEL(m.component || 'video')).toLowerCase())}. Change requests are handled on the card.</span><button type="button" class="svu-text-btn" onclick="_msgOpenCard()">Open card</button></div>`;
        else b.remove();
        return;
      }
      const k = isAuto(m) ? 'auto' : isMine(m) ? 'me' : isClient(m) ? 'comment' : role(m) === 'kasper' ? 'kasper' : 'staff';
      b.setAttribute('data-svu-kind', k);
      const meta = b.querySelector('.msg-b-meta');
      const tags = [];
      if (s.newIds.has(m.id)) tags.push(`<span class="svu-tag svu-t-${k}">New</span>`);
      if (s.waitingIds.has(m.id)) tags.push('<span class="svu-tag svu-t-waiting">Waiting for your answer</span>');
      if (noReply.has(m.id)) tags.push('<span class="svu-tag svu-t-plain">No reply needed</span>');
      if (isAuto(m)) {
        tags.push('<span class="svu-tag svu-t-plain">Automatic record</span>');
        const t = b.querySelector('.msg-b-text');
        if (t) t.textContent = 'Changed the caption.';
      }
      if (meta && tags.length) meta.insertAdjacentHTML('beforeend', tags.join(''));
      if (s.waitingIds.has(m.id)) b.insertAdjacentHTML('beforeend', `<div class="svu-row-acts"><button type="button" class="svu-btn svu-primary" onclick="_msgSetReplyTo(${_jsAttrArg(m.root_id)});document.getElementById('msgReplyBox')&&document.getElementById('msgReplyBox').focus()">Reply</button><button type="button" class="svu-text-btn" onclick="svUnreadPreview.noReply('${m.id}')">No reply needed</button></div>`);
    });
    root.querySelectorAll('.msg-chat-actions .msg-act').forEach(a => { if (/unread/i.test(a.textContent)) a.textContent = 'Mark unread'; });
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
    const line = (k, text) => `<div class="svu-pv-row svu-k-${k} svu-tip-row"><span class="svu-pv-ico">${ICO[k]}</span><span class="svu-tip-text">${text}</span></div>`;
    btnTip.innerHTML = `<div class="svu-tip-head">${c.newConvs ? plural(c.newConvs, 'conversation has', 'conversations have') + ' something new' : 'Nothing new'}</div>`
      + (c.k.comment ? line('comment', SAY.comment(c.k.comment)) : '') + (c.k.staff ? line('staff', SAY.staff(c.k.staff)) : '') + (c.k.kasper ? line('kasper', SAY.kasper(c.k.kasper)) : '')
      + (c.waitConvs ? line('waiting', plural(c.waitConvs, 'client is', 'clients are') + ' waiting for your answer') : '')
      + '<div class="svu-pv-foot">Change requests are on the cards, not here.</div>';
    document.body.appendChild(btnTip);
    const r = btn.getBoundingClientRect();
    const w = Math.min(330, innerWidth - 24);
    btnTip.style.width = w + 'px';
    btnTip.style.left = Math.max(12, Math.min(r.right - w, innerWidth - w - 12)) + 'px';
    btnTip.style.top = (r.bottom + 6) + 'px';
  }
  function hideButtonTip() { if (btnTip) { btnTip.remove(); btnTip = null; } }

  /* ---------- actions (this page only) ---------- */
  function noReplyAction(id) { noReply.add(id); refresh(); }
  function markUnread(pid) { markedUnread.add(pid); refresh(); if (typeof showToast === 'function') showToast('Marked unread'); }
  function refresh() {
    try { (calState.posts || []).forEach(p => _calRefreshCommentsBtn(p.id)); } catch (e) {}
    decorateNotes(); try { _msgPaintCounts(); _msgPaint(); } catch (e) {}
  }

  /* ---------- styles: calm, square, quiet (the calm Workload and the client review page) ---------- */
  const CSS_TEXT = `
  :root { --svu-change: #d9480f; --svu-change-ink: #c2410c; --svu-comment: #2563eb; --svu-comment-ink: #1d4ed8; --svu-staff: #52525b; --svu-staff-ink: #3f3f46;
    --svu-kasper: #6c5ce7; --svu-kasper-ink: #5a4bd1; --svu-on: #fff; --svu-hair: var(--border-light); --svu-tint: color-mix(in srgb, var(--bg) 60%, transparent); --svu-r: 2px; }
  html[data-theme="dark"] { --svu-change: #fb923c; --svu-change-ink: #fdba74; --svu-comment: #60a5fa; --svu-comment-ink: #93c5fd; --svu-staff: #a1a1aa; --svu-staff-ink: #d4d4d8;
    --svu-kasper: #a094f8; --svu-kasper-ink: #c3b5ff; --svu-on: #101114; --svu-tint: color-mix(in srgb, var(--text-primary) 4%, transparent); }
  /* the badge */
  .svu-foot { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .cal-comments-btn.svu-notes.svu-has-new { color: var(--text-primary); font-weight: 600; }
  .cal-comments-btn.svu-notes.svu-has-new svg { opacity: 1; }
  .svu-strips { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
  .svu-strip-f, .svu-strip-o { display: inline-flex; border-radius: var(--svu-r); overflow: hidden; }
  .svu-seg { display: inline-flex; align-items: center; gap: 3px; height: 20px; padding: 0 6px 0 5px; font-size: .7rem; line-height: 1; font-variant-numeric: tabular-nums; }
  .svu-seg b { font-weight: 700; }
  .svu-seg svg { width: 11px; height: 11px; flex: none; }
  .svu-strip-f .svu-seg { color: var(--svu-on); }
  .svu-strip-f .svu-seg + .svu-seg { box-shadow: inset 1px 0 0 color-mix(in srgb, var(--svu-on) 35%, transparent); }
  .svu-strip-f .svu-change { background: var(--svu-change); } .svu-strip-f .svu-comment { background: var(--svu-comment); }
  .svu-strip-f .svu-staff { background: var(--svu-staff); } .svu-strip-f .svu-kasper { background: var(--svu-kasper); }
  .svu-strip-o { box-shadow: inset 0 0 0 1px var(--border); }
  .svu-strip-o .svu-seg + .svu-seg { box-shadow: inset 1px 0 0 var(--border); }
  .svu-strip-o .svu-open { color: var(--svu-change-ink); } .svu-strip-o .svu-waiting { color: var(--svu-comment-ink); }
  .svu-strip-more { font-size: .7rem; font-weight: 700; color: var(--text-secondary); padding: 0 2px; }
  /* the hover */
  .svu-pv { position: fixed; z-index: 9999; background: var(--white); color: var(--text-primary); border: 1px solid var(--border); border-radius: var(--svu-r); box-shadow: 0 10px 30px rgba(0,0,0,.14); padding: 4px 0; font-size: .78rem; }
  .svu-pv-row { display: grid; grid-template-columns: 16px auto 1fr auto; column-gap: 8px; row-gap: 1px; align-items: baseline; padding: 7px 12px; }
  .svu-pv-row + .svu-pv-row { border-top: 1px solid var(--svu-hair); }
  .svu-pv-ico svg { width: 12px; height: 12px; display: block; transform: translateY(2px); }
  .svu-k-change .svu-pv-ico, .svu-k-open .svu-pv-ico { color: var(--svu-change-ink); } .svu-k-comment .svu-pv-ico, .svu-k-waiting .svu-pv-ico { color: var(--svu-comment-ink); }
  .svu-k-staff .svu-pv-ico { color: var(--svu-staff-ink); } .svu-k-kasper .svu-pv-ico { color: var(--svu-kasper-ink); }
  .svu-pv-who { font-weight: 700; }
  .svu-pv-what { color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .svu-pv-time { color: var(--text-muted); font-size: .7rem; }
  .svu-pv-text { grid-column: 2 / 5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-primary); }
  .svu-pv-foot, .svu-pv-empty { padding: 7px 12px 5px; border-top: 1px solid var(--svu-hair); color: var(--text-secondary); font-size: .74rem; }
  .svu-tip-head { padding: 6px 12px 6px; font-weight: 700; }
  .svu-tip-row { grid-template-columns: 16px 1fr; border-top: 1px solid var(--svu-hair); }
  .svu-tip-text { color: var(--text-primary); }
  /* the Messages button count: square */
  .msg-nav-btn > .msg-unread.svu-count { border-radius: var(--svu-r); box-shadow: 0 0 0 2px var(--white); }
  .msg-unread.svu-count-comment { background: var(--svu-comment); color: var(--svu-on); } .msg-unread.svu-count-staff { background: var(--svu-staff); color: var(--svu-on); }
  .msg-unread.svu-count-kasper { background: var(--svu-kasper); color: var(--svu-on); }
  .msg-unread.svu-count-waiting { background: var(--white); color: var(--svu-comment-ink); box-shadow: 0 0 0 2px var(--white), inset 0 0 0 1px var(--svu-comment); }
  /* buttons and tags: square, quiet */
  .svu-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); background: var(--white); color: var(--text-primary); border-radius: var(--svu-r); padding: 4px 10px; font: inherit; font-size: .74rem; font-weight: 600; cursor: pointer; }
  .svu-btn.svu-primary { background: var(--text-primary); color: var(--white); border-color: var(--text-primary); }
  .svu-text-btn { border: 0; background: transparent; color: var(--text-secondary); font: inherit; font-size: .74rem; font-weight: 600; padding: 4px 6px; cursor: pointer; border-radius: var(--svu-r); }
  .svu-text-btn:hover { color: var(--text-primary); background: var(--svu-tint); }
  .svu-tags { display: inline-flex; gap: 6px; align-items: baseline; }
  .svu-tag { font-size: .62rem; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; line-height: 1.5; }
  .svu-t-change { color: var(--svu-change-ink); } .svu-t-comment { color: var(--svu-comment-ink); } .svu-t-staff { color: var(--svu-staff-ink); } .svu-t-kasper { color: var(--svu-kasper-ink); }
  .svu-t-waiting { color: var(--svu-comment-ink); box-shadow: inset 0 0 0 1px var(--svu-comment); padding: 0 5px; border-radius: var(--svu-r); }
  .svu-t-open { color: var(--svu-change-ink); box-shadow: inset 0 0 0 1px var(--svu-change); padding: 0 5px; border-radius: var(--svu-r); }
  .svu-t-plain { color: var(--text-muted); }
  .svu-row-acts { display: flex; gap: 4px; align-items: center; margin-top: 8px; }

  /* ---- Notes, calm ---- */
  html.svu4 .cal-comments-modal { border-radius: var(--svu-r) !important; }
  html.svu4 .cal-comments-modal *:not(.svu-seg):not(.cal-comments-close) { border-radius: var(--svu-r); }
  html.svu4 .cal-comments-head { padding-bottom: 10px; }
  html.svu4 .svu-need { border-top: 1px solid var(--svu-hair); border-bottom: 1px solid var(--svu-hair); padding: 6px 0 4px; }
  html.svu4 .svu-need-head { display: flex; justify-content: space-between; align-items: center; padding: 0 20px 2px; font-size: .62rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--text-muted); }
  html.svu4 .svu-need-row { display: grid; grid-template-columns: 14px auto 1fr auto; gap: 8px; align-items: baseline; width: 100%; border: 0; background: transparent; text-align: left; font: inherit; font-size: .78rem; padding: 5px 20px; cursor: pointer; color: var(--text-primary); }
  html.svu4 .svu-need-row:hover { background: var(--svu-tint); }
  html.svu4 .svu-need-ico svg { width: 12px; height: 12px; display: block; transform: translateY(2px); }
  html.svu4 .svu-need-row.svu-k-change .svu-need-ico, html.svu4 .svu-need-row.svu-k-open .svu-need-ico { color: var(--svu-change-ink); }
  html.svu4 .svu-need-row.svu-k-comment .svu-need-ico, html.svu4 .svu-need-row.svu-k-waiting .svu-need-ico { color: var(--svu-comment-ink); }
  html.svu4 .svu-need-row.svu-k-staff .svu-need-ico { color: var(--svu-staff-ink); } html.svu4 .svu-need-row.svu-k-kasper .svu-need-ico { color: var(--svu-kasper-ink); }
  html.svu4 .svu-need-label { font-weight: 700; white-space: nowrap; }
  html.svu4 .svu-need-text { color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  html.svu4 .svu-need-part, html.svu4 .svu-need-more { color: var(--text-muted); font-size: .7rem; }
  html.svu4 .svu-need-more { padding: 2px 20px 4px; }
  html.svu4 .cal-cm-thread { border: 0; border-top: 1px solid var(--svu-hair); background: transparent; box-shadow: none; padding: 12px 0 10px; margin: 0; }
  html.svu4 .cal-comments-feed-inner > .cal-cm-thread:first-child { border-top: 0; }
  html.svu4 .cal-cm-avatar { display: none; }
  html.svu4 .cal-cm-row { padding-left: 12px; box-shadow: inset 2px 0 0 var(--svu-hair); background: transparent; }
  html.svu4 .cal-cm-row[data-svu-kind="change"] { box-shadow: inset 2px 0 0 var(--svu-change); }
  html.svu4 .cal-cm-row[data-svu-kind="comment"] { box-shadow: inset 2px 0 0 var(--svu-comment); }
  html.svu4 .cal-cm-row[data-svu-kind="kasper"] { box-shadow: inset 2px 0 0 var(--svu-kasper); }
  html.svu4 .cal-cm-row[data-svu-kind="staff"] { box-shadow: inset 2px 0 0 var(--svu-staff); }
  html.svu4 .cal-cm-row[data-svu-kind="auto"] { box-shadow: none; opacity: .75; }
  html.svu4 .cal-cm-row.svu-flash { background: var(--svu-tint); }
  html.svu4 .cal-cm-row.is-reply { margin-left: 18px; }
  html.svu4 .cal-cm-head-line { gap: 8px; align-items: baseline; }
  html.svu4 .cal-cm-author { font-weight: 700; }
  html.svu4 .cal-cm-time, html.svu4 .cal-cm-comp-label { color: var(--text-muted); font-weight: 500; font-size: .7rem; letter-spacing: 0; text-transform: none; }
  html.svu4 .cal-cm-type-tag, html.svu4 .cal-cm-to-tag { background: transparent !important; padding: 0 !important; font-size: .62rem; letter-spacing: .05em; text-transform: uppercase; color: var(--text-muted) !important; box-shadow: none; }
  html.svu4 .cal-cm-type-tag.is-tweak { color: var(--svu-change-ink) !important; }
  html.svu4 .cal-cm-row-body { font-size: .86rem; line-height: 1.5; }
  html.svu4 .cal-cm-replies { border-left: 0; }
  html.svu4 .cal-cm-rail { display: none; }
  html.svu4 .cal-cm-composer, html.svu4 .cal-cm-composer textarea { border-radius: var(--svu-r) !important; }

  /* ---- Messages, calm ---- */
  html.svu4 #msgPage *:not(.svu-seg):not(.msg-unread) { border-radius: var(--svu-r); }
  html.svu4 #msgPage .msg-inbox { border-radius: var(--svu-r); }
  html.svu4 #msgPage .msg-filters { display: flex; gap: 18px; background: transparent; border: 0; border-bottom: 1px solid var(--svu-hair); padding: 0 16px; margin: 0; box-shadow: none; }
  html.svu4 #msgPage .msg-filters button { flex: none; background: transparent !important; border: 0; box-shadow: none !important; padding: 12px 0 10px; color: var(--text-secondary); font-weight: 600; font-size: .8rem; border-radius: 0; }
  html.svu4 #msgPage .msg-filters button span { color: var(--text-muted); font-weight: 600; margin-left: 2px; }
  html.svu4 #msgPage .msg-filters button.is-active { color: var(--text-primary); box-shadow: inset 0 -2px 0 var(--text-primary) !important; }
  html.svu4 #msgPage .svu-conv { display: flex; gap: 12px; align-items: flex-start; padding: 12px 16px; border: 0; border-bottom: 1px solid var(--svu-hair); background: transparent; width: 100%; text-align: left; }
  html.svu4 #msgPage .svu-conv:hover { background: var(--svu-tint); }
  html.svu4 #msgPage .svu-conv.is-active { background: var(--svu-tint); box-shadow: inset 2px 0 0 var(--text-primary); }
  html.svu4 .svu-conv-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
  html.svu4 .svu-conv-top { display: flex; justify-content: space-between; gap: 10px; }
  html.svu4 .svu-conv-title { font-size: .84rem; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  html.svu4 .svu-conv.is-unread .svu-conv-title { font-weight: 800; }
  html.svu4 .svu-conv-time { font-size: .7rem; color: var(--text-muted); white-space: nowrap; }
  html.svu4 .svu-conv-client { font-size: .7rem; color: var(--text-muted); }
  html.svu4 .svu-conv-last { font-size: .78rem; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  html.svu4 .svu-conv.is-unread .svu-conv-last { color: var(--text-primary); }
  html.svu4 .svu-conv-badge { align-self: center; display: inline-flex; gap: 4px; }
  html.svu4 #msgPage .msg-chat-head { border-bottom: 1px solid var(--svu-hair); }
  html.svu4 #msgPage .msg-chat-head .msg-thumb { display: none; }
  html.svu4 #msgPage .msg-act { border-radius: var(--svu-r); }
  html.svu4 #msgPage .msg-bubbles { background: var(--white); padding: 4px 24px 16px; gap: 0; }
  html.svu4 #msgPage .msg-day { text-align: left; font-size: .62rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--text-muted); padding: 18px 0 6px; background: transparent; }
  html.svu4 #msgPage .msg-b { max-width: none; width: 100%; align-self: stretch; padding: 10px 0 10px 12px; border-top: 1px solid var(--svu-hair); box-shadow: inset 2px 0 0 var(--svu-hair); margin: 0; }
  html.svu4 #msgPage .msg-b[data-svu-kind="comment"] { box-shadow: inset 2px 0 0 var(--svu-comment); }
  html.svu4 #msgPage .msg-b[data-svu-kind="staff"] { box-shadow: inset 2px 0 0 var(--svu-staff); }
  html.svu4 #msgPage .msg-b[data-svu-kind="kasper"] { box-shadow: inset 2px 0 0 var(--svu-kasper); }
  html.svu4 #msgPage .msg-b[data-svu-kind="me"] { box-shadow: inset 2px 0 0 var(--text-primary); }
  html.svu4 #msgPage .msg-b[data-svu-kind="auto"] { box-shadow: none; opacity: .7; }
  html.svu4 #msgPage .msg-b.is-me { align-self: stretch; }
  html.svu4 #msgPage .msg-b.is-reply { margin-left: 18px; width: calc(100% - 18px); }
  html.svu4 #msgPage .msg-b-meta { justify-content: flex-start !important; gap: 8px; align-items: baseline; font-size: .7rem; color: var(--text-muted); }
  html.svu4 #msgPage .msg-b-meta b { color: var(--text-primary); font-size: .8rem; }
  html.svu4 #msgPage .msg-b-text, html.svu4 #msgPage .msg-b.is-me .msg-b-text { background: transparent !important; color: var(--text-primary) !important; padding: 2px 0 0 !important; box-shadow: none !important; font-size: .86rem; line-height: 1.5; max-width: 70ch; }
  html.svu4 #msgPage .msg-b .cal-cm-type-tag, html.svu4 #msgPage .msg-b .cal-cm-to-tag { background: transparent !important; padding: 0 !important; font-size: .62rem; letter-spacing: .05em; text-transform: uppercase; color: var(--text-muted) !important; }
  html.svu4 #msgPage .msg-b-reply { display: none; }
  html.svu4 #msgPage .msg-b-text { border: 0 !important; }
  html.svu4 #msgPage .msg-b-meta b + span:not([class]) { display: none; }
  html.svu4 #msgPage .cal-cm-to-tag.is-client, html.svu4 .cal-comments-modal .cal-cm-to-tag.is-client { display: none; }
  html.svu4 #msgPage .msg-reply-cap .cal-cm-to-tag { display: none; }
  html.svu4 #msgPage .thumb-msg-new { color: var(--svu-comment-ink); }
  html.svu4 .svu-change-line { display: flex; align-items: baseline; gap: 8px; padding: 10px 0 10px 12px; border-top: 1px solid var(--svu-hair); box-shadow: inset 2px 0 0 var(--svu-change); color: var(--svu-change-ink); font-size: .8rem; width: 100%; }
  html.svu4 .svu-change-line svg { width: 12px; height: 12px; flex: none; transform: translateY(1px); }
  html.svu4 .svu-change-line .svu-text-btn { margin-left: auto; color: var(--text-primary); }
  html.svu4 #msgPage .msg-reply { border-top: 1px solid var(--svu-hair); }
  `;

  function apply() {
    document.documentElement.classList.add('svu4');
    if (!document.getElementById('svu-style')) {
      const st = document.createElement('style'); st.id = 'svu-style'; st.textContent = CSS_TEXT; document.head.appendChild(st);
    }
    window._calCommentsBtnHtml = notesBtnHtml;
    const origOpen = window.openCalComments;
    if (!origOpen.__svu) {
      window.openCalComments = function (pid) {
        notesSnap = { pid, seen: markedUnread.has(pid) ? '' : (_notesGetSeen(pid) || '') };
        markedUnread.delete(pid);
        hideHover();
        const r = origOpen.apply(this, arguments);
        setTimeout(decorateNotes, 0);
        return r;
      };
      window.openCalComments.__svu = true;
    }
    const mo = new MutationObserver(() => { mo.disconnect(); try { decorateNotes(); } catch (e) {} mo.observe(document.body, { childList: true, subtree: true }); });
    mo.observe(document.body, { childList: true, subtree: true });
    const nb = document.getElementById('navMessages');
    if (nb && !nb.__svu) { nb.__svu = true; nb.removeAttribute('title'); nb.addEventListener('pointerenter', showButtonTip); nb.addEventListener('pointerleave', hideButtonTip); }
    refresh();
  }

  window.svUnreadPreview = { apply, hoverCard, hideHover, noReply: noReplyAction, markUnread, jump, showButtonTip, hideButtonTip, stateOf, refresh };
})();
