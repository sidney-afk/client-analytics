// Supabase Edge Function: hiring-automation
//
// Private bridge for the isolated n8n hiring workflows. It accepts only a
// dedicated server-to-server key, owns the service-role database calls, and
// never accepts a recipient, event URL, or delivery status from a browser.
// iClosed payload normalization and Gmail/Slack/Telegram provider work stay in
// n8n; this function enforces the narrow database contracts on their boundary.

import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.49.8";

const MAX_BODY_BYTES = 128 * 1024;
const MAX_TEXT_LENGTH = 8_000;
const APPLICATION_EVENT_SLUG = "client-success-content-manager-application";
const INTERVIEW_EVENT_SLUG = "client-success-content-manager-interview";
const DISPATCHER_WORKER_ID = "hiring-invite-dispatch-v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FAILURE_CODES = new Set([
  "pre_send_provider_unavailable",
  "pre_send_configuration",
  "provider_timeout",
  "provider_ambiguous",
]);

type JsonMap = Record<string, unknown>;

class AutomationError extends Error {
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
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function clean(value: unknown): string {
  return String(value == null ? "" : value).trim();
}

function isMap(value: unknown): value is JsonMap {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let different = 0;
  for (let index = 0; index < left.length; index++) {
    different |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return different === 0;
}

function requireAutomationKey(req: Request): void {
  const expected = clean(Deno.env.get("HIRING_AUTOMATION_KEY"));
  const supplied = clean(req.headers.get("x-hiring-automation-key"));
  if (!expected || !supplied || !constantTimeEqual(supplied, expected)) {
    throw new AutomationError(401, "not_authorized");
  }
}

async function bodyOf(req: Request): Promise<JsonMap> {
  const declaredBytes = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_BODY_BYTES) {
    throw new AutomationError(400, "invalid_body");
  }
  const raw = await req.text();
  if (!raw || new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new AutomationError(400, "invalid_body");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (_error) {
    throw new AutomationError(400, "invalid_json");
  }
  if (!isMap(parsed)) throw new AutomationError(400, "invalid_body");
  return parsed;
}

function requiredText(body: JsonMap, key: string, maxLength = MAX_TEXT_LENGTH): string {
  const value = clean(body[key]);
  if (!value || value.length > maxLength) {
    throw new AutomationError(400, `invalid_${key}`);
  }
  return value;
}

function optionalText(body: JsonMap, key: string, maxLength = MAX_TEXT_LENGTH): string | null {
  const value = clean(body[key]);
  if (!value) return null;
  if (value.length > maxLength) throw new AutomationError(400, `invalid_${key}`);
  return value;
}

function requiredTimestamp(body: JsonMap, key: string): string {
  const value = requiredText(body, key, 128);
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new AutomationError(400, `invalid_${key}`);
  return new Date(parsed).toISOString();
}

function optionalTimestamp(body: JsonMap, key: string): string | null {
  const value = optionalText(body, key, 128);
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new AutomationError(400, `invalid_${key}`);
  return new Date(parsed).toISOString();
}

function requiredUrl(body: JsonMap, key: string): string {
  const value = requiredText(body, key, 4_000);
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("protocol");
    return url.href;
  } catch (_error) {
    throw new AutomationError(400, `invalid_${key}`);
  }
}

function optionalUrl(body: JsonMap, key: string): string | null {
  const value = optionalText(body, key, 4_000);
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("protocol");
    return url.href;
  } catch (_error) {
    throw new AutomationError(400, `invalid_${key}`);
  }
}

function requiredEmail(body: JsonMap, key: string): string {
  const email = requiredText(body, key, 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AutomationError(400, `invalid_${key}`);
  }
  return email;
}

function requiredUuid(body: JsonMap, key: string): string {
  const value = requiredText(body, key, 64);
  if (!UUID.test(value)) throw new AutomationError(400, `invalid_${key}`);
  return value;
}

function normalizedAnswers(value: unknown): Array<{ question: string; answer: string }> {
  if (!Array.isArray(value) || value.length < 10 || value.length > 20) {
    throw new AutomationError(400, "invalid_answers");
  }
  return value.map((entry) => {
    if (!isMap(entry)) throw new AutomationError(400, "invalid_answers");
    const question = clean(entry.question);
    const answer = clean(entry.answer);
    if (!question || !answer || question.length > 2_000 || answer.length > 8_000) {
      throw new AutomationError(400, "invalid_answers");
    }
    return { question, answer };
  });
}

function serviceClient(): SupabaseClient {
  const url = clean(Deno.env.get("SUPABASE_URL"));
  const key = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!url || !key) throw new AutomationError(503, "service_unavailable");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function safeRpcCode(error: unknown): string {
  const message = clean((error as { message?: unknown } | null)?.message).toLowerCase();
  const allowed = [
    "invalid_event", "invalid_source_contact", "invalid_applicant", "invalid_source_timestamp",
    "invalid_answers", "application_not_found", "state_conflict", "recipient_conflict",
    "invalid_booking", "booking_conflict", "invite_not_found", "claim_conflict",
    "send_already_authorized", "send_not_authorized", "feature_disabled", "invalid_result", "missing_provider_receipt",
    "invalid_failure_code", "invalid_provider_receipt",
  ];
  return allowed.find((code) => message.includes(code)) || "automation_unavailable";
}

async function rpc<T>(client: SupabaseClient, name: string, args: JsonMap): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new AutomationError(422, safeRpcCode(error));
  return data as T;
}

