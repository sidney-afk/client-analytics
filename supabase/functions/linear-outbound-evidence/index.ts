// Supabase Edge Function: linear-outbound-evidence
//
// Read-only F98 credential observer for the Graphics F2 evidence lane. It uses
// the same project-level LINEAR_MIRROR_API_KEY as linear-outbound, performs one
// typed Linear viewer query, and returns only a correlation-bound hash receipt.
// It never reads or writes a SyncView table and never sends a Linear mutation.

type JsonMap = Record<string, unknown>;

const LINEAR_URL = "https://api.linear.app/graphql";
const RECEIPT_SCHEMA = "syncview.graphics-f2-linear-credential.v1";
const DISPATCH_SCHEMA = "syncview.graphics-f2-drainer-dispatch.v1";

function clean(value: unknown): string {
  return String(value == null ? "" : value).trim();
}

function json(body: JsonMap, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

function bearer(req: Request): string {
  return clean(req.headers.get("authorization")).replace(/^Bearer\s+/i, "");
}

function serviceRoleRequest(req: Request): boolean {
  const expected = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const supplied = bearer(req);
  return Boolean(expected && supplied && timingSafeEqual(expected, supplied));
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parseDispatch(value: unknown): JsonMap {
  const dispatch = value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonMap
    : {};
  const releaseSha = clean(dispatch.release_sha).toLowerCase();
  const workflowRunId = clean(dispatch.workflow_run_id);
  const workflowRunAttempt = clean(dispatch.workflow_run_attempt);
  const correlationId = clean(dispatch.correlation_id);
  const expectedCorrelation = `graphics-f2:${releaseSha}:${workflowRunId}:${workflowRunAttempt}`;
  if (dispatch.schema !== DISPATCH_SCHEMA
      || !/^[0-9a-f]{40}$/.test(releaseSha)
      || !/^[1-9][0-9]{0,19}$/.test(workflowRunId)
      || !/^[1-9][0-9]{0,9}$/.test(workflowRunAttempt)
      || correlationId !== expectedCorrelation) {
    throw new Error("invalid correlation dispatch");
  }
  return {
    release_sha: releaseSha,
    workflow_run_id: workflowRunId,
    workflow_run_attempt: workflowRunAttempt,
    correlation_id: correlationId,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!serviceRoleRequest(req)) return json({ ok: false, error: "forbidden" }, 403);

  let body: JsonMap;
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as JsonMap
      : {};
  } catch (_error) {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  let dispatch: JsonMap;
  try {
    dispatch = parseDispatch(body.dispatch);
  } catch (_error) {
    return json({ ok: false, error: "invalid_correlation_dispatch" }, 400);
  }

  const key = clean(Deno.env.get("LINEAR_MIRROR_API_KEY"));
  if (!key) return json({ ok: false, error: "linear_credential_unavailable" }, 503);

  try {
    const response = await fetch(LINEAR_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: key,
      },
      body: JSON.stringify({
        query: "query SyncViewGraphicsF2Credential { viewer { id } }",
        variables: {},
      }),
    });
    const payload = await response.json().catch(() => null) as JsonMap | null;
    const errors = payload && Array.isArray(payload.errors) ? payload.errors : [];
    const data = payload && payload.data && typeof payload.data === "object"
      ? payload.data as JsonMap
      : {};
    const viewer = data.viewer && typeof data.viewer === "object"
      ? data.viewer as JsonMap
      : {};
    const viewerId = clean(viewer.id);
    if (!response.ok || errors.length || !viewerId) {
      return json({ ok: false, error: "linear_credential_rejected" }, 502);
    }
    return json({
      ok: true,
      schema: RECEIPT_SCHEMA,
      receipt_type: "linear_graphql_viewer_accepted",
      accepted: true,
      correlation_id: dispatch.correlation_id,
      release_sha: dispatch.release_sha,
      workflow_run_id: dispatch.workflow_run_id,
      workflow_run_attempt: dispatch.workflow_run_attempt,
      viewer_identity_sha256: await sha256(viewerId),
      observed_at: new Date().toISOString(),
      mutation_attempted: false,
    });
  } catch (_error) {
    return json({ ok: false, error: "linear_credential_unavailable" }, 502);
  }
});
