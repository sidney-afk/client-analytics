// The request handler for the client-onboarding Edge Function (step 2.2 of
// docs/plans/2026-10-01-onboarding-checklist-and-profile.md): read one client's
// onboarding checklist and resources, change one checklist step, and list every
// client's progress. Dependency-free and unit-tested in Node
// (test/client-onboarding-handler.js); index.ts only wires it to Deno, to the
// staff role-key gate and to a service-role Supabase client.
//
// ACCESS. ADMIN staff only, for reads AND writes (owner decision 2026-10-01).
// The caller proves it with the admin role key in X-Syncview-Key AND names an
// active admin team member (member_id), who is recorded as the actor. SMM and
// creative keys, client link tokens and the n8n key are all refused, before the
// body is read. The browser never touches the tables.
//
// WRITES go through client_onboarding_set_step() (migration
// 2026-10-03-onboarding-checklist-tables.sql): admin only again in the database,
// version checked (updated_at), a skip needs a note, one history row per change.
// READS return presence and ids only: never a review token, a credential or a
// password (client_resource_status_v1 holds booleans; client_credentials is
// never read here).
//
// CREATE CLIENT (step 2.5): `create_preview` checks a new client against the
// live roster and says exactly what would be made, writing nothing;
// `create` makes it through client_create_native() (migration
// 2026-10-08-create-client.sql): roster row, review link, four save
// permissions, profile, manager and checklist in one transaction. A name that
// starts with "ZZ THROWAWAY" uses the test path (kind 'test', never on the
// Sheet, removable). Neither touches Slack.
import { clientSlug } from './sheets-mirror.mjs';

export const CORS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-syncview-key',
  'Cache-Control': 'no-store',
});
export const ACTIONS = Object.freeze(['get', 'set_step', 'summary', 'create_preview', 'create']);
export const STATUSES = Object.freeze(['todo', 'done', 'skipped', 'unknown']);
export const MAX_BODY = 100000;
export const MAX_TEXT = 2000;

const clean = (v) => String(v == null ? '' : v).trim();

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Database error text -> HTTP status and a stable code. Anything not listed is a
// plain write_failed, and its text is never returned to the browser.
const RPC_ERRORS = Object.freeze({
  client_onboarding_admin_only: [403, 'admin_only'],
  client_onboarding_actor_required: [400, 'actor_required'],
  client_onboarding_bad_status: [400, 'bad_status'],
  client_onboarding_skip_needs_note: [400, 'skip_needs_note'],
  client_onboarding_unknown_step: [400, 'unknown_step'],
  client_onboarding_client_missing: [404, 'client_profile_missing'],
  client_onboarding_version_conflict: [409, 'version_conflict'],
});
// client_create_native() refusals -> HTTP status and a stable code.
const CREATE_ERRORS = Object.freeze({
  client_create_name_taken: [409, 'name_taken'],
  client_create_name_on_a_manager_list: [409, 'name_on_a_manager_list'],
  client_create_slug_taken: [409, 'slug_taken'],
  client_create_slug_invalid: [400, 'slug_invalid'],
  client_create_name_invalid: [400, 'name_invalid'],
  client_create_email_invalid: [400, 'email_invalid'],
  client_create_manager_unknown: [400, 'manager_unknown'],
  client_create_test_needs_throwaway_name: [400, 'test_needs_throwaway_name'],
  client_create_throwaway_name_needs_test_mode: [400, 'throwaway_name_needs_test_mode'],
  client_create_checklist_incomplete: [500, 'checklist_incomplete'],
  roster_authority_not_syncview: [409, 'authority_not_syncview'],
  native_client_provision_authority_unavailable: [409, 'production_authority_unavailable'],
  native_client_test_provision_authority_unavailable: [409, 'production_authority_unavailable'],
  native_client_provision_epochs_unavailable: [409, 'production_authority_unavailable'],
  native_client_test_provision_epochs_unavailable: [409, 'production_authority_unavailable'],
  native_client_provision_routing_flag_invalid: [409, 'routing_flag_invalid'],
  native_client_test_provision_routing_flag_invalid: [409, 'routing_flag_invalid'],
  native_client_provision_idempotency_conflict: [409, 'request_reused'],
  native_client_test_provision_idempotency_conflict: [409, 'request_reused'],
  native_client_provision_client_exists: [409, 'slug_taken'],
  native_client_test_provision_client_exists: [409, 'slug_taken'],
});
export function mapCreateError(message, code) {
  const m = clean(message);
  // PostgREST answers PGRST202 when the function is not there: the migration is not applied yet.
  if (clean(code) === 'PGRST202' || /could not find the function/i.test(m)) return { status: 503, code: 'create_not_installed' };
  for (const [text, out] of Object.entries(CREATE_ERRORS)) if (m.includes(text)) return { status: out[0], code: out[1] };
  return { status: 500, code: 'create_failed' };
}

