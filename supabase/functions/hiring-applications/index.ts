// Supabase Edge Function: hiring-applications
//
// Admin-only read/decision API for SyncView's Hiring Process tab. iClosed
// remains the applicant-facing application system; this function exposes only
// the private operational mirror and creates a durable email-delivery job.
// It never sends email, calls iClosed, or accepts recipient/link values from
// the browser. A separate, isolated dispatcher will claim queued jobs and
// record the actual provider receipt before an application is marked invited.

import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.49.8";
import {
  authorizeStaffKey,
  staffAuthFailureStatus,
} from "../_shared/staff-role-auth.ts";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "https://syncview.synchrosocial.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role",
  "Cache-Control": "no-store",
};

const APPLICATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APPLICATION_STATUSES = new Set([
  "new",
  "reviewing",
  "hold",
  "rejected",
  "invited",
  "interview_booked",
  "withdrawn",
]);
const REVIEWER_STATUSES = new Set(["reviewing", "hold", "rejected"]);
const RETRYABLE_FAILURE_CODES = new Set([
  "pre_send_provider_unavailable",
  "pre_send_configuration",
]);
const SAFE_FAILURE_CODES = new Set([
  ...RETRYABLE_FAILURE_CODES,
  "provider_timeout",
  "provider_ambiguous",
  "dispatch_timeout",
]);
const MAX_LIST_LIMIT = 100;
const EXPECTED_INTERVIEW_EVENT_URL =
  "https://app.iclosed.io/e/synchrosocial/client-success-content-manager-interview";

type JsonMap = Record<string, unknown>;
type ApplicationRow = {
  id: string;
  name: string;
  email: string;
  location: string | null;
  when_can_start: string | null;
  answers: unknown;
  video_url: string | null;
  iclosed_preview_url: string | null;
  status: string;
  state_version: number;
  submitted_at: string;
  updated_at: string;
  hiring_invite_jobs?: unknown;
};
type InviteJobRow = {
  state: string;
  updated_at?: string | null;
  failure_code?: string | null;
  provider_message_id?: string | null;
};
type InvitePreview = {
  recipient: string;
  subject: string;
  body: string;
};

class HiringApplicationsError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function clean(value: unknown): string {
  return String(value == null ? "" : value).trim();
}

function serviceClient(): SupabaseClient {
  const url = clean(Deno.env.get("SUPABASE_URL"));
  const key = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!url || !key) {
    throw new HiringApplicationsError(503, "service_unavailable");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requestBody(req: Request): Promise<JsonMap> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch (_error) {
    throw new HiringApplicationsError(400, "invalid_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HiringApplicationsError(400, "invalid_body");
  }
  return parsed as JsonMap;
}

function requireAction(body: JsonMap): string {
  const action = clean(body.action).toLowerCase();
  if (!["list", "detail", "set_status", "queue_invite", "retry_invite"].includes(action)) {
    throw new HiringApplicationsError(400, "invalid_action");
  }
  return action;
}

function requireApplicationId(value: unknown): string {
  const id = clean(value);
  if (!APPLICATION_ID.test(id)) {
    throw new HiringApplicationsError(400, "invalid_application_id");
  }
  return id;
}

function requireStateVersion(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(clean(value));
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new HiringApplicationsError(400, "invalid_state_version");
  }
  return parsed;
}

function parseListStatus(value: unknown): string | null {
  if (value === null || value === undefined || clean(value) === "") return null;
  const status = clean(value).toLowerCase();
  if (!APPLICATION_STATUSES.has(status)) {
    throw new HiringApplicationsError(400, "invalid_status");
  }
  return status;
}

function parseLimit(value: unknown): number {
  if (value === null || value === undefined || clean(value) === "") return 50;
  const parsed = typeof value === "number" ? value : Number(clean(value));
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_LIST_LIMIT) {
    throw new HiringApplicationsError(400, "invalid_limit");
  }
  return parsed;
}

function configuredInterviewEventUrl(): string | null {
  const configured = clean(Deno.env.get("HIRING_INTERVIEW_EVENT_URL"));
  if (!configured) return null;
  try {
    const url = new URL(configured);
    const normalized = url.href.replace(/\/$/, "");
    return normalized === EXPECTED_INTERVIEW_EVENT_URL ? normalized : null;
  } catch (_error) {
    return null;
  }
}

function firstName(value: unknown): string {
  const name = clean(value);
  return name ? name.split(/\s+/)[0] : "there";
}

function buildInvitePreview(
  application: ApplicationRow,
  interviewUrl = configuredInterviewEventUrl(),
): InvitePreview | null {
  const recipient = clean(application.email).toLowerCase();
  if (!interviewUrl || !recipient || !recipient.includes("@")) return null;

  return {
    recipient,
    subject: "We'd love to speak with you — Synchro Social",
    body: [
      `Hi ${firstName(application.name)},`,
      "",
      "Thank you for taking the time to apply for the Client Success & Content Manager role at Synchro Social.",
      "",
      "We enjoyed learning more about you and would love to speak with you. If you're still interested, choose a time that works for you here:",
      "",
      interviewUrl,
      "",
      "Looking forward to it,",
      "Synchro Social",
    ].join("\n"),
  };
}

