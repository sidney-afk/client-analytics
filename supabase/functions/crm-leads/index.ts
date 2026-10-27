// Supabase Edge Function: crm-leads
//
// The Leads page (/leads, docs/features/CRM_LEADS.md). Staff-key gated like
// quiz-leads-list and hiring-applications: the role comes only from the
// secret that matches X-Syncview-Key; the actor header is attribution. The
// rows hold contact details, so this function is the only reader: the tables
// have no browser privileges at all.
//
// POST JSON { action }. Staff key (Leads access):
//   list    { filters? }                         -> { people: card[] }
//   get     { id }                               -> { person, source, events, enrolments }
//   update  { id, expected_version, patch, note? } -> { person } | 409 { current }
//   note    { id, note }                         -> { person }
//   today   {}                                   -> { due_people, calls_passed, sends_today }
//   call_outcome { id, expected_version, outcome: showed|no_show } -> { person, enrolment? }
//   sequences {}                                 -> { sequences (with steps and people in it now) }
//   step_edit { step_id, fields }                -> { step } (a new draft version)
//   step_approve { step_id }                     -> { step }      (admin role only)
//   sequence_toggle { sequence_id, active }      -> { sequence }
//   enrol { person_id, sequence_id }             -> { enrolment }
//   enrolment { enrolment_id, op: pause|resume|skip|stop } -> { enrolment }
//   systems {}                                   -> { automations, sequences }
// Server key only (the future n8n sender; never the browser):
//   due { dry_run?, limit? }                     -> { send[], held[], stopped[], completed[] }
//   log_send { enrolment_id, step_id, result: sent|failed|skipped, provider_id?, error? }
//   ingest  { event, person, source?, occurred_at?, call_at?, channel?, actor?, detail?, idempotency_key }
//           -> { person_id, created, duplicate?, stage, stopped_enrolments }
//           (n8n logs a form, booking, send or reply; docs/features/CRM_LEADS.md "Ingest")
// Nothing here sends a message. Every change writes crm_events in the same
// transaction (crm_apply_change, crm_enrol, crm_enrolment_apply).
//
// Server key: X-Crm-Sender-Key equal to the CRM_SENDER_KEY secret (unset =
// no server access), or Authorization: Bearer <service role key>.
//
// Deploy: by the merge lane once its migration is applied
// (docs/ops/EF_AUTO_DEPLOY.md). verify_jwt = false (supabase/config.toml).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { authorizeStaffKey, matchingRoleForKey, staffAuthFailureStatus, timingSafeEqual } from "../_shared/staff-role-auth.ts";
import {
  cardOf, changeEvents, effectivePatch, ingestPlan, isUuid, leadsAllowed, LIST_MAX, mergeForImport,
  normalizeEmail, normalizeHandle, normalizePhone, parseListFilters, validateIngest, validateNote, validatePatch,
} from "../_shared/crm-leads-core.mjs";
import {
  ENROLMENT_ACTIONS, evaluateEnrolment, sendEventKind, validateSendLog, validateStepEdit,
} from "../_shared/crm-sequences-core.mjs";
import { N8N_AUTOMATIONS, sequenceSystemRows } from "../_shared/crm-automations.mjs";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "https://syncview.synchrosocial.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role",
  "Cache-Control": "no-store",
};
const PERSON_COLUMNS =
  "id,display_name,email,phone,instagram_handle,lead_type,niche,source_id,stage,owner,next_step,next_step_due,lost_reason,tags,timezone,call_at,opted_out_at,state_version,created_at,updated_at";
const STEP_COLUMNS =
  "id,sequence_id,step_key,position,day_offset,hour_offset,send_hour,channel,audience,subject,template,version,is_current,approval_state,approved_by,approved_at,edited_by,created_at";
const SEQ_COLUMNS = "id,key,name,description,lead_type,stay_stages,active,toggled_by,updated_at";
const ENROL_COLUMNS =
  "id,person_id,sequence_id,status,paused,trigger_stage,sent_step_keys,skipped_step_keys,stop_reason,enrolled_by,enrolled_at,updated_at";
