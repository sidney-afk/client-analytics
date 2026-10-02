// The request handler for the client-hubspot-sync Edge Function (step 2.3b of
// docs/plans/2026-10-01-onboarding-checklist-and-profile.md): keep each client's
// HubSpot deal, contract state and payment state in client_sales_state. Dependency
// free and unit-tested in Node (test/client-hubspot-sync-handler.js); index.ts only
// wires it to Deno, the secrets and a service-role Supabase client.
//
// READ ONLY toward HubSpot. It makes exactly three kinds of call, all reads (the
// HubSpot token is a read-only private app token the owner stores as a function
// secret; it never appears in the repo, the page or a response):
//   POST /crm/v3/objects/contacts/search        find the contact by the profile email
//   GET  /crm/v4/objects/contacts/{id}/associations/deals
//   POST /crm/v3/objects/deals/batch/read       read those deals' stage
// It never creates, updates or deletes anything in HubSpot, and never runs through n8n.
//
// TWO WAYS IN, both refused before the body is read:
//   refresh  an admin staff key (X-Syncview-Key) plus an active admin member_id: one client, when
//            a profile is opened. Skipped when that client was synced less than 10 minutes ago.
//   tick     the timer key (X-Hubspot-Sync-Key against HUBSPOT_SYNC_KEY): the daily sweep, a few
//            clients per call, never-synced and oldest first.
//
// SWITCH: syncview_runtime_flags row client_hubspot_sync = {"mode":"off"|"on","all":false,
// "clients":["slug",...],"batch":6}. Default off. Nothing is looked up unless mode is on AND the
// client is named in "clients" (or "all" is true), so the first live run can be the test client.
//
// WRITES go through client_sales_state_apply() (migration 2026-10-04-client-hubspot-sync.sql):
// only a unique match saves ids and states; imports stay "unknown"; one history row per change.
// Responses carry counts and states only: never an email, a HubSpot id or the token.
import { clientSlug } from './sheets-mirror.mjs';

export const CORS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-syncview-key, x-hubspot-sync-key',
  'Cache-Control': 'no-store',
});
export const ACTIONS = Object.freeze(['refresh', 'tick']);
export const FLAG_KEY = 'client_hubspot_sync';
export const HUBSPOT = 'https://api.hubapi.com';
export const CLOSED_WON_STAGE = '3230452433'; // pipeline "Client Acquisition", docs/CLIENT_LIFECYCLE_MAP.md
export const FRESH_MS = 10 * 60 * 1000;
export const MAX_BODY = 20000;
export const DEFAULT_BATCH = 6;
export const MAX_BATCH = 10;

const clean = (v) => String(v == null ? '' : v).trim();

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// HubSpot stores a yes/no property as the text "true" or "false"; empty means nobody ever set it
// (a hand-imported customer), which is "unknown", never "unsigned" or "unpaid".
export function contractPayment(props) {
  const p = props || {};
  const yn = (v) => (clean(v).toLowerCase() === 'true' ? true : clean(v).toLowerCase() === 'false' ? false : null);
  const c = yn(p.contract_signed);
  const f = yn(p.first_invoice_paid);
  return { contract: c === null ? 'unknown' : c ? 'signed' : 'unsigned', payment: f === null ? 'unknown' : f ? 'paid' : 'unpaid' };
}

// One deal is a match; several are a match only when exactly one is Closed Won; otherwise a person decides.
export function pickDeal(deals) {
  const list = Array.isArray(deals) ? deals : [];
  if (!list.length) return { match: 'no_deal' };
  if (list.length === 1) return { match: 'matched', deal: list[0] };
  const won = list.filter((d) => clean(d && d.properties && d.properties.dealstage) === CLOSED_WON_STAGE);
  return won.length === 1 ? { match: 'matched', deal: won[0] } : { match: 'ambiguous_deal' };
}

export class HubspotError extends Error {
  constructor(status) { super('hubspot_http_' + status); this.status = status; }
}

