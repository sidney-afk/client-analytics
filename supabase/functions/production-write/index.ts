// Supabase Edge Function: production-write
//
// The single browser-callable write gateway for native Production mutations.
// It authenticates either a staff role key plus one exact active roster actor,
// or a client review token scoped to the target client. Caller-supplied role,
// member id, author text, and Linear identifiers never authorize a write.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import {
  matchingRoleForKey,
  timingSafeEqual,
  type StaffRoleKey,
} from "../_shared/staff-role-auth.ts";
import {
  DELIVERABLE_STATUSES,
  assetTypeAllowed,
  assetProbeUrl,
  assetUrlType,
  attributionProjectIds,
  assigneeEligibility,
  assigneeEligibilityPolicy,
  browserCredentialTestOverride,
  canonicalLinearUserId,
  eligibleAssigneeProjection,
  canonicalArtifactUrl,
  canonicalDescription,
  canonicalLabelIds,
  clean,
  clientCommentFrontDoorTargetAllowed,
  clientCommentTargetAllowed,
  clientOperationAllowed,
  clientScopeAllowed,
  commentLifecycleCapabilities,
  commentLifecycleAllowed,
  credentialMode,
  deterministicNativeId,
  intentFingerprint,
  legacyParityAllowed,
  lower,
  normalizeActor,
  normalizeCommentAction,
  normalizeOperation,
  normalizeTeam,
  overdueStatusBumpDate,
  overdueStatusBumpEnabled as overdueStatusBumpPolicyEnabled,
  parentIdsForTeam,
  parentOwnerTeamFor,
  planAppendIntakeItems,
  projectIdsForTeam,
  roleCompatible,
  isCanonicalActiveTestClient,
  serviceTestOverrideAllowed,
  signedAssetExpired,
  sourceTimestamp,
  staffAssetReadAllowed,
  staffOperationAllowed,
  validDateOrNull,
  validRequestId,
} from "./policy.mjs";
import {
  collectCompleteSelectedLabels,
  SelectedLabelPageError,
} from "./selected-label-pages.mjs";
import {
  deterministicLinearCreateId,
} from "../_shared/linear-create-id.mjs";

type JsonMap = Record<string, unknown>;
type Entity = "deliverable" | "batch";
type StaffMember = JsonMap & {
  id: string;
  name: string;
  role: string;
  team?: string | null;
  active: boolean;
};
type ClientRow = JsonMap & {
  slug: string;
  display_name: string;
  active: boolean;
  kind: string;
  linear_project_ids?: unknown;
};
type Principal = {
  kind: "staff" | "client" | "test" | "public";
  keyRole: StaffRoleKey | "client" | "test" | "public";
  actorName: string;
  actorKey: string;
  actorRole: string;
  memberId: string | null;
  memberTeam: string;
  clientSlug: string;
  client: ClientRow | null;
  testOnly: boolean;
};
type TargetDrainLane = "test" | "legacy_parity" | "syncview_live";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": [
    "accept",
    "authorization",
    "apikey",
    "content-type",
    "x-syncview-key",
    "x-syncview-actor",
    "x-syncview-role",
    "x-syncview-client-token",
    "x-syncview-source",
  ].join(", "),
  "Cache-Control": "no-store",
};
const SURFACES = new Set(["production", "workload", "calendar", "sxr", "submission"]);
const MAX_COMMENT_BODY = 20_000;
const MAX_INTAKE_ITEMS = 100;
/*
 * PUBLIC INTAKE (owner decision 2026-08-24). The Submit link is used by clients
 * and videographers, who are not staff and never will be, so `intake_create` on
 * the `submission` surface may be made without credentials. Nothing else on this
 * gateway becomes public: the allowance is checked for exactly one operation on
 * exactly one surface, and every other path still reaches `credentials_required`.
 *
 * Four controls make that safe enough to run, and all four are deliberate:
 *   1. A default-OFF runtime flag, so the capability can be withdrawn in one
 *      SQL statement without a deploy. Merging this changes nothing by itself.
 *   2. A LOWER item cap than an authenticated caller gets — a public submission
 *      is one person's shoot, not a season plan.
 *   3. A rate limit per client and overall, counted from a durable log rather
 *      than memory, because edge instances are not shared and an in-process
 *      counter would reset on every cold start.
 *   4. Server-marked ownership: rows arrive as `public-intake`, so anything
 *      submitted this way is identifiable and reversible in one query. The
 *      caller cannot dress a submission up as staff work.
 *
 * What this deliberately does NOT do is verify WHICH client the submitter
 * names. The owner chose one open link over per-client tokens; the client is
 * therefore caller-asserted, exactly as it already was on the legacy lane this
 * replaces. The rate limit is what bounds the blast radius of that choice.
 */
/*
 * WORK THAT HAS JUST BEEN CREATED HAS NOT BEEN STARTED.
 *
 * PR #1073 (2026-08-17) established this after an editor reported sub-issues
 * arriving already "In Progress" that he had never touched. It replaced
 * `'in_progress'` at four BROWSER call sites — and stopped there. Its own
 * comment said the gateway's matching default "is corrected in the gateway on
 * the next deploy"; three deploys later it had not been, and on 2026-08-24 a
 * second person reported the identical symptom: 30 rows born started, from a
 * browser tab holding pre-#1073 code (OPEN_REPAIRS item 35).
 *
 * A client-side default is a suggestion. This app is one 4.6 MB index.html that
 * people leave open for days, so "every UI path sends it explicitly" is only
 * true of UI paths that have been RELOADED. The invariant has to live where it
 * cannot be out of date.
 *
 * NORMALISE rather than refuse (owner decision 2026-08-24). A submission is
 * often someone's whole shoot; refusing it mid-flight to punish a stale tab
 * costs the person real work to fix something they cannot see. The write
 * succeeds with the correct status and the correction is COUNTED in the
 * response, so a stale client is visible rather than silently accommodated.
 *
 * The TEST drill is exempt: it creates started work deliberately, and its path
 * already demands a service-role override plus the canonical TEST client, so
 * the exemption is not reachable by an ordinary caller.
 */
const INTAKE_CREATED_STATUS = "todo";
const STARTED_STATUSES_AT_CREATE = new Set(["in_progress"]);

/*
 * Video work still on an editor's plate, for the auto-assign balancer only.
 *
 * Stated as what COUNTS rather than what does not, so a status added to the
 * vocabulary later is excluded until someone decides it is live work — the
 * safe direction for a list whose other form would silently start counting
 * anything new.
 *
 * `scheduled` and `posted` are past approval, `approved` is signed off, the
 * three approval columns are waiting on somebody else, and backlog/triage were
 * never started; terminal states speak for themselves. A row that bounces back
 * out of an approval column into `tweak` re-enters the count, which is right —
 * the editor owes that work again.
 */
const INTAKE_LOAD_LIVE_STATUSES = Object.freeze(["todo", "in_progress", "tweak"]);

function intakeCreateStatus(
  raw: unknown,
  testOnly: boolean,
  counter: { normalized: number },
): string {
  const status = lower(raw || INTAKE_CREATED_STATUS);
  if (testOnly || !STARTED_STATUSES_AT_CREATE.has(status)) return status;
  counter.normalized += 1;
  return INTAKE_CREATED_STATUS;
}

const PUBLIC_INTAKE_FLAG = "public_intake_enabled";
const PUBLIC_INTAKE_SURFACE = "submission";
/*
 * 25 items meant TWELVE videos in the mode most shoots use, because
 * video+thumbnail sends two deliverables per video. That is not a real shoot
 * size: on 2026-08-26 a videographer with a normal week's filming was refused
 * eleven times in 45 minutes, and the number he hit was an anti-abuse ceiling
 * nobody had converted into videos. Raised to 50 on the owner's instruction
 * ("there is no limit... he should be able to do 16 sub-issues if he wants"),
 * which is 25 videos in video+thumbnail mode and 50 in a single-team one.
 *
 * Still HALF the authenticated cap, and the surrounding limits are unchanged:
 * a client is capped at PUBLIC_INTAKE_MAX_PER_CLIENT requests an hour and the
 * estate at PUBLIC_INTAKE_MAX_TOTAL, every row is stamped `public-intake`, and
 * the ledger row is written before the work. Worst case moves from 1,500 rows
 * an hour to 3,000, all of them reversible in one query.
 */
const MAX_PUBLIC_INTAKE_ITEMS = 50;
const PUBLIC_INTAKE_WINDOW_MINUTES = 60;
const PUBLIC_INTAKE_MAX_PER_CLIENT = 12;
const PUBLIC_INTAKE_MAX_TOTAL = 60;
const OUTBOUND_FLAG = "linear_outbound_enabled";
const OVERDUE_STATUS_BUMP_FLAG = "write_ui_overdue_due_bump";
const LINEAR_URL = "https://api.linear.app/graphql";
const LABEL_PAGE_SIZE = 100;
const MAX_LABEL_PAGES = 50;
const ASSET_PROBE_TIMEOUT_MS = 8_000;
const MAX_ASSET_REDIRECTS = 3;
const ASSET_EVIDENCE_MAX_AGE_MS = 5 * 60 * 1_000;
const INTAKE_FILMING_PLAN_MISSING_MARKER =
  "[SyncView] FILMING PLAN MISSING - submission accepted; SMM follow-up required.";
const ASSET_SLOTS = Object.freeze([
  { key: "filming_plan", field: "filming_doc_url" },
  { key: "raw_footage", field: "footage_folder_url" },
  { key: "delivery_folder", field: "delivery_folder_url" },
  { key: "deliverable_file", field: "file_url" },
]);
const PRODUCTION_CREATE_FIELDS = new Set([
  "operation",
  "surface",
  "client_slug",
  "team",
  "parent_id",
  "title",
  "description",
  "status",
  "due_date",
  "assignee_id",
  "label_ids",
  "request_id",
  "idempotency_key",
  "source_edited_at",
  "test_override",
  "confirm",
]);
const LINEAR_STATUS_NAMES: Record<string, string> = {
  triage: "Triage",
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  smm_approval: "For SMM approval",
  kasper_approval: "For Kasper approval",
  client_approval: "For Client approval",
  tweak: "Tweak Needed",
  approved: "Approved",
  scheduled: "Scheduled",
  posted: "Posted",
  canceled: "Canceled",
  duplicate: "Duplicate",
};

class GatewayError extends Error {
  status: number;
  code: string;
  detail?: JsonMap;

  constructor(status: number, code: string, detail?: JsonMap) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

function json(body: JsonMap, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function waitUntil(promise: Promise<unknown>): void {
  const edge = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
  }).EdgeRuntime;
  try {
    if (edge && typeof edge.waitUntil === "function") edge.waitUntil(promise.catch(() => null));
    else promise.catch(() => null);
  } catch (_error) {
    promise.catch(() => null);
  }
}

function parseJson(value: unknown): JsonMap {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as JsonMap;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonMap : {};
  } catch (_error) {
    return {};
  }
}

function signedLinearUpload(value: string): boolean {
  try {
    const url = new URL(value);
    return [...url.searchParams.keys()].some(key =>
      /^(?:signature|sig|token|expires|x-goog-signature|x-goog-expires)$/i.test(key)
    );
  } catch (_error) {
    return false;
  }
}

function assetGuidance(state: string): string {
  if (state === "missing") {
    return "This card has no deliverable link. Add the finished work to the card's Thumbnail "
      + "link (or attach it in the Production tab) before requesting SMM approval.";
  }
  if (state === "invalid") {
    return "That link isn't supported. Use a Google Drive file or folder, a Frame.io link, "
      + "or a Dropbox file or folder — a Google Doc is a brief, not a deliverable.";
  }
  if (state === "expired") return "Replace the expired asset with a current canonical link.";
  if (state === "permission_denied") return "Share the asset with the review team or replace it with an accessible link.";
  return "The asset could not be verified. Retry the access check or attach a different link.";
}

async function boundedBodySample(response: Response, maxBytes = 8_192): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || !value.length) continue;
      const take = value.slice(0, Math.max(0, maxBytes - size));
      chunks.push(take);
      size += take.length;
      if (take.length < value.length || size >= maxBytes) break;
    }
  } finally {
    await reader.cancel().catch(() => null);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

// `assetProbeUrl` now lives in policy.mjs beside `assetUrlType`. The two must
// agree — every URL the former constructs has to pass the latter — and that
// property is only testable when both are exported from one module. They
// disagreed silently until 2026-08-05, when every Google Drive and Google Docs
// artifact turned out to be unprobeable.
function assetProbeRedirectAllowed(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch (_error) {
    return false;
  }
  const host = lower(url.hostname).replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password) return false;
  if (assetUrlType(value) !== "invalid") return true;
  return host === "drive.usercontent.google.com"
    || host === "dl.dropboxusercontent.com"
    || host === "storage.googleapis.com"
    || host.endsWith(".googleusercontent.com");
}

async function boundedAssetFetch(rawUrl: string): Promise<{ response: Response; sample: string }> {
  if (assetUrlType(rawUrl) === "invalid") throw new Error("asset_redirect_invalid");
  let current = assetProbeUrl(rawUrl);
  for (let redirect = 0; redirect <= MAX_ASSET_REDIRECTS; redirect++) {
    if (!assetProbeRedirectAllowed(current)) throw new Error("asset_redirect_invalid");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ASSET_PROBE_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { accept: "*/*", range: "bytes=0-8191" },
      });
      if (response.status < 300 || response.status >= 400) {
        return {
          response,
          sample: response.ok ? await boundedBodySample(response) : "",
        };
      }
      const location = clean(response.headers.get("location"));
      await response.body?.cancel().catch(() => null);
      if (!location || redirect === MAX_ASSET_REDIRECTS) {
        throw new Error("asset_redirect_unverified");
      }
      const next = new URL(location, current).toString();
      if (!assetProbeRedirectAllowed(next)) throw new Error("asset_redirect_unapproved");
      current = next;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("asset_redirect_unverified");
}

