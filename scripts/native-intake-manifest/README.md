# Root manifest proof

The native assignee slice adds `node test/native-assignee-eligibility.js`
(same opt-in and loopback rules) driving `assignee-lane.mjs`: the real handler's
explicit/automatic assignment journeys on both lanes with the provider transport
denied, a `fault-shim.mjs` wrapper so one flag read can fail at the handler, and
a second fresh-database run against the exact PR1302 head as a negative control.
The tracked entry point is `test/native-assignee-eligibility.js`.

The earlier disabled-native slice described `node test/native-only-intake.js`,
but that test file is absent from this checkout. `native-only-lane.mjs` has no
tracked launcher here; do not treat the old command as available proof.

Run `node test/native-intake-manifest.js` with
`INTAKE_MANIFEST_REQUIRE_POSTGRES=1` and an explicitly disposable PostgreSQL 16
on `PGHOST=127.0.0.1` / `PGPORT` / `PGUSER` (or F42_REHEARSAL equivalents).
CI already requires its disposable service with `F63_REQUIRE_POSTGRES=1`.
The runner creates/drops only its own `f42_rehearsal_<pid>` database. It rejects
non-loopback hosts. It must execute, not skip, for this PR's acceptance.

`harness.js` and `supabase-shim.mjs` are byte copies from PR1274 commit
`7d2812ac60358b3e73e26de2622cc2d25b90bb90`, under a separate namespace so that
historical proof remains intact. The loader and fictional payload builder in
`gateway-lane.mjs` are adapted from the same commit. The historical 63 current
checks / 13 readiness failures are not this suite's results.

The migration chain invokes the shared F42 foundation, actual intake writer
migrations, and the new root manifest migration with function-body checking.
Only Supabase transport, Deno entry/env and provider fetch are replaced; gateway
business logic and transitive policy imports execute from the current checkout.
No schemas or business rules are cloned in assertions. SQL role tests explicitly
cover the translator's privileged-session limitation. Logs contain labels/counts
only. No production credentials, URLs, payloads or installed-state claims.

See `test/native-intake-manifest.js` for the current test entry and
`docs/audits/2026-09-26-native-intake-manifest-callers.md` for its caller map.
