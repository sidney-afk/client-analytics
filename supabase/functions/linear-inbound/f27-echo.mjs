function clean(value) {
  return String(value == null ? "" : value).trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

export function f27PreflightIdentity(row = {}, result = {}) {
  if (lower(row.status) !== "skipped" || result.f27_preflight !== true) return null;

  const rollbackId = clean(result.rollback_id);
  const correlationId = clean(result.correlation_id);
  const team = lower(row.team);
  if (!rollbackId || !correlationId || !team) return null;
  if (clean(result.outbox_id) !== clean(row.id)
    || clean(result.dedup_key) !== clean(row.dedup_key)
    || clean(result.operation) !== clean(row.operation)) return null;

  return { rollbackId, correlationId, team };
}

export function outboundEchoIdentityProof(
  row = {},
  result = {},
  actorId = "",
  openRollbacks = [],
) {
  // Preserve the existing rule: ordinary skipped rows never participate, but
  // a rollback-bound skipped row may still use the existing actor proof.
  const skippedEligible = lower(row.status) !== "skipped" || !!clean(result.rollback_id);
  const actorMatches = skippedEligible
    && !!clean(actorId)
    && !!clean(result.mirror_actor_id)
    && clean(result.mirror_actor_id) === clean(actorId);
  const terminalValueProof = skippedEligible
    && lower(row.status) === "written"
    && !!clean(row.processed_at);

  const identity = f27PreflightIdentity(row, result);
  const openF27PreflightProof = !!identity && openRollbacks.some(rollback => (
    lower(rollback.state) === "open"
      && clean(rollback.id) === identity.rollbackId
      && clean(rollback.correlation_id) === identity.correlationId
      && lower(rollback.team) === identity.team
  ));

  return {
    accepted: actorMatches || terminalValueProof || openF27PreflightProof,
    actorMatches,
    terminalValueProof,
    openF27PreflightProof,
  };
}