function providerEvidenceState(
  rawUrl: string,
  response: Response,
  sample: string,
): "available" | "permission_denied" | "unavailable" {
  if (!response.ok) return "unavailable";
  const disposition = lower(response.headers.get("content-disposition"));
  const contentType = lower(response.headers.get("content-type")).split(";")[0];
  if (disposition.includes("attachment")
      || /^(?:image|video|audio)\//.test(contentType)
      || /^(?:application\/(?:pdf|octet-stream|zip|vnd[.]))/.test(contentType)) {
    return "available";
  }
  if (contentType !== "text/html" && contentType !== "application/xhtml+xml") {
    return "unavailable";
  }
  const body = lower(sample);
  if (!body) return "unavailable";
  if (/accounts[.]google[.]com|servicelogin|request access|access denied|permission denied|not authorized|(?:sign|log)[ -]?in|type\s*=\s*["']password["']/i.test(body)) {
    return "permission_denied";
  }
  /*
   * A LIVE PROVIDER PAGE IS ENOUGH FOR THE GRAPHICS ARTIFACT (owner ruling
   * 2026-08-16). Frame.io never serves asset bytes at a share URL and a Drive
   * or Dropbox FOLDER has no single file to fetch, so the byte-level test
   * above can never pass for the two shapes the team actually delivers. The
   * old rule therefore refused real work: 1,972 of 2,009 active graphics
   * deliverables had no link that could satisfy it.
   *
   * What this accepts is bounded and stated plainly: the provider page is
   * live, on an allowlisted host, and is NOT a login or request-access wall —
   * that check runs first and still wins. What it does not prove is that a
   * finished asset sits inside. The reviewer opening the link sees that in a
   * second, and that is the trade the owner made deliberately.
   *
   * Everything off the allowlist still fails closed here, so a random HTML
   * page can never masquerade as an artifact.
   */
  // `assetUrlType` is the allowlist: it already rejects a non-HTTPS URL, an
  // unlisted host, an embedded credential and a credential-bearing query, so
  // anything it types is one of our own providers.
  if (assetUrlType(rawUrl) !== "invalid") return "available";
  // A branded landing page from anywhere else does not prove the requested
  // resource exists or is reviewable; all other HTML fails closed.
  return "unavailable";
}

async function probeAssetUrl(slot: string, value: unknown): Promise<JsonMap> {
  const raw = clean(value);
  const checkedAt = new Date().toISOString();
  if (!raw) {
    return { slot, state: "missing", url_type: null, checked_at: checkedAt, guidance: assetGuidance("missing") };
  }
  const urlType = assetUrlType(raw);
  if (urlType === "invalid"
      || (urlType !== "linear_upload" && !assetTypeAllowed(slot, raw))
      || (urlType === "linear_upload" && slot !== "deliverable_file")) {
    return { slot, state: "invalid", url_type: urlType, checked_at: checkedAt, guidance: assetGuidance("invalid") };
  }
  if (signedAssetExpired(raw)) {
    return { slot, state: "expired", url_type: urlType, checked_at: checkedAt, guidance: assetGuidance("expired") };
  }
  // Unsigned Linear uploads are private and require a Linear bearer token.
  // They remain historical rescue candidates, never browser-resolvable proof.
  if (urlType === "linear_upload" && !signedLinearUpload(raw)) {
    return {
      slot,
      state: "permission_denied",
      url_type: urlType,
      checked_at: checkedAt,
      guidance: assetGuidance("permission_denied"),
    };
  }
  try {
    const { response, sample } = await boundedAssetFetch(raw);
    const state = response.status === 401 || response.status === 403
      ? "permission_denied"
      : response.status === 404 || response.status === 410
        ? "expired"
        : providerEvidenceState(raw, response, sample);
    return {
      slot,
      state,
      url_type: urlType,
      checked_at: checkedAt,
      http_status: response.status,
      guidance: state === "available" ? null : assetGuidance(state),
    };
  } catch (error) {
    /*
     * WHY THE PROBE THREW, from a fixed vocabulary.
     *
     * Everything that throws in `boundedAssetFetch` landed here as an
     * indistinguishable `unavailable` with no `http_status`. On 2026-08-05 that
     * was the whole diagnosis: the deployed probe refused an artifact that the
     * same committed logic resolves from a developer network, and the record
     * could not say whether the redirect chain was refused, the request timed
     * out, or the host was unreachable — three different fixes.
     *
     * `unavailable` with a status means the fetch completed and the content was
     * not media. `unavailable` WITHOUT one means one of these. Public-safe: a
     * fixed word, never the error text, which can carry a URL.
     */
    return {
      slot,
      state: "unavailable",
      url_type: urlType,
      checked_at: checkedAt,
      failure: assetProbeFailure(error),
      guidance: assetGuidance("unavailable"),
    };
  }
}

const ASSET_PROBE_FAILURES = new Set([
  "redirect_invalid",
  "redirect_unapproved",
  "redirect_unverified",
  "timeout",
  "network_error",
]);

function assetProbeFailure(error: unknown): string {
  const name = clean((error as { name?: string })?.name);
  if (name === "AbortError" || name === "TimeoutError") return "timeout";
  const message = clean((error as { message?: string })?.message);
  const mapped = message.startsWith("asset_")
    ? message.slice("asset_".length)
    : "";
  return ASSET_PROBE_FAILURES.has(mapped) ? mapped : "network_error";
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function recordAssetEvidence(
  supabase: SupabaseClient,
  deliverableId: string,
  slot: string,
  value: unknown,
  evidence: JsonMap,
): Promise<JsonMap> {
  const checkedAt = clean(evidence.checked_at);
  const state = clean(evidence.state);
  const urlHash = await sha256Hex(clean(value));
  const httpStatus = Number(evidence.http_status);
  const row = {
    deliverable_id: deliverableId,
    slot,
    url_sha256: urlHash,
    state,
    http_status: Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599
      ? httpStatus
      : null,
    // `asset_<state>`, plus the probe's failure word when it threw. The column
    // is constrained to ^[a-z][a-z0-9_]{1,63}$; every value here is a fixed
    // vocabulary term, so the composite always satisfies it.
    result_code: ASSET_PROBE_FAILURES.has(clean(evidence.failure))
      ? `asset_${state}_${clean(evidence.failure)}`
      : `asset_${state}`,
    checked_at: checkedAt,
    checker: "production-write",
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("production_asset_access_checks")
    .upsert(row, { onConflict: "deliverable_id,slot,url_sha256" })
    .select("deliverable_id,slot,url_sha256,state,http_status,result_code,checked_at,checker")
    .maybeSingle();
  if (error || !data) throw new GatewayError(503, "asset_evidence_unavailable");
  return data as JsonMap;
}

async function requireFreshAssetEvidence(
  supabase: SupabaseClient,
  deliverableId: string,
  slot: string,
  value: unknown,
): Promise<JsonMap> {
  const urlHash = await sha256Hex(clean(value));
  const { data, error } = await supabase.from("production_asset_access_checks")
    .select("deliverable_id,slot,url_sha256,state,http_status,result_code,checked_at,checker")
    .eq("deliverable_id", deliverableId)
    .eq("slot", slot)
    .eq("url_sha256", urlHash)
    .maybeSingle();
  if (error || !data) throw new GatewayError(503, "asset_evidence_unavailable");
  const row = data as JsonMap;
  const checkedAt = Date.parse(clean(row.checked_at));
  if (clean(row.state) !== "available"
      || clean(row.checker) !== "production-write"
      || clean(row.url_sha256) !== urlHash
      || !Number.isFinite(checkedAt)
      || Date.now() - checkedAt > ASSET_EVIDENCE_MAX_AGE_MS
      || checkedAt > Date.now() + 30_000) {
    throw new GatewayError(409, "artifact_not_resolvable", {
      asset_state: clean(row.state) || "unavailable",
      checked_at: clean(row.checked_at) || null,
      guidance: assetGuidance(clean(row.state) || "unavailable"),
    });
  }
  return row;
}

function labelNodes(value: unknown): JsonMap[] {
  if (Array.isArray(value)) {
    return value.filter(item => item && typeof item === "object" && !Array.isArray(item)) as JsonMap[];
  }
  const connection = parseJson(value);
  return Array.isArray(connection.nodes)
    ? connection.nodes.filter(item => item && typeof item === "object" && !Array.isArray(item)) as JsonMap[]
    : [];
}

function sanitizedLabel(value: unknown, strictLinear = false): JsonMap | null {
  const row = parseJson(value);
  const id = clean(row.id);
  const name = clean(row.name);
  if (!canonicalLabelIds([id]) || !name) return null;
  const rawColor = clean(row.color);
  if (strictLinear && !/^#[0-9a-f]{6}$/i.test(rawColor)) return null;
  return {
    id,
    name,
    color: /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : "#5e6ad2",
    description: clean(row.description) || null,
  };
}

function sortedLabels(value: unknown): JsonMap[] {
  const byId = new Map<string, JsonMap>();
  for (const node of labelNodes(value)) {
    const label = sanitizedLabel(node);
    if (label) byId.set(clean(label.id), label);
  }
  return [...byId.values()].sort((a, b) => clean(a.id).localeCompare(clean(b.id)));
}

function nativeLabelSnapshot(row: JsonMap): { labels: JsonMap[]; ids: string[] } | null {
  const raw = parseJson(row.linear_raw);
  const issue = parseJson(raw.issue);
  const connection = parseJson(issue.labels);
  const nodes = Array.isArray(connection.nodes) ? connection.nodes : null;
  const pageInfo = parseJson(connection.pageInfo);
  if (!nodes || pageInfo.hasNextPage !== false) return null;
  const labels = sortedLabels(connection);
  if (labels.length !== nodes.length) return null;
  const nodeIds = labels.map(label => clean(label.id));
  if (Object.prototype.hasOwnProperty.call(issue, "labelIds")) {
    const rawIds = issue.labelIds;
    const issueIds = canonicalLabelIds(rawIds);
    if (!Array.isArray(rawIds)
        || !issueIds
        || issueIds.length !== rawIds.length
        || rawIds.some(value => typeof value !== "string" || clean(value) !== value)
        || JSON.stringify(issueIds) !== JSON.stringify(nodeIds)) {
      return null;
    }
  }
  return { labels, ids: nodeIds };
}

function mergeLabelCatalog(catalog: JsonMap[], selected: JsonMap[]): JsonMap[] {
  const byId = new Map<string, JsonMap>();
  // Current active-catalog metadata wins for labels that remain selectable;
  // selected-only archived/arbitrary labels are retained as additional rows.
  for (const label of [...selected, ...catalog]) byId.set(clean(label.id), label);
  return [...byId.values()].sort((a, b) => {
    const byName = lower(a.name).localeCompare(lower(b.name));
    return byName || clean(a.id).localeCompare(clean(b.id));
  });
}

function selectedLabelReceipt(row: JsonMap): JsonMap {
  const snapshot = nativeLabelSnapshot(row);
  if (!snapshot) throw new GatewayError(500, "idempotent_result_missing");
  return {
    selected_label_ids: snapshot.ids,
    selected_labels: snapshot.labels,
  };
}

async function linearLabelsRequest(query: string, variables: JsonMap): Promise<JsonMap> {
  const key = clean(Deno.env.get("LINEAR_MIRROR_API_KEY"));
  if (!key) throw new GatewayError(503, "label_catalog_unavailable");
  let response: Response;
  try {
    response = await fetch(LINEAR_URL, {
      method: "POST",
      headers: { authorization: key, "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
  } catch (_error) {
    throw new GatewayError(503, "label_catalog_unavailable");
  }
  const body = await response.json().catch(() => null) as JsonMap | null;
  if (!response.ok || !body || (Array.isArray(body.errors) && body.errors.length)) {
    throw new GatewayError(503, "label_catalog_unavailable");
  }
  return parseJson(body.data);
}

type LabelSnapshot = {
  catalog: JsonMap[];
  selectedLabels: JsonMap[];
  selectedLabelIds: string[];
};

async function linearLabelCatalog(teamId: string, expectedTeam = ""): Promise<JsonMap[]> {
  const catalogQuery = `query SyncViewProductionLabelCatalog($teamId: String!, $after: String) {
    team(id: $teamId) { id key }
    issueLabels(first: ${LABEL_PAGE_SIZE}, after: $after) {
      nodes { id name color description archivedAt isGroup team { id } }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  let after: string | null = null;
  const catalogCursors = new Set<string>();
  const catalogById = new Map<string, JsonMap>();

  for (let page = 0; page < MAX_LABEL_PAGES; page++) {
    const data = await linearLabelsRequest(catalogQuery, { teamId, after });
    const currentTeam = parseJson(data.team);
    if (clean(currentTeam.id) !== teamId
        || (expectedTeam && normalizeTeam(currentTeam.key) !== normalizeTeam(expectedTeam))) {
      throw new GatewayError(409, "linear_team_mapping_unavailable");
    }
    const catalogConnection = parseJson(data.issueLabels);
    const rawCatalogNodes = catalogConnection.nodes;
    const catalogNodes = labelNodes(catalogConnection);
    if (!Array.isArray(rawCatalogNodes) || catalogNodes.length !== rawCatalogNodes.length) {
      throw new GatewayError(502, "label_catalog_incomplete", { complete: false });
    }
    for (const node of catalogNodes) {
      if (!Object.prototype.hasOwnProperty.call(node, "team")
          || typeof node.isGroup !== "boolean"
          || !Object.prototype.hasOwnProperty.call(node, "archivedAt")) {
        throw new GatewayError(502, "label_catalog_incomplete", { complete: false });
      }
      const labelTeamId = clean(parseJson(node.team).id);
      if (node.isGroup === true || clean(node.archivedAt)
          || (labelTeamId && labelTeamId !== teamId)) continue;
      const label = sanitizedLabel(node, true);
      if (!label) throw new GatewayError(502, "label_catalog_incomplete", { complete: false });
      if (catalogById.has(clean(label.id))) {
        throw new GatewayError(502, "label_catalog_incomplete", { complete: false });
      }
      catalogById.set(clean(label.id), label);
    }

    const pageInfo = parseJson(catalogConnection.pageInfo);
    if (pageInfo.hasNextPage === false) break;
    if (pageInfo.hasNextPage !== true) {
      throw new GatewayError(502, "label_catalog_incomplete", { complete: false });
    }
    after = clean(pageInfo.endCursor);
    if (!after || catalogCursors.has(after) || page === MAX_LABEL_PAGES - 1) {
      throw new GatewayError(502, "label_catalog_incomplete", { complete: false });
    }
    catalogCursors.add(after);
  }
  return [...catalogById.values()].sort((a, b) => {
    const byName = lower(a.name).localeCompare(lower(b.name));
    return byName || clean(a.id).localeCompare(clean(b.id));
  });
}

async function linearLabelSnapshot(issueId: string): Promise<LabelSnapshot> {
  const identity = await linearLabelsRequest(
    "query SyncViewProductionLabelIssue($id: String!) { issue(id: $id) { id team { id } } }",
    { id: issueId },
  );
  const currentIssue = parseJson(identity.issue);
  if (clean(currentIssue.id) !== issueId) {
    throw new GatewayError(409, "linear_issue_unavailable");
  }
  const issueTeamId = clean(parseJson(currentIssue.team).id);
  if (!issueTeamId) throw new GatewayError(409, "linear_issue_team_unavailable");
  const catalog = await linearLabelCatalog(issueTeamId);
  const selectedQuery = `query SyncViewProductionSelectedLabels($id: String!, $selectedAfter: String) {
    issue(id: $id) {
      id
      team { id }
      labels(first: ${LABEL_PAGE_SIZE}, after: $selectedAfter, includeArchived: true) {
        nodes { id name color description archivedAt isGroup team { id } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`;
  let selected: { labels: JsonMap[]; ids: string[] };
  try {
    selected = await collectCompleteSelectedLabels({
      issueId,
      expectedTeamId: issueTeamId,
      maxPages: MAX_LABEL_PAGES,
      fetchPage: (selectedAfter: string | null) =>
        linearLabelsRequest(selectedQuery, { id: issueId, selectedAfter }),
    }) as { labels: JsonMap[]; ids: string[] };
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    if (error instanceof SelectedLabelPageError && error.kind === "identity") {
      throw new GatewayError(409, "label_selection_invalid");
    }
    if (error instanceof SelectedLabelPageError && error.kind === "invalid") {
      throw new GatewayError(502, "label_selection_invalid");
    }
    throw new GatewayError(502, "label_selection_incomplete", { complete: false });
  }
  return {
    catalog,
    selectedLabels: selected.labels,
    selectedLabelIds: selected.ids,
  };
}

function bearer(req: Request): string {
  return clean(req.headers.get("authorization")).replace(/^Bearer\s+/i, "");
}

async function serviceRoleRequest(req: Request): Promise<boolean> {
  const supplied = bearer(req);
  const expected = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!supplied) return false;
  if (expected && timingSafeEqual(supplied, expected)) return true;

  const url = clean(Deno.env.get("SUPABASE_URL"));
  if (!url) return false;
  try {
    const response = await fetch(`${url}/rest/v1/rpc/b4_service_role_probe`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${supplied}`,
        apikey: supplied,
        "content-type": "application/json",
      },
      body: "{}",
    });
    if (!response.ok) return false;
    return await response.json() === true;
  } catch (_error) {
    return false;
  }
}

async function clientBySlug(supabase: SupabaseClient, slug: string): Promise<ClientRow | null> {
  const { data, error } = await supabase.from("clients")
    .select("slug,display_name,active,kind,linear_project_ids")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new GatewayError(503, "client_lookup_unavailable");
  return data as ClientRow | null;
}

// This is intentionally a service-side lookup. Filming plans contain internal
// Doc URLs and remain unreadable to anonymous intake browsers.
async function intakeFilmingPlanForClient(supabase: SupabaseClient, clientSlug: string): Promise<string> {
  try {
    const { data, error } = await supabase.from("filming_plans")
      .select("doc_url")
      .eq("client_slug", clientSlug)
      .maybeSingle();
    if (error) {
      console.warn("intake filming-plan lookup failed");
      return "";
    }
    return clean(parseJson(data).doc_url);
  } catch (_error) {
    console.warn("intake filming-plan lookup failed");
    return "";
  }
}

function intakeDescriptionWithFilmingPlan(
  sourceDescription: unknown,
  serverPlanUrl: string,
  submittedPlanUrl: string,
): { description: string; planUrl: string; status: string; alert: string | null } {
  const notes = clean(sourceDescription)
    .split(/\r?\n/)
    .filter(line => !/^\s*Filming Plan:\s*/i.test(line))
    .filter(line => line.trim() !== INTAKE_FILMING_PLAN_MISSING_MARKER)
    .join("\n")
    .trim();
  if (serverPlanUrl && submittedPlanUrl && serverPlanUrl !== submittedPlanUrl) {
    return {
      description: [
        `Filming Plan: ${serverPlanUrl}`,
        `[SyncView] FILMING PLAN LINK MISMATCH - server mapping used; submitted link retained for SMM review: ${submittedPlanUrl}`,
        notes,
      ].filter(Boolean).join("\n\n"),
      planUrl: serverPlanUrl,
      status: "server_mapping_mismatch",
      alert: "Filming plan mapping differed from the submitted link; review the created work.",
    };
  }
  if (serverPlanUrl) {
    return {
      description: [`Filming Plan: ${serverPlanUrl}`, notes].filter(Boolean).join("\n\n"),
      planUrl: serverPlanUrl,
      status: "resolved_server",
      alert: null,
    };
  }
  if (submittedPlanUrl) {
    return {
      description: [
        `Filming Plan: ${submittedPlanUrl}`,
        `[SyncView] FILMING PLAN MAPPING MISSING - submitted link retained; SMM verify: ${submittedPlanUrl}`,
        notes,
      ].filter(Boolean).join("\n\n"),
      planUrl: submittedPlanUrl,
      status: "submitted_unverified",
      alert: "No protected filming-plan mapping was found; the submitted link was retained for review.",
    };
  }
  return {
    description: [INTAKE_FILMING_PLAN_MISSING_MARKER, notes].filter(Boolean).join("\n\n"),
    planUrl: "",
    status: "missing",
    alert: "Submission was created without a filming plan. Add or repair the protected mapping.",
  };
}

async function uniqueActiveTestClient(supabase: SupabaseClient): Promise<ClientRow> {
  const { data, error } = await supabase.from("clients")
    .select("slug,display_name,active,kind,linear_project_ids")
    .eq("active", true)
    .eq("kind", "test");
  if (error) throw new GatewayError(503, "client_lookup_unavailable");
  if (!Array.isArray(data) || data.length !== 1) {
    throw new GatewayError(409, "test_client_scope_ambiguous");
  }
  return data[0] as ClientRow;
}

async function authenticate(
  supabase: SupabaseClient,
  req: Request,
  body: JsonMap,
  targetClientSlug: string,
): Promise<Principal> {
  const key = clean(req.headers.get("x-syncview-key"));
  const token = clean(req.headers.get("x-syncview-client-token"));
  const credentials = credentialMode(key, token);
  if (credentials === "ambiguous") throw new GatewayError(401, "ambiguous_credentials");

  if (body.test_override === true) {
    if (browserCredentialTestOverride(body.test_override, key, token)) {
      throw new GatewayError(401, "invalid_test_override");
    }
    if (!serviceTestOverrideAllowed(key, token, body.confirm, await serviceRoleRequest(req))) {
      throw new GatewayError(401, "invalid_test_override");
    }
    const client = await clientBySlug(supabase, targetClientSlug);
    if (!client || !isCanonicalActiveTestClient(client.active, client.kind)) {
      throw new GatewayError(403, "test_client_scope_required");
    }
    return {
      kind: "test",
      keyRole: "test",
      actorName: "SyncView TEST write drill",
      actorKey: "test:production-write",
      actorRole: "admin",
      memberId: null,
      memberTeam: "",
      clientSlug: client.slug,
      client,
      testOnly: true,
    };
  }

  if (credentials === "staff") {
    const keyRole = matchingRoleForKey(key);
    if (!keyRole) throw new GatewayError(401, "invalid_staff_key");
    const requestedActor = normalizeActor(req.headers.get("x-syncview-actor"));
    if (!requestedActor) throw new GatewayError(403, "roster_actor_required");

    const { data, error } = await supabase.from("team_members")
      .select("id,name,role,team,active")
      .eq("active", true);
    if (error) throw new GatewayError(503, "roster_lookup_unavailable");
    const matches = ((data || []) as StaffMember[]).filter(member =>
      normalizeActor(member.name) === requestedActor && roleCompatible(keyRole, member.role)
    );
    if (matches.length !== 1) throw new GatewayError(403, "roster_actor_not_unique");
    const member = matches[0];
    const principal: Principal = {
      kind: "staff",
      keyRole,
      actorName: clean(member.name),
      actorKey: `member:${clean(member.id)}`,
      actorRole: lower(member.role),
      memberId: clean(member.id),
      memberTeam: normalizeTeam(member.team),
      clientSlug: targetClientSlug,
      client: null,
      testOnly: false,
    };
    return principal;
  }

  if (credentials === "client") {
    const { data, error } = await supabase.from("client_access")
      .select("slug,review_token");
    if (error) throw new GatewayError(503, "client_auth_unavailable");
    const matches = ((data || []) as JsonMap[]).filter(row => {
      const stored = clean(row.review_token);
      return !!stored && timingSafeEqual(token, stored);
    });
    if (matches.length === 0) throw new GatewayError(401, "invalid_client_token");
    if (matches.length !== 1) throw new GatewayError(403, "ambiguous_client_token");
    const matchedSlug = clean(matches[0].slug);
    if (!clientScopeAllowed(matchedSlug, targetClientSlug)) {
      throw new GatewayError(403, "client_scope_mismatch");
    }
    const client = await clientBySlug(supabase, matchedSlug);
    if (!client || client.active !== true) throw new GatewayError(403, "client_inactive");
    const principal: Principal = {
      kind: "client",
      keyRole: "client",
      actorName: clean(client.display_name),
      actorKey: `client:${client.slug}`,
      actorRole: "client",
      memberId: null,
      memberTeam: "",
      clientSlug: client.slug,
      client,
      testOnly: false,
    };
    return principal;
  }

  throw new GatewayError(401, "credentials_required");
}

/*
 * Fails CLOSED in every uncertain case: a missing row, an unreadable row, a
 * malformed value or any error all mean "not enabled". A public write path must
 * never be opened by a database hiccup.
 */
async function publicIntakeEnabled(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await supabase.from("syncview_runtime_flags")
      .select("value")
      .eq("key", PUBLIC_INTAKE_FLAG)
      .maybeSingle();
    if (error || !data) return false;
    return parseJson((data as JsonMap).value).enabled === true;
  } catch (_error) {
    return false;
  }
}

/*
 * Counted from `public_intake_log`, not from memory. Edge instances do not
 * share state and are recycled constantly, so an in-process counter would be a
 * rate limit in name only — it would reset to zero under exactly the load it
 * exists to stop.
 *
 * A read failure REFUSES the submission rather than allowing it. That is the
 * unusual direction for this gateway, which normally protects a durable write
 * from a failed side read, but here the read IS the control.
 */
async function assertPublicIntakeWithinRate(
  supabase: SupabaseClient,
  clientSlug: string,
): Promise<void> {
  const since = new Date(Date.now() - PUBLIC_INTAKE_WINDOW_MINUTES * 60_000).toISOString();
  const { data, error } = await supabase.from("public_intake_log")
    .select("client_slug")
    .gte("created_at", since);
  if (error || !Array.isArray(data)) throw new GatewayError(503, "public_intake_rate_unavailable");
  const rows = data as JsonMap[];
  if (rows.length >= PUBLIC_INTAKE_MAX_TOTAL) {
    throw new GatewayError(429, "public_intake_rate_limited");
  }
  const forClient = rows.filter(row => clean(row.client_slug) === clientSlug).length;
  if (forClient >= PUBLIC_INTAKE_MAX_PER_CLIENT) {
    throw new GatewayError(429, "public_intake_rate_limited");
  }
}

function publicIntakePrincipal(client: ClientRow): Principal {
  return {
    kind: "public",
    keyRole: "public",
    // Deliberately not a person's name. Nothing about the submitter is verified,
    // so recording one would put an unearned identity on the row.
    actorName: "Client submission",
    actorKey: "public-intake",
    actorRole: "public",
    memberId: null,
    memberTeam: "",
    clientSlug: client.slug,
    client,
    testOnly: false,
  };
}

async function authorityFor(supabase: SupabaseClient, team: string): Promise<"linear" | "syncview"> {
  const normalizedTeam = normalizeTeam(team);
  if (!normalizedTeam) throw new GatewayError(409, "team_authority_unknown");
  const { data, error } = await supabase.from("syncview_runtime_flags")
    .select("value")
    .eq("key", "prod_authority")
    .maybeSingle();
  if (error || !data) throw new GatewayError(503, "authority_unavailable");
  const value = parseJson((data as JsonMap).value);
  if (!(normalizedTeam in value)) throw new GatewayError(503, "authority_unavailable");
  const authority = lower(value[normalizedTeam]);
  if (authority === "syncview") return "syncview";
  if (authority === "linear") return "linear";
  throw new GatewayError(503, "authority_unavailable");
}

async function f27WriteAuthorizationGeneration(
  supabase: SupabaseClient,
  team: string,
): Promise<number> {
  const normalizedTeam = normalizeTeam(team);
  if (!normalizedTeam) throw new GatewayError(503, "authority_unavailable");
  const { data, error } = await supabase.rpc("track_b_f27_write_authorization", {
    p_team: normalizedTeam,
  });
  const authorization = parseJson(data);
  const generation = authorization.generation;
  if (error
      || authorization.ok !== true
      || clean(authorization.type) !== "f27_write_authorization"
      || clean(authorization.team) !== normalizedTeam
      || !["linear", "syncview"].includes(clean(authorization.authority))
      || typeof generation !== "number"
      || !Number.isSafeInteger(generation)
      || generation < 0) {
    throw new GatewayError(503, "authority_unavailable");
  }
  return generation;
}

async function outboundLiveForDrain(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await supabase.from("syncview_runtime_flags")
      .select("value")
      .eq("key", OUTBOUND_FLAG)
      .maybeSingle();
    if (error || !data) return false;
    return lower(parseJson((data as JsonMap).value).mode) === "live";
  } catch (_error) {
    // The native write is already durable. A missing fast-drain decision must
    // not turn that success into a failure; the scheduled drainer remains the
    // recovery path.
    return false;
  }
}

async function overdueStatusBumpEnabled(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await supabase.from("syncview_runtime_flags")
      .select("value")
      .eq("key", OVERDUE_STATUS_BUMP_FLAG)
      .maybeSingle();
    if (error || !data) return true;
    return overdueStatusBumpPolicyEnabled((data as JsonMap).value);
  } catch (_error) {
    return true;
  }
}

async function assertLegacyParityEnabled(supabase: SupabaseClient): Promise<void> {
  const { data, error } = await supabase.from("syncview_runtime_flags")
    .select("value")
    .eq("key", "linear_legacy_parity_enabled")
    .maybeSingle();
  if (error || !data) throw new GatewayError(503, "legacy_parity_gate_unavailable");
  const value = parseJson((data as JsonMap).value);
  if (value.enabled !== true) throw new GatewayError(409, "legacy_parity_disabled");
}

function surfaceFor(body: JsonMap): string {
  const surface = lower(body.surface);
  if (!SURFACES.has(surface)) throw new GatewayError(400, "invalid_surface");
  return surface;
}

function assertSurfaceOperation(surface: string, operation: string): void {
  if (operation === "create") {
    if (surface !== "production") throw new GatewayError(400, "invalid_surface_operation");
    return;
  }
  if (operation === "intake_create") {
    // `sxr` joins submission and calendar here (owner task: "samples should
    // have their own batches", 2026-08-18). Samples run the SAME intake
    // pipeline as the Calendar create flow; what differs is the batch they
    // land in, which carries purpose='samples', and the row origin.
    //
    // Note what is deliberately NOT widened alongside this:
    // `legacyParityAllowed` still answers false for sxr + intake_create, so a
    // samples intake writes the native leg only and never mirrors a parity
    // copy into a Linear-authoritative team. Samples are native-born; there is
    // no pre-existing Linear history for them to stay in step with.
    if (surface !== "submission" && surface !== "calendar" && surface !== "sxr") {
      throw new GatewayError(400, "invalid_surface_operation");
    }
    return;
  }
  if (surface === "workload") {
    if (operation !== "due") throw new GatewayError(400, "invalid_surface_operation");
    return;
  }
  if (surface === "submission") throw new GatewayError(400, "invalid_surface_operation");
  if ((surface === "calendar" || surface === "sxr") && !["status", "comment"].includes(operation)) {
    throw new GatewayError(400, "invalid_surface_operation");
  }
}

function authorityLane(
  authority: "linear" | "syncview",
  principal: Principal,
  surface: string,
  operation: string,
  requestedParity: boolean,
): boolean {
  if (principal.testOnly) {
    if (requestedParity) throw new GatewayError(409, "legacy_parity_not_allowed");
    return false;
  }
  if (requestedParity) {
    if (!legacyParityAllowed(surface, operation) || authority !== "linear") {
      throw new GatewayError(409, "legacy_parity_not_allowed");
    }
    return true;
  }
  if (authority === "syncview") return false;
  if (surface === "production") throw new GatewayError(409, "team_is_linear_authoritative");
  if (!legacyParityAllowed(surface, operation)) {
    throw new GatewayError(409, "team_is_linear_authoritative");
  }
  throw new GatewayError(409, "legacy_parity_required");
}

function requestIdFor(body: JsonMap): string {
  const id = validRequestId(body.request_id || body.idempotency_key);
  if (!id) throw new GatewayError(400, "valid_request_id_required");
  return id;
}

function dedupKey(operation: string, entity: string, id: string, requestId: string): string {
  return `write-ui:${operation}:${entity}:${id}:${requestId}`;
}

function f27FencedPayload(
  payload: JsonMap,
  generation: number,
  legacyParity: boolean,
): JsonMap {
  return {
    ...payload,
    _f27_authority_generation: generation,
    _f27_legacy_parity: legacyParity,
  };
}

function eventFor(
  operation: string,
  principal: Principal,
  sourceEditedAt: string,
  surface: string,
  outbound: JsonMap,
  existing: JsonMap | null = null,
  nextStatus = "",
): JsonMap {
  return {
    source: "ui",
    action: operation === "create" || operation === "intake_create" ? "create" : `${operation}_change`,
    actor: principal.actorName,
    actor_key: principal.actorKey,
    role: principal.actorRole,
    auth_kind: principal.kind,
    surface,
    ts: sourceEditedAt,
    from_status: clean(existing && existing.status) || null,
    to_status: clean(nextStatus || (existing && existing.status)) || null,
    outbound,
  };
}

async function rpc(supabase: SupabaseClient, name: string, args: JsonMap): Promise<unknown> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (String(error.code || "") === "23505" || /idempotency_conflict/i.test(clean(error.message))) {
      throw new GatewayError(409, "idempotency_conflict");
    }
    if (/write_conflict/i.test(clean(error.message))) throw new GatewayError(409, "write_conflict");
    if (/authority_unavailable/i.test(clean(error.message))) throw new GatewayError(503, "authority_unavailable");
    if (/legacy_parity_gate_unavailable/i.test(clean(error.message))) {
      throw new GatewayError(503, "legacy_parity_gate_unavailable");
    }
    if (/team_is_linear_authoritative|legacy_parity_not_allowed/i.test(clean(error.message))) {
      throw new GatewayError(409, /legacy_parity/i.test(clean(error.message))
        ? "legacy_parity_not_allowed"
        : "team_is_linear_authoritative");
    }
    if (/test_client_scope_required/i.test(clean(error.message))) {
      throw new GatewayError(403, "test_client_scope_required");
    }
    if (/batch_not_found|batch_not_active|batch_team_mismatch|batch_parent_mapping_(missing|ambiguous)/i.test(clean(error.message))) {
      const code = /batch_not_found/i.test(clean(error.message))
        ? "batch_not_found"
        : /batch_not_active/i.test(clean(error.message))
        ? "batch_not_active"
        : /batch_team_mismatch/i.test(clean(error.message))
          ? "batch_team_mismatch"
          : /ambiguous/i.test(clean(error.message))
            ? "batch_parent_mapping_ambiguous"
            : "batch_parent_mapping_missing";
      throw new GatewayError(409, code);
    }
    if (/invalid_intake_append_(payload|pair|order|route)/i.test(clean(error.message))) {
      throw new GatewayError(400, clean(error.message).match(/invalid_intake_append_(payload|pair|order|route)/i)?.[0].toLowerCase()
        || "invalid_intake_append_payload");
    }
    if (/invalid_production_create_payload/i.test(clean(error.message))) {
      throw new GatewayError(400, "invalid_production_create_payload");
    }
    if (/production_create_(id_conflict|parent_scope|parent_nested|parent_route|batch_scope)/i.test(clean(error.message))) {
      const code = clean(error.message)
        .match(/production_create_(id_conflict|parent_scope|parent_nested|parent_route|batch_scope)/i)?.[0]
        .toLowerCase() || "production_create_id_conflict";
      throw new GatewayError(409, code);
    }
    if (/artifact_card_projection_(scope_invalid|failed)/i.test(clean(error.message))) {
      const code = clean(error.message)
        .match(/artifact_card_projection_(scope_invalid|failed)/i)?.[0]
        .toLowerCase() || "artifact_card_projection_failed";
      throw new GatewayError(409, code);
    }
    console.error("production-write RPC failed", name, error.code || "unknown");
    throw new GatewayError(500, "native_write_failed");
  }
  return data;
}

function identityRepair(value: unknown): JsonMap {
  return parseJson(parseJson(parseJson(value).linear_raw).identity_repair);
}

function publicRow(value: unknown): JsonMap {
  const row = parseJson(value);
  const repair = identityRepair(row);
  return {
    id: clean(row.id),
    identifier: clean(row.identifier) || null,
    batch_id: clean(row.batch_id) || null,
    client_slug: clean(row.client_slug),
    team: normalizeTeam(row.team) || null,
    kind: clean(row.kind) || null,
    title: clean(row.title || row.name),
    status: clean(row.status) || null,
    status_at: clean(row.status_at) || null,
    due_date: clean(row.due_date) || null,
    assignee_id: clean(row.assignee_id) || null,
    origin: clean(row.origin) || null,
    card_id: clean(row.card_id) || null,
    sync_state: clean(row.sync_state) || null,
    identity_repair_state: clean(repair.state) || null,
    identity_repair_reason: clean(repair.reason) || null,
    linear_identifier: clean(row.linear_identifier) || null,
    linear_issue_url: clean(row.linear_issue_url) || null,
    updated_at: clean(row.updated_at) || null,
  };
}

function publicArtifactRow(value: unknown): JsonMap {
  const row = parseJson(value);
  return {
    ...publicRow(row),
    file_url: clean(row.file_url) || null,
    artifact_revision: Number(row.artifact_revision || 0),
  };
}

async function assertDeliverableIdentityWritable(
  supabase: SupabaseClient,
  row: JsonMap,
): Promise<void> {
  const repair = identityRepair(row);
  const repairState = lower(repair.state);
  const currentLinearIssueId = clean(
    row.linear_issue_uuid || parseJson(parseJson(row.linear_raw).issue).id,
  );
  if (repairState === "resolved"
      && clean(repair.resolved_linear_issue_id)
      && clean(repair.resolved_linear_issue_id) === currentLinearIssueId) {
    return;
  }
  const blocked = (): never => {
    throw new GatewayError(409, "identity_repair_required", {
      read_only: true,
      row: {
        ...publicRow(row),
        sync_state: "error",
        identity_repair_state: "required",
        identity_repair_reason: "linear_create_idempotency_conflict",
      },
    });
  };
  if (repairState) blocked();

  const { data, error } = await supabase.from("mirror_outbox")
    .select("id,status,entity,entity_id,operation,client_slug,team,payload,linear_result")
    .eq("entity", "deliverable")
    .eq("entity_id", clean(row.id))
    .eq("operation", "create");
  if (error) throw new GatewayError(503, "identity_guard_unavailable");
  const conflicts = ((data || []) as JsonMap[]).filter(candidate => {
    const payload = parseJson(candidate.payload);
    const conflict = parseJson(parseJson(candidate.linear_result).conflict);
    return clean(candidate.client_slug) === clean(row.client_slug)
      && normalizeTeam(candidate.team) === normalizeTeam(row.team)
      && clean(payload.planned_linear_issue_id)
      && clean(payload.planned_linear_issue_id) === currentLinearIssueId
      && lower(conflict.decision) === "idempotency_conflict";
  });
  if (conflicts.length) blocked();
}

function publicDescriptionRow(value: unknown): JsonMap {
  const row = parseJson(value);
  return {
    ...publicRow(row),
    brief: typeof row.brief === "string" ? row.brief : null,
  };
}

function publicComment(value: unknown, principal?: Principal): JsonMap {
  const row = parseJson(value);
  const deleted = !!clean(row.deleted_at);
  const attachments = (deleted ? [] : Array.isArray(row.attachments) ? row.attachments : [])
    .slice(0, 20)
    .map(value => parseJson(value))
    .map(item => {
      const rawUrl = clean(item.url || item.href || item.file_url);
      let url = "";
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === "https:") url = parsed.href;
      } catch (_error) {
        url = "";
      }
      if (!url) return null;
      return {
        url,
        name: clean(item.name || item.title || item.filename).slice(0, 240) || "Attachment",
        ...(clean(item.mime_type || item.content_type)
          ? { mime_type: clean(item.mime_type || item.content_type).slice(0, 120) }
          : {}),
      };
    })
    .filter(Boolean);
  return {
    id: clean(row.id),
    // This bounded native identity is the only receipt field Calendar/Samples
    // need to adopt an already-committed write after a lost HTTP response.
    native_comment_id: clean(row.native_comment_id).slice(0, 160) || null,
    parent_id: clean(row.parent_id) || null,
    author_name: clean(row.author_name) || "Unknown author",
    role: clean(row.role) || null,
    body: deleted ? "Comment deleted." : row.body == null ? "" : String(row.body),
    body_format: clean(row.body_format) || "markdown",
    attachments,
    audience: lower(row.audience) === "client" ? "client" : "internal",
    component: clean(row.component) || null,
    is_tweak: row.is_tweak === true,
    round: Number.isInteger(Number(row.round)) ? Number(row.round) : null,
    source_created_at: clean(row.source_created_at) || null,
    source_updated_at: clean(row.source_updated_at) || null,
    edited_at: clean(row.edited_at) || null,
    deleted_at: clean(row.deleted_at) || null,
    resolved_at: clean(row.resolved_at) || null,
    version: Number.isInteger(Number(row.version)) ? Number(row.version) : 1,
    created_at: clean(row.created_at) || null,
    updated_at: clean(row.updated_at) || null,
    ...commentLifecycleCapabilities(principal, row),
  };
}

function assertCas(body: JsonMap, existing: JsonMap, includeDescription = false): void {
  const row = includeDescription ? publicDescriptionRow(existing) : publicRow(existing);
  if (body.expected_status !== undefined
      && clean(existing.status) !== clean(body.expected_status)) {
    throw new GatewayError(409, "write_conflict", { conflict: true, row });
  }
  if (body.expected_updated_at !== undefined
      && clean(existing.updated_at) !== clean(body.expected_updated_at)) {
    throw new GatewayError(409, "write_conflict", { conflict: true, row });
  }
}

async function targetedDrain(
  dedup: string,
  principal: Principal,
  lane: TargetDrainLane = principal.testOnly ? "test" : "legacy_parity",
): Promise<JsonMap> {
  const url = clean(Deno.env.get("SUPABASE_URL"));
  const key = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!url || !key) return { attempted: false, acknowledged: false, error: "drainer_unavailable" };
  const body = lane === "test"
    ? {
      target_dedup_key: dedup,
      test_override: { client_slug: principal.clientSlug, mode: "live", authority: "syncview" },
      confirm: "B4_TEST_ONLY",
    }
    : lane === "legacy_parity"
      ? {
      target_dedup_key: dedup,
      legacy_parity: true,
      confirm: "WRITE_UI_LEGACY_PARITY",
      }
      : {
        target_dedup_key: dedup,
        syncview_live: true,
        confirm: "WRITE_UI_SYNCVIEW_LIVE",
      };
  try {
    const response = await fetch(`${url}/functions/v1/linear-outbound`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        apikey: key,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({})) as JsonMap;
    const target = parseJson(result.target);
    const targetStatus = lower(target.status);
    const conflict = parseJson(parseJson(target.linear_result).conflict);
    const terminalConflict = targetStatus === "skipped"
      && clean(target.operation) === "create"
      && lower(conflict.decision) === "idempotency_conflict";
    const terminal = targetStatus === "written"
      || (targetStatus === "skipped" && ["already_applied", "already_exists"].includes(lower(conflict.decision)));
    return {
      attempted: true,
      acknowledged: response.ok && result.ok === true && terminal,
      status: response.status,
      target_status: targetStatus || null,
      terminal_conflict: terminalConflict,
      ...(terminalConflict ? { error: "idempotency_conflict" } : {}),
    };
  } catch (_error) {
    return { attempted: true, acknowledged: false, error: "drainer_unavailable" };
  }
}

function scheduleSyncviewLiveDrains(dedupKeys: string[], principal: Principal): void {
  const unique = [...new Set(dedupKeys.map(clean).filter(Boolean))];
  if (!unique.length) return;
  waitUntil((async () => {
    // Keep create dependencies ordered (batch parent before child). A failed
    // background attempt remains durable for the scheduled drainer.
    for (const dedup of unique) await targetedDrain(dedup, principal, "syncview_live");
  })());
}

async function findOutboxId(supabase: SupabaseClient, dedup: string): Promise<number> {
  const { data, error } = await supabase.from("mirror_outbox")
    .select("id")
    .eq("dedup_key", dedup)
    .maybeSingle();
  if (error || !data || !Number((data as JsonMap).id)) {
    throw new GatewayError(500, "outbox_checkpoint_missing");
  }
  return Number((data as JsonMap).id);
}

async function assertDedupIntent(
  supabase: SupabaseClient,
  dedup: string,
  expected: JsonMap,
): Promise<boolean> {
  const { data, error } = await supabase.from("mirror_outbox")
    .select("id,entity,entity_id,operation,client_slug,team,actor,role,source_edited_at,payload,legacy_parity,test_only")
    .eq("dedup_key", dedup)
    .maybeSingle();
  if (error) throw new GatewayError(503, "idempotency_lookup_unavailable");
  if (!data) return false;
  const row = data as JsonMap;
  const payload = parseJson(row.payload);
  const matches = clean(row.entity) === clean(expected.entity)
    && clean(row.entity_id) === clean(expected.entity_id)
    && clean(row.operation) === clean(expected.operation)
    && clean(row.client_slug) === clean(expected.client_slug)
    && normalizeTeam(row.team) === normalizeTeam(expected.team)
    && clean(row.actor) === clean(expected.actor)
    && clean(row.role) === clean(expected.role)
    && row.legacy_parity === expected.legacy_parity
    && row.test_only === expected.test_only
    && clean(payload._intent_fingerprint) === clean(expected.intent_fingerprint);
  if (!matches) throw new GatewayError(409, "idempotency_conflict");
  return true;
}

