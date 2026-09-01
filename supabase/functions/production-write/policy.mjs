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
  "batch_asset",
  "batch_description",
  "component_fill",
]);

// The two batch-level asset slots that may be written, and the columns they
// name. `filming_plan` is deliberately absent: it is derived from the
// filming_plans source and the owner ruled it untouchable from the product.
// public.production_batch_asset_write carries the same whitelist in the
// database, so this copy is the gateway's fast refusal, never the only one.
export const BATCH_ASSET_SLOTS = Object.freeze({
  raw_footage: "footage_folder_url",
  delivery_folder: "delivery_folder_url",
});

export function batchAssetColumn(slot) {
  return Object.prototype.hasOwnProperty.call(BATCH_ASSET_SLOTS, lower(slot))
    ? BATCH_ASSET_SLOTS[lower(slot)]
    : "";
}

// The title a filled component takes, and the ONE piece of judgement in the
// whole fill path.
//
// A fill inherits from its sibling instead of allocating from the batch, so
// there is no ordinal to compose a title from -- and half the population has no
// ordinal to find. Measured 2026-08-31 across the 127 live cards missing one
// component: of the 126 readable siblings, 65 are titled in the strict
// 'Video N' / 'Thumbnail N' form and 61 are human-titled Linear-era issues
// ('Doug Cartwright | Jun. 29 - Jul. 5 | Reel 4', 'Video 6 - Before Coming To
// Us', '5. When Gut Protocols Don't Work').
//
// So there are two conventions in the estate, and this honours whichever one
// the card is already living under:
//
//   * A NUMBERED sibling gets its counterpart at the SAME number -- 'Video 9'
//     fills as 'Thumbnail 9'. Never the next free number: the pair belongs to
//     one post, and 'Video 9' beside 'Thumbnail 12' is exactly the confusion
//     that made riding production_intake_append the wrong design.
//   * ANY OTHER sibling is MIRRORED verbatim. That is not a fallback, it is
//     the pre-flip convention: VID-13226 'video-9' and GRA-7058 'video-9' are
//     the same string, because before the numbering rule a card's two halves
//     simply shared a title. Mirroring keeps a Linear-era card looking like
//     the rest of its own batch rather than like the batch next door.
//
// The 'Sample ' prefix is taken from the BATCH's purpose, never from the
// sibling's spelling: the first live samples batch predates the 2026-08-19
// ruling and its children read 'Video 1', so reading the prefix off the
// sibling would keep reproducing the old spelling forever.
export function componentFillTitle(siblingTitle, targetTeam, purpose) {
  const title = clean(siblingTitle);
  const team = normalizeTeam(targetTeam);
  if (!title || (team !== "video" && team !== "graphics")) return "";
  const numbered = /^(?:Sample )?(?:Video|Thumbnail) ([1-9][0-9]*)$/.exec(title);
  if (!numbered) return title;
  const prefix = clean(purpose) === "samples" ? "Sample " : "";
  return `${prefix}${team === "graphics" ? "Thumbnail" : "Video"} ${numbered[1]}`;
}

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

// F136 — one server-owned role × current × next × team × assignee state
// machine. The previous contract exposed a flat next-status set with no
// current-state or ownership input, so a creative could regress reviewer or
// terminal work (kasper_approval / client_approval / approved / scheduled /
// posted) to To Do or Tweak, cancel it, or mark it duplicate, and could do all
// of that on a peer's row reached through All or a direct link.
//
// OWNER RULING 2026-08-17 — gap-audit question 10 is ANSWERED, and the answer
// is "no state machine". The designer hit it on her first real post-flip card:
// GRA-7085 sat in To Do and the picker offered her only Backlog and In
// Progress, so submitting for approval meant a detour through In Progress. In
// the owner's words: "I want someone to be able to change the statuses
// whenever, like, there's no need for that."
//
// So every current status now offers every deliverable status. This is a
// widening of a fail-closed default that was always flagged as the owner's
// call, not a safety property being removed by code. What still constrains a
// creative is unchanged and deliberate, and none of it lives in this table:
// the team must match, the assignee binding below still scopes status writes
// to the creative's own work, and the Graphics approval-artifact gate still
// refuses smm_approval without a resolvable deliverable link.
export const CREATIVE_STATUS_TRANSITIONS = Object.freeze(
  Object.fromEntries(DELIVERABLE_STATUSES.map(
    status => [status, Object.freeze([...DELIVERABLE_STATUSES])],
  )),
);

