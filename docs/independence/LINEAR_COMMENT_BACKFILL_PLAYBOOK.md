# Linear comment history backfill playbook

> [!CAUTION]
> **HISTORICAL EXECUTION RECORD — DO NOT RUN OR RE-RUN.** The accepted 2026-07-12
> migration is complete. Its one zero-write rerun proved only that historical snapshot. The script
> still accepts the consumed run ID and can write newer source changes; full rollback is blocked by
> F68. F103 makes the former apply recipes below inert. Any future import requires a new
> owner-approved run ID, immutable source checkpoint, current dry-run/review, completion guard, and
> dependency-safe recovery plan in a new runbook.

**Status:** executed additively on 2026-07-12. The full import reconciled exactly and its
idempotent rerun performed zero writes. The former full-delete rollback is **withdrawn** (F68):
current cross-run/self-FK dependencies and non-baseline row versions make its source-only guard
insufficient. The version-2 timestamps fall inside the import/supplement window; no later mutation
is inferred from version alone.

This playbook imports the complete discoverable VID/GRA Linear comment history into
`production_comments`. Linear is read-only throughout. Dry-run is the default, and the only
database write path is the service-role RPC
`production_comment_upsert(p_comment jsonb, p_event jsonb)`.

## 0. Executed result (2026-07-12)

The additive migration and authenticated reader were deployed before the import. Public-safe
operator reports and live readback established the following:

| Gate | Result |
| --- | --- |
| Full dry-run | 12,683 unique VID/GRA source comments; zero conflicts; all source IDs accounted for; below the 20,000-row cap |
| TEST pilot | 56 comments written and reconciled exactly; identical rerun wrote zero rows; tag-scoped rollback returned the pilot to zero |
| Full apply | 12,683 Linear comments stored; an interrupted process stopped safely after 606 rows and resumed idempotently for the remaining 12,077 |
| Full reconciliation | 12,683/12,683 Linear IDs matched; zero missing, extra, or conflicting IDs |
| Legacy supplement | 8 verified local-only native comments added, producing 12,691 durable rows total |
| Final rerun | 0 inserts, 0 updates, 12,691 exact no-ops, and 0 conflicts |
| Deployed functions | `production-comments` v1 and `linear-inbound` v19 active; v19 preserves snapshots on lifecycle-only webhooks and resolves mixed-team batch parents; the outbound function was unchanged |
| Runtime safety | No Linear mutation was issued; flags stayed at authority Linear/Linear, outbound off, inbound enabled, and auth permissive; the outbox stayed at 181 total, 0 pending, and 0 failed |

The comment table is deliberately **not anonymous-readable**. Comment text is available only
through the protected reader after role-key and active-roster verification, and body-bearing
comment events are hidden from anonymous reads. This access decision needs explicit owner sign-off
before the UI is merged; relaxing it to match the anonymous mirror-table policies would expose
comment bodies and is not part of this epoch.

The original tag-scoped TEST-pilot deletion does not prove that the evolved full import can be
removed. Section 6 records the current live blockers and the recovery design that must exist before
any full-import rollback is offered.

## 1. What is reused, and what was missing

The 2026-07-10 finished-work import established the operating pattern but its dedicated importer
was not committed. Repository and PR history contain the evidence and controls, not the original
script:

- `EXECUTION_LOG.md` records the two-client pilot (680 deliverables / 203 batches), the remaining
  rollout (2,507 / 597), exact ledger coverage, zero orphaned batches, no Linear 429s, and a clean
  reconciler before and after. Total: 3,187 deliverables / 800 batches.
- `ROLLBACK.md` records tag `created_by='history-backfill-2026-07-10'`. **Do not reuse its former
  three-DELETE rollback:** after this comment import, NO ACTION comment FKs and thousands of ledger
  events depend on those history rows, so F62 requires a new dependency-aware disposition and
  rehearsal. F68 independently withdraws the comment-import rollback in §6 below.
- `scripts/b1-linear-backfill.js` is reusable for default-dry-run posture, paged service reads,
  public aggregate artifacts, RPC-only writes, and reconciliation. It deliberately writes
  `comments:null` and therefore is not the comment importer.
