# Calendar and Samples read boundary — Warden, 2026-10-02

Prepared, not installed. Nothing was deployed, switched, or applied live. No live
client rows were mutated. #1691 is merged; this PR implements its owner-narrowed
next step, leaving Workload and Production readable.

## What changes

Missing `card_reads_source`, an unknown value, or `{"mode":"public"}` keeps
today's read transport. `{"mode":"function"}` sends Calendar and Samples GETs
to `card-read`. Staff use their existing role key; a client link uses its current
token and must name exactly its own active client. Missing, invalid, ambiguous,
inactive or revoked credentials refuse before card reads. No caller role header
or permissive auth flag grants access. No JWT signing secret is needed.

The service reads only these two tables. Selects cannot embed joins. Client
equality remains outside OR filters and compound `(id, client)` pagination.
Errors never become successful empty lists or a public-key fallback. Cache,
skeleton, abort, source-repair and save behaviour remain owned by the same
existing callers. The golden client request fixture is unchanged.

In function mode, card realtime subscriptions become 30-second visible-tab
background reads through the same function. Existing draft, save, route and
client guards apply. Returning to a tab retains its existing catch-up. This
adds at most 30 seconds of refresh delay; it does not remove manual refresh.
Reload open pages when changing the flag. Today retains its saved copy and
skeleton, but defers the speculative head-script card read to its normal loader
so it can use the flag and staff credential.

## Counts-only live grant measurement

Read-only catalog queries on 2026-10-02 reproduced the ten-table 2026-09-29 set:
`calendar_post_events`, `caption_prompts`, `clients`, `flag_flips`,
`sample_review_events`, `syncview_runtime_flags`, `team_members`, `templates`,
`thumbnail_media_revisions`, `workload_issues`.

Each table still has three of the requested write privileges for **anon**, three
for **authenticated**, three for **service_role**, and zero for **PUBLIC**.
There are zero browser write policies. Each revoke explicitly names
`PUBLIC, anon, authenticated, service_role`; only the measured server INSERT,
UPDATE and TRUNCATE privileges are granted back. Other privileges are untouched.
`team_members` has 11 column ACLs; its restricted read grants stay intact.

The two card tables have SELECT for anon, authenticated and service_role, zero
PUBLIC grants and zero column ACLs. Phase 2 revokes SELECT from all four named
roles and restores SELECT only to service_role. It changes no policies, views,
other reads, client rows, writers or defaults. The original broad 2026-09-26
scoped-read proposal is **not** this release's install or rollback.

The Workload exception is treated as preserving reads: its three write grants
are in the ten-table removal, while its SELECT and policies stay as measured.
`workload_issues_native_v1` and `production_deliverables_browser_v1` have no SQL,
transport or policy change. The throwaway proof checks their read ACLs and reads.

## Every page read moved

| Read owner | Transport change | Loading and saved copy |
| --- | --- | --- |
| Calendar, import verification, source-repair reads, Kasper calendar queue/history | Shared `_calSupabaseFetchAllRows`; identical URL filters and keyset loop | Existing Calendar/Kasper loaders, renders and caches |
| Samples and Kasper Samples queue | Existing alias `_sxrSupabaseFetchAllRows` uses the shared reader | Existing Samples/Kasper loaders, renders and caches |
| Today's cards | `_tdyRest` routes only card requests; other relations stay direct | Existing per-person cache, skeleton, error state |
| Calendar/Samples archive list | `_arxRest` routes only cards; event lookups stay direct | Existing loading state and prior list on read failure |
| Fresh save stamps, urgent round read, persisted-status checks, client send-queue confirmation | Existing read-only helper calls use `_cardReadFetch` | Existing null/refusal handling and held source copy; writer bodies unchanged |

Two independent searches reconciled literal table mentions with `/rest/v1/`,
`SXR_TABLE`, shared fetch aliases and `postgres_changes` sites. Both card tables'
browser reads, including the early Today prefetch, are accounted for above.

## Owner release steps — later, with a separate go

1. Lighthouse reviews and merges this one PR. Its page defaults to public reads.
2. Deploy **card-read only**, using the exact merged main SHA in
   [Deploy one allowlisted Edge Function](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-single-function.yml).
   It uses the existing server Supabase secrets and staff role keys. Never
   deploy the frozen Calendar or Sample Review writers from this release.
3. Verify staff and the privately configured test client's current token against
   the function; verify wrong-client, missing-token and revoked-token refusals.
   Keep production mutations limited to the designated test client. Before
   switching all readers, ensure existing real client links have current tokens.
4. Separately authorize setting `card_reads_source` to `{"mode":"function"}`
   and reload readers. Check Calendar, Samples, Today, Kasper, archived lists,
   slow loads, saved-copy refresh failures and both client review actions.
5. Only after successful reader measurement, separately authorize applying
   `migrations/20261002201230_warden_card_reads.sql`. It refuses if the function
   flag is not on or unexpected column grants exist. The write-only
   `migrations/20261002201231_warden_browser_write_grants.sql` is independent;
   remeasure before its separately authorized installation. Read back grants.

**One-step way back:** run
`migrations/20261002201230_warden_card_reads.ROLLBACK.sql` once. One transaction
restores exactly the measured original card SELECT grants and sets the public
transport flag; reload open readers. The write hardening remains. If phase 2
has not been installed yet, setting the flag to `{"mode":"public"}` and
reloading suffices. The separate write rollback restores only the three
measured original privileges to anon/authenticated/service_role, never PUBLIC.

## Nightly QA readers — Codex review follow-up

`qa/probes/lib.js`, `qa/ef-writepath/lib.js` and `qa/sxr_courier_lib.js`
read both card tables through `qa/card-read.js`, always using `card-read`.
They use the runner's existing `SYNCVIEW_STAFF_KEY`, or a privately supplied
current `SYNCVIEW_TEST_CLIENT_TOKEN` when there is no staff key. Node-side reads
are pinned to the designated test client, including ID-only polls and stale
fixture cleanup. Credentials remain in headers; curl receives them through
stdin. Event-table reads retain their existing REST transport.

Staff browser card GETs replace only the synthetic staff-entry credential with
the runner's key. Client-entry contexts and client tokens remain unchanged.
The function accepts the existing QA name and linked-deliverable filters; the
QA adapter makes omitted sort directions explicitly ascending. Failed or
malformed reads throw, and unreadable cards cannot count as successful cleanup.

Deploy `card-read` before running these updated nightly readers, even while the
page flag is public. They have no public-key card fallback. The existing nightly
workflows already provide the staff key. `test/qa-card-read-harness.js` executes
all three real harnesses with direct card REST refused, synthetic credentials,
in-memory transports, and no live mutations. Hosted/live nightly proof remains
a release gate.

## Proof limits

The grant proof creates and drops its own synthetic database on a fresh,
loopback PostgreSQL 17 cluster. It applies both forward SQL files and rollbacks
there only, checks actual role permissions and SELECT failures, preserves column
reads and the standing exceptions, and repeats the forward files. No shared
database migration is applied. Browser tests answer every backend call locally.
Local tests and typechecking do not prove deployed function source, live client
persistence, notifications, or hosted CI. Those remain release gates.