function dedupExpectation(
  principal: Principal,
  team: string,
  sourceEditedAt: string,
  outbound: JsonMap,
  fingerprint: string,
): JsonMap {
  return {
    entity: outbound.entity,
    entity_id: outbound.entity_id,
    operation: outbound.operation,
    client_slug: principal.clientSlug,
    team,
    actor: principal.actorName,
    role: principal.actorRole,
    actor_key: principal.actorKey,
    source_edited_at: sourceEditedAt,
    legacy_parity: outbound.legacy_parity === true,
    test_only: outbound.test_only === true,
    intent_fingerprint: fingerprint,
    payload: parseJson(outbound.payload),
  };
}

// Exact lifecycle receipt replay, mirroring production_comment_lifecycle_write's
// own receipt guard. An existing receipt for this dedup identity is a committed
// prior attempt whose HTTP response was lost; adopt its result rather than
// letting the pre-RPC CAS observe the already-advanced row and 409.
async function readLifecycleReceipt(
  supabase: SupabaseClient,
  dedup: string,
  commentId: string,
  action: string,
  fingerprint: string,
): Promise<JsonMap | null> {
  const { data, error } = await supabase.from("production_comment_mutation_receipts")
    .select("dedup_key,comment_id,action,intent_fingerprint,result_version")
    .eq("dedup_key", dedup)
    .maybeSingle();
  if (error) throw new GatewayError(503, "comment_receipt_lookup_unavailable");
  if (!data) return null;
  const receipt = data as JsonMap;
  if (clean(receipt.comment_id) !== clean(commentId)
      || clean(receipt.action) !== clean(action)
      || clean(receipt.intent_fingerprint) !== clean(fingerprint)) {
    throw new GatewayError(409, "idempotency_conflict");
  }
  const { data: committed, error: committedError } = await supabase.from("production_comments")
    .select("*")
    .eq("id", receipt.comment_id)
    .maybeSingle();
  if (committedError || !committed) throw new GatewayError(500, "idempotent_result_missing");
  return committed as JsonMap;
}

type ReceiptOutcome = "committed_exact" | "absent" | "conflict";
type OutboxReceipt = {
  outcome: ReceiptOutcome;
  row: JsonMap | null;
};

async function readOutboxReceipt(
  supabase: SupabaseClient,
  dedup: string,
  expected: JsonMap,
): Promise<OutboxReceipt> {
  const { data, error } = await supabase.from("mirror_outbox")
    .select("id,status,entity,entity_id,comment_id,operation,client_slug,team,source_edited_at,payload,legacy_parity,test_only,attempts,next_retry_at,last_error,processed_at")
    .eq("dedup_key", dedup)
    .maybeSingle();
  if (error) throw new GatewayError(503, "reconcile_receipt_unavailable");
  if (!data) return { outcome: "absent", row: null };
  const row = data as JsonMap;
  const payload = parseJson(row.payload);
  const expectedPayload = parseJson(expected.payload);
  const operation = clean(expected.operation);
  const operationPayloadMatches = operation === "status"
    ? clean(expectedPayload.status) !== "" && lower(payload.status) === lower(expectedPayload.status)
    : operation === "description"
      ? typeof payload.description === "string"
        && typeof expectedPayload.description === "string"
        && payload.description === expectedPayload.description
      : operation === "comment"
        ? typeof payload.body === "string"
          && typeof expectedPayload.body === "string"
          && payload.body === expectedPayload.body
        : operation === "attachment"
          ? typeof payload.url === "string"
            && typeof expectedPayload.url === "string"
            && payload.url === expectedPayload.url
        : false;
  const storedSourceAt = Date.parse(clean(row.source_edited_at));
  const expectedSourceAt = Date.parse(clean(expected.source_edited_at));
  const sourceClockMatches = Number.isFinite(storedSourceAt)
    && Number.isFinite(expectedSourceAt)
    && storedSourceAt === expectedSourceAt;
  // The intent fingerprint is reconstructed from the stable actorKey. Outbox
  // actor/role columns are mutable display snapshots and are not receipt identity.
  const stableActorBound = clean(expected.actor_key) !== ""
    && clean(expected.intent_fingerprint) !== "";
  const matches = clean(row.entity) === clean(expected.entity)
    && clean(row.entity_id) === clean(expected.entity_id)
    && clean(row.operation) === clean(expected.operation)
    && clean(row.client_slug) === clean(expected.client_slug)
    && normalizeTeam(row.team) === normalizeTeam(expected.team)
    && sourceClockMatches
    && row.legacy_parity === expected.legacy_parity
    && row.test_only === expected.test_only
    && stableActorBound
    && operationPayloadMatches
    && clean(payload._intent_fingerprint) === clean(expected.intent_fingerprint);
  return { outcome: matches ? "committed_exact" : "conflict", row };
}

async function currentEntityRow(
  supabase: SupabaseClient,
  table: string,
  id: string,
): Promise<JsonMap> {
  const { data, error } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
  if (error || !data) throw new GatewayError(503, "reconcile_current_row_unavailable");
  return data as JsonMap;
}

async function findReceiptComment(
  supabase: SupabaseClient,
  dedup: string,
  productionCommentId: string,
  nativeCommentId: string,
): Promise<JsonMap | null> {
  const lookups: Array<[string, string]> = [["idempotency_key", dedup], ["id", productionCommentId]];
  if (nativeCommentId) lookups.push(["native_comment_id", nativeCommentId]);
  for (const [column, value] of lookups) {
    const { data, error } = await supabase.from("production_comments")
      .select("*")
      .eq(column, value)
      .maybeSingle();
    if (error) throw new GatewayError(503, "reconcile_comment_unavailable");
    if (data) return data as JsonMap;
  }
  return null;
}

function canonicalCommentMatchesReceipt(
  value: unknown,
  expected: JsonMap,
  outboxCommentId: unknown,
): boolean {
  const comment = parseJson(value);
  const canonicalId = clean(comment.id);
  return canonicalId !== ""
    && clean(outboxCommentId) === canonicalId
    && clean(comment.idempotency_key) === clean(expected.idempotency_key)
    && clean(comment.deliverable_id) === clean(expected.deliverable_id)
    && clean(comment.batch_id) === clean(expected.batch_id)
    && clean(comment.client_slug) === clean(expected.client_slug)
    && normalizeTeam(comment.team) === normalizeTeam(expected.team)
    && clean(comment.author_key) === clean(expected.author_key)
    && clean(comment.native_comment_id) === clean(expected.native_comment_id);
}

async function reconcileEntityOperation(
  supabase: SupabaseClient,
  body: JsonMap,
  operation: string,
  surface: string,
  requestId: string,
  sourceEditedAt: string,
  entity: Entity,
  id: string,
  table: string,
  targetClientSlug: string,
  team: string,
  principal: Principal,
): Promise<Response> {
  if (operation !== "status"
      && operation !== "description"
      && operation !== "comment"
      && operation !== "attachment") {
    throw new GatewayError(400, "reconcile_operation_unsupported");
  }
  const historicalLegacyParity = body.legacy_parity === true;
  const authority = principal.testOnly ? "syncview" : await authorityFor(supabase, team);
  const authorityReadAt = new Date().toISOString();
  let dedup = dedupKey(operation, entity, id, requestId);
  let fingerprint = "";
  let canonicalComment: JsonMap | null = null;
  let productionCommentId = "";
  let nativeCommentId = "";
  let expectedOperationPayload: JsonMap = {};
  let expectedComment: JsonMap | null = null;

  if (operation === "status") {
    if (entity !== "deliverable") throw new GatewayError(400, "unsupported_batch_operation");
    const nextStatus = lower(body.status || parseJson(body.patch).status);
    if (!DELIVERABLE_STATUSES.includes(nextStatus)) throw new GatewayError(400, "invalid_status");
    if (principal.kind === "client"
        && !clientOperationAllowed("status", "client_approval", nextStatus)) {
      throw new GatewayError(403, "operation_forbidden");
    }
    fingerprint = await intentFingerprint({
      operation, entity, id, requestId, surface, legacyParity: historicalLegacyParity,
      actorKey: principal.actorKey,
      patch: { status: nextStatus, status_at: sourceEditedAt },
    });
    expectedOperationPayload = { status: nextStatus };
  } else if (operation === "description") {
    if (entity !== "deliverable") throw new GatewayError(400, "unsupported_batch_operation");
    if (principal.kind === "client") throw new GatewayError(403, "operation_forbidden");
    const descriptionValue = body.description !== undefined
      ? body.description
      : parseJson(body.patch).description;
    const description = canonicalDescription(descriptionValue);
    if (description == null) throw new GatewayError(400, "invalid_description");
    fingerprint = await intentFingerprint({
      operation, entity, id, requestId, surface, legacyParity: historicalLegacyParity,
      actorKey: principal.actorKey,
      patch: { brief: description },
    });
    expectedOperationPayload = { description };
  } else if (operation === "attachment") {
    if (entity !== "deliverable") throw new GatewayError(400, "unsupported_batch_operation");
    if (principal.kind === "client" || team !== "graphics") {
      throw new GatewayError(403, "operation_forbidden");
    }
    const fileUrl = canonicalArtifactUrl(
      body.file_url !== undefined ? body.file_url : parseJson(body.patch).file_url,
    );
    if (!fileUrl) throw new GatewayError(400, "invalid_artifact_url");
    fingerprint = await intentFingerprint({
      operation, entity, id, requestId, surface, legacyParity: historicalLegacyParity,
      actorKey: principal.actorKey,
      patch: { file_url: fileUrl },
    });
    expectedOperationPayload = { url: fileUrl };
  } else {
    const commentInput = parseJson(body.comment);
    const commentBody = String(commentInput.body == null ? body.body || "" : commentInput.body).trim();
    if (!commentBody || commentBody.length > MAX_COMMENT_BODY) {
      throw new GatewayError(400, "invalid_comment_body");
    }
    let audience = principal.kind === "client" ? "client" : lower(commentInput.audience || "internal");
    if (!["internal", "client"].includes(audience)) throw new GatewayError(400, "invalid_comment_audience");
    const suppliedNativeId = clean(commentInput.native_comment_id);
    if (suppliedNativeId
        && (!(surface === "calendar" || surface === "sxr")
          || !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{1,199}$/.test(suppliedNativeId))) {
      throw new GatewayError(400, "invalid_native_comment_id");
    }
    if (suppliedNativeId) dedup = dedupKey("comment", entity, id, `native:${suppliedNativeId}`);
    const rawParentId = clean(commentInput.parent_id);
    let parentId = rawParentId;
    if (rawParentId) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]{1,199}$/.test(rawParentId)) {
        throw new GatewayError(400, "invalid_comment_parent");
      }
      const { data: parents, error: parentError } = await supabase.from("production_comments")
        .select("id,native_comment_id,deliverable_id,batch_id,client_slug,audience")
        .or(`id.eq.${rawParentId},native_comment_id.eq.${rawParentId}`)
        .limit(2);
      if (parentError) throw new GatewayError(503, "comment_parent_lookup_unavailable");
      if (!Array.isArray(parents) || parents.length !== 1) {
        throw new GatewayError(409, "comment_parent_ambiguous");
      }
      const parent = parents[0] as JsonMap;
      if (clean(parent.client_slug) !== targetClientSlug
          || clean(parent.deliverable_id) !== (entity === "deliverable" ? id : "")
          || clean(parent.batch_id) !== (entity === "batch" ? id : "")
          || (principal.kind === "client" && clean(parent.audience) !== "client")) {
        throw new GatewayError(403, "comment_parent_forbidden");
      }
      parentId = clean(parent.id);
      // A reply is part of the resolved canonical thread. Its visibility is
      // inherited server-side and cannot be widened or hidden by caller input.
      audience = lower(parent.audience) === "client" ? "client" : "internal";
    }
    productionCommentId = suppliedNativeId
      ? await deterministicNativeId("pc", `${entity}:${id}`, suppliedNativeId)
      : await deterministicNativeId("pc", requestId, `${entity}:${id}:production`);
    nativeCommentId = suppliedNativeId || productionCommentId;
    const round = commentInput.round == null || commentInput.round === ""
      ? null
      : Number(commentInput.round);
    if (round != null && (!Number.isInteger(round) || round < 0)) {
      throw new GatewayError(400, "invalid_comment_round");
    }
    fingerprint = await intentFingerprint({
      operation, entity, id,
      ...(suppliedNativeId ? {} : { requestId, surface, legacyParity: historicalLegacyParity }),
      actorKey: principal.actorKey,
      comment: {
        body: commentBody,
        audience,
        native_comment_id: nativeCommentId,
        parent_id: parentId || null,
        component: clean(commentInput.component) || null,
        is_tweak: commentInput.is_tweak === true,
        round,
      },
    });
    expectedOperationPayload = { body: commentBody };
    expectedComment = {
      id: productionCommentId,
      idempotency_key: dedup,
      deliverable_id: entity === "deliverable" ? id : null,
      batch_id: entity === "batch" ? id : null,
      client_slug: targetClientSlug,
      team,
      author_key: principal.actorKey,
      native_comment_id: nativeCommentId,
    };
  }

  const outbound: JsonMap = {
    entity: operation === "comment" ? "comment" : entity,
    entity_id: id,
    operation,
    legacy_parity: historicalLegacyParity,
    test_only: principal.testOnly,
    payload: { ...expectedOperationPayload, _intent_fingerprint: fingerprint },
  };
  const receipt = await readOutboxReceipt(
    supabase,
    dedup,
    dedupExpectation(principal, team, sourceEditedAt, outbound, fingerprint),
  );

  if (operation === "comment") {
    canonicalComment = await findReceiptComment(supabase, dedup, productionCommentId, nativeCommentId);
    if (receipt.outcome === "committed_exact") {
      if (!canonicalComment || !expectedComment
          || !canonicalCommentMatchesReceipt(
            canonicalComment,
            expectedComment,
            receipt.row?.comment_id,
          )) {
        receipt.outcome = "conflict";
      }
    } else if (canonicalComment) {
      // Comment/outbox creation is one transaction. A row without its exact
      // receipt is either a native-id collision or inconsistent durable state.
      receipt.outcome = "conflict";
    }
  }

  const current = await currentEntityRow(supabase, table, id);
  const receiptPublic = receipt.row ? {
    id: Number(receipt.row.id) || null,
    dedup_key: dedup,
    status: clean(receipt.row.status) || null,
    source_edited_at: clean(receipt.row.source_edited_at) || null,
    legacy_parity: receipt.row.legacy_parity === true,
    test_only: receipt.row.test_only === true,
    attempts: Number(receipt.row.attempts || 0),
    processed_at: clean(receipt.row.processed_at) || null,
  } : null;
  const response: JsonMap = {
    ok: receipt.outcome !== "conflict",
    reconcile_only: true,
    outcome: receipt.outcome,
    authority,
    authority_read_at: authorityReadAt,
    historical_legacy_parity: historicalLegacyParity,
    row: operation === "description"
      ? publicDescriptionRow(current)
      : operation === "attachment"
        ? publicArtifactRow(current)
        : publicRow(current),
    receipt: receiptPublic,
    comment: receipt.outcome === "committed_exact" && canonicalComment
      ? publicComment(canonicalComment, principal)
      : null,
  };
  return json(
    receipt.outcome === "conflict" ? { ...response, error: "intent_conflict" } : response,
    receipt.outcome === "conflict" ? 409 : 200,
  );
}

function configuredTestProjectIds(): Set<string> {
  return new Set(clean(Deno.env.get("B4_TEST_PROJECT_IDS"))
    .split(",")
    .map(clean)
    .filter(Boolean));
}

function configuredTestProjectForTeam(team: string): string {
  const raw = clean(Deno.env.get("B4_TEST_PROJECT_BY_TEAM"));
  const configured = parseJson(raw || "{}");
  const normalizedTeam = normalizeTeam(team);
  const jsonValue = clean(configured[normalizedTeam]);
  if (jsonValue) return jsonValue;
  for (const entry of raw.split(",")) {
    const separator = entry.indexOf(":");
    if (separator < 1) continue;
    if (normalizeTeam(entry.slice(0, separator)) === normalizedTeam) {
      return clean(entry.slice(separator + 1));
    }
  }
  return "";
}

function linearReadKey(): string {
  return clean(
    Deno.env.get("LINEAR_READ_API_KEY")
      || Deno.env.get("LINEAR_MIRROR_API_KEY")
      || Deno.env.get("LINEAR_API_KEY"),
  );
}

async function linearRead(
  query: string,
  variables: JsonMap,
  unavailableCode = "project_mapping_validation_unavailable",
): Promise<JsonMap> {
  const apiKey = linearReadKey();
  if (!apiKey) throw new GatewayError(503, unavailableCode);
  let response: Response;
  try {
    response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { authorization: apiKey, "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
  } catch (_error) {
    throw new GatewayError(503, unavailableCode);
  }
  const result = await response.json().catch(() => null) as JsonMap | null;
  if (!response.ok || !result || Array.isArray(result.errors)) {
    throw new GatewayError(503, unavailableCode);
  }
  return parseJson(result.data);
}

function compactLinearProject(value: unknown): JsonMap {
  const project = parseJson(value);
  const nodes = parseJson(project.teams).nodes;
  const teams: string[] = [];
  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      const team = normalizeTeam(parseJson(node).key);
      if (team && !teams.includes(team)) teams.push(team);
    }
  }
  return { id: clean(project.id), name: clean(project.name), teams };
}

async function readLinearProject(projectId: string): Promise<JsonMap> {
  const apiKey = clean(
    Deno.env.get("LINEAR_READ_API_KEY")
      || Deno.env.get("LINEAR_MIRROR_API_KEY")
      || Deno.env.get("LINEAR_API_KEY"),
  );
  if (!apiKey) throw new GatewayError(503, "project_mapping_validation_unavailable");
  const data = await linearRead(
    "query ProductionWriteProjectScope($id: String!) { project(id: $id) { id name teams { nodes { id key } } } }",
    { id: projectId },
  );
  const project = compactLinearProject(data.project);
  if (clean(project.id) !== projectId) throw new GatewayError(409, "project_mapping_missing");
  return project;
}

function projectMatchesTeam(project: JsonMap, team: string): boolean {
  return Array.isArray(project.teams) && project.teams.includes(normalizeTeam(team));
}

async function validateLinearBatchParent(
  parentId: string,
  team: string,
  projectId: string,
  requireRoot = false,
): Promise<void> {
  const data = await linearRead(
    "query ProductionWriteBatchParentScope($id: String!) { issue(id: $id) { id team { key } project { id } parent { id } } }",
    { id: parentId },
    "batch_parent_validation_unavailable",
  );
  const issue = parseJson(data.issue);
  if (clean(issue.id) !== parentId
      || normalizeTeam(parseJson(issue.team).key) !== normalizeTeam(team)
      || clean(parseJson(issue.project).id) !== projectId
      || (requireRoot && !!clean(parseJson(issue.parent).id))) {
    throw new GatewayError(409, "batch_parent_mapping_missing");
  }
}

async function parentRouteForAppend(
  supabase: SupabaseClient,
  batch: JsonMap,
  clientSlug: string,
  team: string,
  projectId: string,
  principal: Principal,
  legacyParity: boolean,
  validateExternal = true,
): Promise<JsonMap> {
  const directIds = parentIdsForTeam(batch.linear_parent_ids, team);
  if (directIds.length > 1) throw new GatewayError(409, "batch_parent_mapping_ambiguous");
  const { data, error } = await supabase.from("mirror_outbox")
    .select("id,dedup_key,status,entity,entity_id,operation,client_slug,team,payload,linear_result,test_only,legacy_parity")
    .eq("entity", "batch")
    .eq("entity_id", clean(batch.id))
    .eq("operation", "create")
    .eq("client_slug", clientSlug)
    .eq("team", normalizeTeam(team))
    .eq("test_only", principal.testOnly)
    .eq("legacy_parity", legacyParity);
  if (error) throw new GatewayError(503, "batch_parent_lookup_unavailable");
  const candidates = ((data || []) as JsonMap[]).filter(row => {
    const payload = parseJson(row.payload);
    const eligibleStatuses = validateExternal
      ? ["pending", "failed", "shadow_ok", "written"]
      : ["pending", "failed", "shadow_ok", "written", "skipped", "stale"];
    return clean(payload.project_id) === projectId
      && row.test_only === principal.testOnly
      && row.legacy_parity === legacyParity
      && eligibleStatuses.includes(lower(row.status));
  });
  if (candidates.length > 1) throw new GatewayError(409, "batch_parent_mapping_ambiguous");
  if (candidates.length === 1) {
    const parent = candidates[0];
    const dependencyId = Number(parent.id);
    const dependencyDedup = clean(parent.dedup_key);
    if (!Number.isSafeInteger(dependencyId) || dependencyId < 1 || !dependencyDedup) {
      throw new GatewayError(409, "batch_parent_mapping_missing");
    }
    const result = parseJson(parent.linear_result);
    const writtenParentId = clean(
      result.issue_id || result.linear_issue_id || parseJson(result.issue).id,
    );
    if (directIds.length === 1 && writtenParentId !== directIds[0]) {
      throw new GatewayError(409, "batch_parent_mapping_ambiguous");
    }
    if (validateExternal && lower(parent.status) === "written") {
      if (!writtenParentId) throw new GatewayError(409, "batch_parent_mapping_missing");
      await validateLinearBatchParent(writtenParentId, team, projectId);
    }
    // A native batch keeps its original team-parent dependency forever. This
    // is stable across pending -> written/linkage and therefore keeps an exact
    // child retry's route and intent fingerprint unchanged.
    return {
      parent_linear_issue_id: null,
      depends_on_id: dependencyId,
      dependency_dedup_key: dependencyDedup,
    };
  }
  if (directIds.length === 1) {
    // Validate against the team that OWNS the parent issue, not the team
    // asking for it. One Linear issue serves every team a card has, recorded
    // under each team key with owner_team stamped -- so a thumbnail appended
    // to a batch whose only parent is a video issue was being refused for the
    // sole reason that a video issue is not a graphics issue. An unstamped
    // (older) map yields "" and validates exactly as it did before.
    if (validateExternal) {
      const ownerTeam = parentOwnerTeamFor(batch.linear_parent_ids, team) || team;
      await validateLinearBatchParent(directIds[0], ownerTeam, projectId);
    }
    return { parent_linear_issue_id: directIds[0], depends_on_id: null, dependency_dedup_key: null };
  }
  throw new GatewayError(409, "batch_parent_mapping_missing");
}

/*
 * The attribution stamp for an intake-created row.
 *
 * WHY IT IS WRITTEN HERE, with no Linear issue yet.
 * `intake_create` builds a purely native row; the Linear issue is created later
 * by `linear-outbound`, which links it with
 *
 *   linear_raw: { ...raw, issue: completeIssue }        linear-outbound:770
 *
 * That SPREADS whatever `linear_raw` already holds. So a stamp written at
 * intake survives the drain untouched, and `linear-outbound` — the flip-night
 * lane — needs no change at all. Writing it there instead would have meant
 * porting the roster lookup into the drain, which is the riskiest function in
 * the estate to touch before a cutover.
 *
 * WHY IT MIRRORS f200 RATHER THAN ALWAYS CLAIMING `resolved`.
 * `projectForIntake` returns an env-configured project for TEST principals,
 * which need not appear in any client's `linear_project_ids`. Stamping
 * `resolved` off that would assert an ownership the roster cannot confirm —
 * the same over-claim that produces `attribution_repair_sentinel_mismatch`. So
 * the claim is only `resolved` when the roster actually maps the project, and
 * otherwise records the honest `direct_project_unmapped` state that the
 * reconciler independently computes.
 *
 * `mapping_revision` stays empty on purpose: it is a hash over the entire
 * roster, so a writer that stamped the live value would go stale estate-wide
 * on the next onboarding. Nothing gates on it — see
 * docs/audits/2026-08-05-attribution-stamp-soak-signal.md.
 */
function intakeAttribution(client: ClientRow, team: string, projectId: string): JsonMap {
  /*
   * The RECONCILER's rule, not intake's. `attributionProjectIds` is team-blind,
   * matching `buildProjectIndex`; `projectIdsForTeam` is team-aware and is
   * correct for ROUTING a new item, not for deciding what the roster maps.
   * Using the stricter one here stamped `needs_attribution` on rows the
   * reconciler resolved, guaranteeing a permanent diff.
   */
  const mapped = attributionProjectIds(client.linear_project_ids).includes(projectId);
  const base: JsonMap = {
    schema: "syncview_attribution_v1",
    state: "needs_attribution",
    client_slug: null,
    owner_kind: null,
    source: "none",
    project_id: null,
    direct_project_id: projectId || null,
    ancestor_issue_id: null,
    ancestor_distance: null,
    mapping_revision: "",
    repair_required: true,
    reason: projectId ? "direct_project_unmapped" : "no_mapped_project_or_explicit_classification",
  };
  // f200 attaches this whenever a direct project resolves to no owner
  // (`f200-attribution.js:342`, surfaced at `:406`). Without it the stamp and
  // the recomputation differ by exactly one key on every unmapped row.
  if (!mapped && projectId) base.unmapped_project_ids = [projectId];
  if (!mapped) return base;
  return {
    ...base,
    state: "resolved",
    client_slug: clean(client.slug),
    owner_kind: lower(client.kind || "client"),
    source: "direct_project",
    project_id: projectId,
    repair_required: false,
    reason: "direct_project_mapped",
  };
}

async function projectForIntake(client: ClientRow, team: string, principal: Principal): Promise<string> {
  if (principal.testOnly) {
    const projectId = configuredTestProjectForTeam(team);
    const allowlist = configuredTestProjectIds();
    if (!projectId) {
      throw new GatewayError(503, "test_project_mapping_unavailable");
    }
    if (!allowlist.has(projectId)) throw new GatewayError(403, "test_project_scope_required");
    const project = await readLinearProject(projectId);
    if (!projectMatchesTeam(project, team)) {
      throw new GatewayError(403, "test_project_scope_required");
    }
    return projectId;
  }
  const tagged = projectIdsForTeam(client.linear_project_ids, team);
  if (tagged.length > 1) throw new GatewayError(409, "project_mapping_ambiguous");
  if (tagged.length === 1) {
    const project = await readLinearProject(tagged[0]);
    if (!projectMatchesTeam(project, team)) throw new GatewayError(409, "project_mapping_missing");
    return tagged[0];
  }
  // Real-client intake never guesses from a display name or an untagged list.
  // The read-only census may propose exact-name candidates to the owner, but
  // production create remains blocked until the reviewed per-team mapping is
  // persisted on the client row.
  throw new GatewayError(409, "project_mapping_missing");
}

function teamIdFor(team: string): string {
  return clean(Deno.env.get(normalizeTeam(team) === "graphics"
    ? "LINEAR_GRAPHICS_TEAM_ID"
    : "LINEAR_VIDEO_TEAM_ID"));
}

async function linearStateIdForCreate(teamId: string, team: string, status: string): Promise<string> {
  if (!teamId) throw new GatewayError(503, "linear_team_mapping_unavailable");
  const data = await linearRead(
    "query ProductionCreateTeam($id: String!) { team(id: $id) { id key states { nodes { id name } } } }",
    { id: teamId },
    "linear_team_mapping_unavailable",
  );
  const linearTeam = parseJson(data.team);
  if (clean(linearTeam.id) !== teamId
      || normalizeTeam(linearTeam.key) !== normalizeTeam(team)) {
    throw new GatewayError(409, "linear_team_mapping_unavailable");
  }
  const states = parseJson(linearTeam.states).nodes;
  const expectedName = lower(LINEAR_STATUS_NAMES[status]).replace(/\s+/g, " ");
  const matching = Array.isArray(states)
    ? states.filter(value => lower(parseJson(value).name).replace(/\s+/g, " ") === expectedName)
    : [];
  if (matching.length !== 1 || !clean(parseJson(matching[0]).id)) {
    throw new GatewayError(409, "status_mapping_unavailable");
  }
  return clean(parseJson(matching[0]).id);
}

// F94 — the provider half of the eligible-assignee projection. One bounded
// Linear read per gateway invocation resolves every candidate's provider state;
// an incomplete page, an unreachable provider, or a missing key is a denial,
// never an assumed-active pass. Only id + active are requested, so no provider
// name or email enters this function.
const ASSIGNEE_ELIGIBILITY_FLAG = "production_assignee_eligibility";
const ASSIGNEE_PROVIDER_POOL_LIMIT = 250;

async function assigneeEligibilityPolicyFor(
  supabase: SupabaseClient,
): Promise<{ providerMappingRequired: boolean }> {
  try {
    const { data, error } = await supabase.from("syncview_runtime_flags")
      .select("value")
      .eq("key", ASSIGNEE_ELIGIBILITY_FLAG)
      .maybeSingle();
    // An absent flag row is the normal pre-retirement state and must not turn
    // an otherwise valid write into a 503; absence means "strictest".
    if (error || !data) return { providerMappingRequired: true };
    return assigneeEligibilityPolicy((data as JsonMap).value);
  } catch (_error) {
    return { providerMappingRequired: true };
  }
}