const SERVER_ACTIONS = ["due", "log_send", "ingest"];
const STOP_KINDS = ["reply", "booked", "opted_out"];

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

function errCode(e: unknown): string {
  return e instanceof Error && /^(read|write)_failed$/.test(e.message) ? e.message : "server_error";
}
function must<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw new Error("read_failed");
  return r.data;
}

/** The sender's key: the CRM_SENDER_KEY secret, or the service role key. */
function serverKeyOk(req: Request): boolean {
  const sender = (Deno.env.get("CRM_SENDER_KEY") || "").trim();
  const given = (req.headers.get("x-crm-sender-key") || "").trim();
  if (sender.length >= 24 && given && timingSafeEqual(given, sender)) return true;
  const service = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  return !!service && !!bearer && timingSafeEqual(bearer, service);
}

async function enrolmentRpc(db: SupabaseClient, id: string, patch: Record<string, unknown>, actor: string, event: unknown, requireActive: boolean) {
  const { data, error } = await db.rpc("crm_enrolment_apply", {
    p_id: id, p_patch: patch, p_actor: actor, p_event: event, p_require_active: requireActive,
  });
  if (error) throw new Error("write_failed");
  return Array.isArray(data) && data.length ? data[0] : null;
}
async function enrolRpc(db: SupabaseClient, personId: string, sequenceId: string, actor: string) {
  const { data, error } = await db.rpc("crm_enrol", { p_person: personId, p_sequence: sequenceId, p_actor: actor });
  if (error) throw new Error("write_failed");
  return Array.isArray(data) && data.length ? data[0] : null;
}

/** Everything the rules need for a set of active enrolments. */
async function loadEngine(db: SupabaseClient) {
  const enrolments = must(await db.from("crm_enrolments").select(ENROL_COLUMNS).eq("status", "active").limit(2000)) || [];
  const sequences = must(await db.from("crm_sequences").select(SEQ_COLUMNS)) || [];
  const steps = must(await db.from("crm_sequence_steps").select(STEP_COLUMNS).eq("is_current", true)) || [];
  const ids = Array.from(new Set(enrolments.map((e: any) => e.person_id)));
  const people: any[] = [];
  const events: any[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    people.push(...(must(await db.from("crm_people").select(PERSON_COLUMNS).in("id", chunk)) || []));
    events.push(...(must(await db.from("crm_events").select("person_id,kind,detail,occurred_at").in("person_id", chunk).in("kind", STOP_KINDS)) || []));
  }
  return { enrolments, sequences, steps, people, events };
}
function evaluateAll(eng: any, now: number) {
  const seqById = new Map(eng.sequences.map((s: any) => [s.id, s]));
  const personById = new Map(eng.people.map((p: any) => [p.id, p]));
  return eng.enrolments.map((en: any) => {
    const person: any = personById.get(en.person_id);
    const sequence: any = seqById.get(en.sequence_id);
    const r = evaluateEnrolment({
      sequence, steps: eng.steps, enrolment: en, person,
      events: eng.events.filter((e: any) => e.person_id === en.person_id), now,
    });
    return { enrolment: en, person, sequence, r };
  });
}

