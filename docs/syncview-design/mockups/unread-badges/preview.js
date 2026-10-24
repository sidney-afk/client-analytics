/* Unread badges preview, round 5 (session Beacon, 2026-10-24). LOCAL ONLY, DESKTOP: loaded into the real page by make-screenshots.js,
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
  /* Fictional picture avatars. In the real build a staff member's comes from their Slack profile photo and a client's
     from the client's logo; these stand in because the repository is public. */
  const hueOf = name => { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  const AV = new Map();
  function avatarSrc(m) {
    const key = isClient(m) ? 'client' : String(m && m.author || 'Team');
    if (AV.has(key)) return AV.get(key);
    let svg;
    if (key === 'client') {
      svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0f766e"/><circle cx="32" cy="32" r="17" fill="none" stroke="#99f6e4" stroke-width="5"/><circle cx="32" cy="32" r="6" fill="#99f6e4"/></svg>';
    } else {
      const h = role(m) === 'kasper' ? 262 : hueOf(key);
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},60%,70%)"/><stop offset="1" stop-color="hsl(${(h + 35) % 360},55%,48%)"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><circle cx="32" cy="25" r="12" fill="hsl(${h},45%,93%)"/><path d="M9 66c2-15 11-22 23-22s21 7 23 22z" fill="hsl(${h},45%,93%)"/></svg>`;
    }
    const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    AV.set(key, src);
    return src;
  }
  const avatar = (m, cls) => `<img class="${cls || 'svu-av'}" src="${avatarSrc(m)}" alt="">`;
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const SAY = {
    change: n => plural(n, 'new change request', 'new change requests'), open: n => plural(n, 'change request not done yet', 'change requests not done yet'),
    comment: n => plural(n, 'new comment from the client', 'new comments from the client'), waiting: n => plural(n, 'comment waiting for your answer', 'comments waiting for your answer'),
    staff: n => plural(n, 'new message from the team', 'new messages from the team'), kasper: n => plural(n, 'new message from Kasper', 'new messages from Kasper'),
  };

  /* ---------- the badge: one bubble per person ----------
     Each person with something for you gets their picture in a round bubble with a number beside it. The number's
     colour says what it is: filled orange = new change request, blue = new comment, grey = new from the team,
     violet = Kasper; an outlined number = read, but still needs you (a change not done, a comment to answer).
     Newest first, at most three people, then "+N". The hover says it in words. */
  const RANK = { change: 4, comment: 3, kasper: 2, staff: 1 };
  function peopleOf(post, live) {
    const s = live || stateOf(post);
    const notes = notesOf(post);
    const by = new Map();
    const get = m => { const k = isClient(m) ? 'client' : String(m.author || 'Team'); if (!by.has(k)) by.set(k, { m, nNew: 0, kind: '', nOut: 0, outKind: '', last: '' }); return by.get(k); };
    for (const it of s.items) {
      if (it.kind === 'waiting') continue;
      const g = get(it.n.m); g.nNew++; if (!g.kind || RANK[it.kind] > RANK[g.kind]) g.kind = it.kind;
      if (String(it.n.m.created_at) > g.last) g.last = String(it.n.m.created_at);
    }
    for (const n of notes) {
      if (n.m !== n.root || s.newIds.has(n.m.id)) continue;
      const out = s.waitingIds.has(n.m.id) ? 'waiting' : (s.openIds.has(n.m.id) ? 'open' : '');
      if (!out) continue;
      const g = get(n.m); g.nOut++; if (!g.outKind || out === 'open') g.outKind = out;
      if (String(n.m.created_at) > g.last) g.last = String(n.m.created_at);
    }
    return [...by.values()].sort((x, y) => (y.nNew > 0) - (x.nNew > 0) || y.last.localeCompare(x.last));
  }
  function bubblesHtml(people, max) {
    const limit = max || 3;
    const shown = people.slice(0, limit), rest = people.length - shown.length;
    return shown.map(g => `<span class="svu-bub">${avatar(g.m, 'svu-bub-av')}${g.nNew ? `<b class="svu-num svu-n-${g.kind}">${g.nNew}</b>` : ''}${g.nOut ? `<b class="svu-num svu-o-${g.outKind}">${g.nOut}</b>` : ''}</span>`).join('')
      + (rest ? `<span class="svu-bub-more">+${rest}</span>` : '');
  }
  function badgeHtml(s, max, post) { return post ? bubblesHtml(peopleOf(post, s), max) : ''; }

  /* ---------- Calendar card: the Notes button ---------- */
  const NOTES_ICO = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.5h11v8H7l-3 2.5V11.5H2.5z"/></svg>';
  function notesBtnHtml(post, pid) {
    const s = stateOf(post);
    const any = s.change + s.comment + s.staff + s.kasper > 0;
    const strip = badgeHtml(s, 3, post);
    return `<span class="cal-foot-tweaks svu-foot" data-comments-wrap="${pid}" onpointerenter="svUnreadPreview.hoverCard('${pid}', this)" onpointerleave="svUnreadPreview.hideHover()"><button type="button" class="cal-comments-btn svu-notes${any ? ' svu-has-new' : ''}" data-comments-btn="${pid}" onclick="openCalComments('${pid}')" aria-label="Notes">${NOTES_ICO}<span class="cal-comments-label">Notes</span></button>${strip ? `<span class="svu-strips" onclick="openCalComments('${pid}')">${strip}</span>` : ''}</span>`;
  }

  /* ---------- the hover: who and what, at once ---------- */
  const WHO = m => isClient(m) ? 'Client' : (role(m) === 'kasper' ? 'Kasper' : String(m.author || 'Team').split(' ')[0]);
  const WHAT = { change: 'Change request', comment: 'Comment', waiting: 'Waiting for your answer', staff: 'Team note', kasper: 'Team note' };
  const whatOf = (kind, m) => (kind === 'staff' || kind === 'kasper') && String(m.audience || '') === 'client' ? 'Reply to the client' : WHAT[kind];
  function hoverHtml(post) {
    const s = stateOf(post);
    const lines = s.items.slice(0, 5).map(({ kind, n }) => `<div class="svu-pv-row svu-k-${kind}"><span class="svu-pv-ico">${avatar(n.m, 'svu-pv-av')}</span><span class="svu-pv-who">${_calEsc(WHO(n.m))}</span><span class="svu-pv-what">${_calEsc(whatOf(kind, n.m))} · ${_calEsc(LABEL(n.comp))}</span><span class="svu-pv-time">${_calEsc(_calFmtCommentTime(n.m.created_at))}</span><span class="svu-pv-text">${_calEsc(n.m.body || '')}</span></div>`).join('');
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
      const av = row.querySelector('.cal-cm-avatar');
      if (av && !av.querySelector('img')) av.innerHTML = avatar(n.m, 'svu-slack-av');
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
  // The badge on an inbox row: one bubble per person with something new, numbers in the kind's colour.
  function convBubbles(c, s) {
    const by = new Map();
    for (const m of c.messages || []) {
      if (!s.newIds.has(m.id) && !s.waitingIds.has(m.id)) continue;
      const k = isClient(m) ? 'client' : String(m.author || 'Team');
      if (!by.has(k)) by.set(k, { m, nNew: 0, kind: '', nOut: 0, outKind: '', last: '' });
      const g = by.get(k);
      if (s.newIds.has(m.id)) { g.nNew++; const kk = isClient(m) ? 'comment' : role(m) === 'kasper' ? 'kasper' : 'staff'; if (!g.kind || RANK[kk] > RANK[g.kind]) g.kind = kk; }
      else { g.nOut++; g.outKind = 'waiting'; }
      if (String(m.created_at) > g.last) g.last = String(m.created_at);
    }
    return bubblesHtml([...by.values()].sort((x, y) => (y.nNew > 0) - (x.nNew > 0) || y.last.localeCompare(x.last)), 2);
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
        ${avatar({ role: 'client' }, 'svu-conv-av')}
        <span class="svu-conv-main">
          <span class="svu-conv-top"><span class="svu-conv-title">${_calEsc(c.title || 'Untitled post')}</span><span class="svu-conv-time">${_calEsc(_calFmtCommentTime(last.created_at || c.last_at))}</span></span>
          <span class="svu-conv-client">${_calEsc(_msgClientName(c))}</span>
          <span class="svu-conv-last">${_calEsc(who + ': ' + (last.body || ''))}</span>
        </span>
        <span class="svu-conv-badge">${convBubbles(c, s)}</span>
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
        if (m.root_id === m.id) b.outerHTML = `<div class="svu-change-line">${avatar(m, 'svu-line-av')}<span>The client asked for a change on the ${_calEsc(String(LABEL(m.component || 'video')).toLowerCase())}. Change requests are handled on the card.</span><button type="button" class="svu-text-btn" onclick="_msgOpenCard()">Open card</button></div>`;
        else b.remove();
        return;
      }
      const k = isAuto(m) ? 'auto' : isMine(m) ? 'me' : isClient(m) ? 'comment' : role(m) === 'kasper' ? 'kasper' : 'staff';
      b.setAttribute('data-svu-kind', k);
      if (!b.querySelector('.svu-slack-av')) b.insertAdjacentHTML('afterbegin', avatar(isMine(m) ? { author: 'You' } : m, 'svu-slack-av'));
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

  /* ---------- styles: Slack-like and rounded (owner, 2026-10-24), our colours on the numbers and tags ---------- */
  const CSS_TEXT = `
  :root { --svu-change: #e8590c; --svu-change-ink: #c2410c; --svu-change-soft: #fff1e6; --svu-comment: #1d6ae5; --svu-comment-ink: #1d4ed8; --svu-comment-soft: #e8f0fe;
    --svu-staff: #616061; --svu-staff-ink: #3f3f46; --svu-staff-soft: #f0f0f1; --svu-kasper: #6c5ce7; --svu-kasper-ink: #5a4bd1; --svu-kasper-soft: #f0eeff;
    --svu-on: #fff; --svu-hover: #f8f8f8; --svu-send: #007a5a; --svu-send-on: #fff; --svu-link: #1264a3; --svu-hair: var(--border-light); }
  html[data-theme="dark"] { --svu-change: #fb923c; --svu-change-ink: #fdba74; --svu-change-soft: rgba(251,146,60,.16); --svu-comment: #60a5fa; --svu-comment-ink: #93c5fd; --svu-comment-soft: rgba(96,165,250,.16);
    --svu-staff: #a1a1aa; --svu-staff-ink: #d4d4d8; --svu-staff-soft: rgba(212,212,216,.14); --svu-kasper: #a094f8; --svu-kasper-ink: #c3b5ff; --svu-kasper-soft: rgba(160,148,248,.18);
    --svu-on: #101114; --svu-hover: rgba(255,255,255,.04); --svu-send: #2bac76; --svu-send-on: #0b1a12; --svu-link: #6fb3f5; }
  /* the badge: people bubbles with a coloured number */
  .svu-foot { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .cal-comments-btn.svu-notes.svu-has-new { color: var(--text-primary); font-weight: 600; }
  .cal-comments-btn.svu-notes.svu-has-new svg { opacity: 1; }
  .svu-strips { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
  .svu-bub { display: inline-flex; align-items: center; gap: 3px; }
  .svu-bub-av { width: 22px; height: 22px; border-radius: 50%; display: block; box-shadow: 0 0 0 2px var(--white); }
  .svu-num { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 99px; display: inline-flex; align-items: center; justify-content: center; font-size: .68rem; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; color: var(--svu-on); }
  .svu-n-change { background: var(--svu-change); } .svu-n-comment { background: var(--svu-comment); } .svu-n-staff { background: var(--svu-staff); } .svu-n-kasper { background: var(--svu-kasper); }
  .svu-o-open { background: transparent; color: var(--svu-change-ink); box-shadow: inset 0 0 0 1.5px var(--svu-change); }
  .svu-o-waiting { background: transparent; color: var(--svu-comment-ink); box-shadow: inset 0 0 0 1.5px var(--svu-comment); }
  .svu-bub-more { font-size: .72rem; font-weight: 700; color: var(--text-secondary); }
  /* the hover */
  .svu-pv { position: fixed; z-index: 9999; background: var(--white); color: var(--text-primary); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,.16); padding: 6px 0; font-size: .8rem; }
  .svu-pv-row { display: grid; grid-template-columns: 28px auto 1fr auto; column-gap: 8px; row-gap: 1px; align-items: baseline; padding: 7px 12px; }
  .svu-pv-ico { grid-row: 1 / 3; align-self: start; }
  .svu-pv-av { width: 28px; height: 28px; border-radius: 6px; display: block; }
  .svu-pv-ico svg { width: 14px; height: 14px; display: block; transform: translateY(3px); }
  .svu-k-change .svu-pv-what { color: var(--svu-change-ink); } .svu-k-comment .svu-pv-what, .svu-k-waiting .svu-pv-what { color: var(--svu-comment-ink); }
  .svu-k-kasper .svu-pv-what { color: var(--svu-kasper-ink); }
  .svu-k-staff .svu-pv-ico, .svu-k-staff .svu-pv-what { color: var(--svu-staff-ink); } .svu-k-kasper .svu-pv-ico { color: var(--svu-kasper-ink); }
  .svu-k-comment .svu-pv-ico, .svu-k-waiting .svu-pv-ico { color: var(--svu-comment-ink); }
  .svu-pv-who { font-weight: 800; }
  .svu-pv-what { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .svu-pv-time { color: var(--text-muted); font-size: .72rem; }
  .svu-pv-text { grid-column: 2 / 5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-primary); }
  .svu-pv-foot, .svu-pv-empty { padding: 7px 12px 4px; border-top: 1px solid var(--svu-hair); color: var(--text-secondary); font-size: .76rem; }
  .svu-tip-head { padding: 6px 12px 6px; font-weight: 800; }
  .svu-tip-row { grid-template-columns: 16px 1fr; }
  .svu-tip-row .svu-pv-ico { grid-row: auto; }
  .svu-tip-text { color: var(--text-primary); }
  /* the Messages button count: a round pill */
  .msg-nav-btn > .msg-unread.svu-count { border-radius: 99px; box-shadow: 0 0 0 2px var(--white); }
  .msg-unread.svu-count-comment { background: var(--svu-comment); color: var(--svu-on); } .msg-unread.svu-count-staff { background: var(--svu-staff); color: var(--svu-on); }
  .msg-unread.svu-count-kasper { background: var(--svu-kasper); color: var(--svu-on); }
  .msg-unread.svu-count-waiting { background: var(--white); color: var(--svu-comment-ink); box-shadow: 0 0 0 2px var(--white), inset 0 0 0 1.5px var(--svu-comment); }
  /* buttons and tags */
  .svu-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); background: var(--white); color: var(--text-primary); border-radius: 6px; padding: 4px 12px; font: inherit; font-size: .78rem; font-weight: 700; cursor: pointer; }
  .svu-btn:hover { background: var(--svu-hover); }
  .svu-btn.svu-primary { background: var(--svu-send); color: var(--svu-send-on); border-color: var(--svu-send); }
  .svu-text-btn { border: 0; background: transparent; color: var(--svu-link); font: inherit; font-size: .78rem; font-weight: 600; padding: 4px 6px; cursor: pointer; border-radius: 6px; }
  .svu-text-btn:hover { background: var(--svu-hover); text-decoration: underline; }
  .svu-tags { display: inline-flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .svu-tag { font-size: .68rem; font-weight: 700; line-height: 1; padding: 3px 7px; border-radius: 99px; }
  .svu-t-change { background: var(--svu-change); color: var(--svu-on); } .svu-t-comment { background: var(--svu-comment); color: var(--svu-on); }
  .svu-t-staff { background: var(--svu-staff); color: var(--svu-on); } .svu-t-kasper { background: var(--svu-kasper); color: var(--svu-on); }
  .svu-t-me { background: var(--svu-staff-soft); color: var(--svu-staff-ink); }
  .svu-t-waiting { background: var(--svu-comment-soft); color: var(--svu-comment-ink); }
  .svu-t-open { background: var(--svu-change-soft); color: var(--svu-change-ink); }
  .svu-t-plain { background: var(--svu-staff-soft); color: var(--text-secondary); }
  .svu-row-acts { display: flex; gap: 8px; align-items: center; margin-top: 8px; }

  /* ---- Notes on a card, Slack-like ---- */
  html.svu5 .svu-need { margin: 10px 16px 4px; padding: 8px 4px 6px; border: 1px solid var(--border); border-radius: 10px; background: var(--white); }
  html.svu5 .svu-need-head { display: flex; justify-content: space-between; align-items: center; padding: 0 10px 4px; font-size: .78rem; font-weight: 800; color: var(--text-primary); }
  html.svu5 .svu-need-row { display: grid; grid-template-columns: 16px auto 1fr auto; gap: 8px; align-items: baseline; width: 100%; border: 0; background: transparent; text-align: left; font: inherit; font-size: .8rem; padding: 5px 10px; cursor: pointer; color: var(--text-primary); border-radius: 6px; }
  html.svu5 .svu-need-row:hover { background: var(--svu-hover); }
  html.svu5 .svu-need-ico svg { width: 13px; height: 13px; display: block; transform: translateY(2px); }
  html.svu5 .svu-need-row.svu-k-change .svu-need-ico, html.svu5 .svu-need-row.svu-k-open .svu-need-ico { color: var(--svu-change-ink); }
  html.svu5 .svu-need-row.svu-k-comment .svu-need-ico, html.svu5 .svu-need-row.svu-k-waiting .svu-need-ico { color: var(--svu-comment-ink); }
  html.svu5 .svu-need-row.svu-k-staff .svu-need-ico { color: var(--svu-staff-ink); } html.svu5 .svu-need-row.svu-k-kasper .svu-need-ico { color: var(--svu-kasper-ink); }
  html.svu5 .svu-need-label { font-weight: 700; white-space: nowrap; }
  html.svu5 .svu-need-text { color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  html.svu5 .svu-need-part, html.svu5 .svu-need-more { color: var(--text-muted); font-size: .72rem; }
  html.svu5 .svu-need-more { padding: 2px 10px 2px; }
  html.svu5 .cal-cm-thread { border: 0; background: transparent; box-shadow: none; padding: 0; margin: 0; }
  html.svu5 .cal-cm-row { padding: 8px 20px 8px 20px; border-radius: 0; background: transparent; position: relative; column-gap: 10px; }
  html.svu5 .cal-cm-row:hover { background: var(--svu-hover); }
  html.svu5 .cal-cm-row.svu-flash { background: var(--svu-comment-soft); }
  html.svu5 .cal-cm-avatar { width: 36px; height: 36px; border-radius: 8px; overflow: hidden; padding: 0; background: transparent; flex: none; }
  html.svu5 .svu-slack-av { width: 36px; height: 36px; border-radius: 8px; display: block; }
  html.svu5 .cal-cm-row.is-reply { padding-left: 66px; }
  html.svu5 .cal-cm-row.is-reply .cal-cm-avatar, html.svu5 .cal-cm-row.is-reply .cal-cm-avatar .svu-slack-av { width: 24px; height: 24px; border-radius: 6px; }
  html.svu5 .cal-cm-head-line { gap: 8px; align-items: baseline; flex-wrap: wrap; }
  html.svu5 .cal-cm-author { font-weight: 800; font-size: .92rem; }
  html.svu5 .cal-cm-time { color: var(--text-muted); font-weight: 500; font-size: .72rem; }
  html.svu5 .cal-cm-comp-label { color: var(--text-muted); font-weight: 600; font-size: .7rem; letter-spacing: 0; text-transform: none; margin-left: auto; }
  html.svu5 .cal-cm-type-tag { background: var(--svu-change-soft) !important; color: var(--svu-change-ink) !important; border-radius: 99px; padding: 2px 7px !important; font-size: .66rem; }
  html.svu5 .cal-cm-to-tag { background: var(--svu-staff-soft) !important; color: var(--text-secondary) !important; border-radius: 99px; padding: 2px 7px !important; font-size: .66rem; }
  html.svu5 .cal-cm-to-tag.is-client { display: none; }
  html.svu5 .cal-cm-row-body { font-size: .9rem; line-height: 1.46; color: var(--text-primary); }
  html.svu5 .svu-tags { margin: 2px 0 2px; }
  /* Slack's hover toolbar: a small floating box at the top right of the message */
  html.svu5 .cal-cm-actions { position: absolute; top: -14px; right: 18px; background: var(--white); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.08); padding: 2px; gap: 0; }
  html.svu5 .cal-cm-action { border-radius: 6px; }
  /* "N replies" under a thread, with who replied */
  html.svu5 .cal-cm-replies { border: 0; margin: 0; padding: 0; }
  html.svu5 .cal-cm-rail { display: none; }
  html.svu5 .cal-cm-more-replies { display: inline-flex; align-items: center; gap: 6px; margin: 0 0 6px 66px; padding: 4px 8px 4px 4px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--svu-link); font: inherit; font-size: .78rem; font-weight: 800; cursor: pointer; }
  html.svu5 .cal-cm-more-replies:hover { border-color: var(--border); background: var(--white); }
  html.svu5 .cal-cm-more-replies img { width: 22px; height: 22px; border-radius: 5px; }
  html.svu5 .cal-cm-more-replies .svu-last { color: var(--text-muted); font-weight: 500; }
  /* the message box, like Slack's */
  html.svu5 .cal-cm-composer { border: 1px solid var(--border) !important; border-radius: 10px !important; background: var(--white) !important; box-shadow: none !important; }
  html.svu5 .cal-cm-composer:focus-within { border-color: var(--text-secondary) !important; }
  html.svu5 .cal-cm-composer textarea { border-radius: 10px !important; }
  html.svu5 .cal-cm-send { background: var(--svu-send) !important; color: var(--svu-send-on) !important; border-radius: 6px !important; }
  html.svu5 .cal-cm-send:disabled { background: var(--svu-staff-soft) !important; color: var(--text-muted) !important; }
  html.svu5 .cal-cm-send-more { border-radius: 6px !important; }

  /* ---- Messages, Slack-like ---- */
  html.svu5 #msgPage .msg-filters { display: flex; gap: 4px; background: transparent; border: 0; padding: 8px 10px; margin: 0; box-shadow: none; }
  html.svu5 #msgPage .msg-filters button { flex: none; background: transparent !important; border: 0; box-shadow: none !important; padding: 5px 10px; color: var(--text-secondary); font-weight: 700; font-size: .8rem; border-radius: 6px; }
  html.svu5 #msgPage .msg-filters button span { color: var(--text-muted); font-weight: 700; margin-left: 2px; }
  html.svu5 #msgPage .msg-filters button.is-active { background: var(--svu-staff-soft) !important; color: var(--text-primary); }
  html.svu5 #msgPage .svu-conv { display: flex; gap: 10px; align-items: center; padding: 8px 10px; margin: 1px 8px; width: calc(100% - 16px); border: 0; border-radius: 8px; background: transparent; text-align: left; }
  html.svu5 #msgPage .svu-conv:hover { background: var(--svu-hover); }
  html.svu5 #msgPage .svu-conv.is-active { background: var(--svu-comment-soft); }
  html.svu5 .svu-conv-av { width: 36px; height: 36px; border-radius: 8px; flex: none; }
  html.svu5 .svu-conv-main { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
  html.svu5 .svu-conv-top { display: flex; justify-content: space-between; gap: 10px; }
  html.svu5 .svu-conv-title { font-size: .86rem; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  html.svu5 .svu-conv.is-unread .svu-conv-title { font-weight: 800; }
  html.svu5 .svu-conv-time { font-size: .7rem; color: var(--text-muted); white-space: nowrap; }
  html.svu5 .svu-conv-client { display: none; }
  html.svu5 .svu-conv-last { font-size: .78rem; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  html.svu5 .svu-conv.is-unread .svu-conv-last { color: var(--text-primary); }
  html.svu5 .svu-conv-badge { display: inline-flex; gap: 6px; }
  html.svu5 #msgPage .msg-chat-head { border-bottom: 1px solid var(--svu-hair); }
  html.svu5 #msgPage .msg-act { border-radius: 6px; }
  html.svu5 #msgPage .msg-bubbles { background: var(--white); padding: 8px 0 16px; gap: 0; }
  html.svu5 #msgPage .msg-day { display: flex; align-items: center; gap: 12px; margin: 14px 0 6px; background: transparent; font-size: .74rem; font-weight: 700; color: var(--text-primary); }
  html.svu5 #msgPage .msg-day::before, html.svu5 #msgPage .msg-day::after { content: ''; flex: 1; border-top: 1px solid var(--svu-hair); }
  html.svu5 #msgPage .msg-b { display: grid; grid-template-columns: 36px 1fr; column-gap: 10px; max-width: none; width: 100%; align-self: stretch; padding: 8px 24px; margin: 0; border-radius: 0; }
  html.svu5 #msgPage .msg-b:hover { background: var(--svu-hover); }
  html.svu5 #msgPage .msg-b > :not(.svu-slack-av) { grid-column: 2; }
  html.svu5 #msgPage .msg-b > .svu-slack-av { grid-column: 1; grid-row: 1 / span 4; width: 36px; height: 36px; border-radius: 8px; }
  html.svu5 #msgPage .msg-b.is-me { align-self: stretch; }
  html.svu5 #msgPage .msg-b.is-reply { padding-left: 70px; grid-template-columns: 24px 1fr; }
  html.svu5 #msgPage .msg-b.is-reply > .svu-slack-av { width: 24px; height: 24px; border-radius: 6px; }
  html.svu5 #msgPage .msg-b-meta { justify-content: flex-start !important; gap: 8px; align-items: baseline; font-size: .72rem; color: var(--text-muted); flex-wrap: wrap; }
  html.svu5 #msgPage .msg-b-meta b { color: var(--text-primary); font-size: .9rem; font-weight: 800; }
  html.svu5 #msgPage .msg-b-meta b + span:not([class]) { display: none; }
  html.svu5 #msgPage .msg-b-meta > * { margin-left: 0 !important; }
  html.svu5 #msgPage .msg-b-text, html.svu5 #msgPage .msg-b.is-me .msg-b-text { background: transparent !important; color: var(--text-primary) !important; padding: 1px 0 0 !important; border: 0 !important; box-shadow: none !important; border-radius: 0 !important; font-size: .9rem; line-height: 1.46; max-width: 72ch; }
  html.svu5 #msgPage .cal-cm-to-tag { background: var(--svu-staff-soft) !important; color: var(--text-secondary) !important; border-radius: 99px; padding: 2px 7px !important; font-size: .66rem; }
  html.svu5 #msgPage .cal-cm-to-tag.is-client, html.svu5 #msgPage .msg-reply-cap .cal-cm-to-tag { display: none; }
  html.svu5 #msgPage .msg-b-reply { display: none; }
  html.svu5 #msgPage .thumb-msg-new { color: #e01e5a; }
  html.svu5 .svu-change-line { display: flex; align-items: center; gap: 10px; margin: 6px 24px; padding: 8px 12px; border-radius: 8px; background: var(--svu-change-soft); color: var(--svu-change-ink); font-size: .82rem; font-weight: 600; }
  html.svu5 .svu-line-av { width: 22px; height: 22px; border-radius: 6px; }
  html.svu5 .svu-change-line .svu-text-btn { margin-left: auto; }
  html.svu5 #msgPage .msg-reply { border-top: 0; padding: 0 24px 16px; }
  html.svu5 #msgPage .msg-reply .cal-cm-composer { border: 1px solid var(--border) !important; border-radius: 10px !important; background: var(--white) !important; }
  html.svu5 #msgPage .msg-reply .cal-cm-composer textarea { background: transparent !important; border: 0 !important; }
  html.svu5 #msgPage .msg-reply .cal-cm-send { background: var(--svu-send) !important; color: var(--svu-send-on) !important; border-radius: 6px !important; }
  html.svu5 #msgPage .msg-reply .cal-cm-send:disabled { background: var(--svu-staff-soft) !important; color: var(--text-muted) !important; }
  `;

  function apply() {
    document.documentElement.classList.add('svu5');
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
