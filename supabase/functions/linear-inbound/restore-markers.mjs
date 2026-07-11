const ARCHIVE_MARKERS = new Set([
  "archived",
  "webhook_delete",
  "deleted",
  "delete",
  "removed",
]);

function withoutArchiveMarkers(value) {
  if (Array.isArray(value)) return value.map(withoutArchiveMarkers);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (!ARCHIVE_MARKERS.has(key)) out[key] = withoutArchiveMarkers(child);
  }
  return out;
}

export function clearArchiveMarkers(raw) {
  const restored = withoutArchiveMarkers(raw);
  if (restored.issue && typeof restored.issue === "object" && !Array.isArray(restored.issue)) {
    restored.issue.archivedAt = null;
  }
  return restored;
}