// Operations a creative may perform only on work that is assigned to them.
// `comment` is deliberately absent: it is additive, cannot regress state, and
// keeping it same-team-wide preserves today's collaboration.
//
// `attachment` was removed 2026-08-18 by owner ruling, on a live incident: the
// graphics designer mis-attached a thumbnail file, and the assignee binding
// then refused her the EDIT that would fix it -- the row she needed to repair
// was not hers, so the mistake was permanent from her seat and only an
// admin/SMM could clean it up. The owner: "I need her to be able to edit what
// she puts there." Only `status` remains assignee-bound.
//
// That ruling said attachment stayed TEAM-bound, and it did until 2026-09-01,
// when the same designer hit the same wall one team over: the post her
// thumbnail hangs off is a VIDEO row, so the team match refused her the file
// slot on it. The owner widened it -- "anyone, graphic, video, social media
// manager, or admin ... on any parent issue or sub-issue" -- and `attachment`
// now decides ABOVE the team match, beside `batch_asset`. Neither binding is
// left on it. See staffOperationAllowed for the ruling, and for why the
// filming plan is untouched by it.
const CREATIVE_ASSIGNEE_BOUND_OPERATIONS = new Set(["status"]);
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

export function creativeNextStatuses(currentStatus) {
  return CREATIVE_STATUS_TRANSITIONS[lower(currentStatus)] || [];
}

export function creativeTransitionAllowed(currentStatus, nextStatus) {
  const next = lower(nextStatus);
  return !!next && creativeNextStatuses(currentStatus).includes(next);
}

export function creativeOwnsTarget(actorMemberId, targetAssigneeId) {
  const actor = clean(actorMemberId);
  return !!actor && actor === clean(targetAssigneeId);
}

// `context` carries the current row state the F136 matrix needs. It is optional
// only for admin/SMM, whose authority never depends on it; a creative decision
// with an absent context resolves to "no transition available" and denies.
export function staffOperationAllowed(
  keyRole,
  operation,
  memberTeam,
  targetTeam,
  nextStatus = "",
  context = {},
) {
  const key = lower(keyRole);
  const op = normalizeOperation(operation);
  if (!op) return false;
  if (key === "admin" || key === "smm") return true;
  /* A batch asset is not team-owned. Raw footage and the frame folder belong to
     the POST: one shoot, one set of files, worked by the editor who cuts it and
     the designer who pulls a frame out of it for the thumbnail. A batch that
     serves both teams carries a single `team` value and mints a synthetic
     parent per team, so a team match here would hand the shared folder to
     whichever team happened to be recorded and lock the other one out of a
     link it uses daily.
     Owner, 2026-08-30: "anyone should be able to change the link of the raw
     footage, or the frame folder". Any staff principal, then -- and never a
     client, which the gateway refuses before this is reached. The filming plan
     is not writable through any role: it is not in BATCH_ASSET_SLOTS, and the
     database function does not accept it either. */
  if (op === "batch_asset") return key === "creative" && !!normalizeTeam(memberTeam);
  /* A DELIVERABLE asset is decided here too, above the team match, for the same
     reason and by the same ruling. `attachment` writes the deliverable_file
     slot -- the finished video, or the thumbnail image -- and the owner's
     instruction on 2026-09-01 was that any of graphics, video, SMM or admin may
     edit assets "on any parent issue or sub-issue or whatever".

     THE FILMING PLAN IS THE NAMED EXCEPTION and needs no clause here, because
     it is not writable through ANY operation: it is absent from
     BATCH_ASSET_SLOTS, PROD_ASSET_SPECS gives it no `write` key so the browser
     renders no Edit control, and production_batch_asset_write rejects the slot
     in the database. Three independent refusals, none of which this widening
     touches. It is derived from the client's filming plan, not typed by hand.

     Still requires a team on the member, exactly as batch_asset does: that is
     what distinguishes a real creative from a role key with no roster row. */
  if (op === "attachment") return key === "creative" && !!normalizeTeam(memberTeam);
  /* `batch_description` is deliberately NOT widened alongside batch_asset, and
     the first version of it was.
     A DESCRIPTION is admin/SMM everywhere else in the estate: `description` on
     a deliverable falls through the team match below and returns false for a
     creative, and always has. Opening the post-level one to creatives would
     have made a new write more permissive than the existing one it sits beside,
     on no ruling -- and it produced a live mismatch, because the browser gate
     asks with `description` and refused the creatives this line was admitting.
     Raised by review on #1203, which proposed translating the operation in the
     browser instead; that resolves the mismatch by widening rather than by
     matching, which is not a permission change to make without being asked.
     So it falls through, and admin/SMM keep it through the early return above.
     If creatives should edit post descriptions, that is an owner ruling and it
     belongs in one line here plus the browser's own role gate. */
  if (op === "batch_description") return false;
  if (key !== "creative" || !normalizeTeam(memberTeam)
      || normalizeTeam(memberTeam) !== normalizeTeam(targetTeam)) return false;
  const scope = context && typeof context === "object" ? context : {};
  if (CREATIVE_ASSIGNEE_BOUND_OPERATIONS.has(op)
      && !creativeOwnsTarget(scope.actorMemberId, scope.targetAssigneeId)) return false;
  if (op === "comment") return true;
  /* `attachment` used to be decided here, under the team match, admitting a
     creative only on their own team. It moved above that match on 2026-09-01
     by the owner ruling quoted there. Nothing is left for it to do here, and
     leaving a second unreachable arm would be a place for the two to disagree
     later. `comment` and `status` keep the team match deliberately: neither was
     part of that ruling, and `status` is additionally assignee-bound. */
  if (op === "status") return creativeTransitionAllowed(scope.currentStatus, nextStatus);
  return false;
}