async function due(db: SupabaseClient, body: Record<string, unknown>) {
  const dryRun = body.dry_run !== false;   // a dry run unless the sender says false
  const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 500);
  const now = Date.now();
  const rows = evaluateAll(await loadEngine(db), now);
  const send: unknown[] = [];
  const held: unknown[] = [];
  const stopped: unknown[] = [];
  const completed: unknown[] = [];
  for (const { enrolment, person, sequence, r } of rows) {
    const ref = { enrolment_id: enrolment.id, person_id: enrolment.person_id, sequence: sequence ? sequence.key : null };
    if (r.state === "send" && send.length < limit) {
      send.push(Object.assign(ref, {
        step_id: r.step.id, step_key: r.step.step_key, step_version: r.step.version, channel: r.channel, to: r.to,
        subject: r.subject, body: r.body, needs: r.needs, due_at: r.due_at, timezone: r.timezone,
        display_name: person ? person.display_name : "",
      }));
    } else if (r.state === "hold") {
      held.push(Object.assign(ref, { step_key: r.step.step_key, reason: r.reason, due_at: r.due_at }));
    } else if (r.state === "stop") {
      stopped.push(Object.assign(ref, { reason: r.reason }));
      if (!dryRun) await enrolmentRpc(db, enrolment.id, { status: "stopped", stop_reason: r.reason }, "sequence rules", { kind: "enrolment_stopped", channel: "system", detail: { reason: r.reason } }, true);
    } else if (r.state === "complete") {
      completed.push(ref);
      if (!dryRun) await enrolmentRpc(db, enrolment.id, { status: "completed" }, "sequence rules", { kind: "enrolment_completed", channel: "system", detail: {} }, true);
    }
  }
  return json({ ok: true, dry_run: dryRun, now: new Date(now).toISOString(), send, held, stopped, completed });
}

async function logSend(db: SupabaseClient, body: Record<string, unknown>) {
  const enrolmentId = String(body.enrolment_id || "");
  const stepId = String(body.step_id || "");
  if (!isUuid(enrolmentId) || !isUuid(stepId)) return json({ ok: false, error: "bad_id" }, 400);
  const v = validateSendLog(body);
  if (!v.ok) return json({ ok: false, error: v.error }, 400);
  const step = must(await db.from("crm_sequence_steps").select(STEP_COLUMNS).eq("id", stepId).maybeSingle());
  if (!step) return json({ ok: false, error: "step_not_found" }, 404);
  const patch: Record<string, unknown> = v.result === "sent" ? { add_sent: step.step_key } : {};
  const event = { kind: sendEventKind(v.result), channel: step.channel, step_id: step.id, detail: Object.assign({ step_key: step.step_key, version: step.version }, v.detail) };
  const row = await enrolmentRpc(db, enrolmentId, patch, "n8n sender", event, false);
  if (!row) return json({ ok: false, error: "enrolment_not_found" }, 404);
  return json({ ok: true, enrolment: row });
}

/** Finds a person by normalised email, then phone, then handle. */
async function findPerson(db: SupabaseClient, p: Record<string, any>) {
  const keys: [string, string | null][] = [
    ["email_norm", normalizeEmail(p.email)], ["phone_norm", normalizePhone(p.phone)], ["handle_norm", normalizeHandle(p.instagram_handle)],
  ];
  const found: Record<string, any> = {};
  let first: any = null;
  for (const [col, val] of keys) {
    if (!val) continue;
    const row = must(await db.from("crm_people").select(PERSON_COLUMNS).eq(col, val).maybeSingle());
    found[col] = row ? row.id : null;
    if (row && !first) first = row;
  }
  return { person: first, owners: found };
}

async function sourceId(db: SupabaseClient, src: { name: string; kind: string } | null): Promise<string | null> {
  if (!src) return null;
  const read = async () => must(await db.from("crm_sources").select("id").eq("name", src.name).maybeSingle());
  const have = await read();
  if (have) return String(have.id);
  const { data, error } = await db.from("crm_sources").insert({ name: src.name, kind: src.kind }).select("id");
  if (!error && data && data.length) return String(data[0].id);
  const again = await read();   // a parallel ingest created it first
  if (again) return String(again.id);
  throw new Error("write_failed");
}

/** n8n logs one fact about a lead. Deduped on idempotency_key: the key is
 *  checked after reading the person's state_version, and the event is written
 *  by crm_apply_change on that version, so a parallel retry loses the
 *  compare-and-swap, re-reads and finds the key. Never logs contact details. */