function firstRow(value: unknown): JsonMap | null {
  if (Array.isArray(value)) return isMap(value[0]) ? value[0] : null;
  return isMap(value) ? value : null;
}

async function captureApplication(client: SupabaseClient, body: JsonMap): Promise<Response> {
  const rows = await rpc<unknown>(client, "hiring_capture_application_v1", {
    p_source_event_slug: APPLICATION_EVENT_SLUG,
    p_source_contact_id: requiredText(body, "sourceContactId", 512),
    p_source_submission_key: requiredText(body, "sourceSubmissionKey", 1_024),
    p_name: requiredText(body, "name", 512),
    p_email: requiredEmail(body, "email"),
    p_location: optionalText(body, "location", 2_000),
    p_when_can_start: optionalText(body, "whenCanStart", 2_000),
    p_answers: normalizedAnswers(body.answers),
    p_video_url: requiredUrl(body, "videoUrl"),
    p_iclosed_preview_url: optionalUrl(body, "previewUrl"),
    p_submitted_at: requiredTimestamp(body, "submittedAt"),
    p_source_updated_at: requiredTimestamp(body, "sourceUpdatedAt"),
  });
  const row = firstRow(rows);
  if (!row || !requiredText(row, "application_id", 64)) {
    throw new AutomationError(502, "automation_unavailable");
  }
  return json({
    ok: true,
    applicationId: clean(row.application_id),
    created: row.created === true,
    status: clean(row.application_status),
  });
}

async function claimInvite(client: SupabaseClient): Promise<Response> {
  const row = firstRow(await rpc<unknown>(client, "hiring_claim_next_invite_v1", {
    p_worker_id: DISPATCHER_WORKER_ID,
  }));
  if (!row) return json({ ok: true, job: null });
  const jobId = requiredText(row, "job_id", 64);
  const claimToken = requiredText(row, "claim_token", 64);
  if (!UUID.test(jobId) || !UUID.test(claimToken)) {
    throw new AutomationError(502, "automation_unavailable");
  }
  return json({
    ok: true,
    job: {
      id: jobId,
      claimToken,
    },
  });
}

async function authorizeInviteSend(client: SupabaseClient, body: JsonMap): Promise<Response> {
  const row = firstRow(await rpc<unknown>(client, "hiring_authorize_invite_send_v1", {
    p_job_id: requiredUuid(body, "jobId"),
    p_claim_token: requiredUuid(body, "claimToken"),
  }));
  if (!row) throw new AutomationError(502, "automation_unavailable");
  if (row.authorized !== true) return json({ ok: true, authorized: false, job: null });
  return json({
    ok: true,
    authorized: true,
    job: {
      applicationId: requiredText(row, "application_id", 64),
      recipient: requiredEmail(row, "recipient_email"),
      subject: requiredText(row, "subject", 512),
      body: requiredText(row, "body", 16_000),
      interviewEventUrl: requiredUrl(row, "interview_event_url"),
    },
  });
}

async function recordInvite(client: SupabaseClient, body: JsonMap): Promise<Response> {
  const result = requiredText(body, "result", 64).toLowerCase();
  if (!["sent", "failed", "delivery_uncertain"].includes(result)) {
    throw new AutomationError(400, "invalid_result");
  }
  const providerMessageId = optionalText(body, "providerMessageId", 1_024);
  const failureCode = optionalText(body, "failureCode", 128);
  if (failureCode && !FAILURE_CODES.has(failureCode)) {
    throw new AutomationError(400, "invalid_failureCode");
  }
  const row = firstRow(await rpc<unknown>(client, "hiring_record_invite_result_v1", {
    p_job_id: requiredUuid(body, "jobId"),
    p_claim_token: requiredUuid(body, "claimToken"),
    p_result: result,
    p_provider_message_id: providerMessageId,
    p_failure_code: failureCode,
  }));
  if (!row) throw new AutomationError(502, "automation_unavailable");
  return json({
    ok: true,
    applicationId: clean(row.application_id),
    jobState: clean(row.job_state),
    applicationStatus: clean(row.application_status),
  });
}

async function recordBooking(client: SupabaseClient, body: JsonMap): Promise<Response> {
  const row = firstRow(await rpc<unknown>(client, "hiring_record_interview_booking_v1", {
    p_source_event_slug: INTERVIEW_EVENT_SLUG,
    p_source_contact_id: requiredText(body, "sourceContactId", 512),
    p_booking_id: requiredText(body, "bookingId", 512),
    p_booked_at: optionalTimestamp(body, "bookedAt"),
  }));
  if (!row) throw new AutomationError(502, "automation_unavailable");
  return json({
    ok: true,
    applicationId: clean(row.application_id),
    status: clean(row.status),
    stateVersion: row.state_version,
  });
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ ok: false, code: "method_not_allowed" }, 405);
    requireAutomationKey(req);
    const body = await bodyOf(req);
    const action = requiredText(body, "action", 64).toLowerCase();
    const client = serviceClient();
    if (action === "capture_application") return await captureApplication(client, body);
    if (action === "claim_invite") return await claimInvite(client);
    if (action === "authorize_invite_send") return await authorizeInviteSend(client, body);
    if (action === "record_invite") return await recordInvite(client, body);
    if (action === "record_booking") return await recordBooking(client, body);
    throw new AutomationError(400, "unsupported_action");
  } catch (error) {
    if (error instanceof AutomationError) {
      return json({ ok: false, code: error.code }, error.status);
    }
    return json({ ok: false, code: "automation_unavailable" }, 503);
  }
});
