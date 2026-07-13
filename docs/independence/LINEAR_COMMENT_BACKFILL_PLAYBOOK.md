# Linear comment history backfill playbook

**Status:** executed additively on 2026-07-12. The full import reconciled exactly and its
idempotent rerun performed zero writes. The one-command full rollback remains available and has
not been executed.

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

The full-run rollback in section 6 is rehearsed through the identical tag-scoped TEST pilot path
and remains ready. It was not executed against the full import.

## 1. What is reused, and what was missing

The 2026-07-10 finished-work import established the operating pattern but its dedicated importer
was not committed. Repository and PR history contain the evidence and controls, not the original
script:

- `EXECUTION_LOG.md` records the two-client pilot (680 deliverables / 203 batches), the remaining
  rollout (2,507 / 597), exact ledger coverage, zero orphaned batches, no Linear 429s, and a clean
  reconciler before and after. Total: 3,187 deliverables / 800 batches.
- `ROLLBACK.md` records tag `created_by='history-backfill-2026-07-10'` and the transactional,
  tag-scoped rollback.
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

### Gate A — full dry-run

Dry-run performs Linear/Supabase reads and zero Supabase writes:

```bash
node scripts/b4-linear-comment-backfill.js \
  --scope full \
  --import-run-id linear-comment-backfill-2026-07-12 \
  --page-delay-ms 500 \
  --write-concurrency 8 \
  --cap 20000 \
  --json-report artifacts/linear-comment-backfill-dry-run.json
```

Do not proceed unless: conflicts are 0, the planned total is at most 20,000, every source ID is
accounted for, and every non-zero unmapped/legacy category has an approved handling rule.

### Gate B — TEST pilot

The TEST apply is fail-closed to client `sidneylaruel`, projects `Sidney Laruel` / `Test Project`,
and VID/GRA issues. The explicit confirmation is mandatory:

```bash
B4_CONFIRM_TEST_MUTATIONS=1 node scripts/b4-linear-comment-backfill.js \
  --apply \
  --scope test \
  --import-run-id linear-comment-pilot-2026-07-12 \
  --page-delay-ms 500 \
  --write-concurrency 8 \
  --cap 500 \
  --json-report artifacts/linear-comment-pilot.json
```

Re-run the identical command. It must report zero inserts/updates, every pilot row as an exact or
stale no-op, zero conflicts, and `missing_from_store=0` / `extra_in_store=0`.

Then run the rollback in section 6 with the pilot run ID and repeat the TEST dry-run. The pilot must
return to its pre-pilot planned count. **Pilot rollback is a hard gate before full apply.** A full
plan treats any still-present backfill row carrying the pilot run ID as a conflict, so pilot rows
cannot escape the full rollback tag.

### Gate C — full apply and reconciliation

Use the same approved run ID, cap, and source scope as the full dry-run:

```bash
node scripts/b4-linear-comment-backfill.js \
  --apply \
  --scope full \
  --import-run-id linear-comment-backfill-2026-07-12 \
  --page-delay-ms 500 \
  --write-concurrency 8 \
  --cap 20000 \
  --json-report artifacts/linear-comment-backfill-full.json
```

The script is restartable after interruption. Missing rows insert; a newer Linear
`updatedAt` on a row from the same run plans an RPC update for edit/delete/resolve convergence;
older source replays are stale no-ops. A true same-clock/content contradiction is a conflict and is
never overwritten automatically.

Re-run the identical full command. Required result:

- planned inserts = 0;
- planned updates = 0;
- conflicts = 0;
- `missing_from_store=0` and `extra_in_store=0`;
- source count equals the unique stored `linear_comment_id` count.

## 5. Optional recovery of the eight local-only native comments

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

Use a fixed capture timestamp and repeat it on every rerun:

```bash
node scripts/b4-linear-comment-backfill.js \
  --apply \
  --scope full \
  --import-run-id linear-comment-backfill-2026-07-12 \
  --recover-legacy-native \
  --legacy-native-cap 8 \
  --legacy-capture-at 2026-07-12T23:00:00Z \
  --cap 20000 \
  --json-report artifacts/linear-comment-backfill-with-legacy.json
```

Proceed only when `standalone_additions=8` matches the independently verified gap. Any other count
is a stop-and-review result.

## 6. One-command rollback

Replace the run ID in all three predicates. Execute the whole block as one service-role SQL-editor
command. It refuses to delete a tagged row whose source has since changed away from `backfill`,
deletes only that run's self-contained events first, then deletes only that run's backfill rows. It
never touches Linear, deliverables, batches, flags, n8n, or the mirror outbox.

```sql
begin;
do $$
begin
  if exists (
    select 1 from public.production_comments
    where import_run_id = 'linear-comment-backfill-2026-07-12'
      and source <> 'backfill'
  ) then
    raise exception 'rollback refused: tagged comments have non-backfill changes';
  end if;
end $$;

delete from public.deliverable_events
where source = 'backfill'
  and action in (
    'comment_add', 'comment_edit', 'comment_delete', 'comment_resolve',
    'comment_unresolve', 'comment_link_linear', 'comment_link_native'
  )
  and coalesce(
    payload->>'import_run_id',
    payload#>>'{comment,import_run_id}'
  ) = 'linear-comment-backfill-2026-07-12';

delete from public.production_comments
where source = 'backfill'
  and import_run_id = 'linear-comment-backfill-2026-07-12';
commit;
```

Rollback verification: the run-tag count and its event count are zero; pre-existing native/mirror
comments are unchanged; rerunning the same dry-run reproduces the original planned insert count.

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
