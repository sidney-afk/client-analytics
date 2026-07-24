// Pure policy helpers for the browser-callable Production write gateway.
// Keep authorization decisions here deterministic so Node tests can exercise
// them without an Edge runtime or live credentials.

export const OPERATIONS = Object.freeze([
  "create",
  "status",
  "comment",
  "due",
  "assignee",
  "labels",
  "description",
  "attachment",
  "intake_create",
]);

export const MAX_DESCRIPTION_LENGTH = 100_000;
export const MAX_ARTIFACT_URL_LENGTH = 2_048;

export const DELIVERABLE_STATUSES = Object.freeze([
  "triage",
  "backlog",
  "todo",
  "in_progress",
  "smm_approval",
  "kasper_approval",
  "client_approval",
  "tweak",
  "approved",
  "scheduled",
  "posted",
  "canceled",
  "duplicate",
]);

const CLIENT_STATUSES = new Set(["approved", "tweak"]);
const CREATIVE_STATUSES = new Set([
  "triage",
  "backlog",
  "todo",
  "in_progress",
  "smm_approval",
  "tweak",
  "canceled",
  "duplicate",
]);
const TEAM_KEYS = Object.freeze({
  video: "video",
  vid: "video",
  graphics: "graphics",
  graphic: "graphics",
  gra: "graphics",
  thumbnail: "graphics",
});

export function clean(value) {
  return String(value == null ? "" : value).trim();
}

export function lower(value) {
  return clean(value).toLowerCase();
}

