# Card history and backup/restore: independent adversarial review of PR #1299

**Reviewed head (exact): `85018bf83ab49527c79ca86d521c6a08a31e3277`** (draft PR #1299,
merge of tested candidate `ee07dd4c` with captured main `244de82a`).
**Remote `main` at review time: `3d534cfa5598ef16e61c5ee7dc8072afaa9963c7`**, twelve
commits past the PR's base; GitHub reports the PR as `mergeable_state: dirty`. Any
merge produces a new head whose runtime hashes must be re-verified; nothing below
transfers automatically.

Dependency heads as reviewed: PR #1293 `5418ab5618595d9469f0527bd94623e9229a637e`
(manifest migration SHA-256 `39ac7614…cfcf1`, matches the runner's pin; it is NOT an
ancestor of the reviewed head); PR #1304 `78e6b3eaf35e254daa23dd69b2d8f9ee54974434`
(feedback-draft conservation; open draft, base branch
`validation/first-samples-release-20260905`, not `main`).

Scope and method: source review of the exact head against `AGENTS.md`, `BRIEFING.md`,
`REPO_MAP.md`, `EF_DEPLOY_MANIFEST.md`, `CARD_CHANGE_HISTORY.md`, `TRACK_B_BACKUP.md`, the
local-proof audit, and PR #1268's `GO_LIVE_CHECKLIST.md` (G3/G4/G10 ordering preserved).
Fault experiments ran only in a private disposable PostgreSQL 16.13 cluster built for this
review; no production or TEST read/write, deploy, n8n, schedule, credential or alert action.
Synthetic slugs only. Counts and hashes only. **This is source and local proof; it is not
installed-schema, cloud-delivery, recipient, retention or production-restore proof.**

## Verdict (exact head 85018bf)

- **Journal half: no ordinary-path escape found.** Every accepted card/status/assignee/
  due/comment/edit/resolve/reopen/delete action I could map commits a row change on one of
  the six owners, and the AFTER ROW trigger captures it regardless of writer (frozen EF,
  gateway RPC, direct SQL, `service_role` or `anon`, `app.event_written` set or not). Capture
  failure rolls back the business row, the semantic event and the outbox intent together.
- **Backup/restore half: one confirmed material defect (F-A) and one confirmed gap (F-B).**
  On a scratch built from this repository's own migrations, the new history-v4 restore is
  refused by `TRUNCATE … RESTRICT`, and the modified legacy-v3 restore is refused by the new
  legacy guard. Merging this head therefore makes the only existing restore drill for the only
  existing package format unrunnable on the documented scratch, and the v4 gate 5 cannot be
  passed as written. Both refusals are fail-closed (no false green), which is why this is a
  blocked gate rather than silent data loss.
- **Installation ordering is correct and must stay:** the journal deliberately turns capture
  failure into save failure, PR #1304 is open and unmerged, so installation stays blocked.
  Do not weaken atomic capture to hide the browser defect.

The hosted counts (404 suites, 31 journal checks, 14 backup checks) reproduce locally on
16.13 with identical source hashes. They prove the synthetic foundation schema, not the
serving schema; the two findings below live exactly in that gap.

## Confirmed findings

### F-A (High, confirmed): both restore paths are refused on a production-shaped scratch

**Reproduction.** Build a scratch from `live-schema-baseline-2026-07-03.sql` plus every dated
migration except the install-gated F27 file, apply the PR #1293 migration and the journal
migration (both apply cleanly; the six-owner key/client check passes). Generate the restore
SQL with the head's `restoreSql()` from a real `pg_dump` of that scratch and run it against a
clone:

```
history-v4: ERROR: cannot truncate a table referenced in a foreign key constraint
            DETAIL: Table "pto_members" references "team_members".
legacy-v3:  ERROR: Legacy Track-B package cannot restore into an expanded history schema
```

**Why.** `pg_constraint` on that schema shows nine foreign keys from eight tables outside the
21-table corpus into it: `pto_members`, `pto_requests`, `pto_adjustments` → `team_members`
(live since 2026-07-15); `linear_project_ids_shape_migration_20260728` → `clients`;
`production_asset_access_checks`, `linear_archive_asset_refs` → `deliverables`;
`production_comment_card_links` → `deliverables` and `production_comments` (ON DELETE
CASCADE); `production_comment_mutation_receipts` → `production_comments` (CASCADE). The
installed F27 migration adds a tenth (`track_b_team_rollback_intents` → `mirror_outbox`).
`TRUNCATE … RESTRICT` refuses whenever any such table exists, empty or not. The legacy guard
refuses when any of the seven added tables exists, and `calendar_posts`/`sample_reviews` exist
in every production-shaped schema because they are in the baseline. The candidate's own
rehearsal asserts both refusals as desired behaviour; it never runs against a
migration-built schema, so the consequence stayed invisible.

