// Shared staff role-key resolution for browser-callable Edge Functions.
//
// Authorization comes only from the secret that matches X-Syncview-Key. Caller-
// supplied actor/role headers remain attribution metadata and must never elevate
// access. Legacy per-surface secrets can be supplied during the transition so a
// role-key rollout cannot lock out an existing caller.

const TEXT = new TextEncoder();

export type StaffRoleKey = "admin" | "smm" | "creative";
export type StaffKeyAuthorization = {
  ok: boolean;
  role: StaffRoleKey | null;
  via: "role" | "legacy" | "none";
};

type SecretReader = (name: string) => string | undefined;

const ROLE_SECRET_NAMES: ReadonlyArray<[StaffRoleKey, string]> = [
  ["admin", "ROLE_KEY_ADMIN"],
  ["smm", "ROLE_KEY_SMM"],
  ["creative", "ROLE_KEY_CREATIVE"],
];

function edgeSecret(name: string): string | undefined {
  return Deno.env.get(name);
}

export function timingSafeEqual(a: string, b: string): boolean {
  const aa = TEXT.encode(a || "");
  const bb = TEXT.encode(b || "");
  let diff = aa.length ^ bb.length;
  const max = Math.max(aa.length, bb.length);
  for (let i = 0; i < max; i++) diff |= (aa[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}

export function matchingRoleForKey(
  key: string,
  getSecret: SecretReader = edgeSecret,
): StaffRoleKey | null {
  let matched: StaffRoleKey | null = null;
  for (const [role, secretName] of ROLE_SECRET_NAMES) {
    const secret = getSecret(secretName);
    // Compare every configured role secret, while retaining key-verify's
    // admin -> smm -> creative precedence if secrets were ever duplicated.
    const isMatch = !!secret && timingSafeEqual(key, secret);
    if (!matched && isMatch) matched = role;
  }
  return matched;
}

export function authorizeStaffKey(
  key: string,
  allowedRoles: readonly StaffRoleKey[],
  legacySecrets: ReadonlyArray<string | null | undefined> = [],
  getSecret: SecretReader = edgeSecret,
): StaffKeyAuthorization {
  const role = matchingRoleForKey(key, getSecret);
  let legacyMatch = false;
  for (const secret of legacySecrets) {
    if (secret && timingSafeEqual(key, secret)) legacyMatch = true;
  }

  // A recognized role key always owns the decision, even if an operator has
  // accidentally configured the same value as a legacy surface secret. This
  // keeps the explicit role matrix authoritative and prevents a disallowed role
  // from being reclassified as legacy compatibility.
  if (role) {
    return allowedRoles.includes(role)
      ? { ok: true, role, via: "role" }
      : { ok: false, role, via: "role" };
  }
  if (legacyMatch) return { ok: true, role: null, via: "legacy" };
  return { ok: false, role: null, via: "none" };
}

export function staffAuthFailureStatus(auth: StaffKeyAuthorization): 401 | 403 {
  // A matched role key authenticated the caller even when that role cannot use
  // this surface. Reserve 401 for keys that match neither a role nor a legacy
  // compatibility secret, so a normal role denial cannot invalidate a valid
  // signed-in identity in the browser.
  return auth.role ? 403 : 401;
}