- `scripts/b3-comment-catchup.js` is reusable for GraphQL/auth scaffolding and signature planning,
  but it reads only active deliverables and only the first 50 comments per issue. It records
  `hasNextPage` without following the cursor and writes a mutable `linear_raw` blob. It must not be
  used for complete history.
- `scripts/linear-deliverables-reconcile.js` and
  `.github/workflows/linear-deliverables-reconcile.yml` supply the dry-run/cap/concurrency pattern,
  but their comment check covers engine-tracked IDs only and also reads only the first 50.
- `scripts/b4-linear-outbound-harness.js` supplies the fail-closed TEST client/project guard.
- `migrations/2026-07-12-production-comments.sql` is the durable store/RPC/event contract used by
  this tool.

The replacement importer is `scripts/b4-linear-comment-backfill.js`, with focused offline coverage
in `test/b4-linear-comment-backfill.js`.

## 2. Source and normalization contract

The importer follows the verified global cursor until `hasNextPage=false`:

```graphql
comments(
  first: 100
  after: $after
  includeArchived: true
  filter: { issue: { team: { key: { in: ["VID", "GRA"] } } } }
)
```

Each node retains issue UUID/identifier/team, comment ID/body/timestamps, parent/root information,
resolution/archive state, and `user`, `onBehalfOf`, `externalUser`, and `botActor` identities.
There is no Linear mutation in the query or script.

Normalization rules:

- New Linear rows use `id='linear:<Linear comment id>'`,
  `idempotency_key='linear:<Linear comment id>'`, and the same deterministic value for
  `native_comment_id`. A safely recovered original native ID replaces only `native_comment_id`.
- `deliverables.linear_issue_uuid` is the first native mapping. Batch parent UUIDs from
  `batches.linear_parent_ids` are second; `linear_archive.linear_uuid` is third. A still-unmapped
  comment is retained with its Linear issue UUID and team, as the schema permits.
- Roots are sorted before replies before any RPC call. Missing/inaccessible parents remain in
  `linear_parent_comment_id`, while the nullable native FK is left unset instead of inventing a
  parent.
- `**Name (via SyncView):**` is parsed as a legacy bridge wrapper and the HTML
  `syncview-mirror` marker is stripped from the displayed body. The wrapper name is the human
  author; the real Linear account remains separately stored as the transport actor.
- Direct Linear IDs and bridge display names are matched to `team_members` only by exact ID or
  exact normalized roster name. A match produces `author_key='team:<member UUID>'` and the roster
  name/role. Unmatched identities receive deterministic `bridge`, `linear`, or `external` roles;
  they are never guessed to be editors.
- Imported Linear comments use `source='backfill'` and `origin='bridge'` or `origin='linear'`.
  Edited, archived/deleted, and resolved timestamps are preserved. Imported history is internal and
  `is_tweak=false`; it cannot silently trigger the legacy change-request default.
- Every mapped RPC write creates a self-contained `deliverable_events` comment event through the
  RPC. Its stored comment object includes body, author, thread, timestamps, state, provenance, and
  `import_run_id`.

## 3. Public-safe report

Stdout and `--json-report` contain aggregates only: pages, source/scoped counts, team totals,
mapped/unmapped categories, replies, edits, deletes, resolutions, bridge wrappers, planned inserts,
planned updates, exact/stale no-ops, conflicts, optional legacy recovery counts, and ID
reconciliation. They contain no bodies, author names/emails, client names, Linear IDs, or issue
identifiers.

The capacity gate remains 20,000 rows. The inventory's all-VID/GRA estimate is 12,792 retained
comments, with an approximate upper interval of 14,718; archived comments returned by
`includeArchived:true` can increase the actual result.

## 4. Gates and commands

Prerequisites:

1. Deploy and verify `migrations/2026-07-12-production-comments.sql` and the authenticated comment
   reader separately.
2. Export `LINEAR_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` in the private operator
   environment. Never place them in a report or command transcript.
3. Run the focused offline test:

   ```bash
   node test/b4-linear-comment-backfill.js
   ```

### Historical Gate A record — full dry-run

The accepted run first used a read-only full plan. Its recorded parameters were full scope, the
2026-07-12 import ID, bounded paging/concurrency, a 20,000-write ceiling, and a local aggregate
report. The gate required zero conflicts, complete source accounting, and an approved rule for
every non-zero unmapped/legacy category. This is evidence, not permission to query production now.

