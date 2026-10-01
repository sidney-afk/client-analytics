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
import { clientSlug } from './sheets-mirror.mjs';

export const CORS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-syncview-key',
  'Cache-Control': 'no-store',
});
export const ACTIONS = Object.freeze(['get', 'set_step', 'summary']);
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
