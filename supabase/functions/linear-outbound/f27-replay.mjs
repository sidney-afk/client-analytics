function clean(value) {
  return String(value == null ? "" : value).trim();
}

export function f27ReplayRequest(body = {}) {
  const rollbackId = clean(body.rollback_id);
  const dedupKey = clean(body.target_dedup_key);
  const enabled = rollbackId || clean(body.confirm) === "F27_ROLLBACK_REPLAY";
  if (!enabled) return null;
  if (!rollbackId || !dedupKey || clean(body.confirm) !== "F27_ROLLBACK_REPLAY") {
    throw new Error("invalid F27 replay request");
  }
  return { rollbackId, dedupKey };
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