// The only three HubSpot calls this function can make. token = the read-only private app token.
export function makeHubspot(fetchImpl, token) {
  async function call(method, path, body) {
    const res = await fetchImpl(HUBSPOT + path, {
      method, redirect: 'error',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new HubspotError(res.status);
    return res.json();
  }
  return {
    async contactsByEmail(email) {
      const out = await call('POST', '/crm/v3/objects/contacts/search', {
        filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
        properties: ['contract_signed', 'first_invoice_paid'], limit: 3,
      });
      return Array.isArray(out.results) ? out.results : [];
    },
    async dealIdsForContact(contactId) {
      const out = await call('GET', '/crm/v4/objects/contacts/' + encodeURIComponent(contactId) + '/associations/deals');
      return (Array.isArray(out.results) ? out.results : []).map((r) => clean(r.toObjectId)).filter(Boolean).slice(0, 25);
    },
    async dealsByIds(ids) {
      const out = await call('POST', '/crm/v3/objects/deals/batch/read', {
        properties: ['dealstage', 'pipeline'], inputs: ids.map((id) => ({ id })),
      });
      return Array.isArray(out.results) ? out.results : [];
    },
  };
}

// One client's answer from HubSpot: { match, contactId, dealId, stage, contract, payment }.
export async function lookupClient(hubspot, rawEmail) {
  const email = clean(rawEmail).toLowerCase();
  if (!email) return { match: 'no_email' };
  const contacts = await hubspot.contactsByEmail(email);
  if (!contacts.length) return { match: 'no_contact' };
  if (contacts.length > 1) return { match: 'ambiguous_contact' };
  const contact = contacts[0];
  const contactId = clean(contact.id);
  const ids = await hubspot.dealIdsForContact(contactId);
  if (!ids.length) return { match: 'no_deal' };
  const picked = pickDeal(await hubspot.dealsByIds(ids));
  if (picked.match !== 'matched') return { match: picked.match };
  const { contract, payment } = contractPayment(contact.properties);
  return { match: 'matched', contactId, dealId: clean(picked.deal.id), stage: clean(picked.deal.properties && picked.deal.properties.dealstage), contract, payment };
}

async function flag(db) {
  const { data, error } = await db.from('syncview_runtime_flags').select('value').eq('key', FLAG_KEY).maybeSingle();
  if (error) throw error;
  const v = data && data.value && typeof data.value === 'object' ? data.value : {};
  const clients = Array.isArray(v.clients) ? v.clients.map((c) => clientSlug(c)).filter(Boolean) : [];
  const batch = Math.min(MAX_BATCH, Math.max(1, Number.parseInt(v.batch, 10) || DEFAULT_BATCH));
  return { on: v.mode === 'on', all: v.all === true, clients, batch };
}

async function adminMember(db, memberId) {
  if (!memberId) return null;
  const { data, error } = await db.from('team_members').select('id,name,role,active').eq('id', memberId).eq('active', true).maybeSingle();
  if (error) throw error;
  if (!data || clean(data.role) !== 'admin' || !clean(data.name)) return null;
  return { id: clean(data.id), name: clean(data.name) };
}

async function targets(db, slug, limit) {
  const { data, error } = await db.rpc('client_hubspot_sync_targets', { p_slug: slug, p_limit: limit, p_stale_minutes: 1380 });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

// Look one client up and save the answer. Returns the safe summary (no ids, no email).
async function syncOne(db, hubspot, target, actor, requestId) {
  const found = await lookupClient(hubspot, target.email);
  const { data, error } = await db.rpc('client_sales_state_apply', {
    p_slug: target.client_slug, p_match: found.match,
    p_deal_id: found.dealId || null, p_contact_id: found.contactId || null, p_stage: found.stage || null,
    p_contract_state: found.contract || null, p_payment_state: found.payment || null,
    p_actor: actor, p_request_id: requestId,
  });
  if (error) throw error;
  return { match: data && data.match, changed: !!(data && data.changed), contract_state: data && data.contract_state, payment_state: data && data.payment_state, synced_at: data && data.synced_at };
}

// deps: { authorize(staffKey, roles), tickKeyOk(req) -> bool, makeClient() -> db | null,
//         makeHubspot() -> hubspot | null, newId(), now() -> ms }
export function buildHandler(deps) {
  return async function handle(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

    // Authenticate before the body is read or any client is made.
    const timerKey = clean(req.headers.get('x-hubspot-sync-key'));
    const staffKey = clean(req.headers.get('x-syncview-key'));
    let via = null;
    if (timerKey) {
      if (!deps.tickKeyOk(req)) return json({ ok: false, error: 'unauthorized' }, 401);
      via = 'tick';
    } else {
      const auth = staffKey ? deps.authorize(staffKey, ['admin']) : { ok: false, role: null };
      if (!auth.ok || auth.role !== 'admin') return json({ ok: false, error: 'unauthorized' }, auth.role ? 403 : 401);
      via = 'refresh';
    }

    try {
      const db = deps.makeClient();
      if (!db) return json({ ok: false, error: 'server_not_configured' }, 500);
      const raw = await req.text();
      if (raw.length > MAX_BODY) return json({ ok: false, error: 'body_too_large' }, 413);
      let body;
      try { body = JSON.parse(raw || '{}'); } catch (_e) { return json({ ok: false, error: 'bad_json' }, 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ ok: false, error: 'bad_json' }, 400);
      const action = clean(body.action);
      if (!ACTIONS.includes(action) || action !== via) return json({ ok: false, error: 'unknown_action' }, 400);

      const sw = await flag(db);
      if (!sw.on) return json({ ok: true, skipped: 'off' });
      const allowed = (slug) => sw.all || sw.clients.includes(slug);
      const requestId = deps.newId();

      if (action === 'refresh') {
        const member = await adminMember(db, clean(body.member_id));
        if (!member) return json({ ok: false, error: 'admin_member_required' }, 403);
        const slug = clientSlug(body.slug);
        if (!slug) return json({ ok: false, error: 'missing_client' }, 400);
        if (!allowed(slug)) return json({ ok: true, skipped: 'not_enabled' });
        const rows = await targets(db, slug, 1);
        if (!rows.length) return json({ ok: false, error: 'client_not_found' }, 404);
        const last = rows[0].synced_at ? Date.parse(rows[0].synced_at) : NaN;
        if (Number.isFinite(last) && deps.now() - last < FRESH_MS) return json({ ok: true, skipped: 'fresh', synced_at: rows[0].synced_at });
        const hubspot = deps.makeHubspot();
        if (!hubspot) return json({ ok: false, error: 'hubspot_not_configured' }, 500);
        try {
          return json({ ok: true, ...(await syncOne(db, hubspot, rows[0], member.name, requestId)) });
        } catch (e) {
          if (e instanceof HubspotError) return json({ ok: false, error: e.status === 429 ? 'hubspot_rate_limited' : 'hubspot_unavailable' }, 502);
          throw e;
        }
      }

      // tick: the daily sweep
      const hubspot = deps.makeHubspot();
      if (!hubspot) return json({ ok: false, error: 'hubspot_not_configured' }, 500);
      let queue = [];
      if (sw.all) queue = await targets(db, null, sw.batch);
      else {
        for (const slug of sw.clients) {
          if (queue.length >= sw.batch) break;
          const rows = await targets(db, slug, 1);
          const last = rows[0] && rows[0].synced_at ? Date.parse(rows[0].synced_at) : NaN;
          if (rows[0] && !(Number.isFinite(last) && deps.now() - last < 22 * 3600 * 1000)) queue.push(rows[0]);
        }
      }
      const out = { ok: true, looked_up: 0, changed: 0, errors: 0, rate_limited: false };
      for (const target of queue.slice(0, sw.batch)) {
        try {
          const r = await syncOne(db, hubspot, target, 'hubspot-sync', requestId);
          out.looked_up += 1;
          if (r.changed) out.changed += 1;
        } catch (e) {
          out.errors += 1;
          if (e instanceof HubspotError && e.status === 429) { out.rate_limited = true; break; }
        }
      }
      return json(out);
    } catch (_e) {
      return json({ ok: false, error: 'sync_failed' }, 500);
    }
  };
}