async function assigneeProviderPool(): Promise<Map<string, boolean>> {
  const data = await linearRead(
    "query ProductionWriteAssigneeProviderPool($first: Int!) {"
      + " users(first: $first, includeArchived: true) {"
      + " nodes { id active } pageInfo { hasNextPage } } }",
    { first: ASSIGNEE_PROVIDER_POOL_LIMIT },
    "assignee_provider_unavailable",
  );
  const users = parseJson(data.users);
  const nodes = users.nodes;
  const page = parseJson(users.pageInfo);
  // A truncated pool cannot prove that an absent id is merely absent, so a
  // partial answer fails closed instead of silently denying real members.
  if (!Array.isArray(nodes) || page.hasNextPage !== false) {
    throw new GatewayError(503, "assignee_provider_unavailable");
  }
  const pool = new Map<string, boolean>();
  for (const node of nodes) {
    const user = parseJson(node);
    const id = canonicalLinearUserId(user.id);
    if (id) pool.set(id, user.active === true);
  }
  return pool;
}

async function assigneeEligibilityContext(
  supabase: SupabaseClient,
  needsProvider: boolean,
): Promise<{ providerMappingRequired: boolean; providerActiveFor: (id: string) => boolean | null }> {
  const policy = await assigneeEligibilityPolicyFor(supabase);
  if (!policy.providerMappingRequired || !needsProvider) {
    return { ...policy, providerActiveFor: () => null };
  }
  const pool = await assigneeProviderPool();
  return {
    ...policy,
    providerActiveFor: (id: string) => (pool.has(id) ? pool.get(id) === true : null),
  };
}

async function assigneeRosterRow(
  supabase: SupabaseClient,
  assigneeId: string,
): Promise<JsonMap | null> {
  const { data, error } = await supabase.from("team_members")
    .select("id,name,role,team,active,linear_user_id")
    .eq("id", assigneeId)
    .maybeSingle();
  if (error) throw new GatewayError(503, "assignee_lookup_unavailable");
  return (data || null) as JsonMap | null;
}

// The one enforcement point every assignment lane shares. It runs before the
// native state write and before any outbox row exists, so an ineligible or
// unmirrorable target can no longer be committed and then fail asynchronously.
async function assertEligibleAssignee(
  supabase: SupabaseClient,
  assigneeId: string,
  team: string,
): Promise<{ id: string; linearUserId: string } | null> {
  if (!assigneeId) return null;
  const member = await assigneeRosterRow(supabase, assigneeId);
  const context = await assigneeEligibilityContext(supabase, !!member);
  const verdict = assigneeEligibility(member, team, {
    providerMappingRequired: context.providerMappingRequired,
    providerActive: context.providerActiveFor(canonicalLinearUserId(member && member.linear_user_id)),
  });
  if (!verdict.eligible) {
    // Missing, inactive, cross-team, and role-incompatible targets share a 403
    // so the picker cannot be used to enumerate the roster; unmirrorable ones
    // keep the existing 409 conflict shape.
    throw verdict.reason === "assignee_mapping_unavailable"
        || verdict.reason === "assignee_provider_inactive"
        || verdict.reason === "assignee_provider_unverified"
      ? new GatewayError(409, verdict.reason)
      : new GatewayError(403, verdict.reason === "assignee_role_incompatible"
        ? "assignee_role_incompatible"
        : "assignee_out_of_scope");
  }
  return { id: clean(member!.id), linearUserId: verdict.linear_user_id };
}

async function validateAssignee(
  supabase: SupabaseClient,
  assigneeId: string,
  team: string,
): Promise<void> {
  await assertEligibleAssignee(supabase, assigneeId, team);
}

async function validateCreateAssignee(
  supabase: SupabaseClient,
  assigneeId: string,
  team: string,
): Promise<{ id: string; linearUserId: string } | null> {
  return await assertEligibleAssignee(supabase, assigneeId, team);
}

async function mappedCreateAssignees(
  supabase: SupabaseClient,
  team: string,
): Promise<JsonMap[]> {
  const normalizedTeam = normalizeTeam(team);
  if (!normalizedTeam) throw new GatewayError(400, "invalid_team");
  const { data, error } = await supabase.from("team_members")
    .select("id,name,role,team,active,linear_user_id")
    .eq("active", true)
    .eq("team", normalizedTeam);
  if (error) throw new GatewayError(503, "assignee_lookup_unavailable");
  const rows = (data || []) as JsonMap[];
  const context = await assigneeEligibilityContext(supabase, rows.length > 0);
  return eligibleAssigneeProjection(rows, normalizedTeam, {
    providerMappingRequired: context.providerMappingRequired,
    providerActiveFor: context.providerActiveFor,
  }) as unknown as JsonMap[];
}

async function autoAssigneeForIntake(supabase: SupabaseClient, team: string): Promise<string> {
  const normalizedTeam = normalizeTeam(team);
  const { data, error } = await supabase.from("team_members")
    .select("id,name,role,team,linear_user_id,default_for_team,active")
    .eq("active", true)
    .eq("team", normalizedTeam);
  if (error) throw new GatewayError(503, "assignee_lookup_unavailable");
  const members = ((data || []) as JsonMap[])
    .filter(member => clean(member.linear_user_id))
    .sort((left, right) => clean(left.name).localeCompare(clean(right.name)) || clean(left.id).localeCompare(clean(right.id)));
  if (normalizedTeam === "graphics") {
    const defaults = members.filter(member => member.default_for_team === true);
    if (defaults.length !== 1) throw new GatewayError(409, "graphics_default_assignee_unavailable");
    return clean(defaults[0].id);
  }

  const editors = members.filter(member => lower(member.role) === "editor");
  if (!editors.length) throw new GatewayError(409, "video_assignee_pool_unavailable");
  /*
   * "Freest" has to mean free NOW.
   *
   * This counted every video row that was not a duplicate — including work
   * finished, approved and posted months ago. So the load never fell, and the
   * pick drifted permanently toward whoever joined the roster most recently
   * rather than whoever actually has room this week. It read as a balancer and
   * behaved as a seniority ranking.
   *
   * Counting only work that is still on someone's plate is also what the owner
   * asked the Create Post picker to show (2026-08-24: "by default it should be
   * the one that's the freest"). The UI names the person it is about to assign,
   * so this number is now visible to whoever creates a post — which is the
   * other reason it had to stop being a lifetime tally.
   */
  const { data: deliverables, error: loadError } = await supabase.from("deliverables")
    .select("assignee_id,status,linear_issue_uuid")
    .eq("team", "video")
    .in("status", INTAKE_LOAD_LIVE_STATUSES as unknown as string[]);
  if (loadError) throw new GatewayError(503, "assignee_load_unavailable");
  /*
   * A BATCH PARENT IS NOT ON ANYONE'S PLATE.
   *
   * Measured 2026-08-27: 75 of 535 open deliverable rows are batch parent
   * issues — the container that titles a batch and carries its brief — about
   * 30 of them assigned to a person. Counting them here charged an editor for
   * a row nobody can complete, so the "freest" pick drifted toward whoever
   * happened to hold fewer briefs, not fewer videos. A row is a parent when
   * some other row names its issue as `raw_issue_parent_id`; children may sit
   * in any status, so the parent set is read over the whole team rather than
   * derived from the open rows alone. If this read fails the count proceeds
   * uncorrected — a slightly skewed suggestion beats a refused submission.
   */
  let parentUuids = new Set<string>();
  try {
    const { data: parentRows } = await supabase.from("deliverables")
      .select("raw_issue_parent_id")
      .eq("team", "video")
      .not("raw_issue_parent_id", "is", null);
    parentUuids = new Set(((parentRows || []) as JsonMap[])
      .map(row => clean(row.raw_issue_parent_id)).filter(Boolean));
  } catch (_) { parentUuids = new Set<string>(); }
  const load = new Map(editors.map(member => [clean(member.id), 0]));
  for (const row of (deliverables || []) as JsonMap[]) {
    if (parentUuids.has(clean(row.linear_issue_uuid))) continue;
    const id = clean(row.assignee_id);
    if (load.has(id)) load.set(id, Number(load.get(id) || 0) + 1);
  }
  editors.sort((left, right) =>
    Number(load.get(clean(left.id)) || 0) - Number(load.get(clean(right.id)) || 0)
    || clean(left.name).localeCompare(clean(right.name))
    || clean(left.id).localeCompare(clean(right.id))
  );
  return clean(editors[0].id);
}

/*
 * SUBMIT-TAB THUMBNAIL TEXT. Restored 2026-08-20 under the owner's ruling:
 * "I want to keep it as before... I just don't want that to affect a parent
 * issue or a video issue. I just want it to work when someone submits it
 * through the submit tab."
 *
 * HISTORY. A generator wrote the graphics child's brief from the client's
 * filming plan (ported from n8n in #810). The owner retired it on 2026-08-17
 * (#1079) after one of his own test posts produced an invented art-direction
 * brief about a real client -- "center frame, confident direct gaze, clean
 * gradient background in deep navy and gold tones" -- wording that appears in
 * no filming plan. The measured cause was NOT the model. The two clients with
 * real plans that day received grounded, plan-quoting text; both failures had
 * an effectively EMPTY plan (the TEST client's exports 7 bytes; another
 * exported 374 bytes of unfilled template) and the old code called the model
 * anyway with nothing to work from, then shipped whatever came back.
 *
 * Every hole that made the retirement necessary is closed here:
 *  1. SUBMIT TAB ONLY -- surface must be "submission". Every invented brief on
 *     2026-08-17 came from surface "calendar" (the create-thumbnail dialog), so
 *     the owner's own constraint excludes the exact surface that failed.
 *  2. NEW BATCHES ONLY -- appends belong to the calendar/samples dialogs.
 *  3. GRAPHICS CHILDREN ONLY, and only where no brief exists. The result is
 *     consumed inside the existing `team === "graphics"` branch. The batch row
 *     is built afterwards from intakePlan alone and never reads an item brief,
 *     and the video item's brief expression is untouched -- so the parent issue
 *     and the video issue are unreachable from here by construction.
 *  4. A REAL, SERVER-RESOLVED PLAN -- planStatus must be "resolved_server": a
 *     protected server mapping matched, not a link somebody pasted.
 *  5. A SUBSTANTIVE PLAN -- the exported text must clear MIN_PLAN_CHARS. This
 *     is the single condition whose absence caused the incident.
 *  6. GROUNDED OUTPUT -- every significant word the model returns must already
 *     appear in the plan. "gradient", "navy" and "tones" appear in no plan, so
 *     the exact text that caused the retirement cannot survive this check even
 *     if a model produced it again.
 *  7. SHORT -- the target is the text ON the thumbnail, so anything longer than
 *     MAX_THUMBNAIL_TEXT_CHARS is dropped. The retired output was a paragraph
 *     of art direction; this is the mechanical floor under that drift.
 *  8. NEVER FAILS A SUBMISSION -- a missing secret, transport error, bad JSON,
 *     over-long or ungrounded line yields NO text for that item and the intake
 *     proceeds exactly as it does today, with an honestly empty brief. The
 *     retired version threw 502/503 and refused the whole intake; that
 *     behaviour must not come back.
 *
 * The instruction lives HERE rather than in the old GRAPHIC_TITLE_PROMPT
 * secret. The retired generator's output had silently drifted from the n8n
 * original's short thumbnail titles to art-direction sentences and nobody could
 * see it, because the prompt was invisible to review. It carries no client
 * data, so a public repo is the right place for it.
 */
const MIN_PLAN_CHARS = 500;
const MAX_THUMBNAIL_TEXT_CHARS = 120;
const DEFAULT_THUMBNAIL_TEXT_MODEL = "claude-sonnet-5";
const THUMBNAIL_TEXT_SYSTEM_PROMPT = [
  "You write the short line of text that appears ON a social-media thumbnail.",
  "You are given one client's filming plan and a list of video numbers.",
  "For each video number requested, return the thumbnail text for that video,",
  "drawn from what the filming plan actually says about that video.",
  "",
  "Rules:",
  "- Use only wording and subject matter the filming plan states. Never introduce a",
  "  fact, name, place, colour, wardrobe detail, camera direction or any art",
  "  direction the plan does not contain.",
  "- Two to six words. It is a headline that goes on the image, not a sentence and",
  "  not a description of what the image should look like.",
  "- If the plan does not clearly cover a requested video number, omit that number.",
  "- Omitting is always correct when you are unsure. A missing line costs nothing;",
  "  an invented one is a defect.",
  "",
  'Return ONLY a JSON array of {"videoNumber": <integer>, "title": <string>}.',
].join("\n");
const THUMBNAIL_TEXT_STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "for", "from",
  "has", "have", "how", "in", "into", "is", "it", "its", "of", "on", "or", "that",
  "the", "their", "them", "then", "they", "this", "to", "was", "were", "what",
  "when", "which", "why", "will", "with", "you", "your",
]);

function normalizedPlanText(value: string): string {
  return lower(value).replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ");
}

/*
 * Grounding: every SIGNIFICANT word must already appear in the plan. Substring
 * containment rather than whole-word equality is deliberate, so ordinary
 * inflection ("hairstyle" inside "hairstyles") passes while a word the plan
 * never uses cannot. A line with no significant words at all fails -- that
 * prevents a vacuous pass on something like "The Best Of It".
 */
function thumbnailTextGrounded(text: string, plan: string): boolean {
  const significant = normalizedPlanText(text).split(" ")
    .filter(word => word.length >= 4 && !THUMBNAIL_TEXT_STOPWORDS.has(word));
  if (!significant.length) return false;
  return significant.every(word => plan.includes(word));
}

async function submissionThumbnailText(
  supabase: SupabaseClient,
  client: ClientRow,
  batchInput: JsonMap,
  items: JsonMap[],
  existingById: Map<string, JsonMap>,
  deliverableIds: string[],
  gate: {
    surface: string;
    appendToBatch: boolean;
    planStatus: string;
    skipGeneration: boolean;
  },
): Promise<Map<number, string>> {
  const empty = new Map<number, string>();
  // Gates 1, 2, 4 and the test-principal skip. Each returns the empty map, so
  // every downstream brief stays exactly what it is today.
  if (gate.skipGeneration) return empty;
  if (lower(gate.surface) !== "submission") return empty;
  if (gate.appendToBatch === true) return empty;
  if (clean(gate.planStatus) !== "resolved_server") return empty;

  // Gate 3: graphics children with no brief from either the caller or a prior
  // attempt. A caller-supplied brief always wins; the server never overwrites.
  const needed = items.map((item, index) => ({ item, index }))
    .filter(({ item }) => normalizeTeam(item.team) === "graphics")
    .filter(({ item }) => !clean(item.brief))
    .filter(({ index }) => !clean(existingById.get(deliverableIds[index])?.brief));
  if (!needed.length) return empty;

  const apiKey = clean(Deno.env.get("GRAPHIC_TITLE_API_KEY"));
  if (!apiKey) return empty;
  const model = clean(Deno.env.get("GRAPHIC_TITLE_MODEL")) || DEFAULT_THUMBNAIL_TEXT_MODEL;

  // Gate 5: the plan must exist and be substantive. Read server-side by slug --
  // filming plans hold internal Doc URLs and stay unreadable to the browser.
  let planText = "";
  try {
    const { data: plan, error } = await supabase.from("filming_plans")
      .select("doc_id")
      .eq("client_slug", client.slug)
      .maybeSingle();
    if (error) return empty;
    const docId = clean(plan && (plan as JsonMap).doc_id);
    if (!docId) return empty;
    const planResponse = await fetch(
      `https://docs.google.com/document/d/${encodeURIComponent(docId)}/export?format=txt`,
    );
    if (!planResponse.ok) return empty;
    planText = (await planResponse.text()).slice(0, 20_000);
  } catch (_error) {
    return empty;
  }
  if (clean(planText).length < MIN_PLAN_CHARS) return empty;
  const plan = normalizedPlanText(planText);

  let providerBody: JsonMap | null = null;
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1_000,
        system: THUMBNAIL_TEXT_SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: JSON.stringify({
            client: client.display_name,
            submissionTitle: clean(batchInput.name),
            notes: clean(batchInput.notes),
            filmingPlan: planText,
            videos: needed.map(({ item, index }) => ({
              videoNumber: Number(item.videoNumber ?? item.number ?? index + 1),
            })),
          }),
        }],
      }),
    });
    if (!response.ok) return empty;
    providerBody = await response.json().catch(() => null) as JsonMap | null;
  } catch (_error) {
    return empty;
  }
  // Gate 8: no provider failure may reach the caller. Every path from here
  // returns a map -- possibly an empty one -- and never throws.
  if (!providerBody || !Array.isArray(providerBody.content)) return empty;

  const text = providerBody.content.map(part => parseJson(part))
    .filter(part => lower(part.type) === "text")
    .map(part => String(part.text || ""))
    .join("\n")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch (_error) {
    const arrayStart = text.indexOf("[");
    const arrayEnd = text.lastIndexOf("]");
    if (arrayStart < 0 || arrayEnd <= arrayStart) return empty;
    try {
      parsed = JSON.parse(text.slice(arrayStart, arrayEnd + 1));
    } catch (_nestedError) {
      return empty;
    }
  }
  if (!Array.isArray(parsed)) return empty;

  const requestedNumbers = new Set(needed.map(({ item, index }) =>
    Number(item.videoNumber ?? item.number ?? index + 1)
  ));
  const firstByNumber = new Map<number, string>();
  for (const raw of parsed) {
    const row = parseJson(raw);
    const number = row.videoNumber;
    const title = typeof row.title === "string" ? clean(row.title) : "";
    if (typeof number !== "number"
        || !Number.isInteger(number)
        || !requestedNumbers.has(number)
        || !title
        // Gate 7: thumbnail TEXT, not an art-direction paragraph.
        || title.length > MAX_THUMBNAIL_TEXT_CHARS
        // Gate 6: nothing the plan does not already say.
        || !thumbnailTextGrounded(title, plan)) continue;
    // The first valid line for a requested number wins, so a retry of the same
    // provider response resolves identically.
    if (!firstByNumber.has(number)) firstByNumber.set(number, title);
  }

  const resolved = new Map<number, string>();
  for (const { item, index } of needed) {
    const number = Number(item.videoNumber ?? item.number ?? index + 1);
    const title = firstByNumber.get(number);
    // No fallback text. An item the model skipped, or whose line failed a gate,
    // keeps the empty brief it has today -- honestly empty beats confidently
    // wrong, which is the ruling that retired the previous generator.
    if (title) resolved.set(index, title);
  }
  return resolved;
}

type ProductionCreateScope = {
  principal: Principal;
  client: ClientRow;
  clientSlug: string;
  team: string;
  projectId: string;
  teamId: string;
  authority: "linear" | "syncview";
};

type ProductionCreatePrincipalScope = {
  principal: Principal;
  client: ClientRow;
  clientSlug: string;
  team: string;
};

type ProductionCreateParentRoute = {
  parent: JsonMap;
  batch: JsonMap;
  parentLinearIssueId: string;
  dependsOnId: number | null;
  dependencyDedupKey: string | null;
};

async function productionCreatePrincipalScope(
  supabase: SupabaseClient,
  req: Request,
  body: JsonMap,
): Promise<ProductionCreatePrincipalScope> {
  const clientSlug = clean(body.client_slug);
  const team = normalizeTeam(body.team);
  if (!clientSlug || !team) throw new GatewayError(400, "invalid_production_create_scope");
  const principal = await authenticate(supabase, req, body, clientSlug);
  if (principal.kind === "client"
      || (principal.kind === "staff"
        && !staffOperationAllowed(principal.keyRole, "create", principal.memberTeam, team))) {
    throw new GatewayError(403, "operation_forbidden");
  }
  const client = principal.client || await clientBySlug(supabase, clientSlug);
  if (!client || client.active !== true) throw new GatewayError(403, "client_inactive");
  if (lower(client.kind) === "test" && !principal.testOnly) {
    throw new GatewayError(403, "test_scope_service_only");
  }
  return { principal, client, clientSlug, team };
}

async function productionCreateScope(
  supabase: SupabaseClient,
  req: Request,
  body: JsonMap,
  authenticated: ProductionCreatePrincipalScope | null = null,
): Promise<ProductionCreateScope> {
  const base = authenticated || await productionCreatePrincipalScope(supabase, req, body);
  const { principal, client, clientSlug, team } = base;
  const projectId = await projectForIntake(client, team, principal);
  const authority = principal.testOnly ? "syncview" : await authorityFor(supabase, team);
  authorityLane(authority, principal, "production", "create", false);
  const teamId = teamIdFor(team);
  if (!teamId) throw new GatewayError(503, "linear_team_mapping_unavailable");
  return { principal, client, clientSlug, team, projectId, teamId, authority };
}

function sameInstant(left: unknown, right: unknown): boolean {
  const leftMs = Date.parse(clean(left));
  const rightMs = Date.parse(clean(right));
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
}

async function productionCreateReplay(
  supabase: SupabaseClient,
  scope: ProductionCreatePrincipalScope,
  intent: {
    deliverableId: string;
    rootBatchId: string;
    dedup: string;
    plannedLinearIssueId: string;
    parentId: string;
    title: string;
    description: string;
    status: string;
    dueDate: string | null;
    assigneeId: string;
    labelIds: string[];
    sourceEditedAt: string;
  },
): Promise<Response | null> {
  const { data: outboxData, error: outboxError } = await supabase.from("mirror_outbox")
    .select("*")
    .eq("dedup_key", intent.dedup)
    .maybeSingle();
  if (outboxError) throw new GatewayError(503, "create_replay_lookup_unavailable");
  if (!outboxData) return null;

  const outbox = outboxData as JsonMap;
  const payload = parseJson(outbox.payload);
  const fingerprint = clean(payload._intent_fingerprint);
  const payloadLabelIds = canonicalLabelIds(payload.label_ids);
  const expectedAssigneeId = intent.assigneeId || "";
  const expectedDueDate = intent.dueDate || "";
  if (clean(outbox.entity) !== "deliverable"
      || clean(outbox.entity_id) !== intent.deliverableId
      || clean(outbox.operation) !== "create"
      || clean(outbox.client_slug) !== scope.clientSlug
      || normalizeTeam(outbox.team) !== scope.team
      || clean(outbox.role) !== scope.principal.actorRole
      || outbox.test_only !== scope.principal.testOnly
      || outbox.legacy_parity !== false
      || !sameInstant(outbox.source_edited_at, intent.sourceEditedAt)
      || !fingerprint
      || clean(payload.planned_linear_issue_id) !== intent.plannedLinearIssueId
      || clean(payload.title) !== intent.title
      || typeof payload.description !== "string"
      || payload.description !== intent.description
      || clean(payload.status) !== intent.status
      || (clean(payload.due_date) || "") !== expectedDueDate
      || (clean(payload.assignee_id) || "") !== expectedAssigneeId
      || (expectedAssigneeId ? !clean(payload.linear_user_id) : !!clean(payload.linear_user_id))
      || !payloadLabelIds
      || JSON.stringify(payloadLabelIds) !== JSON.stringify(intent.labelIds)
      || JSON.stringify(payload.label_ids) !== JSON.stringify(intent.labelIds)
      || !clean(payload.project_id)
      || !clean(payload.team_id)
      || !clean(payload.state_id)
      || !Number.isSafeInteger(Number(payload._f27_authority_generation))
      || payload._f27_legacy_parity !== false) {
    throw new GatewayError(409, "idempotency_conflict");
  }

  const { data: rowData, error: rowError } = await supabase.from("deliverables")
    .select("*")
    .eq("id", intent.deliverableId)
    .maybeSingle();
  if (rowError) throw new GatewayError(503, "create_replay_lookup_unavailable");
  if (!rowData) throw new GatewayError(500, "idempotent_result_missing");
  const row = rowData as JsonMap;
  const batchId = clean(row.batch_id);
  if (!batchId
      || clean(row.id) !== intent.deliverableId
      || clean(row.client_slug) !== scope.clientSlug
      || normalizeTeam(row.team) !== scope.team
      || clean(row.kind) !== "other"
      || clean(row.origin) !== "manual"
      || clean(row.card_id)
      || clean(row.created_by) !== scope.principal.actorKey
      || !sameInstant(row.created_at, intent.sourceEditedAt)
      || clean(row.linear_issue_uuid) !== intent.plannedLinearIssueId
      || (!intent.parentId && batchId !== intent.rootBatchId)) {
    throw new GatewayError(500, "idempotent_result_missing");
  }

  const [batchResult, eventResult] = await Promise.all([
    supabase.from("batches").select("*").eq("id", batchId).maybeSingle(),
    supabase.from("deliverable_events").select("*")
      .eq("deliverable_id", intent.deliverableId)
      .eq("action", "create")
      .eq("source", "ui"),
  ]);
  if (batchResult.error || eventResult.error) {
    throw new GatewayError(503, "create_replay_lookup_unavailable");
  }
  if (!batchResult.data) throw new GatewayError(500, "idempotent_result_missing");
  const batch = batchResult.data as JsonMap;
  const events = (eventResult.data || []) as JsonMap[];
  const receiptEvents = events.filter(event => {
    const eventPayload = parseJson(event.payload);
    const redacted = parseJson(eventPayload.outbound_redacted);
    return clean(event.batch_id) === batchId
      && clean(event.client_slug) === scope.clientSlug
      && clean(event.actor) === clean(outbox.actor)
      && clean(event.role) === scope.principal.actorRole
      && clean(event.to_status) === intent.status
      && sameInstant(event.ts, intent.sourceEditedAt)
      && eventPayload.surface === "production"
      && clean(eventPayload.actor_key) === scope.principal.actorKey
      && clean(eventPayload.auth_kind) === scope.principal.kind
      && !Object.prototype.hasOwnProperty.call(eventPayload, "outbound")
      && clean(redacted.operation) === "create"
      && clean(redacted.dedup_key) === intent.dedup
      && clean(redacted.intent_fingerprint) === fingerprint;
  });
  if (receiptEvents.length !== 1
      || clean(batch.id) !== batchId
      || clean(batch.client_slug) !== scope.clientSlug
      || (normalizeTeam(batch.team) && normalizeTeam(batch.team) !== scope.team)) {
    throw new GatewayError(500, "idempotent_result_missing");
  }
  const receiptPayload = parseJson(receiptEvents[0].payload);
  if ((clean(receiptPayload.parent_deliverable_id) || "") !== (intent.parentId || "")) {
    throw new GatewayError(409, "idempotency_conflict");
  }

  const batchParentIds = parentIdsForTeam(batch.linear_parent_ids, scope.team);
  if (!intent.parentId) {
    if (currentLinearParentIssueId(row)
        || clean(payload.parent_linear_issue_id)
        || (Number.isSafeInteger(Number(outbox.depends_on_id))
          && Number(outbox.depends_on_id) > 0)) {
      throw new GatewayError(500, "idempotent_result_missing");
    }
    const { data: structuralEvents, error: structuralError } = await supabase
      .from("deliverable_events")
      .select("*")
      .eq("batch_id", batchId)
      .eq("action", "production_issue_container_create")
      .eq("source", "system");
    if (structuralError) throw new GatewayError(503, "create_replay_lookup_unavailable");
    const exactStructuralEvents = ((structuralEvents || []) as JsonMap[]).filter(event => {
      const eventPayload = parseJson(event.payload);
      return !clean(event.deliverable_id)
        && clean(event.client_slug) === scope.clientSlug
        && clean(event.actor) === clean(outbox.actor)
        && clean(event.role) === scope.principal.actorRole
        && sameInstant(event.ts, intent.sourceEditedAt)
        && eventPayload.surface === "production"
        && clean(eventPayload.deliverable_id) === intent.deliverableId
        && eventPayload.structural_only === true;
    });
    if (batchParentIds.length !== 1
        || batchParentIds[0] !== intent.plannedLinearIssueId
        || exactStructuralEvents.length !== 1) {
      throw new GatewayError(500, "idempotent_result_missing");
    }
  } else {
    const { data: parentData, error: parentError } = await supabase.from("deliverables")
      .select("*")
      .eq("id", intent.parentId)
      .maybeSingle();
    if (parentError) throw new GatewayError(503, "create_replay_lookup_unavailable");
    if (!parentData) throw new GatewayError(500, "idempotent_result_missing");
    const parent = parentData as JsonMap;
    const parentLinearId = parentLinearIssueId(parent);
    const rowParentLinearId = currentLinearParentIssueId(row);
    const directParentId = clean(payload.parent_linear_issue_id);
    const dependencyId = Number(outbox.depends_on_id || 0);
    if (clean(parent.batch_id) !== batchId
        || clean(parent.client_slug) !== scope.clientSlug
        || normalizeTeam(parent.team) !== scope.team
        || !parentLinearId
        || currentLinearParentIssueId(parent)
        || rowParentLinearId !== parentLinearId
        || batchParentIds.length !== 1
        || batchParentIds[0] !== parentLinearId
        || (!!directParentId === (Number.isSafeInteger(dependencyId) && dependencyId > 0))
        || (directParentId && directParentId !== parentLinearId)) {
      throw new GatewayError(500, "idempotent_result_missing");
    }
    if (Number.isSafeInteger(dependencyId) && dependencyId > 0) {
      const { data: dependency, error: dependencyError } = await supabase.from("mirror_outbox")
        .select("id,entity,entity_id,operation,client_slug,team")
        .eq("id", dependencyId)
        .maybeSingle();
      if (dependencyError) throw new GatewayError(503, "create_replay_lookup_unavailable");
      if (!dependency
          || clean(dependency.entity) !== "deliverable"
          || clean(dependency.entity_id) !== intent.parentId
          || clean(dependency.operation) !== "create"
          || clean(dependency.client_slug) !== scope.clientSlug
          || normalizeTeam(dependency.team) !== scope.team) {
        throw new GatewayError(500, "idempotent_result_missing");
      }
    }
  }

  const targetStatus = lower(outbox.status);
  const conflict = parseJson(parseJson(outbox.linear_result).conflict);
  if (targetStatus === "skipped" && lower(conflict.decision) === "idempotency_conflict") {
    throw new GatewayError(409, "idempotency_conflict", {
      native_committed: true,
      row: {
        ...publicDescriptionRow(row),
        ...selectedLabelReceipt(row),
      },
      batch: publicRow(batch),
      mirror_pending: false,
      mirror: [{
        dedup_key: intent.dedup,
        attempted: false,
        acknowledged: false,
        replay: true,
        terminal_conflict: true,
        target_status: targetStatus,
      }],
    });
  }
  const acknowledged = targetStatus === "written"
    || (targetStatus === "skipped"
      && ["already_applied", "already_exists"].includes(lower(conflict.decision)));
  return json({
    ok: true,
    native_committed: true,
    authority: "syncview",
    row: {
      ...publicDescriptionRow(row),
      ...selectedLabelReceipt(row),
    },
    batch: publicRow(batch),
    mirror_pending: !acknowledged,
    mirror: [{
      dedup_key: intent.dedup,
      attempted: false,
      acknowledged,
      replay: true,
      target_status: targetStatus || null,
    }],
  }, 200);
}

