// Filming pipeline passes: the parts both functions share. Plain JavaScript
// with no Deno parts, so a unit test can run it.
//
// higgsfield-mcp's "pipeline_pass" tool makes a pass (newPassToken), stores
// only its SHA-256 (passHash) in fp_passes, and shows the token once.
// pipeline-google hashes the x-pipeline-pass header the same way to find it.

export const PASS_HOURS = 6;
export const PASS_HEADER = "x-pipeline-pass";
export const PASS_ENV = "PIPELINE_PASS";
export const TARGETS = ["test", "client"];

// "fpp_" plus 32 random bytes as hex: 256 bits, easy to spot in a leak scan.
export const PASS_RE = /^fpp_[0-9a-f]{64}$/;

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export function newPassToken() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return "fpp_" + hex(bytes);
}

export function isPassToken(raw) {
  return typeof raw === "string" && PASS_RE.test(raw);
}

// SHA-256 of the whole token, lowercase hex. The table never holds the token.
export async function passHash(token) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(token)));
  return hex(new Uint8Array(digest));
}

export function passTarget(raw) {
  const t = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return TARGETS.includes(t) ? t : null;
}

// A row from fp_pass_use (or fp_passes) is usable only before expires_at.
// The database refuses an expired pass too; this is the same rule for code
// that holds a row.
export function passExpired(row, now = Date.now()) {
  const until = Date.parse(String(row && row.expires_at));
  return !Number.isFinite(until) || until <= now;
}

// Who may have which pass. A shared team link's first name is self-declared,
// so it only ever gets "test". A real client file needs a personal link whose
// member is on the publish list (fp_publishers).
export function passDecision({ teamLink, target, isPublisher }) {
  const t = passTarget(target);
  if (!t) return { ok: false, text: 'Give target: "test" (the TEST Sheet and the client\'s test Doc) or "client" (the client\'s real ideas Sheet and filming plan Doc).' };
  const via = teamLink ? "team" : "personal";
  if (t === "test") return { ok: true, via, target: t };
  if (teamLink) {
    return { ok: false, text: "Refused: a pass for a client's real files needs your personal connector link. The shared team link can only get a test pass (target \"test\")." };
  }
  if (!isPublisher) {
    return { ok: false, text: "Refused: you are not on the list of people who may publish to a client's real files. Use target \"test\", or ask the account owner to add you." };
  }
  return { ok: true, via, target: t };
}

// The answer pipeline_pass gives. The token appears here and nowhere else.
export function passReply({ clientName, target, token, expiresAt }) {
  const where = target === "client"
    ? "the client's real ideas Sheet and filming plan Doc (new tabs only)"
    : "the TEST Sheet and this client's test Doc (new tabs only)";
  return [
    `Pipeline pass for ${clientName}, target ${target}: it writes to ${where} and reads this client's own files.`,
    `Valid until ${new Date(expiresAt).toISOString().replace(/\.\d{3}Z$/, "Z")} (${PASS_HOURS} hours). It is shown only this once.`,
    "",
    `${PASS_ENV}=${token}`,
    "",
    `How the pipeline uses it: set it as the environment variable ${PASS_ENV} for this run only (for example "export ${PASS_ENV}=..." in the terminal that runs the pipeline); the pipeline sends it to Google through pipeline-google in the ${PASS_HEADER} header. Never save it in a file, a commit, a note or a summary, and do not repeat it back in the chat. When it runs out, ask for a new one.`,
  ].join("\n");
}