async function ingest(db: SupabaseClient, body: Record<string, unknown>) {
  const v = validateIngest(body) as any;
  if (!v.ok) return json({ ok: false, error: v.error }, 400);
  const srcId = await sourceId(db, v.source);
  let created = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const found = await findPerson(db, v.person);
    const owners = found.owners;
    let person = found.person;
    if (!person) {
      const row: Record<string, unknown> = {
        display_name: v.person.display_name, email: v.person.email, phone: v.person.phone,
        instagram_handle: v.person.instagram_handle, timezone: v.person.timezone, lead_type: "ad_lead",
        source_id: srcId, tags: v.isTest ? ["test"] : [],
      };
      const { data, error } = await db.from("crm_people").insert(row).select(PERSON_COLUMNS);
      if (error || !data || !data.length) continue;   // lost a race on a unique key: look again
      person = data[0];
      created = true;
    } else {
      // Fill blanks only, and never with a value another person already holds.
      const fill: Record<string, unknown> = Object.assign({} as Record<string, unknown>, mergeForImport(person, { display_name: v.person.display_name, email: v.person.email, phone: v.person.phone, instagram_handle: v.person.instagram_handle, tags: [] }));
      delete fill.tags;
      if (fill.email && owners.email_norm && owners.email_norm !== person.id) delete fill.email;
      if (fill.phone && owners.phone_norm && owners.phone_norm !== person.id) delete fill.phone;
      if (fill.instagram_handle && owners.handle_norm && owners.handle_norm !== person.id) delete fill.instagram_handle;
      if (!person.source_id && srcId) fill.source_id = srcId;
      if (Object.keys(fill).length) {
        // Contact fill, compare-and-swap like scripts/crm-import.js; crm_apply_change
        // does not take contact columns. The ingest row below goes through it.
        const { data, error } = await db.from("crm_people")
          .update(Object.assign(fill, { state_version: person.state_version + 1, updated_at: new Date().toISOString() }))
          .eq("id", person.id).eq("state_version", person.state_version).select(PERSON_COLUMNS);
        if (error || !data || !data.length) continue;
        person = data[0];
      }
    }
    const dup = must(await db.from("crm_events").select("id").eq("person_id", person.id).eq("detail->>idempotency_key", v.key).limit(1));
    if (dup && dup.length) return json({ ok: true, duplicate: true, person_id: person.id, created: false, stage: person.stage, stopped_enrolments: 0 });
    const plan = ingestPlan(person, v);
    const events = created && person.state_version === 1
      ? [{ kind: "created", channel: "system", detail: { via: "ingest", event: v.event, source: v.source ? v.source.name : null } }, ...plan.events]
      : plan.events;
    const after = await apply(db, person.id, person.state_version, plan.patch, v.actor, events);
    if (!after) continue;
    let stopped = 0;
    if (plan.stopEnrolments) {
      const active = must(await db.from("crm_enrolments").select("id").eq("person_id", person.id).eq("status", "active")) || [];
      for (const en of active as any[]) {
        const r = await enrolmentRpc(db, en.id, { status: "stopped", stop_reason: "replied" }, "sequence rules", { kind: "enrolment_stopped", channel: "system", detail: { reason: "replied" } }, true);
        if (r) stopped++;
      }
    }
    console.log(JSON.stringify({ fn: "crm-leads", action: "ingest", event: v.event, created, stage_changed: "stage" in plan.patch, stopped }));
    return json({ ok: true, person_id: person.id, created, stage: after.stage, stopped_enrolments: stopped, test: v.isTest });
  }
  return json({ ok: false, error: "conflict" }, 409);
}

