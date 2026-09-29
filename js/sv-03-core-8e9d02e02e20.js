    const LOG_SUBMISSION_WEBHOOK = 'https://synchrosocial.app.n8n.cloud/webhook/log-linear-submission';
    /*
     * The gateway's own cap on ONE credential-less submission, mirrored here so
     * the form can say so before sending rather than after being refused.
     * `MAX_PUBLIC_INTAKE_ITEMS` in supabase/functions/production-write/index.ts
     * is the authority; test/linear-intake-submission-cap.js fails if the two
     * numbers drift apart.
     *
     * Why this exists: on 2026-08-26 a videographer submitting through the
     * client link was refused eleven times between 19:53 and 20:39 with
     * "Submission was not completed", which names no cause, so he simply
     * pressed the button again. The request was 7.7KB -- nothing was too big
     * except the COUNT: video+thumbnail mode sends two deliverables per video,
     * so his shoot crossed 25 items and the gateway refused it whole, before
     * writing anything.
     */
    const LINEAR_INTAKE_MAX_ITEMS = 50;
    function _linearIntakeItemsPerVideo(mode) { return mode === 'both' ? 2 : 1; }
    function _linearIntakeTooLargeMessage(mode, itemCount) {
        const perVideo = _linearIntakeItemsPerVideo(mode);
        const maxVideos = Math.floor(LINEAR_INTAKE_MAX_ITEMS / perVideo);
        return 'This submission is ' + itemCount + ' deliverables and one submission can carry '
            + LINEAR_INTAKE_MAX_ITEMS + '. Send it in parts of up to ' + maxVideos
            + (maxVideos === 1 ? ' video' : ' videos')
            + (perVideo === 2 ? ' — video + thumbnail counts as two per video.' : '.')
            + ' Nothing was sent, so nothing is duplicated by splitting it.';
    }
    const LAST_LINK_KEY = 'syncview_last_link';
    const LINEAR_FORM_KEY = 'syncview_linear_form';
    const NATIVE_INTAKE_PENDING_KEY = 'syncview_native_intake_pending_v1';
    const LINEAR_RECEIPTS_KEY = 'syncview_linear_intake_receipts_v1';
    const LINEAR_INTAKE_HOLD_KEY = 'syncview_linear_intake_hold_v1';
    const LINEAR_INTAKE_LOAD_ID = Date.now().toString(36) + ':' + Math.random().toString(36).slice(2);
    const NAV_KEY = 'syncview_nav';
    const FP_SAVED_KEY = 'syncview_filmingPlansCache_v1';   // Filming plans' saved copy (060)
    const SMM_WEEKLY_ROUTES = ['smm-weekly-report', 'smm-weekly-reports'];
    function _isSmmWeeklyRoute(page) { return SMM_WEEKLY_ROUTES.includes(page); }
    let currentNav = 'home';
    /* Phase D: the last tab you clicked always wins. Every staff route change
       (navTo, render) bumps this; init() remembers the value it started with
       and gives up routing the moment it moves, so a landing tab that finishes
       loading after you left can never pull you back, rewrite the address bar
       or move focus. `var`, not `let`: navTo can run before this line has
       been evaluated on some boot paths, and a TDZ throw there would be worse
       than the bug. */
    var _syncviewNavEpoch = 0;
    // Setters for the Workload popovers and navigation module (090). ES module
    // imports are read-only, so navTo changes these through the functions
    // below instead of assigning them directly (phase C step C3). Function
    // declarations are hoisted, so they behave exactly like the direct writes
    // on the early boot paths described above.
    function _syncviewSetCurrentNav(value) { currentNav = value; }
    function _syncviewNextNavEpoch() { return ++_syncviewNavEpoch; }
    const LINEAR_DEFAULT_VIDEO_COUNT = 12;
    let linearVideoCount = LINEAR_DEFAULT_VIDEO_COUNT;
    let linearJustCreated = false;
    let linearSubmitInFlight = null;
    // Setters for the Submit screen module (200). ES module imports are
    // read-only, so 200 changes these through the functions below instead of
    // assigning them directly (phase C step C3).
    function _linearSetVideoCount(value) { linearVideoCount = value; }
    function _linearNextVideoCount() { return ++linearVideoCount; }
    function _linearSetJustCreated(value) { linearJustCreated = value; }
    function _linearSetSubmitInFlight(value) { linearSubmitInFlight = value; }
    let linearProjectsLoading = false;
    let linearProjectsLoaded = false;
    let linearProjectsLoadGeneration = 0;
    let linearLegacyProjects = [];



    function getLastLink() { return localStorage.getItem(LAST_LINK_KEY) || ''; }
    function saveLastLink(v) { if (v && v.trim()) localStorage.setItem(LAST_LINK_KEY, v.trim()); }

    function _linearPendingNativeClientSlug() {
        try {
            const pending = typeof _linearIntakeRead === 'function' ? _linearIntakeRead() : null;
            return String(pending && pending.payload && pending.payload.client_slug || '').trim();
        } catch (e) { return ''; }
    }

    /* WHEN THE ROSTER CANNOT BE TRUSTED, THE DROPDOWN FOLLOWS THE ROUTER.
       Submit routes with _writeUiRerouteUseGatewayFailClosed: if the reroute
       flag read failed, or landed with nothing usable, every client goes to the
       native gateway. The dropdown used the factual allowlist instead, which is
       empty in exactly that state, and the legacy Linear projects source that
       used to fill it is gone -- so a slow or failed flag read left Submit with
       no clients at all, while the submit path would have sent any of them
       natively. In that state the dropdown now lists every active native
       client, the same set the router would accept. With a usable roster it is
       unchanged: enrolled clients only. */
    function _linearRosterFailsNative() {
        try { return !!(_writeUiRerouteFlagFailed || _writeUiRerouteRosterUnusable); } catch (e) { return false; }
    }

    function _linearRebuildProjectSource() {
        const failNative = _linearRosterFailsNative();
        const enrolledBySlug = new Map(linearClientRows
            .filter(row => failNative || _writeUiRerouteUseGateway(row.slug))
            .map(row => [calClientSlug(row.slug), row]));
        const includedNativeSlugs = new Set();
        const mixedProjects = linearLegacyProjects.map(name => {
            const slug = calClientSlug(name);
            const row = enrolledBySlug.get(slug);
            if (!row) return name;
            includedNativeSlugs.add(slug);
            return String(row.display_name).trim();
        });
        enrolledBySlug.forEach((row, slug) => {
            if (!includedNativeSlugs.has(slug)) mixedProjects.push(String(row.display_name).trim());
        });
        _setLinearProjects([...new Set(mixedProjects.filter(Boolean))]);
    }

    function _linearRenderProjectSource() {
        const q = document.getElementById('linearClientSearch')?.value || '';
        renderLinearSearchResults(q);
    }

    function _linearReconcileProjectSelection(previousClients, nextClients) {
        const input = document.getElementById('linearClientSearch');
        if (!input) return;
        const selectedSlug = calClientSlug(String(input.dataset.clientSlug || input.value || ''));
        if (!selectedSlug || !previousClients.has(selectedSlug) || nextClients.has(selectedSlug)) return;
        if (selectedSlug === calClientSlug(_linearPendingNativeClientSlug())) return;
        const legacyMatches = linearLegacyProjects.filter(name => calClientSlug(name) === selectedSlug);
        input.value = legacyMatches.length === 1 ? legacyMatches[0] : '';
        input.dataset.clientSlug = '';
        if (typeof updateLinearSearchGhost === 'function') updateLinearSearchGhost(input.value);
        if (typeof updateLinearTitle === 'function') updateLinearTitle();
        if (typeof updateLinearFilmingPlan === 'function') updateLinearFilmingPlan();
        if (typeof saveLinearForm === 'function') saveLinearForm();
    }

    function _linearRefreshProjectsForRerouteChange(previousClients, nextClients) {
        if (!linearProjectsLoaded && !linearProjectsLoading && !linearLegacyProjects.length && !linearClientRows.length) {
            return Promise.resolve();
        }
        // Rebuild synchronously from the last exact legacy response so a click
        // after de-enrollment cannot submit the former native display name.
        _linearRebuildProjectSource();
        _linearReconcileProjectSelection(previousClients, nextClients);
        _linearRenderProjectSource();
        // Refresh both sources in the background. The generation guard inside
        // fetchLinearProjects prevents an older cohort request from winning.
        return fetchLinearProjects();
    }

    async function fetchLinearProjects() {
        const generation = ++linearProjectsLoadGeneration;
        linearProjectsLoading = true;
        let legacyProjects = linearLegacyProjects.slice();
        let nativeRows = linearClientRows.slice();
        // The legacy source (the n8n Linear projects webhook) read Linear with a key
        // that is now revoked: every open of Submit failed with 401 and raised an
        // "n8n workflow failed" Slack alert, and returned no names. Every active
        // client is in the native cohort, so the dropdown comes from the clients
        // registry below; the legacy list stays whatever it already held.
        let nativeError = null;
        try {
            if (typeof _writeUiPrimeRerouteFlag === 'function') await _writeUiPrimeRerouteFlag();
            const pendingNativeClientSlug = _linearPendingNativeClientSlug();
            // The visible native source is cohort-only. A de-enrolled client may
            // still need its registry row to resume an already-checkpointed native
            // intake, but that recovery exception never changes dropdown names.
            if (_writeUiRerouteClients.size || pendingNativeClientSlug || _linearRosterFailsNative()) {
                const url = CAL_SUPABASE_URL + '/rest/v1/clients?select=slug,display_name,kind,active&active=eq.true&order=display_name.asc';
                const resp = await fetch(url, { headers: {
                    apikey: CAL_SUPABASE_ANON_KEY,
                    Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY,
                    Accept: 'application/json'
                }});
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const rows = await resp.json();
                nativeRows = (Array.isArray(rows) ? rows : []).filter(row => row && row.active !== false && row.slug && row.display_name);
            }
        } catch (e) {
            nativeError = e;
        } finally {
            if (generation === linearProjectsLoadGeneration) {
                linearLegacyProjects = legacyProjects;
                _setLinearClientRows(nativeRows);
                _linearRebuildProjectSource();
                linearProjectsLoaded = true;
                linearProjectsLoading = false;
                _linearRenderProjectSource();
                if (nativeError) {
                    // A registry failure must never replace or blank the legacy
                    // project names used by every non-enrolled client.
                    console.error('[SyncView] Failed to fetch enrolled native clients:', nativeError);
                }
            }
        }
    }
    /* ── Workload Calendar ── */
    const LINEAR_ISSUES_WEBHOOK        = 'https://synchrosocial.app.n8n.cloud/webhook/linear-issues';
    /* The warm-start copy of the board. v1 stored every row (6,700+, ~4.9M
       characters); stock Chrome allows ~5.2M characters per site in total, so
       with any other SyncView cache present the write threw QuotaExceededError,
       the empty catch swallowed it, and the page kept painting whatever v1 had
       last managed to store -- a board days old (Loom, 2026-09-23). v2 stores
       only what the board draws (active sub-issues and their parents, ~0.25M
       characters, bucket-for-bucket identical), and the v1 key is deleted. */
    const LINEAR_ISSUES_CACHE_KEY = 'syncview_workloadBoardCache_v2';
    const WL_LEGACY_CACHE_KEY     = 'syncview_linearIssuesCache_v1';
    // Never paint a cached board older than this; show the loading state instead.
    const WL_CACHED_BOARD_MAX_AGE_MS = 6 * 60 * 60 * 1000;
    const LINEAR_ISSUES_TTL_MS    = 5 * 60 * 1000;
    const WL_VIEW_PREF_KEY        = 'syncview_workloadView_v1';
    const WL_DEADLINE_PREF_KEY    = 'syncview_workloadDeadlineOverlay_v1';


    function wlReadDeadlinePref() {
        try { return localStorage.getItem(WL_DEADLINE_PREF_KEY) === '1'; }
        catch { return false; }
    }

    const wlState = {
        viewMode: 'week',                          // 'week' | 'month'
        showDeadlines: wlReadDeadlinePref(),       // persistent display-only Week relationship view
        year: null, month: null,                   // visible month (month view)
        weekStart: null,                           // Monday of the visible work week
        team: 'all', editor: 'all', client: 'all', // filters
        planned: [],                               // assigned non-tweak sub-issues with a manual or automatic work day
        nowWorking: [],                            // assigned sub-issues currently "In Progress"
        tweaksNeeded: [],                          // assigned sub-issues currently "Tweaks Needed"
        overdue: [],                               // assigned sub-issues in To Do whose dueDate is before today (any other live status overrides overdue)
        undated: [],                               // assigned active sub-issues with neither manual day nor deadline
        unassigned: [],                            // sub-issues with no assignee (and In Progress OR has dueDate)
        parentById: new Map(),                     // parent issue lookup for rollup link-outs
        calendarByDate: new Map(),                 // effective work day -> planned sub-issues[]
        allActiveSubs: [],                         // all non-completed sub-issues for filter options
        issueSnapshot: [],                         // last feeder snapshot; due writes follow the current per-team authority map
        planByIssueId: new Map(),                  // stable Linear issue id -> explicit internal plan_date
        autoPlacementByIssueId: new Map(),         // stable Linear issue id -> capacity-adjusted automatic work day; holds ONLY the items whose ideal day was full (see wlComputeAutoPlacements)
        workloadByIssueId: new Map(),              // stable Linear issue id -> exact 2× / 3× Workload label metadata
        dueAuthorityByIssueId: new Map(),           // stable Linear issue id -> current prod_authority fingerprint + team lane
        nativeDueTargetByIssueId: new Map(),        // stable Linear issue id -> native deliverable id + independent updated_at CAS cursor
        linearMetadataStatus: 'loading',            // 'loading' | 'refreshing' | 'ready' | 'stale' | 'unknown'
        // How many rows are withheld when NOTHING ELSE is degraded. 0 means the
        // degradation (if any) is broad; a positive number means exactly that
        // many rows are unprovable and every other row is untouched.
        linearMetadataWithheldOnly: 0,
        linearMetadataError: null,
        planHasSnapshot: false,                    // true only after one authoritative workload-plan list response
        planLoading: false,                        // true during the fast first paint, before plans have resolved/failed — items use the automatic estimate so they don't move when plans land
        planStatus: 'loading',                     // 'loading' | 'refreshing' | 'ready' | 'stale' | 'unknown'
        planError: null,
        planFetchedAt: null,
        // How the sidecar matched saved days to cards on the last authoritative
        // read. 'snapshot' and 'pairs' are both complete answers; 'none' means
        // it could not build the id pairing at all. planUnaliased counts the
        // saved days it could NOT match — the board is then right about
        // everything else and missing those, which is exactly the state that
        // used to be invisible (item 210).
        planAliasMode: '',                         // '' | 'snapshot' | 'pairs' | 'none'
        planUnaliased: 0,
        subsByParentId: new Map(),
        popoverAnchor: null,                       // currently-open popover's anchor rollup element
        renderQueued: false,                       // background repaint deferred while a popover is open
        fetchedAt: null,
        // Test clients (clients.kind = 'test'), as normalised slug/name keys.
        // Their cards stay off the board unless this browser opted in with
        // ?wltest=1 (wlTestClientsMode).
        testClientKeys: new Set(),
        testClientKeysLoaded: false,
        // The last validated v2 snapshot this page holds, keyed by staff
        // identity, so a refresh sends its version and reuses it on "unchanged".
        snapshotMemo: null,
        snapshotV2Unavailable: false,                // 400/501 from v2: use the v1 action for this page
        cachedBoardAt: null,                        // set while the board shows the localStorage copy, not a live snapshot
        sourceSyncedAt: null,                      // newest workload_issues.synced_at represented by this snapshot
        loading: false,
        refreshing: false,
        backgroundError: null,                    // non-destructive warning; never replaces a warm calendar
        // How many saved work days the gateway refused to attach to their card
        // (OPEN_REPAIRS 177). Its OWN state rather than a sentence stuffed into
        // backgroundError, because backgroundError is the transient
        // refresh-failure channel: the renderer rewrites anything it does not
        // recognise, and a successful manual refresh clears it. A dropped plan
        // is neither transient nor a refresh problem -- it is a work day a
        // person dragged and can no longer see, and it stays true until the
        // stored client is repaired.
        nativePlansDropped: 0,
        editorRoster: [],                       // active exact-role creative members from the authenticated snapshot
        editorRosterStatus: 'unknown',              // ready | unavailable during SQL/Edge/browser mixed release
        error: null
    };


    /* Workload v2 read switch (the rest of v2 is in 067). Here, in core,
       because the router (092 _svNavQuery) reads the sticky ?wl2 choice before
       leaving the address, whether or not Workload has loaded. */
    const WL_V2_LS_KEY         = 'syncview_workload_v2';
    const WL_V2_KILL_KEY       = 'syncview_workload_v2_off';
    let _wlV2FlagCache = null;
    function _wlV2Enabled() {
        if (_wlV2FlagCache !== null) return _wlV2FlagCache;
        // Phase 3 (2026-06-17): v2 is now the DEFAULT — the Supabase read path is
        // ON for everyone (webhook fast-path is live, ~2s reassignments). ?wl2=0 is
        // a sticky per-browser kill-switch; ?wl2=1 force-enables / clears an opt-out.
        // Rollback for everyone = set this default back to false; the Supabase read
        // always falls back to the live linear-issues endpoint, so a flip is lossless.
        let on = true;
        try {
            const q = new URLSearchParams(svRoute.search()).get('wl2');
            if (q === '1' || q === 'true') { on = true; localStorage.setItem(WL_V2_LS_KEY, '1'); localStorage.removeItem(WL_V2_KILL_KEY); }
            else if (q === '0' || q === 'false') { on = false; localStorage.setItem(WL_V2_KILL_KEY, '1'); localStorage.removeItem(WL_V2_LS_KEY); }
            else { on = (localStorage.getItem(WL_V2_KILL_KEY) !== '1'); }
        } catch { on = true; }
        _wlV2FlagCache = on;
        return on;
    }

;(self.__svParts || (self.__svParts = [])).push("js/sv-03-core-8e9d02e02e20.js");