**Impact.** Until fixed, `restore_rehearsal=true` cannot succeed for v3 or v4 on the scratch
`TRACK_B_BACKUP.md` tells the owner to build ("apply the production schema migrations to
it"). G10's "two successful scratch restore passes" and G3's "rehearse retrieval" are
unreachable as written. Scheduled export and freshness are unaffected.

**Minimal correction.** (1) Scope the legacy guard to `card_change_journal` (optionally the two
event tables), never to tables the baseline already contains. (2) Close the corpus under
incoming foreign keys instead of hoping for a dedicated target: add the small dependent tables
to history-v4 (see F-C) and, for the remainder, truncate an explicit reviewed allowlist of
dependents in the same statement (still no CASCADE, still RESTRICT). (3) Add a CI assertion
that reconstructs the schema from the migration set and fails if `pg_constraint` shows any
uncovered incoming foreign key into the selected corpus. Smallest gate: the restore SQL must
execute end to end, in CI, against a migration-built scratch before v4 opt-in.

### F-B (Medium, confirmed): packages are data-only and the schema cannot be rebuilt from the migration set without manual repair

G3 lists "separately protected database, schema/configuration" as one of four recovery parts.
Every package (v3 and v4) is `pg_dump --data-only`; no schema-bearing artifact exists in this
PR or in the live workflow. Rebuilding the schema from `migrations/` on a fresh PostgreSQL 16
needed, in this review: Supabase-side objects stubbed (`extensions` schema with pgcrypto,
`storage.buckets` with `file_size_limit`/`allowed_mime_types`, the `supabase_realtime`
publication); eight missing statement terminators after `$function$` in the baseline; a
second baseline pass because its triggers precede their function bodies; two same-day files
applied out of filename order (`b1-deliverable-kind-other` before `b1-linear-data-model`,
`samples-batch-purpose-grant` before `samples-batch-purpose`); one superseded v1 file with a
syntax error at end of input; and the F27 file, which refuses a fresh target by design. None
of this is documented as the scratch recipe. If the serving database is lost, the packages
alone cannot be restored anywhere.

**Minimal correction.** Add a signed `pg_dump --schema-only` of the corpus closure (plus
dependents from F-A) to each v4 package, or a separately signed schema bundle refreshed on
every migration apply, and a CI job that rebuilds the schema from migrations (the crosswalk
rehearsal harness already exists). Smallest gate: one tested recipe that yields a scratch on
which the restore SQL runs.

### F-C (Medium, confirmed by catalog): identity and idempotency facts sit outside both the journal and the corpus

`production_comment_card_links` is the exact source-note ↔ canonical-comment crosswalk that G4
forbids re-deriving from text. `production_comment_mutation_receipts` is the replay-adoption
record production-write consults before its CAS for edit/delete/resolve/reopen. Neither is
journaled, neither is in v3 or v4, and both cascade-delete from `production_comments`. No
ordinary path hard-deletes the six owners (no `delete from`/`.delete()` on them in Edge
Functions or migrations; comment delete and resolve are `deleted_at`/`resolved_at` UPDATEs, so
they are captured), so the cascade is privileged-only today. But a restored scratch loses the
crosswalk and the receipts entirely, and a response-loss retry replayed after a restore can
mint a second mutation, contradicting G3's "one native result per request". Same class:
`linear_intake_receipts`, `production_asset_access_checks`, `linear_archive_asset_refs`,
`thumbnail_media_revisions`, `workload_issues`.

**Minimal correction.** Add `production_comment_card_links`, `production_comment_mutation_receipts`
and `linear_intake_receipts` to history-v4 (this also removes five of the nine blocking foreign
keys in F-A). Record the remaining tables as uncovered rows with a named recovery owner in the
coverage ledger below.

### F-D (Low, capacity, not a defect)

Every `deliverables` UPDATE journals two full row images including `linear_raw` and
`linear_aliases` (jsonb), and `linear-inbound`/`linear-outbound` update deliverables per
provider event, not per human action. The candidate's 0.4 ms local figure does not bound
this. Existing doc gate ("reassess overhead against production measurements") stands; no
figure is available without a production read.

## What was tried and did not produce a finding

- Capture with a **non-superuser journal owner** (Supabase `postgres` is not a superuser):
  ownership transferred to a plain role, `service_role` writes still journal; EXECUTE on the
  trigger function is irrelevant to firing. Only `ALTER TABLE … FORCE ROW LEVEL SECURITY` on
  the journal breaks capture, and it breaks it fail-closed (every save on all six owners is
  rejected). Privileged-only; add it to the "explicit limits" list.
- No `TRUNCATE`, `session_replication_role`, `ENABLE ALWAYS/REPLICA` trigger or
  `DISABLE TRIGGER` path exists in Edge Functions, migrations or n8n snapshots.
- The six owners carry only stamp/thumbnail-revision BEFORE triggers and the ledger-guard
  AFTER triggers; `card_change_journal_after` sorts first alphabetically, and a later AFTER
  trigger failure rolls the journal row back (rehearsal check reproduced).
- Browser: seven direct PostgREST endpoints touch the six owners and all are reads. n8n
  snapshots contain no SQL writes to them. All writes reach the tables through triggers.
- Both rehearsals PASS on 16.13 with the audited source hashes. A real-shape history-v4
  `pg_dump` passes the strict parser (only the nine expected `setval` lines appear).
- Retry: production-write reads the lifecycle receipt before the stale-CAS check, so a
  response-loss retry adopts the first result and makes no second row version.
- Realtime: the `supabase_realtime` publication is explicit-add in every migration; the journal
  is not added. Live publication mode is unverified (see gates).

## Coverage map: accepted card actions versus journal owners

| Action | Row owner | Journaled | In corpus | Note |
|---|---|---|---|---|
| Calendar create/edit/status/schedule/order/asset link/native binding | `calendar_posts` | yes | v4 only | v3 has never covered Calendar |
| Calendar source note/tweak (client, SMM, Kasper) | `calendar_posts` cells via `calendar_merge_comments` | yes | v4 only | plus `calendar_post_events` (v4, not journaled) |
| Samples create/edit/status/order/note/tweak | `sample_reviews` | yes | v4 only | plus `sample_review_events` (v4) |
| Native batch create/rename/brief/archive/intake parent | `batches` | yes | v3+v4 | intake manifest in v4 only |
| Deliverable create/title/brief/status/assignee/due/asset/crosswalk | `deliverables` | yes | v3+v4 | `linear_raw` amplification (F-D) |
| Canonical comment add/edit/delete/resolve/reopen/reply | `production_comments` | yes | v3+v4 | soft delete = UPDATE |
| Comment replay receipts | `production_comment_mutation_receipts` | **no** | **no** | F-C, cascade |
| Source-note ↔ canonical crosswalk | `production_comment_card_links` | **no** | **no** | F-C, cascade |
| Workload internal plan date | `workload_plan` | yes | v4 only | |
| Workload mirror | `workload_issues` | no | no | rebuildable from provider while provider exists |
| Labels | provider; mirrored in `deliverables.linear_raw` | via row image | v3+v4 | no native label table |
| Intake receipts | `linear_intake_receipts` | no | no | recovery owner: G2/G3 ledger |
| Attachment checks / archive asset refs | `production_asset_access_checks`, `linear_archive_asset_refs` | no | no | asset bytes are G4 |
| Thumbnail revisions | `thumbnail_media_revisions` | no | no | asset metadata; G4 |
| Semantic event ledgers | `deliverable_events`, `calendar_post_events`, `sample_review_events` | no (append-only) | v3 / v4 / v4 | |
| Outbox intents | `mirror_outbox` | no | v3+v4 | |
| Unsubmitted browser text | browser only | **never** | **never** | PR #1304 territory; not a journal claim |
| Pre-install overwritten values | nothing | never | never | not reconstructible |

## Explicitly unproved gates (nothing in this head proves them)

1. Installed six-owner schema equals the reconstructed one (only a migration-built shape was
   checked; drift on the serving database is possible).
2. Live `supabase_realtime` publication mode (explicit-add assumed from migrations).
3. Restore executes on any real scratch (F-A blocks it today).
4. A schema-bearing recovery artifact exists (F-B).
5. Private Drive readback of a v4 package; alert delivery to a human; observer outside GitHub.
6. HMAC key custody outside GitHub secrets: without the key, packages cannot be authenticated
   by the reader (bytes remain manually recoverable).
7. Drive growth: no pruning code exists, so packages accumulate six-hourly forever; quota is a
   gate, not a defect.
8. Retention: "checkpoint plus later changes" holds only because the journal is never pruned,
   so the newest package is the checkpoint. The day any prune is enabled, package retention
   must exceed the prune window; no such rule is written.
9. Capacity: F-D.
10. Thirty days of continuous capture cannot be shown before thirty days of capture.

## Answers to the five questions, in one line each

1. Escape: none on ordinary paths; privileged limits are DDL/TRUNCATE, disabled triggers,
   FORCE RLS on the journal, and replica-mode replication. Failure rolls back both sides.
   Schema drift on the six owners is captured, not omitted; drift *around* them is F-C.
2. Retry/concurrency: no misleading accepted change found; actor is transport-only and every
   Edge Function write shows `service_role`, so human attribution rests on row/event claims.
   Reconstruction preserves identity, per-entity order and deletion; audience lives inside the
   row image and any future reader must filter it. Unsubmitted text is outside the journal.
3. Green-with-wrong-content: not found; the package binds the exact COPY bytes and the restore
   verifies counts plus twelve orphan joins. The real defect is that restore does not execute
   (F-A) and the schema is not recoverable (F-B). Cloud restore checks counts; the local
   rehearsal checks typed content; the two are not the same guarantee.
4. Retention: sound only while unpruned; independent recoverability fails on F-A/F-B; assets,
   provider history, verified actor identity and pre-install values stay outside the corpus.
5. Journal refusal would surface through the reproduced draft-loss paths until PR #1304 lands;
   the dependency is real, open, and stacked on a validation branch rather than `main`.
