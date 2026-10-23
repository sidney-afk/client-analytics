// Width and height of an image, read from the first bytes of PNG, JPEG, GIF and
// WebP files (null when the bytes are not one of those or too short). Used to
// price video models whose output follows the shape of the source image.
export function imageSize(b) {
  if (!b || b.length < 24) return null;
  const u16 = (i) => (b[i] << 8) | b[i + 1];
  const le16 = (i) => b[i] | (b[i + 1] << 8);
  const ok = (w, h) => (w > 0 && h > 0 ? { w, h } : null);
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return ok(((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0, ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0);
  }
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return ok(le16(6), le16(8));
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = u16(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return ok(u16(i + 7), u16(i + 5));
      i += 2 + len;
    }
    return null;
  }
  const tag = (i, s) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (tag(0, "RIFF") && tag(8, "WEBP") && b.length >= 30) {
    if (tag(12, "VP8X")) return ok(1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16)));
    if (tag(12, "VP8L")) { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return ok((v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1); }
    if (tag(12, "VP8 ")) return ok(le16(26) & 0x3fff, le16(28) & 0x3fff);
  }
  return null;
}
