/* In-page painters for the NEW parts. Runs inside the real app page. */
(function () {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const AUD = { v1: 'team', v3: 'team', o0: 'team', g1: 'client', c1: 'client' };
  const UNREAD = ['v3', 'g1'];
  const tag = (aud, LOCK) => aud === 'team' ? `<span class="cal-cm-to-tag is-team">${LOCK}To Kasper / team</span>` : `<span class="cal-cm-to-tag is-client">To client</span>`;

  window.decorateNotes = function (state, LOCK) {
    const root = document.getElementById('calCommentsModal');
    root.querySelectorAll('.cal-cm-row').forEach(row => {
      const id = row.getAttribute('data-cm-row');
      const head = row.querySelector('.cal-cm-head-line');
      const lock = head && head.querySelector('.cal-cm-lock'); if (lock) lock.remove();
      if (!row.classList.contains('is-reply') && head) {
        const aud = AUD[id] || (/^o/.test(id) ? 'team' : null);
        const t = head.querySelector('.cal-cm-time');
        if (aud && t) t.insertAdjacentHTML('beforebegin', tag(aud, LOCK));
        const tw = head.querySelector('.cal-cm-type-tag.is-tweak'); if (tw) tw.textContent = tw.textContent.replace('Tweak', 'Change request');
      }
      if (UNREAD.includes(id)) row.classList.add('is-unread');
    });
    const wrap = root.querySelector('.cal-cm-composer-wrap');
    wrap.querySelectorAll('[data-cm-toggle="audience"],[data-cm-toggle="tweak"]').forEach(e => e.remove());
    wrap.querySelectorAll('[data-cm-toggle="comp"] .cal-cm-aud-btn').forEach(bn => { if (/title/i.test(bn.dataset.comp || '')) bn.remove(); });
    const tweak = state === 'tweak', client = state === 'client';
    const seg = (cap, label, items) => `<div class="cal-cm-audience" role="group" aria-label="${label}"><span class="cal-cm-audience-cap">${cap}</span><div class="cal-cm-aud-seg">${items}</div></div>`;
    const btn = (on, html, dis) => `<button type="button" class="cal-cm-aud-btn${on ? ' is-active' : ''}"${dis ? ' disabled title="Change requests are always team only"' : ''}>${html}</button>`;
    const html = seg('This is a…', 'Comment or change request', btn(!tweak, 'Comment') + btn(tweak, 'Request change'))
      + seg('To', 'Who this is for', btn(!client, LOCK + 'Kasper / team') + btn(client, 'Client', tweak))
      + (client ? '<div class="cal-cm-client-warn">The client will see this on their link.</div>' : '');
    const comp = wrap.querySelector('[data-cm-toggle="comp"]');
    if (comp) comp.insertAdjacentHTML('beforebegin', html); else wrap.insertAdjacentHTML('afterbegin', html);
    const box = wrap.querySelector('.cal-cm-composer');
    if (box) box.classList.toggle('is-to-client', client), box.classList.toggle('is-tweak', tweak);
    const ta = wrap.querySelector('textarea');
    if (ta) ta.placeholder = tweak ? 'Describe the change you need…' : client ? 'Write to the client…' : 'Message to Kasper / the team…';
  };

  /* Messages inbox inside Kasper's real tab shell. */
  window.paintInbox = function (state, LOCK, arts) {
    const count = document.querySelector('[data-kasper-count="replies"]');
    if (count) { count.textContent = state === 'empty' ? '0' : '3'; count.classList.toggle('is-unread', state !== 'empty'); }
    const content = document.getElementById('kasperContent');
    if (state === 'empty') {
      content.innerHTML = `<div class="kasper-empty"><div class="kasper-empty-icon"><svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.5h11a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H7l-3 2.5V12H2.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/></svg></div><div class="kasper-empty-title">You're all caught up</div><div class="kasper-empty-sub">Notes sent to the team and client comments show up here. A conversation leaves the list once its post is posted.</div></div>`;
      return;
    }
    const convs = [
      { a: 0, client: 'Sample Bakery', title: 'Morning routine, 3 swaps', last: 'Mia: Can this one go out Friday instead of Thursday?', time: '11:00', n: 2, on: true },
      { a: 1, client: 'Northside Gym', title: 'Leg day myths', last: 'Client: The intro feels too long', time: '10:47', n: 1 },
      { a: 2, client: 'Green Leaf Cafe', title: 'Thumbnail test B', last: 'Alex: Which of the two covers?', time: 'Yesterday', n: 1 },
      { a: 3, client: 'Sample Bakery', title: 'Behind the counter', last: 'You: Looks good, ship it', time: 'Mon' },
      { a: 4, client: 'Northside Gym', title: 'Coach Q&A part 2', last: 'Client: Thanks team!', time: 'Sun' }
    ];
    const list = convs.map(c => `<button type="button" class="msg-conv${c.on ? ' is-active' : ''}${c.n ? ' is-unread' : ''}"><img alt="" src="${arts[c.a]}"><span class="msg-conv-main"><span class="msg-conv-top">${esc(c.client)}<span>${c.time}</span></span><span class="msg-conv-sub">${esc(c.title)}</span><span class="msg-conv-last">${esc(c.last)}</span></span>${c.n ? `<span class="msg-unread">${c.n}</span>` : ''}</button>`).join('');
    const comp = k => `<span class="cal-cm-comp-label cal-cm-comp-${k}">${{ video: 'Video', graphic: 'Thumbnail', caption: 'Caption' }[k]}</span>`;
    const b = (who, role, k, aud, text, time, me, extra) => `<div class="msg-b${me ? ' is-me' : ''}"><div class="msg-b-meta"><b>${esc(who)}</b>${role ? '<span>' + role + '</span>' : ''}${k ? comp(k) : ''}${extra || ''}${aud ? tag(aud, LOCK) : ''}<span>${time}</span></div><div class="msg-b-text">${text}</div></div>`;
    let bubbles = '';
    if (state === 'long') {
      bubbles += '<div class="msg-day">Earlier</div>';
      const older = ['First cut is up.', 'Pacing feels slow in the middle.', 'Trimmed 4 seconds.', 'Better. Colour looks a little cold.', 'Warmed it up.', 'Good. Check the subtitles.', 'Fixed two typos.', 'Logo is too small at the end.'];
      older.forEach((t, i) => { bubbles += i % 2 ? b('You', '', i === 1 ? 'video' : '', i === 1 ? 'team' : '', t, 'Oct ' + (8 + i), true) : b('Alex', 'SMM', i === 0 ? 'video' : '', i === 0 ? 'team' : '', t, 'Oct ' + (8 + i)); });
    }
    bubbles += '<div class="msg-day">Wednesday</div>'
      + b('Alex', 'SMM', 'video', 'team', 'Cut the first 2 seconds, the hook starts late.', '10:00', false, '<span class="cal-cm-type-tag is-tweak">Change request #2</span>')
      + b('You', '', '', '', '<div class="msg-b-quote">Cut the first 2 seconds…</div>Agree. Also lift the music under the voice.', '12:00', true)
      + '<div class="msg-day">Today</div><div class="msg-new">2 new</div>'
      + b('Client', '', 'graphic', 'client', 'Love this one! Could the text be a bit bigger?', '08:00')
      + b('Mia', 'SMM', 'video', 'team', 'Can this one go out Friday instead of Thursday?', '11:00');
    const sendIco = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8h11M9 3.5L13.5 8L9 12.5"/></svg>';
    content.innerHTML = `<div class="msg-inbox${state === 'chat' ? ' is-chat-open' : ''}">
      <div class="msg-list"><div class="msg-filters"><button type="button" class="is-active">All</button><button type="button">Unread · 3</button><button type="button">Change requests</button></div><div class="msg-convs">${list}</div></div>
      <div class="msg-chat">
        <div class="msg-chat-head"><button type="button" class="msg-back" aria-label="Back to conversations">‹</button><img alt="" src="${arts[0]}"><div><div class="msg-chat-title">Morning routine, 3 swaps</div><div class="msg-chat-sub">Sample Bakery · Video: Tweaks needed</div></div>
          <div class="msg-chat-actions"><button type="button" title="Mark as unread">●<span> Mark as unread</span></button><button type="button">Open card</button></div></div>
        <div class="msg-bubbles">${bubbles}</div>
        <div class="msg-reply"><div class="msg-reply-cap">Replying to <b>Mia</b> ${comp('video')} ${tag('team', LOCK)} <span class="msg-reply-why">· a reply keeps the thread's part and audience</span></div>
          <div class="cal-cm-composer"><textarea class="cal-cm-textarea" rows="1" placeholder="Reply…" style="flex:1;border:0;background:transparent;resize:none;font:inherit;color:inherit;outline:0;min-height:22px"></textarea><button type="button" class="cal-cm-send" aria-label="Send">${sendIco}</button></div></div>
      </div></div>`;
    const bb = content.querySelector('.msg-bubbles'); if (bb) bb.scrollTop = bb.scrollHeight;
  };

  /* Client link: strip on top + dot on the card Notes button. */
  window.paintClient = function (state) {
    if (state === 'none') return;
    const strip = `<div class="cal-new-msgs-strip" role="status"><span class="cal-comments-dot"></span>2 new messages from the Synchro team<button type="button">Show me</button></div>`;
    const host = document.querySelector('.cal-review-list, .cal-review-wrap, .cal-organizer, .cal-sheet, #calGrid, .cal-board') || document.querySelector('.cal-header, .cal-toolbar');
    if (host) host.insertAdjacentHTML('beforebegin', strip);
    document.querySelectorAll('[data-comments-btn="p3"]').forEach(bn => { bn.classList.add('has-unread'); if (!bn.querySelector('.cal-comments-dot')) bn.querySelector('.cal-comments-label').insertAdjacentHTML('afterend', '<span class="cal-comments-dot" aria-label="New messages"></span>'); });
  };
  window.paintClientNotes = function () {
    const root = document.getElementById('calCommentsModal'); if (!root) return;
    root.querySelectorAll('.cal-cm-row').forEach(row => { if (['g2', 'c2'].includes(row.getAttribute('data-cm-row'))) row.classList.add('is-unread'); });
    const head = root.querySelector('.cal-cm-composer-wrap');
    const s = root.querySelector('.cal-cm-scroll, .cal-cm-list, .cal-cm-thread');
    if (s && s.parentElement) s.parentElement.insertAdjacentHTML('afterbegin', '');
  };
})();