async function handleCreateOptions(
  supabase: SupabaseClient,
  req: Request,
  body: JsonMap,
): Promise<Response> {
  if (surfaceFor(body) !== "production") {
    throw new GatewayError(400, "invalid_surface_operation");
  }
  const scope = await productionCreateScope(supabase, req, body);
  const [catalog, assignees] = await Promise.all([
    linearLabelCatalog(scope.teamId, scope.team),
    mappedCreateAssignees(supabase, scope.team),
  ]);
  return json({
    ok: true,
    complete: true,
    authority: scope.authority,
    catalog,
    assignees,
  });
}

// F94 — the picker's source of truth. It resolves the target deliverable's own
// team and returns exactly the projection the commit will accept, so a stale
// or hand-built picker can no longer offer a candidate the gateway refuses.
// Only callers who may actually perform the assignee operation may read it.
async function handleAssigneeOptions(
  supabase: SupabaseClient,
  req: Request,
  body: JsonMap,
): Promise<Response> {
  if (surfaceFor(body) !== "production") {
    throw new GatewayError(400, "invalid_surface_operation");
  }
  const id = clean(body.id);
  if (!id) throw new GatewayError(400, "entity_id_required");
  const requestedClientSlug = clean(body.client_slug);
  if (!requestedClientSlug) throw new GatewayError(400, "client_slug_required");
  // Same anti-enumeration ordering as the other protected reads: authenticate
  // against the declared roster scope before the id is resolved, and collapse
  // every miss into one 403.
  const principal = await authenticate(supabase, req, body, requestedClientSlug);
  if (principal.kind === "client") throw new GatewayError(403, "assignee_scope_forbidden");
  const client = principal.client || await clientBySlug(supabase, requestedClientSlug);
  if (!client || client.active !== true) throw new GatewayError(403, "assignee_scope_forbidden");
  const { data, error } = await supabase.from("deliverables")
    .select("id,client_slug,team,status,assignee_id")
    .eq("id", id)
    .eq("client_slug", requestedClientSlug)
    .maybeSingle();
  if (error) throw new GatewayError(503, "entity_lookup_unavailable");
  if (!data) throw new GatewayError(403, "assignee_scope_forbidden");
  const existing = data as JsonMap;
  const team = normalizeTeam(existing.team);
  if (!team) throw new GatewayError(403, "assignee_scope_forbidden");
  if (principal.kind === "staff"
      && !staffOperationAllowed(principal.keyRole, "assignee", principal.memberTeam, team, "", {
        currentStatus: lower(existing.status),
        targetAssigneeId: clean(existing.assignee_id),
        actorMemberId: clean(principal.memberId),
      })) {
    throw new GatewayError(403, "assignee_scope_forbidden");
  }
  return json({
    ok: true,
    complete: true,
    id,
    client_slug: clean(existing.client_slug),
    team,
    current_assignee_id: clean(existing.assignee_id) || null,
    assignees: await mappedCreateAssignees(supabase, team),
  });
}

function parentLinearIssueId(value: JsonMap): string {
  return clean(value.linear_issue_uuid || parseJson(parseJson(value.linear_raw).issue).id);
}

function currentLinearParentIssueId(value: JsonMap): string {
  const issue = parseJson(parseJson(value.linear_raw).issue);
  return clean(parseJson(issue.parent).id || issue.parentId);
}

async function productionCreateParentRoute(
  supabase: SupabaseClient,
  parentId: string,
  scope: ProductionCreateScope,
): Promise<ProductionCreateParentRoute | null> {
  if (!parentId) return null;
  const { data: parentData, error: parentError } = await supabase.from("deliverables")
    .select("*")
    .eq("id", parentId)
    .maybeSingle();
  if (parentError) throw new GatewayError(503, "create_parent_lookup_unavailable");
  if (!parentData) throw new GatewayError(404, "create_parent_not_found");
  const parent = parentData as JsonMap;
  await assertDeliverableIdentityWritable(supabase, parent);
  const raw = parseJson(parent.linear_raw);
  const issue = parseJson(raw.issue);
  const attribution = parseJson(raw.attribution);
  const parentProjectId = clean(parseJson(issue.project).id);
  const linearIssueId = parentLinearIssueId(parent);
  if (clean(parent.client_slug) !== scope.clientSlug
      || normalizeTeam(parent.team) !== scope.team
      || attribution.state !== "resolved"
      || clean(attribution.client_slug) !== scope.clientSlug
      || parentProjectId !== scope.projectId
      || !linearIssueId) {
    throw new GatewayError(409, "production_create_parent_scope");
  }
  if (clean(parseJson(issue.parent).id || issue.parentId)) {
    throw new GatewayError(409, "production_create_parent_nested");
  }

  const { data: batchData, error: batchError } = await supabase.from("batches")
    .select("*")
    .eq("id", clean(parent.batch_id))
    .maybeSingle();
  if (batchError) throw new GatewayError(503, "batch_lookup_unavailable");
  if (!batchData
      || clean(batchData.client_slug) !== scope.clientSlug
      || (normalizeTeam(batchData.team) && normalizeTeam(batchData.team) !== scope.team)
      || lower(batchData.status) !== "active") {
    throw new GatewayError(409, "production_create_batch_scope");
  }
  const batch = batchData as JsonMap;
  const batchParentIds = parentIdsForTeam(batch.linear_parent_ids, scope.team);
  if (batchParentIds.length !== 1 || batchParentIds[0] !== linearIssueId) {
    throw new GatewayError(409, "production_create_parent_route");
  }

  const { data: dependencyRows, error: dependencyError } = await supabase.from("mirror_outbox")
    .select("id,dedup_key,status,entity,entity_id,operation,client_slug,team,payload,linear_result,test_only,legacy_parity")
    .eq("entity", "deliverable")
    .eq("entity_id", parentId)
    .eq("operation", "create")
    .eq("client_slug", scope.clientSlug)
    .eq("team", scope.team);
  if (dependencyError) throw new GatewayError(503, "create_parent_lookup_unavailable");
  const candidates = ((dependencyRows || []) as JsonMap[]).filter(row =>
    ["pending", "failed", "shadow_ok", "written"].includes(lower(row.status))
      && clean(parseJson(row.payload).project_id) === scope.projectId
  );
  if (((dependencyRows || []) as JsonMap[]).some(row => {
    const conflict = parseJson(parseJson(row.linear_result).conflict);
    return lower(row.status) === "skipped"
      && clean(parseJson(row.payload).project_id) === scope.projectId
      && lower(conflict.decision) === "idempotency_conflict";
  })) {
    throw new GatewayError(409, "production_create_parent_route");
  }
  if (candidates.length > 1) throw new GatewayError(409, "production_create_parent_route");
  if (candidates.length === 1) {
    const dependency = candidates[0];
    const dependencyId = Number(dependency.id);
    const dependencyDedupKey = clean(dependency.dedup_key);
    if (!Number.isSafeInteger(dependencyId) || dependencyId < 1 || !dependencyDedupKey) {
      throw new GatewayError(409, "production_create_parent_route");
    }
    if (lower(dependency.status) === "written") {
      const result = parseJson(dependency.linear_result);
      const resultId = clean(result.issue_id || result.linear_issue_id || parseJson(result.issue).id);
      if (resultId !== linearIssueId) {
        throw new GatewayError(409, "production_create_parent_route");
      }
      await validateLinearBatchParent(linearIssueId, scope.team, scope.projectId, true);
    } else if (dependency.test_only !== scope.principal.testOnly
        || dependency.legacy_parity === true) {
      throw new GatewayError(409, "production_create_parent_route");
    }
    return {
      parent,
      batch,
      parentLinearIssueId: linearIssueId,
      dependsOnId: dependencyId,
      dependencyDedupKey,
    };
  }
  await validateLinearBatchParent(linearIssueId, scope.team, scope.projectId, true);
  return {
    parent,
    batch,
    parentLinearIssueId: linearIssueId,
    dependsOnId: null,
    dependencyDedupKey: null,
  };
}

