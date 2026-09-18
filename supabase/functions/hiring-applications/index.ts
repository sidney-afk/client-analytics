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
const ROLE_SLUGS = new Set(["client-success-content-manager", "video-editor"]);
const EXPECTED_INTERVIEW_EVENT_URL: Record<string, string> = {
  "client-success-content-manager":
    "https://app.iclosed.io/e/synchrosocial/client-success-content-manager-interview",
  "video-editor":
    "https://app.iclosed.io/e/synchrosocial/video-editor-interview",
};
const INTERVIEW_EVENT_URL_ENV: Record<string, string> = {
  "client-success-content-manager": "HIRING_INTERVIEW_EVENT_URL",
  "video-editor": "HIRING_INTERVIEW_EVENT_URL_VIDEO_EDITOR",
};
// Not a secret: this exact link already goes out in every Video Editor
// practical-test email, so there's nothing gained by keeping it out of the
// (public) repo. Hardcoded rather than env-configured for that reason.
const PRACTICAL_TEST_MATERIALS_URL =
  "https://drive.google.com/drive/folders/13eNElkoiwGAzykWDLDuqHI-ntR9oeiCc?usp=sharing";

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
  role_slug: string | null;
  practical_test_verdict: string | null;
  state_version: number;
  submitted_at: string;
  updated_at: string;
  hiring_invite_jobs?: unknown;
  hiring_practical_test_jobs?: unknown;
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
type PracticalTestPreview = {
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
  if (![
    "list", "detail", "set_status", "queue_invite", "retry_invite",
    "queue_practical_test", "retry_practical_test", "set_practical_test_verdict",
  ].includes(action)) {
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

function parseListRole(value: unknown): string | null {
  if (value === null || value === undefined || clean(value) === "") return null;
  const role = clean(value).toLowerCase();
  if (!ROLE_SLUGS.has(role)) {
    throw new HiringApplicationsError(400, "invalid_role");
  }
  return role;
}

function applicationRole(application: ApplicationRow): string {
  const role = clean(application.role_slug).toLowerCase();
  return ROLE_SLUGS.has(role) ? role : "client-success-content-manager";
}

function configuredInterviewEventUrl(roleSlug: string): string | null {
  const envName = INTERVIEW_EVENT_URL_ENV[roleSlug];
  const expected = EXPECTED_INTERVIEW_EVENT_URL[roleSlug];
  if (!envName || !expected) return null;
  const configured = clean(Deno.env.get(envName));
  if (!configured) return null;
  try {
    const url = new URL(configured);
    const normalized = url.href.replace(/\/$/, "");
    return normalized === expected ? normalized : null;
  } catch (_error) {
    return null;
  }
}

function firstName(value: unknown): string {
  const name = clean(value);
  return name ? name.split(/\s+/)[0] : "there";
}

// Applicant-supplied text (name) is rendered into an HTML email body, so it
// must be escaped -- the same discipline the n8n side already applies to
// applicant-supplied fields in its own HTML/Telegram messages.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const EMAIL_LOGO_URL = "https://synchrosocial.com/images/logo.png";

function emailHtml(firstNameValue: string, paragraphs: string[], signOff: string): string {
  const body = paragraphs.map((paragraph) => `<p style="margin: 21px 0;">${paragraph}</p>`).join("");
  return [
    '<div style="line-height: 1.4; font-family: Arial, sans-serif;">',
    '<div style="padding-bottom: 14px; border-bottom: 1px solid #eeeeee; margin-bottom: 22px;">',
    `<img src="${EMAIL_LOGO_URL}" alt="Synchro Social" width="84" height="84" style="display: block;"/>`,
    "</div>",
    `<p>Hi ${escapeHtml(firstNameValue)},</p>`,
    body,
    `<p style="margin: 21px 0 0 0;">${signOff}</p>`,
    '<table cellpadding="0" cellspacing="0" border="0" style="margin-top: 12px;"><tr>',
    `<td style="padding-right: 12px; vertical-align: middle;"><img src="${EMAIL_LOGO_URL}" alt="Synchro Social" width="48" height="48" style="display: block;"/></td>`,
    '<td style="border-left: 2px solid #A020F0; padding-left: 12px; vertical-align: middle; line-height: 1.5;">',
    '<strong style="color: #111111;">The Synchro Social Team</strong><br>',
    '<a href="https://www.synchrosocial.com" style="color: #A020F0; text-decoration: none;">synchrosocial.com</a>',
    "</td></tr></table>",
    "</div>",
  ].join("");
}

function buildInvitePreview(
  application: ApplicationRow,
  interviewUrl = configuredInterviewEventUrl(applicationRole(application)),
): InvitePreview | null {
  const recipient = clean(application.email).toLowerCase();
  if (!interviewUrl || !recipient || !recipient.includes("@")) return null;
  const roleLabel = applicationRole(application) === "video-editor"
    ? "Video Editor"
    : "Client Success & Content Manager";
  const introLine = applicationRole(application) === "video-editor"
    ? "Thank you for completing the practical test for the Video Editor role at Synchro Social."
    : `Thank you for taking the time to apply for the ${roleLabel} role at Synchro Social.`;

  return {
    recipient,
    subject: "We'd love to speak with you — Synchro Social",
    body: emailHtml(firstName(application.name), [
      introLine,
      `We enjoyed learning more about you and would love to speak with you. If you're still interested, choose a time that works for you here: <a href="${interviewUrl}">${interviewUrl}</a>`,
    ], "Looking forward to it,"),
  };
}

function buildPracticalTestPreview(
  application: ApplicationRow,
): PracticalTestPreview | null {
  const recipient = clean(application.email).toLowerCase();
  if (!recipient || !recipient.includes("@")) return null;
  return {
    recipient,
    subject: "Your practical test — Video Editor at Synchro Social",
    body: emailHtml(firstName(application.name), [
      "Thanks for applying for the Video Editor role at Synchro Social. The next step is a short practical test.",
      `The raw footage and a reference edit (so you can see the result we're looking for) are both in this shared folder: <a href="${PRACTICAL_TEST_MATERIALS_URL}">${PRACTICAL_TEST_MATERIALS_URL}</a>`,
      "Watch the reference edit, then re-cut the raw footage to match its pacing, structure, and hook style as closely as you can.",
      'When you\'re done, upload your finished cut to a new Google Drive folder, turn on link sharing (set to "Anyone with the link" as Viewer), and reply to this email with that link.',
    ], "Looking forward to seeing what you make,"),
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
    role_slug: applicationRole(row),
    state_version: Number(row.state_version),
    submitted_at: clean(row.submitted_at),
    updated_at: clean(row.updated_at),
    video_present: !!clean(row.video_url),
    invite_state: inviteState(row.hiring_invite_jobs),
    practical_test_state: inviteState(row.hiring_practical_test_jobs),
  };
}

function applicationDetail(
  row: ApplicationRow,
  invitesEnabled: boolean,
  practicalTestsEnabled: boolean,
): JsonMap {
  const job = inviteJob(row.hiring_invite_jobs);
  const jobState = clean(job?.state).toLowerCase() || null;
  const failureCode = safeFailureCode(job?.failure_code);
  const preview = buildInvitePreview(row);
  const role = applicationRole(row);
  const practicalTestJob = inviteJob(row.hiring_practical_test_jobs) as unknown as
    (InviteJobRow & { raw_footage_url?: string | null; reference_edit_url?: string | null; subject?: string | null; body?: string | null })
    | null;
  const practicalTestState = clean(practicalTestJob?.state).toLowerCase() || null;
  const practicalTestFailureCode = safeFailureCode(practicalTestJob?.failure_code);
  const verdict = clean(row.practical_test_verdict).toLowerCase() || null;
  const practicalTestPreview = role === "video-editor" ? buildPracticalTestPreview(row) : null;
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
    role_slug: role,
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
    practical_tests_enabled: practicalTestsEnabled,
    practical_test_preview: practicalTestPreview,
    practical_test_state: practicalTestState,
    practical_test_failure_code: practicalTestFailureCode,
    practical_test_retry_available: practicalTestsEnabled
      && practicalTestState === "failed"
      && !clean(practicalTestJob?.provider_message_id)
      && !!practicalTestFailureCode
      && RETRYABLE_FAILURE_CODES.has(practicalTestFailureCode),
    practical_test_verdict: verdict,
    // The exact subject/body already stored on the job — not recomputed from
    // current config — for every state once a job exists. A retry resends
    // this stored payload verbatim, so the preview shown for a failed job
    // must be this, never a freshly-built preview that could differ if the
    // configured materials link changed after the job was queued.
    practical_test_job_preview: practicalTestJob
      ? { subject: clean(practicalTestJob.subject), body: clean(practicalTestJob.body) }
      : null,
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
    wrong_role: [409, "wrong_role"],
    practical_test_required: [409, "practical_test_required"],
    practical_test_not_delivered: [409, "practical_test_not_delivered"],
    invalid_verdict: [400, "invalid_verdict"],
  };
  const match = known[message];
  if (match) throw new HiringApplicationsError(match[0], match[1]);
  throw new HiringApplicationsError(503, "service_unavailable");
}

async function runtimeFlagEnabled(db: SupabaseClient, key: string): Promise<boolean> {
  const { data, error } = await db
    .from("syncview_runtime_flags")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new HiringApplicationsError(503, "service_unavailable");
  const row = data as JsonMap | null;
  const value = row && row.value && typeof row.value === "object" && !Array.isArray(row.value)
    ? row.value as JsonMap
    : null;
  return value?.enabled === true;
}

async function invitesEnabled(db: SupabaseClient): Promise<boolean> {
  return runtimeFlagEnabled(db, "hiring_invites_enabled");
}

async function practicalTestsEnabled(db: SupabaseClient): Promise<boolean> {
  return runtimeFlagEnabled(db, "hiring_practical_tests_enabled");
}

async function listApplications(
  db: SupabaseClient,
  status: string | null,
  role: string | null,
  limit: number,
): Promise<JsonMap[]> {
  let query = db
    .from("hiring_applications")
    .select("id,name,email,location,status,role_slug,state_version,submitted_at,updated_at,video_url,hiring_invite_jobs(state,updated_at),hiring_practical_test_jobs(state,updated_at)")
    .order("submitted_at", { ascending: false })
    .limit(limit);
  if (status) query = query.eq("status", status);
  if (role) query = query.eq("role_slug", role);
  const { data, error } = await query;
  if (error || !Array.isArray(data)) {
    throw new HiringApplicationsError(503, "service_unavailable");
  }
  return data.map((row) => applicationListItem(row as ApplicationRow));
}

async function getApplication(db: SupabaseClient, id: string): Promise<ApplicationRow> {
  const { data, error } = await db
    .from("hiring_applications")
    .select("id,name,email,location,when_can_start,answers,video_url,iclosed_preview_url,status,role_slug,practical_test_verdict,state_version,submitted_at,updated_at,hiring_invite_jobs(state,updated_at,failure_code,provider_message_id),hiring_practical_test_jobs(state,updated_at,failure_code,provider_message_id,subject,body,raw_footage_url,reference_edit_url)")
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
  const interviewUrl = configuredInterviewEventUrl(applicationRole(application));
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

// Video Editor round 2. The shared materials link is a fixed constant, never
// accepted from the browser — the same link and instructions go out for
// every applicant, so there is nothing per-applicant left to type.
async function queuePracticalTest(
  db: SupabaseClient,
  applicationId: string,
  stateVersion: number,
): Promise<JsonMap> {
  if (!await practicalTestsEnabled(db)) {
    throw new HiringApplicationsError(503, "feature_disabled");
  }
  const application = await getApplication(db, applicationId);
  if (applicationRole(application) !== "video-editor") {
    throw new HiringApplicationsError(409, "wrong_role");
  }
  const preview = buildPracticalTestPreview(application);
  if (!preview) throw new HiringApplicationsError(400, "invalid_invite");
  const { data, error } = await db.rpc("hiring_queue_practical_test_v1", {
    p_application_id: applicationId,
    p_expected_state_version: stateVersion,
    p_recipient_email: preview.recipient,
    p_subject: preview.subject,
    p_body: preview.body,
    p_raw_footage_url: PRACTICAL_TEST_MATERIALS_URL,
    p_reference_edit_url: PRACTICAL_TEST_MATERIALS_URL,
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

async function retryPracticalTest(
  db: SupabaseClient,
  applicationId: string,
  stateVersion: number,
): Promise<JsonMap> {
  if (!await practicalTestsEnabled(db)) {
    throw new HiringApplicationsError(503, "feature_disabled");
  }
  const { data, error } = await db.rpc("hiring_retry_failed_practical_test_v1", {
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

async function setPracticalTestVerdict(
  db: SupabaseClient,
  applicationId: string,
  stateVersion: number,
  verdict: string,
): Promise<JsonMap> {
  if (!["passed", "not_selected"].includes(verdict)) {
    throw new HiringApplicationsError(400, "invalid_verdict");
  }
  const { data, error } = await db.rpc("hiring_set_practical_test_verdict_v1", {
    p_application_id: applicationId,
    p_expected_state_version: stateVersion,
    p_verdict: verdict,
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
      const role = parseListRole(body.role);
      const limit = parseLimit(body.limit);
      const applications = await listApplications(db, status, role, limit);
      return json({ ok: true, applications });
    }

    const applicationId = requireApplicationId(body.application_id);
    if (action === "detail") {
      const [application, enabled, practicalEnabled] = await Promise.all([
        getApplication(db, applicationId),
        invitesEnabled(db),
        practicalTestsEnabled(db),
      ]);
      return json({ ok: true, application: applicationDetail(application, enabled, practicalEnabled) });
    }

    const stateVersion = requireStateVersion(body.state_version);
    if (action === "set_status") {
      const status = clean(body.status).toLowerCase();
      const result = await setStatus(db, applicationId, stateVersion, status);
      return json({ ok: true, ...result, message: "Status updated." });
    }
    if (action === "set_practical_test_verdict") {
      const verdict = clean(body.verdict).toLowerCase();
      const result = await setPracticalTestVerdict(db, applicationId, stateVersion, verdict);
      return json({ ok: true, ...result, message: "Practical test verdict recorded." });
    }
    if (action === "queue_practical_test") {
      const result = await queuePracticalTest(db, applicationId, stateVersion);
      return json({
        ok: true,
        ...result,
        message: result.existing
          ? "A practical test is already awaiting delivery."
          : "Practical test queued for delivery.",
      });
    }
    if (action === "retry_practical_test") {
      const result = await retryPracticalTest(db, applicationId, stateVersion);
      return json({ ok: true, ...result, message: "Practical test requeued for delivery." });
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
