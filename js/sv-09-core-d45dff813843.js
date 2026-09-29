    /* TODAY (owner design 2026-09-27, session Compass).
     *
     * One summary page per person: what is waiting on YOU right now, pulled
     * from the tabs that already hold it. It reads only; it never writes and it
     * has no checkboxes. A card leaves the page by itself when its status moves
     * on (you approved it, the editor sent it back, and so on), and lands in
     * "Cleared today".
     *
     *   SMM and admin: five jobs as rings (to approve, missing links, captions
     *     to write, to schedule, dates to move), or a walk-through that takes
     *     one upcoming post at a time.
     *   Video and graphics: their own queue (urgent, changes, to do) as a list
     *     or a deck. Editors work in SyncLinear, so rows only open SyncLinear.
     *
     * Client scope follows the one shared rule in 098-smm-clients (the same
     * rule the client dropdown's "My clients" uses): only current Clients Info
     * clients, never a test client; anyone on the SMM roster, admins included,
     * sees the clients it lists for them; an admin not on the roster sees all.
     * An SMM with no clients listed gets a short note.
     *
     * Speed (owner feedback 2026-09-28): Today is a fast tab, so it mounts
     * before the Analytics data and starts its own reads at once. The last
     * answer is kept per person (memory and localStorage, like the other
     * tabs' caches) and painted instantly on return; a quiet read then
     * replaces it. Card changes arrive live over the same realtime client
     * Calendar uses (deliverables and calendar_posts). If the
     * roster or Clients Info cannot be read, the page says so and offers a
     * retry rather than guessing. Today is a team tab: it ignores
     * the shared client, but opening a card makes that card's client current. */
    const TDY_VIEW_KEY = 'syncview_today_view';
    const TDY_CACHE_KEY = 'syncview_today_cache_v1';   // { who, at, data } for the last signed-in person
    const TDY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
    const TDY_RT_DEBOUNCE_MS = 1500;
    const TDY_OPEN = ['todo', 'in_progress', 'tweak', 'smm_approval'];
    const TDY_PAST_EDIT = ['smm_approval', 'kasper_approval', 'client_approval', 'approved', 'scheduled', 'posted'];
    const TDY_PAST_SMM = ['kasper_approval', 'client_approval', 'approved', 'scheduled', 'posted'];
    const TDY_STAGE = { todo: 0, in_progress: 0, tweak: 0, smm_approval: 1, kasper_approval: 2, client_approval: 3 };
    // no-hardcoded-colors: allow-start (client avatar dots, same hues as the design mockups)
    const TDY_PALETTE = ['#7c5cff', '#e1306c', '#0e9f8e', '#2f7de1', '#d98a12', '#5b6b82', '#c2410c', '#16a34a', '#9333ea', '#0891b2'];
    // no-hardcoded-colors: allow-end
    const tdyState = { gen: 0, data: null, error: '', view: '', walk: 0, skipped: [], who: '', loading: null };
    let _tdyClientsInfo = null;   // Promise that settles once Clients Info has loaded (set at boot)

    function _tdyIdentity() {
        const id = _syncviewStaffIdentityForHeaders();
        const m = id && id.member;
        if (!m || !m.id) return null;
        const role = String(id.role || m.role || '').toLowerCase();
        const team = String(m.team || '').toLowerCase();
        const editor = role !== 'admin' && role !== 'smm' && (team === 'video' || team === 'graphics');
        return { id: String(m.id), name: String(m.name || '').trim(), first: String(m.name || '').trim().split(/\s+/)[0] || '', role, team, editor };
    }
    function _tdyIso(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function _tdyDays(n) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; }
    function _tdyMonday() { const d = _tdyDays(0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; }
    async function _tdyRest(table, query) {
        const out = [];
        for (let page = 0; page < 8; page++) {
            let rows = null;
            for (let attempt = 0; attempt < 3 && !rows; attempt++) {
                try {
                    const res = await fetch(CAL_SUPABASE_URL + '/rest/v1/' + table + '?' + query + '&limit=1000&offset=' + (page * 1000), {
                        headers: { apikey: CAL_SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY }
                    });
                    if (!res.ok) throw new Error(table + ' ' + res.status);
                    rows = await res.json();
                } catch (e) {
                    if (attempt === 2) throw e;
                    await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
                }
            }
            out.push(...rows);
            if (rows.length < 1000) break;
        }
        return out;
    }
    const _tdyIn = list => 'in.(' + list.join(',') + ')';
    /* Cards left over from the Linear era sit in open statuses for months and
       nobody is working them. A card counts only while something about it is
       recent: its status moved in the last 30 days, or its due date is no
       older than that. */
    function _tdyFresh(r) {
        const cut = _tdyDays(-30);
        return (!!r.status_at && new Date(r.status_at) >= cut) || (!!r.due_date && r.due_date >= _tdyIso(cut));
    }

    /* A batch PARENT (the old Linear post issue) sits in the same view as its
       video and thumbnail children. It is not work anybody owes, so every list
       and count here drops it: a row is a parent when another row names it as
       its parent. Only the rows this page read are checked, in parallel
       batches, instead of paging through every child in the table. */
    async function _tdyParentIds(rows) {
        const ids = [...new Set(rows.map(r => r.linear_issue_uuid).filter(Boolean))];
        const reads = [];
        for (let i = 0; i < ids.length; i += 80) reads.push(_tdyRest('production_deliverables_browser_v1', 'select=raw_issue_parent_id&raw_issue_parent_id=' + _tdyIn(ids.slice(i, i + 80))));
        return new Set((await Promise.all(reads)).flat().map(r => r.raw_issue_parent_id));
    }
    let _tdyRosterReading = null;   // one roster read in flight, shared
    function _tdyRoster() {
        if (_srpState.managersLoaded) return Promise.resolve(_srpState.managers);
        if (!_tdyRosterReading) _tdyRosterReading = _tdyRosterRead().finally(() => { _tdyRosterReading = null; });
        return _tdyRosterReading;
    }
    async function _tdyRosterRead() {
        const ident = _syncviewStaffIdentityForHeaders();
        if (!ident || !ident.key) return null;
        try {
            const resp = await fetch(SMM_WEEKLY_REPORTS_URL + '?action=options', {
                headers: { Accept: 'application/json', apikey: CAL_SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY, 'X-Syncview-Key': ident.key }
            });
            const data = await resp.json().catch(() => null);
            if (!resp.ok || !data || !Array.isArray(data.managers)) return null;
            _srpState.managers = data.managers;
            _srpState.managersLoaded = true;
            return data.managers;
        } catch (e) { return null; }
    }
    /* The clients table (names, and kind for the test-client rule), read
       once per load and shared by Today and the dropdown's "My clients". */
    let _tdyClientRows = null;
    function _tdyClients() {
        if (!_tdyClientRows) {
            _tdyClientRows = _tdyRest('clients', 'select=slug,display_name,active,kind');
            _tdyClientRows.catch(() => { _tdyClientRows = null; });
        }
        return _tdyClientRows;
    }
    /* Boot hands over the Clients Info load so Today, which mounts before
       it, can wait for it instead of reporting "could not read". */
    function tdySetClientsInfoReady(p) { _tdyClientsInfo = p; }
    async function _tdyCurrent(rows) {
        let cur = svCurrentClients(undefined, rows);
        if (!cur.size && _tdyClientsInfo) { try { await _tdyClientsInfo; } catch (e) {} cur = svCurrentClients(undefined, rows); }
        if (!cur.size) throw new Error('clients');
        return cur;
    }
    async function _tdyRosterEntry(me, managers) {
        let email = '';
        try {
            const rows = await _tdyRest('team_members', 'select=email&id=eq.' + encodeURIComponent(me.id));
            email = String(rows[0] && rows[0].email || '');
        } catch (e) {}
        return svRosterEntryFor(managers, { email, name: me.name });
    }
    /* The current Clients Info clients one SMM owns, by the shared rule in
       098-smm-clients. Throws when Clients Info or the roster is not
       available, so a caller never mistakes "not loaded" for "no clients".
       The main-bar dropdown's "My clients" calls this too (tdyMyClientNames),
       so Today and the dropdown always agree. */
    async function _tdySmmClients(me) {
        const [rows, managers] = await Promise.all([_tdyClients(), _tdyRoster()]);
        const current = await _tdyCurrent(rows);
        if (!managers) throw new Error('roster');
        return svSmmCurrentClients(await _tdyRosterEntry(me, managers), current);
    }
    /* The current Clients Info clients this person may see: their own roster
       clients, or every one for an admin who is not on the roster (see
       098-smm-clients). */
    async function _tdyVisibleClients(me, rows) {
        const isAdmin = me.role === 'admin';
        const [current, managers] = await Promise.all([_tdyCurrent(rows), _tdyRoster()]);
        // An admin can always fall back to every client; an SMM cannot guess.
        if (!managers && !isAdmin) throw new Error('roster');
        const entry = managers ? await _tdyRosterEntry(me, managers) : null;
        if (svScopeMode(isAdmin, !!entry) === 'all') return { keys: new Set(current.keys()), notListed: false };
        const mine = svSmmCurrentClients(entry, current);
        return { keys: new Set(mine.map(svClientKey)), notListed: mine.length === 0 };
    }
    /* The signed-in member's own roster clients for the dropdown: { id, names }.
       Anyone on the SMM roster gets their clients, admins included (an admin
       can also be an SMM); names are empty for anyone not on the roster or
       signed out. Rejects when not loaded. */
    async function tdyMyClientNames() {
        const me = _tdyIdentity();
        if (!me) return { id: '', names: [] };
        return { id: me.id, names: await _tdySmmClients(me) };
    }
    async function _tdyLoad(me) {
        const DSEL = 'select=id,client_slug,team,kind,title,status,status_at,assignee_id,due_date,origin,card_id,linear_issue_uuid';
        const monday = _tdyMonday().toISOString();
        _tdyClientRows = null;   // one fresh read per load
        const clientsP = _tdyClients();
        if (!me.editor) {
            _tdyRoster();   // start the roster read now; _tdyVisibleClients reuses it
            // Start every read now; only the client filter waits on the roster.
            const today = _tdyIso(_tdyDays(0));
            const reads = Promise.all([
                _tdyRest('production_deliverables_browser_v1', DSEL + '&status=' + _tdyIn(TDY_OPEN)),
                _tdyRest('production_deliverables_browser_v1', DSEL + '&status=' + _tdyIn(TDY_PAST_SMM) + '&status_at=gte.' + encodeURIComponent(monday)),
                _tdyRest('calendar_posts', 'select=id,client,name,scheduled_date,status,video_status,graphic_status,caption,asset_url,thumbnail_url,video_deliverable_id,graphic_deliverable_id'
                    + '&scheduled_date=gte.' + today + '&scheduled_date=lte.' + _tdyIso(_tdyDays(14)) + '&status=not.in.(Archived,Posted)')
            ]);
            reads.catch(() => {});
            const parentsP = reads.then(([o, d]) => _tdyParentIds(o.concat(d)));
            const [clients, parents] = await Promise.all([clientsP, parentsP]);
            const visible = await _tdyVisibleClients(me, clients);
            const names = {};
            clients.forEach(c => { names[c.slug] = c.display_name || c.slug; });
            const child = r => !(r.linear_issue_uuid && parents.has(r.linear_issue_uuid));
            const scope = new Set(clients.filter(c => String(c.kind || '').toLowerCase() !== 'test'
                && (visible.keys.has(svClientKey(c.display_name)) || visible.keys.has(svClientKey(c.slug)))).map(c => c.slug));
            const inScope = r => scope.has(r.client_slug || r.client);
            const [open, done, posts] = await reads;
            return { names, notListed: visible.notListed, open: open.filter(r => child(r) && inScope(r) && _tdyFresh(r)), done: done.filter(r => child(r) && inScope(r)), posts: posts.filter(inScope) };
        }
        // Editors: their own queue, read alongside the clients and parents.
        const mine = 'assignee_id=eq.' + encodeURIComponent(me.id);
        const [clients, open, done] = await Promise.all([clientsP,
            _tdyRest('production_deliverables_browser_v1', DSEL + '&' + mine + '&status=' + _tdyIn(['todo', 'in_progress', 'tweak'])),
            _tdyRest('production_deliverables_browser_v1', DSEL + '&' + mine + '&status=' + _tdyIn(TDY_PAST_EDIT) + '&status_at=gte.' + encodeURIComponent(monday))
        ]);
        const parents = await _tdyParentIds(open.concat(done));
        const names = {};
        clients.forEach(c => { names[c.slug] = c.display_name || c.slug; });
        const test = new Set(clients.filter(c => String(c.kind || '').toLowerCase() === 'test').map(c => c.slug));
        const real = r => !(r.linear_issue_uuid && parents.has(r.linear_issue_uuid)) && !test.has(r.client_slug);
        const urgent = new Set();
        const ids = open.filter(real).map(r => r.id);
        const pages = [];
        for (let i = 0; i < ids.length; i += 100) pages.push(_tdyRest('deliverables', 'select=id,priority&id=' + _tdyIn(ids.slice(i, i + 100))));
        (await Promise.all(pages)).forEach(rows => rows.forEach(r => { if (Number(r.priority) === 1) urgent.add(r.id); }));
        return { names, open: open.filter(r => real(r) && (r.status === 'tweak' || _tdyFresh(r))), done: done.filter(real), urgent: [...urgent] };
    }

    /* ---------- small pieces ---------- */
    function _tdyColor(slug) {
        let h = 0;
        for (const ch of String(slug || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        return TDY_PALETTE[h % TDY_PALETTE.length];
    }
    function _tdyInitials(name) {
        const w = String(name || '').replace(/^Dr\.?\s+/i, '').trim().split(/\s+/).filter(Boolean);
        return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
    }
    function _tdyAvatar(slug, name) {
        return `<span class="tdy-av" style="background:${_tdyColor(slug)}">${_calEsc(_tdyInitials(name))}</span>`;
    }
    function _tdyPipe(status) {
        const s = TDY_STAGE[status] != null ? TDY_STAGE[status] : 0;
        return `<span class="tdy-pipe" aria-hidden="true">${[0, 1, 2, 3].map(k => `<i class="${k < s ? 'd' : k === s ? (status === 'tweak' ? 'w' : 'n') : ''}"></i>`).join('')}</span>`;
    }
    function _tdyIco(name) { return `<span class="tdy-ic" style="--ic:url('/nav-icons/${name}.png')" aria-hidden="true"></span>`; }
    function _tdyBtnSync(id) {
        return id ? `<button type="button" class="tdy-b" aria-label="Open in SyncLinear" onclick="_tdyOpenSync(${_calEscAttr(JSON.stringify(String(id)))})">${_tdyIco('synclinear')}SyncLinear</button>` : '';
    }
    function _tdyBtnCard(kind, id) {
        return `<button type="button" class="tdy-b" aria-label="Open card in Calendar" onclick="_tdyOpenCard(${_calEscAttr(JSON.stringify(kind))},${_calEscAttr(JSON.stringify(String(id)))})">${_tdyIco('calendar')}Open card</button>`;
    }
    function _tdyTimeOf(iso) {
        const d = new Date(iso);
        return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    function _tdyMeter(done, left, week) {
        const total = done + left;
        const segs = total > 0 && total <= 24
            ? Array.from({ length: total }, (_, k) => `<i class="${k < done ? 'f' : ''}"></i>`).join('')
            : `<i class="bar"><b style="width:${total ? Math.round(done / total * 100) : 0}%"></b></i>`;
        return `<div class="tdy-meter ${total && !left ? 'all' : ''}">${segs}</div>
            <div class="tdy-mrow"><span><b>${done} of ${total}</b> cleared today</span><span>${week} this week</span></div>`;
    }
    function _tdyTrail(list, names) {
        if (!list.length) return '';
        const chips = list.slice(0, 12).map(r => `<span class="tdy-chip"><span class="tdy-tk"></span>${_calEsc(r.title || 'Untitled')}<span class="tdy-cn">${_calEsc(names[r.client_slug] || '')}</span><time>${_calEsc(_tdyTimeOf(r.status_at))}</time></span>`).join('');
        return `<div class="tdy-trail"><div class="tdy-st">Cleared today <span>${list.length}</span></div><div class="tdy-chips">${chips}</div></div>`;
    }
    function _tdyTop(views, on) {
        const d = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
        return `<div class="tdy-top"><h1 class="tdy-date">${_calEsc(d)}</h1><div class="tdy-vw" role="group" aria-label="View">${views.map(v => `<button type="button" aria-pressed="${v === on}" class="${v === on ? 'on' : ''}" data-tdy-key="view-${_calEscAttr(v)}" onclick="_tdySetView(${_calEscAttr(JSON.stringify(v))})">${_calEsc(v)}</button>`).join('')}</div></div>`;
    }
    const _tdyToday = rows => rows.filter(r => r.status_at && new Date(r.status_at) >= _tdyDays(0));

    /* ---------- editors ---------- */
    function _tdyEditorQueue(d) {
        const due = r => r.due_date || '9999';
        const rank = r => (r.status === 'tweak' ? 0 : 2) - (d.urgent.includes(r.id) ? 1 : 0);
        return d.open.filter(r => !tdyState.skipped.includes(r.id))
            .concat(d.open.filter(r => tdyState.skipped.includes(r.id)))
            .sort((a, b) => rank(a) - rank(b) || due(a).localeCompare(due(b)));
    }
    function _tdyEditorRow(r, d) {
        const name = d.names[r.client_slug] || r.client_slug || '';
        return `<div class="tdy-rw">${_tdyAvatar(r.client_slug, name)}${_tdyPipe(r.status)}<div class="tdy-who"><div class="tdy-tt">${_calEsc(r.title || 'Untitled')}</div><div class="tdy-cn">${_calEsc(name)}${r.status === 'tweak' ? ' · changes asked' : ''}</div></div>${d.urgent.includes(r.id) ? '<span class="tdy-urg">Urgent</span>' : ''}${_tdyBtnSync(r.id)}</div>`;
    }
    function _tdyEditorHtml(me, d, view) {
        const q = _tdyEditorQueue(d);
        const today = _tdyToday(d.done);
        const head = _tdyTop(['List', 'Deck'], view) + _tdyMeter(today.length, q.length, d.done.length);
        if (!q.length) return head + `<div class="tdy-win"><span class="tdy-ok"></span><h2>All clear${me.first ? ', ' + _calEsc(me.first) : ''}.</h2><p>Nothing is waiting on you.</p></div>` + _tdyTrail(today, d.names);
        if (view === 'Deck') {
            const r = q[0];
            const name = d.names[r.client_slug] || r.client_slug || '';
            return head + `<div class="tdy-deck"><div class="tdy-pile"><b>${today.length}</b><span>cleared today</span></div><div class="tdy-left"><b>${q.length}</b><span>in the deck</span></div>
                ${q.length > 2 ? '<div class="tdy-cd c3"></div>' : ''}${q.length > 1 ? '<div class="tdy-cd c2"></div>' : ''}
                <div class="tdy-cd c1">${_tdyAvatar(r.client_slug, name)}<h2>${_calEsc(r.title || 'Untitled')}</h2><div class="tdy-cn">${_calEsc(name)}${r.status === 'tweak' ? ' · changes asked' : ''}</div>
                ${d.urgent.includes(r.id) ? '<div><span class="tdy-urg">Urgent</span></div>' : ''}${_tdyPipe(r.status)}
                <div class="tdy-acts"><button type="button" class="tdy-b p" onclick="_tdyOpenSync(${_calEscAttr(JSON.stringify(r.id))})">${_tdyIco('synclinear')}Open in SyncLinear</button>${q.length > 1 ? `<button type="button" class="tdy-b" onclick="_tdySkip(${_calEscAttr(JSON.stringify(r.id))})">Skip for now</button>` : ''}</div></div></div>`
                + (q.length > 1 ? `<div class="tdy-st">Next in the deck</div><div class="tdy-ls">${q.slice(1, 4).map(x => _tdyEditorRow(x, d)).join('')}</div>` : '')
                + _tdyTrail(today, d.names);
        }
        return head + `<p class="tdy-big">${me.first ? _calEsc(me.first) + ', ' : ''}${q.length} to clear.</p><div class="tdy-ls">${q.slice(0, 15).map(r => _tdyEditorRow(r, d)).join('')}${q.length > 15 ? `<div class="tdy-more">${q.length - 15} more in SyncLinear</div>` : ''}</div>` + _tdyTrail(today, d.names);
    }

    /* ---------- SMM and admin ---------- */
    function _tdyJobs(d) {
        const today = _tdyIso(_tdyDays(0));
        const liveCal = p => !['Archived', 'Posted', 'Scheduled'].includes(p.status);
        return [
            { key: 'approve', label: 'To approve', rows: d.open.filter(r => r.status === 'smm_approval').map(r => ({ kind: 'del', r })) },
            { key: 'links', label: 'Missing links', rows: d.posts.filter(p => liveCal(p) && _calSmmMediaGap(p)).map(p => ({ kind: 'post', p })) },
            { key: 'captions', label: 'Captions to write', rows: d.posts.filter(p => liveCal(p) && !String(p.caption || '').trim()).map(p => ({ kind: 'post', p })) },
            { key: 'schedule', label: 'To schedule', rows: d.posts.filter(p => p.status === 'Approved').map(p => ({ kind: 'post', p })) },
            { key: 'dates', label: 'Dates to move', rows: d.open.filter(r => r.status !== 'smm_approval' && r.due_date && r.due_date < today).map(r => ({ kind: 'del', r })) }
        ];
    }
    function _tdySmmRow(x, d) {
        if (x.kind === 'del') {
            const r = x.r, name = d.names[r.client_slug] || r.client_slug || '';
            const card = r.origin === 'calendar' ? _tdyBtnCard('del', r.id) : '';
            return `<div class="tdy-rw">${_tdyAvatar(r.client_slug, name)}${_tdyPipe(r.status)}<div class="tdy-who"><div class="tdy-tt">${_calEsc(r.title || 'Untitled')}</div><div class="tdy-cn">${_calEsc(name)}</div></div>${card}${_tdyBtnSync(r.id)}</div>`;
        }
        const p = x.p, name = d.names[p.client] || p.client || '';
        return `<div class="tdy-rw">${_tdyAvatar(p.client, name)}<div class="tdy-who"><div class="tdy-tt">${_calEsc(p.name || 'Untitled post')}</div><div class="tdy-cn">${_calEsc(name)} · ${_calEsc(_tdyShortDate(p.scheduled_date))}</div></div>${_tdyBtnCard('post', p.id)}${_tdyBtnSync(p.video_deliverable_id || p.graphic_deliverable_id)}</div>`;
    }
    function _tdyShortDate(iso) {
        const d = new Date(String(iso || '') + 'T12:00:00');
        return isNaN(d) ? '' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    }
    function _tdyWalkList(d) {
        const approving = p => /smm approval/i.test(p.video_status || '') || /smm approval/i.test(p.graphic_status || '') || /smm approval/i.test(p.status || '');
        return d.posts.filter(p => !['Archived', 'Posted', 'Scheduled'].includes(p.status)
            && (approving(p) || _calSmmMediaGap(p) || !String(p.caption || '').trim()))
            .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)));
    }
    function _tdySmmHtml(me, d, view) {
        const jobs = _tdyJobs(d);
        const left = jobs.reduce((s, j) => s + j.rows.length, 0);
        const today = _tdyToday(d.done);
        const head = _tdyTop(['Rings', 'Walk-through'], view) + _tdyMeter(today.length, left, d.done.length);
        const scope = d.notListed ? '<p class="tdy-note" role="note">No clients are listed for you yet. Ask an admin to add yours to the SMM list.</p>' : '';
        if (view === 'Walk-through') {
            const list = _tdyWalkList(d);
            if (!list.length) return head + scope + `<div class="tdy-win"><span class="tdy-ok"></span><h2>Every post is ready.</h2><p>Nothing to walk through for the next two weeks.</p></div>`;
            const i = ((tdyState.walk % list.length) + list.length) % list.length;
            const p = list[i], name = d.names[p.client] || p.client || '';
            const gap = _calSmmMediaGap(p) || {};
            const approving = /smm approval/i.test((p.video_status || '') + (p.graphic_status || '') + (p.status || ''));
            const step = (ok, text, bad) => `<div class="${ok ? 'ok' : bad ? 'bad' : ''}"><span class="tdy-ck"></span>${_calEsc(text)}</div>`;
            return head + scope + `<div class="tdy-focus"><div class="tdy-n">Post ${i + 1} of ${list.length} · ${_calEsc(_tdyShortDate(p.scheduled_date))}</div>${_tdyAvatar(p.client, name)}<h2>${_calEsc(p.name || 'Untitled post')}</h2><div class="tdy-cn">${_calEsc(name)}</div>
                <div class="tdy-steps">${step(!gap.video, gap.video ? 'Video link missing' : 'Video link in place', gap.video)}${step(!gap.thumb, gap.thumb ? 'Thumbnail link missing' : 'Thumbnail link in place', gap.thumb)}${step(!!String(p.caption || '').trim(), String(p.caption || '').trim() ? 'Caption written' : 'Caption to write', !String(p.caption || '').trim())}${step(!approving && !gap.video && !gap.thumb, approving ? 'Approve and send to Kasper' : 'Nothing waiting on your approval', false)}</div>
                <div class="tdy-acts"><button type="button" class="tdy-b p" onclick="_tdyOpenCard('post',${_calEscAttr(JSON.stringify(p.id))})">${_tdyIco('calendar')}Open card</button>${_tdyBtnSync(p.video_deliverable_id || p.graphic_deliverable_id)}${list.length > 1 ? '<button type="button" class="tdy-b" onclick="_tdyWalkNext()">Skip</button>' : ''}</div></div>` + _tdyTrail(today, d.names);
        }
        const on = jobs.find(j => j.key === tdyState.job && j.rows.length) || jobs.find(j => j.rows.length) || jobs[0];
        const rings = jobs.map(j => {
            const n = j.rows.length;
            return `<button type="button" class="tdy-rg ${j === on ? 'on' : ''}" aria-pressed="${j === on}" aria-label="${_calEscAttr(j.label + ': ' + n)}" data-tdy-key="job-${j.key}" onclick="_tdySetJob(${_calEscAttr(JSON.stringify(j.key))})"><span class="tdy-ring ${n ? '' : 'full'}"><b>${n || ''}</b></span><span>${_calEsc(j.label)}</span></button>`;
        }).join('');
        const body = on.rows.length
            ? `<div class="tdy-ls">${on.rows.slice(0, 12).map(x => _tdySmmRow(x, d)).join('')}${on.rows.length > 12 ? `<div class="tdy-more">${on.rows.length - 12} more in SyncLinear and Calendar</div>` : ''}</div>`
            : `<div class="tdy-win"><span class="tdy-ok"></span><h2>All clear${me.first ? ', ' + _calEsc(me.first) : ''}.</h2><p>Nothing is waiting on you.</p></div>`;
        return head + scope + `<p class="tdy-big">${me.first ? _calEsc(me.first) + ', ' : ''}${left} to clear.</p><div class="tdy-rings" role="group" aria-label="What is waiting">${rings}</div>` + body + _tdyTrail(today, d.names);
    }

    /* ---------- page ---------- */
    /* The loading shape: the same shimmer blocks every other tab uses
       (_svSkel), laid out like the page it stands in for. The boot shell
       paints the same markup before the app script runs
       (030-body-shell, boot-skeleton-today). */
    function _tdySkeletonHtml() {
        const row = w => `<div class="tdy-rw">${_svSkel('sv-skeleton-dot', 'width:24px;height:24px;')}<div class="tdy-who">${_svSkel('sv-skeleton-line', 'width:' + w + ';height:12px;')}${_svSkel('sv-skeleton-line', 'width:90px;height:10px;margin-top:6px;')}</div>${_svSkel('sv-skeleton-pill', 'width:92px;height:30px;')}</div>`;
        return `<div class="tdy-skel" role="status" aria-label="Loading Today">
            <div class="tdy-top">${_svSkel('sv-skeleton-line', 'width:190px;height:16px;')}${_svSkel('sv-skeleton-pill', 'width:170px;height:34px;')}</div>
            ${_svSkel('sv-skeleton-pill', 'width:100%;height:10px;')}
            <div class="tdy-mrow">${_svSkel('sv-skeleton-line', 'width:130px;height:12px;')}${_svSkel('sv-skeleton-line', 'width:80px;height:12px;')}</div>
            ${_svSkel('sv-skeleton-line', 'width:min(300px,70%);height:36px;margin:4px 0 18px;')}
            <div class="tdy-rings">${[0, 1, 2, 3, 4].map(() => `<div class="tdy-rg">${_svSkel('sv-skeleton-dot', 'width:56px;height:56px;')}${_svSkel('sv-skeleton-line', 'width:70%;height:10px;')}</div>`).join('')}</div>
            <div class="tdy-ls">${['62%', '48%', '70%', '54%'].map(row).join('')}</div>
        </div>`;
    }
    function _tdyWho(me) { return me ? me.id + '|' + me.role : ''; }
    /* The per-person cache (same shape as the other tabs' localStorage
       caches: one key, a timestamp, a 24 hour limit). It holds only this
       person's filtered day, and the sign-out purge removes it. */
    function _tdyCacheRead(who) {
        try {
            const c = JSON.parse(localStorage.getItem(TDY_CACHE_KEY) || 'null');
            if (c && c.who === who && c.data && Date.now() - Number(c.at || 0) < TDY_CACHE_TTL_MS) return c.data;
        } catch (e) {}
        return null;
    }
    function _tdyCacheWrite(who, data) {
        try { localStorage.setItem(TDY_CACHE_KEY, JSON.stringify({ who, at: Date.now(), data })); } catch (e) {}
    }
    function _tdyCacheClear() { try { localStorage.removeItem(TDY_CACHE_KEY); } catch (e) {} }
    /* What to paint the moment the tab opens: the last answer for this
       person if there is one, the skeleton otherwise. */
    function renderTodayView() {
        const who = _tdyWho(_tdyIdentity());
        if (who && tdyState.who !== who) {
            const cached = _tdyCacheRead(who);
            tdyState.data = cached; tdyState.who = cached ? who : '';
        }
        return `<div class="tdy" id="tdyRoot">${who && tdyState.data && tdyState.who === who ? '' : _tdySkeletonHtml()}</div>`;
    }
    function _tdyPaint() {
        const root = document.getElementById('tdyRoot');
        if (!root) return;
        const me = _tdyIdentity();
        if (!me) { root.innerHTML = '<div class="tdy-win"><h2>Sign in to see your day.</h2><p>Today shows what is waiting on you once you pick your name in the staff menu.</p></div>'; return; }
        // A failed quiet refresh keeps the day on screen; only a first load
        // with nothing to show turns into the error card.
        if (tdyState.error && !tdyState.data) { root.innerHTML = `<div class="tdy-win" role="alert"><h2>Today could not load.</h2><p>${_calEsc(tdyState.error)}</p><button type="button" class="tdy-b p" onclick="mountTodayView()">Try again</button></div>`; return; }
        if (!tdyState.data) { if (!root.querySelector('.tdy-skel')) root.innerHTML = _tdySkeletonHtml(); return; }
        const focused = document.activeElement && root.contains(document.activeElement) ? document.activeElement.getAttribute('data-tdy-key') : '';
        const views = me.editor ? ['List', 'Deck'] : ['Rings', 'Walk-through'];
        const view = views.includes(tdyState.view) ? tdyState.view : views[0];
        root.innerHTML = me.editor ? _tdyEditorHtml(me, tdyState.data, view) : _tdySmmHtml(me, tdyState.data, view);
        // Repainting replaces the controls; put keyboard focus back on the one
        // that was just used so a keyboard user keeps their place.
        if (focused) { const back = root.querySelector('[data-tdy-key="' + focused + '"]'); if (back) back.focus(); }
    }
    /* Coming back to the browser tab reads again, quietly, keeping what is
       on screen until the answer lands. A different person signing in on
       this browser never sees the previous person's day: the sign-out purge
       clears it (_tdyPurgeSensitiveState), and the cache is keyed by person. */
    function _tdyOnVisible() {
        if (document.visibilityState !== 'visible' || !document.getElementById('tdyRoot')) return;
        mountTodayView();
    }
    /* LIVE: the same realtime client Calendar uses. Any change to a
       deliverable or a calendar post schedules one quiet re-read (bursts
       fold into one). A re-subscribe after a dropped socket re-reads too,
       since realtime does not replay what was missed. */
    let _tdyChannel = null, _tdyRtTimer = 0, _tdyRtSubscribedOnce = false;
    function _tdyOnRealtime() {
        if (!document.getElementById('tdyRoot')) return;
        clearTimeout(_tdyRtTimer);
        _tdyRtTimer = setTimeout(() => { _tdyRtTimer = 0; if (document.getElementById('tdyRoot') && !document.hidden) mountTodayView(); }, TDY_RT_DEBOUNCE_MS);
    }
    async function _tdyEnsureLive() {
        if (_tdyChannel) return;
        _tdyChannel = 'connecting';
        let client = null;
        try { client = await _calV2Client(); } catch (e) {}
        if (!client || !document.getElementById('tdyRoot')) { _tdyChannel = null; return; }
        try {
            _tdyChannel = client.channel('today_live')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'deliverables' }, _tdyOnRealtime)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_posts' }, _tdyOnRealtime)
                .subscribe(status => {
                    if (status === 'SUBSCRIBED') { if (_tdyRtSubscribedOnce) _tdyOnRealtime(); _tdyRtSubscribedOnce = true; }
                });
        } catch (e) { _tdyChannel = null; }
    }
    function _tdyStopLive() {
        clearTimeout(_tdyRtTimer); _tdyRtTimer = 0;
        const ch = _tdyChannel;
        _tdyChannel = null; _tdyRtSubscribedOnce = false;
        if (ch && typeof ch === 'object') { _calV2Client().then(c => { try { c && c.removeChannel(ch); } catch (e) {} }, () => {}); }
    }
    function _tdyPurgeSensitiveState() {
        tdyState.gen++;
        tdyState.data = null; tdyState.who = ''; tdyState.error = ''; tdyState.skipped = []; tdyState.walk = 0;
        _tdyClientRows = null;
        _tdyCacheClear();
        const root = document.getElementById('tdyRoot');
        if (root) { root.innerHTML = _tdySkeletonHtml(); mountTodayView(); }
    }
    async function mountTodayView() {
        if (!tdyState.listening) { tdyState.listening = true; document.addEventListener('visibilitychange', _tdyOnVisible); }
        const gen = ++tdyState.gen;
        try { tdyState.view = localStorage.getItem(TDY_VIEW_KEY) || ''; } catch (e) {}
        const me = _tdyIdentity();
        const who = _tdyWho(me);
        if (!me) { tdyState.data = null; tdyState.who = ''; tdyState.error = ''; _tdyPaint(); return; }
        if (who !== tdyState.who) { tdyState.data = _tdyCacheRead(who); tdyState.who = tdyState.data ? who : ''; tdyState.error = ''; }
        // Paint what we have now (the cached day, or the skeleton), then read.
        _tdyPaint();
        _tdyEnsureLive();
        try {
            const data = await _tdyLoad(me);
            if (gen !== tdyState.gen) return;
            tdyState.data = data; tdyState.who = who; tdyState.error = '';
            _tdyCacheWrite(who, data);
        } catch (e) {
            if (gen !== tdyState.gen) return;
            tdyState.error = e && (e.message === 'roster' || e.message === 'clients') ? 'Your client list could not be read. Try again in a moment.' : 'Check your connection and try again.';
        }
        _tdyPaint();
    }
    function _tdySetView(v) {
        tdyState.view = v;
        try { localStorage.setItem(TDY_VIEW_KEY, v); } catch (e) {}
        _tdyPaint();
    }
    function _tdySetJob(k) { tdyState.job = k; _tdyPaint(); }
    function _tdyWalkNext() { tdyState.walk++; _tdyPaint(); }
    function _tdySkip(id) { tdyState.skipped = tdyState.skipped.filter(x => x !== id).concat(id); _tdyPaint(); }
    function _tdyOpenSync(id) {
        try { window.open('/synclinear/' + encodeURIComponent(id), '_blank', 'noopener'); } catch (e) {}
    }
    /* Vigil's hand test, 2026-09-28: the address held only the client, so a
       reload lost the card. Write the calendar's own card deep link
       (#calendar/<slug>/<card>); the calendar keeps it and reopens it. */
    function _tdyCardInAddress(clientSlug, cardId) {
        try {
            const slug = calClientSlug(clientSlug);
            if (!slug || !cardId || currentNav !== 'calendar') return;
            const base = '/' + svRoute.search().replace(/#.*$/, '');
            history.replaceState({ nav: 'calendar', client: null }, '',
                base + '#calendar/' + slug + '/' + encodeURIComponent(cardId));
        } catch (e) {}
    }
    function _tdyOpenCard(kind, id) {
        const d = tdyState.data;
        if (!d) return;
        if (kind === 'post') {
            const p = d.posts.find(x => x.id === id);
            if (!p) return;
            const name = d.names[p.client] || p.client;
            try { svSharedClientNote(name); } catch (e) {}
            _calSetFocusRequest({ client: name, cardId: p.id });
            navTo('calendar');
            _tdyCardInAddress(p.client, p.id);
            return;
        }
        const r = d.open.find(x => x.id === id);
        if (!r) return;
        const name = d.names[r.client_slug] || r.client_slug;
        try { svSharedClientNote(name); } catch (e) {}
        wlOpenInContentCalendar(name, '', r.id);
    }
    function _tdyTeardown() { tdyState.gen++; _tdyStopLive(); }

    window._tdySetView = _tdySetView;
    window._tdySetJob = _tdySetJob;
    window._tdyWalkNext = _tdyWalkNext;
    window._tdySkip = _tdySkip;
    window._tdyOpenSync = _tdyOpenSync;
    window._tdyOpenCard = _tdyOpenCard;
    window._tdyCardInAddress = _tdyCardInAddress;
    window.mountTodayView = mountTodayView;

    /* WHICH CLIENTS BELONG TO WHICH SMM: one rule, shared by Today and the
     * main-bar client dropdown's "My clients", so the two can never disagree
     * (owner decision 2026-09-27).
     *
     *   1. Only CURRENT clients count: a client is current when it has a row in
     *      Clients Info (clientMap, the list the rest of SyncView reads). A
     *      former client leaves that sheet, so it disappears here whatever the
     *      SMM roster still says.
     *   2. The SMM roster (social_media_managers, the nightly copy of the
     *      owner's roster sheet; SyncLinear's "Social media manager" card reads
     *      it too) says which clients each SMM owns. Roster rows marked
     *      inactive are former SMMs and are ignored.
     *   3. Roster and Clients Info spell names differently, so both sides go
     *      through svClientKey: titles (Dr, Dr.), "&" versus "and",
     *      punctuation, accents, case and spacing are all ignored.
     *   4. Test clients (clients.kind = 'test') are never anyone's real
     *      client: svCurrentClients drops them, so they leave Today and the
     *      dropdown's "My clients" alike.
     *   5. Anyone on the roster sees their own clients, admins included
     *      (svScopeMode). An admin who is not on the roster sees every
     *      current client. There is no switch (owner decision 2026-09-28).
     *
     * Everything here is pure over its inputs except svCurrentClients, which
     * reads the loaded Clients Info rows. */
    const SV_CLIENT_TITLES = /^(?:dr|doctor|mr|mrs|ms|miss|prof|professor)\.?\s+/;
    function svClientKey(name) {
        let t = String(name == null ? '' : name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
        t = t.replace(SV_CLIENT_TITLES, '');
        t = t.replace(/&/g, ' and ');
        return t.replace(/[^a-z0-9]+/g, '');
    }
    /* Current clients as Map(key -> Clients Info name). Empty until Clients
       Info has loaded; callers treat empty as "not known yet", never as "no
       clients". testClients: rows of the clients table ({ slug,
       display_name, kind }); any with kind 'test' is left out, matched by
       display name or slug. */
    function svCurrentClients(names, testClients) {
        const list = Array.isArray(names) ? names : Object.keys(clientMap || {});
        const test = new Set();
        for (const c of (Array.isArray(testClients) ? testClients : [])) {
            if (!c || String(c.kind || '').toLowerCase() !== 'test') continue;
            for (const v of [c.display_name, c.slug]) { const k = svClientKey(v); if (k) test.add(k); }
        }
        const out = new Map();
        for (const n of list) { const k = svClientKey(n); if (k && !test.has(k) && !out.has(k)) out.set(k, String(n).trim()); }
        return out;
    }
    function svActiveManagers(managers) {
        return (Array.isArray(managers) ? managers : []).filter(m => m && m.active !== false && String(m.name || '').trim());
    }
    /* The roster entry for a signed-in staff member: email first, then full
       name, then a first name only one active roster entry carries. */
    function svRosterEntryFor(managers, member) {
        const norm = v => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
        const list = svActiveManagers(managers);
        const email = norm(member && member.email);
        const name = norm(member && member.name);
        const first = name.split(' ')[0];
        const byFirst = first ? list.filter(m => norm(m.name).split(' ')[0] === first) : [];
        return (email && list.find(m => norm(m.email) === email))
            || (name && list.find(m => norm(m.name) === name))
            || (byFirst.length === 1 ? byFirst[0] : null);
    }
    /* The current clients one roster entry owns, as Clients Info names. */
    function svSmmCurrentClients(entry, current) {
        if (!entry) return [];
        const cur = current instanceof Map ? current : svCurrentClients();
        const owned = new Set((Array.isArray(entry.source_clients) ? entry.source_clients : []).map(svClientKey).filter(Boolean));
        return [...cur].filter(([k]) => owned.has(k)).map(([, n]) => n);
    }
    /* Which clients a Today-style view shows: 'mine' or 'all'.
       isAdmin: the signed-in role is admin. onRoster: an active roster entry
       matched them. Only an admin who is not on the roster sees all. */
    function svScopeMode(isAdmin, onRoster) {
        return isAdmin && !onRoster ? 'all' : 'mine';
    }
    /* Current clients no active SMM lists: admins only. */
    function svUnownedCurrentClients(managers, current) {
        const cur = current instanceof Map ? current : svCurrentClients();
        const owned = new Set();
        for (const m of svActiveManagers(managers)) for (const c of (Array.isArray(m.source_clients) ? m.source_clients : [])) owned.add(svClientKey(c));
        return [...cur].filter(([k]) => !owned.has(k)).map(([, n]) => n);
    }

    /* ============================================================
       CLIENT ONBOARDING MODULE  (standalone, private-link page)
       Reachable ONLY via ?onboarding=<token>. Mirrors ?intake=1: bypasses the
       staff password, hides workspace chrome, locks the SPA to this page.
       Submit -> n8n `onboarding-submit` -> Supabase + Slack. Namespaced _ob/OB_.
       Never-lose-a-submission fallbacks (see docs/features/ONBOARDING_FALLBACK.md): the submit
       retries once, then fails over to the Supabase Edge capture, then to the n8n
       fallback webhook (n8n Data Table `onboarding_fallback`). Drafts sync to the
       same fallback store while the client types; a successful submit also sends a
       `submitted` copy there, so every submission exists in two places.
       ============================================================ */
    const ONBOARDING_SUBMIT_URL = 'https://synchrosocial.app.n8n.cloud/webhook/onboarding-submit';
    const AI_ONBOARDING_SUBMIT_URL = 'https://synchrosocial.app.n8n.cloud/webhook/ai-onboarding-submit';
    // Backup capture endpoints, tried in order after the primary fails. The Edge
    // function lives on different infrastructure than n8n (survives n8n outages and
    // *.n8n.cloud adblock rules); the n8n fallback webhook survives Supabase-side
    // failures (it writes to an n8n Data Table, not Supabase).
    const ONBOARDING_EDGE_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/onboarding-capture';
    const ONBOARDING_FALLBACK_URL = 'https://synchrosocial.app.n8n.cloud/webhook/onboarding-fallback';
    // Funnel variant: 'normal' (/onboarding_form) or 'ai' (/ai_onboarding_form). The entry
    // router sets this (and the matching draft + submission-id keys) before the form mounts.
    let OB_VARIANT = 'normal';
    let OB_DRAFT_KEY = 'syncview_onboarding_draft_v1';
    let OB_SUBID_KEY = 'syncview_onboarding_subid_v1';
    function _obSetVariant(value) { OB_VARIANT = value; }
    function _obSetDraftKey(value) { OB_DRAFT_KEY = value; }
    function _obSetSubIdKey(value) { OB_SUBID_KEY = value; }
    function _obEsc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function _obId(){ return 'o_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8); }
    // Stable submission id: minted once per funnel per browser and reused across
    // submit retries and draft backups, so the server can dedupe by primary key
    // (a retry after a lost success response answers {ok, duplicate:true} instead
    // of creating a second row). Falls back to memory when localStorage is out.
    let _obSubIdMem = '';
    function _obSubId(){
      if(_obSubIdMem) return _obSubIdMem;
      let id=''; try{ id = localStorage.getItem(OB_SUBID_KEY) || ''; }catch(e){}
      if(!id){ id=_obId(); try{ localStorage.setItem(OB_SUBID_KEY, id); }catch(e){} }
      _obSubIdMem = id; return id;
    }
    function _obClearSubId(){ _obSubIdMem=''; try{ localStorage.removeItem(OB_SUBID_KEY); }catch(e){} }
    function _obPost(url, payload, ms){
      const opts={ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) };
      try{ if(typeof AbortSignal!=='undefined' && AbortSignal.timeout) opts.signal=AbortSignal.timeout(ms||20000); }catch(e){}
      return fetch(url, opts).then(r=>{ if(!r.ok) throw new Error('HTTP '+r.status); return r.json().catch(()=>({ok:true})); });
    }
    // Backup capture: Edge first (different infra), n8n fallback webhook second.
    function _obBackupSend(payload, ms){
      return _obPost(ONBOARDING_EDGE_URL, payload, ms||12000)
        .catch(()=>_obPost(ONBOARDING_FALLBACK_URL, payload, ms||12000));
    }

    const OB_LOCK_SVG = '<svg class="ob-lock-ic" viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true"><rect x="3.1" y="7" width="9.8" height="6.4" rx="1.7" stroke="currentColor" stroke-width="1.25"/><path d="M5.4 7V5.1a2.6 2.6 0 0 1 5.2 0V7" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>';
    const OB_DRIVE_NOTE = '<div class="ob-drivenote">'+OB_LOCK_SVG+'<span>Any link works — Google Drive, Dropbox, WeTransfer, etc. If it\'s a private file, make sure it\'s shared so anyone with the link can open it.</span></div>';
    const OB_PLAY_SVG = '<svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true"><path d="M2.6 1.3 L8 5 L2.6 8.7 Z" fill="currentColor"/></svg>';
    const OB_PAUSE_SVG = '<svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true"><rect x="2.3" y="1.5" width="2" height="7" rx="0.4" fill="currentColor"/><rect x="5.7" y="1.5" width="2" height="7" rx="0.4" fill="currentColor"/></svg>';
    const OB_INFO_SVG = '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="8.2" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="6.4" r="1.05" fill="currentColor"/><path d="M10 9.3v4.7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    // Hover-affordance icons on previews: a play triangle (videos) and a maximize/expand (thumbnail).
    const OB_PLAY_BIG_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.5-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z"/></svg>';
    const OB_EXPAND_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>';
    const OB_CHECK_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true"><path d="M3.3 8.4l3 3 6.4-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    function _obInfoBtn(attr){ return '<button type="button" class="ob-i" '+attr+'>'+OB_INFO_SVG+'</button>'; }
    const OB_TEXTONLY_INFO = 'Your avatar appears in the background (an expression or a pose) while the main message is text on screen — no one is talking.';

    const OB_VOICE_SCRIPT = [
      "(Rising intonation, curious tone) <b>Have you ever stopped to wonder... why certain voices stay with you? Is it the warmth? The rhythm? Or something you simply can't explain? What if I told you — your voice is unlike anyone else's on the planet?</b>",
      "(Confident, declarative, steady pace) <b>My name is Jordan Calloway, and I've spent the last twelve years studying sound. The human voice carries more information than words alone. Every breath, every pause — it tells a story.</b>",
      "(soft, reflective) <b>It started as simple curiosity.</b> (warm, smiling) <b>Then it became a passion — something I genuinely loved.</b> (heavier, honest) <b>But honestly? There were moments I almost gave up entirely.</b> (quiet, resolved) <b>And then... everything changed.</b>",
      "(Crisp and precise — enunciate carefully) <b>On March 3rd, 2019, at exactly 11:47 AM, I recorded my first 500 samples. I worked alongside Dr. Priya Venkataraman</b> (PREE-yah Ven-kah-tah-RAH-man) <b>and a linguist named Søren Bloch</b> (SORE-en Block). <b>We used a technique called prosodic mapping — that's P-R-O-S-O-D-I-C — combined with phoneme segmentation. The result? A dataset of over 2.3 million voice fragments.</b>",
      "(Take your time — don't rush) <b>Here's what I know for certain...</b> (pause) <b>Your voice... is unique. It's you. What makes you you... is the very thing worth preserving.</b> (pause — then slowly) <b>So. Let's get started. Let's use this voice recording to clone your voice.</b>"
    ];

    // [key, label] — a ~20s preview clip per genre at onboarding-audio/<key>.mp3.
    const OB_MUSIC_GENRES = [
      ['inspirational','Inspirational'],
      ['ambient','Ambient / Cinematic'],
      ['lofi','Lofi / Chill'],
      ['piano','Emotional Piano'],
      ['guitar','Acoustic Guitar'],
      ['synth','Synth'],
      ['spiritual','Spiritual'],
      ['classical','Classical'],
      ['trending','Trending / TikTok'],
    ];

    const SC_THUMB = 'https://storage.googleapis.com/prod-sandcastles-thumbnails/';
    const OB_VID = '/onboarding-video/';
    // Step-4 worked example — a real ~30s talking-to-camera clip (a teammate) so the client sees
    // exactly what a good "sample clip of you" looks like. Web-optimized 720×1280 H.264 w/ audio.
    // The poster paints Casper's face on the tile immediately (before the video metadata loads).
    const OB_SAMPLE_EG = OB_VID+'sample-example.mp4';
    const OB_SAMPLE_EG_POSTER = OB_VID+'sample-example-poster.jpg';
    // Style cards: [key, name, desc, standardMedia, highlightMedia] — highlight is the toggle variant ('' = none).
    const OB_SUBTITLE_STYLES = [
      ['elegant','Elegant','Thin, refined serif captions.', OB_VID+'sub-elegant.mp4', OB_VID+'sub-elegant-hl.mp4'],
      ['native','Native','Clean, bold white captions.', OB_VID+'sub-native.mp4', OB_VID+'sub-native-hl.mp4'],
      ['bold','Bold','Big, heavy captions that pop.', OB_VID+'sub-bold.mp4', OB_VID+'sub-bold-hl.mp4'],
    ];
    // AI "which look" examples — shown as selectable previews (client's own reference frames).
    const OB_LOOK_TALKING = '/onboarding-ai/talking-head.jpg';
    const OB_LOOK_PODCAST = '/onboarding-ai/podcast.jpg';

    const OB_BROLL_OPTS = [ ['stock','Stock footage'], ['ai','AI-generated'], ['mix','Mix of both'], ['own','My own footage'], ['none','No B-roll'] ];

    // Thumbnail text picker: Font (3) x Style (4) x Highlight (on/off) = 24 real renders,
    // hosted in thumbnail-styles/<font>-<style>[-hl].jpg. The client builds the combo live.
    const OB_TF = '/thumbnail-styles/';
    const OB_THUMB_FONTS  = [ ['bold','Bold'], ['native','Native'], ['elegant','Elegant'] ];
    const OB_THUMB_TSTYLES = [ ['plain','Plain'], ['shadow','Shadow'], ['stroke','Stroke'], ['banner','Banner'] ];
    function _obThumbImg(font, style, hl){ return OB_TF + font + '-' + style + (hl ? '-hl' : '') + '.jpg'; }
    const OB_THUMB_DEFAULT = { font:'native', style:'plain', hl:false };

    function renderOnboardingView(){ return '<div class="ob-wrap"><div class="ob-card" id="obCard"></div></div>'; }

    function _obField(f){
      const req = f.required ? '<span class="ob-req">*</span>' : '';
      const help = f.help ? '<div class="ob-help">'+f.help+'</div>' : '';
      let inner = '';
      if(f.type==='textarea'){
        inner = '<textarea class="ob-input ob-ta" data-ob="'+f.id+'" rows="'+(f.rows||3)+'" placeholder="'+_obEsc(f.placeholder||'')+'"></textarea>';
      } else if(f.type==='select'){
        return _obCustomSelect(f);
      } else if(f.type==='radio'){
        inner = '<div class="ob-radios" data-ob-radio="'+f.id+'">'+
          f.options.map(o=>'<label class="ob-pill-opt"><input type="radio" name="'+f.id+'" value="'+_obEsc(o[0])+'"><span>'+_obEsc(o[1])+'</span></label>').join('')+'</div>';
      } else if(f.type==='multiselect'){
        const mx = f.max ? ' data-ob-max="'+f.max+'"' : '';
        const ex = f.exclusive ? ' data-ob-exclusive="'+_obEsc(f.exclusive)+'"' : '';
        inner = '<div class="ob-checks" data-ob-multi="'+f.id+'"'+mx+ex+'>'+
          f.options.map(o=>'<label class="ob-pill-opt"><input type="checkbox" value="'+_obEsc(o[0])+'"><span>'+_obEsc(o[1])+'</span></label>').join('')+'</div>';
      } else {
        const t = f.type==='email'?'email':(f.type==='tel'?'tel':(f.type==='url'?'url':'text'));
        inner = '<input class="ob-input" type="'+t+'" data-ob="'+f.id+'" placeholder="'+_obEsc(f.placeholder||'')+'">';
      }
      const note = f.driveNote ? OB_DRIVE_NOTE : '';
      return '<div class="ob-q" data-ob-q="'+f.id+'"><label class="ob-label">'+_obEsc(f.label)+req+'</label>'+help+inner+note+'</div>';
    }

    // Custom styled dropdown (not the native <select>).
    function _obCustomSelect(f){
      const req = f.required ? '<span class="ob-req">*</span>' : '';
      const help = f.help ? '<div class="ob-help">'+f.help+'</div>' : '';
      const opts = f.options.map(o=>{ const v=Array.isArray(o)?o[0]:o, l=Array.isArray(o)?o[1]:o; return '<button type="button" class="ob-cs-opt" data-cs-pick="'+f.id+'" data-cs-value="'+_obEsc(v)+'">'+_obEsc(l)+'</button>'; }).join('');
      return '<div class="ob-q" data-ob-q="'+f.id+'"><label class="ob-label">'+_obEsc(f.label)+req+'</label>'+help+
        '<div class="ob-cs"><button type="button" class="ob-cs-btn" data-cs-toggle="'+f.id+'"><span class="ob-cs-val" data-cs-val="'+f.id+'">Select…</span><span class="ob-cs-arrow"></span></button>'+
        '<div class="ob-cs-panel" data-cs-panel="'+f.id+'" style="display:none">'+opts+'</div>'+
        '<input type="hidden" data-ob="'+f.id+'"></div></div>';
    }

    function _obToggle(id,label,help){
      const h = help ? '<div class="ob-help">'+help+'</div>' : '';
      return '<div class="ob-q ob-toggle-q" data-ob-q="'+id+'"><div><label class="ob-label">'+_obEsc(label)+'</label>'+h+'</div>'+
        '<label class="ob-switch"><input type="checkbox" data-ob-toggle="'+id+'"><span class="ob-switch-track"></span></label></div>';
    }

    function _obMusic(){
      const rows = OB_MUSIC_GENRES.map(g=>
        '<div class="ob-genre"><label class="ob-genre-pick"><input type="checkbox" value="'+g[0]+'"><span class="ob-chk"></span><span class="ob-genre-name">'+_obEsc(g[1])+'</span></label>'+
        '<button type="button" class="ob-play" data-ob-play="'+g[0]+'" aria-label="Play sample">'+OB_PLAY_SVG+'</button></div>'
      ).join('');
      return '<div class="ob-q" data-ob-q="music"><label class="ob-label">Music</label>'+
        '<div class="ob-help">Tick the vibes that fit you. Tap play to hear a sample.</div>'+
        '<div class="ob-genres" data-ob-multi="music">'+rows+'</div></div>';
    }

    // A single preview tile: the clip/image (tap to play/zoom) plus a caption slot below
    // (used for the selectable Standard / +Highlight pick under each subtitle style).
    function _obStylePreview(url, isVideo, cap){
      if(!url) return '';
      const inner = isVideo
        ? '<video src="'+url+'" muted loop playsinline preload="metadata"></video><span class="ob-zoom-ic ob-zoom-ic--play">'+OB_PLAY_BIG_SVG+'</span>'
        : '<img src="'+url+'" alt="" loading="lazy"><span class="ob-zoom-ic">'+OB_EXPAND_SVG+'</span>';
      return '<div class="ob-stp"><button type="button" class="ob-sub-thumb" data-ob-zoom="'+url+'" aria-label="View example full screen">'+inner+'</button>'+cap+'</div>';
    }
    function _obStyleCards(group, items, isVideo){
      // Each preview (Standard and +Highlight) is its OWN selectable option with a radio dot that
      // fills when picked — same bullet-select feel as the cards. One radio group (subtitle_pick)
      // across all styles/variants; a change derives the hidden subtitle_style + subtitle_highlight.
      const pick = (val, st, hl, label) =>
        '<label class="ob-stp-pick"><input type="radio" name="subtitle_pick" value="'+val+'" data-style="'+st+'" data-hl="'+hl+'"><span class="ob-stp-dot"></span><span class="ob-stp-pk-txt">'+label+'</span></label>';
      return items.map(t=>{
        const std=t[3]||'', hl=t[4]||'';
        const stdPrev = _obStylePreview(std, isVideo, pick(t[0], t[0], '0', 'Subtitle'));
        const hlPrev = hl ? _obStylePreview(hl, isVideo, pick(t[0]+'__hl', t[0], '1', 'Subtitle + Highlights')) : '';
        const previews = '<div class="ob-stp-row">'+stdPrev+hlPrev+'</div>';
        const desc = t[2] ? '<div class="ob-sub-desc">'+_obEsc(t[2])+'</div>' : '';
        return '<div class="ob-stcard"><div class="ob-sub-text"><span class="ob-sub-name">'+_obEsc(t[1])+'</span>'+desc+'</div>'+previews+'</div>';
      }).join('');
    }

    // Step-4 example: a preview tile of the sample clip (a teammate talking to camera) + copy, so
    // the client can see what to record. Tap → full-screen playback with sound via _obZoom (same
    // preview + zoom mechanic as the subtitle clips; _obZoom auto-detects the .mp4 as a video).
    function _obSampleExample(){
      return '<div class="ob-q ob-sample-eg">'+
        '<button type="button" class="ob-sub-thumb ob-sample-eg-thumb" data-ob-zoom="'+OB_SAMPLE_EG+'" aria-label="Play the example sample clip full screen">'+
          '<video src="'+OB_SAMPLE_EG+'" poster="'+OB_SAMPLE_EG_POSTER+'" muted loop playsinline preload="metadata"></video>'+
          '<span class="ob-zoom-ic ob-zoom-ic--play">'+OB_PLAY_BIG_SVG+'</span>'+
        '</button>'+
        '<div class="ob-sample-eg-body">'+
          '<div class="ob-sample-eg-title">Here\'s an example</div>'+
          '<div class="ob-sample-eg-desc">This is exactly what we mean — one of our team just talking to the camera like a normal video. <b>Tap to watch.</b> Yours doesn\'t need to be scripted or polished; a quick, natural ~30-second take on your phone is perfect.</div>'+
        '</div>'+
      '</div>';
    }

    function _obSubtitles(){
      return '<div class="ob-q" data-ob-q="subtitle_style"><label class="ob-label">Subtitle style<span class="ob-req">*</span></label>'+
        '<div class="ob-help">Tap a preview to play it, then click the dot under the look you want — pick the plain <b>Subtitle</b> or the <b>Subtitle + Highlights</b> version, where a key word pops in colour.</div>'+
        '<div class="ob-stgrid">'+_obStyleCards('subtitle_style', OB_SUBTITLE_STYLES, true)+'</div>'+
        // hidden carriers (set from the visible picks) — keep subtitle_style + subtitle_highlight
        // exactly as before, so serialization, validation and the dashboard viewer are unchanged.
        '<input type="hidden" data-ob="subtitle_style">'+
        '<input type="checkbox" data-ob-toggle="subtitle_highlight" hidden></div>';
    }

    // Live thumbnail-text picker: a preview that swaps in place + tight controls beside it
    // (font / style / highlight), so the cursor barely moves. The current trio is the saved pick.
    function _obThumbPicker(){
      const d = OB_THUMB_DEFAULT;
      const seg = (group, opts, cur) => '<div class="ob-seg" data-ob-tp="'+group+'">'+
        opts.map(o=>'<button type="button" class="ob-seg-btn'+(o[0]===cur?' sel':'')+'" data-ob-tp-opt="'+group+':'+o[0]+'">'+_obEsc(o[1])+'</button>').join('')+'</div>';
      return '<div class="ob-q" data-ob-q="thumbnail">'+
        '<label class="ob-label">Thumbnail style</label>'+
        '<div class="ob-toggle-q ob-tp-buildrow"><div><span class="ob-tp-buildlbl">Build my own thumbnail look</span>'+
          '<div class="ob-help">Switch this off and we\'ll design the thumbnail for you.</div></div>'+
          '<label class="ob-switch"><input type="checkbox" data-ob-toggle="thumbnail_build" checked><span class="ob-switch-track"></span></label></div>'+
        '<div class="ob-tp-wrap" id="obThumbWrap">'+
          '<div class="ob-help ob-tp-help">Pick a font and a style, and flip on a highlighted line — the preview updates as you go.</div>'+
          '<div class="ob-tp">'+
            '<button type="button" class="ob-tp-prev" data-ob-zoom="'+_obThumbImg(d.font,d.style,d.hl)+'" aria-label="View full screen">'+
              '<img class="ob-tp-img" id="obThumbImg" src="'+_obThumbImg(d.font,d.style,d.hl)+'" alt="Thumbnail preview">'+
              '<span class="ob-zoom-ic">'+OB_EXPAND_SVG+'</span></button>'+
            '<div class="ob-tp-ctrls">'+
              '<div class="ob-tp-row"><span class="ob-tp-lbl">Font</span>'+seg('font', OB_THUMB_FONTS, d.font)+'</div>'+
              '<div class="ob-tp-row"><span class="ob-tp-lbl">Style</span>'+seg('style', OB_THUMB_TSTYLES, d.style)+'</div>'+
              '<div class="ob-tp-row ob-tp-hlrow"><span class="ob-tp-lbl">Highlight</span>'+
                '<label class="ob-switch"><input type="checkbox" data-ob-toggle="thumbnail_highlight"'+(d.hl?' checked':'')+'><span class="ob-switch-track"></span></label></div>'+
            '</div>'+
          '</div>'+
          '<div class="ob-info-panel ob-tp-note">This is just to point us in the right direction — nothing here is locked in. Treat it as inspiration: the font, the highlight colour, the music and anything else can all change as we work together. We also bring our professional design input to make sure the final style best suits your content and overall brand.</div>'+
        '</div>'+
        '<input type="hidden" data-ob="thumbnail_font" value="'+d.font+'">'+
        '<input type="hidden" data-ob="thumbnail_text_style" value="'+d.style+'"></div>';
    }
    // Show/hide the picker based on the "build my own" toggle.
    function _obThumbBuildSync(){
      const t=document.querySelector('[data-ob-toggle="thumbnail_build"]'); const wrap=document.getElementById('obThumbWrap');
      if(wrap) wrap.style.display = (!t || t.checked) ? '' : 'none';
    }
    // Reflect the current font/style/highlight into the preview, zoom target and selected buttons.
    function _obThumbSync(){
      const fEl=document.querySelector('[data-ob="thumbnail_font"]'); const sEl=document.querySelector('[data-ob="thumbnail_text_style"]');
      const hEl=document.querySelector('[data-ob-toggle="thumbnail_highlight"]'); const img=document.getElementById('obThumbImg');
      if(!fEl||!sEl||!img) return;
      const font=fEl.value||OB_THUMB_DEFAULT.font, style=sEl.value||OB_THUMB_DEFAULT.style, hl=!!(hEl&&hEl.checked);
      const url=_obThumbImg(font,style,hl);
      if(img.getAttribute('src')!==url) img.setAttribute('src',url);
      const prev=img.closest('.ob-tp-prev'); if(prev) prev.setAttribute('data-ob-zoom',url);
      document.querySelectorAll('[data-ob-tp="font"] .ob-seg-btn').forEach(b=>b.classList.toggle('sel', b.getAttribute('data-ob-tp-opt')==='font:'+font));
      document.querySelectorAll('[data-ob-tp="style"] .ob-seg-btn').forEach(b=>b.classList.toggle('sel', b.getAttribute('data-ob-tp-opt')==='style:'+style));
    }
    // Preload every combo so the preview swaps with no flicker.
    function _obThumbPreload(){
      OB_THUMB_FONTS.forEach(f=>OB_THUMB_TSTYLES.forEach(s=>[false,true].forEach(hl=>{ const im=new Image(); im.src=_obThumbImg(f[0],s[0],hl); })));
    }

    // Enable a group's Highlight toggle only when a style with a highlight variant is selected.
    // Sync the per-style "+ Add highlight" pills to the current selection + add-on state.
    // The pill on the SELECTED style reads "Highlight on" when the add-on is on; the others
    // invite turning it on. subtitle_highlight is one boolean (a hidden checkbox carrier).
    // A subtitle pick was made: write the chosen style + highlight into the hidden carriers.
    function _obPickSubtitle(radio){
      const s=document.querySelector('input[data-ob="subtitle_style"]');
      const c=document.querySelector('[data-ob-toggle="subtitle_highlight"]');
      if(s) s.value = radio.getAttribute('data-style')||'';
      if(c) c.checked = radio.getAttribute('data-hl')==='1';
    }
    // Reflect the hidden subtitle_style + subtitle_highlight carriers onto the visible picks
    // (used on restore / mount so a saved choice shows its filled dot).
    function _obStyleSel(){
      const s=document.querySelector('input[data-ob="subtitle_style"]');
      const c=document.querySelector('[data-ob-toggle="subtitle_highlight"]');
      const style=s?s.value:''; const hl=!!(c&&c.checked);
      const want = style ? (style + (hl?'__hl':'')) : '';
      document.querySelectorAll('input[name="subtitle_pick"]').forEach(r=>{ r.checked=(r.value===want); });
    }
    // Reveal the optional "link to your B-roll footage" field only when "My own footage" is picked.
    function _obBrollSync(){
      const r=document.querySelector('input[name="broll"]:checked');
      const bl=document.getElementById('obBrollLink');
      if(bl) bl.style.display=(r&&r.value==='own')?'block':'none';
    }

    function _obBroll(){ return _obField({ id:'broll', label:'B-roll', help:'Extra footage laid over your talking. Pick one.', type:'radio', options:OB_BROLL_OPTS }); }

    // AI "which look" — multiselect chips, each with an ⓘ that opens an example frame.
    function _obLook(){
      // Show the example frames up front (no ⓘ to click) and let the client tick the look(s)
      // they want — same preview + select feel as the subtitle styles. Multi-select (one or both).
      const opt = (val, img, label) =>
        '<div class="ob-stp">'+
          '<button type="button" class="ob-sub-thumb" data-ob-zoom="'+img+'" aria-label="View '+_obEsc(label)+' full screen"><img src="'+img+'" alt="'+_obEsc(label)+'" loading="lazy"><span class="ob-zoom-ic">'+OB_EXPAND_SVG+'</span></button>'+
          '<label class="ob-genre-pick ob-look-pick"><input type="checkbox" name="ai_content_style" value="'+val+'"><span class="ob-chk"></span><span class="ob-stp-pk-txt">'+label+'</span></label>'+
        '</div>';
      return '<div class="ob-q" data-ob-q="ai_content_style"><label class="ob-label">Which look do you prefer?<span class="ob-req">*</span></label>'+
        '<div class="ob-help">Tap a preview to see it full screen, then tick the look(s) you want — pick one or both.</div>'+
        '<div class="ob-stp-row ob-look-row" data-ob-multi="ai_content_style">'+
          opt('talking_head', OB_LOOK_TALKING, 'Talking to camera')+
          opt('podcast', OB_LOOK_PODCAST, 'Podcast style')+
        '</div></div>';
    }

    function _obTextDriven(){
      return '<div class="ob-q" data-ob-q="ai_text_driven"><label class="ob-label">Also make text-only videos (no speaking)?<span class="ob-req">*</span> '+
        _obInfoBtn('data-ob-info="textonly" aria-label="What are text-only videos"')+'</label>'+
        '<div class="ob-info-panel" data-ob-info-panel="textonly" style="display:none">'+OB_TEXTONLY_INFO+'</div>'+
        '<div class="ob-radios" data-ob-radio="ai_text_driven"><label class="ob-pill-opt"><input type="radio" name="ai_text_driven" value="yes"><span>Yes</span></label>'+
        '<label class="ob-pill-opt"><input type="radio" name="ai_text_driven" value="no"><span>No</span></label></div></div>';
    }

    function _obAccessories(){
      const opts=[['glasses','Glasses'],['watch','Watch'],['jewelry','Jewelry'],['hat','Hat'],['other','Other'],['none','None']];
      return '<div class="ob-q" data-ob-q="ai_accessories"><label class="ob-label">Accessories</label>'+
        '<div class="ob-checks" data-ob-multi="ai_accessories">'+
          opts.map(o=>'<label class="ob-pill-opt"><input type="checkbox" value="'+o[0]+'"><span>'+o[1]+'</span></label>').join('')+'</div>'+
        '<input class="ob-input ob-other-field" data-ob="ai_accessories_other" type="text" placeholder="What accessory?" style="display:none;margin-top:8px"></div>';
    }

    function _obRepRowHtml(rep, first){
      const x = first ? '' : '<button type="button" class="ob-rep-x" aria-label="Remove row">×</button>';
      if(rep==='creators') return '<div class="ob-rep-row"><input class="ob-input" data-rep="creators" data-rep-k="link" type="url" placeholder="Creator link"><input class="ob-input" data-rep="creators" data-rep-k="model" type="text" placeholder="What to model from them?">'+x+'</div>';
      return '<div class="ob-rep-row"><input class="ob-input" data-rep="clips" data-rep-k="link" type="url" placeholder="Paste a link">'+x+'</div>';
    }
    function _obCreators(){
      return '<div class="ob-q" data-ob-q="creators"><label class="ob-label">Creators for inspiration</label>'+
        '<div class="ob-help">Anyone whose style you\'d like us to model after.</div>'+
        '<div class="ob-rep" id="obCreators">'+_obRepRowHtml('creators', true)+'</div>'+
        '<button type="button" class="ob-add" data-rep-add="creators">+ Add another</button></div>';
    }
    function _obAiLikeness(){ return '<div class="ob-q" data-ob-q="ai_likeness" id="obAiLikenessWrap"></div>'; }

    // A nested group with a subtle coloured rail, so the eye reads the hierarchy
    // (Section -> sub-group -> field). `color` is an analogous neighbour of the
    // parent section's colour, so a section + its sub-groups read as one family
    // rather than a rainbow.
    function _obSubgroup(title, color, fieldsHtml){
      const chev = '<svg class="ob-sg-chev" viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      return '<div class="ob-subgroup" style="--sg-rail:'+color+';--sg-dot:'+color+'">'+
        '<span class="ob-crail" data-ob-rail role="button" tabindex="0" aria-label="Collapse or expand '+_obEsc(title)+'"></span>'+
        '<div class="ob-subhead" data-ob-collapse-sg role="button" tabindex="0"><span class="ob-sg-dot"></span><span class="ob-sg-title">'+_obEsc(title)+'</span>'+chev+'</div>'+
        '<div class="ob-sg-body"><div class="ob-sg-inner">'+fieldsHtml.join('')+'</div></div></div>';
    }
    // Collapse/expand a sub-group. Keep overflow hidden during the animation, then restore
    // visible once expanded so custom-select dropdowns inside aren't clipped.
    function _obToggleSubgroup(sg){
      const inner = sg.querySelector('.ob-sg-inner'); const body = sg.querySelector('.ob-sg-body');
      const collapsing = !sg.classList.contains('collapsed');
      if(inner) inner.style.overflow='hidden';
      sg.classList.toggle('collapsed', collapsing);
      if(!collapsing && body){
        const onEnd=(e)=>{ if(e.target!==body || e.propertyName!=='grid-template-rows') return; body.removeEventListener('transitionend', onEnd); if(inner && !sg.classList.contains('collapsed')) inner.style.overflow=''; };
        body.addEventListener('transitionend', onEnd);
      }
    }

    function _obSections(){
      const _ai = (OB_VARIANT === 'ai');
      const _all = [
        { id:'s1', n:'1', c:'var(--sv-misc-5f86df)', title:'Basic info', fields:[
          _obField({id:'first_name', label:'First name', type:'text', required:true}),
          _obField({id:'last_name', label:'Last name', type:'text', required:true}),
          _obField({id:'email', label:'Email', type:'email', required:true}),
          _obField({id:'phone', label:'Phone', type:'tel', required:true}),
          _obField({id:'comms_people', label:'Anyone else we should keep in the loop?', help:'Name + email.', type:'textarea', rows:2}),
          _obField({id:'accounting_contact', label:'Billing contact', help:'Who we send invoices to.', type:'text'}),
        ]},
        { id:'s2', n:'2', c:'var(--sv-misc-6f78e2)', title:'Your brand & audience', fields:[
          _obField({id:'brand_guidelines', label:'Brand guidelines link', help:'Logos, colours, fonts — if you have them.', type:'url', placeholder:'https://…'}),
          _obField({id:'ideal_customer', label:'Who is your IDEAL target customer?', help:'The more detail, the better.', type:'textarea', required:true}),
          _obField({id:'pain_points', label:'What are the PAIN points of the customers you help?', help:'The more detail, the better.', type:'textarea', required:true}),
          _obField({id:'desired_outcomes', label:'What are the DESIRED OUTCOMES of the customers you help?', help:'The more detail, the better.', type:'textarea', required:true}),
          _obField({id:'process', label:'What is your PROCESS for helping clients get from where they are to where they want to go?', help:'The more detail, the better.', type:'textarea', required:true}),
        ]},
        { id:'s3', n:'3', c:'var(--sv-misc-8a6fe0)', title:'Style', intro:'Tell us the direction you want for your videos. None of this is locked in — it just points us the right way, and we fine-tune everything (fonts, colours, music, the lot) together as we go.', fields:[
          _obCreators(),
          _obSubgroup('Video', 'var(--sv-bg-6f8be8)', [
            _obSubtitles(),
            '<div class="ob-info-panel ob-tp-note">This is just to point us in the right direction — nothing here is locked in. Treat it as inspiration: the subtitles, the highlight colour, the music and anything else can all change as we work together. We also bring our professional design input to make sure the final style best suits your content and overall brand.</div>',
            _obBroll(),
            '<div class="ob-q" id="obBrollLink" data-ob-q="broll_link" style="display:none"><label class="ob-label">Link to your B-roll footage (optional)</label><div class="ob-help">If you have your own footage you\'d like us to use, drop a link here.</div><input class="ob-input" type="url" data-ob="broll_link" placeholder="Paste any link…">'+OB_DRIVE_NOTE+'</div>',
            _obMusic(),
            _obField({id:'music_refs', label:'Music reference (optional)', help:'A link to a song or two whose style you like — Spotify, YouTube, Apple Music, SoundCloud, whatever you use.', type:'url', placeholder:'Paste any link…'}),
            _obField({id:'video_reference', label:'Video reference — links (optional)', help:'Paste links to videos or reels whose look you like.', type:'textarea', rows:2, placeholder:'Paste any links…'}),
            _obField({id:'video_reference_desc', label:'…or describe the video look you want (optional)', help:'In your own words — editing, captions, fonts, pacing, vibe.', type:'textarea', rows:2, placeholder:'Describe what you\'re going for…'}),
          ]),
          _obSubgroup('Thumbnail', 'var(--sv-bg-a073e0)', [
            _obThumbPicker(),
            _obField({id:'thumbnail_reference', label:'Thumbnail reference — links (optional)', help:'Paste links or images of thumbnails / covers you like (Pinterest, screenshots, etc.).', type:'textarea', rows:2, placeholder:'Paste any links…'}),
            _obField({id:'thumbnail_reference_desc', label:'…or describe the thumbnail you want (optional)', help:'In your own words — colours, text, style, mood.', type:'textarea', rows:2, placeholder:'Describe what you\'re going for…'}),
          ]),
          _obSubgroup('Anything else', 'var(--sv-bg-c46fc6)', [
            _obField({id:'dos_donts', label:'Anything we must always include, or never include?', help:'Anything we should keep in mind for every video.', type:'textarea', rows:2}),
          ]),
        ]},
        { id:'s4', n:'4', c:'var(--sv-misc-a063d8)', title:'Sample video', intro:'Before we produce your first real video, we\'ll make a few short sample edits — showing different subtitle styles, thumbnails and looks — so you can see your options and pick what feels right. To make those samples look like your actual videos, the single most useful thing you can give us is a short clip of you (below).', fields:[
          _obSampleExample(),
          _obField({id:'sample_clip', label:'A sample clip of you (optional but ideal)', help:'Record ~30 seconds talking to the camera like a normal video, and paste the link.', type:'url', placeholder:'https://…', driveNote:true}),
        ]},
        { id:'s5', n:'5', c:'var(--sv-misc-b65fce)', title:'Photos & source material', intro:'All optional — share whatever you already have.', fields:[
          _obField({id:'photos_link', label:'Link to photos of you', help:'A few clear, recent, high-quality photos.', type:'url', placeholder:'https://…', driveNote:true}),
          _obField({id:'source_material', label:'Content to pull from', help:'Podcasts, talks, videos — anything we can create from. Any link works: a Google Drive/Dropbox folder, a YouTube channel, a podcast, etc.', type:'url', placeholder:'Paste any link…', driveNote:true}),
        ]},
        { id:'s6', n:'6', c:'var(--sv-misc-c560bc)', title:'Goals', fields:[
          _obField({id:'success', label:'What would make this a win for you?', type:'textarea', required:true}),
          _obField({id:'anything_else', label:'Anything else we should know?', type:'textarea'}),
          _obField({id:'questions', label:'Questions or anything unclear?', help:'If none of the options above fit what you had in mind, or you\'re unsure about anything, ask away here.', type:'textarea'}),
        ]},
        { id:'s7', n:'7', c:'var(--sv-misc-cf64a2)', title:'Account access', intro:'So we can publish for you. Stored securely.', fields:[
          '<div class="ob-q"><div class="ob-info-panel">Prefer not to type passwords here? You can share them securely through <b>LastPass</b> to <b>house@synchrosocial.com</b> — we get access without the passwords ever being visible. Otherwise, just fill in what you can below.</div></div>',
          _obField({id:'instagram', label:'Instagram login', help:'e.g. yourbrand / Mypassword123', placeholder:'username / password', type:'text'}),
          _obField({id:'instagram_backup', label:'Instagram backup code', help:'Settings → Security → Two-factor → Backup codes.', type:'text'}),
          _obField({id:'tiktok', label:'TikTok login', help:'e.g. yourbrand / Mypassword123', placeholder:'username / password', type:'text'}),
          _obField({id:'facebook', label:'Facebook login', help:'e.g. you@email.com / Mypassword123', placeholder:'email / password', type:'text'}),
          _obField({id:'linkedin', label:'LinkedIn login', help:'e.g. you@email.com / Mypassword123', placeholder:'email / password', type:'text'}),
          _obField({id:'youtube', label:'YouTube access', help:'Invite house@synchrosocial.com via YouTube Studio, or leave blank.', type:'text'}),
          '<div class="ob-q"><label class="ob-genre-pick ob-lp-check"><input type="checkbox" data-ob-toggle="lastpass_sent"><span class="ob-chk"></span><span>Sharing through <b>LastPass</b> instead of typing passwords above? Tick this once you\'ve sent your logins to <b>house@synchrosocial.com</b> — so we know to look for them.</span></label></div>',
        ]},
        { id:'s8', n:'8', c:'var(--sv-misc-d36f93)', title:'AI avatar', isAi:true, intro:'A realistic version of you that can deliver videos without filming. Tell us how you\'d like your avatar to look, sound and feel.', fields:[
          '<div id="obAiFields" class="ob-ai-fields">'+
            _obSubgroup('Your likeness', 'var(--sv-bg-c56fc0)', [
              _obAiLikeness(),
            ])+
            _obSubgroup('Personality & delivery', 'var(--sv-bg-d16fa6)', [
              _obField({id:'ai_personality', label:'How would you describe your personality?', type:'textarea', required:true}),
              _obLook(),
              _obTextDriven(),
            ])+
            _obSubgroup('Scene & framing', 'var(--sv-bg-db6f93)', [
              _obField({id:'ai_setting', label:'What setting / background do you picture?', type:'textarea', rows:2, required:true}),
              _obField({id:'ai_podcast_setting', label:'Podcast setting', type:'select', options:[['studio','Studio desk with mics'],['lounge','Casual lounge'],['office','Office / bookshelf'],['minimal','Plain backdrop']]}),
              _obField({id:'ai_framing', label:'Camera framing', type:'select', required:true, options:[['closeup','Close-up'],['mid','Mid-shot'],['wide','Wide'],['mixed','Mixed']]}),
            ])+
            _obSubgroup('Appearance', 'var(--sv-bg-d3839f)', [
              _obField({id:'ai_hair', label:'Hair', help:'How you\'d like the avatar\'s hair — e.g. short, long, tied back, natural, styled.', type:'text'}),
              _obField({id:'ai_makeup', label:'Makeup', help:'The makeup look — e.g. natural, none, light, bold / glam.', type:'text'}),
              _obField({id:'ai_clothing', label:'Clothing (up to 3)', type:'multiselect', max:3, required:true, options:[['formal','Formal / suit'],['smart_casual','Smart casual'],['casual','Casual'],['streetwear','Streetwear'],['athletic','Activewear'],['branded','Branded merch'],['elegant','Elegant']]}),
              _obAccessories(),
            ])+
            _obSubgroup('Voice', 'var(--sv-bg-cc77bf)', [
              '<div class="ob-q" data-ob-q="ai_voice_link"><label class="ob-label">Voice recording<span class="ob-req">*</span></label>'+
                '<div class="ob-help">Read the script below in a quiet room (phone is fine) and paste the link.</div>'+
                '<div class="ob-script">'+OB_VOICE_SCRIPT.map(p=>'<p>'+p+'</p>').join('')+'</div>'+
                '<input class="ob-input" type="url" data-ob="ai_voice_link" placeholder="https://…">'+OB_DRIVE_NOTE+'</div>',
              _obField({id:'ai_voice_samples', label:'More voice recordings (optional, but the more the better)', help:'On top of the script above, drop a link (Google Drive, Dropbox, etc.) to as many high-quality recordings of your voice as you can — podcasts, talks, voice notes, anything clear and natural. Around 3 hours is ideal; 2 hours is great; otherwise just as much as you can gather.', type:'url', placeholder:'https://…', driveNote:true}),
            ])+
          '</div>',
        ]},
      ];
      // Variant filtering: the standard funnel drops the AI section; the AI funnel drops the
      // Sample-video section and keeps the (gate-less) AI section. Then renumber + recolour by
      // final position so the section gradient stays smooth in both.
      const _RAMP = ['var(--sv-misc-5f86df)','var(--sv-misc-6f78e2)','var(--sv-misc-8a6fe0)','var(--sv-misc-a063d8)','var(--sv-misc-b65fce)','var(--sv-misc-c560bc)','var(--sv-misc-cf64a2)','var(--sv-misc-d36f93)'];
      const _list = _all.filter(function(s){
        if (s.id === 's8') return _ai;     // AI avatar — AI funnel only
        if (s.id === 's4') return !_ai;    // Sample video — standard funnel only
        return true;
      });
      _list.forEach(function(s, i){ s.n = String(i + 1); s.c = _RAMP[i] || s.c; });
      return _list;
    }

    function mountOnboardingView(){
      _obInjectStyles();
      const card = document.getElementById('obCard'); if(!card) return;
      const sections = _obSections();
      const head = '<div class="ob-headblock">'+
        '<div class="ob-brand"><span class="ob-logo-wrap"><img class="ob-logo" src="/synchro-social-logo.png" alt="Synchro Social"></span>'+
        '<span class="ob-kicker ob-brand-kicker">Client Onboarding</span></div>'+
        '<h1 class="ob-title">Let\'s set up your content</h1>'+
        '<p class="ob-sub">The more you tell us, the faster we make content that feels like you. Saved as you go.</p></div>';
      const rail = '<div class="ob-rail">'+sections.map(s=>'<button type="button" class="ob-rail-btn" data-ob-go="'+s.id+'">'+s.n+'. '+_obEsc(s.title)+'</button>').join('')+'</div>';
      const chev = '<svg class="ob-sec-chev" viewBox="0 0 16 16" width="17" height="17" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const body = sections.map(s=>{
        const intro = s.intro ? '<p class="ob-sec-intro">'+_obEsc(s.intro)+'</p>' : '';
        return '<section class="ob-sec" id="'+s.id+'" style="--sec-rail:'+(s.c||'var(--ob-accent)')+'">'+
          '<span class="ob-crail" data-ob-rail role="button" tabindex="0" aria-label="Collapse or expand '+_obEsc(s.title)+'"></span>'+
          '<div class="ob-sec-h" data-ob-collapse role="button" tabindex="0"><span class="ob-sec-n">'+s.n+'</span><h2>'+_obEsc(s.title)+'</h2>'+chev+'</div>'+
          '<div class="ob-sec-body"><div class="ob-sec-inner">'+intro+s.fields.join('')+'</div></div></section>';
      }).join('');
      const footer = '<div class="ob-footer"><div class="ob-err" id="obErr" style="display:none"></div><button type="button" class="ob-submit" id="obSubmit">Submit</button></div>';
      card.innerHTML = head + rail + '<form id="obForm" autocomplete="off" novalidate>' + body + footer + '</form>';
      if(!document.getElementById('obTop')){
        const b=document.createElement('button'); b.id='obTop'; b.className='ob-top'; b.type='button'; b.setAttribute('aria-label','Back to top'); b.innerHTML='<svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true"><path d="M8 12.5V4M4.5 7.5L8 4l3.5 3.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        b.addEventListener('click', ()=>window.scrollTo({top:0,behavior:'smooth'}));
        document.body.appendChild(b);
        window.addEventListener('scroll', _obToggleTop, {passive:true}); _obToggleTop();
      }
      if(!_obDocClickBound){ document.addEventListener('click', _obDocClick); _obDocClickBound=true; }
      _obWire(); _obThumbPreload(); _obThumbSync(); _obThumbBuildSync(); _obUpdateLikeness(); _obRestoreDraft();
    }

    function _obToggleTop(){ const b=document.getElementById('obTop'); if(b) b.classList.toggle('show', window.scrollY>300); }
    let _obDocClickBound=false;
    function _obDocClick(e){ if(!(e.target.closest && e.target.closest('.ob-cs'))) document.querySelectorAll('.ob-cs-panel').forEach(p=>p.style.display='none'); }

    function _obWire(){
      const form = document.getElementById('obForm'); if(!form) return;
      form.addEventListener('change', e=>{
        const t = e.target;
        if(t.name==='ai_avatar'){ _obToggleAi(t.value); }
        if(t.getAttribute && t.getAttribute('data-ob')==='ai_use_existing'){ _obUpdateLikenessVisibility(); }
        if(t.name==='ai_content_style'){ _obTogglePodcast(); }
        if(t.name==='subtitle_pick'){ _obPickSubtitle(t); }
        if(t.name==='broll'){ _obBrollSync(); }
        if(t.getAttribute && t.getAttribute('data-ob-toggle')==='thumbnail_highlight'){ _obThumbSync(); }
        if(t.getAttribute && t.getAttribute('data-ob-toggle')==='thumbnail_build'){ _obThumbBuildSync(); }
        // Exclusive option: picking it clears the rest; picking anything else clears it.
        const exm = t.closest && t.closest('[data-ob-multi][data-ob-exclusive]');
        if(exm && t.type==='checkbox' && t.checked){
          const exv = exm.getAttribute('data-ob-exclusive');
          if(t.value===exv){ exm.querySelectorAll('input').forEach(i=>{ if(i.value!==exv) i.checked=false; }); }
          else { const n=exm.querySelector('input[value="'+exv+'"]'); if(n) n.checked=false; }
        }
        // accessories "other" field
        const am = t.closest && t.closest('[data-ob-multi="ai_accessories"]');
        if(am){ const other=am.querySelector('input[value="other"]'); const fld=document.querySelector('[data-ob="ai_accessories_other"]'); if(fld) fld.style.display=(other&&other.checked)?'block':'none'; }
        const wrap = t.closest && t.closest('[data-ob-multi][data-ob-max]');
        if(wrap && t.type==='checkbox'){ const max=parseInt(wrap.getAttribute('data-ob-max'),10); if(wrap.querySelectorAll('input:checked').length>max){ t.checked=false; _obFlash('Up to '+max+'.'); } }
        _obSaveDraftDebounced();
      });
      form.addEventListener('input', e=>{
        const id = e.target && e.target.getAttribute && e.target.getAttribute('data-ob');
        if(id==='photos_link') _obUpdateLikeness();
        _obSaveDraftDebounced();
      });
      form.addEventListener('click', e=>{
        const col = e.target.closest && e.target.closest('[data-ob-collapse]'); if(col){ const sec=col.closest('.ob-sec'); if(sec) sec.classList.toggle('collapsed'); return; }
        const sgh = e.target.closest && e.target.closest('[data-ob-collapse-sg]'); if(sgh){ const sg=sgh.closest('.ob-subgroup'); if(sg) _obToggleSubgroup(sg); return; }
        const rail = e.target.closest && e.target.closest('[data-ob-rail]'); if(rail){ const cont=rail.parentElement; if(cont && cont.classList.contains('ob-subgroup')) _obToggleSubgroup(cont); else if(cont && cont.classList.contains('ob-sec')) cont.classList.toggle('collapsed'); return; }
        const tp = e.target.closest && e.target.closest('[data-ob-tp-opt]'); if(tp){ e.preventDefault(); const parts=tp.getAttribute('data-ob-tp-opt').split(':'); const sel=document.querySelector('[data-ob="thumbnail_'+(parts[0]==='font'?'font':'text_style')+'"]'); if(sel){ sel.value=parts[1]; } _obThumbSync(); _obSaveDraftDebounced(); return; }
        const play = e.target.closest && e.target.closest('.ob-play'); if(play){ e.preventDefault(); _obPlayMusic(play); return; }
        const zoom = e.target.closest && e.target.closest('[data-ob-zoom]'); if(zoom){ e.preventDefault(); _obZoom(zoom.getAttribute('data-ob-zoom')); return; }
        const info = e.target.closest && e.target.closest('[data-ob-info]'); if(info){ e.preventDefault(); const k=info.getAttribute('data-ob-info'); const pan=document.querySelector('[data-ob-info-panel="'+k+'"]'); if(pan) pan.style.display = pan.style.display==='none'?'block':'none'; return; }
        const csT = e.target.closest && e.target.closest('[data-cs-toggle]'); if(csT){ e.preventDefault(); _obToggleSelect(csT.getAttribute('data-cs-toggle')); return; }
        const csP = e.target.closest && e.target.closest('[data-cs-pick]'); if(csP){ e.preventDefault(); _obPickSelect(csP.getAttribute('data-cs-pick'), csP.getAttribute('data-cs-value'), csP.textContent); return; }
        const repAdd = e.target.closest && e.target.closest('[data-rep-add]'); if(repAdd){ e.preventDefault(); _obRepAdd(repAdd.getAttribute('data-rep-add')); return; }
        const repX = e.target.closest && e.target.closest('.ob-rep-x'); if(repX){ e.preventDefault(); _obRepRemove(repX); return; }
      });
      // sample_clip is a normal field — keep likeness in sync on its input
      const sc = form.querySelector('[data-ob="sample_clip"]'); if(sc) sc.addEventListener('input', _obUpdateLikeness);
      document.querySelectorAll('[data-ob-go]').forEach(b=>b.addEventListener('click',()=>{ const el=document.getElementById(b.getAttribute('data-ob-go')); if(el){ el.classList.remove('collapsed'); el.scrollIntoView({behavior:'smooth',block:'start'}); } }));
      form.addEventListener('keydown', e=>{
        if(e.key!=='Enter' && e.key!==' ') return;
        const col=e.target.closest && e.target.closest('[data-ob-collapse]'); if(col){ e.preventDefault(); const sec=col.closest('.ob-sec'); if(sec) sec.classList.toggle('collapsed'); return; }
        const sgh=e.target.closest && e.target.closest('[data-ob-collapse-sg]'); if(sgh){ e.preventDefault(); const sg=sgh.closest('.ob-subgroup'); if(sg) _obToggleSubgroup(sg); return; }
        const rail=e.target.closest && e.target.closest('[data-ob-rail]'); if(rail){ e.preventDefault(); const cont=rail.parentElement; if(cont && cont.classList.contains('ob-subgroup')) _obToggleSubgroup(cont); else if(cont && cont.classList.contains('ob-sec')) cont.classList.toggle('collapsed'); }
      });
      const ib=document.getElementById('obAiInfoBtn'); if(ib) ib.addEventListener('click', ()=>{ const p=document.getElementById('obAiInfo'); if(p) p.style.display = p.style.display==='none'?'block':'none'; });
      const sb=document.getElementById('obSubmit'); if(sb) sb.addEventListener('click', _obSubmit);
      // Last-gasp draft flush when the tab hides or closes (in-app browsers fire
      // pagehide unreliably, so visibilitychange->hidden is the primary signal).
      if(!_obBeaconBound){
        _obBeaconBound=true;
        window.addEventListener('pagehide', _obDraftBeacon);
        document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='hidden') _obDraftBeacon(); });
      }
    }
    let _obBeaconBound=false;

    // ---- custom select ----
    function _obToggleSelect(id){ const pan=document.querySelector('[data-cs-panel="'+id+'"]'); if(!pan) return; const open=pan.style.display!=='none'; document.querySelectorAll('.ob-cs-panel').forEach(p=>p.style.display='none'); pan.style.display=open?'none':'block'; }
    function _obPickSelect(id,val,label){ const h=document.querySelector('input[type="hidden"][data-ob="'+id+'"]'); if(h) h.value=val; const v=document.querySelector('[data-cs-val="'+id+'"]'); if(v) v.textContent=label; const pan=document.querySelector('[data-cs-panel="'+id+'"]'); if(pan) pan.style.display='none'; _obSaveDraftDebounced(); }
    function _obSyncSelects(){ document.querySelectorAll('.ob-cs').forEach(cs=>{ const h=cs.querySelector('input[type="hidden"][data-ob]'); if(!h||!h.value) return; const opt=cs.querySelector('[data-cs-value="'+CSS.escape(h.value)+'"]'); const v=cs.querySelector('[data-cs-val]'); if(opt&&v) v.textContent=opt.textContent; }); }

    // ---- repeatable rows ----
    function _obRepAdd(rep){ const cont=document.getElementById(rep==='creators'?'obCreators':'obClips'); if(!cont) return; if(cont.querySelectorAll('.ob-rep-row').length>=8){ _obFlash('That\'s plenty for now.'); return; } cont.insertAdjacentHTML('beforeend', _obRepRowHtml(rep)); }
    function _obRepRemove(x){ const row=x.closest('.ob-rep-row'); if(!row) return; const cont=row.parentElement; const rep=cont.id==='obCreators'?'creators':'clips'; row.remove(); if(!cont.querySelector('.ob-rep-row')) cont.insertAdjacentHTML('beforeend', _obRepRowHtml(rep, true)); _obSaveDraftDebounced(); }

    function _obAddCreatorRow(){ _obRepAdd('creators'); }

    function _obToggleAi(v){ const b=document.getElementById('obAiFields'); if(b) b.style.display=(v==='yes')?'block':'none'; if(v==='yes') _obTogglePodcast(); }
    function _obTogglePodcast(){
      const wrap=document.querySelector('[data-ob-multi="ai_content_style"]'); const q=document.querySelector('[data-ob-q="ai_podcast_setting"]'); if(!wrap||!q) return;
      const podcast=!!Array.from(wrap.querySelectorAll('input:checked')).find(i=>i.value==='podcast'); q.style.display=podcast?'':'none';
    }

    function _obFieldVal(id){ const el=document.querySelector('[data-ob="'+id+'"]'); return el?el.value.trim():''; }
    function _obUpdateLikeness(){
      const wrap=document.getElementById('obAiLikenessWrap'); if(!wrap) return;
      const hasClip=!!_obFieldVal('sample_clip'); const hasPhotos=!!_obFieldVal('photos_link'); const already=hasClip||hasPhotos;
      const shared=[hasClip?'the clip':null, hasPhotos?'photos':null].filter(Boolean).join(' and ');
      let html='<label class="ob-label">What we\'ll build your avatar from</label>';
      if(already){
        html+='<div class="ob-help">You already shared '+shared+' earlier — can we use that to build your avatar?</div>'+
          '<div class="ob-radios" data-ob-radio="ai_use_existing"><label class="ob-pill-opt"><input type="radio" name="ai_use_existing" value="yes" data-ob="ai_use_existing"><span>Yes, use those</span></label>'+
          '<label class="ob-pill-opt"><input type="radio" name="ai_use_existing" value="no" data-ob="ai_use_existing"><span>No, I\'ll send new ones</span></label></div>'+
          '<div id="obAiNew" style="display:none;margin-top:10px"><div class="ob-help">Record ~30 seconds of you talking to the camera like a normal video, and paste the link.</div>'+
          '<input class="ob-input" type="url" data-ob="ai_new_likeness" placeholder="https://…">'+OB_DRIVE_NOTE+'</div>';
      } else {
        html+='<div class="ob-help">Record ~30 seconds of you talking to the camera like a normal video, and paste the link.</div>'+
          '<input class="ob-input" type="url" data-ob="ai_new_likeness" placeholder="https://…">'+OB_DRIVE_NOTE;
      }
      const prev=_obFieldVal('ai_new_likeness'); const prevUse=(document.querySelector('input[name="ai_use_existing"]:checked')||{}).value;
      wrap.innerHTML=html;
      if(prev){ const e=wrap.querySelector('[data-ob="ai_new_likeness"]'); if(e) e.value=prev; }
      if(prevUse){ const r=wrap.querySelector('input[name="ai_use_existing"][value="'+prevUse+'"]'); if(r) r.checked=true; }
      _obUpdateLikenessVisibility();
    }
    function _obUpdateLikenessVisibility(){ const n=document.getElementById('obAiNew'); if(!n) return; const use=(document.querySelector('input[name="ai_use_existing"]:checked')||{}).value; n.style.display=(use==='no')?'block':'none'; }

    // ---- music preview (hosted local clips) ----
    let _obAudio=null, _obPlayingBtn=null;
    function _obMusicUrl(key){ return '/onboarding-audio/'+key+'.mp3'; }
    function _obResetPlay(){ if(_obAudio){ try{_obAudio.pause();}catch(e){} } if(_obPlayingBtn){ _obPlayingBtn.innerHTML=OB_PLAY_SVG; _obPlayingBtn.classList.remove('ob-playing'); _obPlayingBtn=null; } }
    function _obPlayMusic(btn){
      if(!_obAudio){ _obAudio=new Audio(); _obAudio.addEventListener('ended',_obResetPlay); _obAudio.addEventListener('error',_obResetPlay); }
      if(_obPlayingBtn===btn && !_obAudio.paused){ _obResetPlay(); return; }
      _obResetPlay();
      _obAudio.src=_obMusicUrl(btn.getAttribute('data-ob-play')); _obPlayingBtn=btn;
      btn.innerHTML=OB_PAUSE_SVG; btn.classList.add('ob-playing');
      const p=_obAudio.play(); if(p&&p.catch) p.catch(()=>{ _obResetPlay(); _obFlash('Could not play that sample'); });
    }

    function _obZoom(url){
      let ov=document.getElementById('obZoom');
      if(!ov){ ov=document.createElement('div'); ov.id='obZoom'; ov.className='ob-zoom-ov'; ov.addEventListener('click',()=>{ ov.classList.remove('show'); ov.innerHTML=''; }); document.body.appendChild(ov); }
      const isVid=/\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);
      ov.innerHTML=(isVid?'<video src="'+_obEsc(url)+'" controls autoplay loop playsinline></video>':'<img src="'+_obEsc(url)+'" alt="Example">')+'<span class="ob-zoom-x">✕</span>';
      ov.classList.add('show');
    }

    let _obFlashT=null;
    function _obFlash(msg){ let el=document.getElementById('obFlash'); if(!el){ el=document.createElement('div'); el.id='obFlash'; el.className='ob-flash'; document.body.appendChild(el); } el.textContent=msg; el.classList.add('show'); clearTimeout(_obFlashT); _obFlashT=setTimeout(()=>el.classList.remove('show'),1700); }

    function _obSerialize(){
      const form=document.getElementById('obForm'); const out={};
      form.querySelectorAll('[data-ob]').forEach(el=>{ out[el.getAttribute('data-ob')]=el.value.trim(); });
      form.querySelectorAll('[data-ob-radio]').forEach(g=>{ const n=g.getAttribute('data-ob-radio'); const s=g.querySelector('input:checked'); out[n]=s?s.value:''; });
      form.querySelectorAll('[data-ob-multi]').forEach(g=>{ const n=g.getAttribute('data-ob-multi'); out[n]=Array.from(g.querySelectorAll('input:checked')).map(i=>i.value); });
      form.querySelectorAll('[data-ob-toggle]').forEach(t=>{ out[t.getAttribute('data-ob-toggle')]=t.checked; });
      ['creators'].forEach(rep=>{
        const cont=document.getElementById('obCreators'); if(!cont) return;
        const rows=[]; cont.querySelectorAll('.ob-rep-row').forEach(r=>{ const o={}; r.querySelectorAll('[data-rep-k]').forEach(inp=>{ o[inp.getAttribute('data-rep-k')]=inp.value.trim(); }); if(Object.keys(o).some(k=>o[k])) rows.push(o); });
        out[rep]=rows;
      });
      return out;
    }

    function _obValidate(d){
      const miss=[];
      ['first_name','last_name','email','phone','ideal_customer','pain_points','desired_outcomes','process','success'].forEach(k=>{ if(!d[k]) miss.push(k); });
      if(!d.subtitle_style) miss.push('subtitle_style');
      if(d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) miss.push('email');
      if(OB_VARIANT==='ai' || d.ai_avatar==='yes'){
        ['ai_personality','ai_setting','ai_voice_link'].forEach(k=>{ if(!d[k]) miss.push(k); });
        if(!d.ai_content_style||!d.ai_content_style.length) miss.push('ai_content_style');
        if(!d.ai_text_driven) miss.push('ai_text_driven');
        if(!d.ai_framing) miss.push('ai_framing');
        if(!d.ai_clothing||!d.ai_clothing.length) miss.push('ai_clothing');
        if(!((d.ai_use_existing==='yes')||!!d.ai_new_likeness)) miss.push('ai_likeness');
      }
      return miss;
    }

    function _obSubmit(){
      const err=document.getElementById('obErr'); const d=_obSerialize(); const miss=_obValidate(d);
      if(miss.length){
        err.style.display='block'; err.textContent='Please fill the highlighted fields ('+miss.length+' left).';
        document.querySelectorAll('.ob-q.ob-missing').forEach(q=>q.classList.remove('ob-missing'));
        let first=null; miss.forEach(k=>{ const q=document.querySelector('[data-ob-q="'+k+'"]'); if(q){ q.classList.add('ob-missing'); const sec=q.closest('.ob-sec'); if(sec) sec.classList.remove('collapsed'); const sg=q.closest('.ob-subgroup'); if(sg) sg.classList.remove('collapsed'); if(!first) first=q; } });
        if(first) first.scrollIntoView({behavior:'smooth',block:'center'}); return;
      }
      err.style.display='none';
      const btn=document.getElementById('obSubmit'); btn.disabled=true; btn.textContent='Submitting…';
      const slug=(typeof wlNormalizeClient==='function')?wlNormalizeClient((d.first_name+' '+d.last_name).trim()):'';
      const now=new Date().toISOString();
      const _aiFunnel = (OB_VARIANT==='ai');
      const submission={ id:_obSubId(), slug:slug, first_name:d.first_name, last_name:d.last_name, email:d.email, phone:d.phone, ai_avatar:(_aiFunnel?'yes':'no'), funnel:(_aiFunnel?'ai':'standard'), answers:d, source:(_aiFunnel?'syncview-ai-onboarding':'syncview-onboarding'), created_at:now, updated_at:now };
      const primaryUrl=_aiFunnel?AI_ONBOARDING_SUBMIT_URL:ONBOARDING_SUBMIT_URL;
      const finish=(via)=>{
        try{ localStorage.removeItem(OB_DRAFT_KEY); }catch(e){}
        _obClearSubId();
        // On primary success, park a `submitted` copy in the fallback store too —
        // every submission then exists outside Supabase. Fire-and-forget.
        if(via==='primary'){ try{ _obBackupSend({ kind:'submitted', id:submission.id, funnel:submission.funnel, note:'primary submit succeeded', submission }, 8000).catch(()=>{}); }catch(e){} }
        _obThankYou(d);
      };
      // Primary (retry once for transient blips) -> Edge capture -> n8n fallback -> hard fail.
      // A fallback capture still counts as delivered: it is durably stored and alerts the team.
      _obPost(primaryUrl, { submission }, 20000)
        .then(()=>finish('primary'))
        .catch(()=> new Promise(res=>setTimeout(res,1500))
          .then(()=>_obPost(primaryUrl, { submission }, 20000))
          .then(()=>finish('primary'))
          .catch(e2=>_obBackupSend({ kind:'submit-fallback', id:submission.id, funnel:submission.funnel, note:'primary submit failed: '+((e2&&e2.message)||'network'), submission }, 15000)
            .then(()=>finish('fallback'))
            .catch(e3=>_obSubmitFailed(btn, err, d, e3))));
    }

    function _obDraftWorks(){ try{ const k='__ob_probe__'; localStorage.setItem(k,'1'); localStorage.removeItem(k); return true; }catch(e){ return false; } }
    function _obSubmitFailed(btn, err, d, e){
      btn.disabled=false; btn.textContent='Submit';
      err.style.display='block';
      // Honest copy: only promise a saved draft when localStorage actually works
      // (in-app browsers / private mode silently drop it). The download is the
      // zero-infrastructure last resort that works when every endpoint is down.
      err.innerHTML='We couldn\'t send the form right now'+(_obDraftWorks()?' — your answers are saved in this browser, please try again in a few minutes':'')+'.'+
        '<span class="ob-dl-wrap"><button type="button" class="ob-dl" id="obDownload">Download my answers</button>'+
        '<span class="ob-dl-note">or email the downloaded file to <a href="mailto:house@synchrosocial.com">house@synchrosocial.com</a> and we\'ll take it from there.</span></span>';
      const dl=document.getElementById('obDownload'); if(dl) dl.addEventListener('click', function(){ _obDownloadAnswers(d); });
      console.error('[onboarding] submit failed on every path', e);
    }
    function _obDownloadAnswers(d){
      try{
        const blob=new Blob([JSON.stringify({ funnel:(OB_VARIANT==='ai'?'ai':'standard'), saved_at:new Date().toISOString(), answers:d }, null, 2)], {type:'application/json'});
        const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
        a.download='synchrosocial-onboarding-'+String(d.first_name||'answers').toLowerCase().replace(/[^a-z0-9]+/g,'-')+'.json';
        document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 500);
      }catch(e){ console.error('[onboarding] download failed', e); }
    }

    let _obDone=false;
    function _obThankYou(d){
      _obDone=true;
      _obResetPlay();
      const card=document.getElementById('obCard'); if(!card) return;
      const t=document.getElementById('obTop'); if(t) t.remove();
      card.innerHTML='<div class="ob-thanks"><div class="ob-thanks-ico">✓</div><h1>Thanks'+(d.first_name?(', '+_obEsc(d.first_name)):'')+'!</h1>'+
        '<p>Your form is in — your team gets everything right away. You can close this page.</p></div>';
      window.scrollTo({top:0,behavior:'instant'});
    }

    let _obDraftT=null;
    function _obSaveDraftDebounced(){ clearTimeout(_obDraftT); _obDraftT=setTimeout(_obSaveDraft,600); _obQueueDraftSync(); }
    function _obSaveDraft(){ try{ localStorage.setItem(OB_DRAFT_KEY, JSON.stringify(_obSerialize())); }catch(e){} }

    // ---- draft backup sync ----
    // The localStorage draft only lives on the client's device (and silently doesn't
    // exist in private mode / in-app browsers), so meaningful drafts are also synced
    // to the fallback store (throttled), and flushed via sendBeacon when the tab
    // hides/closes. One upserted row per submission id; a later submit marks it
    // `submit-fallback`/`submitted`, so nothing is ever only-on-device for long.
    const OB_DRAFT_SYNC_MS=25000;
    let _obDraftSyncTimer=null, _obDraftSyncAt=0, _obLastSyncBody='';
    function _obDraftPayload(){
      if(_obDone) return null;
      let d=null; try{ d=_obSerialize(); }catch(e){ return null; }
      if(!d || !(d.first_name||d.last_name||d.email||d.phone)) return null;
      return { kind:'draft', id:_obSubId(), funnel:(OB_VARIANT==='ai'?'ai':'standard'), note:'autosaved draft', draft:d };
    }
    function _obQueueDraftSync(){
      if(_obDraftSyncTimer||_obDone) return;
      const wait=Math.max(1200, OB_DRAFT_SYNC_MS-(Date.now()-_obDraftSyncAt));
      _obDraftSyncTimer=setTimeout(_obDraftSync, wait);
    }
    function _obDraftSync(){
      _obDraftSyncTimer=null; _obDraftSyncAt=Date.now();
      const p=_obDraftPayload(); if(!p) return;
      const body=JSON.stringify(p); if(body===_obLastSyncBody) return;
      try{ _obBackupSend(p, 10000).then(function(){ _obLastSyncBody=body; }).catch(function(){}); }catch(e){}
    }
    function _obDraftBeacon(){
      const p=_obDraftPayload(); if(!p) return;
      const body=JSON.stringify(p); if(body===_obLastSyncBody) return;
      let sent=false;
      // text/plain keeps the beacon preflight-free; the fallback webhook parses it.
      try{ if(navigator.sendBeacon) sent=navigator.sendBeacon(ONBOARDING_FALLBACK_URL, new Blob([body], {type:'text/plain'})); }catch(e){}
      if(!sent){ try{ fetch(ONBOARDING_FALLBACK_URL, {method:'POST', headers:{'Content-Type':'text/plain'}, body:body, keepalive:true}).catch(function(){}); }catch(e){} }
      _obLastSyncBody=body;
    }
    function _obRebuildRep(rep, arr){
      const cont=document.getElementById(rep==='creators'?'obCreators':'obClips'); if(!cont||!Array.isArray(arr)||!arr.length) return;
      cont.innerHTML=''; arr.forEach((o,i)=>{ cont.insertAdjacentHTML('beforeend', _obRepRowHtml(rep, i===0)); const row=cont.lastElementChild; row.querySelectorAll('[data-rep-k]').forEach(inp=>{ const k=inp.getAttribute('data-rep-k'); if(o[k]!=null) inp.value=o[k]; }); });
    }
    function _obRestoreDraft(){
      let d=null; try{ d=JSON.parse(localStorage.getItem(OB_DRAFT_KEY)||'null'); }catch(e){}
      if(!d) return; const form=document.getElementById('obForm'); if(!form) return;
      _obRebuildRep('creators', d.creators);
      if(d.ai_avatar){ _obToggleAi(d.ai_avatar); }
      _obUpdateLikeness();
      form.querySelectorAll('[data-ob]').forEach(el=>{ const k=el.getAttribute('data-ob'); if(d[k]!=null && typeof d[k]!=='object') el.value=d[k]; });
      form.querySelectorAll('[data-ob-radio]').forEach(g=>{ const v=d[g.getAttribute('data-ob-radio')]; if(v){ const i=g.querySelector('input[value="'+v+'"]'); if(i) i.checked=true; } });
      form.querySelectorAll('[data-ob-multi]').forEach(g=>{ const arr=d[g.getAttribute('data-ob-multi')]; if(Array.isArray(arr)) arr.forEach(v=>{ const i=g.querySelector('input[value="'+v+'"]'); if(i) i.checked=true; }); });
      form.querySelectorAll('[data-ob-toggle]').forEach(t=>{ if(d[t.getAttribute('data-ob-toggle')]) t.checked=true; });
      const af=document.querySelector('[data-ob="ai_accessories_other"]'); const ao=document.querySelector('[data-ob-multi="ai_accessories"] input[value="other"]'); if(af&&ao) af.style.display=ao.checked?'block':'none';
      _obStyleSel(); _obBrollSync(); _obThumbSync(); _obThumbBuildSync();
      _obSyncSelects(); _obUpdateLikeness(); _obTogglePodcast();
    }

    function _obInjectStyles(){
      if(document.getElementById('obStyles')) return;
      const css = `
      body.onboarding-mode{
        background:var(--bg);
        /* Dark theme — scoped to the onboarding page only (the dashboard keeps :root light). */
        --bg:#101216; --white:#181b21;
        --text-primary:#eceef2; --text-secondary:#a4abb8; --text-muted:#6c7480;
        --border:#2a2f39; --border-light:#21252d;
        --ig:#f4708a; --up:#34d399; --up-bg:#11261d; --dn:#f87171; --dn-bg:#2a1619;
        --ob-accent:#6366f1;
      }
      .ob-wrap{ max-width:680px; margin:0 auto; padding:26px 18px 120px; font-family:'Plus Jakarta Sans',sans-serif; color:var(--text-primary); }
      .ob-card{ background:var(--white); border:1px solid var(--border); border-radius:18px; padding:30px 28px; box-shadow:0 1px 3px var(--sv-shadow-rgba-0-0-0-0_05); }
      .ob-kicker{ font-size:0.7rem; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:var(--text-muted); }
      .ob-brand{ display:flex; flex-direction:column; align-items:center; gap:8px; margin-bottom:22px; }
      .ob-logo-wrap{ position:relative; flex-shrink:0; display:inline-flex; }
      .ob-logo-wrap::after{ content:''; position:absolute; inset:-14px -18px; background:radial-gradient(closest-side, var(--sv-bg-rgba-162-28-230-0_34), var(--sv-bg-rgba-162-28-230-0) 74%); filter:blur(11px); z-index:-1; }
      .ob-logo{ width:116px; height:auto; display:block; filter:drop-shadow(0 4px 16px var(--sv-shadow-rgba-162-28-230-0_38)); }
      .ob-brand-kicker{ padding-left:2px; }
      .ob-title{ font-size:1.6rem; font-weight:800; margin:8px 0 8px; letter-spacing:-0.02em; }
      .ob-sub{ font-size:0.9rem; line-height:1.5; color:var(--text-secondary); margin:0; }
      .ob-rail{ display:flex; flex-wrap:wrap; gap:6px; margin:20px 0 4px; }
      .ob-rail-btn{ font-family:inherit; font-size:0.72rem; font-weight:600; color:var(--text-secondary); background:var(--bg); border:1px solid var(--border); border-radius:99px; padding:6px 12px; cursor:pointer; transition:all 0.13s; }
      .ob-rail-btn:hover{ color:var(--text-primary); border-color:var(--text-muted); }
      /* Each main section carries its own colour: a left rail + the numbered badge.
         The 8 section hues form a calm blue->violet->magenta->rose gradient (all in the
         brand's purple family, never a rainbow); a section's sub-groups use analogous
         neighbours of its hue, so a section + its children read as one family. */
      .ob-sec{ position:relative; padding:24px 0 4px 20px; border-top:1px solid var(--border-light); margin-top:10px; }
      /* The coloured rail on the left is a clickable handle: click it to collapse/expand its
         section (or sub-group). It widens + brightens on hover so it reads as interactive. */
      .ob-crail{ position:absolute; left:0; top:0; bottom:0; width:14px; cursor:pointer; z-index:3; display:block; -webkit-tap-highlight-color:transparent; }
      .ob-crail::before{ content:''; position:absolute; left:0; top:0; bottom:0; border-radius:0 3px 3px 0; transition:width 0.14s ease, filter 0.14s ease; }
      .ob-sec > .ob-crail::before{ width:3px; background:var(--sec-rail, var(--border)); }
      .ob-subgroup > .ob-crail::before{ width:2px; background:var(--sg-rail, var(--border)); }
      .ob-crail:hover::before, .ob-crail:focus-visible::before{ width:6px; filter:brightness(1.25); }
      .ob-crail:focus-visible{ outline:none; }
      .ob-sec:first-of-type{ border-top:none; }
      .ob-sec-h{ display:flex; align-items:center; gap:10px; margin:0 0 8px; padding:5px 8px 5px 4px; border-radius:10px; cursor:pointer; user-select:none; transition:background 0.13s; }
      .ob-sec-h:hover{ background:var(--bg); }
      .ob-sec-h:focus-visible{ outline:2px solid var(--ob-accent); outline-offset:1px; }
      .ob-sec-n{ display:inline-flex; align-items:center; justify-content:center; width:23px; height:23px; border-radius:99px; background:var(--sec-rail, var(--ob-accent)); color:var(--sv-fg-fff); font-size:0.76rem; font-weight:700; flex-shrink:0; }
      .ob-sec-h h2{ font-size:1.14rem; font-weight:700; margin:0; letter-spacing:-0.01em; }
      .ob-sec-chev{ margin-left:auto; color:var(--text-muted); flex-shrink:0; transition:transform 0.28s cubic-bezier(.4,0,.2,1); }
      .ob-sec-h:hover .ob-sec-chev{ color:var(--text-secondary); }
      .ob-sec.collapsed .ob-sec-chev{ transform:rotate(-90deg); }
      .ob-sec-body{ display:grid; grid-template-rows:1fr; transition:grid-template-rows 0.3s cubic-bezier(.4,0,.2,1); }
      .ob-sec.collapsed .ob-sec-body{ grid-template-rows:0fr; }
      .ob-sec-inner{ min-height:0; overflow:hidden; }
      .ob-sec-intro{ font-size:0.85rem; line-height:1.5; color:var(--text-secondary); margin:2px 0 14px; }
      /* Nested sub-groups: a thin coloured rail makes the Section -> group -> field
         hierarchy readable at a glance, kept low-key so it reads almost subconsciously. */
      .ob-subgroup{ position:relative; padding-left:17px; margin:22px 0 6px; }
      .ob-subgroup + .ob-subgroup{ margin-top:18px; }
      .ob-subhead{ display:flex; align-items:center; gap:8px; font-size:0.95rem; font-weight:700; letter-spacing:-0.01em; margin:0 -8px 11px; padding:5px 8px; border-radius:8px; color:var(--text-primary); cursor:pointer; user-select:none; transition:background 0.13s; }
      .ob-subhead:hover{ background:var(--bg); }
      .ob-subhead:hover .ob-sg-chev{ color:var(--text-secondary); }
      .ob-subhead:focus-visible{ outline:2px solid var(--sg-rail, var(--ob-accent)); outline-offset:1px; }
      .ob-sg-dot{ width:7px; height:7px; border-radius:50%; background:var(--sg-dot, var(--text-muted)); flex-shrink:0; }
      .ob-sg-chev{ margin-left:auto; color:var(--text-muted); flex-shrink:0; transition:transform 0.25s cubic-bezier(.4,0,.2,1); }
      .ob-subgroup.collapsed .ob-sg-chev{ transform:rotate(-90deg); }
      .ob-sg-body{ display:grid; grid-template-rows:1fr; transition:grid-template-rows 0.28s cubic-bezier(.4,0,.2,1); }
      .ob-subgroup.collapsed .ob-sg-body{ grid-template-rows:0fr; }
      .ob-sg-inner{ min-height:0; overflow:visible; }
      .ob-subgroup.collapsed .ob-sg-inner{ overflow:hidden; }
      .ob-q{ margin:0 0 16px; }
      .ob-label{ display:block; font-size:0.88rem; font-weight:600; margin-bottom:5px; line-height:1.4; }
      .ob-req{ color:var(--ig); margin-left:3px; }
      .ob-help{ font-size:0.78rem; line-height:1.45; color:var(--text-secondary); margin-bottom:8px; }
      .ob-drivenote{ font-size:0.72rem; color:var(--text-muted); margin-top:6px; display:flex; align-items:center; gap:6px; }
      .ob-lock-ic{ flex-shrink:0; opacity:0.9; }
      .ob-input{ width:100%; font-family:inherit; font-size:0.9rem; color:var(--text-primary); padding:10px 13px; border:1.5px solid var(--border); border-radius:10px; background:var(--white); box-sizing:border-box; transition:border-color 0.13s; }
      .ob-input:focus{ outline:none; border-color:var(--ob-accent); box-shadow:0 0 0 3px var(--sv-shadow-rgba-99-102-241-0_22); }
      .ob-input::placeholder{ color:var(--text-muted); }
      .ob-ta{ resize:vertical; min-height:42px; line-height:1.5; }
      .ob-radios,.ob-checks{ display:flex; flex-wrap:wrap; gap:8px; }
      .ob-opt-wrap{ display:inline-flex; align-items:center; gap:4px; }
      .ob-pill-opt{ display:inline-flex; align-items:center; font-size:0.85rem; padding:10px 16px; border:1.5px solid var(--border); border-radius:10px; cursor:pointer; transition:all 0.13s; background:var(--white); user-select:none; position:relative; }
      .ob-pill-opt:hover{ border-color:var(--text-muted); background:var(--bg); }
      .ob-pill-opt input{ position:absolute; opacity:0; width:0; height:0; }
      .ob-pill-opt:has(input:checked){ border-color:var(--ob-accent); background:var(--ob-accent); color:var(--sv-fg-fff); font-weight:600; }
      .ob-i{ display:inline-flex; align-items:center; justify-content:center; vertical-align:middle; width:20px; height:20px; padding:0; border:none; background:none; color:var(--text-muted); cursor:pointer; transition:color 0.12s; }
      .ob-i:hover{ color:var(--text-primary); }
      .ob-i svg{ display:block; }
      .ob-other-field{ }
      .ob-rep{ display:flex; flex-direction:column; gap:8px; }
      .ob-rep-row{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
      .ob-rep-row .ob-input{ flex:1 1 140px; min-width:0; }
      .ob-rep-x{ flex-shrink:0; width:26px; height:26px; padding:0; border:none; background:none; color:var(--text-muted); font-size:1.25rem; line-height:1; cursor:pointer; border-radius:6px; transition:color 0.12s,background 0.12s; }
      .ob-rep-x:hover{ color:var(--dn); background:var(--bg); }
      .ob-add{ margin-top:8px; font-family:inherit; font-size:0.8rem; font-weight:600; color:var(--text-secondary); background:none; border:none; cursor:pointer; padding:2px 0; }
      .ob-add:hover{ color:var(--text-primary); }
      .ob-cs{ position:relative; }
      .ob-cs-btn{ width:100%; display:flex; align-items:center; justify-content:space-between; font-family:inherit; font-size:0.9rem; color:var(--text-primary); padding:10px 13px; border:1.5px solid var(--border); border-radius:10px; background:var(--white); cursor:pointer; text-align:left; transition:border-color 0.13s; }
      .ob-cs-btn:hover{ border-color:var(--text-muted); }
      .ob-cs-val{ color:var(--text-primary); }
      .ob-cs-arrow{ width:9px; height:9px; border-right:2px solid var(--text-secondary); border-bottom:2px solid var(--text-secondary); transform:translateY(-2px) rotate(45deg); flex-shrink:0; margin-left:10px; }
      .ob-cs-panel{ position:absolute; left:0; right:0; top:calc(100% + 5px); background:var(--white); border:1.5px solid var(--border); border-radius:10px; box-shadow:0 8px 24px var(--sv-shadow-rgba-0-0-0-0_12); z-index:50; overflow:hidden; padding:4px; }
      .ob-cs-opt{ display:block; width:100%; text-align:left; font-family:inherit; font-size:0.88rem; color:var(--text-primary); padding:9px 11px; border:none; background:none; border-radius:7px; cursor:pointer; }
      .ob-cs-opt:hover{ background:var(--bg); }
      .ob-genres{ display:grid; grid-template-columns:1fr 1fr; gap:7px; }
      .ob-genre{ display:flex; align-items:center; gap:6px; padding:5px 7px 5px 12px; border:1.5px solid var(--border); border-radius:10px; transition:all 0.12s; }
      .ob-genre:hover{ border-color:var(--text-muted); }
      .ob-genre:has(input:checked){ border-color:var(--ob-accent); background:var(--bg); }
      .ob-genre-pick{ display:flex; align-items:center; gap:8px; flex:1; font-size:0.85rem; cursor:pointer; min-width:0; }
      .ob-genre-pick input{ position:absolute; opacity:0; width:0; height:0; }
      .ob-chk{ flex-shrink:0; width:19px; height:19px; border-radius:6px; border:1.6px solid var(--border); background:var(--white); position:relative; transition:all 0.13s; }
      .ob-genre-pick:hover .ob-chk{ border-color:var(--text-muted); }
      .ob-genre-pick input:checked + .ob-chk{ background:var(--ob-accent); border-color:var(--ob-accent); }
      .ob-genre-pick input:checked + .ob-chk::after{ content:''; position:absolute; left:6px; top:2.5px; width:4px; height:8px; border:solid var(--sv-border-fff); border-width:0 2px 2px 0; transform:rotate(45deg); }
      .ob-genre-pick input:focus-visible + .ob-chk{ outline:2px solid var(--ob-accent); outline-offset:2px; }
      .ob-genre-name{ font-weight:600; }
      .ob-play{ flex-shrink:0; width:27px; height:27px; border-radius:50%; border:1.5px solid var(--border); background:var(--white); color:var(--text-primary); cursor:pointer; display:flex; align-items:center; justify-content:center; padding:0; transition:all 0.12s; }
      .ob-play svg{ display:block; margin-left:1px; }
      .ob-play.ob-playing svg{ margin-left:0; }
      .ob-play:hover{ border-color:var(--ob-accent); }
      .ob-play.ob-playing{ background:var(--ob-accent); color:var(--sv-fg-fff); border-color:var(--ob-accent); }
      .ob-sub-grid{ display:grid; grid-template-columns:1fr 1fr; gap:9px; }
      .ob-sub-card{ display:flex; gap:10px; align-items:center; padding:10px 11px; border:1.5px solid var(--border); border-radius:12px; transition:all 0.12s; }
      .ob-sub-card:hover{ border-color:var(--text-muted); }
      .ob-sub-card:has(input:checked){ border-color:var(--ob-accent); background:var(--bg); }
      .ob-sub-pick{ display:flex; align-items:center; gap:10px; min-width:0; flex:1; cursor:pointer; }
      .ob-sub-pick input{ position:absolute; opacity:0; width:0; height:0; }
      .ob-sub-dot{ flex-shrink:0; width:18px; height:18px; border-radius:50%; border:1.6px solid var(--border); background:var(--white); position:relative; transition:all 0.12s; }
      .ob-sub-card:has(input:checked) .ob-sub-dot{ border-color:var(--ob-accent); }
      .ob-sub-card:has(input:checked) .ob-sub-dot::after{ content:''; position:absolute; inset:3.5px; border-radius:50%; background:var(--ob-accent); }
      .ob-sub-text{ display:flex; flex-direction:column; gap:2px; min-width:0; }
      .ob-sub-name{ font-size:0.84rem; font-weight:600; }
      .ob-sub-desc{ font-size:0.72rem; color:var(--text-secondary); line-height:1.35; }
      .ob-sub-thumb{ position:relative; width:50px; height:68px; border-radius:8px; overflow:hidden; flex-shrink:0; background:var(--border-light); border:none; padding:0; cursor:pointer; }
      .ob-sub-thumb img,.ob-sub-thumb video{ width:100%; height:100%; object-fit:cover; display:block; }
      .ob-sub-noimg{ display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:0.6rem; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; cursor:default; }
      .ob-stgrid{ display:flex; flex-direction:column; gap:10px; }
      .ob-stcard{ border:1.5px solid var(--border); border-radius:12px; padding:12px 14px; transition:all 0.12s; }
      .ob-stcard:hover{ border-color:var(--text-muted); }
      .ob-stcard:has(input:checked){ border-color:var(--ob-accent); background:var(--bg); }
      .ob-stcard-head{ display:flex; align-items:center; gap:10px; cursor:pointer; }
      .ob-stcard-head input{ position:absolute; opacity:0; width:0; height:0; }
      .ob-stcard:has(input:checked) .ob-sub-dot{ border-color:var(--ob-accent); }
      .ob-stcard:has(input:checked) .ob-sub-dot::after{ content:''; position:absolute; inset:3.5px; border-radius:50%; background:var(--ob-accent); }
      .ob-stp-row{ display:flex; gap:14px; margin-top:11px; }
      .ob-stp{ display:flex; flex-direction:column; align-items:center; gap:5px; flex:0 0 auto; }
      .ob-stp .ob-sub-thumb{ width:112px; height:199px; cursor:pointer; }
      .ob-stp-cap{ font-size:0.7rem; font-weight:600; color:var(--text-muted); }
      /* Selectable pick under each preview (Standard / +Highlight): a radio dot that fills. */
      .ob-stp-pick{ display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-size:0.74rem; font-weight:600; color:var(--text-secondary); user-select:none; }
      .ob-stp-pick input{ position:absolute; opacity:0; width:0; height:0; }
      .ob-stp-dot{ flex-shrink:0; width:15px; height:15px; border-radius:50%; border:1.7px solid var(--border); position:relative; transition:all 0.12s; }
      .ob-stp-pick:hover .ob-stp-dot{ border-color:var(--text-muted); }
      .ob-stp-pick input:checked + .ob-stp-dot{ border-color:var(--ob-accent); }
      .ob-stp-pick input:checked + .ob-stp-dot::after{ content:''; position:absolute; inset:3px; border-radius:50%; background:var(--ob-accent); }
      .ob-stp-pick input:checked ~ .ob-stp-pk-txt{ color:var(--ob-accent); }
      .ob-stp-pick input:focus-visible + .ob-stp-dot{ outline:2px solid var(--ob-accent); outline-offset:2px; }
      /* AI "which look" — selectable image previews (multi-select, one or both). */
      .ob-look-row{ flex-wrap:wrap; }
      .ob-look-row .ob-stp .ob-sub-thumb{ width:150px; height:266px; }
      .ob-look-pick{ flex:0 0 auto; align-items:flex-start; max-width:160px; line-height:1.3; }
      .ob-look-pick .ob-chk{ margin-top:1px; }
      .ob-look-row .ob-stp:has(input:checked) .ob-sub-thumb{ outline:2.5px solid var(--ob-accent); outline-offset:2px; }
      /* Live thumbnail picker — preview left, tight controls right (minimal cursor travel). */
      .ob-tp-buildrow{ margin-bottom:14px; }
      .ob-tp-buildlbl{ font-size:0.88rem; font-weight:600; }
      .ob-tp{ display:flex; gap:20px; align-items:flex-start; margin-top:4px; }
      .ob-tp-prev{ position:relative; flex:0 0 auto; width:186px; padding:0; border:none; background:var(--border-light); border-radius:13px; overflow:hidden; cursor:pointer; line-height:0; box-shadow:0 2px 10px var(--sv-shadow-rgba-0-0-0-0_25); }
      .ob-tp-img{ width:186px; height:auto; display:block; transition:opacity 0.12s ease; }
      .ob-tp-ctrls{ flex:1 1 0; min-width:0; display:flex; flex-direction:column; gap:15px; padding-top:2px; }
      .ob-tp-row{ display:flex; flex-direction:column; gap:8px; }
      .ob-tp-lbl{ font-size:0.74rem; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-muted); }
      .ob-tp-hlrow{ flex-direction:row; align-items:center; justify-content:flex-start; gap:14px; }
      .ob-seg{ display:flex; flex-wrap:wrap; gap:6px; }
      .ob-seg-btn{ font-family:inherit; font-size:0.82rem; font-weight:600; color:var(--text-secondary); background:var(--white); border:1.5px solid var(--border); border-radius:9px; padding:8px 13px; cursor:pointer; transition:all 0.12s; }
      .ob-seg-btn:hover{ border-color:var(--text-muted); color:var(--text-primary); }
      .ob-seg-btn.sel{ background:var(--ob-accent); border-color:var(--ob-accent); color:var(--sv-fg-fff); }
      @media(max-width:560px){ .ob-tp{ flex-direction:column; align-items:center; } .ob-tp-ctrls{ width:100%; } }
      .ob-toggle-q.ob-disabled{ opacity:0.5; }
      .ob-toggle-q.ob-disabled .ob-switch{ pointer-events:none; }
      /* Preview affordance: normal pointer cursor + a centred play/expand icon that fades in
         with a soft scrim on hover/focus — so it's clear you can play a clip or open the
         thumbnail full screen, without a magnifier cursor. */
      .ob-zoom-ic{ position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) scale(0.8); z-index:2; width:38px; height:38px; border-radius:50%; background:var(--sv-bg-rgba-0-0-0-0_5); color:var(--sv-fg-fff); display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity 0.16s ease, transform 0.16s ease, background 0.16s ease; pointer-events:none; }
      .ob-zoom-ic--play{ padding-left:2px; }
      .ob-zoom-ic svg{ display:block; }
      .ob-sub-thumb::after,.ob-tp-prev::after{ content:''; position:absolute; inset:0; z-index:1; background:var(--sv-bg-rgba-0-0-0-0); transition:background 0.16s ease; pointer-events:none; }
      .ob-sub-thumb:hover::after,.ob-sub-thumb:focus-visible::after,.ob-tp-prev:hover::after,.ob-tp-prev:focus-visible::after{ background:var(--sv-bg-rgba-0-0-0-0_30); }
      .ob-sub-thumb:hover .ob-zoom-ic,.ob-sub-thumb:focus-visible .ob-zoom-ic,.ob-tp-prev:hover .ob-zoom-ic,.ob-tp-prev:focus-visible .ob-zoom-ic{ opacity:1; transform:translate(-50%,-50%) scale(1); background:var(--sv-bg-rgba-0-0-0-0_62); }
      .ob-zoom-ov{ position:fixed; inset:0; background:var(--sv-bg-rgba-0-0-0-0_82); display:none; align-items:center; justify-content:center; z-index:10000; cursor:zoom-out; padding:24px; }
      .ob-zoom-ov.show{ display:flex; }
      .ob-zoom-ov img,.ob-zoom-ov video{ max-width:92vw; max-height:88vh; border-radius:10px; box-shadow:0 10px 40px var(--sv-shadow-rgba-0-0-0-0_4); }
      .ob-zoom-x{ position:fixed; top:18px; right:22px; color:var(--sv-fg-fff); font-size:1.4rem; opacity:0.8; }
      .ob-toggle-q{ display:flex; align-items:center; justify-content:space-between; gap:14px; }
      .ob-switch{ position:relative; display:inline-block; width:44px; height:26px; flex-shrink:0; cursor:pointer; }
      .ob-switch input{ opacity:0; width:0; height:0; }
      .ob-switch-track{ position:absolute; inset:0; background:var(--border); border-radius:99px; transition:0.18s; }
      .ob-switch-track::before{ content:''; position:absolute; height:20px; width:20px; left:3px; top:3px; background:var(--sv-bg-fff); border-radius:50%; transition:0.18s; box-shadow:0 1px 2px var(--sv-shadow-rgba-0-0-0-0_2); }
      .ob-switch input:checked + .ob-switch-track{ background:var(--ob-accent); }
      .ob-switch input:checked + .ob-switch-track::before{ transform:translateX(18px); }
      .ob-info-panel{ font-size:0.82rem; line-height:1.5; color:var(--text-secondary); background:var(--bg); border:1px solid var(--border); border-radius:10px; padding:11px 13px; margin:4px 0 10px; }
      .ob-tp-note{ margin:18px 0 22px; }
      /* Step-4 worked example: video preview + copy, side by side (stacks + centres on mobile). */
      .ob-sample-eg{ display:flex; gap:16px; align-items:center; background:var(--bg); border:1px solid var(--border); border-radius:12px; padding:14px 15px; }
      .ob-sample-eg-thumb{ width:120px; height:213px; border-radius:10px; flex-shrink:0; }
      .ob-sample-eg-body{ display:flex; flex-direction:column; gap:6px; min-width:0; }
      .ob-sample-eg-title{ font-size:0.9rem; font-weight:700; color:var(--text-primary); }
      .ob-sample-eg-desc{ font-size:0.82rem; line-height:1.5; color:var(--text-secondary); }
      @media(max-width:560px){ .ob-sample-eg{ flex-direction:column; align-items:center; text-align:center; } }
      .ob-lp-check{ align-items:flex-start; gap:10px; line-height:1.45; }
      .ob-lp-check .ob-chk{ margin-top:1px; }
      .ob-ai-fields{ margin-top:6px; }
      .ob-script{ font-size:0.8rem; line-height:1.55; color:var(--text-primary); background:var(--bg); border:1px solid var(--border); border-radius:10px; padding:13px 15px; margin-bottom:10px; }
      .ob-script p{ margin:0 0 8px; } .ob-script p:last-child{ margin-bottom:0; }
      .ob-footer{ margin-top:28px; padding-top:20px; border-top:1px solid var(--border); }
      .ob-err{ font-size:0.83rem; color:var(--dn); background:var(--dn-bg); border:1px solid var(--dn); border-radius:9px; padding:10px 13px; margin-bottom:12px; }
      .ob-dl-wrap{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:9px; }
      .ob-dl{ appearance:none; border:1px solid var(--ob-accent); background:transparent; color:var(--ob-accent); font:inherit; font-size:0.8rem; font-weight:600; border-radius:8px; padding:6px 11px; cursor:pointer; }
      .ob-dl:hover{ background:var(--ob-accent); color:var(--sv-fg-fff); }
      .ob-dl-note{ font-size:0.78rem; color:var(--text-secondary); }
      .ob-dl-note a{ color:var(--ob-accent); }
      .ob-submit{ width:100%; font-family:inherit; font-size:0.95rem; font-weight:700; color:var(--sv-fg-fff); background:var(--ob-accent); border:none; border-radius:11px; padding:14px; cursor:pointer; transition:opacity 0.13s; }
      .ob-submit:hover{ opacity:0.88; } .ob-submit:disabled{ opacity:0.5; cursor:default; }
      .ob-q.ob-missing .ob-input,.ob-q.ob-missing .ob-radios,.ob-q.ob-missing .ob-checks,.ob-q.ob-missing .ob-genres,.ob-q.ob-missing .ob-sub-grid,.ob-q.ob-missing .ob-stgrid,.ob-q.ob-missing .ob-cs-btn{ box-shadow:0 0 0 2px var(--dn); border-radius:10px; }
      .ob-q.ob-missing .ob-label{ color:var(--dn); }
      .ob-thanks{ text-align:center; padding:40px 10px; }
      .ob-thanks-ico{ width:54px; height:54px; border-radius:99px; background:var(--up-bg); color:var(--up); display:flex; align-items:center; justify-content:center; font-size:1.7rem; margin:0 auto 16px; }
      .ob-thanks h1{ font-size:1.45rem; font-weight:800; margin:0 0 10px; }
      .ob-thanks p{ font-size:0.92rem; line-height:1.55; color:var(--text-secondary); max-width:400px; margin:0 auto; }
      .ob-flash{ position:fixed; bottom:24px; left:50%; transform:translateX(-50%) translateY(20px); background:var(--ob-accent); color:var(--sv-fg-fff); font-size:0.82rem; font-weight:600; padding:10px 18px; border-radius:99px; opacity:0; pointer-events:none; transition:all 0.2s; z-index:9999; }
      .ob-flash.show{ opacity:1; transform:translateX(-50%) translateY(0); }
      .ob-top{ position:fixed; bottom:22px; right:22px; width:42px; height:42px; border-radius:50%; border:1px solid var(--border); background:var(--white); color:var(--text-primary); cursor:pointer; box-shadow:0 4px 14px var(--sv-shadow-rgba-0-0-0-0_3); opacity:0; pointer-events:none; transform:translateY(10px); transition:all 0.2s; z-index:9998; display:flex; align-items:center; justify-content:center; }
      .ob-top.show{ opacity:1; pointer-events:auto; transform:translateY(0); }
      .ob-top:hover{ border-color:var(--text-muted); }
      @media(max-width:560px){ .ob-card{ padding:24px 16px; } .ob-genres,.ob-sub-grid{ grid-template-columns:1fr; } }
      `;
      const st=document.createElement('style'); st.id='obStyles'; st.textContent=css; document.head.appendChild(st);
    }

    /* ============================================================
       CONTENT CALENDAR MODULE
       Saves and reorders go to the Supabase functions calendar-upsert and
       calendar-reorder (n8n exit, PR 2); reads come from calendar_posts, with
       the n8n calendar-get webhook kept only as the read fallback. The
       original n8n contract, for reference:
         GET  /webhook/calendar-get?client=<slug>
         POST /webhook/calendar-upsert-post  { client, post }
       Legacy storage: SyncView Calendar Sheet, one tab per client named Calendar_<slug>
       (slug = wlNormalizeClient, e.g. "Baya Voce" -> "bayavoce").
       Schema: id, order_index, scheduled_date, name, asset_url, thumbnail_url,
       caption, caption_alt, caption_alt_platform, cta, tweaks, status,
       linear_issue_id, kasper_approved_at,
       posted_at, updated_at,
       video_status, graphic_status, caption_status,
       graphic_linear_issue_id,
       video_tweaks, graphic_tweaks, caption_tweaks,
       client_video_approved_at, client_graphic_approved_at, client_caption_approved_at.
       Per-component tweaks columns hold a JSON-encoded array of threaded
       comment objects: { id, parent_id, author, role, body, created_at,
       done, done_at, done_by }. The legacy `tweaks` column mirrors
       `video_tweaks` during the back-compat window. Overall `status` is
       always recomputed from the three sub-statuses (lower-priority wins,
       with Tweaks Needed lowest).
       ============================================================ */
    const CALENDAR_GET_URL     = 'https://synchrosocial.app.n8n.cloud/webhook/calendar-get';
    const CALENDAR_UPSERT_N8N_URL = 'https://synchrosocial.app.n8n.cloud/webhook/calendar-upsert-post';
    const CALENDAR_UPSERT_URL  = CALENDAR_UPSERT_N8N_URL; // legacy fallback alias; do not fetch directly
    const CALENDAR_UPSERT_EF_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/calendar-upsert';
    /* calendar-append-post, calendar-delete-post, calendar-reorder and
       calendar-reorder-batch had no caller left (or, for the reorders, only
       the n8n route the page no longer takes) and were removed in the n8n exit,
       PR 2. Reorders go to CALENDAR_REORDER_EF_URL only. */
    const CALENDAR_REORDER_EF_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/calendar-reorder';
    // Batched Kasper-queue read: every Calendar_<slug> tab in one POST
    // (2 Google API calls server-side). The FE falls back to per-client
    // CALENDAR_GET_URL calls whenever this endpoint fails.
    const KASPER_QUEUE_URL     = 'https://synchrosocial.app.n8n.cloud/webhook/kasper-queue';
    /* linear-subissues (LINEAR_SUBISSUES_URL) was removed 2026-09-23 (B2):
       its callers -- Import from Linear, Bulk Linear sync and link-time
       status adoption -- are gone. See docs/ops/B2_LINEAR_CLEANUP_PLAN.md. */
    /* linear-issue-statuses (LINEAR_STATUSES_URL) was removed 2026-09-22: the
       webhook is revoked on 2026-09-27 and its two front-end callers are gone.
       See OPEN_REPAIRS 236. linear-set-status (LINEAR_SET_STATUS_URL) and
       linear-add-comment (LINEAR_ADD_COMMENT_URL) followed on the same day for
       the same reason -- the legacy Calendar and Samples WRITE transports that
       were their only callers are retired, and the assembled page holds no
       remaining reference to either name (OPEN_REPAIRS 239). The other reader
       endpoints on this row stay as they are -- A2 defers them to
       AFTER-STEP-7. The server-side reconcilers in scripts/ still hold their
       own copies of these URLs and are tracked separately. */
    const GENERATE_CAPTION_URL       = 'https://synchrosocial.app.n8n.cloud/webhook/generate-caption';
    const CAPTION_PROMPTS_GET_URL    = 'https://synchrosocial.app.n8n.cloud/webhook/caption-prompts-get';
    const CAPTION_PROMPTS_SAVE_URL   = 'https://synchrosocial.app.n8n.cloud/webhook/caption-prompts-save';
    /* Caption-job tracking. The generate-caption workflow upserts a row per
       run into the caption_jobs n8n data table (status: running/done/error/
       cancelled, stage: scraping → transcribing → writing → done). The UI
       polls the status webhook so the button/progress chip mirror the real
       backend state — surviving refreshes, tab switches and dropped
       connections — and posts cancel_requested to the update webhook. */
    const CAPTION_JOB_STATUS_URL = 'https://synchrosocial.app.n8n.cloud/webhook/caption-job-status';
    const CAPTION_JOB_UPDATE_URL = 'https://synchrosocial.app.n8n.cloud/webhook/caption-job-update';
    const CAPTION_PROMPTS_SAVE_EF_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/caption-prompts-save';
    /* "URGENT TWEAKS NEEDED" editor ping: native route only
       (native_urgent_dispatch via production-write). The legacy n8n
       send-urgent-slack webhook was retired in B2. */
    /* "URGENT — WAITING ON YOU" ping for a card parked at Kasper Approval. The
       twin of the one above, aimed the other way: the SMM fires it when a card
       has been sitting in Kasper's queue too long, and the send-urgent-kasper-slack
       workflow DMs Kasper as the SyncView Bot with a link straight to his review
       tab. As with the editor ping the front-end sends only card context — the
       recipient is resolved inside the workflow and is never trusted from the
       browser. */
    const URGENT_KASPER_SLACK_URL = 'https://synchrosocial.app.n8n.cloud/webhook/send-urgent-kasper-slack';
    /* ============================================================
       CALENDAR v2 (Supabase realtime) — Phase 2 config
       See docs/archive/CALENDAR_REALTIME_MIGRATION.md. Hidden behind ?v2=1
       (sticky in localStorage; ?v2=0 clears it). Two gates:
         _calV2Enabled() — flag only. Turns on field-level patch
            writes (the upsert workflow already accepts partial
            patches). No backend dependency; reads stay on n8n.
         _calV2Ready()   — flag AND the anon key below is set.
            Switches reads to Supabase REST + opens the realtime
            subscription.
       ACTIVATION (Sidney, in Supabase — SQL in the migration doc):
         1) anon SELECT policy on public.calendar_posts
         2) add the table to the supabase_realtime publication
         3) paste the anon (publishable) key into CAL_SUPABASE_ANON_KEY
       Until (3) is filled in, _calV2Ready() is false and nothing
       touches Supabase — the flag only enables patch writes. The
       anon/publishable key is a browser key (same exposure as
       today's open calendar webhooks); commit it ONLY once the RLS
       policy in (1) is live. */
    const CAL_SUPABASE_URL      = 'https://uzltbbrjidmjwwfakwve.supabase.co';
    const CAL_SUPABASE_ANON_KEY = 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA'; // browser-safe publishable key; read-only via RLS
    const CAL_SUPABASE_LIB_URL  = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'; // UMD → window.supabase
    /* Pinned to us-east-1, the Edge region nearest the database (us-east-2 is
       not an Edge region). By default a request runs in the region nearest the
       CALLER; measured 2026-09-24, most Workload traffic ran in sa-east-1 and
       every answer crossed to Ohio and back -- full snapshot p50 4.5 s there vs
       0.8-3.5 s in us-east-1, "unchanged" 460-750 ms vs ~270 ms. The query
       parameter (not the x-region header) keeps the CORS preflight unchanged.
       https://supabase.com/docs/guides/functions/regional-invocation -- a pinned
       region is not re-routed during a regional outage. */
    const WORKLOAD_PLAN_URL = CAL_SUPABASE_URL + '/functions/v1/workload-plan?forceFunctionRegion=us-east-1';
    const WORKLOAD_LINEAR_URL = CAL_SUPABASE_URL + '/functions/v1/workload-linear';
    const CLIENT_TOKEN_VERIFY_URL = CAL_SUPABASE_URL + '/functions/v1/client-token-verify';
    const SYNCVIEW_CLIENT_ENTRY_PROTOCOL = 'syncview-client-entry-v1';
    const CLIENT_REVIEW_LINK_URL = CAL_SUPABASE_URL + '/functions/v1/client-review-link';
    const STAFF_KEY_VERIFY_URL = CAL_SUPABASE_URL + '/functions/v1/key-verify';
    const THUMBNAIL_FOLDER_RESOLVE_EF_URL = CAL_SUPABASE_URL + '/functions/v1/thumbnail-folder-resolve';
    const THUMBNAIL_REVISION_READ_EF_URL = CAL_SUPABASE_URL + '/functions/v1/thumbnail-revision-read';
    const SMM_WEEKLY_REPORTS_URL = CAL_SUPABASE_URL + '/functions/v1/smm-weekly-reports';
    const PTO_EF_URL = CAL_SUPABASE_URL + '/functions/v1/pto';
    const PTO_FLAG_KEY = 'pto_v1';
    const SYNCVIEW_STAFF_IDENTITY_KEY = 'syncview_staff_identity_v1';
    const SYNCVIEW_STAFF_PROMPT_SESSION_KEY = 'syncview_staff_identity_prompted_v1';
    const SYNCVIEW_STAFF_LEGACY_IDENTITY_KEYS = Object.freeze([
        'syncview_client_credentials_identity_v1',
        'syncview_filming_plans_identity_v1'
    ]);
    let _syncviewStaffIdentityMem = null;
    let _syncviewStaffIdentityLoaded = false;
    let _syncviewStaffIdentityVerified = false;
    let _syncviewStaffVerificationEpoch = 0;
    let _syncviewStaffRosterCache = null;
    let _syncviewStaffPromptPromise = null;
    let _syncviewStaffBootPromise = null;
    let _syncviewStaffAwaitBootPromise = null;

    function _syncviewStaffEsc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }
    function _syncviewStaffIdentitySignature(identity) {
        return identity && identity.key && identity.member && identity.member.id
            ? [String(identity.key), String(identity.role || ''), String(identity.member.id)].join('\u0000')
            : '';
    }
    function _syncviewStaffClearLegacyIdentityStorage() {
        try { SYNCVIEW_STAFF_LEGACY_IDENTITY_KEYS.forEach(key => localStorage.removeItem(key)); } catch (e) {}
    }
    function _syncviewStaffIdentityLoad() {
        if (_syncviewStaffIdentityLoaded) return _syncviewStaffIdentityMem;
        try { _syncviewStaffIdentityMem = JSON.parse(localStorage.getItem(SYNCVIEW_STAFF_IDENTITY_KEY) || 'null') || null; }
        catch (e) { _syncviewStaffIdentityMem = null; }
        _syncviewStaffIdentityLoaded = true;
        return _syncviewStaffIdentityMem;
    }
    function _syncviewStaffIdentitySave(identity) {
        _syncviewStaffIdentityMem = identity || null;
        _syncviewStaffIdentityLoaded = true;
        try {
            if (identity) localStorage.setItem(SYNCVIEW_STAFF_IDENTITY_KEY, JSON.stringify(identity));
            else localStorage.removeItem(SYNCVIEW_STAFF_IDENTITY_KEY);
        } catch (e) {}
        if (identity && _syncviewStaffIdentityVerified) {
            try {
                const wl = svAreaApi('workload');   // nothing to refresh until Workload has loaded
                if (wl) wl.refreshSensitiveStateSilent();
            } catch (e) {}
        }
    }
    function _syncviewInvalidateStaffVerification() {
        _syncviewStaffIdentityVerified = false;
        _syncviewStaffVerificationEpoch++;
    }
    function _syncviewAcceptStaffVerification() {
        _syncviewStaffVerificationEpoch++;
        _syncviewStaffIdentityVerified = true;
        // A verification accepted while the gate is up IS the gate coming down,
        // whatever path produced it (the entry form, boot re-verification, or a
        // sibling tab signing back in).
        try {
            if (typeof _syncviewStaffGateRequired === 'function' && _syncviewStaffGateRequired()
                && _syncviewStaffIdentityValid()) _syncviewLiftStaffGate();
        } catch (e) {}
    }
    function _syncviewStaffIdentityClear() {
        _syncviewStaffPurgeSensitiveState();
        try { if (typeof _kasperForgetAdmin === 'function') _kasperForgetAdmin(); } catch (e) {}
        if (typeof _syncviewInvalidateStaffVerification === 'function') _syncviewInvalidateStaffVerification();
        else _syncviewStaffIdentityVerified = false;
        _syncviewStaffIdentitySave(null);
        try { if (typeof _prodComments !== 'undefined') _prodComments.clear(); } catch (e) {}
        _syncviewStaffClearLegacyIdentityStorage();
        _syncviewStaffRefreshChrome();
        if (typeof _syncviewStaffGateRequired === 'function' && _syncviewStaffGateRequired()) _syncviewOpenStaffGate();
    }
    function _syncviewStaffIdentityValid() {
        const identity = _syncviewStaffIdentityLoad();
        return !!(_syncviewStaffIdentityVerified && identity && identity.key && identity.member && identity.member.id && identity.member.name && identity.role);
    }
    function _syncviewStaffIdentityForHeaders() {
        return _syncviewStaffIdentityValid() ? _syncviewStaffIdentityLoad() : null;
    }
    /* ---- Staff entry gate ----------------------------------------------
       ADMISSION (may the app shell be opened) and VERIFICATION (may this
       action touch data) are separate, and BOTH now require the key-verify
       Edge Function to agree. Nothing the browser holds is ever treated as
       proof: a stored identity is writable by hand in devtools, so it decides
       only what to PAINT before the server answers.

       An earlier revision of this change admitted the shell during a verifier
       outage when the stored identity carried a recent `verified_at`, so that
       a Supabase blip would not lock the team out. Codex caught it in review
       and was right: `verified_at` is a field in that same hand-writable blob,
       so anyone could set it to now, block ONLY the verifier request, and walk
       into the shell -- the outage was manufacturable, which made the grace
       window a bypass rather than a cushion. It also bought less than it
       looked: every read the shell performs goes to the same Supabase host as
       key-verify, so a genuine outage leaves the app empty anyway. The only
       case it covered was key-verify alone being broken, which is precisely
       the case an attacker can produce on demand. There is no offline proof to
       replace it with -- an unforgeable one would have to be server-issued and
       server-checked, which is what key-verify already is -- so the gate now
       fails closed on every verification failure. */
    function _syncviewStaffIdentityStorageChanged(event) {
        if (!event || event.key !== SYNCVIEW_STAFF_IDENTITY_KEY) return;
        try { if (event.storageArea && event.storageArea !== localStorage) return; } catch (e) {}
        let next = null;
        try { next = event.newValue ? JSON.parse(event.newValue) : null; } catch (e) {}
        const current = _syncviewStaffIdentityLoad();
        const currentSignature = _syncviewStaffIdentitySignature(current);
        const nextSignature = _syncviewStaffIdentitySignature(next);
        _syncviewStaffIdentityMem = next || null;
        _syncviewStaffIdentityLoaded = true;
        if (!nextSignature) {
            _syncviewStaffPurgeSensitiveState();
            if (typeof _syncviewInvalidateStaffVerification === 'function') _syncviewInvalidateStaffVerification();
            else _syncviewStaffIdentityVerified = false;
            try { if (typeof _prodComments !== 'undefined') _prodComments.clear(); } catch (e) {}
            _syncviewStaffClearLegacyIdentityStorage();
            _syncviewStaffRefreshChrome();
            // typeof-guarded like the calls around it: this handler is lifted
            // into an isolated VM by test/workload-plan-failclosed.js, where the
            // gate helpers are not defined.
            if (typeof _syncviewStaffGateRequired === 'function' && _syncviewStaffGateRequired()) _syncviewOpenStaffGate();
            return;
        }
        if (nextSignature === currentSignature && _syncviewStaffIdentityVerified) return;
        if (nextSignature !== currentSignature) _syncviewStaffPurgeSensitiveState();
        if (typeof _syncviewInvalidateStaffVerification === 'function') _syncviewInvalidateStaffVerification();
        else _syncviewStaffIdentityVerified = false;
        if (nextSignature !== currentSignature) {
            try { if (typeof _prodComments !== 'undefined') _prodComments.clear(); } catch (e) {}
        }
        _syncviewStaffRefreshChrome();
        const verifyCurrentStoredIdentity = () => {
            if (_syncviewStaffIdentitySignature(_syncviewStaffIdentityLoad()) !== nextSignature || _syncviewStaffIdentityValid()) return;
            _syncviewStaffIdentityBoot();
        };
        if (_syncviewStaffBootPromise) {
            _syncviewStaffBootPromise.finally(() => setTimeout(verifyCurrentStoredIdentity, 0));
        } else verifyCurrentStoredIdentity();
    }
    window.addEventListener('storage', _syncviewStaffIdentityStorageChanged);
    function _syncviewStaffRoleValue(identity) {
        return String(identity && identity.role || '').trim().toLowerCase();
    }
    function _syncviewStaffRoleLabel(role) {
        const value = String(role || '').trim().toLowerCase();
        if (value === 'admin') return 'Admin';
        if (value === 'smm') return 'SMM';
        if (value === 'creative') return 'Creative';
        return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Staff';
    }
    function _syncviewStaffCan(capability) {
        const identity = _syncviewStaffIdentityForHeaders();
        const role = _syncviewStaffRoleValue(identity);
        if (capability === 'credentials') return role === 'admin' || role === 'smm';
        if (capability === 'review-link') return role === 'admin' || role === 'smm';
        if (capability === 'restore-archived') return role === 'admin' || role === 'smm';
        if (capability === 'intake') return role === 'admin' || role === 'smm';
        if (capability === 'onboarding') return role === 'admin' || role === 'smm' || role === 'creative';
        if (capability === 'weekly-report-submit') return role === 'admin' || role === 'smm';
        if (capability === 'weekly-report-manage') return role === 'admin';
        if (capability === 'hiring') return role === 'admin';
        if (capability === 'pto-admin') return role === 'admin';
        if (capability === 'quiz-leads') return role === 'admin';
        if (capability === 'clients-admin') return role === 'admin';
        if (capability === 'workload-plan-read') return role === 'admin' || role === 'smm' || role === 'creative';
        if (capability === 'workload-plan') return role === 'admin' || role === 'smm';
        if (capability === 'workload-linear-read') return role === 'admin' || role === 'smm' || role === 'creative';
        if (capability === 'workload-linear') return role === 'admin' || role === 'smm';
        return !!identity;
    }
    async function _syncviewRequireStaffIdentity(capability) {
        let identity = _syncviewStaffIdentityForHeaders();
        if (!identity) {
            await _syncviewOpenStaffIdentity({ reason: 'required' });
            identity = _syncviewStaffIdentityForHeaders();
        }
        if (!identity) throw new Error('Staff sign-in required.');
        if (!_syncviewStaffCan(capability)) {
            let message = 'This action requires an Admin account. Sign out first to use another authorized account.';
            if (capability === 'credentials') message = 'Client credentials are available to Admin or SMM accounts. Sign out first to use another authorized account.';
            else if (capability === 'review-link') message = 'Client links are available to Admin or SMM accounts. Sign out first to use another authorized account.';
            else if (capability === 'intake') message = 'Production submissions require an Admin or SMM account. Sign out first to use another authorized account.';
            else if (capability === 'onboarding') message = 'Onboarding is available to Admin, SMM, or Creative accounts. Sign out first to use another authorized account.';
            else if (capability === 'weekly-report-submit') message = 'Weekly reports are available to Admin or SMM accounts. Sign out first to use another authorized account.';
            else if (capability === 'weekly-report-manage') message = 'Weekly report management requires an Admin account. Sign out first to use another authorized account.';
            else if (capability === 'hiring') message = 'Hiring Process requires an Admin account. Sign out first to use another authorized account.';
            else if (capability === 'pto-admin') message = 'Time Off approvals and setup require an Admin account. Sign out first to use another authorized account.';
            else if (capability === 'workload-plan-read') message = 'The shared Workload calendar requires an Admin, SMM, or Creative account. Sign out first to use another authorized account.';
            else if (capability === 'workload-plan') message = 'Work-day planning requires an Admin or SMM account. Sign out first to use another authorized account.';
            else if (capability === 'workload-linear-read') message = 'Workload labels require an Admin, SMM, or Creative account. Sign out first to use another authorized account.';
            else if (capability === 'workload-linear') message = 'Linear due-date editing requires an Admin or SMM account. Sign out first to use another authorized account.';
            const error = new Error(message);
            error.status = 403;
            throw error;
        }
        return identity;
    }
    function _syncviewOfferStaffSignIn(capability) {
        if (!_syncviewStaffIdentityForHeaders()) {
            _syncviewOpenStaffIdentity({ reason: 'required' });
            return false;
        }
        const message = capability === 'credentials'
            ? 'Client credentials need an Admin or SMM account. Sign out first to use another authorized account.'
            : (capability === 'pto-admin'
                ? 'Time Off approvals and setup need an Admin account. Sign out first to use another authorized account.'
                : 'This action needs an Admin account. Sign out first to use another authorized account.');
        try { showToast(message); } catch (e) {}
        return false;
    }
    function _syncviewProdDirectPreview() {
        try { return new URLSearchParams(svRoute.search()).get('prod') === '1'; }
        catch (e) { return false; }
    }
    function _syncviewStaffEligible() {
        try {
            return !_isClientLink && !_isIntake && !_isOnboarding;
        } catch (e) { return false; }
    }
    function _syncviewStaffSetChecking(checking) {
        const button = document.getElementById('headerMenuButton');
        if (!button) return;
        button.classList.toggle('is-checking', !!checking);
        if (checking) {
            button.setAttribute('aria-busy', 'true');
            button.title = 'Checking saved staff sign-in';
            button.setAttribute('aria-label', 'Checking saved staff sign-in');
        } else button.removeAttribute('aria-busy');
    }
    function _syncviewStaffRefreshChrome() {
        const identity = _syncviewStaffIdentityForHeaders();
        const valid = !!identity;
        const role = _syncviewStaffRoleValue(identity);
        const button = document.getElementById('headerMenuButton');
        const wrap = document.getElementById('staffIdentityWrap');
        const eligible = _syncviewStaffEligible();
        if (wrap) wrap.hidden = !eligible;
        if (button) {
            button.hidden = !eligible;
            button.classList.toggle('is-valid', valid);
            const displayRole = valid ? _syncviewStaffRoleLabel(identity.member && identity.member.role || role) : '';
            const label = valid ? ('Open staff menu for ' + identity.member.name + ' · ' + displayRole) : 'Open staff menu';
            button.title = label;
            button.setAttribute('aria-label', label);
            button.setAttribute('aria-haspopup', 'menu');
            if (!valid && document.getElementById('staffAccountPopover')?.hidden) button.setAttribute('aria-expanded', 'false');
        }
        try { document.documentElement.setAttribute('data-staff-role', valid ? role : ''); } catch (e) {}
        document.querySelectorAll('[data-staff-capability]').forEach(element => {
            element.hidden = !_syncviewStaffCan(element.getAttribute('data-staff-capability'));
        });
        // Kasper is admin-only; the standalone staff pages re-check their own
        // capability once the sign-in check answers.
        try { if (typeof _kasperApplyAccess === 'function') _kasperApplyAccess(); } catch (e) {}
        try {
            if (typeof currentNav !== 'undefined' && (currentNav === 'staff-onboarding' || currentNav === 'client-credentials')
                && svAreaApi('kasper') && !document.querySelector('#kasperContent > :not(.kasper-empty)')) svAreaApi('kasper').staffPageRender(currentNav);
        } catch (e) {}
        if (!valid) {
            _syncviewCloseStaffAccount();
            // Purging the in-memory PTO caches is not enough: immediately
            // replace any mounted HR view so previous staff data never
            // remains visible after sign-out, a cross-tab identity change, or
            // an expired-key 401.
            try {
                if (typeof currentNav !== 'undefined' && currentNav === 'time-off' && typeof _ptoPaint === 'function') _ptoPaint();
                if (typeof currentNav !== 'undefined' && currentNav === 'kasper'
                    && typeof _kasperState !== 'undefined' && _kasperState && _kasperState.tab === 'time-off'
                    && typeof _ptoRenderAdmin === 'function') _ptoRenderAdmin();
            } catch (e) {}
        } else {
            // A cross-tab identity replacement first purges the mounted HR
            // view. Rehydrate it only after the replacement is verified.
            try {
                if (typeof currentNav !== 'undefined' && currentNav === 'time-off'
                    && typeof _ptoLoadOverview === 'function' && typeof _ptoState !== 'undefined'
                    && !_ptoState.overview && !_ptoState.loading) _ptoLoadOverview(true);
                if (typeof currentNav !== 'undefined' && currentNav === 'kasper'
                    && typeof _kasperState !== 'undefined' && _kasperState && _kasperState.tab === 'time-off'
                    && typeof _ptoRenderAdmin === 'function') _ptoRenderAdmin();
            } catch (e) {}
        }
        try {
            const tab = typeof _kasperState !== 'undefined' && _kasperState ? _kasperState.tab : '';
            const blocked = (tab === 'client-credentials' && !_syncviewStaffCan('credentials'))
                || (tab === 'onboarding' && !_syncviewStaffCan('onboarding'))
                || (tab === 'clients' && !_syncviewStaffCan('clients-admin'))
                || (tab === 'filming' && !valid);
            if (blocked) {
                _kasperFallbackToReview();
                if (typeof currentNav !== 'undefined' && currentNav === 'kasper' && svAreaApi('kasper')) svAreaApi('kasper').renderTab();
            }
        } catch (e) {}
        // A Kasper subtab that fell back only because the key check had not
        // answered yet (a reload) comes back now that it has.
        try { const k = svAreaApi('kasper'); if (k) k.restorePendingSubtab(); } catch (e) {}
        try {
            if (valid && typeof _thumbCompareScheduleAvailability === 'function') {
                if (typeof currentNav !== 'undefined' && currentNav === 'calendar') _thumbCompareScheduleAvailability('calendar');
                else if (typeof currentNav !== 'undefined' && currentNav === 'sample-reviews') _thumbCompareScheduleAvailability('samples');
            }
        } catch (e) {}
    }
    async function _syncviewStaffRoster() {
        if (_syncviewStaffRosterCache) return _syncviewStaffRosterCache;
        const url = CAL_SUPABASE_URL + '/rest/v1/team_members?active=eq.true&select=id,name,role,team&order=name.asc';
        const response = await fetch(url, {
            headers: { apikey: CAL_SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY, Accept: 'application/json' }
        });
        if (!response.ok) throw new Error('Could not load the staff roster');
        const rows = await response.json();
        _syncviewStaffRosterCache = (Array.isArray(rows) ? rows : [])
            .filter(row => row && row.id && row.name && row.active !== false)
            .sort((a, b) => String(a.name).localeCompare(String(b.name)));
        return _syncviewStaffRosterCache;
    }
    /* The <head> boot script starts the boot key-verify POST while the document
       parses. Hand its response over at most once, only to the boot surface,
       only for the exact key + member it was sent for, and only while fresh.
       It is the server's answer either way; this only moves when it was asked. */
    function _syncviewTakeEarlyKeyVerify(candidate, surface) {
        let early = null;
        try { early = window.__svEarlyKeyVerify; window.__svEarlyKeyVerify = null; } catch (e) {}
        if (!early || surface !== 'staff-boot' || !candidate || !candidate.member) return null;
        if (early.key !== String(candidate.key || '') || early.memberId !== String(candidate.member.id || '')) return null;
        if (!(Date.now() - early.at < 60000)) return null;
        return early.response;
    }
    /* Boot-time runtime flag rows from the single batched read the <head> boot
       script starts. Resolves the rows a `key=eq.<key>` read would return, or
       null when the batch is unavailable (client link, already taken, failed,
       stale): the caller then reads the flag itself exactly as before. */
    async function _svBootFlagRows(key) {
        try {
            if (typeof window.__svTakeBootFlag !== 'function') return null;
            const hit = await window.__svTakeBootFlag(key);
            return hit ? (hit.row ? [hit.row] : []) : null;
        } catch (e) { return null; }
    }
    async function _syncviewVerifyStaffIdentity(candidate, surface) {
        const early = _syncviewTakeEarlyKeyVerify(candidate, surface);
        let response = null;
        if (early) { try { response = await early; } catch (e) { response = null; } }
        if (!response) response = await fetch(STAFF_KEY_VERIFY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Syncview-Key': String(candidate && candidate.key || '') },
            body: JSON.stringify({ surface: surface || 'staff-login', member: { id: candidate && candidate.member && candidate.member.id } })
        });
        let json = null;
        try { json = await response.json(); } catch (e) {}
        if (!response.ok || !json || json.ok !== true || !json.member) {
            const error = new Error(response.status === 401 ? 'That role key does not match the selected name.' : 'Could not verify this sign-in right now.');
            error.status = response.status;
            throw error;
        }
        return {
            key: String(candidate.key || ''),
            role: String(json.role || ''),
            member: {
                id: String(json.member.id || ''),
                name: String(json.member.name || ''),
                role: String(json.member.role || ''),
                team: json.member.team == null ? null : String(json.member.team)
            },
            verified_at: new Date().toISOString()
        };
    }
    /* SMART DEFAULTS (owner decision 2026-09-27). A creative is a non-admin
     * whose team is video or graphics. Workload opens filtered to them and
     * SyncLinear opens on "My issues", once per page load, and only when
     * nothing else (a link, an earlier choice this visit) already decided.
     * It reads the stored identity, which only decides what to paint first;
     * it grants nothing. Returns { id, team } or null. */
    function _syncviewCreativeMe() {
        const identity = _syncviewStaffIdentityLoad();
        const m = identity && identity.member;
        if (!m || !m.id || String(identity.role || '') === 'admin') return null;
        const team = String(m.team || '').toLowerCase();
        return team === 'video' || team === 'graphics' ? { id: String(m.id), name: String(m.name || ''), team } : null;
    }
    function _syncviewStaffInitials(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || 'S').slice(0, 2)).toUpperCase();
    }
    // Filming plans live in the on-demand Templates area. When it has not
    // loaded, its saved copy and Kasper's filming copy can still be in this
    // browser from an earlier visit, so sign-out clears them from here, the
    // same way the area's own purge (060 _fpPurgeSensitiveState) does.
    function _svFilmingPlansColdPurge() {
        try { localStorage.removeItem(KASPER_FILMING_CACHE_KEY); } catch (e) {}
        try { localStorage.removeItem(FP_SAVED_KEY); } catch (e) {}
        try {
            if (typeof _kasperState !== 'undefined' && _kasperState) {
                _kasperState.filmingData = null;
                _kasperState.filmingLoadedAt = 0;
                _kasperState.filmingError = null;
                _kasperState.filmingExpanded = {};
            }
        } catch (e) {}
    }
    function _syncviewStaffPurgeSensitiveState() {
        try { const wl = svAreaApi('workload'); if (wl) wl.purgePlanSensitiveState(); } catch (e) {}   // in-memory only; nothing loaded before Workload runs
        try { if (typeof _linearIntakePurgeSensitiveState === 'function') _linearIntakePurgeSensitiveState(); } catch (e) {}
        try {
            const tpl = svAreaApi('templates');
            if (tpl) tpl.fpPurgeSensitiveState();
            else _svFilmingPlansColdPurge();
        } catch (e) {}
        try { if (typeof _srpPurgeSensitiveState === 'function') _srpPurgeSensitiveState(); } catch (e) {}
        try { if (typeof _tdyPurgeSensitiveState === 'function') _tdyPurgeSensitiveState(); } catch (e) {}
        try { if (typeof _prodSmmPurgeSensitiveState === 'function') _prodSmmPurgeSensitiveState(); } catch (e) {}
        // Kasper's hiring, client and credential data (040 registry). Before
        // Kasper loads it holds none in memory; its recently-opened clients
        // list can still be saved in this browser, so that is cleared here.
        try {
            const kasper = svAreaApi('kasper');
            if (kasper) kasper.purgeSensitiveState();
            else localStorage.removeItem(CA_RECENT_KEY);
        } catch (e) {}
        try { if (typeof _ptoCalResetView === 'function') _ptoCalResetView(); } catch (e) {}
        try { document.querySelectorAll('#ccOverlay, .cc-sensitive-overlay').forEach(element => element.remove()); } catch (e) {}
        try { const tpl = svAreaApi('templates'); if (tpl) tpl.obvPurgeFullMode(); } catch (e) {}
        try {
            if (typeof _prodState !== 'undefined' && _prodState) {
                _prodState.commentDrafts.clear();
                _prodState.writes.clear();
                _prodState.labels.clear();
                _prodState.createCatalogToken++;
                _prodState.createCatalog = [];
                _prodState.createAssignees = [];
                _prodState.createCatalogStatus = 'idle';
                _prodState.createCatalogError = '';
                _prodState.createDraft = null;
                _prodState.createSubmitting = false;
                _prodState.createError = '';
                try { sessionStorage.removeItem(PROD_CREATE_DRAFT_KEY); } catch (e) {}
                try {
                    if (document.querySelector('[data-prod-create-modal]') && typeof _prodClearLayer === 'function') {
                        _prodClearLayer();
                    }
                } catch (e) {}
                // The Production first-paint snapshot is an authorized-session
                // copy; drop it on sign-out so the next paint cannot seed from a
                // prior identity's cached clients/deliverables/authority.
                if (typeof _prodCachePurge === 'function') _prodCachePurge();
                // Archive asset repair holds cached archive comments and rescued
                // private links. Clear it, invalidate its in-flight request
                // tokens, and remove its overlay so no signed-out session keeps
                // protected history visible in ?prod=1 preview mode.
                if (_prodState.archiveRepair) {
                    _prodState.archiveRepair.listRequestToken = Number(_prodState.archiveRepair.listRequestToken || 0) + 1;
                    _prodState.archiveRepair.detailRequestToken = Number(_prodState.archiveRepair.detailRequestToken || 0) + 1;
                    _prodState.archiveRepair = null;
                    try {
                        if (document.querySelector('[data-prod-archive-modal]') && typeof _prodClearLayer === 'function') {
                            _prodClearLayer();
                        }
                    } catch (e) {}
                }
            }
        } catch (e) {}
        try {
            if (typeof _ptoInvalidateOverviewCaches === 'function') _ptoInvalidateOverviewCaches();
        } catch (e) {}
    }
    function _syncviewCloseStaffAccount(options) {
        options = options || {};
        const popover = document.getElementById('staffAccountPopover');
        const button = document.getElementById('headerMenuButton');
        if (!popover || popover.hidden) return;
        if (popover._syncviewOutside) document.removeEventListener('mousedown', popover._syncviewOutside, true);
        if (popover._syncviewKeydown) document.removeEventListener('keydown', popover._syncviewKeydown, true);
        popover._syncviewOutside = null;
        popover._syncviewKeydown = null;
        popover.classList.remove('is-open');
        popover.hidden = true;
        if (button) button.setAttribute('aria-expanded', 'false');
        if (options.restoreFocus && button) button.focus();
    }
    function _syncviewOpenStaffAccount() {
        const identity = _syncviewStaffIdentityForHeaders();
        const popover = document.getElementById('staffAccountPopover');
        const button = document.getElementById('headerMenuButton');
        const wrap = document.getElementById('staffIdentityWrap');
        if (!popover || !button || !wrap || !_syncviewStaffEligible()) return false;
        if (!popover.hidden) { _syncviewCloseStaffAccount({ restoreFocus: true }); return true; }
        const name = String(identity && identity.member && identity.member.name || 'Staff');
        const role = _syncviewStaffRoleLabel(identity && identity.member && identity.member.role || _syncviewStaffRoleValue(identity));
        const summary = popover.querySelector('#staffAccountSummary');
        const identityAction = popover.querySelector('#staffIdentitySignOut');
        const identityLabel = popover.querySelector('#staffIdentityMenuLabel');
        const timeOffAction = popover.querySelector('#headerTimeOffMenuItem');
        if (identity) {
            popover.setAttribute('aria-label', 'Signed in as ' + name + ' · ' + role);
            if (summary) summary.innerHTML = '<span class="staff-account-avatar" aria-hidden="true">' + _syncviewStaffEsc(_syncviewStaffInitials(name)) + '</span>'
                + '<div class="staff-account-copy"><div class="staff-account-line">Signed in as ' + _syncviewStaffEsc(name) + ' · ' + _syncviewStaffEsc(role) + '</div><div class="staff-account-note">Verified on this device</div></div>';
            if (identityLabel) identityLabel.textContent = 'Sign out';
            if (identityAction) identityAction.onclick = _syncviewStaffSignOut;
        } else {
            popover.setAttribute('aria-label', 'Staff menu');
            if (summary) summary.innerHTML = '<span class="staff-account-avatar" aria-hidden="true">SV</span>'
                + '<div class="staff-account-copy"><div class="staff-account-line">SyncView staff</div><div class="staff-account-note">Sign in to use staff-only tools</div></div>';
            if (identityLabel) identityLabel.textContent = 'Staff sign in';
            if (identityAction) identityAction.onclick = () => {
                _syncviewCloseStaffAccount();
                _syncviewOpenStaffIdentity({ reason: 'required' });
            };
        }
        if (timeOffAction) timeOffAction.hidden = !(typeof _ptoEnabled === 'function' && _ptoEnabled());
        _syncviewApplyStatusPalette(_syncviewStoredStatusPalette());
        _syncviewApplyTheme(_syncviewStoredTheme(), false);
        popover.hidden = false;
        popover.classList.add('is-open');
        button.setAttribute('aria-expanded', 'true');
        popover._syncviewOutside = event => { if (!wrap.contains(event.target)) _syncviewCloseStaffAccount(); };
        popover._syncviewKeydown = event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                _syncviewCloseStaffAccount({ restoreFocus: true });
                return;
            }
            if (event.key === 'Tab') {
                setTimeout(() => { if (!wrap.contains(document.activeElement)) _syncviewCloseStaffAccount(); }, 0);
            }
        };
        document.addEventListener('keydown', popover._syncviewKeydown, true);
        const action = popover.querySelector('#staffIdentitySignOut');
        if (action) action.focus();
        setTimeout(() => { if (!popover.hidden) document.addEventListener('mousedown', popover._syncviewOutside, true); }, 0);
        return true;
    }
    function _syncviewStaffSignOut() {
        _syncviewCloseStaffAccount();
        _syncviewStaffIdentityClear();
        try { showToast('Signed out'); } catch (e) {}
        const button = document.getElementById('headerMenuButton');
        if (button) button.focus();
    }
    function _syncviewCloseStaffIdentity(value, options) {
        options = options || {};
        const overlay = document.getElementById('staffIdentityOverlay');
        if (!overlay) return;
        overlay._syncviewClosed = true;
        if (overlay._syncviewKeydown) document.removeEventListener('keydown', overlay._syncviewKeydown, true);
        try { if (typeof _ccCloseSelect === 'function') _ccCloseSelect('staffIdentityMember'); } catch (e) {}
        document.getElementById('staffGateOverlay')?.classList.remove('is-carded');
        const done = overlay._syncviewResolve;
        if (overlay) overlay.remove();
        if (typeof done === 'function') done(value || null);
        if (options.restoreFocus !== false) {
            const button = document.getElementById('headerMenuButton');
            if (button) button.focus();
        }
    }
    function _syncviewToggleStaffRoleKey(button) {
        _ccTogglePasswordField('staffIdentityKey', button);
        const input = document.getElementById('staffIdentityKey');
        if (!input || !button) return;
        const label = input.type === 'text' ? 'Hide role key' : 'Show role key';
        button.setAttribute('aria-label', label);
        button.title = label;
    }
    function _syncviewBindStaffIdentityOverlay(overlay, entry) {
        overlay._syncviewEntry = !!entry;
        // Entry mode IS the door: there is nothing behind it to dismiss to,
        // so backdrop clicks and Escape must not close it.
        overlay.onclick = event => { if (event.target === overlay && overlay._backdropPressBegan && !overlay._syncviewEntry) _syncviewCloseStaffIdentity(null); };
        overlay._syncviewKeydown = event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                try {
                    if (typeof _ccOpenSelectId !== 'undefined' && _ccOpenSelectId === 'staffIdentityMember') {
                        _ccCloseSelect('staffIdentityMember');
                        document.getElementById('staffIdentityMemberBtn')?.focus();
                        return;
                    }
                } catch (e) {}
                if (!overlay._syncviewEntry) _syncviewCloseStaffIdentity(null);
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = Array.from(overlay.querySelectorAll('button:not([disabled]), input:not([disabled]):not([type="hidden"]), [href], [tabindex]:not([tabindex="-1"])'))
                .filter(element => !element.hidden && element.getClientRects().length);
            if (!focusable.length) {
                event.preventDefault();
                overlay.querySelector('[role="dialog"]')?.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', overlay._syncviewKeydown, true);
    }
    function _syncviewRenderStaffIdentityForm(overlay, roster, entry) {
        const current = _syncviewStaffIdentityLoad();
        const selectedId = current && current.member ? String(current.member.id || '') : '';
        const memberItems = [{ value: '', label: 'Choose your name' }].concat(roster.map(member => ({ value: String(member.id), label: String(member.name) })));
        const memberSelectHtml = _ccSelectHtml('staffIdentityMember', memberItems, selectedId, 'Choose your name');
        overlay.innerHTML = '<form class="staff-auth-card" id="staffIdentityForm" role="dialog" aria-modal="true" aria-labelledby="staffIdentityTitle" aria-describedby="staffIdentityIntro staffIdentitySecure">'
            + '<div class="staff-auth-head"><span class="staff-auth-mark" aria-hidden="true"><svg viewBox="0 0 18 18" fill="none"><path d="M9 2.2 14.2 4v4.1c0 3.4-2 5.9-5.2 7.7-3.2-1.8-5.2-4.3-5.2-7.7V4L9 2.2Z" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round"/><path d="m6.8 8.8 1.5 1.5 3-3.1" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/></svg></span>'
            + '<div class="staff-auth-title-wrap"><div class="staff-auth-eyebrow">SyncView staff</div><h2 id="staffIdentityTitle">Staff sign in</h2></div></div>'
            + '<p class="staff-auth-intro" id="staffIdentityIntro">' + (entry
                ? 'Choose your name and enter your personal role key to open SyncView.'
                : 'Choose your roster name and enter the role key for your work.') + '</p>'
            + '<div class="staff-auth-fields">'
            + '<div class="staff-auth-field"><label for="staffIdentityMemberBtn">Your name</label>' + memberSelectHtml + '</div>'
            + '<div class="staff-auth-field"><label for="staffIdentityKey">Role key</label><div class="cc-password-wrap"><input id="staffIdentityKey" type="password" autocomplete="current-password" placeholder="Enter role key" aria-describedby="staffIdentityError" required><button class="cc-pass-toggle" type="button" id="staffIdentityKeyToggle" title="Show role key" aria-label="Show role key" aria-pressed="false" onclick="_syncviewToggleStaffRoleKey(this)">' + CC_ICON_EYE + '</button></div></div>'
            + '</div><div class="staff-auth-error" id="staffIdentityError" role="alert"></div><div class="staff-auth-status" id="staffIdentityStatus" role="status" aria-live="polite"></div>'
            + '<div class="staff-auth-secure" id="staffIdentitySecure"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7"/></svg><span>Your role key stays on this device and is sent only to SyncView secure functions.</span></div>'
            + '<div class="staff-auth-actions">' + (entry ? '' : '<button class="cal-import-btn-ghost" type="button" id="staffIdentityCancel">Not now</button>')
            + '<button class="cal-import-btn-primary" type="submit" id="staffIdentitySubmit">Continue</button></div>'
            + '</form>';
        const form = overlay.querySelector('#staffIdentityForm');
        const memberInput = overlay.querySelector('#staffIdentityMember');
        const memberTrigger = overlay.querySelector('#staffIdentityMemberBtn');
        const key = overlay.querySelector('#staffIdentityKey');
        const toggle = overlay.querySelector('#staffIdentityKeyToggle');
        const submit = overlay.querySelector('#staffIdentitySubmit');
        const error = overlay.querySelector('#staffIdentityError');
        const status = overlay.querySelector('#staffIdentityStatus');
        const showError = (message, target) => {
            error.textContent = message || '';
            status.textContent = '';
            key.removeAttribute('aria-invalid');
            memberTrigger.removeAttribute('aria-invalid');
            if (target) {
                target.setAttribute('aria-invalid', 'true');
                target.focus();
            }
        };
        const clearError = () => {
            if (!error.textContent) return;
            error.textContent = '';
            key.removeAttribute('aria-invalid');
            memberTrigger.removeAttribute('aria-invalid');
        };
        const setBusy = busy => {
            form.setAttribute('aria-busy', busy ? 'true' : 'false');
            submit.disabled = busy;
            memberTrigger.disabled = busy;
            key.disabled = busy;
            toggle.disabled = busy;
            submit.innerHTML = busy ? '<span class="staff-auth-spinner" aria-hidden="true"></span>Verifying…' : 'Continue';
            status.textContent = busy ? 'Verifying your identity…' : '';
        };
        const cancel = overlay.querySelector('#staffIdentityCancel');
        if (cancel) cancel.onclick = () => _syncviewCloseStaffIdentity(null);
        memberInput.addEventListener('change', clearError);
        key.addEventListener('input', clearError);
        form.onsubmit = async event => {
            event.preventDefault();
            const member = roster.find(row => String(row.id) === String(memberInput.value));
            const roleKey = key.value.trim();
            if (!member) { showError('Choose your name.', memberTrigger); return; }
            if (!roleKey) { showError('Enter your role key.', key); return; }
            showError('');
            setBusy(true);
            try {
                const verified = await _syncviewVerifyStaffIdentity({ key: roleKey, member }, 'staff-login');
                if (!overlay.isConnected || overlay._syncviewClosed) return;
                _syncviewAcceptStaffVerification();
                _syncviewStaffIdentitySave(verified);
                _syncviewStaffRefreshChrome();
                _syncviewCloseStaffIdentity(verified);
                if (typeof _writeUiResumeLegacyQueues === 'function') _writeUiResumeLegacyQueues('staff-verified');
                if (entry) _syncviewLiftStaffGate();
            } catch (e) {
                if (!overlay.isConnected || overlay._syncviewClosed) return;
                setBusy(false);
                showError(e && e.message ? e.message : 'Could not verify this sign-in.', key);
                key.select();
            }
        };
        setTimeout(() => { if (overlay.isConnected) (selectedId ? key : memberTrigger).focus(); }, 20);
    }
    function _syncviewOpenStaffIdentity(options) {
        options = options || {};
        if (!_syncviewStaffEligible()) return Promise.resolve(null);
        const stored = _syncviewStaffIdentityLoad();
        if (_syncviewStaffBootPromise && _syncviewStaffIdentitySignature(stored) && !options._afterBoot) {
            if (!_syncviewStaffAwaitBootPromise) {
                const afterBootOptions = Object.assign({}, options, { _afterBoot: true });
                _syncviewStaffAwaitBootPromise = _syncviewStaffBootPromise.then(result => {
                    if (result && _syncviewStaffIdentityValid()) {
                        _syncviewOpenStaffAccount();
                        return _syncviewStaffIdentityLoad();
                    }
                    return _syncviewOpenStaffIdentity(afterBootOptions);
                }).finally(() => { _syncviewStaffAwaitBootPromise = null; });
            }
            return _syncviewStaffAwaitBootPromise;
        }
        const identity = _syncviewStaffIdentityForHeaders();
        if (identity) {
            if (!options.entry) _syncviewOpenStaffAccount();
            return Promise.resolve(identity);
        }
        _syncviewCloseStaffAccount();
        if (_syncviewStaffPromptPromise) return _syncviewStaffPromptPromise;
        _syncviewStaffPromptPromise = (async () => {
            const overlay = document.createElement('div');
            overlay.id = 'staffIdentityOverlay';
            overlay.className = 'cal-import-overlay open staff-auth-overlay';
            if (typeof overlay.setAttribute === 'function') overlay.setAttribute('data-backdrop-dismiss', '');
            const result = new Promise(resolve => { overlay._syncviewResolve = resolve; });
            overlay.innerHTML = '<div class="staff-auth-card" role="dialog" aria-modal="true" aria-label="Preparing staff sign in" aria-busy="true" tabindex="-1"><div class="staff-auth-loading"><span class="staff-auth-spinner" aria-hidden="true"></span><strong>Preparing secure sign-in</strong><span>Loading the active staff roster…</span></div></div>';
            document.body.appendChild(overlay);
            // .cal-import-overlay's z-index (260) is declared later in the
            // sheet than .staff-auth-overlay's, so it wins. Entry mode has to
            // sit ON the gate cover (9990), and only entry mode does.
            if (options.entry) { overlay.style.zIndex = '9995'; overlay.classList.add('is-entry'); }
            _syncviewBindStaffIdentityOverlay(overlay, options.entry);
            setTimeout(() => overlay.querySelector('[role="dialog"]')?.focus(), 0);
            try {
                const roster = await _syncviewStaffRoster();
                if (!overlay.isConnected || overlay._syncviewClosed) return await result;
                if (!roster.length) throw new Error('No active staff roster rows are available');
                _syncviewRenderStaffIdentityForm(overlay, roster, options.entry);
                if (options.entry) document.getElementById('staffGateOverlay')?.classList.add('is-carded');
                return await result;
            } catch (error) {
                _syncviewCloseStaffIdentity(null, { restoreFocus: !options.silent });
                throw error;
            }
        })().catch(error => {
            if (!options.silent) {
                try { showNotify('Staff sign-in unavailable', error && error.message ? error.message : 'Try again shortly.'); } catch (e) {}
            }
            return null;
        }).finally(() => { _syncviewStaffPromptPromise = null; });
        return _syncviewStaffPromptPromise;
    }
    /* The gate cover itself. Painted pre-boot by html.boot-gate (see the
       <head> boot script); these lift it, drop it back, or park it on an
       error state. Surfaces with their own access model (client share links,
       ?intake=1, the onboarding funnels, the SMM weekly entry) never gate. */
    function _syncviewStaffGateRequired() {
        try {
            if (_isSmmWeeklyEntry || _isOnboardingView) return false;
        } catch (e) {}
        return _syncviewStaffEligible();
    }
    function _syncviewSetStaffGateNote(text, retry) {
        const note = document.getElementById('staffGateNote');
        if (note) note.textContent = text;
        const button = document.getElementById('staffGateRetry');
        if (button) button.hidden = !retry;
    }
    function _syncviewLiftStaffGate() {
        // An entry-mode sign-in card is part of the gate, so it goes with it.
        // (Verification can arrive from a sibling tab while this card is open.)
        try {
            const prompt = document.getElementById('staffIdentityOverlay');
            if (prompt && prompt._syncviewEntry) _syncviewCloseStaffIdentity(_syncviewStaffIdentityLoad(), { restoreFocus: false });
        } catch (e) {}
        document.documentElement.classList.remove('boot-gate');
        const overlay = document.getElementById('staffGateOverlay');
        if (overlay) overlay.style.display = 'none';
        if (!_syncviewAppBooted) { _syncviewSetAppBooted(true); try { init(); } catch (e) { console.error('[SyncView] boot failed', e); } }
    }
    /* Drop the gate back over a running app. Sensitive state is purged by the
       identity clear/invalidate paths that call this, so what sits behind the
       cover is inert. */
    function _syncviewShowStaffGate() {
        document.documentElement.classList.add('boot-gate');
        const overlay = document.getElementById('staffGateOverlay');
        if (overlay) overlay.style.display = 'flex';
        _syncviewSetStaffGateNote('Preparing secure sign-in…', false);
    }
    let _syncviewGatePromptOpen = false;
    function _syncviewOpenStaffGate() {
        if (!_syncviewStaffGateRequired()) { _syncviewLiftStaffGate(); return Promise.resolve(null); }
        _syncviewShowStaffGate();
        if (_syncviewGatePromptOpen) return Promise.resolve(null);
        _syncviewGatePromptOpen = true;
        return _syncviewOpenStaffIdentity({ entry: true, silent: true })
            .then(result => {
                if (!result) _syncviewSetStaffGateNote('Sign-in could not start. Check your connection and try again.', true);
                return result;
            })
            .finally(() => { _syncviewGatePromptOpen = false; });
    }
    function _syncviewScheduleStaffPrompt() {
        if (!_syncviewStaffEligible() || _syncviewProdDirectPreview() || _syncviewStaffIdentityLoad()) return;
        try {
            if (sessionStorage.getItem(SYNCVIEW_STAFF_PROMPT_SESSION_KEY) === '1') return;
            sessionStorage.setItem(SYNCVIEW_STAFF_PROMPT_SESSION_KEY, '1');
        } catch (e) {}
        setTimeout(() => _syncviewOpenStaffIdentity({ silent: true }), 700);
    }
    function _syncviewStaffIdentityBoot() {
        if (_syncviewStaffBootPromise) return _syncviewStaffBootPromise;
        _syncviewStaffBootPromise = (async () => {
            if (!_syncviewStaffEligible()) { _syncviewStaffRefreshChrome(); return null; }
            // The entry card just verified this identity and lifted the gate,
            // which starts init(), which lands here. A second POST for the same
            // key can only lose: a rate-limit or a transient 5xx would now bounce
            // someone back to the gate moments after they signed in successfully.
            if (_syncviewStaffIdentityValid()) {
                _syncviewStaffRefreshChrome();
                return _syncviewStaffIdentityLoad();
            }
            const current = _syncviewStaffIdentityLoad();
            if (!current || !current.key || !current.member || !current.member.id) {
                if (typeof _syncviewInvalidateStaffVerification === 'function') _syncviewInvalidateStaffVerification();
                else _syncviewStaffIdentityVerified = false;
                _syncviewStaffRefreshChrome();
                if (_syncviewStaffGateRequired()) _syncviewOpenStaffGate();
                else _syncviewScheduleStaffPrompt();
                return null;
            }
            const currentSignature = _syncviewStaffIdentitySignature(current);
            _syncviewStaffSetChecking(true);
            try {
                const verified = await _syncviewVerifyStaffIdentity(current, 'staff-boot');
                if (_syncviewStaffIdentitySignature(_syncviewStaffIdentityLoad()) !== currentSignature) return null;
                _syncviewAcceptStaffVerification();
                _syncviewStaffIdentitySave(verified);
                _syncviewStaffRefreshChrome();
                if (typeof _writeUiResumeLegacyQueues === 'function') _writeUiResumeLegacyQueues('staff-verified');
                if (_syncviewStaffGateRequired()) _syncviewLiftStaffGate();
                return verified;
            } catch (e) {
                if (_syncviewStaffIdentitySignature(_syncviewStaffIdentityLoad()) !== currentSignature) return null;
                if (e && e.status === 401) {
                    // Definitively not one of ours (or a hand-written
                    // localStorage blob): clear it and put the gate back.
                    _syncviewStaffIdentityClear();
                    if (_syncviewStaffGateRequired()) _syncviewOpenStaffGate();
                    else _syncviewScheduleStaffPrompt();
                } else {
                    if (typeof _syncviewInvalidateStaffVerification === 'function') _syncviewInvalidateStaffVerification();
                    else _syncviewStaffIdentityVerified = false;
                    _syncviewStaffRefreshChrome();
                    console.warn('[SyncView] staff key verifier unavailable; keeping auth permissive', e);
                    // Verifier unreachable and the key was NOT rejected. The
                    // door still fails closed: the only thing that could admit
                    // here is the stored blob, and the stored blob is not
                    // proof of anything (see the entry-gate note above).
                    if (_syncviewStaffGateRequired()) _syncviewOpenStaffGate();
                }
                return null;
            }
        })().finally(() => {
            _syncviewStaffSetChecking(false);
            _syncviewStaffBootPromise = null;
        });
        return _syncviewStaffBootPromise;
    }

    /* ============================================================
       PTO / TIME OFF  — staff surface + Kasper administration
       All HR records stay behind the pto Edge Function. The browser reads only
       the public mode flag directly; it never reads PTO tables or computes a
       balance. Prefix every module symbol with _pto/PTO_ to keep this additive.
       ============================================================ */
    let _ptoFlagValue = { mode: 'off' };
    let _ptoFlagPromise = null;
    let _ptoFlagChannel = null;
    let _ptoFlagGeneration = 0;
    let _ptoOverviewGeneration = 0;
    let _ptoAdminOverviewGeneration = 0;
    let _ptoQuoteGeneration = 0;
    function _ptoStoreFlagValue(value) { _ptoFlagValue = value; }
    function _ptoSetFlagPromise(value) { _ptoFlagPromise = value; }
    function _ptoSetFlagChannel(value) { _ptoFlagChannel = value; }
    function _ptoNextFlagGeneration() { return ++_ptoFlagGeneration; }
    function _ptoNextOverviewGeneration() { return ++_ptoOverviewGeneration; }
    function _ptoNextAdminOverviewGeneration() { return ++_ptoAdminOverviewGeneration; }
    function _ptoNextQuoteGeneration() { return ++_ptoQuoteGeneration; }
    const PTO_API_TIMEOUT_MS = 20000;
    const _ptoState = {
        overview: null,
        loading: false,
        error: '',
        month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        monthInitialized: false,
        writeOutcomeUnknown: false,
    };
    const _ptoAdminState = {
        overview: null,
        loading: false,
        error: '',
        writeOutcomeUnknown: false,
        // Kasper calendar view state. Kept out of the payload cache so
        // browsing months never re-fetches or re-renders the whole tab.
        month: null,
        monthInitialized: false,
        calView: 'month',
        selectedDay: '',
        calFocusDay: '',
    };

    function _ptoInvalidateOverviewCaches() {
        _ptoOverviewGeneration += 1;
        _ptoAdminOverviewGeneration += 1;
        _ptoQuoteGeneration += 1;
        _ptoState.overview = null;
        _ptoState.error = '';
        _ptoState.loading = false;
        _ptoAdminState.overview = null;
        _ptoAdminState.error = '';
        _ptoAdminState.loading = false;
    }
    function _ptoUnknownWrite(error) {
        return !!(error && error.ptoWriteOutcomeUnknown);
    }
    function _ptoStateConflict(error) {
        return ['request_state_changed', 'request_not_pending', 'decision_conflict', 'cancel_not_allowed', 'request_not_found']
            .includes(String(error && error.code || ''));
    }
    function _ptoShowToast(message) {
        showToast(message);
        const toast = _toastEl;
        const viewport = window.visualViewport;
        if (!toast || !viewport) return;
        const placeInVisibleViewport = () => {
            if (!toast.isConnected) return;
            const current = window.visualViewport;
            if (!current) return;
            const centerDelta = current.offsetLeft + (current.width / 2) - (window.innerWidth / 2);
            const bottomInset = Math.max(0, window.innerHeight - (current.offsetTop + current.height));
            toast.style.left = 'calc(50% + ' + centerDelta + 'px)';
            toast.style.maxWidth = 'min(calc(100vw - 24px), ' + Math.max(0, current.width - 24) + 'px)';
            toast.style.top = 'auto';
            toast.style.bottom = (bottomInset + 24) + 'px';
        };
        const syncVisibleViewport = () => {
            placeInVisibleViewport();
            requestAnimationFrame(placeInVisibleViewport);
        };
        syncVisibleViewport();
        viewport.addEventListener('resize', syncVisibleViewport);
        viewport.addEventListener('scroll', syncVisibleViewport);
        window.addEventListener('resize', syncVisibleViewport);
        setTimeout(() => {
            viewport.removeEventListener('resize', syncVisibleViewport);
            viewport.removeEventListener('scroll', syncVisibleViewport);
            window.removeEventListener('resize', syncVisibleViewport);
        }, 4000);
    }
    function _ptoBlockWrites(surface) {
        const state = surface === 'admin' ? _ptoAdminState : _ptoState;
        if (!state.writeOutcomeUnknown) return false;
        _ptoShowToast('Refresh Time Off to confirm the last change before trying another update.');
        return true;
    }
    async function _ptoRefreshAfterConflict(surface, message) {
        _ptoShowToast(message || 'Time Off changed. Refreshing the latest state.');
        _ptoInvalidateOverviewCaches();
        if (surface === 'admin') await _ptoLoadAdmin(true);
        else await _ptoLoadOverview(true);
    }

    function _ptoEsc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }
    function _ptoAttr(value) { return _ptoEsc(value); }
    const SV_ICON_CHEV = '<span class="sv-control-icon sv-select-chevron" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m4 6 4 4 4-4"/></svg></span>';
    const SV_ICON_CALENDAR = '<span class="sv-control-icon" aria-hidden="true"><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="13" height="11" rx="2"/><path d="M5.5 2.5v3M12.5 2.5v3M2.5 7h13"/></svg></span>';
    const SV_ICON_CHECK = '<svg class="sv-option-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.5 8 3 3 6-6"/></svg>';
    let _svOpenSelectId = null;
    let _svSelectTypeahead = '';
    let _svSelectTypeaheadTimer = 0;

    function _svExplainLabel(key, label, text, className) {
        const explanation = String(text || '').trim();
        const classes = ['sv-explain-label', String(className || '').trim()].filter(Boolean).join(' ');
        return '<span class="' + _ptoAttr(classes) + '" tabindex="0" data-sv-explain data-pto-explain="' + _ptoAttr(key) + '" data-tip="' + _ptoAttr(explanation) + '">' + _ptoEsc(label) + '</span>';
    }
    function _svTone(value) {
        value = String(value || '').toLowerCase();
        return ['wellness', 'sick', 'floating', 'unpaid'].includes(value) ? value : '';
    }
    function _svSelectHtml(id, items, selectedValue, placeholder, opts) {
        opts = opts || {};
        items = Array.isArray(items) ? items : [];
        const active = items.find(item => String(item.value) === String(selectedValue) && !item.disabled) || items.find(item => String(item.value) === String(selectedValue));
        const label = active ? active.label : (placeholder || 'Choose');
        const tone = _svTone(active && active.tone);
        const disabled = opts.disabled ? ' is-disabled' : '';
        const change = opts.onchange ? ' onchange="' + _ptoAttr(opts.onchange) + '"' : '';
        const options = items.length ? items.map((item, index) => {
            const on = !!active && String(item.value) === String(active.value);
            const itemTone = _svTone(item.tone);
            const dot = itemTone ? '<span class="sv-option-dot ' + itemTone + '" aria-hidden="true"></span>' : '';
            return '<button class="sv-select-option' + (on ? ' active' : '') + '" id="' + _ptoAttr(id) + 'Option' + index + '" type="button" role="option" aria-selected="' + (on ? 'true' : 'false') + '" aria-disabled="' + (item.disabled ? 'true' : 'false') + '" tabindex="-1" data-sv-select-option data-value="' + _ptoAttr(item.value) + '" data-label="' + _ptoAttr(item.label) + '" data-tone="' + itemTone + '" onclick="_svSelectPick(event,' + _jsAttrArg(id) + ',' + _jsAttrArg(item.value) + ',' + _jsAttrArg(item.label) + ',' + _jsAttrArg(itemTone) + ')">' + dot + '<span>' + _ptoEsc(item.label) + '</span>' + (on ? SV_ICON_CHECK : '') + '</button>';
        }).join('') : '<div class="sv-select-option" aria-disabled="true">No options</div>';
        const triggerDot = tone ? '<span class="sv-option-dot ' + tone + '" aria-hidden="true"></span>' : '';
        return '<div class="sv-select' + disabled + '" id="' + _ptoAttr(id) + 'Wrap" data-sv-select onkeydown="_svSelectKeydown(event,' + _jsAttrArg(id) + ')"><button class="sv-select-trigger" type="button" role="combobox" id="' + _ptoAttr(id) + 'Btn" aria-haspopup="listbox" aria-controls="' + _ptoAttr(id) + 'Menu" aria-expanded="false"' + (opts.disabled ? ' disabled' : '') + ' onclick="_svSelectToggle(event,' + _jsAttrArg(id) + ')">' + triggerDot + '<span id="' + _ptoAttr(id) + 'Label">' + _ptoEsc(label) + '</span>' + SV_ICON_CHEV + '</button><input type="hidden" id="' + _ptoAttr(id) + '" value="' + _ptoAttr(active ? active.value : '') + '" data-label="' + _ptoAttr(label) + '" data-tone="' + tone + '"' + change + '><div class="sv-select-menu" id="' + _ptoAttr(id) + 'Menu" role="listbox" aria-labelledby="' + _ptoAttr(id) + 'Btn">' + options + '</div></div>';
    }
    function _svSelectOptions(id) {
        const menu = document.getElementById(id + 'Menu');
        return menu ? Array.from(menu.querySelectorAll('[data-sv-select-option]')).filter(option => option.getAttribute('aria-disabled') !== 'true') : [];
    }
    function _svSelectClose(id, returnFocus) {
        id = id || _svOpenSelectId;
        if (!id) return;
        const wrap = document.getElementById(id + 'Wrap');
        const button = document.getElementById(id + 'Btn');
        const menu = document.getElementById(id + 'Menu');
        if (wrap) wrap.classList.remove('open', 'open-up');
        if (menu) menu.style.removeProperty('max-height');
        if (button) {
            button.setAttribute('aria-expanded', 'false');
            button.removeAttribute('aria-activedescendant');
            if (returnFocus) button.focus();
        }
        if (_svOpenSelectId === id) {
            document.removeEventListener('mousedown', _svSelectOutside, true);
            _svOpenSelectId = null;
        }
        _svSelectTypeahead = '';
        if (_svSelectTypeaheadTimer) { clearTimeout(_svSelectTypeaheadTimer); _svSelectTypeaheadTimer = 0; }
    }
    function _svSelectOutside(event) {
        if (!event.target.closest || !event.target.closest('[data-sv-select]')) _svSelectClose();
    }
    function _svSelectFocus(id, index) {
        const options = _svSelectOptions(id);
        if (!options.length) return;
        const safe = (Number(index) % options.length + options.length) % options.length;
        const option = options[safe];
        option.focus();
        document.getElementById(id + 'Btn')?.setAttribute('aria-activedescendant', option.id);
    }
    function _svSelectPlace(id) {
        const wrap = document.getElementById(id + 'Wrap');
        const button = document.getElementById(id + 'Btn');
        const menu = document.getElementById(id + 'Menu');
        if (!wrap || !button || !menu) return;
        wrap.classList.remove('open-up');
        menu.style.removeProperty('max-height');
        const rect = button.getBoundingClientRect();
        const edge = 8;
        const gap = 7;
        const below = Math.max(0, window.innerHeight - rect.bottom - edge - gap);
        const above = Math.max(0, rect.top - edge - gap);
        const naturalHeight = menu.scrollHeight;
        const openUp = below < Math.min(naturalHeight, 180) && above > below;
        wrap.classList.toggle('open-up', openUp);
        const available = openUp ? above : below;
        menu.style.maxHeight = Math.max(84, Math.min(270, available)) + 'px';
    }
    function _svSelectOpen(id, focusMode) {
        const wrap = document.getElementById(id + 'Wrap');
        const button = document.getElementById(id + 'Btn');
        if (!wrap || !button || button.disabled || wrap.classList.contains('is-disabled')) return;
        if (_svOpenSelectId && _svOpenSelectId !== id) _svSelectClose(_svOpenSelectId);
        wrap.classList.add('open');
        _svSelectPlace(id);
        button.setAttribute('aria-expanded', 'true');
        _svOpenSelectId = id;
        setTimeout(() => document.addEventListener('mousedown', _svSelectOutside, true), 0);
        if (focusMode) {
            const options = _svSelectOptions(id);
            const selected = options.findIndex(option => option.getAttribute('aria-selected') === 'true');
            _svSelectFocus(id, focusMode === 'last' ? options.length - 1 : (selected >= 0 ? selected : 0));
        }
    }
    function _svSelectToggle(event, id) {
        if (event) { event.preventDefault(); event.stopPropagation(); }
        const wrap = document.getElementById(id + 'Wrap');
        if (!wrap) return;
        if (wrap.classList.contains('open')) _svSelectClose(id, true);
        else _svSelectOpen(id, false);
    }
    function _svSelectKeydown(event, id) {
        const key = event.key;
        const wrap = document.getElementById(id + 'Wrap');
        if (!wrap) return;
        const open = wrap.classList.contains('open');
        const options = _svSelectOptions(id);
        const focused = options.indexOf(document.activeElement);
        if (key === 'Escape' && open) { event.preventDefault(); _svSelectClose(id, true); return; }
        if (key === 'Tab') { if (open) _svSelectClose(id, false); return; }
        if (key === 'ArrowDown' || key === 'ArrowUp') {
            event.preventDefault();
            if (!open) { _svSelectOpen(id, key === 'ArrowUp' ? 'last' : 'first'); return; }
            _svSelectFocus(id, focused < 0 ? (key === 'ArrowUp' ? options.length - 1 : 0) : focused + (key === 'ArrowUp' ? -1 : 1));
            return;
        }
        if ((key === 'Home' || key === 'End') && open) { event.preventDefault(); _svSelectFocus(id, key === 'Home' ? 0 : options.length - 1); return; }
        if ((key === 'Enter' || key === ' ') && open && focused >= 0) { event.preventDefault(); options[focused].click(); return; }
        if ((key === 'Enter' || key === ' ') && event.target.id === id + 'Btn') { event.preventDefault(); _svSelectOpen(id, 'first'); return; }
        if (open && key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
            _svSelectTypeahead += key.toLowerCase();
            if (_svSelectTypeaheadTimer) clearTimeout(_svSelectTypeaheadTimer);
            _svSelectTypeaheadTimer = setTimeout(() => { _svSelectTypeahead = ''; }, 650);
            const match = options.findIndex(option => String(option.getAttribute('data-label') || '').toLowerCase().startsWith(_svSelectTypeahead));
            if (match >= 0) { event.preventDefault(); _svSelectFocus(id, match); }
        }
    }
    function _svSelectPick(event, id, value, label, tone) {
        if (event) { event.preventDefault(); event.stopPropagation(); }
        const option = event && event.currentTarget;
        if (option && option.getAttribute('aria-disabled') === 'true') return;
        const input = document.getElementById(id);
        const labelEl = document.getElementById(id + 'Label');
        const menu = document.getElementById(id + 'Menu');
        const button = document.getElementById(id + 'Btn');
        if (input) {
            input.value = value;
            input.dataset.label = label || '';
            input.dataset.tone = _svTone(tone);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (labelEl) labelEl.textContent = label || '';
        if (button) {
            button.querySelector('.sv-option-dot')?.remove();
            const safeTone = _svTone(tone);
            if (safeTone) button.insertAdjacentHTML('afterbegin', '<span class="sv-option-dot ' + safeTone + '" aria-hidden="true"></span>');
        }
        if (menu) menu.querySelectorAll('[data-sv-select-option]').forEach(item => {
            const on = item.getAttribute('data-value') === String(value);
            item.classList.toggle('active', on);
            item.setAttribute('aria-selected', on ? 'true' : 'false');
            item.querySelector('.sv-option-check')?.remove();
            if (on) item.insertAdjacentHTML('beforeend', SV_ICON_CHECK);
        });
        _svSelectClose(id, true);
    }
    function _svDateLabel(value, placeholder) {
        const date = _ptoDate(value);
        return date ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date) : (placeholder || 'Choose date');
    }
    function _svDateHtml(id, value, opts) {
        opts = opts || {};
        const label = _svDateLabel(value, opts.placeholder);
        const disabled = opts.disabled ? ' is-disabled' : '';
        const change = opts.onchange ? ' onchange="' + _ptoAttr(opts.onchange) + '"' : '';
        const requiredDescription = opts.required ? '<span class="sr-only" id="' + _ptoAttr(id) + 'Required">Required field.</span>' : '';
        return '<div class="sv-date' + disabled + '" id="' + _ptoAttr(id) + 'Wrap" data-sv-date-picker><button class="sv-date-trigger" type="button" id="' + _ptoAttr(id) + 'Btn" data-sv-date-trigger data-placeholder="' + _ptoAttr(opts.placeholder || 'Choose date') + '" aria-haspopup="dialog" aria-controls="svDatePickerPopup" aria-expanded="false"' + (opts.required ? ' aria-describedby="' + _ptoAttr(id) + 'Required"' : '') + (opts.disabled ? ' disabled' : '') + '>' + SV_ICON_CALENDAR + '<span data-sv-date-label class="' + (value ? '' : 'sv-date-placeholder') + '">' + _ptoEsc(label) + '</span>' + SV_ICON_CHEV + '</button>' + requiredDescription + '<input class="sv-date-value" id="' + _ptoAttr(id) + '" type="date" tabindex="-1" aria-hidden="true" value="' + _ptoAttr(value || '') + '"' + (opts.min ? ' min="' + _ptoAttr(opts.min) + '"' : '') + (opts.max ? ' max="' + _ptoAttr(opts.max) + '"' : '') + (opts.today ? ' data-sv-today="' + _ptoAttr(opts.today) + '"' : '') + (opts.todayPolicy ? ' data-sv-today-policy="' + _ptoAttr(opts.todayPolicy) + '"' : '') + (opts.required ? ' data-required="true"' : '') + (opts.disabled ? ' disabled' : '') + change + '></div>';
    }
    function _svSyncDateControl(id) {
        const input = document.getElementById(id);
        const wrap = document.getElementById(id + 'Wrap');
        if (!input || !wrap) return;
        const label = wrap.querySelector('[data-sv-date-label]');
        const button = document.getElementById(id + 'Btn');
        if (label) {
            label.textContent = _svDateLabel(input.value, button && button.dataset.placeholder || 'Choose date');
            label.classList.toggle('sv-date-placeholder', !input.value);
        }
        wrap.classList.toggle('is-disabled', !!input.disabled);
        if (button) button.disabled = !!input.disabled;
    }
    function _svStepperHtml(id, value, opts) {
        opts = opts || {};
        const step = Number(opts.step) || 1;
        const disabled = opts.disabled ? ' is-disabled' : '';
        const inputAttrs = (opts.min != null ? ' min="' + _ptoAttr(opts.min) + '"' : '') + (opts.max != null ? ' max="' + _ptoAttr(opts.max) + '"' : '') + (opts.required ? ' required' : '') + (opts.disabled ? ' disabled' : '') + (opts.placeholder ? ' placeholder="' + _ptoAttr(opts.placeholder) + '"' : '');
        const change = opts.onchange ? ' onchange="' + _ptoAttr(opts.onchange) + '"' : '';
        return '<div class="sv-stepper' + disabled + '" id="' + _ptoAttr(id) + 'Wrap"><button class="sv-stepper-btn" id="' + _ptoAttr(id) + 'Down" type="button" aria-label="Decrease by ' + _ptoAttr(step) + '" aria-controls="' + _ptoAttr(id) + '" data-tip="' + _ptoAttr(opts.downTip || 'Decrease by ' + step) + '" onclick="_svStepNumber(' + _jsAttrArg(id) + ',-' + step + ')">−</button><input class="sv-stepper-input" id="' + _ptoAttr(id) + '" type="number" inputmode="decimal" step="' + _ptoAttr(step) + '" value="' + _ptoAttr(value == null ? '' : value) + '"' + inputAttrs + change + ' oninput="_svSyncStepper(' + _jsAttrArg(id) + ')"><button class="sv-stepper-btn" id="' + _ptoAttr(id) + 'Up" type="button" aria-label="Increase by ' + _ptoAttr(step) + '" aria-controls="' + _ptoAttr(id) + '" data-tip="' + _ptoAttr(opts.upTip || 'Increase by ' + step) + '" onclick="_svStepNumber(' + _jsAttrArg(id) + ',' + step + ')">+</button></div>';
    }
    function _svSyncStepper(id) {
        const input = document.getElementById(id);
        const wrap = document.getElementById(id + 'Wrap');
        if (!input) return;
        const value = Number(input.value);
        const min = input.min === '' ? -Infinity : Number(input.min);
        const max = input.max === '' ? Infinity : Number(input.max);
        const down = document.getElementById(id + 'Down');
        const up = document.getElementById(id + 'Up');
        if (wrap) wrap.classList.toggle('is-disabled', !!input.disabled);
        if (down) down.disabled = !!input.disabled || (Number.isFinite(value) && value <= min);
        if (up) up.disabled = !!input.disabled || (Number.isFinite(value) && value >= max);
    }
    function _svStepNumber(id, delta) {
        const input = document.getElementById(id);
        if (!input || input.disabled) return;
        const step = Number(input.step) || Math.abs(Number(delta)) || 1;
        const min = input.min === '' ? -Infinity : Number(input.min);
        const max = input.max === '' ? Infinity : Number(input.max);
        const current = input.value === '' ? 0 : Number(input.value);
        if (!Number.isFinite(current)) return;
        let next = current + Number(delta || 0);
        next = Math.min(max, Math.max(min, next));
        next = Math.round(next / step) * step;
        input.value = String(Math.round(next * 1000) / 1000);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        _svSyncStepper(id);
    }
    function _ptoClearValidation(errorId, controlIds) {
        const errorBox = document.getElementById(errorId);
        if (errorBox) errorBox.textContent = '';
        String(controlIds || '').split(/\s+/).filter(Boolean).forEach(id => {
            const control = document.getElementById(id);
            if (!control) return;
            control.removeAttribute('aria-invalid');
            const describedBy = String(control.getAttribute('aria-describedby') || '')
                .split(/\s+/).filter(value => value && value !== errorId);
            if (describedBy.length) control.setAttribute('aria-describedby', describedBy.join(' '));
            else control.removeAttribute('aria-describedby');
        });
    }
    function _ptoShowValidation(errorId, message, focusId, invalidIds) {
        const ids = String(invalidIds || focusId || '').split(/\s+/).filter(Boolean);
        _ptoClearValidation(errorId, ids.join(' '));
        const errorBox = document.getElementById(errorId);
        if (errorBox) errorBox.textContent = message;
        ids.forEach(id => {
            const control = document.getElementById(id);
            if (!control) return;
            control.setAttribute('aria-invalid', 'true');
            const describedBy = new Set(String(control.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
            describedBy.add(errorId);
            control.setAttribute('aria-describedby', Array.from(describedBy).join(' '));
        });
        document.getElementById(focusId || ids[0])?.focus();
    }
    function _ptoEnabled() { return String(_ptoFlagValue && _ptoFlagValue.mode || 'off').toLowerCase() === 'on'; }
    function _ptoSetFlagValue(value, generation) {
        if (generation == null) generation = _ptoNextFlagGeneration();
        if (generation !== _ptoFlagGeneration) return;
        const wasEnabled = _ptoEnabled();
        _ptoStoreFlagValue(value && typeof value === 'object' ? value : { mode: 'off' });
        const enabled = _ptoEnabled();
        const menuItem = document.getElementById('headerTimeOffMenuItem');
        if (menuItem) menuItem.hidden = !enabled;
        if (!enabled) {
            _ptoInvalidateOverviewCaches();
            try {
                if (typeof _kasperState !== 'undefined' && _kasperState && _kasperState.tab === 'time-off') {
                    _kasperFallbackToReview();
                }
            } catch (e) {}
            if (typeof currentNav !== 'undefined' && currentNav === 'time-off') {
                setTimeout(() => { if (currentNav === 'time-off' && !_ptoEnabled()) navTo('home'); }, 0);
            }
        }
        if (wasEnabled !== enabled && typeof currentNav !== 'undefined' && currentNav === 'kasper') {
            setTimeout(() => {
                if (currentNav !== 'kasper') return;
                const content = document.getElementById('content');
                const kasper = svAreaApi('kasper');   // on demand; on screen means loaded
                if (content && kasper) {
                    content.innerHTML = kasper.render();
                    kasper.mount();
                }
            }, 0);
        }
    }
    async function _ptoFetchFlagOnce() {
        const generation = _ptoNextFlagGeneration();
        if (!CAL_SUPABASE_URL || !CAL_SUPABASE_ANON_KEY) { _ptoSetFlagValue({ mode: 'off' }, generation); return; }
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timeout = controller ? setTimeout(() => controller.abort(), 5000) : null;
        try {
            const url = CAL_SUPABASE_URL + '/rest/v1/syncview_runtime_flags?select=value&key=eq.' + encodeURIComponent(PTO_FLAG_KEY) + '&limit=1';
            const options = { headers: { apikey: CAL_SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY, Accept: 'application/json' } };
            if (controller) options.signal = controller.signal;
            const response = await fetch(url, options);
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const rows = await response.json();
            const row = Array.isArray(rows) ? rows[0] : null;
            _ptoSetFlagValue(row && row.value ? row.value : { mode: 'off' }, generation);
        } catch (error) {
            _ptoSetFlagValue({ mode: 'off' }, generation);
            console.warn('[PTO] runtime flag read failed; keeping Time Off dark', error);
        } finally { if (timeout) clearTimeout(timeout); }
    }
    async function _ptoSubscribeFlag() {
        if (_ptoFlagChannel || typeof _calRuntimeFlagClient !== 'function') return;
        const client = await _calRuntimeFlagClient();
        if (!client || _ptoFlagChannel) return;
        try {
            _ptoSetFlagChannel(client
                .channel('syncview-pto-runtime-flag')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'syncview_runtime_flags', filter: 'key=eq.' + PTO_FLAG_KEY }, payload => {
                    const row = payload && payload.new ? payload.new : null;
                    const generation = _ptoNextFlagGeneration();
                    _ptoSetFlagValue(row && row.value ? row.value : { mode: 'off' }, generation);
                })
                .subscribe());
        } catch (error) {
            _ptoSetFlagChannel(null);
            console.warn('[PTO] runtime flag subscription failed', error);
        }
    }
    function _ptoPrimeFlag() {
        if (!_ptoFlagPromise) _ptoSetFlagPromise(_ptoFetchFlagOnce().then(_ptoSubscribeFlag).catch(() => null));
        return _ptoFlagPromise;
    }
    function _ptoRefreshFlagOnResume() {
        try { if (document.visibilityState === 'hidden') return; } catch (e) {}
        _ptoFetchFlagOnce();
    }
    window.addEventListener('focus', _ptoRefreshFlagOnResume);
    document.addEventListener('visibilitychange', _ptoRefreshFlagOnResume);
    function _ptoOpenFromMenu() {
        _syncviewCloseStaffAccount();
        if (_ptoEnabled()) navTo('time-off');
    }
    function _ptoApiMessage(json, status) {
        const code = String(json && (json.code || json.error) || '');
        if (code === 'insufficient_balance') return 'This request is larger than the available wellness balance.';
        if (code === 'insufficient_sick_balance') return 'This request is larger than the available sick balance.';
        if (code === 'pto_not_enabled') return 'Your Time Off profile has not been enabled yet. Ask an Admin to finish setup.';
        if (code === 'member_not_found') return 'This active staff profile is no longer available. Refresh Time Off.';
        if (code === 'member_inactive') return 'This request belongs to an inactive staff profile and cannot be approved. It can still be denied for cleanup.';
        if (code === 'feature_disabled') return 'Time Off is temporarily unavailable.';
        if (code === 'not_eligible') return 'Paid time off becomes available 60 days after the start date.';
        if (code === 'past_date_not_allowed') return 'Only sick leave can be requested for today or a past date.';
        if (code === 'request_range_too_long') return 'Split this request into shorter date ranges.';
        if (code === 'floating_holiday_used' || code === 'floating_holiday_unavailable') return 'The floating holiday is already used or awaiting a decision this calendar year.';
        if (code === 'floating_holiday_range') return 'Choose one business date for a floating holiday.';
        if (code === 'crosses_leave_year') return 'Paid requests cannot cross the Dec 31 leave-year boundary. Submit separate requests.';
        if (code === 'request_state_changed') return 'Time Off changed while this form was open. Refresh and try again.';
        if (code === 'request_not_pending') return 'This request was already decided or cancelled. SyncView will refresh the latest status.';
        if (code === 'decision_conflict') return 'Another Time Off change happened during this decision. SyncView will refresh before you try again.';
        if (code === 'cancel_not_allowed') return 'This request can no longer be cancelled. SyncView will refresh its current status.';
        if (code === 'request_not_found') return 'This request is no longer available. SyncView will refresh the list.';
        if (code === 'pto_service_failed') return 'Time Off is temporarily unavailable. Try again in a moment.';
        if (code === 'cancellation_audit_not_ready') return 'Approved leave cannot be cancelled until the private cancellation-audit migration is ready.';
        if (code === 'start_date_history_conflict') return 'This start date cannot be changed here because leave history already exists. Use a reviewed data correction so balances are not silently rewritten.';
        if (code === 'days_mismatch' || code === 'day_count_mismatch' || code === 'invalid_days') return 'Choose a half-day amount no larger than the business days in this range.';
        return String(json && (json.message || json.error_description || json.error) || (status === 403 ? 'This action is not available for this staff role.' : 'Time Off could not be updated.'));
    }
    async function _ptoApi(action, method, payload, retried) {
        const adminAction = action === 'decide' || action === 'adjust' || action === 'set_start_date' || (action === 'cancel' && _syncviewStaffCan('pto-admin'));
        const identity = await _syncviewRequireStaffIdentity(adminAction ? 'pto-admin' : undefined);
        method = method || (action === 'overview' ? 'GET' : 'POST');
        const wire = Object.assign({}, payload || {});
        if (method !== 'GET') wire.action = action;
        if (adminAction) wire.actor_member_id = identity.member.id;
        if ((action === 'quote' || action === 'request' || action === 'cancel') && !wire.member_id) wire.member_id = identity.member.id;
        let url = PTO_EF_URL + '?action=' + encodeURIComponent(action);
        if (action === 'overview') url += '&member_id=' + encodeURIComponent(identity.member.id);
        const options = {
            method,
            headers: _syncviewEfHeaders(method === 'GET' ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' }, PTO_EF_URL),
        };
        if (method !== 'GET') options.body = JSON.stringify(wire);
        const mutating = method !== 'GET' && action !== 'quote';
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        let timedOut = false;
        const timeout = controller ? setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, PTO_API_TIMEOUT_MS) : null;
        if (controller) options.signal = controller.signal;
        let response;
        try {
            response = await fetch(url, options);
        } catch (cause) {
            const error = new Error(mutating
                ? 'SyncView could not confirm whether this change was saved. Refresh Time Off before trying again.'
                : (timedOut
                    ? 'Time Off took too long to respond. Try again.'
                    : 'SyncView could not reach Time Off. Check your connection and try again.'));
            error.code = mutating ? 'write_outcome_unknown' : (timedOut ? 'request_timeout' : 'network_error');
            error.ptoWriteOutcomeUnknown = mutating;
            throw error;
        } finally {
            if (timeout) clearTimeout(timeout);
        }
        let json = null;
        try { json = await response.json(); } catch (e) {}
        if (json && (json.error === 'feature_disabled' || json.code === 'feature_disabled')) _ptoSetFlagValue({ mode: 'off' });
        if (response.status === 401) {
            const active = _syncviewStaffIdentityForHeaders();
            if (_syncviewStaffIdentitySignature(active) !== _syncviewStaffIdentitySignature(identity)) throw new Error('Staff sign-in changed.');
            _syncviewStaffIdentityClear();
            if (retried) throw new Error(_ptoApiMessage(json, response.status));
            const replacement = await _syncviewOpenStaffIdentity({ reason: 'expired' });
            if (!replacement) throw new Error('Staff sign-in required.');
            return _ptoApi(action, method, payload, true);
        }
        const active = _syncviewStaffIdentityForHeaders();
        if (_syncviewStaffIdentitySignature(active) !== _syncviewStaffIdentitySignature(identity)) throw new Error('Staff sign-in changed.');
        if (!response.ok || !json || json.ok === false) {
            const error = new Error(_ptoApiMessage(json, response.status));
            error.status = response.status;
            error.code = json && (json.code || json.error);
            throw error;
        }
        return json || {};
    }
    function _ptoDate(value) {
        const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return null;
        const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    function _ptoIso(date) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
        return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    }
    function _ptoTodayIso() { return _ptoIso(new Date()); }
    function _ptoLeaveYearEndFor(startIso, ptoStartIso) {
        const start = _ptoDate(startIso);
        const ptoStart = _ptoDate(ptoStartIso);
        if (!start || !ptoStart) return '';
        // Leave year is the shared Jan 1-Dec 31 calendar year (Kasper ruling,
        // 2026-08-11), so the end date is always Dec 31 of the request's own
        // year regardless of hire date.
        return _ptoIso(new Date(start.getFullYear(), 11, 31, 12));
    }
    function _ptoFmtDate(value, options) {
        const date = _ptoDate(value);
        if (!date) return '—';
        return new Intl.DateTimeFormat('en-US', options || { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
    }
    function _ptoFmtDateTime(value) {
        const date = new Date(String(value || ''));
        if (Number.isNaN(date.getTime())) return '';
        return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
    }
    function _ptoNumber(value, fallback) {
        const n = Number(value);
        return Number.isFinite(n) ? n : (fallback == null ? 0 : fallback);
    }
    function _ptoFmtDays(value) {
        const n = _ptoNumber(value);
        return Number.isInteger(n) ? n.toFixed(1) : String(Math.round(n * 10) / 10);
    }
    function _ptoTypeLabel(value) {
        return ({ wellness: 'Wellness', sick: 'Sick', floating_holiday: 'Floating holiday', unpaid: 'Unpaid' })[String(value || '')] || String(value || 'Time off').replace(/_/g, ' ');
    }
    function _ptoTypePill(value) {
        const tone = _svTone(value === 'floating_holiday' ? 'floating' : value);
        return '<span class="pto-type-pill ' + tone + '"><span class="sv-option-dot ' + tone + '" aria-hidden="true"></span>' + _ptoEsc(_ptoTypeLabel(value)) + '</span>';
    }
    function _ptoStatusHtml(status) {
        const value = String(status || 'pending').toLowerCase();
        return '<span class="pto-status ' + _ptoAttr(value) + '">' + _ptoEsc(value) + '</span>';
    }
    function _ptoBalance(overview) {
        const raw = overview && (overview.balance || overview.my_balance) || {};
        const wellness = raw.wellness || {};
        const sick = raw.sick || {};
        const floating = raw.floating_holiday || {};
        const leaveYear = raw.leave_year || raw.current_leave_year || {};
        return {
            pto_enabled: raw.pto_enabled != null ? raw.pto_enabled : overview && overview.pto_enabled,
            pto_start_date: raw.pto_start_date || raw.start_date || '',
            eligible: raw.eligible,
            eligibility_date: raw.eligibility_date || '',
            wellness_granted: _ptoNumber(raw.wellness_granted != null ? raw.wellness_granted : wellness.granted),
            wellness_approved_used: _ptoNumber(raw.wellness_approved_used != null ? raw.wellness_approved_used : (wellness.approved_used != null ? wellness.approved_used : raw.wellness_used)),
            wellness_adjustment: _ptoNumber(raw.wellness_adjustment != null ? raw.wellness_adjustment : wellness.adjustment),
            wellness_used: _ptoNumber(raw.wellness_used != null ? raw.wellness_used : wellness.used),
            wellness_available: _ptoNumber(raw.wellness_available != null ? raw.wellness_available : wellness.available),
            sick_used: _ptoNumber(raw.sick_used != null ? raw.sick_used : sick.used),
            sick_approved_used: _ptoNumber(raw.sick_approved_used != null ? raw.sick_approved_used : (sick.approved_used != null ? sick.approved_used : raw.sick_used)),
            sick_adjustment: _ptoNumber(raw.sick_adjustment != null ? raw.sick_adjustment : sick.adjustment),
            sick_available: _ptoNumber(raw.sick_available != null ? raw.sick_available : sick.available),
            floating_holiday_used: !!(raw.floating_holiday_used != null ? raw.floating_holiday_used : floating.used),
            floating_holiday_pending: !!(raw.floating_holiday_pending != null ? raw.floating_holiday_pending : floating.pending),
            floating_holiday_status: String(raw.floating_holiday_status || floating.status || ''),
            next_accrual_date: raw.next_accrual_date || wellness.next_accrual_date || '',
            leave_year_start: raw.leave_year_start || leaveYear.start || '',
            leave_year_end: raw.leave_year_end || leaveYear.end || '',
        };
    }
    function _ptoHolidayDate(row) { return String(row && (row.observed_date || row.date) || ''); }
    function _ptoCountRequestDays(startValue, endValue, holidays) {
        const start = _ptoDate(startValue);
        const end = _ptoDate(endValue);
        if (!start || !end || end < start) return 0;
        const holidayDates = new Set((Array.isArray(holidays) ? holidays : []).map(_ptoHolidayDate).filter(Boolean));
        let count = 0;
        const cursor = new Date(start.getTime());
        while (cursor <= end) {
            const day = cursor.getDay();
            if (day !== 0 && day !== 6 && !holidayDates.has(_ptoIso(cursor))) count += 1;
            cursor.setDate(cursor.getDate() + 1);
        }
        return count;
    }
    function renderTimeOffView() {
        return '<div class="pto-wrap"><div class="pto-head"><div><div class="pto-eyebrow">People · Time away</div><h1 class="pto-title">Time Off</h1><p class="pto-sub">See your wellness balance, request leave, and plan around the team calendar.</p></div><button class="pto-refresh" id="ptoRefresh" type="button" onclick="_ptoLoadOverview(true)">Refresh</button></div><div id="ptoRoot"></div></div>';
    }
    function mountTimeOffView() {
        if (!_ptoEnabled()) { navTo('home'); return; }
        // Do not reuse a balance after leaving and returning: a disconnected
        // realtime client must still converge on the server-side kill switch.
        _ptoInvalidateOverviewCaches();
        _ptoPaint();
        _ptoFetchFlagOnce().then(() => {
            if (typeof currentNav === 'undefined' || currentNav !== 'time-off') return;
            if (!_ptoEnabled()) { navTo('home'); return; }
            _ptoLoadOverview(true);
        });
    }
    async function _ptoLoadOverview(force) {
        if (!_ptoEnabled() || (_ptoState.loading && !force)) return;
        if (_ptoState.overview && !force) { _ptoPaint(); return; }
        const generation = _ptoNextOverviewGeneration();
        _ptoState.loading = true;
        _ptoState.error = '';
        _ptoPaint();
        try {
            const overview = await _ptoApi('overview', 'GET');
            if (generation !== _ptoOverviewGeneration) return;
            _ptoState.overview = overview;
            _ptoState.writeOutcomeUnknown = false;
            const asOf = _ptoDate(_ptoState.overview && _ptoState.overview.as_of_date);
            if (asOf) {
                const currentMonth = new Date(asOf.getFullYear(), asOf.getMonth(), 1);
                const minMonth = new Date(asOf.getFullYear(), asOf.getMonth() - 3, 1);
                const maxMonth = new Date(asOf.getFullYear(), asOf.getMonth() + 3, 1);
                if (!_ptoState.monthInitialized) _ptoState.month = currentMonth;
                else if (_ptoState.month < minMonth) _ptoState.month = minMonth;
                else if (_ptoState.month > maxMonth) _ptoState.month = maxMonth;
                _ptoState.monthInitialized = true;
            }
        } catch (error) {
            if (generation !== _ptoOverviewGeneration) return;
            _ptoState.error = error && error.message ? error.message : 'Time Off could not be loaded.';
        } finally {
            if (generation !== _ptoOverviewGeneration) return;
            _ptoState.loading = false;
            _ptoPaint();
        }
    }
    function _ptoLoadingHtml(label) {
        return '<div class="pto-card pto-signin" role="status"><span class="pto-spinner" aria-hidden="true"></span><strong>' + _ptoEsc(label || 'Loading Time Off') + '</strong><span>Balances and requests are loaded securely for the signed-in staff member.</span></div>';
    }
    function _ptoPaint() {
        const root = document.getElementById('ptoRoot');
        if (!root || currentNav !== 'time-off') return;
        const refresh = document.getElementById('ptoRefresh');
        if (refresh) refresh.disabled = _ptoState.loading;
        if (!_syncviewStaffIdentityForHeaders()) {
            root.innerHTML = '<div class="pto-card pto-signin"><strong>Staff sign-in required</strong><span>Sign in with your verified staff identity to load private Time Off details.</span><button class="pto-refresh" type="button" onclick="_ptoLoadOverview(true)">Staff sign in</button></div>';
            return;
        }
        if (_ptoState.loading && !_ptoState.overview) { root.innerHTML = _ptoLoadingHtml('Loading your balance'); return; }
        if (_ptoState.error && !_ptoState.overview) {
            root.innerHTML = '<div class="pto-card pto-signin"><strong>Could not load Time Off</strong><span>' + _ptoEsc(_ptoState.error) + '</span><button class="pto-refresh" type="button" onclick="_ptoLoadOverview(true)">Try again</button></div>';
            return;
        }
        const overview = _ptoState.overview;
        if (!overview) { root.innerHTML = _ptoLoadingHtml('Preparing Time Off'); return; }
        const balance = _ptoBalance(overview);
        const enabled = balance.pto_enabled !== false;
        const writeLocked = _ptoState.writeOutcomeUnknown;
        const requests = (overview.my_requests || overview.requests || []).slice().sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || '')));
        const members = Array.isArray(overview.members) ? overview.members : [];
        const availableClass = balance.wellness_available < 0 ? ' negative' : '';
        const floatingLabel = balance.floating_holiday_pending ? 'Pending' : (balance.floating_holiday_used ? 'Used' : (balance.floating_holiday_status === 'ineligible' ? 'Not eligible' : 'Available'));
        const floatingUnavailable = balance.floating_holiday_used || balance.floating_holiday_pending;
        const asOf = String(overview.as_of_date || _ptoTodayIso());
        const typeItems = [
            { value: 'wellness', label: 'Wellness', tone: 'wellness' },
            { value: 'sick', label: 'Sick', tone: 'sick' },
            { value: 'floating_holiday', label: 'Floating holiday' + (balance.floating_holiday_pending ? ' (pending)' : ''), tone: 'floating', disabled: floatingUnavailable },
            { value: 'unpaid', label: 'Unpaid', tone: 'unpaid' },
        ];
        const wellnessAdjustmentMetric = balance.wellness_adjustment === 0 ? '' : '<div class="pto-balance-metric"><strong>' + (balance.wellness_adjustment > 0 ? '+' : '') + _ptoFmtDays(balance.wellness_adjustment) + '</strong>' + _svExplainLabel('wellness-adjustments', 'adjustments', 'Credits add to your balance and deductions reduce it; approved leave is shown separately.') + '</div>';
        const balanceHtml = '<section class="pto-card pto-balance-card"><div class="pto-balance-label">' + _svExplainLabel('wellness-available', 'Wellness available', 'Days you can request now after grants, approved leave, and adjustments.') + '</div>'
            + '<div class="pto-balance-number' + availableClass + '">' + _ptoFmtDays(balance.wellness_available) + '<span>days</span></div>'
            + '<div class="pto-balance-metrics"><div class="pto-balance-metric"><strong>' + _ptoFmtDays(balance.wellness_granted) + '</strong>' + _svExplainLabel('granted-this-leave-year', 'granted this leave year', 'Wellness days earned in your current leave year.') + '</div>'
            + '<div class="pto-balance-metric"><strong>' + _ptoFmtDays(balance.wellness_approved_used) + '</strong>' + _svExplainLabel('approved-leave', 'approved leave', 'Wellness days in approved requests during this leave year.') + '</div>' + wellnessAdjustmentMetric
            + '<div class="pto-balance-metric"><strong class="' + (balance.sick_available < 0 ? 'pto-negative' : '') + '">' + _ptoFmtDays(balance.sick_available) + '</strong>' + _svExplainLabel('sick-days-remaining', 'sick days remaining', 'Sick days still available in your current leave year.') + '</div>'
            + '<div class="pto-balance-metric"><strong>' + floatingLabel + '</strong>' + _svExplainLabel('floating-holiday', 'floating holiday', 'One flexible paid holiday is available each calendar year; a pending request reserves it.') + '</div>'
            + '<div class="pto-balance-metric"><strong>' + _ptoFmtDate(balance.next_accrual_date, { month: 'short', day: 'numeric' }) + '</strong>' + _svExplainLabel('next-wellness-grant', 'next wellness grant', 'The next date your policy adds wellness time, if you have not reached the cap.') + '</div></div>'
            + '<div class="pto-yearline"><span>Leave year ' + _ptoEsc(_ptoFmtDate(balance.leave_year_start, { month: 'short', day: 'numeric', year: 'numeric' })) + ' – ' + _ptoEsc(_ptoFmtDate(balance.leave_year_end, { month: 'short', day: 'numeric', year: 'numeric' })) + '</span><span>Sick approved ' + _ptoFmtDays(balance.sick_approved_used) + (balance.sick_adjustment ? ' · adjustments ' + (balance.sick_adjustment > 0 ? '+' : '') + _ptoFmtDays(balance.sick_adjustment) : '') + '</span></div></section>';
        const setupNote = enabled ? '' : '<div class="pto-notice">Your Time Off profile is not enabled yet. An Admin can finish setup from Kasper → Time Off.</div>';
        const requestHtml = '<section class="pto-card"><div class="pto-card-head"><div><div class="pto-card-title-row">' + _svExplainLabel('request-time-off', 'Request time off', 'Weekends and observed company holidays are skipped automatically. The server checks the final count again when you submit.', 'pto-card-title') + '</div><div class="pto-card-sub">Pick your dates and SyncView will count the business days.</div></div></div>'
            + '<form class="pto-form" id="ptoRequestForm" onsubmit="_ptoSubmitRequest(event)" oninput="_ptoClearValidation(\'ptoFormError\', \'ptoRequestTypeBtn ptoStartDateBtn ptoEndDateBtn ptoDays\')" onchange="_ptoClearValidation(\'ptoFormError\', \'ptoRequestTypeBtn ptoStartDateBtn ptoEndDateBtn ptoDays\')">' + setupNote
            + '<div class="pto-field full"><label for="ptoRequestTypeBtn">' + _svExplainLabel('request-type', 'Type', 'Wellness and sick use their matching balances. A floating holiday is one flexible paid day; unpaid leave does not change a balance.') + '</label>' + _svSelectHtml('ptoRequestType', typeItems, 'wellness', 'Choose type', { disabled: !enabled, onchange: '_ptoSyncRequestForm(false)' }) + '</div>'
            + '<div class="pto-field"><label for="ptoStartDateBtn">Start date</label>' + _svDateHtml('ptoStartDate', '', { disabled: !enabled, required: true, today: asOf, onchange: '_ptoSyncRequestForm(true)' }) + '</div>'
            + '<div class="pto-field"><label for="ptoEndDateBtn">End date</label>' + _svDateHtml('ptoEndDate', '', { disabled: !enabled, required: true, today: asOf, onchange: '_ptoSyncRequestForm(true)' }) + '</div>'
            + '<div class="pto-field full"><label for="ptoDays">' + _svExplainLabel('days-requested', 'Days requested', 'This is calculated from your dates. Use minus or plus only when one endpoint is a half day.') + '</label>' + _svStepperHtml('ptoDays', '', { min: 0.5, step: 0.5, disabled: true, downTip: 'Use one half-day endpoint', upTip: 'Return to the full business-day count' }) + '<div class="pto-field-help" id="ptoDaysHelp">Choose a date range to count business days.</div></div>'
            + '<div class="pto-notice" id="ptoNotice" hidden>Less than 14 days’ notice. This is allowed, but the policy asks for two weeks when possible.</div>'
            + '<div class="pto-field full"><label for="ptoNote">Note <span style="font-weight:500;color:var(--text-muted);">(optional)</span></label><textarea id="ptoNote" maxlength="1000" placeholder="Anything Kasper should know"' + (enabled ? '' : ' disabled') + '></textarea></div>'
            + '<div class="pto-form-error" id="ptoFormError" role="alert"></div><button class="pto-submit" id="ptoSubmit" type="submit"' + (enabled && !writeLocked ? '' : ' disabled') + '>' + (writeLocked ? 'Refresh to verify' : 'Send request') + '</button></form></section>';
        const requestRows = requests.length ? '<div class="pto-table-scroll pto-staff-history-table"><table class="pto-table"><thead><tr><th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th></th></tr></thead><tbody>' + requests.map(row => '<tr><td>' + _ptoTypePill(row.type) + '</td><td>' + _ptoEsc(_ptoFmtDate(row.start_date, { month: 'short', day: 'numeric' })) + ' – ' + _ptoEsc(_ptoFmtDate(row.end_date, { month: 'short', day: 'numeric', year: 'numeric' })) + (row.decision_note ? '<div class="pto-table-note"><strong>Decision note:</strong> ' + _ptoEsc(row.decision_note) + '</div>' : '') + '</td><td>' + _ptoFmtDays(row.days) + '</td><td>' + _ptoStatusHtml(row.status) + '</td><td>' + (String(row.status) === 'pending' ? '<button class="pto-row-btn" type="button"' + (writeLocked ? ' disabled' : '') + ' onclick="_ptoCancelRequest(' + _jsAttrArg(row.id) + ',this)">Cancel</button>' : '') + '</td></tr>').join('') + '</tbody></table></div>'
            + '<div class="pto-request-history-cards">' + requests.map(row => '<article class="pto-request-history-card type-' + _svTone(row.type === 'floating_holiday' ? 'floating' : row.type) + '"><div class="pto-request-history-top">' + _ptoTypePill(row.type) + _ptoStatusHtml(row.status) + '</div><div class="pto-request-history-dates">' + _ptoEsc(_ptoFmtDate(row.start_date, { month: 'short', day: 'numeric' })) + ' – ' + _ptoEsc(_ptoFmtDate(row.end_date, { month: 'short', day: 'numeric', year: 'numeric' })) + '</div>' + (row.decision_note ? '<div class="pto-table-note"><strong>Decision note:</strong> ' + _ptoEsc(row.decision_note) + '</div>' : '') + '<div class="pto-request-history-actions"><span class="pto-request-history-meta">' + _ptoFmtDays(row.days) + ' days requested</span>' + (String(row.status) === 'pending' ? '<button class="pto-row-btn" type="button"' + (writeLocked ? ' disabled' : '') + ' onclick="_ptoCancelRequest(' + _jsAttrArg(row.id) + ',this)">Cancel request</button>' : '') + '</div></article>').join('') + '</div>'
            : '<div class="pto-empty">No requests yet. Your submitted and past requests will stay here.</div>';
        const historyHtml = '<section class="pto-card"><div class="pto-card-head"><div><div class="pto-card-title">My requests</div><div class="pto-card-sub">Pending requests can be cancelled before Kasper decides.</div></div></div>' + requestRows + '</section>';
        const memberRows = members.length ? members.map(member => '<tr><td><strong>' + _ptoEsc(member.name || 'Staff member') + '</strong></td><td class="' + (_ptoNumber(member.wellness_available) < 0 ? 'pto-negative' : '') + '">' + _ptoFmtDays(member.wellness_available) + '</td><td>' + (member.on_leave_today ? '<span class="pto-status approved">Away today</span>' : '—') + '</td></tr>').join('') : '';
        const teamHtml = '<section class="pto-card"><div class="pto-card-head"><div><div class="pto-card-title">Team snapshot</div><div class="pto-card-sub">Available wellness days and who is away today.</div></div></div>' + (memberRows ? '<div class="pto-table-scroll"><table class="pto-table" style="min-width:420px"><thead><tr><th>Team member</th><th>Available</th><th>Today</th></tr></thead><tbody>' + memberRows + '</tbody></table></div>' : '<div class="pto-empty">No enabled team members yet.</div>') + '</section>';
        const refreshErrorHtml = _ptoState.error ? '<div class="pto-notice">Could not refresh Time Off. The data below may be out of date: ' + _ptoEsc(_ptoState.error) + '</div>' : '';
        const writeUnknownHtml = writeLocked ? '<div class="pto-notice" role="status">SyncView could not confirm the last change. Select Refresh before sending or cancelling another request.</div>' : '';
        root.innerHTML = '<div class="pto-layout">' + writeUnknownHtml + refreshErrorHtml + '<div class="pto-stack">' + balanceHtml + requestHtml + '</div><div class="pto-stack">' + historyHtml + teamHtml + '</div><section class="pto-card pto-calendar-card">' + _ptoRenderCalendar(overview) + '</section></div>';
        _ptoSyncRequestForm(false);
    }
    function _ptoApplyRequestDayBounds(fullDays, isFloating, resetDays, profileEnabled) {
        const days = document.getElementById('ptoDays');
        const help = document.getElementById('ptoDaysHelp');
        if (!days) return;
        fullDays = _ptoNumber(fullDays);
        const allowedDays = isFloating ? Math.min(1, fullDays) : fullDays;
        const partialDayCount = Math.max(0.5, allowedDays - 0.5);
        days.min = allowedDays > 0 ? String(partialDayCount) : '0.5';
        days.max = allowedDays > 0 ? String(allowedDays) : '';
        if (resetDays || !days.value || _ptoNumber(days.value) > allowedDays || _ptoNumber(days.value) < partialDayCount) {
            days.value = allowedDays > 0 ? String(allowedDays) : '';
        }
        days.disabled = !profileEnabled || allowedDays <= 0;
        _svSyncStepper('ptoDays');
        if (help) help.textContent = fullDays > 0
            ? (isFloating ? 'A floating holiday uses one business date; 0.5 or 1.0 day is allowed.' : fullDays.toFixed(1) + ' business days; use ' + partialDayCount.toFixed(1) + ' when one endpoint is a half-day.')
            : 'Choose a valid range containing at least one business day.';
    }
    function _ptoSetRequestQuotePending(pending, profileEnabled) {
        const button = document.getElementById('ptoSubmit');
        const days = document.getElementById('ptoDays');
        if (!button) return;
        button.dataset.quotePending = pending ? 'true' : 'false';
        button.disabled = _ptoState.writeOutcomeUnknown || !!pending || !profileEnabled || !days || days.disabled || !String(days.value || '').trim();
    }
    async function _ptoQuoteRequest(generation, type, start, end, isFloating, resetDays, profileEnabled) {
        const help = document.getElementById('ptoDaysHelp');
        try {
            const quote = await _ptoApi('quote', 'POST', { type, start_date: start, end_date: end });
            if (generation !== _ptoQuoteGeneration) return;
            if (document.getElementById('ptoRequestType')?.value !== type
                || document.getElementById('ptoStartDate')?.value !== start
                || document.getElementById('ptoEndDate')?.value !== end) return;
            _ptoApplyRequestDayBounds(Number(quote.full_days || 0), isFloating, resetDays, profileEnabled);
            _ptoSetRequestQuotePending(false, profileEnabled);
        } catch (error) {
            if (generation !== _ptoQuoteGeneration) return;
            const days = document.getElementById('ptoDays');
            if (days) { days.value = ''; days.disabled = true; _svSyncStepper('ptoDays'); }
            if (help) help.textContent = error && error.message ? error.message : 'SyncView could not count this range. Try again.';
            _ptoSetRequestQuotePending(false, profileEnabled);
        }
    }
    function _ptoSyncRequestForm(resetDays) {
        const start = document.getElementById('ptoStartDate');
        const end = document.getElementById('ptoEndDate');
        const days = document.getElementById('ptoDays');
        const help = document.getElementById('ptoDaysHelp');
        const notice = document.getElementById('ptoNotice');
        const type = document.getElementById('ptoRequestType');
        if (!start || !end || !days) return;
        const isFloating = !!(type && type.value === 'floating_holiday');
        const balance = _ptoBalance(_ptoState.overview);
        const profileEnabled = balance.pto_enabled !== false;
        const asOfIso = String(_ptoState.overview && _ptoState.overview.as_of_date || _ptoTodayIso());
        const afterAsOf = _ptoDate(asOfIso);
        if (afterAsOf) afterAsOf.setDate(afterAsOf.getDate() + 1);
        const futureMin = afterAsOf ? _ptoIso(afterAsOf) : '';
        const paidEnd = type && type.value !== 'unpaid'
            ? _ptoLeaveYearEndFor(start.value, balance.pto_start_date)
            : '';
        start.min = type && type.value === 'sick' ? String(balance.eligibility_date || balance.pto_start_date || '') : futureMin;
        start.max = '';
        if (start.value && ((start.min && start.value < start.min) || (start.max && start.value > start.max))) {
            start.value = '';
            end.value = '';
        }
        if (!start.value) end.value = '';
        if (isFloating && start.value && end.value !== start.value) end.value = start.value;
        end.min = start.value || start.min;
        end.max = paidEnd;
        if (end.value && ((end.min && end.value < end.min) || (end.max && end.value > end.max))) end.value = '';
        end.disabled = !profileEnabled || isFloating || !start.value;
        _svSyncDateControl('ptoStartDate');
        _svSyncDateControl('ptoEndDate');
        const asOfYear = Number(asOfIso.slice(0, 4));
        const holidayMin = String(_ptoState.overview && _ptoState.overview.holiday_date_min || ((asOfYear - 1) + '-01-01'));
        const holidayMax = String(_ptoState.overview && _ptoState.overview.holiday_date_max || ((asOfYear + 1) + '-12-31'));
        const needsServerQuote = !!(start.value && end.value && (start.value < holidayMin || end.value > holidayMax));
        const generation = _ptoNextQuoteGeneration();
        if (needsServerQuote) {
            days.value = '';
            days.disabled = true;
            _svSyncStepper('ptoDays');
            if (help) help.textContent = 'Counting business days with the server…';
            _ptoSetRequestQuotePending(true, profileEnabled);
            _ptoQuoteRequest(generation, type && type.value || '', start.value, end.value, isFloating, resetDays, profileEnabled);
        } else {
            const fullDays = _ptoCountRequestDays(start.value, end.value, _ptoState.overview && _ptoState.overview.holidays);
            _ptoApplyRequestDayBounds(fullDays, isFloating, resetDays, profileEnabled);
            _ptoSetRequestQuotePending(false, profileEnabled);
        }
        if (notice) {
            const selected = _ptoDate(start.value);
            const today = _ptoDate(_ptoState.overview && _ptoState.overview.as_of_date || _ptoTodayIso());
            const daysOut = selected && today ? Math.floor((selected - today) / 86400000) : 999;
            notice.hidden = !selected || daysOut >= 14;
        }
    }
    async function _ptoSubmitRequest(event) {
        event.preventDefault();
        if (_ptoBlockWrites('staff')) return;
        const form = event.currentTarget;
        const button = document.getElementById('ptoSubmit');
        const errorBox = document.getElementById('ptoFormError');
        const type = document.getElementById('ptoRequestType').value;
        const start = document.getElementById('ptoStartDate').value;
        const end = document.getElementById('ptoEndDate').value;
        const daysInput = document.getElementById('ptoDays');
        const days = _ptoNumber(daysInput.value, NaN);
        const note = document.getElementById('ptoNote').value.trim();
        const requestControls = 'ptoRequestTypeBtn ptoStartDateBtn ptoEndDateBtn ptoDays';
        _ptoClearValidation('ptoFormError', requestControls);
        if (!start || !end || end < start) {
            const invalid = [!start ? 'ptoStartDateBtn' : '', (!end || end < start) ? 'ptoEndDateBtn' : ''].filter(Boolean).join(' ');
            _ptoShowValidation('ptoFormError', 'Choose a valid start and end date.', invalid.split(' ')[0], invalid);
            return;
        }
        const asOf = String(_ptoState.overview && _ptoState.overview.as_of_date || _ptoTodayIso());
        if (type !== 'sick' && start <= asOf) { _ptoShowValidation('ptoFormError', 'Only sick leave can start today or in the past.', 'ptoStartDateBtn'); return; }
        const leaveYearEnd = type === 'unpaid' ? '' : _ptoLeaveYearEndFor(start, _ptoBalance(_ptoState.overview).pto_start_date);
        if (leaveYearEnd && end > leaveYearEnd) { _ptoShowValidation('ptoFormError', 'Paid requests cannot cross the Dec 31 leave-year boundary. Submit separate requests.', 'ptoEndDateBtn'); return; }
        const allowedDays = _ptoNumber(daysInput.max, NaN);
        const partialDayCount = _ptoNumber(daysInput.min, NaN);
        if (daysInput.disabled || !String(daysInput.value || '').trim() || !(days > 0) || !(allowedDays > 0)) { _ptoShowValidation('ptoFormError', 'Wait for SyncView to count at least one business day before sending.', 'ptoDays'); return; }
        if (type === 'floating_holiday' && (start !== end || allowedDays !== 1)) { _ptoShowValidation('ptoFormError', 'Choose one business date for a floating holiday.', 'ptoStartDateBtn', 'ptoStartDateBtn ptoEndDateBtn'); return; }
        if (!Number.isFinite(days) || Math.round(days * 2) !== days * 2 || (days !== allowedDays && days !== partialDayCount)) { _ptoShowValidation('ptoFormError', 'Use the full business-day count, or subtract 0.5 for one half-day endpoint.', 'ptoDays'); return; }
        button.disabled = true;
        button.textContent = 'Sending…';
        try {
            await _ptoApi('request', 'POST', { type, start_date: start, end_date: end, days, note });
            form.reset();
            _ptoShowToast('Time off request sent');
            _ptoInvalidateOverviewCaches();
            await _ptoLoadOverview(true);
        } catch (error) {
            errorBox.textContent = error && error.message ? error.message : 'Could not send this request.';
            if (_ptoUnknownWrite(error)) {
                _ptoState.writeOutcomeUnknown = true;
                button.disabled = true;
                button.textContent = 'Refresh to verify';
                return;
            }
            button.disabled = false;
            button.textContent = 'Send request';
            if (_ptoStateConflict(error)) await _ptoRefreshAfterConflict('staff', error.message);
        }
    }
    function _ptoCancelRequest(requestId, button) {
        if (_ptoBlockWrites('staff')) return;
        showConfirm('Cancel request', 'Cancel this pending time off request?', async () => {
            if (button) button.disabled = true;
            try {
                await _ptoApi('cancel', 'POST', { request_id: requestId });
                _ptoShowToast('Request cancelled');
                _ptoInvalidateOverviewCaches();
                await _ptoLoadOverview(true);
            } catch (error) {
                const message = error && error.message ? error.message : 'Could not cancel this request';
                if (_ptoUnknownWrite(error)) {
                    _ptoState.writeOutcomeUnknown = true;
                    _ptoShowToast(message);
                    return;
                }
                if (_ptoStateConflict(error)) {
                    await _ptoRefreshAfterConflict('staff', message);
                    return;
                }
                _ptoShowToast(message);
                if (button) button.disabled = false;
            }
        }, 'Cancel request');
    }
    function _ptoRenderCalendar(overview) {
        const month = _ptoState.month;
        const asOf = _ptoDate(overview && overview.as_of_date) || new Date();
        const minMonth = new Date(asOf.getFullYear(), asOf.getMonth() - 3, 1);
        const maxMonth = new Date(asOf.getFullYear(), asOf.getMonth() + 3, 1);
        const canPrev = month > minMonth;
        const canNext = month < maxMonth;
        const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(month);
        const start = new Date(month.getFullYear(), month.getMonth(), 1, 12);
        start.setDate(start.getDate() - start.getDay());
        const absences = Array.isArray(overview.absences) ? overview.absences : [];
        const holidays = Array.isArray(overview.holidays) ? overview.holidays : [];
        const today = String(overview && overview.as_of_date || _ptoTodayIso());
        const cells = [];
        for (let i = 0; i < 42; i += 1) {
            const date = new Date(start.getTime());
            date.setDate(start.getDate() + i);
            const iso = _ptoIso(date);
            const holidayRows = holidays.filter(row => _ptoHolidayDate(row) === iso);
            const away = absences.filter(row => String(row.start_date || '') <= iso && String(row.end_date || '') >= iso);
            const events = holidayRows.map(row => ({ holiday: true, label: row.name || row.label || 'Company holiday' }))
                .concat(away.map(row => ({ holiday: false, label: row.member_name || row.name || 'Team member' })));
            const visible = events.slice(0, 3).map(event => '<div class="pto-cal-event' + (event.holiday ? ' holiday' : '') + '" title="' + _ptoAttr(event.label) + '">' + _ptoEsc(event.label) + '</div>').join('');
            cells.push('<div class="pto-cal-day' + (date.getMonth() !== month.getMonth() ? ' outside' : '') + ((date.getDay() === 0 || date.getDay() === 6) ? ' weekend' : '') + (iso === today ? ' today' : '') + '"><span class="sr-only">' + _ptoEsc(_ptoFmtDate(iso)) + '</span><div class="pto-cal-num" aria-hidden="true">' + date.getDate() + '</div>' + visible + (events.length > 3 ? '<div class="pto-cal-more">+' + (events.length - 3) + ' more</div>' : '') + '</div>');
        }
        const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => '<div class="pto-cal-weekday" aria-hidden="true">' + day + '</div>').join('');
        return '<div class="pto-calendar-toolbar"><div><div class="pto-card-title">Team calendar</div><div class="pto-card-sub">Approved absences and observed paid holidays.</div></div><div class="pto-calendar-nav"><button type="button" onclick="_ptoShiftMonth(-1)" aria-label="Previous month"' + (canPrev ? '' : ' disabled') + '>‹</button><span class="pto-calendar-title">' + _ptoEsc(monthLabel) + '</span><button type="button" onclick="_ptoShiftMonth(1)" aria-label="Next month"' + (canNext ? '' : ' disabled') + '>›</button></div></div><div class="pto-calendar-scroll" tabindex="0" aria-label="Scrollable team time off calendar for ' + _ptoAttr(monthLabel) + '"><div class="pto-calendar" role="group" aria-label="Team time off for ' + _ptoAttr(monthLabel) + '">' + weekdays + cells.join('') + '</div></div>';
    }
    function _ptoShiftMonth(delta) {
        const asOf = _ptoDate(_ptoState.overview && _ptoState.overview.as_of_date) || new Date();
        const minMonth = new Date(asOf.getFullYear(), asOf.getMonth() - 3, 1);
        const maxMonth = new Date(asOf.getFullYear(), asOf.getMonth() + 3, 1);
        const next = new Date(_ptoState.month.getFullYear(), _ptoState.month.getMonth() + Number(delta || 0), 1);
        _ptoState.month = next < minMonth ? minMonth : (next > maxMonth ? maxMonth : next);
        const card = document.querySelector('#ptoRoot .pto-calendar-card');
        if (!card) { _ptoPaint(); return; }
        card.innerHTML = _ptoRenderCalendar(_ptoState.overview);
        const direction = Number(delta || 0) < 0 ? 'Previous month' : 'Next month';
        requestAnimationFrame(() => {
            const same = card.querySelector('.pto-calendar-nav button[aria-label="' + direction + '"]:not([disabled])');
            const fallback = card.querySelector('.pto-calendar-nav button:not([disabled])');
            (same || fallback)?.focus();
        });
    }

    function _ptoAdminMemberRows(overview) { return Array.isArray(overview && overview.admin_members) ? overview.admin_members : []; }
    function _ptoAdminPending(overview) { return Array.isArray(overview && overview.pending_requests) ? overview.pending_requests : (Array.isArray(overview && overview.pending) ? overview.pending : []); }
    function _ptoAdminUpcoming(overview) { return Array.isArray(overview && overview.upcoming_approved_requests) ? overview.upcoming_approved_requests : []; }
    function _ptoAdminRecent(overview) { return Array.isArray(overview && overview.recent_requests) ? overview.recent_requests : []; }
    async function _ptoLoadAdmin(force) {
        if (!_ptoEnabled() || !_syncviewStaffCan('pto-admin') || (_ptoAdminState.loading && !force)) return;
        if (_ptoAdminState.overview && !force) { _ptoRenderAdmin(); return; }
        const generation = _ptoNextAdminOverviewGeneration();
        _ptoAdminState.loading = true;
        _ptoAdminState.error = '';
        _ptoRenderAdmin();
        try {
            const overview = await _ptoApi('overview', 'GET');
            if (generation !== _ptoAdminOverviewGeneration) return;
            _ptoAdminState.overview = overview;
            _ptoAdminState.writeOutcomeUnknown = false;
            _kasperSetTabCount('time-off', _ptoAdminPending(_ptoAdminState.overview).length);
        } catch (error) {
            if (generation !== _ptoAdminOverviewGeneration) return;
            _ptoAdminState.error = error && error.message ? error.message : 'Could not load Time Off administration.';
        } finally {
            if (generation !== _ptoAdminOverviewGeneration) return;
            _ptoAdminState.loading = false;
            _ptoRenderAdmin();
        }
    }
    function _ptoAdminSignIn() {
        if (_syncviewStaffIdentityForHeaders()) { _syncviewOfferStaffSignIn('pto-admin'); return; }
        _syncviewOpenStaffIdentity({ reason: 'required' }).then(() => {
            _ptoRenderAdmin();
            if (_syncviewStaffCan('pto-admin')) _ptoLoadAdmin(true);
        });
    }
    function _ptoRenderAdmin() {
        const root = document.getElementById('kasperContent');
        if (!root || typeof _kasperState === 'undefined' || _kasperState.tab !== 'time-off') return;
        if (!_ptoEnabled()) { _kasperGotoTab('review'); return; }
        if (!_syncviewStaffCan('pto-admin')) {
            root.innerHTML = '<div class="pto-admin-card"><div class="pto-signin"><strong>Admin sign-in required</strong><span>Requests, hire dates, and adjustments are HR data. Sign in with an Admin role key to manage them.</span><button class="pto-refresh" type="button" onclick="_ptoAdminSignIn()">Sign in as Admin</button></div></div>';
            _kasperSetTabCount('time-off', '—');
            return;
        }
        if (_ptoAdminState.loading && !_ptoAdminState.overview) { root.innerHTML = _ptoLoadingHtml('Loading Time Off approvals'); return; }
        if (_ptoAdminState.error && !_ptoAdminState.overview) {
            root.innerHTML = '<div class="pto-admin-card"><div class="pto-signin"><strong>Could not load Time Off</strong><span>' + _ptoEsc(_ptoAdminState.error) + '</span><button class="pto-refresh" type="button" onclick="_ptoLoadAdmin(true)">Try again</button></div></div>';
            return;
        }
        const overview = _ptoAdminState.overview;
        if (!overview) { root.innerHTML = _ptoLoadingHtml('Preparing Time Off approvals'); _ptoLoadAdmin(false); return; }
        const pending = _ptoAdminPending(overview);
        const upcoming = _ptoAdminUpcoming(overview);
        const recent = _ptoAdminRecent(overview);
        const members = _ptoAdminMemberRows(overview);
        const writeLocked = _ptoAdminState.writeOutcomeUnknown;
        _kasperSetTabCount('time-off', pending.length);
        const queue = pending.length ? pending.map(row => '<article class="pto-request-card type-' + _svTone(row.type === 'floating_holiday' ? 'floating' : row.type) + '" data-pto-request-id="' + _ptoAttr(row.id) + '"><div class="pto-request-top"><div><div class="pto-request-name">' + _ptoEsc(row.member_name || row.name || 'Team member') + '</div><div class="pto-request-meta">' + _ptoTypePill(row.type) + '<span>' + _ptoEsc(_ptoFmtDate(row.start_date, { month: 'short', day: 'numeric' })) + ' – ' + _ptoEsc(_ptoFmtDate(row.end_date, { month: 'short', day: 'numeric', year: 'numeric' })) + ' · ' + _ptoFmtDays(row.days) + ' days</span></div></div>' + _ptoStatusHtml(row.status || 'pending') + '</div>' + (row.note ? '<div class="pto-request-note">' + _ptoEsc(row.note) + '</div>' : '') + '<div class="pto-decision"><input type="text" maxlength="1000" data-pto-decision-note placeholder="Decision note (optional)" aria-label="Decision note for ' + _ptoAttr(row.member_name || row.name || 'request') + '"><button class="approve" type="button"' + (writeLocked ? ' disabled' : '') + ' onclick="_ptoAdminDecide(' + _jsAttrArg(row.id) + ',\'approved\',this)">Approve</button><button class="deny" type="button"' + (writeLocked ? ' disabled' : '') + ' onclick="_ptoAdminDecide(' + _jsAttrArg(row.id) + ',\'denied\',this)">Deny</button></div></article>').join('') : '<div class="pto-empty">No pending requests.</div>';
        const upcomingRows = upcoming.length ? upcoming.map(row => '<div class="pto-upcoming-row"><div><strong>' + _ptoEsc(row.member_name || row.name || 'Team member') + '</strong><div class="pto-request-meta">' + _ptoTypePill(row.type) + '<span>' + _ptoEsc(_ptoFmtDate(row.start_date, { month: 'short', day: 'numeric' })) + ' – ' + _ptoEsc(_ptoFmtDate(row.end_date, { month: 'short', day: 'numeric', year: 'numeric' })) + ' · ' + _ptoFmtDays(row.days) + ' days</span></div></div><button class="pto-row-btn" type="button"' + (writeLocked ? ' disabled' : '') + ' onclick="_ptoAdminCancel(' + _jsAttrArg(row.id) + ',this)">Cancel leave</button></div>').join('') : '<div class="pto-empty">No upcoming approved leave.</div>';
        const recentRows = recent.length ? recent.map(row => {
            const wasCancelled = String(row.status) === 'cancelled';
            const decisionAttribution = wasCancelled && row.cancelled_by && row.decided_by
                ? '<span>' + _ptoEsc('Approved by ' + row.decided_by) + (row.decided_at ? ' · ' + _ptoEsc(_ptoFmtDateTime(row.decided_at)) : '') + '</span>'
                : '';
            const currentAttribution = wasCancelled
                ? (row.cancelled_by ? _ptoEsc('Cancelled by ' + row.cancelled_by) + (row.cancelled_at ? ' · ' + _ptoEsc(_ptoFmtDateTime(row.cancelled_at)) : '') : 'Cancellation attribution unavailable')
                : (row.decided_by ? _ptoEsc('Decided by ' + row.decided_by) + (row.decided_at ? ' · ' + _ptoEsc(_ptoFmtDateTime(row.decided_at)) : '') : 'Decision attribution unavailable');
            const decisionNote = String(row.decision_note || '').trim();
            return '<div class="pto-history-row"><div><strong>' + _ptoEsc(row.member_name || row.name || 'Team member') + '</strong><span>' + _ptoTypePill(row.type) + '</span></div><div><span>' + _ptoEsc(_ptoFmtDate(row.start_date, { month: 'short', day: 'numeric' })) + ' – ' + _ptoEsc(_ptoFmtDate(row.end_date, { month: 'short', day: 'numeric', year: 'numeric' })) + '</span><span>' + _ptoStatusHtml(row.status) + '</span></div>' + (decisionNote ? '<div class="pto-history-note"><strong>Decision note:</strong> ' + _ptoEsc(decisionNote) + '</div>' : '') + '<small>' + decisionAttribution + '<span>' + currentAttribution + '</span></small></div>';
        }).join('') : '<div class="pto-empty">No completed requests yet.</div>';
        const balanceRows = members.length ? members.map(member => '<tr><td><strong>' + _ptoEsc(member.name || 'Team member') + '</strong></td><td>' + _ptoEsc(_ptoFmtDate(member.pto_start_date)) + '</td><td>' + _ptoFmtDays(member.wellness_granted) + '</td><td>' + _ptoFmtDays(member.wellness_approved_used != null ? member.wellness_approved_used : member.wellness_used) + '</td><td>' + (_ptoNumber(member.wellness_adjustment) > 0 ? '+' : '') + _ptoFmtDays(member.wellness_adjustment) + '</td><td class="' + (_ptoNumber(member.wellness_available) < 0 ? 'pto-negative' : '') + '">' + _ptoFmtDays(member.wellness_available) + '</td><td class="' + (_ptoNumber(member.sick_available) < 0 ? 'pto-negative' : '') + '">' + _ptoFmtDays(member.sick_available) + '</td><td>' + (member.pto_enabled ? 'Enabled' : 'Off') + '</td></tr>').join('') : '';
        const memberNameCounts = members.reduce((counts, member) => {
            const key = String(member.name || 'Team member').trim().toLowerCase();
            counts[key] = (counts[key] || 0) + 1;
            return counts;
        }, {});
        const memberItems = members.map(member => {
            const base = member.name || 'Team member';
            const duplicate = memberNameCounts[String(base).trim().toLowerCase()] > 1;
            const context = [_syncviewStaffRoleLabel(member.role), member.team ? String(member.team).charAt(0).toUpperCase() + String(member.team).slice(1) : ''].filter(Boolean).join(' · ');
            return { value: String(member.member_id || ''), label: duplicate ? base + ' · ' + context : base };
        });
        const kindItems = [{ value: 'wellness', label: 'Wellness', tone: 'wellness' }, { value: 'sick', label: 'Sick', tone: 'sick' }];
        const asOf = String(overview.as_of_date || _ptoTodayIso());
        const writeUnknownHtml = writeLocked ? '<div class="pto-notice" role="status">SyncView could not confirm the last admin change. Select Refresh before making another update.</div>' : '';
        root.innerHTML = '<div class="pto-admin"><div class="pto-card-head"><div><div class="pto-card-title">Time Off</div><div class="pto-card-sub">Approve requests, review balances, and maintain contractor PTO setup.</div></div><button class="pto-refresh" type="button" onclick="_ptoLoadAdmin(true)">Refresh</button></div>' + writeUnknownHtml + '<div class="pto-admin-grid">'
            + '<section class="pto-admin-card full"><div class="pto-admin-title-row">' + _svExplainLabel('pending-requests', 'Pending requests', 'The server re-checks policy and available balance at the moment an approval is saved.', 'pto-admin-title') + '<span class="pto-status pending">' + pending.length + '</span></div><div class="pto-admin-sub">Review the request, then approve or deny it.</div><div class="pto-admin-queue">' + queue + '</div><div class="pto-admin-section-break"><div><div class="pto-admin-title">Upcoming approved leave</div><div class="pto-admin-sub">Future approvals can be cancelled here without erasing the original decision record.</div></div><span class="pto-status approved">' + upcoming.length + '</span></div><div class="pto-upcoming-list">' + upcomingRows + '</div><details class="pto-admin-history"><summary>Recent decisions and cancellations <span>' + recent.length + '</span></summary><div class="pto-history-list">' + recentRows + '</div></details></section>'
            + '<section class="pto-admin-card full pto-cal-admin" id="ptoAdminCalendarCard">' + _ptoRenderAdminCalendar(overview) + '</section>'
            + '<section class="pto-admin-card full"><div class="pto-admin-title-row">' + _svExplainLabel('member-balances', 'Member balances', 'Available equals granted minus approved leave, plus or minus adjustments. Credits are shown separately so usage stays understandable.', 'pto-admin-title') + '</div><div class="pto-admin-sub">Approved leave and corrections are separated; negative availability stays red.</div>' + (balanceRows ? '<div class="pto-table-scroll-cue">Swipe sideways to view all balance columns →</div><div class="pto-table-scroll" tabindex="0" aria-label="Member balances; scroll horizontally to view all columns"><table class="pto-table"><thead><tr><th>Member</th><th>Start date</th><th>Granted</th><th>Approved</th><th>Adjustments</th><th>Available</th><th>Sick left</th><th>PTO</th></tr></thead><tbody>' + balanceRows + '</tbody></table></div>' : '<div class="pto-empty">No PTO members have been configured.</div>') + '</section>'
            + '<section class="pto-admin-card"><div class="pto-admin-title-row">' + _svExplainLabel('member-setup', 'Member setup', 'The start date is private. Enabling PTO lets this person view balances and submit requests.', 'pto-admin-title') + '</div><div class="pto-admin-sub">Set a confirmed contractor\'s private PTO start date.</div><form class="pto-admin-form" onsubmit="_ptoAdminSetMember(event)" oninput="_ptoClearValidation(\'ptoAdminMemberError\', \'ptoAdminMemberBtn ptoAdminStartBtn\')" onchange="_ptoClearValidation(\'ptoAdminMemberError\', \'ptoAdminMemberBtn ptoAdminStartBtn\')"><div class="pto-field"><label for="ptoAdminMemberBtn">Team member</label>' + _svSelectHtml('ptoAdminMember', memberItems, '', 'Choose member', { onchange: '_ptoAdminPickMember(this.value)' }) + '</div><div class="pto-field"><label for="ptoAdminStartBtn">PTO start date</label>' + _svDateHtml('ptoAdminStart', '', { required: true, today: asOf, max: asOf }) + '</div><label class="pto-check"><input id="ptoAdminEnabled" type="checkbox"> ' + _svExplainLabel('pto-enabled', 'PTO enabled', 'Lets this person view balances and submit Time Off requests.') + '</label><button class="pto-submit" type="submit"' + (writeLocked ? ' disabled' : '') + '>Save member</button><div class="pto-form-error" id="ptoAdminMemberError" role="alert"></div></form></section>'
            + '<section class="pto-admin-card"><div class="pto-admin-title-row">' + _svExplainLabel('add-adjustment', 'Add adjustment', 'Corrections are auditable balance entries. Positive adds days; negative removes days.', 'pto-admin-title') + '</div><div class="pto-admin-sub">Add a signed correction in half-day steps.</div><form class="pto-admin-form" onsubmit="_ptoAdminAdjust(event)" oninput="_ptoClearValidation(\'ptoAdjustError\', \'ptoAdjustMemberBtn ptoAdjustKindBtn ptoAdjustDelta ptoAdjustDateBtn ptoAdjustReason\')" onchange="_ptoClearValidation(\'ptoAdjustError\', \'ptoAdjustMemberBtn ptoAdjustKindBtn ptoAdjustDelta ptoAdjustDateBtn ptoAdjustReason\')"><div class="pto-field"><label for="ptoAdjustMemberBtn">Team member</label>' + _svSelectHtml('ptoAdjustMember', memberItems, '', 'Choose member') + '</div><div class="pto-form"><div class="pto-field"><label for="ptoAdjustKindBtn">Balance</label>' + _svSelectHtml('ptoAdjustKind', kindItems, 'wellness', 'Choose balance') + '</div><div class="pto-field"><label for="ptoAdjustDelta">' + _svExplainLabel('adjustment-days', 'Days', 'Positive adds days; negative removes days. Zero is not allowed, and half-day steps are accepted.') + '</label>' + _svStepperHtml('ptoAdjustDelta', '', { step: 0.5, required: true, placeholder: '-1.0', downTip: 'Remove half a day', upTip: 'Add half a day' }) + '</div></div><div class="pto-field"><label for="ptoAdjustDateBtn">' + _svExplainLabel('adjustment-effective-date', 'Effective date', 'This date decides which calendar leave year receives the correction.') + '</label>' + _svDateHtml('ptoAdjustDate', asOf, { required: true, today: asOf }) + '</div><div class="pto-field"><label for="ptoAdjustReason">Reason</label><input id="ptoAdjustReason" type="text" maxlength="500" required placeholder="Migration or correction note"></div><button class="pto-submit" type="submit"' + (writeLocked ? ' disabled' : '') + '>Add adjustment</button><div class="pto-form-error" id="ptoAdjustError" role="alert"></div></form></section>'
            + '</div></div>';
    }
    function _ptoAdminPickMember(memberId) {
        const member = _ptoAdminMemberRows(_ptoAdminState.overview).find(row => String(row.member_id) === String(memberId));
        const date = document.getElementById('ptoAdminStart');
        const enabled = document.getElementById('ptoAdminEnabled');
        if (date) date.value = member && member.pto_start_date || '';
        if (enabled) enabled.checked = !!(member && member.pto_enabled);
        _svSyncDateControl('ptoAdminStart');
    }

    /* ── Kasper Time Off calendar ────────────────────────────────────────
       A visual month/person read of the whole team and its leave. The admin
       overview already carries every pending request, every future approved
       request, recent terminal history, and the minimized ±3-month approved
       absence projection, so these views are assembled from the existing
       payload: no new Edge Function contract, no extra request, no HR field
       the queue does not already show. */
    const PTO_CAL_VIEWS = [{ key: 'month', label: 'Month' }, { key: 'people', label: 'By person' }];
    const PTO_CAL_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const PTO_CAL_LEGEND = [
        { tone: 'wellness', label: 'Wellness' },
        { tone: 'sick', label: 'Sick' },
        { tone: 'floating', label: 'Floating' },
        { tone: 'unpaid', label: 'Unpaid' },
        { tone: 'pending', label: 'Pending' },
        { tone: 'holiday', label: 'Paid holiday' },
    ];

    function _ptoCalTone(event) {
        if (!event) return '';
        if (event.status === 'pending') return 'pending';
        return _svTone(event.type === 'floating_holiday' ? 'floating' : event.type);
    }
    // One de-duplicated event list. Typed requests win over the untyped absence
    // projection so the same leave can never be drawn twice, and approved leave
    // older than the recent slice still surfaces through absences.
    function _ptoCalEvents(overview) {
        const events = [];
        const seen = new Set();
        const addRequest = (row, status) => {
            const start = String(row && row.start_date || '');
            const end = String(row && row.end_date || '');
            if (!start || !end || end < start) return;
            const id = row && row.id != null ? String(row.id) : '';
            const name = String(row && (row.member_name || row.name) || 'Team member');
            const key = id || ['no-id', status, name.trim().toLowerCase(), start, end, String(row && row.type || '')].join('|');
            if (seen.has(key)) return;
            seen.add(key);
            events.push({
                id: id,
                member_id: row && row.member_id != null ? String(row.member_id) : '',
                name: name,
                type: String(row && row.type || ''),
                status: status,
                start: start,
                end: end,
                days: row && row.days != null ? _ptoNumber(row.days) : null,
                note: String(row && row.note || ''),
            });
        };
        _ptoAdminUpcoming(overview).forEach(row => addRequest(row, 'approved'));
        _ptoAdminRecent(overview).forEach(row => { if (String(row && row.status || '') === 'approved') addRequest(row, 'approved'); });
        _ptoAdminPending(overview).forEach(row => addRequest(row, 'pending'));
        const covered = new Set(events.filter(event => event.status === 'approved')
            .map(event => [event.name.trim().toLowerCase(), event.start, event.end].join('|')));
        (Array.isArray(overview && overview.absences) ? overview.absences : []).forEach(row => {
            const start = String(row && row.start_date || '');
            const end = String(row && row.end_date || '');
            if (!start || !end || end < start) return;
            const name = String(row && (row.member_name || row.name) || 'Team member');
            const key = [name.trim().toLowerCase(), start, end].join('|');
            if (covered.has(key)) return;
            covered.add(key);
            events.push({ id: '', member_id: '', name: name, type: '', status: 'approved', start: start, end: end, days: null, note: '' });
        });
        return events.sort((a, b) => (a.start === b.start ? a.name.localeCompare(b.name) : a.start.localeCompare(b.start)));
    }
    function _ptoCalOn(events, iso) {
        return (Array.isArray(events) ? events : []).filter(event => event.start <= iso && event.end >= iso);
    }
    function _ptoCalHolidaysOn(overview, iso) {
        return (Array.isArray(overview && overview.holidays) ? overview.holidays : [])
            .filter(row => _ptoHolidayDate(row) === iso);
    }
    // Backwards the projection is only guaranteed for three months, so the grid
    // stops there rather than implying a complete older history. Forwards it can
    // run past three months because pending and future-approved rows are whole.
    function _ptoCalBounds(overview, events) {
        const asOf = _ptoDate(overview && overview.as_of_date) || new Date();
        const min = new Date(asOf.getFullYear(), asOf.getMonth() - 3, 1);
        const max = new Date(asOf.getFullYear(), asOf.getMonth() + 3, 1);
        (Array.isArray(events) ? events : []).forEach(event => {
            const end = _ptoDate(event.end);
            if (!end) return;
            const month = new Date(end.getFullYear(), end.getMonth(), 1);
            if (month > max) max.setTime(month.getTime());
        });
        return { min: min, max: max };
    }
    function _ptoCalMonth(overview, events) {
        const bounds = _ptoCalBounds(overview, events);
        const asOf = _ptoDate(overview && overview.as_of_date) || new Date();
        if (!_ptoAdminState.monthInitialized || !(_ptoAdminState.month instanceof Date) || Number.isNaN(_ptoAdminState.month.getTime())) {
            _ptoAdminState.month = new Date(asOf.getFullYear(), asOf.getMonth(), 1);
            _ptoAdminState.monthInitialized = true;
        }
        if (_ptoAdminState.month < bounds.min) _ptoAdminState.month = new Date(bounds.min.getTime());
        if (_ptoAdminState.month > bounds.max) _ptoAdminState.month = new Date(bounds.max.getTime());
        return _ptoAdminState.month;
    }
    function _ptoCalRangeLabel(event) {
        // A leave that crosses New Year needs both years or it reads as one.
        const crossesYear = String(event.start).slice(0, 4) !== String(event.end).slice(0, 4);
        const start = _ptoFmtDate(event.start, crossesYear
            ? { month: 'short', day: 'numeric', year: 'numeric' }
            : { month: 'short', day: 'numeric' });
        const end = _ptoFmtDate(event.end, { month: 'short', day: 'numeric', year: 'numeric' });
        return event.start === event.end ? _ptoFmtDate(event.start) : start + ' – ' + end;
    }
    function _ptoCalTypePill(event) {
        if (event && event.type) return _ptoTypePill(event.type);
        // Approved leave that only reached us through the untyped absence
        // projection: say so plainly rather than borrowing the unpaid colour.
        return '<span class="pto-type-pill untyped"><span class="sv-option-dot untyped" aria-hidden="true"></span>Time off</span>';
    }
    function _ptoCalMemberLabels(overview) {
        const members = _ptoAdminMemberRows(overview);
        const counts = members.reduce((acc, member) => {
            const key = String(member.name || 'Team member').trim().toLowerCase();
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
        const byId = new Map();
        const byName = new Map();
        members.forEach(member => {
            const base = String(member.name || 'Team member');
            const key = base.trim().toLowerCase();
            const context = [_syncviewStaffRoleLabel(member.role), member.team ? String(member.team).charAt(0).toUpperCase() + String(member.team).slice(1) : ''].filter(Boolean).join(' · ');
            byId.set(String(member.member_id || ''), counts[key] > 1 && context ? base + ' · ' + context : base);
            byName.set(key, (byName.get(key) || 0) + 1);
        });
        return { byId: byId, byName: byName };
    }
    function _ptoCalDaySummary(overview, events, iso) {
        const parts = [];
        const holidays = _ptoCalHolidaysOn(overview, iso).map(row => String(row.name || row.label || 'Company holiday'));
        const dayEvents = _ptoCalOn(events, iso);
        const approved = dayEvents.filter(event => event.status === 'approved').length;
        const pending = dayEvents.filter(event => event.status === 'pending').length;
        if (holidays.length) parts.push(holidays.join(', '));
        if (approved) parts.push(approved + (approved === 1 ? ' person away' : ' people away'));
        if (pending) parts.push(pending + ' pending');
        if (!parts.length) parts.push('nobody away');
        return _ptoFmtDate(iso, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + ' — ' + parts.join(', ');
    }

    function _ptoCalMonthGridHtml(overview, events, month, todayIso) {
        const monthStartIso = _ptoIso(new Date(month.getFullYear(), month.getMonth(), 1, 12));
        const monthEndIso = _ptoIso(new Date(month.getFullYear(), month.getMonth() + 1, 0, 12));
        const selected = String(_ptoAdminState.selectedDay || '');
        let focusIso = String(_ptoAdminState.calFocusDay || '');
        if (!focusIso || focusIso < monthStartIso || focusIso > monthEndIso) {
            focusIso = (todayIso >= monthStartIso && todayIso <= monthEndIso) ? todayIso : monthStartIso;
        }
        _ptoAdminState.calFocusDay = focusIso;
        const start = new Date(month.getFullYear(), month.getMonth(), 1, 12);
        start.setDate(start.getDate() - start.getDay());
        const cells = [];
        for (let i = 0; i < 42; i += 1) {
            const date = new Date(start.getTime());
            date.setDate(start.getDate() + i);
            const iso = _ptoIso(date);
            const outside = date.getMonth() !== month.getMonth();
            const classes = ['pto-cal-day'];
            if (outside) classes.push('outside');
            if (date.getDay() === 0 || date.getDay() === 6) classes.push('weekend');
            if (iso === todayIso) classes.push('today');
            const chips = _ptoCalHolidaysOn(overview, iso)
                .map(row => ({ tone: 'holiday', label: String(row.name || row.label || 'Company holiday'), hint: 'Observed paid holiday' }))
                .concat(_ptoCalOn(events, iso).map(event => ({
                    tone: _ptoCalTone(event),
                    label: event.name,
                    hint: (event.status === 'pending' ? 'Pending · ' : '') + _ptoTypeLabel(event.type || '') + ' · ' + _ptoCalRangeLabel(event),
                })));
            // The sr-only summary on the button already names everyone on this
            // day, so the visible chips stay out of its accessible name.
            const visible = chips.slice(0, 3).map(chip => '<span class="pto-cal-event' + (chip.tone ? ' ' + chip.tone : '') + '" aria-hidden="true" title="' + _ptoAttr(chip.label + ' — ' + chip.hint) + '">' + _ptoEsc(chip.label) + '</span>').join('');
            const more = chips.length > 3 ? '<span class="pto-cal-more" aria-hidden="true">+' + (chips.length - 3) + ' more</span>' : '';
            const body = '<span class="pto-cal-num" aria-hidden="true">' + date.getDate() + '</span>' + visible + more;
            if (outside) {
                cells.push('<div class="' + classes.join(' ') + '" aria-hidden="true">' + body + '</div>');
                continue;
            }
            if (iso === selected) classes.push('selected');
            cells.push('<button type="button" class="' + classes.join(' ') + '" data-pto-cal-day="' + _ptoAttr(iso) + '"'
                + ' tabindex="' + (iso === focusIso ? '0' : '-1') + '" aria-pressed="' + (iso === selected ? 'true' : 'false') + '"'
                + (iso === todayIso ? ' aria-current="date"' : '')
                + ' onclick="_ptoCalPickDay(' + _jsAttrArg(iso) + ')">'
                + '<span class="sr-only">' + _ptoEsc(_ptoCalDaySummary(overview, events, iso)) + '</span>' + body + '</button>');
        }
        const weekdays = PTO_CAL_WEEKDAYS.map(day => '<div class="pto-cal-weekday" aria-hidden="true">' + day + '</div>').join('');
        const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(month);
        return '<div class="pto-calendar-scroll" tabindex="0" aria-label="Scrollable team time off calendar for ' + _ptoAttr(monthLabel) + '"><div class="pto-calendar" role="group" aria-label="Team time off for ' + _ptoAttr(monthLabel) + '"'
            + ' onkeydown="_ptoCalGridKeydown(event)">' + weekdays + cells.join('') + '</div></div>';
    }

    function _ptoCalPeopleGridHtml(overview, events, month, todayIso) {
        const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(month);
        const dayCount = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
        const days = [];
        for (let day = 1; day <= dayCount; day += 1) {
            const date = new Date(month.getFullYear(), month.getMonth(), day, 12);
            const iso = _ptoIso(date);
            days.push({ iso: iso, day: day, weekend: date.getDay() === 0 || date.getDay() === 6, holiday: _ptoCalHolidaysOn(overview, iso).length > 0 });
        }
        const firstIso = days.length ? days[0].iso : '';
        const lastIso = days.length ? days[days.length - 1].iso : '';
        const visible = events.filter(event => event.start <= lastIso && event.end >= firstIso);
        // One row per PERSON, not per display name: this roster can hold two
        // members with the same name, and merging them would show one of them
        // away on days they are working.
        const labels = _ptoCalMemberLabels(overview);
        const rowsByKey = new Map();
        _ptoAdminMemberRows(overview).filter(member => member.pto_enabled).forEach(member => {
            const key = 'id:' + String(member.member_id || '');
            if (!rowsByKey.has(key)) rowsByKey.set(key, { label: labels.byId.get(String(member.member_id || '')) || String(member.name || 'Team member'), events: [] });
        });
        visible.forEach(event => {
            const idKey = event.member_id ? 'id:' + event.member_id : '';
            const nameKey = String(event.name || '').trim().toLowerCase();
            // An untyped absence carries no id. Attach it by name only when that
            // name identifies exactly one member; otherwise give it its own row
            // rather than crediting it to the wrong person.
            const key = idKey && rowsByKey.has(idKey) ? idKey
                : (idKey || (labels.byName.get(nameKey) === 1 ? 'name:' + nameKey : 'unnamed:' + nameKey));
            let row = rowsByKey.get(key);
            if (!row) {
                const byNameRow = !idKey && labels.byName.get(nameKey) === 1
                    ? Array.from(rowsByKey.values()).find(candidate => String(candidate.label).split(' · ')[0].trim().toLowerCase() === nameKey)
                    : null;
                row = byNameRow || { label: String(event.name || 'Team member'), events: [] };
                if (!byNameRow) rowsByKey.set(key, row);
            }
            row.events.push(event);
        });
        const rowList = Array.from(rowsByKey.values()).sort((a, b) => a.label.localeCompare(b.label));
        if (!rowList.length) return '<div class="pto-empty">No PTO members have been configured yet, so there is nobody to plot.</div>';
        const columns = 'grid-template-columns: 152px repeat(' + days.length + ', minmax(22px, 1fr));';
        const header = '<div class="pto-people-name pto-people-head" aria-hidden="true" style="grid-column: 1; grid-row: 1;">Team member</div>'
            + days.map((day, index) => '<div class="pto-people-daynum' + (day.weekend || day.holiday ? ' weekend' : '') + (day.iso === todayIso ? ' today' : '') + '" aria-hidden="true" style="grid-column: ' + (index + 2) + '; grid-row: 1;">' + day.day + '</div>').join('');
        const rows = rowList.map((entry, rowIndex) => {
            const gridRow = rowIndex + 2;
            const name = entry.label;
            const mine = entry.events;
            const cells = days.map((day, index) => {
                const classes = ['pto-people-cell'];
                if (day.weekend || day.holiday) classes.push('weekend');
                if (day.iso === todayIso) classes.push('today');
                return '<div class="' + classes.join(' ') + '" aria-hidden="true" style="grid-column: ' + (index + 2) + '; grid-row: ' + gridRow + ';"></div>';
            }).join('');
            // Each leave is ONE bar, not a run of squares: it reads as a single
            // stretch of time, and it gives the mouse-only tooltip a keyboard
            // and touch equivalent that opens the same day panel.
            const bars = mine.map(event => {
                const startIso = event.start > firstIso ? event.start : firstIso;
                const endIso = event.end < lastIso ? event.end : lastIso;
                const startIndex = days.findIndex(day => day.iso === startIso);
                const endIndex = days.findIndex(day => day.iso === endIso);
                if (startIndex < 0 || endIndex < startIndex) return '';
                const tone = _ptoCalTone(event);
                const label = name + ' — ' + (event.status === 'pending' ? 'Pending, ' : '') + _ptoTypeLabel(event.type || '')
                    + ', ' + _ptoCalRangeLabel(event) + (event.days != null ? ', ' + _ptoFmtDays(event.days) + ' days' : '');
                return '<button type="button" class="pto-people-bar' + (tone ? ' ' + tone : '') + '" data-pto-cal-bar="' + _ptoAttr(startIso) + '"'
                    + ' style="grid-column: ' + (startIndex + 2) + ' / span ' + ((endIndex - startIndex) + 1) + '; grid-row: ' + gridRow + ';"'
                    + ' title="' + _ptoAttr(label) + '" aria-label="' + _ptoAttr(label) + '" onclick="_ptoCalPickDay(' + _jsAttrArg(startIso) + ')"></button>';
            }).join('');
            const spoken = mine.length ? name : name + ': no time off in ' + monthLabel;
            return '<div class="pto-people-name" style="grid-column: 1; grid-row: ' + gridRow + ';"><span class="sr-only">' + _ptoEsc(spoken) + '</span><span aria-hidden="true">' + _ptoEsc(name) + '</span></div>' + cells + bars;
        }).join('');
        return '<div class="pto-calendar-scroll" tabindex="0" aria-label="Scrollable by-person time off calendar for ' + _ptoAttr(monthLabel) + '"><div class="pto-people-grid" role="group" aria-label="Time off by person for ' + _ptoAttr(monthLabel) + '" style="' + columns + '">' + header + rows + '</div></div>';
    }
    function _ptoCalDetailHtml(overview, events, todayIso) {
        const iso = String(_ptoAdminState.selectedDay || '');
        if (!iso) return '';
        const holidays = _ptoCalHolidaysOn(overview, iso);
        const rows = _ptoCalOn(events, iso).slice().sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : (a.status === 'approved' ? -1 : 1)));
        const writeLocked = _ptoAdminState.writeOutcomeUnknown;
        const holidayHtml = holidays.map(row => '<div class="pto-cal-detail-row holiday"><div class="pto-cal-detail-top"><strong>' + _ptoEsc(String(row.name || 'Company holiday')) + '</strong><span class="pto-type-pill floating"><span class="sv-option-dot floating" aria-hidden="true"></span>Paid holiday</span></div><div class="pto-request-meta"><span>Observed company-wide. No request is needed.</span></div></div>').join('');
        const labels = _ptoCalMemberLabels(overview);
        const rowHtml = rows.map(event => {
            const label = (event.member_id && labels.byId.get(event.member_id)) || event.name;
            const canCancel = event.status === 'approved' && !!event.id && event.start > todayIso;
            const action = event.status === 'pending' && event.id
                ? '<button class="pto-row-btn" type="button" onclick="_ptoCalReviewRequest(' + _jsAttrArg(event.id) + ')">Review request</button>'
                : (canCancel ? '<button class="pto-row-btn" type="button"' + (writeLocked ? ' disabled' : '') + ' onclick="_ptoAdminCancel(' + _jsAttrArg(event.id) + ',this)">Cancel leave</button>' : '');
            return '<div class="pto-cal-detail-row"><div class="pto-cal-detail-top"><strong>' + _ptoEsc(label) + '</strong>' + _ptoCalTypePill(event) + _ptoStatusHtml(event.status) + '</div>'
                + '<div class="pto-request-meta"><span>' + _ptoEsc(_ptoCalRangeLabel(event)) + (event.days != null ? ' · ' + _ptoFmtDays(event.days) + ' days' : '') + '</span></div>'
                + (event.note ? '<div class="pto-request-note">' + _ptoEsc(event.note) + '</div>' : '')
                + (action ? '<div class="pto-cal-detail-actions">' + action + '</div>' : '') + '</div>';
        }).join('');
        const body = (holidayHtml + rowHtml) || '<div class="pto-empty">Nobody is away on this date.</div>';
        return '<div class="pto-cal-detail" role="region" tabindex="-1" onkeydown="_ptoCalDetailKeydown(event)" aria-label="Time off on ' + _ptoAttr(_ptoFmtDate(iso)) + '">'
            + '<div class="pto-cal-detail-head"><div class="pto-admin-title">' + _ptoEsc(_ptoFmtDate(iso, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })) + '</div>'
            + '<button class="pto-row-btn" type="button" onclick="_ptoCalClearDay()">Close</button></div>' + body + '</div>';
    }

    function _ptoRenderAdminCalendar(overview) {
        const events = _ptoCalEvents(overview);
        const bounds = _ptoCalBounds(overview, events);
        const month = _ptoCalMonth(overview, events);
        const todayIso = String(overview && overview.as_of_date || _ptoTodayIso());
        const view = _ptoAdminState.calView === 'people' ? 'people' : 'month';
        const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(month);
        const monthStartIso = _ptoIso(new Date(month.getFullYear(), month.getMonth(), 1, 12));
        const monthEndIso = _ptoIso(new Date(month.getFullYear(), month.getMonth() + 1, 0, 12));
        const inMonth = events.filter(event => event.start <= monthEndIso && event.end >= monthStartIso);
        // A bounds clamp or a fresh overview can move the visible month under a
        // stored selection; a panel describing an off-grid date is worse than none.
        if (_ptoAdminState.selectedDay && (_ptoAdminState.selectedDay < monthStartIso || _ptoAdminState.selectedDay > monthEndIso)) _ptoAdminState.selectedDay = '';
        // "Away today" follows the server rule: nobody is counted away on a day
        // nobody works, so weekends and observed holidays report zero.
        const todayDay = (_ptoDate(todayIso) || new Date()).getDay();
        const todayIsBusiness = todayDay !== 0 && todayDay !== 6 && !_ptoCalHolidaysOn(overview, todayIso).length;
        const awayToday = new Set(todayIsBusiness
            ? _ptoCalOn(events, todayIso).filter(event => event.status === 'approved').map(event => event.member_id || event.name)
            : []);
        const outThisMonth = new Set(inMonth.filter(event => event.status === 'approved').map(event => event.member_id || event.name));
        const pendingThisMonth = inMonth.filter(event => event.status === 'pending').length;
        const canPrev = month > bounds.min;
        const canNext = month < bounds.max;
        const legend = PTO_CAL_LEGEND.concat(inMonth.some(event => event.status === 'approved' && !event.type) ? [{ tone: '', label: 'Time off' }] : [])
            .map(item => '<span class="pto-cal-legend-item"><span class="pto-cal-swatch' + (item.tone ? ' ' + item.tone : '') + '" aria-hidden="true"></span>' + _ptoEsc(item.label) + '</span>').join('');
        const views = PTO_CAL_VIEWS.map(item => '<button type="button" class="pto-cal-view" data-pto-cal-view="' + item.key + '" aria-pressed="' + (view === item.key ? 'true' : 'false') + '" onclick="_ptoCalSetView(' + _jsAttrArg(item.key) + ')">' + item.label + '</button>').join('');
        const stats = [
            { value: awayToday.size, label: 'Away today' },
            { value: outThisMonth.size, label: 'Off this month' },
            { value: pendingThisMonth, label: 'Pending this month' },
        ].map(stat => '<div class="pto-cal-stat"><strong>' + stat.value + '</strong><span>' + stat.label + '</span></div>').join('');
        const grid = view === 'people'
            ? _ptoCalPeopleGridHtml(overview, events, month, todayIso)
            : _ptoCalMonthGridHtml(overview, events, month, todayIso);
        const emptyNote = inMonth.length ? '' : '<div class="pto-cal-note">Nobody has approved or pending leave in ' + _ptoEsc(monthLabel) + '.</div>';
        return '<div class="pto-cal-head"><div><div class="pto-admin-title-row">'
            + _svExplainLabel('team-calendar', 'Team calendar', 'Approved and pending leave for everyone, plus observed paid holidays. Select a day to see who is away and act on the requests it holds.', 'pto-admin-title')
            + '</div><div class="pto-admin-sub">Approved and pending leave across the team, with observed paid holidays.</div></div>'
            + '<div class="pto-cal-controls"><div class="pto-cal-views" role="group" aria-label="Calendar view">' + views + '</div>'
            + '<div class="pto-calendar-nav"><button type="button" onclick="_ptoCalShiftMonth(-1)" aria-label="Previous month"' + (canPrev ? '' : ' disabled') + '>&lsaquo;</button>'
            + '<span class="pto-calendar-title">' + _ptoEsc(monthLabel) + '</span>'
            + '<button type="button" onclick="_ptoCalShiftMonth(1)" aria-label="Next month"' + (canNext ? '' : ' disabled') + '>&rsaquo;</button>'
            + '<button type="button" class="pto-cal-today" onclick="_ptoCalGoToday()">Today</button></div></div></div>'
            + '<div class="pto-cal-stats">' + stats + '</div>'
            + '<div class="pto-cal-legend">' + legend + '</div>'
            + emptyNote
            + '<div class="pto-cal-scroll-cue">Swipe sideways to view the whole month &rarr;</div>'
            + grid
            + _ptoCalDetailHtml(overview, events, todayIso);
    }

    // Only the calendar card is repainted so a half-filled member setup or
    // adjustment form is never wiped by browsing the calendar.
    function _ptoCalRepaint(focusSelectors) {
        const card = document.getElementById('ptoAdminCalendarCard');
        if (!card || !_ptoAdminState.overview) { _ptoRenderAdmin(); return; }
        card.innerHTML = _ptoRenderAdminCalendar(_ptoAdminState.overview);
        const selectors = Array.isArray(focusSelectors) ? focusSelectors : (focusSelectors ? [focusSelectors] : []);
        if (!selectors.length) return;
        requestAnimationFrame(() => {
            // Re-read the card: a full _ptoRenderAdmin between paint and frame
            // detaches the node captured above, and focusing a detached button
            // silently does nothing.
            const live = document.getElementById('ptoAdminCalendarCard');
            if (!live) return;
            for (const selector of selectors) {
                const target = live.querySelector(selector);
                if (target) { target.focus({ preventScroll: true }); return; }
            }
        });
    }
    function _ptoCalShiftMonth(delta) {
        const overview = _ptoAdminState.overview;
        if (!overview) return;
        const events = _ptoCalEvents(overview);
        const bounds = _ptoCalBounds(overview, events);
        const current = _ptoCalMonth(overview, events);
        const next = new Date(current.getFullYear(), current.getMonth() + Number(delta || 0), 1);
        _ptoAdminState.month = next < bounds.min ? new Date(bounds.min.getTime()) : (next > bounds.max ? new Date(bounds.max.getTime()) : next);
        _ptoAdminState.selectedDay = '';
        _ptoAdminState.calFocusDay = '';
        const direction = Number(delta || 0) < 0 ? 'Previous month' : 'Next month';
        _ptoCalRepaint(['.pto-calendar-nav button[aria-label="' + direction + '"]:not([disabled])', '.pto-calendar-nav button:not([disabled])']);
    }
    function _ptoCalGoToday() {
        const overview = _ptoAdminState.overview;
        if (!overview) return;
        const asOf = _ptoDate(overview.as_of_date) || new Date();
        const events = _ptoCalEvents(overview);
        const bounds = _ptoCalBounds(overview, events);
        const target = new Date(asOf.getFullYear(), asOf.getMonth(), 1);
        _ptoAdminState.month = target < bounds.min ? new Date(bounds.min.getTime()) : (target > bounds.max ? new Date(bounds.max.getTime()) : target);
        _ptoAdminState.selectedDay = String(overview.as_of_date || _ptoTodayIso());
        _ptoAdminState.calFocusDay = _ptoAdminState.selectedDay;
        _ptoCalRepaint(['.pto-cal-today']);
    }
    function _ptoCalSetView(view) {
        _ptoAdminState.calView = view === 'people' ? 'people' : 'month';
        _ptoCalRepaint(['.pto-cal-view[aria-pressed="true"]']);
    }
    function _ptoCalPickDay(iso) {
        const value = String(iso || '');
        if (!value) return;
        _ptoAdminState.selectedDay = _ptoAdminState.selectedDay === value ? '' : value;
        _ptoAdminState.calFocusDay = value;
        _ptoCalRepaint(['[data-pto-cal-day="' + value + '"]', '[data-pto-cal-bar="' + value + '"]', '[data-pto-cal-day]', '.pto-cal-today']);
    }
    function _ptoCalClearDay(returnToIso) {
        const previous = String(returnToIso || _ptoAdminState.selectedDay || '');
        _ptoAdminState.selectedDay = '';
        if (previous) _ptoAdminState.calFocusDay = previous;
        _ptoCalRepaint(previous
            ? ['[data-pto-cal-day="' + previous + '"]', '[data-pto-cal-bar="' + previous + '"]', '.pto-cal-today']
            : ['.pto-cal-today']);
    }
    function _ptoCalDetailKeydown(event) {
        if (!event || event.key !== 'Escape' || !_ptoAdminState.selectedDay) return;
        event.preventDefault();
        _ptoCalClearDay();
    }
    // Roving tabindex: the month grid is one tab stop and the arrow, Home/End,
    // and Page Up/Down keys walk dates the way the shared date picker does.
    function _ptoCalFocusDate(iso) {
        const overview = _ptoAdminState.overview;
        const date = _ptoDate(iso);
        if (!overview || !date) return;
        const bounds = _ptoCalBounds(overview, _ptoCalEvents(overview));
        const target = new Date(date.getFullYear(), date.getMonth(), 1);
        if (target < bounds.min || target > bounds.max) return;
        _ptoAdminState.calFocusDay = String(iso);
        const month = _ptoAdminState.month;
        if (!(month instanceof Date) || month.getFullYear() !== target.getFullYear() || month.getMonth() !== target.getMonth()) {
            _ptoAdminState.month = target;
            // Leaving the month drops the selection with it: a day panel that
            // describes a date the grid no longer shows is worse than none.
            _ptoAdminState.selectedDay = '';
            _ptoCalRepaint(['[data-pto-cal-day="' + _ptoAdminState.calFocusDay + '"]', '.pto-cal-today']);
            return;
        }
        const card = document.getElementById('ptoAdminCalendarCard');
        if (!card) return;
        card.querySelectorAll('[data-pto-cal-day]').forEach(cell => { cell.tabIndex = cell.getAttribute('data-pto-cal-day') === String(iso) ? 0 : -1; });
        const next = card.querySelector('[data-pto-cal-day="' + String(iso) + '"]');
        if (next) next.focus({ preventScroll: true });
    }
    function _ptoCalGridKeydown(event) {
        const key = event && event.key;
        if (key === 'Escape') {
            if (!_ptoAdminState.selectedDay) return;
            event.preventDefault();
            // Close the panel without moving the caret: Escape should never
            // relocate focus to whichever day happened to be selected.
            const here = event.target && event.target.closest ? event.target.closest('[data-pto-cal-day]') : null;
            _ptoCalClearDay(here ? here.getAttribute('data-pto-cal-day') : '');
            return;
        }
        // Walk from the day that actually holds focus, not just the roving
        // bookmark: a mouse click or a scripted focus must not teleport the
        // caret back to wherever the tab stop happened to be parked.
        const focused = event.target && event.target.closest ? event.target.closest("[data-pto-cal-day]") : null;
        const current = _ptoDate(focused ? focused.getAttribute("data-pto-cal-day") : _ptoAdminState.calFocusDay);
        if (!current) return;
        const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
        let target = null;
        if (steps[key] != null) {
            target = new Date(current.getTime());
            target.setDate(target.getDate() + steps[key]);
        } else if (key === 'Home') {
            target = new Date(current.getFullYear(), current.getMonth(), 1, 12);
        } else if (key === 'End') {
            target = new Date(current.getFullYear(), current.getMonth() + 1, 0, 12);
        } else if (key === 'PageUp' || key === 'PageDown') {
            const shift = key === 'PageUp' ? -1 : 1;
            const lastDay = new Date(current.getFullYear(), current.getMonth() + shift + 1, 0).getDate();
            target = new Date(current.getFullYear(), current.getMonth() + shift, Math.min(current.getDate(), lastDay), 12);
        }
        if (!target) return;
        event.preventDefault();
        _ptoCalFocusDate(_ptoIso(target));
    }
    function _ptoCalResetView() {
        _ptoAdminState.month = null;
        _ptoAdminState.monthInitialized = false;
        _ptoAdminState.calView = 'month';
        _ptoAdminState.selectedDay = '';
        _ptoAdminState.calFocusDay = '';
    }
    function _ptoCalReviewRequest(requestId) {
        const wanted = String(requestId == null ? '' : requestId);
        const cards = Array.from(document.querySelectorAll('[data-pto-request-id]'));
        const card = cards.find(node => node.getAttribute('data-pto-request-id') === wanted);
        if (!card) { _ptoShowToast('That request is no longer in the pending queue. Refresh Time Off to reload it.'); return; }
        const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        card.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
        card.classList.add('is-flagged');
        setTimeout(() => card.classList.remove('is-flagged'), 2400);
        // Land on the decision note, never on Approve: an approval is not
        // reversible and must not be one stray keypress away.
        const target = card.querySelector('input[data-pto-decision-note]') || card.querySelector('button.approve:not([disabled])');
        if (target) target.focus({ preventScroll: true });
    }
    async function _ptoAdminDecide(requestId, decision, button) {
        if (_ptoBlockWrites('admin')) return;
        const card = button && button.closest('.pto-request-card');
        const note = card && card.querySelector('[data-pto-decision-note]');
        if (card) card.querySelectorAll('button, input').forEach(element => { element.disabled = true; });
        try {
            await _ptoApi('decide', 'POST', { request_id: requestId, decision, decision_note: note ? note.value.trim() : '' });
            _ptoShowToast(decision === 'approved' ? 'Request approved' : 'Request denied');
            _ptoInvalidateOverviewCaches();
            await _ptoLoadAdmin(true);
        } catch (error) {
            const message = error && error.message ? error.message : 'Could not decide this request';
            if (error && error.code === 'member_inactive' && decision === 'approved' && card) {
                _ptoShowToast(message);
                const approve = card.querySelector('button.approve');
                const deny = card.querySelector('button.deny');
                if (approve) {
                    approve.disabled = true;
                    approve.title = 'Inactive staff profiles cannot be approved';
                }
                if (note) note.disabled = false;
                if (deny) deny.disabled = false;
                let notice = card.querySelector('[data-pto-inactive-note]');
                if (!notice) {
                    notice = document.createElement('div');
                    notice.className = 'pto-notice';
                    notice.dataset.ptoInactiveNote = 'true';
                    notice.setAttribute('role', 'status');
                    card.insertBefore(notice, card.querySelector('.pto-decision'));
                }
                notice.textContent = 'This profile is inactive. Approval is unavailable; deny the request to close it.';
                return;
            }
            if (_ptoUnknownWrite(error)) {
                _ptoAdminState.writeOutcomeUnknown = true;
                _ptoShowToast(message);
                return;
            }
            if (_ptoStateConflict(error)) {
                await _ptoRefreshAfterConflict('admin', message);
                return;
            }
            _ptoShowToast(message);
            if (card) card.querySelectorAll('button, input').forEach(element => { element.disabled = false; });
        }
    }
    function _ptoAdminCancel(requestId, button) {
        if (_ptoBlockWrites('admin')) return;
        showConfirm('Cancel approved leave', 'Remove this future approved leave from the team calendar? The original approval record will be preserved.', async () => {
            if (button) button.disabled = true;
            try {
                await _ptoApi('cancel', 'POST', { request_id: requestId });
                _ptoShowToast('Approved leave cancelled');
                _ptoInvalidateOverviewCaches();
                await _ptoLoadAdmin(true);
            } catch (error) {
                const message = error && error.message ? error.message : 'Could not cancel this leave';
                if (_ptoUnknownWrite(error)) {
                    _ptoAdminState.writeOutcomeUnknown = true;
                    _ptoShowToast(message);
                    return;
                }
                if (_ptoStateConflict(error)) {
                    await _ptoRefreshAfterConflict('admin', message);
                    return;
                }
                _ptoShowToast(message);
                if (button) button.disabled = false;
            }
        }, 'Cancel leave');
    }
    async function _ptoAdminSetMember(event) {
        event.preventDefault();
        if (_ptoBlockWrites('admin')) return;
        const errorBox = document.getElementById('ptoAdminMemberError');
        const button = event.currentTarget.querySelector('button[type="submit"]');
        const payload = { member_id: document.getElementById('ptoAdminMember').value, pto_start_date: document.getElementById('ptoAdminStart').value, pto_enabled: document.getElementById('ptoAdminEnabled').checked };
        _ptoClearValidation('ptoAdminMemberError', 'ptoAdminMemberBtn ptoAdminStartBtn');
        if (!payload.member_id) { _ptoShowValidation('ptoAdminMemberError', 'Choose a team member.', 'ptoAdminMemberBtn'); return; }
        if (!_ptoDate(payload.pto_start_date)) { _ptoShowValidation('ptoAdminMemberError', 'Choose a valid PTO start date.', 'ptoAdminStartBtn'); return; }
        button.disabled = true;
        try {
            await _ptoApi('set_start_date', 'POST', payload);
            _ptoShowToast('PTO member saved');
            _ptoInvalidateOverviewCaches();
            await _ptoLoadAdmin(true);
        } catch (error) {
            errorBox.textContent = error && error.message ? error.message : 'Could not save this member.';
            if (_ptoUnknownWrite(error)) {
                _ptoAdminState.writeOutcomeUnknown = true;
                return;
            }
            if (_ptoStateConflict(error)) {
                await _ptoRefreshAfterConflict('admin', error.message);
                return;
            }
            button.disabled = false;
        }
    }
    async function _ptoAdminAdjust(event) {
        event.preventDefault();
        if (_ptoBlockWrites('admin')) return;
        const errorBox = document.getElementById('ptoAdjustError');
        const button = event.currentTarget.querySelector('button[type="submit"]');
        const memberId = document.getElementById('ptoAdjustMember').value;
        const delta = _ptoNumber(document.getElementById('ptoAdjustDelta').value, NaN);
        _ptoClearValidation('ptoAdjustError', 'ptoAdjustMemberBtn ptoAdjustKindBtn ptoAdjustDelta ptoAdjustDateBtn ptoAdjustReason');
        if (!memberId) { _ptoShowValidation('ptoAdjustError', 'Choose a team member.', 'ptoAdjustMemberBtn'); return; }
        if (!Number.isFinite(delta) || delta === 0 || Math.round(delta * 2) !== delta * 2) { _ptoShowValidation('ptoAdjustError', 'Use a non-zero amount in half-day steps.', 'ptoAdjustDelta'); return; }
        const payload = { member_id: memberId, kind: document.getElementById('ptoAdjustKind').value, delta, effective_date: document.getElementById('ptoAdjustDate').value, reason: document.getElementById('ptoAdjustReason').value.trim() };
        if (!['wellness', 'sick'].includes(payload.kind)) { _ptoShowValidation('ptoAdjustError', 'Choose the balance to adjust.', 'ptoAdjustKindBtn'); return; }
        if (!_ptoDate(payload.effective_date)) { _ptoShowValidation('ptoAdjustError', 'Choose a valid effective date.', 'ptoAdjustDateBtn'); return; }
        if (!payload.reason) { _ptoShowValidation('ptoAdjustError', 'Add a reason for this adjustment.', 'ptoAdjustReason'); return; }
        button.disabled = true;
        try {
            await _ptoApi('adjust', 'POST', payload);
            _ptoShowToast('Balance adjustment added');
            _ptoInvalidateOverviewCaches();
            await _ptoLoadAdmin(true);
        } catch (error) {
            errorBox.textContent = error && error.message ? error.message : 'Could not add this adjustment.';
            if (_ptoUnknownWrite(error)) {
                _ptoAdminState.writeOutcomeUnknown = true;
                return;
            }
            if (_ptoStateConflict(error)) {
                await _ptoRefreshAfterConflict('admin', error.message);
                return;
            }
            button.disabled = false;
        }
    }


;(self.__svParts || (self.__svParts = [])).push("js/sv-09-core-d45dff813843.js");