export const THROWAWAY_NAME = /^ZZ THROWAWAY/;
const ROUTING_KEYS = ['calendar_upsert_ef_clients', 'sample_review_ef_clients', 'settings_ef_clients', 'write_ui_reroute_clients'];
// What a create makes, in plain words, for the preview. Counts only.
export const WILL_CREATE = Object.freeze([
  'Roster row (the client appears across SyncView)',
  'Review link for the client',
  'Save permissions in all four lists',
  'Client profile (the Clients tab details)',
  'Social media manager assignment',
  '27-step onboarding checklist, with 4 steps ticked by this create',
]);

export function validateCreate(body) {
  const name = clean(body.display_name).replace(/\s+/g, ' ');
  if (!name || name.length > 160) return { ok: false, error: 'name_invalid' };
  const slug = clientSlug(name);
  if (!slug || slug.length > 60) return { ok: false, error: 'slug_invalid' };
  const managerSlug = clean(body.manager_slug);
  if (!/^[a-z0-9&]{1,60}$/.test(managerSlug)) return { ok: false, error: 'manager_unknown' };
  const email = clean(body.email);
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return { ok: false, error: 'email_invalid' };
  const mode = THROWAWAY_NAME.test(name) ? 'test' : 'client';
  if (mode === 'client' && (/^zzthrowaway/.test(slug) || /^zz throwaway/i.test(name))) return { ok: false, error: 'throwaway_name_needs_test_mode' };
  return { ok: true, name, slug, managerSlug, email, mode };
}

// Read-only checks against the live roster. Returns the blockers (codes) the
// database would refuse with, so the preview can say so before anything runs.
export async function createPreview(db, v) {
  const [managers, flags, clients, profiles] = await Promise.all([
    must(db.from('social_media_managers').select('slug,name,active,source_clients').eq('active', true).order('name', { ascending: true })),
    must(db.from('syncview_runtime_flags').select('key,value').in('key', ['client_profiles_authority', 'prod_authority', ...ROUTING_KEYS])),
    must(db.from('clients').select('slug,display_name')),
    must(db.from('client_profiles').select('slug,display_name')),
  ]);
  const flag = Object.fromEntries((flags || []).map((f) => [f.key, f.value]));
  const lower = (x) => clean(x).toLowerCase();
  const blockers = [];
  if (lower(flag.client_profiles_authority && flag.client_profiles_authority.source) !== 'syncview') blockers.push('authority_not_syncview');
  const pa = flag.prod_authority || {};
  if (lower(pa.video) !== 'syncview' || lower(pa.graphics) !== 'syncview') blockers.push('production_authority_unavailable');
  if (ROUTING_KEYS.some((k) => !flag[k] || !Array.isArray(flag[k].clients))) blockers.push('routing_flag_invalid');
  const manager = (managers || []).find((m) => m.slug === v.managerSlug) || null;
  if (!manager) blockers.push('manager_unknown');
  const all = [...(clients || []), ...(profiles || [])];
  if (all.some((r) => lower(r.display_name) === lower(v.name))) blockers.push('name_taken');
  else if ((managers || []).some((m) => (Array.isArray(m.source_clients) ? m.source_clients : []).some((c) => lower(c) === lower(v.name)))) blockers.push('name_on_a_manager_list');
  if (all.some((r) => clean(r.slug) === v.slug)) blockers.push('slug_taken');
  return {
    ready: blockers.length === 0, blockers, mode: v.mode, slug: v.slug, display_name: v.name, email: v.email || null,
    manager: manager ? { slug: manager.slug, name: clean(manager.name) || manager.slug } : null,
    managers: (managers || []).map((m) => ({ slug: m.slug, name: clean(m.name) || m.slug })),
    will_create: WILL_CREATE, sheet_copy: v.mode === 'client', slack: 'not_queued',
  };
}

