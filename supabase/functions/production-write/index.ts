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
  assetUrlType,
  browserCredentialTestOverride,
  canonicalArtifactUrl,
  canonicalDescription,
  canonicalLabelIds,
  clean,
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
  kind: "staff" | "client" | "test";
  keyRole: StaffRoleKey | "client" | "test";
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
const OUTBOUND_FLAG = "linear_outbound_enabled";
const OVERDUE_STATUS_BUMP_FLAG = "write_ui_overdue_due_bump";
const LINEAR_URL = "https://api.linear.app/graphql";
const LABEL_PAGE_SIZE = 100;
const MAX_LABEL_PAGES = 50;
const ASSET_PROBE_TIMEOUT_MS = 8_000;
const MAX_ASSET_REDIRECTS = 3;
const ASSET_EVIDENCE_MAX_AGE_MS = 5 * 60 * 1_000;
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
  if (state === "missing") return "Attach a canonical Graphics deliverable before requesting SMM approval.";
  if (state === "invalid") return "Use a supported HTTPS Drive, Frame.io, or Dropbox file/folder link.";
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

function assetProbeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  const host = lower(url.hostname).replace(/\.$/, "");
  if (host === "drive.google.com") {
    const fileId = url.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)/i)?.[1]
      || url.searchParams.get("id");
    if (fileId) {
      const probe = new URL("https://drive.google.com/uc");
      probe.searchParams.set("export", "download");
      probe.searchParams.set("id", fileId);
      const resourceKey = url.searchParams.get("resourcekey");
      if (resourceKey) probe.searchParams.set("resourcekey", resourceKey);
      return probe.toString();
    }
  }
  if (host === "docs.google.com") {
    const document = url.pathname.match(/^\/document\/d\/([A-Za-z0-9_-]+)/i)?.[1];
    if (document) {
      const probe = new URL(`https://docs.google.com/document/d/${document}/export`);
      probe.searchParams.set("format", "pdf");
      const resourceKey = url.searchParams.get("resourcekey");
      if (resourceKey) probe.searchParams.set("resourcekey", resourceKey);
      return probe.toString();
    }
  }
  if (host === "dropbox.com" || host === "www.dropbox.com") {
    const probe = new URL(url.toString());
    probe.searchParams.delete("dl");
    probe.searchParams.set("raw", "1");
    return probe.toString();
  }
  return url.toString();
}

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
  // A branded landing page does not prove the requested resource exists or is
  // reviewable. Only an unambiguous media/download response above may unlock
  // SMM Approval; all other HTML fails closed.
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
  } catch (_error) {
    return {
      slot,
      state: "unavailable",
      url_type: urlType,
      checked_at: checkedAt,
      guidance: assetGuidance("unavailable"),
    };
  }
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
    result_code: `asset_${state}`,
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
  if (authority === "syncview" || authority === "supabase") return "syncview";
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
    if (surface !== "submission" && surface !== "calendar") {
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
    if (/batch_not_active|batch_team_mismatch|batch_parent_mapping_(missing|ambiguous)/i.test(clean(error.message))) {
      const code = /batch_not_active/i.test(clean(error.message))
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
    if (validateExternal) await validateLinearBatchParent(directIds[0], team, projectId);
    return { parent_linear_issue_id: directIds[0], depends_on_id: null, dependency_dedup_key: null };
  }
  throw new GatewayError(409, "batch_parent_mapping_missing");
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

async function validateAssignee(
  supabase: SupabaseClient,
  assigneeId: string,
  team: string,
): Promise<void> {
  if (!assigneeId) return;
  const { data, error } = await supabase.from("team_members")
    .select("id,team,active")
    .eq("id", assigneeId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new GatewayError(503, "assignee_lookup_unavailable");
  if (!data || normalizeTeam((data as JsonMap).team) !== normalizeTeam(team)) {
    throw new GatewayError(403, "assignee_out_of_scope");
  }
}

async function validateCreateAssignee(
  supabase: SupabaseClient,
  assigneeId: string,
  team: string,
): Promise<{ id: string; linearUserId: string } | null> {
  if (!assigneeId) return null;
  const { data, error } = await supabase.from("team_members")
    .select("id,team,active,linear_user_id")
    .eq("id", assigneeId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new GatewayError(503, "assignee_lookup_unavailable");
  if (!data || normalizeTeam((data as JsonMap).team) !== normalizeTeam(team)) {
    throw new GatewayError(403, "assignee_out_of_scope");
  }
  const linearUserId = clean((data as JsonMap).linear_user_id);
  if (!linearUserId) throw new GatewayError(409, "assignee_mapping_unavailable");
  return { id: clean((data as JsonMap).id), linearUserId };
}

async function mappedCreateAssignees(
  supabase: SupabaseClient,
  team: string,
): Promise<JsonMap[]> {
  const normalizedTeam = normalizeTeam(team);
  const { data, error } = await supabase.from("team_members")
    .select("id,name,team,active,linear_user_id")
    .eq("active", true)
    .eq("team", normalizedTeam);
  if (error) throw new GatewayError(503, "assignee_lookup_unavailable");
  return ((data || []) as JsonMap[])
    .filter(member =>
      normalizeTeam(member.team) === normalizedTeam
      && clean(member.id)
      && clean(member.linear_user_id)
    )
    .map(member => ({
      id: clean(member.id),
      name: clean(member.name) || "Unnamed team member",
    }))
    .sort((left, right) =>
      clean(left.name).localeCompare(clean(right.name))
      || clean(left.id).localeCompare(clean(right.id))
    );
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
  const { data: deliverables, error: loadError } = await supabase.from("deliverables")
    .select("assignee_id,status")
    .eq("team", "video")
    .neq("status", "duplicate");
  if (loadError) throw new GatewayError(503, "assignee_load_unavailable");
  const load = new Map(editors.map(member => [clean(member.id), 0]));
  for (const row of (deliverables || []) as JsonMap[]) {
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

async function graphicDescriptions(
  supabase: SupabaseClient,
  client: ClientRow,
  batchInput: JsonMap,
  items: JsonMap[],
  existingById: Map<string, JsonMap>,
  deliverableIds: string[],
  skipGeneration: boolean,
): Promise<Map<number, string>> {
  const needed = items.map((item, index) => ({ item, index }))
    .filter(({ item }) => normalizeTeam(item.team) === "graphics")
    .filter(({ index }) => !clean(existingById.get(deliverableIds[index])?.brief));
  const fallback = new Map<number, string>();
  for (const { item, index } of needed) {
    const number = Number(item.videoNumber || item.number || index + 1);
    fallback.set(index, `Video ${Number.isInteger(number) && number > 0 ? number : index + 1}`);
  }
  if (!needed.length) return fallback;
  if (skipGeneration) return fallback;

  const apiKey = clean(Deno.env.get("GRAPHIC_TITLE_API_KEY"));
  const model = clean(Deno.env.get("GRAPHIC_TITLE_MODEL"));
  const prompt = clean(Deno.env.get("GRAPHIC_TITLE_PROMPT"));
  if (!apiKey || !model || !prompt) {
    throw new GatewayError(503, "graphic_generation_unavailable");
  }

  let filmingPlan = "";
  const { data: plan } = await supabase.from("filming_plans")
    .select("doc_id")
    .eq("client_slug", client.slug)
    .maybeSingle();
  const docId = clean(plan && plan.doc_id);
  if (docId) {
    try {
      const response = await fetch(`https://docs.google.com/document/d/${encodeURIComponent(docId)}/export?format=txt`);
      if (response.ok) filmingPlan = (await response.text()).slice(0, 20_000);
    } catch (_error) {
      filmingPlan = "";
    }
  }

  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2_000,
        system: prompt,
        messages: [{
          role: "user",
          content: JSON.stringify({
            client: client.display_name,
            submissionTitle: clean(batchInput.name),
            notes: clean(batchInput.notes),
            filmingPlan,
            videos: needed.map(({ item, index }) => ({
              videoNumber: Number(item.videoNumber || item.number || index + 1),
              dueDate: clean(item.due_date) || null,
            })),
          }),
        }],
      }),
    });
  } catch (_error) {
    throw new GatewayError(502, "graphic_generation_failed");
  }

  const providerBody = await response.json().catch(() => null) as JsonMap | null;
  if (!response.ok || !providerBody || !Array.isArray(providerBody.content)) {
    throw new GatewayError(502, "graphic_generation_failed");
  }
  const text = providerBody.content.map(part => parseJson(part))
    .filter(part => lower(part.type) === "text")
    .map(part => String(part.text || ""))
    .join("\n")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (_error) {
    const arrayStart = text.indexOf("[");
    const arrayEnd = text.lastIndexOf("]");
    if (arrayStart < 0 || arrayEnd <= arrayStart) {
      throw new GatewayError(502, "graphic_generation_failed");
    }
    try {
      parsed = JSON.parse(text.slice(arrayStart, arrayEnd + 1));
    } catch (_nestedError) {
      throw new GatewayError(502, "graphic_generation_failed");
    }
  }
  if (!Array.isArray(parsed)) throw new GatewayError(502, "graphic_generation_failed");

  const firstByNumber = new Map<number, string>();
  const requestedNumbers = new Set(needed.map(({ item, index }) =>
    Number(item.videoNumber ?? item.number ?? index + 1)
  ));
  for (const raw of parsed) {
    const row = parseJson(raw);
    const number = row.videoNumber;
    const title = typeof row.title === "string" ? clean(row.title) : "";
    if (typeof number !== "number"
        || !Number.isInteger(number)
        || !requestedNumbers.has(number)
        || !title
        || title.length > 500) continue;
    // Match the legacy generator deterministically: the first valid title for
    // a requested video number wins; missing or invalid rows fall back alone.
    if (!firstByNumber.has(number)) firstByNumber.set(number, title);
  }
  for (const { item, index } of needed) {
    const number = Number(item.videoNumber ?? item.number ?? index + 1);
    if (firstByNumber.has(number)) fallback.set(index, firstByNumber.get(number)!);
  }
  return fallback;
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
  const attribution: JsonMap = {
    schema: "syncview_attribution_v1",
    state: "resolved",
    client_slug: scope.clientSlug,
    owner_kind: lower(scope.client.kind || "client"),
    source: "direct_project",
    project_id: scope.projectId,
    direct_project_id: scope.projectId,
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

async function assertGraphicsApprovalArtifact(
  supabase: SupabaseClient,
  deliverable: JsonMap,
): Promise<void> {
  if (normalizeTeam(deliverable.team) !== "graphics") return;
  if (!canonicalArtifactUrl(deliverable.file_url)) {
    throw new GatewayError(409, "artifact_not_resolvable", {
      asset_state: clean(deliverable.file_url) ? "invalid" : "missing",
      checked_at: new Date().toISOString(),
      guidance: assetGuidance(clean(deliverable.file_url) ? "invalid" : "missing"),
    });
  }
  const evidence = await probeAssetUrl("deliverable_file", deliverable.file_url);
  await recordAssetEvidence(
    supabase,
    clean(deliverable.id),
    "deliverable_file",
    deliverable.file_url,
    evidence,
  );
  if (clean(evidence.state) !== "available") {
    throw new GatewayError(409, "artifact_not_resolvable", {
      asset_state: clean(evidence.state) || "unavailable",
      checked_at: clean(evidence.checked_at) || new Date().toISOString(),
      guidance: clean(evidence.guidance) || assetGuidance("unavailable"),
    });
  }
  await requireFreshAssetEvidence(
    supabase,
    clean(deliverable.id),
    "deliverable_file",
    deliverable.file_url,
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
  if (principal.kind === "staff"
      && !staffOperationAllowed(principal.keyRole, operation, principal.memberTeam, team, nextStatus)) {
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
      // crosswalk the reader authorizes, not merely the client slug.
      if (principal.kind === "client"
          && !clientCommentTargetAllowed(surface, existing, commentInput.component)) {
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
          // card/component/deliverable crosswalk as the reader and the add path.
          || (principal.kind === "client"
            && !clientCommentTargetAllowed(surface, existing, lifecycleRow.component))
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
      if (Number(lifecycleRow.version) !== expectedCommentVersion
          || clean(lifecycleRow.updated_at) !== expectedCommentUpdatedAt) {
        throw new GatewayError(409, "write_conflict", {
          conflict: true,
          comment: publicComment(lifecycleRow, principal),
        });
      }
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
      if (action === "edit") comment.body = commentBody;
      if (action === "delete") {
        comment.deleted_by_key = principal.actorKey;
        comment.deleted_by_name = principal.actorName;
      }
      if (action === "resolve") {
        comment.resolved_by_key = principal.actorKey;
        comment.resolved_by_name = principal.actorName;
      }
      result = await rpc(supabase, "production_comment_lifecycle_write", {
        p_comment: comment,
        p_event: event,
        p_expected_version: expectedCommentVersion,
        p_expected_updated_at: expectedCommentUpdatedAt,
      });
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

async function ensureDeliverable(
  supabase: SupabaseClient,
  row: JsonMap,
  event: JsonMap,
  dedup: string,
  replay: boolean,
): Promise<JsonMap> {
  const { data, error } = await supabase.from("deliverables").select("*").eq("id", clean(row.id)).maybeSingle();
  if (error) throw new GatewayError(503, "deliverable_lookup_unavailable");
  if (data && (
    clean(data.client_slug) !== clean(row.client_slug)
    || normalizeTeam(data.team) !== normalizeTeam(row.team)
    || clean(data.batch_id) !== clean(row.batch_id)
    || clean(data.title) !== clean(row.title)
    || clean(data.origin) !== clean(row.origin)
    || clean(data.card_id) !== clean(row.card_id)
  )) throw new GatewayError(409, "intake_id_conflict");
  if (replay && !data) throw new GatewayError(500, "idempotent_result_missing");
  return parseJson(replay ? data : await rpc(supabase, "production_deliverable_write", { p_row: data || row, p_event: event }));
}

async function handleIntakeCreate(
  supabase: SupabaseClient,
  req: Request,
  body: JsonMap,
  surface: string,
  requestId: string,
  sourceEditedAt: string,
): Promise<Response> {
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
    const status = lower(item.status || "in_progress");
    const videoTitle = normalizeTeam(item.team) === "video" ? clean(item.title) : "";
    if (!Number.isInteger(videoNumber) || videoNumber < 1) {
      throw new GatewayError(400, "invalid_intake_video_number", { item_index: index });
    }
    if (clean(item.assignee_id)) {
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
  const principal = await authenticate(supabase, req, body, clientSlug);
  if (principal.kind === "client" || (principal.kind === "staff" && !["admin", "smm"].includes(principal.keyRole))) {
    throw new GatewayError(403, "operation_forbidden");
  }
  const client = principal.client || await clientBySlug(supabase, clientSlug);
  if (!client || client.active !== true) throw new GatewayError(403, "client_inactive");
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
    const batchTeam = normalizeTeam(appendBatch.team);
    if (batchTeam && teamList.some(team => team !== batchTeam)) {
      throw new GatewayError(409, "batch_team_mismatch");
    }
    if (!Number.isFinite(Date.parse(clean(body.expected_batch_updated_at)))) {
      throw new GatewayError(400, "invalid_expected_batch_updated_at");
    }
  }

  const batchId = appendToBatch
    ? requestedBatchId
    : await deterministicNativeId("bat", requestId, "submission");
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
      items = planAppendIntakeItems(appendBatchRows, items, deliverableIds).map(parseJson);
    } catch (error) {
      const code = error instanceof Error ? error.message : "invalid_intake_append_plan";
      throw new GatewayError(code === "intake_id_conflict" ? 409 : 400, code);
    }
  }
  const skipGraphicGeneration = body.skip_graphic_generation === true;
  if (skipGraphicGeneration && principal.kind !== "test") {
    throw new GatewayError(403, "skip_graphic_generation_forbidden");
  }
  for (let index = 0; index < items.length; index++) {
    if (normalizeTeam(items[index].team) === "graphics"
        && clean(items[index].brief)
        && !existingById.has(deliverableIds[index])) {
      throw new GatewayError(400, "graphics_brief_server_owned", { item_index: index });
    }
  }
  const graphicBatchContext = appendToBatch && appendBatch
    ? { name: appendBatch.name, notes: appendBatch.description }
    : { ...batchInput, notes: clean(batchInput.notes || body.notes) };
  const generatedDescriptions = await graphicDescriptions(
    supabase, client, graphicBatchContext,
    items, existingById, deliverableIds, skipGraphicGeneration,
  );
  const assigneeByTeam: Record<string, string> = {};
  for (const team of teamList) {
    const teamExistingIds = [...existingById.values()]
      .filter(row => normalizeTeam(row.team) === team)
      .map(row => clean(row.assignee_id))
      .filter(Boolean);
    const retryAssignees = new Set(teamExistingIds);
    if (retryAssignees.size > 1) throw new GatewayError(409, "intake_id_conflict");
    assigneeByTeam[team] = retryAssignees.size === 1
      ? [...retryAssignees][0]
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
    const fallbackTitle = `Video ${videoNumber}`;
    const title = team === "graphics" ? fallbackTitle : clean(item.title) || fallbackTitle;
    const sourceBrief = team === "graphics" ? "" : clean(item.brief);
    const existingBrief = clean(existingById.get(deliverableIds[index])?.brief);
    const brief = team === "graphics"
      ? existingBrief || clean(generatedDescriptions.get(index)) || fallbackTitle
      : existingBrief || sourceBrief;
    const priority = item.priority == null || item.priority === "" ? null : Number(item.priority);
    const sortKey = item.sort_key == null ? index : Number(item.sort_key);
    const status = lower(item.status || "in_progress");
    if (clean(item.assignee_id)) {
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
      origin: "calendar",
      card_id: clean(item.card_id) || null,
      sort_key: sortKey,
      ...(appendToBatch ? { _intake_ordinal: Number(item._intake_ordinal) } : {}),
      created_by: principal.actorKey,
      created_at: sourceEditedAt,
    };
    const existing = existingById.get(deliverableIds[index]);
    if (existing && (
      clean(existing.client_slug) !== clientSlug
      || normalizeTeam(existing.team) !== team
      || clean(existing.batch_id) !== batchId
      || clean(existing.title) !== title
      || clean(existing.status) !== status
      || clean(existing.assignee_id) !== assigneeId
      || clean(existing.due_date) !== clean(row.due_date)
      || clean(existing.origin) !== clean(row.origin)
      || clean(existing.card_id) !== clean(row.card_id)
      || Number(existing.sort_key) !== Number(row.sort_key)
      || Number(existing.priority == null ? 0 : existing.priority) !== Number(priority == null ? 0 : priority)
    )) throw new GatewayError(409, "intake_id_conflict", { item_index: index });
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
    const parentRouteByTeam: Record<string, JsonMap> = {};
    for (const team of teamList) {
      parentRouteByTeam[team] = await parentRouteForAppend(
        supabase,
        appendBatch,
        clientSlug,
        team,
        projectByTeam[team],
        principal,
        parityByTeam[team],
        !exactRowRetry,
      );
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
    }, targetedFailure ? 202 : (exactReplay ? 200 : 201));
  }

  const batchRow: JsonMap = {
    id: batchId,
    client_slug: clientSlug,
    team: teamList.length === 1 ? teamList[0] : null,
    name: clean(batchInput.name).slice(0, 500),
    description: clean(batchInput.description) || null,
    filming_doc_url: clean(batchInput.filming_doc_url) || null,
    footage_folder_url: clean(batchInput.footage_folder_url) || null,
    delivery_folder_url: clean(batchInput.delivery_folder_url) || null,
    color: clean(batchInput.color) || null,
    status: "active",
    created_by: principal.actorKey,
    created_at: sourceEditedAt,
  };
  const parentPlans: JsonMap[] = [];
  for (const team of teamList) {
    const parentDedup = dedupKey("create", "batch", batchId, `${requestId}:${team}`);
    const parentFingerprint = await intentFingerprint({
      operation: "intake_create", requestId, surface, team,
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
      items: plannedItems.filter(item => normalizeTeam((item.row as JsonMap).team) === team).map(item => {
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
        description: clean(batchInput.description) || undefined,
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
  const parentOutboxByTeam: Record<string, number> = {
    [clean(firstParent.team)]: batch.outboxId,
  };
  for (let index = 1; index < parentPlans.length; index++) {
    const parent = parentPlans[index];
    if (parent.replay !== true) {
      await rpc(supabase, "production_batch_intent_write", {
        p_batch_id: batchId,
        p_event: parent.event,
      });
    }
    parentOutboxByTeam[clean(parent.team)] = await findOutboxId(supabase, clean(parent.dedup));
  }
  const responseItems: JsonMap[] = [];
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
      supabase, row, childEvent, childDedup, planned.child_replay === true,
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
    batch: publicRow(currentBatchResult.data),
    items: currentResponseItems,
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