// F136's browser mirror. The picker must offer exactly the set the gateway
// would accept, so both sides read this one projection.
export function staffNextStatuses(keyRole, memberTeam, targetTeam, context = {}) {
  const key = lower(keyRole);
  if (key === "admin" || key === "smm") return [...DELIVERABLE_STATUSES];
  return DELIVERABLE_STATUSES.filter(status =>
    staffOperationAllowed(key, "status", memberTeam, targetTeam, status, context));
}

// F94 — one server-authoritative eligible-assignee projection.
//
// The shipped picker offered every active same-team roster row and the gateway
// validated only id + active + team, so a manual reassignment could commit an
// owner-approved-role mismatch or an unmirrorable target; the native write
// succeeded and the asynchronous linear-outbound push threw later. The same
// projection now backs the picker, the create form, and the commit.
//
// Roles are exact per team pending the owner's answer to the F94 register
// question ("may admin/SMM ever own a creative deliverable, or is
// Video=editor and Graphics=designer exact?"). The live roster carries no team
// on any admin/SMM row, so the strict default excludes nobody who is currently
// eligible.
export const CREATIVE_ROLE_BY_TEAM = Object.freeze({
  video: "editor",
  graphics: "designer",
});

export const ASSIGNEE_INELIGIBLE_REASONS = Object.freeze([
  "assignee_not_found",
  "assignee_inactive",
  "assignee_out_of_scope",
  "assignee_role_incompatible",
  "assignee_mapping_unavailable",
  "assignee_provider_inactive",
  "assignee_provider_unverified",
]);

export function assigneeRoleForTeam(team) {
  return CREATIVE_ROLE_BY_TEAM[normalizeTeam(team)] || "";
}

export function canonicalLinearUserId(value) {
  const id = clean(value);
  return SAFE_LINEAR_ID.test(id) ? id : "";
}

// The runtime flag is a retirement switch only. Missing, unreadable and
// malformed values keep the strictest contract; exactly
// { "provider_mapping_required": false } drops the provider requirement, which
// is the atomic change the register reserves for retired mode.
export function assigneeEligibilityPolicy(value) {
  let parsed = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch (_error) { parsed = null; }
  }
  const required = !(parsed
    && typeof parsed === "object"
    && !Array.isArray(parsed)
    && parsed.provider_mapping_required === false);
  return { providerMappingRequired: required };
}