export function mapRpcError(message) {
  const m = clean(message);
  for (const [text, out] of Object.entries(RPC_ERRORS)) if (m.includes(text)) return { status: out[0], code: out[1] };
  return { status: 500, code: 'write_failed' };
}

async function adminMember(db, memberId) {
  if (!memberId) return null;
  const { data, error } = await db.from('team_members').select('id,name,role,active').eq('id', memberId).eq('active', true).maybeSingle();
  if (error) throw error;
  if (!data || clean(data.role) !== 'admin' || !clean(data.name)) return null;
  return { id: clean(data.id), name: clean(data.name) };
}

async function must(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

// The catalog joined with this client's progress, in checklist order.
export function mergeSteps(catalog, progress) {
  const byKey = new Map((progress || []).map((p) => [p.step_key, p]));
  return (catalog || []).map((s) => {
    const p = byKey.get(s.step_key) || {};
    return {
      step_key: s.step_key, position: s.position, label: s.label, kind: s.kind, required: !!s.required,
      detectable: !!s.detectable, proof: s.proof,
      status: p.status || 'todo', responsible: p.responsible || s.default_owner || 'owner',
      evidence: p.evidence == null ? null : p.evidence, note: p.note == null ? null : p.note,
      source: p.source || null, done_by: p.done_by || null, done_at: p.done_at || null, updated_at: p.updated_at || null,
    };
  });
}

export function validateSetStep(body) {
  const stepKey = clean(body.step_key);
  if (!/^[a-z][a-z0-9_]{2,47}$/.test(stepKey)) return { ok: false, error: 'bad_step_key' };
  const status = clean(body.status);
  if (!STATUSES.includes(status)) return { ok: false, error: 'bad_status' };
  const expected = clean(body.expected_updated_at);
  if (!expected || Number.isNaN(Date.parse(expected))) return { ok: false, error: 'expected_updated_at_required' };
  const evidence = body.evidence == null ? null : clean(body.evidence);
  const note = body.note == null ? null : clean(body.note);
  if ((evidence != null && evidence.length > MAX_TEXT) || (note != null && note.length > MAX_TEXT)) return { ok: false, error: 'value_too_long' };
  if (status === 'skipped' && !note) return { ok: false, error: 'skip_needs_note' };
  return { ok: true, stepKey, status, expected, evidence: evidence || null, note: note || null };
}

// deps: { authorize(staffKey) -> {ok, role}, makeClient() -> db | null, newId() }
export function buildHandler(deps) {
  return async function handle(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

    // Authenticate before the body is read or a service-role client is made.
    const staffKey = clean(req.headers.get('x-syncview-key'));
    const auth = staffKey ? deps.authorize(staffKey, ['admin']) : { ok: false, role: null };
    if (!auth.ok || auth.role !== 'admin') return json({ ok: false, error: 'unauthorized' }, auth.role ? 403 : 401);

    try {
      const db = deps.makeClient();
      if (!db) return json({ ok: false, error: 'server_not_configured' }, 500);
      const raw = await req.text();
      if (raw.length > MAX_BODY) return json({ ok: false, error: 'body_too_large' }, 413);
      let body;
      try { body = JSON.parse(raw || '{}'); } catch (_e) { return json({ ok: false, error: 'bad_json' }, 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ ok: false, error: 'bad_json' }, 400);
      const action = clean(body.action);
      if (!ACTIONS.includes(action)) return json({ ok: false, error: 'unknown_action' }, 400);

      const member = await adminMember(db, clean(body.member_id));
      if (!member) return json({ ok: false, error: 'admin_member_required' }, 403);

      if (action === 'create_preview' || action === 'create') {
        // With no name yet, the preview only lists the managers (the dialog's picker).
        if (action === 'create_preview' && !clean(body.display_name)) {
          const managers = await must(db.from('social_media_managers').select('slug,name').eq('active', true).order('name', { ascending: true }));
          return json({ ok: true, ready: false, blockers: ['name_invalid'], managers: (managers || []).map((m) => ({ slug: m.slug, name: clean(m.name) || m.slug })) });
        }
        const v = validateCreate(body);
        if (!v.ok) return json({ ok: false, error: v.error }, 400);
        const preview = await createPreview(db, v);
        if (action === 'create_preview') return json({ ok: true, ...preview });
        const requestId = clean(body.request_id);
        if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(requestId)) return json({ ok: false, error: 'request_id_required' }, 400);
        const made = await db.rpc('client_create_native', {
          p_request_id: requestId, p_client_slug: v.slug, p_display_name: v.name, p_manager_slug: v.managerSlug,
          p_email: v.email || '', p_actor: member.name, p_mode: v.mode,
        });
        if (made.error) {
          const m = mapCreateError(made.error.message, made.error.code);
          if (m.code === 'create_failed') console.error('client-onboarding: create failed', clean(made.error.message).slice(0, 200));
          return json({ ok: false, error: m.code, blockers: preview.blockers }, m.status);
        }
        // Best effort, real clients only: push the new rows to the read-only Sheet copy now
        // (what is not copied stays queued for the next copy). Never turns a create into a failure.
        let sheetCopy = null;
        if (v.mode === 'client' && typeof deps.copyToSheet === 'function') {
          try { sheetCopy = await deps.copyToSheet(db); } catch (_e) { sheetCopy = { ok: false }; }
        }
        return json({ ok: true, request_id: requestId, result: made.data, client_slug: v.slug, mode: v.mode, sheet_copy: sheetCopy });
      }

      if (action === 'summary') {
        const rows = await must(db.from('client_onboarding_summary_v1').select('*').order('client_slug', { ascending: true }));
        return json({ ok: true, clients: rows || [] });
      }

      const slug = clientSlug(body.slug);
      if (!slug) return json({ ok: false, error: 'missing_client' }, 400);

      if (action === 'get') {
        const ensured = await db.rpc('client_onboarding_ensure', { p_slug: slug });
        if (ensured.error) {
          const m = mapRpcError(ensured.error.message);
          return json({ ok: false, error: m.code }, m.status);
        }
        const [catalog, progress, summary, status, stored, sales] = await Promise.all([
          must(db.from('onboarding_steps').select('*').order('position', { ascending: true })),
          must(db.from('client_onboarding_progress').select('*').eq('client_slug', slug)),
          must(db.from('client_onboarding_summary_v1').select('*').eq('client_slug', slug).maybeSingle()),
          must(db.from('client_resource_status_v1').select('*').eq('client_slug', slug).maybeSingle()),
          must(db.from('client_resources').select('resource_key,value,status,source,confirmed_by,confirmed_at,updated_at').eq('client_slug', slug)),
          must(db.from('client_sales_state').select('hubspot_deal_id,hubspot_contact_id,hubspot_stage,contract_state,payment_state,imported_unknown,synced_at').eq('client_slug', slug).maybeSingle()),
        ]);
        return json({
          ok: true, client_slug: slug,
          steps: mergeSteps(catalog, progress), summary: summary || null,
          resources: { present: status || null, stored: stored || [] },
          sales: sales || null,
        });
      }

      // action === 'set_step'
      const v = validateSetStep(body);
      if (!v.ok) return json({ ok: false, error: v.error }, 400);
      const requestId = deps.newId();
      const done = await db.rpc('client_onboarding_set_step', {
        p_slug: slug, p_step_key: v.stepKey, p_status: v.status, p_evidence: v.evidence, p_note: v.note,
        p_actor: member.name, p_role: 'admin', p_expected_updated_at: v.expected, p_request_id: requestId,
      });
      if (done.error) {
        const m = mapRpcError(done.error.message);
        if (m.code === 'write_failed') console.error('client-onboarding: set_step failed', clean(done.error.message).slice(0, 200));
        if (m.code === 'version_conflict') {
          const current = await db.from('client_onboarding_progress').select('*').eq('client_slug', slug).eq('step_key', v.stepKey).maybeSingle();
          return json({ ok: false, error: m.code, row: current.data || null }, 409);
        }
        return json({ ok: false, error: m.code }, m.status);
      }
      return json({ ok: true, request_id: requestId, result: done.data });
    } catch (e) {
      console.error('client-onboarding failed', e instanceof Error ? e.message : String(e));
      return json({ ok: false, error: 'request_failed' }, 500);
    }
  };
}
