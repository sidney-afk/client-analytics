// Pure policy for the per-client review token that "Share with client" links
// are built from. Kept free of Deno/Supabase dependencies so CI can exercise
// the two rules that matter, offline:
//
//   1. A stored token is NEVER overwritten. Rotating one silently 401s every
//      link the client already holds — the 2026-07-15 double-outage class
//      (AGENTS.md frozen-writer callout, ROLLBACK.md F35 row).
//   2. A client that has no token yet gets one minted in exactly the shape the
//      one-time B0 seeder used: 24 random bytes as 32 unpadded base64url
//      characters (`crypto.randomBytes(24).toString('base64url')`).
//
// Rule 2 exists because `public.client_access` rows have only ever been created
// by that one-time seed. Every client created afterwards — `lukecutting` on
// 2026-07-29 was the first — had a `clients` row and no token, so the share
// button failed closed with `review_token_missing` and no SMM could clear it.

const TOKEN_BYTES = 24;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32}$/;

export const REVIEW_TOKEN_BYTES = TOKEN_BYTES;

export function cleanReviewToken(value) {
  return String(value == null ? "" : value).trim();
}

export function encodeReviewToken(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);
  if (view.length !== TOKEN_BYTES) {
    throw new Error(`a review token needs exactly ${TOKEN_BYTES} random bytes`);
  }
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  // 24 bytes divide evenly into 32 base64 characters, so there is no padding
  // to strip — only the two URL-unsafe alphabet characters to swap.
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_");
}

export function mintReviewToken(randomBytes) {
  if (typeof randomBytes !== "function") {
    throw new Error("mintReviewToken needs a random-bytes source");
  }
  return encodeReviewToken(randomBytes(TOKEN_BYTES));
}

export function isReviewTokenShape(value) {
  return TOKEN_SHAPE.test(cleanReviewToken(value));
}

// What an issuer must do with whatever `client_access` currently holds for one
// already-authorized, active client. `row` is the stored row, or null when the
// client has never been provisioned.
//
//   reuse  — a token is stored; return it and write nothing.
//   mint   — no row exists; insert one.
//   repair — a row exists with a blank token; overwrite ONLY that blank value,
//            guarded on the exact blank it was read as, so a token written
//            between the read and the write is never lost.
export function reviewTokenAction(row) {
  if (!row) return { action: "mint", token: "", staleToken: null };
  const token = cleanReviewToken(row.review_token);
  if (token) return { action: "reuse", token, staleToken: null };
  return {
    action: "repair",
    token: "",
    staleToken: row.review_token == null ? null : String(row.review_token),
  };
}
