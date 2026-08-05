export const COMPLETE_THREAD_MAX_ROWS = 1_000;

function clean(value) {
  return String(value == null ? "" : value).trim();
}

export function isStatementTimeout(error) {
  return clean(error && error.code) === "57014";
}

export async function readWithStatementTimeoutRetry(run, completeRead) {
  const first = await run();
  if (!completeRead || !first || !isStatementTimeout(first.error)) {
    return { result: first, retry_count: 0 };
  }
  return { result: await run(), retry_count: 1 };
}

export function completeThreadVerdict(total, rows, maxRows = COMPLETE_THREAD_MAX_ROWS) {
  if (!Number.isSafeInteger(total) || total < 0 || !Array.isArray(rows)) {
    return { ok: false, status: 503, error: "canonical_thread_incomplete" };
  }
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || total > maxRows) {
    return { ok: false, status: 409, error: "canonical_thread_overflow" };
  }
  if (rows.length !== total) {
    return { ok: false, status: 503, error: "canonical_thread_incomplete" };
  }
  const ids = rows.map(row => clean(row && row.id));
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) {
    return { ok: false, status: 503, error: "canonical_thread_incomplete" };
  }
  return { ok: true, status: 200, error: "", total };
}