// `providerActive` is a tri-state: true (provider says active), false (provider
// says inactive/archived), null (not proven). While the provider mapping is
// required, "not proven" is a denial, not a pass.
export function assigneeEligibility(member, team, options = {}) {
  const wantedTeam = normalizeTeam(team);
  const row = member && typeof member === "object" ? member : null;
  const providerRequired = !options || options.providerMappingRequired !== false;
  const providerActive = options && Object.prototype.hasOwnProperty.call(options, "providerActive")
    ? options.providerActive
    : null;
  const linearUserId = canonicalLinearUserId(row && row.linear_user_id);
  const deny = reason => ({ eligible: false, reason, linear_user_id: "" });

  if (!wantedTeam) return deny("assignee_out_of_scope");
  if (!row || !clean(row.id)) return deny("assignee_not_found");
  if (row.active !== true) return deny("assignee_inactive");
  if (normalizeTeam(row.team) !== wantedTeam) return deny("assignee_out_of_scope");
  if (lower(row.role) !== assigneeRoleForTeam(wantedTeam)) return deny("assignee_role_incompatible");
  if (providerRequired) {
    if (!linearUserId) return deny("assignee_mapping_unavailable");
    if (providerActive === false) return deny("assignee_provider_inactive");
    if (providerActive !== true) return deny("assignee_provider_unverified");
  }
  return { eligible: true, reason: "", linear_user_id: linearUserId };
}

export function eligibleAssigneeProjection(members, team, options = {}) {
  return (Array.isArray(members) ? members : [])
    .map(member => ({ member, verdict: assigneeEligibility(member, team, {
      ...options,
      providerActive: options && typeof options.providerActiveFor === "function"
        ? options.providerActiveFor(canonicalLinearUserId(member && member.linear_user_id))
        : (options ? options.providerActive : null),
    }) }))
    .filter(entry => entry.verdict.eligible)
    .map(entry => ({
      id: clean(entry.member.id),
      name: clean(entry.member.name) || "Unnamed team member",
      role: lower(entry.member.role),
      team: normalizeTeam(entry.member.team),
    }))
    .sort((left, right) =>
      clean(left.name).localeCompare(clean(right.name))
      || clean(left.id).localeCompare(clean(right.id)));
}

/* ANY staff principal may READ a deliverable's assets and description, on
   either team.

   The team match this replaced was not protecting anything: the caller is
   already authenticated against a declared client scope, and the row lookup is
   pinned to that client, so a cross-CLIENT read was never possible here. All
   the team match added was a wall between two people working the same post.

   And the post is the unit of work, not the team. A post's parent row is a
   VIDEO deliverable on 105 of the batches that carry graphics work, and the
   brief a designer needs -- the filming plan link, the general drive, the
   client's photos -- lives in that parent's DESCRIPTION. The same gate guards
   the description read, so a graphics designer opening the post she is
   assigned work on got "Description could not load" and four Unavailable
   asset rows, while an admin looking at the same screen saw everything.

   Owner report and ruling, 2026-09-01, after his only graphics designer hit
   exactly that: "I want anyone, graphic, video, social media manager, or
   admin to be able to edit assets ... on any parent issue or sub-issue".
   Reading is the weaker half of that instruction and is what unblocks her.

   A client principal never reaches this: handleAssetAccessRead refuses
   principal.kind === "client" before calling it. */
