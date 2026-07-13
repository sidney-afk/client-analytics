// Pure policy helpers for the browser-callable Production write gateway.
// Keep authorization decisions here deterministic so Node tests can exercise
// them without an Edge runtime or live credentials.

export const OPERATIONS = Object.freeze([
  "status",
  "comment",
  "due",
  "assignee",
  "intake_create",
]);

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
  if (op === "status") return CREATIVE_STATUSES.has(lower(nextStatus));
  return false;
}

export function clientOperationAllowed(operation, currentStatus, nextStatus) {
  const op = normalizeOperation(operation);
  if (op === "comment") return true;
  if (op !== "status" || !CLIENT_STATUSES.has(lower(nextStatus))) return false;
  return ["client_approval", "tweak"].includes(lower(currentStatus));
}

export function legacyParityAllowed(surface, operation) {
  const lane = lower(surface);
  const op = normalizeOperation(operation);
  if ((lane === "calendar" || lane === "sxr") && (op === "status" || op === "comment")) {
    return true;
  }
  return lane === "submission" && op === "intake_create";
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

function idFrom(value) {
  if (typeof value === "string") return clean(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  for (const key of ["id", "project_id", "linear_project_id"]) {
    const id = clean(value[key]);
    if (id) return id;
  }
  return "";
}

// Only explicitly team-tagged values are accepted. An arbitrary untagged list
// is ambiguous during a graphics/video split and therefore fails closed.
export function projectIdsForTeam(value, wantedTeam) {
  const wanted = normalizeTeam(wantedTeam);
  if (!wanted) return [];
  const found = new Set();
  const seen = new Set();

  function visit(current, inheritedTeam = "") {
    if (current == null) return;
    if (typeof current === "string") {
      if (inheritedTeam === wanted && clean(current)) found.add(clean(current));
      return;
    }
    if (typeof current !== "object" || seen.has(current)) return;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const item of current) visit(item, inheritedTeam);
      return;
    }

    const explicitTeam = normalizeTeam(
      current.team || current.team_key || current.key || current.kind || inheritedTeam,
    );
    const ownId = idFrom(current);
    if (explicitTeam === wanted && ownId) found.add(ownId);

    for (const [key, child] of Object.entries(current)) {
      if (["id", "project_id", "linear_project_id", "team", "team_key", "kind"].includes(key)) continue;
      const keyedTeam = normalizeTeam(key);
      visit(child, keyedTeam || explicitTeam || inheritedTeam);
    }
  }

  visit(value);
  return [...found].sort();
}

// Legacy client rows currently contain plain project ids without a team tag.
// The gateway may inspect those ids, but it must validate their actual Linear
// team server-side before selecting one for an intake write.
export function configuredProjectIds(value) {
  const found = new Set();
  const seen = new Set();
  function visit(current) {
    if (current == null) return;
    if (typeof current === "string") {
      if (clean(current)) found.add(clean(current));
      return;
    }
    if (typeof current !== "object" || seen.has(current)) return;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    const ownId = idFrom(current);
    if (ownId) found.add(ownId);
    for (const [key, child] of Object.entries(current)) {
      if (["id", "project_id", "linear_project_id", "team", "team_key", "key", "kind"].includes(key)) continue;
      visit(child);
    }
  }
  visit(value);
  return [...found].sort();
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