async function todayView(db: SupabaseClient) {
  const t = today();
  const nowIso = new Date().toISOString();
  const duePeople = must(await db.from("crm_people").select(PERSON_COLUMNS).lte("next_step_due", t).not("stage", "in", "(won,lost)")
    .order("next_step_due", { ascending: true }).limit(LIST_MAX)) || [];
  const calls = must(await db.from("crm_people").select(PERSON_COLUMNS).eq("stage", "call1_booked").lt("call_at", nowIso)
    .order("call_at", { ascending: true }).limit(200)) || [];
  const now = Date.now();
  const horizon = now + 86400000;
  const sends = evaluateAll(await loadEngine(db), now)
    .filter(({ r }: any) => (r.state === "send" || r.state === "hold" || r.state === "wait") && r.due_at && Date.parse(r.due_at) <= horizon)
    .map(({ enrolment, person, sequence, r }: any) => ({
      enrolment_id: enrolment.id, person_id: enrolment.person_id, display_name: person ? person.display_name : "",
      sequence: sequence ? sequence.name : "", step_key: r.step.step_key, channel: r.step.channel, due_at: r.due_at,
      state: r.state, reason: r.reason || "",
    }))
    .sort((a: any, b: any) => a.due_at.localeCompare(b.due_at));
  return json({
    ok: true,
    due_people: duePeople.map((r: any) => cardOf(r, t)),
    calls_passed: calls.map((r: any) => cardOf(r, t)),
    sends_today: sends,
  });
}

async function sequencesView(db: SupabaseClient) {
  const sequences = must(await db.from("crm_sequences").select(SEQ_COLUMNS).order("created_at", { ascending: true })) || [];
  const steps = must(await db.from("crm_sequence_steps").select(STEP_COLUMNS).eq("is_current", true)) || [];
  const active = must(await db.from("crm_enrolments").select("sequence_id").eq("status", "active").limit(5000)) || [];
  const counts: Record<string, number> = {};
  for (const e of active as any[]) counts[e.sequence_id] = (counts[e.sequence_id] || 0) + 1;
  return json({
    ok: true,
    sequences: (sequences as any[]).map((s) => Object.assign({}, s, {
      people_now: counts[s.id] || 0,
      steps: (steps as any[]).filter((st) => st.sequence_id === s.id).sort((a, b) => a.position - b.position || a.step_key.localeCompare(b.step_key)),
    })),
  });
}

async function systemsView(db: SupabaseClient) {
  const sequences = must(await db.from("crm_sequences").select(SEQ_COLUMNS).order("created_at", { ascending: true })) || [];
  const steps = must(await db.from("crm_sequence_steps").select(STEP_COLUMNS).eq("is_current", true)) || [];
  const active = must(await db.from("crm_enrolments").select("sequence_id").eq("status", "active").limit(5000)) || [];
  const counts: Record<string, number> = {};
  for (const e of active as any[]) counts[e.sequence_id] = (counts[e.sequence_id] || 0) + 1;
  return json({ ok: true, automations: N8N_AUTOMATIONS, sequences: sequenceSystemRows(sequences, steps, counts) });
}

async function stepEdit(db: SupabaseClient, body: Record<string, unknown>, actor: string) {
  const stepId = String(body.step_id || "");
  if (!isUuid(stepId)) return json({ ok: false, error: "bad_id" }, 400);
  const step = must(await db.from("crm_sequence_steps").select(STEP_COLUMNS).eq("id", stepId).maybeSingle());
  if (!step) return json({ ok: false, error: "not_found" }, 404);
  const v = validateStepEdit(body.fields, step.channel);
  if (!v.ok) return json({ ok: false, error: v.error }, 400);
  const { data, error } = await db.rpc("crm_step_new_version", { p_step_id: stepId, p_fields: v.fields, p_actor: actor });
  if (error) throw new Error("write_failed");
  const row = Array.isArray(data) && data.length ? data[0] : null;
  if (!row) {
    const current = must(await db.from("crm_sequence_steps").select(STEP_COLUMNS).eq("sequence_id", step.sequence_id).eq("step_key", step.step_key).eq("is_current", true).maybeSingle());
    return json({ ok: false, error: "conflict", current }, 409);
  }
  return json({ ok: true, step: row });
}

