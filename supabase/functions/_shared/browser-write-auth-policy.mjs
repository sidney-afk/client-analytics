// Pure policy helpers for the six browser-callable service-role writers.
// Kept free of Deno/Supabase dependencies so CI can exercise credential
// selection, client canonicalization, and server-derived attribution.

export function cleanWriteAuthValue(value) {
  return String(value == null ? "" : value).trim();
}

export function normalizeWriteClient(value) {
  let text = cleanWriteAuthValue(value).toLowerCase();
  try {
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (_error) {
    // Exact ASCII slugs remain usable if normalization is unavailable.
  }
  text = text.replace(/^dr\.?\s+/, "");
  text = text.replace(/\s+(?:and|&)\s+/g, "&");
  return text.replace(/[^a-z0-9&]+/g, "");
}

export function browserWriteCredentialMode(staffKey, clientToken) {
  const hasStaffKey = !!cleanWriteAuthValue(staffKey);
  const hasClientToken = !!cleanWriteAuthValue(clientToken);
  if (hasStaffKey && hasClientToken) return "ambiguous";
  if (hasStaffKey) return "staff";
  if (hasClientToken) return "client";
  return "missing";
}

function safeSurface(value) {
  return cleanWriteAuthValue(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "").slice(0, 80) || "browser-write";
}

export function staffWriteAttribution(role, surface) {
  const safeRole = cleanWriteAuthValue(role).toLowerCase();
  if (!["admin", "smm", "creative"].includes(safeRole)) return null;
  return {
    kind: "staff",
    actor: `staff:${safeRole}`,
    role: safeRole,
    source: safeSurface(surface),
  };
}

export function automationWriteAttribution(surface) {
  return {
    kind: "staff",
    actor: "staff:automation",
    role: "automation",
    source: safeSurface(surface),
  };
}

export function clientWriteAttribution(clientSlug, surface) {
  const slug = normalizeWriteClient(clientSlug);
  if (!slug) return null;
  return {
    kind: "client",
    actor: `client:${slug}`,
    role: "client",
    source: safeSurface(surface),
  };
}

export function uniqueClientTokenSlug(rows, presentedToken, equal) {
  const token = cleanWriteAuthValue(presentedToken);
  if (!token || !Array.isArray(rows) || typeof equal !== "function") return "";
  const matches = rows.filter((candidate) => {
    const stored = cleanWriteAuthValue(candidate && candidate.review_token);
    return !!stored && equal(token, stored);
  });
  return matches.length === 1 ? normalizeWriteClient(matches[0] && matches[0].slug) : "";
}
