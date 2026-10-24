// Splits a list of ids for PostgREST `.in()` reads (OPEN_REPAIRS 484, session Beacon, 2026-10-24).
// Each `.in()` list travels in the request's URL, which the gateway refuses above about 16 kB. An admin with every
// client in scope reads about 650 posts at once, so a part is capped by its encoded size as well as by its count:
// each id is measured URL-encoded, plus 3 bytes for the encoded comma between ids.
export const IN_MAX_ITEMS = 200;
export const IN_MAX_BYTES = 6000;

export function chunkIds(list, maxItems = IN_MAX_ITEMS, maxBytes = IN_MAX_BYTES) {
  const out = [];
  let part = [], bytes = 0;
  for (const id of Array.isArray(list) ? list : []) {
    const size = encodeURIComponent(String(id)).length + 3;
    if (part.length && (part.length >= maxItems || bytes + size > maxBytes)) { out.push(part); part = []; bytes = 0; }
    part.push(id);
    bytes += size;
  }
  if (part.length) out.push(part);
  return out;
}