async function stepApprove(db: SupabaseClient, body: Record<string, unknown>, actor: string) {
  const stepId = String(body.step_id || "");
  if (!isUuid(stepId)) return json({ ok: false, error: "bad_id" }, 400);
  const { data, error } = await db.from("crm_sequence_steps")
    .update({ approval_state: "approved", approved_by: actor || null, approved_at: new Date().toISOString() })
    .eq("id", stepId).eq("is_current", true).eq("approval_state", "draft").select(STEP_COLUMNS);
  if (error) throw new Error("write_failed");
  if (!data || !data.length) {
    const row = must(await db.from("crm_sequence_steps").select(STEP_COLUMNS).eq("id", stepId).maybeSingle());
    if (!row) return json({ ok: false, error: "not_found" }, 404);
    if (row.approval_state === "approved" && row.is_current) return json({ ok: true, step: row, unchanged: true });
    return json({ ok: false, error: "conflict", current: row }, 409);
  }
  return json({ ok: true, step: data[0] });
}

async function sequenceToggle(db: SupabaseClient, body: Record<string, unknown>, actor: string) {
  const id = String(body.sequence_id || "");
  if (!isUuid(id)) return json({ ok: false, error: "bad_id" }, 400);
  if (typeof body.active !== "boolean") return json({ ok: false, error: "bad_active" }, 400);
  const { data, error } = await db.from("crm_sequences").update({ active: body.active, toggled_by: actor || null, updated_at: new Date().toISOString() })
    .eq("id", id).select(SEQ_COLUMNS);
  if (error) throw new Error("write_failed");
  if (!data || !data.length) return json({ ok: false, error: "not_found" }, 404);
  return json({ ok: true, sequence: data[0] });
}

async function enrol(db: SupabaseClient, body: Record<string, unknown>, actor: string) {
  const personId = String(body.person_id || "");
  const sequenceId = String(body.sequence_id || "");
  if (!isUuid(personId) || !isUuid(sequenceId)) return json({ ok: false, error: "bad_id" }, 400);
  const row = await enrolRpc(db, personId, sequenceId, actor);
  if (!row) return json({ ok: false, error: "already_enrolled_or_missing" }, 409);
  return json({ ok: true, enrolment: row });
}

async function enrolmentOp(db: SupabaseClient, body: Record<string, unknown>, actor: string) {
  const id = String(body.enrolment_id || "");
  const op = String(body.op || "");
  if (!isUuid(id)) return json({ ok: false, error: "bad_id" }, 400);
  if (!ENROLMENT_ACTIONS.includes(op)) return json({ ok: false, error: "bad_op" }, 400);
  let patch: Record<string, unknown> = {};
  let event: Record<string, unknown> = {};
  if (op === "pause") { patch = { paused: true }; event = { kind: "enrolment_paused", channel: "system", detail: {} }; }
  if (op === "resume") { patch = { paused: false }; event = { kind: "enrolment_resumed", channel: "system", detail: {} }; }
  if (op === "stop") { patch = { status: "stopped", stop_reason: "stopped_by_staff" }; event = { kind: "enrolment_stopped", channel: "system", detail: { reason: "stopped_by_staff" } }; }
  if (op === "skip") {
    const stepKey = String(body.step_key || "");
    if (!/^[a-z0-9_]{1,60}$/.test(stepKey)) return json({ ok: false, error: "bad_step_key" }, 400);
    patch = { add_skipped: stepKey };
    event = { kind: "step_skipped", channel: "system", detail: { step_key: stepKey } };
  }
  const row = await enrolmentRpc(db, id, patch, actor, event, true);
  if (!row) return json({ ok: false, error: "not_active" }, 409);
  return json({ ok: true, enrolment: row });
}

/** Showed / No-show on a call whose slot has passed: one stage change with a
 *  call_outcome event; a no-show is also enrolled in the No-show sequence
 *  (enrolment only: the sequence sends nothing while it is off or a draft). */
