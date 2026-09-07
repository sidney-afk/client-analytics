'use strict';

// A transport store, deliberately without approval-routing/status-machine logic.
// Only fields actually sent by the document change. CAS, idempotency and archive
// fences below are declared browser assumptions, NOT evidence of deployed RPCs.
const clone = value => JSON.parse(JSON.stringify(value));
const CLIENTS = [
  { slug: 'lifecyclealpha', display_name: 'Lifecycle Alpha', active: true, kind: 'client', linear_project_ids: [{ id: 'fixture-project-alpha' }] },
  { slug: 'lifecyclebeta', display_name: 'Lifecycle Beta', active: true, kind: 'client', linear_project_ids: [{ id: 'fixture-project-beta' }] },
];
const MEMBERS = ['smm', 'admin', 'editor', 'designer'].map((role, i) => ({
  id: `00000000-0000-4000-8000-00000000010${i}`, name: `Fixture ${role}`,
  role, team: role === 'editor' ? 'video' : role === 'designer' ? 'graphics' : null, active: true,
}));
MEMBERS.push({ id: '00000000-0000-4000-8000-000000000104', name: 'Fixture alternate editor', role: 'editor', team: 'video', active: true });
const CLOCK = '2026-01-10T12:00:00.000Z';
const STATUS = { 'In Progress': 'in_progress', 'For SMM Approval': 'smm_approval',
  'Kasper Approval': 'kasper_approval', 'Client Approval': 'client_approval',
  'Tweaks Needed': 'tweak', Approved: 'approved', Archived: 'archived' };
