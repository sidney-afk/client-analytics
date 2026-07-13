const SYNCVIEW_BRIDGE_PREFIX = /^\*\*([^*\n]+?) \(via SyncView\):\*\*\s*/i;
const SYNCVIEW_MARKER = /<!--\s*syncview-mirror:([^>]+?)\s*-->/i;
const SYNCVIEW_MARKERS = /\s*<!--\s*syncview-mirror(?::[^>]+?)?\s*-->\s*/gi;

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function objectAt(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function hasOwn(value, key) {
  return !!value && Object.prototype.hasOwnProperty.call(value, key);
}

function keyPart(value) {
  let text = clean(value).toLowerCase();
  try { text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (_error) {}
  return text.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function iso(value) {
  const text = clean(value);
  if (!text) return null;
  const millis = Date.parse(text);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

export function parseSyncViewBridgeBody(value) {
  const rawBody = String(value == null ? "" : value);
  const prefix = rawBody.match(SYNCVIEW_BRIDGE_PREFIX);
  const marker = rawBody.match(SYNCVIEW_MARKER);
  return {
    bridge_authored: !!prefix,
    bridge_author_name: prefix ? clean(prefix[1]) : "",
    mirror_marker: marker ? clean(marker[1]) : "",
    body: rawBody.replace(SYNCVIEW_BRIDGE_PREFIX, "").replace(SYNCVIEW_MARKERS, "").trim(),
  };
}

export function stableCommentAuthor({ memberId, linearUserId, authorName, bridgeAuthored }) {
  const member = clean(memberId);
  const linear = clean(linearUserId);
  const name = clean(authorName) || "Unknown author";
  if (member) return { author_key: `team:${member}`, author_name: name };
  if (bridgeAuthored) return { author_key: `bridge:${keyPart(name)}`, author_name: name };
  if (linear) return { author_key: `linear:${linear}`, author_name: name };
  return { author_key: `linear-name:${keyPart(name)}`, author_name: name };
}

export function normalizeLinearComment(input) {
  const comment = objectAt(input && input.comment);
  const issue = objectAt(input && input.issue);
  const payload = objectAt(input && input.payload);
  const member = objectAt(input && input.member);
  const echo = objectAt(input && input.echo);
  const user = objectAt(comment.user);
  const externalUser = objectAt(comment.externalUser);
  const botActor = objectAt(comment.botActor);
  const bridge = parseSyncViewBridgeBody(comment.body ?? comment.description ?? "");
  const action = clean(input && input.action).toLowerCase();
  const createLike = !["update", "remove", "delete", "archive"].includes(action);
  const bodyAvailable = hasOwn(comment, "body") || hasOwn(comment, "description");
  const authorAvailable = !!(
    bridge.bridge_author_name || clean(member.id || member.name)
    || clean(user.id || user.displayName || user.name)
    || clean(externalUser.id || externalUser.displayName || externalUser.name)
    || clean(botActor.id || botActor.displayName || botActor.name)
    || clean(comment.author || comment.userName)
  );
  const linearCommentId = clean(comment.id);
  if (!linearCommentId) throw new Error("linear comment id required");

  const transportLinearUserId = clean(user.id || externalUser.id || botActor.id);
  const transportAuthorName = clean(
    user.displayName || user.name || externalUser.displayName || externalUser.name
      || botActor.displayName || botActor.name || comment.author || comment.userName,
  ) || "Linear";
  const humanName = bridge.bridge_author_name || clean(member.name) || transportAuthorName;
  const stable = stableCommentAuthor({
    memberId: member.id,
    linearUserId: bridge.bridge_authored ? "" : transportLinearUserId,
    authorName: humanName,
    bridgeAuthored: bridge.bridge_authored,
  });
  const sourceUpdatedAt = iso(comment.updatedAt || comment.editedAt || payload.webhookTimestamp || payload.webhook_timestamp)
    || new Date().toISOString();
  const sourceCreatedAt = iso(comment.createdAt) || sourceUpdatedAt;
  const deletedAt = ["remove", "delete", "archive"].includes(action)
    ? iso(comment.archivedAt || payload.webhookTimestamp || payload.webhook_timestamp) || sourceUpdatedAt
    : iso(comment.archivedAt);
  const editedAt = iso(comment.editedAt) || (action === "update" ? sourceUpdatedAt : null);
  const parent = objectAt(comment.parent);
  const issueTeam = objectAt(issue.team);
  const parentId = clean(comment.parentId || parent.id);
  const nativeCommentId = clean(echo.comment_id);
  const durableNativeId = nativeCommentId || `linear:${linearCommentId}`;

  const normalized = {
    id: durableNativeId,
    idempotency_key: nativeCommentId ? `native:${nativeCommentId}` : `linear:${linearCommentId}`,
    operation: ["remove", "delete", "archive"].includes(action) ? "delete"
      : action === "update" ? "edit" : "add",
    native_comment_id: durableNativeId,
    linear_comment_id: linearCommentId,
    source: "mirror",
    source_updated_at: sourceUpdatedAt,
    deleted_at: deletedAt,
    import_run_id: null,
    provenance: {
      transport: "linear_webhook",
      action,
      delivery_id: clean(payload.webhookId || payload.deliveryId || payload.id) || null,
      linear_team_key: clean(issueTeam.key) || null,
      bridge_authored: bridge.bridge_authored,
      mirror_marker: bridge.mirror_marker || null,
      native_id_provenance: nativeCommentId ? "syncview_source" : "linear_derived",
      timestamp_provenance: comment.createdAt ? "linear" : "webhook_fallback",
    },
  };

  const issueUuid = clean(issue.id || comment.issueId || objectAt(comment.issue).id);
  const issueIdentifier = clean(issue.identifier || objectAt(comment.issue).identifier);
  if (issueUuid) normalized.linear_issue_uuid = issueUuid;
  if (issueIdentifier) normalized.linear_identifier = issueIdentifier;
  if (parentId) {
    normalized.linear_parent_comment_id = parentId;
    // Native parent linkage is resolved only after the parent row exists. The
    // external parent ID is durable even when Linear delivers replies first.
    normalized.parent_id = null;
  }
  if (bodyAvailable || createLike) {
    normalized.body = bridge.body;
    normalized.body_format = "markdown";
  }
  if (authorAvailable || createLike) {
    normalized.author_key = stable.author_key;
    normalized.author_member_id = clean(member.id) || null;
    normalized.author_name = stable.author_name;
    normalized.role = clean(member.role) || (bridge.bridge_authored ? "bridge" : "linear");
    normalized.linear_author_id = bridge.bridge_authored ? null : transportLinearUserId || null;
    normalized.transport_linear_user_id = transportLinearUserId || null;
    normalized.transport_actor = transportAuthorName;
    normalized.transport_role = "linear_webhook";
  }
  if (createLike) normalized.audience = "internal";
  if (createLike || bridge.bridge_authored) normalized.origin = bridge.bridge_authored ? "bridge" : "linear";
  if (comment.createdAt || createLike) normalized.source_created_at = sourceCreatedAt;
  if (editedAt) normalized.edited_at = editedAt;
  if (hasOwn(comment, "resolvedAt")) normalized.resolved_at = iso(comment.resolvedAt);

  return normalized;
}