async function callOutcome(db: SupabaseClient, id: string, body: Record<string, unknown>, actor: string) {
  const outcome = String(body.outcome || "");
  if (outcome !== "showed" && outcome !== "no_show") return json({ ok: false, error: "bad_outcome" }, 400);
  const expected = Number(body.expected_version);
  if (!Number.isInteger(expected) || expected < 1) return json({ ok: false, error: "bad_expected_version" }, 400);
  const before = await readPerson(db, id);
  if (!before) return json({ ok: false, error: "not_found" }, 404);
  if (before.state_version !== expected) return json({ ok: false, error: "conflict", current: before }, 409);
  const stage = outcome === "showed" ? "call1_done" : "no_show";
  const events = [{ kind: "call_outcome", channel: "call", detail: { outcome, call_at: before.call_at || null } },
    ...changeEvents(before, effectivePatch(before, { stage }), "")];
  const after = await apply(db, id, expected, { stage }, actor, events);
  if (!after) {
    const current = await readPerson(db, id);
    return current ? json({ ok: false, error: "conflict", current }, 409) : json({ ok: false, error: "not_found" }, 404);
  }
  let enrolment = null;
  if (outcome === "no_show") {
    const seq = must(await db.from("crm_sequences").select("id").eq("key", "no_show").maybeSingle());
    if (seq) enrolment = await enrolRpc(db, id, seq.id, actor);
  }
  return json({ ok: true, person: after, enrolment });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }
  const action = String(body.action || "");

  // The sender's server actions take only the server key; everything else
  // takes only a staff role key with Leads access.
  if (SERVER_ACTIONS.includes(action)) {
    if (!serverKeyOk(req)) return json({ ok: false, error: "unauthorized" }, 401);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    try {
      if (action === "ingest") return await ingest(db, body);
      return action === "due" ? await due(db, body) : await logSend(db, body);
    } catch (e) {
      return json({ ok: false, error: errCode(e) }, 500);
    }
  }

  const key = (req.headers.get("x-syncview-key") || "").trim();
  const actor = (req.headers.get("x-syncview-actor") || "").trim().slice(0, 80);
  // Any recognised role key authenticates; leadsAllowed decides (role matrix
  // plus the per-person grants documented in crm-leads-core.mjs).
  const auth = authorizeStaffKey(key, ["admin", "smm", "creative"]);
  if (!auth.ok || auth.via !== "role") return json({ ok: false, error: "unauthorized" }, staffAuthFailureStatus(auth));
  const role = matchingRoleForKey(key);
  if (!leadsAllowed(role, actor)) return json({ ok: false, error: "forbidden" }, 403);
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

    if (action === "today") return await todayView(db);
    if (action === "sequences") return await sequencesView(db);
    if (action === "systems") return await systemsView(db);
    if (action === "step_edit") return await stepEdit(db, body, actor);
    if (action === "step_approve") {
      if (role !== "admin") return json({ ok: false, error: "admin_only" }, 403);
      return await stepApprove(db, body, actor);
    }
    if (action === "sequence_toggle") return await sequenceToggle(db, body, actor);
    if (action === "enrol") return await enrol(db, body, actor);
    if (action === "enrolment") return await enrolmentOp(db, body, actor);

    const id = String(body.id || "");
    if (!isUuid(id)) return json({ ok: false, error: "bad_id" }, 400);

    if (action === "call_outcome") return await callOutcome(db, id, body, actor);

    if (action === "get") {
      const person = await readPerson(db, id);
      if (!person) return json({ ok: false, error: "not_found" }, 404);
      const [{ data: events }, { data: source }, { data: enrolments }] = await Promise.all([
        db.from("crm_events").select("id,kind,channel,actor,detail,occurred_at").eq("person_id", id)
          .order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(200),
        person.source_id
          ? db.from("crm_sources").select("id,name,kind,link").eq("id", person.source_id).maybeSingle()
          : Promise.resolve({ data: null }),
        db.from("crm_enrolments").select(ENROL_COLUMNS).eq("person_id", id).order("enrolled_at", { ascending: false }).limit(20),
      ]);
      return json({ ok: true, person, source: source || null, events: events || [], enrolments: enrolments || [] });
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
    return json({ ok: false, error: errCode(e) }, 500);
  }
});
