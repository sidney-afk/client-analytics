// Supabase Edge Function: crm-leads
//
// The Leads page (/leads, docs/features/CRM_LEADS.md). Staff-key gated like
// quiz-leads-list and hiring-applications: the role comes only from the
// secret that matches X-Syncview-Key; the actor header is attribution. The
// rows hold contact details, so this function is the only reader: the tables
// have no browser privileges at all.
//
// POST JSON { action }:
//   list    { filters? }                         -> { people: card[] }
//   get     { id }                               -> { person, source, events }
//   update  { id, expected_version, patch, note? } -> { person } | 409 { current }
//   note    { id, note }                         -> { person }
// Every change goes through public.crm_apply_change, which swaps on
// state_version and appends the crm_events rows in the same transaction.
//
// Deploy: by the merge lane once its migration is applied
// (docs/ops/EF_AUTO_DEPLOY.md). verify_jwt = false (supabase/config.toml).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { authorizeStaffKey, matchingRoleForKey, staffAuthFailureStatus } from "../_shared/staff-role-auth.ts";
import {
  cardOf, changeEvents, effectivePatch, isUuid, leadsAllowed, LIST_MAX, parseListFilters,
  validateNote, validatePatch,
} from "../_shared/crm-leads-core.mjs";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "https://syncview.synchrosocial.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role",
  "Cache-Control": "no-store",
};
const PERSON_COLUMNS =
  "id,display_name,email,phone,instagram_handle,lead_type,niche,source_id,stage,owner,next_step,next_step_due,lost_reason,tags,state_version,created_at,updated_at";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function readPerson(db: SupabaseClient, id: string) {
  const { data, error } = await db.from("crm_people").select(PERSON_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error("read_failed");
  return data;
}

async function apply(db: SupabaseClient, id: string, expected: number, patch: Record<string, unknown>, actor: string, events: unknown[]) {
  const { data, error } = await db.rpc("crm_apply_change", {
    p_id: id, p_expected_version: expected, p_patch: patch, p_actor: actor, p_events: events,
  });
  if (error) throw new Error("write_failed");
  return Array.isArray(data) && data.length ? data[0] : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const key = (req.headers.get("x-syncview-key") || "").trim();
  const actor = (req.headers.get("x-syncview-actor") || "").trim().slice(0, 80);
  // Any recognised role key authenticates; leadsAllowed decides (role matrix
  // plus the per-person grants documented in crm-leads-core.mjs).
  const auth = authorizeStaffKey(key, ["admin", "smm", "creative"]);
  if (!auth.ok || auth.via !== "role") return json({ ok: false, error: "unauthorized" }, staffAuthFailureStatus(auth));
  const role = matchingRoleForKey(key);
  if (!leadsAllowed(role, actor)) return json({ ok: false, error: "forbidden" }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }
  const action = String(body.action || "");
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    if (action === "list") {
      const f = parseListFilters(body.filters) as Record<string, any>;
      let q = db.from("crm_people").select(PERSON_COLUMNS).order("next_step_due", { ascending: true, nullsFirst: false })
        .order("updated_at", { ascending: false }).limit(LIST_MAX);
      for (const k of ["lead_type", "stage", "niche", "owner", "source_id"]) if (f[k]) q = q.eq(k, f[k]);
      if (f.due) q = q.gte("next_step_due", f.due.from).lte("next_step_due", f.due.to);
      const { data, error } = await q;
      if (error) return json({ ok: false, error: "read_failed" }, 500);
      const { data: sources } = await db.from("crm_sources").select("id,name,kind").order("created_at", { ascending: false }).limit(200);
      const t = today();
      const people = (data || []).map((r) => cardOf(r, t));
      return json({ ok: true, count: people.length, truncated: people.length === LIST_MAX, people, sources: sources || [] });
    }

    const id = String(body.id || "");
    if (!isUuid(id)) return json({ ok: false, error: "bad_id" }, 400);

    if (action === "get") {
      const person = await readPerson(db, id);
      if (!person) return json({ ok: false, error: "not_found" }, 404);
      const [{ data: events }, { data: source }] = await Promise.all([
        db.from("crm_events").select("id,kind,channel,actor,detail,occurred_at").eq("person_id", id)
          .order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(200),
        person.source_id
          ? db.from("crm_sources").select("id,name,kind,link").eq("id", person.source_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      return json({ ok: true, person, source: source || null, events: events || [] });
    }

    if (action === "update") {
      const expected = Number(body.expected_version);
      if (!Number.isInteger(expected) || expected < 1) return json({ ok: false, error: "bad_expected_version" }, 400);
      const v = validatePatch(body.patch);
      if (!v.ok) return json({ ok: false, error: v.error }, 400);
      let note = "";
      if (body.note != null && body.note !== "") {
        const n = validateNote(body.note);
        if (!n.ok) return json({ ok: false, error: n.error }, 400);
        note = n.note as string;
      }
      const before = await readPerson(db, id);
      if (!before) return json({ ok: false, error: "not_found" }, 404);
      if (before.state_version !== expected) return json({ ok: false, error: "conflict", current: before }, 409);
      const patch = effectivePatch(before, v.patch);
      const events = changeEvents(before, patch, note);
      if (!events.length) return json({ ok: true, person: before, unchanged: true });
      const after = await apply(db, id, expected, patch, actor, events);
      if (!after) {
        const current = await readPerson(db, id);
        return current ? json({ ok: false, error: "conflict", current }, 409) : json({ ok: false, error: "not_found" }, 404);
      }
      return json({ ok: true, person: after });
    }

    if (action === "note") {
      const n = validateNote(body.note);
      if (!n.ok) return json({ ok: false, error: n.error }, 400);
      // A note never conflicts with someone else's edit: it is applied on the
      // version just read, retried once if a save slipped in between.
      for (let attempt = 0; attempt < 2; attempt++) {
        const before = await readPerson(db, id);
        if (!before) return json({ ok: false, error: "not_found" }, 404);
        const after = await apply(db, id, before.state_version, {}, actor, changeEvents(before, {}, n.note as string));
        if (after) return json({ ok: true, person: after });
      }
      return json({ ok: false, error: "conflict" }, 409);
    }

    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (e) {
    const code = e instanceof Error && /^(read|write)_failed$/.test(e.message) ? e.message : "server_error";
    return json({ ok: false, error: code }, 500);
  }
});
