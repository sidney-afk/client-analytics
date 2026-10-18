/* SyncView "start here" page. No backend calls, no analytics, no app scripts. */
(function () {
  'use strict';
  var root = document.documentElement;
  root.classList.add('js');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  requestAnimationFrame(function () { requestAnimationFrame(function () { root.classList.add('ready'); }); });

  /* ---- Player: the review page's player, drawn again (big round play, then a slim bar). ---- */
  var ICO = {
    play: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4.5 2.8v10.4a.8.8 0 0 0 1.2.7l8.4-5.2a.8.8 0 0 0 0-1.4L5.7 2.1a.8.8 0 0 0-1.2.7z"/></svg>',
    pause: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3.5" y="2.5" width="3.2" height="11" rx="1"/><rect x="9.3" y="2.5" width="3.2" height="11" rx="1"/></svg>',
    back: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3.5v3h3"/><path d="M3.3 6.5A5 5 0 1 1 3.4 10"/></svg>',
    fwd: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 3.5v3h-3"/><path d="M12.7 6.5A5 5 0 1 0 12.6 10"/></svg>',
    sound: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6h2.5l3.5-3v10L5 10H2.5z" fill="currentColor"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.6a6 6 0 0 1 0 8.8"/></svg>',
    muted: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6h2.5l3.5-3v10L5 10H2.5z" fill="currentColor"/><path d="M11 6l3.5 4M14.5 6 11 10"/></svg>',
    full: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/></svg>'
  };
  var RATES = [1, 1.5, 2];
  var SKIP = 5;
  var players = [];

  function fmt(s) {
    s = Math.max(0, Math.floor(Number(s) || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function btn(cls, label, html) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.setAttribute('aria-label', label); b.innerHTML = html;
    return b;
  }

  function makePlayer(box) {
    var v = box.querySelector('video');
    if (!v) return;
    v.removeAttribute('controls');
    v.muted = false; v.autoplay = false;
    var known = Number(box.getAttribute('data-duration')) || 0;

    var shade = document.createElement('div'); shade.className = 'shade';
    var big = btn('big-play', 'Play video', ICO.play);
    var ctrls = document.createElement('div'); ctrls.className = 'ctrls';
    var scrub = document.createElement('div'); scrub.className = 'scrub';
    scrub.setAttribute('role', 'slider'); scrub.setAttribute('tabindex', '0'); scrub.setAttribute('aria-label', 'Seek');
    scrub.setAttribute('aria-valuemin', '0'); scrub.setAttribute('aria-valuenow', '0');
    scrub.innerHTML = '<div class="track"><div class="fill"></div></div><div class="knob"></div>';
    var bar = document.createElement('div'); bar.className = 'bar';
    var left = document.createElement('div'); left.className = 'bar-l';
    var mid = document.createElement('div'); mid.className = 'bar-m';
    var right = document.createElement('div'); right.className = 'bar-r';
    var time = document.createElement('span'); time.className = 'time';
    time.innerHTML = '<span class="cur">0:00</span><span class="dur"> / ' + fmt(known) + '</span>';
    var speed = btn('ctl speed', 'Playback speed, 1x', '1x');
    var back = btn('ctl back', 'Back 5 seconds', ICO.back);
    var pp = btn('ctl pp', 'Play', ICO.play);
    var fwd = btn('ctl fwd', 'Forward 5 seconds', ICO.fwd);
    var vol = btn('ctl vol', 'Mute', ICO.sound);
    var full = btn('ctl full', 'Full screen', ICO.full);
    left.append(time, speed); mid.append(back, pp, fwd); right.append(vol, full);
    bar.append(left, mid, right); ctrls.append(scrub, bar);
    box.append(shade, big, ctrls);

    var fill = scrub.querySelector('.fill'), knob = scrub.querySelector('.knob');
    var cur = time.querySelector('.cur'), dur = time.querySelector('.dur');
    var rate = 0, idleT = 0, dragging = false;

    function duration() { return isFinite(v.duration) && v.duration > 0 ? v.duration : known; }
    function paint() {
      var d = duration(), t = v.currentTime || 0, f = d ? Math.min(1, t / d) : 0;
      fill.style.width = (f * 100) + '%'; knob.style.left = (f * 100) + '%';
      cur.textContent = fmt(t); dur.textContent = ' / ' + fmt(d);
      scrub.setAttribute('aria-valuemax', String(Math.round(d))); scrub.setAttribute('aria-valuenow', String(Math.round(t)));
      scrub.setAttribute('aria-valuetext', fmt(t) + ' of ' + fmt(d));
    }
    function state() {
      var playing = !v.paused && !v.ended;
      box.classList.toggle('playing', playing);
      pp.innerHTML = playing ? ICO.pause : ICO.play;
      pp.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      if (!playing) box.classList.remove('idle');
    }
    function toggle() {
      if (v.paused || v.ended) {
        players.forEach(function (o) { if (o !== v && !o.paused) o.pause(); });
        box.classList.add('started');
        var p = v.play(); if (p && p.catch) p.catch(function () {});
      } else v.pause();
    }
    function seekBy(s) { var d = duration(); v.currentTime = Math.max(0, Math.min(d || Infinity, (v.currentTime || 0) + s)); box.classList.add('started'); paint(); }
    function seekTo(clientX) {
      var r = scrub.getBoundingClientRect(), d = duration();
      if (!d) return;
      v.currentTime = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * d; box.classList.add('started'); paint();
    }
    function wake() {
      box.classList.remove('idle'); clearTimeout(idleT);
      idleT = setTimeout(function () { if (!v.paused) box.classList.add('idle'); }, 2200);
    }

    big.addEventListener('click', toggle);
    pp.addEventListener('click', toggle);
    v.addEventListener('click', toggle);
    back.addEventListener('click', function () { seekBy(-SKIP); });
    fwd.addEventListener('click', function () { seekBy(SKIP); });
    speed.addEventListener('click', function () {
      rate = (rate + 1) % RATES.length; v.playbackRate = RATES[rate];
      speed.textContent = RATES[rate] + 'x'; speed.setAttribute('aria-label', 'Playback speed, ' + RATES[rate] + 'x');
    });
    vol.addEventListener('click', function () {
      v.muted = !v.muted; vol.innerHTML = v.muted ? ICO.muted : ICO.sound; vol.setAttribute('aria-label', v.muted ? 'Unmute' : 'Mute');
    });
    full.addEventListener('click', function () {
      var d = document;
      if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); return; }
      if (box.requestFullscreen) box.requestFullscreen().catch(function () {});
      else if (box.webkitRequestFullscreen) box.webkitRequestFullscreen();
      else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen(); /* iPhone */
    });
    scrub.addEventListener('pointerdown', function (e) { dragging = true; scrub.setPointerCapture(e.pointerId); seekTo(e.clientX); });
    scrub.addEventListener('pointermove', function (e) { if (dragging) seekTo(e.clientX); });
    scrub.addEventListener('pointerup', function () { dragging = false; });
    scrub.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { seekBy(-SKIP); e.preventDefault(); }
      if (e.key === 'ArrowRight') { seekBy(SKIP); e.preventDefault(); }
    });
    box.addEventListener('keydown', function (e) {
      if ((e.key === ' ' || e.key === 'k') && (e.target === box || e.target === v)) { toggle(); e.preventDefault(); }
    });
    box.addEventListener('pointermove', wake);
    v.addEventListener('play', function () { state(); wake(); });
    v.addEventListener('pause', state);
    v.addEventListener('ended', function () { state(); box.classList.remove('started'); });
    v.addEventListener('timeupdate', paint);
    v.addEventListener('loadedmetadata', paint);
    v.addEventListener('ratechange', function () { if (v.playbackRate !== RATES[rate]) v.playbackRate = RATES[rate]; });
    paint();
    players.push(v);
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-player]'), makePlayer);

  /* ---- Header line once the page moves. ---- */
  var top = document.querySelector('.top');
  function onScrollTop() { if (top) top.classList.toggle('scrolled', window.scrollY > 8); }

  /* ---- The lens: an eye-shaped window that opens as you scroll. ---- */
  var lens = document.querySelector('.lens'), pin = document.querySelector('.lens-pin');
  function onScrollLens() {
    if (!lens || !pin || reduce) return;
    var r = lens.getBoundingClientRect(), span = lens.offsetHeight - window.innerHeight;
    var p = span > 0 ? Math.min(1, Math.max(0, -r.top / (span * 0.75))) : 1; /* closed until it pins, open before it lets go */
    p = 1 - Math.pow(1 - p, 2); /* ease out */
    pin.style.setProperty('--p', p.toFixed(4));
  }
  if (reduce && pin) pin.style.setProperty('--p', '1');

  var ticking = false;
  function onScroll() {
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () { ticking = false; onScrollTop(); onScrollLens(); });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();

  /* ---- Tour: the pinned picture follows the step in the middle of the screen. ---- */
  var steps = document.querySelectorAll('.step'), shots = document.querySelectorAll('.shot');
  if ('IntersectionObserver' in window && steps.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var k = en.target.getAttribute('data-shot');
        steps.forEach(function (s) { s.classList.toggle('on', s === en.target); });
        shots.forEach(function (s) { s.classList.toggle('on', s.getAttribute('data-shot') === k); });
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    steps.forEach(function (s) { io.observe(s); });
  }
  if (steps[0]) steps[0].classList.add('on');

  /* ---- Who are you: clients or videographers. #client and #videographer open the right one. ---- */
  var panel = document.getElementById('path-panel');
  var tabs = document.querySelectorAll('.switch [role="tab"]');
  function choose(path, focus) {
    if (!panel || (path !== 'client' && path !== 'videographer')) return;
    if (panel.getAttribute('data-path') !== path) {
      players.forEach(function (o) { if (!o.paused) o.pause(); });
      panel.setAttribute('data-path', path);
      panel.classList.remove('swap'); void panel.offsetWidth; panel.classList.add('swap');
    }
    tabs.forEach(function (t) {
      var on = t.getAttribute('data-path') === path;
      t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1;
      if (on) { panel.setAttribute('aria-labelledby', t.id); if (focus) t.focus(); }
    });
  }
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () {
      var p = t.getAttribute('data-path'); choose(p);
      try { history.replaceState(null, '', '#' + p); } catch (e) {}
    });
    t.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      choose(n.getAttribute('data-path'), true); e.preventDefault();
    });
  });
  function fromHash() { var h = (location.hash || '').slice(1); if (h === 'client' || h === 'videographer') choose(h); }
  window.addEventListener('hashchange', fromHash);
  fromHash();

  /* ---- Folder rules: point at a rule to see it in the folders. ---- */
  var tree = document.querySelector('.tree'), rules = document.querySelectorAll('.rules li');
  function light(k) {
    if (!tree) return;
    tree.className = 'tree' + (k ? ' hl k-' + k : '');
    rules.forEach(function (r) { r.classList.toggle('on', r.getAttribute('data-hl') === k); });
    tree.querySelectorAll('li').forEach(function (li) { li.classList.toggle('on', !!k && li.getAttribute('data-k') === k); });
    tree.querySelectorAll('.nm').forEach(function (n) { n.classList.toggle('on', k === 'name'); });
  }
  rules.forEach(function (r) {
    var k = r.getAttribute('data-hl');
    r.addEventListener('mouseenter', function () { light(k); });
    r.addEventListener('focus', function () { light(k); });
    r.addEventListener('click', function () { light(k); });
    r.addEventListener('mouseleave', function () { light(''); });
    r.addEventListener('blur', function () { light(''); });
  });
})();
