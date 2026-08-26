'use strict';
/*
 * The Submit link must work for someone who is not staff and never will be.
 *
 * WHAT THIS FIXES (owner decision 2026-08-24). Clients and videographers use
 * the `?intake=1` link to send footage. From the 2026-08-14 full-roster
 * enrollment until this change, none of them could: transport is chosen by
 * ENROLLMENT rather than authority, so once every client was enrolled every
 * client took the native lane, which demanded staff sign-in — and intake mode
 * deliberately suppresses the staff dialog, so the visitor read
 * `Staff sign-in required.` with nothing to click. Ten days, every client, no
 * error anywhere: the submission simply could not be made.
 *
 * The fix opens exactly one operation on exactly one surface to a caller with
 * no credentials, and this suite exists to hold that boundary. Its job is not
 * to prove the happy path works — it is to prove the opening did not become
 * general. Four properties, each of which is a way this could have gone wrong:
 *
 *   1. SCOPE — the allowance is reachable ONLY from `intake_create` on the
 *      `submission` surface. No other handler can mint the public principal,
 *      because it is minted at that call site rather than inside `authenticate`.
 *   2. FAIL CLOSED — a missing flag, an unreadable flag, a malformed value, or
 *      an unreadable rate ledger all mean "refused". A public write path must
 *      never be opened by a database hiccup.
 *   3. NO UPGRADE — a caller who DID present a credential is judged on it. A
 *      `creative` staff key or a client review token is still refused; it can
 *      never fall through to the public path and gain what it lacked.
 *   4. MARKED AND BOUNDED — accepted work is stamped `public-intake` so it is
 *      identifiable and reversible, is capped below the authenticated limit,
 *      and is counted against a durable ledger rather than process memory.
 */
const fs = require('node:fs');
const path = require('node:path');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const ROOT = path.join(__dirname, '..');
const gateway = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'production-write', 'index.ts'), 'utf8');
const browser = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const migration = fs.readFileSync(path.join(ROOT, 'migrations', '2026-08-24-public-intake-log.sql'), 'utf8');

// ---- 1. SCOPE: minted at the intake call site, never inside authenticate ----
/* Bounded by authenticate's OWN final throw rather than by the next function:
 * the public-intake helpers now sit between it and `authorityFor`, so slicing
 * to the next declaration would swallow them and make this assertion pass for
 * the wrong reason. */
const authenticateStart = gateway.indexOf('async function authenticate(');
const authenticateEnd = gateway.indexOf('throw new GatewayError(401, "credentials_required");', authenticateStart);
ok(authenticateStart >= 0 && authenticateEnd > authenticateStart,
  'authenticate() is extractable and still ends on its credential refusal');
const authenticateBody = gateway.slice(authenticateStart, authenticateEnd);
ok(!/publicIntakePrincipal\(/.test(authenticateBody),
  'authenticate() never returns a public principal — every other handler that calls it stays closed');
ok(/throw new GatewayError\(401, "credentials_required"\);/
  .test(gateway.slice(authenticateEnd, authenticateEnd + 60)),
  'and it still ends by refusing a credential-less caller outright');
ok(/surface !== PUBLIC_INTAKE_SURFACE\) throw error;/.test(gateway),
  'the allowance is refused on any surface other than the submission surface');
ok(/const PUBLIC_INTAKE_SURFACE = "submission";/.test(gateway),
  'and that surface is the submission one');
