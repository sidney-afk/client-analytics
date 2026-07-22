function clean(value) {
  return String(value == null ? "" : value).trim();
}

export const F27_DRILL_TEAM = "__f27_drill__";
export const F27_DRILL_CLIENT = "__f27_drill__";

export function isExactF27DrillAuthority(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === 2
    && keys[0] === "graphics"
    && keys[1] === "video"
    && value.graphics === "linear"
    && value.video === "linear";
}

export function hasExactF27DrillStops(outbound = {}, parity = {}) {
  return !!outbound && typeof outbound === "object" && !Array.isArray(outbound)
    && Object.keys(outbound).length === 1
    && outbound.mode === "off"
    && !!parity && typeof parity === "object" && !Array.isArray(parity)
    && Object.keys(parity).length === 1
    && parity.enabled === false;
}

export function f27ReplayRequest(body = {}) {
  const rollbackId = clean(body.rollback_id);
  const dedupKey = clean(body.target_dedup_key);
  const confirm = clean(body.confirm);
  const isDrill = confirm === "F27_ROLLBACK_DRILL";
  const enabled = rollbackId
    || confirm === "F27_ROLLBACK_REPLAY"
    || isDrill;
  if (!enabled) return null;
  if (!rollbackId || !dedupKey
      || (confirm !== "F27_ROLLBACK_REPLAY" && !isDrill)) {
    throw new Error("invalid F27 replay request");
  }
  return { rollbackId, dedupKey, isDrill };
}

export function bindF27ReplayScope(request = {}, rollback = {}, outbox = {}) {
  const rollbackId = clean(request.rollbackId);
  const dedupKey = clean(request.dedupKey);
  const isDrill = request.isDrill === true;
  if (!rollbackId || !dedupKey
      || clean(rollback.id) !== rollbackId
      || clean(outbox.dedup_key) !== dedupKey) {
    throw new Error("F27 replay target mismatch");
  }
  if ((rollback.is_drill === true) !== isDrill) {
    throw new Error("F27 replay scope mismatch");
  }

  if (isDrill) {
    if (clean(rollback.team) !== F27_DRILL_TEAM
        || clean(outbox.team) !== F27_DRILL_TEAM
        || clean(outbox.client_slug) !== F27_DRILL_CLIENT
        || clean(outbox.f27_drill_rollback_id) !== rollbackId
        || outbox.test_only !== true
        || outbox.legacy_parity !== false) {
      throw new Error("F27 drill target mismatch");
    }
  } else if (clean(outbox.team) !== clean(rollback.team)) {
    throw new Error("F27 replay target mismatch");
  }

  return {
    rollbackId,
    dedupKey,
    correlationId: clean(rollback.correlation_id),
    isDrill,
  };
}

export function isExactF27DrillReceipt(receipt = {}, replay = {}, row = {}) {
  const rollbackId = clean(replay.rollbackId);
  const input = receipt.expected && typeof receipt.expected === "object"
    ? receipt.expected.input
    : null;
  const expectedKeys = receipt.expected && typeof receipt.expected === "object"
    ? Object.keys(receipt.expected)
    : [];
  const inputKeys = input && typeof input === "object" ? Object.keys(input) : [];
  return receipt.ok === true
    && receipt.type === "f27_drill_replay_terminal"
    && receipt.f27_drill === true
    && receipt.f27_preflight === true
    && receipt.no_external_call === true
    && receipt.mutation === "f27DrillNoop"
    && receipt.issue_id === `${F27_DRILL_TEAM}:${rollbackId}`
    && expectedKeys.length === 1
    && expectedKeys[0] === "input"
    && inputKeys.length === 1
    && inputKeys[0] === "stateId"
    && input.stateId === F27_DRILL_TEAM
    && clean(receipt.rollback_id) === rollbackId
    && clean(receipt.outbox_id) === clean(row.id)
    && clean(receipt.correlation_id) === clean(replay.correlationId)
    && clean(receipt.dedup_key) === clean(row.dedup_key)
    && clean(receipt.operation) === clean(row.operation)
    && /^[0-9a-f]{64}$/.test(clean(receipt.intent_snapshot_sha256))
    && clean(receipt.intent_snapshot_sha256) === clean(replay.intentSnapshotSha256)
    && /^[0-9a-f]{64}$/.test(clean(receipt.linear_result_sha256));
}

export function bindF27LinearResult(result = {}, replay = null, row = {}) {
  if (!replay) return result;
  return {
    ...result,
    correlation_id: clean(replay.correlationId),
    rollback_id: clean(replay.rollbackId),
    outbox_id: String(row.id),
    dedup_key: clean(row.dedup_key),
    operation: clean(row.operation),
  };
}