export function staffAssetReadAllowed(keyRole, memberTeam, targetTeam) {
  const key = lower(keyRole);
  return key === "admin" || key === "smm" || key === "creative";
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
// the request surface is `sxr`, the target deliverable is Samples-origin, the
// comment's component maps to the deliverable's team, AND the card the client
// presented (requestedCardId) is the exact card the target deliverable belongs
// to. "Has some nonempty card_id" is not authorization: a client authorized for
// card A could otherwise mutate a comment on card B under the same slug/team.
// The exact card match mirrors the reader's `row.card_id === cardId` gate so the
// writer is never weaker than the reader it fronts.
export function clientCommentTargetAllowed(surface, existing, component, requestedCardId) {
  const row = existing && typeof existing === "object" ? existing : {};
  const comp = lower(component);
  const expectedTeam = comp === "graphic"
    ? "graphics"
    : comp === "video"
      ? "video"
      : "";
  const targetCardId = clean(row.card_id);
  const requestedCard = clean(requestedCardId);
  return lower(surface) === "sxr"
    && lower(row.origin) === "samples"
    && !!targetCardId
    && !!requestedCard
    && targetCardId === requestedCard
    && !!expectedTeam
    && normalizeTeam(row.team) === expectedTeam;
}

// FRONT DOOR (2026-08-14, the real repair for the 2026-08-13 comment_forbidden
// P0 that PR #1064 routed around). The strict predicate above authorizes ONLY
// the card-bound SXR thread, so two live client populations could never use
// the gateway: every Calendar-surface comment (surface fails first) and every
// UNLINKED samples thread (no card binding exists to present). Both rode the
// legacy n8n lane, which stops accepting graphics traffic at the F1 authority
// flip — after which those client comments would park silently.
//
// This predicate admits exactly those two populations, bound by everything
// that CAN be verified for them, mirroring how their readers authorize the
// same rows:
//
//   BOTH surfaces (mirrors authenticate()'s clientScopeAllowed binding and the
//   reader's clientTargetAllowed): the target row belongs to the authenticated
//   principal's slug. `principalSlug` is the server-resolved slug from the
//   token match — never a request-body value — and the component must map to
//   video/graphics and match the target row's team, exactly as the reader's
//   component/team clause does.
//
//   surface='calendar': the row's origin must be 'calendar' (the same
//   surface→origin map the browser crosswalk enforces:
//   PROD_CROSSWALK_SURFACE_ORIGIN), and the row's card binding — IF PRESENT —
//   must equal the card the caller presents, the exact-match rule of the
//   strict predicate. A row with no card binding has nothing to match; the
//   slug/origin/team clauses are the binding, which is precisely how the
//   client calendar reader scopes the same rows (by slug, not by card).
//
//   surface='sxr' UNLINKED: the row must be samples-origin AND carry NO card
//   binding. A card-BOUND samples row never enters here — it stays governed by
//   the strict exact-card predicate above, so this widening cannot weaken the
//   card-bound contract. Clients see unlinked threads through their
//   slug-scoped sample_reviews row (there is no canonical card crosswalk to
//   verify), so slug+origin+team is the complete verifiable binding.
//
// Batches stay excluded on both surfaces: a batches row has no `origin`
// column, so the origin clause fails closed for entity='batch' targets.
export function clientCommentFrontDoorTargetAllowed(
  surface,
  existing,
  component,
  requestedCardId,
  principalSlug,
) {
  const row = existing && typeof existing === "object" ? existing : {};
  const comp = lower(component);
  const expectedTeam = comp === "graphic"
    ? "graphics"
    : comp === "video"
      ? "video"
      : "";
  if (!expectedTeam || normalizeTeam(row.team) !== expectedTeam) return false;
  if (!clientScopeAllowed(principalSlug, row.client_slug)) return false;
  const lane = lower(surface);
  const targetCardId = clean(row.card_id);
  if (lane === "calendar") {
    return lower(row.origin) === "calendar"
      && (!targetCardId || targetCardId === clean(requestedCardId));
  }
  if (lane === "sxr") {
    return lower(row.origin) === "samples" && !targetCardId;
  }
  return false;
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

// Overdue rescue: an overdue YYYY-MM-DD due date (e.g. a card that accumulated
// tweak rounds until its deadline fell into the past) is moved forward to the
// next working day at or after tomorrow, computed on the America/Guatemala
// policy day. Saturdays and Sundays are skipped, matching the Workload
// wlNextWorkingDay rule (a Friday rescue lands on Monday). The target is
// derived from today, never incremented from the stale due date. Retuned from
// the legacy UTC today-plus-two bridge (owner decision) — same trigger (any
// status write while overdue), same kill switch (overdueStatusBumpEnabled),
// same outbox/echo lane.
const OVERDUE_BUMP_TIME_ZONE = "America/Guatemala";
function overdueBumpPolicyTodayISO(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: OVERDUE_BUMP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const values = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  return `${values.year}-${values.month}-${values.day}`;
}
function overdueBumpAddDays(iso, n) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + n)).toISOString().slice(0, 10);
}
function overdueBumpIsWeekend(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dow === 0 || dow === 6;
}
function overdueBumpNextWorkingDay(iso) {
  let cursor = iso;
  for (let guard = 0; guard < 7 && overdueBumpIsWeekend(cursor); guard++) {
    cursor = overdueBumpAddDays(cursor, 1);
  }
  return cursor;
}

