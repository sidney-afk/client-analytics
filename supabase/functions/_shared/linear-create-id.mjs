// One deterministic caller-supplied Linear issue UUID contract shared by the
// Production create gateway and the outbound drainer. Linear validates the
// value as UUIDv4-shaped; the remaining bits are stable across retries.

export const LINEAR_CREATE_UUID_NAMESPACE = "8ec6f2de-20f4-4dc3-8f21-8b3298e780db";

export async function deterministicLinearCreateId(dedupKey) {
  const key = String(dedupKey == null ? "" : dedupKey).trim();
  if (!key) throw new Error("create dedup key required");
  const namespace = LINEAR_CREATE_UUID_NAMESPACE.replace(/-/g, "").match(/.{2}/g) || [];
  const namespaceBytes = Uint8Array.from(namespace.map(part => parseInt(part, 16)));
  const keyBytes = new TextEncoder().encode(key);
  const input = new Uint8Array(namespaceBytes.length + keyBytes.length);
  input.set(namespaceBytes);
  input.set(keyBytes, namespaceBytes.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", input));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