export function normalizeActor(value) {
  let text = lower(value);
  try {
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (_error) {
    // Exact ASCII matching still works if Unicode normalization is absent.
  }
  return text.replace(/[^a-z0-9@.]+/g, "");
}

export function normalizeTeam(value) {
  return TEAM_KEYS[lower(value)] || "";
}

export function normalizeOperation(value) {
  const operation = lower(value);
  return OPERATIONS.includes(operation) ? operation : "";
}

export function credentialMode(staffKey, clientToken) {
  const hasStaffKey = !!clean(staffKey);
  const hasClientToken = !!clean(clientToken);
  if (hasStaffKey && hasClientToken) return "ambiguous";
  if (hasStaffKey) return "staff";
  if (hasClientToken) return "client";
  return "none";
}

export function clientScopeAllowed(authenticatedSlug, targetSlug) {
  const authenticated = clean(authenticatedSlug);
  return !!authenticated && authenticated === clean(targetSlug);
}

export function isCanonicalActiveTestClient(active, kind) {
  return active === true && lower(kind) === "test";
}

export function serviceTestOverrideAllowed(staffKey, clientToken, confirm, serviceAuthenticated) {
  return credentialMode(staffKey, clientToken) === "none"
    && clean(confirm) === "B4_TEST_ONLY"
    && serviceAuthenticated === true;
}

export function roleCompatible(keyRole, memberRole) {
  const key = lower(keyRole);
  const member = lower(memberRole);
  if (key === "admin") return member === "admin";
  if (key === "smm") return member === "smm";
  if (key === "creative") return member === "editor" || member === "designer";
  return false;
}

export function staffOperationAllowed(keyRole, operation, memberTeam, targetTeam, nextStatus = "") {
  const key = lower(keyRole);
  const op = normalizeOperation(operation);
  if (!op) return false;
  if (key === "admin" || key === "smm") return true;
  if (key !== "creative" || normalizeTeam(memberTeam) !== normalizeTeam(targetTeam)) return false;
  if (op === "comment") return true;
  if (op === "attachment") return normalizeTeam(targetTeam) === "graphics";
  if (op === "status") return CREATIVE_STATUSES.has(lower(nextStatus));
  return false;
}

export function staffAssetReadAllowed(keyRole, memberTeam, targetTeam) {
  const key = lower(keyRole);
  if (key === "admin" || key === "smm") return true;
  return key === "creative"
    && !!normalizeTeam(memberTeam)
    && normalizeTeam(memberTeam) === normalizeTeam(targetTeam);
}

export function clientOperationAllowed(operation, currentStatus, nextStatus) {
  const op = normalizeOperation(operation);
  if (op === "comment") return true;
  if (op !== "status" || !CLIENT_STATUSES.has(lower(nextStatus))) return false;
  return ["client_approval", "tweak"].includes(lower(currentStatus));
}

export function normalizeCommentAction(value) {
  const action = lower(value || "add");
  return ["add", "edit", "delete", "resolve", "unresolve"].includes(action) ? action : "";
}

// A client comment mutation must be bound to the exact SXR Samples-card context
// the protected reader authorizes (production-comments clientSurfaceTargetAllowed):
// the request surface is `sxr`, the target deliverable is Samples-origin with a
// real card id, and the comment's component maps to the deliverable's team. This
// stops a valid client token from mutating a Calendar/manual deliverable or a
// wrong-component target that merely shares the same client slug. Client threads
// are only the graphic/video review surfaces, matching the reader exactly.
export function clientCommentTargetAllowed(surface, existing, component) {
  const row = existing && typeof existing === "object" ? existing : {};
  const comp = lower(component);
  const expectedTeam = comp === "graphic"
    ? "graphics"
    : comp === "video"
      ? "video"
      : "";
  return lower(surface) === "sxr"
    && lower(row.origin) === "samples"
    && !!clean(row.card_id)
    && !!expectedTeam
    && normalizeTeam(row.team) === expectedTeam;
}

// Comment lifecycle authority is narrower than the top-level `comment`
// operation. Admin/SMM may moderate any authorized thread, creatives may edit
// or delete only their own same-team comments, and a client may edit/delete
// only its own client-visible comment. Resolving/reopening remains staff
// moderation and is never available to a client principal.
export function commentLifecycleAllowed(principal, actionValue, row) {
  const action = normalizeCommentAction(actionValue);
  if (!action || action === "add") return action === "add";
  const actor = principal && typeof principal === "object" ? principal : {};
  const comment = row && typeof row === "object" ? row : {};
  const kind = lower(actor.kind);
  const keyRole = lower(actor.keyRole);
  if (kind === "staff" || kind === "test") {
    if (keyRole === "admin" || keyRole === "smm" || keyRole === "test") return true;
    if (action === "resolve" || action === "unresolve") return false;
    return keyRole === "creative"
      && !!clean(actor.memberId)
      && clean(actor.memberId) === clean(comment.author_member_id);
  }
  if (kind !== "client" || (action !== "edit" && action !== "delete")) return false;
  return lower(comment.audience) === "client"
    && !!clean(actor.actorKey)
    && clean(actor.actorKey) === clean(comment.author_key);
}

export function commentLifecycleCapabilities(principal, row) {
  const comment = row && typeof row === "object" ? row : {};
  return {
    can_edit: commentLifecycleAllowed(principal, "edit", comment),
    can_delete: commentLifecycleAllowed(principal, "delete", comment),
    can_resolve: !clean(comment.parent_id)
      && commentLifecycleAllowed(principal, "resolve", comment),
  };
}

export function legacyParityAllowed(surface, operation) {
  const lane = lower(surface);
  const op = normalizeOperation(operation);
  if ((lane === "calendar" || lane === "sxr") && (op === "status" || op === "comment")) {
    return true;
  }
  return (lane === "submission" || lane === "calendar") && op === "intake_create";
}

// A browser credential and the service-only TEST drill are mutually exclusive
// principal modes. The gateway calls this before authenticating either browser
// principal so a caller cannot turn a staff key or client token into testOnly.
export function browserCredentialTestOverride(testOverride, staffKey, clientToken) {
  return testOverride === true && (!!clean(staffKey) || !!clean(clientToken));
}

export function validRequestId(value) {
  const id = clean(value);
  return /^[a-zA-Z0-9][a-zA-Z0-9:_-]{7,199}$/.test(id) ? id : "";
}

export function sourceTimestamp(value, now = Date.now()) {
  if (!clean(value)) return new Date(now).toISOString();
  const parsed = Date.parse(clean(value));
  if (!Number.isFinite(parsed) || parsed > now + 5 * 60 * 1000) {
    throw new Error("invalid_source_edited_at");
  }
  return new Date(parsed).toISOString();
}

export function validDateOrNull(value) {
  if (value == null || value === "") return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(value));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

const SAFE_LINEAR_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;

// Label changes replace Linear's complete selected-ID set atomically. Reject
// partial/malformed inputs and sort the de-duplicated IDs so the same intent
// has one stable fingerprint, outbox payload, and conflict value.
export function canonicalLabelIds(value) {
  if (!Array.isArray(value) || value.length > 250) return null;
  const ids = [];
  for (const raw of value) {
    if (typeof raw !== "string") return null;
    const id = clean(raw);
    if (!SAFE_LINEAR_ID.test(id)) return null;
    ids.push(id);
  }
  return [...new Set(ids)].sort();
}

// A Production description is Markdown source, not normalized prose. Preserve
// every code unit (including leading/trailing whitespace and line endings);
// only its type, bounded size, and PostgreSQL text compatibility are part of
// the gateway contract. The empty string is a valid clear intent.
export function canonicalDescription(value) {
  return typeof value === "string"
      && value.length <= MAX_DESCRIPTION_LENGTH
      && !value.includes("\0")
    ? value
    : null;
}

const ASSET_HOSTS = Object.freeze([
  "drive.google.com",
  "docs.google.com",
  "frame.io",
  "app.frame.io",
  "f.io",
  "dropbox.com",
  "www.dropbox.com",
  "uploads.linear.app",
]);
const SAFE_ASSET_QUERY_KEYS = new Set([
  "usp", "dl", "raw", "download", "id", "tab", "rlkey", "resourcekey",
]);
const CREDENTIAL_QUERY_KEY = /(?:^|[-_])(?:token|auth|key|secret|signature|sig|expires?|credential|policy)(?:$|[-_])/i;

function assetHostAllowed(hostname) {
  const host = lower(hostname).replace(/\.$/, "");
  return ASSET_HOSTS.includes(host);
}

function providerQuerySafe(url, host) {
  if (host === "uploads.linear.app") return true;
  for (const key of url.searchParams.keys()) {
    if (CREDENTIAL_QUERY_KEY.test(key) || !SAFE_ASSET_QUERY_KEYS.has(lower(key))) return false;
  }
  return true;
}

export function assetUrlType(value) {
  const raw = clean(value);
  if (!raw || raw.length > MAX_ARTIFACT_URL_LENGTH || raw.includes("\0")) return "invalid";
  let url;
  try {
    url = new URL(raw);
  } catch (_error) {
    return "invalid";
  }
  const host = lower(url.hostname).replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password
      || !assetHostAllowed(host) || !clean(url.pathname) || url.pathname === "/"
      || !providerQuerySafe(url, host)) {
    return "invalid";
  }
  if (host === "uploads.linear.app") return "linear_upload";
  if (host === "docs.google.com") return "document";
  if (host === "drive.google.com") {
    if (/\/folders\//i.test(url.pathname)) return "folder";
    if (/\/file\/d\//i.test(url.pathname) || /[?&]id=[A-Za-z0-9_-]+/i.test(url.search)) return "file";
    return "invalid";
  }
  if (host === "frame.io" || host === "app.frame.io" || host === "f.io") return "folder";
  if (host === "dropbox.com" || host === "www.dropbox.com") {
    return /\/scl\/fo\/|\/sh\//i.test(url.pathname) ? "folder" : "file";
  }
  return "invalid";
}

export function assetTypeAllowed(slot, value) {
  const kind = assetUrlType(value);
  const key = lower(slot);
  if (key === "filming_plan") return kind === "document" || kind === "file";
  if (key === "raw_footage" || key === "delivery_folder") return kind === "folder";
  // The canonical Graphics artifact must be a concrete deliverable file.
  // Source documents, raw-footage folders, delivery folders and Frame folders
  // remain independently visible, but can never be promoted into file_url.
  if (key === "deliverable_file") return kind === "file";
  return false;
}

export function canonicalArtifactUrl(value) {
  const raw = clean(value);
  if (!assetTypeAllowed("deliverable_file", raw)) return null;
  const url = new URL(raw);
  const host = lower(url.hostname).replace(/\.$/, "");
  const stableShare = new URLSearchParams();
  if ((host === "drive.google.com" || host === "docs.google.com")
      && url.searchParams.get("resourcekey")) {
    stableShare.set("resourcekey", url.searchParams.get("resourcekey"));
  }
  if ((host === "dropbox.com" || host === "www.dropbox.com")
      && url.searchParams.get("rlkey")) {
    stableShare.set("rlkey", url.searchParams.get("rlkey"));
  }
  if (host === "drive.google.com") {
    const pathId = url.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)/i)?.[1];
    const folderId = url.pathname.match(/\/folders\/([A-Za-z0-9_-]+)/i)?.[1];
    const queryId = url.searchParams.get("id");
    if (pathId || queryId) url.pathname = `/file/d/${pathId || queryId}/view`;
    else if (folderId) url.pathname = `/drive/folders/${folderId}`;
  }
  // Stable provider share identity lives in the approved path. Benign display
  // switches are discarded. Dropbox rlkey and Drive resourcekey are stable
  // provider share identifiers, not expiring bearer/signature parameters.
  url.search = stableShare.toString();
  url.hash = "";
  return url.toString();
}

