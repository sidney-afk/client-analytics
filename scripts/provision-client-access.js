'use strict';
/*
 * Provision the missing per-client review tokens in `public.client_access`.
 *
 * Why this exists: those rows have only ever been created by the one-time
 * 2026-07-05/06 B0 seed (`scripts/b0-seed-auth-scaffold.js`). Nothing has
 * created one since, so every client onboarded after that seed reaches the
 * SMM's "Share with client" button with no token, and `client-review-link`
 * fails closed with `review_token_missing`. This tool closes that gap for the
 * clients that already exist; `client-review-link` provisions on demand from
 * then on, and the trigger in
 * `migrations/2026-08-04-client-access-auto-provision.sql` does it at client
 * creation once applied.
 *
 * Report what is missing (default — reads only, writes nothing):
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/provision-client-access.js
 *
 * Same read, but exit non-zero when any active client lacks a token (use this
 * as an onboarding/ops gate):
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/provision-client-access.js --check
 *
 * Mint the missing tokens:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/provision-client-access.js --apply
 *
 * This tool can only ever ADD a missing row. Every write goes through
 * `Prefer: resolution=ignore-duplicates` (ON CONFLICT DO NOTHING), so a stored
 * token cannot be rotated by it — rotating one silently 401s every link the
 * client already holds (ROLLBACK.md F35). There is deliberately no --rotate.
 * It never prints a token value.
 */

const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const SUPA_URL = process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLICY = path.join(
  __dirname,
  '..',
  'supabase',
  'functions',
  '_shared',
  'client-review-token-policy.mjs',
);

const ARGS = process.argv.slice(2);
const KNOWN = new Set(['--apply', '--check']);
const APPLY = ARGS.includes('--apply');
const CHECK = ARGS.includes('--check');

function fail(message) {
  console.error('provision-client-access failed:', message);
  process.exit(1);
}

function headers(extra) {
  return Object.assign({
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }, extra || {});
}

async function rest(pathname, options) {
  const resp = await fetch(`${SUPA_URL}/rest/v1/${pathname}`, Object.assign({ headers: headers() }, options || {}));
  const text = await resp.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (_error) { body = text; }
  if (!resp.ok) {
    throw new Error(`${pathname} HTTP ${resp.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }
  return body;
}

// The clients that must be able to receive a share link: active, and not the
// internal bookkeeping rows the B0 seeder also skipped.
async function eligibleClients() {
  return rest('clients?select=slug,display_name&active=is.true&kind=neq.internal&order=slug.asc');
}

async function provisionedSlugs() {
  const rows = await rest('client_access?select=slug');
  return new Set((rows || []).map(row => String(row.slug || '')));
}

async function insertMissing(rows) {
  if (!rows.length) return;
  // resolution=ignore-duplicates is ON CONFLICT DO NOTHING: this request cannot
  // overwrite a token that already exists, whoever wrote it and whenever.
  await rest('client_access?on_conflict=slug', {
    method: 'POST',
    headers: headers({ Prefer: 'resolution=ignore-duplicates,return=minimal' }),
    body: JSON.stringify(rows),
  });
}

async function main() {
  for (const arg of ARGS) {
    if (!KNOWN.has(arg)) fail(`unexpected argument: ${arg} (use --apply or --check)`);
  }
  if (APPLY && CHECK) fail('--apply and --check are mutually exclusive');
  if (!SERVICE_KEY) fail('SUPABASE_SERVICE_ROLE_KEY is required (client_access is service-role-only)');

  const { mintReviewToken } = await import(pathToFileURL(POLICY).href);
  const clients = await eligibleClients();
  const provisioned = await provisionedSlugs();
  const missing = clients.filter(client => !provisioned.has(String(client.slug || '')));

  console.log(JSON.stringify({
    mode: APPLY ? 'apply' : (CHECK ? 'check' : 'report'),
    eligible_clients: clients.length,
    already_provisioned: clients.length - missing.length,
    missing_token: missing.length,
    // Slugs, never tokens. These are already anon-readable from `clients`.
    missing_slugs: missing.map(client => client.slug),
  }, null, 2));

  if (!missing.length) {
    console.log('Every active client has a review token.');
    return;
  }

  if (!APPLY) {
    console.log('Re-run with --apply to mint the missing tokens.');
    if (CHECK) process.exitCode = 1;
    return;
  }

  const stamp = new Date().toISOString();
  await insertMissing(missing.map(client => ({
    slug: client.slug,
    review_token: mintReviewToken(length => crypto.randomBytes(length)),
    token_rotated_at: stamp,
    notes: 'Provisioned by scripts/provision-client-access.js',
  })));

  // Independent readback: trust the database, not the request that just ran.
  const after = await provisionedSlugs();
  const stillMissing = clients.filter(client => !after.has(String(client.slug || '')));
  console.log(JSON.stringify({
    ok: stillMissing.length === 0,
    tokens_minted: missing.length - stillMissing.length,
    still_missing: stillMissing.map(client => client.slug),
  }, null, 2));
  if (stillMissing.length) fail(`${stillMissing.length} active client(s) still have no review token`);
}

main().catch(error => fail(error && error.message ? error.message : String(error)));