### Historical Gate B record — TEST pilot

The accepted TEST pilot used the private TEST client/project allowlist, a distinct 2026-07-12 pilot
ID, explicit local mutation confirmation, and a 500-write ceiling. It was rerun to zero writes, then
rolled back and re-planned before full apply. The executable command and rollback instruction are
removed: F68 proves the old recovery assumptions are not a standing safety contract.

### Historical Gate C record — full apply and reconciliation

The accepted full apply reused the reviewed 2026-07-12 full-run parameters and a 20,000-write
ceiling. At that time, its immediate rerun produced zero writes. The script remains capable of
inserting missing rows and updating same-run rows when source `updatedAt` or lifecycle state moves;
there is no completed-run ledger that makes the old ID terminal. Therefore the former apply command
is intentionally not preserved as an executable recipe.

The historical required reconciliation result was:

- planned inserts = 0;
- planned updates = 0;
- conflicts = 0;
- `missing_from_store=0` and `extra_in_store=0`;
- source count equals the unique stored `linear_comment_id` count.

## 5. Historical supplement — recovery of eight local-only native comments

This is a separate, explicit supplement. Do not enable it in the TEST pilot or ordinary Linear
history run.

The recovery mode reads `deliverables.comments` and excludes native IDs already present in
`production_comments`:

- a unique exact normalized body match within the already-linked Linear issue annotates the
  corresponding Linear row and uses the original native ID when one exists; authoritative Linear
  human attribution is retained rather than trusting the legacy transport-author snapshot;
- unmatched or ambiguous local-only comments become deterministic
  `legacy:<sha256(deliverable|author|body|ordinal)>` rows;
- standalone additions are capped at eight, so the wider legacy set cannot be imported twice;
- the old native timestamp is explicitly `unavailable`; `--legacy-capture-at` is stored as
  ingestion-only time. The tool never copies or invents an original occurrence time.

When this supplement runs after the full import, those exact matches are narrowly planned as
same-clock metadata-enrichment updates: body, author, target, thread, and lifecycle fields must all
remain unchanged. The eight local-only rows remain inserts.

The executed supplement used the same historical run ID, a fixed 2026-07-12 ingestion-only capture
time, and a cap of eight standalone additions. Its executable recipe is removed. The count check
occurred after the write path and cannot make a later rerun safe; any future recovery must use a new
reviewed plan and reject a consumed run ID before its first RPC.

## 6. Full-import rollback — blocked pending a dependency-safe design (F68)

**Do not run the former DELETE block.** A 2026-07-13 service-role, aggregate-only read found 12,691
tagged comments still sourced from the backfill, but the import is no longer self-contained:

- 223 current rows reference tagged IDs through `parent_id` and/or `thread_root_id` NO ACTION
  self-foreign keys; 222 are same-run descendants and one outside-run row references a tagged ID;
- 41 tagged rows are version 2 (their timestamps remain inside the import/supplement window);
  checking only that `source='backfill'` cannot classify why a row is non-baseline, while the later
  outside-run relationship independently proves the import is no longer self-contained.

The safe default is to preserve the import. A future rollback must first capture a fresh private
dependency/version snapshot; require an owner-approved preserve/relink/delete disposition for
same-run and cross-run descendants plus events; calculate assertion-bearing dry-run counts; execute
dependency order inside one transaction; and pass a full TEST/scratch restore rehearsal and exact
post-rollback readback. Only then may a new command be documented. The small TEST-pilot rollback was
valid for that then-isolated fixture and is not evidence for deleting today's full import.

## 7. Stop conditions

Stop without applying or continuing when any of these occurs:

- a TEST row resolves outside the exact client/project/team allowlist;
- a page cursor is absent/repeated, Linear returns an unrecovered 429/5xx, or source IDs duplicate;
- planned writes exceed the approved cap;
- an existing ID points at a different Linear comment;
- a same-clock row has contradictory body/author/thread state;
- any backfill row carries a different pilot/full `import_run_id`;
- the optional standalone legacy recovery count is not exactly the independently approved count;
- post-apply source/store ID reconciliation is non-zero.
