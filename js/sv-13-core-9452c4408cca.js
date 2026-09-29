        function _prodManualRefresh() {
            // The press must be visibly acknowledged: the refresh itself is a
            // silent background delta, and a button that does nothing on
            // screen reads as broken (the interaction inventory rightly
            // refuses silent no-ops).
            _prodToast('Refreshing production data\u2026');
            _prodDeltaRefresh({ force: true, full: true });
            return false;
        }
        // A background tick must never repaint under the user's hands. An open
        // picker/menu layer or an in-flight write means "try again next tick";
        // an explicit Retry press bypasses only the layer check, because the
        // press itself closes the layer.
        function _prodRefreshBusy() {
            if (_prodState.writes && _prodState.writes.size) return true;
            const layer = document.getElementById('prodLayer');
            if (layer && layer.childElementCount) return true;
            /* AND TYPING COUNTS, which is the case this guard was missing.

               An open menu and an in-flight write already deferred the tick;
               someone with a caret in a field did not. `_prodRender()` rebuilds
               `#prodRoot` wholesale, so a tick landing mid-keystroke replaces
               the node being typed into: the caret and the selection go with
               it, and the board's own filter and search inputs have nothing
               protecting them at all. Workload has guarded its search box this
               way since it shipped (`document.activeElement !== searchInput`)
               and Calendar defers on the same condition (`_calIsCalBusy`);
               Production is the last of the three to get it.

               This is deliberately the SAME answer a menu gets -- skip this
               tick, try the next one -- rather than a second mechanism that
               reads the data and defers the paint. Nothing is lost by waiting:
               the next tick is 30 seconds away, the freshness age keeps
               counting so the delay is visible, and an explicit Retry or the
               Refresh button passes `force` straight past this check.

               Scoped to the board. A field focused somewhere else on the page
               is not this surface's business and must not freeze it. */
            const el = document.activeElement;
            if (!el) return false;
            const typing = el.tagName === 'INPUT'
                || el.tagName === 'TEXTAREA'
                || el.isContentEditable === true;
            if (!typing) return false;
            const root = document.getElementById('prodRoot');
            return !!(root && root.contains(el));
        }
        function _prodSyncFreshnessControl() {
            const button = document.querySelector('[data-prod-refresh="1"]');
            if (button) button.disabled = !!_prodState.refreshInFlight;
            // The saved-copy notice owns this control until a live read lands.
            if (_prodState.fromCache) return;
            const ageEl = document.querySelector('[data-prod-freshness-age]');
            if (ageEl) {
                ageEl.textContent = _prodState.lastSyncError
                    ? 'Update failed · ' + _prodRefreshAgeLabel()
                    : _prodRefreshAgeLabel();
            }
            const wrap = document.querySelector('[data-prod-freshness]');
            if (wrap) wrap.setAttribute('data-prod-freshness', _prodRefreshDegraded() ? 'degraded' : 'fresh');
        }
        async function _prodDeltaRefresh(options) {
            const opts = options || {};
            if (!_prodEnabled() || !_prodState.loaded || _prodState.loading) return null;
            if (_prodState.refreshInFlight) return null;
            if (_prodState.writes && _prodState.writes.size) return null;
            if (!opts.force && _prodRefreshBusy()) return null;
            const watermark = _prodDeliverableWatermark(_prodState.deliverables);
            const needsFull = !!opts.full
                || !watermark
                || (Date.now() - Number(_prodState.lastFullSyncAt || 0)) >= PROD_FULL_RECONCILE_MS;
            _prodState.refreshInFlight = true;
            _prodSyncFreshnessControl();
            const hadError = !!_prodState.lastSyncError;
            // A background tick repaints only when something actually changed.
            // Repainting on every tick would rebuild the surface under the
            // user's pointer for no reason.
            let repaint = false;
            try {
                if (needsFull) {
                    // _prodLoadData renders its own result, and now reports
                    // whether it got one. A silent failure used to resolve
                    // indistinguishably from a success and be stamped as a
                    // completed full sync; the throw here routes it into the
                    // same catch arm a delta failure already uses, so the
                    // failure counter, the backoff and the visible notice all
                    // behave as they always have for a read that did not land.
                    if (await _prodLoadData({ silent: true }) === false) {
                        /* Read and CLEAR. A single-use baton cannot go stale
                           into a later, unrelated failure the way a field left
                           standing would -- and carrying the status is what
                           lets an expired session be told to sign in again
                           rather than to keep retrying. */
                        const failed = new Error('production_full_refresh_failed');
                        failed.status = Number(_prodState.lastSilentLoadStatus || 0);
                        _prodState.lastSilentLoadStatus = 0;
                        throw failed;
                    }
                    _prodState.lastFullSyncAt = Date.now();
                } else {
                    /* Deliverables only. A batch delta used to ride along here
                       so a filming day planned since the last read appeared
                       within 30s instead of at the ten-minute reconcile. It is
                       gone, and removing it is the point rather than a casualty.

                       It forced `batches.updated_at` to stop meaning "the CAS
                       clock for this row" and start meaning "freshness of the
                       last complete read", and those two readings fought across
                       five findings on #1364: a complete row at the same stamp
                       looked unchanged, the marker for that built a 30-second
                       refetch loop, an older snapshot could overwrite a newer
                       row, the CAS then sent pre-save clocks, and the separate
                       clock added to fix THAT had its own lifecycle holes. Every
                       one was a consequence of adding this read, and none of
                       them touched the two changes this PR is actually for.

                       So the row stamp goes back to meaning exactly what the
                       gateway always took it to mean, and batches refresh where
                       they always did: the ten-minute full reconcile, the manual
                       Refresh, and any full load. The cost is bounded and
                       stated -- a batch created elsewhere can be up to ten
                       minutes stale in an open tab. Worth having back one day,
                       as its own change with its own design. */
                    const rows = await _prodBrowserProjectionRows(
                        PROD_DELIVERABLE_SELECT,
                        'updated_at=gte.' + encodeURIComponent(watermark)
                    );
                    const changedIds = _prodMergeDeliverableRows(rows);
                    if (changedIds.length) {
                        repaint = true;
                        _prodInvalidateScopedReadsFor(changedIds);
                        _prodState.adapter = _prodAdapter(_prodState);
                        _prodCacheWrite({
                            clients: _prodState.clients,
                            members: _prodState.members,
                            batches: _prodState.batches,
                            deliverables: _prodState.deliverables,
                            authority: _prodState.authority
                        });
                    }
                    if (_prodState.view === 'detail' && _prodState.openId) {
                        // The open thread is operational data too; refresh()
                        // preserves the composer draft and scroll position.
                        _prodComments.refresh(_prodOpenRowId());
                    }
                }
                _prodState.lastSyncAt = Date.now();
                _prodState.lastSyncError = '';
                _prodState.refreshFailures = 0;
                return true;
            } catch (error) {
                _prodState.refreshFailures = Number(_prodState.refreshFailures || 0) + 1;
                const status = Number(error && error.status);
                _prodState.lastSyncError = status === 401 || status === 403
                    ? 'Live updates stopped: this session is no longer authorized.'
                    : 'Live updates are failing. Retry to catch up.';
                console.warn('[Production] operational refresh failed', error);
                return false;
            } finally {
                _prodState.refreshInFlight = false;
                if (hadError !== !!_prodState.lastSyncError) repaint = true;
                if (repaint && document.getElementById('prodRoot')) _prodRender();
                else _prodSyncFreshnessControl();
            }
        }
        /* LIVE UPDATES FOR PRODUCTION (realtime first, the poll as fallback).

           The board used to learn about other people's changes only from the
           30-second delta tick, which also pauses on a hidden tab. It now opens
           one supabase-js channel (postgres_changes on deliverables, batches
           and deliverable_events -- all three are in the realtime publication
           and readable by the page's key, the same way Workload subscribes)
           and routes every event into the EXISTING refresh path,
           `_prodDeltaRefresh`, so nothing about what is read, merged, cached or
           painted changes. Only WHEN it runs changes:

           - events are debounced (300 ms) and coalesced: a burst of ten row
             changes is one read, and a batch change, a delete or a
             deliverable_events insert in the burst upgrades that one read to a
             full reload. The delta reads deliverables by `updated_at`
             watermark and cannot see a batch change, a removed row, or a
             rename propagated from a card: that drain rewrites the title and
             inserts a deliverable_events row but deliberately leaves
             `updated_at` alone (migrations/2026-09-23-rename-propagation.sql);
           - an echo of this tab's own write is ignored: the gateway row was
             already adopted (`_prodApplyGatewayRow`), so an event whose
             `updated_at` AND visible fields equal the row this tab holds
             carries nothing new. Comparing `updated_at` alone is not enough,
             for the same rename-propagation reason;
           - a refresh that declines (write in flight, menu open, typing) is
             retried rather than dropped, and nothing runs on a hidden tab --
             the pending read runs when the tab is shown again;
           - the status is tracked honestly. The poll stays as the fallback:
             it slows to 90 s only while the channel reports SUBSCRIBED and is
             back to 30 s the moment it reports anything else. A SUBSCRIBED
             after a drop runs one full catch-up, because realtime does not
             replay what it missed while down. 90 s, not 120 s: the freshness
             control calls a board older than PROD_STALE_AFTER_MS (120 s)
             degraded, so the slow cadence keeps a 30 s margin under it;
           - KILL SWITCH (ROLLBACK.md): runtime flag `prod_realtime` with value
             {"enabled": false}, or localStorage `syncview.prodRealtime` = "off"
             in one browser, turns the channel off and restores the 30 s poll.
             A missing row or a failed read means ON; only an explicit false
             turns it off. Open tabs re-read the flag every 5 minutes and on
             every Production open.

           The controller takes all its effects as arguments so a unit test can
           drive it with a mocked channel (test/prod-realtime-controller.js).
           `window.prodRtStatus()` prints the live state. */
        /* PROD_RT_CONTROLLER_BEGIN */
        function _prodRtCreate(deps) {
            const d = deps;
            const debounceMs = Number(d.debounceMs || 300);
            const retryMs = Number(d.retryMs || 2000);
            const st = {
                status: 'idle', subscribedOnce: false, events: 0, echoes: 0,
                refreshes: 0, retries: 0, catchups: 0, lastEventAt: 0,
                lastStatusAt: 0, lastProblem: ''
            };
            let channel = null, client = null, timer = 0, pending = false, pendingFull = false, generation = 0;
            function pollInterval() {
                return st.status === 'SUBSCRIBED' ? d.slowPollMs : d.fastPollMs;
            }
            const ECHO_FIELDS = ['title', 'status', 'due_date', 'assignee_id', 'brief', 'file_url', 'batch_id', 'name'];
            function isEcho(table, payload) {
                const row = payload && payload.new;
                if (!row || row.id == null || !row.updated_at) return false;
                const local = d.localRow(table, String(row.id));
                if (!local || String(local.updated_at || '') !== String(row.updated_at)) return false;
                return ECHO_FIELDS.every(f => !Object.prototype.hasOwnProperty.call(row, f)
                    || !Object.prototype.hasOwnProperty.call(local, f)
                    || JSON.stringify(row[f]) === JSON.stringify(local[f]));
            }
            function arm(ms) {
                if (timer) return;
                timer = d.setTimeout(flush, ms);
            }
            function queue(full) {
                pending = true;
                if (full) pendingFull = true;
                arm(debounceMs);
            }
            function flush() {
                timer = 0;
                if (!pending) return;
                if (!d.active()) { pending = false; pendingFull = false; return; }
                if (d.hidden()) return; // resume() runs it when the tab is shown
                const full = pendingFull;
                pending = false; pendingFull = false;
                st.refreshes++;
                let result;
                try { result = d.refresh({ full }); } catch (e) { result = false; }
                return Promise.resolve(result).then((ok) => {
                    // null = the refresh declined (busy / already in flight).
                    // Put the request back so a change is never dropped.
                    if (ok === null && d.active()) {
                        st.retries++;
                        pending = true;
                        if (full) pendingFull = true;
                        arm(retryMs);
                    }
                }, () => {});
            }
            function onEvent(table, payload) {
                st.events++;
                st.lastEventAt = d.now();
                // A realtime event type, not an HTTP method.
                const removed = /^DELETE$/.test(String(payload && payload.eventType || ''));
                if (!removed && table !== 'deliverable_events' && isEcho(table, payload)) {
                    st.echoes++;
                    return;
                }
                // A changed row that kept its updated_at (a propagated rename)
                // sits below the watermark, so only a full read can see it.
                const row = payload && payload.new;
                const local = row && row.id != null ? d.localRow(table, String(row.id)) : null;
                const stampKept = !!(local && row.updated_at && String(local.updated_at || '') === String(row.updated_at));
                queue(table !== 'deliverables' || removed || stampKept);
            }
            function onStatus(gen, status) {
                if (gen !== generation) return; // a torn-down channel's CLOSED
                const before = pollInterval();
                st.status = String(status || '');
                st.lastStatusAt = d.now();
                if (st.status === 'SUBSCRIBED') {
                    if (st.subscribedOnce) { st.catchups++; queue(true); }
                    st.subscribedOnce = true;
                } else {
                    st.lastProblem = st.status;
                }
                if (before !== pollInterval() && d.onPollChange) d.onPollChange(pollInterval());
            }
            function start() {
                if (d.enabled && !d.enabled()) { stop(); st.status = 'disabled'; return; }
                if (channel || st.status === 'connecting') return;
                const gen = ++generation;
                st.status = 'connecting';
                return Promise.resolve(d.getClient()).then((c) => {
                    if (gen !== generation) return;
                    if (!c || !d.active()) { st.status = 'idle'; return; }
                    client = c;
                    try {
                        let ch = c.channel(d.channelName || 'production_live');
                        ['deliverables', 'batches', 'deliverable_events'].forEach((table) => {
                            ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => onEvent(table, p));
                        });
                        channel = ch;
                        ch.subscribe((s) => onStatus(gen, s));
                    } catch (e) {
                        channel = null;
                        st.status = 'CHANNEL_ERROR';
                        st.lastProblem = 'subscribe_threw';
                    }
                }, () => { if (gen === generation) { st.status = 'idle'; st.lastProblem = 'client_failed'; } });
            }
            function stop() {
                if (!channel && (st.status === 'idle' || st.status === 'disabled')) return;
                const wasSubscribed = st.status === 'SUBSCRIBED';
                generation++;
                if (timer) { d.clearTimeout(timer); timer = 0; }
                pending = false; pendingFull = false;
                if (channel && client && typeof client.removeChannel === 'function') {
                    try { client.removeChannel(channel); } catch (e) {}
                }
                channel = null;
                st.status = 'idle';
                st.subscribedOnce = false;
                if (wasSubscribed && d.onPollChange) d.onPollChange(pollInterval());
            }
            function resume() {
                if (pending && !timer) arm(0);
            }
            function status() {
                return {
                    status: st.status, live: st.status === 'SUBSCRIBED', pollMs: pollInterval(),
                    pending, pendingFull, events: st.events, echoesIgnored: st.echoes,
                    refreshes: st.refreshes, retries: st.retries, catchups: st.catchups,
                    lastEventAt: st.lastEventAt ? new Date(st.lastEventAt).toISOString() : '',
                    lastStatusAt: st.lastStatusAt ? new Date(st.lastStatusAt).toISOString() : '',
                    lastProblem: st.lastProblem
                };
            }
            return { start, stop, resume, status, pollInterval, onEvent };
        }
        /* PROD_RT_CONTROLLER_END */
        const PROD_RT_DEBOUNCE_MS = 300;
        const PROD_RT_SLOW_POLL_MS = 90000;
        const PROD_RT_FLAG_KEY = 'prod_realtime';
        const PROD_RT_LOCAL_KEY = 'syncview.prodRealtime';
        const PROD_RT_FLAG_REREAD_MS = 300000;
        let _prodRtFlagOn = true, _prodRtFlagReadAt = 0, _prodRtFlagBusy = false;
        function _prodRtEnabled() {
            try { if (localStorage.getItem(PROD_RT_LOCAL_KEY) === 'off') return false; } catch (e) {}
            return _prodRtFlagOn;
        }
        // Default ON: a missing row or a failed read keeps realtime on (the
        // poll is still running underneath); only {"enabled": false} is off.
        async function _prodRtReadFlag(force) {
            if (_prodRtFlagBusy || (!force && Date.now() - _prodRtFlagReadAt < PROD_RT_FLAG_REREAD_MS)) return;
            if (!CAL_SUPABASE_URL || !CAL_SUPABASE_ANON_KEY) return;
            _prodRtFlagBusy = true;
            _prodRtFlagReadAt = Date.now();
            try {
                const url = CAL_SUPABASE_URL + '/rest/v1/syncview_runtime_flags?select=value&key=eq.' + encodeURIComponent(PROD_RT_FLAG_KEY) + '&limit=1';
                const response = await fetch(url, { cache: 'no-store', headers: { apikey: CAL_SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY, Accept: 'application/json' } });
                if (!response.ok) return;
                const rows = await response.json();
                const value = Array.isArray(rows) && rows[0] ? rows[0].value : null;
                _prodRtFlagOn = !(value && value.enabled === false);
            } catch (e) {
                console.warn('[Production] realtime flag read failed; keeping realtime on', e);
            } finally {
                _prodRtFlagBusy = false;
            }
            if (!_prodRtEnabled()) _prodRt.stop();
            else if (_prodRtActive()) _prodRt.start();
        }
        let _prodOperationalTimer = 0;
        let _prodOperationalNextAt = 0;
        function _prodRtActive() {
            return currentNav === 'production' && !!document.getElementById('prodRoot') && _prodEnabled();
        }
        const _prodRt = _prodRtCreate({
            debounceMs: PROD_RT_DEBOUNCE_MS,
            slowPollMs: PROD_RT_SLOW_POLL_MS,
            fastPollMs: PROD_DELTA_REFRESH_MS,
            channelName: 'production_live',
            setTimeout: (fn, ms) => setTimeout(fn, ms),
            clearTimeout: (t) => clearTimeout(t),
            now: () => Date.now(),
            hidden: () => !!document.hidden,
            active: _prodRtActive,
            enabled: () => _prodRtEnabled(),
            getClient: () => svArea('workload').then(wl => wl.v2Client(), () => null),
            refresh: (o) => _prodDeltaRefresh({ full: !!(o && o.full) }),
            localRow: (table, id) => {
                const rows = table === 'batches' ? _prodState.batches : _prodState.deliverables;
                return (rows || []).find(r => String(r && r.id || '') === id) || null;
            },
            onPollChange: (ms) => {
                // Dropping back to the fast poll must not wait out a 120 s
                // countdown that was set while realtime was up.
                const soonest = Date.now() + ms;
                if (!_prodOperationalNextAt || _prodOperationalNextAt > soonest) _prodOperationalNextAt = soonest;
            }
        });
        window.prodRtStatus = () => _prodRt.status();
        document.addEventListener('visibilitychange', () => { if (!document.hidden) _prodRt.resume(); });
        function _prodOperationalRefreshDelay() {
            const failures = Number(_prodState.refreshFailures || 0);
            if (!failures) return _prodRt.pollInterval();
            return Math.min(PROD_REFRESH_MAX_BACKOFF_MS, PROD_DELTA_REFRESH_MS * Math.pow(2, failures));
        }
        function _prodStartOperationalRefresh() {
            _prodRtReadFlag(true);
            _prodRt.start();
            if (_prodOperationalTimer) return;
            _prodOperationalNextAt = Date.now() + PROD_DELTA_REFRESH_MS;
            _prodOperationalTimer = setInterval(() => {
                // The age keeps counting even when no read runs, so a hidden or
                // blocked tab still shows an honest last-success age instead of
                // a frozen one. This touches text only; it never re-renders.
                if (document.getElementById('prodRoot') && currentNav === 'production') {
                    _prodSyncFreshnessControl();
                }
                // Leaving Production tears the live channel down within one
                // tick; coming back (mount, or this tick) opens it again.
                if (!_prodRtActive()) _prodRt.stop();
                else { _prodRtReadFlag(false); _prodRt.start(); }
                if (document.hidden || currentNav !== 'production' || !document.getElementById('prodRoot')) return;
                if (Date.now() < _prodOperationalNextAt) return;
                _prodOperationalNextAt = Date.now() + _prodOperationalRefreshDelay();
                _prodDeltaRefresh({});
            }, 5000);
        }
        /* WHICH ITEM IS ACTUALLY ON SCREEN, asked of the DOM rather than of state.
           `_prodState.openId` answers where the reader is GOING; the pane still
           standing in the document is where they have BEEN, and between those
           two the capture below has to mean the second one. Every detail
           container stamps its own id, so the painted pane can say who it is. */
        function _prodPaintedDetailKey(root) {
            const detail = root && root.querySelector ? root.querySelector('.prod-detail-main') : null;
            const owner = detail && detail.closest ? detail.closest('[data-prod-detail],[data-prod-batch-detail],[data-prod-project-detail]') : null;
            if (!owner || !owner.getAttribute) return '';
            return String(owner.getAttribute('data-prod-detail')
                || owner.getAttribute('data-prod-batch-detail')
                || owner.getAttribute('data-prod-project-detail') || '');
        }
        function _prodCaptureListScroll(root) {
            root = root || document.getElementById('prodRoot');
            const list = root && root.querySelector ? root.querySelector('.prod-listwrap') : null;
            if (list) _prodState.listScrollTop = list.scrollTop || 0;
            /* The detail pane is rebuilt by every render (description/comments/
               assets arriving, the 30s delta tick, authority changes), and an
               innerHTML swap resets its scroll to 0 — so a reader partway down a
               long issue was yanked back to the top. Capture per open id so the
               restore never applies a stale offset to a different issue.

               THE KEY COMES FROM THE PAINTED PANE, and reading it from state
               instead is owner report 2026-09-02: opening a sub-issue and going
               back to its parent painted the parent SCROLLED DOWN and then
               snapped it to the top.

               `_prodRender` calls this AFTER the navigation has already written
               the new id into `_prodState.openId`, and one line before the
               innerHTML swap. So the offset read here belongs to the OUTGOING
               item while the key stamped beside it named the INCOMING one. The
               restore below then matched — it compares the same state to itself
               — and pasted the sub-issue's offset onto the parent's fresh pane.
               `_prodScrollDetailToTop`'s deferred reset undid it a tick later,
               which is the snap: two correct-looking mechanisms, one mismatched
               label, and a visible flash where there should have been nothing.

               Asking the DOM cannot drift, because the thing being measured and
               the thing being named are then the same element. */
            const detail = root && root.querySelector ? root.querySelector('.prod-detail-main') : null;
            if (detail) {
                _prodState.detailScrollTop = detail.scrollTop || 0;
                _prodState.detailScrollKey = _prodPaintedDetailKey(root);
            }
        }
        function _prodScrollDetailToTop() {
            /* No key is stamped here on purpose. A zero offset is never
               restored — the restore is guarded on a truthy `detailScrollTop`
               — so a key beside it would name nothing, and the one it used to
               copy (`openId`) is the string the URL asked for, which for a deep
               link is the Linear identifier and not the canonical row id the
               pane stamps. Keeping it would have reintroduced exactly the
               mislabelling above, one indirection further away. */
            _prodState.detailScrollTop = 0;
            _prodState.detailScrollKey = '';
            setTimeout(() => {
                const detailMain = document.querySelector('#prodRoot .prod-detail-main');
                if (detailMain) detailMain.scrollTop = 0;
                window.scrollTo({ top: 0, left: 0 });
            }, 0);
        }
        function _prodRender() {
            const root = document.getElementById('prodRoot');
            if (!root) return;
            const descriptionFocus = _prodCaptureDescriptionFocus(root);
            /* The description capture answers only for an OPEN EDITOR, because
               it also writes the caret back into description state. Every other
               focusable control in the tab -- the asset URL inputs, the Edit and
               Refresh buttons, the comment composer, the sidebar -- is covered
               by the general snapshot below. */
            const focusSnapshot = _prodCaptureFocus(root);
            _prodEnsureOverlays();
            _prodHideTip();
            _prodCaptureListScroll(root);
            _prodListFillSeq++;
            _prodListDeferred = [];
            _prodListRowBudget = (!root.querySelector('.prod-row') && !_prodState.listScrollTop && !_prodState.focusRow)
                ? _prodFirstScreenRows() : Infinity;
            try {
                root.innerHTML = _prodSidebar() + '<div class="prod-main">' + _prodTopbar() + '<div class="prod-content">' + _prodBody() + '</div></div>';
            } finally {
                _prodListRowBudget = Infinity;
            }
            const list = root.querySelector('.prod-listwrap');
            if (list && _prodListDeferred.length) _prodListFill(list, _prodListDeferred);
            _prodListDeferred = [];
            if (list && _prodState.listScrollTop) list.scrollTop = _prodState.listScrollTop;
            /* Symmetric with the capture: the pane that just painted is asked
               who it is, and the offset is only put back on the same item it
               was taken from. An empty key restores nothing, which also closes
               a quieter version of the same defect — a project view stamped
               `''` (its slug lives in neither openId nor openBatchId), so every
               project matched every other project's saved offset. */
            const detailPane = root.querySelector('.prod-detail-main');
            if (detailPane && _prodState.detailScrollTop && _prodState.detailScrollKey) {
                const painted = _prodPaintedDetailKey(root);
                if (painted && painted === _prodState.detailScrollKey) detailPane.scrollTop = _prodState.detailScrollTop;
            }
            if (_prodState.view === 'detail' && _prodState.openId) {
                const openRowId = _prodOpenRowId();
                _prodComments.ensure(openRowId);
                _prodLoadLinearRawFor(openRowId);
                _prodEnsureLabels(openRowId, false);
                _prodEnsureDescription(openRowId, false);
                _prodEnsureAssets(openRowId, false);
                /* A batch parent takes its own one-row read inside the call
                   above (it has no deliverable row to authorize against). The
                   panel it paints is the CHILD row, so the read that fills it
                   has to be asked for by id. Ensure is idempotent and cached
                   per row, so opening the parent and then the child costs one
                   read between them, not two. */
                const batchAssetSource = _prodBatchAssetSource(_prodIssue(openRowId));
                if (batchAssetSource) _prodEnsureAssets(batchAssetSource.id, false);
                /* The file pills on the sub-issue list. Asked for once per
                   BATCH ROW OF THE POST, only where a list is actually drawn --
                   a row with a parent renders no sub-issue section, so it needs
                   none.

                   Per post rather than per row since 2026-09-05. batch_files_read
                   answers `deliverables where batch_id = <one id>`, and this
                   asked for the open parent's own batch only -- so on a post
                   whose children sit on a different batch row (44 of 1,138
                   measured) the response carried the parent and nothing else,
                   _prodBatchFileFor found no entry for any sub-issue, and every
                   pill was omitted. Reported by the owner as pills that used to
                   be there: they were never there for these posts, and are for
                   the other 1,027.

                   Deliberately several calls to the EXISTING read rather than a
                   new post-scoped one: the read is already cached and
                   generation-keyed per batch id, the common case still makes
                   exactly one request, and this half then ships with the page
                   instead of waiting on a gateway deploy. */
                const openIssue = _prodIssue(openRowId);
                if (openIssue && !openIssue.parent) {
                    const asked = new Set();
                    _prodPostRows(openIssue).forEach(row => {
                        const rowBatchId = String(row && row.batchId || '').trim();
                        if (!rowBatchId || asked.has(rowBatchId)) return;
                        asked.add(rowBatchId);
                        /* The scope is taken from the row that NAMES the batch,
                           not from the parent. They are the same client on every
                           shape measured, but the gateway pins on client_slug and
                           answers a mismatch with a flat 403 -- so asking under
                           the scope that owns the row is the question that can
                           succeed rather than the one that assumes. */
                        const scope = String(
                            row.authorityProject || row.storedClientSlug || ''
                        ).trim();
                        /* The two attribution SENTINELS are excluded for the
                           reason _prodBatchAssetSource excludes them: a row with
                           no attribution carries `__needs_attribution__` or
                           `__attribution_conflict__`, and sending one as a
                           client slug is a guaranteed 403. A request whose
                           refusal is already known is a failed call in the
                           console and in the audit, for an answer nobody
                           gains. */
                        if (!scope
                            || scope === PROD_ATTRIBUTION_NEEDS
                            || scope === PROD_ATTRIBUTION_CONFLICT) return;
                        _prodEnsureBatchFiles(rowBatchId, scope);
                    });
                }
            }
            if (_prodState.view === 'batch' && _prodState.openBatchId) {
                const batchRows = _prodBatchRows(_prodState.openBatchId);
                // Prefetch for whichever row the panel will actually ask about
                // (attribution-eligible), not necessarily the display-first one.
                const assetRow = _prodAssetEligibleRow(batchRows) || batchRows[0];
                if (assetRow) _prodEnsureAssets(assetRow.id, false);
                /* This view renders `batch.description` straight off the row and
                   the boot read no longer carries it, so it needs its own read;
                   _prodEnsureDescription serves the DETAIL view only. It belongs
                   in this block rather than a second one above the detail
                   branch: test/prod-deep-link-open-id-key.js slices that branch
                   as detail-start up to the first `view === 'batch'`, so a block
                   placed ahead of it makes that slice empty and the whole
                   canonical-row-id section vacuous. */
                _prodEnsureBatchDescription(_prodState.openBatchId, false);
            }
            /* Description first: its snapshot carries the caret from description
               state, which tracks edits the live element no longer shows. The
               general restore is the fallback for everything else, and for a
               description editor whose panel did not come back. */
            if (!_prodRestoreDescriptionFocus(descriptionFocus)) _prodRestoreFocus(focusSnapshot, root);
        }
        function _prodNavItem(icon, label, active, onClick, cls, tip) {
            return '<button class="prod-nav-btn' + (cls ? ' ' + cls : '') + (active ? ' active' : '') + '" type="button" data-prod-tip="' + _calEscAttr(tip || label) + '" onclick="' + onClick + '"><span class="prod-nav-ico">' + icon + '</span><span>' + _calEsc(label) + '</span></button>';
        }
        // PORT-DELTA: sidebar structure follows renderSidebar with host class names.
        function _prodSidebar() {
            const favIssues = _prodIssues().filter(d => d.favorite || d.fav);
            const favHTML = favIssues.length
                ? '<button class="prod-nav-section' + (_prodState.secOpen.fav ? '' : ' collapsed') + '" type="button" data-prod-tip="Favorites" onclick="_prodToggleSection(' + _jsAttrArg('fav') + ')"><span class="prod-section-label">Favorites</span><span class="prod-section-chev">' + _prodIcon('chevD') + '</span></button>'
                    + (_prodState.secOpen.fav ? '<div class="prod-nav">' + favIssues.slice(0, 6).map(d => _prodNavItem(_prodStatusSVG(d.status), d.title || _prodIssueLabel(d), _prodState.openId === d.id, '_prodOpenDeliverable(' + _jsAttrArg(d.id) + ')', 'child')).join('') + '</div>' : '')
                : '';
            const teamBlock = team => {
                const open = _prodState.teamOpen[team] !== false;
                const label = _prodTeamLabel(team);
                const emoji = team === 'video' ? '📽️' : '🎨';
                return '<div class="prod-nav"><button class="prod-team-hd' + (open ? '' : ' collapsed') + '" type="button" data-prod-tip="' + _calEscAttr(label + ' team') + '" onclick="_prodToggleTeam(' + _jsAttrArg(team) + ')"><span class="prod-team-emoji">' + emoji + '</span><span class="prod-team-name">' + label + '</span><span class="prod-section-chev">' + _prodIcon('chevD') + '</span></button>'
                    + (open
                        ? _prodNavItem(_prodIcon('issues'), 'Issues', (_prodState.view === 'list' && _prodState.team === team), '_prodOpenTeamView(' + _jsAttrArg(team) + ',' + _jsAttrArg('list') + ')', 'child')
                            + _prodNavItem(_prodIcon('project'), 'Projects', (_prodState.view === 'board' && _prodState.team === team), '_prodOpenTeamView(' + _jsAttrArg(team) + ',' + _jsAttrArg('board') + ')', 'child')
                        : '')
                    + '</div>';
            };
            return '<aside class="prod-side"><div class="prod-side-top"><span class="prod-spacer"></span><button class="prod-search-btn" type="button" onclick="_prodOpenPalette()" title="Search workspace (/)" data-prod-tip="Search workspace|/">' + _prodIcon('search') + '</button></div>'
                + '<div class="prod-side-scroll"><div class="prod-nav">'
                + _prodNavItem(_prodIcon('issues'), 'My issues', _prodState.view === 'my', '_prodSetView(' + _jsAttrArg('my') + ')')
                + '</div>' + favHTML
                + '<button class="prod-nav-section' + (_prodState.secOpen.ws ? '' : ' collapsed') + '" type="button" data-prod-tip="Workspace" onclick="_prodToggleSection(' + _jsAttrArg('ws') + ')"><span class="prod-section-label">Workspace</span><span class="prod-section-chev">' + _prodIcon('chevD') + '</span></button>'
                + (_prodState.secOpen.ws ? '<div class="prod-nav">' + _prodNavItem(_prodIcon('project'), 'Projects', _prodState.view === 'board' && _prodState.team === 'all', '_prodOpenTeamView(' + _jsAttrArg('all') + ',' + _jsAttrArg('board') + ')', '', 'All projects') + '</div>' : '')
                + '<button class="prod-nav-section' + (_prodState.secOpen.teams ? '' : ' collapsed') + '" type="button" data-prod-tip="Your teams" onclick="_prodToggleSection(' + _jsAttrArg('teams') + ')"><span class="prod-section-label">Your teams</span><span class="prod-section-chev">' + _prodIcon('chevD') + '</span></button>'
                + (_prodState.secOpen.teams ? teamBlock('video') + teamBlock('graphics') : '')
                + '</div></aside>';
        }
        function _prodTopbar() {
            if (_prodState.view === 'project') return _prodProjectTopbar();
            if (_prodState.view === 'detail' || _prodState.view === 'batch') return _prodDetailTopbar();
            const viewName = _prodState.view === 'board' ? 'Projects' : _prodState.view === 'my' ? 'My issues' : 'Issues';
            const clientFilter = _prodClientFilterLabel();
            const crumb = '<div class="prod-crumb"><button class="prod-crumb-link" type="button" data-prod-crumb-root="1" onclick="_prodOpenTeamView(' + _jsAttrArg('all') + ',' + _jsAttrArg(_prodState.view === 'board' ? 'board' : 'list') + ')" data-prod-tip="Production">' + 'Production' + '</button><span class="prod-crumb-sep">' + _prodIcon('chevR') + '</span><button class="prod-crumb-link" type="button" data-prod-crumb-team="' + _calEscAttr(_prodState.team || 'all') + '" onclick="return _prodOpenTeamScopeMenu(event,' + _jsAttrArg(_prodState.view === 'board' ? 'board' : 'list') + ')" data-prod-tip="Switch team scope">' + _calEsc(_prodTeamLabel(_prodState.team)) + '</button>' + (clientFilter ? '<span class="prod-crumb-sep">' + _prodIcon('chevR') + '</span><button class="prod-crumb-link" type="button" data-prod-crumb-client="' + _calEscAttr(_prodState.clientSlug) + '" onclick="_prodOpenProject(' + _jsAttrArg(_prodState.clientSlug) + ')" data-prod-tip="Open project">' + _calEsc(clientFilter) + '</button>' : '') + '<span class="prod-crumb-sep">' + _prodIcon('chevR') + '</span><span>' + _calEsc(viewName) + '</span></div>';
            const tabs = _prodState.view === 'board'
                ? '<div class="prod-tabs"><span class="prod-tab prod-tab-static active" data-prod-static-scope="projects">All projects</span></div>'
                : '<div class="prod-tabs"><button class="prod-tab' + (_prodState.tab === 'active' ? ' active' : '') + '" type="button" onclick="_prodSetTab(' + _jsAttrArg('active') + ')">Active</button><button class="prod-tab' + (_prodState.tab === 'backlog' ? ' active' : '') + '" type="button" onclick="_prodSetTab(' + _jsAttrArg('backlog') + ')">Backlog</button><button class="prod-tab' + (_prodState.tab === 'all' ? ' active' : '') + '" type="button" onclick="_prodSetTab(' + _jsAttrArg('all') + ')">All issues</button></div>';
            const filterPills = '<button class="prod-filter-pill prod-scope-pill" type="button" data-prod-scope-team="' + _calEscAttr(_prodState.team || 'all') + '" onclick="return _prodOpenTeamScopeMenu(event,' + _jsAttrArg(_prodState.view === 'board' ? 'board' : 'list') + ')" data-prod-tip="Switch team scope">' + _prodIcon('filter') + '<span>' + _calEsc(_prodTeamLabel(_prodState.team)) + '</span></button>'
                + (clientFilter ? '<button class="prod-filter-pill prod-scope-pill" type="button" data-prod-scope-project="' + _calEscAttr(_prodState.clientSlug) + '" onclick="_prodOpenProject(' + _jsAttrArg(_prodState.clientSlug) + ')" data-prod-tip="Open project">' + _prodIcon('project') + '<span>' + _calEsc(clientFilter) + '</span></button>' : '')
                + _prodPillsHTML();
            const subbar = '<div class="prod-subbar">' + tabs + '<div class="prod-filter-pills">' + filterPills + '</div><div class="prod-spacer"></div><button class="prod-icon-btn' + ((_prodState.filters || []).length ? ' active' : '') + '" id="prodFilterBtn" type="button" onclick="return _prodOpenFilterMenu(event)" aria-label="Filter" data-prod-tip="Filter">' + _prodIcon('filter') + '</button><button class="prod-icon-btn" id="prodGroupBtn" type="button" onclick="return _prodOpenGroupMenu(event)" aria-label="Display options" data-prod-tip="Display options">' + _prodIcon('display') + '</button></div>';
            const createClient = _prodState.clientSlug && _prodClient(_prodState.clientSlug) ? _prodState.clientSlug : '';
            const createTeam = _prodState.team === 'video' || _prodState.team === 'graphics' ? _prodState.team : '';
            return '<div class="prod-topbar">' + crumb + '<div class="prod-spacer"></div>' + _prodFreshnessHTML() + '<button class="prod-icon-btn" type="button" onclick="return _prodOpenArchiveRepair()" aria-label="Archive asset repair" data-prod-tip="Archive asset repair">' + _prodIcon('issues') + '</button>' + _prodCreateTopbarButton(createClient, createTeam) + '</div>' + subbar;
        }
        function _prodProjectTopbar() {
            const c = _prodClient(_prodState.openProjectId);
            const title = c ? (c.name || c.id) : 'Project';
            const team = _prodProjectScopeTeam(c);
            const detailBtn = '<button class="prod-icon-btn' + (_prodState.projectDetailsOpen === false ? '' : ' active') + '" type="button" data-prod-project-details-toggle="1" onclick="_prodToggleProjectDetails()" title="Project details" data-prod-tip="Project details">' + _prodIcon('project') + '</button>';
            const subbar = '<div class="prod-subbar" data-prod-project-subbar="1"><div class="prod-filter-pills">' + _prodPillsHTML() + '</div><div class="prod-spacer"></div><button class="prod-icon-btn' + ((_prodState.filters || []).length ? ' active' : '') + '" id="prodFilterBtn" type="button" onclick="return _prodOpenFilterMenu(event)" aria-label="Filter" data-prod-tip="Filter">' + _prodIcon('filter') + '</button>' + detailBtn + '<button class="prod-icon-btn" id="prodGroupBtn" type="button" onclick="return _prodOpenGroupMenu(event)" aria-label="Display options" data-prod-tip="Display options">' + _prodIcon('display') + '</button></div>';
            return '<div class="prod-topbar prod-detail-top"><button class="prod-icon-btn" type="button" onclick="_prodSetView(' + _jsAttrArg('board') + ')" title="Back" data-prod-tip="Back">' + _prodIcon('back') + '</button><div class="prod-detail-crumb"><button class="prod-crumb-link" type="button" data-prod-crumb-root="1" onclick="_prodOpenTeamView(' + _jsAttrArg('all') + ',' + _jsAttrArg('board') + ')" data-prod-tip="Production">Production</button><span class="prod-crumb-sep">' + _prodIcon('chevR') + '</span><button class="prod-crumb-link" type="button" data-prod-crumb-team="' + _calEscAttr(team || 'all') + '" onclick="_prodOpenTeamView(' + _jsAttrArg(team || 'all') + ',' + _jsAttrArg('board') + ')" data-prod-tip="Open team projects">' + _calEsc(_prodTeamLabel(team)) + '</button><span class="prod-crumb-sep">' + _prodIcon('chevR') + '</span><b>Project</b><span class="prod-crumb-title"' + _prodTitleAttrs(title) + '>' + _calEsc(title) + '</span></div><div class="prod-spacer"></div>' + _prodFreshnessHTML() + _prodCreateTopbarButton(c ? c.id : '', team) + '<button class="prod-icon-btn" type="button" onclick="return _prodOpenContextMenu(event,' + _jsAttrArg('client') + ',' + _jsAttrArg(c ? c.id : '') + ')" data-prod-tip="More options">' + _prodIcon('dots') + '</button></div>' + subbar;
        }
        function _prodDetailTopbar() {
            const d = _prodState.openId ? _prodIssue(_prodState.openId) : null;
            const batch = _prodState.openBatchId ? _prodBatch(_prodState.openBatchId) : d ? _prodBatch(d.batchId) : null;
            const parent = d && d.parent ? _prodIssue(d.parent) : null;
            const clientSlug = d ? d.project : batch ? batch.client_slug : '';
            const title = d ? (d.title || _prodIssueLabel(d)) : batch ? (batch.name || 'Batch') : 'Detail';
            const showParent = !!parent;
            const ctxKind = d ? 'issue' : 'batch';
            const ctxId = d ? d.id : batch ? batch.id : '';
            const currentKind = d ? (showParent ? 'Sub-issue' : 'Issue') : 'Batch';
            const currentId = d && !showParent ? '<b>' + _calEsc(_prodIssueDisplayLabel(d)) + '</b>' : !d ? '<b>Batch</b>' : '';
            // Sibling navigation (owner 2026-08-18): inside a sub-issue, step to
            // the previous/next sibling without going back to the parent. Order
            // matches the parent's sub-issue section (_prodChildrenOf).
            let siblingNav = '';
            if (showParent) {
                const siblings = _prodChildrenOf(parent.id);
                const at = siblings.findIndex(k => k && k.id === d.id);
                const prev = at > 0 ? siblings[at - 1] : null;
                const next = at >= 0 && at < siblings.length - 1 ? siblings[at + 1] : null;
                // The prev arrow is chevD rotated by CSS: PROD_ICON stays an
                // exact copy of the design artifact (port-fidelity-check).
                const navBtn = (target, dir, label) => target
                    ? '<button class="prod-icon-btn" type="button" data-prod-sibling-nav="' + dir + '" onclick="_prodOpenDeliverable(' + _jsAttrArg(target.id) + ')" aria-label="' + label + '" data-prod-tip="' + label + '">' + _prodIcon('chevD') + '</button>'
                    : '<button class="prod-icon-btn" type="button" data-prod-sibling-nav="' + dir + '" disabled aria-label="' + label + '" data-prod-tip="' + label + '">' + _prodIcon('chevD') + '</button>';
                siblingNav = (at >= 0 && siblings.length > 1
                    ? '<span class="prod-sibling-pos" data-prod-sibling-pos="' + (at + 1) + '/' + siblings.length + '">' + (at + 1) + '/' + siblings.length + '</span>'
                    : '')
                    + navBtn(prev, 'prev', 'Previous sub-issue')
                    + navBtn(next, 'next', 'Next sub-issue');
            }
            return '<div class="prod-topbar prod-detail-top"><button class="prod-icon-btn" type="button" onclick="_prodSetView(' + _jsAttrArg('list') + ')" title="Back" data-prod-tip="Back">' + _prodIcon('back') + '</button><div class="prod-detail-crumb">'
                + '<button class="prod-crumb-link" type="button" data-prod-crumb-client="' + _calEscAttr(clientSlug) + '" data-prod-crumb-project="' + _calEscAttr(clientSlug) + '" onclick="_prodOpenProject(' + _jsAttrArg(clientSlug) + ')" data-prod-tip="Open project"><span style="font-size:12px">' + _prodProjectGlyph(clientSlug) + '</span><span>' + _calEsc(_prodDisplayClient(clientSlug)) + '</span></button>'
                + (showParent ? '<span class="prod-crumb-sep">' + _prodIcon('chevR') + '</span><span class="prod-crumb-kind">Issue</span><button class="prod-crumb-link" type="button" data-prod-crumb-batch="' + _calEscAttr(parent.id) + '" onclick="_prodOpenDeliverable(' + _jsAttrArg(parent.id) + ')" data-prod-tip="Open parent">' + _calEsc(parent.title || _prodIssueLabel(parent)) + '</button>' : '')
                + '<span class="prod-crumb-sep">' + _prodIcon('chevR') + '</span><span class="prod-crumb-kind">' + currentKind + '</span>' + currentId + '<span class="prod-crumb-title"' + _prodTitleAttrs(title) + '>' + _calEsc(title) + '</span></div><div class="prod-spacer"></div>' + _prodFreshnessHTML() + siblingNav + '<button class="prod-icon-btn" type="button" onclick="return _prodOpenContextMenu(event,' + _jsAttrArg(ctxKind) + ',' + _jsAttrArg(ctxId) + ')" data-prod-tip="More options">' + _prodIcon('dots') + '</button></div>';
        }
        function _prodBody() {
            if (_prodState.loading) return _svLoadingSkeletonHtml('production');
            if (_prodState.error) return '<div class="prod-error"><strong>Production preview could not load.</strong><br>' + _calEsc(_prodState.error) + '<br><button class="prod-tab" type="button" onclick="_prodRefresh()">Retry</button></div>';
            if (!_prodState.loaded) return _svLoadingSkeletonHtml('production');
            if (_prodState.view === 'board') return _prodBoard();
            if (_prodState.view === 'detail') return _prodDetail();
            if (_prodState.view === 'batch') return _prodBatchDetail();
            if (_prodState.view === 'project') return _prodProjectDetail();
            return _prodList();
        }
        function _prodWireBulkCommandMenu(pop, ids) {
            /* `proj` is NOT here any more. It used to open the submenu that built
               a searchable list of every client and then refused the pick, and it
               was reachable three ways -- click, Enter, and the P accelerator. */
            const hasSub = { assign: 1, status: 1, due: 1 };
            const rows = Array.from(pop.querySelectorAll('[data-prod-ctx]'));
            const refusedRow = el => !!(el && el.hasAttribute('data-prod-disabled'));
            const visible = () => rows.filter(el => el.style.display !== 'none');
            /* -1 means NOTHING is highlighted, and that state has to exist. A
               refused row is searchable and hoverable but is never the Enter
               target: the arrows step OVER it in the direction of travel, and a
               search that matches only refused rows leaves no target at all.
               Without a real -1 the old `visible()[sel] || visible()[0]` would
               quietly fire whichever command happened to be first, which is a
               worse outcome than the one this change set out to fix. */
            let sel = -1;
            const nextEnabled = (shown, from, step) => {
                for (let i = from; i >= 0 && i < shown.length; i += step) {
                    if (!refusedRow(shown[i])) return i;
                }
                return -1;
            };
            const hi = (n, dir) => {
                const shown = visible();
                const paint = () => shown.forEach((el, i) => el.classList.toggle('sel', i === sel));
                if (!shown.length) { sel = -1; return; }
                const step = dir < 0 ? -1 : 1;
                const start = Math.max(0, Math.min(n, shown.length - 1));
                let ix = nextEnabled(shown, start, step);
                if (ix < 0) ix = nextEnabled(shown, start, -step);
                sel = ix;
                paint();
                if (sel >= 0) shown[sel].scrollIntoView({ block: 'nearest' });
            };
            const activate = row => {
                if (!row) return;
                if (refusedRow(row)) {
                    /* Echo the tip this row already shows on hover. The menu
                       deliberately STAYS open: closing it on a refusal is what
                       made the old Delete feel like it had done something. */
                    _prodReadonlyGuard(row.getAttribute('data-prod-tip'));
                    return;
                }
                const act = row.getAttribute('data-prod-ctx');
                if (hasSub[act]) {
                    _prodOpenSub(row, act, ids);
                    return;
                }
                if (act === 'copy-id') {
                    _prodClearLayer();
                    _prodCopyIssueIds(ids);
                }
            };
            rows.forEach(el => {
                el.addEventListener('mouseenter', () => {
                    const shown = visible();
                    const ix = shown.indexOf(el);
                    if (ix < 0) { _prodCloseSub(); return; }
                    /* Hovering a refused row surfaces its tip and clears the
                       highlight entirely. Leaving the previous row highlighted
                       would mean Enter fires a command the cursor is not on. */
                    sel = refusedRow(el) ? -1 : ix;
                    shown.forEach((row, i) => row.classList.toggle('sel', i === sel));
                    _prodCloseSub();
                });
                el.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    activate(el);
                });
            });
            const inp = pop.querySelector('[data-prod-search]');
            if (inp) {
                inp.addEventListener('input', () => {
                    const q = inp.value.trim().toLowerCase();
                    let shown = 0;
                    rows.forEach(el => {
                        const label = (el.getAttribute('data-prod-bulk-label') || el.textContent || '').toLowerCase();
                        const match = !q || label.includes(q);
                        el.style.display = match ? '' : 'none';
                        if (match) shown++;
                    });
                    _prodCloseSub();
                    _prodPickerEmptyState(pop, shown);
                    hi(0);
                });
                inp.addEventListener('keydown', e => {
                    e.stopPropagation();
                    if (e.key === 'Tab') { e.preventDefault(); return; }
                    if (e.key === 'Escape') { e.preventDefault(); _prodClearLayer(); return; }
                    if (e.key === 'ArrowDown') { e.preventDefault(); hi(sel < 0 ? 0 : sel + 1, 1); return; }
                    if (e.key === 'ArrowUp') { e.preventDefault(); hi(sel < 0 ? 0 : sel - 1, -1); return; }
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        /* No `|| visible()[0]` fallback. With nothing
                           highlighted, Enter must do nothing rather than run
                           whatever sorted first. */
                        if (sel >= 0) activate(visible()[sel]);
                    }
                });
                try { inp.focus(); } catch (e) {}
                setTimeout(() => { try { inp.focus(); } catch (e) {} }, 20);
            }
            hi(0);
        }
        function _prodOpenBulkActions(ev, id) {
            if (ev) {
                ev.preventDefault();
                ev.stopPropagation();
            }
            const bar = ev && ev.currentTarget && ev.currentTarget.closest ? ev.currentTarget.closest('.prod-actionbar') : null;
            const r = bar ? bar.getBoundingClientRect() : null;
            const ids = _prodTargetIds(id);
            const count = ids.length || 1;
            const plural = count !== 1;
            const command = (label, icon, act, kbd, chev, danger) =>
                '<div class="prod-mi' + (danger ? ' danger' : '') + '" data-prod-ctx="' + _calEscAttr(act) + '" data-prod-bulk-label="' + _calEscAttr(label) + '"><span class="mic">' + icon + '</span><span class="mlbl">' + _calEsc(label) + '</span>' + (kbd ? '<span class="kbd">' + _calEsc(kbd) + '</span>' : '') + (chev ? '<span class="chev">' + _prodIcon('chevR') + '</span>' : '') + '</div>';
            /* A refused row KEEPS data-prod-ctx, which looks wrong and is the
               whole point. This palette has a search box and arrow-key
               navigation, both of which iterate [data-prod-ctx]; a disabled row
               built without it stays on screen while the search hides everything
               around it, and shifts nothing in the highlight index that would
               explain why. So it stays in the index and is refused at the two
               places that act -- activate() and hi() -- instead. */
            const refused = (label, icon, act, kbd, reason, danger) =>
                '<div class="prod-mi disabled' + (danger ? ' danger' : '') + '" data-prod-ctx="' + _calEscAttr(act) + '" data-prod-disabled="bulk-' + _calEscAttr(act) + '" data-prod-bulk-label="' + _calEscAttr(label) + '" title="' + _calEscAttr(reason) + '" data-prod-tip="' + _calEscAttr(reason) + '"><span class="mic">' + icon + '</span><span class="mlbl">' + _calEsc(label) + '</span>' + (kbd ? '<span class="kbd">' + _calEsc(kbd) + '</span>' : '') + '</div>';
            const html = '<div class="prod-bulk-head"><span class="prod-bulk-chip">' + count + ' ' + (plural ? 'issues' : 'issue') + '</span><span class="prod-bulk-ask">Ask Linear <kbd>Tab</kbd></span></div><div class="prod-pop-search"><input data-prod-search placeholder="Type a command or search..."></div><div class="prod-pop-list">'
                + command('Assign to...', _prodIcon('assign'), 'assign', 'A', true)
                + command('Change status...', _prodIcon('issues'), 'status', 'S', true)
                /* Not a command. It built a searchable list of every client and
                   then refused the pick; nothing writes client_slug, so there is
                   no permission that would turn this on. */
                + refused('Move to project...', _prodIcon('project'), 'proj', 'P', PROD_PROJECT_MOVE_UNSUPPORTED)
                + command(plural ? 'Copy issue IDs' : 'Copy issue ID', _prodIcon('copy'), 'copy-id', 'C', false)
                + command('Change due date...', _prodIcon('cal'), 'due', 'D', true)
                + '<div class="prod-msep"></div>'
                /* Styled live and wired to a toast was the worst of both: the
                   identical Delete one menu away is greyed and explained, so the
                   palette read as the surface where it DOES work -- and post-flip
                   the palette really does write, on the four rows above. */
                + refused(plural ? 'Delete issues' : 'Delete issue', _prodIcon('trash'), 'delete', '', PROD_DELETE_UNSUPPORTED, true)
                + '</div>';
            const pop = _prodLayerPop(html, r ? r.left : innerWidth / 2, r ? r.top - 8 : 160);
            if (pop && r) {
                pop.setAttribute('data-prod-bulkcmd', '1');
                pop.setAttribute('data-prod-actioncmd', '1');
                pop.setAttribute('data-prod-anchor-top', String(r.top));
                const pr = pop.getBoundingClientRect();
                _prodPlacePop(pop, (innerWidth - pr.width) / 2, r.top - pr.height - 14);
            }
            if (pop) _prodWireBulkCommandMenu(pop, ids);
            return false;
        }
        function _prodSelectionBar() {
            if (_prodState.view === 'board' && _prodState.cardSel && _prodState.cardSel.size) {
                const n = _prodState.cardSel.size;
                return '<div class="prod-actionbar" data-prod-card-actionbar><span class="cnt" data-prod-card-select-count>' + n + ' selected</span>'
                    + '<button class="abtn abq" type="button" id="cb-status" onclick="return _prodOpenCardBulk(' + _jsAttrArg('pstatus') + ',event)" title="' + _prodPreviewText() + '" data-prod-tip="Status · S">' + _prodIcon('issues') + '</button>'
                    + '<button class="abtn abq" type="button" id="cb-lead" onclick="return _prodOpenCardBulk(' + _jsAttrArg('plead') + ',event)" title="' + _prodPreviewText() + '" data-prod-tip="Lead · A">' + _prodIcon('assign') + '</button>'
                    + '<button class="abtn abq" type="button" id="cb-target" onclick="return _prodOpenCardBulk(' + _jsAttrArg('ptarget') + ',event)" title="' + _prodPreviewText() + '" data-prod-tip="Target · ⇧D">' + _prodIcon('cal') + '</button>'
                    + '<button class="ax" type="button" id="cb-clear" onclick="_prodState.cardSel.clear(); _prodState.cardAnchor=' + _jsAttrArg('') + '; _prodState.focusCard=' + _jsAttrArg('') + '; _prodRender();" data-prod-tip="Clear · Esc">×</button></div>';
            }
            const n = _prodState.selected ? _prodState.selected.size : 0;
            if (!n) return '';
            const first = Array.from(_prodState.selected)[0] || '';
            return '<div class="prod-actionbar" data-prod-actionbar><span class="cnt" data-prod-select-count>' + n + ' selected</span>'
                /* This said "Preview - read-only" over a menu whose Assign,
                   Change status and Change due date rows all write for real
                   post-flip. It labelled the whole surface by its most-refused
                   row; each row now carries its own answer instead. */
                + '<button class="abtn" type="button" id="prodBulkActions" onclick="return _prodOpenBulkActions(event,' + _jsAttrArg(first) + ')" title="Bulk actions for the selected issues"><span style="font-size:13px">⌘</span> Actions</button>'
                + '<button class="ax" type="button" id="prodBulkClear" onclick="_prodState.selected.clear(); _prodState.selAnchor=' + _jsAttrArg('') + '; _prodState.focusRow=' + _jsAttrArg('') + '; _prodState.hoverRow=' + _jsAttrArg('') + '; _prodRender();" data-prod-tip="Clear · Esc">×</button></div>';
        }
        /* FIRST SCREEN FIRST. Measured 2026-09-23: building the list's markup
           cost ~400 ms (6.7 MB of HTML for ~1,570 rows) before a single row
           could be seen, on every load and every switch into the tab. The
           first paint now builds only what fits on screen, and the rest is
           appended in order, a chunk per task, so the finished list is the
           same markup in the same order.

           Only the first paint of the list: a render that already has rows on
           screen, a restored scroll offset or a keyboard focus row builds
           everything at once, exactly as before, because each of those needs
           rows that may be below the cut. Any render bumps the sequence, so a
           fill still running for a replaced list stops instead of appending to
           a list that is no longer there. */
        let _prodListRowBudget = Infinity;
        let _prodListDeferred = [];
        let _prodListFillSeq = 0;
        const PROD_LIST_FILL_CHUNK = 200;
        /* Measured 2026-09-23 at 1440x950: every .prod-row is 44 px tall (group
           headers 30 px). There are no rows on screen to measure at the first
           paint, which is the only time this is asked, so the measured height
           is a constant. Twice a screenful covers group headers and a fast
           first scroll; the floor also covers a height that reads 0. */
        const PROD_LIST_ROW_PX = 44;
        function _prodFirstScreenRows() {
            const screen = Number(window.innerHeight) || 0;
            if (screen <= 0) return 60;
            return Math.min(150, Math.max(60, Math.ceil(screen / PROD_LIST_ROW_PX) * 2));
        }
        function _prodListFill(list, parts) {
            const seq = _prodListFillSeq;
            let at = 0;
            const step = () => {
                if (seq !== _prodListFillSeq || !list.isConnected) return;
                let html = '';
                let built = 0;
                while (at < parts.length && built < PROD_LIST_FILL_CHUNK) {
                    const part = parts[at++];
                    if (typeof part === 'string') html += part;
                    else { html += _prodRow(part); built++; }
                }
                list.insertAdjacentHTML('beforeend', html);
                if (at < parts.length) setTimeout(step, 0);
            };
            // After the frame that shows the first screen, not before it. A
            // hidden tab gets no frames, so it goes straight to a task.
            if (document.hidden || typeof requestAnimationFrame !== 'function') setTimeout(step, 0);
            else requestAnimationFrame(() => setTimeout(step, 0));
        }
        // PORT-DELTA: renderList consumes _prodAdapter live rows and preserves host type scale/classes.
        function _prodList() {
            const rows = _prodIssueRows();
            if (!rows.length) {
                let msg = 'No issues here yet.';
                // F37: an unverified or off-roster session must say so instead
                // of showing an "empty personal queue" that looks like real data.
                const myGate = _prodState.view === 'my' ? _prodMyQueueUnavailableText() : '';
                // The cached first paint deliberately carries no completed
                // work, so on the tab that shows it an empty list is this
                // snapshot's silence, not an answer. Saying "no issues" here
                // would be the same lie F37 exists to prevent, one source
                // further back.
                const historyPending = _prodState.cachePartial && _prodState.tab === 'all';
                if (historyPending && !myGate) msg = 'Loading completed work...';
                else if (myGate) msg = myGate;
                else if (_prodState.filters && _prodState.filters.length) msg = 'No issues match your filters.';
                else if (_prodState.view === 'my') msg = 'No issues assigned to you.';
                else if (_prodState.tab === 'backlog') msg = 'Nothing in the backlog.';
                else if (_prodState.tab === 'active') msg = 'No active issues.';
                const emptyHTML = '<div class="prod-empty-state" data-prod-empty-state><span class="es-ico">' + (_prodState.view === 'my' ? _prodIcon('issues') : _prodIcon('issues')) + '</span><span>' + _calEsc(msg) + '</span>' + ((_prodState.filters || []).length ? '<button class="es-clear" type="button" onclick="_prodClearFilters()">Clear filters</button>' : '') + '</div>';
                // Only wrap when there is actually a notice to carry: prod-content
                // is a flex row, so the empty state must stay the single child,
                // and the unwrapped markup is what every pixel run measures.
                const emptyNotice = _prodDeepLinkNoticeHTML();
                return emptyNotice
                    ? '<div class="prod-listwrap" tabindex="0" aria-label="Issues list">' + emptyNotice + emptyHTML + '</div>'
                    : emptyHTML;
            }
            const selected = _prodState.selected || new Set();
            /* First paint builds a screenful; the rest is queued IN ORDER --
               the rows past the cut and every later group header -- for
               _prodListFill to append. Every other render has an infinite
               budget, queues nothing, and produces the same markup as before. */
            let budget = _prodListRowBudget;
            const deferred = [];
            _prodListDeferred = deferred;
            return '<div class="prod-listwrap" tabindex="0" aria-label="Issues list">' + _prodDeepLinkNoticeHTML() + _prodGroupsFor(rows).map(group => {
                const items = group.items || [];
                const collapsed = _prodState.collapsed.has(group.key);
                const selectedCount = items.filter(i => selected.has(i.id)).length;
                const checkClass = selectedCount === items.length && items.length ? ' on' : selectedCount ? ' partial' : '';
                const projectNav = (_prodState.groupBy || 'status') === 'client'
                    && group.key && group.key !== '_'
                    && group.key !== PROD_ATTRIBUTION_NEEDS
                    && group.key !== PROD_ATTRIBUTION_CONFLICT;
                const title = projectNav
                    ? '<span class="prod-group-title navp" data-prod-project="' + _calEscAttr(group.key) + '" data-prod-tip="Open project" onclick="event.stopPropagation(); _prodOpenProject(' + _jsAttrArg(group.key) + ')">' + _calEsc(group.title) + '</span>'
                    : '<span class="prod-group-title">' + _calEsc(group.title) + '</span>';
                const head = '<div class="prod-group' + (collapsed ? ' collapsed' : '') + '" data-prod-group="' + _calEscAttr(group.key) + '" onclick="_prodToggleGroup(' + _jsAttrArg(group.key) + ')"><span class="prod-group-chev" data-prod-group-toggle="' + _calEscAttr(group.key) + '">' + _prodIcon('chevD') + '</span><span class="prod-group-check' + checkClass + '" data-prod-group-check="' + _calEscAttr(group.key) + '" onclick="event.stopPropagation(); return _prodGuardGroupSelection(' + _jsAttrArg(group.key) + ')" data-prod-tip="' + _calEscAttr(PROD_GROUP_SELECT_UNSUPPORTED) + '"></span><span class="prod-group-ico prod-status">' + group.icon + '</span>' + title + '<span class="prod-group-count">' + items.length + '</span><span class="prod-spacer"></span></div>';
                const shown = collapsed ? [] : items;
                if (deferred.length || (budget <= 0 && shown.length)) {
                    deferred.push(head, ...shown);
                    return '';
                }
                const now = shown.length <= budget ? shown : shown.slice(0, budget);
                budget -= now.length;
                if (now.length < shown.length) deferred.push(...shown.slice(now.length));
                return head + now.map(_prodRow).join('');
            }).join('') + '</div>' + _prodSelectionBar();
        }
        // PORT-DELTA: rowHTML uses live ids/displayIds and read-only picker hooks.
        function _prodRow(d) {
            const assignee = _prodMember(d.assignee);
            const parent = d.parent ? _prodIssue(d.parent) : null;
            const sub = _prodSubProgress(d);
            const isHierarchyParent = !!d.isHierarchyParent;
            const childCount = sub ? sub.total : 0;
            const selected = _prodState.selected && _prodState.selected.has(d.id);
            const focused = _prodState.focusRow === d.id;
            const assigneeTip = assignee ? ('Assignee: ' + assignee.name) : 'Unassigned';
            const dueWriteAttrs = _prodWriteGateAttrs(d, 'due', d.due
                ? { info: 'Due ' + _prodFmtDateFull(d.dueRaw) + _prodRowOverdueText(d), tip: 'Change due date · ⇧D' }
                : { tip: 'Set due date|⇧D' });
            const assigneeWriteAttrs = _prodWriteGateAttrs(d, 'assignee', { title: assignee ? assignee.name : 'Unassigned', info: assigneeTip, tip: 'Assign · A' });
            return '<div class="prod-row' + (_prodState.openId === d.id ? ' active' : '') + (selected ? ' selected' : '') + (focused ? ' kfocus' : '') + '" data-prod-row="' + _calEscAttr(d.id) + '" data-prod-team="' + _calEscAttr(d.team || '') + '" data-prod-status="' + _calEscAttr(d.status || '') + '" data-prod-client="' + _calEscAttr(d.project || '') + '" data-prod-attribution-state="' + _calEscAttr(d.attribution && d.attribution.state || '') + '" data-prod-hierarchy-parent="' + (isHierarchyParent ? '1' : '0') + '" data-prod-child-count="' + childCount + '" onclick="return _prodRowClick(event,' + _jsAttrArg(d.id) + ')" onmousemove="_prodSetFocusRow(' + _jsAttrArg(d.id) + ',false)" oncontextmenu="return _prodOpenContextMenu(event,' + _jsAttrArg('issue') + ',' + _jsAttrArg(d.id) + ')">'
                + '<span class="prod-check' + (selected ? ' on' : '') + '" data-prod-row-check="' + _calEscAttr(d.id) + '" onclick="event.stopPropagation(); _prodToggleRowSelection(' + _jsAttrArg(d.id) + ', false, event)" aria-hidden="true"></span>'
                + _prodIssueIdHTML(d)
                + _prodStatusIcon(d.status, d.id)
                + '<span class="prod-title"' + _prodTitleAttrs(parent ? (d.title || 'Untitled deliverable') + ' › ' + (parent.title || '') : (d.title || 'Untitled deliverable')) + '><b>' + _calEsc(d.title || 'Untitled deliverable') + '</b>' + (parent ? '<span class="prod-parent-title">' + _calEsc(parent.title || '') + '</span>' : '') + '</span>'
                + (sub ? '<span class="prod-subchip" data-prod-tip="' + sub.done + ' of ' + sub.total + ' sub-issues done">' + _prodStatusSVG(sub.done === sub.total && sub.total > 0 ? 'approved' : 'todo') + sub.done + '/' + sub.total + '</span>' : '')
                + '<span class="prod-spacer"></span>' + _prodIssueProjectChipHTML(d)
                + (d.due ? '<span class="prod-due' + (_prodRowOverdue(d) ? ' over' : '') + '"' + dueWriteAttrs + ' onclick="return _prodOpenDueMenu(event,' + _jsAttrArg(d.id) + ')">' + _prodIcon('cal') + _calEsc(d.due) + '</span>' : '<span class="prod-due optional"' + dueWriteAttrs + ' onclick="return _prodOpenDueMenu(event,' + _jsAttrArg(d.id) + ')">' + _prodIcon('cal') + '</span>')
                + '<span class="prod-assign-hot" data-prod-assign="' + _calEscAttr(d.id) + '"' + assigneeWriteAttrs + ' onclick="return _prodOpenAssignMenu(event,' + _jsAttrArg(d.id) + ')">' + _prodAvatar(assignee, 18) + '</span>'
                + (d.created ? '<span class="prod-created" data-prod-tip="Created ' + _calEscAttr(_prodFmtDateFull(d.createdRaw)) + '">' + _calEsc(d.created) + '</span>' : '<span class="prod-created"></span>')
                + '</div>';
        }
        function _prodProjectStatusIcon(status) {
            status = _prodBoardStatus(status);
            const color = status === 'backlog' ? '#d9863a' : status === 'prog' ? '#e0b83a' : status === 'completed' ? '#5e6ad2' : status === 'canceled' ? '#8a8f98' : '#a5a6ab';
            const extra = status === 'prog' ? '<circle cx="7" cy="7" r="2.4" fill="' + color + '"/>'
                : status === 'completed' ? '<path d="M4.6 7.1 6.2 8.7 9.4 5.3" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
                : status === 'paused' ? '<rect x="5.4" y="5" width="1.4" height="4" rx=".6" fill="' + color + '"/><rect x="7.6" y="5" width="1.4" height="4" rx=".6" fill="' + color + '"/>'
                : status === 'canceled' ? '<path d="M5.4 5.4 8.6 8.6M8.6 5.4 5.4 8.6" stroke="' + color + '" stroke-width="1.4" stroke-linecap="round"/>'
                : '';
            const dash = status === 'backlog' ? ' stroke-dasharray="1.65 1.35"' : '';
            return '<svg width="16" height="16" viewBox="-1 -1 16 16" aria-hidden="true"><path d="M2.95778 3.02069L5.70777 1.36023C6.50244 0.88041 7.49756 0.88041 8.29223 1.36024L11.0422 3.02074C11.7918 3.47336 12.25 4.2852 12.25 5.16086V8.84803C12.25 9.7251 11.7904 10.5381 11.0388 10.9902L8.29114 12.6433C7.49693 13.1211 6.50355 13.1203 5.71011 12.6412L2.95775 10.9792C2.20815 10.5266 1.75 9.7148 1.75 8.83911V5.16082C1.75 4.28516 2.20816 3.47332 2.95778 3.02069Z" fill="none" stroke="' + color + '" stroke-width="1.4" stroke-linejoin="round"' + dash + '/>' + extra + '</svg>';
        }
        // PORT-DELTA: renderProjects reads live client cards while the read-only preview omits create/options column chrome.
        function _prodBoard() {
            const byClient = _prodBoardCardCounts();
            const filtered = !!((_prodState.filters || []).length);
            const emptyText = filtered ? 'No matching projects' : 'No projects';
            const columns = PROD_BOARD_ORDER.map(status => ({
                status,
                cards: _prodBoardCardsForStatus(status, byClient),
                collapsed: _prodState.colCollapsed.has(status)
            }));
            const visibleColumns = filtered && columns.some(col => col.cards.length) ? columns.filter(col => col.cards.length) : columns;
            return '<div class="prod-board">' + visibleColumns.map(col => {
                const status = col.status;
                const cards = col.cards;
                const collapsed = col.collapsed;
                return '<section class="prod-col' + (cards.length ? ' has-cards' : ' is-empty') + (collapsed ? ' collapsed' : '') + '" data-prod-col="' + _calEscAttr(status) + '"><div class="prod-col-head"><button class="prod-col-collapse" type="button" data-prod-pcolcollapse="' + _calEscAttr(status) + '" onclick="_prodToggleBoardColumn(' + _jsAttrArg(status) + ')" data-prod-tip="' + (collapsed ? 'Expand column' : 'Collapse column') + '">' + _prodIcon('chevD') + '</button><span class="prod-card-status" data-prod-tip="' + _calEscAttr(_prodBoardLabel(status)) + '">' + _prodProjectStatusIcon(status) + '</span><span class="prod-col-title">' + _calEsc(_prodBoardLabel(status)) + '</span><span class="prod-group-count">' + cards.length + '</span><span class="prod-spacer"></span></div>' + (collapsed ? '<div class="prod-col-rail">' + _calEsc(_prodBoardLabel(status)) + ' ' + cards.length + '</div>' : '<div class="prod-cards">'
                    + (cards.length ? cards.map(c => _prodClientCard(c, byClient.get(c.id) || 0)).join('') : '<div class="prod-empty" data-prod-board-empty="' + (filtered ? 'filtered' : 'plain') + '" style="margin:0;padding:16px;text-align:left;">' + _calEsc(emptyText) + '</div>')
                    + '</div>') + '</section>';
            }).join('') + '</div>' + _prodSelectionBar();
        }
        function _prodClientCard(c, count) {
            const lead = _prodMember(c.lead);
            const status = c.status || 'prog';
            const id = c.id || '';
            const selected = _prodState.cardSel && _prodState.cardSel.has(id);
            const focused = _prodState.focusCard === id;
            const title = c.name || c.id;
            const filtered = !!((_prodState.filters || []).length);
            const countLabel = count + (filtered ? ' matching issue' : ' issue') + (count === 1 ? '' : 's');
            // Was a hand-rolled copy of _prodTitleAttrs, threshold and all, so
            // the two drifted as one place changed. Use the helper.
            const titleAttrs = _prodTitleAttrs(title);
            const targetHtml = c.target
                ? '<span class="prod-card-target" data-prod-ptarget="' + _calEscAttr(id) + '" onclick="return _prodOpenProjectTargetPicker(event,' + _jsAttrArg(id) + ')" data-prod-tip="Target: ' + _calEscAttr(_prodFmtDateFull(c.targetRaw) || c.target) + '">' + _prodIcon('cal') + '<span>' + _calEsc(c.target) + '</span></span>'
                : '<span class="prod-card-target is-empty" data-prod-ptarget="' + _calEscAttr(id) + '" data-prod-target-empty="true" onclick="return _prodOpenProjectTargetPicker(event,' + _jsAttrArg(id) + ')" data-prod-tip="Set target" aria-label="Set target">' + _prodIcon('cal') + '</span>';
            return '<article class="prod-card pcard' + (focused ? ' pcard-kfocus' : '') + (selected ? ' pcard-sel' : '') + '" draggable="true" data-prod-client-card="' + _calEscAttr(id) + '" data-project="' + _calEscAttr(id) + '" onclick="return _prodCardClick(event,' + _jsAttrArg(id) + ')" oncontextmenu="return _prodOpenContextMenu(event,' + _jsAttrArg('client') + ',' + _jsAttrArg(id) + ')"><div class="prod-card-head"><span class="prod-card-check pcard-check' + (selected ? ' on' : '') + '" data-prod-cardcheck="' + _calEscAttr(id) + '" data-cardcheck="' + _calEscAttr(id) + '" onclick="event.stopPropagation(); _prodToggleCardSelection(' + _jsAttrArg(id) + ', !!event.shiftKey)" aria-hidden="true"></span><span class="prod-card-ico pcard-ico">' + _prodProjectGlyph(c) + '</span><span class="prod-card-title pcard-nm" data-prod-card-title="' + _calEscAttr(id) + '"' + titleAttrs + '>' + _calEsc(title) + '</span><span class="prod-card-status" data-prod-pstatus="' + _calEscAttr(id) + '" onclick="return _prodOpenProjectStatusPicker(event,' + _jsAttrArg(id) + ')" data-prod-tip="' + _calEscAttr(_prodBoardLabel(status)) + '">' + _prodProjectStatusIcon(status) + '</span><button class="prod-icon-btn" type="button" onclick="event.stopPropagation(); return _prodOpenContextMenu(event,' + _jsAttrArg('client') + ',' + _jsAttrArg(id) + ')" data-prod-tip="Options">' + _prodIcon('dots') + '</button><span class="prod-card-lead" data-prod-plead="' + _calEscAttr(id) + '" onclick="return _prodOpenProjectLeadPicker(event,' + _jsAttrArg(id) + ')" data-prod-tip="' + _calEscAttr(lead ? ('Lead: ' + lead.name) : 'No lead') + '">' + _prodAvatar(lead, 17) + '</span></div>'
                + '<div class="prod-card-meta"><span data-prod-card-count="' + _calEscAttr(id) + '">' + _calEsc(countLabel) + '</span><span class="prod-spacer"></span>' + targetHtml + '</div></article>';
        }
        function _prodAttributionChipOnlyHTML(issue) {
            const attribution = issue && issue.attribution;
            if (!attribution) return '';
            if (_prodAttributionSyncPending(issue)) {
                return '<span class="prod-chip optional prod-attribution-chip is-syncing" data-prod-attribution-chip="syncing" data-prod-tip="Created here a moment ago and still being mirrored into Linear. It becomes editable once Linear answers.">Syncing to Linear</span>';
            }
            if (attribution.state === 'resolved' && attribution.repairRequired) {
                return '<span class="prod-chip optional prod-attribution-chip is-needs" data-prod-attribution-chip="repair" data-prod-tip="The client is resolved, but its project mapping still needs repair">Mapping repair</span>';
            }
            if (attribution.state === 'provisional_child_family') {
                return '<span class="prod-chip optional prod-attribution-chip is-provisional" data-prod-attribution-chip="provisional" data-prod-tip="Provisional client inferred from one unanimous child family; repair is required">Provisional · repair</span>';
            }
            if (attribution.state === 'conflict') {
                return '<span class="prod-chip optional prod-attribution-chip is-conflict" data-prod-attribution-chip="conflict" data-prod-tip="Client attribution conflicts across this issue family">Attribution conflict</span>';
            }
            if (attribution.state === 'needs_attribution') {
                return '<span class="prod-chip optional prod-attribution-chip is-needs" data-prod-attribution-chip="needs" data-prod-tip="No active-roster client mapping could be verified">Needs attribution</span>';
            }
            return '';
        }
        function _prodIssueProjectChipHTML(issue) {
            const attribution = issue && issue.attribution;
            const project = issue && issue.project || '';
            const label = _prodDisplayClient(project);
            if (_prodAttributionSyncPending(issue)) {
                /* Name the client SyncView stored, so the card the SMM just
                   filed still reads as that client's while Linear catches up. */
                const syncLabel = _prodAttributionSyncClientLabel(issue);
                return '<span class="prod-chip optional prod-attribution-chip is-syncing" data-prod-attribution-chip="syncing" data-prod-tip="Created here a moment ago and still being mirrored into Linear. It becomes editable once Linear answers."><span class="prod-client-dot">' + _prodProjectGlyph(String(issue.storedClientSlug || '')) + '</span><span>' + _calEsc(syncLabel) + ' · syncing</span></span>';
            }
            if (!attribution || attribution.state === 'resolved') {
                return '<span class="prod-chip optional prod-chip-client" data-prod-crumbclient="' + _calEscAttr(project) + '" onclick="event.stopPropagation(); _prodOpenProject(' + _jsAttrArg(project) + ')" data-prod-tip="Project: ' + _calEscAttr(label) + '"><span class="prod-client-dot">' + _prodProjectGlyph(project) + '</span><span>' + _calEsc(label) + '</span></span>'
                    + _prodAttributionChipOnlyHTML(issue);
            }
            if (attribution.state === 'provisional_child_family') {
                return '<span class="prod-chip optional prod-attribution-chip is-provisional" data-prod-attribution-chip="provisional" data-prod-tip="Provisional client inferred from child issues; this does not open a writable project"><span class="prod-client-dot">' + _prodProjectGlyph(project) + '</span><span>' + _calEsc(label) + ' · provisional</span></span>';
            }
            return _prodAttributionChipOnlyHTML(issue);
        }
        function _prodProjectChipHTML(issue) {
            return _prodIssueProjectChipHTML(issue);
        }
        function _prodAttributionNoticeHTML(issue) {
            if (issue && issue.identityRepair && issue.identityRepair.required) {
                return '<div class="prod-attribution-notice is-conflict" data-prod-identity-repair-notice="required"><b>Linear identity repair required.</b> This saved issue is read-only so no status, description, label, due date, assignee, comment, or sub-issue write can reach the conflicting Linear issue. No second issue was created.</div>';
            }
            const attribution = issue && issue.attribution;
            if (!attribution || (attribution.state === 'resolved' && !attribution.repairRequired)) return '';
            if (_prodAttributionSyncPending(issue)) {
                return '<div class="prod-attribution-notice" data-prod-attribution-notice="syncing"><b>Syncing to Linear.</b> This card was created in SyncView and is waiting for Linear to answer, which normally takes a few seconds. It becomes editable as soon as it does; reload the tab if it stays this way.</div>';
            }
            const reason = String(attribution.reason || '').replace(/_/g, ' ');
            if (attribution.state === 'provisional_child_family') {
                return '<div class="prod-attribution-notice" data-prod-attribution-notice="provisional"><b>Provisional client attribution.</b> The active-roster client shown here is inferred from one unanimous child family. This issue is read-only until the mapping is repaired.</div>';
            }
            if (attribution.state === 'conflict') {
                return '<div class="prod-attribution-notice is-conflict" data-prod-attribution-notice="conflict"><b>Client attribution conflict.</b> This issue family is read-only and queued for repair' + (reason ? ' (' + _calEsc(reason) + ')' : '') + '.</div>';
            }
            if (attribution.state === 'needs_attribution') {
                return '<div class="prod-attribution-notice" data-prod-attribution-notice="needs"><b>Client attribution needs repair.</b> No active-roster mapping was verified; the stored client value is not being used.</div>';
            }
            return '<div class="prod-attribution-notice" data-prod-attribution-notice="repair"><b>Project mapping needs repair.</b> Client attribution is resolved, but its mapping metadata still requires review.</div>';
        }
        function _prodAttributionProjectControlHTML(issue) {
            const attribution = issue && issue.attribution;
            const project = issue && issue.project || '';
            const client = _prodClient(project);
            if (!attribution || attribution.state === 'resolved') {
                /* Not a button. Every other row in this side card is a control
                   that writes; this one never could, and rendering it
                   identically is what made a reader open a picker of every
                   client and press one. It now states the project and explains
                   itself on hover, the same shape the unresolved branch below
                   has always used. */
                return '<span class="prod-prop-btn" data-prod-prop="project" aria-disabled="true" title="' + _calEscAttr(PROD_PROJECT_MOVE_UNSUPPORTED) + '" data-prod-tip="' + _calEscAttr(PROD_PROJECT_MOVE_UNSUPPORTED) + '"><span class="prod-card-ico">' + _prodProjectGlyph(client) + '</span><span>' + _calEsc(_prodDisplayClient(project)) + '</span></span>' + _prodAttributionChipOnlyHTML(issue);
            }
            const syncing = _prodAttributionSyncPending(issue);
            const shownSlug = syncing ? String(issue.storedClientSlug || '') : project;
            const shownLabel = syncing ? _prodAttributionSyncClientLabel(issue) : _prodDisplayClient(project);
            return '<span class="prod-prop-btn" data-prod-prop="project" data-prod-attribution-project="' + _calEscAttr(syncing ? 'syncing' : attribution.state) + '" aria-disabled="true"><span class="prod-card-ico">' + _prodProjectGlyph(shownSlug) + '</span><span>' + _calEsc(shownLabel) + '</span></span>' + _prodAttributionChipOnlyHTML(issue);
        }
        /* _prodAddSubIssueButtonHTML was removed outright (not merely
           gated) -- see the note beside PROD_CREATE_CLOSED_TEXT. Sub-issue
           creation must not be reachable from Production at all, per
           CLAUDE.md's standing rule; only the content calendar creates. */
        function _prodSubIssueContextHTML(d, parent) {
            if (!parent) return '';
            const progress = _prodSubProgress(parent);
            const projectLabel = _prodDisplayClient(d.project);
            const parentTitle = (parent.title || _prodIssueLabel(parent));
            const projectContext = _prodAttributionResolved(d)
                ? '<button class="prod-context-project" type="button" onclick="_prodOpenProject(' + _jsAttrArg(d.project || '') + ')" data-prod-tip="Open project"><span class="prod-card-ico">' + _prodProjectGlyph(d.project) + '</span><span>' + _calEsc(projectLabel) + '</span></button>' + _prodAttributionChipOnlyHTML(d)
                : _prodIssueProjectChipHTML(d);
            return '<div class="prod-detail-context" data-prod-subissue-of="' + _calEscAttr(parent.id) + '"><span>Sub-issue of</span>'
                + '<button class="prod-detail-context-link" type="button" onclick="_prodOpenDeliverable(' + _jsAttrArg(parent.id) + ')" data-prod-tip="Open parent">' + _prodStatusIcon(parent.status) + '<b>' + _calEsc(_prodIssueLabel(parent)) + ' ' + _calEsc(parentTitle) + '</b></button>'
                + (progress ? '<span class="prod-subchip" data-prod-tip="' + progress.done + ' of ' + progress.total + ' sub-issues done">' + _prodStatusSVG(progress.done === progress.total && progress.total > 0 ? 'approved' : 'todo') + progress.done + '/' + progress.total + '</span>' : '')
                + '<span class="prod-spacer"></span>' + projectContext + '</div>';
        }
        function _prodSubIssueRowHTML(k) {
            const ka = _prodMember(k.assignee);
            const title = k.title || 'Untitled sub-issue';
            const selected = _prodState.selected && _prodState.selected.has(k.id);
            const assigneeTip = ka ? ('Assignee: ' + ka.name) : 'Unassigned';
            const dueWriteAttrs = _prodWriteGateAttrs(k, 'due', k.due
                ? { info: 'Due ' + _prodFmtDateFull(k.dueRaw) + _prodRowOverdueText(k) }
                : { tip: 'Set due date' });
            const assigneeWriteAttrs = _prodWriteGateAttrs(k, 'assignee', { info: assigneeTip });
            const kFile = _prodBatchFileFor(k.id, k);
            return '<div class="prod-subrow prod-subissue-row' + (selected ? ' selected' : '') + '" data-prod-subrow="' + _calEscAttr(k.id) + '" data-prod-attribution-state="' + _calEscAttr(k.attribution && k.attribution.state || '') + '" onclick="return _prodRowClick(event,' + _jsAttrArg(k.id) + ')" oncontextmenu="return _prodOpenContextMenu(event,' + _jsAttrArg('issue') + ',' + _jsAttrArg(k.id) + ')">'
                + '<span class="prod-check' + (selected ? ' on' : '') + '" data-prod-row-check="' + _calEscAttr(k.id) + '" onclick="event.stopPropagation(); _prodToggleRowSelection(' + _jsAttrArg(k.id) + ', false, event)" aria-hidden="true"></span>'
                + _prodStatusIcon(k.status, k.id)
                + '<span class="prod-title"' + _prodTitleAttrs(title) + '><b>' + _calEsc(title) + '</b></span>'
                + '<span class="prod-spacer"></span>'
                + _prodProjectChipHTML(k)
                /* The file pill, next to the project and due-date pills the
                   owner asked it to sit beside. It is absent, never disabled,
                   when the sub-issue has no file: a control that does nothing
                   is the dead end this tab has spent a week removing. The click
                   is stopped from bubbling because the row itself opens the
                   sub-issue, and a pill that opened a different thing than the
                   one it names would be worse than no pill. */
                + (kFile
                    ? '<a class="prod-subrow-file" href="' + _calEscAttr(kFile.url) + '" target="_blank" rel="noopener noreferrer"'
                        + ' data-prod-subrow-file="' + _calEscAttr(k.id) + '"'
                        + ' data-prod-tip="' + _calEscAttr(_prodFileLinkLabel(kFile.url)
                            + (kFile.source === 'calendar_card' ? ' (from the content calendar)'
                                : kFile.source === 'samples_card' ? ' (from the samples card)' : '')) + '"'
                        + ' onclick="event.stopPropagation();">' + PROD_FILE_LINK_ICON + '</a>'
                    : '')
                + (k.due ? '<span class="prod-due' + (_prodRowOverdue(k) ? ' over' : '') + '"' + dueWriteAttrs + ' onclick="return _prodOpenDueMenu(event,' + _jsAttrArg(k.id) + ')">' + _prodIcon('cal') + _calEsc(k.due) + '</span>' : '<span class="prod-due optional"' + dueWriteAttrs + ' onclick="return _prodOpenDueMenu(event,' + _jsAttrArg(k.id) + ')">' + _prodIcon('cal') + '</span>')
                + '<span class="prod-assign-hot" data-prod-assign="' + _calEscAttr(k.id) + '"' + assigneeWriteAttrs + ' onclick="return _prodOpenAssignMenu(event,' + _jsAttrArg(k.id) + ')">' + _prodAvatar(ka, 18) + '</span></div>';
        }
        function _prodSubIssuesSectionHTML(kids) {
            // No Add-sub-issue affordance in either state: sub-issue creation
            // is not reachable from Production (CLAUDE.md standing rule) --
            // only the content calendar creates. An empty parent with no
            // kids and nothing to offer renders nothing at all.
            if (!kids.length) return '';
            return '<div class="prod-subsection" data-prod-section="subissues"><div class="prod-subhead"><span class="prod-subhead-title">' + _prodIcon('issues') + ' Sub-issues <span class="prod-group-count">' + kids.length + '</span></span></div>' + kids.map(_prodSubIssueRowHTML).join('') + '</div>';
        }
        function _prodProjectIssueRowHTML(d) {
            const assignee = _prodMember(d.assignee);
            const parent = d.parent ? _prodIssue(d.parent) : null;
            const title = d.title || 'Untitled issue';
            const selected = _prodState.selected && _prodState.selected.has(d.id);
            const assigneeTip = assignee ? ('Assignee: ' + assignee.name) : 'Unassigned';
            const dueWriteAttrs = _prodWriteGateAttrs(d, 'due', d.due
                ? { info: 'Due ' + _prodFmtDateFull(d.dueRaw) + _prodRowOverdueText(d) }
                : { tip: 'Add due date' });
            const assigneeWriteAttrs = _prodWriteGateAttrs(d, 'assignee', { info: assigneeTip });
            return '<div class="prod-subrow prod-project-issue-row' + (selected ? ' selected' : '') + '" data-prod-project-issue="' + _calEscAttr(d.id) + '" data-prod-project-parent="' + _calEscAttr(d.parent || '') + '" data-prod-attribution-state="' + _calEscAttr(d.attribution && d.attribution.state || '') + '" onclick="return _prodRowClick(event,' + _jsAttrArg(d.id) + ')" oncontextmenu="return _prodOpenContextMenu(event,' + _jsAttrArg('issue') + ',' + _jsAttrArg(d.id) + ')">'
                + '<span class="prod-check' + (selected ? ' on' : '') + '" data-prod-row-check="' + _calEscAttr(d.id) + '" onclick="event.stopPropagation(); _prodToggleRowSelection(' + _jsAttrArg(d.id) + ', false, event)" aria-hidden="true"></span>'
                + _prodStatusIcon(d.status, d.id)
                + _prodIssueIdHTML(d)
                + '<span class="prod-title prod-project-issue-title"' + _prodTitleAttrs(parent ? title + ' › ' + (parent.title || '') : title) + '><b>' + _calEsc(title) + '</b>' + (parent ? '<span class="prod-parent-title">' + _calEsc(parent.title || '') + '</span>' : '') + '</span>'
                + _prodAttributionChipOnlyHTML(d) + '<span class="prod-spacer"></span>'
                + (d.due ? '<span class="prod-due' + (_prodRowOverdue(d) ? ' over' : '') + '"' + dueWriteAttrs + ' onclick="return _prodOpenDueMenu(event,' + _jsAttrArg(d.id) + ')">' + _prodIcon('cal') + _calEsc(d.due) + '</span>' : '<span class="prod-due optional" data-prod-empty-due="label"' + dueWriteAttrs + ' onclick="return _prodOpenDueMenu(event,' + _jsAttrArg(d.id) + ')">' + _prodIcon('cal') + '<span>Add date</span></span>')
                + '<span class="prod-assign-hot" data-prod-assign="' + _calEscAttr(d.id) + '"' + assigneeWriteAttrs + ' onclick="return _prodOpenAssignMenu(event,' + _jsAttrArg(d.id) + ')">' + _prodAvatar(assignee, 18) + '</span>'
                + (d.created ? '<span class="prod-created optional" data-prod-tip="Created ' + _calEscAttr(_prodFmtDateFull(d.createdRaw)) + '">' + _calEsc(d.created) + '</span>' : '<span class="prod-created optional"></span>') + '</div>';
        }
        function _prodProjectGroupHTML(group) {
            const items = group.items || [];
            const collapsed = _prodState.collapsed.has(group.key);
            return '<div class="prod-group prod-project-group' + (collapsed ? ' collapsed' : '') + '" data-prod-project-group="' + _calEscAttr(group.key) + '" data-prod-group="' + _calEscAttr(group.key) + '" onclick="_prodToggleGroup(' + _jsAttrArg(group.key) + ')"><span class="prod-group-chev" data-prod-group-toggle="' + _calEscAttr(group.key) + '">' + _prodIcon('chevD') + '</span><span class="prod-group-ico prod-status">' + group.icon + '</span><span class="prod-group-title">' + _calEsc(group.title) + '</span><span class="prod-group-count">' + items.length + '</span><span class="prod-spacer"></span></div>'
                + (collapsed ? '' : items.map(_prodProjectIssueRowHTML).join(''));
        }
        function _prodProjectRowsHTML(rows, empty, allCount, projectName) {
            if (!rows.length) {
                if ((_prodState.filters || []).length && Number(allCount || 0) > 0) {
                    return '<div class="prod-inline-empty" data-prod-project-filter-empty="1"><span class="prod-inline-empty-title">No issues match your filters.</span><span>Clear filters to see ' + _calEsc(String(allCount)) + ' issue' + (Number(allCount) === 1 ? '' : 's') + ' for ' + _calEsc(projectName || 'this project') + '.</span><br><button class="prod-inline-empty-action" type="button" onclick="_prodClearFilters()">Clear filters</button></div>';
                }
                return '<div class="prod-inline-empty" data-prod-project-empty="1">' + _calEsc(empty) + '</div>';
            }
            return '<div class="prod-project-groups" data-prod-project-groups="' + _calEscAttr(_prodState.groupBy || 'status') + '">' + _prodGroupsFor(rows).map(_prodProjectGroupHTML).join('') + '</div>';
        }
        /* THE PANE'S ANSWER WHEN THE ROW SET IS INCOMPLETE, shared by all three
           detail panes so they cannot drift apart the way they already did.

           Two incomplete states, two different sentences, and the difference is
           the whole of OPEN_REPAIRS 108. PENDING means the tail is still coming
           and the row may be one moment away, so a skeleton is the truth. FAILED
           means the tail ran and threw: this tab does not know whether the row
           exists, and saying "not found" would state something it cannot know --
           the class item 87 spent a week removing. It offers a retry instead,
           because a retry is the only thing that changes the answer.

           Returns '' when the row set is complete, so the caller falls through
           to its own genuine not-found copy. */
        /* IS THE ROW SET ACTUALLY COMPLETE?

           `terminalTailPending` answers "is a tail running", which is NOT the
           same question and was the whole of the 2026-09-03 report: refresh a
           link to a posted row and you got skeleton, then "Deliverable not
           found", then skeleton again, then the row. Four states for one wait.

           The middle one is this predicate's absence. The pending flag is
           raised by the phase-one SUCCESS path, so for the entire live read
           before it -- and for the cached first paint before that, which never
           holds a terminal row because `_prodCacheWrite` runs on the phase-one
           set -- pending was false, failed was false, and a row that had simply
           not been fetched yet was reported missing. Then phase one landed, the
           flag went up, and the pane went back to a skeleton it should never
           have left.

           A tail that has LANDED is the only thing that makes absence mean
           anything, so that is what gets asked. Before the first one lands the
           answer is "not yet" from the first frame onward, which is one
           continuous wait instead of four. */
        function _prodRowSetComplete() {
            return !!_prodState.terminalTailLoadedAt
                && !_prodState.terminalTailPending
                && !_prodState.terminalTailFailed;
        }
        /* SHIMMER THAT DOES NOT RESTART. `_prodRender` replaces the whole of
           prodRoot, so every repaint during the wait builds a brand-new
           skeleton node and CSS starts its animation over -- the owner's
           "sometimes I have a double animation", which is really the same
           animation seen twice from the top.

           A negative delay taken from the document clock puts each new node in
           at the phase the old one was leaving at, so a replaced skeleton
           continues rather than jumps. `performance.now()` is zero at
           navigation start, which is also when the static boot skeleton in the
           markup starts its own cycle, so the two agree without being told
           about each other. */
        const PROD_SKELETON_PERIOD_MS = 1350;   // keep in sync with .prod-skeleton
        function _prodSkeletonPhaseStyle() {
            let t = 0;
            try { t = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0; } catch (e) { t = 0; }
            const phase = ((t % PROD_SKELETON_PERIOD_MS) + PROD_SKELETON_PERIOD_MS) % PROD_SKELETON_PERIOD_MS;
            return 'animation-delay:-' + phase.toFixed(0) + 'ms;';
        }
        function _prodIncompletePaneHTML(noun) {
            /* FAILED IS ASKED FIRST, because a tail that ran and threw is a
               state this tab knows something about, and the incomplete branch
               below would otherwise swallow it -- nothing ever stamped
               `terminalTailLoadedAt`, so it reads as incomplete forever and the
               reader waits on a skeleton for a read that is not running. */
            if (_prodState.terminalTailFailed) {
                return '<div class="prod-empty" data-prod-detail-unavailable="1" role="status">'
                    + '<div>This ' + _calEsc(noun) + ' could not be loaded \u2014 the read that finishes the list failed.</div>'
                    + '<div class="prod-empty-sub">It has not been checked for, so it may well be here. Refresh to try again.</div>'
                    + '<button type="button" class="prod-btn" onclick="return _prodRefresh({})">Refresh</button></div>';
            }
            if (!_prodRowSetComplete()) {
                /* A SKELETON, NOT A SENTENCE. The first version of this put one
                   thin bar above the words "Loading this item…", which the owner
                   saw on a real card and disliked on sight: a line of prose in
                   the middle of an empty pane reads as an error, and it replaced
                   a shimmer that used to say the same thing without saying
                   anything. It also arrives on EVERY terminal deep link, so it
                   is not a rare state and does not get to be ugly.

                   Shaped like the detail it is standing in for -- title, meta
                   row, body lines -- so the pane does not visibly change layout
                   when the real thing lands. `aria-busy` carries the meaning
                   for a screen reader, which is where the sentence belonged. */
                const phase = _prodSkeletonPhaseStyle();
                const bar = (w, h, mt) => '<span class="prod-skeleton" style="display:block;height:' + h
                    + 'px;width:' + w + ';margin-top:' + mt + 'px;' + phase + '"></span>';
                return '<div class="prod-detail-skeleton" data-prod-detail-settling="1" role="status" aria-busy="true"'
                    + ' aria-label="Loading this ' + _calEscAttr(noun) + '">'
                    + bar('42%', 13, 0) + bar('68%', 24, 14)
                    + bar('30%', 12, 18) + bar('96%', 11, 22) + bar('88%', 11, 10)
                    + bar('93%', 11, 10) + bar('61%', 11, 10)
                    + '</div>';
            }
            return '';
        }
        // PORT-DELTA: renderDetail uses native comments and team-authority-gated writes.
        function _prodDetail() {
            const d = _prodIssue(_prodState.openId);
            /* NOT FOUND vs NOT LOADED YET -- the same distinction the deep-link
               fallback learned, at the second exit from the same room.

               The boot read is two-phase: phase one holds nothing in
               PROD_CACHE_TERMINAL, and _prodLoadTerminalTail fetches the
               approved / posted / archived / canceled / duplicate rows behind
               it. Gating the eviction on `terminalTailPending` stopped the
               reader being thrown back to the list mid-load, which is what it
               was asked to do -- and left them here instead, on a blank pane
               reading "Deliverable not found" about a row that arrives a moment
               later. Owner report, minutes after that fix shipped, and it is
               the fix's own doing: before it, this state was unreachable
               because the eviction had already changed the view.

               Fixing one exit from a room with two is how a bug appears to move
               rather than close. While the tail is pending an unresolved id
               means NOT YET here too, and says so; once it lands, a genuinely
               absent row still reports absent. */
            if (!d) {
                const incomplete = _prodIncompletePaneHTML('item');
                if (incomplete) return incomplete;
            }
            if (!d) return '<div class="prod-empty">Deliverable not found.</div>';
            _prodLoadEventsFor(d.id);
            const assignee = _prodMember(d.assignee);
            const kids = _prodChildrenOf(d.id);
            const parent = d.parent ? _prodIssue(d.parent) : null;
            const isHierarchyParent = !!d.isHierarchyParent;
            const batchAssetSource = _prodBatchAssetSource(d);
            const subSection = d.parent ? '' : _prodSubIssuesSectionHTML(kids);
            /* A REAL hierarchy parent is a container too (owner, 2026-09-05:
               "I don't think we need a deliverable file row on the parent
               issue asset grid because there is no deliverable file for
               that"). The videos are the sub-issues, and the file belongs on
               each of them; an empty slot on the parent was a prompt to attach
               one in the wrong place. The Linear parent IS imported as a
               deliverable row, though, so it can carry a file_url from before
               this rule -- and a value that exists is never hidden. The row is
               dropped only while it has nothing to show. The synthetic batch
               parent keeps its own branch below, which decides the same three
               slots for a different reason and adds read-only. */
            const parentAsset = isHierarchyParent && d.syntheticBatchParent !== true
                ? _prodAssetState(d.id, d).assets.deliverable_file
                : null;
            const parentSlots = isHierarchyParent && d.syntheticBatchParent !== true
                ? ['filming_plan', 'raw_footage', 'delivery_folder']
                    .concat(String(parentAsset && parentAsset.url || '').trim() ? ['deliverable_file'] : [])
                : null;
            return '<div class="prod-detail" data-prod-detail="' + _calEscAttr(d.id) + '" data-prod-attribution-state="' + _calEscAttr(d.attribution && d.attribution.state || '') + '" data-prod-hierarchy-parent="' + (isHierarchyParent ? '1' : '0') + '" oncontextmenu="return _prodOpenContextMenu(event,' + _jsAttrArg('issue') + ',' + _jsAttrArg(d.id) + ')"><div class="prod-detail-main"><div class="prod-detail-inner">'
                + '<div class="prod-detail-id">' + _calEsc(_prodIssueDisplayLabel(d)) + '</div>'
                + _prodSubIssueContextHTML(d, parent)
                + _prodDetailTitleHtml(d)
                + _prodAttributionNoticeHTML(d)
                + _prodDescriptionPanelHTML(d)
                /* A synthesized batch parent is a container, not a deliverable:
                   deliverable_file is hardcoded empty for it by construction and
                   can never be anything else, so the row was pure noise. The
                   other three are genuinely post-level, and a child of the same
                   batch can actually READ them (see _prodBatchAssetSource), so
                   the panel renders against that child and shows the real Drive
                   and Frame links instead of a hedge about who may look. With
                   no readable child it falls back to the parent row, which
                   still says Unavailable rather than inventing Missing. Same
                   borrow the batch detail view already makes. */
                + _prodAssetsPanelHTML(batchAssetSource || d, d.syntheticBatchParent === true
                    /* Read-only only when there is nobody to ask. With a
                       readable child the two folder links are as editable here
                       as on any sub-issue -- they are one batch row, and the
                       parent is where a reader looks for what belongs to the
                       whole post. The filming plan carries no write operation,
                       so it stays uneditable on every surface without needing
                       to be named here. */
                    ? { slots: ['filming_plan', 'raw_footage', 'delivery_folder'], readOnly: !batchAssetSource }
                    : parentSlots ? { slots: parentSlots } : undefined)
                + subSection
                + '<div class="prod-activity"><div class="prod-activity-head"><span class="prod-activity-title">Feedback &amp; tweaks</span><span class="prod-spacer"></span></div>' + _prodComments.render(d.id) + _prodComposerHTML(d) + '</div>'
                + '</div></div><aside class="prod-right">' + _prodProps(d, parent, assignee, d.file || '') + '</aside></div>'
                + _prodSelectionBar();
        }
        function _prodProjectDetail() {
            const c = _prodClient(_prodState.openProjectId);
            /* The sibling panes were never given this guard, and the fallback
               defers openProjectId and openBatchId exactly as it defers openId
               -- so a deep link at either one spent the whole tail window being
               told it did not exist. Found by audit, not by a reader, which is
               the only reason it is cheap. */
            if (!c) return _prodIncompletePaneHTML('project') || '<div class="prod-empty">Project not found.</div>';
            const lead = _prodMember(c.lead);
            const projectTeam = _prodProjectScopeTeam(c);
            const allRows = _prodProjectAllRows(c);
            const rows = _prodProjectRows(c);
            const empty = (_prodState.filters || []).length ? 'No issues match your filters.' : 'No issues in this view yet.';
            const rowHTML = _prodProjectRowsHTML(rows, empty, allRows.length, c.name || c.id);
            const filteredCount = (_prodState.filters || []).length && allRows.length && rows.length !== allRows.length;
            const issueCountLabel = filteredCount ? rows.length + ' of ' + allRows.length : String(rows.length);
            const side = _prodState.projectDetailsOpen === false ? '' : '<aside class="prod-right"><div class="prod-props">'
                + '<div class="prod-side-card" data-prod-detail-card="properties"><div class="prod-side-card-head"><span>Properties</span></div>'
                + '<div class="prod-side-row"><button type="button" class="prod-prop-btn" data-prod-pstatus="' + _calEscAttr(c.id) + '" data-pstatus="' + _calEscAttr(c.id) + '" data-prod-tip="Status: ' + _calEscAttr(_prodBoardLabel(c.status)) + '" onclick="return _prodOpenProjectStatusPicker(event,' + _jsAttrArg(c.id) + ')">' + _prodProjectStatusIcon(c.status) + '<span>' + _calEsc(_prodBoardLabel(c.status)) + '</span></button></div>'
                + '<div class="prod-side-row"><button type="button" class="prod-prop-btn" data-prod-plead="' + _calEscAttr(c.id) + '" data-plead="' + _calEscAttr(c.id) + '" data-prod-tip="' + _calEscAttr(lead ? ('Lead: ' + lead.name) : 'No lead') + '" onclick="return _prodOpenProjectLeadPicker(event,' + _jsAttrArg(c.id) + ')">' + _prodAvatar(lead, 18) + '<span class="' + (lead ? '' : 'muted') + '">' + _calEsc(lead ? lead.name : 'No lead') + '</span></button></div>'
                + '<div class="prod-side-row"><button type="button" class="prod-prop-btn" data-prod-ptarget="' + _calEscAttr(c.id) + '" data-ptarget="' + _calEscAttr(c.id) + '" data-prod-tip="' + _calEscAttr(c.target ? 'Target ' + _prodFmtDateFull(c.targetRaw) : 'Target date') + '" onclick="return _prodOpenProjectTargetPicker(event,' + _jsAttrArg(c.id) + ')">' + _prodIcon('cal') + '<span class="' + (c.target ? '' : 'muted') + '">' + _calEsc(c.target || 'No target') + '</span></button></div>'
                + '</div>'
                + '<div class="prod-side-card" data-prod-detail-card="project-issues"><div class="prod-side-card-head"><span>Issues</span></div><div class="prod-side-row muted">' + _calEsc(String(rows.length)) + ' issue' + (rows.length === 1 ? '' : 's') + '</div></div></div></aside>';
            return '<div class="prod-detail prod-project-detail" data-prod-project-detail="' + _calEscAttr(c.id) + '"><div class="prod-detail-main"><div class="prod-detail-inner">'
                + '<div class="prod-detail-id">' + _calEsc(_prodTeamLabel(projectTeam)) + ' project</div><h1 class="prod-detail-title">' + _calEsc(c.name || c.id) + '</h1>'
                + '<div class="prod-desc">' + _prodDescriptionHTML(c.desc, !!c.descLoaded, 'No project description.', false) + '</div>'
                + '<div class="prod-subsection"><div class="prod-subhead">' + _prodIcon('issues') + ' Issues <span class="prod-group-count">' + _calEsc(issueCountLabel) + '</span></div>'
                + rowHTML + '</div></div></div>' + side + '</div>' + _prodSelectionBar();
        }
        function _prodBatchDetail() {
            const batch = _prodBatch(_prodState.openBatchId);
            if (!batch) return _prodIncompletePaneHTML('batch') || '<div class="prod-empty">Batch not found.</div>';
            const rows = _prodBatchRows(batch.id);
            // The panel's data source is chosen by ATTRIBUTION eligibility, not
            // by display position -- rows[0] is now always the numerically
            // first deliverable, and that row is not guaranteed to be the one
            // with a usable client scope (Codex, PR #1467).
            const assetRow = _prodAssetEligibleRow(rows) || rows[0];
            const descField = _prodHasOwn(batch, 'description') ? 'description' : _prodHasOwn(batch, 'desc') ? 'desc' : '';
            const desc = descField ? (batch[descField] == null ? '' : batch[descField]) : '';
            /* An absent column means "not read yet" and paints a skeleton, which
               is honest only while a read is actually coming. Once the read has
               failed, the same skeleton becomes a promise the view cannot keep,
               so it says so instead. */
            const descReadFailed = !descField && _prodState.batchDescriptionReads.get(String(batch.id || '')) === 'error';
            return '<div class="prod-detail" data-prod-batch-detail="' + _calEscAttr(batch.id) + '" oncontextmenu="return _prodOpenContextMenu(event,' + _jsAttrArg('batch') + ',' + _jsAttrArg(batch.id) + ')"><div class="prod-detail-main"><div class="prod-detail-inner"><div class="prod-detail-id">' + _calEsc(batch.team || 'mixed') + ' batch</div><h1 class="prod-detail-title">' + _calEsc(batch.name || 'Untitled batch') + '</h1>'
                + '<div class="prod-desc">' + _prodDescriptionHTML(desc, !!descField || descReadFailed, descReadFailed ? 'Description could not load.' : 'No batch description.', false) + '</div>'
                + (assetRow ? _prodAssetsPanelHTML(assetRow, { slots: ['filming_plan','raw_footage','delivery_folder'], readOnly: true }) : '')
                + '<div class="prod-subsection"><div class="prod-subhead">Deliverables <span class="prod-group-count">' + rows.length + '</span></div>' + rows.map(_prodSubIssueRowHTML).join('') + '</div></div></div><aside class="prod-right"><div class="prod-props">'
                + '<div class="prod-prop"><span class="prod-prop-label">Client</span><span>' + _calEsc(_prodDisplayClient(batch.client_slug)) + '</span></div>'
                + '<div class="prod-prop"><span class="prod-prop-label">Team</span><span>' + _calEsc(_prodTeamLabel(batch.team)) + '</span></div>'
                + '<div class="prod-prop"><span class="prod-prop-label">Status</span><span>' + _calEsc(batch.status || 'active') + '</span></div>'
                + '<div class="prod-prop"><span class="prod-prop-label">Updated</span><span data-prod-tip="Updated ' + _calEscAttr(_prodFmtDateFull(batch.updated_at)) + '">' + _calEsc(_prodFmtDate(batch.updated_at)) + '</span></div>'
                + '</div></aside></div>';
        }
        /* WHO RUNS THIS CLIENT.

           The roster lives in a Google Sheet the owner edits, and a nightly n8n
           job mirrors it into social_media_managers. So this reads the mirror
           rather than keeping a second copy here: edit the sheet, and this line
           follows within a day. Nothing to maintain in the app.

           TWO THINGS THIS DELIBERATELY DOES NOT DO.

           It does not call _srpApi. That wrapper routes through
           _syncviewRequireStaffIdentity, which OPENS A SIGN-IN DIALOG when the
           viewer has no staff key -- and a passive line in a properties column
           must never be the reason a dialog appears. So it checks for an
           identity that already exists and returns silently when there is none.

           And it does not weaken the endpoint. ?action=options is Admin/SMM, and
           it stays that way; a Creative or an unsigned preview simply does not
           see this row, exactly as they do not see the rest of that endpoint.
           The alternative -- opening the table to anonymous reads -- would undo
           the F88 revocation, and a manager roster is not worth that. */
        /* Bounded, and NOT permanent. The nightly sheet sync can change an
           assignment while a tab stays open, so a directory cached forever
           would make "the line follows within a day" quietly require a reload.
           A failure is not cached forever either: one transient 401 or 500
           would otherwise hide the row for the rest of the session. It does
           give up after PROD_SMM_MAX_FAILURES, because a key the endpoint keeps
           refusing will not start working, and retrying it every minute for an
           afternoon is just noise against the backend. */
        const PROD_SMM_TTL_MS = 5 * 60 * 1000;
        const PROD_SMM_RETRY_MS = 60 * 1000;
        const PROD_SMM_MAX_FAILURES = 3;
        let _prodSmmDir = null;
        let _prodSmmDirAt = 0;
        let _prodSmmFailures = 0;
        let _prodSmmLoading = false;
        /* The roster is Admin/SMM-only data. Sign-out and an account switch
           must drop it, or the next reader keeps seeing a protected
           client-to-manager assignment their identity could not fetch. Every
           other sensitive surface is cleared this way; this one joins them
           (see _syncviewStaffPurgeSensitiveState). */
        function _prodSmmPurgeSensitiveState() {
            _prodSmmDir = null;
            _prodSmmDirAt = 0;
            _prodSmmFailures = 0;
            _prodSmmLoading = false;
            try { _srpState.managers = []; _srpState.managersLoaded = false; } catch (e) {}
        }
        function _prodSmmDirFrom(managers) {
            const dir = new Map();
            for (const m of (Array.isArray(managers) ? managers : [])) {
                const name = String(m && m.name || '').trim();
                if (!name) continue;
                const owned = Array.isArray(m.source_clients) ? m.source_clients : [];
                for (const c of owned) {
                    /* The sheet names clients the way a person writes them; this
                       app keys them by slug. One normalizer for both sides, the
                       same one the workload uses. */
                    const key = wlNormalizeClient(c);
                    if (key && !dir.has(key)) dir.set(key, { name: name });
                }
            }
            return dir;
        }
        async function _prodLoadSmmDirectory() {
            if (_prodSmmLoading) return;
            const ttl = _prodSmmFailures ? PROD_SMM_RETRY_MS : PROD_SMM_TTL_MS;
            if (_prodSmmDir && (Date.now() - _prodSmmDirAt) < ttl) return;
            if (_prodSmmFailures >= PROD_SMM_MAX_FAILURES) return;
            /* If the roster is already in memory -- the weekly-reports page
               loads it through _srpLoadOptions -- build from that and make no
               request at all. This is not only an optimisation: the Production
               tab makes NO unprompted staff-authenticated read (descriptions
               hydrate on demand, _prodLoadBriefs is a marker), and a read that
               can 401 is a read this tab's console audit counts as a failure.
               So a request happens only when nothing has answered yet, and its
               answer is cached where the other surface will find it too. */
            if (!_prodSmmDir && _srpState.managersLoaded) {
                _prodSmmDir = _prodSmmDirFrom(_srpState.managers);
                _prodSmmDirAt = Date.now();
                return;
            }
            const ident = _syncviewStaffIdentityForHeaders();
            if (!ident || !_syncviewStaffCan('weekly-report-submit')) return;
            _prodSmmLoading = true;
            try {
                const resp = await fetch(SMM_WEEKLY_REPORTS_URL + '?action=options', {
                    headers: {
                        Accept: 'application/json',
                        apikey: CAL_SUPABASE_ANON_KEY,
                        Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY,
                        'X-Syncview-Key': ident.key
                    }
                });
                let data = null;
                try { data = await resp.json(); } catch (e) {}
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const managers = data && Array.isArray(data.managers) ? data.managers : [];
                _srpState.managers = managers;
                _srpState.managersLoaded = true;
                _prodSmmDir = _prodSmmDirFrom(managers);
                _prodSmmDirAt = Date.now();
                _prodSmmFailures = 0;
            } catch (e) {
                /* Count it and back off, rather than caching the failure as an
                   answer. An empty directory renders no row, which is the same
                   as not knowing -- but "not knowing" must not become permanent
                   on one bad response. */
                _prodSmmFailures++;
                _prodSmmDir = _prodSmmDir || new Map();
                _prodSmmDirAt = Date.now();
            }
            _prodSmmLoading = false;
            _prodRender();
        }
        function _prodSmmCardHTML(d) {
            _prodLoadSmmDirectory();
            if (!_prodSmmDir || !_prodSmmDir.size) return '';
            const project = d && d.project || '';
            /* Match on the slug, and fall back to the display name, because a
               project key and what the sheet calls the client are not always
               spelled the same. */
            const hit = _prodSmmDir.get(wlNormalizeClient(project))
                || _prodSmmDir.get(wlNormalizeClient(_prodDisplayClient(project)));
            if (!hit) return '';
            /* NO PROVENANCE LINE. It said "Sheet, synced <date>" under the
               name and the owner asked for it gone -- twice. It was added to
               make staleness legible, but the roster syncs nightly and the
               name is the answer the reader came for; a second line of
               bookkeeping under every sub-issue is noise on the surface he
               actually uses. If staleness ever needs surfacing again, surface
               it where it is actionable -- when the sync FAILS -- not on every
               card forever. */
            return '<div class="prod-side-card" data-prod-detail-card="smm"><div class="prod-side-card-head"><span>Social media manager</span></div>'
                + '<div class="prod-side-row"><span class="prod-prop-btn" data-prod-prop="smm" aria-disabled="true">'
                + _prodIcon('assign') + '<span>' + _calEsc(hit.name) + '</span></span></div></div>';
        }
        function _prodProps(d, parent, assignee, file) {
            const statusHistory = _prodStatusBreakdown((_prodState.events && _prodState.events.get ? _prodState.events.get(d.id) : null) || [], d.createdRaw);
            const sideRow = (value, cls) => '<div class="prod-side-row' + (cls ? ' ' + cls : '') + '">' + value + '</div>';
            const muted = text => '<span class="muted">' + _calEsc(text) + '</span>';
            return '<div class="prod-props">'
                + '<div class="prod-side-card" data-prod-detail-card="properties"><div class="prod-side-card-head"><span>Properties</span></div>'
                + sideRow('<button type="button" class="prod-prop-btn" data-prod-prop="status"' + _prodWriteGateAttrs(d, 'status', { info: (statusHistory ? statusHistory : 'Status: ' + _prodStatusLabel(d.status) + (_prodStatusAge(d) ? ' ' + _prodStatusAge(d) : '')) }) + ' onclick="return _prodOpenStatusMenu(event,' + _jsAttrArg(d.id) + ')">' + _prodStatusIcon(d.status) + '<span>' + _calEsc(_prodStatusLabel(d.status)) + '</span></button>')
                + sideRow('<button type="button" class="prod-prop-btn" data-prod-prop="assignee"' + _prodWriteGateAttrs(d, 'assignee', { info: assignee ? ('Assignee: ' + assignee.name) : 'Unassigned' }) + ' onclick="return _prodOpenAssignMenu(event,' + _jsAttrArg(d.id) + ')">' + _prodAvatar(assignee, 18) + '<span>' + _calEsc(assignee ? assignee.name : 'No assignee') + '</span></button>')
                + sideRow('<button type="button" class="prod-prop-btn" data-prod-prop="due"' + _prodWriteGateAttrs(d, 'due', d.due ? { info: 'Due ' + _prodFmtDateFull(d.dueRaw) + _prodRowOverdueText(d) } : { tip: 'Set due date' }) + ' onclick="return _prodOpenDueMenu(event,' + _jsAttrArg(d.id) + ')">' + _prodIcon('cal') + '<span>' + (d.due ? _calEsc(d.due) : muted('Add due date')) + '</span></button>', d.due && _prodRowOverdue(d) ? 'dueover' : '')
                + sideRow(_prodLabelsButtonHTML(d))
                + '</div>'
                + (parent ? '<div class="prod-side-card" data-prod-detail-card="parent"><div class="prod-side-card-head"><span>Parent issue</span></div><div class="prod-side-row"><button class="prod-parent-link" type="button" onclick="_prodOpenDeliverable(' + _jsAttrArg(parent.id) + ')" data-prod-tip="Open parent">' + _prodStatusIcon(parent.status) + '<span>' + _calEsc(parent.title || _prodIssueLabel(parent)) + '</span></button></div></div>' : '')
                + '<div class="prod-side-card" data-prod-detail-card="project"><div class="prod-side-card-head"><span>Project</span></div><div class="prod-side-row">' + _prodAttributionProjectControlHTML(d) + '</div></div>'
                + _prodSmmCardHTML(d)
                + '</div>';
        }
        function _prodActivity(events) {
            if (!events || !events.length) return '<div class="prod-act-empty">No activity yet.</div>';
            return events.slice(0, 12).map(e => {
                const actor = e.actor || e.role || e.source || 'system';
                const label = e.action === 'status_change'
                    ? 'changed status from ' + _prodStatusLabel(e.from_status) + ' to ' + _prodStatusLabel(e.to_status)
                    : String(e.action || 'updated').replace(/_/g, ' ');
                return '<div class="prod-act"><span>' + _prodAvatar(null, 16) + '</span><span class="prod-act-text"><b>' + _calEsc(actor) + '</b> ' + _calEsc(label) + ' <span class="prod-act-time">- ' + _calEsc(_prodFmtDate(e.ts)) + '</span></span></div>';
            }).join('');
        }
        // no-hardcoded-colors: allow-end

       async function init(clientEntryRun){
        try{
            const _clientEntryStillCurrent=()=>!_isClientLink||_syncviewClientEntryRunCurrent(clientEntryRun);
            if(!_clientEntryStillCurrent())return;
            /* Phase D: the boot router only routes while nobody has navigated
               since it started. Every await below is a window in which a tab
               click (or Back) can land first; the click wins. */
            const _bootNavEpoch=_syncviewNavEpoch;
            const _bootOwnsNav=()=>_syncviewNavEpoch===_bootNavEpoch;
            // The staff identity IS the door (2026-09-10), so this both
            // verifies and gates. Painting the cover is not enough: Codex
            // caught that in review. init() used to run on past this await, so
            // a forged stored identity plus a blocked verifier still reached
            // fetchAll() and pulled the anon-readable staff datasets in behind
            // the cover, where the responses are visible in devtools and the
            // overlay is one node removal away. Nothing loads until the server
            // has confirmed who this is.
            if (!_isClientLink) {
                const verifiedIdentity = await _syncviewStaffIdentityBoot();
                if (!verifiedIdentity && _syncviewStaffGateRequired()) {
                    // Release the boot latch so a successful sign-in on the
                    // gate can start the app that this return abandoned.
                    _syncviewAppBooted = false;
                    return;
                }
            }
            _syncviewAppBooted = true;
            const _ptoFlagReady = _isClientLink ? Promise.resolve(null) : _ptoPrimeFlag();
            // Resume any calendar-card write job a previous session left
            // unfinished (tab closed during the post-submit write window).
            // Scheduled as a delayed macrotask so it runs on EVERY boot path
            // (deep links, fast tabs, Kasper, analytics) after all top-level
            // module bindings are initialized, without blocking first paint.
            setTimeout(() => {
                if (_isClientLink || _prodEnabled()) return;
                try { _resumePendingCalCardJobs(); }
                catch (e) { console.warn('[SyncView] calendar card job resume failed:', e); }
            }, 8000);
            const qp = new URLSearchParams(svRoute.search());
            const hashRaw = decodeURIComponent(svRoute.hash().replace('#',''));
            const hashRoute = hashRaw.split('?')[0];
            // >>> SXR_BEGIN
            // Samples (Review) refresh/deep-link landing. Its own backend (no
            // analytics dependency), so route immediately and skip the analytics
            // await. Deferred to a macrotask so module bindings declared later in
            // the file (sxrState / _sxrEnabled / mountSxrView) are initialized
            // first — the same TDZ guard the onboarding boot uses (see ~24716).
            // The flag is read INLINE (no SXR symbols) so this is safe even though
            // it runs before the SXR module block evaluates.
            if (!_isClientLink && (hashRaw === 'sample-reviews' || hashRaw.startsWith('sample-reviews/'))) {
                let _sxrOn = true; // GA default-ON; a storage throw leaves it on, matching _sxrEnabled() (F73)
                try { const _q = new URLSearchParams(svRoute.search()).get('sxr'); _sxrOn = (_q === '1' || _q === 'true') || (_q !== '0' && _q !== 'false' && localStorage.getItem('syncview_sxr_off') !== '1'); } catch (e) {}
                if (_sxrOn) { try { window.__sxrDeepHash = hashRaw; } catch (e) {} setTimeout(function () { try { if (_bootOwnsNav()) navTo('sample-reviews', false); } catch (e) {} }, 0); return; }
            }
            // <<< SXR_END
            let savedNav = localStorage.getItem(NAV_KEY);
            if (_isSmmWeeklyRoute(savedNav)) {
                try { localStorage.removeItem(NAV_KEY); } catch (e) {}
                savedNav = null;
            }
            const stateNav = history.state && history.state.nav;
            const stateClient = history.state && history.state.client;
            let _ptoSavedKasperSub = false;
            try { _ptoSavedKasperSub = localStorage.getItem('syncview_kasper_subtab_v1') === 'time-off'; } catch (e) {}
            if (hashRoute === 'time-off' || hashRaw === 'kasper/time-off' || savedNav === 'time-off' || stateNav === 'time-off' || (savedNav === 'kasper' && _ptoSavedKasperSub)) await _ptoFlagReady;
            const hashIsFastTab = FAST_TABS.includes(hashRaw)
                || FAST_TABS.includes(hashRoute)
                || hashRaw.startsWith('calendar/')
                || hashRaw.startsWith('samples/')
                || hashRaw.startsWith('templates/')
                // The standalone staff pages have their own APIs and checks.
                || hashRaw === 'staff-onboarding' || hashRaw === 'client-credentials';
            // DEFAULT LANDING (owner, 2026-09-28): the bare site address opens
            // Today for staff on a new visit. A refresh (history.state) still
            // returns you to the tab you were on, Analytics included; client
            // links and every explicit address are unchanged. Only harmless
            // switches may ride along in the query.
            const _bareLanding = !hashRaw && !stateNav && !stateClient && !_isClientLink
                && [...qp.keys()].every(k => BARE_LANDING_OK_PARAMS.includes(k));
            const restoreFastNav = _bareLanding ? 'today' : (_isSmmWeeklyRoute(stateNav) ? savedNav : (stateNav || savedNav));
            const fallbackFast = !hashRaw && !stateClient && RESTORABLE_FAST_TABS.includes(restoreFastNav);
            // Kasper has no analytics dependency — every sub-tab fetches its own
            // data over webhooks. So a refresh straight onto Kasper (when the tab
            // is already unlocked for this session) should mount immediately
            // instead of flashing the analytics tab + "Loading analytics…" first.
            // Kasper is admin-only: a verified (or remembered) admin mounts at once.
            const _kasperHashLanding = (hashRaw === 'kasper' || hashRaw.startsWith('kasper/'))
                && _kasperApplyAccess();
            // ?c=<client> needs allData to validate the token + render — never
            // a fast-tab refresh. history.state.client also needs allData.
            const skipAwait = !qp.get('c') && !stateClient && (hashIsFastTab || fallbackFast || _kasperHashLanding);
            // Client share link landing on the calendar tab: we only need
            // essentials (metrics for clientHistory, clients for roster resolution)
            // to mount; the analytics-heavy extras stream in afterwards so
            // the calendar paints fast.
            const isClientCalendarLink = !!(_syncviewClientEntryCapability && _syncviewClientEntryCapability.view === 'calendar');
            // Make the boot loader honest about what's actually loading. The
            // analytics data only matters for the analytics view, so don't
            // claim "Loading analytics…" when the visitor is refreshing
            // straight onto the content calendar (or any non-analytics tab).
            const _setBootLoadingText = (t) => { const el = document.getElementById('bootLoadingText'); if (el) el.textContent = t; };
            const _landingIsCalendar = isClientCalendarLink
                || hashRaw === 'calendar' || hashRaw.startsWith('calendar/');
            if (_landingIsCalendar) _setBootLoadingText('Loading content calendar…');
            else if ((_syncviewClientEntryCapability && _syncviewClientEntryCapability.view === 'sample-reviews') || hashRaw === 'samples' || hashRaw.startsWith('samples/')) _setBootLoadingText('Loading sample reviews…');
            else if (hashRaw === 'filming-plans') _setBootLoadingText('Loading filming plans...');
            else if (hashRaw === 'time-off') _setBootLoadingText('Loading Time Off...');
            else if (_kasperHashLanding) _setBootLoadingText('Loading Kasper…');
            else if (_prodEnabled()) _setBootLoadingText('Loading Production preview...');

            if (!_isClientLink && _prodEnabled()) {
                setTimeout(function () { try { if (_bootOwnsNav()) navTo('production', false); } catch (e) { console.error('[Production] mount failed', e); } }, 0);
                _prodFirstLoadSettled.then(() => fetchEssentials().then(() => {
                    _applyAllDataDependentChrome();
                }, err => {
                    console.warn('[SyncView] Production preview background essentials failed', err);
                }));
                return;
            }

            if (isClientCalendarLink) {
                // The verified client comes from the server capability, and
                // the calendar reads Supabase, so no Sheets read gates this
                // paint. Both Sheets stages load in the background; the
                // Analytics/Brief gate waits for them, and the watcher applies
                // the roster-dependent chrome once they land.
                _syncviewWatchClientExtras(_syncviewClientAnalyticsData(clientEntryRun),clientEntryRun);
                await Promise.resolve();
                if(!_clientEntryStillCurrent())return;
                const _calLinkClient = _syncviewClientEntryCapability && _syncviewClientEntryCapability.client;
                if (!(await _syncviewVerifyClientLinkAccess(_calLinkClient))) return;
                if(!_clientEntryStillCurrent())return;
                document.getElementById('selectorWrap').style.display = 'none';
                document.getElementById('pageSub').style.display = 'none';
                document.getElementById('pageTitle').textContent = 'Your Analytics';
                document.querySelector('header.header').style.display = 'none';
                clientViewTab[_calLinkClient] = 'calendar';
                render(_calLinkClient, true);
                return;
            }

            // >>> SXR_BEGIN
            // Legacy v=samples is canonicalized to this route only after the
            // strict token verdict. Mount the exact verified client directly;
            // generic SXR preferences/pins never get a chance to rebind it.
            if (_isClientLink && _syncviewClientEntryCapability && _syncviewClientEntryCapability.view === 'sample-reviews') {
                await Promise.resolve();
                if(!_clientEntryStillCurrent())return;
                const _sxrLink = _syncviewClientEntryCapability.client;
                if (!(await _syncviewVerifyClientLinkAccess(_sxrLink))) return;
                if(!_clientEntryStillCurrent())return;
                const _h = document.querySelector('header.header'); if (_h) _h.style.display = 'none';
                const _sw = document.getElementById('selectorWrap'); if (_sw) _sw.style.display = 'none';
                const _ps = document.getElementById('pageSub'); if (_ps) _ps.style.display = 'none';
                const _pt = document.getElementById('pageTop'); if (_pt) _pt.style.display = 'none';
                mountSxrClientView(_sxrLink);
                return;
            }
            // <<< SXR_END
            // Kasper unlock must run BEFORE the skipAwait branch so the nav
            // button is visible regardless of which navigation path init()
            // takes. Previously this lived after the fast-path return, so
            // refreshing on /?Kasper=1#calendar (or any other fast-tab hash)
            // never ran it — the nav button stayed hidden and the user lost
            // their Kasper access on every reload. ?Kasper=1 sets a
            // sessionStorage flag that persists for the tab's lifetime, so
            // subsequent navigations within the same browser tab keep
            // Kasper unlocked even after the search param has dropped off.
            let _kasperArrivedFromUnlockParam=false;
            try{
                // Drop any persistent unlock left over from the old localStorage scheme.
                localStorage.removeItem(KASPER_UNLOCK_KEY);
                // "Just arrived" means this is the FIRST time we've seen
                // ?Kasper=1 in this browser tab — i.e. sessionStorage wasn't
                // already holding the unlock. On subsequent refreshes the
                // sessionStorage flag is still there, so we leave the
                // arrived-flag false: the user is mid-session and the redirect
                // to Kasper below shouldn't yank them out of whatever tab
                // they're currently looking at.
                // Kasper is admin-only now: ?Kasper=1 no longer unlocks it (the
                // address forwards to /kasper), and the old per-tab unlock is dropped.
                sessionStorage.removeItem(KASPER_UNLOCK_KEY);
                _kasperApplyAccess();
            }catch(e){}

            // Calendar can mount immediately on the fast path, before the
            // Clients Info roster has populated its saved client. Reconcile as
            // soon as essentials land; analytics extras must never hold the
            // More / multi-select / zoom toolbar recovery hostage.
            // A Kasper landing holds the analytics extras until its first
            // content paints (see _analyticsHoldExtras).
            if (skipAwait && !_isClientLink && (_kasperHashLanding || (_kasperArrivedFromUnlockParam && _kasperUnlocked && !hashRaw))) _analyticsHoldExtras(8000);
            const dataLoad = fetchAll(_isClientLink?clientEntryRun:null);
            const dataPromise = dataLoad.complete;
            dataLoad.essentials.then(() => {
                if(_clientEntryStillCurrent())_applyAllDataDependentChrome();
            }, () => {});
            // Today mounts before Clients Info lands (it is a fast tab); let
            // it wait for this load instead of reporting "could not read".
            try { tdySetClientsInfoReady(dataLoad.essentials); } catch (e) {}

            if (skipAwait) {
                // Bare /?Kasper=1 with no hash — drop straight into Kasper
                // from the fast path too, matching the full-path behaviour
                // below. Any other URL (with a hash) lets the hash router
                // decide which tab to mount; the Kasper nav button was
                // already revealed unconditionally above.
                if (_kasperArrivedFromUnlockParam && _kasperUnlocked && !hashRaw) {
                    await Promise.resolve();
                    loadTemplates();
                    if (_bootOwnsNav()) navTo('kasper', false);
                    dataPromise.catch(err => console.warn('[SyncView] background fetchAll failed', err));
                    return;
                }
                // Yield one microtask so any top-level let/const declarations
                // below init()'s call site (e.g. _tkPollTimer down in the
                // TikTok module) finish initializing before navTo touches
                // them — _tkTeardown reads _tkPollTimer and would otherwise
                // hit a TDZ error on a direct calendar refresh.
                await Promise.resolve();
                // Paint immediately; fetchAll fills the global chrome when it lands.
                loadTemplates();
                if (!_bootOwnsNav()) {
                    // Someone clicked a tab while the landing was deciding.
                    dataPromise.catch(err => console.warn('[SyncView] background fetchAll failed', err));
                    return;
                }
                if (hashRaw.startsWith('calendar/')) {
                    const rest = hashRaw.slice('calendar/'.length);
                    const sl = rest.indexOf('/');
                    const slug = sl >= 0 ? rest.slice(0, sl) : rest;
                    const cardId = sl >= 0 ? decodeURIComponent(rest.slice(sl+1)) : '';
                    const match = WL_CLIENT_NAMES.find(n => wlNormalizeClient(n) === slug);
                    if (match) _calSetFocusRequest({ client: match, cardId: cardId || null });
                    // Sheet-only client (e.g. a calendar link shared by another
                    // SMM): the allowlist is still seed-only on this fast path, so
                    // the slug won't have matched above. Resolve and open it as a
                    // tab once fetchAll folds in the Clients Info sheet.
                    else if (slug) {
                        _calSetPendingDeepLink({ slug, cardId: cardId || null });
                        // Listen to essentials itself, not the full analytics
                        // bundle: once the sheet roster is merged this route can
                        // resolve even if extras are still pending or fail. A
                        // rejected essentials load takes the graceful fallback.
                        dataLoad.essentials.then(_calResolvePendingDeepLink, _calResolvePendingDeepLink);
                    }
                    navTo('calendar', false);
                } else if (hashRaw.startsWith('samples/')) {
                    navTo('samples', false); // retired Samples Old link: navTo sends it to Sample reviews
                } else if (hashRaw.startsWith('templates/')) {
                    // Open straight to the deep-linked client so a refresh doesn't
                    // flash the templates index first, and restore the exact tab.
                    // hashRaw is ALREADY decoded (do not decode again); history.state
                    // survives a reload and carries the exact client + tab when set,
                    // so prefer it over the hash. Canonicalize / drop once the client
                    // roster (allData) has loaded.
                    let seed = hashRaw.slice('templates/'.length);
                    const st = history.state || {};
                    if (st.templatesClient) seed = st.templatesClient;
                    if (seed) _templatesSetSelected(seed);
                    if (st.templatesTab === 'reels' || st.templatesTab === 'thumbnails') _templatesSetActiveTab(st.templatesTab);
                    navTo('templates', false);
                    const _tplEpoch = _syncviewNavEpoch;
                    dataPromise.then(() => {
                        // Only re-route Templates if nobody has left it since.
                        if (_syncviewNavEpoch !== _tplEpoch) return;
                        if (wlIsAllowedClient(_templatesSelected)) {
                            const canon = wlCanonicalClient(_templatesSelected);
                            if (canon && canon !== _templatesSelected) { _templatesSetSelected(canon); navTo('templates', false); }
                        } else if (_templatesSelected) {
                            // Deep-link no longer resolves to a real client → index.
                            _templatesSetSelected(null); navTo('templates', false);
                        }
                    });
                } else if (hashRoute === 'smm-weekly-report' || hashRoute === 'smm-weekly-reports') {
                    navTo(hashRoute, false);
                } else if (hashRaw === 'kasper' || hashRaw.startsWith('kasper/')) {
                    // Admin access already confirmed (gated by _kasperHashLanding).
                    if (hashRaw.startsWith('kasper/')) {
                        const sub = hashRaw.slice('kasper/'.length);
                        const key = _kasperResolveSubtab(sub);
                        if (key) _kasperState.tab = key;
                    }
                    navTo('kasper', false);
                } else if (hashRaw === 'time-off') {
                    navTo('time-off', false);
                } else if (hashIsFastTab) {
                    navTo(hashRaw, false);
                } else {
                    navTo(restoreFastNav, false);
                }
                // Bubble fetch errors to the user, but only if they actually
                // navigate somewhere that needs data — for a clean calendar
                // session a transient analytics fetch failure isn't fatal.
                dataPromise.catch(err => {
                    console.warn('[SyncView] background fetchAll failed', err);
                });
                return;
            }

            // Stale-while-revalidate: paint the dashboard instantly from the
            // last session's snapshot and let fetchAll() refresh behind it.
            // Client share links (?c=…) always await fresh data — their token
            // gate must check the live sheet, not yesterday's copy.
            let _paintedFromCache = false;
            if (!qp.get('c')) _paintedFromCache = _analyticsHydrateFromCache();
            /* A staff landing on the overview draws from Metrics and Clients
               Info alone, so it waits for those and not for TopVideos (15.8 MB,
               the last sheet to arrive: ~4.3 s of a ~5.0 s wait measured
               2026-09-23). Per-client pages still get everything: render()
               waits for the extras before drawing one. */
            const _overviewLanding = !_isClientLink && !qp.get('c')
                && !(history.state && history.state.client) && (!hashRaw || hashRaw === 'home');
            const _paintWaitsOn = _overviewLanding ? dataLoad.essentials : dataPromise;
            /* The saved copy a normal browser's localStorage refuses lives in
               IndexedDB. It RACES the live sheets rather than gating them: it
               paints only if it answers first, and _analyticsHydrateFromIdb
               refuses once fresh essentials have been applied. Staff only. */
            if (!_paintedFromCache && !qp.get('c') && !_isClientLink) {
                // A live load that FAILS must not win the race: then the
                // saved copy is the only thing left to show.
                const _idbPaint = _analyticsHydrateFromIdb();
                _paintedFromCache = await Promise.race([
                    _idbPaint,
                    _paintWaitsOn.then(() => false, () => _idbPaint)
                ]);
            }
            if (_paintedFromCache) {
                const _fpAtPaint = _analyticsAppliedFp.ess + '|' + _analyticsAppliedFp.ext;
                dataPromise.then(() => {
                    if (_analyticsAppliedFp.ess + '|' + _analyticsAppliedFp.ext !== _fpAtPaint) _analyticsRefreshCurrentView();
                    _analyticsLiveApplied();
                }, err => {
                    console.warn('[SyncView] background analytics revalidate failed:', err);
                    _analyticsSyncCachedNote(true);
                });
            } else {
                await _paintWaitsOn;
                // The rest still loads; its failure is the per-client pages'
                // to report (they wait on it), not the overview's.
                if (_paintWaitsOn !== dataPromise) dataPromise.catch(err => console.warn('[SyncView] background analytics extras failed:', err));
            }
            if(!_clientEntryStillCurrent())return;
            // Content summaries now generate lazily — only when the user opens a specific client's profile.
            // See buildContentSummarySection for the per-profile auto-trigger.
            // Load shared client templates from the Apps Script backend (non-blocking).
            if(!_isClientLink)loadTemplates();
            _applyAllDataDependentChrome();
            const clientNames=getClientRoster();
            if(_isClientLink){
                const clientEntry=_syncviewClientEntryCapability;
                if(!clientEntry||!clientEntry.verified){_syncviewInvalidClientLinkScreen();return;}
                if(!(await _syncviewVerifyClientLinkAccess(clientEntry.client))) return;
                if(!_clientEntryStillCurrent())return;
                document.getElementById('selectorWrap').style.display='none';
                document.getElementById('pageSub').style.display='none';
                document.getElementById('pageTitle').textContent='Your Analytics';
                document.querySelector('header.header').style.display='none';
                clientViewTab[clientEntry.client]=clientEntry.view==='brief'?'brief':'analytics';
                render(clientEntry.client,true);return;
            }
            // hash is hashRaw from the top of init() — alias kept for the
            // existing routing branches below. The Kasper unlock setup now
            // lives above the skipAwait branch so it runs on every path.
            // Phase D: a tab clicked while the landing was loading wins.
            if(!_bootOwnsNav())return;
            const hash = hashRaw;
            if(_kasperArrivedFromUnlockParam && _kasperUnlocked && !hash){
                // Bare /?Kasper=1 — drop straight into Kasper as a one-step
                // unlock. If the URL also carries a hash (e.g. someone
                // bookmarked /?Kasper=1#calendar so Kasper stays unlocked
                // while they're working in the calendar) the hash router
                // below decides which tab to land on; the Kasper nav
                // button was already revealed unconditionally above, so
                // it stays visible from any tab.
                navTo('kasper',false);return;
            }
            // On page refresh, restore exact state from history.state
            if(history.state&&history.state.client&&wlIsAllowedClient(history.state.client)){
                const s=history.state,c=wlCanonicalClient(s.client);
                const tab=s.clientTab||'analytics';
                clientViewTab[c]=tab;
                if(s.briefSection)activeBriefSection[c]=s.briefSection;
                if(s.briefTab)activeBriefTab[c]=s.briefTab;
                if(s.mrBriefTab)activeMRBriefTab[c]=s.mrBriefTab;
                render(c,false);return;
            }
            if(hash==='today'){navTo(hash,false);return;}
            if(hash==='linear'){navTo(hash,false);return;}
            if(hash==='workload'){navTo(hash,false);return;}
            if(hash==='calendar'){navTo(hash,false);return;}
            if(hash==='samples'){navTo(hash,false);return;}
            if(hash==='templates'){navTo(hash,false);return;}
            if(hash==='filming-plans'){navTo(hash,false);return;}
            if(hash==='tiktok-upload'){navTo(hash,false);return;}
            if(hash==='time-off'){navTo('time-off',false);return;}
            if(hash==='staff-onboarding'||hash==='client-credentials'){navTo(hash,false);return;}
            if(hashRoute==='smm-weekly-report'){navTo('smm-weekly-report',false);return;}
            if(hashRoute==='smm-weekly-reports'){navTo('smm-weekly-reports',false);return;}
            if(hash==='kasper' && _kasperUnlocked){navTo('kasper',false);return;}
            if(hash.startsWith('kasper/') && _kasperUnlocked){
                const sub=hash.slice('kasper/'.length);
                const key=_kasperResolveSubtab(sub); if(key) _kasperState.tab=key;
                navTo('kasper',false);return;
            }
            if(hash.startsWith('calendar/')){
                const rest=hash.slice('calendar/'.length);
                const sl=rest.indexOf('/');
                const slug=sl>=0?rest.slice(0,sl):rest;
                const cardId=sl>=0?decodeURIComponent(rest.slice(sl+1)):'';
                // Prefer the full allowlist (WL_CLIENT_NAMES has merged the
                // Clients Info sheet by now) over the analytics-only client list,
                // so a calendar-only client with no analytics row still resolves.
                const match=WL_CLIENT_NAMES.find(n=>wlNormalizeClient(n)===slug)||clientNames.find(n=>wlNormalizeClient(n)===slug);
                if(match){_calSetFocusRequest({client:match,cardId:cardId||null});navTo('calendar',false);return;}
                navTo('calendar',false);return;
            }
            if(hash.startsWith('samples/')){navTo('samples',false);return;} // retired Samples Old link -> Sample reviews
            if(hash.startsWith('templates/')){const tn=hash.slice('templates/'.length);if(wlIsAllowedClient(tn)){_templatesSetSelected(wlCanonicalClient(tn));navTo('templates',false);return;}}
            if(hash&&wlIsAllowedClient(hash)){render(wlCanonicalClient(hash),false);return;}
            // Only restore savedNav on page refresh (history.state exists), not new tabs
            if(history.state&&history.state.nav&&(savedNav==='today'||savedNav==='linear'||savedNav==='workload'||savedNav==='calendar'||savedNav==='samples'||savedNav==='templates'||savedNav==='tiktok-upload'||savedNav==='time-off'||(savedNav==='kasper'&&_kasperUnlocked))){navTo(savedNav,false);return;}
            navTo('home',false);
        }catch(err){
            if(_isClientLink){
                if(!_syncviewClientEntryRunCurrent(clientEntryRun))return;
                _syncviewInvalidClientLinkScreen({retryable:true});
                return;
            }
            // Lift the pre-paint boot gate too: routing died before
            // navTo()/render() could, and the error card should show on the
            // normal chrome, not a half-gated one.
            document.documentElement.removeAttribute('data-boot-nav');
            document.documentElement.removeAttribute('data-boot-subtab');
            document.getElementById('content').innerHTML=`<div class="error-state">Could not load data. Make sure the Google Sheet is set to "Anyone with the link can view".<br><br><small style="color:var(--sv-fg-aaa)">${err.message}</small></div>`;
        }
    }

    // The shared staff password (localStorage 'syncview_auth_v1') was retired
    // on 2026-09-10: it was one secret for everyone, readable in this page's
    // source, and it identified nobody. Staff entry is now the same verified
    // roster-name + personal role key that already gated every capability.
    // The stale marker is swept so no browser carries a dead credential.
    const _LEGACY_AUTH_KEY = 'syncview_auth_v1';
    try { localStorage.removeItem(_LEGACY_AUTH_KEY); } catch (e) {}
    let _syncviewAppBooted = false;
    function _syncviewSetAppBooted(value) { _syncviewAppBooted = value; }
    const SYNCVIEW_CLIENT_ENTRY_VIEWS = Object.freeze(['analytics', 'calendar', 'brief', 'samples', 'sample-reviews']);
    const SYNCVIEW_CLIENT_ENTRY_KEYS = Object.freeze(['c', 't', 'v', 'sxr']);
    let _syncviewClientEntryCapability = null;
    function _syncviewSetClientEntryCapability(value) { _syncviewClientEntryCapability = value; }
    let _syncviewClientEntryGeneration = 0;
    let _syncviewClientEntryDataController = null;
    let _syncviewClientEntryDataRun = null;

    function _syncviewStaleClientEntryError() {
        const error = new Error('Stale client entry');
        error.name = 'AbortError';
        return error;
    }
    function _syncviewAbortClientEntryDataRun() {
        const controller = _syncviewClientEntryDataController;
        _syncviewClientEntryDataController = null;
        _syncviewClientEntryDataRun = null;
        try { if (controller) controller.abort(); } catch (e) {}
    }
    function _syncviewClientEntryRunCurrent(run) {
        if (!_isClientLink) return !run;
        const cap = _syncviewClientEntryCapability;
        return !!(run
            && run === _syncviewClientEntryDataRun
            && !run.signal.aborted
            && run.generation === _syncviewClientEntryGeneration
            && run.href === location.href
            && cap
            && cap.verified
            && cap.slug === run.slug);
    }
    function _syncviewCreateClientEntryDataRun(generation, slug) {
        _syncviewAbortClientEntryDataRun();
        const controller = new AbortController();
        const run = {
            generation,
            href: location.href,
            slug,
            signal: controller.signal
        };
        _syncviewClientEntryDataController = controller;
        _syncviewClientEntryDataRun = run;
        return run;
    }
    function _syncviewSyncClientEntryRunHref() {
        const run = _syncviewClientEntryDataRun;
        const cap = _syncviewClientEntryCapability;
        if (run && cap && cap.verified && cap.slug === run.slug) run.href = location.href;
    }

    function _syncviewClientEntrySlug(value) {
        try { return wlNormalizeClient(value); }
        catch (e) { return String(value || '').trim().toLowerCase().replace(/^dr\.?\s+/, '').replace(/\s+(?:and|&)\s+/g, '&').replace(/[^a-z0-9&]+/g, ''); }
    }
    function _syncviewClientEntryEnvelope() {
        let q;
        try { q = new URLSearchParams(svRoute.search()); } catch (e) { return { ok: false, reason: 'malformed_query' }; }
        const keys = Array.from(q.keys());
        if (keys.some(key => !SYNCVIEW_CLIENT_ENTRY_KEYS.includes(key))) return { ok: false, reason: 'mixed_entry' };
        for (const key of SYNCVIEW_CLIENT_ENTRY_KEYS) {
            if (q.getAll(key).length > 1) return { ok: false, reason: 'duplicate_' + key };
        }
        if (q.getAll('c').length !== 1 || q.getAll('t').length !== 1) return { ok: false, reason: 'missing_credential' };
        const client = String(q.get('c') || '').trim();
        const token = String(q.get('t') || '').trim();
        const slug = _syncviewClientEntrySlug(client);
        if (!client || !slug || !token || client.length > 160 || token.length > 512 || /[\u0000-\u001f\u007f]/.test(client + token)) {
            return { ok: false, reason: 'malformed_credential' };
        }
        let view = String(q.get('v') || 'analytics').trim().toLowerCase();
        if (!SYNCVIEW_CLIENT_ENTRY_VIEWS.includes(view)) return { ok: false, reason: 'unsupported_view' };
        // Clients no longer see Brief (owner, 2026-09-27): an old link that asks
        // for it opens the Content Calendar instead, never an error. Staff
        // client profiles keep Brief unchanged.
        if (view === 'brief') view = 'calendar';
        const sxr = q.get('sxr');
        if (view === 'sample-reviews') {
            if (sxr !== '1') return { ok: false, reason: 'invalid_samples_entry' };
        } else if (sxr !== null) {
            return { ok: false, reason: 'mixed_samples_entry' };
        }
        let hash = '';
        try { hash = decodeURIComponent(svRoute.hash().replace(/^#/, '')); } catch (e) { return { ok: false, reason: 'malformed_hash' }; }
        // Current-main client tabs wrote a same-client hash. It has no routing
        // authority and is accepted only as a migration input; strict token
        // verification succeeds first, then the hash is removed in-place.
        if (hash && hash !== client) return { ok: false, reason: 'mixed_hash' };
        let state = null; try { state = history.state; } catch (e) {}
        if (state && state.client && _syncviewClientEntrySlug(state.client) !== slug) {
            return { ok: false, reason: 'mismatched_history' };
        }
        if (state && !state.client && state.nav) return { ok: false, reason: 'staff_history' };
        if ((view === 'analytics' || !q.get('v')) && state && state.client && _syncviewClientEntrySlug(state.client) === slug) {
            if (state.clientTab === 'calendar' || state.clientTab === 'brief') view = 'calendar';
        }
        return { ok: true, client, slug, token, view, legacyHash: !!hash };
    }
    function _writeUiCancelClientLegacyRetryTimers() {
        if (!_isClientLink) return;
        if (_linearOutboxFlushTimer) {
            clearTimeout(_linearOutboxFlushTimer);
            _calSetLinearOutboxFlushTimer(null);
        }
        if (_sxrLinearOutboxTimer) {
            clearTimeout(_sxrLinearOutboxTimer);
            _sxrSetLinearOutboxTimer(null);
        }
    }
    function _syncviewPurgeClientEntrySurface() {
        _writeUiCancelClientLegacyRetryTimers();
        try { if (typeof _syncviewCancelBriefWork === 'function') _syncviewCancelBriefWork(); } catch (e) {}
        try { if (typeof _calV2Teardown === 'function') _calV2Teardown(); } catch (e) {}
        try { if (typeof _sxrAbortActiveLoad === 'function') _sxrAbortActiveLoad(); } catch (e) {}
        try { if (typeof _sxrV2Teardown === 'function') _sxrV2Teardown(); } catch (e) {}
        try { if (growthChart) { growthChart.destroy(); _setGrowthChart(null); } } catch (e) {}
        try { if (viewsChart) { viewsChart.destroy(); _setViewsChart(null); } } catch (e) {}
        try {
            _setAllData([]); _setClientMap({}); _setTopVideos([]); _setBriefs([]); _setMrBriefs([]);
            _setCurrentClientHistory([]); _setClientViewTab({});
            _setContentSummaryState({}); _setTabSummaryCache({});
            _setFetchExtrasPromise(null);
            _nextFetchExtrasAttempt();
            _setFetchExtrasState({ status: 'idle', run: null });
            _setClientEssentialsLoad({ promise: null, status: 'idle', run: null });
            _autoSummaryAttempted.clear();
        } catch (e) {}
        try {
            _calNextLoadSeq();
            _calSetClient(null); calState.posts = []; calState.loading = false; calState.error = null;
            _calSetFocusRequest(null); _calSetPendingDeepLink(null);
        } catch (e) {}
        try {
            _sxrNextLoadSeq();
            sxrState.client = null; sxrState.posts = []; sxrState.loading = false; sxrState.error = null;
            sxrState.embedded = false; sxrState.previewId = null; sxrState.focusCard = null;
        } catch (e) {}
        document.body.classList.remove('cal-page', 'sm-modal-open', 'cal-modal-open');
    }
    function _syncviewClientEntrySlugHint() {
        const cap = _syncviewClientEntryCapability;
        if (cap && cap.slug) return cap.slug;
        try { return _syncviewClientEntrySlug(new URLSearchParams(svRoute.search()).get('c')); }
        catch (e) { return ''; }
    }
    function _syncviewClearClientEntryCaches(slug) {
        try { localStorage.removeItem(ANALYTICS_CACHE_KEY); } catch (e) {}
        try { if (typeof _analyticsIdbDelete === 'function') _analyticsIdbDelete(); } catch (e) {}
        try { localStorage.removeItem('syncview_contentSummaryState_v1'); } catch (e) {}
        try { localStorage.removeItem('syncview_generalBriefState_v5'); } catch (e) {}
        try { localStorage.removeItem('syncview_today_cache_v1'); } catch (e) {}
        if (!slug) return;
        try { localStorage.removeItem(CAL_CACHE_KEY_PREFIX + slug); } catch (e) {}
        try { localStorage.removeItem(SXR_CACHE_PREFIX + slug); } catch (e) {}
        // Retired Samples Old cache (the page was removed 2026-09-24); browsers may still hold one.
        try { localStorage.removeItem('syncview_samplesCache_v1:' + slug); } catch (e) {}
    }
    function _syncviewFlushClientEntryPending() {
        try { if (typeof _calFlushAllPending === 'function') _calFlushAllPending(); } catch (e) {}
        try { if (typeof _sxrFlushAllPending === 'function') _sxrFlushAllPending(); } catch (e) {}
    }
    function _syncviewClientEntryValidationSurface() {
        document.documentElement.setAttribute('data-boot-nav', 'client');
        document.documentElement.setAttribute('data-boot-subtab', 'verify');
        const h = document.querySelector('header.header'); if (h) h.style.display = 'none';
        const pt = document.getElementById('pageTop'); if (pt) pt.style.display = 'none';
        const content = document.getElementById('content');
        if (content) content.innerHTML = _svLoadingSkeletonHtml('client-verify');
    }
    function _syncviewInvalidClientLinkScreen(opts) {
        opts = opts || {};
        const cacheSlug = _syncviewClientEntrySlugHint();
        ++_syncviewClientEntryGeneration;
        _syncviewAbortClientEntryDataRun();
        _syncviewFlushClientEntryPending();
        _syncviewClientEntryCapability = null;
        _syncviewPurgeClientEntrySurface();
        _syncviewClearClientEntryCaches(cacheSlug);
        document.documentElement.removeAttribute('data-boot-nav');
        document.documentElement.removeAttribute('data-boot-subtab');
        const h = document.querySelector('header.header'); if (h) h.style.display = 'none';
        const pt = document.getElementById('pageTop'); if (pt) pt.style.display = 'none';
        const content = document.getElementById('content');
        const retry = opts.retryable
            ? `<button type="button" class="share-btn" onclick="_syncviewStartClientEntry(true)" style="margin-top:4px;">Try again</button>`
            : '';
        const title = opts.retryable ? 'We could not verify this link' : `This link isn't valid`;
        const copy = opts.retryable
            ? 'Check your connection and try again. No client data was loaded.'
            : 'Please ask your social media manager for an updated link.';
        if (content) content.innerHTML = `<div data-client-entry-state="${opts.retryable ? 'retry' : 'invalid'}" style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:14px;padding:40px;text-align:center;font-family:'Plus Jakarta Sans',sans-serif;">
            <div style="font-size:1.15rem;font-weight:700;color:var(--sv-fg-111);">${title}</div>
            <div style="font-size:0.9rem;color:var(--sv-fg-777);max-width:380px;line-height:1.45;">${copy}</div>
            ${retry}
        </div>`;
    }
    function _syncviewClientEntryLoader(entry,opts) {
        const content = document.getElementById('content');
        if (!content || !entry) return;
        opts=opts||{};
        let kind = 'analytics-client';
        let label = 'Loading your analytics...';
        if (entry.view === 'calendar') { kind = 'calendar'; label = 'Loading content calendar...'; }
        else if (entry.view === 'brief') { kind = 'client-brief'; label = 'Loading your brief...'; }
        else if (entry.view === 'samples' || entry.view === 'sample-reviews') { kind = 'review'; label = 'Loading sample reviews...'; }
        const extrasAttr=opts.extras?' data-client-extras-state="loading"':'';
        content.innerHTML = `<div data-client-entry-loading="${entry.view}"${extrasAttr}>${_svLoadingSkeletonHtml(kind, { label, name: entry.client })}</div>`;
    }
    function _syncviewClientExtrasErrorScreen(entry) {
        const content=document.getElementById('content');
        if(!content||!entry)return;
        const subject=entry.view==='brief'?'brief':'analytics';
        content.innerHTML=`<div data-client-extras-state="error" data-client-extras-view="${entry.view}" style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:14px;padding:40px;text-align:center;font-family:'Plus Jakarta Sans',sans-serif;">
            <div style="font-size:1.15rem;font-weight:700;color:var(--sv-fg-111);">We could not load your ${subject}</div>
            <div style="font-size:0.9rem;color:var(--sv-fg-777);max-width:420px;line-height:1.45;">Your data was not replaced with an empty result. Check your connection and try again.</div>
            <button type="button" class="share-btn" onclick="_syncviewRetryClientExtras()" style="margin-top:4px;">Try again</button>
        </div>`;
    }
    function _syncviewCanonicalizeClientEntry(entry) {
        const q = new URLSearchParams(svRoute.search());
        let view = entry.view;
        if (view === 'samples') view = 'sample-reviews';
        if (view === 'analytics') q.delete('v'); else q.set('v', view);
        if (view === 'sample-reviews') q.set('sxr', '1'); else q.delete('sxr');
        const tab = view === 'sample-reviews' ? 'sample-reviews' : view;
        const prev = history.state && _syncviewClientEntrySlug(history.state.client) === entry.slug ? history.state : {};
        const state = Object.assign({}, prev, {
            nav: null,
            client: entry.client,
            clientSlug: entry.slug,
            clientTab: tab,
            clientEntryView: view
        });
        // A share link keeps whatever path it was opened on.
        const url = location.pathname + '?' + q.toString();
        history.replaceState(state, '', url);
        return Object.freeze({ client: entry.client, slug: entry.slug, view, verified: true });
    }
    async function _syncviewPreflightClientEntry(generation, href) {
        const entry = _syncviewClientEntryEnvelope();
        if (!entry.ok) return { kind: 'invalid', reason: entry.reason };
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 8000) : null;
        try {
            const resp = await fetch(CLIENT_TOKEN_VERIFY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
                signal: controller ? controller.signal : undefined,
                body: JSON.stringify({ client: entry.client, slug: entry.slug, token: entry.token, view: entry.view, strict: true })
            });
            let json = null; try { json = await resp.json(); } catch (e) {}
            if (generation !== _syncviewClientEntryGeneration || href !== location.href) return { kind: 'stale' };
            if (!resp.ok) return { kind: resp.status >= 500 || resp.status === 429 || resp.status === 408 ? 'retry' : 'invalid' };
            const responseSlug = _syncviewClientEntrySlug(json && json.slug);
            const responseView = String(json && json.view || '');
            if (!json
                || json.ok !== true
                || json.valid !== true
                || json.active !== true
                || json.strict !== true
                || json.protocol !== SYNCVIEW_CLIENT_ENTRY_PROTOCOL
                || responseSlug !== entry.slug
                || responseView !== entry.view) {
                return { kind: 'invalid' };
            }
            const canonicalClient = String(json.display_name || '').trim();
            if (!canonicalClient || _syncviewClientEntrySlug(canonicalClient) !== entry.slug) return { kind: 'invalid' };
            entry.client = canonicalClient;
            return { kind: 'ok', entry };
        } catch (e) {
            if (generation !== _syncviewClientEntryGeneration || href !== location.href) return { kind: 'stale' };
            return { kind: 'retry' };
        } finally {
            if (timer) clearTimeout(timer);
        }
    }
    function _syncviewStartClientEntry(isRetry) {
        _syncviewAbortClientEntryDataRun();
        const generation = ++_syncviewClientEntryGeneration;
        const href = location.href;
        if (isRetry) _syncviewClientEntryValidationSurface();
        Promise.resolve().then(async () => {
            const verdict = await _syncviewPreflightClientEntry(generation, href);
            if (!verdict || verdict.kind === 'stale') return;
            if (verdict.kind !== 'ok') {
                _syncviewInvalidClientLinkScreen({ retryable: verdict.kind === 'retry' });
                return;
            }
            _syncviewClientEntryCapability = _syncviewCanonicalizeClientEntry(verdict.entry);
            _syncviewClientEntryLoader(_syncviewClientEntryCapability);
            const dataRun = _syncviewCreateClientEntryDataRun(generation, _syncviewClientEntryCapability.slug);
            Promise.resolve(init(dataRun)).catch(() => {});
            if (_syncviewClientEntryRunCurrent(dataRun)) {
                _writeUiResumeLegacyQueues('client-verified', dataRun).catch(() => {});
            }
        }).catch(() => _syncviewInvalidClientLinkScreen({ retryable: true }));
    }
    function _syncviewSuspendClientEntry() {
        if (!_isClientLink) return;
        // Calendar's earlier pagehide listener has already flushed its queue.
        // SXR registers later after async capability mount, so flush it here
        // exactly once before clearing the restored client state.
        try { if (typeof _sxrFlushAllPending === 'function') _sxrFlushAllPending(); } catch (e) {}
        ++_syncviewClientEntryGeneration;
        _syncviewAbortClientEntryDataRun();
        try { if (typeof _sxrAbortActiveLoad === 'function') _sxrAbortActiveLoad(); } catch (e) {}
        _syncviewClientEntryCapability = null;
        _syncviewPurgeClientEntrySurface();
        _syncviewClientEntryValidationSurface();
    }
    function _syncviewResumeClientEntry(event) {
        if (!_isClientLink || !event || event.persisted !== true) return;
        // Capture + stop prevents Calendar/SXR/pageshow refresh listeners from
        // issuing a read against the restored capability before revalidation.
        event.stopImmediatePropagation();
        _syncviewClientEntryValidationSurface();
        _syncviewStartClientEntry(false);
    }
    async function _syncviewVerifyClientLinkAccess(clientName) {
        if (!_isClientLink) return true;
        const cap = _syncviewClientEntryCapability;
        if (cap && cap.verified && _syncviewClientEntrySlug(clientName) === cap.slug) return true;
        _syncviewInvalidClientLinkScreen();
        return false;
    }
    const _clientEntryParams = new URLSearchParams(svRoute.search());
    const _isClientLink = _clientEntryParams.has('c');
    const _isIntake=(new URLSearchParams(svRoute.search()).get('intake')==='1');
    const _entryHash=(()=>{try{return decodeURIComponent(svRoute.hash().replace('#','')).split('/')[0].split('?')[0];}catch(e){return svRoute.hash().replace('#','').split('/')[0].split('?')[0];}})();
    const _isSmmWeeklyEntry=_isSmmWeeklyRoute(_entryHash);
    const _obParam=new URLSearchParams(svRoute.search()).get('onboarding');
    // AI funnel lives at /ai_onboarding_form (or ?onboarding=ai); the standard
    // funnel at /onboarding_form (or ?onboarding=<anything-else>). The /ai_ path
    // can't match the standard regex (no '/' before 'onboarding_form'), so order
    // doesn't matter, but we detect AI explicitly to set the variant.
    const _isAiOnboarding=(_obParam==='ai') || /\/ai_onboarding_form\/?$/i.test(location.pathname);
    const _isOnboarding=_isAiOnboarding || (_obParam!==null) || /\/onboarding_form\/?$/i.test(location.pathname);
    const _isOnboardingView=!!new URLSearchParams(svRoute.search()).get('onboarding_view');
    if(_isIntake&&!_isClientLink){document.body.classList.add('intake-mode');}
    if(_isOnboarding&&!_isClientLink){document.body.classList.add('onboarding-mode');}
    if(_isSmmWeeklyEntry&&!_isClientLink){document.body.classList.add('smm-weekly-mode');}
    /* Start the write-authority read now, beside key-verify, instead of after
       it. The Calendar may only paint its saved copy once this live answer is
       in hand (_calCacheRead fails closed without it), and it used to be
       asked for only after sign-in cleared, so a returning staff member
       watched a spinner for the length of one more round trip with their
       saved cards already on disk. It is the same public flag read the page
       makes anyway (deduped by _writeUiRefreshAuthority), carries no client
       data and no staff key, and decides nothing on its own: writes still
       re-read it live. Client links and the special entry modes skip it.
       Only a saved-identity boot asks: that is the boot that mounts the
       Calendar about a second from now, so the answer is fresh when used. A
       signed-out page may sit on the sign-in gate for any length of time, and
       an early answer held that long could paint stale Linear links; it
       reads the flag after sign-in, as before (Codex, PR 1569). */
    let _bootHasSavedStaffIdentity = false;
    try { _bootHasSavedStaffIdentity = !!localStorage.getItem('syncview_staff_identity_v1'); } catch (e) {}
    if (_bootHasSavedStaffIdentity && !_isClientLink && !_isIntake && !_isOnboarding && !_isSmmWeeklyEntry) {
        try { _writeUiRefreshAuthority(); } catch (e) {}
    }
    if(_isClientLink){
        // A client query never enters a staff/special-mode route directly.
        // Keep the neutral validation skeleton and staff chrome lock in place
        // until the server binds one active client + current token.
        _syncviewClientEntryValidationSurface();
        window.addEventListener('pagehide', _syncviewSuspendClientEntry);
        window.addEventListener('pageshow', _syncviewResumeClientEntry, true);
        _syncviewStartClientEntry(false);
    } else if(_isOnboarding){
        // Standalone onboarding form (?onboarding=…): no staff password and no
        // dashboard data load. Hide all workspace chrome and mount only the
        // onboarding page; navTo is locked to 'onboarding' so the link can't
        // reach any other tab.
        // Pick the funnel variant BEFORE the form mounts. The AI funnel shows the
        // AI-avatar section and drops the sample-video section; the standard funnel
        // is the reverse. Each keeps its own autosave draft key so the two forms
        // never clobber each other's localStorage.
        _obSetVariant(_isAiOnboarding ? 'ai' : 'normal');
        _obSetDraftKey(_isAiOnboarding ? 'syncview_ai_onboarding_draft_v1' : 'syncview_onboarding_draft_v1');
        _obSetSubIdKey(_isAiOnboarding ? 'syncview_ai_onboarding_subid_v1' : 'syncview_onboarding_subid_v1');
        // Both onboarding forms carry SynchroSocial branding (tab title + favicon),
        // distinct from the SyncView dashboard chrome.
        try {
            document.title = 'SynchroSocial';
            let _fav = document.querySelector('link[rel="icon"]');
            if (!_fav) { _fav = document.createElement('link'); _fav.rel = 'icon'; document.head.appendChild(_fav); }
            _fav.type = 'image/png';
            _fav.href = '/synchro-social-favicon.png';
        } catch (e) {}
        const _h=document.querySelector('header.header'); if(_h) _h.style.display='none';
        const _pt=document.getElementById('pageTop'); if(_pt) _pt.style.display='none';
        // Defer to a macrotask so the whole script finishes initializing its
        // module-level bindings first — navTo() calls teardown fns that read
        // `let`s declared later in the file, so calling it synchronously here
        // would hit a temporal-dead-zone ReferenceError.
        setTimeout(function(){ try{ navTo('onboarding', false); }catch(e){ console.error('[onboarding] mount failed', e); } }, 0);
    } else if(_isOnboardingView){
        // Standalone per-client onboarding viewer (new tab from a client's template
        // profile). Read-only and credential-free, with no dashboard data load;
        // the onboarding reader opens verified admin staff sign-in before fetch.
        document.body.classList.add('onboarding-view-mode');
        try { document.title = 'Onboarding — SynchroSocial'; } catch(e){}
        const _hV=document.querySelector('header.header'); if(_hV) _hV.style.display='none';
        const _ptV=document.getElementById('pageTop'); if(_ptV) _ptV.style.display='none';
        setTimeout(function(){ svArea('templates').then(function(tpl){ tpl.obvMountStandalone(new URLSearchParams(svRoute.search()).get('onboarding_view')); }).catch(function(e){ console.error('[onboarding_view] mount failed', e); }); }, 0);
    } else if(_isSmmWeeklyEntry||_isIntake||!!_syncviewStaffIdentityLoad()){
        // A saved identity boots the app optimistically so signed-in staff
        // never see the gate flash. It grants nothing: _syncviewStaffIdentityBoot()
        // runs inside init() and drops the gate back if it does not verify.
        if(_isSmmWeeklyEntry){
            document.documentElement.classList.remove('boot-gate');
            const _pwS=document.getElementById('staffGateOverlay'); if(_pwS) _pwS.style.display='none';
            const _hS=document.querySelector('header.header'); if(_hS) _hS.style.display='none';
            const _ptS=document.getElementById('pageTop'); if(_ptS) _ptS.style.display='none';
        }
        if(_isIntake){
            // Client intake link (?intake=1): expose ONLY the Linear submission
            // flow. Bypass the staff password, hide all workspace chrome, and
            // force the Linear page. navTo() is hard-locked to 'linear' so no
            // other tab/page is reachable from this link.
            const _h=document.querySelector('header.header'); if(_h) _h.style.display='none';
            const _pt=document.getElementById('pageTop'); if(_pt) _pt.style.display='none';
            try{localStorage.setItem(NAV_KEY,'linear');}catch(e){}
            history.replaceState({nav:'linear',client:null},'','/'+svRoute.search()+'#linear');
        }
        _syncviewAppBooted = true;
        init();
        if(_isIntake){
            // Defer to a macrotask, like the onboarding link above: navTo()
            // reaches module-level bindings declared later in the page (e.g.
            // TikTok upload's _tkMounted), so a synchronous call here threw a
            // temporal-dead-zone ReferenceError that the catch swallowed. Since
            // #1551 the boot router backs off once a nav has been attempted, so
            // nothing drew the Submit form and ?intake=1 stayed on its skeleton.
            setTimeout(function(){
                try{ navTo('linear', false); }catch(e){ console.error('[intake] mount failed', e); }
                try{ _linearResumeSubmissionHold('startup').catch(function(){}); }catch(e){}
            }, 0);
        }
    } else {
        // No saved identity on a staff surface: the gate is the whole page
        // until a role key verifies. init() runs from _syncviewLiftStaffGate().
        _syncviewOpenStaffGate();
    }

    // >>> SXR_BEGIN
    /* ============================================================
       SAMPLES (REVIEW) MODULE  —  ?sxr=1 (default-OFF), route #sample-reviews
       A whole-surface clone of the Content Calendar review machinery, re-pointed
       to the LIVE `sample_reviews` Supabase table + the `sample-review-*` n8n
       webhooks, over the components ['video','graphic'] only. Built as a fully
       ADDITIVE, namespaced fork (every new symbol carries `sxr`) so it can never
       affect the calendar and is removable by deleting the SXR fences.
       See docs/features/SAMPLES_REBUILD_STRATEGY.md / docs/features/SAMPLES_REBUILD_SPEC.md.
       --- SURFACE 0: constants, flag isolation, shared-util aliases, state ---
       ============================================================ */

    /* Status vocabulary: the calendar's set MINUS the publishing-only
       Scheduled/Posted (samples never schedule). Terminal = Approved (+Archived). */
    const SXR_STATUSES  = ['In Progress','For SMM Approval','Kasper Approval','Client Approval','Tweaks Needed','Approved'];
    const SXR_PRIORITY  = { 'Tweaks Needed':0,'In Progress':1,'For SMM Approval':2,'Kasper Approval':3,'Client Approval':4,'Approved':5 };
    /* Two components only — no caption, no title. `graphic` renders as "Thumbnail". */
    const SXR_COMPONENTS = ['video','graphic'];
    const SXR_REVIEW_COMPONENTS = ['video','graphic'];

    /* Live backend (docs/features/SAMPLES_GO_LIVE.md): reads hit Supabase REST and fall back to
       the get webhook; writes are field-level patches to the upsert webhook. The
       Supabase project + anon key are SHARED with the calendar (same browser key). */
    const SXR_GET_URL     = 'https://synchrosocial.app.n8n.cloud/webhook/sample-review-get';
    const SXR_UPSERT_N8N_URL  = 'https://synchrosocial.app.n8n.cloud/webhook/sample-review-upsert';
    const SXR_UPSERT_URL  = SXR_UPSERT_N8N_URL; // legacy fallback alias; do not fetch directly
    const SXR_UPSERT_EF_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/sample-review-upsert';
    const SXR_REORDER_N8N_URL = 'https://synchrosocial.app.n8n.cloud/webhook/sample-review-reorder';
    const SXR_REORDER_URL = SXR_REORDER_N8N_URL; // legacy fallback alias; do not fetch directly
    const SXR_REORDER_EF_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/sample-review-reorder';
    const SXR_TABLE       = 'sample_reviews';
    const SXR_RT_CHANNEL_PREFIX = 'sxr-';
    const SXR_LINEAR_OUTBOX_KEY = 'syncview_sxr_linear_outbox_v1';
    const SXR_CLEAR_LINK_SENTINEL = '__CLEAR_LINK__';
    const SXR_LINK_CLEAR_FIELDS = ['linear_issue_id', 'graphic_linear_issue_id', 'video_deliverable_id', 'graphic_deliverable_id'];
    function _sxrApplyClearSentinels(wirePost, touched) {
        SXR_LINK_CLEAR_FIELDS.forEach(lk => {
            if (!Object.prototype.hasOwnProperty.call(wirePost, lk)) return;
            if (touched && !Object.prototype.hasOwnProperty.call(touched, lk)) return;
            if (String(wirePost[lk] == null ? '' : wirePost[lk]).trim() === '') wirePost[lk] = SXR_CLEAR_LINK_SENTINEL;
        });
    }
    const SXR_SAMPLE_REVIEW_FLAG_KEY = 'sample_review_ef_clients';

    /* Reused-as-is from the calendar (table-agnostic utilities). Aliasing instead
       of cloning keeps the cloned surfaces uniformly `_sxr*` (clean grep/teardown)
       while still CALLING the shared implementation, so its security / pagination /
       Linear-mapping fixes reach samples for free (see docs/features/SAMPLES_PARITY_LOG.md §0). */
    const _sxrEsc = _calEsc, _sxrEscAttr = _calEscAttr, _sxrJsArg = _jsAttrArg;
    const _sxrNormalizeClient = wlNormalizeClient;
    const _sxrSupabaseFetchAllRows = _calSupabaseFetchAllRows;
    const _sxrV2LoadLib = _calV2LoadLib;
    const _sxrMapLinearStatusStrict = _calMapLinearStatusStrict;
    const _sxrIdentFromUrl = _calIdentFromUrl;

    /* Feature flag — DEFAULT-OFF (the inverse of the calendar's v2 default).
       `?sxr=1` turns it on and is sticky in localStorage; `?sxr=0` opts back out.
       With the flag off NO samples code runs: the nav tab stays hidden, the router
       never mounts the view (mountSxrView early-returns), and supabase-js is never
       loaded. This isolation is a hard requirement (docs/features/SAMPLES_REBUILD_SPEC.md §6). */
    const SXR_ON_KEY  = 'syncview_sxr_on';
    const SXR_OFF_KEY = 'syncview_sxr_off';
    let _sxrFlagCache = null;
    function _sxrEnabled() {
        // Client entry is owned by its strict capability, never by a staff
        // browser's sticky Samples preference. Before verification this stays
        // inert; the exact verified Review capability enables only its mount.
        if (_isClientLink) {
            const cap = _syncviewClientEntryCapability;
            return !!(cap && cap.verified && cap.view === 'sample-reviews');
        }
        if (_sxrFlagCache !== null) return _sxrFlagCache;
        // GA rollout (2026-07-02): default ON for everyone — the "Samples New"
        // nav tab ships beside the old Samples tab so SMMs can migrate; the old
        // module retires later. `?sxr=0` remains the sticky per-browser opt-out
        // (the rollback documented in docs/features/SAMPLES_GO_LIVE.md); `?sxr=1` clears it.
        let on = true;
        try {
            const q = new URLSearchParams(svRoute.search()).get('sxr');
            if (q === '1' || q === 'true') { on = true; try { localStorage.setItem(SXR_ON_KEY,'1'); localStorage.removeItem(SXR_OFF_KEY); } catch {} }
            else if (q === '0' || q === 'false') { on = false; try { localStorage.setItem(SXR_OFF_KEY,'1'); localStorage.removeItem(SXR_ON_KEY); } catch {} }
            else { on = (localStorage.getItem(SXR_OFF_KEY) !== '1'); }
        } catch { on = true; }
        _sxrFlagCache = on;
        return on;
    }
    /* Realtime/REST readiness: flag on AND the shared anon key present. */
    function _sxrReady() { return _sxrEnabled() && !!CAL_SUPABASE_URL && !!CAL_SUPABASE_ANON_KEY; }

    /* Per-surface state — the calendar's calState, TRIMMED: no month/week cursors,
       no month/status filters, no collab/title settings (all excluded). */
    const sxrState = {
        view: 'organizer',          // 'organizer' (Sheet) | 'smmreview' (Review)
        client: null,
        posts: [],
        loading: false,
        error: null,
        previewId: null,
        embedded: false,
        zoom: 'default',
        selectMode: false,
        selectAction: 'archive',
        selected: new Set(),
        lastSel: null,
        focusCard: null,
    };

    /* Slug for a client name/object (samples reuse the shared normalizer). */
    function sxrClientSlug(c) { return _sxrNormalizeClient(c && c.name ? c.name : c); }
    let _sxrSampleEfClients = new Set();
    let _sxrSampleFlagPromise = null;
    let _sxrSampleFlagChannel = null;
    function _sxrSetSampleFlagValue(value) {
        _sxrSampleEfClients = new Set(_calRuntimeFlagClients(value));
        _calV2Log('sample-review EF clients:', Array.from(_sxrSampleEfClients).join(',') || '(none)');
    }
    async function _sxrFetchSampleFlagOnce() {
        if (!CAL_SUPABASE_URL || !CAL_SUPABASE_ANON_KEY) { _sxrSetSampleFlagValue({ clients: [] }); return; }
        try {
            const url = CAL_SUPABASE_URL + '/rest/v1/syncview_runtime_flags?select=value&key=eq.' + encodeURIComponent(SXR_SAMPLE_REVIEW_FLAG_KEY) + '&limit=1';
            let rows = (typeof _svBootFlagRows === 'function' ? await _svBootFlagRows(SXR_SAMPLE_REVIEW_FLAG_KEY) : null);
            if (!rows) {
                const resp = await fetch(url, { headers: { apikey: CAL_SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY, Accept: 'application/json' } });
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                rows = await resp.json();
            }
            const row = Array.isArray(rows) ? rows[0] : null;
            _sxrSetSampleFlagValue(row && row.value ? row.value : { clients: [] });
        } catch (e) {
            _sxrSetSampleFlagValue({ clients: [] });
            console.warn('[Samples] sample-review EF flag read failed; using n8n fallback', e);
        }
    }
    async function _sxrSubscribeSampleFlag() {
        if (_sxrSampleFlagChannel) return;
        const client = await _calRuntimeFlagClient();
        if (!client || _sxrSampleFlagChannel) return;
        try {
            _sxrSampleFlagChannel = client
                .channel('syncview-sample-runtime-flags')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'syncview_runtime_flags', filter: 'key=eq.' + SXR_SAMPLE_REVIEW_FLAG_KEY }, (payload) => {
                    const row = payload && payload.new ? payload.new : null;
                    _sxrSetSampleFlagValue(row && row.value ? row.value : { clients: [] });
                })
                .subscribe();
        } catch (e) {
            console.warn('[Samples] sample-review EF flag realtime subscribe failed', e);
            _sxrSampleFlagChannel = null;
        }
    }
    function _sxrPrimeSampleRoutingFlag() {
        if (!_sxrSampleFlagPromise) {
            _sxrSampleFlagPromise = _sxrFetchSampleFlagOnce().then(() => _sxrSubscribeSampleFlag()).catch(() => null);
        }
        return _sxrSampleFlagPromise;
    }
    function _sxrSampleUseEf(clientOrSlug) {
        let slug = '';
        try { slug = sxrClientSlug(clientOrSlug); } catch (e) { slug = String(clientOrSlug || '').toLowerCase().replace(/[^a-z0-9&]+/g, ''); }
        return !!slug && _sxrSampleEfClients.has(slug);
    }
    function _sxrUpsertUrlForClient(clientOrSlug) {
        return _sxrSampleUseEf(clientOrSlug) ? SXR_UPSERT_EF_URL : SXR_UPSERT_N8N_URL;
    }
    function _sxrReorderUrlForClient(clientOrSlug) {
        return _sxrSampleUseEf(clientOrSlug) ? SXR_REORDER_EF_URL : SXR_REORDER_N8N_URL;
    }
    function _sxrWriteHeaders(source, url) {
        let role = 'smm';
        try { if (_isClientLink) role = 'client'; else if (svRoute.hash() === '#kasper' || new URLSearchParams(svRoute.search()).get('Kasper') === '1') role = 'kasper'; } catch (e) {}
        const actor = role === 'client' ? 'Client' : (role === 'kasper' ? 'Kasper' : 'SyncView');
        return _syncviewEfHeaders({ 'Content-Type': 'application/json', 'X-Syncview-Actor': actor, 'X-Syncview-Role': role, 'X-Syncview-Source': source || 'ui' }, url);
    }
    function _sxrUpsertFetch(clientOrSlug, payload, source) {
        _sxrPrimeSampleRoutingFlag();
        const url = _sxrUpsertUrlForClient(clientOrSlug);
        return fetch(url, {
            method: 'POST',
            headers: _sxrWriteHeaders(source, url),
            body: JSON.stringify(payload)
        });
    }
    function _sxrUpsertFetchPinned(clientOrSlug, payload, source, transport) {
        if (transport !== 'supabase' && transport !== 'webhook') {
            return _sxrUpsertFetch(clientOrSlug, payload, source);
        }
        const url = transport === 'supabase' ? SXR_UPSERT_EF_URL : SXR_UPSERT_N8N_URL;
        return fetch(url, {
            method: 'POST',
            headers: _sxrWriteHeaders(source, url),
            body: JSON.stringify(payload)
        });
    }
    function _sxrReorderFetch(clientOrSlug, payload, source) {
        _sxrPrimeSampleRoutingFlag();
        const post = (url) => _writeUiTrackSave('sxr', 'sample_reorder', () => ({ client_slug: String(payload && payload.client || '') }), () => fetch(url, {
            method: 'POST',
            headers: _sxrWriteHeaders(source, url),
            body: JSON.stringify(payload)
        }));
        if (!_sxrSampleUseEf(clientOrSlug)) return post(SXR_REORDER_N8N_URL);
        return post(SXR_REORDER_EF_URL).then(async (resp) => {
            let json = null;
            try { json = await resp.clone().json(); } catch (e) {}
            if (!resp.ok || (json && json.ok === false)) throw new Error((json && json.error) || ('sample reorder EF HTTP ' + resp.status));
            return resp;
        });
    }
    _sxrPrimeSampleRoutingFlag();

    /* Map a legacy/external status string onto the samples set. Clone of
       _calNormStatus minus the Scheduled/Posted members (which samples reject). */
    function _sxrNormStatus(s) {
        const v = String(s || '').trim();
        if (!v || /^draft$/i.test(v)) return 'In Progress';
        if (/^(for )?kasper approval$/i.test(v)) return 'Kasper Approval';
        if (/^smm approval$/i.test(v)) return 'For SMM Approval';
        const m = SXR_STATUSES.find(x => x.toLowerCase() === v.toLowerCase());
        return m || v;
    }
    /* Overall card status = worst-of its sub-statuses. Clone of computeOverallStatus
       over SXR_COMPONENTS; the reduce seed is 'Approved' (best) since there is no
       Scheduled/Posted above it. */
    function computeSampleOverallStatus(p) {
        if (!p) return 'In Progress';
        const subs = SXR_COMPONENTS.map(c => _sxrNormStatus(p[c + '_status'] || 'In Progress'));
        return subs.reduce((acc, s) => (SXR_PRIORITY[s] != null && SXR_PRIORITY[acc] != null && SXR_PRIORITY[s] < SXR_PRIORITY[acc]) ? s : acc, 'Approved');
    }
    /* Clear stale client-approval stamps when a sub drops below Client Approval.
       Clone of _calClearStaleApprovals over SXR_COMPONENTS; the above-set has no
       Scheduled/Posted and there is no title clause. */
    function _sxrClearStaleApprovals(post, pending) {
        if (!post) return;
        const above = new Set(['Client Approval', 'Approved']);
        SXR_COMPONENTS.forEach(c => {
            const sub = _sxrNormStatus(post[c + '_status'] || '');
            const stampKey = 'client_' + c + '_approved_at';
            if (!above.has(sub) && post[stampKey]) {
                post[stampKey] = '';
                if (pending) pending[stampKey] = '';
            }
        });
        // The overall Kasper stamp goes stale the same way (calendar parity):
        // once no component sits at/above Client Approval, a kept stamp would
        // make the next Kasper approval reuse the OLD timestamp (the approve
        // handler only stamps when empty).
        if (post.kasper_approved_at) {
            const anyAbove = SXR_COMPONENTS.some(c => above.has(_sxrNormStatus(post[c + '_status'] || '')));
            if (!anyAbove) {
                post.kasper_approved_at = '';
                if (pending) pending.kasper_approved_at = '';
            }
        }
    }

    /* Per-client archive ledger (clone of _calArchived*, sxr-namespaced key so it
       never collides with the calendar's). Hides a row the user archived while the
       Archived write propagates / against a resurrecting realtime echo. */
    const SXR_ARCHIVE_GRACE_MS = 60 * 1000;
    function _sxrArchivedKey(slug) { return 'syncview_sxr_archived_v1_' + slug; }
    function _sxrArchivedReadRaw(slug) {
        if (!slug) return {};
        try {
            const raw = JSON.parse(localStorage.getItem(_sxrArchivedKey(slug)) || '{}');
            if (Array.isArray(raw)) { const m = {}; raw.forEach(r => { if (r) m[String(r)] = 0; }); return m; }
            return (raw && typeof raw === 'object') ? raw : {};
        } catch { return {}; }
    }
    function _sxrArchivedWriteRaw(slug, obj) {
        if (!slug) return;
        try { localStorage.setItem(_sxrArchivedKey(slug), JSON.stringify(obj || {})); } catch {}
    }
    function _sxrArchivedRefs(slug) {
        if (!slug) return new Set();
        return new Set(Object.keys(_sxrArchivedReadRaw(slug)));
    }
    function _sxrArchivedAdd(slug, refs) {
        if (!slug || !refs || !refs.length) return;
        const m = _sxrArchivedReadRaw(slug); const now = Date.now(); let changed = false;
        refs.filter(Boolean).forEach(r => { const k = String(r); if (m[k] !== now) { m[k] = now; changed = true; } });
        if (changed) _sxrArchivedWriteRaw(slug, m);
    }
    function _sxrArchivedRemove(slug, refs) {
        if (!slug || !refs || !refs.length) return;
        const m = _sxrArchivedReadRaw(slug); let changed = false;
        refs.filter(Boolean).forEach(r => { const k = String(r); if (Object.prototype.hasOwnProperty.call(m, k)) { delete m[k]; changed = true; } });
        if (changed) _sxrArchivedWriteRaw(slug, m);
    }

    /* ============================================================
       --- SURFACE 1: shell, toolbar (Review+Sheet), per-client tabs,
           zoom, kebab (Share only), data load, body dispatcher ---
       Clone of _calRenderShell / mountCalendar / loadCalendarPosts /
       _calRenderBody / onCalViewChange / the tab strip, re-pointed to
       sample_reviews and STRIPPED of: Month/Week views, the All-months +
       All-content filter dropdowns, the import/bulk-sync/edit-platforms/
       edit-caption-prompt/collaborative/YouTube-title kebab items, and the
       multi-post caption button. Reuses the calendar's GLOBAL cal-* CSS.
       ============================================================ */

    /* View/zoom prefs — own key so samples prefs never collide with the calendar. */
    const SXR_PREFS_KEY = 'syncview_sxr_prefs_v1';
    function _sxrLoaderHtml(label) { return _calLoaderHtml(label || 'Loading sample reviews'); }
    function _sxrLoadPrefs() { try { return JSON.parse(localStorage.getItem(SXR_PREFS_KEY) || '{}'); } catch { return {}; } }
    function _sxrSavePrefs() {
        try {
            const prev = _sxrLoadPrefs();
            const client = sxrState.embedded ? prev.client : sxrState.client;
            localStorage.setItem(SXR_PREFS_KEY, JSON.stringify({ view: sxrState.view, client, zoom: sxrState.zoom }));
        } catch {}
    }

    /* Open client tabs (pins) + the pure tab-strip helpers + the client matcher
       are SHARED with the calendar (same clients in both surfaces). */
    const _sxrGetPins = _calGetPins, _sxrSavePins = _calSavePins;
    const _sxrChevron = _calChevron, _sxrClientHue = _calClientHue;
    const _sxrTabScrollBy = _calTabScrollBy, _sxrUpdateTabScroll = _calUpdateTabScroll, _sxrScrollTabStripToActive = _calScrollTabStripToActive;
    const _sxrMatchClients = _calMatchClients;

    /* Deep-link focus request (set by the router on #sample-reviews/<slug>/<id>). */
    let _sxrFocusRequest = null;

    function renderSxrView() {
        return `<div class="cal-view" id="sxrView">${_sxrLoaderHtml()}</div>`;
    }

    function mountSxrView() {
        if (!_sxrEnabled()) return;   // default-OFF isolation: never mount with the flag off
        if (typeof _sxrV2Teardown === 'function') _sxrV2Teardown();
        // Resolve a deep-link (#sample-reviews/<slug>/<cardId>) captured at boot.
        try {
            const dh = window.__sxrDeepHash; window.__sxrDeepHash = null;
            if (dh && dh.indexOf('sample-reviews/') === 0) {
                const parts = dh.slice('sample-reviews/'.length).split('/');
                const slug = parts[0]; const cardId = parts[1] || null;
                const match = (typeof WL_CLIENT_NAMES !== 'undefined' ? WL_CLIENT_NAMES : []).find(n => _sxrNormalizeClient(n) === slug) || null;
                _sxrFocusRequest = match ? { client: match, cardId: cardId ? decodeURIComponent(cardId) : null } : null;
                // A fresh browser only knows the seed roster until the Clients
                // Info sheet loads; hold the link and resolve it then, instead of
                // opening an empty "No clients added yet" board.
                if (!match && slug) _sxrPendingDeepLink = { slug, cardId: cardId ? decodeURIComponent(cardId) : null };
            }
        } catch (e) {}
        if (_sxrFocusRequest && _sxrFocusRequest.client) _sxrPinClient(_sxrFocusRequest.client);
        const prefs = _sxrLoadPrefs();
        const pins  = _sxrGetPins();
        let initial = null;
        if (_sxrFocusRequest && _sxrFocusRequest.client && wlIsAllowedClient(_sxrFocusRequest.client)) initial = _sxrFocusRequest.client;
        else if (svSharedClientFor('sample-reviews')) initial = svSharedClientFor('sample-reviews');   // shared top-bar client
        else if (prefs.client && pins.includes(prefs.client)) initial = prefs.client;
        else if (pins.length > 0) initial = pins[0];
        else if (prefs.client && WL_CLIENT_NAMES.includes(prefs.client)) initial = prefs.client;
        sxrState.client = initial;
        if (initial) { svSharedClientNote(initial); _sxrPinClient(initial); }
        sxrState.embedded = false;
        sxrState.view = (_sxrFocusRequest ? 'organizer' : (prefs.view === 'smmreview' ? 'smmreview' : 'organizer'));
        sxrState.zoom = _sxrNormZoom(prefs.zoom);
        sxrState.posts = [];
        sxrState.error = null;
        sxrState.previewId = null;
        if (_sxrPendingDeepLink) {
            sxrState.client = null;
            _sxrRenderShell();   // the body keeps its loader until the roster lands
            if (typeof fetchEssentials === 'function') fetchEssentials().then(_sxrResolvePendingDeepLink, _sxrResolvePendingDeepLink);
            else _sxrResolvePendingDeepLink();
            return;
        }
        _sxrRenderShell();
        // The address names the client showing, like Calendar's
        // /calendar/<client> (Vigil, 2026-09-28): opening the tab used to leave
        // a bare /sample-reviews until the client was switched by hand, so a
        // refresh or a copied address lost it. A card link already in the
        // address for this client is kept.
        const _sxrHash = svRoute.hash().replace(/^#/, '');
        if (!sxrState.client || _sxrHash.indexOf('sample-reviews/' + encodeURIComponent(sxrClientSlug(sxrState.client)) + '/') !== 0) _sxrSyncUrlCard(null);
        if (sxrState.client) loadSxrCards();
        else _sxrRenderBody();
    }

    /* Card deep links (#sample-reviews/<slug>/<card>): open that client as a
       tab, then outline and centre the card once its row has painted. The card
       stays in the address while it is open; closing it (a click elsewhere)
       drops it back to #sample-reviews/<slug>. */
    let _sxrPendingDeepLink = null;
    function _sxrPinClient(name) {
        const pins = _sxrGetPins();
        if (name && !pins.includes(name)) _sxrSavePins(pins.concat([name]));
    }
    function _sxrResolvePendingDeepLink() {
        const pending = _sxrPendingDeepLink;
        _sxrPendingDeepLink = null;
        if (!pending || currentNav !== 'sample-reviews' || sxrState.embedded) return;
        const match = WL_CLIENT_NAMES.find(n => _sxrNormalizeClient(n) === pending.slug) || null;
        if (!match) {
            showNotify('Sample link not opened', 'That link points at a client this tab does not know yet. Reload and try the link again.');
            const pins = _sxrGetPins();
            if (pins.length) onSxrClientChange(pins[0]); else _sxrRenderBody();
            return;
        }
        _sxrFocusRequest = { client: match, cardId: pending.cardId };
        _sxrPinClient(match);
        sxrState.view = 'organizer';
        _sxrRenderShell();
        onSxrClientChange(match);
    }
    function _sxrSyncUrlCard(pid) {
        if (sxrState.embedded || currentNav !== 'sample-reviews') return;
        const base = '/' + svRoute.search().replace(/#.*$/, '');
        if (!sxrState.client) { history.replaceState({ nav: 'sample-reviews', client: null }, '', base + '#sample-reviews'); return; }
        history.replaceState({ nav: 'sample-reviews', client: null }, '', base + '#sample-reviews/' + encodeURIComponent(sxrClientSlug(sxrState.client)) + (pid ? '/' + encodeURIComponent(pid) : ''));
    }
    function _sxrFocusOutsideHandler(e) {
        const card = document.querySelector('#sxrView .cal-card-focused');
        if (!card) { document.removeEventListener('mousedown', _sxrFocusOutsideHandler, true); return; }
        if (card.contains(e.target)) return;
        card.classList.remove('cal-card-focused');
        document.removeEventListener('mousedown', _sxrFocusOutsideHandler, true);
        _sxrSyncUrlCard(null);
    }
    // Called after each Samples render that has the client's cards.
    function _sxrApplyFocusRequest() {
        const req = _sxrFocusRequest;
        if (!req || !req.cardId || !sxrState.client || sxrState.loading) return;
        if (_sxrNormalizeClient(req.client) !== _sxrNormalizeClient(sxrState.client)) return;
        _sxrFocusRequest = null;
        const post = sxrState.posts.find(p => String(p.id) === String(req.cardId));
        if (!post) { showNotify('Card not found', "That linked sample isn't on this client's board. It may have been archived."); return; }
        sxrState.focusPid = post.id;
        if (sxrState.view !== 'organizer') { sxrState.view = 'organizer'; _sxrRenderShell(); }
        _sxrRenderBody();
        let frames = 0;
        const focusWhenPainted = () => {
            const safe = (window.CSS && CSS.escape) ? CSS.escape(post.id) : post.id;
            const card = document.querySelector('#sxrView .cal-card[data-pid="' + safe + '"]');
            if (!card) { if (++frames < 40) requestAnimationFrame(focusWhenPainted); return; }
            document.querySelectorAll('#sxrView .cal-card-focused').forEach(el => el.classList.remove('cal-card-focused'));
            card.classList.add('cal-card-focused');
            card.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
            _sxrSyncUrlCard(post.id);
            setTimeout(() => document.addEventListener('mousedown', _sxrFocusOutsideHandler, true), 0);
            showToast('Linked to “' + String(post.name || 'Untitled sample').trim() + '”');
        };
        requestAnimationFrame(focusWhenPainted);
    }

    function _sxrRenderShell() {
        const view = document.getElementById('sxrView');
        if (!view) return;
        const embedded = !!sxrState.embedded;
        const leftHtml = embedded
            ? `<div class="cal-embed-title"><strong>${_sxrEsc(sxrState.client || '')}</strong><span>Sample reviews</span></div>`
            : `<div class="cal-tabs" id="sxrTabs"></div>`;
        // Kebab: ONLY "Share with client" survives. Every other calendar kebab item
        // (imports, bulk-Linear-sync, edit-caption-prompt, edit-platforms, collab,
        // YouTube-title-review) is on the exclusion list and is dropped.
        const kebabHtml = (sxrState.client && !_isClientLink)
            ? `<div class="cal-kebab-wrap">
                    <button class="cal-kebab" type="button" onclick="_sxrToggleKebab(event)" title="More" aria-label="More options"><svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="13" r="1.5"/></svg></button>
                    <div class="cal-kebab-menu" id="sxrKebabMenu" hidden>
                        <button class="cal-kebab-item" type="button" onclick="_sxrCloseKebab();_sxrCopyShareLink()" title="Copy a client-facing link to these sample reviews"><svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 1L13 4.5M13 4.5L9.5 8M13 4.5H5.5C3.57 4.5 2 6.07 2 8V13"/></svg>Share with client</button>
                    </div>
                </div>`
            : '';
        // Archive-only select mode (no colour-tag, no multi-post caption — both excluded).
        const selectBtnHtml = (sxrState.client && !_isClientLink && sxrState.view === 'organizer')
            ? `<button class="cal-select-btn${sxrState.selectMode ? ' active' : ''}" type="button" data-select-action="archive" onclick="_sxrToggleSelectMode()" title="Select multiple samples to archive"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="1.8" y="1.8" width="12.4" height="12.4" rx="3.2"/><path d="M4.8 8.1l2 2 4.4-4.8"/></svg></button>`
            : '';
        const viewLabels = { review: 'Review', smmreview: 'Review', organizer: 'Sheet' };
        // Two tabs only — Review + Sheet. No Month/Week (samples have no dates).
        const tabViews = _isClientLink ? ['review','organizer'] : ['smmreview','organizer'];
        view.innerHTML = `
            <div class="cal-toolbar${(!embedded && !_isClientLink) ? ' is-picker-shell' : ''}">
                <div class="cal-toolbar-left">${leftHtml}</div>
                <div class="cal-toolbar-mid">
                    <div class="cal-view-toggle">
                        ${tabViews.map(v => {
                            const n = (v === 'review' || v === 'smmreview') ? _sxrApprovalBadgeCount(v === 'smmreview' ? 'smm' : 'client') : 0;
                            const badge = n > 0 ? `<span class="cal-view-badge">${n}</span>` : '';
                            return `<button type="button" class="cal-view-btn${sxrState.view === v ? ' active' : ''}" data-cal-view="${v}" onclick="onSxrViewChange('${v}')">${viewLabels[v]}${badge}</button>`;
                        }).join('')}
                    </div>
                    <div class="cal-zoom" id="sxrZoomCtl" title="Card size">
                        <svg class="cal-zoom-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>
                        <button type="button" id="sxrZoomOut" onclick="sxrZoom(-1)" aria-label="Zoom out"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="7" x2="11" y2="7"/></svg></button>
                        <button type="button" id="sxrZoomIn" onclick="sxrZoom(1)" aria-label="Zoom in"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="7" y1="3" x2="7" y2="11"/><line x1="3" y1="7" x2="11" y2="7"/></svg></button>
                    </div>
                </div>
                <div class="cal-toolbar-right">
                    <span class="cal-refreshing" id="sxrRefreshing" hidden><span class="cal-refresh-spin"></span>Refreshing…</span>
                    <span class="cal-stale-notice" id="sxrStaleNotice" hidden onclick="loadSxrCards({skipCache:true})" title="Click to retry">Couldn't refresh — retry</span>
                    ${selectBtnHtml}
                    ${kebabHtml}
                </div>
            </div>
            <div class="cal-body" id="sxrBody">${_sxrLoaderHtml()}</div>
            <div class="cal-lightbox" id="sxrLightbox" onclick="closeSxrLightbox()">
                <img alt="" onclick="event.stopPropagation()">
                <button class="cal-lightbox-close" type="button" onclick="closeSxrLightbox()" aria-label="Close"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7"/></svg></button>
            </div>
            <div class="cal-comments-overlay" id="sxrCommentsOverlay" data-backdrop-dismiss onclick="if(event.target===this&&this._backdropPressBegan)closeSxrComments()">
                <div class="cal-comments-modal" id="sxrCommentsModal" role="dialog" aria-modal="true" aria-labelledby="sxrCommentsTitle"></div>
            </div>
        `;
        if (!embedded) {
            _sxrRenderTabs();
            _sxrWireOutsideTabSearchClose();
        }
        _sxrApplyZoom();
    }

    /* Zoom — three discrete card sizes (Sheet only), saved to localStorage. */
    const SXR_ZOOM_LEVELS = ['s', 'm', 'l'];
    function _sxrNormZoom(z) { const map = { small:'m', default:'l', large:'l', s:'s', m:'m', l:'l' }; return map[z] || 'm'; }
    function _sxrApplyZoom() {
        const view = document.getElementById('sxrView');
        if (view) view.dataset.zoom = sxrState.zoom || 'm';
        const i = SXR_ZOOM_LEVELS.indexOf(sxrState.zoom || 'm');
        const out = document.getElementById('sxrZoomOut'), inb = document.getElementById('sxrZoomIn');
        if (out) out.disabled = i <= 0;
        if (inb) inb.disabled = i >= SXR_ZOOM_LEVELS.length - 1;
        const ctl = document.getElementById('sxrZoomCtl');
        if (ctl) { ctl.style.display = ''; ctl.style.visibility = sxrState.view === 'organizer' ? 'visible' : 'hidden'; }
    }
    function sxrZoom(delta) {
        let i = SXR_ZOOM_LEVELS.indexOf(sxrState.zoom || 'm');
        if (i < 0) i = 1;
        i = Math.max(0, Math.min(SXR_ZOOM_LEVELS.length - 1, i + delta));
        sxrState.zoom = SXR_ZOOM_LEVELS[i];
        _sxrSavePrefs();
        _sxrApplyZoom();
    }

    function _sxrToggleKebab(e) {
        if (e) e.stopPropagation();
        const menu = document.getElementById('sxrKebabMenu');
        if (!menu) return;
        menu.hidden = !menu.hidden;
        if (!menu.hidden) setTimeout(() => document.addEventListener('mousedown', _sxrKebabOutside), 0);
    }
    function _sxrCloseKebab() {
        const menu = document.getElementById('sxrKebabMenu');
        if (menu) menu.hidden = true;
        document.removeEventListener('mousedown', _sxrKebabOutside);
    }
    function _sxrKebabOutside(e) { if (!e.target.closest('.cal-kebab-wrap')) _sxrCloseKebab(); }

    /* Share-with-client link — carries ?sxr=1 because samples is default-OFF
       (without it a fresh client browser never mounts the surface). */
    async function _sxrCopyShareLink() {
        if (!sxrState.client) return;
        let url; try { url = await _syncviewIssueClientShareUrl(sxrState.client, 'sample-reviews'); } catch(e) { showToast((e&&e.message)||'Could not issue a secure client link'); return; }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(() => {}, () => window.prompt('Copy this link:', url));
        else window.prompt('Copy this link:', url);
    }

    /* Per-client tab strip (clone of _calRenderTabs; reuses the shared pins). */
    function _sxrRenderTabs() {
        const tabs = document.getElementById('sxrTabs');
        if (!tabs) return;
        const pins = _sxrGetPins();
        const active = sxrState.client;
        const tabHtml = pins.map(name => {
            const isActive = name === active;
            return `<button type="button" class="cal-tab${isActive ? ' active' : ''}" style="--tab-h:${_sxrClientHue(name)}" data-cal-tab="${_sxrEscAttr(name)}" onclick="onSxrTabClick(${_sxrJsArg(name)})">
                <span class="cal-tab-name">${_sxrEsc(name)}</span>
                <span class="cal-tab-x" onclick="event.stopPropagation();onSxrTabRemove(${_sxrJsArg(name)})" title="Remove tab"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7"/></svg></span>
            </button>`;
        }).join('');
        const plusSvg = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><line x1="8" y1="2.5" x2="8" y2="13.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><line x1="2.5" y1="8" x2="13.5" y2="8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
        const addBtnLabel = pins.length ? plusSvg : `${plusSvg}<span>Add client</span>`;
        const addBtnCls = pins.length ? 'cal-tab-add no-label' : 'cal-tab-add';
        tabs.innerHTML = `<button type="button" class="cal-tab-scroll-btn left" tabindex="-1" aria-label="Scroll clients left" onclick="_sxrTabScrollBy('sxrTabsScroll',-1)">${_sxrChevron(-1)}</button>`
            + `<div class="cal-tabs-scroll" id="sxrTabsScroll" onscroll="_sxrUpdateTabScroll('sxrTabsScroll')">${tabHtml}</div>`
            + `<button type="button" class="cal-tab-scroll-btn right" tabindex="-1" aria-label="Scroll clients right" onclick="_sxrTabScrollBy('sxrTabsScroll',1)">${_sxrChevron(1)}</button>`
            + `<div class="cal-tab-add-wrap" id="sxrTabAddWrap">
                <button type="button" class="${addBtnCls}" onclick="onSxrTabAddClick(event)" title="Add client">${addBtnLabel}</button>
                <div class="cal-tab-search" id="sxrTabSearchPanel" hidden>
                    <div class="wl-client-search">
                        <input type="text" class="wl-client-search-input" id="sxrClientSearchInput" placeholder="Search clients…" autocomplete="off">
                        <div class="wl-client-search-results" id="sxrClientSearchResults" hidden role="listbox"></div>
                    </div>
                </div>
            </div>`;
        _sxrScrollTabStripToActive('sxrTabsScroll');
        _sxrUpdateTabScroll('sxrTabsScroll');
    }

    function onSxrTabClick(name) {
        if (!name || name === sxrState.client) return;
        onSxrClientChange(name);
    }
    function onSxrClientChange(name) {
        if (typeof _sxrFlushAllPending === 'function') _sxrFlushAllPending();
        sxrState.client = name;
        svSharedClientNote(name);
        _sxrResetSelection();
        sxrState.posts = [];
        _sxrSavePrefs();
        _sxrRenderTabs();
        _sxrSyncUrlCard(null);   // the address follows the client now showing
        loadSxrCards();
    }
    function onSxrTabRemove(name) {
        const pins = _sxrGetPins().filter(n => n !== name);
        _sxrSavePins(pins);
        if (sxrState.client === name) {
            if (typeof _sxrFlushAllPending === 'function') _sxrFlushAllPending();
            const next = pins[0] || null;
            sxrState.client = next;
            _sxrResetSelection();
            sxrState.posts = [];
            _sxrSavePrefs();
            _sxrRenderTabs();
            _sxrSyncUrlCard(null);
            if (next) loadSxrCards();
            else _sxrRenderBody();
        } else {
            _sxrRenderTabs();
        }
    }
    function onSxrTabAddClick(e) {
        if (e) e.stopPropagation();
        const panel = document.getElementById('sxrTabSearchPanel');
        if (!panel) return;
        const opening = panel.hidden;
        panel.hidden = !opening;
        if (opening) {
            _sxrRenderClientSearchResults('');
            const input = document.getElementById('sxrClientSearchInput');
            if (input) { input.value = ''; setTimeout(() => input.focus(), 10); }
            _sxrWireSearchInput();
        }
    }
    function _sxrCloseTabSearch() { const panel = document.getElementById('sxrTabSearchPanel'); if (panel) panel.hidden = true; }
    function _sxrWireOutsideTabSearchClose() {
        if (document._sxrOutsideWired) return;
        document._sxrOutsideWired = true;
        document.addEventListener('click', (e) => { if (!e.target.closest('#sxrTabAddWrap')) _sxrCloseTabSearch(); });
    }
    function _sxrWireSearchInput() {
        const input = document.getElementById('sxrClientSearchInput');
        if (!input || input.dataset.wired === '1') return;
        input.dataset.wired = '1';
        input.addEventListener('input', () => _sxrRenderClientSearchResults(input.value.trim()));
    }
    function _sxrRenderClientSearchResults(q) {
        const results = document.getElementById('sxrClientSearchResults');
        if (!results) return;
        const matches = _sxrMatchClients(q);
        const pins    = _sxrGetPins();
        const pinned  = matches.filter(c => pins.includes(c)).sort((a,b) => pins.indexOf(a) - pins.indexOf(b));
        const others  = matches.filter(c => !pins.includes(c)).sort((a,b) => a.localeCompare(b));
        const row = (name) => {
            const isPinned = pins.includes(name);
            return `<div class="wl-client-search-result is-pin-row" onclick="onSxrPickClient(${_sxrJsArg(name)})">
                <span>${_sxrEsc(name)}</span>
                <button type="button" class="wl-client-search-pin${isPinned ? ' pinned' : ''}" title="${isPinned ? 'Open' : 'Add'}">${isPinned ? '★' : '☆'}</button>
            </div>`;
        };
        let html = '';
        if (!matches.length) {
            html = '<div class="wl-client-search-result is-empty-prompt">No clients match</div>';
        } else {
            if (pinned.length) { html += '<div class="wl-client-search-section">Already added</div>' + pinned.map(row).join(''); if (others.length) html += '<div class="wl-client-search-divider"></div>'; }
            if (others.length) { if (pinned.length) html += '<div class="wl-client-search-section">Add a client</div>'; html += others.map(row).join(''); }
        }
        results.innerHTML = html;
        results.hidden = false;
    }
    function onSxrPickClient(name) {
        const pins = _sxrGetPins();
        if (!pins.includes(name)) { pins.unshift(name); _sxrSavePins(pins); }
        _sxrCloseTabSearch();
        onSxrClientChange(name);
    }

    /* Body dispatcher lives below (the opts-aware version in Surface 3) — this
       Surface-1 stub was superseded and removed to keep _sxrRenderBody defined
       exactly once. */

    function onSxrViewChange(v) {
        if (!['review','smmreview','organizer'].includes(v)) return;
        sxrState.view = v;
        if (v !== 'organizer') sxrState.focusPid = null;
        _sxrSavePrefs();
        if (v !== 'organizer' && sxrState.selectMode) _sxrResetSelection();
        document.querySelectorAll('#sxrView .cal-view-btn').forEach(b => b.classList.toggle('active', b.dataset.calView === v));
        const selBtn = document.querySelector('#sxrView .cal-select-btn');
        if (selBtn) { selBtn.style.display = v === 'organizer' ? '' : 'none'; selBtn.classList.toggle('active', sxrState.selectMode); }
        _sxrApplyZoom();
        _sxrRenderBody();
    }

    function _sxrSetRefreshing(on) { const el = document.getElementById('sxrRefreshing'); if (el) el.hidden = !on; }
    function _sxrSetStaleNotice(on) { const el = document.getElementById('sxrStaleNotice'); if (el) el.hidden = !on; }
    // _sxrApprovalBadgeCount — real version in Surface 4 (Review), hoisted.
    function _sxrToggleSelectMode() {
        if (_isClientLink) return;   // multi-select / bulk-archive is SMM-only
        sxrState.selectMode = !sxrState.selectMode;
        sxrState.selected = new Set();
        sxrState.lastSel = null;
        document.querySelectorAll('#sxrView .cal-select-btn').forEach(btn => btn.classList.toggle('active', sxrState.selectMode));
        _sxrRenderBody({ preserveScroll: true });
    }
    function _sxrResetSelection() { sxrState.selectMode = false; sxrState.selected = new Set(); sxrState.lastSel = null; }
    function closeSxrLightbox() { const lb = document.getElementById('sxrLightbox'); if (lb) lb.classList.remove('open'); document.body.classList.remove('cal-modal-open'); }
    // closeSxrComments / openSxrComments — real versions in Surface 5 (Notes), hoisted.

    /* --- Data load (trimmed clone of loadCalendarPosts: keeps cache-prime,
       background refresh, archived-ledger filter, normalize/migrate, the
       Supabase-REST-with-webhook-fallback read, seq guard, timeout, stale
       notice; drops the excluded caption-prompt / caption-job / collab-settings
       machinery). Realtime + save-merge are layered on in Surfaces 3 and 7. --- */
    const SXR_LOAD_TIMEOUT_MS = 20000;
    const SXR_CACHE_PREFIX = 'syncview_sxr_cache_v2_';
    let _sxrLoadSeq = 0;
    function _sxrNextLoadSeq() { return ++_sxrLoadSeq; }
    let _sxrLoadController = null;
    let _sxrBgLoadInFlight = false;
    let _sxrLastNetworkLoadAt = 0;
    function _sxrAbortActiveLoad() {
        const controller = _sxrLoadController;
        _sxrLoadController = null;
        if (!controller) return false;
        // Make the aborted request stale before its rejection handler runs, so
        // teardown never renders an error or reopens realtime for a departed view.
        ++_sxrLoadSeq;
        try { controller.abort(); } catch (e) {}
        return true;
    }
    const SXR_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // parity with CAL_CACHE_TTL_MS
    function _sxrCacheRead(slug) {
        try {
            const authority = _writeUiAuthoritySnapshot();
            if (!authority) return null;
            const o = JSON.parse(localStorage.getItem(SXR_CACHE_PREFIX + slug) || 'null');
            if (!o || !Array.isArray(o.posts)) return null;
            const hasRepair = o.posts.some(post => post && post._writeUiRetrySourceAt);
            if (!o.at || (!hasRepair && (Date.now() - Number(o.at)) > SXR_CACHE_TTL_MS)) return null;
            return Object.assign({}, o, { posts: _writeUiFilterCachedPosts(o.posts, authority) });
        } catch { return null; }
    }
    function _sxrCacheWrite(slug, posts, options) {
        // Cache only rows a render can ever paint. Archived rows are filtered on
        // every read anyway, and a long-lived client can accumulate thousands of
        // them — enough to blow the localStorage quota, after which the silently
        // swallowed setItem failure kept a STALE snapshot alive forever (an
        // archived card flashed on every refresh until the live fetch hid it).
        const incoming = (Array.isArray(posts) ? posts : []).filter(p => p && _sxrNormStatus(p.status) !== 'Archived');
        const key = SXR_CACHE_PREFIX + slug;
        let priorRepairs = [];
        try {
            const prior = JSON.parse(localStorage.getItem(key) || '{}');
            const cleared = new Set(options && Array.isArray(options.clearRepairIds) ? options.clearRepairIds : []);
            priorRepairs = (Array.isArray(prior.posts) ? prior.posts : []).filter(post => post && post.id && post._writeUiRetrySourceAt && !cleared.has(post.id));
        } catch (e) {}
        const repairById = new Map(priorRepairs.map(post => [post.id, post]));
        const live = incoming.map(post => (post && post._writeUiRetrySourceAt) ? post : (repairById.get(post && post.id) || post));
        const liveIds = new Set(live.map(post => post && post.id));
        priorRepairs.forEach(post => { if (!liveIds.has(post.id)) live.push(post); });
        // Canonical crosswalk verdicts and read statuses are never persisted —
        // see _prodStripEphemeralCanonicalState. A stale verdict rehydrated
        // from this cache would be an authorization nobody re-checked.
        const payload = JSON.stringify({
            schema: 2, posts: _prodStripEphemeralCanonicalPosts(live), at: Date.now()
        });
        try { localStorage.setItem(key, payload); return true; } catch {}
        // Quota hit — evict the other clients' sample caches and retry once.
        try {
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const k = localStorage.key(i);
                if (k && k.indexOf(SXR_CACHE_PREFIX) === 0 && k !== key) localStorage.removeItem(k);
            }
            localStorage.setItem(key, payload);
            return true;
        } catch {
            // Still failing → drop this slug's cache: no cache beats a stale one
            // (the boot render just waits for the live fetch instead of lying).
            if (!priorRepairs.length) try { localStorage.removeItem(key); } catch {}
            return false;
        }
    }
    function _sxrIsArchivedRef(p, refs) {
        if (!p) return false;
        if (_sxrNormStatus(p.status) === 'Archived') return true;   // persisted-archived rows must never render, even on a fresh ledger
        if (refs.has(String(p.id))) return true;
        const vl = String(p.linear_issue_id || ''), gl = String(p.graphic_linear_issue_id || '');
        return !!((vl && refs.has(vl)) || (gl && refs.has(gl)));
    }
    /* Never seeds caption/title; ensures the two component statuses + the link/media
       columns exist so the card/save code can read them safely. */
    function _sxrMigrateShape(p) {
        if (!p) return p;
        SXR_COMPONENTS.forEach(c => { if (p[c + '_status'] == null || p[c + '_status'] === '') p[c + '_status'] = 'In Progress'; });
        ['name','creative_direction','hide_creative_direction','asset_url','thumbnail_url','linear_issue_id','video_deliverable_id','graphic_linear_issue_id','graphic_deliverable_id','thumbnail_folder_url','thumbnail_folder_id','thumbnail_file_id','thumbnail_folder_resolved_at'].forEach(k => { if (p[k] == null) p[k] = ''; });
        // Parse the per-component comment threads from the *_tweaks string columns
        // (so the Review/Notes surfaces can read them); seed the local kasper-seen
        // cache from the cross-device kasper_seen CSV.
        SXR_COMPONENTS.forEach(c => {
            const arrKey = c + '_comments', strKey = c + '_tweaks';
            if (!Array.isArray(p[arrKey])) {
                const raw = String(p[strKey] == null ? '' : p[strKey]).trim();
                let arr = [];
                // Samples has no legacy-seed path at all, so ANY content this
                // parse fails to carry — unparseable JSON, a non-array, a
                // non-JSON string, or a row without an id — is content the app
                // silently drops while the column keeps holding it. Mark the
                // read incomplete so a canonical projection refuses to
                // overwrite what it cannot demonstrably carry.
                if (raw.startsWith('[')) {
                    try {
                        const parsed = JSON.parse(raw);
                        if (Array.isArray(parsed)) {
                            arr = parsed.filter(x => x && x.id);
                            _prodMarkLegacyReadIncomplete(p, c, arr.length !== parsed.length);
                        } else _prodMarkLegacyReadIncomplete(p, c, true);
                    } catch (e) { _prodMarkLegacyReadIncomplete(p, c, true); }
                } else _prodMarkLegacyReadIncomplete(p, c, !!raw);
                p[arrKey] = arr;
            }
            (p[arrKey] || []).forEach(x => { if (x && !x.updated_at) x.updated_at = x.created_at || ''; });
        });
        p.comments = p.video_comments;
        String(p.kasper_seen || '').split(',').map(s => s.trim()).filter(Boolean).forEach(c => { if (typeof _sxrMarkKasperSeen === 'function') _sxrMarkKasperSeen(p.id, c); });
        return p;
    }
    function _sxrCleanArchiveLedger(slug, posts) {
        if (!slug || !posts || !posts.length) return;
        const m = _sxrArchivedReadRaw(slug);
        if (!Object.keys(m).length) return;
        const now = Date.now();
        const liveRefs = new Set();
        posts.forEach(p => {
            if (!p || String(p.status || '') === 'Archived') return;
            liveRefs.add(String(p.id));
            if (p.linear_issue_id) liveRefs.add(String(p.linear_issue_id));
            if (p.graphic_linear_issue_id) liveRefs.add(String(p.graphic_linear_issue_id));
        });
        let changed = false;
        Object.keys(m).forEach(ref => { if ((now - (m[ref] || 0)) > SXR_ARCHIVE_GRACE_MS && liveRefs.has(ref)) { delete m[ref]; changed = true; } });
        // Hard TTL (mirror of _calCleanArchiveLedger): refs whose rows stay
        // archived never come back "live", so without this they piled up forever.
        Object.keys(m).forEach(ref => { if ((now - (m[ref] || 0)) > 24 * 60 * 60 * 1000) { delete m[ref]; changed = true; } });
        if (changed) _sxrArchivedWriteRaw(slug, m);
    }
    async function _sxrFetchPosts(slug, signal) {
        // status filter: archived rows are never rendered, and long-lived test/QA
        // clients accumulate thousands of them — without the filter every load
        // (and the localStorage cache) dragged megabytes of dead rows around.
        // NULL-safe or= form because PostgREST neq drops NULL-status rows.
        // Client-side _sxrIsArchivedRef stays as defense for the webhook fallback.
        const baseUrl = CAL_SUPABASE_URL + '/rest/v1/' + SXR_TABLE + '?select=*&or=(status.is.null,status.neq.Archived)&client=eq.' + encodeURIComponent(slug);
        try {
            const rows = await _sxrSupabaseFetchAllRows(baseUrl, signal);
            return { ok: true, posts: rows };
        } catch (e) {
            if (e && e.name === 'AbortError') throw e;
            console.warn('[Samples] Supabase read failed — falling back to sample-review-get', e);
            const resp = await fetch(SXR_GET_URL + '?client=' + encodeURIComponent(slug) + '&_t=' + Date.now(), signal ? { signal } : undefined);
            const j = await resp.json();
            return { ok: true, posts: (j && (j.items || j.samples || j.posts)) || [] };
        }
    }
    async function loadSxrCards(opts) {
        opts = opts || {};
        // One Samples transport may own the surface at a time. A replacement
        // load revokes the prior controller before taking its own sequence.
        _sxrAbortActiveLoad();
        if (!sxrState.client) { _sxrRenderBody(); return; }
        const seq = ++_sxrLoadSeq;
        const slug = sxrClientSlug(sxrState.client);
        const cached = !opts.skipCache ? _sxrCacheRead(slug) : null;
        const haveCache = !!(cached && cached.posts.length > 0);
        if (haveCache && sxrState.posts.length === 0) {
            const refs = _sxrArchivedRefs(slug);
            sxrState.posts = cached.posts.filter(p => !_sxrIsArchivedRef(p, refs)).map(p => { p.status = _sxrNormStatus(p.status); _sxrMigrateShape(p); return p; });
            sxrState.loading = false; sxrState.error = null;
            _sxrRenderBody();
            setTimeout(() => { if (typeof _writeUiResumeSourceRepairs === 'function') _writeUiResumeSourceRepairs(); }, 0);
        }
        const background = (!!opts.background && sxrState.posts.length > 0) || (sxrState.posts.length > 0 && haveCache);
        if (background) { _sxrBgLoadInFlight = true; _sxrSetRefreshing(true); }
        else { _sxrBgLoadInFlight = false; _sxrSetRefreshing(false); sxrState.loading = true; sxrState.error = null; _sxrRenderBody(); }
        const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        _sxrLoadController = ctrl;
        const TIMEOUT = Symbol('sxr-load-timeout');
        let timeoutId = null;
        const timeoutPromise = new Promise(res => { timeoutId = setTimeout(() => { if (ctrl) { try { ctrl.abort(); } catch {} } res(TIMEOUT); }, SXR_LOAD_TIMEOUT_MS); });
        _sxrLastNetworkLoadAt = Date.now();
        try {
            const result = await Promise.race([_sxrFetchPosts(slug, ctrl ? ctrl.signal : null), timeoutPromise]);
            if (_sxrLoadController === ctrl) _sxrLoadController = null;
            if (seq !== _sxrLoadSeq) return;                      // a newer load superseded us
            if (sxrClientSlug(sxrState.client) !== slug) return;  // client switched mid-load
            if (result === TIMEOUT) throw new Error('timeout');
            const rows = (result && result.posts) || [];
            _sxrCleanArchiveLedger(slug, rows);
            const refs = _sxrArchivedRefs(slug);
            const fresh = rows.filter(p => !_sxrIsArchivedRef(p, refs)).map(p => { p.status = _sxrNormStatus(p.status); _sxrMigrateShape(p); return p; });
            // Background (realtime / tab-return) reloads MERGE so an in-flight edit /
            // comment isn't clobbered (Surface 7); a foreground load adopts the server.
            const _sxrPrevPosts = sxrState.posts;
            const _sxrMerged = (background && typeof _sxrMergeServerRows === 'function') ? _sxrMergeServerRows(fresh) : fresh;
            // Did anything the renderer paints actually change? On a background echo
            // that already matches our optimistic state (the realtime self-echo of
            // our OWN just-saved write) it didn't — so skip the full rebuild and only
            // swap the cheap comment-count footer, exactly like the calendar's
            // loadCalendarPosts !dataChanged path. This is the "send to client felt
            // laggy" fix: the click was already instant; this kills the late repaint.
            const _sxrDataChanged = !background || typeof _sxrPostsEqualForRender !== 'function' || !_sxrPostsEqualForRender(_sxrPrevPosts, _sxrMerged);
            sxrState.posts = _sxrMerged;
            _thumbRefreshChangedCards('samples', _sxrPrevPosts, _sxrMerged);
            sxrState.loading = false; sxrState.error = null;
            _sxrCacheWrite(slug, _sxrMerged.some(post => post && post._writeUiRetrySourceAt) ? _sxrMerged : rows);
            setTimeout(() => { if (typeof _writeUiResumeSourceRepairs === 'function') _writeUiResumeSourceRepairs(); }, 0);
            _sxrSetStaleNotice(false);
            if (background && !_sxrDataChanged) {
                // No visible change → don't rebuild (a full _sxrRenderBody flashes the
                // queue). Refresh only the unread-notes dots so a note the LWW merge
                // folded into a kept-local row can't be missed (the calendar's same
                // false-negative fallback). Never touches a focused field.
                if (typeof _sxrRefreshCommentsBtn === 'function') { try { sxrState.posts.forEach(p => _sxrRefreshCommentsBtn(p.id)); } catch (e) {} }
                // …and repaint the derived status pill in place, for the same
                // reason: the merge can fold a peer's change into a kept-local row
                // (LWW false-negative), leaving the pill stale while the note dot
                // updated. Focus-guarded, so it never yanks a caret (P1 fix).
                if (typeof _sxrRepaintLiveStatus === 'function') _sxrRepaintLiveStatus();
            }
            // Defer the repaint while the user is mid-edit so a realtime reload can't
            // clobber their caret / unsaved field (Surface 7 deferred-render guard).
            else if (background && typeof _sxrIsBusy === 'function' && _sxrIsBusy()) {
                _sxrSetPendingBackgroundRender(true); if (typeof _sxrSchedulePendingRender === 'function') _sxrSchedulePendingRender();
                if (typeof _sxrRefreshCommentsBtn === 'function') { try { sxrState.posts.forEach(p => _sxrRefreshCommentsBtn(p.id)); } catch (e) {} }
                // The full render is deferred while busy, but a peer's status change
                // must still show LIVE — repaint just the status pills in place
                // (focus-guarded) so "Tweaks Needed"/approvals don't wait for blur
                // or the next reload. Mirrors the note-dot refresh above (P1 fix).
                if (typeof _sxrRepaintLiveStatus === 'function') _sxrRepaintLiveStatus();
            }
            else _sxrRenderBody();
            _sxrApplyFocusRequest();
            if (typeof _sxrV2EnsureSubscribed === 'function') _sxrV2EnsureSubscribed(slug);   // open/refresh realtime
            if (typeof _sxrV2DrainPending === 'function') _sxrV2DrainPending(slug);            // service a change that arrived mid-load
            /* Native cards materialize BEFORE the Linear mirror drains, so a
               link field can be legitimately empty at creation. Adopt the urls
               from the deliverable rows once the drain has stamped them — the
               samples twin of the calendar's _calAdoptDeliverableLinks tail
               task. Fire-and-forget: adoption is a repair, never load-blocking.

               ON THE SUCCESS PATH, like the calendar twin, which runs it "on
               EVERY successful load, background included". It shipped in PR
               1098 inside the CATCH block by mistake, so it ran only when the load
               THREW — i.e. never, on a healthy tab. Two real samples created
               2026-08-20 kept the orange "Link the Linear sub-issue" banner
               with their GRA issues already minted, and reloading could not
               clear it because the reload succeeded. */
            _sxrAdoptDeliverableLinks(seq, slug).catch(() => {});
            /* Edits typed on this client while the view was elsewhere, held by
               `_sxrParkEditsForClient` because flushing them then would have
               written them under whichever client was on screen. `sxrState`
               describes this client now, so the normal engine can have them. */
            try { _sxrRestoreParkedEdits(slug); } catch (e) {}
        } catch (e) {
            if (_sxrLoadController === ctrl) _sxrLoadController = null;
            if (seq !== _sxrLoadSeq) return;
            if (sxrState.posts.length > 0) { _sxrSetStaleNotice(true); }   // keep what's on screen
            else { sxrState.loading = false; sxrState.error = e; _sxrRenderBody(); }
            // Open realtime even when the initial fetch failed, so the view goes
            // live the moment a peer's change lands — otherwise a first-load
            // network blip left the tab silent until a manual refresh.
            if (typeof _sxrV2EnsureSubscribed === 'function') _sxrV2EnsureSubscribed(slug);
            if (typeof _sxrV2DrainPending === 'function') _sxrV2DrainPending(slug);
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
            if (_sxrLoadController === ctrl) _sxrLoadController = null;
            if (seq === _sxrLoadSeq) { _sxrBgLoadInFlight = false; _sxrSetRefreshing(false); }
        }
    }

    /* ============================================================
       --- SURFACE 2: the SMM Sheet card ---
       Clone of renderCalOrganizer + _calRenderInlineCard + the link-field pills,
       the Linear pile/slot/edit/commit (+conflict/move/dupe), the status menu +
       Set-all, and the floating thumbnail. STRIPPED of: caption (+generator/
       prompt), CTA, scheduled-date chip, platforms strip, colour tag, the YouTube
       title square, and URGENT. Adds the samples-only creative-direction field +
       visibility eye. Components iterate SXR_COMPONENTS; per spec the triggers are
       ALWAYS settable (no lock — samples has no caption escape hatch).
       The real field-patch SAVE engine is Surface 3; here the field handlers update
       state + repaint optimistically and _sxrFlushCardSave is a stub.
       ============================================================ */

    /* Pure, post-shape-agnostic helpers REUSED from the calendar (thumbnail
       derivation/media, link key, status label). Component labels/colours are
       shared constants (COMP_LABELS already maps graphic→"Thumbnail"). */
    // Status label. The client-facing relabels ("Ready for your review" …) are
    // identical to the calendar, so defer to _calStatusLabel on a client link.
    // On the SMM surface the calendar personalises "Client Approval" to
    // "<ClientFirstName> Approval" via _calClientFirstName(), which reads
    // calState.client — EMPTY on the samples surface. Compute the first name from
    // sxrState.client instead so samples shows "Sidney Approval", not "Client
    // Approval" (parity bug E).
    const _sxrStatusLabel = (s) => {
        s = s || 'In Progress';
        if (_isClientLink) return _calStatusLabel(s);
        if (s === 'Client Approval') {
            const full = String((typeof sxrState === 'object' && sxrState.client) || '').trim();
            return (full ? full.split(/\s+/)[0] : 'Client') + ' Approval';
        }
        return s;
    };
    const _sxrLinkKey = _calLinkKey;
    const _sxrDeriveThumbInfo = _calDeriveThumbInfo, _sxrThumbMediaHtml = _calThumbMediaHtml;
    const _sxrStatusSlug = (s) => String(s).toLowerCase().replace(/\s+/g, '-');

    /* Save-layer state + handlers. Surface 3 replaces _sxrFlushCardSave with the
       real debounced field-patch engine; until then edits update local state and
       repaint so the card is fully interactive (optimistic, not yet persisted). */
    let _sxrPendingEdits = Object.create(null);
    let _sxrSaveTimers = Object.create(null);
    let _sxrSaveInFlight = Object.create(null);
    // _sxrOnFieldInput / _sxrOnFieldBlur / _sxrFlushCardSave / _sxrRetrySave are the
    // real save engine — defined in Surface 3 below.
    // _sxrMarkLocalStatus / _sxrIsLocalStatusFresh — real versions in Surface 7, hoisted.
    /* Refresh just the status pills on a card without re-rendering the whole
       sheet — used after an auto-status change (e.g. the SMM resolves the last
       tweak and routes it to Kasper from the Notes modal) so the card behind
       the modal updates immediately instead of saying "Tweaks Needed" until
       the next full reload. Port of _calUpdateCardStatusDisplay over the
       samples card DOM (per-component pills + URGENT badge + client pills;
       samples have no overall status pill, title square or approve bar). */
    function _sxrUpdateCardStatusDisplay(pid) {
        const post = sxrState.posts.find(p => p.id === pid);
        if (!post) return;
        const sel = (window.CSS && CSS.escape) ? CSS.escape(pid) : pid;
        for (const c of SXR_COMPONENTS) {
            const subWrap = document.querySelector(`.cal-fld-substatus-wrap[data-substatus-pid="${sel}"][data-substatus-comp="${c}"]`);
            if (!subWrap) continue;
            const cs = _sxrNormStatus(post[c + '_status'] || post.status || 'In Progress');
            // data-val keeps the STORED status; the pill shows the same
            // substitution the full samples render uses.
            const shown = _calPillDisplayStatus(post, c, cs);
            subWrap.setAttribute('data-val', cs);
            const trigger = subWrap.querySelector('.cal-fld-substatus-trigger');
            if (trigger) {
                Array.from(trigger.classList).forEach(cls => {
                    if (cls.startsWith('cal-fld-status-')) trigger.classList.remove(cls);
                });
                trigger.classList.add('cal-fld-status-' + _sxrStatusSlug(shown));
                const labelEl = trigger.querySelector('.cal-fld-substatus-label');
                if (labelEl) labelEl.textContent = _sxrStatusLabel(shown);
            }
            // Reconcile the URGENT badge in place, same predicates as the full
            // render, so it can't linger after the component leaves the status
            // that earned it — and so a pill changing flavour swaps its button
            // rather than keeping the handler for the wrong recipient.
            const showUrgent = _sxrShowUrgent(post, c);
            const showKasperUrgent = !showUrgent && _sxrShowKasperUrgent(post, c);
            const wantKind = showUrgent ? 'editor' : showKasperUrgent ? 'kasper' : '';
            subWrap.classList.toggle('has-urgent', !!wantKind);
            let urgentEl = subWrap.querySelector('.cal-urgent-btn');
            if (urgentEl && (urgentEl.dataset.urgentKind || 'editor') !== wantKind) {
                urgentEl.remove();
                urgentEl = null;
            }
            if (wantKind && !urgentEl) {
                const escPid = _sxrEscAttr(pid);
                subWrap.insertAdjacentHTML('beforeend', wantKind === 'kasper'
                    ? _calUrgentButtonHtml(escPid, '_sxrSendKasperUrgentSlack', post, '', false, 'kasper')
                    : _calUrgentButtonHtml(escPid, '_sxrSendUrgentSlack', post));
            } else if (wantKind && urgentEl) {
                _calApplyUrgentButtonState(urgentEl, post, wantKind);
            }
        }
        const card = document.querySelector(`.cal-card[data-pid="${sel}"]`);
        if (card) {
            const chip = card.querySelector('.cal-client-status');
            if (chip) chip.innerHTML = _sxrClientCompPillsHtml(post);
        }
        // The Review/Sheet tab badges count by status — keep them in lockstep too.
        if (typeof _sxrUpdateReviewBadge === 'function') _sxrUpdateReviewBadge();
    }
    /* Repaint every card's status pill(s) IN PLACE from the already-merged
       sxrState.posts, without rebuilding the card (so its inputs / caret survive).
       Used by the realtime shortcut branches in loadSxrCards so a peer's status
       change (Kasper request-change → Tweaks Needed, an approval → next state)
       flips the pill LIVE even when the full render is skipped (no-visible-diff
       false-negative) or deferred (user mid-edit) — the note dot already refreshes
       there, and the derived status pill must too (the P1 realtime-status bug).
       Wrapped in _svPreserveFocus, gated to #sxrBody, so it can never steal the
       caret from a field being typed in (the PR-705 focus guard). _sxrUpdateCardStatusDisplay
       only mutates pill spans/classes + the URGENT badge (never an input node), so
       this is a pure repaint. */
    function _sxrRepaintLiveStatus() {
        const body = document.getElementById('sxrBody');
        if (!body) return;
        _svPreserveFocus(() => {
            try { (sxrState.posts || []).forEach(p => _sxrUpdateCardStatusDisplay(p.id)); } catch (e) {}
        }, body);
    }
    function _sxrAutosize(el) { if (!el) return; el.style.height = 'auto'; el.style.height = (el.scrollHeight + 2) + 'px'; }

    /* ── Thumbnail: reuse the pure derivation; FORK only the overlay-preserving
       media swap so a media-link edit can't wipe the Linear pile / warn. ── */
    const SXR_THUMB_OVERLAY_SEL = '.cal-thumb-linear-warn, .cal-linear-slot';
    function _sxrSetThumbMedia(thumbDiv, mediaHtml) {
        if (!thumbDiv) return;
        const overlays = Array.from(thumbDiv.children).filter(el => el.matches(SXR_THUMB_OVERLAY_SEL));
        thumbDiv.innerHTML = mediaHtml;
        overlays.forEach(el => thumbDiv.appendChild(el));
    }
    function _sxrOnThumbImgError(img) {
        const parent = img.parentElement;
        if (!parent) return;
        _sxrSetThumbMedia(parent, img.dataset.drive === '1' ? _calDriveWarnHtml() : _calThumbIconHtml());
    }
    function _sxrThumbContent(p) { return _sxrThumbMediaHtml(_sxrDeriveThumbInfo(p), '_sxrOnThumbImgError'); }
    function _sxrForceThumbRefresh(pid) {
        const card = document.querySelector(`.cal-card[data-pid="${pid}"]`);
        if (!card) return;
        const thumb = card.querySelector('.cal-card-thumb');
        const post = sxrState.posts.find(p => p.id === pid);
        if (thumb && post) _sxrSetThumbMedia(thumb, _sxrThumbContent(post));
    }
    function _sxrThumbClick(e, pid) {
        if (e.target.tagName === 'IMG' || e.target.closest('.cal-thumb-zoom')) _sxrOpenThumbLightbox(pid);
    }
    function _sxrOpenThumbLightbox(pid) {
        // Look in the active strip first; fall back to the Kasper sub-tab's
        // cross-client items so the review preview's lightbox works there too
        // (the Kasper card isn't in sxrState.posts).
        let post = sxrState.posts.find(p => p.id === pid);
        if (!post && typeof _sxrKasperState === 'object') {
            const it = (_sxrKasperState.items || []).find(x => x && x.post && x.post.id === pid);
            if (it) post = it.post;
        }
        const info = post ? _sxrDeriveThumbInfo(post) : null;
        if (!info || !info.url) return;
        const ovl = document.getElementById('sxrLightbox');
        // On the Kasper page the Samples view is not mounted; use Kasper's.
        if (!ovl) { if (typeof _kasperOpenLightbox === 'function') _kasperOpenLightbox(pid); return; }
        const img = ovl.querySelector('img');
        if (img) img.src = info.url;
        ovl.classList.add('open');
        document.body.classList.add('cal-modal-open');
    }

    /* ── Media link pills (Video / Thumbnail only — no caption link) ── */
    function _sxrOpenThumbnailFolder(pid) {
        const post = sxrState.posts.find(p => p.id === pid);
        const url = _calThumbnailFolderUrl(post, post && post.thumbnail_url);
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
    }

    function _sxrLinkFieldHtml(pid, fld, val, placeholder, ro, post) {
        const v = String(val || '').trim();
        const isThumb = fld === 'thumbnail_url';
        const kind = isThumb ? 'thumb' : 'post';
        const label = isThumb ? 'Thumbnail' : 'Video';
        const extIco = `<svg class="cal-link-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h4v4M13 3L7.5 8.5"/><path d="M11.5 9.5V12a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12V6A1.5 1.5 0 0 1 4 4.5h2.5"/></svg>`;
        const folderBtn = (isThumb && _calThumbnailFolderUrl(post, v))
            ? `<button type="button" class="cal-link-folder" tabindex="-1" onclick="_sxrOpenThumbnailFolder('${pid}')" title="Open parent folder">${_calThumbFolderIconSvg()}</button>`
            : '';
        const compareSlot = isThumb ? _thumbCompareSlotHtml('samples', post, false, 'link') : '';
        const pencil = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.4 2.6l2 2L6 12l-2.6.6L4 10z"/></svg>`;
        if (ro) {
            if (!v) return '';
            if (isThumb) return '';
            const href = /^https?:\/\//i.test(v) ? v : 'https://' + v;
            return `<div class="cal-link-field has-link cal-link-ro cal-link-${kind}"><a class="cal-link-pill-open" href="${_sxrEscAttr(href)}" target="_blank" rel="noopener noreferrer">${extIco}<span class="cal-link-label">${label}</span></a></div>`;
        }
        const input = `<input class="cal-link-input" type="url" data-pid="${pid}" data-fld="${fld}" value="${_sxrEsc(v)}" placeholder="${_sxrEscAttr(placeholder)}" oninput="_sxrOnLinkInput(this)" onblur="_sxrOnLinkBlur(this)">`;
        if (v) {
            return `<div class="cal-link-field has-link cal-link-${kind}" data-pid-wrap="${pid}" data-fld-wrap="${fld}">
                <button type="button" class="cal-link-pill-open" onclick="_sxrOpenLink('${pid}','${fld}')" title="Open in a new tab">${extIco}<span class="cal-link-label">${label}</span></button>
                ${folderBtn}
                ${compareSlot}
                <button type="button" class="cal-link-edit" tabindex="-1" onclick="_sxrEditLink('${pid}','${fld}')" title="Edit link">${pencil}</button>
                ${input}
            </div>`;
        }
        return `<div class="cal-link-field cal-link-${kind}" data-pid-wrap="${pid}" data-fld-wrap="${fld}">${input}</div>`;
    }
    function _sxrOnLinkInput(input) { _sxrOnFieldInput(input); }
    function _sxrOnLinkBlur(input) {
        _sxrOnFieldBlur(input);
        if (input.dataset.fld === 'thumbnail_url' || input.dataset.fld === 'asset_url') {
            _sxrForceThumbRefresh(input.dataset.pid);
            // Media presence gates SMM-review eligibility (_sxrHasMedia), so the
            // Review tab badge count can change with this edit — sync it in place
            // (the optimistic value is already in sxrState.posts, and a background
            // self-echo skips the full repaint via _sxrPostsEqualForRender).
            if (typeof _sxrUpdateReviewBadge === 'function') _sxrUpdateReviewBadge();
        }
        const field = input.closest('.cal-link-field');
        if (field) {
            const post = sxrState.posts.find(p => p.id === input.dataset.pid);
            field.outerHTML = _sxrLinkFieldHtml(input.dataset.pid, input.dataset.fld, input.value.trim(), input.placeholder, false, post);
        }
    }
    function _sxrOpenLink(pid, fld) {
        const input = document.querySelector(`.cal-link-field[data-pid-wrap="${pid}"][data-fld-wrap="${fld}"] .cal-link-input`);
        const v = input ? input.value.trim() : '';
        if (!v) return;
        window.open(/^https?:\/\//i.test(v) ? v : 'https://' + v, '_blank', 'noopener,noreferrer');
    }
    function _sxrEditLink(pid, fld) {
        const field = document.querySelector(`.cal-link-field[data-pid-wrap="${pid}"][data-fld-wrap="${fld}"]`);
        if (!field) return;
        field.classList.add('editing');
        const input = field.querySelector('.cal-link-input');
        if (input) { input.focus(); input.select(); }
    }

    /* ── Linear sub-issue pile (video + graphic), edit + commit with guards ── */
    function _sxrLinearSvg() { return `<svg viewBox="0 0 100 100" fill="currentColor" aria-hidden="true"><path d="M1.2 61.5a48.8 48.8 0 0 0 37.3 37.3zM.1 46.8 53.2 99.9a49.3 49.3 0 0 0 9-1.4L1.5 37.8a49 49 0 0 0-1.4 9zM3.8 30.9 69.1 96.2a49.5 49.5 0 0 0 7-3.6L7.4 23.9a49.5 49.5 0 0 0-3.6 7zM12.3 19 81 87.7A50 50 0 1 0 12.3 19z"/></svg>`; }
    function _sxrLinearSlotHtml(pid, url, comp) {
        /* Linear is retired (owner, 2026-09-25), the Samples twin of the
           Calendar change in PR 1605: no Linear sub-issue control on a sample --
           not the remove X, not the pencil, not the link button. With no way
           to edit a link, the "already linked to ... Move it here" conflict row
           (_sxrShowLinkConflict, reached only through _sxrLinearCommit) is
           unreachable too. Stored linear_issue_id / graphic_linear_issue_id
           are not read here, cleared or rewritten; a Linear-only link already
           counts as absent (_calCompLinked). The body below is kept,
           unreachable, so this is a one-line revert. */
        return '';
        // eslint-disable-next-line no-unreachable
        if (_isClientLink) return '';
        const which = comp || 'video';
        const u = String(url || '').trim();
        const label = which === 'graphic' ? 'graphic sub-issue' : 'video sub-issue';
        const compCls = ' cal-linear-btn-' + which;
        if (u) {
            const pencil = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11.4 2.6l2 2L6 12l-2.6.6L4 10z"/></svg>`;
            if (_writeUiLinkSlotSealed(which)) {
                // Same as the calendar: REMOVING survives the seal; only the
                // paste is refused.
                const cross = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>`;
                return `<button class="cal-linear-btn cal-linear-btn-linked${compCls}" type="button" onclick="_sxrLinearClear('${pid}','${which}')" title="Remove this ${label} link">${cross}</button>`;
            }
            return `<button class="cal-linear-btn cal-linear-btn-linked${compCls}" type="button" onclick="_sxrLinearEdit('${pid}','${which}')" title="Change the linked ${label}">${pencil}</button>`;
        }
        const warn = !_sxrIsBlankId(pid) ? ' cal-linear-btn-warn' : '';
        // Sealed and empty renders nothing, exactly as on the calendar: under
        // SyncView authority an unlinked Linear slot is the correct state.
        if (_writeUiLinkSlotSealed(which)) return '';
        return `<button class="cal-linear-btn${warn}${compCls}" type="button" onclick="_sxrLinearEdit('${pid}','${which}')" title="Link a Linear ${label}">${_sxrLinearSvg()}</button>`;
    }
    /* SyncView Production sub-issue link on a SAMPLE card — the samples twin of
       _calProdSlotHtml (owner 2026-08-19: "we should see the button to open it
       in our production"). Rendered only when the sample carries a native
       deliverable id for that component, so legacy linked-by-hand samples show
       nothing new. Read-only navigation into ?prod=1, never a write. */
    function _sxrProdSlotHtml(p, comp) {
        if (_isClientLink) return '';
        const which = comp === 'graphic' ? 'graphic' : 'video';
        const id = String((which === 'graphic' ? p.graphic_deliverable_id : p.video_deliverable_id) || '').trim();
        if (!id) return '';
        const label = which === 'graphic' ? 'graphic sub-issue' : 'video sub-issue';
        const href = svRoute.clean('/?prod=1&d=' + encodeURIComponent(id));
        const mark = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.6"/><path d="M6 10.2 10.2 6M7.2 6h3v3"/></svg>`;
        return `<a class="cal-linear-btn cal-prod-btn cal-linear-btn-${which}" href="${_sxrEscAttr(href)}" target="_blank" rel="noopener" title="Open the SyncView Production ${label} in a new tab">${mark}</a>`;
    }
    /* ── Fill a missing component, from the SAMPLE card that is missing it ──
     *
     * The samples twin of _calFillComponent, and it exists for the reason the
     * owner gave on 2026-09-07: "when there's a calendar that has a post that
     * is just a thumbnail, there's a little thing where we can add a video or a
     * thumbnail to the batch... but we don't have the same system for samples."
     *
     * IT IS WORSE HERE THAN ON THE CALENDAR. Measured live 2026-09-07 across
     * the 26 non-archived sample cards: 2 carry both components, 3 only a
     * video, 21 only a thumbnail, 0 neither. So 24 of 26, across 6 clients,
     * are half a post, against 127 of 688 on the calendar. A samples batch is
     * usually commissioned as thumbnails alone and then needs a video beside
     * one of them, which is exactly the gap this closes.
     *
     * NOTHING NEW IS ASKED OF THE SERVER, and that is not luck. `production-write`
     * has admitted `component_fill` from the `sxr` surface since the day the
     * operation shipped, and public.production_component_fill reads and locks
     * the card in `sample_reviews` rather than `calendar_posts` when the batch
     * carries purpose='samples'. Both halves were written for two surfaces and
     * only one ever got a button. This is that button; no migration and no
     * deploy stand between it and being live.
     *
     * The gate is the calendar's, rule for rule: a sibling to inherit the
     * batch, the Linear parent route, the sort position and the title from; an
     * empty slot BOTH ways so a legacy half-link is left to be repaired rather
     * than doubled; staff only; not on a blank row; not on an archived card;
     * and only where the target team is SyncView-authoritative, because under a
     * rollback the native create is refused at the database and the button
     * would be a dead one.
     */
    function _sxrFillSiblingId(p, which) {
        if (_isClientLink || !p) return '';
        const pid = String(p.id || '');
        if (!pid || _sxrIsBlankId(pid)) return '';
        if (String(p.status || '').toLowerCase() === 'archived') return '';
        const target = which === 'graphic' ? 'graphic' : 'video';
        const other = target === 'graphic' ? 'video' : 'graphic';
        const idOf = comp => String((comp === 'graphic'
            ? p.graphic_deliverable_id : p.video_deliverable_id) || '').trim();
        // Linear is retired: a stored Linear URL alone counts as absent.
        if (idOf(target)) return '';
        if (!_writeUiLinkSlotSealed(target)) return '';
        return idOf(other);
    }
    function _sxrFillComponentSlotHtml(p, which) {
        const sibling = _sxrFillSiblingId(p, which);
        if (!sibling) return '';
        const target = which === 'graphic' ? 'graphic' : 'video';
        const label = target === 'graphic' ? 'thumbnail' : 'video';
        const pid = String(p.id || '');
        const plus = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>`;
        return `<button class="cal-linear-btn cal-fill-btn cal-linear-btn-${target}" type="button"`
            + ` onclick="_sxrFillComponent('${_sxrEscAttr(pid)}','${target}')"`
            + ` title="This sample has no ${label} yet. Add one, in the same batch as its ${target === 'graphic' ? 'video' : 'thumbnail'}."`
            + ` aria-label="Add the missing ${label} to this sample">${plus}</button>`;
    }
    /* Deterministic in the card and team, so every press is the SAME write: the
       first creates and any later one replays and returns the row the first one
       made. Same contract as _calFillRequestId, under its own `sfill:` prefix
       so a samples fill and a calendar fill can never resolve to one deliverable
       id. The gateway derives that id from this string, and the two card
       tables mint their ids independently. */
    function _sxrFillRequestId(pid, team) {
        return ('sfill:' + team + ':' + String(pid || '')).replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 190);
    }
    /* Write ONLY this component slot back to the sample. sample-review-upsert
       copies just the keys the payload carries, so a fill cannot touch the
       name, the media links, the creative direction, the statuses, the tweaks
       or the other component.
     *
     * IT RUNS INSIDE THE PER-CARD SAVE QUEUE, and that is the whole safety of
     * it (Codex P1 on PR 1342). Awaiting the in-flight save once was not enough:
     * that save's `finally` starts a REPLACEMENT `_sxrSaveInFlight[pid]` for
     * any edit queued while it was draining, so the continuation resumed
     * beside a save this write had never waited for. The follow-on save is
     * usually a field-level patch that carries no link column, but the
     * whole-card branch (a new row, or `_sxrRetrySave` re-sending the current
     * row with an empty bucket) sends all four link columns from local state,
     * and a copy built before this update carries them EMPTY. Landing after
     * this write, it detaches the component that was just created while the
     * card reports success.
     *
     * So: drain with `_sxrAwaitCardSave` (which also flushes queued edits, not
     * merely the active save), then HOLD the lock across the write. Any flush
     * that starts meanwhile hits `if (_sxrSaveInFlight[pid]) return
     * _sxrAwaitCardSave(pid)` and re-reads local state afterwards, so its
     * whole-card copy carries the link this wrote rather than the emptiness
     * that preceded it. Released in a `finally` in the same order the save
     * engine releases it, so a throw here can never strand the card. */
    async function _sxrFillWriteCardLink(clientSlug, pid, team, deliverableId, issueUrl) {
        try { await _sxrAwaitCardSave(pid); } catch (e) {}
        let releaseSave;
        _sxrSaveInFlight[pid] = new Promise(resolve => { releaseSave = resolve; });
        try {
            const sample = team === 'graphics'
                ? { id: pid, graphic_deliverable_id: deliverableId, graphic_linear_issue_id: String(issueUrl || '') }
                : { id: pid, video_deliverable_id: deliverableId, linear_issue_id: String(issueUrl || '') };
            const response = await _sxrUpsertFetch(clientSlug, { client: clientSlug, sample, comments_base_at: '' }, 'samples-component-fill');
            const json = await response.json().catch(() => ({}));
            if (!response.ok || !json || json.ok !== true) throw new Error('sample_card_write_failed');
            // Our own row change is about to arrive on the realtime channel; mark
            // it as a local write so the strip is not rebuilt underneath the
            // person who just pressed the button, as every samples write does.
            _sxrSetLastLocalWriteAt(Date.now());
            /* THE VIEW MAY HAVE MOVED ON (Codex P2 on PR 1342). Staff switch client
               tabs while a request is in flight, and `sxrState.posts` then holds
               the NEW client's rows while `clientSlug` still names the old one.
               Writing that array under the old slug's cache key would leave one
               client's samples cached as another's, to be rendered on the next
               visit until its network read lands. The server write above is
               already correct and stays; only the local state, the cache and the
               repaint are skipped, and the next load of that client reads the
               link back from the row. */
            if (sxrClientSlug(sxrState.client) !== clientSlug) return;
            const post = sxrState.posts.find(item => item && item.id === pid);
            // The two columns this wrote, not the whole echo: the row on screen
            // may carry edits this write never sent, and the echo would undo them.
            if (post) Object.assign(post, sample);
            try { _sxrCacheWrite(clientSlug, sxrState.posts); } catch (e) {}
            /* Deferred while somebody is typing, exactly as the link adopter
               defers: a full _sxrRenderBody() detaches the focused input and eats
               the caret (the PR-705 focus guard). */
            try {
                if (typeof _sxrIsBusy === 'function' && _sxrIsBusy()) {
                    _sxrSetPendingBackgroundRender(true);
                    if (typeof _sxrSchedulePendingRender === 'function') _sxrSchedulePendingRender();
                } else {
                    _sxrRenderBody({ preserveScroll: true });
                }
            } catch (e) {}
        } finally {
            delete _sxrSaveInFlight[pid];
            if (releaseSave) releaseSave();
            /* THE QUEUED EDIT BELONGS TO THE CLIENT IT WAS TYPED ON (Codex P1
               on PR 1342, second pass). `_sxrFlushCardSave` derives `_saveSlug`
               and the row from `sxrState` AT FLUSH TIME, and a card absent from
               `sxrState.posts` is treated as a new row and INSERTED --
               `sample_reviews` is keyed by (client, id), so a flush that lands
               after a client switch writes one client's edit as a brand-new
               sample under another. Holding the lock is what opens that window
               twice over: `onSxrClientChange` calls `_sxrFlushAllPending`
               first, but every flush it starts hits
               `if (_sxrSaveInFlight[pid]) return _sxrAwaitCardSave(pid)` and
               defers behind THIS write, then wakes after the switch.

               So when the view has moved on the bucket leaves
               `_sxrPendingEdits`, which is what stops that deferred
               `_sxrAwaitCardSave`: it re-reads the map, finds nothing, and
               returns instead of writing to the wrong client.

               IT IS PARKED, NOT DROPPED (Codex P1 on PR 1342, fourth pass, and
               it was right about the first version of this). Deleting it traded
               a wrong-client write for silent data loss, and the person had no
               way to know: `onSxrClientChange` had already tried to flush that
               edit and its flush was sitting behind this very lock, so the
               bucket was its only copy. Parking keeps it against the slug and
               card it was typed on, `_sxrRestoreParkedEdits` puts it back the
               next time that client loads, and the normal engine flushes it
               there with the right `sxrState` -- so the status machinery, the
               Linear pushes and the repair refs all run as they would have. */
            if (_sxrPendingEdits[pid]) {
                if (sxrClientSlug(sxrState.client) === clientSlug) _sxrFlushCardSave(pid);
                else _sxrParkEditsForClient(clientSlug, pid);
            }
        }
    }
    /* Edits typed on a card whose client the view then left, held against the
       slug and card they belong to until that client is loaded again.
     *
     * The samples save engine reads `sxrState` at flush time, so a bucket
     * flushed after a client switch is written under whichever client is on
     * screen -- and `sample_reviews` is keyed by (client, id), so it lands as a
     * brand-new sample under someone else. The fill is the one place that can
     * hold the save lock long enough for `onSxrClientChange`'s own flush to be
     * still waiting when the switch happens, which is why the parking lives
     * here rather than in the engine.
     *
     * BOUNDED, because this is a repair and not a queue: one bucket per card
     * per client, and a cap so a tab left open for a week cannot grow it
     * without limit. Nothing here writes; restoring hands the edits back to the
     * engine, which does. */
    const _sxrParkedEdits = Object.create(null);
    const SXR_PARKED_EDIT_MAX_CARDS = 50;
    function _sxrParkEditsForClient(slug, pid) {
        const edits = _sxrPendingEdits[pid];
        delete _sxrPendingEdits[pid];
        const key = String(slug || '');
        if (!key || !edits || !Object.keys(edits).length) return;
        const forClient = _sxrParkedEdits[key] || (_sxrParkedEdits[key] = Object.create(null));
        if (!forClient[pid] && Object.keys(forClient).length >= SXR_PARKED_EDIT_MAX_CARDS) {
            _writeUiQueueDiagnostic('sxr', 'parked_edit_capacity_dropped',
                { kind: 'component_fill' }, { code: 'parked_edit_cap' });
            /* SAID OUT LOUD, like every other outcome on this path. The bucket
               already left `_sxrPendingEdits` two lines above and the cap
               refuses to take it, so this branch DESTROYS the edit -- the one
               thing parking exists to stop. A diagnostic row records it for
               whoever asks later; nobody asks later, because the person who
               typed it was never told it was gone. */
            showNotify('That edit was not saved',
                'This tab is already holding unsaved edits for ' + SXR_PARKED_EDIT_MAX_CARDS
                + ' other cards on ' + key + ', so this one could not be held as well. It was not'
                + ' written anywhere and cannot be brought back. Open ' + key + ' again to save the'
                + ' edits being held, then retype this one.');
            return;
        }
        /* WHOSE EDIT IT IS, kept with it (Codex P1 on PR 1342, fifth pass).
           Staff identity is shared through localStorage, so the account can
           change before that client is opened again -- and a restored bucket is
           flushed with whoever is signed in THEN. A parked status edit would go
           through the native gateway attributed to somebody who never made it.
           The principal is recorded here and compared on the way out. */
        const previous = forClient[pid];
        forClient[pid] = {
            principal: _writeUiPrincipalKey(),
            edits: Object.assign({}, previous && previous.edits, edits)
        };
        _writeUiQueueDiagnostic('sxr', 'queued_edit_parked_off_client',
            { kind: 'component_fill' }, { code: 'client_changed_during_fill' });
        /* SAID OUT LOUD, AND SAID ACCURATELY. The edit is held in this tab and
           nowhere else: it does not survive a reload, and promising that it
           "saves itself" would be a promise a page refresh breaks (Codex P1,
           fifth pass). So it says what is true and what to do about it. */
        showNotify('That edit is not saved yet',
            'A change you typed could not be saved while the client changed, so nothing was written to the wrong one. Open ' + key + ' again in this tab and it will save. If you reload first, retype it.');
    }
    /* Called after a successful load for `slug`, where `sxrState` finally
       describes the client these edits belong to. A card the load did not
       return is NOT restored: re-queuing it would make the engine insert it as
       a new row, which is the defect this exists to avoid. */
    function _sxrRestoreParkedEdits(slug) {
        const key = String(slug || '');
        const forClient = key && _sxrParkedEdits[key];
        if (!forClient) return 0;
        if (sxrClientSlug(sxrState.client) !== key) return 0;
        let restored = 0;
        const principalNow = _writeUiPrincipalKey();
        for (const pid of Object.keys(forClient)) {
            const entry = forClient[pid] || {};
            if (!(sxrState.posts || []).some(post => post && post.id === pid)) {
                delete forClient[pid];
                _writeUiQueueDiagnostic('sxr', 'parked_edit_card_gone',
                    { kind: 'component_fill' }, { code: 'card_absent_on_restore' });
                /* Told, for the same reason the principal-changed drop below is
                   told. This is the branch the person waited for: they were
                   promised "open the client again and it will save", they did,
                   and the card the load returned no longer includes theirs. Not
                   restoring is right -- re-queuing would make the engine INSERT
                   it as a brand-new sample, which is the defect parking exists
                   to avoid -- but silence turns a correct refusal into the
                   silent data loss of the promise. */
                showNotify('An unsaved edit was discarded',
                    'A change typed on a card of ' + key + ' was still waiting to be saved, and that'
                    + ' card is no longer in this client \u2014 archived, moved or removed while it'
                    + ' waited. Nothing was written, and the change is gone.');
                continue;
            }
            // Not this person's edit to send. Dropped rather than replayed under
            // a principal that never typed it, and said out loud.
            if (!principalNow || entry.principal !== principalNow) {
                delete forClient[pid];
                _writeUiQueueDiagnostic('sxr', 'parked_edit_principal_changed',
                    { kind: 'component_fill' }, { code: 'principal_changed_before_restore' });
                showNotify('An unsaved edit was discarded',
                    'A change typed here before the signed-in account changed was not saved, because it is not this account\u2019s to send. Nothing was written.');
                continue;
            }
            /* NEWER INPUT WINS (Codex P1 on PR 1342, fifth pass). Returning to a
               client paints from cache first, so somebody can be typing in this
               very card while the background load that triggers this restore is
               still in flight. Assigning the parked bucket LAST would overwrite
               what they just typed and flush the older value straight to the
               server. */
            _sxrPendingEdits[pid] = Object.assign({}, entry.edits, _sxrPendingEdits[pid] || {});
            delete forClient[pid];
            restored += 1;
            _sxrFlushCardSave(pid);
        }
        if (!Object.keys(forClient).length) delete _sxrParkedEdits[key];
        return restored;
    }
    window.peekSxrParkedEdits = function () {
        const out = {};
        for (const slug of Object.keys(_sxrParkedEdits)) out[slug] = Object.keys(_sxrParkedEdits[slug]);
        return out;
    };
    async function _sxrFillComponent(pid, which) {
        const target = which === 'graphic' ? 'graphic' : 'video';
        const team = target === 'graphic' ? 'graphics' : 'video';
        const label = target === 'graphic' ? 'thumbnail' : 'video';
        const post = sxrState.posts.find(item => item && item.id === pid);
        // Re-checked against live state, not the state the button was drawn
        // from: a tab left open while somebody else filled this slot must not
        // send the write at all.
        const siblingId = _sxrFillSiblingId(post, target);
        if (!siblingId) {
            showNotify('Nothing to add', 'This sample already has its ' + label + ', or its other half is missing. Reload to see the current state.');
            return;
        }
        const clientSlug = sxrClientSlug(sxrState.client);
        if (!clientSlug) return;
        const cardName = String((post && post.name) || '').trim();
        // Refused early as well as at confirm time, so somebody who is not
        // signed in is told before a dialog promises them anything.
        try { await _syncviewRequireStaffIdentity('intake'); }
        catch (error) {
            showNotify('Sign-in required', (error && error.message) || 'Admin or SMM sign-in required.');
            return;
        }
        // The live authority read, not the cached one the button was drawn from.
        const sealed = await _writeUiLinkSlotSealedLive(target);
        if (!sealed || sealed.sealed !== true) {
            const notice = _writeUiLinkSlotSealedNotice(target, sealed && sealed.reason || 'authority_unavailable');
            showNotify(notice[0], notice[1]);
            return;
        }
        /* THE VIEW CAN MOVE UNDER BOTH AWAITS ABOVE (Codex P1 on PR 1342, second
           pass). The identity read and the live authority read are network
           round trips, and staff switch Samples client tabs during them. The
           captured `clientSlug`, `post` and `siblingId` still describe the
           client that was on screen when the button was pressed, so a dialog
           that opened afterwards would sit over the NEW client while carrying
           the old one's identifiers -- and confirming it would mint real
           Production and Linear work for a client the person is no longer
           looking at. Re-checked here, and AGAIN inside the callback, because
           the dialog itself is a wait: it can sit open across a tab switch. */
        if (!_sxrFillStillCurrent(pid, target, clientSlug, siblingId)) {
            showNotify('The view moved on', 'Nothing was created. This sample is no longer the one on screen, so the button was not applied to it. Open its client again and press it there.');
            return;
        }
        // The principal that opened the dialog, as the write path itself
        // computes one, so the comparison below is against the same value the
        // gateway will be told about rather than a parallel notion of identity.
        const principalKey = _writeUiPrincipalKey();
        showConfirm(
            'Add the missing ' + label + '?',
            'This creates the ' + label + ' for ' + (cardName ? '“' + cardName + '”' : 'this sample')
                + ' on ' + clientSlug + ', in the same batch as its '
                + (target === 'graphic' ? 'video' : 'thumbnail')
                + ', and attaches it to that card. It appears in Production and mirrors to Linear.',
            async () => {
                if (!_sxrFillStillCurrent(pid, target, clientSlug, siblingId)) {
                    showNotify('The view moved on', 'Nothing was created. This sample is no longer the one on screen, so the button was not applied to it. Open its client again and press it there.');
                    return;
                }
                /* THE DIALOG IS A WAIT, AND TWO MORE THINGS MOVE UNDER IT
                   (Codex P1 x2 on PR 1342, third pass).

                   WHO. `_sxrFillComponentSubmit` never used the captured
                   `identity` -- it was a gate result and nothing more -- while
                   `_syncviewEfHeaders` reads `_syncviewStaffIdentityForHeaders()`
                   at REQUEST time. Staff identity is shared through localStorage
                   and synced across tabs by `_syncviewStaffIdentityStorageChanged`,
                   so a sign-in change in another tab lands in this one while the
                   dialog sits open, and the person who pressed Confirm is
                   recorded as the author of work somebody else asked for. The
                   identity is re-required (which re-verifies it, so a lapsed
                   verification is caught too) and its principal key compared
                   with the one that opened the dialog. The parameter is gone
                   from the submitter rather than left there unused, because an
                   argument nothing reads is a claim the code does not keep.

                   WHAT AUTHORITY. AGENTS.md: read back current runtime
                   authority before acting, never treat a snapshot as a
                   permanent guarantee. The read above happened BEFORE the
                   dialog, so a SyncView -> Linear rollback during the wait
                   would still have sent a create. The gateway refuses it and
                   nothing wrong is written, but the refusal is avoidable and
                   the boundary is ours to hold, not the server's. */
                try { await _syncviewRequireStaffIdentity('intake'); }
                catch (error) {
                    showNotify('Sign-in required', (error && error.message) || 'Admin or SMM sign-in required.');
                    return;
                }
                if (!principalKey || _writeUiPrincipalKey() !== principalKey) {
                    showNotify('The signed-in account changed',
                        'Nothing was created. This confirmation belongs to the person who opened it, and a different account is signed in now. Press the button again to create it as yourself.');
                    return;
                }
                const sealedNow = await _writeUiLinkSlotSealedLive(target);
                if (!sealedNow || sealedNow.sealed !== true) {
                    const notice = _writeUiLinkSlotSealedNotice(target, sealedNow && sealedNow.reason || 'authority_unavailable');
                    showNotify(notice[0], notice[1]);
                    return;
                }
                /* BOTH CHECKS AGAIN, AFTER THE LAST AWAIT (Codex P1 on PR 1342,
                   fourth pass). The authority read is a network round trip like
                   the two before it, so a cross-tab sign-in landing during THAT
                   one slipped past a principal comparison made before it. The
                   rule is simply that the last thing before the write is a
                   re-check, not that there is a re-check somewhere. */
                if (!principalKey || _writeUiPrincipalKey() !== principalKey) {
                    showNotify('The signed-in account changed',
                        'Nothing was created. This confirmation belongs to the person who opened it, and a different account is signed in now. Press the button again to create it as yourself.');
                    return;
                }
                if (!_sxrFillStillCurrent(pid, target, clientSlug, siblingId)) {
                    showNotify('The view moved on', 'Nothing was created. This sample is no longer the one on screen, so the button was not applied to it. Open its client again and press it there.');
                    return;
                }
                _sxrFillComponentSubmit(pid, target, team, label, siblingId, clientSlug);
            },
            'Add ' + label);
    }
    /* Is the card this fill was started for still the card on screen, and still
       missing the same component with the same sibling? Every asynchronous step
       between the press and the write re-asks it, so a client switch, a peer's
       fill or a reload that lands in between stops the write rather than
       redirecting it. */
    function _sxrFillStillCurrent(pid, target, clientSlug, siblingId) {
        if (sxrClientSlug(sxrState.client) !== clientSlug) return false;
        const current = sxrState.posts.find(item => item && item.id === pid);
        return !!current && _sxrFillSiblingId(current, target) === siblingId;
    }
    async function _sxrFillComponentSubmit(pid, target, team, label, siblingId, clientSlug) {
        const requestId = _sxrFillRequestId(pid, team);
        let result = null;
        let failure = null;
        try {
            const response = await fetch(PROD_WRITE_EF_URL, {
                method: 'POST', cache: 'no-store',
                headers: _syncviewEfHeaders({
                    apikey: CAL_SUPABASE_ANON_KEY,
                    Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY,
                    Accept: 'application/json', 'Content-Type': 'application/json'
                }, PROD_WRITE_EF_URL),
                body: JSON.stringify({
                    operation: 'component_fill',
                    surface: 'sxr',
                    client_slug: clientSlug,
                    card_id: pid,
                    team,
                    sibling_id: siblingId,
                    request_id: requestId,
                    source_edited_at: new Date().toISOString()
                })
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok || !body || body.ok !== true || body.native_committed !== true) {
                const error = new Error(String(body && body.error || 'native_write_failed'));
                error.code = String(body && body.error || 'native_write_failed');
                error.status = response.status;
                throw error;
            }
            result = body;
        } catch (error) { failure = error; }

        /* THE REPAIR ARM, shared with the calendar down to the lookup: both of
           these mean the component exists and this card is the stale half.
           Occupied because somebody filled it, and idempotency_conflict because
           somebody ELSE filled it (the actor is part of the dedup identity).
           Neither is a reason to leave the card unlinked, which is the very
           state this feature exists to end. */
        if (failure && ['component_fill_team_occupied', 'idempotency_conflict'].includes(String(failure.code || ''))) {
            const existing = await _calFillLookupExisting(clientSlug, pid, team).catch(() => null);
            if (existing && existing.id) {
                try {
                    await _sxrFillWriteCardLink(clientSlug, pid, team, String(existing.id), existing.linear_issue_url);
                    // The row somebody else made may itself still be draining.
                    if (!String(existing.linear_issue_url || '').trim()) _sxrAdoptLinksAfterCreate(clientSlug);
                    showNotify('Already there', 'This sample already had a ' + label + '. The card is linked to it now.');
                    return;
                } catch (repairError) { failure = repairError; }
            }
        }
        /* `component_fill_card_missing` means something different HERE than it
           does on the calendar, and the shared handler's answer to it (evict
           the display caches, tell the reader to reload) would be wrong twice
           over on a sample.

           The RPC picks which table to read the card from by the BATCH purpose:
           `sample_reviews` when it is 'samples', `calendar_posts` otherwise. A
           sample whose batch is recorded purpose='calendar' is therefore looked
           for among the calendar cards, where it has never been. Measured
           2026-09-07: 3 of the 24 half-complete sample cards live in one such
           batch, minted by the F42 adoption path, its children carrying
           origin='samples' while the batch itself says 'calendar'. The card is
           not missing, the cache is not stale, and no reload changes anything,
           so this says what is actually true and stops there. OPEN_REPAIRS 162
           carries the two ways to close it; both are the owner's to pick. */
        if (failure && String(failure.code || '') === 'component_fill_card_missing') {
            _writeUiQueueDiagnostic('sxr', 'ui_write_failure', { kind: 'component_fill' }, failure);
            showNotify('This sample can’t be completed yet',
                'Nothing was created. Its batch is recorded as a calendar batch, so the write looked for this card among the calendar cards. Reloading will not help. Tell the owner, and quote this code: component_fill_card_missing.');
            return;
        }
        if (failure) {
            _writeUiReportFailure('sxr', 'component_fill', failure);
            return;
        }
        const item = result && result.item && typeof result.item === 'object' ? result.item : {};
        if (!String(item.id || '')) {
            _writeUiReportFailure('sxr', 'component_fill',
                Object.assign(new Error('native_response_refresh_failed'), { code: 'native_response_refresh_failed' }));
            return;
        }
        try {
            await _sxrFillWriteCardLink(clientSlug, pid, team, String(item.id), item.linear_issue_url);
        } catch (error) {
            /* The component IS made, and the retry is genuinely safe (the request
               id is deterministic, so it replays and re-attempts this same card
               write), so say exactly that rather than reporting a failure that
               would send someone looking for work that is already there. */
            showNotify('The ' + label + ' was created',
                'It is in Production, but this card could not be linked to it just yet. Press the button again in a moment and it will finish the job.');
            return;
        }
        /* THE LINEAR URL IS USUALLY NOT IN THAT RESPONSE (Codex P2 on PR 1342,
           second pass). On a live fill the gateway schedules the outbound drain
           and answers `mirror_pending: true` before the issue exists, so the
           card is written with the deliverable id and an EMPTY Linear url. That
           is enough to retire the fill button, which means nothing on the card
           asks for the link any more and it would sit empty until an unrelated
           reload happened to run the adopter. This is the same hole a freshly
           created sample had, and `_sxrAdoptLinksAfterCreate` is the answer
           already written for it: four guarded polls across the window the
           mirror actually takes (measured 15s on the 2026-08-20 create), each
           one abandoning if the view moved on, skipping any slot already
           filled, and refusing a row whose card_id binds elsewhere. */
        if (!String(item.linear_issue_url || '').trim()) _sxrAdoptLinksAfterCreate(clientSlug);
        showNotify('Added', result && result.mirror_pending === true
            ? 'The ' + label + ' is on this sample; the Linear mirror is still draining.'
            : 'The ' + label + ' is on this sample.');
    }
    function _sxrLinearPileHtml(pid, p) {
        const v = _sxrLinearSlotHtml(pid, p.linear_issue_id, 'video');
        const g = _sxrLinearSlotHtml(pid, p.graphic_linear_issue_id, 'graphic');
        const pv = _sxrProdSlotHtml(p, 'video');
        const pg = _sxrProdSlotHtml(p, 'graphic');
        // The fill button takes the place the missing component would have
        // occupied, so a half-complete sample reads as one pile with a gap to
        // close rather than as a card that is simply missing something.
        const fv = _sxrFillComponentSlotHtml(p, 'video');
        const fg = _sxrFillComponentSlotHtml(p, 'graphic');
        if (!v && !g && !pv && !pg && !fv && !fg) return '';
        return `<div class="cal-linear-slot cal-linear-pile" data-linear-slot="${pid}" onclick="event.stopPropagation()">${v}${pv}${fv}${g}${pg}${fg}</div>`;
    }
    /* The samples twin of _calAdoptDeliverableLinks. A native sample is
       materialized before the Linear mirror finishes draining, so its
       linear_issue_id / graphic_linear_issue_id can be empty at creation while
       the deliverable ids are already set — the reported live case: the video
       url had drained in time, the graphics url (GRA issue) had not, and
       nothing ever came back for it. Reads the deliverable rows, writes the
       missing url onto the sample row, guarded so a superseded load or an
       id that no longer matches never writes. */
    /* The adopter runs as a tail task of loadSxrCards — but creating a sample
       does NOT reload the tab (the card is spliced into local state), so a
       freshly created sample kept the orange "Link the Linear sub-issue"
       banner until somebody happened to reload. Measured on a real 2026-08-20
       create: the card landed at 15:10:40 and its Linear issue was minted at
       15:10:55, so even a reload fired at create time would have found nothing
       to adopt. Poll a few times across that window instead.

       Every attempt is the SAME guarded adopter: it re-reads _sxrLoadSeq and
       abandons if the view moved on, skips any slot already filled, and
       refuses a row whose card_id binds elsewhere. So a late timer that fires
       after the user switched clients is a no-op, and a duplicate adopt is
       impossible. */
    const SXR_ADOPT_AFTER_CREATE_DELAYS_MS = [4000, 10000, 20000, 45000];
    function _sxrAdoptLinksAfterCreate(slug) {
        const target = String(slug || '').trim();
        if (!target) return;
        SXR_ADOPT_AFTER_CREATE_DELAYS_MS.forEach(delay => {
            setTimeout(() => {
                try {
                    if (typeof sxrClientSlug !== 'function' || typeof sxrState === 'undefined'
                        || !sxrState || sxrClientSlug(sxrState.client) !== target) return;
                    _sxrAdoptDeliverableLinks(_sxrLoadSeq, target).catch(() => {});
                } catch (error) { /* a background top-up never surfaces */ }
            }, delay);
        });
    }
    async function _sxrAdoptDeliverableLinks(seq, slug) {
        if (seq !== _sxrLoadSeq) return 0;
        const wanted = new Map();
        for (const post of sxrState.posts || []) {
            if (!post || _sxrIsBlankId(post.id)) continue;
            for (const component of ['video', 'graphic']) {
                const field = component === 'video' ? 'linear_issue_id' : 'graphic_linear_issue_id';
                if (String(post[field] || '').trim()) continue;
                const deliverableId = _writeUiNativeId(post, component);
                if (!deliverableId || wanted.has(deliverableId)) continue;
                wanted.set(deliverableId, { pid: post.id, component, field });
            }
        }
        if (!wanted.size) return 0;
        const rows = await _calFetchDeliverableLinkRows([...wanted.keys()]);
        if (seq !== _sxrLoadSeq || !rows.size) return 0;
        let adopted = 0;
        for (const [deliverableId, slot] of wanted) {
            const row = rows.get(deliverableId);
            const url = String((row && row.linear_issue_url) || '').trim();
            if (!url) continue;
            const boundCard = String((row && row.card_id) == null ? '' : row.card_id).trim();
            if (boundCard && boundCard !== slot.pid) continue;
            const post = (sxrState.posts || []).find(p => p && p.id === slot.pid);
            if (!post || String(post[slot.field] || '').trim()) continue;
            if (_writeUiNativeId(post, slot.component) !== deliverableId) continue;
            try {
                const resp = await _writeUiTrackSave('sxr', 'sample_link_adopt', () => ({ client_slug: slug, id: String(post.id || '') }), () => _sxrUpsertFetch(slug, { client: slug, sample: { id: post.id, [slot.field]: url, updated_at: new Date().toISOString() }, comments_base_at: '' }, 'link-adopt'), { requireOk: true });
                const json = await resp.json().catch(() => ({}));
                if (!json || json.ok !== true) continue;
                post[slot.field] = url;
                adopted += 1;
            } catch (error) {
                console.warn('[Samples] could not adopt the deliverable link for ' + slot.component, error);
            }
        }
        if (adopted && seq === _sxrLoadSeq) {
            try { _sxrCacheWrite(slug, sxrState.posts); } catch (e) {}
            /* Adoption finishes a fetch and an upsert AFTER the load returned, so
               this repaint can land while the SMM is mid-edit. Route it through
               the same deferred-render guard loadSxrCards uses for background
               reloads, or a full _sxrRenderBody() would detach the focused input
               and eat the caret. preserveScroll on both legs: the adopter lands
               late enough that the user may well have scrolled. */
            if (typeof _sxrIsBusy === 'function' && _sxrIsBusy()) {
                _sxrSetPendingBackgroundRender(true);
                if (typeof _sxrSchedulePendingRender === 'function') _sxrSchedulePendingRender();
            } else {
                _sxrRenderBody({ preserveScroll: true });
            }
        }
        return adopted;
    }
    function _sxrTitleRowHtml(pid, p, ro, editableText) {
        const nameRo = (editableText == null) ? ro : !editableText;
        return `<div class="cal-title-name-wrap"><input class="cal-fld-name" type="text" data-pid="${pid}" data-fld="name" value="${_sxrEsc(p.name)}" placeholder="Untitled sample" oninput="_sxrOnFieldInput(this)" onblur="_sxrOnFieldBlur(this)"${nameRo ? ' readonly' : ''}><span class="cal-title-fade" aria-hidden="true"></span></div>${_svSaveIndHtml(pid, null, p && p._saveError ? (typeof p._saveError === 'string' ? p._saveError : 'Save failed') : '')}`;
    }
    function _sxrLinearEdit(pid, comp) {
        if (_isClientLink) return;
        const which = comp || 'video';
        if (_writeUiLinkSlotSealed(which)) {
            const notice = _writeUiLinkSlotSealedNotice(which, 'syncview_authoritative');
            showNotify(notice[0], notice[1]);
            return;
        }
        const row = document.querySelector(`[data-title-row="${pid}"]`);
        if (!row) return;
        const post = sxrState.posts.find(p => p.id === pid);
        const cur = post ? String((which === 'graphic') ? (post.graphic_linear_issue_id || '') : (post.linear_issue_id || '')) : '';
        const ph = which === 'graphic' ? 'Paste the GRA (graphic) sub-issue link…' : 'Paste the VID (video) sub-issue link…';
        row.innerHTML = `<input class="cal-linear-input" type="url" value="${_sxrEscAttr(cur)}" placeholder="${_sxrEscAttr(ph)}" onkeydown="_sxrLinearKey(event,'${pid}','${which}')" onblur="_sxrLinearCommit(this,'${pid}','${which}')">`;
        const inp = row.querySelector('input');
        if (inp) { inp.focus(); inp.select(); }
    }
    /* The sample-review twin of _calLinearClear -- see the reasoning there. */
    function _sxrLinearClear(pid, comp) {
        if (_isClientLink) return;
        const which = comp || 'video';
        const label = which === 'graphic' ? 'thumbnail' : 'video';
        /* The unfixed twin of the calendar dialog, corrected the same way and
           for the same reason. _sxrAdoptDeliverableLinks refills any EMPTY link
           column from the sample native deliverable on the next load and again
           on the after-create timers, so on a native sample the clear is real
           for a moment and then undone -- while this dialog promised it would
           stick. Clearing does not touch the deliverable id, so there is no
           version of this where the adopter stays away.
           The BEHAVIOUR is deliberately unchanged. The adopter exists because a
           native sample is materialized before the Linear mirror drains, and the
           reported live case was a graphics URL that arrived late; suppressing
           it for cleared rows would trade an honest sentence for a real gap.
           The trap in copying the calendar version verbatim is the state object:
           this reads sxrState.posts, and calState.posts here would silently take
           the non-native branch for every sample.

           The promise is CONDITIONAL for the same reason the calendar twin is:
           a stored deliverable id proves the field is non-empty and nothing
           more, while the adopter also needs the row to read back, to carry a
           linear_issue_url, to still be bound to THIS sample, and to save. See
           the note on _calLinearClear. */
        const post = (sxrState.posts || []).find(p => p && p.id === pid);
        const native = post ? _writeUiNativeId(post, which) : '';
        const body = native
            ? 'This clears the ' + label + ' Linear link on this sample. The issue itself is not touched. This sample is linked to a SyncView deliverable, so if that deliverable still holds the link it will come back on the next load -- clearing it here does not clear it there.'
            : 'This unlinks the ' + label + ' Linear sub-issue from this sample. The issue itself is not touched, and nothing else about the sample changes.';
        showConfirm('Remove this link?', body,
            () => { _sxrLinearCommit({ dataset: {}, value: '' }, pid, which); }, 'Remove it');
    }
    function _sxrLinearKey(e, pid, comp) {
        if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.target.dataset.cancel = '1'; e.target.blur(); }
    }
    function _sxrLinearExpectPrefix(which) { return which === 'graphic' ? 'GRA' : 'VID'; }
    async function _sxrLinearCommit(input, pid, comp) {
        const which = comp || 'video';
        const fld = which === 'graphic' ? 'graphic_linear_issue_id' : 'linear_issue_id';
        const cancelled = input.dataset.cancel === '1';
        const val = input.value.trim();
        const post = sxrState.posts.find(p => p.id === pid);
        const cur = post ? String(post[fld] || '') : '';
        const changed = !cancelled && val !== cur;
        const restoreRow = () => {
            const row = document.querySelector(`[data-title-row="${pid}"]`);
            if (row) row.innerHTML = _sxrTitleRowHtml(pid, post || { id: pid }, _isClientLink);
        };
        const applyCommit = (value) => {
            if (post) post[fld] = value;
            if (!_sxrPendingEdits[pid]) _sxrPendingEdits[pid] = {};
            _sxrPendingEdits[pid][fld] = value;
            _sxrFlushCardSave(pid);
            if (value) _sxrArchivedRemove(sxrClientSlug(sxrState.client), [value]);
            _sxrRenderBody({ preserveScroll: true });
            if (value && post && typeof _sxrSyncStatusFromLinear === 'function') _sxrSyncStatusFromLinear(pid, value, which);
        };
        if (!changed) { restoreRow(); return; }
        if (val) {
            // Seal guard first, on a live authority read -- the calendar twin
            // carries the full reasoning. Clearing (`val === ''`) is untouched.
            const seal = await _writeUiLinkSlotSealedLive(which);
            if (seal.sealed) {
                const notice = _writeUiLinkSlotSealedNotice(which, seal.reason);
                showNotify(notice[0], notice[1]);
                restoreRow();
                return;
            }
            const ident = _sxrIdentFromUrl(val);
            const looksLinear = /^https?:\/\//i.test(val) && /(^|[./])linear\.app\//i.test(val);
            if (!looksLinear || !ident) {
                showNotify('That isn’t a Linear link', 'Paste a Linear sub-issue URL like https://linear.app/your-team/issue/' + _sxrLinearExpectPrefix(which) + '-123. What you entered has no Linear issue id, so it wasn’t saved.');
                restoreRow(); return;
            }
            const prefix = ident.split('-')[0];
            const want = _sxrLinearExpectPrefix(which);
            if ((prefix === 'GRA' || prefix === 'VID') && prefix !== want) {
                const isG = prefix === 'GRA';
                showConfirm('Wrong slot for this link?', 'That looks like a ' + (isG ? 'GRAPHIC (GRA-)' : 'VIDEO (VID-)') + ' sub-issue, but you’re setting the ' + (which === 'graphic' ? 'GRAPHIC' : 'VIDEO') + ' link. Use it here anyway?', () => applyCommit(val), 'Use it anyway');
                return;
            }
            const conflict = _sxrLinkConflict(val, pid);
            if (conflict) { _sxrShowLinkConflict(pid, which, val, conflict); return; }
        }
        applyCommit(val);
    }
    let _sxrPendingLinkMove = Object.create(null);
    function _sxrLinkConflict(link, selfPid) {
        const key = _sxrLinkKey(link);
        if (!key) return null;
        const archived = _sxrArchivedRefs(sxrClientSlug(sxrState.client));
        for (const p of sxrState.posts) {
            if (!p || p.id === selfPid) continue;
            if (String(p.status || '').toLowerCase() === 'archived') continue;
            if (_sxrIsArchivedRef(p, archived)) continue;
            if (_sxrLinkKey(p.linear_issue_id) === key || _sxrLinkKey(p.graphic_linear_issue_id) === key) return p;
        }
        return null;
    }
    function _sxrShowLinkConflict(pid, which, val, conflict) {
        _sxrPendingLinkMove[pid] = { which, val, oldPid: conflict.id };
        const row = document.querySelector(`[data-title-row="${pid}"]`);
        if (!row) return;
        const nm = String(conflict.name || '').trim() || 'Untitled sample';
        row.innerHTML = `<div class="cal-link-conflict" data-link-conflict="${_sxrEscAttr(pid)}"><span class="cal-link-conflict-msg">This Linear sub-issue is already linked to “${_sxrEsc(nm)}”.</span><span class="cal-link-conflict-actions"><button type="button" class="cal-link-conflict-move" onclick="_sxrMoveLinkConfirm('${pid}')">Move it here</button><button type="button" class="cal-link-conflict-cancel" onclick="_sxrLinkConflictCancel('${pid}')">Cancel</button></span></div>`;
    }
    /* Put the ordinary title row back where a conflict row is rendered. Shared
       by Cancel and by a refused Move so the two cannot drift: a conflict row
       left on screen after the pending move is gone is a dead control. */
    function _sxrRestoreTitleRow(pid) {
        const post = sxrState.posts.find(p => p.id === pid);
        const row = document.querySelector(`[data-title-row="${pid}"]`);
        if (row) row.innerHTML = _sxrTitleRowHtml(pid, post || { id: pid }, _isClientLink);
    }
    function _sxrLinkConflictCancel(pid) {
        delete _sxrPendingLinkMove[pid];
        _sxrRestoreTitleRow(pid);
    }
    function _sxrMoveLinkConfirm(pid) {
        const mv = _sxrPendingLinkMove[pid];
        if (!mv) return;
        delete _sxrPendingLinkMove[pid];
        /* A REFUSED MOVE MUST NOT LEAVE THE CONFLICT ROW BEHIND (Codex finding
           3, 2026-09-08). The pending move is dropped on the line above --
           before `_sxrMoveLink` has had a chance to refuse -- so when the seal
           refuses (item 176) or the client changed underneath (finding 2), the
           rendered "Move it here" row stayed on screen with nothing behind it:
           `_sxrPendingLinkMove[pid]` is gone, so every further click returns at
           the `if (!mv)` guard and does nothing at all. The user is told the
           move was refused and then handed a button that silently no-ops.
           Dropping the pending move first is still right -- retaining it would
           leave a second click able to re-fire a write that was just refused --
           so the row is restored instead, exactly as Cancel does. */
        Promise.resolve(_sxrMoveLink(mv.oldPid, pid, mv.which, mv.val))
            .then(moved => { if (!moved) _sxrRestoreTitleRow(pid); })
            .catch(() => _sxrRestoreTitleRow(pid));
    }
    /* Returns TRUE only when the move actually happened. Every refusal answers
       false so `_sxrMoveLinkConfirm` can put the title row back (finding 3). */
    async function _sxrMoveLink(oldPid, newPid, which, val) {
        if (_isClientLink) return false;   // moving a Linear link is SMM-only
        /* FREEZE THE CLIENT BEFORE THE AUTHORITY AWAIT (Codex finding 2,
           2026-09-08). The seal read below is network-bound, and
           `sxrState.client` / `sxrState.posts` are mutable: staff can click
           "Move it here" and switch Samples clients while it is in flight. The
           continuation then reads the NEW client's state, `newPid` matches
           nothing in it, and the writes below still stamp
           `_sxrPendingEdits[newPid]` and call `_sxrFlushCardSave(newPid)` --
           which, finding no id it recognises, treats it as a new row and saves
           the previous client's card into the client now on screen. That is a
           cross-client WRITE, and the client lifecycle is the one thing that
           must not break, so the odds do not soften it.
           `addSxrBlankCard` right below already freezes its slug across exactly
           this kind of wait; this is the same guard on the same shape. Silent,
           like that one: the user has moved on to another client and a toast
           about the one they left is noise. `slug` is captured here rather than
           after the seal because the code below uses it too, and it must be the
           INITIATING client's. */
        const slug = sxrClientSlug(sxrState.client);
        /* The calendar twin `_calMoveLink` gates here and says exactly why:
           "a guard which lives only on the surface that usually calls it is a
           guard with a hole in it." THIS TWIN WAS THAT HOLE. `_sxrLinearCommit`
           does check the seal before `applyCommit`, but the conflict flow does
           not go through it -- `_sxrMoveLinkConfirm` is a different surface and
           reaches this function directly. So a staff member could move a Linear
           link onto a samples card on a syncview-authoritative team, and the
           move also fires `_sxrSyncStatusFromLinear`, which POSTs
           `linear-subissues` and will hang once that endpoint is gone.
           Seal FIRST, before the old card's link is cleared: a refusal that has
           already mutated the source card is the item-66 shape, where the tool
           refuses and still leaves the user worse off than before they clicked. */
        const moveSeal = await _writeUiLinkSlotSealedLive(which);
        // The client check comes FIRST: if the tab moved on, this move belongs
        // to nobody on screen, and a seal notice about the client they left is
        // the wrong thing to say.
        if (!slug || sxrClientSlug(sxrState.client) !== slug) return false;
        if (moveSeal.sealed) {
            const notice = _writeUiLinkSlotSealedNotice(which, moveSeal.reason);
            showNotify(notice[0], notice[1]);
            return false;
        }
        const key = _sxrLinkKey(val);
        const newFld = which === 'graphic' ? 'graphic_linear_issue_id' : 'linear_issue_id';
        const oldPost = sxrState.posts.find(p => p.id === oldPid);
        if (oldPost) {
            let cleared = false;
            ['linear_issue_id', 'graphic_linear_issue_id'].forEach(f => {
                if (_sxrLinkKey(oldPost[f]) === key) {
                    oldPost[f] = '';
                    if (!_sxrPendingEdits[oldPid]) _sxrPendingEdits[oldPid] = {};
                    _sxrPendingEdits[oldPid][f] = '';
                    cleared = true;
                }
            });
            if (cleared) {
                _sxrRenderBody({ preserveScroll: true });
                try { await _sxrFlushCardSave(oldPid); } catch (e) {}
                /* THE SECOND AWAIT HAS THE SAME HAZARD AS THE FIRST (Codex,
                   2026-09-08). The freeze above protects the AUTHORITY read;
                   this flush is a separate network round trip, and a client
                   switch during it lands the continuation on the new client's
                   `sxrState.posts` with the same consequence: `newPid` matches
                   nothing, and the writes below stamp `_sxrPendingEdits[newPid]`
                   and call `_sxrFlushCardSave(newPid)` anyway, saving the
                   previous client's card into the client now on screen. One
                   guarded await and one unguarded one is not a guard; it is the
                   same hole moved four lines down.
                   The source card's link IS already cleared and saved at this
                   point, so bailing here leaves the move half-done. That is
                   deliberate and it is the lesser harm: an incomplete move on a
                   client the user has navigated away from is recoverable and
                   visible, while a cross-client WRITE is neither. Closing the
                   half-state needs a transactional move, which is not this
                   repair. */
                if (sxrClientSlug(sxrState.client) !== slug) return false;
            }
        }
        const newPost = sxrState.posts.find(p => p.id === newPid);
        if (newPost) newPost[newFld] = val;
        if (!_sxrPendingEdits[newPid]) _sxrPendingEdits[newPid] = {};
        _sxrPendingEdits[newPid][newFld] = val;
        _sxrFlushCardSave(newPid);
        if (val) _sxrArchivedRemove(slug, [val]);
        _sxrRenderBody({ preserveScroll: true });
        if (val && typeof _sxrSyncStatusFromLinear === 'function') _sxrSyncStatusFromLinear(newPid, val, which);
        return true;
    }
    function _sxrLinkDuplicatePeers(post) {
        if (!post) return [];
        let archived = null;
        try { archived = _sxrArchivedRefs(sxrClientSlug(sxrState.client)); } catch (e) {}
        const isArch = (p) => (String((p && p.status) || '').toLowerCase() === 'archived') || (() => { try { return !!(archived && _sxrIsArchivedRef(p, archived)); } catch (e) { return false; } })();
        if (isArch(post)) return [];
        // Linear is retired: only a shared SyncView deliverable is a conflict.
        const vKey = _sxrLinkKey(post.video_deliverable_id), gKey = _sxrLinkKey(post.graphic_deliverable_id);
        if (!vKey && !gKey) return [];
        const vPeers = new Set(), gPeers = new Set();
        for (const p of (sxrState.posts || [])) {
            if (!p || p.id === post.id || isArch(p)) continue;
            const nm = String(p.name || '').trim() || 'Untitled sample';
            const pv = _sxrLinkKey(p.video_deliverable_id), pg = _sxrLinkKey(p.graphic_deliverable_id);
            if (vKey && (pv === vKey || pg === vKey)) vPeers.add(nm);
            if (gKey && (pv === gKey || pg === gKey)) gPeers.add(nm);
        }
        const out = [];
        if (vPeers.size) out.push({ comp: 'video', names: [...vPeers] });
        if (gPeers.size) out.push({ comp: 'graphic', names: [...gPeers] });
        return out;
    }
    function _sxrDupeWarnText(groups) {
        return groups.map(g => 'Same ' + (g.comp === 'graphic' ? 'thumbnail' : 'video') + ' work item as ' + g.names.join(', ')).join(' · ');
    }

    /* ── Status menu + Set-all (samples: 6 statuses, video+graphic, always settable) ── */
    let _sxrOpenStatusMenu = null;
    function _sxrCloseStatusMenu() {
        if (!_sxrOpenStatusMenu) return;
        const m = _sxrOpenStatusMenu.el;
        if (m && m.parentNode) m.parentNode.removeChild(m);
        _sxrOpenStatusMenu = null;
    }
    function _sxrStatusToggleMenu(event, pid, triggerEl, comp) {
        event.stopPropagation(); event.preventDefault();
        const which = comp || '';
        const menuKey = pid + (which ? '|' + which : '');
        if (_sxrOpenStatusMenu && _sxrOpenStatusMenu.key === menuKey) { _sxrCloseStatusMenu(); return; }
        _sxrCloseStatusMenu();
        const post = sxrState.posts.find(p => p.id === pid);
        if (!post) return;
        const currentStatus = which ? (post[which + '_status'] || 'In Progress') : (post.status || 'In Progress');
        const menu = document.createElement('div');
        menu.className = 'cal-fld-status-menu';
        /* Same treatment as the calendar twin. NOTE the divergence: SXR_STATUSES
           has no 'N/A', so the note cannot offer it -- samples carry exactly two
           components and both are expected to exist. */
        const _sxrMenuBlocked = {};
        if (which) {
            for (const s of SXR_STATUSES) {
                const reason = _sxrReviewBlockReason(post, which, s);
                if (reason) _sxrMenuBlocked[s] = reason;
            }
        }
        menu.innerHTML = SXR_STATUSES.map(s => {
            const blocked = _sxrMenuBlocked[s];
            return `<button type="button" class="cal-fld-status-item cal-fld-status-${_sxrStatusSlug(s)}${s === currentStatus ? ' active' : ''}"${blocked ? ` disabled title="${_sxrEscAttr(blocked)}"` : ''} onclick="_sxrStatusPick('${_sxrEscAttr(pid)}','${_sxrEscAttr(s)}','${_sxrEscAttr(which)}')">${_sxrEsc(_sxrStatusLabel(s))}</button>`;
        }).join('')
            + (Object.keys(_sxrMenuBlocked).length
                ? `<div class="cal-fld-status-note">${_sxrEsc('The review statuses need ' + (which === 'graphic' ? 'a thumbnail' : 'a video') + ' first.')}</div>`
                : '');
        document.body.appendChild(menu);
        const rect = triggerEl.getBoundingClientRect();
        const menuW = Math.max(menu.offsetWidth, 200), menuH = menu.offsetHeight;
        let left = rect.left; const maxLeft = window.innerWidth - menuW - 10;
        if (left > maxLeft) left = maxLeft; if (left < 10) left = 10;
        menu.style.left = left + 'px';
        const gap = 5, spaceBelow = window.innerHeight - rect.bottom - 10, spaceAbove = rect.top - 10;
        let top;
        if (menuH <= spaceBelow || spaceBelow >= spaceAbove) top = Math.max(10, Math.min(rect.bottom + gap, window.innerHeight - menuH - 10));
        else top = Math.max(10, rect.top - menuH - gap);
        menu.style.top = top + 'px';
        menu.style.minWidth = Math.max(rect.width, 200) + 'px';
        requestAnimationFrame(() => menu.classList.add('open'));
        _sxrOpenStatusMenu = { pid, key: menuKey, comp: which, el: menu, triggerEl };
    }
    /* ── The samples twin of the calendar's review-content gate ──────────
       Mirrored per docs/features/SAMPLES_PARITY_LOG.md: a component cannot be
       sent for review while the thing to review is empty. Samples carry only
       video and thumbnail (no caption, no title), so only those two rules
       apply, and both read the SAME media fields the calendar does --
       asset_url and thumbnail_url -- which is why the content predicate is
       _kasperCompReviewable rather than a samples-local copy of it. A second
       copy is exactly the drift this log exists to prevent. */
    const SXR_REVIEW_STATUSES = new Set(['For SMM Approval', 'Kasper Approval', 'Client Approval']);
    function _sxrStatusNeedsContent(status) {
        return SXR_REVIEW_STATUSES.has(_sxrNormStatus(status || ''));
    }
    function _sxrCompHasContent(post, comp) { return _kasperCompReviewable(post, comp); }
    function _sxrReviewBlockReason(post, comp, status) {
        if (!_sxrStatusNeedsContent(status)) return '';
        if (_sxrCompHasContent(post, comp)) return '';
        if (comp === 'video') return 'Add the video URL before sending it for approval.';
        if (comp === 'graphic') return 'Add the thumbnail URL before sending it for approval.';
        return '';
    }
    const SXR_COMP_LABEL = { video: 'Video', graphic: 'Thumbnail' };
    function _sxrStatusPick(pid, status, comp) {
        if (_isClientLink) return;
        _sxrCloseStatusMenu();
        const which = comp || '';
        const post = sxrState.posts.find(p => p.id === pid);
        if (!post) return;
        /* Bucket created only once the move is going ahead -- an empty
           _sxrPendingEdits entry is a full-card resend, same as the calendar. */
        if (which) {
            const key = which + '_status';
            if (post[key] === status) return;
            const blocked = _sxrReviewBlockReason(post, which, status);
            if (blocked) {
                showNotify('Nothing to review yet', blocked);
                return;
            }
            if (!_sxrPendingEdits[pid]) _sxrPendingEdits[pid] = {};
            post[key] = status;
            _sxrPendingEdits[pid][key] = status;
            post.status = computeSampleOverallStatus(post);
            _sxrPendingEdits[pid].status = post.status;
            _sxrMarkLocalStatus(pid, which);
        } else {
            if (post.status === status) return;
            const movable = SXR_COMPONENTS.filter(c => !_sxrReviewBlockReason(post, c, status));
            const held = SXR_COMPONENTS.filter(c => !movable.includes(c));
            if (!movable.length) {
                showNotify('Nothing to review yet', 'Both parts of this sample are still empty, so there is nothing to send for approval.');
                return;
            }
            if (!_sxrPendingEdits[pid]) _sxrPendingEdits[pid] = {};
            movable.forEach(c => { post[c + '_status'] = status; _sxrPendingEdits[pid][c + '_status'] = status; });
            post.status = computeSampleOverallStatus(post);
            _sxrPendingEdits[pid].status = post.status;
            if (held.length) {
                showNotify('Sent without ' + held.map(c => String(SXR_COMP_LABEL[c] || c).toLowerCase()).join(' and '),
                    'Those are still empty, so they stayed where they were. Add the content and set them separately.');
            }
            _sxrMarkLocalStatus(pid);
        }
        _sxrClearStaleApprovals(post, _sxrPendingEdits[pid]);
        post.updated_at = new Date().toISOString();
        _sxrRenderBody({ preserveScroll: true });
        _sxrFlushCardSave(pid);
    }
    function _sxrOpenSetAllMenu(event, pid, triggerEl) {
        event.stopPropagation(); event.preventDefault();
        const menuKey = pid + '|__setall__';
        if (_sxrOpenStatusMenu && _sxrOpenStatusMenu.key === menuKey) { _sxrCloseStatusMenu(); return; }
        _sxrCloseStatusMenu();
        const post = sxrState.posts.find(p => p.id === pid);
        if (!post) return;
        const menu = document.createElement('div');
        menu.className = 'cal-fld-status-menu';
        /* The header spells out what Set all will actually do for THIS sample,
           the way the calendar twin already did. It was a hardcoded "Apply to
           Video & Thumbnail" over a card whose own pill, 180 lines up, was
           greyed out because one of those two has no work item behind it. */
        const sxrSettable = SXR_COMPONENTS.filter(c => _sxrSetAllSettable(post, c));
        const sxrSkipped = SXR_COMPONENTS.filter(c => !sxrSettable.includes(c));
        const sxrHeadLabel = sxrSettable.length === 0
            ? 'Neither component has a work item behind it'
            : sxrSkipped.length
                ? `Apply to ${sxrSettable.map(c => COMP_LABELS[c]).join(', ')} — ${sxrSkipped.map(c => COMP_LABELS[c]).join(' & ')} ${sxrSkipped.length === 1 ? 'has' : 'have'} no work item`
                : 'Apply to Video & Thumbnail';
        menu.innerHTML = `<div class="cal-fld-setall-menu-head">${_sxrEsc(sxrHeadLabel)}</div>`
            + SXR_STATUSES.map(s => `<button type="button" class="cal-fld-status-item cal-fld-status-${_sxrStatusSlug(s)}" onclick="_sxrSetAllStatus('${_sxrEscAttr(pid)}','${_sxrEscAttr(s)}')">${_sxrEsc(_sxrStatusLabel(s))}</button>`).join('');
        document.body.appendChild(menu);
        const rect = triggerEl.getBoundingClientRect();
        const menuW = Math.max(menu.offsetWidth, 220), menuH = menu.offsetHeight;
        let left = rect.left; const maxLeft = window.innerWidth - menuW - 10;
        if (left > maxLeft) left = maxLeft; if (left < 10) left = 10;
        let top = rect.bottom + 6;
        if (top + menuH > window.innerHeight - 10) top = Math.max(10, rect.top - menuH - 6);
        menu.style.left = left + 'px'; menu.style.top = top + 'px';
        requestAnimationFrame(() => menu.classList.add('open'));
        _sxrOpenStatusMenu = { el: menu, key: menuKey, triggerEl };
    }
    /* This returned `true` unconditionally AND was dead -- neither the menu nor
       the apply loop called it -- so Set all iterated SXR_COMPONENTS regardless
       of whether a component had anything behind it.

       That is not a copy defect, it is DATA LOSS, and worse than the sweep
       filed it. An unlinked component reaches _sxrPushStatusToLinear with no
       url and no native id, so _writeUiClassifyTargetless raises
       native_link_required. The throw lands in the VIDEO leg, before the
       graphic leg and before the source upsert: both pills flip on screen, a
       "Write not saved" dialog appears, the card takes a _saveError badge, and
       nothing persists -- the legitimate half is destroyed with the impossible
       one. When it is the GRAPHIC that is unlinked the video leg has already
       committed natively, so the deliverable moves and the sample row does not,
       and the two systems disagree until someone notices.

       MEASURED: 1,135 samples have a fully unlinked video component and 1,045 a
       fully unlinked graphic; 205 have video unlinked while graphic IS linked --
       the exact mixed card where Set all looks sensible and takes the good half
       down with it.

       The predicate is _calCompLinked, NOT the old url-only calendar test.
       Porting that verbatim was the named trap: it would skip a native-only
       card whose pill is unlocked and whose write would have succeeded. */
    function _sxrSetAllSettable(post, comp) {
        if (!post) return false;
        return _calCompLinked(post, comp);
    }
    const _SXR_SETALL_TERMINAL = new Set(['Approved']);
    function _sxrSetAllSkipKey(status) { return 'sxr-skip-setall-confirm-' + String(status).toLowerCase().replace(/\s+/g, '-'); }
    function _sxrSetAllStatus(pid, status) {
        if (_isClientLink) return;
        _sxrCloseStatusMenu();
        const post = sxrState.posts.find(p => p.id === pid);
        if (!post) return;
        const linked = SXR_COMPONENTS.filter(c => _sxrSetAllSettable(post, c));
        const settable = linked.filter(c => !_sxrReviewBlockReason(post, c, status));
        const heldEmpty = linked.filter(c => !settable.includes(c));
        const skipped = SXR_COMPONENTS.filter(c => !linked.includes(c));
        if (!settable.length && heldEmpty.length) {
            showNotify('Nothing to review yet', 'Every part you can set is still empty, so there is nothing to send for approval.');
            return;
        }
        if (!settable.length) {
            showNotify('Nothing to set', 'Neither component on this sample has a work item behind it, so there is nothing here to update.');
            return;
        }
        const apply = (dontAskAgain) => {
            if (dontAskAgain) { try { localStorage.setItem(_sxrSetAllSkipKey(status), '1'); } catch {} }
            const staged = {};
            let changed = false;
            for (const c of settable) {
                const key = c + '_status';
                if (_sxrNormStatus(post[key] || '') === status) continue;
                post[key] = status; staged[key] = status; changed = true;
            }
            if (!changed) return;
            if (!_sxrPendingEdits[pid]) _sxrPendingEdits[pid] = {};
            const edits = Object.assign(_sxrPendingEdits[pid], staged);
            post.status = computeSampleOverallStatus(post);
            edits.status = post.status;
            _sxrMarkLocalStatus(pid);
            _sxrClearStaleApprovals(post, edits);
            post.updated_at = new Date().toISOString();
            _sxrRenderBody({ preserveScroll: true });
            _sxrFlushCardSave(pid);
            if (heldEmpty.length) {
                showNotify('Set without ' + heldEmpty.map(c => String(SXR_COMP_LABEL[c] || c).toLowerCase()).join(' and '),
                    'Those are still empty, so they stayed where they were. Add the content and set them separately.');
            }
        };
        let skip = false;
        try { skip = localStorage.getItem(_sxrSetAllSkipKey(status)) === '1'; } catch {}
        if (_SXR_SETALL_TERMINAL.has(status) && !skip) {
            const body = `Set ${settable.map(c => COMP_LABELS[c]).join(' and ')} to "${status}".`
                + (skipped.length
                    ? ` (${skipped.map(c => COMP_LABELS[c]).join(' and ')} ${skipped.length === 1 ? 'has' : 'have'} no work item behind ${skipped.length === 1 ? 'it' : 'them'} — skipped.)`
                    : '');
            showConfirm(`Set all to "${status}"?`, body, apply, status, "Don't ask me again");
        } else apply(false);
    }
    /* Close the samples status/set-all menu on outside click / resize / scroll —
       the calendar registers the same three listeners for _calOpenStatusMenu.
       Without them the body-appended menu floated forever (a full re-render
       doesn't remove it), and _sxrIsBusy() kept reporting "busy" while it
       dangled, deferring every background/realtime repaint indefinitely. */
    document.addEventListener('click', (e) => {
        if (!_sxrOpenStatusMenu) return;
        if (_sxrOpenStatusMenu.el && _sxrOpenStatusMenu.el.contains(e.target)) return;
        if (_sxrOpenStatusMenu.triggerEl && _sxrOpenStatusMenu.triggerEl.contains(e.target)) return;
        _sxrCloseStatusMenu();
    }, true);
    window.addEventListener('resize', _sxrCloseStatusMenu);
    window.addEventListener('scroll', _sxrCloseStatusMenu, true);

    /* _sxrCommentsBtnHtml — real version in Surface 4 (open-tweak count), hoisted.
       openSxrComments — real version in Surface 5 (Notes modal), hoisted. */

    /* ── Creative direction (samples-only) + client-visibility eye ── */
    function _sxrCreativeHidden(p) { const h = p && p.hide_creative_direction; return h === true || h === 1 || String(h || '').toLowerCase() === 'true' || String(h || '') === '1'; }
    function _sxrCreativeDirectionHtml(pid, p, editableText) {
        const v = String(p.creative_direction || '');
        const hidden = _sxrCreativeHidden(p);
        if (_isClientLink && hidden) return '';   // client never sees creative direction hidden from them
        const eyeOn = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"/><circle cx="8" cy="8" r="2"/></svg>`;
        const eyeOff = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.2A6.8 6.8 0 0 1 8 3.5c4.5 0 7 4.5 7 4.5a12 12 0 0 1-2 2.6M9.6 9.4A2 2 0 0 1 6.6 6.6"/><path d="M3 3l10 10"/></svg>`;
        const eye = _isClientLink ? '' : `<button type="button" class="sxr-cd-eye${hidden ? ' is-hidden' : ''}" onclick="_sxrToggleCreativeVisibility('${pid}')" title="${hidden ? 'Hidden from client — click to show' : 'Visible to client — click to hide'}" aria-label="Toggle client visibility">${hidden ? eyeOff : eyeOn}</button>`;
        return `<div class="sxr-cd-wrap"><textarea class="sxr-cd-input" rows="2" data-pid="${pid}" data-fld="creative_direction" placeholder="Creative direction" oninput="_sxrOnFieldInput(this);_sxrAutosize(this)" onfocus="_sxrOnTextEditFocus(this)" onblur="_sxrOnTextEditBlur(this)" onkeydown="_sxrOnTextEditKey(event)"${editableText ? '' : ' readonly'}>${_sxrEsc(v)}</textarea>${eye}</div>`;
    }
    function _sxrTextDragLock(el, lock) {
        const card = el && el.closest('.cal-card');
        if (!card) return;
        if (lock) {
            if (card.dataset.sxrDragPrev == null) card.dataset.sxrDragPrev = card.getAttribute('draggable') || 'false';
            card.setAttribute('draggable', 'false');
        } else if (card.dataset.sxrDragPrev != null) {
            card.setAttribute('draggable', card.dataset.sxrDragPrev);
            delete card.dataset.sxrDragPrev;
        }
    }
    function _sxrOnTextEditFocus(el) {
        _sxrTextDragLock(el, true);
        if (el && el.tagName === 'TEXTAREA') _sxrAutosize(el);
    }
    function _sxrOnTextEditBlur(el) {
        _sxrTextDragLock(el, false);
        _sxrOnFieldBlur(el);
    }
    function _sxrOnTextEditKey(e) {
        if (e) e.stopPropagation();
    }
    function _sxrToggleCreativeVisibility(pid) {
        if (_isClientLink) return;
        const post = sxrState.posts.find(p => p.id === pid);
        if (!post) return;
        const next = _sxrCreativeHidden(post) ? '' : '1';
        post.hide_creative_direction = next;
        if (!_sxrPendingEdits[pid]) _sxrPendingEdits[pid] = {};
        _sxrPendingEdits[pid].hide_creative_direction = next;
        _sxrFlushCardSave(pid);
        _sxrRenderBody({ preserveScroll: true });
    }
    function _sxrClientCompPillsHtml(p) {
        // Read-only per-component status pills for the client Sheet (Surface 6).
        return SXR_COMPONENTS.map(c => {
            const cs = _sxrNormStatus(p[c + '_status'] || 'In Progress');
            const label = COMP_LABELS[c] + ': ' + _sxrStatusLabel(cs);
            return `<span class="cal-review-sub-pill cal-fld-status-${_sxrStatusSlug(cs)}" data-comp-pill="${c}" title="${_sxrEscAttr(label)}">${_sxrEsc(label)}</span>`;
        }).join('');
    }

    /* ── The card ── */
    function renderSxrOrganizer() {
        const posts = sxrState.posts.slice()
            .filter(p => p.id === sxrState.focusPid || !_isClientLink || (typeof _sxrIsClientReady === 'function' && _sxrIsClientReady(p)))
            .sort((a, b) => Number(a.order_index || 0) - Number(b.order_index || 0));
        const empty = posts.length === 0;
        const plus = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
        const canAddCard = !_isClientLink;
        const addBtn = empty
            ? (canAddCard ? `<button class="cal-card-add cal-card-add-hero" type="button" onclick="addSxrBlankCard()" title="Add a sample">${plus}<span>Add the first sample</span></button>` : `<div class="cal-filter-empty"><div class="cal-filter-empty-title">No samples to show yet</div><div class="cal-filter-empty-sub">Finished samples will appear here.</div></div>`)
            : (canAddCard ? `<button class="cal-card-add" type="button" onclick="addSxrBlankCard()" title="Add a sample">${plus}</button>` : '');
        const selectBar = (sxrState.selectMode && !_isClientLink)
            ? `<div class="cal-select-bar" id="sxrSelectBar"><span class="cal-select-count" id="sxrSelectCount">0 selected</span><button type="button" class="cal-select-archive" id="sxrSelectArchive" onclick="_sxrArchiveSelected()" disabled>Archive</button><button type="button" class="cal-select-cancel" onclick="_sxrToggleSelectMode()">Done</button></div>`
            : '';
        return `<div class="cal-organizer-wrap"><div class="cal-organizer-strip${empty ? ' is-empty' : ''}${sxrState.selectMode ? ' cal-selecting' : ''}" id="sxrStrip">${posts.map(p => _sxrRenderInlineCard(p, false, false)).join('')}${addBtn}</div>${selectBar}</div>`;
    }
    // URGENT ping predicate — Video only, at Tweaks Needed with a Linear sub-issue
    // to tag the editor from. Mirror of _calShowUrgent.
    function _sxrShowUrgent(p, c) {
        if (!p || c !== 'video') return false;
        if (_sxrNormStatus(p[c + '_status'] || '') !== 'Tweaks Needed') return false;
        return !!(String(p.linear_issue_id || '').trim() || String(p.video_deliverable_id || '').trim());
    }
    /* Kasper-ping gate for samples. Same rule as the calendar's
       _calShowKasperUrgent over the two components samples carries, MINUS the
       content check -- and that asymmetry is deliberate, not an oversight.
       The calendar queue drops a content-less card into its stranded notice, so
       a ping there would point at a card Kasper cannot see; the samples queue
       keeps it (membership is _sxrPostKasperVisible, which asks about status and
       the graphic link only), so the ping lands on a card that really is in his
       list. Copying the calendar's gate here would hide a working affordance,
       which is the failure AGENTS.md's permissive directive is about. The two
       gates track their own queues; if the samples queue ever starts stranding
       cards, this is the line that has to follow it. */
    function _sxrShowKasperUrgent(p, c) {
        if (!_kasperUrgentPingOn(sxrState && sxrState.client)) return false;   // same gate as the calendar
        if (!p || !c) return false;
        if (_sxrNormStatus(p[c + '_status'] || '') !== 'Kasper Approval') return false;
        if (c === 'graphic' && !_calCompLinked(p, c)) return false;
        return true;
    }
    function _sxrKasperUrgentPingComp(post) {
        return SXR_REVIEW_COMPONENTS.find(c => _sxrShowKasperUrgent(post, c)) || '';
    }
    async function _sxrPersistKasperUrgentForPost(clientOrSlug, post, comp, ping) {
        if (!post || !post.id) return null;
        const slug = sxrClientSlug(clientOrSlug);
        const patch = _calBuildKasperUrgentPatch(post, comp, ping || {});
        const resp = await _writeUiTrackSave('sxr', 'urgent_marker_save', () => ({ client_slug: slug, id: String(post.id || '') }), () => fetch(SXR_UPSERT_EF_URL, {
            method: 'POST',
            headers: _sxrWriteHeaders('ui', SXR_UPSERT_EF_URL),
            body: JSON.stringify({ client: slug, sample: patch, comments_base_at: '' })
        }), { requireOk: true });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || !json || !json.ok) throw new Error((json && json.error) || ('HTTP ' + resp.status));
        const echo = (json && json.sample && typeof json.sample === 'object') ? json.sample : patch;
        Object.assign(post, patch, echo);
        if (!String(post[comp + '_status_at'] || '').trim() && String(post.kasper_urgent_status_at || '').trim()) {
            post[comp + '_status_at'] = post.kasper_urgent_status_at;
        }
        try { _sxrUpdateCardStatusDisplay(post.id); } catch (e) {}
        return echo;
    }
    /* Ping Kasper about a SAMPLE waiting on him. Same dispatch, same marker;
       the DM link points at his Samples subtab rather than the calendar queue,
       because that is the only place this card is visible to him. */
    async function _sxrSendKasperUrgentSlack(event, pid) {
        if (event) { event.preventDefault(); event.stopPropagation(); }
        // Live re-read, not the boot cache: the switch must stop an open tab.
        // Same as the calendar: the roster needs to be asked about a client.
        if (!(await _kasperUrgentPingOnLive(sxrState && sxrState.client))) { showNotify('Urgent pings are off', 'The Kasper urgent ping is currently disabled. Nothing was sent.'); return; }
        const btn = (event && event.currentTarget) ? event.currentTarget : null;
        if (btn && btn.dataset.urgentSent === '1') { if (typeof showNotify === 'function') showNotify('Already sent', _urgentKind('kasper').alreadySent); return; }
        const post = sxrState.posts.find(p => p.id === pid);
        if (!post) return;
        const comp = _sxrKasperUrgentPingComp(post);
        if (!comp) { if (typeof showNotify === 'function') showNotify('Not waiting on Kasper', 'Nothing on this sample is at Kasper Approval right now, so there is nothing to ping him about.'); return; }
        _calUrgentSlackDispatch(btn, String(post.linear_issue_id || '').trim(), String(sxrState.client || '').trim(), post.name, {
            kind: 'kasper',
            payload: { url: _calKasperReviewUrl('samples'), surface: 'samples', component: comp },
            persist: (ping) => _sxrPersistKasperUrgentForPost(sxrState.client, post, comp, ping)
        });
    }
    async function _sxrPersistUrgentSentForPost(clientOrSlug, post, ping) {
        if (!post || !post.id) return null;
        const slug = sxrClientSlug(clientOrSlug);
        const patch = _calBuildUrgentPatch(post, ping || {});
        const resp = await _writeUiTrackSave('sxr', 'urgent_marker_save', () => ({ client_slug: slug, id: String(post.id || '') }), () => fetch(SXR_UPSERT_EF_URL, {
            method: 'POST',
            headers: _sxrWriteHeaders('ui', SXR_UPSERT_EF_URL),
            body: JSON.stringify({ client: slug, sample: patch, comments_base_at: '' })
        }), { requireOk: true });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || !json || !json.ok) throw new Error((json && json.error) || ('HTTP ' + resp.status));
        const echo = (json && json.sample && typeof json.sample === 'object') ? json.sample : patch;
        Object.assign(post, patch, echo);
        if (!String(post.video_status_at || '').trim() && String(post.video_urgent_status_at || '').trim()) {
            post.video_status_at = post.video_urgent_status_at;
        }
        try { _sxrUpdateCardStatusDisplay(post.id); } catch (e) {}
        return echo;
    }
    // Ping the editor in #video-editing for an urgent video tweak. Reuses the
    // calendar's shared confirm→POST→latch dispatch (same webhook + message), just
    // sourcing the video sub-issue + client name from sxr state.
    function _sxrSendUrgentSlack(event, pid) {
        if (event) { event.preventDefault(); event.stopPropagation(); }
        const btn = (event && event.currentTarget) ? event.currentTarget : null;
        if (btn && btn.dataset.urgentSent === '1') { if (typeof showNotify === 'function') showNotify('Already sent', 'An urgent ping for this video was already sent in this session.'); return; }
        const post = sxrState.posts.find(p => p.id === pid);
        if (!post) return;
        const issue = String(post.linear_issue_id || '').trim();
        if (!String(post.video_deliverable_id || '').trim()) { if (typeof showNotify === 'function') showNotify(URGENT_EDITOR_NEEDS_NATIVE.title, URGENT_EDITOR_NEEDS_NATIVE.text); return; }
        const sourceClient = sxrState.client;
        _calUrgentSlackDispatch(btn, issue, String(sourceClient || '').trim(), post.name, {
            native: String(post.video_deliverable_id || '').trim() ? { action: 'native_urgent_dispatch', client_slug: sxrClientSlug(sxrState.client),
                deliverable_id: _writeUiNativeId(post, 'video'), card_id: String(post.id), surface: 'samples', video_status_at: String(post.video_status_at || '') } : null,
            currentClientSlug: () => sxrClientSlug(sxrState.client),
            currentPost: () => sxrState.posts.find(p => p.id === pid),
            persist: (ping) => _sxrPersistUrgentSentForPost(sourceClient, post, ping)
        });
    }
    function _sxrRenderInlineCard(p, isBlank, isCurrent) {
        const pid = _sxrEscAttr(p.id);
        const ro = _isClientLink && !isBlank;
        const editableText = !_isClientLink || isBlank;
        const selectable = sxrState.selectMode && !ro && !isBlank;
        const draggable = (isBlank || selectable || ro) ? 'false' : 'true';   // client Sheet is read-only — no drag
        // Linear is retired: no sample asks to be linked to a Linear sub-issue.
        const needsLinear = false;
        const dupePeers = (!_isClientLink && !isBlank) ? _sxrLinkDuplicatePeers(p) : [];
        const subStatusHtml = (ro || _isClientLink) ? '' : SXR_COMPONENTS.map(c => {
            const cs = _sxrNormStatus(p[c + '_status'] || 'In Progress');
            // Same unlinked -> N/A display rule as the calendar card.
            const shownStatus = _calPillDisplayStatus(p, c, cs);
            const slug = _sxrStatusSlug(shownStatus);
            // A component with no Linear sub-issue can't be routed, so its status
            // pill is locked until one is linked (mirror _calRenderInlineCard).
            const lock = !_calCompLinked(p, c) ? ' is-locked' : '';
            // URGENT ping — Video only, once it's at Tweaks Needed with a Linear
            // sub-issue we can tag the editor from.
            const showUrgent = _sxrShowUrgent(p, c);
            const showKasperUrgent = !showUrgent && _sxrShowKasperUrgent(p, c);
            const urgentBtn = showUrgent
                ? _calUrgentButtonHtml(pid, '_sxrSendUrgentSlack', p)
                : showKasperUrgent
                    ? _calUrgentButtonHtml(pid, '_sxrSendKasperUrgentSlack', p, '', false, 'kasper')
                    : '';
            return `<div class="cal-fld-substatus-wrap cal-comp-${c}${lock}${(showUrgent || showKasperUrgent) ? ' has-urgent' : ''}" data-val="${_sxrEscAttr(cs)}" data-substatus-pid="${pid}" data-substatus-comp="${c}">
                <button type="button" class="cal-fld-substatus-trigger cal-fld-status-${slug}" onclick="_sxrStatusToggleMenu(event,'${pid}',this,'${c}')"${lock ? ` disabled title="${_calEscAttr(WRITE_UI_NO_WORK_ITEM_TEXT)}"` : ''}>
                    <span class="cal-fld-substatus-dot" style="background:${COMP_PILL_COLORS[c]}"></span>
                    <span class="cal-fld-substatus-comp">${_sxrEsc(COMP_LABELS[c])}</span>
                    <span class="cal-fld-substatus-label">${_sxrEsc(_sxrStatusLabel(shownStatus))}</span>
                </button>${urgentBtn}
            </div>`;
        }).join('');
        const setAllHtml = (ro || _isClientLink || isBlank) ? '' : `<button type="button" class="cal-fld-setall" onclick="_sxrOpenSetAllMenu(event,'${pid}',this)" title="Set both statuses to the same value">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 9a2.5 2.5 0 0 0 3.5 0L13 6.5a2.5 2.5 0 0 0-3.5-3.5L8 4.5"/><path d="M9 7a2.5 2.5 0 0 0-3.5 0L3 9.5a2.5 2.5 0 0 0 3.5 3.5L8 11.5"/></svg>
            <span class="cal-fld-setall-label">Set all to…</span>
            <svg class="cal-fld-setall-chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>
        </button>`;
        const statusHtml = ro
            ? `<div class="cal-client-status">${_sxrClientCompPillsHtml(p)}</div>`
            : `${(setAllHtml || subStatusHtml) ? `<div class="cal-card-substatus-row">${setAllHtml}${subStatusHtml}</div>` : ''}`;
        const selChk = `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 7.5L6 11l5.5-7"/></svg>`;
        const warnHtml = needsLinear ? `<button type="button" class="cal-thumb-linear-warn" onclick="event.stopPropagation();_sxrLinearEdit('${pid}')" title="Link this sample to its Linear sub-issue">${_sxrLinearSvg()}Link the Linear sub-issue</button>` : '';
        return `<div class="cal-card cal-card-edit${isBlank ? ' is-blank' : ''}${isCurrent ? ' cal-card-current' : ''}${ro ? ' cal-card-ro' : ''}${selectable ? ' cal-card-selectable' : ''}${selectable && sxrState.selected.has(p.id) ? ' cal-card-selected' : ''}" data-pid="${pid}" draggable="${draggable}">
            ${selectable ? `<div class="cal-card-select-overlay" onclick="_sxrCardSelectClick(event,'${pid}')"><span class="cal-card-select-check">${selChk}</span></div>` : ''}
            ${(isBlank || ro) ? '' : `<span class="cal-card-grip" title="Drag to reorder"><svg viewBox="0 0 16 16" fill="currentColor"><circle cx="6" cy="4" r="1.4"/><circle cx="10" cy="4" r="1.4"/><circle cx="6" cy="8" r="1.4"/><circle cx="10" cy="8" r="1.4"/><circle cx="6" cy="12" r="1.4"/><circle cx="10" cy="12" r="1.4"/></svg></span>`}
            ${(isBlank || _isClientLink) ? '' : `<button class="cal-card-link" type="button" data-card-link="${pid}" onclick="_sxrCopyCardLink(event,'${pid}')" title="Copy a link to this card"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 9a2.5 2.5 0 0 0 3.5 0L13 6.5a2.5 2.5 0 0 0-3.5-3.5L8 4.5"/><path d="M9 7a2.5 2.5 0 0 0-3.5 0L3 9.5a2.5 2.5 0 0 0 3.5 3.5L8 11.5"/></svg></button>`}
            ${(isBlank || _isClientLink) ? '' : `<button class="cal-card-del" type="button" onclick="archiveSxrCard('${pid}')" title="Archive"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7"/></svg></button>`}
            <div class="cal-card-thumb" onclick="_sxrThumbClick(event,'${pid}')">${warnHtml}${_sxrThumbContent(p)}${(_isClientLink || ro) ? '' : _sxrLinearPileHtml(pid, p)}</div>
            <div class="cal-card-body">
                ${dupePeers.length ? `<div class="cal-dupe-warn" title="${_sxrEscAttr(_sxrDupeWarnText(dupePeers))}. Two cards can't own the same work item — archive one of them.">⚠ ${_sxrEsc(_sxrDupeWarnText(dupePeers))} — archive one of them</div>` : ''}
                <div class="cal-title-row" data-title-row="${pid}">${_sxrTitleRowHtml(pid, p, ro, editableText)}</div>
                ${_sxrLinkFieldHtml(pid, 'thumbnail_url', p.thumbnail_url, 'Thumbnail URL (Google Drive image)', _isClientLink || ro, p)}
                ${_sxrLinkFieldHtml(pid, 'asset_url', p.asset_url, 'Video URL (Frame.io / Drive)', _isClientLink || ro, p)}
                ${_sxrCreativeDirectionHtml(pid, p, editableText)}
                <div class="cal-card-foot">
                    ${_sxrCommentsBtnHtml(p, pid)}
                    ${p._saveError
                        ? `<button type="button" class="cal-card-saving is-error" data-saving="${pid}" onclick="_sxrRetrySave('${pid}')" title="${_sxrEscAttr(typeof p._saveError === 'string' ? p._saveError : 'Save failed')} — click to retry">Save failed · Retry</button>`
                        : `<span class="cal-card-saving" data-saving="${pid}" hidden></span>`}
                </div>
                <div class="cal-card-status-row">${statusHtml}</div>
            </div>
        </div>`;
    }

    /* ── Create (single) — promote-on-first-save is Surface 3 ── */
    let _sxrBlankSeq = 0;
    function _sxrNextBlankId() { _sxrBlankSeq++; return '__sxrblank__' + _sxrBlankSeq; }
    function _sxrIsBlankId(pid) { return typeof pid === 'string' && pid.startsWith('__sxrblank__'); }
    function _sxrBlankSample() {
        const maxOrder = sxrState.posts.reduce((m, p) => Math.max(m, Number(p.order_index || 0)), 0);
        return { id: _sxrNextBlankId(), order_index: maxOrder + 1, name: '', creative_direction: '', hide_creative_direction: '', asset_url: '', thumbnail_url: '', linear_issue_id: '', graphic_linear_issue_id: '', video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress', comments: [] };
    }
    /* The samples "+" now routes exactly the way the calendar's does (owner
       2026-08-19: "the samples tab behaves exactly like the calendar tab").
       An enrolled client gets the SAME native Create Post dialog, which mints
       the batch, the Linear parent, the video sub-issue and the thumbnail
       sub-issue before any card exists. An unenrolled client keeps the local
       blank card, so this can never leave someone with no way to add a sample.

       Mirrors addCalBlankCard deliberately, including abandoning the click if
       the visible client changed while the rollout flag was loading -- the
       action belongs to the client that was on screen when it was clicked. */
    function _sxrInsertLocalBlankCard() {
        const blank = _sxrBlankSample();
        sxrState.posts.push(blank);
        _sxrRenderBody();
        setTimeout(() => {
            const card = document.querySelector(`.cal-card[data-pid="${blank.id}"]`);
            if (card) { const nm = card.querySelector('.cal-fld-name'); if (nm) nm.focus(); card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
        }, 60);
    }
    async function addSxrBlankCard() {
        if (_isClientLink) return;
        const clientName = String(sxrState.client || '').trim();
        const clientSlug = sxrClientSlug(clientName);
        let useGateway = false;
        try { useGateway = await _writeUiRerouteUseGatewayWhenReady(clientSlug); }
        catch (error) { useGateway = false; }
        if (!clientSlug || sxrClientSlug(sxrState.client) !== clientSlug) return;
        if (!useGateway) {
            _sxrInsertLocalBlankCard();
            return;
        }
        _calOpenNativePost(clientName, clientSlug, 'sxr');
    }

    /* ── Archive (single card + anti-resurrection ledger) ── */
    function archiveSxrCard(pid) {
        if (_isClientLink) return;
        const post = sxrState.posts.find(p => p.id === pid);
        showConfirm('Archive this sample?', "It's kept (archived) on our server and can be recovered.", () => {
            const slug = sxrClientSlug(sxrState.client);
            const refs = [pid];
            if (post) { if (post.linear_issue_id) refs.push(post.linear_issue_id); if (post.graphic_linear_issue_id) refs.push(post.graphic_linear_issue_id); }
            _sxrArchivedAdd(slug, refs);
            const snapshot = sxrState.posts.slice();
            sxrState.posts = sxrState.posts.filter(p => p.id !== pid);
            _sxrRenderBody();
            try { _sxrCacheWrite(slug, sxrState.posts); } catch (e) {}
            if (!_sxrIsBlankId(pid)) {
                _sxrArchiveOne(pid, slug, post || null).catch(() => { sxrState.posts = snapshot; _sxrArchivedRemove(slug, refs); _sxrRenderBody(); loadSxrCards({ skipCache: true }); });
            }
        }, 'Archive');
    }
    async function _sxrArchiveOne(pid, slug, preCapturedPost) {
        delete _sxrPendingEdits[pid];
        // Captured before any await, and before the caller's optimistic removal
        // (the Calendar learned this the hard way: OPEN_REPAIRS 23).
        const knownPost = preCapturedPost || sxrState.posts.find(p => p.id === pid) || null;
        if (typeof _sxrSaveInFlight[pid] !== 'undefined') { try { await _sxrSaveInFlight[pid]; } catch (e) {} }
        const archivedAt = new Date().toISOString();
        const resp = await _writeUiTrackSave('sxr', 'sample_archive', () => ({ client_slug: slug, id: String(pid || '') }), () => _sxrUpsertFetch(slug, { client: slug, sample: { id: pid, status: 'Archived', updated_at: archivedAt }, comments_base_at: '' }, 'ui'));
        if (!resp.ok) throw new Error('archive HTTP ' + resp.status);
        // Same rule as the Calendar (owner ruling 2026-08-17, extended to
        // samples 2026-09-28): archiving parks the sample's work items in
        // Backlog through the same guarded status write a person's status
        // change uses. Un-archiving forces nothing back.
        await _sxrArchiveParkWorkItems(knownPost, slug, pid, archivedAt);
    }
    /*
     * Park an archived sample's work items (video and thumbnail) in Backlog.
     * Mirrors _calArchiveParkSubIssues. It never fails the archive, which has
     * already succeeded; it says so when something could not be parked.
     *
     * Backlog is a work-item state, not a card state (SXR_STATUSES has no
     * Backlog), so the card keeps its component statuses. The status write
     * carries the card as it now is -- Archived -- so the card-side repair the
     * gateway path keeps can never write the pre-archive overall status back
     * and un-archive the sample.
     */
    async function _sxrArchiveParkWorkItems(post, slug, id, archivedAt) {
        if (!post) {
            console.warn('[Samples] archive could not resolve the sample to park', id || '');
            showNotify('Archived, but its work items were not parked',
                'The sample is archived. Its video and thumbnail work may still be open; move them to Backlog in Production.');
            return { parked: 0, failed: 0, unresolved: true };
        }
        let parked = 0;
        let failed = 0;
        for (const component of ['video', 'graphic']) {
            const url = component === 'video' ? post.linear_issue_id : post.graphic_linear_issue_id;
            const nativeId = _writeUiNativeId(post, component);
            if (!url && !nativeId) continue;
            const parkedPost = Object.assign({}, post, { status: 'Archived', updated_at: archivedAt || post.updated_at });
            try {
                await _sxrPushStatusToLinear(url, 'Backlog', {
                    post: parkedPost,
                    component,
                    slug,
                    sourceEditedAt: archivedAt || post[component + '_status_updated_at'] || post.updated_at
                });
                parked += 1;
            } catch (error) {
                failed += 1;
                console.warn('[Samples] archive could not park ' + component, error);
            }
        }
        if (failed) {
            showNotify('Archived, but a work item is still open',
                'The sample is archived. ' + failed + ' of its work items could not be moved to Backlog.');
        }
        return { parked, failed };
    }
    function _sxrCardSelectClick(e, pid) {
        e.preventDefault();
        e.stopPropagation();
        // Shift-range over the cards ACTUALLY ON SCREEN (selectable ones in the
        // rendered strip), never all of sxrState.posts — so a shift-click can't
        // silently select (and bulk-archive) blank/read-only cards.
        const order = Array.from(document.querySelectorAll('#sxrStrip .cal-card-selectable[data-pid]'))
            .map(el => el.getAttribute('data-pid'));
        if (e.shiftKey && sxrState.lastSel && sxrState.lastSel !== pid) {
            const a = order.indexOf(sxrState.lastSel), b = order.indexOf(pid);
            if (a >= 0 && b >= 0) { const lo = Math.min(a, b), hi = Math.max(a, b); for (let i = lo; i <= hi; i++) sxrState.selected.add(order[i]); }
        } else {
            if (sxrState.selected.has(pid)) sxrState.selected.delete(pid);
            else sxrState.selected.add(pid);
        }
        sxrState.lastSel = pid;
        _sxrSyncSelectionUI();
    }
    function _sxrSyncSelectionUI() {
        document.querySelectorAll('#sxrStrip .cal-card[data-pid]').forEach(card => {
            card.classList.toggle('cal-card-selected', sxrState.selected.has(card.getAttribute('data-pid')));
        });
        const n = sxrState.selected.size;
        const count = document.getElementById('sxrSelectCount');
        if (count) count.textContent = n + ' selected';
        const archive = document.getElementById('sxrSelectArchive');
        if (archive) archive.disabled = n === 0;
    }
    function _sxrArchiveSelected() {
        if (_isClientLink) return;   // bulk archive is SMM-only (defense in depth beyond select-mode)
        const ids = Array.from(sxrState.selected).filter(id => id && !_sxrIsBlankId(id));
        if (!ids.length) return;
        // Pin the slug at click time — the archive HTTPs can take seconds; if the
        // SMM switches client mid-flight, ledger/cache writes still attribute to
        // the calendar this action started from.
        const slug = sxrClientSlug(sxrState.client);
        showConfirm('Archive ' + ids.length + ' sample' + (ids.length === 1 ? '' : 's') + '?',
            "They're kept (archived) on our server and can always be recovered.",
            () => {
                const idSet = new Set(ids);
                const refsById = new Map();
                const postById = new Map();
                sxrState.posts.forEach(p => {
                    if (!idSet.has(p.id)) return;
                    postById.set(p.id, p);
                    const refs = [p.id];
                    if (p.linear_issue_id) refs.push(p.linear_issue_id);
                    if (p.graphic_linear_issue_id) refs.push(p.graphic_linear_issue_id);
                    refsById.set(p.id, refs);
                });
                // Pre-populate the archive ledger BEFORE the writes fire so a
                // background poll racing them can't resurrect the rows; failed
                // archives are rolled back below so they reappear honestly.
                const allRefs = [];
                refsById.forEach(arr => arr.forEach(x => allRefs.push(x)));
                _sxrArchivedAdd(slug, allRefs);
                sxrState.posts = sxrState.posts.filter(p => !idSet.has(p.id));
                sxrState.selectMode = false;
                sxrState.selected = new Set();
                sxrState.lastSel = null;
                document.querySelectorAll('#sxrView .cal-select-btn').forEach(btn => btn.classList.remove('active'));
                _sxrRenderBody({ preserveScroll: true });
                try { _sxrCacheWrite(slug, sxrState.posts); } catch (e) {}
                Promise.allSettled(ids.map(id => _sxrArchiveOne(id, slug, postById.get(id) || null))).then(results => {
                    const failedRefs = [];
                    results.forEach((r, i) => { if (r.status === 'rejected') { const refs = refsById.get(ids[i]); if (refs) refs.forEach(x => failedRefs.push(x)); } });
                    if (failedRefs.length) { _sxrArchivedRemove(slug, failedRefs); loadSxrCards({ skipCache: true }); }
                });
            }, 'Archive');
    }

    /* ── Copy a deep-link to one card ── */
    function _sxrCopyCardLink(e, pid) {
        if (e) e.stopPropagation();
        const slug = sxrClientSlug(sxrState.client);
        const url = svRoute.cleanAbs('/?sxr=1#sample-reviews/' + encodeURIComponent(slug) + '/' + encodeURIComponent(pid));
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(() => {}, () => window.prompt('Copy this link:', url));
        else window.prompt('Copy this link:', url);
    }

    /* Body dispatcher — enhanced for the Sheet (preserve scroll on optimistic
       repaints from card actions; drag wiring is a Surface 2 follow-up). */
    function _sxrRenderBody(opts) {
        const body = document.getElementById('sxrBody');
        if (!body) return;
        const preserveScroll = !!(opts && opts.preserveScroll);
        const scrollY0 = preserveScroll ? window.scrollY : null;
        if (!sxrState.client) { body.innerHTML = document.body.classList.contains('sv-shared-client') ? `<div class="cal-empty">Pick a client in the top bar to start.</div>` : `<div class="cal-empty">No clients added yet. Click <strong>+ Add client</strong> in the toolbar to start.</div>`; return; }
        if (sxrState.loading) { body.innerHTML = _sxrLoaderHtml(); return; }
        if (sxrState.error) { body.innerHTML = `<div class="cal-empty cal-error">Couldn't load sample reviews — <button class="cal-link" onclick="loadSxrCards({skipCache:true})">try again</button>.</div>`; return; }
        if (sxrState.view === 'review' || sxrState.view === 'smmreview') {
            body.innerHTML = (typeof renderSxrReview === 'function') ? renderSxrReview() : `<div class="cal-empty">Review queue — coming in Surface 4.</div>`;
        } else {
            body.innerHTML = renderSxrOrganizer();
            if (typeof _sxrWireStrip === 'function') _sxrWireStrip();   // drag-reorder wiring
            if (preserveScroll && scrollY0 != null) window.scrollTo({ top: scrollY0 });
        }
        if (typeof _sxrUpdateReviewBadge === 'function') _sxrUpdateReviewBadge();
        _thumbCompareScheduleAvailability('samples');
    }

    /* ============================================================
       --- SURFACE 3: the save engine ---
       Clone of _calOnFieldInput/Blur + _calFlushCardSave + _calPromoteBlankCard +
       _calRetrySave + _calSetCardStatus, re-pointed to the LIVE sample-review-upsert
       webhook. Verified payload contract: POST { client, sample: wirePost,
       comments_base_at } → { ok:true, sample } | { ok:false, error }.
       Samples are always v2: existing rows get a FIELD-LEVEL PATCH (only edited
       columns), new rows / forced retries send the whole card. comments_base_at is
       always '' (no scalar-conflict guard under realtime). __CLEAR_LINK__ sentinel
       for an intentional link clear. Linear push + comment merge are stubbed here
       (Surfaces 7 and 5). These function defs OVERRIDE the Surface 2 stubs.
       ============================================================ */

    const SXR_SAVE_DEBOUNCE_MS = 650;
    function _sxrMintId() { return 'sr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7); }
    const _sxrThumbRev = Object.create(null);
    function _sxrBumpThumbRev(pid) { const t = Date.now().toString(36); if (pid) _sxrThumbRev[pid] = t; return t; }

    /* Structural fields rolled back when the upsert fails (free text is kept so a
       user's typing is never erased). Samples set: video/graphic only — no
       caption/title/scheduled_date/posted_at. */
    const _SXR_ROLLBACK_FIELDS = [
        'video_status', 'graphic_status', 'status', 'order_index',
        'linear_issue_id', 'video_deliverable_id', 'graphic_linear_issue_id', 'graphic_deliverable_id',
        'client_video_approved_at', 'client_graphic_approved_at',
        'kasper_approved_at', 'kasper_approved_after_tweaks',
    ];

    /* Save-engine + reconcile state (declared once here; Surface 7 REFERENCES,
       never redeclares, these). */
    const _sxrNoLinearPush = new Set();          // single-shot outbound-push suppression keys
    let _sxrLocalRecentSaves = new Map();        // realId → ts of our last successful write
    let _sxrRecentSaveFields = new Map();        // realId → {wrote, base} sub-status snapshot
    const _sxrFailedNewCards = new Set();         // new rows whose first save failed (keep on screen)
    const _sxrConflictNotified = new Set();
    let _sxrLastLocalWriteAt = 0;                 // self-echo window for realtime
    function _sxrSetLastLocalWriteAt(value) { _sxrLastLocalWriteAt = value; }

    /* The comment data layer (_sxrCommentsFor / _sxrStringifyComments /
       _sxrMergePostComments + the rest) is installed by Surface 4 (Review) below;
       it's hoisted, so the flush above resolves it at call time.
       Linear push — stubbed; Surface 7 installs the real outbox-backed push. */
    function _sxrWireDragOnCard(card) {
        if (!card || card.dataset.dragWired === '1') return;
        card.dataset.dragWired = '1';
        const strip = card.parentElement;
        card.addEventListener('dragstart', (e) => {
            if (e.target.closest('input, textarea, select, button')) { e.preventDefault(); return; }
            if (sxrState.selectMode) { e.preventDefault(); return; }   // no drag while multi-selecting
            e.dataTransfer.effectAllowed = 'move';
            card.classList.add('dragging');
        });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
        card.addEventListener('dragover', (e) => {
            e.preventDefault();
            const dragging = strip.querySelector('.cal-card.dragging');
            if (!dragging || dragging === card) return;
            const rect = card.getBoundingClientRect();
            const after = (e.clientX - rect.left) > rect.width / 2;
            strip.insertBefore(dragging, after ? card.nextSibling : card);
        });
    }
    /* Wire the Sheet strip: a drop handler that reads the DOM order and persists,
       plus drag listeners on every draggable card. Called after each Sheet render
       (idempotent — the dropWired flag guards the one-time strip listeners). */
    function _sxrWireStrip() {
        const strip = document.getElementById('sxrStrip');
        if (!strip) return;
        strip.querySelectorAll('.cal-card[draggable="true"]').forEach(_sxrWireDragOnCard);
        _calWireShiftScroll(strip);
        _calWireDragEdgeScroll(strip);
        if (strip.dataset.dropWired === '1') return;
        strip.dataset.dropWired = '1';
        strip.addEventListener('dragover', (e) => e.preventDefault());   // make the strip a valid drop target
        strip.addEventListener('drop', () => {
            if (_isClientLink) return;   // a read-only client can't persist a reorder
            const ids = Array.from(strip.querySelectorAll('.cal-card[draggable="true"]')).map(c => c.dataset.pid).filter(Boolean);
            if (!ids.length) return;
            const byId = new Map(sxrState.posts.map(p => [p.id, p]));
            // Recycle the visible cards' existing order_index slots — de-duped,
            // strictly increasing, and skipping any slot held by a non-visible
            // post — so the GET workflow's tiebreaker-free order_index sort can't
            // snap a dropped card back (see the calendar's _calOnStripDrop notes).
            const idSet = new Set(ids);
            const hiddenSlots = new Set(sxrState.posts.filter(p => p && !idSet.has(p.id)).map(p => Number(p.order_index || 0)));
            const rawSlots = ids.map(id => Number((byId.get(id) || {}).order_index || 0)).slice().sort((a, b) => a - b);
            const slots = []; let prevSlot = -Infinity;
            for (const v of rawSlots) { let s = v > prevSlot ? v : prevSlot + 1; while (hiddenSlots.has(s)) s++; slots.push(s); prevSlot = s; }
            const items = ids.map((id, i) => ({ id, order_index: slots[i] }));
            const prevOrder = new Map(sxrState.posts.map(p => [p.id, Number(p.order_index || 0)]));
            let changed = false;
            items.forEach(({ id, order_index }) => { const p = byId.get(id); if (p && Number(p.order_index || 0) !== order_index) { p.order_index = order_index; changed = true; } });
            if (!changed) return;   // dropped in place — nothing to persist
            _sxrRecordReorderOptimistic(items);
            try { _sxrCacheWrite(sxrClientSlug(sxrState.client), sxrState.posts); } catch (e) {}
            _sxrPersistReorder(items, prevOrder, sxrClientSlug(sxrState.client));
        });
    }
    /* Reorder persistence: serialized + coalesced (two quick drags collapse to the
       latest order), with an optimistic-order guard so a background reload that
       lands before the write is READABLE can't adopt the stale server order_index
       and snap cards back. Mirrors the calendar's persistCalReorder. */
    let _sxrReorderInFlight = false;
    let _sxrReorderPending = null;
    const _sxrReorderOptimistic = new Map();   // id -> { order_index:Number, at:ms }
    const SXR_REORDER_GUARD_MS = 12000;
    function _sxrRecordReorderOptimistic(items) {
        const at = Date.now();
        (items || []).forEach(({ id, order_index }) => _sxrReorderOptimistic.set(id, { order_index: Number(order_index), at }));
    }
    async function _sxrPersistReorder(items, prevOrder, slug) {
        if (slug == null) slug = sxrClientSlug(sxrState.client);
        if (_sxrReorderInFlight) { _sxrReorderPending = { items, prevOrder, slug }; return; }   // coalesce
        _sxrReorderInFlight = true;
        _sxrLastLocalWriteAt = Date.now();   // treat as a local write so our own realtime echo defers (Surface 7)
        try {
            const resp = await _sxrReorderFetch(slug, { client: slug, items }, 'ui');
            const json = await resp.clone().json().catch(() => null);
            if (!resp.ok || (json && json.ok === false)) throw new Error((json && json.error) || ('reorder HTTP ' + resp.status));
            // Fail closed on a partial/no-op reorder. The EF returns the count of
            // rows it ACTUALLY matched; updated < items.length means part of the
            // drag referenced a stale/mid-create/archived id and silently did not
            // persist. Revert and tell the user rather than leaving the strip
            // showing an order the sheet never accepted (F141, invariant 2). Scoped
            // to the EF route, which returns the true count; the n8n fallback keeps
            // its ok-flag contract.
            if (_sxrSampleUseEf(slug) && Number((json && json.updated) || 0) < items.length) {
                throw new Error((json && json.error) || 'reorder incomplete');
            }
            _sxrLastLocalWriteAt = Date.now();   // echo lands a beat after the write resolves
        } catch (e) {
            // Revert to the captured order if nothing newer is queued and we're still on this client.
            if (prevOrder && prevOrder.size && !_sxrReorderPending && sxrClientSlug(sxrState.client) === slug) {
                sxrState.posts.forEach(p => { if (prevOrder.has(p.id)) p.order_index = prevOrder.get(p.id); });
                items.forEach(({ id }) => _sxrReorderOptimistic.delete(id));
                try { _sxrCacheWrite(slug, sxrState.posts); } catch (e2) {}
                try { _sxrRenderBody({ preserveScroll: true }); } catch (e2) {}
                if (typeof showNotify === 'function') showNotify("Couldn't save the new order", 'It was put back — please try again.');
            }
        } finally {
            _sxrReorderInFlight = false;
            if (_sxrReorderPending) { const next = _sxrReorderPending; _sxrReorderPending = null; _sxrPersistReorder(next.items, next.prevOrder, next.slug); }
        }
    }
    // _sxrPushStatusToLinear — real version in Surface 7, hoisted. (_sxrSyncStatusFromLinear removed in B2.)

    function _sxrClientFieldEditBlocked() { return _isClientLink; }   // client never edits fields (no collab)
    function _sxrOnFieldInput(el) {
        if (_sxrClientFieldEditBlocked()) return;
        const pid = el.dataset.pid, fld = el.dataset.fld, val = el.value;
        if (!_sxrPendingEdits[pid]) _sxrPendingEdits[pid] = {};
        _sxrPendingEdits[pid][fld] = val;
        const post = sxrState.posts.find(p => p.id === pid);
        if (post) {
            post[fld] = val;
            if (fld === 'thumbnail_url') _calClearThumbnailFolderMeta(post);
        }
        if (_sxrSaveTimers[pid]) clearTimeout(_sxrSaveTimers[pid]);
        _sxrSaveTimers[pid] = setTimeout(() => { _sxrSaveTimers[pid] = null; _sxrFlushCardSave(pid); }, SXR_SAVE_DEBOUNCE_MS);
    }
    function _sxrOnFieldBlur(el) {
        if (!el || !el.dataset || _sxrClientFieldEditBlocked()) return;
        const pid = el.dataset.pid, fld = el.dataset.fld, val = el.value;
        if (!_sxrPendingEdits[pid]) _sxrPendingEdits[pid] = {};
        _sxrPendingEdits[pid][fld] = val;
        const post = sxrState.posts.find(p => p.id === pid);
        if (post) {
            post[fld] = val;
            if (fld === 'thumbnail_url') _calClearThumbnailFolderMeta(post);
        }
        if (_sxrSaveTimers[pid]) { clearTimeout(_sxrSaveTimers[pid]); _sxrSaveTimers[pid] = null; }
        _sxrFlushCardSave(pid);
    }
    function _sxrFlushAllPending() {
        Object.keys(_sxrPendingEdits).forEach(pid => {
            if (_sxrSaveTimers[pid]) { clearTimeout(_sxrSaveTimers[pid]); _sxrSaveTimers[pid] = null; }
            _sxrFlushCardSave(pid);
        });
    }

    function _sxrSetCardStatus(pid, state, msg) {
        // Modern icon-only indicator at the end of the sample card's title row.
        _svSaveIndApply(document.querySelector(`[data-sv-save-ind="${pid}"]`), state, msg);
        // Foot element stays the Save-failed·Retry affordance; no longer carries
        // the transient Saving…/Saved TEXT (that moved to the icon).
        const tag = document.querySelector(`[data-saving="${pid}"]`);
        if (tag) {
            tag.classList.remove('is-saved', 'is-error');
            if (state === 'error') { tag.hidden = false; tag.textContent = msg || 'Save failed'; tag.classList.add('is-error'); }
            else { tag.hidden = true; tag.textContent = ''; }
        }
        const card = document.querySelector(`.cal-card[data-pid="${pid}"]`);
        if (card) { card.classList.toggle('is-saving', state === 'saving'); card.classList.toggle('is-error', state === 'error'); }
    }

    /* Promote a blank card → a real minted row: rewrite EVERY attribute referencing
       the old blank pid (the full attribute walk — the calendar learned the hard
       way that a partial rewrite mints a second ghost row), inject grip + archive,
       migrate pending edits, wire drag. */
    function _sxrPromoteBlankCard(oldPid, newId) {
        const strip = document.getElementById('sxrStrip');
        if (!strip) return;
        const blank = strip.querySelector(`.cal-card[data-pid="${oldPid}"]`);
        if (!blank) return;
        blank.classList.remove('is-blank');
        blank.setAttribute('draggable', 'true');
        const oldEsc = oldPid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(oldEsc, 'g');
        const walk = (el) => {
            if (!el || !el.attributes) return;
            for (let i = 0; i < el.attributes.length; i++) {
                const a = el.attributes[i];
                if (typeof a.value === 'string' && a.value.indexOf(oldPid) !== -1) el.setAttribute(a.name, a.value.replace(re, newId));
            }
            for (let i = 0; i < el.children.length; i++) walk(el.children[i]);
        };
        walk(blank);
        if (!blank.querySelector('.cal-card-grip')) {
            const grip = document.createElement('span');
            grip.className = 'cal-card-grip'; grip.title = 'Drag to reorder';
            grip.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="6" cy="4" r="1.4"/><circle cx="10" cy="4" r="1.4"/><circle cx="6" cy="8" r="1.4"/><circle cx="10" cy="8" r="1.4"/><circle cx="6" cy="12" r="1.4"/><circle cx="10" cy="12" r="1.4"/></svg>`;
            blank.insertBefore(grip, blank.firstChild);
        }
        if (!blank.querySelector('.cal-card-del')) {
            const del = document.createElement('button');
            del.className = 'cal-card-del'; del.type = 'button'; del.title = 'Archive';
            del.addEventListener('click', () => archiveSxrCard(newId));
            del.innerHTML = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7"/></svg>';
            blank.insertBefore(del, blank.firstChild);
        }
        if (_sxrPendingEdits[oldPid]) {
            _sxrPendingEdits[newId] = Object.assign(_sxrPendingEdits[newId] || {}, _sxrPendingEdits[oldPid]);
            delete _sxrPendingEdits[oldPid];
        }
        _sxrWireDragOnCard(blank);
    }

    async function _sxrAwaitCardSave(pid) {
        for (;;) {
            const active = _sxrSaveInFlight[pid];
            if (active) { await active; continue; }
            if (_sxrPendingEdits[pid]) { await _sxrFlushCardSave(pid); continue; }
            return;
        }
    }
    async function _sxrFlushCardSave(pid) {
        let edits = _sxrPendingEdits[pid];
        if (!edits) return;
        // Leave the complete trailing batch untouched until the current owner
        // releases the per-card save lock.
        if (_sxrSaveInFlight[pid]) return _sxrAwaitCardSave(pid);
        const retryPost = sxrState.posts.find(p => p.id === pid);
        const _saveSlug = sxrClientSlug(sxrState.client);
        const retryPrincipal = _writeUiPrincipalKey();
        if (retryPost && retryPost._writeUiRetrySourceAt
            && retryPost._writeUiRetryPrincipal !== retryPrincipal) {
            delete _sxrPendingEdits[pid];
            retryPost._saveError = 'Source repair belongs to another signed-in actor';
            try { _sxrRenderBody({ preserveScroll: true }); } catch (e) {}
            return;
        }
        if (retryPost && retryPost._writeUiRetrySourceAt
            && !_writeUiJournalCoversRepairRefs(retryPost, 'sxr', 'card', _saveSlug, retryPrincipal)) {
            retryPost._writeUiHeldSourceEdits = Object.assign({}, retryPost._writeUiHeldSourceEdits || {},
                _writeUiSourceEditsOnly(retryPost._writeUiRetryEdits), _writeUiSourceEditsOnly(edits));
            retryPost._saveError = 'Source repair receipt missing; explicit review required';
            delete _sxrPendingEdits[pid];
            _sxrCacheWrite(_saveSlug, sxrState.posts);
            _writeUiQueueDiagnostic('sxr', 'cache_only_repair_blocked', { kind: 'source-repair' });
            try { _sxrRenderBody({ preserveScroll: true }); } catch (e) {}
            return;
        }
        if (retryPost && (retryPost._writeUiRetryEdits || retryPost._writeUiHeldSourceEdits)) {
            edits = Object.assign({}, retryPost._writeUiRetryEdits || {}, retryPost._writeUiHeldSourceEdits || {}, edits);
        }
        const sourceRepairRefsForWrite = [];
        (Array.isArray(edits._writeUiRepairRefs) ? edits._writeUiRepairRefs : []).forEach(ref => _writeUiAppendRepairRef(sourceRepairRefsForWrite, ref));
        if (retryPost && retryPost._writeUiRetrySourceAt) {
            _writeUiSnapshotRepairRefs(retryPost).forEach(ref => _writeUiAppendRepairRef(sourceRepairRefsForWrite, ref));
        }
        const precommittedForWrite = edits._writeUiPrecommittedNative === true
            || !!(retryPost && retryPost._writeUiRetrySourceAt);
        const companionRepairsForWrite = (Array.isArray(edits._writeUiCompanionRepairs) ? edits._writeUiCompanionRepairs : []).slice();
        const pinnedSourceTransportForWrite = String(edits._writeUiPinnedSourceTransport || '');
        delete edits._writeUiRepairRefs;
        delete edits._writeUiPrecommittedNative;
        delete edits._writeUiCompanionRepairs;
        delete edits._writeUiPinnedSourceTransport;
        delete _sxrPendingEdits[pid];
        let _releaseSave;
        _sxrSaveInFlight[pid] = new Promise(res => { _releaseSave = res; });
        let realId = pid;
        try {
            const isBlank = _sxrIsBlankId(pid);
            const hasContent = Object.values(edits).some(v => String(v).trim() !== '');
            if (isBlank && !hasContent) return;
            if (isBlank) {
                realId = _sxrMintId();
                _sxrPromoteBlankCard(pid, realId);
                _sxrSaveInFlight[realId] = _sxrSaveInFlight[pid];
                // GHOST-CARD FIX: addSxrBlankCard pushed the optimistic blank
                // into sxrState.posts under its __sxrblank__ pid (unlike the
                // calendar, whose add is DOM-only). _sxrPromoteBlankCard only
                // rewrites DOM attributes, so without dropping the stale blank
                // here the findIndex(realId) below misses, the wasNewRow branch
                // pushes a SECOND post object, and the next render paints the
                // same card twice in the creating window (the server correctly
                // has one row — the twin is purely local state). Splice it out
                // so the save re-adds this card once, under its REAL id.
                const staleIdx = sxrState.posts.findIndex(p => p.id === pid);
                if (staleIdx >= 0) sxrState.posts.splice(staleIdx, 1);
            }
            let post;
            const idx = sxrState.posts.findIndex(p => p.id === realId);
            const prevSnapshot = idx >= 0 ? Object.assign({}, sxrState.posts[idx]) : null;
            const wasNewRow = idx < 0;
            if (idx < 0) {
                const blank = _sxrBlankSample(); blank.id = realId;
                post = Object.assign({}, blank, edits);
                sxrState.posts.push(post);
            } else {
                post = Object.assign({}, sxrState.posts[idx], edits);
                sxrState.posts[idx] = post;
            }
            const writeUiSourceAt = String(post._writeUiRetrySourceAt || new Date().toISOString());
            const recoveringWriteUiSource = !!post._writeUiRetrySourceAt;
            post.updated_at = writeUiSourceAt;
            const bumpThumbRev = ('thumbnail_url' in edits || 'asset_url' in edits)
                || _calShouldBumpThumbRevForGraphicStatus(edits, prevSnapshot, post);
            if (bumpThumbRev) post.thumb_rev = _sxrBumpThumbRev(realId);
            delete post._saveError;
            _sxrSetCardStatus(realId, 'saving');
            const suppressAll     = _sxrNoLinearPush.has(realId) || _sxrNoLinearPush.has(pid);
            const suppressVideo   = suppressAll || _sxrNoLinearPush.has(realId + '|video')   || _sxrNoLinearPush.has(pid + '|video');
            const suppressGraphic = suppressAll || _sxrNoLinearPush.has(realId + '|graphic') || _sxrNoLinearPush.has(pid + '|graphic');
            [realId, pid].forEach(k => { _sxrNoLinearPush.delete(k); _sxrNoLinearPush.delete(k + '|video'); _sxrNoLinearPush.delete(k + '|graphic'); });
            let gatewayAttempted = false;
            let gatewayCommitted = precommittedForWrite;
            const checkpointCommittedSource = () => {
                if (!gatewayCommitted) return;
                post._writeUiRetryEdits = Object.assign({}, edits);
                post._writeUiRetrySourceAt = writeUiSourceAt;
                post._writeUiRetryPrincipal = _writeUiPrincipalKey();
                if (!_sxrCacheWrite(_saveSlug, sxrState.posts)) throw _writeUiGatewayError(507, 'repair_storage_unavailable');
            };
            try {
                checkpointCommittedSource();
                _writeUiApplyOverallStatus('sxr', post, edits, wasNewRow, false);
                for (const companion of companionRepairsForWrite) {
                    if (!companion || companion.operation !== 'status') continue;
                    const key = companion.component + '_status';
                    const suppressed = companion.component === 'graphic' ? suppressGraphic : suppressVideo;
                    if (!(key in edits) || suppressed) throw _writeUiGatewayError(409, 'repair_status_not_applied');
                }
                if ('video_status' in edits && !suppressVideo) {
                    const companion = companionRepairsForWrite.find(row => row && row.operation === 'status' && row.component === 'video');
                    const reconciled = companion && await _writeUiReconcileReplayStatus({ edits, source_at: companion.source_at }, companion.intent, post);
                    if (!reconciled) {
                        const gatewayAttemptedBefore = gatewayAttempted;
                        gatewayAttempted = true;
                        const sourceEditedAt = companion ? companion.source_at : post.updated_at;
                        const acknowledgement = await _sxrPushStatusToLinear(post.linear_issue_id, post.video_status, {
                            post, component: 'video', sourceEditedAt,
                            repairRecord: companion && companion.record,
                            deferLegacyUntilSourceSave: true
                        });
                        if (acknowledgement && (acknowledgement.deferred_until_source_save
                            || acknowledgement.legacy_transport_retired)) {
                            /* A write the retired legacy lane refused never reached the
                           gateway either, so it must not leave `gatewayAttempted`
                           set -- otherwise a later source failure is reported as a
                           gateway failure (OPEN_REPAIRS 239). */
                            gatewayAttempted = gatewayAttemptedBefore;
                        }
                        _writeUiAdoptRepairAck(post, acknowledgement);
                        _writeUiAppendRepairRef(sourceRepairRefsForWrite, acknowledgement && acknowledgement.source_repair);
                        gatewayCommitted = gatewayCommitted || !!(acknowledgement && acknowledgement.native_committed);
                        const current = _writeUiAdoptReplayStatus(post, 'video', acknowledgement, recoveringWriteUiSource, 'samples');
                        if (current) edits.video_status = current;
                    }
                    checkpointCommittedSource();
                }
                if ('graphic_status' in edits && !suppressGraphic) {
                    const companion = companionRepairsForWrite.find(row => row && row.operation === 'status' && row.component === 'graphic');
                    const reconciled = companion && await _writeUiReconcileReplayStatus({ edits, source_at: companion.source_at }, companion.intent, post);
                    if (!reconciled) {
                        const gatewayAttemptedBefore = gatewayAttempted;
                        gatewayAttempted = true;
                        const sourceEditedAt = companion ? companion.source_at : post.updated_at;
                        const acknowledgement = await _sxrPushStatusToLinear(post.graphic_linear_issue_id, post.graphic_status, {
                            post, component: 'graphic', sourceEditedAt,
                            repairRecord: companion && companion.record,
                            deferLegacyUntilSourceSave: true
                        });
                        if (acknowledgement && (acknowledgement.deferred_until_source_save
                            || acknowledgement.legacy_transport_retired)) {
                            /* A write the retired legacy lane refused never reached the
                           gateway either, so it must not leave `gatewayAttempted`
                           set -- otherwise a later source failure is reported as a
                           gateway failure (OPEN_REPAIRS 239). */
                            gatewayAttempted = gatewayAttemptedBefore;
                        }
                        _writeUiAdoptRepairAck(post, acknowledgement);
                        _writeUiAppendRepairRef(sourceRepairRefsForWrite, acknowledgement && acknowledgement.source_repair);
                        gatewayCommitted = gatewayCommitted || !!(acknowledgement && acknowledgement.native_committed);
                        const current = _writeUiAdoptReplayStatus(post, 'graphic', acknowledgement, recoveringWriteUiSource, 'samples');
                        if (current) edits.graphic_status = current;
                    }
                    checkpointCommittedSource();
                }
                _writeUiApplyOverallStatus('sxr', post, edits, wasNewRow, true);
                let wirePost;
                if (!wasNewRow && !_sxrFailedNewCards.has(realId)) {
                    // FIELD-LEVEL PATCH — only the columns this edit touched.
                    wirePost = { id: post.id };
                    for (const k of Object.keys(edits)) {
                        if (k === 'comments' || k === 'tweaks' || /_tweaks$/.test(k)) continue;
                        wirePost[k] = post[k];
                    }
                    SXR_REVIEW_COMPONENTS.forEach(comp => {
                        const fk = comp + '_tweaks';
                        if (fk in edits) { wirePost[fk] = _sxrStringifyComments(_sxrCommentsFor(post, comp)); if (comp === 'video') wirePost.tweaks = wirePost[fk]; }
                    });
                    if ('video_status' in edits || 'graphic_status' in edits) wirePost.status = post.status;
                    if (bumpThumbRev) wirePost.thumb_rev = post.thumb_rev;
                    // Intentional link clear → the explicit sentinel (a bare '' is carried-forward by the upsert guard).
                    _sxrApplyClearSentinels(wirePost);
                } else {
                    // Whole card only for creation, including a failed first save.
                    wirePost = Object.assign({}, post);
                    wirePost.video_tweaks = _sxrStringifyComments(_sxrCommentsFor(post, 'video'));
                    wirePost.graphic_tweaks = _sxrStringifyComments(_sxrCommentsFor(post, 'graphic'));
                    wirePost.tweaks = wirePost.video_tweaks;
                    delete wirePost.comments; delete wirePost.video_comments; delete wirePost.graphic_comments;
                    delete wirePost._baseAt; delete wirePost._saveError;
                    delete wirePost._writeUiRetryEdits; delete wirePost._writeUiHeldSourceEdits; delete wirePost._writeUiRetrySourceAt;
                    delete wirePost._writeUiRetryPrincipal;
                    delete wirePost._writeUiPrecommittedNative;
                    delete wirePost._writeUiRepairRefs;
                    _calStripThumbnailFolderFields(wirePost);
                    _sxrApplyClearSentinels(wirePost, edits);
                }
                _sxrLastLocalWriteAt = Date.now();
                const resp = await _sxrUpsertFetchPinned(
                    _saveSlug,
                    { client: _saveSlug, sample: wirePost, comments_base_at: '' },
                    'ui',
                    pinnedSourceTransportForWrite
                );
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const json = await resp.json();
                if (!json.ok) throw new Error(json.error || 'save failed');
                if (await _writeUiCompleteSourceRepairRefs(sourceRepairRefsForWrite)) _writeUiRemoveCompletedRepairRefs(post, sourceRepairRefsForWrite);
                const saved = json.sample || post;
                const i2 = sxrState.posts.findIndex(p => p.id === realId);
                if (i2 >= 0) {
                    // Overlay the echo onto the FULL local row, THEN migrate (so an
                    // omitted sub-status is never invented and a column the echo
                    // omits keeps its correct local value).
                    const merged = Object.assign({}, sxrState.posts[i2], saved);
                    _sxrMigrateShape(merged);
                    const queued = _sxrPendingEdits[realId];
                    if (queued) for (const k in queued) merged[k] = sxrState.posts[i2][k];
                    _sxrMergePostComments(merged, sxrState.posts[i2]);
                    merged._baseAt = String(saved.updated_at || merged.updated_at || merged._baseAt || '');
                    sxrState.posts[i2] = merged;
                }
                _sxrLocalRecentSaves.set(realId, Date.now());
                _sxrRecentSaveFields.set(realId, {
                    wrote: { video_status: post.video_status, graphic_status: post.graphic_status },
                    base: prevSnapshot ? { video_status: prevSnapshot.video_status, graphic_status: prevSnapshot.graphic_status } : {}
                });
                _sxrLastLocalWriteAt = Date.now();
                _sxrConflictNotified.delete(realId);
                _sxrFailedNewCards.delete(realId);
                const _okPost = sxrState.posts.find(p => p.id === realId);
                if (_okPost) {
                    if (_okPost._saveError) delete _okPost._saveError;
                    delete _okPost._writeUiRetryEdits; delete _okPost._writeUiHeldSourceEdits; delete _okPost._writeUiRetrySourceAt;
                    delete _okPost._writeUiRetryPrincipal;
                    if (Array.isArray(_okPost._writeUiRepairRefs) && _okPost._writeUiRepairRefs.length) _okPost._writeUiPrecommittedNative = true;
                    else delete _okPost._writeUiPrecommittedNative;
                }
                _sxrCacheWrite(_saveSlug, sxrState.posts, { clearRepairIds: [realId] });
                _sxrSetCardStatus(realId, 'saved');
                if (bumpThumbRev) _sxrForceThumbRefresh(realId);
                if ('thumbnail_url' in edits) {
                    const thumbPost = sxrState.posts.find(p => p.id === realId);
                    if (thumbPost) _calResolveThumbnailFolder('samples', _saveSlug, realId, thumbPost.thumbnail_url, thumbPost, { sxr: true });
                }
                if (isBlank && wasNewRow) {
                    const focusInThisCard = document.activeElement && document.activeElement.closest && document.activeElement.closest(`.cal-card[data-pid="${realId}"]`);
                    if (!focusInThisCard) { try { _sxrRenderBody({ preserveScroll: true }); } catch (e) {} }
                }
                /* The deferred legacy status drain that stood here is retired
                   (OPEN_REPAIRS 239). It fired only AFTER the upsert above, so
                   removing it changes no card state and no save ordering --
                   only the outbound copy to Linear is gone. */
            } catch (e) {
                console.warn('[Samples] save failed', e);
                if (gatewayAttempted && !gatewayCommitted) _writeUiReportFailure('sxr', 'status', e, { card: String(pid || '') });
                _sxrSetCardStatus(realId, 'error', e.message || 'save failed');
                const iErr = sxrState.posts.findIndex(p => p.id === realId);
                if (wasNewRow) {
                    _sxrFailedNewCards.add(realId);
                    if (iErr >= 0) sxrState.posts[iErr]._saveError = _writeUiFailureSentence(e, 'save failed');
                } else if (prevSnapshot && iErr >= 0) {
                    const cur = sxrState.posts[iErr];
                    if (!gatewayCommitted) _SXR_ROLLBACK_FIELDS.forEach(k => { if (k in edits) cur[k] = prevSnapshot[k]; });
                    cur.updated_at = prevSnapshot.updated_at || cur.updated_at;
                    cur._saveError = _writeUiFailureSentence(e, 'save failed');
                    // Retry the failed field set, never an old whole-card snapshot.
                    cur._writeUiRetryEdits = Object.assign({}, edits);
                    if (gatewayCommitted) {
                        cur._writeUiRetrySourceAt = writeUiSourceAt;
                        cur._writeUiRetryPrincipal = _writeUiPrincipalKey();
                        delete cur._writeUiPrecommittedNative;
                        _sxrCacheWrite(_saveSlug, sxrState.posts);
                    }
                }
                try { _sxrRenderBody({ preserveScroll: true }); } catch (e2) {}
            }
        } finally {
            delete _sxrSaveInFlight[pid];
            delete _sxrSaveInFlight[realId];
            if (_releaseSave) _releaseSave();
            if (_sxrPendingEdits[realId]) _sxrFlushCardSave(realId);
            else if (realId !== pid && _sxrPendingEdits[pid]) _sxrFlushCardSave(pid);
        }
    }

    /* Retry the retained edits for an existing card; a failed first creation
       still sends its full row through the normal funnel. */
    function _sxrRetrySave(pid) {
        if (!pid) return;
        const post = sxrState.posts.find(p => p.id === pid);
        const pending = _sxrPendingEdits[pid];
        const retained = post && Object.assign({}, post._writeUiRetryEdits || {}, post._writeUiHeldSourceEdits || {});
        if (!post || (!_sxrIsBlankId(pid) && !_sxrFailedNewCards.has(pid)
            && !(pending && Object.keys(pending).length)
            && !Object.keys(retained).length
            && !post._writeUiRetrySourceAt)) {
            const message = 'Retry details are missing. Refresh this card and make the edit again.';
            if (pending && !Object.keys(pending).length) delete _sxrPendingEdits[pid];
            if (post) post._saveError = message;
            _sxrSetCardStatus(pid, 'error', message);
            return;
        }
        if (!_sxrPendingEdits[pid]) _sxrPendingEdits[pid] = Object.assign({}, post && post._writeUiRetryEdits || {});
        _sxrSetCardStatus(pid, 'saving');
        _sxrFlushCardSave(pid);
    }

    /* ============================================================
       --- SURFACE 4: the SMM Review queue + the review state machine ---
       Clone of renderCalReview / _calReviewItems / _calReviewCardHtml /
       _calReviewCardBody / _calReviewPanelHtml / the approve / request-change /
       comment handlers + the comment DATA layer (shared with Surface 5 Notes),
       over video+graphic. _CAL_REVIEW_CFG: SMM 'For SMM Approval'->'Kasper Approval',
       client 'Client Approval'->'Approved'. The SMM keeps the Approve→Kasper /
       Approve→Client split + the "First review" smart default. The resolve chooser
       is simplified (open change-requests are resolved inline on approve — no modal);
       the Linear comment push is stubbed for Surface 7.
       ============================================================ */

    /* Pure review/thumb helpers REUSED from the calendar. */
    const _sxrDeriveThumb = _calDeriveThumb, _sxrIsFrameLink = _calIsFrameLink, _sxrIsFolderLink = _calIsFolderLink;
    const _sxrReviewFrameHtml = _calReviewFrameHtml, _sxrMiniLinkBadgeHtml = _calMiniLinkBadgeHtml, _sxrThumbIconSvg = _calThumbIconSvg;
    const _sxrKcardReuseThumbInto = (typeof _kcardReuseThumbInto === 'function') ? _kcardReuseThumbInto : function () {};

    /* ── Comment data layer (forked over video+graphic; shared with Notes) ── */
    function _sxrCommentsFor(post, comp) {
        if (!post) return [];
        if (comp === 'graphic') return Array.isArray(post.graphic_comments) ? post.graphic_comments : [];
        if (Array.isArray(post.video_comments)) return post.video_comments;
        return Array.isArray(post.comments) ? post.comments : [];
    }
    // Video-thread loader used by the Notes modal at 6 call sites as the fallback
    // when post.comments isn't already an array (e.g. a raw/unmigrated row from a
    // realtime echo). Was referenced but never defined — a latent ReferenceError
    // that crashed the modal on those rows. Aliases the shape-agnostic reader.
    function _sxrLoadComments(post) { return _sxrCommentsFor(post, 'video'); }
    function _sxrSetCommentsFor(post, comp, arr) {
        if (!post) return;
        const list = Array.isArray(arr) ? arr : [];
        const str = _sxrStringifyComments(list);
        if (comp === 'graphic') { post.graphic_comments = list; post.graphic_tweaks = str; return; }
        post.video_comments = list; post.comments = list; post.video_tweaks = str; post.tweaks = str;
    }
    function _sxrCanonicalCommentsFor(post, comp) {
        const slots = post && post._canonicalCommentsByComponent;
        return slots && Array.isArray(slots[comp]) ? slots[comp] : [];
    }
    function _sxrSetCanonicalCommentsFor(post, comp, arr) {
        if (!post || (comp !== 'video' && comp !== 'graphic')) return;
        if (!post._canonicalCommentsByComponent
            || typeof post._canonicalCommentsByComponent !== 'object'
            || Array.isArray(post._canonicalCommentsByComponent)) {
            post._canonicalCommentsByComponent = Object.create(null);
        }
        post._canonicalCommentsByComponent[comp] = Array.isArray(arr) ? arr : [];
    }
    // Canonical-where-linked, legacy-where-not. A Samples card with no native
    // deliverable binding has no canonical thread to address — F42 cannot import
    // one either — so the client surface acts on the same legacy card arrays
    // staff already acts on there. A LINKED card keeps the canonical contract.
    function _sxrCommentsForAction(post, comp) {
        return _isClientLink && _prodCanonicalCommentGate(post, comp).linked
            ? _sxrCanonicalCommentsFor(post, comp)
            : _sxrCommentsFor(post, comp);
    }
    function _sxrStringifyComments(arr) { const list = Array.isArray(arr) ? arr.filter(c => c && c.id) : []; return list.length ? JSON.stringify(list) : ''; }
    function _sxrCommentStamp(c) { return String((c && (c.updated_at || c.created_at)) || ''); }
    function _sxrMergeCommentLists(a, b) {
        const out = new Map();
        const absorb = (list) => { if (!Array.isArray(list)) return; for (const c of list) { if (!c || !c.id) continue; const prev = out.get(c.id); if (!prev || _sxrCommentStamp(c) >= _sxrCommentStamp(prev)) out.set(c.id, c); } };
        absorb(a); absorb(b); return Array.from(out.values());
    }
    function _sxrMergePostComments(winner, other) {
        if (!winner || !other) return winner;
        for (const comp of SXR_COMPONENTS) _sxrSetCommentsFor(winner, comp, _sxrMergeCommentLists(_sxrCommentsFor(winner, comp), _sxrCommentsFor(other, comp)));
        if (Array.isArray(winner.video_comments)) winner.comments = winner.video_comments;
        return winner;
    }
    function _sxrMsgAudience(c) { if (!c) return 'client'; if (c.audience === 'internal' || c.audience === 'client') return c.audience; return (c.role === 'kasper' || c.role === 'smm') ? 'internal' : 'client'; }
    function _sxrMsgIsTweak(c) { if (!c) return false; if (typeof c.is_tweak === 'boolean') return c.is_tweak; return true; }
    function _sxrNextTweakRound(post, comp) { const list = _sxrCommentsForAction(post, comp); return Array.isArray(list) ? list.filter(c => c && _sxrMsgIsTweak(c) && !c.deleted).length + 1 : 1; }
    /* The client-visible LEGACY rows for a component, computed WITHOUT
       consulting the canonical gate.

       This has to be gate-independent. The projection needs to know what the
       client can see today in order to decide whether replacing it would hide
       anything — but _sxrCommentsForView asks the gate first, and on a linked
       card the gate answers "canonical", so asking it returns the canonical
       view and the projection learns nothing about the legacy rows it is
       about to overwrite. That circularity made the hold dead code.

       Thread audience lives on the ROOT and replies inherit it; Kasper
       authorship is hard-hidden belt-and-braces so internal review chatter
       can never surface on a mis-tagged thread. */
    function _sxrClientVisibleLegacyRows(post, comp) {
        // One definition of the root-audience rule, shared with the canonical
        // side of the coverage comparison so the two sets stay comparable.
        return _prodRootAudienceClientRows(_sxrCommentsFor(post, comp));
    }
    function _sxrCommentsForView(post, comp) {
        if (!_isClientLink) {
            const list = _sxrCommentsFor(post, comp);
            return Array.isArray(list)
                ? list.filter(c => c && (!c.deleted || c.canonical) && !c.hidden)
                : [];
        }
        const canonicalGate = _prodCanonicalCommentGate(post, comp);
        if (!canonicalGate.linked) {
            // UNLINKED card: no native deliverable binding exists, so there is
            // no canonical thread for this component and F42 has nothing to
            // import into. Fall back to the pre-Slice-4 legacy card-array view.
            // Staff already reads these arrays here; this aligns the client
            // surface. Same filter the projection uses to decide whether a
            // replacement would hide anything.
            return _sxrClientVisibleLegacyRows(post, comp);
        }
        // A verified client link on a LINKED card never falls back to the legacy
        // card arrays. Until this exact SXR card/component/deliverable read
        // succeeds, the canonical client thread is simply unavailable.
        if (!canonicalGate.ready || !canonicalGate.client) return [];
        const list = _sxrCanonicalCommentsFor(post, comp);
        return list.filter(c => c
            && c.canonical === true
            && c.audience === 'client'
            && (!c.deleted || c.canonical)
            && !c.hidden);
    }
    function _sxrCommentRoots(arr) { return arr.filter(c => !c.parent_id && (!c.deleted || c.canonical) && !c.hidden).sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))); }
    function _sxrCommentReplies(arr, rootId) { return arr.filter(c => c.parent_id === rootId && (!c.deleted || c.canonical) && !c.hidden).sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))); }
    function _sxrCommentRole() { return _isClientLink ? 'client' : 'smm'; }
    function _sxrCurrentAuthor() { return _isClientLink ? (sxrState.client ? String(sxrState.client) : 'Client') : 'Synchro Social'; }
    function _sxrMintCommentId() { return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7); }
    function _sxrOpenCommentCount(post) { if (!post) return 0; let n = 0; for (const c of SXR_COMPONENTS) { const list = _sxrCommentsForView(post, c); for (const root of _sxrCommentRoots(list || [])) { if (!root.deleted && _sxrMsgIsTweak(root) && !root.done) n++; } } return n; }
    function _sxrFmtCommentTime(iso) { const t = Date.parse(iso || ''); if (!isFinite(t)) return ''; const mins = Math.round((Date.now() - t) / 60000); if (mins < 1) return 'just now'; if (mins < 60) return mins + 'm ago'; const hrs = Math.round(mins / 60); if (hrs < 24) return hrs + 'h ago'; const days = Math.round(hrs / 24); if (days < 7) return days + 'd ago'; return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
    function _sxrAvatarInitial(name, role) { const s = String(name || '').trim(); if (s) return s.charAt(0).toUpperCase(); return role === 'client' ? 'C' : 'S'; }
    function _sxrLinearUrlFor(post, comp) { if (!post) return ''; if (comp === 'graphic') return String(post.graphic_linear_issue_id || '').trim(); return String(post.linear_issue_id || '').trim(); }
    // _sxrPostLinearComment — real version in Surface 7 (outbox-backed), hoisted.

    /* ── Kasper-seen ledger + review predicates ── */
    const SXR_KASPER_SEEN_KEY = 'syncview_sxr_kasper_seen_v1';
    const _sxrKasperSeen = (() => { try { return new Set(JSON.parse(localStorage.getItem(SXR_KASPER_SEEN_KEY) || '[]')); } catch (e) { return new Set(); } })();
    function _sxrKasperSeenKey(pid, comp) { return String(pid) + '|' + comp; }
    function _sxrMarkKasperSeen(pid, comp) { const k = _sxrKasperSeenKey(pid, comp); if (!pid || _sxrKasperSeen.has(k)) return; _sxrKasperSeen.add(k); try { localStorage.setItem(SXR_KASPER_SEEN_KEY, JSON.stringify([..._sxrKasperSeen])); } catch (e) {} }
    function _sxrWasKasperSeen(pid, comp) { return _sxrKasperSeen.has(_sxrKasperSeenKey(pid, comp)); }
    function _sxrHasBeenToKasper(post, comp) {
        if (!post) return false;
        if (_sxrWasKasperSeen(post.id, comp)) return true;
        if (String(post.kasper_seen || '').split(',').map(s => s.trim()).indexOf(comp) !== -1) { _sxrMarkKasperSeen(post.id, comp); return true; }
        const cs = _sxrNormStatus(post[comp + '_status'] || '');
        if (cs === 'Kasper Approval' || cs === 'Client Approval' || cs === 'Approved') { _sxrMarkKasperSeen(post.id, comp); return true; }
        if ((_sxrCommentsFor(post, comp) || []).some(c => c && c.role === 'kasper')) { _sxrMarkKasperSeen(post.id, comp); return true; }
        return false;
    }
    function _sxrRecordKasperSeenOnPost(post, comp) {
        _sxrMarkKasperSeen(post.id, comp);
        const set = new Set(String(post.kasper_seen || '').split(',').map(s => s.trim()).filter(Boolean));
        SXR_COMPONENTS.forEach(c => { if (_sxrWasKasperSeen(post.id, c)) set.add(c); });
        set.add(comp);
        const csv = SXR_COMPONENTS.filter(c => set.has(c)).join(',');
        post.kasper_seen = csv; return csv;
    }
    function _sxrShowApprovedAfterTweaks(post, comp) {
        const set = new Set(String((post && post.kasper_approved_after_tweaks) || '').split(',').map(s => s.trim()).filter(Boolean));
        if (!set.has(comp)) return false;
        return _sxrNormStatus((post && post[comp + '_status']) || 'In Progress') !== 'Approved';
    }
    function _sxrHasMedia(p) { return !!(String((p && p.asset_url) || '').trim() || String((p && p.thumbnail_url) || '').trim()); }

    /* ── Review render ── */
    const _sxrReviewState = {
        expanded: new Set(),
        drafts: Object.create(null),
        saving: Object.create(null),
        errors: Object.create(null),
        draftActionIds: Object.create(null),
        errorActionIds: Object.create(null)
    };
    const _SXR_REVIEW_CFG = { client: { reviewStatus: 'Client Approval', approveTo: 'Approved' }, smm: { reviewStatus: 'For SMM Approval', approveTo: 'Kasper Approval' } };
    /* One definition of where an SMM approval lands, so the pre-resolve guard
       and the approve cannot disagree. Calendar twin: _calSmmApproveTo. */
    function _sxrSmmApproveTo(dest) {
        return dest === 'client' ? 'Client Approval' : (dest === 'approved' ? 'Approved' : 'Kasper Approval');
    }
    /* The resolve chooser's auto-route destination. Default differs from the
       approve-onward above for the same reason as the calendar twin
       (_calAutoResolveDestStatus). */
    function _sxrAutoResolveDestStatus(dest) {
        return (dest === 'kasper') ? 'Kasper Approval'
             : (dest === 'approved') ? 'Approved'
             : 'Client Approval';
    }
    function _sxrReviewMode() { return (!_isClientLink && sxrState.view === 'smmreview') ? 'smm' : 'client'; }
    function _sxrReviewComponentActive(p, c, mode) { const cs = _sxrNormStatus(p[c + '_status'] || ''); if (cs === _SXR_REVIEW_CFG[mode].reviewStatus) return true; return mode !== 'smm' && cs === 'Tweaks Needed' && !_isClientLink; }
    function _sxrApprovalBadgeCount(mode) {
        const reviewStatus = _SXR_REVIEW_CFG[mode].reviewStatus;
        return (sxrState.posts || []).reduce((n, p) => { if (mode === 'smm' && !_sxrHasMedia(p)) return n; const awaiting = SXR_REVIEW_COMPONENTS.some(c => _sxrNormStatus(p[c + '_status'] || '') === reviewStatus); return n + (awaiting ? 1 : 0); }, 0);
    }
    function _sxrUpdateReviewBadge() {
        document.querySelectorAll('#sxrView .cal-view-btn').forEach(btn => {
            const v = btn.dataset.calView; if (v !== 'review' && v !== 'smmreview') return;
            const count = _sxrApprovalBadgeCount(v === 'smmreview' ? 'smm' : 'client');
            let badge = btn.querySelector('.cal-view-badge');
            if (count > 0) { if (!badge) { badge = document.createElement('span'); badge.className = 'cal-view-badge'; btn.appendChild(badge); } badge.textContent = String(count); }
            else if (badge) badge.remove();
        });
    }
    function _sxrReviewItems() {
        const mode = _sxrReviewMode();
        return (sxrState.posts || []).filter(p => {
            if (_sxrNormStatus(p.status || '') === 'Approved') return false;
            if (mode === 'smm') { if (!_sxrHasMedia(p)) return false; return SXR_REVIEW_COMPONENTS.some(c => _sxrReviewComponentActive(p, c, 'smm')); }
            if (_isClientLink) return SXR_REVIEW_COMPONENTS.some(c => _sxrReviewComponentActive(p, c, 'client'));
            return true;
        }).slice().sort((a, b) => Number(a.order_index || 0) - Number(b.order_index || 0));
    }
    /* THE SAMPLES TWIN of _calReviewStrandedForMedia, and it was missing.
       _sxrReviewItems drops a sample with no media BEFORE testing whether it is
       awaiting approval, and _sxrApprovalBadgeCount repeats the same skip, so
       the badge agrees with the wrong list. A sample sitting at For SMM
       Approval with no asset_url and no thumbnail_url therefore vanished from
       the queue the SMM works from, under an empty state that said nothing was
       waiting.
       The calendar had exactly this and it was fixed on 2026-08-31 (item 87.3,
       PR 1185 -- no hash, because the colour guard reads one as a hex literal,
       which is why every PR reference in this file is written that way). The
       ledger predicted this file at the time: "fixing one surface and not its
       sibling is how this gate got missed the first time." It was missed the
       second time too.
       The MEDIA GATE ITSELF IS UNCHANGED, deliberately. _sxrReviewCardHtml is
       built around a video or a thumbnail; admitting a card with neither would
       render approve and request-change controls over a deliverable that does
       not exist. The card stays out and the reader is told it is out, which is
       the shape the owner ratified on the calendar. */
    function _sxrReviewStrandedForMedia() {
        if (_sxrReviewMode() !== 'smm') return [];
        return (sxrState.posts || []).filter(p => {
            if (!p) return false;
            if (_sxrNormStatus(p.status || '') === 'Approved') return false;
            if (_sxrHasMedia(p)) return false;
            return SXR_REVIEW_COMPONENTS.some(c => _sxrReviewComponentActive(p, c, 'smm'));
        });
    }
    function _sxrReviewStrandedNoticeHtml() {
        const stranded = _sxrReviewStrandedForMedia();
        if (!stranded.length) return '';
        const n = stranded.length;
        const names = stranded.slice(0, 4).map(p => _sxrEsc(String(p.name || p.id || 'Untitled'))).join(', ');
        const more = n > 4 ? ' and ' + (n - 4) + ' more' : '';
        return '<div class="cal-review-stranded" data-sxr-review-stranded="' + n + '">'
            + n + (n === 1 ? ' sample is' : ' samples are') + ' waiting on SMM approval but cannot be reviewed here yet, '
            + 'because no video or thumbnail has landed on ' + (n === 1 ? 'it' : 'them') + ' — '
            + names + more + '.</div>';
    }
    function renderSxrReview() {
        const items = _sxrReviewItems();
        /* Above the queue in BOTH states, same as the calendar. An empty queue
           with stranded work is the case that made this necessary; a non-empty
           queue quietly missing a card is the same lie, just harder to see. */
        const stranded = _sxrReviewStrandedNoticeHtml();
        if (!items.length) {
            const msg = _sxrReviewMode() === 'smm'
                ? (stranded
                    ? 'Nothing can be reviewed here right now.'
                    : 'Nothing waiting on SMM approval right now — samples with a linked video or thumbnail appear here when they reach the SMM Approval stage.')
                : 'Nothing to review right now — every sample is either fully approved or still being worked on.';
            return `<div class="cal-review-wrap">${stranded}<div class="cal-empty">${msg}</div></div>`;
        }
        return `<div class="cal-review-wrap">${stranded}<div class="cal-review-list">${items.map(p => _sxrReviewCardHtml(p)).join('')}</div></div>`;
    }
    function _sxrReviewPendingLabel(p) {
        const mode = _sxrReviewMode();
        const reviewStatus = _SXR_REVIEW_CFG[mode].reviewStatus;
        const showInFlight = mode !== 'client' || !_isClientLink;
        const awaiting = [], inFlight = [];
        for (const c of SXR_REVIEW_COMPONENTS) { const cs = _sxrNormStatus(p[c + '_status'] || ''); if (cs === reviewStatus) awaiting.push(c); else if (showInFlight && cs === 'Tweaks Needed') inFlight.push(c); }
        if (!awaiting.length && !inFlight.length) return '';
        const human = (list) => { const labels = list.map(c => `<span class="kcard-pending-strong">${_sxrEsc(COMP_LABELS[c])}</span>`); if (labels.length === 1) return labels[0]; return labels.slice(0, -1).join(', ') + ' and ' + labels.slice(-1)[0]; };
        const parts = [];
        if (awaiting.length) parts.push(human(awaiting) + (awaiting.length === 1 ? ' needs' : ' need') + (mode === 'smm' ? ' SMM approval' : ' your review'));
        if (inFlight.length) parts.push(mode === 'smm' ? ('tweaks requested on ' + human(inFlight)) : ("we're working on your tweaks for " + human(inFlight)));
        const joined = parts.join(' · ');
        return joined.charAt(0).toUpperCase() + joined.slice(1);
    }
    function _sxrReviewCardHtml(p) {
        const escId = _sxrEscAttr(p.id);
        const expanded = _sxrReviewState.expanded.has(p.id);
        const info = _sxrDeriveThumbInfo(p);
        const thumbHtml = info.url ? _calThumbImgTag(info, '_calOnMiniThumbError') : info.frame ? _sxrMiniLinkBadgeHtml('kcard-thumb-fallback', info.frameKind) : `<span class="kcard-thumb-fallback">${_sxrThumbIconSvg()}</span>`;
        const pendingLabel = _sxrReviewPendingLabel(p);
        const compPills = _sxrClientCompPillsHtml(p);
        const body = expanded ? _sxrReviewCardBody(p) : '';
        return `<div class="kcard cal-review-card${expanded ? ' expanded' : ''}" data-cal-review-pid="${escId}">
            <div class="kcard-strip" onclick="_sxrReviewToggleCard('${escId}')">
                <div class="kcard-thumb">${thumbHtml}</div>
                <div class="kcard-main">
                    <div class="kcard-title">${_sxrEsc(p.name || 'Untitled')}</div>
                    ${pendingLabel ? `<div class="kcard-pending">${pendingLabel}</div>` : ''}
                    ${compPills ? `<div class="cal-review-sub-row">${compPills}</div>` : ''}
                </div>
                <div class="kcard-actions" onclick="event.stopPropagation();">
                    ${_thumbCompareSlotHtml('samples', p, true, 'review')}
                    <button class="kcard-open-sheet" type="button" onclick="_sxrReviewOpenInSheet('${escId}')" title="Open this sample in the Sheet" aria-label="Open in Sheet"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M2.5 6h11M6.5 6v7"/></svg></button>
                    <button class="kcard-expand-btn" type="button" onclick="_sxrReviewToggleCard('${escId}')" aria-label="${expanded ? 'Collapse' : 'Expand'}"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5l4 4 4-4"/></svg></button>
                </div>
            </div>
            ${body}
        </div>`;
    }
    function _sxrReviewCardBody(p) {
        const mode = _sxrReviewMode();
        const activeComps = (mode === 'smm')
            ? SXR_REVIEW_COMPONENTS.filter(c => _sxrReviewComponentActive(p, c, 'smm'))
            : (_isClientLink ? SXR_REVIEW_COMPONENTS.filter(c => _sxrReviewComponentActive(p, c, 'client')) : SXR_REVIEW_COMPONENTS.slice());
        if (!activeComps.length) return `<div class="cal-review-body" onclick="event.stopPropagation();"><div class="cal-empty" style="grid-column:1/-1;padding:12px;">Nothing left to review on this sample.</div></div>`;
        const cols = activeComps.length;
        return `<div class="cal-review-body" style="grid-template-columns: repeat(${cols}, minmax(0, 1fr));" onclick="event.stopPropagation();">${activeComps.map(comp => _sxrReviewPanelHtml(p, comp)).join('')}</div>`;
    }
    function _sxrReviewPanelHtml(p, comp) {
        const escId = _sxrEscAttr(p.id), escComp = _sxrEscAttr(comp);
        const subStatus = _sxrNormStatus(p[comp + '_status'] || '');
        const state = subStatus === 'Approved' ? 'approved' : (subStatus === 'Tweaks Needed' ? 'tweaks' : 'pending');
        const comments = _sxrCommentsForView(p, comp);
        if (state === 'approved') {
            const checkIco = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8.5L6.5 12L13 4"/></svg>`;
            return `<div class="cal-review-panel cal-review-panel-mini" data-comp="${escComp}" data-state="approved"><span class="cal-review-mini-icon">${checkIco}</span><span class="cal-review-mini-label">${_sxrEsc(COMP_LABELS[comp])} approved</span><span class="cal-review-mini-sub">Locked in</span></div>`;
        }
        const previewHtml = _sxrReviewComponentPreview(p, comp);
        const draftKey = p.id + '|' + comp;
        const draft = _sxrReviewState.drafts[draftKey] || '';
        const saving = !!_sxrReviewState.saving[draftKey];
        const err = _sxrReviewState.errors[draftKey] || '';
        const mode = _sxrReviewMode();
        const reviewStatus = _SXR_REVIEW_CFG[mode].reviewStatus;
        const canAct = (mode === 'smm' || _isClientLink) ? (subStatus === reviewStatus || subStatus === 'Tweaks Needed') : true;
        const hasDraft = !!draft.trim();
        const inTweaks = subStatus === 'Tweaks Needed';
        const showApprove = canAct && subStatus !== 'Approved';
        const approveEnabled = showApprove && !saving && !hasDraft && !inTweaks;
        const tweakEnabled = canAct && !saving && hasDraft;
        const stateLabel = inTweaks ? 'Changes requested' : (subStatus === 'Client Approval' ? 'Awaiting your approval' : (subStatus === 'For SMM Approval' ? 'Awaiting SMM approval' : subStatus));
        const placeholder = inTweaks ? 'The team is working on it. Anything else to add?' : 'Add a note or request a change…';
        const checkIco = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8.5L6.5 12L13 4"/></svg>`;
        const sendIco = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8h11M9 3.5L13.5 8L9 12.5"/></svg>`;
        const resolvedIco = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.5L5 9.5L10 3.5"/></svg>`;
        const threadHtml = comments && comments.length
            ? comments.map(c => {
                const author = c.author || (c.role === 'client' ? 'Client' : c.role === 'kasper' ? 'Kasper' : 'SMM');
                const isResolved = !!c.done;
                const resolvedBadge = isResolved ? `<span class="cal-review-resolved-pill">${resolvedIco}Resolved</span>` : '';
                return `<div class="cal-review-comment cal-cm-${c.role || 'smm'}${c.parent_id ? ' is-reply' : ''}${isResolved ? ' is-resolved' : ''}"><div class="cal-review-comment-head"><strong>${_sxrEsc(author)}</strong><span class="cal-review-comment-time">${_sxrEsc(_sxrFmtCommentTime(c.created_at))}</span>${resolvedBadge}</div><div class="cal-review-comment-body">${_sxrEsc(c.body || '')}</div></div>`;
            }).join('')
            : `<div class="cal-review-comment-empty">No comments yet.</div>`;
        const statusPill = !inTweaks ? '' : `<span class="cal-review-panel-status">${_sxrEsc(stateLabel)}</span>`;
        const seenByKasper = mode === 'smm' && _sxrHasBeenToKasper(p, comp);
        const firstReviewBadge = (mode === 'smm' && showApprove && !seenByKasper) ? `<span class="cal-review-firstpass" title="This hasn't been sent to Kasper yet">First review</span>` : '';
        const aatBadge = (mode === 'smm' && _sxrShowApprovedAfterTweaks(p, comp)) ? `<span class="cal-review-aat-pill" title="Kasper pre-cleared this for the client."><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/></svg></span>` : '';
        let approveControl = '';
        if (showApprove) {
            if (mode === 'smm') {
                const primary = seenByKasper ? 'client' : 'kasper', alt = seenByKasper ? 'kasper' : 'client';
                const lbl = d => d === 'kasper' ? 'Kasper' : 'Client';
                const dis = approveEnabled ? '' : 'disabled';
                const altIdle = 'Approve & send to ' + lbl(alt) + ' instead';
                approveControl = `<div class="cal-review-approve-split"><button type="button" class="cal-review-approve-btn cal-review-approve-main" ${dis} data-idle-title="" title="${hasDraft ? _sxrEscAttr(REVIEW_APPROVE_DRAFT_TITLE) : ''}" onclick="_sxrReviewApprove('${escId}','${escComp}','${primary}')">${checkIco}<span class="cal-ap-verb">Approve</span><span class="cal-ap-route">${lbl(primary)}</span></button><button type="button" class="cal-review-approve-alt" ${dis} data-idle-title="${_sxrEscAttr(altIdle)}" title="${hasDraft ? _sxrEscAttr(REVIEW_APPROVE_DRAFT_TITLE) : _sxrEscAttr(altIdle)}" onclick="_sxrReviewApprove('${escId}','${escComp}','${alt}')">${lbl(alt)}</button></div>`;
            } else {
                approveControl = `<button type="button" class="cal-review-approve-btn" ${approveEnabled ? '' : 'disabled'} data-idle-title="" title="${hasDraft ? _sxrEscAttr(REVIEW_APPROVE_DRAFT_TITLE) : ''}" onclick="_sxrReviewApprove('${escId}','${escComp}')">${checkIco}Approve ${_sxrEsc(COMP_LABELS[comp].toLowerCase())}</button>`;
            }
        }
        return `<div class="cal-review-panel" data-comp="${escComp}" data-state="${state}">
            <div class="cal-review-panel-head"><span class="cal-review-panel-title">${_sxrEsc(COMP_LABELS[comp])}</span>${firstReviewBadge}${aatBadge}<div class="cal-review-panel-head-right">${statusPill}</div></div>
            <div class="cal-review-panel-preview">${previewHtml}</div>
            ${approveControl}
            <div class="cal-review-panel-compose">
                <textarea class="cal-review-textarea" placeholder="${_sxrEscAttr(placeholder)}" data-cal-review-draft="${escId}|${escComp}" oninput="_sxrReviewOnDraftInput(this,'${escId}','${escComp}')" ${canAct ? '' : 'readonly'}>${_sxrEsc(draft)}</textarea>
                <div class="cal-review-tweak-actions">
                    <button type="button" class="cal-review-comment-btn" ${tweakEnabled ? '' : 'disabled'} onclick="_sxrReviewComment('${escId}','${escComp}')" title="Leave a comment — won't change the status"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>Comment</button>
                    <button type="button" class="cal-review-tweak-btn" ${tweakEnabled ? '' : 'disabled'} onclick="_sxrReviewRequestTweak('${escId}','${escComp}')">${sendIco}Request change</button>
                </div>
            </div>
            ${err ? `<div class="cal-review-panel-err">${_sxrEsc(err)}</div>` : ''}
            <div class="cal-review-thread">${threadHtml}</div>
        </div>`;
    }
    function _sxrReviewComponentPreview(p, comp) {
        if (comp === 'video') {
            const url = String(p.asset_url || '').trim();
            if (!url) return `<div class="cal-review-preview-empty">No video yet.</div>`;
            const thumbUrl = _sxrDeriveThumb(p);
            const bg = thumbUrl ? `<img class="cal-review-video-bg" src="${_sxrEscAttr(thumbUrl)}" alt="" onerror="this.style.display='none'">` : '';
            return `<a class="cal-review-video-tile${thumbUrl ? '' : ' cal-review-video-tile-blank'}" href="${_sxrEscAttr(url)}" target="_blank" rel="noopener" aria-label="Open video">${bg}<span class="cal-review-video-overlay"><span class="cal-review-video-play"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></span><span class="cal-review-video-label">Open video ↗</span></span></a>`;
        }
        const raw = String(p.thumbnail_url || '').trim();
        if (!raw) return `<div class="cal-review-preview-empty">No thumbnail yet.</div>`;
        const info = _sxrDeriveThumbInfo(p);
        const imgUrl = info.url;
        if (!imgUrl) {
            const kind = _sxrIsFrameLink(raw) ? 'frame' : (_sxrIsFolderLink(raw) ? 'folder' : '');
            if (kind) return _sxrReviewFrameHtml(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw, '', kind);
            return `<div class="cal-review-preview-empty">Thumbnail can't preview.</div>`;
        }
        // Use the calendar's preview-thumb markup so the WHOLE thumbnail shows
        // (object-fit: contain, centred) AND open it in the same full-screen
        // lightbox the calendar uses (_calOpenThumbLightbox) instead of a new
        // tab — parity with the SMM Review / Client / Kasper preview.
        const escPid = _sxrEscAttr(p.id);
        return `<div class="cal-review-preview-thumb"><button type="button" class="cal-review-preview-thumb-btn" onclick="_sxrOpenThumbLightbox('${escPid}')" aria-label="Open thumbnail full screen">${_calThumbImgTag(info, '_calOnReviewThumbError')}</button></div>`;
    }
    function _sxrReviewToggleCard(pid) { if (_sxrReviewState.expanded.has(pid)) _sxrReviewState.expanded.delete(pid); else _sxrReviewState.expanded.add(pid); _sxrReviewRepaintCard(pid); }
    function _sxrReviewRepaintCard(pid) {
        const sel = (window.CSS && CSS.escape) ? CSS.escape(pid) : pid;
        const el = document.querySelector('.cal-review-card[data-cal-review-pid="' + sel + '"]');
        const post = sxrState.posts.find(p => p.id === pid);
        if (!el || !post) return;
        // Preserve the caret if the reviewer is typing in this card's draft when
        // the repaint fires (same guard the Kasper queue uses).
        const cap = _svCaptureFocus(el);
        const tmp = document.createElement('div'); tmp.innerHTML = _sxrReviewCardHtml(post);
        if (tmp.firstElementChild) { _sxrKcardReuseThumbInto(el, tmp.firstElementChild); el.replaceWith(tmp.firstElementChild); }
        _svRestoreFocus(cap);
        _sxrUpdateReviewBadge();
    }
    function _sxrReviewRemoveCard(pid) {
        const sel = (window.CSS && CSS.escape) ? CSS.escape(pid) : pid;
        const el = document.querySelector('.cal-review-card[data-cal-review-pid="' + sel + '"]');
        if (!el) return;
        const list = el.closest('.cal-review-list');
        const finish = () => { el.remove(); if (!list || !list.querySelector('.cal-review-card')) _sxrRenderBody({ preserveScroll: true }); _sxrUpdateReviewBadge(); };
        const h = el.offsetHeight; if (!h) { finish(); return; }
        el.style.overflow = 'hidden'; el.style.height = h + 'px'; el.style.transition = 'height .2s ease, opacity .15s ease, margin .2s ease';
        void el.offsetHeight; el.style.opacity = '0'; el.style.height = '0px'; el.style.marginTop = '0px'; el.style.marginBottom = '0px';
        let done = false; const onEnd = () => { if (done) return; done = true; finish(); };
        el.addEventListener('transitionend', onEnd, { once: true }); setTimeout(onEnd, 280);
    }
    function _sxrReviewOpenInSheet(pid) {
        sxrState.focusPid = pid;
        if (sxrState.view !== 'organizer') { sxrState.view = 'organizer'; _sxrSavePrefs(); document.querySelectorAll('#sxrView .cal-view-btn').forEach(b => b.classList.toggle('active', b.dataset.calView === 'organizer')); _sxrApplyZoom(); }
        _sxrRenderBody();
        setTimeout(() => { const card = document.querySelector(`.cal-card[data-pid="${pid}"]`); if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 60);
    }

    /* ── Review handlers (approve / request-change / comment) ── */
    function _sxrReviewOnDraftInput(ta, pid, comp) {
        const key = pid + '|' + comp;
        _sxrReviewState.drafts[key] = ta.value;
        delete _sxrReviewState.draftActionIds[key];
        const nowHasDraft = !!ta.value.trim();
        const card = ta.closest('.cal-review-card'); if (!card) return;
        const panel = card.querySelector('.cal-review-panel[data-comp="' + comp + '"]'); if (!panel) return;
        panel.querySelectorAll('.cal-review-tweak-btn, .cal-review-comment-btn').forEach(b => { b.disabled = !nowHasDraft || !!_sxrReviewState.saving[key]; });
        panel.querySelectorAll('.cal-review-approve-btn, .cal-review-approve-alt').forEach(b => {
            b.disabled = nowHasDraft || !!_sxrReviewState.saving[key];
            // See _calReviewOnDraftInput: data-idle-title is read back, not
            // reconstructed, so restoring it can never drift from render.
            b.title = nowHasDraft ? REVIEW_APPROVE_DRAFT_TITLE : (b.getAttribute('data-idle-title') || '');
        });
    }
    function _sxrOpenTweaksForComp(post, comp) { const list = _sxrCommentsFor(post, comp); return Array.isArray(list) ? list.filter(c => c && !c.parent_id && !c.deleted && !c.done && _sxrMsgIsTweak(c)) : []; }
    function _sxrResolveTweaksDone(post, comp, ids) {
        if (!post || !Array.isArray(ids) || !ids.length) return false;
        const list = _sxrCommentsFor(post, comp).slice();
        const want = new Set(ids), at = new Date().toISOString(), by = _sxrCurrentAuthor();
        let changed = false;
        for (const c of list) { if (c && !c.parent_id && want.has(c.id) && !c.done && !c.deleted) { c.done = true; c.done_at = at; c.done_by = by; c.updated_at = at; changed = true; } }
        if (!changed) return false;
        _sxrSetCommentsFor(post, comp, list);
        _sxrPendingEdits[post.id] = Object.assign(_sxrPendingEdits[post.id] || {}, { [comp + '_tweaks']: _sxrStringifyComments(list) });
        return true;
    }
    /* ── Resolve-and-route chooser (ported faithfully from the calendar's _cal*
       family). When the SMM clears the LAST open change-request on a component
       (Notes "mark done") OR approves a component that still has open
       change-requests (Review tab), the cleared work must be ROUTED — the SMM
       picks Kasper / the client / straight to Approved — not silently resolved.
       Reuses the shared #resolveDestOverlay DOM. ── */
    let _sxrResolveDestCb = null;
    function _sxrResolveDestRecommend(post, comp) {
        if (!post) return 'client';
        if (_sxrShowApprovedAfterTweaks(post, comp)) return 'client';
        if (_sxrHasBeenToKasper(post, comp)) return 'client';
        return 'kasper';
    }
    function _sxrResolveDestReason(post, comp) {
        if (!post) return '';
        if (_sxrShowApprovedAfterTweaks(post, comp)) return 'Kasper pre-cleared this after tweaks, so it can skip his re-review.';
        if (_sxrHasBeenToKasper(post, comp)) return 'Kasper has already reviewed this once.';
        return 'This hasn’t been to Kasper yet.';
    }
    function _sxrShowResolveDest(opts) {
        opts = opts || {};
        const overlay = document.getElementById('resolveDestOverlay');
        const msg = document.getElementById('resolveDestMsg');
        const checklist = document.getElementById('resolveDestChecklist');
        const kBtn = document.getElementById('resolveDestKasper');
        const cBtn = document.getElementById('resolveDestClient');
        const aBtn = document.getElementById('resolveDestApprove');
        const openTweaks = (Array.isArray(opts.openTweaks) ? opts.openTweaks : []).filter(Boolean);
        // No overlay (stripped DOM) → fall back to the recommended route + resolve all.
        if (!overlay || !kBtn || !cBtn || !aBtn) { if (opts.onChoose) opts.onChoose(opts.recommend || 'client', openTweaks.map(t => t.id)); return; }
        const compLabel = (COMP_LABELS[opts.comp] || 'this').toLowerCase();
        // The checklist earns its keep only with a genuine choice (2+ open); with
        // one, the single change-request is implied by the route, so we hide it.
        if (checklist) {
            if (openTweaks.length >= 2) {
                checklist.innerHTML = openTweaks.map(t => {
                    const body = String(t.body || '').replace(/\s+/g, ' ').trim();
                    const short = body.length > 90 ? body.slice(0, 88) + '…' : (body || '(no message)');
                    const who = t.role === 'kasper' ? 'Kasper' : (t.role === 'client' ? 'Client' : (t.author || 'Note'));
                    const rd = t.round ? ('Tweak #' + t.round) : 'Tweak';
                    return '<label class="resolve-dest-check"><input type="checkbox" data-rd-id="' + _sxrEscAttr(t.id) + '" checked>'
                        + '<span><span class="rd-round">' + _sxrEsc(rd) + '</span> · ' + _sxrEsc(who) + ' — ' + _sxrEsc(short) + '</span></label>';
                }).join('');
                checklist.hidden = false;
            } else { checklist.innerHTML = ''; checklist.hidden = true; }
        }
        const n = openTweaks.length;
        const lead = n >= 2 ? 'Tick the change requests you’ve handled — they’ll be marked done. '
                   : n === 1 ? 'This change request will be marked done. ' : '';
        const toKasper = opts.recommend === 'kasper';
        const toApproved = opts.recommend === 'approved';
        if (msg) msg.textContent = lead + 'Then send the ' + compLabel + ' onward: '
            + (toApproved ? 'mark it approved — or to Kasper or the client first.'
               : toKasper ? 'to Kasper for approval — or straight to the client.'
                          : 'to the client for approval — or back to Kasper first.')
            + (opts.reason ? ' (' + opts.reason + ')' : '');
        kBtn.classList.toggle('primary', toKasper);
        cBtn.classList.toggle('primary', !toKasper && !toApproved);
        aBtn.classList.toggle('primary', toApproved);
        const tickedIds = () => {
            if (!checklist || checklist.hidden) return openTweaks.map(t => t.id);
            return Array.from(checklist.querySelectorAll('input[data-rd-id]')).filter(i => i.checked).map(i => i.getAttribute('data-rd-id'));
        };
        _sxrResolveDestCb = (typeof opts.onChoose === 'function') ? opts.onChoose : null;
        const pick = (dest) => { const cb = _sxrResolveDestCb; const ids = tickedIds(); _sxrDismissResolveDest(); if (cb) cb(dest, ids); };
        kBtn.onclick = () => pick('kasper');
        cBtn.onclick = () => pick('client');
        aBtn.onclick = () => pick('approved');
        // "Mark done — don't change the status" (dest 'stay'): resolve the ticked
        // change-requests but route nowhere. Only from Notes — the Review tab's
        // "Approve & send" is inherently a route, so it hides this escape.
        const stayBtn = document.getElementById('resolveDestStay');
        if (stayBtn) { stayBtn.hidden = !!opts.fromReview; stayBtn.onclick = () => pick('stay'); }
        overlay.classList.add('active');
    }
    function _sxrDismissResolveDest() {
        const overlay = document.getElementById('resolveDestOverlay');
        if (overlay) overlay.classList.remove('active');
        _sxrResolveDestCb = null;
    }
    function _sxrResolveLastTweak(pid, comp, rootId) {
        const post = sxrState.posts.find(p => p.id === pid);
        if (!post) return;
        const root = _sxrOpenTweaksForComp(post, comp).find(c => c.id === rootId);
        _sxrShowResolveDest({
            comp: comp,
            recommend: _sxrResolveDestRecommend(post, comp),
            reason: _sxrResolveDestReason(post, comp),
            openTweaks: root ? [root] : [],
            fromReview: false,
            onChoose: async (destPick, ids) => {
                /* Refuse before resolving — see the calendar twin in
                   _calResolveLastTweak. */
                if (destPick !== 'stay') {
                    const _blocked = _sxrReviewBlockReason(post, comp, _sxrAutoResolveDestStatus(destPick));
                    if (_blocked) {
                        showNotify('Nothing to review yet', _blocked
                            + ' Nothing was changed — the change request is still open.');
                        return;
                    }
                }
                const chosen = (ids && ids.length) ? ids : [rootId];
                const canonicalGate = _prodCanonicalCommentGate(post, comp);
                if (canonicalGate.linked) {
                    for (const id of chosen) {
                        const comment = _sxrCommentsFor(post, comp).find(row => row && row.id === id);
                        if (!comment) continue;
                        const receipt = await _writeUiCommitCardCommentLifecycle(
                            'sxr', post, comp, comment, 'resolve', undefined,
                            { resolveDestination: destPick }
                        );
                        if (!receipt) return;
                    }
                } else {
                    _sxrResolveTweaksDone(post, comp, chosen);
                }
                if (destPick !== 'stay') _sxrApplyAutoStatus(pid, 'smm_resolved_last', comp, destPick);
                if (canonicalGate.linked) await _writeUiPersistCanonicalCommentProjection('sxr', post, comp);
                else _sxrWatchNoteSave(pid);
                _sxrRefreshCommentsBtn(pid);
                _sxrUpdateCardStatusDisplay(pid);
                _sxrCaptureModalDrafts();
                _sxrRenderCommentsModal();
            }
        });
    }
    function _sxrReviewApprove(pid, comp, dest) {
        const post = sxrState.posts.find(p => p.id === pid);
        if (!post) return;
        // SMM approving a component that still has open change-requests routes it
        // onward via the chooser (resolve the ticked requests + pick a destination)
        // instead of silently auto-resolving. Mirrors _calReviewApprove.
        if (_sxrReviewMode() === 'smm' && _sxrCanResolveComment()) {
            const open = _sxrOpenTweaksForComp(post, comp);
            if (open.length) {
                const key = pid + '|' + comp;
                if (_sxrReviewState.saving[key]) return;
                _sxrShowResolveDest({
                    comp: comp,
                    recommend: dest === 'client' ? 'client' : (dest === 'approved' ? 'approved' : 'kasper'),
                    reason: _sxrResolveDestReason(post, comp),
                    openTweaks: open,
                    fromReview: true,
                    onChoose: (pickDest, ids) => {
                        /* Refuse before the tweak thread is touched -- see the
                           calendar twin in _calReviewApprove. */
                        if (pickDest !== 'stay') {
                            const _blocked = _sxrReviewBlockReason(post, comp, _sxrSmmApproveTo(pickDest));
                            if (_blocked) {
                                showNotify('Nothing to review yet', _blocked
                                    + ' Nothing was changed — the change requests are still open.');
                                return;
                            }
                        }
                        const resolvedBefore = {
                            video_comments: post.video_comments,
                            graphic_comments: post.graphic_comments
                        };
                        _sxrResolveTweaksDone(post, comp, ids);
                        if (pickDest === 'stay') {
                            _sxrWatchNoteSave(pid);
                            _sxrRefreshCommentsBtn(pid);
                            _sxrUpdateCardStatusDisplay(pid);
                            _sxrReviewRepaintCard(pid);
                        } else {
                            _sxrReviewApplyApprove(pid, comp, pickDest, resolvedBefore);
                        }
                    }
                });
                return;
            }
        }
        _sxrReviewApplyApprove(pid, comp, dest);
    }
    function _sxrReviewApplyApprove(pid, comp, dest, resolvedBefore) {
        const post = sxrState.posts.find(p => p.id === pid);
        if (!post) return;
        const key = pid + '|' + comp;
        if (_sxrReviewState.saving[key]) return;
        const mode = _sxrReviewMode();
        const subKey = comp + '_status';
        if (_isClientLink) { const cur = String(post[subKey] || '').trim().toLowerCase(); if (cur !== 'client approval' && cur !== 'tweaks needed') return; }
        const prev = Object.assign({ [subKey]: post[subKey], status: post.status, [`client_${comp}_approved_at`]: post[`client_${comp}_approved_at`], kasper_seen: post.kasper_seen }, resolvedBefore || {});
        let approveTo = _SXR_REVIEW_CFG[mode].approveTo;
        if (mode === 'smm') approveTo = _sxrSmmApproveTo(dest);
        /* Guarded before the kasper_seen stamp, or the sample is marked seen
           for a review that never happened. Calendar twin: _calReviewApplyApprove. */
        const _sxrBlocked = _sxrReviewBlockReason(post, comp, approveTo);
        if (_sxrBlocked) {
            showNotify('Nothing to review yet', _sxrBlocked);
            return false;
        }
        let kasperSeenCsv = null;
        if (approveTo === 'Kasper Approval') kasperSeenCsv = _sxrRecordKasperSeenOnPost(post, comp);
        post[subKey] = approveTo;
        if (mode === 'client') post[`client_${comp}_approved_at`] = new Date().toISOString();
        post.status = computeSampleOverallStatus(post);
        post.updated_at = new Date().toISOString();
        _sxrReviewState.saving[key] = true; _sxrReviewState.errors[key] = '';
        delete _sxrReviewState.errorActionIds[key];
        _sxrMarkLocalStatus(pid, comp);
        const clearsCard = (mode === 'smm' || _isClientLink) && !SXR_REVIEW_COMPONENTS.some(c => _sxrReviewComponentActive(post, c, mode));
        _sxrReviewRepaintCard(pid);
        _sxrPendingEdits[pid] = Object.assign(_sxrPendingEdits[pid] || {}, { [subKey]: post[subKey], status: post.status }, mode === 'client' ? { [`client_${comp}_approved_at`]: post[`client_${comp}_approved_at`] } : {}, kasperSeenCsv != null ? { kasper_seen: kasperSeenCsv } : {});
        Promise.resolve(_sxrFlushCardSave(pid)).then(() => {
            _sxrReviewState.saving[key] = false;
            const current = sxrState.posts.find(p => p.id === pid) || post;
            if (current._saveError) {
                if (!current._writeUiRetrySourceAt) Object.assign(current, prev);
                _sxrReviewState.errors[key] = current._saveError || 'Save failed';
                _sxrReviewRepaintCard(pid);
                return;
            }
            if (clearsCard) _sxrReviewRemoveCard(pid); else _sxrReviewRepaintCard(pid);
        });
    }
    function _sxrReviewComment(pid, comp) {
        const post = sxrState.posts.find(p => p.id === pid);
        if (!post) return;
        const key = pid + '|' + comp;
        const body = String(_sxrReviewState.drafts[key] || '').trim();
        if (!body || _sxrReviewState.saving[key]) return;
        const role = _sxrCommentRole();
        const list = _sxrCommentsFor(post, comp).slice();
        const _now = new Date().toISOString();
        list.push({ id: _sxrMintCommentId(), parent_id: null, author: _sxrCurrentAuthor(), role, is_tweak: false, audience: (role === 'client') ? 'client' : 'internal', body, created_at: _now, updated_at: _now, done: false, done_at: '', done_by: '' });
        _sxrSetCommentsFor(post, comp, list);
        post.updated_at = _now;
        _sxrReviewState.drafts[key] = ''; _sxrReviewState.saving[key] = true; _sxrReviewState.errors[key] = '';
        delete _sxrReviewState.draftActionIds[key];
        delete _sxrReviewState.errorActionIds[key];
        _sxrReviewRepaintCard(pid);
        _sxrPendingEdits[pid] = Object.assign(_sxrPendingEdits[pid] || {}, { [comp + '_tweaks']: _sxrStringifyComments(list) });
        Promise.resolve(_sxrFlushCardSave(pid)).then(() => { _sxrReviewState.saving[key] = false; }).catch(e => { _sxrReviewState.saving[key] = false; _sxrReviewState.errors[key] = _writeUiFailureSentence(e); _sxrReviewRepaintCard(pid); });
    }
    function _sxrReviewRequestTweak(pid, comp) {
        const initialPost = sxrState.posts.find(p => p.id === pid);
        if (!initialPost) return;
        const key = pid + '|' + comp;
        const rawDraft = String(_sxrReviewState.drafts[key] || '');
        const body = rawDraft.trim();
        if (!body || _sxrReviewState.saving[key]) return;
        if (_isClientLink) {
            const cur = String(initialPost[comp + '_status'] || '').trim().toLowerCase();
            if (cur !== 'client approval' && cur !== 'tweaks needed') return;
        }
        const _legacySlug = _writeUiSourceClientSlug('sxr', { post: initialPost });
        let attemptId = '';
        let action = null;
        let deferredLegacyAttempt = false;
        let deferredLegacySourceOnly = false;
        let deferredLegacyOutboxIds = [];
        _sxrReviewState.saving[key] = true;
        _sxrReviewState.errors[key] = '';
        delete _sxrReviewState.errorActionIds[key];
        _sxrReviewRepaintCard(pid);

        // Begin the exact-target lock before reading ownership or constructing
        // any source snapshot. A waiting tab therefore cannot commit a list
        // captured before the first tab request became visible.
        Promise.resolve().then(() => _writeUiLegacyTargetWithLock(
            'sxr',
            _legacySlug,
            pid,
            comp,
            async () => {
                const post = sxrState.posts.find(p => p.id === pid);
                if (!post) throw new Error('This review item is no longer available');
                if (_isClientLink) {
                    const currentStatus = String(post[comp + '_status'] || '').trim().toLowerCase();
                    if (currentStatus !== 'client approval' && currentStatus !== 'tweaks needed') {
                        throw new Error('This item changed while your request was waiting. Your draft is preserved.');
                    }
                }
                attemptId = String(_sxrReviewState.draftActionIds[key] || '')
                    || _sxrMintCommentId();
                let inspection = await _writeUiLegacyInspectTargetTweak(
                    'sxr', _legacySlug, pid, comp, post, body, attemptId
                );
                inspection = await _writeUiLegacyRefreshActiveTweak('sxr', inspection);
                if (inspection.state === 'conflict') {
                    return { state: 'conflict', conflict: inspection, attempt_id: attemptId };
                }
                if (inspection.state === 'committed') {
                    return {
                        state: 'committed',
                        item: inspection.item,
                        ids: inspection.ids || [],
                        comment_id: inspection.comment_id,
                        source_only: inspection.source_only === true
                    };
                }

                const retryGate = inspection.state === 'active'
                    && inspection.pair && inspection.pair.gate
                    ? inspection.pair.gate
                    : null;
                const commentId = retryGate
                    ? String(retryGate.comment_id || '')
                    : attemptId;
                const role = retryGate ? String(retryGate.comment_role || '') : _sxrCommentRole();
                const author = retryGate ? String(retryGate.comment_author || '') : _sxrCurrentAuthor();
                const audience = retryGate
                    ? String(retryGate.comment_audience || '')
                    : (role === 'client' ? 'client' : 'internal');
                const list = _sxrCommentsFor(post, comp).slice();
                const existing = list.find(comment => comment
                    && String(comment.id || '') === commentId);
                if (existing && (
                    String(existing.body || '').trim() !== body
                    || String(existing.author || '') !== author
                    || String(existing.role || '') !== role
                    || String(existing.audience || '') !== audience
                    || existing.is_tweak !== true
                )) {
                    return {
                        state: 'conflict',
                        conflict: {
                            state: 'conflict',
                            comment_id: commentId,
                            delivered: false,
                            item: inspection.item || null,
                            reason: 'local_comment_signature_mismatch'
                        },
                        attempt_id: attemptId
                    };
                }
                const _now = retryGate && inspection.item && inspection.item.queuedAt
                    ? new Date(Number(inspection.item.queuedAt)).toISOString()
                    : new Date().toISOString();
                const newComment = existing || {
                    id: commentId,
                    parent_id: null,
                    author,
                    role,
                    is_tweak: true,
                    audience,
                    round: _sxrNextTweakRound(post, comp),
                    body,
                    created_at: _now,
                    updated_at: _now,
                    done: false,
                    done_at: '',
                    done_by: ''
                };
                const previousComments = list.map(comment => Object.assign({}, comment));
                const previousFields = {
                    [comp + '_status']: post[comp + '_status'],
                    status: post.status,
                    client_video_approved_at: post.client_video_approved_at,
                    client_graphic_approved_at: post.client_graphic_approved_at,
                    kasper_approved_at: post.kasper_approved_at,
                    updated_at: post.updated_at
                };
                if (!existing) list.push(newComment);
                _sxrSetCommentsFor(post, comp, list);
                post[comp + '_status'] = 'Tweaks Needed';
                post.status = computeSampleOverallStatus(post);
                post.updated_at = new Date().toISOString();
                _sxrReviewState.drafts[key] = '';
                delete _sxrReviewState.draftActionIds[key];
                const localStatusMarker = _writeUiRequestTweakMarkLocalStatus('sxr', pid, comp);
                const repairEdits = {
                    [comp + '_status']: post[comp + '_status'],
                    status: post.status,
                    [comp + '_tweaks']: _sxrStringifyComments(list)
                };
                _sxrClearStaleApprovals(post, repairEdits);
                const optimisticFields = {};
                Object.keys(previousFields).forEach(field => { optimisticFields[field] = post[field]; });
                const mode = _sxrReviewMode();
                const clearsCard = (mode === 'smm' || _isClientLink)
                    && !SXR_REVIEW_COMPONENTS.some(c => _sxrReviewComponentActive(post, c, mode));
                action = {
                    post,
                    newComment,
                    comment_id: commentId,
                    insertedComment: !existing,
                    previousComments,
                    previousFields,
                    optimisticFields,
                    localStatusMarker,
                    clearsCard,
                    rollbackApplied: false
                };
                _sxrReviewRepaintCard(pid);

                const acknowledgement = inspection.state === 'active'
                    || inspection.rearmed_team_delivery === true
                    ? { skipped: true, source_gate_retry: true, deferred_until_source_save: true }
                    : await _sxrPostLinearComment(_sxrLinearUrlFor(post, comp), body, newComment.author, {
                        post,
                        component: comp,
                        comment: newComment,
                        audience: _sxrMsgAudience(newComment),
                        isTweak: _sxrMsgIsTweak(newComment),
                        round: newComment.round,
                        repairEdits: Object.assign({}, repairEdits),
                        reserveStatusIntent: { status: post[comp + '_status'] },
                        deferLegacyUntilSourceSave: true
                    });
                const deferredLegacyComment =
                    !!(acknowledgement && acknowledgement.deferred_until_source_save);
                deferredLegacyAttempt = deferredLegacyComment;
                const committedBatch = Object.assign({}, repairEdits);
                _writeUiBindRepairAck(post, committedBatch, acknowledgement);
                if (deferredLegacyComment) {
                    const staged = await _writeUiQueueDeferredLegacyTweak(
                        'sxr',
                        post,
                        comp,
                        newComment,
                        body,
                        newComment.author,
                        repairEdits,
                        inspection
                    );
                    if (staged.state === 'conflict') {
                        return {
                            state: 'conflict',
                            conflict: staged,
                            attempt_id: attemptId,
                            action
                        };
                    }
                    deferredLegacySourceOnly = staged.source_only === true;
                    deferredLegacyOutboxIds = staged.ids || [];
                    if (staged.state === 'committed') {
                        return {
                            state: 'committed',
                            item: staged.item,
                            ids: deferredLegacyOutboxIds,
                            comment_id: staged.comment_id,
                            source_only: deferredLegacySourceOnly,
                            action
                        };
                    }
                    committedBatch._writeUiPinnedSourceTransport =
                        _writeUiLegacyPinnedSourceTransport('sxr', deferredLegacyOutboxIds);
                }
                const pending = _sxrPendingEdits[pid] || (_sxrPendingEdits[pid] = {});
                _writeUiMergeCommittedBatch(pending, committedBatch);
                if (deferredLegacyOutboxIds.length) _sxrNoLinearPush.add(pid + '|' + comp);
                await _sxrFlushCardSave(pid);
                return {
                    state: 'saved',
                    action,
                    ids: deferredLegacyOutboxIds,
                    deferred: deferredLegacyComment,
                    source_only: deferredLegacySourceOnly
                };
            }
        )).then(async outcome => {
            _sxrReviewState.saving[key] = false;
            const current = sxrState.posts.find(p => p.id === pid)
                || (action && action.post)
                || initialPost;
            if (outcome && outcome.state === 'conflict') {
                const targetConflict = outcome.conflict || {};
                if (outcome.action) {
                    _writeUiRollbackRequestTweak('sxr', current, comp, outcome.action);
                    outcome.action.rollbackApplied = true;
                }
                if (targetConflict.delivered
                    && targetConflict.item
                    && targetConflict.source_superseded !== true) {
                    _writeUiLegacyReconcileCommittedTweak('sxr', targetConflict.item);
                } else if (targetConflict.source_superseded !== true) {
                    _writeUiScheduleDeferredLegacyTweak('sxr');
                }
                _sxrReviewState.drafts[key] = rawDraft;
                _sxrReviewState.errors[key] = targetConflict.source_superseded === true
                    ? 'This request was saved, but a newer status was applied. Review the latest status before retrying.'
                    : (targetConflict.delivered
                        ? 'A change request from another tab was saved first. Your draft is preserved; review the latest status and retry.'
                        : 'Another change request for this item is still being confirmed. Your draft is preserved; retry after it finishes.');
                const failedActionId = String(outcome.action && outcome.action.comment_id
                    || outcome.attempt_id
                    || attemptId);
                _sxrReviewState.draftActionIds[key] = failedActionId;
                _sxrReviewState.errorActionIds[key] = failedActionId;
                _sxrRenderBody({ preserveScroll: true });
                return;
            }
            if (outcome && outcome.state === 'committed') {
                if (outcome.action) {
                    _writeUiRollbackRequestTweak('sxr', current, comp, outcome.action);
                    outcome.action.rollbackApplied = true;
                }
                let committedDeliveryOutcome = null;
                let committedDeliveryPending = false;
                if (outcome.ids && outcome.ids.length) {
                    try {
                        committedDeliveryOutcome = await _writeUiFlushDeferredLegacyTweak(
                            'sxr', outcome.ids
                        );
                    } catch (error) {
                        if (String(error && error.code || '') === 'legacy_tweak_delivery_unconfirmed') {
                            throw error;
                        }
                        committedDeliveryPending = true;
                        _writeUiScheduleDeferredLegacyTweak('sxr');
                        _writeUiReportFailure('sxr', 'comment', error);
                    }
                }
                if ((outcome.item && outcome.item.team_delivery_superseded === true)
                    || (committedDeliveryOutcome && committedDeliveryOutcome.state === 'superseded')) {
                    _writeUiApplySupersededTeamDelivery(
                        'sxr', current, comp, outcome.action || action, key, rawDraft,
                        outcome.comment_id || attemptId
                    );
                    return;
                }
                const sourceOnlySuperseded =
                    (outcome.item && outcome.item.source_only_superseded === true)
                    || (committedDeliveryOutcome
                        && committedDeliveryOutcome.state === 'source_only_superseded');
                _sxrReviewState.drafts[key] = '';
                _sxrReviewState.errors[key] = '';
                delete _sxrReviewState.draftActionIds[key];
                delete _sxrReviewState.errorActionIds[key];
                if (outcome.item) _writeUiLegacyReconcileCommittedTweak('sxr', outcome.item);
                _sxrRenderBody({ preserveScroll: true });
                if (typeof showToast === 'function') {
                    showToast(sourceOnlySuperseded
                        ? 'Change request saved — a newer status was applied'
                        : (outcome.source_only
                            ? 'Change request already saved'
                            : (committedDeliveryPending
                                ? 'Change request saved — team delivery is being confirmed'
                                : 'Change request already saved')));
                }
                return;
            }
            if (current._saveError) {
                const confirmed = _writeUiLegacyCommittedTweak('sxr', _legacySlug, pid, comp, current);
                if (confirmed && confirmed.delivered === true
                    && confirmed.team_delivery_superseded !== true
                    && action && confirmed.comment_id === String(action.comment_id || '')) {
                    if (!action.rollbackApplied) {
                        _writeUiRollbackRequestTweak('sxr', current, comp, action);
                        action.rollbackApplied = true;
                    }
                    _sxrReviewState.drafts[key] = '';
                    _sxrReviewState.errors[key] = '';
                    delete _sxrReviewState.draftActionIds[key];
                    delete _sxrReviewState.errorActionIds[key];
                    _writeUiLegacyReconcileCommittedTweak('sxr', confirmed.item);
                    _sxrRenderBody({ preserveScroll: true });
                    return;
                }
                if (deferredLegacyAttempt) _writeUiScheduleDeferredLegacyTweak('sxr');
                if (!current._writeUiRetrySourceAt && action) {
                    _writeUiRollbackRequestTweak('sxr', current, comp, action);
                    action.rollbackApplied = true;
                }
                _sxrReviewState.drafts[key] = rawDraft;
                _sxrReviewState.errors[key] = current._saveError || 'Save failed';
                _sxrReviewState.draftActionIds[key] = String(action && action.comment_id || attemptId);
                _sxrReviewState.errorActionIds[key] = String(action && action.comment_id || attemptId);
                _sxrRenderBody({ preserveScroll: true });
                return;
            }
            let deliveryPending = false;
            let deliveryOutcome = null;
            if (deferredLegacyOutboxIds.length) {
                try {
                    deliveryOutcome = await _writeUiFlushDeferredLegacyTweak(
                        'sxr', deferredLegacyOutboxIds
                    );
                } catch (error) {
                    if (String(error && error.code || '') === 'legacy_tweak_delivery_unconfirmed') {
                        throw error;
                    }
                    deliveryPending = true;
                    _writeUiScheduleDeferredLegacyTweak('sxr');
                    _writeUiReportFailure('sxr', 'comment', error);
                }
            }
            if (deliveryOutcome && deliveryOutcome.state === 'superseded') {
                _writeUiApplySupersededTeamDelivery(
                    'sxr', current, comp, action, key, rawDraft,
                    action && action.comment_id || attemptId
                );
                return;
            }
            if (deliveryOutcome && deliveryOutcome.state === 'source_only_superseded') {
                if (!action.rollbackApplied) {
                    _writeUiRollbackRequestTweak('sxr', current, comp, action);
                    action.rollbackApplied = true;
                }
                _sxrReviewState.drafts[key] = '';
                _sxrReviewState.errors[key] = '';
                delete _sxrReviewState.draftActionIds[key];
                delete _sxrReviewState.errorActionIds[key];
                _writeUiLegacyReconcileCommittedTweak('sxr', deliveryOutcome.item);
                _sxrRenderBody({ preserveScroll: true });
                if (typeof showToast === 'function') {
                    showToast('Change request saved — a newer status was applied');
                }
                return;
            }
            if (action && action.clearsCard) _sxrReviewRemoveCard(pid);
            else _sxrReviewRepaintCard(pid);
            if (_sxrCommentRole() === 'client' && !current._saveError
                && typeof showToast === 'function') {
                showToast(deferredLegacySourceOnly
                    ? (deliveryPending
                        ? 'Change request saved — confirmation is still pending'
                        : 'Change request sent')
                    : (deliveryPending
                        ? 'Change request saved — team delivery is being confirmed'
                        : 'Change request sent — the team has been notified'));
            }
        }).catch(e => {
            if (deferredLegacyAttempt || deferredLegacyOutboxIds.length) {
                _writeUiScheduleDeferredLegacyTweak('sxr');
            }
            _sxrReviewState.saving[key] = false;
            const current = sxrState.posts.find(p => p.id === pid)
                || (action && action.post)
                || initialPost;
            const confirmed = _writeUiLegacyCommittedTweak('sxr', _legacySlug, pid, comp, current);
            if (confirmed
                && confirmed.delivered === true
                && confirmed.team_delivery_superseded !== true
                && String(e && e.code || '') !== 'legacy_tweak_delivery_unconfirmed'
                && action
                && confirmed.comment_id === String(action.comment_id || '')) {
                if (!action.rollbackApplied) {
                    _writeUiRollbackRequestTweak('sxr', current, comp, action);
                    action.rollbackApplied = true;
                }
                _sxrReviewState.drafts[key] = '';
                _sxrReviewState.errors[key] = '';
                delete _sxrReviewState.draftActionIds[key];
                delete _sxrReviewState.errorActionIds[key];
                _writeUiLegacyReconcileCommittedTweak('sxr', confirmed.item);
                _sxrRenderBody({ preserveScroll: true });
                return;
            }
            if (action && !action.rollbackApplied && !current._writeUiRetrySourceAt) {
                _writeUiRollbackRequestTweak('sxr', current, comp, action);
                action.rollbackApplied = true;
            }
            _sxrReviewState.drafts[key] = rawDraft;
            _writeUiReportFailure('sxr', 'comment', e);
            _sxrReviewState.errors[key] = _writeUiFailureSentence(e);
            _sxrReviewState.draftActionIds[key] = String(action && action.comment_id || attemptId);
            _sxrReviewState.errorActionIds[key] = String(action && action.comment_id || attemptId);
            _sxrRenderBody({ preserveScroll: true });
        });
    }

    /* ── Comments button (open-tweak count + unread dot + AAT badge) ── */
    // A fresh message from the OTHER role (not mine), newer than the last time I
    // opened this card's Notes, lights the unread dot. Mirrors _calHasUnreadNotes;
    // reuses the shared _notesGetSeen ledger (keyed by post id — sample ids are
    // distinct from calendar ids, so there's no collision).
    function _sxrHasUnreadNotes(post) {
        if (!post) return false;
        const myRole = _sxrCommentRole();
        const seen = _notesGetSeen(post.id);
        for (const c of SXR_COMPONENTS) {
            const list = _sxrCommentsForView(post, c);
            if (!Array.isArray(list)) continue;
            for (const m of list) {
                if (!m || m.deleted || m.role === myRole) continue;
                const t = String(m.updated_at || m.created_at || '');
                if (t && (!seen || t > seen)) return true;
            }
        }
        return false;
    }
    // "Approved after tweaks" badge — Kasper pre-cleared a still-in-flight component
    // (his "approve after tweaks"); the SMM should verify the edit then send onward.
    // Mirrors _calAatBadgeHtml.
    function _sxrAatBadgeHtml(post) {
        if (!post || !SXR_COMPONENTS.some(c => _sxrShowApprovedAfterTweaks(post, c))) return '';
        return `<span class="cal-aat-badge" title="No more tweaks needed — Kasper pre-cleared this for the client. Verify the edit was applied, then send to the client."><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/></svg></span>`;
    }
    function _sxrCommentsBtnHtml(post, pid) {
        const open = _sxrOpenCommentCount(post);
        const unread = _sxrHasUnreadNotes(post);
        const cls = (open > 0 ? ' has-open' : '') + (unread ? ' has-unread' : '');
        const tip = unread ? 'New replies — open Notes' : (open > 0 ? open + ' open change request' + (open === 1 ? '' : 's') : 'Notes');
        const ico = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.5h11a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H7l-3 2.5V12H2.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/></svg>`;
        return `<span class="cal-foot-tweaks" data-comments-wrap="${pid}"><button type="button" class="cal-comments-btn cal-card-notes${cls}" data-comments-btn="${pid}" onclick="openSxrComments('${pid}')" title="${_sxrEscAttr(tip)}">${ico}<span class="cal-comments-label">Notes</span>${unread ? '<span class="cal-comments-dot" aria-label="New replies"></span>' : ''}<span class="cal-comments-count">${open}</span></button>${_sxrAatBadgeHtml(post)}</span>`;
    }
    function _sxrRefreshCommentsBtn(pid) {
        const sel = (window.CSS && CSS.escape) ? CSS.escape(pid) : pid;
        const wrap = document.querySelector(`.cal-foot-tweaks[data-comments-wrap="${sel}"]`);
        const post = sxrState.posts.find(p => p.id === pid);
        if (!wrap || !post) return;
        const tmp = document.createElement('div'); tmp.innerHTML = _sxrCommentsBtnHtml(post, pid);
        if (tmp.firstElementChild) wrap.replaceWith(tmp.firstElementChild);
    }

    /* ============================================================
       --- SURFACE 5: the Notes / comments modal ---
       Clone of openCalComments / _calRenderCommentsModal / _calComposerHtml /
       _calCommentActionsHtml + the append / delete / resolve / reply handlers +
       the compose toggles, over video+graphic. Reuses the calendar's GLOBAL
       cal-comments-* / cal-cm-* CSS for pixel parity and the Surface 4 comment
       data layer. Component picker = Video / Thumbnail. The resolve-route chooser
       is simplified (Mark done resolves in place; no Kasper/Client route modal);
       the Linear comment push rides Surface 7's _sxrPostLinearComment.
       ============================================================ */

    let _sxrOpenCommentsPid = null;
    let _sxrReplyTarget = null;
    let _sxrReplyDrafts = Object.create(null);
    /* THE SAMPLES TWIN of the calendar's reply-draft store (OPEN_REPAIRS 101,
       point 4). It was left out when that shipped, and the omission is the
       repeat of a pattern this ledger has already recorded twice: item 87.3
       ended "whatever is done here must also be checked against the Samples
       twin", and the SMM queue gate was then missed on samples a second time
       anyway. `_sxrCommentRole()` returns 'client' on a share link and the
       comments button carries no client gate, so this surface loses a client's
       words in exactly the way the calendar did.

       Same shape deliberately -- one key per card holding a parentId -> text
       map, the same cap, the text never truncated -- so the two surfaces cannot
       drift into different behaviour. */
    const SXR_REPLY_DRAFTS_PREFIX = 'sv_sxrReplyDrafts_';
    function _sxrReplyDraftsLoad(pid) {
        if (!pid) return {};
        try {
            const raw = JSON.parse(sessionStorage.getItem(SXR_REPLY_DRAFTS_PREFIX + pid) || '{}');
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
            const out = Object.create(null);
            for (const k of Object.keys(raw)) if (typeof raw[k] === 'string' && raw[k]) out[k] = raw[k];
            return out;
        } catch (e) { return {}; }
    }
    function _sxrReplyDraftsPersist(pid) {
        if (!pid) return;
        try {
            const keys = Object.keys(_sxrReplyDrafts).filter(k => _sxrReplyDrafts[k]);
            const kept = keys.slice(-CAL_REPLY_DRAFT_MAX);
            if (!kept.length) { sessionStorage.removeItem(SXR_REPLY_DRAFTS_PREFIX + pid); return; }
            const map = {};
            for (const k of kept) map[k] = _sxrReplyDrafts[k];
            sessionStorage.setItem(SXR_REPLY_DRAFTS_PREFIX + pid, JSON.stringify(map));
        } catch (e) {}
    }
    let _sxrEditTarget = null;
    let _sxrEditDrafts = Object.create(null);
    let _sxrRootDraft = '';
    let _sxrComposeAudience = 'internal';
    let _sxrComposeIsTweak = false;
    let _sxrComposeComp = 'video';
    let _sxrShowResolved = false;
    function _sxrNotesMarkSeen(pid) { _notesMarkSeen(pid); /* opening/closing Notes = caught up → clears the unread dot (shared ledger) */ }

    function openSxrComments(pid) {
        const post = sxrState.posts.find(p => p.id === pid);
        if (!post) return;
        _sxrOpenCommentsPid = pid;
        _sxrReplyTarget = null;
        _sxrEditTarget = null;
        for (const k of Object.keys(_sxrReplyDrafts)) delete _sxrReplyDrafts[k];
        // Wiped first because the map is shared across cards, then refilled from
        // this card's own store -- the calendar ordering, for the same reason.
        Object.assign(_sxrReplyDrafts, _sxrReplyDraftsLoad(pid));
        for (const k of Object.keys(_sxrEditDrafts)) delete _sxrEditDrafts[k];
        _sxrRootDraft = '';
        try { _sxrRootDraft = sessionStorage.getItem('sv_sxrNoteDraft_' + pid) || ''; } catch (e) {}
        _sxrComposeAudience = 'internal';
        _sxrComposeIsTweak = false;
        _sxrComposeComp = 'video';
        _sxrShowResolved = false;
        _sxrNotesMarkSeen(pid);
        _prodProjectCanonicalCardComments('sxr', pid);
        const ovl = document.getElementById('sxrCommentsOverlay');
        if (!ovl) return;
        ovl.classList.add('open');
        document.body.classList.add('cal-modal-open');
        _sxrRenderCommentsModal();
        setTimeout(() => { const feed = document.getElementById('sxrCommentsFeed'); if (feed) feed.scrollTop = feed.scrollHeight; const ta = document.getElementById('sxrCommentComposer'); if (ta) ta.focus(); }, 30);
    }
    function closeSxrComments() {
        _sxrCaptureModalDrafts();
        const ovl = document.getElementById('sxrCommentsOverlay');
        if (ovl) ovl.classList.remove('open');
        document.body.classList.remove('cal-modal-open');
        const pid = _sxrOpenCommentsPid;
        _sxrOpenCommentsPid = null; _sxrReplyTarget = null; _sxrEditTarget = null;
        if (pid) { _sxrNotesMarkSeen(pid); _sxrRefreshCommentsBtn(pid); }
    }
    function _sxrCaptureModalDrafts() {
        const root = document.getElementById('sxrCommentsModal');
        if (!root) return;
        const composer = root.querySelector('#sxrCommentComposer');
        if (composer) {
            if (_sxrEditTarget) _sxrEditDrafts[_sxrEditTarget] = composer.value;
            else if (_sxrReplyTarget) { _sxrReplyDrafts[_sxrReplyTarget] = composer.value; _sxrReplyDraftsPersist(_sxrOpenCommentsPid); }
            else _sxrRootDraft = composer.value;
        }
    }
    function _sxrRenderCommentsModal() {
        const pid = _sxrOpenCommentsPid;
        const modal = document.getElementById('sxrCommentsModal');
        if (!modal || !pid) return;
        const post = sxrState.posts.find(p => p.id === pid);
        if (!post) { closeSxrComments(); return; }
        const videoComments = _sxrCommentsForAction(post, 'video');
        post.comments = videoComments;
        const compThreads = SXR_COMPONENTS.flatMap(c => {
            const list = _sxrCommentsForView(post, c);
            if (!Array.isArray(list) || !list.length) return [];
            return _sxrCommentRoots(list).map(r => ({ comp: c, list, root: r }));
        });
        compThreads.sort((a, b) => String(a.root.created_at || '').localeCompare(String(b.root.created_at || '')));
        const resolvedCount = compThreads.filter(e => e.root.done).length;
        const visibleThreads = _sxrShowResolved ? compThreads : compThreads.filter(e => !e.root.done);
        const postName = _sxrEsc(post.name || 'Untitled sample');
        const renderRow = (c, isReply, comp) => {
            const roleCls = c.role === 'client' ? 'is-client' : 'is-smm';
            const author = c.author || (c.role === 'client' ? 'Client' : 'SMM');
            const initial = _sxrAvatarInitial(author, c.role);
            const doneTag = (!isReply && c.done) ? `<span class="cal-cm-done-tag">Resolved</span>` : '';
            const compLabel = (!isReply && comp) ? `<span class="cal-cm-comp-label cal-cm-comp-${comp}">${_sxrEsc(COMP_LABELS[comp])}</span>` : '';
            const lock = (!isReply && !_isClientLink && _sxrMsgAudience(c) === 'internal') ? `<span class="cal-cm-lock" title="Internal — the client can't see this"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6.5" width="8" height="5" rx="1"/><path d="M4.75 6.5V5a2.25 2.25 0 0 1 4.5 0v1.5"/></svg></span>` : '';
            const typeTag = (!isReply && _sxrMsgIsTweak(c)) ? `<span class="cal-cm-type-tag is-tweak" title="Change request — moves the sample to Tweaks Needed">Tweak${c.round ? ' #' + c.round : ''}</span>` : '';
            const editedTag = c.edited ? '<span class="prod-comment-edited">(edited)</span>' : '';
            const attachments = Array.isArray(c.attachments) && c.attachments.length
                ? '<div class="prod-comment-attachments">' + c.attachments.map(item =>
                    '<a class="prod-comment-attachment" href="' + _sxrEscAttr(item.url) + '" target="_blank" rel="noopener noreferrer">' + _sxrEsc(item.name || 'Attachment') + '</a>'
                ).join('') + '</div>'
                : '';
            return `<div class="cal-cm-row${isReply ? ' is-reply' : ''}" data-cm-row="${c.id}"><div class="cal-cm-avatar ${roleCls}">${_sxrEsc(initial)}</div><div class="cal-cm-body-col"><div class="cal-cm-head-line"><span class="cal-cm-author">${_sxrEsc(author)}</span>${typeTag}${lock}<span class="cal-cm-time">${_sxrEsc(_sxrFmtCommentTime(c.created_at))}</span>${doneTag}${compLabel}</div><div class="cal-cm-row-body">${c.deleted ? 'Comment deleted.' : _sxrEsc(c.body || '')}${editedTag}${attachments}</div></div>${_sxrCommentActionsHtml(c, isReply)}</div>`;
        };
        const renderThread = (entry) => { const replies = _sxrCommentReplies(entry.list, entry.root.id); return `<div class="cal-cm-thread${entry.root.done ? ' is-done' : ''}" data-thread="${entry.root.id}">${renderRow(entry.root, false, entry.comp)}${replies.map(r => renderRow(r, true, entry.comp)).join('')}</div>`; };
        const emptyMsg = _sxrShowResolved
            ? `<div class="cal-comments-empty"><div class="cal-comments-empty-title">Nothing here</div>No resolved items.</div>`
            : (resolvedCount ? `<div class="cal-comments-empty"><div class="cal-comments-empty-title">All clear</div>No open notes — resolved items are in history (top right).</div>` : `<div class="cal-comments-empty"><div class="cal-comments-empty-title">No notes yet</div>Start the conversation — type below.</div>`);
        const feedHtml = visibleThreads.length ? visibleThreads.map(renderThread).join('') : emptyMsg;
        const histBtn = resolvedCount ? `<button class="cal-comments-hist${_sxrShowResolved ? ' is-active' : ''}" type="button" onclick="_sxrToggleShowResolved()" title="${_sxrShowResolved ? 'Hide resolved' : 'Show resolved (' + resolvedCount + ')'}" aria-label="Toggle resolved history"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4.5V8l2.5 1.5"/><path d="M2.6 8a5.4 5.4 0 1 0 1.5-3.7M2.5 3v2.2h2.2"/></svg>${_sxrShowResolved ? '' : `<span class="cal-comments-hist-count">${resolvedCount}</span>`}</button>` : '';
        const actionFailure = post._canonicalCommentActionError
            ? _writeUiCommentActionFailureHtml(
                post._canonicalCommentActionError,
                '_writeUiRetryCardCommentAction(\'sxr\',' + _sxrJsArg(pid) + ')'
            )
            : '';
        modal.innerHTML = `
            <div class="cal-comments-head">
                <div class="cal-comments-head-text"><h3 id="sxrCommentsTitle">${_sxrShowResolved ? 'Resolved' : 'Notes'}</h3><p>${postName}</p></div>
                ${histBtn}
                <button class="cal-comments-close" type="button" onclick="closeSxrComments()" aria-label="Close"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7"/></svg></button>
            </div>
            ${actionFailure}
            <div class="cal-comments-feed" id="sxrCommentsFeed"><div class="cal-comments-feed-inner">${feedHtml}</div></div>
            ${_sxrComposerHtml(post, videoComments)}`;
        const ta = document.getElementById('sxrCommentComposer');
        if (ta) { _sxrAutosizeComposer(ta); ta.focus(); const v = ta.value; ta.value = ''; ta.value = v; }
    }
    function _sxrCanDeleteComment(c) { return _sxrCommentRole() === 'smm' || c.role === 'client'; }
    function _sxrCanResolveComment() { return _sxrCommentRole() === 'smm'; }
    function _sxrCommentActionsHtml(c, isReply) {
        if (c.deleted) return '';
        const replyIco = `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4.5L1.5 8L5 11.5M1.5 8h7a4 4 0 0 1 4 4"/></svg>`;
        const checkIco = `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 7.5L6 11l5.5-7"/></svg>`;
        const undoIco = `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 3.5L2 7l3.5 3.5M2 7h7a3.5 3.5 0 0 1 0 7"/></svg>`;
        const trashIco = `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4h9M5.5 4V2.5h3V4M3.5 4l.5 8.5h6L10.5 4M6 6.5v4M8 6.5v4"/></svg>`;
        const rootId = isReply ? c.parent_id : c.id;
        const replyBtn = c.done ? '' : `<button class="cal-cm-action" type="button" onclick="_sxrBeginReply(${_sxrJsArg(rootId)})" title="Reply">${replyIco}<span>Reply</span></button>`;
        const editBtn = c.canonical && c.can_edit ? `<button class="cal-cm-action" type="button" onclick="_sxrBeginCommentEdit(${_sxrJsArg(c.id)})" title="Edit"><span>Edit</span></button>` : '';
        const canResolve = c.canonical ? c.can_resolve : (_sxrCanResolveComment() && _sxrMsgIsTweak(c));
        const doneBtn = (!isReply && canResolve) ? (c.done ? `<button class="cal-cm-action is-done-on" type="button" onclick="_sxrToggleCommentDone(${_sxrJsArg(c.id)})" title="Reopen">${undoIco}<span>Reopen</span></button>` : `<button class="cal-cm-action" type="button" onclick="_sxrToggleCommentDone(${_sxrJsArg(c.id)})" title="Mark thread done">${checkIco}<span>Mark done</span></button>`) : '';
        const canDelete = c.canonical ? c.can_delete : _sxrCanDeleteComment(c);
        const delBtn = canDelete ? `<button class="cal-cm-action is-danger" type="button" onclick="_sxrDeleteComment(${_sxrJsArg(c.id)})" title="Delete">${trashIco}<span>Delete</span></button>` : '';
        if (!replyBtn && !editBtn && !doneBtn && !delBtn) return '';
        return `<div class="cal-cm-actions">${replyBtn}${editBtn}${doneBtn}${delBtn}</div>`;
    }
    function _sxrComposePlaceholder(role) {
        if (role === 'client') return 'Message your Synchro Social team…';
        return _sxrComposeAudience === 'client' ? 'Write a note the client will see…' : 'Team-only note (you + Kasper)…';
    }
    function _sxrComposerHtml(post, comments) {
        const role = _sxrCommentRole();
        const author = _sxrCurrentAuthor();
        const initial = _sxrAvatarInitial(author, role);
        const roleCls = role === 'client' ? 'is-client' : 'is-smm';
        const isReply = !!_sxrReplyTarget;
        const isEdit = !!_sxrEditTarget;
        const allLists = SXR_COMPONENTS.map(c => _sxrCommentsForAction(post, c));
        const targetId = isEdit ? _sxrEditTarget : _sxrReplyTarget;
        const target = targetId ? allLists.flatMap(l => l).find(c => c && c.id === targetId) : null;
        const draft = isEdit ? (_sxrEditDrafts[_sxrEditTarget] || '') : isReply ? (_sxrReplyDrafts[_sxrReplyTarget] || '') : (_sxrRootDraft || '');
        const placeholder = isEdit ? 'Edit this note...' : isReply ? `Reply to ${target ? (target.author || 'thread') : 'thread'}…` : _sxrComposePlaceholder(role);
        const replyingTo = target ? `<div class="cal-cm-replying-to">${isEdit ? 'Editing' : 'Replying to'} <strong>${_sxrEsc(target.author || 'thread')}</strong> <button class="cal-cm-cancel-reply" type="button" onclick="${isEdit ? '_sxrBeginCommentEdit(null)' : '_sxrBeginReply(null)'}" title="Cancel"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/></svg></button></div>` : '';
        const lockIco = `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6.5" width="8" height="5" rx="1"/><path d="M4.75 6.5V5a2.25 2.25 0 0 1 4.5 0v1.5"/></svg>`;
        const canonicalGate = _prodCanonicalCommentGate(post, (isReply || isEdit) && target ? _sxrFindCompForCommentId(post, target.id) : _sxrComposeComp);
        if (role === 'client' && !canonicalGate.linked) {
            return '<div class="cal-comments-empty"><div class="cal-comments-empty-title">Notes are not available</div>This sample component is not linked to an exact Production deliverable.</div>';
        }
        if (canonicalGate.linked && (!canonicalGate.ready || (role === 'client' && !canonicalGate.client))) {
            return '<div class="cal-comments-empty"><div class="cal-comments-empty-title">'
                + (canonicalGate.status === 'error' ? 'Notes could not load' : 'Loading canonical notes')
                + '</div>' + (canonicalGate.status === 'error'
                    ? '<button type="button" class="prod-comment-state-action" onclick="_prodProjectCanonicalCardComments(\'sxr\',' + _sxrJsArg(post.id) + ')">Retry</button>'
                    : 'The composer unlocks after this exact deliverable is authorized.')
                + '</div>';
        }
        const audienceToggle = (!isReply && !isEdit && role !== 'client' && canonicalGate.client) ? `<div class="cal-cm-audience" data-cm-toggle="audience" role="group" aria-label="Who can see this note"><span class="cal-cm-audience-cap">Who sees this?</span><div class="cal-cm-aud-seg"><button type="button" class="cal-cm-aud-btn${_sxrComposeAudience === 'internal' ? ' is-active' : ''}" data-aud="internal" onclick="_sxrSetComposeAudience('internal')" title="Team only — you and Kasper.">${lockIco}Kasper / team</button><button type="button" class="cal-cm-aud-btn${_sxrComposeAudience === 'client' ? ' is-active' : ''}" data-aud="client" onclick="_sxrSetComposeAudience('client')" title="Shared — the client can see this too.">Client</button></div></div>` : '';
        const changeToggle = (!isReply && !isEdit && role === 'client') ? `<div class="cal-cm-audience" data-cm-toggle="tweak" role="group" aria-label="Comment or change request"><span class="cal-cm-audience-cap">This is a…</span><div class="cal-cm-aud-seg"><button type="button" class="cal-cm-aud-btn${!_sxrComposeIsTweak ? ' is-active' : ''}" data-tweak="0" onclick="_sxrSetComposeIsTweak(false)">Comment</button><button type="button" class="cal-cm-aud-btn${_sxrComposeIsTweak ? ' is-active' : ''}" data-tweak="1" onclick="_sxrSetComposeIsTweak(true)" title="Request a change — moves the sample to Tweaks Needed">Request a change</button></div></div>` : '';
        const compPicker = !isReply && !isEdit ? `<div class="cal-cm-audience" data-cm-toggle="comp" role="group" aria-label="Which deliverable is this note about"><span class="cal-cm-audience-cap">About the…</span><div class="cal-cm-aud-seg">${SXR_COMPONENTS.map(c => `<button type="button" class="cal-cm-aud-btn${_sxrComposeComp === c ? ' is-active' : ''}" data-comp="${c}" onclick="_sxrSetComposeComp('${c}')" title="This note is about the ${_sxrEscAttr(String(COMP_LABELS[c] || c).toLowerCase())}">${_sxrEsc(COMP_LABELS[c] || c)}</button>`).join('')}</div></div>` : '';
        const sendIco = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8h11M9 3.5L13.5 8L9 12.5"/></svg>`;
        return `<div class="cal-cm-composer-wrap">${replyingTo}${compPicker}${audienceToggle}${changeToggle}<div class="cal-cm-composer"><div class="cal-cm-avatar ${roleCls}" style="width:28px;height:28px;border-radius:8px;font-size:0.72rem;">${_sxrEsc(initial)}</div><textarea id="sxrCommentComposer" rows="1" placeholder="${_sxrEscAttr(placeholder)}" oninput="_sxrOnComposerInput(this)" onkeydown="_sxrOnComposerKey(event)">${_sxrEsc(draft)}</textarea><div class="cal-cm-composer-actions"><button class="cal-cm-send" type="button" onclick="_sxrSubmitComposer()" title="${isEdit ? 'Save edit' : 'Send'} (Enter)" ${draft.trim() ? '' : 'disabled'}>${sendIco}</button></div></div></div>`;
    }
    function _sxrAutosizeComposer(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; }
    function _sxrOnComposerInput(ta) {
        _sxrAutosizeComposer(ta);
        if (_sxrEditTarget) _sxrEditDrafts[_sxrEditTarget] = ta.value;
        else if (_sxrReplyTarget) { _sxrReplyDrafts[_sxrReplyTarget] = ta.value; _sxrReplyDraftsPersist(_sxrOpenCommentsPid); }
        else { _sxrRootDraft = ta.value; try { if (ta.value) sessionStorage.setItem('sv_sxrNoteDraft_' + _sxrOpenCommentsPid, ta.value); else sessionStorage.removeItem('sv_sxrNoteDraft_' + _sxrOpenCommentsPid); } catch (e) {} }
        const wrap = ta.closest('.cal-cm-composer'); if (!wrap) return;
        const sendBtn = wrap.querySelector('.cal-cm-send'); if (sendBtn) sendBtn.disabled = !ta.value.trim();
    }
    function _sxrOnComposerKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _sxrSubmitComposer(); } else if (e.key === 'Escape' && (_sxrReplyTarget || _sxrEditTarget)) { e.preventDefault(); if (_sxrEditTarget) _sxrBeginCommentEdit(null); else _sxrBeginReply(null); } }
    function _sxrBeginReply(rootId) {
        _sxrCaptureModalDrafts();
        _sxrEditTarget = null;
        _sxrReplyTarget = rootId || null;
        const feed = document.getElementById('sxrCommentsFeed');
        const prevScroll = feed ? feed.scrollTop : null;
        _sxrRenderCommentsModal();
        const feed2 = document.getElementById('sxrCommentsFeed');
        if (feed2 && prevScroll != null) feed2.scrollTop = prevScroll;
    }
    function _sxrBeginCommentEdit(commentId) {
        _sxrCaptureModalDrafts();
        const post = sxrState.posts.find(p => p.id === _sxrOpenCommentsPid);
        const comp = post && commentId ? _sxrFindCompForCommentId(post, commentId) : '';
        const list = post && comp ? _sxrCommentsForAction(post, comp) : [];
        const target = Array.isArray(list) ? list.find(c => c && c.id === commentId) : null;
        _sxrReplyTarget = null;
        _sxrEditTarget = target && target.canonical && target.can_edit ? commentId : null;
        if (_sxrEditTarget && _sxrEditDrafts[_sxrEditTarget] == null) {
            _sxrEditDrafts[_sxrEditTarget] = String(target.body || '');
        }
        _sxrRenderCommentsModal();
        return false;
    }
    async function _sxrSubmitComposer() {
        const pid = _sxrOpenCommentsPid; if (!pid) return;
        _sxrCaptureModalDrafts();
        const body = (_sxrEditTarget
            ? (_sxrEditDrafts[_sxrEditTarget] || '')
            : _sxrReplyTarget ? (_sxrReplyDrafts[_sxrReplyTarget] || '') : (_sxrRootDraft || '')).trim();
        if (!body) return;
        if (_sxrEditTarget) {
            const editId = _sxrEditTarget;
            if (!await _sxrSaveCommentEdit(pid, editId, body)) return;
            delete _sxrEditDrafts[editId];
            _sxrEditTarget = null;
            _sxrRenderCommentsModal();
            return;
        }
        const parentId = _sxrReplyTarget;
        const saved = await _sxrAppendComment(pid, parentId, body);
        if (!saved) return;
        if (parentId) { delete _sxrReplyDrafts[parentId]; _sxrReplyDraftsPersist(pid); }
        else { _sxrRootDraft = ''; try { sessionStorage.removeItem('sv_sxrNoteDraft_' + pid); } catch (e) {} }
        _sxrReplyTarget = null;
        _sxrRenderCommentsModal();
        setTimeout(() => { const feed = document.getElementById('sxrCommentsFeed'); if (feed) feed.scrollTop = feed.scrollHeight; }, 0);
    }
    function _sxrWatchNoteSave(pid) {
        return Promise.resolve(_sxrFlushCardSave(pid)).then(() => {
            const p = sxrState.posts.find(x => x.id === pid);
            if (p && p._saveError && _sxrOpenCommentsPid === pid && typeof showNotify === 'function') showNotify('Note source sync pending', 'The native note is safe. Samples sync will retry automatically (' + p._saveError + ').');
        });
    }
    function _sxrFindCompForCommentId(post, commentId) {
        for (const c of SXR_COMPONENTS) {
            const list = _sxrCommentsForAction(post, c);
            if (Array.isArray(list) && list.some(x => x.id === commentId)) return c;
        }
        return 'video';
    }
    async function _sxrSaveCommentEdit(pid, commentId, body, retryCursor) {
        const post = sxrState.posts.find(p => p.id === pid);
        if (!post) return false;
        const comp = _sxrFindCompForCommentId(post, commentId);
        const target = _sxrCommentsForAction(post, comp).find(c => c && c.id === commentId);
        const gate = _prodCanonicalCommentGate(post, comp);
        if (!target || !target.canonical || !target.can_edit || !gate.linked || !gate.ready) return false;
        const receipt = await _writeUiCommitCardCommentLifecycle(
            'sxr', post, comp, target, 'edit', body, retryCursor
        );
        if (!receipt) return false;
        await _writeUiPersistCanonicalCommentProjection('sxr', post, comp);
        return true;
    }
    function _sxrRetryCommentEdit(commentId, body, retryCursor) {
        const pid = _sxrOpenCommentsPid;
        if (!pid) return false;
        _sxrEditTarget = commentId;
        _sxrReplyTarget = null;
        _sxrEditDrafts[commentId] = String(body || '');
        _sxrSaveCommentEdit(pid, commentId, _sxrEditDrafts[commentId], retryCursor).then(saved => {
            if (!saved) {
                _sxrRenderCommentsModal();
                return;
            }
            delete _sxrEditDrafts[commentId];
            _sxrEditTarget = null;
            _sxrRenderCommentsModal();
        });
        return false;
    }
    async function _sxrAppendComment(pid, parentId, body) {
        const post = sxrState.posts.find(p => p.id === pid);
        if (!post) return;
        const comp = parentId ? _sxrFindCompForCommentId(post, parentId) : (SXR_COMPONENTS.indexOf(_sxrComposeComp) >= 0 ? _sxrComposeComp : 'video');
        const canonicalGate = _prodCanonicalCommentGate(post, comp);
        // A LINKED card keeps the fail-closed canonical contract: an unready or
        // unauthorized exact client thread never falls back. An UNLINKED card
        // has no canonical thread to authorize against at all, so the client
        // posts through the same legacy path staff uses there.
        if (_isClientLink && canonicalGate.linked && (!canonicalGate.ready || !canonicalGate.client)) {
            if (typeof showNotify === 'function') showNotify('Notes are not available', 'This exact client thread is not authorized.');
            return false;
        }
        if (canonicalGate.linked && !canonicalGate.ready) {
            if (typeof showNotify === 'function') showNotify('Notes are still loading', 'Retry the canonical thread before sending.');
            return false;
        }
        const arr = _sxrCommentsForAction(post, comp).slice();
        const role = _sxrCommentRole();
        const _now = new Date().toISOString();
        const isRoot = !parentId;
        let nativeCommentCommitted = false;
        let committedBatch = null;
        const msg = { id: _sxrMintCommentId(), parent_id: parentId || null, author: _sxrCurrentAuthor(), role, body, created_at: _now, updated_at: _now, done: false, done_at: '', done_by: '' };
        if (isRoot) { msg.audience = (role === 'client') ? 'client' : _sxrComposeAudience; msg.is_tweak = (role === 'client') ? _sxrComposeIsTweak : false; if (msg.is_tweak) msg.round = _sxrNextTweakRound(post, comp); }
        if (comp === 'video' || comp === 'graphic') {
            const rootMsg = isRoot ? msg : arr.find(c => c && c.id === parentId);
            try {
                /* Canonical-where-linked, legacy-where-not, for ADD too. The
                   full account is on the calendar twin in _calAppendComment and
                   on `_prodCommentAddRoutesLegacy`, which is what decides this
                   — the CROSSWALK, not the gate, so a slot with no deliverable
                   id and a valid link held by the coverage invariant both keep
                   the transport they have today. The Samples-specific half is
                   that `_sxrPostLinearComment` already consults the gate for a
                   CLIENT link and routes a STAFF add on
                   `_writeUiUseGatewayWhenReady` — the reroute allowlist —
                   alone. So a staff reply to a root that fell back to the
                   legacy card store went to the gateway, which has no parent to
                   answer to, and the typed text died in the catch below.
                   `canonicalUnlinked` closes exactly that half: the linked
                   client contract above and the front door inside the transport
                   both keep their current decisions. */
                const canonicalUnlinked = await _prodCommentAddRoutesLegacy('sxr', post, comp);
                const acknowledgement = await _sxrPostLinearComment(_sxrLinearUrlFor(post, comp), body, msg.author, { post, component: comp, comment: msg, parentId: msg.parent_id, audience: _sxrMsgAudience(rootMsg), isTweak: isRoot && _sxrMsgIsTweak(msg), round: rootMsg && Number.isInteger(rootMsg.round) ? rootMsg.round : null, canonicalUnlinked });
                committedBatch = {};
                _writeUiBindRepairAck(post, committedBatch, acknowledgement);
                nativeCommentCommitted = !!(acknowledgement && acknowledgement.native_committed);
                // Canonical adoption/projection only exists for a LINKED card.
                // On an unlinked card the write took the legacy transport, so
                // fall through to the legacy card-array append below.
                if (_isClientLink && canonicalGate.linked && nativeCommentCommitted) {
                    if (acknowledgement.comment) {
                        _prodComments.adopt(_writeUiNativeId(post, comp), acknowledgement.comment);
                    }
                    await _prodProjectCanonicalCardComments('sxr', pid);
                    // A client change request still advances the Samples status,
                    // but its canonical comment is never copied into the legacy
                    // card comment arrays or source-save payload.
                    if (isRoot && msg.is_tweak && _sxrApplyAutoStatus(pid, 'client_added', comp)) {
                        await _sxrWatchNoteSave(pid);
                    }
                    _sxrRefreshCommentsBtn(pid);
                    _sxrUpdateCardStatusDisplay(pid);
                    return true;
                }
            } catch (e) {
                _writeUiReportFailure('sxr', 'comment', e);
                return false;
            }
        }
        arr.push(msg);
        _sxrSetCommentsFor(post, comp, arr);
        if (comp === 'video') post.comments = arr;
        _sxrPendingEdits[pid] = Object.assign(_sxrPendingEdits[pid] || {}, { [comp + '_tweaks']: _sxrStringifyComments(arr) });
        if (isRoot && role === 'client' && msg.is_tweak) _sxrApplyAutoStatus(pid, 'client_added', comp);
        if (committedBatch) _writeUiMergeCommittedBatch(_sxrPendingEdits[pid], committedBatch);
        await _sxrWatchNoteSave(pid);
        _sxrRefreshCommentsBtn(pid);
        _sxrUpdateCardStatusDisplay(pid);
        return true;
    }
    function _sxrToggleCommentDone(rootId) {
        const pid = _sxrOpenCommentsPid; if (!pid) return;
        const post = sxrState.posts.find(p => p.id === pid); if (!post) return;
        const comp = _sxrFindCompForCommentId(post, rootId);
        const list = _sxrCommentsForAction(post, comp).slice();
        const root = list.find(c => c.id === rootId && !c.parent_id); if (!root) return;
        const wasDone = !!root.done;
        // Resolving the LAST open SMM change-request routes the component onward
        // (Kasper / client / approved) — the SMM picks first via the chooser. Defer
        // the whole resolution (mark-done + status flip) until they confirm, so the
        // comment doesn't vanish before the choice and a cancel applies nothing.
        // Count the OTHER still-open change-requests, this root excluded.
        const otherOpen = list.filter(c => !c.parent_id && !c.done && !c.deleted && _sxrMsgIsTweak(c) && c.id !== rootId).length;
        const deferToChooser = !wasDone && _sxrCommentRole() === 'smm' && otherOpen === 0;
        if (deferToChooser) { _sxrResolveLastTweak(pid, comp, rootId); return; }
        const canonicalGate = _prodCanonicalCommentGate(post, comp);
        if (canonicalGate.linked) {
            _writeUiCommitCardCommentLifecycle('sxr', post, comp, root, wasDone ? 'unresolve' : 'resolve')
                .then(receipt => receipt && _writeUiPersistCanonicalCommentProjection('sxr', post, comp));
            return;
        }
        if (wasDone) { root.done = false; root.done_at = ''; root.done_by = ''; }
        else { root.done = true; root.done_at = new Date().toISOString(); root.done_by = _sxrCurrentAuthor(); }
        root.updated_at = new Date().toISOString();
        _sxrSetCommentsFor(post, comp, list);
        if (comp === 'video') post.comments = list;
        _sxrPendingEdits[pid] = Object.assign(_sxrPendingEdits[pid] || {}, { [comp + '_tweaks']: _sxrStringifyComments(list) });
        _sxrWatchNoteSave(pid);
        _sxrRefreshCommentsBtn(pid);
        _sxrUpdateCardStatusDisplay(pid);
        _sxrCaptureModalDrafts();
        _sxrRenderCommentsModal();
        setTimeout(() => { const feed = document.getElementById('sxrCommentsFeed'); if (feed) feed.scrollTop = feed.scrollHeight; }, 0);
    }
    function _sxrDeleteComment(commentId) {
        const pid = _sxrOpenCommentsPid; if (!pid) return;
        const post = sxrState.posts.find(p => p.id === pid); if (!post) return;
        const comp = _sxrFindCompForCommentId(post, commentId);
        const arr = _sxrCommentsForAction(post, comp).slice();
        const target = arr.find(c => c.id === commentId);
        if (!target || (target.canonical ? !target.can_delete : !_sxrCanDeleteComment(target))) return;
        const isRoot = !target.parent_id;
        const msg = target.canonical
            ? (isRoot
                ? "Delete this note? Replies remain in the thread under a deleted-note marker. This can't be undone."
                : "Delete this reply? A deleted-note marker remains. This can't be undone.")
            : isRoot
                ? "This deletes the message and every reply in this thread. This can't be undone."
                : "Delete this reply? This can't be undone.";
        showConfirm('Delete note?', msg, async () => {
            const canonicalGate = _prodCanonicalCommentGate(post, comp);
            if (canonicalGate.linked) {
                const receipt = await _writeUiCommitCardCommentLifecycle('sxr', post, comp, target, 'delete');
                if (receipt) await _writeUiPersistCanonicalCommentProjection('sxr', post, comp);
                return;
            }
            const _delAt = new Date().toISOString();
            const next = arr.map(c => (c.id === commentId || c.parent_id === commentId) ? Object.assign({}, c, { deleted: true, updated_at: _delAt }) : c);
            _sxrSetCommentsFor(post, comp, next);
            if (comp === 'video') post.comments = next;
            _sxrPendingEdits[pid] = Object.assign(_sxrPendingEdits[pid] || {}, { [comp + '_tweaks']: _sxrStringifyComments(next) });
            _sxrWatchNoteSave(pid);
            _sxrRefreshCommentsBtn(pid);
            _sxrUpdateCardStatusDisplay(pid);
            _sxrCaptureModalDrafts();
            _sxrRenderCommentsModal();
        }, 'Delete');
    }
    function _sxrApplyAutoStatus(pid, trigger, comp, dest) {
        const post = sxrState.posts.find(p => p.id === pid);
        if (!post) return false;
        const which = comp || 'video';
        const subKey = which + '_status';
        let next = null;
        if (trigger === 'client_added' && post[subKey] !== 'Tweaks Needed') next = 'Tweaks Needed';
        else if (trigger === 'smm_resolved_last') next = _sxrAutoResolveDestStatus(dest);
        if (!next || post[subKey] === next) return false;
        /* Resolving the last change-request auto-routes the component onward.
           That is still sending it for review, so it obeys the same rule --
           and returning false here is what the calendar twin does, so the
           caller repaints instead of pretending the move happened. */
        if (_sxrReviewBlockReason(post, which, next)) return false;
        post[subKey] = next;
        post.status = computeSampleOverallStatus(post);
        post.updated_at = new Date().toISOString();
        _sxrPendingEdits[pid] = Object.assign(_sxrPendingEdits[pid] || {}, { [subKey]: next, status: post.status });
        if (next === 'Kasper Approval') { const csv = _sxrRecordKasperSeenOnPost(post, which); if (csv != null) _sxrPendingEdits[pid].kasper_seen = csv; }
        _sxrClearStaleApprovals(post, _sxrPendingEdits[pid]);
        _sxrMarkLocalStatus(pid, which);
        return true;
    }
    function _sxrSetComposeAudience(val) {
        _sxrComposeAudience = (val === 'client') ? 'client' : 'internal';
        const seg = document.querySelector('[data-cm-toggle="audience"]');
        if (seg) seg.querySelectorAll('.cal-cm-aud-btn').forEach(b => b.classList.toggle('is-active', b.dataset.aud === _sxrComposeAudience));
        const ta = document.getElementById('sxrCommentComposer');
        if (ta && !_sxrReplyTarget) ta.placeholder = _sxrComposePlaceholder('smm');
    }
    function _sxrSetComposeIsTweak(val) {
        _sxrComposeIsTweak = !!val;
        const seg = document.querySelector('[data-cm-toggle="tweak"]');
        if (seg) seg.querySelectorAll('.cal-cm-aud-btn').forEach(b => b.classList.toggle('is-active', (b.dataset.tweak === '1') === _sxrComposeIsTweak));
        const ta = document.getElementById('sxrCommentComposer');
        if (ta && !_sxrReplyTarget) ta.placeholder = _sxrComposeIsTweak ? 'Describe the change you need…' : _sxrComposePlaceholder('client');
    }
    function _sxrSetComposeComp(val) {
        _sxrComposeComp = (SXR_COMPONENTS.indexOf(val) >= 0) ? val : 'video';
        const seg = document.querySelector('[data-cm-toggle="comp"]');
        if (seg) seg.querySelectorAll('.cal-cm-aud-btn').forEach(b => b.classList.toggle('is-active', b.dataset.comp === _sxrComposeComp));
    }
    function _sxrToggleShowResolved() { _sxrShowResolved = !_sxrShowResolved; _sxrCaptureModalDrafts(); _sxrRenderCommentsModal(); }

    /* ============================================================
       --- SURFACE 6: the client portal (read-only multi-tab) ---
       The biggest gap from attempt #1. The client surface reuses the SAME machinery
       as the SMM, gated by the shared `_isClientLink` flag:
         · Review tab  — _sxrReviewMode()==='client' → _SXR_REVIEW_CFG.client
                          (Client Approval → Approved); client approve/request-change.
         · Sheet tab   — _sxrRenderInlineCard ro=true branch: read-only pills, link
                          pills open-only, NO add/edit/status/archive/drag/select.
         · Notes       — client role; _sxrCommentsForView hides internal/Kasper.
       NEW here: the client-link mount (embed shell: title "Sample reviews", tabs
       Review + Sheet) + client-visibility gating. Client is always read/review-only
       (no collab). The share link carries ?sxr=1 (samples is default-OFF).
       ============================================================ */
    function _sxrIsClientReady(p) {
        // A sample is visible to the client once any component has left "In Progress"
        // (been sent for review). Archived samples are never shown. No collab.
        if (!p || String(p.status || '').toLowerCase() === 'archived') return false;
        return SXR_COMPONENTS.some(c => _sxrNormStatus(p[c + '_status'] || 'In Progress') !== 'In Progress');
    }
    function mountSxrClientView(clientName) {
        if (_isClientLink) {
            const cap = _syncviewClientEntryCapability;
            if (!cap || !cap.verified || cap.view !== 'sample-reviews' || _syncviewClientEntrySlug(clientName) !== cap.slug) {
                _syncviewInvalidClientLinkScreen();
                return;
            }
            clientName = cap.client;
        }
        if (typeof _calV2Teardown === 'function') _calV2Teardown();
        if (!_sxrEnabled()) return;
        _sxrEnsureFreshnessWiring();
        // The exact verified Review route now owns the document. Lift the
        // pre-paint selector only after the capability/client match so no
        // generic or wrong-client SXR surface can appear between states.
        document.documentElement.removeAttribute('data-boot-nav');
        document.documentElement.removeAttribute('data-boot-subtab');
        if (typeof _sxrV2Teardown === 'function') _sxrV2Teardown();
        document.body.classList.add('cal-page');
        const content = document.getElementById('content');
        if (content) content.innerHTML = renderSxrView();
        sxrState.client = clientName;
        sxrState.embedded = true;        // client shell: embed title + Review/Sheet tabs, no per-client tabs
        sxrState.view = 'review';        // the client lands on their approval queue
        sxrState.zoom = _sxrNormZoom((_sxrLoadPrefs() || {}).zoom);
        sxrState.posts = [];
        sxrState.error = null;
        sxrState.previewId = null;
        sxrState.selectMode = false;
        _sxrRenderShell();
        loadSxrCards();
    }

    /* ============================================================
       --- SURFACE 7: realtime + freshness + the Linear push layer ---
       Clone of _calV2EnsureSubscribed (channel sxr-<slug> on sample_reviews) +
       _calRefreshOnReturn (tab-return refetch — the piece attempt #1 missed) + the
       deferred-render guard + the legacy Linear FE layer (drain-only debt on
       syncview_sxr_linear_outbox_v1, plus native per-target serialization,
       suppression, point-adoption, stale-regress). REUSES the shared, poison-
       hardened Linear webhooks + status mapper. Inbound Linear rides realtime
       (the embedded n8n branch) — the FE only pushes outbound. These defs make the
       Surface 2/3/4 Linear/realtime stubs real (hoisted).
       ============================================================ */

    /* Background-reload MERGE — a realtime / tab-return reload must not clobber an
       in-flight edit, a just-typed comment, or a freshly-set status mid-round-trip. */
    // Mirror of _calPostsEqualForRender for the SAMPLES schema: if none of the
    // fields the SMM-sheet / review renderer actually paints changed, the rebuilt
    // DOM would be identical, so a BACKGROUND reload can SKIP the full _sxrRenderBody
    // repaint that otherwise FLASHES the queue ~4s later when our own write's
    // realtime echo lands (the "mark done / send to client felt laggy" symptom).
    // Keys derived from renderSxrReview / renderSxrOrganizer + _sxrMigrateShape's
    // default-fill list — NOT cloned from the calendar (samples has no caption /
    // title / CTA / scheduled-date; it adds creative_direction + its eye toggle).
    function _sxrPostsEqualForRender(a, b) {
        if (a === b) return true;
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        const keys = ['id','order_index','status','name',
                      'asset_url','thumbnail_url','thumb_rev','creative_direction','hide_creative_direction',
                      'thumbnail_folder_url','thumbnail_folder_id','thumbnail_file_id','thumbnail_folder_resolved_at',
                      'linear_issue_id','video_deliverable_id','graphic_linear_issue_id','graphic_deliverable_id',
                      'video_status','graphic_status',
                      'updated_at'];
        for (let i = 0; i < a.length; i++) {
            for (const k of keys) {
                if (String(a[i][k] == null ? '' : a[i][k]) !== String(b[i][k] == null ? '' : b[i][k])) return false;
            }
            // Comment arrays via the accessor so the comments/video_comments duality
            // (and the graphic list) is compared exactly as the renderer reads it.
            for (const comp of SXR_COMPONENTS) {
                if (JSON.stringify(_sxrCommentsFor(a[i], comp) || []) !== JSON.stringify(_sxrCommentsFor(b[i], comp) || [])) return false;
            }
        }
        return true;
    }
    /* ── Recent-save reconcile (port of the calendar's _calRecentSaveReconcile
       over the samples schema: video + graphic sub-statuses, no caption/title) ──
       Within the local-status-fresh window a background realtime reload normally
       KEEPS our just-set status so a stale reconciler / self echo can't revert it.
       But a GENUINE newer change from ANOTHER role — Kasper requesting a change
       (→ Tweaks Needed), a client/SMM approval — must still win, or the note dot
       updates live while the status pill stays stuck at our value until a manual
       refresh (the P1 realtime-status bug). Adopt only the sub-statuses the server
       moved to a NEW value (differs from BOTH what we wrote and its pre-save
       base); a bare stale Linear round-trip (a status-only regression with no new
       change-request comment) is refused and kept local. Returns a merged clone,
       or null to keep local. Pure besides the status normaliser + overall recompute. */
    function _sxrRecentSaveReconcile(lp, fp, rsf) {
        if (!lp || !fp || !rsf) return null;
        const lT = Date.parse(lp.updated_at || '');
        const fT = Date.parse(fp.updated_at || '');
        if (!(isFinite(lT) && isFinite(fT) && fT > lT)) return null;
        let merged = null;
        for (const comp of SXR_COMPONENTS) {
            const f = comp + '_status';
            const sv = fp[f];
            if (sv == null) continue;
            const wrote = rsf.wrote ? rsf.wrote[f] : undefined;
            const base = rsf.base ? rsf.base[f] : undefined;
            if (sv !== wrote && sv !== base) {
                if (_sxrIsStaleLinearRegress(lp, fp, comp, rsf)) continue;
                if (!merged) merged = Object.assign({}, lp);
                merged[f] = sv;
            }
        }
        if (merged) merged.status = computeSampleOverallStatus(merged);
        return merged;
    }
    /* Is the server's value for `comp` a stale Linear status-sync round-trip of a
       DRIFTED issue that would clobber a fresh local approval — as opposed to a
       genuine new action? True only when we wrote an at-or-above-Client-Approval
       status and the server REGRESSES it below with NO new open change-request
       comment to justify it (a real Tweaks-Needed always lands a comment; a bare
       Linear round-trip does not). Port of _calIsStaleLinearRegress; samples has
       no Scheduled/Posted so the "above" set is just Client Approval / Approved. */
    function _sxrIsStaleLinearRegress(lp, fp, comp, rsf) {
        if (!lp || !fp || !rsf) return false;
        if (comp !== 'video' && comp !== 'graphic') return false;
        const f = comp + '_status';
        const sv = fp[f];
        if (sv == null) return false;
        const wrote = rsf.wrote ? rsf.wrote[f] : undefined;
        const base = rsf.base ? rsf.base[f] : undefined;
        if (sv === wrote || sv === base) return false;
        const ABOVE = { 'Client Approval': 1, 'Approved': 1 };
        if (!(ABOVE[_sxrNormStatus(wrote)] && !ABOVE[_sxrNormStatus(sv)])) return false;
        return !_sxrReconcileHasGenuineTweak(fp, lp, comp);
    }
    /* Does the server row carry a NEW (not in our local copy) open change-request
       on this component — the fingerprint of a genuine Tweaks-Needed (which always
       writes a comment alongside the status) vs a bare Linear round-trip? Port of
       _calReconcileHasGenuineTweak. */
    function _sxrReconcileHasGenuineTweak(fp, lp, comp) {
        const fc = _sxrCommentsFor(fp, comp);
        if (!Array.isArray(fc) || !fc.length) return false;
        const lById = new Map();
        const lc = _sxrCommentsFor(lp, comp);
        if (Array.isArray(lc)) for (const c of lc) if (c && c.id) lById.set(c.id, c);
        return fc.some(c => c && c.id && _sxrMsgIsTweak(c) && !c.deleted && !c.done && !lById.has(c.id));
    }
    function _sxrMergeServerRows(server) {
        const local = sxrState.posts || [];
        const localById = new Map(local.map(p => [p.id, p]));
        const out = [], serverIds = new Set();
        const adoptThumbnailMeta = (post, serverPost) => {
            if (!post || !serverPost) return post;
            if (String(post.thumbnail_url || '').trim() !== String(serverPost.thumbnail_url || '').trim()) return post;
            const keys = ['thumbnail_folder_url','thumbnail_folder_id','thumbnail_file_id','thumbnail_folder_resolved_at'];
            let changed = false;
            for (const k of keys) {
                if (String(post[k] || '') !== String(serverPost[k] || '')) { changed = true; break; }
            }
            let next = post;
            if (changed) {
                next = Object.assign({}, post);
                keys.forEach(k => { next[k] = String(serverPost[k] || ''); });
            }
            return _thumbAdoptPersistedRevision(next, serverPost);
        };
        const carrySourceRepair = (post, localPost) => {
            if (!post || !localPost || !localPost._writeUiRetrySourceAt) return post;
            const next = post === localPost ? post : Object.assign({}, post);
            next._writeUiRetrySourceAt = localPost._writeUiRetrySourceAt;
            next._writeUiRetryEdits = Object.assign({}, localPost._writeUiRetryEdits || {});
            next._writeUiHeldSourceEdits = Object.assign({}, localPost._writeUiHeldSourceEdits || {});
            next._writeUiRetryPrincipal = localPost._writeUiRetryPrincipal || '';
            next._writeUiRepairRefs = _writeUiSnapshotRepairRefs(localPost);
            if (next._writeUiRepairRefs.length) next._writeUiPrecommittedNative = true;
            next._saveError = localPost._saveError || 'Source repair pending';
            return next;
        };
        for (const srv of server) {
            serverIds.add(srv.id);
            const loc = localById.get(srv.id);
            // In-flight save or queued edit: the server row is by definition
            // pre-change for this card — keep local, fold in the server's comments.
            if (loc && (_sxrPendingEdits[srv.id] || _sxrSaveInFlight[srv.id])) {
                const kept = carrySourceRepair(adoptThumbnailMeta(loc, srv), loc);
                _sxrMergePostComments(kept, srv); out.push(kept); continue;
            }
            // Recent local status write (5-min grace): keep our just-set status
            // against a stale reconciler / self echo — BUT adopt any sub-status the
            // server genuinely moved to a NEW value (a peer's Tweaks-Needed /
            // approval) so a live change from another role isn't swallowed and its
            // status pill flips without a manual refresh. Port of the calendar's
            // stillRecent → _calRecentSaveReconcile path.
            if (loc && _sxrIsLocalStatusFresh(srv.id)) {
                const rsf = _sxrRecentSaveFields.get(srv.id);
                const reconciled = rsf ? _sxrRecentSaveReconcile(loc, srv, rsf) : null;
                // reconciled is a clone of loc with the adopted server status, so
                // fold the SERVER row's comments in (Kasper's new tweak note lives
                // there, not on loc) — mirrors the calendar's merge(winner, fp).
                if (reconciled) {
                    const kept = carrySourceRepair(adoptThumbnailMeta(reconciled, srv), loc);
                    _sxrMergePostComments(kept, srv); out.push(kept);
                } else {
                    const kept = carrySourceRepair(adoptThumbnailMeta(loc, srv), loc);
                    _sxrMergePostComments(kept, srv); out.push(kept);
                }
                continue;
            }
            // Default: adopt the server copy (fold local comments in).
            if (loc) _sxrMergePostComments(srv, loc);
            out.push(carrySourceRepair(srv, loc));
        }
        // Keep local-only cards the server doesn't have yet (blank / just-created /
        // failed-new / pending) so a reload can't drop them.
        for (const loc of local) {
            if (serverIds.has(loc.id)) continue;
            if (_sxrIsBlankId(loc.id) || _sxrPendingEdits[loc.id] || _sxrSaveInFlight[loc.id] || _sxrFailedNewCards.has(loc.id)) out.push(loc);
        }
        // Pin a freshly dragged order_index over a stale fetch until the reorder
        // write is readable (or the guard expires) — prevents drag snap-back.
        if (typeof _sxrReorderOptimistic !== 'undefined' && _sxrReorderOptimistic.size) {
            for (const row of out) {
                const ro = _sxrReorderOptimistic.get(row.id);
                if (!ro) continue;
                if (Date.now() - ro.at < SXR_REORDER_GUARD_MS) row.order_index = ro.order_index;
                else _sxrReorderOptimistic.delete(row.id);
            }
        }
        return out;
    }

    /* Deferred-render guard — hold a background repaint while the user is mid-edit. */
    let _sxrPendingBackgroundRender = false;
    function _sxrSetPendingBackgroundRender(value) { _sxrPendingBackgroundRender = value; }
    let _sxrPendingRenderInterval = null;
    function _sxrIsBusy() {
        const body = document.getElementById('sxrBody');
        if (!body) return false;
        const a = document.activeElement;
        const isTextEntry = !!(a && ((a.tagName === 'INPUT' && /^(text|url|email|search|number|tel|password|date)$/i.test(a.type || 'text')) || a.tagName === 'TEXTAREA' || a.isContentEditable));
        if (isTextEntry && (body.contains(a) || (a.closest && a.closest('#sxrCommentsModal')))) return true;
        if (Object.keys(_sxrPendingEdits).length > 0) return true;
        if (_sxrOpenStatusMenu) return true;
        return false;
    }
    function _sxrSchedulePendingRender() {
        if (_sxrPendingRenderInterval) return;
        _sxrPendingRenderInterval = setInterval(() => {
            if (!_sxrPendingBackgroundRender) { clearInterval(_sxrPendingRenderInterval); _sxrPendingRenderInterval = null; return; }
            if (_sxrIsBusy()) return;
            _sxrPendingBackgroundRender = false;
            clearInterval(_sxrPendingRenderInterval); _sxrPendingRenderInterval = null;
            _sxrRenderBody({ preserveScroll: true });
        }, 1200);
    }
    function _sxrMaybeRunPendingRender() {
        if (!_sxrPendingBackgroundRender || _sxrIsBusy()) return;
        _sxrPendingBackgroundRender = false;
        if (_sxrPendingRenderInterval) { clearInterval(_sxrPendingRenderInterval); _sxrPendingRenderInterval = null; }
        _sxrRenderBody({ preserveScroll: true });
    }

    /* Tab-return refetch — a backgrounded tab's socket suspends and Supabase never
       replays missed rows, so on return pull one catch-up. Gated on the surface
       being mounted (and the flag) so it's inert otherwise. */
    let _sxrLastReturnLoad = 0;
    const SXR_RETURN_REFRESH_MIN_MS = 8000;
    function _sxrRefreshOnReturn() {
        if (!_sxrEnabled() || document.visibilityState === 'hidden') return;
        if (!sxrState.client || !document.getElementById('sxrBody')) return;
        if (Date.now() - _sxrLastNetworkLoadAt < SXR_RETURN_REFRESH_MIN_MS) return;
        if (_sxrBgLoadInFlight || sxrState.loading) return;
        const now = Date.now();
        if (now - _sxrLastReturnLoad < 500) return;
        _sxrLastReturnLoad = now;
        loadSxrCards({ background: true });
    }

    /* ── Local-status freshness (reconcile guard) ── */
    const _sxrLocalStatusAt = Object.create(null);
    const SXR_LOCAL_STATUS_GRACE_MS = 5 * 60 * 1000;
    function _sxrMarkLocalStatus(pid, comp) { _sxrLocalStatusAt[pid + '|' + (comp || '')] = Date.now(); if (comp) _sxrLocalStatusAt[pid + '|'] = Date.now(); }
    function _sxrIsLocalStatusFresh(pid, comp) { const ts = _sxrLocalStatusAt[pid + '|' + (comp || '')] || _sxrLocalStatusAt[pid + '|'] || 0; return !!ts && (Date.now() - ts) < SXR_LOCAL_STATUS_GRACE_MS; }

    /* ── Legacy drain-only queue + native per-target serialized writes ── */
    const SXR_LINEAR_OUTBOX_MAX = 6, SXR_LINEAR_OUTBOX_RETRY_MS = 60 * 1000;
    let _sxrLinearOutboxTimer = null, _sxrLinearOutboxPromise = null, _sxrLinearOutboxOwnerKey = '';
    function _sxrSetLinearOutboxTimer(value) { _sxrLinearOutboxTimer = value; }
    // Same retired-row drop as the Calendar twin; see
    // `_writeUiLegacyWithoutRetired` for why it filters here and writes nowhere.
    function _sxrLinearOutboxRead() { try { const a = JSON.parse(localStorage.getItem(SXR_LINEAR_OUTBOX_KEY) || '[]'); return _writeUiLegacyWithoutRetired(Array.isArray(a) ? a : []); } catch (e) { return []; } }
    function _sxrLinearOutboxWrite(a) { try { const items = Array.isArray(a) ? a : []; if (items.length) localStorage.setItem(SXR_LINEAR_OUTBOX_KEY, JSON.stringify(items)); else localStorage.removeItem(SXR_LINEAR_OUTBOX_KEY); return true; } catch (e) { return false; } }
    /* `_sxrLinearOutboxEnqueue` is retired (OPEN_REPAIRS 239). It existed only
       inside the catch of the two legacy Samples senders, so it went with
       them: a retry against a route that no longer has a destination is debt
       nothing can ever pay. Source-only gate records, which never touch the
       network, still queue through `_writeUiLegacyAppendOutboxItem`. */
    function _sxrLinearOutboxScheduleRetry(suppliedOwner) {
        const owner = suppliedOwner || _writeUiLegacyResumeOwner();
        if (!_writeUiLegacyResumeOwnerCurrent(owner) || _sxrLinearOutboxTimer) return;
        _sxrLinearOutboxTimer = setTimeout(() => {
            _sxrLinearOutboxTimer = null;
            if (_writeUiLegacyResumeOwnerCurrent(owner)) _sxrLinearOutboxFlush(owner);
        }, SXR_LINEAR_OUTBOX_RETRY_MS);
    }
    function _sxrLinearOutboxFlush(suppliedOwner) {
        const owner = suppliedOwner || _writeUiLegacyResumeOwner();
        if (!_writeUiLegacyResumeOwnerCurrent(owner)) {
            return Promise.resolve({ outcomes: [], deferred: true });
        }
        const ownerKey = _writeUiLegacyResumeOwnerKey(owner);
        if (_sxrLinearOutboxPromise && _sxrLinearOutboxOwnerKey === ownerKey) {
            return _sxrLinearOutboxPromise;
        }
        const tracked = _sxrLinearOutboxFlushRun(owner).finally(() => {
            if (_sxrLinearOutboxPromise === tracked) {
                _sxrLinearOutboxPromise = null;
                _sxrLinearOutboxOwnerKey = '';
            }
        });
        _sxrLinearOutboxOwnerKey = ownerKey;
        _sxrLinearOutboxPromise = tracked;
        return tracked;
    }
    async function _sxrLinearOutboxFlushRun(owner) {
        if (!_writeUiLegacyResumeOwnerCurrent(owner)) return { outcomes: [], deferred: true };
        await _writeUiPrimeRerouteFlag();
        if (!_writeUiLegacyResumeOwnerCurrent(owner)) return { outcomes: [], deferred: true };
        return _writeUiLegacyDrainWithLock('sxr', async () => {
        if (!_writeUiLegacyResumeOwnerCurrent(owner)) return { outcomes: [], deferred: true };
        const snapshot = _sxrLinearOutboxRead();
        const items = owner.kind === 'client'
            ? snapshot.filter(item => _writeUiLegacyItemOwnedBy(item, owner))
            : snapshot;
        if (!items.length) return { outcomes: [] };
        // item 63, twin of the calendar drain: the direct-delivery branch is a
        // write to an external system, so it requires a live authority read --
        // Linear team delivers as before, flipped team quarantines, unreadable
        // flag delivers nothing and spends no attempts.
        const drainAuthority = await _writeUiRefreshAuthority();
        if (!_writeUiLegacyResumeOwnerCurrent(owner)) return { outcomes: [], deferred: true };
        let enriched = false;
        for (const it of items) {
            if (it && (it.transport === 'legacy_n8n' || it.transport === 'source_only')) continue;
            const seed = it.id || ('legacy_' + String(it.queuedAt || Date.now()));
            if (!it.requestId) { it.requestId = _writeUiIntentId('sxr', it.kind, [seed]); enriched = true; }
            if (it.kind === 'comment' && it.payload && !it.payload.native_comment_id) { it.payload.native_comment_id = _writeUiIntentId('sxr', 'comment', [seed, 'native']); enriched = true; }
        }
        const remaining = [];
        const outcomes = [];
        const sourceGateStates = new Map();
        const supersededGroups = new Map();
        let leaseRevoked = false;
        let deliveryStarted = false;
        itemLoop: for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            const it = items[itemIndex];
            if (!_writeUiLegacyResumeOwnerCurrent(owner)) {
                leaseRevoked = true;
                _writeUiLegacyRetainFrom(items, itemIndex, remaining);
                break itemLoop;
            }
            const payload = it.payload || {};
            /* RETIRED LEGACY TRANSPORT (OPEN_REPAIRS 239). A `legacy_n8n` item
               is a queued POST to the revoked `linear-set-status` /
               `linear-add-comment`. It can never be delivered, so it is
               dropped here: not sent, not retried, and NOT quarantined -- a
               quarantine row is for a write an operator must still decide
               about, and this one has nothing left to decide.

               `_writeUiLegacyWithoutRetired` already strips these at the
               storage read, so in the app nothing reaches this line. It stays
               because this loop must be correct on the items it is HANDED,
               not only on the ones today's reader can hand it: without it,
               an item arriving by any other route would fall through to the
               unverifiable-actor quarantine below and be filed for a review
               that can lead nowhere. */
            if (it && it.transport === 'legacy_n8n') continue;
            if (it && it.source_gate) {
                const gateKey = _writeUiLegacyGateSignature(it.source_gate);
                const storedTerminal = _writeUiLegacyStoredTeamTerminalItem('sxr', it);
                if (storedTerminal) {
                    supersededGroups.set(gateKey, {
                        stored: true,
                        sourceOnly: false,
                        tombstone: storedTerminal
                    });
                    outcomes.push({
                        id: String(it.id || ''),
                        state: 'team_delivery_superseded',
                        comment_id: String(storedTerminal.source_gate
                            && storedTerminal.source_gate.comment_id || ''),
                        item: storedTerminal
                    });
                    continue;
                }
                let gateState = sourceGateStates.get(gateKey);
                if (!sourceGateStates.has(gateKey)) {
                    gateState = await _writeUiLegacySourceGateState(it, 3);
                    if (!_writeUiLegacyResumeOwnerCurrent(owner)) {
                        leaseRevoked = true;
                        _writeUiLegacyRetainFrom(items, itemIndex, remaining);
                        break itemLoop;
                    }
                    sourceGateStates.set(gateKey, gateState);
                }
                if (gateState === 'unknown' || gateState === 'pending' || gateState === 'landed_pending') {
                    remaining.push(it);
                    continue;
                }
                if (it.transport === 'source_only'
                    && (gateState === 'conflict'
                        || gateState === 'principal_mismatch'
                        || gateState === 'target_changed')) {
                    _writeUiLegacyQuarantine('sxr', it, 'source_gate_' + gateState);
                    remaining.push(it);
                    continue;
                }
                if (gateState === 'superseded') {
                    let terminal = supersededGroups.get(gateKey);
                    if (!terminal) {
                        const group = items.filter(row => row && row.source_gate
                            && _writeUiLegacyGateSignature(row.source_gate) === gateKey);
                        const sourceOnly = it.transport === 'source_only';
                        const canonical = sourceOnly
                            ? it
                            : (group.find(row => row && row.kind === 'comment') || it);
                        const tombstone = sourceOnly
                            ? _writeUiLegacySupersededSourceItem(canonical)
                            : _writeUiLegacySupersededTeamItem(canonical);
                        terminal = {
                            stored: _writeUiLegacyRememberCommittedTweak('sxr', tombstone),
                            sourceOnly,
                            tombstone
                        };
                        supersededGroups.set(gateKey, terminal);
                        if (terminal.stored) {
                            _writeUiQueueDiagnostic(
                                'sxr',
                                sourceOnly ? 'source_only_superseded' : 'source_gate_superseded',
                                canonical
                            );
                        }
                    }
                    if (!terminal.stored) {
                        remaining.push(it);
                        outcomes.push({
                            id: String(it.id || ''),
                            state: terminal.sourceOnly
                                ? 'source_only_superseded_pending'
                                : 'team_delivery_superseded_pending',
                            comment_id: String(terminal.tombstone.source_gate
                                && terminal.tombstone.source_gate.comment_id || ''),
                            item: terminal.tombstone
                        });
                        continue;
                    }
                    outcomes.push({
                        id: String(it.id || ''),
                        state: terminal.sourceOnly
                            ? 'source_only_superseded'
                            : 'team_delivery_superseded',
                        comment_id: String(terminal.tombstone.source_gate
                            && terminal.tombstone.source_gate.comment_id || ''),
                        item: terminal.tombstone
                    });
                    continue;
                }
                if (gateState === 'conflict' || gateState === 'principal_mismatch' || gateState === 'target_changed') {
                    if (_writeUiLegacyQuarantine('sxr', it, 'source_gate_' + gateState)) continue;
                    remaining.push(it);
                    continue;
                }
                if (gateState === 'expired') {
                    if (_writeUiLegacyQuarantine('sxr', it, 'source_gate_expired')) continue;
                    remaining.push(it);
                    continue;
                }
                if (gateState !== 'committed') {
                    _writeUiQueueDiagnostic('sxr', 'source_gate_' + gateState, it);
                    continue;
                }
                if (!_writeUiLegacyRememberCommittedTweak('sxr', it)
                    || !_writeUiLegacyReconcileCommittedTweak('sxr', it)) {
                    remaining.push(it);
                    continue;
                }
                if (it.transport === 'source_only') {
                    _writeUiQueueDiagnostic('sxr', 'source_only_confirmed', it);
                    outcomes.push({
                        id: String(it.id || ''),
                        state: 'source_only_confirmed',
                        comment_id: String(it.source_gate.comment_id || ''),
                        item: it
                    });
                    continue;
                }
                const recordedReceipt = _writeUiLegacyRecordedTeamDeliveryReceiptItem('sxr', it);
                if (recordedReceipt) {
                    outcomes.push({
                        id: String(it.id || ''),
                        state: 'team_delivery_confirmed',
                        comment_id: String(it.source_gate.comment_id || ''),
                        item: recordedReceipt
                    });
                    continue;
                }
            }
            /* The `legacy_n8n` delivery branch that stood here -- the
               authority test, the attempt budget, the POST to
               `linear-add-comment` / `linear-set-status` and the team-delivery
               receipt it wrote on success -- is retired (OPEN_REPAIRS 239).
               Those items are now dropped at the top of this loop, so nothing
               below this point can reach the revoked webhooks. */
            const issue = String(payload.issue || '').trim();
            const issueMatch = issue.match(/\b(VID|GRA)-\d+\b/i);
            if (!issueMatch) {
                if (_writeUiLegacyQuarantine('sxr', it, 'legacy_issue_team_unverifiable')) continue;
                remaining.push(it); continue;
            }
            if (it.kind === 'comment' || it.kind === 'status') {
                if (_writeUiLegacyQuarantine('sxr', it, 'legacy_actor_unverifiable')) continue;
                remaining.push(it);
                continue;
            }
            try {
                if (!_writeUiLegacyResumeOwnerCurrent(owner)) {
                    leaseRevoked = true;
                    _writeUiLegacyRetainFrom(items, itemIndex, remaining);
                    break itemLoop;
                }
                await _writeUiGatewayPost({
                    surface: 'sxr', operation: it.kind, team: issueMatch[1].toUpperCase() === 'GRA' ? 'graphics' : 'video',
                    issue, requestId: it.requestId, sourceEditedAt: it.queuedAt, legacyOnly: true,
                    legacyResumeOwner: owner,
                    onLegacyResumeTransportStart: () => { deliveryStarted = true; },
                    status: it.kind === 'status' ? _writeUiNativeStatus(payload.status) : undefined,
                    comment: it.kind === 'comment' ? { body: String(payload.body || ''), audience: _isClientLink ? 'client' : 'internal', native_comment_id: payload.native_comment_id } : undefined
                });
                _writeUiQueueDiagnostic('sxr', 'drained', it);
                if (it.source_gate) {
                    outcomes.push({
                        id: String(it.id || ''),
                        state: 'team_delivery_confirmed',
                        comment_id: String(it.source_gate.comment_id || ''),
                        item: it
                    });
                }
            } catch (e) {
                if (String(e && e.code || '') === 'legacy_resume_lease_revoked') {
                    leaseRevoked = true;
                    _writeUiLegacyRetainFrom(items, itemIndex, remaining);
                    break itemLoop;
                }
                if (Number(e && e.status) === 409 && String(e && e.code || '') === 'legacy_parity_not_allowed') { _writeUiQueueDiagnostic('sxr', 'discarded_authority_flip', it, e); continue; }
                if ([400, 404].includes(Number(e && e.status))) {
                    if (_writeUiLegacyQuarantine('sxr', it, String(e && e.code || 'legacy_payload_invalid'))) continue;
                    remaining.push(it); continue;
                }
                if ([401, 403, 409, 503].includes(Number(e && e.status)) || !(e && e.status)) { it.lastError = String(e && (e.code || e.message) || e); remaining.push(it); continue; }
                it.attempts = Number(it.attempts || 0) + 1; it.lastError = (e && e.message) || String(e);
                if (it.attempts >= SXR_LINEAR_OUTBOX_MAX && _writeUiLegacyQuarantine('sxr', it, 'legacy_retry_cap')) continue;
                remaining.push(it);
            }
        }
        if (leaseRevoked && !deliveryStarted) return { outcomes: [], deferred: true };
        let finalized;
        try {
            finalized = await _writeUiLegacyFinalizeFlush(
                'sxr',
                items,
                remaining,
                () => deliveryStarted || _writeUiLegacyResumeOwnerCurrent(owner)
            );
        } catch (error) {
            const terminal = Array.from(supersededGroups.values())
                .find(entry => entry && !entry.sourceOnly);
            if (terminal) {
                error.team_delivery_superseded = true;
                error.comment_id = String(terminal.tombstone
                    && terminal.tombstone.source_gate
                    && terminal.tombstone.source_gate.comment_id || '');
                error.terminal_item = terminal.tombstone || null;
            }
            throw error;
        }
        if (finalized && finalized.deferred === true) return { outcomes: [], deferred: true };
        if (remaining.length && _writeUiLegacyResumeOwnerCurrent(owner)) _sxrLinearOutboxScheduleRetry(owner);
        return { outcomes };
        });
    }
    window.clearSxrLinearOutbox = function () { const n = _sxrLinearOutboxRead().length; _sxrLinearOutboxWrite([]); return 'cleared ' + n; };
    window.peekSxrLinearOutbox = function () { return _sxrLinearOutboxRead(); };
    const _sxrLinearPushChain = Object.create(null);
    /* RETIRED 2026-09-22 (B1 order row 5, OPEN_REPAIRS 239):
       `_sxrLegacyPushStatusToLinear` and `_sxrLegacyPostLinearComment` used to
       POST every legacy-routed Samples status and comment to the n8n webhooks
       `linear-set-status` / `linear-add-comment`, and enqueue a retry on the
       Samples Linear outbox from inside their own catch.

       The API key behind both webhooks is revoked 2026-09-27, so every such
       send fails from that date on, forever, and the retry queue it fed has no
       destination that could ever pay it. Deleting the send WITH its
       bookkeeping is safe here because no Samples write's only home was Linear
       -- every caller stores on the card and saves the source first:

         - the status save loop writes the card and upserts at
           `280-samples-cards-notes.js.part:456`, and only sent afterwards;
         - the change-request path commits `<comp>_tweaks` through
           `repairEdits` and `_sxrFlushCardSave`;
         - the plain note add appends to the card array and calls
           `_sxrWatchNoteSave` regardless of the transport's answer;
         - `_sxrKasperApplyAndPersist` persists via `_sxrKasperPersist` before
           it sent;
         - the repair-journal replay reissues an intent the card already holds.

       Nothing reads Linear any more (owner, 2026-09-22), so the outbound copy
       has no reader to lose. The gateway lane, the card save and its ordering,
       receipts and owner checks are untouched. */
    async function _sxrPushStatusToLinear(issueUrl, status, meta) {
        /* Same rule as the comment writer beside this one. No caller reaches
           here with a caption or title today -- `_kasperPersistPost` loops
           video and graphic, `_calReassertLinearStatus` refuses anything else,
           and every other caller names its component -- but the collapse on
           the next line would send one to the VIDEO deliverable if one ever
           did, and this file already says why that is not good enough: "a rule
           that depends on the caller never exercising a documented behaviour
           of its own argument is not a rule". OPEN_REPAIRS 127. */
        if (!_writeUiComponentHasWorkItem(meta && meta.component)) {
            // Same source-only shape as the comment writers, deferred flag included.
            const sourceOnly = { skipped: true, source_only: true };
            return meta && meta.deferLegacyUntilSourceSave
                ? Object.assign({}, sourceOnly, { deferred_until_source_save: true })
                : sourceOnly;
        }
        if (!(await _writeUiUseGatewayWhenReady('sxr', meta))) {
            /* The legacy lane no longer has a destination (OPEN_REPAIRS 239),
               so it neither sends nor records a retry.

               When the caller asked to defer until the source save, answer the
               SAME source-only shape every other source-only exit in this file
               answers. That flag is what makes `_sxrReviewRequestTweak` /
               `_calReviewRequestTweak` run `_writeUiQueueDeferredLegacyTweak`
               and write the durable source-only ledger row. Dropping it here
               dropped that row and its conflict check on every legacy-route
               card: a card upsert that COMMITS but loses its response would
               roll the UI back, and the retry would mint a second comment id
               against the already-committed first -- the PR 1245 regression,
               which the caption exit above exists to prevent. Same shape for
               every caller means no caller has to learn a new flag. */
            const retired = { skipped: true, source_only: true, legacy_transport_retired: true };
            return Promise.resolve(meta && meta.deferLegacyUntilSourceSave
                ? Object.assign({}, retired, { deferred_until_source_save: true })
                : retired);
        }
        const url = String(issueUrl || '').trim(), st = String(status || '').trim();
        const component = meta && meta.component === 'graphic' ? 'graphic' : 'video';
        const nativeId = _writeUiNativeId(meta && meta.post, component);
        const targetKey = nativeId || url;
        if (!st || st === 'Scheduled' || st === 'Posted') return Promise.resolve({ skipped: true });   // samples never push the calendar-only states
        const nativeStatus = _writeUiNativeStatus(st);
        if (!nativeStatus) return Promise.resolve({ skipped: true });
        if (!targetKey) {
            return _writeUiClassifyTargetless('sxr', component, meta);
        }
        const repair = meta && meta.repairRecord ? meta.repairRecord : _writeUiBuildSourceRepair('sxr', 'status', meta);
        const run = async () => {
            return _writeUiGatewayWithRepair({
                    surface: 'sxr', operation: 'status', team: _writeUiTeam(component), issue: url,
                    nativeId, status: nativeStatus,
                    sourceEditedAt: meta && meta.sourceEditedAt,
                    requestId: _writeUiIntentId('sxr', 'status', [meta && meta.post && meta.post.id, component, nativeStatus, meta && meta.sourceEditedAt || Date.now()])
                }, repair);
        };
        const chain = (_sxrLinearPushChain[targetKey] || Promise.resolve()).then(run, run);
        _sxrLinearPushChain[targetKey] = chain.catch(() => {});
        return chain;
    }
    async function _sxrPostLinearComment(issueUrl, body, author, meta) {
        // Same rule as the calendar twin. SXR_COMPONENTS is video+graphic only,
        // so nothing reaches this today -- it is here because the collapse
        // below is identical, and a rule that lives on one of two identical
        // surfaces is how the 87.8 / 87.16 pair happened.
        if (!_writeUiComponentHasWorkItem(meta && meta.component)) {
            // Same source-only shape as the comment writers, deferred flag included.
            const sourceOnly = { skipped: true, source_only: true };
            return meta && meta.deferLegacyUntilSourceSave
                ? Object.assign({}, sourceOnly, { deferred_until_source_save: true })
                : sourceOnly;
        }
        const component = meta && meta.component === 'graphic' ? 'graphic' : 'video';
        const nativeId = _writeUiNativeId(meta && meta.post, component);
        // Canonical-where-linked, legacy-where-not. A client write is canonical
        // only when the card actually carries a native deliverable binding; an
        // UNLINKED card takes the identical transport decision staff takes
        // (reroute flag on -> gateway, off -> legacy n8n delivery), which is
        // exactly the pre-Slice-4 behavior for these cards.
        const clientGate = _isClientLink
            ? _prodCanonicalCommentGate(meta && meta.post, component)
            : null;
        const clientCanonicalWrite = !!(clientGate && clientGate.linked);
        const clientSurface = clientCanonicalWrite
            ? _prodVerifiedClientCommentMutationContext('sxr', meta && meta.post, component, nativeId)
            : null;
        // Same 2026-08-13 incident, Samples side. The LINKED client thread
        // below supplies clientSurface.card_id and stays fail-closed on the
        // gateway — that path is correct and deliberately untouched. The
        // UNLINKED client thread has no verified card crosswalk, so the old
        // clientCommentTargetAllowed rejected it every time (only 3 linked
        // sample cards existed against 5,427 total — unlinked is the normal
        // case) and PR 1064 routed it legacy. FRONT-DOOR REPAIR: the gateway
        // now accepts the unlinked thread under
        // clientCommentFrontDoorTargetAllowed, so it goes legacy UNLESS the
        // client_comment_gateway_enabled flag is ON and this tab can build a
        // verified gateway context (null = fail-legacy, the PR 1064 behavior).
        const clientFrontDoorSurface = !clientCanonicalWrite && _isClientLink
            ? await _prodClientCommentGatewayContext('sxr', meta && meta.post, component)
            : null;
        /* Same disjunct as the calendar twin, same reasons: the ADD lane's
           crosswalk answer for the exact component of the write, kept off the
           client front door (which owns its own crosswalk decision) and placed
           last so the reroute-flag priming still runs. Unreachable from the
           `clientCanonicalWrite` branch below, which is a LINKED card by
           definition and stays fail-closed. */
        const canonicalUnlinkedAdd = !!(meta && meta.canonicalUnlinked) && !clientFrontDoorSurface;
        if (clientCanonicalWrite) {
            // A LINKED client thread stays fail-closed and never falls back.
            if (!clientGate.ready || !clientGate.client || !nativeId || !clientSurface) {
                throw _writeUiGatewayError(409, 'canonical_comment_read_required');
            }
        } else if (!(await _writeUiUseGatewayWhenReady('sxr', meta)) || (_isClientLink && !clientFrontDoorSurface) || canonicalUnlinkedAdd) {
            /* Retired legacy lane (OPEN_REPAIRS 239). The comment's home is the
               card either way: the change-request path commits it through
               `repairEdits` and `_sxrFlushCardSave`, and the plain add appends
               to the card array below this call's resolution. Resolving rather
               than throwing keeps that append running, exactly as the legacy
               fire-and-forget sender did.

               Carries `deferred_until_source_save` when the caller asked for
               it, so the durable source-only ledger row is still staged -- see
               the calendar twin and the caption exit for the committed-but-
               unacknowledged upsert this protects (PR 1245). */
            const retired = { skipped: true, source_only: true, legacy_transport_retired: true };
            return Promise.resolve(meta && meta.deferLegacyUntilSourceSave
                ? Object.assign({}, retired, { deferred_until_source_save: true })
                : retired);
        }
        const url = String(issueUrl || '').trim(), txt = String(body || '').trim();
        if (!txt) return Promise.resolve({ skipped: true });
        if (!url && !nativeId) {
            const targetless = await _writeUiClassifyTargetless('sxr', component, meta);
            return meta && meta.deferLegacyUntilSourceSave
                ? Object.assign({}, targetless, {
                    source_only: true,
                    deferred_until_source_save: true
                })
                : targetless;
        }
        const repair = clientCanonicalWrite || _isClientLink
            ? null
            : meta && meta.repairRecord
                ? meta.repairRecord
                : _writeUiBuildSourceRepair('sxr', 'comment', meta);
        const comment = meta && meta.comment;
        const nativeCommentId = String(comment && comment.id || _writeUiIntentId('sxr', 'comment', [Date.now(), txt.slice(0, 24)]));
        return _writeUiGatewayWithRepair({
                    surface: 'sxr', operation: 'comment', team: _writeUiTeam(component), issue: url,
                    nativeId,
                    sourceEditedAt: comment && (comment.updated_at || comment.created_at),
                    requestId: _writeUiIntentId('sxr', 'comment', [nativeCommentId]),
                    comment: { body: txt, native_comment_id: nativeCommentId, parent_id: String(meta && meta.parentId || ''), audience: meta && meta.audience === 'client' ? 'client' : 'internal', component, is_tweak: !!(meta && meta.isTweak), round: meta && Number.isInteger(meta.round) ? meta.round : null, ...(clientSurface ? { card_id: clientSurface.card_id } : clientFrontDoorSurface ? { card_id: clientFrontDoorSurface.card_id } : {}) }
                }, repair);
    }
    function _writeUiApplyJournalEdits(post, edits, surface) {
        const applied = {};
        for (const [key, value] of Object.entries(edits || {})) {
            const match = /^(video|graphic|caption|title)_tweaks$/.exec(key);
            if (!match) { post[key] = value; applied[key] = value; continue; }
            let intended = [];
            try { intended = value ? JSON.parse(value) : []; } catch (e) { intended = []; }
            const component = match[1];
            if (surface === 'sxr') {
                const merged = _sxrMergeCommentLists(_sxrCommentsFor(post, component), intended);
                _sxrSetCommentsFor(post, component, merged);
                applied[key] = _sxrStringifyComments(merged);
            } else {
                const merged = _calMergeCommentLists(_calCommentsFor(post, component), intended);
                _calSetCommentsFor(post, component, merged);
                applied[key] = _calStringifyComments(merged);
            }
        }
        // A receipt can return a newer reviewer state. Keep the existing stale-
        // approval rule when applying a captured stamp to that current state.
        for (const component of ['video', 'graphic']) {
            const key = 'client_' + component + '_approved_at';
            if (applied[key] && !['Client Approval', 'Approved', 'Scheduled', 'Posted'].includes(String(post[component + '_status'] || ''))) {
                post[key] = applied[key] = '';
            }
        }
        return applied;
    }
    function _writeUiRepairGroups(principal) {
        const state = _writeUiRepairJournalRead();
        const groups = new Map();
        state.rows.filter(row => row.principal === principal).forEach(row => {
            const key = [row.surface, row.lane || 'card', row.client_slug, row.post_id].join('|');
            const group = groups.get(key) || {
                key, surface: row.surface, lane: row.lane || 'card', client_slug: row.client_slug,
                post_id: row.post_id, source_at: row.source_at, edits: {}, intents: [], refs: []
            };
            group.edits = Object.assign(group.edits, row.edits || {});
            group.intents = group.intents.concat((row.intents || []).map(intent => Object.assign({}, intent, {
                _repair_key: row.key, _repair_token: row.token
            })));
            group.refs.push({ key: row.key, token: row.token });
            if (String(row.source_at || '') > String(group.source_at || '')) group.source_at = row.source_at;
            groups.set(key, group);
        });
        return { groups: Array.from(groups.values()), unknown: state.unknown };
    }
    function _writeUiJournalHasRepair(surface, lane, slug, postId, principal) {
        const state = _writeUiRepairJournalRead();
        return state.rows.some(row => row.surface === surface && (row.lane || 'card') === lane
            && row.client_slug === slug && row.post_id === postId && row.principal === principal);
    }
    function _writeUiJournalCoversRepairRefs(post, surface, lane, slug, principal) {
        const refs = _writeUiSnapshotRepairRefs(post);
        if (!refs.length) return false;
        const state = _writeUiRepairJournalRead();
        if (state.unknown) return false;
        return refs.every(ref => state.rows.some(row => row.key === ref.key && row.token === ref.token
            && row.surface === surface && (row.lane || 'card') === lane
            && row.client_slug === slug && row.post_id === String(post && post.id || '')
            && row.principal === principal));
    }
    function _writeUiRepairRecordForIntent(intent) {
        if (!intent || !intent._repair_key || !intent._repair_token || !intent.key) {
            throw _writeUiGatewayError(507, 'repair_intent_unavailable');
        }
        const state = _writeUiRepairJournalRead();
        if (state.unknown) throw _writeUiGatewayError(507, 'repair_storage_unknown');
        const stored = state.rows.find(row => row.key === intent._repair_key && row.token === intent._repair_token);
        if (!stored) throw _writeUiGatewayError(507, 'repair_checkpoint_missing');
        const record = JSON.parse(JSON.stringify(stored));
        record.primary_intent_key = intent.key;
        return record;
    }
    function _writeUiMaxSourceClock() {
        let best = '';
        let bestMs = -Infinity;
        for (const value of arguments) {
            const raw = String(value || '').trim();
            const ms = Date.parse(raw);
            if (Number.isFinite(ms) && ms > bestMs) { best = raw; bestMs = ms; }
        }
        return best;
    }
    function _writeUiValidatePinnedRepairPayload(group, intent, post) {
        let payload = null;
        try { payload = JSON.parse(String(intent && intent.gateway_payload || '')); } catch (e) {}
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw _writeUiGatewayError(507, 'repair_payload_invalid');
        }
        const component = intent.component === 'graphic' ? 'graphic' : 'video';
        const payloadSource = Date.parse(String(payload.source_edited_at || ''));
        const intentSource = Date.parse(String(intent.source_at || group.source_at || ''));
        if (String(payload.operation || '') !== String(intent.operation || '')
            || String(payload.surface || '') !== String(group.surface || '')
            || (!Number.isFinite(payloadSource) || !Number.isFinite(intentSource) || payloadSource !== intentSource)
            || (payload.id && typeof payload.id !== 'string')
            || (payload.issue && typeof payload.issue !== 'string')) {
            throw _writeUiGatewayError(409, 'repair_payload_mismatch');
        }
        if (!payload.id && !payload.issue) throw _writeUiGatewayError(409, 'repair_payload_mismatch');
        if (intent.operation === 'status') {
            if (_writeUiNativeStatus(payload.status) !== _writeUiNativeStatus(intent.status)) {
                throw _writeUiGatewayError(409, 'repair_payload_mismatch');
            }
        } else if (intent.operation === 'comment') {
            const comment = payload.comment && typeof payload.comment === 'object' ? payload.comment : {};
            if (String(comment.native_comment_id || '') !== String(intent.comment && intent.comment.id || '')
                || String(comment.body || '') !== String(intent.comment && intent.comment.body || '')) {
                throw _writeUiGatewayError(409, 'repair_payload_mismatch');
            }
        } else throw _writeUiGatewayError(400, 'repair_operation_unsupported');
        return payload;
    }
    function _writeUiReceiptMatchesSource(group, intent, post, receipt) {
        const row = receipt && receipt.row;
        if (!row || typeof row !== 'object') return false;
        const component = intent && intent.component === 'graphic' ? 'graphic' : 'video';
        const nativeId = _writeUiNativeId(post, component);
        const nativeMatches = !!nativeId && String(row.id || '') === nativeId;
        const cardMatches = !!String(row.card_id || '') && String(row.card_id) === String(group.post_id || '');
        const rowTeamRaw = String(row.team || '').trim().toLowerCase();
        const rowTeam = ['graphics', 'gra'].includes(rowTeamRaw) ? 'graphics'
            : ['video', 'vid'].includes(rowTeamRaw) ? 'video' : '';
        return String(row.client_slug || '') === String(group.client_slug || '')
            && rowTeam === _writeUiTeam(component)
            && (nativeMatches || cardMatches);
    }
    async function _writeUiReadRepairReceipt(group, intent, post) {
        if (!intent || !intent.gateway_payload) return null;
        if (!_writeUiHasCredential()) throw _writeUiGatewayError(401, 'credentials_required');
        const payload = _writeUiValidatePinnedRepairPayload(group, intent, post);
        payload.reconcile_only = true;
        const response = await fetch(WRITE_UI_PRODUCTION_WRITE_URL, {
            method: 'POST', cache: 'no-store',
            headers: _syncviewEfHeaders({
                apikey: CAL_SUPABASE_ANON_KEY,
                Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY,
                Accept: 'application/json', 'Content-Type': 'application/json',
                'X-Syncview-Source': group.surface
            }, WRITE_UI_PRODUCTION_WRITE_URL),
            body: JSON.stringify(payload)
        });
        const json = await response.json().catch(() => ({}));
        if (response.status === 409 || json && json.outcome === 'conflict') {
            throw _writeUiGatewayError(409, json && json.error || 'intent_conflict');
        }
        if (!response.ok || !json || json.ok !== true
            || !['committed_exact', 'absent'].includes(String(json.outcome || ''))) {
            throw _writeUiGatewayError(response.status || 503, json && json.error || 'reconcile_receipt_unavailable');
        }
        if (!_writeUiReceiptMatchesSource(group, intent, post, json)) {
            throw _writeUiGatewayError(409, 'repair_receipt_target_mismatch');
        }
        return json;
    }
    function _writeUiCanonicalSourceComment(row, fallback) {
        row = row && typeof row === 'object' ? row : {};
        fallback = fallback && typeof fallback === 'object' ? fallback : {};
        const lifecycleAt = _writeUiMaxSourceClock(
            row.source_updated_at, row.edited_at, row.deleted_at, row.resolved_at,
            row.source_created_at, row.updated_at, row.created_at,
            fallback.updated_at, fallback.created_at
        );
        return {
            id: String(row.native_comment_id || fallback.id || row.id || ''),
            parent_id: String(fallback.parent_id || ''),
            author: String(row.author_name || fallback.author || 'Unknown author'),
            role: String(row.role || fallback.role || ''),
            audience: String(row.audience || fallback.audience || 'internal'),
            body: String(row.body == null ? fallback.body || '' : row.body),
            created_at: String(row.source_created_at || fallback.created_at || row.created_at || lifecycleAt),
            updated_at: lifecycleAt,
            is_tweak: row.is_tweak === true || fallback.is_tweak === true,
            round: Number.isInteger(row.round) ? row.round : (Number.isInteger(fallback.round) ? fallback.round : null),
            deleted: !!String(row.deleted_at || ''),
            done: !!String(row.resolved_at || ''),
            done_at: String(row.resolved_at || ''),
            done_by: String(row.resolved_by_name || '')
        };
    }
    /* F50 vocabulary rule for every repair/replay projector: a native status
       reaches a card ONLY through _calMapNativeStatusStrict. The display table
       (_writeUiDisplayStatus) emits Backlog/Todo/Canceled/Duplicate — words no
       card vocabulary contains — and an unmapped native must LEAVE THE CARD
       AS IT IS (owner ruling 2026-08-10), not throw: a permanently-canceled
       deliverable would otherwise wedge its repair intent forever. The throw
       stays only for a native the vocabulary itself cannot recognise. */
    function _writeUiCardOrigin(intent) {
        // Repair COMPANION intents may not carry `surface` directly, but their
        // repair key is always prefixed with it ('sxr|…' / 'calendar|…'), so a
        // samples recovery can never be mistaken for calendar and given a
        // Scheduled/Posted word its vocabulary does not contain.
        const surface = String((intent && intent.surface)
            || String(intent && intent._repair_key || '').split('|')[0]
            || '').toLowerCase();
        return surface === 'sxr' ? 'samples' : 'calendar';
    }
    async function _writeUiAdoptRepairReceipt(group, intent, post, receipt) {
        if (!receipt || receipt.outcome !== 'committed_exact' || !receipt.row) {
            throw _writeUiGatewayError(503, 'reconcile_receipt_invalid');
        }
        const component = intent.component === 'graphic' ? 'graphic' : 'video';
        if (intent.operation === 'status') {
            const native = _writeUiNativeStatus(receipt.row.status);
            if (!native) throw _writeUiGatewayError(503, 'native_replay_status_unavailable');
            const status = _calMapNativeStatusStrict(native, _writeUiCardOrigin(intent));
            if (status) {
                post[component + '_status'] = status;
                group.edits[component + '_status'] = status;
            }
            group.source_at = _writeUiMaxSourceClock(group.source_at, receipt.row.status_at, receipt.row.updated_at) || group.source_at;
        } else if (intent.operation === 'comment') {
            if (!receipt.comment || String(receipt.comment.native_comment_id || '') !== String(intent.comment && intent.comment.id || '')) {
                throw _writeUiGatewayError(409, 'repair_comment_receipt_mismatch');
            }
            const canonical = _writeUiCanonicalSourceComment(receipt.comment, intent.comment);
            const current = group.surface === 'sxr' ? _sxrCommentsFor(post, component) : _calCommentsFor(post, component);
            let intended = [];
            try {
                const raw = group.edits[component + '_tweaks'];
                intended = raw ? JSON.parse(raw) : [];
                if (!Array.isArray(intended)) intended = [];
            } catch (e) { intended = []; }
            // Preserve every unsynced comment represented by this group, then
            // overlay the canonical receipt last so later edits/tombstones win.
            const merged = group.surface === 'sxr'
                ? _sxrMergeCommentLists(_sxrMergeCommentLists(current, intended), [canonical])
                : _calMergeCommentLists(_calMergeCommentLists(current, intended), [canonical]);
            if (group.surface === 'sxr') {
                _sxrSetCommentsFor(post, component, merged);
                group.edits[component + '_tweaks'] = _sxrStringifyComments(merged);
            } else {
                _calSetCommentsFor(post, component, merged);
                group.edits[component + '_tweaks'] = _calStringifyComments(merged);
            }
            group.source_at = _writeUiMaxSourceClock(
                group.source_at, receipt.comment.source_updated_at, receipt.comment.edited_at,
                receipt.comment.deleted_at, receipt.comment.resolved_at, receipt.comment.updated_at
            ) || group.source_at;
        }
        const ref = await _writeUiMarkRepairCommitted({
            key: intent._repair_key, token: intent._repair_token, primary_intent_key: intent.key
        }, { row: receipt.row }, { reconciled: true, reason: 'committed_exact_receipt' });
        _writeUiAdoptRepairAck(post, { native_committed: true, row: receipt.row, source_repair: ref });
        intent.native_committed = true;
        intent.reconciled = true;
        return receipt;
    }
    async function _writeUiReadCurrentNativeStatus(post, component) {
        const id = _writeUiNativeId(post, component);
        if (!id) throw _writeUiGatewayError(409, 'native_link_required');
        const url = CAL_SUPABASE_URL + '/rest/v1/deliverables?select=id,status,status_at,updated_at&id=eq.' + encodeURIComponent(id) + '&limit=2';
        const response = await fetch(url, {
            cache: 'no-store',
            headers: { apikey: CAL_SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY, Accept: 'application/json' }
        });
        const rows = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(rows) || rows.length !== 1) {
            throw _writeUiGatewayError(503, 'native_replay_read_unavailable');
        }
        return rows[0];
    }
    async function _writeUiReconcileReplayStatus(group, intent, post) {
        const component = intent && intent.component === 'graphic' ? 'graphic' : 'video';
        const intended = _writeUiNativeStatus(intent && intent.status
            || group && group.edits && group.edits[component + '_status']
            || post && post[component + '_status']);
        if (!intended) throw _writeUiGatewayError(400, 'repair_status_invalid');
        const current = await _writeUiReadCurrentNativeStatus(post, component);
        const currentStatus = _writeUiNativeStatus(current && current.status);
        if (!currentStatus) throw _writeUiGatewayError(503, 'native_replay_status_unavailable');
        const sourceClock = Date.parse(String(intent && intent.source_at || group && group.source_at || ''));
        const currentClock = Date.parse(String(current && (current.status_at || current.updated_at) || ''));
        const clockProvesCurrent = Number.isFinite(sourceClock) && Number.isFinite(currentClock)
            && currentClock >= sourceClock;
        const matches = currentStatus === intended && clockProvesCurrent;
        const superseded = currentStatus !== intended && clockProvesCurrent;
        if (!matches && !superseded) {
            // A missing/unusable native clock is not permission to overwrite a
            // different current value during recovery. Keep the journal debt.
            if (!Number.isFinite(sourceClock) || !Number.isFinite(currentClock)) {
                throw _writeUiGatewayError(503, 'native_replay_clock_unavailable');
            }
            return false;
        }
        if (superseded) {
            // Same F50 vocabulary rule as _writeUiAdoptRepairReceipt: an
            // unmapped newer native (canceled/triage/duplicate, or
            // scheduled/posted on the samples surface) leaves the card as it
            // is; the repair still resolves as 'newer_native_status'.
            const display = _calMapNativeStatusStrict(currentStatus, _writeUiCardOrigin(intent));
            if (display) {
                post[component + '_status'] = display;
                group.edits[component + '_status'] = display;
            }
        }
        const ref = await _writeUiMarkRepairCommitted({
            key: intent._repair_key, token: intent._repair_token, primary_intent_key: intent.key
        }, { row: current }, {
            reconciled: true,
            reason: superseded ? 'newer_native_status' : 'matching_native_status'
        });
        _writeUiAdoptRepairAck(post, { native_committed: true, row: current, source_repair: ref });
        intent.native_committed = true;
        intent.reconciled = true;
        return true;
    }
    async function _writeUiReplayRepairIntents(group, post) {
        for (const intent of group.intents || []) {
            if (!intent || !intent.key) continue;
            const component = intent.component === 'graphic' ? 'graphic' : 'video';
            // localStorage acknowledgement bits are recovery hints, never proof.
            // An attempted intent must be reconciled against the authenticated
            // atomic outbox receipt before any source edit is applied.
            const receipt = await _writeUiReadRepairReceipt(group, intent, post);
            if (receipt && receipt.outcome === 'committed_exact') {
                await _writeUiAdoptRepairReceipt(group, intent, post, receipt);
                continue;
            }
            if (intent.operation === 'status') {
                // Status is destructive/non-commutative. Exact absence (or a
                // never-attempted companion) may not be replayed without CAS.
                // A newer native status safely supersedes it; otherwise retain
                // the journal for an explicit reapply.
                if (await _writeUiReconcileReplayStatus(group, intent, post)) continue;
                throw _writeUiGatewayError(409, 'status_reapply_required');
            }
            const meta = {
                post, component, sourceEditedAt: intent.source_at || group.source_at,
                clientSlug: group.client_slug, repairLane: group.lane, repairEdits: group.edits,
                repairRecord: _writeUiRepairRecordForIntent(intent)
            };
            let acknowledgement;
            if (intent.operation === 'comment' && intent.comment && intent.comment.id) {
                // Exact receipt absence proves the atomic native/comment/outbox
                // transaction did not commit. Reissuing this append-only stable
                // native id through the CURRENT authority lane is safe.
                meta.comment = intent.comment;
                meta.parentId = intent.comment_meta && intent.comment_meta.parent_id;
                meta.audience = intent.comment_meta && intent.comment_meta.audience;
                meta.isTweak = !!(intent.comment_meta && intent.comment_meta.is_tweak);
                meta.round = intent.comment_meta && Number.isInteger(intent.comment_meta.round) ? intent.comment_meta.round : null;
                acknowledgement = group.surface === 'sxr'
                    ? await _sxrPostLinearComment(_sxrLinearUrlFor(post, component), intent.comment.body, intent.comment.author, meta)
                    : await _calPostLinearComment(_calLinearUrlFor(post, component), intent.comment.body, intent.comment.author, meta);
            } else throw _writeUiGatewayError(400, 'repair_operation_unsupported');
            if (acknowledgement && acknowledgement.native_committed) {
                _writeUiAdoptRepairAck(post, acknowledgement);
                const ref = acknowledgement.source_repair || await _writeUiMarkRepairCommitted({
                    key: intent._repair_key, token: intent._repair_token, primary_intent_key: intent.key
                }, acknowledgement);
                _writeUiAdoptRepairAck(post, { native_committed: true, source_repair: ref });
            }
        }
    }
    async function _writeUiReplayJournalGroup(group, principal) {
        let post = null;
        let item = null;
        if (group.lane === 'kasper-calendar' && typeof _kasperState === 'object') {
            item = (_kasperState.items || []).find(row => row && row.post && row.post.id === group.post_id && row.slug === group.client_slug);
            post = item && item.post;
        } else if (group.lane === 'kasper-sxr' && typeof _sxrKasperState === 'object') {
            item = (_sxrKasperState.items || []).find(row => row && row.post && row.post.id === group.post_id && row.slug === group.client_slug);
            post = item && item.post;
        } else if (group.surface === 'calendar' && typeof calState === 'object'
            && calClientSlug(calState.client) === group.client_slug) {
            post = (calState.posts || []).find(row => row && row.id === group.post_id);
        } else if (group.surface === 'sxr' && typeof sxrState === 'object'
            && sxrClientSlug(sxrState.client) === group.client_slug) {
            post = (sxrState.posts || []).find(row => row && row.id === group.post_id);
        }
        if (!post) return false;
        if (group.lane === 'kasper-sxr' && post._writeUiKasperRepair
            && !_writeUiJournalCoversRepairRefs(post, 'sxr', 'kasper-sxr', group.client_slug, principal)) {
            throw _writeUiGatewayError(409, 'source_repair_receipt_required');
        }
        // Do not project unverified journal data into the card. Receipt proof
        // and current-native supersession run first; only their reconciled
        // result is eligible for source repair.
        await _writeUiReplayRepairIntents(group, post);
        // Replay may adopt a newer native status. Rebuild the exact source patch
        // after that read so the stale pre-replay object cannot overwrite it.
        if (Object.keys(group.edits || {}).some(key => /^(video|graphic)_status$/.test(key))) {
            group.edits.status = group.surface === 'sxr' ? computeSampleOverallStatus(post) : computeOverallStatus(post);
        }
        const edits = _writeUiApplyJournalEdits(post, group.edits, group.surface);
        post.updated_at = group.source_at;
        /* MERGE, never replace. The journal row carries only the status half
           of a save; the card's own retry edits can also hold fields that rode
           in the same save (a caption status, a CTA). Replacing them dropped
           those fields from every later retry -- live 2026-09-23 a Set-all's
           caption never reached the card row. The journal's values win where
           both name a field. */
        const carried = group.surface === 'calendar' ? Object.assign({}, post._writeUiRetryEdits || {}) : {};
        post._writeUiRetryEdits = Object.assign({}, carried, edits);
        post._writeUiRetrySourceAt = group.source_at;
        post._writeUiRetryPrincipal = principal;
        if (group.lane === 'kasper-calendar') {
            await _kasperPersistPost(item, { precommitted: true, refs: group.refs });
        } else if (group.lane === 'kasper-sxr') {
            const sourceRepairRefs = group.refs.map(ref => ({ key: ref.key, token: ref.token }));
            await _sxrKasperPersist(item, edits);
            if (await _writeUiCompleteSourceRepairRefs(sourceRepairRefs)) _writeUiRemoveCompletedRepairRefs(post, sourceRepairRefs);
            delete post._writeUiKasperRepair;
            if (typeof _kasperState === 'object' && _kasperState) {
                _kasperState.sxrRepairs = (_kasperState.sxrRepairs || []).filter(row => row
                    && !(row.id === group.post_id && row.slug === group.client_slug));
                _kasperPersistCache();
            }
        } else if (group.surface === 'calendar') {
            _calPendingEdits[post.id] = Object.assign({}, carried, edits, _calPendingEdits[post.id] || {}, {
                _writeUiPrecommittedNative: true,
                _writeUiRepairRefs: group.refs.map(ref => ({ key: ref.key, token: ref.token }))
            });
            await _calFlushCardSave(post.id);
        } else {
            _sxrPendingEdits[post.id] = Object.assign({}, edits, _sxrPendingEdits[post.id] || {}, {
                _writeUiPrecommittedNative: true,
                _writeUiRepairRefs: group.refs.map(ref => ({ key: ref.key, token: ref.token }))
            });
            await _sxrFlushCardSave(post.id);
        }
        return true;
    }
    function _writeUiSourceRepairSuperseded(post) {
        // 2026-08-28 (OPEN_REPAIRS item 54): a RECEIPT-LESS checkpoint whose
        // row the server has moved PAST is residue of a committed write, not
        // recoverable work. The receipt is consumed only on source success
        // (_writeUiCompleteSourceRepairRefs), the native half precommitted
        // before the checkpoint existed, and the checkpoint sets updated_at
        // EQUAL to its own stamp — so a STRICTLY newer server updated_at on
        // this row proves a commit landed after this repair began, and the
        // worst a drop can cost is the legacy-source half of a write whose
        // native truth already holds. Held edits are the one thing typed
        // after the badge that never reached any lane; their presence blocks
        // the heal. Unparseable stamps fail closed to the held badge. Found
        // live 2026-08-28: one SMM's card wore the badge for a day because
        // nothing could ever clear a superseded checkpoint.
        if (!post || !post._writeUiRetrySourceAt) return false;
        if (Object.keys(post._writeUiHeldSourceEdits || {}).length) return false;
        const stamp = Date.parse(String(post._writeUiRetrySourceAt));
        const server = Date.parse(String(post.updated_at || ''));
        return Number.isFinite(stamp) && Number.isFinite(server) && server > stamp;
    }
    function _writeUiClearSupersededSourceRepair(post) {
        delete post._writeUiRetryEdits;
        delete post._writeUiHeldSourceEdits;
        delete post._writeUiRetrySourceAt;
        delete post._writeUiRetryPrincipal;
        delete post._writeUiRepairRefs;
        delete post._writeUiPrecommittedNative;
        /* Superseded means the server row is strictly newer than this
           checkpoint, so the committed write landed. Any save error still on
           the card came from the failed step that checkpoint was covering
           (e.g. "HTTP 503" from a committed-then-failed card save), so it goes
           too. Keeping it, once the checkpoint was gone, turned "Saved,
           syncing" into a false "Save failed" (live 2026-09-23). */
        if (post._saveError) delete post._saveError;
    }
    function _writeUiResumeSourceRepairs() {
        _writeUiLegacyReconcileCommittedTombstones();
        if (!_writeUiHasCredential()) return Promise.resolve();
        const principal = _writeUiPrincipalKey();
        const tasks = [];
        const journal = _writeUiRepairGroups(principal);
        const journalCardKeys = new Set(journal.groups.map(group => group.surface + '|' + group.post_id));
        // Healing requires a FULLY READABLE journal (Codex P2 on #1174): with
        // unreadable rows present, "no receipt found" does not mean "receipt
        // consumed" — a receipt for this card may sit among the rows that
        // failed to parse, and dropping the checkpoint would destroy the
        // replay those rows still represent. The consumed-receipt signature
        // is a readable journal with zero rows for the card.
        const journalUnreadable = Number(journal.unknown || 0) > 0;
        journal.groups.forEach(group => tasks.push(_writeUiReplayJournalGroup(group, principal)));
        // A display-cache checkpoint without its exact journal receipt can be
        // left behind by a crash between source success and cache cleanup. It
        // is not proof of a native commit and must never auto-apply stale data.
        // A SUPERSEDED one (see _writeUiSourceRepairSuperseded) is healed;
        // anything else is retained for diagnostics/manual review, and only
        // journal groups replay. Healing must go through the cache writer's
        // clearRepairIds path — a plain write re-injects the prior repair copy.
        if (typeof calState !== 'undefined' && calState && Array.isArray(calState.posts)) {
            const healedIds = [];
            calState.posts.forEach(post => {
                if (!post || !post.id || !post._writeUiRetrySourceAt || _calSaveInFlight[post.id]
                    || journalCardKeys.has('calendar|' + post.id)
                    || !principal || post._writeUiRetryPrincipal !== principal) return;
                if (!journalUnreadable && _writeUiSourceRepairSuperseded(post)) {
                    _writeUiClearSupersededSourceRepair(post);
                    healedIds.push(post.id);
                    _writeUiQueueDiagnostic('calendar', 'cache_only_repair_superseded', { kind: 'source-repair' });
                    return;
                }
                post._saveError = 'Source repair receipt missing; explicit review required';
                _writeUiQueueDiagnostic('calendar', 'cache_only_repair_held', { kind: 'source-repair' });
            });
            if (healedIds.length) {
                try { _calCacheWrite(calClientSlug(calState.client), calState.posts, { clearRepairIds: healedIds }); } catch (e) {}
                // Repaint so a "Saved, syncing" chip on a healed card settles
                // to saved instead of waiting for an unrelated render.
                try { _calRenderBody({ preserveScroll: true }); } catch (e) {}
            }
        }
        if (typeof sxrState !== 'undefined' && sxrState && Array.isArray(sxrState.posts)) {
            const healedIds = [];
            sxrState.posts.forEach(post => {
                if (!post || !post.id || !post._writeUiRetrySourceAt || _sxrSaveInFlight[post.id]
                    || journalCardKeys.has('sxr|' + post.id)
                    || !principal || post._writeUiRetryPrincipal !== principal) return;
                if (!journalUnreadable && _writeUiSourceRepairSuperseded(post)) {
                    _writeUiClearSupersededSourceRepair(post);
                    healedIds.push(post.id);
                    _writeUiQueueDiagnostic('sxr', 'cache_only_repair_superseded', { kind: 'source-repair' });
                    return;
                }
                post._saveError = 'Source repair receipt missing; explicit review required';
                _writeUiQueueDiagnostic('sxr', 'cache_only_repair_held', { kind: 'source-repair' });
            });
            if (healedIds.length) {
                try { _sxrCacheWrite(sxrClientSlug(sxrState.client), sxrState.posts, { clearRepairIds: healedIds }); } catch (e) {}
            }
        }
        return Promise.all(tasks);
    }
    function _writeUiStoredSourceRepairState() {
        const seen = new Set();
        let unknown = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i) || '';
            if (!(key.indexOf(CAL_CACHE_KEY_PREFIX) === 0 || key.indexOf(SXR_CACHE_PREFIX) === 0)) continue;
            try {
                const parsed = JSON.parse(localStorage.getItem(key) || '{}');
                if (!parsed || !Array.isArray(parsed.posts)) { unknown++; continue; }
                (Array.isArray(parsed.posts) ? parsed.posts : []).forEach(post => {
                    if (post && post.id && post._writeUiRetrySourceAt) seen.add(key + '|' + post.id);
                });
            } catch (e) { unknown++; }
        }
        try {
            const raw = localStorage.getItem(KASPER_CACHE_KEY);
            if (raw) {
                const kasper = JSON.parse(raw);
                if (!kasper || !Array.isArray(kasper.items) || !Array.isArray(kasper.sxrRepairs)) unknown++;
                else {
                    kasper.items.forEach(item => {
                        if (item && item.post && item.post.id && item.post._writeUiRetrySourceAt) seen.add('kasper|' + item.post.id);
                    });
                    kasper.sxrRepairs.forEach(repair => {
                        if (repair && repair.id) seen.add('kasper-sxr|' + repair.id);
                    });
                }
            }
        } catch (e) { unknown++; }
        const journal = _writeUiRepairJournalRead();
        journal.rows.forEach(row => seen.add('journal|' + row.surface + '|' + row.client_slug + '|' + row.post_id));
        unknown += journal.unknown;
        return { count: seen.size, unknown };
    }
    function _writeUiStoredSourceRepairCount() { return _writeUiStoredSourceRepairState().count; }
    function _writeUiStoredQueueUnknownCount() {
        let unknown = 0;
        const arrayKeys = [LINEAR_OUTBOX_KEY, SXR_LINEAR_OUTBOX_KEY, CAL_CARD_JOBS_KEY, WRITE_UI_LEGACY_QUARANTINE_KEY];
        arrayKeys.forEach(key => {
            try {
                const raw = localStorage.getItem(key);
                if (raw && !Array.isArray(JSON.parse(raw))) unknown++;
            } catch (e) { unknown++; }
        });
        try {
            const raw = localStorage.getItem(NATIVE_INTAKE_PENDING_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (!parsed || !parsed.payload || !_linearIntakeJobId(parsed)) unknown++;
            }
        } catch (e) { unknown++; }
        return unknown;
    }
    let _writeUiLegacyResumePromise = null;
    let _writeUiLegacyResumeActiveOwnerKey = '';
    /* THE PUBLIC SUBMISSION LINK NEVER RETRIED (owner incident 2026-09-28).
       That link (/intake) has no staff sign-in and is not a client share
       link, so the resume owner below is null and every retry was skipped:
       a submission saved there after a dropped connection or a refused write
       sat in the browser forever, was never struck off, and blocked every
       later, different submit. Its saved work is retried here on page load and
       when the connection returns. Only jobs made on this link (no staff actor)
       are retried; a staff job still waits for its own staff sign-in. */
    function _writeUiResumePublicIntake(reason) {
        if (['startup', 'resume', 'online'].indexOf(String(reason || '')) < 0) return Promise.resolve({ deferred: false });
        const job = _linearIntakeRead();
        const holdResume = typeof _linearResumeSubmissionHold === 'function'
            ? _linearResumeSubmissionHold(reason === 'online' ? 'resume' : reason).catch(() => {})
            : Promise.resolve();
        const publicJob = job && String(job.payload && job.payload.surface || '') === 'submission'
            && !(job.context && job.context.initiating_actor_id);
        const nativeResume = publicJob
            ? _resumeNativeIntakeJob(reason).then(result => {
                if (result && result.native_committed === true) {
                    try { showNotify('Saved submission sent', 'A submission saved in this browser earlier has now been created.'); } catch (e) {}
                }
            }).catch(() => {})
            : Promise.resolve();
        return Promise.all([holdResume, nativeResume]).then(() => {
            try { _linearRefreshSavedBox(); } catch (e) {}
            return { deferred: false };
        });
    }
    function _writeUiResumeLegacyQueues(reason, clientEntryRun) {
        const owner = _writeUiLegacyResumeOwner(clientEntryRun);
        // typeof: harnesses extract this function without the boot flag.
        if (!owner && typeof _isIntake !== 'undefined' && _isIntake) return _writeUiResumePublicIntake(reason);
        if (!_writeUiLegacyResumeOwnerCurrent(owner)) {
            return Promise.resolve({ deferred: true });
        }
        const ownerKey = _writeUiLegacyResumeOwnerKey(owner);
        if (_writeUiLegacyResumePromise && _writeUiLegacyResumeActiveOwnerKey === ownerKey) {
            return _writeUiLegacyResumePromise;
        }
        const tracked = (async () => {
            if (!_writeUiLegacyResumeOwnerCurrent(owner)) return { deferred: true };
            // Resolve the client allowlist before classifying identified retry
            // debt. Legacy n8n retries do not depend on Linear authority, so a
            // prod_authority read outage must not strand non-enrolled clients.
            // Heal, not just prime (item 70): a boot whose flag read timed out
            // is stuck dark for the life of the page otherwise, and post-flip
            // the dark lane swallows every write while the screen goes green.
            await _writeUiHealRerouteFlag();
            if (!_writeUiLegacyResumeOwnerCurrent(owner)) return { deferred: true };
            const submissionHoldResume = typeof _linearResumeSubmissionHold === 'function'
                ? _linearResumeSubmissionHold(reason || 'resume').catch(() => {})
                : Promise.resolve();
            /* Shed the retired legacy rows first (OPEN_REPAIRS 239). It has to
               happen HERE rather than inside the drains: the owned-debt tests
               below read through `_writeUiLegacyWithoutRetired`, so a queue
               holding nothing but retired rows looks empty, no drain is
               started, and the rows would sit in storage forever. This runs on
               every resume trigger, takes the surface mutation lock itself and
               is a no-op once a browser has shed its own. */
            await Promise.all([
                _writeUiLegacyShedRetired('calendar'),
                _writeUiLegacyShedRetired('sxr'),
            ]);
            if (!_writeUiLegacyResumeOwnerCurrent(owner)) return { deferred: true };
            const calendarHasOwnedDebt = _linearOutboxRead()
                .some(item => _writeUiLegacyItemOwnedBy(item, owner));
            const sxrHasOwnedDebt = _sxrLinearOutboxRead()
                .some(item => _writeUiLegacyItemOwnedBy(item, owner));
            if (owner.kind === 'client') {
                await Promise.all([
                    calendarHasOwnedDebt ? _linearOutboxFlush(owner) : Promise.resolve(),
                    sxrHasOwnedDebt ? _sxrLinearOutboxFlush(owner) : Promise.resolve(),
                    submissionHoldResume
                ]);
                return { deferred: !_writeUiLegacyResumeOwnerCurrent(owner) };
            }
            _writeUiExpireV1Caches();
            if (!_writeUiLegacyResumeOwnerCurrent(owner)) return { deferred: true };
            const nativeIntakeResume = _linearIntakeRead()
                ? _resumeNativeIntakeJob(reason || 'resume').catch(() => {})
                : Promise.resolve();
            const linearQueueResume = Promise.all([
                calendarHasOwnedDebt ? _linearOutboxFlush(owner) : Promise.resolve(),
                sxrHasOwnedDebt ? _sxrLinearOutboxFlush(owner) : Promise.resolve()
            ]);
            const authority = await _writeUiRefreshAuthority();
            if (!_writeUiLegacyResumeOwnerCurrent(owner)) {
                await Promise.all([linearQueueResume, nativeIntakeResume]);
                return { deferred: true };
            }
            if (!authority) {
                await Promise.all([linearQueueResume, nativeIntakeResume]);
                return { deferred: false };
            }
            _writeUiLegacyHydrateConfirmedCacheAfterAuthority();
            _calPruneLinearMetaForAuthority();
            _calHydrateLinearMeta();
            // OPEN_REPAIRS item 59: this is the one path that learns of a
            // freshly read authority value (boot, and every later
            // focus/visibility/online/timer re-check). Re-render the grid
            // that renders the Linear link seal from it, but only when the
            // value is new information -- comparing against the last value
            // it was rendered under, not merely that authority is known --
            // so the routine re-checks above stay a no-op render-wise.
            //
            // ONLY the currently active surface, gated on currentNav, and
            // never over an edit in progress.
            //
            // CORRECTED 2026-08-30. An earlier revision of this comment said
            // the unconditional version broke the Production tab by rewriting
            // hidden calendar DOM underneath it. That is not true and the repo
            // already disproves it twice: navTo replaces the whole content
            // element, so calBody does not survive a move to Production, and
            // both renderers open with an early return when their body element
            // is absent -- the unconditional call was a no-op there, not a
            // clobber. The CI failure it was blamed for is OPEN_REPAIRS item
            // 60, proven base-branch red on a clean worktree of main. The gate
            // stays because scoping a side effect to the visible surface is
            // right on its own merits and matches what the rest of the file
            // does, NOT because it repaired that failure.
            //
            // The busy check is the file-wide rule for a BACKGROUND repaint:
            // both renderers replace innerHTML, which drops a focused input,
            // an open status menu and the transient inline link input. Defer
            // to the pending-render lane instead, exactly as the link-adopt
            // path above does.
            {
                const authoritySig = JSON.stringify(authority);
                if (authoritySig !== _writeUiLastRenderedAuthoritySig) {
                    _writeUiSetLastRenderedAuthoritySig(authoritySig);
                    const activeNav = typeof currentNav !== 'undefined' ? currentNav : null;
                    if (activeNav === 'calendar' && typeof _calRenderBody === 'function') {
                        if (typeof _calIsCalBusy === 'function' && _calIsCalBusy()) {
                            _calSetPendingBackgroundRender(true);
                            if (typeof _calSchedulePendingRender === 'function') _calSchedulePendingRender();
                        } else {
                            _calRenderBody({ preserveScroll: true, skipIfUnchanged: true });
                        }
                    }
                    if (activeNav === 'sample-reviews' && typeof _sxrRenderBody === 'function') {
                        if (typeof _sxrIsBusy === 'function' && _sxrIsBusy()) {
                            _sxrSetPendingBackgroundRender(true);
                            if (typeof _sxrSchedulePendingRender === 'function') _sxrSchedulePendingRender();
                        } else {
                            _sxrRenderBody({ preserveScroll: true });
                        }
                    }
                }
            }
            await Promise.all([
                linearQueueResume,
                _calCardJobsRead().length ? _resumePendingCalCardJobs(authority) : Promise.resolve(),
                _writeUiResumeSourceRepairs(),
                typeof _kasperResumeSourceRepairs === 'function' ? _kasperResumeSourceRepairs() : Promise.resolve(),
                typeof _sxrKasperResumeSourceRepairs === 'function' ? _sxrKasperResumeSourceRepairs() : Promise.resolve(),
                nativeIntakeResume,
                submissionHoldResume
            ]);
            return { deferred: !_writeUiLegacyResumeOwnerCurrent(owner) };
        })().finally(() => {
            if (_writeUiLegacyResumePromise === tracked) {
                _writeUiLegacyResumePromise = null;
                _writeUiLegacyResumeActiveOwnerKey = '';
            }
        });
        _writeUiLegacyResumeActiveOwnerKey = ownerKey;
        _writeUiLegacyResumePromise = tracked;
        return tracked;
    }
    window.addEventListener('focus', () => { _writeUiResumeLegacyQueues('focus'); });
    window.addEventListener('pageshow', () => { _writeUiResumeLegacyQueues('resume'); });
    window.addEventListener('online', () => { _writeUiResumeLegacyQueues('online'); });
    window.addEventListener('pagehide', () => {
        const owner = _writeUiLegacyResumeOwner();
        if (!_writeUiLegacyResumeOwnerCurrent(owner)) return;
        const calendarCount = _linearOutboxRead()
            .filter(item => _writeUiLegacyItemOwnedBy(item, owner)).length;
        const sxrCount = _sxrLinearOutboxRead()
            .filter(item => _writeUiLegacyItemOwnedBy(item, owner)).length;
        const staffSuffix = owner.kind === 'staff'
            ? '|cards:' + _calCardJobsRead().length
                + '|native-intake:' + (_linearIntakeRead() ? 1 : 0)
                + '|source-repairs:' + _writeUiStoredSourceRepairCount()
            : '';
        _writeUiQueueDiagnostic('lifecycle', 'pagehide_snapshot', {
            kind: 'calendar:' + calendarCount
                + '|sxr:' + sxrCount
                + staffSuffix
        });
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') _writeUiResumeLegacyQueues('visible'); });
    setInterval(() => { _writeUiResumeLegacyQueues('timer'); }, 60 * 1000);
    _writeUiResumeLegacyQueues('startup');
    window.peekWriteUiLegacyQueueState = function () {
        const repairState = _writeUiStoredSourceRepairState();
        const unknown = repairState.unknown + _writeUiStoredQueueUnknownCount();
        return {
            app_epoch: 2,
            observed_at: new Date().toISOString(),
            calendar_linear: _linearOutboxRead().length,
            sxr_linear: _sxrLinearOutboxRead().length,
            submission_cards: _calCardJobsRead().length,
            native_intake: _linearIntakeRead() ? 1 : 0,
            source_repairs: repairState.count,
            legacy_quarantine: _writeUiLegacyQuarantineRead().length,
            unknown_records: unknown,
            drain_state: unknown ? 'unknown' : 'observed'
        };
    };
    /* `_sxrSyncStatusFromLinear` (link-time status adoption through the
       `linear-subissues` webhook) was removed 2026-09-23 (B2). Its callers
       check `typeof` first, so they are now no-ops; the link still saves. */

    /* ── Realtime subscription (channel sxr-<slug> on sample_reviews) ── */
    let _sxrV2ClientObj = null, _sxrV2ClientPromise = null;
    function _sxrV2Client() {
        if (!_sxrReady()) return Promise.resolve(null);
        if (_sxrV2ClientObj) return Promise.resolve(_sxrV2ClientObj);
        if (_sxrV2ClientPromise) return _sxrV2ClientPromise;
        _sxrV2ClientPromise = _sxrV2LoadLib().then(lib => {
            if (!lib || !lib.createClient) return null;
            _sxrV2ClientObj = lib.createClient(CAL_SUPABASE_URL, CAL_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { params: { eventsPerSecond: 5 } } });
            return _sxrV2ClientObj;
        }).catch(e => { console.warn('[Samples] supabase init failed', e); _sxrV2ClientPromise = null; return null; });
        return _sxrV2ClientPromise;
    }
    let _sxrV2Channel = null, _sxrV2SubSlug = null, _sxrV2RtTimer = null, _sxrV2RtPending = false, _sxrV2SubscribedOnce = false;
    const SXR_RT_DEBOUNCE_MS = 350, SXR_RT_SELF_ECHO_MS = 4000;
    async function _sxrV2EnsureSubscribed(slug) {
        if (!_sxrReady() || !slug) return;
        if (_sxrV2SubSlug === slug && _sxrV2Channel) return;
        _sxrV2Teardown();
        const client = await _sxrV2Client();
        if (!client) return;
        if (sxrClientSlug(sxrState.client) !== slug) return;
        _sxrV2SubSlug = slug; _sxrV2SubscribedOnce = false;
        try {
            _sxrV2Channel = client.channel(SXR_RT_CHANNEL_PREFIX + slug)
                .on('postgres_changes', { event: '*', schema: 'public', table: SXR_TABLE, filter: 'client=eq.' + slug }, () => _sxrV2OnRealtimeChange(slug))
                .subscribe((status) => { if (status === 'SUBSCRIBED') { if (_sxrV2SubscribedOnce) _sxrV2OnRealtimeChange(slug); _sxrV2SubscribedOnce = true; } });
        } catch (e) { _sxrV2Channel = null; _sxrV2SubSlug = null; }
    }
    function _sxrV2OnRealtimeChange(slug) {
        if (sxrClientSlug(sxrState.client) !== slug) return;
        if (_sxrV2RtTimer) clearTimeout(_sxrV2RtTimer);
        _sxrV2RtTimer = setTimeout(function tick() {
            _sxrV2RtTimer = null;
            if (sxrClientSlug(sxrState.client) !== slug) return;
            const sinceLocal = Date.now() - _sxrLastLocalWriteAt;
            if (sinceLocal < SXR_RT_SELF_ECHO_MS) { _sxrV2RtTimer = setTimeout(tick, SXR_RT_SELF_ECHO_MS - sinceLocal); return; }   // self-echo
            if (_sxrBgLoadInFlight || sxrState.loading) { _sxrV2RtPending = true; return; }
            loadSxrCards({ background: true });
        }, SXR_RT_DEBOUNCE_MS);
    }
    function _sxrV2DrainPending(slug) { if (_sxrV2RtPending) { _sxrV2RtPending = false; _sxrV2OnRealtimeChange(slug); } }
    function _sxrV2Teardown() {
        _sxrAbortActiveLoad();
        if (_sxrV2RtTimer) { clearTimeout(_sxrV2RtTimer); _sxrV2RtTimer = null; }
        if (_sxrV2Channel) { try { if (_sxrV2ClientObj && typeof _sxrV2ClientObj.removeChannel === 'function') _sxrV2ClientObj.removeChannel(_sxrV2Channel); else if (typeof _sxrV2Channel.unsubscribe === 'function') _sxrV2Channel.unsubscribe(); } catch (e) {} }
        _sxrV2Channel = null; _sxrV2SubSlug = null;
    }
    window.sxrV2Status = function () { return { flag: _sxrEnabled(), ready: _sxrReady(), keySet: !!CAL_SUPABASE_ANON_KEY, subscribed: !!_sxrV2Channel, slug: _sxrV2SubSlug }; };

    /* ── Kasper-queue realtime (channel kasper-sxr on sample_reviews, cross-client) ──
       Mirror of the calendar's _kasperV2EnsureSubscribed (channel 'kasper-cal' on
       calendar_posts). The samples Kasper queue spans EVERY client, so a single
       UNFILTERED channel pushes a throttled _sxrKasperLoadQueue when any
       sample_reviews row changes — so a card the SMM sends to Kasper, or a
       client/SMM edit, surfaces WITHOUT a manual Refresh (the "Kasper review doesn't
       update unless I refresh" fix). Push-only — an idle tab makes no calls. The
       per-slug sxr-<slug> channel (Samples main review tab) is a SEPARATE concern;
       this reuses the shared _sxrV2Client builder but its own channel + state. */
    let _sxrKasperV2Channel = null, _sxrKasperV2RtTimer = null;
    function _sxrKasperViewBusy() {
        // Settle window after a local Kasper/SMM write so our OWN echo doesn't trigger
        // a rebuild that reloads thumbnails / drops his caret (mirrors _kasperViewBusy).
        if (Date.now() - _sxrLastLocalWriteAt < SXR_RT_SELF_ECHO_MS) return true;
        const sv = _sxrKasperState.saving || {};
        for (const k in sv) { if (sv[k]) return true; }                       // a save in flight
        // A stray non-empty draft no longer blocks a peer's live update. Drafts
        // live in _sxrKasperState.drafts and are re-read when a card rebuilds,
        // and _svPreserveFocus keeps the caret, so a background reload is safe
        // even with a half-typed comment sitting in the queue. Blocking on ANY
        // draft left the whole cross-client queue stale until every draft was
        // cleared — a teammate's change (e.g. an SMM edit) never surfaced.
        const a = document.activeElement;
        if (a && a.tagName === 'TEXTAREA' && a.closest && a.closest('#kasperContent')) return true;   // actively typing → brief defer, re-armed and serviced on blur
        return false;
    }
    async function _sxrKasperV2EnsureSubscribed() {
        if (!_sxrReady() || _sxrKasperV2Channel) return;
        const client = await _sxrV2Client();
        if (!client || _sxrKasperV2Channel) return;   // re-check: a teardown / second mount may have raced the lib load
        try {
            _sxrKasperV2Channel = client
                .channel('kasper-sxr')
                .on('postgres_changes', { event: '*', schema: 'public', table: SXR_TABLE }, () => {
                    if (_sxrKasperV2RtTimer) clearTimeout(_sxrKasperV2RtTimer);
                    _sxrKasperV2RtTimer = setTimeout(function tick() {
                        _sxrKasperV2RtTimer = null;
                        // Re-arm while Kasper is mid-review; a teammate's change while
                        // he's idle still comes through (matches the cal's 2s re-arm).
                        if (_sxrKasperViewBusy()) { _sxrKasperV2RtTimer = setTimeout(tick, 2000); return; }
                        if (typeof _sxrKasperLoadQueue === 'function') _sxrKasperLoadQueue();
                    }, 1500);
                })
                .subscribe();
        } catch (e) {
            console.warn('[Samples Kasper] realtime subscribe failed', e);
            _sxrKasperV2Channel = null;
        }
    }
    function _sxrKasperV2Teardown() {
        if (_sxrKasperV2RtTimer) { clearTimeout(_sxrKasperV2RtTimer); _sxrKasperV2RtTimer = null; }
        if (_sxrKasperV2Channel) {
            try {
                if (_sxrV2ClientObj && typeof _sxrV2ClientObj.removeChannel === 'function') _sxrV2ClientObj.removeChannel(_sxrKasperV2Channel);
                else if (typeof _sxrKasperV2Channel.unsubscribe === 'function') _sxrKasperV2Channel.unsubscribe();
            } catch (e) {}
        }
        _sxrKasperV2Channel = null;
    }

    /* Freshness wiring is installed only when the current staff preference or
       verified Review capability enables SXR. Before strict client verification
       this adds no listeners and touches no client state. */
    let _sxrFreshnessWired = false;
    function _sxrEnsureFreshnessWiring() {
        if (_sxrFreshnessWired || !_sxrEnabled()) return;
        _sxrFreshnessWired = true;
        document.addEventListener('focusout', () => { setTimeout(_sxrMaybeRunPendingRender, 60); });
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && sxrState.client) _sxrFlushAllPending(); });
        window.addEventListener('pagehide', () => { if (sxrState.client) _sxrFlushAllPending(); });
        window.addEventListener('pageshow', _sxrRefreshOnReturn);
        document.addEventListener('visibilitychange', _sxrRefreshOnReturn);
        window.addEventListener('focus', _sxrRefreshOnReturn);
    }
    _sxrEnsureFreshnessWiring();

    /* ============================================================
       --- SURFACE 8: the Kasper samples sub-tab (cross-client) ---
       A "Samples" sub-tab on the Kasper page (registered + dispatched via the two
       // SXR_LINE hooks). Loads sample_reviews CROSS-CLIENT (Supabase REST, no
       client filter) for components at Kasper Approval, renders per-component review
       panels, and persists each card with ITS OWN client slug (never sxrState /
       _kasperPersistPost). Kasper: Approve -> Client Approval · Approve-after-tweaks
       -> back to SMM + pre-clear (kasper_approved_after_tweaks) · Request change ->
       Tweaks Needed + a kasper-role tweak comment. Pushes status/comments to Linear.
       v1 omits URGENT + the Replies/Messages union (per SAMPLES_PARITY_LOG M5a).
       ============================================================ */
    const _sxrKasperState = { items: [], history: [], loading: false, reloadPending: false, writeGen: 0, loaded: false, error: false, expanded: Object.create(null), drafts: Object.create(null), saving: Object.create(null), touched: Object.create(null), dismissed: Object.create(null), closed: Object.create(null), historyCollapsed: false };
    // Per-component Kasper-queue visibility (mirror of _calCompKasperVisible):
    //  · an UNLINKED thumbnail is not reviewable — gated out so a junk
    //    'Kasper Approval' graphic_status can't surface a panel nobody can act on;
    //  · a component still shows while at Tweaks Needed IF Kasper has an
    //    unresolved tweak on it (the re-review hand-off).
    function _sxrCompHasUnresolvedKasperTweak(post, comp) {
        const list = _sxrCommentsFor(post, comp);
        if (!Array.isArray(list)) return false;
        return list.some(x => x && x.role === 'kasper' && _sxrMsgIsTweak(x) && !x.done && !x.deleted);
    }
    function _sxrCompKasperVisible(post, comp) {
        if (comp === 'graphic' && !_calCompLinked(post, comp)) return false;
        const cs = _sxrNormStatus(post[comp + '_status'] || '');
        if (cs === 'Kasper Approval') return true;
        if (cs === 'Tweaks Needed' && _sxrCompHasUnresolvedKasperTweak(post, comp)) return true;
        return false;
    }
    function _sxrPostKasperVisible(post) {
        return SXR_REVIEW_COMPONENTS.some(c => _sxrCompKasperVisible(post, c));
    }
    function _sxrKasperFindItem(pid) { return (_sxrKasperState.items || []).find(it => it && it.post && it.post.id === pid); }
    // ── Decision-flow helpers (clones of the calendar _kasper* equivalents) ──
    // A component still at Kasper Approval = an undecided component; an unlinked
    // thumbnail never blocks "Finish reviewing" (it can't be acted on).
    function _sxrKasperUndecidedComps(post) {
        return SXR_REVIEW_COMPONENTS.filter(c =>
            !(c === 'graphic' && !_calCompLinked(post, c))
            && _sxrNormStatus(post[c + '_status'] || '') === 'Kasper Approval');
    }
    function _sxrKasperPostHasUnresolvedKasperTweak(post) {
        return SXR_REVIEW_COMPONENTS.some(c => _sxrCompHasUnresolvedKasperTweak(post, c));
    }
    function _sxrKasperLatestMsgAt(post) {
        let latest = '';
        for (const c of SXR_REVIEW_COMPONENTS) for (const m of _sxrCommentsFor(post, c)) {
            if (m && m.created_at && String(m.created_at) > latest) latest = String(m.created_at);
        }
        return latest;
    }
    // Finished = handed to the SMM (kasper_finished_at stamp or local dismiss).
    // Re-surfaces on a genuine fresh ask: an actionable component back at Kasper
    // Approval (server-confirmed), or a message after the finish stamp.
    function _sxrKasperIsFinished(post) {
        if (!post) return false;
        const stampedAt = String(post.kasper_finished_at || '');
        const localFin = !!(_sxrKasperState.dismissed && _sxrKasperState.dismissed[post.id]);
        if (!stampedAt && !localFin) return false;
        // Once finished, the card STAYS in "Tweaks pending" and returns to
        // "Waiting" ONLY when a component is genuinely re-sent to Kasper Approval
        // (undecided). A later message — even a client tweak — must NOT pull it
        // back into his queue: parity with the calendar's _kasperIsFinished, which
        // deliberately removed the reply-resurfaces-it behaviour (the friction of
        // finished cards bouncing back on every comment). See KASPER_REVIEW_GLOBAL_ROLLOUT.
        if (stampedAt && _sxrKasperUndecidedComps(post).length) return false;
        return true;
    }
    function _sxrKasperIsClosed(post) {
        if (!post) return false;
        const closedAt = String(post.kasper_closed_at || '');
        const localClosed = !!(_sxrKasperState.closed && _sxrKasperState.closed[post.id]);
        if (!closedAt && !localClosed) return false;
        if (closedAt) { const latest = _sxrKasperLatestMsgAt(post); if (latest && latest > closedAt) return false; }
        return true;
    }
    // Waiting = he still has a call to make; Tweaks pending = finished + handed off.
    function _sxrKasperPartitionItems(items) {
        // Urgent is a split of waiting, exactly as on the calendar queue, and
        // over the SAME predicate — a sample and a post read as urgent for the
        // same reason, so the two queues can never disagree about a ping.
        const urgent = [], waiting = [], tweaks = [];
        for (const it of items) {
            if (_sxrKasperIsFinished(it.post)) tweaks.push(it);
            else if (_calKasperUrgentActive(it.post)) urgent.push(it);
            else waiting.push(it);
        }
        return { urgent, waiting, tweaks };
    }
    // Approved-history (in-session — a "recently approved" list; clears on reload).
    function _sxrKasperHistoryEntryFromPost(post, client, slug, approvedAt) {
        return { id: post.id, client, slug, name: post.name || 'Untitled', asset_url: String(post.asset_url || ''), thumbnail_url: String(post.thumbnail_url || ''), approvedAt };
    }
    function _sxrKasperRecordHistory(entry) {
        _sxrKasperState.history = [entry].concat((_sxrKasperState.history || []).filter(x => x.id !== entry.id)).slice(0, 60);
    }
    async function _sxrKasperFetchAllSamples() {
        // Same archived exclusion as loadSxrCards — Kasper's queue drops archived
        // rows anyway (see the loop below); fetching them cross-client meant
        // pulling the WHOLE history of every client on each queue refresh.
        const baseUrl = CAL_SUPABASE_URL + '/rest/v1/' + SXR_TABLE + '?select=*&or=(status.is.null,status.neq.Archived)';
        return await _sxrSupabaseFetchAllRows(baseUrl);   // cross-client (no client filter)
    }
    async function _sxrKasperLoadQueue(force) {
        // A refresh asked for while one is in flight must not be dropped: the
        // running fetch may predate the write that triggered this call, which
        // left the queue showing a decided card until the next unrelated reload.
        if (_sxrKasperState.loading) { _sxrKasperState.reloadPending = true; return; }
        _sxrKasperState.reloadPending = false;
        const startGen = _sxrKasperState.writeGen;
        _sxrKasperState.loading = true; _sxrKasperState.error = false;
        if (force) _sxrKasperRenderQueue();
        try {
            // SMM map (cross-client) in parallel — drives the per-card Slack button.
            const [rows, smmMap] = await Promise.all([
                _sxrKasperFetchAllSamples(),
                _kasperLoadSMMMap().catch(() => new Map()),
            ]);
            // A decision made while this read was in flight may not be in it.
            // Drop the rows rather than replace the item the save is still
            // mutating, and read again once this load ends.
            if (_sxrKasperState.writeGen !== startGen || Object.values(_sxrKasperState.saving || {}).some(Boolean)) { _sxrKasperState.reloadPending = true; return; }
            _sxrKasperState.smmByClient = smmMap;
            const items = [];
            const keepDismissed = new Set();
            const repairById = new Map(((_kasperState && _kasperState.sxrRepairs) || []).map(repair => [repair && repair.id, repair]));
            for (const p of (rows || [])) {
                if (!p || String(p.status || '').toLowerCase() === 'archived') continue;
                p.status = _sxrNormStatus(p.status); _sxrMigrateShape(p);
                const repair = repairById.get(p.id);
                if (repair) {
                    Object.assign(p, repair.post || {}, repair.patch || {});
                    p._writeUiKasperRepair = repair;
                    _sxrMigrateShape(p);
                }
                // Membership: anything Kasper can still act on, minus cards he
                // FINISHED (owner decision 2026-09-27: a sample he sent back
                // leaves his queue until the editor sends a new version, which
                // puts a component back at Kasper Approval) and cards he X-closed.
                if (!_sxrPostKasperVisible(p)) continue;
                if (_sxrKasperIsFinished(p)) { keepDismissed.add(p.id); continue; }
                if (_sxrKasperIsClosed(p)) continue;
                const slug = String(p.client || '');
                const client = wlCanonicalClient(slug) || slug;
                items.push({ post: p, slug, client, smm: smmMap.get(wlNormalizeClient(client)) || smmMap.get(slug) || null });
            }
            items.sort((a, b) => String(a.client).localeCompare(String(b.client)));
            // Prune local dismiss/close flags whose card has fully left the queue
            // (so the sets can't grow without bound and a re-routed card reappears).
            const ids = new Set(items.map(it => it.post.id));
            for (const id of Object.keys(_sxrKasperState.dismissed)) if (!ids.has(id) && !keepDismissed.has(id)) delete _sxrKasperState.dismissed[id];
            for (const id of Object.keys(_sxrKasperState.closed)) if (!ids.has(id)) delete _sxrKasperState.closed[id];
            // Preserve expanded / touched-comps across refreshes.
            const prev = new Map((_sxrKasperState.items || []).map(x => [x.post.id, x]));
            for (const it of items) { const old = prev.get(it.post.id); if (old && old._touched) it._touched = old._touched; }
            _sxrKasperState.items = items; _sxrKasperState.loaded = true;
            setTimeout(() => { if (typeof _sxrKasperResumeSourceRepairs === 'function') _sxrKasperResumeSourceRepairs(); }, 0);
        } catch (e) { _sxrKasperState.error = true; }
        finally {
            _sxrKasperState.loading = false; _sxrKasperRenderQueue();
            if (_sxrKasperState.reloadPending) setTimeout(() => _sxrKasperLoadQueue(), 0);
        }
    }
    function _sxrKasperRenderQueue() {
        // Samples are listed in Kasper's Review queue (the separate Samples
        // subtab was removed), so a samples load or decision repaints Review.
        if (typeof _kasperRefreshTabCounts === 'function') _kasperRefreshTabCounts();
        if (!document.getElementById('kasperContent')) return;
        if (typeof _kasperState === 'undefined' || !_kasperState || _kasperState.tab !== 'review') return;
        if (typeof _kasperSamplesMerged === 'function' && _kasperSamplesMerged() && typeof _kasperPaintReview === 'function') _kasperPaintReview();
    }
    function _sxrKasperRenderHistorySection(title) {
        const list = _sxrKasperState.history || [];
        if (!list.length) return '';
        const rows = list.map(e => {
            const thumb = e.thumbnail_url || e.asset_url || '';
            const thumbHtml = thumb ? `<img loading="lazy" src="${_sxrEscAttr(thumb)}" alt="" onerror="this.style.display='none'">` : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 11l3 3 5-5"/></svg>`;
            const t = Date.parse(e.approvedAt); const timeStr = isFinite(t) ? new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
            const videoBtn = e.asset_url ? `<a href="${_sxrEscAttr(e.asset_url)}" target="_blank" rel="noopener">Video</a>` : '';
            return `<div class="kasper-history-row"><div class="kasper-history-thumb">${thumbHtml}</div><div class="kasper-history-main"><div class="kasper-history-line1">${_sxrEsc(e.name)}</div><div class="kasper-history-line2"><span class="kasper-history-client">${_sxrEsc(e.client)}</span>${timeStr ? ' · approved ' + _sxrEsc(timeStr) : ''}</div></div><div class="kasper-history-actions">${videoBtn}</div></div>`;
        }).join('');
        return `<div class="kasper-history-wrap${_sxrKasperState.historyCollapsed ? ' collapsed' : ''}" id="sxrKasperHistoryWrap">
            <div class="kasper-history-head" onclick="_sxrKasperToggleHistory()">
                <span class="kasper-history-title">${_sxrEsc(title || 'Approved history')}</span>
                <span class="kasper-history-count">${list.length}</span>
                <svg class="kasper-history-chev" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5l4 4 4-4"/></svg>
            </div>
            <div class="kasper-history-body"><div class="kasper-history-day">${rows}</div></div>
        </div>`;
    }
    function _sxrKasperToggleHistory() { _sxrKasperState.historyCollapsed = !_sxrKasperState.historyCollapsed; const w = document.getElementById('sxrKasperHistoryWrap'); if (w) w.classList.toggle('collapsed', _sxrKasperState.historyCollapsed); }
    function _sxrKasperRenderCard(item) {
        const p = item.post, pid = p.id;
        const expanded = !!_sxrKasperState.expanded[pid];
        const info = _sxrDeriveThumbInfo(p);
        const thumb = info.url ? _calThumbImgTag(info, '_calOnMiniThumbError') : info.frame ? _sxrMiniLinkBadgeHtml('kcard-thumb-fallback', info.frameKind) : `<span class="kcard-thumb-fallback">${_sxrThumbIconSvg()}</span>`;
        // Full-screen thumbnail zoom on the card strip (mirrors the calendar's
        // kcard-thumb-zoom → _kasperOpenLightbox); _sxrOpenThumbLightbox resolves
        // the Kasper card from _sxrKasperState.items.
        const zoomBtn = info.url ? `<button class="kcard-thumb-zoom" type="button" onclick="event.stopPropagation();_sxrOpenThumbLightbox('${_sxrEscAttr(pid)}')" title="View thumbnail full screen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-8 8M3 21l8-8"/></svg></button>` : '';
        const awaiting = SXR_REVIEW_COMPONENTS.filter(c => _sxrCompKasperVisible(p, c));
        const video = String(p.asset_url || '').trim();
        const watch = video ? `<a class="kcard-watch-btn" href="${_sxrEscAttr(video)}" target="_blank" rel="noopener" onclick="event.stopPropagation();"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l9-5.5z"/></svg>Watch video</a>` : '';
        // "Finish reviewing" — explicit hand-off, enabled only once every component
        // has a decision (a comment doesn't count). Approved → logged history;
        // change requested → handed to SMM (Tweaks pending). Once finished the card
        // shows "Sent to SMM" until a fresh ask resurfaces it.
        const undecided = _sxrKasperUndecidedComps(p);
        const canFinish = undecided.length === 0;
        const isFinished = _sxrKasperIsFinished(p);
        const finishTitle = canFinish
            ? 'Finish reviewing — hand this card to the SMM. Approved components go to the client; change requests move to "Tweaks pending". Nothing is approved unless you approved it.'
            : 'Decide on the ' + undecided.map(c => COMP_LABELS[c]).join(' & ') + ' first — approve it or request a change to finish.';
        const checkIco = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5L6.5 12L13 4.5"/></svg>`;
        const doneBtn = isFinished
            ? `<button type="button" class="kcard-done-btn" disabled title="Finished — these tweaks are with the SMM. This card returns to your queue if they reply or send a component back to you.">${checkIco}Sent to SMM</button>`
            : `<button type="button" class="kcard-done-btn" ${canFinish ? '' : 'disabled'} onclick="event.stopPropagation();_sxrKasperDismiss('${_sxrEscAttr(pid)}')" title="${_sxrEscAttr(finishTitle)}">${checkIco}Finish reviewing</button>`;
        const pillsHtml = undecided.length ? `<span class="kcard-comp-pills" title="Awaiting your decision">${undecided.map(c => `<span class="kcard-comp-pill">${_sxrEsc(COMP_LABELS[c])}</span>`).join('')}</span>` : '';
        // New-message chip — a message Kasper didn't write, on an internal thread,
        // newer than his last look (the SHARED _kasperHasUnreadReply reads the same
        // video_comments/graphic_comments arrays).
        const newMsg = _kasperHasUnreadReply(p) ? '<span class="kcard-newreply-chip">New message</span>' : '';
        /* SMM row. The Slack deep link was removed 2026-08-20 (owner ruling):
           the team moved off Slack to Roam, so the button opened a dead tool,
           and its "not found" fallback asked Kasper to fix a Google Sheet he
           does not own. When the manager is unknown we render NOTHING rather
           than an error he cannot act on. The URGENT ping is a separate n8n
           path (_calUrgentSlackDispatch) and is deliberately untouched. */
        const smm = item.smm;
        const smmHtml = smm && smm.name
            ? `<span class="kcard-smm" onclick="event.stopPropagation();"><span class="kcard-smm-avatar">${_sxrEsc(smm.name.charAt(0).toUpperCase())}</span>${_sxrEsc(smm.name)}</span>`
            : '';
        // URGENT ping (video at Tweaks Needed + linked) — reuses the existing N8N
        // workflow + message via _sxrKasperSendUrgentSlack → _calUrgentSlackDispatch.
        const urgentBtn = _sxrShowUrgent(p, 'video') ? _calUrgentButtonHtml(_sxrEscAttr(pid), '_sxrKasperSendUrgentSlack', p, 'kcard-urgent-btn', true) : '';
        // Say what Kasper still has to do. A part he already sent back (Tweaks
        // Needed) is not waiting on him, so only undecided parts count; once
        // every part is decided, the next step is Finish reviewing.
        const pending = undecided.length
            ? `<span class="kcard-pending"><span class="kcard-pending-strong">${undecided.map(c => _sxrEsc(COMP_LABELS[c])).join(' & ')}</span> awaiting your review</span>`
            : (isFinished ? `<span class="kcard-pending">Sent to SMM — changes pending</span>`
                : `<span class="kcard-pending">All decided · tap <span class="kcard-pending-strong">Finish reviewing</span> to hand it to the SMM</span>`);
        const body = expanded
            ? (awaiting.length
                ? `<div class="cal-review-body" style="grid-template-columns:repeat(${awaiting.length},minmax(0,1fr));" onclick="event.stopPropagation();">${awaiting.map(c => _sxrKasperPanelHtml(item, c)).join('')}</div>`
                : `<div class="cal-review-body" onclick="event.stopPropagation();"><div class="cal-empty" style="grid-column:1/-1;padding:12px;">Nothing pending your approval on this card.</div></div>`)
            : '';
        return `<div class="kcard cal-review-card${expanded ? ' expanded' : ''}" data-sxr-kasper-pid="${_sxrEscAttr(pid)}">
            <button class="kcard-close-btn" type="button" onclick="event.stopPropagation();_sxrKasperClose('${_sxrEscAttr(pid)}')" title="Hide this card. It comes back if someone posts a new message on it." aria-label="Close card"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7"/></svg></button>
            <div class="kcard-strip" onclick="_sxrKasperToggleCard('${_sxrEscAttr(pid)}')">
                <div class="kcard-thumb">${thumb}${zoomBtn}</div>
                <div class="kcard-main">
                    <div class="kcard-line1"><span class="kcard-sample-chip">Sample</span><span class="kcard-client">${_sxrEsc(item.client)}</span><span class="kcard-dot">·</span>${pending}${pillsHtml}${newMsg}</div>
                    <div class="kcard-title">${_sxrEsc(p.name || 'Untitled')}</div>
                    <div class="kcard-meta-row">${smmHtml}</div>
                </div>
                <div class="kcard-actions" onclick="event.stopPropagation();">
                    ${urgentBtn}
                    ${doneBtn}
                    ${watch}
                    <button class="kcard-expand-btn" type="button" onclick="_sxrKasperToggleCard('${_sxrEscAttr(pid)}')" aria-label="${expanded ? 'Collapse card' : 'Expand card'}"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5l4 4 4-4"/></svg></button>
                </div>
            </div>
            ${body}
        </div>`;
    }
    function _sxrKasperPanelHtml(item, comp) {
        const p = item.post, pid = p.id, escId = _sxrEscAttr(pid), escComp = _sxrEscAttr(comp);
        const key = pid + '|' + comp;
        const draft = _sxrKasperState.drafts[key] || '';
        const saving = !!_sxrKasperState.saving[key];
        const hasDraft = !!draft.trim();
        const preview = _sxrReviewComponentPreview(p, comp);
        const comments = _sxrCommentsForView(p, comp);
        const checkIco = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8.5L6.5 12L13 4"/></svg>`;
        const sendIco = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8h11M9 3.5L13.5 8L9 12.5"/></svg>`;
        // State machine mirror of the calendar hero panel: once a component is at
        // Tweaks Needed the framing is "Changes requested" and Approve is SUPPRESSED
        // (he already sent it back); only Comment / Approve-after-tweaks / Request
        // stay. A "Comment" is an internal-only note that does NOT change status.
        const subStatus = _sxrNormStatus(p[comp + '_status'] || '');
        const inTweaks = subStatus === 'Tweaks Needed';
        const showApprove = !inTweaks;
        const stateLabel = inTweaks ? 'Changes requested' : '';
        const placeholder = inTweaks ? 'Anything else to add?' : 'Describe the change you need…';
        const commentIco = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>`;
        const thread = comments.length ? comments.map(c => { const author = c.author || (c.role === 'client' ? 'Client' : c.role === 'kasper' ? 'Kasper' : 'SMM'); return `<div class="cal-review-comment cal-cm-${c.role || 'smm'}${c.parent_id ? ' is-reply' : ''}${c.done ? ' is-resolved' : ''}"><div class="cal-review-comment-head"><strong>${_sxrEsc(author)}</strong><span class="cal-review-comment-time">${_sxrEsc(_sxrFmtCommentTime(c.created_at))}</span>${c.done ? '<span class="cal-review-resolved-pill">Resolved</span>' : ''}</div><div class="cal-review-comment-body">${_sxrEsc(c.body || '')}</div></div>`; }).join('') : `<div class="cal-review-comment-empty">No comments yet.</div>`;
        return `<div class="cal-review-panel" data-sxr-kasper-comp="${escComp}" data-state="${inTweaks ? 'tweaks' : 'pending'}">
            <div class="cal-review-panel-head"><span class="cal-review-panel-title">${_sxrEsc(COMP_LABELS[comp])}</span>${stateLabel ? `<span class="cal-review-panel-status">${_sxrEsc(stateLabel)}</span>` : ''}</div>
            <div class="cal-review-panel-preview">${preview}</div>
            ${showApprove ? `<button type="button" class="cal-review-approve-btn cal-review-approve-main" ${(!saving && !hasDraft) ? '' : 'disabled'} data-idle-title="" title="${hasDraft ? _sxrEscAttr(REVIEW_APPROVE_DRAFT_TITLE) : ''}" onclick="_sxrKasperApproveComp('${escId}','${escComp}')">${checkIco}<span class="cal-ap-verb">${saving ? 'Saving…' : 'Approve'}</span>${saving ? '' : '<span class="cal-ap-route">Client</span>'}</button>` : ''}
            <div class="cal-review-panel-compose">
                <textarea class="cal-review-textarea" placeholder="${_sxrEscAttr(placeholder)}" oninput="_sxrKasperOnDraftInput(this,'${escId}','${escComp}')">${_sxrEsc(draft)}</textarea>
                <div class="cal-review-tweak-actions">
                    <button type="button" class="cal-review-comment-btn" ${(!saving && hasDraft) ? '' : 'disabled'} onclick="_sxrKasperAddCommentComp('${escId}','${escComp}')" title="Leave a comment or question — internal only. Doesn't change the status or notify the editor; the card stays awaiting your approval.">${commentIco}Comment</button>
                    <button type="button" class="cal-review-aat-btn" ${(!saving && hasDraft) ? '' : 'disabled'} onclick="_sxrKasperApproveAfterTweaksComp('${escId}','${escComp}')" title="Send these tweaks and pre-clear for the client — the editor fixes it, then it goes straight to the client (no Kasper re-review)">${checkIco}Approve after tweaks</button>
                    <button type="button" class="cal-review-tweak-btn" ${(!saving && hasDraft) ? '' : 'disabled'} onclick="_sxrKasperRequestTweakComp('${escId}','${escComp}')">${sendIco}Request change</button>
                </div>
            </div>
            <div class="cal-review-thread">${thread}</div>
        </div>`;
    }
    function _sxrKasperToggleCard(pid) { _sxrKasperState.expanded[pid] = !_sxrKasperState.expanded[pid]; _sxrKasperRepaint(pid); }
    function _sxrKasperRepaint(pid) {
        const it = _sxrKasperFindItem(pid); if (!it) return;
        const sel = (window.CSS && CSS.escape) ? CSS.escape(pid) : pid;
        const el = document.querySelector(`[data-sxr-kasper-pid="${sel}"]`); if (!el) return;
        // Preserve the caret: if Kasper is typing a tweak/comment in this card
        // when an after-save repaint fires, a bare replaceWith destroys that
        // textarea and kicks focus out. Capture (gated to this card) before the
        // swap, restore against the fresh DOM after. (Mirrors _kasperRepaintCard.)
        const cap = _svCaptureFocus(el);
        const tmp = document.createElement('div'); tmp.innerHTML = _sxrKasperRenderCard(it);
        if (tmp.firstElementChild) el.replaceWith(tmp.firstElementChild);
        _svRestoreFocus(cap);
    }
    function _sxrKasperOnDraftInput(ta, pid, comp) {
        const key = pid + '|' + comp; _sxrKasperState.drafts[key] = ta.value;
        const panel = ta.closest('.cal-review-panel'); if (!panel) return;
        const has = !!ta.value.trim(), saving = !!_sxrKasperState.saving[key];
        panel.querySelectorAll('.cal-review-tweak-btn, .cal-review-aat-btn, .cal-review-comment-btn').forEach(b => b.disabled = !has || saving);
        panel.querySelectorAll('.cal-review-approve-main').forEach(b => {
            b.disabled = has || saving;
            b.title = has ? REVIEW_APPROVE_DRAFT_TITLE : (b.getAttribute('data-idle-title') || '');
        });
    }
    async function _sxrKasperPersist(item, patch) {
        const sample = Object.assign({ id: item.post.id }, patch);
        const resp = await _writeUiTrackSave('sxr', 'kasper_sample_save', () => ({ client_slug: item.slug, id: String(item.post.id || '') }), () => _sxrUpsertFetch(item.slug, { client: item.slug, sample, comments_base_at: '' }, 'ui'), { requireOk: true });
        if (!resp.ok) throw new Error('http ' + resp.status);
        const j = await resp.json(); if (!j.ok) throw new Error(j.error || 'save failed');
        return j.sample || sample;
    }
    async function _sxrKasperApplyAndPersist(pid, comp, mutate, linearComment, afterPersist) {
        const it = _sxrKasperFindItem(pid); if (!it) return;
        const key = pid + '|' + comp; if (_sxrKasperState.saving[key]) return;
        _sxrKasperState.writeGen++;
        const p = it.post;
        const cachedRepair = p._writeUiKasperRepair
            || ((_kasperState && _kasperState.sxrRepairs) || []).find(row => row && row.id === p.id && row.slug === it.slug);
        if (cachedRepair) {
            _sxrKasperState.saving[key] = false;
            /* Was `_sxrKasperState.errors[key] = ...` -- a store this state has
               never declared, so every cached-repair refusal here threw a
               TypeError before the diagnostic or the repaint ran. Exposed by
               the Codex finding on the guard above (PR 1278); same fix. */
            showNotify('Reload before another action', 'A prior source repair needs receipt verification; reload before another action.');
            _writeUiQueueDiagnostic('sxr', 'cache_only_repair_blocked', { kind: 'kasper-source-repair' });
            _sxrKasperRepaint(pid);
            return;
        }
        const before = JSON.parse(JSON.stringify(p));
        const patch = mutate(p);
        p.updated_at = new Date().toISOString();
        const linearMeta = linearComment ? _sxrCommentsFor(p, comp).slice(-1)[0] : null;
        _sxrKasperState.saving[key] = true;
        _sxrSetLastLocalWriteAt(Date.now());   // self-echo: defer the realtime queue refresh of our own write
        _sxrKasperRepaint(pid);
        let gatewayAttempted = false;
        let gatewayCommitted = false;
        let deferredLegacyComment = false;
        let deferredLegacyStatus = false;
        const sourceRepairRefsForWrite = [];
        let repair = null;
        const checkpointRepair = () => {
            if (!gatewayCommitted) return;
            repair = repair || {
                version: 1, id: p.id, slug: it.slug, component: comp,
                principal: _writeUiPrincipalKey(), sourceEditedAt: p.updated_at,
                patch: Object.assign({}, patch), post: JSON.parse(JSON.stringify(p)),
                linearComment: linearComment || '', linearMeta: linearMeta || null,
                statusCommitted: false, commentCommitted: false
            };
            p._writeUiKasperRepair = repair;
            _kasperState.sxrRepairs = (_kasperState.sxrRepairs || []).filter(row => row && row.id !== repair.id).concat([repair]);
            if (!_kasperPersistCache()) throw _writeUiGatewayError(507, 'repair_storage_unavailable');
        };
        try {
            const url = _sxrLinearUrlFor(p, comp);
            let companion = null;
            if (linearComment) {
                // Composite tweak actions are comment-first. The same journal
                // record reserves the status companion, so a rejected comment
                // can never leak through a status record's source patch.
                const gatewayAttemptedBefore = gatewayAttempted;
                gatewayAttempted = true;
                const acknowledgement = await _sxrPostLinearComment(url, linearComment, 'Kasper', {
                    post: p, component: comp, comment: linearMeta, audience: 'internal',
                    isTweak: !!(linearMeta && _sxrMsgIsTweak(linearMeta)), round: linearMeta && linearMeta.round,
                    clientSlug: it.slug, repairLane: 'kasper-sxr', repairEdits: patch,
                    reserveStatusIntent: patch[comp + '_status'] ? { status: patch[comp + '_status'] } : null,
                    deferLegacyUntilSourceSave: true
                });
                deferredLegacyComment = !!(acknowledgement && (acknowledgement.deferred_until_source_save
                    || acknowledgement.legacy_transport_retired));
                if (deferredLegacyComment) gatewayAttempted = gatewayAttemptedBefore;
                _writeUiAdoptRepairAck(p, acknowledgement);
                _writeUiAppendRepairRef(sourceRepairRefsForWrite, acknowledgement && acknowledgement.source_repair);
                const commentCommitted = !!(acknowledgement && acknowledgement.native_committed);
                gatewayCommitted = gatewayCommitted || commentCommitted;
                if (commentCommitted) { checkpointRepair(); repair.commentCommitted = true; checkpointRepair(); }
                companion = _writeUiRepairCompanions(acknowledgement && acknowledgement.source_repair)
                    .find(row => row && row.operation === 'status' && row.component === comp) || null;
            }
            if (patch[comp + '_status']) {
                let reconciled = false;
                // A freshly reserved status companion belongs to this in-flight
                // action and has never reached the gateway. Reconciliation is
                // only for a companion recovered after an earlier attempt;
                // otherwise a newer native clock can incorrectly overwrite this
                // fresh Samples decision before the source save (F140).
                if (companion && companion.intent && companion.intent.attempted === true) {
                    reconciled = await _writeUiReconcileReplayStatus({ edits: patch, source_at: companion.source_at }, companion.intent, p);
                    if (reconciled) gatewayCommitted = true;
                }
                if (!reconciled) {
                    const gatewayAttemptedBefore = gatewayAttempted;
                    gatewayAttempted = true;
                    const acknowledgement = await _sxrPushStatusToLinear(url, patch[comp + '_status'], {
                        post: p, component: comp, sourceEditedAt: companion ? companion.source_at : p.updated_at,
                        clientSlug: it.slug, repairLane: 'kasper-sxr', repairEdits: patch,
                        repairRecord: companion && companion.record,
                        deferLegacyUntilSourceSave: true
                    });
                    deferredLegacyStatus = !!(acknowledgement && (acknowledgement.deferred_until_source_save
                    || acknowledgement.legacy_transport_retired));
                    if (deferredLegacyStatus) gatewayAttempted = gatewayAttemptedBefore;
                    _writeUiAdoptRepairAck(p, acknowledgement);
                    _writeUiAppendRepairRef(sourceRepairRefsForWrite, acknowledgement && acknowledgement.source_repair);
                    gatewayCommitted = gatewayCommitted || !!(acknowledgement && acknowledgement.native_committed);
                    if ((!acknowledgement || acknowledgement.native_committed !== true)
                        && !(acknowledgement && acknowledgement.skipped === true && !companion)) {
                        throw _writeUiGatewayError(503, 'status_commit_required');
                    }
                }
                if (gatewayCommitted) { checkpointRepair(); repair.statusCommitted = true; checkpointRepair(); }
            }
            await _sxrKasperPersist(it, patch);
            /* The two post-persist legacy sends that stood here are retired
               (OPEN_REPAIRS 239). The persist above was always the write's
               home and still is; only the outbound copy to Linear is gone.
               `deferredLegacyStatus` / `deferredLegacyComment` stay because
               they still mark a write that never reached the gateway, which is
               what keeps `gatewayAttempted` honest in the catch below. */
            if (await _writeUiCompleteSourceRepairRefs(sourceRepairRefsForWrite)) _writeUiRemoveCompletedRepairRefs(p, sourceRepairRefsForWrite);
            delete p._writeUiKasperRepair;
            _kasperState.sxrRepairs = (_kasperState.sxrRepairs || []).filter(row => row && row.id !== p.id);
            _kasperPersistCache();
            _sxrKasperState.saving[key] = false;
            _sxrKasperState.writeGen++;
            _sxrSetLastLocalWriteAt(Date.now());   // echo lands a beat after the write resolves
            // Pin the card in the queue (touched) — it no longer auto-vanishes when
            // a component leaves Kasper Approval. It only leaves via "Finish
            // reviewing" (→ history / Tweaks pending) or the X (Close). The approve
            // handler's afterPersist may complete + log a fully-approved card.
            it._touched = true;
            if (afterPersist && afterPersist(p, it)) return;
            _sxrKasperRepaint(pid);
        } catch (e) {
            if (!gatewayCommitted) {
                Object.assign(p, before);
                if (linearComment) _sxrKasperState.drafts[key] = linearComment;
            } else {
                try { checkpointRepair(); } catch (checkpointError) {}
            }
            _sxrKasperState.saving[key] = false;
            _sxrKasperRepaint(pid);
            if (gatewayAttempted && !gatewayCommitted) _writeUiReportFailure('sxr', linearComment ? 'comment' : 'status', e, { card: String(pid || ''), component: String(comp || '') });
            else {
                _writeUiRecordFailure('sxr', linearComment ? 'comment' : 'status', e, { card: String(pid || ''), component: String(comp || '') });
                if (typeof showNotify === 'function') showNotify(gatewayCommitted ? 'Card sync incomplete' : 'Save failed', gatewayCommitted ? 'The native write is safe; Samples source sync will retry automatically.' : ((e && e.message) || 'Please try again.'));
            }
        }
    }
    async function _sxrKasperResumeSourceRepairs() {
        const principal = _writeUiPrincipalKey();
        const repairs = ((_kasperState && _kasperState.sxrRepairs) || []).slice();
        for (const repair of repairs) {
            if (!repair || repair.principal !== principal || !repair.id || !repair.slug) continue;
            if (_writeUiJournalHasRepair('sxr', 'kasper-sxr', repair.slug, repair.id, principal)) continue;
            repair.error = 'Source repair receipt missing; explicit review required';
            _writeUiQueueDiagnostic('sxr', 'cache_only_repair_held', { kind: 'kasper-source-repair' });
            _kasperState.sxrRepairs = (_kasperState.sxrRepairs || []).filter(row => row && row.id !== repair.id).concat([repair]);
            _kasperPersistCache();
        }
    }
    function _sxrKasperApproveComp(pid, comp) {
        const it0 = _sxrKasperFindItem(pid);
        /* Handler-level guard, mirroring _kasperApproveComp. */
        if (it0) {
            const _blocked = _sxrReviewBlockReason(it0.post, comp, 'Client Approval');
            if (_blocked) {
                /* showNotify, not an inline error: this surface has no
                   per-component error store -- _sxrKasperState declares none
                   and _sxrKasperPanelHtml renders none -- and the first draft
                   of this guard wrote to one anyway, which threw a TypeError
                   and made the Approve button look dead. The catch block in
                   _sxrKasperApplyAndPersist reports its failures this same
                   way, so the refusal now reads like every other refusal here.
                   Found by Codex on PR 1278. */
                showNotify('Nothing to review yet', _blocked);
                return;
            }
        }
        const prevStatus = it0 ? String(it0.post[comp + '_status'] || 'Kasper Approval') : 'Kasper Approval';
        _sxrKasperApplyAndPersist(pid, comp,
            (p) => {
                p[comp + '_status'] = 'Client Approval'; p.status = computeSampleOverallStatus(p);
                const patch = { [comp + '_status']: 'Client Approval', status: p.status };
                // Stamp the Kasper sign-off (cross-device, mirrors the calendar's
                // _kasperApproveComp) so the audit trail can record kasper_approve
                // and history timestamps are real, not synthesized. First-wins.
                if (!p.kasper_approved_at) { p.kasper_approved_at = new Date().toISOString(); patch.kasper_approved_at = p.kasper_approved_at; }
                if (!p.kasper_approved_by) { p.kasper_approved_by = 'Kasper'; patch.kasper_approved_by = p.kasper_approved_by; }
                return patch;
            },
            null,
            (p, it) => {
                // Card fully done (nothing at Kasper Approval, no unresolved tweaks)
                // → log to Approved history + remove, with an Undo (mirrors the
                // calendar). Otherwise keep it pinned so he can keep deciding.
                const stillKasper = SXR_REVIEW_COMPONENTS.some(c => _sxrNormStatus(p[c + '_status'] || '') === 'Kasper Approval');
                const stillTweaks = _sxrKasperPostHasUnresolvedKasperTweak(p);
                if (stillKasper || stillTweaks) {
                    // Partial approve — the card stays for the remaining decisions,
                    // but Kasper still gets the confirmation + Undo (the calendar's
                    // toast shows in BOTH branches; without it a partial approve
                    // gave no feedback and no way back).
                    if (typeof showToast === 'function') showToast(COMP_LABELS[comp] + ' approved — sent to client', { actionLabel: 'Undo', onAction: () => _sxrKasperUndoApprove(it, comp, prevStatus, null) });
                    return false;
                }
                const entry = _sxrKasperHistoryEntryFromPost(p, it.client, it.slug, new Date().toISOString());
                _sxrKasperRecordHistory(entry);
                const removed = it;
                _sxrKasperState.items = _sxrKasperState.items.filter(x => x.post.id !== pid);
                _sxrKasperRenderQueue();
                if (typeof showToast === 'function') showToast(COMP_LABELS[comp] + ' approved — sent to client', { actionLabel: 'Undo', onAction: () => _sxrKasperUndoApprove(removed, comp, prevStatus, entry.id) });
                return true;
            });
    }
    function _sxrKasperUndoApprove(item, comp, prevStatus, entryId) {
        if (!item) return;
        _sxrKasperState.history = (_sxrKasperState.history || []).filter(e => e.id !== entryId);
        const p = item.post;
        p[comp + '_status'] = prevStatus;
        p.status = computeSampleOverallStatus(p);
        if (!_sxrKasperFindItem(p.id)) _sxrKasperState.items.push(item);
        _sxrKasperRenderQueue();
        _sxrKasperApplyAndPersist(p.id, comp, current => {
            current[comp + '_status'] = prevStatus;
            current.status = computeSampleOverallStatus(current);
            return { [comp + '_status']: prevStatus, status: current.status };
        });
    }
    // Comment — internal-only note. No status change, no Linear ping; the card
    // stays exactly where it is (still awaiting his approval).
    function _sxrKasperAddCommentComp(pid, comp) {
        const it = _sxrKasperFindItem(pid); if (!it) return;
        const key = pid + '|' + comp; const body = String(_sxrKasperState.drafts[key] || '').trim(); if (!body) return;
        _sxrKasperState.drafts[key] = '';
        _sxrKasperApplyAndPersist(pid, comp, (p) => {
            const list = _sxrCommentsFor(p, comp).slice(); const now = new Date().toISOString();
            list.push({ id: _sxrMintCommentId(), parent_id: null, author: 'Kasper', role: 'kasper', is_tweak: false, audience: 'internal', body, created_at: now, updated_at: now, done: false, done_at: '', done_by: '' });
            _sxrSetCommentsFor(p, comp, list);
            return { [comp + '_tweaks']: _sxrStringifyComments(list) };
        });
    }
    // "Finish reviewing" — explicit hand-off. Guard: every component decided.
    // Clean approve-all → Approved history; any change request → stamped finished
    // and removed from his queue until a new version puts a component back at
    // Kasper Approval (see _sxrKasperIsFinished). Stamps persist (the upsert drops
    // unknown columns, so the local flag is the same-device fallback).
    function _sxrKasperDismiss(pid) {
        const it = _sxrKasperFindItem(pid); if (!it) return;
        const p = it.post;
        if (_sxrKasperUndecidedComps(p).length) return;
        if (!_sxrKasperPostHasUnresolvedKasperTweak(p)) {
            const entry = _sxrKasperHistoryEntryFromPost(p, it.client, it.slug, p.kasper_approved_at || new Date().toISOString());
            _sxrKasperRecordHistory(entry);
            _sxrKasperState.items = _sxrKasperState.items.filter(x => x.post.id !== pid);
            _sxrKasperRenderQueue();
        } else {
            const stamp = _sxrKasperLatestMsgAt(p) || new Date().toISOString();
            _sxrKasperAppendFinishLog(p, stamp);
            p.kasper_finished_at = stamp;
            _sxrKasperState.dismissed[pid] = true;
            // Mark seen up to the finish stamp (clears the New-message chip on
            // hand-off — matches the calendar's _kasperDismiss). The chip otherwise
            // persists while reviewing, exactly like the calendar.
            try { _kasperMarkSeenAt(pid, stamp); } catch (e) {}
            _sxrKasperState.items = _sxrKasperState.items.filter(x => x.post.id !== pid);
            _sxrKasperRenderQueue();
            // If the stamp does not save, drop the same-device flag so the next
            // load shows the sample again (a new version must never stay hidden).
            _sxrKasperPersist(it, { kasper_finished_at: p.kasper_finished_at, kasper_finish_log: p.kasper_finish_log }).catch(() => { delete _sxrKasperState.dismissed[pid]; });
        }
    }
    function _sxrKasperAppendFinishLog(post, stampIso) {
        let log = []; try { log = JSON.parse(post.kasper_finish_log || '[]'); if (!Array.isArray(log)) log = []; } catch { log = []; }
        const prev = log.length ? log[log.length - 1].at : null;
        log.push({ at: stampIso, prev, kind: 'handoff', statuses: { video: post.video_status || null, graphic: post.graphic_status || null }, overall: post.status || null });
        if (log.length > 50) log = log.slice(-50);
        post.kasper_finish_log = JSON.stringify(log);
    }
    // Close (the X) — hide the card, no decision required. Cross-device via the
    // persisted kasper_closed_at; re-surfaces on a new message or a re-route.
    function _sxrKasperClose(pid) {
        const it = _sxrKasperFindItem(pid); if (!it) return;
        const p = it.post;
        p.kasper_closed_at = new Date().toISOString();
        _sxrKasperState.closed[pid] = true;
        _sxrKasperState.items = _sxrKasperState.items.filter(x => x.post.id !== pid);
        _sxrKasperRenderQueue();
        _sxrKasperPersist(it, { kasper_closed_at: p.kasper_closed_at }).catch(() => {});
    }
    // URGENT ping — mirrors _kasperSendUrgentSlack: resolve the post + client from
    // the cross-client Kasper queue and reuse the SHARED _calUrgentSlackDispatch
    // (same #video-editing webhook + message). Gate is _sxrShowUrgent (video at
    // Tweaks Needed with a linked sub-issue).
    function _sxrKasperSendUrgentSlack(event, pid) {
        if (event) { event.preventDefault(); event.stopPropagation(); }
        const btn = (event && event.currentTarget) ? event.currentTarget : null;
        if (btn && btn.dataset.urgentSent === '1') { if (typeof showNotify === 'function') showNotify('Already sent', 'An urgent ping for this video was already sent in this session.'); return; }
        const it = _sxrKasperFindItem(pid); if (!it || !it.post) return;
        const issue = String(it.post.linear_issue_id || '').trim();
        if (!String(it.post.video_deliverable_id || '').trim()) { if (typeof showNotify === 'function') showNotify(URGENT_EDITOR_NEEDS_NATIVE.title, URGENT_EDITOR_NEEDS_NATIVE.text); return; }
        const client = String(it.client || wlCanonicalClient(it.slug) || '').trim();
        _calUrgentSlackDispatch(btn, issue, client, it.post.name, {
            native: String(it.post.video_deliverable_id || '').trim() ? { action: 'native_urgent_dispatch', client_slug: String(it.slug || sxrClientSlug(client)),
                deliverable_id: _writeUiNativeId(it.post, 'video'), card_id: String(it.post.id), surface: 'samples', video_status_at: String(it.post.video_status_at || '') } : null,
            currentClientSlug: () => String((_sxrKasperFindItem(pid) || {}).slug || ''),
            currentPost: () => (_sxrKasperFindItem(pid) || {}).post,
            persist: (ping) => _sxrPersistUrgentSentForPost(it.slug || client, it.post, ping)
        });
    }
    function _sxrKasperRequestTweakComp(pid, comp) {
        const it = _sxrKasperFindItem(pid); if (!it) return;
        const key = pid + '|' + comp; const body = String(_sxrKasperState.drafts[key] || '').trim(); if (!body) return;
        _sxrKasperState.drafts[key] = '';
        _sxrKasperApplyAndPersist(pid, comp, (p) => {
            const list = _sxrCommentsFor(p, comp).slice(); const now = new Date().toISOString();
            list.push({ id: _sxrMintCommentId(), parent_id: null, author: 'Kasper', role: 'kasper', is_tweak: true, audience: 'internal', round: _sxrNextTweakRound(p, comp), body, created_at: now, updated_at: now, done: false, done_at: '', done_by: '' });
            _sxrSetCommentsFor(p, comp, list);
            p[comp + '_status'] = 'Tweaks Needed'; p.status = computeSampleOverallStatus(p);
            // A plain "Request change" supersedes any prior "approve after tweaks"
            // pre-clearance on this component (mirror of the calendar's
            // _calClearApprovedAfterTweaks call) — otherwise the SMM still saw
            // the pre-clear badge and the resolve chooser recommended skipping
            // Kasper's re-review.
            const aat = new Set(String(p.kasper_approved_after_tweaks || '').split(',').map(s => s.trim()).filter(Boolean));
            const hadAat = aat.delete(comp);
            if (hadAat) p.kasper_approved_after_tweaks = SXR_COMPONENTS.filter(c => aat.has(c)).join(',');
            // Kasper just moved a sub to Tweaks Needed — stale client/Kasper
            // approval stamps must clear too (mirror of _calClearStaleApprovals
            // in the calendar handler), folded into the persisted patch.
            const stale = {};
            _sxrClearStaleApprovals(p, stale);
            return Object.assign(
                { [comp + '_status']: 'Tweaks Needed', status: p.status, [comp + '_tweaks']: _sxrStringifyComments(list) },
                hadAat ? { kasper_approved_after_tweaks: p.kasper_approved_after_tweaks } : {},
                stale);
        }, body);
    }
    function _sxrKasperApproveAfterTweaksComp(pid, comp) {
        const it = _sxrKasperFindItem(pid); if (!it) return;
        const key = pid + '|' + comp; const body = String(_sxrKasperState.drafts[key] || '').trim(); if (!body) return;
        _sxrKasperState.drafts[key] = '';
        _sxrKasperApplyAndPersist(pid, comp, (p) => {
            const list = _sxrCommentsFor(p, comp).slice(); const now = new Date().toISOString();
            list.push({ id: _sxrMintCommentId(), parent_id: null, author: 'Kasper', role: 'kasper', is_tweak: true, audience: 'internal', round: _sxrNextTweakRound(p, comp), body, created_at: now, updated_at: now, done: false, done_at: '', done_by: '' });
            _sxrSetCommentsFor(p, comp, list);
            // Pre-clear for the client, mirroring the calendar's
            // _kasperRequestTweakComp(…, approveAfterTweaks=true): the component
            // goes to TWEAKS NEEDED so the editor applies the fix first, then
            // routes it back to For SMM Approval where the pre-clear flag tells
            // the SMM it's already cleared by Kasper (parity bug B — was jumping
            // straight to For SMM Approval, skipping the editor-fix stage).
            p[comp + '_status'] = 'Tweaks Needed';
            const set = new Set(String(p.kasper_approved_after_tweaks || '').split(',').map(s => s.trim()).filter(Boolean)); set.add(comp);
            p.kasper_approved_after_tweaks = SXR_COMPONENTS.filter(c => set.has(c)).join(',');
            p.status = computeSampleOverallStatus(p);
            return { [comp + '_status']: 'Tweaks Needed', status: p.status, kasper_approved_after_tweaks: p.kasper_approved_after_tweaks, [comp + '_tweaks']: _sxrStringifyComments(list) };
        }, body);
    }

    /* Reveal the nav tab when the flag is on. With the flag OFF this is the ONLY
       samples statement that runs at load — and it only reads the flag and toggles
       one element's display: no network, no supabase-js, no realtime. */
    try {
        if (_sxrEnabled()) {
            const _sxrNavEl = document.getElementById('navSxr');
            if (_sxrNavEl) _sxrNavEl.style.display = '';
            _navPillSync(false);   // a revealed tab reflows the strip
        }
    } catch (e) {}
    // <<< SXR_END

;(self.__svParts || (self.__svParts = [])).push("js/sv-13-core-9452c4408cca.js");
