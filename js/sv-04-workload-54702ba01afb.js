    function wlReadCache() {
        try {
            const raw = localStorage.getItem(LINEAR_ISSUES_CACHE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.fetchedAt || !Array.isArray(parsed.issues)) return null;
            return parsed;
        } catch { return null; }
    }
    function wlWriteCache(payload) {
        try { localStorage.removeItem(WL_LEGACY_CACHE_KEY); } catch {}
        let issues = Array.isArray(payload && payload.issues) ? payload.issues : [];
        try {
            // Only what wlApplyData can draw: active sub-issues and their parents.
            const parents = new Set();
            const subs = issues.filter(issue => issue && issue.isSubIssue && wlIsActiveStatus(issue));
            for (const sub of subs) if (sub.parentId) parents.add(sub.parentId);
            issues = issues.filter(issue => issue && (issue.isSubIssue
                ? wlIsActiveStatus(issue) : parents.has(issue.id)));
        } catch {}
        // The editor roster (a few dozen short rows), only when it is complete,
        // so a cached paint lists the same editors -- "Free" ones included --
        // as the live board instead of adding them a moment later.
        const roster = wlState.editorRosterStatus === 'ready' && Array.isArray(wlState.editorRoster)
            ? wlState.editorRoster.map(m => ({ id: m.id, native_id: m.native_id, name: m.name, team: m.team }))
            : undefined;
        try {
            localStorage.setItem(LINEAR_ISSUES_CACHE_KEY, JSON.stringify({ ...payload, issues, roster }));
        } catch (error) {
            // A write that fails must not leave the PREVIOUS board behind to be
            // painted as if it were the last good one.
            wlDropCache();
            console.warn('[Workload] could not store the warm-start board; it will not be shown', error && error.name);
        }
    }
    /* The roster saved with a cached board, checked with the same rules the
       live snapshot applies (wlFetchNativeSnapshot); null if anything is off. */
    function wlCachedRoster(cache) {
        const roster = cache && cache.roster;
        if (!Array.isArray(roster) || roster.length > 1000) return null;
        const ids = new Set();
        for (const m of roster) {
            if (!m || typeof m.id !== 'string' || !m.id.trim() || ids.has(m.id)
                || typeof m.native_id !== 'string' || !m.native_id.trim()
                || typeof m.name !== 'string' || !m.name.trim()
                || !['video', 'graphics'].includes(m.team)) return null;
            ids.add(m.id);
        }
        return roster.map(m => ({ ...m }));
    }
    /* A cached board is painted only when it is recent enough to be useful. */
    function wlCachedBoardUsable(cache) {
        return !!(cache && Array.isArray(cache.issues) && cache.issues.length
            && typeof cache.fetchedAt === 'number' && cache.fetchedAt <= Date.now()
            && Date.now() - cache.fetchedAt < WL_CACHED_BOARD_MAX_AGE_MS);
    }
    /* A snapshot known to be INCOMPLETE must not be replayed.
       A forced refresh writes whatever the Linear webhook returned straight
       into this cache, short payload and all, and an ordinary load replays it
       for the next five minutes -- so telling the owner to reload would have
       handed them the same short board with the warning cleared, which is
       worse than saying nothing (Codex review, PR 1404). Dropping it costs a network
       read on the next boot and makes that instruction true: the reload misses
       the cache, reads the complete mirror, and the board comes back whole. */
    function wlDropCache() {
        try { localStorage.removeItem(LINEAR_ISSUES_CACHE_KEY); } catch {}
        try { localStorage.removeItem(WL_LEGACY_CACHE_KEY); } catch {}
    }
    function wlIsFresh(fetchedAt) {
        return typeof fetchedAt === 'number' && (Date.now() - fetchedAt) < LINEAR_ISSUES_TTL_MS;
    }

    /* ===================================================================
     * WORKLOAD v2 — Supabase-backed reads (clone of the samples-v2 / calendar-v2
     * runtime). Hidden behind ?wl2=1 until the flip. Reads come from the
     * workload_issues table (kept fresh by the reconcile + Linear webhook) over
     * REST with a realtime subscription, instead of the live multi-workspace
     * Linear sweep. ANY Supabase failure falls back to the linear-issues webhook,
     * so v2 can never blank the board. Rollback for everyone = leave the default
     * false; rollback for one browser = ?wl2=0.
     * =================================================================== */
    const WL_V2_RT_DEBOUNCE_MS = 500;
    // Realtime auto-update is ON. It was gated off because the board read
    // workload_issues, which the n8n reconcile re-wrote in full each run (to
    // advance synced_at for the mark-sweep) — ~1 event per row per run, a flood
    // for open boards. The native source writes only what changed, so the
    // condition that comment named ("flip to true once the reconcile only
    // writes changed rows") is satisfied by the source swap itself. The channel
    // below is bound to public.deliverables + public.batches accordingly.
    // Rollback: set this back to false and push; WL_V2_WATERMARK_POLL_MS still
    // keeps the board fresh, just more slowly.
    const WL_V2_REALTIME       = true;
    // _wlV2Enabled and its keys live in core (066): the router reads the
    // ?wl2 switch before it leaves the address, even before Workload loads.
    // The old sticky mirror kill switch cannot reopen a provider read path.
    function _wlV2Ready() { return !!CAL_SUPABASE_URL && !!CAL_SUPABASE_ANON_KEY; }

    // Fast first paint: publish the (non-sensitive) issue rows and drop the
    // skeleton as soon as the fast Supabase read returns, instead of blocking
    // the whole cold load on the live-Linear weight-metadata sweep. Plans stay
    // gated behind the fail-closed auth check (no early adoption), but every
    // item is placed with the same automatic due−1-working-day estimate the
    // post-plan board uses, so never-manually-planned items land in their final
    // column and don't move; only manually-planned items settle when plans
    // arrive, and weights refine in place. Default ON with a sticky per-browser
    // kill switch mirroring ?wl2: ?wlfast=0 forces the original block-until-
    // metadata behavior, ?wlfast=1 clears the opt-out. Flip WL_FAST_PAINT_DEFAULT
    // to false to disable for everyone (lossless — it only reorders paint).
    const WL_FAST_PAINT_DEFAULT = true;
    const WL_FAST_PAINT_KILL_KEY = 'syncview_workload_fastpaint_off';
    let _wlFastPaintFlagCache = null;
    function _wlFastPaintEnabled() {
        if (_wlFastPaintFlagCache !== null) return _wlFastPaintFlagCache;
        let on = WL_FAST_PAINT_DEFAULT;
        try {
            const q = new URLSearchParams(svRoute.search()).get('wlfast');
            if (q === '1' || q === 'true') { on = true; localStorage.removeItem(WL_FAST_PAINT_KILL_KEY); }
            else if (q === '0' || q === 'false') { on = false; localStorage.setItem(WL_FAST_PAINT_KILL_KEY, '1'); }
            else { on = WL_FAST_PAINT_DEFAULT && (localStorage.getItem(WL_FAST_PAINT_KILL_KEY) !== '1'); }
        } catch { on = WL_FAST_PAINT_DEFAULT; }
        _wlFastPaintFlagCache = on;
        return on;
    }

    let _wlV2ClientObj = null, _wlV2ClientPromise = null;
    function _wlV2Client() {
        if (!_wlV2Ready()) return Promise.resolve(null);
        if (_wlV2ClientObj) return Promise.resolve(_wlV2ClientObj);
        if (_wlV2ClientPromise) return _wlV2ClientPromise;
        // Reuse the calendar's generic supabase-js UMD loader so the lib loads at most once.
        _wlV2ClientPromise = _calV2LoadLib().then(lib => {
            if (!lib || !lib.createClient) return null;
            _wlV2ClientObj = lib.createClient(CAL_SUPABASE_URL, CAL_SUPABASE_ANON_KEY, {
                auth: { persistSession: false, autoRefreshToken: false },
                realtime: { params: { eventsPerSecond: 5 } }
            });
            return _wlV2ClientObj;
        }).catch(e => { console.warn('[Workload v2] supabase-js init failed', e); _wlV2ClientPromise = null; return null; });
        return _wlV2ClientPromise;
    }

    // Map a snake_case workload_issues row to the camelCase issue shape the
    // board consumes (identical to what the linear-issues endpoint returns).
    function _wlV2MapRow(r) {
        return {
            id: r.id,
            identifier: r.identifier,
            title: r.title,
            url: r.url,
            isSubIssue: !!r.is_sub_issue,
            parentId: r.parent_id,
            parentIdentifier: r.parent_identifier,
            dueDate: r.due_date,
            createdAt: r.linear_created_at,
            updatedAt: r.linear_updated_at,
            syncedAt: r.synced_at,
            sortOrder: r.sort_order,
            status: r.status,
            statusType: r.status_type,
            teamKey: r.team_key,
            teamName: r.team_name,
            assigneeId: r.assignee_id,
            assigneeName: r.assignee_name,
            assigneeEmail: r.assignee_email,
            clientName: r.client_name,
        };
    }

    // Background refreshes compare only fields that can change what Workload
    // renders. Reconcile/audit timestamps are deliberately excluded: synced_at
    // advances on every sweep even when the issue itself is unchanged, while
    // createdAt/updatedAt are not displayed anywhere on this view.
    function wlRenderableIssueProjection(issues) {
        const source = Array.isArray(issues) ? issues : [];
        const subs = source.filter(issue => issue && issue.isSubIssue
            && wlIsActiveStatus(issue)
            && wlIssueClientAllowed(issue)
            && (!issue.assigneeId || wlIssueEditorAllowed(issue)));
        const parentIds = new Set(subs.map(issue => String(issue.parentId || '')).filter(Boolean));
        return subs.concat(source.filter(issue => issue && !issue.isSubIssue && parentIds.has(String(issue.id || ''))));
    }

    function wlIssueBusinessFingerprint(issues) {
        const rows = wlRenderableIssueProjection(issues).map(issue => [
            String(issue && issue.id || ''),
            String(issue && issue.identifier || ''),
            String(issue && issue.title || ''),
            String(issue && issue.url || ''),
            issue && issue.isSubIssue === true,
            String(issue && issue.parentId || ''),
            String(issue && issue.parentIdentifier || ''),
            issue && issue.dueDate ? String(issue.dueDate).slice(0, 10) : '',
            String(issue && issue.sortOrder != null ? issue.sortOrder : ''),
            String(issue && issue.status || ''),
            String(issue && issue.statusType || ''),
            String(issue && issue.teamKey || ''),
            String(issue && issue.teamName || ''),
            String(issue && issue.assigneeId || ''),
            String(issue && issue.assigneeName || ''),
            String(issue && issue.assigneeEmail || ''),
            wlCanonicalClient(issue && issue.clientName || '') || String(issue && issue.clientName || '')
        ]).sort((a, b) => a[0].localeCompare(b[0]));
        return JSON.stringify(rows);
    }

    function wlPlanBusinessFingerprint(plans, issues) {
        const issueIds = new Set(wlRenderableIssueProjection(issues)
            .filter(issue => issue && issue.isSubIssue)
            .map(issue => String(issue.id || '')));
        const entries = plans && typeof plans.entries === 'function' ? [...plans.entries()] : [];
        return JSON.stringify(entries
            .filter(([issueId]) => issueIds.has(String(issueId)))
            .map(([issueId, planDate]) => [String(issueId), String(planDate || '').slice(0, 10)])
            .sort((a, b) => a[0].localeCompare(b[0])));
    }

    function wlMetadataBusinessFingerprint(metadata, issues) {
        const issueIds = new Set(wlRenderableIssueProjection(issues)
            .filter(issue => issue && issue.isSubIssue)
            .map(issue => String(issue.id || '')));
        const entries = metadata && typeof metadata.entries === 'function' ? [...metadata.entries()] : [];
        return JSON.stringify(entries
            .filter(([issueId]) => issueIds.has(String(issueId)))
            .map(([issueId, value]) => [
                String(issueId),
                String(value && value.label || ''),
                Number(value && value.weight) || 0,
                String(value && value.color || '').toUpperCase()
            ])
            .sort((a, b) => a[0].localeCompare(b[0])));
    }

    function wlBackgroundBusinessFingerprint() {
        return [
            wlIssueBusinessFingerprint(wlState.issueSnapshot),
            wlPlanBusinessFingerprint(wlState.planByIssueId, wlState.issueSnapshot),
            wlMetadataBusinessFingerprint(wlState.workloadByIssueId, wlState.issueSnapshot)
        ].join('\n');
    }
    // Read every ACTIVE row. Supabase caps a single response at 1000 rows, so we
    // page with limit/offset until a short page — otherwise the board would
    // silently miss issues beyond the first 1000.
    const WL_V2_PAGE_ROWS = 1000;   // PostgREST's server-side max-rows cap
    function _wlV2IssuesHeaders(withCount) {
        const headers = { apikey: CAL_SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY, Accept: 'application/json' };
        // `count=exact` makes PostgREST put the total on Content-Range
        // ("0-999/2128"), which is what lets every later page go out at once.
        if (withCount) headers.Prefer = 'count=exact';
        return headers;
    }
    async function _wlV2ReadPage(resp) {
        if (!resp.ok) throw new Error('Supabase HTTP ' + resp.status);
        const rows = await resp.json();
        if (!Array.isArray(rows)) throw new Error('Supabase: unexpected payload');
        return rows;
    }
    /*
     * ONE ROUND TRIP OF LATENCY, NOT ONE PER PAGE.
     *
     * The mirror holds ~2,100 active rows and the server caps a page at
     * 1,000, so this read used to be three ~660 KB round trips one after
     * another (~0.65 s each from a datacenter, more from a laptop): the
     * single largest slice of the Workload cold boot, measured 2026-09-15.
     * Page 0 now asks for the exact count and every remaining page is
     * requested in parallel. When the URL booted straight into #workload,
     * the head script has page 0 in flight already (window.__wlEarlyIssues,
     * started before this 5 MB document finished parsing); it is adopted
     * once and cleared so a later refresh never re-reads a stale response.
     * The source is unchanged: this is still the board's read of
     * `workload_issues` (test/workload-native-view-contract.js pins it).
     */
    async function _wlV2FetchIssues() {
        const base = CAL_SUPABASE_URL + '/rest/v1/workload_issues?select=*&active=eq.true&order=id.asc&limit=' + WL_V2_PAGE_ROWS + '&offset=';
        let first = null;
        try {
            const early = window.__wlEarlyIssues;
            if (early && typeof early.then === 'function') {
                window.__wlEarlyIssues = null;
                first = await early;
            }
        } catch { first = null; }
        if (!first) first = await fetch(base + '0', { cache: 'no-store', headers: _wlV2IssuesHeaders(true) });
        let all = await _wlV2ReadPage(first);
        if (all.length >= WL_V2_PAGE_ROWS) {
            const range = String(first.headers.get('content-range') || '');
            const total = Number((range.split('/')[1] || '').trim());
            const cap = 50 * WL_V2_PAGE_ROWS;                 // hard cap 50k rows
            if (Number.isFinite(total) && total > all.length) {
                const offsets = [];
                for (let offset = WL_V2_PAGE_ROWS; offset < Math.min(total, cap); offset += WL_V2_PAGE_ROWS) offsets.push(offset);
                const pages = await Promise.all(offsets.map(offset =>
                    fetch(base + offset, { cache: 'no-store', headers: _wlV2IssuesHeaders(false) }).then(_wlV2ReadPage)));
                for (const rows of pages) all = all.concat(rows);
            } else {
                // No usable count header: the original serial walk, unchanged.
                for (let offset = WL_V2_PAGE_ROWS, guard = 1; guard < 50; guard++, offset += WL_V2_PAGE_ROWS) {
                    const rows = await _wlV2ReadPage(await fetch(base + offset, { cache: 'no-store', headers: _wlV2IssuesHeaders(false) }));
                    all = all.concat(rows);
                    if (rows.length < WL_V2_PAGE_ROWS) break;
                }
            }
        }
        return all.map(_wlV2MapRow);
    }

    /* ===================================================================
     * WORKLOAD NATIVE SOURCE — step 2 of docs/ops/WORKLOAD_NATIVE_SOURCE.md.
     *
     * `?wlnative=1` reads `workload_issues_native_v1` ALONGSIDE the Linear-derived
     * table and reports the difference. It does NOT change what the board renders,
     * and that restraint is the design rather than caution:
     *
     *   - The scope doc asks step 2 for "both sources readable side by side, so
     *     the diff is measured on real data instead of argued about", and step 3
     *     is reconciling that diff to zero. Measurement is the deliverable here.
     *   - A source SWAP cannot be done safely yet. `public.workload_plan` is
     *     keyed on the LINEAR issue uuid and `workload-plan`'s
     *     `requireWritableIssue()` validates every write against
     *     `workload_issues`. A deliverable that has never been mirrored has no
     *     Linear uuid at all, so swapping the read would put rows on the board
     *     whose plan day silently fails to save -- a drag that looks like it
     *     worked. That is scope §6.1's owner decision plus a key migration, not
     *     a flag.
     *
     * So this reads, compares, and prints. It never touches `wlState`, never
     * renders, and any failure is logged and dropped.
     * =================================================================== */
    const WL_NATIVE_VIEW = 'workload_issues_native_v1';
    // Deliberately NOT sticky, unlike ?wl2. A kill switch has to survive a
    // reload; a diagnostic that silently stayed on would keep spending two
    // reads per board load long after whoever typed it had forgotten.
    function _wlNativeDiffEnabled() {
        try {
            const q = new URLSearchParams(svRoute.search()).get('wlnative');
            return q === '1' || q === 'true';
        } catch { return false; }
    }

    async function _wlNativeFetchRows() {
        const base = CAL_SUPABASE_URL + '/rest/v1/' + WL_NATIVE_VIEW
            + '?select=*&active=eq.true&order=id.asc&limit=1000&offset=';
        const headers = { apikey: CAL_SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY, Accept: 'application/json' };
        let from = 0, all = [];
        for (let guard = 0; guard < 50; guard++) {        // same hard cap as the v2 read
            const resp = await fetch(base + from, { cache: 'no-store', headers });
            if (!resp.ok) throw new Error('Supabase HTTP ' + resp.status);
            const rows = await resp.json();
            if (!Array.isArray(rows)) throw new Error('Supabase: unexpected payload');
            all = all.concat(rows);
            if (rows.length < 1000) break;
            from += 1000;
        }
        return all;
    }

    /* Fields NOT compared, each because the two sources are supposed to differ
       there. Listed in the report itself so a zero diff is never read as "these
       are identical" when it means "these agree about what we checked".
         id / parent_id  -- the identity decision (scope §6.1) is still open, so
                            the native side answers both and neither is wrong.
         url             -- points at Linear on both sides today; scope §6.2.
         assignee_id     -- different namespaces: a Linear user id against a
                            team_members uuid. The board filters editors by NAME,
                            so this changes nothing that renders.
         parent_identifier -- a batch NAME natively, a Linear issue identifier
                            there. Search text, by design.
         linear_created_at / linear_updated_at / synced_at -- not displayed, and
                            the board's own comment excludes them from
                            renderable comparisons. */
    const WL_NATIVE_DIFF_EXCLUDED = Object.freeze([
        'id', 'parent_id', 'url', 'assignee_id', 'parent_identifier',
        'linear_created_at', 'linear_updated_at', 'synced_at', 'sort_order',
    ]);
    const WL_NATIVE_DIFF_FIELDS = Object.freeze([
        'title', 'status', 'status_type', 'team_key', 'team_name',
        'assignee_name', 'assignee_email', 'client_name', 'due_date',
    ]);
    const WL_NATIVE_DIFF_SAMPLE = 25;

    function _wlNativeCell(row, field) {
        const raw = row && row[field] != null ? String(row[field]) : '';
        // `status` is compared case- and space-insensitively on purpose: the
        // live Linear table holds 'For Client approval' AND 'For Client Approval'
        // AND 'Tweak Needed ' with a trailing space, and the board itself reads
        // it through wlNormStatus. A spelling difference is counted separately
        // rather than reported as drift, because it is the thing the native
        // source exists to end.
        if (field === 'status') return raw.trim().toLowerCase();
        if (field === 'due_date') return raw.slice(0, 10);
        return raw.trim();
    }

    /* Pure, so it can be executed by a test over fixtures rather than only read.
       Takes the two raw row sets and answers what differs. */
    function _wlNativeDiffReport(linearRows, nativeRows) {
        const linear = Array.isArray(linearRows) ? linearRows : [];
        const native = Array.isArray(nativeRows) ? nativeRows : [];
        const isSub = r => !!(r && (r.is_sub_issue === true || r.is_sub_issue === 'true'));

        const linearSubs = linear.filter(isSub);
        const nativeSubs = native.filter(isSub);

        /* Keyed on the LINEAR uuid, which is the only identifier both sides
           share today. A native row without one has never been mirrored and
           cannot be matched -- that is a finding, not a failure to compare. */
        const linearById = new Map();
        for (const row of linearSubs) {
            const key = row && row.id != null ? String(row.id) : '';
            if (key) linearById.set(key, row);
        }
        const neverMirrored = [];
        const nativeById = new Map();
        for (const row of nativeSubs) {
            const key = row && row.linear_id != null ? String(row.linear_id) : '';
            if (!key) { neverMirrored.push(String(row && row.identifier || row && row.id || '')); continue; }
            nativeById.set(key, row);
        }

        const nativeOnly = [], linearOnly = [], differing = [];
        let spellingOnly = 0;
        for (const [key, row] of nativeById) {
            if (!linearById.has(key)) nativeOnly.push(String(row.identifier || key));
        }
        for (const [key, row] of linearById) {
            if (!nativeById.has(key)) linearOnly.push(String(row.identifier || key));
        }
        for (const [key, nativeRow] of nativeById) {
            const linearRow = linearById.get(key);
            if (!linearRow) continue;
            if (String(linearRow.status || '') !== String(nativeRow.status || '')
                && _wlNativeCell(linearRow, 'status') === _wlNativeCell(nativeRow, 'status')) spellingOnly++;
            for (const field of WL_NATIVE_DIFF_FIELDS) {
                const a = _wlNativeCell(linearRow, field);
                const b = _wlNativeCell(nativeRow, field);
                if (a !== b) differing.push({ identifier: String(linearRow.identifier || key), field, linear: a, native: b });
            }
        }

        // Truncation is REPORTED, never silent: a capped list that looks
        // complete is how a diff gets called clean.
        const cap = (list) => ({ count: list.length, sample: list.slice(0, WL_NATIVE_DIFF_SAMPLE), truncated: Math.max(0, list.length - WL_NATIVE_DIFF_SAMPLE) });

        return {
            linear: { rows: linear.length, subIssues: linearSubs.length, parents: linear.length - linearSubs.length },
            native: { rows: native.length, subIssues: nativeSubs.length, parents: native.length - nativeSubs.length },
            // Expected to be non-empty: OPEN_REPAIRS item 95 measured 40 live
            // deliverables on active-roster clients whose Linear issues were
            // archived, so the board cannot see them. They are the acceptance
            // test for step 3, not an incident.
            nativeOnly: cap(nativeOnly),
            linearOnly: cap(linearOnly),
            neverMirrored: cap(neverMirrored),
            differing: cap(differing),
            statusSpellingOnly: spellingOnly,
            comparedFields: WL_NATIVE_DIFF_FIELDS.slice(),
            excludedFields: WL_NATIVE_DIFF_EXCLUDED.slice(),
        };
    }

    /* Reads both sources and prints the report. Exposed on `window` so it can
       be run by hand without the query flag. Never throws into a caller. */
    window.wlNativeDiff = async function wlNativeDiff() {
        if (!CAL_SUPABASE_URL || !CAL_SUPABASE_ANON_KEY) {
            console.warn('[workload native] no Supabase credentials in this browser');
            return null;
        }
        try {
            const base = CAL_SUPABASE_URL + '/rest/v1/workload_issues?select=*&active=eq.true&order=id.asc&limit=1000&offset=';
            const headers = { apikey: CAL_SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY, Accept: 'application/json' };
            let from = 0, linearRows = [];
            for (let guard = 0; guard < 50; guard++) {
                const resp = await fetch(base + from, { cache: 'no-store', headers });
                if (!resp.ok) throw new Error('workload_issues HTTP ' + resp.status);
                const rows = await resp.json();
                if (!Array.isArray(rows)) throw new Error('workload_issues: unexpected payload');
                linearRows = linearRows.concat(rows);
                if (rows.length < 1000) break;
                from += 1000;
            }
            const nativeRows = await _wlNativeFetchRows();
            const report = _wlNativeDiffReport(linearRows, nativeRows);
            console.log('[workload native] source diff', report);
            return report;
        } catch (e) {
            // A missing view is the expected answer until the migration is
            // applied, and it must read as that rather than as a broken board.
            const msg = String((e && e.message) || e);
            console.warn('[workload native] diff unavailable: ' + msg
                + (/404|PGRST205|Not Found/i.test(msg)
                    ? ' — apply migrations/2026-09-02-workload-native-view.sql first; the board is unaffected either way.'
                    : ''));
            return null;
        }
    };

    // Realtime: one global channel on the NATIVE tables the board now reads,
    // public.deliverables and public.batches. A change coalesces into one
    // debounced silent refetch. Background work never blanks the calendar.
    // Both tables are already `replica identity full`, already in the
    // `supabase_realtime` publication, and already anon-readable under a
    // `using (true)` policy (migrations/2026-07-06-b1-linear-data-model.sql
    // :674-680, :694-695, :725-746), so this adds no exposure and needs no
    // migration.
    //
    // The poll behind it is now a SAFETY NET, not the freshness mechanism.
    // _wlV2CheckWatermark no longer reads a one-row synced_at watermark — it
    // calls wlRefetchSilent() unconditionally, and each of those is a
    // workload-plan POST that reads the whole snapshot. At 60s that is a
    // full-population read every minute per open board against an 8s
    // WL_PLAN_READ_TIMEOUT_MS. With realtime carrying the updates, 5 minutes
    // is the catch-up interval for missed events (dropped socket, suspended
    // tab), not the update path.
    const WL_V2_WATERMARK_POLL_MS = 5 * 60 * 1000;
    let _wlV2Channel = null, _wlV2RtTimer = null, _wlV2SubscribedOnce = false;
    let _wlV2WatermarkTimer = null, _wlV2WatermarkBusy = false;
    function _wlV2OnRealtimeChange() {
        if (!document.querySelector('.workload-view')) return;
        if (_wlV2RtTimer) clearTimeout(_wlV2RtTimer);
        _wlV2RtTimer = setTimeout(() => {
            _wlV2RtTimer = null;
            if (!document.querySelector('.workload-view')) return;
            _wlV2CheckWatermark();
        }, WL_V2_RT_DEBOUNCE_MS);
    }
    async function _wlV2EnsureSubscribed() {
        if (!WL_V2_REALTIME) return;            // one-line rollback lever (see note above)
        if (_wlPlanLive && _wlV2Ready()) _wlPlanLive.ensure();
        if (!_wlV2Ready() || _wlV2Channel) return;
        const client = await _wlV2Client();
        if (!client || !document.querySelector('.workload-view')) return; // left during lib load
        try {
            _wlV2Channel = client
                .channel('workload_native')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'deliverables' }, () => _wlV2OnRealtimeChange())
                .on('postgres_changes', { event: '*', schema: 'public', table: 'batches' }, () => _wlV2OnRealtimeChange())
                .subscribe((status) => {
                    if (status === 'SUBSCRIBED') {
                        // A re-subscribe means the socket dropped (suspended tab woke up);
                        // realtime doesn't replay missed events, so pull a catch-up snapshot.
                        // Skip the FIRST subscribe — the load that opened the channel is current.
                        if (_wlV2SubscribedOnce) _wlV2OnRealtimeChange();
                        _wlV2SubscribedOnce = true;
                    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                        console.warn('[Workload v2] realtime status:', status);
                    }
                });
        } catch (e) {
            console.warn('[Workload v2] realtime subscribe failed', e);
            _wlV2Channel = null;
        }
    }
    async function _wlV2FetchLatestWatermark() {
        if (!_wlV2Ready()) return '';
        const url = CAL_SUPABASE_URL + '/rest/v1/workload_issues?select=synced_at&active=eq.true&order=synced_at.desc&limit=1';
        const resp = await fetch(url, {
            cache: 'no-store',
            headers: {
                apikey: CAL_SUPABASE_ANON_KEY,
                Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY,
                Accept: 'application/json'
            }
        });
        if (!resp.ok) throw new Error('Workload watermark HTTP ' + resp.status);
        const rows = await resp.json();
        return String(Array.isArray(rows) && rows[0] && rows[0].synced_at || '');
    }
    async function _wlV2CheckWatermark() {
        if (_wlV2WatermarkBusy || document.hidden || !document.querySelector('.workload-view')) return;
        if (wlState.loading || wlState.refreshing || _wlPlanWriteInFlight.size || _wlDueWriteInFlight.size) return;
        _wlV2WatermarkBusy = true;
        try { await wlRefetchSilent(); }
        finally { _wlV2WatermarkBusy = false; }
    }
    async function _wlLegacyCheckWatermark() {
        if (_wlV2WatermarkBusy || document.hidden || !document.querySelector('.workload-view')) return;
        if (wlState.loading || wlState.refreshing || wlState.planStatus === 'loading' || wlState.planStatus === 'refreshing') return;
        _wlV2WatermarkBusy = true;
        try {
            const latest = await _wlV2FetchLatestWatermark();
            if (!latest) {
                wlClearBackgroundRefreshFailure();
                return;
            }
            if (!wlState.sourceSyncedAt) {
                wlState.sourceSyncedAt = latest;
                wlClearBackgroundRefreshFailure();
                return;
            }
            if (Date.parse(latest) > Date.parse(wlState.sourceSyncedAt)) {
                const refreshed = await wlRefetchSilent();
                if (refreshed === true && (!wlState.sourceSyncedAt || Date.parse(latest) > Date.parse(wlState.sourceSyncedAt))) {
                    wlState.sourceSyncedAt = latest;
                }
            } else {
                wlClearBackgroundRefreshFailure();
            }
        } catch (error) {
            console.warn('[Workload v2] watermark poll failed', error);
            wlMarkBackgroundRefreshFailure(error);
        } finally {
            _wlV2WatermarkBusy = false;
        }
    }
    function _wlV2EnsureWatermarkPoll() {
        if (!_wlV2Ready() || _wlV2WatermarkTimer) return;
        _wlV2WatermarkTimer = setInterval(_wlV2CheckWatermark, WL_V2_WATERMARK_POLL_MS);
    }
    function _wlV2Teardown() {
        if (_wlV2RtTimer) { clearTimeout(_wlV2RtTimer); _wlV2RtTimer = null; }
        if (_wlV2WatermarkTimer) { clearInterval(_wlV2WatermarkTimer); _wlV2WatermarkTimer = null; }
        _wlV2WatermarkBusy = false;
        if (_wlV2Channel) {
            try {
                if (_wlV2ClientObj && typeof _wlV2ClientObj.removeChannel === 'function') _wlV2ClientObj.removeChannel(_wlV2Channel);
                else if (typeof _wlV2Channel.unsubscribe === 'function') _wlV2Channel.unsubscribe();
            } catch {}
        }
        _wlV2Channel = null; _wlV2SubscribedOnce = false;
        if (_wlPlanLive) _wlPlanLive.teardown();
    }

    /* Plan-day changes reach other open Workload pages in about a second.
       `workload_plan` is private (not in the realtime publication, no anon or
       authenticated grants) and must stay that way, so this does NOT stream
       rows. After a confirmed save, the writer sends a Supabase Realtime
       BROADCAST carrying only an opaque hint ({kind, at, from}) — no issue id,
       client, card title or date. Every open board listens and, on a hint that
       is not its own echo, re-reads through the existing authorized path
       (_wlV2CheckWatermark -> wlRefetchSilent -> workload-plan), coalesced.
       Same-browser tabs also get a `storage` hint, since a tab's own broadcast
       may not loop back to its siblings. The 5-minute poll stays as the net.
       Pure factory so test/workload-plan-live.js can drive it with mocks. */
    function wlCreatePlanLive(opts) {
        const o = opts || {};
        const debounceMs = o.debounceMs == null ? 600 : o.debounceMs;
        const sendCoalesceMs = o.sendCoalesceMs == null ? 250 : o.sendCoalesceMs;
        const storageKey = o.storageKey || 'syncview.workload.plan-live.v1';
        const from = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
        const st = { channelStatus: 'idle', subscribedOnce: false, lastError: '', sent: 0, sendFailed: 0,
            received: 0, echoesIgnored: 0, refreshes: 0, catchUps: 0, lastReceivedAt: '',
            rejected: 0, throttled: 0, busyGaveUp: 0 };
        let channel = null, client = null, recvTimer = null, sendTimer = null, opening = null;
        // Broadcast is a PUBLIC channel: anyone with the publishable key can send
        // to it. So broadcast-triggered re-reads are strictly validated and
        // rate-limited to one per minRemoteIntervalMs per page; a hint inside the
        // window schedules exactly one re-read at the window's end. The storage
        // signal cannot come from outside this browser and is not throttled.
        const minRemoteIntervalMs = o.minRemoteIntervalMs == null ? 10000 : o.minRemoteIntervalMs;
        const busyRetryMs = o.busyRetryMs == null ? 2000 : o.busyRetryMs;
        const busyRetryMax = o.busyRetryMax == null ? 30 : o.busyRetryMax;
        const clock = typeof o.now === 'function' ? o.now : () => Date.now();
        let lastRemoteRunAt = -Infinity, dirty = false, busyTries = 0;
        function runRefresh() {
            recvTimer = null;
            // Busy (loading, manual refresh, own write): the existing check would
            // return early and forget the hint. Keep it dirty and retry, bounded.
            if (o.canRun && !o.canRun()) {
                dirty = true;
                if (busyTries++ < busyRetryMax) recvTimer = setTimeout(runRefresh, busyRetryMs);
                else { dirty = false; busyTries = 0; st.busyGaveUp++; }
                return;
            }
            dirty = false; busyTries = 0;
            st.refreshes++;
            try { const p = o.onRemote && o.onRemote(); if (p && p.catch) p.catch(() => {}); } catch {}
        }
        function scheduleRefresh(throttled) {
            let delay = debounceMs;
            if (throttled) {
                const now = clock();
                const earliest = lastRemoteRunAt + minRemoteIntervalMs;
                if (now < earliest) {
                    st.throttled++;
                    if (recvTimer) return;           // one pending re-read already covers it
                    delay = Math.max(debounceMs, earliest - now);
                }
                lastRemoteRunAt = Math.max(now + delay, lastRemoteRunAt);
            }
            if (recvTimer) clearTimeout(recvTimer);
            busyTries = 0;
            recvTimer = setTimeout(runRefresh, delay);
        }
        function validHint(hint) {
            if (!hint || typeof hint !== 'object' || Array.isArray(hint)) return false;
            const keys = Object.keys(hint);
            if (keys.length !== 3 || keys.some(k => k !== 'kind' && k !== 'at' && k !== 'from')) return false;
            if (hint.kind !== 'plan') return false;
            if (typeof hint.at !== 'string' || hint.at.length > 40 || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(hint.at)) return false;
            if (typeof hint.from !== 'string' || !/^[a-z0-9]{8,40}$/.test(hint.from)) return false;
            return true;
        }
        function receive(msg, viaStorage) {
            const hint = viaStorage ? msg : (msg && typeof msg === 'object' ? msg.payload : null);
            if (!validHint(hint)) { st.rejected++; return false; }
            if (hint.from === from) { st.echoesIgnored++; return false; }
            st.received++;
            st.lastReceivedAt = new Date().toISOString();
            scheduleRefresh(!viaStorage);
            return true;
        }
        function onStorage(event) {
            if (!event || event.key !== storageKey || !event.newValue) return false;
            let hint = null;
            try { hint = JSON.parse(event.newValue); } catch { return false; }
            return receive(hint, true);
        }
        function flush() {
            sendTimer = null;
            const hint = { kind: 'plan', at: new Date().toISOString(), from };
            try {
                if (o.storage) { o.storage.setItem(storageKey, JSON.stringify(hint)); o.storage.removeItem(storageKey); }
            } catch {}
            if (!channel || st.channelStatus !== 'SUBSCRIBED') { st.sendFailed++; return; }
            try {
                const r = channel.send({ type: 'broadcast', event: 'plan', payload: hint });
                st.sent++;
                if (r && typeof r.then === 'function') {
                    r.then(res => { if (res && res !== 'ok') { st.sent--; st.sendFailed++; } }, () => { st.sent--; st.sendFailed++; });
                }
            } catch { st.sendFailed++; }
        }
        // Call ONLY after the server confirmed the save.
        function announce() {
            if (sendTimer) return;
            sendTimer = setTimeout(flush, sendCoalesceMs);
        }
        async function ensure() {
            if (channel || opening) return opening;
            opening = (async () => {
                const c = o.getClient ? await o.getClient() : null;
                if (!c || typeof c.channel !== 'function' || channel) return;
                if (o.isActive && !o.isActive()) return;
                client = c;
                st.channelStatus = 'CONNECTING';
                try {
                    channel = c.channel(o.channelName || 'workload-plan', { config: { broadcast: { self: false, ack: false } } })
                        .on('broadcast', { event: 'plan' }, msg => receive(msg, false))
                        .subscribe((status, err) => {
                            st.channelStatus = String(status || '');
                            if (status === 'SUBSCRIBED') {
                                st.lastError = '';
                                // Broadcast does not replay; a re-subscribe after a drop
                                // re-reads once to catch whatever was missed.
                                if (st.subscribedOnce) { st.catchUps++; scheduleRefresh(false); }
                                st.subscribedOnce = true;
                            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                                st.lastError = String(status) + (err && err.message ? ': ' + err.message : '');
                            }
                        });
                } catch (e) {
                    st.channelStatus = 'CHANNEL_ERROR';
                    st.lastError = String(e && e.message || e);
                    channel = null;
                }
            })().finally(() => { opening = null; });
            return opening;
        }
        function teardown() {
            if (recvTimer) { clearTimeout(recvTimer); recvTimer = null; }
            // A confirmed save still inside the coalesce window is sent now
            // (storage signal always; broadcast if the channel is still up).
            if (sendTimer) { clearTimeout(sendTimer); flush(); }
            dirty = false; busyTries = 0;
            if (channel) {
                try {
                    if (client && typeof client.removeChannel === 'function') client.removeChannel(channel);
                    else if (typeof channel.unsubscribe === 'function') channel.unsubscribe();
                } catch {}
            }
            channel = null; client = null;
            st.channelStatus = 'idle'; st.subscribedOnce = false;
        }
        function status() { return Object.assign({ subscribed: st.channelStatus === 'SUBSCRIBED', pendingReread: dirty || !!recvTimer }, st); }
        return { announce, ensure, teardown, status, onStorage, receive };
    }
    const _wlPlanLive = (typeof window !== 'undefined') ? wlCreatePlanLive({
        getClient: () => _wlV2Client(),
        isActive: () => !!document.querySelector('.workload-view'),
        onRemote: () => _wlV2CheckWatermark(),
        // Mirrors the early returns in _wlV2CheckWatermark, so a hint is kept
        // (and retried) instead of silently dropped while the page is busy.
        canRun: () => !_wlV2WatermarkBusy && !document.hidden && !!document.querySelector('.workload-view')
            && !wlState.loading && !wlState.refreshing && !_wlPlanWriteInFlight.size && !_wlDueWriteInFlight.size,
        storage: (() => { try { return window.localStorage; } catch { return null; } })()
    }) : null;
    if (typeof window !== 'undefined' && _wlPlanLive && !window.__wlPlanLiveWired) {
        window.__wlPlanLiveWired = true;
        window.addEventListener('storage', e => { if (document.querySelector('.workload-view')) _wlPlanLive.onStorage(e); });
    }
    function wlAnnouncePlanSaved() { try { if (_wlPlanLive) _wlPlanLive.announce(); } catch {} }
    window.wlPlanLiveStatus = function () { return _wlPlanLive ? _wlPlanLive.status() : null; };
    window.wlV2Status = function () { return { flag: _wlV2Enabled(), ready: _wlV2Ready(), subscribed: !!_wlV2Channel, polling: !!_wlV2WatermarkTimer, sourceSyncedAt: wlState.sourceSyncedAt, planLive: _wlPlanLive ? _wlPlanLive.status() : null }; };

    function wlIssueClientAllowed(issue) {
        return issue && issue.workloadSource === 'native'
            ? issue.nativeClientActive === true : wlIsAllowedClient(issue && issue.clientName);
    }
    function wlIssueEditorAllowed(issue) {
        // Both native rows and explicit rollback/provider rows carry membership
        // from the authenticated snapshot. Missing membership never revives a
        // cached or cross-role assignee by display name.
        if (!issue) return false;
        if (typeof issue.nativeAssigneeEligible === 'boolean') return issue.nativeAssigneeEligible;
        return wlIsAllowedEditor(issue.assigneeName, issue.teamKey, issue.teamName);
    }
    function wlSnapshotIdentity() {
        const value = _syncviewStaffIdentityForHeaders();
        return value ? JSON.stringify([value.key, value.role, value.member && value.member.id]) : '';
    }
    /* The exact columns `_prodDeliverableLive` reads; the note explaining why this
       read exists at all lives inside `_wlFetchArchiveMarkerRows` below, so that
       test/deliverable-counts-exclude-parents.js attributes every mention of the
       view to the function that actually queries it. */
    const WL_ARCHIVE_MARKER_SELECT = 'id,status,raw_issue_archived_at,raw_issue_canceled_at,raw_webhook_delete,raw_deleted,raw_delete,raw_removed,raw_archived';
    async function _wlFetchArchiveMarkerRows(ids) {
        /* OPEN_REPAIRS 95 / 224 / 229 / docs/ops/WORKLOAD_NATIVE_SOURCE.md:
           workload_native_snapshot_v1() excludes a row only when its BATCH is archived
           (workload_issues_native_v1.active). It carries no per-issue Linear
           archive/delete state at all, so a deliverable whose own Linear issue was
           archived -- while its batch stays active -- reaches this board as live work,
           exactly as Production's mirror was refusing it. Production already has the
           rule (`_prodDeliverableLive`, src/index/210-production-state-writes.js.part)
           reading the same markers `production_deliverables_browser_v1` already projects
           and already grants `anon`/`authenticated` select on -- so this is a second,
           independent browser-side read of that same public view, filtered server-side
           to rows carrying any archive/delete marker. No new SQL, no Edge Function change.
           `_prodDeliverableLive` is called directly rather than reimplemented: every
           file from 040 through 340 shares one top-level <script>
           (src/index/manifest.txt), so it is hoisted and callable here even though 210
           concatenates after 070. Registered in
           test/deliverable-counts-exclude-parents.js as EXEMPT: callers pass only
           is_sub_issue rows, so a batch parent never reaches it. */
        const wanted = [...new Set((ids || []).map(id => String(id || '').trim()).filter(Boolean))];
        if (!wanted.length || !CAL_SUPABASE_URL || !CAL_SUPABASE_ANON_KEY) return [];
        const pageSize = 1000;
        /* A RUNAWAY GUARD, NOT A ROW BUDGET, and the difference is the whole
           point of this constant (Codex review, PR 1491 -- PR numbers are
           written here without a leading hash because a four-digit one reads
           as a hex colour to test/no-hardcoded-colors.js, which skips only
           lines whose trimmed text opens with a comment marker, and this
           file's block comments do not prefix their continuation lines).
           The former cap of 5
           pages would have returned the first 5,000 id-ordered markers AS IF
           THE READ WERE COMPLETE once the marker set outgrew it -- and a
           marker this read never saw is an archived card the board then shows
           as live work, which is precisely the defect item 229 exists to fix,
           reintroduced silently and only past a threshold nobody would be
           watching. So exhausting these pages with a FULL page throws instead:
           _wlArchivedNativeIds's catch leaves the board unfiltered and warns,
           which is the honest, already-documented failure rather than a
           partial answer wearing a complete one's clothes.
           The cap costs no latency of its own -- the AbortController below
           bounds the entire read at WL_PLAN_READ_TIMEOUT_MS no matter how many
           pages it spans. Today the whole marker set is 278 rows of 6,688, so
           page two has never been fetched at all. */
        const maxPages = 25;
        const url = CAL_SUPABASE_URL + '/rest/v1/production_deliverables_browser_v1?select='
            + encodeURIComponent(WL_ARCHIVE_MARKER_SELECT)
            + '&or=(status.eq.archived,raw_issue_archived_at.not.is.null,raw_webhook_delete.is.true,raw_deleted.is.true,raw_delete.is.true,raw_removed.is.true,raw_archived.is.true)'
            + '&order=id.asc';
        /* One small marker-only read replaces the former id=in.(...) burst. Keep
           it bounded so an overloaded/half-open connection still reaches the
           caller's fail-open catch instead of delaying a cold Workload load.

           PAGING IS THE `Range` HEADER ALONE -- NEVER `Range` PLUS `&limit=`.
           Measured live against this view on 2026-09-22: with `limit=1000` also
           in the URL, page one (`Range: 0-999`) answers normally and page two
           (`Range: 1000-1999`) answers
           `PGRST103 "Requested range not satisfiable"`, which the !response.ok
           throw below turns into a whole-board fail-open. Range alone pages
           correctly, answers `content-range: 0-277/*` for today's 278 marker
           rows, and returns `200 []` past the end, so the loop terminates on
           the short-page break either way. The bug is invisible while the
           marker set fits one page, which is exactly why it is pinned in
           test/workload-archived-hidden.js. */
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), WL_PLAN_READ_TIMEOUT_MS);
        const out = [];
        try {
            let complete = false;
            for (let page = 0; page < maxPages; page++) {
                const headers = { ..._prodHeaders(), Range: (page * pageSize) + '-' + (((page + 1) * pageSize) - 1) };
                const response = await fetch(url, { cache: 'no-store', headers, signal: controller.signal });
                if (!response.ok) throw new Error('archive-marker read failed: HTTP ' + response.status);
                const rows = await response.json();
                if (!Array.isArray(rows)) throw new Error('archive-marker read returned an unexpected shape');
                out.push(...rows);
                // A SHORT PAGE IS THE ONLY PROOF THE ANSWER IS WHOLE.
                if (rows.length < pageSize) { complete = true; break; }
            }
            if (!complete) throw new Error('archive-marker read still had rows after ' + maxPages + ' pages');
            return out;
        } finally {
            clearTimeout(timer);
        }
    }
    /* Native sub-issue ids whose own Linear issue is archived/deleted, exactly as
       Production's _prodDeliverableLive refuses them -- independent of the row's
       BATCH also being archived (workload_issues_native_v1's own `active` gate,
       which this does not replace or duplicate). A read failure never blanks or
       shrinks the board: it leaves every row exactly as unfiltered as it was before
       this check existed, because this guard can only ever HIDE a row, never show
       one that should stay hidden -- the permissive default AGENTS.md asks for
       whenever a guard could go either way. */
    async function _wlArchivedNativeIds(rows) {
        const ids = (rows || [])
            .filter(r => r && r.source === 'native' && r.is_sub_issue === true && typeof r.id === 'string' && r.id)
            .map(r => r.id);
        if (!ids.length) return new Set();
        try {
            const markerRows = await _wlFetchArchiveMarkerRows(ids);
            const wantedIds = new Set(ids);
            const archived = new Set();
            markerRows.forEach(row => {
                const id = String(row && row.id || '').trim();
                if (wantedIds.has(id) && !_prodDeliverableLive(row)) archived.add(id);
            });
            return archived;
        } catch (e) {
            console.warn('[Workload] archive-state check failed; leaving rows as read', e);
            return new Set();
        }
    }
    /* The fresh-board read the <head> boot script starts IN PARALLEL with
       key-verify when the page opens on #workload (2026-09-25: it used to wait
       0.45-0.85 s for the check to answer before it even started). Called only
       after _syncviewRequireStaffIdentity has passed, and taken at most once.
       It is used only when it was sent for the exact key, member, actor name
       and role this page is now verified as, within the last minute; anything
       else -- including a failed or rejected request -- returns null, and the
       caller makes its normal read. Nothing from it is shown before the check
       passes, because nothing reads it before then. */
    async function _wlTakeEarlySnapshot() {
        let early = null;
        try { early = window.__svEarlyWlSnapshot; window.__svEarlyWlSnapshot = null; } catch (e) {}
        if (!early || !early.response) return null;
        const identity = typeof _syncviewStaffIdentityForHeaders === 'function' ? _syncviewStaffIdentityForHeaders() : null;
        if (!identity || !identity.member) return null;
        if (early.key !== String(identity.key || '') || early.memberId !== String(identity.member.id || '')
            || early.actor !== String(identity.member.name || '') || early.role !== String(identity.role || '')) return null;
        if (!(Date.now() - early.at < 60000)) return null;
        try {
            const response = await early.response;
            // Only a genuine answer is reused; a refusal or a server error is
            // re-asked through the normal read, with its normal handling.
            return response && response.ok ? response : null;
        } catch (e) { return null; }
    }
    async function wlFetchNativeSnapshot() {
        await _syncviewRequireStaffIdentity('workload-plan-read');
        const owner = wlSnapshotIdentity(), session = _wlPlanSessionGeneration;
        const readGeneration = _wlPlanWriteGeneration;
        if (!owner) throw new Error('Staff sign-in is required to load Workload.');
        const controller = new AbortController();
        // The snapshot leg gets its own, longer budget -- see
        // WL_SNAPSHOT_READ_TIMEOUT_MS for the measurement that forced it.
        const timer = setTimeout(() => controller.abort(), WL_SNAPSHOT_READ_TIMEOUT_MS);
        try {
            /* CACHED v2 FIRST (migrations/2026-09-23-workload-native-snapshot-cache.sql).
               The server serves a prebuilt copy and answers `unchanged` with no
               body when this page already holds its version. 400 (Edge Function
               not yet deployed) or 501 (migration not yet applied) falls back to
               the v1 action for the rest of this page; anything else, including
               401/403, is answered exactly as before. */
            const memo = wlState.snapshotMemo && wlState.snapshotMemo.owner === owner ? wlState.snapshotMemo : null;
            const post = body => fetch(WORKLOAD_PLAN_URL, {
                method: 'POST', cache: 'no-store', signal: controller.signal,
                headers: _syncviewEfHeaders({ 'Content-Type': 'application/json' }, WORKLOAD_PLAN_URL),
                body: JSON.stringify(body)
            });
            let response = null;
            if (!wlState.snapshotV2Unavailable && !memo) response = await _wlTakeEarlySnapshot();
            if (!response && !wlState.snapshotV2Unavailable) {
                response = await post({ action: 'native_snapshot_v2', if_version: memo ? memo.version : '' });
                if (response.status === 400 || response.status === 501) {
                    wlState.snapshotV2Unavailable = true;
                    response = null;
                }
            }
            if (!response) response = await post({ action: 'native_snapshot' });
            let value = await response.json(), nextMemo = null;
            if (response.ok && value && value.unchanged === true) {
                // Only the version this page sent can come back unchanged.
                if (!memo || value.version !== memo.version) {
                    throw new Error('Workload could not load a complete snapshot. Please retry.');
                }
                value = memo.value;
            } else if (response.ok && value && value.contract === 'workload-native-snapshot-v2') {
                if (typeof value.version !== 'string' || !value.version
                    || !value.parents || typeof value.parents !== 'object' || !Array.isArray(value.rows)) {
                    throw new Error('Workload could not load a complete snapshot. Please retry.');
                }
                // parent_identifier travels once per parent; put it back on
                // each row so every reader downstream sees the v1 shape.
                for (const slimRow of value.rows) {
                    if (slimRow && slimRow.parent_id != null && !('parent_identifier' in slimRow)
                        && Object.prototype.hasOwnProperty.call(value.parents, slimRow.parent_id)) {
                        slimRow.parent_identifier = value.parents[slimRow.parent_id];
                    }
                }
                nextMemo = { owner, version: value.version, value };
            }
            if (!response.ok || !value || value.ok !== true || value.complete !== true
                || !['workload-native-snapshot-v1', 'workload-native-snapshot-v2'].includes(value.contract)
                || !Array.isArray(value.rows) || !Array.isArray(value.plans)
                || value.count !== value.rows.length || !Number.isSafeInteger(value.count)
                || !Array.isArray(value.legacy_teams)
                || (value.roster != null && !Array.isArray(value.roster))) {
                const error = new Error('Workload could not load a complete snapshot. Please retry.');
                error.status = response.status;
                throw error;
            }
            const authority = wlProductionAuthorityValue(value.authority);
            if (!authority) throw new Error('Workload authority is unavailable.');
            const roster = Array.isArray(value.roster) ? value.roster : [];
            const rosterComplete = Array.isArray(value.roster);
            const rosterIds = new Set();
            for (const member of roster) {
                if (!member || typeof member.id !== 'string' || !member.id.trim()
                    || rosterIds.has(member.id) || typeof member.native_id !== 'string' || !member.native_id.trim()
                    || typeof member.name !== 'string' || !member.name.trim()
                    || !['video','graphics'].includes(member.team)) {
                    throw new Error('Workload editor roster is incomplete.');
                }
                rosterIds.add(member.id);
            }
            const fingerprint = wlProductionAuthorityFingerprint(authority);
            // Excluded entirely, before any bucketing -- never folded into the
            // "no assignee and no work day or deadline" strip or its footer
            // count (OPEN_REPAIRS 87 / test/workload-excluded-reported.js).
            // That strip is for rows the board admits and cannot place; an
            // archived-in-Linear row is not admitted at all.
            const archivedNativeIds = await _wlArchivedNativeIds(value.rows);
            const rows = archivedNativeIds.size
                ? value.rows.filter(row => !(row && row.source === 'native' && row.is_sub_issue === true
                    && archivedNativeIds.has(row.id)))
                : value.rows;
            const seen = new Set(), metadata = [], issues = [], unprovableNativeIds = [];
            for (const row of rows) {
                if (!row || typeof row.id !== 'string' || !row.id || seen.has(row.id)
                    || !['native','legacy'].includes(row.source) || typeof row.is_sub_issue !== 'boolean') {
                    throw new Error('Workload row identities are incomplete.');
                }
                seen.add(row.id);
                const issue = { ..._wlV2MapRow(row), workloadSource: row.source,
                    linearId: row.source === 'native' ? row.linear_id : row.id,
                    nativeClientActive: row.native_client_active,
                    clientSlug: typeof row.client_slug === 'string' ? row.client_slug : '',
                    nativeAssigneeEligible: row.native_assignee_eligible,
                    // A legacy row the gateway could bind to a native
                    // deliverable (`native_plan_id` -- the same client-matched
                    // id `workload_native_plan_target_v1` resolves, already
                    // validated by projectNativeSnapshot in workload-plan).
                    // Kept apart from `nativeId`, which every OTHER
                    // `workloadSource === 'native'` gate still reads unchanged
                    // (wlParentUrl, the due/label routes): only the tweak-
                    // feedback popover reads this one, per plan item 3 in
                    // LINEAR_EXIT_STEP26_NATIVE_WORKLOAD.md.
                    legacyBoundNativeId: row.source === 'legacy' && typeof row.native_plan_id === 'string' && row.native_plan_id
                        ? row.native_plan_id : '' };
                if (row.source === 'native') {
                    if (row.is_sub_issue && (typeof row.native_client_active !== 'boolean'
                        || typeof row.native_assignee_eligible !== 'boolean'
                        || !['VID','GRA'].includes(row.team_key)
                        || (rosterComplete && row.native_assignee_eligible && !rosterIds.has(row.assignee_id)))) {
                        throw new Error('Native Workload membership is incomplete.');
                    }
                    issue.nativeId = row.is_sub_issue ? row.id : '';
                    issue.url = '';
                    if (row.is_sub_issue && wlIsActiveStatus(issue) && wlIssueClientAllowed(issue)) {
                        const projected = wlNativeMetadataRow(row.id, row.native_metadata);
                        const team = wlMetadataTeamBucket(row.team_key, row.team_name);
                        if (!team || authority[team] !== 'syncview') {
                            // The snapshot selected this row as native for a
                            // syncview team; disagreeing about that is a
                            // contract break, not a data shape, so it still
                            // fails the whole read.
                            throw new Error('Native Workload deadlines or weights are incomplete.');
                        }
                        if (!projected) {
                            // ONE row whose deadline/weight cannot be proven is
                            // withheld, exactly as the metadata reader already
                            // withholds one — it is never allowed to blank the
                            // board for everyone. This is the release gate: the
                            // first deliverable created after the outbound flip
                            // carries no provider label relation at all, so a
                            // whole-snapshot throw here is an estate-wide outage
                            // on a routine create.
                            unprovableNativeIds.push(row.id);
                        } else {
                            metadata.push({ ...projected, due_authority: 'syncview',
                                due_authority_team: team, due_authority_fingerprint: fingerprint });
                        }
                    }
                }
                issues.push(issue);
            }
            const planIds = new Set();
            for (const plan of value.plans) {
                if (!plan || typeof plan.issue_id !== 'string' || !plan.issue_id || planIds.has(plan.issue_id)
                    || (plan.plan_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(plan.plan_date))) {
                    throw new Error('Saved work days are incomplete.');
                }
                planIds.add(plan.issue_id);
            }
            // Provider-authority teams remain explicit compatibility work; they
            // never substitute for a failed native snapshot or native metadata.
            const foreign = issues.filter(issue => issue.workloadSource === 'legacy'
                && issue.isSubIssue && wlIsActiveStatus(issue)
                && wlMetadataTeamBucket(issue.teamKey, issue.teamName));
            if (foreign.length) {
                // Keep the snapshot's explicit provider authority. A second
                // flag read could mix native weights with an older provider
                // population during a team transition.
                //
                // A legacy row the gateway could bind to a native deliverable
                // (`legacyBoundNativeId`) reads its due/label metadata from
                // the native projection instead of the retained provider
                // route: the bound deliverable's own linear_issue_uuid equals
                // this row's Linear id (the join workload_native_snapshot_v1
                // already makes), so wlFetchNativeMetadata finds it directly
                // and the browser never calls workload-linear for it. Its
                // WRITE authority stays 'linear' below, unchanged: the team is
                // still Linear-authoritative, and production-write refuses a
                // due write for a Linear-authoritative team regardless of a
                // per-row binding (LINEAR_EXIT_STEP26_NATIVE_WORKLOAD.md,
                // "what needs code" item 4 -- see the PR's "next slice"). Only
                // the READ moves; the write route does not.
                const boundForeign = foreign.filter(issue => issue.legacyBoundNativeId);
                const unboundForeign = foreign.filter(issue => !issue.legacyBoundNativeId);
                const [boundRows, unboundRows] = await Promise.all([
                    wlFetchNativeMetadata(boundForeign.map(issue => issue.id)),
                    wlFetchForeignLinearMetadata(unboundForeign.map(issue => issue.id))
                ]);
                const oldRows = [...boundRows, ...unboundRows];
                const byId = new Map(oldRows.map(row => [row.issue_id, row]));
                if (oldRows.length !== foreign.length || byId.size !== foreign.length) {
                    throw new Error('Legacy Workload metadata is incomplete.');
                }
                for (const issue of foreign) {
                    const row = byId.get(issue.id), team = wlMetadataTeamBucket(issue.teamKey, issue.teamName);
                    if (!row || authority[team] !== 'linear') throw new Error('Legacy Workload metadata is incomplete.');
                    row.due_authority = 'linear'; row.due_authority_team = team;
                    row.due_authority_fingerprint = fingerprint;
                }
                metadata.push(...oldRows);
                if (oldRows.partialFailure) metadata.partialFailure = oldRows.partialFailure;
            }
            if (unprovableNativeIds.length) {
                // Same shape wlFetchLinearMetadata publishes, so wlAdoptLinearMetadata
                // blanks exactly these due dates, withholds their weights, marks the
                // metadata stale and shows the withheld-only banner. partitionFailed
                // is false: the read succeeded and every other row is fully editable.
                const prior = metadata.partialFailure;
                metadata.partialFailure = {
                    message: 'Some Workload due metadata is temporarily unavailable.',
                    partitionFailed: !!(prior && prior.partitionFailed),
                    issueIds: [...new Set([...((prior && prior.issueIds) || []), ...unprovableNativeIds])],
                    nativeIssueIds: [...new Set([...((prior && prior.nativeIssueIds) || []), ...unprovableNativeIds])]
                };
            }
            if (session !== _wlPlanSessionGeneration || owner !== wlSnapshotIdentity()) {
                throw new Error('Staff session changed while Workload was loading.');
            }
            // Remembered only once the whole answer validated, so a refused
            // copy can never come back as "unchanged".
            if (nextMemo) wlState.snapshotMemo = nextMemo;
            return { issues, metadata, plans: { rows: value.plans, readGeneration },
                roster: roster.map(member => ({ ...member })), rosterComplete,
                fetchedAt: Date.now(), fromCache: false, legacyTeams: value.legacy_teams,
                // A dropped plan is a work day somebody DRAGGED and can no longer
                // see; the card silently reverts to automatic placement, so staff
                // can plan against the wrong day believing it is current. The
                // gateway counts them because refusing the whole snapshot over one
                // drifted row is what took the board down (OPEN_REPAIRS 177) --
                // but a count nothing reads is the same silence in a new place,
                // which is what Codex caught on this PR. Carried here so
                // wlLoadSnapshot can say it out loud.
                plansDropped: Number.isSafeInteger(value.plans_dropped) && value.plans_dropped > 0
                    ? value.plans_dropped : 0 };
        } finally { clearTimeout(timer); }
    }
    /* BACKGROUND SNAPSHOT WARM-UP (migrations/2026-09-23-workload-native-snapshot-warm.sql).
       Measured after the cached snapshot went live: half the full reads were
       rebuilds paid by whoever opened Workload next (3.9-6.1 s vs 0.7-1.6 s),
       because the source tables change all day. So the rebuild is asked for
       here instead, off every save's path:
       - after a staff SAVE (a successful POST whose action writes; reads that
         travel as POSTs, e.g. production-write labels_read, never count), one
         warm-up ~1.5 s later (a burst of saves costs one);
       - every 2 minutes from one visible tab per browser that has Workload
         loaded, which covers writes no staff browser makes (system bridges,
         client links).
       The observer is installed only once the page is confirmed staff, hands
       every request and response through untouched (the caller gets the
       network's own promise), and looks at the status only after the response
       has already resolved, so it cannot delay or alter a save. The warm-up
       returns no data. */
    const WL_WARM_DEBOUNCE_MS = 1500;
    const WL_WARM_INTERVAL_MS = 120000;
    const WL_WARM_SHARED_KEY = 'syncview_wlSnapshotWarmAt_v1';
    const WL_WARM_WRITE_FUNCTIONS = ['production-write', 'production-archive', 'calendar-upsert', 'calendar-reorder'];
    const _wlWarm = { timer: null, inFlight: false, again: false, off: false, fetch: null };
    function wlIsSnapshotSourceWrite(url, init) {
        const method = String((init && init.method) || 'GET').toUpperCase();
        if (method !== 'POST') return false;
        const match = /\/functions\/v1\/([a-z0-9-]+)(?:[/?#]|$)/.exec(String(url || ''));
        if (!match) return false;
        const body = init && typeof init.body === 'string' ? init.body : '';
        const action = (/"action"\s*:\s*"([a-z0-9_]+)"/.exec(body) || [])[1] || '';
        if (match[1] === 'workload-plan') return action === 'set';
        if (!WL_WARM_WRITE_FUNCTIONS.includes(match[1])) return false;
        // Reads that travel as POSTs (labels_read, batch_files_read, ...).
        return !/_(read|list|get)$/.test(action);
    }
    function wlScheduleSnapshotWarm(delay) {
        if (_wlWarm.off) return;
        if (_wlWarm.inFlight) { _wlWarm.again = true; return; }
        clearTimeout(_wlWarm.timer);
        _wlWarm.timer = setTimeout(wlWarmSnapshotNow, delay == null ? WL_WARM_DEBOUNCE_MS : delay);
    }
    async function wlWarmSnapshotNow() {
        _wlWarm.timer = null;
        if (_wlWarm.off || _wlWarm.inFlight || !_wlWarm.fetch) return;
        if (typeof _syncviewStaffIdentityForHeaders !== 'function' || !_syncviewStaffIdentityForHeaders()) return;
        _wlWarm.inFlight = true;
        try { localStorage.setItem(WL_WARM_SHARED_KEY, String(Date.now())); } catch {}
        try {
            const response = await _wlWarm.fetch.call(window, WORKLOAD_PLAN_URL, {
                method: 'POST', cache: 'no-store', keepalive: true,
                headers: _syncviewEfHeaders({ 'Content-Type': 'application/json' }, WORKLOAD_PLAN_URL),
                body: JSON.stringify({ action: 'warm_snapshot' })
            });
            // Not deployed yet (400/501) or not staff (401/403): stop for this page.
            if ([400, 401, 403, 501].includes(response.status)) _wlWarm.off = true;
            else if (response.ok) {
                const value = await response.json().catch(() => null);
                // Another rebuild was already running; it may predate our save.
                if (value && value.reason === 'busy') _wlWarm.again = true;
            }
        } catch { /* best effort: the next reader still rebuilds on its own */ }
        finally {
            _wlWarm.inFlight = false;
            if (_wlWarm.again) { _wlWarm.again = false; wlScheduleSnapshotWarm(4000); }
        }
    }
    function wlWrapFetchForSnapshotWarm() {
        if (_wlWarm.fetch || typeof window.fetch !== 'function') return;
        const original = window.fetch;
        _wlWarm.fetch = original;
        window.fetch = function (input, init) {
            const pending = original.apply(this, arguments);
            try {
                const url = typeof input === 'string' ? input : (input && input.url) || '';
                if (wlIsSnapshotSourceWrite(url, init)) {
                    pending.then(response => { if (response && response.ok) wlScheduleSnapshotWarm(); }, () => {});
                }
            } catch {}
            return pending;
        };
    }
    function wlInstallSnapshotWarmer() {
        if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
        // Wrap only once this page is confirmed staff; client links never are.
        const waitForStaff = setInterval(() => {
            if (typeof _syncviewStaffIdentityForHeaders !== 'function' || !_syncviewStaffIdentityForHeaders()) return;
            clearInterval(waitForStaff);
            wlWrapFetchForSnapshotWarm();
        }, 5000);
        setInterval(() => {
            if (!_wlWarm.fetch || document.visibilityState !== 'visible' || wlState.fetchedAt == null) return;
            let last = 0;
            try { last = Number(localStorage.getItem(WL_WARM_SHARED_KEY)) || 0; } catch {}
            if (Date.now() - last < WL_WARM_INTERVAL_MS - 5000) return;
            wlScheduleSnapshotWarm(0);
        }, WL_WARM_INTERVAL_MS);
    }
    wlInstallSnapshotWarmer();

    async function loadLinearIssues(force) {
        // The public symbol is retained for intake discovery callers. Default,
        // explicit Refresh and forced post-create discovery share one source.
        return wlFetchNativeSnapshot();
    }
    /* POST-CREATE DISCOVERY -- RETIRED 2026-09-20.

       `wlDiscoverProviderIssues()` used to poll Linear directly for the
       issues n8n had just created, so `_writeLinearVideoCardsToCalendar`
       could pair each calendar card to its sub-issue. Every active client is
       native-enrolled now (`write_ui_reroute_clients`, 43 of 43 measured
       2026-09-20); a native submission links its calendar cards through
       `_writeNativeSubmissionCardsToCalendar` from its own create-response
       IDs and never asks Linear anything. See `_writeLinearVideoCardsToCalendar`
       below for what happens on the path that can still reach this code
       without a native enrollment: it holds visibly rather than falling back
       to this reader. The symbol is removed rather than left reachable, so a
       future caller cannot wire itself back onto a live Linear read here by
       mistake. `_wlLegacyLoadLinearIssues` below now has zero callers (this
       was its only one); it is retained, unreachable, alongside the other
       leftover legacy mirror readers documented in
       `LINEAR_EXIT_STEP26_NATIVE_WORKLOAD.md` (Gate 0 item 8 / checks 14-15),
       rather than deleted piecemeal ahead of that closure step. */
    async function _wlLegacyLoadLinearIssues(force, options) {
        const skipCacheWrite = !!(options && options.skipCacheWrite);
        const cache = wlReadCache();
        if (cache && !force && wlIsFresh(cache.fetchedAt)) {
            return { issues: cache.issues, fetchedAt: cache.fetchedAt, fromCache: true };
        }
        // Workload v2 (?wl2=1): read the prebuilt workload_issues table from
        // Supabase (sub-second). ANY failure — or a suspicious empty result —
        // falls through to the original linear-issues endpoint below, so v2 can
        // never blank or half-populate the board.
        // A forced refresh must honor its "from Linear" contract. The mirror
        // is the fast default read, but it can trail Linear until the upstream
        // reconcile; only manual refresh and post-create discovery bypass it.
        if (_wlV2Ready() && !force) {
            try {
                const issues = await _wlV2FetchIssues();
                if (Array.isArray(issues) && issues.length) {
                    const fetchedAt = Date.now();
                    if (!skipCacheWrite) wlWriteCache({ issues, fetchedAt });
                    return { issues, fetchedAt, fromCache: false };
                }
                console.warn('[Workload v2] Supabase returned 0 active rows — falling back to linear-issues');
            } catch (e) {
                console.warn('[Workload v2] Supabase read failed — falling back to linear-issues', e);
            }
        }
        // When forcing a refresh (e.g. the bulk-create polling loop), bypass
        // the browser's HTTP cache so a previous 304 doesn't replay stale
        // data, and append a timestamp so any CDN in front of n8n can't
        // collapse two back-to-back GETs into the same cached response.
        const url = force
            ? (LINEAR_ISSUES_WEBHOOK + (LINEAR_ISSUES_WEBHOOK.includes('?') ? '&' : '?') + 't=' + Date.now())
            : LINEAR_ISSUES_WEBHOOK;
        const init = force ? { method: 'GET', cache: 'no-store' } : { method: 'GET' };
        const resp = await fetch(url, init);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        const issues = Array.isArray(data) ? data : (data.issues || []);
        const fetchedAt = Date.now();
        if (!skipCacheWrite) wlWriteCache({ issues, fetchedAt });
        return { issues, fetchedAt, fromCache: false };
    }

    // Date helpers — all dates handled as YYYY-MM-DD strings for determinism.
    const WL_PLAN_READ_TIMEOUT_MS = 8000;
    /* THE NATIVE SNAPSHOT CANNOT LIVE INSIDE THE 8-SECOND READ BUDGET.
       Measured 2026-09-21 (function_edge_logs, workload-plan POST): the
       native_snapshot answer is a 2.0 MB body whose Edge Function execution
       alone averaged 3.3 to 4.5 s across the day and peaked at 8.2 s -- so an
       8 s client budget that must also cover downloading 2 MB to a residential
       connection was already spent before the body finished. Between 23:58 and
       00:05 UTC every one of six loads was answered 200 by the server and then
       cancelled by the browser at 8 s, and the console read
       "Workload fetch failed: AbortError" while the board painted the
       "Saved work days are unavailable" state with no cards at all
       (the localStorage warm start only covers LINEAR_ISSUES_TTL_MS).
       The board is 6,651 rows and grows daily, so this is a limit the estate
       was always going to reach. The budget has to cover the server peak AND
       the download: 30 s is about 3.7 times the 8.2 s server peak, and roughly
       twice an 8 s execution followed by a 2 MB download at 2 Mbps (8 s). A
       longer budget would only delay the same empty board on a real hang.
       Only the snapshot fetch reads this constant: the
       archive-marker chunk reads, the plan list and the popover reads keep
       WL_PLAN_READ_TIMEOUT_MS. OPEN_REPAIRS 230. */
    const WL_SNAPSHOT_READ_TIMEOUT_MS = 30000;
    const WL_PLAN_WRITE_TIMEOUT_MS = 10000;
    const WL_LINEAR_READ_TIMEOUT_MS = 20000;
    const WL_LINEAR_WRITE_TIMEOUT_MS = 12000;
    const WL_NATIVE_DUE_RECEIPT_SIGNAL_KEY = 'syncview_workload_native_due_receipt_v1';
    const WL_NATIVE_DUE_RECEIPT_SIGNAL_SCHEMA = 'syncview.workload.native-due-receipt.v1';
    const WL_NATIVE_DUE_RECEIPT_RETRY_DELAYS_MS = Object.freeze([250, 1000, 5000]);
    const _wlPlanWriteInFlight = new Map();
    const _wlDueWriteInFlight = new Map();
    const _wlPlanLastWriteGeneration = new Map();
    let _wlPlanWriteGeneration = 0;
    let _wlPlanSessionGeneration = 0;
    let _wlPlanLoadGeneration = 0;
    let _wlBackgroundRefreshPromise = null;
    let _wlBackgroundRefreshMode = null;
    const _wlPendingNativeDueReceiptByTarget = new Map();
    let _wlNativeDueReceiptRetryPromise = null;
    let _wlNativeDueReceiptGeneration = 0;
    let _wlNativeDueReceiptRetryTimer = null;
    let _wlNativeDueReceiptRetryAttempt = 0;
    // Setters for the Workload render module (080). ES module imports are
    // read-only, so 080 changes these through the functions below instead
    // of assigning them directly (phase C step C3).
    function _wlSetBackgroundRefreshPromise(value) { _wlBackgroundRefreshPromise = value; }
    function _wlSetBackgroundRefreshMode(value) { _wlBackgroundRefreshMode = value; }
    function _wlSetNativeDueReceiptRetryPromise(value) { _wlNativeDueReceiptRetryPromise = value; }
    function _wlSetNativeDueReceiptRetryTimer(value) { _wlNativeDueReceiptRetryTimer = value; }
    function _wlSetNativeDueReceiptRetryAttempt(value) { _wlNativeDueReceiptRetryAttempt = value; }
    function _wlTakeNativeDueReceiptRetryAttempt() { return _wlNativeDueReceiptRetryAttempt++; }
    function _wlNextNativeDueReceiptGeneration() { return ++_wlNativeDueReceiptGeneration; }
    function _wlNextPlanLoadGeneration() { return ++_wlPlanLoadGeneration; }
    function _wlNextPlanWriteGeneration() { return ++_wlPlanWriteGeneration; }

    function wlPlanEditingEnabled() {
        return wlState.planStatus === 'ready' && _syncviewStaffCan('workload-plan');
    }
    function wlLinearEditingEnabled(issue) {
        if (!_syncviewStaffCan('workload-linear')) return false;
        // A mixed-authority refresh can prove one partition while the other is
        // temporarily unavailable. Keep only rows with an exact current route
        // editable instead of making native due writes depend on Linear health.
        return issue ? !!wlDueWriteRoute(issue) : wlState.linearMetadataStatus === 'ready';
    }

    async function wlFetchPlanRows() {
        await _syncviewRequireStaffIdentity('workload-plan-read');
        const sessionGeneration = _wlPlanSessionGeneration;
        const readGeneration = _wlPlanWriteGeneration;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), WL_PLAN_READ_TIMEOUT_MS);
        try {
            const resp = await fetch(WORKLOAD_PLAN_URL, {
                method: 'POST',
                cache: 'no-store',
                signal: controller.signal,
                headers: _syncviewEfHeaders({ 'Content-Type': 'application/json' }, WORKLOAD_PLAN_URL),
                body: JSON.stringify({ action: 'list' })
            });
            let json = null;
            try { json = await resp.json(); } catch (e) {}
            if (!resp.ok || !json || json.ok !== true || !Array.isArray(json.plans)) {
                const error = new Error((json && json.error) || ('HTTP ' + resp.status));
                error.status = resp.status;
                throw error;
            }
            if (sessionGeneration !== _wlPlanSessionGeneration) throw new Error('staff_session_changed');
            /* A response can be OK and still carry an INCOMPLETE map: saved days
               are stored under two ids for the same card and the sidecar
               reconciles them per answer, so a degraded answer holds every
               stored day but not every alias. Absent fields mean an older
               function build, which cannot report either way — read as
               complete, exactly as this client behaved before they existed. */
            const aliasMode = String(json.alias_mode || '');
            const unaliased = Number(json.plans_unaliased);
            return {
                rows: json.plans,
                readGeneration,
                aliasMode,
                unaliased: Number.isFinite(unaliased) && unaliased > 0 ? Math.floor(unaliased) : 0
            };
        } finally {
            clearTimeout(timeout);
        }
    }

    function wlProductionAuthorityValue(value) {
        if (typeof value === 'string') {
            try { value = JSON.parse(value); } catch (error) { return null; }
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const video = String(value.video || '').trim().toLowerCase();
        const graphics = String(value.graphics || '').trim().toLowerCase();
        if (!['linear', 'syncview'].includes(video) || !['linear', 'syncview'].includes(graphics)) return null;
        return { video, graphics };
    }

    function wlProductionAuthorityFingerprint(authority) {
        const value = wlProductionAuthorityValue(authority);
        return value ? `video:${value.video}|graphics:${value.graphics}` : '';
    }

    async function wlFetchProductionAuthority() {
        const url = CAL_SUPABASE_URL + '/rest/v1/syncview_runtime_flags?select=value&key=eq.prod_authority&limit=2';
        const response = await fetch(url, {
            cache: 'no-store',
            headers: {
                apikey: CAL_SUPABASE_ANON_KEY,
                Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY,
                Accept: 'application/json'
            }
        });
        if (!response.ok) throw new Error('Production authority HTTP ' + response.status);
        const rows = await response.json();
        const authority = Array.isArray(rows) && rows.length === 1
            ? wlProductionAuthorityValue(rows[0] && rows[0].value)
            : null;
        if (!authority) throw new Error('Production authority is unavailable.');
        return authority;
    }

    // Session memo for the live-Linear weight sweep, paired with the 5-minute
    // issue cache: an issue's foreign metadata (weight + due) rarely changes,
    // and the watermark poll + realtime refresh catch changes, so a bounded
    // 5-minute reuse lets repeated foreground loads skip re-sweeping ids we
    // already have — shrinking the live api.linear.app round-trips. In-memory
    // only (never persisted); a full purge clears it.
    const WL_FOREIGN_METADATA_TTL_MS = 5 * 60 * 1000;
    const WL_FOREIGN_METADATA_MAX_RETRIES = 3;
    const _wlForeignMetadataCache = new Map();
    function wlForeignMetadataCacheClear() {
        try { _wlForeignMetadataCache.clear(); } catch {}
    }
    async function wlFetchForeignLinearMetadata(issueIds) {
        if (!issueIds.length) return [];
        // Reuse fresh cached rows (5-min TTL) and only sweep the misses. The
        // cache is module-level in the app; when this function is unit-extracted
        // in isolation it is absent, so we transparently fall back to fetching
        // every id (no behavior change for those tests).
        const cache = (typeof _wlForeignMetadataCache !== 'undefined' && _wlForeignMetadataCache) || null;
        const ttl = (typeof WL_FOREIGN_METADATA_TTL_MS !== 'undefined' && WL_FOREIGN_METADATA_TTL_MS) || (5 * 60 * 1000);
        const maxRetries = (typeof WL_FOREIGN_METADATA_MAX_RETRIES !== 'undefined' && WL_FOREIGN_METADATA_MAX_RETRIES) || 3;
        const now = Date.now();
        const rows = [];
        const toFetch = [];
        for (const id of issueIds) {
            const key = String(id || '');
            const entry = cache && cache.get(key);
            if (entry && (now - entry.fetchedAt) < ttl) rows.push(entry.row);
            else toFetch.push(id);
        }
        if (!toFetch.length) return rows;
        const chunks = [];
        for (let index = 0; index < toFetch.length; index += 100) chunks.push(toFetch.slice(index, index + 100));
        let cursor = 0;
        const worker = async () => {
            while (cursor < chunks.length) {
                const chunk = chunks[cursor++];
                // A live Linear sweep can hit rate limits; retry a 429 with
                // exponential backoff (honoring Retry-After) before failing.
                for (let attempt = 0; ; attempt++) {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), WL_LINEAR_READ_TIMEOUT_MS);
                    let retryDelay = -1;
                    let chunkRows = null;
                    try {
                        const resp = await fetch(WORKLOAD_LINEAR_URL, {
                            method: 'POST',
                            cache: 'no-store',
                            signal: controller.signal,
                            headers: _syncviewEfHeaders({ 'Content-Type': 'application/json' }, WORKLOAD_LINEAR_URL),
                            body: JSON.stringify({ action: 'metadata', issue_ids: chunk })
                        });
                        if (resp.status === 429 && attempt < maxRetries) {
                            const header = resp.headers && resp.headers.get ? Number(resp.headers.get('Retry-After')) : NaN;
                            retryDelay = Number.isFinite(header) && header > 0
                                ? Math.min(header * 1000, 8000)
                                : Math.min(500 * Math.pow(2, attempt), 8000);
                        } else {
                            let json = null;
                            try { json = await resp.json(); } catch (error) {}
                            if (!resp.ok || !json || json.ok !== true || json.complete !== true || !Array.isArray(json.rows)) {
                                const error = new Error((json && json.error) || ('HTTP ' + resp.status));
                                error.status = resp.status;
                                throw error;
                            }
                            chunkRows = json.rows;
                        }
                    } finally {
                        clearTimeout(timeout);
                    }
                    if (retryDelay >= 0) {
                        await new Promise(resolve => setTimeout(resolve, retryDelay));
                        continue;
                    }
                    for (const row of chunkRows) {
                        rows.push(row);
                        const key = cache && String(row && row.issue_id || '');
                        if (cache && key) cache.set(key, { row, fetchedAt: Date.now() });
                    }
                    break;
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(6, chunks.length) }, worker));
        return rows;
    }

    function wlNativeWorkloadLabel(labels) {
        let chosen = null;
        for (const value of Array.isArray(labels) ? labels : []) {
            const name = String(value && value.name || '');
            const weight = name === '2× Workload' ? 2 : name === '3× Workload' ? 3 : 0;
            if (!weight || (chosen && chosen.weight >= weight)) continue;
            const rawColor = String(value && value.color || '');
            chosen = {
                label: name,
                weight,
                color: /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor.toUpperCase() : ''
            };
        }
        return chosen;
    }

    function wlNativeDueDate(value) {
        if (value == null) return null;
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
        if (!match) throw new Error('Native Workload due date is malformed.');
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const date = new Date(Date.UTC(year, month - 1, day));
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
            throw new Error('Native Workload due date is malformed.');
        }
        return String(value);
    }

    async function wlFetchNativeMetadata(issueIds) {
        if (!issueIds.length) return [];
        const rows = [];
        /* OPEN_REPAIRS item 71. Until F1(video) this partition shared the page
           with a Linear partition, so a failed read here cost half the board.
           Post-flip it IS the board, and a single failed 100-id chunk used to
           throw the whole function -- every due date blanked, every date
           control disabled, for one bad response out of several. A failed
           chunk now degrades to exactly what an unprovable ROW already gets:
           its ids join unavailableIssueIds, their due dates blank and their
           write routes withhold (fail closed per id), and every other chunk
           stays fully proven and editable. The one case that still throws is
           EVERY chunk failing with nothing proven -- that is a failed read,
           not a degraded one, and the caller's fail-total path (banner, auth
           handling, sanitize) keeps its exact prior semantics for it. The
           page banner still names a missing label as the cause for these ids,
           which is one more entry in the cause-conflation the audit already
           records against the banner -- copy, not behavior. */
        const failedChunkIds = [];
        let firstChunkError = null;
        let anyChunkSucceeded = false;
        /* EVERY CHUNK IN FLIGHT AT ONCE. This loop used to await each 100-id
           chunk before starting the next: ~8 serial round trips for the live
           board (~0.3 s each from a laptop), all of it AFTER the fast paint and
           all of it what the user waits through before the Planning… labels
           settle. Chunks are independent reads, so they go out together and
           are folded back in index order, which keeps `firstChunkError` (the
           earliest chunk's failure) and `failedChunkIds` exactly as before. */
        const chunks = [];
        for (let index = 0; index < issueIds.length; index += 100) chunks.push(issueIds.slice(index, index + 100));
        const readChunk = async (chunk) => {
            const inFilter = '(' + chunk.map(issueId => JSON.stringify(issueId)).join(',') + ')';
            const readPage = async (table, select, filterField) => {
                const url = CAL_SUPABASE_URL + '/rest/v1/' + table + '?select=' + select
                    + '&' + filterField + '=in.' + encodeURIComponent(inFilter)
                    + '&limit=' + String(chunk.length + 1);
                const response = await fetch(url, {
                    cache: 'no-store',
                    headers: {
                        apikey: CAL_SUPABASE_ANON_KEY,
                        Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY,
                        Accept: 'application/json'
                    }
                });
                const payload = await response.json().catch(() => ({}));
                return { response, payload };
            };
            // A native row (no Linear-born UUID) never matches a
            // linear_issue_uuid filter, so it used to fall straight into
            // unavailableIssueIds and lose its due date/write route. This
            // reads a second, id-keyed branch with the same projection so a
            // native row can still be proven by its own id, and merges its
            // rows with the uuid branch used for Linear-born rows.
            const readBranch = async (filterField) => {
                try {
                    let projected = await readPage(
                        'production_deliverables_browser_v1',
                        'id,client_slug,team,linear_issue_uuid,due_date,updated_at,workload_labels_complete,workload_labels',
                        filterField
                    );
                    let legacyProjection = false;
                    if (!projected.response.ok) {
                        const projectionError = {
                            status: projected.response.status,
                            code: String(projected.payload && projected.payload.code || ''),
                            detail: String(projected.payload && (projected.payload.message || projected.payload.details || projected.payload.hint) || '')
                        };
                        if (!_prodBrowserProjectionMissing(projectionError)) {
                            throw new Error('Native Workload metadata HTTP ' + projected.response.status);
                        }
                        // Release transition only. No auth/network/server failure may
                        // reopen the raw-body path after the safe view exists.
                        projected = await readPage(
                            'deliverables',
                            'id,client_slug,team,linear_issue_uuid,due_date,updated_at,linear_raw',
                            filterField
                        );
                        legacyProjection = true;
                    }
                    if (!projected.response.ok) {
                        throw new Error('Native Workload metadata HTTP ' + projected.response.status);
                    }
                    const page = projected.payload;
                    if (!Array.isArray(page)) throw new Error('Native Workload metadata is malformed.');
                    page.forEach(row => {
                        row.__legacy_workload_projection = legacyProjection;
                        row.__native_metadata_key_field = filterField;
                    });
                    return { page };
                } catch (error) {
                    return { error };
                }
            };
            const [uuidBranch, idBranch] = await Promise.all([
                readBranch('linear_issue_uuid'),
                readBranch('id')
            ]);
            // The chunk only fails when BOTH branches fail -- either branch
            // proving a row is enough, same as the existing per-id degrade
            // (a bad response here withholds only the ids it touches).
            if (uuidBranch.error && idBranch.error) {
                return { error: uuidBranch.error };
            }
            return { page: [...(uuidBranch.page || []), ...(idBranch.page || [])] };
        };
        const chunkResults = await Promise.all(chunks.map(readChunk));
        chunkResults.forEach((result, index) => {
            if (result && result.page) {
                rows.push(...result.page);
                anyChunkSucceeded = true;
            } else {
                if (!firstChunkError) firstChunkError = result && result.error || new Error('Native Workload metadata read failed.');
                failedChunkIds.push(...chunks[index]);
            }
        });
        if (firstChunkError && !anyChunkSucceeded) throw firstChunkError;
        const byIssueId = new Map();
        const ambiguous = new Set();
        for (const row of rows) {
            const keyField = row && row.__native_metadata_key_field === 'id' ? 'id' : 'linear_issue_uuid';
            const issueId = String(row && row[keyField] || '').trim();
            if (!issueId) continue;
            // Two native rows claiming one Linear issue means neither can be
            // proven. That is confined to this issue id — it says nothing about
            // the other issues in the read.
            if (byIssueId.has(issueId)) { ambiguous.add(issueId); continue; }
            byIssueId.set(issueId, row);
        }
        // A row we cannot PROVE degrades on its own. It used to throw, and the
        // throw failed the whole syncview partition: one unprovable row blanked
        // every graphics due date on the page and disabled editing for all of
        // them. That is not fail-closed, it is fail-total — the safety property
        // worth keeping is only "never apply a weight we cannot prove", and
        // excluding the row achieves exactly that. Excluded ids are reported so
        // the caller can mark them unavailable through the existing
        // partialFailure path, which blanks their due date and withholds their
        // write route while leaving every proven row alone.
        const unavailableIssueIds = [...failedChunkIds];
        const failedChunkIdSet = new Set(failedChunkIds);
        const mapped = [];
        for (const issueId of issueIds) {
            if (failedChunkIdSet.has(issueId)) continue; // already unavailable above
            const row = ambiguous.has(issueId) ? null : byIssueId.get(issueId);
            if (!row) { unavailableIssueIds.push(issueId); continue; }
            const projected = wlNativeMetadataRow(issueId, row);
            if (!projected) { unavailableIssueIds.push(issueId); continue; }
            mapped.push(projected);
        }
        Object.defineProperty(mapped, 'unavailableIssueIds', {
            configurable: true,
            value: unavailableIssueIds
        });
        return mapped;
    }

    /* One native row -> one metadata row, or null when it cannot be proven.
     * Split out of wlFetchNativeMetadata so an unprovable row is a value the
     * caller can act on rather than an exception that discards its siblings. */
    function wlNativeMetadataRow(issueId, row) {
        try {
            const nativeId = String(row && row.id || '').trim();
            const clientSlug = String(row && row.client_slug || '').trim();
            const team = wlMetadataTeamBucket('', row && row.team);
            const updatedAt = String(row && row.updated_at || '').trim();
            if (!nativeId || !clientSlug || !team || !wlValidRfc3339Timestamp(updatedAt)) {
                throw new Error('Native Workload due target is incomplete.');
            }
            let workloadLabels = row && row.workload_labels;
            if (row && row.__legacy_workload_projection === true) {
                let raw = row.linear_raw;
                if (typeof raw === 'string') {
                    try { raw = JSON.parse(raw); } catch (error) { raw = null; }
                }
                const relation = raw && typeof raw === 'object'
                    && raw.issue && typeof raw.issue === 'object'
                    && raw.issue.labels && typeof raw.issue.labels === 'object'
                    ? raw.issue.labels
                    : null;
                if (!relation || !Array.isArray(relation.nodes)
                    || !relation.pageInfo || relation.pageInfo.hasNextPage !== false) {
                    throw new Error('Native Workload label state is incomplete.');
                }
                workloadLabels = relation.nodes;
                if (Object.prototype.hasOwnProperty.call(raw.issue, 'labelIds')) {
                    const selectedIds = new Set();
                    for (const value of Array.isArray(raw.issue.labelIds) ? raw.issue.labelIds : []) {
                        const labelId = String(value || '').trim();
                        if (!labelId || selectedIds.has(labelId)) {
                            throw new Error('Native Workload label state is incomplete.');
                        }
                        selectedIds.add(labelId);
                    }
                    const relationIds = new Set(workloadLabels.map(label =>
                        String(label && label.id || '').trim()));
                    if (!Array.isArray(raw.issue.labelIds)
                        || selectedIds.size !== relationIds.size
                        || [...selectedIds].some(labelId => !relationIds.has(labelId))) {
                        throw new Error('Native Workload label state is incomplete.');
                    }
                }
            } else if (row.workload_labels_complete !== true || !Array.isArray(workloadLabels)) {
                throw new Error('Native Workload label state is incomplete.');
            }
            const nodeIds = new Set();
            for (const node of workloadLabels) {
                const nodeId = String(node && node.id || '').trim();
                const nodeName = String(node && node.name || '').trim();
                if (!nodeId || !nodeName || nodeIds.has(nodeId)) {
                    throw new Error('Native Workload label state is incomplete.');
                }
                nodeIds.add(nodeId);
            }
            return {
                issue_id: issueId,
                due_date: wlNativeDueDate(row && row.due_date),
                workload: wlNativeWorkloadLabel(workloadLabels),
                native_target: {
                    id: nativeId,
                    client_slug: clientSlug,
                    team,
                    updated_at: updatedAt
                }
            };
        } catch (error) {
            // Every proof failure above — missing target fields, an unsound or
            // paginated label relation, a malformed due date — means the same
            // thing here: this row is not provable, so it is withheld. It is
            // never downgraded to a partial weight.
            return null;
        }
    }

    function wlMetadataFailure(error, issueIds) {
        const failure = error instanceof Error
            ? error
            : new Error(String(error || 'Workload metadata could not be loaded.'));
        failure.workloadMetadataFailure = true;
        failure.workloadMetadataIssueIds = [...new Set((issueIds || [])
            .map(issueId => String(issueId || '').trim())
            .filter(Boolean))];
        return failure;
    }

    function wlMetadataTeamBucket(teamKey, teamName) {
        const key = String(teamKey || '').trim().toUpperCase();
        const name = String(teamName || '').trim().toLowerCase();
        const keyBucket = key === 'VID' ? 'video' : key === 'GRA' ? 'graphics' : null;
        const nameBucket = name === 'video' ? 'video' : name === 'graphics' ? 'graphics' : null;
        if (keyBucket && nameBucket && keyBucket !== nameBucket) return null;
        return keyBucket || nameBucket || null;
    }

    async function wlFetchLinearMetadata(issues) {
        const activeIssues = (issues || [])
            .filter(issue => issue && issue.isSubIssue && wlIsActiveStatus(issue) && wlIssueClientAllowed(issue));
        const activeIds = [...new Set(activeIssues
            .map(issue => String(issue && issue.id || '').trim())
            .filter(Boolean))];
        try {
            await _syncviewRequireStaffIdentity('workload-linear-read');
        } catch (error) {
            throw wlMetadataFailure(error, activeIds);
        }
        const sessionGeneration = _wlPlanSessionGeneration;
        let authority = null;
        try {
            authority = await wlFetchProductionAuthority();
        } catch (error) {
            // Without a current authority read, no retained feeder metadata has
            // proven ownership. Fail closed for every active issue.
            throw wlMetadataFailure(error, activeIds);
        }
        const boundLinearIds = [];
        const unboundLinearIds = [];
        const nativeIds = [];
        const teamByIssueId = new Map();
        const seen = new Set();
        try {
            for (const issue of activeIssues) {
                const issueId = String(issue.id || '').trim();
                if (!issueId || seen.has(issueId)) continue;
                seen.add(issueId);
                const team = wlMetadataTeamBucket(issue.teamKey, issue.teamName);
                if (!team) throw new Error('Workload issue team authority is unavailable.');
                teamByIssueId.set(issueId, team);
                if (authority[team] === 'syncview') nativeIds.push(issueId);
                else if (authority[team] === 'linear') {
                    // A legacy row bound to a native deliverable
                    // (legacyBoundNativeId) reads through the native
                    // projection, same as the snapshot ingest above -- its
                    // write authority still tags 'linear' below (the team
                    // itself is still Linear-authoritative and
                    // production-write refuses this row regardless of the
                    // binding), only the read moves off workload-linear.
                    if (issue.legacyBoundNativeId) boundLinearIds.push(issueId);
                    else unboundLinearIds.push(issueId);
                } else throw new Error('Workload issue team authority is unavailable.');
            }
        } catch (error) {
            throw wlMetadataFailure(error, activeIds);
        }
        const [linearResult, nativeResult, boundLinearResult] = await Promise.allSettled([
            wlFetchForeignLinearMetadata(unboundLinearIds),
            wlFetchNativeMetadata(nativeIds),
            wlFetchNativeMetadata(boundLinearIds)
        ]);
        if (sessionGeneration !== _wlPlanSessionGeneration) {
            throw wlMetadataFailure(new Error('staff_session_changed'), activeIds);
        }
        const authorityFingerprint = wlProductionAuthorityFingerprint(authority);
        const tag = (row, dueAuthority) => {
            const issueId = String(row && row.issue_id || '').trim();
            const team = teamByIssueId.get(issueId) || '';
            if (!issueId || !team || authority[team] !== dueAuthority) {
                throw new Error('Workload due authority metadata is inconsistent.');
            }
            return {
                ...row,
                due_authority: dueAuthority,
                due_authority_team: team,
                due_authority_fingerprint: authorityFingerprint
            };
        };
        const partitions = [
            { authority: 'linear', ids: unboundLinearIds, result: linearResult },
            { authority: 'syncview', ids: nativeIds, result: nativeResult },
            { authority: 'linear', ids: boundLinearIds, result: boundLinearResult }
        ];
        const rows = [];
        const failures = [];
        // Ids a fulfilled partition could not prove ROW BY ROW. They are not
        // partition failures — the read succeeded and the other rows are good —
        // but they are still unavailable, so they travel the same reporting
        // path as a failed partition and end up equally non-editable.
        const unprovable = [];
        for (const partition of partitions) {
            if (!partition.ids.length) continue;
            if (partition.result.status === 'rejected') {
                failures.push({ ...partition, error: partition.result.reason });
                continue;
            }
            try {
                const value = partition.result.value;
                for (const issueId of (value && value.unavailableIssueIds) || []) {
                    unprovable.push({ authority: partition.authority, issueId: String(issueId || '').trim() });
                }
                rows.push(...value.map(row => tag(row, partition.authority)));
            } catch (error) {
                failures.push({ ...partition, error });
            }
        }
        const authFailure = failures.find(failure =>
            Number(failure.error && failure.error.status) === 401
            || Number(failure.error && failure.error.status) === 403);
        if (authFailure) throw wlMetadataFailure(authFailure.error, activeIds);
        if (failures.length && !rows.length) {
            throw wlMetadataFailure(failures[0].error, failures.flatMap(failure => failure.ids));
        }
        if (failures.length || unprovable.length) {
            const unprovableIds = unprovable.map(entry => entry.issueId).filter(Boolean);
            const unprovableNativeIds = unprovable
                .filter(entry => entry.authority === 'syncview')
                .map(entry => entry.issueId)
                .filter(Boolean);
            Object.defineProperty(rows, 'partialFailure', {
                configurable: true,
                value: {
                    message: 'Some Workload due metadata is temporarily unavailable.',
                    // Which of the two causes this was. A failed PARTITION is
                    // broad: the read did not happen and every id in it is
                    // unavailable. Individually unprovable rows are not — the
                    // read succeeded and every other row is fully editable.
                    // The banner says very different things about the two, so
                    // it cannot be left to infer them from one flag.
                    partitionFailed: failures.length > 0,
                    issueIds: [...new Set([...failures.flatMap(failure => failure.ids), ...unprovableIds])],
                    nativeIssueIds: [...new Set([...failures
                        .filter(failure => failure.authority === 'syncview')
                        .flatMap(failure => failure.ids), ...unprovableNativeIds])]
                }
            });
        }
        return rows;
    }

    function wlAdoptLinearMetadata(rows, issues, fetchedAt, options) {
        const next = new Map();
        const nextDueAuthority = new Map();
        const nextNativeDueTarget = new Map();
        const issueById = new Map((issues || []).map(issue => [String(issue && issue.id || ''), issue]));
        const partialFailure = rows && rows.partialFailure;
        const failedNativeIds = new Set((partialFailure && partialFailure.nativeIssueIds || [])
            .map(issueId => String(issueId || '').trim())
            .filter(Boolean));
        for (const issueId of failedNativeIds) {
            const issue = issueById.get(issueId);
            if (issue) issue.dueDate = null;
        }
        for (const row of rows || []) {
            const issueId = String(row && row.issue_id || '').trim();
            if (!issueId) continue;
            const issue = issueById.get(issueId);
            if (!issue) continue;
            const team = wlMetadataTeamBucket(issue.teamKey, issue.teamName);
            const dueAuthority = String(row && row.due_authority || '').trim().toLowerCase();
            const authorityTeam = String(row && row.due_authority_team || '').trim().toLowerCase();
            const authorityFingerprint = String(row && row.due_authority_fingerprint || '').trim();
            if (!team || authorityTeam !== team || !['linear', 'syncview'].includes(dueAuthority)
                || !authorityFingerprint) {
                throw new Error('Workload due authority metadata is incomplete.');
            }
            nextDueAuthority.set(issueId, {
                authority: dueAuthority,
                team,
                fingerprint: authorityFingerprint
            });
            if (dueAuthority === 'syncview') {
                const target = row && row.native_target;
                const nativeId = String(target && target.id || '').trim();
                const clientSlug = String(target && target.client_slug || '').trim();
                const nativeTeam = String(target && target.team || '').trim().toLowerCase();
                const updatedAt = String(target && target.updated_at || '').trim();
                if (!nativeId || !clientSlug || nativeTeam !== team || !wlValidRfc3339Timestamp(updatedAt)) {
                    throw new Error('Native Workload due target is incomplete.');
                }
                nextNativeDueTarget.set(issueId, {
                    id: nativeId,
                    clientSlug,
                    team,
                    updatedAt
                });
            }
            if (issue) issue.dueDate = row.due_date ? String(row.due_date).slice(0, 10) : null;
            const workload = row && row.workload;
            const weight = Number(workload && workload.weight);
            if ((weight === 2 || weight === 3) && (workload.label === '2× Workload' || workload.label === '3× Workload')) {
                next.set(issueId, {
                    label: workload.label,
                    weight,
                    color: /^#[0-9a-f]{6}$/i.test(String(workload.color || '')) ? workload.color : ''
                });
            }
        }
        wlState.workloadByIssueId = next;
        wlState.dueAuthorityByIssueId = nextDueAuthority;
        wlState.nativeDueTargetByIssueId = nextNativeDueTarget;
        wlState.linearMetadataStatus = partialFailure ? 'stale' : 'ready';
        wlState.linearMetadataError = partialFailure ? partialFailure.message : null;
        wlState.linearMetadataWithheldOnly = partialFailure && partialFailure.partitionFailed === false
            ? (partialFailure.issueIds || []).length
            : 0;
        if (Array.isArray(issues) && !(options && options.skipIssueCacheWrite)) {
            wlWriteCache({ issues, fetchedAt: fetchedAt || Date.now() });
        }
    }

    function wlSanitizeFailedNativeMetadata(error, issues) {
        if (!error || error.workloadMetadataFailure !== true) return false;
        const issueIds = new Set((error.workloadMetadataIssueIds || [])
            .map(issueId => String(issueId || '').trim())
            .filter(Boolean));
        if (!issueIds.size) return false;
        let changed = false;
        for (const issueId of issueIds) {
            if (wlState.workloadByIssueId.delete(issueId)) changed = true;
            if (wlState.dueAuthorityByIssueId && wlState.dueAuthorityByIssueId.delete(issueId)) changed = true;
            if (wlState.nativeDueTargetByIssueId && wlState.nativeDueTargetByIssueId.delete(issueId)) changed = true;
        }
        const seenRows = new Set();
        for (const rows of [issues, wlState.issueSnapshot, wlState.allActiveSubs]) {
            if (!Array.isArray(rows) || seenRows.has(rows)) continue;
            seenRows.add(rows);
            for (const issue of rows) {
                if (!issue || !issueIds.has(String(issue.id || '').trim()) || issue.dueDate == null) continue;
                issue.dueDate = null;
                changed = true;
            }
        }
        return changed;
    }

    function wlMarkLinearMetadataFailure(error, issues) {
        const sanitized = wlSanitizeFailedNativeMetadata(error, issues);
        const status = Number(error && error.status) || 0;
        if (status === 401) _syncviewStaffIdentityClear();
        if (status === 403) {
            wlState.workloadByIssueId.clear();
            if (wlState.dueAuthorityByIssueId) wlState.dueAuthorityByIssueId.clear();
            if (wlState.nativeDueTargetByIssueId) wlState.nativeDueTargetByIssueId.clear();
        }
        wlState.linearMetadataStatus = wlState.workloadByIssueId.size ? 'stale' : 'unknown';
        wlState.linearMetadataError = (error && error.message) || 'Workload labels could not be loaded.';
        wlState.linearMetadataWithheldOnly = 0;
        return sanitized;
    }

    function wlAdoptPlanRows(snapshot) {
        const rows = snapshot && Array.isArray(snapshot.rows) ? snapshot.rows : [];
        const readGeneration = Number(snapshot && snapshot.readGeneration) || 0;
        const next = new Map();
        for (const row of rows || []) {
            const issueId = String(row && row.issue_id || '').trim();
            const planDate = String(row && row.plan_date || '').slice(0, 10);
            if (!issueId || !/^\d{4}-\d{2}-\d{2}$/.test(planDate)) continue;
            next.set(issueId, planDate);
        }
        // A list response that raced an optimistic save may contain the old
        // value. Preserve the exact local value for every issue still saving;
        // the set response remains authoritative for that issue.
        for (const issueId of _wlPlanWriteInFlight.keys()) {
            if (wlState.planByIssueId.has(issueId)) next.set(issueId, wlState.planByIssueId.get(issueId));
            else next.delete(issueId);
        }
        // Also preserve writes that settled after this list request began. A
        // delayed pre-write response must never move a just-saved card back.
        for (const [issueId, writeGeneration] of _wlPlanLastWriteGeneration) {
            if (writeGeneration > readGeneration) {
                if (wlState.planByIssueId.has(issueId)) next.set(issueId, wlState.planByIssueId.get(issueId));
                else next.delete(issueId);
            } else if (!_wlPlanWriteInFlight.has(issueId)) {
                _wlPlanLastWriteGeneration.delete(issueId);
            }
        }
        wlState.planByIssueId = next;
        wlState.planHasSnapshot = true;
        wlState.planStatus = 'ready';
        wlState.planError = null;
        wlState.planFetchedAt = Date.now();
        wlState.planAliasMode = String(snapshot && snapshot.aliasMode || '');
        wlState.planUnaliased = Number(snapshot && snapshot.unaliased) || 0;
    }

    function wlMarkPlanReadFailure(error) {
        const status = Number(error && error.status) || 0;
        if (status === 401) {
            _syncviewStaffIdentityClear();
            return;
        }
        if (status === 403) {
            wlPurgePlanSensitiveState();
            wlState.planError = 'This staff account cannot access saved work days.';
            return;
        }
        wlState.planStatus = wlState.planHasSnapshot ? 'stale' : 'unknown';
        wlState.planError = (error && error.message) || 'Saved work days could not be loaded.';
    }

    function wlPurgePlanSensitiveState() {
        _wlPlanSessionGeneration++;
        _wlPlanLoadGeneration++;
        _wlPlanWriteInFlight.clear();
        _wlDueWriteInFlight.clear();
        _wlPlanLastWriteGeneration.clear();
        _wlPlanWriteGeneration = 0;
        _wlBackgroundRefreshPromise = null;
        _wlBackgroundRefreshMode = null;
        _wlPendingNativeDueReceiptByTarget.clear();
        _wlNativeDueReceiptRetryPromise = null;
        _wlNativeDueReceiptGeneration = 0;
        if (_wlNativeDueReceiptRetryTimer !== null) clearTimeout(_wlNativeDueReceiptRetryTimer);
        _wlNativeDueReceiptRetryTimer = null;
        _wlNativeDueReceiptRetryAttempt = 0;
        wlState.planByIssueId.clear();
        wlState.planAliasMode = '';
        wlState.planUnaliased = 0;
        // Derived from the pins, so it is just as sensitive: a retained "moved
        // earlier" marker would leak that a pin existed on that day. The
        // settled-day record the next pass anchors against is derived from the
        // same placements, so it goes with them.
        wlState.autoPlacementByIssueId = new Map();
        wlState.autoPlacementSettled = new Map();
        wlState.planHasSnapshot = false;
        wlState.planStatus = 'unknown';
        wlState.planError = 'Staff sign-in is required to load saved work days.';
        wlState.planFetchedAt = null;
        wlState.workloadByIssueId.clear();
        if (typeof wlForeignMetadataCacheClear === 'function') wlForeignMetadataCacheClear();
        if (wlState.dueAuthorityByIssueId) wlState.dueAuthorityByIssueId.clear();
        if (wlState.nativeDueTargetByIssueId) wlState.nativeDueTargetByIssueId.clear();
        wlState.linearMetadataStatus = 'unknown';
        wlState.linearMetadataError = 'Staff sign-in is required to load Workload labels.';
        wlState.linearMetadataWithheldOnly = 0;
        wlState.backgroundError = null;
        // No plans are loaded at all now, so "some of them were dropped" is no
        // longer a true statement about what is on screen.
        wlState.nativePlansDropped = 0;
        // The board itself is private too (Vigil's hand test, 2026-09-28): a
        // signed-out browser showed every card and person behind the sign-in
        // prompt, even after a reload. Sign-out now drops the board's rows,
        // its team roster, the saved browser copy and any in-flight early read.
        wlPurgeBoardData();
        if (document.querySelector('.workload-view')) {
            wlClosePopover(false);
            renderWorkloadAll();
            // Sign-out purges before it clears the identity, so paint again
            // once it has: that pass draws the signed-out surface.
            setTimeout(() => { try { if (document.querySelector('.workload-view')) renderWorkloadAll(); } catch (e) {} }, 0);
        }
    }

    /* TEST CLIENTS ON WORKLOAD (Vigil's hand test, 2026-09-28).
       A test client's cards are never shown to the team by default. A browser
       that opts in with ?wltest=1 (remembered here; ?wltest=0 clears it) sees
       them, Backlog included: the test client's work sits almost entirely in
       Backlog, which the 2026-08-23 ruling keeps off Workload for real
       clients, so without it there is nothing to hand-test or to move. */
    const WL_TEST_CLIENTS_KEY = 'syncview_workload_test_clients_v1';
    function wlTestClientsMode() {
        try {
            const q = new URLSearchParams(svRoute.search()).get('wltest');
            if (q === '1' || q === 'true') { localStorage.setItem(WL_TEST_CLIENTS_KEY, '1'); return true; }
            if (q === '0' || q === 'false') { localStorage.removeItem(WL_TEST_CLIENTS_KEY); return false; }
            return localStorage.getItem(WL_TEST_CLIENTS_KEY) === '1';
        } catch (e) { return false; }
    }
    function _wlClientKey(value) {
        return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]+/g, '');
    }
    function wlIsTestClientIssue(issue) {
        const keys = wlState.testClientKeys;
        if (!issue || !keys || !keys.size) return false;
        const slug = _wlClientKey(issue.clientSlug), name = _wlClientKey(issue.clientName);
        return (!!slug && keys.has(slug)) || (!!name && keys.has(name));
    }
    let _wlTestClientsLoading = null;
    function wlLoadTestClients() {
        if (wlState.testClientKeysLoaded || _wlTestClientsLoading || !wlStaffMayView()) return _wlTestClientsLoading;
        _wlTestClientsLoading = (async () => {
            try {
                const url = CAL_SUPABASE_URL + '/rest/v1/clients?select=slug,display_name&kind=eq.test';
                const resp = await fetch(url, { cache: 'no-store', headers: { apikey: CAL_SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY, Accept: 'application/json' } });
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const rows = await resp.json();
                const keys = new Set();
                for (const row of (Array.isArray(rows) ? rows : [])) {
                    for (const v of [row && row.slug, row && row.display_name]) { const k = _wlClientKey(v); if (k) keys.add(k); }
                }
                wlState.testClientKeys = keys;
                wlState.testClientKeysLoaded = true;
                if (wlState.issueSnapshot.length && wlStaffMayView()) {
                    wlApplyData(wlState.issueSnapshot, wlState.fetchedAt);
                    if (document.querySelector('.workload-view')) renderWorkloadAll({ deferWhilePopoverOpen: true });
                }
            } catch (e) {
                // Test cards stay hidden until this list loads (wlApplyData
                // holds unclassified rows back), so keep trying.
                console.warn('[workload] test client list unavailable', e && e.message);
                setTimeout(() => { try { wlLoadTestClients(); } catch (e2) {} }, 5000);
            } finally { _wlTestClientsLoading = null; }
        })();
        return _wlTestClientsLoading;
    }

    // True only for a verified staff identity. Workload shows nothing to anyone
    // else: not the live board, not the in-memory copy, not the browser copy.
    function wlStaffMayView() {
        return !!_syncviewStaffIdentityForHeaders();
    }
    // No staff identity held at all (signed out), as opposed to one that is
    // still being verified on boot, which must not throw away the board copy.
    function wlStaffSignedOut() {
        if (wlStaffMayView()) return false;
        try { return !_syncviewStaffIdentityLoad(); } catch (e) { return true; }
    }
    function wlPurgeBoardData() {
        wlDropCache();
        try { window.__wlEarlyIssues = null; } catch (e) {}
        wlState.snapshotMemo = null;
        wlState.cachedBoardAt = null;
        wlState.editorRoster = [];
        wlState.editorRosterStatus = 'unknown';
        wlApplyData([], null);
        wlState.fetchedAt = null;
        wlState.loading = false;
        wlState.refreshing = false;
    }

    // Issue ids that moved from their fast-paint automatic estimate to a saved
    // manual plan when plans landed — the bounded set that animates its settle.
    let _wlSettleAnimIds = null;
    async function wlLoadSnapshot(force, fallback) {
        const generation = ++_wlPlanLoadGeneration, session = _wlPlanSessionGeneration;
        try {
            const value = await loadLinearIssues(!!force);
            if (generation !== _wlPlanLoadGeneration || session !== _wlPlanSessionGeneration) return null;
            wlAdoptPlanRows(value.plans);
            // A6. The cold-start net is WIRED AT BOTH ENDS or not at all. The
            // catch below still applies a cached board on a failed first load,
            // and after the source swap nothing on this path wrote that cache
            // any more (wlWriteCache was left reachable only from the legacy
            // loader), so the net silently decayed to whatever the browser last
            // stored under the old source — or to nothing. The provider
            // fallback that used to make "v2 can never blank the board" true is
            // gone for good; this localStorage warm start is the only cold-path
            // net left, so it gets written.
            // Roster first: wlAdoptLinearMetadata writes the warm-start cache,
            // which now carries this roster so the cached first paint has the
            // Team workload panel's final rows (zero-work editors included).
            wlState.editorRoster = value.roster;
            wlState.editorRosterStatus = value.rosterComplete ? 'ready' : 'unavailable';
            wlAdoptLinearMetadata(value.metadata, value.issues, value.fetchedAt);
            wlApplyData(value.issues, value.fetchedAt);
            wlState.nativeLegacyTeams = value.legacyTeams;
            // Two non-destructive warnings over a board that painted fine, and
            // they are kept in SEPARATE state on purpose. Writing the
            // dropped-plan sentence into backgroundError (the previous pass)
            // put it in a channel the renderer overwrites and a manual refresh
            // clears, so it never reached anybody. The count is authoritative
            // per response: a fresh snapshot with nothing dropped clears it.
            wlState.nativePlansDropped = Number(value.plansDropped) || 0;
            wlState.backgroundError = value.legacyTeams.length
                ? 'Some teams still use the legacy Workload source.' : null;
            wlState.planLoading = false;
            // The live snapshot has replaced any cached first paint.
            wlState.cachedBoardAt = null;
            return value;
        } catch (error) {
            if (generation !== _wlPlanLoadGeneration || session !== _wlPlanSessionGeneration) return null;
            if (Number(error.status) === 401) _syncviewStaffIdentityClear();
            else if (Number(error.status) === 403) wlPurgePlanSensitiveState();
            else {
                // Bounded by the same TTL the legacy loader used. An unbounded
                // fallback would paint a weeks-old board that looks current,
                // which is the one failure shape this program keeps calling
                // worse than an empty one.
                if (!wlState.issueSnapshot.length && fallback && Array.isArray(fallback.issues)
                    && wlIsFresh(fallback.fetchedAt)) {
                    wlApplyData(fallback.issues, fallback.fetchedAt);
                }
                wlState.backgroundError = 'Workload could not refresh. Previously loaded work is shown; retry to update it.';
                wlState.planStatus = wlState.planHasSnapshot ? 'stale' : 'unknown';
                wlState.linearMetadataStatus = wlState.workloadByIssueId.size ? 'stale' : 'unknown';
                // Retain the visible last snapshot, but a failed authority /
                // membership refresh cannot authorize an old deadline route.
                wlState.dueAuthorityByIssueId.clear();
            }
            throw error;
        }
    }
    async function _wlLegacyLoadSnapshot(force, fallback) {
        const loadGeneration = ++_wlPlanLoadGeneration;
        let fastPainted = false;
        /* WHAT THE BOARD IS SHOWING BEFORE THIS LOAD REPLACES IT.
           The Refresh button is the one read that bypasses the Supabase mirror
           and goes straight to the Linear webhook, so it is the one read whose
           payload can come back SHORTER than the board it replaces -- a
           workspace that errored, a truncated aggregate. Every such sub-issue
           then disappeared off the calendar with nothing said, pins included:
           the pin was still saved and still in memory, but the card carrying
           it was gone until the next reload, which is exactly what a refresh
           "undoing my work" looks like. Captured here, before the fast paint
           overwrites allActiveSubs with the new payload. */
        const priorActiveSubIds = force
            ? new Set((wlState.allActiveSubs || []).map(sub => String(sub && sub.id || '')).filter(Boolean))
            : null;
        wlState.planStatus = wlState.planHasSnapshot ? 'refreshing' : 'loading';
        wlState.linearMetadataStatus = wlState.workloadByIssueId.size ? 'refreshing' : 'loading';
        wlState.linearMetadataWithheldOnly = 0;
        wlState.planError = null;
        wlState.linearMetadataError = null;
        if (document.querySelector('.workload-view')) {
            // Foreground loads deliberately use the calendar-shaped skeleton.
            // Warm navigation and automatic freshness checks never enter here.
            renderWorkloadAll();
        }
        const issuesPromise = loadLinearIssues(!!force);
        const plansPromise = wlFetchPlanRows();
        /*
         * STALE-WHILE-REVALIDATE FIRST PAINT.
         *
         * A page refresh has the last snapshot in localStorage (wlReadCache,
         * passed in as `fallback`) but used to keep the skeleton up until the
         * live Linear read returned, using the cache only if that read failed.
         * The plan read is the fast leg and it is the only fail-closed one, so
         * as soon as it settles and was NOT refused, the cached issues are
         * painted with the same loading placement the fast paint below uses
         * (planLoading=true: automatic estimates, no private pins). The live
         * read then replaces them in place. If the live read wins the race
         * there is nothing to do; if the plan read was refused the skeleton
         * holds, exactly as before, until the auth branch below has run.
         */
        const cachedIssues = fallback && Array.isArray(fallback.issues) && fallback.issues.length ? fallback.issues : null;
        if (cachedIssues && !wlState.planHasSnapshot
            && typeof _wlFastPaintEnabled === 'function' && _wlFastPaintEnabled()) {
            const plansSettled = plansPromise.then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }));
            const issuesSettled = issuesPromise.then(() => null, () => null);
            const early = await Promise.race([plansSettled, issuesSettled]);
            const earlyRefused = !early || (early.status === 'rejected'
                && (Number(early.reason && early.reason.status) === 401 || Number(early.reason && early.reason.status) === 403));
            if (!earlyRefused && loadGeneration === _wlPlanLoadGeneration && !wlState.workloadByIssueId.size) {
                wlState.planLoading = true;
                fastPainted = true;
                wlApplyData(cachedIssues, fallback.fetchedAt);
                wlState.loading = false;
                if (document.querySelector('.workload-view')) renderWorkloadAll();
            }
        }
        const [issuesResult, plansResult] = await Promise.allSettled([issuesPromise, plansPromise]);

        let payload = null;
        if (issuesResult.status === 'fulfilled') payload = issuesResult.value;
        else if (fallback && Array.isArray(fallback.issues)) {
            payload = { issues: fallback.issues, fetchedAt: fallback.fetchedAt, fromCache: true, usedFallback: true };
        } else if (Array.isArray(wlState.issueSnapshot) && wlState.issueSnapshot.length) {
            payload = { issues: wlState.issueSnapshot, fetchedAt: wlState.fetchedAt, fromCache: true, usedFallback: true };
        }
        if (!payload) throw issuesResult.reason || new Error('Failed to load issues from Linear.');

        // Fast first paint. Publish issue rows (NOT role-sensitive — the auth
        // branch below keeps them while withholding the private projections) and
        // drop the skeleton NOW, before the live-Linear weight sweep. Plans stay
        // gated behind the auth check (no early adoption — the fail-closed
        // contract is unchanged); planLoading places every item at the same
        // automatic estimate the post-plan board uses, so non-manually-planned
        // items don't move and only manually-planned items settle when plans
        // land. Weights show the one-unit fallback until the sweep resolves.
        /*
         * A REFUSED PLAN READ MUST NOT BE PAINTED OVER.
         *
         * The plan read has already settled here, so its refusal is knowable
         * before anything is drawn — and the skeleton dropping now would show
         * an estimated schedule, and on a warm refresh the private pins still
         * in memory, for as long as the metadata sweep takes (up to its
         * 20-second timeout) before the auth branch below purges them. The
         * fail-closed contract is that an auth denial withholds the private
         * projections, so the fast paint stands down and the skeleton holds
         * until that branch has run.
         */
        const planAuthRefused = plansResult.status === 'rejected'
            && (Number(plansResult.reason && plansResult.reason.status) === 401
                || Number(plansResult.reason && plansResult.reason.status) === 403);
        if (!planAuthRefused
            && typeof _wlFastPaintEnabled === 'function' && _wlFastPaintEnabled() && loadGeneration === _wlPlanLoadGeneration) {
            wlState.planLoading = true;
            fastPainted = true;
            wlApplyData(payload.issues, payload.fetchedAt);
            wlState.loading = false;
            if (document.querySelector('.workload-view')) {
                renderWorkloadAll();
            }
        }

        const [metadataResult] = await Promise.allSettled([wlFetchLinearMetadata(payload.issues)]);

        // Only the newest overlapping refresh may publish plan or issue state.
        // Older calls can still populate the shared HTTP cache, but they cannot
        // overwrite a newer saved-plan snapshot or downgrade its status.
        if (loadGeneration !== _wlPlanLoadGeneration) return null;
        // Plans/metadata have resolved (or failed): leave the fast-paint
        // loading estimate. A genuine failure now shows the honest deadline
        // fallback; success switches to authoritative auto/manual placement.
        wlState.planLoading = false;
        const foregroundFailures = [plansResult, metadataResult]
            .filter(result => result.status === 'rejected')
            .map(result => result.reason);
        const foregroundAuthFailure = foregroundFailures.find(error => Number(error && error.status) === 401)
            || foregroundFailures.find(error => Number(error && error.status) === 403)
            || null;
        if (foregroundAuthFailure) {
            if (metadataResult.status === 'rejected') {
                wlSanitizeFailedNativeMetadata(metadataResult.reason, payload.issues);
            }
            if (Number(foregroundAuthFailure.status) === 401) _syncviewStaffIdentityClear();
            else wlPurgePlanSensitiveState();
            // Issue rows are not role-sensitive. Keep the usable calendar,
            // but never publish either private projection after an auth denial.
            wlApplyData(payload.issues, payload.fetchedAt);
            return payload;
        }
        if (plansResult.status === 'fulfilled') wlAdoptPlanRows(plansResult.value);
        else wlMarkPlanReadFailure(plansResult.reason);
        if (metadataResult.status === 'fulfilled') wlAdoptLinearMetadata(metadataResult.value, payload.issues, payload.fetchedAt);
        else {
            wlMarkLinearMetadataFailure(metadataResult.reason, payload.issues);
            console.warn('[workload] Workload label metadata unavailable; using one unit per item', metadataResult.reason);
        }
        if (priorActiveSubIds && !payload.usedFallback) {
            const incoming = new Set((payload.issues || [])
                .filter(issue => issue && issue.isSubIssue)
                .map(issue => String(issue.id || '')));
            let missing = 0;
            let missingPinned = 0;
            for (const issueId of priorActiveSubIds) {
                if (incoming.has(issueId)) continue;
                missing++;
                if (wlState.planByIssueId.has(issueId)) missingPinned++;
            }
            wlState.refreshMissing = missing;
            wlState.refreshMissingPinned = missingPinned;
            if (missing > 0) wlDropCache();
        } else if (!force) {
            // An ordinary load reads the complete mirror, so it supersedes
            // whatever a short refresh reported.
            wlState.refreshMissing = 0;
            wlState.refreshMissingPinned = 0;
        }
        wlApplyData(payload.issues, payload.fetchedAt);
        // If this load fast-painted at automatic estimates, flag the items whose
        // authoritative day differs from that estimate so the next render can
        // animate only their bounded settle. Two sources: a manually planned
        // item whose saved day differs, and an automatic item the capacity pass
        // moved off a full day (that pass can only run once the plan snapshot
        // reveals which items are pinned, so it too lands after the fast paint).
        // Cleared and consumed by the settle pass in initWorkloadView.
        if (fastPainted && wlState.planHasSnapshot) {
            const moved = new Set();
            for (const issue of payload.issues || []) {
                if (!issue || !issue.isSubIssue) continue;
                const manual = wlPlanDate(issue);
                if (manual && manual !== wlAutoPlanDate(issue)) moved.add(String(issue.id || ''));
            }
            for (const issueId of wlState.autoPlacementByIssueId.keys()) moved.add(String(issueId));
            _wlSettleAnimIds = moved.size ? moved : null;
        }
        return payload;
    }

    // Entrance animation for the bounded set of manually planned items that
    // settle from their fast-paint estimate to their saved column. Runs after
    // the authoritative render; skipped under reduced-motion. Purely visual.
    function wlApplySettleAnimation() {
        const ids = _wlSettleAnimIds;
        _wlSettleAnimIds = null;
        if (!ids || !ids.size) return;
        try {
            if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        } catch {}
        try {
            document.querySelectorAll('.workload-view [data-wl-issue-id]').forEach(el => {
                if (!ids.has(el.getAttribute('data-wl-issue-id') || '')) return;
                el.classList.add('wl-settle-in');
                const done = () => { el.classList.remove('wl-settle-in'); el.removeEventListener('animationend', done); };
                el.addEventListener('animationend', done);
            });
        } catch {}
    }

    function wlAddDays(iso, n) {
        const d = wlParseISO(iso);
        d.setDate(d.getDate() + n);
        return wlISO(d.getFullYear(), d.getMonth(), d.getDate());
    }
    /* MEMOISED PURE HELPERS.
       Each of these is a pure function of its arguments and is called once per
       sub-issue (sometimes several times) inside the board's hot loops, so at
       live scale they dominate the boot. Profiled 2026-09-15 on a fixture at
       live shape (~1,700 sub-issues): wlFormatShort 942 ms of a 3.1 s render,
       wlNormalizeClient 157 ms and wlWorkloadTodayISO 85 ms of a 446 ms
       wlApplyData. The caches are keyed by the exact inputs, so the result is
       identical; they are cleared wholesale past a ceiling rather than grown
       without bound. */
    function wlFormatShort(iso) {
        const cache = wlFormatShort._cache || (wlFormatShort._cache = new Map());
        const key = String(iso);
        const hit = cache.get(key);
        if (hit !== undefined) return hit;
        const d = wlParseISO(iso);
        const out = d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
        if (cache.size > 4000) cache.clear();
        cache.set(key, out);
        return out;
    }
    function wlCalendarDayDiff(fromISO, toISO) {
        const parseUTC = (iso) => {
            const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
            return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : NaN;
        };
        const from = parseUTC(fromISO);
        const to = parseUTC(toISO);
        return Number.isFinite(from) && Number.isFinite(to)
            ? Math.round((to - from) / 86400000)
            : null;
    }
    // Signed WORKING-day difference from `fromISO` to `toISO` (Saturdays and
    // Sundays don't count), reusing the same weekend rule as wlAddWorkingDays /
    // wlSubWorkingDays. This is the buffer/proximity metric: a Friday plan with
    // a Monday due date is 1 working day of slack, not 3 calendar days. Grid
    // column positioning still uses wlCalendarDayDiff.
    function wlWorkingDayDiff(fromISO, toISO) {
        const valid = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''));
        if (!valid(fromISO) || !valid(toISO)) return null;
        if (fromISO === toISO) return 0;
        const dir = toISO > fromISO ? 1 : -1;
        const d = wlParseISO(fromISO);
        let count = 0;
        for (let guard = 0; guard < 4000; guard++) {
            d.setDate(d.getDate() + dir);
            const dow = d.getDay();
            if (dow !== 0 && dow !== 6) count += dir;
            if (wlISO(d.getFullYear(), d.getMonth(), d.getDate()) === toISO) break;
        }
        return count;
    }
    function wlValidRfc3339Timestamp(value) {
        if (typeof value !== 'string' || value.trim() !== value) return false;
        const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
        if (!match) return false;
        const parts = match.slice(1, 7).map(Number);
        const calendar = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
        return calendar.getUTCFullYear() === parts[0]
            && calendar.getUTCMonth() === parts[1] - 1
            && calendar.getUTCDate() === parts[2]
            && parts[3] <= 23 && parts[4] <= 59 && parts[5] <= 59
            && Number.isFinite(Date.parse(value));
    }
    function wlPlacementLabel(mode) {
        return ({ auto: 'Automatically planned', manual: 'Manually planned', mixed: 'Mixed planning', fallback: 'Deadline fallback', loading: 'Planning…' })[mode] || '';
    }
    function wlPlanOriginHtml(mode, compact, count, tipDetail) {
        const label = wlPlacementLabel(mode);
        if (!label) return '';
        let icon;
        if (mode === 'manual') {
            icon = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.2 2.2h5.6l-.8 3 1.7 1.7v1.3H8.7v5.2L8 14l-.7-.6V8.2H4.3V6.9L6 5.2l-.8-3Z" fill="currentColor"/></svg>';
        } else if (mode === 'loading') {
            icon = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5a5.5 5.5 0 1 0 5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
        } else if (mode === 'fallback') {
            icon = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.2h10v9.6H3zM3 6h10M5.5 1.8v2.8M10.5 1.8v2.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 8v2.1M8 11.8h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
        } else {
            icon = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m8 1 .8 2.2L11 4l-2.2.8L8 7l-.8-2.2L5 4l2.2-.8L8 1Zm4.2 6 .55 1.45L14.2 9l-1.45.55L12.2 11l-.55-1.45L10.2 9l1.45-.55L12.2 7ZM4.5 8l.85 2.15L7.5 11l-2.15.85L4.5 14l-.85-2.15L1.5 11l2.15-.85L4.5 8Z" fill="currentColor"/></svg>';
        }
        const amount = Number(count) > 0 ? ` <span class="wl-plan-origin-count">${Number(count)}</span>` : '';
        const accessible = Number(count) > 0 ? `${Number(count)} ${label.toLowerCase()}` : label;
        const tip = mode === 'manual'
            ? 'Manual plan: stays on this work day until someone changes or clears it.'
            : (mode === 'loading'
                ? 'Loading saved plans… showing an automatic estimate from the due date; only manually planned items will settle when plans arrive.'
                : (mode === 'fallback'
                    ? 'Deadline fallback: no plan day is saved, so this uses the due date.'
                    : (String(tipDetail || '')
                        || 'Automatic plan: the earliest working day with room, never later than one working day before the deadline. Drag it to pin it somewhere else.')));
        return `<span class="wl-plan-origin is-${wlEscape(mode)}" role="img" aria-label="${wlEscape(accessible)}" data-tip="${wlEscape(tip)}">${icon}${amount}</span>`;
    }
    function wlGroupPlacementMode(subs) {
        const modes = new Set((subs || []).map(wlPlacementMode).filter(mode => mode !== 'none'));
        if (!modes.size) return 'none';
        if (modes.size === 1) return [...modes][0];
        return 'mixed';
    }
    function wlGroupPlanOriginHtml(subs) {
        const counts = { auto: 0, manual: 0, fallback: 0, loading: 0 };
        for (const sub of subs || []) {
            const mode = wlPlacementMode(sub);
            if (Object.prototype.hasOwnProperty.call(counts, mode)) counts[mode]++;
        }
        const present = Object.entries(counts).filter(([, count]) => count > 0);
        if (present.length === 1) return wlPlanOriginHtml(present[0][0], true, 0);
        return present.map(([mode, count]) => wlPlanOriginHtml(mode, true, count)).join('');
    }
    function wlDeadlineMeta(dueDate, planDate, prefix) {
        const due = String(dueDate || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) {
            return { tone: '', days: null, label: 'No deadline' };
        }
        const plan = String(planDate || '').slice(0, 10);
        const lead = prefix || 'Due';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(plan)) {
            return { tone: '', days: null, label: lead + ' ' + wlFormatShort(due) };
        }
        const days = wlWorkingDayDiff(plan, due);
        if (days === null) return { tone: '', days, label: lead + ' ' + wlFormatShort(due) };
        const tone = days <= 0 ? 'red' : (days <= 2 ? 'orange' : 'green');
        let label;
        if (days < 0) label = `${lead} ${wlFormatShort(due)} · plan ${Math.abs(days)}d late`;
        else if (days === 0) label = `${lead} ${wlFormatShort(due)} · same day`;
        else label = `${lead} ${wlFormatShort(due)} · ${days}d buffer`;
        return { tone, days, label };
    }
    function wlDeadlineTagHtml(dueDate, planDate, prefix) {
        const meta = wlDeadlineMeta(dueDate, planDate, prefix);
        const meanings = {
            red: 'Red: planned on or after the due date.',
            orange: 'Orange: one or two days between the work day and due date.',
            green: 'Green: three or more days between the work day and due date.',
        };
        const tip = [meanings[meta.tone] || '', meta.label].filter(Boolean).join(' ');
        return `<span class="wl-deadline-tag${meta.tone ? ' is-' + meta.tone : ''}" data-tip="${wlEscape(tip)}">${wlEscape(meta.label)}</span>`;
    }
    function wlDeadlineDotHtml() {
        return '<span class="wl-deadline-dot" aria-hidden="true"></span>';
    }
    function wlGroupDeadlineSummary(subs) {
        const rows = Array.isArray(subs) ? subs : [];
        if (!rows.length) return { tone: '', mixed: false, label: '', counts: {} };
        const counts = { red: 0, orange: 0, green: 0, missing: 0 };
        for (const sub of rows) {
            const due = String(sub && sub.dueDate || '').slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) { counts.missing++; continue; }
            const tone = wlDeadlineMeta(due, wlDisplayDate(sub)).tone;
            if (tone) counts[tone]++;
            else counts.missing++;
        }
        const tones = ['red', 'orange', 'green'].filter(tone => counts[tone] > 0);
        if (counts.missing === 0 && tones.length === 1) {
            const labels = { red: 'planned on or after the due date', orange: 'with 1–2d buffer', green: 'with 3d or more buffer' };
            return { tone: tones[0], mixed: false, label: `All ${rows.length} ${labels[tones[0]]}`, counts };
        }
        const parts = [];
        if (counts.red) parts.push(`${counts.red} planned on or after the due date`);
        if (counts.orange) parts.push(`${counts.orange} with 1–2d buffer`);
        if (counts.green) parts.push(`${counts.green} with 3d or more buffer`);
        if (counts.missing) parts.push(`${counts.missing} without a deadline`);
        return { tone: '', mixed: true, label: `Mixed deadline proximity: ${parts.join(', ')}`, counts };
    }
    function wlGroupDeadlineHtml(subs) {
        const meta = wlGroupDeadlineSummary(subs);
        if (!meta.label || !meta.tone) return '';
        const toneLabel = ({ red: 'Red proximity', orange: 'Orange proximity', green: 'Green proximity' })[meta.tone] || 'Deadline proximity';
        const tip = `${toneLabel}: ${meta.label}.`;
        return `<span class="wl-deadline-summary is-${meta.tone}" role="img" aria-label="${wlEscape(meta.label)}" data-tip="${wlEscape(tip)}">${wlDeadlineDotHtml()}</span>`;
    }
    function wlDragGripSvg() {
        return '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="6" cy="4" r="1.4"/><circle cx="10" cy="4" r="1.4"/><circle cx="6" cy="8" r="1.4"/><circle cx="10" cy="8" r="1.4"/><circle cx="6" cy="12" r="1.4"/><circle cx="10" cy="12" r="1.4"/></svg>';
    }
    function wlIssueDragHandleHtml(issueId, canDrag) {
        if (!canDrag) return '';
        return `<span class="workload-drag-handle workload-plan-drag-handle" draggable="true" data-wl-drag-handle="issue" data-wl-plan-drag="${wlEscape(issueId)}" role="img" aria-label="Drag to another work day" data-tip="Drag this sub-issue to another work day.">${wlDragGripSvg()}</span>`;
    }
    function wlGroupDragHandleHtml(dayISO, assigneeId, clientName, canDrag) {
        if (!canDrag) return '';
        return `<span class="workload-drag-handle workload-plan-drag-handle" draggable="true" data-wl-drag-handle="group" data-wl-plan-group-drag="1" data-wl-date="${wlEscape(dayISO || '')}" data-wl-assignee-id="${wlEscape(assigneeId || '')}" data-wl-client="${wlEscape(clientName || '')}" role="img" aria-label="Drag this client group to another work day" data-tip="Drag this entire client group to another work day.">${wlDragGripSvg()}</span>`;
    }
    function wlWorkloadMeta(sub) {
        if (wlTeamBucket(sub && sub.teamKey, sub && sub.teamName) !== 'video') return null;
        return wlState.workloadByIssueId.get(String(sub && sub.id || '')) || null;
    }
    function wlWorkloadWeight(sub) {
        const meta = wlWorkloadMeta(sub);          // one lookup, not two
        const weight = Number(meta && meta.weight);
        return weight === 2 || weight === 3 ? weight : 1;
    }
    function wlWorkloadUnits(subs) {
        return (subs || []).reduce((total, sub) => total + wlWorkloadWeight(sub), 0);
    }
    function wlWorkloadBadgeHtml(sub, compact) {
        const meta = wlWorkloadMeta(sub);
        if (!meta) return '';
        const color = /^#[0-9a-f]{6}$/i.test(String(meta.color || '')) ? ` style="--wl-weight-color:${meta.color}"` : '';
        const text = compact ? `${meta.weight}×` : meta.label;
        const label = `${meta.label}; counts as ${meta.weight} videos for capacity`;
        return `<span class="wl-workload-badge" role="img" aria-label="${wlEscape(label)}" data-tip="${wlEscape(label)}"${color}>${wlEscape(text)}</span>`;
    }
    function wlGroupWorkloadHtml(subs) {
        const rows = Array.isArray(subs) ? subs : [];
        const counts = { 2: 0, 3: 0 };
        for (const sub of rows) {
            const weight = wlWorkloadWeight(sub);
            if (weight === 2 || weight === 3) counts[weight]++;
        }
        const extraCount = counts[2] + counts[3];
        if (!extraCount) return '';
        const allExtra = extraCount === rows.length;
        const details = [2, 3].filter(weight => counts[weight]).map(weight =>
            `${counts[weight]} at ${weight}× Workload`
        ).join(', ');
        const label = `${allExtra ? 'All' : 'Some'} sub-issues use extra workload: ${details}. Capacity totals use these weights.`;
        const icon = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m2.5 5 5.5-2.7L13.5 5 8 7.8 2.5 5Zm0 3L8 10.8 13.5 8M2.5 11 8 13.7l5.5-2.7" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        return `<span class="wl-workload-group is-${allExtra ? 'all' : 'some'}" role="img" aria-label="${wlEscape(label)}" data-tip="${wlEscape(label)}">${icon}</span>`;
    }
    function wlGroupProximityDays(subs, planDate) {
        let closest = Infinity;
        for (const sub of subs || []) {
            const due = String(sub && sub.dueDate || '').slice(0, 10);
            const plan = String(planDate || wlDisplayDate(sub) || '').slice(0, 10);
            const days = wlWorkingDayDiff(plan, due);
            if (days !== null && days < closest) closest = days;
        }
        return closest;
    }
    function wlCompareClientGroups(a, b, planDate) {
        const aDays = wlGroupProximityDays(a && a.subs, planDate);
        const bDays = wlGroupProximityDays(b && b.subs, planDate);
        if (aDays !== bDays) return aDays === Infinity ? 1 : (bDays === Infinity ? -1 : aDays - bDays);
        return String(a && a.clientName || '').localeCompare(String(b && b.clientName || ''));
    }

    // Status classification — user rule:
    //   Workload only shows work the editor still owns. Anything parked on
    //   someone else (Tweaks Applied, awaiting SMM/Kasper/Client approval,
    //   Approved, Posted) is hidden, along with completed/canceled/triage
    //   workflow types. Everything else (To Do, In Progress, Tweaks Needed,
    //   plus any active status not explicitly parked) is shown.
    //   "Right now" = status name is literally "In Progress".
    const WL_PARKED_STATUSES = new Set([
        'tweak applied', 'tweaks applied',
        'for smm approval', 'waiting for smm approval', 'smm approval',
        'for casper approval', 'waiting for casper approval', 'casper approval',
        'for kasper approval', 'waiting for kasper approval', 'kasper approval',
        'for client approval', 'waiting for client approval', 'client approval',
        'approved',
        'posted'
    ]);
    function wlNormStatus(sub) {
        return (sub.status || '').trim().toLowerCase();
    }
    function wlIsActiveStatus(sub) {
        const t = (sub.statusType || '').toLowerCase();
        // `duplicate` is terminal everywhere else in this file -- _prodIsDone
        // lists it beside completed and canceled -- but Workload used to omit
        // it, so a Linear issue marked Duplicate stayed live here: it kept its
        // assignee, kept its due date, and took up that designer's capacity for
        // work that is closed by definition. Found 2026-08-22 by the F40 gate,
        // which counted GRA-7101 (Duplicate, due 2026-08-17, assigned) as a row
        // that would lose its deadline at the flip -- a deadline nobody wanted.
        if (t === 'completed' || t === 'canceled' || t === 'duplicate' || t === 'triage') return false;
        // OWNER RULING 2026-08-23: Backlog is not work anyone is holding, so it
        // has no place on this page. It used to pass as live work, which is why
        // 681 of the 1,073 rows on Workload were parked: 618 active Backlog
        // sub-issues, 273 of them assigned to somebody, each taking a slice of
        // that person's daily capacity for work nobody had started.
        //
        // Keyed on the Linear workflow-state TYPE, never the column's name, so
        // Todo (type `unstarted`, 254 live rows) stays live work and a
        // backlog-type column renamed to anything else is still caught.
        //
        // KNOWN COST, accepted with the ruling. `workload_issues.status_type`
        // has exactly one writer, the Linear-derived reconcile, and graphics has
        // been SyncView-authoritative since 2026-08-16 -- a Linear status edit
        // on a graphics issue is recorded and deliberately not applied. So a row
        // whose deliverable says `todo` while its Linear mirror says Backlog now
        // leaves this page while the Production tab still renders it live. The
        // 2026-08-20 census put that class at 7 rows (one real client, one
        // unattributed, five TEST) and the owner ruled to leave them:
        // docs/ops/OPEN_REPAIRS.md item 22. Nothing reconciles the two stores,
        // so that class does not heal on its own -- if it grows, this filter is
        // where it goes quiet.
        // A test client's Backlog counts only in a browser that opted in to
        // test clients (wlTestClientsMode): it is the only open work the test
        // client has, and real clients are never affected.
        if (t === 'backlog' && sub.wlTestShown !== true) return false;
        return !WL_PARKED_STATUSES.has(wlNormStatus(sub));
    }
    function wlIsInProgress(sub) {
        return wlNormStatus(sub) === 'in progress';
    }
    function wlIsTweaksNeeded(sub) {
        // Linear's actual status is "Tweak Needed" (singular). We match the
        // plural form too in case the status name gets renamed later — same
        // defensive pattern as the "tweak applied" / "tweaks applied" entry
        // in WL_PARKED_STATUSES.
        const s = wlNormStatus(sub);
        return s === 'tweak needed' || s === 'tweaks needed';
    }
    function wlIsToDo(sub) {
        const s = wlNormStatus(sub);
        return s === 'to do' || s === 'todo';
    }


    // Editors who have left the team. This shared exclusion is applied to both
    // Workload's local roster and the Kasper Editors response, so historical or
    // cached Linear activity cannot put a former editor back in either view.
    const WL_INACTIVE_EDITOR_IDS = new Set([
        '6b70f1d8-f73e-4222-9a59-944b86da2cc9', // Martin
    ]);
    const WL_INACTIVE_EDITORS = new Set([
        'martin',
        'martinsynchro',
    ]);

    // Legacy cached-row fallback only. Fresh authenticated snapshots carry exact
    // active-role membership from team_members; these tokens preserve the
    // previous rollback behavior when an older cached row lacks that field.
    // Each entry is a normalised name token — wlNormalizeEditor() collapses
    // emails, accented names and "First Last"/"Last First" into the same key.
    const WL_ALLOWED_EDITORS = new Set([
        'iaramiraille',
        'espindolanahuel',
        'nahuelespindola',
        'santigimelli',
        'gimellisanti',
        'davidstrutt',
        'struttdavid',
    ]);
    const WL_ALLOWED_GRAPHICS = new Set([
        'rocioperez',
        'perezrocio',
    ]);
    function wlNormalizeEditor(s) {
        if (!s) return '';
        const cache = wlNormalizeEditor._cache || (wlNormalizeEditor._cache = new Map());
        const cacheKey = String(s);
        const cached = cache.get(cacheKey);
        if (cached !== undefined) return cached;
        const lower = String(s).trim().toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, ''); // strip accents
        const local = lower.includes('@') ? lower.split('@')[0] : lower;
        const out = local.replace(/[\s._\-]+/g, '');
        if (cache.size > 4000) cache.clear();
        cache.set(cacheKey, out);
        return out;
    }
    function wlIsInactiveEditor(id, name) {
        return WL_INACTIVE_EDITOR_IDS.has(String(id || '').trim()) ||
            WL_INACTIVE_EDITORS.has(wlNormalizeEditor(name));
    }
    function wlIsAllowedEditor(name, teamKey, teamName) {
        if (!name) return false;
        const norm = wlNormalizeEditor(name);
        if (WL_INACTIVE_EDITORS.has(norm)) return false;
        if (wlTeamBucket(teamKey, teamName) === 'graphics') {
            return WL_ALLOWED_GRAPHICS.has(norm);
        }
        return WL_ALLOWED_EDITORS.has(norm);
    }

    function wlPlanDate(sub) {
        return String(wlState.planByIssueId.get(String(sub && sub.id || '')) || '').slice(0, 10);
    }
    function wlAutoPlanDate(sub, todayISO) {
        const dueDate = String(sub && sub.dueDate || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return '';
        const today = String(todayISO || wlWorkloadTodayISO()).slice(0, 10);
        const suggested = wlSubWorkingDays(dueDate, 1);
        return suggested < today ? today : suggested;
    }
    function wlAutoPlacementDate(sub) {
        const placed = String(wlState.autoPlacementByIssueId.get(String(sub && sub.id || '')) || '').slice(0, 10);
        if (!placed) return '';
        // The map is computed once per wlApplyData, but every read outlives it.
        // wlAutoPlanDate re-floors to today on EVERY read, which is what makes
        // an automatic card structurally unable to render in the past; a stored
        // capacity move has to honour the same floor or an open tab crossing
        // midnight would paint a card on a past day — dropping it out of the
        // visible Mon–Fri work week, and contradicting the rule that unpinned
        // overdue work leaves the calendar. An entry that has gone stale is
        // ignored, so the card falls back to its (re-floored) ideal day until
        // the next snapshot recomputes placement.
        return placed >= wlWorkloadTodayISO() ? placed : '';
    }
    function wlPlacementMode(sub) {
        if (wlPlanDate(sub)) return 'manual';
        if (!String(sub && sub.dueDate || '').slice(0, 10)) return 'none';
        // Only call a derived day "automatic" after the role-gated sidecar
        // answered authoritatively. While plans are still loading (fast first
        // paint) we place at the same automatic estimate so never-manually-
        // planned items don't move, but label it "Planning…" — honest that a
        // hidden manual override may still settle. A genuine failure (not
        // loading, no snapshot) keeps the "Deadline fallback" (raw due date).
        if (wlState.planHasSnapshot) {
            /* ONE automatic state (owner ruling 2026-09-14).
             *
             * There used to be a second mode, `shifted`, for an automatic card
             * not sitting on its ideal day. Under the late-as-possible rule
             * that meant something had gone wrong — capacity had pushed the
             * card off the day it should have had. Under earliest-fit every
             * automatic card takes the earliest day with room, so the mode
             * only separated "the earliest day with room happened to BE the
             * last possible day" from "it was earlier": a fact nobody acts on,
             * shown as two different icons. The owner asked for one. */
            return 'auto';
        }
        return wlState.planLoading ? 'loading' : 'fallback';
    }
    function wlDisplayDate(sub) {
        const manual = wlPlanDate(sub);
        if (manual) return manual;
        const dueDate = String(sub && sub.dueDate || '').slice(0, 10);
        if (!dueDate) return '';
        // During the fast first paint (planLoading) place at the same
        // automatic estimate the post-plan board uses, so non-manually-planned
        // items land in their final column and never shift when plans arrive.
        // A genuine plan-read failure still shows the raw due date.
        if (!(wlState.planHasSnapshot || wlState.planLoading)) return dueDate;
        return wlAutoPlacementDate(sub) || wlAutoPlanDate(sub);
    }
    /* The per-item automatic detail: where it landed and the latest day it
       could have sat on. The compact/group icon has no single item to name and
       falls back to the generic sentence in wlPlanOriginHtml. */
    function wlAutoPlacementTip(sub) {
        const ideal = wlAutoPlanDate(sub);
        const placed = wlAutoPlacementDate(sub) || ideal;
        if (!ideal || !placed) return '';
        const capacity = wlEditorCapacity(sub && sub.teamKey, sub && sub.teamName);
        /* The last day this card may sit on is normally one working day before
           the deadline — but wlAutoPlanDate floors that to today for an item
           due today or already overdue, and calling THAT "one working day
           before the deadline" is simply false. */
        const natural = String(sub && sub.dueDate || '').slice(0, 10)
            ? wlSubWorkingDays(String(sub.dueDate).slice(0, 10), 1)
            : '';
        const latest = natural && natural < ideal
            ? `${wlFormatShort(ideal)}, today — its deadline has passed or is today`
            : `${wlFormatShort(ideal)}, one working day before the deadline`;
        /* A saturated window does not mean the card found room: the pass falls
           back to the ideal day and the editor/day keeps the over-capacity
           badge. Saying "the earliest day with room" there would be confidently
           wrong about the one case the badge exists to flag. */
        const sameDay = typeof wlDayOverCapacity === 'function'
            && wlState.calendarByDate instanceof Map
            ? (wlState.calendarByDate.get(placed) || []).filter(row =>
                wlCapacityKey(row) === wlCapacityKey(sub))
            : null;
        if (placed === ideal && sameDay && sameDay.length && wlDayOverCapacity(sameDay)) {
            return `Automatic plan: ${wlFormatShort(placed)} — no working day between today and ${latest} had room, so it sits on the last day it can and that day is over this editor's ${capacity}-unit capacity. Drag it to pin it somewhere else.`;
        }
        if (placed === ideal) {
            return `Automatic plan: ${wlFormatShort(placed)} — the earliest working day with room, and also the latest it can sit on: ${latest}. Drag it to pin it somewhere else.`;
        }
        return `Automatic plan: ${wlFormatShort(placed)} — the earliest working day with room. It only moves later when a day is already at this editor's ${capacity}-unit daily capacity, and never past ${latest}. Drag it to pin it somewhere else.`;
    }

    // Automatic placement is capacity-aware (owner ruling 2026-08-10, from
    // Raha's overload report). The rules, in order:
    //
    //   1. A manual `plan_date` is ABSOLUTE. Pins hold their exact day and
    //      reserve their units first — even when the pins alone put the editor
    //      over capacity. A person's deliberate placement is never moved by
    //      this pass, only automatic work yields around it.
    //   2. Every remaining item is placed as EARLY as it fits (owner ruling
    //      2026-09-14): it starts at TODAY and walks FORWARD over working days
    //      to the first day where that editor still has room. Capacity is the
    //      only thing that pushes a card later — an editor with a free day
    //      earlier in the week gets the work on that day, not the day before
    //      the deadline.
    //   3. It never walks PAST the ideal day (one working day before the
    //      deadline, floored to today). Beyond that the item would be
    //      silently late, which is strictly worse than a visible overload.
    //   4. When nothing in the today→ideal window has room, the item lands on
    //      its ideal day and that editor/day keeps the red over-capacity
    //      badge. That badge means genuine oversubscription — more work than
    //      the window can hold — which only a person can resolve by
    //      reassigning or renegotiating a deadline.
    //
    // This replaced a late-as-possible pass (2026-08-10 → 2026-09-14), which
    // only ever moved work EARLIER to relieve an over-capacity day. It left
    // four videos due Friday stacked on Thursday, exactly at the cap, while
    // Wednesday sat nearly empty — technically within capacity, and not what
    // anyone would plan by hand.
    //
    // The pass replaced the previous strictly item-local rule, which let an
    // automatic card land on a day a pin (or six other automatic cards) had
    // already filled. It runs on the UNFILTERED planned set, so the team /
    // editor / client filters can never change where a card sits. Nothing is
    // written: `workload_plan` still holds deliberate manual overrides only,
    // and every placement is re-derived from (issues, plans, weights, today).
    const WL_PLACEMENT_WALK_LIMIT = 260;       // ~one working year; bounds the forward walk
    const WL_RESHUFFLE_MAX_CANDIDATES = 6;     // cards on one day the reshuffle will consider
    const WL_RESHUFFLE_MAX_EVICTIONS = 3;      // how many of them it may move at once
    function wlCapacityKey(sub) {
        return (sub && sub.assigneeId || '?') + '|' + wlTeamBucket(sub && sub.teamKey, sub && sub.teamName);
    }
    function wlComputeAutoPlacements(plannedSubs, todayISO) {
        const today = String(todayISO || wlWorkloadTodayISO()).slice(0, 10);
        let placements = new Map();
        let used = new Map();                  // `${capacityKey}@${day}` -> workload units already committed
        /* THE THREE FACTS THIS PASS ASKS ABOUT A SUB-ISSUE, ANSWERED ONCE.
           Its capacity key, its workload weight and its editor's daily capacity
           do not change while the pass runs, but `fits`, `reserve`, `release`
           and `slotOf` recomputed all three on every call -- and they are
           called once per candidate day, per eviction set, per entry. That made
           wlTeamBucket alone 37% of a 67 s settle pass at live shape (profiled
           2026-09-15), reached through wlCapacityKey, wlWorkloadWeight and
           wlEditorCapacity. The map is keyed by the sub-issue object and lives
           only for this call, so a later pass still sees fresh metadata. */
        const subFacts = new Map();
        const factsOf = (sub) => {
            let facts = subFacts.get(sub);
            if (!facts) {
                facts = {
                    key: wlCapacityKey(sub),
                    weight: wlWorkloadWeight(sub),
                    capacity: wlEditorCapacity(sub && sub.teamKey, sub && sub.teamName),
                };
                subFacts.set(sub, facts);
            }
            return facts;
        };
        const slotOf = (sub, day) => factsOf(sub).key + '@' + day;
        const reserve = (sub, day) => {
            const facts = factsOf(sub);
            const slot = facts.key + '@' + day;
            used.set(slot, (used.get(slot) || 0) + facts.weight);
        };
        const fits = (sub, day) => {
            const facts = factsOf(sub);
            return (used.get(facts.key + '@' + day) || 0) + facts.weight <= facts.capacity;
        };

        const automatic = [];
        for (const sub of plannedSubs || []) {
            const manual = wlPlanDate(sub);
            if (manual) { reserve(sub, manual); continue; }
            const ideal = wlAutoPlanDate(sub, today);
            if (!ideal) continue;
            automatic.push({ sub, ideal });
        }
        // Tightest deadline first, so the least flexible item claims its day
        // before a later one can take that slot; heavier first within a day,
        // because a 3-unit item needs a bigger hole than three 1-unit items
        // and would otherwise be the one left stranded. Identifier then id
        // keep the result deterministic for the same snapshot.
        automatic.sort((a, b) => {
            if (a.ideal !== b.ideal) return a.ideal < b.ideal ? -1 : 1;
            const weightOrder = wlWorkloadWeight(b.sub) - wlWorkloadWeight(a.sub);
            if (weightOrder) return weightOrder;
            const identifierOrder = String(a.sub && a.sub.identifier || '')
                .localeCompare(String(b.sub && b.sub.identifier || ''), undefined, { numeric: true });
            if (identifierOrder) return identifierOrder;
            return String(a.sub && a.sub.id || '').localeCompare(String(b.sub && b.sub.id || ''));
        });

        // The window every item is confined to: the first WORKING day from
        // today (a bare `today` put ordinary work on a Saturday whenever the
        // policy day was a weekend) through its own ideal day. `ideal` is
        // floored to today, so a card due now, due tomorrow, or already
        // overdue keeps a one-day window and simply lands on today.
        const windowStart = wlIsWorkingDay(today) ? today : wlAddWorkingDays(today, 1);
        // `skipDay` is the day being cleared during a reshuffle: the evicted
        // item must not simply re-take the hole it just left, which is exactly
        // what it would do, that day now being the earliest one with room.
        const firstFit = (sub, ideal, skipDay) => {
            let day = windowStart;
            for (let guard = 0; guard < WL_PLACEMENT_WALK_LIMIT && day <= ideal; guard++) {
                if (day !== skipDay && fits(sub, day)) return day;
                day = wlAddWorkingDays(day, 1);
            }
            return '';
        };
        let placedOn = new Map();              // entry -> the day it currently holds
        /* AND THE SAME ENTRIES BY SLOT.
           `reshuffleFor` needs the entries already sitting on one capacity key
           on one day. It used to find them by scanning every placed entry, for
           every candidate day (up to WL_PLACEMENT_WALK_LIMIT), for every entry
           being settled -- O(n²) in the size of the board, which is why the
           settle pass took 105 s on a fixture at live shape and would only get
           worse as the board grows (profiled 2026-09-15). This index is that
           same set, kept in step by recordDay, and the filter it replaces was
           exactly `same capacity key AND same day`, which is what slotOf is. */
        let placedBySlot = new Map();          // `${capacityKey}@${day}` -> Set of entries
        const release = (sub, day) => {
            const facts = factsOf(sub);
            const slot = facts.key + '@' + day;
            used.set(slot, Math.max(0, (used.get(slot) || 0) - facts.weight));
        };
        const recordDay = (entry, day) => {
            const id = String(entry.sub && entry.sub.id || '');
            const previousDay = placedOn.get(entry);
            if (previousDay !== undefined) {
                const previousSlot = slotOf(entry.sub, previousDay);
                const previousBucket = placedBySlot.get(previousSlot);
                if (previousBucket) {
                    previousBucket.delete(entry);
                    if (!previousBucket.size) placedBySlot.delete(previousSlot);
                }
            }
            placedOn.set(entry, day);
            const slot = slotOf(entry.sub, day);
            let bucket = placedBySlot.get(slot);
            if (!bucket) { bucket = new Set(); placedBySlot.set(slot, bucket); }
            bucket.add(entry);
            // Only a genuine move is recorded: an item on its ideal day stays a
            // plain "auto" and keeps deriving its day from wlAutoPlanDate.
            if (day === entry.ideal) placements.delete(id);
            else placements.set(id, day);
        };

        /*
         * LAST-RESORT RESHUFFLE (owner ruling 2026-09-14, on Codex's finding).
         *
         * Placing one item at a time and never revisiting a choice can
         * manufacture an overload that a different order would have avoided:
         * with pins of 1/2/2 on Mon/Tue/Wed, a 2-unit item due Wednesday takes
         * Monday, and a 3-unit item due Thursday then fits nowhere and lands on
         * Wednesday at 5/4 — although 3 on Monday and 2 on Tuesday fits both
         * exactly. The red badge would be describing the pass, not the week.
         *
         * The owner's worry about fixing that was churn: work already planned
         * jumping around every time a sub-issue arrives. So this runs ONLY when
         * an item would otherwise land over capacity, and it is bounded on
         * every side:
         *   - nothing moves unless it actually clears the overload;
         *   - only automatic items already placed IN this item's own window
         *     move, so nothing outside today→its ideal day is touched, and
         *     never another editor's day (the capacity key includes assignee
         *     and team);
         *   - a manual pin is never a candidate — it is absolute here as
         *     everywhere else;
         *   - an evicted item must land inside ITS OWN window, so nothing is
         *     pushed past its own deadline to make room;
         *   - one level deep: an evicted item re-places by ordinary first fit
         *     and may not evict anyone in turn, which bounds the work and stops
         *     a cascade of knock-on moves;
         *   - the smallest displacement that works wins (fewest cards, then
         *     least weight), so a fit costs one moved card rather than five.
         * When no such rearrangement exists the item keeps its ideal day and
         * the honest over-capacity badge.
         *
         * SETS, not a greedy sweep. Taking candidates one at a time cheapest
         * first spends the relocation room the heavier card needed: Monday
         * holding a 2 and a 1, Tuesday pinned at 2, and the 1 moves into
         * Tuesday's only hole, so the 2 has nowhere to go and the whole repair
         * rolls back — although moving just the 2 to Tuesday fits everything.
         * So each day's candidates are tried as SETS, smallest first, and the
         * first set that works wins. The search is bounded by
         * WL_RESHUFFLE_MAX_CANDIDATES and WL_RESHUFFLE_MAX_EVICTIONS.
         */
        const evictionSets = (candidates) => {
            const pool = candidates.slice(0, WL_RESHUFFLE_MAX_CANDIDATES);
            const sets = [];
            const build = (startAt, chosen) => {
                if (chosen.length) sets.push(chosen.slice());
                if (chosen.length >= WL_RESHUFFLE_MAX_EVICTIONS) return;
                for (let i = startAt; i < pool.length; i++) {
                    chosen.push(pool[i]);
                    build(i + 1, chosen);
                    chosen.pop();
                }
            };
            build(0, []);
            // Fewest cards moved first, then least total weight: the least
            // disturbance to a board somebody is already working from.
            const weightOf = (set) => set.reduce((sum, other) => sum + factsOf(other.sub).weight, 0);
            sets.sort((a, b) => a.length - b.length || weightOf(a) - weightOf(b));
            return sets;
        };
        const reshuffleFor = (entry) => {
            let day = windowStart;
            for (let guard = 0; guard < WL_PLACEMENT_WALK_LIMIT && day <= entry.ideal; guard++) {
                const bucket = placedBySlot.get(slotOf(entry.sub, day));
                const candidates = bucket ? [...bucket] : [];
                candidates.sort((a, b) => factsOf(a.sub).weight - factsOf(b.sub).weight
                    || String(a.sub && a.sub.id || '').localeCompare(String(b.sub && b.sub.id || '')));
                for (const set of evictionSets(candidates)) {
                    const moves = [];
                    for (const other of set) release(other.sub, day);
                    // Heaviest first: the hardest card to re-place claims the
                    // remaining room before a lighter one can take it.
                    const ordered = set.slice().sort((a, b) => factsOf(b.sub).weight - factsOf(a.sub).weight);
                    let ok = true;
                    for (const other of ordered) {
                        const moved = firstFit(other.sub, other.ideal, day);
                        if (!moved) { ok = false; break; }
                        reserve(other.sub, moved);
                        moves.push({ other, to: moved });
                    }
                    if (ok && fits(entry.sub, day)) {
                        for (const move of moves) recordDay(move.other, move.to);
                        return day;
                    }
                    // Undo this set exactly before trying the next one.
                    for (const move of moves) release(move.other.sub, move.to);
                    for (const other of set) reserve(other.sub, day);
                }
                day = wlAddWorkingDays(day, 1);
            }
            return '';
        };

        const settle = (entry) => {
            const finalDay = firstFit(entry.sub, entry.ideal) || reshuffleFor(entry) || entry.ideal;
            reserve(entry.sub, finalDay);
            recordDay(entry, finalDay);
        };

        /*
         * INCUMBENTS FIRST (owner condition, 2026-09-14).
         *
         * Every placement is re-derived from scratch on each snapshot, so
         * "nothing moves unless it clears an overload" is not enough on its
         * own: a newcomer sorted ahead of settled work rearranges the board
         * without the reshuffle ever running. Four 1-unit cards sharing Monday
         * plus one arriving 3-unit card with the same deadline sorts the
         * newcomer first, which takes Monday and pushes three incumbents to
         * Tuesday — when the newcomer could simply have taken Tuesday alone.
         *
         * So the day an item held in the LAST pass is treated as a soft pin: if
         * it is still inside that item's window and still fits, it is reserved
         * before any new item is placed. It is soft — the reshuffle may still
         * evict it as a last resort, and an anchor that no longer fits (a new
         * manual pin took the room, the day fell behind today, the deadline
         * moved) is dropped and that item re-placed like any other. On a first
         * load there are no anchors and the pass is pure earliest-fit.
         *
         * This is in-memory only, derived from the previous pass, and is
         * cleared with the pins it ultimately derives from: nothing about it is
         * persisted or read back from a server.
         */
        const previous = wlState.autoPlacementSettled instanceof Map ? wlState.autoPlacementSettled : new Map();
        const plan = (useAnchors) => {
        placements = new Map();
        used = new Map();
        placedOn = new Map();
        placedBySlot = new Map();
        for (const sub of plannedSubs || []) {
            const manual = wlPlanDate(sub);
            if (manual) reserve(sub, manual);
        }
        const unanchored = [];
        for (const entry of automatic) {
            const anchor = useAnchors ? String(previous.get(String(entry.sub && entry.sub.id || '')) || '') : '';
            if (!anchor || anchor < windowStart || anchor > entry.ideal || !wlIsWorkingDay(anchor) || !fits(entry.sub, anchor)) {
                unanchored.push(entry);
                continue;
            }
            reserve(entry.sub, anchor);
            recordDay(entry, anchor);
        }
        for (const entry of unanchored) settle(entry);

        /*
         * RECLAIM FREED ROOM, in the same pass (owner report 2026-09-14: "when
         * I drag things around to pin them, I need to refresh the page to
         * actually see the new board").
         *
         * The anchor above holds a card on the day it last held, which is what
         * stops a newcomer rearranging the board. But it held too hard in one
         * direction: pinning a card AWAY from a day frees room there, and every
         * other card sat on its remembered day, so nothing moved up. A reload
         * cleared the anchors and the board finally settled — which is exactly
         * the refresh the owner should not need.
         *
         * So after everything is placed, each card gets to move EARLIER into
         * room that is genuinely free. This cannot displace anybody: it only
         * ever fills a gap, never evicts, and a card already on the earliest
         * day with room does not move. Tightest deadline first, so the most
         * urgent card claims freed room before a looser one.
         */
        /* The urgency order is `automatic`'s own order. Reading it back with
           indexOf inside the comparator made this sort O(n² log n); the
           positions are fixed, so they are looked up once. */
        const urgencyOrder = new Map(automatic.map((entry, index) => [entry, index]));
        const urgencyRank = (entry) => (urgencyOrder.has(entry) ? urgencyOrder.get(entry) : -1);
        const byUrgency = [...placedOn.keys()].sort((a, b) => urgencyRank(a) - urgencyRank(b));
        for (const entry of byUrgency) {
            const held = placedOn.get(entry);
            if (!held || held === windowStart) continue;
            release(entry.sub, held);
            const earlier = firstFit(entry.sub, entry.ideal);
            if (!earlier || earlier >= held) { reserve(entry.sub, held); continue; }
            reserve(entry.sub, earlier);
            recordDay(entry, earlier);
        }

        // Work sitting ABOVE an editor's daily capacity once this attempt is
        // done: zero means the board shows no red day.
        let over = 0;
        for (const [entry, day] of placedOn) {
            const facts = factsOf(entry.sub);
            const slot = facts.key + '@' + day;
            const cap = facts.capacity;
            const units = used.get(slot) || 0;
            if (units > cap) { over += units - cap; used.set(slot, cap); }
        }
        return { placements, placedOn, over };
        };

        /*
         * AN ANCHOR IS A PREFERENCE, NEVER A REASON TO SHOW A WORSE BOARD
         * (owner report 2026-09-14, second round).
         *
         * "Use automatic planning" on a pinned card was the mirror of the
         * refresh bug. Unpinning hands the card back to automatic placement,
         * but every other card is anchored to the day it held WHILE the pin was
         * away, so they do not give the room back and the day renders over
         * capacity — 5/4 where a reload shows a clean 4/4. A reload fixed it
         * because a fresh page has no anchors at all.
         *
         * So the anchored attempt is kept only while it is no worse: when it
         * leaves more work above capacity than a clean anchor-free pass would,
         * the clean pass wins and the board shows what a reload would have
         * shown. Bounded at one retry, and only reached when the anchored
         * attempt actually overflows, so the ordinary path stays a single pass.
         */
        let attempt = plan(true);
        if (attempt.over > 0) {
            const clean = plan(false);
            attempt = clean.over < attempt.over ? clean : plan(true);
        }
        placements = attempt.placements;
        placedOn = attempt.placedOn;

        // What every automatic item ended up holding, for the next pass to
        // anchor against. Distinct from `placements`, which carries only the
        // items that are NOT on their ideal day.
        wlState.autoPlacementSettled = new Map(
            [...placedOn].map(([entry, day]) => [String(entry.sub && entry.sub.id || ''), day]));
        return placements;
    }

    function wlBucketByDisplayDate(plannedSubs) {
        const byDate = new Map();
        for (const sub of plannedSubs) {
            const day = wlDisplayDate(sub);
            if (!day) continue;
            if (!byDate.has(day)) byDate.set(day, []);
            byDate.get(day).push(sub);
        }
        return byDate;
    }

    /* Asked for the same handful of team key/name pairs thousands of times per
       placement pass (8% of a 97 s settle, profiled 2026-09-15). Pure. */
    function wlTeamBucket(teamKey, teamName) {
        const cache = wlTeamBucket._cache || (wlTeamBucket._cache = new Map());
        const cacheKey = String(teamKey || '') + '|' + String(teamName || '');
        const cached = cache.get(cacheKey);
        if (cached !== undefined) return cached;
        const k = (teamKey || '').toUpperCase();
        const n = (teamName || '').toLowerCase();
        const out = (n.includes('graphic') || k === 'DES' || k === 'GFX' || k === 'GRA') ? 'graphics' : 'video';
        if (cache.size > 4000) cache.clear();
        cache.set(cacheKey, out);
        return out;
    }
    function wlEditorCapacity(teamKey, teamName) {
        return wlTeamBucket(teamKey, teamName) === 'graphics' ? 15 : 4;
    }
    function wlDayOverCapacity(subs) {
        const counts = new Map();
        for (const sub of subs || []) {
            const team = wlTeamBucket(sub.teamKey, sub.teamName);
            const key = (sub.assigneeId || '?') + '|' + team;
            const next = (counts.get(key) || 0) + wlWorkloadWeight(sub);
            counts.set(key, next);
            if (next > wlEditorCapacity(sub.teamKey, sub.teamName)) return true;
        }
        return false;
    }

    function wlInitials(name) {
        const n = wlDisplayName(name);
        if (!n) return '?';
        const parts = n.trim().split(/\s+/);
        return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || n[0].toUpperCase();
    }

    // Some Linear users have no full name set — assigneeName is then the email.
    // Convert "martin.synchro@gmail.com" -> "Martin Synchro"; otherwise use the name as-is.
    function wlDisplayName(name) {
        if (!name) return '';
        const s = String(name).trim();
        if (!/@/.test(s)) return s;
        const local = s.split('@')[0];
        return local.split(/[._-]+/).filter(Boolean)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(' ') || s;
    }

    function renderWorkloadShell() {
        return `<div class="workload-view">
            <section id="wlOverview" class="workload-overview-matrix empty" aria-labelledby="wlOverviewTitle">
                <div class="workload-overview-head">
                    <div class="workload-overview-heading" id="wlOverviewTitle">
                        <strong>Team workload</strong>
                        <span>freest → busiest</span>
                    </div>
                    <div class="workload-overview-capacity-head">Capacity</div>
                    <div class="workload-overview-status-head is-overdue"><span>Overdue</span><span class="workload-overview-head-total" id="wlOverdueTotal">0</span></div>
                    <div class="workload-overview-status-head is-inprogress"><span>In progress</span><span class="workload-overview-head-total" id="wlInProgressTotal">0</span></div>
                    <div class="workload-overview-status-head is-tweaks"><span>Tweaks</span><span class="workload-overview-head-total" id="wlTweaksTotal">0</span></div>
                </div>
                <div class="workload-overview-rows" id="wlOverviewRows"></div>
            </section>
            <section class="workload-calendar-module">
                <div class="workload-calendar-heading">
                    <h2>Work-day calendar</h2>
                    <details id="wlWeekendNotice" class="workload-weekend-notice" hidden>
                        <summary><span id="wlWeekendNoticeLabel">Weekend dates</span></summary>
                        <div id="wlWeekendNoticePanel" class="workload-weekend-notice-panel"></div>
                    </details>
                </div>
                <div class="workload-toolbar">
                    <div class="workload-toolbar-row">
                        <div class="workload-title-group">
                            <div class="workload-title" id="wlTitle" tabindex="-1">—</div>
                        </div>
                        <div class="workload-toolbar-right">
                            <div class="workload-nav">
                                <button type="button" data-wl-nav="prev" aria-label="Previous period">‹</button>
                                <button type="button" data-wl-nav="today">Today</button>
                                <button type="button" data-wl-nav="next" aria-label="Next period">›</button>
                            </div>
                            <div class="workload-pills" id="wlViewPills" role="tablist" aria-label="View">
                                <button type="button" data-wl-view="week">Week</button>
                                <button type="button" data-wl-view="month">Month</button>
                            </div>
                            <div class="workload-nav">
                                <button type="button" data-wl-nav="refresh" aria-label="Refresh from Linear"><span class="wl-refresh-icon">↻</span></button>
                            </div>
                        </div>
                    </div>
                    <div class="workload-toolbar-row">
                        <div class="workload-toolbar-left">
                            <div class="workload-pills" id="wlTeamPills" role="tablist" aria-label="Team">
                                <button type="button" data-wl-team="all">All</button>
                                <button type="button" data-wl-team="video">Video</button>
                                <button type="button" data-wl-team="graphics">Graphics</button>
                            </div>
                            <div class="workload-filters">
                                <div class="wl-dropdown" data-wl-filter="editor">
                                    <button type="button" class="dropdown-trigger" data-wl-dropdown-trigger="editor" aria-haspopup="listbox" aria-expanded="false">
                                        <span data-wl-dropdown-label>All editors</span>
                                        <span class="dd-arrow">▾</span>
                                    </button>
                                    <div class="dropdown-menu" data-wl-dropdown-menu="editor" role="listbox"></div>
                                </div>
                                <div class="wl-client-search" data-wl-filter="client">
                                    <input type="text" class="wl-client-search-input" id="wlClientSearchInput" placeholder="All clients" autocomplete="off">
                                    <button type="button" class="wl-client-search-clear" id="wlClientSearchClear" hidden aria-label="Clear"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7"/></svg></button>
                                    <div class="wl-client-search-results" id="wlClientSearchResults" hidden role="listbox"></div>
                                </div>
                                <div class="workload-pills workload-deadline-mode" role="tablist" aria-label="Plan and due date display">
                                    <button type="button" role="tab" data-wl-deadline-mode="plan" aria-selected="${wlState.showDeadlines ? 'false' : 'true'}"${wlState.showDeadlines ? '' : ' class="active"'}>Plan only</button>
                                    <button type="button" role="tab" data-wl-deadline-mode="deadlines" aria-selected="${wlState.showDeadlines ? 'true' : 'false'}"${wlState.showDeadlines ? ' class="active"' : ''}>Plan + Due Date</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div id="wlPlanStatus" class="workload-plan-status" role="status" hidden></div>
                <div id="wlBody">
                    ${_svLoadingSkeletonHtml('workload')}
                </div>
            </section>
            <div id="wlUnassigned" class="workload-needs-assignment empty">
                <div class="workload-section-label">Needs assignment</div>
                <div class="workload-chips wl-loose-clients" id="wlUnassignedChips"></div>
            </div>
            <div id="wlUndated" class="workload-needs-assignment workload-undated empty">
                <div class="workload-section-label">Needs a work day or deadline</div>
                <div class="workload-chips wl-loose-clients" id="wlUndatedChips"></div>
            </div>
            <div class="workload-legend">
                <span class="workload-legend-item"><span class="workload-legend-swatch" style="background:var(--sv-bg-6c5ce7)"></span>Video</span>
                <span class="workload-legend-item"><span class="workload-legend-swatch" style="background:var(--sv-bg-d97706)"></span>Graphics</span>
                <span class="workload-legend-item"><span class="workload-legend-swatch" style="background:var(--sv-bg-eab308)"></span>In Progress</span>
                <span class="workload-legend-item"><span class="workload-legend-swatch" style="background:var(--sv-bg-ea580c)"></span>Tweaks Needed</span>
                <span class="workload-legend-item"><span class="workload-legend-swatch" style="background:var(--wl-overdue-accent)"></span>Over capacity</span>
            </div>
            <div id="wlPopover" class="workload-popover" role="dialog" aria-hidden="true"></div>
        </div>`;
    }
    /* Smart default: a creative lands on their own work (see
     * _syncviewCreativeMe). The editor filter holds workload assignee ids,
     * which are not staff member ids, so the match waits for the rows and
     * resolves in wlPopulateFilterOptions by id or by name. Once per load, and
     * dropped the moment the person picks an editor themselves. */
    let _wlCreativeDefaultDone = false;
    let _wlCreativePending = null;
    function _wlCreativeDefaultInit() {
        if (_wlCreativeDefaultDone) return;
        _wlCreativeDefaultDone = true;
        const me = _syncviewCreativeMe();
        if (me && wlState.editor === 'all') _wlCreativePending = me;
    }
    // Signed out (or not yet verified): no board data may be on screen. Anything
    // held in memory or in this browser is dropped, and the board says why.
    function wlRenderSignedOut() {
        if ((Array.isArray(wlState.issueSnapshot) && wlState.issueSnapshot.length) || wlState.fetchedAt != null
            || (Array.isArray(wlState.editorRoster) && wlState.editorRoster.length)) wlPurgeBoardData();
        if (wlState.popoverAnchor) wlClosePopover(false);
        ['wlOverviewRows', 'wlUndatedChips', 'wlUnassignedChips'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
        // Filters can name a client or editor; forget them and hide the
        // toolbar around the board, so only the sign-in note is left.
        wlState.client = 'all'; wlState.editor = 'all'; wlState.team = 'all';
        const bodyEl = document.getElementById('wlBody');
        if (!bodyEl) return;
        bodyEl.innerHTML = '<div class="wl-signed-out" data-wl-signed-out>Sign in as staff to see Workload.</div>';
        const view = bodyEl.closest('.workload-view');
        for (let el = bodyEl; el && el !== view && el.parentElement; el = el.parentElement) {
            for (const sib of el.parentElement.children) {
                if (sib !== el && !sib.hidden) { sib.hidden = true; sib.setAttribute('data-wl-so-hidden', ''); }
            }
            if (el.parentElement === view) break;
        }
    }
    function wlUnhideSignedOut() {
        document.querySelectorAll('[data-wl-so-hidden]').forEach(el => { el.hidden = false; el.removeAttribute('data-wl-so-hidden'); });
    }
    async function initWorkloadView() {
        // Guarded: unit suites run this mount alone in a sandbox.
        if (typeof _wlCreativeDefaultInit === 'function') _wlCreativeDefaultInit();
        if (wlStaffSignedOut()) {
            wlRenderSignedOut();
            // A sign-in completing later reloads the board through the normal path.
            if (typeof _syncviewRequireStaffIdentity === 'function') {
                _syncviewRequireStaffIdentity('workload-plan-read').then(() => {
                    if (wlStaffMayView() && document.querySelector('.workload-view')) initWorkloadView();
                }).catch(() => {});
            }
            return;
        }
        const todayISO = wlWorkloadTodayISO();
        const now = wlParseISO(todayISO);
        if (wlState.year == null)      { wlState.year = now.getFullYear(); wlState.month = now.getMonth(); }
        if (wlState.weekStart == null) { wlState.weekStart = wlWeekMondayISO(todayISO); }
        // Seed the client search dropdown with the canonical client list as
        // soon as the view mounts. Otherwise the dropdown is empty until the
        // background fetch returns, which feels broken if you start typing
        // immediately after page load.
        if (!wlState.clientOptions || !wlState.clientOptions.length) {
            wlState.clientOptions = WL_CLIENT_NAMES.slice().sort((a, b) => a.localeCompare(b));
        }
        try {
            const pref = localStorage.getItem(WL_VIEW_PREF_KEY);
            if (pref === 'week' || pref === 'month') wlState.viewMode = pref;
        } catch {}
        if (wlState.showDeadlines) wlState.viewMode = 'week';

        // A route switch remounts the Workload shell, but the calendar state is
        // already warm. Paint that in-memory snapshot synchronously and limit
        // automatic network work to the cheap Supabase watermark check.
        // `?wlnative=1` (step 2 of docs/ops/WORKLOAD_NATIVE_SOURCE.md): read the
        // native view alongside the Linear-derived table and print the
        // difference. Deliberately fire-and-forget and deliberately BEFORE the
        // warm-snapshot early return, so it runs on a route switch too. It
        // renders nothing and touches no state; if the view is not applied yet
        // it says so and the board is unaffected.
        // The GUARD is inside the try as well as the call. A diagnostic must not
        // be able to break the mount, and "the flag check itself cannot throw"
        // is an assumption about scope that a test harness disproved within the
        // hour: workload-linear-browser.js runs initWorkloadView in a vm sandbox
        // that defines only what the mount needs, so an unguarded reference
        // threw before the board painted at all.
        try { if (_wlNativeDiffEnabled()) window.wlNativeDiff(); }
        catch (e) { console.warn('[workload native] diff failed to start', e); }

        wlLoadTestClients();
        const hasWarmSnapshot = wlState.fetchedAt != null && Array.isArray(wlState.issueSnapshot);
        if (hasWarmSnapshot) {
            wlState.loading = false;
            wlState.refreshing = false;
            renderWorkloadAll();
            wlScheduleNativeDueReceiptRetry();
            wlWireToolbar();
            wlWireClientSearch();
            _wlV2EnsureSubscribed();
            _wlV2EnsureWatermarkPoll();
            if (wlState.planStatus !== 'ready' || wlState.linearMetadataStatus !== 'ready') {
                wlRefreshSensitiveStateSilent().finally(_wlV2CheckWatermark);
            } else {
                _wlV2CheckWatermark();
            }
            return;
        }

        const cache = wlReadCache();
        wlState.loading = true;
        wlState.planStatus = wlState.planHasSnapshot ? 'refreshing' : 'loading';
        wlState.linearMetadataStatus = wlState.workloadByIssueId.size ? 'refreshing' : 'loading';
        wlState.linearMetadataWithheldOnly = 0;
        /* LAST GOOD BOARD FIRST (Loom, 2026-09-23). Measured on the live site:
           a switch from the calendar spent 3.8-7.2 s waiting for the snapshot's
           first byte and under 0.6 s on everything else, so no browser-side
           tuning of the read can make it feel instant -- only not waiting can.
           The cache holds issue rows only (never plans, which stay fail-closed
           behind the live read), so it paints with planLoading=true: automatic
           estimates, no private pins, editing off until the live snapshot lands.
           OPEN_REPAIRS 230 item 3: a stale board is acceptable ONLY when it says
           so, so wlState.cachedBoardAt drives a notice in renderWorkloadPlanStatus
           until wlLoadSnapshot replaces it. Staff identity is required first:
           the cache was written for a staff session and is not shown to anyone
           the live read would refuse. */
        // Older than WL_CACHED_BOARD_MAX_AGE_MS: the normal loading state, not
        // a board that far out of date.
        const cachedIssues = wlCachedBoardUsable(cache)
            && _syncviewStaffIdentityForHeaders() ? cache.issues : null;
        if (cachedIssues && !wlState.issueSnapshot.length) {
            wlState.planLoading = true;
            wlState.cachedBoardAt = cache.fetchedAt;
            // The roster saved with it, so the Team workload panel has its final
            // rows (zero-work "Free" editors included) from the first frame. The
            // live snapshot replaces it; a cache without one leaves it 'unknown'.
            const cachedRoster = wlState.editorRosterStatus !== 'ready' ? wlCachedRoster(cache) : null;
            if (cachedRoster) {
                wlState.editorRoster = cachedRoster;
                wlState.editorRosterStatus = 'ready';
            }
            wlApplyData(cachedIssues, cache.fetchedAt);
            wlState.loading = false;
        }
        // Phase 1's exact due-date view remains a safe first paint even before
        // the plan sidecar has answered. This keeps the post-merge / pre-deploy
        // window useful without a runtime gate; saved overrides replace the
        // fallback only after an authoritative list response.
        renderWorkloadAll();

        // Wire the toolbar and client search BEFORE the fetch so the search
        // input has its listeners attached the moment the user starts
        // typing — even if they type during the network round-trip. The
        // dropdown is already seeded with WL_CLIENT_NAMES above, so
        // suggestions appear instantly.
        wlWireToolbar();
        wlWireClientSearch();
        // Workload v2 (?wl2=1): open the Supabase realtime subscription so the
        // board updates on its own when workload_issues changes. No-op when the
        // flag is off. Fire-and-forget; teardown happens on leaving the view.
        _wlV2EnsureSubscribed();
        _wlV2EnsureWatermarkPoll();

        try {
            await wlLoadSnapshot(false, cache);
            wlState.error = null;
        } catch (e) {
            console.error('[SyncView] Workload fetch failed:', e);
            if (!cache) wlState.error = e.message || 'Failed to load issues from Linear.';
        } finally {
            wlState.loading = false;
            // Backstop: the load has settled, so leave the fast-paint estimate
            // even if wlLoadSnapshot returned early (superseded/thrown).
            wlState.planLoading = false;
            wlScheduleNativeDueReceiptRetry();
            renderWorkloadAll({ deferWhilePopoverOpen: true });
            // Animate only the manually planned items that settled to a new
            // column (non-manual items kept their fast-paint estimate).
            wlApplySettleAnimation();
            // If the user already opened the client-search dropdown while we
            // were fetching, drop the "Loading workload…" row now that data
            // is in. We trigger an `input` event so the existing render
            // pipeline re-runs with the same query.
            const searchInput = document.getElementById('wlClientSearchInput');
            const searchResults = document.getElementById('wlClientSearchResults');
            if (searchInput && searchResults && !searchResults.hidden) {
                searchInput.dispatchEvent(new Event('input'));
            }
        }
    }


    function wlSpinnerOn() {
        const btn = document.querySelector('[data-wl-nav="refresh"]');
        if (btn) btn.classList.add('wl-refreshing');
    }
    function wlSpinnerOff() {
        const btn = document.querySelector('[data-wl-nav="refresh"]');
        if (btn) btn.classList.remove('wl-refreshing');
    }

    // Non-destructive background refresh helpers.
    function wlMarkBackgroundRefreshFailure(error) {
        wlState.backgroundError = (error && error.message) || 'Background refresh failed.';
        if (document.querySelector('.workload-view')) renderWorkloadPlanStatus();
    }

    function wlClearBackgroundRefreshFailure() {
        if (!wlState.backgroundError) return;
        wlState.backgroundError = null;
        if (document.querySelector('.workload-view')) renderWorkloadPlanStatus();
    }

    // Atomic Supabase/Edge background lane. It never calls the n8n-backed
    // loader, never selects a loading state, and publishes only a complete set
    // of issues, saved plans, and Linear metadata.
    async function wlRefetchSilent(options) {
        if (!document.querySelector('.workload-view') || !_syncviewStaffIdentityForHeaders()) return false;
        if (_wlPlanWriteInFlight.size || _wlDueWriteInFlight.size || wlState.loading || wlState.refreshing) return false;
        if (_wlBackgroundRefreshPromise) return _wlBackgroundRefreshPromise;
        const run = async () => {
            const before = wlBackgroundBusinessFingerprint();
            const editingBefore = `${wlPlanEditingEnabled()}:${wlLinearEditingEnabled()}`;
            try {
                const result = await wlLoadSnapshot(false, null);
                if (!result) return false;
                wlState.error = null;
                if (document.querySelector('.workload-view')) {
                    if (before !== wlBackgroundBusinessFingerprint()
                        || editingBefore !== `${wlPlanEditingEnabled()}:${wlLinearEditingEnabled()}`) {
                        renderWorkloadAll({ deferWhilePopoverOpen: true });
                    }
                    else renderWorkloadPlanStatus();
                }
                return true;
            } catch (error) {
                if (document.querySelector('.workload-view')) renderWorkloadPlanStatus();
                return false;
            }
        };
        const pending = run();
        _wlSetBackgroundRefreshPromise(pending);
        try { return await pending; }
        finally {
            if (_wlBackgroundRefreshPromise === pending) {
                _wlSetBackgroundRefreshPromise(null);
                if (!_wlNativeDueReceiptRetryPromise) wlScheduleNativeDueReceiptRetry();
            }
        }
    }
    async function _wlLegacyRefetchSilent(options) {
        const sensitiveOnly = !!(options && options.sensitiveOnly);
        if (!document.querySelector('.workload-view') || (!sensitiveOnly && !_wlV2Ready())) return false;
        if (!_syncviewStaffIdentityForHeaders()) return false;
        if (sensitiveOnly && wlState.fetchedAt == null) return false;
        if (_wlPlanWriteInFlight.size || _wlDueWriteInFlight.size) return false;
        if (_wlBackgroundRefreshPromise) {
            // A full refresh already includes the sensitive projections. A
            // full request arriving behind a sensitive-only rehydrate must,
            // however, wait and then read the mirror itself before its caller
            // may consume an advanced watermark.
            if (!sensitiveOnly && _wlBackgroundRefreshMode === 'sensitive') {
                await _wlBackgroundRefreshPromise;
                return wlRefetchSilent();
            }
            return _wlBackgroundRefreshPromise;
        }

        if (!wlStaffMayView()) return false;
        const run = async () => {
            const loadGeneration = _wlNextPlanLoadGeneration();
            const sessionGeneration = _wlPlanSessionGeneration;
            try {
                const freshIssues = sensitiveOnly
                    ? wlState.issueSnapshot.map(issue => ({ ...issue }))
                    : await _wlV2FetchIssues();
                if (!sensitiveOnly && !freshIssues.length && wlState.issueSnapshot.length) {
                    throw new Error('Supabase returned an empty Workload snapshot.');
                }
                const [plansResult, metadataResult] = await Promise.allSettled([
                    wlFetchPlanRows(),
                    wlFetchLinearMetadata(freshIssues)
                ]);
                if (loadGeneration !== _wlPlanLoadGeneration || sessionGeneration !== _wlPlanSessionGeneration) return false;
                if (_wlPlanWriteInFlight.size || _wlDueWriteInFlight.size) return false;

                const failures = [plansResult, metadataResult]
                    .filter(result => result.status === 'rejected')
                    .map(result => result.reason);
                if (metadataResult.status === 'rejected'
                    && metadataResult.reason
                    && metadataResult.reason.workloadMetadataFailure === true) {
                    const sanitized = wlMarkLinearMetadataFailure(metadataResult.reason, freshIssues);
                    if (sanitized && document.querySelector('.workload-view')) {
                        renderWorkloadAll({ deferWhilePopoverOpen: true });
                    }
                }
                // An auth denial from either staff projection must not be
                // masked by an unrelated network error from the other one.
                const failed = failures.find(error => Number(error && error.status) === 401)
                    || failures.find(error => Number(error && error.status) === 403)
                    || failures[0]
                    || null;
                if (failed) throw failed;

                const before = wlBackgroundBusinessFingerprint();
                const editabilityBefore = `${wlPlanEditingEnabled()}:${wlLinearEditingEnabled()}`;
                // Re-authentication may update due-date metadata on a retained
                // snapshot, but it must not make that old mirror read look new.
                const fetchedAt = sensitiveOnly ? wlState.fetchedAt : Date.now();
                wlAdoptPlanRows(plansResult.value);
                wlAdoptLinearMetadata(metadataResult.value, freshIssues, fetchedAt, {
                    skipIssueCacheWrite: sensitiveOnly
                });
                wlApplyData(freshIssues, fetchedAt);
                wlState.error = null;
                wlState.backgroundError = null;

                const changed = before !== wlBackgroundBusinessFingerprint();
                const editingChanged = editabilityBefore !== `${wlPlanEditingEnabled()}:${wlLinearEditingEnabled()}`;
                if (document.querySelector('.workload-view')) {
                    if (changed || editingChanged) renderWorkloadAll({ deferWhilePopoverOpen: true });
                    else renderWorkloadPlanStatus();
                }
                // True means the complete server snapshot was consumed. The
                // caller must advance its watermark even when `changed` is false.
                return true;
            } catch (error) {
                if (loadGeneration !== _wlPlanLoadGeneration || sessionGeneration !== _wlPlanSessionGeneration) return false;
                const status = Number(error && error.status) || 0;
                if (status === 401) _syncviewStaffIdentityClear();
                else if (status === 403) wlPurgePlanSensitiveState();
                else {
                    console.warn('[SyncView] Workload background refresh failed:', error);
                    wlMarkBackgroundRefreshFailure(error);
                }
                return false;
            }
        };

        const pending = run();
        _wlSetBackgroundRefreshPromise(pending);
        _wlSetBackgroundRefreshMode(sensitiveOnly ? 'sensitive' : 'full');
        try { return await pending; }
        finally {
            if (_wlBackgroundRefreshPromise === pending) {
                _wlSetBackgroundRefreshPromise(null);
                _wlSetBackgroundRefreshMode(null);
                if (!_wlNativeDueReceiptRetryPromise) wlScheduleNativeDueReceiptRetry();
            }
        }
    }

    async function wlQueueSensitiveAuthorityRefresh(expectedSessionGeneration) {
        const incumbent = _wlBackgroundRefreshPromise;
        if (incumbent) {
            try { await incumbent; } catch (error) {}
        }
        if (expectedSessionGeneration !== _wlPlanSessionGeneration) return false;
        return wlRefetchSilent({ sensitiveOnly: true });
    }

    async function wlRefreshSensitiveStateSilent() {
        if (wlState.planStatus === 'ready' && wlState.linearMetadataStatus === 'ready') return true;
        if (wlState.loading || wlState.refreshing
            || wlState.planStatus === 'loading' || wlState.planStatus === 'refreshing'
            || wlState.linearMetadataStatus === 'loading' || wlState.linearMetadataStatus === 'refreshing') return false;
        return wlRefetchSilent({ sensitiveOnly: true });
    }

    async function wlRebaseMirrorWatermarkAfterDirectRefresh() {
        try {
            const latest = await _wlV2FetchLatestWatermark();
            if (latest) wlState.sourceSyncedAt = latest;
            wlClearBackgroundRefreshFailure();
        } catch (error) {
            // Keep the cursor empty. The next successful check will establish a
            // baseline without applying an older mirror over fresh Linear truth.
            console.warn('[SyncView] Workload mirror baseline failed:', error);
            wlMarkBackgroundRefreshFailure(error);
        }
    }

    // Manual refresh — toolbar ↻ button. This explicit action intentionally
    // keeps the direct no-cache Linear path and the calendar skeleton.
    async function wlManualRefresh() {
        if (!document.querySelector('.workload-view') || wlState.refreshing || _wlDueWriteInFlight.size) return;
        const priorWatermark = wlState.sourceSyncedAt;
        const shouldRebaseMirror = false; // native snapshots do not use the mirror watermark
        if (shouldRebaseMirror) wlState.sourceSyncedAt = null;
        wlState.refreshing = true;
        wlSpinnerOn();
        try {
            const payload = await wlLoadSnapshot(true, null);
            if (!document.querySelector('.workload-view')) return;
            if (!payload || !payload.legacyTeams || !payload.legacyTeams.length) wlState.backgroundError = null;
            if (shouldRebaseMirror && payload && !payload.usedFallback) {
                await wlRebaseMirrorWatermarkAfterDirectRefresh();
            } else if (shouldRebaseMirror) {
                wlState.sourceSyncedAt = priorWatermark;
            }
            wlState.error = null;
        } catch (err) {
            if (shouldRebaseMirror) wlState.sourceSyncedAt = priorWatermark;
            wlState.error = err.message || 'Refresh failed.';
        } finally {
            wlState.refreshing = false;
            wlScheduleNativeDueReceiptRetry();
            wlSpinnerOff();
            renderWorkloadAll();
        }
    }

    // Returning to the browser checks only the Supabase watermark. The warm
    // calendar remains mounted while any advanced snapshot is compared.
    function _wlOnVisibilityChange() {
        if (!document.hidden && document.querySelector('.workload-view')) _wlV2CheckWatermark();
    }
    if (typeof document !== 'undefined' && !window.__wlVisibilityWired) {
        window.__wlVisibilityWired = true;
        document.addEventListener('visibilitychange', _wlOnVisibilityChange);
    }
    if (typeof window !== 'undefined' && !window.__wlNativeDueReceiptWired) {
        window.__wlNativeDueReceiptWired = true;
        window.addEventListener('storage', _wlOnNativeDueReceiptStorage);
    }

    // Debug helper — run  wlDebug()  in the browser console while on the Workload tab.
    window.wlDebug = function(needle) {
        const cache = wlReadCache();
        const issues = cache ? cache.issues : [];
        const subs = issues.filter(i => i.isSubIssue);
        console.group('=== wlDebug ===');
        console.log('Total issues from API:', issues.length);
        console.log('Sub-issues total:', subs.length);
        console.log('planned (dated):', wlState.planned.length);
        console.log('nowWorking (In Progress):', wlState.nowWorking.length);
        console.log('tweaksNeeded:', wlState.tweaksNeeded.length);
        console.log('overdue:', wlState.overdue.length);
        console.log('undated:', wlState.undated.length);
        console.log('unassigned:', wlState.unassigned.length);
        console.log('calendar work days:', [...wlState.calendarByDate.keys()].sort());

        // Breakdown by statusType — are items being dropped for being "completed"?
        const byStatus = {};
        for (const s of subs) {
            const key = (s.statusType || 'null') + ' / ' + (s.status || 'null');
            byStatus[key] = (byStatus[key] || 0) + 1;
        }
        console.log('\n--- Sub-issues by statusType / status ---');
        Object.entries(byStatus).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(n, k));

        console.log('\n--- Sub-issues with dueDate in the next 14 days ---');
        const today = wlWorkloadTodayISO();
        const cutoff = wlAddWorkingDays(today, 14);
        subs.filter(s => s.dueDate && s.dueDate >= today && s.dueDate <= cutoff)
            .sort((a, b) => (a.dueDate > b.dueDate ? 1 : -1))
            .forEach(s => console.log(
                s.identifier, '|', s.dueDate, '|', s.status, '|',
                s.assigneeName || 'UNASSIGNED', '|', s.clientName, '|', s.teamKey
            ));

        console.log('\n--- Unassigned sub-issues ---');
        wlState.unassigned.forEach(s => console.log(
            s.identifier, '|', s.dueDate, '|', s.status, '|', s.clientName, '|', s.teamKey
        ));

        // Optional search — wlDebug("chelsey") or wlDebug("GRA-5707")
        if (needle) {
            const q = String(needle).toLowerCase();
            console.log('\n--- Issues matching "' + needle + '" (ALL issues, not just sub-issues) ---');
            issues.filter(i =>
                (i.identifier || '').toLowerCase().includes(q) ||
                (i.title || '').toLowerCase().includes(q) ||
                (i.clientName || '').toLowerCase().includes(q) ||
                (i.parentIdentifier || '').toLowerCase().includes(q)
            ).forEach(i => console.log(
                i.identifier, '|', 'sub:', !!i.isSubIssue, '|', 'parent:', i.parentIdentifier || '-',
                '|', i.dueDate || 'no-date', '|', i.statusType + '/' + i.status, '|',
                i.assigneeName || 'UNASSIGNED', '|', i.clientName, '|', i.teamKey
            ));
        }
        console.groupEnd();
    };

    function wlApplyData(issues, fetchedAt) {
        // Drop the previous snapshot's capacity moves before anything reads a
        // display date: the bucketing pass below must see ideal days, and the
        // fresh placements are computed from this snapshot at the end.
        wlState.autoPlacementByIssueId = new Map();
        wlState.issueSnapshot = Array.isArray(issues) ? issues : [];
        wlState.sourceSyncedAt = wlState.issueSnapshot.reduce((latest, issue) => {
            const candidate = String(issue && issue.syncedAt || '');
            if (!candidate || !Number.isFinite(Date.parse(candidate))) return latest;
            return !latest || Date.parse(candidate) > Date.parse(latest) ? candidate : latest;
        }, '') || wlState.sourceSyncedAt || null;
        const parentById = new Map();
        const subsByParentId = new Map();
        for (const i of issues) {
            if (!i.isSubIssue) parentById.set(i.id, i);
            // Normalise dueDate — Linear can return "YYYY-MM-DDTHH:mm:ssZ"; slice to 10.
            if (i.dueDate) i.dueDate = String(i.dueDate).slice(0, 10);
        }
        // Only surface sub-issues whose client appears in the canonical
        // Clients Info sheet — keeps stray Linear projects and former clients
        // out of every panel without further per-call filtering downstream.
        // Log any active sub-issue whose client we don't recognise so
        // typo'd Linear projects (e.g. "Mastin Kip" vs "Mastin Kipp") are
        // easy to track down from the browser console.
        // Test clients: tagged here, hidden unless this browser opted in.
        const testMode = wlTestClientsMode();
        for (const i of issues) {
            i.wlTestClient = wlIsTestClientIssue(i);
            i.wlTestShown = i.wlTestClient && testMode;
        }
        const dropped = new Map();
        for (const i of issues) {
            if (!i.isSubIssue || !wlIsActiveStatus(i)) continue;
            if (i.wlTestClient && !i.wlTestShown) continue;
            if (wlIssueClientAllowed(i)) continue;
            const k = i.clientName || '(no client)';
            dropped.set(k, (dropped.get(k) || 0) + 1);
        }
        if (dropped.size) {
            console.warn('[workload] inactive or unrecognised client rows:', [...dropped.values()].reduce((a,b) => a+b,0));
        }
        const subs = issues.filter(i => i.isSubIssue && wlIsActiveStatus(i) && wlIssueClientAllowed(i)
            && (!i.wlTestClient || i.wlTestShown));
        // Replace each sub's clientName with the canonical sheet name so
        // dropdowns, group keys and rollup labels collapse "Miki-agrawal" and
        // "Miki Agrawal" into a single "Miki Agrawal" entry.
        for (const s of subs) if (s.workloadSource !== 'native') s.clientName = wlCanonicalClient(s.clientName);

        // Log who's passing the editor filter so the user can spot people
        // who shouldn't be there — graphic designers currently pass through
        // unchecked because we don't have a graphics-team allowlist yet,
        // and any non-allowlisted video editor is dropped here too.
        const graphicsPass = new Set();
        const videoDropped = new Map();
        for (const s of subs) {
            if (!s.assigneeId) continue;
            const team = wlTeamBucket(s.teamKey, s.teamName);
            const display = wlDisplayName(s.assigneeName) || s.assigneeName || 'Unknown';
            if (team === 'graphics') {
                graphicsPass.add(display);
            } else if (!wlIssueEditorAllowed(s)) {
                videoDropped.set(display, (videoDropped.get(display) || 0) + 1);
            }
        }
        if (graphicsPass.size) {
            console.info('[workload] graphics assignee count:', graphicsPass.size);
        }
        if (videoDropped.size) {
            console.warn('[workload] excluded assignee row count:', [...videoDropped.values()].reduce((a,b) => a+b,0));
        }
        for (const s of subs) {
            if (!s.parentId) continue;
            if (!subsByParentId.has(s.parentId)) subsByParentId.set(s.parentId, []);
            subsByParentId.get(s.parentId).push(s);
        }
        wlState.parentById     = parentById;
        wlState.subsByParentId = subsByParentId;
        wlState.allActiveSubs  = subs; // used to populate the client dropdown

        const todayISO     = wlWorkloadTodayISO();
        const nowWorking   = [];
        const tweaksNeeded = [];
        const planned      = [];
        const overdue      = [];
        const undated      = [];
        const unassigned   = [];
        /* WHAT THE BOARD DECIDED NOT TO SHOW, and why.
           Two branches below remove a row from every panel. Both were correct
           to exclude and wrong to be silent: an empty board is read as "no
           work", and a filter that empties it is read as "this client has
           nothing". Measured 2026-08-30 across 210 active sub-issues on the
           seed roster: 42 discarded, 20%, with two clients going entirely
           blank. The rows are counted here and reported by
           wlExcludedSummaryText; NOTHING is re-bucketed, because every
           downstream consumer keys on assigneeId and the capacity model the
           auto-placement pass depends on would move if these rows entered it. */
        const excluded = { noAssigneeNoDate: [], offTeamAssignee: [] };
        for (const s of subs) {
            const inProg     = wlIsInProgress(s);
            const needsTweak = wlIsTweaksNeeded(s);
            const hasDue     = !!s.dueDate;
            const hasManualPlan = !!wlPlanDate(s);
            const workDate   = wlDisplayDate(s);
            if (!s.assigneeId) {
                /* No assignee AND no date of any kind: the strip that would
                   hold it is keyed on having somewhere to put it. */
                if (inProg || workDate) unassigned.push(s);
                else excluded.noAssigneeNoDate.push(s);
                continue;
            }
            /* The predicate tests the roster of THIS ROW'S TEAM, not whether
               the person still works here. The old comment said "sub-issues
               stuck on former editors", which is one case it catches and not
               what it asks: a current designer assigned to a video-team row is
               excluded identically. Widening it is not the repair -- capacity
               is keyed on the row team, so admitting a cross-team row would
               open a second capacity lane for one person and double-count them
               in the matrix. The repair for a mis-teamed row is in Linear. */
            if (!wlIssueEditorAllowed(s)) {
                excluded.offTeamAssignee.push(s);
                continue;
            }
            // Tweak-family statuses are an exclusive workload bucket. A tweak
            // can retain its original due date, but that date must not also put
            // the same sub-issue on the planned calendar (or any other strip).
            if (needsTweak) {
                tweaksNeeded.push(s);
                continue;
            }
            // OWNER RULING 2026-09-07, narrowing the 2026-08-27 one: Overdue is
            // a TO DO lane. Every other live status already says something
            // truer about where the row is -- In Progress says somebody has it
            // open right now, Tweak Needed says it is back with the editor for
            // a named change -- and that status wins over the date. So a status
            // other than To Do OVERRIDES overdue rather than doubling into it,
            // and the only thing left in this lane is work nobody has started
            // whose deadline has already passed. (Approval-wait and Approved
            // rows never reached this loop at all: wlIsActiveStatus parks them
            // upstream, so they were never in Overdue to begin with.)
            //
            // What this ruling did NOT change is where past-due work sits on
            // the work-day calendar. A past-due In Progress row used to be
            // counted in BOTH strips; it is now counted only in In progress,
            // and it leaves the calendar exactly as it did before. Letting it
            // fall through to `planned` would floor its automatic day at today
            // (wlAutoPlanDate) and spend that editor's capacity on a day nobody
            // planned it for, inflating the over-capacity badges on the one
            // cell that is already the fullest. The row stays visible where it
            // always was: the In progress strip, and that editor's yellow pill
            // on today's cell.
            const isPastDue  = hasDue && s.dueDate < todayISO;
            const isOverdue  = isPastDue && wlIsToDo(s);
            if (isOverdue) overdue.push(s);
            if (inProg) nowWorking.push(s);
            // Past-due work leaves the calendar only when a strip above is
            // already carrying it -- an explicit manual pin still keeps its
            // exact work day, because changing the Linear deadline must not
            // move a plan that a person deliberately placed. A past-due row in
            // some other live status (one WL_PARKED_STATUSES does not know, or
            // a column added later) is in NO strip, so it stays on the calendar
            // rather than dropping off the page entirely.
            if (isPastDue && (isOverdue || inProg) && !hasManualPlan) continue;
            if (!workDate) {
                undated.push(s);
                continue;
            }
            // Explicit internal plan_date wins; otherwise this item's own
            // deadline produces its automatic day. Current In Progress work
            // may also appear in its status strip; unpinned overdue work and
            // all tweaks are calendar-exclusive.
            planned.push(s);
        }

        wlState.nowWorking   = nowWorking;
        wlState.tweaksNeeded = tweaksNeeded;
        wlState.planned      = planned;
        wlState.overdue      = overdue;
        wlState.undated      = undated;
        wlState.unassigned   = unassigned;
        wlState.excluded     = excluded;
        wlState.fetchedAt  = fetchedAt;
        // Capacity-aware automatic placement, in two passes. The bucketing
        // above ran against the ideal days (membership only depends on whether
        // a day exists at all, never on which one), so this pass can now see
        // the whole planned set and move automatic work off full days before
        // the calendar buckets it. It needs the authoritative plan snapshot to
        // know which items are pinned, so during the fast first paint — and
        // after a plan-read failure — placement stays exactly as it was.
        wlState.autoPlacementByIssueId = wlState.planHasSnapshot
            ? wlComputeAutoPlacements(planned, todayISO)
            : new Map();
        wlState.calendarByDate = wlBucketByDisplayDate(planned);
    }

    function wlApplyPlanLocal(issueId, planDate) {
        const key = String(issueId || '');
        if (planDate) wlState.planByIssueId.set(key, planDate);
        else wlState.planByIssueId.delete(key);
        if (Array.isArray(wlState.issueSnapshot) && wlState.issueSnapshot.length) {
            wlApplyData(wlState.issueSnapshot, wlState.fetchedAt);
        }
    }

    function wlApplyDueLocal(issueId, dueDate) {
        const key = String(issueId || '');
        for (const issue of wlState.issueSnapshot || []) {
            if (String(issue && issue.id || '') === key) issue.dueDate = dueDate || null;
        }
        if (Array.isArray(wlState.issueSnapshot) && wlState.issueSnapshot.length) {
            wlApplyData(wlState.issueSnapshot, wlState.fetchedAt);
        }
    }

    function wlFocusPlanItem(issueId) {
        setTimeout(() => {
            const match = [...document.querySelectorAll('[data-wl-issue-id]')]
                .find(el => el.getAttribute('data-wl-issue-id') === String(issueId || ''));
            if (match && typeof match.focus === 'function') {
                const group = match.closest && match.closest('.workload-day-client-group');
                if (group) group.open = true;
                match.focus();
                return;
            }
            // A move can place the issue outside the visible week/month. Keep
            // keyboard focus in Workload instead of dropping it onto <body>.
            const title = document.getElementById('wlTitle');
            if (title && typeof title.focus === 'function') title.focus();
        }, 0);
    }

    function wlResetPlanDisplay(issueId) {
        if (document.querySelector('.workload-view')) {
            renderWorkloadAll();
            wlFocusPlanItem(issueId);
        }
    }

    async function _wlPlanWriteRequest(issue, planDate) {
        await _syncviewRequireStaffIdentity('workload-plan');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), WL_PLAN_WRITE_TIMEOUT_MS);
        try {
            return await _writeUiTrackSave('workload', 'workload_plan_save', { id: String(issue.id || '') }, () => fetch(WORKLOAD_PLAN_URL, {
                method: 'POST',
                cache: 'no-store',
                signal: controller.signal,
                headers: _syncviewEfHeaders({ 'Content-Type': 'application/json' }, WORKLOAD_PLAN_URL),
                body: JSON.stringify({
                    action: 'set',
                    issue_id: String(issue.id || ''),
                    client: String(issue.clientName || ''),
                    plan_date: planDate
                })
            }));
        } finally {
            clearTimeout(timeout);
        }
    }

    function wlDueWriteRoute(issue) {
        const issueId = String(issue && issue.id || '').trim();
        const team = wlMetadataTeamBucket(issue && issue.teamKey, issue && issue.teamName);
        const authority = wlState.dueAuthorityByIssueId && wlState.dueAuthorityByIssueId.get(issueId);
        if (!issueId || !team || !authority || authority.team !== team
            || !authority.fingerprint || !['linear', 'syncview'].includes(authority.authority)) {
            return null;
        }
        if (authority.authority === 'linear') {
            return {
                authority: 'linear',
                team,
                authorityFingerprint: authority.fingerprint
            };
        }
        const target = wlState.nativeDueTargetByIssueId && wlState.nativeDueTargetByIssueId.get(issueId);
        if (!target || !target.id || !target.clientSlug || target.team !== team || !target.updatedAt
            || wlNormalizeClient(target.clientSlug) !== wlNormalizeClient(issue && issue.clientName)
            || !wlValidRfc3339Timestamp(target.updatedAt)) {
            return null;
        }
        return {
            authority: 'syncview',
            team,
            authorityFingerprint: authority.fingerprint,
            nativeId: target.id,
            nativeClientSlug: target.clientSlug,
            nativeUpdatedAt: target.updatedAt
        };
    }

    function wlDueWriteRequestId(issueId) {
        let entropy = '';
        try {
            entropy = globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
                ? globalThis.crypto.randomUUID()
                : '';
        } catch (error) {}
        if (!entropy) entropy = Math.random().toString(36).slice(2) + Date.now().toString(36);
        return 'workload:due:' + String(issueId || 'issue') + ':' + entropy;
    }

    function wlAdoptNativeDueGatewayRow(row) {
        const nativeId = String(row && row.id || '').trim();
        const updatedAt = String(row && row.updated_at || '').trim();
        if (!nativeId || !wlValidRfc3339Timestamp(updatedAt)
            || !Object.prototype.hasOwnProperty.call(row || {}, 'due_date')) return false;
        let dueDate = null;
        try { dueDate = wlNativeDueDate(row.due_date); }
        catch (error) { return false; }
        const targets = wlState.nativeDueTargetByIssueId;
        if (!targets || typeof targets.entries !== 'function') return false;
        for (const [issueId, target] of targets.entries()) {
            if (!target || String(target.id || '') !== nativeId) continue;
            const authority = wlState.dueAuthorityByIssueId && wlState.dueAuthorityByIssueId.get(issueId);
            const rowTeam = wlMetadataTeamBucket('', row && row.team);
            const rowClient = String(row && row.client_slug || '').trim();
            if (!authority || authority.authority !== 'syncview' || authority.team !== target.team
                || (rowTeam && rowTeam !== target.team)
                || (rowClient && target.clientSlug && rowClient !== target.clientSlug)) return false;
            targets.set(issueId, { ...target, updatedAt });
            const issue = (wlState.issueSnapshot || []).find(value => String(value && value.id || '') === String(issueId));
            const currentDue = issue && issue.dueDate ? String(issue.dueDate).slice(0, 10) : null;
            if (currentDue !== dueDate) {
                wlApplyDueLocal(issueId, dueDate);
                if (document.querySelector('.workload-view')) renderWorkloadAll();
            }
            return true;
        }
        return false;
    }

    function wlPublishNativeDueReceipt(row) {
        const nativeId = String(row && row.id || '').trim();
        const clientSlug = String(row && row.client_slug || '').trim();
        const team = wlMetadataTeamBucket('', row && row.team);
        const updatedAt = String(row && row.updated_at || '').trim();
        if (!nativeId || !clientSlug || !team || !wlValidRfc3339Timestamp(updatedAt)
            || !Object.prototype.hasOwnProperty.call(row || {}, 'due_date')) return false;
        let dueDate = null;
        try { dueDate = wlNativeDueDate(row.due_date); }
        catch (error) { return false; }
        const payload = JSON.stringify({
            schema: WL_NATIVE_DUE_RECEIPT_SIGNAL_SCHEMA,
            native_committed: true,
            authority: 'syncview',
            nonce: wlDueWriteRequestId(nativeId),
            row: {
                id: nativeId,
                client_slug: clientSlug,
                team,
                due_date: dueDate,
                updated_at: updatedAt
            }
        });
        try {
            // `storage` reaches sibling documents but not this writer. Remove the
            // checkpoint immediately: the exact gateway row is a refetch signal,
            // not a second browser-owned source of due truth.
            localStorage.setItem(WL_NATIVE_DUE_RECEIPT_SIGNAL_KEY, payload);
            localStorage.removeItem(WL_NATIVE_DUE_RECEIPT_SIGNAL_KEY);
            return true;
        } catch (error) {
            return false;
        }
    }

    function wlParseNativeDueReceipt(value) {
        try {
            const receipt = JSON.parse(value);
            const row = receipt && receipt.row;
            const nativeId = String(row && row.id || '').trim();
            const clientSlug = String(row && row.client_slug || '').trim();
            const team = wlMetadataTeamBucket('', row && row.team);
            const updatedAt = String(row && row.updated_at || '').trim();
            if (!receipt || receipt.schema !== WL_NATIVE_DUE_RECEIPT_SIGNAL_SCHEMA
                || receipt.native_committed !== true || receipt.authority !== 'syncview'
                || !String(receipt.nonce || '').trim() || !nativeId || !clientSlug || !team
                || !wlValidRfc3339Timestamp(updatedAt)
                || !Object.prototype.hasOwnProperty.call(row || {}, 'due_date')) return null;
            const dueDate = wlNativeDueDate(row.due_date);
            if (dueDate !== row.due_date) return null;
            return {
                sessionGeneration: _wlPlanSessionGeneration,
                nonce: String(receipt.nonce),
                row: {
                    id: nativeId,
                    client_slug: clientSlug,
                    team,
                    due_date: dueDate,
                    updated_at: updatedAt
                }
            };
        } catch (error) {
            return null;
        }
    }

    function wlNativeDueReceiptDisposition(receipt) {
        const row = receipt && receipt.row;
        const targetEntry = [...(wlState.nativeDueTargetByIssueId || new Map()).entries()]
            .find(([, target]) => target && String(target.id || '') === row.id
                && String(target.clientSlug || '') === row.client_slug && target.team === row.team);
        if (!targetEntry) return wlState.linearMetadataStatus === 'ready' ? 'discard' : 'wait';
        const [issueId, target] = targetEntry;
        const authority = wlState.dueAuthorityByIssueId && wlState.dueAuthorityByIssueId.get(issueId);
        if (!authority) return wlState.linearMetadataStatus === 'ready' ? 'discard' : 'wait';
        if (authority.authority !== 'syncview' || authority.team !== row.team) return 'discard';
        const targetUpdatedAt = String(target.updatedAt || '');
        if (!wlValidRfc3339Timestamp(targetUpdatedAt)) {
            return wlState.linearMetadataStatus === 'ready' ? 'discard' : 'wait';
        }
        const issue = (wlState.issueSnapshot || [])
            .find(value => String(value && value.id || '') === String(issueId));
        const currentDue = issue && issue.dueDate ? String(issue.dueDate).slice(0, 10) : null;
        if (targetUpdatedAt === row.updated_at && currentDue === row.due_date) return 'consumed';
        if (Date.parse(targetUpdatedAt) > Date.parse(row.updated_at)) return 'consumed';
        return 'refresh';
    }

    async function wlRetryPendingNativeDueReceipts() {
        if (_wlNativeDueReceiptRetryPromise) return _wlNativeDueReceiptRetryPromise;
        const retryGeneration = _wlNativeDueReceiptGeneration;
        let attemptedRefresh = false;
        const run = async () => {
            if (!_wlPendingNativeDueReceiptByTarget.size
                || !document.querySelector('.workload-view')
                || !_syncviewStaffIdentityForHeaders()) return false;
            if (wlState.loading || wlState.refreshing
                || wlState.planStatus === 'loading' || wlState.planStatus === 'refreshing'
                || wlState.linearMetadataStatus === 'loading' || wlState.linearMetadataStatus === 'refreshing'
                || _wlPlanWriteInFlight.size || _wlDueWriteInFlight.size || _wlBackgroundRefreshPromise) {
                return false;
            }
            let needsRefresh = false;
            for (const [key, receipt] of _wlPendingNativeDueReceiptByTarget) {
                if (!receipt || receipt.sessionGeneration !== _wlPlanSessionGeneration) {
                    _wlPendingNativeDueReceiptByTarget.delete(key);
                    continue;
                }
                const disposition = wlNativeDueReceiptDisposition(receipt);
                if (disposition === 'consumed' || disposition === 'discard') {
                    _wlPendingNativeDueReceiptByTarget.delete(key);
                } else {
                    needsRefresh = true;
                }
            }
            if (!needsRefresh || wlState.fetchedAt == null) return false;
            const sessionGeneration = _wlPlanSessionGeneration;
            attemptedRefresh = true;
            const refreshed = await wlRefetchSilent({ sensitiveOnly: true });
            if (refreshed !== true || sessionGeneration !== _wlPlanSessionGeneration) return false;
            for (const [key, receipt] of _wlPendingNativeDueReceiptByTarget) {
                if (!receipt || receipt.sessionGeneration !== _wlPlanSessionGeneration) {
                    _wlPendingNativeDueReceiptByTarget.delete(key);
                    continue;
                }
                const disposition = wlNativeDueReceiptDisposition(receipt);
                if (disposition === 'consumed' || disposition === 'discard') {
                    _wlPendingNativeDueReceiptByTarget.delete(key);
                }
            }
            return true;
        };
        const pending = run();
        _wlSetNativeDueReceiptRetryPromise(pending);
        try { return await pending; }
        finally {
            if (_wlNativeDueReceiptRetryPromise === pending) {
                _wlSetNativeDueReceiptRetryPromise(null);
                if (_wlPendingNativeDueReceiptByTarget.size
                    && _wlNativeDueReceiptGeneration !== retryGeneration) {
                    wlScheduleNativeDueReceiptRetry();
                } else if (_wlPendingNativeDueReceiptByTarget.size && attemptedRefresh) {
                    wlScheduleNativeDueReceiptRetryLater();
                } else if (!_wlPendingNativeDueReceiptByTarget.size) {
                    wlCancelNativeDueReceiptRetryTimer(true);
                }
            }
        }
    }

    function wlCancelNativeDueReceiptRetryTimer(resetAttempt) {
        if (_wlNativeDueReceiptRetryTimer !== null) clearTimeout(_wlNativeDueReceiptRetryTimer);
        _wlSetNativeDueReceiptRetryTimer(null);
        if (resetAttempt) _wlSetNativeDueReceiptRetryAttempt(0);
    }

    function wlScheduleNativeDueReceiptRetryLater() {
        if (!_wlPendingNativeDueReceiptByTarget.size || _wlNativeDueReceiptRetryTimer !== null
            || _wlNativeDueReceiptRetryAttempt >= WL_NATIVE_DUE_RECEIPT_RETRY_DELAYS_MS.length) return false;
        const sessionGeneration = _wlPlanSessionGeneration;
        const receiptGeneration = _wlNativeDueReceiptGeneration;
        const delay = WL_NATIVE_DUE_RECEIPT_RETRY_DELAYS_MS[_wlTakeNativeDueReceiptRetryAttempt()];
        _wlSetNativeDueReceiptRetryTimer(setTimeout(() => {
            _wlSetNativeDueReceiptRetryTimer(null);
            if (sessionGeneration !== _wlPlanSessionGeneration
                || receiptGeneration !== _wlNativeDueReceiptGeneration
                || !_wlPendingNativeDueReceiptByTarget.size) return;
            wlScheduleNativeDueReceiptRetry();
        }, delay));
        return true;
    }

    function wlScheduleNativeDueReceiptRetry() {
        if (!_wlPendingNativeDueReceiptByTarget.size) return false;
        try {
            wlCancelNativeDueReceiptRetryTimer(false);
            const pending = wlRetryPendingNativeDueReceipts();
            if (pending && typeof pending.catch === 'function') pending.catch(() => {});
            return true;
        } catch (error) {
            return false;
        }
    }

    async function _wlOnNativeDueReceiptStorage(event) {
        try {
            if (!event || event.key !== WL_NATIVE_DUE_RECEIPT_SIGNAL_KEY || !event.newValue) return false;
            if (event.storageArea && event.storageArea !== localStorage) return false;
            if (!_syncviewStaffIdentityForHeaders()) return false;
            const receipt = wlParseNativeDueReceipt(event.newValue);
            if (!receipt) return false;
            const row = receipt.row;
            const key = [row.id, row.client_slug, row.team].join('\u0000');
            const current = _wlPendingNativeDueReceiptByTarget.get(key);
            if (!current && _wlPendingNativeDueReceiptByTarget.size >= 100) return false;
            if (!current || Date.parse(current.row.updated_at) < Date.parse(row.updated_at)) {
                _wlPendingNativeDueReceiptByTarget.set(key, receipt);
                _wlNextNativeDueReceiptGeneration();
                wlCancelNativeDueReceiptRetryTimer(true);
            } else {
                wlCancelNativeDueReceiptRetryTimer(false);
            }
            // Native writes do not advance workload_issues.synced_at. Keep the
            // exact receipt in memory until a guarded sensitive read observes its
            // due value/CAS cursor (or a newer cursor), including across a cold
            // hydrate, an older refresh, or an in-flight plan/due save.
            return await wlRetryPendingNativeDueReceipts();
        } catch (error) {
            return false;
        }
    }

    async function _wlDueWriteRequest(issue, dueDate, route) {
        await _syncviewRequireStaffIdentity('workload-linear');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), WL_LINEAR_WRITE_TIMEOUT_MS);
        try {
            if (route && route.authority === 'syncview') {
                return await _writeUiTrackSave('workload', 'workload_due_save', { id: String(issue && issue.id || '') }, () => fetch(PROD_WRITE_EF_URL, {
                    method: 'POST',
                    cache: 'no-store',
                    signal: controller.signal,
                    headers: _syncviewEfHeaders({
                        apikey: CAL_SUPABASE_ANON_KEY,
                        Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY,
                        Accept: 'application/json',
                        'Content-Type': 'application/json'
                    }, PROD_WRITE_EF_URL),
                    body: JSON.stringify({
                        operation: 'due',
                        surface: 'workload',
                        entity: 'deliverable',
                        id: route.nativeId,
                        request_id: wlDueWriteRequestId(issue && issue.id),
                        source_edited_at: new Date().toISOString(),
                        expected_updated_at: route.nativeUpdatedAt,
                        due_date: dueDate || ''
                    })
                }));
            }
            return await _writeUiTrackSave('workload', 'workload_due_save', { id: String(issue && issue.id || '') }, () => fetch(WORKLOAD_LINEAR_URL, {
                method: 'POST',
                cache: 'no-store',
                signal: controller.signal,
                headers: _syncviewEfHeaders({ 'Content-Type': 'application/json' }, WORKLOAD_LINEAR_URL),
                body: JSON.stringify({
                    action: 'set_due_date',
                    issue_id: String(issue.id || ''),
                    client: String(issue.clientName || ''),
                    due_date: dueDate
                })
            }));
        } finally {
            clearTimeout(timeout);
        }
    }

    async function wlSetDueDate(issueId, value) {
        const key = String(issueId || '');
        const issue = (wlState.allActiveSubs || []).find(row => String(row.id || '') === key);
        if (!issue || wlIsTweaksNeeded(issue)) return false;
        if (!wlLinearEditingEnabled(issue)) {
            if (typeof showNotify === 'function') {
                showNotify('Due-date editing unavailable', 'Workload labels are not current. Refresh and try again.');
            }
            renderWorkloadAll();
            return false;
        }
        if (_wlDueWriteInFlight.has(key)) return false;
        const dueDate = value == null || value === '' ? null : String(value).slice(0, 10);
        try {
            if (dueDate !== null) wlNativeDueDate(dueDate);
        } catch (error) {
            return false;
        }
        const route = wlDueWriteRoute(issue);
        if (!route) {
            if (typeof showNotify === 'function') {
                showNotify('Due-date editing unavailable', 'The current write authority could not be verified. Refresh and try again.');
            }
            renderWorkloadAll();
            return false;
        }
        const previousDate = String(issue.dueDate || '').slice(0, 10) || null;
        if (dueDate === previousDate) return true;

        const sessionGeneration = _wlPlanSessionGeneration;
        const token = {};
        // Any snapshot already in flight predates this optimistic Linear write.
        // Invalidate it now so a fast successful save cannot be overwritten by
        // an older metadata response after the write token is removed.
        _wlNextPlanLoadGeneration();
        _wlDueWriteInFlight.set(key, token);
        wlApplyDueLocal(key, dueDate);
        renderWorkloadAll();
        try {
            const resp = await _wlDueWriteRequest(issue, dueDate, route);
            if (sessionGeneration !== _wlPlanSessionGeneration) return false;
            let json = null;
            try { json = await resp.json(); } catch (error) {}
            if (route.authority === 'syncview') {
                const row = json && json.row;
                const exactNativeAck = resp.ok && json && json.ok === true
                    && json.native_committed === true
                    && json.authority === 'syncview'
                    && row && String(row.id || '') === String(route.nativeId)
                    && Object.prototype.hasOwnProperty.call(row, 'due_date')
                    && row.due_date === dueDate
                    && wlValidRfc3339Timestamp(row.updated_at);
                if (exactNativeAck) {
                    if (!wlAdoptNativeDueGatewayRow(row)) throw new Error('native_due_receipt_mismatch');
                    wlPublishNativeDueReceipt(row);
                    if (typeof _prodApplyGatewayRow === 'function') _prodApplyGatewayRow(row);
                    return true;
                }
                const adoptedConflict = resp.status === 409 && json && json.error === 'write_conflict'
                    && row && String(row.id || '') === String(route.nativeId)
                    && wlAdoptNativeDueGatewayRow(row);
                if (adoptedConflict) {
                    wlPublishNativeDueReceipt(row);
                    if (typeof _prodApplyGatewayRow === 'function') _prodApplyGatewayRow(row);
                    if (typeof showNotify === 'function') {
                        showNotify('Due date changed elsewhere', 'The current native due date was reloaded. Review it and try again.');
                    }
                    return false;
                }
                const error = new Error((json && json.error) || ('HTTP ' + resp.status));
                error.status = resp.status;
                error.code = json && json.error;
                throw error;
            }
            const hasDueDateReceipt = !!json && Object.prototype.hasOwnProperty.call(json, 'due_date');
            const acknowledgedDate = hasDueDateReceipt && json.due_date === null ? null : json && json.due_date;
            const mirrorUpdated = json && json.mirror_updated;
            const mirrorPending = json && json.mirror_pending;
            const updatedAt = json && json.updated_at;
            const validUpdatedAt = wlValidRfc3339Timestamp(updatedAt);
            const exactAck = resp.ok && json && json.ok === true
                && json.linear_committed === true
                && hasDueDateReceipt
                && String(json.issue_id || '') === key
                && (acknowledgedDate === null || typeof acknowledgedDate === 'string')
                && acknowledgedDate === dueDate
                && validUpdatedAt
                && (mirrorUpdated === 0 || mirrorUpdated === 1)
                && mirrorPending === (mirrorUpdated === 0);
            if (!exactAck) {
                const error = new Error((json && json.error) || ('HTTP ' + resp.status));
                error.status = resp.status;
                error.code = json && json.error;
                throw error;
            }
            wlApplyDueLocal(key, acknowledgedDate);
            if (mirrorPending && typeof showNotify === 'function') {
                showNotify('Due date updated in Linear', 'Workload is catching up. The new due date is kept here in the meantime.');
            }
            return true;
        } catch (error) {
            if (sessionGeneration !== _wlPlanSessionGeneration) return false;
            wlApplyDueLocal(key, previousDate);
            const authorityErrorCode = String(error && error.code || '');
            const authorityStale = authorityErrorCode === 'authority_unavailable'
                || (route.authority === 'linear' && authorityErrorCode === 'team_is_syncview_authoritative')
                || (route.authority === 'syncview' && authorityErrorCode === 'team_is_linear_authoritative');
            if (authorityStale) {
                if (wlState.dueAuthorityByIssueId) wlState.dueAuthorityByIssueId.delete(key);
                if (wlState.nativeDueTargetByIssueId) wlState.nativeDueTargetByIssueId.delete(key);
                wlState.linearMetadataStatus = 'stale';
                wlState.linearMetadataError = 'Due-date authority changed. Workload is refreshing its write route.';
                wlState.linearMetadataWithheldOnly = 0;
                setTimeout(() => {
                    try {
                        const refresh = wlQueueSensitiveAuthorityRefresh(sessionGeneration);
                        if (refresh && typeof refresh.catch === 'function') refresh.catch(() => {});
                    } catch (refreshError) {}
                }, 0);
            }
            if (Number(error && error.status) === 401) _syncviewStaffIdentityClear();
            if (Number(error && error.status) === 403) wlPurgePlanSensitiveState();
            if (typeof showNotify === 'function') {
                showNotify(authorityStale
                    ? 'Due-date authority changed'
                    : route.authority === 'linear' ? "Couldn't update the Linear due date" : "Couldn't update the due date",
                    authorityStale
                        ? 'The previous due date was restored while Workload refreshes the current owner.'
                        : 'The previous due date was restored. Please try again.');
            }
            return false;
        } finally {
            if (_wlDueWriteInFlight.get(key) === token) _wlDueWriteInFlight.delete(key);
            wlScheduleNativeDueReceiptRetry();
            if (document.querySelector('.workload-view')) renderWorkloadAll();
        }
    }

    // Workload fail-closed boundary. The optimistic value is already visible when
    // this runs; anything except one actually-written, matching row restores
    // the precise previous value and tells the user.
    let _wlLastPlanWriteRefusal = 0;   // 401 or 403 from the last refused plan write
    async function _wlPersistPlanDate(issue, planDate, previousDate, sessionGeneration, quiet) {
        try {
            const resp = await _wlPlanWriteRequest(issue, planDate);
            if (sessionGeneration != null && sessionGeneration !== _wlPlanSessionGeneration) return false;
            let json = null;
            try { json = await resp.json(); } catch (e) {}
            /* A refused save must PUT THE CARD BACK, like every other failure
               below does. These two branches used to return without restoring
               it, so the card sat on its new day with nothing saved: it looked
               moved until the next refresh, and a group drag (quiet) suppressed
               even the toast, so the summary could report "put back" while
               nothing was. That is the shape of the 2026-09-14 report that
               drags do not survive a refresh. */
            /* The category of the refusal, for callers that summarise several
               writes at once. Inferring it afterwards from the purged state
               cannot tell 401 from 403 — both purge — and the two need
               opposite advice: sign in again, versus this account may not
               edit work days at all. */
            if (resp.status === 401 || resp.status === 403) _wlLastPlanWriteRefusal = resp.status;
            if (resp.status === 401) {
                /* Restore BEFORE clearing the identity, exactly as the 403
                   branch restores before its purge. _syncviewStaffIdentityClear
                   runs the global sensitive-state purge, which drops
                   planByIssueId; restoring afterwards would write a staff-only
                   plan date back in on the far side of sign-out, where the
                   generation check then exits and leaves it to surface on a
                   later identity's warm paint. */
                wlApplyPlanLocal(issue.id, previousDate);
                _syncviewStaffIdentityClear();
                if (!quiet) renderWorkloadAll();
                if (!quiet && typeof showNotify === 'function') {
                    /* NOT "it was put back": the restore above is itself wiped
                       by the identity purge, which clears every pin, so the
                       card lands on its deadline fallback — a third day,
                       neither where it was dropped nor where it came from. The
                       browser harness caught the copy claiming otherwise. Say
                       what actually happened. */
                    showNotify("Couldn't save the work day", 'Staff sign-in expired. Saved work days are hidden until you sign in again.');
                }
                return false;
            }
            if (resp.status === 403) {
                /* The purge clears the pins this restore would write, so the
                   card is put back FIRST and the purge takes it with the rest —
                   leaving the board in one honest state rather than showing a
                   pin the server refused. */
                wlApplyPlanLocal(issue.id, previousDate);
                wlPurgePlanSensitiveState();
                wlState.planError = 'This staff account cannot edit saved work days.';
                if (!quiet) renderWorkloadAll();
                if (!quiet && typeof showNotify === 'function') {
                    showNotify("Couldn't save the work day", 'This staff account cannot edit saved work days.');
                }
                return false;
            }
            const saved = json && json.plan;
            if (!resp.ok || !json || json.ok !== true || json.updated !== 1
                || !saved || String(saved.issue_id || '') !== String(issue.id || '')
                || (saved.plan_date == null ? null : String(saved.plan_date).slice(0, 10)) !== planDate) {
                throw new Error((json && json.error) || ('HTTP ' + resp.status));
            }
            if (typeof wlAnnouncePlanSaved === 'function') wlAnnouncePlanSaved();   // opaque hint to other open boards; confirmed saves only
            return true;
        } catch (error) {
            if (sessionGeneration != null && sessionGeneration !== _wlPlanSessionGeneration) return false;
            wlApplyPlanLocal(issue.id, previousDate);
            if (!quiet) renderWorkloadAll();
            if (!quiet && typeof showNotify === 'function') {
                showNotify("Couldn't save the work day", 'It was put back — please try again.');
            }
            return false;
        }
    }

    async function wlSetPlanDate(issueId, value) {
        const key = String(issueId || '');
        const issue = (wlState.allActiveSubs || []).find(row => String(row.id || '') === key);
        if (!issue || wlIsTweaksNeeded(issue)) return false;
        if (!wlPlanEditingEnabled()) {
            if (typeof showNotify === 'function') {
                showNotify('Work-day editing unavailable', 'Saved work days are not current. Refresh and try again.');
            }
            wlResetPlanDisplay(key);
            return false;
        }
        if (_wlPlanWriteInFlight.has(key)) {
            wlResetPlanDisplay(key);
            return false;
        }

        const planDate = value == null || value === '' ? null : String(value).slice(0, 10);
        if (planDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(planDate)) {
            wlResetPlanDisplay(key);
            return false;
        }
        const previousDate = wlPlanDate(issue) || null;
        if (planDate === previousDate) {
            wlResetPlanDisplay(key);
            return true;
        }

        const token = { generation: _wlNextPlanWriteGeneration() };
        const sessionGeneration = _wlPlanSessionGeneration;
        _wlPlanLastWriteGeneration.set(key, token.generation);
        _wlPlanWriteInFlight.set(key, token);
        wlApplyPlanLocal(key, planDate);
        renderWorkloadAll();
        wlFocusPlanItem(key);
        const saved = await _wlPersistPlanDate(issue, planDate, previousDate, sessionGeneration);
        if (sessionGeneration !== _wlPlanSessionGeneration) return false;
        _wlPlanLastWriteGeneration.set(key, _wlNextPlanWriteGeneration());
        if (_wlPlanWriteInFlight.get(key) === token) _wlPlanWriteInFlight.delete(key);
        wlScheduleNativeDueReceiptRetry();
        renderWorkloadAll();
        wlFocusPlanItem(key);
        return saved;
    }

    async function wlMovePlanGroup(sourceDate, assigneeId, clientName, targetDate) {
        const source = String(sourceDate || '').slice(0, 10);
        const target = String(targetDate || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(source) || !/^\d{4}-\d{2}-\d{2}$/.test(target)) return false;
        if (source === target) return true;

        const seen = new Set();
        const issues = (wlState.calendarByDate.get(source) || []).filter(issue => {
            const key = String(issue && issue.id || '');
            if (!key || seen.has(key)) return false;
            if (String(issue.assigneeId || '') !== String(assigneeId || '')) return false;
            if (String(issue.clientName || '') !== String(clientName || '')) return false;
            seen.add(key);
            return true;
        });
        const unavailable = !issues.length || !wlPlanEditingEnabled()
            || issues.some(issue => wlIsTweaksNeeded(issue) || _wlPlanWriteInFlight.has(String(issue.id || '')));
        if (unavailable) {
            if (typeof showNotify === 'function') {
                showNotify('Group move unavailable', 'Refresh Workload and try again.');
            }
            return false;
        }

        const sessionGeneration = _wlPlanSessionGeneration;
        const moves = issues.map(issue => {
            const key = String(issue.id || '');
            const token = { generation: _wlNextPlanWriteGeneration() };
            _wlPlanLastWriteGeneration.set(key, token.generation);
            _wlPlanWriteInFlight.set(key, token);
            return { issue, key, token, previousDate: wlPlanDate(issue) || null };
        });

        // Paint the complete group on its target before the first request.
        // Persistence remains deliberately sequential through the shipped
        // one-row fail-closed contract.
        for (const move of moves) wlApplyPlanLocal(move.key, target);
        renderWorkloadAll();

        let moved = 0;
        _wlLastPlanWriteRefusal = 0;
        for (const move of moves) {
            const saved = await _wlPersistPlanDate(
                move.issue, target, move.previousDate, sessionGeneration, true
            );
            if (sessionGeneration !== _wlPlanSessionGeneration) break;
            if (saved) moved++;
            _wlPlanLastWriteGeneration.set(move.key, _wlNextPlanWriteGeneration());
            if (_wlPlanWriteInFlight.get(move.key) === move.token) {
                _wlPlanWriteInFlight.delete(move.key);
            }
        }

        if (sessionGeneration === _wlPlanSessionGeneration) {
            for (const move of moves) {
                if (_wlPlanWriteInFlight.get(move.key) === move.token) {
                    _wlPlanWriteInFlight.delete(move.key);
                }
            }
            wlScheduleNativeDueReceiptRetry();
            renderWorkloadAll();
        }
        const refusal = _wlLastPlanWriteRefusal;
        if (moved !== moves.length && typeof showNotify === 'function') {
            /* "Kept its previous work day" is only true while this browser
               still holds the saved plans. An auth refusal purges every pin,
               so those cards fall to their deadline placement instead — the
               Workload harness measured the summary claiming otherwise. Say
               which actually happened, and take the category from the REFUSAL
               rather than from the purged state: 401 and 403 both purge, but
               only one of them is fixed by signing in again. */
            showNotify(
                `Moved ${moved} of ${moves.length} — ${moves.length - moved} not saved`,
                refusal === 401
                    ? 'Staff sign-in expired. Saved work days are hidden until you sign in again.'
                    : (refusal === 403
                        ? 'This staff account cannot edit saved work days. Saved work days are hidden.'
                        : 'Each failed item kept its previous work day.')
            );
        }
        return moved === moves.length;
    }

    // Single delegated handler on the shell root. Attached once per shell
    // via a sentinel attribute so repeat calls to initWorkloadView (e.g. when
    // the user re-navigates to Workload while a fetch is in flight) never
    // stack handlers on the same DOM nodes.
    function wlWireToolbar() {
        const root = document.querySelector('.workload-view');
        if (!root || root.dataset.wlWired === '1') return;
        root.dataset.wlWired = '1';

        root.addEventListener('click', (e) => {
            const dragHandle = e.target.closest('[data-wl-drag-handle]');
            const countBadge = e.target.closest('[data-wl-count-badge]');
            const rollup     = e.target.closest('[data-wl-rollup]');
            const popClose   = e.target.closest('[data-wl-popover-close]');
            const issueOpen  = e.target.closest('[data-wl-issue-open]');
            const deadlineOpen = e.target.closest('[data-wl-deadline-open]');
            const planClear  = e.target.closest('[data-wl-plan-clear]');
            const ddTrigger  = e.target.closest('[data-wl-dropdown-trigger]');
            const ddItem     = e.target.closest('[data-wl-dropdown-item]');
            const deadlineMode = e.target.closest('[data-wl-deadline-mode]');
            if (dragHandle) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            if (popClose) { e.preventDefault(); wlClosePopover(true); return; }
            if (planClear) {
                e.preventDefault();
                const issueId = planClear.getAttribute('data-wl-plan-clear') || '';
                setTimeout(() => wlSetPlanDate(issueId, null), 0);
                return;
            }
            if (issueOpen) {
                e.preventDefault();
                wlOpenRollupPopover(issueOpen);
                return;
            }
            if (deadlineOpen) {
                e.preventDefault();
                wlOpenRollupPopover(deadlineOpen);
                return;
            }
            if (ddTrigger) {
                e.preventDefault();
                const wrap = ddTrigger.closest('.wl-dropdown');
                const menu = wrap?.querySelector('.dropdown-menu');
                const willOpen = !ddTrigger.classList.contains('open');
                wlCloseDropdowns(willOpen ? wrap : null);
                ddTrigger.classList.toggle('open', willOpen);
                ddTrigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
                menu?.classList.toggle('open', willOpen);
                return;
            }
            if (ddItem) {
                e.preventDefault();
                const kind  = ddItem.getAttribute('data-wl-dropdown-item');
                const value = ddItem.getAttribute('data-wl-value');
                if (kind === 'editor') { wlState.editor = value; _wlCreativePending = null; }
                wlCloseDropdowns(null);
                renderWorkloadAll();
                return;
            }
            if (countBadge && rollup) {
                // Honour cmd/ctrl/shift-click so power users can still open
                // the parent Linear issue in a new tab from a chip.
                if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                // Intercept the click on the chip / count badge so it opens
                // the popover instead of following the rollup <a> to Linear.
                e.preventDefault();
                // Toggle: clicking the same rollup again closes it.
                const pop = document.getElementById('wlPopover');
                if (pop && pop.classList.contains('open') && wlState.popoverAnchor === rollup) {
                    wlClosePopover(true);
                    return;
                }
                wlOpenRollupPopover(rollup);
                return;
            }
            const navBtn    = e.target.closest('[data-wl-nav]');
            const viewBtn   = e.target.closest('[data-wl-view]');
            const teamBtn   = e.target.closest('[data-wl-team]');
            if (navBtn && root.contains(navBtn)) {
                const action = navBtn.getAttribute('data-wl-nav');
                if (action === 'prev') { wlShiftPeriod(-1); renderWorkloadAll(); return; }
                if (action === 'next') { wlShiftPeriod(1);  renderWorkloadAll(); return; }
                if (action === 'today') {
                    const today = wlWorkloadTodayISO();
                    const n = wlParseISO(today);
                    wlState.year = n.getFullYear(); wlState.month = n.getMonth();
                    wlState.weekStart = wlWeekMondayISO(today);
                    renderWorkloadAll();
                    return;
                }
                if (action === 'refresh') { wlManualRefresh(); return; }
            }
            if (viewBtn && root.contains(viewBtn)) {
                const mode = viewBtn.getAttribute('data-wl-view');
                if (mode !== 'week' && mode !== 'month') return;
                if (mode === 'month' && wlState.showDeadlines) return;
                wlState.viewMode = mode;
                try { localStorage.setItem(WL_VIEW_PREF_KEY, mode); } catch {}
                renderWorkloadAll();
                return;
            }
            if (teamBtn && root.contains(teamBtn)) {
                wlState.team = teamBtn.getAttribute('data-wl-team') || 'all';
                renderWorkloadAll();
                return;
            }
            if (deadlineMode && root.contains(deadlineMode)) {
                wlState.showDeadlines = deadlineMode.getAttribute('data-wl-deadline-mode') === 'deadlines';
                try { localStorage.setItem(WL_DEADLINE_PREF_KEY, wlState.showDeadlines ? '1' : '0'); } catch {}
                if (wlState.showDeadlines && wlState.viewMode !== 'week') {
                    wlState.viewMode = 'week';
                    try { localStorage.setItem(WL_VIEW_PREF_KEY, 'week'); } catch {}
                }
                renderWorkloadAll();
                return;
            }
        });

        root.addEventListener('change', (e) => {
            const wrap = e.target && e.target.closest && e.target.closest('[data-wl-due-issue]');
            if (!wrap || !e.target.matches('input[type="date"]')) return;
            const issueId = wrap.getAttribute('data-wl-due-issue') || '';
            const nextDate = e.target.value || null;
            // The shared branded picker dispatches change before it closes.
            // Let it restore focus first, then repaint the calendar.
            setTimeout(() => wlSetDueDate(issueId, nextDate), 0);
        });

        const clearDropTargets = () => {
            root.querySelectorAll('[data-wl-day].is-plan-drop-target').forEach(day => day.classList.remove('is-plan-drop-target'));
            root.querySelectorAll('.workload-plan-item.is-dragging').forEach(card => card.classList.remove('is-dragging'));
            root.querySelectorAll('.workload-day-card-chip.is-dragging, .workload-timeline-plan-chip.is-dragging').forEach(chip => chip.classList.remove('is-dragging'));
        };
        const resolveDropDay = (target, clientX) => {
            if (target && target.closest && target.closest('.workload-timeline-editor-rail')) return null;
            const direct = target && target.closest && target.closest('[data-wl-day]');
            if (direct) return direct;
            const stage = target && target.closest && target.closest('[data-wl-timeline-stage]');
            if (!stage || !Number.isFinite(clientX)) return null;
            const dayColumns = stage.querySelector('.workload-timeline-day-columns');
            if (!dayColumns) return null;
            const rect = dayColumns.getBoundingClientRect();
            if (!rect.width) return null;
            if (clientX < rect.left || clientX > rect.right) return null;
            const index = Math.max(0, Math.min(4, Math.floor((clientX - rect.left) / (rect.width / 5))));
            return dayColumns.querySelector(`[data-wl-day-index="${index}"]`);
        };
        const clearDragState = () => {
            delete root.dataset.wlDragIssue;
            delete root.dataset.wlDragGroupDate;
            delete root.dataset.wlDragGroupAssignee;
            delete root.dataset.wlDragGroupClient;
            clearDropTargets();
        };
        root.addEventListener('dragstart', (e) => {
            const group = e.target.closest('[data-wl-drag-handle="group"][data-wl-plan-group-drag]');
            if (group) {
                if (!wlPlanEditingEnabled() || group.getAttribute('draggable') !== 'true') {
                    e.preventDefault();
                    return;
                }
                const sourceDate = group.getAttribute('data-wl-date') || '';
                const assigneeId = group.getAttribute('data-wl-assignee-id') || '';
                const clientName = group.getAttribute('data-wl-client') || '';
                if (!sourceDate || !assigneeId || !clientName) { e.preventDefault(); return; }
                delete root.dataset.wlDragIssue;
                root.dataset.wlDragGroupDate = sourceDate;
                root.dataset.wlDragGroupAssignee = assigneeId;
                root.dataset.wlDragGroupClient = clientName;
                group.closest('.workload-day-card-chip, .workload-timeline-plan-chip')?.classList.add('is-dragging');
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', 'workload-client-group');
                }
                return;
            }
            const card = e.target.closest('[data-wl-drag-handle="issue"][data-wl-plan-drag]');
            if (!card || !wlPlanEditingEnabled()) { e.preventDefault(); return; }
            const issueId = card.getAttribute('data-wl-plan-drag') || '';
            if (!issueId || _wlPlanWriteInFlight.has(issueId)) { e.preventDefault(); return; }
            delete root.dataset.wlDragGroupDate;
            delete root.dataset.wlDragGroupAssignee;
            delete root.dataset.wlDragGroupClient;
            root.dataset.wlDragIssue = issueId;
            card.closest('.workload-plan-item')?.classList.add('is-dragging');
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', issueId);
            }
        });
        root.addEventListener('dragover', (e) => {
            const day = resolveDropDay(e.target, e.clientX);
            if (!day || (!root.dataset.wlDragIssue && !root.dataset.wlDragGroupDate)) return;
            e.preventDefault();
            root.querySelectorAll('[data-wl-day].is-plan-drop-target').forEach(other => {
                if (other !== day) other.classList.remove('is-plan-drop-target');
            });
            day.classList.add('is-plan-drop-target');
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        });
        root.addEventListener('dragleave', (e) => {
            const day = e.target.closest('[data-wl-day]');
            if (day && (!e.relatedTarget || !day.contains(e.relatedTarget))) day.classList.remove('is-plan-drop-target');
        });
        root.addEventListener('drop', (e) => {
            const day = resolveDropDay(e.target, e.clientX);
            const issueId = root.dataset.wlDragIssue || (e.dataTransfer && e.dataTransfer.getData('text/plain')) || '';
            const sourceDate = root.dataset.wlDragGroupDate || '';
            const assigneeId = root.dataset.wlDragGroupAssignee || '';
            const clientName = root.dataset.wlDragGroupClient || '';
            if (!day || (!issueId && !sourceDate)) return;
            e.preventDefault();
            const targetDate = day.getAttribute('data-wl-day') || '';
            clearDragState();
            if (sourceDate) wlMovePlanGroup(sourceDate, assigneeId, clientName, targetDate);
            else wlSetPlanDate(issueId, targetDate);
        });
        root.addEventListener('dragend', () => {
            clearDragState();
        });

        // Dismiss the popover / dropdowns on outside click or Escape.
        document.addEventListener('click', (e) => {
            if (e.target.closest && e.target.closest('#svDatePickerPopup')) return;
            const pop = document.getElementById('wlPopover');
            if (pop && pop.classList.contains('open')
                && !pop.contains(e.target)
                && !e.target.closest('[data-wl-count-badge]')
                && !e.target.closest('[data-wl-issue-open]')
                && !e.target.closest('[data-wl-deadline-open]')) {
                wlClosePopover(false);
            }
            if (!e.target.closest('.wl-dropdown')) wlCloseDropdowns(null);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                // First Escape belongs to the body-portaled branded date picker;
                // the next Escape closes the Workload popover.
                if (document.getElementById('svDatePickerPopup')) return;
                wlClosePopover(true);
                wlCloseDropdowns(null);
            }
        });
    }

    function wlShiftPeriod(delta) {
        if (wlState.viewMode === 'week') {
            // Monday-anchored work weeks advance by one calendar week.
            wlState.weekStart = wlAddDays(wlState.weekStart, delta * 7);
        } else {
            let y = wlState.year, m = wlState.month + delta;
            while (m < 0)  { m += 12; y--; }
            while (m > 11) { m -= 12; y++; }
            wlState.year = y; wlState.month = m;
        }
    }

    function wlPopulateFilterOptions() {
        const all = wlState.allActiveSubs || [];
        // Editors: scoped to active team filter so Video pill hides graphics-only assignees.
        const editors = [...new Map(all.filter(s => s.assigneeId &&
                wlIssueEditorAllowed(s) &&
                (wlState.team === 'all' || wlTeamBucket(s.teamKey, s.teamName) === wlState.team))
            .map(s => [s.assigneeId, wlDisplayName(s.assigneeName) || 'Unknown'])).entries()]
            .sort((a, b) => String(a[1]).localeCompare(String(b[1])));
        // Clients: every name from the canonical Clients Info sheet, sorted
        // alphabetically. Using the sheet (not just clients with active
        // sub-issues) keeps every approved client searchable even when their
        // workload is currently empty.
        const clients = WL_CLIENT_NAMES.slice().sort((a, b) => a.localeCompare(b));
        wlState.clientOptions = clients;

        // Reset selected value if it's no longer valid for the current data.
        if (_wlCreativePending) {
            const me = _wlCreativePending;
            const myName = String(wlDisplayName(me.name) || '').trim().toLowerCase();
            const hit = editors.find(([id, name]) => id === me.id || (myName && String(name).trim().toLowerCase() === myName));
            if (hit) { _wlCreativePending = null; if (wlState.editor === 'all') wlState.editor = hit[0]; }
        }
        if (wlState.editor !== 'all' && !editors.some(([id]) => id === wlState.editor)) wlState.editor = 'all';
        if (wlState.client !== 'all' && !clients.includes(wlState.client))              wlState.client = 'all';

        const editorItems = [['all', 'All editors'], ...editors];

        const editorMenu = document.querySelector('[data-wl-dropdown-menu="editor"]');
        if (editorMenu) {
            editorMenu.innerHTML = editorItems.map(([id, name]) =>
                `<button type="button" class="dropdown-item${id === wlState.editor ? ' active' : ''}" data-wl-dropdown-item="editor" data-wl-value="${wlEscape(id)}" data-wl-label="${wlEscape(name)}">${wlEscape(name)}</button>`
            ).join('');
        }

        const editorLabel = document.querySelector('[data-wl-dropdown-trigger="editor"] [data-wl-dropdown-label]');
        if (editorLabel) {
            const match = editorItems.find(([id]) => id === wlState.editor);
            editorLabel.textContent = match ? match[1] : 'All editors';
        }

        // Sync the client search bar to the current filter state without
        // stomping on the user's in-progress typing.
        const searchInput = document.getElementById('wlClientSearchInput');
        const searchClear = document.getElementById('wlClientSearchClear');
        if (searchInput && document.activeElement !== searchInput) {
            searchInput.value = wlState.client === 'all' ? '' : wlState.client;
        }
        if (searchClear) searchClear.hidden = wlState.client === 'all';

        document.querySelectorAll('[data-wl-team]').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-wl-team') === wlState.team);
        });
        document.querySelectorAll('[data-wl-view]').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-wl-view') === wlState.viewMode);
        });
    }

    // Wire the client search bar: typing filters the suggestions list,
    // clicking a suggestion (or pressing Enter when it's the only match)
    // sets the workload's client filter, and the × button or Escape clears
    // it back to "all clients".
    function wlWireClientSearch() {
        const input    = document.getElementById('wlClientSearchInput');
        const results  = document.getElementById('wlClientSearchResults');
        const clearBtn = document.getElementById('wlClientSearchClear');
        if (!input || !results || input.dataset.wired === '1') return;
        input.dataset.wired = '1';

        const close = () => { results.hidden = true; results.innerHTML = ''; };
        const matches = (q) => {
            const opts = wlState.clientOptions || [];
            if (!q) return opts;
            const needle = q.toLowerCase();
            return opts.filter(c => c.toLowerCase().includes(needle));
        };
        const render = (q) => {
            const list = matches(q);
            // Tiny "fetching workload data…" row at the top while the
            // background fetch is in flight on first load. The dropdown is
            // still usable — picking a client is harmless before data
            // arrives — but the spinner makes the wait visible.
            const loadingRow = (wlState.loading && !wlState.fetchedAt)
                ? '<div class="wl-search-loading">' + _svLoadingSkeletonHtml('linear-search') + '</div>'
                : '';
            if (!list.length) {
                results.innerHTML = loadingRow + '<div class="wl-client-search-result empty">No clients match</div>';
            } else {
                const showAll = (!q || 'all clients'.startsWith(q.toLowerCase()))
                    ? '<button type="button" class="wl-client-search-result" data-wl-client-pick="all">All clients</button>'
                    : '';
                results.innerHTML = loadingRow + showAll + list.map(c =>
                    `<button type="button" class="wl-client-search-result" data-wl-client-pick="${wlEscape(c)}">${wlEscape(c)}</button>`
                ).join('');
            }
            results.hidden = false;
        };
        const pick = (value) => {
            wlState.client = value;
            input.value = value === 'all' ? '' : value;
            if (clearBtn) clearBtn.hidden = value === 'all';
            close();
            renderWorkloadAll();
        };

        input.addEventListener('focus', () => render(input.value.trim()));
        input.addEventListener('input', () => {
            const q = input.value.trim();
            if (clearBtn) clearBtn.hidden = !q;
            render(q);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape')      { e.preventDefault(); pick('all'); input.blur(); }
            else if (e.key === 'Enter')  {
                e.preventDefault();
                const q = input.value.trim();
                if (!q) return pick('all');
                const list = matches(q);
                const exact = list.find(c => c.toLowerCase() === q.toLowerCase());
                if (exact) pick(exact);
                else if (list.length === 1) pick(list[0]);
            }
        });
        results.addEventListener('mousedown', (e) => {
            const btn = e.target.closest('[data-wl-client-pick]');
            if (!btn) return;
            e.preventDefault();
            pick(btn.getAttribute('data-wl-client-pick'));
        });
        clearBtn?.addEventListener('click', () => { pick('all'); input.focus(); });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.wl-client-search')) close();
        });
    }

    function wlCloseDropdowns(except) {
        document.querySelectorAll('.wl-dropdown').forEach(d => {
            if (d === except) return;
            d.querySelector('.dropdown-trigger')?.classList.remove('open');
            d.querySelector('.dropdown-trigger')?.setAttribute('aria-expanded', 'false');
            d.querySelector('.dropdown-menu')?.classList.remove('open');
        });
    }

    function wlEscape(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    /* Workload → content calendar deep link. Opens the calendar page on the
       given client and scrolls to the card linked to that Linear sub-issue. */
    /* "Open in the content calendar", from a Workload popover row.

       The calendar locates a card by matching the identifier against
       `linear_issue_id`, so a deliverable with no Linear identifier has nothing
       to match on and _calApplyFocusRequest returns silently -- the reader lands
       on the right client's calendar with nothing focused and no explanation,
       having pressed a button that promised a card.

       The button is NOT hidden: the calendar itself is still the right place to
       go, and hiding a working destination because one part of it cannot be
       fulfilled is the over-strict failure AGENTS.md rules against. What changes
       is that the shortfall is SAID. Carrying a native card target through the
       snapshot would remove the need for the message; that is a projection
       change in the calendar's own region and is recorded in OPEN_REPAIRS 169
       rather than done here. */

    function wlPassesFilters(sub) {
        if (wlState.team !== 'all' && wlTeamBucket(sub.teamKey, sub.teamName) !== wlState.team) return false;
        if (wlState.editor !== 'all' && sub.assigneeId !== wlState.editor) return false;
        if (wlState.client !== 'all' && sub.clientName !== wlState.client) return false;
        return true;
    }

    /* Where a rollup chip actually POINTS.

       A left-click on these chips is intercepted and opens the popover, so this
       href is what a right-click, middle-click or "open in new tab" follows. It
       used to be Linear-only at both ends -- the parent's url, else the sub's --
       which was right while the board was a Linear mirror.

       It is not right now, and this was a LIVE hole rather than a post-cutover
       one: _wlV2MapRow clears `url` on EVERY native row, not only the rows
       created after outbound stops, so with both teams on syncview authority
       this resolved to '' across the whole board and the chip opened nothing.
       (I swept this in the previous round and called it a latent post-flip
       degradation of a secondary affordance. That was wrong on both counts.)

       SyncLinear is also the correct destination now (owner, 2026-08-21), so a
       native row routes there -- the batch parent when the group has one, else
       the deliverable itself. Linear stays the fallback for legacy rows, which
       still carry real provider urls. */
    function wlParentUrl(sub) {
        if (sub && sub.workloadSource === 'native') {
            const batchId = String(sub.parentId || '');
            if (batchId) return svRoute.clean('/?prod=1&batch=' + encodeURIComponent(batchId));
            const nativeId = String(sub.nativeId || '');
            if (nativeId) return wlSyncLinearUrl(nativeId);
        }
        if (sub && sub.parentId && wlState.parentById.has(sub.parentId)) {
            return wlState.parentById.get(sub.parentId).url || sub.url || '';
        }
        return (sub && sub.url) || '';
    }

    function wlWeekendExceptions(mondayISO) {
        const dates = [wlAddDays(mondayISO, 5), wlAddDays(mondayISO, 6)];
        const planned = [];
        const due = [];
        const rowsByKey = new Map();
        const addRow = (sub, date, role) => {
            const issueId = String(sub && sub.id || sub && sub.identifier || '');
            const key = `${date}|${issueId}`;
            if (!rowsByKey.has(key)) rowsByKey.set(key, { sub, date, roles: new Set() });
            rowsByKey.get(key).roles.add(role);
        };
        for (const date of dates) {
            const plannedHere = (wlState.calendarByDate.get(date) || [])
                .filter(sub => !wlIsTweaksNeeded(sub) && wlPassesFilters(sub));
            for (const sub of plannedHere) {
                planned.push({ sub, date });
                addRow(sub, date, 'Plan');
            }
            const dueHere = (wlState.planned || []).filter(sub =>
                !wlIsTweaksNeeded(sub)
                && wlPassesFilters(sub)
                && String(sub && sub.dueDate || '').slice(0, 10) === date
            );
            for (const sub of dueHere) {
                due.push({ sub, date });
                addRow(sub, date, 'Due');
            }
        }
        const rows = dates.flatMap(date => {
            const dateRows = [...rowsByKey.values()].filter(row => row.date === date);
            const ordered = wlSortSubIssues(dateRows.map(row => row.sub));
            return ordered.map(sub => {
                const issueId = String(sub && sub.id || sub && sub.identifier || '');
                const row = rowsByKey.get(`${date}|${issueId}`);
                return { ...row, roles: [...row.roles] };
            });
        });
        return { dates, planned, due, rows };
    }

    function renderWorkloadWeekendNotice() {
        const notice = document.getElementById('wlWeekendNotice');
        const label = document.getElementById('wlWeekendNoticeLabel');
        const panel = document.getElementById('wlWeekendNoticePanel');
        if (!notice || !label || !panel) return;
        if (wlState.viewMode !== 'week') {
            notice.hidden = true;
            notice.open = false;
            panel.innerHTML = '';
            return;
        }
        const exceptions = wlWeekendExceptions(wlState.weekStart);
        if (!exceptions.rows.length) {
            notice.hidden = true;
            notice.open = false;
            panel.innerHTML = '';
            return;
        }
        notice.hidden = false;
        label.textContent = `Weekend dates · ${exceptions.planned.length} planned · ${exceptions.due.length} due`;
        panel.innerHTML = exceptions.rows.map(row => {
            const sub = row.sub || {};
            const date = wlParseISO(row.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
            const title = sub.title || sub.identifier || 'Work';
            const roles = row.roles.join(' + ');
            const accessible = [sub.identifier || '', title, sub.clientName || '', date, roles].filter(Boolean).join(' · ');
            return `<button type="button" class="workload-weekend-row" data-wl-issue-open="1" data-wl-issue-id="${wlEscape(sub.id || '')}" data-wl-parent-id="${wlEscape(sub.parentId || '')}" data-wl-assignee-id="${wlEscape(sub.assigneeId || '')}" data-wl-client="${wlEscape(sub.clientName || '')}" data-wl-date="${wlEscape(row.date)}" aria-label="${wlEscape(accessible)}">
                <span class="workload-weekend-row-date">${wlEscape(date)}</span>
                <span class="workload-weekend-row-title">${wlEscape(title)}</span>
                <span class="workload-weekend-row-role">${wlEscape(roles)}</span>
            </button>`;
        }).join('');
    }

    /* The sentence the board owes a reader whose rows it removed. Pure, so the
       wording is testable without a browser: the defect being fixed is a
       CLAIM the surface makes, and a claim is exactly what a unit test can
       hold. Empty string means nothing was excluded and nothing is said --
       a banner that appears when there is nothing to report is its own lie. */
    function wlExcludedSummaryText(excluded, visibleCount) {
        const noDate = (excluded && excluded.noAssigneeNoDate || []).length;
        const offTeam = (excluded && excluded.offTeamAssignee || []).length;
        const total = noDate + offTeam;
        if (!total) return '';
        const parts = [];
        if (noDate) {
            parts.push(noDate + (noDate === 1 ? ' has' : ' have')
                + ' no assignee and no work day or deadline');
        }
        if (offTeam) {
            parts.push(offTeam + (offTeam === 1 ? ' is' : ' are')
                + ' assigned to someone who is not on that issue team');
        }
        /* When NOTHING is visible, the board is not merely incomplete -- it
           reads as "there is no work here", which is the false statement worth
           naming first. */
        const lead = Number(visibleCount) > 0
            ? total + ' sub-issue' + (total === 1 ? ' is' : 's are') + ' not shown here: '
            : 'Nothing is shown here, but this is not an empty board: '
                + total + ' sub-issue' + (total === 1 ? ' is' : 's are') + ' excluded because ';
        return lead + parts.join(', and ') + '.';
    }

    /* A saved work day the gateway refused to attach to its card, said out loud.

       The count is the only thing the browser is given -- the gateway drops the
       plan without naming the row that owned it -- so the sentence names a
       number and what to do about it rather than pretending to point at cards.

       This is the THIRD pass on the same defect and the first two both died in
       the plumbing: the count went into a field nothing read, then into
       `backgroundError`, which renderWorkloadPlanStatus rewrites for every
       string but one sentinel and wlManualRefresh clears outright. So it is now
       rendered from its own state, on its own branch, and no refresh-failure
       path can overwrite or clear it. */
    function wlDroppedPlanWarningText(count) {
        const dropped = Number(count) || 0;
        if (dropped <= 0) return '';
        return (dropped === 1
            ? 'One saved work day is not shown'
            : dropped + ' saved work days are not shown')
            + ' because the client stored with that work day no longer matches the card.'
            + ' Those cards are placed automatically; check them before planning around them.';
    }

    function renderWorkloadPlanStatus() {
        const el = document.getElementById('wlPlanStatus');
        if (!el) return;
        const status = wlState.planStatus;
        const metadataStatus = wlState.linearMetadataStatus;

        /* EVERY notice that is true right now, most urgent first.

           This used to be a chain of branches that each returned, so the first
           true one silenced the rest. The states are independent -- a board can
           be missing saved work days, have failed its last refresh, be unable to
           prove its labels AND be hiding excluded rows, all at once -- and
           silencing "capacity may be understated; due-date editing is paused"
           because a plan's client drifted makes the board read as MORE complete
           than it is. That is the failure AGENTS.md calls the one a reader
           cannot debug or report: an absence.

           So precedence is now ORDERING, not suppression. Each note keeps the
           rank it had; the ones below it are appended rather than dropped. */
        const notices = [];

        /* Two of the notices below describe WHAT IS ON SCREEN -- rows whose
           weight could not be proven, and rows excluded from every panel. Both
           used to be gated on `planStatus === 'ready'`, which couples them to a
           state they have nothing to do with: a warm board whose refresh just
           failed still shows those same rows, still excludes the same ones, and
           goes to 'stale'. The notice vanished exactly when the board got worse.

           The honest gate is whether a WORKLOAD ITEM is being shown at all --
           which is NOT the same as `issueSnapshot.length`. That array also
           carries batch parents and completed/parked rows, every one of which
           wlApplyData drops from every bucket, so a cached fallback holding
           only those would have claimed a displayed capacity was understated
           while displaying nothing. It counts the rows that actually rendered,
           plus the ones excluded FROM rendering: an all-excluded board shows
           nothing and is exactly the board that most needs to say why. During a
           first load both are zero and these stay silent on their own; once
           something renders, what is true about it is true regardless of how
           fresh the plan is. */
        const excludedShown = ((wlState.excluded && wlState.excluded.noAssigneeNoDate) || []).length
            + ((wlState.excluded && wlState.excluded.offTeamAssignee) || []).length;
        const boardShown = wlVisibleSubCount() > 0 || excludedShown > 0;

        /* A board painted from the localStorage copy (initWorkloadView) is not
           the live board, and OPEN_REPAIRS 230 item 3 allows it only if it says
           so. Ranked first: every other notice describes a live read. */
        if (wlState.cachedBoardAt != null) {
            const at = new Date(wlState.cachedBoardAt);
            const hhmm = String(at.getHours()).padStart(2, '0') + ':' + String(at.getMinutes()).padStart(2, '0');
            const time = at.toDateString() === new Date().toDateString()
                ? hhmm : at.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + hhmm;
            const updating = wlState.loading || status === 'loading' || status === 'refreshing';
            notices.push(updating
                ? 'Showing the board from ' + time + ' while it updates. Saved work days and editing come back in a moment.'
                : 'Couldn’t update. Showing the board from ' + time + '. Saved work days and editing are off until it refreshes. Try Refresh.');
        }

        const droppedText = wlDroppedPlanWarningText(wlState.nativePlansDropped);
        if (droppedText) notices.push(droppedText);

        /* The plan's OWN degraded state, which used to sit in a terminal branch
           that only ran when nothing above had spoken.

           It therefore never ran in the one situation it exists for:
           wlLoadSnapshot's failure path sets `backgroundError` and
           `planStatus = 'stale' | 'unknown'` on adjacent lines, so the notice
           above it always won. That is not a cosmetic loss --
           wlPlanEditingEnabled() requires 'ready', so saved-work-day editing
           really is off, and the generic freshness sentence does not say so.
           Ranked high because "you cannot edit" is the most operationally
           urgent thing on this line. */
        if (status === 'stale') {
            notices.push('Saved work days could not be refreshed. The last good plan is shown; editing is paused.');
        } else if (status === 'unknown') {
            notices.push('Saved work days are unavailable. Deadlines are shown as a clearly marked fallback; editing is disabled.');
        }

        if (wlState.backgroundError) {
            notices.push(wlState.backgroundError === 'Some teams still use the legacy Workload source.'
                ? 'Some teams still use the legacy Workload source.'
                : 'Workload could not check for newer changes. The last good calendar is still shown; use Refresh if needed.');
        }

        /* AN INCOMPLETE MATCH OUTRANKS EVERY NOTE BELOW IT.
         *
         * This exists because of the report in item 210: one person saw a card
         * on the day they pinned it, another saw it a day earlier, both after a
         * refresh, and nothing on either board said anything was wrong. The read
         * had SUCCEEDED for both. Saved days live under two ids for the same
         * card and the sidecar matches them per answer; a degraded answer still
         * carries every saved day, just not every alias, so the cards it could
         * not match fall to automatic placement on a board that otherwise looks
         * entirely normal.
         *
         * It ranks above the metadata note and above 209's short-refresh note
         * for the same reason both of those exist: a board that is WRONG about
         * where work sits is more urgent than one that is incomplete about
         * weights, and far more urgent than a count of what it left out. All
         * three say what happened; this one says the day you are looking at may
         * not be the day that was saved.
         *
         * It speaks only when something is actually unmatched, or when no map
         * could be built at all. A complete match says nothing, which is what
         * keeps it worth reading — and it deliberately does NOT speak for the
         * historical client drift the sidecar reports separately, because that
         * number never goes down and a standing warning is how a real one stops
         * being read. */
        /* Main shipped this as an early return that silenced every note below
           it. This ladder ORDERS rather than suppresses, so it became a push at
           the same rank: still above the metadata note and above 209's
           short-refresh note, but the lesser notes are now appended instead of
           dropped. Main's gate is unchanged. */
        if (status === 'ready' && (wlState.planUnaliased > 0 || wlState.planAliasMode === 'none')) {
            const missing = Number(wlState.planUnaliased) || 0;
            notices.push(wlState.planAliasMode === 'none'
                ? 'Saved work days could not be matched to their cards on this load, so some cards may be shown on an automatic day instead of their saved one. Use Refresh to try again.'
                : (missing === 1
                    ? 'One saved work day could not be matched to its card, so that card is shown on an automatic day. Everything else here is up to date.'
                    : missing + ' saved work days could not be matched to their cards, so those cards are shown on an automatic day. Everything else here is up to date.'));
        }

        if (boardShown && (metadataStatus === 'unknown' || metadataStatus === 'stale')) {
            /*
             * Two very different situations reach this branch, and until
             * 2026-08-24 both got the sentence below.
             *
             * MEASURED: of 2,351 graphics rows, exactly ONE could not be proven
             * — a six-week-old test fixture on the TEST client with no Linear
             * issue at all. Every editor on the page was reading "capacity may
             * be understated; due-date editing is paused" because of it. Due
             * editing is NOT paused: wlDueWriteRoute is decided per row and
             * every provable row stayed fully editable the whole time. The
             * banner was simply saying something untrue, and the cost of that
             * is a team believing a feature is off when it is on.
             *
             * A failed READ is different and the original wording is right for
             * it: nothing was proven, so capacity really is understated and
             * nothing really is editable. Keep the two apart.
             */
            const withheld = Number(wlState.linearMetadataWithheldOnly) || 0;
            notices.push(withheld
                ? (withheld === 1
                    ? 'One item is missing its workload label, so it is shown without a weight or a due date. Everything else here is up to date and editable.'
                    : withheld + ' items are missing their workload label, so they are shown without a weight or a due date. Everything else here is up to date and editable.')
                : 'Workload labels could not be refreshed. Capacity may be understated; due-date editing is paused.');
        }

        /* 209's short-refresh note, from main, at the rank it shipped with:
           below every real plan or metadata problem, above the completeness
           note. Early return became a push; main's gate is unchanged. */
        const refreshMissing = Number(wlState.refreshMissing) || 0;
        if (status === 'ready' && refreshMissing > 0) {
            const pinned = Number(wlState.refreshMissingPinned) || 0;
            notices.push('That refresh came back with ' + refreshMissing + ' fewer sub-issue'
                + (refreshMissing === 1 ? '' : 's') + ' than the board had'
                + (pinned > 0 ? ' (' + pinned + ' of them planned to a work day)' : '')
                + '. Nothing was lost — saved work days are untouched — but Linear returned less than the'
                + ' calendar was showing, so reload the page to get the full board back.');
        }

        /* Still the lowest rank: a real plan or metadata problem is more urgent
           than a completeness note, so this speaks LAST. It no longer goes
           unsaid, though -- "Nothing is shown here, but this is not an empty
           board" is exactly the sentence a reader needs most on the day
           something else is also wrong. */
        if (boardShown) {
            const excludedText = wlExcludedSummaryText(wlState.excluded, wlVisibleSubCount());
            if (excludedText) notices.push(excludedText);
        }

        if (notices.length) {
            el.hidden = false;
            el.className = 'workload-plan-status is-warning';
            el.textContent = notices.join(' ');
            return;
        }
        /* Nothing is wrong: ready, loading or refreshing with no notice to
           give. 'stale' and 'unknown' can no longer reach here -- each always
           contributes a notice above -- which is the point: the sentence that
           used to live down here is now said even when something else is also
           true. */
        el.hidden = true;
        el.className = 'workload-plan-status';
        el.textContent = '';
    }

    function wlVisibleSubCount() {
        return (wlState.planned || []).length
            + (wlState.nowWorking || []).length
            + (wlState.tweaksNeeded || []).length
            + (wlState.overdue || []).length
            + (wlState.undated || []).length
            + (wlState.unassigned || []).length;
    }

    function renderWorkloadAll(opts) {
        // Background refreshes (the cache→network settle on mount, the
        // tab-focus silent refetch) must not yank an open popover out from
        // under the user — editors sit on it reading tweak comments. Queue
        // the repaint instead; wlClosePopover flushes it on close.
        if (opts && opts.deferWhilePopoverOpen && wlState.popoverAnchor) {
            wlState.renderQueued = true;
            return;
        }
        wlState.renderQueued = false;
        if (!wlStaffMayView()) {
            // Signed out: wipe and say so. Still verifying: draw no board data
            // yet; the load after verification repaints.
            if (wlStaffSignedOut()) wlRenderSignedOut();
            return;
        }
        wlUnhideSignedOut();
        // Re-rendering the calendar wipes out the spotlight markers and the
        // popover's anchor element, so close it before painting the new DOM.
        if (wlState.popoverAnchor) wlClosePopover(false);
        const titleEl = document.getElementById('wlTitle');
        if (titleEl) {
            if (wlState.viewMode === 'week') {
                const ws = wlState.weekStart;
                const we = wlAddDays(ws, 4);
                const wsD = wlParseISO(ws), weD = wlParseISO(we);
                const sameMonth = wsD.getMonth() === weD.getMonth() && wsD.getFullYear() === weD.getFullYear();
                titleEl.textContent = sameMonth
                    ? wlFormatShort(ws) + ' – ' + weD.getDate() + ', ' + weD.getFullYear()
                    : wlFormatShort(ws) + ' – ' + wlFormatShort(we) + ', ' + weD.getFullYear();
            } else {
                titleEl.textContent = new Date(wlState.year, wlState.month, 1)
                    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
            }
        }
        document.querySelectorAll('[data-wl-deadline-mode]').forEach(button => {
            const active = (button.getAttribute('data-wl-deadline-mode') === 'deadlines') === (wlState.showDeadlines === true);
            button.classList.toggle('active', active);
            button.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        const monthButton = document.querySelector('[data-wl-view="month"]');
        if (monthButton) {
            monthButton.disabled = wlState.showDeadlines === true;
            monthButton.setAttribute('aria-label', wlState.showDeadlines ? 'Month unavailable while Plan + Due Date is selected' : 'Month');
        }

        wlPopulateFilterOptions();
        renderWorkloadPlanStatus();
        renderWorkloadOverviewMatrix();
        renderUndatedStrip();
        renderUnassignedStrip();
        renderWorkloadWeekendNotice();

        const bodyEl = document.getElementById('wlBody');
        if (!bodyEl) return;

        const hasAnyData = wlState.planned.length || wlState.nowWorking.length || wlState.undated.length || wlState.unassigned.length;
        /*
         * THE FAST FIRST PAINT MUST REACH THE SCREEN.
         *
         * wlLoadSnapshot fast-paints as soon as issues and the plan list are
         * back — planLoading=true, wlApplyData, renderWorkloadAll — precisely
         * so the calendar is on screen BEFORE the live-Linear weight sweep,
         * which is the slow part of a cold load. planStatus only becomes
         * 'ready' when wlAdoptPlanRows runs AFTER that sweep, so this gate,
         * which keyed on planStatus alone, painted the skeleton over the fast
         * paint for its entire window and no user ever saw it: the cold load
         * still blocked on the sweep it was built to skip, and the
         * "Planning…" placement label was unreachable in the UI. The Workload
         * browser harness measured it (2026-09-14): planLoading true, cards
         * computed, #wlBody the skeleton with zero cards.
         *
         * So the skeleton yields once the fast paint has data. Everything the
         * gate protected still holds: the cards carry the 'loading' mode and
         * its Planning… label, wlPlanEditingEnabled() is false until the
         * snapshot is authoritative, and a foreground load with nothing to
         * show yet still gets the skeleton.
         */
        const fastPaintOnScreen = wlState.planLoading && hasAnyData;
        if ((wlState.planStatus === 'loading' || wlState.planStatus === 'refreshing') && !fastPaintOnScreen) {
            bodyEl.innerHTML = _svLoadingSkeletonHtml('workload');
            return;
        }
        if (wlState.error && !hasAnyData) {
            bodyEl.innerHTML = '<div class="workload-error">Could not load Linear issues: ' + wlEscape(wlState.error) + '</div>';
            return;
        }
        if (wlState.loading && !hasAnyData) {
            bodyEl.innerHTML = _svLoadingSkeletonHtml('workload');
            return;
        }
        bodyEl.innerHTML = wlState.viewMode === 'week'
            ? (wlState.showDeadlines ? renderWeekDeadlineTimeline() : renderWeekGrid())
            : renderMonthGrid();
    }

    // Group a list of sub-issues into (assigneeId × clientName) rollups.
    // In-progress and planned items for the same editor+client on the same
    // day collapse into one chip — the popover still shows them all with
    // their individual work days and deadlines, so the breakdown is one click away.
    function wlGroupRollups(subs) {
        const map = new Map();
        for (const s of subs) {
            const key = (s.assigneeId || '?') + '|' + (s.clientName || '');
            if (!map.has(key)) {
                map.set(key, {
                    assigneeId: s.assigneeId,
                    assigneeName: s.assigneeName,
                    clientName: s.clientName,
                    teamKey: s.teamKey,
                    teamName: s.teamName,
                    parentId: s.parentId,
                    anySub: s,
                    count: 0,
                    subs: [],
                });
            }
            map.get(key).count++;
            map.get(key).subs.push(s);
        }
        return [...map.values()].sort((a, b) => {
            const na = wlDisplayName(a.assigneeName); const nb = wlDisplayName(b.assigneeName);
            if (na !== nb) return na.localeCompare(nb);
            return (a.clientName || '').localeCompare(b.clientName || '');
        });
    }

    function wlSortSubIssues(subs) {
        const rows = (subs || []).slice();
        const nativeOrder = rows.length > 0 && rows.every(row => {
            const raw = row && (row.sortOrder ?? row.sort_order);
            return raw !== null && raw !== '' && Number.isFinite(Number(raw));
        });
        return rows.sort((a, b) => {
            if (nativeOrder) {
                const nativeDiff = Number(a.sortOrder ?? a.sort_order) - Number(b.sortOrder ?? b.sort_order);
                if (nativeDiff) return nativeDiff;
            }
            const aIdentifier = String(a && a.identifier || '');
            const bIdentifier = String(b && b.identifier || '');
            const aNumber = Number((aIdentifier.match(/(\d+)\s*$/) || [])[1]);
            const bNumber = Number((bIdentifier.match(/(\d+)\s*$/) || [])[1]);
            if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) {
                return aNumber - bNumber;
            }
            const identifierOrder = aIdentifier.localeCompare(bIdentifier, undefined, { numeric: true });
            if (identifierOrder) return identifierOrder;
            return String(a && a.id || '').localeCompare(String(b && b.id || ''));
        });
    }

    // Build today's rollups from the literal work-day bucket. In-progress
    // items are rendered separately in the strip above the calendar.
    function wlTodayRollups(todayISO) {
        const allDue = wlState.calendarByDate.get(todayISO) || [];
        const plannedSubs = allDue.filter(wlPassesFilters);
        const groups = wlGroupRollups(plannedSubs);
        return { groups, count: plannedSubs.length, overCapacity: wlDayOverCapacity(plannedSubs) };
    }

    // The three exception queues, in the order the calendar pills read them:
    // worst first. The Team workload matrix keeps its own column order
    // (overdue / in progress / tweaks) because those columns are headed and
    // scanned vertically; the pills are unlabelled and scanned left to right,
    // so they lead with the queue that needs a person first.
    const WL_STATUS_QUEUES = [
        { key: 'overdue',    sourceMode: 'overdue',    suffix: 'overdue',          rows: () => wlState.overdue || [] },
        { key: 'tweaks',     sourceMode: 'tweaks',     suffix: 'awaiting tweaks',  rows: () => wlState.tweaksNeeded || [] },
        { key: 'inprogress', sourceMode: 'inprogress', suffix: 'in progress',      rows: () => wlState.nowWorking || [] },
    ];

    // Per-editor totals for those queues, honouring the active team / editor /
    // client filters. Same source lists and same predicate the matrix uses, so
    // a calendar pill can never disagree with that editor's row above it.
    function wlEditorStatusCounts() {
        const byEditor = new Map();
        for (const queue of WL_STATUS_QUEUES) {
            for (const sub of queue.rows()) {
                if (!wlPassesFilters(sub)) continue;
                const assigneeId = String(sub.assigneeId || '').trim();
                if (!assigneeId) continue;
                if (!byEditor.has(assigneeId)) {
                    byEditor.set(assigneeId, { overdue: 0, tweaks: 0, inprogress: 0 });
                }
                byEditor.get(assigneeId)[queue.key]++;
            }
        }
        return byEditor;
    }

    // A queue with nothing in it renders no pill at all. The matrix has room
    // for a "Clear" placeholder; a calendar cell does not, and three empty
    // outlines per editor would bury the one that matters.
    function wlEditorStatusPillsHtml(assigneeId, editorName, counts) {
        const totals = counts && counts.get(String(assigneeId || '').trim());
        if (!totals) return '';
        const pills = WL_STATUS_QUEUES.filter(queue => totals[queue.key] > 0).map(queue => {
            const total = totals[queue.key];
            const label = `See ${total} sub-issue${total === 1 ? '' : 's'} ${queue.suffix}`;
            return `<button type="button" class="wl-day-status-pill is-${queue.key}" data-wl-rollup="1" data-wl-count-badge="1" data-wl-source="${queue.sourceMode}" data-wl-assignee-id="${wlEscape(assigneeId || '')}" data-wl-client="" data-wl-in-progress="${queue.key === 'inprogress' ? '1' : '0'}" data-wl-editor-name="${wlEscape(editorName || 'Unknown')}" aria-label="${wlEscape(label)}" data-tip="${wlEscape(label)}">${total}</button>`;
        });
        if (!pills.length) return '';
        return `<div class="workload-day-card-status">${pills.join('')}</div>`;
    }

    // Compact editor matrix: capacity and the three exception queues share one
    // row per editor. Whitespace between softly raised rows replaces the old
    // stack of full-width colored strips. Queue totals and client chips stay
    // visible so the matrix is useful at a glance.
    function _wlBoardHasAnyData() {
        return !!((wlState.planned && wlState.planned.length) || (wlState.nowWorking && wlState.nowWorking.length)
            || (wlState.undated && wlState.undated.length) || (wlState.unassigned && wlState.unassigned.length)
            || (wlState.overdue && wlState.overdue.length) || (wlState.tweaksNeeded && wlState.tweaksNeeded.length));
    }
    function _wlOverviewSkeletonHtml() {
        return Array.from({ length: 4 }, () => `<div class="workload-overview-row is-skeleton" aria-hidden="true">
            <div class="workload-overview-editor"><span class="sv-skeleton sv-skeleton-dot" style="width:32px;height:32px;"></span><span class="workload-overview-editor-copy">${_svSkel('sv-skeleton-line', 'width:120px;height:12px;')}${_svSkel('sv-skeleton-line', 'width:48px;height:9px;')}</span></div>
            <div class="workload-overview-capacity">${_svSkel('sv-skeleton-line', 'width:44px;height:11px;')}${_svSkel('sv-skeleton-pill', 'width:120px;height:6px;')}</div>
            ${['overdue', 'inprogress', 'tweaks'].map(k => `<div class="workload-overview-status is-${k} is-empty">${_svSkel('sv-skeleton-line', 'width:40px;height:11px;')}</div>`).join('')}
        </div>`).join('');
    }
    function renderWorkloadOverviewMatrix() {
        const wrap = document.getElementById('wlOverview');
        const rowsEl = document.getElementById('wlOverviewRows');
        if (!wrap || !rowsEl) return;
        // A cold load with nothing in memory used to paint the whole roster as
        // "Free / Clear / 0" until the snapshot landed: false data, not a
        // loading state. Hold a skeleton instead; the counts stay blank.
        if (!_wlBoardHasAnyData() && (wlState.loading || wlState.planStatus === 'loading')) {
            wrap.classList.remove('empty');
            wrap.setAttribute('aria-busy', 'true');
            ['wlOverdueTotal', 'wlInProgressTotal', 'wlTweaksTotal'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '–'; });
            rowsEl.innerHTML = _wlOverviewSkeletonHtml();
            return;
        }
        wrap.removeAttribute('aria-busy');

        const statusSpecs = [
            { key: 'overdue', sourceMode: 'overdue', suffix: 'overdue', rows: wlState.overdue || [] },
            { key: 'inprogress', sourceMode: 'inprogress', suffix: 'in progress', rows: wlState.nowWorking || [] },
            { key: 'tweaks', sourceMode: 'tweaks', suffix: 'awaiting tweaks', rows: wlState.tweaksNeeded || [] },
        ];
        const byEditor = new Map();
        const ensureEditor = (source, fallbackName) => {
            const assigneeId = String(source && source.assigneeId || '').trim();
            if (!assigneeId) return null;
            const teamKey = source && source.teamKey || 'VID';
            const teamName = source && source.teamName || 'Video';
            if (wlState.team !== 'all' && wlTeamBucket(teamKey, teamName) !== wlState.team) return null;
            if (wlState.editor !== 'all' && assigneeId !== wlState.editor) return null;
            if (!byEditor.has(assigneeId)) {
                byEditor.set(assigneeId, {
                    assigneeId,
                    assigneeName: fallbackName || source.assigneeName || '',
                    teamKey,
                    teamName,
                    count: 0,
                    units: 0,
                    statuses: {
                        overdue: { total: 0, clients: new Map() },
                        inprogress: { total: 0, clients: new Map() },
                        tweaks: { total: 0, clients: new Map() },
                    },
                });
            }
            return byEditor.get(assigneeId);
        };

        // Keep every current video editor visible, including a completely free
        // editor. Live issue data merges onto these stable-id roster rows.
        if (wlState.team === 'all' || wlState.team === 'video') {
            for (const rosterEditor of wlState.editorRoster.filter(member => member.team === 'video')) {
                ensureEditor({
                    assigneeId: rosterEditor.id,
                    assigneeName: rosterEditor.name,
                    teamKey: 'VID',
                    teamName: 'Video',
                }, rosterEditor.name);
            }
        }

        for (const spec of statusSpecs) {
            let visibleTotal = 0;
            for (const sub of spec.rows) {
                if (!wlPassesFilters(sub)) continue;
                const editor = ensureEditor(sub);
                if (!editor) continue;
                visibleTotal++;
                const status = editor.statuses[spec.key];
                status.total++;
                const clientKey = (sub.parentId || '') + '|' + (sub.clientName || '');
                if (!status.clients.has(clientKey)) {
                    status.clients.set(clientKey, {
                        clientName: sub.clientName,
                        parentId: sub.parentId,
                        assigneeId: sub.assigneeId,
                        anySub: sub,
                        count: 0,
                    });
                }
                status.clients.get(clientKey).count++;
            }
            const totalEl = document.getElementById(
                spec.key === 'overdue' ? 'wlOverdueTotal' :
                spec.key === 'inprogress' ? 'wlInProgressTotal' :
                'wlTweaksTotal'
            );
            if (totalEl) totalEl.textContent = String(visibleTotal);
        }

        // One issue contributes to capacity once even when it appears in more
        // than one status queue. Queue columns deliberately keep those distinct
        // status views, matching the existing popover behavior.
        const seen = new Set();
        const considerCapacity = (sub) => {
            if (!wlPassesFilters(sub)) return;
            const issueKey = String(sub.id || sub.identifier || '');
            if (!issueKey || seen.has(issueKey)) return;
            seen.add(issueKey);
            const editor = ensureEditor(sub);
            if (!editor) return;
            editor.count++;
            editor.units += wlWorkloadWeight(sub);
        };
        for (const source of [
            wlState.planned,
            wlState.nowWorking,
            wlState.tweaksNeeded,
            wlState.overdue,
            wlState.undated,
        ]) {
            for (const sub of source || []) considerCapacity(sub);
        }

        const editors = [...byEditor.values()].sort((a, b) => {
            const aCapacity = wlEditorCapacity(a.teamKey, a.teamName);
            const bCapacity = wlEditorCapacity(b.teamKey, b.teamName);
            const loadDiff = (a.units / aCapacity) - (b.units / bCapacity);
            if (loadDiff) return loadDiff;
            return wlDisplayName(a.assigneeName).localeCompare(wlDisplayName(b.assigneeName));
        });
        wrap.classList.toggle('empty', editors.length === 0);
        if (!editors.length) {
            rowsEl.innerHTML = '';
            return;
        }

        const statusCellHtml = (editor, spec) => {
            const status = editor.statuses[spec.key];
            const statusClass = `is-${spec.key}`;
            const statusLabel = spec.key === 'inprogress' ? 'In progress' :
                (spec.key === 'tweaks' ? 'Tweaks' : 'Overdue');
            if (!status.total) {
                return `<div class="workload-overview-status ${statusClass} is-empty" data-wl-status-label="${statusLabel}"><span>Clear</span></div>`;
            }
            const clients = [...status.clients.values()].sort((a, b) => {
                if (a.count !== b.count) return b.count - a.count;
                return String(a.clientName || '').localeCompare(String(b.clientName || ''));
            });
            const inProgress = spec.sourceMode === 'inprogress' ? '1' : '0';
            const chips = clients.map(client => {
                const label = client.clientName || '—';
                return `<a class="wl-now-client-chip" href="${wlEscape(wlParentUrl(client.anySub) || '#')}" target="_blank" rel="noopener noreferrer" aria-label="${wlEscape(label)} · ${client.count} ${spec.suffix}" data-wl-rollup="1" data-wl-count-badge="1" data-wl-source="${spec.sourceMode}" data-wl-parent-id="${wlEscape(client.parentId || '')}" data-wl-assignee-id="${wlEscape(client.assigneeId || '')}" data-wl-client="${wlEscape(client.clientName || '')}" data-wl-in-progress="${inProgress}" data-wl-editor-name="${wlEscape(wlDisplayName(editor.assigneeName) || 'Unknown')}">
                    <span class="wl-now-client-chip-name">${wlEscape(label)}</span>
                    <span class="wl-now-client-chip-count">${client.count}</span>
                </a>`;
            }).join('');
            const totalLabel = `See ${status.total} sub-issue${status.total === 1 ? '' : 's'} ${spec.suffix}`;
            return `<div class="workload-overview-status ${statusClass}" data-wl-status-label="${statusLabel}">
                <div class="workload-overview-status-clients">${chips}</div>
                <button type="button" class="workload-overview-status-total" data-wl-rollup="1" data-wl-count-badge="1" data-wl-source="${spec.sourceMode}" data-wl-assignee-id="${wlEscape(editor.assigneeId)}" data-wl-client="" data-wl-in-progress="${inProgress}" data-wl-editor-name="${wlEscape(wlDisplayName(editor.assigneeName) || 'Unknown')}" aria-label="${wlEscape(totalLabel)}">${status.total}</button>
            </div>`;
        };

        rowsEl.innerHTML = editors.map(editor => {
            const capacity = wlEditorCapacity(editor.teamKey, editor.teamName);
            const days = editor.units === 0 ? 0 : Math.max(1, Math.ceil(editor.units / capacity));
            const capacityClass = days <= 1 ? 'free' : (days <= 2 ? 'light' : (days <= 4 ? 'busy' : 'full'));
            const capacityLabel = days === 0 ? 'Free' : `~${days} day${days === 1 ? '' : 's'}`;
            const fill = Math.min(100, Math.round((editor.units / (capacity * 4)) * 100));
            const name = wlDisplayName(editor.assigneeName) || 'Unknown';
            const team = wlTeamBucket(editor.teamKey, editor.teamName);
            const teamLabel = team === 'graphics' ? 'Graphics' : 'Video';
            const activeLabel = `${name} · ${editor.count} active sub-issue${editor.count === 1 ? '' : 's'} · ${editor.units} workload unit${editor.units === 1 ? '' : 's'}`;
            const rollupAttrs = `data-wl-rollup="1" data-wl-count-badge="1" data-wl-source="active" data-wl-assignee-id="${wlEscape(editor.assigneeId)}" data-wl-client="" data-wl-editor-name="${wlEscape(name)}"`;
            return `<div class="workload-overview-row">
                <button type="button" class="workload-overview-editor" ${rollupAttrs} aria-label="${wlEscape(activeLabel)}">
                    <span class="workload-overview-avatar">${wlEscape(wlInitials(name))}</span>
                    <span class="workload-overview-editor-copy">
                        <span class="workload-overview-editor-name">${wlEscape(name)}</span>
                        <span class="workload-overview-editor-team">${teamLabel}</span>
                    </span>
                </button>
                <button type="button" class="workload-overview-capacity ${capacityClass}" ${rollupAttrs} aria-label="${wlEscape(activeLabel + ` · ${capacityLabel} at ${capacity} units per day`)}" style="--wl-capacity-fill:${fill}%">
                    <span class="workload-overview-capacity-label">${capacityLabel}</span>
                    <span class="workload-overview-meter" aria-hidden="true"><span></span></span>
                </button>
                ${statusSpecs.map(spec => statusCellHtml(editor, spec)).join('')}
            </div>`;
        }).join('');
    }

    // Editor workload — ranks every current video editor by how busy they are
    // so a SMM can see at a glance who has the most free time before assigning
    // a new sub-issue. The whole roster always shows (see wlState.editorRoster):
    // an editor with no active sub-issues sorts first as the freest. The count
    // matches what's visible across the calendar and active strips, deduped on
    // id, including the undated lane. "Days of work" = count / per-day
    // capacity (4 units for video). A 2× / 3× Workload label consumes that
    // many units. Honours the team filter (video-only panel) and
    // the client filter for counts, but always lists the roster.
    function renderEditorWorkload() {
        const wrap = document.getElementById('wlCapacity');
        const row  = document.getElementById('wlCapacityRow');
        if (!wrap || !row) return;
        if (wlState.editorRosterStatus !== 'ready') {
            wrap.classList.remove('empty');
            row.innerHTML = '<span class="workload-capacity-hint" role="status">Current editor capacity is unavailable. Refresh after the roster update completes.</span>';
            return;
        }

        const seen = new Set();
        const byEditor = new Map();
        const consider = (s) => {
            if (!s.assigneeId) return;
            if (seen.has(s.id)) return;
            seen.add(s.id);
            if (!wlIssueEditorAllowed(s)) return;
            // The "Editor workload / freest first" panel is for video editors
            // only. Graphics designers have a different per-day capacity and
            // a different definition of "free", so mixing them in skews the
            // ranking. They still show up in the calendar / strip / unassigned
            // panels — just not on this comparison row.
            if (wlTeamBucket(s.teamKey, s.teamName) !== 'video') return;
            if (wlState.team !== 'all' && wlTeamBucket(s.teamKey, s.teamName) !== wlState.team) return;
            if (wlState.client !== 'all' && s.clientName !== wlState.client) return;
            if (!byEditor.has(s.assigneeId)) {
                byEditor.set(s.assigneeId, {
                    assigneeId: s.assigneeId,
                    assigneeName: s.assigneeName,
                    teamKey: s.teamKey,
                    teamName: s.teamName,
                    count: 0,
                    units: 0,
                });
            }
            byEditor.get(s.assigneeId).count++;
            byEditor.get(s.assigneeId).units += wlWorkloadWeight(s);
        };
        // Seed the full video-editor roster first so everyone shows up, even
        // an editor with zero active sub-issues — they're the freest of all
        // and belong at the top of the ranking, not missing from it. The
        // roster is video-only, so skip it when the team filter is graphics.
        // The client filter is intentionally NOT applied here: a free editor
        // has capacity for any client, so they should still appear (at 0) when
        // the panel is narrowed to a single client. Real work merges onto
        // these entries by id (see wlState.editorRoster) and the roster's clean
        // display name wins over the raw Linear email.
        if (wlState.team === 'all' || wlState.team === 'video') {
            for (const r of wlState.editorRoster.filter(member => member.team === 'video')) {
                byEditor.set(r.id, { assigneeId: r.id, assigneeName: r.name, teamKey: 'VID', teamName: 'Video', count: 0, units: 0 });
            }
        }
        for (const s of (wlState.planned      || [])) consider(s);
        for (const s of (wlState.nowWorking   || [])) consider(s);
        for (const s of (wlState.tweaksNeeded || [])) consider(s);
        for (const s of (wlState.overdue      || [])) consider(s);
        for (const s of (wlState.undated      || [])) consider(s);

        if (byEditor.size === 0) {
            wrap.classList.add('empty');
            row.innerHTML = '';
            return;
        }
        wrap.classList.remove('empty');

        const editors = [...byEditor.values()].sort((a, b) => {
            if (a.units !== b.units) return a.units - b.units;
            return wlDisplayName(a.assigneeName).localeCompare(wlDisplayName(b.assigneeName));
        });

        row.innerHTML = editors.map(ed => {
            const cap = wlEditorCapacity(ed.teamKey, ed.teamName);
            // An editor with no active work shows 0 days (the freest); everyone
            // else rounds up to at least one day.
            const days = ed.units === 0 ? 0 : Math.max(1, Math.ceil(ed.units / cap));
            let cls;
            if (days <= 1)      cls = 'free';
            else if (days <= 2) cls = 'light';
            else if (days <= 4) cls = 'busy';
            else                cls = 'full';
            const name = wlDisplayName(ed.assigneeName) || 'Unknown';
            const label = days === 0 ? 'Free' : ('~' + days + ' day' + (days === 1 ? '' : 's'));
            // Chip is a button so the editor's name opens a popover of all
            // their active sub-issues (planned + in-progress, deduped).
            // data-wl-source="active" tells wlOpenRollupPopover to use that
            // combined source instead of the day-bound or in-progress lists.
            return `<button type="button" class="workload-capacity-chip ${cls}" aria-label="${wlEscape(name)} · ${ed.count} active sub-issue${ed.count !== 1 ? 's' : ''} · ${ed.units} workload unit${ed.units !== 1 ? 's' : ''} · about ${days} day${days !== 1 ? 's' : ''} of work at ${cap} units per day" data-wl-rollup="1" data-wl-count-badge="1" data-wl-source="active" data-wl-assignee-id="${wlEscape(ed.assigneeId || '')}" data-wl-client="" data-wl-editor-name="${wlEscape(name)}">
                <span class="wl-cap-name">${wlEscape(name)}</span>
                <span class="wl-cap-label">${wlEscape(label)}</span>
            </button>`;
        }).join('');
    }

    // Group sub-issues for one editor-rollup strip ("In progress now" or
    // "Tweaks needed") by editor — one card per editor, a chip per client
    // they're currently on the hook for. Both strips share the same shape
    // so the helper is parameterized by DOM ids and which wlState.* list
    // to read; the caller picks the source mode that the popover uses to
    // re-find the sub-issues when a chip is clicked.
    function renderOverdueStrip() {
        renderEditorRollupStrip({
            stripId: 'wlOverdue', rowId: 'wlOverdueRollups', totalId: 'wlOverdueTotal',
            subs: wlState.overdue, sourceMode: 'overdue',
            totalSuffix: 'OVERDUE', chipTitleSuffix: 'overdue',
        });
    }
    function renderInProgressStrip() {
        renderEditorRollupStrip({
            stripId: 'wlInProgress', rowId: 'wlInProgressRollups', totalId: 'wlInProgressTotal',
            subs: wlState.nowWorking, sourceMode: 'inprogress',
            totalSuffix: 'ACTIVE', chipTitleSuffix: 'in progress',
        });
    }
    function renderTweaksNeededStrip() {
        renderEditorRollupStrip({
            stripId: 'wlTweaks', rowId: 'wlTweaksRollups', totalId: 'wlTweaksTotal',
            subs: wlState.tweaksNeeded, sourceMode: 'tweaks',
            totalSuffix: 'NEEDED', chipTitleSuffix: 'awaiting tweaks',
        });
    }
    function renderEditorRollupStrip(opts) {
        const stripEl = document.getElementById(opts.stripId);
        const rowEl   = document.getElementById(opts.rowId);
        const totalEl = document.getElementById(opts.totalId);
        if (!stripEl || !rowEl) return;
        const subs = (opts.subs || []).filter(wlPassesFilters);
        if (!subs.length) {
            stripEl.classList.add('empty');
            rowEl.innerHTML = '';
            if (totalEl) { totalEl.hidden = true; totalEl.textContent = ''; }
            return;
        }
        stripEl.classList.remove('empty');

        const byEditor = new Map();
        for (const s of subs) {
            const key = s.assigneeId || '?';
            if (!byEditor.has(key)) {
                byEditor.set(key, {
                    assigneeId: s.assigneeId,
                    assigneeName: s.assigneeName,
                    teamKey: s.teamKey,
                    teamName: s.teamName,
                    total: 0,
                    clients: new Map(),
                });
            }
            const ed = byEditor.get(key);
            ed.total++;
            const cKey = (s.parentId || '') + '|' + (s.clientName || '');
            if (!ed.clients.has(cKey)) {
                ed.clients.set(cKey, {
                    clientName: s.clientName,
                    parentId: s.parentId,
                    assigneeId: s.assigneeId,
                    anySub: s,
                    count: 0,
                });
            }
            ed.clients.get(cKey).count++;
        }

        const editors = [...byEditor.values()].sort((a, b) => {
            const ta = wlTeamBucket(a.teamKey, a.teamName);
            const tb = wlTeamBucket(b.teamKey, b.teamName);
            if (ta !== tb) return ta === 'graphics' ? 1 : -1;
            if (a.total !== b.total) return b.total - a.total;
            return wlDisplayName(a.assigneeName).localeCompare(wlDisplayName(b.assigneeName));
        });

        if (totalEl) {
            totalEl.hidden = false;
            totalEl.textContent = subs.length + ' ' + opts.totalSuffix;
        }

        // data-wl-in-progress on the rollup is preserved purely as a metadata
        // signal for the existing popover branch; new strips use
        // data-wl-source so the popover picks the right wlState.* list.
        const inProgFlag = opts.sourceMode === 'inprogress' ? '1' : '0';
        rowEl.innerHTML = editors.map(ed => {
            const name = wlDisplayName(ed.assigneeName) || 'Unknown';
            const initials = wlInitials(ed.assigneeName);
            const clients = [...ed.clients.values()].sort((a, b) => {
                if (a.count !== b.count) return b.count - a.count;
                return (a.clientName || '').localeCompare(b.clientName || '');
            });
            const chips = clients.map(c => {
                const href = wlParentUrl(c.anySub);
                const label = c.clientName || '—';
                return `<a class="wl-now-client-chip" href="${wlEscape(href)}" target="_blank" rel="noopener noreferrer" aria-label="${wlEscape(label)} · ${c.count} ${opts.chipTitleSuffix}" data-wl-rollup="1" data-wl-count-badge="1" data-wl-source="${wlEscape(opts.sourceMode)}" data-wl-parent-id="${wlEscape(c.parentId || '')}" data-wl-assignee-id="${wlEscape(c.assigneeId || '')}" data-wl-client="${wlEscape(c.clientName || '')}" data-wl-in-progress="${inProgFlag}" data-wl-editor-name="${wlEscape(name)}">
                    <span class="wl-now-client-chip-name">${wlEscape(label)}</span>
                    <span class="wl-now-client-chip-count">${c.count}</span>
                </a>`;
            }).join('');
            const totalLabel = `See the ${ed.total} ${opts.chipTitleSuffix} sub-issue${ed.total !== 1 ? 's' : ''}`;
            return `<div class="wl-now-card">
                <div class="wl-now-card-head">
                    <span class="wl-now-avatar">${wlEscape(initials)}</span>
                    <span class="wl-now-card-name">${wlEscape(name)}</span>
                    <button type="button" class="wl-now-card-total" data-wl-rollup="1" data-wl-count-badge="1" data-wl-source="${wlEscape(opts.sourceMode)}" data-wl-assignee-id="${wlEscape(ed.assigneeId || '')}" data-wl-client="" data-wl-in-progress="${inProgFlag}" data-wl-editor-name="${wlEscape(name)}" aria-label="${wlEscape(totalLabel)}">${ed.total}</button>
                </div>
                <div class="wl-now-card-clients">${chips}</div>
            </div>`;
        }).join('');
    }

    function renderUndatedStrip() {
        renderLooseIssueStrip('wlUndated', 'wlUndatedChips', wlState.undated, true);
    }

    function renderUnassignedStrip() {
        renderLooseIssueStrip('wlUnassigned', 'wlUnassignedChips', wlState.unassigned, false);
    }

    /* SyncLinear deep link for a Linear identifier.

       Same shape the workload popover has used since the 2026-08-21 owner
       request ("it opens the original linear... make it so it opens our sync
       linear"): ?prod=1&d=<identifier>, which the Production tab resolves by
       displayId and falls back to its own list view for anything it cannot
       find. Read-only navigation, never a write. */
    function wlSyncLinearUrl(identifier) {
        const ident = String(identifier || '').trim();
        return ident ? svRoute.clean('/?prod=1&d=' + encodeURIComponent(ident)) : '';
    }

    /* The parent a loose sub-issue hangs off, as far as this board can see it.

       `parentById` only holds parents that came back in THIS snapshot, and a
       sub whose parent is filtered out of the snapshot still carries
       `parentIdentifier` from workload_issues -- which is all the SyncLinear
       deep link needs. So the identifier falls back to the sub's own copy and
       a group is still openable when the parent row itself is absent; only the
       human-readable title and the Linear escape hatch degrade. */
    function wlLooseParentInfo(sub) {
        const parentId = String(sub && sub.parentId || '');
        const parent = parentId ? wlState.parentById.get(parentId) : null;
        const identifier = String((parent && parent.identifier) || (sub && sub.parentIdentifier) || '');
        if (!parentId && !identifier) return null;
        return {
            key: parentId || identifier,
            nativeBatchId: sub && sub.workloadSource === 'native' ? parentId : '',
            identifier,
            title: String((parent && parent.title) || ''),
            url: String((parent && parent.url) || ''),
        };
    }

    /* Loose sub-issues, grouped CLIENT then PARENT ISSUE.

       Owner request 2026-09-07, looking at a flat 30-chip "Needs assignment"
       wall: the two loose strips are where someone goes to hand work out, and
       a flat list makes them re-derive by eye which chips belong to the same
       client and the same parent. Sub-issues under one parent are almost
       always assigned together, so the parent gets ONE button that opens it in
       SyncLinear -- where the assigning actually happens -- instead of thirty
       chips each opening Linear one sub-issue at a time.

       Sub-issues with no parent still render; they group under their client
       with no parent button of their own, each chip opening its own SyncLinear
       row. Linear stays one small click away on every group and every chip: it
       is a reference and the rollback path, and removing a working escape
       hatch costs more than the extra icon.

       `applyEditorFilter` is the only thing that still separates the two
       strips. The undated strip used to pair every chip with a "Set work day"
       button opening the plan popover; the owner pulled it on 2026-09-07 ("for
       now") once the strips became a scan-and-hand-out queue rather than a
       place to plan, and dropping ~25 buttons is most of what made the block
       compact. Nothing else changed with it: the popover, wlSetPlanDate and
       the delegated [data-wl-issue-open] handler are all untouched and still
       reached from the calendar, so restoring the button is re-rendering it,
       not rebuilding a path. */
    function renderLooseIssueStrip(stripId, chipsId, source, applyEditorFilter) {
        const stripEl = document.getElementById(stripId);
        const chipsEl = document.getElementById(chipsId);
        if (!stripEl || !chipsEl) return;
        const filtered = (source || []).filter(s => {
            if (wlState.team !== 'all' && wlTeamBucket(s.teamKey, s.teamName) !== wlState.team) return false;
            if (applyEditorFilter && wlState.editor !== 'all' && s.assigneeId !== wlState.editor) return false;
            if (wlState.client !== 'all' && s.clientName !== wlState.client) return false;
            return true;
        });
        if (!filtered.length) {
            stripEl.classList.add('empty');
            chipsEl.innerHTML = '';
            chipsEl.__wlLooseSig = '';
            return;
        }
        stripEl.classList.remove('empty');

        const byClient = new Map();
        for (const s of filtered) {
            const clientName = s.clientName || '';
            // Leading space keys cannot collide with a real client name,
            // Linear id or identifier, so the two fallback buckets below stay
            // distinct from every genuine group.
            const clientKey = clientName || ' noclient';
            if (!byClient.has(clientKey)) byClient.set(clientKey, { clientName, total: 0, groups: new Map() });
            const client = byClient.get(clientKey);
            client.total++;
            const parent = wlLooseParentInfo(s);
            const groupKey = parent ? parent.key : ' noparent';
            if (!client.groups.has(groupKey)) client.groups.set(groupKey, { parent, subs: [] });
            client.groups.get(groupKey).subs.push(s);
        }

        const clients = [...byClient.values()].sort((a, b) =>
            (a.clientName || '').localeCompare(b.clientName || ''));
        /* AN UNCHANGED STRIP IS NOT REBUILT.
           Both loose strips render one chip per loose sub-issue, with two
           links and an icon each, and every renderWorkloadAll rebuilt them
           from scratch. A cold boot paints twice -- the fast paint, then the
           settle once plans and weights land -- and the loose lists are
           almost always identical across the two, so the second rebuild is
           pure waste: 2.3 s of a 2.6 s render at live shape, profiled
           2026-09-15.
           The signature covers EVERY field the markup below reads (the three
           filters, each sub's id/identifier/title/url/client/team and the
           sort order the chips are ordered by, and the resolved parent's
           key/identifier/title/url), so anything the user could see changing
           still rebuilds. It is checked against the DOM
           actually on screen, so a strip wiped by anything else is rebuilt
           rather than assumed good. */
        const looseSignature = [
            wlState.team, applyEditorFilter ? wlState.editor : '-', wlState.client,
            ...clients.map(client => [
                client.clientName, client.total,
                ...[...client.groups.values()].map(group => [
                    group.parent ? [group.parent.key, group.parent.identifier, group.parent.title, group.parent.url].join('\u0001') : '-',
                    ...group.subs.map(sub => [
                        sub.id, sub.identifier, sub.title, sub.url, sub.clientName, sub.teamKey, sub.teamName,
                        // wlSortSubIssues orders the chips inside a parent group by
                        // the native sort order first, so a snapshot that changes
                        // only that field still has to redraw (Codex, #1402).
                        sub.sortOrder ?? sub.sort_order,
                    ].join('\u0001')),
                ].join('\u0002')),
            ].join('\u0003')),
        ].join('\u0004');
        if (chipsEl.__wlLooseSig === looseSignature && chipsEl.childElementCount > 0) return;
        chipsEl.__wlLooseSig = looseSignature;

        const externalMark = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.6 2.4h3v3"/><path d="M9.6 2.4 5.2 6.8"/><path d="M9.6 6.6v3h-7v-7h3"/></svg>`;
        chipsEl.innerHTML = clients.map(client => {
            const clientLabel = client.clientName || 'No client';
            const groups = [...client.groups.values()].sort((a, b) => {
                // Parentless subs sink to the bottom of their client; the rest
                // hold a stable identifier order so a refresh does not reshuffle
                // the block someone is reading.
                if (!a.parent !== !b.parent) return a.parent ? -1 : 1;
                if (!a.parent) return 0;
                return (a.parent.identifier || '').localeCompare(b.parent.identifier || '', undefined, { numeric: true });
            });
            const groupsHtml = groups.map(group => {
                const parent = group.parent;
                const subs = wlSortSubIssues(group.subs);
                const syncUrl = parent && parent.nativeBatchId
                    ? svRoute.clean('/?prod=1&batch=' + encodeURIComponent(parent.nativeBatchId))
                    : parent ? wlSyncLinearUrl(parent.identifier) : '';
                const parentName = parent ? (parent.identifier || 'the parent issue') : '';
                const openBtn = syncUrl
                    ? `<a class="wl-loose-open" href="${wlEscape(syncUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${wlEscape('Open ' + parentName + ' in SyncLinear to assign its sub-issues')}"><span>Open in SyncLinear</span>${externalMark}</a>`
                    : '';
                const parentHead = parent
                    ? `<span class="wl-loose-parent-ident">${wlEscape(parent.identifier || 'Parent')}</span>${parent.title ? `<span class="wl-loose-parent-title">${wlEscape(parent.title)}</span>` : ''}`
                    : `<span class="wl-loose-parent-title wl-loose-parent-title-none">No parent issue</span>`;
                const chips = subs.map(s => {
                    const team = wlTeamBucket(s.teamKey, s.teamName);
                    const dot = `<span class="workload-legend-swatch" style="background:${team === 'graphics' ? 'var(--sv-misc-d97706)' : 'var(--sv-misc-6c5ce7)'}"></span>`;
                    const accessible = [s.identifier || '', s.title || '', s.clientName || ''].filter(Boolean).join(' · ');
                    const subSyncUrl = wlSyncLinearUrl(s.nativeId || s.identifier) || s.url || '';
                    return `<span class="workload-loose-item"><a class="workload-chip" href="${wlEscape(subSyncUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${wlEscape(accessible)}">
                        ${dot}<span>${wlEscape(s.title)}</span>
                    </a></span>`;
                }).join('');
                return `<div class="wl-loose-parent${parent ? '' : ' is-orphan'}">
                    <div class="wl-loose-parent-head">
                        ${parentHead}
                        <span class="wl-loose-parent-count">${subs.length}</span>
                        ${openBtn}
                    </div>
                    <div class="workload-chips wl-loose-parent-chips">${chips}</div>
                </div>`;
            }).join('');
            return `<section class="wl-loose-client" aria-label="${wlEscape(clientLabel)}">
                <div class="wl-loose-client-head">
                    <span class="wl-loose-client-name">${wlEscape(clientLabel)}</span>
                    <span class="wl-loose-client-count">${client.total}</span>
                </div>
                <div class="wl-loose-parents">${groupsHtml}</div>
            </section>`;
        }).join('');
    }

    function wlWeekDeadlineTracks(startISO) {
        const endISO = wlAddDays(startISO, 4);
        const byEditor = new Map();
        for (let dayIndex = 0; dayIndex < 5; dayIndex++) {
            const planDate = wlAddDays(startISO, dayIndex);
            const subs = (wlState.calendarByDate.get(planDate) || []).filter(wlPassesFilters);
            for (const sub of subs) {
                // Match the existing calendar's editor grouping and group-drag
                // selector exactly: one assignee owns one visible client chip.
                const editorKey = sub.assigneeId || '?';
                if (!byEditor.has(editorKey)) {
                    byEditor.set(editorKey, {
                        assigneeId: sub.assigneeId,
                        assigneeName: sub.assigneeName,
                        teamKey: sub.teamKey,
                        teamName: sub.teamName,
                        dailySubs: Array.from({ length: 5 }, () => []),
                        trackMap: new Map(),
                    });
                }
                const editor = byEditor.get(editorKey);
                editor.dailySubs[dayIndex].push(sub);
                const trackKey = `${planDate}|${sub.clientName || ''}`;
                if (!editor.trackMap.has(trackKey)) {
                    editor.trackMap.set(trackKey, {
                        planDate,
                        planIndex: dayIndex,
                        clientName: sub.clientName || '',
                        parentId: sub.parentId || '',
                        subs: [],
                    });
                }
                editor.trackMap.get(trackKey).subs.push(sub);
            }
        }

        return [...byEditor.values()].map(editor => {
            const tracks = [...editor.trackMap.values()].map(track => {
                track.subs = wlSortSubIssues(track.subs);
                track.deadline = wlGroupDeadlineSummary(track.subs);
                track.sameDaySubs = [];
                const dueMap = new Map();
                for (const sub of track.subs) {
                    const dueDate = String(sub && sub.dueDate || '').slice(0, 10);
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) continue;
                    if (dueDate === track.planDate) {
                        track.sameDaySubs.push(sub);
                        continue;
                    }
                    if (!dueMap.has(dueDate)) dueMap.set(dueDate, []);
                    dueMap.get(dueDate).push(sub);
                }
                track.endpoints = [...dueMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([dueDate, rows]) => {
                    const before = dueDate < startISO;
                    const after = dueDate > endISO;
                    const targetIndex = before ? 0 : (after ? 4 : wlCalendarDayDiff(startISO, dueDate));
                    return {
                        dueDate,
                        subs: wlSortSubIssues(rows),
                        targetIndex,
                        boundary: before ? 'before' : (after ? 'after' : ''),
                        tone: wlDeadlineMeta(dueDate, track.planDate).tone,
                    };
                });
                return track;
            }).sort((a, b) => a.planDate.localeCompare(b.planDate) || wlCompareClientGroups(a, b, a.planDate));
            editor.tracks = tracks;
            delete editor.trackMap;
            return editor;
        }).sort((a, b) => {
            const ta = wlTeamBucket(a.teamKey, a.teamName);
            const tb = wlTeamBucket(b.teamKey, b.teamName);
            if (ta !== tb) return ta === 'graphics' ? 1 : -1;
            return wlDisplayName(a.assigneeName).localeCompare(wlDisplayName(b.assigneeName));
        });
    }

    function wlTimelineSameDayHtml(track) {
        const count = (track.sameDaySubs || []).length;
        if (!count) return '';
        const tone = wlDeadlineMeta(track.planDate, track.planDate).tone;
        const label = `${count} also due on the planned day`;
        return `<span class="workload-timeline-same-day${tone ? ' is-' + tone : ''}" role="img" aria-label="${wlEscape(label)}">${wlDeadlineDotHtml()}Due here · ${count}</span>`;
    }

    function wlRenderTimelineTrack(track, editor, trackNumber) {
        const sourceY = 24;
        let nextSameColumnY = 24 + (track.endpoints.length * 44);
        const endpointYs = track.endpoints.map((endpoint, index) => {
            const y = 24 + (index * 44);
            // A deadline just beyond a visible edge clamps into the plan
            // column. Stack that endpoint below the source instead of laying
            // two pills on top of each other.
            if (endpoint.targetIndex === track.planIndex && Math.abs(y - sourceY) < 38) {
                const stacked = nextSameColumnY;
                nextSameColumnY += 44;
                return stacked;
            }
            return y;
        });
        const height = Math.max(58, Math.max(sourceY, ...endpointYs) + 34);
        const canDragGroup = wlPlanEditingEnabled() && !!track.clientName && track.subs.length
            && track.subs.every(sub => String(sub.id || '') && !_wlPlanWriteInFlight.has(String(sub.id || '')));
        const clientName = track.clientName || '—';
        const lineParts = [];
        const endpointParts = [];
        for (let index = 0; index < track.endpoints.length; index++) {
            const endpoint = track.endpoints[index];
            const y = endpointYs[index];
            const direction = endpoint.boundary === 'before' ? -1
                : (endpoint.boundary === 'after' ? 1 : (endpoint.targetIndex >= track.planIndex ? 1 : -1));
            const sourceX = (track.planIndex * 100) + 50 + (47 * direction);
            const targetX = endpoint.targetIndex === track.planIndex
                ? sourceX
                : (endpoint.targetIndex * 100) + 50 - (47 * direction);
            const targetY = endpoint.targetIndex === track.planIndex ? Math.max(sourceY + 6, y - 20) : y;
            const ids = endpoint.subs.map(sub => String(sub.id || '')).filter(Boolean).join('|');
            if (sourceX !== targetX || sourceY !== targetY) {
                lineParts.push(`<line class="workload-timeline-connector${endpoint.tone ? ' is-' + endpoint.tone : ''}" x1="${sourceX}" y1="${sourceY}" x2="${targetX}" y2="${targetY}" data-wl-deadline-ids="${wlEscape(ids)}" data-wl-tone="${wlEscape(endpoint.tone || '')}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`);
            }
            const boundaryLabel = endpoint.boundary === 'before'
                ? `← Due ${wlFormatShort(endpoint.dueDate)}`
                : (endpoint.boundary === 'after' ? `Due ${wlFormatShort(endpoint.dueDate)} →` : clientName);
            const deadlineLabel = `${endpoint.subs.length} due ${wlFormatShort(endpoint.dueDate)}; planned ${wlFormatShort(track.planDate)}`;
            endpointParts.push(`<span class="workload-timeline-endpoint-slot" style="grid-column:${endpoint.targetIndex + 1};--wl-endpoint-top:${y - 16}px;">
                <button type="button" class="workload-timeline-due${endpoint.tone ? ' is-' + endpoint.tone : ''}${endpoint.boundary ? ' workload-timeline-continuation' : ''}" data-wl-deadline-open="${wlEscape(ids)}" data-wl-assignee-id="${wlEscape(editor.assigneeId || '')}" data-wl-client="${wlEscape(track.clientName || '')}" data-wl-date="${wlEscape(endpoint.dueDate)}" aria-label="${wlEscape(deadlineLabel)}">
                    ${wlDeadlineDotHtml()}
                    <span class="workload-timeline-due-name">${wlEscape(boundaryLabel)}</span>
                    <span class="workload-timeline-due-count">· ${endpoint.subs.length}</span>
                    ${wlGroupWorkloadHtml(endpoint.subs)}
                </button>
            </span>`);
        }
        return `<div class="workload-timeline-relationship" data-wl-track="${trackNumber}" style="--wl-track-height:${height}px;">
            <svg class="workload-timeline-lines" viewBox="0 0 500 ${height}" preserveAspectRatio="none" aria-hidden="true">${lineParts.join('')}</svg>
            <details class="workload-timeline-source" style="grid-column:${track.planIndex + 1};--wl-source-top:${sourceY - 17}px;">
                <summary class="workload-timeline-plan-chip" data-wl-date="${wlEscape(track.planDate)}" data-wl-assignee-id="${wlEscape(editor.assigneeId || '')}" data-wl-client="${wlEscape(track.clientName || '')}">
                    <span class="workload-day-card-chip-main">
                        ${wlGroupDeadlineHtml(track.subs)}
                        <span class="workload-day-card-chip-name">${wlEscape(clientName)}</span>
                        <span class="workload-day-card-chip-count">· ${track.subs.length}</span>
                    </span>
                    <span class="workload-day-card-chip-meta">
                        ${wlGroupPlanOriginHtml(track.subs)}
                        ${wlGroupWorkloadHtml(track.subs)}
                        ${wlTimelineSameDayHtml(track)}
                        ${wlGroupDragHandleHtml(track.planDate, editor.assigneeId, track.clientName, canDragGroup)}
                    </span>
                </summary>
                <div class="workload-timeline-items">${wlRenderPlanIssueCards(track.subs, track.planDate)}</div>
            </details>
            ${endpointParts.join('')}
        </div>`;
    }

    function renderWeekDeadlineTimeline() {
        const todayISO = wlWorkloadTodayISO();
        const start = wlState.weekStart;
        const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dates = Array.from({ length: 5 }, (_, index) => wlAddDays(start, index));
        const weekdayHtml = `<div class="workload-timeline-header">
            <div class="workload-timeline-editor-rail workload-timeline-editor-rail-head" aria-hidden="true"></div>
            <div class="workload-weekdays week workload-timeline-weekdays">${dates.map(iso => {
            const day = wlParseISO(iso);
            const isToday = iso === todayISO;
            return `<div class="workload-weekday workload-timeline-weekday${isToday ? ' today' : ''}"${isToday ? ' aria-current="date"' : ''}>${isToday ? '<span class="workload-timeline-today-marker">Today</span> · ' : ''}${dayLabels[day.getDay()]} · ${day.getDate()}</div>`;
        }).join('')}</div>
        </div>`;
        const dayColumns = dates.map((iso, index) => {
            const day = wlParseISO(iso);
            const classes = ['workload-timeline-day'];
            if (iso === todayISO) classes.push('today');
            return `<div class="${classes.join(' ')}" data-wl-day="${wlEscape(iso)}" data-wl-day-index="${index}" aria-label="${wlEscape(wlFormatShort(iso))} drop target"></div>`;
        }).join('');
        const editors = wlWeekDeadlineTracks(start);
        // One banner per editor for the whole week, so the exception pills sit
        // there rather than on a day — no today-only scoping needed here.
        const statusCounts = wlEditorStatusCounts();
        let trackNumber = 0;
        const editorHtml = editors.map(editor => {
            const team = wlTeamBucket(editor.teamKey, editor.teamName);
            const name = wlDisplayName(editor.assigneeName) || 'Unknown';
            const capacity = wlEditorCapacity(editor.teamKey, editor.teamName);
            const head = editor.dailySubs.map((subs, index) => {
                const count = subs.length;
                const units = wlWorkloadUnits(subs);
                const overBy = Math.max(0, units - capacity);
                const date = dates[index];
                const totalLabel = overBy
                    ? `${name} is ${overBy} workload unit${overBy === 1 ? '' : 's'} over the ${capacity}-unit daily capacity; all work remains visible`
                    : `${count} planned sub-issue${count === 1 ? '' : 's'} using ${units} of ${capacity} workload units`;
                const total = count ? `<button type="button" class="workload-timeline-day-total${overBy ? ' over-capacity' : ''}" data-wl-rollup="1" data-wl-count-badge="1" data-wl-assignee-id="${wlEscape(editor.assigneeId || '')}" data-wl-client="" data-wl-date="${wlEscape(date)}" data-wl-editor-name="${wlEscape(name)}" aria-label="${wlEscape(totalLabel)}">${overBy ? `${units}/${capacity} · ${overBy} over` : `${units}/${capacity}`}</button>` : '';
                return `<div class="workload-timeline-editor-day">${total}</div>`;
            }).join('');
            const tracks = editor.tracks.map(track => wlRenderTimelineTrack(track, editor, ++trackNumber)).join('');
            return `<section class="workload-timeline-editor team-${team}" aria-label="${wlEscape(name)} editor">
                <div class="workload-timeline-editor-banner workload-timeline-editor-rail" role="heading" aria-level="3">
                    <span class="workload-timeline-editor-kicker">Editor</span>
                    <span class="workload-timeline-editor-name">${wlEscape(name)}</span>
                    ${wlEditorStatusPillsHtml(editor.assigneeId, name, statusCounts)}
                </div>
                <div class="workload-timeline-day-lane">
                    <div class="workload-timeline-editor-head">${head}</div>
                    <div class="workload-timeline-tracks">${tracks}</div>
                </div>
            </section>`;
        }).join('');
        return `<div class="workload-grid-wrap workload-timeline-wrap">
            ${weekdayHtml}
            <div class="workload-timeline-stage" data-wl-timeline-stage="1">
                <div class="workload-timeline-day-columns">${dayColumns}</div>
                <div class="workload-timeline-editors">${editorHtml || '<div class="workload-timeline-empty">No planned work in this week.</div>'}</div>
            </div>
        </div>`;
    }

    function renderWeekGrid() {
        const todayISO = wlWorkloadTodayISO();
        const start = wlState.weekStart; // Monday of the visible work week
        const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        let weekdayHtml = '<div class="workload-weekdays week">';
        for (let i = 0; i < 5; i++) {
            const iso = wlAddDays(start, i);
            const d = wlParseISO(iso);
            weekdayHtml += `<div class="workload-weekday">${dayLabels[d.getDay()]} · ${d.getDate()}</div>`;
        }
        weekdayHtml += '</div>';

        let gridHtml = '<div class="workload-grid week">';
        for (let i = 0; i < 5; i++) {
            const iso = wlAddDays(start, i);
            const d = wlParseISO(iso);
            const isToday = iso === todayISO;
            const classes = ['workload-day'];
            if (isToday) classes.push('today');
            let groups, count, overCapacity;
            if (isToday) {
                ({ groups, count, overCapacity } = wlTodayRollups(todayISO));
            } else {
                const allDue = wlState.calendarByDate.get(iso) || [];
                const subs = allDue.filter(wlPassesFilters);
                groups = wlGroupRollups(subs);
                count = subs.length;
                overCapacity = wlDayOverCapacity(subs);
            }
            if (overCapacity) classes.push('over-capacity');
            const rowsHtml = renderDayRollups(groups, iso);
            const countBadge = count ? `<span class="workload-day-count">${count}</span>` : '';
            gridHtml += `<div class="${classes.join(' ')}" data-wl-day="${wlEscape(iso)}">
                <div class="workload-day-num"><span>${d.getDate()}</span>${countBadge}</div>
                ${rowsHtml}
            </div>`;
        }
        gridHtml += '</div>';
        return '<div class="workload-grid-wrap">' + weekdayHtml + gridHtml + '</div>';
    }

    function renderMonthGrid() {
        const { year, month } = wlState;
        const todayISO = wlWorkloadTodayISO();
        const firstDow = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const leading = firstDow;
        const totalCells = Math.ceil((leading + daysInMonth) / 7) * 7;

        const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        let weekdayHtml = '<div class="workload-weekdays month">' +
            weekdays.map(w => `<div class="workload-weekday">${w}</div>`).join('') +
            '</div>';

        let gridHtml = '<div class="workload-grid month">';
        for (let i = 0; i < totalCells; i++) {
            const dayOffset = i - leading;
            const cellDate = new Date(year, month, 1 + dayOffset);
            const y = cellDate.getFullYear();
            const m = cellDate.getMonth();
            const d = cellDate.getDate();
            const iso = wlISO(y, m, d);
            const outOfMonth = (m !== month);
            const weekend = wlIsWeekend(y, m, d);
            const isToday = iso === todayISO;

            const classes = ['workload-day'];
            if (outOfMonth) classes.push('out-of-month');
            if (weekend)    classes.push('weekend');
            if (isToday)    classes.push('today');

            let groups, count, overCapacity;
            if (isToday) {
                ({ groups, count, overCapacity } = wlTodayRollups(todayISO));
            } else {
                const allDue = wlState.calendarByDate.get(iso) || [];
                const subs = allDue.filter(wlPassesFilters);
                groups = wlGroupRollups(subs);
                count = subs.length;
                overCapacity = wlDayOverCapacity(subs);
            }
            if (overCapacity) classes.push('over-capacity');
            const rowsHtml = renderDayRollups(groups, iso);
            const countBadge = count ? `<span class="workload-day-count">${count}</span>` : '';

            gridHtml += `<div class="${classes.join(' ')}" data-wl-day="${wlEscape(iso)}">
                <div class="workload-day-num"><span>${d}</span>${countBadge}</div>
                ${rowsHtml}
            </div>`;
        }
        gridHtml += '</div>';
        return '<div class="workload-grid-wrap">' + weekdayHtml + gridHtml + '</div>';
    }

    function wlRenderPlanIssueCards(orderedSubs, dayISO) {
        return (orderedSubs || []).map(s => {
            const issueId = String(s.id || '');
            const canDrag = wlPlanEditingEnabled() && !_wlPlanWriteInFlight.has(issueId);
            const mode = wlPlacementMode(s);
            const label = s.title || s.identifier || 'Work';
            const planDate = dayISO || wlDisplayDate(s);
            const titleAttr = [s.identifier || '', s.title || '', 'open details'].filter(Boolean).join(' · ');
            return `<div class="workload-plan-item-wrap">
                <button type="button" class="workload-plan-item${canDrag ? '' : ' is-readonly'}" data-wl-issue-open="1" data-wl-issue-id="${wlEscape(issueId)}" data-wl-parent-id="${wlEscape(s.parentId || '')}" data-wl-assignee-id="${wlEscape(s.assigneeId || '')}" data-wl-client="${wlEscape(s.clientName || '')}" data-wl-date="${wlEscape(dayISO || '')}" aria-label="${wlEscape(titleAttr)}">
                    <span class="workload-plan-item-content">
                        <span class="workload-plan-item-title-line">
                            <span class="workload-plan-item-label">${wlEscape(label)}</span>
                            ${wlWorkloadBadgeHtml(s, true)}
                            ${wlPlanOriginHtml(mode, false, 0, mode === 'auto' ? wlAutoPlacementTip(s) : '')}
                            ${wlIssueDragHandleHtml(issueId, canDrag)}
                        </span>
                        <span class="workload-plan-item-meta">${wlDeadlineTagHtml(s.dueDate, planDate)}</span>
                    </span>
                </button>
            </div>`;
        }).join('');
    }

    // Render a day's worth of work as one card per editor, with a chip per
    // client they're assigned to that day. This mirrors the "In progress now"
    // strip so the calendar reads the same way: editor first, then the list
    // of clients they're working on. Each chip's text links to the parent
    // Linear issue; clicking the count badge opens a popover with the
    // individual sub-issues.
    function renderDayRollups(groups, dayISO) {
        if (!groups.length) return '';

        // Overdue / tweaks / in-progress are live states, not work planned for
        // a date, so they only belong on today's cell. Repeating them on every
        // day would print the same three numbers five times across the week.
        const statusCounts = String(dayISO || '') === wlWorkloadTodayISO()
            ? wlEditorStatusCounts()
            : null;

        // Collapse the (editor × client) groups into one entry per editor.
        const byEditor = new Map();
        for (const g of groups) {
            const key = g.assigneeId || '?';
            if (!byEditor.has(key)) {
                byEditor.set(key, {
                    assigneeId: g.assigneeId,
                    assigneeName: g.assigneeName,
                    teamKey: g.teamKey,
                    teamName: g.teamName,
                    total: 0,
                    clients: [],
                    subs: [],
                });
            }
            const ed = byEditor.get(key);
            ed.total += wlWorkloadUnits(g.subs);
            ed.clients.push(g);
            ed.subs.push(...(Array.isArray(g.subs) ? g.subs : (g.anySub ? [g.anySub] : [])));
        }
        const editors = [...byEditor.values()].sort((a, b) => {
            // Graphics goes to the bottom; video editors first.
            const ta = wlTeamBucket(a.teamKey, a.teamName);
            const tb = wlTeamBucket(b.teamKey, b.teamName);
            if (ta !== tb) return ta === 'graphics' ? 1 : -1;
            return wlDisplayName(a.assigneeName).localeCompare(wlDisplayName(b.assigneeName));
        });

        return editors.map(ed => {
            const team = wlTeamBucket(ed.teamKey, ed.teamName);
            const name = wlDisplayName(ed.assigneeName) || 'Unknown';
            const capacity = wlEditorCapacity(ed.teamKey, ed.teamName);
            const overBy = Math.max(0, ed.total - capacity);
            const clientGroups = ed.clients.slice().sort((a, b) => wlCompareClientGroups(a, b, dayISO)).map(g => {
                const clientName = g.clientName || '—';
                const orderedSubs = wlSortSubIssues(g.subs);
                const canDragGroup = wlPlanEditingEnabled() && !!g.clientName && orderedSubs.length
                    && orderedSubs.every(s => String(s.id || '')
                        && !_wlPlanWriteInFlight.has(String(s.id || '')));
                const issueCards = wlRenderPlanIssueCards(orderedSubs, dayISO);
                return `<details class="workload-day-client-group">
                    <summary class="workload-day-card-chip" data-wl-date="${wlEscape(dayISO || '')}" data-wl-assignee-id="${wlEscape(ed.assigneeId || '')}" data-wl-client="${wlEscape(g.clientName || '')}">
                        <span class="workload-day-card-chip-main">
                            ${wlGroupDeadlineHtml(orderedSubs)}
                            <span class="workload-day-card-chip-name">${wlEscape(clientName)}</span>
                            <span class="workload-day-card-chip-count">· ${g.count}</span>
                        </span>
                        <span class="workload-day-card-chip-meta">
                            ${wlGroupPlanOriginHtml(orderedSubs)}
                            ${wlGroupWorkloadHtml(orderedSubs)}
                            ${wlGroupDragHandleHtml(dayISO, ed.assigneeId, g.clientName, canDragGroup)}
                        </span>
                    </summary>
                    <div class="workload-day-card-items">${issueCards}</div>
                </details>`;
            }).join('');
            return `<div class="workload-day-card team-${team}">
                <div class="workload-day-card-head">
                    <span class="workload-day-card-name">${wlEscape(name)}</span>
                    <button type="button" class="workload-day-card-total${overBy ? ' over-capacity' : ''}" data-wl-rollup="1" data-wl-count-badge="1" data-wl-assignee-id="${wlEscape(ed.assigneeId || '')}" data-wl-client="" data-wl-in-progress="0" data-wl-date="${wlEscape(dayISO || '')}" data-wl-editor-name="${wlEscape(name)}" aria-label="${overBy ? `${name} is ${overBy} workload unit${overBy === 1 ? '' : 's'} over the ${capacity}-unit daily capacity; all work remains visible` : `See ${ed.total} workload unit${ed.total === 1 ? '' : 's'} across ${ed.subs.length} sub-issue${ed.subs.length === 1 ? '' : 's'}`}">${overBy ? `${ed.total}/${capacity} · ${overBy} over` : ed.total}</button>
                </div>
                ${statusCounts ? wlEditorStatusPillsHtml(ed.assigneeId, name, statusCounts) : ''}
                <div class="workload-day-card-clients">${clientGroups}</div>
            </div>`;
        }).join('');
    }
    // ── Sub-issue popover ────────────────────────────────────────────────
    // Fetches the underlying subs for a rollup (either the in-progress list
    // or the work-on-that-day list), filters by assignee+client, and
    // renders a popover anchored to the clicked rollup.
    /* ── Tweak-comment preview ──────────────────────────────────────────
       When a popover lists sub-issues that sit in "Tweak Needed", the
       feedback that bounced them back is read from SyncView's own
       comments (`production-comments`, native rows and legacy rows bound
       to a native deliverable) and shown inline. The old Linear read (the
       `linear-tweak-comments` n8n webhook) was retired in B2 after the
       Linear keys were revoked; a row with no native binding now says so
       plainly instead of asking a dead webhook.
       Tweaks left in Frame.io never reach SyncView, hence the standing
       "always check Frame.io" note. */
    let _wlTweakCommentsToken = 0;           // invalidates in-flight fills when a newer popover opens
    // Native rows read their feedback from Supabase (`production-comments`);
    // so does a LEGACY row the snapshot bound to a native deliverable
    // (`legacyBoundNativeId`, Linear-exit Workload slice 1/2, item 3 in
    // LINEAR_EXIT_STEP26_NATIVE_WORKLOAD.md). Everything else -- unbound
    // legacy rows, and foreign/provider-authority rows with no native
    // mapping -- has no feedback source this page can read any more: the
    // Linear-backed n8n lane was retired (B2), so those rows settle at once
    // as `retired` and render an explicit "not shown here" notice, never an
    // empty box and never a retry that cannot succeed.
    //
    // Routing is deliberately PERMISSIVE (AGENTS.md): a row we cannot classify
    // falls back rather than refusing, because a refusal here renders as "no
    // feedback" and an absence is the one failure an editor cannot report.
    // Integrity INSIDE the native read stays strict for the opposite reason —
    // feedback presented as complete when it is not is precisely the failure
    // this lane exists to prevent.
    // Must equal `PROD_COMMENTS_PAGE_SIZE` (declared in a nested scope this block
    // cannot see) and the `body.limit === 50` literal that
    // docs/syncview-design/tests/prod-structure-subset.js and
    // prod-readonly-smoke.js enforce on every production-comments POST leaving
    // this page. test/workload-tweak-feedback-source.js asserts all three agree,
    // so this second declaration cannot drift from the first.
    const WL_TWEAK_FEEDBACK_PAGE_SIZE = 50;
    // BOUND THE COLLECTION, NOT ONLY EACH ROW. Settling per row (below) fixed
    // the failure that let one deliverable destroy the collection, and bought a
    // second one with it: every native read carries its own
    // WL_PLAN_READ_TIMEOUT_MS abort, so awaiting them one after another made
    // this popover's worst case N x that timeout. Twenty unreachable rows held
    // EVERY box on skeletons for 160s, where the all-or-nothing chain gave up
    // after 8s and no successful row rendered until the last one had timed out.
    // Isolation had traded a fast total failure for a slow partial one, which
    // on a wide rollup is the worse of the two.
    // Two bounds, because they fail differently. The POOL caps the cost at
    // ceil(N / pool) timeouts instead of N. The DEADLINE caps the wall clock
    // outright, so an N nobody predicted still terminates: rows still
    // outstanding when it expires are aborted and render as failed, and rows
    // that already settled keep their real answer.
    // The pool is deliberately SMALL. The endpoint's per-actor rate limit is
    // one of the failures that produced the original defect, and firing a wide
    // rollup at it in a single burst would trade a slow read for a rate-limited
    // one -- the same outage in a different costume.
    const WL_TWEAK_FEEDBACK_POOL = 4;
    const WL_TWEAK_FEEDBACK_DEADLINE_MS = 20000;
    // ONE READ PER DELIVERABLE PER WINDOW, AND NONE AT ALL ONCE NOBODY IS
    // LOOKING. `production_comment_read_budget_take` allows 120 requests per
    // actor per fixed five-minute window
    // (migrations/2026-07-23-production-comment-thread-lifecycle.sql), and it is
    // PRINCIPAL-wide by design — exhausting it here also stops SyncLinear's
    // comment panel reading for the rest of that window. A 20-row rollup is 20+
    // requests, so six opens spend the whole budget.
    // The pool above is what made that reachable: the same six opens used to
    // take about sixteen minutes across four windows and now fit inside two
    // minutes of one. Bounding the wait bought a quota failure, so the wait is
    // bounded AND the requests are not repeated:
    //   * a whole, verified read is cached for the same TTL the legacy lane has
    //     always used on this surface, so re-opening a rollup costs nothing;
    //   * a read still queued when the popover closes or reopens elsewhere is
    //     abandoned rather than merely having its paint suppressed.
    // A failure is never cached — remembering "we could not ask" as an answer is
    // the one thing this popover must not do — and a hit is served only to the
    // staff identity that took it.
    // A CACHED READ CANNOT REVALIDATE A BINDING, so it must not outlive the
    // client's own evidence that the binding still holds. The endpoint reads the
    // linked card before AND after building this projection and answers
    // `link_changed` when the deliverable no longer names that card
    // (`feedbackCardMatches` in production-comments/feedback.mjs) — a refusal
    // that exists precisely to withhold the previous card's notes. Serving a
    // cached response skips that refusal, and a deliverable re-linked to a
    // different client's card would put THAT client's notes under this one.
    // No client-side check can prove a binding without spending the read this
    // cache exists to avoid, so the entry is instead pinned to the two things
    // the browser can prove: a short life of its own, and the exact snapshot row
    // the read was made for. `wlApplyData` replaces `issueSnapshot` with fresh
    // row objects on every refresh, so a hit dies the moment the board learns
    // anything new about that deliverable — the same identity signal
    // `_wlNativeTweakComments` already uses to refuse a read whose row moved.
    // Residual, stated rather than hidden: a re-link the browser has not yet
    // refreshed into can still be served for up to this TTL, which is why it
    // is kept short (the retired Linear lane cached for five minutes).
    const WL_NATIVE_TWEAK_COMMENTS_TTL_MS = 60 * 1000;
    const _wlNativeTweakCommentsCache = new Map(); // native deliverable id -> { fetchedAt, owner, issue, scope, rows }
    // The completed-value cache above cannot help two popovers that overlap:
    // reopening a rollup before its first reads land means both generations miss
    // it and both send a request for the same deliverable, so a slow popover
    // opened repeatedly still spends a pool-sized wave every time. In-flight
    // reads are therefore shared, not raced. The shared read is abandoned only
    // once EVERY generation waiting on it has given up — one popover walking
    // away must not fail the row for the popover that replaced it.
    const _wlNativeTweakCommentsInFlight = new Map(); // owner + id -> { promise, wanted:Set }
    // SETTLE PER ROW. A popover lists N deliverables and each one is its own
    // independent read; this loop used to be a single all-or-nothing await
    // chain, so the FIRST rejection — an aborted read on the timeout, the
    // endpoint's per-actor rate limit on a wide rollup, one row whose thread
    // moved mid-read — escaped it, and the call site's catch painted the
    // failure over EVERY box, including rows already read whole. Native reads
    // are neither cached nor cancelled, so a repeated or large rollup open is
    // where that lands. It is also the shape that blanked the Workload board
    // on 2026-09-07 (OPEN_REPAIRS 177 — six drifted rows discarded a 5,000-row
    // snapshot) one layer out: a collection destroyed by one member of it.
    // So a failed row carries `failed` and renders its own notice, and the
    // rows that answered render their real feedback. Only a whole-collection
    // fact still rejects: the signed-in staff identity moving under the read,
    // after which no row's answer belongs to the person looking at it.
    // `onRow(id, rows)` — optional — is handed ONE deliverable the moment that
    // deliverable settles, so a row that answered in 200ms paints at 200ms
    // instead of waiting on a neighbour that will hang for its whole timeout.
    // It is never called for a read the collection is about to refuse.
    // `shouldStop()` — optional — is asked before each row and each page whether
    // the answer is still wanted. Suppressing the PAINT of an unwanted read was
    // never enough: the request had already been sent and the actor-wide read
    // budget already spent on it.
    async function wlFetchTweakComments(ids, onRow, shouldStop) {
        const owner = typeof wlSnapshotIdentity === 'function' ? wlSnapshotIdentity() : null;
        const issues = new Map((wlState.issueSnapshot || []).map(issue => [issue.id, issue]));
        const unavailable = () => { const rows = []; rows.failed = true; return rows; };
        const deadline = Date.now() + WL_TWEAK_FEEDBACK_DEADLINE_MS;
        const legacy = [], native = [], out = {};
        // The whole-collection refusal has to reach the SCREEN, not just the
        // return value. Once the signed-in staff identity moves, no row's
        // answer belongs to the person looking at the popover, so from that
        // moment a settled row is neither stored nor painted; the caller's
        // catch then clears whatever was painted before the change.
        let scopeChanged = false;
        const settle = (id, rows) => {
            if (owner && owner !== wlSnapshotIdentity()) { scopeChanged = true; return; }
            out[id] = rows;
            if (typeof onRow === 'function') { try { onRow(id, rows); } catch (e) {} }
        };
        const stale = () => typeof shouldStop === 'function' && shouldStop();
        const cached = (nativeId, issue) => {
            const hit = _wlNativeTweakCommentsCache.get(nativeId);
            if (!hit) return null;
            // A cache entry belongs to the staff identity that took it. Serving
            // it to another one is the same failure the mid-read identity check
            // exists to prevent, just deferred by up to a TTL.
            // It also belongs to the snapshot row it was read for: once the board
            // refreshes, `issue` is a different object and the binding this
            // response was verified against is no longer one this browser can
            // vouch for.
            if (hit.owner !== owner || hit.issue !== issue
                || (Date.now() - hit.fetchedAt) >= WL_NATIVE_TWEAK_COMMENTS_TTL_MS) {
                _wlNativeTweakCommentsCache.delete(nativeId);
                return null;
            }
            return hit.rows;
        };
        const remember = (nativeId, issue, rows) => {
            // Expired entries are dropped on write, so the map is bounded by one
            // TTL window rather than by how long the tab has been open.
            for (const [key, hit] of _wlNativeTweakCommentsCache) {
                if ((Date.now() - hit.fetchedAt) >= WL_NATIVE_TWEAK_COMMENTS_TTL_MS) _wlNativeTweakCommentsCache.delete(key);
            }
            // The scope the endpoint verified is recorded with the answer, so a
            // stored response always says which card binding it was true for.
            _wlNativeTweakCommentsCache.set(nativeId, { fetchedAt: Date.now(), owner, issue,
                scope: (rows && rows.scope) || null, rows });
        };
        // A bound legacy row's alias is only as good as the snapshot that
        // proved it. `legacyBoundNativeId` is the CROSSWALK
        // (`workload_issues_native_v1.linear_id` -> this legacy issue), not
        // the deliverable itself, and production-comments never receives the
        // legacy issue id -- it selects `id,client_slug,team,origin,card_id`
        // off `deliverables` and can revalidate the deliverable-to-card link
        // (`link_changed`, feedback.mjs) but has nothing to check the
        // alias against. If the deliverable's `linear_issue_uuid` is
        // repointed to a DIFFERENT legacy issue after this snapshot loaded,
        // that endpoint check still passes -- the deliverable still names its
        // own card -- and this row would display the new owner's feedback
        // under the old row. No Edge Function change ships in this PR, so the
        // alias cannot be revalidated server-side here; instead the bound
        // lane is refused once the snapshot that proved it is old enough that
        // this client no longer has fresh evidence for it, the same window
        // already accepted as residual risk for the card-relink check above.
        const bindingFresh = Number.isFinite(wlState.fetchedAt)
            && (Date.now() - wlState.fetchedAt) < WL_NATIVE_TWEAK_COMMENTS_TTL_MS;
        for (const id of ids) {
            const issue = issues.get(id);
            const isNativeSource = !!issue && issue.workloadSource === 'native';
            // A legacy row the snapshot bound to a native deliverable reads
            // the same way a native row does -- the endpoint verifies the
            // binding on every live read regardless of which source the
            // board classified the row under, and `_wlNativeTweakComments`
            // takes a bare deliverable id, not a source flag. Only rows with
            // no such binding (never mirrored to a native deliverable, or a
            // foreign/provider-authority row) still fall to the legacy lane --
            // and so does a bound row once the snapshot behind the binding is
            // no longer fresh enough to vouch for it (`bindingFresh` above).
            const boundLegacyId = !!issue && issue.workloadSource === 'legacy' && bindingFresh
                && typeof issue.legacyBoundNativeId === 'string' ? issue.legacyBoundNativeId : '';
            const nativeId = isNativeSource && typeof issue.nativeId === 'string' ? issue.nativeId : boundLegacyId;
            if (!owner || !issue || (!isNativeSource && !boundLegacyId) || !nativeId) { legacy.push(id); continue; }
            native.push({ id, issue, nativeId, hit: cached(nativeId, issue) });
        }
        // Cached rows first. They cost no request and no wait, so there is no
        // reason for one to queue behind a neighbour that is going to hang.
        native.sort((a, b) => (a.hit ? 0 : 1) - (b.hit ? 0 : 1));
        let cursor = 0;
        const drain = async () => {
            while (cursor < native.length) {
                // Asked BEFORE the row is started, not after it has answered:
                // once the popover is closed or reopened elsewhere, the rows
                // still queued are the ones worth not spending budget on.
                if (stale()) break;
                const row = native[cursor++];
                if (row.hit) { settle(row.id, row.hit); continue; }
                // Past the deadline nothing new is started: a read begun here
                // could only report after the bound this exists to hold.
                if (Date.now() >= deadline) { settle(row.id, unavailable()); continue; }
                const key = owner + '\u0000' + row.nativeId;
                let flight = _wlNativeTweakCommentsInFlight.get(key);
                // A shared read belongs to the snapshot row it was STARTED for,
                // exactly as a cached one does. A refresh mid-flight gives this
                // popover a new row object, and the in-flight read is still
                // holding the old one — it will reject at its own
                // snapshot-identity check, so joining it would hand the newly
                // opened popover an unavailable row instead of a real read of
                // the refreshed binding. Start a fresh flight instead; the old
                // one's cleanup only removes the entry if it is still its own.
                if (flight && flight.issue !== row.issue) flight = null;
                if (!flight) {
                    flight = { promise: null, wanted: new Set(), issue: row.issue };
                    _wlNativeTweakCommentsInFlight.set(key, flight);
                    flight.wanted.add(stale);
                    // The shared read inherits the FIRST waiter's deadline, so a
                    // later generation can see it cut early. That costs one
                    // re-read on the next open, where racing it costs a request
                    // every time.
                    flight.promise = _wlNativeTweakComments(row.issue, row.nativeId, owner, deadline,
                        () => flight.wanted.size === 0 || [...flight.wanted].every(want => want()));
                    // ONLY A COMPLETE ANSWER IS WORTH REMEMBERING. The endpoint
                    // answers 200 with `sourceComplete: false` for a projection
                    // it could not read whole — `source_unavailable`,
                    // `link_changed`, `source_limit`. Storing that would hold the
                    // degraded view for the rest of the TTL even after the source
                    // recovered or its link was repaired, keeping card-only notes
                    // invisible: caching an outage extends it, and an absence is
                    // the failure an editor cannot report (AGENTS.md).
                    flight.promise.then(rows => {
                        if (rows && rows.sourceComplete === true) remember(row.nativeId, row.issue, rows);
                    }, () => {}).then(() => {
                        if (_wlNativeTweakCommentsInFlight.get(key) === flight) _wlNativeTweakCommentsInFlight.delete(key);
                    });
                } else {
                    flight.wanted.add(stale);
                }
                try { settle(row.id, await flight.promise); }
                catch (e) { settle(row.id, unavailable()); }
                finally { flight.wanted.delete(stale); }
            }
        };
        const lanes = [];
        for (let i = 0; i < Math.min(WL_TWEAK_FEEDBACK_POOL, native.length); i++) lanes.push(drain());
        // Rows with no native binding have no readable feedback source since
        // the Linear lane was retired (B2). They get an answer of their own --
        // `retired`, distinct from a failed read -- so the popover says where
        // to look instead of offering a retry that can never succeed.
        for (const id of legacy) { const rows = []; rows.retired = true; settle(id, rows); }
        await Promise.all(lanes);
        // Every id asked for leaves with an answer of its own, because a row
        // missing from this map renders as an empty box — the same pixels as
        // "no feedback" and a different fact.
        for (const id of ids) { if (!out[id]) out[id] = unavailable(); }
        if (scopeChanged || (owner && owner !== wlSnapshotIdentity())) throw new Error('Feedback scope changed.');
        return out;
    }
    // One deliverable's complete feedback: every canonical comment, plus the
    // notes still living in the Calendar/Samples card cell (`include_feedback`).
    // Linear used to be the union point for those two; after the exit this read
    // is. Pages at the page-wide comment page size so exactly one
    // production-comments request shape leaves this page.
    async function _wlNativeTweakComments(issue, nativeId, owner, deadline, shouldStop) {
        const rows = [], seen = new Set();
        let before = null, complete = false, feedback = null;
        const controller = new AbortController();
        // This row's own timeout, clipped to whatever the collection has left.
        // A read that started late must not be able to report AFTER the
        // deadline the popover as a whole is held to, or the bound leaks by
        // one row's timeout.
        const budget = Number.isFinite(deadline)
            ? Math.max(0, Math.min(WL_PLAN_READ_TIMEOUT_MS, deadline - Date.now()))
            : WL_PLAN_READ_TIMEOUT_MS;
        const timer = setTimeout(() => controller.abort(), budget);
        try {
            for (let page = 0; page < 50; page++) {
                // A paging read spends one budget request per page, so an
                // abandoned popover stops costing between pages too. The partial
                // rows collected so far are dropped rather than presented:
                // `complete` stays false and the check below refuses them.
                if (typeof shouldStop === 'function' && shouldStop()) throw new Error('Feedback read was abandoned.');
                const url = CAL_SUPABASE_URL + '/functions/v1/production-comments';
                const response = await fetch(url, {
                    method: 'POST', cache: 'no-store', signal: controller.signal,
                    headers: _syncviewEfHeaders({ 'Content-Type': 'application/json' }, url),
                    body: JSON.stringify({ deliverable_id: nativeId, include_feedback: true, limit: WL_TWEAK_FEEDBACK_PAGE_SIZE, before })
                });
                const value = await response.json();
                // `total` is NULLABLE. The endpoint's exact count scans every
                // comment row on the deliverable while the page is bounded, so
                // the count is the half that can hit a statement timeout, and it
                // now fails open: a count that errored or rejected reports null
                // beside a page that was read perfectly well. Refusing a null
                // here would hand this popover the same "Couldn't load this
                // deliverable's feedback" the fail-open exists to prevent, so
                // this reader would be the one consumer the repair did not
                // reach. A null is accepted; anything OTHER than null or a safe
                // non-negative integer is still a malformed response and still
                // refuses, `undefined` included -- an older reader that has lost
                // the field entirely is not the same thing as one that could not
                // count.
                const counted = value.total === null ? null : value.total;
                if (!response.ok || !value || value.ok !== true || value.canonical_thread !== true
                    || value.audience_scope !== 'all' || !Array.isArray(value.comments)
                    || (counted !== null && (!Number.isSafeInteger(counted) || counted < 0))
                    || typeof value.has_more !== 'boolean') {
                    throw new Error('Feedback is incomplete.');
                }
                // Intermediate counts are deliberately NOT retained or compared.
                // Requiring every counted page to report the same number sounds
                // like a stability check and is really a false-refusal
                // generator: the counts are taken at different moments, so
                // deleting an older row that page 1 counted but had not yet
                // served makes the terminal count legitimately smaller, while
                // the rows collected are still the whole current thread.
                // Comparing them rejected exactly that read.
                //
                // It also protected nothing. Everything cross-page agreement
                // could catch, the terminal count catches on its own: a head
                // insertion leaves the terminal count above `rows.length`, and a
                // deletion of an already-collected row leaves it below. The one
                // case neither catches is a compensating insert-and-delete
                // between the same two pages, which keeps both counts equal too.
                // So the comparison cost real reads and bought nothing.
                feedback = value.feedback || null;
                for (const row of value.comments) {
                    if (!row || !row.id || seen.has(row.id) || typeof row.body !== 'string') {
                        throw new Error('Feedback identities are incomplete.');
                    }
                    seen.add(row.id); rows.push(row);
                }
                if (!value.has_more) {
                    // Completeness rests on THIS page's count, the terminal one,
                    // and on nothing earlier.
                    //
                    // The endpoint applies the cursor to the page query ONLY;
                    // `totalQuery` is filtered by `deliverable_id` (plus audience
                    // for a client) and never by `before`, so every count it
                    // returns is a whole-thread count at the moment that page was
                    // served, and the endpoint reads the page BEFORE its count
                    // (they are separate transactions, so run concurrently the
                    // count could predate the page it certifies). A count on the
                    // terminal page is therefore taken after every request this
                    // walk made, and `rows.length === counted` tests the walk
                    // against the thread as it stands at the end of it.
                    //
                    // A strong consistency test, not a transaction: the rows
                    // come from several requests at several moments, so one
                    // served early and deleted later still leaves a legitimate
                    // mismatch, and this refuses it. Erring toward the visible,
                    // reportable failure is the intended direction. That is what catches the one hazard here: rows are
                    // ordered newest-first and the cursor filters strictly OLDER,
                    // so a comment posted after page 1 is invisible to every
                    // later page -- but it IS in the terminal count, which then
                    // exceeds `rows.length` and refuses. Counts on the preceding
                    // pages are not needed for that, and requiring them would
                    // hide a thread that was read whole.
                    //
                    // An earlier count cannot stand in: it predates the pages
                    // after it, so a head insertion following it leaves both the
                    // row total and that stale count at the same number and the
                    // subtraction still balances. Hence a terminal page whose
                    // count failed open proves nothing about a walk that PAGED,
                    // and only a single-page walk is accepted without a count --
                    // one query, `has_more === false`, no cursor window for
                    // anything to hide in. That is also the common case, since it
                    // covers every deliverable at or under the page size, and a
                    // paged walk with no terminal count refuses exactly as it did
                    // before the count began failing open. Refusing is the
                    // legible failure: "Couldn't load this deliverable's
                    // feedback" is something an editor can see and report, where
                    // the alternative silently omits a note just posted.
                    complete = counted !== null ? rows.length === counted : page === 0;
                    break;
                }
                if (!value.next_cursor || !value.next_cursor.id || !value.next_cursor.created_at
                    || JSON.stringify(value.next_cursor) === JSON.stringify(before)) {
                    throw new Error('Feedback pagination is incomplete.');
                }
                before = value.next_cursor;
            }
            if (!complete || owner !== wlSnapshotIdentity() || !(wlState.issueSnapshot || []).some(row => row === issue)) {
                throw new Error('Feedback scope changed or is incomplete.');
            }
        } finally { clearTimeout(timer); }
        // Card-cell notes that never became canonical comments are the whole
        // reason this reads `include_feedback`: a tweak that took the legacy
        // write lane exists ONLY in the card cell, and Linear was the only
        // place staff could previously see it next to the canonical thread.
        // A source row the endpoint marked covered is the SAME note as a
        // canonical row already in `rows`. Concatenating every source row
        // unconditionally shows imported feedback twice, and on a thread with
        // two canonical comments those duplicates fill this popover's three-row
        // preview and push the genuinely source-only tweak — the one row an
        // editor needs — behind the collapsed older count. Same coverage and
        // version check `_prodFeedbackHTML` applies on the SyncLinear panel:
        // coverage is only believed once THIS browser holds the canonical row
        // at the proven version and update clock.
        const canonicalById = new Map(rows.map(row => [String(row.id), row]));
        const source = (feedback && Array.isArray(feedback.rows) ? feedback.rows : []).filter(row => {
            const canonical = row.covered_by && canonicalById.get(String(row.covered_by));
            return !canonical || !Number.isInteger(row.covered_version) || !row.covered_updated_at
                || Number(canonical.version) !== row.covered_version
                || String(canonical.row_updated_at || canonical.updated_at || '') !== String(row.covered_updated_at);
        });
        // NEWEST FIRST ACROSS BOTH SOURCES. `wlRenderTweakComments` shows three
        // rows and collapses the rest as "older comments", so the order here
        // decides what an editor actually reads. Concatenating canonical then
        // source put every card note behind every canonical one regardless of
        // when it was written: a tweak a client submitted minutes ago sat behind
        // three older canonical rows and was described as older than them. That
        // is the same failure the covered-rows fix addressed from the other
        // direction, and this popover exists to surface exactly that note.
        // Ties keep canonical before source, which is the previous order; an
        // undated row sorts last rather than jumping the queue on a NaN.
        const at = row => {
            const value = Date.parse(row.createdAt || '');
            return Number.isFinite(value) ? value : -Infinity;
        };
        const shown = [...rows, ...source]
            .filter(row => !row.deleted_at && !row.resolved_at && !row.deleted && !row.done)
            .map(row => ({
                author: row.author_name, body: row.body,
                createdAt: row.source_created_at || row.created_at,
                fromCard: row.source_only === true
            }))
            .sort((a, b) => at(b) - at(a));
        shown.native = true;
        // `complete` above proves the CANONICAL thread was read whole. The card
        // projection carries its own completeness and must not borrow it —
        // INCLUDING when it is absent entirely. A reader without `feedback.mjs`
        // omits the key, and this lane's merge-then-deploy order (the deploy
        // lane only accepts a `commit_sha` already on `main`) GUARANTEES a
        // window where this browser is live and that reader is not. Reading a
        // missing projection as complete presents the canonical comments as the
        // whole record and silently drops every card-only note.
        shown.sourceComplete = !!feedback && feedback.complete === true;
        // The card binding this answer was verified against. Carried so a stored
        // response can always say which link it was true for, rather than being
        // a set of notes with no stated provenance.
        shown.scope = (feedback && feedback.scope) || null;
        return shown;
    }
    function wlRenderTweakComments(comments) {
        // A row whose read FAILED is not a row with nothing to show. Both used
        // to arrive here as the same empty box, and "this deliverable has no
        // feedback" and "we could not ask" are identical pixels carrying
        // opposite facts — the second one an editor acts on by shipping the
        // cut unchanged. A row with no entry at all counts as a failure too:
        // silence is never evidence that a client said nothing.
        if (comments && comments.retired) {
            return '<div class="wl-tweak-comments-status is-unavailable" role="status">'
                + 'Feedback for this item isn&rsquo;t shown here. Use the calendar button on this row to open the post in the content calendar and check its review notes.</div>';
        }
        if (!comments || comments.failed) {
            return '<div class="wl-tweak-comments-status is-unavailable" role="status">'
                + 'Couldn&rsquo;t load this deliverable&rsquo;s feedback. Retry, or open the post in SyncView.</div>';
        }
        const native = !!(comments && comments.native);
        // One incomplete notice, used by both the populated and the empty
        // branch. An unread card projection is exactly the case where "no
        // feedback" would be a claim this browser cannot make.
        const incomplete = native && comments.sourceComplete === false
            ? '<div class="wl-tweak-comments-status">Some notes on the original card could not be read, so this list may be incomplete.</div>'
            : '';
        // A native read that found nothing says so, because after the Linear
        // exit this popover is the only reader and silence would be
        // indistinguishable from a broken one. A legacy read keeps rendering
        // nothing, which is this function's existing behaviour.
        if (!comments || !comments.length) {
            return native
                ? incomplete || '<div class="wl-tweak-comments-status">No feedback is available here. Open the post in SyncView to check its review notes.</div>'
                : '';
        }
        const shown = comments.slice(0, 3);
        const more = comments.length - shown.length;
        // One row per comment: author · body · time. No Frame/Linear link and
        // no card chrome — the body is the signal, everything else is muted.
        return shown.map(c => `<div class="wl-tweak-comment">
            <span class="wl-tweak-comment-author">${wlEscape(c.author || 'Unknown')}</span>${c.fromCard ? '<span class="wl-tweak-comment-time">from the card</span>' : ''}
            <span class="wl-tweak-comment-body" onclick="wlToggleTweakComment(this)" onkeydown="wlOnTweakCommentKey(event,this)">${wlEscape(c.body || '')}</span>
            <span class="wl-tweak-comment-time">${wlEscape(_calFmtCommentTime(c.createdAt))}</span>
        </div>`).join('') + (more > 0
            ? `<div class="wl-tweak-comment-more">+ ${more} older comment${more === 1 ? '' : 's'}</div>`
            : '') + incomplete;
    }
    // Expand/collapse is only offered on comments whose body genuinely
    // overflows its single row — a short comment that already fits has
    // nothing to expand, so it gets no pointer cursor. Must
    // run AFTER the comments are in the DOM, since it measures rendered width.
    function wlMarkClampedComments(scope) {
        scope.querySelectorAll('.wl-tweak-comment-body').forEach(el => {
            if (el.classList.contains('expanded') || el.classList.contains('is-clamped')) return;
            if (el.scrollWidth > el.clientWidth + 1) {
                el.classList.add('is-clamped');
                el.setAttribute('role', 'button');
                el.setAttribute('tabindex', '0');
                el.setAttribute('aria-expanded', 'false');
            }
        });
    }
    window.wlToggleTweakComment = function(el) {
        if (!el.classList.contains('is-clamped')) return;
        const open = el.classList.toggle('expanded');
        el.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    window.wlOnTweakCommentKey = function(e, el) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        wlToggleTweakComment(el);
    };

    function wlOpenRollupPopover(rollupEl) {
        const pop = document.getElementById('wlPopover');
        if (!pop) return;
        const parentId   = rollupEl.getAttribute('data-wl-parent-id') || '';
        const assigneeId = rollupEl.getAttribute('data-wl-assignee-id') || '';
        const clientName = rollupEl.getAttribute('data-wl-client') || '';
        const editorName = rollupEl.getAttribute('data-wl-editor-name') || '';
        const issueId     = rollupEl.getAttribute('data-wl-issue-id') || '';
        const deadlineIds = new Set((rollupEl.getAttribute('data-wl-deadline-open') || '').split('|').filter(Boolean));
        const inProgress = rollupEl.getAttribute('data-wl-in-progress') === '1';
        const dayISO     = rollupEl.getAttribute('data-wl-date') || '';

        // Pick the source list based on which rollup was clicked:
        //   - data-wl-source="active": planned + in-progress, deduped. Used
        //     by the "Editor workload (freest first)" chips, which want a
        //     view of every active sub-issue for that editor, regardless of
        //     status or day.
        //   - in-progress (strip): nowWorking covers every active "now" item
        //   - calendar cell: that day's exact work-day bucket
        //   - editor card total badge with no clientName: same source, but
        //     skip the client filter so the popover lists every sub-issue
        //     that editor owns for the day across all clients.
        const sourceMode = rollupEl.getAttribute('data-wl-source') || '';
        let source;
        if (issueId || deadlineIds.size) {
            source = wlState.allActiveSubs || [];
        } else if (sourceMode === 'active') {
            const seenIds = new Set();
            source = [];
            for (const s of [...(wlState.planned || []), ...(wlState.nowWorking || []), ...(wlState.tweaksNeeded || []), ...(wlState.overdue || []), ...(wlState.undated || [])]) {
                if (seenIds.has(s.id)) continue;
                seenIds.add(s.id);
                source.push(s);
            }
        } else if (sourceMode === 'overdue') {
            source = wlState.overdue;
        } else if (sourceMode === 'tweaks') {
            source = wlState.tweaksNeeded;
        } else if (sourceMode === 'inprogress' || inProgress) {
            source = wlState.nowWorking;
        } else if (dayISO) {
            source = wlState.calendarByDate.get(dayISO) || [];
        } else {
            source = wlState.planned;
        }
        const subs = source.filter(s =>
            (s.assigneeId || '') === assigneeId &&
            (clientName === '' || (s.clientName || '') === clientName) &&
            (!issueId || String(s.id || '') === issueId) &&
            (!deadlineIds.size || deadlineIds.has(String(s.id || '')))
        );

        subs.sort((a, b) => {
            const da = wlDisplayDate(a) || '9999-12-31';
            const db = wlDisplayDate(b) || '9999-12-31';
            if (da !== db) return da < db ? -1 : 1;
            const ca = a.clientName || '';
            const cb = b.clientName || '';
            if (ca !== cb) return ca.localeCompare(cb);
            return (a.identifier || '').localeCompare(b.identifier || '');
        });

        if (wlState.popoverAnchor && wlState.popoverAnchor !== rollupEl
            && typeof wlState.popoverAnchor.setAttribute === 'function') {
            wlState.popoverAnchor.setAttribute('aria-expanded', 'false');
        }
        wlState.popoverAnchor = rollupEl;
        rollupEl.setAttribute('aria-expanded', 'true');

        /* A PARENT BUTTON MAY NEVER RESOLVE TO A CHILD.

           Both link-outs below used to end `|| subs[0]?.url` / `||
           subs[0]?.identifier`. That fallback reads as harmless -- "open
           something rather than nothing" -- and is the one thing these two
           controls must not do: they are labelled and positioned as the
           PARENT, so substituting the first sub-issue does not degrade the
           button, it makes it lie. Owner report 2026-09-07, pressing
           "Open SyncView ->" on the In progress chip for one client and
           landing on the sub-issue `VID-13679` instead of its parent
           `VID-13678`, with nothing on the page saying a substitution had
           happened.

           `parentById` only holds parents that came back in THIS snapshot,
           and the board has several ways to hold fewer: the Linear-derived
           read pages `active = true` only, so a parent whose own row went
           inactive is absent while its children are still live, and the
           n8n `linear-issues` fallback (taken whenever the Supabase read
           throws) answers a different row set again. The sub itself carries
           `parentIdentifier` from `workload_issues` for exactly this case --
           which is all the SyncLinear deep link needs -- so that is the
           fallback, the same one `wlLooseParentInfo` already uses for the
           loose strips. It was added there on 2026-09-07 and never carried
           back here.

           When neither source can name the parent, the button is NOT
           rendered. An absent control is honest; one pointing at a child
           is not. The per-row links below still open each sub-issue, so
           nothing becomes unreachable -- only unlabelled-as-parent. */
        const parentRow   = parentId ? wlState.parentById.get(parentId) : null;
        const parentUrl   = clientName ? (parentRow?.url || '') : '';
        /* SyncView-first link-outs (owner request 2026-08-21: "it opens the
           original linear... make it so it opens our sync linear"). Post-flip
           the designers' work lives in the Production tab, so the popover's
           primary destinations point at ?prod=1 by Linear identifier -- the
           deep link the Production tab already resolves via displayId, falling
           back to its list view for anything it cannot find. Linear itself
           stays one small click away on every row: written when video was
           still Linear-authoritative, so "hiding the source of truth" no
           longer describes video precisely after the 2026-08-28 flip -- but
           the conclusion holds anyway. Linear stays the live rollback path
           for roughly two weeks past the flip, and the link is a reference
           either way, so the extra icon is still worth less than removing a
           working escape hatch. */
        const parentIdent = clientName
            ? (parentRow?.identifier || String(subs[0]?.parentIdentifier || ''))
            : '';
        /* A PILL IS VIDEOS, SO THE PRIMARY ACTION OPENS A VIDEO.

           Owner, 2026-09-07, after being sent to the parent and having to
           drill down himself to read the status he came for: "when you open
           a pill, you're opening a video, so you're supposed to go to that
           sub-issue, which has the status In progress."

           He is describing what the chip MEANS. A client chip reading "1"
           in the In progress column is not a statement about the client or
           the parent, it is one video that is in progress, and the status the
           chip just asserted lives on that sub-issue. The parent cannot
           carry it: for a native card the parent is a SYNTHETIC batch node
           whose status is hardcoded `todo` and never updated
           (_prodResolveBatchParentNodes), so sending the reader there
           answered his question with the one value guaranteed to be wrong.

           So when the group is ONE sub-issue there is no ambiguity about
           which video is meant, and the primary button opens it. With more
           than one, no single row is "the video" -- picking one would be a
           guess -- so the button stays on the parent and says so, and the
           rows below remain the way to each individual video. */
        const soleSub = subs.length === 1 ? subs[0] : null;
        /* Route by the NATIVE id first, exactly as the rows below and the loose
           strips do. A deliverable created after the outbound flip carries no
           `linear_identifier` at all, so keying the primary action on
           `identifier` alone sends the most prominent button on a one-video
           popover to the SYNTHETIC batch parent -- whose status is hardcoded
           `todo` and is the one value guaranteed to contradict the pill the
           reader just clicked -- or renders no button at all when the parent
           has no identifier either. `?prod=1&d=` resolves a `del_…` id because
           _prodIssue() matches on `id` OR `displayId`. */
        const soleSubIdent = String(soleSub?.nativeId || soleSub?.identifier || '');
        /* A NATIVE PARENT IS A BATCH, NOT AN ISSUE, so its deep link is
           `?prod=1&batch=<batch id>` -- exactly what the loose strips already
           build via wlLooseParentInfo().nativeBatchId. Owner report
           2026-09-20, cutoff day, pressing "Open parent ->" on a two-video
           pill: the native view answers `identifier` = the batch NAME for a
           batch row (workload_issues_native_v1, parent arm), so `?d=<name>`
           can resolve nothing and Production published "<batch name> has no
           row in Production". Same class as OPEN_REPAIRS 218/221: one more
           site assuming every parent carries a Linear identifier. */
        /* Judged by the subs that BELONG to the clicked parent, not by any row
           in the popover: `subs` is filtered by assignee and client only, so a
           legacy-parent chip can share the list with a native row of another
           post during a mixed-authority state, and "any native row" would
           send that legacy parent to `?batch=<legacy uuid>`, which resolves
           nothing (Codex P2 on PR 1454). */
        const nativeBatchId = parentId && subs.some(s => s && s.workloadSource === 'native'
                && String(s.parentId || '') === String(parentId))
            ? String(parentId) : '';
        const openIdent = soleSubIdent || parentIdent;
        const openIsParent = !soleSubIdent && !!(parentIdent || nativeBatchId);
        const parentSyncUrl = openIsParent && nativeBatchId
            ? svRoute.clean('/?prod=1&batch=' + encodeURIComponent(nativeBatchId))
            : openIdent
                ? svRoute.clean('/?prod=1&d=' + encodeURIComponent(openIdent))
                : '';
        const openLabel = openIsParent ? 'Open parent →' : 'Open SyncView →';
        // The Linear escape hatch follows the primary target rather than
        // silently pointing somewhere else than the button beside it.
        const openLinearUrl = soleSub ? String(soleSub.url || '') : parentUrl;
        const parentTitle = parentRow?.title || clientName || editorName || '';
        const headerTitle = clientName || editorName || parentTitle;
        pop.setAttribute('aria-label', headerTitle ? ('Workload details for ' + headerTitle) : 'Workload details');

        const templatesUrl = clientName
            ? svRoute.clean('/' + svRoute.search() + '#templates/' + encodeURIComponent(clientName))
            : '';
        const templatesLink = templatesUrl
            ? `<a class="workload-popover-templates" href="${wlEscape(templatesUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${wlEscape(clientName)} templates in a new tab">
                <span>Templates</span>
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M6.5 2.5h3v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M9.5 2.5L5 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                    <path d="M9.5 6.5v3h-7v-7h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </a>`
            : '';

        const header = `<div class="workload-popover-head">
            <div class="workload-popover-head-title-group">
                <span class="workload-popover-head-title">${wlEscape(headerTitle)}</span>
                ${templatesLink}
            </div>
            ${parentSyncUrl ? `<a class="workload-popover-parent" href="${wlEscape(parentSyncUrl)}" target="_blank" rel="noopener noreferrer">${wlEscape(openLabel)}</a>` : ''}
            ${openLinearUrl ? `<a class="workload-popover-parent workload-popover-parent-linear" href="${wlEscape(openLinearUrl)}" target="_blank" rel="noopener noreferrer">Linear ↗</a>` : ''}
            <button type="button" class="workload-popover-close" data-wl-popover-close="1" aria-label="Close"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7"/></svg></button>
        </div>`;
        // When the popover spans multiple clients (editor-total badge), label
        // each row with the client too so it's obvious whose work it is.
        const showClient = !clientName;
        const items = subs.map(s => {
            const explicitPlan = wlPlanDate(s) || null;
            const workDate = wlDisplayDate(s) || '';
            const placementMode = wlPlacementMode(s);
            const savingPlan = _wlPlanWriteInFlight.has(String(s.id || ''));
            const savingDue = _wlDueWriteInFlight.has(String(s.id || ''));
            const canEditPlan = !wlIsTweaksNeeded(s) && wlPlanEditingEnabled() && !savingPlan;
            const canEditDue = !wlIsTweaksNeeded(s) && wlLinearEditingEnabled(s) && !savingDue;
            const dateId = 'wlDueDate_' + String(s.id || '').replace(/[^A-Za-z0-9_-]/g, '_');
            const planControl = wlIsTweaksNeeded(s) ? '' : `<div class="workload-popover-plan" data-wl-due-issue="${wlEscape(s.id || '')}">
                <div class="workload-popover-plan-line">
                    <span class="workload-popover-plan-label">Due date</span>
                    ${_svDateHtml(dateId, s.dueDate || '', { placeholder: 'Choose due date', disabled: !canEditDue, todayPolicy: 'workload' })}
                    ${savingDue ? '<span class="workload-popover-plan-saving" role="status">Saving…</span>' : ''}
                    ${explicitPlan ? `<button type="button" class="workload-plan-clear" data-wl-plan-clear="${wlEscape(s.id || '')}"${canEditPlan ? '' : ' disabled'}>${wlPlanOriginHtml(placementMode, false)} Use automatic plan</button>` : ''}
                </div>
            </div>`;
            const clientTag = showClient && s.clientName
                ? `<span class="workload-popover-item-client">${wlEscape(s.clientName)}</span>`
                : '';
            const calBtn = s.clientName
                ? `<button type="button" class="workload-popover-item-cal" aria-label="Open in the content calendar" onclick="wlOpenInContentCalendar(${_jsAttrArg(s.clientName)},${_jsAttrArg(s.identifier || '')},${_jsAttrArg(s.nativeId || '')})"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"/></svg></button>`
                : '';
            // A sub-issue sitting in "Tweak Needed" gets a comment preview
            // box under its row — filled asynchronously below from Linear.
            const tweakBox = wlIsTweaksNeeded(s)
                ? `<div class="wl-tweak-comments" data-wl-comments-for="${wlEscape(s.id)}"><div class="wl-tweak-comments-status" role="status" aria-label="Loading">${_svSkel('sv-skeleton-line', 'width:72%;height:10px;')}</div></div>`
                : '';
            // Route by the NATIVE id first, exactly as the loose strips do. A
            // deliverable created after the outbound flip carries neither
            // `identifier` nor `url`, so keying on the identifier renders
            // href="" and the click reloads the Workload page instead of
            // opening the deliverable. `?prod=1&d=` resolves a `del_…` id
            // because _prodIssue() matches on `id` OR `displayId`.
            const rowSyncUrl = wlSyncLinearUrl(s.nativeId || s.identifier) || s.url || '';
            const linearBtn = s.url
                ? `<a class="workload-popover-item-cal workload-popover-item-linear" href="${wlEscape(s.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open in Linear" data-tip="Open in Linear"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6.2 9.8 9.8 6.2M7 4.6h4.4V9"/><rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.6"/></svg></a>`
                : '';
            return `<div class="workload-popover-item">
                <a class="workload-popover-item-main" href="${wlEscape(rowSyncUrl)}" target="_blank" rel="noopener noreferrer">
                    <span class="workload-popover-item-title">${wlEscape(s.title || s.identifier)}</span>
                    ${wlWorkloadBadgeHtml(s, false)}
                    ${clientTag}
                    ${wlDeadlineTagHtml(s.dueDate, workDate)}
                </a>
                ${calBtn}
                ${linearBtn}
            </div>${planControl}${tweakBox}`;
        }).join('') || '<div class="workload-popover-item" style="color:var(--text-muted);cursor:default;">No upcoming sub-issues.</div>';

        // Frame.io disclaimer + comment fetch — only when the popover holds
        // at least one tweaks-needed sub-issue. Comments come from the
        // native production-comments read (see wlFetchTweakComments);
        // the token guard stops a slow response from painting into a
        // popover that has since been reopened on another rollup.
        const tweakSubs = subs.filter(wlIsTweaksNeeded);
        // The Frame.io reminder belongs on the per-client / tweak views where
        // the editor is reading tweak notes. The editor-workload chips
        // (source="active") are a capacity view — "how busy is this editor" —
        // so the note is just noise there and is skipped.
        const frameNote = (tweakSubs.length && sourceMode !== 'active')
            ? `<div class="wl-tweak-frame-note">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8L15 14H1L8 1.8z"/><path d="M8 6.5v3.5"/><circle cx="8" cy="12" r="0.4" fill="currentColor"/></svg>
                <span><strong>Always check Frame.io too.</strong></span>
                <span class="wl-tweak-frame-info" role="img" aria-label="Tweaks left as Frame.io comments can't be shown here — sub-issues aren't linked to Frame. The comments below are the ones sent through SyncView (clients can't comment on Frame.io).">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6.4"/><path d="M8 7.2v4"/><circle cx="8" cy="4.8" r="0.5" fill="currentColor"/></svg>
                </span>
            </div>`
            : '';

        pop.innerHTML = header + frameNote + items;
        // EVERY replacement advances the feedback generation, not only one that
        // starts a read of its own. The line above just destroyed the previous
        // popover's feedback boxes; a rollup with no tweak rows destroys them
        // just as thoroughly, and leaving the generation alone there let the
        // previous read keep paging and draining against content that no longer
        // holds a single feedback box.
        const token = ++_wlTweakCommentsToken;

        if (tweakSubs.length) {
            const live = () => token === _wlTweakCommentsToken && pop.classList.contains('open');
            // Whether the ANSWER is still wanted. This is deliberately NOT read
            // off the DOM: `pop` gets its `open` class a few lines below this
            // block, so every sample taken before then sees a popover that is
            // not open YET, and a popover closed before its first page returned
            // was never sampled while open at all — the drain then ran to
            // completion for a popover nobody was looking at, which is exactly
            // when the budget protection had to work. The generation counter is
            // recorded rather than inferred: it advances on every open above and
            // on every close in wlClosePopover.
            const abandoned = () => token !== _wlTweakCommentsToken;
            // PAINT EACH ROW AS IT SETTLES. Every deliverable in this popover is
            // its own independent read, so a row that answered has no reason to
            // sit on a skeleton until its slowest neighbour has finished timing
            // out. The pool and deadline in wlFetchTweakComments bound how long
            // that slowest neighbour can take; this is what stops it costing the
            // fast rows anything at all.
            const painted = new Set();
            const paintRow = (id, rows) => {
                if (!live()) return;
                const sel = (window.CSS && CSS.escape) ? CSS.escape(id) : String(id).replace(/"/g, '');
                const box = pop.querySelector('[data-wl-comments-for="' + sel + '"]');
                if (!box) return;
                box.innerHTML = wlRenderTweakComments(rows);
                painted.add(id);
                // Clamp detection measures rendered width, so it runs on this
                // row's box now rather than on a whole popover that is still
                // filling in.
                wlMarkClampedComments(box);
            };
            wlFetchTweakComments(tweakSubs.map(s => s.id), paintRow, abandoned).then(byId => {
                if (!live()) return;
                // Backstop for rows the progressive call could not place — a box
                // that had not been laid out yet. A row already painted is left
                // ALONE rather than repainted with identical markup: the reads
                // now take seconds during which an editor can expand a comment,
                // and rewriting innerHTML under them would collapse it.
                for (const s of tweakSubs) { if (!painted.has(s.id)) paintRow(s.id, byId[s.id]); }
                wlMarkClampedComments(pop);
            }).catch(() => {
                if (token !== _wlTweakCommentsToken || !pop.classList.contains('open')) return;
                pop.querySelectorAll('.wl-tweak-comments').forEach(box => {
                    box.innerHTML = '<div class="wl-tweak-comments-status">Couldn&rsquo;t load feedback. Retry, or open the post in SyncView.</div>';
                });
            });
        }

        // Position: anchored below the clicked rollup, clamped to viewport.
        const rect = rollupEl.getBoundingClientRect();
        pop.classList.add('open');
        pop.setAttribute('aria-hidden', 'false');
        const popW = Math.min(pop.offsetWidth || 320, 380);
        let left = window.scrollX + rect.left;
        const maxLeft = window.scrollX + window.innerWidth - popW - 10;
        if (left > maxLeft) left = maxLeft;
        if (left < window.scrollX + 10) left = window.scrollX + 10;
        const popH = Math.min(pop.offsetHeight || 320, Math.max(160, window.innerHeight - 20));
        const below = window.scrollY + rect.bottom + 6;
        const above = window.scrollY + rect.top - popH - 6;
        const maxTop = window.scrollY + window.innerHeight - popH - 10;
        let top = below;
        if (below + popH > window.scrollY + window.innerHeight - 10 && above >= window.scrollY + 10) top = above;
        if (top > maxTop) top = maxTop;
        if (top < window.scrollY + 10) top = window.scrollY + 10;
        pop.style.left = left + 'px';
        pop.style.top  = top + 'px';
        const focusTarget = pop.querySelector('[data-wl-popover-close]');
        if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();

        // Spotlight: dim everything on the calendar that isn't part of this
        // exact work-day rollup.
        wlApplySpotlight(subs);
    }

    function wlApplySpotlight(subs) {
        wlClearSpotlight();
        if (!subs || !subs.length) return;
        const wrap = document.querySelector('#wlBody .workload-grid-wrap');
        const grid = wrap ? wrap.querySelector('.workload-grid, .workload-timeline-stage') : null;
        if (!wrap || !grid) return;

        // Only work in the calendar bucket participates. Tweaks remain
        // strip-only even when they retain a saved plan override.
        const plannedIds = new Set((wlState.planned || []).map(s => s.id));
        const subsOnCalendar = subs.filter(s => wlDisplayDate(s) && plannedIds.has(s.id));
        if (!subsOnCalendar.length) return;

        // Match keys: per-client chips use assignee|client|date; editor-total
        // badges aggregate across clients so they use assignee|*|date.
        const chipKeys = new Set();
        const totalKeys = new Set();
        const issueIds = new Set();
        for (const s of subsOnCalendar) {
            const p = wlDisplayDate(s);
            chipKeys.add(`${s.assigneeId || ''}|${s.clientName || ''}|${p}`);
            totalKeys.add(`${s.assigneeId || ''}|${p}`);
            issueIds.add(String(s.id || ''));
        }

        wrap.setAttribute('data-wl-spotlight', '1');

        grid.querySelectorAll('.workload-day-card-chip, .workload-timeline-plan-chip').forEach(chip => {
            const aid = chip.getAttribute('data-wl-assignee-id') || '';
            const cn  = chip.getAttribute('data-wl-client') || '';
            const dt  = chip.getAttribute('data-wl-date') || '';
            if (chipKeys.has(`${aid}|${cn}|${dt}`)) chip.setAttribute('data-wl-match', '1');
        });
        grid.querySelectorAll('.workload-day-card-total, .workload-timeline-day-total').forEach(tot => {
            const aid = tot.getAttribute('data-wl-assignee-id') || '';
            const dt  = tot.getAttribute('data-wl-date') || '';
            if (totalKeys.has(`${aid}|${dt}`)) tot.setAttribute('data-wl-match', '1');
        });
        grid.querySelectorAll('.workload-plan-item').forEach(item => {
            if (issueIds.has(item.getAttribute('data-wl-issue-id') || '')) item.setAttribute('data-wl-match', '1');
        });
        grid.querySelectorAll('.workload-timeline-due, .workload-timeline-lines [data-wl-deadline-ids]').forEach(endpoint => {
            const endpointIds = (endpoint.getAttribute('data-wl-deadline-ids')
                || endpoint.getAttribute('data-wl-deadline-open') || '').split('|').filter(Boolean);
            if (endpointIds.some(id => issueIds.has(id))) endpoint.setAttribute('data-wl-match', '1');
        });
        // An editor card "matches" if any of its chips/totals matched, so the
        // dimming reads as a card-level effect, not a chip-level one.
        grid.querySelectorAll('.workload-day-card').forEach(card => {
            if (card.querySelector('[data-wl-match="1"]')) card.setAttribute('data-wl-match', '1');
        });

    }

    function wlClearSpotlight() {
        document.querySelectorAll('.workload-grid-wrap[data-wl-spotlight]').forEach(w => {
            w.removeAttribute('data-wl-spotlight');
        });
        document.querySelectorAll('[data-wl-match]').forEach(el => el.removeAttribute('data-wl-match'));
    }

    function wlClosePopover(returnFocus) {
        const pop = document.getElementById('wlPopover');
        if (!pop) return;
        const anchor = wlState.popoverAnchor;
        if (anchor && typeof anchor.setAttribute === 'function') anchor.setAttribute('aria-expanded', 'false');
        pop.classList.remove('open');
        pop.setAttribute('aria-hidden', 'true');
        // Closing is the other end of the feedback generation opened in
        // wlOpenRollupPopover. Recording it here is what lets an in-flight
        // tweak-comment drain stop spending the actor-wide read budget on a
        // popover nobody is looking at; inferring it from this class instead
        // missed the case where the popover closed before its first page
        // returned. (Lane D edit inside a Workload function — noted on the PR.)
        _wlTweakCommentsToken++;
        wlState.popoverAnchor = null;
        wlClearSpotlight();
        // Paint any data refresh that was deferred while the popover was open.
        if (wlState.renderQueued) {
            wlState.renderQueued = false;
            renderWorkloadAll();
        } else if (returnFocus && anchor && document.contains(anchor) && typeof anchor.focus === 'function') {
            anchor.focus();
        }
    }


    // Workload is an on-demand area (plan: docs/plans/2026-09-28-load-per-tab-plan.md);
    // this is its last fragment, so everything it names has run by now.
    // Everything outside it reaches in through here (040 svAreaApi / svArea /
    // svWithArea).
    svAreaRegister('workload', {
        render: renderWorkloadShell,
        init: initWorkloadView,
        teardown: _wlV2Teardown,
        v2Client: _wlV2Client,
        purgePlanSensitiveState: wlPurgePlanSensitiveState,
        refreshSensitiveStateSilent: wlRefreshSensitiveStateSilent,
        // Looked up by name at call time, as the direct calls these replace
        // were, so a page-level override (a test's spy) still sees each call.
        adoptNativeDueGatewayRow: row => wlAdoptNativeDueGatewayRow(row),
        publishNativeDueReceipt: row => wlPublishNativeDueReceipt(row),
    });

;(self.__svParts || (self.__svParts = [])).push("js/sv-04-workload-54702ba01afb.js");