export function signedAssetExpired(value, now = Date.now()) {
  let url;
  try {
    url = new URL(clean(value));
  } catch (_error) {
    return false;
  }
  const direct = ["Expires", "expires", "X-Goog-Expires", "x-goog-expires"]
    .map(key => url.searchParams.get(key))
    .find(Boolean);
  const signedAt = url.searchParams.get("X-Goog-Date") || url.searchParams.get("x-goog-date");
  if (signedAt && direct && /^\d{8}T\d{6}Z$/.test(signedAt) && /^\d+$/.test(direct)) {
    const year = Number(signedAt.slice(0, 4));
    const month = Number(signedAt.slice(4, 6));
    const day = Number(signedAt.slice(6, 8));
    const hour = Number(signedAt.slice(9, 11));
    const minute = Number(signedAt.slice(11, 13));
    const second = Number(signedAt.slice(13, 15));
    const start = Date.UTC(year, month - 1, day, hour, minute, second);
    return Number.isFinite(start) && start + Number(direct) * 1_000 <= now;
  }
  if (direct && /^\d{9,13}$/.test(direct)) {
    const expiry = Number(direct);
    return (direct.length <= 10 ? expiry * 1_000 : expiry) <= now;
  }
  return false;
}

// Match the legacy linear-set-status bridge exactly: an overdue YYYY-MM-DD
// due date is moved to the current UTC date plus two days. It is deliberately
// not incremented from the stale due date.
export function overdueStatusBumpDate(value, now = Date.now()) {
  if (!validDateOrNull(value) || !clean(value)) return "";
  const [year, month, day] = clean(value).split("-").map(Number);
  const dueMs = Date.UTC(year, month - 1, day);
  const current = new Date(now);
  const todayMs = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate());
  if (dueMs >= todayMs) return "";
  return new Date(todayMs + 2 * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

// D-30 preserves the legacy side effect by default. The runtime flag is a
// kill switch, so only the exact operator value { enabled: false } disables
// it; missing, malformed, or unreadable values must not freeze status writes.
export function overdueStatusBumpEnabled(value) {
  return !(value
    && typeof value === "object"
    && !Array.isArray(value)
    && value.enabled === false);
}

function idsFrom(value) {
  if (typeof value === "string") return clean(value) ? [clean(value)] : [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return [...new Set(["id", "project_id", "linear_project_id"]
    .map(key => clean(value[key])).filter(Boolean))];
}

// Only explicitly team-tagged values are accepted. An arbitrary untagged list
// is ambiguous during a graphics/video split and therefore fails closed.
export function projectIdsForTeam(value, wantedTeam) {
  const wanted = normalizeTeam(wantedTeam);
  if (!wanted) return [];
  const found = new Set();
  const root = value && typeof value === "object" ? value : null;
  if (!root) return [];

  function addExplicit(entry) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const team = normalizeTeam(entry.team || entry.team_key || entry.key || entry.kind);
    if (team === wanted) idsFrom(entry).forEach(id => found.add(id));
  }

  if (Array.isArray(root)) {
    root.forEach(addExplicit);
  } else {
    // Canonical mapping: { video: "id", graphics: { id: "id" } }.
    // Only the direct team value or its recognized ID fields count; arbitrary
    // nested metadata under a team key is deliberately ignored.
    for (const [key, entry] of Object.entries(root)) {
      if (normalizeTeam(key) !== wanted) continue;
      idsFrom(entry).forEach(id => found.add(id));
    }
    addExplicit(root);
    // Optional explicit list wrapper; entries must carry their own team tag.
    if (Array.isArray(root.projects)) root.projects.forEach(addExplicit);
  }
  return [...found].sort();
}

function linearIssueIdsFrom(value) {
  if (typeof value === "string") return clean(value) ? [clean(value)] : [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return [...new Set(["id", "uuid", "linear_issue_id"]
    .map(key => clean(value[key])).filter(Boolean))];
}

// Batch parent routing is deliberately stricter than the outbound drainer's
// historical compatibility fallback. Appends may use only an explicitly
// team-tagged parent; they never borrow the first parent from the other team.
export function parentIdsForTeam(value, wantedTeam) {
  const wanted = normalizeTeam(wantedTeam);
  if (!wanted) return [];
  const found = new Set();
  const root = value && typeof value === "object" ? value : null;
  if (!root) return [];

  function addExplicit(entry) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const team = normalizeTeam(entry.team || entry.team_key || entry.key || entry.kind);
    if (team === wanted) linearIssueIdsFrom(entry).forEach(id => found.add(id));
  }

  if (Array.isArray(root)) {
    root.forEach(addExplicit);
  } else {
    for (const [key, entry] of Object.entries(root)) {
      if (normalizeTeam(key) !== wanted) continue;
      linearIssueIdsFrom(entry).forEach(id => found.add(id));
    }
    addExplicit(root);
    if (Array.isArray(root.parents)) root.parents.forEach(addExplicit);
  }
  return [...found].sort();
}

// The browser may describe the post, but it does not own batch ordering. The
// gateway allocates one shared ordinal/sort slot per paired card and the SQL
// append RPC re-checks this plan while holding the batch lock.
export function planAppendIntakeItems(existingRows, requestItems, requestIds) {
  if (!Array.isArray(existingRows) || !Array.isArray(requestItems)
      || !Array.isArray(requestIds) || requestItems.length !== requestIds.length
      || requestItems.length < 1) {
    throw new Error("invalid_intake_append_plan");
  }

  const requestIdSet = new Set(requestIds.map(clean));
  if (requestIdSet.size !== requestIds.length || requestIdSet.has("")) {
    throw new Error("invalid_intake_append_plan");
  }
  const existingById = new Map(existingRows.map(row => [clean(row && row.id), row]));
  const groups = new Map();
  requestItems.forEach((item, index) => {
    const cardId = clean(item && item.card_id);
    const team = normalizeTeam(item && item.team);
    if (!cardId || !team) throw new Error("invalid_intake_append_pair");
    if (!groups.has(cardId)) groups.set(cardId, []);
    groups.get(cardId).push({ index, team });
  });
  for (const entries of groups.values()) {
    const teams = new Set(entries.map(entry => entry.team));
    if (entries.length !== 2 || teams.size !== 2 || !teams.has("video") || !teams.has("graphics")) {
      throw new Error("invalid_intake_append_pair");
    }
  }

  let maxSort = -1;
  let maxOrdinal = 0;
  for (const row of existingRows) {
    if (!row || requestIdSet.has(clean(row.id))) continue;
    const sort = Number(row.sort_key);
    if (Number.isFinite(sort)) maxSort = Math.max(maxSort, sort);
    const match = /^Video ([1-9][0-9]*)$/.exec(clean(row.title));
    if (match) maxOrdinal = Math.max(maxOrdinal, Number(match[1]));
  }

  const planned = requestItems.map(item => ({ ...item }));
  let nextGroup = 0;
  for (const [cardId, entries] of groups.entries()) {
    nextGroup++;
    const prior = entries.map(entry => existingById.get(clean(requestIds[entry.index]))).filter(Boolean);
    let ordinal;
    let sortKey;
    if (prior.length) {
      if (prior.length !== entries.length) throw new Error("intake_id_conflict");
      const ordinals = new Set(prior.map(row => {
        const match = /^Video ([1-9][0-9]*)$/.exec(clean(row.title));
        return match ? Number(match[1]) : 0;
      }));
      const sorts = new Set(prior.map(row => Number(row.sort_key)));
      const teams = new Set(prior.map(row => normalizeTeam(row.team)));
      if (ordinals.size !== 1 || ordinals.has(0) || sorts.size !== 1
          || !Number.isFinite([...sorts][0]) || teams.size !== 2
          || prior.some(row => clean(row.card_id) !== cardId)) {
        throw new Error("intake_id_conflict");
      }
      ordinal = [...ordinals][0];
      sortKey = [...sorts][0];
    } else {
      ordinal = maxOrdinal + nextGroup;
      sortKey = maxSort + nextGroup;
    }
    for (const entry of entries) {
      planned[entry.index] = {
        ...planned[entry.index],
        videoNumber: ordinal,
        number: ordinal,
        title: `Video ${ordinal}`,
        sort_key: sortKey,
        _intake_ordinal: ordinal,
      };
    }
  }
  return planned;
}

export async function deterministicNativeId(prefix, requestId, discriminator) {
  const key = `${clean(prefix)}:${clean(requestId)}:${clean(discriminator)}`;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return `${clean(prefix)}_${uuid}`;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value === undefined ? null : value;
  const result = {};
  for (const key of Object.keys(value).sort()) result[key] = stableValue(value[key]);
  return result;
}

export async function intentFingerprint(value) {
  const encoded = new TextEncoder().encode(JSON.stringify(stableValue(value)));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoded));
  return [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