const ASSET_HOSTS = Object.freeze([
  "drive.google.com",
  "docs.google.com",
  "frame.io",
  "app.frame.io",
  // Frame.io's live product domain. An `f.io/<id>` short link 302s straight to
  // `next.frame.io/share/<uuid>`, so without this host the probe's redirect
  // allowlist refused the hop and every Frame.io artifact died as
  // `unavailable` — the shape was accepted and the fetch never completed.
  // Found 2026-08-17 by probing the owner's own card link.
  "next.frame.io",
  "f.io",
  "dropbox.com",
  "www.dropbox.com",
  "uploads.linear.app",
]);
/*
 * `export` and `format` were added 2026-08-05. They are not optional extras:
 * `assetProbeUrl` BUILDS them. A Drive probe is `/uc?export=download&id=…` and a
 * Docs probe is `/document/d/…/export?format=pdf`, so without these keys the
 * gateway constructed a URL its own `assetUrlType` then judged `invalid`, and
 * `boundedAssetFetch` threw `asset_redirect_invalid` at hop 0 without making a
 * request. Every Google Drive and Google Docs artifact was unprobeable; Dropbox
 * worked only because `raw` and `rlkey` happened to be listed already.
 *
 * Neither key is a credential — `CREDENTIAL_QUERY_KEY` still rejects token,
 * auth, key, secret, signature, expires, credential and policy — and neither
 * changes a folder into a file. `test/asset-probe-url-policy.js` holds the
 * property that made this findable: every URL `assetProbeUrl` constructs must
 * pass `assetUrlType`.
 */
const SAFE_ASSET_QUERY_KEYS = new Set([
  "usp", "dl", "raw", "download", "id", "tab", "rlkey", "resourcekey",
  "export", "format",
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

/*
 * THE ATTRIBUTION AUTHORITY, mirrored from `scripts/f200-attribution.js`.
 *
 * Deliberately TEAM-KEY-BLIND, unlike `projectIdsForTeam` directly below it.
 * The two are not redundant and must not be merged:
 *
 *   projectIdsForTeam    routes a NEW intake to a team's project, and refuses
 *                        to guess from an untagged list. Strict on purpose.
 *   attributionProjectIds decides whether the roster maps a project at all.
 *                        This is what `buildProjectIndex` uses, so it is the
 *                        rule an attribution stamp must be computed under.
 *
 * A stamp built on the stricter rule disagrees with its own comparator forever:
 * on 2026-08-05 `intakeAttribution` used `projectIdsForTeam` and stamped
 * `needs_attribution` on rows the reconciler independently resolved.
 *
 * This is a SECOND implementation of logic that also lives in Node, because an
 * Edge Function cannot import from `scripts/`. Duplication that can drift is
 * exactly the hazard this whole exercise has been about, so
 * `test/attribution-project-ids-parity.js` runs both against a shared corpus
 * and fails if they ever disagree.
 */
const ATTRIBUTION_ID_KEYS = Object.freeze(["id", "project_id", "linear_project_id"]);
const ATTRIBUTION_TEAM_KEYS = new Set([
  "video", "vid", "graphics", "graphic", "gra", "thumbnail",
]);

function attributionRecognizedIds(value) {
  if (typeof value === "string") return clean(value) ? [clean(value)] : [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return [...new Set(ATTRIBUTION_ID_KEYS.map(key => clean(value[key])).filter(Boolean))];
}

export function attributionProjectIds(value) {
  if (typeof value === "string") {
    const text = clean(value);
    if (!text) return [];
    try {
      return attributionProjectIds(JSON.parse(text));
    } catch (_error) {
      return [text];
    }
  }
  if (!value || typeof value !== "object") return [];

  const found = new Set();
  const add = entry => attributionRecognizedIds(entry).forEach(id => found.add(id));
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string") {
        if (clean(entry)) found.add(clean(entry));
      } else {
        add(entry);
      }
    }
  } else {
    add(value);
    for (const [key, entry] of Object.entries(value)) {
      if (!ATTRIBUTION_TEAM_KEYS.has(lower(key))) continue;
      if (typeof entry === "string") {
        if (clean(entry)) found.add(clean(entry));
      } else {
        add(entry);
      }
    }
    if (Array.isArray(value.projects)) {
      for (const entry of value.projects) add(entry);
    }
  }
  return [...found].sort();
}

