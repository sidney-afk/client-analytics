# Retained Workload provider endpoint admission

**SOURCE_ONLY, uninstalled.** Based on exact candidate
`b60a9705492002830eed60ece874e0686fc4b538`. This is a staged adapter under
[G8](../ops/LINEAR_OUTBOUND_CUTOFF.md), not whole-provider retirement or G5/G8
closure. No merge, deploy, SQL execution, live/TEST write, flag, credential,
n8n, scheduler, billing, alert or frozen anonymous-authentication change.

## Corrected boundary

The old `workload-linear` metadata handler still reaches Linear after staff and
mirror validation. Its deadline handler queried the provider's current team
before refusing native authority. Both are reproduced on the exact base by
`test/workload-linear-cutoff.js`.

`supabase/functions/workload-linear/index.ts` now calls
`requireProviderAdmission` from its sole `linearRequest` transport. Each
metadata batch, team lookup and deadline mutation reads the existing
`linear_outbound_cutoff_control` row for exact lane `mirror_outbox`, validates
the lane, nonnegative safe-integer generation and boolean cutoff, and admits
only an explicit inactive control. Missing/unreadable/malformed control gives
503 `linear_cutoff_control_unavailable`; active control gives 410
`workload_linear_retired` with an honest refresh/contact-administrator message.
Metadata propagates either refusal for the whole request without visiting later
batches or manufacturing a partial success. Ordinary provider read failures
retain their prior incomplete receipt while admission is open.

The writer first rejects native or unknown mirrored-team authority before any
provider team lookup. It still validates the provider's exact current team,
refuses moved teams, rechecks authority afterwards and independently checks
cutoff before mutation. Confirmed commits retain the existing successful
receipt even when best-effort mirror refresh fails. Open-control CON/STR
metadata remains compatible; their unsupported deadline writes remain refused.

## Evidence and limits

`node test/workload-linear-cutoff.js`: **58 checks PASS**, actual complete
request handler and actual shared staff/browser authorization with synthetic
SDK and provider transports; zero external network requests. No extracted or
substituted product functions. Includes missing/malformed/closed controls,
transport errors, cutoff between metadata batches and team-read/mutation,
native/unknown authority before lookup, authority changes after lookup, exact
team movement, role refusals, preserved CON/STR reads, open legacy writes,
mirror failure, exact-base counterexamples and removed-admission negative
control. The already admitted single metadata read is deliberately allowed to
finish after activation: the test preserves that limit.

Existing `workload-linear-source`, `workload-linear-policy` and
`workload-linear-browser` suites pass. These are offline/model-boundary checks,
not PostgreSQL, Deno, browser serving, installed-source or live-client proof.
No broad suite was run.

Source SHA-256: `465a38d5a4f5032c25712406534ed738d38009fe62dbb1c0c79a7ddaed5fa5fc`.
Test SHA-256: `79f80469d84e710aa80d2d9fd4692a3670e05632d57badb4a4e746fb258c966d`.

## Installation, stopping and recovery

1. The existing `2026-09-06-linear-outbound-cutoff.sql` owns this row and its
   service-only SELECT grant. Its outbox authorization RPC requires a durable
   outbox ID, lease and generation; direct Workload traffic has none. This
   adapter therefore observes the same existing cutoff and does not forge
   an outbox authorization/receipt or add another flag/SQL owner.
2. Installation remains held on G8's existing SQL review, compatible recovery
   extension, exact migration/worker release and readback requirements. Deploying
   this handler without that control/grant intentionally stops legacy metadata
   and provider writes with 503. Do not deploy it alone to test availability.
3. Before an authorized release, capture the exact prior Workload source/JWT
   closure and verify the required installed control/grants with service role.
   Use the deliberate-manual `workload-linear` deployment contract in
   `EF_DEPLOY_MANIFEST.md`; retain existing JWT/auth configuration. Verify the
   deployed complete source closure and then conduct owner-designated staff
   canaries. None of those release steps ran here.
4. Before activation, classify CON/STR and any provider-authority staff work
   and prove their replacement/held-work continuity. Active cutoff intentionally
   stops every transport in this endpoint; this source does not provide native
   CON/STR replacement, update old browser messaging, or retire other endpoints.
5. The database read is an admission observation, not an atomic external-network
   cancellation or durable dispatch authorization. A successful read can precede
   activation while its fetch starts/completes later. Old isolates remain
   unfenced. Stopping/quiescing old/new isolates and independent egress observation
   are required before any no-egress claim. Direct provider-write outcomes lost
   after pre-cutoff admission still need reconciliation; this change creates no
   durable debt/unknown-outcome journal for them.
6. Before use, withdrawing this isolated source changes no installed data.
   Before cutoff activation, restoring an exact captured old closure restores
   its old provider behavior, including its known gaps. After activation, keep
   this admission fence or stop the endpoint and repair forward; never restore
   the unfenced handler or disable/delete/reset control merely to restore staff
   availability. Preserve provider outcome evidence and existing mirrored/native
   work. The G8 recovery/debt and authority contracts continue to govern release.