async function handleProductionCreate(
  supabase: SupabaseClient,
  req: Request,
  body: JsonMap,
  surface: string,
  requestId: string,
  sourceEditedAt: string,
): Promise<Response> {
  if (surface !== "production"
      || Object.keys(body).some(key => !PRODUCTION_CREATE_FIELDS.has(key))) {
    throw new GatewayError(400, "unsupported_create_field");
  }
  const title = typeof body.title === "string" ? clean(body.title) : "";
  const description = canonicalDescription(body.description);
  const status = lower(body.status);
  const dueDate = body.due_date == null || body.due_date === "" ? null : clean(body.due_date);
  const assigneeId = body.assignee_id == null || body.assignee_id === ""
    ? ""
    : typeof body.assignee_id === "string"
      ? clean(body.assignee_id)
      : "";
  const labelIds = canonicalLabelIds(body.label_ids);
  const parentId = body.parent_id == null || body.parent_id === ""
    ? ""
    : typeof body.parent_id === "string"
      ? clean(body.parent_id)
      : "";
  if (!title || title.length > 500
      || description == null
      || !DELIVERABLE_STATUSES.includes(status)
      || !validDateOrNull(dueDate)
      || !Array.isArray(body.label_ids)
      || !labelIds
      || (body.assignee_id != null && body.assignee_id !== "" && !assigneeId)
      || (body.parent_id != null && body.parent_id !== "" && !parentId)) {
    throw new GatewayError(400, "invalid_production_create_payload");
  }

  const principalScope = await productionCreatePrincipalScope(supabase, req, body);
  const deliverableId = await deterministicNativeId("del", requestId, "production-issue");
  const rootBatchId = await deterministicNativeId("bat", requestId, "production-root");
  const dedup = dedupKey("create", "deliverable", deliverableId, requestId);
  const plannedLinearIssueId = await deterministicLinearCreateId(dedup);
  const replay = await productionCreateReplay(supabase, principalScope, {
    deliverableId,
    rootBatchId,
    dedup,
    plannedLinearIssueId,
    parentId,
    title,
    description,
    status,
    dueDate,
    assigneeId,
    labelIds,
    sourceEditedAt,
  });
  if (replay) return replay;

  /*
   * Owner ruling 2026-08-23: nothing is created from the Production tab.
   *
   * Placed HERE, after productionCreateReplay, on purpose. A browser draft
   * marked `ambiguous` means its create may already have committed; the replay
   * above is the only path that ever hands that row back to its author.
   * Refusing before the replay would strand a committed row with no card and
   * no owner -- manufacturing the exact orphan this closure exists to prevent.
   * After the replay, every request that reaches this line is a NEW create.
   */
  throw new GatewayError(403, "production_create_closed");

  const scope = await productionCreateScope(supabase, req, body, principalScope);
  if (scope.team === "graphics" && status === "smm_approval") {
    throw new GatewayError(409, "artifact_not_resolvable", {
      asset_state: "missing",
      checked_at: new Date().toISOString(),
      guidance: assetGuidance("missing"),
    });
  }
  const [authorityGeneration, stateId, catalog, assignee, parentRoute] = await Promise.all([
    f27WriteAuthorizationGeneration(supabase, scope.team),
    linearStateIdForCreate(scope.teamId, scope.team, status),
    linearLabelCatalog(scope.teamId, scope.team),
    validateCreateAssignee(supabase, assigneeId, scope.team),
    productionCreateParentRoute(supabase, parentId, scope),
  ]);
  const catalogById = new Map(catalog.map(label => [clean(label.id), label]));
  if (labelIds.some(id => !catalogById.has(id))) {
    throw new GatewayError(400, "label_selection_out_of_catalog", { complete: true });
  }
  const selectedLabels = labelIds.map(id => catalogById.get(id) as JsonMap);
  const batchId = parentRoute
    ? clean(parentRoute.batch.id)
    : rootBatchId;
  const parentLinearId = parentRoute ? parentRoute.parentLinearIssueId : "";
  const teamKey = scope.team === "graphics" ? "GRA" : "VID";
  // Full f200 key set. `ancestor_issue_id` and `ancestor_distance` are
  // definitionally null for `source: "direct_project"` -- omitting them made
  // the reconciler's stamp comparison structurally unsatisfiable, because a
  // missing key and an explicit null are not the same JSON.
  //
  // `mapping_revision` stays empty on purpose. It is a sha256 over the entire
  // client roster, so a writer that stamped the current value would produce a
  // row that matches only until the next onboarding, at which point every stamp
  // in the estate goes stale at once. The reconciler treats provenance as
  // non-gating and counts an empty revision separately from a stale one -- see
  // docs/audits/2026-08-05-attribution-stamp-soak-signal.md.
  const attribution: JsonMap = {
    schema: "syncview_attribution_v1",
    state: "resolved",
    client_slug: scope.clientSlug,
    owner_kind: lower(scope.client.kind || "client"),
    source: "direct_project",
    project_id: scope.projectId,
    direct_project_id: scope.projectId,
    ancestor_issue_id: null,
    ancestor_distance: null,
    mapping_revision: "",
    repair_required: false,
    reason: "direct_project_mapped",
  };
  const linearIssue: JsonMap = {
    id: plannedLinearIssueId,
    identifier: null,
    title,
    description,
    createdAt: sourceEditedAt,
    updatedAt: sourceEditedAt,
    dueDate,
    state: { id: stateId, name: LINEAR_STATUS_NAMES[status] },
    team: { id: scope.teamId, key: teamKey },
    project: { id: scope.projectId },
    assignee: assignee ? { id: assignee.linearUserId } : null,
    parent: parentRoute
      ? {
        id: parentLinearId,
        identifier: clean(parentRoute.parent.linear_identifier) || null,
        title: clean(parentRoute.parent.title),
      }
      : null,
    labelIds,
    labels: {
      nodes: selectedLabels,
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
  const row: JsonMap = {
    id: deliverableId,
    identifier: null,
    batch_id: batchId,
    client_slug: scope.clientSlug,
    team: scope.team,
    kind: "other",
    title,
    brief: description,
    status,
    status_at: sourceEditedAt,
    assignee_id: assignee ? assignee.id : null,
    due_date: dueDate,
    priority: null,
    origin: "manual",
    card_id: null,
    sync_state: "pending",
    created_by: scope.principal.actorKey,
    created_at: sourceEditedAt,
    linear_issue_uuid: plannedLinearIssueId,
    linear_raw: { issue: linearIssue, attribution },
  };
  const batchRow: JsonMap | null = parentRoute ? null : {
    id: batchId,
    client_slug: scope.clientSlug,
    team: scope.team,
    name: title,
    description: null,
    status: "active",
    created_by: scope.principal.actorKey,
    created_at: sourceEditedAt,
    linear_parent_ids: {
      [scope.team]: {
        uuid: plannedLinearIssueId,
        identifier: "",
        url: "",
      },
    },
  };
  const routeFingerprint = {
    parent_id: parentId || null,
    parent_linear_issue_id: parentLinearId || null,
    depends_on_id: parentRoute?.dependsOnId || null,
    dependency_dedup_key: parentRoute?.dependencyDedupKey || null,
  };
  const fingerprint = await intentFingerprint({
    operation: "create",
    requestId,
    sourceEditedAt,
    surface,
    actorKey: scope.principal.actorKey,
    clientSlug: scope.clientSlug,
    team: scope.team,
    projectId: scope.projectId,
    teamId: scope.teamId,
    route: routeFingerprint,
    row: {
      id: deliverableId,
      batch_id: batchId,
      title,
      description,
      status,
      due_date: dueDate,
      assignee_id: assignee ? assignee.id : null,
      linear_user_id: assignee ? assignee.linearUserId : null,
      label_ids: labelIds,
      planned_linear_issue_id: plannedLinearIssueId,
    },
  });
  const outbound: JsonMap = {
    entity: "deliverable",
    entity_id: deliverableId,
    team: scope.team,
    operation: "create",
    dedup_key: dedup,
    source_edited_at: sourceEditedAt,
    test_only: scope.principal.testOnly,
    legacy_parity: false,
    ...(parentRoute?.dependsOnId ? { depends_on_id: parentRoute.dependsOnId } : {}),
    payload: f27FencedPayload({
      team_id: scope.teamId,
      project_id: scope.projectId,
      title,
      description,
      status,
      state_id: stateId,
      due_date: dueDate,
      assignee_id: assignee ? assignee.id : null,
      linear_user_id: assignee ? assignee.linearUserId : null,
      parent_linear_issue_id: parentRoute?.dependsOnId ? null : parentLinearId || null,
      label_ids: labelIds,
      planned_linear_issue_id: plannedLinearIssueId,
      _intent_fingerprint: fingerprint,
    }, authorityGeneration, false),
  };
  const event: JsonMap = {
    ...eventFor("create", scope.principal, sourceEditedAt, surface, outbound, null, status),
    parent_deliverable_id: parentId || null,
  };
  const preexisting = await assertDedupIntent(
    supabase,
    dedup,
    dedupExpectation(scope.principal, scope.team, sourceEditedAt, outbound, fingerprint),
  );
  const result = parseJson(await rpc(supabase, "production_issue_create", {
    p_batch: batchRow || {},
    p_row: row,
    p_event: event,
  }));
  const resultRow = parseJson(result.row);
  const resultBatch = parseJson(result.batch);
  if (!clean(resultRow.id) || !clean(resultBatch.id)) {
    throw new GatewayError(500, "native_response_refresh_failed");
  }

  const drainPlans = [
    ...(parentRoute?.dependencyDedupKey
      ? [{ dedup_key: parentRoute.dependencyDedupKey }]
      : []),
    { dedup_key: dedup },
  ];
  const mirror: JsonMap[] = [];
  if (scope.principal.testOnly) {
    for (const plan of drainPlans) {
      mirror.push({
        dedup_key: plan.dedup_key,
        ...await targetedDrain(clean(plan.dedup_key), scope.principal),
      });
    }
  } else if (await outboundLiveForDrain(supabase)) {
    scheduleSyncviewLiveDrains(drainPlans.map(plan => clean(plan.dedup_key)), scope.principal);
  }
  const targetedFailure = mirror.some(item => item.acknowledged !== true);
  const mirrorPending = scope.principal.testOnly ? targetedFailure : true;
  const [currentRowResult, currentBatchResult] = await Promise.all([
    supabase.from("deliverables").select("*").eq("id", deliverableId).maybeSingle(),
    supabase.from("batches").select("*").eq("id", batchId).maybeSingle(),
  ]);
  if (currentRowResult.error || currentBatchResult.error
      || !currentRowResult.data || !currentBatchResult.data) {
    throw new GatewayError(500, "native_response_refresh_failed");
  }
  const currentRow = currentRowResult.data as JsonMap;
  const terminalConflict = mirror.some(item =>
    item.terminal_conflict === true && clean(item.error) === "idempotency_conflict"
  );
  if (terminalConflict) {
    throw new GatewayError(409, "idempotency_conflict", {
      native_committed: true,
      row: {
        ...publicDescriptionRow(currentRow),
        ...selectedLabelReceipt(currentRow),
      },
      batch: publicRow(currentBatchResult.data),
      mirror_pending: false,
      mirror,
    });
  }
  return json({
    ok: true,
    native_committed: true,
    authority: scope.authority,
    row: {
      ...publicDescriptionRow(currentRow),
      ...selectedLabelReceipt(currentRow),
    },
    batch: publicRow(currentBatchResult.data),
    mirror_pending: mirrorPending,
    mirror,
  }, targetedFailure ? 202 : (preexisting || result.replay === true ? 200 : 201));
}

function linearIssueIdForLabels(row: JsonMap): string {
  const raw = parseJson(row.linear_raw);
  return clean(row.linear_issue_uuid || parseJson(raw.issue).id);
}

async function assetSnapshot(
  supabase: SupabaseClient,
  deliverable: JsonMap,
): Promise<JsonMap> {
  let batch: JsonMap = {};
  const batchId = clean(deliverable.batch_id);
  if (batchId) {
    const { data, error } = await supabase.from("batches").select(
      "id,client_slug,team,filming_doc_url,footage_folder_url,delivery_folder_url",
    ).eq("id", batchId).maybeSingle();
    if (error) throw new GatewayError(503, "asset_context_unavailable");
    batch = parseJson(data);
  }
  const values: Record<string, unknown> = {
    filming_plan: batch.filming_doc_url,
    raw_footage: batch.footage_folder_url,
    delivery_folder: batch.delivery_folder_url,
    deliverable_file: deliverable.file_url,
  };
  const deliverableId = clean(deliverable.id);
  const assets = await Promise.all(ASSET_SLOTS.map(async slot => {
    const evidence = await probeAssetUrl(slot.key, values[slot.key]);
    await recordAssetEvidence(supabase, deliverableId, slot.key, values[slot.key], evidence);
    // Typed asset columns are not browser-readable. Return the exact value only
    // inside this already-authorized, no-store response.
    return { ...evidence, url: clean(values[slot.key]) || null };
  }));
  return {
    checked_at: new Date().toISOString(),
    assets,
  };
}

/*
 * WHERE THE GRAPHICS ARTIFACT ACTUALLY LIVES (2026-08-16, post-flip).
 *
 * `deliverables.file_url` is the canonical artifact, and it is settable in
 * exactly two ways: the Production tab's attach box, and the B1 delivery-link
 * sweep, which harvests links out of LINEAR COMMENTS. The graphics flip retired
 * that second source on the very day it made this gate load-bearing — designers
 * work in SyncView now, so nothing posts delivery links in Linear any more.
 *
 * Measured the same day: 1,972 of 2,009 active graphics deliverables had no
 * canonical link at all. Thirty had one. Meanwhile the link the team DOES
 * paste — the calendar card's Thumbnail — was invisible to this gate: 6,431
 * cards carry one. The owner's own drill card held a perfectly canonical Drive
 * file link in that field and approval was still refused, with a dialog telling
 * him to reload the page.
 *
 * So when the canonical field is empty, fall back to the BOUND card's
 * thumbnail and hold it to the identical standard: canonical shape, live
 * probe, fresh recorded evidence, same slot. This widens WHERE the gate looks,
 * never WHAT it accepts. Only the card bound to this deliverable may speak
 * for it.
 *
 * It also does not widen what a CLIENT can influence, which is the first
 * question this fallback invites. `calendar_posts.thumbnail_url` is written by
 * `calendar-upsert`, which has no client-principal path at all (it reads a
 * staff key/actor; `x-syncview-client-token` appears only in its CORS header
 * list and is never consulted), and `clientOperationAllowed` admits a client to
 * comments plus one narrow status transition and nothing else. The link this
 * gate now reads is staff-written on every path.
 */
async function graphicsApprovalArtifactCandidate(
  supabase: SupabaseClient,
  deliverable: JsonMap,
): Promise<{ url: string; source: "deliverable" | "card" } | null> {
  const own = clean(deliverable.file_url);
  if (canonicalArtifactUrl(own)) return { url: own, source: "deliverable" };
  const cardId = clean(deliverable.card_id);
  const deliverableId = clean(deliverable.id);
  if (!cardId || !deliverableId) return null;
  const { data, error } = await supabase.from("calendar_posts")
    .select("id,thumbnail_url,graphic_deliverable_id")
    .eq("id", cardId)
    .maybeSingle();
  // A lookup failure must never collapse into "no artifact": that would turn a
  // transient database blip into a refusal the designer cannot explain or fix.
  if (error) throw new GatewayError(503, "entity_lookup_unavailable");
  const card = (data || {}) as JsonMap;
  if (clean(card.id) !== cardId) return null;
  // When the card names its graphic deliverable, that name must be this one. A
  // mismatch means the binding moved and the card no longer speaks for it.
  const bound = clean(card.graphic_deliverable_id);
  if (bound && bound !== deliverableId) return null;
  const thumb = clean(card.thumbnail_url);
  return canonicalArtifactUrl(thumb) ? { url: thumb, source: "card" } : null;
}

async function assertGraphicsApprovalArtifact(
  supabase: SupabaseClient,
  deliverable: JsonMap,
): Promise<void> {
  if (normalizeTeam(deliverable.team) !== "graphics") return;
  const candidate = await graphicsApprovalArtifactCandidate(supabase, deliverable);
  if (!candidate) {
    const state = clean(deliverable.file_url) ? "invalid" : "missing";
    throw new GatewayError(409, "artifact_not_resolvable", {
      asset_state: state,
      checked_at: new Date().toISOString(),
      guidance: assetGuidance(state),
    });
  }
  const evidence = await probeAssetUrl("deliverable_file", candidate.url);
  await recordAssetEvidence(
    supabase,
    clean(deliverable.id),
    "deliverable_file",
    candidate.url,
    evidence,
  );
  if (clean(evidence.state) !== "available") {
    throw new GatewayError(409, "artifact_not_resolvable", {
      asset_state: clean(evidence.state) || "unavailable",
      checked_at: clean(evidence.checked_at) || new Date().toISOString(),
      guidance: clean(evidence.guidance) || assetGuidance("unavailable"),
      artifact_source: candidate.source,
    });
  }
  await requireFreshAssetEvidence(
    supabase,
    clean(deliverable.id),
    "deliverable_file",
    candidate.url,
  );
}

async function handleAssetAccessRead(
  supabase: SupabaseClient,
  req: Request,
  body: JsonMap,
): Promise<Response> {
  if (surfaceFor(body) !== "production") {
    throw new GatewayError(400, "invalid_surface_operation");
  }
  const id = clean(body.id);
  if (!id) throw new GatewayError(400, "entity_id_required");
  const requestedClientSlug = clean(body.client_slug);
  if (!requestedClientSlug) throw new GatewayError(400, "client_slug_required");
  // Authenticate against the caller-declared scope before resolving the id.
  // Missing, cross-client and cross-team targets all collapse to the same 403,
  // so this protected read cannot be used to enumerate deliverable ids.
  const principal = await authenticate(supabase, req, body, requestedClientSlug);
  if (principal.kind === "client") throw new GatewayError(403, "asset_scope_forbidden");
  const client = principal.client || await clientBySlug(supabase, requestedClientSlug);
  if (!client || client.active !== true) throw new GatewayError(403, "asset_scope_forbidden");
  const { data, error } = await supabase.from("deliverables")
    .select("*")
    .eq("id", id)
    .eq("client_slug", requestedClientSlug)
    .maybeSingle();
  if (error) throw new GatewayError(503, "entity_lookup_unavailable");
  if (!data) throw new GatewayError(403, "asset_scope_forbidden");
  const existing = data as JsonMap;
  const targetClientSlug = clean(existing.client_slug);
  const team = normalizeTeam(existing.team);
  if (!targetClientSlug || !team) throw new GatewayError(403, "asset_scope_forbidden");
  if (principal.kind === "staff"
      && !staffAssetReadAllowed(principal.keyRole, principal.memberTeam, team)) {
    throw new GatewayError(403, "asset_scope_forbidden");
  }
  return json({
    ok: true,
    complete: true,
    id,
    client_slug: targetClientSlug,
    team,
    ...(await assetSnapshot(supabase, existing)),
  });
}

async function handleDescriptionRead(
  supabase: SupabaseClient,
  req: Request,
  body: JsonMap,
): Promise<Response> {
  if (surfaceFor(body) !== "production") {
    throw new GatewayError(400, "invalid_surface_operation");
  }
  const id = clean(body.id);
  if (!id) throw new GatewayError(400, "entity_id_required");
  const requestedClientSlug = clean(body.client_slug);
  if (!requestedClientSlug) throw new GatewayError(400, "client_slug_required");
  // Resolve authentication against the declared roster scope before the id,
  // matching the protected asset-reader anti-enumeration boundary.
  const principal = await authenticate(supabase, req, body, requestedClientSlug);
  if (principal.kind === "client") throw new GatewayError(403, "description_scope_forbidden");
  const client = principal.client || await clientBySlug(supabase, requestedClientSlug);
  if (!client || client.active !== true) {
    throw new GatewayError(403, "description_scope_forbidden");
  }
  const { data, error } = await supabase.from("deliverables")
    .select("*")
    .eq("id", id)
    .eq("client_slug", requestedClientSlug)
    .maybeSingle();
  if (error) throw new GatewayError(503, "entity_lookup_unavailable");
  if (!data) throw new GatewayError(403, "description_scope_forbidden");
  const existing = data as JsonMap;
  const targetClientSlug = clean(existing.client_slug);
  const team = normalizeTeam(existing.team);
  if (!targetClientSlug
      || !team
      || (principal.kind === "staff"
        && !staffAssetReadAllowed(principal.keyRole, principal.memberTeam, team))) {
    throw new GatewayError(403, "description_scope_forbidden");
  }
  return json({
    ok: true,
    complete: true,
    row: publicDescriptionRow(existing),
  });
}

async function handleLabelsRead(
  supabase: SupabaseClient,
  req: Request,
  body: JsonMap,
): Promise<Response> {
  if (surfaceFor(body) !== "production") {
    throw new GatewayError(400, "invalid_surface_operation");
  }
  const id = clean(body.id);
  if (!id) throw new GatewayError(400, "entity_id_required");
  const { data, error } = await supabase.from("deliverables").select("*").eq("id", id).maybeSingle();
  if (error) throw new GatewayError(503, "entity_lookup_unavailable");
  if (!data) throw new GatewayError(404, "entity_not_found");
  const existing = data as JsonMap;
  const targetClientSlug = clean(existing.client_slug);
  const team = normalizeTeam(existing.team);
  if (!targetClientSlug || !team) throw new GatewayError(409, "entity_scope_unavailable");
  const principal = await authenticate(supabase, req, body, targetClientSlug);
  if (principal.kind === "client") throw new GatewayError(403, "operation_forbidden");
  const issueId = linearIssueIdForLabels(existing);
  if (!issueId) throw new GatewayError(409, "linear_issue_unavailable");
  const authority = principal.testOnly ? "syncview" : await authorityFor(supabase, team);
  const snapshot = await linearLabelSnapshot(issueId);
  const linearSelected = {
    labels: snapshot.selectedLabels,
    ids: snapshot.selectedLabelIds,
  };
  const selected = authority === "syncview"
    ? (nativeLabelSnapshot(existing) || (principal.testOnly ? linearSelected : null))
    : linearSelected;
  if (!selected) {
    throw new GatewayError(409, "native_label_state_incomplete", { complete: false });
  }
  return json({
    ok: true,
    complete: true,
    authority,
    catalog: mergeLabelCatalog(snapshot.catalog, selected.labels),
    selected_label_ids: selected.ids,
    selected_labels: selected.labels,
  });
}

async function handleEntityOperation(
  supabase: SupabaseClient,
  req: Request,
  body: JsonMap,
  operation: string,
  surface: string,
  requestId: string,
  sourceEditedAt: string,
): Promise<Response> {
  const entity = lower(body.entity || "deliverable") as Entity;
  if (!(["deliverable", "batch"] as string[]).includes(entity)) {
    throw new GatewayError(400, "invalid_entity");
  }
  if (entity === "batch" && operation !== "comment") {
    throw new GatewayError(400, "unsupported_batch_operation");
  }
  let preauthenticatedPrincipal: Principal | null = null;
  let attachmentClientSlug = "";
  if (operation === "attachment") {
    attachmentClientSlug = clean(body.client_slug);
    if (!attachmentClientSlug) throw new GatewayError(400, "client_slug_required");
    preauthenticatedPrincipal = await authenticate(
      supabase, req, body, attachmentClientSlug,
    );
    if (preauthenticatedPrincipal.kind === "client") {
      throw new GatewayError(403, "asset_scope_forbidden");
    }
    const client = preauthenticatedPrincipal.client
      || await clientBySlug(supabase, attachmentClientSlug);
    if (!client || client.active !== true) {
      throw new GatewayError(403, "asset_scope_forbidden");
    }
  }
  let id = clean(body.id);
  let resolvedData: JsonMap | null = null;
  if (!id
      && entity === "deliverable"
      && body.legacy_parity === true
      && (surface === "calendar" || surface === "sxr")
      && (operation === "status" || operation === "comment")) {
    const issue = clean(body.issue || body.linear_issue);
    if (!issue) throw new GatewayError(400, "entity_id_required");
    const candidates = new Map<string, JsonMap>();
    const columns = /^https?:\/\//i.test(issue)
      ? ["linear_issue_url"]
      : ["linear_issue_uuid", "linear_identifier"];
    for (const column of columns) {
      const { data: rows, error: lookupError } = await supabase.from("deliverables")
        .select("*")
        .eq(column, issue)
        .limit(2);
      if (lookupError) throw new GatewayError(503, "entity_lookup_unavailable");
      for (const row of (rows || []) as JsonMap[]) candidates.set(clean(row.id), row);
    }
    if (candidates.size === 0) throw new GatewayError(404, "entity_not_found");
    if (candidates.size !== 1) throw new GatewayError(409, "legacy_link_ambiguous");
    resolvedData = [...candidates.values()][0];
    id = clean(resolvedData.id);
  }
  if (!id) throw new GatewayError(400, "entity_id_required");
  const table = entity === "batch" ? "batches" : "deliverables";
  const lookup = resolvedData
    ? { data: resolvedData, error: null }
    : operation === "attachment"
      ? await supabase.from(table).select("*")
        .eq("id", id)
        .eq("client_slug", attachmentClientSlug)
        .maybeSingle()
      : await supabase.from(table).select("*").eq("id", id).maybeSingle();
  const { data, error } = lookup;
  if (error) throw new GatewayError(503, "entity_lookup_unavailable");
  if (!data) {
    throw operation === "attachment"
      ? new GatewayError(403, "asset_scope_forbidden")
      : new GatewayError(404, "entity_not_found");
  }
  const existing = data as JsonMap;
  const targetClientSlug = clean(existing.client_slug);
  const team = normalizeTeam(existing.team);
  if (!targetClientSlug || !team) throw new GatewayError(409, "entity_scope_unavailable");

  const principal = preauthenticatedPrincipal
    || await authenticate(supabase, req, body, targetClientSlug);
  if (operation === "attachment"
      && principal.kind === "staff"
      && !staffAssetReadAllowed(principal.keyRole, principal.memberTeam, team)) {
    // Missing, cross-client, and same-client cross-team ids share the exact
    // pre-mutation denial so a Creative cannot enumerate another team's work.
    throw new GatewayError(403, "asset_scope_forbidden");
  }
  if (entity === "deliverable") {
    // This single guard covers status, description, labels, due, assignee,
    // comments, and any future entity mutation before it can enqueue an
    // outbound write against a quarantined deterministic create UUID.
    await assertDeliverableIdentityWritable(supabase, existing);
  }
  const nextStatus = lower(body.status || parseJson(body.patch).status);
  if (surface === "production" && operation !== "comment") {
    if (!clean(body.expected_updated_at)
        || (operation === "status" && !clean(body.expected_status))) {
      throw new GatewayError(400, "cas_required");
    }
  }
  if (surface === "workload" && operation === "due" && !clean(body.expected_updated_at)) {
    throw new GatewayError(400, "cas_required");
  }
  // F136: the creative decision now reads the row's current status and current
  // assignee, not just the requested next status. CAS still guards concurrency;
  // this guards legality.
  if (principal.kind === "staff"
      && !staffOperationAllowed(principal.keyRole, operation, principal.memberTeam, team, nextStatus, {
        currentStatus: lower(existing.status),
        targetAssigneeId: clean(existing.assignee_id),
        actorMemberId: clean(principal.memberId),
      })) {
    throw new GatewayError(403, "operation_forbidden");
  }
  if ((operation === "labels" || operation === "description" || operation === "attachment")
      && principal.kind === "client") {
    throw new GatewayError(403, "operation_forbidden");
  }
  // Client transition policy is resolved before any provider probe. A
  // forbidden status request must not gain an artifact-existence oracle, and
  // reconcile-only requests use the same ordering.
  if (operation === "status"
      && principal.kind === "client"
      && !clientOperationAllowed(operation, existing.status, nextStatus)) {
    throw new GatewayError(403, "operation_forbidden");
  }
  if (body.reconcile_only === true) {
    // Reconcile resolves its own historical authority inside
    // reconcileEntityOperation and is permitted for still-Linear-authoritative
    // teams, so the approval-artifact gate stays here before delegating.
    if (operation === "status" && nextStatus === "smm_approval") {
      await assertGraphicsApprovalArtifact(supabase, existing);
    }
    return await reconcileEntityOperation(
      supabase,
      body,
      operation,
      surface,
      requestId,
      sourceEditedAt,
      entity,
      id,
      table,
      targetClientSlug,
      team,
      principal,
    );
  }
  // Resolve the full write-authority chain — team authority, lane eligibility,
  // legacy-parity, and the F27 generation fence — BEFORE any provider probe. A
  // write-ineligible request (a Linear-authoritative team, an unreadable
  // authority flag, or a failed generation fence) must be rejected before
  // assertGraphicsApprovalArtifact performs an external access and upserts
  // production_asset_access_checks.
  const authority = principal.testOnly ? "syncview" : await authorityFor(supabase, team);
  const legacyParity = authorityLane(
    authority,
    principal,
    surface,
    operation,
    body.legacy_parity === true,
  );
  if (legacyParity) await assertLegacyParityEnabled(supabase);
  const authorityGeneration = await f27WriteAuthorizationGeneration(supabase, team);
  if (operation === "status" && nextStatus === "smm_approval") {
    await assertGraphicsApprovalArtifact(supabase, existing);
  }
  // F2 controls draining, not whether an intent exists. F32 has not installed
  // an owner-controlled retired epoch, so applicable comment mutations keep
  // queuing while F2 is off, missing, or unreadable like every native writer.
  const commentMirrorEnabled = operation === "comment";
  let dedup = dedupKey(operation, entity, id, requestId);
  const outboundBase: JsonMap = {
    entity: operation === "comment" ? "comment" : entity,
    entity_id: id,
    operation,
    dedup_key: dedup,
    source_edited_at: sourceEditedAt,
    test_only: principal.testOnly,
    legacy_parity: legacyParity,
  };

  let result: unknown;
  let labelsReceipt: JsonMap | null = null;
  let projectionReceipt: JsonMap | null = null;
  let commentMirrorApplicable = operation !== "comment" || commentMirrorEnabled;
  if (operation === "comment") {
    const commentInput = parseJson(body.comment);
    const action = normalizeCommentAction(commentInput.action || "add");
    if (!action) throw new GatewayError(400, "invalid_comment_action");
    // The card the client presents it is authorized for. It must exactly match
    // the target deliverable's card binding (clientCommentTargetAllowed), the
    // same card the protected reader gates on — never merely "some card id".
    const requestedCardId = clean(body.card_id || commentInput.card_id);
    let lifecycleRow: JsonMap | null = null;
    let commentBody = String(commentInput.body == null ? body.body || "" : commentInput.body).trim();
    let audience = principal.kind === "client" ? "client" : lower(commentInput.audience || "internal");
    let suppliedNativeId = clean(commentInput.native_comment_id);
    let productionCommentId = "";
    let nativeCommentId = "";
    let parentId = "";
    let commentDependsOnId: number | null = null;
    let expectedCommentVersion: number | null = null;
    let expectedCommentUpdatedAt = "";

    if (action === "add") {
      if (!commentBody || commentBody.length > MAX_COMMENT_BODY) {
        throw new GatewayError(400, "invalid_comment_body");
      }
      if (!["internal", "client"].includes(audience)) {
        throw new GatewayError(400, "invalid_comment_audience");
      }
      // A client add is bound to the exact SXR card/component/deliverable
      // crosswalk the reader authorizes, not merely the client slug — the
      // presented card must equal the target deliverable's card binding.
      // FRONT DOOR (2026-08-14): the calendar surface and the unlinked samples
      // thread can never present that card binding, so those two populations
      // are admitted by the slug/origin/team-bound
      // clientCommentFrontDoorTargetAllowed instead. principal.clientSlug is
      // the server-resolved token match (authenticate()), never request input;
      // card-bound SXR rows remain governed solely by the strict predicate.
      if (principal.kind === "client"
          && !clientCommentTargetAllowed(surface, existing, commentInput.component, requestedCardId)
          && !clientCommentFrontDoorTargetAllowed(
            surface, existing, commentInput.component, requestedCardId, principal.clientSlug,
          )) {
        throw new GatewayError(403, "comment_forbidden");
      }
    } else {
      const commentRef = clean(commentInput.id || commentInput.comment_id || commentInput.native_comment_id);
      if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]{1,199}$/.test(commentRef)) {
        throw new GatewayError(400, "valid_comment_id_required");
      }
      const { data: matches, error: commentError } = await supabase.from("production_comments")
        .select("*")
        .or(`id.eq.${commentRef},native_comment_id.eq.${commentRef}`)
        .limit(2);
      if (commentError) throw new GatewayError(503, "comment_lookup_unavailable");
      if (!Array.isArray(matches) || matches.length !== 1) {
        // Missing and out-of-thread identifiers share the same non-enumerating
        // response once the target thread itself has been authorized.
        throw new GatewayError(403, "comment_forbidden");
      }
      lifecycleRow = matches[0] as JsonMap;
      if (clean(lifecycleRow.client_slug) !== targetClientSlug
          || clean(lifecycleRow.deliverable_id) !== (entity === "deliverable" ? id : "")
          || clean(lifecycleRow.batch_id) !== (entity === "batch" ? id : "")
          || normalizeTeam(lifecycleRow.team) !== team
          || (principal.kind === "client" && lower(lifecycleRow.audience) !== "client")
          // A client edit/delete is bound to the same exact SXR
          // card/component/deliverable crosswalk as the reader and the add path,
          // including the presented card matching the target's card binding.
          // FRONT DOOR (2026-08-14): widened with the identical alternative the
          // add path accepts, so a comment a client was authorized to CREATE on
          // the calendar surface or an unlinked samples thread can be edited and
          // deleted by that same client under the same binding — never a wider one.
          || (principal.kind === "client"
            && !clientCommentTargetAllowed(surface, existing, lifecycleRow.component, requestedCardId)
            && !clientCommentFrontDoorTargetAllowed(
              surface, existing, lifecycleRow.component, requestedCardId, principal.clientSlug,
            ))
          || !commentLifecycleAllowed(principal, action, lifecycleRow)) {
        throw new GatewayError(403, "comment_forbidden");
      }
      if ((action === "resolve" || action === "unresolve") && clean(lifecycleRow.parent_id)) {
        throw new GatewayError(400, "comment_root_required");
      }
      expectedCommentVersion = Number(commentInput.expected_version);
      expectedCommentUpdatedAt = clean(commentInput.expected_updated_at);
      if (!Number.isInteger(expectedCommentVersion) || Number(expectedCommentVersion) < 1
          || !expectedCommentUpdatedAt) {
        throw new GatewayError(400, "comment_cas_required");
      }
      // The CAS comparison is deferred until after exact receipt replay (see the
      // lifecycle dispatch below). Comparing here would 409 a committed
      // response-loss retry before its receipt could be adopted.
      if (action === "edit" && (!commentBody || commentBody.length > MAX_COMMENT_BODY)) {
        throw new GatewayError(400, "invalid_comment_body");
      }
      if (action !== "edit") commentBody = clean(lifecycleRow.body);
      audience = lower(lifecycleRow.audience);
      suppliedNativeId = "";
      productionCommentId = clean(lifecycleRow.id);
      nativeCommentId = clean(lifecycleRow.native_comment_id) || productionCommentId;
      parentId = clean(lifecycleRow.parent_id);
      commentMirrorApplicable = commentMirrorEnabled
        && (action === "edit" || action === "delete");
    }

    if (suppliedNativeId
        && (!(surface === "calendar" || surface === "sxr")
          || !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{1,199}$/.test(suppliedNativeId))) {
      throw new GatewayError(400, "invalid_native_comment_id");
    }
    if (action === "add" && suppliedNativeId) {
      // Calendar/SXR queue entries carry a stable native id. Make that id,
      // rather than a retry's request id, own the one durable/outbound intent.
      dedup = dedupKey("comment", entity, id, `native:${suppliedNativeId}`);
      outboundBase.dedup_key = dedup;
    }
    const rawParentId = action === "add" ? clean(commentInput.parent_id) : "";
    parentId = action === "add" ? rawParentId : parentId;
    if (action === "add" && rawParentId) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]{1,199}$/.test(rawParentId)) {
        throw new GatewayError(400, "invalid_comment_parent");
      }
      const { data: parents, error: parentError } = await supabase.from("production_comments")
        .select("id,native_comment_id,deliverable_id,batch_id,client_slug,audience")
        .or(`id.eq.${rawParentId},native_comment_id.eq.${rawParentId}`)
        .limit(2);
      if (parentError) throw new GatewayError(503, "comment_parent_lookup_unavailable");
      if (!Array.isArray(parents) || parents.length !== 1) {
        throw new GatewayError(409, "comment_parent_ambiguous");
      }
      const parent = parents[0] as JsonMap;
      if (clean(parent.client_slug) !== targetClientSlug
          || clean(parent.deliverable_id) !== (entity === "deliverable" ? id : "")
          || clean(parent.batch_id) !== (entity === "batch" ? id : "")
          || (principal.kind === "client" && clean(parent.audience) !== "client")) {
        throw new GatewayError(403, "comment_parent_forbidden");
      }
      parentId = clean(parent.id);
      // Reply visibility is a canonical-thread property. Ignore any
      // caller-supplied audience and inherit the resolved parent audience.
      audience = lower(parent.audience) === "client" ? "client" : "internal";
    }
    if (action === "add") {
      productionCommentId = suppliedNativeId
        ? await deterministicNativeId("pc", `${entity}:${id}`, suppliedNativeId)
        : await deterministicNativeId("pc", requestId, `${entity}:${id}:production`);
      nativeCommentId = suppliedNativeId || productionCommentId;
    }
    const round = commentInput.round == null || commentInput.round === ""
      ? null
      : Number(commentInput.round);
    if (round != null && (!Number.isInteger(round) || round < 0)) {
      throw new GatewayError(400, "invalid_comment_round");
    }
    const fingerprint = await intentFingerprint({
      operation, action, entity, id,
      ...(suppliedNativeId ? {} : { requestId, surface, legacyParity }),
      actorKey: principal.actorKey,
      comment: {
        body: commentBody,
        audience,
        native_comment_id: nativeCommentId,
        parent_id: parentId || null,
        component: clean(commentInput.component) || null,
        is_tweak: commentInput.is_tweak === true,
        round,
        expected_version: expectedCommentVersion,
        expected_updated_at: expectedCommentUpdatedAt || null,
      },
    });
    if (commentMirrorApplicable && action !== "add") {
      const { data: dependency, error: dependencyError } = await supabase.from("mirror_outbox")
        .select("id")
        .eq("entity", "comment")
        .eq("operation", "comment")
        .eq("comment_id", productionCommentId)
        .neq("dedup_key", dedup)
        .in("status", ["pending", "failed", "shadow_ok", "written", "skipped"])
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (dependencyError) throw new GatewayError(503, "comment_dependency_lookup_unavailable");
      const dependencyId = Number(parseJson(dependency).id || 0);
      commentDependsOnId = Number.isSafeInteger(dependencyId) && dependencyId > 0
        ? dependencyId
        : null;
    }
    const outbound = {
      ...outboundBase,
      comment_id: productionCommentId,
      ...(commentDependsOnId ? { depends_on_id: commentDependsOnId } : {}),
      payload: f27FencedPayload(
        {
          action,
          body: commentBody,
          linear_comment_id: clean(lifecycleRow && lifecycleRow.linear_comment_id) || null,
          _intent_fingerprint: fingerprint,
        },
        authorityGeneration,
        legacyParity,
      ),
    };
    const event = eventFor(operation, principal, sourceEditedAt, surface, outbound, existing);
    event.comment_action = action;
    event.comment_id = productionCommentId;
    if (body.expected_status !== undefined) event.expected_status = clean(body.expected_status);
    if (body.expected_updated_at !== undefined) event.expected_updated_at = clean(body.expected_updated_at);
    const comment: JsonMap = {
      id: productionCommentId,
      native_comment_id: nativeCommentId,
      idempotency_key: dedup,
      deliverable_id: entity === "deliverable" ? id : null,
      batch_id: entity === "batch" ? id : null,
      team,
      operation: action,
      transport_actor: "production-write",
      transport_role: "gateway",
      source_updated_at: sourceEditedAt,
      provenance: { surface, action },
    };
    if (action === "add") {
      Object.assign(comment, {
        author_key: principal.actorKey,
        author_member_id: principal.memberId,
        author_name: principal.actorName,
        role: principal.actorRole,
        body: commentBody,
        body_format: "markdown",
        audience,
        parent_id: parentId || null,
        component: clean(commentInput.component) || null,
        is_tweak: commentInput.is_tweak === true,
        round,
        origin: "native",
        source: "ui",
        source_created_at: sourceEditedAt,
      });
      const replay = await assertDedupIntent(
        supabase,
        dedup,
        dedupExpectation(principal, team, sourceEditedAt, outbound, fingerprint),
      );
      if (replay) {
        const { data: committed, error: committedError } = await supabase.from("production_comments")
          .select("*")
          .eq("id", productionCommentId)
          .maybeSingle();
        if (committedError || !committed) throw new GatewayError(500, "idempotent_result_missing");
        result = committed;
      } else {
        if (principal.kind === "client"
            && !clientOperationAllowed(operation, existing.status, nextStatus)) {
          throw new GatewayError(403, "operation_forbidden");
        }
        assertCas(body, existing);
        result = await rpc(supabase, "production_comment_write", { p_comment: comment, p_event: event });
      }
    } else {
      const currentRow = lifecycleRow as JsonMap;
      if (action === "edit") comment.body = commentBody;
      if (action === "delete") {
        comment.deleted_by_key = principal.actorKey;
        comment.deleted_by_name = principal.actorName;
      }
      if (action === "resolve") {
        comment.resolved_by_key = principal.actorKey;
        comment.resolved_by_name = principal.actorName;
      }
      // Replay an exact prior receipt BEFORE the stale CAS. A response-loss
      // retry of a committed edit/delete/resolve/reopen carries the original
      // version/timestamp, so comparing them here would observe the
      // already-advanced row and 409 before the lifecycle RPC could adopt the
      // receipt — making the UI mint a second canonical mutation and mirror
      // intent. Adopt the first committed result instead.
      const lifecycleReplay = await readLifecycleReceipt(
        supabase, dedup, productionCommentId, action, fingerprint,
      );
      if (lifecycleReplay) {
        result = lifecycleReplay;
      } else {
        if (Number(currentRow.version) !== expectedCommentVersion
            || clean(currentRow.updated_at) !== expectedCommentUpdatedAt) {
          throw new GatewayError(409, "write_conflict", {
            conflict: true,
            comment: publicComment(currentRow, principal),
          });
        }
        result = await rpc(supabase, "production_comment_lifecycle_write", {
          p_comment: comment,
          p_event: event,
          p_expected_version: expectedCommentVersion,
          p_expected_updated_at: expectedCommentUpdatedAt,
        });
      }
    }
  } else if (operation === "labels") {
    const labelIds = canonicalLabelIds(body.label_ids);
    if (!labelIds) throw new GatewayError(400, "invalid_label_ids");
    const fingerprint = await intentFingerprint({
      operation, entity, id, requestId, surface, legacyParity,
      actorKey: principal.actorKey,
      patch: { label_ids: labelIds },
    });
    const outbound = {
      ...outboundBase,
      payload: f27FencedPayload(
        { label_ids: labelIds, _intent_fingerprint: fingerprint },
        authorityGeneration,
        legacyParity,
      ),
    };
    const replay = await assertDedupIntent(
      supabase,
      dedup,
      dedupExpectation(principal, team, sourceEditedAt, outbound, fingerprint),
    );
    if (replay) {
      result = existing;
    } else {
      assertCas(body, existing);
      const issueId = linearIssueIdForLabels(existing);
      if (!issueId) throw new GatewayError(409, "linear_issue_unavailable");
      const snapshot = await linearLabelSnapshot(issueId);
      // The service-only TEST lane may bootstrap pre-F201 rows from this
      // already-proven complete Linear selection. Normal SyncView authority
      // remains strictly native and cannot foreign-round-trip label state.
      const native = nativeLabelSnapshot(existing) || (principal.testOnly ? {
        labels: snapshot.selectedLabels,
        ids: snapshot.selectedLabelIds,
      } : null);
      if (!native) {
        throw new GatewayError(409, "native_label_state_incomplete", { complete: false });
      }
      const applicable = new Map(
        [...native.labels, ...snapshot.catalog]
          .map(label => [clean(label.id), label]),
      );
      const selectedLabels = labelIds.map(labelId => applicable.get(labelId));
      if (selectedLabels.some(label => !label)) {
        throw new GatewayError(400, "label_not_applicable");
      }
      const raw = parseJson(existing.linear_raw);
      const rawIssue = parseJson(raw.issue);
      raw.issue = {
        ...rawIssue,
        id: clean(rawIssue.id) || issueId,
        labelIds,
        labels: {
          nodes: selectedLabels,
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      };
      const row: JsonMap = { ...existing, linear_raw: raw };
      const event = eventFor(
        operation,
        principal,
        sourceEditedAt,
        surface,
        outbound,
        existing,
        clean(row.status),
      );
      event.expected_updated_at = clean(body.expected_updated_at);
      try {
        result = await rpc(supabase, "production_deliverable_write", { p_row: row, p_event: event });
      } catch (error) {
        if (error instanceof GatewayError && error.code === "write_conflict") {
          const { data: current } = await supabase.from("deliverables").select("*").eq("id", id).maybeSingle();
          throw new GatewayError(409, "write_conflict", {
            conflict: true,
            row: publicRow(current || existing),
          });
        }
        throw error;
      }
    }
    labelsReceipt = selectedLabelReceipt(parseJson(result));
  } else if (operation === "attachment") {
    if (team !== "graphics") throw new GatewayError(403, "operation_forbidden");
    const fileUrl = canonicalArtifactUrl(
      body.file_url !== undefined ? body.file_url : parseJson(body.patch).file_url,
    );
    if (!fileUrl) throw new GatewayError(400, "invalid_artifact_url");
    const fingerprint = await intentFingerprint({
      operation, entity, id, requestId, surface, legacyParity,
      actorKey: principal.actorKey,
      patch: { file_url: fileUrl },
    });
    const outbound = {
      ...outboundBase,
      payload: f27FencedPayload({
        url: fileUrl,
        title: "SyncView canonical Graphics deliverable",
        subtitle: "Current canonical deliverable",
        metadata: {
          syncviewDeliverableId: id,
          revisionAt: sourceEditedAt,
        },
        _intent_fingerprint: fingerprint,
      }, authorityGeneration, legacyParity),
    };
    const row: JsonMap = { ...existing, file_url: fileUrl };
    const event = eventFor(
      operation,
      principal,
      sourceEditedAt,
      surface,
      outbound,
      existing,
      clean(existing.status),
    );
    event.expected_updated_at = clean(body.expected_updated_at);
    event.from_file_url = clean(existing.file_url) || null;
    event.to_file_url = fileUrl;
    const replay = await assertDedupIntent(
      supabase,
      dedup,
      dedupExpectation(principal, team, sourceEditedAt, outbound, fingerprint),
    );
    if (replay) {
      // The initial entity lookup can precede a racing winner's commit while
      // the dedup lookup observes its outbox row under READ COMMITTED. Re-read
      // the exact scoped row after replay proof so the receipt never returns
      // the stale pre-winner URL/revision snapshot.
      const { data: replayCurrent, error: replayError } = await supabase
        .from("deliverables")
        .select("*")
        .eq("id", id)
        .eq("client_slug", attachmentClientSlug)
        .maybeSingle();
      if (replayError || !replayCurrent) {
        throw new GatewayError(500, "idempotent_result_missing");
      }
      result = replayCurrent as JsonMap;
    } else {
      assertCas(body, existing);
      const evidence = await probeAssetUrl("deliverable_file", fileUrl);
      await recordAssetEvidence(supabase, id, "deliverable_file", fileUrl, evidence);
      if (clean(evidence.state) !== "available") {
        throw new GatewayError(409, "artifact_not_resolvable", {
          asset_state: clean(evidence.state) || "unavailable",
          checked_at: clean(evidence.checked_at) || new Date().toISOString(),
          guidance: clean(evidence.guidance) || assetGuidance("unavailable"),
        });
      }
      try {
        const written = parseJson(await rpc(supabase, "production_artifact_write", {
          p_row: row,
          p_event: event,
        }));
        result = parseJson(written.row);
        projectionReceipt = parseJson(written.projection);
        if (!clean(parseJson(result).id)) {
          throw new GatewayError(500, "native_response_refresh_failed");
        }
      } catch (error) {
        if (error instanceof GatewayError && error.code === "write_conflict") {
          const { data: current } = await supabase.from("deliverables").select("*").eq("id", id).maybeSingle();
          throw new GatewayError(409, "write_conflict", {
            conflict: true,
            row: publicArtifactRow(current || existing),
          });
        }
        throw error;
      }
    }
  } else {
    let patch: JsonMap;
    let payload: JsonMap;
    let fingerprintPatch: JsonMap;
    if (operation === "status") {
      if (!DELIVERABLE_STATUSES.includes(nextStatus)) throw new GatewayError(400, "invalid_status");
      patch = { status: nextStatus, status_at: sourceEditedAt };
      payload = { status: nextStatus };
      // The idempotency fingerprint represents the caller's status intent.
      // The due bump is server-derived from the first locked row and stays in
      // the durable outbox payload without making retries state-dependent.
      fingerprintPatch = { ...patch };
      const bumpedDueDate = overdueStatusBumpDate(existing.due_date);
      if (bumpedDueDate && await overdueStatusBumpEnabled(supabase)) {
        patch.due_date = bumpedDueDate;
        payload.due_date = bumpedDueDate;
      }
    } else if (operation === "due") {
      const dueDate = body.due_date == null ? parseJson(body.patch).due_date : body.due_date;
      if (!validDateOrNull(dueDate)) throw new GatewayError(400, "invalid_due_date");
      patch = { due_date: clean(dueDate) || null };
      payload = { due_date: clean(dueDate) || null };
      fingerprintPatch = patch;
    } else if (operation === "description") {
      const descriptionValue = body.description !== undefined
        ? body.description
        : parseJson(body.patch).description;
      const description = canonicalDescription(descriptionValue);
      if (description == null) throw new GatewayError(400, "invalid_description");
      patch = { brief: description };
      payload = { description };
      fingerprintPatch = patch;
    } else {
      const assigneeId = clean(body.assignee_id == null ? parseJson(body.patch).assignee_id : body.assignee_id);
      await validateAssignee(supabase, assigneeId, team);
      patch = { assignee_id: assigneeId || null };
      payload = { assignee_id: assigneeId || null };
      fingerprintPatch = patch;
    }
    const fingerprint = await intentFingerprint({
      operation, entity, id, requestId, surface, legacyParity,
      actorKey: principal.actorKey,
      patch: fingerprintPatch,
    });
    payload._intent_fingerprint = fingerprint;
    const outbound = {
      ...outboundBase,
      payload: f27FencedPayload(payload, authorityGeneration, legacyParity),
    };
    const row = { ...existing, ...patch };
    const event = eventFor(operation, principal, sourceEditedAt, surface, outbound, existing, clean(row.status));
    if (body.expected_status !== undefined) event.expected_status = clean(body.expected_status);
    if (body.expected_updated_at !== undefined) event.expected_updated_at = clean(body.expected_updated_at);
    const replay = await assertDedupIntent(
      supabase,
      dedup,
      dedupExpectation(principal, team, sourceEditedAt, outbound, fingerprint),
    );
    if (!replay) {
      if (principal.kind === "client"
          && !clientOperationAllowed(operation, existing.status, nextStatus)) {
        throw new GatewayError(403, "operation_forbidden");
      }
      assertCas(body, existing, operation === "description");
    }
    if (replay) {
      result = existing;
    } else {
      try {
        result = await rpc(supabase, "production_deliverable_write", { p_row: row, p_event: event });
      } catch (error) {
        if (error instanceof GatewayError && error.code === "write_conflict") {
          const { data: current } = await supabase.from("deliverables").select("*").eq("id", id).maybeSingle();
          throw new GatewayError(409, "write_conflict", {
            conflict: true,
            row: operation === "description"
              ? publicDescriptionRow(current || existing)
              : publicRow(current || existing),
          });
        }
        throw error;
      }
    }
  }

  const syncviewLiveDrain = authority === "syncview"
    && !principal.testOnly
    && !legacyParity
    && await outboundLiveForDrain(supabase);
  const mutationHasMirror = operation !== "comment" || commentMirrorApplicable;
  const shouldDrain = mutationHasMirror && (legacyParity || principal.testOnly || syncviewLiveDrain);
  const awaitedDrain = legacyParity || principal.testOnly;
  const mirror = !mutationHasMirror
    ? { attempted: false, acknowledged: true, not_applicable: true }
    : awaitedDrain
    ? await targetedDrain(dedup, principal)
    : syncviewLiveDrain
      ? { attempted: true, acknowledged: false, asynchronous: true }
      : { attempted: false, acknowledged: false };
  if (shouldDrain && !awaitedDrain) scheduleSyncviewLiveDrains([dedup], principal);
  const mirrorPending = !mutationHasMirror
    ? false
    : awaitedDrain ? mirror.acknowledged !== true : true;
  return json({
    ok: true,
    native_committed: true,
    authority,
    legacy_parity: legacyParity,
    mirror_pending: mirrorPending,
    mirror,
    // Keep `row` entity-shaped for every operation so a composer success
    // cannot replace the caller's deliverable/CAS cursor with a comment id.
    row: operation === "description"
      ? publicDescriptionRow(result)
      : operation === "comment"
        ? publicRow(existing)
        : operation === "attachment"
          ? publicArtifactRow(result)
          : publicRow(result),
    ...(operation === "comment" ? { comment: publicComment(result, principal) } : {}),
    ...(labelsReceipt || {}),
    ...(projectionReceipt ? { projection: projectionReceipt } : {}),
  }, mirrorPending && awaitedDrain ? 202 : 200);
}