function seed(comp = 'video', status = 'Tweaks Needed', tweak = true) {
  const row = { id: 'fixture-card-alpha', client: CLIENTS[0].slug, name: 'Fictional lifecycle card',
    status, video_status: 'N/A', graphic_status: 'N/A', caption_status: 'N/A', title_status: 'N/A',
    asset_url: 'https://media.invalid/fixture.mp4', thumbnail_url: 'https://media.invalid/fixture.svg',
    caption: '', platforms: 'instagram', order_index: 1, scheduled_date: '2030-04-12',
    updated_at: CLOCK, created_at: CLOCK, kasper_seen: '', kasper_approved_at: '',
    video_tweaks: '[]', graphic_tweaks: '[]', caption_tweaks: '[]', title_tweaks: '[]',
    video_deliverable_id: '', graphic_deliverable_id: '',
  };
  row[`${comp}_status`] = status;
  row[`${comp}_deliverable_id`] = '00000000-0000-4000-8000-000000000201';
  if (tweak) row[`${comp}_tweaks`] = JSON.stringify([{ id: 'fixture-tweak', parent_id: null,
    author: 'Fixture admin', role: 'kasper', audience: 'internal', is_tweak: true,
    body: 'Fictional requested adjustment', created_at: CLOCK, updated_at: CLOCK,
    done: false, done_at: '', done_by: '', round: 1 }]);
  const native = { id: row[`${comp}_deliverable_id`], title: row.name, client_slug: row.client,
    team: comp === 'graphic' ? 'graphics' : 'video', kind: comp === 'graphic' ? 'graphic' : 'video',
    status: STATUS[status], origin: 'calendar', card_id: row.id, version: 1, raw_project_id: 'fixture-project-alpha',
    assignee_id: MEMBERS.find(m => m.role === (comp === 'graphic' ? 'designer' : 'editor')).id,
    due_date: null, created_at: CLOCK, updated_at: CLOCK, status_at: CLOCK };
  return { row, native };
}
class Backend {
  constructor(comp, status, tweak) {
    const initial = seed(comp, status, tweak);
    this.comp = comp; this.rows = [initial.row]; this.native = [initial.native];
    this.records = []; this.blocked = []; this.receipts = new Map(); this.comments = [];
    this.revision = 0; this.fault = null; this.holds = []; this.canonical = true;
  }
  stamp() { this.revision++; return new Date().toISOString(); }
  arm(kind, target = 'status') { this.fault = { kind, target }; }
  release() { this.holds.splice(0).forEach(resolve => resolve()); }
  async handle(route, session, origin) {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    const send = (body, status = 200, type = 'application/json') => route.fulfill({ status,
      contentType: type, body: type === 'application/json' ? JSON.stringify(body) : body });
    // Only exact loopback origin is allowed out of Playwright interception.
    if (url.origin === origin && ['GET', 'HEAD'].includes(method)) return route.continue();
    const block = () => { this.blocked.push({ session, method, path: url.pathname }); return route.abort('blockedbyclient'); };
    if (url.hostname === 'fonts.googleapis.com' && method === 'GET') return send('', 200, 'text/css');
    if (url.hostname === 'cdn.jsdelivr.net' && method === 'GET'
      && /\/npm\/(chart\.js@|@supabase\/supabase-js@)/.test(url.pathname)) return send('', 200, 'application/javascript');
    if (url.hostname === 'media.invalid' && method === 'GET') return send(
      '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#345"/><text x="60" y="180" fill="white">FICTIONAL MEDIA</text></svg>', 200, 'image/svg+xml');
    if (url.hostname === 'docs.google.com' && method === 'GET' && url.pathname.includes('/spreadsheets/')) {
      const sheets = {
        Metrics: 'client_name,date,ig_followers,ig_avg_views\nLifecycle Alpha,2030-04-10,123,42\nLifecycle Beta,2030-04-10,321,24',
        'Clients Info': 'client_name,content_description,instagram_handle\nLifecycle Alpha,Fictional fixture,fixture_alpha\nLifecycle Beta,Fictional fixture,fixture_beta',
        TopVideos: 'client_name,platform,period,rank,video_url,caption,views,likes,comments,shares\n',
        'Competitor Briefs': 'id,client_name,raw_json\n', 'Market Research Briefs': 'client_name,brief_name,brief_date,brief_content\n',
        ContentSummaries: 'client_name,date,bullets\n',
        'Social Media Managers': 'client_name,social_media_manager\nLifecycle Alpha,Fixture smm\nLifecycle Beta,Fixture smm',
      };
      if (Object.hasOwn(sheets, url.searchParams.get('sheet'))) return send(sheets[url.searchParams.get('sheet')], 200, 'text/csv');
      return block();
    }
    // Derive the configured host from the pinned document in the harness.
    if (url.hostname !== this.apiHost && url.hostname !== this.webhookHost) return block();
    let body = {}; try { body = req.postDataJSON() || {}; } catch {}
    const p = url.pathname, table = p.split('/').pop();
    if (p.startsWith('/webhook/') ? url.hostname !== this.webhookHost : url.hostname !== this.apiHost) return block();
    const record = (action, outcome = 'read') => {
      const r = { session, action, body: clone(body), outcome, revision: this.revision };
      this.records.push(r); return r;
    };
    if (method === 'GET' && p.startsWith('/rest/v1/')) {
      const read = record(`read:${table}`);
      let rows;
      if (table === 'clients') rows = CLIENTS;
      else if (table === 'team_members') rows = MEMBERS;
      else if (table === 'syncview_runtime_flags') rows = [
        ...['calendar_upsert_ef_clients', 'sample_review_ef_clients', 'settings_ef_clients', 'write_ui_reroute_clients']
          .map(key => ({ key, value: { clients: CLIENTS.map(c => c.slug) } })),
        { key: 'prod_authority', value: { video: 'syncview', graphics: 'syncview' } },
        { key: 'client_comment_gateway_enabled', value: { enabled: this.canonical } },
      ];
      else if (table === 'calendar_posts') rows = this.rows;
      else if (['deliverables', 'production_deliverables_browser_v1'].includes(table)) rows = this.native;
      else if (['templates', 'caption_prompts', 'sample_reviews', 'batches', 'deliverable_events', 'calendar_post_events', 'workload_issues', 'production_comment_crosswalks'].includes(table)) rows = [];
      else return block();
      rows = rows.filter(row => [...url.searchParams].every(([key, value]) => {
        if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
        if (value.startsWith('in.(')) return value.slice(4, -1).split(',').map(v => v.replace(/^"|"$/g, '')).includes(String(row[key]));
        return true;
      }));
      if (table === 'calendar_posts' && url.searchParams.has('or')) rows = rows.filter(row => row.status !== 'Archived');
      const snapshot = clone(rows);
      read.row_count = snapshot.length;
      if (this.fault?.target === 'read:calendar_posts' && table === 'calendar_posts') {
        this.fault = null; await new Promise(resolve => this.holds.push(resolve));
      }
      return send(snapshot);
    }
    if (method === 'POST' && p === '/functions/v1/key-verify') {
      const member = MEMBERS.find(m => m.id === body.member?.id) || MEMBERS.find(m => m.role === session);
      record('key-verify'); return send({ ok: true, role: member?.role, member, mode: 'strict' });
    }
    if (method === 'POST' && p === '/functions/v1/client-token-verify') {
      const client = CLIENTS.find(c => c.slug === body.slug);
      record('client-token-verify');
      return send({ ok: true, valid: !!client, allowed: !!client, slug: client?.slug,
        display_name: client?.display_name, view: body.view, strict: true, active: true, protocol: 'syncview-client-entry-v1' });
    }
    if (p === '/functions/v1/production-comments' && method === 'POST') {
      record('comments-read'); return send({ ok: true, comments: clone(this.comments.filter(c => c.deliverable_id === body.deliverable_id
        && (session !== 'client' || c.audience === 'client'))), has_more: false, next_cursor: null });
    }
    if (p === '/functions/v1/production-write' && method === 'POST') {
      if (body.action) {
        record(body.action);
        if (body.action === 'labels_read') return send({ ok: true, catalog: [], selected_labels: [], selected_label_ids: [], complete: true });
        if (body.action === 'description_read') return send({ ok: true, complete: true, row: { ...clone(this.native[0]), brief: '' } });
        if (body.action === 'asset_access_read') return send({ ok: true, complete: true, id: body.id,
          client_slug: this.native[0].client_slug, team: this.native[0].team, assets:
          ['filming_plan', 'raw_footage', 'delivery_folder', 'deliverable_file'].map(slot => ({ slot, state: 'missing', url: null })) });
        if (body.action === 'assignee_options') return send({ ok: true, complete: true, authority: 'syncview', assignees: MEMBERS.filter(m => m.team === this.native[0].team) });
        return block();
      }
      const r = record(body.operation, 'attempt');
      if (!['status', 'due', 'assignee', 'comment'].includes(body.operation)) return block();
      const row = this.native.find(row => row.id === body.id);
      if (!row) { r.outcome = 'rejected'; return send({ ok: false, error: 'not_found' }, 404); }
      const fault = this.fault?.target === body.operation ? this.fault : null;
      if (fault) this.fault = null;
      if (fault?.kind === 'hold') await new Promise(resolve => this.holds.push(resolve));
      if (fault?.kind === 'reject') { r.outcome = 'rejected'; return send({ ok: false, error: 'write_forbidden' }, 403); }
      const old = this.receipts.get(body.request_id);
      if (old) { r.outcome = 'replayed'; return send(old); }
      if (this.rows.find(p => p.id === row.card_id)?.status === 'Archived'
        || (body.expected_updated_at && body.expected_updated_at !== row.updated_at)
        || (body.expected_status && body.expected_status !== row.status)) {
        r.outcome = 'conflict'; return send({ ok: false, error: 'write_conflict', row: clone(row) }, 409);
      }
      if (body.operation === 'status') row.status = body.status;
      if (body.operation === 'due') row.due_date = body.due_date || null;
      if (body.operation === 'assignee') row.assignee_id = body.assignee_id || null;
      const changedAt = this.stamp();
      if (body.operation !== 'comment') { row.updated_at = changedAt; row.version++; }
      if (body.operation === 'status') row.status_at = row.updated_at;
      let comment;
      if (body.operation === 'comment') {
        const input = body.comment, action = input.action || 'add';
        if (action === 'add') {
          comment = { id: `fixture-comment-${this.revision}`, deliverable_id: row.id, ...clone(input),
            author_name: `Fixture ${session}`, role: session, component: input.component || this.comp,
            can_edit: true, can_delete: true, can_resolve: true,
            version: 1, created_at: changedAt, updated_at: changedAt };
          this.comments.push(comment);
        } else {
          comment = this.comments.find(c => c.id === input.id);
          if (!comment || comment.version !== input.expected_version || comment.updated_at !== input.expected_updated_at) {
            r.outcome = 'conflict'; return send({ ok: false, error: 'write_conflict' }, 409);
          }
          if (action === 'edit') { comment.body = input.body; comment.edited_at = changedAt; }
          else if (action === 'resolve') comment.resolved_at = changedAt;
          else if (action === 'unresolve') comment.resolved_at = null;
          else if (action === 'delete') comment.deleted_at = changedAt;
          else return block();
          comment.version++; comment.updated_at = changedAt;
        }
      }
      const response = { ok: true, native_committed: true, mirror_pending: false, row: clone(row), ...(comment ? { comment } : {}) };
      if (body.request_id) this.receipts.set(body.request_id, clone(response));
      r.outcome = 'accepted'; r.revision = this.revision;
      if (fault?.kind === 'lost') return route.abort('failed');
      return send(response);
    }
    if (p === '/functions/v1/calendar-upsert' && method === 'POST') {
      const r = record('calendar-upsert', 'attempt'), row = this.rows.find(row => row.id === body.post?.id);
      if (!row || row.client !== body.client) { r.outcome = 'wrong-client'; return send({ ok: false, error: 'scope_mismatch' }, 409); }
      if (row.status === 'Archived' && body.post.status !== 'Archived') { r.outcome = 'conflict'; return send({ ok: false, error: 'write_conflict' }, 409); }
      Object.assign(row, clone(body.post), { updated_at: this.stamp() });
      r.outcome = 'accepted'; r.revision = this.revision; return send({ ok: true, post: clone(row) });
    }
    if (method === 'GET' && p === '/webhook/calendar-get') { record('calendar-get'); return send({ ok: true, posts: clone(this.rows.filter(r => r.client === url.searchParams.get('client'))) }); }
    if (method === 'GET' && ['/webhook/templates-get', '/webhook/caption-prompts-get'].includes(p)) return send({ ok: true, templates: {}, prompts: {} });
    if (method === 'GET' && p === '/webhook/linear-projects') return send({ projects: CLIENTS.map(c => c.display_name) });
    if (p === '/functions/v1/filming-plans' && method === 'GET') return send({ ok: true, plans: [] });
    if (p === '/functions/v1/onboarding-full' && method === 'GET') return send({ ok: true, clients: [], records: [], submissions: [] });
    if (p === '/functions/v1/smm-weekly-reports' && method === 'GET') return send({ ok: true, reports: [] });
    if (p === '/functions/v1/thumbnail-revision-read' && method === 'POST') return send({ ok: true, items: [], available: [] });
    return block();
  }
}
module.exports = { Backend, CLIENTS, MEMBERS, STATUS, clone };