function inviteJob(value: unknown): InviteJobRow | null {
  const row = value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonMap
    : null;
  if (row) return row as InviteJobRow;
  if (!Array.isArray(value)) return null;
  const job = value.find((item) => item && typeof item === "object") as JsonMap | undefined;
  return job ? job as InviteJobRow : null;
}

function inviteState(value: unknown): string | null {
  return clean(inviteJob(value)?.state).toLowerCase() || null;
}

function safeFailureCode(value: unknown): string | null {
  const code = clean(value).toLowerCase();
  return SAFE_FAILURE_CODES.has(code) ? code : null;
}

function applicationListItem(row: ApplicationRow): JsonMap {
  return {
    id: clean(row.id),
    name: clean(row.name),
    email: clean(row.email),
    location: row.location == null ? null : clean(row.location),
    status: clean(row.status).toLowerCase(),
    state_version: Number(row.state_version),
    submitted_at: clean(row.submitted_at),
    updated_at: clean(row.updated_at),
    video_present: !!clean(row.video_url),
    invite_state: inviteState(row.hiring_invite_jobs),
  };
}

function applicationDetail(
  row: ApplicationRow,
  invitesEnabled: boolean,
): JsonMap {
  const job = inviteJob(row.hiring_invite_jobs);
  const jobState = clean(job?.state).toLowerCase() || null;
  const failureCode = safeFailureCode(job?.failure_code);
  const preview = buildInvitePreview(row);
  return {
    id: clean(row.id),
    name: clean(row.name),
    email: clean(row.email),
    location: row.location == null ? null : clean(row.location),
    when_can_start: row.when_can_start == null ? null : clean(row.when_can_start),
    answers: row.answers && typeof row.answers === "object" ? row.answers : [],
    video_url: row.video_url == null ? null : clean(row.video_url),
    iclosed_preview_url: row.iclosed_preview_url == null ? null : clean(row.iclosed_preview_url),
    status: clean(row.status).toLowerCase(),
    state_version: Number(row.state_version),
    submitted_at: clean(row.submitted_at),
    updated_at: clean(row.updated_at),
    invite_state: jobState,
    invite_failure_code: failureCode,
    retry_available: invitesEnabled
      && jobState === "failed"
      && !clean(job?.provider_message_id)
      && !!failureCode
      && RETRYABLE_FAILURE_CODES.has(failureCode),
    invites_enabled: invitesEnabled,
    invite_preview: preview,
  };
}

function rpcError(error: unknown): never {
  const raw = error && typeof error === "object" ? error as JsonMap : {};
  const message = clean(raw.message);
  const known: Record<string, [number, string]> = {
    application_not_found: [404, "application_not_found"],
    state_conflict: [409, "state_conflict"],
    feature_disabled: [503, "feature_disabled"],
    invalid_event: [400, "invalid_event"],
    invalid_status: [400, "invalid_status"],
    invalid_actor: [400, "invalid_actor"],
    invalid_invite: [400, "invalid_invite"],
    invalid_interview_event: [503, "interview_event_not_configured"],
    recipient_conflict: [409, "state_conflict"],
    invite_pending: [409, "state_conflict"],
    retry_not_available: [409, "state_conflict"],
    terminal_status: [409, "state_conflict"],
  };
  const match = known[message];
  if (match) throw new HiringApplicationsError(match[0], match[1]);
  throw new HiringApplicationsError(503, "service_unavailable");
}

async function invitesEnabled(db: SupabaseClient): Promise<boolean> {
  const { data, error } = await db
    .from("syncview_runtime_flags")
    .select("value")
    .eq("key", "hiring_invites_enabled")
    .maybeSingle();
  if (error) throw new HiringApplicationsError(503, "service_unavailable");
  const row = data as JsonMap | null;
  const value = row && row.value && typeof row.value === "object" && !Array.isArray(row.value)
    ? row.value as JsonMap
    : null;
  return value?.enabled === true;
}

async function listApplications(
  db: SupabaseClient,
  status: string | null,
  limit: number,
): Promise<JsonMap[]> {
  let query = db
    .from("hiring_applications")
    .select("id,name,email,location,status,state_version,submitted_at,updated_at,video_url,hiring_invite_jobs(state,updated_at)")
    .order("submitted_at", { ascending: false })
    .limit(limit);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error || !Array.isArray(data)) {
    throw new HiringApplicationsError(503, "service_unavailable");
  }
  return data.map((row) => applicationListItem(row as ApplicationRow));
}

