        /* ============================================================
           PRODUCTION PREVIEW (Track B B2) / AUTHORITY-GATED WRITE UI
           Hidden behind ?prod=1 / verified staff navigation. Reads the native
           mirror and enables only gateway-backed operations for a SyncView-
           authoritative team (or the bounded TEST override). It never changes
           flags or writes Linear directly.
           ============================================================ */
        const PROD_STATUS_TO_ARTIFACT = {
            triage: 'triage',
            backlog: 'backlog',
            todo: 'todo',
            in_progress: 'prog',
            smm_approval: 'smm',
            kasper_approval: 'kasper',
            client_approval: 'client',
            tweak: 'tweak',
            approved: 'approved',
            scheduled: 'scheduled',
            posted: 'posted',
            canceled: 'canceled',
            duplicate: 'duplicate',
            prog: 'prog',
            smm: 'smm',
            kasper: 'kasper',
            client: 'client'
        };
        const PROD_STATUS_FROM_ARTIFACT = {
            triage: 'triage',
            backlog: 'backlog',
            todo: 'todo',
            prog: 'in_progress',
            smm: 'smm_approval',
            kasper: 'kasper_approval',
            client: 'client_approval',
            tweak: 'tweak',
            approved: 'approved',
            scheduled: 'scheduled',
            posted: 'posted',
            canceled: 'canceled',
            duplicate: 'duplicate'
        };
        const PROD_STATUS = {
            triage: 'Triage',
            backlog: 'Backlog',
            todo: 'Todo',
            prog: 'In Progress',
            smm: 'For SMM approval',
            kasper: 'For Kasper approval',
            client: 'For Client Approval',
            tweak: 'Tweak Needed',
            approved: 'Approved',
            scheduled: 'Scheduled',
            posted: 'Posted',
            canceled: 'Canceled',
            duplicate: 'Duplicate'
        };
        const PROD_STATUS_ORDER = ['backlog','todo','prog','smm','kasper','tweak','client','approved','scheduled','posted','canceled','duplicate','triage'];
        /*
         * The status a newly CREATED deliverable starts in. It was 'in_progress'
         * at four separate call sites -- the create dialog, its restored-draft
         * fallback, and both intake items (video and thumbnail) -- so every card
         * anyone made was born already started. An editor reported it on
         * 2026-08-17: "Subissues are automatically appearing as in progress even
         * though I haven't marked them... I don't know why the rest appear that
         * way since I haven't changed their status." He was right; nobody had.
         *
         * Work that has just been created has not been started, so it starts in
         * To Do and the assignee moves it themselves. One constant now, because
         * four copies of a default is how they drifted from the intent.
         *
         * NOTE: production-write still falls back to 'in_progress' when a caller
         * omits status entirely. Every UI path sends it explicitly, so that
         * fallback is unreachable from the app -- it is corrected in the gateway
         * on the next deploy rather than mid-flight during this one.
         */
        const PROD_CREATED_STATUS = 'todo';
        // F136 — browser mirror of the server-owned role × current × next × team
        // × assignee state machine in
        // supabase/functions/production-write/policy.mjs. The picker offers
        // exactly what the gateway accepts; test/production-transition-policy.js
        // fails if the two tables drift. Keys and values are the DB status
        // strings, not the artifact keys.
        // OWNER RULING 2026-08-17: a creative may move work from any status to
        // any status. Mirrors CREATIVE_STATUS_TRANSITIONS in the gateway's
        // policy module — the picker must not offer a move the gateway would
        // refuse, nor hide one it would accept. The remaining creative limits
        // (own team, own assigned work, and the Graphics artifact gate on SMM
        // approval) are enforced elsewhere and are unaffected by this list.
        const PROD_CREATIVE_STATUS_TRANSITIONS = {
            triage: ['triage', 'backlog', 'todo', 'in_progress', 'smm_approval', 'kasper_approval', 'client_approval', 'tweak', 'approved', 'scheduled', 'posted', 'canceled', 'duplicate'],
            backlog: ['triage', 'backlog', 'todo', 'in_progress', 'smm_approval', 'kasper_approval', 'client_approval', 'tweak', 'approved', 'scheduled', 'posted', 'canceled', 'duplicate'],
            todo: ['triage', 'backlog', 'todo', 'in_progress', 'smm_approval', 'kasper_approval', 'client_approval', 'tweak', 'approved', 'scheduled', 'posted', 'canceled', 'duplicate'],
            in_progress: ['triage', 'backlog', 'todo', 'in_progress', 'smm_approval', 'kasper_approval', 'client_approval', 'tweak', 'approved', 'scheduled', 'posted', 'canceled', 'duplicate'],
            smm_approval: ['triage', 'backlog', 'todo', 'in_progress', 'smm_approval', 'kasper_approval', 'client_approval', 'tweak', 'approved', 'scheduled', 'posted', 'canceled', 'duplicate'],
            kasper_approval: ['triage', 'backlog', 'todo', 'in_progress', 'smm_approval', 'kasper_approval', 'client_approval', 'tweak', 'approved', 'scheduled', 'posted', 'canceled', 'duplicate'],
            client_approval: ['triage', 'backlog', 'todo', 'in_progress', 'smm_approval', 'kasper_approval', 'client_approval', 'tweak', 'approved', 'scheduled', 'posted', 'canceled', 'duplicate'],
            tweak: ['triage', 'backlog', 'todo', 'in_progress', 'smm_approval', 'kasper_approval', 'client_approval', 'tweak', 'approved', 'scheduled', 'posted', 'canceled', 'duplicate'],
            approved: ['triage', 'backlog', 'todo', 'in_progress', 'smm_approval', 'kasper_approval', 'client_approval', 'tweak', 'approved', 'scheduled', 'posted', 'canceled', 'duplicate'],
            scheduled: ['triage', 'backlog', 'todo', 'in_progress', 'smm_approval', 'kasper_approval', 'client_approval', 'tweak', 'approved', 'scheduled', 'posted', 'canceled', 'duplicate'],
            posted: ['triage', 'backlog', 'todo', 'in_progress', 'smm_approval', 'kasper_approval', 'client_approval', 'tweak', 'approved', 'scheduled', 'posted', 'canceled', 'duplicate'],
            canceled: ['triage', 'backlog', 'todo', 'in_progress', 'smm_approval', 'kasper_approval', 'client_approval', 'tweak', 'approved', 'scheduled', 'posted', 'canceled', 'duplicate'],
            duplicate: ['triage', 'backlog', 'todo', 'in_progress', 'smm_approval', 'kasper_approval', 'client_approval', 'tweak', 'approved', 'scheduled', 'posted', 'canceled', 'duplicate']
        };
        // Operations a creative may perform only on work assigned to them.
        // `comment` is deliberately absent — see the policy module comment.
        // Mirror of the gateway's CREATIVE_ASSIGNEE_BOUND_OPERATIONS.
        // `attachment` removed 2026-08-18 by owner ruling: a graphics creative
        // may attach or replace the canonical file on any graphics deliverable,
        // so a mis-attach is fixable from the designer's own seat.
        const PROD_CREATIVE_ASSIGNEE_BOUND_OPERATIONS = ['status'];
        // no-hardcoded-colors: allow-start (artifact-locked, dual-theme)
        const PROD_STATUS_META = {
            triage: { type: 'triage', color: '#f2994a' },
            backlog: { type: 'backlog', color: '#a4a8ae' },
            todo: { type: 'unstarted', color: '#a8a8a8' },
            prog: { type: 'started', color: '#c6a333', pie: 'M 3.5,3.5 L3.5,0 A3.5,3.5 0 0,1 6.531088913245535, 1.749999999999999 z' },
            smm: { type: 'started', color: '#ed86bc', pie: 'M 3.5,3.5 L3.5,0 A3.5,3.5 0 0,1 6.531088913245535, 5.249999999999998 z' },
            kasper: { type: 'started', color: '#eb5757', pie: 'M 3.5,3.5 L3.5,0 A3.5,3.5 0 0,1 3.5, 7 z' },
            tweak: { type: 'started', color: '#db6e1f', pie: 'M 3.5,3.5 L3.5,0 A3.5,3.5 0 1,1 0.4689110867544648, 5.249999999999998 z' },
            client: { type: 'started', color: '#ff0016', pie: 'M 3.5,3.5 L3.5,0 A3.5,3.5 0 1,1 0.4689110867544648, 1.749999999999999 z' },
            approved: { type: 'completed', color: '#43bc58' },
            scheduled: { type: 'completed', color: '#0044ff' },
            posted: { type: 'completed', color: '#5e6ad2' },
            canceled: { type: 'canceled', color: '#95a2b3' },
            duplicate: { type: 'duplicate', color: '#95a2b3' }
        };
        const PROD_BOARD_STATUS = {
            backlog: 'Backlog',
            planned: 'Planned',
            prog: 'In Progress',
            paused: 'Paused',
            completed: 'Completed',
            canceled: 'Canceled'
        };
        const PROD_BOARD_ORDER = ['backlog','planned','prog','paused','completed','canceled'];
        const PROD_BOARD_STATUS_TO_ARTIFACT = { in_progress: 'prog', prog: 'prog', backlog: 'backlog', planned: 'planned', paused: 'paused', completed: 'completed', canceled: 'canceled' };
        const PROD_EDITOR_COLORS = ['#e2a03f', '#4cb782', '#e56cd6', '#5e6ad2', '#6c6f7d'];
        const PROD_DISPLAY_PREFS_KEY = 'syncview_prod_display_v1';
        const PROD_CREATE_DRAFT_KEY = 'syncview_prod_create_draft_v1';
        /*
         * Owner ruling 2026-08-23 -- the Production tab creates nothing.
         *
         * "A sub-issue is a card, not a parent issue ... we shouldn't be able
         * to do parent issues or sub-issues because we don't want to do posts
         * in sync linear that are not in the calendar."
         *
         * Both modes made the same row: production-write/index.ts hardcodes
         * card_id: null in the create insert, for a top-level issue AND for a
         * sub-issue under a parent that HAS a card. Nothing born here is on
         * anyone's calendar, in Kasper's queue, or on a client review link.
         * Posts start on the Calendar or Samples card, which creates the
         * deliverable and its Linear issue together, linked.
         *
         * This is the single refusal. _prodCreateGateText returns it before
         * every other reason, so all three gate readers (topbar button,
         * _prodOpenCreate, _prodSubmitCreate) close together and none of them
         * can drift open on its own. The recovery gate
         * (_prodCreateRecoveryGateText) is deliberately NOT closed: an
         * `ambiguous` draft means a create may already have committed, and the
         * retry is the only path that shows its author the row that landed.
         *
         * The Add-sub-issue affordance itself (_prodAddSubIssueButtonHTML)
         * was removed outright, not just gated, per the separate standing
         * rule in CLAUDE.md: "Sub-issue creation must not be possible from
         * SyncLinear -- only from the content calendar." A gated-but-present
         * button is still an entry point; this one no longer renders at all.
         * `_prodOpenCreate(parentId)` keeps its subissue-mode branch because
         * an ambiguous saved subissue draft still needs to recover through
         * the topbar's "Recover issue" control, which calls _prodOpenCreate()
         * with no parentId and reads the pending draft from storage.
         */
        const PROD_CREATE_CLOSED_TEXT = 'Posts are created on the content calendar, not in Production. Use Create Post on the client\u2019s Calendar or Samples tab.';
        const PROD_COMMENTS_EF_URL = CAL_SUPABASE_URL + '/functions/v1/production-comments';
        const PROD_WRITE_EF_URL = CAL_SUPABASE_URL + '/functions/v1/production-write';
        const PROD_ARCHIVE_EF_URL = CAL_SUPABASE_URL + '/functions/v1/production-archive';
        const PROD_DESCRIPTION_IMAGE_EF_URL = CAL_SUPABASE_URL + '/functions/v1/description-image-upload';
        const PROD_AUTHORITY_FLAG_KEY = 'prod_authority';
        const PROD_COMMENTS_PAGE_SIZE = 50;
        /* Long enough that a genuinely slow read still lands (the estate's
           slowest observed comment reads sit well under this), short enough
           that a stalled one becomes a Retry the reader can act on instead of
           a skeleton that never resolves. */
        const PROD_COMMENTS_READ_TIMEOUT_MS = 15000;
        /* `write` names the gateway operation that owns each slot, and its
           absence is a rule rather than an oversight.

           filming_plan has none. It is derived from the filming_plans source,
           the owner ruled it untouchable from the product (2026-08-30: "the
           only one that is not editable because it is from the supabase
           database and no one should be able to touch that"), and the same
           whitelist is repeated in policy.mjs and inside
           production_batch_asset_write -- so a slot with no `write` here cannot
           be written by adding a button. The other three name the operation
           that actually carries them: the two folder links live on the BATCH
           and go through batch_asset; the canonical file lives on the
           deliverable and goes through attachment. */
        const PROD_ASSET_SPECS = Object.freeze([
            { key: 'filming_plan', label: 'Filming plan' },
            { key: 'raw_footage', label: 'Raw footage', write: 'batch_asset' },
            { key: 'delivery_folder', label: 'Frame folder', write: 'batch_asset' },
            // Graphics deliverables carry a thumbnail image, so the same slot
            // reads "Thumbnail file" there; Video keeps the generic label
            // because its file_url is the finished video, not a thumbnail.
            { key: 'deliverable_file', label: 'Deliverable file', graphicsLabel: 'Thumbnail file', write: 'attachment' }
        ]);
        function _prodAssetSpec(slot) {
            return PROD_ASSET_SPECS.find(spec => spec.key === String(slot || '')) || null;
        }
        function _prodAssetWriteOperation(slot) {
            const spec = _prodAssetSpec(slot);
            return spec && spec.write ? spec.write : '';
        }
        const PROD_GROUP_KEYS = new Set(['status', 'client', 'assignee']);
        const PROD_ORDER_KEYS = new Set(['due', 'updated', 'created']);
        const PROD_ATTRIBUTION_NEEDS = '__needs_attribution__';
        const PROD_ATTRIBUTION_CONFLICT = '__attribution_conflict__';
        const _prodState = {
            loaded: false,
            loading: false,
            /* True for the whole of any _prodLoadData, silent or not.
               `loading` is deliberately false during a silent refresh so the
               tab does not flash a spinner, which left every "is a load already
               running?" check blind to exactly the refresh that follows a
               cached paint -- see _prodAutoRefreshOnReturn. */
            refreshing: false,
            // True between a cached first paint and the live read that follows.
            // The snapshot is a deliberate projection (see PROD_CACHE_SCHEMA),
            // so completed work is absent from it and no surface may report
            // "nothing here" while this is set. Cleared by _prodLoadData.
            cachePartial: false,
            error: '',
            view: 'list',
            team: 'all',
            clientSlug: '',
            openId: '',
            openBatchId: '',
            openProjectId: '',
            // What the URL asked to open, held across the cache-to-live handoff.
            // See _prodApplyDeepLinkFallback.
            deepLink: null,
            deepLinkMissingKind: '',
            deepLinkMissing: '',
            projectDetailsOpen: true,
            tab: 'active',
            groupBy: 'status',
            orderBy: 'due',
            showSubIssues: true,
            filters: [],
            collapsed: new Set(),
            colCollapsed: new Set(),
            selected: new Set(),
            focusRow: '',
            hoverRow: '',
            selAnchor: '',
            focusCard: '',
            cardSel: new Set(),
            cardAnchor: '',
            listScrollTop: 0,
            detailScrollTop: 0,
            detailScrollKey: '',
            paletteOpen: false,
            secOpen: { fav: true, ws: true, teams: true },
            teamOpen: { video: true, graphics: true },
            clients: [],
            members: [],
            batches: [],
            deliverables: [],
            adapter: null,
            events: new Map(),
            linearRaw: new Map(),
            labels: new Map(),
            labelRequestTokens: new Map(),
            // F94: the server-authoritative eligible-assignee projection, keyed
            // by deliverable id. The picker never builds candidates locally.
            assigneeOptions: new Map(),
            assigneeOptionRequestTokens: new Map(),
            // F95: foreground operational freshness.
            refreshInFlight: false,
            refreshFailures: 0,
            lastSyncAt: 0,
            lastFullSyncAt: 0,
            lastSyncError: '',
            // The HTTP status of the last silent load that failed, handed to
            // _prodDeltaRefresh and cleared on read. 0 means "no status", which
            // is also what a network failure legitimately has.
            lastSilentLoadStatus: 0,
            assets: new Map(),
            assetRequestTokens: new Map(),
            /* deliverable id -> the link its file pill opens, and batch id ->
               the read that filled it. Answered in ONE request per batch by
               batch_files_read, because the browser projection deliberately
               does not carry file_url and probing every child to draw a list of
               pills would cost four outbound checks per sub-issue. */
            batchFiles: new Map(),
            batchFilesStatus: new Map(),
            /* Actions the CURRENTLY DEPLOYED gateway announced it can serve,
               learned from asset_access_read. Null until the first successful
               asset read, which is the correct "do not ask yet" state. */
            gatewayReads: null,
            descriptions: new Map(),
            descriptionRequestTokens: new Map(),
            /* Per-batch read state for the ONE-row description read, keyed by
               batch id: 'loading' | 'ready' | 'error'. It is what stops the
               batch-detail view re-asking on every render, and what lets that
               view say the read failed instead of holding a skeleton forever. */
            batchDescriptionReads: new Map(),
            /* SINGLE FLIGHT: batchId -> the promise of the read currently in the
               air. A second caller for the same batch awaits that promise rather
               than returning, so every waiter resumes with the answer instead of
               resuming instantly and concluding the read failed. */
            batchDescriptionInFlight: new Map(),
            /* Per-batch request tokens for those reads. The generation counter
               alone cannot stand in for these: it only advances in
               _prodLoadData, never on the operational delta, so a delta that
               moves a batch's stamp mid-read leaves the generation equal and an
               older answer comparing as current. Raised by Codex on #1364. */
            batchDescriptionTokens: new Map(),
            createDraft: null,
            createCatalog: [],
            createAssignees: [],
            createCatalogStatus: 'idle',
            createCatalogError: '',
            createCatalogToken: 0,
            createSubmitting: false,
            createError: '',
            archiveRepair: null,
            projectionGeneration: 0,
            authority: null,
            authorityLoaded: false,
            authorityReadAt: 0,
            // Which teams' native intake has cut over -- a Set of 'video'/
            // 'graphics', or null before the flag has ever loaded (or after a
            // failed read). See _prodNativeEpochOn: null fails OPEN to "not
            // cut over", the same direction _calLatestNativeBatches fails
            // open in, so a still-syncing card is never misjudged from a
            // transient flag-read failure.
            nativeEpochTeams: null,
            // Phase two of the boot read (see _prodLoadTerminalTail): true while
            // the approved/posted/archived tail is still arriving behind the
            // live board.
            terminalTailPending: false,
            /* The tail RAN and did not deliver. Distinct from pending, and the
               distinction is the whole of OPEN_REPAIRS 108's fifth round: a tail
               that FAILED establishes nothing, so an id it could not resolve is
               UNKNOWN, not GONE. Treating those the same is what turned a stuck
               spinner into a false eviction on 2026-09-02. Cleared by the next
               tail that actually lands. */
            terminalTailFailed: false,
            terminalTailLoadedAt: 0,
            /* When the tail was last read IN FULL, as opposed to incrementally.
               A full read is what converges a hard delete; the watermark read
               below cannot see a row that no longer exists. */
            terminalTailFullAt: 0,
            writes: new Map(),
            commentDrafts: new Map(),
            briefsLoaded: false,
            briefsLoading: false
        };
        function _prodEnabled() {
            try { return new URLSearchParams(svRoute.search()).get('prod') === '1'; }
            catch (e) { return false; }
        }
        function _prodAccessAllowed() {
            return _prodEnabled() || _syncviewStaffIdentityValid();
        }
        function _prodPreviewText() { return 'Preview - read-only'; }
        function _prodModeText() {
            const authority = _prodState.authority;
            if (authority && authority.video === 'syncview' && authority.graphics === 'syncview') return 'Native writes';
            if (authority && authority.graphics === 'syncview') return 'Graphics writable';
            if (authority && authority.video === 'syncview') return 'Video writable';
            return _prodPreviewText();
        }
        function _prodApplyDisplayPrefs(saved) {
            saved = saved || {};
            if (PROD_GROUP_KEYS.has(saved.groupBy)) _prodState.groupBy = saved.groupBy;
            if (PROD_ORDER_KEYS.has(saved.orderBy)) _prodState.orderBy = saved.orderBy;
            if (typeof saved.showSubIssues === 'boolean') _prodState.showSubIssues = saved.showSubIssues;
        }

        /* -----------------------------------------------------------------
         * Production stale-while-revalidate cache (mirrors Workload's cache)
         * -----------------------------------------------------------------
         * The Linear tab re-reads its whole projection — clients, members,
         * batches, and every browser-safe deliverable row (~thousands) — from
         * Supabase on every page load, and shows the skeleton until all of it
         * lands + is processed. `_prodState` is in-memory only, so a fresh page
         * load never benefits from the previous one. This persists the exact
         * adapter inputs to localStorage so a REVISIT paints instantly from the
         * last snapshot, then revalidates in the background and re-renders only
         * on a diff (the normal foreground read still runs on a cold cache).
         *
         * Best-effort: rows are cached VERBATIM (a JSON round-trip preserves
         * null-valued keys, which _prodDeliverableLive / identity-repair reads
         * probe with _prodHasOwn), and a QuotaExceededError just skips the write
         * — behavior degrades to exactly today's every-visit reload, never
         * worse. Default ON with a sticky kill switch (?prodcache=0), mirroring
         * the ?wl2 / ?v2 convention. The DATA is the same anon-granted browser
         * projection the calendar already caches per client.
         * ----------------------------------------------------------------- */
        const PROD_CACHE_KEY = 'syncview_production_cache_v1';
        const PROD_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
        /*
         * THE SNAPSHOT NEVER FIT, AND IT DELETED THE NEIGHBOURS TRYING.
         *
         * Measured against the live estate 2026-08-26: the full snapshot this
         * cache used to serialise -- every client, member, batch and
         * deliverable -- was 5.44M characters. localStorage stores UTF-16, so
         * that is ~10.9MB asking for an origin budget of about 5MB. The write
         * could not succeed on any browser, on any day, for anyone.
         *
         * That alone would only mean "no cache". The damage was in the retry
         * path below: on QuotaExceededError it evicts the oldest same-family
         * snapshot and tries again, one key at a time. Since no number of
         * evictions could ever make room, EVERY Production open walked that
         * loop to the end and deleted every calendar and samples snapshot in
         * the origin -- then still returned false. Opening SyncLinear made the
         * Calendar slow, and nothing said so.
         *
         * Two rules follow, and the first is the one that matters:
         *
         *   1. A write that cannot possibly fit must not evict anything. The
         *      budget is checked BEFORE the first setItem, so an oversized
         *      payload costs its neighbours nothing.
         *   2. What is cached is what the default view paints. Batch
         *      DESCRIPTIONS were 2.12MB of the 5.44MB on their own and are not
         *      on any first paint (the live read carries them in moments, and
         *      _prodPreserveProjectedFields already exists precisely because a
         *      projection may omit them). Terminal deliverables -- 3,902 of
         *      5,398 rows -- are history that the 'active' tab does not show.
         *      Dropping both puts the snapshot at ~1.45M chars / ~2.9MB UTF-16,
         *      which fits beside the calendar and samples caches instead of
         *      evicting them.
         *
         * The snapshot is therefore a PARTIAL projection by construction, and
         * _prodState.cachePartial says so until the live read lands, so no
         * surface may present it as the whole truth. Schema 2 exists to make
         * that explicit: a schema-1 entry is a full snapshot written under the
         * old contract and is discarded rather than read as a projection.
         */
        /*
         * SCHEMA 3 -- COLUMNAR, BECAUSE SCHEMA 2 STILL DID NOT FIT.
         *
         * Schema 2 shipped on 2026-08-26 with a budget sized from a SIXTEEN
         * column read. The shipped read asks for FORTY-FOUR
         * (PROD_DELIVERABLE_SELECT), so the real projection was 3,283,150
         * characters against an 1,800,000 budget: still refused, still every
         * open a cold one. Worse, test/production-cache-fits.js passed the
         * whole time, because its fixture rows were built from the same wrong
         * column list -- roughly 499 characters a row against the real 1,674.
         * A green test asserting a false thing is worse than no test.
         *
         * The fix is to stop repeating the column NAMES. A verbatim row spends
         * ~44 quoted key names on every one of ~1,500 rows; columnar writes
         * them once and stores each column's values as an array. Measured live
         * 2026-08-26 over the real select: 3,283,150 -> 1,751,877 characters,
         * 1.87x, and a round trip is byte-identical.
         *
         * KEY PRESENCE IS THE WHOLE DIFFICULTY, and it is why the block above
         * says rows are cached VERBATIM. `_prodHasOwn(row, field)` distinguishes
         * "absent" from "present and null" for identity_repair_state,
         * identity_repair_reason, identity_repair_resolved_linear_issue_id,
         * brief/desc and board_desc/desc. A naive columnar encoder unions the
         * keys it happens to see and fabricates `null` for every row missing
         * one, flipping those probes from false to TRUE -- which is how a
         * reader ends up looking at a confident "No description." over a brief
         * that exists. So the encoder records an explicit presence MASK per row
         * shape, and the decoder assigns only the keys that mask marks present.
         * Distinct shapes are deduplicated, so the live estate (one shape)
         * costs one string.
         *
         * Anything outside the closed column list is carried verbatim in `e`
         * rather than dropped, so a field some later code attaches to a row
         * survives a round trip instead of silently disappearing.
         */
        const PROD_CACHE_SCHEMA = 3;
        /*
         * Characters, not bytes; localStorage stores UTF-16, so this is 4.8MB
         * of a measured ~5.24M-character origin budget... except it is not,
         * because Production is not alone in there. Measured 2026-08-26: the
         * calendar's own snapshots reach 2,302,836 characters. 2,400,000 +
         * 2,302,836 = 4,702,836, which leaves ~540,000 characters of headroom
         * against the cap.
         *
         * The projection measures 1,751,877 today, so this is ~650,000 of room
         * to grow -- about 850 more live rows, half again what the estate holds.
         * Sized deliberately larger than today's payload because the alternative
         * is a cache that silently stops writing the week the estate grows, and
         * the failure mode of being too generous is benign: the budget is
         * checked BEFORE the first setItem, so an oversized payload is refused
         * without evicting anybody.
         */
        const PROD_CACHE_MAX_CHARS = 2400000;
        /* Read from the shipped select rather than restated, so the cache can
           never be sized from a column list the app does not actually use --
           which is exactly how schema 2 came to be measured 2.5x light.
           Deferred into a function because PROD_DELIVERABLE_SELECT is declared
           further down this script and a module-level read would hit its TDZ. */
        function _prodCacheDeliverableColumns() {
            return String(PROD_DELIVERABLE_SELECT || '').split(',').map(name => name.trim()).filter(Boolean);
        }
        function _prodCacheBatchColumns() {
            return String(PROD_BATCH_SELECT || '').split(',').map(name => name.trim())
                .filter(name => name && name !== 'description' && name !== 'desc');
        }
        const _prodCacheHasOwn = (row, key) => Object.prototype.hasOwnProperty.call(row, key);
        /* Columns once, values as arrays, and an explicit presence mask per row
           shape. Pure and total: any row shape round-trips to itself. */
        function _prodCachePackRows(rows, columns) {
            const shapes = [];
            const shapeIndex = [];
            const values = columns.map(() => []);
            const extras = [];
            const seen = new Map();
            (rows || []).forEach((row, index) => {
                const source = (row && typeof row === 'object') ? row : {};
                let mask = '';
                for (const column of columns) mask += _prodCacheHasOwn(source, column) ? '1' : '0';
                if (!seen.has(mask)) { seen.set(mask, shapes.length); shapes.push(mask); }
                shapeIndex.push(seen.get(mask));
                columns.forEach((column, position) => {
                    values[position].push(_prodCacheHasOwn(source, column) ? source[column] : null);
                });
                let extra = null;
                for (const key of Object.keys(source)) {
                    if (columns.indexOf(key) >= 0) continue;
                    (extra || (extra = {}))[key] = source[key];
                }
                if (extra) extras.push([index, extra]);
            });
            return { c: columns, s: shapes, x: shapeIndex, v: values, e: extras };
        }
        /* Returns null rather than a partial list on anything malformed: a
           half-decoded snapshot painted as truth is worse than no snapshot, and
           _prodCacheRead treats null as a miss. */
        function _prodCacheUnpackRows(packed) {
            if (!packed || typeof packed !== 'object') return null;
            if (!Array.isArray(packed.c) || !Array.isArray(packed.s)
                || !Array.isArray(packed.x) || !Array.isArray(packed.v)) return null;
            if (packed.v.length !== packed.c.length) return null;
            const extras = new Map();
            for (const entry of (Array.isArray(packed.e) ? packed.e : [])) {
                if (Array.isArray(entry) && entry[1] && typeof entry[1] === 'object') extras.set(Number(entry[0]), entry[1]);
            }
            const rows = [];
            for (let index = 0; index < packed.x.length; index++) {
                const shape = packed.s[packed.x[index]];
                if (typeof shape !== 'string' || shape.length !== packed.c.length) return null;
                const row = {};
                for (let position = 0; position < packed.c.length; position++) {
                    if (shape[position] === '1') row[packed.c[position]] = (packed.v[position] || [])[index];
                }
                const extra = extras.get(index);
                if (extra) for (const key of Object.keys(extra)) row[key] = extra[key];
                rows.push(row);
            }
            return rows;
        }
        /* The statuses the default 'active' tab does not show. Lowercased at
           the comparison, because the estate holds both cases. */
        const PROD_CACHE_TERMINAL = ['approved', 'posted', 'archived', 'canceled', 'cancelled', 'duplicate'];
        function _prodCacheIsTerminal(row) {
            return PROD_CACHE_TERMINAL.includes(String((row && row.status) || '').trim().toLowerCase());
        }
        /* The two halves of the boot read, split on the SAME list the cache
           already excludes -- so phase one is a row set this tab has been
           rendering from since the cache shipped, not a new shape.
           Measured 2026-08-31: 2,206 rows live vs 6,181 total, and the full
           read is ~10 MB over seven strictly sequential pages. Loading the
           finished work first meant nobody could touch the board until the
           archive had finished arriving.
           NULL-SAFE BY CONSTRUCTION, and the direction matters: `in` and
           `not.in` both drop a NULL status, so a row with no status would fall
           through BOTH halves and simply never appear. Phase one therefore
           claims the nulls. An unknown status shows up where someone can see
           it; it never silently disappears. (Measured today: zero null rows --
           this guards the shape, not a live defect.) */
        const PROD_LIVE_FILTER = 'or=(status.not.in.(' + PROD_CACHE_TERMINAL.join(',') + '),status.is.null)';
        const PROD_TERMINAL_FILTER = 'status=in.(' + PROD_CACHE_TERMINAL.join(',') + ')';
        /* The cacheable projection of a full read. Pure, so the size contract
           above can be checked without a browser. */
        function _prodCacheProject(data) {
            const batches = ((data && data.batches) || []).map(batch => {
                const copy = {};
                for (const key of Object.keys(batch || {})) {
                    if (key === 'description' || key === 'desc') continue;
                    copy[key] = batch[key];
                }
                return copy;
            });
            const deliverables = ((data && data.deliverables) || []).filter(row => !_prodCacheIsTerminal(row));
            return {
                clients: (data && data.clients) || [],
                members: (data && data.members) || [],
                batches: _prodCachePackRows(batches, _prodCacheBatchColumns()),
                deliverables: _prodCachePackRows(deliverables, _prodCacheDeliverableColumns()),
                /*
                 * AUTHORITY IS DELIBERATELY NOT CACHED.
                 *
                 * It decides whether write controls are live. A snapshot may be
                 * 24 hours old, so painting authority from it would mean that on
                 * the morning of a flip -- or the morning after one is rolled
                 * back -- a reader briefly sees the PREVIOUS day's answer, with
                 * the write controls it implies, until the live read lands.
                 *
                 * Leaving it out reproduces exactly what happens today: nothing
                 * was ever cached, because the write always failed, so
                 * authorityLoaded was false at first paint and the tab stayed
                 * read-only until _prodFetchAuthority answered. Turning the
                 * cache on must not quietly change that, least of all this week.
                 */
            };
        }
        const PROD_CACHE_KILL_KEY = 'syncview_production_cache_off';
        let _prodCacheFlagCache = null;
        function _prodCacheEnabled() {
            if (_prodCacheFlagCache !== null) return _prodCacheFlagCache;
            let on = true;
            try {
                const q = new URLSearchParams(svRoute.search()).get('prodcache');
                if (q === '1' || q === 'true') { on = true; localStorage.removeItem(PROD_CACHE_KILL_KEY); }
                else if (q === '0' || q === 'false') { on = false; localStorage.setItem(PROD_CACHE_KILL_KEY, '1'); }
                else { on = (localStorage.getItem(PROD_CACHE_KILL_KEY) !== '1'); }
            } catch { on = true; }
            _prodCacheFlagCache = on;
            return on;
        }
        function _prodCacheRead() {
            if (!_prodCacheEnabled()) return null;
            try {
                const raw = localStorage.getItem(PROD_CACHE_KEY);
                if (!raw) return null;
                return _prodCacheValidate(JSON.parse(raw));
            } catch { return null; }
        }
        /* Shared by both stores, so an IndexedDB snapshot is held to exactly
           the checks a localStorage one is: schema, age, and column lists. */
        function _prodCacheValidate(parsed) {
            try {
                if (!parsed || parsed.schema !== PROD_CACHE_SCHEMA || !parsed.savedAt) return null;
                if (Date.now() - Number(parsed.savedAt) > PROD_CACHE_TTL_MS) return null;
                if (!Array.isArray(parsed.clients) || !Array.isArray(parsed.members)) return null;
                const batches = _prodCacheUnpackRows(parsed.batches);
                const deliverables = _prodCacheUnpackRows(parsed.deliverables);
                if (!batches || !deliverables) return null;
                /* The columns the snapshot was written with must still be the
                   columns the app reads. A deploy that adds one to
                   PROD_DELIVERABLE_SELECT leaves yesterday's snapshot missing a
                   field that _prodHasOwn probes for, and "absent" is a real
                   answer to those probes -- so the snapshot is dropped rather
                   than painted with a shape the running code no longer expects. */
                const wantedDeliverables = _prodCacheDeliverableColumns().join(',');
                const wantedBatches = _prodCacheBatchColumns().join(',');
                if (!parsed.deliverables || (parsed.deliverables.c || []).join(',') !== wantedDeliverables) return null;
                /* BOTH row sets, symmetrically. Checking only the deliverables
                   left a deploy that changes PROD_BATCH_SELECT accepting
                   yesterday's batch shape, so a newly selected field would be
                   ABSENT during the cached paint -- which is the exact
                   absent-versus-null ambiguity this schema exists to preserve,
                   arriving from the other side. */
                if (!parsed.batches || (parsed.batches.c || []).join(',') !== wantedBatches) return null;
                return { savedAt: parsed.savedAt, clients: parsed.clients, members: parsed.members, batches, deliverables };
            } catch { return null; }
        }
        function _prodCacheWrite(data) {
            if (!_prodCacheEnabled() || !data) return false;
            let payload;
            let snapshot;
            try {
                snapshot = Object.assign(
                    { schema: PROD_CACHE_SCHEMA, savedAt: Date.now() },
                    _prodCacheProject(data),
                );
                payload = JSON.stringify(snapshot);
            } catch { return false; }
            // Refused here, kept in IndexedDB (see _prodIdbCacheWrite). Guarded
            // so this function still runs where only it has been loaded.
            const spill = () => { if (typeof _prodIdbCacheWrite === 'function') _prodIdbCacheWrite(snapshot); };
            // Rule 1: an oversized payload costs its neighbours nothing. The
            // eviction loop below only makes sense for a write that could
            // succeed once there is room; checking after the first failure
            // would already have started deleting.
            if (payload.length > PROD_CACHE_MAX_CHARS) {
                try { localStorage.removeItem(PROD_CACHE_KEY); } catch {}
                spill();
                return false;
            }
            try {
                localStorage.setItem(PROD_CACHE_KEY, payload);
                // One store holds the snapshot at a time, so an older spilled
                // copy can never outlive the one written here.
                if (typeof _prodIdbCacheDelete === 'function') _prodIdbCacheDelete();
                return true;
            }
            catch (e) {
                // QuotaExceededError — evict oldest same-family snapshots
                // (calendar / samples) and our own prior entry to make room,
                // then retry. On final failure drop our key so a truncated or
                // stale snapshot never seeds a wrong first paint (same
                // drop-on-fail rule as _calCacheWrite). Cache-off then just
                // means today's every-visit reload.
                try { localStorage.removeItem(PROD_CACHE_KEY); } catch {}
                try {
                    const evictable = [];
                    for (let i = 0; i < localStorage.length; i++) {
                        const k = localStorage.key(i);
                        if (!k) continue;
                        if (k.startsWith(CAL_CACHE_KEY_PREFIX) || k.startsWith(SXR_CACHE_PREFIX)) {
                            const raw = String(localStorage.getItem(k) || '');
                            /*
                             * A display cache carrying an acknowledged repair is
                             * DURABLE STATE, not eviction fodder -- the same rule
                             * _writeUiRepairEvictDisplayCaches applies, in the
                             * same words, and test/write-ui-failure-messages.js
                             * pins it there.
                             *
                             * This loop could not be reached until now: the
                             * payload was always over budget, so the size check
                             * returned before eviction ever ran. Making the
                             * snapshot fit makes this reachable for the first
                             * time, and without this guard a quota-tight session
                             * that opens SyncLinear would delete the recovery
                             * state of a partially committed calendar or samples
                             * write. A cold Production paint is refetchable;
                             * that is not.
                             */
                            if (raw.indexOf('_writeUiRetrySourceAt') >= 0
                                || raw.indexOf('_writeUiKasperRepair') >= 0) continue;
                            let savedAt = 0;
                            try { savedAt = Number(JSON.parse(raw || '{}').savedAt) || 0; } catch {}
                            evictable.push({ k, savedAt });
                        }
                    }
                    evictable.sort((a, b) => a.savedAt - b.savedAt);
                    for (const { k } of evictable) {
                        try { localStorage.removeItem(k); } catch {}
                        try { localStorage.setItem(PROD_CACHE_KEY, payload); return true; } catch {}
                    }
                } catch {}
                spill();
                return false;
            }
        }
        // Drop the first-paint snapshot. It caches clients/members/batches/
        // deliverables/authority from an authorized session; once staff sign out,
        // an identity is invalidated, or a live read is refused (403) — which now
        // happens whenever the reland's narrowed grants no longer authorize the
        // reader — the cached copy is stale and must not seed the next paint.
        function _prodCachePurge() {
            try { localStorage.removeItem(PROD_CACHE_KEY); } catch {}
            _prodIdbCacheDelete();
            try { if (typeof _prodState !== 'undefined' && _prodState) _prodState.fromCache = false; } catch {}
        }
        /* THE SNAPSHOT THAT DOES NOT FIT localStorage GOES TO IndexedDB.
           Measured 2026-09-23: the projection is 2,588,656 characters against
           PROD_CACHE_MAX_CHARS 2,400,000 (2,432 live rows, 1,755 batches), so
           _prodCacheWrite refused it on every load and every visit started
           from nothing. The localStorage path is left exactly as it was -- its
           budget protects the calendar's snapshots -- and only a payload it
           refuses is kept here instead, where the origin has far more room.
           Same projected object, same validation on the way out
           (_prodCacheValidate), same purge. */
        const PROD_IDB_NAME = 'syncview_production';
        const PROD_IDB_STORE = 'snapshot';
        const PROD_IDB_KEY = PROD_CACHE_KEY;
        let _prodIdbPromise = null;
        function _prodIdbOpen() {
            if (_prodIdbPromise) return _prodIdbPromise;
            _prodIdbPromise = new Promise((resolve, reject) => {
                try {
                    if (typeof indexedDB === 'undefined' || !indexedDB) return reject(new Error('no indexedDB'));
                    const req = indexedDB.open(PROD_IDB_NAME, 1);
                    req.onupgradeneeded = () => { try { req.result.createObjectStore(PROD_IDB_STORE); } catch (e) {} };
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
                    req.onblocked = () => reject(new Error('indexedDB blocked'));
                } catch (e) { reject(e); }
            }).catch(error => { _prodIdbPromise = null; throw error; });
            return _prodIdbPromise;
        }
        function _prodIdbRequest(mode, run) {
            return _prodIdbOpen().then(db => new Promise((resolve, reject) => {
                const tx = db.transaction(PROD_IDB_STORE, mode);
                const req = run(tx.objectStore(PROD_IDB_STORE));
                tx.oncomplete = () => resolve(req ? req.result : undefined);
                tx.onerror = tx.onabort = () => reject(tx.error || new Error('indexedDB transaction failed'));
            }));
        }
        /* Bumped by every purge and every write, so a read that started before
           a sign-out (or before a newer write) can never paint what it found. */
        let _prodIdbCacheSeq = 0;
        function _prodIdbCacheWrite(payload) {
            const seq = ++_prodIdbCacheSeq;
            return _prodIdbRequest('readwrite', store => store.put(payload, PROD_IDB_KEY))
                .then(() => seq === _prodIdbCacheSeq, () => false);
        }
        function _prodIdbCacheDelete() {
            _prodIdbCacheSeq++;
            try { return _prodIdbRequest('readwrite', store => store.delete(PROD_IDB_KEY)).catch(() => {}); }
            catch (e) { return Promise.resolve(); }
        }
        function _prodIdbCacheRead() {
            if (!_prodCacheEnabled()) return Promise.resolve(null);
            const seq = _prodIdbCacheSeq;
            return _prodIdbRequest('readonly', store => store.get(PROD_IDB_KEY))
                .then(parsed => (seq === _prodIdbCacheSeq ? _prodCacheValidate(parsed) : null), () => null);
        }
        /* `snapshot` is the IndexedDB copy when there is one (_prodMountFromIdbOrLoad);
           otherwise the localStorage copy is read here, as it always was. */
        function _prodHydrateFromCache(snapshot) {
            const cached = snapshot || _prodCacheRead();
            if (!cached) return false;
            const clients = cached.clients;
            const members = cached.members;
            const batches = cached.batches;
            const deliverables = cached.deliverables;
            _prodState.clients = clients;
            _prodState.members = members;
            _prodState.batches = batches;
            _prodState.deliverables = deliverables;
            /* Not restored from the snapshot -- see _prodCacheProject. The tab
               stays read-only on the cached paint, exactly as it does today,
               until _prodFetchAuthority answers. */
            _prodState.authority = null;
            _prodState.authorityLoaded = false;
            _prodState.authorityReadAt = 0;
            _prodState.adapter = _prodAdapter({ clients, members, batches, deliverables });
            _prodState.loaded = true;
            _prodState.cachedAt = Number(cached.savedAt) || 0;
            _prodState.fromCache = true;
            _prodState.cachePartial = true;
            // A deep-link target absent from the CACHED snapshot shows the list
            // for this paint only. The request stays pending so the live read
            // that follows can still open it.
            _prodApplyDeepLinkFallback(false);
            return true;
        }
        function _prodLoadDisplayPrefs() {
            // PORT-DELTA: wired Production persists display-only state per user; the artifact keeps state in memory.
            try {
                _prodApplyDisplayPrefs(JSON.parse(localStorage.getItem(PROD_DISPLAY_PREFS_KEY) || '{}') || {});
            } catch (e) {}
        }
        function _prodSaveDisplayPrefs() {
            // PORT-DELTA: wired Production persists display-only state per user; the artifact keeps state in memory.
            try {
                localStorage.setItem(PROD_DISPLAY_PREFS_KEY, JSON.stringify({
                    groupBy: PROD_GROUP_KEYS.has(_prodState.groupBy) ? _prodState.groupBy : 'status',
                    orderBy: PROD_ORDER_KEYS.has(_prodState.orderBy) ? _prodState.orderBy : 'due',
                    showSubIssues: _prodState.showSubIssues !== false
                }));
            } catch (e) {}
        }
        function _prodHeaders() {
            return { apikey: CAL_SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY, Accept: 'application/json' };
        }
        function _prodSleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
        async function _prodRestPage(url, table, page) {
            let lastErr = null;
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const resp = await fetch(url, { headers: _prodHeaders() });
                    if (resp.ok) return resp.json();
                    const retryable = resp.status === 429 || resp.status >= 500;
                    const detail = await resp.json().catch(() => ({}));
                    lastErr = new Error(table + ' read failed: HTTP ' + resp.status);
                    lastErr.status = resp.status;
                    lastErr.code = String(detail && detail.code || '');
                    lastErr.detail = String(detail && (detail.message || detail.details || detail.hint) || '');
                    if (!retryable || attempt === 2) throw lastErr;
                } catch (e) {
                    lastErr = e;
                    if (attempt === 2) throw lastErr;
                }
                await _prodSleep(250 * Math.pow(2, attempt) + Math.min(250, page * 25));
            }
            throw lastErr || new Error(table + ' read failed');
        }
        async function _prodClientRows() {
            const select = 'slug,display_name,active,kind,emoji,board_status,lead_member_id,target_date,board_desc,linear_project_ids,native_project_ids,updated_at';
            try {
                return await _prodRestRows('clients', select, 'order=display_name.asc', 1000, 10);
            } catch (error) {
                // During staged installation this one additive column may not exist yet.
                // Preserve the missing field; never invent native project mappings.
                if (!error || error.status !== 400 || error.code !== '42703'
                    || error.detail !== 'column clients.native_project_ids does not exist') throw error;
                return _prodRestRows('clients', select.replace(',native_project_ids', ''), 'order=display_name.asc', 1000, 10);
            }
        }

        async function _prodRestRows(table, select, params, pageSize, maxPages, options) {
            if (!CAL_SUPABASE_URL || !CAL_SUPABASE_ANON_KEY) throw new Error('Supabase is not configured');
            const rows = [];
            const limit = Math.max(1, Math.min(1000, Number(pageSize || 1000)));
            const cap = Math.max(1, Number(maxPages || 100));
            const cleanParams = String(params || '').split('&').filter(p => p && !/^limit=|^offset=/.test(p)).join('&');
            const keysetColumn = String(options && options.keysetColumn || '').trim();
            if (keysetColumn) {
                // Read-path fix, measured 2026-07-25 against the live anon
                // endpoint. OFFSET pagination makes PostgreSQL project and sort
                // the whole relation once per page, so the five boot pages each
                // cost a full projection (~1.2 s upstream apiece) and the 4-wide
                // parallel burst below pushed anon requests past the statement
                // timeout (57014 / HTTP 500, 15/15 in a burst probe). A
                // primary-key keyset walk is strictly sequential and each page
                // scans only what is left: 5.85 s -> 3.42 s of upstream time and
                // no concurrent burst at all.
                const keysetParams = cleanParams.split('&')
                    .filter(p => p && !/^order=/.test(p)).join('&');
                let cursor = '';
                for (let page = 0; page < cap; page++) {
                    const url = CAL_SUPABASE_URL + '/rest/v1/' + table
                        + '?select=' + encodeURIComponent(select)
                        + '&limit=' + limit
                        + '&order=' + encodeURIComponent(keysetColumn) + '.asc'
                        + (cursor ? '&' + encodeURIComponent(keysetColumn) + '=gt.' + encodeURIComponent(cursor) : '')
                        + (keysetParams ? '&' + keysetParams : '');
                    const batch = await _prodRestPage(url, table, page);
                    if (!Array.isArray(batch)) return rows;
                    rows.push(...batch);
                    if (batch.length < limit) return rows;
                    const last = batch[batch.length - 1];
                    const next = String(last && last[keysetColumn] == null ? '' : last[keysetColumn]);
                    // A page that cannot advance the cursor would loop forever;
                    // fail loudly instead of silently truncating the projection.
                    if (!next || next === cursor) throw new Error(table + ' keyset read stalled');
                    cursor = next;
                }
                throw new Error(table + ' read exceeded pagination cap');
            }
            const pageUrl = page => {
                const offset = page * limit;
                return CAL_SUPABASE_URL + '/rest/v1/' + table
                    + '?select=' + encodeURIComponent(select)
                    + '&limit=' + limit
                    + '&offset=' + offset
                    + (cleanParams ? '&' + cleanParams : '');
            };
            let page = 0;
            while (page < cap) {
                const width = page === 0 ? 1 : Math.min(4, cap - page);
                const pages = await Promise.all(Array.from({ length: width }, (_, i) => {
                    const p = page + i;
                    return _prodRestPage(pageUrl(p), table, p).then(batch => ({ page: p, batch }));
                }));
                for (const item of pages) {
                    const batch = item.batch;
                    rows.push(...batch);
                    if (!Array.isArray(batch) || batch.length < limit) return rows;
                    if (item.page === cap - 1) throw new Error(table + ' read exceeded pagination cap');
                }
                page += width;
            }
            return rows;
        }
        function _prodBrowserProjectionMissing(error) {
            const status = Number(error && error.status || 0);
            const code = String(error && error.code || '').trim().toUpperCase();
            const detail = String(error && error.detail || '');
            return status === 404
                && (code === 'PGRST205' || code === '42P01')
                && /production_deliverables_browser_v1/i.test(detail);
        }
        /* The batches boot select, named so the cache and the read cannot drift
           apart. `description` is the one column the cache drops (see
           _prodCacheBatchColumns) and the one the preserve path already knows
           how to refill. */
        const PROD_BATCH_SELECT = 'id,client_slug,team,name,color,status,sort_key,created_by,created_at,updated_at,linear_parent_ids';
        /* The description is NOT in the boot read. It is read per batch, when
           that parent's panel opens (`_prodEnsureDescription`), the way a
           deliverable's `brief` already is. Measured 2026-09-08: 1,688 batches
           carry 2.3 million characters of description, about 1.0 MB of the
           1.1 MB (compressed) the batch read cost, and the app re-downloaded
           all of it on every open of the tab and every return to it, to show
           one description at a time. `updated_at` rides along so a held value
           can be told apart from a moved one. */
        const PROD_BATCH_DESCRIPTION_SELECT = 'id,description,updated_at';
        const PROD_DELIVERABLE_SELECT = 'id,identifier,batch_id,client_slug,team,kind,title,status,status_at,assignee_id,due_date,origin,card_id,sync_state,created_at,updated_at,artifact_revision,linear_issue_uuid,linear_identifier,linear_issue_url,identity_repair_state,identity_repair_reason,identity_repair_resolved_linear_issue_id,raw_issue_parent_id,raw_project_id,raw_attribution_schema,raw_attribution_state,raw_attribution_client_slug,raw_attribution_owner_kind,raw_attribution_source,raw_attribution_project_id,raw_attribution_native_epoch,raw_attribution_provisional_client_slug,raw_attribution_mapping_revision,raw_attribution_repair_required,raw_attribution_reason,raw_attribution_explicit_owner_approved,raw_attribution_has_explicit_decision_ref,raw_attribution_explicit_manifest_sha256,raw_issue_archived_at,raw_issue_canceled_at,raw_webhook_delete,raw_deleted,raw_delete,raw_removed,raw_archived';
        async function _prodBrowserProjectionRows(select, params) {
            try {
                return await _prodRestRows('production_deliverables_browser_v1', select, params, 1000, 50, { keysetColumn: 'id' });
            } catch (error) {
                const missing = error && error.status === 400 && error.code === '42703'
                    && ['raw_attribution_project_id', 'raw_attribution_native_epoch'].some(field =>
                        error.detail === 'column production_deliverables_browser_v1.' + field + ' does not exist');
                if (!missing) throw error;
                // Retain the safe view and pagination. Missing native proof stays missing.
                const compatible = select.split(',').filter(field =>
                    field !== 'raw_attribution_project_id' && field !== 'raw_attribution_native_epoch').join(',');
                return _prodRestRows('production_deliverables_browser_v1', compatible, params, 1000, 50, { keysetColumn: 'id' });
            }
        }
        async function _prodLoadDeliverableProjection(filterParams) {
            const select = PROD_DELIVERABLE_SELECT;
            const params = String(filterParams == null ? '' : filterParams);
            try {
                // The browser sorts every list itself, so the server order only
                // ever provided stable pagination; a primary-key keyset walk
                // provides the same stability without re-sorting the relation
                // per page. See the keyset branch of _prodRestRows.
                return await _prodBrowserProjectionRows(select, params);
            } catch (error) {
                if (!_prodBrowserProjectionMissing(error)) throw error;
                // Release transition only: the compatible UI may precede the
                // migration that creates the safe view. Once installed, only
                // the view is used; auth/network/server failures never fall
                // back to legacy body reads.
                const legacySelect = 'id,identifier,batch_id,client_slug,team,kind,title,status,status_at,assignee_id,due_date,origin,card_id,sync_state,created_at,updated_at,linear_issue_uuid,linear_identifier,linear_issue_url,identity_repair_state:linear_raw->identity_repair->>state,identity_repair_reason:linear_raw->identity_repair->>reason,identity_repair_resolved_linear_issue_id:linear_raw->identity_repair->>resolved_linear_issue_id,raw_issue_parent_id:linear_raw->issue->parent->>id,raw_project_id:linear_raw->issue->project->>id,raw_attribution_schema:linear_raw->attribution->>schema,raw_attribution_state:linear_raw->attribution->>state,raw_attribution_client_slug:linear_raw->attribution->>client_slug,raw_attribution_owner_kind:linear_raw->attribution->>owner_kind,raw_attribution_source:linear_raw->attribution->>source,raw_attribution_project_id:linear_raw->attribution->>project_id,raw_attribution_native_epoch:linear_raw->attribution->>native_epoch,raw_attribution_provisional_client_slug:linear_raw->attribution->>provisional_client_slug,raw_attribution_mapping_revision:linear_raw->attribution->>mapping_revision,raw_attribution_repair_required:linear_raw->attribution->>repair_required,raw_attribution_reason:linear_raw->attribution->>reason,raw_attribution_explicit_owner_approved:linear_raw->attribution->>explicit_owner_approved,raw_attribution_explicit_decision_ref:linear_raw->attribution->>explicit_decision_ref,raw_attribution_explicit_manifest_sha256:linear_raw->attribution->>explicit_manifest_sha256,raw_issue_archived_at:linear_raw->issue->>archivedAt,raw_issue_canceled_at:linear_raw->issue->>canceledAt,raw_webhook_delete:linear_raw->>webhook_delete,raw_deleted:linear_raw->>deleted,raw_delete:linear_raw->>delete,raw_removed:linear_raw->>removed,raw_archived:linear_raw->>archived';
                return _prodRestRows(
                    'deliverables',
                    legacySelect,
                    params,
                    1000,
                    50,
                    { keysetColumn: 'id' }
                );
            }
        }
        function _prodAuthorityValue(value) {
            if (typeof value === 'string') {
                try { value = JSON.parse(value); } catch (e) { return null; }
            }
            if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
            const video = String(value.video || '').trim().toLowerCase();
            const graphics = String(value.graphics || '').trim().toLowerCase();
            if (!['linear', 'syncview'].includes(video) || !['linear', 'syncview'].includes(graphics)) return null;
            return { video, graphics };
        }
        async function _prodFetchAuthority() {
            try {
                // Limit 2 lets the generic pager prove the exact-one contract;
                // a 1-row page at a 1-page cap is intentionally treated as
                // potentially truncated by _prodRestRows.
                const rows = await _prodRestRows('syncview_runtime_flags', 'value', 'key=eq.' + encodeURIComponent(PROD_AUTHORITY_FLAG_KEY), 2, 1);
                if (!Array.isArray(rows) || rows.length !== 1) return null;
                return _prodAuthorityValue(rows[0] && rows[0].value);
            } catch (e) {
                return null;
            }
        }
        /* Which teams' native intake has cut over -- the SAME flag and the
           SAME parsing/validation the Calendar create picker already reads
           (_calLatestNativeBatches), so the two surfaces cannot disagree
           about what "cut over" means. Returns a Set of 'video'/'graphics',
           or null on any unusable read (missing row, wrong key, malformed
           value) -- the caller fails that OPEN, exactly as the Calendar read
           does, rather than resetting an already-confirmed team back to
           "not cut over" on a transient miss. */
        async function _prodFetchNativeEpochTeams() {
            try {
                const flags = await _prodRestRows('syncview_runtime_flags', 'key,value', 'key=eq.native_intake_epochs', 2, 1);
                const row = Array.isArray(flags) && flags.length === 1 && flags[0] && flags[0].key === 'native_intake_epochs'
                    ? flags[0] : null;
                const value = row && row.value;
                if (!value || typeof value !== 'object' || Array.isArray(value)) {
                    throw new Error('native_intake_epochs flag payload is missing or malformed');
                }
                return new Set(['video', 'graphics'].filter(team => value[team]
                    && value[team].enabled === true && typeof value[team].epoch === 'string'
                    && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value[team].epoch)));
            } catch (error) {
                console.warn('[Production] native_intake_epochs flag read failed', error);
                return null;
            }
        }
        /* Whether TEAM'S native intake has cut over -- a permanently empty
           linear_issue_uuid past that point is a finished native card, not a
           card mid-sync. Unloaded or unreadable (_prodState.nativeEpochTeams
           is null) fails OPEN to "not cut over", so a card that really is
           still syncing to Linear keeps reading that way rather than being
           misreported as a repair-needed attribution gap on a flag read that
           has not landed yet. */
        function _prodNativeEpochOn(team) {
            const t = String(team || '').trim().toLowerCase();
            if (t !== 'video' && t !== 'graphics') return false;
            const teams = _prodState.nativeEpochTeams;
            return teams instanceof Set && teams.has(t);
        }
        async function _prodRefreshAuthority(options) {
            const previous = JSON.stringify(_prodState.authority || null);
            const authority = await _prodFetchAuthority();
            _prodState.authority = authority;
            _prodState.authorityLoaded = true;
            _prodState.authorityReadAt = Date.now();
            if ((!options || !options.silent || JSON.stringify(authority || null) !== previous) && document.getElementById('prodRoot')) _prodRender();
            return authority;
        }
        let _prodAuthorityTimer = 0;
        function _prodStartAuthorityRefresh() {
            if (_prodAuthorityTimer) return;
            _prodAuthorityTimer = setInterval(() => {
                if (document.hidden || currentNav !== 'production' || !document.getElementById('prodRoot')) return;
                _prodRefreshAuthority({ silent: true });
            }, 30000);
        }
        function _prodById(rows, key) {
            return new Map((rows || []).map(r => [String(r && r[key] || ''), r]).filter(([k]) => k));
        }
        function _prodHasOwn(row, field) {
            return !!row && Object.prototype.hasOwnProperty.call(row, field);
        }
        function _prodPreserveProjectedFields(incoming, previous, key, fields) {
            const priorById = _prodById(previous, key);
            return (incoming || []).map(row => {
                const prior = priorById.get(String(row && row[key] || ''));
                if (!row || !prior) return row;
                fields.forEach(field => {
                    if (!_prodHasOwn(row, field) && _prodHasOwn(prior, field)) row[field] = prior[field];
                });
                return row;
            });
        }
        /* Batch descriptions are read on demand (PROD_BATCH_DESCRIPTION_SELECT),
           so a reload never carries them in. A description already held is
           kept only while the row's `updated_at` is unchanged: the description
           write is a compare-and-swap on that column, so a different stamp
           means the text may have moved, and the panel must read it again
           rather than keep showing the old one. */
        function _prodCarryBatchDescriptions(incoming, previous) {
            const priorById = _prodById(previous, 'id');
            return (incoming || []).map(row => {
                const prior = row ? priorById.get(String(row.id || '')) : null;
                if (!prior || _prodHasOwn(row, 'description')) return row;
                if (String(prior.updated_at || '') !== String(row.updated_at || '')) return row;
                if (_prodHasOwn(prior, 'description')) row.description = prior.description;
                return row;
            });
        }
        function _prodNormKey(v) {
            return String(v || '').trim().toLowerCase();
        }
        function _prodArtifactStatus(status) {
            return PROD_STATUS_TO_ARTIFACT[String(status || '').trim()] || String(status || '').trim() || 'todo';
        }
        function _prodBoardStatus(status) {
            return PROD_BOARD_STATUS_TO_ARTIFACT[String(status || '').trim()] || 'prog';
        }
        function _prodHashText(text) {
            const s = String(text || '');
            let h = 0;
            for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
            return Math.abs(h);
        }
        function _prodInitials(name) {
            const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
            return ((parts[0] ? parts[0][0] : '?') + (parts[1] ? parts[1][0] : '')).toUpperCase();
        }
        function _prodLinearRaw(value) {
            if (!value) return {};
            if (typeof value === 'object' && !Array.isArray(value)) return value;
            try {
                const parsed = JSON.parse(String(value || '{}'));
                return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
            } catch (e) {
                return {};
            }
        }
        function _prodNormalizeLabel(value) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
            const id = String(value.id || '').trim();
            const name = String(value.name || '').trim();
            if (!id || !name) return null;
            const rawColor = String(value.color || '').trim();
            return {
                id,
                name,
                color: /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor.toUpperCase() : '',
                description: String(value.description || '').trim()
            };
        }
        function _prodNormalizeLabelList(values) {
            if (!Array.isArray(values)) return null;
            const seen = new Set();
            const normalized = [];
            for (const value of values) {
                const label = _prodNormalizeLabel(value);
                if (!label || seen.has(label.id)) return null;
                seen.add(label.id);
                normalized.push(label);
            }
            return normalized;
        }
        function _prodLabelState(id) {
            return _prodState.labels.get(String(id || '')) || null;
        }
        // ---- F94: server-authoritative eligible-assignee projection ----------
        // The shipped picker listed every active same-team roster row while the
        // gateway checked only id + active + team, so a manual reassignment
        // could commit an incompatible role or an unmirrorable target and fail
        // later in linear-outbound. The picker now renders only what the
        // gateway's own projection returns, and fails closed (no selectable
        // candidate) while that projection is loading, refused, or unavailable.
        function _prodAssigneeOptionsState(id) {
            return _prodState.assigneeOptions.get(String(id || '')) || null;
        }
        function _prodNextAssigneeOptionsToken(id) {
            id = String(id || '');
            const token = Number(_prodState.assigneeOptionRequestTokens.get(id) || 0) + 1;
            _prodState.assigneeOptionRequestTokens.set(id, token);
            return token;
        }
        function _prodAssigneeOptionsErrorText(error) {
            const code = String(error && (error.code || error.message) || '');
            if (error && error.status === 401) return 'Staff sign-in expired. Sign in again to choose an assignee.';
            if (error && error.status === 403) return 'This staff account cannot assign this issue.';
            if (code === 'assignee_provider_unavailable') return 'Linear could not confirm who is assignable. Nothing was changed.';
            if (code === 'assignee_lookup_unavailable') return 'The roster could not be read. Nothing was changed.';
            return 'Eligible assignees could not be loaded. Retry to check the current roster.';
        }
        function _prodRefreshAssigneeSurfaces(id) {
            if (document.getElementById('prodRoot')) _prodRender();
            const pop = document.querySelector('[data-prod-assign-pop="' + CSS.escape(String(id || '')) + '"]');
            if (pop) {
                pop.innerHTML = _prodPickerHTML('assign', _prodCurVal('assign', id), [id]);
                _prodWirePicker(pop, 'assign', [id]);
            }
        }
        async function _prodEnsureAssigneeOptions(id, force) {
            id = String(id || '');
            const issue = _prodIssue(id);
            if (!issue) return null;
            const current = _prodAssigneeOptionsState(id);
            if (!force && current && current.status === 'ready') return current;
            if (!force && current && current.status === 'loading') return current;
            const staffIdentity = _syncviewStaffIdentityForHeaders();
            if (!staffIdentity) {
                const state = { status: 'error', candidates: [], error: 'Staff sign-in is required to choose an assignee.' };
                _prodState.assigneeOptions.set(id, state);
                _prodRefreshAssigneeSurfaces(id);
                return state;
            }
            const verificationEpoch = _syncviewStaffVerificationEpoch;
            const identitySignature = _syncviewStaffIdentitySignature(staffIdentity);
            const requestToken = _prodNextAssigneeOptionsToken(id);
            const requestStillCurrent = () => verificationEpoch === _syncviewStaffVerificationEpoch
                && identitySignature === _syncviewStaffIdentitySignature(_syncviewStaffIdentityForHeaders())
                && requestToken === _prodState.assigneeOptionRequestTokens.get(id);
            _prodState.assigneeOptions.set(id, {
                status: 'loading',
                candidates: current && current.candidates || [],
                error: ''
            });
            _prodRefreshAssigneeSurfaces(id);
            try {
                const response = await fetch(PROD_WRITE_EF_URL, {
                    method: 'POST',
                    cache: 'no-store',
                    headers: _syncviewEfHeaders({
                        apikey: CAL_SUPABASE_ANON_KEY,
                        Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY,
                        Accept: 'application/json',
                        'Content-Type': 'application/json'
                    }, PROD_WRITE_EF_URL),
                    body: JSON.stringify({
                        action: 'assignee_options',
                        surface: 'production',
                        id,
                        client_slug: issue.authorityProject || issue.storedClientSlug || issue.project || ''
                    })
                });
                const json = await response.json().catch(() => ({}));
                if (!requestStillCurrent()) return null;
                if (!response.ok || !json || json.ok !== true || json.complete !== true
                    || !Array.isArray(json.assignees)) {
                    const error = new Error(String(json && json.error || 'assignee_options_failed'));
                    error.status = response.status;
                    error.code = String(json && json.error || 'assignee_options_failed');
                    throw error;
                }
                const candidates = json.assignees
                    .map(row => ({ id: String(row && row.id || ''), name: String(row && row.name || '') }))
                    .filter(row => row.id);
                const state = { status: 'ready', candidates, error: '' };
                _prodState.assigneeOptions.set(id, state);
                _prodRefreshAssigneeSurfaces(id);
                return state;
            } catch (error) {
                if (!requestStillCurrent()) return null;
                _prodState.assigneeOptions.set(id, {
                    status: 'error',
                    candidates: [],
                    error: _prodAssigneeOptionsErrorText(error)
                });
                _prodRefreshAssigneeSurfaces(id);
                return _prodAssigneeOptionsState(id);
            }
        }
        function _prodNextLabelRequestToken(id) {
            id = String(id || '');
            const token = Number(_prodState.labelRequestTokens.get(id) || 0) + 1;
            _prodState.labelRequestTokens.set(id, token);
            return token;
        }
        function _prodAdoptLabelPayload(id, payload, fallbackCatalog) {
            id = String(id || '');
            const catalog = _prodNormalizeLabelList(
                Array.isArray(payload && payload.catalog) ? payload.catalog : fallbackCatalog
            );
            const selectedLabels = _prodNormalizeLabelList(payload && payload.selected_labels);
            if (!catalog || !selectedLabels || !Array.isArray(payload && payload.selected_label_ids)) {
                throw new Error('incomplete_label_state');
            }
            const selectedIds = [];
            const selectedSet = new Set();
            for (const value of payload.selected_label_ids) {
                const labelId = String(value || '').trim();
                if (!labelId || selectedSet.has(labelId)) throw new Error('incomplete_label_state');
                selectedSet.add(labelId);
                selectedIds.push(labelId);
            }
            const allById = new Map(catalog.map(label => [label.id, label]));
            selectedLabels.forEach(label => {
                if (!allById.has(label.id)) allById.set(label.id, label);
            });
            if (selectedIds.some(labelId => !allById.has(labelId))) throw new Error('incomplete_label_state');
            const selected = selectedIds.map(labelId => allById.get(labelId));
            _prodState.labels.set(id, {
                status: 'ready',
                complete: true,
                authority: payload && payload.authority || '',
                catalogVersion: typeof (payload && payload.catalog_version) === 'string' ? payload.catalog_version : '',
                catalog: [...allById.values()],
                selectedIds,
                selected,
                saving: false,
                error: '',
                writeError: ''
            });
            return _prodState.labels.get(id);
        }
        function _prodLabelErrorText(error) {
            const code = String(error && (error.code || error.message) || '');
            if (error && error.status === 401) return 'Staff sign-in expired. Sign in again to load labels.';
            if (error && error.status === 403) return 'This staff account cannot read labels for this issue.';
            if (code === 'incomplete_label_state' || code === 'labels_incomplete') return 'Linear returned an incomplete label catalog. Nothing was changed.';
            return 'Labels could not be loaded. Retry to check the current Linear state.';
        }
        function _prodRefreshLabelSurfaces(id) {
            if (document.getElementById('prodRoot')) _prodRender();
            const pop = document.querySelector('[data-prod-label-pop="' + CSS.escape(String(id || '')) + '"]');
            if (pop) {
                pop.innerHTML = _prodLabelsPopHTML(id);
                _prodWireLabelsPop(pop, id);
            }
        }
        async function _prodEnsureLabels(id, force) {
            id = String(id || '');
            const issue = _prodIssue(id);
            if (!issue) return null;
            const current = _prodLabelState(id);
            if (issue.syntheticBatchParent === true) {
                /* A synthesized batch parent has no deliverable row and no
                   Linear issue of its own -- its id IS the batch id -- so
                   handleLabelsRead answers 404 entity_not_found every time.
                   _prodLabelErrorText has no branch for that, so it fell to
                   "Labels could not be loaded. Retry to check the current
                   Linear state." and rendered a Retry that re-fired the same
                   request forever. Both halves were false: the read did not
                   fail transiently, and there is no Linear label state to
                   re-check.
                   The description and asset readers already short-circuit here,
                   and the pickers already refuse with this exact sentence.
                   Labels is the control the 2026-08-30 truth pass missed.
                   It SETTLES rather than short-circuiting into nothing: leaving
                   the state absent would strand the button on "Loading labels"
                   forever, which is a quieter version of the same lie.

                   THE GUARD BELOW IS LOAD-BEARING AND MUST STAY FIRST.
                   This branch was written above the shared memo guard
                   (`if (!force && current) return current;`) and then called
                   _prodRefreshLabelSurfaces unconditionally -- which calls
                   _prodRender, which calls _prodEnsureLabels, which re-entered
                   here. Infinite synchronous recursion: the batch-parent detail
                   view hard-froze the tab on load, 100% reproducible, taking
                   the asset panel and the file pills down with it. Found by the
                   round-3 tester 2026-08-31 (PR 1186), on the same deploy that
                   shipped the fix this branch IS.
                   Re-rendering once when the state is first settled is correct
                   and necessary; re-rendering when it is already settled is the
                   defect. So the branch carries its own memo check rather than
                   moving below the shared one, which would put it after the
                   writes check and the staff-identity read that a synthetic
                   parent must never reach. */
                if (!force && current && current.structural === true) return current;
                const state = {
                    status: 'ready',
                    complete: true,
                    authority: current && current.authority || '',
                    catalog: [],
                    selectedIds: [],
                    selected: [],
                    saving: false,
                    error: '',
                    writeError: '',
                    structural: true
                };
                _prodState.labels.set(id, state);
                _prodRefreshLabelSurfaces(id);
                return state;
            }
            if (_prodState.writes.has(id + ':labels')) return current;
            if (!force && current) return current;
            const staffIdentity = _syncviewStaffIdentityForHeaders();
            if (!staffIdentity) {
                const state = {
                    status: 'error',
                    complete: false,
                    authority: '',
                    catalog: current && current.catalog || [],
                    selectedIds: current && current.selectedIds || [],
                    selected: current && current.selected || [],
                    saving: false,
                    error: 'Staff sign-in is required to load labels.',
                    writeError: ''
                };
                _prodState.labels.set(id, state);
                _prodRefreshLabelSurfaces(id);
                return state;
            }
            const verificationEpoch = _syncviewStaffVerificationEpoch;
            const identitySignature = _syncviewStaffIdentitySignature(staffIdentity);
            const requestToken = _prodNextLabelRequestToken(id);
            const requestStillCurrent = () => verificationEpoch === _syncviewStaffVerificationEpoch
                && identitySignature === _syncviewStaffIdentitySignature(_syncviewStaffIdentityForHeaders())
                && requestToken === _prodState.labelRequestTokens.get(id);
            _prodState.labels.set(id, {
                status: 'loading',
                complete: false,
                authority: current && current.authority || '',
                catalog: current && current.catalog || [],
                selectedIds: current && current.selectedIds || [],
                selected: current && current.selected || [],
                saving: false,
                error: '',
                writeError: ''
            });
            _prodRefreshLabelSurfaces(id);
            try {
                const response = await fetch(PROD_WRITE_EF_URL, {
                    method: 'POST',
                    cache: 'no-store',
                    headers: _syncviewEfHeaders({
                        apikey: CAL_SUPABASE_ANON_KEY,
                        Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY,
                        Accept: 'application/json',
                        'Content-Type': 'application/json'
                    }, PROD_WRITE_EF_URL),
                    body: JSON.stringify({ action: 'labels_read', surface: 'production', id })
                });
                const json = await response.json().catch(() => ({}));
                if (!requestStillCurrent()) return null;
                if (!response.ok || !json || json.ok !== true || json.complete !== true) {
                    const error = new Error(String(json && json.error || 'labels_read_failed'));
                    error.status = response.status;
                    error.code = String(json && json.error || 'labels_read_failed');
                    throw error;
                }
                const state = _prodAdoptLabelPayload(id, json, json.catalog);
                _prodRefreshLabelSurfaces(id);
                return state;
            } catch (error) {
                if (!requestStillCurrent()) return null;
                _prodState.labels.set(id, {
                    status: 'error',
                    complete: false,
                    authority: current && current.authority || '',
                    catalog: current && current.catalog || [],
                    selectedIds: current && current.selectedIds || [],
                    selected: current && current.selected || [],
                    saving: false,
                    error: _prodLabelErrorText(error),
                    writeError: ''
                });
                _prodRefreshLabelSurfaces(id);
                return _prodLabelState(id);
            }
        }
        const PROD_BATCH_ASSET_GUIDANCE = 'Held on the post, not readable here. Open a sub-issue to see it.';
        /* What an empty slot means before the authenticated read answers, and
           after it fails: not that the asset is absent, only that this page has
           not been told. No asset column is readable with the key this page
           ships, so the browser NEVER knows an asset is missing -- only the
           edge function can say that, and when it does, its own answer replaces
           this one. */
        const PROD_ASSET_UNREAD_GUIDANCE = 'Not readable until asset access is checked.';
        /* Why the Project row does not act, said once and used by every control
           that offered it. Not a permission and not a preview: no gateway
           operation writes client_slug on any surface, so there is nothing to
           enable. The repair path for a row on the WRONG project is the
           attribution repair, which is a different control with its own notice. */
        const PROD_PROJECT_MOVE_UNSUPPORTED = 'A deliverable cannot be moved between clients here. Its project comes from the batch it belongs to.';
        /* Delete and Move both answered with the preview sentence, which reads as
           "not yet" -- a permission someone could be granted, or a state the tab
           grows out of once it finishes loading. Neither is true. No gateway
           operation deletes a deliverable or moves one between teams, on any
           surface, for any role, so the refusal is permanent and saying "for
           anyone" is the part that closes off the wrong reading.

           Archiving IS named for Delete because it genuinely exists and reaches
           the same goal: archiveCalPost writes through for every staff seat
           (it returns early only on the client share link) and the card carries
           the control. It is deliberately worded as taking the POST out of the
           schedule rather than deleting the issue, because that is what it does
           -- the sub-issues survive. Move gets no remedy named because there
           genuinely is none. */
        const PROD_DELETE_UNSUPPORTED = 'Deleting is not available here, for anyone. To take a post out of the schedule, archive it on the content calendar.';
        const PROD_MOVE_UNSUPPORTED = 'An issue cannot be moved between teams here. Its team comes from the deliverable it was created as.';
        /* Sweep item 87.10. The group-header checkbox answered every click with
           the preview sentence, which is wrong twice over: selection is not a
           write anywhere else in this view -- _prodToggleRowSelection and
           Ctrl/Cmd+A both mutate _prodState.selected with no gate at all -- and
           the tab is not read-only under the live flag anyway, contradicting
           the sidebar chip a few inches away that says "Native writes".
           NOT WIDENED TO ACTUALLY SELECT, deliberately, in this pass: a
           whole-group selection would pull in synthetic batch parents and
           attribution-repair rows, and every downstream consumer of
           _prodState.selected (the bulk palette, the guarded S/A/DoubleD/DoubleP
           shortcuts, _prodOpenSub's "Applying to N of M" notice) would start
           seeing that shape routinely rather than on the rare manual multi-pick
           it sees today. That is a real behavior decision, not a copy one, and
           belongs in its own change with its own review -- shift-click and
           Ctrl/Cmd+A already reach the same result today, which is why this is
           the cheapest of the sweep survivors rather than a blocker.
           So the checkbox keeps refusing, and now says the true, narrow reason:
           this ONE control is not wired to select, and names the two that are. */
        const PROD_GROUP_SELECT_UNSUPPORTED = 'This checkbox does not select the group yet. Shift-click a row, or press Ctrl/Cmd+A, to select more than one.';
        function _prodAssetDefaultEvidence(issue) {
            const values = issue && issue.assets || {};
            const assets = {};
            /* A synthesized batch parent can never read its own batch asset
               columns: the browser grant excludes them by design, so an empty
               slot here means unreadable, not absent. This has to be decided at
               SEED time, not in _prodEnsureAssets -- the render seeds state and
               paints before ensure runs, and the synthetic branch returns
               without repainting, so a correction made only there would not
               reach the screen until an unrelated re-render. */
            /* EVERY deliverable seeds unreadable, not just a batch parent.
               The batch-parent fix was correct and too narrow, and the sweep
               that found the rest is worth writing down: `issue.assets` is
               hardcoded to four empty strings for every row the projection
               builds, because NO asset column is browser-readable --
               production_deliverables_browser_v1 carries 46 columns and not one
               of them is asset-bearing, and deliverables.file_url and
               batches.filming_doc_url both answer 42501 to the browser key. So
               an empty slot on a REAL deliverable means exactly what it means
               on a synthetic parent: this reader cannot see it. Saying Missing
               there asserted, on first paint of every detail open and
               permanently on any refused read, that a post has no filming plan,
               no footage, no folder and no file.
               Permanent for two groups, not transient: any row whose
               client_slug is not an active client (686 live rows, which 403
               unconditionally), and any 401 or network failure.
               A THIRD group was listed here and is gone as of 2026-09-01: a
               creative opening the OTHER team, which staffAssetReadAllowed used
               to refuse. That gate no longer looks at the team, so the largest
               of the three no longer occurs -- and it was the one that made
               this seed load-bearing, since both teams work in here daily. The
               seed stays regardless: the other two still happen, and no slot
               may claim Missing while any of them does.
               Measured 2026-08-30 over the live projection: 5,888 live
               deliverables, 1,340 of them in a batch whose own description
               carries the filming-plan URL the row was calling Missing. */
            const unreadable = !!issue;
            const guidance = issue && issue.syntheticBatchParent === true
                ? PROD_BATCH_ASSET_GUIDANCE
                : PROD_ASSET_UNREAD_GUIDANCE;
            PROD_ASSET_SPECS.forEach(spec => {
                const url = String(values[spec.key] || '').trim();
                /* CHECKING, not `unavailable`, and the difference is a red pill
                   on every first paint.

                   The 2026-08-30 change above was right that `missing` is a
                   false claim here -- the reader cannot see these columns, so
                   it cannot know the slot is empty. But it swung to
                   `unavailable`, which asserts the read was ATTEMPTED AND
                   FAILED. At seed time no read has run. The estate's own three
                   words already separate this cleanly:

                     missing      a fact about the world  (unknowable here)
                     unavailable  a fact about the reader (true only after a
                                  read failed)
                     checking     a fact about the request (true right now)

                   Owner report 2026-08-31: "whenever I change the tab it says
                   checking and everything it says unavailable and then it shows
                   it ... there's like this weird back and forth of refresh that
                   I don't really like." That back-and-forth is this line. Every
                   cache drop -- a tab return, a save, a sibling batch-asset
                   write invalidating the row -- repaints all four slots red
                   before the authenticated read answers a fraction of a second
                   later.

                   Seeding `checking` also makes the failure paths reachable
                   for the first time. Both the no-identity branch and the read
                   catch already do `if (asset.state === 'checking') asset.state
                   = 'unavailable'` -- conversions that could never fire for an
                   empty slot, because it had been born `unavailable` already.
                   The word is now earned by a read that actually failed.

                   EXCEPT ON A SYNTHETIC BATCH PARENT, and the existing
                   first-paint test caught this in review of this very change --
                   which is what it was written for. `checking` is only honest
                   if something is going to check. For a synthetic parent
                   nothing will: it has no deliverable row, the authenticated
                   prober can only answer 403, and _prodEnsureAssets's synthetic
                   branch settles the state and RETURNS WITHOUT REPAINTING. Seed
                   `checking` there and the pill says Checking forever. So the
                   seed follows whether a read is actually coming, which is the
                   same question the two words were always about. */
                const readComing = !(issue && issue.syntheticBatchParent === true);
                let state = url
                    ? 'checking'
                    : (unreadable ? (readComing ? 'checking' : 'unavailable') : 'missing');
                if (url) {
                    try {
                        const parsed = new URL(url);
                        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) state = 'invalid';
                    } catch (e) { state = 'invalid'; }
                }
                assets[spec.key] = {
                    slot: spec.key, url, state, checked_at: '',
                    /* Carried, but only ATTACHED once the state is one the
                       guidance explains. A slot still `checking` has nothing to
                       advise about yet; the failure paths that flip it to
                       `unavailable` set the guidance at the same moment. */
                    guidance: (!url && unreadable && !readComing) ? guidance : '',
                    unreadGuidance: (!url && unreadable) ? guidance : ''
                };
            });
            return assets;
        }
        /* `issue` is optional and purely an economy: _prodIssue is a linear scan
           of every issue on the board, and the scope gate below needs the row.
           Callers that already hold it -- the panel render, the SMM artifact
           gate, the edit handlers -- pass it rather than paying for the lookup
           again. Omitting it is always correct, never faster. */
        function _prodAssetState(id, issue) {
            id = String(id || '');
            let state = _prodState.assets.get(id) || null;
            /* THE USE-TIME SCOPE GATE, and the reason a refresh no longer blanks
               a panel that did not change.

               A completed read is stamped with the scope it was answered under
               (client|team). _prodInvalidateScopedReads used to DELETE every
               cached read on a refresh, which is what walked every row back
               through the skeleton for links that had not moved -- the owner's
               "almost always what's there is there", 2026-08-31. It now
               preserves the values and lets them revalidate in place.

               Preserving is only safe because of this gate. Every surface that
               paints an asset reads it through here, so a value answered for
               one client can never be drawn on a row that now belongs to
               another: the stamp is compared against the row's CURRENT scope at
               the moment of use, which is the one moment the correct answer is
               actually knowable. Inside the invalidation it is not -- that runs
               before the replacement projection is installed.

               An unstamped state has never completed a read, so it holds seeded
               defaults and has nothing to refuse. */
            if (state && state.scopeSignature) {
                const liveIssue = issue || _prodIssue(id);
                if (liveIssue && _prodIssueScopeSignature(liveIssue) !== state.scopeSignature) {
                    if (state.editing || state.saving) {
                        // An open editor or an in-flight save is the user's own
                        // work; the VALUES go, the draft stays.
                        state.assets = _prodAssetDefaultEvidence(liveIssue);
                        state.status = 'idle';
                        state.complete = false;
                        state.error = '';
                        state.remoteChanged = true;
                        state.scopeSignature = '';
                    } else {
                        _prodState.assets.delete(id);
                        state = null;
                    }
                }
            }
            if (!state) {
                state = {
                    status: 'idle',
                    complete: false,
                    assets: _prodAssetDefaultEvidence(_prodIssue(id)),
                    error: '',
                    // The SLOT under edit, or '' for none. See _prodOpenAssetEditor.
                    editing: '',
                    draft: '',
                    requestId: '',
                    sourceEditedAt: '',
                    saving: false,
                    writeError: '',
                    remoteChanged: false,
                    // Set only when a read COMPLETES; see _prodEnsureAssets.
                    scopeSignature: ''
                };
                _prodState.assets.set(id, state);
            }
            return state;
        }
        function _prodAssetSlotLabel(issue, slot) {
            const spec = _prodAssetSpec(slot);
            if (!spec) return String(slot || 'Asset');
            return _prodWriteTeam(issue && issue.team) === 'graphics' && spec.graphicsLabel
                ? spec.graphicsLabel
                : spec.label;
        }
        /* A batch folder is ONE row read by many panels.
           Every sibling deliverable of the same batch has its own cached asset
           read holding the value that just changed, and those caches are what
           the next panel paints from -- so without this, editing Raw footage on
           one sub-issue leaves every other sub-issue of the same post showing
           the old link until something unrelated invalidates it. The row that
           was just written is left alone: its caller re-reads it immediately
           and dropping it here would race that read. */
        function _prodInvalidateBatchAssetReads(issue, writtenId, slot, url) {
            if (!issue) return;
            const keep = String(writtenId || '');
            /* THE POST, NOT THE BATCH ID (2026-09-05).
               This used to drop cached reads for rows whose batchId matched the
               written one, which is precisely the set that does NOT need it on
               a split post: the parent sits on another batch row, so it kept
               painting its stale cached read after a sub-issue write, and every
               sub-issue kept painting theirs after a write from the parent. The
               read resolves these two slots across the whole post now, so the
               rows whose answer just changed are the post's rows -- the parent
               and every sub-issue -- whatever batch row each of them names.
               Same batch row is still covered: a sibling on the shared row is
               also a row of this post. The row that was just written is left
               alone because its caller re-reads it immediately, and dropping it
               here would race that read. */
            const rows = _prodPostRows(issue);
            const writtenSlot = String(slot || '');
            const writtenUrl = String(url || '').trim();
            rows.forEach(row => {
                if (!row || String(row.id) === keep) return;
                const state = _prodState.assets.get(String(row.id));
                if (!state || state.editing || state.saving) return;
                /* Stale, not gone (2026-09-05). These rows used to be deleted,
                   which walked each of them through the skeleton on its next
                   open for a value this browser already knows. The value that
                   just landed is written into the cached slot instead, marked
                   `checking` because the gateway has not yet said what it
                   resolves to, and the state goes idle so the next render
                   re-reads it -- which is when the origin chip and the write
                   target for the slot are learned properly. The other slots
                   did not change and keep saying what they said. */
                if (writtenSlot && state.assets && state.assets[writtenSlot]) {
                    state.assets[writtenSlot] = Object.assign({}, state.assets[writtenSlot], {
                        url: writtenUrl,
                        state: 'checking',
                        checked_at: '',
                        http_status: null,
                        guidance: ''
                    });
                }
                state.status = 'idle';
                state.complete = false;
                state.error = '';
                state.remoteChanged = true;
            });
        }
        /* Every row of the post `issue` belongs to: its parent (or itself, when
           it is the parent) and all of that row's children, plus any sibling
           sharing its batch row. Deliberately built from the projection the
           reader can already see rather than asked for -- the gateway resolves
           the same post server-side, and this only decides which cached reads
           to drop, so a row this misses is re-read on its next open rather than
           shown wrong. */
        function _prodPostRows(issue) {
            if (!issue) return [];
            const seen = new Map();
            const add = row => { if (row && row.id && !seen.has(row.id)) seen.set(row.id, row); };
            add(issue);
            const root = issue.parent ? _prodIssue(issue.parent) : issue;
            if (root) {
                add(root);
                _prodChildrenOf(root.id).forEach(add);
            }
            const batchId = String(issue.batchId || '').trim();
            if (batchId) {
                _prodIssues().forEach(row => {
                    if (row && String(row.batchId || '') === batchId) add(row);
                });
            }
            return Array.from(seen.values());
        }
        /* The file links behind the sub-issue pills, one request per batch.
           Deliberately quiet: a failure leaves the pills absent rather than
           putting a banner on a list, because the pill is a shortcut and every
           sub-issue still shows its own file when opened. */
        async function _prodEnsureBatchFiles(batchId, clientSlug) {
            batchId = String(batchId || '').trim();
            clientSlug = String(clientSlug || '').trim();
            if (!batchId || !clientSlug) return null;
            const generation = _prodState.projectionGeneration;
            /* KEYED BY BATCH **AND SCOPE**. The read is answered per
               (batch_id, client_slug) and the gateway refuses a mismatch with a
               flat 403, so a key of batch id alone lets one scope's answer --
               or one scope's refusal -- stand in for another's. Harmless while
               this was asked once per open row; not once it is asked once per
               batch row of a post, where two rows can legitimately declare
               different scopes for the same batch. Same shape as
               _prodIssueScopeSignature, for the same reason. */
            const statusKey = batchId + '\u0000' + clientSlug;
            const current = _prodState.batchFilesStatus.get(statusKey);
            if (current && current.generation === generation) return current;
            const staffIdentity = _syncviewStaffIdentityForHeaders();
            if (!staffIdentity) return null;
            /* Ask only what this deploy said it can answer. The asset read runs
               first on every detail open and carries the list; before the
               gateway ships, the pills are simply absent, which is the honest
               state of a feature that is not live yet -- and no doomed request
               is made to discover it. */
            if (!_prodState.gatewayReads || !_prodState.gatewayReads.has('batch_files_read')) return null;
            const record = { generation, status: 'loading' };
            _prodState.batchFilesStatus.set(statusKey, record);
            try {
                const response = await fetch(PROD_WRITE_EF_URL, {
                    method: 'POST',
                    cache: 'no-store',
                    headers: _syncviewEfHeaders({
                        apikey: CAL_SUPABASE_ANON_KEY,
                        Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY,
                        Accept: 'application/json',
                        'Content-Type': 'application/json'
                    }, PROD_WRITE_EF_URL),
                    body: JSON.stringify({
                        action: 'batch_files_read',
                        surface: 'production',
                        batch_id: batchId,
                        client_slug: clientSlug
                    })
                });
                const json = await response.json().catch(() => ({}));
                // A response that landed after a projection swap describes rows
                // that may no longer exist; drop it rather than paint from it.
                if (generation !== _prodState.projectionGeneration) return null;
                if (!response.ok || !json || json.ok !== true || !Array.isArray(json.files)
                    || String(json.batch_id || '') !== batchId) {
                    record.status = 'error';
                    return record;
                }
                const kept = new Set();
                json.files.forEach(file => {
                    const id = String(file && file.id || '');
                    const url = String(file && file.url || '').trim();
                    if (!id || !url) return;
                    kept.add(id);
                    _prodState.batchFiles.set(id, {
                        url,
                        source: ['deliverable','calendar_card','samples_card'].includes(String(file.source || ''))
                            ? String(file.source) : '',
                        /* The batch row and scope this pill was answered for,
                           so _prodBatchFileFor can refuse it once the row it
                           is drawn on has moved. Entries survive a refresh now
                           (2026-09-05); this is what makes that safe. */
                        batchId,
                        scope: clientSlug
                    });
                });
                /* EVICT what this batch no longer names (Codex P1 on #1305).
                   Entries survive a refresh now, so this read is the only
                   thing that can take a pill DOWN -- and batch_files_read
                   deliberately omits a deliverable whose file was cleared.
                   Upserting the returned rows alone left the cleared file's
                   pill up for the rest of the session, pointing at a link the
                   row no longer holds. So every entry this batch and scope
                   answered for earlier, and which this answer does not name,
                   goes. Entries answered for another batch are not this
                   read's to judge; a row that moved batches is caught here
                   too, because its old batch stops naming it. */
                _prodState.batchFiles.forEach((entry, id) => {
                    if (entry && entry.batchId === batchId && entry.scope === clientSlug && !kept.has(id)) {
                        _prodState.batchFiles.delete(id);
                    }
                });
                record.status = 'ready';
                _prodRefreshAssetSurfaces();
                return record;
            } catch (error) {
                if (generation === _prodState.projectionGeneration) record.status = 'error';
                return record;
            }
        }
        function _prodBatchFileFor(id, row) {
            const entry = _prodState.batchFiles.get(String(id || ''));
            if (!entry || !entry.url) return null;
            /* THE USE-TIME GATE FOR PILLS, the same one _prodAssetState applies
               to the panel. Entries survive a refresh now, so the question "is
               this still the file for this row" is asked where it can be
               answered: against the row as it is drawn. A row that left the
               batch it was answered for, or whose declared scope is no longer
               the one the read was made under, gets no pill until the re-ask
               lands. A row declaring no scope, or a sentinel, was never the
               scope the request carried and is judged on the batch alone. */
            const live = row || _prodIssue(id);
            if (live) {
                if (entry.batchId && String(live.batchId || '').trim() !== entry.batchId) return null;
                const scope = String(live.authorityProject || live.storedClientSlug || '').trim();
                if (entry.scope && scope && scope !== PROD_ATTRIBUTION_NEEDS
                    && scope !== PROD_ATTRIBUTION_CONFLICT && scope !== entry.scope) return null;
            }
            return entry;
        }
        /* The scope an authenticated per-row read is answered under: the client
           the row is attributed to, and the team that attribution runs through.
           Three places have to agree on it -- _prodEnsureAssets and
           _prodEnsureDescription re-check it before letting a response LAND,
           and _prodLoadTerminalTail re-checks it before letting an
           already-landed value be RE-RENDERED. It was written out by hand in
           the first two and absent from the third; one definition is what stops
           those drifting apart again. */
        function _prodIssueScopeSignature(issue) {
            if (!issue) return '';
            const clientSlug = String(issue.authorityProject || issue.storedClientSlug || issue.project || '').trim();
            return clientSlug + '\u0000' + _prodWriteTeam(issue.team);
        }
        function _prodScopeSignatures(adapter) {
            const map = new Map();
            ((adapter && adapter.ISSUES) || []).forEach(issue => {
                const id = String(issue && issue.id || '');
                if (id) map.set(id, _prodIssueScopeSignature(issue));
            });
            return map;
        }
        function _prodNextAssetRequestToken(id) {
            id = String(id || '');
            const token = Number(_prodState.assetRequestTokens.get(id) || 0) + 1;
            _prodState.assetRequestTokens.set(id, token);
            return token;
        }
        function _prodAssetReadErrorText(error) {
            const code = String(error && (error.code || error.message) || '');
            if (error && error.status === 401) return 'Staff sign-in expired. Sign in again to check asset access.';
            if (error && error.status === 403) return 'This staff account cannot read assets for this issue.';
            if (code === 'asset_evidence_unavailable') return 'Asset access evidence could not be saved. Retry the check.';
            return 'Asset access could not be verified. Retry before relying on these links.';
        }
        function _prodRefreshAssetSurfaces() {
            if (document.getElementById('prodRoot')) _prodRender();
        }
        function _prodRefreshAssetsManual(id) {
            // Button-only wrapper: _prodEnsureAssets has several programmatic
            // callers that must stay silent, but the visible Refresh access
            // press needs an acknowledgement like every other manual refresh.
            _prodToast('Rechecking asset access\u2026');
            _prodEnsureAssets(id, true, { recheck: true });
            return false;
        }
        async function _prodEnsureAssets(id, force, opts) {
            id = String(id || '');
            const recheck = !!(opts && opts.recheck);
            const issue = _prodIssue(id);
            if (!issue) return null;
            if (issue.syntheticBatchParent === true) {
                // A batch parent has no deliverable row, so the authenticated
                // asset prober can only answer 403. Its links come straight
                // from the batch row; show them as plain links, no probing.
                const state = _prodAssetState(id);
                Object.values(state.assets).forEach(asset => {
                    if (asset.url && asset.state === 'checking') asset.state = 'available';
                    else if (!asset.url) {
                        // These three slots live on the BATCH row, and the
                        // browser grant deliberately excludes the typed asset
                        // columns (see the f34/f53 migration), so the projection
                        // above always reads undefined here. It is not that the
                        // post has no plan -- it is that this reader cannot see
                        // it, and the sub-issue can. Saying Missing asserts a
                        // fact about the world that is false; Unavailable
                        // asserts a fact about the reader, which is true.
                        // Measured 2026-08-30 across all batches and
                        // deliverables, with the same liveness filter the
                        // adapter applies: 199 synthetic batch parents, 189 of
                        // them carrying a URL in the description printed three
                        // inches above a grid that said Missing.
                        asset.state = 'unavailable';
                        asset.guidance = PROD_BATCH_ASSET_GUIDANCE;
                    }
                });
                state.status = 'ready';
                state.complete = true;
                state.error = '';
                /* STAMPED, even though no read happened.
                   These four values come off the BATCH row, and a batch can be
                   re-scoped by a projection swap exactly like a deliverable
                   can. Marking the state complete without a stamp would let it
                   be preserved through an invalidation and then skip the
                   use-time gate -- which reads an absent stamp as "nothing was
                   ever read here, so there is nothing to refuse". Raised on
                   #1201 review; the synthetic branch was the one path that
                   reached `complete` without going through the read. */
                state.scopeSignature = _prodIssueScopeSignature(issue);
                return state;
            }
            const clientSlug = String(issue.authorityProject || issue.storedClientSlug || issue.project || '').trim();
            const issueTeam = _prodWriteTeam(issue.team);
            const projectionGeneration = _prodState.projectionGeneration;
            const current = _prodAssetState(id);
            if (_prodState.writes.has(id + ':attachment')) return current;
            if (!force && (current.status === 'loading' || current.status === 'ready' || current.status === 'error')) return current;
            /* NOT WHILE A PROJECTION LOAD IS IN FLIGHT (2026-09-05).
               A tab return runs _prodRefresh, which marks every stamped read
               idle and starts _prodLoadData; the swap at the end of that load
               marks them idle AGAIN and bumps every request token. A read
               started between the two is refused on landing by
               requestStillCurrent() -- a gateway round trip, four provider
               probes and a "Checking…" button, all for an answer that is
               thrown away -- and the render after the swap starts the one that
               counts. So a row that already holds a stamped answer waits for
               the swap. A row that has never been read does not, because a
               first paint should not queue behind a background refresh, and a
               forced press never does. `refreshing` is cleared on both the
               success and the failure path of _prodLoadData, so this cannot
               wedge; the worst a stale flag could cost is one refresh's worth
               of not re-reading, which Refresh access overrides. */
            if (!force && _prodState.refreshing && current.scopeSignature) return current;
            const staffIdentity = _syncviewStaffIdentityForHeaders();
            if (!staffIdentity) {
                current.status = 'error';
                current.complete = false;
                current.error = 'Staff sign-in is required to check asset access.';
                Object.values(current.assets).forEach(asset => {
                    // A slot the read never resolved is unreadable, and says so
                    // rather than leaving a bare pill with no explanation.
                    if (asset.state === 'checking') {
                        // NOW the word is earned: a read was attempted and did
                        // not resolve this slot. The guidance seeded at build
                        // time is attached here, at the moment it becomes true.
                        asset.state = 'unavailable';
                        if (!String(asset.url || '').trim() && !String(asset.guidance || '').trim()) {
                            asset.guidance = String(asset.unreadGuidance || '') || PROD_ASSET_UNREAD_GUIDANCE;
                        }
                    }
                });
                _prodState.assets.set(id, current);
                _prodRefreshAssetSurfaces();
                return current;
            }
            const verificationEpoch = _syncviewStaffVerificationEpoch;
            const identitySignature = _syncviewStaffIdentitySignature(staffIdentity);
            const requestToken = _prodNextAssetRequestToken(id);
            const scopeSignature = _prodIssueScopeSignature(issue);
            const requestStillCurrent = () => {
                const liveIssue = _prodIssue(id);
                return verificationEpoch === _syncviewStaffVerificationEpoch
                    && identitySignature === _syncviewStaffIdentitySignature(_syncviewStaffIdentityForHeaders())
                    && requestToken === _prodState.assetRequestTokens.get(id)
                    && projectionGeneration === _prodState.projectionGeneration
                    && !!liveIssue
                    && _prodIssueScopeSignature(liveIssue) === scopeSignature;
            };
            current.status = 'loading';
            current.complete = false;
            current.error = '';
            _prodState.assets.set(id, current);
            _prodRefreshAssetSurfaces();
            try {
                const response = await fetch(PROD_WRITE_EF_URL, {
                    method: 'POST',
                    cache: 'no-store',
                    headers: _syncviewEfHeaders({
                        apikey: CAL_SUPABASE_ANON_KEY,
                        Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY,
                        Accept: 'application/json',
                        'Content-Type': 'application/json'
                    }, PROD_WRITE_EF_URL),
                    body: JSON.stringify({
                        action: 'asset_access_read',
                        surface: 'production',
                        id,
                        client_slug: clientSlug,
                        /* Only the Refresh access button sends this. The
                           gateway reuses a verdict it recorded for the same
                           URL within the last few minutes rather than probing
                           the provider on every read; the button is pressed
                           AFTER someone fixes sharing on a folder, and the held
                           verdict is exactly what they need to get past. An
                           older gateway ignores the field and probes anyway. */
                        ...(recheck ? { recheck: true } : {})
                    })
                });
                const json = await response.json().catch(() => ({}));
                if (!requestStillCurrent()) return null;
                if (!response.ok || !json || json.ok !== true || json.complete !== true
                    || String(json.id || '') !== id
                    || String(json.client_slug || '').trim() !== clientSlug
                    || _prodWriteTeam(json.team) !== issueTeam
                    || !Array.isArray(json.assets)) {
                    const error = new Error(String(json && json.error || 'asset_read_failed'));
                    error.status = response.status;
                    error.code = String(json && json.error || 'asset_read_failed');
                    throw error;
                }
                const next = _prodAssetDefaultEvidence(issue);
                json.assets.forEach(asset => {
                    const slot = String(asset && asset.slot || '');
                    if (!next[slot]) return;
                    const state = String(asset.state || '');
                    next[slot] = Object.assign({}, next[slot], {
                        url: String(asset.url || '').trim(),
                        state: ['missing','invalid','checking','available','expired','permission_denied','unavailable'].includes(state) ? state : 'unavailable',
                        url_type: String(asset.url_type || ''),
                        checked_at: String(asset.checked_at || ''),
                        guidance: String(asset.guidance || ''),
                        /* Where the value came from, when it did not come
                           from the row itself. A deliverable with no file of
                           its own shows the link on the card bound to it,
                           because for the team that pasted it that IS this
                           file; a batch with no filming plan of its own shows
                           the CLIENT's plan, which is where the batch's copy
                           came from in the first place. Either way a row must
                           say so rather than present a derived value as its
                           own. Closed vocabulary, so a surprising value renders
                           nothing instead of arbitrary server text. */
                        source: ['deliverable','calendar_card','samples_card','client_plan','post']
                            .includes(String(asset.source || '')) ? String(asset.source) : '',
                        /* WHERE THIS SLOT SHOULD BE WRITTEN, learned from the
                           read. The two folder links belong to the POST, whose
                           rows can sit on several batch rows -- and the post's
                           slots can sit on DIFFERENT ones, so this is per slot
                           rather than per panel. Empty against a gateway that
                           predates the field, and empty when the gateway has
                           nothing safe to offer; both fall back to the open
                           row's own batch, which is what shipped before. */
                        writeBatchId: String(asset.write_batch_id || '').trim(),
                        writeBatchUpdatedAt: String(asset.write_batch_updated_at || '').trim(),
                        http_status: Number(asset.http_status) || null
                    });
                });
                /* What THIS deploy of the gateway can answer. The page
                   reaches main through Pages the instant a PR merges and the
                   function is deployed by hand afterwards, so the page is
                   routinely newer than the gateway. A read the deploy has never
                   heard of would 400 on every attempt -- a failed request in
                   the console and in the live polish lane, for a feature that
                   is merely not deployed yet. Absent field means an older
                   deploy, which is exactly the case to stay quiet for. */
                _prodState.gatewayReads = new Set(
                    Array.isArray(json.capabilities)
                        ? json.capabilities.map(name => String(name || ''))
                        : []
                );
                current.status = 'ready';
                current.complete = true;
                current.assets = next;
                current.error = '';
                /* The scope this answer is true for. requestStillCurrent() has
                   just re-checked it, so it is the row's scope at the moment
                   the value landed -- and _prodAssetState refuses to draw the
                   value if the row has moved out of it since. */
                current.scopeSignature = scopeSignature;
                _prodState.assets.set(id, current);
                _prodRefreshAssetSurfaces();
                return current;
            } catch (error) {
                if (!requestStillCurrent()) return null;
                current.status = 'error';
                current.complete = false;
                current.error = _prodAssetReadErrorText(error);
                Object.values(current.assets).forEach(asset => {
                    // A slot the read never resolved is unreadable, and says so
                    // rather than leaving a bare pill with no explanation.
                    if (asset.state === 'checking') {
                        // NOW the word is earned: a read was attempted and did
                        // not resolve this slot. The guidance seeded at build
                        // time is attached here, at the moment it becomes true.
                        asset.state = 'unavailable';
                        if (!String(asset.url || '').trim() && !String(asset.guidance || '').trim()) {
                            asset.guidance = String(asset.unreadGuidance || '') || PROD_ASSET_UNREAD_GUIDANCE;
                        }
                    }
                });
                _prodState.assets.set(id, current);
                _prodRefreshAssetSurfaces();
                return current;
            }
        }
        /* `editing` names the SLOT being edited, not merely that an editor is
           open. It used to be a boolean because there was exactly one writable
           slot; raw footage and the frame folder made that assumption false,
           and a boolean would have let a Raw footage edit save itself into the
           deliverable file. The empty string means no editor. */
        function _prodOpenAssetEditor(id, slot) {
            const state = _prodAssetState(id);
            slot = String(slot || 'deliverable_file');
            state.editing = slot;
            state.draft = String(state.assets && state.assets[slot]
                && state.assets[slot].url || '');
            state.requestId = '';
            state.sourceEditedAt = '';
            state.writeError = '';
            state.remoteChanged = false;
            _prodRefreshAssetSurfaces();
            setTimeout(() => document.querySelector('[data-prod-asset-input="' + CSS.escape(String(id)) + '"]')?.focus(), 0);
        }
        function _prodBeginAssetEdit(id, slot) {
            const issue = _prodIssue(id);
            const state = _prodAssetState(id, issue);
            slot = String(slot || 'deliverable_file');
            const operation = _prodAssetWriteOperation(slot);
            /* A slot with no operation is not a permission failure, it is a
               slot that nothing in the product may write -- the filming plan.
               Saying so is the honest answer; a write-gate sentence would
               imply some other role could. */
            if (!operation) {
                _prodToast('The filming plan comes from the filming-plans source and is not editable here.');
                return false;
            }
            /* One gate, no second copy: _prodCanWrite is the authority and it
               answers for video now too. The old team clause here was a second
               rule that could disagree with the renderer -- exactly the drift
               that let the panel offer nothing AND say nothing on a video row. */
            if (!issue || !_prodCanWrite(issue, operation)) {
                _prodToast(_prodWriteGateText(issue, operation) || 'This asset cannot be edited here.');
                return false;
            }
            if (operation === 'batch_asset' && !String(issue.batchId || '').trim()) {
                _prodToast('This issue is not attached to a batch, so it has no shared folders to edit.');
                return false;
            }
            if (state.status !== 'ready' || state.complete !== true) {
                /* An unread asset state is not a refusal.
                 *
                 * Every projection refresh calls _prodInvalidateScopedReads,
                 * which DELETES asset state for any row that is not mid-edit --
                 * while the rendered panel keeps showing the values from the
                 * last read. So a click seconds after a background refresh
                 * lands on a state that is merely UNREAD, and the reader was
                 * told to "refresh protected asset access" about a panel that
                 * looks perfectly ready. Reported 2026-08-25 by the graphics
                 * designer as simply being unable to attach a link.
                 *
                 * A genuine read FAILURE still says so, with the real reason.
                 * Anything else loads and then opens, so the click does what it
                 * looks like it does.
                 */
                if (state.status === 'error') {
                    _prodToast(state.error || 'Refresh protected asset access before replacing the canonical deliverable.');
                    _prodEnsureAssets(id, true);
                    return false;
                }
                Promise.resolve(_prodEnsureAssets(id, true)).then(fresh => {
                    // The reader may have navigated, or the row may have lost
                    // its write gate, during the read.
                    const liveIssue = _prodIssue(id);
                    /* This re-check was still spelled `!== 'graphics'` after
                       attach opened to video, so a video row that took the
                       LOAD-then-open path -- the ordinary path, any time a
                       background refresh had wiped the read -- passed every
                       visible gate and then silently never opened. The one
                       gate is _prodCanWrite, here as everywhere else. */
                    if (!liveIssue || !_prodCanWrite(liveIssue, operation)) return;
                    if (!fresh || fresh.status !== 'ready' || fresh.complete !== true) {
                        _prodToast((fresh && fresh.error)
                            || 'Refresh protected asset access before replacing the canonical deliverable.');
                        return;
                    }
                    _prodOpenAssetEditor(id, slot);
                }).catch(() => {});
                return false;
            }
            _prodOpenAssetEditor(id, slot);
            return false;
        }
        function _prodAssetDraftInput(id, value) {
            const state = _prodAssetState(id);
            value = String(value || '');
            if (state.draft !== value) {
                state.requestId = '';
                state.sourceEditedAt = '';
            }
            state.draft = value;
        }
        function _prodCancelAssetEdit(id) {
            const state = _prodAssetState(id);
            if (state.saving) return false;
            state.editing = '';
            state.draft = '';
            state.requestId = '';
            state.sourceEditedAt = '';
            state.writeError = '';
            state.remoteChanged = false;
            _prodRefreshAssetSurfaces();
            return false;
        }
        async function _prodSaveAsset(event, id) {
            if (event) event.preventDefault();
            const issue = _prodIssue(id);
            const state = _prodAssetState(id, issue);
            if (!issue || state.saving) return false;
            const slot = String(state.editing || '');
            const operation = _prodAssetWriteOperation(slot);
            if (!operation) return false;
            const value = String(state.draft || '').trim();
            /* A batch folder may be CLEARED. A wrong folder link was unfixable
               from every seat in the product until this shipped, and refusing
               the erase would leave half of that problem standing. The
               canonical deliverable still requires a value: clearing it is
               what the calendar remove-link control is for, and it carries its
               own confirmation about what actually happens next. */
            if (!value && operation !== 'batch_asset') {
                state.writeError = 'Paste or select a deliverable link first.';
                _prodRefreshAssetSurfaces();
                return false;
            }
            if (!state.requestId || !state.sourceEditedAt) {
                state.requestId = _prodWriteRequestId(operation);
                state.sourceEditedAt = new Date().toISOString();
            }
            state.saving = true;
            state.writeError = '';
            _prodRefreshAssetSurfaces();
            try {
                const result = await _prodGatewayWrite(
                    issue,
                    operation,
                    operation === 'batch_asset' ? { slot, url: value } : { file_url: value },
                    state.requestId,
                    state.sourceEditedAt
                );
                if (!result) return false;
                state.editing = '';
                state.draft = '';
                state.requestId = '';
                state.sourceEditedAt = '';
                state.saving = false;
                state.writeError = '';
                state.remoteChanged = false;
                _prodToast(operation === 'batch_asset'
                    ? (value
                        ? _prodAssetSlotLabel(issue, slot) + ' updated for the whole post'
                        : _prodAssetSlotLabel(issue, slot) + ' cleared for the whole post')
                    : 'Canonical deliverable attached');
                if (operation === 'batch_asset') _prodInvalidateBatchAssetReads(issue, id, slot, value);
                await _prodEnsureAssets(id, true);
            } catch (error) {
                _writeUiRecordFailure('production', String(operation || 'asset'), error, { id: String(id) });
                state.saving = false;
                const conflictRow = String(error && error.code || '') === 'write_conflict'
                    && error && error.row
                    && Object.prototype.hasOwnProperty.call(error.row, 'file_url')
                    ? error.row
                    : null;
                if (conflictRow) {
                    const winningUrl = String(conflictRow.file_url || '').trim();
                    state.assets.deliverable_file = Object.assign(
                        {},
                        state.assets.deliverable_file || {},
                        { url: winningUrl, state: winningUrl ? 'checking' : 'missing', checked_at: '' }
                    );
                    state.status = 'idle';
                    state.complete = false;
                    state.requestId = '';
                    state.sourceEditedAt = '';
                    state.remoteChanged = true;
                    state.writeError = 'This issue changed elsewhere. The winning link was reloaded; your attempted link is still in the editor.';
                    await _prodEnsureAssets(id, true);
                } else {
                    state.writeError = _prodWriteErrorText(error, issue, operation);
                }
                _prodToast(state.writeError);
                _prodRefreshAssetSurfaces();
            }
            return false;
        }
        function _prodArchiveDefaultState() {
            const issue = _prodState.openId ? _prodIssue(_prodState.openId) : null;
            const identity = _syncviewStaffIdentityForHeaders();
            const memberTeam = _prodWriteTeam(identity && identity.member && identity.member.team);
            const clientSlug = String(
                issue && (issue.authorityProject || issue.storedClientSlug || issue.project)
                || _prodState.openProjectId
                || _prodState.clientSlug
                || (_prodClients()[0] && _prodClients()[0].id)
                || ''
            );
            return {
                clientSlug,
                team: memberTeam || 'graphics',
                audience: 'internal',
                issues: [],
                hasMore: false,
                cursor: '',
                loading: false,
                error: '',
                listRetryAppend: false,
                selectedId: '',
                detail: null,
                detailLoading: false,
                detailError: '',
                detailRetryAppend: false,
                scopeGeneration: 1,
                listRequestToken: 0,
                detailRequestToken: 0
            };
        }
        async function _prodArchiveRequest(body) {
            const response = await fetch(PROD_ARCHIVE_EF_URL, {
                method: 'POST',
                cache: 'no-store',
                headers: _syncviewEfHeaders({
                    apikey: CAL_SUPABASE_ANON_KEY,
                    Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY,
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                }, PROD_ARCHIVE_EF_URL),
                body: JSON.stringify(body)
            });
            const json = await response.json().catch(() => ({}));
            if (!response.ok || !json || json.ok !== true) {
                const error = new Error(String(json && json.error || 'archive_read_failed'));
                error.status = response.status;
                throw error;
            }
            return json;
        }
        function _prodArchiveErrorText(error) {
            if (error && error.status === 401) return 'Staff sign-in expired. Sign in again to review archive repairs.';
            if (error && error.status === 403) return 'This staff account cannot review that archive scope.';
            return 'Archive repair history could not be loaded.';
        }
        function _prodArchiveScopeSignature(state) {
            return [
                String(state && state.clientSlug || ''),
                String(state && state.team || ''),
                String(state && state.audience || '')
            ].join('\u0000');
        }
        function _prodArchiveScopeChange(field, value) {
            const state = _prodState.archiveRepair;
            if (!state || !['clientSlug','team','audience'].includes(field)) return;
            state[field] = String(value || '');
            state.scopeGeneration = Number(state.scopeGeneration || 0) + 1;
            state.listRequestToken = Number(state.listRequestToken || 0) + 1;
            state.detailRequestToken = Number(state.detailRequestToken || 0) + 1;
            state.loading = false;
            state.detailLoading = false;
            state.issues = [];
            state.cursor = '';
            state.hasMore = false;
            state.selectedId = '';
            state.detail = null;
            state.error = '';
            state.detailError = '';
            state.listRetryAppend = false;
            state.detailRetryAppend = false;
            _prodRenderArchiveRepair();
            _prodArchiveLoadList(false);
        }
        function _prodArchiveListHTML(state) {
            const items = (state.issues || []).map(issue => '<button class="prod-archive-item' + (state.selectedId === issue.linear_uuid ? ' is-active' : '') + '" type="button" onclick="return _prodArchiveOpenIssue(' + _jsAttrArg(issue.linear_uuid) + ',false)">'
                + '<b>' + _calEsc(issue.title || issue.identifier || 'Archived issue') + '</b>'
                + '<span>' + _calEsc([issue.identifier, _prodTeamLabel(_prodWriteTeam(issue.team)), issue.state].filter(Boolean).join(' · ')) + '</span></button>').join('');
            if (state.loading && !items) return '<div class="prod-asset-value">Loading archived issues…</div>';
            return items || '<div class="prod-asset-value">No archived issues in this repair scope.</div>';
        }
        function _prodArchiveDetailHTML(state) {
            if (state.detailLoading && !state.detail) return '<div class="prod-asset-value">Loading protected history…</div>';
            if (state.detailError) return '<div class="prod-assets-error">' + _calEsc(state.detailError)
                + ' <button class="prod-archive-more" type="button" onclick="return _prodArchiveOpenIssue('
                + _jsAttrArg(state.selectedId) + ',' + (state.detailRetryAppend ? 'true' : 'false')
                + ')">Retry</button></div>';
            const detail = state.detail;
            if (!detail) return '<div class="prod-asset-value">Choose an archived issue to review rescued and unresolved assets.</div>';
            const issue = detail.issue || {};
            const refs = (detail.refs || []).map(ref => '<div class="prod-archive-ref" data-prod-archive-ref="' + _calEscAttr(ref.ref_id || '') + '">'
                + '<div><b>' + _calEsc(String(ref.source_kind || '').replace(/_/g, ' ')) + '</b> <span class="prod-asset-state" data-state="' + _calEscAttr(ref.state || 'unavailable') + '">' + _calEsc(_prodAssetStateLabel(ref.state)) + '</span></div>'
                + '<code>Original SHA-256: ' + _calEsc(ref.original_url_sha256 || '') + '</code>'
                + (ref.rescued_url ? '<div><a href="' + _calEscAttr(ref.rescued_url) + '" target="_blank" rel="noopener noreferrer">Open rescued private copy</a></div>' : '<div class="prod-asset-value">Awaiting rescue or owner disposition</div>')
                + '</div>').join('');
            const comments = (detail.comments || []).map(comment => '<div class="prod-archive-comment"><b>' + _calEsc(comment.author_name || 'Archived comment') + '</b><div>' + _prodLinkify(comment.body || '') + '</div></div>').join('');
            const legacy = (detail.legacyComments || []).map(comment => '<div class="prod-archive-comment"><b>Legacy archive comment</b><div>' + _prodLinkify(typeof comment === 'string' ? comment : JSON.stringify(comment)) + '</div></div>').join('');
            const more = detail.hasMore
                ? '<button class="prod-archive-more" type="button" onclick="return _prodArchiveOpenIssue(' + _jsAttrArg(state.selectedId) + ',true)">Load more protected history</button>'
                : '';
            return '<h3>' + _calEsc(issue.title || issue.identifier || 'Archived issue') + '</h3>'
                + '<div class="prod-asset-value">' + _calEsc([issue.identifier, issue.state, issue.archived_at].filter(Boolean).join(' · ')) + '</div>'
                + '<h4>Asset rescue records</h4>' + (refs || '<div class="prod-asset-value">No private Linear asset references recorded.</div>')
                + (comments || legacy ? '<h4>History comments</h4>' + comments + legacy : '') + more;
        }
        function _prodRenderArchiveRepair() {
            const layer = document.getElementById('prodLayer');
            const state = _prodState.archiveRepair;
            if (!layer || !state) return;
            const clientItems = _prodClients().map(client => ({ value: client.id, label: client.name || client.id }));
            const teamItems = [{ value: 'graphics', label: 'Graphics' }, { value: 'video', label: 'Video' }];
            const audienceItems = [
                { value: 'internal', label: 'Staff view (all visibility)' },
                { value: 'client', label: 'Client-visible only' }
            ];
            layer.innerHTML = '<div class="prod-create-bd" data-prod-archive-backdrop="1" data-backdrop-dismiss><div class="prod-create-modal prod-archive-modal" data-prod-archive-modal="1">'
                + '<div class="prod-create-head"><div><h2>Archive asset repair</h2><p>Protected history · original private Linear URLs are never displayed</p></div><span class="prod-spacer"></span><button class="prod-create-close" type="button" onclick="_prodCloseArchiveRepair()" aria-label="Close">&times;</button></div>'
                + '<div class="prod-archive-controls"><div class="prod-create-field"><label>Roster client</label>' + _svSelectHtml('prodArchiveClient', clientItems, state.clientSlug, 'Choose client', { onchange: '_prodArchiveScopeChange("clientSlug",this.value)' }) + '</div>'
                + '<div class="prod-create-field"><label>Team</label>' + _svSelectHtml('prodArchiveTeam', teamItems, state.team, 'Choose team', { onchange: '_prodArchiveScopeChange("team",this.value)' }) + '</div>'
                + '<div class="prod-create-field"><label>Audience view</label>' + _svSelectHtml('prodArchiveAudience', audienceItems, state.audience, 'Choose view', { onchange: '_prodArchiveScopeChange("audience",this.value)' }) + '</div></div>'
                + '<div class="prod-archive-body"><div class="prod-archive-list">' + _prodArchiveListHTML(state)
                + (state.error ? '<div class="prod-assets-error">' + _calEsc(state.error)
                    + ' <button class="prod-archive-more" type="button" onclick="return _prodArchiveLoadList('
                    + (state.listRetryAppend ? 'true' : 'false') + ')">Retry</button></div>' : '')
                + (state.hasMore ? '<button class="prod-archive-more" type="button" onclick="return _prodArchiveLoadList(true)">Load more issues</button>' : '')
                + '</div><div class="prod-archive-detail">' + _prodArchiveDetailHTML(state) + '</div></div></div></div>';
            layer.style.pointerEvents = 'auto';
            const backdrop = layer.querySelector('[data-prod-archive-backdrop]');
            if (backdrop) backdrop.addEventListener('click', event => {
                if (event.target === backdrop && backdrop._backdropPressBegan) _prodCloseArchiveRepair();
            });
        }
        async function _prodArchiveLoadList(append) {
            const state = _prodState.archiveRepair;
            if (!state || state.loading || !state.clientSlug) return false;
            const verificationEpoch = _syncviewStaffVerificationEpoch;
            const generation = Number(state.scopeGeneration || 0);
            const scopeSignature = _prodArchiveScopeSignature(state);
            const requestToken = Number(state.listRequestToken || 0) + 1;
            state.listRequestToken = requestToken;
            // A staff sign-out/invalidation between request and response must not
            // populate the modal — bind the response to the current verification
            // epoch, as the protected asset reads do.
            const requestStillCurrent = () => _prodState.archiveRepair === state
                && verificationEpoch === _syncviewStaffVerificationEpoch
                && Number(state.scopeGeneration || 0) === generation
                && Number(state.listRequestToken || 0) === requestToken
                && _prodArchiveScopeSignature(state) === scopeSignature;
            state.loading = true;
            state.error = '';
            _prodRenderArchiveRepair();
            try {
                const json = await _prodArchiveRequest({
                    action: 'list',
                    client_slug: state.clientSlug,
                    team: state.team,
                    audience: state.audience,
                    limit: 30,
                    after: append ? state.cursor : null
                });
                if (!requestStillCurrent()) return false;
                state.issues = append ? state.issues.concat(json.issues || []) : (json.issues || []);
                state.cursor = String(json.next_cursor || '');
                state.hasMore = json.has_more === true;
                state.listRetryAppend = false;
            } catch (error) {
                if (!requestStillCurrent()) return false;
                state.error = _prodArchiveErrorText(error);
                state.listRetryAppend = append === true;
            } finally {
                if (requestStillCurrent()) {
                    state.loading = false;
                    _prodRenderArchiveRepair();
                }
            }
            return false;
        }
        async function _prodArchiveOpenIssue(linearUuid, append) {
            const state = _prodState.archiveRepair;
            if (!state || (state.detailLoading && append)) return false;
            if (!append) {
                state.selectedId = String(linearUuid || '');
                state.detail = null;
            }
            const existing = state.detail;
            const verificationEpoch = _syncviewStaffVerificationEpoch;
            const generation = Number(state.scopeGeneration || 0);
            const scopeSignature = _prodArchiveScopeSignature(state);
            const selectedId = String(state.selectedId || '');
            const requestToken = Number(state.detailRequestToken || 0) + 1;
            state.detailRequestToken = requestToken;
            // Bind the protected-history response to the current verification
            // epoch so a sign-out mid-flight cannot render rescued private links.
            const requestStillCurrent = () => _prodState.archiveRepair === state
                && verificationEpoch === _syncviewStaffVerificationEpoch
                && Number(state.scopeGeneration || 0) === generation
                && Number(state.detailRequestToken || 0) === requestToken
                && String(state.selectedId || '') === selectedId
                && _prodArchiveScopeSignature(state) === scopeSignature;
            state.detailLoading = true;
            state.detailError = '';
            _prodRenderArchiveRepair();
            try {
                const json = await _prodArchiveRequest({
                    action: 'issue',
                    client_slug: state.clientSlug,
                    team: state.team,
                    audience: state.audience,
                    linear_uuid: selectedId,
                    limit: 30,
                    comment_after: append && existing ? existing.commentCursor : null,
                    /* Declared on EVERY request, first page included: without it
                       the server keeps this browser in the id-order world
                       end-to-end, so a deploy in either order never mixes the
                       two orderings inside one rendered thread. An older EF
                       ignores the marker and both cursor extras entirely. */
                    chrono_paging: true,
                    comment_after_at: append && existing ? (existing.commentCursorAt || null) : null,
                    ref_after: append && existing ? existing.refCursor : null,
                    legacy_offset: append && existing ? existing.legacyOffset : 0
                });
                if (!requestStillCurrent()) return false;
                const nextComments = json.comments || [];
                const nextRefs = json.asset_refs || [];
                const nextLegacy = json.issue && Array.isArray(json.issue.comments) ? json.issue.comments : [];
                state.detail = {
                    issue: json.issue || {},
                    comments: append && existing ? existing.comments.concat(nextComments) : nextComments,
                    refs: append && existing ? existing.refs.concat(nextRefs) : nextRefs,
                    legacyComments: append && existing ? existing.legacyComments.concat(nextLegacy) : nextLegacy,
                    commentCursor: nextComments.length ? String(nextComments[nextComments.length - 1].id || '') : (existing && existing.commentCursor || ''),
                    /* Retained exactly like commentCursor when comments are
                       exhausted but refs/legacy still page (Codex P2 on #1168):
                       clearing only the timestamp half would send an id-only
                       cursor on the next refs Load More and re-append comments
                       already on screen. The retained pair returns zero rows. */
                    commentCursorAt: json.comments_next_at
                        ? String(json.comments_next_at)
                        : (existing && existing.commentCursorAt || ''),
                    refCursor: nextRefs.length ? String(nextRefs[nextRefs.length - 1].ref_id || '') : (existing && existing.refCursor || ''),
                    legacyOffset: Number(json.legacy_comments_next_offset == null
                        ? ((append && existing ? existing.legacyOffset : 0) + nextLegacy.length)
                        : json.legacy_comments_next_offset),
                    hasMore: json.comments_has_more === true || json.refs_has_more === true || json.legacy_comments_has_more === true
                };
                state.detailRetryAppend = false;
            } catch (error) {
                if (!requestStillCurrent()) return false;
                state.detailError = _prodArchiveErrorText(error);
                state.detailRetryAppend = append === true;
            } finally {
                if (requestStillCurrent()) {
                    state.detailLoading = false;
                    _prodRenderArchiveRepair();
                }
            }
            return false;
        }
        function _prodOpenArchiveRepair() {
            if (!_syncviewStaffIdentityForHeaders()) {
                _prodToast('Sign in with your staff account to review archive repairs.');
                return false;
            }
            _prodState.archiveRepair = _prodArchiveDefaultState();
            _prodEnsureOverlays();
            _prodRenderArchiveRepair();
            _prodArchiveLoadList(false);
            return false;
        }
        function _prodCloseArchiveRepair() {
            _prodState.archiveRepair = null;
            _prodClearLayer();
            return false;
        }
        function _prodSmmArtifactGate(issue) {
            if (!issue || _prodWriteTeam(issue.team) !== 'graphics') return { ok: true, issue: null, guidance: '' };
            const state = _prodAssetState(issue.id, issue);
            const artifact = state.assets && state.assets.deliverable_file || {};
            const checkedAt = Date.parse(String(artifact.checked_at || ''));
            const fresh = Number.isFinite(checkedAt)
                && checkedAt <= Date.now() + 30000
                && Date.now() - checkedAt <= 5 * 60 * 1000;
            if (state.status === 'ready' && state.complete === true && artifact.state === 'available' && fresh) {
                return { ok: true, issue, guidance: '' };
            }
            const guidance = String(artifact.guidance || (artifact.state === 'available'
                ? 'Refresh asset access before requesting SMM approval.'
                : 'A fresh Available canonical deliverable is required. Use Refresh access in Assets.'));
            return { ok: false, issue, guidance };
        }
        function _prodRawHasAny(raw, keys) {
            const stack = raw && typeof raw === 'object' ? [raw] : [];
            while (stack.length) {
                const cur = stack.pop();
                if (!cur || typeof cur !== 'object') continue;
                for (const key of keys) {
                    if (Object.prototype.hasOwnProperty.call(cur, key) && cur[key]) return true;
                }
                Object.values(cur).forEach(v => { if (v && typeof v === 'object') stack.push(v); });
            }
            return false;
        }
        function _prodRawMarkerTruthy(v) {
            if (v === true || v === 1) return true;
            const s = String(v == null ? '' : v).trim().toLowerCase();
            return !!s && s !== 'false' && s !== '0' && s !== 'null';
        }
        function _prodDeliverableLive(d) {
            const raw = _prodLinearRaw(d && d.linear_raw);
            const projectedMarkers = ['raw_issue_archived_at','raw_issue_canceled_at','raw_webhook_delete','raw_deleted','raw_delete','raw_removed','raw_archived'];
            const hasProjectedMarkers = projectedMarkers.some(key => _prodHasOwn(d, key));
            // Canceled is a visible status (Linear renders a Canceled group); only archive/delete markers hide rows.
            if (_prodNormKey(d && d.status) === 'archived') return false;
            if (!hasProjectedMarkers && _prodRawHasAny(raw, ['webhook_delete', 'deleted', 'delete', 'removed', 'archived'])) return false;
            if (!hasProjectedMarkers && raw.issue && raw.issue.archivedAt) return false;
            if (_prodRawMarkerTruthy(d && d.raw_issue_archived_at)) return false;
            if (_prodRawMarkerTruthy(d && d.raw_webhook_delete)) return false;
            if (_prodRawMarkerTruthy(d && d.raw_deleted)) return false;
            if (_prodRawMarkerTruthy(d && d.raw_delete)) return false;
            if (_prodRawMarkerTruthy(d && d.raw_removed)) return false;
            if (_prodRawMarkerTruthy(d && d.raw_archived)) return false;
            return true;
        }
        function _prodResolveParentLinks(rows) {
            rows = Array.isArray(rows) ? rows : [];
            const nativeByLinear = new Map();
            const duplicateLinearIds = new Set();
            rows.forEach(row => {
                const nativeId = String(row && row.id || '').trim();
                const linearId = String(row && row.linear_issue_uuid || '').trim();
                if (!nativeId || !linearId) return;
                if (nativeByLinear.has(linearId) && nativeByLinear.get(linearId) !== nativeId) {
                    duplicateLinearIds.add(linearId);
                    return;
                }
                nativeByLinear.set(linearId, nativeId);
            });
            duplicateLinearIds.forEach(linearId => nativeByLinear.delete(linearId));

            const proposed = new Map();
            rows.forEach(row => {
                const nativeId = String(row && row.id || '').trim();
                const parentLinearId = String(row && row.raw_issue_parent_id || '').trim();
                const parentNativeId = nativeByLinear.get(parentLinearId) || '';
                if (nativeId && parentNativeId && parentNativeId !== nativeId) {
                    proposed.set(nativeId, parentNativeId);
                }
            });

            const resolved = new Map();
            proposed.forEach((parentNativeId, nativeId) => {
                const seen = new Set([nativeId]);
                let cursor = parentNativeId;
                while (cursor && !seen.has(cursor)) {
                    seen.add(cursor);
                    cursor = proposed.get(cursor) || '';
                }
                if (!cursor) resolved.set(nativeId, parentNativeId);
            });
            return resolved;
        }
        /* Batch parents for natively created cards.
         *
         * _prodResolveParentLinks above maps children to parents ONLY among
         * deliverable rows. That was always sufficient for imported cards,
         * because B1 imported the Linear parent issue as a deliverable row of
         * its own. A NATIVE card's parent exists solely as a batch — so every
         * natively created sub-issue rendered top-level, with an "Add
         * sub-issue" affordance on something that is already a sub-issue.
         * First reported by the owner on 2026-08-18 while recording the
         * team tutorial; it affected every native card, both components.
         *
         * This layer is DISPLAY-ONLY and deliberately separate: attribution
         * (_prodResolveAttributions) keeps consuming the deliverable-only map
         * unchanged, so this cannot move any attribution verdict. Deliverable
         * rows always win a UUID claim — an imported parent keeps resolving to
         * its real row, and a UUID claimed by two batches with no deliverable
         * row stays unresolved rather than guessed (same ambiguity rule as the
         * deliverable map).
         */
        /* WHICH OF TWO SAME-KIND CLAIMANTS OWNS THE PARENT.
           Reached only when liveness and provenance have both tied: two mirrors,
           or two natives, claiming one Linear parent. That case used to be
           marked ambiguous and DROPPED, on the reasoning that inventing a
           winner could show one batch's description under another's parent.
           Measured 2026-09-02 across all 1,660 batches, that reasoning does not
           survive contact with the data: 10 collisions reach here, and in 8 the
           two rows carry a BYTE-IDENTICAL name. The other 2 differ only by a
           typo of the same post ("Hook Videos" / "Hooks videos", "12 Thumbnails"
           / "Thumbnails"). They are not two different posts competing for one
           parent; they are one post imported twice. Dropping both is what makes
           the post vanish from Scene View entirely -- the failure a video editor
           reported on 2026-09-01 -- so the cost of choosing is a slightly wrong
           title at worst, and the cost of not choosing is the whole post.
           Owner, 2026-09-02, on what should separate them: "shouldn't you just
           look at them and see what's the difference, like in the description
           ... whichever has the most description or most text wins?" Measured,
           that was the better signal -- description length picks a unique winner
           in 19 of the 23 collisions against 9 for sub-issue count -- and it
           still could not be used: `description` is deliberately absent from the
           first-paint cache, so it changes the winner between the cached and the
           live render, and the winner IS the node id. See the rung comments.
           Returns true when `candidate` should displace `held`. */
        function _prodBatchClaimWins(candidate, held, childCounts) {
            const count = b => {
                const id = String(b && b.id || '');
                const n = childCounts && typeof childCounts.get === 'function' ? childCounts.get(id) : 0;
                return Number(n) || 0;
            };
            const candCount = count(candidate), heldCount = count(held);
            // 1. The row the work actually hangs off. A duplicate with no
            //    sub-issues is the import that lost; the one carrying twenty is
            //    the post people are working in. Cache-stable: `batch_id` is in
            //    PROD_DELIVERABLE_SELECT, and the snapshot is all-or-nothing --
            //    an oversized payload is dropped whole, never truncated -- so
            //    the cached count equals the live one.
            if (candCount !== heldCount) return candCount > heldCount;
            /* 2. Then the lower id, which is arbitrary ON PURPOSE and must stay
               deterministic: the projection runs on every render, and the
               winner IS the synthetic node's id, so a signal that moves between
               renders moves a live `?d=` deep link out from under the reader.

               DESCRIPTION LENGTH WAS THE SECOND RUNG AND HAD TO COME OUT.
               Raised by review on #1217, and correct: `_prodCacheBatchColumns`
               deliberately drops `description` from the first-paint snapshot
               (it would blow PROD_CACHE_MAX_CHARS across ~1,660 batches), so on
               a cached paint every length reads 0, the rung is skipped, and the
               lower id wins -- then the live read restores the descriptions and
               a DIFFERENT row can win. The node id changes under the reader
               mid-hydration, and a `?d=` captured from the cached paint
               resolves to nothing.
               It cost the owner's own suggestion, which was the better signal
               on the full set (19 of 23 collisions against 9 for count). The
               cost of dropping it is measured and nil: it decided 2 of the 10
               live cases, and in BOTH the claimants carry a byte-identical
               name, so the only difference is which of two descriptions shows.
               A stable identity is worth more than that.
               Widening the cache instead was considered and refused: it is the
               same cache that had to be bounded in OPEN_REPAIRS item 45 after
               it evicted its neighbours. */
            return String(candidate && candidate.id || '') < String(held && held.id || '');
        }

        function _prodResolveBatchParentNodes(rows, batches, parentLinks) {
            rows = Array.isArray(rows) ? rows : [];
            batches = Array.isArray(batches) ? batches : [];
            const deliverableUuids = new Set();
            /* How much work hangs off each batch, from the rows already loaded --
               no extra read. Feeds the same-kind tie-break below. */
            const childCounts = new Map();
            rows.forEach(row => {
                const uuid = String(row && row.linear_issue_uuid || '').trim();
                if (uuid) deliverableUuids.add(uuid);
                const bid = String(row && row.batch_id || '').trim();
                if (bid) childCounts.set(bid, (childCounts.get(bid) || 0) + 1);
            });
            const parseEntries = raw => {
                let parsed = raw;
                if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch (e) { return []; } }
                if (Array.isArray(parsed)) {
                    return parsed.filter(v => v && typeof v === 'object')
                        .map(v => ({ team: String(v.team || v.team_key || v.key || '').toLowerCase(), entry: v }));
                }
                if (parsed && typeof parsed === 'object') {
                    return Object.entries(parsed).filter(([, v]) => v && typeof v === 'object')
                        .map(([key, v]) => ({ team: String(key || '').toLowerCase(), entry: v }));
                }
                return [];
            };
            const byUuid = new Map();
            const ambiguous = new Set();
            batches.forEach(batch => {
                const batchId = String(batch && batch.id || '').trim();
                if (!batchId) return;
                const batchArchived = String(batch && batch.status || '').trim().toLowerCase() === 'archived';
                const seenHere = new Set();
                parseEntries(batch.linear_parent_ids).forEach(({ team, entry }) => {
                    const uuid = String(entry.uuid || entry.id || entry.linear_issue_id || '').trim();
                    if (!uuid || deliverableUuids.has(uuid) || seenHere.has(uuid)) return;
                    seenHere.add(uuid);
                    /* TWO BATCHES CAN NAME THE SAME LINEAR PARENT, and when
                       they did, this dropped BOTH and the post vanished.

                       Owner, 2026-09-01, relaying a video editor and then
                       correcting my first diagnosis: "are you saying that the
                       issue she's sending me was created only on linear? I
                       don't think so, I'm pretty sure it was created by our
                       system, it even has the same naming as our system." He
                       was right. The post is ours -- SyncView created the batch
                       AND its Linear parent -- and B1 then imported the same
                       post as a mirror batch, so `bat_...` and `b1_b_...` both
                       claim the one parent uuid. Different batch ids, so this
                       marked it ambiguous, `ambiguous.forEach(delete)` removed
                       it, no synthetic row was minted, and a deep link by its
                       identifier resolved to nothing at all.
                       Measured that day across all 1,657 batches: 23 parents
                       across 14 clients mint no row for this reason, and 12 of
                       them are exactly this native-plus-mirror pair.

                       THE NATIVE ROW WINS, and the tie-break is not arbitrary:
                       `bat_` is the row SyncView writes to -- batch_description
                       targets it, intake populates its asset columns, and item
                       36 measured that the mirror's asset columns are empty
                       while the native ones carry the links. The mirror is a
                       read-only import of the same post.
                       A pair with no native side stays ambiguous and is still
                       dropped: two mirrors or two native batches claiming one
                       parent is a real conflict, and inventing a winner there
                       would show one batch's description under another's
                       parent. That is what the guard was written for and it
                       keeps doing it. */
                    if (byUuid.has(uuid) && byUuid.get(uuid).batchId !== batchId) {
                        /* AN ARCHIVED CLAIMANT NEVER WINS, and it is checked
                           BEFORE provenance. Raised by review, and it happens:
                           B1's own dropClaimsOwnedByAnotherBatch skips archived
                           rows when deciding who owns a uuid
                           (b1-linear-backfill.js:1080), so an ACTIVE import is
                           deliberately allowed to reuse a claim held by an
                           ARCHIVED batch -- while this projection loads batches
                           with no status filter and sees both. On a
                           prefix-only rule the archived native row would win
                           and live children would hang under a retired post,
                           showing its stale title and description.
                           Measured across all 1,658 batch rows: 1 of the 12
                           native-plus-mirror pairs is exactly this shape, so
                           the rule is written for a case that exists rather
                           than a hypothetical one. `done` is not archived and
                           still competes -- a finished post is a real post. */
                        const held = byUuid.get(uuid);
                        const heldArchived = held.archived;
                        const thisArchived = batchArchived;
                        if (heldArchived !== thisArchived) {
                            if (thisArchived) return;
                            ambiguous.delete(uuid);
                        } else {
                            const heldIsNative = /^bat_/.test(held.batchId);
                            const thisIsNative = /^bat_/.test(batchId);
                            if (heldIsNative !== thisIsNative) {
                                if (heldIsNative) return;
                                ambiguous.delete(uuid);
                            } else if (!_prodBatchClaimWins(batch, held.batch, childCounts)) {
                                // The row already holding the parent keeps it.
                                return;
                            } else {
                                ambiguous.delete(uuid);
                            }
                        }
                    }
                    const ownerTeam = String(entry.owner_team || '').toLowerCase() || team;
                    byUuid.set(uuid, {
                        batchId,
                        batch,
                        archived: batchArchived,
                        uuid,
                        identifier: String(entry.identifier || '').trim(),
                        url: String(entry.url || '').trim(),
                        team: ownerTeam === 'graphics' || ownerTeam === 'graphic' || ownerTeam === 'gra' ? 'graphics' : 'video'
                    });
                });
            });
            ambiguous.forEach(uuid => byUuid.delete(uuid));
            /*
             * One batch can legitimately parent TWO Linear issues. The video
             * parent and the graphics parent are separate issues, which is the
             * whole reason linear_parent_ids is a per-team map. `nodes` used to
             * be keyed by BATCH id, so the second team overwrote the first:
             * only one synthetic parent row survived, both teams of children
             * hung under it, and a deep link by the losing identifier resolved
             * to nothing.
             *
             * Keyed by the parent uuid now. The synthetic row keeps the bare
             * batch id whenever a batch has a single parent -- which is every
             * batch that already works -- so no existing row id, cached
             * snapshot, or ?d= URL changes meaning. Only a batch with genuinely
             * two parents mints a second, suffixed id. Ordering is by team then
             * uuid so the same projection always produces the same ids rather
             * than depending on the order rows happened to arrive in.
             */
            const wanted = new Map();
            rows.forEach(row => {
                const nativeId = String(row && row.id || '').trim();
                if (!nativeId || parentLinks.has(nativeId)) return;
                const node = byUuid.get(String(row && row.raw_issue_parent_id || '').trim());
                if (!node || node.batchId === nativeId) return;
                wanted.set(node.uuid, node);
            });
            const perBatch = new Map();
            Array.from(wanted.values())
                .sort((a, b) => String(a.team).localeCompare(String(b.team))
                    || String(a.uuid).localeCompare(String(b.uuid)))
                .forEach(node => {
                    if (!perBatch.has(node.batchId)) perBatch.set(node.batchId, []);
                    perBatch.get(node.batchId).push(node);
                });
            const nodes = new Map();
            perBatch.forEach(list => list.forEach((node, index) => {
                node.nodeId = index === 0 ? node.batchId : node.batchId + '::' + node.uuid;
                nodes.set(node.nodeId, node);
            }));
            /* A BATCH CREATED ENTIRELY NATIVELY -- outbound skipped -- HAS NO
               LINEAR PARENT AT ALL, so `batch.linear_parent_ids` is empty and
               everything above, which keys off it, mints nothing: the batch's
               own children have no `raw_issue_parent_id` to point through
               `byUuid`, so they surface as bare top-level issues with no
               "Sub-issue of" and no way back to their batch or siblings.
               ONE PARENT PER CARD (owner ruling 2026-08-18, the same rule
               production-write's own batch-create intake follows -- see
               "ONE PARENT PER CARD" in supabase/functions/production-write,
               batch-create): a batch mints exactly ONE synthetic parent
               regardless of how many teams it serves, owned by the primary
               team -- video when present, otherwise whichever team the batch
               has -- and every child of every team links to that SAME node.
               This is the native mirror of what a Linear-backed create of the
               same card would have produced (and why the Linear-backed loop
               above already collapses identical per-team uuids into one row
               via byUuid: same rule, upstream side). A batch that already
               produced a Linear-backed node, or whose linear_parent_ids has
               ANY usable entry (even one this pass left ambiguous or already
               claimed by a deliverable row), is untouched -- this branch only
               fires where the Linear-backed branch above had nothing to work
               with.

               GATED ON GENUINELY NATIVE-BORN CHILDREN, not merely "no
               raw_issue_parent_id" -- a row born on Linear that simply has no
               recorded parent (`same-batch-root` in
               docs/syncview-design/tests/prod-structure-subset.js) is meant
               to stay a root, proven by the adjacent fail-closed tests; it is
               not evidence its batch needs a synthetic parent, and it must
               never be swept into one. `linear_issue_uuid` is how a row
               proves it has no Linear identity at all -- empty means
               genuinely native. */
            const linearBackedBatchIds = new Set(Array.from(nodes.values()).map(n => n.batchId));
            const hasUsableParentIds = batch => parseEntries(batch && batch.linear_parent_ids)
                .some(({ entry }) => String(entry.uuid || entry.id || entry.linear_issue_id || '').trim());
            const normalizeChildTeam = t => {
                const v = String(t || '').trim().toLowerCase();
                return (v === 'graphics' || v === 'graphic' || v === 'gra') ? 'graphics' : 'video';
            };
            const isNativeBorn = row => !String(row && row.linear_issue_uuid || '').trim();
            const nativeTeamsPresent = new Map(); // batchId -> Set(team), native-born rows only
            rows.forEach(row => {
                const bid = String(row && row.batch_id || '').trim();
                if (!bid || !isNativeBorn(row)) return;
                if (!nativeTeamsPresent.has(bid)) nativeTeamsPresent.set(bid, new Set());
                nativeTeamsPresent.get(bid).add(normalizeChildTeam(row && row.team));
            });
            batches.forEach(batch => {
                const batchId = String(batch && batch.id || '').trim();
                if (!batchId || linearBackedBatchIds.has(batchId)) return;
                if (!childCounts.get(batchId)) return;
                if (hasUsableParentIds(batch)) return;
                const teamsPresent = nativeTeamsPresent.get(batchId);
                if (!teamsPresent || !teamsPresent.size) return;
                const batchArchived = String(batch && batch.status || '').trim().toLowerCase() === 'archived';
                const nodeId = batchId;
                const node = {
                    batchId,
                    batch,
                    archived: batchArchived,
                    uuid: '',
                    // No Linear issue underneath a native batch, so there is
                    // no `identifier` to mirror off a linear_parent_ids
                    // entry the way the Linear-backed branch does; the
                    // renderer already falls back to the batch's own name
                    // and then this nodeId for title/displayId.
                    identifier: '',
                    url: '',
                    team: teamsPresent.has('video') ? 'video' : Array.from(teamsPresent)[0],
                    nodeId
                };
                nodes.set(nodeId, node);
            });
            /* A MIXED batch -- born on Linear, then added to natively after
               the outbound cutoff -- already has a Linear-backed node from
               the byUuid/wanted pass above, so the native-minting loop just
               above correctly refuses to mint a second one for it (ONE
               PARENT PER CARD). That left every native-born child of a
               mixed batch with nowhere to attach: the old fallback below
               only knew about nodes THIS loop had just minted, which is
               empty for a batch `linearBackedBatchIds` already claims.
               Measured 2026-09-22 against a real mixed batch: 8 pre-cutoff
               children resolved through their own `raw_issue_parent_id`,
               and 10 post-cutoff native-born ones (no parent id, no Linear
               identity) had no node to fall back to at all.
               `nodes` is complete now -- Linear-backed and synthetic-native
               alike -- so building the fallback map from it, instead of
               from the native mint loop alone, closes the gap for both
               shapes without minting anything new. A batch can legitimately
               carry two Linear-backed nodes (one per team, see the byUuid
               comment above); a native child matches its own team's node
               when more than one exists for its batch, and otherwise takes
               the batch's one and only node. */
            const nodesByBatch = new Map(); // batchId -> node[]
            nodes.forEach(node => {
                const bid = node.batchId;
                if (!bid) return;
                if (!nodesByBatch.has(bid)) nodesByBatch.set(bid, []);
                nodesByBatch.get(bid).push(node);
            });
            /* THE OTHER MIXED SHAPE, and the reason `nodesByBatch` alone is not
               enough (Codex P1 on PR 1494). When a batch's Linear parent has
               ITSELF been imported as a deliverable row, the `byUuid` pass
               skips that uuid on purpose (`deliverableUuids`) -- the row is
               already in the tree, so synthesising a second node for the same
               issue would double it. The batch therefore never lands in
               `linearBackedBatchIds`, and the native-minting loop then bails on
               `hasUsableParentIds` because the batch DOES record a parent uuid.
               Net effect: no node of any kind, so `nodesByBatch` is empty for
               it and the fallback above cannot fire.
               Its pre-cutoff children are fine -- `_prodResolveParentLinks`
               maps them onto the parent's own native row id -- so the repair is
               to send native-born children to that SAME row id, which is what
               keeps both halves of the batch under one parent. Deliberately
               mirrors that function's duplicate rule: a uuid claimed by two
               rows is ambiguous and attaches nothing rather than guessing. */
            const rowIdByUuid = new Map();
            const ambiguousRowUuids = new Set();
            rows.forEach(row => {
                const rowId = String(row && row.id || '').trim();
                const uuid = String(row && row.linear_issue_uuid || '').trim();
                if (!rowId || !uuid) return;
                if (rowIdByUuid.has(uuid) && rowIdByUuid.get(uuid) !== rowId) { ambiguousRowUuids.add(uuid); return; }
                rowIdByUuid.set(uuid, rowId);
            });
            ambiguousRowUuids.forEach(uuid => rowIdByUuid.delete(uuid));
            const deliverableParentsByBatch = new Map(); // batchId -> {team, rowId}[]
            batches.forEach(batch => {
                const batchId = String(batch && batch.id || '').trim();
                if (!batchId || nodesByBatch.has(batchId)) return;
                parseEntries(batch.linear_parent_ids).forEach(({ team, entry }) => {
                    const uuid = String(entry.uuid || entry.id || entry.linear_issue_id || '').trim();
                    const rowId = uuid ? rowIdByUuid.get(uuid) : '';
                    if (!rowId) return;
                    if (!deliverableParentsByBatch.has(batchId)) deliverableParentsByBatch.set(batchId, []);
                    deliverableParentsByBatch.get(batchId).push({ team: normalizeChildTeam(team), rowId });
                });
            });
            const links = new Map();
            rows.forEach(row => {
                const nativeId = String(row && row.id || '').trim();
                if (!nativeId || parentLinks.has(nativeId)) return;
                const rawParentId = String(row && row.raw_issue_parent_id || '').trim();
                const linearNode = rawParentId ? byUuid.get(rawParentId) : null;
                if (linearNode && linearNode.nodeId && linearNode.batchId !== nativeId) {
                    links.set(nativeId, linearNode.nodeId);
                    return;
                }
                /* An explicit parent edge that FAILED to resolve (missing,
                   duplicated, self-referential, or cyclic target) must stay a
                   root, not get silently reparented to the batch -- that
                   would invent a relationship the data never claimed. The
                   native-batch fallback below is only for a row with NO
                   parent edge to begin with. */
                if (rawParentId) return;
                /* And only for a row that is itself native-born. A row with a
                   real Linear identity (`linear_issue_uuid` set) that simply
                   has no recorded parent stays a root too -- same reasoning,
                   see the comment above `nativeTeamsPresent`. */
                if (!isNativeBorn(row)) return;
                const bid = String(row && row.batch_id || '').trim();
                if (!bid) return;
                const childTeam = normalizeChildTeam(row && row.team);
                const candidates = nodesByBatch.get(bid);
                if (candidates && candidates.length) {
                    const target = candidates.length === 1
                        ? candidates[0]
                        : (candidates.find(n => n.team === childTeam) || candidates[0]);
                    if (target && target.nodeId && bid !== nativeId) links.set(nativeId, target.nodeId);
                    return;
                }
                const rowParents = deliverableParentsByBatch.get(bid);
                if (!rowParents || !rowParents.length) return;
                const rowTarget = rowParents.length === 1
                    ? rowParents[0]
                    : (rowParents.find(p => p.team === childTeam) || rowParents[0]);
                if (rowTarget && rowTarget.rowId && rowTarget.rowId !== nativeId) links.set(nativeId, rowTarget.rowId);
            });
            return { links, nodes };
        }
        function _prodConfiguredProjectIds(value) {
            if (typeof value === 'string') {
                const text = value.trim();
                if (!text) return [];
                try { return _prodConfiguredProjectIds(JSON.parse(text)); }
                catch (e) { return [text]; }
            }
            if (!value || typeof value !== 'object') return [];
            const found = new Set();
            const add = entry => {
                if (typeof entry === 'string') {
                    if (entry.trim()) found.add(entry.trim());
                    return;
                }
                if (!entry || typeof entry !== 'object') return;
                ['id', 'project_id', 'linear_project_id'].forEach(key => {
                    const id = String(entry[key] || '').trim();
                    if (id) found.add(id);
                });
            };
            if (Array.isArray(value)) value.forEach(add);
            else {
                add(value);
                Object.entries(value).forEach(([key, entry]) => {
                    if (['video', 'vid', 'graphics', 'graphic', 'gra', 'thumbnail'].includes(String(key).toLowerCase())) add(entry);
                });
                if (Array.isArray(value.projects)) value.projects.forEach(add);
            }
            return [...found];
        }
        function _prodNativeProjectIdForTeam(value, team) {
            const normalizedTeam = String(team || '').trim().toLowerCase();
            if (!['video', 'graphics'].includes(normalizedTeam) || !value || typeof value !== 'object' || Array.isArray(value)) return '';
            const projectId = String(value[normalizedTeam] || '').trim();
            const prefix = normalizedTeam === 'video' ? 'svproj_video_' : 'svproj_graphics_';
            return new RegExp('^' + prefix + '[a-f0-9]{32}$', 'i').test(projectId) ? projectId : '';
        }
        function _prodLinearProjectIdsForTeam(value, team) {
            const wanted = String(team || '').trim().toLowerCase();
            if (!['video', 'graphics'].includes(wanted) || !value || typeof value !== 'object') return [];
            const found = new Set();
            const normalizedTeam = entry => {
                const raw = String(entry || '').trim().toLowerCase();
                if (raw === 'vid') return 'video';
                if (['graphic', 'gra', 'thumbnail'].includes(raw)) return 'graphics';
                return raw;
            };
            const idsFrom = entry => {
                if (typeof entry === 'string') return entry.trim() ? [entry.trim()] : [];
                if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
                return [...new Set(['id', 'project_id', 'linear_project_id'].map(key => String(entry[key] || '').trim()).filter(Boolean))];
            };
            const addExplicit = entry => {
                if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
                if (normalizedTeam(entry.team || entry.team_key || entry.key || entry.kind) === wanted) {
                    idsFrom(entry).forEach(id => found.add(id));
                }
            };
            if (Array.isArray(value)) value.forEach(addExplicit);
            else {
                Object.entries(value).forEach(([key, entry]) => {
                    if (normalizedTeam(key) === wanted) idsFrom(entry).forEach(id => found.add(id));
                });
                addExplicit(value);
                if (Array.isArray(value.projects)) value.projects.forEach(addExplicit);
            }
            return [...found].sort();
        }
        function _prodRawProjectId(row) {
            const projected = String(row && row.raw_project_id || '').trim();
            if (projected) return projected;
            const raw = _prodLinearRaw(row && row.linear_raw);
            return String(raw && raw.issue && raw.issue.project && raw.issue.project.id || '').trim();
        }
        function _prodRawAttribution(row) {
            const raw = _prodLinearRaw(row && row.linear_raw);
            const nested = raw && raw.attribution && typeof raw.attribution === 'object' ? raw.attribution : {};
            const read = (alias, key) => _prodHasOwn(row, alias) ? row[alias] : nested[key];
            const repairRaw = read('raw_attribution_repair_required', 'repair_required');
            const hasExplicitDecisionRef = read(
                'raw_attribution_has_explicit_decision_ref',
                'has_explicit_decision_ref'
            ) === true;
            const legacyExplicitDecisionRef = String(
                read('raw_attribution_explicit_decision_ref', 'explicit_decision_ref') || ''
            ).trim();
            return {
                schema: String(read('raw_attribution_schema', 'schema') || '').trim(),
                state: String(read('raw_attribution_state', 'state') || '').trim(),
                client_slug: String(read('raw_attribution_client_slug', 'client_slug') || '').trim(),
                owner_kind: String(read('raw_attribution_owner_kind', 'owner_kind') || '').trim(),
                source: String(read('raw_attribution_source', 'source') || '').trim(),
                project_id: String(read('raw_attribution_project_id', 'project_id') || '').trim(),
                native_epoch: String(read('raw_attribution_native_epoch', 'native_epoch') || '').trim(),
                provisional_client_slug: String(read('raw_attribution_provisional_client_slug', 'provisional_client_slug') || '').trim(),
                mapping_revision: String(read('raw_attribution_mapping_revision', 'mapping_revision') || '').trim(),
                repair_required: repairRaw === true || String(repairRaw || '').toLowerCase() === 'true',
                reason: String(read('raw_attribution_reason', 'reason') || '').trim(),
                explicit_owner_approved: read('raw_attribution_explicit_owner_approved', 'explicit_owner_approved') === true
                    || String(read('raw_attribution_explicit_owner_approved', 'explicit_owner_approved') || '').toLowerCase() === 'true',
                explicit_decision_ref: hasExplicitDecisionRef ? 'present' : legacyExplicitDecisionRef,
                explicit_manifest_sha256: String(read('raw_attribution_explicit_manifest_sha256', 'explicit_manifest_sha256') || '').trim().toLowerCase()
            };
        }
        function _prodRawIdentityRepair(row) {
            const raw = _prodLinearRaw(row && row.linear_raw);
            const nested = raw && raw.identity_repair && typeof raw.identity_repair === 'object'
                ? raw.identity_repair
                : {};
            const state = String(
                (_prodHasOwn(row, 'identity_repair_state')
                    ? row.identity_repair_state
                    : '') || nested.state || ''
            ).trim().toLowerCase();
            const reason = String(
                (_prodHasOwn(row, 'identity_repair_reason')
                    ? row.identity_repair_reason
                    : '') || nested.reason || ''
            ).trim();
            const resolvedLinearIssueId = String(
                _prodHasOwn(row, 'identity_repair_resolved_linear_issue_id')
                    ? row.identity_repair_resolved_linear_issue_id
                    : nested.resolved_linear_issue_id || ''
            ).trim();
            const currentLinearIssueId = String(
                row && row.linear_issue_uuid || raw && raw.issue && raw.issue.id || ''
            ).trim();
            return {
                state,
                reason,
                required: !!state && !(state === 'resolved'
                    && resolvedLinearIssueId
                    && resolvedLinearIssueId === currentLinearIssueId)
            };
        }
        function _prodResolveAttributions(rows, clients, parentLinks) {
            const activeBySlug = new Map();
            const projectOwners = new Map();
            const nativeProjectOwners = new Map();
            const nativeLegacyProjectOwners = new Map();
            (clients || []).forEach(client => {
                const slug = String(client && client.slug || '').trim();
                if (!slug || client.active !== true) return;
                activeBySlug.set(slug, client);
                _prodConfiguredProjectIds(client.linear_project_ids).forEach(projectId => {
                    const prior = projectOwners.get(projectId);
                    if (prior && prior.slug !== slug) projectOwners.set(projectId, { conflict: true });
                    else if (!prior) projectOwners.set(projectId, { slug, kind: String(client.kind || 'client') });
                });
                ['video', 'graphics'].forEach(team => {
                    _prodLinearProjectIdsForTeam(client.linear_project_ids, team).forEach(projectId => {
                        const key = team + ':' + projectId;
                        const prior = nativeLegacyProjectOwners.get(key);
                        if (prior && prior.slug !== slug) nativeLegacyProjectOwners.set(key, { conflict: true });
                        else if (!prior) nativeLegacyProjectOwners.set(key, { slug, kind: String(client.kind || 'client'), team });
                    });
                });
                ['video', 'graphics'].forEach(team => {
                    const projectId = _prodNativeProjectIdForTeam(client.native_project_ids, team);
                    if (!projectId) return;
                    const prior = nativeProjectOwners.get(projectId);
                    if (prior && prior.slug !== slug) nativeProjectOwners.set(projectId, { conflict: true });
                    else if (!prior) nativeProjectOwners.set(projectId, { slug, kind: String(client.kind || 'client'), team });
                });
            });
            const rowById = new Map((rows || []).map(row => [String(row && row.id || ''), row]).filter(([id]) => id));
            const result = new Map();
            const resolved = (slug, source, details) => Object.assign({
                state: 'resolved',
                clientSlug: slug,
                provisionalClientSlug: '',
                ownerKind: String(activeBySlug.get(slug) && activeBySlug.get(slug).kind || 'client'),
                source,
                mappingRevision: '',
                repairRequired: false,
                reason: source
            }, details || {});
            const needs = details => Object.assign({
                state: 'needs_attribution',
                clientSlug: '',
                provisionalClientSlug: '',
                ownerKind: '',
                source: 'none',
                mappingRevision: '',
                repairRequired: true,
                reason: 'no_mapped_project_or_explicit_classification'
            }, details || {});
            const conflict = details => Object.assign(needs(), {
                state: 'conflict',
                source: 'conflict',
                reason: 'attribution_conflict'
            }, details || {});
            (rows || []).forEach(row => {
                const id = String(row && row.id || '');
                if (!id) return;
                const persisted = _prodRawAttribution(row);
                const directProjectId = _prodRawProjectId(row);
                let candidate = null;
                let mappedProjectId = '';
                let directUnmapped = false;
                let ancestorProjectSeen = false;
                if (directProjectId) {
                    const owner = projectOwners.get(directProjectId);
                    if (owner && owner.conflict) candidate = conflict({ reason: 'project_mapping_conflict' });
                    else if (owner && owner.slug) {
                        mappedProjectId = directProjectId;
                        candidate = resolved(owner.slug, 'direct_project');
                    } else {
                        directUnmapped = true;
                    }
                }
                let cursor = parentLinks.get(id) || '';
                const seen = new Set([id]);
                let distance = 0;
                while (!candidate && cursor && !seen.has(cursor)) {
                    seen.add(cursor);
                    distance++;
                    const ancestor = rowById.get(cursor);
                    const projectId = _prodRawProjectId(ancestor);
                    if (projectId) ancestorProjectSeen = true;
                    const owner = projectId && projectOwners.get(projectId);
                    if (owner && owner.conflict) {
                        candidate = conflict({ reason: 'ancestor_project_mapping_conflict' });
                        break;
                    }
                    if (owner && owner.slug) {
                        mappedProjectId = projectId;
                        candidate = resolved(owner.slug, 'nearest_mapped_ancestor', {
                            repairRequired: directUnmapped,
                            reason: directUnmapped ? 'ancestor_mapped_direct_project_needs_mapping' : 'nearest_ancestor_project_mapped',
                            ancestorDistance: distance
                        });
                        break;
                    }
                    cursor = parentLinks.get(cursor) || '';
                }
                let attribution = candidate || needs({
                    reason: directProjectId ? 'direct_project_unmapped' : 'no_mapped_project_or_explicit_classification'
                });
                if (persisted.state === 'conflict') {
                    attribution = conflict({
                        mappingRevision: persisted.mapping_revision,
                        reason: persisted.reason || 'persisted_attribution_conflict'
                    });
                } else if (persisted.state === 'needs_attribution') {
                    attribution = candidate && candidate.state === 'resolved'
                        ? conflict({
                            mappingRevision: persisted.mapping_revision,
                            reason: 'persisted_attribution_disagrees_with_current_mapping'
                        })
                        : needs({
                            mappingRevision: persisted.mapping_revision,
                            reason: persisted.reason || attribution.reason
                        });
                } else if (persisted.state === 'resolved') {
                    const persistedActive = activeBySlug.has(persisted.client_slug);
                    const explicit = /^explicit_/.test(persisted.source);
                    if (persisted.source === 'native_intake_project' || persisted.source === 'native_intake_legacy_project') {
                        const nativeOwner = nativeProjectOwners.get(persisted.project_id);
                        const legacyOwner = nativeLegacyProjectOwners.get(String(row.team || '').trim().toLowerCase() + ':' + persisted.project_id);
                        const globalLegacyOwner = projectOwners.get(persisted.project_id);
                        const expectedProjects = persistedActive
                            ? (persisted.source === 'native_intake_project'
                                ? [_prodNativeProjectIdForTeam(activeBySlug.get(persisted.client_slug).native_project_ids, row.team)].filter(Boolean)
                                : _prodLinearProjectIdsForTeam(activeBySlug.get(persisted.client_slug).linear_project_ids, row.team))
                            : [];
                        const noProviderEvidence = !candidate && !directProjectId && !ancestorProjectSeen;
                        const corroboratingLegacyEvidence = persisted.source === 'native_intake_legacy_project'
                            && !directUnmapped && candidate && candidate.state === 'resolved'
                            && candidate.clientSlug === persisted.client_slug
                            && mappedProjectId === persisted.project_id;
                        // The persisted owner kind is whatever the gateway wrote
                        // for the roster row (`lower(client.kind || 'client')`),
                        // so demanding 'client' here refused every card of the
                        // test client -- banner up, comment box and write
                        // controls locked -- while the server has accepted that
                        // client since #1414. Carry the roster kind through and
                        // require the persisted value to equal it, exactly as
                        // the explicit branch below already does. 'internal'
                        // stays out on purpose: nothing has measured it.
                        const nativeOwnerKind = String(
                            (persistedActive && activeBySlug.get(persisted.client_slug)
                                && activeBySlug.get(persisted.client_slug).kind) || 'client'
                        ).trim().toLowerCase();
                        const nativeProofValid = persisted.schema === 'syncview_attribution_v1'
                            && (nativeOwnerKind === 'client' || nativeOwnerKind === 'test')
                            && persisted.owner_kind === nativeOwnerKind
                            && persistedActive
                            && String(row.client_slug || '').trim() === persisted.client_slug
                            && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(persisted.native_epoch)
                            && expectedProjects.length === 1
                            && expectedProjects[0] === persisted.project_id
                            && (noProviderEvidence || corroboratingLegacyEvidence)
                            && (persisted.source === 'native_intake_project'
                                ? nativeOwner && !nativeOwner.conflict && nativeOwner.slug === persisted.client_slug
                                    && nativeOwner.team === String(row.team || '').trim().toLowerCase()
                                : legacyOwner && !legacyOwner.conflict && legacyOwner.slug === persisted.client_slug
                                    && legacyOwner.team === String(row.team || '').trim().toLowerCase()
                                    && globalLegacyOwner && !globalLegacyOwner.conflict
                                    && globalLegacyOwner.slug === persisted.client_slug);
                        attribution = nativeProofValid
                            ? resolved(persisted.client_slug, persisted.source, {
                                ownerKind: nativeOwnerKind,
                                mappingRevision: persisted.mapping_revision,
                                repairRequired: persisted.repair_required,
                                reason: persisted.reason || (persisted.source === 'native_intake_project'
                                    ? 'native_intake_project_mapped'
                                    : 'native_intake_legacy_project_mapped')
                            })
                            : needs({
                                mappingRevision: persisted.mapping_revision,
                                reason: 'persisted_native_intake_ownership_invalid'
                            });
                    } else
                    /*
                     * An ABSENT persisted slug is missing evidence, not
                     * contradicting evidence -- and until 2026-08-23 this
                     * function read it as the second.
                     *
                     * The store always writes `client_slug` alongside
                     * `state: 'resolved'`, so an empty one here never came from
                     * the store: it came from the read path. The projection view
                     * gates `raw_attribution_client_slug` behind a slug regex
                     * and returns NULL when a real roster slug fails it, while
                     * passing `d.client_slug` through unfiltered a few columns
                     * away. One active roster slug carries a character that
                     * regex rejects, and every one of its 147 rows arrived here
                     * with `state: 'resolved'` and no slug -- so the comparison
                     * below found "resolved, but not the client the mapping
                     * says", declared `persisted_resolved_client_disagrees_with_current_mapping`,
                     * and the family fixpoint below then poisoned every relative.
                     * 147 of the 176 conflict banners in the app were that one
                     * regex. All 147 rows were read-only and mis-grouped.
                     *
                     * So: with no persisted slug there is nothing to disagree
                     * WITH. Take the freshly computed mapping, keep the
                     * persisted metadata that does not depend on the slug, and
                     * say plainly in the reason that the read path is what is
                     * missing. The row stays writable and correctly grouped, and
                     * the next time somebody tightens a projection column the UI
                     * fails soft instead of inventing a conflict.
                     *
                     * This is the browser half. The guard in the view is the
                     * actual defect and is fixed by its own dated delta.
                     */
                    if (!persisted.client_slug) {
                        attribution = candidate && candidate.state === 'resolved'
                            ? Object.assign({}, candidate, {
                                mappingRevision: persisted.mapping_revision,
                                repairRequired: persisted.repair_required || candidate.repairRequired,
                                reason: 'persisted_client_slug_unavailable_in_read_path'
                            })
                            : needs({
                                mappingRevision: persisted.mapping_revision,
                                reason: 'persisted_client_slug_unavailable_in_read_path'
                            });
                    } else if (candidate && candidate.state === 'resolved') {
                        attribution = persistedActive && candidate.clientSlug === persisted.client_slug
                            ? Object.assign({}, candidate, {
                                ownerKind: persisted.owner_kind || candidate.ownerKind,
                                source: persisted.source || candidate.source,
                                mappingRevision: persisted.mapping_revision,
                                repairRequired: persisted.repair_required || candidate.repairRequired,
                                reason: persisted.reason || candidate.reason
                            })
                            : conflict({
                                mappingRevision: persisted.mapping_revision,
                                reason: 'persisted_resolved_client_disagrees_with_current_mapping'
                            });
                    } else if (explicit && persistedActive) {
                        const owner = activeBySlug.get(persisted.client_slug);
                        const ownerKind = String(owner && owner.kind || 'client').trim().toLowerCase();
                        const expectedSource = ownerKind === 'client'
                            ? 'explicit_roster_classification'
                            : 'explicit_internal_test_classification';
                        const proofValid = persisted.schema === 'syncview_attribution_v1'
                            && persisted.owner_kind === ownerKind
                            && persisted.source === expectedSource
                            && persisted.explicit_owner_approved === true
                            && !!persisted.explicit_decision_ref
                            && /^[a-f0-9]{64}$/.test(persisted.explicit_manifest_sha256)
                            && String(row.client_slug || '').trim() === persisted.client_slug;
                        if (!proofValid) {
                            attribution = needs({
                                mappingRevision: persisted.mapping_revision,
                                reason: 'persisted_explicit_owner_proof_invalid'
                            });
                        } else {
                        attribution = resolved(persisted.client_slug, persisted.source, {
                            ownerKind,
                            mappingRevision: persisted.mapping_revision,
                            repairRequired: persisted.repair_required,
                            reason: persisted.reason || persisted.source
                        });
                        }
                    } else {
                        attribution = needs({
                            mappingRevision: persisted.mapping_revision,
                            reason: 'persisted_resolution_is_not_currently_verifiable'
                        });
                    }
                } else if (persisted.state === 'provisional_child_family') {
                    attribution = needs({
                        mappingRevision: persisted.mapping_revision,
                        reason: persisted.reason || 'awaiting_child_family_validation',
                        expectedProvisionalClientSlug: persisted.provisional_client_slug
                    });
                }
                attribution.directProjectId = directProjectId;
                attribution.mappedProjectId = mappedProjectId;
                attribution.persistedState = persisted.state;
                result.set(id, attribution);
            });
            const childrenByParent = new Map();
            parentLinks.forEach((parentId, childId) => {
                if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
                childrenByParent.get(parentId).push(childId);
            });
            let changed = true;
            let passes = 0;
            while (changed && passes++ <= result.size) {
                changed = false;
                childrenByParent.forEach((childIds, parentId) => {
                    const parent = result.get(parentId);
                    if (!parent || parent.state !== 'needs_attribution') return;
                    const children = childIds.map(id => result.get(id)).filter(Boolean);
                    if (children.length !== childIds.length || children.some(item => item.state === 'needs_attribution')) return;
                    if (children.some(item => item.state === 'conflict')) {
                        result.set(parentId, conflict({ reason: 'child_family_conflict' }));
                        changed = true;
                        return;
                    }
                    const slugs = [...new Set(children.map(item => item.state === 'resolved' ? item.clientSlug : item.provisionalClientSlug).filter(Boolean))];
                    if (slugs.length === 1) {
                        if (parent.expectedProvisionalClientSlug && parent.expectedProvisionalClientSlug !== slugs[0]) {
                            result.set(parentId, conflict({ reason: 'persisted_provisional_client_disagrees_with_child_family' }));
                        } else {
                            result.set(parentId, Object.assign({}, parent, {
                                state: 'provisional_child_family',
                                provisionalClientSlug: slugs[0],
                                source: 'unanimous_child_family',
                                repairRequired: true,
                                reason: 'projectless_parent_unanimous_child_family'
                            }));
                        }
                        changed = true;
                    } else if (slugs.length > 1) {
                        result.set(parentId, conflict({ reason: 'child_family_conflict' }));
                        changed = true;
                    }
                });
            }
            changed = true;
            passes = 0;
            /*
             * OWNER RULING 2026-08-24: a parent does not out-vote a child that
             * already knows its own answer.
             *
             * A row is SELF-ATTRIBUTED when its resolution came from its own
             * Linear project, or from an explicit owner classification. Neither
             * was inherited from anywhere: `nearest_mapped_ancestor` reads a
             * parent, `unanimous_child_family` reads children, and those two
             * genuinely depend on the family agreeing. `direct_project` and
             * `explicit_*` do not.
             *
             * Why this matters. One person can be three clients here -- a
             * personal brand, a paid-ads brand and a DJ brand, three roster rows
             * and three Linear projects -- and a manager who plans a week for
             * that person files ONE parent with children across two of them.
             * That is a legitimate way to work, and every child in it carries its
             * own project, so nothing is ambiguous. The old rule read the
             * disagreement as a conflict, and the fixpoint below then propagated
             * it to every relative: a live family of 11 went read-only, seven of
             * them sitting in the client approval queue and one already overdue,
             * because writes are gated on attribution being resolved.
             *
             * The conflict this LOSES was never protecting anything. If a child
             * really is in the wrong project, it is mis-attributed either way --
             * checking its parent cannot fix that. All the old rule added was ten
             * more unusable rows beside it.
             *
             * The webhook path already decided this exact question the same way
             * on 2026-08-23 (`own_project_outranks_parent`, linear-inbound). Two
             * components, one question, and until now they answered it
             * differently.
             */
            const selfAttributed = (entry) => !!entry && entry.state === 'resolved'
                && (entry.source === 'direct_project' || /^explicit_/.test(String(entry.source || ''))
                    || /^native_intake_/.test(String(entry.source || '')));
            while (changed && passes++ <= result.size * 2) {
                changed = false;
                parentLinks.forEach((parentId, childId) => {
                    const parent = result.get(parentId);
                    const child = result.get(childId);
                    if (!parent || !child) return;
                    if (parent.state === 'conflict' || child.state === 'conflict') {
                        if (parent.state !== 'conflict' && !selfAttributed(parent)) {
                            result.set(parentId, conflict({ reason: 'hierarchy_conflict_propagated' }));
                            changed = true;
                        }
                        if (child.state !== 'conflict' && !selfAttributed(child)) {
                            result.set(childId, conflict({ reason: 'hierarchy_conflict_propagated' }));
                            changed = true;
                        }
                        return;
                    }
                    const parentSlug = parent.state === 'resolved' ? parent.clientSlug : parent.provisionalClientSlug;
                    const childSlug = child.state === 'resolved' ? child.clientSlug : child.provisionalClientSlug;
                    if (parentSlug && childSlug && parentSlug !== childSlug) {
                        // Both sides settled it from their own project: a mixed
                        // family, not a broken one. Leave each row on the client
                        // its own project names.
                        if (selfAttributed(parent) && selfAttributed(child)) return;
                        result.set(parentId, conflict({ reason: 'parent_child_client_conflict' }));
                        result.set(childId, conflict({ reason: 'parent_child_client_conflict' }));
                        changed = true;
                    }
                });
            }
            return result;
        }
        function _prodAdapter(input) {
            const raw = input || _prodState;
            const clients = raw.clients || [];
            const activeClients = clients.filter(client => client && client.slug && client.active === true);
            const members = raw.members || [];
            const batches = raw.batches || [];
            const deliverables = (raw.deliverables || []).filter(_prodDeliverableLive);
            const BATCHES = {};
            batches.forEach(b => {
                if (!b || !b.id) return;
                BATCHES[String(b.id)] = Object.assign({}, b);
            });
            const EDITORS = {};
            members.forEach(m => {
                if (!m || !m.id) return;
                const name = m.name || m.email || 'Unknown';
                const color = /^#[0-9a-f]{6}$/i.test(String(m.avatar_color || ''))
                    ? m.avatar_color
                    : PROD_EDITOR_COLORS[_prodHashText(name) % PROD_EDITOR_COLORS.length];
                EDITORS[String(m.id)] = { id: String(m.id), name, init: _prodInitials(name), color, active: m.active !== false, raw: m };
            });
            const PROJECTS = {};
            activeClients.forEach(c => {
                if (!c || !c.slug) return;
                const slug = String(c.slug);
                const descField = _prodHasOwn(c, 'board_desc') ? 'board_desc' : _prodHasOwn(c, 'desc') ? 'desc' : '';
                PROJECTS[slug] = {
                    id: slug,
                    client: slug,
                    name: c.display_name || slug,
                    emoji: c.emoji || '',
                    team: c.kind === 'graphics' ? 'graphics' : c.kind === 'video' ? 'video' : '',
                    desc: descField ? (c[descField] == null ? '' : c[descField]) : '',
                    descLoaded: !!descField,
                    raw: c
                };
            });
            const parentLinks = _prodResolveParentLinks(deliverables);
            const attributions = _prodResolveAttributions(deliverables, activeClients, parentLinks);
            const ISSUES = deliverables.map(d => {
                const descField = _prodHasOwn(d, 'brief') ? 'brief' : _prodHasOwn(d, 'desc') ? 'desc' : '';
                const batchId = String(d && d.batch_id || '');
                const batch = BATCHES[batchId] || null;
                // Typed asset URLs arrive only through the authenticated,
                // no-store asset_access_read response. Bootstrap rows never
                // initialize or substitute those protected values.
                const assets = {
                    filming_plan: '',
                    raw_footage: '',
                    delivery_folder: '',
                    deliverable_file: ''
                };
                const attribution = attributions.get(String(d.id || '')) || {
                    state: 'needs_attribution',
                    clientSlug: '',
                    provisionalClientSlug: '',
                    repairRequired: true,
                    reason: 'attribution_missing'
                };
                const project = attribution.state === 'resolved'
                    ? attribution.clientSlug
                    : attribution.state === 'provisional_child_family'
                        ? attribution.provisionalClientSlug
                        : attribution.state === 'conflict'
                            ? PROD_ATTRIBUTION_CONFLICT
                            : PROD_ATTRIBUTION_NEEDS;
                /* WHICH IDENTIFIER NAMES THIS ROW, and which one merely used to.

                   `identifier` is a SNAPSHOT. The b1 import writes it and
                   `linear_identifier` from the same Linear value
                   (scripts/b1-linear-backfill.js), and nothing maintains it
                   afterwards: native creation writes it null, and linear-inbound
                   refreshes `linear_identifier` -- and `team` -- on every webhook
                   while never touching it. So a Linear TEAM MOVE re-keys the
                   issue (VID-13553 becomes GRA-7197) and the snapshot keeps the
                   retired number for ever.

                   Reading the snapshot FIRST is what made those rows
                   unreachable. The Workload popover links every row as
                   ?prod=1&d=<Linear identifier> -- the one deep link that
                   carries no row id -- so ?d=GRA-7197 asked for a row this tab
                   called VID-13553, _prodIssue matched neither field, and the
                   deep-link fallback published "has no row in Production" over a
                   row the page had already fetched (_prodDeepLinkRowQuery reads
                   all three columns). The command palette could not find it by
                   its Linear number either, and the list printed a VID number on
                   a Graphics row. Owner report 2026-09-07, opening a client
                   rollup on the Workload calendar.

                   Measured 2026-09-07 across all 6,369 browser-visible rows with
                   the keys this adapter uses: 7 disagree, every one a graphics
                   row still carrying a VID- snapshot; no row has an `identifier`
                   without a `linear_identifier`, so nothing else moves; and no
                   string is one row's displayId and another row's
                   linear_identifier, so the alias below cannot collide.

                   The maintained column wins, and a disagreeing snapshot stays
                   resolvable as an ALIAS, so a reference to the retired number
                   opens the row rather than being told it does not exist.

                   WHAT THE ALIAS RESOLVES, AND FOR HOW LONG. It resolves a
                   divergence FOR AS LONG AS THE DATA CARRIES ONE -- not for
                   ever. The repair
                   (migrations/2026-09-07-deliverable-identifier-team-move-repair.sql)
                   makes the two columns agree, so it empties for today's seven
                   and the retired number stops resolving here. That is the end
                   state, not a regression, and review on #1333 was right that
                   the first wording claimed otherwise.

                   Two reasons it is the right end state. No surface in the
                   product has ever EMITTED a link carrying the snapshot --
                   every _prodOpenDeliverable caller passes the canonical row
                   id, which is what _prodSetQuery writes, and every Workload
                   link carries the current Linear identifier. And a re-keyed
                   number names nothing in Linear either: it is not a handle
                   anyone can still resolve anywhere, so keeping it alive here
                   would mean this tab is the last system on earth answering to
                   it. The repair records it in `deliverable_events` for
                   forensics and reversal.

                   What the alias is still FOR, after that: the window between a
                   team move and its repair, which is where these seven lived
                   for two weeks, and every future one -- linear-inbound still
                   does not re-stamp `identifier` on a team move, so any row
                   moved between teams while Linear is connected lands here and
                   resolves without waiting for a second repair. */
                const linearIdent = String(d.linear_identifier || '');
                const importIdent = String(d.identifier || '');
                const issue = {
                    id: String(d.id || ''),
                    displayId: linearIdent || importIdent || String(d.id || ''),
                    aliasId: importIdent && importIdent !== linearIdent ? importIdent : '',
                    rawId: String(d.id || ''),
                    team: d.team || (batch && batch.team) || '',
                    project,
                    authorityProject: attribution.state === 'resolved' ? attribution.clientSlug : '',
                    attribution,
                    identityRepair: _prodRawIdentityRepair(d),
                    storedClientSlug: d.client_slug || '',
                    title: d.title || '',
                    parent: parentLinks.get(String(d.id || '')) || null,
                    status: _prodArtifactStatus(d.status),
                    sourceStatus: d.status || '',
                    assignee: d.assignee_id || '',
                    due: _prodFmtDate(d.due_date),
                    dueRaw: d.due_date || '',
                    created: _prodFmtDate(d.created_at),
                    createdRaw: d.created_at || '',
                    updated: _prodFmtDate(d.updated_at),
                    updatedRaw: d.updated_at || '',
                    statusAtRaw: d.status_at || '',
                    sub: null,
                    desc: descField ? (d[descField] == null ? '' : d[descField]) : '',
                    descLoaded: !!descField,
                    assets,
                    // Compatibility for the legacy property helper only. Never
                    // collapse a batch folder into the canonical deliverable.
                    file: assets.deliverable_file,
                    comments: [],
                    batchId,
                    batchName: batch ? (batch.name || '') : '',
                    isHierarchyParent: false,
                    raw: d
                };
                return issue;
            }).filter(i => i.id);
            // Native cards: the parent Linear issue exists only as a batch, so
            // synthesize a read-only parent node per referenced batch and hang
            // the children under it. Applied only where the deliverable map
            // resolved nothing, so imported cards are untouched.
            const batchParents = _prodResolveBatchParentNodes(deliverables, batches, parentLinks);
            if (batchParents.links.size) {
                const issueIds = new Set(ISSUES.map(i => i.id));
                ISSUES.forEach(i => {
                    if (!i.parent && batchParents.links.has(i.id)) i.parent = batchParents.links.get(i.id);
                });
                const activeBySlug = new Map(activeClients.map(c => [String(c.slug || ''), c]));
                batchParents.nodes.forEach(node => {
                    // nodeId is the batch id for a single-parent batch and a
                    // suffixed id for the second parent of a two-team batch, so
                    // both teams keep their own row instead of one overwriting
                    // the other. See _prodResolveBatchParentNodes.
                    if (issueIds.has(node.nodeId)) return;
                    const slug = String(node.batch.client_slug || '');
                    const resolvedClient = activeBySlug.has(slug);
                    ISSUES.push({
                        id: node.nodeId,
                        displayId: node.identifier || node.nodeId,
                        // A synthetic parent is minted from the batch row, which
                        // carries no retired identifier to alias.
                        aliasId: '',
                        rawId: node.nodeId,
                        team: node.team,
                        project: resolvedClient ? slug : PROD_ATTRIBUTION_NEEDS,
                        authorityProject: resolvedClient ? slug : '',
                        // The batch names its client natively (the gateway wrote
                        // it), so a roster match is a resolved attribution.
                        attribution: resolvedClient
                            ? { state: 'resolved', clientSlug: slug, provisionalClientSlug: '', repairRequired: false, reason: '' }
                            : { state: 'needs_attribution', clientSlug: '', provisionalClientSlug: '', repairRequired: true, reason: 'attribution_missing' },
                        identityRepair: null,
                        storedClientSlug: slug,
                        title: node.batch.name || node.identifier || 'Batch',
                        parent: null,
                        // The planner creates every batch parent as Todo and no
                        // sync updates it afterwards; the children carry the
                        // real statuses, which is what the sub counter shows.
                        status: _prodArtifactStatus('todo'),
                        sourceStatus: 'todo',
                        assignee: '',
                        due: '', dueRaw: '',
                        created: _prodFmtDate(node.batch.created_at), createdRaw: node.batch.created_at || '',
                        updated: _prodFmtDate(node.batch.updated_at), updatedRaw: node.batch.updated_at || '',
                        statusAtRaw: '',
                        sub: null,
                        desc: node.batch.description == null ? '' : String(node.batch.description),
                        /* Whether the description was actually READ, not `true`.
                           The two sibling builders above derive this from the
                           key that was present; this one hardcoded `true`. A
                           batch-parent row claiming its description is loaded
                           when it is not renders a confident "No description."
                           over a batch that has one -- and the cache drops batch
                           descriptions by design, so a cached first paint is
                           precisely when that lie is told. 1,186 batch parents
                           carry both a description and a parent map today.
                           `descField` is not in scope here, so this asks the
                           batch directly, the same question _prodHasOwn answers
                           for the batch detail panel. */
                        descLoaded: _prodHasOwn(node.batch, 'description') || _prodHasOwn(node.batch, 'desc'),
                        // The batch row itself holds the folder links for the
                        // post, so the panel can show them without the
                        // deliverable-scoped asset prober, which has no row to
                        // authorize against. (No apostrophes in this comment on
                        // purpose: the test slicers track quotes, not comments.)
                        assets: {
                            filming_plan: String(node.batch.filming_doc_url || ''),
                            raw_footage: String(node.batch.footage_folder_url || ''),
                            delivery_folder: String(node.batch.delivery_folder_url || ''),
                            deliverable_file: ''
                        },
                        file: '',
                        comments: [],
                        batchId: node.batchId,
                        batchName: node.batch.name || '',
                        isHierarchyParent: false,
                        syntheticBatchParent: true,
                        linearUrl: node.url,
                        raw: node.batch
                    });
                });
            }
            const parentSet = new Set(ISSUES.filter(i => i.parent).map(i => i.parent));
            ISSUES.forEach(i => {
                if (parentSet.has(i.id)) {
                    const kids = ISSUES.filter(k => k.parent === i.id);
                    i.isHierarchyParent = true;
                    i.sub = [kids.filter(k => _prodIsDone(k.status)).length, kids.length];
                }
            });
            const issueCounts = ISSUES.reduce((acc, i) => {
                if (!i.parent) acc[i.project] = (acc[i.project] || 0) + 1;
                return acc;
            }, {});
            const CLIENTS = activeClients.map(c => {
                const slug = String(c && c.slug || '');
                if (!slug) return null;
                return {
                    id: slug,
                    client: slug,
                    name: c.display_name || slug,
                    status: _prodBoardStatus(c.board_status),
                    lead: c.lead_member_id || '',
                    issues: issueCounts[slug] || 0,
                    target: _prodFmtDate(c.target_date),
                    targetRaw: c.target_date || '',
                    desc: c.board_desc || '',
                    emoji: c.emoji || '',
                    raw: c
                };
            }).filter(Boolean);
            return { ISSUES, PROJECTS, CLIENTS, EDITORS, BATCHES };
        }
        function _prodData() {
            if (!_prodState.adapter) _prodState.adapter = _prodAdapter();
            return _prodState.adapter;
        }
        function _prodIssues() { return _prodData().ISSUES || []; }
        function _prodProjects() { return _prodData().PROJECTS || {}; }
        function _prodClients() { return _prodData().CLIENTS || []; }
        function _prodEditors() { return _prodData().EDITORS || {}; }
        function _prodIssue(id) {
            const sid = String(id || '');
            if (!sid) return null;
            const rows = _prodIssues();
            /* TWO PASSES, and the order is the point. `aliasId` holds the
               identifier a row carried before a Linear team move re-keyed it
               (see the adapter), so it is a real name for the row and must
               resolve -- but a canonical match anywhere in the set has to beat
               an alias match, or a retired number that some other row has since
               been given would open the wrong deliverable. No such collision
               exists in the live set today; this is what keeps that from being
               load-bearing. */
            return rows.find(i => i.id === sid || i.displayId === sid)
                || rows.find(i => i.aliasId && i.aliasId === sid)
                || null;
        }
        /* The CANONICAL row id for whatever is open, which is not always what
           `_prodState.openId` holds.

           A deep link carries the LINEAR IDENTIFIER -- ?d=VID-13634, the form
           every shared card link uses -- and the URL parser stores that string
           verbatim. _prodIssue() resolves it happily, because it matches on
           `id` OR `displayId`, so the row opens and the page looks right. But
           every per-row read was then keyed by "VID-13634" while every panel
           rendered from issue.id. One row, two cache keys.

           Comments made it visible: render() draws the loading skeleton when it
           has no state for the key it is given, ensure() does nothing once a
           state exists for the key IT is given, and refresh() returns early
           while a load is in flight. The read populated one key for ever and
           the panel read the other, so the thread sat on the skeleton with no
           error, no Retry, and no way out inside the tab. Reported 2026-08-31
           against the shared link for VID-13634. The description, label and
           asset reads split the same way and degraded more quietly, because
           their panels seed a state rather than returning a placeholder.

           NORMALISED AT THE POINT OF USE, NEVER IN THE STATE. The first version
           of this fix rewrote `_prodState.openId` itself, and review caught
           what that breaks: _prodApplyDeepLinkFallback compares openId against
           `_prodState.deepLink.id` literally to decide whether the reader has
           navigated away. Rewriting one side makes every deep link look like
           `openedElsewhere`, which skips the authoritative re-apply AND
           suppresses the missing-target notice -- so a row that went away
           between the cached paint and the live read would drop the reader on
           the list with no explanation. That is the exact 2026-08-24 report the
           fallback was written to fix. openId stays the string the URL asked
           for; only the read keys move. */
        function _prodOpenRowId() {
            const id = String(_prodState.openId || '');
            if (!id) return '';
            const row = _prodIssue(id);
            return row ? String(row.id) : id;
        }
        function _prodClient(slug) {
            return _prodProjects()[String(slug || '')] || null;
        }
        function _prodBatch(id) {
            return _prodData().BATCHES[String(id || '')] || null;
        }
        /* A batch's REAL parent card, when it has exactly one.
         *
         * `linear_parent_ids` is keyed by team with the same vocabulary
         * `_calNativeBatchParentTeams` reads (video/vid, graphics/graphic/gra);
         * each entry names the parent Linear issue by identifier/id/uuid. A
         * batch imported from Linear has a real deliverable row for that
         * parent -- `isHierarchyParent` true, `syntheticBatchParent` unset --
         * while a native post-cutoff batch has no such row: `_prodIssue`
         * resolves nothing, or resolves only the read-only synthetic parent
         * this same batch mints for its own children, which is never the
         * answer to "does this batch have a real parent card". Two distinct
         * resolved parents (one per team) is a genuine "no single card"
         * answer, not a bug -- the caller falls back to the batch view. */
        function _prodBatchParentIssue(batch) {
            const parents = batch && batch.linear_parent_ids;
            if (!parents || typeof parents !== 'object') return null;
            const ids = new Set();
            Object.keys(parents).forEach(key => {
                const k = String(key || '').trim().toLowerCase();
                if (k !== 'video' && k !== 'vid' && k !== 'graphics' && k !== 'graphic' && k !== 'gra') return;
                const entry = parents[key];
                if (!entry) return;
                const id = typeof entry === 'string' ? entry.trim()
                    : String(entry.identifier || entry.id || entry.uuid || entry.linear_issue_id || '').trim();
                if (id) ids.add(id);
            });
            const resolved = [];
            ids.forEach(id => {
                const row = _prodIssue(id);
                if (row && row.isHierarchyParent && row.syntheticBatchParent !== true) resolved.push(row);
            });
            return resolved.length === 1 ? resolved[0] : null;
        }
        function _prodMember(id) {
            return _prodEditors()[String(id || '')] || null;
        }
        function _prodDisplayClient(slug) {
            if (slug === PROD_ATTRIBUTION_NEEDS) return 'Needs attribution';
            if (slug === PROD_ATTRIBUTION_CONFLICT) return 'Attribution conflict';
            const c = _prodClient(slug);
            return c ? (c.name || c.id) : 'Needs attribution';
        }
        function _prodAttributionResolved(issue) {
            return !!(issue && issue.attribution && issue.attribution.state === 'resolved');
        }
        /* A CARD THIS APP CREATED SECONDS AGO IS NOT A BROKEN CLIENT MAPPING.
         *
         * Native creation writes the deliverable row first and mirrors it into
         * Linear after; the attribution resolver reads only the mirrored fields
         * (own project, then ancestors, then the persisted stamp), so for the
         * few seconds before Linear answers a brand new card resolves to
         * `needs_attribution` and every write control on it is gated shut.
         *
         * Measured on the live row that produced the 2026-09-09 report
         * (GRA-7437, created from the calendar at 19:28:29Z): the mirror stamped
         * `resolved` / `direct_project` at 19:28:41Z, twelve seconds later, and
         * the row was correct on both sides of that gap. The gate was right for
         * those twelve seconds -- nothing had confirmed who owns the row -- but
         * it announced itself as "Client attribution needs repair", so an SMM
         * reasonably read a transient sync as a broken client and reported it as
         * one.
         *
         * THIS IS COPY ONLY. The gate still refuses the write, the row still
         * groups under the needs-attribution sentinel, and no verdict moves.
         * The state is narrowed hard so nothing else can borrow the softer
         * wording: no stamp has ever been persisted on the row, no project is
         * known from any source, the mirror has not yet returned a Linear issue,
         * and the slug SyncView itself stored is a currently ACTIVE roster
         * client. A row Linear actively invalidated carries a persisted stamp
         * and keeps the repair banner it has always had.
         *
         * ONLY WHILE A SYNC IS STILL PLAUSIBLE, i.e. the row's team has not
         * cut over to native intake (_prodNativeEpochOn). Past cutover an
         * empty linear_issue_uuid is not a gap that Linear will ever fill --
         * the card was never meant to mirror there -- so calling it "still
         * syncing" would misreport a normal, finished native card forever.
         * `_prodAttributionGateText`'s own fallback ("Client attribution
         * needs repair before writing.") already names that real state
         * correctly once this returns false, so nothing else needs to change.
         */
        function _prodAttributionSyncPending(issue) {
            const attribution = issue && issue.attribution;
            if (!attribution || attribution.state !== 'needs_attribution') return false;
            if (attribution.persistedState) return false;
            if (attribution.directProjectId || attribution.mappedProjectId) return false;
            const raw = issue.raw || {};
            if (String(raw.linear_issue_uuid || '').trim()) return false;
            if (_prodNativeEpochOn(issue && issue.team)) return false;
            const slug = String(issue.storedClientSlug || '').trim();
            return !!(slug && _prodClient(slug));
        }
        function _prodAttributionSyncClientLabel(issue) {
            return _prodDisplayClient(String(issue && issue.storedClientSlug || ''));
        }
        function _prodAttributionGateText(issue) {
            const attribution = issue && issue.attribution;
            if (!attribution || attribution.state === 'resolved') return '';
            if (_prodAttributionSyncPending(issue)) return 'This card is still syncing to Linear. It becomes editable a few seconds after Linear answers.';
            if (attribution.state === 'conflict') return 'Client attribution conflicts across this issue family. Repair it before writing.';
            if (attribution.state === 'provisional_child_family') return 'Client attribution is provisional from child issues. Repair it before writing.';
            return 'Client attribution needs repair before writing.';
        }
        function _prodIdentityRepairGateText(issue) {
            return issue && issue.identityRepair && issue.identityRepair.required
                ? 'Linear identity repair is required. This saved issue stays read-only so no change can reach the conflicting Linear issue.'
                : '';
        }
        function _prodStatusLabel(status) { return PROD_STATUS[_prodArtifactStatus(status)] || status || 'Unknown'; }
        function _prodBoardLabel(status) { return PROD_BOARD_STATUS[_prodBoardStatus(status)] || status || 'Unknown'; }
        function _prodTeamLabel(team) {
            return team === 'video' ? 'Video' : team === 'graphics' ? 'Graphics' : 'All teams';
        }
        function _prodClientFilterLabel() {
            return _prodState.clientSlug ? _prodDisplayClient(_prodState.clientSlug) : '';
        }
        function _prodAvatar(member, size) {
            const s = size || 18;
            if (!member) return '<span class="prod-avatar empty" style="width:' + s + 'px;height:' + s + 'px">' + _prodIcon('assign') + '</span>';
            const color = /^#[0-9a-f]{6}$/i.test(String(member.color || '')) ? member.color : 'var(--prod-accent)';
            return '<span class="prod-avatar" style="width:' + s + 'px;height:' + s + 'px;background:' + color + ';font-size:' + Math.max(8, Math.round(s * .42)) + 'px">' + _calEsc(member.init || _prodInitials(member.name)) + '</span>';
        }
        function _prodIssueLabel(d) {
            return d && (d.displayId || d.identifier || d.linear_identifier || d.id) || '';
        }
        /* PRESENTATION ONLY. A natively-created post has no short identifier
           of its own: the mint covers videos and thumbnails, not the batch
           that groups them, so the synthetic parent node fell through to its
           raw `bat_<uuid>` id in the list's id cell, the breadcrumb and the
           detail header. Owner, 2026-09-20 cutoff-day pass: "the batch ID is
           super long ... I don't know if that's normal". Those three sites
           read "Post" instead. Everything that treats the label as an
           IDENTITY -- _prodCopyIssueIds (Copy issue ID), the palette's search
           field, sort keys, `title || label` fallbacks -- keeps calling
           _prodIssueLabel and still gets the real id (Codex P1 on PR 1455). */
        function _prodIssueDisplayLabel(d) {
            if (d && d.syntheticBatchParent === true) return 'Post';
            const label = _prodIssueLabel(d);
            return _prodIsInternalId(label) ? '' : label;
        }
        /* An INTERNAL id is a storage key, never a name: bat_<uuid>, del_<uuid>,
           b1_b_<uuid>, a bare uuid, or a two-team batch node (`bat_...::uuid`).
           A Linear number such as SYN-123 has no underscore and is not one.
           Every place a person reads a parent or batch NAME goes through
           _prodSafeName so a missing name can never fall through to the key
           (owner report 2026-09-29: "Sub-issue of bat_44ca2350-7bff-..."). */
        function _prodIsInternalId(value) {
            const s = String(value == null ? '' : value).trim();
            if (!s) return false;
            const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
            /* The WHOLE value must be a key: a prefix match would swallow a real
               title such as "video_20260929 launch". */
            return new RegExp('^(?:[a-z][a-z0-9]{0,5}_){1,2}' + uuid + '(?:::' + uuid + ')?$', 'i').test(s)
                || new RegExp('^' + uuid + '$', 'i').test(s);
        }
        function _prodSafeName(value) {
            const s = String(value == null ? '' : value).trim();
            return s && !_prodIsInternalId(s) ? s : '';
        }
        /* The name a row already carries: its title, else the batch name it
           was projected from. Empty means "not known yet", never "show the id". */
        function _prodKnownName(d) {
            if (!d) return '';
            return _prodSafeName(d.title) || _prodSafeName(d.batchName)
                || _prodSafeName(d.raw && d.raw.name) || _prodSafeName(d.raw && d.raw.title);
        }
        /* Names fetched on demand for a parent the page has no name for.
           id -> { state: 'pending' | 'done' | 'failed', name, at }. A failed
           or timed-out lookup expires so a later render retries it, and a
           hung request is abandoned after PROD_PARENT_NAME_TIMEOUT_MS: the
           in-flight marker used to be cleared only when the request settled,
           so one request that never answered froze the header for the whole
           session. */
        const PROD_PARENT_NAME_TIMEOUT_MS = 6000;
        const PROD_PARENT_NAME_RETRY_MS = 15000;
        const _prodParentNames = new Map();
        function _prodParentNameState(id) {
            const sid = String(id || '');
            const held = sid ? _prodParentNames.get(sid) : null;
            if (!held) return null;
            if (held.state === 'failed' && Date.now() - held.at > PROD_PARENT_NAME_RETRY_MS) {
                _prodParentNames.delete(sid);
                return null;
            }
            return held;
        }
        function _prodEnsureParentName(id, kind) {
            const sid = String(id || '');
            if (!sid || _prodParentNameState(sid)) return;
            const record = { state: 'pending', name: '', at: Date.now() };
            _prodParentNames.set(sid, record);
            let settled = false;
            const finish = (state, name) => {
                if (settled) return;
                settled = true;
                record.state = state;
                record.name = _prodSafeName(name);
                record.at = Date.now();
                if (record.name) record.state = 'done';
                else if (state === 'done') record.state = 'failed';
                if (typeof document !== 'undefined' && document.getElementById('prodRoot') && typeof _prodRender === 'function') {
                    try { _prodRender(); } catch (e) { /* the next render repaints */ }
                }
            };
            const timer = setTimeout(() => finish('failed', ''), PROD_PARENT_NAME_TIMEOUT_MS);
            const clean = sid.split('::')[0];
            const read = kind === 'batch'
                ? _prodRestRows('batches', 'id,name', 'id=eq.' + encodeURIComponent(clean), 1, 1)
                    .then(rows => rows && rows[0] && rows[0].name)
                : _prodLoadDeliverableProjection('id=eq.' + encodeURIComponent(clean))
                    .then(rows => rows && rows[0] && rows[0].title);
            Promise.resolve(read).then(name => { clearTimeout(timer); finish('done', name); },
                () => { clearTimeout(timer); finish('failed', ''); });
        }
        /* The parent's name as HTML for a header or link: the real name when the
           page has one, a grey skeleton while a lookup is in flight, and a plain
           neutral word once the lookup has come back empty. Never an id. */
        function _prodParentNameHTML(parent, parentId) {
            const known = _prodKnownName(parent);
            if (known) return _calEsc(known);
            const id = String(parent && parent.id || parentId || '');
            const batchLike = !!(parent && (parent.syntheticBatchParent === true || parent.batchId)) || /^(?:bat|b1_b)_/i.test(id);
            let looked = _prodParentNameState(id);
            if (looked && looked.name) return _calEsc(looked.name);
            if (!looked && id) {
                _prodEnsureParentName(id, batchLike ? 'batch' : 'deliverable');
                looked = _prodParentNameState(id);
            }
            if (!looked || looked.state === 'pending') {
                return '<span class="prod-name-skel sv-skeleton" data-prod-parent-skeleton="1" role="img" aria-label="Loading name"></span>';
            }
            return batchLike ? 'Untitled post' : 'Untitled issue';
        }
        /* A provider card's identifier is 9 characters; a native card has none
           yet and falls through to the 40-character deliverable id. The cell
           truncates either way now (see `.prod-id`), so the long one has to
           stay recoverable: the full value goes on the hover, exactly as
           `_prodTitleAttrs` already does for a clipped title.
           THE PROPER FIX IS THE IDENTIFIER MINT CAPABILITY -- a native card
           should carry a short identifier of its own rather than show a raw id
           at all. This keeps the row readable until it does, and is not a
           substitute for it. */
        function _prodIssueIdHTML(d) {
            const label = _prodIssueDisplayLabel(d);
            return '<span class="prod-id"' + (label ? _prodTitleAttrs(label) : '') + '>' + _calEsc(label) + '</span>';
        }
        function _prodFmtDate(v) {
            // Compact written display ("Jul 15") for every column/pill; year accuracy lives in the
            // hover via _prodFmtDateFull (owner decisions 2026-07-17/18: no two-line wrap on desktop).
            if (!v) return '';
            const s = String(v).slice(0, 10);
            const p = s.split('-');
            if (p.length !== 3) return s;
            return PROD_MON[Math.min(11, Math.max(0, (+p[1] || 1) - 1))] + ' ' + (+p[2] || 1);
        }
        function _prodFmtDateFull(v) {
            if (!v) return '';
            const s = String(v).slice(0, 10);
            const p = s.split('-');
            if (p.length !== 3) return s;
            const label = PROD_MON[Math.min(11, Math.max(0, (+p[1] || 1) - 1))] + ' ' + (+p[2] || 1);
            return p[0] === _prodPolicyTodayISO().slice(0, 4) ? label : label + ', ' + p[0];
        }
        function _prodStatusType(status) {
            const m = PROD_STATUS_META[_prodArtifactStatus(status)] || {};
            return m.type || 'unstarted';
        }
        function _prodIsDone(status) {
            return ['completed','canceled','duplicate'].includes(_prodStatusType(status)) || status === 'posted' || status === 'scheduled' || status === 'approved';
        }
        // PORT-DELTA: adapter status keys and aria attributes wrap the artifact statusSVG glyphs.
        function _prodStatusSVG(status) {
            const m = PROD_STATUS_META[_prodArtifactStatus(status)] || { type: 'unstarted', color: '#a8a8a8' };
            const c = m.color;
            if (m.type === 'triage') {
                return '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" fill="' + c + '" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14m1.013-4.492V8.982H6.987v1.526c0 .421-.51.647-.838.37L3.174 8.372a.482.482 0 0 1 0-.742L6.15 5.121c.328-.276.838-.05.838.371v1.526h2.026V5.492c0-.421.51-.647.838-.37l2.975 2.507a.48.48 0 0 1 0 .742L9.85 10.879c-.328.276-.838.05-.838-.371"/></svg>';
            }
            let inner = '';
            if (m.type === 'backlog') inner = '<circle cx="7" cy="7" r="6" fill="none" stroke="' + c + '" stroke-width="1.5" stroke-dasharray="1.4 1.74"/>';
            else if (m.type === 'started') inner = '<rect x="1" y="1" width="12" height="12" rx="6" fill="none" stroke="' + c + '" stroke-width="1.5"/><path fill="' + c + '" transform="translate(3.5,3.5)" d="' + (m.pie || '') + '"/>';
            else if (m.type === 'completed') inner = '<path fill-rule="evenodd" fill="' + c + '" d="M7 0C3.13401 0 0 3.13401 0 7C0 10.866 3.13401 14 7 14C10.866 14 14 10.866 14 7C14 3.13401 10.866 0 7 0ZM11.101 5.10104C11.433 4.76909 11.433 4.23091 11.101 3.89896C10.7691 3.56701 10.2309 3.56701 9.89896 3.89896L5.5 8.29792L4.10104 6.89896C3.7691 6.56701 3.2309 6.56701 2.89896 6.89896C2.56701 7.2309 2.56701 7.7691 2.89896 8.10104L4.89896 10.101C5.2309 10.433 5.7691 10.433 6.10104 10.101L11.101 5.10104Z"/>';
            else if (m.type === 'canceled') inner = '<path fill-rule="evenodd" fill="' + c + '" d="M7 14C10.866 14 14 10.866 14 7C14 3.13401 10.866 0 7 0C3.13401 0 0 3.13401 0 7C0 10.866 3.13401 14 7 14ZM5.03033 3.96967C4.73744 3.67678 4.26256 3.67678 3.96967 3.96967C3.67678 4.26256 3.67678 4.73744 3.96967 5.03033L5.93934 7L3.96967 8.96967C3.67678 9.26256 3.67678 9.73744 3.96967 10.0303C4.26256 10.3232 4.73744 10.3232 5.03033 10.0303L7 8.06066L8.96967 10.0303C9.26256 10.3232 9.73744 10.3232 10.0303 10.0303C10.3232 9.73744 10.3232 9.26256 10.0303 8.96967L8.06066 7L10.0303 5.03033C10.3232 4.73744 10.3232 4.26256 10.0303 3.96967C9.73744 3.67678 9.26256 3.67678 8.96967 3.96967L7 5.93934L5.03033 3.96967Z"/>';
            else if (m.type === 'duplicate') inner = '<circle cx="7" cy="7" r="7" fill="' + c + '"/><path d="M4.6 9.4 9.4 4.6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>';
            else inner = '<rect x="1" y="1" width="12" height="12" rx="6" fill="none" stroke="' + c + '" stroke-width="1.5"/>';
            return '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">' + inner + '</svg>';
        }
        function _prodStatusIcon(status, id) {
            const issue = id ? _prodIssue(id) : null;
            const attrs = issue
                ? _prodWriteGateAttrs(issue, 'status', { title: 'Change status', tip: 'Change status · S', info: _prodStatusLabel(status) + (_prodStatusAge(issue) ? ' ' + _prodStatusAge(issue) : '') })
                : ' title="' + _calEscAttr(_prodStatusLabel(status)) + '"';
            return '<span class="prod-status" data-status="' + _calEscAttr(_prodArtifactStatus(status)) + '" data-st="' + _calEscAttr(id || _prodArtifactStatus(status)) + '"' + attrs + (id ? ' onclick="return _prodStatusIconClick(event,' + _jsAttrArg(id) + ')"' : '') + '>' + _prodStatusSVG(status) + '</span>';
        }
        function _prodRawIcon(p, vb) { return '<svg width="16" height="16" viewBox="' + (vb || '0 0 16 16') + '" fill="currentColor">' + p + '</svg>'; }
        const PROD_ICON = {
            myissues: _prodRawIcon('<path fill-rule="evenodd" d="M1 4.75v-.5A3.25 3.25 0 0 1 4.25 1h.5a.75.75 0 0 1 0 1.5h-.5A1.75 1.75 0 0 0 2.5 4.25v.5a.75.75 0 0 1-1.5 0M11.25 1h.5A3.25 3.25 0 0 1 15 4.25v.5l-.004.077a.75.75 0 0 1-1.492 0L13.5 4.75v-.5a1.75 1.75 0 0 0-1.75-1.75h-.5a.75.75 0 0 1 0-1.5m-6.5 13.995h-.5A3.25 3.25 0 0 1 1 11.745v-.5l.004-.077a.75.75 0 0 1 1.492 0l.004.077v.5c0 .967.784 1.75 1.75 1.75h.5a.75.75 0 0 1 0 1.5m6.5.005h.5A3.25 3.25 0 0 0 15 11.75v-.5l-.004-.077a.75.75 0 0 0-1.492 0l-.004.077v.5a1.75 1.75 0 0 1-1.75 1.75h-.5a.75.75 0 0 0 0 1.5M10 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0"/>'),
            project: _prodRawIcon('<path fill-rule="evenodd" d="M7.331 1.07a3.2 3.2 0 0 1 1.338 0c.498.106.967.377 1.904.917l1.354.78c.937.541 1.406.812 1.747 1.19.301.334.53.728.669 1.156.157.484.157 1.025.157 2.107v1.56l-.003.718c-.007.63-.036 1.026-.154 1.389l-.057.158a3.2 3.2 0 0 1-.612.998l-.135.138c-.33.312-.792.578-1.612 1.051l-1.354.78-.623.357c-.55.309-.907.481-1.281.56l-.166.032a3.2 3.2 0 0 1-1.006 0l-.166-.031c-.374-.08-.73-.252-1.281-.561l-.623-.356-1.354-.78c-.82-.474-1.281-.74-1.612-1.052l-.135-.138a3.2 3.2 0 0 1-.612-.998l-.057-.158c-.118-.363-.147-.758-.154-1.39L1.5 8.78V7.22c0-.946 0-1.479.105-1.921l.052-.186c.122-.374.312-.723.56-1.028l.11-.128c.255-.284.583-.507 1.126-.83l.62-.36 1.354-.78c.82-.473 1.281-.739 1.718-.869zM3 7.22v1.56c0 1.183.018 1.439.084 1.643l.064.167q.11.246.292.449l.059.06c.151.143.427.318 1.323.835l1.354.78.632.36c.188.104.33.178.442.233V8.482l-4.247-1.93zm5.75 1.262v4.826c.212-.106.533-.282 1.074-.594l1.354-.78.628-.368c.499-.297.646-.407.754-.527l.113-.14q.158-.218.243-.476l.022-.081c.035-.144.051-.351.058-.835L13 8.78V7.22l-.004-.668zM7.82 2.51l-.177.027c-.159.034-.328.106-.835.39l-.632.359-1.354.78c-.896.517-1.172.692-1.323.834l-.059.06q-.046.051-.086.104l4.645 2.112 4.645-2.112-.084-.103c-.109-.12-.255-.23-.754-.528l-.628-.367-1.354-.78c-.897-.517-1.186-.668-1.386-.728l-.08-.021a1.7 1.7 0 0 0-.538-.027"/>'),
            issues: _prodRawIcon('<path fill-rule="evenodd" d="M13.25 5.25C14.2165 5.25 15 6.0335 15 7V11.75C15 13.5449 13.5449 15 11.75 15H6.75C5.7835 15 5 14.2165 5 13.25C5 12.8358 5.33579 12.5 5.75 12.5C6.16421 12.5 6.5 12.8358 6.5 13.25C6.5 13.3881 6.61193 13.5 6.75 13.5H11.75C12.7165 13.5 13.5 12.7165 13.5 11.75V7C13.5 6.86193 13.3881 6.75 13.25 6.75C12.8358 6.75 12.5 6.41421 12.5 6C12.5 5.58579 12.8358 5.25 13.25 5.25Z"/><path fill-rule="evenodd" d="M8.1543 1.00391C9.73945 1.08421 11 2.39489 11 4V8L10.9961 8.1543C10.9184 9.68834 9.68834 10.9184 8.1543 10.9961L8 11H4L3.8457 10.9961C2.31166 10.9184 1.08163 9.68834 1.00391 8.1543L1 8V4C1 2.39489 2.26055 1.08421 3.8457 1.00391L4 1H8L8.1543 1.00391ZM4 2.5C3.17157 2.5 2.5 3.17157 2.5 4V8C2.5 8.82843 3.17157 9.5 4 9.5H8C8.82843 9.5 9.5 8.82843 9.5 8V4C9.5 3.17157 8.82843 2.5 8 2.5H4Z"/>'),
            search: _prodRawIcon('<path fill-rule="evenodd" d="M7 2C9.76142 2 12 4.23858 12 7C12 8.11012 11.6375 9.13519 11.0254 9.96484L13.7803 12.7197C14.0723 13.0709 14.0549 13.5057 13.7803 13.7803C13.5057 14.0549 13.0709 14.0723 12.7764 13.832L9.96484 11.0254C9.13519 11.6375 8.11012 12 7 12C4.23858 12 2 9.76142 2 7C2 4.23858 4.23858 2 7 2ZM7 3.5C5.067 3.5 3.5 5.067 3.5 7C3.5 8.933 5.067 10.5 7 10.5C8.933 10.5 10.5 8.933 10.5 7C10.5 5.067 8.933 3.5 7 3.5Z"/>'),
            chevR: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6.5 4l4 4-4 4"/></svg>',
            chevD: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 6.5l4 4 4-4"/></svg>',
            filter: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3"/></svg>',
            display: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 4.5h10M3 8h10M3 11.5h10"/><circle cx="6" cy="4.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="10" cy="8" r="1.3" fill="currentColor" stroke="none"/><circle cx="6" cy="11.5" r="1.3" fill="currentColor" stroke="none"/></svg>',
            cal: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2.5" y="3.5" width="11" height="10" rx="2"/><path d="M2.5 6.5h11M5.5 2.5v2M10.5 2.5v2"/></svg>',
            assignI: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="6" r="2.2"/><path d="M4 12a4 4 0 0 1 8 0"/></svg>',
            dots: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="4" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12" cy="8" r="1.4"/></svg>',
            copy: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="5.5" y="5.5" width="8" height="8" rx="2"/><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/></svg>',
            trash: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M2.75 4.5h10.5M6.5 4.5V3.6a1.1 1.1 0 0 1 1.1-1.1h.8a1.1 1.1 0 0 1 1.1 1.1v.9M11.8 4.5l-.43 7.35a1.5 1.5 0 0 1-1.5 1.4H6.13a1.5 1.5 0 0 1-1.5-1.4L4.2 4.5M6.7 7.2v3.3M9.3 7.2v3.3"/></svg>',
            star: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M8 2.5l1.7 3.4 3.8.5-2.7 2.6.6 3.7L8 11l-3.4 1.7.6-3.7L2.5 6.4l3.8-.5z"/></svg>',
            bell: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M8 2.5a3.5 3.5 0 0 1 3.5 3.5c0 3 1 3.8 1.5 4.5H3c.5-.7 1.5-1.5 1.5-4.5A3.5 3.5 0 0 1 8 2.5ZM6.5 12a1.5 1.5 0 0 0 3 0"/></svg>',
            move: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M8 2.5v11M2.5 8h11M8 2.5 6.3 4.2M8 2.5l1.7 1.7M8 13.5l-1.7-1.7M8 13.5l1.7-1.7M2.5 8l1.7-1.7M2.5 8l1.7 1.7"/></svg>',
            back: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9.5 4l-4 4 4 4"/></svg>',
            check: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3.5 8.5l3 3 6-6.5"/></svg>',
            plus: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>',
            statusField: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5"/><path d="M7 2.2a4.8 4.8 0 0 1 0 9.6z" fill="currentColor"/></svg>'
        };
        // Wired-only glyph for the F95 freshness control. It stays OUT of
        // PROD_ICON so that object remains byte-identical to the locked artifact
        // icon set (test/port-fidelity-check.js enforces that).
        const PROD_REFRESH_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13.2 7.1a5.3 5.3 0 1 0-.5 3.3"/><path d="M13.5 3.4v3.7H9.8"/></svg>';
        // The sub-issue file pill. Kept OUT of PROD_ICON for the same reason as
        // the refresh glyph: that object is held byte-identical to the locked
        // artifact icon set by test/port-fidelity-check.js.
        const PROD_FILE_LINK_ICON = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.1-2.1a2.6 2.6 0 0 0-3.7-3.7l-1 1"/><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.4 8.9a2.6 2.6 0 0 0 3.7 3.7l1-1"/></svg>';
        function _prodIcon(name) {
            if (name === 'assign') return PROD_ICON.assignI;
            return PROD_ICON[name] || '';
        }
        function _prodClientEmoji(slug) {
            const c = _prodClient(slug);
            return c && c.emoji ? c.emoji : '';
        }
        function _prodProjectGlyph(project) {
            const p = typeof project === 'string' ? _prodClient(project) : project;
            return p && p.emoji ? _calEsc(p.emoji) : _prodIcon('project');
        }
        /* The batch view lists the batch's WORK, never the batch itself.
           Two kinds of row stand for the batch rather than for a deliverable,
           and both used to show up as an extra first "deliverable" titled
           with the batch's own name:
           - the synthetic batch parent this app mints in memory (it carries
             the batch's id, so a plain batchId filter caught it), and
           - an imported Linear parent issue that B1 filed as a row inside the
             same batch as its own children.
           A row with no children in this batch is real work and stays. */
        function _prodBatchRows(batchId) {
            const inBatch = _prodIssues().filter(d => batchId && d.batchId === batchId);
            const parentsHere = new Set(inBatch.map(d => d.parent).filter(Boolean));
            return inBatch.filter(d => d.syntheticBatchParent !== true && !parentsHere.has(d.id)).sort(_prodChildOrder);
        }
        /* Sub-issues group by TEAM first, then read alphabetically inside each
           group -- video work (Reel 1..12, Video 1..12) then graphics work
           (Thumbnail 1..12), never interleaved (owner 2026-08-19). Arriving
           order is whatever the rows were fetched in, which mixed the two teams
           and made a twelve-video batch unreadable.

           Titles are compared NUMERICALLY: a plain string sort puts Reel 10
           and Reel 11 ahead of Reel 2, which is precisely the ordering this is
           meant to fix.

           Sorting here rather than at the render site is deliberate -- the
           sub-issue section, the prev/next sibling navigation, AND the batch
           detail view all read this same comparator, and they must stay in
           lock-step or the arrows walk a different order than the list shows. */
        const PROD_TEAM_ORDER = { video: 0, graphics: 1 };
        function _prodChildTeamRank(d) {
            const rank = PROD_TEAM_ORDER[_prodWriteTeam(d && d.team)];
            // Anything untyped sorts last rather than colliding with video.
            return rank == null ? 2 : rank;
        }
        function _prodChildOrder(a, b) {
            const byTeam = _prodChildTeamRank(a) - _prodChildTeamRank(b);
            if (byTeam) return byTeam;
            const byTitle = String((a && a.title) || '').localeCompare(
                String((b && b.title) || ''), undefined, { numeric: true, sensitivity: 'base' });
            if (byTitle) return byTitle;
            // Stable, deterministic tail so equal titles never reshuffle
            // between renders (which would move the sibling arrows).
            return String((a && a.id) || '').localeCompare(String((b && b.id) || ''));
        }
        function _prodChildrenOf(id) {
            return _prodIssues().filter(d => d.parent === id).sort(_prodChildOrder);
        }
        /* WHO CAN READ THE THREE POST-LEVEL SLOTS OF A BATCH PARENT.
         *
         * filming_plan, raw_footage and delivery_folder live on the `batches`
         * row, and the f34/f53 migration revoked those three columns from the
         * browser grant on purpose -- index.html ships its own anon key, so a
         * column readable here is readable by anyone. PROD_BATCH_SELECT
         * therefore never asks for them and a synthetic batch parent always
         * seeds them empty. That is a fact about THIS READER, not about the
         * post, which is why the panel says Unavailable rather than Missing.
         *
         * A child of the same batch is a real deliverable row, and
         * assetSnapshot in production-write reads exactly those three columns
         * off the batch the child names, through the service role. So any
         * resolved child answers the identical question about the identical
         * post. Borrowing one is not a new privilege: the batch detail view has
         * made the same borrow since it shipped (see _prodBatchDetail).
         *
         * The child must be able to DECLARE a client scope, because the prober
         * authenticates that scope before it resolves the id and refuses a
         * mismatch with a flat 403. The scope it would send is the same
         * fallback chain _prodEnsureAssets uses -- authorityProject, then
         * storedClientSlug, then project -- so this asks the same question
         * rather than a stricter one. Requiring a RESOLVED attribution looked
         * safer and was not: a row whose UI attribution never resolved can
         * still carry the stored slug the gateway matches on, and discarding it
         * went on hiding links the server would have returned.
         *
         * What is excluded, and must be: the two attribution SENTINELS. A row
         * with no attribution carries `project` set to `__needs_attribution__`
         * or `__attribution_conflict__`, and sending one of those as a client
         * slug is a guaranteed 403 -- a candidate that cannot succeed is worse
         * than no candidate, because the panel would swap the honest hedge for
         * a permission error about a row nobody asked about.
         *
         * A resolved child is still PREFERRED where one exists; the fallback is
         * only reached when none has one. When no child qualifies at all, the
         * caller keeps the honest Unavailable hedge. */
        /* Shared with _prodBatchDetail (see below): finding a row this page can
         * ask the asset gateway about is a different question from what order
         * the rows display in, and the two must stay decoupled. A row with no
         * usable attribution is still shown, at its sorted position -- it is
         * simply never the one the asset panel or prefetch asks about, so a
         * batch whose numerically-first deliverable lacks attribution still
         * shows the shared folder links through a later, eligible sibling
         * instead of a predictable 403 (Codex, PR #1467). */
        function _prodAssetEligibleRow(rows) {
            let fallback = null;
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                if (!row || row.syntheticBatchParent === true) continue;
                const scope = String(
                    row.authorityProject || row.storedClientSlug || row.project || ''
                ).trim();
                if (!scope
                    || scope === PROD_ATTRIBUTION_NEEDS
                    || scope === PROD_ATTRIBUTION_CONFLICT) continue;
                /* And the scope has to name a client this page can see on the
                   ACTIVE roster, because that is the next thing the gateway
                   checks: handleAssetAccessRead refuses an inactive or unknown
                   client with a flat 403 before it looks at anything else.
                   686 live rows carry a client_slug that is not an active
                   client, so without this the parent opens, asks, and collects
                   a refusal it could have predicted -- a failed request in the
                   console and in the audit, on a surface that made no request
                   at all a day ago. Same rule as the capability check: do not
                   ask a question whose answer you already have. */
                if (!_prodClient(scope)) continue;
                if (String(row.authorityProject || '').trim()) return row;
                if (!fallback) fallback = row;
            }
            return fallback;
        }
        function _prodBatchAssetSource(d) {
            if (!d || d.syntheticBatchParent !== true) return null;
            const batchId = String(d.batchId || '');
            if (!batchId) return null;
            const kids = _prodChildrenOf(d.id).filter(k => k && String(k.batchId || '') === batchId);
            return _prodAssetEligibleRow(kids);
        }
        function _prodSubProgress(d) {
            const rows = _prodChildrenOf(d && d.id);
            if (!rows.length) return null;
            return { done: rows.filter(x => _prodIsDone(x.status)).length, total: rows.length };
        }
        function _prodOverdue(v, status, now) {
            if (!v || _prodIsDone(status)) return false;
            const day = String(v).slice(0, 10);
            return !!_prodIsoParts(day) && day < _prodPolicyTodayISO(now);
        }
        // PORT-DELTA: live rows carry canonical ISO dueRaw and use the shared
        // America/Guatemala policy day for both display and overdue math.
        function _prodOverdueDays(v, status, now) {
            if (!_prodOverdue(v, status, now)) return 0;
            const day = String(v).slice(0, 10);
            const diff = _prodIsoDayNumber(_prodPolicyTodayISO(now)) - _prodIsoDayNumber(day);
            return Math.max(1, diff);
        }
        function _prodOverdueText(v, status) {
            const n = _prodOverdueDays(v, status);
            return n ? ' · overdue by ' + n + ' day' + (n > 1 ? 's' : '') : '';
        }
        /* Overdue for a ROW, not a date. A hierarchy parent is a container —
         * the B1 import records the Linear parent issue as a deliverable row
         * of its own, and 75 open rows are that today, 8 of them dated so
         * they read as permanently overdue work nobody can complete
         * (docs/ops/OPEN_REPAIRS.md item 50; the owner ruled containers out
         * of the overdue lanes 2026-08-27). The date itself still renders —
         * it is the batch's date and often real information — only the
         * overdue treatment is withheld. Children are untouched: their
         * `isHierarchyParent` is false, so they keep their red. */
        function _prodRowOverdue(d) {
            if (!d || d.isHierarchyParent) return false;
            return _prodOverdue(d.dueRaw, d.status);
        }
        function _prodRowOverdueText(d) {
            if (!d || d.isHierarchyParent) return '';
            return _prodOverdueText(d.dueRaw, d.status);
        }
        // PORT-DELTA: the artifact carries static statusAge/statusHistory seed strings; the wired
        // copy derives the same tooltip text live from status_at and deliverable_events timestamps.
        function _prodDurationText(ms) {
            if (!(ms > 0)) return '';
            const minutes = Math.floor(ms / 60000);
            if (minutes < 60) return Math.max(1, minutes) + ' minute' + (minutes === 1 ? '' : 's');
            const hours = Math.floor(minutes / 60);
            if (hours < 24) return hours + ' hour' + (hours === 1 ? '' : 's');
            const days = Math.floor(hours / 24);
            return days + ' day' + (days === 1 ? '' : 's');
        }
        function _prodStatusAge(issue) {
            const ts = issue && issue.statusAtRaw ? Date.parse(issue.statusAtRaw) : NaN;
            if (!isFinite(ts)) return '';
            return _prodDurationText(Date.now() - ts);
        }
        function _prodStatusBreakdown(events, createdAtRaw, nowMs) {
            const now = isFinite(nowMs) ? nowMs : Date.now();
            // Native writes log action=status_change; Linear-synced changes log action=mirror_in_status_change.
            const changes = (events || [])
                .filter(e => e && (e.action === 'status_change' || e.action === 'mirror_in_status_change') && e.ts && e.to_status && e.from_status !== e.to_status)
                .map(e => ({ ts: Date.parse(e.ts), from: e.from_status, to: e.to_status }))
                .filter(e => isFinite(e.ts))
                .sort((a, b) => a.ts - b.ts);
            if (!changes.length) return '';
            const segments = [];
            const createEvt = (events || []).find(e => e && e.action === 'create' && e.ts && e.to_status);
            const anchorTs = createEvt ? Date.parse(createEvt.ts) : (createdAtRaw && (events || []).length < 30 ? Date.parse(createdAtRaw) : NaN);
            const anchorStatus = createEvt ? createEvt.to_status : changes[0].from;
            if (isFinite(anchorTs) && anchorStatus && changes[0].ts > anchorTs) {
                segments.push({ status: anchorStatus, ms: changes[0].ts - anchorTs });
            }
            changes.forEach((c, ix) => {
                const end = ix + 1 < changes.length ? changes[ix + 1].ts : now;
                if (end > c.ts) segments.push({ status: c.to, ms: end - c.ts });
            });
            return segments.slice(-4)
                .map(s => _prodStatusLabel(s.status) + ' ' + _prodDurationText(s.ms))
                .filter(s => / \d/.test(s))
                .join(', ');
        }
        function _prodCurIssuesUnfiltered() {
            if (_prodState.view === 'project' && _prodState.openProjectId) {
                return _prodApplySubIssueVisibility(_prodProjectAllRows(_prodClient(_prodState.openProjectId)));
            }
            return _prodIssues().filter(d => _prodState.team === 'all' || d.team === _prodState.team)
                .filter(d => !_prodState.clientSlug || d.project === _prodState.clientSlug)
                .filter(d => _prodState.view !== 'my' || (d.assignee && d.assignee === _prodMyMemberId()))
                .filter(d => _prodState.view === 'detail' || _prodState.view === 'batch' || _prodState.view === 'board' || _prodTabAllows(d.status));
        }
        // PORT-DELTA: live adapter row arrays can be absent during initial render.
        function _prodApplySubIssueVisibility(rows) {
            if (_prodState.showSubIssues !== false) return rows;
            const ids = new Set((rows || []).map(d => d.id));
            return (rows || []).filter(d => !(d.parent && ids.has(d.parent)));
        }
        function _prodUniqueRows(rows) {
            const seen = new Set();
            return (rows || []).filter(d => {
                const id = String(d && d.id || '');
                if (!id) return false;
                if (seen.has(id)) return false;
                seen.add(id);
                return true;
            });
        }
        // PORT-DELTA: live adapter ordering uses raw ISO date fields beside display labels.
        function _prodIssueOrderValue(d, key) {
            if (key === 'created') return d.createdRaw || '';
            if (key === 'updated') return d.updatedRaw || d.createdRaw || '';
            return d.dueRaw || '9999-99-99';
        }
        // PORT-DELTA: live adapter statuses are normalized and tie-break by migrated display id.
        function _prodIssueOrderCompare(a, b) {
            const s = PROD_STATUS_ORDER.indexOf(_prodArtifactStatus(a.status)) - PROD_STATUS_ORDER.indexOf(_prodArtifactStatus(b.status));
            if (s) return s;
            const key = PROD_ORDER_KEYS.has(_prodState.orderBy) ? _prodState.orderBy : 'due';
            const av = String(_prodIssueOrderValue(a, key) || '');
            const bv = String(_prodIssueOrderValue(b, key) || '');
            const d = av.localeCompare(bv);
            if (d) return key === 'created' || key === 'updated' ? -d : d;
            return String(_prodIssueLabel(a)).localeCompare(String(_prodIssueLabel(b)));
        }
        function _prodFilterFields() {
            const editors = _prodEditors();
            const projects = _prodProjects();
            return {
                status: {
                    label: 'Status',
                    plural: 'statuses',
                    icon: k => _prodStatusSVG(k),
                    fieldIcon: () => _prodIcon('statusField'),
                    values: () => PROD_STATUS_ORDER.filter(k => _prodCurIssuesUnfiltered().some(i => _prodArtifactStatus(i.status) === k)),
                    name: k => _prodStatusLabel(k),
                    match: (i, v) => _prodArtifactStatus(i.status) === v
                },
                assignee: {
                    label: 'Assignee',
                    plural: 'assignees',
                    icon: k => k === '_' ? _prodIcon('assign') : _prodAvatar(editors[k], 16),
                    fieldIcon: () => _prodIcon('assign'),
                    values: () => ['_'].concat(Object.keys(editors).filter(k => _prodCurIssuesUnfiltered().some(i => i.assignee === k)).sort((a, b) => String(editors[a].name).localeCompare(String(editors[b].name)))),
                    name: k => k === '_' ? 'No assignee' : editors[k] ? editors[k].name : k,
                    match: (i, v) => v === '_' ? !i.assignee : i.assignee === v
                },
                client: {
                    label: 'Client',
                    plural: 'clients',
                    icon: k => _prodProjectGlyph(projects[k] || k),
                    fieldIcon: () => _prodIcon('project'),
                    values: () => [...new Set(_prodCurIssuesUnfiltered().map(i => i.project).filter(Boolean))].sort((a, b) => _prodDisplayClient(a).localeCompare(_prodDisplayClient(b))),
                    name: k => _prodDisplayClient(k),
                    match: (i, v) => i.project === v
                }
            };
        }
        function _prodCondFor(field) {
            return (_prodState.filters || []).find(c => c.field === field);
        }
        function _prodMatchFilters(i) {
            const fields = _prodFilterFields();
            return (_prodState.filters || []).every(c => !c.values.length || c.values.some(v => fields[c.field] && fields[c.field].match(i, v)));
        }
        function _prodToggleFilterValue(field, value) {
            const fields = _prodFilterFields();
            if (!fields[field]) return;
            let c = _prodCondFor(field);
            if (!c) {
                c = { field, values: [] };
                _prodState.filters.push(c);
            }
            const ix = c.values.indexOf(value);
            if (ix >= 0) c.values.splice(ix, 1);
            else c.values.push(value);
            if (!c.values.length) _prodState.filters = _prodState.filters.filter(x => x !== c);
            _prodReconcileSelection();
            _prodRender();
        }
        function _prodRemoveFilter(field) {
            _prodState.filters = (_prodState.filters || []).filter(c => c.field !== field);
            _prodReconcileSelection();
            _prodRender();
        }
        function _prodClearFilters() {
            _prodState.filters = [];
            _prodReconcileSelection();
            _prodRender();
        }
        // PORT-DELTA: pillsHTML uses Production filter state and class names.
        function _prodPillsHTML() {
            if (!_prodState.filters || !_prodState.filters.length) return '';
            const fields = _prodFilterFields();
            return _prodState.filters.map(c => {
                const f = fields[c.field];
                if (!f) return '';
                const op = c.values.length > 1 ? 'is any of' : 'is';
                const val = c.values.length === 1
                    ? '<span class="fval">' + f.icon(c.values[0]) + '<span>' + _calEsc(f.name(c.values[0])) + '</span></span>'
                    : '<span class="fval"><span>' + c.values.length + ' ' + f.plural + '</span></span>';
                return '<span class="prod-filter-pill interactive" data-prod-filter-pill="1" data-prod-fedit="' + _calEscAttr(c.field) + '" onclick="return _prodOpenFilterPill(event,' + _jsAttrArg(c.field) + ')" data-prod-tip="Edit filter"><span class="ficon">' + f.fieldIcon() + '</span><span>' + _calEsc(f.label) + '</span><span class="fop">' + op + '</span>' + val + '<button class="fx" type="button" onclick="event.stopPropagation(); _prodRemoveFilter(' + _jsAttrArg(c.field) + ')" data-prod-fremove="' + _calEscAttr(c.field) + '" data-prod-tip="Remove filter">✕</button></span>';
            }).join('');
        }
        function _prodPickerEmptyState(pop, shown) {
            const list = pop.querySelector('.prod-pop-list');
            if (!list) return;
            let empty = list.querySelector('.prod-pop-empty');
            if (!shown) {
                if (!empty) {
                    empty = document.createElement('div');
                    empty.className = 'prod-pop-empty';
                    empty.textContent = 'No results';
                    list.appendChild(empty);
                }
            } else if (empty) {
                empty.remove();
            }
        }
        // PORT-DELTA: buildFilterValues uses adapter fields and local read-only filtering.
        function _prodBuildFilterValues(pop, field) {
            const fields = _prodFilterFields();
            const f = fields[field];
            if (!f) return;
            const vals = f.values();
            const selected = new Set((_prodCondFor(field) || { values: [] }).values);
            pop.innerHTML = '<div class="prod-pop-search"><input data-prod-search placeholder="' + _calEscAttr(f.label + '...') + '"></div><div class="prod-pop-list">'
                + vals.map((v, i) => '<div class="prod-mi" data-prod-fv="' + i + '"><span class="mic">' + f.icon(v) + '</span><span class="mlbl">' + _calEsc(f.name(v)) + '</span><span class="tick"' + (selected.has(v) ? '' : ' style="visibility:hidden"') + '>' + _prodIcon('check') + '</span></div>').join('')
                + '</div>';
            const valueRows = () => Array.from(pop.querySelectorAll('[data-prod-fv]')).filter(el => el.style.display !== 'none');
            let sel = 0;
            const hi = n => {
                const rows = valueRows();
                if (!rows.length) return;
                sel = Math.max(0, Math.min(n, rows.length - 1));
                rows.forEach((el, i) => el.classList.toggle('sel', i === sel));
                rows[sel].scrollIntoView({ block: 'nearest' });
            };
            pop.querySelectorAll('[data-prod-fv]').forEach(el => {
                el.addEventListener('click', e => {
                    e.stopPropagation();
                    _prodToggleFilterValue(field, vals[+el.getAttribute('data-prod-fv')]);
                    _prodClearLayer();
                });
                el.addEventListener('mousemove', () => {
                    const rows = valueRows();
                    const ix = rows.indexOf(el);
                    if (ix >= 0) hi(ix);
                });
            });
            const inp = pop.querySelector('[data-prod-search]');
            if (inp) {
                inp.addEventListener('input', () => {
                    const q = inp.value.toLowerCase();
                    let shown = 0;
                    pop.querySelectorAll('[data-prod-fv]').forEach(el => {
                        const v = vals[+el.getAttribute('data-prod-fv')];
                        const ok = f.name(v).toLowerCase().includes(q);
                        el.style.display = ok ? '' : 'none';
                        if (ok) shown++;
                    });
                    _prodPickerEmptyState(pop, shown);
                    hi(0);
                });
                inp.addEventListener('keydown', e => {
                    e.stopPropagation();
                    if (e.key === 'Escape') { _prodCloseSub(); return; }
                    if (e.key === 'ArrowDown') { e.preventDefault(); hi(sel + 1); return; }
                    if (e.key === 'ArrowUp') { e.preventDefault(); hi(sel - 1); return; }
                    if (e.key === 'Enter') {
                        const rows = valueRows();
                        if (rows.length) rows[Math.min(sel, rows.length - 1)].click();
                    }
                });
                try { inp.focus(); } catch (e) {}
            }
            hi(0);
        }
        // PORT-DELTA: openFilterSub is namespaced to body-mounted Production overlays.
        function _prodOpenFilterSub(parentEl, field) {
            _prodCloseSub();
            const p = document.createElement('div');
            p.className = 'prod-pop';
            p.style.visibility = 'hidden';
            p.addEventListener('click', e => e.stopPropagation());
            document.getElementById('prodLayer').appendChild(p);
            _prodBuildFilterValues(p, field);
            const r = parentEl.getBoundingClientRect();
            const pr = p.getBoundingClientRect();
            let x = r.right - 4;
            let y = r.top - 6;
            if (x + pr.width > innerWidth - 8) x = r.left - pr.width + 4;
            if (y + pr.height > innerHeight - 8) y = Math.max(8, innerHeight - pr.height - 8);
            p.style.left = x + 'px';
            p.style.top = y + 'px';
            p.style.visibility = 'visible';
            _prodSetSubPop(p);
        }
        // PORT-DELTA: openFilterMenu uses live adapter values; filter changes are pure local reads.
        function _prodOpenFilterMenu(ev) {
            if (ev) {
                ev.preventDefault();
                ev.stopPropagation();
            }
            const trigger = ev && ev.currentTarget ? ev.currentTarget : document.getElementById('prodFilterBtn');
            if (trigger && trigger.classList.contains('menu-open')) {
                _prodClearLayer();
                return false;
            }
            const fields = _prodFilterFields();
            const me = _prodMyMemberId();
            const meActive = !!me && ((_prodCondFor('assignee') || { values: [] }).values || []).includes(me);
            const rows = '<div class="prod-pop-hd">Filter</div>'
                + (me ? '<div class="prod-mi" data-prod-fquick="me"><span class="mic">' + _prodAvatar(_prodMember(me), 16) + '</span><span class="mlbl">Assigned to me</span>' + (meActive ? '<span class="tick">' + _prodIcon('check') + '</span>' : '') + '</div><div class="prod-msep"></div>' : '')
                + ['status','assignee','client'].map(k => {
                    const f = fields[k];
                    const n = (_prodCondFor(k) || { values: [] }).values.length;
                    return '<div class="prod-mi" data-prod-ffield="' + k + '"><span class="mic">' + f.fieldIcon() + '</span><span class="mlbl">' + f.label + '</span>' + (n ? '<span class="kbd">' + n + '</span>' : '') + '<span class="chev">' + _prodIcon('chevR') + '</span></div>';
                }).join('');
            const tr = trigger && trigger.getBoundingClientRect ? trigger.getBoundingClientRect() : null;
            const p = _prodLayerPop(rows, tr ? tr.left : (ev ? ev.clientX : innerWidth - 220), tr ? tr.bottom + 4 : (ev ? ev.clientY : 120));
            if (trigger) trigger.classList.add('menu-open');
            const quick = p.querySelector('[data-prod-fquick="me"]');
            if (quick) quick.addEventListener('click', () => {
                _prodToggleFilterValue('assignee', me);
                _prodClearLayer();
            });
            p.querySelectorAll('[data-prod-ffield]').forEach(el => {
                const field = el.getAttribute('data-prod-ffield');
                el.addEventListener('mouseenter', () => _prodOpenFilterSub(el, field));
                el.addEventListener('click', e => {
                    e.stopPropagation();
                    _prodOpenFilterSub(el, field);
                });
            });
            _prodWirePlainMenu(p);
            return false;
        }
        function _prodOpenFilterPill(ev, field) {
            if (ev) {
                ev.preventDefault();
                ev.stopPropagation();
            }
            const p = _prodLayerPop('', ev ? ev.clientX : innerWidth / 2, ev ? ev.clientY : 120);
            _prodBuildFilterValues(p, field);
            return false;
        }
        // PORT-DELTA: openGroupMenu changes local read-only grouping without touching backend state.
        function _prodOpenGroupMenu(ev) {
            if (ev) {
                ev.preventDefault();
                ev.stopPropagation();
            }
            const trigger = ev && ev.currentTarget ? ev.currentTarget : document.getElementById('prodGroupBtn');
            if (trigger && trigger.classList.contains('menu-open')) {
                _prodClearLayer();
                return false;
            }
            const opts = [['status','Status'], ['client','Client / project'], ['assignee','Assignee']];
            const orders = [['due','Due date'], ['updated','Updated'], ['created','Created']];
            const tr = trigger && trigger.getBoundingClientRect ? trigger.getBoundingClientRect() : null;
            const p = _prodLayerPop('<div class="prod-pop-hd">Display</div><div class="prod-mi" data-prod-show-subissues="1"><span class="mlbl">Show sub-issues</span>' + (_prodState.showSubIssues !== false ? '<span class="tick">' + _prodIcon('check') + '</span>' : '') + '</div><div class="prod-msep"></div><div class="prod-pop-hd">Group by</div>' + opts.map(o => '<div class="prod-mi" data-prod-grp="' + o[0] + '"><span class="mlbl">' + o[1] + '</span>' + (_prodState.groupBy === o[0] ? '<span class="tick">' + _prodIcon('check') + '</span>' : '') + '</div>').join('') + '<div class="prod-msep"></div><div class="prod-pop-hd">Ordering</div>' + orders.map(o => '<div class="prod-mi" data-prod-order="' + o[0] + '"><span class="mlbl">' + o[1] + '</span>' + ((_prodState.orderBy || 'due') === o[0] ? '<span class="tick">' + _prodIcon('check') + '</span>' : '') + '</div>').join(''), tr ? tr.left : (ev ? ev.clientX : innerWidth - 160), tr ? tr.bottom + 4 : (ev ? ev.clientY : 120));
            if (trigger) trigger.classList.add('menu-open');
            p.querySelector('[data-prod-show-subissues]').addEventListener('click', () => {
                _prodState.showSubIssues = _prodState.showSubIssues === false;
                _prodState.selected.clear();
                _prodState.collapsed = new Set();
                _prodSaveDisplayPrefs();
                _prodClearLayer();
                _prodSetQuery({}, false);
                _prodRender();
            });
            p.querySelectorAll('[data-prod-grp]').forEach(el => el.addEventListener('click', () => {
                _prodState.groupBy = el.getAttribute('data-prod-grp');
                _prodState.collapsed = new Set();
                _prodState.selected.clear();
                _prodSaveDisplayPrefs();
                _prodClearLayer();
                _prodSetQuery({}, false);
                _prodRender();
            }));
            p.querySelectorAll('[data-prod-order]').forEach(el => el.addEventListener('click', () => {
                const next = el.getAttribute('data-prod-order') || 'due';
                _prodState.orderBy = PROD_ORDER_KEYS.has(next) ? next : 'due';
                _prodState.collapsed = new Set();
                _prodState.selected.clear();
                _prodSaveDisplayPrefs();
                _prodClearLayer();
                _prodSetQuery({}, false);
                _prodRender();
            }));
            _prodWirePlainMenu(p);
            return false;
        }
        function _prodSearchRank(query, primary, secondary, body) {
            const q = String(query || '').trim().toLowerCase();
            if (!q) return 0;
            const p = String(primary || '').trim().toLowerCase();
            const s = String(secondary || '').trim().toLowerCase();
            const b = String(body || '').trim().toLowerCase();
            if (p === q) return 0;
            if (p.startsWith(q)) return 1;
            if (p.split(/\s+/).some(part => part.startsWith(q))) return 2;
            if (p.includes(q)) return 3;
            if (s === q || s.startsWith(q)) return 4;
            if (s.includes(q)) return 5;
            if (b.includes(q)) return 8;
            return -1;
        }
        // PORT-DELTA: openSearch result source is live adapter data, including B1 brief text, instead of artifact seed arrays.
        function _prodPaletteItems(q) {
            const fields = _prodFilterFields();
            const query = String(q || '').trim().toLowerCase();
            const commands = [
                { icon: _prodIcon('issues'), title: 'Go to Video issues', meta: 'Command', go: () => _prodOpenTeamView('video', 'list') },
                { icon: _prodIcon('issues'), title: 'Go to Graphics issues', meta: 'Command', go: () => _prodOpenTeamView('graphics', 'list') },
                { icon: _prodIcon('issues'), title: 'Go to My issues', meta: 'Command', go: () => _prodSetView('my') },
                { icon: _prodIcon('issues'), title: 'Go to Video projects', meta: 'Command', go: () => _prodOpenTeamView('video', 'board') },
                { icon: _prodIcon('issues'), title: 'Go to Graphics projects', meta: 'Command', go: () => _prodOpenTeamView('graphics', 'board') },
                { icon: _prodIcon('issues'), title: 'Go to All projects', meta: 'Command', go: () => _prodOpenTeamView('all', 'board') }
            ];
            const issues = _prodIssues();
            const items = [];
            if (!query) {
                issues.filter(i => !i.parent).slice(0, 6).forEach(i => {
                    items.push({ icon: _prodStatusSVG(i.status), title: (_prodKnownName(i) || _prodIssueDisplayLabel(i) || 'Untitled issue'), meta: _prodIssueDisplayLabel(i), go: () => _prodOpenDeliverable(i.id) });
                });
                return items.concat(commands);
            }
            const scored = [];
            const addScored = (item, primary, secondary, body) => {
                const rank = _prodSearchRank(query, primary, secondary, body);
                if (rank >= 0) scored.push(Object.assign({ _rank: rank, _order: scored.length }, item));
            };
            commands.forEach(cmd => addScored(cmd, cmd.title, cmd.meta, ''));
            issues.forEach(i => {
                addScored({ icon: _prodStatusSVG(i.status), title: (_prodKnownName(i) || _prodIssueDisplayLabel(i) || 'Untitled issue'), meta: _prodIssueDisplayLabel(i), go: () => _prodOpenDeliverable(i.id) }, i.title, _prodIssueLabel(i), i.desc);
            });
            Object.keys(_prodProjects()).sort((a, b) => fields.client.name(a).localeCompare(fields.client.name(b))).forEach(slug => {
                const title = fields.client.name(slug);
                addScored({ icon: fields.client.icon(slug), title, meta: 'Project', go: () => _prodOpenProject(slug) }, title, 'Project', '');
            });
            Object.keys(_prodEditors()).sort((a, b) => fields.assignee.name(a).localeCompare(fields.assignee.name(b))).forEach(id => {
                const title = fields.assignee.name(id);
                addScored({ icon: fields.assignee.icon(id), title, meta: 'Assignee', go: () => {
                    _prodState.filters = [{ field: 'assignee', values: [id] }];
                    _prodState.view = 'list';
                    _prodState.openId = '';
                    _prodState.openBatchId = '';
                    _prodSetQuery({}, true);
                    _prodRender();
                }}, title, 'Assignee', '');
            });
            return scored
                .sort((a, b) => a._rank - b._rank || String(a.title || '').localeCompare(String(b.title || '')) || a._order - b._order)
                .map(({ _rank, _order, ...item }) => item);
        }
        // PORT-DELTA: openSearch is namespaced as a Production command palette and navigates only.
        function _prodOpenPalette() {
            _prodEnsureOverlays();
            _prodClearLayer();
            _prodLoadBriefs({ silent: true });
            const bd = document.createElement('div');
            bd.className = 'prod-cmd-bd';
            if (typeof bd.setAttribute === 'function') bd.setAttribute('data-backdrop-dismiss', '');
            bd.innerHTML = '<div class="prod-cmd"><input class="prod-cmd-input" placeholder="Search issues, projects, people…" spellcheck="false"><div class="prod-cmd-list"></div></div>';
            document.body.appendChild(bd);
            const inp = bd.querySelector('.prod-cmd-input');
            const list = bd.querySelector('.prod-cmd-list');
            let results = [];
            let sel = 0;
            const close = () => {
                bd.remove();
                _prodState.paletteOpen = false;
            };
            const draw = () => {
                list.innerHTML = results.length
                    ? results.map((r, i) => '<div class="prod-cmd-item' + (i === sel ? ' sel' : '') + '" data-prod-cmd="' + i + '"><span class="ci">' + r.icon + '</span><span class="ct">' + _calEsc(r.title) + '</span><span class="cmeta">' + _calEsc(r.meta) + '</span></div>').join('')
                    : '<div class="prod-cmd-empty">No results</div>';
                list.querySelectorAll('[data-prod-cmd]').forEach(el => {
                    el.addEventListener('mousemove', () => {
                        sel = +el.getAttribute('data-prod-cmd');
                        draw();
                    });
                    el.addEventListener('click', () => {
                        const item = results[+el.getAttribute('data-prod-cmd')];
                        close();
                        if (item && item.go) item.go();
                    });
                });
                const active = list.querySelector('.prod-cmd-item.sel');
                if (active) active.scrollIntoView({ block: 'nearest' });
            };
            const search = () => {
                const q = inp.value.trim().toLowerCase();
                results = _prodPaletteItems(q).slice(0, 12);
                sel = Math.min(sel, Math.max(0, results.length - 1));
                draw();
            };
            inp.addEventListener('input', search);
            inp.addEventListener('keydown', e => {
                if (e.key === 'Escape') { e.preventDefault(); close(); return; }
                if (e.key === 'ArrowDown') { e.preventDefault(); if (results.length) { sel = (sel + 1) % results.length; draw(); } return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); if (results.length) { sel = (sel - 1 + results.length) % results.length; draw(); } return; }
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const item = results[sel];
                    close();
                    if (item && item.go) item.go();
                }
            });
            bd.addEventListener('click', e => {
                if (e.target === bd && bd._backdropPressBegan) close();
            });
            _prodState.paletteOpen = true;
            search();
            try { inp.focus(); } catch (e) {}
            return false;
        }
        function _prodEnsureOverlays() {
            let layer = document.getElementById('prodLayer');
            if (!layer) {
                layer = document.createElement('div');
                layer.id = 'prodLayer';
                layer.className = 'prod-layer';
                document.body.appendChild(layer);
            }
            let tip = document.getElementById('prodTip');
            if (!tip) {
                tip = document.createElement('div');
                tip.id = 'prodTip';
                tip.className = 'prod-tip';
                document.body.appendChild(tip);
            }
            let toast = document.getElementById('prodToast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'prodToast';
                toast.className = 'prod-toast';
                document.body.appendChild(toast);
            }
            if (!_prodState.overlayWired) {
                _prodState.overlayWired = true;
                /* Shift-click is a RANGE SELECT here, so the browser must not
                   also treat it as "extend the text selection to this point".
                   Owner report 2026-08-20: shift-clicking a second sub-issue
                   flashed a blue text selection across the list. user-select
                   alone does not fix it -- the selection is anchored outside
                   the row and shift extends it across whatever lies between --
                   so the gesture is cancelled at mousedown, before a selection
                   can start. Only for shift, and only inside the issue list, so
                   ordinary click-drag text selection is untouched everywhere
                   else. */
                document.addEventListener('mousedown', e => {
                    if (!e.shiftKey || !_prodEnabled() || !document.getElementById('prodRoot')) return;
                    const target = e.target && e.target.closest ? e.target.closest('[data-prod-row], .prod-subrow') : null;
                    if (!target) return;
                    e.preventDefault();
                    const sel = window.getSelection && window.getSelection();
                    if (sel && sel.removeAllRanges) sel.removeAllRanges();
                });
                document.addEventListener('keydown', e => {
                    if (!_prodEnabled() || !document.getElementById('prodRoot')) return;
                    const activeTag = document.activeElement && document.activeElement.tagName;
                    const typing = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable);
                    if ((e.metaKey || e.ctrlKey) && String(e.key || '').toLowerCase() === 'k') {
                        e.preventDefault();
                        _prodOpenPalette();
                        return;
                    }
                    if ((e.key === '/' || e.code === 'Slash') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !typing && !(document.getElementById('prodLayer') && document.getElementById('prodLayer').innerHTML)) {
                        e.preventDefault();
                        _prodOpenPalette();
                        return;
                    }
                    if (e.key === 'Escape' && document.getElementById('prodLayer') && document.getElementById('prodLayer').innerHTML) {
                        // Branded selects consume Escape at their control before
                        // this document handler; the portaled date picker handles
                        // it in its own document listener. Keep the create modal
                        // mounted so each primitive can return focus correctly.
                        if (e.defaultPrevented || document.getElementById('svDatePickerPopup')) return;
                        e.preventDefault();
                        _prodClearLayer();
                        return;
                    }
                    if (typing || _prodState.paletteOpen) return;
                    if ((_prodState.view === 'list' || _prodState.view === 'my') && (e.ctrlKey || e.metaKey) && String(e.key || '').toLowerCase() === 'a') {
                        e.preventDefault();
                        _prodState.selected = new Set(_prodIssueRows().map(i => i.id));
                        _prodRender();
                        return;
                    }
                    if (_prodState.view === 'board' && (e.ctrlKey || e.metaKey) && String(e.key || '').toLowerCase() === 'a') {
                        e.preventDefault();
                        _prodState.cardSel = new Set(_prodBoardFlat());
                        _prodRender();
                        return;
                    }
                    if ((_prodState.view === 'list' || _prodState.view === 'my') && (e.ctrlKey || e.metaKey) && (e.key === 'Backspace' || e.key === 'Delete')) {
                        if (_prodState.selected && _prodState.selected.size) {
                            e.preventDefault();
                            _prodReadonlyGuard(PROD_DELETE_UNSUPPORTED);
                            return;
                        }
                    }
                    if (e.key === 'Escape') {
                        if (_prodState.selected && _prodState.selected.size) {
                            e.preventDefault();
                            _prodState.selected.clear();
                            _prodState.selAnchor = '';
                            _prodState.focusRow = '';
                            _prodState.hoverRow = '';
                            _prodRender();
                            return;
                        }
                        if (_prodState.view === 'board' && _prodState.cardSel && _prodState.cardSel.size) {
                            e.preventDefault();
                            _prodState.cardSel.clear();
                            _prodState.cardAnchor = '';
                            _prodState.focusCard = '';
                            _prodRender();
                            return;
                        }
                        if (_prodState.view === 'detail' || _prodState.view === 'batch') {
                            e.preventDefault();
                            _prodSetView('list');
                            return;
                        }
                        if (_prodState.view === 'project') {
                            e.preventDefault();
                            _prodSetView('board');
                            return;
                        }
                        if (_prodState.focusRow) {
                            e.preventDefault();
                            _prodState.focusRow = '';
                            _prodState.hoverRow = '';
                            _prodRender();
                            return;
                        }
                        if (_prodState.view === 'board' && _prodState.focusCard) {
                            e.preventDefault();
                            _prodState.focusCard = '';
                            _prodRender();
                            return;
                        }
                    }
                    const activeControl = document.activeElement && document.activeElement.closest
                        ? document.activeElement.closest('button,a[href],input,textarea,select,[role="button"],[tabindex]:not([tabindex="-1"])')
                        : null;
                    const prodRoot = document.getElementById('prodRoot');
                    // Native controls anywhere in the app own their keyboard events. In
                    // particular, do not let Production row shortcuts steal Enter from
                    // the global header nav (Linear / Submit / the other real links).
                    if (activeControl) return;
                    if (_prodState.view === 'board') {
                        if (e.key === 'ArrowDown' || String(e.key).toLowerCase() === 'j') { e.preventDefault(); _prodMoveCardFocus(0, 1); return; }
                        if (e.key === 'ArrowUp' || String(e.key).toLowerCase() === 'k') { e.preventDefault(); _prodMoveCardFocus(0, -1); return; }
                        if (e.key === 'ArrowRight') { e.preventDefault(); _prodMoveCardFocus(1, 0); return; }
                        if (e.key === 'ArrowLeft') { e.preventDefault(); _prodMoveCardFocus(-1, 0); return; }
                        const targetCard = (_prodState.cardSel && _prodState.cardSel.size ? Array.from(_prodState.cardSel)[0] : '') || (_prodCardFocusValid() ? _prodState.focusCard : '') || _prodBoardFlat()[0];
                        if (e.key === 'Enter' && _prodCardFocusValid()) { e.preventDefault(); _prodCardClick(e, _prodState.focusCard); return; }
                        if (String(e.key).toLowerCase() === 'x' && !e.ctrlKey && !e.metaKey) {
                            if (_prodCardFocusValid()) {
                                e.preventDefault();
                                _prodToggleCardSelection(_prodState.focusCard, false, true);
                            }
                            return;
                        }
                        if (String(e.key).toLowerCase() === 'x' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); return; }
                        if (targetCard && String(e.key).toLowerCase() === 's') { e.preventDefault(); _prodOpenProjectStatusPicker({ preventDefault(){}, stopPropagation(){}, clientX: innerWidth / 2, clientY: 160 }, targetCard); return; }
                        if (targetCard && String(e.key).toLowerCase() === 'a' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); _prodOpenProjectLeadPicker({ preventDefault(){}, stopPropagation(){}, clientX: innerWidth / 2, clientY: 160 }, targetCard); return; }
                        if (targetCard && String(e.key).toLowerCase() === 'd' && e.shiftKey) { e.preventDefault(); _prodOpenProjectTargetPicker({ preventDefault(){}, stopPropagation(){}, clientX: innerWidth / 2, clientY: 160 }, targetCard); return; }
                    }
                    if (_prodState.view === 'list' || _prodState.view === 'my') {
                        if (e.key === 'ArrowDown' || String(e.key).toLowerCase() === 'j') { e.preventDefault(); _prodMoveFocus(1, !!e.shiftKey); return; }
                        if (e.key === 'ArrowUp' || String(e.key).toLowerCase() === 'k') { e.preventDefault(); _prodMoveFocus(-1, !!e.shiftKey); return; }
                        const keyboardTarget = _prodState.focusRow || _prodState.hoverRow || _prodFlatOrder()[0];
                        if (e.key === 'Enter' && keyboardTarget) { e.preventDefault(); _prodOpenDeliverable(keyboardTarget); return; }
                        const target = (_prodState.selected && _prodState.selected.size ? Array.from(_prodState.selected)[0] : '') || keyboardTarget;
                        if (target && String(e.key).toLowerCase() === 'x' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); _prodToggleRowSelection(target, true); return; }
                        if (String(e.key).toLowerCase() === 'x' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); return; }
                        if (target && String(e.key).toLowerCase() === 's') { e.preventDefault(); _prodOpenPicker('status', { preventDefault(){}, stopPropagation(){}, clientX: innerWidth / 2, clientY: 160 }, target); return; }
                        if (target && String(e.key).toLowerCase() === 'a' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); _prodOpenPicker('assign', { preventDefault(){}, stopPropagation(){}, clientX: innerWidth / 2, clientY: 160 }, target); return; }
                        if (target && String(e.key).toLowerCase() === 'd' && e.shiftKey) { e.preventDefault(); _prodOpenPicker('due', { preventDefault(){}, stopPropagation(){}, clientX: innerWidth / 2, clientY: 160 }, target); return; }
                        if (target && String(e.key).toLowerCase() === 'p' && e.shiftKey) { e.preventDefault(); _prodOpenPicker('proj', { preventDefault(){}, stopPropagation(){}, clientX: innerWidth / 2, clientY: 160 }, target); return; }
                    }
                });
                document.addEventListener('dragstart', _prodBoardDragStart);
                document.addEventListener('dragend', _prodClearBoardDropFx);
                document.addEventListener('dragover', _prodBoardDragOver);
                document.addEventListener('drop', _prodBoardDrop);
                document.addEventListener('contextmenu', e => {
                    if (!_prodEnabled()) return;
                    const root = document.getElementById('prodRoot');
                    if (!root || !(e.target && root.contains(e.target))) return;
                    if (!e.defaultPrevented) e.preventDefault();
                });
                document.addEventListener('visibilitychange', _prodAutoRefreshOnReturn);
                window.addEventListener('focus', _prodAutoRefreshOnReturn);
                window.addEventListener('pageshow', _prodAutoRefreshOnReturn);
                document.addEventListener('mouseover', e => {
                    const el = e.target && e.target.closest ? e.target.closest('[data-prod-tip]') : null;
                    if (!el || !document.getElementById('prodRoot')) return;
                    const layer = document.getElementById('prodLayer');
                    if (layer && layer.innerHTML && !layer.contains(el)) return;
                    clearTimeout(_prodState.tipTimer);
                    _prodState.tipEl = el;
                    _prodState.tipTimer = setTimeout(() => {
                        if (_prodState.tipEl === el) _prodShowTip(el);
                    }, 380);
                });
                document.addEventListener('mouseout', e => {
                    const el = e.target && e.target.closest ? e.target.closest('[data-prod-tip]') : null;
                    if (el && el === _prodState.tipEl) _prodHideTip();
                });
            }
        }
        function _prodClearLayer() {
            const layer = document.getElementById('prodLayer');
            if (layer) {
                layer.innerHTML = '';
                layer.style.pointerEvents = 'none';
            }
            document.querySelectorAll('.prod-cmd-bd').forEach(el => el.remove());
            _prodState.paletteOpen = false;
            document.querySelectorAll('#prodFilterBtn.menu-open, #prodGroupBtn.menu-open').forEach(el => el.classList.remove('menu-open'));
            _prodSetSubPop(null);
            _prodHideTip();
        }
        function _prodShowTip(el) {
            const raw = el && el.getAttribute('data-prod-tip');
            const tip = document.getElementById('prodTip');
            if (!raw || !tip) return;
            const parts = raw.split('|');
            const r = el.getBoundingClientRect();
            tip.innerHTML = _calEsc(parts[0]) + (parts[1] ? '<span class="tk">' + _calEsc(parts[1]) + '</span>' : '');
            tip.style.left = '-9999px';
            tip.style.top = '0';
            tip.classList.add('show');
            const tr = tip.getBoundingClientRect();
            let x = r.left + r.width / 2 - tr.width / 2;
            let y = r.bottom + 7;
            if (y + tr.height > innerHeight - 6) y = r.top - tr.height - 7;
            x = Math.max(6, Math.min(x, innerWidth - tr.width - 6));
            tip.style.left = x + 'px';
            tip.style.top = y + 'px';
        }
        function _prodHideTip() {
            const tip = document.getElementById('prodTip');
            if (tip) tip.classList.remove('show');
            clearTimeout(_prodState.tipTimer);
            _prodState.tipEl = null;
        }
        function _prodToast(message) {
            _prodEnsureOverlays();
            const toast = document.getElementById('prodToast');
            if (!toast) return;
            toast.textContent = message || '';
            toast.classList.add('show');
            // The dismiss timer carries the toast GENERATION it was armed for
            // and only dismisses its own. clearTimeout alone proved leaky: a
            // stale timer (element swap, patched timers in a harness, timer
            // interleaving) could survive it and yank a brand-new toast off
            // the screen within milliseconds -- observed live as a refresh
            // press whose acknowledgement vanished before anyone saw it.
            const gen = (Number(toast.dataset.gen) || 0) + 1;
            toast.dataset.gen = String(gen);
            clearTimeout(toast._t);
            toast._t = setTimeout(() => {
                if (Number(toast.dataset.gen) === gen) toast.classList.remove('show');
            }, 1600);
        }
        function _prodLinkFor(kind, id) {
            const q = new URLSearchParams();
            q.set('prod', '1');
            if (kind === 'client') {
                q.set('client', String(id || ''));
                q.set('view', 'list');
            } else if (kind === 'batch') {
                q.set('batch', String(id || ''));
            } else {
                q.set('d', String(id || ''));
            }
            return svRoute.cleanAbs('/?' + q.toString() + '#production');
        }
        function _prodCopyLink(kind, id) {
            const ids = Array.isArray(id) ? id.filter(Boolean) : [id].filter(Boolean);
            const urls = ids.length ? ids.map(x => _prodLinkFor(kind, x)) : [_prodLinkFor(kind, id)];
            const url = urls.join('\n');
            try { window.__prodLastCopied = url; } catch (e) {}
            const done = () => _prodToast(ids.length > 1 ? ids.length + ' links copied' : 'Link copied');
            const fail = () => _prodToast('Copy failed');
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, fail);
                else done();
            } catch (e) {
                fail();
            }
        }
        function _prodCopyIssueIds(ids) {
            const labels = (Array.isArray(ids) ? ids : [ids]).map(id => _prodIssue(id)).filter(Boolean).map(_prodIssueLabel).filter(Boolean);
            if (!labels.length) {
                _prodToast('Nothing to copy');
                return;
            }
            const text = labels.join('\n');
            try { window.__prodLastCopied = text; } catch (e) {}
            const done = () => _prodToast(labels.length > 1 ? labels.length + ' issue IDs copied' : 'Issue ID copied');
            const fail = () => _prodToast('Copy failed');
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fail);
                else done();
            } catch (e) {
                fail();
            }
        }
        /* The preview sentence is the DEFAULT, not the only answer. It is right
           for a control still waiting on authority and wrong for one that can
           never act, and a disabled row that hovers with its own reason must not
           toast a different one when it is clicked -- two answers to the same
           question is worse than either alone. Callers that know the real reason
           pass it. */
        function _prodReadonlyGuard(reason) {
            _prodToast(String(reason || '') || _prodPreviewText());
            return false;
        }
        function _prodWriteTeam(value) {
            value = String(value || '').trim().toLowerCase();
            if (value === 'vid') return 'video';
            if (value === 'gra' || value === 'graphic' || value === 'thumbnail') return 'graphics';
            return value === 'video' || value === 'graphics' ? value : '';
        }
        /* The TEST-client write override was REMOVED 2026-08-06. It opened the
           write gate on an active `kind='test'` client while authority was
           still Linear, and stamped `test_override: true` on the payload — but
           no browser request can ever satisfy that flag. `production-write`
           rejects any `test_override` accompanied by a staff key or client
           token (`browserCredentialTestOverride` -> 401 `invalid_test_override`),
           because the flag exists solely for the service-authenticated drill,
           and `production_assert_authority` only waives the authority check for
           a principal whose `test_only` is true — which a staff principal never
           is. Dropping only the stamp would have converted the 401 into a 409
           `team_is_linear_authoritative`, so the control could not succeed by
           any path.

           The result was a button that looked live to staff and failed every
           time, reporting "Your staff sign-in expired" because the UI maps every
           401 to that sentence. The owner spent a session re-authenticating
           against a control that was never going to work.

           The Production tab is therefore read-only for humans until a team's
           authority is `syncview`, which is what the gate now says. TEST-client
           coverage belongs to the drill, which authenticates as the service role
           and exercises the same server paths. Do not reintroduce a browser-side
           bypass without a matching server path that accepts it. */
        // F136 — the creative half of the write gate reads the row's current
        // status and current assignee, exactly like the gateway. A creative can
        // no longer reach a reviewer/terminal row through All or a direct link
        // and regress, cancel, or duplicate it, nor mutate a peer's work.
        function _prodCreativeNextStatuses(issue) {
            const list = PROD_CREATIVE_STATUS_TRANSITIONS[String(issue && issue.sourceStatus || '').trim().toLowerCase()];
            return Array.isArray(list) ? list.slice() : [];
        }
        function _prodCreativeOwnsTarget(issue) {
            const identity = _syncviewStaffIdentityForHeaders();
            const me = String(identity && identity.member && identity.member.id || '').trim();
            return !!me && me === String(issue && issue.assignee || '').trim();
        }
        function _prodRoleCanWrite(issue, operation) {
            const identity = _syncviewStaffIdentityForHeaders();
            if (!identity || !issue) return false;
            const role = String(identity.role || '').trim().toLowerCase();
            if (role === 'admin' || role === 'smm') return true;
            if (role !== 'creative') return false;
            const memberTeam = _prodWriteTeam(identity.member && identity.member.team);
            /* A batch asset is not team-owned, so it is decided BEFORE the team
               match. Raw footage and the frame folder belong to the post: one
               shoot, one set of files, worked by the editor who cuts it and the
               designer who pulls a frame out of it. A batch carries a single
               team value, so matching on it would hand the shared folder to
               whichever team happened to be recorded. Mirrors staffOperationAllowed. */
            if (operation === 'batch_asset') return !!memberTeam;
            /* `batch_description` is NOT widened alongside it, and this line
               used to admit a creative for both. staffOperationAllowed returns
               false for it -- a description is admin/SMM everywhere in the
               estate, and #1203's review settled that opening the post-level
               one to creatives is an owner ruling nobody has made. The mismatch
               was masked while the batch-parent gate refused everyone; fixing
               that gate makes it reachable, so it is corrected in the same
               change rather than left to show a creative an Edit button the
               gateway would refuse. */
            if (operation === 'batch_description') return false;
            /* `attachment` joins them above the team match, by the owner ruling
               of 2026-09-01: any of graphics, video, SMM or admin may edit
               assets "on any parent issue or sub-issue". Mirrors
               staffOperationAllowed, which decides the same operation in the
               same place -- if these two ever disagree the browser either hides
               a control the gateway would accept, or offers one it will refuse.
               The FILMING PLAN is the named exception and needs no clause: it
               carries no `write` key in PROD_ASSET_SPECS, so no Edit control is
               ever rendered for it. */
            if (operation === 'attachment') return !!memberTeam;
            if (!memberTeam || memberTeam !== _prodWriteTeam(issue.team)) return false;
            /* Renaming a sub-issue (owner decision 2026-09-23): an editor may
               rename exactly the sub-issues they can already edit -- their team
               and assigned to them. Mirrors staffOperationAllowed, where
               `title` sits in CREATIVE_ASSIGNEE_BOUND_OPERATIONS beside status. */
            if (operation === 'title') return _prodCreativeOwnsTarget(issue);
            if (PROD_CREATIVE_ASSIGNEE_BOUND_OPERATIONS.includes(operation)
                && !_prodCreativeOwnsTarget(issue)) return false;
            if (operation === 'comment') return true;
            if (operation === 'status') return _prodCreativeNextStatuses(issue).length > 0;
            return false;
        }
        function _prodRoleGateText(issue, operation) {
            const identity = _syncviewStaffIdentityForHeaders();
            const role = String(identity && identity.role || '').trim().toLowerCase();
            if (role !== 'creative' || !issue) return 'Your staff role cannot perform this action.';
            const memberTeam = _prodWriteTeam(identity.member && identity.member.team);
            if (!memberTeam || memberTeam !== _prodWriteTeam(issue.team)) {
                return 'Your staff role cannot perform this action.';
            }
            if (PROD_CREATIVE_ASSIGNEE_BOUND_OPERATIONS.includes(operation)
                && !_prodCreativeOwnsTarget(issue)) {
                return 'This issue is not assigned to you.';
            }
            // Under the 2026-08-17 owner ruling every real status offers every
            // status, so this branch can only be reached by a row whose status
            // the app does not recognise: an unloaded or malformed row, never a
            // reviewer-owned one. The previous copy named reviewer ownership and
            // would now misdescribe the only case that reaches it.
            // (No apostrophes here on purpose: test/production-write-ui-source.js
            // slices this function with a scanner that reads one as a string.)
            if (operation === 'status' && !_prodCreativeNextStatuses(issue).length) {
                return 'This card has no recognised status yet — refresh, and tell an Admin if it persists.';
            }
            return 'Your staff role cannot perform this action.';
        }
        /* THE ONE NAME FOR A DESCRIPTION WRITE ON THIS ROW.
           A batch parent writes the POST's text onto the batch row through the
           `batch_description` operation; every other row writes its own brief
           through `description`. Three call sites need to agree on which: the
           control that renders the Edit button, the write itself, and the
           sentence shown when the write is refused.

           They did not agree, and #1203 shipped that way on 2026-09-01. The
           write was renamed to `batch_description` while the gate clause below
           still named `description`, so on a batch parent the gate refused the
           very operation the feature exists to perform -- and because the
           refusal text was computed with the OTHER name, the gate said the
           write was fine and the reader got the last-resort sentence, "This
           change is not allowed on this issue." An SMM lost a 10,000-character
           description to it and had no way to tell what was wrong. Nothing
           about the row was wrong.

           Derived once, here, so the three can no longer drift apart. */
        function _prodDescriptionOperation(issue) {
            return issue && issue.syntheticBatchParent === true ? 'batch_description' : 'description';
        }
        function _prodIsDescriptionOperation(operation) {
            return operation === 'description' || operation === 'batch_description';
        }
        function _prodCanWrite(issue, operation) {
            /* A synthesized batch parent is not a deliverable: the gateway has
               no row to write for a status, a due date, an assignee or a label,
               so those controls are gated rather than broken.
               ITS DESCRIPTION IS THE EXCEPTION, and it is not a special case so
               much as the missing half of one. The parent shows
               batches.description -- the POST's own text -- while every
               sub-issue carries its own brief, which is the shape the owner
               asked for on 2026-08-31: "like linear, so there's a description
               for the parent issue, and then there is the description for all
               of the sub-issues". The model was already that; only the write
               was missing, so a post description set at intake was permanent
               from every seat. It routes to the batch_description operation,
               which targets the batch row -- see _prodGatewayWrite. */
            if (issue && issue.syntheticBatchParent === true
                && !_prodIsDescriptionOperation(operation)) return false;
            if (!issue || _prodIdentityRepairGateText(issue)
                || !_prodAttributionResolved(issue) || !_prodRoleCanWrite(issue, operation)) return false;
            const team = _prodWriteTeam(issue.team);
            return !!(team && _prodState.authority && _prodState.authority[team] === 'syncview');
        }
        function _prodWriteGateText(issue, operation) {
            // Description is writable here now, so it must fall through to the
            // ordinary reasons rather than being told to go somewhere else.
            if (issue && issue.syntheticBatchParent === true
                && !_prodIsDescriptionOperation(operation)) {
                return "This is the post's batch parent — open its sub-issues to work on it.";
            }
            if (!_syncviewStaffIdentityForHeaders()) return 'Sign in with your staff account to write.';
            const identityGate = _prodIdentityRepairGateText(issue);
            if (identityGate) return identityGate;
            const attributionGate = _prodAttributionGateText(issue);
            if (attributionGate) return attributionGate;
            if (!_prodRoleCanWrite(issue, operation)) return _prodRoleGateText(issue, operation);
            const team = _prodWriteTeam(issue && issue.team);
            if (!_prodState.authorityLoaded || !_prodState.authority || !team) return 'Write controls are unavailable while authority is being checked.';
            if (_prodState.authority[team] !== 'syncview') return _prodTeamLabel(team) + ' stays read-only while Linear is authoritative.';
            return '';
        }
        function _prodWriteGateAttrs(issue, operation, allowedSurface) {
            const allowed = !!(issue && _prodCanWrite(issue, operation));
            const surface = allowedSurface || {};
            const gate = allowed ? '' : _prodWriteGateText(issue, operation);
            // surface.info carries the artifact informational tip text (status name, due date, assignee);
            // it survives the write gate, with the action shortcut or gate sentence riding as the hint segment.
            const info = String(surface.info || '');
            const hint = allowed ? String(surface.tip || '') : gate;
            const title = allowed ? String(surface.title || surface.info || '') : (info ? info + ' · ' + gate : gate);
            const tip = info ? (hint ? info + '|' + hint : info) : hint;
            return ' data-prod-write="' + (allowed ? 'on' : 'off') + '" aria-disabled="' + (allowed ? 'false' : 'true') + '"'
                + (title ? ' title="' + _calEscAttr(title) + '"' : '')
                + (tip ? ' data-prod-tip="' + _calEscAttr(tip) + '"' : '');
        }
        function _prodWriteRequestId(operation) {
            let entropy = '';
            try { entropy = crypto.randomUUID(); }
            catch (e) { entropy = Math.random().toString(36).slice(2) + Date.now().toString(36); }
            return 'prod:' + String(operation || 'write') + ':' + entropy;
        }
        function _prodCreateRoleAllowed() {
            const identity = _syncviewStaffIdentityForHeaders();
            const role = String(identity && identity.role || '').trim().toLowerCase();
            return role === 'admin' || role === 'smm';
        }
        function _prodCreateGateText(clientSlug, team, parent) {
            // Owner ruling 2026-08-23: closed for BOTH modes, for everyone.
            // Everything below is kept, unreachable, as the exact undo if the
            // ruling is ever revisited -- deleting it would make reopening a
            // rewrite instead of removing this line.
            return PROD_CREATE_CLOSED_TEXT;
            if (!_syncviewStaffIdentityForHeaders()) return 'Sign in with an Admin or SMM staff account to create issues.';
            if (!_prodCreateRoleAllowed()) return 'Only Admin and SMM staff can create Production issues.';
            const identityGate = _prodIdentityRepairGateText(parent);
            if (identityGate) return identityGate;
            if (parent && (!_prodAttributionResolved(parent) || parent.parent)) {
                return parent.parent
                    ? 'Create the sub-issue from a top-level parent issue.'
                    : _prodAttributionGateText(parent);
            }
            const client = _prodClient(clientSlug);
            if (clientSlug && (!client || !client.raw || client.raw.active !== true)) return 'Choose an active roster client.';
            if (client && String(client.raw && client.raw.kind || '').trim().toLowerCase() === 'test') {
                return 'TEST creation is reserved for the service-authenticated write drill.';
            }
            team = _prodWriteTeam(team);
            if (team) {
                if (!_prodState.authorityLoaded || !_prodState.authority) return 'Creation is unavailable while authority is being checked.';
                if (_prodState.authority[team] !== 'syncview') return _prodTeamLabel(team) + ' stays read-only while Linear is authoritative.';
            }
            return '';
        }
        function _prodCreateRecoveryGateText(draft) {
            if (!_syncviewStaffIdentityForHeaders()) return 'Sign in with the same Admin or SMM staff account to recover this issue.';
            if (!_prodCreateRoleAllowed()) return 'Only Admin and SMM staff can recover a Production creation attempt.';
            const client = _prodClient(draft && draft.clientSlug);
            if (!client || !client.raw || client.raw.active !== true) return 'The saved roster client is no longer active.';
            if (String(client.raw.kind || '').trim().toLowerCase() === 'test') {
                return 'TEST creation is reserved for the service-authenticated write drill.';
            }
            return '';
        }
        function _prodCreateTopbarButton(clientSlug, team) {
            const saved = _prodCreateSavedDraft();
            const recovering = !!(saved && saved.ambiguous);
            /*
             * One gate, no second copy. The unscoped board used to re-implement
             * the gate inline here, which is why the New issue button rendered
             * ENABLED on the main Production board and on any Graphics project
             * page while the real gate refused -- a live-looking button that
             * dead-ended in a toast. It now asks _prodCreateGateText the same
             * question every other caller asks, so the closure cannot be true
             * in three places and false in the fourth.
             */
            // Issues are created from the content calendar, never here
            // (owner, 2026-09-26): no New issue button at all. Only an
            // ambiguous saved draft (a create that may already have
            // committed) still gets its Recover control.
            if (!recovering) return '';
            const gate = _prodCreateRecoveryGateText(saved);
            return '<button class="prod-create-trigger" type="button" data-prod-create-trigger="1"'
                + (gate
                    ? ' disabled title="' + _calEscAttr(gate) + '" data-prod-tip="' + _calEscAttr(gate) + '"'
                    : ' onclick="return _prodOpenCreate()" title="Recover saved Production issue" data-prod-tip="Recover saved issue"')
                + '>' + _prodIcon('plus') + '<span>Recover issue</span></button>';
        }
        function _prodCreateValidDate(value) {
            if (!value) return true;
            const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
            if (!match) return false;
            const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
            return date.getUTCFullYear() === +match[1]
                && date.getUTCMonth() === +match[2] - 1
                && date.getUTCDate() === +match[3];
        }
        function _prodCreateSavedDraft() {
            try {
                const saved = JSON.parse(sessionStorage.getItem(PROD_CREATE_DRAFT_KEY) || 'null');
                if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null;
                if (Date.now() - Number(saved.savedAt || 0) > 7 * 864e5) return null;
                if (!['parent', 'subissue'].includes(saved.mode)) return null;
                if (!Array.isArray(saved.labelIds)) return null;
                const status = String(saved.status || '');
                const allowedStatuses = new Set(Object.values(PROD_STATUS_FROM_ARTIFACT));
                return {
                    mode: saved.mode,
                    parentId: String(saved.parentId || ''),
                    parentLocked: saved.parentLocked === true,
                    ambiguous: saved.ambiguous === true,
                    clientSlug: String(saved.clientSlug || ''),
                    team: _prodWriteTeam(saved.team) || 'video',
                    title: String(saved.title || '').slice(0, 500),
                    description: String(saved.description || '').slice(0, 100000),
                    status: allowedStatuses.has(status) ? status : PROD_CREATED_STATUS,
                    dueDate: _prodCreateValidDate(saved.dueDate) ? String(saved.dueDate || '') : '',
                    assigneeId: String(saved.assigneeId || ''),
                    labelIds: [...new Set(saved.labelIds.map(value => String(value || '').trim()).filter(Boolean))],
                    requestId: /^[a-zA-Z0-9][a-zA-Z0-9:_-]{7,199}$/.test(String(saved.requestId || ''))
                        ? String(saved.requestId)
                        : _prodWriteRequestId('create'),
                    sourceEditedAt: Number.isFinite(Date.parse(String(saved.sourceEditedAt || '')))
                        ? String(saved.sourceEditedAt)
                        : new Date().toISOString(),
                    savedAt: Number(saved.savedAt || Date.now())
                };
            } catch (e) {
                return null;
            }
        }
        function _prodPersistCreateDraft() {
            const draft = _prodState.createDraft;
            try {
                if (!draft) sessionStorage.removeItem(PROD_CREATE_DRAFT_KEY);
                else {
                    draft.savedAt = Date.now();
                    sessionStorage.setItem(PROD_CREATE_DRAFT_KEY, JSON.stringify(draft));
                }
            } catch (e) {}
        }
        function _prodRenewCreateIntent() {
            const draft = _prodState.createDraft;
            if (!draft) return;
            draft.requestId = _prodWriteRequestId('create');
            draft.sourceEditedAt = new Date().toISOString();
            _prodState.createError = '';
            _prodPersistCreateDraft();
        }
        function _prodCreateDefaults(parentId) {
            const parent = parentId ? _prodIssue(parentId) : null;
            const openIssue = _prodState.openId ? _prodIssue(_prodState.openId) : null;
            let clientSlug = parent && parent.project
                || (_prodState.openProjectId && _prodClient(_prodState.openProjectId) ? _prodState.openProjectId : '')
                || (_prodState.clientSlug && _prodClient(_prodState.clientSlug) ? _prodState.clientSlug : '')
                || (openIssue && _prodAttributionResolved(openIssue) ? openIssue.project : '');
            if (!clientSlug) {
                const firstClient = Object.values(_prodProjects())
                    .filter(client => client && client.raw && client.raw.active === true
                        && String(client.raw.kind || '').trim().toLowerCase() !== 'test')
                    .sort((a, b) => String(a.name).localeCompare(String(b.name)))[0];
                clientSlug = firstClient ? firstClient.id : '';
            }
            const client = _prodClient(clientSlug);
            const scopedTeam = _prodState.team === 'video' || _prodState.team === 'graphics' ? _prodState.team : '';
            let team = _prodWriteTeam(parent && parent.team)
                || scopedTeam
                || _prodWriteTeam(client && client.team)
                || 'video';
            /*
             * This used to steer the default toward whichever team is
             * SyncView-native, which after the flip means it preselected
             * GRAPHICS -- pointing people at the one door that makes orphans,
             * since nothing created here gets a Calendar or Samples card. The
             * dialog is Video-only now (see teamItems), so a graphics context
             * resolves to Video and the form says why, rather than silently
             * creating the wrong thing or offering a value the list no longer
             * contains.
             */
            const graphicsContext = team === 'graphics';
            if (graphicsContext) team = 'video';
            return {
                mode: parent ? 'subissue' : 'parent',
                parentId: parent ? parent.id : '',
                parentLocked: !!parent,
                ambiguous: false,
                clientSlug,
                team,
                graphicsContext,
                title: '',
                description: '',
                status: PROD_CREATED_STATUS,
                dueDate: '',
                assigneeId: '',
                labelIds: [],
                requestId: _prodWriteRequestId('create'),
                sourceEditedAt: new Date().toISOString(),
                savedAt: Date.now()
            };
        }
        /* The `linear_issue_uuid` clause stays. It looks like the same
           native-card exclusion #1444 removed elsewhere, and a first version
           of this function dropped it on that reading -- but it is not that:
           it is the one thing here that mirrors what the GATEWAY can actually
           route to. `productionCreateParentRoute`
           (supabase/functions/production-write/index.ts) resolves `parent_id`
           only against `deliverables`, requires
           `parentLinearIssueId(parent)` (== `linear_issue_uuid`, with no
           native fallback) to be non-empty, and validates it against
           `batches.linear_parent_ids` -- a synthetic batch-parent node's id
           is a BATCH id, not a deliverable id, and a native deliverable
           permanently has no Linear issue id, so the gateway refuses BOTH
           with `create_parent_not_found` / `production_create_parent_scope`.
           Offering them here would only be safe once the gateway can route to
           them too, and that is backend work this browser-only change cannot
           do. Caught by Codex review on PR #1447, which tried removing this
           exact clause first. */
        function _prodCreateParents(draft) {
            return _prodIssues().filter(issue =>
                issue && !issue.parent && _prodAttributionResolved(issue)
                && issue.project === draft.clientSlug
                && _prodWriteTeam(issue.team) === _prodWriteTeam(draft.team)
                && String(issue.raw && issue.raw.linear_issue_uuid || '').trim()
            ).sort((a, b) => String(a.title || _prodIssueLabel(a)).localeCompare(String(b.title || _prodIssueLabel(b))));
        }
        function _prodCreateAssignees(draft) {
            return (_prodState.createAssignees || []).slice()
                .sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)));
        }
        function _prodNormalizeCreateAssignees(values) {
            if (!Array.isArray(values)) return null;
            const seen = new Set();
            const normalized = [];
            for (const value of values) {
                if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
                const id = String(value.id || '').trim();
                const name = String(value.name || '').trim();
                if (!id || !name || seen.has(id)) return null;
                seen.add(id);
                normalized.push({ id, name });
            }
            return normalized;
        }
        function _prodCreateAssigneeFieldHTML(draft) {
            const assigneeItems = [{ value: '', label: 'Unassigned' }].concat(
                _prodCreateAssignees(draft).map(member => ({
                    value: member.id,
                    label: member.name
                }))
            );
            return '<label for="prodCreateAssigneeBtn">Assignee</label>'
                + _svSelectHtml('prodCreateAssignee', assigneeItems, draft.assigneeId, 'Unassigned', {
                    disabled: draft.ambiguous === true,
                    onchange: '_prodCreateField("assigneeId",this.value)'
                });
        }
        function _prodCreateCatalogHTML() {
            const draft = _prodState.createDraft;
            if (!draft) return '';
            if (_prodState.createCatalogStatus === 'loading') {
                return '<div class="prod-create-label-empty" data-prod-create-label-state="loading">Loading the Linear label catalog…</div>';
            }
            if (_prodState.createCatalogStatus === 'error') {
                return '<div class="prod-create-label-empty" data-prod-create-label-state="error">' + _calEsc(_prodState.createCatalogError || 'Labels unavailable.') + ' <button class="prod-label-retry" type="button" onclick="_prodLoadCreateOptions(true)">Retry</button></div>';
            }
            const selected = new Set(draft.labelIds || []);
            const locked = draft.ambiguous === true;
            if (!_prodState.createCatalog.length) {
                return '<div class="prod-create-label-empty" data-prod-create-label-state="empty">No labels are available for this team.</div>';
            }
            return _prodState.createCatalog.map(label => {
                const tip = label.description || label.name;
                return '<label class="prod-create-label-option" data-prod-create-label-option="' + _calEscAttr(label.id) + '" data-prod-create-label-search="' + _calEscAttr((label.name + ' ' + label.description).toLowerCase()) + '" title="' + _calEscAttr(tip) + '">'
                    + '<input type="checkbox" value="' + _calEscAttr(label.id) + '"' + (selected.has(label.id) ? ' checked' : '') + (locked ? ' disabled' : '') + ' onchange="_prodToggleCreateLabel(this.value,this.checked)">'
                    + '<span class="prod-label-dot"' + _prodLabelColorStyle(label) + '></span>'
                    + '<span class="prod-create-label-copy"><span>' + _calEsc(label.name) + '</span>' + (label.description ? '<small>' + _calEsc(label.description) + '</small>' : '') + '</span></label>';
            }).join('');
        }
        function _prodCreateFormHTML() {
            const draft = _prodState.createDraft;
            if (!draft) return '';
            const parentFixed = draft.parentLocked === true;
            const recoveryLocked = draft.ambiguous === true;
            const recoveryLockAttr = recoveryLocked ? ' disabled' : '';
            const parent = draft.parentId ? _prodIssue(draft.parentId) : null;
            const clients = Object.values(_prodProjects())
                .filter(client => client && client.raw && client.raw.active === true
                    && String(client.raw.kind || '').trim().toLowerCase() !== 'test')
                .sort((a, b) => String(a.name).localeCompare(String(b.name)));
            const parents = _prodCreateParents(draft);
            const modeItems = [
                { value: 'parent', label: 'Parent issue' },
                { value: 'subissue', label: 'Sub-issue' }
            ];
            const clientItems = clients.map(client => ({
                value: client.id,
                label: client.name || client.id
            }));
            /*
             * Graphics is deliberately absent (owner ruling 2026-08-17).
             *
             * This dialog writes ONLY the Production issue hierarchy -- it says
             * so in its own subtitle -- so a graphics issue created here has no
             * Calendar or Samples card behind it. Post-flip that is exactly how
             * orphans are made: on 2026-08-17 three thumbnails created this way
             * ended up as duplicates of cards that already existed, one of them
             * invisible to the designer who was supposed to make it.
             *
             * Graphics work starts on the Calendar or Samples card, which
             * creates the deliverable AND its Linear issue, linked. Video kept
             * this door because Video was still Linear-authoritative when this
             * was written; Video flipped 2026-08-28, so that premise is gone
             * and this "revisit it when Video flips" note is exactly that
             * revisit trigger. It's moot in practice today only because
             * _prodCreateGateText (~50731) closed the WHOLE dialog for
             * everyone on 2026-08-23, for an unrelated reason, and kept its
             * old per-team logic below the early return as a deliberate,
             * documented "exact undo" -- so this array is reachable again the
             * moment that closure is lifted, still offering Video a door the
             * same graphics owner ruling says produces orphans.
             */
            const teamItems = [
                { value: 'video', label: 'Video' }
            ];
            // A sub-issue draft pinned to a graphics parent carries
            // team=graphics with the picker locked. The value must be IN the
            // list or the disabled control falls back to its "Choose team"
            // placeholder -- a locked select inviting a choice it cannot take
            // (reported by the owner 2026-08-18). Appended only when already
            // locked-in, so the open Video-only choice set never widens.
            if (draft.team === 'graphics') {
                teamItems.push({ value: 'graphics', label: 'Graphics' });
            }
            const parentItems = [{ value: '', label: 'Choose parent issue' }].concat(parents.map(issue => ({
                value: issue.id,
                label: (_prodIssueDisplayLabel(issue) ? _prodIssueDisplayLabel(issue) + ' · ' : '') + (_prodKnownName(issue) || 'Untitled issue')
            })));
            const statusItems = PROD_STATUS_ORDER.map(status => {
                const value = PROD_STATUS_FROM_ARTIFACT[status] || status;
                return { value, label: _prodStatusLabel(status) };
            });
            const lockedScope = draft.mode === 'subissue' && !!parent;
            return '<form class="prod-create-modal" data-prod-create-modal="1" onsubmit="return _prodSubmitCreate(event)">'
                + '<div class="prod-create-head"><div><h2>' + (draft.mode === 'subissue' ? 'Create sub-issue' : 'Create parent issue') + '</h2><p>Production-side only · no Calendar or Samples card will be created or linked</p></div><span class="prod-spacer"></span><button class="prod-create-close" type="button" onclick="_prodCloseCreate()" aria-label="Close">&times;</button></div>'
                + '<div class="prod-create-body">'
                + (draft.graphicsContext
                    ? '<div class="prod-create-note" data-prod-create-graphics-note="1">'
                        + 'Graphics work is not created here. This form writes only the Production issue '
                        + 'hierarchy, so a thumbnail made here would have no Calendar or Samples card behind '
                        + 'it and the designer would never see it. Create the card on the Calendar or Samples '
                        + 'tab instead \u2014 it creates the thumbnail and its Linear issue together, linked.'
                        + '</div>'
                    : '')
                + '<div class="prod-create-field"><label for="prodCreateModeBtn">Issue type</label>' + _svSelectHtml('prodCreateMode', modeItems, draft.mode, 'Choose issue type', { disabled: parentFixed || recoveryLocked, onchange: '_prodCreateModeChange(this.value)' }) + '</div>'
                + '<div class="prod-create-field"><label for="prodCreateClientBtn">Roster client</label>' + _svSelectHtml('prodCreateClient', clientItems, draft.clientSlug, 'Choose roster client', { disabled: lockedScope || recoveryLocked, onchange: '_prodCreateScopeChange("clientSlug",this.value)' }) + '</div>'
                + '<div class="prod-create-field"><label for="prodCreateTeamBtn">Team</label>' + _svSelectHtml('prodCreateTeam', teamItems, draft.team, 'Choose team', { disabled: lockedScope || recoveryLocked, onchange: '_prodCreateScopeChange("team",this.value)' }) + '</div>'
                + (draft.mode === 'subissue' ? '<div class="prod-create-field"><label for="prodCreateParentBtn">Parent issue</label>' + _svSelectHtml('prodCreateParent', parentItems, draft.parentId, 'Choose parent issue', { disabled: parentFixed || recoveryLocked, onchange: '_prodCreateParentChange(this.value)' }) + '</div>' : '<div class="prod-create-field"><label for="prodCreateHierarchy">Hierarchy</label><input class="prod-create-input" id="prodCreateHierarchy" value="Top-level parent issue" disabled></div>')
                + '<div class="prod-create-field wide"><label for="prodCreateTitle">Title</label><input class="prod-create-input" id="prodCreateTitle" maxlength="500" required value="' + _calEscAttr(draft.title) + '" oninput="_prodCreateField(' + _jsAttrArg('title') + ',this.value)" placeholder="Issue title"' + recoveryLockAttr + '></div>'
                + '<div class="prod-create-field wide"><label for="prodCreateDescription">Description (Markdown)</label><textarea class="prod-create-textarea" id="prodCreateDescription" maxlength="100000" oninput="_prodCreateField(' + _jsAttrArg('description') + ',this.value)" placeholder="Add context, acceptance criteria, and links…"' + recoveryLockAttr + '>' + _calEsc(draft.description) + '</textarea></div>'
                + '<div class="prod-create-field"><label for="prodCreateStatusBtn">Status</label>' + _svSelectHtml('prodCreateStatus', statusItems, draft.status, 'Choose status', { disabled: recoveryLocked, onchange: '_prodCreateField("status",this.value)' }) + '</div>'
                + '<div class="prod-create-field"><label for="prodCreateDueBtn">Due date</label>' + _svDateHtml('prodCreateDue', draft.dueDate, { disabled: recoveryLocked, today: wlWorkloadTodayISO(), placeholder: 'Choose due date', onchange: '_prodCreateField("dueDate",this.value)' }) + '</div>'
                + '<div class="prod-create-field" data-prod-create-assignee-field="1">' + _prodCreateAssigneeFieldHTML(draft) + '</div>'
                + '<div class="prod-create-field"><label>Selected labels</label><input class="prod-create-input" value="' + _calEscAttr(String((draft.labelIds || []).length) + ' selected') + '" disabled></div>'
                + '<div class="prod-create-field wide"><label>Labels</label><div class="prod-create-label-box"><div class="prod-create-label-head"><span>Catalog</span><input class="prod-create-label-search" type="search" placeholder="Search labels" oninput="_prodFilterCreateLabels(this.value)" aria-label="Search labels"' + recoveryLockAttr + '></div><div class="prod-create-label-list" data-prod-create-label-list="1">' + _prodCreateCatalogHTML() + '</div></div></div>'
                + '<div class="prod-create-note">Creation writes only the Production issue hierarchy. It does not create, choose, or link a Calendar/Samples card.</div>'
                + (recoveryLocked ? '<div class="prod-create-note" data-prod-create-recovery-note="1">This request may already have committed. Its exact fields are locked; retrying recovers the same native issue and never creates a second one.</div>' : '')
                + '<div class="prod-create-error" role="alert" data-prod-create-error="1">' + _calEsc(_prodState.createError || '') + '</div>'
                + '</div><div class="prod-create-foot"><span class="prod-spacer"></span><button class="prod-create-secondary" type="button" onclick="_prodCloseCreate()">Cancel</button><button class="prod-create-submit" type="submit"' + (_prodState.createSubmitting ? ' disabled' : '') + '>' + (_prodState.createSubmitting ? 'Creating…' : recoveryLocked ? 'Retry saved attempt' : (draft.mode === 'subissue' ? 'Create sub-issue' : 'Create parent issue')) + '</button></div></form>';
        }
        function _prodRenderCreateModal() {
            const layer = document.getElementById('prodLayer');
            if (!layer || !_prodState.createDraft) return;
            layer.innerHTML = '<div class="prod-create-bd" data-prod-create-backdrop="1" data-backdrop-dismiss>' + _prodCreateFormHTML() + '</div>';
            layer.style.pointerEvents = 'auto';
            const backdrop = layer.querySelector('[data-prod-create-backdrop]');
            if (backdrop) backdrop.addEventListener('click', event => {
                if (event.target === backdrop && backdrop._backdropPressBegan) _prodCloseCreate();
            });
        }
        function _prodRenderCreateCatalog() {
            const host = document.querySelector('[data-prod-create-label-list]');
            if (host) host.innerHTML = _prodCreateCatalogHTML();
        }
        function _prodRenderCreateAssignees() {
            const host = document.querySelector('[data-prod-create-assignee-field]');
            if (host && _prodState.createDraft) {
                host.innerHTML = _prodCreateAssigneeFieldHTML(_prodState.createDraft);
            }
        }
        function _prodOpenCreate(parentId) {
            const parent = parentId ? _prodIssue(parentId) : null;
            if (parentId && (!parent || parent.parent || !_prodAttributionResolved(parent))) {
                _prodToast(parent && parent.parent ? 'Create sub-issues from a top-level parent.' : _prodAttributionGateText(parent));
                return false;
            }
            const saved = _prodCreateSavedDraft();
            const recovering = !!(saved && saved.ambiguous);
            _prodState.createDraft = recovering
                ? saved
                : saved && (!parent || saved.parentId === parent.id)
                    ? saved
                    : _prodCreateDefaults(parentId);
            // A response-loss retry owns one exact semantic intent. Opening
            // Add Sub from another row must never retarget or replace it.
            if (parent && !recovering) {
                _prodState.createDraft.mode = 'subissue';
                _prodState.createDraft.parentId = parent.id;
                _prodState.createDraft.parentLocked = true;
                _prodState.createDraft.clientSlug = parent.project;
                // The parent team is assigned RAW on purpose. Sub-issue
                // creation under a GRAPHICS parent stays open with the team
                // pinned to graphics -- graphics is SyncView-authoritative, so
                // the gate admits it, and the locked scope pickers keep the
                // pin out of reach. Normalising this to video (tried
                // 2026-08-19) handed the pre-flip gate a VIDEO create, which
                // it refuses -- closing sub-issue creation under every
                // graphics parent. The Video-only ruling governs what the
                // team picker OFFERS, not what a locked parent pins.
                _prodState.createDraft.team = _prodWriteTeam(parent.team);
            }
            const draftParent = _prodState.createDraft.mode === 'subissue'
                ? _prodIssue(_prodState.createDraft.parentId)
                : null;
            const gate = _prodState.createDraft.ambiguous
                ? _prodCreateRecoveryGateText(_prodState.createDraft)
                : _prodCreateGateText(_prodState.createDraft.clientSlug, _prodState.createDraft.team, draftParent);
            if (gate) {
                _prodState.createDraft = null;
                _prodToast(gate);
                return false;
            }
            _prodState.createCatalog = [];
            _prodState.createAssignees = [];
            _prodState.createCatalogStatus = 'loading';
            _prodState.createCatalogError = '';
            _prodState.createError = '';
            _prodState.createSubmitting = false;
            _prodPersistCreateDraft();
            _prodEnsureOverlays();
            _prodRenderCreateModal();
            _prodLoadCreateOptions(false);
            setTimeout(() => document.getElementById('prodCreateTitle')?.focus(), 0);
            return false;
        }
        function _prodCloseCreate() {
            _prodState.createSubmitting = false;
            _prodClearLayer();
            return false;
        }
        function _prodCreateField(field, value) {
            const draft = _prodState.createDraft;
            if (!draft || draft.ambiguous || !['title', 'description', 'status', 'dueDate', 'assigneeId'].includes(field)) return;
            value = String(value == null ? '' : value);
            if (draft[field] === value) return;
            draft[field] = value;
            _prodRenewCreateIntent();
        }
        function _prodCreateScopeChange(field, value) {
            const draft = _prodState.createDraft;
            if (!draft || draft.ambiguous || !['clientSlug', 'team'].includes(field)) return;
            if (draft.mode === 'subissue' && draft.parentId) return;
            value = field === 'team' ? _prodWriteTeam(value) : String(value || '');
            if (!value || draft[field] === value) return;
            draft[field] = value;
            draft.parentId = '';
            draft.assigneeId = '';
            draft.labelIds = [];
            _prodRenewCreateIntent();
            _prodState.createCatalog = [];
            _prodState.createAssignees = [];
            _prodState.createCatalogStatus = 'loading';
            _prodRenderCreateModal();
            _prodLoadCreateOptions(false);
        }
        function _prodCreateModeChange(value) {
            const draft = _prodState.createDraft;
            if (!draft || draft.ambiguous || !['parent', 'subissue'].includes(value) || draft.mode === value) return;
            draft.mode = value;
            draft.parentId = '';
            draft.parentLocked = false;
            _prodRenewCreateIntent();
            _prodRenderCreateModal();
        }
        function _prodCreateParentChange(value) {
            const draft = _prodState.createDraft;
            const parent = _prodIssue(value);
            if (!draft || draft.ambiguous || draft.mode !== 'subissue') return;
            if (!value) {
                draft.parentId = '';
                _prodRenewCreateIntent();
                _prodRenderCreateModal();
                return;
            }
            if (!parent || parent.parent || !_prodAttributionResolved(parent)) {
                _prodState.createError = 'Choose a resolved top-level parent issue.';
                _prodRenderCreateModal();
                return;
            }
            draft.parentId = parent.id;
            draft.clientSlug = parent.project;
            draft.team = _prodWriteTeam(parent.team);
            draft.assigneeId = '';
            draft.labelIds = [];
            _prodRenewCreateIntent();
            _prodState.createCatalog = [];
            _prodState.createAssignees = [];
            _prodState.createCatalogStatus = 'loading';
            _prodRenderCreateModal();
            _prodLoadCreateOptions(false);
        }
        function _prodToggleCreateLabel(labelId, checked) {
            const draft = _prodState.createDraft;
            labelId = String(labelId || '').trim();
            if (!draft || draft.ambiguous || !labelId) return;
            const next = new Set(draft.labelIds || []);
            if (checked) next.add(labelId);
            else next.delete(labelId);
            draft.labelIds = [...next].sort();
            _prodRenewCreateIntent();
            const count = document.querySelector('[data-prod-create-modal] .prod-create-field input[disabled][value$=" selected"]');
            if (count) count.value = String(draft.labelIds.length) + ' selected';
        }
        function _prodFilterCreateLabels(value) {
            const query = String(value || '').trim().toLowerCase();
            document.querySelectorAll('[data-prod-create-label-option]').forEach(row => {
                row.style.display = !query || String(row.getAttribute('data-prod-create-label-search') || '').includes(query) ? '' : 'none';
            });
        }
        async function _prodLoadCreateOptions(force) {
            const draft = _prodState.createDraft;
            if (!draft || _prodState.createSubmitting) return;
            const token = ++_prodState.createCatalogToken;
            _prodState.createCatalogStatus = 'loading';
            _prodState.createCatalogError = '';
            _prodState.createAssignees = [];
            if (force) {
                _prodRenderCreateCatalog();
                _prodRenderCreateAssignees();
            }
            try {
                const response = await fetch(PROD_WRITE_EF_URL, {
                    method: 'POST',
                    cache: 'no-store',
                    headers: _syncviewEfHeaders({
                        apikey: CAL_SUPABASE_ANON_KEY,
                        Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY,
                        Accept: 'application/json',
                        'Content-Type': 'application/json'
                    }, PROD_WRITE_EF_URL),
                    body: JSON.stringify({
                        action: 'create_options',
                        surface: 'production',
                        client_slug: draft.clientSlug,
                        team: draft.team
                    })
                });
                const json = await response.json().catch(() => ({}));
                if (!response.ok || !json || json.ok !== true || json.complete !== true) {
                    const error = new Error(String(json && json.error || 'create_options_failed'));
                    error.code = String(json && json.error || 'create_options_failed');
                    error.status = response.status;
                    throw error;
                }
                const catalog = _prodNormalizeLabelList(json.catalog);
                const assignees = _prodNormalizeCreateAssignees(json.assignees);
                if (!catalog) throw new Error('label_catalog_incomplete');
                if (!assignees) throw new Error('assignee_options_incomplete');
                if (token !== _prodState.createCatalogToken || !_prodState.createDraft
                    || draft.clientSlug !== _prodState.createDraft.clientSlug
                    || draft.team !== _prodState.createDraft.team) return;
                const allowed = new Set(catalog.map(label => label.id));
                const allowedAssignees = new Set(assignees.map(member => member.id));
                if (!draft.ambiguous) {
                    draft.labelIds = (draft.labelIds || []).filter(labelId => allowed.has(labelId));
                    if (draft.assigneeId && !allowedAssignees.has(draft.assigneeId)) {
                        draft.assigneeId = '';
                        _prodRenewCreateIntent();
                    }
                }
                _prodState.createCatalog = catalog;
                _prodState.createAssignees = assignees;
                _prodState.createCatalogStatus = 'ready';
                _prodPersistCreateDraft();
            } catch (error) {
                if (token !== _prodState.createCatalogToken) return;
                const code = String(error && (error.code || error.message) || '');
                _prodState.createCatalogStatus = 'error';
                _prodState.createCatalogError = code === 'team_is_linear_authoritative'
                    ? _prodTeamLabel(draft.team) + ' stays read-only while Linear is authoritative.'
                    : code === 'project_mapping_missing' || code === 'project_mapping_ambiguous'
                        ? 'This roster client needs an exact team project mapping before creation.'
                        : error && error.status === 401
                            ? 'Staff sign-in expired. Sign in again to create.'
                            : 'The complete Linear label catalog could not be loaded.';
            }
            _prodRenderCreateCatalog();
            _prodRenderCreateAssignees();
        }
        function _prodCreateErrorText(error) {
            const code = String(error && error.code || '');
            if (code === 'write_conflict' || code === 'parent_changed') return 'The parent changed elsewhere. Refresh and try again.';
            if (code === 'create_mirror_pending') return 'The issue is saved in Production. Its exact fields stay locked while Linear catches up; Retry checks the same attempt and cannot create a duplicate.';
            if (code === 'idempotency_conflict' && error && error.nativeCommitted) return 'The issue is saved in Production, but its Linear create ID conflicts with another issue. The saved issue will open for explicit repair; no second issue was created.';
            if (code === 'idempotency_conflict') return 'This request conflicts with durable create state. Its exact fields stay locked to prevent a duplicate; retry only checks the same attempt.';
            if (code === 'identity_repair_required') return 'This saved issue needs Linear identity repair and stays read-only. No second issue was created.';
            if (code === 'team_is_linear_authoritative') return 'This team is read-only while Linear is authoritative.';
            if (code === 'test_scope_service_only' || code === 'invalid_test_override') return 'TEST creation is reserved for the service-authenticated write drill.';
            if (code === 'project_mapping_missing' || code === 'project_mapping_ambiguous') return 'This roster client needs an exact team project mapping before creation.';
            if (code === 'label_selection_out_of_catalog' || code === 'label_catalog_incomplete' || code === 'label_not_applicable') return 'The complete label catalog changed. Reload labels and try again.';
            if (code === 'assignee_out_of_scope' || code === 'assignee_mapping_unavailable' || code === 'assignee_mapping_missing') return 'Choose an active, Linear-mapped assignee from this team.';
            if (code === 'create_parent_not_found' || code === 'production_create_parent_scope'
                || code === 'production_create_parent_nested' || code === 'production_create_batch_scope'
                || code === 'production_create_parent_route' || code === 'parent_not_root'
                || code === 'parent_scope_mismatch' || code === 'parent_linear_issue_unavailable') {
                return 'Choose a current top-level parent from the same client and team.';
            }
            if (code === 'production_create_closed') return PROD_CREATE_CLOSED_TEXT;
            if (code === 'operation_forbidden') return 'Only Admin and SMM staff can create Production issues.';
            if (error && error.status === 401) return 'Staff sign-in expired. Sign in again to create.';
            return 'The issue was not created. Your draft is still here; retry when the connection is ready.';
        }
        function _prodCreatePayload(draft) {
            return {
                operation: 'create',
                surface: 'production',
                client_slug: draft.clientSlug,
                team: draft.team,
                parent_id: draft.mode === 'subissue' ? draft.parentId : null,
                title: String(draft.title).trim(),
                description: String(draft.description || ''),
                status: draft.status,
                due_date: draft.dueDate || null,
                assignee_id: draft.assigneeId || null,
                label_ids: [...(draft.labelIds || [])],
                request_id: draft.requestId,
                source_edited_at: draft.sourceEditedAt
            };
        }
        async function _prodPostCreatePayload(payload) {
            const response = await fetch(PROD_WRITE_EF_URL, {
                method: 'POST',
                cache: 'no-store',
                headers: _syncviewEfHeaders({
                    apikey: CAL_SUPABASE_ANON_KEY,
                    Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY,
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                }, PROD_WRITE_EF_URL),
                body: JSON.stringify(payload)
            });
            const json = await response.json().catch(() => ({}));
            if (!response.ok || !json || json.ok !== true || json.native_committed !== true
                || !json.row || !json.row.id) {
                const error = new Error(String(json && json.error || 'create_failed'));
                error.code = String(json && json.error || 'create_failed');
                error.status = response.status;
                error.nativeCommitted = !!(json && json.native_committed === true);
                error.row = json && json.row && json.row.id ? json.row : null;
                throw error;
            }
            return json;
        }
        async function _prodPollCreatePayload(payload, firstResult) {
            let result = firstResult;
            for (const delay of [250, 500, 1000]) {
                if (!result.mirror_pending) break;
                await new Promise(resolve => setTimeout(resolve, delay));
                result = await _prodPostCreatePayload(payload);
            }
            return result;
        }
        async function _prodSubmitCreate(event) {
            if (event) event.preventDefault();
            const draft = _prodState.createDraft;
            if (!draft || _prodState.createSubmitting) return false;
            const parent = draft.mode === 'subissue' ? _prodIssue(draft.parentId) : null;
            const gate = draft.ambiguous
                ? _prodCreateRecoveryGateText(draft)
                : _prodCreateGateText(draft.clientSlug, draft.team, parent);
            let errorText = gate;
            if (!String(draft.title || '').trim()) errorText = 'Add an issue title.';
            else if (String(draft.title).trim().length > 500) errorText = 'Keep the issue title at 500 characters or fewer.';
            else if (String(draft.description || '').length > 100000 || String(draft.description || '').includes('\0')) errorText = 'The Markdown description is too long or contains an unsupported character.';
            else if (!_prodCreateValidDate(draft.dueDate)) errorText = 'Choose a valid due date with its full year.';
            else if (!draft.ambiguous && draft.mode === 'subissue' && (!parent || parent.parent)) errorText = 'Choose a current top-level parent issue.';
            else if (!draft.ambiguous && _prodState.createCatalogStatus !== 'ready') errorText = 'Wait for the complete label catalog before creating.';
            const catalogIds = new Set((_prodState.createCatalog || []).map(label => label.id));
            if (!errorText && !draft.ambiguous && (draft.labelIds || []).some(labelId => !catalogIds.has(labelId))) {
                errorText = 'Reload the label catalog before creating.';
            }
            const assigneeIds = new Set((_prodState.createAssignees || []).map(member => member.id));
            if (!errorText && !draft.ambiguous && draft.assigneeId && !assigneeIds.has(draft.assigneeId)) {
                errorText = 'Choose an active, Linear-mapped assignee from this team.';
            }
            if (errorText) {
                _prodState.createError = errorText;
                _prodRenderCreateModal();
                return false;
            }
            _prodState.createSubmitting = true;
            _prodState.createError = '';
            _prodRenderCreateModal();
            try {
                const payload = _prodCreatePayload(draft);
                const firstResult = await _prodPostCreatePayload(payload);
                const json = await _prodPollCreatePayload(payload, firstResult);
                if (json.mirror_pending) {
                    draft.ambiguous = true;
                    _prodState.createError = _prodCreateErrorText({ code: 'create_mirror_pending' });
                    _prodState.createSubmitting = false;
                    _prodPersistCreateDraft();
                    _prodRenderCreateModal();
                    return false;
                }
                const createdId = String(json.row.id);
                _prodState.createDraft = null;
                _prodPersistCreateDraft();
                _prodClearLayer();
                _prodToast(json.mirror_pending ? 'Issue created · Linear is catching up' : 'Issue created');
                await _prodLoadData({ silent: true });
                if (_prodIssue(createdId)) _prodOpenDeliverable(createdId);
                return false;
            } catch (error) {
                _writeUiRecordFailure('production', 'create', error);
                const code = String(error && error.code || '');
                /*
                 * `production_create_closed` is a DEFINITIVE no-replay verdict,
                 * and it is the only refusal here that retiring a draft is safe
                 * on. The gateway throws it AFTER productionCreateReplay: if a
                 * row had committed, the replay would have returned that row and
                 * this line would never be reached. So a 403 here proves nothing
                 * landed, and the draft describes work that can never be sent.
                 *
                 * Retiring it is not optional. An `ambiguous` draft survives a
                 * 4xx by design -- the two branches below only ever SET the flag
                 * -- so without this the toolbar would keep offering "Recover
                 * issue" and the modal "Retry saved attempt", each retry earning
                 * the same 403, for seven days or until the tab closed. A button
                 * whose only outcome is the same refusal is the dead end this
                 * closure exists to remove, not one to add.
                 */
                if (code === 'production_create_closed') {
                    _prodState.createDraft = null;
                    _prodPersistCreateDraft();
                    _prodClearLayer();
                    _prodToast(PROD_CREATE_CLOSED_TEXT);
                    return false;
                }
                if (!error || !Number(error.status) || Number(error.status) >= 500) {
                    draft.ambiguous = true;
                } else if (code === 'idempotency_conflict') {
                    // A deterministic Linear conflict can arrive only after
                    // the native row exists. Never mint a second create from
                    // that receipt: open the exact saved row for explicit
                    // repair. An unclassified conflict remains exact-retry
                    // locked until the gateway can prove its native receipt.
                    draft.ambiguous = true;
                    if (error.nativeCommitted && error.row && error.row.id) {
                        const createdId = String(error.row.id);
                        _prodState.createDraft = null;
                        _prodPersistCreateDraft();
                        _prodClearLayer();
                        await _prodLoadData({ silent: true });
                        if (_prodIssue(createdId)) _prodOpenDeliverable(createdId);
                        _prodToast('Issue saved in Production · Linear ID conflict opened for repair');
                        return false;
                    }
                }
                _prodState.createError = _prodCreateErrorText(error);
                _prodState.createSubmitting = false;
                _prodPersistCreateDraft();
                _prodRenderCreateModal();
                return false;
            }
        }
        function _prodWritePending(id, operation) {
            return _prodState.writes.has(String(id || '') + ':' + String(operation || ''));
        }
        function _prodApplyGatewayRow(row) {
            if (!row || !row.id) return;
            const target = (_prodState.deliverables || []).find(item => String(item && item.id || '') === String(row.id));
            if (target) {
                ['status', 'status_at', 'due_date', 'title', 'assignee_id', 'brief', 'file_url', 'sync_state', 'updated_at',
                    'linear_raw', 'identity_repair_state', 'identity_repair_reason'].forEach(field => {
                    if (Object.prototype.hasOwnProperty.call(row, field)) target[field] = row[field];
                });
                _prodState.adapter = null;
            }
            // A native gateway receipt is also the authoritative local Workload
            // projection for any currently-visible issue. Its deliverable cursor
            // stays separate from workload_issues.synced_at and the authority
            // fingerprint, so no inactive fast bridge is required to converge.
            // (Only a loaded Workload has a projection to update.)
            const wlArea = svAreaApi('workload');
            if (wlArea) wlArea.adoptNativeDueGatewayRow(row);
        }
        /* The gateway's asset guidance is public-safe and provider-neutral,
           which makes it vague at exactly the moment a designer needs a next
           step. Translate the machine state into the action instead -- the
           same pattern _syncviewShareLinkErrorMessage already uses for share
           links.

           The case that matters is `expired`. Google returns the SAME 404 for
           a Drive file that was deleted and for one that exists but was never
           shared, so the literal reading ("replace the expired asset") sends
           someone hunting for a replacement when the fix is usually one
           sharing toggle. Name both, cheapest check first.

           Reported 2026-08-19: a designer pasted a real, finished thumbnail
           and got only "could not be verified", with nothing to act on. */
        function _prodAssetStateText(state, guidance) {
            switch (String(state || '')) {
                /* PROVIDER-NEUTRAL FIRST, with the specifics kept.
                   These three sentences named Drive and only Drive, on a probe
                   that is entirely host-agnostic: probeAssetUrl classifies by
                   HTTP status and body, and the allowlist has carried frame.io,
                   next.frame.io, f.io, dropbox.com and Linear uploads alongside
                   Drive since long before this copy was written. Now that
                   attach is open to video, the readers most likely to see these
                   are editors shipping Frame.io review links, being told to
                   open a Drive menu that does not exist for them.
                   The Drive steps are NOT deleted. The 2026-08-19 report that
                   created this function was a designer who got "could not be
                   verified" with nothing to act on, and the concrete Drive path
                   is what fixed that for her -- it just stops being the only
                   path named. */
                case 'permission_denied':
                    return 'That link is not shared with the review team. Open its sharing settings and give the team access — on Drive that is Share → General access → "Anyone with the link"; on Frame.io or Dropbox, a public review/share link. Then use Refresh access.';
                case 'expired':
                    return 'That link does not open. Most providers report the same "not found" whether the file was deleted OR simply never shared — so check sharing first (on Drive, Share → "Anyone with the link"), then Refresh access. If the file really was removed, attach the current one.';
                case 'unavailable':
                    return 'We could not open that link from the server. The usual cause is sharing: make it viewable by anyone with the link — Share → "Anyone with the link" on Drive, a public review link on Frame.io — then Refresh access. If it is already shared, retry: the access check gives up after 8 seconds.';
            }
            // `missing` and `invalid` already carry specific, actionable
            // gateway copy; anything unknown keeps whatever the gateway said.
            return String(guidance || 'The canonical deliverable could not be verified. Check access or attach a different link.');
        }
        function _prodWriteErrorText(error, issue, operation) {
            const code = String(error && error.code || '');
            if (code === 'write_conflict') return 'This issue changed elsewhere. Current values were reloaded; try again.';
            if (code === 'identity_repair_required') {
                return _prodIdentityRepairGateText(issue)
                    || 'Linear identity repair is required. This saved issue stays read-only.';
            }
            if (code === 'team_is_linear_authoritative' || code === 'legacy_parity_not_allowed') return _prodWriteGateText(issue, operation) || 'This team is read-only right now.';
            if (code === 'artifact_not_resolvable') {
                return _prodAssetStateText(error && error.assetState, error && error.guidance);
            }
            /* This sentence used to refuse folders and never mention Frame.io,
               which is backwards on both counts and is the shape the team
               actually ships. The owner ruling of 2026-08-16 widened the slot
               to accept a folder as well as a file, and the policy has said so
               ever since (assetTypeAllowed, deliverable_file -> file OR
               folder); Frame.io links resolve as folders and pass. What is
               genuinely refused is a Google DOC, which is a brief rather than
               the artwork, and an unsigned Linear upload, which is private to
               Linear. Copy that names the wrong rule sends people to fix a link
               that was already fine. */
            if (code === 'invalid_artifact_url') return 'Use an HTTPS link to a Drive, Dropbox or Frame.io file or folder. A Google Doc is a brief, not a deliverable, and Linear uploads are private to Linear.';
            if (code === 'artifact_card_projection_failed' || code === 'artifact_card_projection_scope_invalid') {
                return 'The deliverable was not changed because its linked card could not be updated safely.';
            }
            if (code === 'operation_forbidden' || code === 'assignee_out_of_scope') return 'Your staff role cannot perform this action.';
            if (error && (error.status === 401 || code === 'credentials_required')) return 'Your staff sign-in expired. Sign in again to write.';
            if (error && error.status === 403) return 'This write is not allowed for the selected issue.';
            /* Reported 2026-08-31 by an SMM and a video editor, an hour apart,
               both trying to set a batch folder and both getting the sentence
               below with nothing else. It was not one bug: EVERY refusal the
               batch-asset path can raise landed here, because none of them had
               a case above. So the one message the estate shows most often was
               also the one carrying the least, and no reader -- staff or the
               person they escalate to -- could tell an expired scope from a
               dead RPC from a gate that had already refused client-side. */
            if (code === 'write_gate_closed') {
                /* Client-side, so it is deliberately NOT in the shared failure
                   taxonomy below -- the gateway never sees this one. The gate
                   has already computed the real sentence for this row, and it
                   was being thrown away and replaced with "try again", which is
                   the one instruction guaranteed not to work. */
                return _prodWriteGateText(issue, operation)
                    || 'This change is not allowed on this issue.';
            }
            /* Everything else defers to the estate's OWN failure taxonomy
               (_writeUiFailureText) rather than a second table beside it.

               The first version of this fix hand-wrote sentences for
               entity_scope_unavailable, entity_lookup_unavailable and
               native_response_refresh_failed, and told the reader that
               retrying was unlikely to help for every code it did not name.
               Codex caught both halves as P2s on PR 1192 and was right twice:

                 * All three are ALREADY classified. entity_lookup_unavailable
                   and native_response_refresh_failed sit in `wait` --
                   "Transient: a dependency was unreachable and nothing was
                   committed" -- where retrying IS the recovery, so blanket
                   "retrying is unlikely to help" would have pushed staff to
                   escalate recoverable outages. entity_scope_unavailable sits
                   in `reload`, a stale-tab problem, and is raised by ordinary
                   status/comment/due writes too -- so my batch-specific "the
                   post needs its team set" would have been actively wrong for
                   a deliverable that was merely missing a client slug, sending
                   someone to repair a field that was never the cause.
                 * A second copy of a rule that can disagree with the first is
                   the exact drift this file keeps being bitten by.

               _writeUiFailureText already does the whole job: specific text,
               else class text, else it NAMES the unknown code and lets the
               HTTP status decide whether waiting is worth suggesting. Which is
               what this fix was for -- it just already existed. */
            const shared = _writeUiFailureText(operation || 'write', code, error && error.status);
            if (shared && shared.text) return shared.text;
            return 'The change was not saved. Please try again.';
        }
        async function _prodGatewayWrite(issue, operation, fields, requestId, sourceEditedAt) {
            if (!issue || !_prodCanWrite(issue, operation)) {
                const blocked = new Error('write_gate_closed');
                blocked.code = 'write_gate_closed';
                throw blocked;
            }
            const pendingKey = issue.id + ':' + operation;
            if (_prodState.writes.has(pendingKey)) return null;
            const payload = Object.assign({
                operation,
                surface: 'production',
                entity: 'deliverable',
                id: issue.id,
                client_slug: issue.authorityProject || issue.storedClientSlug || issue.project || '',
                request_id: requestId || _prodWriteRequestId(operation),
                source_edited_at: sourceEditedAt || new Date().toISOString()
            }, fields || {});
            if (operation === 'batch_asset' || operation === 'batch_description') {
                /* The target is the BATCH, not the deliverable whose panel is
                   open. Every sub-issue of a post shows the same two folder
                   links because they are one row, so the write names that row
                   and its clock -- reusing the updated_at of the deliverable
                   here would compare a value against a timestamp from a
                   different table and fail its CAS forever.
                   batch_description rides the same retarget for the same
                   reason: the text is on the batch row, so the CAS has to be
                   against the batch clock. */
                payload.entity = 'batch';
                payload.id = String(issue.batchId || '');
                let batchClock = '';
                if (operation === 'batch_asset') {
                    const writeSlot = String(fields && fields.slot || '');
                    /* THE ROW THIS SLOT LIVES ON, NOT THIS DELIVERABLE'S
                       (2026-09-05). The two folder links belong to the post,
                       and 44 of 1,138 measured posts spread their rows over
                       more than one batch row -- so writing the open row's own
                       batch is how a link typed on the parent stayed invisible
                       to all 32 sub-issues. The read names a target PER SLOT,
                       because a post's slots can sit on different rows: aiming
                       a whole panel at one row would point the Frame folder
                       editor at a row whose column is empty, so clearing the
                       link on screen would write a blank over a blank and the
                       value would reappear. Editing a value where it already
                       is means the edit lands where every seat reads it,
                       instead of forking a second copy onto whichever row the
                       editor happened to open.
                       The CAS clock moves with the target: comparing this row's
                       updated_at against another row's fails its CAS forever,
                       the same trap batch_description was retargeted to avoid.
                       Both come from the same read, so they cannot disagree.
                       No target means an older gateway, an unread panel, or a
                       gateway that could not establish which bucket belongs to
                       this post alone -- all three fall back to the open row's
                       own batch, exactly what shipped before 2026-09-05.
                       THAT FALLBACK IS NOT A SAFE DEFAULT, it is the status quo
                       one: if the reader is sitting on a bucket shared with
                       another post, the write reaches that post too. It is left
                       permissive deliberately. AGENTS.md's standing owner
                       directive (2026-08-27, "I prefer things to be not strict
                       than strict") says the browser must not encode a guess
                       about state it cannot see as a refusal -- and a refusal
                       here would be a dead end on a save that has always
                       worked, to avert a case the gateway's own measurements
                       put out of reach. Raised by Codex on #1294; the finding
                       is right about the mechanism and the remedy belongs to
                       the owner, not to this line. */
                    const assetState = _prodState.assets.get(String(issue.id));
                    const evidence = assetState && assetState.assets
                        && assetState.assets[writeSlot] || null;
                    const target = String(evidence && evidence.writeBatchId || '').trim();
                    if (target) {
                        payload.id = target;
                        batchClock = String(evidence.writeBatchUpdatedAt || '').trim();
                    }
                }
                const batch = _prodBatch(payload.id);
                payload.expected_updated_at = batchClock
                    || (batch ? String(batch.updated_at || '') : '');
            } else if (operation !== 'comment') {
                payload.expected_updated_at = issue.updatedRaw;
                if (operation === 'status') payload.expected_status = issue.sourceStatus;
            }
            const previousDueDate = issue.dueRaw ? String(issue.dueRaw).slice(0, 10) : null;
            _prodState.writes.set(pendingKey, payload.request_id);
            _prodRender();
            try {
                const response = await fetch(PROD_WRITE_EF_URL, {
                    method: 'POST',
                    cache: 'no-store',
                    headers: _syncviewEfHeaders({
                        apikey: CAL_SUPABASE_ANON_KEY,
                        Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY,
                        Accept: 'application/json',
                        'Content-Type': 'application/json'
                    }, PROD_WRITE_EF_URL),
                    body: JSON.stringify(payload)
                });
                const json = await response.json().catch(() => ({}));
                if (json && json.row) _prodApplyGatewayRow(json.row);
                if (!response.ok || !json || json.ok !== true || json.native_committed !== true) {
                    const error = new Error(String(json && json.error || 'write_failed'));
                    error.status = response.status;
                    error.code = String(json && json.error || 'write_failed');
                    error.row = json && json.row || null;
                    /* A batch write answers with `batch`, never `row`. A
                       write_conflict on one therefore carried nothing the
                       caller could adopt, so the loser restored its own stale
                       text AND stale clock and every retry conflicted again
                       against the same obsolete timestamp. Raised by review on
                       #1203. */
                    error.batch = json && json.batch || null;
                    error.batchDescription = json && typeof json.description === 'string'
                        ? json.description
                        : null;
                    error.assetState = String(json && json.asset_state || '');
                    error.guidance = String(json && json.guidance || '');
                    if (error.code === 'team_is_linear_authoritative' || error.code === 'legacy_parity_not_allowed') {
                        _prodRefreshAuthority({ silent: true });
                    }
                    throw error;
                }
                const rowHasDueDate = !!json.row
                    && Object.prototype.hasOwnProperty.call(json.row, 'due_date');
                const committedDueDate = rowHasDueDate && json.row.due_date
                    ? String(json.row.due_date).slice(0, 10)
                    : null;
                if (rowHasDueDate && (operation === 'due' || committedDueDate !== previousDueDate)) {
                    // The receipt tells Workload boards in OTHER tabs to refetch,
                    // so it goes out even when this tab has not loaded Workload.
                    const receiptRow = json.row;
                    svArea('workload').then(wl => wl.publishNativeDueReceipt(receiptRow), () => {});
                }
                return json;
            } finally {
                _prodState.writes.delete(pendingKey);
                if (document.getElementById('prodRoot')) _prodRender();
            }
        }
        /* Does this row still hold exactly what we optimistically wrote?
         *
         * A 409 write_conflict carries the authoritative row and
         * _prodGatewayWrite applies it through _prodApplyGatewayRow BEFORE it
         * throws, so on a conflict the row already holds the SERVER's values.
         * Rolling back then discards the reload the toast is simultaneously
         * telling the reader about, and leaves the OLD local status attached to
         * the SERVER's updated_at -- a pair that fails its own CAS forever, so
         * the retry the toast asks for can never succeed. Anything that no
         * longer matches our patch is owned by something newer than us.
         */
        function _prodOptimisticStillOurs(entry) {
            if (!entry || !entry.row || !entry.patch) return false;
            /* Comparing the PATCHED FIELDS alone is not enough, and the case it
             * misses is not exotic: another tab (or the same person on their
             * phone) sets the SAME status, our write conflicts, and the 409
             * carries an authoritative row whose status equals what we
             * optimistically painted. Field-only, that reads as "untouched, roll
             * it back" -- so the old value goes back on while the row keeps the
             * SERVER's updated_at, and that pair fails its own CAS on every
             * retry. The toast says "try again" and trying again can never work.
             *
             * `updated_at` is the discriminator that cannot coincide.
             * `_prodApplyGatewayRow` mutates THIS row object and copies
             * updated_at across, and a conflict exists precisely because the
             * server's version differed from ours -- so if the server spoke, the
             * version moved, whatever it said about the field. */
            if (String(entry.row.updated_at == null ? '' : entry.row.updated_at)
                !== String(entry.beforeUpdatedAt == null ? '' : entry.beforeUpdatedAt)) return false;
            return Object.keys(entry.patch).every(field =>
                String(entry.row[field] == null ? '' : entry.row[field])
                    === String(entry.patch[field] == null ? '' : entry.patch[field]));
        }
        async function _prodRunPickerWrite(kind, ids, value) {
            const operation = kind === 'assign' ? 'assignee' : kind;
            const issues = (ids || []).map(_prodIssue).filter(Boolean);
            if (!issues.length) return;
            if (kind === 'status' && value === 'smm') {
                const blockedArtifact = issues.map(_prodSmmArtifactGate).find(gate => !gate.ok);
                if (blockedArtifact) {
                    _prodToast(blockedArtifact.guidance);
                    _prodEnsureAssets(blockedArtifact.issue.id, true);
                    return;
                }
            }
            if (kind === 'assign' && new Set(issues.map(issue => _prodWriteTeam(issue.team))).size > 1) {
                _prodToast('Choose issues from one team before assigning.');
                return;
            }
            const blocked = issues.find(issue => !_prodCanWrite(issue, operation));
            if (blocked) {
                _prodToast(_prodWriteGateText(blocked, operation));
                return;
            }
            let completed = 0;
            const fieldsFor = () => (kind === 'status'
                ? { status: PROD_STATUS_FROM_ARTIFACT[value] || value }
                : kind === 'assign'
                    ? { assignee_id: value === '_' ? '' : value }
                    : { due_date: value || '' });
            /* Paint first, then persist.
             *
             * This loop is deliberately SEQUENTIAL -- the catch below names the
             * failing issue by how many completed, which is the difference
             * between "3 of 15 failed, here they are" and one vague toast. But
             * nothing used to move on screen until a write came back, so even a
             * single sub-issue sat unchanged for a full gateway round-trip, and
             * fifteen sat for fifteen of them in series. Owner report
             * 2026-08-25: "it takes quite a lot of time to change. It should be,
             * like, immediate."
             *
             * So the rows take the new value locally up front and the writes
             * confirm it. `_prodGatewayWrite` still applies the authoritative
             * row on success (_prodApplyGatewayRow), so a server value that
             * differs from the optimistic one still wins. Only rows that were
             * never written are rolled back -- rolling back a completed one
             * would discard a receipt that already landed.
             */
            const optimistic = issues.map(issue => {
                const row = (_prodState.deliverables || [])
                    .find(item => String(item && item.id || '') === String(issue.id));
                if (!row) return null;
                const patch = fieldsFor();
                const before = {};
                Object.keys(patch).forEach(field => { before[field] = row[field]; });
                // The row's version BEFORE the optimistic paint. `patch` never
                // contains updated_at (see fieldsFor), so this is untouched by
                // the Object.assign below and only the server can move it.
                const beforeUpdatedAt = row.updated_at;
                Object.assign(row, patch);
                return { row, before, patch, beforeUpdatedAt };
            });
            if (optimistic.some(Boolean)) {
                _prodState.adapter = null;
                _prodRender();
            }
            try {
                for (const issue of issues) {
                    await _prodGatewayWrite(issue, operation, fieldsFor());
                    completed++;
                }
                _prodToast(completed > 1 ? completed + ' issues updated' : (kind === 'status' ? 'Status updated' : kind === 'assign' ? 'Assignee updated' : 'Due date updated'));
            } catch (error) {
                // OPEN_REPAIRS 101: leave a server record of the refusal (no UI).
                _writeUiRecordFailure('production', kind, error, { id: String(issues[completed] && issues[completed].id || '') });
                let rolledBack = false;
                optimistic.slice(completed).forEach(entry => {
                    if (!entry) return;
                    /* Only roll back a row that still holds exactly what we
                     * optimistically wrote.
                     *
                     * A 409 write_conflict carries the authoritative row, and
                     * _prodGatewayWrite applies it through _prodApplyGatewayRow
                     * BEFORE it throws. Rolling that back would discard the
                     * reload the toast is simultaneously telling the reader
                     * about, and leave the OLD local status sitting on the
                     * SERVER's updated_at -- a pair that then fails its own CAS
                     * forever, so the retry the toast asks for can never
                     * succeed. If the field no longer matches our patch,
                     * something newer than us owns it; leave it alone. */
                    if (!_prodOptimisticStillOurs(entry)) return;
                    Object.assign(entry.row, entry.before);
                    rolledBack = true;
                });
                if (rolledBack) {
                    _prodState.adapter = null;
                    _prodRender();
                }
                const current = issues[Math.min(completed, issues.length - 1)];
                _prodToast(_prodWriteErrorText(error, current, operation));
            }
        }
        function _prodLabelColorStyle(label) {
            return label && /^#[0-9a-f]{6}$/i.test(String(label.color || ''))
                ? ' style="--prod-label-color:' + _calEscAttr(label.color) + '"'
                : '';
        }
        function _prodLabelChipHTML(label) {
            if (!label) return '';
            const tip = label.description || label.name;
            return '<span class="prod-label-chip"' + _prodLabelColorStyle(label)
                + ' title="' + _calEscAttr(tip) + '" data-prod-tip="' + _calEscAttr(tip) + '">'
                + '<span class="prod-label-dot"></span><span>' + _calEsc(label.name) + '</span></span>';
        }
        function _prodLabelsButtonHTML(issue) {
            const state = _prodLabelState(issue && issue.id);
            let content = '<span class="prod-label-muted">Loading labels…</span>';
            let info = 'Loading labels';
            if (state && state.status === 'error') {
                content = '<span class="prod-label-muted">Labels unavailable</span>';
                info = state.error || 'Labels unavailable';
            } else if (state && state.structural === true) {
                /* Ready, empty, and NOT an invitation. "Add labels" on a batch
                   parent would be the third promise this panel made that the
                   gateway cannot keep. */
                content = '<span class="prod-label-muted">No labels</span>';
                info = "This is the post's batch parent — open its sub-issues to work on it.";
            } else if (state && state.status === 'ready') {
                content = state.selected.length
                    ? state.selected.map(_prodLabelChipHTML).join('')
                    : '<span class="prod-label-muted">Add labels</span>';
                info = state.selected.length ? 'Labels: ' + state.selected.map(label => label.name).join(', ') : 'No labels selected';
            }
            if (state && state.saving) {
                content += '<span class="prod-write-state">Saving…</span>';
                info += '|Saving labels';
            } else if (state && state.writeError) {
                info += '|' + state.writeError;
            } else if (!_prodCanWrite(issue, 'labels')) {
                const gate = _prodWriteGateText(issue, 'labels');
                if (gate) info += '|' + gate;
            } else {
                info += '|Change labels';
            }
            return '<button type="button" class="prod-prop-btn prod-labels-btn" data-prod-prop="labels" data-prod-labels="'
                + _calEscAttr(issue && issue.id || '') + '" data-prod-write="' + (_prodCanWrite(issue, 'labels') ? 'on' : 'off')
                + '" aria-label="Labels" title="' + _calEscAttr(info.replace('|', ' · ')) + '" data-prod-tip="' + _calEscAttr(info)
                + '" onclick="return _prodOpenLabels(event,' + _jsAttrArg(issue && issue.id || '') + ')">' + content + '</button>';
        }
        function _prodLabelsPopHTML(id) {
            const issue = _prodIssue(id);
            const state = _prodLabelState(id);
            if (!state || state.status === 'loading') {
                return '<div class="prod-label-state" data-prod-label-state="loading">Loading the Linear label catalog…</div>';
            }
            if (state.structural === true) {
                /* No Retry here. A Retry is an offer to try again, and this one
                   could never have succeeded: the parent has no deliverable row
                   and no Linear issue, so the read is 404 by construction and
                   not by circumstance. */
                return '<div class="prod-label-state" data-prod-label-state="structural">'
                    + _calEsc("A batch parent has no Linear issue of its own, so it carries no labels. Open a sub-issue to label the work.")
                    + '</div>';
            }
            if (state.status === 'error') {
                return '<div class="prod-label-state is-error" data-prod-label-state="error">' + _calEsc(state.error)
                    + '<br><button class="prod-label-retry" type="button" data-prod-label-retry>Retry</button></div>';
            }
            const writable = !!(issue && _prodCanWrite(issue, 'labels'));
            const selected = new Set(state.selectedIds || []);
            const rows = (state.catalog || []).map((label, index) => {
                const checked = selected.has(label.id);
                const tip = label.description || label.name;
                return '<button type="button" class="prod-label-option" data-prod-label-option="' + index + '" data-prod-label-search="'
                    + _calEscAttr((label.name + ' ' + label.description).toLowerCase()) + '" aria-disabled="' + (writable && !state.saving ? 'false' : 'true')
                    + '" title="' + _calEscAttr(tip) + '" data-prod-tip="' + _calEscAttr(tip) + '">'
                    + '<span class="prod-label-check" role="checkbox" aria-checked="' + (checked ? 'true' : 'false') + '"></span>'
                    + '<span class="prod-label-dot"' + _prodLabelColorStyle(label) + '></span>'
                    + '<span class="prod-label-option-copy"><span class="prod-label-option-name">' + _calEsc(label.name) + '</span>'
                    + (label.description ? '<span class="prod-label-option-desc">' + _calEsc(label.description) + '</span>' : '')
                    + '</span></button>';
            }).join('');
            const empty = '<div class="prod-label-state" data-prod-label-state="empty">No labels are available in the Linear catalog.</div>';
            const gate = writable ? '' : _prodWriteGateText(issue, 'labels');
            return '<div class="prod-pop-search"><input data-prod-label-search-input placeholder="Search labels…" aria-label="Search labels"></div>'
                + '<div class="prod-pop-list" data-prod-label-list>' + (rows || empty) + '</div>'
                + (state.saving ? '<div class="prod-label-lock">Saving the complete selected label set…</div>'
                    : gate ? '<div class="prod-label-lock">' + _calEsc(gate) + '</div>' : '');
        }
        function _prodWireLabelsPop(pop, id) {
            if (!pop) return;
            const retry = pop.querySelector('[data-prod-label-retry]');
            if (retry) retry.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                _prodEnsureLabels(id, true);
            });
            const input = pop.querySelector('[data-prod-label-search-input]');
            if (input) {
                input.addEventListener('input', () => {
                    const query = String(input.value || '').trim().toLowerCase();
                    let shown = 0;
                    pop.querySelectorAll('[data-prod-label-option]').forEach(row => {
                        const match = !query || String(row.getAttribute('data-prod-label-search') || '').includes(query);
                        row.style.display = match ? '' : 'none';
                        if (match) shown++;
                    });
                    _prodPickerEmptyState(pop, shown);
                });
                input.addEventListener('keydown', event => {
                    event.stopPropagation();
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        _prodClearLayer();
                    }
                });
                setTimeout(() => { try { input.focus(); } catch (e) {} }, 0);
            }
            pop.querySelectorAll('[data-prod-label-option]').forEach(row => row.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                const state = _prodLabelState(id);
                const issue = _prodIssue(id);
                if (!state || state.status !== 'ready' || state.saving || !issue || !_prodCanWrite(issue, 'labels')) {
                    if (issue && !_prodCanWrite(issue, 'labels')) _prodToast(_prodWriteGateText(issue, 'labels'));
                    return;
                }
                const label = state.catalog[Number(row.getAttribute('data-prod-label-option'))];
                if (!label) return;
                const next = new Set(state.selectedIds || []);
                if (next.has(label.id)) next.delete(label.id);
                else next.add(label.id);
                _prodRunLabelsWrite(id, [...next]);
            }));
        }
        async function _prodRunLabelsWrite(id, labelIds) {
            const issue = _prodIssue(id);
            const state = _prodLabelState(id);
            if (!issue || !state || state.status !== 'ready' || state.saving) return;
            if (_prodState.writes.has(String(id || '') + ':labels')) return;
            if (!_prodCanWrite(issue, 'labels')) {
                _prodToast(_prodWriteGateText(issue, 'labels'));
                return;
            }
            const staffIdentity = _syncviewStaffIdentityForHeaders();
            if (!staffIdentity) return;
            const verificationEpoch = _syncviewStaffVerificationEpoch;
            const identitySignature = _syncviewStaffIdentitySignature(staffIdentity);
            const requestToken = _prodNextLabelRequestToken(id);
            const identityStillCurrent = () => verificationEpoch === _syncviewStaffVerificationEpoch
                && identitySignature === _syncviewStaffIdentitySignature(_syncviewStaffIdentityForHeaders());
            const requestStillCurrent = () => identityStillCurrent()
                && requestToken === _prodState.labelRequestTokens.get(String(id || ''));
            state.saving = true;
            state.writeError = '';
            _prodRefreshLabelSurfaces(id);
            try {
                const json = await _prodGatewayWrite(issue, 'labels', { label_ids: labelIds,
                    ...(state.catalogVersion ? { catalog_version: state.catalogVersion } : {}) });
                if (!json) {
                    if (!identityStillCurrent()) return;
                    const current = _prodLabelState(id) || state;
                    current.saving = false;
                    _prodState.labels.set(String(id), current);
                    _prodRefreshLabelSurfaces(id);
                    _prodEnsureLabels(id, true);
                    return;
                }
                if (!requestStillCurrent()) {
                    // A newer read may have observed the pre-commit selection.
                    // Re-read only after this guarded write has completed so
                    // the latest request converges on the committed labels.
                    if (identityStillCurrent()) _prodEnsureLabels(id, true);
                    return;
                }
                _prodAdoptLabelPayload(id, json, state.catalog);
                _prodToast('Labels updated');
                _prodRefreshLabelSurfaces(id);
            } catch (error) {
                _writeUiRecordFailure('production', 'labels', error, { id: String(id) });
                if (!requestStillCurrent()) {
                    if (identityStillCurrent()) _prodEnsureLabels(id, true);
                    return;
                }
                const current = _prodLabelState(id) || state;
                current.saving = false;
                current.writeError = _prodWriteErrorText(error, issue, 'labels');
                _prodState.labels.set(String(id), current);
                _prodToast(current.writeError);
                _prodRefreshLabelSurfaces(id);
                _prodEnsureLabels(id, true);
            }
        }
        function _prodOpenLabels(event, id) {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            const x = event ? event.clientX : innerWidth / 2;
            const y = event ? event.clientY : 160;
            const pop = _prodLayerPop('', x, y);
            pop.classList.add('prod-label-pop');
            pop.setAttribute('data-prod-label-pop', String(id || ''));
            pop.innerHTML = _prodLabelsPopHTML(id);
            _prodPlacePop(pop, x, y);
            _prodWireLabelsPop(pop, id);
            _prodEnsureLabels(id, false);
            return false;
        }
        function _prodDueIso(value) {
            if (!value) return '';
            if (value instanceof Date) return _prodIsoFromDate(value);
            return _prodParseDue(value) || '';
        }
        function _prodCommentDraftAudience(id, audience) {
            const draft = _prodCommentDraftFor(id);
            audience = audience === 'client' ? 'client' : 'internal';
            if (draft.audience !== audience) draft.requestId = '';
            draft.audience = audience;
        }
        function _prodComposerKeydown(event, id) {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                const form = event.currentTarget && event.currentTarget.form;
                if (form && form.requestSubmit) form.requestSubmit();
                else _prodSubmitComment(event, id);
            }
        }
        // F43 canonical-thread composer. The Phase-2 top-level-only copies of
        // these four functions were removed (C3 step 1): a later declaration
        // already replaced them everywhere, and an ES module refuses duplicates.
        function _prodCommentDraftFor(id) {
            id = String(id || '');
            if (!_prodState.commentDrafts.has(id)) _prodState.commentDrafts.set(id, {
                body: '', audience: 'internal', requestId: '', action: 'add',
                commentId: '', parentId: '', expectedVersion: null,
                expectedUpdatedAt: '', error: '', lifecycleKey: '',
                lifecycleRequestId: '', currentBody: '', rebased: false
            });
            return _prodState.commentDrafts.get(id);
        }
        function _prodCommentDraftInput(id, body) {
            const draft = _prodCommentDraftFor(id);
            body = String(body || '');
            if (draft.body !== body) draft.requestId = '';
            draft.body = body;
            draft.error = '';
        }
        function _prodCommentBegin(id, action, commentId) {
            const draft = _prodCommentDraftFor(id);
            const comment = _prodComments.find(id, commentId);
            action = action === 'edit' ? 'edit' : 'add';
            draft.action = action;
            draft.commentId = action === 'edit' && comment ? comment.id : '';
            draft.parentId = action === 'add' && comment ? (comment.parent_id || comment.id) : '';
            draft.body = action === 'edit' && comment ? comment.body : '';
            draft.audience = comment ? comment.audience : 'internal';
            draft.expectedVersion = comment ? comment.version : null;
            draft.expectedUpdatedAt = comment ? comment.row_updated_at : '';
            draft.currentBody = comment ? comment.body : '';
            draft.rebased = false;
            draft.requestId = '';
            draft.error = '';
            _prodRender();
            setTimeout(() => {
                const form = document.querySelector('[data-prod-comment-form="' + CSS.escape(String(id || '')) + '"]');
                const input = form && form.querySelector('[data-prod-comment-input]');
                if (input) input.focus();
            }, 0);
            return false;
        }
        function _prodCommentCancel(id) {
            _prodState.commentDrafts.delete(String(id || ''));
            _prodRender();
            return false;
        }
        async function _prodRebaseCommentEditDraft(id, draft, error) {
            if (!draft || draft.action !== 'edit' || Number(error && error.status) !== 409) return false;
            const commentId = String(draft.commentId || '');
            await _prodComments.readCanonical(id);
            if (_prodState.commentDrafts.get(String(id || '')) !== draft
                || draft.action !== 'edit'
                || String(draft.commentId || '') !== commentId) return false;
            const refreshed = _prodComments.find(id, commentId);
            if (!refreshed
                || !Number.isInteger(Number(refreshed.version))
                || !String(refreshed.row_updated_at || '').trim()) {
                draft.error = 'The current comment could not be reloaded. Your draft is preserved; refresh before retrying.';
                return false;
            }
            draft.expectedVersion = Number(refreshed.version);
            draft.expectedUpdatedAt = String(refreshed.row_updated_at).trim();
            draft.currentBody = String(refreshed.body || '');
            draft.rebased = true;
            // The retained draft now targets a different canonical CAS
            // snapshot, so it must own a fresh idempotency identity.
            draft.requestId = '';
            draft.lifecycleRequestId = '';
            draft.error = 'A newer version was loaded. Your draft is preserved; retry applies it to the current comment.';
            return true;
        }
        function _prodComposerHTML(issue) {
            const writable = _prodCanWrite(issue, 'comment');
            const gate = _prodWriteGateText(issue, 'comment');
            if (!writable) {
                return '<div class="prod-composer"><span>' + _prodAvatar(null, 18) + '</span><button class="prod-composer-box" type="button" data-prod-disabled="composer" onclick="_prodToast(' + _jsAttrArg(gate) + ');return false" title="' + _calEscAttr(gate) + '" data-prod-tip="' + _calEscAttr(gate) + '">' + _calEsc(gate) + '</button></div>';
            }
            const draft = _prodCommentDraftFor(issue.id);
            const pending = _prodWritePending(issue.id, 'comment');
            const context = draft.action === 'edit' ? 'Editing comment' : draft.parentId ? 'Replying to thread' : '';
            const canOfferClient = _prodIssueClientCommentSurfaceKnown(issue);
            if (!canOfferClient && draft.audience === 'client') draft.audience = 'internal';
            const visibility = canOfferClient
                ? '<button class="prod-comment-action" type="button" onclick="_prodCommentDraftAudience(' + _jsAttrArg(issue.id) + ',' + _jsAttrArg(draft.audience === 'client' ? 'internal' : 'client') + ');_prodRender()">' + (draft.audience === 'client' ? 'Client-visible' : 'Internal') + '</button>'
                : '<span class="prod-write-state" data-prod-client-visible-disabled="1" title="Client-visible is available only for an exact Samples Review card linked to this canonical deliverable">Internal</span>';
            return '<div class="prod-composer"><span>' + _prodAvatar(null, 18) + '</span><form class="prod-composer-form" data-prod-comment-form="' + _calEscAttr(issue.id) + '" onsubmit="return _prodSubmitComment(event,' + _jsAttrArg(issue.id) + ')">'
                + (context ? '<div class="prod-composer-actions"><b class="prod-write-state">' + _calEsc(context) + '</b><span class="prod-spacer"></span><button class="prod-comment-action" type="button" onclick="_prodCommentCancel(' + _jsAttrArg(issue.id) + ')">Cancel</button></div>' : '')
                + '<textarea class="prod-composer-input" data-prod-comment-input="1" maxlength="20000" placeholder="' + (draft.parentId ? 'Write a reply...' : draft.action === 'edit' ? 'Edit comment...' : 'Write a comment...') + '" oninput="_prodCommentDraftInput(' + _jsAttrArg(issue.id) + ',this.value)" onkeydown="_prodComposerKeydown(event,' + _jsAttrArg(issue.id) + ')"' + (pending ? ' disabled' : '') + '>' + _calEsc(draft.body) + '</textarea>'
                + '<div class="prod-composer-actions">' + (draft.action === 'add' && !draft.parentId ? visibility : '') + '<span class="prod-spacer"></span>'
                + (draft.error ? '<span class="prod-write-state is-error" role="alert">' + _calEsc(draft.error) + '</span>' : pending ? '<span class="prod-write-state" role="status">Saving...</span>' : '<span class="prod-write-state">Ctrl/Cmd Enter</span>')
                + '<button class="prod-composer-submit" type="submit"' + (pending ? ' disabled' : '') + '>' + (pending ? 'Saving...' : draft.action === 'edit' ? 'Save edit' : draft.parentId ? 'Reply' : 'Comment') + '</button></div></form></div>';
        }
        function _prodSubmitComment(event, id) {
            if (event) event.preventDefault();
            const issue = _prodIssue(id);
            const form = event && event.currentTarget && event.currentTarget.tagName === 'FORM'
                ? event.currentTarget
                : document.querySelector('[data-prod-comment-form="' + CSS.escape(String(id || '')) + '"]');
            const input = form && form.querySelector('[data-prod-comment-input]');
            const draft = _prodCommentDraftFor(id);
            if (input) _prodCommentDraftInput(id, input.value);
            if (!String(draft.body || '').trim()) {
                draft.error = 'Write a comment first.';
                _prodRender();
                return false;
            }
            if (!draft.requestId) draft.requestId = _prodWriteRequestId('comment');
            const comment = {
                action: draft.action || 'add',
                body: String(draft.body).trim(),
                audience: draft.audience
            };
            if (draft.parentId) comment.parent_id = draft.parentId;
            if (draft.action === 'edit') {
                comment.id = draft.commentId;
                comment.expected_version = draft.expectedVersion;
                comment.expected_updated_at = draft.expectedUpdatedAt;
            }
            draft.error = '';
            _prodGatewayWrite(issue, 'comment', { comment }, draft.requestId).then(result => {
                if (!result) return;
                const finishedAction = draft.action;
                const wasReply = !!draft.parentId;
                _prodState.commentDrafts.delete(String(id));
                _prodComments.adopt(id, result.comment);
                _prodComments.refresh(id);
                _prodToast(finishedAction === 'edit' ? 'Comment updated' : wasReply ? 'Reply added' : 'Comment added');
            }).catch(async error => {
                _writeUiRecordFailure('production', 'comment', error, { id: String(id) });
                draft.error = _prodWriteErrorText(error, issue, 'comment');
                if (error && error.status === 409) {
                    if (draft.action === 'edit') {
                        try {
                            await _prodRebaseCommentEditDraft(id, draft, error);
                        } catch (refreshError) {
                            draft.error = 'A newer version exists, but it could not be loaded. Your draft is preserved; refresh before retrying.';
                        }
                    } else {
                        _prodComments.refresh(id);
                    }
                }
                _prodRender();
            });
            return false;
        }
        function _prodCommentLifecycle(id, commentId, action) {
            const issue = _prodIssue(id);
            const comment = _prodComments.find(id, commentId);
            if (!issue || !comment) return false;
            const state = _prodCommentDraftFor(id);
            const key = [action, comment.id, comment.version, comment.row_updated_at].join(':');
            if (state.lifecycleKey !== key) {
                state.lifecycleKey = key;
                state.lifecycleRequestId = _prodWriteRequestId('comment-' + action);
            }
            state.error = '';
            _prodGatewayWrite(issue, 'comment', {
                comment: {
                    action,
                    id: comment.id,
                    expected_version: comment.version,
                    expected_updated_at: comment.row_updated_at
                }
            }, state.lifecycleRequestId).then(result => {
                state.lifecycleKey = '';
                state.lifecycleRequestId = '';
                _prodComments.adopt(id, result && result.comment);
                _prodComments.refresh(id);
            }).catch(error => {
                _writeUiRecordFailure('production', 'comment_lifecycle', error, { id: String(id) });
                state.error = _prodWriteErrorText(error, issue, 'comment');
                _prodComments.refresh(id);
                _prodRender();
            });
            return false;
        }
        function _prodClearBoardDropFx() {
            document.querySelectorAll('.prod-col-drop').forEach(el => el.classList.remove('prod-col-drop'));
            document.querySelectorAll('.prod-card-dragging, .pcard-dragging').forEach(el => el.classList.remove('prod-card-dragging', 'pcard-dragging'));
            _prodState.dragProject = '';
        }
        function _prodBoardDragStart(e) {
            if (!_prodEnabled() || !document.getElementById('prodRoot')) return;
            const card = e.target && e.target.closest ? e.target.closest('.prod-card[data-prod-client-card]') : null;
            if (!card) return;
            const id = card.getAttribute('data-prod-client-card') || '';
            if (!_prodClient(id)) return;
            _prodState.dragProject = id;
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                try { e.dataTransfer.setData('text/plain', id); } catch (err) {}
            }
            card.classList.add('prod-card-dragging', 'pcard-dragging');
        }
        function _prodBoardDragOver(e) {
            if (!_prodEnabled() || !_prodState.dragProject) return;
            const col = e.target && e.target.closest ? e.target.closest('[data-prod-col]') : null;
            if (!col) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            const client = _prodClient(_prodState.dragProject);
            if (client && _prodBoardStatus(client.status) === col.getAttribute('data-prod-col')) {
                document.querySelectorAll('.prod-col-drop').forEach(el => el.classList.remove('prod-col-drop'));
                return;
            }
            if (!col.classList.contains('prod-col-drop')) {
                document.querySelectorAll('.prod-col-drop').forEach(el => el.classList.remove('prod-col-drop'));
                col.classList.add('prod-col-drop');
            }
        }
        function _prodBoardDrop(e) {
            if (!_prodEnabled() || !_prodState.dragProject) return;
            const col = e.target && e.target.closest ? e.target.closest('[data-prod-col]') : null;
            if (!col) return;
            e.preventDefault();
            _prodReadonlyGuard();
            _prodClearBoardDropFx();
        }
        /* `allowImages` is OFF by default, and the default is the security
           property rather than a convenience.

           This renderer is SHARED. _prodLinkify draws descriptions, live
           comment bodies (_prodCommentHTML) and archived comment bodies -- and
           comments are the one surface CLIENTS write on, through their review
           links. Rendering an image unconditionally would let a comment author
           post `![x](https://their-host/track)` and have every staff browser
           that opens the thread fetch it: a tracking pixel that reports the
           reader's IP address and the exact moment they read it.
           `referrerpolicy=no-referrer` hides which page, not who or when.

           A description is staff-authored -- the write is admin/SMM only on
           both a deliverable and a batch parent -- so it opts in. Everything
           else keeps link-only behaviour by omission, which is the direction a
           mistake should fail in. Raised by review on PR 1204. */
        function _prodLinkifyInline(s, allowImages) {
            s = _calEsc(s || '');
            const st = [];
            const keep = h => {
                st.push(h);
                return 'XMDTOK' + (st.length - 1) + 'ENDMDTOK';
            };
            const linkLabel = l => String(l || '')
                .replace(/^\*\*([^*]+)\*\*$/, '<strong>$1</strong>')
                .replace(/^__([^_]+)__$/, '<strong>$1</strong>')
                .replace(/^`([^`]+)`$/, '<code>$1</code>');
            const anchor = u => '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + '</a>';
            const namedAnchor = (l, u) => '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + linkLabel(l) + '</a>';
            const trimLinkTail = u => {
                let suffix = '';
                while (u) {
                    if (u.endsWith('**')) {
                        suffix = '**' + suffix;
                        u = u.slice(0, -2);
                    } else if (u.endsWith('*')) {
                        suffix = '*' + suffix;
                        u = u.slice(0, -1);
                    } else if (u.endsWith('&gt;')) {
                        suffix = '&gt;' + suffix;
                        u = u.slice(0, -4);
                    } else if (/[)\].,!?;]$/.test(u)) {
                        suffix = u.slice(-1) + suffix;
                        u = u.slice(0, -1);
                    } else {
                        break;
                    }
                }
                return { url: u, suffix };
            };
            s = s.replace(/`([^`]+)`/g, (m, c) => keep('<code>' + c + '</code>'));
            /* IMAGES, and they must be matched BEFORE links.
               `![alt](url)` contains `[alt](url)`, so the link rules below would
               eat the inner half and leave a stray `!` in front of an anchor --
               which is exactly what a description carrying a pasted screenshot
               rendered as, because nothing here treated it as image syntax.

               HTTPS ONLY, deliberately. Not a style rule: `javascript:` and
               `data:` in an img src are an XSS surface, and plain http would be
               blocked as mixed content anyway, so admitting either would only
               produce a broken image with a worse failure mode. Anything that
               is not https falls through to the link rules and renders as an
               ordinary link, which is the honest outcome for a URL this cannot
               display.

               `referrerpolicy=no-referrer` because the SyncView URL carries the
               client slug in its query string, and a remote image host must not
               be told which client's board is open. `loading=lazy` because a
               description with several screenshots is otherwise several
               full-size fetches on a panel the reader may never scroll. */
            /* `tabindex` and `role=link`: the image opens full size on click
               (delegated, see _prodDescriptionImageOpen), and a keyboard user
               has to be able to reach it and press Enter. No handler
               attribute on the element itself -- that is the shape the alt
               text must never be able to forge. */
            const imageTag = (alt, u) => '<img class="prod-desc-image" src="' + u + '"'
                + ' alt="' + (String(alt || '').trim() || 'Pasted image') + '"'
                + ' tabindex="0" role="link" title="Open full size"'
                + ' loading="lazy" decoding="async" referrerpolicy="no-referrer">';
            /* B2: a brief whose Linear links were rewritten carries
               `syncview-media:<occurrence id>` -- an internal reference, never
               a URL. The server projection (description_read) signs it into a
               fresh https URL before this sees it; anything still in the
               reference form here was NOT resolved (projection unavailable,
               older deploy, stale render), so it is drawn as an honest
               placeholder, never an <img> and never a link. Runs in every
               mode so comments cannot print it as a bare token either. */
            const mediaPending = (alt) => '<span class="prod-desc-media-pending" data-syncview-media-pending="1" role="img"'
                + ' aria-label="Image not loaded">Image not loaded' + (String(alt || '').trim() ? ': ' + String(alt).trim() : '') + '</span>';
            s = s.replace(/!?\[([^\]]*)\]\((?:&lt;)?syncview-media:[0-9a-f-]{36}(?:&gt;)?\)/g, (m, l) => keep(mediaPending(l)));
            s = s.replace(/syncview-media:[0-9a-f-]{36}/g, () => keep(mediaPending('')));
            if (allowImages) {
                s = s.replace(/!\[([^\]]*)\]\(&lt;(https:\/\/.*?)&gt;\)/g, (m, l, u) => keep(imageTag(l, u)));
                s = s.replace(/!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)/g, (m, l, u) => keep(imageTag(l, u)));
            }
            s = s.replace(/\[([^\]]+)\]\(&lt;(https?:\/\/.*?)&gt;\)/g, (m, l, u) => keep(namedAnchor(l, u)));
            s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, l, u) => keep(namedAnchor(l, u)));
            s = s.replace(/(https?:\/\/[^\s<]+)/g, (m, u) => {
                const out = trimLinkTail(u);
                return keep(anchor(out.url)) + out.suffix;
            });
            s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
            s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
            s = s.replace(/(^|\s)__([^_]+)__(?=\s|$|[.,!?])/g, '$1<strong>$2</strong>');
            s = s.replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,!?])/g, '$1<em>$2</em>');
            return s.replace(/XMDTOK(\d+)ENDMDTOK/g, (m, i) => st[+i]);
        }
        function _prodNormalizeMarkdownLine(line) {
            return String(line || '')
                .replace(/^\*{4}(?=\S)/, '**')
                .replace(/(\*\*[^*]+:\*\*)\s+\*\*(?=\[[^\]]+\]\(<https?:\/\/)/g, '$1 ')
                .replace(/:\s+\*\*(?=\[[^\]]+\]\(<https?:\/\/)/g, ': ');
        }
        function _prodMarkdownBlockish(line) {
            const trimmed = String(line || '').trim();
            return /^---+$/.test(trimmed) || /^#{1,4}\s+/.test(trimmed);
        }
        // PORT-DELTA: artifact linkify is namespaced and uses host escape helpers.
        function _prodLinkify(s, options) {
            const allowImages = !!(options && options.images);
            const lines = String(s || '').replace(/\r\n?/g, '\n').split('\n');
            const parts = lines.map((line, ix) => {
                line = _prodNormalizeMarkdownLine(line);
                const trimmed = line.trim();
                if (!trimmed) {
                    const prev = _prodNormalizeMarkdownLine(lines[ix - 1] || '');
                    const next = _prodNormalizeMarkdownLine(lines[ix + 1] || '');
                    if (_prodMarkdownBlockish(prev) || _prodMarkdownBlockish(next)) return null;
                    return '';
                }
                if (/^#{1,4}\s+/.test(trimmed)) {
                    return '<span class="prod-md-heading">' + _prodLinkifyInline(trimmed.replace(/^#{1,4}\s+/, ''), allowImages) + '</span>';
                }
                if (/^---+$/.test(trimmed)) return '<hr class="prod-md-rule">';
                if (/^[-*]\s+/.test(trimmed)) {
                    return '<span class="prod-md-bullet"><span class="prod-md-bullet-mark">•</span><span>' + _prodLinkifyInline(trimmed.replace(/^[-*]\s+/, ''), allowImages) + '</span></span>';
                }
                return _prodLinkifyInline(line, allowImages);
            }).filter(part => part !== null);
            /* A heading, rule or bullet is a block and already ends its line.
               Joining every part with <br> put a spare empty line after each
               of them (2026-09-06, found by laying the in-place editor over
               the read view: a bullet list was followed by two blank lines
               where the source had one). Only an inline line takes the
               break; a blank source line still yields its own. */
            const blockPart = part => /^<(span class="prod-md-(heading|bullet)"|hr class="prod-md-rule")/.test(part) || /<img [^>]*>\s*$/.test(part);
            return parts.map((part, ix) => part + (ix < parts.length - 1 && !blockPart(part) ? '<br>' : '')).join('');
        }
        function _prodCommentTruthy(value) {
            if (value === true || value === 1) return true;
            return ['true', '1', 'yes'].includes(String(value == null ? '' : value).trim().toLowerCase());
        }
        function _prodCommentNormalize(row, index) {
            row = row && typeof row === 'object' ? row : {};
            const explicitId = String(row.stable_id || row.id || row.comment_id || row.linear_comment_id || '').trim();
            const hidden = _prodCommentTruthy(row.hidden);
            const deleted = _prodCommentTruthy(row.deleted) || _prodCommentTruthy(row.is_deleted) || !!String(row.deleted_at || '').trim();
            const sourceCreatedAt = String(row.source_created_at || '').trim();
            const sourceUpdatedAt = String(row.source_updated_at || '').trim();
            const createdAt = sourceCreatedAt || String(row.created_at || row.createdAt || row.ts || '').trim();
            // production_comments.updated_at is the database ingestion clock,
            // not proof that the source comment was edited. Only fall back to
            // legacy updated_at when the endpoint supplied no source clocks.
            const legacyUpdatedAt = !sourceCreatedAt && !sourceUpdatedAt
                ? String(row.updated_at || row.updatedAt || '').trim()
                : '';
            const updatedAt = sourceUpdatedAt || legacyUpdatedAt || createdAt;
            const author = hidden ? '' : String(row.author || row.author_name || row.user_name || row.actor || row.role || 'Unknown author').trim();
            const body = hidden || deleted ? '' : String(row.body == null ? '' : row.body);
            const fallbackSeed = [row.source || '', row.parent_id || row.parentId || '', createdAt, author, body, index == null ? '' : index].join('\u0000');
            const id = explicitId || ('legacy-' + _prodHashText(fallbackSeed));
            const role = String(row.role || '').trim().toLowerCase();
            const audienceValue = String(row.audience || '').trim().toLowerCase();
            const audience = audienceValue === 'client' || audienceValue === 'internal'
                ? audienceValue
                : role === 'client' ? 'client' : 'internal';
            const attachments = (Array.isArray(row.attachments) ? row.attachments : []).map((asset, assetIndex) => {
                asset = asset && typeof asset === 'object' ? asset : {};
                const url = String(asset.url || asset.rescued_url || '').trim();
                let valid = false;
                try {
                    const parsed = new URL(url);
                    valid = parsed.protocol === 'https:' && !parsed.username && !parsed.password;
                } catch (e) {}
                const rawState = String(asset.state || '').trim().toLowerCase();
                const state = ['missing','invalid','checking','available','expired','permission_denied','unavailable'].includes(rawState)
                    ? rawState
                    : valid ? 'unavailable' : 'invalid';
                return {
                    id: String(asset.id || asset.attachment_id || assetIndex),
                    title: String(asset.title || asset.name || 'Comment attachment').trim(),
                    url: valid ? url : '',
                    state
                };
            });
            const createdMs = Date.parse(createdAt);
            const updatedMs = Date.parse(updatedAt);
            return {
                id,
                parent_id: String(row.parent_id || row.parentId || '').trim(),
                author: author || 'Unknown author',
                role,
                audience,
                body,
                created_at: createdAt,
                updated_at: updatedAt,
                row_updated_at: String(row.row_updated_at || row.updated_at || '').trim(),
                version: Number.isInteger(Number(row.version)) ? Number(row.version) : 1,
                attachments,
                component: String(row.component || '').trim(),
                is_tweak: _prodCommentTruthy(row.is_tweak),
                round: Number.isInteger(Number(row.round)) ? Number(row.round) : null,
                can_edit: _prodCommentTruthy(row.can_edit),
                can_delete: _prodCommentTruthy(row.can_delete),
                can_resolve: _prodCommentTruthy(row.can_resolve),
                source_only: row.source_only === true,
                source_surface: ['calendar', 'sxr'].includes(row.source_surface) ? row.source_surface : '',
                source_audience: ['client', 'internal'].includes(row.source_audience) ? row.source_audience : '',
                parent_unavailable: row.parent_unavailable === true,
                feedback_origin: ['native', 'linear', 'legacy', 'bridge'].includes(row.feedback_origin) ? row.feedback_origin : '',
                tweak_known: typeof row.is_tweak === 'boolean' && row.tweak_known !== false,
                edited: !deleted && (!!String(row.edited_at || '').trim() || _prodCommentTruthy(row.edited)
                    || (Number.isFinite(createdMs) && Number.isFinite(updatedMs) && updatedMs > createdMs + 1000)),
                deleted,
                hidden,
                done: !!String(row.resolved_at || '').trim() || _prodCommentTruthy(row.done) || _prodCommentTruthy(row.resolved),
                // Resolve PROVENANCE, surfaced so a canonical row can carry it.
                // The importer already preserves both into production_comments
                // (scripts/f42-card-comment-import.js), but normalize used
                // resolved_at only as a boolean and dropped the name entirely —
                // so adoption replaced a resolved legacy comment with a row
                // that had lost who marked it done and showed the INGESTION
                // time instead of when it was actually resolved.
                resolved_at: String(row.resolved_at || '').trim(),
                resolved_by_name: String(row.resolved_by_name || row.done_by || '').trim(),
                attachments,
            };
        }
        function _prodCommentMerge(existing, incoming) {
            const byId = new Map();
            const absorb = list => (Array.isArray(list) ? list : []).forEach((row, index) => {
                const normalized = _prodCommentNormalize(row, index);
                if (normalized.id) byId.set(normalized.id, normalized);
            });
            absorb(existing);
            absorb(incoming);
            return Array.from(byId.values()).filter(row => !row.hidden).sort((a, b) => {
                const aa = Date.parse(a.created_at || a.updated_at || '');
                const bb = Date.parse(b.created_at || b.updated_at || '');
                if (Number.isFinite(aa) && Number.isFinite(bb) && aa !== bb) return aa - bb;
                if (Number.isFinite(aa) !== Number.isFinite(bb)) return Number.isFinite(aa) ? -1 : 1;
                return String(a.id).localeCompare(String(b.id));
            });
        }
        function _prodCommentTime(comment) {
            const raw = String(comment && (comment.created_at || comment.updated_at) || '').trim();
            const ms = Date.parse(raw);
            if (!raw || !Number.isFinite(ms)) return { text: 'Time unavailable', raw: '' };
            const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
            if (mins < 1) return { text: 'just now', raw };
            if (mins < 60) return { text: mins + 'm ago', raw };
            const hrs = Math.round(mins / 60);
            if (hrs < 24) return { text: hrs + 'h ago', raw };
            const days = Math.round(hrs / 24);
            if (days < 7) return { text: days + 'd ago', raw };
            return { text: new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }), raw };
        }
        function _prodCommentHTML(comment) {
            const c = _prodCommentNormalize(comment);
            if (c.hidden) return '';
            const time = _prodCommentTime(c);
            const sourceLabel = c.source_only ? (c.source_surface === 'sxr' ? 'Samples' : 'Calendar') + ' source'
                : ({ native: 'Native comment', linear: 'Linear import', legacy: 'Imported feedback', bridge: 'Linked feedback' }[c.feedback_origin] || 'Origin unverified');
            const audienceLabel = c.source_only ? (c.source_audience === 'client' ? 'Card: client-visible' : c.source_audience === 'internal' ? 'Card: internal' : 'Visibility not recorded')
                : c.audience === 'client' ? 'Client-visible' : 'Internal';
            const pills = '<span class="prod-comment-pill">' + _calEsc(audienceLabel) + '</span>'
                + '<span class="prod-comment-pill">' + _calEsc(sourceLabel) + '</span>'
                + (['video', 'graphic'].includes(c.component) ? '<span class="prod-comment-pill">' + (c.component === 'video' ? 'Video' : 'Graphics') + '</span>' : '')
                + (c.tweak_known && c.is_tweak ? '<span class="prod-comment-pill">Tweak' + (c.round > 0 ? ' · Round ' + _calEsc(String(c.round)) : '') + '</span>' : '')
                + (c.done ? '<span class="prod-comment-pill">Resolved</span>' : c.tweak_known && c.is_tweak ? '<span class="prod-comment-pill">Open</span>' : '');
            const edited = c.edited ? '<span class="prod-comment-edited">(edited)</span>' : '';
            const body = c.deleted ? 'Comment deleted.' : _prodLinkify(c.body);
            const attachments = c.deleted || !c.attachments.length ? '' : '<div class="prod-comment-assets">'
                + c.attachments.map(asset => '<div class="prod-comment-asset"><span class="prod-asset-label">' + _calEsc(asset.title) + '</span>'
                    + (asset.url ? '<a href="' + _calEscAttr(asset.url) + '" target="_blank" rel="noopener noreferrer">' + _calEsc(_prodFileLinkLabel(asset.url)) + '</a>' : '<span class="prod-asset-value">No usable link</span>')
                    + '<span class="prod-asset-state" data-state="' + _calEscAttr(asset.state) + '">' + _calEsc(_prodAssetStateLabel(asset.state)) + '</span></div>').join('') + '</div>';
            const issueId = String(_prodState.openId || '');
            const actions = c.deleted || c.source_only ? '' : '<div class="prod-comment-actions">'
                + (!c.done ? '<button class="prod-comment-action" type="button" onclick="_prodCommentBegin(' + _jsAttrArg(issueId) + ',\'add\',' + _jsAttrArg(c.id) + ')">Reply</button>' : '')
                + (c.can_edit ? '<button class="prod-comment-action" type="button" onclick="_prodCommentBegin(' + _jsAttrArg(issueId) + ',\'edit\',' + _jsAttrArg(c.id) + ')">Edit</button>' : '')
                + (c.can_resolve && !c.parent_id ? '<button class="prod-comment-action" type="button" onclick="_prodCommentLifecycle(' + _jsAttrArg(issueId) + ',' + _jsAttrArg(c.id) + ',' + _jsAttrArg(c.done ? 'unresolve' : 'resolve') + ')">' + (c.done ? 'Reopen' : 'Resolve') + '</button>' : '')
                + (c.can_delete ? '<button class="prod-comment-action is-danger" type="button" onclick="_prodCommentLifecycle(' + _jsAttrArg(issueId) + ',' + _jsAttrArg(c.id) + ',\'delete\')">Delete</button>' : '')
                + '</div>';
            return '<div class="prod-comment' + (c.parent_id ? ' is-reply' : '') + (c.deleted ? ' is-deleted' : '') + '" data-prod-comment-id="' + _calEscAttr(c.id) + '">'
                + _prodAvatar(null, 18)
                + '<div class="prod-comment-main"><div class="prod-comment-meta"><span class="prod-comment-author">' + _calEsc(c.author) + '</span>'
                + '<span aria-hidden="true">·</span><time' + (time.raw ? ' datetime="' + _calEscAttr(time.raw) + '" title="' + _calEscAttr(time.raw) + '"' : '') + '>' + _calEsc(time.text) + '</time>'
                + edited + pills + '</div><div class="prod-comment-body">' + body + '</div>' + attachments
                + (c.done && c.resolved_at ? '<div class="prod-feedback-context">Resolved ' + _calEsc(c.resolved_at) + (c.resolved_by_name ? ' by ' + _calEsc(c.resolved_by_name) : '') + '</div>' : '')
                + (c.source_only ? '<div class="prod-feedback-context">Read-only here; manage on the original ' + (c.source_surface === 'sxr' ? 'Samples' : 'Calendar') + ' card.'
                    + (c.parent_unavailable ? ' Original reply parent is unavailable.' : '') + '</div>' : '')
                + actions + '</div></div>';
        }
        function _prodCommentLoadingHTML() {
            return Array.from({ length: 2 }, () => '<div class="prod-comment-loading" role="status" aria-label="Loading comments"><span class="prod-skeleton" style="width:18px;height:18px;border-radius:50%;"></span><span class="prod-comment-loading-copy"><span class="prod-skeleton" style="height:11px;width:110px;"></span><span class="prod-skeleton" style="height:12px;width:min(360px,82%);"></span></span></div>').join('');
        }
        function _prodIssueClientCommentSurfaceKnown(issue) {
            const row = issue && issue.raw && typeof issue.raw === 'object' ? issue.raw : {};
            const team = String(issue && issue.team || row.team || '').trim().toLowerCase();
            return String(row.origin || '').trim().toLowerCase() === 'samples'
                && !!String(row.card_id || '').trim()
                && (team === 'video' || team === 'graphics');
        }
        function _prodCardClientCommentSurfaceKnown(surface, post, component) {
            if (surface !== 'sxr' || !post || !String(post.id || '').trim()) return false;
            if (component !== 'video' && component !== 'graphic') return false;
            return !!_writeUiNativeId(post, component);
        }
        function _prodVerifiedClientCommentSurfaceContext(surface, post, component, deliverableId) {
            if (!_prodCardClientCommentSurfaceKnown(surface, post, component)) return null;
            let cap = null;
            let current = false;
            try {
                cap = _syncviewClientEntryCapability;
                current = !!(_isClientLink
                    && _syncviewClientEntryRunCurrent(_syncviewClientEntryDataRun));
            } catch (e) {}
            if (!current || !cap || !cap.verified || cap.view !== 'sample-reviews') return null;
            let mountedSlug = '';
            try { mountedSlug = sxrClientSlug(sxrState && sxrState.client); } catch (e) {}
            const rowSlug = String(post.client_slug || post.client || '').trim();
            if (!mountedSlug || mountedSlug !== String(cap.slug || '').trim()) return null;
            if (rowSlug && rowSlug !== mountedSlug) return null;
            if (String(_writeUiNativeId(post, component)) !== String(deliverableId || '')) return null;
            return Object.freeze({
                source_surface: 'sxr',
                card_id: String(post.id),
                component
            });
        }
        function _prodVerifiedClientCommentMutationContext(surface, post, component, deliverableId) {
            if (!_isClientLink) return null;
            const expected = _prodVerifiedClientCommentSurfaceContext(
                surface, post, component, deliverableId
            );
            const read = post
                && post._canonicalCommentReads
                && post._canonicalCommentReads[String(deliverableId || '')];
            const verified = read && read.clientSurface;
            return expected
                && read.status === 'ready'
                && read.client === true
                && _prodClientCommentSurfaceKey(verified)
                    === _prodClientCommentSurfaceKey(expected)
                ? verified
                : null;
        }
        function _prodClientCommentSurfaceKey(value) {
            const source = value && typeof value === 'object' ? value : {};
            const sourceSurface = String(source.source_surface || '').trim().toLowerCase();
            const cardId = String(source.card_id || '').trim();
            const component = String(source.component || '').trim().toLowerCase();
            return sourceSurface === 'sxr'
                && !!cardId
                && (component === 'video' || component === 'graphic')
                ? [sourceSurface, cardId, component].join('|')
                : '';
        }
        /* FRONT-DOOR mutation context (2026-08-14) - the client-side half of the
           gateway comment repair for the two populations PR 1064 routed legacy:
           every CALENDAR-surface client comment, and the UNLINKED samples
           thread. Returns the binding fields the widened server contract
           verifies, or null, and null always means fail-legacy - never
           fail-open, never a raw gateway refusal at the client.

           A non-null context requires ALL of:
           - the client_comment_gateway_enabled runtime flag is ON (primed by
             the same fetch as write_ui_reroute_clients; absent/malformed =
             off), so the owner controls rollout and deploy order can never
             route a client at a server that does not yet hold the widened
             contract;
           - a verified, current client-entry capability whose slug matches the
             mounted surface state AND the card row (the same binding discipline
             _prodVerifiedClientCommentSurfaceContext applies to linked sxr);
           - a card that names a deliverable id (the gateway address - a card
             with no native id cannot make a native write), whose crosswalk row
             proves the server will accept it: either crosswalk VALID (the row
             is card-bound to THIS card - the strict exact-card predicate
             governs and the presented card_id will match), or a mismatch on
             card_id ALONE with the deliverable side UNBOUND (origin, team and
             client_slug all match - exactly what clientCommentFrontDoorTargetAllowed
             verifies server-side). A row bound to a DIFFERENT card, a wrong
             team, wrong slug, wrong origin, an unresolved or errored crosswalk
             all return null and stay legacy. */
        async function _prodClientCommentGatewayContext(surface, post, component) {
            if (!_isClientLink) return null;
            if (surface !== 'calendar' && surface !== 'sxr') return null;
            if (component !== 'video' && component !== 'graphic') return null;
            if (!post || !String(post.id || '').trim()) return null;
            const deliverableId = _writeUiNativeId(post, component);
            if (!deliverableId) return null;
            try { await _writeUiPrimeRerouteFlag(); } catch (e) { return null; }
            if (!_clientCommentGatewayOn()) return null;
            const capabilityBound = () => {
                let cap = null;
                let current = false;
                try {
                    cap = _syncviewClientEntryCapability;
                    current = !!(_isClientLink
                        && _syncviewClientEntryRunCurrent(_syncviewClientEntryDataRun));
                } catch (e) { return false; }
                if (!current || !cap || !cap.verified) return false;
                if (surface === 'sxr' && cap.view !== 'sample-reviews') return false;
                if (surface === 'calendar'
                    && (cap.view === 'sample-reviews' || cap.view === 'samples')) return false;
                let mountedSlug = '';
                try {
                    mountedSlug = surface === 'sxr'
                        ? sxrClientSlug(sxrState && sxrState.client)
                        : calClientSlug(calState && calState.client);
                } catch (e) { return false; }
                if (!mountedSlug || mountedSlug !== String(cap.slug || '').trim()) return false;
                const rowSlug = String(post.client_slug || post.client || '').trim();
                if (rowSlug && rowSlug !== mountedSlug) return false;
                return true;
            };
            if (!capabilityBound()) return null;
            if (!_prodCrosswalkVerdict(post, deliverableId, component)) {
                try { await _prodResolveCardCrosswalk(surface, post, [component]); } catch (e) { return null; }
                // The resolve awaited the network; the card binding, the flag
                // and the client-entry capability must all still hold.
                if (deliverableId !== _writeUiNativeId(post, component)) return null;
                if (!_clientCommentGatewayOn() || !capabilityBound()) return null;
            }
            const verdict = _prodCrosswalkVerdict(post, deliverableId, component);
            if (!verdict) return null;
            const cardBound = verdict.state === 'valid';
            const cardUnbound = verdict.state === 'mismatch'
                && Array.isArray(verdict.fields)
                && verdict.fields.length === 1
                && verdict.fields[0] === 'card_id'
                && verdict.card_unbound === true;
            if (!cardBound && !cardUnbound) return null;
            return Object.freeze({
                source_surface: surface,
                card_id: String(post.id),
                component
            });
        }
        function _prodFeedbackState(value, previous) {
            const statuses = ['complete', 'unmapped', 'source_unavailable', 'source_incomplete', 'source_limit', 'source_changed', 'link_changed'];
            if (!value || value.version !== 1 || !statuses.includes(value.status) || !Array.isArray(value.rows)) {
                return { status: 'unavailable', complete: false, rows: previous && previous.rows || [], retained: !!(previous && previous.rows && previous.rows.length), scope: previous && previous.scope || null };
            }
            const sameScope = !!(previous && previous.scope && value.scope)
                && JSON.stringify(previous.scope) === JSON.stringify(value.scope);
            const retained = (value.status === 'source_unavailable' || value.retain_previous === true && ['source_incomplete', 'source_limit'].includes(value.status))
                && sameScope && previous.rows && previous.rows.length;
            const incoming = value.rows.filter(row => row && row.source_only === true);
            return { ...value, complete: value.status === 'complete' && value.complete === true,
                rows: retained ? [...new Map([...previous.rows, ...incoming].map(row => [String(row.id), row])).values()] : incoming, retained: !!retained };
        }
        function _prodFeedbackHTML(feedback, canonicalRows, id, incompleteCanonical) {
            if (!feedback) return '';
            const labels = {
                complete: 'Feedback from the linked card was checked. Earlier versions and resolution history are not included.',
                unmapped: 'This issue has no verified Calendar or Samples card link. Other feedback may be missing.',
                source_unavailable: 'Feedback from the linked card could not load. SyncLinear comments remain available.',
                source_incomplete: 'Some feedback could not be read. The visible notes are not a complete record.',
                source_limit: 'Some feedback could not be loaded because this record is too large. The view is incomplete.',
                source_changed: 'Feedback changed while it was loading. Refresh to check it again.',
                link_changed: 'The original card link has changed. Its notes are withheld until the link is verified.',
                unavailable: 'Feedback from the original card is unavailable. The view is incomplete.'
            };
            const visibleCanonical = new Map((canonicalRows || []).map(row => [String(row.id), row]));
            const sourceRows = (feedback.rows || []).filter(row => {
                const canonical = row.covered_by && visibleCanonical.get(String(row.covered_by));
                return !canonical || !Number.isInteger(row.covered_version) || !row.covered_updated_at
                    || Number(canonical.version) !== row.covered_version
                    || String(canonical.row_updated_at || canonical.updated_at || '') !== String(row.covered_updated_at);
            });
            const incomplete = !feedback.complete || incompleteCanonical;
            const message = (labels[feedback.status] || labels.unavailable)
                + (feedback.retained ? ' Previously loaded card notes are shown and may be out of date.' : '')
                + (incompleteCanonical ? ' Some SyncLinear comments may still be missing.' : '');
            return '<div class="prod-feedback-status' + (incomplete ? ' is-error' : '') + '" role="status" data-prod-feedback-state="' + _calEscAttr(incomplete ? 'incomplete' : 'complete') + '">'
                + _calEsc(message) + (incomplete ? ' <button class="prod-comment-state-action" data-prod-feedback-refresh="' + _calEscAttr(id) + '" type="button" onclick="_prodComments.refresh(' + _jsAttrArg(id) + ')">Refresh feedback</button>' : '') + '</div>'
                + (sourceRows.length ? '<div class="prod-feedback-source"><div class="prod-feedback-heading">From the original card</div>' + sourceRows.map(_prodCommentHTML).join('') + '</div>' : '');
        }
        const _prodComments = (() => {
            const states = new Map();
            let generation = 0;
            const stateFor = id => states.get(String(id || '')) || null;
            const repaint = () => { try { _prodRender(); } catch (e) {} };
            const clientSurfaceFor = value => {
                const source = value && typeof value === 'object' ? value : {};
                const sourceSurface = String(source.source_surface || '').trim().toLowerCase();
                const cardId = String(source.card_id || '').trim();
                const component = String(source.component || '').trim().toLowerCase();
                return sourceSurface === 'sxr'
                    && !!cardId
                    && (component === 'video' || component === 'graphic')
                    ? { source_surface: 'sxr', card_id: cardId, component }
                    : null;
            };
            const authHeaders = () => _syncviewEfHeaders({
                apikey: CAL_SUPABASE_ANON_KEY,
                Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY,
                Accept: 'application/json',
                'Content-Type': 'application/json'
            }, PROD_COMMENTS_EF_URL);
            async function load(id, options) {
                id = String(id || '').trim();
                options = options || {};
                if (!id) return;
                const loadIssue = typeof _prodIssue === 'function' ? _prodIssue(id) : null;
                if (loadIssue && loadIssue.syntheticBatchParent === true) {
                    // A batch parent has no comment thread of its own; the
                    // reader would answer with the scope error. Show the calm
                    // empty state instead — the composer already explains that
                    // work happens on the sub-issues.
                    states.set(id, {
                        status: 'ready', items: [], cursor: null, hasMore: false,
                        loadingMore: false, moreError: '', clientSurface: null,
                        clientSurfaceVerified: false
                    });
                    repaint();
                    return stateFor(id);
                }
                const append = !!options.append;
                const previous = stateFor(id);
                const requestedClientSurface = clientSurfaceFor(options.clientSurface);
                const previousClientSurface = clientSurfaceFor(previous && previous.clientSurface);
                const bindingChanged = !!requestedClientSurface
                    && _prodClientCommentSurfaceKey(requestedClientSurface)
                        !== _prodClientCommentSurfaceKey(previousClientSurface);
                // A lifecycle prewrite read must replace every cached page.
                // Newest-page refresh normally preserves already-loaded older
                // rows for display, but that would let an old-page lifecycle
                // cursor survive without being fetched from canonical truth.
                const replace = !append && options.replace === true;
                // One deliverable may be opened from more than one card over its
                // lifetime. A new exact SXR binding is a new authorization
                // context, never a refresh of the prior card's verified state.
                const current = bindingChanged || replace ? null : previous;
                const clientSurface = requestedClientSurface || previousClientSurface;
                if (append && (!current || current.status !== 'ready' || current.loadingMore || !current.cursor)) return;
                if (!append && current && !options.force) return;
                if (_isClientLink && !clientSurface) {
                    states.set(id, {
                        status: 'forbidden', items: [], cursor: null, hasMore: false,
                        loadingMore: false, moreError: '', clientSurface: null,
                        clientSurfaceVerified: false
                    });
                    repaint();
                    return stateFor(id);
                }
                let hasClientCredential = false;
                try { hasClientCredential = !!(_isClientLink && _syncviewClientWriteToken()); } catch (e) {}
                if (!_syncviewStaffIdentityForHeaders() && !hasClientCredential) {
                    states.set(id, {
                        status: 'signin', items: [], cursor: null, hasMore: false,
                        loadingMore: false, moreError: '', clientSurface,
                        clientSurfaceVerified: false
                    });
                    repaint();
                    return stateFor(id);
                }
                const requestGeneration = generation;
                const requestIdentity = JSON.stringify(_syncviewStaffIdentityForHeaders() || null);
                const token = (previous && previous.token || 0) + 1;
                const refreshing = !append && !!options.refresh && !!current && current.status === 'ready';
                if (append) states.set(id, { ...current, token, loadingMore: true, moreError: '' });
                else if (refreshing) states.set(id, { ...current, token, refreshing: true, loadingMore: false, refreshError: '' });
                else states.set(id, {
                    status: 'loading', items: [], cursor: null, hasMore: false,
                    loadingMore: false, refreshing: false, moreError: '',
                    refreshError: '', pagesLoaded: 0, clientSurface,
                    clientSurfaceVerified: false, token
                });
                repaint();
                const cursor = append && current ? current.cursor : null;
                /* A read that never answers used to sit on the skeleton for the
                   life of the page. The error branch below and its Retry button
                   already existed -- they were simply unreachable, because a
                   stalled fetch never rejects, so nothing ever left 'loading'.
                   Reported 2026-08-31: every issue opened on a slow connection
                   showed the placeholder rows for ever, and the only way back
                   was to POST a comment (which starts a fresh read, by then
                   racing nothing). The Frame.io link arrives AS a comment, so a
                   thread that never loads is also a link the editor cannot see.
                   The abort turns that dead end into the Retry the UI already
                   draws. */
                const timeoutCtl = typeof AbortController === 'function' ? new AbortController() : null;
                let timedOut = false;
                const timeoutTimer = timeoutCtl ? setTimeout(() => {
                    timedOut = true;
                    try { timeoutCtl.abort(); } catch (e) {}
                }, PROD_COMMENTS_READ_TIMEOUT_MS) : 0;
                try {
                    const requestBody = {
                        deliverable_id: id,
                        limit: PROD_COMMENTS_PAGE_SIZE,
                        before: cursor || null
                    };
                    if (clientSurface) Object.assign(requestBody, clientSurface);
                    const includeFeedback = !_isClientLink && !clientSurface && options.canonicalOnly !== true;
                    if (includeFeedback) requestBody.include_feedback = true;
                    const response = await fetch(PROD_COMMENTS_EF_URL, {
                        method: 'POST',
                        headers: authHeaders(),
                        cache: 'no-store',
                        signal: timeoutCtl ? timeoutCtl.signal : undefined,
                        body: JSON.stringify(requestBody)
                    });
                    const json = await response.json().catch(() => ({}));
                    if (generation !== requestGeneration || !stateFor(id) || stateFor(id).token !== token) return;
                    if (requestIdentity !== JSON.stringify(_syncviewStaffIdentityForHeaders() || null)) { clear(id); return; }
                    if (response.status === 401 || response.status === 403) {
                        states.set(id, {
                            status: response.status === 401 ? 'signin' : 'forbidden',
                            items: [], cursor: null, hasMore: false,
                            loadingMore: false, refreshing: false, moreError: '',
                            refreshError: '', pagesLoaded: 0, clientSurface,
                            clientSurfaceVerified: false, token
                        });
                        repaint();
                        return stateFor(id);
                    }
                    if (!response.ok) throw new Error('Comments read failed: HTTP ' + response.status);
                    const rawPage = Array.isArray(json.comments) ? json.comments : Array.isArray(json.items) ? json.items : [];
                    // The reader enforces this server-side. Keep the real client
                    // surface fail-closed if a stale/misconfigured deployment
                    // ever returns an internal row anyway.
                    const page = clientSurface
                        ? rawPage.filter(row => row && String(row.audience || '').trim().toLowerCase() === 'client')
                        : rawPage;
                    const candidateCursor = json.next_cursor || json.nextCursor || null;
                    const nextCursor = candidateCursor && typeof candidateCursor === 'object'
                        && String(candidateCursor.created_at || '').trim()
                        && String(candidateCursor.id || '').trim()
                        ? { created_at: String(candidateCursor.created_at), id: String(candidateCursor.id) }
                        : null;
                    // Revalidating the newest page must not discard pages the user
                    // already loaded. Stable-id merge applies edits/tombstones while
                    // the deepest cursor remains authoritative after page 2+.
                    const priorItems = (append || refreshing) && current ? current.items : [];
                    const priorPages = current ? Math.max(1, Number(current.pagesLoaded || 1)) : 0;
                    const preserveDeepCursor = refreshing && priorPages > 1;
                    states.set(id, {
                        status: 'ready',
                        items: _prodCommentMerge(priorItems, page),
                        feedback: includeFeedback ? _prodFeedbackState(json.feedback, current && current.feedback)
                            : !clientSurface && !_isClientLink ? previous && previous.feedback || _prodFeedbackState(null, null) : null,
                        pageIncomplete: !Array.isArray(json.comments) && !Array.isArray(json.items)
                            || (json.has_more === true || json.hasMore === true) && !nextCursor,
                        cursor: preserveDeepCursor ? current.cursor : nextCursor,
                        hasMore: preserveDeepCursor ? current.hasMore : !!nextCursor && (json.has_more !== false && json.hasMore !== false),
                        loadingMore: false,
                        refreshing: false,
                        moreError: '',
                        refreshError: '',
                        pagesLoaded: append ? priorPages + 1 : refreshing ? priorPages : 1,
                        clientSurface,
                        clientSurfaceVerified: !!(clientSurface
                            && hasClientCredential
                            && json.canonical_thread === true
                            && String(json.audience_scope || '').trim().toLowerCase() === 'client'),
                        token,
                    });
                } catch (e) {
                    if (generation !== requestGeneration || !stateFor(id) || stateFor(id).token !== token) return;
                    if (requestIdentity !== JSON.stringify(_syncviewStaffIdentityForHeaders() || null)) { clear(id); return; }
                    // A timeout is not the same event as a refusal, and saying so
                    // is the difference between "try again" and "something is
                    // broken". Both land on the same Retry control.
                    const slow = timedOut || (e && e.name === 'AbortError');
                    if (append && current) states.set(id, { ...current, token, loadingMore: false, moreError: slow ? 'Older comments took too long to load.' : 'Older comments could not load.' });
                    else if (refreshing && current) states.set(id, { ...current, token, refreshing: false, loadingMore: false, refreshError: slow ? 'Comments took too long to refresh.' : 'Comments could not refresh.' });
                    else states.set(id, {
                        status: 'error', items: [], cursor: null, hasMore: false,
                        loadingMore: false, refreshing: false, moreError: '',
                        refreshError: '', pagesLoaded: 0, clientSurface,
                        clientSurfaceVerified: false, token, timedOut: slow
                    });
                } finally {
                    if (timeoutTimer) clearTimeout(timeoutTimer);
                }
                repaint();
                return stateFor(id);
            }
            function ensure(id) {
                if (!stateFor(id)) load(id);
            }
            function refresh(id) {
                const current = stateFor(id);
                // _prodRender() may call ensure() immediately before an explicit
                // reopen/refresh. Reuse that in-flight request instead of racing it.
                if (current && (current.status === 'loading' || current.refreshing)) return;
                load(id, { force: true, refresh: true });
            }
            function retry(id) {
                states.delete(String(id || ''));
                load(id, { force: true });
            }
            function loadOlder(id) {
                load(id, { append: true });
            }
            function find(id, commentId) {
                const state = stateFor(id);
                return state && Array.isArray(state.items)
                    ? state.items.find(row => String(row.id) === String(commentId)) || null
                    : null;
            }
            function adopt(id, row) {
                if (!row) return;
                const state = stateFor(id);
                if (!state || state.status !== 'ready') return;
                states.set(String(id), { ...state, items: _prodCommentMerge(state.items, [row]) });
                repaint();
            }
            async function readCanonical(id, options) {
                options = options || {};
                await load(id, {
                    force: true,
                    refresh: true,
                    replace: options.replace === true,
                    canonicalOnly: true,
                    clientSurface: options.clientSurface || null
                });
                for (let page = 1; page < 20; page++) {
                    const state = stateFor(id);
                    if (!state || state.status !== 'ready' || !state.hasMore || !state.cursor) break;
                    await load(id, {
                        append: true,
                        canonicalOnly: true,
                        clientSurface: state.clientSurface || options.clientSurface || null
                    });
                }
                return stateFor(id);
            }
            async function signIn(id) {
                await _syncviewOpenStaffIdentity({ reason: 'required' });
                if (_syncviewStaffIdentityForHeaders()) retry(id);
            }
            function clear(id) {
                generation++;
                if (id == null) states.clear();
                else states.delete(String(id || ''));
                repaint();
            }
            function render(id) {
                const state = stateFor(id);
                if (!state || state.status === 'loading') return _prodCommentLoadingHTML();
                if (state.status === 'signin') return '<div class="prod-comment-state" data-prod-comments-state="signin">Sign in with your staff account to view comments.<br><button class="prod-comment-state-action" type="button" onclick="_prodComments.signIn(' + _jsAttrArg(id) + ')">Sign in to view comments</button></div>';
                if (state.status === 'forbidden') return '<div class="prod-comment-state is-error" data-prod-comments-state="forbidden">This comment thread is not available to your exact team or client scope.</div>';
                if (state.status === 'error') return '<div class="prod-comment-state is-error" data-prod-comments-state="error">' + (state.timedOut ? 'Comments took too long to load.' : 'Comments could not load.') + '<br><button class="prod-comment-state-action" type="button" onclick="_prodComments.retry(' + _jsAttrArg(id) + ')">Retry</button></div>';
                const feedback = _prodFeedbackHTML(state.feedback, state.items, id, !!(state.hasMore || state.pageIncomplete || state.moreError || state.refreshError));
                if (!state.items.length && !feedback) return '<div class="prod-comment-state" data-prod-comments-state="empty">No comments yet.</div>';
                const rows = state.items.map(_prodCommentHTML).join('');
                const refreshError = state.refreshError ? '<div class="prod-comment-state is-error">' + _calEsc(state.refreshError) + ' <button class="prod-comment-state-action" type="button" onclick="_prodComments.refresh(' + _jsAttrArg(id) + ')">Retry</button></div>' : '';
                const more = state.hasMore
                    ? '<button class="prod-comment-more" type="button" data-prod-comments-more="1" onclick="_prodComments.loadOlder(' + _jsAttrArg(id) + ')"' + (state.loadingMore ? ' disabled' : '') + '>' + (state.loadingMore ? 'Loading older comments…' : 'Load older comments') + '</button>'
                    : '';
                const moreError = state.moreError ? '<div class="prod-comment-state is-error">' + _calEsc(state.moreError) + ' <button class="prod-comment-state-action" type="button" onclick="_prodComments.loadOlder(' + _jsAttrArg(id) + ')">Retry</button></div>' : '';
                return refreshError + '<div class="prod-comment-feed" data-prod-comments-state="ready">' + rows + '</div>' + moreError + more + feedback;
            }
            return { clear, ensure, refresh, retry, loadOlder, signIn, render, find, adopt, readCanonical };
        })();
        function _prodCanonicalCardComment(row) {
            const c = _prodCommentNormalize(row);
            return {
                id: c.id,
                parent_id: c.parent_id || null,
                author: c.author,
                role: c.role,
                body: c.body,
                audience: c.audience,
                component: c.component,
                is_tweak: c.is_tweak,
                round: c.round,
                attachments: c.attachments,
                created_at: c.created_at,
                updated_at: c.row_updated_at || c.updated_at,
                done: c.done,
                // Prefer the real resolve timestamp over the ingestion clock,
                // and carry who resolved it. Both come from canonical storage,
                // so this is preservation, not invention, and it survives the
                // next canonical read.
                done_at: c.done ? (c.resolved_at || c.row_updated_at || c.updated_at) : '',
                done_by: c.resolved_by_name || '',
                deleted: c.deleted,
                edited: c.edited,
                version: c.version,
                row_updated_at: c.row_updated_at,
                canonical_updated_at: c.row_updated_at,
                can_edit: c.can_edit,
                can_delete: c.can_delete,
                can_resolve: c.can_resolve,
                canonical: true
            };
        }
        async function _prodProjectCanonicalCardComments(surface, pid) {
            const calendar = surface === 'calendar';
            const state = calendar ? calState : sxrState;
            const post = state && Array.isArray(state.posts) ? state.posts.find(row => String(row.id) === String(pid)) : null;
            if (!post) return false;
            const allComponents = calendar ? _calComponentsFor(post) : SXR_COMPONENTS;
            post._canonicalCommentReads = post._canonicalCommentReads || {};
            // Resolve the F42 crosswalk BEFORE projecting anything. A component
            // whose link does not validate is left entirely alone: no read, no
            // projection, no setter call — so its legacy card comments (and, on
            // calendar, its *_tweaks wire string) survive untouched.
            // Generation token for the whole projection. Every await below
            // re-checks it, so a card re-pointed — or a client link switched to
            // another card — mid-flight aborts instead of writing verdicts and
            // rows derived from the binding that no longer applies.
            const bindingToken = _prodCardBindingToken(surface, post, allComponents);
            try {
            // Send also waits on this lookup specifically: a kept 'ready' verdict
            // may only be reused once the CURRENT crosswalk confirms the card is
            // still bound to the same deliverable.
            post._canonicalCrosswalkInFlight = (post._canonicalCrosswalkInFlight || 0) + 1;
            const validComponents = await _prodResolveCardCrosswalk(surface, post, allComponents)
                .finally(() => {
                    post._canonicalCrosswalkInFlight = Math.max(0, (post._canonicalCrosswalkInFlight || 1) - 1);
                });
            if (validComponents === null) return false;
            if (_prodCardBindingToken(surface, post, allComponents) !== bindingToken) return false;
            const components = allComponents.filter(component => validComponents.has(component));
            // Snapshot what the client can SEE today, per component, BEFORE the
            // read is stamped 'loading' and before the canonical slot is
            // cleared. Both of those change what the gate and the view would
            // answer, so a check made afterwards can only ever observe the
            // state this projection already imposed. Computed gate-independently
            // for the same reason.
            const clientVisibleBefore = new Map();
            if (!calendar && _isClientLink) {
                components.forEach(component => {
                    clientVisibleBefore.set(component, _sxrClientVisibleLegacyRows(post, component));
                });
            }
            if (calendar && _calOpenCommentsPid === pid) _calRenderCommentsModal();
            if (!calendar && _sxrOpenCommentsPid === pid) _sxrRenderCommentsModal();
            const groups = new Map();
            components.forEach(component => {
                const deliverableId = _writeUiNativeId(post, component);
                if (!deliverableId) return;
                if (!groups.has(deliverableId)) groups.set(deliverableId, []);
                groups.get(deliverableId).push(component);
                const clientSurface = _prodVerifiedClientCommentSurfaceContext(
                    surface, post, component, deliverableId
                );
                // Reuse an authorization this page already holds: a staff read
                // that already came back ready for this exact deliverable keeps
                // its 'ready' verdict instead of being reset to 'loading', so
                // reopening Notes does not lock Send again once the crosswalk
                // above has re-confirmed this card's binding. The deliverable is
                // already in `groups` above, so the canonical re-read below
                // still runs and its rows repaint the open modal when they land.
                // Client links always re-verify from 'loading'.
                const priorRead = post._canonicalCommentReads[deliverableId];
                const keepPriorReady = !_isClientLink && priorRead && priorRead.status === 'ready';
                if (!keepPriorReady) {
                    post._canonicalCommentReads[deliverableId] = {
                        status: 'loading',
                        client: false,
                        clientSurface
                    };
                }
                // A client projection belongs to this exact card/component.
                // Clear it before authorization so a failed binding switch can
                // never retain rows from the previously verified card.
                if (!calendar && _isClientLink) {
                    _sxrSetCanonicalCommentsFor(post, component, []);
                }
            });
            if (!groups.size) return false;
            if (calendar && _calOpenCommentsPid === pid) _calRenderCommentsModal();
            if (!calendar && _sxrOpenCommentsPid === pid) _sxrRenderCommentsModal();
            await Promise.all([...groups.entries()].map(async ([deliverableId, linkedComponents]) => {
                const component = linkedComponents[0];
                const clientSurface = _prodVerifiedClientCommentSurfaceContext(
                    surface, post, component, deliverableId
                );
                const thread = await _prodComments.readCanonical(deliverableId, {
                    clientSurface
                });
                if (!thread || thread.status !== 'ready') {
                    post._canonicalCommentReads[deliverableId] = {
                        status: 'error',
                        client: false,
                        clientSurface
                    };
                    return;
                }
                const clientBindingVerified = !_isClientLink || !!(
                    clientSurface
                    && thread.clientSurfaceVerified
                    && _prodClientCommentSurfaceKey(thread.clientSurface)
                        === _prodClientCommentSurfaceKey(clientSurface)
                );
                if (!clientBindingVerified) {
                    linkedComponents.forEach(linkedComponent => {
                        if (!calendar) _sxrSetCanonicalCommentsFor(post, linkedComponent, []);
                    });
                    post._canonicalCommentReads[deliverableId] = {
                        status: 'error',
                        client: false,
                        clientSurface
                    };
                    return;
                }
                // The read is another await: if the binding moved while it was
                // in flight, these rows belong to a card that is no longer the
                // one being projected. Drop them rather than write them.
                if (_prodCardBindingToken(surface, post, allComponents) !== bindingToken) return;
                const rows = (thread.items || []).map(_prodCanonicalCardComment);
                let clientLegacyHeld = false;
                linkedComponents.forEach(component => {
                    const projected = rows.filter(row => {
                        const tagged = String(row.component || '').trim();
                        return tagged ? tagged === component : component === linkedComponents[0];
                    });
                    // A valid link still fans one deliverable id out across
                    // several components: `video_deliverable_id` governs video,
                    // caption AND title.
                    //
                    // The rule is provenance, not emptiness. A canonical
                    // projection may replace non-empty legacy content ONLY when
                    // it demonstrably contains that content — otherwise a single
                    // canonical row (a fresh reply on a never-imported card)
                    // would pass an is-it-empty test and wholesale-replace the
                    // stored array and its wire string. When the invariant
                    // fails we leave legacy storage exactly as it is; the reader
                    // keeps rendering the legacy thread, so nothing is hidden
                    // and nothing is destroyed.
                    //
                    // Scoped to the two paths that write LEGACY storage. The
                    // client SXR path writes `_canonicalCommentsByComponent`,
                    // a separate slot whose deliberate pre-authorization clear
                    // must not be blocked.
                    const writesLegacy = calendar || !_isClientLink;
                    const legacyRows = calendar
                        ? _calCommentsFor(post, component)
                        : _sxrCommentsFor(post, component);
                    // A column the loader could not fully read is UNKNOWN, not
                    // empty. Its stored text is still recoverable by a human or
                    // a migration right up until a projection overwrites it, so
                    // refuse on either path — there is no coverage argument to
                    // make about content we never managed to load.
                    if (_prodLegacyReadIncomplete(post, component, legacyRows, surface)
                        || _prodLegacyUnrepresentableState(legacyRows).length) {
                        // Held on EVERY path, including staff. Falling through
                        // to `ready` here would report linked+ready for a card
                        // whose legacy thread is what actually renders, and the
                        // lifecycle writes then address a canonical row that
                        // does not exist.
                        clientLegacyHeld = true;
                        return;
                    }
                    if (writesLegacy) {
                        // HOLD, exactly as the incomplete-read guard above and the
                        // client-SXR guard below already do. Returning bare here
                        // left `clientLegacyHeld` false, so the deliverable was
                        // still stamped `ready` — and the gate then answered
                        // linked+ready for a card whose LEGACY rows are what
                        // actually renders, because the setter below was skipped.
                        //
                        // That combination is not merely untidy, it is the whole
                        // failure: `Mark done` routes on `linked`, the lifecycle
                        // requires `ready`, and the legacy row it is handed
                        // carries no `version`/`row_updated_at` — so the write
                        // dies at the CAS guard before a request is ever sent, and
                        // the user is told the comment could not be committed.
                        // Holding sends the card back to the legacy resolve path,
                        // which is the one that still works on an uncovered card.
                        if (!_prodCanonicalCoversLegacy(projected, legacyRows)) {
                            clientLegacyHeld = true;
                            return;
                        }
                    } else {
                        // Client SXR: the client must never end up seeing LESS
                        // than they see today. The test is coverage, not
                        // emptiness — a PARTIAL canonical thread hides whatever
                        // it fails to carry just as surely as an empty one, and
                        // an is-it-empty check skips that case entirely.
                        //
                        // Compared against the snapshot taken before this
                        // projection stamped 'loading' and cleared the canonical
                        // slot, because both of those change what a live read
                        // would report.
                        //
                        // The two sides answer two different questions, and each
                        // must be computed the way its own reader computes it:
                        //
                        //   clientLegacy    — what the client sees TODAY, which
                        //                     the unlinked branch renders with
                        //                     ROOT-audience inheritance.
                        //   clientCanonical — what the client will see AFTER
                        //                     adoption, which the linked branch
                        //                     renders with a PER-ROW audience
                        //                     filter.
                        //
                        // Building the canonical side with root inheritance
                        // instead would certify rows the reader then drops: a
                        // staff reply carries no audience of its own, inherits
                        // `client` from the root today, and is filtered out as
                        // `internal` once canonical. Coverage would pass, the
                        // card would adopt, and the client would lose a message
                        // they can read right now.
                        //
                        // So this comparison is deliberately "what they will
                        // actually see" against "what they actually see", and a
                        // hold caused by the two render rules disagreeing is a
                        // CORRECT refusal, not a false positive.
                        const clientLegacy = clientVisibleBefore.get(component) || [];
                        const clientCanonical = projected.filter(row => row
                            && row.canonical === true
                            && row.audience === 'client'
                            && (!row.deleted || row.canonical)
                            && !row.hidden);
                        if (!_prodCanonicalCoversLegacy(clientCanonical, clientLegacy)) {
                            clientLegacyHeld = true;
                            return;
                        }
                    }
                    if (calendar) {
                        _calSetCommentsFor(post, component, projected);
                        if (component === 'video') post.comments = projected;
                    } else if (_isClientLink) {
                        _sxrSetCanonicalCommentsFor(post, component, projected);
                    } else {
                        _sxrSetCommentsFor(post, component, projected);
                        if (component === 'video') post.comments = projected;
                    }
                });
                if (clientLegacyHeld) {
                    post._canonicalCommentReads[deliverableId] = {
                        status: 'legacy_retained',
                        client: false,
                        clientSurface
                    };
                    return;
                }
                post._canonicalCommentReads[deliverableId] = {
                    status: 'ready',
                    client: _isClientLink
                        ? clientBindingVerified
                        : _prodCardClientCommentSurfaceKnown(surface, post, component),
                    clientSurface
                };
            }));
            return true;
            } finally {
                if (calendar && _calOpenCommentsPid === pid) _calRenderCommentsModal();
                if (!calendar && _sxrOpenCommentsPid === pid) _sxrRenderCommentsModal();
            }
        }
        function _prodCanonicalCommentGate(post, component) {
            const deliverableId = _writeUiNativeId(post, component);
            if (!deliverableId) return { linked: false, ready: false, client: false, status: 'unlinked' };
            // Canonical-where-VALIDLY-linked. A deliverable id alone is not a
            // link: unless the deliverable's origin/team/client_slug/card_id
            // describe this exact card, the F42 import can never write a
            // canonical thread for it, and claiming `linked` here would project
            // an empty thread over the card's real legacy comments. Unresolved
            // and failed lookups fall back to legacy for the same reason.
            const crosswalk = _prodCrosswalkVerdict(post, deliverableId, component);
            if (!crosswalk || crosswalk.state !== 'valid') {
                return {
                    linked: false,
                    ready: false,
                    client: false,
                    status: crosswalk && crosswalk.state
                        ? 'crosswalk_' + crosswalk.state
                        : 'crosswalk_unresolved'
                };
            }
            const state = post && post._canonicalCommentReads && post._canonicalCommentReads[deliverableId];
            // The projection held this thread back because the canonical side
            // was empty while client-visible legacy comments still exist.
            // Reporting `linked` here would render the client an empty thread
            // and hide comments they can see today, so the card is reported
            // NOT linked and the reader keeps the legacy view. Existing
            // client-visible comments are never hidden by a link.
            if (state && state.status === 'legacy_retained') {
                return { linked: false, ready: false, client: false, status: 'legacy_retained' };
            }
            const expectedClientSurface = _isClientLink
                ? _prodVerifiedClientCommentSurfaceContext('sxr', post, component, deliverableId)
                : null;
            /* A CLIENT whose exact surface binding cannot be verified is sent
               to the legacy card store, not held.

               `_prodVerifiedClientCommentSurfaceContext` answers null for every
               client on the CALENDAR: it requires `surface === 'sxr'` and a
               capability whose view is `sample-reviews`. That is not an
               oversight to widen here -- the protected reader agrees, and it is
               the authority. `clientSurfaceTargetAllowed`
               (production-comments/policy.mjs) admits a client read only when
               `source_surface === 'sxr'` AND the deliverable's own
               `origin === 'samples'`. A calendar card's deliverable is
               `origin === 'calendar'` by construction, so a calendar client can
               never be authorized for a canonical read. Claiming `linked` for
               them promised a thread the server will always refuse.

               Held, that promise cost the client their composer outright:
               `_calComposerHtml` replaces the entire text box with "Notes could
               not load" whenever `linked && !ready`, so on a card whose
               crosswalk is CORRECT the client had nothing to type into, while
               the same client could still comment on a card whose crosswalk was
               BROKEN (that answers `linked:false` earlier and falls to legacy).
               The better-configured card was the unusable one.

               So an unverifiable client surface reports NOT linked, which is
               the same answer this function already gives for an unresolved
               crosswalk and for `legacy_retained`, and for the same reason:
               where canonical cannot be served, the legacy store is the one
               that still works. Staff are untouched (`_isClientLink` guards
               it), the SXR client is untouched (their context resolves), and
               nothing here widens what the server will authorize. */
            if (_isClientLink && !expectedClientSurface) {
                return {
                    linked: false,
                    ready: false,
                    client: false,
                    status: 'client_surface_unverifiable'
                };
            }
            const exactClientBinding = !_isClientLink || !!(
                expectedClientSurface
                && state
                && _prodClientCommentSurfaceKey(state.clientSurface)
                    === _prodClientCommentSurfaceKey(expectedClientSurface)
            );
            return {
                linked: true,
                ready: !!(state && state.status === 'ready' && exactClientBinding),
                client: !!(state && state.client && exactClientBinding),
                status: state && state.status || 'loading'
            };
        }
        function _prodDescriptionHTML(value, loaded, emptyText, rich) {
            // The one caller that opts into images: a description is
            // staff-authored. Comments are not, and keep link-only behaviour.
            if (value) return rich ? _prodLinkify(value, { images: true }) : _calEsc(value);
            if (!loaded) return '<span class="prod-skeleton prod-desc-loading" data-prod-desc-loading="1" role="status" aria-label="Loading description"></span>';
            return '<span class="prod-desc-empty">' + _calEsc(emptyText) + '</span>';
        }
        function _prodDescriptionText(value) {
            return value == null ? '' : String(value);
        }
        function _prodDescriptionState(id) {
            id = String(id || '');
            if (!id) return null;
            let state = _prodState.descriptions.get(id);
            /* Same use-time scope gate the asset cache has, for the same reason
               -- and here it closes a hole that was already open.

               The invalidation below has preserved description VALUES across a
               projection swap since the tab-return flash was fixed, on the
               reasoning that the request-token bump quarantines held responses.
               It does: it stops a late response LANDING. It does nothing about
               a value that landed cleanly and is then re-rendered on a row the
               swap moved to another client -- exactly the case review raised
               against the asset cache on 2026-08-31. Descriptions had the same
               exposure, without the same discussion.

               So a completed description read is stamped with the scope it was
               answered under, and refused here if the row has moved. */
            if (state && state.scopeSignature) {
                const liveIssue = _prodIssue(id);
                if (liveIssue && _prodIssueScopeSignature(liveIssue) !== state.scopeSignature) {
                    if (state.editing || state.saving) {
                        // The draft is the user's own text and is never another
                        // client's; only the server baseline is dropped.
                        state.value = '';
                        state.baseline = '';
                        state.hasValue = false;
                        state.status = 'idle';
                        state.sourceUpdatedAt = '';
                        state.remoteChanged = true;
                        state.scopeSignature = '';
                        state.renderValue = '';
                        state.renderExpiresAt = 0;
                    } else {
                        _prodState.descriptions.delete(id);
                        state = null;
                    }
                }
            }
            /* The native media projection's image URLs are signed for 5
               minutes (native-brief-media.mjs: expires_at ~285s out). An open
               but unchanged brief has no other trigger to re-read on, so a
               stale renderValue is dropped here -- at the moment of use, the
               same rule the scope gate above already follows -- and the
               state is marked stale so the next ensure (every detail render
               already calls it with force=false) re-fetches instead of
               silently keeping a cached response with expired signed URLs.
               Falling back to state.value (the untouched row.brief, always
               kept current by the fix above) means the worst case is the
               pre-existing behaviour: direct uploads.linear.app URLs. */
            if (state && state.renderValue && state.renderExpiresAt && Date.now() >= state.renderExpiresAt) {
                state.renderValue = '';
                state.renderExpiresAt = 0;
                if (state.status === 'ready' && !state.editing && !state.saving) {
                    state.status = 'stale';
                    state.refreshSilent = true;
                }
            }
            if (state) return state;
            const issue = _prodIssue(id);
            const hasValue = !!(issue && issue.descLoaded);
            const value = hasValue ? _prodDescriptionText(issue.desc) : '';
            state = {
                status: hasValue ? (_prodState.briefsLoaded ? 'ready' : 'stale') : 'idle',
                hasValue,
                value,
                baseline: value,
                draft: value,
                editing: false,
                preview: false,
                saving: false,
                refreshing: false,
                // Background revalidation is silent by default: the cached text
                // stays visible with no "Refreshing…" banner. Only the explicit
                // Refresh button (force=true) announces itself. Failures are
                // always loud via refreshError regardless of this flag.
                refreshSilent: true,
                refreshError: '',
                error: '',
                remoteChanged: false,
                requestId: '',
                uploading: 0,
                selectionStart: value.length,
                selectionEnd: value.length,
                /* The in-place editor (2026-09-06). `source` is the Markdown
                   textarea, offered as a toggle and taken automatically when
                   the visual editor cannot reproduce the text exactly;
                   `sourceReason` is the one-line explanation shown then. The
                   caret in the visual editor is (block, offset), which
                   survives the rebuild every render performs. */
                source: false,
                sourceReason: '',
                caretBlock: 0,
                caretOffset: 0,
                sourceUpdatedAt: issue ? issue.updatedRaw : '',
                /* Set only when a READ completes. A value seeded from the
                   projection above carries no stamp, because it did not come
                   from a scoped read -- it came from the row itself, and moves
                   with it. */
                scopeSignature: '',
                /* Native brief-media (2026-09-20): the read-only rendered
                   projection and when its signed image URLs expire. Never
                   the source for draft/baseline/save -- see the read path's
                   comment. */
                renderValue: '',
                renderExpiresAt: 0
            };
            _prodState.descriptions.set(id, state);
            return state;
        }
        function _prodNextDescriptionRequestToken(id) {
            id = String(id || '');
            const token = Number(_prodState.descriptionRequestTokens.get(id) || 0) + 1;
            _prodState.descriptionRequestTokens.set(id, token);
            return token;
        }
        function _prodInvalidateScopedReads() {
            /* THE PILLS STAY UP WHILE THEY RE-ASK (2026-09-05).
               The file-pill cache used to be cleared here outright, so every
               refresh -- and a tab return runs one -- took every sub-issue pill
               off the parent's list and put it back a second later when
               _prodEnsureBatchFiles answered again. Owner: "the open link
               button disappears and reappears ... two or three times". Only
               the per-generation STATUS is dropped now, which is what makes
               the next render of a parent re-ask; the entries themselves stay,
               each stamped with the batch row and the scope it was answered
               for, and _prodBatchFileFor refuses one whose row has since
               moved. Same shape as the asset states below: keep what is on
               screen, revalidate underneath, refuse at the moment of use. */
            _prodState.batchFilesStatus.clear();
            _prodState.assetRequestTokens.forEach((token, id) => {
                _prodState.assetRequestTokens.set(id, Number(token || 0) + 1);
            });
            _prodState.descriptionRequestTokens.forEach((token, id) => {
                _prodState.descriptionRequestTokens.set(id, Number(token || 0) + 1);
            });
            /* THIS NO LONGER DELETES, and that is the second half of the
               owner's 2026-08-31 report.

               Deleting meant the next render re-seeded from nothing, so every
               refresh -- and a tab return runs one -- walked the panel back
               through the skeleton before showing links that had not moved.
               "Almost always what's there is there," and it was.

               Keeping the last answer was tried once before and reverted,
               because `test/production-attachments.js` constructs a refresh
               across which a row changes client AND team. The held response is
               refused either way by the token bump above; what preserving
               values would have leaked is the previously DISPLAYED link, drawn
               on a row that now belongs to someone else. And no scope check
               HERE can prevent it -- this runs before the replacement
               projection is installed, so the old scope is the only one
               visible at this moment.

               The fix is to check at the moment the answer is knowable instead.
               Each completed read is stamped with the scope it was answered
               under, and _prodAssetState refuses a stamped value whose scope no
               longer matches the row. So the values survive a refresh that
               changes nothing -- the overwhelmingly common case, and the whole
               complaint -- and are dropped on sight for the row that actually
               moved. The description cache below has preserved values for
               longer than this one; it is now stamped and gated too, which it
               was not.

               Status goes to `idle` rather than staying `ready`, so
               _prodEnsureAssets still re-reads. The difference is only what is
               on screen while it does. */
            _prodState.assets.forEach((state, id) => {
                if (!state) {
                    _prodState.assets.delete(id);
                    return;
                }
                /* Preserve ONLY what the use-time gate can later refuse.
                   A completed state with no scope stamp is the dangerous
                   shape: the gate reads an absent stamp as "never read, so
                   nothing to refuse" and would draw it under whatever client
                   the row now belongs to. Every read path stamps, so this
                   should not arise -- but the rule is written as fail-safe
                   rather than as an assumption, because it was already wrong
                   once (the synthetic batch-parent branch, #1201 review).
                   An unstamped state is simply dropped, exactly as before.

                   A pending attachment write is preserved on its own terms:
                   _prodRefresh used to filter for those separately, one line
                   after calling this, which is what silently undid the whole
                   preservation on the real refresh path.

                   STAMPED, not COMPLETE (2026-09-05). The rule used to require
                   both, and that was the flicker the owner still saw after
                   the 2026-08-31 change. A tab return runs this TWICE -- once
                   from _prodRefresh to quarantine held responses, once from
                   _prodLoadData after the projection swap -- and any render
                   between the two starts a re-read, which sets `complete`
                   false while it is in flight. The second pass then met a
                   stamped, incomplete state, dropped it, and the next render
                   reseeded from nothing: skeleton, read, link, for a link that
                   had not moved. The stamp alone is what the use-time gate
                   needs; `complete` only says whether the LATEST read landed,
                   which has nothing to do with whether the values already on
                   screen are safe to keep showing. */
                const preservable = !!state.scopeSignature
                    || state.editing
                    || state.saving
                    || _prodState.writes.has(String(id || '') + ':attachment');
                if (!preservable) {
                    _prodState.assets.delete(id);
                    return;
                }
                state.status = 'idle';
                state.complete = false;
                state.error = '';
                state.remoteChanged = true;
                if (state.editing || state.saving) {
                    // An open editor's own row is being re-read under it; the
                    // server values go, the draft stays. Unchanged behaviour.
                    state.assets = _prodAssetDefaultEvidence(null);
                    state.scopeSignature = '';
                }
            });
            _prodState.descriptions.forEach((state, id) => {
                if (!state) {
                    _prodState.descriptions.delete(id);
                    return;
                }
                if (!state.editing && !state.saving) {
                    // Keep an already-loaded value visible across a projection
                    // swap instead of deleting it back to a skeleton: every tab
                    // return runs _prodLoadData -> this invalidation, and the
                    // deletion made the open issue description flash empty and
                    // refetch loudly on each visit. The request-token bump above
                    // still quarantines held old-scope responses, and the state
                    // is stale so the next render revalidates (silently) and
                    // adopts the server value. Valueless states have nothing to
                    // show and are dropped as before.
                    if (!state.hasValue) {
                        _prodState.descriptions.delete(id);
                        return;
                    }
                    state.refreshing = false;
                    state.status = 'stale';
                    state.refreshError = '';
                    state.refreshSilent = true;
                    state.requestId = '';
                    return;
                }
                state.refreshing = false;
                state.status = state.hasValue ? 'stale' : 'idle';
                state.refreshError = '';
                state.remoteChanged = true;
                state.requestId = '';
            });
            _prodState.linearRaw.clear();
        }
        function _prodMarkDescriptionsStale() {
            /* Including the batch-detail read states: a manual refresh is the
               retry for a batch description that failed to load, and leaving
               'error' behind would make that failure permanent for the session. */
            _prodInvalidateBatchDescriptionReads(null);
            _prodState.descriptions.forEach((state, id) => {
                if (!state || state.saving) return;
                _prodState.descriptionRequestTokens.set(id, Number(_prodState.descriptionRequestTokens.get(id) || 0) + 1);
                state.refreshing = false;
                state.refreshError = '';
                state.refreshSilent = true;
                state.status = state.hasValue ? 'stale' : 'idle';
            });
        }
        /* The batch twin of _prodSyncDescriptionRow.
           A synthetic parent has no deliverable row to write back into: its
           `desc` is derived from the BATCH each time _prodAdapter runs, so the
           optimistic value has to land on the batch or the next render paints
           the pre-save text over the one just typed. Resolved through the
           issue's own batchId rather than its node id, because a two-team batch
           mints a suffixed parent per team and only one of those strings is a
           real batch id. */
        function _prodSyncBatchDescriptionRow(id, value, updatedAt) {
            const issue = _prodIssue(id);
            const batchId = String(issue && issue.batchId || '');
            if (!batchId) return;
            const row = (_prodState.batches || []).find(item => String(item && item.id || '') === batchId);
            if (!row) return;
            row.description = value == null ? '' : String(value);
            if (updatedAt) row.updated_at = updatedAt;
            /* Every write to a batch row's description funnels through here --
               the optimistic pre-save value, the committed save, and both
               conflict restores -- so this is where an in-flight direct
               `?batch=` read is retired. Without it a read that started before
               a save lands after it and silently reverts the text the user just
               committed. The token only; the read state belongs to whoever is
               reading, and the row now carries a description anyway. */
            _prodNextBatchDescriptionToken(batchId);
            _prodState.adapter = null;
        }
        function _prodSyncDescriptionRow(id, value, updatedAt) {
            const row = (_prodState.deliverables || []).find(item => String(item && item.id || '') === String(id || ''));
            if (!row) return;
            row.brief = value;
            if (updatedAt) row.updated_at = updatedAt;
            _prodState.adapter = null;
        }
        function _prodAdoptDescriptionValue(id, value, updatedAt) {
            const state = _prodDescriptionState(id);
            if (!state) return null;
            const next = _prodDescriptionText(value);
            const previousBaseline = state.baseline;
            const cleanDraft = state.editing && state.draft === previousBaseline;
            state.value = next;
            state.baseline = next;
            state.hasValue = true;
            state.status = 'ready';
            state.refreshing = false;
            state.refreshError = '';
            state.sourceUpdatedAt = updatedAt || state.sourceUpdatedAt || '';
            if (state.editing) {
                if (cleanDraft) {
                    state.draft = next;
                    state.selectionStart = Math.min(state.selectionStart, next.length);
                    state.selectionEnd = Math.min(state.selectionEnd, next.length);
                    state.remoteChanged = false;
                    state.error = '';
                } else if (previousBaseline !== next) {
                    state.remoteChanged = true;
                    state.error = 'Description changed elsewhere. Your draft is preserved; review it against the refreshed version and save again.';
                    state.requestId = '';
                }
            } else {
                state.draft = next;
                state.remoteChanged = false;
                state.error = '';
            }
            return state;
        }
        function _prodCaptureDescriptionFocus(root) {
            const id = String(_prodState.openId || '');
            const state = id && _prodState.descriptions.get(id);
            if (!root || !state || !state.editing) return null;
            const panel = root.querySelector('[data-prod-description="' + CSS.escape(id) + '"]');
            const active = document.activeElement;
            if (!panel || !active || !panel.contains(active)) return null;
            const control = active.getAttribute && active.getAttribute('data-prod-description-control') || '';
            if (control === 'source') {
                state.selectionStart = Number.isFinite(active.selectionStart) ? active.selectionStart : state.selectionStart;
                state.selectionEnd = Number.isFinite(active.selectionEnd) ? active.selectionEnd : state.selectionEnd;
            }
            if (control === 'rich') _prodDescriptionRememberCaret(id, active);
            return { id, control };
        }
        /* FOCUS MUST NOT MOVE THE PAGE. Owner, 2026-09-06: "when I click edit
           and scroll down, it scrolls back up." Every render rebuilds the
           pane and puts focus and the caret back; Chrome reveals a restored
           caret by scrolling its container, so a reader who had scrolled past
           the editor was pulled back to the caret line on the next tick. The
           pane's offset is taken before the restore and put back after it. */
        function _prodDescriptionKeepScroll(fn) {
            const pane = document.querySelector('#prodRoot .prod-detail-main');
            const top = pane ? pane.scrollTop : 0;
            const x = window.scrollX;
            const y = window.scrollY;
            let out;
            try { out = fn(); } finally {
                if (pane && pane.scrollTop !== top) pane.scrollTop = top;
                if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
            }
            return out;
        }
        function _prodDescriptionRememberCaret(id, root) {
            const state = _prodDescriptionState(id);
            const caret = state && root ? _prodDescRichCaret(root) : null;
            if (!caret) return;
            state.caretBlock = caret.block;
            state.caretOffset = caret.offset;
        }
        function _prodDescriptionEditorControl(state) {
            return state && state.source ? 'source' : 'rich';
        }
        function _prodRestoreDescriptionFocus(snapshot) {
            if (!snapshot || !snapshot.id || !snapshot.control) return false;
            const panel = document.querySelector('[data-prod-description="' + CSS.escape(snapshot.id) + '"]');
            const target = panel && panel.querySelector('[data-prod-description-control="' + CSS.escape(snapshot.control) + '"]');
            if (!target) return false;
            try {
                _prodDescriptionKeepScroll(() => {
                    target.focus({ preventScroll: true });
                    const state = _prodState.descriptions.get(snapshot.id);
                    if (snapshot.control === 'source' && target.setSelectionRange) {
                        const start = Math.min(Number(state && state.selectionStart || 0), target.value.length);
                        const end = Math.min(Number(state && state.selectionEnd || start), target.value.length);
                        target.setSelectionRange(start, end);
                    }
                    if (snapshot.control === 'rich') _prodDescRichSetCaret(target, { block: state && state.caretBlock, offset: state && state.caretOffset });
                });
            } catch (e) { return false; }
            return document.activeElement === target;
        }
        /* FOCUS SURVIVES THE REBUILD -- for every control, not only the
           description editor.

           _prodRender replaces prodRoot.innerHTML wholesale, which destroys
           whatever the person was focused on: focus falls back to <body>, the
           caret disappears, and a keyboard user is dropped at the top of the
           tab. The description editor had a bespoke rescue for exactly this and
           nothing else did, so a background tick landing while someone was
           typing a folder link -- or tabbing across the asset rows -- silently
           took the focus away mid-keystroke.

           This fires constantly rather than rarely, which is why it is worth a
           general fix instead of a second special case. _prodRefreshAssetSurfaces
           IS _prodRender, and _prodEnsureAssets calls it on every status
           transition, so merely OPENING a row re-renders once on `loading` and
           again on `ready`. That is the "it still refreshes like two times in a
           row" the owner reports (2026-09-01): the READS are not duplicated --
           the ensure guard returns the cached state -- the RENDERS are, and each
           one was a focus loss. Owner: "for the UI experience, this should never
           bother anyone."

           The key is built from the identifying `data-prod-*` attributes on the
           element and its ancestors, so it survives a rebuild that produces
           equivalent-but-new nodes. Attributes describing transient CONDITION
           are deliberately excluded, and that exclusion is the load-bearing
           part: `data-prod-assets-status` flips loading -> ready across exactly
           the re-render this exists to survive, so a key containing it could
           never match on the far side. It would fail silently, restoring
           nothing, and look identical to having no fix at all. */
        /* The test for "volatile" is what the VALUE carries, not what the name
           reads like, and getting that backwards costs precision in both
           directions. `data-prod-pstatus` sounds like a condition and holds a
           CLIENT ID -- excluding it would drop the only thing identifying which
           project-status button was focused. `data-prod-disabled` likewise
           holds a control name ("composer", "bulk-<act>"), not a boolean.
           Meanwhile `data-prod-assets-status` really does hold loading/ready.
           So: the tooltip, whose text tracks the value it describes, plus the
           suffixes whose values are states. `-ready` is one of them, found by
           review on #1206: `data-prod-description-ready` flips 1 -> 0 when
           `_prodMarkDescriptionsStale()` runs, which is immediately BEFORE the
           very `_prodRender` this exists to survive, so the Description Edit
           button could never be restored. `-error` has no instance yet and is
           here on purpose -- this filter fails SILENTLY when it is too narrow,
           so a suffix that could only ever hold a condition is worth
           pre-empting rather than discovering. */
        const PROD_FOCUS_VOLATILE_ATTR = /^data-prod-tip$|-(state|status|freshness|error|ready)$/;
        function _prodFocusSelectorPart(node) {
            // An id is unique in the document, so it is the whole key by itself.
            if (node.id) return '#' + CSS.escape(node.id);
            const parts = [];
            const attrs = node.attributes || [];
            for (let i = 0; i < attrs.length; i++) {
                const name = attrs[i].name;
                if (name.indexOf('data-prod-') !== 0) continue;
                if (PROD_FOCUS_VOLATILE_ATTR.test(name)) continue;
                parts.push('[' + name + '="' + String(attrs[i].value).replace(/[\\"]/g, '\\$&') + '"]');
            }
            return parts.join('');
        }
        /* Most focusable controls in this tab carry no `data-prod-*` at all.
           `.prod-assets-refresh` has none, and `.prod-nav-btn` has only
           `data-prod-tip`, which the filter above drops. Identity attributes
           alone therefore covered a minority of the controls -- and worse than
           that, on `.prod-assets-refresh` the walk climbed past the button to
           its `[data-prod-assets]` SECTION and produced a key naming the
           ancestor. Restoring that focuses a <section>, not the button.
           Raised by review on #1206, which was right on both halves.

           So the key is anchored at the nearest node that HAS an identity, and
           the remaining steps down to the control are structural
           (`:nth-child`). With no identified ancestor anywhere the anchor is
           the root, which is stable because it is `prodRoot` itself.

           A structural step names a POSITION, not an element, so it can resolve
           to something else entirely if the rebuild changed shape. The shape
           check on restore is what makes that safe rather than a coin flip:
           tag plus the first class token, which is the component's own class
           (`prod-nav-btn`) while state classes like `active` are appended after
           it and are free to change across the very re-render being survived. */
        /* Tag and class are NOT enough on their own, and assuming they were is
           the sharpest thing review caught on #1206. Every comment lifecycle
           control is `<button class="prod-comment-action">` with no attribute
           distinguishing it -- only its onclick and its label differ. Resolving
           a comment during the 30-second refresh removes Reply and shifts Edit,
           Reopen and Delete up one, so a positional key lands on the old
           ordinal and a tag-plus-class check waves it through. Focus moves
           silently from Edit to Reopen and the next keypress performs the wrong
           lifecycle write.

           So the shape carries the accessible name too. It is the only
           discriminator these buttons have, and it is the right one: it is what
           the person thought they were focused on. A label that legitimately
           changed (Resolve -> Reopen on the same button) refuses the restore
           rather than taking it, which is correct -- that control now means
           something else. */
        function _prodFocusShape(el) {
            if (!el) return '';
            const first = String(el.className || '').trim().split(/\s+/)[0] || '';
            const label = String(
                (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title')))
                || el.textContent || ''
            ).replace(/\s+/g, ' ').trim().slice(0, 40);
            return String(el.tagName || '') + '.' + first + '#' + label;
        }
        function _prodFocusStructuralTail(el, anchor) {
            const steps = [];
            for (let node = el; node && node !== anchor; node = node.parentElement) {
                const parent = node.parentElement;
                if (!parent) return '';
                const index = Array.prototype.indexOf.call(parent.children, node) + 1;
                if (index < 1) return '';
                steps.unshift(':nth-child(' + index + ')');
            }
            return steps.join(' > ');
        }
        function _prodCaptureFocus(root) {
            const active = document.activeElement;
            if (!root || !active || active === root || !root.contains(active)) return null;
            const identity = [];
            let anchor = null;
            for (let node = active; node && node !== root; node = node.parentElement) {
                const part = _prodFocusSelectorPart(node);
                if (part) {
                    if (!anchor) anchor = node;
                    identity.unshift(part);
                    if (node.id) break;
                }
            }
            const tail = _prodFocusStructuralTail(active, anchor || root);
            let selector = '';
            if (anchor === active) selector = identity.join(' ');
            else if (anchor && tail) selector = identity.join(' ') + ' > ' + tail;
            else if (!anchor && tail) selector = ':scope > ' + tail;
            if (!selector) return null;
            const snapshot = { selector, shape: _prodFocusShape(active) };
            // Only text-ish controls report a caret; a number or checkbox reads
            // null here and is restored as plain focus, which is correct.
            if (typeof active.selectionStart === 'number') {
                snapshot.selectionStart = active.selectionStart;
                snapshot.selectionEnd = active.selectionEnd;
                snapshot.selectionDirection = active.selectionDirection || 'none';
            }
            return snapshot;
        }
        function _prodRestoreFocus(snapshot, root) {
            if (!snapshot || !snapshot.selector || !root) return false;
            let target = null;
            // A selector built from live attribute values can still be invalid
            // CSS if a value carried something exotic; a throw here must not
            // take the whole render down with it.
            try { target = root.querySelector(snapshot.selector); } catch (e) { return false; }
            if (!target || typeof target.focus !== 'function') return false;
            // The structural half of a key is a position. If the rebuild moved
            // things, this is a DIFFERENT control -- restore nothing rather
            // than put the caret somewhere the reader did not leave it.
            if (snapshot.shape && _prodFocusShape(target) !== snapshot.shape) return false;
            try {
                // preventScroll matters: restoring focus must not yank the pane
                // to the control, or the fix trades a focus jump for a scroll
                // jump and the reader is no better off.
                target.focus({ preventScroll: true });
                if (snapshot.selectionStart != null && typeof target.setSelectionRange === 'function') {
                    const length = String(target.value == null ? '' : target.value).length;
                    target.setSelectionRange(
                        Math.min(snapshot.selectionStart, length),
                        Math.min(snapshot.selectionEnd, length),
                        snapshot.selectionDirection
                    );
                }
            } catch (e) { return false; }
            return document.activeElement === target;
        }
        /* `options.point` is the click that opened the editor: the editing
           surface is laid out exactly like the read view, so the caret can be
           placed where the click landed. `options.link` is the index of a link
           whose hover card asked to edit it from the read view. */
        function _prodFocusDescriptionControl(id, control, options) {
            options = options || {};
            setTimeout(() => {
                const panel = document.querySelector('[data-prod-description="' + CSS.escape(String(id || '')) + '"]');
                const target = panel && panel.querySelector('[data-prod-description-control="' + CSS.escape(String(control || '')) + '"]');
                if (!target) return;
                try {
                    _prodDescriptionKeepScroll(() => {
                        target.focus({ preventScroll: true });
                        const state = _prodDescriptionState(id);
                        if (control === 'source' && target.setSelectionRange) {
                            const start = Math.min(Number(state && state.selectionStart || 0), target.value.length);
                            const end = Math.min(Number(state && state.selectionEnd || start), target.value.length);
                            target.setSelectionRange(start, end);
                        }
                        if (control === 'rich') {
                            let placed = false;
                            if (options.point && document.caretRangeFromPoint) {
                                const range = document.caretRangeFromPoint(options.point.x, options.point.y);
                                if (range && target.contains(range.startContainer)) {
                                    const selection = window.getSelection();
                                    selection.removeAllRanges();
                                    selection.addRange(range);
                                    placed = true;
                                }
                            }
                            if (!placed) _prodDescRichSetCaret(target, { block: state && state.caretBlock, offset: state && state.caretOffset });
                            _prodDescriptionRememberCaret(id, target);
                            if (Number.isInteger(options.link)) {
                                const anchor = target.querySelectorAll('a')[options.link];
                                if (anchor) _prodDescLinkPopShow(anchor, true);
                            }
                        }
                    });
                } catch (e) {}
            }, 0);
        }
        /* The ONE-row batch description read, in one place because two surfaces
           need it: the synthetic batch parent's panel (through
           _prodEnsureDescription) and the direct batch-detail view (through
           _prodEnsureBatchDescription). Both render from `_prodState.batches`,
           so both are fixed by writing the column back onto that row.

           The page size is 1000, not 1, and that is load-bearing rather than
           arbitrary: _prodRestRows only RETURNS when a page comes back shorter
           than the page size, so asking for 1 row with pageSize 1 fills the
           only page and falls out of the loop into
           `batches read exceeded pagination cap` -- an exact match throws
           instead of answering. Raised by Codex review on #1364, where it made
           every batch-parent description read fail. `id=eq.<uuid>` can return
           at most one row, so any size above 1 terminates; 1000 matches the
           sibling id-list read in _prodDeepLinkRowQuery rather than inventing a
           second convention. */
        async function _prodReadBatchDescriptionRow(batchId) {
            const rows = await _prodRestRows('batches', PROD_BATCH_DESCRIPTION_SELECT, 'id=eq.' + encodeURIComponent(batchId), 1000, 1);
            const row = Array.isArray(rows) ? rows.find(item => String(item && item.id || '') === String(batchId)) : null;
            if (!row) throw new Error('batch_description_read_failed');
            return row;
        }
        /* The direct batch-detail view (`?batch=<id>`, view 'batch') renders
           `batch.description` straight off the row and has no deliverable and
           no description state machine, so _prodEnsureDescription cannot serve
           it -- that one is reached only from view 'detail' with an openId.
           Without this the view sat on its loading skeleton forever once the
           column left the boot read. Raised by Codex review on #1364.

           Terminating, like _prodEnsureLabels: a row that HAS the column
           returns before the read, and a failed read is remembered, so the
           _prodRender -> ensure -> _prodRender cycle cannot spin. */
        function _prodNextBatchDescriptionToken(batchId) {
            const next = Number(_prodState.batchDescriptionTokens.get(batchId) || 0) + 1;
            _prodState.batchDescriptionTokens.set(batchId, next);
            return next;
        }
        /* Retire every in-flight direct-batch description read, so its answer
           can no longer land. `batchIds` null means all of them (the manual
           refresh); otherwise just the batches whose row the delta replaced.
           The token bump is the half that matters -- dropping the read state
           alone lets a NEW read start while the old one is still in the air,
           and then the older answer overwrites the newer text and its older
           stamp onto the row, which never refetches again because it now looks
           loaded. Tokens are only ever bumped, never cleared, so a token held
           across a reset cannot collide with a fresh one. */
        function _prodInvalidateBatchDescriptionReads(batchIds) {
            const targets = batchIds == null
                ? new Set([].concat(
                    Array.from(_prodState.batchDescriptionTokens.keys()),
                    Array.from(_prodState.batchDescriptionReads.keys())))
                : new Set((batchIds || []).map(id => String(id || '')).filter(Boolean));
            targets.forEach(batchId => {
                _prodNextBatchDescriptionToken(batchId);
                _prodState.batchDescriptionReads.delete(batchId);
                /* And the in-flight entry, or the next caller JOINS a read this
                   invalidation just retired -- whose answer the token check will
                   throw away, leaving the caller with nothing. Dropping it here
                   means the next caller starts a fresh read instead; the retired
                   promise still settles harmlessly against its stale token. */
                _prodState.batchDescriptionInFlight.delete(batchId);
            });
        }
        async function _prodEnsureBatchDescription(batchId, force) {
            batchId = String(batchId || '');
            if (!batchId) return;
            const row = (_prodState.batches || []).find(item => String(item && item.id || '') === batchId);
            if (!row) return;
            if (!force && _prodHasOwn(row, 'description')) return;
            /* A read already in the air is JOINED, not skipped. Returning here
               resumed the caller's `await` immediately, before the column
               existed -- so a second panel (the two synthetic parents of a
               split-team batch, or moving from `?batch=` to its parent mid-read)
               saw an absent column, called it a failure, and then refused to try
               again because its own error guard blocked it. Raised by Codex on
               #1364. */
            const inFlight = _prodState.batchDescriptionInFlight.get(batchId);
            if (inFlight) return inFlight;
            const readState = _prodState.batchDescriptionReads.get(batchId);
            if (!force && readState === 'error') return;
            _prodState.batchDescriptionReads.set(batchId, 'loading');
            const token = _prodNextBatchDescriptionToken(batchId);
            const generation = _prodState.projectionGeneration;
            /* Two different ways to stop being current, and they must be
               released differently.

               TOKEN MOVED: a newer read of this same batch owns the state entry
               now, so this one touches NOTHING. Deleting it here would either
               strand that read's 'loading' or invite a third read on top of the
               two already in the air.

               GENERATION MOVED ONLY: no newer read necessarily exists, so this
               read is still the owner and MUST release the entry -- leaving
               'loading' behind would wedge the batch out of ever loading again,
               because the guard above refuses to start a read while one is
               marked in flight. In today's code the full load that moves the
               generation always runs _prodMarkDescriptionsStale first, which
               clears the entry anyway; this does not depend on that ordering
               holding forever. */
            const tokenCurrent = () => token === _prodState.batchDescriptionTokens.get(batchId);
            const stillCurrent = () => tokenCurrent() && generation === _prodState.projectionGeneration;
            const release = () => { if (tokenCurrent()) _prodState.batchDescriptionReads.delete(batchId); };
            const run = (async () => {
            try {
                const fresh = await _prodReadBatchDescriptionRow(batchId);
                if (!stillCurrent()) { release(); return; }
                const live = (_prodState.batches || []).find(item => String(item && item.id || '') === batchId);
                if (!live) {
                    _prodState.batchDescriptionReads.delete(batchId);
                    return;
                }
                live.description = fresh.description == null ? '' : String(fresh.description);
                if (fresh.updated_at) live.updated_at = fresh.updated_at;
                _prodState.adapter = null;
                _prodState.batchDescriptionReads.set(batchId, 'ready');
            } catch (error) {
                if (!stillCurrent()) { release(); return; }
                _prodState.batchDescriptionReads.set(batchId, 'error');
            }
            /* Repaint ONLY when this batch's description is what the reader is
               looking at. Repainting unconditionally rebuilt the whole surface
               for a batch nobody had open -- and a rebuild replaces the
               contenteditable description editor, so it destroyed an in-progress
               edit on an UNRELATED row along with the caret and focus. Caught by
               the mocked browser gate on #1364, twice, at the step that hovers a
               link in a deliverable's editor and expects focus to come back:
               40e9dda passes that step in the same sandbox, this did not.
               The panel that delegated here does its own repaint afterwards, and
               a batch nobody is looking at needs none -- the state is written
               either way, and the next natural render picks it up. */
            const openIssue = _prodState.view === 'detail' && _prodState.openId
                ? _prodIssue(_prodOpenRowId())
                : null;
            const visible = (_prodState.view === 'batch' && String(_prodState.openBatchId || '') === batchId)
                || !!(openIssue && openIssue.syntheticBatchParent === true && String(openIssue.batchId || '') === batchId);
            /* NOT `_prodRenderWhenIdle`, and the browser gate is what says so.

               This repaint is the COMPLETION of a read this very panel asked
               for, not an unsolicited background tick. Routing it through the
               idle guard deferred it whenever a contenteditable was focused --
               which, for the description panel, is the ordinary state rather
               than the exception -- so the description never arrived and focus
               was never restored. `inplace_link` timed out twice here and
               passes on 43b1455; neutering the guard alone made it pass again,
               which is how this was narrowed to this one line.

               The rule the guard encodes is about UNSOLICITED repaints landing
               on a reader who is mid-interaction. A panel painting the answer
               it is waiting for is the interaction. */
            if (visible && document.getElementById('prodRoot')) _prodRender();
            })();
            _prodState.batchDescriptionInFlight.set(batchId, run);
            try { await run; }
            finally {
                /* Only if the map still holds THIS read. Deleting unconditionally
                   is the classic single-flight bug: an invalidated read A settles
                   after a fresh read B has stored its own promise, and A's
                   cleanup then evicts B -- so the next render sees no read in
                   flight, starts C, advances the token, and guarantees B's
                   perfectly good answer is thrown away. Longer loading and
                   redundant requests, from a line that looks like tidying up.
                   Raised by Codex on #1364. */
                if (_prodState.batchDescriptionInFlight.get(batchId) === run) {
                    _prodState.batchDescriptionInFlight.delete(batchId);
                }
            }
        }
        async function _prodEnsureDescription(id, force) {
            id = String(id || '');
            const issue = _prodIssue(id);
            const state = issue && _prodDescriptionState(id);
            if (!issue || !state || state.saving) return state || null;
            if (issue.syntheticBatchParent === true) {
                /* ONE OWNER for a batch description, and this panel is not it.

                   Until 2026-09-09 this branch ran its own read beside
                   `_prodEnsureBatchDescription`: two readers of the same batch
                   row, cooperating through a shared token across two state
                   maps. Codex found four separate defects in that arrangement
                   over three review rounds (#1364) -- an older answer landing on
                   a newer one, a save silently reverted by a read that started
                   before it, a displaced reader stranding its own panel, and a
                   displaced reader stranding the OTHER reader's shared entry --
                   and each fix created the conditions for the next. The
                   arrangement was the defect; the fixes were symptoms.

                   So the read moved to a single owner keyed by BATCH id, and
                   this panel now waits for it and reflects the row. There is one
                   token, one read state, one place that writes the column. The
                   whole class of "which reader owns this entry" question is
                   gone rather than answered again.

                   What stays here is the part that is genuinely per-PANEL: a
                   split-team batch has two synthetic parents sharing one
                   batchId, and each has its own editor state, caret and scope.
                   Those still need their own token and their own release. */
                const batchId = String(issue.batchId || '');
                /* Reconcile from the ROW before honouring a remembered failure.

                   The two synthetic parents of a split-team batch keep separate
                   panel states over one shared row. If the shared read fails,
                   both remember 'error'; when the reader retries from one of
                   them the row is populated, but the sibling's own 'error' made
                   the guard below return before it ever looked at the row -- so
                   it kept saying "Description could not load." until it was
                   retried separately or a full refresh cleared it. Raised by
                   Codex on #1364.

                   Scoped to a panel that is actually showing nothing (an error,
                   or no value yet) so a loaded panel is not re-adopted on every
                   render, and idempotent: adopting sets 'ready' and hasValue, so
                   this cannot re-enter. */
                if (batchId && (state.status === 'error' || !state.hasValue)) {
                    const loadedRow = (_prodState.batches || []).find(item => String(item && item.id || '') === batchId);
                    if (loadedRow && _prodHasOwn(loadedRow, 'description')) {
                        _prodAdoptDescriptionValue(id, loadedRow.description, loadedRow.updated_at);
                        const reconciled = _prodState.descriptions.get(id);
                        if (reconciled) reconciled.scopeSignature = _prodIssueScopeSignature(issue);
                        if (document.getElementById('prodRoot') && _prodState.openId === id) _prodRender();
                        return state;
                    }
                }
                if (!force && (state.status === 'ready' || state.refreshing || state.status === 'error')) return state;
                if (!batchId) {
                    state.refreshing = false;
                    state.status = state.hasValue ? 'ready' : 'error';
                    if (!state.hasValue) state.error = 'Description could not load.';
                    return state;
                }
                const panelToken = _prodNextDescriptionRequestToken(id);
                const panelGeneration = _prodState.projectionGeneration;
                const panelScope = _prodIssueScopeSignature(issue);
                const panelStillCurrent = () => {
                    const live = _prodIssue(id);
                    return panelToken === _prodState.descriptionRequestTokens.get(id)
                        && panelGeneration === _prodState.projectionGeneration
                        && !!live && String(live.batchId || '') === batchId
                        && _prodIssueScopeSignature(live) === panelScope;
                };
                state.refreshing = true;
                state.refreshError = '';
                state.refreshSilent = !force;
                state.status = state.hasValue ? 'stale' : 'loading';
                if (document.getElementById('prodRoot') && _prodState.openId === id) _prodRender();
                // The owner reads, guards and records. It never throws.
                await _prodEnsureBatchDescription(batchId, force);
                if (!panelStillCurrent()) {
                    /* Release THIS panel only. The owner holds the shared read
                       state and releases it on its own exits, which is why a
                       synthetic parent replaced mid-read by a real one can no
                       longer strand it. */
                    state.refreshing = false;
                    state.refreshError = '';
                    state.status = state.hasValue ? 'stale' : 'idle';
                    return null;
                }
                const batchRow = (_prodState.batches || []).find(item => String(item && item.id || '') === batchId);
                if (batchRow && _prodHasOwn(batchRow, 'description')) {
                    _prodAdoptDescriptionValue(id, batchRow.description, batchRow.updated_at);
                    const adoptedBatch = _prodState.descriptions.get(id);
                    if (adoptedBatch) adoptedBatch.scopeSignature = panelScope;
                } else if (_prodState.batchDescriptionReads.get(batchId) === 'error') {
                    state.refreshing = false;
                    if (state.hasValue) {
                        state.status = 'stale';
                        state.refreshError = 'Description could not refresh. The text shown may be outdated.';
                    } else {
                        state.status = 'error';
                        state.error = 'Description could not load.';
                    }
                } else {
                    /* No column yet and no recorded failure: the read was retired
                       (an invalidation, a moved generation) rather than failed.
                       'idle' rather than 'error' on purpose -- the guard at the
                       top of this function blocks a retry on 'error', so calling
                       a not-yet-loaded description a failure wedges the panel
                       until a manual refresh. This leaves the next render free to
                       ask again. */
                    state.refreshing = false;
                    state.refreshError = '';
                    state.status = state.hasValue ? 'stale' : 'idle';
                }
                if (document.getElementById('prodRoot') && _prodState.openId === id) _prodRender();
                return state;
            }
            if (!force && (state.status === 'ready' || state.refreshing || state.status === 'error' || state.refreshError)) return state;
            const staffIdentity = _syncviewStaffIdentityForHeaders();
            if (!staffIdentity) {
                state.refreshing = false;
                state.status = state.hasValue ? 'stale' : 'error';
                state.error = state.hasValue ? state.error : 'Staff sign-in is required to load this description.';
                state.refreshError = state.hasValue ? 'Staff sign-in is required to refresh this description.' : '';
                if (document.getElementById('prodRoot') && _prodState.openId === id) _prodRender();
                return null;
            }
            const clientSlug = String(issue.authorityProject || issue.storedClientSlug || issue.project || '').trim();
            const issueTeam = _prodWriteTeam(issue.team);
            const projectionGeneration = _prodState.projectionGeneration;
            const verificationEpoch = _syncviewStaffVerificationEpoch;
            const identitySignature = _syncviewStaffIdentitySignature(staffIdentity);
            const requestToken = _prodNextDescriptionRequestToken(id);
            const scopeSignature = _prodIssueScopeSignature(issue);
            const requestStillCurrent = () => {
                const liveIssue = _prodIssue(id);
                return requestToken === _prodState.descriptionRequestTokens.get(id)
                    && projectionGeneration === _prodState.projectionGeneration
                    && verificationEpoch === _syncviewStaffVerificationEpoch
                    && identitySignature === _syncviewStaffIdentitySignature(_syncviewStaffIdentityForHeaders())
                    && !!liveIssue
                    && _prodIssueScopeSignature(liveIssue) === scopeSignature;
            };
            state.refreshing = true;
            state.refreshError = '';
            state.refreshSilent = !force;
            if (state.hasValue) state.status = 'stale';
            else state.status = 'loading';
            if (document.getElementById('prodRoot') && _prodState.openId === id) _prodRender();
            try {
                const response = await fetch(PROD_WRITE_EF_URL, {
                    method: 'POST',
                    cache: 'no-store',
                    headers: _syncviewEfHeaders({
                        apikey: CAL_SUPABASE_ANON_KEY,
                        Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY,
                        Accept: 'application/json',
                        'Content-Type': 'application/json'
                    }, PROD_WRITE_EF_URL),
                    body: JSON.stringify({
                        action: 'description_read',
                        surface: 'production',
                        id,
                        client_slug: clientSlug
                    })
                });
                const json = await response.json().catch(() => ({}));
                if (!requestStillCurrent()) return null;
                const row = json && json.row;
                if (!response.ok || !json || json.ok !== true || json.complete !== true
                    || !row
                    || String(row.id || '') !== id
                    || String(row.client_slug || '').trim() !== clientSlug
                    || _prodWriteTeam(row.team) !== issueTeam) {
                    throw new Error(String(json && json.error || 'description_read_failed'));
                }
                /* The native `media` projection is a READ-ONLY rendering aid,
                   never the canonical text: `render_brief` rewrites image
                   references to short-lived (5-minute) signed storage URLs,
                   and row.brief -- the value _prodSyncDescriptionRow and
                   _prodAdoptDescriptionValue seed the editable draft/baseline
                   from -- stays the untouched server brief so an unrelated
                   edit can never persist an expiring signed URL over the
                   original Linear-hosted one. The projection is attached
                   separately, below, as state.renderValue -- read only by the
                   display line, never by _prodBeginDescriptionEdit or
                   _prodSaveDescription. */
                _prodSyncDescriptionRow(id, row.brief, row.updated_at);
                _prodAdoptDescriptionValue(id, row.brief, row.updated_at);
                const media = json && json.media;
                const renderBrief = (media && media.complete === true && typeof media.render_brief === 'string')
                    ? media.render_brief
                    : '';
                const renderExpiresAt = renderBrief && media && typeof media.expires_at === 'string'
                    ? Date.parse(media.expires_at) || 0
                    : 0;
                /* The scope this text is true for; _prodDescriptionState
                   refuses to draw it if the row leaves that scope.

                   Read back out of the map rather than stamping the `state`
                   captured before the await, and NOT through
                   _prodDescriptionState: _prodAdoptDescriptionValue writes
                   through its own lookup, so the object it just populated is
                   not necessarily the one captured here -- and stamping the
                   wrong one would leave the displayed value UNSTAMPED, which
                   is precisely the value the gate can never refuse. Going
                   through the accessor would be worse still: it runs the gate,
                   and a state carrying an older scope's stamp would have the
                   text just adopted wiped back out. */
                const adopted = _prodState.descriptions.get(id);
                if (adopted) {
                    adopted.scopeSignature = scopeSignature;
                    // Display-only: never read by the editable draft/baseline
                    // or by the save payload -- see the comment above.
                    adopted.renderValue = renderBrief;
                    adopted.renderExpiresAt = renderExpiresAt;
                }
                if (document.getElementById('prodRoot') && _prodState.openId === id) _prodRender();
                return state;
            } catch (error) {
                if (!requestStillCurrent()) return null;
                state.refreshing = false;
                if (state.hasValue) {
                    state.status = 'stale';
                    state.refreshError = 'Description could not refresh. The text shown may be outdated.';
                } else {
                    state.status = 'error';
                    state.error = 'Description could not load.';
                }
                if (document.getElementById('prodRoot') && _prodState.openId === id) _prodRender();
                return null;
            }
        }
        function _prodDescriptionRememberSelection(id, input) {
            const state = _prodDescriptionState(id);
            if (!state || !input) return;
            state.selectionStart = Number.isFinite(input.selectionStart) ? input.selectionStart : state.selectionStart;
            state.selectionEnd = Number.isFinite(input.selectionEnd) ? input.selectionEnd : state.selectionEnd;
        }
        function _prodDescriptionDraftInput(id, value, input) {
            const state = _prodDescriptionState(id);
            if (!state || state.saving) return;
            value = String(value == null ? '' : value);
            if (state.draft !== value) state.requestId = '';
            state.draft = value;
            state.error = state.remoteChanged
                ? 'Description changed elsewhere. Your draft is preserved; review it against the refreshed version and save again.'
                : '';
            _prodDescriptionRememberSelection(id, input);
            const panel = input && input.closest('[data-prod-description]');
            const counter = panel && panel.querySelector('[data-prod-description-count]');
            const save = panel && panel.querySelector('[data-prod-description-control="save"]');
            if (counter) {
                counter.textContent = value.length.toLocaleString() + ' / 100,000';
                counter.classList.toggle('is-invalid', value.length > 100000);
                counter.classList.toggle('is-quiet', counter.hasAttribute('data-prod-description-count-quiet') && value.length < 90000);
            }
            /* Both paths that touch this button must agree: an upload in
               flight keeps it shut whatever the count says (Codex on #1310,
               round nine). */
            if (save) save.disabled = value.length > 100000 || state.uploading > 0;
            const error = panel && panel.querySelector('[data-prod-description-write-error]');
            if (error && !state.remoteChanged) error.remove();
        }
        function _prodBeginDescriptionEdit(id, options) {
            options = options || {};
            const issue = _prodIssue(id);
            const state = issue && _prodDescriptionState(id);
            if (!issue || !state) return false;
            if (!_prodCanWrite(issue, _prodDescriptionOperation(issue))) {
                _prodToast(_prodWriteGateText(issue, _prodDescriptionOperation(issue)));
                return false;
            }
            if (state.status !== 'ready' || state.refreshing) {
                // Not "press Refresh" any more -- that control is gone, and
                // the next line already performs the read it was asking for.
                _prodToast('Loading the current description…');
                _prodEnsureDescription(id, true);
                return false;
            }
            state.editing = true;
            state.preview = false;
            state.saving = false;
            state.draft = state.value;
            state.baseline = state.value;
            state.error = '';
            state.refreshError = '';
            state.remoteChanged = false;
            state.requestId = '';
            state.selectionStart = state.draft.length;
            state.selectionEnd = state.draft.length;
            /* In place, in its rendered form, unless the text cannot come
               back out of the visual editor byte for byte. Then it opens as
               Markdown and says why, because silently normalising a
               description that Linear mirrors is worse than a textarea. */
            state.source = !_prodDescRichRoundTrips(state.draft);
            state.sourceReason = state.source ? 'This description uses Markdown the visual editor cannot keep exactly, so it opened as Markdown.' : '';
            state.caretBlock = state.draft.split('\n').length - 1;
            state.caretOffset = 1e9;
            _prodRender();
            _prodFocusDescriptionControl(id, _prodDescriptionEditorControl(state), options);
            return false;
        }
        /* The read view is the editor: a click on the text starts editing
           with the caret where the click landed. Links and images keep their
           own click. */
        function _prodDescriptionBodyClick(event, id) {
            const target = event && event.target;
            if (target && target.closest && target.closest('a, img, button')) return true;
            const selection = window.getSelection && window.getSelection();
            if (selection && !selection.isCollapsed) return true;
            _prodBeginDescriptionEdit(id, { point: { x: event.clientX, y: event.clientY } });
            return false;
        }
        /* Markdown ⇄ visual. The visual side is refused, with the reason on
           screen, when the current draft would not survive the trip. */
        function _prodSetDescriptionMode(id, mode) {
            const state = _prodDescriptionState(id);
            if (!state || !state.editing || state.saving) return false;
            const toSource = mode === 'source';
            if (!toSource && !_prodDescRichRoundTrips(state.draft)) {
                state.sourceReason = 'This Markdown cannot be shown exactly in the visual editor. Keep editing it as Markdown.';
                _prodRender();
                _prodFocusDescriptionControl(id, 'source');
                return false;
            }
            /* Carry the caret across: a Markdown offset becomes (line, column)
               and back, which is exact for plain text and close enough where
               markup differs. */
            const draft = String(state.draft || '');
            if (toSource && !state.source) {
                const lines = draft.split('\n');
                const block = Math.min(Math.max(0, state.caretBlock || 0), lines.length - 1);
                const column = Math.min(Number(state.caretOffset) || 0, lines[block].length);
                const offset = lines.slice(0, block).reduce((n, line) => n + line.length + 1, 0) + column;
                state.selectionStart = offset;
                state.selectionEnd = offset;
            } else if (!toSource && state.source) {
                const before = draft.slice(0, Math.min(Number(state.selectionStart) || 0, draft.length));
                const parts = before.split('\n');
                state.caretBlock = parts.length - 1;
                state.caretOffset = parts[parts.length - 1].length;
            }
            state.source = toSource;
            state.sourceReason = '';
            state.preview = false;
            _prodRender();
            _prodFocusDescriptionControl(id, _prodDescriptionEditorControl(state));
            return false;
        }
        function _prodCancelDescriptionEdit(id) {
            const state = _prodDescriptionState(id);
            if (!state || state.saving) return false;
            state.editing = false;
            state.preview = false;
            state.source = false;
            state.sourceReason = '';
            state.draft = state.value;
            state.error = '';
            state.remoteChanged = false;
            state.requestId = '';
            _prodDescLinkPopHide(true);
            _prodRender();
            _prodFocusDescriptionControl(id, 'edit');
            return false;
        }
        /* Everything the visual editor does between keystrokes: the typing
           shortcuts, the DOM tidy, and the Markdown the draft is made of. */
        function _prodDescriptionRichInput(id, root) {
            const state = _prodDescriptionState(id);
            if (!state || !root || state.saving) return false;
            _prodDescRichShortcut(root);
            _prodDescRichNormalize(root);
            _prodDescriptionRememberCaret(id, root);
            _prodDescriptionDraftInput(id, _prodDescRichSerialize(root), root);
            return true;
        }
        /* Rebuild the editor from its own Markdown, caret kept: after a paste
           this is what turns pasted `- item` and `[label](url)` text into the
           shapes they mean. */
        function _prodDescriptionRichRebuild(id, root) {
            const state = _prodDescriptionState(id);
            if (!state || !root) return false;
            const caret = _prodDescRichCaret(root) || { block: state.caretBlock, offset: state.caretOffset };
            root.innerHTML = _prodDescRichBuild(state.draft);
            _prodDescRichNormalize(root);
            _prodDescRichSetCaret(root, caret);
            _prodDescriptionRememberCaret(id, root);
            return true;
        }
        function _prodDescriptionRichRoot(id) {
            const panel = document.querySelector('[data-prod-description="' + CSS.escape(String(id || '')) + '"]');
            return panel && panel.querySelector('[data-prod-description-control="rich"]') || null;
        }
        function _prodDescriptionEditorKeydown(event, id) {
            const root = event && event.currentTarget;
            if (root && root.getAttribute && root.getAttribute('data-prod-description-control') === 'rich') {
                if ((event.ctrlKey || event.metaKey) && String(event.key || '').toLowerCase() === 'k') {
                    event.preventDefault();
                    event.stopPropagation();
                    const anchor = _prodDescRichAnchorAtCaret(root) || _prodDescRichMakeLink(root, '', '');
                    if (anchor) _prodDescLinkPopShow(anchor, true);
                    return false;
                }
                if (event.key !== 'Escape' && !((event.ctrlKey || event.metaKey) && event.key === 'Enter') && _prodDescRichKeydown(event, root)) {
                    _prodDescriptionRichInput(id, root);
                    return false;
                }
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                _prodCancelDescriptionEdit(id);
                return false;
            }
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                _prodSaveDescription(event, id);
                return false;
            }
            return true;
        }
        /* ---- In-place description editor (2026-09-06) --------------------------
           Owner: "when we click edit it shouldn't change the way we are viewing
           things ... like linear ... links ... we shouldn't see those weird brackets
           ... when we paste an image we should just see the actual image."

           The editing surface IS the rendered surface: a contenteditable built from
           the Markdown with the same classes the read view uses, one block per source
           line, and a serializer that walks it back to Markdown. Every block and every
           inline mark carries the exact source form it came from (`data-md`,
           `data-md-prefix`, `data-md-raw`), so an untouched description serializes
           byte-for-byte to what was loaded. _prodDescRichRoundTrips() proves that before
           the editor is offered; a description it cannot keep opens in Markdown.

           No library. The block model is deliberately small: paragraph, heading,
           bullet, rule. Inline: bold, italic, code, link (three source forms), image,
           and the upload placeholder. Anything else is text and stays text. */
        const PROD_DESC_RICH_PLACEHOLDER_RE = /!\[Uploading image (\d+)…\]\(\)/;
        const PROD_DESC_RICH_BLOCK_TYPES = ['p', 'h', 'ul', 'hr'];
        function _prodDescRichAttr(s) {
          return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').split('"').join('&quot;');
        }
        // PORT-DELTA: B2 keeps `syncview-media:<occurrence id>` stored-image references as an atomic chip (artifact has no stored-media form).
        function _prodDescRichInline(s) {
          s = _prodDescRichAttr(s);
          const st = [];
          const keep = h => { st.push(h); return 'XMDTOK' + (st.length - 1) + 'ENDMDTOK'; };
          /* Marker attributes carry no `*` or `_`, so the bold and italic passes
             below cannot match inside a tag they already produced. */
          const label = l => String(l || '')
            .replace(/^\*\*([^*]+)\*\*$/, '<strong data-md="bb">$1</strong>')
            .replace(/^__([^_]+)__$/, '<strong data-md="uu">$1</strong>')
            .replace(/^`([^`]+)`$/, '<code>$1</code>');
          const anchor = (l, u, form) => '<a href="' + u + '" data-md="' + form + '" target="_blank" rel="noopener noreferrer">' + (form === 'bare' ? u : label(l)) + '</a>';
          const image = (l, u, form) => '<img class="prod-desc-image" src="' + u + '" alt="' + l + '" data-md="' + form + '" loading="lazy" decoding="async" referrerpolicy="no-referrer">';
          const placeholder = n => '<span class="prod-desc-uploading" data-md-placeholder="' + n + '" contenteditable="false">Uploading image…</span>';
          const trimLinkTail = u => {
            let suffix = '';
            while (u) {
              if (u.endsWith('**')) { suffix = '**' + suffix; u = u.slice(0, -2); }
              else if (u.endsWith('*')) { suffix = '*' + suffix; u = u.slice(0, -1); }
              else if (u.endsWith('&gt;')) { suffix = '&gt;' + suffix; u = u.slice(0, -4); }
              else if (/[)\].,!?;]$/.test(u)) { suffix = u.slice(-1) + suffix; u = u.slice(0, -1); }
              else break;
            }
            return { url: u, suffix };
          };
          s = s.replace(/`([^`]+)`/g, (m, c) => keep('<code>' + c + '</code>'));
          s = s.replace(/!\[Uploading image (\d+)…\]\(\)/g, (m, n) => keep(placeholder(n)));
          /* B2: a stored-image reference is kept as an atomic chip that
             serializes back to its exact source (form + alt + id), so editing
             around it never loses or alters the reference. No <img>: the id
             is not a URL and the editor never signs anything. */
          s = s.replace(/!\[([^\]]*)\]\((&lt;)?syncview-media:([0-9a-f-]{36})(&gt;)?\)/g, (m, l, lt, id, gt) => (!!lt !== !!gt) ? m
            : keep('<span class="prod-desc-media-ref" data-md-media="' + id + '" data-md-media-form="' + (lt ? 'angle' : 'plain') + '" data-md-media-alt="' + l + '" contenteditable="false">Stored image' + (l.trim() ? ': ' + l : '') + '</span>'));
          s = s.replace(/!\[([^\]]*)\]\(&lt;(https:\/\/.*?)&gt;\)/g, (m, l, u) => keep(image(l, u, 'angle')));
          s = s.replace(/!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)/g, (m, l, u) => keep(image(l, u, 'plain')));
          s = s.replace(/\[([^\]]+)\]\(&lt;(https?:\/\/.*?)&gt;\)/g, (m, l, u) => keep(anchor(l, u, 'angle')));
          s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, l, u) => keep(anchor(l, u, 'named')));
          s = s.replace(/(https?:\/\/[^\s<]+)/g, (m, u) => { const out = trimLinkTail(u); return keep(anchor(out.url, out.url, 'bare')) + out.suffix; });
          s = s.replace(/\*\*([^*]+)\*\*/g, '<strong data-md="bb">$1</strong>');
          s = s.replace(/\*([^*\n]+)\*/g, '<em data-md="s">$1</em>');
          s = s.replace(/(^|\s)__([^_]+)__(?=\s|$|[.,!?])/g, '$1<strong data-md="uu">$2</strong>');
          s = s.replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,!?])/g, '$1<em data-md="u">$2</em>');
          return s.replace(/XMDTOK(\d+)ENDMDTOK/g, (m, i) => st[+i]);
        }
        function _prodDescRichBlockHTML(kind, prefix, inner, raw) {
          if (kind === 'hr') return '<div class="prod-md-hr" data-md="hr" data-md-raw="' + _prodDescRichAttr(raw || '---') + '" contenteditable="false"><hr class="prod-md-rule"></div>';
          const body = inner || '<br>';
          if (kind === 'h') return '<div class="prod-md-heading" data-md="h" data-md-prefix="' + _prodDescRichAttr(prefix || '# ') + '">' + body + '</div>';
          if (kind === 'ul') return '<div class="prod-md-bullet" data-md="ul" data-md-prefix="' + _prodDescRichAttr(prefix || '- ') + '"><span class="prod-md-bullet-mark" contenteditable="false">•</span><span class="prod-md-bullet-text">' + body + '</span></div>';
          return '<div class="prod-md-p" data-md="p"' + (raw ? ' data-md-raw="' + _prodDescRichAttr(raw) + '"' : '') + '>' + body + '</div>';
        }
        function _prodDescRichBuild(markdown) {
          const lines = String(markdown == null ? '' : markdown).replace(/\r\n?/g, '\n').split('\n');
          const blocks = lines.map(line => {
            let m;
            if (!line.trim()) return { kind: 'blank', html: _prodDescRichBlockHTML('p', '', '', line) };
            if ((m = /^(-{3,})\s*$/.exec(line))) return { kind: 'hr', html: _prodDescRichBlockHTML('hr', '', '', line) };
            if ((m = /^(#{1,4}\s+)(.*)$/.exec(line))) return { kind: 'h', html: _prodDescRichBlockHTML('h', m[1], _prodDescRichInline(m[2])) };
            if ((m = /^([-*]\s+)(.*)$/.exec(line))) return { kind: 'ul', html: _prodDescRichBlockHTML('ul', m[1], _prodDescRichInline(m[2])) };
            return { kind: 'p', html: _prodDescRichBlockHTML('p', '', _prodDescRichInline(line)) };
          });
          /* The read view draws no blank line beside a heading or rule. The editor
             keeps every line in the model and collapses those on screen, so the
             first paint already sits exactly where the read view sat. */
          const blockish = b => !!b && (b.kind === 'h' || b.kind === 'hr');
          return blocks.map((b, i) => (b.kind === 'blank' && (blockish(blocks[i - 1]) || blockish(blocks[i + 1])))
            ? b.html.replace('class="prod-md-p"', 'class="prod-md-p prod-md-gap"')
            : b.html).join('');
        }
        function _prodDescRichContainer(block) {
          if (!block) return null;
          if (block.getAttribute('data-md') === 'ul') return block.querySelector('.prod-md-bullet-text') || block;
          return block;
        }
        // PORT-DELTA: B2 keeps `syncview-media:<occurrence id>` stored-image references as an atomic chip (artifact has no stored-media form).
        function _prodDescRichSerializeInline(el) {
          let out = '';
          Array.from(el.childNodes).forEach(n => {
            if (n.nodeType === 3) { out += n.nodeValue; return; }
            if (n.nodeType !== 1) return;
            const tag = n.tagName;
            if (tag === 'BR') return;
            if (tag === 'IMG') {
              const alt = n.getAttribute('alt') || '';
              const src = n.getAttribute('src') || '';
              out += n.getAttribute('data-md') === 'angle' ? '![' + alt + '](<' + src + '>)' : '![' + alt + '](' + src + ')';
              return;
            }
            if (n.hasAttribute('data-md-media')) {
              const id = n.getAttribute('data-md-media') || '', alt = n.getAttribute('data-md-media-alt') || '';
              out += n.getAttribute('data-md-media-form') === 'angle' ? '![' + alt + '](<syncview-media:' + id + '>)' : '![' + alt + '](syncview-media:' + id + ')';
              return;
            }
            if (n.hasAttribute('data-md-placeholder')) { out += '![Uploading image ' + n.getAttribute('data-md-placeholder') + '…]()'; return; }
            if (n.classList && n.classList.contains('prod-md-bullet-mark')) return;
            const inner = _prodDescRichSerializeInline(n);
            if (tag === 'A') {
              const href = n.getAttribute('href') || '';
              const form = n.getAttribute('data-md') || 'named';
              /* A URL with whitespace or a `)` in it, or one ending in the
                 punctuation a bare link sheds, cannot survive the plain forms: it
                 goes out as `[label](<url>)`, which the parser reads back exactly
                 (Codex on #1310's follow-up, #1320). */
              const fragile = /[\s)]/.test(href) || /[)\].,!?;*]$/.test(href);
              if (form === 'bare' && inner === href && !fragile) { out += href; return; }
              if (form === 'angle' || fragile) { out += '[' + (inner || href) + '](<' + href + '>)'; return; }
              out += '[' + (inner || href) + '](' + href + ')';
              return;
            }
            if (tag === 'STRONG' || tag === 'B') { const mk = n.getAttribute('data-md') === 'uu' ? '__' : '**'; out += inner ? mk + inner + mk : ''; return; }
            if (tag === 'EM' || tag === 'I') { const mk = n.getAttribute('data-md') === 'u' ? '_' : '*'; out += inner ? mk + inner + mk : ''; return; }
            if (tag === 'CODE') { out += inner ? '`' + inner + '`' : ''; return; }
            out += inner;
          });
          return out;
        }
        function _prodDescRichSerialize(root) {
          const lines = [];
          Array.from(root.childNodes).forEach(node => {
            if (node.nodeType !== 1) { const t = String(node.textContent || ''); if (t.trim()) lines.push(t); return; }
            const kind = node.getAttribute('data-md') || 'p';
            if (kind === 'hr') { lines.push(node.getAttribute('data-md-raw') || '---'); return; }
            const inline = _prodDescRichSerializeInline(_prodDescRichContainer(node));
            if (kind === 'h') { lines.push((node.getAttribute('data-md-prefix') || '# ') + inline); return; }
            if (kind === 'ul') { lines.push((node.getAttribute('data-md-prefix') || '- ') + inline); return; }
            lines.push(inline || node.getAttribute('data-md-raw') || '');
          });
          return lines.join('\n');
        }
        /* The one honesty check: can this Markdown come back out unchanged? */
        function _prodDescRichRoundTrips(markdown) {
          const source = String(markdown == null ? '' : markdown).replace(/\r\n?/g, '\n');
          const probe = document.createElement('div');
          probe.innerHTML = _prodDescRichBuild(source);
          return _prodDescRichSerialize(probe) === source;
        }
        function _prodDescRichBlockOf(root, node) {
          while (node && node !== root) {
            if (node.parentNode === root) return node.nodeType === 1 ? node : null;
            node = node.parentNode;
          }
          return null;
        }
        function _prodDescRichMakeBlock(kind, prefix) {
          const host = document.createElement('div');
          host.innerHTML = _prodDescRichBlockHTML(kind, prefix, '', '');
          return host.firstChild;
        }
        // PORT-DELTA: B2 keeps `syncview-media:<occurrence id>` stored-image references as an atomic chip (artifact has no stored-media form).
        function _prodDescRichIsEmpty(container) {
          if (!container) return true;
          if (container.querySelector && container.querySelector('img,[data-md-placeholder],[data-md-media]')) return false;
          return !String(container.textContent || '').length;
        }
        /* An empty container must hold exactly one <br>: an empty text node left
           behind by a split gives the caret nowhere to be, and Chrome then drops it
           to the start of the editable root on the next key. */
        function _prodDescRichSettle(container) {
          if (!container) return;
          if (_prodDescRichIsEmpty(container)) {
            Array.from(container.childNodes).forEach(n => { if (!(n.nodeType === 1 && n.tagName === 'BR')) n.remove(); });
            if (!container.firstChild) container.appendChild(document.createElement('br'));
            while (container.childNodes.length > 1) container.lastChild.remove();
            return;
          }
          Array.from(container.childNodes).forEach(n => { if (n.nodeType === 3 && !n.nodeValue) n.remove(); });
        }
        /* Browser edits leave <b>, <i>, styled spans, nested divs and stray <br>s
           behind. Fold every one of them back into the block model so the serializer
           only ever sees shapes it knows. Idempotent. */
        // PORT-DELTA: B2 keeps `syncview-media:<occurrence id>` stored-image references as an atomic chip (artifact has no stored-media form).
        function _prodDescRichNormalize(root) {
          const unwrap = el => { while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el); el.remove(); };
          const clean = el => {
            Array.from(el.querySelectorAll('*')).forEach(n => {
              if (!n.isConnected) return;
              if (n.hasAttribute('style')) n.removeAttribute('style');
              const tag = n.tagName;
              if (tag === 'B' || (tag === 'STRONG' && !n.hasAttribute('data-md'))) {
                const s = document.createElement('strong'); s.setAttribute('data-md', 'bb');
                while (n.firstChild) s.appendChild(n.firstChild);
                n.replaceWith(s);
                return;
              }
              if (tag === 'I' || (tag === 'EM' && !n.hasAttribute('data-md'))) {
                const e = document.createElement('em'); e.setAttribute('data-md', 's');
                while (n.firstChild) e.appendChild(n.firstChild);
                n.replaceWith(e);
                return;
              }
              if (tag === 'A') { if (!n.hasAttribute('data-md')) n.setAttribute('data-md', 'named'); n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener noreferrer'); return; }
              if (tag === 'IMG') { if (String(n.getAttribute('src') || '').indexOf('https://') !== 0) n.remove(); else n.classList.add('prod-desc-image'); return; }
              if (tag === 'STRONG' || tag === 'EM' || tag === 'CODE' || tag === 'BR' || tag === 'HR') return;
              if (tag === 'SPAN' && (n.hasAttribute('data-md-placeholder') || n.hasAttribute('data-md-media') || n.classList.contains('prod-md-bullet-mark') || n.classList.contains('prod-md-bullet-text'))) return;
              if (tag === 'DIV') return;
              unwrap(n);
            });
          };
          /* 1. Stray top-level inline nodes become paragraphs. */
          let run = [];
          const flush = () => {
            if (!run.length) return;
            const p = _prodDescRichMakeBlock('p');
            p.innerHTML = '';
            root.insertBefore(p, run[0]);
            run.forEach(n => p.appendChild(n));
            run = [];
          };
          Array.from(root.childNodes).forEach(n => {
            const block = n.nodeType === 1 && n.tagName === 'DIV';
            if (block) { flush(); if (!PROD_DESC_RICH_BLOCK_TYPES.includes(n.getAttribute('data-md') || '')) { n.className = 'prod-md-p'; n.setAttribute('data-md', 'p'); } return; }
            run.push(n);
          });
          flush();
          /* 2. Inline cleanup, nested divs hoisted, blocks split at <br>. */
          clean(root);
          let guard = 0;
          Array.from(root.children).forEach(block => {
            const kind = block.getAttribute('data-md');
            if (kind === 'hr') { block.innerHTML = '<hr class="prod-md-rule">'; block.setAttribute('contenteditable', 'false'); return; }
            if (kind === 'ul' && !block.querySelector('.prod-md-bullet-text')) {
              const text = document.createElement('span'); text.className = 'prod-md-bullet-text';
              Array.from(block.childNodes).forEach(n => { if (!(n.nodeType === 1 && n.classList.contains('prod-md-bullet-mark'))) text.appendChild(n); });
              block.appendChild(text);
            }
            if (kind === 'ul' && !block.querySelector('.prod-md-bullet-mark')) {
              const mark = document.createElement('span'); mark.className = 'prod-md-bullet-mark'; mark.setAttribute('contenteditable', 'false'); mark.textContent = '•';
              block.insertBefore(mark, block.firstChild);
            }
            let current = block;
            while (guard++ < 10000) {
              const container = _prodDescRichContainer(current);
              const boundary = Array.from(container.querySelectorAll('br,div')).find(b => !(b.tagName === 'BR' && b === container.lastChild && container.childNodes.length > 1) && !(b.tagName === 'BR' && container.childNodes.length === 1));
              if (!boundary) break;
              const range = document.createRange();
              range.setStartAfter(boundary);
              range.setEnd(container, container.childNodes.length);
              const tail = range.extractContents();
              const nested = boundary.tagName === 'DIV' ? boundary : null;
              boundary.remove();
              const next = _prodDescRichMakeBlock('p');
              next.innerHTML = '';
              if (nested) { while (nested.firstChild) next.appendChild(nested.firstChild); }
              next.appendChild(tail);
              if (nested && !next.firstChild && !tail.childNodes.length) { /* an empty nested div: a blank line */ }
              current.after(next);
              current = next;
            }
          });
          /* 3. Every block is focusable: an empty container holds one <br>, a
             filled one holds no trailing <br> and no empty text nodes. */
          Array.from(root.children).forEach(block => {
            const kind = block.getAttribute('data-md');
            if (kind === 'hr') return;
            const container = _prodDescRichContainer(block);
            _prodDescRichSettle(container);
            if (container.childNodes.length > 1) {
              const last = container.lastChild;
              if (last.nodeType === 1 && last.tagName === 'BR') last.remove();
            }
            if (kind === 'p' && !_prodDescRichIsEmpty(container)) block.removeAttribute('data-md-raw');
          });
          /* 4. Same rule as _prodDescRichBuild: a blank line beside a heading or rule is
             kept in the model and collapsed on screen. */
          const blocks = Array.from(root.children);
          blocks.forEach((block, i) => {
            const kind = block.getAttribute('data-md');
            const blank = kind === 'p' && _prodDescRichIsEmpty(_prodDescRichContainer(block));
            const blockish = b => !!b && ['h', 'hr'].includes(b.getAttribute('data-md'));
            block.classList.toggle('prod-md-gap', blank && (blockish(blocks[i - 1]) || blockish(blocks[i + 1])));
          });
          root.classList.toggle('is-empty', blocks.length <= 1 && (!blocks[0] || _prodDescRichIsEmpty(_prodDescRichContainer(blocks[0]))));
          return root;
        }
        /* Caret as (block index, character offset in the block), which survives a
           rebuild of the same Markdown. */
        function _prodDescRichCaret(root) {
          const sel = window.getSelection && window.getSelection();
          if (!sel || !sel.rangeCount || !root.contains(sel.focusNode)) return null;
          const block = _prodDescRichBlockOf(root, sel.focusNode);
          if (!block) return { block: 0, offset: 0 };
          const container = _prodDescRichContainer(block);
          const range = document.createRange();
          range.selectNodeContents(container);
          if (container.contains(sel.focusNode)) range.setEnd(sel.focusNode, sel.focusOffset);
          return { block: Array.prototype.indexOf.call(root.children, block), offset: range.toString().length };
        }
        function _prodDescRichSetCaret(root, pos) {
          const sel = window.getSelection && window.getSelection();
          if (!sel) return false;
          const blocks = root.children;
          if (!blocks.length) return false;
          let block = blocks[Math.min(Math.max(0, Number(pos && pos.block) || 0), blocks.length - 1)];
          /* A rule holds no caret and a collapsed blank line draws no box: settle
             on the nearest block that can show one. */
          const holds = b => !!b && b.getAttribute('data-md') !== 'hr' && !b.classList.contains('prod-md-gap');
          if (!holds(block)) {
            let next = block.nextElementSibling;
            while (next && !holds(next)) next = next.nextElementSibling;
            let prev = block.previousElementSibling;
            while (prev && !holds(prev)) prev = prev.previousElementSibling;
            block = next || prev || block;
          }
          const container = _prodDescRichContainer(block);
          const range = document.createRange();
          let remaining = Math.max(0, Number(pos && pos.offset) || 0);
          let placed = false;
          const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
          let text;
          while ((text = walker.nextNode())) {
            const len = text.nodeValue.length;
            if (remaining <= len) { range.setStart(text, remaining); placed = true; break; }
            remaining -= len;
          }
          if (!placed) range.setStart(container, container.childNodes.length);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          return true;
        }
        function _prodDescRichConvert(block, kind, prefix) {
          const next = _prodDescRichMakeBlock(kind, prefix);
          const from = _prodDescRichContainer(block);
          const to = _prodDescRichContainer(next);
          to.innerHTML = '';
          while (from.firstChild) to.appendChild(from.firstChild);
          _prodDescRichSettle(to);
          block.replaceWith(next);
          return next;
        }
        function _prodDescRichCaretAtStart(container, range) {
          const probe = document.createRange();
          probe.selectNodeContents(container);
          probe.setEnd(range.startContainer, range.startOffset);
          if (probe.toString().length) return false;
          const frag = probe.cloneContents();
          return !frag.querySelector || !frag.querySelector('img,[data-md-placeholder]');
        }
        function _prodDescRichCaretAtEnd(container, range) {
          const probe = document.createRange();
          probe.selectNodeContents(container);
          probe.setStart(range.endContainer, range.endOffset);
          if (probe.toString().length) return false;
          const frag = probe.cloneContents();
          return !frag.querySelector || !frag.querySelector('img,[data-md-placeholder]');
        }
        /* Enter: split the block at the caret. A bullet continues as a bullet, an
           empty bullet leaves the list, a heading is followed by a paragraph, and a
           paragraph reading `---` becomes a rule. Returns true when handled. */
        function _prodDescRichSplitBlock(root) {
          const sel = window.getSelection();
          if (!sel || !sel.rangeCount) return false;
          const range = sel.getRangeAt(0);
          if (!root.contains(range.startContainer)) return false;
          if (!range.collapsed) range.deleteContents();
          let block = _prodDescRichBlockOf(root, range.startContainer);
          if (!block) return false;
          const kind = block.getAttribute('data-md');
          const place = target => { const r = document.createRange(); r.setStart(target, 0); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); };
          if (kind === 'hr') { const p = _prodDescRichMakeBlock('p'); block.after(p); place(p); return true; }
          const container = _prodDescRichContainer(block);
          if (kind === 'p' && /^-{3,}$/.test(String(container.textContent || '').trim()) && _prodDescRichCaretAtEnd(container, range)) {
            const hr = _prodDescRichMakeBlock('hr'); hr.setAttribute('data-md-raw', String(container.textContent || '').trim());
            const p = _prodDescRichMakeBlock('p');
            block.replaceWith(hr); hr.after(p); place(p); return true;
          }
          if (kind === 'ul' && _prodDescRichIsEmpty(container)) { place(_prodDescRichContainer(_prodDescRichConvert(block, 'p'))); return true; }
          const tail = document.createRange();
          tail.setStart(range.startContainer, range.startOffset);
          tail.setEnd(container, container.childNodes.length);
          const frag = tail.extractContents();
          const next = _prodDescRichMakeBlock(kind === 'ul' ? 'ul' : 'p', block.getAttribute('data-md-prefix'));
          const nextContainer = _prodDescRichContainer(next);
          nextContainer.innerHTML = '';
          nextContainer.appendChild(frag);
          _prodDescRichSettle(nextContainer);
          _prodDescRichSettle(container);
          block.after(next);
          place(nextContainer);
          return true;
        }
        /* Backspace at the start of a block: a bullet or heading becomes a
           paragraph first; a paragraph joins the block above (a rule above is
           simply removed). Returns true when handled. */
        function _prodDescRichJoinBack(root) {
          const sel = window.getSelection();
          if (!sel || !sel.rangeCount) return false;
          const range = sel.getRangeAt(0);
          if (!range.collapsed || !root.contains(range.startContainer)) return false;
          const block = _prodDescRichBlockOf(root, range.startContainer);
          if (!block) return false;
          const kind = block.getAttribute('data-md');
          const container = _prodDescRichContainer(block);
          if (kind !== 'hr' && !_prodDescRichCaretAtStart(container, range)) return false;
          const place = (target, offset) => { _prodDescRichSetCaret(root, { block: Array.prototype.indexOf.call(root.children, target), offset }); };
          if (kind === 'ul' || kind === 'h') { place(_prodDescRichConvert(block, 'p'), 0); return true; }
          const prev = block.previousElementSibling;
          if (!prev) return true;
          if (prev.getAttribute('data-md') === 'hr') { prev.remove(); place(block, 0); return true; }
          const prevContainer = _prodDescRichContainer(prev);
          const last = prevContainer.lastChild;
          if (last && last.nodeType === 1 && last.tagName === 'BR') last.remove();
          const offset = String(prevContainer.textContent || '').length;
          Array.from(container.childNodes).forEach(n => { if (!(n.nodeType === 1 && n.tagName === 'BR' && _prodDescRichIsEmpty(container))) prevContainer.appendChild(n); });
          _prodDescRichSettle(prevContainer);
          block.remove();
          place(prev, offset);
          return true;
        }
        /* Delete at the end of a block: the block below joins this one. */
        function _prodDescRichJoinForward(root) {
          const sel = window.getSelection();
          if (!sel || !sel.rangeCount) return false;
          const range = sel.getRangeAt(0);
          if (!range.collapsed || !root.contains(range.startContainer)) return false;
          const block = _prodDescRichBlockOf(root, range.startContainer);
          if (!block) return false;
          const container = _prodDescRichContainer(block);
          if (block.getAttribute('data-md') === 'hr' || !_prodDescRichCaretAtEnd(container, range)) return false;
          const next = block.nextElementSibling;
          if (!next) return true;
          if (next.getAttribute('data-md') === 'hr') { next.remove(); return true; }
          const offset = String(container.textContent || '').length;
          const last = container.lastChild;
          if (last && last.nodeType === 1 && last.tagName === 'BR') last.remove();
          const nextContainer = _prodDescRichContainer(next);
          Array.from(nextContainer.childNodes).forEach(n => { if (!(n.nodeType === 1 && n.tagName === 'BR' && _prodDescRichIsEmpty(nextContainer))) container.appendChild(n); });
          _prodDescRichSettle(container);
          next.remove();
          _prodDescRichSetCaret(root, { block: Array.prototype.indexOf.call(root.children, block), offset });
          return true;
        }
        /* Typing `- `, `* ` or `# ` at the start of an empty line turns the line
           into that block, the way Linear does. Called after input. */
        function _prodDescRichShortcut(root) {
          const sel = window.getSelection();
          if (!sel || !sel.rangeCount || !root.contains(sel.focusNode)) return false;
          const block = _prodDescRichBlockOf(root, sel.focusNode);
          if (!block || block.getAttribute('data-md') !== 'p') return false;
          const text = String(block.textContent || '');
          let kind = '';
          if (/^[-*] $/.test(text)) kind = 'ul';
          else if (/^#{1,4} $/.test(text)) kind = 'h';
          if (!kind) return false;
          const next = _prodDescRichMakeBlock(kind, text);
          block.replaceWith(next);
          _prodDescRichSetCaret(root, { block: Array.prototype.indexOf.call(root.children, next), offset: 0 });
          return true;
        }
        /* Plain text at the caret; each newline starts a new block. */
        function _prodDescRichInsertText(root, text) {
          const sel = window.getSelection();
          if (!sel || !sel.rangeCount || !root.contains(sel.focusNode)) return false;
          const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
          let range = sel.getRangeAt(0);
          if (!range.collapsed) range.deleteContents();
          const put = value => {
            if (!value) return;
            const node = document.createTextNode(value);
            range = sel.getRangeAt(0);
            range.insertNode(node);
            range.setStartAfter(node);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          };
          put(lines[0]);
          for (let i = 1; i < lines.length; i++) {
            if (!_prodDescRichSplitBlock(root)) break;
            put(lines[i]);
          }
          return true;
        }
        /* Wrap the selection in a link (or drop a link at the caret). Returns the
           anchor, so the popover can open on it. */
        function _prodDescRichMakeLink(root, url, label) {
          const sel = window.getSelection();
          if (!sel || !sel.rangeCount || !root.contains(sel.focusNode)) return null;
          const range = sel.getRangeAt(0);
          const a = document.createElement('a');
          a.setAttribute('data-md', 'named');
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener noreferrer');
          a.setAttribute('href', url || '');
          if (range.collapsed) { a.textContent = label || url || 'link'; if (!label && !url) a.setAttribute('data-md-new', '1'); }
          else a.appendChild(range.extractContents());
          range.insertNode(a);
          range.selectNodeContents(a);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
          return a;
        }
        function _prodDescRichAnchorAtCaret(root) {
          const sel = window.getSelection();
          if (!sel || !sel.rangeCount || !root.contains(sel.focusNode)) return null;
          let node = sel.focusNode;
          while (node && node !== root) { if (node.nodeType === 1 && node.tagName === 'A') return node; node = node.parentNode; }
          return null;
        }
        /* Keys the block model owns. Everything else is the browser's. */
        function _prodDescRichKeydown(event, root) {
          if (!event || !root) return false;
          if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey) {
            if (_prodDescRichSplitBlock(root)) { event.preventDefault(); return true; }
            return false;
          }
          if (event.key === 'Backspace' && !event.ctrlKey && !event.metaKey && !event.altKey) {
            if (_prodDescRichJoinBack(root)) { event.preventDefault(); return true; }
            return false;
          }
          if (event.key === 'Delete' && !event.ctrlKey && !event.metaKey && !event.altKey) {
            if (_prodDescRichJoinForward(root)) { event.preventDefault(); return true; }
            return false;
          }
          /* Tab is deliberately NOT taken: there is no indentation to perform, and
             a keyboard user has to be able to reach Markdown, Cancel and Save
             (Codex on #1320). */
          return false;
        }
        /* ---- Link popover ------------------------------------------------------
           Hover a link in a description and a small card shows where it goes, with
           Open, and -- where the description is editable -- Edit (text and URL) and
           Remove. One body-mounted element, shared by every description on the page.
           Ctrl/Cmd+K in the editor opens the same card for the link at the caret, or
           makes one from the selection. */
        // PORT-DELTA: the wired description surface is .prod-desc (artifact: .d-desc).
        const PROD_DESC_LINK_SCOPE = '.prod-desc';
        const _prodDescLinkPop = { el: null, anchor: null, timer: 0, editing: false };
        function _prodDescLinkPopEnsure() {
          if (_prodDescLinkPop.el && _prodDescLinkPop.el.isConnected) return _prodDescLinkPop.el;
          const el = document.createElement('div');
          el.id = 'prodDescLinkPop';
          el.className = 'prod-linkpop';
          el.setAttribute('role', 'dialog');
          el.setAttribute('aria-label', 'Link');
          el.hidden = true;
          el.innerHTML = '<div class="prod-linkpop-view"><a class="prod-linkpop-url" data-prod-linkpop="open" target="_blank" rel="noopener noreferrer"></a>'
            + '<button type="button" class="prod-linkpop-btn" data-prod-linkpop="edit">Edit</button></div>'
            + '<form class="prod-linkpop-form" data-prod-linkpop-form>'
            + '<label class="prod-linkpop-field"><span>Text</span><input data-prod-linkpop-text autocomplete="off" spellcheck="false"></label>'
            + '<label class="prod-linkpop-field"><span>URL</span><input data-prod-linkpop-href autocomplete="off" spellcheck="false" placeholder="https://"></label>'
            + '<div class="prod-linkpop-note" data-prod-linkpop-note hidden></div>'
            + '<div class="prod-linkpop-actions"><button type="button" class="prod-linkpop-btn" data-prod-linkpop="remove">Remove link</button><span class="prod-linkpop-spacer"></span>'
            + '<button type="button" class="prod-linkpop-btn" data-prod-linkpop="cancel">Cancel</button><button type="submit" class="prod-linkpop-btn prod-linkpop-apply">Apply</button></div></form>';
          document.body.appendChild(el);
          el.addEventListener('mouseenter', () => { clearTimeout(_prodDescLinkPop.timer); });
          el.addEventListener('mouseleave', () => { if (!_prodDescLinkPop.editing) _prodDescLinkPopHideSoon(); });
          el.addEventListener('click', event => {
            const btn = event.target.closest('[data-prod-linkpop]');
            if (!btn) return;
            const action = btn.getAttribute('data-prod-linkpop');
            if (action === 'open') return;
            event.preventDefault();
            if (action === 'edit') _prodDescLinkPopEdit();
            else if (action === 'cancel') _prodDescLinkPopHide(true);
            else if (action === 'remove') _prodDescLinkPopRemove();
          });
          el.querySelector('[data-prod-linkpop-form]').addEventListener('submit', event => { event.preventDefault(); _prodDescLinkPopApply(); });
          el.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); _prodDescLinkPopHide(true); }
          });
          _prodDescLinkPop.el = el;
          return el;
        }
        function _prodDescLinkPopEditable(anchor) {
          const root = anchor && anchor.closest ? anchor.closest('[contenteditable="true"]') : null;
          if (root) return { root, read: false };
          const body = anchor && anchor.closest ? anchor.closest('[data-prod-desc-click-edit]') : null;
          return body ? { root: body, read: true } : null;
        }
        function _prodDescLinkPopPlace(anchor) {
          const el = _prodDescLinkPop.el;
          const rect = anchor.getBoundingClientRect();
          el.hidden = false;
          const width = el.offsetWidth || 260;
          const height = el.offsetHeight || 40;
          let left = rect.left;
          let top = rect.bottom + 6;
          if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - width);
          if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - 6 - height);
          el.style.left = Math.round(left) + 'px';
          el.style.top = Math.round(top) + 'px';
        }
        function _prodDescLinkPopShow(anchor, edit) {
          if (!anchor || !anchor.isConnected) return false;
          const el = _prodDescLinkPopEnsure();
          clearTimeout(_prodDescLinkPop.timer);
          _prodDescLinkPop.anchor = anchor;
          _prodDescLinkPop.editing = false;
          const href = anchor.getAttribute('href') || '';
          const url = el.querySelector('.prod-linkpop-url');
          url.setAttribute('href', href);
          url.textContent = href.replace(/^https?:\/{2}/, '').replace(/\/$/, '') || 'No URL yet';
          const editable = _prodDescLinkPopEditable(anchor);
          el.querySelector('[data-prod-linkpop="edit"]').hidden = !editable;
          el.classList.remove('is-editing');
          _prodDescLinkPopPlace(anchor);
          if (edit) _prodDescLinkPopEdit();
          return true;
        }
        function _prodDescLinkPopEdit() {
          const anchor = _prodDescLinkPop.anchor;
          const editable = _prodDescLinkPopEditable(anchor);
          if (!anchor || !editable) return false;
          if (editable.read) {
            /* A read view: hand the request to whoever owns the editor. It begins
               editing and re-opens this card on the same link. */
            const index = Array.prototype.indexOf.call(editable.root.querySelectorAll('a'), anchor);
            _prodDescLinkPopHide(true);
            editable.root.dispatchEvent(new CustomEvent('desc-link-edit', { bubbles: true, detail: { index } }));
            return true;
          }
          const el = _prodDescLinkPop.el;
          _prodDescLinkPop.editing = true;
          el.classList.add('is-editing');
          el.querySelector('[data-prod-linkpop-text]').value = anchor.hasAttribute('data-md-new') ? '' : (anchor.textContent || '');
          el.querySelector('[data-prod-linkpop-note]').hidden = true;
          el.querySelector('[data-prod-linkpop-href]').value = anchor.getAttribute('href') || '';
          _prodDescLinkPopPlace(anchor);
          const focus = el.querySelector(anchor.getAttribute('href') ? '[data-prod-linkpop-text]' : '[data-prod-linkpop-href]');
          focus.focus();
          focus.select();
          return true;
        }
        function _prodDescLinkPopNotify(anchorOrRoot) {
          const root = anchorOrRoot && anchorOrRoot.closest ? anchorOrRoot.closest('[contenteditable="true"]') : null;
          if (root) root.dispatchEvent(new Event('input', { bubbles: true }));
        }
        function _prodDescLinkPopApply() {
          const anchor = _prodDescLinkPop.anchor;
          const el = _prodDescLinkPop.el;
          if (!anchor || !anchor.isConnected || !el) { _prodDescLinkPopHide(true); return false; }
          const text = String(el.querySelector('[data-prod-linkpop-text]').value || '').trim();
          let href = String(el.querySelector('[data-prod-linkpop-href]').value || '').trim();
          const note = el.querySelector('[data-prod-linkpop-note]');
          const refuse = (field, why) => { note.textContent = why; note.hidden = false; el.querySelector(field).focus(); return false; };
          if (href && !/^https?:\/{2}/i.test(href)) href = 'https://' + href;
          if (!/^https?:\/{2}\S+$/i.test(href)) return refuse('[data-prod-linkpop-href]', 'Enter a full https:// address.');
          /* The Markdown forms cannot carry these: a `]` ends the label and `<`
             or `>` end the angle URL. Said here, not lost at the next render. */
          if (/[\[\]]/.test(text)) return refuse('[data-prod-linkpop-text]', 'Link text cannot contain [ or ].');
          if (/[<>]/.test(href)) return refuse('[data-prod-linkpop-href]', 'The address cannot contain < or >.');
          note.hidden = true;
          anchor.setAttribute('href', href);
          anchor.textContent = text || href;
          anchor.setAttribute('data-md', text && text !== href ? 'named' : 'bare');
          anchor.removeAttribute('data-md-new');
          const root = anchor.closest('[contenteditable="true"]');
          _prodDescLinkPopHide(true);
          _prodDescLinkPopNotify(root);
          return true;
        }
        function _prodDescLinkPopRemove() {
          const anchor = _prodDescLinkPop.anchor;
          if (!anchor || !anchor.isConnected) { _prodDescLinkPopHide(true); return false; }
          const root = anchor.closest('[contenteditable="true"]');
          /* The root and the caret are taken BEFORE the anchor goes, because the
             hide routine finds them through the anchor (Codex on #1320). */
          let last = null;
          while (anchor.firstChild) { last = anchor.firstChild; anchor.parentNode.insertBefore(last, anchor); }
          const parent = anchor.parentNode;
          anchor.remove();
          _prodDescLinkPop.anchor = null;
          _prodDescLinkPopHide(true);
          if (root) {
            try { root.focus({ preventScroll: true }); } catch (e) {}
            const sel = window.getSelection && window.getSelection();
            if (sel && parent) {
              const r = document.createRange();
              if (last && last.parentNode) r.setStartAfter(last); else r.setStart(parent, 0);
              r.collapse(true);
              sel.removeAllRanges();
              sel.addRange(r);
            }
          }
          _prodDescLinkPopNotify(root);
          return true;
        }
        function _prodDescLinkPopHide(now) {
          clearTimeout(_prodDescLinkPop.timer);
          const el = _prodDescLinkPop.el;
          if (!el) return;
          const done = () => {
            const wasEditing = _prodDescLinkPop.editing;
            el.hidden = true;
            el.classList.remove('is-editing');
            /* A link that was created empty and then abandoned is not a link. */
            const anchor = _prodDescLinkPop.anchor;
            const root = anchor && anchor.isConnected && anchor.closest ? anchor.closest('[contenteditable="true"]') : null;
            if (anchor && root && !anchor.getAttribute('href')) {
              if (!anchor.hasAttribute('data-md-new')) { while (anchor.firstChild) anchor.parentNode.insertBefore(anchor.firstChild, anchor); }
              anchor.remove();
              _prodDescLinkPopNotify(root);
            }
            /* The card's inputs had the focus; the writer was in the editor and
               goes back there, just after the link. */
            if (wasEditing && root) {
              try { root.focus({ preventScroll: true }); } catch (e) {}
              const sel = window.getSelection && window.getSelection();
              if (sel && anchor && anchor.isConnected) {
                const r = document.createRange();
                r.setStartAfter(anchor);
                r.collapse(true);
                sel.removeAllRanges();
                sel.addRange(r);
              }
            }
            _prodDescLinkPop.anchor = null;
            _prodDescLinkPop.editing = false;
          };
          if (now) done(); else _prodDescLinkPop.timer = setTimeout(done, 250);
        }
        function _prodDescLinkPopHideSoon() { _prodDescLinkPopHide(false); }
        function _prodDescLinkPopWire() {
          if (_prodDescLinkPop.wired || typeof document === 'undefined') return;
          _prodDescLinkPop.wired = true;
          document.addEventListener('mouseover', event => {
            const anchor = event.target && event.target.closest ? event.target.closest(PROD_DESC_LINK_SCOPE + ' a') : null;
            if (!anchor) return;
            if (_prodDescLinkPop.editing) return;
            clearTimeout(_prodDescLinkPop.timer);
            _prodDescLinkPop.timer = setTimeout(() => _prodDescLinkPopShow(anchor, false), 120);
          });
          document.addEventListener('mouseout', event => {
            const anchor = event.target && event.target.closest ? event.target.closest(PROD_DESC_LINK_SCOPE + ' a') : null;
            if (!anchor) return;
            clearTimeout(_prodDescLinkPop.timer);
            if (_prodDescLinkPop.anchor === anchor && !_prodDescLinkPop.editing) _prodDescLinkPopHideSoon();
            else if (!_prodDescLinkPop.anchor) _prodDescLinkPop.timer = 0;
          });
          document.addEventListener('focusin', event => {
            const anchor = event.target && event.target.closest ? event.target.closest(PROD_DESC_LINK_SCOPE + ' a') : null;
            if (anchor && !_prodDescLinkPop.editing) _prodDescLinkPopShow(anchor, false);
          });
          document.addEventListener('mousedown', event => {
            if (!_prodDescLinkPop.el || _prodDescLinkPop.el.hidden) return;
            if (_prodDescLinkPop.el.contains(event.target)) return;
            if (_prodDescLinkPop.anchor && _prodDescLinkPop.anchor.contains(event.target)) return;
            _prodDescLinkPopHide(true);
          });
          /* Inside the editor a plain click places the caret; Ctrl/Cmd+click opens. */
          document.addEventListener('click', event => {
            const anchor = event.target && event.target.closest ? event.target.closest('[contenteditable="true"] a') : null;
            if (!anchor) return;
            if (event.ctrlKey || event.metaKey) return;
            event.preventDefault();
          });
          document.addEventListener('scroll', () => { if (_prodDescLinkPop.el && !_prodDescLinkPop.el.hidden && !_prodDescLinkPop.editing) _prodDescLinkPopHide(true); }, true);
        }
        _prodDescLinkPopWire();
        /* A link's hover card, opened on the READ view, asked to edit that
           link: begin editing and re-open the card on the same link in the
           editor. The card only dispatches this where the body is marked
           click-to-edit, which the panel does only when the write gate is
           open, and _prodBeginDescriptionEdit re-checks that gate itself. */
        if (typeof document !== 'undefined' && document.addEventListener) {
            document.addEventListener('desc-link-edit', function (event) {
                const panel = event && event.target && event.target.closest ? event.target.closest('[data-prod-description]') : null;
                if (!panel) return;
                const index = event.detail && Number.isInteger(event.detail.index) ? event.detail.index : null;
                _prodBeginDescriptionEdit(panel.getAttribute('data-prod-description'), { link: index });
            });
        }
        /* ---- Pasting an image into a description (2026-09-05) ------------
           Owner, 2026-08-31: "could you look into pasting images in the
           description? ... same way it does in linear." #1204 shipped the
           render half; this is the paste half, and the storage decision
           behind it is written up in docs/ops/DESCRIPTION_IMAGE_UPLOAD.md.

           SHAPE. A paste (or drop) that carries an image file is intercepted;
           anything else -- ordinary text -- is left to the browser untouched.
           A placeholder line is inserted at the caret straight away so the
           editor answers the keystroke, the bytes are downscaled HERE (see
           _prodDescriptionImageFit) and posted to description-image-upload,
           and the placeholder is swapped for `![alt](https://…)` when the
           URL comes back. On failure the placeholder is removed and a toast
           says why: a paste that half-works is worse than one that does not.

           WHY THE BROWSER DOWNSCALES. A Retina screenshot is 2x, so pasted
           as-is it renders enormous -- and Linear draws the mirrored markdown
           image at its natural size, where no CSS of ours reaches. Capping
           the long edge at 1600px keeps text readable and is the one lever
           that sizes the picture on BOTH surfaces. A GIF passes through
           untouched, because redrawing it on a canvas would drop its frames.

           Nothing here holds a storage key. The function verifies the bytes
           and the actor; this only shapes and ships them. */
        const PROD_DESCRIPTION_IMAGE_MAX_EDGE = 1600;
        const PROD_DESCRIPTION_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
        const PROD_DESCRIPTION_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
        const PROD_DESCRIPTION_IMAGE_PLACEHOLDER_RE = /!\[Uploading image \d+…\]\(\)/;
        let _prodDescriptionImageSeq = 0;
        function _prodDescriptionImagePlaceholder(n) {
            return '![Uploading image ' + n + '…]()';
        }
        /* Long-edge fit. Never upscales; a small image keeps its own pixels. */
        function _prodDescriptionImageFit(width, height, maxEdge) {
            width = Math.max(1, Math.round(Number(width) || 0));
            height = Math.max(1, Math.round(Number(height) || 0));
            maxEdge = Math.max(1, Number(maxEdge) || PROD_DESCRIPTION_IMAGE_MAX_EDGE);
            const longest = Math.max(width, height);
            const scale = longest > maxEdge ? maxEdge / longest : 1;
            return {
                scale,
                width: Math.max(1, Math.round(width * scale)),
                height: Math.max(1, Math.round(height * scale))
            };
        }
        /* PNG stays PNG: screenshots are text and flat colour, which JPEG
           smears and PNG keeps crisp, and PNG keeps transparency. Anything
           else that had to be redrawn is re-encoded as JPEG, which is what a
           photo wants. */
        function _prodDescriptionImageOutputType(sourceType) {
            return String(sourceType || '').toLowerCase() === 'image/png' ? 'image/png' : 'image/jpeg';
        }
        function _prodDescriptionImageAlt(file, n) {
            const name = String(file && file.name || '').trim();
            const base = name.replace(/\.[a-z0-9]+$/i, '');
            /* The clipboard names every paste "image.png"; that is not an
               alt text, it is the absence of one. */
            const meaningful = base && !/^(image|screenshot|pasted[ _-]?image|clipboard)(\s*\(?\d*\)?)?$/i.test(base);
            const alt = (meaningful ? base : 'Pasted image ' + n).replace(/[\[\]\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
            return alt.slice(0, 80);
        }
        function _prodDescriptionImageErrorText(error) {
            const code = String(error && error.code || '');
            const status = Number(error && error.status || 0);
            if (code === 'unsupported_image_type' || code === 'image_type_mismatch' || code === 'image_bytes_unrecognized') {
                return 'Only PNG, JPEG, WebP or GIF images can be pasted.';
            }
            if (code === 'image_incomplete' || code === 'image_undecodable') return 'That image file is cut off or damaged. Try copying it again.';
            if (code === 'image_encode_failed') return 'This browser could not prepare the image. Try a PNG or JPEG.';
            if (code === 'animated_webp_unsupported') return 'Animated WebP is not supported here. Paste a GIF or a still image instead.';
            if (code === 'image_too_large') return 'That image is over 4 MB even after resizing. Try a smaller crop.';
            if (code === 'rate_limited') return 'Too many images uploaded in the last hour. Try again a little later.';
            if (code === 'operation_forbidden') return 'Only admin and SMM accounts can add images to a description.';
            if (status === 401 || code === 'credentials_required' || code === 'invalid_staff_key' || code === 'roster_actor_required' || code === 'roster_actor_not_unique') {
                return 'Staff sign-in is required to upload an image.';
            }
            if (status === 404) return 'Image upload is not available yet on this backend.';
            if (code === 'upload_disabled') return 'Image upload is switched off right now.';
            return 'The image could not be uploaded. The description is unchanged.';
        }
        /* Image files out of a DataTransfer. During a dragover the files are
           not readable yet, so `probeOnly` answers from the item kinds. */
        function _prodDescriptionTransferImages(transfer, probeOnly) {
            const out = [];
            if (!transfer) return out;
            const items = transfer.items;
            if (items && items.length) {
                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    if (!item || item.kind !== 'file' || !/^image\//i.test(String(item.type || ''))) continue;
                    if (probeOnly) { out.push(item); continue; }
                    const file = item.getAsFile && item.getAsFile();
                    if (file) out.push(file);
                }
                return out;
            }
            const files = transfer.files;
            if (files && files.length) {
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    if (file && /^image\//i.test(String(file.type || ''))) out.push(file);
                }
            }
            return out;
        }
        function _prodDescriptionPaste(event, id) {
            const files = _prodDescriptionTransferImages(event && event.clipboardData, false);
            const input = event.currentTarget || event.target;
            if (!files.length) {
                /* No image on the clipboard. In the textarea the browser's own
                   paste is right. In the visual editor the text is placed as
                   blocks, a URL pasted over a selection becomes its link, and
                   pasted Markdown is rendered straight away. */
                const rich = input && input.getAttribute && input.getAttribute('data-prod-description-control') === 'rich';
                const text = rich && event.clipboardData ? String(event.clipboardData.getData('text/plain') || '') : '';
                if (!rich || !text) return true;
                event.preventDefault();
                const selection = window.getSelection();
                if (selection && !selection.isCollapsed && /^https?:\/\/\S+$/.test(text.trim())) _prodDescRichMakeLink(input, text.trim());
                else _prodDescRichInsertText(input, text);
                _prodDescriptionRichInput(id, input);
                _prodDescriptionRichRebuild(id, input);
                return false;
            }
            event.preventDefault();
            _prodDescriptionInsertImages(id, input, files);
            return false;
        }
        function _prodDescriptionDragOver(event) {
            const transfer = event && event.dataTransfer;
            if (!_prodDescriptionTransferImages(transfer, true).length) return true;
            event.preventDefault();
            try { transfer.dropEffect = 'copy'; } catch (e) {}
            const input = event.currentTarget || event.target;
            if (input && input.classList) input.classList.add('is-drop-target');
            return false;
        }
        function _prodDescriptionDragLeave(event) {
            const input = event && (event.currentTarget || event.target);
            if (input && input.classList) input.classList.remove('is-drop-target');
            return true;
        }
        function _prodDescriptionDrop(event, id) {
            const input = event && (event.currentTarget || event.target);
            if (input && input.classList) input.classList.remove('is-drop-target');
            const files = _prodDescriptionTransferImages(event && event.dataTransfer, false);
            if (!files.length) return true;
            event.preventDefault();
            _prodDescriptionInsertImages(id, input, files);
            return false;
        }
        function _prodDescriptionSourceInput(id) {
            const panel = document.querySelector('[data-prod-description="' + CSS.escape(String(id || '')) + '"]');
            return panel && panel.querySelector('[data-prod-description-control="source"]') || null;
        }
        /* Insert `text` at the caret ON ITS OWN LINE, in the live textarea
           when there is one and in the draft either way. The draft is the
           truth _prodRender redraws from, so a re-render mid-upload cannot
           lose the placeholder. */
        function _prodDescriptionInsertAtCaret(id, input, text) {
            const state = _prodDescriptionState(id);
            if (!state) return false;
            const rich = _prodDescriptionRichRoot(id);
            if (rich && !(input && input.tagName === 'TEXTAREA')) return _prodDescriptionRichInsertLine(id, rich, text);
            const live = input && input.tagName === 'TEXTAREA' ? input : _prodDescriptionSourceInput(id);
            const value = String(live ? live.value : state.draft || '');
            let start = live && Number.isFinite(live.selectionStart) ? live.selectionStart : state.selectionStart;
            let end = live && Number.isFinite(live.selectionEnd) ? live.selectionEnd : state.selectionEnd;
            start = Math.min(Math.max(0, Number(start) || 0), value.length);
            end = Math.min(Math.max(start, Number(end) || start), value.length);
            const before = value.slice(0, start);
            const after = value.slice(end);
            const lead = before && !/\n$/.test(before) ? '\n' : '';
            const tail = after && !/^\n/.test(after) ? '\n' : '';
            const inserted = lead + text + tail;
            const next = before + inserted + after;
            const caret = before.length + inserted.length;
            if (live) {
                live.value = next;
                try { live.setSelectionRange(caret, caret); } catch (e) {}
            }
            state.selectionStart = caret;
            state.selectionEnd = caret;
            _prodDescriptionDraftInput(id, next, live);
            return true;
        }
        /* The visual-editor twin of the textarea insert above: the text lands
           on its own line, the same newline rules, and the editor is rebuilt
           from the Markdown so the placeholder shows as its chip. */
        function _prodDescriptionRichInsertLine(id, root, text) {
            const state = _prodDescriptionState(id);
            if (!state || !root) return false;
            if (document.activeElement !== root || !_prodDescRichCaret(root)) {
                try { root.focus({ preventScroll: true }); } catch (e) {}
                _prodDescRichSetCaret(root, { block: state.caretBlock, offset: state.caretOffset });
            }
            const selection = window.getSelection();
            const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
            const block = range ? _prodDescRichBlockOf(root, range.startContainer) : null;
            const container = _prodDescRichContainer(block);
            const leftEmpty = !container || _prodDescRichCaretAtStart(container, range);
            const rightEmpty = !container || _prodDescRichCaretAtEnd(container, range);
            _prodDescRichInsertText(root, (leftEmpty ? '' : '\n') + text + (rightEmpty ? '' : '\n'));
            _prodDescriptionRichInput(id, root);
            _prodDescriptionRichRebuild(id, root);
            return true;
        }
        /* Swap a placeholder for its result (or for nothing). Works on the
           live editor, visual or Markdown, else on the draft, and keeps the
           caret where the writer left it. */
        function _prodDescriptionReplaceInDraft(id, placeholder, replacement) {
            const state = _prodDescriptionState(id);
            if (!state) return false;
            const rich = _prodDescriptionRichRoot(id);
            if (rich) {
                const n = (String(placeholder).match(/Uploading image (\d+)/) || [])[1];
                const chip = n && rich.querySelector('[data-md-placeholder="' + n + '"]');
                if (!chip) return false;
                const block = _prodDescRichBlockOf(rich, chip);
                if (replacement) {
                    const host = document.createElement('span');
                    host.innerHTML = _prodDescRichInline(replacement);
                    while (host.firstChild) chip.parentNode.insertBefore(host.firstChild, chip);
                }
                chip.remove();
                /* A failed paste takes the line it was given with it. */
                if (!replacement && block && _prodDescRichIsEmpty(_prodDescRichContainer(block)) && rich.children.length > 1) block.remove();
                _prodDescriptionRichInput(id, rich);
                return true;
            }
            const live = _prodDescriptionSourceInput(id);
            const value = String(live ? live.value : state.draft || '');
            const at = value.indexOf(placeholder);
            if (at < 0) return false;
            let block = placeholder;
            let from = at;
            if (!replacement) {
                /* Take the line the placeholder was given with it, so a failed
                   paste does not leave a blank line behind. */
                if (value[at + block.length] === '\n') block = block + '\n';
                else if (at > 0 && value[at - 1] === '\n' && (at + block.length === value.length)) { from = at - 1; block = '\n' + block; }
            }
            const next = value.slice(0, from) + (replacement || '') + value.slice(from + block.length);
            const delta = (replacement || '').length - block.length;
            const shift = pos => pos > from ? Math.max(from, pos + delta) : pos;
            const start = shift(live && Number.isFinite(live.selectionStart) ? live.selectionStart : state.selectionStart);
            const end = shift(live && Number.isFinite(live.selectionEnd) ? live.selectionEnd : state.selectionEnd);
            if (live) {
                const focused = document.activeElement === live;
                live.value = next;
                if (focused) { try { live.setSelectionRange(start, end); } catch (e) {} }
            }
            state.selectionStart = start;
            state.selectionEnd = end;
            _prodDescriptionDraftInput(id, next, live);
            if (!live && state.editing && state.preview) _prodRender();
            return true;
        }
        function _prodDescriptionSetUploading(id, delta) {
            const state = _prodDescriptionState(id);
            if (!state) return;
            state.uploading = Math.max(0, (Number(state.uploading) || 0) + delta);
            const panel = document.querySelector('[data-prod-description="' + CSS.escape(String(id || '')) + '"]');
            const save = panel && panel.querySelector('[data-prod-description-control="save"]');
            if (save) save.disabled = state.saving || state.uploading > 0 || String(state.draft || '').length > 100000;
            const hint = panel && panel.querySelector('[data-prod-description-hint]');
            if (hint) hint.textContent = state.uploading > 0
                ? 'Uploading ' + (state.uploading === 1 ? 'image' : state.uploading + ' images') + '…'
                : 'Paste or drop an image to add it';
        }
        function _prodDescriptionInsertImages(id, input, files) {
            const issue = _prodIssue(id);
            const state = issue && _prodDescriptionState(id);
            if (!issue || !state || !state.editing || state.saving) return false;
            if (!_prodCanWrite(issue, _prodDescriptionOperation(issue))) {
                _prodToast(_prodWriteGateText(issue, _prodDescriptionOperation(issue)));
                return false;
            }
            files.forEach(file => { _prodDescriptionUploadImage(id, input, file); });
            return true;
        }
        function _prodDescriptionCanvasBlob(canvas, type, quality) {
            return new Promise(resolve => {
                try { canvas.toBlob(blob => resolve(blob || null), type, quality); } catch (e) { resolve(null); }
            });
        }
        /* An animated WebP is a VP8X container with bit 1 of its flags set.
           Read off the first 21 bytes; no decode. */
        async function _prodDescriptionWebpAnimated(file) {
            try {
                const head = new Uint8Array(await file.slice(0, 21).arrayBuffer());
                if (head.length < 21) return false;
                const tag = String.fromCharCode(head[12], head[13], head[14], head[15]);
                return tag === 'VP8X' && (head[20] & 0x02) !== 0;
            } catch (e) {
                return false;
            }
        }
        /* Shape the bytes before they travel: downscale to the long edge,
           re-encode, and refuse here what the server would refuse anyway so
           the writer hears it without a round trip. */
        async function _prodDescriptionPrepareImage(file) {
            const type = String(file && file.type || '').toLowerCase();
            const fail = code => { const e = new Error(code); e.code = code; return e; };
            if (!PROD_DESCRIPTION_IMAGE_TYPES.includes(type)) throw fail('unsupported_image_type');
            const passThrough = () => {
                if (file.size > PROD_DESCRIPTION_IMAGE_MAX_BYTES) throw fail('image_too_large');
                return { blob: file, type };
            };
            /* An animated WebP would be flattened to one frame by the redraw
               below, and the server cannot decode its bitstream to accept it
               raw, so it is refused outright and said so (Codex on #1310,
               round nine). A still WebP is redrawn as before. */
            if (type === 'image/webp' && await _prodDescriptionWebpAnimated(file)) throw fail('animated_webp_unsupported');
            let bitmap = null;
            try { bitmap = await createImageBitmap(file); } catch (e) { bitmap = null; }
            /* A GIF is never redrawn (that would drop its frames), but it IS
               decoded first: a file whose first frame this browser cannot
               decode is refused rather than shipped, since the server checks
               a GIF's block structure and not its LZW stream. The original
               bytes travel untouched on success. Codex on #1310, round nine. */
            if (type === 'image/gif') {
                if (!bitmap) throw fail('image_undecodable');
                if (bitmap.close) bitmap.close();
                return passThrough();
            }
            /* A file this browser cannot decode is refused HERE, not shipped
               for the server to guess at: the server checks structure, not
               pixels, and a file that fails to decode in the browser would
               fail to render for every reader too. (Codex on #1310, round
               eight.) The one exception is GIF above, which is never
               decoded here because redrawing it would drop its frames. */
            if (!bitmap) throw fail('image_undecodable');
            const fit = _prodDescriptionImageFit(bitmap.width, bitmap.height, PROD_DESCRIPTION_IMAGE_MAX_EDGE);
            /* PNG and JPEG that already fit travel byte-identical. WebP is
               ALWAYS redrawn: the server cannot decode its bitstream, so a
               WebP reaches it only as a PNG or JPEG this browser has
               actually decoded. */
            if (fit.scale === 1 && file.size <= PROD_DESCRIPTION_IMAGE_MAX_BYTES && type !== 'image/webp') {
                if (bitmap.close) bitmap.close();
                return { blob: file, type, width: bitmap.width, height: bitmap.height };
            }
            const canvas = document.createElement('canvas');
            canvas.width = fit.width;
            canvas.height = fit.height;
            const context = canvas.getContext('2d');
            if (!context) { if (bitmap.close) bitmap.close(); throw fail('image_encode_failed'); }
            context.drawImage(bitmap, 0, 0, fit.width, fit.height);
            if (bitmap.close) bitmap.close();
            let outType = _prodDescriptionImageOutputType(type);
            let blob = await _prodDescriptionCanvasBlob(canvas, outType, 0.9);
            if (blob && blob.size > PROD_DESCRIPTION_IMAGE_MAX_BYTES && outType === 'image/png') {
                outType = 'image/jpeg';
                blob = await _prodDescriptionCanvasBlob(canvas, outType, 0.88);
            }
            if (!blob) throw fail('image_encode_failed');
            if (blob.size > PROD_DESCRIPTION_IMAGE_MAX_BYTES) throw fail('image_too_large');
            return { blob, type: outType, width: fit.width, height: fit.height };
        }
        function _prodDescriptionImageHeaderValue(value) {
            return String(value == null ? '' : value).replace(/[^A-Za-z0-9_.:@-]+/g, '').slice(0, 160);
        }
        async function _prodDescriptionPostImage(issue, prepared) {
            const headers = {
                apikey: CAL_SUPABASE_ANON_KEY,
                Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY,
                Accept: 'application/json',
                'Content-Type': prepared.type
            };
            const clientSlug = _prodDescriptionImageHeaderValue(issue.authorityProject || issue.storedClientSlug || issue.project || '');
            const issueId = _prodDescriptionImageHeaderValue(issue.id);
            if (clientSlug) headers['X-Syncview-Image-Client'] = clientSlug;
            if (issueId) headers['X-Syncview-Image-Issue'] = issueId;
            const request = {
                method: 'POST',
                cache: 'no-store',
                headers: _syncviewEfHeaders(headers, PROD_DESCRIPTION_IMAGE_EF_URL),
                body: prepared.blob
            };
            /* A hung upload must not pin Save shut forever: the placeholder is
               removed and the writer told, exactly as for any other failure. */
            try {
                if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
                    request.signal = AbortSignal.timeout(60000);
                }
            } catch (e) {}
            const response = await fetch(PROD_DESCRIPTION_IMAGE_EF_URL, request);
            const json = await response.json().catch(() => ({}));
            const url = String(json && json.url || '');
            if (!response.ok || !json || json.ok !== true || !/^https:\/\/[^\s)]+$/.test(url)) {
                const error = new Error(String(json && json.error || 'upload_failed'));
                error.code = String(json && json.error || '');
                error.status = response.status;
                throw error;
            }
            return url;
        }
        async function _prodDescriptionUploadImage(id, input, file) {
            const issue = _prodIssue(id);
            const state = issue && _prodDescriptionState(id);
            if (!issue || !state) return false;
            const n = ++_prodDescriptionImageSeq;
            const placeholder = _prodDescriptionImagePlaceholder(n);
            _prodDescriptionInsertAtCaret(id, input, placeholder);
            _prodDescriptionSetUploading(id, 1);
            try {
                const prepared = await _prodDescriptionPrepareImage(file);
                const url = await _prodDescriptionPostImage(issue, prepared);
                const markdown = '![' + _prodDescriptionImageAlt(file, n) + '](' + url + ')';
                if (!_prodDescriptionReplaceInDraft(id, placeholder, markdown)) {
                    /* The editor was cancelled or the draft was replaced
                       while the bytes were in flight. The upload succeeded
                       and is durable; the writer simply is not in a state to
                       receive it, so say so rather than inserting into a
                       draft they did not ask to change. */
                    _prodToast('Image uploaded, but the description editor had closed. Paste it again.');
                }
                return true;
            } catch (error) {
                _writeUiRecordFailure('production', 'description_image', error, { id: String(id) });
                _prodDescriptionReplaceInDraft(id, placeholder, '');
                _prodToast(_prodDescriptionImageErrorText(error));
                return false;
            } finally {
                _prodDescriptionSetUploading(id, -1);
            }
        }
        /* A rendered image opens full size on click. Delegated, because the
           renderer is a string builder and an inline handler attribute is
           exactly the shape test/prod-description-images.js forbids. */
        function _prodDescriptionImageOpen(event) {
            const target = event && event.target;
            const image = target && target.closest ? target.closest('img.prod-desc-image') : null;
            if (!image) return false;
            const src = String(image.getAttribute('src') || '');
            if (!/^https:\/\//.test(src)) return false;
            event.preventDefault();
            window.open(src, '_blank', 'noopener,noreferrer');
            return true;
        }
        if (typeof document !== 'undefined' && document.addEventListener) {
            document.addEventListener('click', _prodDescriptionImageOpen);
            /* Enter and Space on the focused image, so the full-size view is
               not mouse-only. Raised by Codex on #1310. */
            document.addEventListener('keydown', function (event) {
                if (!event || (event.key !== 'Enter' && event.key !== ' ')) return;
                if (event.altKey || event.ctrlKey || event.metaKey) return;
                _prodDescriptionImageOpen(event);
            });
        }
        async function _prodSaveDescription(event, id) {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            const issue = _prodIssue(id);
            const state = issue && _prodDescriptionState(id);
            if (!issue || !state || !state.editing || state.saving) return false;
            if (!_prodCanWrite(issue, _prodDescriptionOperation(issue))) {
                _prodToast(_prodWriteGateText(issue, _prodDescriptionOperation(issue)));
                return false;
            }
            const description = String(state.draft == null ? '' : state.draft);
            if (description.includes('\0')) {
                state.error = 'Descriptions cannot contain NUL characters.';
                _prodRender();
                _prodFocusDescriptionControl(id, _prodDescriptionEditorControl(state));
                return false;
            }
            /* A placeholder is not a description. Saving it would mirror the
               literal text "Uploading image 1…" to Linear and lose the URL
               that arrives a second later. */
            if (state.uploading > 0 || PROD_DESCRIPTION_IMAGE_PLACEHOLDER_RE.test(description)) {
                state.error = 'An image is still uploading. Save once it has finished.';
                _prodRender();
                _prodFocusDescriptionControl(id, _prodDescriptionEditorControl(state));
                return false;
            }
            if (description.length > 100000) {
                state.error = 'Descriptions can contain at most 100,000 characters.';
                _prodRender();
                _prodFocusDescriptionControl(id, _prodDescriptionEditorControl(state));
                return false;
            }
            if (!state.requestId) state.requestId = _prodWriteRequestId('description');
            const previous = {
                value: state.value,
                baseline: state.baseline,
                hasValue: state.hasValue,
                status: state.status,
                updatedAt: state.sourceUpdatedAt,
                renderValue: state.renderValue,
                renderExpiresAt: state.renderExpiresAt
            };
            _prodNextDescriptionRequestToken(id);
            state.refreshing = false;
            state.saving = true;
            state.preview = false;
            state.value = description;
            state.hasValue = true;
            state.status = 'ready';
            state.error = '';
            state.refreshError = '';
            state.remoteChanged = false;
            /* The rendered projection was computed against the PREVIOUS text.
               Saving new text makes it stale immediately -- keeping it would
               show the old media-rewritten brief over the just-saved one. */
            state.renderValue = '';
            state.renderExpiresAt = 0;
            if (issue.syntheticBatchParent === true) _prodSyncBatchDescriptionRow(id, description, '');
            else _prodSyncDescriptionRow(id, description, '');
            _prodRender();
            try {
                /* A batch parent writes the POST's description onto the batch
                   row, so it uses its own operation and answers with a batch
                   rather than a deliverable. Everything downstream of the two
                   lines below is shared, because from the panel's point of view
                   the only difference is which field carried the committed
                   text back. */
                const batchParent = issue.syntheticBatchParent === true;
                const json = await _prodGatewayWrite(
                    issue,
                    _prodDescriptionOperation(issue),
                    { description },
                    state.requestId
                );
                const committedRow = batchParent ? (json && json.batch) : (json && json.row);
                if (!json || !committedRow) throw new Error('write_failed');
                /* The batch answer carries its text at the TOP LEVEL, not on
                   the row: publicRow is the shared deliverable projection and
                   has no description field. Reading it off the row returned
                   undefined on every successful save, which this then wrote
                   back over the text the user had just typed. Raised by review
                   on #1203. */
                const committed = _prodDescriptionText(
                    batchParent ? json.description : committedRow.brief
                );
                state.value = committed;
                state.baseline = committed;
                state.draft = committed;
                state.hasValue = true;
                state.status = 'ready';
                state.saving = false;
                state.editing = false;
                state.preview = false;
                state.error = '';
                state.remoteChanged = false;
                state.requestId = '';
                state.sourceUpdatedAt = committedRow.updated_at || state.sourceUpdatedAt;
                if (batchParent) _prodSyncBatchDescriptionRow(id, committed, committedRow.updated_at);
                else _prodSyncDescriptionRow(id, committedRow.brief, committedRow.updated_at);
                _prodToast('Description updated');
                _prodRender();
                _prodFocusDescriptionControl(id, 'edit');
            } catch (error) {
                _writeUiRecordFailure('production', 'description', error, { id: String(id) });
                /* A write_conflict hands back the row that won. For a batch
                   parent that is a BATCH carrying `description`, not a
                   deliverable carrying `brief` -- reading the wrong field would
                   silently replace the loser's text with an empty string and
                   present it as the server's answer. */
                const parentConflict = issue.syntheticBatchParent === true;
                /* The winning row arrives as `batch` with its text beside it,
                   because publicRow has no description field. Reading `brief`
                   off it -- which the first version did -- found nothing, so
                   the loser kept its own stale text and, worse, its own stale
                   CLOCK, and every retry conflicted again forever. */
                const serverRow = parentConflict
                    ? (error && error.batch && typeof error.batchDescription === 'string' ? error.batch : null)
                    : (error && error.row
                        && Object.prototype.hasOwnProperty.call(error.row, 'brief') ? error.row : null);
                if (serverRow) {
                    state.value = _prodDescriptionText(
                        parentConflict ? error.batchDescription : serverRow.brief
                    );
                    state.baseline = state.value;
                    state.hasValue = true;
                    state.status = 'ready';
                    state.sourceUpdatedAt = serverRow.updated_at || state.sourceUpdatedAt;
                    if (parentConflict) _prodSyncBatchDescriptionRow(id, state.value, serverRow.updated_at);
                    else _prodSyncDescriptionRow(id, serverRow.brief, serverRow.updated_at);
                } else {
                    state.value = previous.value;
                    state.baseline = previous.baseline;
                    state.hasValue = previous.hasValue;
                    state.status = previous.status;
                    state.sourceUpdatedAt = previous.updatedAt;
                    // The genuine revert: the text itself did not change, so
                    // whatever rendered projection was valid for it before
                    // the failed attempt is still valid for it now.
                    state.renderValue = previous.renderValue;
                    state.renderExpiresAt = previous.renderExpiresAt;
                    if (parentConflict) _prodSyncBatchDescriptionRow(id, previous.value, previous.updatedAt);
                    else _prodSyncDescriptionRow(id, previous.value, previous.updatedAt);
                }
                state.saving = false;
                state.editing = true;
                state.preview = false;
                /* The SAME operation the write used. Computing the refusal
                   text with the other name is what turned a gate that had
                   already decided into the last-resort sentence. */
                state.error = _prodWriteErrorText(error, issue, _prodDescriptionOperation(issue));
                state.remoteChanged = !!serverRow;
                if (String(error && error.code || '') === 'write_conflict') state.requestId = '';
                _prodToast(state.error);
                _prodRender();
                _prodFocusDescriptionControl(id, _prodDescriptionEditorControl(state));
            }
            return false;
        }
        function _prodRefreshDescription(id) {
            // Same acknowledgement rule as the manual refresh: the fetch may
            // finish (or early-return) with the panel unchanged, and the
            // press still deserves a visible response.
            _prodToast('Refreshing description\u2026');
            _prodEnsureDescription(id, true);
            return false;
        }
        function _prodDescriptionPanelHTML(issue) {
            const state = _prodDescriptionState(issue && issue.id);
            if (!issue || !state) return '';
            const id = String(issue.id || '');
            const status = state.refreshing ? 'refreshing' : state.status;
            const count = String(state.draft || '').length;
            /* The Edit control is gated on the operation the save will send, so a
               button can never render enabled for a write its own gate refuses. */
            const gateAttrs = _prodWriteGateAttrs(issue, _prodDescriptionOperation(issue), { title: 'Edit description', tip: 'Edit description' });
            const writable = _prodCanWrite(issue, _prodDescriptionOperation(issue));
            if (state.editing) {
                const source = !!state.source;
                /* IN PLACE (2026-09-06). The visual editor is the read view
                   made editable: same classes, same type, same box, grows with
                   the text. Markdown is one toggle away, and is what opens when
                   the text cannot be shown exactly. */
                const handlers = ' onkeydown="return _prodDescriptionEditorKeydown(event,' + _jsAttrArg(id) + ')"'
                    + ' onpaste="return _prodDescriptionPaste(event,' + _jsAttrArg(id) + ')"'
                    + ' ondrop="return _prodDescriptionDrop(event,' + _jsAttrArg(id) + ')"'
                    + ' ondragover="return _prodDescriptionDragOver(event)"'
                    + ' ondragleave="return _prodDescriptionDragLeave(event)"';
                const editor = source
                    ? '<div class="prod-description-editor"><textarea class="prod-description-textarea" data-prod-description-control="source" aria-label="Description Markdown source" maxlength="100000"'
                        + ' oninput="_prodDescriptionDraftInput(' + _jsAttrArg(id) + ',this.value,this)"'
                        + ' onselect="_prodDescriptionRememberSelection(' + _jsAttrArg(id) + ',this)"'
                        + ' onkeyup="_prodDescriptionRememberSelection(' + _jsAttrArg(id) + ',this)"'
                        + ' onclick="_prodDescriptionRememberSelection(' + _jsAttrArg(id) + ',this)"'
                        + handlers + (state.saving ? ' disabled' : '') + '>' + _calEsc(state.draft) + '</textarea>'
                        + '<div class="prod-description-footer"><span class="prod-description-count' + (count > 100000 ? ' is-invalid' : '') + '" data-prod-description-count>' + count.toLocaleString() + ' / 100,000</span>'
                        + '<span class="prod-description-hint" data-prod-description-hint>Paste or drop an image to add it</span>'
                        + '</div></div>'
                    : '<div class="prod-description-rich prod-desc' + (String(state.draft || '').trim() ? '' : ' is-empty') + '" data-prod-description-control="rich" contenteditable="' + (state.saving ? 'false' : 'true') + '" role="textbox" aria-multiline="true" aria-label="Description" spellcheck="true"'
                        + ' oninput="_prodDescriptionRichInput(' + _jsAttrArg(id) + ',this)"'
                        + ' onkeyup="_prodDescriptionRememberCaret(' + _jsAttrArg(id) + ',this)"'
                        + ' onclick="_prodDescriptionRememberCaret(' + _jsAttrArg(id) + ',this)"'
                        + handlers + '>' + _prodDescRichBuild(state.draft) + '</div>'
                        + '<div class="prod-description-footer prod-description-footer-rich"><span class="prod-description-hint" data-prod-description-hint>Paste or drop an image to add it</span>'
                        + '<span class="prod-description-count' + (count > 100000 ? ' is-invalid' : '') + (count < 90000 ? ' is-quiet' : '') + '" data-prod-description-count data-prod-description-count-quiet="1">' + count.toLocaleString() + ' / 100,000</span>'
                        + '</div>';
                const editorState = state.error
                    ? '<div class="prod-description-state is-error" data-prod-description-write-error>' + _calEsc(state.error) + '</div>'
                    : state.refreshing
                        ? '<div class="prod-description-state" data-prod-description-refreshing>Refreshing the server description. Your draft and cursor are preserved.</div>'
                        : state.saving
                            ? '<div class="prod-description-state" data-prod-description-saving>Saving description…</div>'
                            : state.sourceReason
                                ? '<div class="prod-description-state" data-prod-description-source-notice>' + _calEsc(state.sourceReason) + '</div>'
                                : '';
                return '<section class="prod-description" data-prod-description="' + _calEscAttr(id) + '" data-prod-description-state="' + _calEscAttr(status) + '" data-prod-description-mode="' + (source ? 'source' : 'rich') + '" aria-labelledby="prod-description-title-' + _calEscAttr(id) + '">'
                    + '<div class="prod-description-head"><span class="prod-description-title" id="prod-description-title-' + _calEscAttr(id) + '">Description</span>'
                    + '<div class="prod-description-actions">'
                    + '<button class="prod-description-action' + (source ? ' is-active' : '') + '" type="button" data-prod-description-control="markdown-tab" aria-pressed="' + (source ? 'true' : 'false') + '" onclick="return _prodSetDescriptionMode(' + _jsAttrArg(id) + ',' + _jsAttrArg(source ? 'rich' : 'source') + ')"' + (state.saving ? ' disabled' : '') + '>Markdown</button>'
                    + '<button class="prod-description-action" type="button" data-prod-description-control="cancel" onclick="return _prodCancelDescriptionEdit(' + _jsAttrArg(id) + ')"' + (state.saving ? ' disabled' : '') + '>Cancel</button>'
                    + '<button class="prod-description-action prod-description-save" type="button" data-prod-description-control="save" onclick="return _prodSaveDescription(event,' + _jsAttrArg(id) + ')"' + (state.saving || count > 100000 || state.uploading > 0 ? ' disabled' : '') + '>' + (state.saving ? 'Saving…' : 'Save') + '</button>'
                    + '</div></div>' + editor + editorState + '</section>';
            }
            /* The read view is click-to-edit where a write is allowed: the
               text is the control, the way it is in Linear. The Edit button
               stays for the keyboard and for the gate's own copy when a write
               is refused. */
            const clickEdit = writable && state.status === 'ready' && !state.refreshing;
            const body = state.status === 'error'
                ? ''
                : '<div class="prod-description-body prod-desc"' + (clickEdit ? ' data-prod-desc-click-edit="1" onclick="return _prodDescriptionBodyClick(event,' + _jsAttrArg(id) + ')"' : '') + '>' + _prodDescriptionHTML(state.renderValue || state.value, state.hasValue, 'No description.', true) + '</div>';
            const readState = state.status === 'error'
                ? '<div class="prod-description-state is-error" data-prod-description-error>' + _calEsc(state.error || 'Description could not load.')
                    + '<button type="button" onclick="return _prodRefreshDescription(' + _jsAttrArg(id) + ')">Retry</button></div>'
                : state.refreshError
                    ? '<div class="prod-description-state is-error" data-prod-description-refresh-error>' + _calEsc(state.refreshError)
                        + '<button type="button" onclick="return _prodRefreshDescription(' + _jsAttrArg(id) + ')">Retry</button></div>'
                    : (state.status === 'stale' || state.refreshing) && !state.refreshSilent
                        ? '<div class="prod-description-state" data-prod-description-refreshing>Refreshing description… The text shown may be outdated.</div>'
                        : '';
            return '<section class="prod-description" data-prod-description="' + _calEscAttr(id) + '" data-prod-description-state="' + _calEscAttr(status) + '" aria-labelledby="prod-description-title-' + _calEscAttr(id) + '">'
                + '<div class="prod-description-head"><span class="prod-description-title" id="prod-description-title-' + _calEscAttr(id) + '">Description</span>'
                /* The header Refresh button is gone (2026-08-30). Its premise
                   was that Linear could change a description underneath the
                   page, which the flip retired: linear-inbound is detect-only
                   for both teams now, and the only remaining writer of an
                   existing brief is this panel itself. The 30-second delta tick
                   plus the freshness chip cover staleness, and on a batch parent
                   the button was a phantom -- it fired a toast for a row the
                   gateway cannot read. _prodRefreshDescription itself STAYS: the
                   Retry buttons in the two error banners are the real escape
                   from a failed read, and that case is load-bearing. */
                + '<div class="prod-description-actions">'
                + '<button class="prod-description-action" type="button" data-prod-description-control="edit" data-prod-description-edit="1" data-prod-description-ready="' + (state.status === 'ready' && !state.refreshing ? '1' : '0') + '" onclick="return _prodBeginDescriptionEdit(' + _jsAttrArg(id) + ')"' + gateAttrs + '>Edit</button>'
                + '</div></div>' + body + readState + '</section>';
        }
        function _prodFileLinkLabel(file) {
            const raw = String(file || '').trim();
            if (!raw) return 'Open link';
            let url = null;
            try { url = new URL(raw); } catch (e) { return 'Open link'; }
            const host = String(url.hostname || '').replace(/^www\./i, '').toLowerCase();
            const path = String(url.pathname || '');
            if (host.endsWith('drive.google.com')) {
                if (/\/folders\//i.test(path)) return 'Open folder';
                return 'Open file';
            }
            if (host.endsWith('docs.google.com')) return 'Open document';
            if (host.endsWith('dropbox.com')) {
                if (/\/scl\/fo\/|\/sh\//i.test(path)) return 'Open folder';
                return 'Open file';
            }
            if (host.endsWith('frame.io') || host.endsWith('app.frame.io')) return 'Open Frame.io';
            return 'Open link';
        }
        function _prodAssetStateLabel(state) {
            const labels = {
                missing: 'Missing',
                invalid: 'Invalid',
                checking: 'Checking',
                available: 'Available',
                expired: 'Expired',
                permission_denied: 'Permission denied',
                unavailable: 'Unavailable',
                /* Browser-side only: the gateway's vocabulary has no such
                   state. It is `unavailable` whose probe never completed,
                   separated here because the two read as opposite claims. */
                unverified: 'Not checked'
            };
            return labels[String(state || '')] || 'Unavailable';
        }
        function _prodAssetsPanelHTML(issue, options) {
            options = options || {};
            if (!issue) return '';
            const id = String(issue.id || '');
            const state = _prodAssetState(id, issue);
            const allowedSlots = new Set(options.slots || PROD_ASSET_SPECS.map(spec => spec.key));
            const specs = PROD_ASSET_SPECS.filter(spec => allowedSlots.has(spec.key));
            const graphics = _prodWriteTeam(issue.team) === 'graphics';
            const editorHTML = spec => {
                const operation = spec.write || '';
                const pending = state.saving || _prodWritePending(id, operation);
                const batchWide = operation === 'batch_asset';
                return '<form class="prod-assets-editor" data-prod-assets-editor="' + _calEscAttr(id) + '"'
                    + ' data-prod-assets-editor-slot="' + _calEscAttr(spec.key) + '"'
                    + ' onsubmit="return _prodSaveAsset(event,' + _jsAttrArg(id) + ')">'
                    + '<input class="prod-assets-input" data-prod-asset-input="' + _calEscAttr(id) + '" type="url" maxlength="2048" autocomplete="off" spellcheck="false" placeholder="'
                    + _calEscAttr(batchWide ? 'Paste a supported HTTPS folder link, or clear it to empty' : 'Paste a supported HTTPS deliverable link')
                    + '" value="' + _calEscAttr(state.draft) + '" oninput="_prodAssetDraftInput(' + _jsAttrArg(id) + ',this.value)"' + (pending ? ' disabled' : '') + '>'
                    /* Say the blast radius before the press, not after. These
                       two links live on the batch, so this edit is visible on
                       every sibling sub-issue and on the parent -- which is the
                       point, and exactly the kind of thing a reader should not
                       have to discover by watching another issue change. */
                    + (batchWide ? '<div class="prod-assets-scope">Shared by the whole post — the parent issue and every sub-issue show this link.</div>' : '')
                    + '<div class="prod-assets-editor-actions"><button class="prod-assets-action" type="button" onclick="return _prodCancelAssetEdit(' + _jsAttrArg(id) + ')"' + (pending ? ' disabled' : '') + '>Cancel</button><span class="prod-spacer"></span>'
                    + '<button class="prod-assets-action prod-assets-save" type="submit"' + (pending ? ' disabled' : '') + '>'
                    + (pending ? 'Saving…' : (batchWide ? 'Save for the batch' : 'Save deliverable')) + '</button></div>'
                    + (state.writeError ? '<div class="prod-assets-error" role="alert">' + _calEsc(state.writeError) + '</div>' : '') + '</form>';
            };
            const rows = specs.map(spec => {
                const asset = state.assets && state.assets[spec.key] || { url: '', state: 'missing' };
                const url = String(asset.url || '').trim();
                const rawAssetState = String(asset.state || (url ? 'checking' : 'missing'));
                /* UNVERIFIED IS NOT UNAVAILABLE, and the gateway already knows
                   which is which. From probeAssetUrl's own note: "`unavailable`
                   with a status means the fetch completed and the content was
                   not media. `unavailable` WITHOUT one means" the redirect
                   chain was refused, the request timed out, or the host was
                   unreachable.

                   Those are opposite messages to a reader. One says the link
                   does not lead to reviewable work. The other says this server
                   could not look -- which is the NORMAL answer for a private
                   Frame.io project, whose share URL redirects to an auth host
                   that is deliberately not on the probe's redirect allowlist.

                   Owner report 2026-08-31: a Frame folder link he had just
                   saved, and could open, sat under a red Unavailable. The probe
                   was not wrong; the word was. It is a REPORT, never a gate
                   (see the batch_asset gateway note), so a slot it could not
                   reach must not be painted like a broken one. */
                const assetState = rawAssetState === 'unavailable'
                    && String(url || '').trim()
                    && !Number(asset.http_status || 0)
                    ? 'unverified'
                    : rawAssetState;
                /* The VALUE column is the loud one. Changing only the state
                   pill left "Not provided" sitting where the reader looks
                   first, so the row still asserted the absence it was supposed
                   to stop asserting -- and the correction lived in a tooltip on
                   a non-focusable span, which keyboard and touch users never
                   see at all. When the slot is unreadable rather than empty,
                   the explanation IS the value. */
                const unreadable = !url && assetState === 'unavailable' && String(asset.guidance || '').trim();
                /* Borrowed, and it says so. This link is the one on the card
                   bound to this deliverable -- the same field the SMM calls
                   Video URL -- shown here because the deliverable carries no
                   canonical file of its own yet. Presenting it silently would
                   make the panel claim a value it does not hold; naming the
                   source is also the only thing that explains why editing this
                   row changes what the calendar shows. */
                const borrowed = url && (asset.source === 'calendar_card' || asset.source === 'samples_card')
                    ? '<span class="prod-asset-origin">from the '
                        + (asset.source === 'samples_card' ? 'samples card' : 'content calendar')
                        + '</span>'
                    /* The filming plan resolved from the client rather than
                       from this batch's own column, which is empty for every
                       batch not made through the intake path. Same rule as
                       above: the panel names the source instead of passing the
                       client's plan off as the batch's. It also answers the
                       question the reader would otherwise ask -- this slot has
                       no Edit control, so "where did this come from" has no
                       other way of being answered on screen. */
                    : url && asset.source === 'client_plan'
                    ? '<span class="prod-asset-origin">from the client</span>'
                    /* The post holds this link on a different batch row than
                       the one this deliverable names. Same rule as the two
                       above: a row says when it is showing something it does
                       not itself store. It also answers the question the reader
                       would otherwise ask on a split post -- why the parent and
                       the sub-issue now agree when their rows do not. */
                    : url && asset.source === 'post'
                    ? '<span class="prod-asset-origin">from the post</span>'
                    : '';
                /* FIRST PAINT DRAWS A SKELETON, not a word.
                   After the revalidate-in-place change, `checking` on an empty
                   slot can only mean one thing: nobody has read this row yet.
                   A refresh keeps its last answer on screen, so this no longer
                   appears between two identical states -- which is what made it
                   read as the page being flaky rather than as it loading.
                   Owner ruling 2026-08-31: "the first time I understand ... I
                   would prefer a skeleton animation."
                   Shape over text, because a shimmer says "not yet" without
                   asserting anything about the slot, which is the whole
                   difference between this and every other state here. */
                const pending = !url && assetState === 'checking';
                const value = pending
                    ? '<span class="prod-asset-skeleton" aria-label="Checking access"></span>'
                    : url
                        ? '<a href="' + _calEscAttr(url) + '" target="_blank" rel="noopener noreferrer" title="' + _calEscAttr(url) + '">' + _calEsc(_prodFileLinkLabel(url)) + '</a>' + borrowed
                        : '<span>' + _calEsc(unreadable ? String(asset.guidance).trim() : 'Not provided') + '</span>';
                const tip = String(asset.guidance || (asset.checked_at ? 'Checked ' + asset.checked_at : _prodAssetStateLabel(assetState)));
                /* The control belongs on the ROW, not in the header.
                   There used to be one writable slot, so one header button
                   could mean "the deliverable file" without saying so. Three
                   slots are writable now and one -- the filming plan -- must
                   never be, and a single header button cannot express that: it
                   would either offer the wrong slot or need the reader to
                   already know which one it means. A row that can be edited
                   says so on itself, and the filming plan simply carries no
                   control, which is the whole rule made visible. */
                const operation = spec.write || '';
                const editable = !options.readOnly && !!operation;
                const rowEditor = editable
                    ? '<button class="prod-assets-action prod-asset-edit" type="button"'
                        + ' data-prod-asset-edit="' + _calEscAttr(spec.key) + '"'
                        + ' onclick="return _prodBeginAssetEdit(' + _jsAttrArg(id) + ',' + _jsAttrArg(spec.key) + ')"'
                        + _prodWriteGateAttrs(issue, operation, {
                            tip: operation === 'batch_asset'
                                ? 'Edit this link for every issue on this post'
                                : 'Attach or replace the canonical deliverable'
                        }) + '>Edit</button>'
                    : '';
                return '<div class="prod-asset-row" data-prod-asset-slot="' + _calEscAttr(spec.key) + '">'
                    + '<span class="prod-asset-label">' + _calEsc(graphics && spec.graphicsLabel ? spec.graphicsLabel : spec.label) + '</span>'
                    + '<span class="prod-asset-value">' + value + '</span>'
                    + (pending
                        ? '<span class="prod-asset-state prod-asset-skeleton prod-asset-skeleton-pill" data-state="checking" aria-hidden="true"></span>'
                        : '<span class="prod-asset-state" data-state="' + _calEscAttr(assetState) + '" title="' + _calEscAttr(tip) + '" data-prod-tip="' + _calEscAttr(tip) + '">' + _calEsc(_prodAssetStateLabel(assetState)) + '</span>')
                    + rowEditor + '</div>'
                    + (state.editing === spec.key ? editorHTML(spec) : '');
            }).join('');
            /* Attach is no longer graphics-only. The database learned the video
               projection (2026-08-30-artifact-video-projection.sql: file_url
               lands in calendar_posts.asset_url keyed on video_deliverable_id,
               where a graphics artifact lands in thumbnail_url keyed on
               graphic_deliverable_id), and the two server guards above it moved
               with it. So the panel asks the ONE question it should always have
               asked -- may this person write this operation on this row -- and
               lets _prodCanWrite answer for both teams. `graphics` survives
               only to pick the row LABEL, which genuinely differs. */
            /* One gate sentence for the panel, taken from the slots it actually
               shows. A panel of writable rows whose reader may write none of
               them still owes an explanation; a panel that is read-only by
               construction (the batch parent view) owes none, because it is
               not offering anything. */
            const writableSpecs = options.readOnly ? [] : specs.filter(spec => spec.write);
            const blockedSpec = writableSpecs.find(spec => !_prodCanWrite(issue, spec.write));
            const gate = writableSpecs.length && blockedSpec && writableSpecs.every(
                spec => !_prodCanWrite(issue, spec.write))
                ? _prodWriteGateText(issue, blockedSpec.write)
                : '';
            const readError = state.error
                ? '<div class="prod-assets-error" role="alert">' + _calEsc(state.error) + '</div>'
                : gate && !state.editing
                    ? '<div class="prod-asset-value">' + _calEsc(gate) + '</div>'
                    : '';
            return '<section class="prod-assets" data-prod-assets="' + _calEscAttr(id) + '" data-prod-assets-status="' + _calEscAttr(state.status) + '">'
                + '<div class="prod-assets-head"><span class="prod-assets-title">Assets</span><span class="prod-spacer"></span>'
                /* Refresh access re-probes Drive and Frame sharing through the
                   authenticated prober, which has no row to authorize on a
                   synthetic batch parent -- so there it toasted and changed
                   nothing, the same phantom the Description header just lost.
                   One rule for both refresh controls: if the reader cannot act,
                   do not offer the control. */
                + (issue.syntheticBatchParent === true ? ''
                    : '<button class="prod-assets-refresh" type="button" onclick="return _prodRefreshAssetsManual(' + _jsAttrArg(id) + ')"' + (state.status === 'loading' ? ' disabled' : '') + '>' + (state.status === 'loading' ? 'Checking…' : 'Refresh access') + '</button>')
                + '</div><div class="prod-assets-list">' + rows + '</div>' + readError + '</section>';
        }
        function _prodPlacePop(pop, x, y) {
            if (!pop) return;
            const r = pop.getBoundingClientRect();
            let nx = x;
            let ny = y;
            if (nx + r.width > innerWidth - 8) nx = innerWidth - r.width - 8;
            if (ny + r.height > innerHeight - 8) ny = Math.max(8, innerHeight - r.height - 8);
            nx = Math.max(8, nx);
            ny = Math.max(8, ny);
            pop.style.left = nx + 'px';
            pop.style.top = ny + 'px';
        }
        // PORT-DELTA: body overlay IDs/classes are namespaced for the embedded Production tab.
        function _prodLayerPop(html, x, y) {
            _prodEnsureOverlays();
            const layer = document.getElementById('prodLayer');
            layer.innerHTML = '';
            layer.style.pointerEvents = 'auto';
            const bd = document.createElement('div');
            bd.className = 'prod-pop-bd';
            bd.addEventListener('click', e => {
                const x = e.clientX;
                const y = e.clientY;
                const root = document.getElementById('prodRoot');
                layer.style.pointerEvents = 'none';
                const next = document.elementFromPoint(x, y);
                layer.style.pointerEvents = 'auto';
                const target = next && next.closest ? next.closest('#prodFilterBtn, #prodGroupBtn, [data-prod-prop], .prod-status[data-st], .prod-due, .prod-assign-hot, [data-prod-pstatus], [data-prod-plead], [data-prod-ptarget]') : null;
                _prodClearLayer();
                if (target && (target.id === 'prodFilterBtn' || target.id === 'prodGroupBtn')) return;
                if (target && root && root.contains(target)) {
                    setTimeout(() => {
                        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
                    }, 0);
                }
            });
            bd.addEventListener('contextmenu', e => { e.preventDefault(); _prodClearLayer(); });
            layer.appendChild(bd);
            const pop = document.createElement('div');
            pop.className = 'prod-pop';
            pop.innerHTML = html;
            pop.style.visibility = 'hidden';
            pop.addEventListener('click', e => e.stopPropagation());
            pop.addEventListener('contextmenu', e => e.preventDefault());
            layer.appendChild(pop);
            _prodPlacePop(pop, x, y);
            pop.style.visibility = 'visible';
            return pop;
        }
        let _prodSubPop = null;
        function _prodSetSubPop(value) { _prodSubPop = value; }
        function _prodCloseSub() {
            if (_prodSubPop) {
                _prodSubPop.remove();
                _prodSubPop = null;
            }
        }
        function _prodWirePlainMenu(pop) {
            const visible = () => Array.from(pop.querySelectorAll('.prod-mi')).filter(el => el.style.display !== 'none');
            let sel = -1;
            const hi = n => {
                const rows = visible();
                if (!rows.length) return;
                sel = ((n % rows.length) + rows.length) % rows.length;
                rows.forEach((el, i) => el.classList.toggle('sel', i === sel));
                rows[sel].scrollIntoView({ block: 'nearest' });
            };
            pop.querySelectorAll('.prod-mi').forEach(el => el.addEventListener('mousemove', () => {
                const rows = visible();
                const ix = rows.indexOf(el);
                if (ix >= 0 && ix !== sel) {
                    sel = ix;
                    rows.forEach((o, i) => o.classList.toggle('sel', i === sel));
                }
            }));
            pop.addEventListener('keydown', e => {
                if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); hi(sel + 1); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); hi(sel < 0 ? -1 : sel - 1); return; }
                if (e.key === 'Enter' || e.key === 'ArrowRight') {
                    const rows = visible();
                    const row = rows[sel >= 0 ? sel : 0];
                    if (row) {
                        e.preventDefault();
                        e.stopPropagation();
                        row.click();
                    }
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    _prodClearLayer();
                }
            });
            pop.setAttribute('tabindex', '-1');
            setTimeout(() => { try { pop.focus(); } catch (e) {} }, 0);
        }
        function _prodTargetIds(id) {
            const sid = String(id || '');
            const selected = _prodState.selected || new Set();
            if (sid && selected.has(sid) && selected.size > 1) {
                // Same surface the selection was made on -- _prodFlatOrder is the
                // grouped top-level list and silently dropped every sub-issue
                // when the bulk action was raised from a detail or batch view.
                const visible = new Set(_prodVisibleRowOrder());
                const ids = Array.from(selected).filter(x => visible.has(x));
                if (ids.length) return ids;
            }
            return [sid].filter(Boolean);
        }
        function _prodCurVal(kind, id) {
            const it = _prodIssue(id);
            if (!it) return null;
            if (kind === 'status') return it.status;
            if (kind === 'assign') return it.assignee || '_';
            if (kind === 'proj') return it.project;
            if (kind === 'due') return it.due || '';
            return null;
        }
        /* F50 DISCLOSURE — say when a status has no word on the card.
           Owner ruling 2026-08-10: the five statuses with no card equivalent
           keep the card exactly as it is, "and the UI states plainly that the
           change is not reflected on the calendar". The keep-the-card half
           shipped with _calMapNativeStatusStrict; this is the other half, which
           stayed a code comment until now. The ruling also fixed WHY: the card
           vocabulary is deliberately small so the team is not confused by it,
           so the answer is never to add the missing word, only to say it is
           missing.

           Derived from the mapper rather than from a hand-kept list of
           triage/canceled/duplicate, so the sentence can never disagree with
           what the projection actually does -- including the surface-specific
           case, where Scheduled and Posted are real calendar words but have no
           equivalent on a samples sheet.

           It lives in the picker, before the choice, rather than in a toast
           afterwards: a person deciding between Canceled and Duplicate should
           know what each one will and will not do, and one more notification
           after the fact is exactly the noise the owner asked to be rid of. */
        function _prodCardSurfaceFor(issue) {
            return String(issue && issue.origin || '').trim().toLowerCase() === 'samples' ? 'samples' : 'calendar';
        }
        function _prodStatusCardBlindNote(artifactKey, targets) {
            const native = PROD_STATUS_FROM_ARTIFACT[String(artifactKey || '').trim()] || '';
            if (!native) return '';
            // Only a card-linked deliverable has a card to be out of step with.
            const linked = (targets || []).filter(t => String(t && t.card_id || '').trim());
            if (!linked.length) return '';
            const blind = linked.filter(t => !_calMapNativeStatusStrict(native, _prodCardSurfaceFor(t)));
            if (!blind.length) return '';
            const surfaces = new Set(blind.map(_prodCardSurfaceFor));
            const where = surfaces.size > 1
                ? 'the calendar or the samples sheet'
                : (surfaces.has('samples') ? 'the samples sheet' : 'the calendar');
            if (blind.length === linked.length) {
                return linked.length > 1
                    ? 'Not shown on ' + where + ' — those cards keep the status they have now.'
                    : 'Not shown on ' + where + ' — the card keeps the status it has now.';
            }
            return blind.length + ' of these are not shown on ' + where + ' — those cards keep the status they have now.';
        }
        function _prodPickerSpec(kind, ids) {
            const issue = ids && ids.length ? _prodIssue(ids[0]) : null;
            if (kind === 'status') {
                const identity = _syncviewStaffIdentityForHeaders();
                const role = String(identity && identity.role || '').trim().toLowerCase();
                // F136: the offered set is the intersection of what every
                // selected row's current state permits, so a multi-select never
                // offers a transition the gateway would refuse on one of them.
                const targets = (ids || []).map(_prodIssue).filter(Boolean);
                const creativeAllowed = targets.length
                    ? targets.map(target => new Set(_prodCreativeNextStatuses(target)
                        .map(status => PROD_STATUS_TO_ARTIFACT[status] || status)))
                        .reduce((acc, set) => new Set([...acc].filter(key => set.has(key))))
                    : new Set();
                const statusOrder = role === 'creative'
                    ? PROD_STATUS_ORDER.filter(key => creativeAllowed.has(key))
                    : PROD_STATUS_ORDER;
                const smmGate = (ids || []).map(_prodIssue).filter(Boolean)
                    .map(_prodSmmArtifactGate).find(gate => !gate.ok);
                return {
                    hd: 'Change status...',
                    search: true,
                    items: statusOrder.map((k, n) => {
                      const blindNote = _prodStatusCardBlindNote(k, targets);
                      return {
                        v: k,
                        label: _prodStatusLabel(k),
                        // The gateway probes the artifact itself on every SMM
                        // approval and refuses with a message that names the
                        // problem. Disabling the option here on top of that
                        // demanded a manual Assets refresh within the last five
                        // minutes before the designer could even TRY, which is
                        // what she reported on 2026-08-17: "sale refresh access
                        // in assets cuando quiero marcarlo". The option stays
                        // selectable; the gate keeps its advisory hint, and the
                        // server remains the authority that can actually refuse.
                        disabled: false,
                        guidance: k === 'smm' && smmGate ? smmGate.guidance : blindNote,
                        html: '<span class="mic">' + _prodStatusSVG(k) + '</span><span class="mlbl">' + _calEsc(_prodStatusLabel(k))
                            + (k === 'smm' && smmGate ? '<small>Needs a deliverable link</small>'
                                : blindNote ? '<small>' + _calEsc(blindNote) + '</small>' : '')
                            + '</span><span class="kbd">' + (n < 10 ? (n + 1) % 10 : '') + '</span>'
                      };
                    })
                };
            }
            if (kind === 'assign') {
                // F94: candidates come only from the gateway's eligible-assignee
                // projection. Loading, refused, and unavailable states offer no
                // selectable member — the picker never guesses from the roster.
                const editors = _prodEditors();
                const state = issue ? _prodAssigneeOptionsState(issue.id) : null;
                const ready = !!state && state.status === 'ready';
                const notice = !state || state.status === 'loading'
                    ? 'Checking who can be assigned…'
                    : state.status === 'error'
                        ? state.error || 'Eligible assignees could not be loaded.'
                        : ready && !state.candidates.length
                            ? 'No eligible assignee for this team.'
                            : '';
                const unassigned = {
                    v: '_',
                    label: 'Unassigned',
                    disabled: !ready,
                    guidance: notice,
                    html: '<span class="mic">' + _prodIcon('assign') + '</span><span class="mlbl">Unassigned</span>'
                };
                const candidates = ready
                    ? state.candidates.map(candidate => ({
                        v: candidate.id,
                        label: candidate.name || (editors[candidate.id] && editors[candidate.id].name) || 'Unnamed team member',
                        html: '<span class="mic">' + _prodAvatar(editors[candidate.id] || { name: candidate.name, init: _prodInitials(candidate.name) }, 16)
                            + '</span><span class="mlbl">' + _calEsc(candidate.name || 'Unnamed team member') + '</span>'
                    }))
                    : [];
                return {
                    hd: 'Assign to...',
                    search: true,
                    notice,
                    noticeRetry: !!state && state.status === 'error' && !!issue,
                    noticeRetryId: issue ? issue.id : '',
                    items: [unassigned].concat(candidates)
                };
            }
            if (kind === 'proj') {
                const projects = _prodProjects();
                return {
                    hd: 'Move to project...',
                    search: true,
                    items: Object.keys(projects).sort((a, b) => String(projects[a].name).localeCompare(String(projects[b].name))).map(k => ({
                        v: k,
                        label: projects[k].name,
                        html: '<span class="mic">' + _prodProjectGlyph(projects[k]) + '</span><span class="mlbl">' + _calEsc(projects[k].name) + '</span>'
                    }))
                };
            }
            return {
                hd: 'Set due date...',
                ph: 'Type a date, e.g. Jul 20 2027',
                custom: true,
                items: [
                    ['Today', _prodPolicyTodayISO()],
                    ['Tomorrow', _prodIsoFromDate(_prodAddDays(_prodToday(), 1))],
                    ['Next week', _prodIsoFromDate(_prodAddDays(_prodToday(), 7))],
                    ['No due date', '']
                ].map(o => ({ v: o[1], label: o[0], html: '<span class="mic">' + _prodIcon('cal') + '</span><span class="mlbl">' + _calEsc(o[0]) + '</span>' }))
            };
        }
        function _prodPickerHTML(kind, cur, ids) {
            const d = _prodPickerSpec(kind, ids);
            const search = d.search || d.custom;
            const notice = d.notice
                ? '<div class="prod-pop-empty" data-prod-picker-notice>' + _calEsc(d.notice)
                    + (d.noticeRetry
                        ? ' <button class="prod-label-retry" type="button" data-prod-picker-retry="'
                            + _calEscAttr(d.noticeRetryId || '') + '">Retry</button>'
                        : '')
                    + '</div>'
                : '';
            return (search ? '<div class="prod-pop-search"><input data-prod-search placeholder="' + _calEscAttr(d.ph || d.hd) + '"></div>' : '<div class="prod-pop-hd">' + _calEsc(d.hd) + '</div>')
                + notice
                + '<div class="prod-pop-list">' + d.items.map((it, i) => '<div class="prod-mi" data-prod-pick="' + i + '" aria-disabled="' + (it.disabled ? 'true' : 'false') + '"'
                    + (it.guidance ? ' title="' + _calEscAttr(it.guidance) + '" data-prod-tip="' + _calEscAttr(it.guidance) + '"' : '') + '>'
                    + it.html + (it.v === cur ? '<span class="tick">' + _prodIcon('check') + '</span>' : '') + '</div>').join('') + '</div>';
        }
        function _prodWirePicker(pop, kind, ids) {
            const d = _prodPickerSpec(kind, ids);
            if (kind === 'assign' && ids && ids.length) {
                // Tag the live popup so an in-flight projection can repaint it
                // in place without closing the menu under the pointer.
                pop.setAttribute('data-prod-assign-pop', String(ids[0]));
            }
            pop.querySelectorAll('[data-prod-picker-retry]').forEach(el => el.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                _prodEnsureAssigneeOptions(el.getAttribute('data-prod-picker-retry'), true);
            }));
            const pick = element => {
                const row = element || visible()[sel] || visible()[0];
                const item = row && d.items[+row.getAttribute('data-prod-pick')];
                if (item && item.disabled) {
                    _prodToast(item.guidance || 'Refresh asset access before requesting SMM approval.');
                    const blocked = (ids || []).map(_prodIssue).filter(Boolean)
                        .map(_prodSmmArtifactGate).find(gate => !gate.ok);
                    if (blocked) _prodEnsureAssets(blocked.issue.id, true);
                    return;
                }
                _prodClearLayer();
                if (!item || kind === 'proj') return _prodReadonlyGuard();
                _prodRunPickerWrite(kind, ids, item.v);
            };
            pop.querySelectorAll('[data-prod-pick]').forEach(el => el.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                pick(el);
            }));
            const visible = () => Array.from(pop.querySelectorAll('[data-prod-pick]')).filter(el => el.style.display !== 'none');
            let sel = 0;
            const hi = n => {
                const rows = visible();
                if (!rows.length) return;
                sel = Math.max(0, Math.min(n, rows.length - 1));
                rows.forEach((el, i) => el.classList.toggle('sel', i === sel));
                rows[sel].scrollIntoView({ block: 'nearest' });
            };
            pop.querySelectorAll('[data-prod-pick]').forEach(el => el.addEventListener('mousemove', () => {
                const rows = visible();
                const ix = rows.indexOf(el);
                if (ix >= 0 && ix !== sel) {
                    sel = ix;
                    rows.forEach((o, i) => o.classList.toggle('sel', i === sel));
                }
            }));
            const inp = pop.querySelector('[data-prod-search]');
            if (inp) {
                inp.addEventListener('input', () => {
                    const q = inp.value.toLowerCase();
                    let shown = 0;
                    pop.querySelectorAll('[data-prod-pick]').forEach(el => {
                        const it = d.items[+el.getAttribute('data-prod-pick')];
                        const match = it.label.toLowerCase().includes(q);
                        el.style.display = match ? '' : 'none';
                        if (match) shown++;
                    });
                    _prodPickerEmptyState(pop, shown);
                    hi(0);
                });
                inp.addEventListener('keydown', e => {
                    e.stopPropagation();
                    if (e.key === 'Tab') { e.preventDefault(); return; }
                    if (e.key === 'Escape') { if (_prodSubPop && _prodSubPop === pop) _prodCloseSub(); else _prodClearLayer(); return; }
                    if (e.key === 'ArrowDown') { e.preventDefault(); hi(sel + 1); return; }
                    if (e.key === 'ArrowUp') { e.preventDefault(); hi(sel - 1); return; }
                    if (kind === 'status' && /^[0-9]$/.test(e.key)) {
                        const idx = e.key === '0' ? 9 : (+e.key - 1);
                        if (idx >= 0 && idx < d.items.length) {
                            e.preventDefault();
                            pick(visible()[idx]);
                            return;
                        }
                    }
                    if (e.key === 'Enter') { e.preventDefault(); pick(visible()[sel] || visible()[0]); }
                });
                try { inp.focus(); } catch (e) {}
                setTimeout(() => { try { inp.focus(); } catch (e) {} }, 20);
            }
            const rows = visible();
            const tick = rows.findIndex(el => !!el.querySelector('.tick'));
            hi(tick >= 0 ? tick : 0);
        }
        // PORT-DELTA: submenu opens artifact pickers but routes selections to the read-only guard.
        function _prodOpenSub(parentEl, kind, ids) {
            _prodCloseSub();
            if (kind !== 'proj') {
                /* Act on the writable rows instead of refusing the whole batch
                   because ONE row cannot take the write. Owner report
                   2026-08-20: selecting a batch parent together with its
                   sub-issues made Change status silently unavailable, reporting
                   "This is the post's batch parent" -- true of the parent, and
                   irrelevant to the twenty sub-issues selected with it.

                   A synthetic batch parent has no deliverable row, so it really
                   cannot be written; the mistake was letting it veto everything
                   else. Now it is skipped and SAID ALOUD, because a bulk action
                   that quietly touches fewer rows than were selected is worse
                   than one that refuses. Only a selection with nothing writable
                   still refuses outright, and it explains why using the first
                   blocked row's own reason. */
                const operation = kind === 'assign' ? 'assignee' : kind;
                const all = (ids || []).map(_prodIssue).filter(Boolean);
                const writable = all.filter(issue => _prodCanWrite(issue, operation));
                if (!writable.length) {
                    _prodToast(_prodWriteGateText(all[0] || _prodIssue((ids || [])[0]), operation));
                    return;
                }
                if (writable.length < all.length) {
                    const skipped = all.length - writable.length;
                    _prodToast('Applying to ' + writable.length + ' of ' + all.length
                        + ' — ' + skipped + ' cannot take this change'
                        + (all.some(i => i.syntheticBatchParent === true) ? ' (batch parents have no status of their own)' : ''));
                }
                ids = writable.map(issue => issue.id);
            }
            const p = document.createElement('div');
            p.className = 'prod-pop' + (kind === 'due' ? ' prod-duepop' : '');
            p.style.visibility = 'hidden';
            p.addEventListener('click', e => e.stopPropagation());
            document.getElementById('prodLayer').appendChild(p);
            const r = parentEl.getBoundingClientRect();
            if (kind === 'due') {
                _prodBuildDue(p, _prodIssue(ids[0]), ids, { x: r.right - 4, y: r.top - 6, flipX: r.left });
                _prodSubPop = p;
                return;
            }
            p.innerHTML = _prodPickerHTML(kind, ids.length === 1 ? _prodCurVal(kind, ids[0]) : null, ids);
            if (kind === 'assign' && ids.length) _prodEnsureAssigneeOptions(ids[0], false);
            const pr = p.getBoundingClientRect();
            let x = r.right - 4;
            let y = r.top - 6;
            if (x + pr.width > innerWidth - 8) x = r.left - pr.width + 4;
            const actionPop = parentEl.closest && parentEl.closest('[data-prod-actioncmd]');
            const actionTop = actionPop ? Number(actionPop.getAttribute('data-prod-anchor-top') || 0) : 0;
            if (actionTop) {
                p.style.maxHeight = Math.max(160, actionTop - 16) + 'px';
                p.style.overflowY = 'auto';
                _prodPlacePop(p, Math.max(8, r.left), actionTop - pr.height - 8);
            } else {
                _prodPlacePop(p, x, y);
            }
            p.style.visibility = 'visible';
            _prodWirePicker(p, kind, ids);
            _prodSubPop = p;
        }
        function _prodOpenPicker(kind, ev, id) {
            if (ev) {
                ev.preventDefault();
                ev.stopPropagation();
            }
            const ids = _prodTargetIds(id);
            /* `proj` never opens. It used to build the whole thing -- a
               searchable list of every client, the current one ticked -- and
               then hard-return the read-only guard from the pick handler, so
               the reader chose a project, pressed it, and got a sentence about
               a preview. There is no gateway operation that writes client_slug,
               on any surface, for any role: moving a deliverable between
               clients is not a supported write, and no authority flip or
               permission will make this picker act. Refusing at the door, with
               the reason, is the only honest shape.

               Refused HERE rather than at each caller because there are four --
               the side-card row, the context menu, the bulk palette and Shift+P
               -- and gating three of them would leave the fourth opening a
               picker that still cannot act. The refusal keeps the ratified
               `Preview - read-only` wording out of it: that string is the
               correct answer for a surface awaiting authority, and pixel and
               parity lanes assert it verbatim, but it is the wrong answer here,
               where the control is not waiting for anything. */
            if (kind === 'proj') {
                _prodToast(PROD_PROJECT_MOVE_UNSUPPORTED);
                return false;
            }
            {
                const operation = kind === 'assign' ? 'assignee' : kind;
                const blocked = ids.map(_prodIssue).filter(Boolean).find(issue => !_prodCanWrite(issue, operation));
                if (blocked) {
                    _prodToast(_prodWriteGateText(blocked, operation));
                    return false;
                }
            }
            const actionbar = ev && ev.currentTarget && ev.currentTarget.closest && ev.currentTarget.closest('.prod-actionbar');
            const anchor = actionbar ? ev.currentTarget.getBoundingClientRect() : null;
            const anchorBar = actionbar ? actionbar.getBoundingClientRect() : null;
            const anchorTop = anchorBar ? anchorBar.top : anchor ? anchor.top : null;
            const p = _prodLayerPop('', anchor ? anchor.left : (ev ? ev.clientX : innerWidth / 2), anchorTop != null ? anchorTop - 8 : (ev ? ev.clientY : 160), true);
            if (kind === 'due') {
                p.classList.add('prod-duepop');
                _prodBuildDue(p, _prodIssue(ids[0]), ids, anchor ? { x: anchor.left, y: anchorTop, above: true } : { x: ev ? ev.clientX : innerWidth / 2, y: ev ? ev.clientY : 160 });
            } else {
                p.innerHTML = _prodPickerHTML(kind, ids.length === 1 ? _prodCurVal(kind, ids[0]) : null, ids);
                if (kind === 'assign' && ids.length) _prodEnsureAssigneeOptions(ids[0], false);
                if (anchor) {
                    p.style.maxHeight = Math.max(160, anchorTop - 16) + 'px';
                    p.style.overflowY = 'auto';
                    const pr = p.getBoundingClientRect();
                    _prodPlacePop(p, anchor.left, anchorTop - pr.height - 8);
                } else {
                    _prodPlacePop(p, ev ? ev.clientX : innerWidth / 2, ev ? ev.clientY : 160);
                }
                _prodWirePicker(p, kind, ids);
            }
            return false;
        }
        function _prodOpenStatusMenu(ev, id) { return _prodOpenPicker('status', ev, id); }
        function _prodOpenAssignMenu(ev, id) { return _prodOpenPicker('assign', ev, id); }
        function _prodOpenDueMenu(ev, id) { return _prodOpenPicker('due', ev, id); }
        function _prodOpenProjectMenu(ev, id) { return _prodOpenPicker('proj', ev, id); }
        // PORT-DELTA: artifact project pickers are preserved as read-only card/client controls.
        function _prodProjectPickerSpec(kind) {
            if (kind === 'pstatus') {
                return {
                    hd: 'Change status...',
                    items: PROD_BOARD_ORDER.map(k => ({
                        v: k,
                        label: _prodBoardLabel(k),
                        html: '<span class="mic">' + _prodProjectStatusIcon(k) + '</span><span class="mlbl">' + _calEsc(_prodBoardLabel(k)) + '</span>'
                    }))
                };
            }
            if (kind === 'plead') {
                const editors = _prodEditors();
                return {
                    hd: 'Set lead...',
                    items: [{ v: '_', label: 'No lead', html: '<span class="mic">' + _prodIcon('assign') + '</span><span class="mlbl">No lead</span>' }]
                        .concat(Object.keys(editors).sort((a, b) => String(editors[a].name).localeCompare(String(editors[b].name))).map(k => ({
                            v: k,
                            label: editors[k].name,
                            html: '<span class="mic">' + _prodAvatar(editors[k], 16) + '</span><span class="mlbl">' + _calEsc(editors[k].name) + '</span>'
                        })))
                };
            }
            return {
                hd: 'Set target...',
                items: [
                    { v: '', label: 'No target', html: '<span class="mic">' + _prodIcon('cal') + '</span><span class="mlbl">No target</span>' },
                    { v: _prodFmtDue(_prodAddDays(new Date(), 1)), label: 'Tomorrow', html: '<span class="mic">' + _prodIcon('cal') + '</span><span class="mlbl">Tomorrow</span>' },
                    { v: _prodFmtDue(_prodAddDays(new Date(), 7)), label: 'Next week', html: '<span class="mic">' + _prodIcon('cal') + '</span><span class="mlbl">Next week</span>' }
                ]
            };
        }
        function _prodOpenProjectPicker(kind, ev, slug) {
            if (ev) {
                ev.preventDefault();
                ev.stopPropagation();
            }
            const client = _prodClient(slug);
            if (!client) return false;
            const d = _prodProjectPickerSpec(kind);
            const cur = kind === 'pstatus' ? (client.status || 'prog') : kind === 'plead' ? (client.lead || '_') : (client.target || '');
            const p = _prodLayerPop('<div class="prod-pop-search"><input data-prod-search placeholder="' + _calEscAttr(d.hd) + '"></div><div class="prod-pop-list">'
                + d.items.map((it, i) => '<div class="prod-mi" data-prod-pick="' + i + '" data-prod-ppick="' + i + '">' + it.html + (it.v === cur ? '<span class="tick">' + _prodIcon('check') + '</span>' : '') + '</div>').join('')
                + '</div>', ev ? ev.clientX : innerWidth / 2, ev ? ev.clientY : 160);
            const visible = () => Array.from(p.querySelectorAll('[data-prod-ppick]')).filter(el => el.style.display !== 'none');
            let sel = Math.max(0, visible().findIndex(el => !!el.querySelector('.tick')));
            const hi = n => {
                const rows = visible();
                if (!rows.length) return;
                sel = Math.max(0, Math.min(n, rows.length - 1));
                rows.forEach((el, i) => el.classList.toggle('sel', i === sel));
                rows[sel].scrollIntoView({ block: 'nearest' });
            };
            const pick = () => {
                _prodReadonlyGuard();
                _prodClearLayer();
            };
            p.querySelectorAll('[data-prod-ppick]').forEach(el => {
                el.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    pick();
                });
                el.addEventListener('mousemove', () => {
                    const rows = visible();
                    const ix = rows.indexOf(el);
                    if (ix >= 0 && ix !== sel) {
                        sel = ix;
                        rows.forEach((o, i) => o.classList.toggle('sel', i === sel));
                    }
                });
            });
            const inp = p.querySelector('[data-prod-search]');
            if (inp) {
                inp.addEventListener('input', () => {
                    const q = inp.value.toLowerCase();
                    let shown = 0;
                    p.querySelectorAll('[data-prod-ppick]').forEach(el => {
                        const it = d.items[+el.getAttribute('data-prod-ppick')];
                        const match = it.label.toLowerCase().includes(q);
                        el.style.display = match ? '' : 'none';
                        if (match) shown++;
                    });
                    _prodPickerEmptyState(p, shown);
                    hi(0);
                });
                inp.addEventListener('keydown', e => {
                    e.stopPropagation();
                    if (e.key === 'Tab') { e.preventDefault(); return; }
                    if (e.key === 'Escape') { _prodClearLayer(); return; }
                    if (e.key === 'ArrowDown') { e.preventDefault(); hi(sel + 1); return; }
                    if (e.key === 'ArrowUp') { e.preventDefault(); hi(sel - 1); return; }
                    if (e.key === 'Enter') { e.preventDefault(); pick(); }
                });
                try { inp.focus(); } catch (e) {}
                setTimeout(() => { try { inp.focus(); } catch (e) {} }, 20);
            }
            hi(sel);
            return false;
        }
        function _prodOpenProjectStatusPicker(ev, slug) { return _prodOpenProjectPicker('pstatus', ev, slug); }
        function _prodOpenProjectLeadPicker(ev, slug) { return _prodOpenProjectPicker('plead', ev, slug); }
        function _prodOpenProjectTargetPicker(ev, slug) { return _prodOpenProjectPicker('ptarget', ev, slug); }
        const PROD_MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const PROD_MON_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const PROD_WK = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        function _prodIsoParts(value) {
            const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
            if (!match) return null;
            const year = Number(match[1]);
            const month = Number(match[2]);
            const day = Number(match[3]);
            const date = new Date(Date.UTC(year, month - 1, day));
            if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
            return { year, month, day, iso: match[0] };
        }
        function _prodIsoDayNumber(value) {
            const parts = _prodIsoParts(value);
            return parts ? Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 864e5) : NaN;
        }
        function _prodIsoFromParts(year, month, day) {
            const iso = String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
            return _prodIsoParts(iso) ? iso : '';
        }
        function _prodIsoFromDate(date) {
            if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
            return _prodIsoFromParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
        }
        function _prodDateFromIso(value) {
            const parts = _prodIsoParts(value);
            return parts ? new Date(parts.year, parts.month - 1, parts.day) : null;
        }
        function _prodPolicyTodayISO(now) {
            return wlWorkloadTodayISO(now || new Date());
        }
        function _prodToday(now) {
            return _prodDateFromIso(_prodPolicyTodayISO(now));
        }
        function _prodAddDays(d, n) {
            const x = new Date(d);
            x.setDate(x.getDate() + n);
            return x;
        }
        function _prodFmtDue(d) {
            return PROD_MON[d.getMonth()] + ' ' + d.getDate();
        }
        function _prodFmtWk(d) {
            return PROD_WK[d.getDay()] + ', ' + d.getDate() + ' ' + PROD_MON[d.getMonth()];
        }
        function _prodParseDue(s, now) {
            const raw = String(s || '').trim();
            s = raw.toLowerCase();
            if (!s) return '';
            const exact = _prodIsoParts(raw);
            if (exact) return exact.iso;
            const todayIso = _prodPolicyTodayISO(now);
            const today = _prodDateFromIso(todayIso);
            const M = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
            let m;
            if (s === 'today') return todayIso;
            if (s === 'tomorrow') return _prodIsoFromDate(_prodAddDays(today, 1));
            if (m = s.match(/^(\d+)\s*(d|day|days|h|hr|hrs|hour|hours)$/)) {
                const n = +m[1];
                return _prodIsoFromDate(_prodAddDays(today, /^h/.test(m[2]) ? Math.max(1, Math.round(n / 24)) : n));
            }
            if (m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)) {
                return _prodIsoFromParts(+m[3], +m[1], +m[2]);
            }
            if (m = s.match(/^([a-z]{3,})\.?\s+(\d{1,2})(?:,\s*|\s+)(\d{4})$/)) {
                const mo = M[m[1].slice(0, 3)];
                return mo == null ? '' : _prodIsoFromParts(+m[3], mo + 1, +m[2]);
            }
            if (m = s.match(/^(\d{1,2})\s+([a-z]{3,})\.?(?:,\s*|\s+)(\d{4})$/)) {
                const mo = M[m[2].slice(0, 3)];
                return mo == null ? '' : _prodIsoFromParts(+m[3], mo + 1, +m[1]);
            }
            if (m = s.match(/^([a-z]{3,})\.?\s+(\d{1,2})$/)) {
                const mo = M[m[1].slice(0, 3)];
                if (mo != null) return _prodIsoFromParts(today.getFullYear(), mo + 1, +m[2]);
            }
            if (m = s.match(/^(\d{1,2})\s+([a-z]{3,})$/)) {
                const mo = M[m[2].slice(0, 3)];
                if (mo != null) return _prodIsoFromParts(today.getFullYear(), mo + 1, +m[1]);
            }
            if (m = s.match(/^(\d{1,2})$/)) return _prodIsoFromParts(today.getFullYear(), today.getMonth() + 1, +m[1]);
            return '';
        }
        let _prodPolicyDayTimer = 0;
        let _prodPolicyDaySnapshot = '';
        function _prodMsUntilPolicyDayChange(now) {
            const start = now instanceof Date ? now.getTime() : Date.now();
            const currentDay = _prodPolicyTodayISO(new Date(start));
            let low = start;
            let high = start + 36 * 60 * 60 * 1000;
            if (_prodPolicyTodayISO(new Date(high)) === currentDay) return 60 * 60 * 1000;
            while (high - low > 250) {
                const middle = low + Math.floor((high - low) / 2);
                if (_prodPolicyTodayISO(new Date(middle)) === currentDay) low = middle;
                else high = middle;
            }
            return Math.max(250, high - start + 50);
        }
        function _prodRefreshPolicyDay() {
            const nextDay = _prodPolicyTodayISO();
            const changed = !!_prodPolicyDaySnapshot && _prodPolicyDaySnapshot !== nextDay;
            _prodPolicyDaySnapshot = nextDay;
            clearTimeout(_prodPolicyDayTimer);
            _prodPolicyDayTimer = setTimeout(_prodRefreshPolicyDay, _prodMsUntilPolicyDayChange());
            if (changed && document.getElementById('prodRoot')) _prodRender();
            return changed;
        }
        function _prodStartPolicyDayClock() {
            if (_prodPolicyDayTimer) return;
            _prodRefreshPolicyDay();
        }
        // PORT-DELTA: due calendar structure is artifact-derived; native writes
        // still pass through the per-team authority gate and Production gateway.
        function _prodBuildDue(pop, cur, ids, anchor) {
            let view = 'quick';
            const selectedIso = _prodDueIso(cur && (cur.dueRaw || cur.due));
            const parsed = _prodDateFromIso(selectedIso);
            const todayIso = _prodPolicyTodayISO();
            const todayRef = _prodToday();
            let calM = new Date((parsed || todayRef).getFullYear(), (parsed || todayRef).getMonth(), 1);
            let focusDay = parsed || new Date(todayRef);
            const apply = value => {
                _prodClearLayer();
                _prodRunPickerWrite('due', ids, _prodDueIso(value));
            };
            const quick = () => {
                let h = '<div class="prod-pop-search"><input data-prod-search placeholder="Try: 2027-02-09, Feb 9 2027"></div><div class="prod-pop-list">';
                if (cur && cur.due) h += '<div class="prod-mi" data-prod-set="__remove__"><span class="mic">' + _prodIcon('cal') + '</span><span class="mlbl">Remove due date</span><span class="dres">' + _calEsc(cur.due) + '</span></div>';
                h += '<div class="prod-mi" data-prod-set="__custom__"><span class="mic">' + _prodIcon('cal') + '</span><span class="mlbl">Custom…</span></div>';
                [['Tomorrow', _prodAddDays(todayRef, 1)], ['End of this week', _prodAddDays(todayRef, (5 - todayRef.getDay() + 7) % 7 || 7)], ['In one week', _prodAddDays(todayRef, 7)]].forEach(o => {
                    h += '<div class="prod-mi" data-prod-day="' + _calEscAttr(_prodIsoFromDate(o[1])) + '"><span class="mic">' + _prodIcon('cal') + '</span><span class="mlbl">' + _calEsc(o[0]) + '</span><span class="dres">' + _calEsc(_prodFmtWk(o[1])) + '</span></div>';
                });
                return h + '</div>';
            };
            const cal = () => {
                const start = new Date(calM).getDay();
                const dim = new Date(calM.getFullYear(), calM.getMonth() + 1, 0).getDate();
                let cells = '';
                for (let i = 0; i < start; i++) cells += '<div class="prod-cal-d empty"></div>';
                for (let d = 1; d <= dim; d++) {
                    const dt = new Date(calM.getFullYear(), calM.getMonth(), d);
                    const dayIso = _prodIsoFromDate(dt);
                    const today = dayIso === todayIso;
                    const selected = selectedIso === dayIso;
                    const focused = focusDay && dt.toDateString() === focusDay.toDateString();
                    cells += '<div class="prod-cal-d' + (today ? ' today' : '') + (selected ? ' sel' : '') + (focused ? ' focus' : '') + '" data-prod-day="' + _calEscAttr(dayIso) + '">' + d + '</div>';
                }
                return '<div class="prod-pop-search"><input data-prod-search placeholder="Type a date, e.g. Jul 20 2027"></div><div class="prod-cal"><div class="prod-cal-hd"><button class="prod-cal-nav" type="button" data-prod-cal="-1">&lsaquo;</button><span class="prod-cal-mo">' + PROD_MON_FULL[calM.getMonth()] + ' ' + calM.getFullYear() + '</span><button class="prod-cal-nav" type="button" data-prod-cal="1">&rsaquo;</button></div><div class="prod-cal-wk"><span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span></div><div class="prod-cal-grid">' + cells + '</div></div>';
            };
            const pos = () => {
                const pr = pop.getBoundingClientRect();
                let nx = anchor.x;
                let ny = anchor.above ? anchor.y - pr.height - 8 : anchor.y;
                if (nx + pr.width > innerWidth - 8) nx = anchor.flipX != null ? Math.max(8, anchor.flipX - pr.width + 4) : innerWidth - pr.width - 8;
                if (ny + pr.height > innerHeight - 8) ny = Math.max(8, innerHeight - pr.height - 8);
                ny = Math.max(8, ny);
                pop.style.left = nx + 'px';
                pop.style.top = ny + 'px';
            };
            const draw = () => {
                pop.innerHTML = view === 'quick' ? quick() : cal();
                pop.querySelectorAll('[data-prod-day]').forEach(el => el.addEventListener('click', e => {
                    e.stopPropagation();
                    apply(el.getAttribute('data-prod-day'));
                }));
                pop.querySelectorAll('[data-prod-set]').forEach(el => el.addEventListener('click', e => {
                    e.stopPropagation();
                    if (el.getAttribute('data-prod-set') === '__custom__') {
                        view = 'calendar';
                        draw();
                    } else {
                        apply('');
                    }
                }));
                pop.querySelectorAll('[data-prod-cal]').forEach(el => el.addEventListener('click', e => {
                    e.stopPropagation();
                    calM = new Date(calM.getFullYear(), calM.getMonth() + (+el.getAttribute('data-prod-cal')), 1);
                    const day = focusDay ? Math.min(focusDay.getDate(), new Date(calM.getFullYear(), calM.getMonth() + 1, 0).getDate()) : 1;
                    focusDay = new Date(calM.getFullYear(), calM.getMonth(), day);
                    draw();
                }));
                const inp = pop.querySelector('[data-prod-search]');
                if (inp) {
                    inp.addEventListener('keydown', e => {
                        e.stopPropagation();
                        if (e.key === 'Escape') { _prodClearLayer(); return; }
                        if (view === 'calendar' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                            e.preventDefault();
                            const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? 7 : -7;
                            focusDay = _prodAddDays(focusDay || new Date(calM.getFullYear(), calM.getMonth(), 1), step);
                            calM = new Date(focusDay.getFullYear(), focusDay.getMonth(), 1);
                            draw();
                            return;
                        }
                    if (e.key === 'Enter') {
                        const selected = view === 'calendar' ? focusDay : _prodParseDue(inp.value);
                        if (selected) apply(selected);
                    }
                });
                    try { inp.focus(); } catch (e) {}
                    setTimeout(() => { try { inp.focus(); } catch (e) {} }, 20);
                }
                pop.style.visibility = 'visible';
                pos();
            };
            pop.style.visibility = 'hidden';
            draw();
        }
        // PORT-DELTA: context menu uses artifact item order with Copy active and mutating entries guarded.
        function _prodOpenContextMenu(ev, kind, id) {
            if (ev) {
                ev.preventDefault();
                ev.stopPropagation();
            }
            const preview = _prodPreviewText();
            // `proj` is gone from here: a submenu chevron on an entry that
            // cannot act is the same promise the picker used to make.
            const hasSub = { status: 1, assign: 1, due: 1 };
            const menuItem = (label, icon, kbd, act) =>
                '<div class="prod-mi" data-prod-ctx="' + _calEscAttr(act) + '"><span class="mic">' + icon + '</span><span class="mlbl">' + _calEsc(label) + '</span>' + (kbd ? '<span class="kbd">' + _calEsc(kbd) + '</span>' : '') + (hasSub[act] ? '<span class="chev">' + _prodIcon('chevR') + '</span>' : '') + '</div>';
            /* `reason` defaults to the preview sentence, which is right for a
               control waiting on authority and wrong for one that can never
               act. The Project entry passes its own. */
            const disabled = (label, icon, kbd, danger, chev, reason) => {
                const why = String(reason || preview);
                return '<div class="prod-mi disabled' + (danger ? ' danger' : '') + '" data-prod-disabled="context-' + _calEscAttr(label.toLowerCase().replace(/\s+/g, '-')) + '" title="' + _calEscAttr(why) + '" data-prod-tip="' + _calEscAttr(why) + '"><span class="mic">' + icon + '</span><span class="mlbl">' + _calEsc(label) + '</span>' + (kbd ? '<span class="kbd">' + _calEsc(kbd) + '</span>' : '') + (chev ? '<span class="chev">' + _prodIcon('chevR') + '</span>' : '') + '</div>';
            };
            const active = (label, icon, act) =>
                '<div class="prod-mi" data-prod-ctx="' + _calEscAttr(act) + '"><span class="mic">' + icon + '</span><span class="mlbl">' + _calEsc(label) + '</span></div>';
            const projectAction = (label, icon, kbd, act) =>
                '<div class="prod-mi" data-prod-pctx="' + _calEscAttr(act) + '"><span class="mic">' + icon + '</span><span class="mlbl">' + _calEsc(label) + '</span>' + (kbd ? '<span class="kbd">' + _calEsc(kbd) + '</span>' : '') + '</div>';
            const issueMenu = [
                menuItem('Status', _prodIcon('issues'), 'S', 'status'),
                menuItem('Assignee', _prodIcon('assign'), 'A', 'assign'),
                menuItem('Due date', _prodIcon('cal'), '⇧D', 'due'),
                disabled('Project', _prodIcon('project'), '⇧P', false, false, PROD_PROJECT_MOVE_UNSUPPORTED),
                '<div class="prod-msep"></div>',
                active('Copy link', _prodIcon('copy'), 'copy'),
                disabled('Move', _prodIcon('move'), '', false, true, PROD_MOVE_UNSUPPORTED),
                '<div class="prod-msep"></div>',
                disabled('Delete', _prodIcon('trash'), 'Ctrl ⌫', true, false, PROD_DELETE_UNSUPPORTED)
            ];
            const projectMenu = [
                projectAction('Change status', _prodIcon('issues'), 'S', 'pstatus'),
                projectAction('Set lead', _prodIcon('assign'), 'A', 'plead'),
                projectAction('Set target', _prodIcon('cal'), '⇧D', 'ptarget'),
                '<div class="prod-msep"></div>',
                active('Copy link', _prodIcon('copy'), 'copy')
            ];
            const pop = _prodLayerPop((kind === 'client' ? projectMenu : issueMenu).join(''), ev ? ev.clientX : innerWidth / 2, ev ? ev.clientY : 160);
            pop.querySelectorAll('[data-prod-ctx]').forEach(el => {
                const act = el.getAttribute('data-prod-ctx');
                if (hasSub[act]) {
                    el.addEventListener('mouseenter', () => _prodOpenSub(el, act, _prodTargetIds(id)));
                    el.addEventListener('click', e => {
                        e.preventDefault();
                        e.stopPropagation();
                        _prodOpenSub(el, act, _prodTargetIds(id));
                    });
                    return;
                }
                if (act === 'copy') el.addEventListener('click', () => {
                    _prodClearLayer();
                    const copyKind = kind === 'client' ? 'client' : kind === 'batch' ? 'batch' : 'issue';
                    const copyIds = copyKind === 'issue' ? _prodTargetIds(id) : [id];
                    _prodCopyLink(copyKind, copyIds.length > 1 ? copyIds : id);
                });
            });
            pop.querySelectorAll('[data-prod-pctx]').forEach(el => {
                el.addEventListener('mouseenter', _prodCloseSub);
                el.addEventListener('click', e => {
                    const act = el.getAttribute('data-prod-pctx');
                    if (!act) return;
                    _prodOpenProjectPicker(act, e, id);
                });
            });
            pop.querySelectorAll('[data-prod-disabled]').forEach(el => {
                el.addEventListener('mouseenter', _prodCloseSub);
                el.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    /* The row already carries its reason in the tip it shows on
                       hover. Echo THAT, not the preview sentence, or clicking
                       contradicts hovering. */
                    _prodReadonlyGuard(el.getAttribute('data-prod-tip'));
                });
            });
            _prodWirePlainMenu(pop);
            return false;
        }
        function _prodTabAllows(status) {
            if (_prodState.tab === 'backlog') return status === 'backlog' || status === 'triage';
            if (_prodState.tab === 'all') return true;
            // Active hides approved (owner decision 2026-07-18) - matches the artifact active set.
            return ['todo','prog','smm','kasper','client','tweak','scheduled'].includes(_prodArtifactStatus(status));
        }
        // F37 — "My issues" and "Assigned to me" bind to the member id the staff
        // sign-in verified, never to a name heuristic. The previous projection
        // picked a specially named assignee if present, else the first active
        // assignee in name order, so every browser saw one identity's queue.
        // A signed-out, unverified, revoked, inactive, or off-roster session
        // resolves to no personal identity and therefore to no personal queue.
        function _prodMyMemberId() {
            const identity = _syncviewStaffIdentityForHeaders();
            const id = String(identity && identity.member && identity.member.id || '').trim();
            if (!id) return '';
            const member = _prodEditors()[id];
            // Before the roster loads there is nothing to contradict the
            // verified identity, so it stands; once loaded, an absent or
            // deactivated row revokes the personal queue.
            if (_prodState.loaded && (!member || member.active === false)) return '';
            return id;
        }
        function _prodMyQueueUnavailableText() {
            if (!_syncviewStaffIdentityForHeaders()) return 'Sign in with your staff account to see your issues.';
            if (!_prodMyMemberId()) return 'This account is not an active member of the current roster.';
            return '';
        }
        function _prodIssueRows() {
            const rows = _prodUniqueRows(_prodApplySubIssueVisibility(_prodCurIssuesUnfiltered().filter(_prodMatchFilters)));
            return rows
                .sort(_prodIssueOrderCompare);
        }
        function _prodProjectRows(project) {
            return _prodUniqueRows(_prodApplySubIssueVisibility(_prodProjectAllRows(project)))
                .filter(_prodMatchFilters)
                .sort(_prodIssueOrderCompare);
        }
        function _prodProjectScopeTeam(project) {
            const active = _prodState.team;
            if (active === 'video' || active === 'graphics') return active;
            const team = project && project.team;
            return team === 'video' || team === 'graphics' ? team : 'all';
        }
        function _prodProjectAllRows(project) {
            const id = String(project && project.id || '');
            if (!id) return [];
            const scope = _prodProjectScopeTeam(project);
            return _prodIssues().filter(d => d.project === id && (scope === 'all' || d.team === scope));
        }
        // PORT-DELTA: groupsFor accepts live rows and supports client-project grouping through adapter projects.
        function _prodGroupsFor(rows) {
            const grouped = new Map();
            const projects = _prodProjects();
            const editors = _prodEditors();
            const groupBy = _prodState.groupBy || 'status';
            rows.forEach(r => {
                const key = groupBy === 'assignee'
                    ? (r.assignee || '_')
                    : groupBy === 'client'
                        ? (r.project || '_')
                        : (_prodArtifactStatus(r.status) || 'unknown');
                if (!grouped.has(key)) grouped.set(key, []);
                grouped.get(key).push(r);
            });
            if (groupBy === 'assignee') {
                return [...grouped.keys()].sort((a, b) => {
                    const an = a === '_' ? 'No assignee' : editors[a] ? editors[a].name : a;
                    const bn = b === '_' ? 'No assignee' : editors[b] ? editors[b].name : b;
                    return an.localeCompare(bn);
                }).map(key => ({ key, title: key === '_' ? 'No assignee' : editors[key] ? editors[key].name : key, icon: key === '_' ? _prodIcon('assign') : _prodAvatar(editors[key], 16), items: grouped.get(key) || [] }));
            }
            if (groupBy === 'client') {
                return [...grouped.keys()].sort((a, b) => _prodDisplayClient(a).localeCompare(_prodDisplayClient(b))).map(key => ({ key, title: _prodDisplayClient(key), icon: _prodProjectGlyph(projects[key] || key), items: grouped.get(key) || [] }));
            }
            const keys = PROD_STATUS_ORDER.filter(k => grouped.has(k)).concat([...grouped.keys()].filter(k => !PROD_STATUS_ORDER.includes(k)));
            return keys.map(key => ({ key, title: _prodStatusLabel(key), icon: _prodStatusSVG(key), items: grouped.get(key) || [] }));
        }
        function _prodFlatOrder() {
            const out = [];
            _prodGroupsFor(_prodIssueRows()).forEach(g => {
                if (!_prodState.collapsed.has(g.key)) g.items.forEach(i => out.push(i.id));
            });
            return out;
        }
        function _prodBoardCardCounts() {
            const byClient = new Map();
            _prodIssueRows().forEach(d => byClient.set(d.project, (byClient.get(d.project) || 0) + 1));
            return byClient;
        }
        function _prodBoardCardsForStatus(status, counts) {
            const byClient = counts || _prodBoardCardCounts();
            return _prodClients().filter(c => (c.status || 'prog') === status && byClient.has(c.id));
        }
        function _prodBoardCols() {
            const counts = _prodBoardCardCounts();
            return PROD_BOARD_ORDER.map(status => ({
                key: status,
                ids: _prodState.colCollapsed.has(status) ? [] : _prodBoardCardsForStatus(status, counts).map(c => c.id)
            })).filter(c => c.ids.length);
        }
        function _prodBoardFlat() {
            return _prodBoardCols().reduce((out, c) => out.concat(c.ids), []);
        }
        function _prodBoardLoc(cols, slug) {
            const id = String(slug || '');
            for (let c = 0; c < cols.length; c++) {
                const r = cols[c].ids.indexOf(id);
                if (r >= 0) return { c, r };
            }
            return null;
        }
        function _prodCardFocusValid() {
            return !!(_prodState.focusCard && _prodBoardLoc(_prodBoardCols(), _prodState.focusCard));
        }
        /* The hover title is ALWAYS emitted, and the 120-character threshold it
           used to carry is gone.

           That threshold measured the wrong thing. Whether a title is readable
           depends on the width of the column it renders in, not on how many
           characters it has -- and the sub-issue rows are the narrowest column
           in the tab. Owner report 2026-09-02, on a parent whose eight children
           are named "<client> | <date range> | Reel N": every one is ~44
           characters, so not one of them qualified for a tooltip, and all eight
           truncated to an identical prefix. The list was unreadable precisely
           because the titles were SHORT enough to be judged fine.

           `data-fulltitle` stays because it is already emitted here and at the
           row renderer, but note it has no reader anywhere -- no CSS rule and
           no script consumes it. The working tooltip is, and always was, the
           native `title`. */
        function _prodTitleAttrs(text) {
            const s = String(text || '');
            return ' data-fulltitle="' + _calEscAttr(s) + '" title="' + _calEscAttr(s) + '"';
        }
        function _prodReconcileSelection() {
            // Selection now also lives on project-view rows and the parent
            // sub-issue section, so those rows count as visible in their views;
            // otherwise switching views would silently drop the selection.
            const visible = new Set(_prodIssueRows().map(i => i.id));
            if (_prodState.view === 'project') {
                const project = _prodClient(_prodState.openProjectId);
                if (project) _prodProjectRows(project).forEach(i => visible.add(i.id));
            }
            if (_prodState.view === 'detail' && _prodState.openId) {
                _prodChildrenOf(_prodState.openId).forEach(i => visible.add(i.id));
                const openIssue = _prodIssue(_prodState.openId);
                if (openIssue && openIssue.parent) _prodChildrenOf(openIssue.parent).forEach(i => visible.add(i.id));
            }
            Array.from(_prodState.selected || []).forEach(id => {
                if (!visible.has(id)) _prodState.selected.delete(id);
            });
            if (_prodState.focusRow && !visible.has(_prodState.focusRow)) _prodState.focusRow = '';
            if (_prodState.hoverRow && !visible.has(_prodState.hoverRow)) _prodState.hoverRow = '';
            const cardVisible = new Set(_prodBoardFlat());
            Array.from(_prodState.cardSel || []).forEach(id => {
                if (!cardVisible.has(id)) _prodState.cardSel.delete(id);
            });
            if (_prodState.focusCard && !cardVisible.has(_prodState.focusCard)) _prodState.focusCard = '';
            if (_prodState.cardAnchor && !cardVisible.has(_prodState.cardAnchor)) _prodState.cardAnchor = '';
        }
        function renderProductionView() {
            return '<div class="prod-view" id="prodRoot">' + _svLoadingSkeletonHtml('production') + '</div>';
        }
        function mountProductionView() {
            _prodPrimeFromUrl();
            _prodStartAuthorityRefresh();
            _prodStartOperationalRefresh();
            _prodStartPolicyDayClock();
            // Stale-while-revalidate: paint instantly from the last snapshot,
            // then revalidate in the background. On a cold cache this is a no-op
            // and the normal foreground load runs below.
            let hydrated = false;
            if (!_prodState.loaded && !_prodState.loading) hydrated = _prodHydrateFromCache();
            _prodRender();
            if (hydrated) _prodRevalidateCachedPaint();
            else if (!_prodState.loaded && !_prodState.loading) _prodMountFromIdbOrLoad();
        }
        /* The live read behind a saved-copy paint. A silent load that fails only
           returns false, so the outcome is handled here: the notice turns into
           "Couldn't update" instead of saying "updating" forever, and a refused
           session (401/403 -- the cache is already purged) stops showing rows
           it is no longer allowed to read. */
        /* Settles once, the first time a live Production read finishes either
           way (or after a 10 s ceiling). Work that competes with that read for
           the network but does not draw SyncLinear waits on it: the Production
           landing in init() starts Metrics and Clients Info (~2.6 MB, measured
           2026-09-23) only once this settles. Those sheets draw nothing here --
           they feed pins, the calendar's client resolution and brief polling
           for the tabs visited next -- so the calls and end state are the same,
           only later. */
        let _prodFirstLoadSettle = () => {};
        const _prodFirstLoadSettled = new Promise(resolve => {
            let done = false;
            _prodFirstLoadSettle = () => { if (!done) { done = true; resolve(); } };
            setTimeout(() => _prodFirstLoadSettle(), 10000);
        });
        function _prodRevalidateCachedPaint() {
            return Promise.resolve(_prodLoadData({ silent: true })).then(ok => {
                _prodFirstLoadSettle();
                if (ok !== false || !_prodState.fromCache) return;
                const status = Number(_prodState.lastSilentLoadStatus || 0);
                if (status === 401 || status === 403) {
                    _prodState.fromCache = false;
                    _prodState.loaded = false;
                    _prodState.error = 'Your session can no longer read Production. Sign in again, then retry.';
                } else if (!_prodState.lastSyncError) {
                    _prodState.lastSyncError = 'Could not load the live list.';
                }
                if (document.getElementById('prodRoot')) _prodRender();
            }, () => { _prodFirstLoadSettle(); });
        }
        /* The snapshot too big for localStorage lives in IndexedDB, and reading
           it is asynchronous, so it RACES the live read rather than gating it.
           Awaiting it first was measured on 2026-09-23 and rejected: on a
           switch from the calendar the read sometimes took ~3 s, and the live
           list then landed ~1.5 s later than with no cache at all. Now the live
           read starts at once, exactly as it did before, and the saved copy is
           painted only if it answers while that read is still out -- a copy
           that loses the race is dropped unseen, so a stale list can never
           replace a fresh one. */
        function _prodMountFromIdbOrLoad() {
            if (_prodState.loaded || _prodState.loading) return;
            const generation = _prodState.projectionGeneration;
            Promise.resolve(_prodLoadData()).then(() => _prodFirstLoadSettle(), () => _prodFirstLoadSettle());
            let read;
            try { read = _prodIdbCacheRead(); } catch (e) { return; }
            Promise.resolve(read).then(cached => {
                // Still the same boot, still waiting on it, nothing painted yet.
                if (!cached || !_prodState.loading || _prodState.loaded || _prodState.error
                    || generation !== _prodState.projectionGeneration) return;
                if (!_prodHydrateFromCache(cached)) return;
                // Hydration marks the tab loaded; the live read is still out and
                // takes over when it lands (it clears fromCache and repaints).
                _prodState.loading = false;
                if (document.getElementById('prodRoot')) _prodRender();
            }, () => {});
        }
        let _prodCreativeDefaultDone = false;
        function _prodPrimeFromUrl() {
            try {
                const statePrefs = history.state && history.state.prod ? history.state.prod : null;
                if (statePrefs) _prodApplyDisplayPrefs(statePrefs);
                else _prodLoadDisplayPrefs();
                const q = new URLSearchParams(svRoute.search());
                const group = q.get('group');
                if (PROD_GROUP_KEYS.has(group)) _prodState.groupBy = group;
                const order = q.get('order');
                if (PROD_ORDER_KEYS.has(order)) _prodState.orderBy = order;
                const subs = q.get('subs');
                if (subs === '0' || subs === 'false') _prodState.showSubIssues = false;
                else if (subs === '1' || subs === 'true') _prodState.showSubIssues = true;
                const team = q.get('team');
                if (team === 'video' || team === 'graphics') _prodState.team = team;
                // Smart default: a creative opening SyncLinear with no view, card
                // or project in the address lands on My issues, once per load.
                let view = q.get('view');
                if (!view && !_prodCreativeDefaultDone && !q.get('d') && !q.get('batch') && !q.get('client')) {
                    if (_syncviewCreativeMe()) view = 'my';
                }
                _prodCreativeDefaultDone = true;
                if (view === 'my' || view === 'board' || view === 'list' || view === 'project') _prodState.view = view === 'board' ? 'board' : view === 'my' ? 'my' : view === 'project' ? 'project' : 'list';
                const tab = q.get('issues');
                if (tab === 'active' || tab === 'backlog' || tab === 'all') _prodState.tab = tab;
                const pdetails = q.get('pdetails');
                if (pdetails === '0' || pdetails === 'false') _prodState.projectDetailsOpen = false;
                else if (pdetails === '1' || pdetails === 'true') _prodState.projectDetailsOpen = true;
                const client = q.get('client');
                _prodState.clientSlug = client || '';
                _prodState.openProjectId = '';
                if (view === 'project' && client) { _prodState.openProjectId = client; _prodState.clientSlug = ''; }
                const d = q.get('d');
                const batch = q.get('batch');
                if (d) { _prodState.openId = d; _prodState.openBatchId = ''; _prodState.view = 'detail'; }
                // The batch-to-real-parent redirect is deliberately NOT resolved
                // here (Codex, #1471): priming this state before `deepLink` is
                // recorded below would make `_prodApplyDeepLinkFallback`'s
                // `openedElsewhere` guard read the redirect as the reader having
                // already navigated away, skip its own redirect branch, and leave
                // `?batch=` in the URL while a `?d=` detail was shown. The
                // authoritative pass is the one place with both a settled read
                // and the URL-correction call, so the batch view is the honest
                // first paint and that pass alone performs the redirect.
                else if (batch) { _prodState.openBatchId = batch; _prodState.openId = ''; _prodState.view = 'batch'; }
                else {
                    _prodState.openId = '';
                    _prodState.openBatchId = '';
                    if (view !== 'my' && view !== 'board' && view !== 'project') _prodState.view = 'list';
                }
                // Remember what the URL asked for. The first paint may come from
                // a cached snapshot that predates the target, and losing the
                // request there is what made these links look broken.
                _prodState.deepLink = d ? { kind: 'issue', id: d }
                    : batch ? { kind: 'batch', id: batch }
                    : (view === 'project' && client) ? { kind: 'project', id: client }
                    : null;
                _prodState.deepLinkMissing = '';
                _prodState.deepLinkMissingKind = '';
            } catch (e) {}
        }
        /*
         * A deep link has to survive the stale first paint.
         *
         * OWNER REPORT 2026-08-24, opening a Workload rollup and following its
         * "Open SyncView" link: "it just goes to the old team's issues, but it
         * doesn't open it". The link itself was fine. mountProductionView paints from the
         * localStorage snapshot first (stale-while-revalidate), and the guard
         * that ran there cleared openId whenever the target was absent from
         * THAT snapshot -- so a batch created after the reader's last visit was
         * dropped before the live read ever arrived, and the live read found
         * openId already empty and had nothing left to open. The reader was
         * left looking at the cached list: old data, and no item.
         *
         * So the fallback now runs in two modes. On the cached paint it only
         * picks a view to show and keeps the request pending. On the first
         * authoritative read it RE-APPLIES the request against live data, and
         * only then decides the target does not exist -- and says so, rather
         * than dropping the reader on a list that looks like a broken link.
         *
         * Re-applying is once-only and conditional on the reader not having
         * navigated in the meantime: a background refresh minutes later must
         * never yank someone out of whatever they opened.
         */
        function _prodApplyDeepLinkFallback(authoritative) {
            const wanted = _prodState.deepLink;
            const sameAsWanted = id => !!wanted && !!id && String(id) === String(wanted.id);
            const openedElsewhere = !!((_prodState.openId && !sameAsWanted(_prodState.openId))
                || (_prodState.openBatchId && !sameAsWanted(_prodState.openBatchId))
                || (_prodState.openProjectId && !sameAsWanted(_prodState.openProjectId)));
            // A batch deep link whose real parent resolves lands the reader on
            // that parent's detail instead (owner report 2026-09-21) -- a
            // different id than `wanted.id`, so `sameAsWanted` below can never
            // call it "opened". This flag is the same escape hatch
            // `openedElsewhere` already is for a reader who navigated away.
            let redirectedToParent = false;
            if (wanted && authoritative && !openedElsewhere) {
                if (wanted.kind === 'issue' && _prodIssue(wanted.id)) {
                    _prodState.openId = wanted.id; _prodState.openBatchId = ''; _prodState.view = 'detail';
                } else if (wanted.kind === 'batch' && _prodBatch(wanted.id)) {
                    const parent = _prodBatchParentIssue(_prodBatch(wanted.id));
                    if (parent) {
                        _prodState.openId = parent.displayId || parent.id;
                        _prodState.openBatchId = '';
                        _prodState.view = 'detail';
                        redirectedToParent = true;
                        // The URL still names the batch; correct it to the
                        // parent's identifier now that this is authoritative,
                        // without pushing a new history entry for a redirect
                        // nobody navigated to.
                        _prodSetQuery({ d: _prodState.openId }, false);
                    } else {
                        _prodState.openBatchId = wanted.id; _prodState.openId = ''; _prodState.view = 'batch';
                    }
                } else if (wanted.kind === 'project' && _prodClient(wanted.id)) {
                    _prodState.openProjectId = wanted.id; _prodState.clientSlug = ''; _prodState.view = 'project';
                }
            }
            /* AUTHORITATIVE IS NOT THE SAME AS COMPLETE, and treating it as
               complete is what evicted readers from finished work.

               The boot read is deliberately two-phase: phase one fetches
               PROD_LIVE_FILTER (everything NOT in PROD_CACHE_TERMINAL) so the
               board is interactive fast, and `_prodLoadTerminalTail` fetches
               the approved / posted / archived / canceled / duplicate rows
               behind it. Phase one COMPLETES -- it is a real, finished,
               authoritative read -- while deliberately holding none of the
               ~3,975 terminal rows.

               So between the two phases every lookup below answers null for any
               finished item, and these three lines then clear what the reader
               opened and force them to the list. Owner report 2026-09-02:
               opening a POSTED parent bounced to the unfiltered issue list "at
               random times", and a refresh fixed it -- random being whether the
               tail had landed yet, and the refresh being the next boot winning
               the race. `_prodApplyDeepLinkFallback` then also published the
               "has no row in Production" notice for a row the tab could see
               perfectly well one second later (OPEN_REPAIRS 108).

               `terminalTailPending` is exactly the missing distinction and was
               already tracked; it simply was not consulted here. While it is
               set, an unresolved id means NOT YET, not GONE, so nothing is
               cleared and no notice is published. The eviction still runs, one
               tail later, for a target that is genuinely absent. */
            /* SETTLING covers two different reasons the row set is incomplete,
               and only one of them was modelled.

               `terminalTailPending` means the tail has not finished. But a tail
               that finished by THROWING leaves the row set just as incomplete,
               and the repair shipped on 2026-09-02 called the fallback on that
               exit anyway -- "let the fallback publish an honest result". It is
               not honest: the read established nothing, so the three evictions
               below fire on a row that very likely exists, and the notice
               accuses it of having no row in Production off the back of a
               request that failed. Reproduced by execution: a reader sitting on
               a posted deliverable was moved to the list, and a deep link at it
               was told it did not exist.

               That is the FIFTH round of this same bug, and every round has had
               the identical shape: a state the code could not represent, so two
               different situations shared one answer. NOT YET and GONE was the
               first four. This one is I DO NOT KNOW. */
            /* A CACHED PAINT KNOWS NOTHING, and that is the third situation this
               guard had to learn.

               Owner report, with a screenshot: opening a deep link shows the
               unfiltered "All teams" issue list FIRST, before the item. The
               comment above already promised the opposite -- "on the cached
               paint it only picks a view to show and keeps the request pending"
               -- but the eviction below ran anyway, because it was gated only on
               the tail. `mountProductionView` paints from the localStorage
               snapshot before any network read exists, so at that moment the
               tail is neither pending nor failed and `settling` was false. A row
               merely absent from a stale snapshot was therefore treated as GONE,
               the view was forced to 'list', and the reader watched the whole
               board flash past on the way to the thing they clicked.

               `authoritative` is the missing term. Absence is only evidence when
               the answer came from the server. */
            /* Same predicate as the pane, deliberately: an eviction and a
               "not found" are the same claim made in two places, and they drifted
               apart once already (item 108, five rounds). `_prodRowSetComplete`
               is strictly the more cautious of the two old terms -- it also
               refuses while no tail has landed at all -- which is the direction
               AGENTS.md asks a guard to fall when it could go either way. */
            const settling = !authoritative || !_prodRowSetComplete();
            if (!settling) {
                if (_prodState.openId && !_prodIssue(_prodState.openId)) { _prodState.openId = ''; _prodState.view = 'list'; }
                if (_prodState.openBatchId && !_prodBatch(_prodState.openBatchId)) { _prodState.openBatchId = ''; _prodState.view = 'list'; }
                if (_prodState.openProjectId && !_prodClient(_prodState.openProjectId)) { _prodState.openProjectId = ''; _prodState.view = 'list'; }
            }
            if (!authoritative || !wanted || settling) return;
            const opened = redirectedToParent
                || sameAsWanted(_prodState.openId)
                || sameAsWanted(_prodState.openBatchId)
                || sameAsWanted(_prodState.openProjectId);
            /* The KIND rides along. `deepLinkMissing` holds only an identifier,
               and the notice below is shared by all three link kinds, so copy
               written for one of them is definitively wrong for the other two.
               Raised by review on the PR that rewrote that copy. */
            _prodState.deepLinkMissing = opened || openedElsewhere ? '' : String(wanted.id || '');
            _prodState.deepLinkMissingKind = _prodState.deepLinkMissing ? String(wanted.kind || '') : '';
            _prodState.deepLink = null;
        }
        function _prodDeepLinkNoticeHTML() {
            const missing = String(_prodState.deepLinkMissing || '');
            if (!missing) return '';
            /* WHAT THIS NOTICE MAY CLAIM, AND FOR WHICH LINK.
               It used to offer two guesses for every missing target -- "may
               live only in Linear, or belong to a client this view does not
               cover" -- and a video editor escalated one on 2026-09-01 where
               the SECOND was provably false: the client was on the active
               roster, fully covered, and the issue simply had no row here.

               The first rewrite of this copy replaced both guesses with the one
               true cause for HER link and then said it about every link, which
               review caught: `_prodApplyDeepLinkFallback` renders this same
               notice for `?d=`, `?batch=` and `?view=project&client=`, so
               "issues created in Linear are not imported" is wrong advice on
               two of the three. It carries the KIND now and says something true
               for each.

               And for an ISSUE it separates two cases the reader cannot tell
               apart but the page can: a row that EXISTS and was filtered out as
               archived (`_prodDeliverableLive`) is not a row that was never
               imported, and telling someone to import an archived issue sends
               them to create a duplicate. The raw rows are still in state; only
               the adapter filters them.

               No Linear link and no Retry on any branch: the page has no Linear
               credential to check with, and a button that re-asks a question
               already answered is the dead end this notice exists to replace. */
            const kind = String(_prodState.deepLinkMissingKind || '');
            /* BOTH identifier columns, tested independently. `identifier` is
               the b1 import's snapshot and `linear_identifier` is the value
               Linear maintains; a team move leaves them different (see the
               adapter's displayId note), so `identifier || linear_identifier`
               asked only about the retired number and answered "never imported"
               for an archived row linked by its current one. */
            const archived = kind === 'issue' && (_prodState.deliverables || []).some(row => {
                const names = [row && row.id, row && row.identifier, row && row.linear_identifier]
                    .map(v => String(v || ''));
                return names.includes(missing) && !_prodDeliverableLive(row);
            });
            const guidance = archived
                ? ' It is archived, so it is hidden here on purpose — nothing needs importing.'
                : kind === 'batch'
                    ? ' A post disappears from here when every one of its sub-issues is archived, or when it belongs to a client that is no longer active.'
                    : kind === 'project'
                        ? ' That client is not on the active roster, so its work is not shown here.'
                        /* AMENDED 2026-09-01, hours after the first version, because
                           the owner was right and I was wrong. That copy asserted
                           ONE cause -- "created directly in Linear" -- and the very
                           issue that prompted it was created by SyncView: its post
                           was dropped because two batch rows claimed the same Linear
                           parent. Twice now this notice has stated a cause it cannot
                           establish, so it stops doing that. It names the two things
                           that actually produce it, in the order they actually occur,
                           and sends the reader to someone who can look. */
                        : ' Most often its post could not be resolved here; it may also never have been imported.'
                            + ' Ask an Admin to look it up.';
            const subject = archived ? ' is not shown in Production.'
                : kind === 'batch' ? ' is not a post in Production.'
                : kind === 'project' ? ' is not a client this view covers.'
                : ' has no row in Production.';
            return '<div class="prod-deeplink-missing" data-prod-deeplink-missing="' + _calEscAttr(missing) + '"'
                + (kind ? ' data-prod-deeplink-kind="' + _calEscAttr(kind) + '"' : '') + '>'
                + '<b>' + _calEsc(missing) + '</b>' + subject
                + guidance
                + ' Showing the full list instead.'
                + '<button class="prod-deeplink-dismiss" type="button" aria-label="Dismiss"'
                + ' onclick="_prodDismissDeepLinkNotice()">Dismiss</button></div>';
        }
        function _prodDismissDeepLinkNotice() {
            _prodState.deepLinkMissing = '';
            _prodState.deepLinkMissingKind = '';
            _prodRender();
            return false;
        }
        function _prodSetQuery(extra, push) {
            if (!_prodEnabled()) return;
            /*
             * Any deliberate navigation retires BOTH the unresolved-deep-link
             * notice and the pending request itself.
             *
             * Caught in review of #1129. Clearing only the notice left
             * _prodState.deepLink pending, and `openedElsewhere` is computed
             * from openId/openBatchId/openProjectId alone — so a reader who
             * switched team, tab, grouping, or filter while still on the LIST
             * had all three empty, `openedElsewhere` stayed false, and the
             * authoritative read yanked them into the original deep-link
             * target. The window is not only the second or two before the
             * first read: if that read FAILS, the request stays pending and
             * any later successful refresh fires it.
             *
             * Safe to clear here because every caller is either a person
             * clicking something, or the one deep-link-load exception:
             * _prodApplyDeepLinkFallback's batch-to-real-parent redirect,
             * which calls this with push=false only once it has already
             * decided the link IS resolved (2026-09-21) — clearing the
             * pending request here is exactly what that resolution means,
             * not a premature drop of it.
             */
            _prodState.deepLinkMissing = '';
            _prodState.deepLinkMissingKind = '';
            _prodState.deepLink = null;
            try {
                const q = new URLSearchParams(svRoute.search());
                q.set('prod', '1');
                q.delete('d');
                q.delete('batch');
                q.delete('team');
                q.delete('client');
                q.delete('view');
                q.delete('issues');
                q.delete('ptab');
                q.delete('pdetails');
                q.delete('group');
                q.delete('order');
                q.delete('subs');
                if (_prodState.team !== 'all') q.set('team', _prodState.team);
                if (_prodState.view === 'project' && _prodState.openProjectId) q.set('client', _prodState.openProjectId);
                else if (_prodState.clientSlug) q.set('client', _prodState.clientSlug);
                if (_prodState.view === 'my') q.set('view', 'my');
                if (_prodState.view === 'board') q.set('view', 'board');
                if (_prodState.view === 'project') q.set('view', 'project');
                if (_prodState.tab !== 'active' && (_prodState.view === 'list' || _prodState.view === 'my')) q.set('issues', _prodState.tab);
                if (_prodState.view === 'project' && _prodState.projectDetailsOpen === false) q.set('pdetails', '0');
                if ((_prodState.groupBy || 'status') !== 'status') q.set('group', _prodState.groupBy);
                if ((_prodState.orderBy || 'due') !== 'due') q.set('order', _prodState.orderBy);
                if (_prodState.showSubIssues === false) q.set('subs', '0');
                Object.entries(extra || {}).forEach(([k, v]) => { if (v) q.set(k, v); });
                const url = '/' + '?' + q.toString() + '#production';
                const state = { nav: 'production', client: null, prod: { groupBy: _prodState.groupBy || 'status', orderBy: _prodState.orderBy || 'due', showSubIssues: _prodState.showSubIssues !== false } };
                if (push) history.pushState(state, '', url);
                else history.replaceState(state, '', url);
            } catch (e) {}
        }
        /* Phase two of the boot read: the finished work, fetched AFTER the board
           is already interactive and merged in behind it.

           Nothing is dropped -- the two filters are exact complements, so the
           row set once this settles is the same set the single read produced.
           What changes is the order: the 2,206 rows somebody can act on arrive
           first, and the ~3,975 approved/posted/archived rows stop standing
           between the reader and their own board.

           Guarded on projectionGeneration: a delta refresh or a manual reload
           during the tail read bumps it, and a tail that lands afterwards must
           not paste a stale archive over newer state. It is dropped instead --
           the next full read will fetch it again. */
        /* The targeted read behind a deep link. Bounded on purpose: one id, one
           request, no retry, and it never touches freshness or authority state
           -- it only adds a row the board was going to load anyway. If it fails
           or the id is already present, the tail covers it as before, so this
           can only make the wait shorter and never make the answer wrong. */
        /* The one-row filter, shared by the boot-time fast paint and the
           post-phase-one catch-up so the two cannot drift apart.

           THREE columns, not two. Review on PR 1242 caught the third: a link
           copied off a row whose `identifier` is null carries the LINEAR
           identifier and matched nothing here -- the one case this shortcut
           exists for, silently falling back to the four-thousand-row wait it
           was written to skip. All three stay, and they are the same three
           `_prodIssue` resolves (canonical id, displayId, retired alias), which
           is what keeps a row this fetches from being called missing once it
           lands -- the 2026-09-07 report. Returns '' for an id the filter grammar
           cannot carry safely, and the callers then leave it to the tail. */
        function _prodDeepLinkRowQuery(wanted) {
            /* \x22 and \x27 are the two quote characters; spelled as escapes so
               the comment-and-quote scanner the source tests use to slice this
               function out does not read a regex as the start of a string. */
            const safe = String(wanted || '').replace(/[(),\x22\x27]/g, '');
            if (!safe || safe !== wanted) return '';
            const cols = ['id', 'identifier', 'linear_identifier'];
            return 'or=(' + cols.map(c => c + '.eq.' + encodeURIComponent(safe)).join(',') + ')';
        }
        /* The boot-time fast paint. See the call site in _prodLoadData for why
           it exists; this is what it does and what it refuses to do.

           It reads the linked row beside phase one, then -- in one more round
           trip, all in parallel -- the row's batch (the crumb and the asset
           source read it), its parent (a sub-issue's crumb names it, and a
           row whose parent is unresolved renders as a parent itself, with an
           empty sub-issues section it does not own), and the two small tables
           phase one was already fetching, awaited off the SAME promises so
           nothing is requested twice. Everything is merged into whatever the
           snapshot already holds, never replacing it, and the pane is marked
           `loaded` so `_prodBody` stops showing the skeleton. `refreshing`
           stays true because phase one is still running, which is also what
           keeps the auto-refresh from starting a second load on top of it.

           Three things it will not do. It never consumes the deep link --
           `_prodApplyDeepLinkFallback(true)` after phase one is still the one
           place that happens, so the consumed-exactly-once contract in
           test/production-deep-link-survives-cache.js is unchanged. It never
           writes the cache: a one-row snapshot painted over a later boot would
           be the stale-first-paint bug all over again. And it never publishes
           absence: an empty read here means "not yet", and the tail decides. */
        let _prodDeepLinkFastRows = null;
        async function _prodDeepLinkFastPaint(reads) {
            const link = _prodState.deepLink;
            const wanted = link && link.kind === 'issue' ? String(link.id || '').trim() : '';
            if (!wanted) return false;
            if (_prodIssue(wanted)) return false;              // the snapshot already shows it
            if (_prodDeepLinkFastRows && _prodDeepLinkFastRows.id === wanted) return false;
            const query = _prodDeepLinkRowQuery(wanted);
            if (!query) return false;
            const generation = _prodState.projectionGeneration;
            const record = { id: wanted, generation, rows: null };
            _prodDeepLinkFastRows = record;
            const settled = () => generation !== _prodState.projectionGeneration || _prodDeepLinkFastRows !== record;
            try {
                const rows = await _prodLoadDeliverableProjection(query);
                if (settled()) return false;
                if (!Array.isArray(rows) || !rows.length) return false;
                const safeIds = list => Array.from(new Set(list.map(v => String(v || '').trim())
                    .filter(v => v && !/[(),\x22\x27]/.test(v))));   // quotes as escapes, see _prodDeepLinkRowQuery
                const batchIds = safeIds(rows.map(row => row && row.batch_id));
                const parentIds = safeIds(rows.map(row => row && row.raw_issue_parent_id));
                const inList = ids => 'in.(' + ids.map(encodeURIComponent).join(',') + ')';
                const [clients, members, batches, parents] = await Promise.all([
                    reads.clients,
                    reads.members,
                    batchIds.length
                        ? _prodRestRows('batches', PROD_BATCH_SELECT, 'id=' + inList(batchIds), 1000, 1).catch(() => [])
                        : [],
                    parentIds.length
                        ? _prodLoadDeliverableProjection('linear_issue_uuid=' + inList(parentIds)).catch(() => [])
                        : []
                ]);
                if (settled()) return false;
                const seenRows = new Set((_prodState.deliverables || []).map(row => String(row && row.id || '')));
                const added = [];
                rows.concat(Array.isArray(parents) ? parents : []).forEach(row => {
                    const id = String(row && row.id || '');
                    if (!row || !id || seenRows.has(id)) return;
                    seenRows.add(id);
                    added.push(row);
                });
                if (!added.length) return false;
                const seenBatches = new Set((_prodState.batches || []).map(b => String(b && b.id || '')));
                const newBatches = (Array.isArray(batches) ? batches : []).filter(b => b && b.id && !seenBatches.has(String(b.id)));
                _prodState.clients = _prodPreserveProjectedFields(clients, _prodState.clients, 'slug', ['board_desc', 'desc']);
                _prodState.members = members;
                _prodState.batches = (_prodState.batches || []).concat(newBatches);
                _prodState.deliverables = (_prodState.deliverables || []).concat(added);
                _prodState.adapter = _prodAdapter({
                    clients: _prodState.clients,
                    members: _prodState.members,
                    batches: _prodState.batches,
                    deliverables: _prodState.deliverables
                });
                _prodState.loaded = true;
                _prodState.loading = false;
                _prodState.cachePartial = true;                // the board is not here yet
                record.rows = added;
                if (document.getElementById('prodRoot')) _prodRender();
                return true;
            } catch (e) {
                // Silent by design: phase one and the tail cover it as before.
                return false;
            } finally {
                if (_prodDeepLinkFastRows === record && record.rows === null) _prodDeepLinkFastRows = null;
            }
        }
        /* Phase one replaces the deliverable set wholesale. A row the fast
           paint put on screen that phase one does not carry -- a finished one,
           excluded by PROD_LIVE_FILTER -- would vanish at that moment and the
           pane would drop back to a skeleton until the post-phase-one read put
           it back: the flash this whole path exists to remove. Rows are only
           carried within the generation that read them, so a stale paint can
           never outlive the read that supersedes it. */
        function _prodCarryDeepLinkRows(fresh) {
            const carried = _prodDeepLinkFastRows;
            _prodDeepLinkFastRows = null;
            const list = Array.isArray(fresh) ? fresh : [];
            if (!carried || carried.generation !== _prodState.projectionGeneration || !Array.isArray(carried.rows)) return list;
            const seen = new Set(list.map(row => String(row && row.id || '')));
            const keep = carried.rows.filter(row => row && !seen.has(String(row.id || '')));
            return keep.length ? list.concat(keep) : list;
        }
        let _prodDeepLinkFetchInFlight = '';
        async function _prodFetchDeepLinkRow() {
            const wanted = String(_prodState.openId || (_prodState.deepLink && _prodState.deepLink.id) || '').trim();
            if (!wanted || _prodDeepLinkFetchInFlight === wanted) return false;
            if (_prodIssue(wanted)) return false;              // already on the board
            _prodDeepLinkFetchInFlight = wanted;
            const generation = _prodState.projectionGeneration;
            try {
                /* Matched on either column, because a pasted link carries the
                   LINEAR IDENTIFIER while the row is keyed by its canonical id --
                   the same two-names-for-one-row split OPEN_REPAIRS recorded when
                   a shared link hung the comment thread. */
                const query = _prodDeepLinkRowQuery(wanted);
                if (!query) return false;
                const rows = await _prodLoadDeliverableProjection(query);
                if (generation !== _prodState.projectionGeneration) return false;
                if (!Array.isArray(rows) || !rows.length) return false;
                const seen = new Set((_prodState.deliverables || []).map(row => String(row && row.id || '')));
                const added = rows.filter(row => row && !seen.has(String(row.id || '')));
                if (!added.length) return false;
                _prodState.deliverables = (_prodState.deliverables || []).concat(added);
                _prodState.adapter = _prodAdapter({
                    clients: _prodState.clients,
                    members: _prodState.members,
                    batches: _prodState.batches,
                    deliverables: _prodState.deliverables
                });
                if (document.getElementById('prodRoot')) _prodRender();
                return true;
            } catch (e) {
                // Silent by design: the tail is still coming and will cover it.
                return false;
            } finally {
                _prodDeepLinkFetchInFlight = '';
            }
        }
        let _prodTerminalTailRunning = false;
        /* A tail asked for while one is already running. Set rather than
           dropped, because the running tail belongs to the PREVIOUS generation
           and is about to discard itself for exactly that reason -- so without
           this, the generation that asked never gets a tail at all. */
        let _prodTerminalTailRerun = false;
        async function _prodLoadTerminalTail(opts) {
            if (_prodTerminalTailRunning) { _prodTerminalTailRerun = true; return false; }
            _prodTerminalTailRunning = true;
            _prodTerminalTailRerun = false;
            const generation = _prodState.projectionGeneration;
            _prodState.terminalTailPending = true;
            /* Did this run actually resolve the deferred deep link? Only the
               success path below does. Every other exit -- a failed read, a
               generation that moved, an answer that is not an array -- clears
               the pending flag in `finally` and used to stop there, leaving the
               pane painted with "Loading this item..." for a read that is no
               longer running. Raised on PR 1236 as two findings; both are the
               same missing step seen from two exits. */
            let settled = false;
            /* A full pass is the FIRST tail of a projection, anything the reader
               asked for by hand (boot and the Refresh button both arrive here
               non-silently), and one pass an hour so a hard delete converges.
               Everything else -- the ten-minute background reconcile -- reads
               only what moved. `terminalTailLoadedAt` gates on having a tail at
               all: without one there is nothing for a watermark to be relative
               to, and an incremental read would leave the archive empty. */
            const fullPass = !!(opts && opts.full);
            /* An empty watermark still falls back to the full read. That is the
               belt to the caller's braces: without a stamp there is nothing for
               an incremental read to be relative to, and reading incrementally
               anyway would leave the archive empty rather than merely stale. */
            const watermark = fullPass ? '' : _prodTerminalWatermark();
            const filter = watermark
                ? PROD_TERMINAL_FILTER + '&updated_at=gte.' + encodeURIComponent(watermark)
                : PROD_TERMINAL_FILTER;
            try {
                const tail = await _prodLoadDeliverableProjection(filter);
                if (generation !== _prodState.projectionGeneration) return false;
                if (!Array.isArray(tail)) return false;
                const scopeBefore = _prodScopeSignatures(_prodState.adapter);
                if (watermark) {
                    /* UPDATE in place, do not append blind. The full pass below
                       may append only what it has never seen, because the live
                       half it is joining is the fresher of the two. This read is
                       the opposite: every row it returns moved AFTER the copy
                       held here, so a row already present is exactly the one
                       that must be replaced. `_prodMergeDeliverableRows` is the
                       merge the 30-second delta already uses, and it assigns
                       `_prodState.deliverables` itself. */
                    _prodMergeDeliverableRows(
                        _prodDropSupersededRows(tail, _prodState.deliverables));
                } else {
                    // De-duplicate by id rather than concatenating blind: a status
                    // edited between the two reads can legitimately appear in both
                    // halves, and the live half is the fresher of the two.
                    const seen = new Set((_prodState.deliverables || []).map(row => String(row && row.id || '')));
                    _prodState.deliverables = (_prodState.deliverables || [])
                        .concat(tail.filter(row => row && !seen.has(String(row.id || ''))));
                    _prodState.terminalTailFullAt = Date.now();
                }
                const merged = _prodState.deliverables;
                _prodState.adapter = _prodAdapter({
                    clients: _prodState.clients,
                    members: _prodState.members,
                    batches: _prodState.batches,
                    deliverables: merged
                });
                /* NOT _prodInvalidateScopedReads(), and that blanket call was
                   the second refresh.

                   Invalidating every row here threw away every asset read phase
                   one had just completed and forced a second one, so every
                   single load of the tab said "checking" twice in a row.
                   Reported 2026-08-31 as the tab refreshing twice for no
                   visible reason. That was the reason; it arrived with the
                   two-phase boot the night before and nothing else changed.

                   But "phase two only appends, so nothing can change scope" --
                   which is how this was first written -- is FALSE, and the
                   review that caught it was right. _prodAdapter drops only
                   ARCHIVED rows (_prodDeliverableLive), so approved, posted,
                   canceled and duplicate rows all enter the adapter's row set
                   when the tail lands. _prodResolveAttributions walks ancestors
                   through a rowById built from that set: a LIVE child whose
                   nearest mapped ancestor is an approved parent finds nothing
                   in phase one and resolves to needs_attribution, then finds
                   the ancestor in phase two and resolves to that ancestor's
                   client. authorityProject changes under the row.

                   requestStillCurrent() does not cover that. It refuses a
                   response still IN FLIGHT; a read that already completed under
                   the phase-one scope has landed in _prodState.assets and would
                   simply be redrawn under the new client. So the scope is
                   stamped before and after the merge and the rows whose stamp
                   actually moved are invalidated -- normally none of them, so
                   the double refresh stays gone, and exactly the leaking rows
                   pay for a recheck when there are any.

                   The file-pill STATUS is cleared unconditionally, because a
                   terminal row joining a batch legitimately changes which pills
                   that batch draws, and dropping the status is what makes the
                   next render of a parent re-ask. The entries stay: they are
                   the pills on screen, and _prodBatchFileFor refuses one whose
                   row has moved (2026-09-05, with the asset-state change). */
                const rescoped = [];
                const scopeAfter = _prodScopeSignatures(_prodState.adapter);
                scopeBefore.forEach((signature, id) => {
                    if (scopeAfter.get(id) !== signature) rescoped.push(id);
                });
                if (rescoped.length) _prodInvalidateScopedReadsFor(rescoped);
                _prodState.batchFilesStatus.clear();
                _prodState.terminalTailLoadedAt = Date.now();
                /* The row set is only now COMPLETE, so this is the first moment
                   a deep link at finished work can be honoured -- and the first
                   moment an unresolved one is genuinely missing rather than not
                   yet loaded. `_prodApplyDeepLinkFallback` defers both the open
                   and the missing-notice while `terminalTailPending` is set, so
                   without this call a link to an approved or posted row would
                   be deferred and then never applied. Cleared BEFORE the call,
                   because the flag is what tells it to defer. */
                _prodState.terminalTailPending = false;
                // A landed tail re-establishes the row set, so an earlier
                // failure no longer describes what this tab knows.
                _prodState.terminalTailFailed = false;
                _prodApplyDeepLinkFallback(true);
                if (document.getElementById('prodRoot')) _prodRender();
                settled = true;
                return true;
            } catch (e) {
                // The board is already usable without it; a failed tail is not a
                // failed load and must not overwrite the freshness state the
                // successful live read just earned.
                console.warn('[Production] archived-tail read failed', e);
                return false;
            } finally {
                _prodTerminalTailRunning = false;
                _prodState.terminalTailPending = false;
                /* NEITHER LEAVE THE READER ON A SPINNER, NOR STRAND A GENERATION
                   WITH NO TAIL.

                   The comment on the caller used to argue that an overlapping
                   load was covered because "that run's own finally clears the
                   flag". Clearing the flag is not the same as covering the
                   case, and the review that said so was right. When a second
                   phase-one read lands while this tail is in flight, it bumps
                   `projectionGeneration`, its own `_prodLoadTerminalTail()` call
                   returns early, and then THIS run discards itself at the
                   generation check -- so the new generation holds no terminal
                   rows, nothing re-renders, and a deep link to an approved or
                   posted row sits on "Loading this item..." until a later full
                   refresh happens to fix it.

                   So: if someone asked while we were busy AND the generation
                   really did move, hand the current generation its own tail. The
                   flag is re-set synchronously by that call before any paint, so
                   there is no frame in between. Otherwise, if this run did not
                   settle the deep link -- a failed read, a non-array answer --
                   stop claiming to load and let the fallback publish an honest
                   result. A failed read is deliberately NOT retried here: the
                   30s operational refresh is the retry, and a tail that retried
                   itself on failure would spin against a backend that is down. */
                if (_prodTerminalTailRerun && generation !== _prodState.projectionGeneration) {
                    _prodTerminalTailRerun = false;
                    /* A new projection generation has no tail of its own yet, so
                       this rerun is a first tail whatever the displaced call
                       was: ask for the full pass rather than a watermark
                       relative to a row set that belongs to the old scope. */
                    _prodLoadTerminalTail({ full: true });
                } else if (!settled) {
                    /* STOP CLAIMING TO LOAD, WITHOUT STARTING TO ACCUSE.
                       The previous version called `_prodApplyDeepLinkFallback(true)`
                       here and described it as publishing an honest result. It is
                       the opposite: this exit is reached when the read FAILED or
                       came back unusable, so nothing about which rows exist was
                       established, and an authoritative fallback then evicts the
                       reader from a row that is probably fine and tells a deep
                       link that the row has no place in Production.
                       The flag replaces the call. The pane stops spinning because
                       `terminalTailFailed` renders its own state, and the
                       evictions stay deferred because absence still means
                       nothing. The next tail that lands clears it. */
                    _prodTerminalTailRerun = false;
                    _prodState.terminalTailFailed = true;
                    if (document.getElementById('prodRoot')) _prodRender();
                }
            }
        }
        async function _prodLoadData(opts) {
            const silent = !!(opts && opts.silent && _prodState.loaded);
            _prodState.loading = !silent;
            _prodState.refreshing = true;
            _prodState.error = '';
            _prodState.briefsLoaded = false;
            _prodState.briefsLoading = false;
            if (!silent) _prodRender();
            try {
                /* Authority is ONE small row, and it decides whether every write
                   control on screen is live. It used to be awaited inside this
                   group, so the answer -- which arrives in a few hundred ms --
                   was withheld until the deliverable projection finished
                   downloading beside it. Reported 2026-08-31: on a slow
                   connection that is tens of seconds during which every control
                   reads "Write controls are unavailable while authority is
                   being checked", a sentence that was true of the first instant
                   and a lie for the rest of it.
                   Settling it on its own promise changes no gate: the value is
                   the same value, assigned by the same code path, just not held
                   hostage by an unrelated read. The group below still awaits it,
                   so the post-load assignment stays exactly as it was. */
                const authorityPromise = _prodFetchAuthority();
                authorityPromise.then(early => {
                    // Never overwrite a newer answer: a delta refresh or the
                    // 30s poll may already have landed while this was in flight.
                    if (_prodState.authorityReadAt) return;
                    _prodState.authority = early;
                    _prodState.authorityLoaded = true;
                    _prodState.authorityReadAt = Date.now();
                    if (document.getElementById('prodRoot')) _prodRender();
                }).catch(() => {});
                /* Same shape, same reason: which teams' native intake has cut
                   over decides whether an empty linear_issue_uuid still means
                   "syncing" (see _prodNativeEpochOn / _prodAttributionSyncPending),
                   and that answer must not gate the board on its own read. A
                   failed or still-in-flight read only ever LEAVES the previous
                   answer in place -- never resets it to null -- so a transient
                   miss on a silent refresh cannot un-cut-over a team that a
                   prior successful read already confirmed. */
                _prodFetchNativeEpochTeams().then(teams => {
                    if (teams instanceof Set) {
                        _prodState.nativeEpochTeams = teams;
                        if (document.getElementById('prodRoot')) _prodRender();
                    }
                }).catch(() => {});
                const clientsRead = _prodClientRows();
                const membersRead = _prodRestRows('team_members', 'id,name,email,role,team,avatar_color,active', 'order=name.asc', 1000, 10);
                /* A DEEP LINK IS PAINTED FROM ITS OWN READ, not from the board's.

                   Owner report 2026-09-05: following the calendar card's
                   "Open the SyncView Production video sub-issue" link "always
                   takes a lot of time to load. way too much time". The link
                   opens a fresh tab, so there is no warm state: the pane waited
                   here, on the whole live projection (thousands of rows, paged
                   in sequence) plus every batch, before the one row it was
                   asked for could be looked up at all. The one-row read below
                   (`_prodFetchDeepLinkRow`) only ever ran AFTER this await, so
                   the comment promising it "in parallel" was true of the tail
                   and false of the wait that actually hurt.

                   This starts the one-row read now, beside phase one rather
                   than behind it, and paints the detail the moment that row,
                   its batch, its parent, and the two small tables have landed.
                   Phase one keeps running underneath and takes over when it
                   arrives; a row it does not carry (a finished one) is carried
                   across by `_prodCarryDeepLinkRows` so the pane never flashes
                   back to a skeleton. It cannot make the answer wrong: the row
                   is the same row from the same projection, a read that lands
                   late is discarded by the generation check exactly as the
                   post-phase-one read is, and a failure leaves the old path
                   untouched. Not awaited on purpose. */
                _prodDeepLinkFastPaint({ clients: clientsRead, members: membersRead });
                const [clients, members, batches, deliverables, authority] = await Promise.all([
                    clientsRead,
                    membersRead,
                    /* PAGED BY PRIMARY KEY, like the deliverable projection beside
                       it, and for the same two reasons in the same order.

                       CORRECTNESS FIRST. This read paged with OFFSET over
                       `order=created_at.desc`, and `created_at` is not unique
                       here: 85 of the 1,665 batches share their timestamp with
                       another batch, in 39 groups of up to 5. Postgres gives no
                       order within a tie and no promise that two executions
                       resolve one the same way, so a tie group lying across the
                       1,000-row page boundary can hand back a row twice or not
                       at all -- and "not at all" is a filming day that is simply
                       missing from SyncLinear, with no error anywhere. It has
                       not bitten yet because today's boundary happens to fall
                       between two distinct timestamps; that is luck, and it
                       moves every time a batch is created. `id` is unique, so a
                       keyset walk cannot express the bug.

                       WASTE SECOND. The offset pager fires page 0, then bursts
                       four more. 1,665 rows need two pages, so every boot also
                       issued offset=2000, 3000 and 4000 -- three requests
                       returning two bytes each, and three full ORDER BY /
                       OFFSET scans of the relation (~0.8s of database time per
                       boot, measured). The keyset walk asks for exactly the two
                       pages that exist.

                       Arrival order is not load-bearing: `_prodAdapter` keys
                       batches into a map by id and `_prodPreserveProjectedFields`
                       merges by id. Proven rather than assumed -- booting the
                       real app over these rows in server order and in a shuffled
                       order produces the identical batch set, issue set and
                       rendered list. `order=` is dropped by the keyset branch,
                       so it is not passed here rather than passed and ignored. */
                    _prodRestRows('batches', PROD_BATCH_SELECT, '', 1000, 25, { keysetColumn: 'id' }),
                    _prodLoadDeliverableProjection(PROD_LIVE_FILTER),
                    authorityPromise
                ]);
                const mergedClients = _prodPreserveProjectedFields(clients, _prodState.clients, 'slug', ['board_desc', 'desc']);
                const mergedBatches = _prodCarryBatchDescriptions(batches, _prodState.batches);
                /* Decided BEFORE the projection is replaced, and the carry
                   below depends on it. `_prodState.deliverables` still holds
                   the previous set at this point, archive included. */
                const tailFull = _prodTerminalTailFullDue(silent);
                const mergedDeliverables = tailFull
                    ? _prodCarryDeepLinkRows(deliverables)
                    : _prodCarryTerminalRows(_prodCarryDeepLinkRows(deliverables), _prodState.deliverables);
                _prodState.projectionGeneration++;
                _prodInvalidateScopedReads();
                _prodState.clients = mergedClients;
                _prodState.members = members;
                _prodState.batches = mergedBatches;
                /* And no remembered batch-description read outlives a full load.
                   This is the RETRY for a failed one: the visible topbar Refresh
                   runs _prodManualRefresh -> _prodDeltaRefresh({full:true}) ->
                   here, and never touches _prodMarkDescriptionsStale, so an
                   'error' left by a failed read survived the very button offered
                   to clear it -- the batch view kept saying "Description could
                   not load." until a page reload. Raised by Codex on #1364.
                   The shared helper rather than a bare clear(), so a read still
                   in the air is retired rather than left able to land on the new
                   projection. */
                _prodInvalidateBatchDescriptionReads(null);
                _prodState.deliverables = mergedDeliverables;
                _prodState.authority = authority;
                _prodState.authorityLoaded = true;
                _prodState.authorityReadAt = Date.now();
                _prodState.adapter = _prodAdapter({ clients: mergedClients, members, batches: mergedBatches, deliverables: mergedDeliverables });
                _prodState.loaded = true;
                _prodState.loading = false;
                _prodState.refreshing = false;
                _prodState.fromCache = false;
                _prodState.cachePartial = false;
                // F95: a full projection read is also a successful operational
                // sync, so the freshness age and any degraded state clear here.
                _prodState.lastSyncAt = Date.now();
                _prodState.lastFullSyncAt = _prodState.lastSyncAt;
                _prodState.lastSyncError = '';
                _prodState.refreshFailures = 0;
                // Persist this snapshot so the next visit paints instantly.
                _prodCacheWrite({ clients: mergedClients, members, batches: mergedBatches, deliverables: mergedDeliverables, authority });
                /* The tail is PENDING from here, not from when it starts.

                   This ordering is the whole bug the previous two fixes missed.
                   `_prodApplyDeepLinkFallback` runs BEFORE `_prodLoadTerminalTail`,
                   and the pending flag used to be set inside the tail — so at
                   the one moment the eviction fires, phase one has finished,
                   every PROD_CACHE_TERMINAL row is still absent, and the flag
                   that means "absent only means not yet" is still false. The
                   guard added for exactly this could therefore never engage on
                   the path that actually matters, which is why the owner kept
                   being thrown out of a posted parent after both fixes shipped.

                   Setting it here closes the window rather than narrowing it.
                   It cannot latch on: every exit from `_prodLoadTerminalTail`
                   clears it in a `finally`, and the load's own `catch` clears it
                   too, so a throw between this line and the tail call cannot
                   suppress the missing-target notice for the rest of the session.

                   An earlier version of this comment went further and claimed
                   the early return for an already-running tail was COVERED by
                   that run's `finally`. It is not, and PR 1236's review was
                   right to say so: clearing the flag is not the same as giving
                   the new generation a tail. `_prodLoadTerminalTail` now records
                   the overlapping request and re-runs itself for the current
                   generation. */
                _prodState.terminalTailPending = true;
                _prodState.terminalTailFailed = false;
                /* FETCH THE ONE ROW THE READER ASKED FOR, rather than making them
                   wait for the other four thousand.

                   Phase one deliberately excludes every terminal status, so a
                   link to an approved or posted item shows a skeleton until the
                   whole tail lands -- "a couple of seconds", in the owner's
                   words, on every such link. The tail is the right way to fill
                   the BOARD and the wrong way to answer one question.
                   This asks for exactly the linked id in parallel, so the pane
                   fills as soon as that single row returns and the tail keeps
                   running behind it for everything else. */
                _prodFetchDeepLinkRow();
                // Authoritative: re-apply a deep link the cached paint could not
                // resolve, and only now conclude that a target does not exist.
                _prodApplyDeepLinkFallback(true);
                _prodRender();
                /* `silent` is the honest signal for "nobody asked for this".
                   Boot and the Refresh button both reach here non-silently and
                   get the full archive; only the ten-minute background
                   reconcile is silent, and that is precisely the caller that
                   was re-downloading 4,098 finished rows nobody had asked to
                   see. */
                _prodLoadTerminalTail({ full: tailFull });
                setTimeout(() => _prodLoadBriefs({ silent: true }), 6500);
                return true;
            } catch (e) {
                _prodState.loading = false;
                _prodState.refreshing = false;
                /* The settling flag is set by the success path just above,
                   and the only way out of it is a tail that runs. If anything
                   between that line and the tail call throws, we land here with
                   it latched on -- which would suppress the missing-target
                   notice for the rest of the session. Clearing it costs nothing
                   on the ordinary failure path, where it was never set. */
                _prodState.terminalTailPending = false;
                // A refused live read means the current session is no longer
                // authorized for this data; drop the stale first-paint snapshot
                // so it cannot seed a subsequent paint.
                const status = Number(e && e.status);
                if (status === 401 || status === 403) _prodCachePurge();
                if (silent) {
                    /* Returns FALSE rather than throwing, and the difference is
                       the whole repair. An async function that catches and
                       returns RESOLVES, so _prodDeltaRefresh went on to stamp
                       lastFullSyncAt, clear lastSyncError and reset the failure
                       counter -- recording a successful sync for a read that
                       never happened, and ERASING a failure notice the tab had
                       already earned. The freshness control then re-rendered as
                       clean, saying Production refreshes automatically while
                       this tab is open, over data that had stopped refreshing.
                       Rethrowing here would be the tempting fix and the wrong
                       one: three other callers (the tab-return refresh and the
                       two post-create reloads) rely on this never rejecting,
                       and an unhandled rejection fails the boot probes on their
                       zero-console-error contract. A return value costs those
                       callers nothing -- they already ignore it.

                       The STATUS is handed over separately, as a single-use
                       baton, because a boolean cannot carry it and widening the
                       return type would cost the three callers that ignore it
                       the one property that makes this repair safe: two
                       outcomes, trivially distinguishable. Without it a 401 or
                       403 full refresh reached _prodDeltaRefresh as a bare
                       Error and landed on the generic "Live updates are
                       failing. Retry to catch up." -- telling an expired
                       session to retry forever, while the sentence that fits it
                       sat unreachable in the same branch. */
                    _prodState.lastSilentLoadStatus = status || 0;
                    console.warn('[Production] background refresh failed', e);
                    return false;
                }
                _prodState.error = e && e.message ? e.message : String(e);
                _prodRender();
                return false;
            }
        }
        async function _prodLoadEventsFor(id) {
            if (!id || _prodState.events.has(id)) return;
            _prodState.events.set(id, []);
            try {
                const rows = await _prodRestRows('deliverable_events', 'id,deliverable_id,batch_id,client_slug,ts,actor,role,action,from_status,to_status,source,payload', 'deliverable_id=eq.' + encodeURIComponent(id) + '&order=ts.desc', 30, 2);
                _prodState.events.set(id, rows);
            } catch (e) {
                console.warn('[Production] deliverable event read failed', e);
                _prodState.events.set(id, []);
            }
            _prodRender();
        }
        async function _prodLoadLinearRawFor(id) {
            if (!id || _prodState.linearRaw.has(id)) return;
            // The browser-safe projection already carries the exact scalar
            // identity/attribution/archive fields Production consumes. Never
            // hydrate the legacy body JSON into an anonymous browser again.
            _prodState.linearRaw.set(id, {});
        }
        async function _prodLoadBriefs(opts) {
            if (_prodState.briefsLoaded || _prodState.briefsLoading || !_prodState.loaded) return;
            // Descriptions are hydrated only on demand through the guarded,
            // no-store production-write read. This marker merely ends legacy
            // bulk-preload skeletons without fetching body text.
            _prodState.briefsLoaded = true;
            _prodState.briefsLoading = false;
            if (!opts || !opts.silent || _prodState.view === 'detail') _prodRender();
        }
        function _prodSetTeam(team) {
            _prodCaptureListScroll();
            if (team !== 'video' && team !== 'graphics') team = 'all';
            _prodState.team = team;
            _prodState.clientSlug = '';
            if (_prodState.view !== 'board') _prodState.view = 'list';
            _prodState.openId = '';
            _prodState.openBatchId = '';
            _prodState.openProjectId = '';
            _prodState.focusRow = '';
            _prodState.hoverRow = '';
            _prodState.selAnchor = '';
            _prodState.focusCard = '';
            _prodState.cardSel.clear();
            _prodState.cardAnchor = '';
            _prodSetQuery({}, true);
            _prodRender();
        }
        function _prodSetView(view) {
            _prodCaptureListScroll();
            _prodState.view = view === 'board' ? 'board' : view === 'my' ? 'my' : 'list';
            if (_prodState.view === 'board') _prodState.clientSlug = '';
            _prodState.openId = '';
            _prodState.openBatchId = '';
            _prodState.openProjectId = '';
            _prodState.focusRow = '';
            _prodState.hoverRow = '';
            _prodState.selected.clear();
            _prodState.selAnchor = '';
            if (_prodState.view !== 'board') {
                _prodState.focusCard = '';
                _prodState.cardSel.clear();
                _prodState.cardAnchor = '';
            }
            _prodSetQuery({}, true);
            _prodRender();
        }
        function _prodSetTab(tab) {
            _prodState.tab = tab === 'backlog' ? 'backlog' : tab === 'all' ? 'all' : 'active';
            _prodState.openId = '';
            _prodState.openBatchId = '';
            _prodState.openProjectId = '';
            _prodReconcileSelection();
            _prodSetQuery({}, true);
            _prodRender();
        }
        function _prodToggleProjectDetails() {
            _prodState.projectDetailsOpen = _prodState.projectDetailsOpen === false;
            _prodSetQuery({}, true);
            _prodRender();
        }
        function _prodSetFocusRow(id, renderNow) {
            if (!_prodIssue(id)) return;
            if (renderNow) {
                _prodState.focusRow = id;
                _prodState.hoverRow = '';
                _prodRender();
            } else {
                _prodState.hoverRow = id;
            }
        }
        function _prodMoveFocus(delta, extend) {
            // Same surface as _prodRangeSelectRow: shift+Arrow extends a
            // selection, so walking a different list would reintroduce the
            // off-screen range through the keyboard.
            const order = _prodVisibleRowOrder();
            if (!order.length) return;
            const cur = order.indexOf(_prodState.focusRow);
            const prev = cur >= 0 ? _prodState.focusRow : order[0];
            if (extend && !_prodState.selAnchor) _prodState.selAnchor = prev;
            const next = cur < 0 ? (delta > 0 ? 0 : order.length - 1) : Math.max(0, Math.min(order.length - 1, cur + delta));
            _prodState.focusRow = order[next];
            _prodState.hoverRow = '';
            if (extend) _prodRangeSelectRow(_prodState.focusRow);
            _prodRender();
            setTimeout(() => {
                const el = document.querySelector('[data-prod-row="' + CSS.escape(_prodState.focusRow) + '"]');
                if (el) el.scrollIntoView({ block: 'nearest' });
            }, 0);
        }
        function _prodToggleGroup(key) {
            if (_prodState.collapsed.has(key)) _prodState.collapsed.delete(key);
            else _prodState.collapsed.add(key);
            _prodRender();
        }
        function _prodToggleRowSelection(id, keepFocus, ev) {
            if (!_prodIssue(id)) return;
            /* Shift on the CHECKBOX must range-select exactly like shift on the
               row. It did not: the checkbox's inline onclick called this with
               only an id, so the event -- and the shift key with it -- was
               dropped. Shift-clicking the row text selected a range while
               shift-clicking its own checkbox toggled a single row: one gesture,
               two behaviours, and the affordance that LOOKS like the selection
               control was the one that did not do it. Owner report 2026-08-20.
               _prodRangeSelectRow owns the anchor fallback, so a shift-click
               with nothing anchored still degrades to selecting just this row. */
            if (ev && ev.shiftKey) {
                _prodRangeSelectRow(id);
                if (!keepFocus) { _prodState.focusRow = ''; _prodState.hoverRow = ''; }
                _prodRender();
                return;
            }
            if (_prodState.selected.has(id)) _prodState.selected.delete(id);
            else _prodState.selected.add(id);
            _prodState.selAnchor = id;
            if (!keepFocus) {
                _prodState.focusRow = '';
                _prodState.hoverRow = '';
            }
            _prodRender();
        }
        /* The ordered ids of the rows the ACTIVE surface is actually showing.
           _prodFlatOrder is the grouped top-level list, which is right for the
           list / my / project views (_prodCurIssuesUnfiltered is already
           project-aware) but wrong for the two surfaces that render their own
           row set. In a detail view the screen shows only that parent's
           sub-issues, and in a batch view only that batch -- so a range taken
           from the flat order would sweep in issues BETWEEN the two clicked
           ids that are not on screen at all, and the next bulk action would
           mutate them invisibly. Range selection must never reach a row the
           user cannot see. */
        function _prodVisibleRowOrder() {
            if (_prodState.view === 'detail' && _prodState.openId) {
                // A sub-issue's own detail renders no child list, so nothing is
                // selectable there and an empty order is the honest answer.
                /* Resolve through _prodIssue and then use ITS id, never the raw
                 * openId. `openId` may be a Linear identifier -- the Workload
                 * popover's parent link is built as ?prod=1&d=<identifier>, and
                 * that is the main way anyone reaches a parent -- while a child's
                 * `parent` field holds the deliverable UUID. Passing the raw
                 * identifier to _prodChildrenOf matched nothing, so this returned
                 * [] on exactly the surface it exists to make selectable, and both
                 * reported bugs stayed live on the deep-link path. */
                const open = _prodIssue(_prodState.openId);
                if (open && open.parent) return [];
                return _prodChildrenOf(open ? open.id : _prodState.openId)
                    .map(row => row && row.id).filter(Boolean);
            }
            if (_prodState.view === 'batch' && _prodState.openBatchId) {
                return _prodBatchRows(_prodState.openBatchId).map(row => row && row.id).filter(Boolean);
            }
            // The project view paints its own grouped rows through
            // _prodProjectIssueRowHTML; without this branch it fell through to
            // the top-level list order, which is a different set of rows.
            if (_prodState.view === 'project' && _prodState.openProjectId) {
                const out = [];
                _prodGroupsFor(_prodIssueRows()).forEach(g => {
                    if (!_prodState.collapsed.has(g.key)) (g.items || []).forEach(i => out.push(i.id));
                });
                return out;
            }
            return _prodFlatOrder();
        }
        function _prodRangeSelectRow(id) {
            if (!_prodIssue(id)) return;
            const order = _prodVisibleRowOrder();
            const anchor = _prodState.selAnchor || _prodState.focusRow || Array.from(_prodState.selected || [])[0] || id;
            let a = order.indexOf(anchor);
            let b = order.indexOf(id);
            if (a < 0 || b < 0) {
                _prodState.selected.add(id);
                _prodState.selAnchor = id;
                return;
            }
            if (a > b) { const t = a; a = b; b = t; }
            _prodState.selected.clear();
            for (let i = a; i <= b; i++) _prodState.selected.add(order[i]);
        }
        function _prodRowClick(ev, id) {
            if (ev && (ev.shiftKey || ev.metaKey || ev.ctrlKey)) {
                ev.preventDefault();
                ev.stopPropagation();
                if (ev.shiftKey) _prodRangeSelectRow(id);
                else {
                    if (_prodState.selected.has(id)) _prodState.selected.delete(id);
                    else _prodState.selected.add(id);
                    _prodState.selAnchor = id;
                }
                _prodState.focusRow = '';
                _prodState.hoverRow = '';
                _prodRender();
                return false;
            }
            _prodOpenDeliverable(id);
            return false;
        }
        function _prodStatusIconClick(ev, id) {
            if (ev && (ev.shiftKey || ev.metaKey || ev.ctrlKey)) return _prodRowClick(ev, id);
            return _prodOpenStatusMenu(ev, id);
        }
        function _prodSetFocusCard(slug, renderNow) {
            if (!_prodClient(slug)) return;
            _prodState.focusCard = String(slug || '');
            if (renderNow) _prodRender();
        }
        function _prodScrollCardIntoView() {
            setTimeout(() => {
                if (!_prodState.focusCard) return;
                const el = document.querySelector('[data-prod-client-card="' + CSS.escape(_prodState.focusCard) + '"]');
                if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }, 0);
        }
        function _prodMoveCardFocus(dx, dy) {
            const cols = _prodBoardCols();
            if (!cols.length) {
                _prodState.focusCard = '';
                return;
            }
            const loc = _prodState.focusCard ? _prodBoardLoc(cols, _prodState.focusCard) : null;
            if (!loc) {
                _prodState.focusCard = cols[0].ids[0];
                _prodRender();
                _prodScrollCardIntoView();
                return;
            }
            let c = loc.c;
            let r = loc.r;
            if (dy) r = Math.max(0, Math.min(cols[c].ids.length - 1, r + dy));
            if (dx) {
                c = Math.max(0, Math.min(cols.length - 1, c + dx));
                r = Math.min(r, cols[c].ids.length - 1);
            }
            _prodState.focusCard = cols[c].ids[r];
            _prodRender();
            _prodScrollCardIntoView();
        }
        function _prodToggleCardSelection(slug, shift, keepFocus) {
            const id = String(slug || '');
            if (!_prodClient(id)) return;
            if (shift && _prodState.cardAnchor) {
                const order = _prodBoardFlat();
                let a = order.indexOf(_prodState.cardAnchor);
                let b = order.indexOf(id);
                if (a >= 0 && b >= 0) {
                    if (a > b) { const t = a; a = b; b = t; }
                    for (let i = a; i <= b; i++) _prodState.cardSel.add(order[i]);
                } else {
                    _prodState.cardSel.add(id);
                    _prodState.cardAnchor = id;
                }
            } else {
                if (_prodState.cardSel.has(id)) _prodState.cardSel.delete(id);
                else _prodState.cardSel.add(id);
                _prodState.cardAnchor = id;
            }
            _prodState.focusCard = keepFocus ? id : '';
            _prodRender();
        }
        function _prodCardClick(ev, slug) {
            if (ev) {
                ev.preventDefault();
                ev.stopPropagation();
            }
            if (ev && (ev.shiftKey || ev.metaKey || ev.ctrlKey)) {
                _prodToggleCardSelection(slug, !!ev.shiftKey, false);
                return false;
            }
            _prodState.cardSel.clear();
            _prodState.cardAnchor = '';
            _prodOpenProject(slug);
            return false;
        }
        function _prodOpenCardBulk(kind, ev) {
            const first = Array.from(_prodState.cardSel || [])[0] || _prodState.focusCard || _prodBoardFlat()[0] || '';
            if (!first) return false;
            return _prodOpenProjectPicker(kind, ev, first);
        }
        function _prodGuardGroupSelection(key) {
            _prodReadonlyGuard(PROD_GROUP_SELECT_UNSUPPORTED);
            return false;
        }
        function _prodToggleBoardColumn(status) {
            status = _prodBoardStatus(status);
            if (_prodState.colCollapsed.has(status)) _prodState.colCollapsed.delete(status);
            else _prodState.colCollapsed.add(status);
            _prodRender();
        }
        function _prodToggleSection(section) {
            if (!_prodState.secOpen[section]) _prodState.secOpen[section] = true;
            else _prodState.secOpen[section] = false;
            _prodRender();
        }
        function _prodToggleTeam(team) {
            if (!_prodState.teamOpen[team]) _prodState.teamOpen[team] = true;
            else _prodState.teamOpen[team] = false;
            _prodRender();
        }
        function _prodOpenTeamView(team, view) {
            _prodCaptureListScroll();
            _prodState.team = team === 'video' || team === 'graphics' ? team : 'all';
            _prodState.view = view === 'board' ? 'board' : 'list';
            _prodState.clientSlug = '';
            _prodState.openId = '';
            _prodState.openBatchId = '';
            _prodState.openProjectId = '';
            _prodState.focusRow = '';
            _prodState.hoverRow = '';
            _prodState.selected.clear();
            _prodState.selAnchor = '';
            _prodState.focusCard = '';
            _prodState.cardSel.clear();
            _prodState.cardAnchor = '';
            _prodSetQuery({}, true);
            _prodRender();
        }
        function _prodOpenClient(slug) {
            _prodCaptureListScroll();
            _prodState.clientSlug = String(slug || '');
            _prodState.view = 'list';
            _prodState.openId = '';
            _prodState.openBatchId = '';
            _prodState.openProjectId = '';
            _prodState.focusRow = '';
            _prodState.hoverRow = '';
            _prodState.selected.clear();
            _prodState.selAnchor = '';
            _prodState.focusCard = '';
            _prodState.cardSel.clear();
            _prodState.cardAnchor = '';
            _prodSetQuery({}, true);
            _prodRender();
        }
        function _prodOpenDeliverable(id) {
            _prodCaptureListScroll();
            _prodState.openId = id;
            _prodState.openBatchId = '';
            _prodState.openProjectId = '';
            _prodState.view = 'detail';
            _prodState.selected.clear();
            _prodState.selAnchor = '';
            _prodState.focusCard = '';
            _prodState.cardSel.clear();
            _prodState.cardAnchor = '';
            _prodSetQuery({ d: id }, true);
            _prodRender();
            _prodScrollDetailToTop();
            _prodComments.ensure(id);
            _prodComments.refresh(id);
            _prodLoadLinearRawFor(id);
        }
        function _prodOpenBatch(id) {
            // A batch imported from Linear has a real parent card -- Sub-issues N,
            // client chip, link, due date, assignee -- and that card is the
            // correct landing page. Only a native post-cutoff batch, which has
            // no such row, stays on the plain batch view (owner report
            // 2026-09-21). The three Workload deep links that send a native
            // batch here on purpose (wlParentUrl, the client-groups syncUrl,
            // the popover parentSyncUrl) are untouched -- this is the one place
            // every OTHER deep link into a batch benefits from the redirect.
            const parent = _prodBatchParentIssue(_prodBatch(id));
            if (parent) return _prodOpenDeliverable(parent.displayId || parent.id);
            _prodState.openBatchId = id;
            _prodState.openId = '';
            _prodState.openProjectId = '';
            _prodState.view = 'batch';
            _prodState.selected.clear();
            _prodState.selAnchor = '';
            _prodState.focusCard = '';
            _prodState.cardSel.clear();
            _prodState.cardAnchor = '';
            _prodSetQuery({ batch: id }, true);
            _prodRender();
            _prodScrollDetailToTop();
        }
        function _prodOpenProject(slug) {
            const id = String(slug || '');
            if (id === PROD_ATTRIBUTION_NEEDS || id === PROD_ATTRIBUTION_CONFLICT) {
                _prodToast('This is an attribution repair group, not a client project.');
                return false;
            }
            if (!_prodClient(id)) return _prodOpenClient(id);
            _prodCaptureListScroll();
            _prodState.openProjectId = id;
            _prodState.openId = '';
            _prodState.openBatchId = '';
            _prodState.clientSlug = '';
            _prodState.projectDetailsOpen = true;
            _prodState.view = 'project';
            _prodState.selected.clear();
            _prodState.selAnchor = '';
            _prodState.cardSel.clear();
            _prodState.cardAnchor = '';
            _prodSetQuery({}, true);
            _prodRender();
            _prodScrollDetailToTop();
        }
        function _prodOpenTeamScopeMenu(ev, view) {
            if (ev) {
                ev.preventDefault();
                ev.stopPropagation();
            }
            const nextView = view === 'board' || _prodState.view === 'board' || _prodState.view === 'project' ? 'board' : 'list';
            const current = _prodState.team || 'all';
            const rows = [
                ['all', 'All teams'],
                ['video', 'Video'],
                ['graphics', 'Graphics']
            ];
            const p = _prodLayerPop('<div class="prod-pop-hd">Team scope</div><div class="prod-pop-list">' + rows.map(row => '<div class="prod-mi" data-prod-team-scope="' + row[0] + '"><span class="mic">' + (row[0] === 'all' ? _prodIcon('issues') : row[0] === 'video' ? '📽️' : '🎨') + '</span><span class="mlbl">' + row[1] + '</span>' + (current === row[0] ? '<span class="tick">' + _prodIcon('check') + '</span>' : '') + '</div>').join('') + '</div>', ev ? ev.clientX : innerWidth / 2, ev ? ev.clientY : 120);
            p.querySelectorAll('[data-prod-team-scope]').forEach(el => el.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                const team = el.getAttribute('data-prod-team-scope') || 'all';
                _prodClearLayer();
                _prodOpenTeamView(team, nextView);
            }));
            _prodWirePlainMenu(p);
            return false;
        }
        function _prodRefresh(opts) {
            const silent = !!(opts && opts.silent && _prodState.loaded);
            /* A return to the tab asks for what CHANGED, not for everything.
               Until 2026-09-08 `_prodAutoRefreshOnReturn` came through the full
               path below: every batch and every live deliverable again, in
               sequential pages (about 2 MB compressed), every time the tab was
               left for 30 seconds -- the single most repeated download in the
               app, and the one the owner felt as "sometimes really slow". The
               30-second operational tick already knew how to do better:
               `_prodDeltaRefresh` reads rows stamped since the last watermark
               and falls back to a full reconcile once every
               PROD_FULL_RECONCILE_MS. A tab return now takes that route.
               Authority is still re-read (one tiny row) because a flipped gate
               must not wait for a row to change, and the open thread's comments
               are refreshed here only on the full-reconcile turn -- the delta
               branch refreshes them itself. The manual Refresh button keeps
               the full path. */
            if (silent && opts && opts.incremental) {
                _prodRefreshAuthority({ silent: true });
                const reconcileDue = (Date.now() - Number(_prodState.lastFullSyncAt || 0)) >= PROD_FULL_RECONCILE_MS;
                if (reconcileDue && _prodState.view === 'detail' && _prodState.openId) _prodComments.refresh(_prodOpenRowId());
                _prodDeltaRefresh({ force: true });
                return;
            }
            // Quarantine every protected response synchronously, before the
            // replacement projection request can resolve. A held old-scope
            // response therefore cannot land during the refresh window.
            _prodInvalidateScopedReads();
            if (!silent) _prodState.loaded = false;
            _prodState.adapter = null;
            _prodState.events = new Map();
            _prodMarkDescriptionsStale();
            /* The asset cache is NOT rebuilt here any more, and that line was
               the whole reported bug on this path.

               _prodInvalidateScopedReads above already decides what survives a
               refresh -- it preserves a completed, scope-stamped read so the
               links stay on screen while they revalidate. This line then threw
               all of it away one statement later, keeping only rows with a
               pending attachment write, so every tab return still walked the
               panel back through the skeleton. Raised on #1201 review, and it
               is the path that actually fires: _prodAutoRefreshOnReturn calls
               _prodRefresh, not _prodLoadData.

               The pending-attachment-write case it existed for is now one of
               the preserve conditions inside the invalidation, so nothing is
               lost by deleting it -- there is one rule instead of two that
               disagreed. */
            _prodState.labels = new Map([..._prodState.labels].filter(([id]) =>
                _prodState.writes.has(String(id || '') + ':labels')));
            if (_prodState.view === 'detail' && _prodState.openId) _prodComments.refresh(_prodOpenRowId());
            _prodRefreshAuthority({ silent: true });
            _prodLoadData({ silent });
        }
        let _prodLastAutoRefreshAt = 0;
        function _prodAutoRefreshOnReturn() {
            if (!_prodEnabled() || document.hidden) return;
            _prodRefreshPolicyDay();
            /*
             * A CACHED PAINT MADE THIS FIRE ON EVERY WARM BOOT.
             *
             * `pageshow` arrives right after mount, and mount now hydrates from
             * the snapshot -- which sets `loaded` before this listener runs,
             * while `loading` stays false because the revalidation it started
             * is silent. Both guards therefore passed and every warm load ran
             * TWO complete reads of clients, members, batches and the whole
             * paged deliverable projection: measured 2026-08-26, the second one
             * opened 740ms after the first and doubled the work of the load the
             * cache exists to avoid.
             *
             * `refreshing` is the honest question -- is a load already running
             * -- and it is cleared on both the success and the failure path, so
             * a refresh that fails cannot wedge the tab out of ever refreshing
             * on return again.
             */
            if (!_prodState.loaded || _prodState.loading || _prodState.refreshing) return;
            const now = Date.now();
            if (now - _prodLastAutoRefreshAt < 30000) return;
            _prodLastAutoRefreshAt = now;
            _prodRefresh({ silent: true, incremental: true });
        }
        // ---- F95: bounded foreground operational refresh --------------------
        // Production loaded operational rows once at mount and re-read them only
        // on focus/visibility/pageshow return; the one repeating timer refreshed
        // authority, not work data. A continuously foreground queue or issue
        // could therefore hold cached assignment/status/due/artifact/comment
        // state indefinitely, with no last-success age, no visible degraded
        // state, and no manual Refresh.
        //
        // The tick is a delta read, not a re-pull: it asks only for rows at or
        // after the highest updated_at already held. The 2026-07-25 read-path
        // probe measured that delta at 27-39 ms upstream against ~1.2 s for one
        // full page, so a tick costs roughly 3% of a single boot page. A slower
        // full reconcile still runs so hard deletions and any missed row
        // converge, and every tick is skipped while the tab is hidden, while a
        // write is in flight, or while a foreground load is already running.
        const PROD_DELTA_REFRESH_MS = 30000;
        const PROD_FULL_RECONCILE_MS = 600000;
        /* How often the FINISHED half is re-read in full.

           It used to be re-read on every full reconcile, so an open tab
           downloaded all of it six times an hour. Measured live 2026-09-09:
           4,098 terminal rows, 182 KB compressed per page of 1,000, five
           strictly sequential pages -- about 0.9 MB and several seconds, for
           work that is done and by definition not moving. Over an eight-hour
           day that is ~43 MB of re-downloading the archive.

           It does not need the reconcile's cadence. The 30-second delta reads
           `updated_at >= watermark` with NO status filter, so a row that
           CHANGES -- including one that just became approved or posted --
           already arrives on the next tick. The only thing a full re-read adds
           is convergence for a hard DELETE, which no watermark read can see.
           So the full pass survives at its own, much slower cadence, and the
           reconcile takes a watermarked read instead. */
        const PROD_TERMINAL_FULL_MS = 3600000;
        const PROD_REFRESH_MAX_BACKOFF_MS = 300000;
        const PROD_STALE_AFTER_MS = 120000;
        function _prodRowUpdatedMs(row) {
            const value = String(row && row.updated_at || '');
            const parsed = value ? Date.parse(value) : NaN;
            return Number.isFinite(parsed) ? parsed : -1;
        }
        function _prodDeliverableWatermark(rows) {
            let best = '';
            let bestMs = -1;
            (rows || []).forEach(row => {
                const ms = _prodRowUpdatedMs(row);
                if (ms > bestMs) {
                    bestMs = ms;
                    best = String(row.updated_at || '');
                }
            });
            return best;
        }
        /* The newest stamp among the FINISHED rows this tab holds.

           Deliberately not `_prodDeliverableWatermark(_prodState.deliverables)`:
           the live half moves every few minutes and the finished half does not,
           so the whole-projection stamp is almost always newer than every
           terminal row. Reading from it would skip the rows this is for. */
        /* Drop a tail row that is OLDER than the copy already held.

           `_prodMergeDeliverableRows` replaces on any timestamp DIFFERENCE, not
           only on a newer one. That is safe for the 30-second delta, whose
           watermark is the max over the whole projection, so no response it
           returns can predate a row already held. It is NOT safe here: this
           read's watermark is the ARCHIVE's, which is routinely older than a
           live row, and the read itself spans several seconds.

           The case that bites is a row LEAVING the archive. The tail selects it
           while it is still `approved`; a delta or a user write moves it to
           `in_progress` while the read is in flight; the late response then
           reverts the row's status in the open tab until a later refresh, and
           someone can act on that stale state. Raised by Codex on #1366.

           A row with no parseable stamp on either side is kept: absence of
           proof that it is stale is not proof that it is. */
        function _prodDropSupersededRows(rows, previous) {
            const incoming = Array.isArray(rows) ? rows : [];
            if (!incoming.length) return incoming;
            const held = new Map((Array.isArray(previous) ? previous : [])
                .map(row => [String(row && row.id || ''), row])
                .filter(([id]) => id));
            return incoming.filter(row => {
                const current = held.get(String(row && row.id || ''));
                if (!current) return true;
                return _prodRowUpdatedMs(row) >= _prodRowUpdatedMs(current);
            });
        }
        function _prodTerminalWatermark() {
            return _prodDeliverableWatermark(
                (_prodState.deliverables || []).filter(_prodCacheIsTerminal));
        }
        /* Is the NEXT tail a full pass? Decided here rather than inside the
           tail, because `_prodLoadData` has to know the answer BEFORE it
           replaces the projection: a full pass re-reads the archive and must
           not carry a stale copy of it, an incremental pass carries the copy
           and reads only what moved. Two callers, one rule. */
        function _prodTerminalTailFullDue(silent) {
            return !silent
                || !Number(_prodState.terminalTailLoadedAt || 0)
                || (Date.now() - Number(_prodState.terminalTailFullAt || 0)) >= PROD_TERMINAL_FULL_MS;
        }
        /* Carry the finished rows across phase one.

           Phase one reads the LIVE half only and replaces the projection with
           it, which drops every terminal row; phase two then re-read all 4,098
           of them, which is exactly what made that re-read look necessary.
           An incremental phase two cannot rebuild the archive from a
           watermarked read, so the archive has to survive phase one instead.

           The live half WINS on a collision: a row that has just left a
           terminal status appears in `live` with its new value, and the copy
           held here is by definition the older one. (Raised by Codex on #1366,
           which caught that computing the watermark after the replacement
           always yielded '' and silently fell back to the full read.) */
        function _prodCarryTerminalRows(live, previous) {
            const rows = Array.isArray(live) ? live : [];
            const held = (Array.isArray(previous) ? previous : []).filter(_prodCacheIsTerminal);
            if (!held.length) return rows;
            const liveIds = new Set(rows.map(row => String(row && row.id || '')));
            return rows.concat(held.filter(row => row && !liveIds.has(String(row.id || ''))));
        }
        function _prodInvalidateScopedReadsFor(ids) {
            const targets = new Set((ids || []).map(id => String(id || '')).filter(Boolean));
            if (!targets.size) return;
            targets.forEach(id => {
                _prodState.assetRequestTokens.set(id, Number(_prodState.assetRequestTokens.get(id) || 0) + 1);
                _prodState.descriptionRequestTokens.set(id, Number(_prodState.descriptionRequestTokens.get(id) || 0) + 1);
                _prodState.labelRequestTokens.set(id, Number(_prodState.labelRequestTokens.get(id) || 0) + 1);
                _prodState.assigneeOptionRequestTokens.set(id, Number(_prodState.assigneeOptionRequestTokens.get(id) || 0) + 1);
                _prodState.assigneeOptions.delete(id);
                _prodState.events.delete(id);
                _prodState.linearRaw.delete(id);
                const asset = _prodState.assets.get(id);
                /* Marked stale, never deleted (2026-09-05). This is the delta
                   tick's invalidation, and deleting here was one of the "two
                   or three times" the owner counted a link vanish and come
                   back on a single tab return: the row's projection changed,
                   its cached read was dropped, and the next render reseeded a
                   skeleton for values about to be read back identical. The
                   stamped values stay on screen while _prodEnsureAssets
                   re-reads, and _prodAssetState refuses them at use time if
                   the row's scope is what changed. The open-editor branch
                   already worked this way; now there is one rule. */
                if (asset) { asset.status = 'idle'; asset.complete = false; asset.error = ''; asset.remoteChanged = true; }
                const label = _prodState.labels.get(id);
                if (label && !label.saving) _prodState.labels.delete(id);
                const description = _prodState.descriptions.get(id);
                if (description && !description.editing && !description.saving) _prodState.descriptions.delete(id);
                else if (description) {
                    description.refreshing = false;
                    description.status = description.hasValue ? 'stale' : 'idle';
                    description.refreshError = '';
                    description.remoteChanged = true;
                }
            });
        }
        function _prodMergeDeliverableRows(changed) {
            const rows = Array.isArray(changed) ? changed : [];
            if (!rows.length) return [];
            const byId = new Map((_prodState.deliverables || [])
                .map(row => [String(row && row.id || ''), row])
                .filter(([id]) => id));
            const changedIds = [];
            rows.forEach(row => {
                const id = String(row && row.id || '');
                if (!id) return;
                const previous = byId.get(id);
                // An unchanged echo (the watermark boundary is inclusive so no
                // same-timestamp row can slip through) must not churn caches.
                if (previous && String(previous.updated_at || '') === String(row.updated_at || '')) {
                    byId.set(id, row);
                    return;
                }
                changedIds.push(id);
                byId.set(id, row);
            });
            _prodState.deliverables = Array.from(byId.values());
            return changedIds;
        }
        function _prodRefreshAgeMs() {
            return _prodState.lastSyncAt ? Math.max(0, Date.now() - _prodState.lastSyncAt) : -1;
        }
        function _prodRefreshDegraded() {
            const age = _prodRefreshAgeMs();
            return !!_prodState.lastSyncError || (age >= 0 && age > PROD_STALE_AFTER_MS);
        }
        function _prodRefreshAgeLabel() {
            const age = _prodRefreshAgeMs();
            if (age < 0) return 'not yet synced';
            if (age < 60000) return 'updated ' + Math.max(1, Math.round(age / 1000)) + 's ago';
            if (age < 3600000) return 'updated ' + Math.round(age / 60000) + 'm ago';
            return 'updated ' + Math.round(age / 3600000) + 'h ago';
        }
        /* While the list is the saved copy (fromCache, cleared by the first live
           read), the control says so and when it was saved -- a stale list is
           acceptable only when it says it is one, the rule Workload's cached
           board follows (OPEN_REPAIRS 230 item 3). */
        function _prodCachedNoticeHTML() {
            const at = new Date(Number(_prodState.cachedAt) || Date.now());
            const hhmm = String(at.getHours()).padStart(2, '0') + ':' + String(at.getMinutes()).padStart(2, '0');
            const time = at.toDateString() === new Date().toDateString()
                ? hhmm : at.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + hhmm;
            const failed = !!_prodState.lastSyncError;
            const label = failed ? 'Couldn’t update · saved list from ' + time : 'Showing saved list from ' + time + ' · updating…';
            const detail = failed
                ? 'This is the list saved at ' + time + '. It could not be updated just now. Try Refresh.'
                : 'This is the list saved at ' + time + '. It is being replaced with the live list now.';
            return '<div class="prod-freshness" data-prod-freshness="' + (failed ? 'degraded' : 'cached') + '">'
                + '<span class="prod-freshness-age" data-prod-freshness-age aria-live="polite">' + _calEsc(label) + '</span>'
                + '<button class="prod-icon-btn" type="button" data-prod-refresh="1"'
                + (_prodState.refreshInFlight ? ' disabled' : '')
                + ' aria-label="Refresh Production data" title="' + _calEscAttr(detail)
                + '" data-prod-tip="' + _calEscAttr(label + '|' + detail) + '" onclick="return _prodManualRefresh()">'
                + PROD_REFRESH_ICON + '</button></div>';
        }
        function _prodFreshnessHTML() {
            if (_prodState.fromCache) return _prodCachedNoticeHTML();
            const degraded = _prodRefreshDegraded();
            const label = _prodRefreshAgeLabel();
            const detail = _prodState.lastSyncError
                ? _prodState.lastSyncError
                : degraded
                    ? 'Live updates are behind. Refresh to catch up.'
                    : 'Production refreshes automatically while this tab is open.';
            return '<div class="prod-freshness" data-prod-freshness="' + (degraded ? 'degraded' : 'fresh') + '">'
                + '<span class="prod-freshness-age" data-prod-freshness-age aria-live="polite">'
                + _calEsc(_prodState.lastSyncError ? 'Update failed · ' + label : label) + '</span>'
                + '<button class="prod-icon-btn" type="button" data-prod-refresh="1"'
                + (_prodState.refreshInFlight ? ' disabled' : '')
                + ' aria-label="Refresh Production data" title="' + _calEscAttr(detail)
                + '" data-prod-tip="' + _calEscAttr(label + '|' + detail) + '" onclick="return _prodManualRefresh()">'
                + PROD_REFRESH_ICON + '</button></div>';
        }

;(self.__svParts || (self.__svParts = [])).push("js/sv-12-synclinear-efea10ed3de1.js");
