// Pure authorization and response-sanitization helpers for the protected
// Production comment reader. Keeping these decisions outside the Edge runtime
// lets the focused source test exercise the exact F39 contract.

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

export function normalizeTeam(value) {
  return TEAM_KEYS[lower(value)] || "";
}

export function credentialMode(staffKey, clientToken) {
  const staff = !!clean(staffKey);
  const client = !!clean(clientToken);
  if (staff && client) return "ambiguous";
  if (staff) return "staff";
  if (client) return "client";
  return "none";
}

export function roleCompatible(keyRole, memberRole) {
  const key = lower(keyRole);
  const member = lower(memberRole);
  if (key === "admin") return member === "admin";
  if (key === "smm") return member === "smm";
  return key === "creative" && (member === "editor" || member === "designer");
}

export function staffTargetAllowed(keyRole, memberTeam, targetTeam) {
  const role = lower(keyRole);
  if (role === "admin" || role === "smm") return true;
  return role === "creative"
    && !!normalizeTeam(memberTeam)
    && normalizeTeam(memberTeam) === normalizeTeam(targetTeam);
}

export function clientTargetAllowed(authenticatedSlug, targetSlug) {
  return !!clean(authenticatedSlug) && clean(authenticatedSlug) === clean(targetSlug);
}

export function clientSurfaceTargetAllowed(context, target) {
  const surface = context && typeof context === "object" ? context : {};
  const row = target && typeof target === "object" ? target : {};
  const sourceSurface = lower(surface.source_surface);
  const cardId = clean(surface.card_id);
  const component = lower(surface.component);
  const expectedTeam = component === "graphic"
    ? "graphics"
    : component === "video"
      ? "video"
      : "";
  return sourceSurface === "sxr"
    && !!cardId
    && !!expectedTeam
    && lower(row.origin) === "samples"
    && clean(row.card_id) === cardId
    && normalizeTeam(row.team) === expectedTeam;
}

export function audienceAllowed(principalKind, audience) {
  return lower(principalKind) !== "client" || lower(audience) === "client";
}

function safeHttpUrl(value) {
  const text = clean(value);
  if (!text || text.length > 2_048) return "";
  try {
    const parsed = new URL(text);
    return parsed.protocol === "https:" ? parsed.href : "";
  } catch (_error) {
    return "";
  }
}

export function safeAttachments(value) {
  if (!Array.isArray(value)) return [];
  const safe = [];
  for (const raw of value.slice(0, 20)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const url = safeHttpUrl(raw.url || raw.href || raw.file_url);
    if (!url) continue;
    const name = clean(raw.name || raw.title || raw.filename).slice(0, 240) || "Attachment";
    const mimeType = clean(raw.mime_type || raw.content_type).slice(0, 120);
    const rawSize = raw.size ?? raw.size_bytes;
    const size = rawSize == null ? Number.NaN : Number(rawSize);
    safe.push({
      url,
      name,
      ...(mimeType ? { mime_type: mimeType } : {}),
      ...(Number.isSafeInteger(size) && size >= 0 ? { size } : {}),
    });
  }
  return safe;
}

export function lifecycleCapabilities(principal, row) {
  const actor = principal && typeof principal === "object" ? principal : {};
  const comment = row && typeof row === "object" ? row : {};
  const kind = lower(actor.kind);
  const role = lower(actor.keyRole);
  const moderator = kind === "staff" && (role === "admin" || role === "smm");
  const ownCreative = kind === "staff" && role === "creative"
    && !!clean(actor.memberId)
    && clean(actor.memberId) === clean(comment.author_member_id);
  const ownClient = kind === "client"
    && lower(comment.audience) === "client"
    && !!clean(actor.actorKey)
    && clean(actor.actorKey) === clean(comment.author_key);
  return {
    can_edit: moderator || ownCreative || ownClient,
    can_delete: moderator || ownCreative || ownClient,
    can_resolve: moderator && !clean(comment.parent_id),
  };
}

export function publicComment(row, principal) {
  const source = row && typeof row === "object" && !Array.isArray(row) ? row : {};
  const kind = lower(principal && principal.kind || principal);
  if (!audienceAllowed(kind, source.audience)) return null;
  const deleted = !!clean(source.deleted_at);
  return {
    id: clean(source.id),
    // Calendar/Samples response-loss recovery needs the caller-supplied
    // stable identity, but no provider or private author identity.
    native_comment_id: clean(source.native_comment_id).slice(0, 160) || null,
    parent_id: clean(source.parent_id) || null,
    author_name: clean(source.author_name) || "Unknown author",
    role: clean(source.role) || null,
    body: deleted ? "Comment deleted." : source.body == null ? "" : String(source.body),
    body_format: clean(source.body_format) || "markdown",
    attachments: deleted ? [] : safeAttachments(source.attachments),
    audience: lower(source.audience) === "client" ? "client" : "internal",
    component: clean(source.component) || null,
    is_tweak: source.is_tweak === true,
    round: Number.isInteger(Number(source.round)) ? Number(source.round) : null,
    source_created_at: clean(source.source_created_at) || null,
    source_updated_at: clean(source.source_updated_at) || null,
    edited_at: clean(source.edited_at) || null,
    deleted_at: clean(source.deleted_at) || null,
    resolved_at: clean(source.resolved_at) || null,
    version: Number.isInteger(Number(source.version)) ? Number(source.version) : 1,
    created_at: clean(source.created_at) || null,
    updated_at: clean(source.updated_at) || null,
    ...lifecycleCapabilities(principal, source),
  };
}