async function ensureBatch(
  supabase: SupabaseClient,
  row: JsonMap,
  event: JsonMap,
  dedup: string,
  replay: boolean,
): Promise<{ row: JsonMap; outboxId: number }> {
  const { data, error } = await supabase.from("batches").select("*").eq("id", clean(row.id)).maybeSingle();
  if (error) throw new GatewayError(503, "batch_lookup_unavailable");
  if (data && (
    clean(data.client_slug) !== clean(row.client_slug)
    || normalizeTeam(data.team) !== normalizeTeam(row.team)
    || clean(data.name) !== clean(row.name)
    || clean(data.description) !== clean(row.description)
    || clean(data.filming_doc_url) !== clean(row.filming_doc_url)
    || clean(data.footage_folder_url) !== clean(row.footage_folder_url)
    || clean(data.delivery_folder_url) !== clean(row.delivery_folder_url)
    || clean(data.color) !== clean(row.color)
  )) throw new GatewayError(409, "intake_id_conflict");
  if (replay && !data) throw new GatewayError(500, "idempotent_result_missing");
  const written = replay ? data : await rpc(supabase, "production_batch_write", { p_row: data || row, p_event: event });
  return { row: parseJson(written), outboxId: await findOutboxId(supabase, dedup) };
}

/* The planning-loop twin of ensureDeliverable's identity check. A row found
   under this request's deterministic id IS this request's row; the question
   is only whether its stored state can be resumed. For a row the gateway
   itself wrote, any drift from the plan is a hard conflict -- a prior attempt
   cannot disagree with itself. For a row the B1 mirror materialized from
   Linear (created_by linear-backfill) the drift IS the resume case: the
   mirror stamps its own batch and origin=manual, writes no sort_key, and
   copies status, assignee and due date from Linear, all of which may
   legitimately have moved while the submission sat interrupted. Only true
   identity -- client, team, title, card linkage -- stays load-bearing there;
   ensureDeliverable then adopts the row and repoints the plan-owned fields. */
function intakeExistingRowConflict(existing: JsonMap | undefined, row: JsonMap): boolean {
  if (!existing) return false;
  if (clean(existing.client_slug) !== clean(row.client_slug)
    || normalizeTeam(existing.team) !== normalizeTeam(row.team)
    || clean(existing.title) !== clean(row.title)
    || clean(existing.card_id) !== clean(row.card_id)) return true;
  if (clean(existing.created_by) === "linear-backfill") return false;
  return clean(existing.batch_id) !== clean(row.batch_id)
    || clean(existing.status) !== clean(row.status)
    || clean(existing.assignee_id) !== clean(row.assignee_id)
    || clean(existing.due_date) !== clean(row.due_date)
    || clean(existing.origin) !== clean(row.origin)
    || Number(existing.sort_key) !== Number(row.sort_key)
    || Number(existing.priority == null ? 0 : existing.priority) !== Number(row.priority == null ? 0 : row.priority);
}

async function ensureDeliverable(
  supabase: SupabaseClient,
  row: JsonMap,
  event: JsonMap,
  dedup: string,
  replay: boolean,
  displacedBatchIds?: Set<string>,
): Promise<JsonMap> {
  const { data, error } = await supabase.from("deliverables").select("*").eq("id", clean(row.id)).maybeSingle();
  if (error) throw new GatewayError(503, "deliverable_lookup_unavailable");
  if (data && (
    clean(data.client_slug) !== clean(row.client_slug)
    || normalizeTeam(data.team) !== normalizeTeam(row.team)
    || clean(data.title) !== clean(row.title)
    || clean(data.card_id) !== clean(row.card_id)
  )) throw new GatewayError(409, "intake_id_conflict");
  /* batch_id and origin are NOT identity. The deterministic id already proves
     the row belongs to this request, and both fields legitimately drift when
     the B1 mirror wins the race against an interrupted submission: on
     2026-08-21 a 16-video intake died mid-write after 21 of 32 child rows,
     the queued outbox drains still built every Linear issue, and the mirror
     then materialized the missing rows FROM Linear -- reusing the
     deterministic ids per b1-native-row-id-reuse, but stamping its own batch
     and origin=manual. Every retry refused those rows as conflicts until the
     browser gave up and discarded the job. Converge instead: adopt the
     mirror's row and repoint it into the batch this request planned. Rows the
     mirror did not create keep the strict refusal -- batch or origin drift on
     a row this gateway wrote itself has no innocent explanation. */
  const mirrorDrift = !!data && clean(data.created_by) === "linear-backfill"
    && (clean(data.batch_id) !== clean(row.batch_id)
      || clean(data.origin) !== clean(row.origin)
      || Number(data.sort_key == null ? -1 : data.sort_key) !== Number(row.sort_key == null ? -1 : row.sort_key));
  if (data && !mirrorDrift && (
    clean(data.batch_id) !== clean(row.batch_id)
    || clean(data.origin) !== clean(row.origin)
  )) throw new GatewayError(409, "intake_id_conflict");
  if (replay && !data) throw new GatewayError(500, "idempotent_result_missing");
  /* Plan-owned fields only: batch_id, origin and sort_key belong to the
     intake that minted the deterministic id. Status, assignee and due date
     stay the mirror's values -- they were copied from Linear, which is the
     authority that moved them while the submission sat interrupted. */
  const adopted = mirrorDrift
    ? { ...(data as JsonMap), batch_id: clean(row.batch_id), origin: clean(row.origin), sort_key: row.sort_key }
    : (data || row);
  if (mirrorDrift && displacedBatchIds && clean(data.batch_id) !== clean(row.batch_id)) {
    displacedBatchIds.add(clean(data.batch_id));
  }
  if (replay) {
    if (!mirrorDrift) return parseJson(data);
    /* Replay suppresses the duplicate CREATE, not the filing repair. The
       outbox intent is recorded independently of the row write -- that is
       exactly how the 2026-08-21 drains built Linear issues for rows the
       crashed attempt never wrote -- so the incident's own retry arrives
       here with replay=true and the mirror's row still filed in its shell.
       Repair the plan-owned fields with a narrow direct update: no event,
       no outbox, no Linear side effects, nothing that could double-create. */
    const { error: repairError } = await supabase.from("deliverables")
      .update({ batch_id: clean(row.batch_id), origin: clean(row.origin), sort_key: row.sort_key })
      .eq("id", clean(row.id));
    if (repairError) throw new GatewayError(503, "deliverable_repair_unavailable");
    return parseJson(adopted);
  }
  return parseJson(await rpc(supabase, "production_deliverable_write", { p_row: adopted, p_event: event }));
}

/* After a mirror-drift convergence the mirror's own batch is left behind --
   typically holding nothing but the parent issue's mirror row, plus a
   linear_parent_ids map that points at a parent whose children now live in
   the deterministic batch. Leaving that shell active recreates the
   2026-08-20 duplicate-batch picker trap: an append against it would file
   new work under a parent the intake batch already owns. Adopt the parent's
   mirror row into the intake batch and archive the emptied shell. Best-effort
   by design -- the submission itself has already converged, so nothing here
   may fail the request. */
async function reclaimMirrorBatches(
  supabase: SupabaseClient,
  displaced: Set<string>,
  keepBatchId: string,
  clientSlug: string,
): Promise<void> {
  for (const staleId of displaced) {
    try {
      if (!staleId || staleId === keepBatchId) continue;
      const { data: stale } = await supabase.from("batches")
        .select("id,client_slug,created_by").eq("id", staleId).maybeSingle();
      if (!stale) continue;
      if (clean((stale as JsonMap).created_by) !== "linear-backfill") continue;
      if (clean((stale as JsonMap).client_slug) !== clientSlug) continue;
      const { data: keep } = await supabase.from("batches")
        .select("linear_parent_ids").eq("id", keepBatchId).maybeSingle();
      const parentUuids = Object.values(parseJson(keep && (keep as JsonMap).linear_parent_ids))
        .map(value => clean(parseJson(value).uuid))
        .filter(Boolean);
      if (parentUuids.length) {
        await supabase.from("deliverables")
          .update({ batch_id: keepBatchId })
          .eq("batch_id", staleId)
          .eq("created_by", "linear-backfill")
          .in("linear_issue_uuid", parentUuids);
      }
      const { count, error: countError } = await supabase.from("deliverables")
        .select("id", { count: "exact", head: true })
        .eq("batch_id", staleId);
      if (countError || count !== 0) continue;
      await supabase.from("batches")
        .update({ status: "archived", linear_parent_ids: {} })
        .eq("id", staleId);
    } catch (_error) {
      console.error("reclaimMirrorBatches: cleanup skipped for one displaced batch");
    }
  }
}