export function assetProbeUrl(rawUrl) {
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
  if (host === "frame.io" || host === "app.frame.io" || host === "next.frame.io"
      || host === "f.io") return "folder";
  if (host === "dropbox.com" || host === "www.dropbox.com") {
    return /\/scl\/fo\/|\/sh\//i.test(url.pathname) ? "folder" : "file";
  }
  return "invalid";
}

export function assetTypeAllowed(slot, value) {
  const kind = assetUrlType(value);
  const key = lower(slot);
  if (key === "filming_plan") return kind === "document" || kind === "file";
  /* RAW FOOTAGE AND THE FRAME FOLDER ACCEPT A FILE TOO (owner ruling
     2026-09-01), for the same reason the deliverable slot did on 2026-08-16
     and in the owner's own words: "the raw footage says invalid but I want to
     remove that -- even if it is a dropbox it should work. And it does work."
     He was right on both counts. A Dropbox share of one recording is
     `/scl/fi/...`, which assetUrlType calls a FILE, so a link that opens fine
     was painted red on a row nobody could repair -- the probe is a REPORT, not
     a gate (WIRED-PARITY item 31), and this was the last place it still failed
     a link for its SHAPE rather than for being unreachable.
     The host allowlist is untouched and is what actually protects this slot: a
     Google DOC is still refused here, because a brief is not footage. */
  if (key === "raw_footage" || key === "delivery_folder") {
    return kind === "folder" || kind === "file";
  }
  /*
   * THE GRAPHICS ARTIFACT ACCEPTS A FOLDER (owner ruling 2026-08-16).
   *
   * This slot used to demand `kind === "file"`, on the theory that a canonical
   * deliverable must be one concrete file. In real work it is not: the team
   * ships graphics as Frame.io review links and as Drive folders of frames,
   * and the owner ruled the strict reading out loud — "I don't want cards to be
   * rejected if the thumbnail is a frame link or a folder link because it is
   * supported... I don't really want it to be that strict."
   *
   * The cost of the old rule was measured, not guessed: 1,972 of 2,009 active
   * graphics deliverables carried no usable canonical link at all, so the day
   * the graphics flip made this gate load-bearing it would have refused SMM
   * approval for essentially the whole team.
   *
   * A Google DOC is still not a deliverable (that is a brief, not the artwork)
   * and an unsigned Linear upload is still private to Linear, so both stay out.
   */
  if (key === "deliverable_file") return kind === "file" || kind === "folder";
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

export function overdueStatusBumpDate(value, now = Date.now()) {
  if (!validDateOrNull(value) || !clean(value)) return "";
  const due = clean(value);
  const today = overdueBumpPolicyTodayISO(now);
  // YYYY-MM-DD strings compare lexicographically in calendar order.
  if (due >= today) return "";
  return overdueBumpNextWorkingDay(overdueBumpAddDays(today, 1));
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

// Which team actually OWNS the parent issue resolved for `wantedTeam`.
//
// One Linear issue can serve every team a card has: the batch parent map
// records it under each team's key and stamps `owner_team` with the team the
// issue was really created in. Validating that issue against the team doing
// the ASKING then fails -- a video issue is not a graphics issue -- which is
// exactly why appending a thumbnail to a batch whose only parent is a video
// issue was refused as batch_parent_mapping_missing. Callers validate against
// the owner instead, which is what the stamp exists for.
//
// Returns "" when nothing stamped an owner (older maps), so callers fall back
// to their previous behaviour and legacy batches validate exactly as before.
export function parentOwnerTeamFor(value, wantedTeam) {
  const wanted = normalizeTeam(wantedTeam);
  if (!wanted) return "";
  const root = value && typeof value === "object" ? value : null;
  if (!root) return "";

  function ownerOf(entry) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "";
    return normalizeTeam(entry.owner_team);
  }
  function taggedTeam(entry) {
    return normalizeTeam(entry && (entry.team || entry.team_key || entry.key || entry.kind));
  }

  const list = Array.isArray(root) ? root : (Array.isArray(root.parents) ? root.parents : []);
  if (!Array.isArray(root)) {
    for (const [key, entry] of Object.entries(root)) {
      if (normalizeTeam(key) !== wanted) continue;
      const owner = ownerOf(entry);
      if (owner) return owner;
    }
  }
  for (const entry of list) {
    if (taggedTeam(entry) !== wanted) continue;
    const owner = ownerOf(entry);
    if (owner) return owner;
  }
  return "";
}

// The browser may describe the post, but it does not own batch ordering. The
// gateway allocates one shared ordinal/sort slot per paired card and the SQL
// append RPC re-checks this plan while holding the batch lock.
/*
 * `purpose` (4th arg, default 'calendar') flavours the TITLES: a samples batch
 * numbers its children 'Sample Video N' / 'Sample Thumbnail N' (owner ruling
 * 2026-08-19 -- the parent and children must say they are samples). The BASE
 * ordinal count accepts both spellings deliberately: the first live samples
 * batch predates the ruling and its children read 'Video 1' / 'Thumbnail 1',
 * so a strict per-purpose count would restart at 1 and reuse the number.
 */
export function planAppendIntakeItems(existingRows, requestItems, requestIds, purpose) {
  const titlePrefix = clean(purpose) === "samples" ? "Sample " : "";
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
    // 2026-08-18: a card group is a video+graphics pair OR a single-team row
    // (the 2026-08-17 Video only / Thumbnail only modes), never two of one
    // team. Mirrors production_intake_append v2 exactly.
    const teams = new Set(entries.map(entry => entry.team));
    if (entries.length < 1 || entries.length > 2 || teams.size !== entries.length) {
      throw new Error("invalid_intake_append_pair");
    }
  }

  let maxSort = -1;
  let maxOrdinal = 0;
  for (const row of existingRows) {
    if (!row || requestIdSet.has(clean(row.id))) continue;
    const sort = Number(row.sort_key);
    if (Number.isFinite(sort)) maxSort = Math.max(maxSort, sort);
    // Thumbnail titles advance the ordinal too (production_intake_append v2),
    // and the optional 'Sample ' prefix counts as well (transition batches).
    const match = /^(?:Sample )?(?:Video|Thumbnail) ([1-9][0-9]*)$/.exec(clean(row.title));
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
      // Per-kind titles: a committed graphics half reads 'Thumbnail N'
      // (2026-08-17 title ruling), so an exact retry of a committed append
      // must recognise both spellings or it conflicts with its own result.
      const ordinals = new Set(prior.map(row => {
        const match = /^(?:Sample )?(?:Video|Thumbnail) ([1-9][0-9]*)$/.exec(clean(row.title));
        return match ? Number(match[1]) : 0;
      }));
      const sorts = new Set(prior.map(row => Number(row.sort_key)));
      const teams = new Set(prior.map(row => normalizeTeam(row.team)));
      if (ordinals.size !== 1 || ordinals.has(0) || sorts.size !== 1
          || !Number.isFinite([...sorts][0]) || teams.size !== prior.length
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
        title: entry.team === "graphics" ? `${titlePrefix}Thumbnail ${ordinal}` : `${titlePrefix}Video ${ordinal}`,
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