async function getApplication(db: SupabaseClient, id: string): Promise<ApplicationRow> {
  const { data, error } = await db
    .from("hiring_applications")
    .select("id,name,email,location,when_can_start,answers,video_url,iclosed_preview_url,status,state_version,submitted_at,updated_at,hiring_invite_jobs(state,updated_at,failure_code,provider_message_id)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new HiringApplicationsError(503, "service_unavailable");
  if (!data) throw new HiringApplicationsError(404, "application_not_found");
  return data as ApplicationRow;
}

async function setStatus(
  db: SupabaseClient,
  applicationId: string,
  stateVersion: number,
  status: string,
): Promise<JsonMap> {
  if (!REVIEWER_STATUSES.has(status)) {
    throw new HiringApplicationsError(400, "invalid_status");
  }
  const { data, error } = await db.rpc("hiring_set_application_status_v1", {
    p_application_id: applicationId,
    p_expected_state_version: stateVersion,
    p_status: status,
    // The admin role key is the authorization boundary. Do not accept a
    // browser-supplied actor header as the audit identity.
    p_actor: "staff-admin",
  });
  if (error) rpcError(error);
  const result = Array.isArray(data) ? data[0] as JsonMap | undefined : data as JsonMap | null;
  if (!result) throw new HiringApplicationsError(503, "service_unavailable");
  return {
    application_id: clean(result.application_id),
    status: clean(result.status),
    state_version: Number(result.state_version),
  };
}

async function queueInvite(
  db: SupabaseClient,
  applicationId: string,
  stateVersion: number,
): Promise<JsonMap> {
  if (!await invitesEnabled(db)) {
    throw new HiringApplicationsError(503, "feature_disabled");
  }
  const application = await getApplication(db, applicationId);
  const interviewUrl = configuredInterviewEventUrl();
  const preview = buildInvitePreview(application, interviewUrl);
  if (!preview || !interviewUrl) {
    throw new HiringApplicationsError(503, "interview_event_not_configured");
  }
  const { data, error } = await db.rpc("hiring_queue_interview_invite_v1", {
    p_application_id: applicationId,
    p_expected_state_version: stateVersion,
    p_recipient_email: preview.recipient,
    p_subject: preview.subject,
    p_body: preview.body,
    p_interview_event_url: interviewUrl,
    p_actor: "staff-admin",
  });
  if (error) rpcError(error);
  const result = Array.isArray(data) ? data[0] as JsonMap | undefined : data as JsonMap | null;
  if (!result) throw new HiringApplicationsError(503, "service_unavailable");
  return {
    job_id: clean(result.job_id),
    state: clean(result.job_state),
    existing: result.existing === true,
  };
}

async function retryInvite(
  db: SupabaseClient,
  applicationId: string,
  stateVersion: number,
): Promise<JsonMap> {
  if (!await invitesEnabled(db)) {
    throw new HiringApplicationsError(503, "feature_disabled");
  }
  const { data, error } = await db.rpc("hiring_retry_failed_invite_v1", {
    p_application_id: applicationId,
    p_expected_state_version: stateVersion,
    p_actor: "staff-admin",
  });
  if (error) rpcError(error);
  const result = Array.isArray(data) ? data[0] as JsonMap | undefined : data as JsonMap | null;
  if (!result) throw new HiringApplicationsError(503, "service_unavailable");
  return {
    job_id: clean(result.job_id),
    state: clean(result.job_state),
    state_version: Number(result.state_version),
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  // Authenticate before parsing request content or creating the service-role
  // client. The actor/role headers are only browser metadata and never take
  // part in the authorization decision.
  const auth = authorizeStaffKey(clean(req.headers.get("x-syncview-key")), ["admin"]);
  if (!auth.ok) {
    return json(
      { ok: false, error: auth.role ? "forbidden" : "unauthorized" },
      staffAuthFailureStatus(auth),
    );
  }

  try {
    const body = await requestBody(req);
    const action = requireAction(body);
    const db = serviceClient();

    if (action === "list") {
      const status = parseListStatus(body.status);
      const limit = parseLimit(body.limit);
      const applications = await listApplications(db, status, limit);
      return json({ ok: true, applications });
    }

    const applicationId = requireApplicationId(body.application_id);
    if (action === "detail") {
      const [application, enabled] = await Promise.all([
        getApplication(db, applicationId),
        invitesEnabled(db),
      ]);
      return json({ ok: true, application: applicationDetail(application, enabled) });
    }

    const stateVersion = requireStateVersion(body.state_version);
    if (action === "set_status") {
      const status = clean(body.status).toLowerCase();
      const result = await setStatus(db, applicationId, stateVersion, status);
      return json({ ok: true, ...result, message: "Status updated." });
    }

    const result = action === "retry_invite"
      ? await retryInvite(db, applicationId, stateVersion)
      : await queueInvite(db, applicationId, stateVersion);
    return json({
      ok: true,
      ...result,
      message: action === "retry_invite"
        ? "Interview invitation requeued for delivery."
        : (result.existing
          ? "An interview invitation is already awaiting delivery."
          : "Interview invitation queued for delivery."),
    });
  } catch (error) {
    if (error instanceof HiringApplicationsError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    // Do not disclose database/provider details or applicant data to the
    // browser. Operational debugging belongs in the protected runtime logs.
    return json({ ok: false, error: "service_unavailable" }, 503);
  }
});
