// Pure logic for the filming-plan-docs-write Edge Function. No Deno or network
// APIs here so test/filming-plan-docs-write-source.js can run it under Node.
//
// It replaces the n8n webhook `filming-plan-docs-update`, which passed any
// `requests` array to Google Docs documents.batchUpdate for any Doc id, with no
// sign-in. This keeps the same body ({ documentId, requests }) and adds the
// checks the n8n flow never had: a valid Doc id, only the request kinds the
// filming plan pipeline sends, a size cap, and a Doc we own.

export const DOC_ID_RE = /^[A-Za-z0-9_-]{20,100}$/;
export const MAX_REQUESTS = 3000;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

// The kinds filming_plan_write_doc.py builds today. Anything else (for example
// deleteContentRange, which could blank a Doc) is refused, not passed on.
export const ALLOWED_REQUEST_KINDS = [
  "insertText",
  "updateParagraphStyle",
  "updateTextStyle",
  "replaceAllText",
];

const clean = (v) => String(v == null ? "" : v).trim();

export function parseWriteBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "invalid_body" };
  const documentId = clean(body.documentId);
  if (!documentId) return { error: "document_required" };
  if (!DOC_ID_RE.test(documentId)) return { error: "invalid_doc_id" };
  const requests = body.requests;
  if (!Array.isArray(requests) || !requests.length) return { error: "requests_required" };
  if (requests.length > MAX_REQUESTS) return { error: "too_many_requests" };
  for (const r of requests) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return { error: "invalid_request" };
    const keys = Object.keys(r);
    if (keys.length !== 1) return { error: "invalid_request" };
    if (!ALLOWED_REQUEST_KINDS.includes(keys[0])) return { error: "request_kind_not_allowed", kind: keys[0] };
  }
  return { documentId, requests };
}

// extraIds is the comma separated FILMING_PLAN_WRITE_EXTRA_DOC_IDS secret, for
// pipeline test Docs that are not a client's registered filming plan.
export function parseExtraDocIds(raw) {
  return clean(raw).split(",").map(clean).filter((id) => DOC_ID_RE.test(id));
}

export function isOwnedDoc(documentId, registeredIds, extraIds) {
  return registeredIds.includes(documentId) || extraIds.includes(documentId);
}