async function handleIntakeCreate(
  supabase: SupabaseClient,
  req: Request,
  body: JsonMap,
  surface: string,
  requestId: string,
  sourceEditedAt: string,
): Promise<Response> {
  /*
   * One value drives BOTH the batch's `purpose` and every row's `origin`
   * (owner task 2026-08-18: "samples should have their own batches").
   *
   * They are separate columns with the same two-word vocabulary, and deriving
   * them from a single expression is the point: it makes "a samples row only
   * ever lands in a samples batch" true by construction here, rather than an
   * invariant the RPC has to catch after the fact. The RPC still checks it --
   * defence in depth for anything that writes those tables without going
   * through this function -- but this is why the check should never fire.
   *
   * Surface is the only input, so a caller cannot ask for a samples batch from
   * the calendar lane or vice versa; assertSurfaceOperation has already
   * established that the surface is one this operation is allowed on.
   */
  const intakePurpose = surface === "sxr" ? "samples" : "calendar";
  let clientSlug = clean(body.client_slug);
  if (!clientSlug
      && body.test_override === true
      && !clean(req.headers.get("x-syncview-key"))
      && !clean(req.headers.get("x-syncview-client-token"))
      && await serviceRoleRequest(req)) {
    clientSlug = (await uniqueActiveTestClient(supabase)).slug;
  }
  const batchInput = parseJson(body.batch);
  const requestedBatchId = clean(body.batch_id);
  const hasNewBatchInput = body.batch != null && Object.keys(batchInput).length > 0;
  const appendToBatch = !!requestedBatchId;
  let items = Array.isArray(body.items) ? body.items.map(parseJson) : [];
  if (!clientSlug || items.length < 1 || items.length > MAX_INTAKE_ITEMS
      || (appendToBatch && hasNewBatchInput)
      || (!appendToBatch && !clean(batchInput.name))) {
    throw new GatewayError(400, "invalid_intake_payload");
  }
  if (appendToBatch && !clean(body.expected_batch_updated_at)) {
    throw new GatewayError(400, "cas_required");
  }
  const teams = new Set(items.map(item => normalizeTeam(item.team)).filter(Boolean));
  if (teams.size < 1 || teams.size > 2 || items.some(item => !normalizeTeam(item.team))) {
    throw new GatewayError(400, "invalid_intake_teams");
  }
  // Validate every caller-owned item field before any external generator call.
  // The provider response is matched by these already-validated video numbers.
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const videoNumber = appendToBatch ? index + 1 : Number(item.videoNumber ?? item.number ?? index + 1);
    const priority = item.priority == null || item.priority === "" ? null : Number(item.priority);
    const sortKey = appendToBatch ? index : (item.sort_key == null ? index : Number(item.sort_key));
    // Validation only — this loop runs before the principal is known. The
    // real normalisation happens where the row is built, below.
    const status = lower(item.status || INTAKE_CREATED_STATUS);
    const videoTitle = normalizeTeam(item.team) === "video" ? clean(item.title) : "";
    if (!Number.isInteger(videoNumber) || videoNumber < 1) {
      throw new GatewayError(400, "invalid_intake_video_number", { item_index: index });
    }
    // A VIDEO assignee may be chosen; graphics may not, and eligibility is
    // asserted once per team where the plan is built. Shape only here.
    if (clean(item.assignee_id) && normalizeTeam(item.team) !== "video") {
      throw new GatewayError(400, "intake_assignee_override_not_allowed", { item_index: index });
    }
    if ((!appendToBatch && videoTitle && videoTitle.length > 500)
        || !validDateOrNull(item.due_date)
        || (priority != null && (!Number.isInteger(priority) || priority < 0 || priority > 4))
        || !Number.isFinite(sortKey) || sortKey < 0
        || !DELIVERABLE_STATUSES.includes(status)) {
      throw new GatewayError(400, "invalid_intake_item", { item_index: index });
    }
  }
  const teamList = ["video", "graphics"].filter(team => teams.has(team));
  // Counts rows this request tried to create already started. Non-zero means a
  // caller sent a status only a pre-#1073 client sends, which is the signal
  // that someone is on a stale tab — reported rather than swallowed.
  const startedAtCreate = { normalized: 0 };
  /*
   * The public allowance is attempted ONLY after `authenticate` has refused for
   * want of credentials, and only on the submission surface. Ordering matters:
   * a caller who DID present a credential is judged on that credential and can
   * never fall through to the public path — so a `creative` key or a client
   * review token is still refused below rather than quietly upgraded.
   */
  let principal: Principal;
  let publicIntake = false;
  try {
    principal = await authenticate(supabase, req, body, clientSlug);
  } catch (error) {
    const credentialless = error instanceof GatewayError
      && error.status === 401
      && error.code === "credentials_required";
    if (!credentialless || surface !== PUBLIC_INTAKE_SURFACE) throw error;
    if (!await publicIntakeEnabled(supabase)) throw error;
    if (items.length > MAX_PUBLIC_INTAKE_ITEMS) {
      throw new GatewayError(413, "public_intake_too_large");
    }
    const publicClient = await clientBySlug(supabase, clientSlug);
    if (!publicClient || publicClient.active !== true) throw new GatewayError(403, "client_inactive");
    await assertPublicIntakeWithinRate(supabase, publicClient.slug);
    principal = publicIntakePrincipal(publicClient);
    publicIntake = true;
  }
  if (principal.kind === "client" || (principal.kind === "staff" && !["admin", "smm"].includes(principal.keyRole))) {
    throw new GatewayError(403, "operation_forbidden");
  }
  const client = principal.client || await clientBySlug(supabase, clientSlug);
  if (!client || client.active !== true) throw new GatewayError(403, "client_inactive");
  if (publicIntake) {
    /*
     * Logged BEFORE the work is created. If the insert below fails the caller
     * has still consumed a slot, which is the safe direction: a retry storm is
     * exactly the shape this limit exists to stop, and an unlogged failure
     * would let one refuse itself into an unbounded loop.
     */
    const { error: logError } = await supabase.from("public_intake_log").insert({
      client_slug: client.slug,
      request_id: requestId,
      item_count: items.length,
    });
    if (logError) throw new GatewayError(503, "public_intake_rate_unavailable");
  }
  // This read-only validation happens before the first native row write.
  const projectByTeam: Record<string, string> = {};
  const authorityByTeam: Record<string, "linear" | "syncview"> = {};
  const parityByTeam: Record<string, boolean> = {};
  const generationByTeam: Record<string, number> = {};
  for (const team of teamList) {
    projectByTeam[team] = await projectForIntake(client, team, principal);
    authorityByTeam[team] = principal.testOnly ? "syncview" : await authorityFor(supabase, team);
    // Native intake is already an authenticated native-first flow. The server
    // selects parity only for the still-Linear-authoritative leg; a mixed
    // graphics-first request therefore takes one normal and one parity lane.
    parityByTeam[team] = !principal.testOnly && authorityByTeam[team] === "linear";
    generationByTeam[team] = await f27WriteAuthorizationGeneration(supabase, team);
  }
  if (Object.values(parityByTeam).some(Boolean)) await assertLegacyParityEnabled(supabase);

  let appendBatch: JsonMap | null = null;
  let appendBatchRows: JsonMap[] = [];
  if (appendToBatch) {
    const [{ data: batchData, error: batchError }, { data: batchDeliverables, error: batchDeliverablesError }] = await Promise.all([
      supabase.from("batches").select("*").eq("id", requestedBatchId).maybeSingle(),
      supabase.from("deliverables").select("*").eq("batch_id", requestedBatchId),
    ]);
    if (batchError || batchDeliverablesError) throw new GatewayError(503, "batch_lookup_unavailable");
    if (!batchData) throw new GatewayError(404, "batch_not_found");
    appendBatch = batchData as JsonMap;
    appendBatchRows = (batchDeliverables || []) as JsonMap[];
    if (clean(appendBatch.client_slug) !== clientSlug) throw new GatewayError(403, "batch_client_mismatch");
    if (lower(appendBatch.status) !== "active") throw new GatewayError(409, "batch_not_active");
    /*
     * THE `team` COLUMN IS NOT EVIDENCE ABOUT PARENTS, so it no longer decides
     * whether a batch may take this append (2026-08-26).
     *
     * It used to: `batchTeam && teamList.some(team => team !== batchTeam)` threw
     * `batch_team_mismatch` here. But the column describes the batch's EXISTING
     * CHILDREN -- the B1 import derives it as "the one team all my children
     * share, or null when they span both" (b1-linear-backfill.js:760) while the
     * parent map keys come from each child's PARENT's team, and the importer
     * states at :848-865 that the two "legitimately disagree -- a graphics child
     * can hang off a video batch card". So this refused appends whose parents
     * resolve perfectly, for the sole reason that the batch had not held that
     * kind of work before. Measured 2026-08-26: 143 of 397 active batches carry
     * a stamp and every one of them was refused a mixed post; two SMMs reported
     * it the same day as batches "not appearing in the list", and the by-hand
     * workaround is undone by the next import.
     *
     * What decides it instead is what always should have: whether a parent can
     * be resolved for each team. That happens a few lines below -- the shared
     * route, `ownsDistinctParent`, and `validateLinearBatchParent`, which still
     * compares the parent issue's PROJECT and so still refuses the mirrored
     * shape `synthesizeParentMap` can produce. A batch that genuinely cannot
     * file a team is still refused, by `batch_parent_mapping_missing`, which
     * names the real reason.
     *
     * The SQL side of this guard is removed by
     * migrations/2026-08-26-production-intake-append-v7.sql, which must be
     * applied BEFORE this function is deployed.
     */
    if (!Number.isFinite(Date.parse(clean(body.expected_batch_updated_at)))) {
      throw new GatewayError(400, "invalid_expected_batch_updated_at");
    }
  }

  const batchId = appendToBatch
    ? requestedBatchId
    : await deterministicNativeId("bat", requestId, "submission");
  let intakePlan = { description: "", planUrl: "", status: "not_applicable", alert: null as string | null };
  if (!appendToBatch) {
    // Resolve once before the first write. An exact replay preserves its first
    // server-attached link/marker instead of changing the deterministic batch
    // fingerprint when a plan is edited later.
    const { data: existingBatch, error: existingBatchError } = await supabase.from("batches")
      .select("id,description,filming_doc_url")
      .eq("id", batchId)
      .maybeSingle();
    if (existingBatchError) throw new GatewayError(503, "batch_lookup_unavailable");
    if (existingBatch) {
      const existingPlanUrl = clean(existingBatch.filming_doc_url);
      intakePlan = {
        description: clean(existingBatch.description),
        planUrl: existingPlanUrl,
        status: existingPlanUrl ? "existing" : "missing",
        alert: existingPlanUrl ? null : "This existing submission has no filming plan; add or repair the protected mapping.",
      };
    } else {
      intakePlan = intakeDescriptionWithFilmingPlan(
        batchInput.description,
        await intakeFilmingPlanForClient(supabase, clientSlug),
        clean(batchInput.filming_doc_url),
      );
    }
  }
  const deliverableIds = await Promise.all(items.map((_item, index) =>
    deterministicNativeId("del", requestId, `${normalizeTeam(items[index].team)}:${index}`)
  ));
  const { data: existingDeliverables, error: existingError } = await supabase.from("deliverables")
    .select("*")
    .in("id", deliverableIds);
  if (existingError) throw new GatewayError(503, "deliverable_lookup_unavailable");
  const existingById = new Map(((existingDeliverables || []) as JsonMap[]).map(row => [clean(row.id), row]));
  if (appendToBatch) {
    try {
      // The BATCH's purpose flavours append titles, not the surface -- the two
      // already agree (the RPC refuses a row whose origin disagrees with the
      // batch), and the batch is the thing whose numbering must stay coherent.
      items = planAppendIntakeItems(appendBatchRows, items, deliverableIds,
        clean(appendBatch && (appendBatch as JsonMap).purpose)).map(parseJson);
    } catch (error) {
      const code = error instanceof Error ? error.message : "invalid_intake_append_plan";
      throw new GatewayError(code === "intake_id_conflict" ? 409 : 400, code);
    }
  }
  const skipGraphicGeneration = body.skip_graphic_generation === true;
  if (skipGraphicGeneration && principal.kind !== "test") {
    throw new GatewayError(403, "skip_graphic_generation_forbidden");
  }
  /*
   * `graphics_brief_server_owned` refused a caller-supplied graphics brief,
   * because the server owned that field and filled it with generated text. The
   * owner retired the generator (2026-08-17), so the only thing this guard now
   * protects is an empty field against the person best placed to fill it --
   * which is how an SMM ends up writing the real brief in Linear instead, the
   * exact detour that produced today's duplicate thumbnails.
   *
   * It stays retired. The 2026-08-20 restore below never overwrites a
   * caller-supplied brief -- it only fills one that is empty, and only on the
   * Submit tab. A human who writes a brief always wins.
   */
  const graphicBatchContext = appendToBatch && appendBatch
    ? { name: appendBatch.name, notes: appendBatch.description }
    : { ...batchInput, notes: clean(batchInput.notes || body.notes) };
  // Submit-tab thumbnail text. Every gate lives in submissionThumbnailText and
  // every failure mode returns an empty map, so this call cannot change any
  // brief it is not entitled to and cannot fail the submission. See the block
  // comment on that function for the eight conditions and why each exists.
  const thumbnailText = await submissionThumbnailText(
    supabase,
    client,
    graphicBatchContext as JsonMap,
    items,
    existingById,
    deliverableIds,
    {
      surface,
      appendToBatch,
      planStatus: clean(intakePlan.status),
      skipGeneration: skipGraphicGeneration,
    },
  );
  /*
   * A caller MAY now choose the video editor (owner request 2026-08-24: the
   * Create Post dialog gets an editor dropdown, defaulting to the freest and
   * overridable). Graphics is unchanged and still refuses an override — that
   * team assigns by its single `default_for_team` designer, so there is nothing
   * to choose between.
   *
   * The choice is validated exactly like every other assignee write, through
   * assertEligibleAssignee: active, on the right team, role-compatible, and
   * mirrorable. So this widens WHO may be picked, never HOW the pick is
   * checked, and a picker still cannot enumerate the roster (missing,
   * inactive, cross-team and role-incompatible all share one 403).
   *
   * One choice per team per request. Two items disagreeing is a malformed
   * submission, not a partial one, and it is refused before anything is
   * written rather than letting item order silently decide.
   */
  const requestedByTeam: Record<string, string> = {};
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const team = normalizeTeam(item.team);
    const requested = clean(item.assignee_id);
    if (!requested) continue;
    if (team !== "video") {
      throw new GatewayError(400, "intake_assignee_override_not_allowed", { item_index: index });
    }
    if (requestedByTeam[team] && requestedByTeam[team] !== requested) {
      throw new GatewayError(400, "intake_assignee_override_conflict", { item_index: index });
    }
    requestedByTeam[team] = requested;
  }
  for (const team of Object.keys(requestedByTeam)) {
    await assertEligibleAssignee(supabase, requestedByTeam[team], team);
  }

  const assigneeByTeam: Record<string, string> = {};
  for (const team of teamList) {
    const teamRows = [...existingById.values()].filter(row => normalizeTeam(row.team) === team);
    /* Only rows a prior ATTEMPT wrote may constrain the plan. Assignees on
       rows the mirror materialized are observations copied from Linear, not
       choices this request made, and two of them disagreeing must not
       dead-end the resume; they still win as a fallback so a resumed
       submission does not churn assignees for no reason. */
    const gatewayAssignees = new Set(teamRows
      .filter(row => clean(row.created_by) !== "linear-backfill")
      .map(row => clean(row.assignee_id))
      .filter(Boolean));
    if (gatewayAssignees.size > 1) throw new GatewayError(409, "intake_id_conflict");
    const mirrorAssignees = new Set(teamRows
      .filter(row => clean(row.created_by) === "linear-backfill")
      .map(row => clean(row.assignee_id))
      .filter(Boolean));
    /*
     * A prior attempt's assignee still wins over a fresh request. A retry of
     * the SAME submission must land on the same rows it already created — the
     * request id is what makes it a retry — and re-pointing those rows at a
     * newly-picked editor would silently move work someone may already have
     * started. A different choice is a different submission, and gets its own
     * request id.
     */
    assigneeByTeam[team] = gatewayAssignees.size === 1
      ? [...gatewayAssignees][0]
      : requestedByTeam[team]
        ? requestedByTeam[team]
        : mirrorAssignees.size === 1
          ? [...mirrorAssignees][0]
          : await autoAssigneeForIntake(supabase, team);
  }

  const plannedItems: JsonMap[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const team = normalizeTeam(item.team);
    const assigneeId = assigneeByTeam[team];
    const videoNumber = Number(item.videoNumber ?? item.number ?? index + 1);
    if (!Number.isInteger(videoNumber) || videoNumber < 1) {
      throw new GatewayError(400, "invalid_intake_item", { item_index: index });
    }
    /*
     * OWNER RULING 2026-08-17, both parts.
     *
     * TITLE: the graphics child was called `Video N`, exactly like its video
     * sibling, so the two were indistinguishable in Linear -- the owner read
     * his own test post as "two video sub-issues". It is a thumbnail; it says
     * Thumbnail.
     *
     * BRIEF: it was written by a generator. On the owner's test post that
     * produced "Sidney Laruel center frame, confident direct gaze, bold text
     * overlay with name and date, clean gradient background in deep navy and
     * gold tones" -- invented, about a real client, landing on the designer's
     * card as if it were instructions. In the owner's words: "there should
     * never be a description done by AI". So no brief is generated; a graphics
     * brief is written by the person who knows what the thumbnail is for, and
     * an empty one is honestly empty rather than confidently wrong.
     */
    // Samples children are titled 'Sample Video N' / 'Sample Thumbnail N'
    // (owner ruling 2026-08-19). The prefix rides intakePurpose, the same
    // value that stamps the batch purpose and row origin, so a title can
    // never disagree with the batch it lands in.
    const intakeTitlePrefix = intakePurpose === "samples" ? "Sample " : "";
    const fallbackTitle = `${intakeTitlePrefix}Video ${videoNumber}`;
    const title = team === "graphics" ? `${intakeTitlePrefix}Thumbnail ${videoNumber}` : clean(item.title) || fallbackTitle;
    const sourceBrief = clean(item.brief);
    const existingBrief = clean(existingById.get(deliverableIds[index])?.brief);
    // The generated line is LAST, so a prior attempt's brief and a
    // caller-supplied brief both outrank it. It is empty for every item on
    // every path except a Submit-tab graphics child whose plan cleared all
    // eight gates, which is why the video child and the batch parent -- neither
    // of which reads this expression -- cannot be reached from here.
    const brief = existingBrief || sourceBrief
      || (team === "graphics" ? clean(thumbnailText.get(index)) : "");
    const priority = item.priority == null || item.priority === "" ? null : Number(item.priority);
    const sortKey = item.sort_key == null ? index : Number(item.sort_key);
    const plannedStatus = intakeCreateStatus(item.status, principal.testOnly, startedAtCreate);
    /*
     * ACROSS THE ROLLOUT, A RETRY IS STILL THE SAME ROW.
     *
     * A submission that committed under the PREVIOUS gateway stored
     * `in_progress`. Retried after this deploy — the ordinary case where a
     * response was lost — the plan now says `todo`, and
     * `intakeExistingRowConflict` compares status, so an idempotent retry would
     * come back `409 intake_id_conflict`: a failed submission reported for work
     * that already exists. That is a worse failure than the one the guard is
     * fixing, and it lands on whoever is unlucky enough to retry across the
     * deploy boundary.
     *
     * So when a row is already here and already started, the retry ADOPTS the
     * stored status instead of planning over it. Adopting rather than
     * correcting is deliberate: the plan is written to the row, so "correcting"
     * would drag a deliverable an editor has genuinely started back to To Do on
     * any retry. Repairing rows created before the guard is a separate,
     * deliberate act — not a side effect of someone pressing submit twice.
     *
     * Narrow on purpose: only when THIS plan is the created-status default, and
     * only toward a status the guard itself recognises as started. Every other
     * status difference still conflicts exactly as before.
     */
    const existingForStatus = existingById.get(deliverableIds[index]);
    const status = existingForStatus
      && plannedStatus === INTAKE_CREATED_STATUS
      && STARTED_STATUSES_AT_CREATE.has(clean(existingForStatus.status))
      ? clean(existingForStatus.status)
      : plannedStatus;
    if (clean(item.assignee_id) && normalizeTeam(item.team) !== "video") {
      throw new GatewayError(400, "intake_assignee_override_not_allowed", { item_index: index });
    }
    if (!title || title.length > 500
        || !validDateOrNull(item.due_date)
        || (priority != null && (!Number.isInteger(priority) || priority < 0 || priority > 4))
        || !Number.isFinite(sortKey) || sortKey < 0
        || !DELIVERABLE_STATUSES.includes(status)) {
      throw new GatewayError(400, "invalid_intake_item", { item_index: index });
    }
    const row: JsonMap = {
      id: deliverableIds[index],
      identifier: null,
      batch_id: batchId,
      client_slug: clientSlug,
      team,
      kind: team === "graphics" ? "thumbnail" : "video",
      title,
      brief: brief || null,
      status,
      status_at: sourceEditedAt,
      assignee_id: assigneeId,
      due_date: clean(item.due_date) || null,
      priority,
      origin: intakePurpose,
      card_id: clean(item.card_id) || null,
      sort_key: sortKey,
      ...(appendToBatch ? { _intake_ordinal: Number(item._intake_ordinal) } : {}),
      created_by: principal.actorKey,
      created_at: sourceEditedAt,
      // No Linear issue exists yet; `linear-outbound` adds `issue` alongside
      // this on drain via a spread, so the stamp survives. Without it the row
      // reaches the reconciler unstamped and diffs until B1's next pass.
      linear_raw: { attribution: intakeAttribution(client, team, projectByTeam[team] || "") },
    };
    const existing = existingById.get(deliverableIds[index]);
    if (intakeExistingRowConflict(existing, row)) {
      throw new GatewayError(409, "intake_id_conflict", { item_index: index });
    }
    plannedItems.push({ item_index: index, video_number: videoNumber, source_brief: sourceBrief, row });
  }

  // Intake has no canonical-artifact input. A new Graphics item therefore
  // cannot begin at SMM Approval; an exact retry may do so only when its
  // already-persisted canonical file independently passes the same fresh
  // server evidence gate as an ordinary status transition. This runs before
  // either the append or new-batch path performs its first native write.
  for (const planned of plannedItems) {
    const row = planned.row as JsonMap;
    if (normalizeTeam(row.team) !== "graphics" || lower(row.status) !== "smm_approval") continue;
    const existing = existingById.get(clean(row.id));
    if (!existing) {
      throw new GatewayError(409, "artifact_not_resolvable", {
        asset_state: "missing",
        checked_at: new Date().toISOString(),
        guidance: assetGuidance("missing"),
      });
    }
    await assertGraphicsApprovalArtifact(supabase, existing);
  }

  if (appendToBatch) {
    if (!appendBatch) throw new GatewayError(500, "batch_lookup_unavailable");
    const exactRowRetry = existingById.size === deliverableIds.length;
    /*
     * One parent per card applies to an append too: a post added to an
     * existing batch hangs under the SAME parent as the rest of it. The route
     * is therefore resolved once, for the parent team, and reused.
     *
     * A batch created before 2026-08-18 has a real, distinct parent for each
     * team. Those keep theirs -- rerouting their new thumbnails under the
     * video parent would leave an existing GRA parent recorded on the batch
     * while its newest child hung somewhere else, which is worse than either
     * shape on its own. `ownsDistinctParent` is exactly that test: a parent
     * recorded for this team that is NOT the shared issue.
     */
    const appendParentTeam = teamList.includes("video") ? "video" : teamList[0];
    const sharedAppendRoute = await parentRouteForAppend(
      supabase,
      appendBatch,
      clientSlug,
      appendParentTeam,
      projectByTeam[appendParentTeam],
      principal,
      parityByTeam[appendParentTeam],
      !exactRowRetry,
    );
    const sharedParentIds = parentIdsForTeam(appendBatch.linear_parent_ids, appendParentTeam);
    const parentRouteByTeam: Record<string, JsonMap> = {};
    for (const team of teamList) {
      if (team === appendParentTeam) {
        parentRouteByTeam[team] = sharedAppendRoute;
        continue;
      }
      const ownIds = parentIdsForTeam(appendBatch.linear_parent_ids, team);
      const ownsDistinctParent = ownIds.length === 1 && !sharedParentIds.includes(ownIds[0]);
      parentRouteByTeam[team] = ownsDistinctParent
        ? await parentRouteForAppend(
          supabase,
          appendBatch,
          clientSlug,
          team,
          projectByTeam[team],
          principal,
          parityByTeam[team],
          !exactRowRetry,
        )
        : sharedAppendRoute;
    }

    const appendEvents: JsonMap[] = [];
    for (const planned of plannedItems) {
      const index = Number(planned.item_index);
      const row = planned.row as JsonMap;
      const team = normalizeTeam(row.team);
      const projectId = projectByTeam[team];
      const legacyParity = parityByTeam[team];
      const parentRoute = parentRouteByTeam[team];
      const childDedup = dedupKey("create", "deliverable", clean(row.id), requestId);
      const routeFingerprint = {
        parent_linear_issue_id: clean(parentRoute.parent_linear_issue_id) || null,
        depends_on_id: Number(parentRoute.depends_on_id) || null,
        dependency_dedup_key: clean(parentRoute.dependency_dedup_key) || null,
      };
      const childFingerprint = await intentFingerprint({
        operation: "intake_create", mode: "append", requestId, surface, legacyParity,
        actorKey: principal.actorKey, clientSlug, team, projectId, batchId,
        expectedBatchUpdatedAt: clean(body.expected_batch_updated_at),
        parentRoute: routeFingerprint,
        item_index: index,
        row: {
          id: row.id, title: row.title, source_brief: planned.source_brief,
          video_number: planned.video_number, status: row.status,
          assignee_id: row.assignee_id, due_date: row.due_date, priority: row.priority,
          card_id: row.card_id, sort_key: row.sort_key,
        },
      });
      const childOutbound: JsonMap = {
        entity: "deliverable",
        entity_id: row.id,
        team,
        operation: "create",
        dedup_key: childDedup,
        source_edited_at: sourceEditedAt,
        test_only: principal.testOnly,
        legacy_parity: legacyParity,
        ...(routeFingerprint.depends_on_id ? { depends_on_id: routeFingerprint.depends_on_id } : {}),
        payload: f27FencedPayload({
          team_id: teamIdFor(team) || undefined,
          project_id: projectId,
          ...(routeFingerprint.parent_linear_issue_id
            ? { parent_linear_issue_id: routeFingerprint.parent_linear_issue_id }
            : {}),
          title: row.title,
          description: row.brief || undefined,
          status: row.status,
          assignee_id: row.assignee_id,
          due_date: row.due_date || undefined,
          priority: row.priority == null ? undefined : row.priority,
          _intent_fingerprint: childFingerprint,
        }, generationByTeam[team], legacyParity),
      };
      const childEvent = eventFor(
        "intake_create", principal, sourceEditedAt, surface, childOutbound, null, clean(row.status),
      );
      planned.child_dedup = childDedup;
      planned.child_outbound = childOutbound;
      planned.child_event = childEvent;
      planned.child_replay = await assertDedupIntent(
        supabase,
        childDedup,
        dedupExpectation(principal, team, sourceEditedAt, childOutbound, childFingerprint),
      );
      appendEvents.push(childEvent);
    }

    const replayCount = plannedItems.filter(item => item.child_replay === true).length;
    if (replayCount > 0 && replayCount !== plannedItems.length) {
      throw new GatewayError(409, "idempotency_conflict");
    }
    const exactReplay = replayCount === plannedItems.length;
    if (exactReplay && deliverableIds.some(id => !existingById.has(id))) {
      throw new GatewayError(500, "idempotent_result_missing");
    }
    if (!exactReplay) {
      const expectedAt = Date.parse(clean(body.expected_batch_updated_at));
      const currentAt = Date.parse(clean(appendBatch.updated_at));
      if (!Number.isFinite(currentAt) || currentAt !== expectedAt) {
        throw new GatewayError(409, "write_conflict", {
          conflict: true,
          batch: publicRow(appendBatch),
        });
      }
      await rpc(supabase, "production_intake_append", {
        p_batch_id: batchId,
        p_expected_updated_at: clean(body.expected_batch_updated_at),
        p_rows: plannedItems.map(item => item.row),
        p_events: appendEvents,
      });
    }

    const drainPlans: JsonMap[] = [];
    const seenDrainDedups = new Set<string>();
    for (const team of teamList) {
      const route = parentRouteByTeam[team];
      const dependencyDedup = clean(route.dependency_dedup_key);
      if (dependencyDedup && !seenDrainDedups.has(dependencyDedup)) {
        seenDrainDedups.add(dependencyDedup);
        drainPlans.push({
          dedup_key: dependencyDedup,
          team,
          targeted: principal.testOnly || parityByTeam[team] === true,
        });
      }
    }
    for (const planned of plannedItems) {
      const childDedup = clean(planned.child_dedup);
      if (!seenDrainDedups.has(childDedup)) {
        seenDrainDedups.add(childDedup);
        drainPlans.push({
          dedup_key: childDedup,
          team: normalizeTeam((planned.row as JsonMap).team),
          targeted: principal.testOnly || (planned.child_outbound as JsonMap).legacy_parity === true,
        });
      }
    }

    const mirrorResults: JsonMap[] = [];
    for (const plan of drainPlans) {
      if (plan.targeted === true) {
        mirrorResults.push({ dedup_key: plan.dedup_key, ...await targetedDrain(clean(plan.dedup_key), principal) });
      }
    }
    const syncviewLiveDrain = drainPlans.some(plan => plan.targeted !== true
      && authorityByTeam[normalizeTeam(plan.team)] === "syncview")
      && await outboundLiveForDrain(supabase);
    if (syncviewLiveDrain) {
      scheduleSyncviewLiveDrains(
        drainPlans.filter(plan => plan.targeted !== true
          && authorityByTeam[normalizeTeam(plan.team)] === "syncview")
          .map(plan => clean(plan.dedup_key)),
        principal,
      );
    }
    const targetedFailure = mirrorResults.some(result => result.acknowledged !== true);
    const hasNormalPending = drainPlans.some(plan => plan.targeted !== true);
    const mirrorPending = targetedFailure || hasNormalPending;
    const [currentBatchResult, currentItemsResult] = await Promise.all([
      supabase.from("batches").select("*").eq("id", batchId).maybeSingle(),
      supabase.from("deliverables").select("*").in("id", deliverableIds),
    ]);
    if (currentBatchResult.error || currentItemsResult.error || !currentBatchResult.data) {
      throw new GatewayError(500, "native_response_refresh_failed");
    }
    const currentItemsById = new Map(
      ((currentItemsResult.data || []) as JsonMap[]).map(row => [clean(row.id), row]),
    );
    const responseItems = plannedItems.map(planned => {
      const row = currentItemsById.get(clean((planned.row as JsonMap).id));
      if (!row) throw new GatewayError(500, "idempotent_result_missing");
      return {
        item_index: planned.item_index,
        video_number: Number(planned.video_number),
        ...publicRow(row),
      };
    });
    return json({
      ok: true,
      native_committed: true,
      authority: authorityByTeam,
      legacy_parity: parityByTeam,
      mirror_pending: mirrorPending,
      mirror: mirrorResults,
      batch_mode: "existing",
      batch: publicRow(currentBatchResult.data),
      items: responseItems,
      started_at_create_normalized: startedAtCreate.normalized,
    }, targetedFailure ? 202 : (exactReplay ? 200 : 201));
  }

  const batchRow: JsonMap = {
    id: batchId,
    client_slug: clientSlug,
    team: teamList.length === 1 ? teamList[0] : null,
    name: clean(batchInput.name).slice(0, 500),
    description: intakePlan.description || null,
    filming_doc_url: intakePlan.planUrl || null,
    footage_folder_url: clean(batchInput.footage_folder_url) || null,
    delivery_folder_url: clean(batchInput.delivery_folder_url) || null,
    color: clean(batchInput.color) || null,
    status: "active",
    purpose: intakePurpose,
    created_by: principal.actorKey,
    created_at: sourceEditedAt,
  };
  /*
   * ONE PARENT PER CARD -- owner ruling 2026-08-18.
   *
   * A card is one post. It now mints ONE Linear parent issue and hangs both
   * the video and the thumbnail under it, instead of one parent per team.
   * 32 of the 36 active clients already point both teams at the SAME Linear
   * project, so a shared parent is the shape their boards were already in;
   * two parents was the exception dressed as the rule.
   *
   * The parent is owned by the PRIMARY team -- video when the card has one,
   * otherwise the card's only team -- and it is created in that team, in that
   * team's project. `parentTeams` travels on the payload so the drain can
   * record the resulting issue for EVERY team the card serves; anything that
   * later asks "what is the graphics parent of this batch" must get an
   * answer, or appending a post to an existing batch, archive parking and the
   * reconcilers all resolve nothing.
   *
   * This is the DELIBERATE version of a shape the estate was already
   * producing by accident. Until 2026-08-18 a graphics parent create whose
   * batch held only a video entry silently adopted that video issue, so the
   * same card came out with one parent or two depending on whether the two
   * drains happened to share a sweep. The resolver no longer guesses (see
   * batchParentId in linear-outbound); the planner states the shape here.
   */
  const parentTeam = teamList.includes("video") ? "video" : teamList[0];
  const parentPlans: JsonMap[] = [];
  for (const team of [parentTeam]) {
    const parentDedup = dedupKey("create", "batch", batchId, `${requestId}:${team}`);
    const parentFingerprint = await intentFingerprint({
      operation: "intake_create", requestId, surface, team,
      parentTeams: teamList,
      legacyParity: parityByTeam[team], actorKey: principal.actorKey,
      clientSlug, projectId: projectByTeam[team],
      batch: {
        name: batchRow.name,
        description: batchRow.description,
        filming_doc_url: batchRow.filming_doc_url,
        footage_folder_url: batchRow.footage_folder_url,
        delivery_folder_url: batchRow.delivery_folder_url,
        color: batchRow.color,
      },
      items: plannedItems.map(item => {
        const row = item.row as JsonMap;
        return {
          id: row.id, title: row.title, source_brief: item.source_brief,
          video_number: item.video_number, status: row.status,
          assignee_id: row.assignee_id, due_date: row.due_date, priority: row.priority,
          card_id: row.card_id, sort_key: row.sort_key,
        };
      }),
    });
    const parentOutbound: JsonMap = {
      entity: "batch", entity_id: batchId, team, operation: "create",
      dedup_key: parentDedup, source_edited_at: sourceEditedAt,
      test_only: principal.testOnly, legacy_parity: parityByTeam[team],
      payload: f27FencedPayload({
        team_id: teamIdFor(team) || undefined,
        project_id: projectByTeam[team],
        title: clean(batchInput.name),
        description: clean(batchRow.description) || undefined,
        /*
         * A batch parent must declare its own state, because Linear applies
         * the TEAM DEFAULT to any create that does not.
         *
         * Video has triage enabled and Graphics does not, so the same code
         * path produced two different results: every Video batch parent landed
         * in Triage — a queue the studio has never used and does not watch —
         * while Graphics parents looked correct. The child items were never
         * affected; they have always carried `status` (see the items map
         * above), which is what resolves `context.state_id` in
         * linear-outbound's resolveContext.
         *
         * "todo" is the deliberate choice, not the Linear default: a freshly
         * created batch is work that exists and has not started. Both teams
         * expose a state named exactly "Todo", so stateIdForSlug resolves it
         * for each; a team that ever loses that state fails the create closed
         * ("outbound state mapping missing") rather than silently landing
         * somewhere unwatched again.
         *
         * Declaring it also arms the post-create check: createIntentMismatches
         * only verifies state when the payload carries `status` or `state_id`,
         * so until now nothing compared where the parent actually landed.
         */
        status: "todo",
        // Every team this one parent serves. linear-outbound records the
        // created issue under each of them, so a later append, an archive
        // park, or a reconciler asking for the graphics parent of this batch
        // resolves the shared issue instead of nothing.
        _parent_teams: teamList,
        _intent_fingerprint: parentFingerprint,
      }, generationByTeam[team], parityByTeam[team]),
    };
    const parentEvent = eventFor("intake_create", principal, sourceEditedAt, surface, parentOutbound, null);
    const parentReplay = await assertDedupIntent(
      supabase, parentDedup,
      dedupExpectation(principal, team, sourceEditedAt, parentOutbound, parentFingerprint),
    );
    parentPlans.push({ team, dedup: parentDedup, outbound: parentOutbound, event: parentEvent, replay: parentReplay });
  }

  for (const planned of plannedItems) {
    const index = Number(planned.item_index);
    const row = planned.row as JsonMap;
    const team = normalizeTeam(row.team);
    const projectId = projectByTeam[team];
    const legacyParity = parityByTeam[team];
    const childDedup = dedupKey("create", "deliverable", clean(row.id), requestId);
    const childFingerprint = await intentFingerprint({
      operation: "intake_create", requestId, surface, legacyParity,
      actorKey: principal.actorKey, clientSlug, team, projectId, item_index: index,
      row: {
        id: row.id, title: row.title, source_brief: planned.source_brief,
        video_number: planned.video_number, status: row.status,
        assignee_id: row.assignee_id, due_date: row.due_date, priority: row.priority,
        card_id: row.card_id, sort_key: row.sort_key,
      },
    });
    const childOutbound: JsonMap = {
      entity: "deliverable",
      entity_id: row.id,
      team,
      operation: "create",
      dedup_key: childDedup,
      source_edited_at: sourceEditedAt,
      test_only: principal.testOnly,
      legacy_parity: legacyParity,
      payload: f27FencedPayload({
        team_id: teamIdFor(team) || undefined,
        project_id: projectId,
        title: row.title,
        description: row.brief || undefined,
        status: row.status,
        assignee_id: row.assignee_id,
        due_date: row.due_date || undefined,
        priority: row.priority == null ? undefined : row.priority,
        _intent_fingerprint: childFingerprint,
      }, generationByTeam[team], legacyParity),
    };
    planned.child_dedup = childDedup;
    planned.child_fingerprint = childFingerprint;
    planned.child_outbound = childOutbound;
    planned.child_replay = await assertDedupIntent(
      supabase,
      childDedup,
      dedupExpectation(principal, team, sourceEditedAt, childOutbound, childFingerprint),
    );
  }

  // Every item, mapping, assignee, existing deterministic row, and dedup
  // fingerprint is validated above before the first native RPC commits.
  const firstParent = parentPlans[0];
  const batch = await ensureBatch(
    supabase,
    batchRow,
    firstParent.event as JsonMap,
    clean(firstParent.dedup),
    firstParent.replay === true,
  );
  // One parent, so every child depends on the same outbox row whatever team
  // it belongs to. The map is kept rather than collapsed to a scalar because
  // the append path still routes per team through linear_parent_ids, and a
  // single lookup key here would hide which team actually owns the parent.
  const sharedParentOutboxId = batch.outboxId;
  const parentOutboxByTeam: Record<string, number> = {};
  for (const team of teamList) parentOutboxByTeam[team] = sharedParentOutboxId;
  const responseItems: JsonMap[] = [];
  const displacedBatchIds = new Set<string>();
  const drainPlans: JsonMap[] = parentPlans.map(parent => ({
    dedup_key: parent.dedup,
    team: parent.team,
    targeted: principal.testOnly || (parent.outbound as JsonMap).legacy_parity === true,
  }));
  for (const planned of plannedItems) {
    const index = Number(planned.item_index);
    const row = planned.row as JsonMap;
    const childDedup = clean(planned.child_dedup);
    const childOutbound = planned.child_outbound as JsonMap;
    const itemTeam = normalizeTeam(row.team);
    childOutbound.depends_on_id = parentOutboxByTeam[itemTeam];
    const childEvent = eventFor(
      "intake_create", principal, sourceEditedAt, surface, childOutbound, null, clean(row.status),
    );
    const written = await ensureDeliverable(
      supabase, row, childEvent, childDedup, planned.child_replay === true, displacedBatchIds,
    );
    responseItems.push({ item_index: index, video_number: Number(planned.video_number), ...publicRow(written) });
    drainPlans.push({
      dedup_key: childDedup,
      team: itemTeam,
      targeted: principal.testOnly || childOutbound.legacy_parity === true,
    });
  }

  const mirrorResults: JsonMap[] = [];
  for (const plan of drainPlans) {
    if (plan.targeted === true) {
      mirrorResults.push({ dedup_key: plan.dedup_key, ...await targetedDrain(clean(plan.dedup_key), principal) });
    }
  }
  const syncviewLiveDrain = drainPlans.some(plan => plan.targeted !== true
    && authorityByTeam[normalizeTeam(plan.team)] === "syncview")
    && await outboundLiveForDrain(supabase);
  if (syncviewLiveDrain) {
    scheduleSyncviewLiveDrains(
      drainPlans.filter(plan => plan.targeted !== true
        && authorityByTeam[normalizeTeam(plan.team)] === "syncview")
        .map(plan => clean(plan.dedup_key)),
      principal,
    );
  }
  if (displacedBatchIds.size) {
    // Runs after the targeted drains so the deterministic batch's
    // linear_parent_ids already carries the parent linkage the reclaim needs.
    await reclaimMirrorBatches(supabase, displacedBatchIds, batchId, clientSlug);
  }
  const targetedFailure = mirrorResults.some(result => result.acknowledged !== true);
  const hasNormalPending = drainPlans.some(plan => plan.targeted !== true);
  const mirrorPending = targetedFailure || hasNormalPending;
  // A targeted create drain checkpoints Linear linkage through the ledger RPCs,
  // which deliberately advances updated_at. Return that post-linkage version so
  // the caller's first scalar CAS cannot reject its own successful create.
  const [currentBatchResult, currentItemsResult] = await Promise.all([
    supabase.from("batches").select("*").eq("id", batchId).maybeSingle(),
    supabase.from("deliverables").select("*").in("id", deliverableIds),
  ]);
  if (currentBatchResult.error || currentItemsResult.error || !currentBatchResult.data) {
    throw new GatewayError(500, "native_response_refresh_failed");
  }
  const currentItemsById = new Map(
    ((currentItemsResult.data || []) as JsonMap[]).map(row => [clean(row.id), row]),
  );
  const currentResponseItems = responseItems.map(item => {
    const current = currentItemsById.get(clean(item.id));
    return current
      ? { item_index: item.item_index, video_number: Number(item.video_number), ...publicRow(current) }
      : item;
  });
  return json({
    ok: true,
    native_committed: true,
    authority: authorityByTeam,
    legacy_parity: parityByTeam,
    mirror_pending: mirrorPending,
    mirror: mirrorResults,
    filming_plan_status: intakePlan.status,
    filming_plan_missing: intakePlan.status === "missing",
    filming_plan_alert: intakePlan.alert,
    batch: publicRow(currentBatchResult.data),
    items: currentResponseItems,
    started_at_create_normalized: startedAtCreate.normalized,
  }, targetedFailure ? 202 : 201);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const url = clean(Deno.env.get("SUPABASE_URL"));
  const key = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!url || !key) return json({ ok: false, error: "service_unavailable" }, 503);
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const body = await req.json().catch(() => null) as JsonMap | null;
    if (!body || Array.isArray(body)) throw new GatewayError(400, "invalid_json");
    if (lower(body.action) === "labels_read") {
      return await handleLabelsRead(supabase, req, body);
    }
    if (lower(body.action) === "asset_access_read") {
      return await handleAssetAccessRead(supabase, req, body);
    }
    if (lower(body.action) === "description_read") {
      return await handleDescriptionRead(supabase, req, body);
    }
    if (lower(body.action) === "create_options") {
      return await handleCreateOptions(supabase, req, body);
    }
    if (lower(body.action) === "assignee_options") {
      return await handleAssigneeOptions(supabase, req, body);
    }
    if (body.action !== undefined) throw new GatewayError(400, "unsupported_action");
    const operation = normalizeOperation(body.operation);
    if (!operation) throw new GatewayError(400, "unsupported_operation");
    const surface = surfaceFor(body);
    assertSurfaceOperation(surface, operation);
    const requestId = requestIdFor(body);
    let sourceEditedAt: string;
    try {
      sourceEditedAt = sourceTimestamp(body.source_edited_at);
    } catch (_error) {
      throw new GatewayError(400, "invalid_source_edited_at");
    }
    if (operation === "create") {
      return await handleProductionCreate(
        supabase, req, body, surface, requestId, sourceEditedAt,
      );
    }
    return operation === "intake_create"
      ? await handleIntakeCreate(supabase, req, body, surface, requestId, sourceEditedAt)
      : await handleEntityOperation(supabase, req, body, operation, surface, requestId, sourceEditedAt);
  } catch (error) {
    if (error instanceof GatewayError) {
      return json({ ok: false, error: error.code, ...(error.detail || {}) }, error.status);
    }
    console.error("production-write failed", error instanceof Error ? error.message : "unknown");
    return json({ ok: false, error: "write_failed" }, 500);
  }
});
