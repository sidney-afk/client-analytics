// Dormant native-creation transport. The SQL receipt/manifest is authority;
// the source header only selects this terminal branch, never grants access.
export const NATIVE_CARD_MAX_BYTES = 1048576;
const SOURCES = new Set(['submission-native', 'calendar-native', 'samples-native']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const HELD_REASONS = new Set([
  'invalid_body', 'source_outside_adapter', 'manifest_unresolved', 'manifest_identity_conflict',
  'admission_held', 'coverage_unproven', 'card_lifetime_unproven', 'receipt_conflict',
  'card_lifecycle_held', 'accepted_children_incomplete', 'card_insert_conflict',
  'accepted_parent_unproven', 'native_lifecycle_held', 'f27_held', 'card_plan_conflict',
  'creation_payload_conflict', 'receipt_identity_conflict', 'creation_provenance_unproven',
  'receipt_write_failed', 'boundary_failure',
]);
// These are nullable text/timestamp/UUID columns in the owned card schemas.
// Require a complete current row, but never compare human-editable content to
// the creation payload. SQL to_jsonb preserves legitimate NULLs on this path.
const COMMON_FIELDS = `updated_at order_index name asset_url thumbnail_url status linear_issue_id
graphic_linear_issue_id video_deliverable_id graphic_deliverable_id kasper_approved_at
video_status graphic_status video_tweaks graphic_tweaks client_video_approved_at
client_graphic_approved_at kasper_seen kasper_approved_after_tweaks thumb_rev
kasper_finished_at kasper_closed_at video_status_at graphic_status_at
video_urgent_pinged_at video_urgent_status_at video_urgent_issue video_urgent_editor`.split(/\s+/);
const SURFACE_FIELDS = {
  calendar: `scheduled_date caption caption_alt caption_alt_platform post_url cta tweaks posted_at
platform platforms color caption_status caption_tweaks client_caption_approved_at
title_status title_tweaks client_title_approved_at kasper_finish_log`.split(/\s+/),
  samples: ['creative_direction', 'hide_creative_direction', 'kasper_approved_by', 'created_at'],
};

export function nativeCardSource(req) {
  const source = req.headers.get('x-syncview-source');
  return SOURCES.has(source) ? source : null;
}

export function nativeCardUnretained(reason = 'invalid_body', status = 400) {
  return { status, body: { ok: false, outcome: 'refused', reason, conserved: false,
    error: 'Card creation was not sent to the store. Keep the original request for recovery.' } };
}

// Bounds bytes delivered to this handler, not an upstream proxy's original
// wire representation. Fatal decoding + preserved BOM never substitutes bytes.
export async function readNativeCardRequest(req) {
  let reader;
  let timer;
  let reason = 'invalid_body';
  let status = 400;
  try {
    const encoding = req.headers.get('content-encoding');
    if (encoding && encoding !== 'identity') return nativeCardUnretained('encoding_unsupported');
    reader = req.body?.getReader();
    if (!reader) return nativeCardUnretained();
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { reason = 'body_read_timeout'; status = 408; reject(new Error('timeout')); }, 10000);
    });
    const chunks = [];
    let size = 0;
    for (;;) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) throw new Error('invalid stream');
      size += part.value.byteLength;
      if (size > NATIVE_CARD_MAX_BYTES) {
        reason = 'body_too_large'; status = 413; throw new Error('limit');
      }
      chunks.push(part.value.slice());
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const rawText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const body = JSON.parse(rawText);
    if (!object(body)) throw new Error('invalid envelope');
    return { rawText, body };
  } catch (_error) {
    // Never await a hostile stream's cancellation promise or print body/errors.
    try { void reader?.cancel().catch(() => {}); } catch (_ignored) { /* closed stream */ }
    return nativeCardUnretained(reason, status);
  } finally {
    clearTimeout(timer);
    try { reader?.releaseLock(); } catch (_ignored) { /* pending read */ }
  }
}

export function nativeCardUnknown() {
  return { status: 503, body: { ok: false, outcome: 'unknown', conserved: null,
    error: 'Card creation could not be confirmed. Keep the original request; recovery must check its receipt.' } };
}

function completeCurrentRow(row, surface, client, cardId, original) {
  if (!object(row) || row.client !== client || row.id !== cardId) return false;
  for (const field of [...COMMON_FIELDS, ...SURFACE_FIELDS[surface]]) {
    if (!own(row, field) || (row[field] !== null && typeof row[field] !== 'string')) return false;
  }
  for (const field of ['video_deliverable_id', 'graphic_deliverable_id']) {
    if (typeof original[field] === 'string' && original[field] !== '' && row[field] !== original[field]) return false;
  }
  return true;
}

export async function materializeNativeCard({ supabase, surface, source, rawText, client, cardId }) {
  const key = surface === 'calendar' ? 'post' : surface === 'samples' ? 'sample' : null;
  let original;
  // Raw scope must be the SAME scope the unchanged handler authorization saw.
  // No normalized replacement body or generated fallback ID reaches this RPC.
  try {
    const parsed = JSON.parse(rawText);
    original = parsed?.[key];
    if (!key || !SOURCES.has(source) || !object(parsed) || parsed.client !== client ||
        typeof client !== 'string' || !client || !object(original) ||
        typeof cardId !== 'string' || !cardId || original.id !== cardId ||
        new TextEncoder().encode(rawText).byteLength > NATIVE_CARD_MAX_BYTES) return nativeCardUnretained('request_scope_invalid');
  } catch (_error) { return nativeCardUnretained(); }

  let reply;
  try {
    // Exactly one transport. An uncertain result NEVER falls through to the
    // legacy writer, tries another RPC, or reports accepted creation.
    reply = await supabase.rpc('production_card_materialize', {
      p_surface: surface, p_source: source, p_raw_body: rawText,
    });
  } catch (_error) { return nativeCardUnknown(); }
  if (!object(reply) || reply.error !== null || !object(reply.data)) return nativeCardUnknown();
  const result = reply.data;
  if (result.ok === false && result.outcome === 'held' && result.conserved === false &&
      result.reason === 'raw_body_unretained' && !own(result, 'ingress_id')) return nativeCardUnretained('raw_body_unretained', 413);
  if (result.conserved !== true || typeof result.ingress_id !== 'string' || !UUID.test(result.ingress_id)) return nativeCardUnknown();
  if (result.ok === false && result.outcome === 'held' && HELD_REASONS.has(result.reason)) {
    return { status: 409, body: { ok: false, outcome: 'held', reason: result.reason, conserved: true,
      error: 'Card creation is held. The request is retained for operator recovery; no card was acknowledged.' } };
  }
  if (result.ok !== true || !['created', 'replayed'].includes(result.outcome) ||
      !completeCurrentRow(result[key], surface, client, cardId, original)) return nativeCardUnknown();
  // The private ingress ID and any unexpected SQL metadata never leave here.
  return { status: 200, body: { ok: true, outcome: result.outcome, conserved: true, [key]: result[key] } };
}
