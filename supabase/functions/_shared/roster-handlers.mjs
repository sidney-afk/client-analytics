// Request handlers for the two roster doors, roster-read and roster-write
// (docs/plans/2026-10-02-roster-native.md). Kept as plain JavaScript with the
// outside world passed in (env, a lazy Supabase client, fetch) so
// test/roster-native.js drives the real handlers in Node. The Edge Function
// files only wire Deno's env, the Supabase client and fetch into these.
//
// Server to server only: no CORS surface, and every request needs the
// dedicated ROSTER_SERVICE_KEY in X-Roster-Key. The key is checked before the
// body is parsed and before a service-role client exists. A missing or short
// (under 32 characters) key makes every call refuse.
//
// roster-read answers at any time. roster-write only writes natively when
// client_profiles_authority reads "syncview" (the database refuses otherwise);
// the one exception is sync_managers, which does the opposite: it is the
// "Sheet is still the main copy" path for Manager Sync and refuses once the
// switch has moved.
import {
  CLIENT_HEADERS, clientSlug, csvText, managerRows, MIN_KEY_CHARS, normalizeFields, profileToSheetObject,
  resolveClient, SMM_HEADERS,
} from './roster-native.mjs';
import { copyToSheet, MAX_ATTEMPTS } from './roster-sheet-copy.mjs';

const clean = v => String(v == null ? '' : v).trim();
const line = (v, max) => clean(v).replace(/\s+/g, ' ').slice(0, max);

