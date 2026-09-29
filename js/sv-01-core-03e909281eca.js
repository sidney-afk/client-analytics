    const SYNCVIEW_THEME_KEY = 'syncview_theme';
    const SYNCVIEW_STATUS_PALETTE_KEY = 'syncview_status_palette';
    /*
     * On-demand areas (docs/plans/2026-09-28-load-per-tab-plan.md, step 3).
     *
     * A staff-only area listed as "lazy" in src/index/split.json is not in
     * the page's first download when the page is served in parts: its code
     * arrives the first time something asks for it. So nothing outside an
     * area calls its functions by name. The area registers what it offers,
     * the moment its code runs (svAreaRegister), and callers go through here:
     *   svAreaApi(name)   what the area offers if its code has run, else null
     *                     (an area that never loaded has nothing to tear down,
     *                     re-render or flush);
     *   svArea(name)      a promise of the same, fetching the code if needed;
     *   svWithArea(...)   draw a tab from its area: at once when the code is
     *                     here (always, for the whole-script page), else a
     *                     loading state, then the tab, or a Retry.
     * The client approve / request-changes path is never lazy (areas.txt).
     */
    const _svAreaApis = Object.create(null);
    const _svAreaLoads = Object.create(null);
    let _svAreaDrawSeq = 0;
    function svAreaRegister(name, api) { _svAreaApis[name] = api; }
    function svAreaApi(name) { return _svAreaApis[name] || null; }
    function svArea(name) {
        if (_svAreaApis[name]) return Promise.resolve(_svAreaApis[name]);
        if (_svAreaLoads[name]) return _svAreaLoads[name];
        const file = self.__svLoad && self.__svLoad.lazy && self.__svLoad.lazy[name];
        if (!file) {
            // Not on demand: the area's code is in the page and simply has not
            // run yet while the page is still being read (start-up routing can
            // ask this early). It has once the document has finished loading.
            if (document.readyState !== 'loading') return Promise.reject(new Error('SyncView area "' + name + '" is not available'));
            return new Promise((resolve, reject) => document.addEventListener('DOMContentLoaded', () => (
                _svAreaApis[name] ? resolve(_svAreaApis[name]) : reject(new Error('SyncView area "' + name + '" is not available'))
            ), { once: true }));
        }
        const load = new Promise((resolve, reject) => {
            const start = () => {
                const s = document.createElement('script');
                s.src = '/' + file;
                s.onload = () => (_svAreaApis[name] ? resolve(_svAreaApis[name]) : reject(new Error('SyncView area "' + name + '" did not start')));
                s.onerror = () => { s.remove(); reject(new Error('SyncView area "' + name + '" could not be downloaded')); };
                document.head.appendChild(s);
            };
            // An area's code uses always-loaded fragments that come later in the
            // page than the start-up router (which can ask for an area, on a
            // refresh, while the page is still being read). A script added now
            // could run between two of those parts and find a name not defined
            // yet, so wait until the whole document, and with it every
            // always-loaded part, has run.
            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
            else start();
        });
        // A failed download is not remembered, so Retry fetches again.
        _svAreaLoads[name] = load.catch(e => { delete _svAreaLoads[name]; throw e; });
        return _svAreaLoads[name];
    }
    function svWithArea(name, content, draw, retry) {
        const seq = ++_svAreaDrawSeq;
        const api = _svAreaApis[name];
        if (api) { draw(api); return; }
        content.innerHTML = '<div class="sv-area-loading" data-sv-area-wait="' + seq + '" role="status" aria-live="polite" style="padding:48px 24px;text-align:center;opacity:.7;">Loading…</div>';
        const stillWaiting = () => seq === _svAreaDrawSeq && !!content.querySelector('[data-sv-area-wait="' + seq + '"]');
        svArea(name).then(loaded => { if (stillWaiting()) draw(loaded); }, () => {
            if (!stillWaiting()) return;
            content.innerHTML = '<div class="sv-area-loading" data-sv-area-wait="' + seq + '" role="alert" style="padding:48px 24px;text-align:center;">'
                + 'This page could not be loaded. Check your connection. '
                + '<button type="button" class="btn btn-secondary" data-sv-area-retry>Retry</button></div>';
            const b = content.querySelector('[data-sv-area-retry]');
            if (b) b.addEventListener('click', () => { if (typeof retry === 'function') retry(); else svWithArea(name, content, draw, retry); });
        });
    }
    // Staff pages served in parts fetch the remaining areas quietly once the
    // first screen is up, so switching tabs later waits on nothing.
    function _svPrefetchAreas() {
        const lazy = self.__svLoad && self.__svLoad.lazy;
        if (!lazy) return;
        for (const name of Object.keys(lazy)) svArea(name).catch(() => {});
    }
    window.addEventListener('load', () => {
        const idle = window.requestIdleCallback || (fn => setTimeout(fn, 1500));
        setTimeout(() => idle(_svPrefetchAreas), 2500);
    });
    /*
     * OPEN_REPAIRS 215 -- backdrop-dismiss press guard, shared by all dialog
     * overlays.
     *
     * Every dialog's backdrop closes it with `if (event.target === overlay)
     * dismiss()`. That is not enough: the DOM dispatches `click` at the
     * nearest common ancestor of the mousedown target and the mouseup
     * target, so a press that starts on a field inside the dialog (e.g.
     * drag-selecting text) and releases on the backdrop makes
     * `event.target === overlay` true at click time too -- indistinguishable
     * from an actual backdrop click. Drag-selecting text right-to-left near a
     * dialog's edge routinely ends the drag outside it, so this is ordinary
     * input, not an edge case.
     *
     * One delegated, capture-phase `mousedown` listener on `document` records
     * on every press whether it began directly on a marked backdrop
     * (`[data-backdrop-dismiss]`), not on one of its descendants. Capture
     * phase is load-bearing: several dialog fields call
     * `event.stopPropagation()` on their own `mousedown` (the Create Post
     * batch-name field among them), which would stop a bubble-phase listener
     * on the overlay from ever seeing those presses -- leaving a stale
     * `true` from an earlier real backdrop press and letting the bug survive
     * in a narrower, easier-to-miss form. Delegating at `document` also means
     * a dialog whose markup is re-rendered (a fresh overlay element replacing
     * the old one) is covered without re-arming anything, since there is
     * nothing per-element to re-arm.
     *
     * Each backdrop's own click handler additionally requires
     * `overlay._backdropPressBegan` (or `this._backdropPressBegan` inline)
     * before dismissing, so a dismiss only fires when BOTH the press and the
     * click landed on the backdrop itself.
     */
    document.addEventListener('mousedown', event => {
        const backdrop = event.target && event.target.closest && event.target.closest('[data-backdrop-dismiss]');
        if (backdrop) backdrop._backdropPressBegan = (event.target === backdrop);
    }, true);
    function _syncviewThemeAllowed() {
        try {
            const q = new URLSearchParams(svRoute.search());
            return !q.get('c');
        } catch (e) { return false; }
    }
    function _syncviewStoredTheme() {
        try { return localStorage.getItem(SYNCVIEW_THEME_KEY) === 'dark' ? 'dark' : 'light'; }
        catch (e) { return 'light'; }
    }
    function _syncviewStoredStatusPalette() {
        try { return localStorage.getItem(SYNCVIEW_STATUS_PALETTE_KEY) === 'classic' ? 'classic' : 'vibrant'; }
        catch (e) { return 'vibrant'; }
    }
    function _syncviewApplyTheme(theme, rerenderCharts) {
        const allowed = _syncviewThemeAllowed();
        const next = allowed && theme === 'dark' ? 'dark' : 'light';
        if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
        else document.documentElement.removeAttribute('data-theme');
        const btn = document.getElementById('themeToggle');
        if (btn) {
            btn.hidden = !allowed;
            btn.setAttribute('aria-pressed', next === 'dark' ? 'true' : 'false');
            btn.setAttribute('aria-checked', next === 'dark' ? 'true' : 'false');
            btn.setAttribute('aria-label', next === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
            btn.title = next === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
        }
        const label = document.getElementById('themeToggleLabel');
        const state = document.getElementById('themeToggleState');
        if (label) label.textContent = 'Dark mode';
        if (state) state.textContent = next === 'dark' ? 'On' : 'Off';
        if (rerenderCharts !== false && currentClientHistory && Array.isArray(currentClientHistory)) {
            try { renderChart(currentClientHistory); renderViewsChart(currentClientHistory); } catch (e) {}
        }
    }
    function _syncviewApplyStatusPalette(palette) {
        const allowed = _syncviewThemeAllowed();
        const next = allowed && palette === 'classic' ? 'classic' : 'vibrant';
        if (next === 'classic') document.documentElement.setAttribute('data-status-palette', 'classic');
        else document.documentElement.removeAttribute('data-status-palette');
        const btn = document.getElementById('statusPaletteToggle');
        if (btn) {
            btn.hidden = !allowed;
            btn.setAttribute('aria-pressed', next === 'classic' ? 'true' : 'false');
            btn.setAttribute('aria-checked', next === 'classic' ? 'true' : 'false');
            btn.setAttribute('aria-label', next === 'classic' ? 'Switch to new status colors' : 'Switch to original status colors');
            btn.title = next === 'classic' ? 'Switch to new status colors' : 'Switch to original status colors';
        }
        const state = document.getElementById('statusPaletteToggleState');
        if (state) state.textContent = next === 'classic' ? 'On' : 'Off';
    }
    function toggleSyncViewTheme() {
        if (!_syncviewThemeAllowed()) return;
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        try {
            if (next === 'dark') localStorage.setItem(SYNCVIEW_THEME_KEY, 'dark');
            else localStorage.removeItem(SYNCVIEW_THEME_KEY);
        } catch (e) {}
        _syncviewApplyTheme(next);
    }
    function toggleSyncViewStatusPalette() {
        if (!_syncviewThemeAllowed()) return;
        const next = document.documentElement.getAttribute('data-status-palette') === 'classic' ? 'vibrant' : 'classic';
        try {
            if (next === 'classic') localStorage.setItem(SYNCVIEW_STATUS_PALETTE_KEY, 'classic');
            else localStorage.removeItem(SYNCVIEW_STATUS_PALETTE_KEY);
        } catch (e) {}
        _syncviewApplyStatusPalette(next);
    }
    _syncviewApplyStatusPalette(_syncviewStoredStatusPalette());
    _syncviewApplyTheme(_syncviewStoredTheme(), false);
    // ── Confirmation modal ───────────────────────────────────────────────
    let _confirmCb = null;
    function showConfirm(title, msg, onYes, yesLabel, checkboxLabel) {
        document.getElementById('confirmTitle').textContent = title;
        document.getElementById('confirmMsg').textContent = msg;
        document.getElementById('confirmOverlay').classList.add('active');
        const yesBtn = document.getElementById('confirmYes');
        yesBtn.textContent = yesLabel || 'Confirm';
        const cancelBtn = document.querySelector('#confirmOverlay .brief-action-btn:not(.primary)');
        if (cancelBtn) cancelBtn.style.display = '';
        const checkWrap = document.getElementById('confirmCheckWrap');
        const check = document.getElementById('confirmCheck');
        if (checkboxLabel) {
            document.getElementById('confirmCheckLabel').textContent = checkboxLabel;
            check.checked = false;
            checkWrap.hidden = false;
        } else {
            checkWrap.hidden = true;
        }
        _confirmCb = onYes;
        yesBtn.onclick = () => { const cb = _confirmCb; const checked = check.checked; dismissConfirm(); if (cb) cb(checked); };
    }
    function dismissConfirm() {
        document.getElementById('confirmOverlay').classList.remove('active');
        _confirmCb = null;
        // restore cancel button if it was hidden for notify mode
        const cancelBtn = document.querySelector('#confirmOverlay .brief-action-btn:not(.primary)');
        if (cancelBtn) cancelBtn.style.display = '';
        document.getElementById('confirmCheckWrap').hidden = true;
    }
    function showNotify(title, msg) {
        document.getElementById('confirmTitle').textContent = title;
        document.getElementById('confirmMsg').textContent = msg;
        document.getElementById('confirmCheckWrap').hidden = true;
        const cancelBtn = document.querySelector('#confirmOverlay .brief-action-btn:not(.primary)');
        if (cancelBtn) cancelBtn.style.display = 'none';
        const yesBtn = document.getElementById('confirmYes');
        yesBtn.textContent = 'OK';
        yesBtn.onclick = dismissConfirm;
        document.getElementById('confirmOverlay').classList.add('active');
    }

    /* Bottom-center toast with optional action (used for Undo + confirmations).
       Single instance — a new toast replaces the previous one. DOM-built, so
       message text needs no escaping. */
    let _toastEl = null, _toastTimer = null;
    function hideToast() {
        if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null; }
        const el = _toastEl; _toastEl = null;
        if (!el) return;
        el.classList.remove('show');
        setTimeout(() => { try { el.remove(); } catch (e) {} }, 220);
    }
    function showToast(msg, opts) {
        opts = opts || {};
        hideToast();
        const el = document.createElement('div');
        el.className = 'sv-toast';
        // Codex review, PR for item 176 (seventh pass): a screen-reader user
        // gets no announcement at all when a plain div is inserted into the
        // page — this toast (and the "Opening linked card…"/"Linked to…"
        // messages this feature relies on it for) would otherwise leave
        // exactly the silent wait the feature exists to remove. Matches the
        // role="status" + aria-live="polite" convention already used
        // throughout this file for loading/status announcements.
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        const txt = document.createElement('span');
        txt.className = 'sv-toast-msg';
        txt.textContent = msg;
        el.appendChild(txt);
        if (opts.actionLabel && typeof opts.onAction === 'function') {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'sv-toast-action';
            btn.textContent = opts.actionLabel;
            btn.onclick = () => { hideToast(); try { opts.onAction(); } catch (e) { console.warn('[SyncView] toast action failed:', e); } };
            el.appendChild(btn);
        }
        document.body.appendChild(el);
        _toastEl = el;
        requestAnimationFrame(() => { if (el === _toastEl) el.classList.add('show'); });
        _toastTimer = setTimeout(hideToast, opts.duration || (opts.actionLabel ? 6000 : 3200));
    }

    /* ── Focus guard — a background update must never steal the caret ──────
       A toast, a realtime echo, a tab-return refresh, or a sibling card's
       after-save repaint can rebuild the very DOM node the user is typing in.
       A bare innerHTML / replaceWith then destroys that field and kicks focus
       (and the caret) out — the "Approve pulls me out of the field" bug. These
       three primitives let any re-render preserve the active input: capture the
       focused INPUT/TEXTAREA by a signature that survives the rebuild (its id,
       else its oninput handler string, else its name) + caret, run the render,
       then re-focus the matching field in the fresh DOM and restore selection.
       No-ops when nothing is focused or the focused node isn't a text field, so
       it is always safe to wrap a render — even a background one. */
    /* The handler string alone is not unique: every card's name box calls
       the same `_sxrOnFieldInput(this)`, so a match on it alone picked the
       FIRST card on the page, not the one being typed in. Where the field
       carries its card and field identity (data-pid, data-fld, data-comp),
       that identity is part of the signature. */
    function _svFieldKey(el) {
        const get = k => (el.getAttribute && el.getAttribute(k)) || '';
        const parts = ['data-pid', 'data-fld', 'data-comp'].map(k => get(k) ? k + '=' + get(k) : '').filter(Boolean);
        return parts.length ? '|' + parts.join('|') : '';
    }
    function _svFieldSig(el) {
        if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return '';
        if (el.id) return '#' + el.id;
        const oi = el.getAttribute && el.getAttribute('oninput');
        if (oi) return 'oninput=' + oi + _svFieldKey(el);
        if (el.name) return 'name=' + el.name + _svFieldKey(el);
        return '';
    }
    function _svCaptureFocus(root) {
        const a = (typeof document !== 'undefined') ? document.activeElement : null;
        if (!a) return null;
        if (root && !(root.contains && root.contains(a))) return null;   // focus isn't in the region being rebuilt
        const sig = _svFieldSig(a);
        if (!sig) return null;
        const cap = { sig, el: a, start: null, end: null, dir: 'none' };
        try { cap.start = a.selectionStart; cap.end = a.selectionEnd; cap.dir = a.selectionDirection || 'none'; } catch (e) {}
        return cap;
    }
    function _svRestoreFocus(cap) {
        if (!cap || !cap.sig) return;
        let el = null;
        // The very box the person was in, when a render left it in place.
        if (cap.el && cap.el.isConnected && _svFieldSig(cap.el) === cap.sig) el = cap.el;
        if (!el && cap.sig.charAt(0) === '#') el = document.getElementById(cap.sig.slice(1));
        if (!el) {
            const nodes = document.querySelectorAll('input, textarea');
            for (let i = 0; i < nodes.length; i++) { if (_svFieldSig(nodes[i]) === cap.sig) { el = nodes[i]; break; } }
        }
        if (!el) return;
        try {
            if (document.activeElement !== el) el.focus();
            if (cap.start != null && typeof el.setSelectionRange === 'function') el.setSelectionRange(cap.start, cap.end, cap.dir);
        } catch (e) {}
    }
    function _svPreserveFocus(render, root) {
        const cap = _svCaptureFocus(root);
        const out = render();
        if (cap) _svRestoreFocus(cap);
        return out;
    }

    const SHEET_ID    = '10QQnWOQY73Aj44R8AumYJzFpxMd_bZZiCMXkZ6QqAU8';
    const METRICS_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Metrics`;
    const CLIENTS_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Clients%20Info`;
    const TOPVIDS_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=TopVideos`;
    // Competitor Briefs: retired 2026-09-24 (#1590). The tab is no longer
    // downloaded; `briefs` stays an empty list so older saved copies still load.
    const MR_BRIEFS_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Market%20Research%20Briefs`;
    const CONTENT_SUMMARIES_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=ContentSummaries`;
    // Filming Plans source. The staff-gated Edge Function is authoritative;
    // browser reads never fall back to raw PostgREST or the former public sheet.
    // plan_months is an optional manual list like "2026-04,2026-05" used when the
    // tabs webhook below isn't configured yet.
    // Optional n8n endpoint that, given ?doc=<docId>, returns the Google Doc's
    // tabs as { ok:true, tabs:[{ tabId, title, url }] } via the Docs API. The
    // "Filming Plan Tabs" workflow (n8n id 5S4JyVVR2CpHEv9b) serves this; until
    // it's activated the view still shows the calendar content bank (plus any
    // manual plan_months) — failed calls are caught and treated as no coverage.
    const FILMING_PLAN_TABS_URL = 'https://synchrosocial.app.n8n.cloud/webhook/filming-plan-tabs';
    const FILMING_PLANS_EF_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/filming-plans';

    let allData = [], clientMap = {}, topVideos = [], growthChart = null, viewsChart = null;
    let followersPlat = 'ig', followersMode = 'total', viewsPlat = 'all', currentClientHistory = [];
    let briefs = [];
    let mrBriefs = [];
    let linearProjects = [];
    let linearClientRows = [];
    let sortCol = 'ig_followers', sortDir = 'desc';
    function _setGrowthChart(value) { growthChart = value; }
    function _setViewsChart(value) { viewsChart = value; }
    function _setFollowersPlat(value) { followersPlat = value; }
    function _setFollowersMode(value) { followersMode = value; }
    function _setViewsPlat(value) { viewsPlat = value; }
    function _setCurrentClientHistory(value) { currentClientHistory = value; }
    function _setLinearProjects(value) { linearProjects = value; }
    function _setLinearClientRows(value) { linearClientRows = value; }
    function _setSortCol(value) { sortCol = value; }
    function _setSortDir(value) { sortDir = value; }
    function _setAllData(value) { allData = value; }
    function _setClientMap(value) { clientMap = value; }
    function _setTopVideos(value) { topVideos = value; }
    function _setBriefs(value) { briefs = value; }
    function _setMrBriefs(value) { mrBriefs = value; }
    function _setClientViewTab(value) { clientViewTab = value; }
    function _setContentSummaryState(value) { contentSummaryState = value; }
    function _setTabSummaryCache(value) { tabSummaryCache = value; }
    function _setFetchExtrasPromise(value) { _fetchExtrasPromise = value; }
    function _nextFetchExtrasAttempt() { return ++_fetchExtrasAttempt; }
    function _setFetchExtrasState(value) { _fetchExtrasState = value; }
    function _setClientEssentialsLoad(value) { _clientEssentialsLoad = value; }
    let activePeriods = {};
    let clientViewTab = {};
    let activeBriefTab = {};
    let activeBriefId = {};
    let activeBriefSection = {};
    let activeMRBriefTab = {};
    let activeMRBriefId = {};
    let savedHooks = (() => { try { const raw = localStorage.getItem('syncview_savedHooks'); console.log('[SyncView] savedHooks raw from localStorage:', raw); const s = new Set(JSON.parse(raw || '[]')); console.log('[SyncView] savedHooks loaded:', [...s]); return s; } catch(e) { console.warn('[SyncView] savedHooks load error:', e); return new Set(); } })();
    let tabSummaryCache = (() => { try { return JSON.parse(localStorage.getItem('syncview_tabSummaryCache_v2') || '{}'); } catch { return {}; } })();
    const tabSummaryControllers = new Set();
    const tabSummaryStartTimers = new Set();
    let tabSummaryBriefIds = (() => { try { return JSON.parse(localStorage.getItem('syncview_tabSummaryBriefIds_v1') || '{}'); } catch { return {}; } })(); // tracks which brief ID was used per "clientName__briefType"
    let contentSummaryState = (() => { try { return JSON.parse(localStorage.getItem('syncview_contentSummaryState_v1') || '{}'); } catch { return {}; } })();
    // Scrub entries that should not survive a page reload:
    //   - loading:true with no in-flight request (left behind if the previous tab closed mid-generation)
    //   - error states (e.g. transient Whisper 429s) — page reload should always re-attempt
    //   - data shaped like a Claude refusal ("I'm unable to…", "fabricate", "no transcripts") rather than a real summary
    // Removing these makes the next profile-open auto-trigger a fresh attempt instead of rendering broken text.
    (() => {
        const looksLikeRefusal = (s) => {
            if (typeof s !== 'string' || !s) return false;
            const t = s.toLowerCase();
            return /^i'?m unable to\b/.test(t.trimStart()) || /^i can'?t\b/.test(t.trimStart()) || /^i cannot\b/.test(t.trimStart()) || t.includes('fabricate') || t.includes('no transcripts');
        };
        let dirty = false;
        for (const [name, st] of Object.entries(contentSummaryState)) {
            if (st?.loading) { delete contentSummaryState[name]; dirty = true; continue; }
            if (st?.error) { delete contentSummaryState[name]; dirty = true; continue; }
            if (st?.data?.bullets && looksLikeRefusal(st.data.bullets)) { delete contentSummaryState[name]; dirty = true; }
        }
        if (dirty) { try { localStorage.setItem('syncview_contentSummaryState_v1', JSON.stringify(contentSummaryState)); } catch {} }
    })();

    const TAB_SUMMARY_WEBHOOK = 'https://synchrosocial.app.n8n.cloud/webhook/generate-tab-summary';
    const CONTENT_SUMMARY_WEBHOOK = 'https://synchrosocial.app.n8n.cloud/webhook/generate-content-summary';
    // Hook Library: N8N webhook that appends a row to the "Hook Library" sheet.
    // Create a new N8N workflow with a Webhook trigger → Google Sheets "Append row" node.
    // Fields: clientName, hookType, openingLine, template, views, sourceUrl, dateAdded
    const HOOK_LIBRARY_WEBHOOK = 'https://synchrosocial.app.n8n.cloud/webhook/add-hook-to-library';
    const WEEKLY_SLACK_WEBHOOK = 'https://synchrosocial.app.n8n.cloud/webhook/weekly-slack-top-reel';
    // TikTok Upload module — proxies the Post For Me API (api.postforme.dev) through
    // n8n so the API key stays server-side. See the bottom of this file for the module.
    const TIKTOK_UPLOAD_WEBHOOK    = 'https://synchrosocial.app.n8n.cloud/webhook/tiktok-upload';
    const TIKTOK_UPLOADS_LIST_URL  = 'https://synchrosocial.app.n8n.cloud/webhook/tiktok-uploads-list';
    const TIKTOK_UPLOAD_STATUS_URL = 'https://synchrosocial.app.n8n.cloud/webhook/tiktok-upload-status';
    const TIKTOK_UPLOAD_CANCEL_URL = 'https://synchrosocial.app.n8n.cloud/webhook/tiktok-upload-cancel';
    // Direct-to-storage transport (see _tkSubmit). `tiktok-upload-url` mints a
    // one-time Post For Me upload URL; the browser PUTs the video straight to
    // their storage and `tiktok-upload-direct` then takes metadata + that media
    // URL only. This exists because n8n Cloud sits behind Cloudflare, which hard
    // rejects request bodies over 100 MB before they ever reach the workflow —
    // the browser sees only a generic network failure, which is what the
    // 2026-08-17/18 "could not reach n8n" reports (113 MB / 122 MB) actually were.
    const TIKTOK_UPLOAD_URL_WEBHOOK    = 'https://synchrosocial.app.n8n.cloud/webhook/tiktok-upload-url';
    const TIKTOK_UPLOAD_DIRECT_WEBHOOK = 'https://synchrosocial.app.n8n.cloud/webhook/tiktok-upload-direct';
    const TIKTOK_FORM_KEY          = 'syncview_tiktokUploadForm_v1';
    const TIKTOK_PENDING_KEY       = 'syncview_pendingTiktokUploads_v1';
    const TIKTOK_HIDDEN_KEY        = 'syncview_hiddenTiktokUploads_v1';
    const TIKTOK_QUEUE_CACHE_KEY   = 'syncview_tiktokQueueCache_v1';
    const TIKTOK_OPTIMISTIC_TTL_MS = 5 * 60 * 1000; // drop unconfirmed local rows after 5 min
    const TIKTOK_MAX_BYTES         = 287 * 1024 * 1024; // TikTok upload size limit
    // Cloudflare's request-body ceiling in front of n8n Cloud. Only the legacy
    // in-band transport is subject to it; the direct path above is not.
    const TIKTOK_LEGACY_MAX_BYTES  = 100 * 1024 * 1024;
    // Photo carousel mode (TikTok "photo post"): always goes through the direct-to-storage
    // transport above (mint one Post For Me upload URL per image, PUT each, then submit the
    // resulting media URLs together) regardless of size — images are small, and reusing that
    // path keeps this additive to tiktok-upload-direct only, never touching the in-band
    // single-video tiktok-upload workflow above.
    const TIKTOK_MAX_PHOTOS        = 35;               // TikTok photo/carousel post limit
    const TIKTOK_PHOTO_MAX_BYTES   = 20 * 1024 * 1024;  // per-image guard

    function getTabSummaryKey(name, briefType, tabId) { return `${name}__${briefType}__${tabId}`; }

    function _scheduleTabSummary(name, briefType, tabId, tabData) {
        const timer = setTimeout(() => {
            tabSummaryStartTimers.delete(timer);
            fetchTabSummary(name, briefType, tabId, tabData);
        }, 0);
        tabSummaryStartTimers.add(timer);
    }

    async function fetchTabSummary(name, briefType, tabId, tabData) {
        const key = getTabSummaryKey(name, briefType, tabId);
        const clientEntryRun = _isClientLink ? _syncviewClientEntryDataRun : null;
        const runCurrent = () => !_isClientLink || _syncviewClientEntryRunCurrent(clientEntryRun);
        if (!runCurrent()) return;
        if (tabSummaryCache[key]?.text || tabSummaryCache[key]?.loading) return;
        tabSummaryCache[key] = { loading: true, text: null, error: null };
        refreshBriefView(name);
        const controller = new AbortController();
        tabSummaryControllers.add(controller);
        const abortForClientEntry = () => controller.abort();
        if (clientEntryRun) {
            if (clientEntryRun.signal.aborted) controller.abort();
            else clientEntryRun.signal.addEventListener('abort', abortForClientEntry, { once: true });
        }
        let timeout = null;
        try {
            timeout = setTimeout(() => controller.abort(), 180000);
            const resp = await fetch(TAB_SUMMARY_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientName: name, briefType, tabId, tabData }),
                signal: controller.signal
            });
            if (!runCurrent()) return;
            const text = await resp.text();
            if (!runCurrent()) return;
            if (!text) { tabSummaryCache[key] = { loading: false, text: null, error: 'Empty response' }; refreshBriefView(name); return; }
            const result = JSON.parse(text);
            if (!runCurrent()) return;
            tabSummaryCache[key] = { loading: false, text: result.summary || '', error: null };
            try { localStorage.setItem('syncview_tabSummaryCache_v2', JSON.stringify(tabSummaryCache)); } catch {}
            refreshBriefView(name);
        } catch (e) {
            if (!runCurrent()) return;
            console.warn('[SyncView] Tab summary error:', e);
            tabSummaryCache[key] = { loading: false, text: null, error: 'Could not generate summary' };
            refreshBriefView(name);
        } finally {
            if (timeout) clearTimeout(timeout);
            if (clientEntryRun) clientEntryRun.signal.removeEventListener('abort', abortForClientEntry);
            tabSummaryControllers.delete(controller);
        }
    }

    function renderTabSummary(name, briefType, tabId, tabData) {
        const key = getTabSummaryKey(name, briefType, tabId);
        const state = tabSummaryCache[key];
        if (!state) {
            // Trigger async fetch (fire-and-forget)
            _scheduleTabSummary(name, briefType, tabId, tabData);
            return `<div class="brief-tab-summary loading">Generating summary…</div>`;
        }
        if (state.loading) return `<div class="brief-tab-summary loading">Generating summary… <span style="font-weight:400;opacity:0.7;">(~1-2 min)</span></div>`;
        if (state.error) return '';
        if (state.text) {
            // Strip markdown formatting (# headers, **bold**, *italic*) and render bullet points
            const clean = state.text.replace(/^#{1,6}\s+/gm, '');
            const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
            const hasBullets = lines.some(l => /^[-•*]\s/.test(l) || /^\d+\.\s/.test(l));
            if (hasBullets) {
                const items = lines.filter(l => /^[-•*]\s/.test(l) || /^\d+\.\s/.test(l)).map(l => {
                    const t = l.replace(/^[-•*]\s*/, '').replace(/^\d+\.\s*/, '').trim();
                    const html = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
                    return `<li>${html}</li>`;
                }).join('');
                return `<div class="brief-tab-summary"><ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px;">${items}</ul></div>`;
            }
            const plainClean = clean.replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1');
            return `<div class="brief-tab-summary">${plainClean}</div>`;
        }
        return '';
    }

    function buildTabData(briefType, tabId, data) {
        // For overview/exec tabs, build a readable highlights string across all sections
        if (briefType === 'mr' && tabId === 'overview') {
            const exec = data.executiveSummary || {};
            const h = (typeof exec === 'object' && exec.highlights) ? exec.highlights : {};
            return { summary: 'Executive summary: ' + (exec.summary || exec || '') +
                '. Landscape: ' + (h.landscape || '') +
                '. Topic Clusters: ' + (h.topicClusters || '') +
                '. Hooks: ' + (h.hooks || '') +
                '. Filming Angles: ' + (h.filmingAngles || '') +
                '. Gap: ' + (h.gap || '') };
        }
        if (briefType === 'comp' && tabId === 'exec') {
            const s = data.executiveSummary || {};
            return { summary: 'What is resonating: ' + (s.whatIsResonating || '') +
                '. The gap: ' + (s.theGap || '') +
                '. Hook patterns: ' + (s.hookPatterns || '') +
                '. Action priorities: ' + (Array.isArray(s.actionPriorities) ? s.actionPriorities.join('; ') : '') };
        }
        const tabSections = {
            mr: { landscape: data.landscapeAnalysis, topics: data.topicClusters, niche: [...(data.landscapeAnalysis||[]),...(data.topicClusters||[])], hooks: data.hookAnalysis, angles: data.filmingAngles, gap: data.theGap },
            comp: { resonating: data.resonating, comments: data.commentIntelligence, gap: data.theGap, hooks: data.hookAnalysis }
        };
        const sectionData = (tabSections[briefType] || {})[tabId];
        if (sectionData === undefined) return {};
        return { summary: JSON.stringify(sectionData) };
    }
    function invalidateTabSummaries(name, briefType) {
        const prefix = `${name}__${briefType}__`;
        Object.keys(tabSummaryCache).forEach(key => { if (key.startsWith(prefix)) delete tabSummaryCache[key]; });
        try { localStorage.setItem('syncview_tabSummaryCache_v2', JSON.stringify(tabSummaryCache)); } catch {}
    }
    function prefetchAllTabSummaries(name, briefType, data, briefId) {
        const trackKey = `${name}__${briefType}`;
        if (briefId && tabSummaryBriefIds[trackKey] && tabSummaryBriefIds[trackKey] !== briefId) {
            invalidateTabSummaries(name, briefType);
        }
        if (briefId) { tabSummaryBriefIds[trackKey] = briefId; try { localStorage.setItem('syncview_tabSummaryBriefIds_v1', JSON.stringify(tabSummaryBriefIds)); } catch {} }
        const tabs = briefType === 'mr' ? ['overview','niche','hooks','angles','gap'] : ['exec','resonating','comments','gap','hooks'];
        tabs.forEach(tabId => _scheduleTabSummary(name, briefType, tabId, buildTabData(briefType, tabId, data)));
    }

    function getPeriodKey(c,p){return c+'__'+p;}
    function getActivePeriod(c,p){return activePeriods[getPeriodKey(c,p)]||'week';}

    function parseCSV(text) {
        const rows=[]; let field='',fields=[],inQuotes=false,i=0;
        const commit=()=>{fields.push(field.trim());field='';};
        const commitRow=()=>{commit();if(fields.some(f=>f!==''))rows.push(fields);fields=[];};
        while(i<text.length){
            const ch=text[i],next=text[i+1];
            if(inQuotes){if(ch==='"'&&next==='"'){field+='"';i+=2;continue;}if(ch==='"'){inQuotes=false;i++;continue;}field+=ch;i++;continue;}
            if(ch==='"'){inQuotes=true;i++;continue;}
            if(ch===','){commit();i++;continue;}
            if(ch==='\r'&&next==='\n'){commitRow();i+=2;continue;}
            if(ch==='\n'||ch==='\r'){commitRow();i++;continue;}
            field+=ch;i++;
        }
        if(field!==''||fields.length>0)commitRow();
        if(rows.length<2)return[];
        const headers=rows[0].map(h=>h.replace(/^"|"$/g,''));
        return rows.slice(1).map(vals=>{const obj={};headers.forEach((h,idx)=>obj[h]=vals[idx]||'');return obj;});
    }
    function n(v){const x=Number(v);return isNaN(x)?0:x;}
    function fmt(v){const x=n(v);if(!x)return null;if(x>=1e6)return(x/1e6).toFixed(1).replace(/\.0$/,'')+'M';if(x>=1e3)return(x/1e3).toFixed(1).replace(/\.0$/,'')+'K';return x.toLocaleString();}
    function fmtDate(d){if(!d)return'';const p=d.split('-');return p.length===3?`${p[2]}/${p[1]}/${p[0]}`:d;}
    function fmtCompact(v){const x=n(v);if(v===''||v===undefined||v===null)return'—';if(!x&&v!=='0'&&v!==0)return'—';if(x>=1e6)return(x/1e6).toFixed(1).replace(/\.0$/,'')+'M';if(x>=1e3)return(x/1e3).toFixed(1).replace(/\.0$/,'')+'K';return x.toLocaleString();}
    const ANALYTICS_RECEIPT_SCHEMA='syncview.analytics.receipt.v1';
    const ANALYTICS_RECEIPT_STATES=new Set(['success','genuinely_empty','provider_failed','not_configured']);
    const ANALYTICS_RECEIPT_PLATFORMS=['instagram','tiktok','youtube'];
    const ANALYTICS_RECEIPT_ERROR_CLASSES={
        instagram:new Set(['apify_no_items','apify_request_blocked','apify_http_error','apify_schema_invalid','apify_provider_error','stale_post_metrics','receipt_missing']),
        tiktok:new Set(['apify_no_items','apify_request_blocked','apify_http_error','apify_provider_error','receipt_missing']),
        youtube:new Set(['youtube_provider_error','receipt_missing'])
    };
    function _analyticsPlatformValue(value,platform){
        if(!value||typeof value!=='object'||Array.isArray(value)||!ANALYTICS_RECEIPT_STATES.has(value.state))return null;
        if(typeof value.expected!=='boolean'||typeof value.attempted!=='boolean'||typeof value.used_last_good!=='boolean')return null;
        if(!Number.isInteger(value.item_count)||value.item_count<0)return null;
        const hasFetchedAt=typeof value.fetched_at==='string'&&value.fetched_at.length>0;
        const hasSourceDate=typeof value.source_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value.source_date);
        if(!Object.prototype.hasOwnProperty.call(value,'error_class')||(value.error_class!==null&&typeof value.error_class!=='string'))return null;
        if(value.state==='not_configured'){
            if(value.expected||value.attempted||value.used_last_good||value.item_count!==0||value.fetched_at!==null||value.source_date!==null||value.error_class!==null)return null;
        }else if(value.state==='provider_failed'){
            if(!value.expected||!value.attempted||value.item_count!==0||!hasFetchedAt||!ANALYTICS_RECEIPT_ERROR_CLASSES[platform]?.has(value.error_class))return null;
            if(value.used_last_good?!hasSourceDate:value.source_date!==null)return null;
        }else{
            if(!value.expected||!value.attempted||value.used_last_good||!hasFetchedAt||!hasSourceDate||value.error_class!==null)return null;
            if(value.state==='success'&&value.item_count<1)return null;
            if(value.state==='genuinely_empty'&&value.item_count!==0)return null;
        }
        return value;
    }
    function _analyticsReceipt(row){
        if(!row)return null;
        let receipt=row.analytics_receipt;
        if(!receipt)return null;
        if(typeof receipt==='string'){
            try{receipt=JSON.parse(receipt);}catch{return null;}
        }
        if(!receipt||typeof receipt!=='object'||Array.isArray(receipt))return null;
        if(receipt.schema!==ANALYTICS_RECEIPT_SCHEMA||receipt.terminal!==true||receipt.metrics_written!==true||!receipt.platforms||typeof receipt.platforms!=='object'||Array.isArray(receipt.platforms))return null;
        if(!receipt.client_name||!row.client_name||String(receipt.client_name)!==String(row.client_name))return null;
        if(!receipt.run_date||!row.date||!/^\d{4}-\d{2}-\d{2}$/.test(String(receipt.run_date))||String(receipt.run_date)!==String(row.date).slice(0,10))return null;
        if(typeof receipt.client_key!=='string'||!receipt.client_key.trim())return null;
        const rowNumber=receipt.row_number;
        const rowKeyValid=Number.isInteger(Number(rowNumber))&&Number(rowNumber)>0&&receipt.client_key==='row:'+String(rowNumber);
        const nameKeyValid=(rowNumber===null||rowNumber==='')&&receipt.client_key==='name:'+String(receipt.client_name).trim().toLowerCase();
        if(!rowKeyValid&&!nameKeyValid)return null;
        if(typeof receipt.completed_at!=='string'||!receipt.completed_at)return null;
        if(!ANALYTICS_RECEIPT_PLATFORMS.every(platform=>_analyticsPlatformValue(receipt.platforms[platform],platform)))return null;
        const expectedResult=ANALYTICS_RECEIPT_PLATFORMS.some(platform=>receipt.platforms[platform].state==='provider_failed')?'degraded':'success';
        if(receipt.result!==expectedResult)return null;
        return receipt;
    }
    function _analyticsPlatformReceipt(row,platform){
        const receipt=_analyticsReceipt(row);
        return _analyticsPlatformValue(receipt?.platforms?.[platform],platform);
    }
    function _analyticsProviderFailed(row,platform){return _analyticsPlatformReceipt(row,platform)?.state==='provider_failed';}
    function _analyticsMetricNumber(row,platform,key){
        if(!row)return null;
        const raw=row[key];
        if(raw===''||raw===null||raw===undefined||!Number.isFinite(Number(raw)))return null;
        const receipt=_analyticsPlatformReceipt(row,platform);
        if(receipt){
            const trustedFresh=receipt.state==='success'||receipt.state==='genuinely_empty';
            const trustedFallback=receipt.state==='provider_failed'&&receipt.used_last_good===true;
            return trustedFresh||trustedFallback?Number(raw):null;
        }
        const value=Number(raw);
        return value===0?null:value;
    }
    function _analyticsHasTrustedMetrics(row,platform,keys){
        return keys.some(key=>_analyticsMetricNumber(row,platform,key)!==null);
    }
    function _analyticsTrustedReference(today,candidate,platform,key){
        if(_analyticsMetricNumber(candidate,platform,key)!==null)return candidate;
        if(!today?.client_name||!today.date||typeof clientHistory!=='function')return null;
        const cutoff=String(candidate?.date||today.date);
        const history=clientHistory(today.client_name);
        for(let i=history.length-1;i>=0;i--){
            const row=history[i];
            if(!row?.date||String(row.date)>=String(today.date)||String(row.date)>cutoff)continue;
            if(_analyticsMetricNumber(row,platform,key)!==null)return row;
        }
        return null;
    }
    function _analyticsPlatformVisible(row,platform,legacyVisible){
        const state=_analyticsPlatformReceipt(row,platform)?.state;
        if(state==='success'||state==='genuinely_empty'||state==='provider_failed')return true;
        if(state==='not_configured')return false;
        return!!legacyVisible;
    }
    function _analyticsMetricFmt(row,platform,key){
        const receipt=_analyticsPlatformReceipt(row,platform);
        const value=_analyticsMetricNumber(row,platform,key);
        if(receipt)return value===null?null:(fmt(value)||'0');
        return fmt(row?.[key]);
    }
    function _analyticsStateBadge(row,platform){
        const receipt=_analyticsPlatformReceipt(row,platform);
        if(receipt?.state!=='provider_failed')return'';
        const isStale=receipt.error_class==='stale_post_metrics';
        const label=isStale
            ? (receipt.used_last_good===true?'Delayed · last-known':'Delayed · no fresh data')
            : (receipt.used_last_good===true?'Degraded · last-known':'Degraded · no fresh data');
        return`<span class="analytics-state-badge">${label}</span>`;
    }
    function fmtIsoDate(iso){if(!iso)return'';try{const m=iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);if(m){const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];return`${parseInt(m[3])} ${months[parseInt(m[2])-1]} ${m[1]}, ${m[4]}:${m[5]}`;}return iso;}catch{return iso;}}
    function parseViewCount(v){if(!v)return 0;const s=String(v).replace(/,/g,'').trim();if(s.endsWith('M'))return parseFloat(s)*1e6;if(s.endsWith('K'))return parseFloat(s)*1e3;return parseFloat(s)||0;}
    function isPhrase(text){return(text||'').split(/\s+/).filter(w=>w.length>0).length>=3;}

    // ── Hook Template & Library ───────────────────────────────────────────────

    // Stores hook data keyed by card ID so onclick can reference it safely
    // without embedding raw JSON into HTML attribute strings.
    const _hookCardData = {};

    function _storeHookCard(cardId, clientName, hookData, transcript) {
        _hookCardData[cardId] = { clientName, hookData, transcript };
    }

    // Converts client-specific text into a bracketed template by detecting
    // proper nouns and niche-specific phrases and replacing them with [placeholders].
    // Falls back to showing the raw text if no substitutions are found.
    function formatHookTemplate(text) {
        if (!text) return '';
        // If already has brackets, show as-is with styled brackets
        if (/\[.+?\]/.test(text)) {
            return text.replace(/\[([^\]]+)\]/g, '<span class="hook-template-bracket">[$1]</span>');
        }
        // Otherwise return as plain text (N8N not yet updated to generate templates)
        return text;
    }

    function openTranscriptModal(cardId) {
        const stored = _hookCardData[cardId];
        if (!stored) return;
        const { hookData, transcript } = stored;
        const overlay = document.getElementById('transcriptOverlay');
        const title = document.getElementById('transcriptModalTitle');
        const meta = document.getElementById('transcriptModalMeta');
        const body = document.getElementById('transcriptModalBody');
        title.textContent = hookData.handle ? `@${hookData.handle}` : 'Transcript';
        const metaParts = [];
        if (hookData.views) metaParts.push(`👁 ${hookData.views}`);
        if (hookData.url) metaParts.push(`<a href="${hookData.url}" target="_blank" rel="noopener" style="color:var(--text-secondary);font-weight:600;">View reel ↗</a>`);
        meta.innerHTML = metaParts.join(' &nbsp;·&nbsp; ');
        const text = transcript || hookData.openingLine || '';
        if (text.trim()) {
            body.innerHTML = `<p>${text.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</p>`;
        } else {
            body.innerHTML = `<p class="no-transcript">Full transcript not available for this brief. Transcripts will appear here after regenerating the brief with the updated workflow.</p>`;
        }
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeTranscriptModal(e) {
        const overlay = document.getElementById('transcriptOverlay');
        if (e && (e.target !== overlay || !overlay._backdropPressBegan)) return;
        document.getElementById('transcriptOverlay').classList.remove('active');
        document.body.style.overflow = '';
    }

    function _hookSaveKey(clientName, openingLine) { return `${clientName}||${openingLine}`; }

    async function addHookToLibrary(cardId, btn) {
        const stored = _hookCardData[cardId];
        if (!stored) return;
        const { clientName, hookData } = stored;
        if (!HOOK_LIBRARY_WEBHOOK) {
            showNotify('Webhook not configured', 'Hook Library webhook not configured yet. See setup instructions.');
            return;
        }
        btn.disabled = true;
        const plusIcon = `<svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
        btn.innerHTML = `${plusIcon} Saving…`;
        try {
            const resp = await _writeUiTrackSave('briefs', 'hook_library_add', () => ({ client_slug: calClientSlug(clientName) }), () => fetch(HOOK_LIBRARY_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clientName,
                    hookType: hookData.hookType || '',
                    openingLine: hookData.openingLine || '',
                    template: hookData.stealThis || ''
                })
            }));
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const saveKey = _hookSaveKey(clientName, hookData.openingLine || '');
            console.log('[SyncView] Saving hook key:', saveKey);
            savedHooks.add(saveKey);
            try { localStorage.setItem('syncview_savedHooks', JSON.stringify([...savedHooks])); console.log('[SyncView] savedHooks persisted:', [...savedHooks]); } catch(e) { console.warn('[SyncView] savedHooks persist error:', e); }
            btn.classList.add('saved');
            btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M1.5 7.5l4 4 7-8" stroke="var(--sv-fg-10b981)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Saved!`;
        } catch(err) {
            console.warn('[SyncView] Hook library save error:', err);
            btn.disabled = false;
            btn.innerHTML = `${plusIcon} Add to library`;
            showNotify('Could not save', 'Could not save to Hook Library. Check the webhook is set up.');
        }
    }

    const ICON={
        views:`<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M8 3C3 3 1 8 1 8s2 5 7 5 7-5 7-5-2-5-7-5z" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" stroke="white" stroke-width="1.5"/></svg>`,
        likes:`<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M8 14s-5.5-3.5-5.5-7A3.5 3.5 0 0 1 8 4.5 3.5 3.5 0 0 1 13.5 7C13.5 10.5 8 14 8 14z" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
        comments:`<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M2 3h12v8H5l-3 3V3z" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
        shares:`<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M4 9l4-5 4 5M8 4v9" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    };

    /* Essentials = the two CSVs every routing path needs: metrics (for
       allData / clientHistory / clientNames) and clients info (for
       clientMap and roster resolution). Review tokens are service-role-only
       and are never sourced from this anonymously-readable CSV. Kept separate so
       a client share link landing on /v=calendar only waits for these
       two and the analytics-heavy fetches (top videos, briefs, MR briefs,
       content summaries) load in the background. */
    let _fetchExtrasPromise = null;
    let _fetchExtrasAttempt = 0;
    let _fetchExtrasState = { status: 'idle', run: null };
    /* Client links track the essentials read per entry run too: the Calendar
       tab no longer waits on it (the verified client comes from the server,
       not the sheet), so Analytics/Brief must know whether it has landed. */
    let _clientEssentialsLoad = { promise: null, status: 'idle', run: null };

    /* ── Analytics snapshot cache (stale-while-revalidate) ────────────────
       The six analytics CSVs change once a day (the morning scrape), yet
       every page load waited on all of them before painting the dashboard.
       We cache analytics CSV text plus a sanitized Clients Info row set and
       replay them through the exact same
       parsers on the next load — instant paint from yesterday's snapshot —
       while fetchAll() revalidates in the background. If the fresh texts
       differ, the analytics view re-renders once (scroll preserved, and
       never while the user is typing). Client share links (?c=…) always
       await fresh data so their client name resolves against the current roster. */
    const ANALYTICS_CACHE_KEY = 'syncview_analyticsCache_v1';
    const ANALYTICS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    const CLIENTS_INFO_FORBIDDEN_FIELDS = new Set(['client_review_token']);
    let _analyticsAppliedFp = { ess: '', ext: '' };   // fingerprint of last-applied texts
    function _analyticsFp(parts){
        let h = 5381;
        for (const s of parts) { const t = String(s || ''); for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; h = ((h << 5) + h + 31) | 0; }
        return String(h);
    }
    /* The snapshot outgrew the localStorage quota (a big roster's MR briefs
       alone run ~0.75MB of CSV), which killed caching entirely: every write
       threw, the cache was dropped, every boot re-fetched from cold, and the
       quota-exceeded warning spammed each load. Worse, a full localStorage
       endangers the OTHER writers on this origin -- including the saved
       Create Post payload, which is the only copy of what a user typed.

       Three defenses, in order:
       1. PACK. localStorage stores UTF-16, so ASCII-heavy JSON wastes half of
          every character. The snapshot is UTF-8-encoded and packed two bytes
          per code unit -- a sync, lossless, exactly-2x cut. Stored with a
          "P1:" prefix; an unprefixed legacy snapshot still hydrates.
       2. DEGRADE. If the packed snapshot still misses, retry once without
          `summaries` -- the one section hydrate treats as optional -- before
          giving up. The complete-snapshot paint rule is untouched.
       3. GO QUIET. If it still misses, drop the cache (as before) but warn
          once per session and stop re-attempting writes of at least the
          failed size, instead of serializing megabytes into a guaranteed
          exception on every load. */
    const ANALYTICS_CACHE_FAIL_KEY = 'syncview_analyticsCacheQuotaFail_v1';
    /* Typed arrays, not a string grown one character at a time. The older
       loops were the same encoding, but on the 2.5 MB Metrics sheet one cache
       write (read + unpack + pack) held the main thread for ~2.1 s, measured
       2026-09-23 -- and on a SyncLinear load that task landed between two
       pages of the deliverable read, so the third page could not even start
       until it finished. Output is byte-for-byte the old format, so snapshots
       already in a browser still read. */
    function _lsPackUtf8(text){
        const CHUNK = 8192;   // under the argument limit of fromCharCode.apply
        const str = String(text);
        // encodeURIComponent threw on a lone surrogate; TextEncoder would
        // quietly write U+FFFD instead. Keep the throw, so the caller's catch
        // still drops the write rather than caching altered text.
        if (typeof str.isWellFormed === 'function' && !str.isWellFormed()) throw new URIError('URI malformed');
        const bytes = new TextEncoder().encode(str);
        const n = bytes.length;
        const units = new Uint16Array((n + 1) >> 1);
        for (let i = 0, j = 0; i < n; i += 2, j++) {
            units[j] = (bytes[i] << 8) | (i + 1 < n ? bytes[i + 1] : 0);
        }
        let out = '';
        for (let k = 0; k < units.length; k += CHUNK) {
            out += String.fromCharCode.apply(null, units.subarray(k, k + CHUNK));
        }
        // A trailing odd byte is padded with NUL; record parity so unpack
        // knows whether to drop it.
        return (n % 2 ? 'O' : 'E') + out;
    }
    function _lsUnpackUtf8(packed){
        const parity = packed[0];
        const bytes = new Uint8Array(Math.max(0, packed.length - 1) * 2);
        for (let i = 1, j = 0; i < packed.length; i++, j += 2) {
            const u = packed.charCodeAt(i);
            bytes[j] = u >> 8;
            bytes[j + 1] = u & 0xff;
        }
        const end = parity === 'O' ? bytes.length - 1 : bytes.length;
        // fatal: bad UTF-8 throws, as decodeURIComponent did. ignoreBOM: a
        // leading U+FEFF is text here, and the old path kept it.
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, Math.max(0, end)));
    }
    function _analyticsCacheRead(){
        try{
            const raw = localStorage.getItem(ANALYTICS_CACHE_KEY);
            if (!raw) return null;
            const json = raw.slice(0, 3) === 'P1:' ? _lsUnpackUtf8(raw.slice(3)) : raw;
            return JSON.parse(json) || null;
        }catch(e){ return null; }
    }
    function _analyticsCacheWrite(partial){
        let packed = '';
        let cur = null, curAt = 0;
        try{
            cur = _analyticsCacheRead() || {};
            curAt = Number(cur.at) || 0;   // before the merge below restamps it
            if (cur.clients) cur.clients = _clientsInfoPublicRows(cur.clients);
            const next = Object.assign({}, partial || {});
            if (next.clients) next.clients = _clientsInfoPublicRows(next.clients);
            Object.assign(cur, next, { at: Date.now() });
            packed = 'P1:' + _lsPackUtf8(JSON.stringify(cur));
            let failedAt = 0;
            try { failedAt = Number(sessionStorage.getItem(ANALYTICS_CACHE_FAIL_KEY)) || 0; } catch (e) {}
            if (failedAt && packed.length >= failedAt * 0.9) {   // known-doomed this session
                // Fresh numbers headed for IndexedDB must not leave older ones
                // here, where they would paint first on the next load.
                if (next.metrics != null || next.clients != null) { try { localStorage.removeItem(ANALYTICS_CACHE_KEY); } catch (e) {} }
                if (typeof _analyticsIdbSpill === 'function') _analyticsIdbSpill(partial);
                return;
            }
            try {
                localStorage.setItem(ANALYTICS_CACHE_KEY, packed);
            } catch (quotaErr) {
                // Retry once without the optional summaries before giving up.
                delete cur.summaries;
                localStorage.setItem(ANALYTICS_CACHE_KEY, 'P1:' + _lsPackUtf8(JSON.stringify(cur)));
            }
            try { sessionStorage.removeItem(ANALYTICS_CACHE_FAIL_KEY); } catch (e) {}
        }catch(e){
            // Quota or private mode — drop the cache rather than half-write it,
            // remember the losing size, and say so once instead of every load.
            // Spill everything this key held, not just the new part: dropping
            // the key used to lose the saved numbers whenever the extras were
            // the write that overflowed, so the next load had nothing to paint.
            try { localStorage.removeItem(ANALYTICS_CACHE_KEY); } catch (e2) {}
            if (typeof _analyticsIdbSpill === 'function') _analyticsIdbSpill(Object.assign({}, cur || {}, partial || {},
                // Numbers carried over from the key keep that key's age, so a
                // move between stores never makes old numbers look fresh.
                (partial && (partial.metrics != null || partial.clients != null)) ? {} : { essAt: curAt }));
            let warned = 0;
            try {
                warned = Number(sessionStorage.getItem(ANALYTICS_CACHE_FAIL_KEY)) || 0;
                sessionStorage.setItem(ANALYTICS_CACHE_FAIL_KEY, String(packed.length || 1));
            } catch (e3) {}
            if (!warned) console.warn('[SyncView] analytics cache write skipped:', e && e.message);
        }
    }
    function _clientsInfoPublicRows(input){
        const rows = Array.isArray(input) ? input : parseCSV(String(input || ''));
        return rows.map(row => {
            const safe = {};
            Object.keys(row || {}).forEach(key => {
                if (!CLIENTS_INFO_FORBIDDEN_FIELDS.has(String(key).trim().toLowerCase())) safe[key] = row[key];
            });
            return safe;
        });
    }
    function _analyticsHydrateFromCache(){
        try{
            const c = _analyticsCacheRead();
            if (!c) return false;
            const publicClients = _clientsInfoPublicRows(c.clients);
            if (JSON.stringify(c.clients) !== JSON.stringify(publicClients)) {
                c.clients = publicClients;
                localStorage.setItem(ANALYTICS_CACHE_KEY, 'P1:' + _lsPackUtf8(JSON.stringify(c)));
            }
            if (!c.at || (Date.now() - c.at) > ANALYTICS_CACHE_TTL_MS) return false;
            /* PAINT FROM WHAT ARRIVED. The overview draws from Metrics and
               Clients Info only, so those two are all this paint needs. The
               extras used to be required here too, but they no longer fit
               localStorage: the write path keeps the numbers here and spills
               the extras to IndexedDB, and the IndexedDB path wanted both
               halves in IndexedDB. So neither saved copy ever painted, and
               every warm Analytics visit waited on the live sheets (measured
               on the live site 2026-09-24). Missing extras are read from
               IndexedDB behind the paint; a client page still waits for them
               (render() -> _analyticsExtrasArrival). */
            if (!c.metrics || !c.clients) return false;
            // Migrate older raw-CSV snapshots in place before hydration. Keep
            // the original timestamp so sanitization cannot extend freshness.
            _analyticsApplySnapshot(c, publicClients);
            console.log('[SyncView] painted from analytics snapshot cache (' + Math.round((Date.now() - c.at) / 60000) + ' min old)');
            return true;
        }catch(e){ console.warn('[SyncView] analytics cache hydrate failed:', e); return false; }
    }
    /* ESSENTIALS NOW, EXTRAS AFTER THE FIRST FRAME. The staff overview draws
       from Metrics and Clients Info only; TopVideos (15.8 MB, 56,881 rows,
       measured 2026-09-23) and the two brief sheets feed the per-client pages.
       Parsing them before the overview could paint cost ~370 ms of a ~650 ms
       cached paint. They are applied one frame later -- or at once by anything
       that reads them first (_analyticsFlushPendingExtras, called from
       render() for a client page) -- so no view ever
       draws without them. A live fetchExtras that lands first wins and the
       queued copy is dropped. */
    let _analyticsPendingExtras = null;
    let _analyticsExtrasApplied = false;
    let _analyticsLiveEssentials = false;   // set when fresh sheet texts are applied
    let _analyticsCachedAt = 0;             // saved-copy time while its numbers are on screen
    function _analyticsApplySnapshot(c, publicClients){
        _applyEssentialTexts(c.metrics, publicClients);
        _analyticsCachedAt = Number(c.at) || Date.now();
        _analyticsSyncCachedNote();
        if (!(c.topvids && c.mrbriefs)) { _analyticsIdbReadExtras(); return; }
        _analyticsPendingExtras = [c.topvids, '', c.mrbriefs, c.summaries || null];
        // Fingerprinted now, so the revalidation compare in init() sees what
        // this paint stands for even before the queued texts are parsed.
        _analyticsAppliedFp.ext = _analyticsFp([c.topvids, '', c.mrbriefs, c.summaries || '']);
        const later = () => setTimeout(_analyticsFlushPendingExtras, 0);
        if (document.hidden || typeof requestAnimationFrame !== 'function') later();
        else requestAnimationFrame(later);
    }
    function _analyticsFlushPendingExtras(){
        const p = _analyticsPendingExtras;
        if (!p) return;
        _analyticsPendingExtras = null;
        _applyExtraTexts(p[0], p[1], p[2], p[3]);
    }
    /* "Showing numbers saved at HH:MM · updating…" while a saved copy is on
       screen; "Couldn't update" if the refresh fails; gone once fresh sheets
       apply. It sits in the analytics page header (#pageTop), which every
       other tab already hides, so no other view can show it. */
    function _analyticsSyncCachedNote(failed){
        try{
            const top = document.getElementById('pageTop');
            let note = document.getElementById('analyticsCachedNote');
            if (!_analyticsCachedAt) { if (note) note.remove(); return; }
            if (!top) return;
            if (!note) {
                note = document.createElement('div');
                note.id = 'analyticsCachedNote';
                note.className = 'page-sub';
                note.setAttribute('aria-live', 'polite');
                top.appendChild(note);
            }
            const at = new Date(_analyticsCachedAt);
            const hhmm = String(at.getHours()).padStart(2, '0') + ':' + String(at.getMinutes()).padStart(2, '0');
            const time = at.toDateString() === new Date().toDateString()
                ? hhmm : at.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + hhmm;
            note.setAttribute('data-analytics-cached', failed ? 'failed' : 'updating');
            note.textContent = failed
                ? 'Couldn\u2019t update \u00b7 showing numbers saved at ' + time
                : 'Showing numbers saved at ' + time + ' \u00b7 updating\u2026';
        }catch(e){}
    }
    function _analyticsLiveApplied(){
        _analyticsCachedAt = 0;
        _analyticsSyncCachedNote();
    }
    /* THE SNAPSHOT THAT DOES NOT FIT localStorage GOES TO IndexedDB. Measured
       2026-09-23 it is 10.95 M characters packed (TopVideos alone is 15.8 MB
       raw) against a ~5.2 M-character origin budget in an ordinary browser, so
       _analyticsCacheWrite fails there on every visit and staff wait ~5 s for
       the sheets each time. The localStorage path is unchanged; only a write
       it refuses is kept here.

       THREE RECORDS, NOT ONE. `ess` (Metrics + Clients Info, ~2.6 MB) is all
       the overview needs; `ext` (TopVideos and the briefs, ~17 MB) is for the
       per-client pages. Stored as one record, the overview had to deserialize
       all of TopVideos first and painted LATER than with no copy at all
       (measured: ~2.2 s vs ~1.8 s). `meta` holds both timestamps, so freshness
       and completeness are checked without reading either body.

       Never in a client-link session: a client link never paints from a
       snapshot (init() gates on ?c=), and now it does not leave one behind
       either. Writes are serialized, so the two halves cannot interleave. */
    const ANALYTICS_IDB_NAME = 'syncview_analytics';
    const ANALYTICS_IDB_STORE = 'snapshot';
    const ANALYTICS_IDB_META = 'meta', ANALYTICS_IDB_ESS = 'ess', ANALYTICS_IDB_EXT = 'ext';
    let _analyticsIdbPromise = null;
    let _analyticsIdbChain = Promise.resolve();
    let _analyticsIdbExtRead = null;        // the saved `ext` read, while one is out
    function _analyticsIsClientSession(){
        try { return (typeof _isClientLink !== 'undefined' && !!_isClientLink)
            || !!new URLSearchParams(svRoute.search()).get('c'); } catch (e) { return true; }
    }
    function _analyticsIdbOpen(){
        if (_analyticsIdbPromise) return _analyticsIdbPromise;
        _analyticsIdbPromise = new Promise((resolve, reject) => {
            try {
                if (typeof indexedDB === 'undefined' || !indexedDB) return reject(new Error('no indexedDB'));
                const req = indexedDB.open(ANALYTICS_IDB_NAME, 1);
                req.onupgradeneeded = () => { try { req.result.createObjectStore(ANALYTICS_IDB_STORE); } catch (e) {} };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
                req.onblocked = () => reject(new Error('indexedDB blocked'));
            } catch (e) { reject(e); }
        }).catch(error => { _analyticsIdbPromise = null; throw error; });
        return _analyticsIdbPromise;
    }
    function _analyticsIdbRequest(mode, run){
        return _analyticsIdbOpen().then(db => new Promise((resolve, reject) => {
            const tx = db.transaction(ANALYTICS_IDB_STORE, mode);
            const req = run(tx.objectStore(ANALYTICS_IDB_STORE));
            tx.oncomplete = () => resolve(req ? req.result : undefined);
            tx.onerror = tx.onabort = () => reject(tx.error || new Error('indexedDB transaction failed'));
        }));
    }
    const _analyticsIdbGet = key => _analyticsIdbRequest('readonly', store => store.get(key));
    function _analyticsIdbSpill(partial){
        if (_analyticsIsClientSession() || !partial) return;
        const now = Date.now();
        const ess = (partial.metrics != null || partial.clients != null)
            ? { metrics: partial.metrics, clients: partial.clients ? _clientsInfoPublicRows(partial.clients) : partial.clients } : null;
        const ext = (partial.topvids != null || partial.briefs != null || partial.mrbriefs != null)
            ? { topvids: partial.topvids, briefs: partial.briefs, mrbriefs: partial.mrbriefs, summaries: partial.summaries || '' } : null;
        if (!ess && !ext) return;
        _analyticsIdbChain = _analyticsIdbChain
            .then(() => _analyticsIdbGet(ANALYTICS_IDB_META).catch(() => null))
            .then(meta => _analyticsIdbRequest('readwrite', store => {
                const m = Object.assign({}, (meta && typeof meta === 'object') ? meta : {});
                if (ess) { store.put(ess, ANALYTICS_IDB_ESS); m.essAt = Number(partial.essAt) || now; }
                if (ext) { store.put(ext, ANALYTICS_IDB_EXT); m.extAt = now; }
                return store.put(m, ANALYTICS_IDB_META);
            }))
            .catch(() => {});
    }
    function _analyticsIdbDelete(){
        _analyticsIdbChain = _analyticsIdbChain
            .then(() => _analyticsIdbRequest('readwrite', store => store.clear()))
            .catch(() => {});
        return _analyticsIdbChain;
    }
    /* Resolves true only if the saved overview numbers were painted: staff
       session, both halves saved and fresh, and no live sheet data applied in
       the meantime. The `ext` half is then read behind the paint and queued
       like the localStorage path's, unless live extras land first. */
    function _analyticsHydrateFromIdb(){
        if (_analyticsIsClientSession()) return Promise.resolve(false);
        const fresh = at => at && (Date.now() - at) <= ANALYTICS_CACHE_TTL_MS;
        return _analyticsIdbChain
            .then(() => _analyticsIdbGet(ANALYTICS_IDB_META))
            .then(meta => {
                // The numbers alone paint the overview; `ext` is optional.
                if (!meta || !fresh(meta.essAt)) return null;
                return _analyticsIdbGet(ANALYTICS_IDB_ESS).then(ess => ess ? { meta, ess } : null);
            })
            .then(found => {
                if (!found || _analyticsLiveEssentials) return false;
                const { meta, ess } = found;
                if (!ess.metrics || !ess.clients) return false;
                _applyEssentialTexts(ess.metrics, _clientsInfoPublicRows(ess.clients));
                _analyticsCachedAt = meta.essAt;
                _analyticsSyncCachedNote();
                _analyticsIdbReadExtras();
                console.log('[SyncView] painted from analytics IndexedDB snapshot (' + Math.round((Date.now() - meta.essAt) / 60000) + ' min old)');
                return true;
            })
            .catch(() => false);
    }
    /* Read the saved `ext` half behind a paint and queue it like the
       localStorage path's, unless live extras land first. Stale or absent,
       it never blocks the overview. */
    function _analyticsIdbReadExtras(){
        if (_analyticsIsClientSession() || _analyticsIdbExtRead) return;
        const fresh = at => at && (Date.now() - at) <= ANALYTICS_CACHE_TTL_MS;
        _analyticsIdbExtRead = _analyticsIdbChain
            .then(() => _analyticsIdbGet(ANALYTICS_IDB_META))
            .then(meta => (meta && fresh(meta.extAt)) ? _analyticsIdbGet(ANALYTICS_IDB_EXT) : null)
            .then(ext => {
                _analyticsIdbExtRead = null;
                if (!ext || _analyticsExtrasApplied || _analyticsPendingExtras) return;
                if (!ext.topvids || !ext.mrbriefs) return;
                _analyticsPendingExtras = [ext.topvids, '', ext.mrbriefs, ext.summaries || null];
                _analyticsFlushPendingExtras();
            }, () => { _analyticsIdbExtRead = null; });
    }
    /* What a client page waits on when its data is not applied yet: whichever
       arrives first of the saved `ext` half and the live sheets. */
    function _analyticsExtrasArrival(){
        // A client page wants the extras NOW. If a Kasper landing is still
        // holding them, stop holding and start the download here: some routes
        // to a client page (client search, Back into a client entry) bypass
        // navTo(), which is where the hold is otherwise released.
        if (_analyticsExtrasHold) { _analyticsReleaseExtras(); fetchExtras(null); }
        const waits = [];
        if (_analyticsIdbExtRead) waits.push(_analyticsIdbExtRead.then(() => { if (!_analyticsExtrasApplied) throw new Error('no saved extras'); }));
        if (_fetchExtrasPromise) waits.push(_fetchExtrasPromise);
        if (!waits.length) return null;
        return new Promise(resolve => {
            let left = waits.length;
            waits.forEach(w => w.then(resolve, () => { if (--left === 0) resolve(); }));
        });
    }
    /* Re-render whatever analytics view is on screen after fresh sheet data
       replaced a cached paint. Gentle by design: skipped while the user is
       typing (the next navigation shows fresh data anyway), only touches the
       analytics tab, and restores the scroll position. */
    function _analyticsRefreshCurrentView(){
        try{
            const ae = document.activeElement;
            if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
            if (currentNav !== 'home') return;
            const sc = window.scrollY;
            const c = history.state && history.state.client;
            if (c && wlIsAllowedClient(c)) render(wlCanonicalClient(c), false);
            else if (!c) navTo('home', false);
            else return;
            window.scrollTo({ top: sc, behavior: 'instant' });
            console.log('[SyncView] analytics view refreshed with fresh sheet data');
        }catch(e){ console.warn('[SyncView] analytics refresh-render failed:', e); }
    }

    function _applyEssentialTexts(metricsText, clientsText){
        const publicClientRows = _applyEssentialRows(parseCSV(metricsText), clientsText);
        _analyticsAppliedFp.ess = _analyticsFp([metricsText, JSON.stringify(publicClientRows)]);
        return publicClientRows;
    }
    function _applyEssentialRows(metricsRows, clientsText){
        allData=metricsRows;
        // Rebuild (don't accumulate): a cached paint may be replaced by fresh
        // data in the same session, and a client deleted from the sheet must
        // not linger from the snapshot.
        Object.keys(clientMap).forEach(k=>{delete clientMap[k];});
        const publicClientRows = _clientsInfoPublicRows(clientsText);
        publicClientRows.forEach(r=>{if(r.client_name)clientMap[r.client_name]=r;});
        // Clients Info is the source of truth for who's live: fold any new
        // client_name into the allowlist so a new sheet row goes live with no
        // deploy. Wrapped defensively so a cache paint that runs before the
        // allowlist consts initialise can't break the render (the fresh
        // fetchEssentials() pass merges moments later regardless).
        try { wlMergeClientsFromSheet(Object.keys(clientMap)); }
        catch(e){ console.warn('[SyncView] client allowlist merge deferred:', e && e.message); }
        // TikTok Upload is a "fast" tab (mounts via skipAwait before this fetch
        // resolves on a direct landing/refresh), and unlike the analytics/home
        // view it has no refresh hook of its own — so a client that only exists
        // in the sheet (not the WL_CLIENT_NAMES seed) stayed invisible in its
        // dropdown until *something else* happened to re-render the form. Redraw
        // it here whenever it's on screen so a fresh sheet merge shows up
        // immediately instead of only on the next unrelated form interaction.
        try { const tk = svAreaApi('tiktok'); if (tk && tk.isMounted()) tk.renderForm(); }
        catch(e){ console.warn('[SyncView] TikTok Upload roster refresh deferred:', e && e.message); }
        // Same story for the Calendar's social-profiles (globe) button: its
        // handles come from clientMap, but it was only re-synced when the
        // calendar body repainted. When the calendar painted first and this
        // sheet arrived after, the button stayed missing until a client switch.
        try { if (typeof _calSyncClientLinks === 'function') _calSyncClientLinks(); }
        catch(e){ console.warn('[SyncView] calendar profile links refresh deferred:', e && e.message); }
        // And the Templates client page's profile links, which read the same map.
        try { const tpl = svAreaApi('templates'); if (tpl) tpl.refreshSocialLinks(); }
        catch(e){ console.warn('[SyncView] templates profile links refresh deferred:', e && e.message); }
        // Add placeholder rows for clients in Clients Info sheet that don't have metrics yet
        const metricsClients=new Set(allData.map(r=>r.client_name));
        Object.keys(clientMap).forEach(name=>{
            if(!metricsClients.has(name)){
                allData.push(_blankAnalyticsRow(name));
                console.log('[SyncView] Added placeholder for new client:',name);
            }
        });
        return publicClientRows;
    }
    function _applyExtraTexts(topvidsText, briefsText, mrbText, csText){
        _applyExtraRows(parseCSV(topvidsText), parseCSV(briefsText), parseCSV(mrbText), csText!=null?parseCSV(csText):null, mrbText.length);
        _analyticsAppliedFp.ext = _analyticsFp([topvidsText, briefsText, mrbText, csText || '']);
    }
    function _applyExtraRows(rawVideos, briefRows, mrbRows, csRows, mrbChars){
        if(rawVideos.length>0)console.log('[SyncView] TopVideos cols:',Object.keys(rawVideos[0]));
        topVideos=rawVideos.map(normalizeVideoRow);
        briefs=briefRows;
        if(mrbChars!=null)console.log('[SyncView] MR briefs CSV length:',mrbChars,'chars');
        mrBriefs=mrbRows;
        console.log('[SyncView] Loaded',briefs.length,'briefs,',mrBriefs.length,'MR briefs');
        if(mrBriefs.length>0){
            console.log('[SyncView] MR brief cols:',Object.keys(mrBriefs[0]));
        }
        if(csRows!=null){
            try{
                const latest={};
                for(const r of csRows){
                    if(!r.client_name||!r.bullets)continue;
                    if(!latest[r.client_name]||(r.date||'')>(latest[r.client_name].date||''))latest[r.client_name]=r;
                }
                for(const[name,r]of Object.entries(latest)){
                    if(!contentSummaryState[name]?.data){
                        contentSummaryState[name]={loading:false,data:{bullets:r.bullets,date:r.date||''},error:null};
                    }
                }
                console.log('[SyncView] Loaded content summaries for',Object.keys(latest).length,'clients');
            }catch(e){console.warn('[SyncView] ContentSummaries load error:',e);}
        }
        _analyticsExtrasApplied = true;
    }

    /* PHASE 2: A CLIENT LINK READS ITS OWN ROWS FROM THE DATABASE
       (docs/plans/2026-09-24-sheets-to-supabase.md). Only a verified client
       link, and only while analytics_mirror_read_enabled says so (on for all,
       or {"enabled": false, "clients": [slug]} for named clients). One
       analytics-read call answers both stages for that one client, instead of
       downloading every client's Sheets.

       STAFF (the overview and every per-client page) reads the database too
       once the flag is on for everyone ({"enabled": true}) or for staff only
       ({"staff": true}, for checking it before clients see it): one
       analytics-read "overview" answer for the numbers and roster, one
       "extras" answer for videos, briefs and summaries, every client each.

       FALLBACK: the Sheets are read exactly as before when the flag is off,
       the read fails or times out, or the database has no copy yet. An empty
       dataset counts as a real "no rows" only when a complete receipt
       covers this client; otherwise that stage uses the Sheets. */
    const ANALYTICS_MIRROR_FLAG_KEY = 'analytics_mirror_read_enabled';
    const ANALYTICS_MIRROR_TIMEOUT_MS = 8000;
    let _analyticsMirrorLoad = null;   // { run, promise } for the current client entry
    async function _analyticsMirrorFlagValue(){
        let rows = (typeof _svBootFlagRows === 'function' ? await _svBootFlagRows(ANALYTICS_MIRROR_FLAG_KEY) : null);
        if (!rows) {
            const url = CAL_SUPABASE_URL + '/rest/v1/syncview_runtime_flags?select=value&key=eq.' + encodeURIComponent(ANALYTICS_MIRROR_FLAG_KEY) + '&limit=1';
            const resp = await fetch(url, { headers: { apikey: CAL_SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY, Accept: 'application/json' } });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            rows = await resp.json();
        }
        const row = Array.isArray(rows) ? rows[0] : null;
        return row ? row.value : null;
    }
    function _analyticsMirrorOnFor(value, slug){
        if (!value || typeof value !== 'object') return false;
        if (value.enabled === true) return true;
        return Array.isArray(value.clients) && value.clients.some(c => String(c).trim() === slug);
    }
    const _analyticsMirrorText = v => v == null ? '' : String(v);
    function _analyticsMirrorRows(rows){
        return (Array.isArray(rows) ? rows : []).map(r => {
            const o = {};
            Object.keys(r || {}).forEach(k => { o[k] = _analyticsMirrorText(r[k]); });
            return o;
        });
    }
    // null = use the Sheets for both stages; otherwise { ess, ext }, either
    // of which may be null (that stage uses the Sheets).
    function _analyticsMirrorRead(clientEntryRun){
        if (!clientEntryRun || typeof _isClientLink === 'undefined' || !_isClientLink) return Promise.resolve(null);
        const cap = typeof _syncviewClientEntryCapability !== 'undefined' ? _syncviewClientEntryCapability : null;
        if (!cap || !cap.verified || !cap.slug) return Promise.resolve(null);
        if (_analyticsMirrorLoad && _analyticsMirrorLoad.run === clientEntryRun) return _analyticsMirrorLoad.promise;
        const started = performance.now();
        const promise = (async () => {
            if (!_analyticsMirrorOnFor(await _analyticsMirrorFlagShared(), cap.slug)) return null;
            const token = _syncviewClientWriteToken();
            if (!token) return null;
            const controller = typeof AbortController === 'function' ? new AbortController() : null;
            const timer = controller ? setTimeout(() => controller.abort(), ANALYTICS_MIRROR_TIMEOUT_MS) : null;
            const onAbort = () => { if (controller) controller.abort(); };
            if (clientEntryRun.signal) clientEntryRun.signal.addEventListener('abort', onAbort, { once: true });
            try {
                const resp = await fetch(CAL_SUPABASE_URL + '/functions/v1/analytics-read', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Syncview-Client-Token': token },
                    cache: 'no-store',
                    signal: controller ? controller.signal : undefined,
                    body: JSON.stringify({ slug: cap.slug })
                });
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const json = await resp.json();
                if (!json || json.ok !== true || json.slug !== cap.slug || !json.data || typeof json.data !== 'object') throw new Error('unexpected answer');
                const d = json.data, rc = json.receipts || {};
                const covered = (rows, receipt) => (Array.isArray(rows) && rows.length > 0) || !!rc[receipt];
                const profile = d.client_profile;
                const ess = (profile && profile.display_name && covered(d.metrics, 'metrics')) ? {
                    metrics: _analyticsMirrorRows(d.metrics),
                    clients: [{ client_name: String(profile.display_name), instagram_handle: _analyticsMirrorText(profile.instagram_handle),
                        tiktok_handle: _analyticsMirrorText(profile.tiktok_handle), youtube_channel_id: _analyticsMirrorText(profile.youtube_channel_id),
                        content_description: _analyticsMirrorText(profile.content_description) }]
                } : null;
                const ext = (covered(d.top_videos, 'top_videos') && covered(d.market_research_briefs, 'market_research_briefs')
                    && covered(d.content_summaries, 'content_summaries')) ? {
                    topvids: _analyticsMirrorRows(d.top_videos),
                    mrbriefs: _analyticsMirrorRows(d.market_research_briefs),
                    summaries: _analyticsMirrorRows(d.content_summaries)
                } : null;
                console.log('[SyncView] analytics database read in ' + Math.round(performance.now() - started) + ' ms'
                    + (ess ? '' : '; no copy of the numbers yet, using the Sheets') + (ext ? '' : '; no copy of videos/briefs yet, using the Sheets'));
                return { ess, ext };
            } finally {
                if (timer) clearTimeout(timer);
                if (clientEntryRun.signal) clientEntryRun.signal.removeEventListener('abort', onAbort);
            }
        })().catch(e => {
            console.warn('[SyncView] analytics database read failed, using the Sheets:', e && e.message);
            return null;
        });
        _analyticsMirrorLoad = { run: clientEntryRun, promise };
        return promise;
    }

    // One flag read per page load, shared by the client and staff paths (the
    // boot batch hands each key out once).
    let _analyticsMirrorFlagPromise = null;
    function _analyticsMirrorFlagShared(){
        if (!_analyticsMirrorFlagPromise) {
            _analyticsMirrorFlagPromise = _analyticsMirrorFlagValue().catch(() => null);
        }
        return _analyticsMirrorFlagPromise;
    }
    function _analyticsMirrorStaffOn(value){
        return !!value && typeof value === 'object' && (value.enabled === true || value.staff === true);
    }
    // Rows back into the Sheet's CSV shape, so the database answer goes
    // through the same parse, fingerprint and saved-copy path as a Sheet.
    function _analyticsMirrorCsv(columns, rows){
        const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
        const lines = [columns.map(q).join(',')];
        for (const r of rows) lines.push(columns.map(c => q(Array.isArray(r) ? r[columns.indexOf(c)] : r[c])).join(','));
        return lines.join('\n');
    }
    function _analyticsMirrorProfileRow(p){
        const row = Object.assign({}, (p && typeof p.extra === 'object' && p.extra) || {});
        Object.keys(p || {}).forEach(k => {
            if (k === 'slug' || k === 'display_name' || k === 'extra') return;
            row[k] = _analyticsMirrorText(p[k]);
        });
        row.client_name = String(p.display_name || '');
        return row;
    }
    // A stuck read must not hold the overview: past this, the Sheets load instead.
    const ANALYTICS_MIRROR_STAFF_TIMEOUT_MS = { overview: 10000, extras: 20000 };
    const ANALYTICS_MIRROR_STAFF_MAX_AGE_DAYS = 3;
    let _analyticsStaffMirror = { overview: null, extras: null };
    // null = read the Sheets; otherwise CSV texts shaped like the Sheet tabs.
    function _analyticsStaffMirrorRead(scope){
        if (_analyticsIsClientSession()) return Promise.resolve(null);
        const ident = typeof _syncviewStaffIdentityForHeaders === 'function' ? _syncviewStaffIdentityForHeaders() : null;
        if (!ident || !ident.key) return Promise.resolve(null);
        if (_analyticsStaffMirror[scope]) return _analyticsStaffMirror[scope];
        const started = performance.now();
        const promise = (async () => {
            if (!_analyticsMirrorStaffOn(await _analyticsMirrorFlagShared())) return null;
            const controller = typeof AbortController === 'function' ? new AbortController() : null;
            const timer = controller ? setTimeout(() => controller.abort(), ANALYTICS_MIRROR_STAFF_TIMEOUT_MS[scope]) : null;
            try {
                const resp = await fetch(CAL_SUPABASE_URL + '/functions/v1/analytics-read', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Syncview-Key': String(ident.key) },
                    cache: 'no-store',
                    signal: controller ? controller.signal : undefined,
                    body: JSON.stringify({ scope })
                });
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const json = await resp.json();
                if (!json || json.ok !== true || json.scope !== scope || !json.data) throw new Error('unexpected answer');
                const d = json.data, rc = json.receipts || {};
                // A whole-dataset copy counts only if it finished recently: if the
                // daily copy stops, an old receipt must not vouch for stale rows.
                const oldestCopy = Date.now() - ANALYTICS_MIRROR_STAFF_MAX_AGE_DAYS * 86400000;
                const fresh = name => !!(rc[name] && Date.parse(rc[name].created_at) >= oldestCopy);
                let out = null, why = '';
                if (scope === 'overview') {
                    const m = d.metrics || {}, profiles = Array.isArray(d.client_profiles) ? d.client_profiles : [];
                    const latest = String(json.latest_metrics_date || '');
                    const oldest = new Date(Date.now() - ANALYTICS_MIRROR_STAFF_MAX_AGE_DAYS * 86400000).toISOString().slice(0, 10);
                    if (!Array.isArray(m.rows) || !m.rows.length || !profiles.length) why = 'no copy yet';
                    else if (!fresh('metrics') || !fresh('client_profiles')) why = 'no complete copy in the last ' + ANALYTICS_MIRROR_STAFF_MAX_AGE_DAYS + ' days';
                    else if (latest < oldest) why = 'copy is older than ' + ANALYTICS_MIRROR_STAFF_MAX_AGE_DAYS + ' days';
                    else out = { metrics: _analyticsMirrorCsv(m.columns, m.rows), clients: profiles.map(_analyticsMirrorProfileRow) };
                } else {
                    const tv = d.top_videos || {};
                    if (!Array.isArray(tv.rows)) why = 'no copy yet';
                    else if (!fresh('top_videos') || !fresh('market_research_briefs') || !fresh('content_summaries')) why = 'no complete copy in the last ' + ANALYTICS_MIRROR_STAFF_MAX_AGE_DAYS + ' days';
                    else out = {
                        topvids: _analyticsMirrorCsv(tv.columns, tv.rows),
                        mrbriefs: _analyticsMirrorCsv(['id', 'client_name', 'date', 'raw_json', 'raw_json_2', 'raw_json_3'], d.market_research_briefs || []),
                        summaries: _analyticsMirrorCsv(['date', 'client_name', 'bullets'], d.content_summaries || [])
                    };
                }
                console.log('[SyncView] analytics database ' + scope + ' read in ' + Math.round(performance.now() - started) + ' ms'
                    + (out ? '' : '; ' + why + ', using the Sheets'));
                return out;
            } finally {
                if (timer) clearTimeout(timer);
            }
        })().catch(e => {
            console.warn('[SyncView] analytics database ' + scope + ' read failed, using the Sheets:', e && e.message);
            return null;
        });
        // A failed or refused read is not remembered: the next load tries again.
        _analyticsStaffMirror[scope] = promise;
        promise.then(r => { if (!r) _analyticsStaffMirror[scope] = null; });
        return promise;
    }

    async function fetchEssentials(clientEntryRun){
        const mirror=await _analyticsMirrorRead(clientEntryRun);
        if(mirror&&mirror.ess){
            if(clientEntryRun&&!_syncviewClientEntryRunCurrent(clientEntryRun))throw _syncviewStaleClientEntryError();
            _analyticsLiveEssentials = true;
            _applyEssentialRows(mirror.ess.metrics, mirror.ess.clients);
            return;   // a client link never saves a copy
        }
        const staff=clientEntryRun?null:await _analyticsStaffMirrorRead('overview');
        if(staff){
            _analyticsLiveEssentials = true;
            const publicClientRows = _applyEssentialTexts(staff.metrics, staff.clients);
            _analyticsCacheWrite({ metrics: staff.metrics, clients: publicClientRows });
            return;
        }
        const requestOpts=clientEntryRun?{signal:clientEntryRun.signal}:undefined;
        const [mr,cr]=await Promise.all([fetch(METRICS_URL,requestOpts),fetch(CLIENTS_URL,requestOpts)]);
        const metricsText=await mr.text(), clientsText=await cr.text();
        if(clientEntryRun&&!_syncviewClientEntryRunCurrent(clientEntryRun))throw _syncviewStaleClientEntryError();
        _analyticsLiveEssentials = true;
        const publicClientRows = _applyEssentialTexts(metricsText, clientsText);
        _analyticsCacheWrite({ metrics: metricsText, clients: publicClientRows });
    }
    function _syncviewClientEssentials(clientEntryRun){
        const cur=_clientEssentialsLoad;
        if(cur.run===clientEntryRun&&cur.promise&&cur.status!=='error')return cur.promise;
        const load={promise:null,status:'loading',run:clientEntryRun};
        load.promise=fetchEssentials(clientEntryRun).then(() => {
            load.status='ready';
        }, err => {
            load.status=_syncviewClientEntryRunCurrent(clientEntryRun)?'error':'idle';
            throw err;
        });
        _clientEssentialsLoad=load;
        return load.promise;
    }
    // Everything the client Analytics/Brief tabs need: both Sheets stages.
    function _syncviewClientAnalyticsData(clientEntryRun){
        return Promise.all([_syncviewClientEssentials(clientEntryRun),fetchExtras(clientEntryRun)]).then(() => undefined);
    }
    async function fetchExtras(clientEntryRun){
        if (_fetchExtrasPromise) return _fetchExtrasPromise;
        const attempt=++_fetchExtrasAttempt;
        _fetchExtrasState={status:'loading',run:clientEntryRun||null};
        const request=(async () => {
            const mirror=await _analyticsMirrorRead(clientEntryRun);
            if(mirror&&mirror.ext){
                if(clientEntryRun&&!_syncviewClientEntryRunCurrent(clientEntryRun))throw _syncviewStaleClientEntryError();
                _analyticsPendingExtras = null;
                _applyExtraRows(mirror.ext.topvids, [], mirror.ext.mrbriefs, mirror.ext.summaries, null);
                return;   // a client link never saves a copy
            }
            const staff=clientEntryRun?null:await _analyticsStaffMirrorRead('extras');
            if(staff){
                _analyticsPendingExtras = null;
                _applyExtraTexts(staff.topvids, '', staff.mrbriefs, staff.summaries);
                _analyticsCacheWrite({ topvids: staff.topvids, briefs: '', mrbriefs: staff.mrbriefs, summaries: staff.summaries });
                return;
            }
            const requestOpts=clientEntryRun?{signal:clientEntryRun.signal}:undefined;
            const [tr,mrb,cs]=await Promise.all([
                fetch(TOPVIDS_URL,requestOpts),
                fetch(MR_BRIEFS_URL+'&_t='+Date.now(),requestOpts),
                fetch(CONTENT_SUMMARIES_URL+'&_t='+Date.now(),requestOpts).catch(e=>{
                    if(clientEntryRun&&(!_syncviewClientEntryRunCurrent(clientEntryRun)||clientEntryRun.signal.aborted))throw e;
                    return null;
                }),
            ]);
            if(!tr.ok||!mrb.ok)throw new Error('analytics_extras_http');
            const topvidsText=await tr.text();
            const briefsText='';   // Competitor Briefs retired
            const mrbText=await mrb.text();
            const csText=cs&&cs.ok?await cs.text():null;
            if(clientEntryRun&&!_syncviewClientEntryRunCurrent(clientEntryRun))throw _syncviewStaleClientEntryError();
            _analyticsPendingExtras = null;   // fresh texts win over a queued saved copy
            _applyExtraTexts(topvidsText, briefsText, mrbText, csText);
            _analyticsCacheWrite({ topvids: topvidsText, briefs: briefsText, mrbriefs: mrbText, summaries: csText || '' });
        })();
        const tracked=request.then(() => {
            if(attempt===_fetchExtrasAttempt&&_fetchExtrasPromise===tracked){
                _fetchExtrasState={status:'ready',run:clientEntryRun||null};
            }
        }, err => {
            if(attempt===_fetchExtrasAttempt&&_fetchExtrasPromise===tracked){
                _fetchExtrasPromise=null;
                const current=!clientEntryRun||_syncviewClientEntryRunCurrent(clientEntryRun);
                _fetchExtrasState={status:current?'error':'idle',run:current?(clientEntryRun||null):null};
            }
            throw err;
        });
        _fetchExtrasPromise=tracked;
        return _fetchExtrasPromise;
    }
    /* A Kasper landing displays none of the analytics extras (TopVideos, the
       briefs and content summaries: ~17 MB of Sheets, parsed on the main
       thread), yet starting them at boot put them on the review queue's
       critical path (speed map 2026-09-23 §5: they were the last requests to
       finish before the first card). The boot holds them until Kasper's first
       content paints, the visitor leaves Kasper, or a safety timeout -- the
       download still happens, just not in front of the queue. Anything that
       needs the extras sooner calls fetchExtras() itself, which is unaffected. */
    let _analyticsExtrasHold = null;
    function _analyticsHoldExtras(ms){
        let release;
        const promise = new Promise(resolve => { release = resolve; });
        const timer = setTimeout(() => _analyticsReleaseExtras(), ms);
        _analyticsExtrasHold = { promise, release: () => { clearTimeout(timer); release(); } };
        return promise;
    }
    function _analyticsReleaseExtras(){
        const hold = _analyticsExtrasHold;
        if (!hold) return;
        _analyticsExtrasHold = null;
        hold.release();
    }
    function fetchAll(clientEntryRun){
        // Kick off both halves in parallel so the SMM flow keeps its original
        // total time. Expose the essentials stage separately because Calendar's
        // fast boot only needs that client roster to restore its active client,
        // staff toolbar, and deferred deep links. Unrelated analytics extras may
        // be slow or fail independently.
        const essentials = clientEntryRun ? _syncviewClientEssentials(clientEntryRun) : fetchEssentials();
        const hold = typeof _analyticsExtrasHold !== 'undefined' ? _analyticsExtrasHold : null;
        const extras = (!clientEntryRun && hold)
            ? hold.promise.then(() => fetchExtras(clientEntryRun))
            : fetchExtras(clientEntryRun);
        const complete = Promise.all([essentials, extras]).then(() => undefined);
        return { essentials, complete };
    }

    function normalizeVideoRow(r){
        function pick(){for(const k of arguments){const v=r[k]??r[k.toLowerCase()]??r[k.toUpperCase()];if(v!==undefined&&v!=='')return v;}return'';}
        return{...r,client_name:pick('client_name','client'),platform:pick('platform'),period:pick('period'),rank:pick('rank','position'),video_url:pick('video_url','url','link','video_link','post_url','post_link'),caption:pick('caption','title','description','text','post_caption','post_text'),views:pick('views','view_count','video_views','play_count','plays','total_views','impressions','reach'),likes:pick('likes','like_count','total_likes','hearts','favorites','digg_count'),comments:pick('comments','comment_count','total_comments'),shares:pick('shares','share_count','total_shares','reposts','repost_count')};
    }

    function _buildHistories(){
        const map={};
        allData.forEach((r,i)=>{
            if(!map[r.client_name])map[r.client_name]=[];
            map[r.client_name].push({r,i});
        });
        const out={};
        Object.entries(map).forEach(([name,items])=>{
            items.sort((a,b)=>a.r.date.localeCompare(b.r.date)||a.i-b.i);
            const deduped=[];
            for(let i=0;i<items.length;i++){
                if(i===items.length-1||items[i].r.date!==items[i+1].r.date){
                    deduped.push(items[i]);
                }
            }
            out[name]=deduped.map(x=>x.r);
        });
        return out;
    }
    function latestPerClient(){
        const h=_buildHistories();
        // Metrics retains historical rows after a client is offboarded. The
        // overview is a current-client surface, so its membership must follow
        // the live Clients Info roster rather than every name ever scraped.
        return Object.entries(h)
            .filter(([name])=>Object.prototype.hasOwnProperty.call(clientMap,name))
            .map(([,rows])=>rows[rows.length-1]);
    }
    function prevPerClient(){const h=_buildHistories();const prev={};Object.entries(h).forEach(([name,rows])=>{if(rows.length>=2)prev[name]=rows[rows.length-2];});return prev;}
    function _findRowDaysAgo(history, daysAgo){
        if(history.length < 2) return null;
        const todayRow = history[history.length-1];
        const todayDate = new Date(todayRow.date);
        const targetDate = new Date(todayDate);
        targetDate.setDate(targetDate.getDate() - daysAgo);
        let best = null;
        for(let i = 0; i < history.length - 1; i++){
            const d = new Date(history[i].date);
            if(d <= todayDate){
                if(!best || Math.abs(d - targetDate) < Math.abs(new Date(best.date) - targetDate)){
                    best = history[i];
                }
            }
        }
        return best;
    }
    function getWeekRow(history){ return _findRowDaysAgo(history, 7); }
    function getMonthRow(history){ return _findRowDaysAgo(history, 30); }
    function _blankAnalyticsRow(name){
        return {
            client_name:name,date:'',
            analytics_receipt:'',
            ig_followers:'',ig_avg_views:'',ig_avg_likes:'',ig_views_this_month:'',ig_views_gained_today:'',
            tiktok_followers:'',tiktok_avg_plays:'',tiktok_plays_this_month:'',tiktok_plays_gained_today:'',
            yt_subscribers:'',yt_total_views:'',yt_views_gained_today:''
        };
    }
    // Compute weekly view delta that correctly handles month-boundary resets.
    // ig_views_this_month / tiktok_plays_this_month are cumulative counters that
    // reset on the 1st, so a simple subtraction breaks when the reference row is
    // in a different calendar month.  In that case we fall back to summing the
    // daily gained_today values over the past 7 days.
    function _safeWeekViewDelta(todayRow, refRow, clientName, monthlyKey, dailyKey){
        if(!refRow) return null;
        const td=new Date(todayRow.date), rd=new Date(refRow.date);
        if(td.getFullYear()===rd.getFullYear()&&td.getMonth()===rd.getMonth()){
            return n(todayRow[monthlyKey])-n(refRow[monthlyKey]);
        }
        const hist=clientHistory(clientName);
        const cutoff=new Date(td); cutoff.setDate(cutoff.getDate()-7);
        let sum=0,has=false;
        for(let i=hist.length-1;i>=0;i--){
            if(new Date(hist[i].date)<cutoff) break;
            const v=n(hist[i][dailyKey]);
            if(v){sum+=v;has=true;}
        }
        return has?sum:null;
    }
    function clientHistory(name){
        const indexed=allData.map((r,i)=>({r,i})).filter(x=>x.r.client_name===name);
        indexed.sort((a,b)=>a.r.date.localeCompare(b.r.date)||a.i-b.i);
        const deduped=[];
        for(let i=0;i<indexed.length;i++){
            if(i===indexed.length-1||indexed[i].r.date!==indexed[i+1].r.date){
                deduped.push(indexed[i]);
            }
        }
        if(!deduped.length && wlIsAllowedClient(name)) return [_blankAnalyticsRow(wlCanonicalClient(name))];
        return deduped.map(x=>x.r);
    }
    function _prevPerClientDaysAgo(daysAgo){
        const h = _buildHistories();
        const result = {};
        Object.entries(h).forEach(([name, rows]) => {
            if(rows.length < 2) return;
            const latest = rows[rows.length - 1];
            const latestDate = new Date(latest.date);
            const target = new Date(latestDate);
            target.setDate(target.getDate() - daysAgo);
            let best = null;
            for(let i = 0; i < rows.length - 1; i++){
                const d = new Date(rows[i].date);
                if(d <= latestDate){
                    if(!best || Math.abs(d - target) < Math.abs(new Date(best.date) - target)){
                        best = rows[i];
                    }
                }
            }
            if(best) result[name] = best;
        });
        return result;
    }
    function weekPrevPerClient(){ return _prevPerClientDaysAgo(7); }
    function monthPrevPerClient(){ return _prevPerClientDaysAgo(30); }

    // ── Brief helpers ────────────────────────────────────────────────────────
    // ── Market Research Brief helpers ─────────────────────────────────────────
    function getClientMRBriefs(name){
        return mrBriefs
            .filter(b=>b.client_name===name&&b.raw_json)
            .sort((a,b)=>b.id.localeCompare(a.id));
    }
    function getActiveMRBrief(name){
        const all=getClientMRBriefs(name);
        if(!all.length)return null;
        const id=activeMRBriefId[name];
        if(id){const found=all.find(b=>b.id===id);if(found)return found;}
        return all[0];
    }
    function parseMRBriefData(brief){
        if(!brief)return null;
        try{
            const p1=brief.raw_json||'';
            const p2=brief.raw_json_2||'';
            const p3=brief.raw_json_3||'';
            console.log('[SyncView] MR brief parts:',{p1len:p1.length,p2len:p2.length,p3len:p3.length,p1start:p1.substring(0,80),p2start:p2.substring(0,80)});
            const raw=p1+p2+p3;
            const data=JSON.parse(raw);
            // Override keywords with actual submitted keywords if available
            try{
                const savedKw=JSON.parse(localStorage.getItem('syncview_submittedMRKeywords_v1')||'{}');
                const clientName=data.clientName||brief.client_name||'';
                if(savedKw[clientName]&&savedKw[clientName].length>0){
                    data.keywords=savedKw[clientName];
                }
            }catch{}
            console.log('[SyncView] MR brief parsed OK, keys:',Object.keys(data),'filmingAngles:',data.filmingAngles?.length,'theGap:',data.theGap?.length);
            return data;
        }catch(e){
            const p1=brief.raw_json||'';
            const p2=brief.raw_json_2||'';
            const raw=p1+p2+(brief.raw_json_3||'');
            console.error('[SyncView] MR brief parse error',e,'rawLen:',raw.length,'last100:',raw.slice(-100));
            return null;
        }
    }
    function _updateBriefHistoryState(name){
        const s=history.state;
        if(s&&s.client===name){
            history.replaceState(Object.assign({},s,{briefSection:activeBriefSection[name],briefTab:activeBriefTab[name],mrBriefTab:activeMRBriefTab[name]}),''  );
        }
    }
    function setActiveMRBriefTab(encodedName,tab){
        const name=decodeURIComponent(encodedName);
        activeMRBriefTab[name]=tab;
        _updateBriefHistoryState(name);
        refreshBriefView(name);
    }
    function selectMRBriefById(encodedName,id){
        const name=decodeURIComponent(encodedName);
        activeMRBriefId[name]=id;
        refreshBriefView(name);
    }
    function _syncviewCancelBriefWork(){
        try{
            tabSummaryStartTimers.forEach(timer=>clearTimeout(timer));
            tabSummaryStartTimers.clear();
        }catch(e){}
        try{
            tabSummaryControllers.forEach(controller=>controller.abort());
            tabSummaryControllers.clear();
        }catch(e){}
    }

    function refreshBriefView(name){
        const container=document.getElementById('briefViewContainer');
        if(!container)return;
        container.innerHTML=renderBriefContent(name);
    }

    function _clientBriefTabAvailable(name,clientOnly){
        // Client share links show only Analytics and Content Calendar.
        if(_isClientLink)return false;
        const hasData=getClientMRBriefs(name).length>0;
        if(!clientOnly||hasData)return true;
        const cap=_syncviewClientEntryCapability;
        // A verified client document may always open its supported Brief route.
        // This keeps the tab stable while analytics extras stream in and lets
        // the existing visible empty-Brief copy own the genuine no-data case.
        return !!(_isClientLink&&cap&&cap.verified&&_syncviewClientEntrySlug(name)===cap.slug);
    }

    function _syncviewRefreshClientExtrasRoute(clientEntryRun){
        if(!_isClientLink||!_syncviewClientEntryRunCurrent(clientEntryRun))return;
        const cap=_syncviewClientEntryCapability;
        if(!cap||!cap.verified)return;
        const tab=clientViewTab[cap.client]||cap.view;
        if(tab==='analytics'||tab==='brief')render(cap.client,true);
    }

    function _syncviewWatchClientExtras(promise,clientEntryRun){
        Promise.resolve(promise).then(() => {
            if(!_syncviewClientEntryRunCurrent(clientEntryRun))return;
            _applyAllDataDependentChrome();
            _syncviewRefreshClientExtrasRoute(clientEntryRun);
        }, err => {
            if(!_syncviewClientEntryRunCurrent(clientEntryRun))return;
            console.warn('[SyncView] background fetchExtras failed',err);
            _syncviewRefreshClientExtrasRoute(clientEntryRun);
        });
    }

    function _syncviewRenderClientExtrasGate(name,tab){
        if(!_isClientLink||!['analytics','brief'].includes(tab))return false;
        const cap=_syncviewClientEntryCapability;
        const run=_syncviewClientEntryDataRun;
        if(!cap||!cap.verified||_syncviewClientEntrySlug(name)!==cap.slug||!_syncviewClientEntryRunCurrent(run)){
            _syncviewInvalidClientLinkScreen();
            return true;
        }
        const extrasState=_fetchExtrasState.run===run?_fetchExtrasState.status:'idle';
        const essState=_clientEssentialsLoad.run===run?_clientEssentialsLoad.status:'idle';
        const state=(extrasState==='error'||essState==='error')?'error'
            :(extrasState==='ready'&&essState==='ready')?'ready':'loading';
        if(state==='ready')return false;
        if(state==='error')_syncviewClientExtrasErrorScreen({client:cap.client,view:tab});
        else _syncviewClientEntryLoader({client:cap.client,view:tab},{extras:true});
        return true;
    }

    function _syncviewRetryClientExtras(){
        const cap=_syncviewClientEntryCapability;
        const run=_syncviewClientEntryDataRun;
        if(!cap||!cap.verified||!_syncviewClientEntryRunCurrent(run)){
            _syncviewInvalidClientLinkScreen();
            return;
        }
        const tab=clientViewTab[cap.client]||cap.view;
        if(!['analytics','brief'].includes(tab))return;
        const request=_syncviewClientAnalyticsData(run);
        _syncviewRenderClientExtrasGate(cap.client,tab);
        _syncviewWatchClientExtras(request,run);
    }

    function setClientViewTab(encodedName,tab){
        const name=decodeURIComponent(encodedName);
        if(!['analytics','calendar','brief'].includes(tab))return;
        if(_isClientLink){
            const cap=_syncviewClientEntryCapability;
            if(!cap||!cap.verified||_syncviewClientEntrySlug(name)!==cap.slug){_syncviewInvalidClientLinkScreen();return;}
            _syncviewSetClientEntryCapability(Object.freeze({client:cap.client,slug:cap.slug,view:tab,verified:true}));
        }
        clientViewTab[name]=tab;
        // Header nav active state is NOT changed here — it reflects where the user came from,
        // not which tab they're on within a client profile.
        const state={nav:_isClientLink?null:currentNav,client:name,clientSlug:_isClientLink?_syncviewClientEntryCapability.slug:undefined,clientTab:tab,briefSection:activeBriefSection[name],briefTab:activeBriefTab[name],mrBriefTab:activeMRBriefTab[name]};
        if(_isClientLink){
            const q=new URLSearchParams(svRoute.search());
            if(tab==='analytics')q.delete('v');else q.set('v',tab);
            q.delete('sxr');
            history.pushState(state,'','/'+'?'+q.toString());
            _syncviewSyncClientEntryRunHref();
        }else{
            history.pushState(state,'','#'+encodeURIComponent(name));
        }
        // Keep tab changes on the same guarded render path as initial boot.
        // In particular, a Calendar/Brief-only client may have no analytics
        // rows; render() owns that visible no-data state and must run before
        // renderClient() can dereference an absent "today" row.
        render(name,_isClientLink);
        window.scrollTo({top:0,behavior:'instant'});
    }

    function renderBriefContent(name){
        // Competitor Briefs retired 2026-09-24: the Keywords brief is the only one.
        return `<div>${renderMRBriefContent(name)}</div>`;
    }

    function renderMRBriefContent(name){
        const allBriefs=getClientMRBriefs(name);
        if(!allBriefs.length){return renderMRBriefGeneratePrompt(name);}
        const activeBrief=getActiveMRBrief(name);
        const data=parseMRBriefData(activeBrief);
        if(!data){return`<div class="error-state">Could not parse keywords brief. The data may be malformed.</div>`;}
        return renderMRBriefFull(name,data,allBriefs,activeBrief.id);
    }

    function renderMRBriefGeneratePrompt(name){
        return`<div class="brief-generate-prompt">
            <div class="brief-prompt-icon">🌐</div>
            <div class="brief-prompt-title">No Keywords Brief yet</div>
            <div class="brief-prompt-sub">${_isClientLink?"Your keywords brief hasn't been generated yet. Check back soon!":'No keywords brief on file for this client.'}</div>
        </div>`;
    }

    function renderMRBriefFull(name,data,allBriefs,activeId){
        prefetchAllTabSummaries(name, 'mr', data, activeId);
        const enc=encodeURIComponent(name);
        const tab=activeMRBriefTab[name]||'overview';
        const briefDate=data.date?fmtDate(data.date):(activeId?fmtIsoDate(activeId):'');
        const totalReels=data.totalReels||0;
        const igIn=data.instagramInTop||0;
        const ttIn=data.tiktokInTop||0;
        const transcribed=data.transcribedCount||0;

        let dateSelector='';
        if(allBriefs.length>1){
            const opts=allBriefs.map(b=>`<option value="${b.id}" ${b.id===activeId?'selected':''}>${fmtIsoDate(b.id)}</option>`).join('');
            dateSelector=`<select class="brief-date-select" onchange="selectMRBriefById('${enc}',this.value)">${opts}</select>`;
        }

        const tabs=[
            {id:'overview',label:'Overview'},
            {id:'niche',label:'Niche Insights'},
            {id:'hooks',label:'Hook Analysis'},
            {id:'angles',label:'Content Directions'},
            {id:'gap',label:'The Gap'},
            {id:'sources',label:'Sources'},
        ];
        const tabBar=`<div class="brief-section-tabs">${tabs.map(t=>`<button class="brief-section-tab ${tab===t.id?'active':''}" onclick="setActiveMRBriefTab('${enc}','${t.id}')">${t.label}</button>`).join('')}</div>`;

        let tabContent='';
        if(tab==='overview')tabContent=renderMRTab_overview(data,name);
        else if(tab==='niche')tabContent=renderMRTab_niche(data,name);
        else if(tab==='landscape')tabContent=renderMRTab_niche(data,name); // legacy redirect
        else if(tab==='topics')tabContent=renderMRTab_niche(data,name); // legacy redirect
        else if(tab==='hooks')tabContent=renderMRTab_hooks(data,name);
        else if(tab==='angles')tabContent=renderMRTab_angles(data,name);
        else if(tab==='gap')tabContent=renderMRTab_gap(data,name);
        else if(tab==='sources')tabContent=renderMRTab_sources(data);

        const statChips=[
            {label:'Reels Analysed',val:totalReels},
            {label:'Instagram',val:igIn},
            {label:'TikTok',val:ttIn},
            {label:'Transcribed',val:transcribed},
        ].filter(c=>c.val).map(c=>`<div class="brief-method-chip"><span class="brief-method-chip-label">${c.label}</span><span class="brief-method-chip-val">${c.val}</span></div>`).join('');
        const keywordChips=Array.isArray(data.keywords)&&data.keywords.length
            ?data.keywords.map(k=>`<div class="brief-method-chip"><span class="brief-method-chip-label">Keyword</span><span class="brief-method-chip-val">${k}</span></div>`).join('')
            :'';

        const infoChips=(statChips||keywordChips)?`<div class="brief-methodology-bar" style="margin:0;">${statChips}${keywordChips}</div>`:'';
        return`<div class="brief-wrap">
            <div class="brief-tab-header">
                ${tabBar}
                <div class="brief-tab-header-right">
                    ${dateSelector}
                    <button class="brief-info-btn" onclick="this.closest('.brief-wrap').toggleAttribute('data-show-info')" title="Brief info"><span>i</span></button>
                </div>
            </div>
            <div class="brief-info-panel">${infoChips}<span class="brief-meta-subtle">${data.clientName||name} · ${briefDate}</span></div>
            ${tabContent}
        </div>`;
    }

    // ---- window exports (generated by `node scripts/check-modules.js --write-window-exports`; do not edit) ----
    Object.assign(window, {
        _svFieldKey, _syncviewRetryClientExtras, addHookToLibrary, closeTranscriptModal, dismissConfirm,
        openTranscriptModal, selectMRBriefById, setActiveMRBriefTab, setClientViewTab,
        toggleSyncViewStatusPalette, toggleSyncViewTheme
    });
    // ── Market Research Brief Tab Renderers ───────────────────────────────────
    const _mrExternalLink=`<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M6 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3M9 2h5m0 0v5m0-5L7 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const _mrEmpty=(msg)=>`<div style="color:var(--text-muted);font-size:0.84rem;font-style:italic;padding:24px 0;">${msg||'No data in this section.'}</div>`;
    const _mrLink=(url,label)=>url?`<a class="source-link" href="${url}" target="_blank" rel="noopener">${_mrExternalLink}${label||'View ↗'}</a>`:'';
    const _mrHookBadge=(type)=>type?`<span class="mr-hook-type-badge">${type}</span>`:'';
    const _mrForClient=(text)=>text?`<div class="mr-for-client"><span class="mr-for-client-label">For this client</span>${text}</div>`:'';

    let _mrInfoCounter=0;
    const _mrInfoStore={};
    function _mrInfoBtn(reels){
        if(!reels||!reels.length)return'';
        const id='mri_'+(++_mrInfoCounter);
        _mrInfoStore[id]=reels;
        return`<button class="mr-info-btn" title="View supporting reels" onclick="event.stopPropagation();showMRInfo('${id}')">i</button>`;
    }
    function showClientInfoModal(name){
        const raw=clientMap[name]?.content_description||'No description available.';
        // Format raw text into rich HTML: detect headings (ALL CAPS lines or KEY: value patterns)
        const formatted=raw.replace(/\n/g,' ').replace(/([A-Z][A-Z\s]{3,}:)/g,'\n$1').split('\n').filter(s=>s.trim()).map(block=>{
            const headingMatch=block.match(/^([A-Z][A-Z\s&]+):\s*(.*)/);
            if(headingMatch){
                const heading=headingMatch[1].trim();
                const body=headingMatch[2].trim();
                return`<div style="margin-top:14px;"><div style="font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-bottom:4px;">${heading}</div><div style="font-size:0.84rem;color:var(--text-secondary);line-height:1.6;">${body}</div></div>`;
            }
            return`<div style="font-size:0.84rem;color:var(--text-secondary);line-height:1.6;margin-top:8px;">${block.trim()}</div>`;
        }).join('');
        const overlay=document.createElement('div');
        overlay.className='detail-info-overlay open';
        if (typeof overlay.setAttribute === 'function') overlay.setAttribute('data-backdrop-dismiss', '');
        overlay.onclick=(e)=>{if(e.target===overlay&&overlay._backdropPressBegan){overlay.remove();document.body.style.overflow='';}};
        overlay.innerHTML=`<div class="detail-info-modal"><div class="detail-info-modal-head"><span class="detail-info-modal-title">About ${name}</span><button class="detail-info-modal-close" onclick="this.closest('.detail-info-overlay').remove();document.body.style.overflow='';"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><line x1="2" y1="2" x2="12" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="12" y1="2" x2="2" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></div><div class="detail-info-modal-body">${formatted}</div></div>`;
        document.body.appendChild(overlay);
        document.body.style.overflow='hidden';
        const esc=(e)=>{if(e.key==='Escape'){overlay.remove();document.body.style.overflow='';document.removeEventListener('keydown',esc);}};
        document.addEventListener('keydown',esc);
    }

    function showMRInfo(id){
        const reels=_mrInfoStore[id];
        if(!reels||!reels.length)return;
        const reelCards=reels.map(r=>{const h=(r.handle||'unknown').replace(/^@/,'');return`<div class="mr-info-reel"><div><span class="mr-info-reel-handle">@${h}</span></div><span class="mr-info-reel-views">${r.views||'—'} views</span>${r.url?`<a class="source-link mr-info-reel-link" href="${r.url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${_mrExternalLink}View ↗</a>`:''}</div>`;}).join('');
        const overlay=document.createElement('div');
        overlay.className='mr-info-overlay';
        if (typeof overlay.setAttribute === 'function') overlay.setAttribute('data-backdrop-dismiss', '');
        overlay.onclick=(e)=>{if(e.target===overlay&&overlay._backdropPressBegan)overlay.remove();};
        overlay.innerHTML=`<div class="mr-info-modal"><div class="mr-info-modal-head"><span class="mr-info-modal-title">Supporting Reels (${reels.length})</span><button class="mr-info-modal-close" onclick="this.closest('.mr-info-overlay').remove()"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><line x1="2" y1="2" x2="12" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="12" y1="2" x2="2" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></div><div class="mr-info-modal-body">${reelCards}</div></div>`;
        document.body.appendChild(overlay);
    }

    function renderMRTab_overview(data,name){
        const raw=data.executiveSummary;
        // Support new structured format { summary, highlights } and old string format
        const isStructured = typeof raw === 'object' && raw !== null;
        const summaryText = isStructured ? (raw.summary || '') : (raw || '');
        const highlights = isStructured ? (raw.highlights || {}) : {};
        if(!summaryText && !Object.keys(highlights).length) return _mrEmpty('No executive summary available.');

        const highlightItems = [
            { key: 'landscape', label: 'Niche Insights', icon: '📊' },
            { key: 'topicClusters', label: 'Niche Insights', icon: '🗂' },
            { key: 'hooks', label: 'Hooks', icon: '🪝' },
            { key: 'filmingAngles', label: 'Content Directions', icon: '🎬' },
            { key: 'gap', label: 'The Gap', icon: '🎯' },
        ].filter(h => highlights[h.key]);
        // Deduplicate Niche Insights entries (landscape + topicClusters merged)
        const seenLabels=new Set();
        const dedupedHighlights=highlightItems.filter(h=>{if(seenLabels.has(h.label))return false;seenLabels.add(h.label);return true;});

        const highlightsHtml = dedupedHighlights.length ? `<div class="brief-exec-grid" style="margin-top:16px;">${dedupedHighlights.map(h => `
            <div class="brief-exec-card" style="padding:14px 16px;">
                <div class="brief-exec-card-eyebrow"><span class="brief-exec-card-icon">${h.icon}</span> ${h.label}</div>
                <div class="brief-exec-card-body" style="font-size:0.82rem;">${highlights[h.key]}</div>
            </div>`).join('')}</div>` : '';

        return`<div class="mr-overview-wrap">${renderTabSummary(name,'mr','overview',buildTabData('mr','overview',data))}
            ${highlightsHtml}
        </div>`;
    }

    function renderMRTab_landscape(data,name){
        const items=Array.isArray(data.landscapeAnalysis)?data.landscapeAnalysis:[];
        if(!items.length)return _mrEmpty();
        return`${renderTabSummary(name,'mr','landscape',buildTabData('mr','landscape',data))}<div class="brief-cards-grid">${items.map(item=>`
            <div class="brief-card">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                    <span class="brief-card-badge">📊 Landscape</span>
                    ${_mrInfoBtn(item.supportingReels)}
                </div>
                <div class="brief-card-label">${item.label||'—'}</div>
                ${item.what?`<div class="brief-card-body">${item.what}</div>`:''}
                ${item.emotionalTrigger?`<div class="brief-card-sub"><strong>Emotional trigger:</strong> ${item.emotionalTrigger}</div>`:''}
                ${item.sharingMechanism?`<div class="brief-card-sub"><strong>Sharing mechanism:</strong> ${item.sharingMechanism}</div>`:''}
                ${item.whyItWorks?`<div class="brief-card-sub"><strong>Why it works:</strong> ${item.whyItWorks}</div>`:''}
                ${_mrForClient(item.forClient)}
            </div>`).join('')}</div>`;
    }

    function renderMRTab_topics(data,name){
        const items=Array.isArray(data.topicClusters)?data.topicClusters:[];
        if(!items.length)return _mrEmpty();
        return`${renderTabSummary(name,'mr','topics',buildTabData('mr','topics',data))}<div class="brief-cards-grid">${items.map(item=>`
            <div class="brief-card">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span class="brief-card-badge">🗂 Cluster</span>
                        ${item.videoCount?`<span class="mr-count-chip">${item.videoCount} videos</span>`:''}
                    </div>
                    ${_mrInfoBtn(item.supportingReels)}
                </div>
                <div class="brief-card-label">${item.name||'—'}</div>
                ${item.whatWorks?`<div class="brief-card-body">${item.whatWorks}</div>`:''}
                ${item.why?`<div class="brief-card-sub"><strong>Why:</strong> ${item.why}</div>`:''}
                ${_mrForClient(item.forClient)}
            </div>`).join('')}</div>`;
    }

    function renderMRTab_niche(data,name){
        const landscape=Array.isArray(data.landscapeAnalysis)?data.landscapeAnalysis:[];
        const clusters=Array.isArray(data.topicClusters)?data.topicClusters:[];
        if(!landscape.length&&!clusters.length)return _mrEmpty();
        // Merge both into a unified list
        const items=[];
        landscape.forEach(item=>{
            const engagementTrigger=[item.emotionalTrigger,item.sharingMechanism].filter(Boolean).join(' · ');
            items.push({type:'landscape',label:item.label||'—',body:item.what||'',engagementTrigger,whyItWorks:item.whyItWorks||'',supportingReels:item.supportingReels,videoCount:null});
        });
        clusters.forEach(item=>{
            items.push({type:'cluster',label:item.name||'—',body:item.whatWorks||'',engagementTrigger:item.why||'',whyItWorks:'',supportingReels:item.supportingReels,videoCount:item.videoCount});
        });
        return`${renderTabSummary(name,'mr','niche',buildTabData('mr','niche',data))}<div class="brief-cards-grid">${items.map(item=>`
            <div class="brief-card">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span class="brief-card-badge">${item.type==='landscape'?'📊 Trend':'🗂 Cluster'}</span>
                        ${item.videoCount?`<span class="mr-count-chip">${item.videoCount} videos</span>`:''}
                    </div>
                    ${_mrInfoBtn(item.supportingReels)}
                </div>
                <div class="brief-card-label">${item.label}</div>
                ${item.body?`<div class="brief-card-body">${item.body}</div>`:''}
                ${item.engagementTrigger?`<div class="brief-card-sub"><strong>Engagement trigger:</strong> ${item.engagementTrigger}</div>`:''}
                ${item.whyItWorks?`<div class="brief-card-sub"><strong>Why it works:</strong> ${item.whyItWorks}</div>`:''}
            </div>`).join('')}</div>`;
    }

    function renderMRTab_hooks(data,name){
        const items=(Array.isArray(data.hookAnalysis)?data.hookAnalysis:[]).filter(item=>isPhrase(item.openingLine)&&parseViewCount(item.views)>=100000).sort((a,b)=>parseViewCount(b.views)-parseViewCount(a.views));
        if(!items.length)return _mrEmpty('No hook analysis data.');
        const eyeIcon=`<svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M1 10s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7z" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="10" r="2.5" stroke="currentColor" stroke-width="1.5"/></svg>`;
        const plusIcon=`<svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
        return`${renderTabSummary(name,'mr','hooks',buildTabData('mr','hooks',data))}<div class="brief-cards-grid">${items.map((item,idx)=>{
            const stealTemplate=item.stealThis?formatHookTemplate(item.stealThis):'';
            const cardId=`mr-hook-${name.replace(/\s+/g,'-')}-${idx}`;
            const _mrHookKey = _hookSaveKey(name, item.openingLine||'');
            const _mrHookSaved = savedHooks.has(_mrHookKey);
            if(_mrHookSaved) console.log('[SyncView] MR hook already saved:', _mrHookKey);
            _storeHookCard(cardId, name, {hookType:item.hookType||'',openingLine:item.openingLine||'',stealThis:item.stealThis||'',views:item.views||'',url:item.url||'',handle:item.handle||''}, item.transcript||'');
            return`<div class="hook-card" id="${cardId}">
                <div class="hook-card-header">
                    ${item.views?`<span class="hook-card-views"><svg width="13" height="13" viewBox="0 0 20 20" fill="none"><path d="M1 10s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7z" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="10" r="2.5" stroke="currentColor" stroke-width="1.5"/></svg> ${item.views}</span>`:'<span></span>'}
                    ${item.url?_mrLink(item.url,'View reel ↗'):''}
                </div>
                <div class="hook-card-body">
                    <div class="hook-text">"${item.openingLine||'—'}"</div>
                    <div class="hook-card-meta">
                        ${item.hookType?`<span class="hook-type-label">${item.hookType}</span>`:''}
                        <button class="hook-eye-btn-inline" title="View transcript" onclick="openTranscriptModal('${cardId}')">${eyeIcon}</button>
                    </div>
                </div>
                ${item.relevance?`<div class="brief-card-sub" style="margin:4px 18px 0;font-size:0.75rem;padding-top:8px;"><strong>Relevance:</strong> ${item.relevance}</div>`:''}
                ${stealTemplate?`<div class="hook-steal-wrap"><div class="hook-steal-label">Template</div><div class="hook-template-text">${stealTemplate}</div></div>`:''}
                <div class="hook-card-actions">
                    ${item.stealThis?`<button class="hook-add-btn${_mrHookSaved?' saved':''}" ${_mrHookSaved?'disabled':''} onclick="addHookToLibrary('${cardId}',this)">${_mrHookSaved?`<svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M1.5 7.5l4 4 7-8" stroke="var(--sv-fg-10b981)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Saved!`:`${plusIcon} Add to library`}</button>`:''}
                </div>
            </div>`;
        }).join('')}</div>`;
    }

    function renderMRTab_angles(data,name){
        const items=Array.isArray(data.filmingAngles)?data.filmingAngles:[];
        if(!items.length)return _mrEmpty('No content directions data.');
        return`${renderTabSummary(name,'mr','angles',buildTabData('mr','angles',data))}<div style="display:flex;flex-direction:column;gap:8px;">${items.map(item=>{
            // Extract a short "based on" reference from whyThisWorks
            const basedOn=item.whyThisWorks?(item.whyThisWorks.match(/based on (?:the )?([^—–\-\.]+?(?:\([^)]*\))?)\s*(?:[—–\-,\.]|$)/i)||[])[1]||'':'';
            return`<div class="mr-angle-card">
                <span class="mr-angle-num">${item.number||'?'}</span>
                <div class="mr-angle-content">
                    ${item.angle?`<div class="mr-angle-title">${item.angle}</div>`:''}
                    ${item.hook?`<div class="mr-angle-hook">"${item.hook}"</div>`:''}
                    ${basedOn?`<div class="mr-angle-based">Based on: ${basedOn.trim()}</div>`:''}
                </div>
            </div>`;
        }).join('')}</div>`;
    }

    function renderMRTab_gap(data,name){
        const items=Array.isArray(data.theGap)?data.theGap:[];
        if(!items.length)return _mrEmpty();
        return`${renderTabSummary(name,'mr','gap',buildTabData('mr','gap',data))}<div class="brief-cards-grid">${items.map(item=>`
            <div class="brief-card mr-gap-card">
                <span class="mr-gap-badge">🕳 Gap</span>
                <div class="brief-card-label">${item.label||'—'}</div>
                ${item.gap?`<div class="brief-card-body">${item.gap}</div>`:''}
                ${item.opportunity?`<div class="mr-opportunity"><strong>Opportunity:</strong> ${item.opportunity}</div>`:''}
            </div>`).join('')}</div>`;
    }

    function renderMRTab_sources(data){
        const m=data.methodology||{};
        const sources=Array.isArray(data.sources)?data.sources:[];
        if(!sources.length)return _mrEmpty('No sources data.');
        let html='';
        if(m.totalReels||m.dateRange||m.keywords?.length){
            html+=`<div class="brief-methodology-bar">${m.dateRange?`<div class="brief-method-chip"><span class="brief-method-chip-label">Date Range</span><span class="brief-method-chip-val">${m.dateRange}</span></div>`:''}${m.totalReels?`<div class="brief-method-chip"><span class="brief-method-chip-label">Reels Analysed</span><span class="brief-method-chip-val">${m.totalReels}</span></div>`:''}${m.keywords?.length?`<div class="brief-method-chip"><span class="brief-method-chip-label">Keywords</span><span class="brief-method-chip-val">${m.keywords.length}</span></div>`:''}</div>`;
        }
        html+=`<div class="brief-section-header" style="margin-top:16px;">Top Performing Reels</div><div class="brief-cards-grid">${sources.map(s=>{
            const outlierHtml=(()=>{
                if(!s.views||!s.accountAvg)return '';
                const rv=parseViewCount(s.views),av=parseViewCount(s.accountAvg);
                if(!av||!rv)return '';
                const ratio=rv/av;
                if(ratio<1.5)return '';
                const cls=ratio>=5?'mega':ratio>=3?'strong':'';
                return `<span class="source-outlier-pill ${cls}">${ratio.toFixed(1)}x avg</span>`;
            })();
            return `<div class="source-card">
                <div class="source-card-header">
                    <div class="source-card-left">
                        <span class="source-rank-badge">#${s.rank||s.reelNumber||'?'}</span>
                        <span class="source-handle">${s.handle||'—'}</span>
                    </div>
                    <span class="source-views-badge"><svg width="13" height="13" viewBox="0 0 20 20" fill="none"><path d="M1 10s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7z" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="10" r="2.5" stroke="currentColor" stroke-width="1.5"/></svg> ${s.views||'—'}</span>
                </div>
                ${outlierHtml||s.accountAvg?`<div class="source-meta-row">${s.accountAvg?`<span style="font-size:0.7rem;color:var(--text-muted);">avg ${s.accountAvg}</span>`:''}${outlierHtml}</div>`:''}
                ${s.url?`${_mrLink(s.url,'View Reel')}`:''}</div>`;
        }).join('')}</div>`;
        return html;
    }


    /* True only while a client page is drawn from Metrics before TopVideos
       and the briefs have applied (render()'s early paint). Sections that
       read them show a placeholder instead of "none", and actions that send
       them wait. Never set for a client link, which always waits. */
    let _analyticsExtrasEarly=false;
    const _analyticsExtrasSkelHtml=id=>`<div class="top-videos-section" id="${id}" aria-busy="true"><div class="top-videos-head"><span class="top-videos-title">Top Performing</span></div><div class="sv-skeleton sv-skeleton-line" style="width:72%;"></div><div class="sv-skeleton sv-skeleton-line" style="width:54%;"></div></div>`;
    function getTopVideos(clientName,platform,period){
        const plat=platform.toLowerCase(),per=period.toLowerCase();
        let filtered=topVideos.filter(v=>v.client_name===clientName&&(v.platform||'').toLowerCase()===plat&&(v.period||'').toLowerCase().includes(per));
        // Only use videos from the latest scrape date for this client+platform+period
        const latestDate=filtered.reduce((max,v)=>{const d=v.scraped_date||'';return d>max?d:max;},'');
        if(latestDate)filtered=filtered.filter(v=>(v.scraped_date||'')===latestDate);
        // Deduplicate by video_url (same post can appear multiple times in sheet)
        const seen=new Map();
        for(const v of filtered){
            const key=(v.video_url&&v.video_url!=='#'&&v.video_url!=='')?v.video_url:(v.caption||'').substring(0,80);
            if(!seen.has(key)||n(v.views)>n(seen.get(key).views))seen.set(key,v);
        }
        // Sort by views descending so highest-viewed content comes first
        return [...seen.values()].sort((a,b)=>n(b.views)-n(a.views));
    }

    // ── FIX: Sort columns now use _ig_view_delta and _tt_view_delta
    // instead of the unreliable ig_views_gained_today / tiktok_plays_gained_today fields
    const SORT_COLS={
        'client_name':            {label:'Name'},
        'ig_followers':           {label:'IG Followers'},
        '_ig_fol_delta':          {label:'IG +Followers'},
        'ig_views_this_month':    {label:'IG Views/30d'},
        '_ig_view_delta':         {label:'IG +Views'},
        'tiktok_followers':       {label:'TT Followers'},
        '_tt_fol_delta':          {label:'TT +Followers'},
        'tiktok_plays_this_month':{label:'TT Views/30d'},
        '_tt_view_delta':         {label:'TT +Views'},
        'yt_subscribers':         {label:'YT Subscribers'},
        '_yt_sub_delta':          {label:'YT +Subscribers'},
        'yt_total_views':         {label:'YT Views'},
        '_yt_view_delta':         {label:'YT +Views'},
    };
    const PSEUDO_COLS=new Set(['_ig_fol_delta','_tt_fol_delta','_ig_view_delta','_tt_view_delta']);

    function sortedRows(rows){
        const prevMap=gainPeriod==='week'?weekPrevPerClient():prevPerClient();
        const mPrevMap=monthPrevPerClient();
        function val(r,col){
            if((col.startsWith('ig_')||col.startsWith('_ig_'))&&_analyticsProviderFailed(r,'instagram'))return -Infinity;
            if(col==='_ig_fol_delta'){const p=_analyticsTrustedReference(r,prevMap[r.client_name],'instagram','ig_followers');if(!p)return -Infinity;return n(r.ig_followers)-n(p.ig_followers);}
            if(col==='_tt_fol_delta'){const p=prevMap[r.client_name];if(!p)return -Infinity;return n(r.tiktok_followers)-n(p.tiktok_followers);}
            // Day mode: use the direct gained_today field (accurate single-day value from sheet)
            // Week mode: use _safeWeekViewDelta to handle month-boundary resets
            if(col==='_ig_view_delta'){if(!_analyticsHasTrustedMetrics(r,'instagram',['ig_followers','ig_views_this_month']))return -Infinity;if(gainPeriod==='day'){return n(r.ig_views_gained_today)||0;}const p=_analyticsTrustedReference(r,prevMap[r.client_name],'instagram','ig_views_this_month');if(!p)return -Infinity;return _safeWeekViewDelta(r,p,r.client_name,'ig_views_this_month','ig_views_gained_today')||0;}
            if(col==='_tt_view_delta'){if(!n(r.tiktok_followers)&&!n(r.tiktok_plays_this_month))return -Infinity;if(gainPeriod==='day'){return n(r.tiktok_plays_gained_today)||0;}const p=prevMap[r.client_name];if(!p)return -Infinity;return _safeWeekViewDelta(r,p,r.client_name,'tiktok_plays_this_month','tiktok_plays_gained_today')||0;}
            // Views/30d columns: sort by 30-day delta
            if(col==='ig_views_this_month'){const mp=_analyticsTrustedReference(r,mPrevMap[r.client_name],'instagram','ig_views_this_month');if(!_analyticsHasTrustedMetrics(r,'instagram',['ig_followers','ig_views_this_month']))return -Infinity;if(!mp)return n(r.ig_views_this_month);return n(r.ig_views_this_month)-n(mp.ig_views_this_month);}
            if(col==='tiktok_plays_this_month'){const mp=mPrevMap[r.client_name];if(!n(r.tiktok_followers)&&!n(r.tiktok_plays_this_month))return -Infinity;if(!mp)return n(r.tiktok_plays_this_month);return n(r.tiktok_plays_this_month)-n(mp.tiktok_plays_this_month);}
            if(col.startsWith('ig_')&&!_analyticsHasTrustedMetrics(r,'instagram',['ig_followers','ig_views_this_month']))return -Infinity;
            if(col.startsWith('tiktok_')&&!n(r.tiktok_followers)&&!n(r.tiktok_plays_this_month))return -Infinity;
            if(col==='_yt_sub_delta'){const p=prevMap[r.client_name];if(!n(r.yt_subscribers)&&!n(r.yt_total_views))return -Infinity;if(!p)return -Infinity;return n(r.yt_subscribers)-n(p.yt_subscribers);}
            if(col==='_yt_view_delta'){const p=prevMap[r.client_name];if(!n(r.yt_subscribers)&&!n(r.yt_total_views))return -Infinity;if(!p)return -Infinity;return n(r.yt_total_views)-n(p.yt_total_views);}
            if(col.startsWith('yt_')&&!n(r.yt_subscribers)&&!n(r.yt_total_views))return -Infinity;
            return n(r[col]);
        }
        return[...rows].sort((a,b)=>{
            if(sortCol==='client_name'){const r=a.client_name.localeCompare(b.client_name);return sortDir==='asc'?r:-r;}
            const va=val(a,sortCol),vb=val(b,sortCol);
            if(va===-Infinity&&vb===-Infinity)return 0;
            if(va===-Infinity)return 1;
            if(vb===-Infinity)return -1;
            return sortDir==='asc'?va-vb:vb-va;
        });
    }

    let viewMode=localStorage.getItem('syncview_viewMode')||'table';
    let gainMode=localStorage.getItem('syncview_gainMode')||'day';
    let gainPeriod=localStorage.getItem('syncview_gainPeriod')||'day';
    function setGainPeriod(p){ gainPeriod=p; localStorage.setItem('syncview_gainPeriod',p); render('all'); }
    function setSort(col){
        if(sortCol===col){_setSortDir(sortDir==='desc'?'asc':'desc');}
        else{_setSortCol(col);_setSortDir(col==='client_name'?'asc':'desc');}
        const _m=document.getElementById('sortDropMenu'),_t=document.getElementById('sortDropTrigger');
        if(_m){_m.classList.remove('open');}if(_t){_t.classList.remove('open');}
        render('all');
    }

    function setViewMode(mode){viewMode=mode;localStorage.setItem('syncview_viewMode',mode);render('all');}
    function setGainMode(mode){gainMode=mode;localStorage.setItem('syncview_gainMode',mode);render('all');}
    function controlsHTML(){
        const tableIcon=`<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.3"/><line x1="1" y1="6" x2="15" y2="6" stroke="currentColor" stroke-width="1.3"/><line x1="1" y1="10" x2="15" y2="10" stroke="currentColor" stroke-width="1.3"/><line x1="6" y1="2" x2="6" y2="14" stroke="currentColor" stroke-width="1.3"/></svg>`;
        const cardIcon=`<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.3"/><rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.3"/><rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.3"/><rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.3"/></svg>`;
        const periodToggle=`<div style="display:inline-flex;align-items:center;border-radius:20px;overflow:hidden;background:var(--white);box-shadow:0 1px 3px var(--sv-shadow-rgba-0-0-0-0_06);border:1px solid var(--border);">
            <button style="padding:4px 12px;border:none;font-family:'Plus Jakarta Sans',sans-serif;font-size:0.72rem;font-weight:600;cursor:pointer;transition:all 0.13s;${gainPeriod==='day'?'background:var(--text-primary);color:var(--white);':'background:transparent;color:var(--text-muted);'}" onclick="setGainPeriod('day')">Day</button>
            <button style="padding:4px 12px;border:none;font-family:'Plus Jakarta Sans',sans-serif;font-size:0.72rem;font-weight:600;cursor:pointer;transition:all 0.13s;${gainPeriod==='week'?'background:var(--text-primary);color:var(--white);':'background:transparent;color:var(--text-muted);'}" onclick="setGainPeriod('week')">Week</button>
        </div>`;
        return `<div class="overview-controls"><div class="controls-left">${periodToggle}</div><div class="view-toggle"><button class="view-toggle-btn ${viewMode==='table'?'active':''}" onclick="setViewMode('table')" title="Table">${tableIcon}</button><button class="view-toggle-btn ${viewMode==='cards'?'active':''}" onclick="setViewMode('cards')" title="Cards">${cardIcon}</button></div></div>`;
    }

    function renderCardView(rows,deltaMap){
        const prevMap=prevPerClient();
        const mPrevMap=monthPrevPerClient();
        return `<div class="cards-grid">${rows.map((r,idx)=>{
            const p=(deltaMap||prevMap)[r.client_name]||null;
            const mp=mPrevMap[r.client_name]||null;
            const rankBadge=idx<3?`<span class="card-rank card-rank-${idx+1}">${idx+1}</span>`:'';
            // ── FIX: mh uses correct '-' sign for losses
            const mh=(label,key,platform)=>{const f=platform?_analyticsMetricFmt(r,platform,key):fmt(r[key]);if(!f)return'';let gh='';const ref=platform?_analyticsTrustedReference(r,p,platform,key):p;const suppressDelta=platform&&_analyticsProviderFailed(r,platform);if(ref&&!suppressDelta){const d=n(r[key])-n(ref[key]);if(d===0)gh=`<span class="card-metric-gain flat">±0</span>`;else{const s=d>0?'+':'-';gh=`<span class="card-metric-gain ${d>0?'up':'down'}">${s}${fmt(Math.abs(d))||Math.abs(d).toLocaleString()}</span>`;}}else{gh=`<span class="card-metric-gain flat" style="opacity:0.35;font-weight:400">—</span>`;}return`<div class="card-metric"><span class="card-metric-label">${label}</span><span class="card-metric-val">${f}</span>${gh}</div>`;};
            // mhValDiff: delta from monthly totals vs prev row (used for week mode)
            const mhValDiff=(label,valueKey)=>{const f=fmt(r[valueKey]);if(!f)return'';let gh='';if(p){const d=n(r[valueKey])-n(p[valueKey]);const s=d>0?'+':'-';const cls=d>0?'up':d<0?'down':'flat';gh=d===0?`<span class="card-metric-gain flat">±0</span>`:`<span class="card-metric-gain ${cls}">${s}${fmt(Math.abs(d))||Math.abs(d).toLocaleString()}</span>`;}else{gh=`<span class="card-metric-gain flat" style="opacity:0.35;font-weight:400">—</span>`;}return`<div class="card-metric"><span class="card-metric-label">${label}</span><span class="card-metric-val">${f}</span>${gh}</div>`;};
            // mhWithDelta: show a pre-computed delta value (used for day mode with gained_today field)
            const mhWithDelta=(label,valueKey,deltaVal)=>{const f=fmt(r[valueKey]);if(!f)return'';let gh='';if(deltaVal!==null&&deltaVal!==undefined){const d=n(deltaVal);const s=d>0?'+':'-';const cls=d>0?'up':d<0?'down':'flat';gh=d===0?`<span class="card-metric-gain flat">±0</span>`:`<span class="card-metric-gain ${cls}">${s}${fmt(Math.abs(d))||Math.abs(d).toLocaleString()}</span>`;}else{gh=`<span class="card-metric-gain flat" style="opacity:0.35;font-weight:400">—</span>`;}return`<div class="card-metric"><span class="card-metric-label">${label}</span><span class="card-metric-val">${f}</span>${gh}</div>`;};
            // mhViews30d: show 30-day rolling views (computed delta) with day/week gain indicator
            const mhViews30d=(label,curKey,monthPrev,deltaVal,platform)=>{const typed=platform&&_analyticsPlatformReceipt(r,platform);if(typed?.state==='provider_failed'&&typed.used_last_good!==true)return`<div class="card-metric"><span class="card-metric-label">${label}</span><span class="card-metric-val">—</span></div>`;const ref=platform?_analyticsTrustedReference(r,monthPrev,platform,curKey):monthPrev;const views30d=ref?n(r[curKey])-n(ref[curKey]):n(r[curKey]);const trusted=platform?_analyticsMetricNumber(r,platform,curKey)!==null:false;const f=trusted?(fmt(views30d)||'0'):(views30d>0?fmt(views30d):null);if(!f)return'';let gh='';const suppressDelta=platform&&_analyticsProviderFailed(r,platform);if(!suppressDelta&&deltaVal!==null&&deltaVal!==undefined){const d=n(deltaVal);const s=d>0?'+':'-';const cls=d>0?'up':d<0?'down':'flat';gh=d===0?`<span class="card-metric-gain flat">±0</span>`:`<span class="card-metric-gain ${cls}">${s}${fmt(Math.abs(d))||Math.abs(d).toLocaleString()}</span>`;}else{gh=`<span class="card-metric-gain flat" style="opacity:0.35;font-weight:400">—</span>`;}return`<div class="card-metric"><span class="card-metric-label">${label}</span><span class="card-metric-val">${f}</span>${gh}</div>`;};
            const hasIG=_analyticsPlatformVisible(r,'instagram',n(r.ig_followers)||n(r.ig_views_this_month)),hasTT=n(r.tiktok_followers)||n(r.tiktok_plays_this_month),hasYT=n(r.yt_subscribers)||n(r.yt_total_views);
            let pl='';
            const cardIsAgeRestricted=r.client_name.toLowerCase()==='john wineland';
            const cardInfo=clientMap[r.client_name]||{};
            const cardIgH=cardInfo.instagram_handle||'',cardTtH=cardInfo.tiktok_handle||'',cardYtId=cardInfo.youtube_channel_id||'';
            const platLink=(url,label)=>url?`<a href="${url}" target="_blank" rel="noopener" style="font-size:0.58rem;font-weight:600;color:var(--sv-fg-rgba-255-255-255-0_55);text-decoration:none;letter-spacing:0.02em;white-space:nowrap;transition:color 0.15s;" onmouseover="this.style.color='var(--sv-fg-rgba-255-255-255-0_9)'" onmouseout="this.style.color='var(--sv-fg-rgba-255-255-255-0_55)'">${label}</a>`:'';
            const igFailed=_analyticsProviderFailed(r,'instagram');
            const igViewsRef=_analyticsTrustedReference(r,p,'instagram','ig_views_this_month');
            const igViewsDelta=igFailed?null:(gainPeriod==='day'?n(r.ig_views_gained_today):_safeWeekViewDelta(r,igViewsRef,r.client_name,'ig_views_this_month','ig_views_gained_today'));
            const ttViewsDelta=gainPeriod==='day'?n(r.tiktok_plays_gained_today):_safeWeekViewDelta(r,p,r.client_name,'tiktok_plays_this_month','tiktok_plays_gained_today');
            if(hasIG){pl+=`<div class="card-platform cp-ig${igFailed?' is-degraded':''}"><div style="display:flex;align-items:center;justify-content:space-between;width:100%;margin-bottom:2px;"><span style="display:inline-flex;align-items:center;gap:6px;"><span class="card-platform-label" style="margin-bottom:0">Instagram</span>${_analyticsStateBadge(r,'instagram')}</span>${platLink(cardIgH?'https://instagram.com/'+cardIgH:null,'@'+cardIgH)}</div>${mh('Followers','ig_followers','instagram')}${mhViews30d('Views Last 30d','ig_views_this_month',mp,igViewsDelta,'instagram')}</div>`;}
            else if(cardIsAgeRestricted){pl+=`<div class="card-platform cp-ig" style="display:flex;align-items:center;gap:8px;flex-wrap:nowrap;"><span class="card-platform-label" style="width:auto;margin:0;">Instagram</span><span style="font-size:0.6rem;font-weight:700;color:var(--ig-dark);background:var(--ig-mid);border-radius:4px;padding:2px 7px;white-space:nowrap;">🔞 Age-restricted</span></div>`;}
            if(hasTT)pl+=`<div class="card-platform cp-tt"><div style="display:flex;align-items:center;justify-content:space-between;width:100%;margin-bottom:2px;"><span class="card-platform-label" style="margin-bottom:0">TikTok</span>${platLink(cardTtH?'https://tiktok.com/@'+cardTtH:null,'@'+cardTtH)}</div>${mh('Followers','tiktok_followers')}${mhViews30d('Views Last 30d','tiktok_plays_this_month',mp,ttViewsDelta)}</div>`;
            const cardYtSplit=r.client_name==='Dr. Sonia Chopra';
            const cardYtViewMetrics=cardYtSplit?`${mh('Shorts 30d','yt_shorts_views')}${mh('Podcasts 30d','yt_longs_views')}`:mh('Views','yt_total_views');
            if(hasYT)pl+=`<div class="card-platform cp-yt"><div style="display:flex;align-items:center;justify-content:space-between;width:100%;margin-bottom:2px;"><span class="card-platform-label" style="margin-bottom:0">YouTube</span>${platLink(cardYtId?'https://youtube.com/channel/'+cardYtId:null,'Channel ↗')}</div>${mh('Subs','yt_subscribers')}${cardYtViewMetrics}</div>`;
            if(!pl&&!r.date)pl=`<div style="padding:12px 0 4px;text-align:center;font-size:0.75rem;color:var(--text-muted);font-weight:500;">Metrics data pending</div>`;
            const _cmkSocI=(url,svg,ttl)=>url?`<a href="${url}" target="_blank" rel="noopener" title="${ttl}" style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;flex-shrink:0;color:var(--text-muted);text-decoration:none;">${svg}</a>`:`<span title="${ttl}" style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;flex-shrink:0;color:var(--text-muted);">${svg}</span>`;
            const _cigSvg=`<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="3.5" width="17" height="17" rx="5" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="2"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor"/></svg>`;
            const _cttSvg=`<svg width="13" height="13" viewBox="0 0 24 24"><path d="M19.6 6.7A4.8 4.8 0 0 1 15.8 2.5h-3.4v13.1a2.9 2.9 0 1 1-2.1-2.8V9.4A6.3 6.3 0 0 0 4 15.6a6.3 6.3 0 0 0 6.3 6.4 6.3 6.3 0 0 0 6.3-6.4V9.1a8.3 8.3 0 0 0 4.8 1.5V7.2a4.8 4.8 0 0 1-1.8-.5z" fill="currentColor"/></svg>`;
            const _cytSvg=`<svg width="13" height="13" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>`;
            const _cigSocI=hasIG&&!cardIsAgeRestricted?_cmkSocI(cardIgH?`https://instagram.com/${cardIgH}`:null,_cigSvg,'Instagram'):'';
            const _cttSocI=hasTT?_cmkSocI(cardTtH?`https://tiktok.com/@${cardTtH}`:null,_cttSvg,'TikTok'):'';
            const _cytSocI=hasYT?_cmkSocI(cardYtId?`https://youtube.com/channel/${cardYtId}`:null,_cytSvg,'YouTube'):'';
            const _cSocIcons=_cigSocI||_cttSocI||_cytSocI?`<span style="display:inline-flex;align-items:center;gap:4px;">${_cigSocI}${_cttSocI}${_cytSocI}</span>`:'';
            return `<div class="client-card"><div class="card-head"><div style="display:flex;align-items:center;gap:6px;">${rankBadge}<a class="card-client-name card-client-link" href="/#${encodeURIComponent(r.client_name)}" onclick="if(_modClick(event))return;event.preventDefault();selectClient(${_jsAttrArg(r.client_name)})">${_calEsc(r.client_name)}</a><button class="card-eye-btn" onclick="selectClient(${_jsAttrArg(r.client_name)})" title="View ${_calEscAttr(r.client_name)}"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 3C3 3 1 8 1 8s2 5 7 5 7-5 7-5-2-5-7-5z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.4"/></svg></button>${_cSocIcons}</div><span class="card-date">${fmtDate(r.date)}</span></div><div class="card-platforms">${pl}</div></div>`;
        }).join('')}</div>`;
    }

    function igUrl(h){return h?`https://instagram.com/${h}`:null;}
    function ttUrl(h){return h?`https://tiktok.com/@${h}`:null;}
    function ytUrl(id){return id?`https://youtube.com/channel/${id}`:null;}
    function handleLink(url,label){if(!url)return'';return`<a href="${url}" target="_blank" rel="noopener" class="platform-handle-link">${label}</a>`;}

    function deltaBadge(today,prev,key){
        if(!prev)return`<span class="m-delta none">no previous day yet</span>`;
        const diff=n(today[key])-n(prev[key]);
        if(diff===0)return`<span class="m-delta flat">no change</span>`;
        // ── FIX: correct '-' sign for losses
        const sign=diff>0?'+':'-',cls=diff>0?'up':'down',arr=diff>0?'↑':'↓';
        return`<span class="m-delta ${cls}">${arr} ${sign}${fmt(Math.abs(diff))||Math.abs(diff).toLocaleString()}</span>`;
    }
    function mBlock(label,today,prev,key,platform){const f=platform?_analyticsMetricFmt(today,platform,key):fmt(today[key]);const ref=platform?_analyticsTrustedReference(today,prev,platform,key):prev;const suppressDelta=platform&&_analyticsProviderFailed(today,platform);return`<div class="metric-block"><div class="m-label">${label}</div><div class="m-value ${f?'':'empty'}">${f||'—'}</div>${f&&!suppressDelta?deltaBadge(today,ref,key):''}</div>`;}
    function mBlockNoD(label,today,key,platform){const f=platform?_analyticsMetricFmt(today,platform,key):fmt(today[key]);return`<div class="metric-block"><div class="m-label">${label}</div><div class="m-value ${f?'':'empty'}">${f||'—'}</div></div>`;}

    // ── FIX: gainCell now shows '-' for negative deltas
    function gainCell(today,prev,key,cls,platform){
        const f=platform?_analyticsMetricFmt(today,platform,key):fmt(today[key]);
        const ref=platform?_analyticsTrustedReference(today,prev,platform,key):prev;
        if(platform&&_analyticsProviderFailed(today,platform))return`<td class="${cls}"><span class="g-none">—</span></td>`;
        if(!f||!ref)return`<td class="${cls}"><span class="g-none">—</span></td>`;
        const diff=n(today[key])-n(ref[key]);
        if(diff===0)return`<td class="${cls}"><span class="g-none">±0</span></td>`;
        const sign=diff>0?'+':'-';
        return`<td class="${cls}"><span class="${diff>0?'g-up':'g-down'}">${sign}${fmt(Math.abs(diff))||Math.abs(diff).toLocaleString()}</span></td>`;
    }

    // ── FIX: ncDelta now shows '-' for negative values
    function ncDelta(val,cls){
        const x=n(val);
        if(!val&&val!=='0')return`<td class="${cls}"><span class="g-none">—</span></td>`;
        if(x===0)return`<td class="${cls}"><span class="g-none">±0</span></td>`;
        const sign=x>0?'+':'-';
        return`<td class="${cls}"><span class="${x>0?'g-up':'g-down'}">${sign}${fmt(Math.abs(x))||Math.abs(x).toLocaleString()}</span></td>`;
    }

    function mBlockDiff(label,today,valueKey,diffKey){
        const f=fmt(today[valueKey]);const diff=n(today[diffKey]);let delta='';
        if(f){if(diff===0)delta=`<span class="m-delta flat">no change</span>`;else{
            // ── FIX: correct '-' sign
            const sign=diff>0?'+':'-',cls=diff>0?'up':'down',arr=diff>0?'↑':'↓';
            delta=`<span class="m-delta ${cls}">${arr} ${sign}${fmt(Math.abs(diff))||Math.abs(diff).toLocaleString()}</span>`;
        }}
        return`<div class="metric-block"><div class="m-label">${label}</div><div class="m-value ${f?'':'empty'}">${f||'—'}</div>${delta}</div>`;
    }
    function mBlockViews30d(label,today,monthRow,valueKey,diffKey,platform){
        const receipt=platform&&_analyticsPlatformReceipt(today,platform);
        if(receipt?.state==='provider_failed'&&receipt.used_last_good!==true)return`<div class="metric-block"><div class="m-label">${label}</div><div class="m-value empty">—</div></div>`;
        const ref=platform?_analyticsTrustedReference(today,monthRow,platform,valueKey):monthRow;
        const views30d=ref?(n(today[valueKey])-n(ref[valueKey])):n(today[valueKey]);
        const trusted=platform?_analyticsMetricNumber(today,platform,valueKey)!==null:false;
        const f=trusted?(fmt(views30d)||'0'):(views30d>0?fmt(views30d):null);const diff=n(today[diffKey]);let delta='';
        const suppressDelta=platform&&_analyticsProviderFailed(today,platform);
        if(f&&!suppressDelta){if(diff===0)delta=`<span class="m-delta flat">no change today</span>`;else if(diff>0){
            delta=`<span class="m-delta up">↑ +${fmt(diff)||diff.toLocaleString()}</span>`;
        }else if(diff<0){delta=`<span class="m-delta down">↓ -${fmt(Math.abs(diff))||Math.abs(diff).toLocaleString()}</span>`;}}
        return`<div class="metric-block"><div class="m-label">${label}</div><div class="m-value ${f?'':'empty'}">${f||'—'}</div>${delta}</div>`;
    }

    function gainsBar(today,prev,weekRow,igWeekViews,ttWeekViews,forcePeriod,clientName){
        function chip(label,value,delta){const numFmt=fmt(value);const numHtml=numFmt?`<span class="gain-chip-num">${numFmt}</span>`:`<span class="gain-chip-num empty">—</span>`;let deltaHtml='';if(delta!==null&&delta!==undefined){const d=n(delta);if(d>0)deltaHtml=`<span class="gain-delta up">↑ +${fmt(d)||d.toLocaleString()}</span>`;else if(d<0)deltaHtml=`<span class="gain-delta down">↓ ${fmt(d)||d.toLocaleString()}</span>`;else deltaHtml=`<span class="gain-delta flat">±0</span>`;}return`<div class="gain-chip"><span class="gain-chip-label">${label}</span><div class="gain-chip-val">${numHtml}${deltaHtml}</div></div>`;}
        function chipDiff(label,diffVal){if(diffVal===null||diffVal===undefined)return'';const d=n(diffVal);let deltaHtml='';if(d>0)deltaHtml=`<span class="gain-delta up">+${fmt(d)||d.toLocaleString()}</span>`;else if(d<0)deltaHtml=`<span class="gain-delta down">${fmt(d)||d.toLocaleString()}</span>`;else deltaHtml=`<span class="gain-delta flat">±0</span>`;return`<div class="gain-chip"><span class="gain-chip-label">${label}</span><div class="gain-chip-val">${deltaHtml}</div></div>`;}
        function chipDeltaOnly(label,diff){let deltaHtml='';if(diff===null||diff===undefined){deltaHtml=`<span class="gain-chip-num empty">—</span>`;}else{const d=n(diff);if(d>0)deltaHtml=`<span class="gain-delta up">+${fmt(d)||d.toLocaleString()}</span>`;else if(d<0)deltaHtml=`<span class="gain-delta down">${fmt(d)||d.toLocaleString()}</span>`;else deltaHtml=`<span class="gain-delta flat">±0</span>`;}return`<div class="gain-chip"><span class="gain-chip-label">${label}</span><div class="gain-chip-val">${deltaHtml}</div></div>`;}
        const hasIG=_analyticsPlatformVisible(today,'instagram',n(today.ig_followers)||n(today.ig_views_this_month));
        const hasTT=n(today.tiktok_followers)||n(today.tiktok_plays_this_month);
        const hasYT=n(today.yt_subscribers)||n(today.yt_total_views);
        const activePeriod=forcePeriod||gainPeriod;
        const dRow=activePeriod==='week'?weekRow:prev;
        const igFailed=_analyticsProviderFailed(today,'instagram');
        const igTyped=_analyticsPlatformReceipt(today,'instagram');
        const igFolRef=_analyticsTrustedReference(today,dRow,'instagram','ig_followers');
        const igViewsRef=_analyticsTrustedReference(today,dRow,'instagram','ig_views_this_month');
        const igFolDiff=!igFailed&&igFolRef?n(today.ig_followers)-n(igFolRef.ig_followers):null;
        const ttFolDiff=dRow?n(today.tiktok_followers)-n(dRow.tiktok_followers):null;
        const ytSubDiff=dRow?n(today.yt_subscribers)-n(dRow.yt_subscribers):null;
        const ytViewDiff=dRow?n(today.yt_total_views)-n(dRow.yt_total_views):null;
        // Day mode: use the direct gained_today field from the sheet
        // Week mode: use _safeWeekViewDelta to handle month-boundary resets
        const igViewsGain=igFailed?null:(activePeriod==='week'?_safeWeekViewDelta(today,igViewsRef,clientName,'ig_views_this_month','ig_views_gained_today'):(igTyped?n(today.ig_views_gained_today):(n(today.ig_views_gained_today)||null)));
        const ttViewsGain=activePeriod==='week'?_safeWeekViewDelta(today,dRow,clientName,'tiktok_plays_this_month','tiktok_plays_gained_today'):(n(today.tiktok_plays_gained_today)||null);
        const periodLabel=activePeriod==='week'?"This Week's":"Today's";
        let cards='';
        if(hasIG)cards+=`<div class="gains-platform-card gp-ig${igFailed?' is-degraded':''}"><div class="gains-platform-header"><span style="display:inline-flex;align-items:center;gap:6px;"><span class="gains-platform-dot"></span><span class="gains-platform-name">Instagram</span></span>${_analyticsStateBadge(today,'instagram')}</div><div class="gains-metrics-row">${chipDeltaOnly('Followers',igFolDiff)}${chipDiff('Views',igViewsGain)}</div></div>`;
        if(hasTT)cards+=`<div class="gains-platform-card gp-tt"><div class="gains-platform-header"><div class="gains-platform-dot"></div><span class="gains-platform-name">TikTok</span></div><div class="gains-metrics-row">${chipDeltaOnly('Followers',ttFolDiff)}${chipDiff('Views',ttViewsGain)}</div></div>`;
        if(hasYT)cards+=`<div class="gains-platform-card gp-yt"><div class="gains-platform-header"><div class="gains-platform-dot"></div><span class="gains-platform-name">YouTube</span></div><div class="gains-metrics-row">${chipDeltaOnly('Subscribers',ytSubDiff)}${chipDeltaOnly('Total Views',ytViewDiff)}</div></div>`;
        const note=dRow?'':`<span class="gains-no-data-note">Gains show after ${activePeriod==='week'?'7+':'2+'} days</span>`;
        return`<div class="gains-bar"><span class="gains-bar-label">${periodLabel}<br>Gains</span>${cards}${note}</div>`;
    }

    // Returns top N monthly videos across all platforms, sorted by views desc, deduped by URL
    function getTopMonthlyVideos(clientName,topN=5){
        const all=[];
        for(const plat of['instagram','tiktok','youtube'])all.push(...getTopVideos(clientName,plat,'month'));
        const seen=new Set();
        const deduped=[];
        for(const v of all){
            const key=(v.video_url&&v.video_url!=='#'&&v.video_url!=='')?v.video_url:(v.caption||'').substring(0,80);
            if(!seen.has(key)){seen.add(key);deduped.push(v);}
        }
        return deduped.sort((a,b)=>n(b.views)-n(a.views)).slice(0,topN);
    }

    // Clients whose summary generation was started (by a click) on THIS page.
    // A "loading" state restored from storage after a reload has no request
    // behind it, so it shows the Generate button instead of a skeleton forever.
    const _contentSummaryStartedHere=new Set();
    async function generateContentSummary(clientName){
        // Staff only (owner, 2026-09-23): a client link never starts a paid summary.
        if(_isClientLink)return;
        _contentSummaryStartedHere.add(clientName);
        const clientEntryRun=_isClientLink?_syncviewClientEntryDataRun:null;
        if(_isClientLink&&!_syncviewClientEntryRunCurrent(clientEntryRun))return;
        if(!_isClientLink&&typeof _analyticsExtrasApplied!=='undefined'&&!_analyticsExtrasApplied){showNotify('Still loading','Top videos are still loading. Try again in a moment.');return;}
        const videos=getTopMonthlyVideos(clientName,5);
        if(!videos.length){alert('No top monthly videos found for this client.');return;}
        contentSummaryState[clientName]={loading:true,data:null,error:null};
        try{localStorage.setItem('syncview_contentSummaryState_v1',JSON.stringify(contentSummaryState));}catch{}
        refreshContentSummary(clientName);
        const payload={
            clientName,
            contentDescription:clientMap[clientName]?.content_description||'',
            videos:videos.map((v,i)=>({rank:i+1,platform:v.platform,url:v.video_url||'',caption:v.caption||'',views:n(v.views),likes:n(v.likes),comments:n(v.comments)}))
        };
        const controller=new AbortController();
        const _csto=setTimeout(()=>controller.abort(),180000);
        const abortForClientEntry=()=>controller.abort();
        if(clientEntryRun){
            if(clientEntryRun.signal.aborted)controller.abort();
            else clientEntryRun.signal.addEventListener('abort',abortForClientEntry,{once:true});
        }
        try{
            const resp=await fetch(CONTENT_SUMMARY_WEBHOOK,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
            if(clientEntryRun&&!_syncviewClientEntryRunCurrent(clientEntryRun))return;
            const text=await resp.text();
            if(clientEntryRun&&!_syncviewClientEntryRunCurrent(clientEntryRun))return;
            if(!text)throw new Error('Empty response from webhook');
            let result=JSON.parse(text);
            if(Array.isArray(result)&&result[0])result=result[0];
            if(result.json)result=result.json;
            if(typeof result==='string'){try{result=JSON.parse(result);}catch{}}
            // Handle raw Claude API response format: { content: [{type:"text", text:"..."}] }
            if(!result.bullets&&result.content&&Array.isArray(result.content)&&result.content[0]?.text){
                result={bullets:result.content[0].text};
            }
            const bullets=result.bullets||result.summary||result;
            const bulletsStr=typeof bullets==='string'?bullets:JSON.stringify(bullets);
            // Detect Claude refusals (e.g. when the workflow fails to download transcripts).
            // Treat them as an error so we don't cache the refusal text as if it were a real summary.
            const lower=(bulletsStr||'').toLowerCase().trimStart();
            const isRefusal=/^i'?m unable to\b/.test(lower)||/^i can'?t\b/.test(lower)||/^i cannot\b/.test(lower)||lower.includes('fabricate')||lower.includes('no transcripts');
            if(isRefusal){
                contentSummaryState[clientName]={loading:false,data:null,error:'Summary unavailable — transcripts could not be processed.'};
            }else{
                contentSummaryState[clientName]={loading:false,data:{bullets:bulletsStr,date:new Date().toISOString().split('T')[0]},error:null};
            }
        }catch(e){
            if(clientEntryRun&&!_syncviewClientEntryRunCurrent(clientEntryRun))return;
            console.error('[SyncView] Content summary error for',clientName,':',e);
            contentSummaryState[clientName]={loading:false,data:null,error:'Failed to generate summary: '+(e.name==='AbortError'?'Request timed out (3 min)':e.message||'Unknown error')};
        }finally{
            clearTimeout(_csto);
            if(clientEntryRun)clientEntryRun.signal.removeEventListener('abort',abortForClientEntry);
        }
        if(clientEntryRun&&!_syncviewClientEntryRunCurrent(clientEntryRun))return;
        try{localStorage.setItem('syncview_contentSummaryState_v1',JSON.stringify(contentSummaryState));}catch{}
        refreshContentSummary(clientName);
    }

    // Formerly the per-session guard for automatic generation on profile open.
    // Generation is click-only now, so nothing adds to it; it stays declared
    // because the client-entry reset (260) still clears it.
    const _autoSummaryAttempted=new Set();

    // (Removed: autoRefreshStaleSummaries. Page-load batch generation was hammering the webhook
    // and caching Claude refusals as bullets. Generation is now lazy — see buildContentSummarySection.)

    function refreshContentSummary(clientName){
        const el=document.getElementById(`content-summary-${clientName.replace(/\s+/g,'_')}`);
        if(!el)return;
        const temp=document.createElement('div');
        temp.innerHTML=buildContentSummarySection(clientName);
        if(temp.firstElementChild)el.replaceWith(temp.firstElementChild);
    }

    function buildContentSummarySection(clientName){
        const id=`content-summary-${clientName.replace(/\s+/g,'_')}`;
        const enc=encodeURIComponent(clientName);
        const state=contentSummaryState[clientName];
        if(typeof _analyticsExtrasEarly!=='undefined'&&_analyticsExtrasEarly)return'';
        const videos=getTopMonthlyVideos(clientName,5);
        if(!videos.length)return'';
        // CLICK-ONLY (owner, 2026-09-23). Each generation is a paid model call, and
        // opening a profile used to start one automatically -- for every client
        // with no summary or a stale one, for any viewer or automated session
        // that merely rendered the profile. Generation now starts only from a
        // click: "Generate summary" below, or the existing Update / Regenerate.
        const hasData=!!state?.data;
        const hasError=!!state?.error;
        // Client links see an existing summary and nothing else: no Generate,
        // Update or Regenerate, and no empty/error/loading state to act on.
        if(_isClientLink&&!hasData)return'';
        let inner='';
        if(hasError){
            // Attempt already ran and failed (e.g. transcripts unavailable). Stay subtle — no Retry button.
            // User can refresh the page to re-attempt.
            inner=`<div class="cs-error" style="opacity:0.7;font-size:0.78rem;">${state.error}</div>`;
        }else if(!hasData&&!(state?.loading&&_contentSummaryStartedHere.has(clientName))){
            inner=`<button class="cs-regen-btn" onclick="generateContentSummary(decodeURIComponent('${enc}'))">✦ Generate summary</button>`;
        }else if(!hasData){
            // Generation is in flight (it only ever starts from a click).
            inner=`<div class="cs-skeleton" role="status" aria-label="Loading">
                ${_svSkel('sv-skeleton-line', 'width:92%;')}
                ${_svSkel('sv-skeleton-line', 'width:84%;')}
                ${_svSkel('sv-skeleton-line', 'width:68%;')}
            </div>`;
        }else{
            const raw=state.data.bullets||'';
            // Render markdown-style bullet points
            const lines=raw.split('\n').filter(l=>l.trim());
            const items=lines.map(l=>{
                const t=l.replace(/^[-•*]\s*/,'').replace(/^\d+\.\s*/,'').trim();
                // Bold **text** and markdown links [label](url)
                const html=t
                    .replace(/\*\*\[(.+?)\]\*\*/g,'<strong>$1</strong>')
                    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
                    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;font-weight:500;">$1</a>');
                return`<li>${html}</li>`;
            }).join('');
            // Check if summary is up to date vs latest top videos scrape
            const summaryDate=state.data.date||'';
            const latestScrape=topVideos.filter(v=>v.client_name===clientName).reduce((max,v)=>{const d=v.scraped_date||'';return d>max?d:max;},'');
            let statusBadge='';
            if(latestScrape){
                if(summaryDate&&summaryDate>=latestScrape){
                    statusBadge=`<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.65rem;font-weight:600;color:var(--sv-fg-10b981);opacity:0.85;"><svg width="10" height="10" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="var(--sv-fg-10b981)" stroke-width="1.3"/><path d="M3.5 6l2 2 3-3.5" stroke="var(--sv-fg-10b981)" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg> Up to date</span>`;
                }else if(!_isClientLink){
                    statusBadge=`<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.65rem;font-weight:600;color:var(--sv-fg-f59e0b);opacity:0.85;"><svg width="10" height="10" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="var(--sv-fg-f59e0b)" stroke-width="1.3"/><path d="M6 3.5v3M6 8.5v.01" stroke="var(--sv-fg-f59e0b)" stroke-width="1.3" stroke-linecap="round"/></svg> New data available · <a href="#" onclick="event.preventDefault();generateContentSummary(decodeURIComponent('${enc}'))" style="color:var(--sv-fg-f59e0b);text-decoration:underline;font-weight:600;">Update</a></span>`;
                }
            }
            inner=`<ul class="cs-bullets">${items}</ul><div style="display:flex;align-items:center;gap:10px;margin-top:6px;">${statusBadge}${_isClientLink?'':`<button class="cs-regen-btn" onclick="generateContentSummary(decodeURIComponent('${enc}'))">↻ Regenerate</button>`}</div>`;
        }
        return`<div class="content-summary-section" id="${id}"><div class="cs-header"><span class="cs-title">✦ What's Working This Month</span><span class="cs-subtitle">Based on top ${videos.length} video${videos.length!==1?'s':''} by views</span></div>${inner}</div>`;
    }

    function buildTopVideosSection(clientName,platform,containerId){
        if(typeof _analyticsExtrasEarly!=='undefined'&&_analyticsExtrasEarly)return _analyticsExtrasSkelHtml(containerId);
        const period=getActivePeriod(clientName,platform),videos=getTopVideos(clientName,platform,period);
        const weekActive=period==='week'?'active':'',monthActive=period==='month'?'active':'';
        const wv=getTopVideos(clientName,platform,'week'),mv=getTopVideos(clientName,platform,'month');
        if(!wv.length&&!mv.length)return'';
        const showShares=platform.toLowerCase()==='tiktok',isIG=platform.toLowerCase()==='instagram';
        let cardsHtml=videos.length?`<div class="video-cards-scroll">${videos.map((v,i)=>buildVideoCard(v,showShares,isIG,i+1)).join('')}</div>`:`<div class="top-videos-empty">No top videos for this period yet</div>`;
        return`<div class="top-videos-section" id="${containerId}"><div class="top-videos-head"><div style="display:flex;align-items:center;gap:10px;"><span class="top-videos-title">Top Performing</span><div class="period-toggle"><button class="period-btn ${weekActive}" onclick="switchPeriod(${_jsAttrArg(clientName)},'${platform}','week',${_jsAttrArg(containerId)})">Week</button><button class="period-btn ${monthActive}" onclick="switchPeriod(${_jsAttrArg(clientName)},'${platform}','month',${_jsAttrArg(containerId)})">Month</button></div></div><div class="top-videos-subnote" style="margin-top:6px;font-size:0.65rem;color:var(--sv-fg-rgba-255-255-255-0_6);font-weight:500;letter-spacing:0.02em;">Lifetime views per video — not the views gained this period</div></div>${cardsHtml}</div>`;
    }

    function truncateCaption(caption){if(!caption)return'';const sentences=caption.match(/[^.!?]+[.!?]+/g)||[caption];let result='';for(let i=0;i<Math.min(2,sentences.length);i++){if((result+sentences[i]).length>130&&result.length>0)break;result+=sentences[i];}return result.trim()||caption.substring(0,120);}
    const captionStore={};

    function buildVideoCard(v,showShares,isIG,rank){
        const caption=v.caption||'',truncated=truncateCaption(caption),needsReadMore=caption.length>truncated.length+5;
        const uid='tc_'+Math.random().toString(36).substring(2,9);
        captionStore[uid]={full:caption,short:truncated};
        const videoUrl=v.video_url||'#',sharesRow=showShares?`<div class="tt-stat"><span class="tt-stat-icon">${ICON.shares}</span><span class="tt-stat-val">${fmtCompact(v.shares)}</span></div>`:'';
        const viewsVal=n(v.views),hasEngagement=n(v.likes)>0||n(v.comments)>0,isCarousel=isIG&&viewsVal===0&&hasEngagement;
        const viewsDisplay=isCarousel?`<span title="Carousels don't have view counts" style="opacity:0.45;display:inline-flex;align-items:center;"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" style="flex-shrink:0"><path d="M2 2L14 14M6.5 3.5A6.8 6.8 0 0 1 8 3c5 0 7 5 7 5a12 12 0 0 1-2.1 2.9M9.88 9.88A3 3 0 0 1 5.12 5.12M1 8s2-5 7-5" stroke="white" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" stroke="white" stroke-width="1.4"/></svg></span>`:`<span class="tt-stat-val">${fmtCompact(v.views)}</span>`;
        return`<a class="video-card-tt" href="${videoUrl}" target="_blank" rel="noopener"><div class="tt-rank-badge">#${rank||n(v.rank)}</div><div class="tt-caption" id="${uid}">${truncated}</div>${needsReadMore?`<button class="read-more-btn" onclick="event.preventDefault();event.stopPropagation();toggleCaption('${uid}',this)" style="margin-top:-4px">read more</button>`:''}<div class="tt-stats"><div class="tt-stat" title="Total views this video has accumulated to date (lifetime) — not the views it gained during the selected period"><span class="tt-stat-icon">${ICON.views}</span>${viewsDisplay}</div><div class="tt-stat"><span class="tt-stat-icon">${ICON.likes}</span><span class="tt-stat-val">${fmtCompact(v.likes)}</span></div><div class="tt-stat"><span class="tt-stat-icon">${ICON.comments}</span><span class="tt-stat-val">${fmtCompact(v.comments)}</span></div>${sharesRow}</div></a>`;
    }

    function toggleCaption(uid,btn){const store=captionStore[uid],el=document.getElementById(uid);if(!el||!store)return;const isExpanded=el.classList.contains('tt-caption-full');if(isExpanded){el.classList.remove('tt-caption-full');el.textContent=store.short;btn.textContent='read more';}else{el.classList.add('tt-caption-full');el.textContent=store.full;btn.textContent='show less';}}
    function switchPeriod(clientName,platform,period,containerId){activePeriods[getPeriodKey(clientName,platform)]=period;const container=document.getElementById(containerId);if(!container)return;const newHtml=buildTopVideosSection(clientName,platform,containerId);const temp=document.createElement('div');temp.innerHTML=newHtml;if(temp.firstElementChild)container.replaceWith(temp.firstElementChild);}

    function renderClient(name,history,clientOnly){
        // Calendar-only clients (calendar/workload allowlist, no analytics
        // history) reach here via a ?c=…&v=calendar share link. The analytics
        // render below assumes at least one history row, so return the calendar
        // shell up-front for the calendar tab and skip analytics entirely. For
        // clients that DO have analytics this is the same shell the bottom of
        // this function would return — just without the now-unneeded work.
        if((clientViewTab[name]||'analytics')==='calendar'){
            const _enc=encodeURIComponent(name);
            const _showBriefTab=_clientBriefTabAvailable(name,clientOnly);
            return`<div class="client-view cal-tab-view">
                <div class="view-tab-toggle">
                    <button class="view-tab-btn" onclick="setClientViewTab('${_enc}','analytics')">Analytics</button>
                    <button class="view-tab-btn active" onclick="setClientViewTab('${_enc}','calendar')">Content Calendar</button>
                    ${_showBriefTab?`<button class="view-tab-btn" onclick="setClientViewTab('${_enc}','brief')">Brief</button>`:''}
                </div>
                <div class="cal-view cal-embedded" id="calView">${_calLoaderHtml()}</div>
            </div>`;
        }
        if((clientViewTab[name]||'analytics')==='brief'){
            const _enc=encodeURIComponent(name);
            if(_clientBriefTabAvailable(name,clientOnly)){
                return`<div class="client-view">
                    <div class="view-tab-toggle">
                        <button class="view-tab-btn" onclick="setClientViewTab('${_enc}','analytics')">Analytics</button>
                        <button class="view-tab-btn" onclick="setClientViewTab('${_enc}','calendar')">Content Calendar</button>
                        <button class="view-tab-btn active" onclick="setClientViewTab('${_enc}','brief')">Brief</button>
                    </div>
                    <div class="detail-hero" style="margin-bottom:16px;"><div><div class="detail-name" style="display:flex;align-items:center;">${name}${(()=>{const _d=clientMap[name]?.content_description||'';return _d?`<button class="detail-info-btn" title="About this client" onclick="event.stopPropagation();showClientInfoModal(${_jsAttrArg(name)})">i</button>`:'';})()}</div></div></div>
                    <div id="briefViewContainer">${renderBriefContent(name)}</div>
                </div>`;
            }
        }
        const today=history[history.length-1],prev=history.length>=2?history[history.length-2]:null;
        const weekRow=getWeekRow(history);
        const monthRow=getMonthRow(history);
        const info=clientMap[name]||{};
        const igHandle=info.instagram_handle||'',ttHandle=info.tiktok_handle||'',ytId=info.youtube_channel_id||'';
        const igFailed=_analyticsProviderFailed(today,'instagram');
        const hasIG=_analyticsPlatformVisible(today,'instagram',n(today.ig_followers)||n(today.ig_avg_views)),hasTT=n(today.tiktok_followers)||n(today.tiktok_avg_plays),hasYT=n(today.yt_subscribers)||n(today.yt_total_views);
        const hasAnyAnalytics=!!(hasIG||hasTT||hasYT);
        const compareNote=prev?`comparing vs ${fmtDate(prev.date)}`:(hasAnyAnalytics?`<em>daily changes show after 2+ days</em>`:`<em>no analytics yet</em>`);
        const availPlats=[hasIG&&'ig',hasTT&&'tt',hasYT&&'yt'].filter(Boolean);
        if(!availPlats.includes(followersPlat))_setFollowersPlat(availPlats[0]||'ig');
        if(viewsPlat!=='all'&&!availPlats.includes(viewsPlat))_setViewsPlat('all');
        const mkViewsBtn=(plat,color,label)=>`<button class="chart-plat-btn${viewsPlat===plat?' active':''}" onclick="switchViewsPlat('${plat}',this)">${color?`<span class="cpb-dot" style="background:${color}"></span>`:''}${label}</button>`;
        const viewsPlatToggle=[mkViewsBtn('all','','All'),hasIG?mkViewsBtn('ig','var(--sv-misc-e1306c)','Instagram'):'',hasTT?mkViewsBtn('tt','var(--sv-misc-2ec4b6)','TikTok'):'',hasYT?mkViewsBtn('yt','var(--sv-misc-ff4444)','YouTube'):''].filter(Boolean).join('');
        const mkPlatBtn=(plat,color,label)=>`<button class="chart-plat-btn${followersPlat===plat?' active':''}" onclick="switchFollowersPlat('${plat}',this)"><span class="cpb-dot" style="background:${color}"></span>${label}</button>`;
        const platToggle=[hasIG?mkPlatBtn('ig','var(--sv-misc-e1306c)','Instagram'):'',hasTT?mkPlatBtn('tt','var(--sv-misc-2ec4b6)','TikTok'):'',hasYT?mkPlatBtn('yt','var(--sv-misc-ff4444)','YouTube'):''].filter(Boolean).join('');
        const shareBtnHtml=!clientOnly?`<button class="share-btn" id="shareBtn" onclick="copyShareLink('${encodeURIComponent(name)}')"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9.5 1L13 4.5M13 4.5L9.5 8M13 4.5H5.5C3.57 4.5 2 6.07 2 8V13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Share with client</button>`:'';
        const hasSlackChannel=!!(clientMap[name]?.slack_channel_id);
        const slackBtnHtml=(!clientOnly&&hasSlackChannel)?`<button class="share-btn slack-update-btn" data-slack-btn="${_calEscAttr(name)}" onclick="sendWeeklySlackUpdate(${_jsAttrArg(name)})" title="Send this week's top reel to client's Slack channel" style="margin-left:6px;">${_slackBtnContent}</button>`:'';
        const igTopVids=buildTopVideosSection(name,'instagram',`tv-ig-${name.replace(/\s+/g,'_')}`);
        const ttTopVids=buildTopVideosSection(name,'tiktok',`tv-tt-${name.replace(/\s+/g,'_')}`);
        const ytTopVids=buildTopVideosSection(name,'youtube',`tv-yt-${name.replace(/\s+/g,'_')}`);
        const igAgeRestricted=name.toLowerCase()==='john wineland';
        const igAgeBadge=igAgeRestricted?`<span style="display:inline-flex;align-items:center;gap:5px;background:var(--sv-bg-rgba-0-0-0-0_25);border:1px solid var(--sv-border-rgba-255-255-255-0_18);border-radius:20px;padding:3px 10px;font-size:0.65rem;font-weight:700;color:var(--sv-fg-rgba-255-255-255-0_7);letter-spacing:0.04em;">🔞 Age-restricted · not scraped</span>`:'';
        const igStateBadge=_analyticsStateBadge(today,'instagram');
        const igDegradedNote=igFailed?`<div class="analytics-degraded-note">Instagram could not be refreshed. ${_analyticsPlatformReceipt(today,'instagram')?.used_last_good===true?'Showing the last-known values; changes are paused for this scrape.':'No prior value was available; changes are paused for this scrape.'}</div>`:'';
        const igSection=(hasIG||igAgeRestricted)?`<div class="platform-section ig"><div class="platform-section-header"><span class="platform-name"><span class="platform-pill"></span>Instagram</span><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end;">${igStateBadge}${igAgeBadge}${handleLink(igUrl(igHandle),igHandle?`@${igHandle}`:'')}</div></div>${hasIG?`<div class="metrics-row">${mBlock('Total Followers',today,prev,'ig_followers','instagram')}${mBlockNoD('Avg Views',today,'ig_avg_views','instagram')}${mBlockViews30d('Views Last 30d',today,monthRow,'ig_views_this_month','ig_views_gained_today','instagram')}${mBlockNoD('Avg Likes',today,'ig_avg_likes','instagram')}</div>${igDegradedNote}${igTopVids}`:''}${igAgeRestricted&&!hasIG?`<div style="padding:4px 20px 18px;color:var(--sv-fg-rgba-255-255-255-0_5);font-size:0.79rem;font-style:italic;">Instagram data unavailable — this account is age-restricted and cannot be scraped.</div>`:''}</div>`:'';
        const ttSection=hasTT?`<div class="platform-section tt"><div class="platform-section-header"><span class="platform-name"><span class="platform-pill"></span>TikTok</span>${handleLink(ttUrl(ttHandle),ttHandle?`@${ttHandle}`:'')}</div><div class="metrics-row">${mBlock('Total Followers',today,prev,'tiktok_followers')}${mBlockNoD('Avg Views',today,'tiktok_avg_plays')}${mBlockViews30d('Views Last 30d',today,monthRow,'tiktok_plays_this_month','tiktok_plays_gained_today')}</div>${ttTopVids}</div>`:'';
        const ytSplitViews=name==='Dr. Sonia Chopra';
        const ytViewBlocks=ytSplitViews?`${mBlock('Shorts Last 30d',today,prev,'yt_shorts_views')}${mBlock('Podcasts Last 30d',today,prev,'yt_longs_views')}`:mBlock('Total Views',today,prev,'yt_total_views');
        const ytRowStyle=ytSplitViews?' style="grid-template-columns: repeat(3, 1fr);"':'';
        const ytSection=hasYT?`<div class="platform-section yt"><div class="platform-section-header"><span class="platform-name"><span class="platform-pill"></span>YouTube</span>${handleLink(ytUrl(ytId),ytId?'Open Channel ↗':'')}</div><div class="metrics-row"${ytRowStyle}>${mBlock('Total Subscribers',today,prev,'yt_subscribers')}${ytViewBlocks}</div>${ytTopVids}</div>`:'';

        const _clientDesc=clientMap[name]?.content_description||'';
        const _infoIcon=_clientDesc?`<button class="detail-info-btn" title="About this client" onclick="event.stopPropagation();showClientInfoModal(${_jsAttrArg(name)})">i</button>`:'';
        const noAnalyticsState=hasAnyAnalytics?'':`<div style="background:var(--white);border:1px dashed var(--border);border-radius:12px;padding:34px;text-align:center;color:var(--text-muted);font-size:0.9rem;font-weight:600;">No analytics yet</div>`;
        const analyticsContent=`
            <div class="detail-hero">
                <div>
                    <div class="detail-name" style="display:flex;align-items:center;">${name}${_infoIcon}</div>
                    <div class="detail-meta">Last scraped ${fmtDate(today.date)} · ${history.length} data point${history.length!==1?'s':''} · ${compareNote}</div>
                </div>
                <div style="display:flex;align-items:center;gap:6px;">${shareBtnHtml}${slackBtnHtml}</div>
            </div>
            ${noAnalyticsState}
            ${gainsBar(today,prev,weekRow,null,null,'day',name)}
            ${weekRow?gainsBar(today,prev,weekRow,null,null,'week',name):''}
            ${buildContentSummarySection(name)}
            ${igSection}${ttSection}${ytSection}
            <div class="chart-section">
                <div class="chart-top">
                    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                        <span class="chart-title">Followers Over Time</span>
                        <div class="chart-mode-toggle">
                            <button class="chart-mode-btn${followersMode==='total'?' active':''}" onclick="switchFollowersMode('total',this)">Total</button>
                            <button class="chart-mode-btn${followersMode==='daily'?' active':''}" onclick="switchFollowersMode('daily',this)">Daily Change</button>
                        </div>
                    </div>
                    <div class="chart-plat-toggle">${platToggle}</div>
                </div>
                <div class="chart-wrap"><canvas id="growthChart"></canvas></div>
            </div>
            <div class="chart-section">
                <div class="chart-top">
                    <span class="chart-title">Daily Views Over Time</span>
                    <div class="chart-plat-toggle">${viewsPlatToggle}</div>
                </div>
                <div class="chart-wrap"><canvas id="viewsChart"></canvas></div>
            </div>`;

        const enc=encodeURIComponent(name);
        const tab=clientViewTab[name]||'analytics';
        const showBriefTab=_clientBriefTabAvailable(name,clientOnly);
        const toggleHtml=`<div class="view-tab-toggle">
                <button class="view-tab-btn ${tab==='analytics'?'active':''}" onclick="setClientViewTab('${enc}','analytics')">Analytics</button>
                <button class="view-tab-btn ${tab==='calendar'?'active':''}" onclick="setClientViewTab('${enc}','calendar')">Content Calendar</button>
                ${showBriefTab?`<button class="view-tab-btn ${tab==='brief'?'active':''}" onclick="setClientViewTab('${enc}','brief')">Brief</button>`:''}
            </div>`;

        if(tab==='calendar'){
            return`<div class="client-view cal-tab-view">
                ${toggleHtml}
                <div class="cal-view cal-embedded" id="calView">${_calLoaderHtml()}</div>
            </div>`;
        }

        if(tab==='brief'&&showBriefTab){
            return`<div class="client-view">
                ${toggleHtml}
                <div class="detail-hero" style="margin-bottom:16px;"><div><div class="detail-name" style="display:flex;align-items:center;">${name}${(()=>{const _d=clientMap[name]?.content_description||'';return _d?`<button class="detail-info-btn" title="About this client" onclick="event.stopPropagation();showClientInfoModal(${_jsAttrArg(name)})">i</button>`:'';})()}</div></div></div>
                <div id="briefViewContainer">${renderBriefContent(name)}</div>
            </div>`;
        }

        return`<div class="client-view">${toggleHtml}${analyticsContent}</div>`;
    }

    async function sendWeeklySlackUpdate(clientName){
        const btn=document.querySelector(`[data-slack-btn="${CSS.escape(clientName)}"]`);
        if(btn){btn.disabled=true;btn.textContent='Sending...';}
        try{
            const info=clientMap[clientName]||{};
            const channelId=info.slack_channel_id||'';
            if(!_isClientLink&&typeof _analyticsExtrasApplied!=='undefined'&&!_analyticsExtrasApplied){showNotify('Still loading','Top videos are still loading. Try again in a moment.');if(btn){btn.disabled=false;btn.innerHTML=_slackBtnContent;}return;}
            if(!channelId){showNotify('No Slack channel','Add a slack_channel_id column to Clients Info for '+clientName);if(btn){btn.disabled=false;btn.innerHTML=_slackBtnContent;}return;}
            const clientVids=topVideos.filter(v=>v.client_name===clientName&&(v.period||'').toLowerCase().includes('week'));
            const latestDate=clientVids.reduce((max,v)=>{const d=v.scraped_date||'';return d>max?d:max;},'');
            const fresh=latestDate?clientVids.filter(v=>(v.scraped_date||'')===latestDate):clientVids;
            fresh.sort((a,b)=>n(b.views)-n(a.views));
            const top=fresh[0];
            if(!top){showNotify('No videos','No weekly top videos found for '+clientName);if(btn){btn.disabled=false;btn.innerHTML=_slackBtnContent;}return;}
            const resp=await _writeUiTrackSave('briefs', 'weekly_slack_update', () => ({ client_slug: calClientSlug(clientName) }), () => fetch(WEEKLY_SLACK_WEBHOOK,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientName,slack_channel_id:channelId,content_description:info.content_description||'',platform:top.platform||'instagram',video_url:top.video_url||'',caption:(top.caption||'').substring(0,500),views:n(top.views),likes:n(top.likes),comments:n(top.comments),shares:n(top.shares),scraped_date:latestDate})}));
            if(resp.ok)showNotify('Sent!','Slack update sent for '+clientName);
            else showNotify('Error','Slack webhook returned '+resp.status);
        }catch(e){console.error('[SyncView] Slack send error:',e);showNotify('Error','Could not send Slack update. Check webhook.');}
        if(btn){btn.disabled=false;btn.innerHTML=_slackBtnContent;}
    }
    const _slackBtnContent='<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M14.5 2a2.5 2.5 0 0 0-2.5 2.5V9h4.5A2.5 2.5 0 0 0 14.5 2z" fill="currentColor"/><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5V9H7.5A2.5 2.5 0 0 1 9.5 2z" fill="currentColor" opacity=".7"/><path d="M9.5 22a2.5 2.5 0 0 1-2.5-2.5V15h4.5a2.5 2.5 0 0 1-2 4.9V22z" fill="currentColor" opacity=".7"/><path d="M14.5 22a2.5 2.5 0 0 0 2.5-2.5V15h-4.5a2.5 2.5 0 0 0 2 4.9V22z" fill="currentColor"/><path d="M22 14.5a2.5 2.5 0 0 0-2.5-2.5H15v4.5a2.5 2.5 0 0 0 4.9-2H22z" fill="currentColor"/><path d="M2 14.5A2.5 2.5 0 0 1 4.5 12H9v4.5A2.5 2.5 0 0 1 2 14.5z" fill="currentColor" opacity=".7"/><path d="M2 9.5A2.5 2.5 0 0 0 4.5 12H9V7.5A2.5 2.5 0 0 0 2 9.5z" fill="currentColor" opacity=".7"/><path d="M22 9.5A2.5 2.5 0 0 1 19.5 12H15V7.5A2.5 2.5 0 0 1 22 9.5z" fill="currentColor"/></svg> Send Slack Update';

    function renderOverview(rawRows){
        const rows=sortedRows(rawRows),prevMap=prevPerClient();
        const deltaMap=gainPeriod==='week'?weekPrevPerClient():prevMap;
        const mPrevMap=monthPrevPerClient();
        const nc=(val,cls)=>{const f=fmt(val);return`<td class="${cls} num ${f?'has':''}">${f||'<span class="g-none">—</span>'}</td>`;};
        const ncAnalytics=(row,platform,key,cls)=>{const f=_analyticsMetricFmt(row,platform,key);return`<td class="${cls} num ${f?'has':''}">${f||'<span class="g-none">—</span>'}${key==='ig_followers'?_analyticsStateBadge(row,platform):''}</td>`;};
        const ncViewsDelta=(row,candidate,platform,key,cls)=>{const current=_analyticsMetricNumber(row,platform,key);if(current===null)return`<td class="${cls} num"><span class="g-none">—</span></td>`;const ref=_analyticsTrustedReference(row,candidate,platform,key);const value=ref?current-n(ref[key]):current;const f=fmt(value)||'0';return`<td class="${cls} num has">${f}</td>`;};
        if(viewMode==='cards')return`<div class="overview-wrap">${controlsHTML()}${renderCardView(rows,deltaMap)}</div>`;
        return`<div class="overview-wrap">${controlsHTML()}<table class="overview-table"><colgroup><col class="col-name"><col class="col-date"><col class="col-num"><col class="col-gain"><col class="col-num"><col class="col-gain"><col class="col-num"><col class="col-gain"><col class="col-num"><col class="col-gain"><col class="col-num"><col class="col-gain"><col class="col-num"><col class="col-gain"></colgroup>${(()=>{
        const sTh=(col,label,cls)=>{const active=sortCol===col;const arr=active?`<span style="margin-left:3px;font-size:0.65rem;opacity:0.75">${sortDir==='desc'?'↓':'↑'}</span>`:'';return`<th class="${cls}" style="cursor:pointer;${active?'opacity:1;':''}" onclick="setSort('${col}')" title="Sort by ${label}">${label}${arr}</th>`;};
        const nameCol=sortCol==='client_name'?`<span style="display:inline-flex;align-items:center;gap:3px;">Client <span style="font-size:0.65rem;opacity:0.75">${sortDir==='desc'?'↓':'↑'}</span></span>`:'Client';
        return`<thead><tr>
          <th rowspan="2" style="text-align:left;vertical-align:middle;cursor:pointer;" onclick="setSort('client_name')" title="Sort by name">${nameCol}</th>
          <th rowspan="2" style="vertical-align:middle">Date</th>
          <th colspan="4" class="group-ig">Instagram</th>
          <th colspan="4" class="group-tt">TikTok</th>
          <th colspan="4" class="group-yt">YouTube</th>
        </tr><tr>
          ${sTh('ig_followers','Followers','ig-h')}${sTh('_ig_fol_delta','+Followers','ig-h')}${sTh('ig_views_this_month','Views/30d','ig-h')}${sTh('_ig_view_delta','+Views','ig-h')}
          ${sTh('tiktok_followers','Followers','tt-h')}${sTh('_tt_fol_delta','+Followers','tt-h')}${sTh('tiktok_plays_this_month','Views/30d','tt-h')}${sTh('_tt_view_delta','+Views','tt-h')}
          ${sTh('yt_subscribers','Subscribers','yt-h')}${sTh('_yt_sub_delta','+Subscribers','yt-h')}${sTh('yt_total_views','Total Views','yt-h')}${sTh('_yt_view_delta','+Views','yt-h')}
        </tr></thead>`;
      })()}<tbody>${rows.map((r,idx)=>{
            const p=prevMap[r.client_name]||null,dp=deltaMap[r.client_name]||null,topCls=idx<3?`top-rank top-${idx+1}`:'',badge=idx<3?`<span class="top-rank-badge">${idx+1}</span>`:'';
            const eyeIcon=`<a class="client-view-btn" href="/#${encodeURIComponent(r.client_name)}" onclick="if(_modClick(event))return;event.preventDefault();selectClient(${_jsAttrArg(r.client_name)})" title="View ${_calEscAttr(r.client_name)}" style="text-decoration:none;color:inherit;"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 3C3 3 1 8 1 8s2 5 7 5 7-5 7-5-2-5-7-5z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.4"/></svg></a>`;
            const isAgeRestricted=r.client_name.toLowerCase()==='john wineland';
            const igRestrictedCell=`<td class="col-ig" style="text-align:center;" title="Instagram age-restricted — not scraped"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 2L14 14" stroke="var(--sv-fg-d4b0bc)" stroke-width="1.5" stroke-linecap="round"/><path d="M6.5 3.5A6.8 6.8 0 0 1 8 3c5 0 7 5 7 5a12 12 0 0 1-2.1 2.9" stroke="var(--sv-fg-d4b0bc)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.88 9.88A3 3 0 0 1 5.12 5.12" stroke="var(--sv-fg-d4b0bc)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 8s2-5 7-5" stroke="var(--sv-fg-d4b0bc)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></td>`;
            const noPlat=(cls,label)=>`<td class="${cls}" style="text-align:center;"><span style="display:inline-flex;align-items:center;gap:4px;background:var(--bg);border-radius:5px;padding:2px 8px;font-size:0.61rem;font-weight:600;color:var(--text-muted);letter-spacing:0.04em;opacity:0.7;"><svg width="10" height="10" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.3"/><line x1="3" y1="3" x2="9" y2="9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg> No ${label}</span></td>`;
            const noCell=(cls)=>`<td class="${cls}" style="text-align:center;"><span style="color:var(--text-muted);font-size:0.75rem;font-weight:300;">—</span></td>`;
            const hasTTrow=n(r.tiktok_followers)||n(r.tiktok_plays_this_month);
            const hasYTrow=n(r.yt_subscribers)||n(r.yt_total_views);
            const _ri=clientMap[r.client_name]||{},_igh=_ri.instagram_handle||'',_tth=_ri.tiktok_handle||'',_yti=_ri.youtube_channel_id||'';
            const _hasIG=_analyticsPlatformVisible(r,'instagram',n(r.ig_followers)||n(r.ig_views_this_month));
            const _mkSocI=(url,svg,ttl)=>url?`<a href="${url}" target="_blank" rel="noopener" title="${ttl}" style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;flex-shrink:0;color:var(--text-muted);text-decoration:none;">${svg}</a>`:`<span title="${ttl}" style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;flex-shrink:0;color:var(--text-muted);">${svg}</span>`;
            const _igSvg=`<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="3.5" width="17" height="17" rx="5" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="2"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor"/></svg>`;
            const _ttSvg=`<svg width="13" height="13" viewBox="0 0 24 24"><path d="M19.6 6.7A4.8 4.8 0 0 1 15.8 2.5h-3.4v13.1a2.9 2.9 0 1 1-2.1-2.8V9.4A6.3 6.3 0 0 0 4 15.6a6.3 6.3 0 0 0 6.3 6.4 6.3 6.3 0 0 0 6.3-6.4V9.1a8.3 8.3 0 0 0 4.8 1.5V7.2a4.8 4.8 0 0 1-1.8-.5z" fill="currentColor"/></svg>`;
            const _ytSvg=`<svg width="13" height="13" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>`;
            const _igSocI=_hasIG&&!isAgeRestricted?_mkSocI(_igh?`https://instagram.com/${_igh}`:null,_igSvg,'Instagram'):'';
            const _ttSocI=hasTTrow?_mkSocI(_tth?`https://tiktok.com/@${_tth}`:null,_ttSvg,'TikTok'):'';
            const _ytSocI=hasYTrow?_mkSocI(_yti?`https://youtube.com/channel/${_yti}`:null,_ytSvg,'YouTube'):'';
            const _socIcons=_igSocI||_ttSocI||_ytSocI?`<span style="display:inline-flex;align-items:center;gap:4px;margin-left:8px;">${_igSocI}${_ttSocI}${_ytSocI}</span>`:'';
            // Day mode: use gained_today directly; Week mode: use _safeWeekViewDelta (handles month-boundary resets)
            const igViewDeltaCell=_analyticsProviderFailed(r,'instagram')?`<td class="col-ig"><span class="g-none">—</span></td>`:(gainPeriod==='day'?ncDelta(r.ig_views_gained_today,'col-ig'):ncDelta(_safeWeekViewDelta(r,dp,r.client_name,'ig_views_this_month','ig_views_gained_today'),'col-ig'));
            const ttViewDeltaCell=gainPeriod==='day'?ncDelta(r.tiktok_plays_gained_today,'col-tt'):ncDelta(_safeWeekViewDelta(r,dp,r.client_name,'tiktok_plays_this_month','tiktok_plays_gained_today'),'col-tt');
            const mp=mPrevMap[r.client_name];
            const igCols=isAgeRestricted?igRestrictedCell+igRestrictedCell+igRestrictedCell+igRestrictedCell:`${ncAnalytics(r,'instagram','ig_followers','col-ig main-metric')}${gainCell(r,dp,'ig_followers','col-ig','instagram')}${ncViewsDelta(r,mp,'instagram','ig_views_this_month','col-ig')}${igViewDeltaCell}`;
            const _isPending=!r.date;
            const ttCols=hasTTrow?`${nc(r.tiktok_followers,'col-tt main-metric')}${gainCell(r,dp,'tiktok_followers','col-tt')}${ncViewsDelta(r,mp,'tiktok','tiktok_plays_this_month','col-tt')}${ttViewDeltaCell}`:_isPending?`${noCell('col-tt')}${noCell('col-tt')}${noCell('col-tt')}${noCell('col-tt')}`:`${noPlat('col-tt','TikTok')}${noCell('col-tt')}${noCell('col-tt')}${noCell('col-tt')}`;
            const ytCols=hasYTrow?`${nc(r.yt_subscribers,'col-yt main-metric')}${gainCell(r,dp,'yt_subscribers','col-yt')}${nc(r.yt_total_views,'col-yt')}${gainCell(r,dp,'yt_total_views','col-yt')}`:_isPending?`${noCell('col-yt')}${noCell('col-yt')}${noCell('col-yt')}${noCell('col-yt')}`:`${noPlat('col-yt','YouTube')}${noCell('col-yt')}${noCell('col-yt')}${noCell('col-yt')}`;
            const _dateCell=_isPending?`<td style="font-size:0.68rem"><span style="display:inline-flex;align-items:center;gap:4px;background:var(--bg);border-radius:5px;padding:2px 8px;font-size:0.61rem;font-weight:600;color:var(--text-muted);letter-spacing:0.04em;">Pending</span></td>`:`<td style="font-size:0.76rem">${fmtDate(r.date)}</td>`;
            return`<tr class="${topCls}"><td><div class="cell-inner">${badge}${eyeIcon}<a class="client-name-link" href="/#${encodeURIComponent(r.client_name)}" onclick="if(_modClick(event))return;event.preventDefault();selectClient(${_jsAttrArg(r.client_name)})">${_calEsc(r.client_name)}</a>${_socIcons}</div></td>${_dateCell}${igCols}${ttCols}${ytCols}</tr>`;
        }).join('')}</tbody></table></div>`;
    }

    async function copyShareLink(encodedName){try{const url=await _syncviewIssueClientShareUrl(decodeURIComponent(encodedName),'analytics');await navigator.clipboard.writeText(url);const btn=document.getElementById('shareBtn');if(!btn)return;btn.classList.add('copied');btn.innerHTML=`<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7L5.5 10.5L12 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Link copied!`;setTimeout(()=>{btn.classList.remove('copied');btn.innerHTML=`<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9.5 1L13 4.5M13 4.5L9.5 8M13 4.5H5.5C3.57 4.5 2 6.07 2 8V13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Share with client`;},2500);}catch(e){showToast((e&&e.message)||'Could not issue a secure client link');}}

    const _baseOpts=(fmtTip)=>({responsive:true,maintainAspectRatio:false,animation:{duration:600,easing:'easeInOutQuart'},interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{backgroundColor:_svCss('--chart-tooltip-bg'),titleColor:_svCss('--chart-tooltip-title'),bodyColor:_svCss('--chart-tooltip-body'),borderColor:_svCss('--chart-tooltip-border'),borderWidth:1,padding:14,cornerRadius:10,boxPadding:4,callbacks:{label:c=>` ${c.dataset.label}: ${c.parsed.y!=null?fmtTip(c.parsed.y):'—'}`}}}});
    function _svCss(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
    function _svRgb(name) {
        const c = _svCss(name);
        let m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (m) {
            let h = m[1];
            if (h.length === 3) h = h.split('').map(ch => ch + ch).join('');
            return { r: parseInt(h.slice(0,2), 16), g: parseInt(h.slice(2,4), 16), b: parseInt(h.slice(4,6), 16) };
        }
        m = c.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        if (m) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
        return { r: 0, g: 0, b: 0 };
    }
    const _xAxis=()=>({grid:{display:false},border:{display:false},ticks:{color:_svCss('--chart-axis'),font:{size:11},maxTicksLimit:8,padding:4}});
    const _mkYAxis=(show)=>({type:'linear',display:show,position:'left',grid:show?{color:_svCss('--chart-grid'),drawTicks:false}:{display:false},border:{display:false},ticks:{color:_svCss('--chart-axis'),font:{size:11},padding:10,callback:v=>fmt(v)||v}});
    function _mkGrad(c2d,h,cssVar){const rgb=_svRgb(cssVar);const gr=c2d.createLinearGradient(0,0,0,h);gr.addColorStop(0,`rgba(${rgb.r},${rgb.g},${rgb.b},0.2)`);gr.addColorStop(1,`rgba(${rgb.r},${rgb.g},${rgb.b},0)`);return gr;}
    const _platCfg={ig:{label:'Instagram',key:'ig_followers',css:'--ig'},tt:{label:'TikTok',key:'tiktok_followers',css:'--tt'},yt:{label:'YouTube',key:'yt_subscribers',css:'--yt'}};
    /* Chart.js loads with `defer` so it can't block first paint. In the rare
       case a render fires before the CDN script has executed (or the CDN is
       down), retry briefly instead of throwing — the rest of the client view
       must still paint. */
    let _chartLoadTries = 0;
    function _chartReady(retryFn){
        if (typeof Chart !== 'undefined') { _chartLoadTries = 0; return true; }
        if (_chartLoadTries++ < 40) setTimeout(retryFn, 150);
        return false;
    }
    function renderChart(history){
        if(!_chartReady(()=>renderChart(history)))return;
        _setCurrentClientHistory(history);
        const ctx=document.getElementById('growthChart');if(!ctx)return;
        if(growthChart){growthChart.destroy();_setGrowthChart(null);}
        const pc=_platCfg[followersPlat]||_platCfg.ig;
        const receiptPlatform=followersPlat==='ig'?'instagram':followersPlat==='tt'?'tiktok':'youtube';
        const c2d=ctx.getContext('2d'),h=240,labels=history.map(r=>fmtDate(r.date));
        let data,chartType,dataset;
        if(followersMode==='daily'){
            data=history.map((r,i)=>{
                const current=_analyticsMetricNumber(r,receiptPlatform,pc.key);
                if(i===0||current===null||_analyticsProviderFailed(r,receiptPlatform))return null;
                let prior=i-1;
                while(prior>=0&&_analyticsMetricNumber(history[prior],receiptPlatform,pc.key)===null)prior--;
                return prior<0?null:current-_analyticsMetricNumber(history[prior],receiptPlatform,pc.key);
            });
            chartType='bar';
            const rgb=_svRgb(pc.css); dataset={label:pc.label,data,backgroundColor:data.map(v=>(v??0)>=0?`rgba(${rgb.r},${rgb.g},${rgb.b},0.75)`:_svCss('--chart-negative-fill')),borderColor:data.map(v=>(v??0)>=0?_svCss(pc.css):_svCss('--chart-negative')),borderWidth:1,borderRadius:3};
        } else {
            data=history.map(r=>{
                if(_analyticsProviderFailed(r,receiptPlatform))return null;
                return _analyticsMetricNumber(r,receiptPlatform,pc.key);
            });
            chartType='line';
            dataset={label:pc.label,data,borderColor:_svCss(pc.css),backgroundColor:_mkGrad(c2d,h,pc.css),fill:true,tension:0.4,borderWidth:2,pointRadius:0,pointHoverRadius:5,pointHoverBackgroundColor:_svCss(pc.css),pointHoverBorderColor:_svCss('--chart-point-border'),pointHoverBorderWidth:2};
        }
        const hasTypedZero=history.some(r=>{const state=_analyticsPlatformReceipt(r,receiptPlatform)?.state;return(state==='success'||state==='genuinely_empty')&&r[pc.key]!==''&&r[pc.key]!==null&&r[pc.key]!==undefined&&Number.isFinite(Number(r[pc.key]));});
        if(!hasTypedZero&&!data.some(v=>v!=null&&v!==0)){ctx.parentElement.innerHTML=`<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:0.82rem">No ${pc.label} follower data available.</div>`;return;}
        _setGrowthChart(new Chart(ctx,{type:chartType,data:{labels,datasets:[dataset]},options:{..._baseOpts(v=>(v>0?'+':'')+v.toLocaleString()),scales:{x:_xAxis(),y:_mkYAxis(true)}}}));
    }
    function switchFollowersMode(mode,btn){
        _setFollowersMode(mode);
        btn.closest('.chart-mode-toggle').querySelectorAll('.chart-mode-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        renderChart(currentClientHistory);
    }
    function switchFollowersPlat(plat,btn){
        _setFollowersPlat(plat);
        btn.closest('.chart-plat-toggle').querySelectorAll('.chart-plat-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        renderChart(currentClientHistory);
    }
    function renderViewsChart(history){
        if(!_chartReady(()=>renderViewsChart(history)))return;
        const ctx=document.getElementById('viewsChart');if(!ctx)return;
        if(viewsChart){viewsChart.destroy();_setViewsChart(null);}
        const c2d=ctx.getContext('2d'),h=240;
        const allSeries=[
            {plat:'ig',label:'Instagram',key:'ig_views_gained_today',css:'--ig'},
            {plat:'tt',label:'TikTok',key:'tiktok_plays_gained_today',css:'--tt'},
            {plat:'yt',label:'YouTube',key:'yt_views_gained_today',css:'--yt'},
        ];
        const receiptPlatform=s=>s.plat==='ig'?'instagram':s.plat==='tt'?'tiktok':'youtube';
        const series=allSeries.filter(s=>(viewsPlat==='all'||viewsPlat===s.plat)&&history.some(row=>!_analyticsProviderFailed(row,receiptPlatform(s))&&_analyticsMetricNumber(row,receiptPlatform(s),s.key)!==null));
        let start=history.length;
        for(let i=0;i<history.length;i++){if(series.some(s=>!_analyticsProviderFailed(history[i],receiptPlatform(s))&&_analyticsMetricNumber(history[i],receiptPlatform(s),s.key)!==null)){start=i;break;}}
        const trimmed=history.slice(start);
        const labels=trimmed.map(r=>fmtDate(r.date));
        const ds=[],sc={x:_xAxis()};let yi=0;
        series.forEach(s=>{
            const data=trimmed.map(row=>_analyticsProviderFailed(row,receiptPlatform(s))?null:_analyticsMetricNumber(row,receiptPlatform(s),s.key));
            const yId='y'+yi;
            ds.push({label:s.label,data,borderColor:_svCss(s.css),backgroundColor:_mkGrad(c2d,h,s.css),fill:true,tension:0.3,borderWidth:2,pointRadius:0,pointHoverRadius:5,pointHoverBackgroundColor:_svCss(s.css),pointHoverBorderColor:_svCss('--chart-point-border'),pointHoverBorderWidth:2,yAxisID:yId});
            sc[yId]=_mkYAxis(yi===0);yi++;
        });
        if(!ds.length){ctx.parentElement.innerHTML=`<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:0.82rem">Daily views will appear after a few days of data.</div>`;return;}
        _setViewsChart(new Chart(ctx,{type:'line',data:{labels,datasets:ds},options:{..._baseOpts(v=>v.toLocaleString()),scales:sc}}));
    }
    function switchViewsPlat(plat,btn){
        _setViewsPlat(plat);
        btn.closest('.chart-plat-toggle').querySelectorAll('.chart-plat-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        renderViewsChart(currentClientHistory);
    }

    function render(sel,clientOnly){
        if (typeof svClientBarSync === 'function') svClientBarSync('home');   // client Analytics can be reached without navTo (hash, history)
        if(_isClientLink){
            const cap=_syncviewClientEntryCapability;
            if(!clientOnly||!cap||!cap.verified||_syncviewClientEntrySlug(sel)!==cap.slug){
                _syncviewInvalidClientLinkScreen();
                return;
            }
            sel=cap.client;
            // A stale Brief tab (old history entry) lands on the Content Calendar.
            if(clientViewTab[sel]==='brief')clientViewTab[sel]='calendar';
        }
        _syncviewNextNavEpoch(); // Phase D: a client profile is a route too.
        // Boot-gate belt-and-braces: today's render()-first boot paths
        // (client links, history.state.client, client-name hashes) never set
        // data-boot-nav, but lift it here anyway so a future render()-first
        // path can't strand the gate (see the <head> boot script).
        document.documentElement.removeAttribute('data-boot-nav');
        document.documentElement.removeAttribute('data-boot-subtab');
        // render() bypasses navTo(); leaving Production through here must give
        // the body its scroll back (body.prod-page sets overflow: hidden).
        document.body.classList.remove('prod-page');
        const content=document.getElementById('content'),pageTitle=document.getElementById('pageTitle'),pageSub=document.getElementById('pageSub'),selectorWrap=document.getElementById('selectorWrap'),titleRow=document.getElementById('titleRow'),pageTop=document.getElementById('pageTop');
        const tab=sel==='all'?null:(clientViewTab[sel]||'analytics');
        // Client-profile tab changes do not pass through navTo(). Retire the
        // Calendar transport/realtime lease before replacing its surface with
        // Analytics, Brief, or the profile overview.
        if(tab!=='calendar'&&typeof _calV2Teardown==='function')_calV2Teardown();
        // Codex review, PR for item 176 (seventh pass): render() bypasses
        // navTo() (see the comment above), so navTo's own card-link
        // abandonment never ran for this exit either.
        if(typeof _calAbandonLinkOnCalendarExit==='function')_calAbandonLinkOnCalendarExit(tab==='calendar');
        if(clientOnly&&_syncviewRenderClientExtrasGate(sel,tab))return;
        const existingBack=titleRow.querySelector('.back-btn');
        if(sel!=='all'&&!clientOnly){
            pageTop.classList.remove('overview-mode');
            pageTitle.style.display='none';pageSub.style.display='none';selectorWrap.style.display='none';
            if(!existingBack){
                const btn=document.createElement('button');
                btn.className='back-btn';btn.innerHTML='← Back';
                btn.onclick=()=>{ navTo(currentNav); };
                titleRow.insertBefore(btn,titleRow.firstChild);
            }
        } else if(!clientOnly){
            pageTop.classList.add('overview-mode');
            pageTitle.style.display='';pageSub.style.display='';selectorWrap.style.display='';
            if(existingBack)existingBack.remove();
        }
        /* A client page reads TopVideos and the briefs. A saved copy queues
           them one frame behind the overview (_analyticsApplySnapshot), so
           apply them now if they are still queued; if they have not arrived
           at all yet, show the client skeleton and draw once they land rather
           than drawing the page without them. */
        if(sel!=='all'){
            if(typeof _analyticsFlushPendingExtras==='function')_analyticsFlushPendingExtras();
            const needsExtras=!clientOnly&&tab!=='calendar'&&typeof _analyticsExtrasApplied!=='undefined'&&!_analyticsExtrasApplied;
            const arrival=needsExtras?_analyticsExtrasArrival():null;
            // Nothing left to wait on and nothing applied: the load already
            // failed. Offer a retry rather than a page with empty videos/briefs.
            const showExtrasError=()=>{
                content.innerHTML='<div class="error-state">Couldn\'t load this client\'s videos and briefs. <button type="button" class="back-btn" id="analyticsExtrasRetry">Try again</button></div>';
                const b=document.getElementById('analyticsExtrasRetry');
                if(b)b.onclick=()=>{ content.innerHTML=_svLoadingSkeletonHtml('analytics-client'); fetchExtras().then(()=>render(sel,false),()=>render(sel,false)); };
            };
            if(needsExtras&&!arrival){showExtrasError();return;}
            if(arrival){
                const want=sel;
                /* PAINT FROM WHAT ARRIVED. The Analytics tab's numbers and
                   charts come from Metrics, which is already applied; only
                   the top-videos and summary sections need TopVideos (16 MB,
                   ~0.5 s to read and parse even from the saved copy, measured
                   2026-09-24). Draw the page now with placeholders there and
                   redraw once they land. The Brief tab still waits. */
                const early=tab==='analytics'&&clientHistory(sel).length>0;
                if(early){
                    _analyticsExtrasEarly=true;
                    try{ content.innerHTML=renderClient(sel,clientHistory(sel),clientOnly); }
                    finally{ _analyticsExtrasEarly=false; }
                    const hist=clientHistory(sel);
                    setTimeout(()=>{renderChart(hist);renderViewsChart(hist);},0);
                }else content.innerHTML=_svLoadingSkeletonHtml('analytics-client');
                const wantTab=tab;
                arrival.then(()=>{
                    const st=history.state;
                    if(!(currentNav==='home'&&st&&st.client&&wlCanonicalClient(st.client)===want))return;
                    // Same client on another tab (e.g. its Calendar): leave it alone.
                    if((clientViewTab[want]||'analytics')!==wantTab)return;
                    // Neither the saved nor the live extras applied: say so and
                    // offer a retry, never draw the page with empty videos/briefs.
                    if(!_analyticsExtrasApplied){showExtrasError();return;}
                    const sc=window.scrollY;
                    render(want,false);
                    if(early)window.scrollTo({top:sc,behavior:'instant'});
                });
                return;
            }
        }
        if(sel==='all'){
            content.innerHTML=renderOverview(latestPerClient());
            const pr=document.getElementById('pinsArea');
            if(pr)pr.style.display='';
            return;
        }
        const _pr=document.getElementById('pinsArea');
        if(_pr)_pr.style.display='none';
        const hist=clientHistory(sel);
        // A calendar-only client (no analytics history) can still be opened on
        // its Content Calendar tab via a share link — only bail to "No data"
        // when the tab actually needs analytics.
        if(!hist.length&&!['calendar','brief'].includes(tab)){content.innerHTML=`<div class="error-state">No data for "${sel}"</div>`;return;}
        content.innerHTML=renderClient(sel,hist,clientOnly);
        if(tab==='analytics')setTimeout(()=>{renderChart(hist);renderViewsChart(hist);},0);
        else if(tab==='calendar')setTimeout(()=>mountCalendarEmbedded(sel),0);
    }

    function selectClient(name){
        svSharedClientNote(name);
        const tab = 'analytics';
        clientViewTab[name] = tab;
        history.pushState({nav:currentNav, client:name, clientTab:tab},'','#'+encodeURIComponent(name));
        render(name,false);
        window.scrollTo({top:0,behavior:'instant'});
    }

    window.addEventListener('popstate',(e)=>{
        // Several branches below route without navTo; keep the client bar in step.
        setTimeout(()=>{ if (typeof svClientBarSync === 'function') svClientBarSync(currentNav); },0);
        const state=e.state;
        if(_isClientLink){
            const cap=_syncviewClientEntryCapability;
            const envelope=_syncviewClientEntryEnvelope();
            const tab=state&&state.clientTab;
            const sameClient=!!(cap&&cap.verified&&state&&state.client&&_syncviewClientEntrySlug(state.client)===cap.slug);
            if(!envelope.ok||!sameClient||!['analytics','calendar','brief','sample-reviews'].includes(tab)){
                _syncviewInvalidClientLinkScreen();
                return;
            }
            _syncviewSetClientEntryCapability(Object.freeze({client:cap.client,slug:cap.slug,view:tab,verified:true}));
            _syncviewSyncClientEntryRunHref();
            if(tab==='sample-reviews'){
                mountSxrClientView(cap.client);
                return;
            }
            clientViewTab[cap.client]=tab;
            if(state.briefSection)activeBriefSection[cap.client]=state.briefSection;
            if(state.briefTab)activeBriefTab[cap.client]=state.briefTab;
            if(state.mrBriefTab)activeMRBriefTab[cap.client]=state.mrBriefTab;
            render(cap.client,true);
            window.scrollTo({top:0,behavior:'instant'});
            return;
        }
        if(state&&state.client){
            const nav=state.nav||'home';
            _syncviewSetCurrentNav(nav);
            try{if(!_isSmmWeeklyRoute(nav))localStorage.setItem(NAV_KEY,nav);}catch(e){}   // full quota must not break Back/Forward nav
            document.body.classList.remove('prod-page'); // Back/Forward out of Production must restore body scroll
            document.getElementById('navHome').classList.toggle('active',nav==='home');
            document.getElementById('navLinear').classList.remove('active');
            const navTpl=document.getElementById('navTemplates');
            if(navTpl)navTpl.classList.remove('active');
            const navWl=document.getElementById('navWorkload');
            if(navWl)navWl.classList.remove('active');
            // Back/Forward into a client profile never reaches navTo, so the tab
            // icon would otherwise keep whatever section the user came FROM.
            _syncviewApplyTabFavicon(nav);
            const tab=state.clientTab||'analytics';
            if(tab!=='calendar'&&typeof _calV2Teardown==='function')_calV2Teardown();
            // Codex review, PR for item 176 (seventh pass): this branch never
            // reaches navTo() either (see the comment above).
            if(typeof _calAbandonLinkOnCalendarExit==='function')_calAbandonLinkOnCalendarExit(tab==='calendar');
            clientViewTab[state.client]=tab;
            if(state.briefSection)activeBriefSection[state.client]=state.briefSection;
            if(state.briefTab)activeBriefTab[state.client]=state.briefTab;
            if(state.mrBriefTab)activeMRBriefTab[state.client]=state.mrBriefTab;
            document.getElementById('pageTop').style.display='';
            const hist=clientHistory(state.client);
            document.getElementById('content').innerHTML=renderClient(state.client,hist,_isClientLink);
            if(tab==='analytics')setTimeout(()=>{renderChart(hist);renderViewsChart(hist);},0);
            else if(tab==='calendar')setTimeout(()=>mountCalendarEmbedded(state.client),0);
            window.scrollTo({top:0,behavior:'instant'});
        } else if(state&&state.nav==='templates'){
            _templatesSelected = state.templatesClient || null;
            if (state.templatesTab === 'reels' || state.templatesTab === 'thumbnails') _templatesActiveTab = state.templatesTab;
            navTo('templates', false);
        } else if(state&&state.nav){
            navTo(state.nav,false);
        } else {
            /* A history entry with NO state is one this app did not create: a
               fragment navigation typed, bookmarked, or followed into an
               already-open tab, and any Back/Forward across such an entry. The
               browser fires popstate for it -- BEFORE hashchange, and this file
               registers no hashchange listener at all -- with state === null.

               This branch used to know three routes (templates, templates/<client>,
               and a bare client name) and sent everything else to render(all).
               That is the OPEN_REPAIRS item 84 defect, and it is a repaint, not a
               failure to mount: the calendar DOES mount, and is then painted over
               by the analytics overview a moment later. render() never assigns
               currentNav and never touches the nav pills or calState, so the tab
               keeps reading as active while its DOM is gone, no exception is
               thrown, and nothing is logged -- which is why it read as a silent
               non-mount. The SMM bookmark for a client calendar is exactly this
               shape.

               So route the known hashes the same way the boot router does, and
               keep render(all) for what is genuinely unrecognized. The unlock
               gates are repeated here on purpose: popstate must never be a way
               into a tab the session has not unlocked. Client links are left
               exactly as they were -- they have their own entry surface, and
               widening their routing from here is not something this repair
               needs. */
            const hash=decodeURIComponent(svRoute.hash().replace('#',''));
            const hashRoute=hash.split('?')[0];
            if(hash==='templates'){_templatesSelected=null;navTo('templates',false);return;}
            if(hash.startsWith('templates/')){const tn=hash.slice('templates/'.length);if(wlIsAllowedClient(tn)){_templatesSelected=wlCanonicalClient(tn);navTo('templates',false);return;}}
            if(!_isClientLink){
                if(hash.startsWith('calendar/')){
                    const rest=hash.slice('calendar/'.length);
                    const sl=rest.indexOf('/');
                    const slug=sl>=0?rest.slice(0,sl):rest;
                    const cardId=sl>=0?rest.slice(sl+1):'';
                    const match=WL_CLIENT_NAMES.find(n=>wlNormalizeClient(n)===slug);
                    if(match)_calSetFocusRequest({client:match,cardId:cardId||null});
                    /* A slug the seed allowlist does not know is NOT nothing: it
                       is usually a sheet-only client, and the boot router has an
                       arm for exactly this. Without it the calendar mounts on
                       whichever client was previously active and _calSyncUrlClient
                       then rewrites the address bar to that client -- the reader
                       is silently on the wrong calendar and the URL they followed
                       is gone. Measured in review of this change, which is how it
                       got here. The resolver runs AFTER navTo because it
                       early-returns unless currentNav is already calendar, and it
                       has its own fallback when the slug never resolves. */
                    else if(slug)_calSetPendingDeepLink({slug,cardId:cardId||null});
                    navTo('calendar',false);
                    if(!match&&slug){try{_calResolvePendingDeepLink();}catch(e){console.warn('[Calendar] deep-link resolve failed',e);}}
                    return;
                }
                if(hash.startsWith('samples/')){navTo('samples',false);return;} // retired Samples Old link -> Sample reviews
                if(hash==='kasper'||hash.startsWith('kasper/')){
                    if(_kasperUnlocked){
                        if(hash.startsWith('kasper/')){
                            const sub=hash.slice('kasper/'.length);
                            const key=_kasperResolveSubtab(sub);if(key)_kasperState.tab=key;
                        }
                        navTo('kasper',false);return;
                    }
                }
                else if(hash==='sample-reviews'||hash.startsWith('sample-reviews/')){navTo('sample-reviews',false);return;}
                else if(['linear','workload','calendar','samples','filming-plans','tiktok-upload','time-off','staff-onboarding','client-credentials'].includes(hash)
                        ||hashRoute==='smm-weekly-report'||hashRoute==='smm-weekly-reports'){
                    navTo(hashRoute||hash,false);return;
                }
            }
            if(hash&&wlIsAllowedClient(hash)){
                render(wlCanonicalClient(hash),false);window.scrollTo({top:0,behavior:'instant'});
            } else {
                render('all');window.scrollTo({top:0,behavior:'instant'});
            }
        }
    });

    const RECENT_KEY='syncview_recent_searches';
    function getRecent(){try{return JSON.parse(localStorage.getItem(RECENT_KEY)||'[]');}catch{return[];}}
    function addRecent(name){let r=getRecent().filter(n=>n!==name);r.unshift(name);r=r.slice(0,3);try{localStorage.setItem(RECENT_KEY,JSON.stringify(r));}catch(e){}}
    function openSearchDropdown(){const box=document.getElementById('searchBox');if(!box||box.classList.contains('open'))return;box.classList.add('open');const close=(e)=>{const wrap=document.getElementById('searchWrap');if(wrap&&!wrap.contains(e.target)){box.classList.remove('open');document.removeEventListener('click',close);}};setTimeout(()=>document.addEventListener('click',close),0);}
    function onSearchFocus(){renderSearchResults(document.getElementById('searchInput')?.value||'');openSearchDropdown();}
    function onSearchIconClick(){const inp=document.getElementById('searchInput');const q=inp?.value.trim();if(q){const allNames=getClientRoster();const first=clientSearchMatches(q,allNames)[0];if(first){searchGoTo(first);return;}}inp?.focus();openSearchDropdown();}
    function onSearchInput(){const q=document.getElementById('searchInput').value;renderSearchResults(q);updateSearchGhost(q);openSearchDropdown();}
    function updateSearchGhost(q){const ghost=document.getElementById('searchGhost');const inp=document.getElementById('searchInput');if(!ghost||!inp)return;const allNames=getClientRoster();ghost.innerHTML=clientSearchGhostHtml(q,allNames);}
    function onSearchKey(e){if(e.key==='Escape'){const box=document.getElementById('searchBox');const ghost=document.getElementById('searchGhost');if(box)box.classList.remove('open');if(ghost)ghost.innerHTML='';document.getElementById('searchInput')?.blur();return;}if(e.key!=='Enter')return;const q=document.getElementById('searchInput')?.value.trim();if(!q)return;const allNames=getClientRoster();const first=clientSearchMatches(q,allNames)[0];if(first)searchGoTo(first);}
    // The client search behind the Analytics picker, shared so every client
    // search looks and ranks the same: names that START with the query first,
    // then names that merely contain it; the ghost previews the top match.
    function clientSearchMatches(q,names){const q2=String(q||'').trim().toLowerCase();if(!q2)return[];const starts=names.filter(n=>n.toLowerCase().startsWith(q2));const contains=names.filter(n=>!n.toLowerCase().startsWith(q2)&&n.toLowerCase().includes(q2));return[...starts,...contains];}
    function clientSearchGhostHtml(q,names){const q2=String(q||'').trim().toLowerCase();if(!q2)return'';const first=clientSearchMatches(q,names)[0];if(!first)return'';const key='margin-left:8px;font-size:0.65rem;color:var(--text-muted);opacity:0.4;background:var(--border);border-radius:3px;padding:1px 5px;flex-shrink:0;';if(first.toLowerCase().startsWith(q2)){return`<span style="color:transparent;white-space:pre">${_calEsc(first.slice(0,q.length))}</span><span style="color:var(--text-muted);opacity:0.55;white-space:pre">${_calEsc(first.slice(q.length))}</span><span style="${key}">↵</span>`;}return`<span style="color:transparent;white-space:pre">${_calEsc(q)}</span><span style="${key}">↵ ${_calEsc(first)}</span>`;}
    function clientSearchResultsHtml(q,names,recent,pickAttr){const q2=String(q||'').trim();if(!q2){if(!recent.length)return'';return`<div class="search-section-label">Recent</div>`+recent.map(name=>`<div class="search-suggestion" ${pickAttr(name)}><span class="s-icon">↩</span><span>${_calEsc(name)}</span></div>`).join('');}const matches=clientSearchMatches(q2,names);if(!matches.length)return`<div class="search-empty">No clients found</div>`;return matches.slice(0,6).map(name=>`<div class="search-suggestion" ${pickAttr(name)}><span class="s-icon">👤</span><span>${highlightMatch(_calEsc(name),_calEsc(q2))}</span></div>`).join('');}
    function highlightMatch(name,q){if(!q)return name;const idx=name.toLowerCase().indexOf(q.toLowerCase());if(idx<0)return name;return name.slice(0,idx)+`<span class="s-match">`+name.slice(idx,idx+q.length)+`</span>`+name.slice(idx+q.length);}
    function renderSearchResults(q){const el=document.getElementById('searchResults');if(!el)return;const allNames=getClientRoster();const recent=getRecent().filter(n=>allNames.includes(n));el.innerHTML=clientSearchResultsHtml(q,allNames,recent,name=>`onclick="searchGoTo(${_jsAttrArg(name)})"`);}
    function searchGoTo(name){addRecent(name);const box=document.getElementById('searchBox');const inp=document.getElementById('searchInput');const ghost=document.getElementById('searchGhost');if(box)box.classList.remove('open');if(inp){inp.value='';inp.blur();}if(ghost)ghost.innerHTML='';selectClient(name);}

    const PINS_KEY='syncview_pinned_clients';
    const MAX_PINS=3;
    let pinsEditMode=false;
    let pinSelectorOpen=false;
    const PIN_ICON_SVG='<svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M5 1h6v1l-1 4 2 2v1H9v5l-1 1-1-1V9H3V8l2-2L4 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><line x1="8" y1="9" x2="8" y2="15" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
    const PEN_ICON_SVG='<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-8 8H3v-3l8-8z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const CHECK_SVG='<svg width="8" height="8" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5L8 3" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    function getPins(){try{return JSON.parse(localStorage.getItem(PINS_KEY)||'[]');}catch{return[];}}
    function savePins(pins){try{localStorage.setItem(PINS_KEY,JSON.stringify(pins));}catch(e){}}
    function togglePin(name){let pins=getPins();if(pins.includes(name))pins=pins.filter(p=>p!==name);else{if(pins.length>=MAX_PINS)return;pins.push(name);}savePins(pins);renderPins();}
    function removePin(name){const pins=getPins().filter(p=>p!==name);savePins(pins);if(pins.length===0)pinsEditMode=false;pinSelectorOpen=false;renderPins();}
    function togglePinsEdit(){pinsEditMode=!pinsEditMode;pinSelectorOpen=false;renderPins();}
    function closePinSelector(){pinSelectorOpen=false;const dd=document.getElementById('pinSelectorDropdown');if(dd)dd.classList.remove('open');}
    function togglePinSelector(){if(pinSelectorOpen){closePinSelector();return;}pinSelectorOpen=true;const dd=document.getElementById('pinSelectorDropdown');if(dd){dd.classList.add('open');renderPinSelectorList();}const close=(e)=>{const addRow=document.getElementById('pinsAddRow');if(addRow&&!addRow.contains(e.target)){closePinSelector();document.removeEventListener('click',close);}};setTimeout(()=>document.addEventListener('click',close),0);}
    function renderPins(){
        const row=document.getElementById('pinsRow'),addRow=document.getElementById('pinsAddRow'),area=document.getElementById('pinsArea');
        if(!row||!addRow)return;
        const pins=getPins();
        row.innerHTML='';
        pins.forEach(name=>{const pill=document.createElement('a');pill.className='pin-pill';pill.href='#'+encodeURIComponent(name);pill.style.textDecoration='none';pill.style.color='inherit';if(!pinsEditMode)pill.onclick=(e)=>{e.preventDefault();selectClient(name);};else pill.onclick=(e)=>{e.preventDefault();};const nameSpan=document.createElement('span');nameSpan.textContent=name;pill.appendChild(nameSpan);if(pinsEditMode){const rm=document.createElement('span');rm.className='pin-remove';rm.title='Remove';rm.textContent='✕';rm.onclick=(e)=>{e.preventDefault();e.stopPropagation();removePin(name);};pill.appendChild(rm);}row.appendChild(pill);});
        if(pins.length>=1){const editBtn=document.createElement('button');editBtn.className='pin-edit-btn'+(pinsEditMode?' active':'');editBtn.title=pinsEditMode?'Done':'Edit pins';editBtn.innerHTML=pinsEditMode?'<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>':PEN_ICON_SVG;editBtn.onclick=togglePinsEdit;row.appendChild(editBtn);}
        addRow.innerHTML='';
        const showAddBtn=pins.length<MAX_PINS&&(pins.length===0||pinsEditMode||pinSelectorOpen);
        if(showAddBtn){const addBtn=document.createElement('button');addBtn.className='pin-add-btn';addBtn.title='Pin a client';addBtn.innerHTML=PIN_ICON_SVG+' Pin client <span style="opacity:0.6;font-size:0.68rem;">'+pins.length+'/'+MAX_PINS+'</span>';addBtn.onclick=togglePinSelector;addRow.appendChild(addBtn);const dd=document.createElement('div');dd.className='pin-selector-dropdown'+(pinSelectorOpen?' open':'');dd.id='pinSelectorDropdown';const hdr=document.createElement('div');hdr.className='pin-selector-header';hdr.innerHTML='<span class="pin-selector-title">Pin a client</span><div style="display:flex;align-items:center;gap:8px;"><span class="pin-selector-count">'+pins.length+' / '+MAX_PINS+'</span><button style="background:none;border:none;cursor:pointer;color:var(--text-muted);display:inline-flex;align-items:center;padding:0;transition:color 0.13s;" id="pinDropCloseBtn" title="Close"><svg width="9" height="9" viewBox="0 0 10 10" fill="none"><line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></div>';dd.appendChild(hdr);const list=document.createElement('div');list.className='pin-selector-list';list.id='pinSelectorList';dd.appendChild(list);addRow.appendChild(dd);const closeBtn=dd.querySelector('#pinDropCloseBtn');if(closeBtn)closeBtn.onclick=(e)=>{e.stopPropagation();closePinSelector();};if(pinSelectorOpen)renderPinSelectorList();}else if(!showAddBtn&&pinSelectorOpen){pinSelectorOpen=false;}
        if(area)area.style.display='';
    }
    function renderPinSelectorList(){const list=document.getElementById('pinSelectorList');if(!list)return;const pins=getPins();const allNames=getClientRoster();list.innerHTML='';allNames.forEach(name=>{const isPinned=pins.includes(name);const disabled=!isPinned&&pins.length>=MAX_PINS;const item=document.createElement('div');item.className='pin-selector-item'+(isPinned?' pinned':'');if(disabled)item.style.cssText='opacity:0.35;cursor:default;';const nameSpan=document.createElement('span');nameSpan.textContent=name;const check=document.createElement('span');check.className='pin-check';if(isPinned)check.innerHTML=CHECK_SVG;item.appendChild(nameSpan);item.appendChild(check);if(!disabled)item.onclick=(e)=>{e.stopPropagation();togglePin(name);};list.appendChild(item);});}

    function goHome(){navTo('home');}

    /* ── Templates View ──────────────────────────────────────────────────
       Shared client-template store: the Supabase `templates` table, read over
       REST and written through the templates-save Edge Function. The Google
       Sheet and its two n8n webhooks were retired 2026-09-24 after every row
       was confirmed present in Supabase; nothing here reads the sheet now.
    */
    const TEMPLATES_SAVE_EF_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/templates-save';

    const TEMPLATE_FIELDS = [
        'filming_plans_link',
        'reels_subtitle_font','reels_subtitle_main_color','reels_subtitle_highlight_color',
        'reels_reference_link','reels_preferences','reels_editor_folder_link',
        'thumbnails_title_font','thumbnails_title_color','thumbnails_highlight_color',
        'thumbnails_photos_link',
    ];
    let templatesData = {};       // { clientName: { ...fields, updated_at } }
    let templatesLoaded = false;
    let templatesLoadError = null;
    let _templatesSelected = null;          // currently open client (or null = index)
    let _templatesActiveTab = 'reels';      // 'reels' | 'thumbnails'
    let _templatesEditMode = false;         // false = view mode, true = edit mode
    const _tplSaveTimers = {};              // debounce timers by `${client}::${field}`
    const _tplSaveInFlight = {};            // true while a save is in flight, by client (serializes saves)
    const _tplDirty      = {};              // pending patches by client {field: value}
    const TPL_RECENT_KEY = 'syncview_tpl_recent_searches';
    const TPL_PINS_KEY   = 'syncview_tpl_pinned_clients';
    const TPL_MAX_PINS   = 5;
    let _tplPinsEditMode = false;
    let _tplPinSelectorOpen = false;
    function _templatesSetSelected(value) { _templatesSelected = value; }
    function _templatesSetActiveTab(value) { _templatesActiveTab = value; }
    function _templatesSetEditMode(value) { _templatesEditMode = value; }
    function _tplSetPinsEditMode(value) { _tplPinsEditMode = value; }
    function _tplSetPinSelectorOpen(value) { _tplPinSelectorOpen = value; }
    let _tplRealtimeChannel = null;
    let _tplRealtimeConnected = false;
    let _tplCatchupTimer = null;
    let _tplCatchupInFlight = false;
    let _tplReconnectCatchupPending = false;
    const TPL_CATCHUP_POLL_MS = 60 * 1000;

    function _tplStopCatchupPoll() {
        if (_tplCatchupTimer) { clearInterval(_tplCatchupTimer); _tplCatchupTimer = null; }
    }
    async function _tplCatchup() {
        if (currentNav !== 'templates' || document.visibilityState === 'hidden' || _tplCatchupInFlight) return;
        _tplCatchupInFlight = true;
        // If a poll was in flight when the channel reconnected, its response
        // could predate the reconnect. Queue one read after that poll settles.
        const clearedPending = _tplRealtimeConnected;
        if (clearedPending) {
            _tplReconnectCatchupPending = false;
            _tplStopCatchupPoll();
        }
        let ok = false;
        try { ok = (await loadTemplates()) === true; }
        finally {
            _tplCatchupInFlight = false;
            // A failed catch-up read must not end the catch-up: keep it armed
            // and keep polling until one read succeeds.
            if (clearedPending && !ok) {
                _tplReconnectCatchupPending = true;
                _tplStartCatchupPoll();
            } else if (_tplRealtimeConnected && _tplReconnectCatchupPending) _tplCatchup();
        }
    }
    function _tplStartCatchupPoll() {
        if (_tplCatchupTimer) return;
        _tplCatchupTimer = setInterval(() => {
            if (!_tplRealtimeConnected || _tplReconnectCatchupPending) _tplCatchup();
        }, TPL_CATCHUP_POLL_MS);
    }

    async function _tplLoadFromSupabase() {
        if (!CAL_SUPABASE_URL || !CAL_SUPABASE_ANON_KEY) throw new Error('Supabase not configured');
        const url = CAL_SUPABASE_URL + '/rest/v1/templates?select=client_slug,data,updated_at&order=client_slug.asc';
        const resp = await fetch(url, { headers: { apikey: CAL_SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY, Accept: 'application/json' } });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const rows = await resp.json();
        const out = {};
        (Array.isArray(rows) ? rows : []).forEach(row => {
            const data = row && row.data && typeof row.data === 'object' ? row.data : {};
            const name = String(data.client_name || row.client_slug || '').trim();
            if (!name) return;
            out[name] = Object.assign({}, data, { updated_at: row.updated_at || data.updated_at || '' });
        });
        return out;
    }

    async function _tplSubscribeSupabase() {
        if (_tplRealtimeChannel) return;
        // An existing channel object is not proof that its socket connected.
        _tplStartCatchupPoll();
        try {
            const client = await _calRuntimeFlagClient();
            if (!client || _tplRealtimeChannel) return;
            const channel = client
                .channel('syncview-templates')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'templates' }, (payload) => {
                    const row = payload && payload.new ? payload.new : null;
                    const data = row && row.data && typeof row.data === 'object' ? row.data : null;
                    const name = data ? String(data.client_name || row.client_slug || '').trim() : '';
                    if (!name) return;
                    templatesData[name] = Object.assign({}, templatesData[name] || {}, data, { updated_at: row.updated_at || data.updated_at || '' });
                    _maybeRerenderTemplates();
                });
            _tplRealtimeChannel = channel;
            channel.subscribe((status) => {
                if (_tplRealtimeChannel !== channel) return;
                if (status === 'SUBSCRIBED') {
                    _tplRealtimeConnected = true;
                    if (_tplReconnectCatchupPending) _tplCatchup();
                    else _tplStopCatchupPoll();
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    _tplRealtimeConnected = false;
                    _tplReconnectCatchupPending = true;
                    _tplStartCatchupPoll();
                }
            });
        } catch (e) {
            console.warn('[SyncView] templates realtime subscribe failed', e);
            _tplRealtimeChannel = null;
            _tplRealtimeConnected = false;
        }
    }

    /* SAVED COPY. A staff browser paints its last good copy first and
       refreshes behind once the Supabase rows land. The copy is
       ~12 KB, so localStorage; client links never read or write it. */
    const TPL_SAVED_KEY = 'syncview_templatesCache_v1';
    const TPL_SAVED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
    function _tplSavedAllowed() { return !(typeof _isClientLink !== 'undefined' && _isClientLink); }
    function _tplSavedRead() {
        try {
            if (!_tplSavedAllowed()) return null;
            const o = JSON.parse(localStorage.getItem(TPL_SAVED_KEY) || 'null');
            if (!o || !o.templates || typeof o.templates !== 'object' || !(Date.now() - Number(o.at) < TPL_SAVED_MAX_AGE_MS)) return null;
            return o.templates;
        } catch (e) { return null; }
    }
    function _tplSavedWrite(templates) {
        try {
            if (!_tplSavedAllowed()) return;
            const json = JSON.stringify({ at: Date.now(), templates });
            if (json.length > 900 * 1024) { localStorage.removeItem(TPL_SAVED_KEY); return; }
            localStorage.setItem(TPL_SAVED_KEY, json);
        } catch (e) {}
    }
    // A refresh landing behind a saved copy must not overwrite a client whose
    // edits are still queued or in flight.
    function _tplKeepLocalEdits(next) {
        Object.keys(templatesData || {}).forEach(name => {
            const dirty = _tplDirty[name] && Object.keys(_tplDirty[name]).length;
            if (dirty || _tplSaveInFlight[name]) next[name] = templatesData[name];
        });
        return next;
    }
    function _tplClientReady(name) {
        return templatesLoaded;
    }
    async function loadTemplates() {
        const saved = templatesLoaded ? null : _tplSavedRead();
        if (saved) { templatesData = saved; templatesLoaded = true; templatesLoadError = null; _maybeRerenderTemplates(); }
        try {
            const live = await _tplLoadFromSupabase();
            _tplSubscribeSupabase();
            _tplSavedWrite(live);
            templatesData = _tplKeepLocalEdits(live);
            templatesLoaded = true;
            templatesLoadError = null;
        } catch (e) {
            console.warn('[SyncView] loadTemplates failed:', e);
            templatesLoadError = e.message || String(e);
            _maybeRerenderTemplates();
            return false;
        }
        _maybeRerenderTemplates();
        return true;
    }
    function _maybeRerenderTemplates() {
        if (currentNav !== 'templates') return;
        const content = document.getElementById('content');
        if (!content) return;
        const ae = document.activeElement;
        // Don't yank the caret out of a field the user is actively editing when
        // a realtime echo lands: covers plain fields, the color-set inputs, and
        // the multiple-link inputs (each keyed by its own data-attr).
        if (ae && ae.hasAttribute && (ae.hasAttribute('data-tpl-field') || ae.hasAttribute('data-tpl-set') || ae.hasAttribute('data-tpl-link-set'))) return;
        // Same for a "Send a change" box being typed into.
        // Only a field being typed into blocks it; a focused Save/Cancel button must not.
        if (ae && ae.matches && ae.matches('input, textarea') && (ae.closest('.tpl-brain-form') || ae.closest('.tpl-spec-form'))) return;
        // Templates is an on-demand area: nothing to redraw until it has loaded.
        const tpl = svAreaApi('templates');
        if (!tpl) return;
        content.innerHTML = tpl.renderTemplates();
        tpl.mountTemplates();
    }

    function _tplGet(name, field) {
        return (templatesData[name] && templatesData[name][field]) || '';
    }

    let _tplSaveErrorMsg = '';
    function _setTplStatus(state, message) {
        // Drive the reusable modern indicator in the client header. Track the error
        // so a re-render (add/remove link, realtime echo) restores the persistent
        // error state via mountTemplatesView.
        _tplSaveErrorMsg = (state === 'error') ? (message || 'Save failed — will retry') : '';
        _svSaveIndApply(document.querySelector('[data-sv-save-ind="templates"]'), state, message);
    }

    async function _tplFlush(name) {
        // Serialize per client. A second flush firing while one is in flight
        // used to abort the first request, but the first had already cleared
        // _tplDirty — so its fields were dropped (the AbortError branch never
        // re-queued them) and a typed value could be lost. Instead, leave the
        // accumulated patch in _tplDirty and let the in-flight flush re-flush
        // it when it finishes, mirroring the calendar's _calSaveInFlight.
        if (_tplSaveInFlight[name]) return;
        const patch = _tplDirty[name];
        if (!patch || !Object.keys(patch).length) return;
        delete _tplDirty[name];
        _tplSaveInFlight[name] = true;
        _setTplStatus('saving');
        let ok = false;
        try {
            const writeUrl = TEMPLATES_SAVE_EF_URL;
            const resp = await _writeUiTrackSave('templates', 'templates_save', () => ({ client_slug: calClientSlug(name) }), () => fetch(writeUrl, {
                method: 'POST',
                headers: _settingsWriteHeaders('templates', writeUrl),
                body: JSON.stringify({ clientName: name, patch }),
            }), { requireOk: true });
            const json = await resp.json();
            if (!json.ok) throw new Error(json.error || 'Save failed');
            // Merge — never replace. The server only echoes back the fields it just wrote
            // (plus updated_at), so a replace would wipe every other field from local state
            // until the next page reload.
            templatesData[name] = Object.assign({}, templatesData[name] || {}, json.template || {});
            ok = true;
            _setTplStatus('saved');
            setTimeout(() => {
                const badge = document.getElementById('tplStatusBadge');
                if (badge && badge.classList.contains('saved')) _setTplStatus('idle');
            }, 2000);
        } catch (e) {
            console.warn('[SyncView] template save failed:', e);
            // Re-queue this patch (newer edits made mid-flight win over it).
            _tplDirty[name] = Object.assign({}, patch, _tplDirty[name] || {});
            _setTplStatus('error', e.message || 'Save failed — try again');
        } finally {
            delete _tplSaveInFlight[name];
            // Flush edits that accumulated during the round-trip. Only auto-
            // re-flush on success — on failure the patch sits in _tplDirty and
            // re-sends on the next edit/blur, so we don't hammer a failing
            // endpoint in a tight loop.
            if (ok && _tplDirty[name] && Object.keys(_tplDirty[name]).length) _tplFlush(name);
        }
    }

    function _tplQueueSave(name, field, value, immediate) {
        if (!templatesData[name]) templatesData[name] = { client_name: name };
        templatesData[name][field] = value;
        if (!_tplDirty[name]) _tplDirty[name] = {};
        _tplDirty[name][field] = value;

        const key = name + '::' + field;
        if (_tplSaveTimers[key]) clearTimeout(_tplSaveTimers[key]);
        const delay = immediate ? 0 : 600;
        _tplSaveTimers[key] = setTimeout(() => { delete _tplSaveTimers[key]; _tplFlush(name); }, delay);
        _setTplStatus('saving');
    }

    function _tplEsc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function _tplEscAttr(s) { return _tplEsc(s).replace(/'/g,"&#39;"); }

    /* ── Edit-mode field renderers ──────────────────────────────────────── */
    function _tplFieldText(name, field, label, placeholder) {
        const v = _tplGet(name, field);
        return `<div class="tpl-field"><label class="tpl-field-label">${label}</label>
            <input class="tpl-input" type="text" data-tpl-client="${_tplEsc(name)}" data-tpl-field="${field}"
                   value="${_tplEsc(v)}" placeholder="${_tplEsc(placeholder||'')}" /></div>`;
    }
    function _tplFieldTextarea(name, field, label, placeholder) {
        const v = _tplGet(name, field);
        return `<div class="tpl-field"><label class="tpl-field-label">${label}</label>
            <textarea class="tpl-textarea" data-tpl-client="${_tplEsc(name)}" data-tpl-field="${field}"
                      placeholder="${_tplEsc(placeholder||'')}" rows="4">${_tplEsc(v)}</textarea></div>`;
    }
    function _tplFieldColor(name, field, label, offField) {
        const v = _tplGet(name, field) || '';
        const safe = /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#000000';
        const isOff = offField ? !!_tplGet(name, offField) : false;
        const head = offField
            ? `<div class="tpl-field-head"><label class="tpl-field-label">${label}</label>
                 <label class="tpl-toggle-mini">
                   <input type="checkbox" data-tpl-client="${_tplEsc(name)}" data-tpl-field="${offField}" data-tpl-bool data-tpl-disables-pair="${field}"${isOff?' checked':''} />
                   <span class="tpl-toggle-mini-track"><span class="tpl-toggle-mini-thumb"></span></span>
                   <span>No highlight</span>
                 </label>
               </div>`
            : `<label class="tpl-field-label">${label}</label>`;
        return `<div class="tpl-field">${head}
            <div class="tpl-color-row${isOff?' tpl-color-off':''}" data-tpl-color-row="${field}">
                <input class="tpl-color-swatch" type="color" data-tpl-client="${_tplEsc(name)}" data-tpl-field="${field}" data-tpl-color-pair="${field}" value="${safe}" />
                <input class="tpl-input tpl-color-hex" type="text" data-tpl-client="${_tplEsc(name)}" data-tpl-field="${field}" data-tpl-color-pair="${field}" value="${_tplEsc(v)}" placeholder="#RRGGBB" maxlength="7" />
            </div></div>`;
    }
    function _tplFieldLink(name, field, label, placeholder) {
        const v = _tplGet(name, field);
        const isUrl = /^https?:\/\//i.test(v);
        return `<div class="tpl-field"><label class="tpl-field-label">${label}</label>
            <div class="tpl-link-row">
                <input class="tpl-input" type="url" data-tpl-client="${_tplEsc(name)}" data-tpl-field="${field}"
                       value="${_tplEsc(v)}" placeholder="${_tplEsc(placeholder||'https://…')}" />
                <a class="tpl-link-open${isUrl?'':' disabled'}" href="${isUrl?_tplEsc(v):'#'}" target="_blank" rel="noopener" title="Open link"
                   data-tpl-link-for="${field}">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M9.5 2.5h4v4M13.5 2.5L7 9M11 8.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </a>
            </div></div>`;
    }

    /* ── View-mode field renderers ──────────────────────────────────────── */
    const _NOT_SET = '<span class="tpl-not-set">Not set</span>';
    function _tplViewText(name, field, label) {
        const v = _tplGet(name, field);
        return `<div class="tpl-view-field">
            <div class="tpl-view-label">${label}</div>
            <div class="tpl-view-value">${v ? _tplEsc(v) : _NOT_SET}</div>
        </div>`;
    }
    function _tplViewColor(name, field, label) {
        const v = _tplGet(name, field) || '';
        const isHex = /^#[0-9a-fA-F]{6}$/.test(v);
        const swatch = isHex
            ? `<span class="tpl-view-swatch" style="background:${_tplEsc(v)}"></span>`
            : `<span class="tpl-view-swatch tpl-view-swatch-empty" aria-hidden="true"></span>`;
        return `<div class="tpl-view-field">
            <div class="tpl-view-label">${label}</div>
            <div class="tpl-view-value tpl-view-color-row">${swatch}<span class="tpl-view-color-hex">${v ? _tplEsc(v.toUpperCase()) : _NOT_SET}</span></div>
        </div>`;
    }
    function _tplViewLink(name, field, label, openLabel) {
        const v = _tplGet(name, field);
        const isUrl = /^https?:\/\//i.test(v);
        let host = '';
        if (isUrl) { try { host = new URL(v).hostname.replace(/^www\./,''); } catch {} }
        const value = isUrl
            ? `<a class="tpl-view-link" href="${_tplEsc(v)}" target="_blank" rel="noopener">
                ${openLabel || 'Open'}
                ${host ? `<span class="tpl-view-link-host">${_tplEsc(host)}</span>` : ''}
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M9.5 2.5h4v4M13.5 2.5L7 9M11 8.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </a>`
            : _NOT_SET;
        return `<div class="tpl-view-field">
            <div class="tpl-view-label">${label}</div>
            <div class="tpl-view-value">${value}</div>
        </div>`;
    }
    function _tplViewProse(name, field) {
        const v = _tplGet(name, field);
        if (!v) return `<div class="tpl-view-prose tpl-view-prose-empty">No preferences noted yet.</div>`;
        return `<div class="tpl-view-prose">${_tplEsc(v)}</div>`;
    }

    /* ── Thumbnails color sets (multiple title+highlight pairs) ─────────── */
    const TPL_MAX_COLOR_SETS = 5;
    function _tplGetColorSets(name) {
        const raw = _tplGet(name, 'thumbnails_color_sets');
        if (raw && typeof raw === 'string') {
            try {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr) && arr.length) {
                    return arr.map(s => ({ title: (s && s.title) || '', highlight: (s && s.highlight) || '' }));
                }
            } catch {}
        }
        // Migration: fall back to the single-pair legacy columns when no JSON yet.
        const t = _tplGet(name, 'thumbnails_title_color');
        const h = _tplGet(name, 'thumbnails_highlight_color');
        if (t || h) return [{ title: t || '', highlight: h || '' }];
        return [{ title: '', highlight: '' }];
    }
    function _tplSaveColorSets(name, sets) {
        const cleaned = (sets && sets.length ? sets : [{ title: '', highlight: '' }])
            .map(s => ({ title: (s && s.title) || '', highlight: (s && s.highlight) || '' }));
        _tplQueueSave(name, 'thumbnails_color_sets', JSON.stringify(cleaned), false);
        // Mirror the first set into the legacy single-pair columns so anything still reading those stays in sync.
        _tplQueueSave(name, 'thumbnails_title_color', cleaned[0].title, false);
        _tplQueueSave(name, 'thumbnails_highlight_color', cleaned[0].highlight, false);
    }
    function _tplAddColorSet(name) {
        const sets = _tplGetColorSets(name);
        if (sets.length >= TPL_MAX_COLOR_SETS) return;
        sets.push({ title: '', highlight: '' });
        _tplSaveColorSets(name, sets);
        if (_templatesSelected === name) {
            const content = document.getElementById('content');
            const tpl = svAreaApi('templates');
            if (content && tpl) { content.innerHTML = tpl.renderClientTemplate(name); tpl.mountTemplates(); }
        }
    }
    function _tplRemoveColorSet(name, index) {
        const sets = _tplGetColorSets(name);
        if (index < 0 || index >= sets.length) return;
        sets.splice(index, 1);
        if (sets.length === 0) sets.push({ title: '', highlight: '' });
        _tplSaveColorSets(name, sets);
        if (_templatesSelected === name) {
            const content = document.getElementById('content');
            const tpl = svAreaApi('templates');
            if (content && tpl) { content.innerHTML = tpl.renderClientTemplate(name); tpl.mountTemplates(); }
        }
    }

    function _tplRenderColorSetsEdit(name, sets, hlOff) {
        const items = sets.map((s, i) => {
            const titleSafe = /^#[0-9a-fA-F]{6}$/.test(s.title) ? s.title : '#000000';
            const hlSafe = /^#[0-9a-fA-F]{6}$/.test(s.highlight) ? s.highlight : '#000000';
            const removeBtn = sets.length > 1
                ? `<button class="tpl-set-remove" onclick="_tplRemoveColorSet(${_jsAttrArg(name)}, ${i})" title="Remove this set"><svg width="11" height="11" viewBox="0 0 12 12" fill="none"><line x1="2.5" y1="2.5" x2="9.5" y2="9.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="9.5" y1="2.5" x2="2.5" y2="9.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>`
                : '';
            return `<div class="tpl-color-set-row" data-tpl-set-index="${i}">
                <div class="tpl-set-num">${i + 1}</div>
                <div class="tpl-set-pair">
                    <div class="tpl-set-cell">
                        <span class="tpl-set-cell-label">Title</span>
                        <div class="tpl-color-row">
                            <input class="tpl-color-swatch" type="color" data-tpl-set="${i}" data-tpl-set-key="title" data-tpl-set-pair-color value="${titleSafe}" />
                            <input class="tpl-input tpl-color-hex" type="text" data-tpl-set="${i}" data-tpl-set-key="title" data-tpl-set-pair-color value="${_tplEsc(s.title)}" placeholder="#title" maxlength="7" />
                        </div>
                    </div>
                    <div class="tpl-set-cell${hlOff?' tpl-color-off':''}">
                        <span class="tpl-set-cell-label">Highlight</span>
                        <div class="tpl-color-row">
                            <input class="tpl-color-swatch" type="color" data-tpl-set="${i}" data-tpl-set-key="highlight" data-tpl-set-pair-color value="${hlSafe}" />
                            <input class="tpl-input tpl-color-hex" type="text" data-tpl-set="${i}" data-tpl-set-key="highlight" data-tpl-set-pair-color value="${_tplEsc(s.highlight)}" placeholder="#highlight" maxlength="7" />
                        </div>
                    </div>
                </div>
                ${removeBtn}
            </div>`;
        }).join('');
        const canAddMore = sets.length < TPL_MAX_COLOR_SETS;
        const addBtn = canAddMore
            ? `<button class="tpl-set-add" onclick="_tplAddColorSet(${_jsAttrArg(name)})"><svg width="11" height="11" viewBox="0 0 12 12" fill="none"><line x1="6" y1="2.5" x2="6" y2="9.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="2.5" y1="6" x2="9.5" y2="6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> Add color set</button>`
            : `<div class="tpl-set-add-max">Max ${TPL_MAX_COLOR_SETS} sets</div>`;
        return `<div class="tpl-color-sets-edit" data-tpl-color-sets data-tpl-client="${_tplEsc(name)}">
            ${items}
            ${addBtn}
        </div>`;
    }

    // ---- window exports (generated by `node scripts/check-modules.js --write-window-exports`; do not edit) ----
    Object.assign(window, {
        _tplAddColorSet, _tplRemoveColorSet, copyShareLink, generateContentSummary, goHome, onSearchFocus,
        onSearchIconClick, onSearchInput, onSearchKey, searchGoTo, selectClient, sendWeeklySlackUpdate,
        setGainPeriod, setSort, setViewMode, showClientInfoModal, showMRInfo, switchFollowersMode,
        switchFollowersPlat, switchPeriod, switchViewsPlat, toggleCaption
    });

;(self.__svParts || (self.__svParts = [])).push("js/sv-01-core-03e909281eca.js");