const intakeCallSites = (gateway.match(/publicIntakePrincipal\(/g) || []).length;
ok(intakeCallSites === 2,
  `the public principal is constructed in exactly one place plus its definition (found ${intakeCallSites})`);

// ---- 2. FAIL CLOSED on every uncertain read ---------------------------------
const flagBody = gateway.slice(
  gateway.indexOf('async function publicIntakeEnabled('),
  gateway.indexOf('async function assertPublicIntakeWithinRate('),
);
ok(/if \(error \|\| !data\) return false;/.test(flagBody),
  'a missing or unreadable flag row means NOT enabled');
ok(/\.enabled === true;/.test(flagBody),
  'only the exact boolean true enables it — no truthy string, no numeric 1');
ok(/catch \(_error\) \{\s*return false;/.test(flagBody),
  'and any thrown error means NOT enabled');

const rateBody = gateway.slice(
  gateway.indexOf('async function assertPublicIntakeWithinRate('),
  gateway.indexOf('function publicIntakePrincipal('),
);
ok(/if \(error \|\| !Array\.isArray\(data\)\) throw new GatewayError\(503, "public_intake_rate_unavailable"\);/.test(rateBody),
  'an unreadable rate ledger REFUSES the submission rather than allowing it');
ok(/GatewayError\(429, "public_intake_rate_limited"\)/.test(rateBody),
  'and an exceeded limit refuses with a rate-limited code');
ok(/rows\.length >= PUBLIC_INTAKE_MAX_TOTAL/.test(rateBody)
  && /forClient >= PUBLIC_INTAKE_MAX_PER_CLIENT/.test(rateBody),
  'both a per-client and an overall ceiling are enforced, so one client cannot consume the whole budget');

// ---- 3. NO UPGRADE from a presented credential ------------------------------
ok(/const credentialless = error instanceof GatewayError\s*\n\s*&& error\.status === 401\s*\n\s*&& error\.code === "credentials_required";/.test(gateway),
  'only the credentials_required refusal falls through — an invalid or insufficient credential does not');
ok(/if \(!credentialless \|\| surface !== PUBLIC_INTAKE_SURFACE\) throw error;/.test(gateway),
  'anything else rethrows unchanged, so a creative key or client token keeps its own refusal');
ok(/if \(principal\.kind === "client" \|\| \(principal\.kind === "staff" && !\["admin", "smm"\]\.includes\(principal\.keyRole\)\)\) \{/.test(gateway),
  'and the pre-existing role check is still applied afterwards, unchanged');

// ---- 4. MARKED, CAPPED, COUNTED --------------------------------------------
ok(/actorKey: "public-intake"/.test(gateway),
  'accepted work is stamped public-intake, so it is identifiable and reversible in one query');
ok(/created_by: principal\.actorKey/.test(gateway),
  'and created_by is taken from the principal, so the stamp reaches the row without a special case');
/* The invariant is the RELATION, not either number. Pinning the literal 25
   meant that raising the cap to a real shoot size (2026-08-26, after a
   videographer hit twelve videos and was refused eleven times) failed a test
   that was never about 25 — while the thing actually worth protecting, that a
   credential-less caller can never ask for as much as an authenticated one,
   went unstated. */
const publicCap = Number((gateway.match(/const MAX_PUBLIC_INTAKE_ITEMS = (\d+);/) || [])[1]);
const authenticatedCap = Number((gateway.match(/const MAX_INTAKE_ITEMS = (\d+);/) || [])[1]);
ok(Number.isInteger(publicCap) && Number.isInteger(authenticatedCap),
  'both caps are findable (harness is not vacuous)');
ok(publicCap < authenticatedCap,
  'the public cap is LOWER than the authenticated cap (public ' + publicCap + ', authenticated ' + authenticatedCap + ')');
ok(/if \(items\.length > MAX_PUBLIC_INTAKE_ITEMS\) \{\s*\n\s*throw new GatewayError\(413, "public_intake_too_large"\);/.test(gateway),
  'and an oversized public submission is refused before anything is created');
ok(/from\("public_intake_log"\)\.insert\(/.test(gateway),
  'every accepted public submission writes a durable ledger row');
ok(gateway.indexOf('from("public_intake_log").insert(') < gateway.indexOf('async function handleIntakeCreate') + gateway.slice(gateway.indexOf('async function handleIntakeCreate')).indexOf('projectForIntake'),
  'and it is logged BEFORE the work is created, so a failed insert cannot be retried into an unbounded loop');

// ---- The migration keeps the ledger private and the flag off ----------------
ok(/revoke all on public\.public_intake_log from anon;/.test(migration)
  && /revoke all on public\.public_intake_log from authenticated;/.test(migration),
  'the rate ledger is service-role only — anon can neither read who is submitting nor exhaust a rival client');
ok(/enable row level security/.test(migration), 'and RLS is on');
ok(/'\{"enabled": false\}'::jsonb/.test(migration),
  'the flag ships OFF, so merging this changes nothing until the owner turns it on');
ok(/on conflict \(key\) do nothing/.test(migration),
  'and re-running the migration never re-opens a flag the owner has since closed');
ok(/created_at timestamptz not null default now\(\)/.test(migration),
  'the ledger clock is server-set, never caller-supplied — the whole limit depends on it');

// ---- The browser half: no staff demand on the client link -------------------
ok(/if \(!\(typeof _isIntake !== 'undefined' && _isIntake\)\) \{\s*\n\s*try \{ identity = await _syncviewRequireStaffIdentity\('intake'\); \}/.test(browser),
  'the client link no longer demands a staff identity, and the staff tab still does');
ok(/if \(typeof _isIntake !== 'undefined' && _isIntake\) return null;/.test(browser),
  'the resume-time actor binding also steps aside on the client link, where it could only ever throw');
ok(/typeof _isIntake !== 'undefined'/.test(browser),
  'both checks read the flag defensively, so an uninitialised value resolves to the STRICT staff path');
for (const code of ['public_intake_too_large', 'public_intake_rate_limited', 'public_intake_rate_unavailable']) {
  ok(new RegExp(code + ':\\s*\\{').test(browser), `${code} has purpose-written copy for a non-staff reader`);
}

if (failures) {
  console.error(`\n${failures} public-intake check(s) failed`);
  process.exit(1);
}
console.log('\npublic intake open-submission checks passed');