export function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const aa = enc.encode(a || '');
  const bb = enc.encode(b || '');
  let diff = aa.length ^ bb.length;
  const max = Math.max(aa.length, bb.length);
  for (let i = 0; i < max; i++) diff |= (aa[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

// null = allowed; otherwise the Response to send.
export function rosterAuth(req, env) {
  const secret = clean(env.get('ROSTER_SERVICE_KEY'));
  if (secret.length < MIN_KEY_CHARS) return json({ ok: false, error: 'server_not_configured' }, 503);
  const given = clean(req.headers.get('x-roster-key'));
  if (!given || !timingSafeEqual(given, secret)) return json({ ok: false, error: 'unauthorized' }, 401);
  return null;
}

async function authority(supabase) {
  const { data, error } = await supabase.from('syncview_runtime_flags').select('value').eq('key', 'client_profiles_authority').maybeSingle();
  if (error) throw error;
  const v = data && data.value && typeof data.value === 'object' ? data.value : null;
  return v ? clean(v.source) : '';
}

async function readBody(req) {
  const raw = await req.text();
  if (raw.length > 200000) return { error: json({ ok: false, error: 'body_too_large' }, 413) };
  try { return { body: JSON.parse(raw || '{}') }; } catch (_e) { return { error: json({ ok: false, error: 'bad_json' }, 400) }; }
}

// ---------------- roster-read ----------------
export async function handleRosterRead(req, deps) {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  const denied = rosterAuth(req, deps.env);
  if (denied) return denied;
  try {
    const { body, error } = await readBody(req);
    if (error) return error;
    const action = clean(body.action);
    const supabase = deps.getSupabase();
    const auth = await authority(supabase);
    const format = clean(body.format) === 'csv' ? 'csv' : 'json';
    const headers = { 'X-Roster-Authority': auth || 'unknown' };

    if (action === 'status') {
      const profiles = await supabase.from('client_profiles').select('slug').is('archived_at', null);
      const managers = await supabase.from('social_media_managers').select('slug').eq('active', true);
      if (profiles.error) throw profiles.error;
      if (managers.error) throw managers.error;
      return json({ ok: true, authority: auth, clients: (profiles.data || []).length, managers: (managers.data || []).length });
    }

    if (action === 'clients') {
      let query = supabase.from('client_profiles').select('*').order('display_name');
      if (body.include_archived !== true) query = query.is('archived_at', null);
      const { data, error: e } = await query;
      if (e) throw e;
      let list = data || [];
      if (body.slug || body.client_name) {
        const want = clientSlug(body.slug || body.client_name);
        list = list.filter(r => r.slug === want);
      }
      const rows = list.map(r => ({ ...profileToSheetObject(r), slug: r.slug, archived: !!r.archived_at, updated_at: r.updated_at || '' }));
      if (format === 'csv') {
        return new Response(csvText(CLIENT_HEADERS, rows), { status: 200, headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' } });
      }
      return json({ ok: true, authority: auth, headers: CLIENT_HEADERS, count: rows.length, rows });
    }

    if (action === 'managers') {
      const { data, error: e } = await supabase.from('social_media_managers').select('*').eq('active', true);
      if (e) throw e;
      const rows = managerRows(data || []);
      if (format === 'csv') {
        return new Response(csvText(SMM_HEADERS, rows), { status: 200, headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' } });
      }
      return json({ ok: true, authority: auth, headers: SMM_HEADERS, count: rows.length, rows });
    }
    return json({ ok: false, error: 'unknown_action' }, 400);
  } catch (e) {
    console.error('roster-read failed', e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: 'read_failed' }, 500);
  }
}

// ---------------- roster-write ----------------
const REFUSALS = [
  ['roster_authority_not_syncview', 409, 'authority_not_syncview'],
  ['client_profile_expectation_failed', 409, 'expectation_failed'],
  ['client_profile_archived', 409, 'client_profile_archived'],
  ['client_profile_missing', 404, 'client_profile_missing'],
  ['client_profile_field_not_writable', 400, 'field_not_writable'],
  ['client_profile_bad_slug', 400, 'bad_slug'],
  ['smm_assign_bad_manager_slug', 400, 'bad_manager'],
  ['smm_assign_client_required', 400, 'missing_client'],
  ['client_profile_display_name_required', 400, 'missing_client'],
  ['roster_test_client_untouchable', 409, 'test_client_untouchable'],
  ['roster_routing_flag_invalid', 409, 'routing_flag_invalid'],
];
function refusal(message) {
  const m = String(message || '');
  for (const [needle, status, code] of REFUSALS) {
    if (m.includes(needle)) {
      const field = (m.match(/: ([a-z_]+)/) || [])[1] || null;
      return json({ ok: false, error: code, field: needle.endsWith('failed') || needle.endsWith('writable') ? field : undefined }, status);
    }
  }
  return null;
}

export function makeStore(supabase) {
  return {
    authority: () => authority(supabase),
    async hasNewer(tab, slug, afterId) {
      const { data, error } = await supabase.from('roster_sheet_outbox').select('id')
        .eq('tab', tab).eq('client_slug', slug).gt('id', afterId).limit(1);
      if (error) throw error;
      return (data || []).length > 0;
    },
    async requeue(g) {
      const { error } = await supabase.from('roster_sheet_outbox').insert({ tab: g.tab, client_slug: g.client_slug, client_name: g.client_name });
      if (error) throw error;
    },
    async pending(limit) {
      const { data, error } = await supabase.from('roster_sheet_outbox').select('id,tab,client_slug,client_name')
        .eq('status', 'pending').lt('attempts', MAX_ATTEMPTS).order('id').limit(limit);
      if (error) throw error;
      return data || [];
    },
    async profile(slug) {
      const { data, error } = await supabase.from('client_profiles').select('*').eq('slug', slug).maybeSingle();
      if (error) throw error;
      return data || null;
    },
    async managers() {
      const { data, error } = await supabase.from('social_media_managers').select('*').eq('active', true);
      if (error) throw error;
      return data || [];
    },
    async markDone(ids) {
      const { error } = await supabase.from('roster_sheet_outbox').update({ status: 'done', done_at: new Date().toISOString() }).in('id', ids);
      if (error) throw error;
    },
    async markFailed(ids, code) {
      for (const id of ids) {
        const { data } = await supabase.from('roster_sheet_outbox').select('attempts').eq('id', id).maybeSingle();
        const attempts = Number((data && data.attempts) || 0) + 1;
        const { error } = await supabase.from('roster_sheet_outbox')
          .update({ attempts, last_error: String(code).slice(0, 80), status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending' }).eq('id', id);
        if (error) throw error;
      }
    },
  };
}

// Caller label recorded as the editor: "n8n:<workflow name>".
function actorOf(body) {
  const who = line(body.source, 60).replace(/[^A-Za-z0-9 ._:-]/g, '');
  return 'n8n:' + (who || 'unnamed');
}

async function afterWrite(deps, supabase, base) {
  const copy = await copyToSheet({ store: makeStore(supabase), env: deps.env, fetchFn: deps.fetchFn });
  return json({ ok: true, ...base, sheet_copy: copy });
}

export async function handleRosterWrite(req, deps) {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  const denied = rosterAuth(req, deps.env);
  if (denied) return denied;
  try {
    const { body, error } = await readBody(req);
    if (error) return error;
    const action = clean(body.action);
    const supabase = deps.getSupabase();
    const requestId = clean(body.request_id).slice(0, 100) || (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : null);

    if (action === 'status') {
      return json({ ok: true, authority: await authority(supabase), request_id: requestId });
    }

    if (action === 'copy_to_sheet') {
      const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
      return json({ ok: true, sheet_copy: await copyToSheet({ store: makeStore(supabase), env: deps.env, fetchFn: deps.fetchFn, limit }) });
    }

    // Queue the whole roster for the read-only Sheet copy: the first catch-up
    // after the switch, or the way back to the Sheet if the owner reverses it.
    // Only while the database is the main copy: otherwise it would write the
    // database over the Sheet that still is.
    if (action === 'queue_full_copy') {
      if (await authority(supabase) !== 'syncview') return json({ ok: false, error: 'authority_not_syncview' }, 409);
      const profiles = await supabase.from('client_profiles').select('slug,display_name').is('archived_at', null);
      const managers = await supabase.from('social_media_managers').select('*').eq('active', true);
      if (profiles.error) throw profiles.error;
      if (managers.error) throw managers.error;
      const rows = (profiles.data || []).map(p => ({ tab: 'Clients Info', client_slug: p.slug, client_name: p.display_name }));
      for (const m of managerRows(managers.data || [])) {
        const slug = clientSlug(m.client_name);
        if (slug) rows.push({ tab: 'Social Media Managers', client_slug: slug, client_name: m.client_name });
      }
      for (let i = 0; i < rows.length; i += 500) {
        const { error: e } = await supabase.from('roster_sheet_outbox').insert(rows.slice(i, i + 500));
        if (e) throw e;
      }
      return json({ ok: true, queued: rows.length });
    }

    if (action === 'sync_managers') return await syncManagers(supabase, body);

    if (action === 'upsert_client' || action === 'set_client_fields') {
      const who = resolveClient(body);
      if (!who.ok) return json({ ok: false, error: who.error }, 400);
      const fields = normalizeFields(body.fields, { allowEmpty: action === 'upsert_client' });
      if (!fields.ok) return json({ ok: false, error: fields.error, field: fields.field || null }, 400);
      let expect = {};
      if (body.expect != null) {
        const e = normalizeFields(body.expect, { allowEmpty: true });
        if (!e.ok) return json({ ok: false, error: e.error, field: e.field || null }, 400);
        expect = { ...e.columns, ...e.extra };
      }
      if (action === 'upsert_client' && !who.name) return json({ ok: false, error: 'missing_client' }, 400);
      const hasManager = action === 'upsert_client' && ('social_media_manager' in body);
      const { data, error: rpcErr } = await supabase.rpc('client_profile_service_write', {
        p_slug: who.slug,
        p_display_name: action === 'upsert_client' ? who.name : null,
        p_columns: fields.columns,
        p_extra: fields.extra,
        p_expect: expect,
        p_actor: actorOf(body),
        p_role: 'n8n',
        p_request_id: requestId,
      });
      if (rpcErr) return refusal(rpcErr.message) || serverError('client_profile_service_write', rpcErr);
      const base = { client: { slug: who.slug, created: !!data.created, changed: data.changed, row: data.row, routing: data.routing || {} } };
      if (hasManager) {
        const m = await assign(supabase, who, body, requestId);
        if (m.error) return m.error;
        base.manager = m.data;
      }
      return await afterWrite(deps, supabase, base);
    }

    if (action === 'archive_client') {
      const who = resolveClient(body);
      if (!who.ok) return json({ ok: false, error: who.error }, 400);
      const { data, error: rpcErr } = await supabase.rpc('client_profile_archive', {
        p_slug: who.slug, p_actor: actorOf(body), p_role: 'n8n', p_request_id: requestId,
      });
      if (rpcErr) return refusal(rpcErr.message) || serverError('client_profile_archive', rpcErr);
      return await afterWrite(deps, supabase, { client: { slug: who.slug, archived: !!data.archived, already: !!data.already, routing: data.routing || {} } });
    }

    if (action === 'assign_manager') {
      const who = resolveClient(body);
      if (!who.ok || !who.name) return json({ ok: false, error: 'missing_client' }, 400);
      const m = await assign(supabase, who, body, requestId);
      if (m.error) return m.error;
      return await afterWrite(deps, supabase, { manager: m.data });
    }
    return json({ ok: false, error: 'unknown_action' }, 400);
  } catch (e) {
    return serverError('roster-write', e);
  }

  async function assign(supabase, who, body, requestId) {
    const mname = line(body.social_media_manager, 120);
    const { data, error: rpcErr } = await supabase.rpc('smm_assign_client', {
      p_client_slug: who.slug,
      p_client_name: who.name || who.slug,
      p_manager_slug: mname ? clientSlug(mname) : '',
      p_manager_name: mname,
      p_slack_profile_url: line(body.slack_profile_url, 200),
      p_actor: actorOf(body),
      p_role: 'n8n',
      p_request_id: requestId,
    });
    if (rpcErr) return { error: refusal(rpcErr.message) || serverError('smm_assign_client', rpcErr) };
    return { data };
  }
}

function serverError(where, e) {
  console.error(where + ' failed', e instanceof Error ? e.message : (e && e.message) || String(e));
  return json({ ok: false, error: 'write_failed' }, 500);
}

// While the Sheet is still the main copy, Manager Sync (daily) copies the
// Social Media Managers tab into the managers table. Same contract as
// smm-weekly-reports' sync_managers, plus the Slack id per manager, and it
// refuses once the database is the main copy so a late run cannot overwrite
// native edits.
async function syncManagers(supabase, body) {
  if (await authority(supabase) === 'syncview') return json({ ok: false, error: 'authority_not_sheet' }, 409);
  const input = Array.isArray(body.managers) ? body.managers : [];
  const bySlug = new Map();
  const now = new Date().toISOString();
  for (const item of input) {
    const raw = item && typeof item === 'object' ? item : { name: item };
    const name = line(raw.name || raw.social_media_manager, 120);
    const slug = clientSlug(raw.slug || name);
    if (!name || !slug) continue;
    const clients = Array.isArray(raw.source_clients) ? raw.source_clients.map(x => line(x, 160)).filter(Boolean) : [];
    const prev = bySlug.get(slug);
    if (prev) {
      prev.source_clients = [...new Set([...prev.source_clients, ...clients])].sort((a, b) => a.localeCompare(b));
      prev.source_row_count += Number(raw.source_row_count || 1);
      if (!prev.email && raw.email) prev.email = line(raw.email, 180);
      if (!prev.slack_profile_url && raw.slack_profile_url) prev.slack_profile_url = line(raw.slack_profile_url, 200);
      continue;
    }
    bySlug.set(slug, {
      slug, name, email: line(raw.email, 180), active: raw.active !== false,
      source: line(raw.source || 'google_sheet', 80), source_row_count: Number(raw.source_row_count || 1),
      source_clients: clients, slack_profile_url: line(raw.slack_profile_url, 200), synced_at: now, updated_at: now,
    });
  }
  const rows = [...bySlug.values()];
  if (rows.length) {
    const { error } = await supabase.from('social_media_managers').upsert(rows, { onConflict: 'slug' });
    if (error) return serverError('sync_managers', error);
  }
  if (body.replace !== false && rows.length) {
    const keep = rows.map(r => r.slug);
    const { data: existing } = await supabase.from('social_media_managers').select('slug').eq('active', true).limit(1000);
    for (const r of existing || []) {
      if (r.slug && !keep.includes(r.slug)) {
        await supabase.from('social_media_managers').update({ active: false, synced_at: now, updated_at: now }).eq('slug', r.slug);
      }
    }
  }
  return json({ ok: true, synced: rows.length });
}
