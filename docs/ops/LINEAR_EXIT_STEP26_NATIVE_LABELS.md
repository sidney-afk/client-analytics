# Step 26/27 — native label catalog

Execution map phase 7, for the **one** capability `production_native_label_catalog`.

> ## ✅ SUPERSEDED BY EVENTS — labels went native on 2026-09-18 at 20:02:56Z
>
> This file was written earlier the same day as **read-only research**, and it
> opened by saying nothing in it had been run and that four blockers stopped it
> being run as written. **Three of those four were resolved and the capability
> is live.** Live state, as measured by the owner:
>
> | | |
> |---|---|
> | capability | `native` since **2026-09-18T20:02:56Z** |
> | catalog version | `f55a7dd2` |
> | deployed at | `b7c30c74`, `production-write` **v77** |
> | step 27 | ⏳ **IN PROGRESS** — 6 of 7 checks measured; check 6 is 2 of its 3 refusals |
> | step 28 | ⛔ **WITHDRAWN** — not reachable until check 6 is complete |
> | kill switch | `mode:"hold"` — see *The rollback* in (c) |
>
> The original text is kept below with a correction block against each thing
> that turned out to be wrong, because the reasoning that produced a wrong
> blocker is worth more than a tidy file. **Read each ⚠ correction before
> acting on the paragraph above it.**

Read-only research, 2026-09-18, cloud session, superseded as above. When first
written: no SQL was issued, no Linear request was made, no flag was read live.

Companion documents, both still correct and neither superseded by this one:
[the B7 capture runbook](NATIVE_LABEL_CATALOG_CAPTURE.md) is the owner's command
sheet; [the foundation record](NATIVE_LABEL_CATALOG_FOUNDATION.md) is what the
source does and what it refuses. This file is the step 26/27 procedure that sits
on top of them, plus four things that reading the code turned up which stop the
procedure being run as written today.

---

## Read this before anything else: four blockers

Three of them are not "do it carefully" cautions. They are reasons the step
cannot complete, and two were not written down anywhere before this file.

> ⚠ **As of 2026-09-18T20:02:56Z: B-1, B-3 and B-4 are resolved.** B-2 still
> stands and was never tested, because the capture it describes a substitute for
> was actually taken. Corrections are inline below.
>
> | | as written | as it turned out |
> |---|---|---|
> | **B-1** | the capture window closed, capture never taken | access was still live; the capture was taken and attested |
> | **B-2** | no in-database substitute exists | **still true**, and never needed |
> | **B-3** | the label lane refuses the test client | fixed in #1414, then bound to `auth_kind` |
> | **B-4** | native cards keep saying "Labels unavailable" | **wrong** — the gateway already stamped the empty relation |

### B-1. The capture window closed three days ago, and the capture was never taken

`NATIVE_LABEL_CATALOG_CAPTURE.md` still opens with **"Status: SOURCE ONLY. The
capture has NOT been taken."** OPEN_REPAIRS 170 says the same. And
`OPEN_REPAIRS.md:15275` says of 2026-09-15: *"that date ends our Linear
**access**"*.

Today is 2026-09-18. Every other step in this file is downstream of a capture
that, on the repository's own record, can no longer be taken.

> ⚠ **CORRECTED — the record was stale, the access was not.** Linear still
> answered on 2026-09-18. Gate 0 below is exactly the check that established
> this, and it passed. The capture was taken, attested, staged and activated the
> same day; the catalog version is `f55a7dd2`.
>
> **The mistake is worth naming, because it is not a small one.** Three
> documents agreed that access had ended — the runbook's own status line,
> OPEN_REPAIRS 170, and `OPEN_REPAIRS.md:15275` — and all three were
> *predictions written in advance*, not measurements. A date that was planned
> for was read back as a date that happened. Nothing had checked.
>
> The corrected ledger line now reads that access is live, measured
> 2026-09-18. The general form: **a date in a document is a claim about the
> future until something measures it.** Gate 0 existed precisely to measure it,
> and the right move was always to run Gate 0 first rather than to reason from
> the record. That is what eventually happened.

**This is a question, not a conclusion.** A session cannot tell whether
`api.linear.app` still answers for this workspace, and the repository's
statement is a plan, not a measurement. Settling it is free, read-only, and
takes one command — see *Gate 0* below. Everything after Gate 0 is written
assuming it comes back green; if it comes back red, jump to *If Gate 0 fails*.

### B-2. There is no in-database substitute for the capture

The obvious fallback — build a manifest from the label nodes already sitting in
`deliverables.linear_raw` — is ruled out in writing, not merely discouraged.
`NATIVE_LABEL_CATALOG_FOUNDATION.md` states: **"A selected-label union is never
treated as a catalog."** Attestation item 4 in the runbook requires the owner to
assert the manifest is the **whole workspace**, which a union of what happens to
be selected on our cards is not. Asserting it anyway is a false attestation, and
the attestation is the only thing standing between a partial catalog and a
permanent one.

So: the catalog either comes from Linear, or the capability does not turn on.

### B-3. The native label lane refuses the test client outright — there is no TEST rehearsal

This is the same structural defect PR #1413 fixed for the ordinary and
assignment lanes, still present in the label lane, in all three layers:

| Layer | Refusal |
|---|---|
| `migrations/2026-09-06-native-label-writes.sql:132` | `production_labels_write` requires `v_out->'test_only'` to be exactly `false` |
| `migrations/2026-09-06-native-label-writes.sql:101` | the receipt guard refuses when `new.test_only is distinct from false` |
| `supabase/functions/production-write/index.ts:6403` | the gateway refuses `principal.testOnly` with 403 `native_label_scope_forbidden` |

So step 27's "watch real work flow through it" has **no TEST lane at all**. The
first native label write that can ever succeed is on a real client — which
collides head-on with the standing constraint *"Mutate only the test client
`sidneylaruel`"*.

That is an owner decision, and it has exactly two honest shapes:

- **(i)** Extend the #1413 parity migration to this third lane, so
  `sidneylaruel` can exercise it first. Same three edits, same shape, and #1413
  is the worked precedent including its rehearsal and its negative controls.
- **(ii)** Accept that the first native label write is on a real client, and
  name that client in the go-ahead.

**Do not** resolve it by flipping `test_only` on a real write. The receipt guard
would refuse it anyway, and the refusal is correct.

> ⚠ **CORRECTED — resolved by shape (i), and then by a defect found on top of
> it.** `migrations/2026-09-18-native-label-test-client-parity.sql` (#1414)
> extended the #1413 parity to this third lane: all three layers now record and
> compare `test_only` instead of refusing it, `legacy_parity` untouched, every
> role named, nothing granted.
>
> **That was not sufficient on its own, and the reason generalises.** Codex
> found that the TEST principal was still refused one layer later: `eventFor`
> emits `auth_kind: principal.kind`, the TEST principal's kind is `test`, and
> the SQL still demanded `auth_kind = 'staff'`. So the parity was *unreachable
> through the real gateway* — every rehearsal that "passed" had hand-built an
> `auth_kind` the gateway cannot actually send. The fix **binds** the two
> fields: `auth_kind` must be `test` exactly when `test_only` is true and
> `staff` exactly when false, both directions. The assignment lane carried the
> identical defect and got the identical binding
> (`2026-09-18-native-assignment-auth-kind-binding.sql`, #1415).
>
> **The reusable lesson:** a rehearsal that constructs its own input proves the
> SQL, not the path. Derive the rehearsal's input the way the gateway derives
> it, or the test agrees with itself.

### B-4. Turning the flag on does NOT make labels appear on natively-created cards

This is the direct answer to *"what does 'Labels unavailable' become"*, and the
answer is: **on a natively-created card, it stays "Labels unavailable".**

`nativeLabelSnapshot` (`index.ts:797-818`) returns `null` unless the stored
relation has a `nodes` array **and** `pageInfo.hasNextPage === false`. A card
created by native intake has no `labels` relation stamped on `linear_raw` at
all — nothing in any migration seeds one (`grep hasNextPage migrations/*.sql`
returns only readers and the writer's own output at
`2026-09-06-native-label-writes.sql:180`). The workload lane already knows this
and treats an absent relation as "complete, with no labels"
(`migrations/2026-09-08-workload-native-label-state-shape.sql:8`), but
production-write does **not** share that reading.

So in native mode `handleLabelsRead` reaches `index.ts:5611` and throws 409
`native_label_state_incomplete`, and the button renders the same
`Labels unavailable` string it renders today.

**The capture's half (b) cannot repair these cards either.** Its repair arm is
`if (state !== 'complete' && options.repair && card.linear_issue_uuid)`
(`scripts/linear-label-catalog-export.cli.js`) — a natively-created card has no
`linear_issue_uuid`, so it is classified and then skipped.

What is actually needed is a one-line seed, on native cards only, of
`linear_raw.issue.labels = {"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}`
— the empty-but-complete relation. That is a migration this repository does not
have, and it is a prerequisite of step 26, not of step 27.

> ⚠ **CORRECTED — B-4 was wrong. Native cards already carried the relation, and
> turning the flag on DID make labels appear on them.**
>
> The claim above rests on the sentence *"nothing in any migration seeds one"*,
> and that sentence is **true**. The conclusion drawn from it — *"nothing seeds
> one"* — does not follow, and is false. **The stamp is in the gateway, not in
> SQL:**
>
> | site | when |
> |---|---|
> | `handleIntakeCreate` — `production-write/index.ts:7705` | the team's native epoch is set |
> | `handleComponentFill` — `production-write/index.ts:7081` | the team's native epoch is set |
>
> Both write exactly the shape this blocker says is missing. The 7081 site says
> so in its own comment: *"A newly created native component has a known empty
> label selection."* So `nativeLabelSnapshot` gets its `nodes` array and its
> `hasNextPage: false`, `handleLabelsRead` never reaches the 409, and the
> control renders an editable empty list — `Add labels`, not
> `Labels unavailable`.
>
> **Measured live before the flip:** *every* native-intake card already carried
> the complete empty relation. The seed migration was written anyway and
> applied; its backfill touched **9 rows, none of them from native intake** — 6
> provider-era real cards from 2026-09-15 and 3 old test cards, all lacking a
> Linear issue for other reasons. Those 9 are correctly seeded, "no labels" is
> truthful for a card with no issue, and the trigger remains right for exactly
> that population. The migration is pinned by the deploy gate, so it stays.
>
> **The mistake, stated so it is reusable.** The search was `migrations/*.sql`.
> One layer was searched; the claim made was about the whole system. Before
> asserting that *nothing* does X, name the layers where X could live and say
> which ones were searched — here that is at least `migrations/*.sql`,
> `supabase/migrations/*.sql`, `supabase/functions/**` and `index.html`. This
> is the same error shape as B-1 (reasoning from the record instead of
> measuring) and it is the fourth instance recorded in the journal.
>
> The second follow-up this blocker implied — a `_prodLabelErrorText` branch for
> `native_label_state_incomplete` — is **still open and still worth doing**, for
> the 9 seeded cards and any future card with no issue. It is cosmetic: the
> tooltip on such a card still says *"Retry to check the current Linear
> state."*, which names Linear on a card that never had a Linear issue.

---

## Gate 0 — is Linear still reachable? (owner, read-only, ~1 minute)

```powershell
node scripts/linear-label-catalog-export.js export `
  --out=$env:USERPROFILE\.syncview\b7-gate0 --skip-card-state
```

It resolves the workspace and both team ids **before** it captures anything
(`runExport` checks `organization`, `video`, `graphics` first), so a dead
credential or a lapsed workspace fails in the first request and writes nothing
useful. Read-only against Linear and Postgres either way.

- **Exit 0 and `RECONCILED`** → Linear still answers. This is no longer a
  rehearsal: it is the real capture of half (a). Keep the package, do not delete
  it, and go to step 26.1 — but re-run without `--skip-card-state` so half (b)
  is taken in the same window.
- **Any failure naming HTTP 401/403, or the workspace not resolving** → access
  has lapsed. Go to *If Gate 0 fails*.

### If Gate 0 fails

Step 26 for this capability **cannot be completed**, now or later, and that
should be recorded rather than retried. The consequence, in the foundation
document's own words, is that labels are frozen at whatever the database holds,
permanently, for both teams.

The capability then stays at `mode:"provider"` — which is *not* containment, it
is the pre-install state — and the honest step 28 entry is that this website
dependency has **no accepted replacement**. Per the execution map: *"Stop on any
required path with no accepted replacement."*

Do not flip the flag to `native` with a synthesised manifest. See B-2.

---

## (a) What the capture must contain, and what the owner must personally verify

### The command

Exactly the runbook's, unchanged, from the repository root on the owner's
machine:

```powershell
node scripts/linear-label-catalog-export.js export --out=$env:USERPROFILE\.syncview\b7-label-capture
```

Credentials come only from the approved private secret mechanism:
`LINEAR_API_KEY` (or `LINEAR_API_TOKEN`), `LINEAR_VIDEO_TEAM_ID`,
`LINEAR_GRAPHICS_TEAM_ID`, and for half (b) `SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY`.

**Do not rebuild this script, and do not run the GraphQL by hand.** It already
exists, it is read-only, and it names its own output.

### The queries it issues, and why each is the one required

| Query | Shape | Why |
|---|---|---|
| `WORKSPACE_QUERY` | `organization { id urlKey }` + `team(id:)` for **both** teams | Resolves the workspace fingerprint and proves both team ids exist and differ, **before** any capture. `production_label_catalog_check_manifest` refuses `teams.video = teams.graphics` |
| `CATALOG_QUERY` | `issueLabels(first, after, includeArchived: true)` → `nodes { id name color description isGroup archivedAt retiredAt team { id } }` + `pageInfo { hasNextPage endCursor }` | Exactly the **eight** node fields the checker reads. Fewer is a refused manifest; more inflates it against its own 5 MiB ceiling. **`retiredAt` joined the list on 2026-09-18** — a capture without it is refused with `label_catalog_label_invalid`, which is exactly why a package taken before that date must be retaken |
| `CATALOG_QUERY` again, **different page size** | same | The independent walk behind `independent_count_reconciled` |
| `SELECTED_LABELS_QUERY` | `issue(id) { labels(first, after) }` | Half (b) only, and only for cards the native writer would refuse |

### Both teams, archived included, pagination and count evidence

All four are structural requirements of
`production_label_catalog_check_manifest`
(`migrations/2026-09-05-native-label-catalog-foundation.sql:40-137`), not
preferences:

- **Both teams** — `teams.video` and `teams.graphics` must each be a UUID and
  must differ (lines 63-66).
- **Archived included** — `include_archived` must be exactly `true` (line 58),
  and archived entries are validated **before** applicability filtering.
  `production_label_catalog_read_version` filters them back out when it serves a
  team; they are completeness evidence, not applicable labels. Dropping them is
  a `label_catalog_count_mismatch`, not a tidier manifest.
- **Pagination** — a **closed cursor chain**: every page carries the previous
  page's `endCursor` in its own `after` (line 79), exactly one page may say
  `hasNextPage: false` and it must be the last (line 88), no cursor may repeat
  (line 91), bounded at 50 pages × 100 nodes.
- **Count** — `expected_count` must equal the nodes actually counted, or
  `label_catalog_count_mismatch` (line 133).
- **Original UUIDs** — every `id` must match the UUID pattern (line 105) and be
  unique across the whole capture (line 118). These are Linear's own identities;
  the writer stores them verbatim and never mints a replacement.

### The catalog is taken WHOLE; only half (b) honours "active cards only"

The owner's "only on active cards" ruling applies to per-card state, not to the
catalog. A filtered catalog cannot satisfy its own manifest — the closed chain
and exact count refuse partial evidence by construction. Taking it whole is
cheap: the checker itself bounds it at 5000 rows and 5 MiB.

Half (b)'s predicate, unchanged from the runbook:

```sql
 where d.status not in ('posted', 'canceled', 'duplicate')
   and d.linear_raw ->> 'archived' is null
```

**Record the active row count the script prints**, here and in OPEN_REPAIRS 170,
before attesting. After the window closes the exclusion is permanent.

### What the owner must personally verify — and what SQL cannot

Two attestation fields are assertions **a human makes**. The migration says so
in as many words (`2026-09-06-native-label-writes.sql:11-13`): *"SQL verifies
structure and equality, not whether a caller captured the entire workspace."*

Read `review-evidence.json` in the package, then satisfy yourself of exactly
these four:

1. **`archived_pages_verified`** — archived labels really were included. The
   evidence file reports the archived count; the query asked for
   `includeArchived: true`. **If that count is zero, do not wave it through** —
   decide whether the workspace genuinely has none, or the flag did not take.
2. **`independent_count_reconciled`** — the two walks at different page sizes
   agreed on the id set *and* on every label's content. The receipt must say
   `RECONCILED`. A package that diverged means the workspace changed
   mid-capture; re-capture, never attest it.
3. **The team mapping is right** — `teams.video` and `teams.graphics` are the
   two ids you mean and they differ.
4. **The catalog is the WHOLE workspace** — a closed page chain proves internal
   structure, not that the provider returned everything. This is the judgement
   only the owner can make, and it is the whole reason the `--confirm` token
   exists.

A self-consistent truncated file passes every one of the checker's structural
tests. A genuinely empty catalog needs the same complete zero-source evidence as
a full one.

**The package is PRIVATE** — workspace label names, client slugs and card ids.
Write it outside the repository. Never committed, never pasted into an issue,
never attached to a PR. The repo is public.

---

## (b) Installing a catalog version, and how the version id is attested

### The attestation step (still nothing sent to Postgres)

```powershell
node scripts/linear-label-catalog-export.js attest `
  --package=$env:USERPROFILE\.syncview\b7-label-capture `
  --subject="<role or handle, not an email>" `
  --confirm=REVIEWED_COMPLETE_LINEAR_LABEL_EXPORT
```

`--confirm` is the owner's assertion, not the script's. It writes
`label-catalog-attestation.json`, `3-stage-attested.sql` and
`4-capability-flag.sql` into the package.

### The exact RPC

One door, and only one:

```sql
select public.production_label_catalog_stage_attested(
  '<version_id>'::uuid,
  <manifest>::jsonb,
  <attestation>::jsonb
);
```

Run it as the **service role** — it is `revoke all … from public, anon,
authenticated, service_role` then `grant execute … to service_role`
(`2026-09-06-native-label-writes.sql`, final block). **Require `ok: true` in the
result.** Idempotent: the same bytes return the same row; different bytes raise
`label_catalog_version_conflict`.

Do not hand-write this SQL. `renderStageAttestedSql` emits it with the manifest
dollar-quoted using a tag the payload cannot contain.

### How the version id is attested

The `version_id` is a fresh UUID the `attest` subcommand mints
(`crypto.randomUUID()`, or `--version-id` to pin one). It is **not** itself
signed — it is a primary key. What is bound to it is the attestation blob, and
`production_label_catalog_stage_attested` refuses unless **every one** of these
holds (lines 18-33):

| Field | Bound to |
|---|---|
| `contract` | exactly `operator-reviewed-complete-export-v1` |
| `source_sha256` | equal to the manifest's — the digest of the original Linear response bytes, re-derivable from `raw-pages.ndjson` alone |
| `workspace_fingerprint` | equal to the manifest's |
| `teams` | equal to the manifest's, whole object |
| `expected_count` | equal to the manifest's |
| `capture_id` | equal to the manifest's |
| `export_package_sha256` | 64 hex — digest of the whole package |
| `review_evidence_sha256` | 64 hex — digest of `review-evidence.json` |
| `operator_subject` | non-empty string, ≤128 chars |
| `archived_pages_verified` | exactly JSON `true` |
| `independent_count_reconciled` | exactly JSON `true` |
| `reviewed_at` | strict `YYYY-MM-DDTHH:MM:SS[.ffffff]Z`, and castable |

The row is then immutable by trigger on update, delete **and** truncate
(`2026-09-05-native-label-catalog-foundation.sql`). There is no undo and none is
needed: staging a version changes no behaviour by itself. An unattested older
version **cannot** be promoted in place — attestation only ever creates a new
version.

Re-check the **package**, without trusting its receipt:

```
node scripts/linear-label-catalog-export.js verify --package=<dir>
```

which re-validates the manifest and re-derives `source_sha256` from
`raw-pages.ndjson`.

> ⚠ **This does not prove the version landed in the database, and must not be
> read as if it did.** `runVerify`
> (`linear-label-catalog-export.cli.js:499-515`) opens
> `label-catalog-manifest.json`, `capture-receipt.json` and `raw-pages.ndjson`
> from the package directory and **never connects to Postgres**. It proves the
> package is internally consistent and unmodified since capture — nothing about
> what `3-stage-attested.sql` did.
>
> That distinction is load-bearing here, because the next section says the
> capability flag does not validate that its `version_id` exists either. If
> neither the flag nor this command checks, and the staging script's own
> `ok:true` goes unread, a wrong or absent version reaches production and
> surfaces only as a 503 one call later.
>
> **Landing proof is a database readback of the version id in
> `production_label_catalog_versions`** — which was taken on 2026-09-18 at
> **19:45Z**, before the flag was flipped at 20:02:56Z. That readback, not this
> command, is the evidence that `f55a7dd2` is staged and attested.

---

## (c) The on value, the readback, step 27, and the rollback

### ⚠ The flag does not guard itself — order is load-bearing

`production_label_catalog_capability()`
(`2026-09-06-native-label-writes.sql:57-72`) reads **only** the runtime flag. It
never queries `production_label_catalog_versions`. Set `mode:"native"` with any
well-formed UUID and capability cheerfully reports `native` **with nothing
staged**; the refusal lands one call later, as a 503 inside
`production_label_catalog_read_attested`.

So step (b) must be **observed to return `ok:true`** before this runs. The flag
will not tell you.

### The exact on value

```sql
update public.syncview_runtime_flags
   set value = '{"schema_version":1,"mode":"native","version_id":"<version_id>"}'::jsonb,
       updated_by = 'b7-label-catalog-capture'
 where key = 'production_native_label_catalog';
```

> ✅ **This is what was run.** The live value carries
> `"mode":"native"` with version `f55a7dd2`, set 2026-09-18T20:02:56Z against
> `production-write` **v77** deployed at `b7c30c74`.

All three keys are mandatory and the shape is validated on every read:
`schema_version` must be exactly `1`; `mode` one of `provider|native|hold`; and
`version_id` must be a lowercase-hex UUID when `mode='native'` and exactly JSON
`null` otherwise. Anything else raises `native_label_catalog_config_invalid` and
the gateway turns that into a 503.

### The readback (service role, read-only)

```sql
select public.production_label_catalog_capability();
select public.production_label_catalog_read_attested('<version_id>'::uuid,'video');
select public.production_label_catalog_read_attested('<version_id>'::uuid,'graphics');
```

Expect from the capability call exactly the object written above. Expect from
**each** team read `ok:true`, `operator_attested:true`,
`verification_state:"operator_attested"`, the matching `version_id`, a 64-hex
`manifest_sha256` and a 64-hex `attestation_sha256`. Run **both** teams: the
manifest maps them separately and a wrong mapping shows up here or nowhere.

`provider_completeness_verified` stays `false`. That is correct and permanent —
it is not a check that was skipped.

> ✅ **Measured, and the counts are much smaller than the catalog. This is the
> readback's most misreadable result, so read it before you call it a bug.**
>
> | team | applicable labels served |
> |---|---|
> | `video` | **2** |
> | `graphics` | **6** |
>
> **Not 27 workspace-wide**, which is what "the catalog has 46 labels, 19 of
> them retired" invites you to expect. The serving filter is per team by
> construction — `production_label_catalog_read_version` ends with:
>
> ```sql
> where n->'isGroup' = 'false'::jsonb and n->'archivedAt' = 'null'::jsonb
>   and n->'retiredAt' = 'null'::jsonb
>   and (n->'team' = 'null'::jsonb or n->'team'->>'id' = v_row.manifest->'teams'->>p_team)
> ```
>
> Four independent reasons a captured label is not served to a given team:
> it is a **group**, it is **archived**, it is **retired**, or it **belongs to
> the other team**. Only a label with `team: null` is genuinely workspace-wide
> and reaches both. So the catalog count and the served count answer different
> questions, and a small served number is the filter working rather than a
> partial capture.
>
> **The capture is still whole**, and must be: dropping the unserved entries
> would be a `label_catalog_count_mismatch`. Completeness lives in the manifest;
> applicability is decided per read.

Also confirm, before anyone touches the UI, that `prod_authority` is `syncview`
for the team under test. `handleLabelsRead` only consults the capability when
authority is `syncview` (`index.ts:5604-5605`); on a `linear` team the native
branch is unreachable and the flag does nothing.

### Step 27 acceptance checks

> ### ⏳ STEP 27 IS IN PROGRESS — check 6 is 2 of its 3 refusals
>
> **Corrected 2026-09-18, after a Codex P1 on #1420.** A previous revision of
> this block said all seven checks were measured and step 28 was recorded. That
> was wrong, and wrong in the way this file exists to prevent: **check 6 names
> THREE refusals, not two.** Four hundred lines below, the acceptance contract
> reads *"A `client` principal → 403. A role outside `admin|smm` →
> `native_label_scope_forbidden`. A stale `catalog_version` from an old tab →
> 409 `native_label_catalog_changed`."* The evidence covered the first and the
> third. The middle one was never run, and the split into a "403 half" and a
> "409 half" invented a two-part check that the contract does not contain.
>
> That is the eighth instance of this shape, and the first committed **while
> editing the document written to stop it**. The rule the seventh instance
> produced — *when a step has enumerated acceptance checks, report per check* —
> was followed at the level of the check number and abandoned one level down.
> The rule is therefore narrower than it needed to be, and its replacement is:
> **re-read the acceptance text for every check being closed, in the run that
> closes it. A check with sub-clauses is not closed until each clause is named.**
>
> An earlier revision of this file said "STEP 27 PASSED" on the strength of
> receipts 10536 and 10537 alone. **Those two receipts prove check 2 and
> nothing else**, and that overclaim is left recorded rather than tidied away.
> What follows is the per-check state that actually closes the step.
>
> | # | What it checks | State | Evidence |
> |---|---|---|---|
> | 1 | Read, both teams, no Linear request | ✅ | seen by the owner |
> | 2 | Write, then assert the receipt | ✅ | receipts **10536** and **10537** |
> | 3 | The row actually changed | ✅ | `labelIds` and `labels.nodes` agree, `hasNextPage` false, row updated **20:08:02Z** (supervisor) |
> | 4 | Exact replay is idempotent | ✅ | storage session, on the **test card**, receipt **10579**, journal **`edf78a6a`** |
> | 5 | Provider debt is conserved | ✅ | `labels` debt **0** before and after the flip, no row touched |
> | 6a | Refusal: `client` principal → **403** | ✅ | offline, `test/production-write-gateway.js` — see below |
> | 6b | Refusal: role outside `admin\|smm` → **`native_label_scope_forbidden`** | ❌ **NOT RUN** | — see *The refusal nobody ran* |
> | 6c | Refusal: stale `catalog_version` → **409** | ✅ | storage session, receipt **10579**, journal **`edf78a6a`** |
> | 7 | Both teams, on real cards | ✅ | video earlier; **graphics on receipts 10575 and 10576** |
>
> **Remaining before step 27 can be called complete: check 6b.**
>
> ### The refusal nobody ran, and a question about how it is written
>
> Check 6b is not covered, and the nearest existing evidence is another near
> miss of the kind this file keeps collecting.
> `test/native-label-seed-parity-postgres.js` asserts
> `native_label_scope_forbidden` five times — but every one of them is about the
> **test_only / `auth_kind` binding**, not about a staff role. Same error code,
> different cause, different question. Citing it would repeat the exact mistake
> that produced this correction.
>
> **And the contract may name the wrong code.** The guard that emits
> `native_label_scope_forbidden` is `index.ts:6425-6427`:
>
> ```ts
> if (! ["staff", "test"].includes(principal.kind) || legacyParity) {
>   throw new GatewayError(403, "native_label_scope_forbidden");
> }
> ```
>
> That gates on the principal's **kind** and on `legacy_parity` — not on the
> staff **role**. The `admin|smm` restriction lives in the policy table
> (`staffOperationAllowed`, where `creative` gets `labels: false`) and refuses
> with `operation_forbidden`. So a role outside `admin|smm` may well be refused,
> correctly, by a different code than the one check 6b names.
>
> **This session is not deciding that.** Either the check's wording needs
> correcting or a path emits that code for a role and has not been found; both
> are readings that belong to whoever ratified the contract. What is recorded
> here is only what was measured: 6b was not run, and nothing offline covers it.
>
> **Two things about this table that are not measurements of mine.** Checks 4,
> 6-409 and 7-graphics were run by the storage session and are recorded here as
> reported to this session. Journal `edf78a6a` is their primary record; it is
> not reachable from this repository at the time of writing, so this session has
> not read it. Checks 1, 3 and 5 are likewise the owner's and the supervisor's.
> Only the 403 half of check 6 was measured here.
>
> ### The 403 half of check 6 is an offline assertion, and it did not exist until now
>
> Check 6 needs a **client** principal to be refused a labels write. Nothing in
> the suite asserted that. Three tests came close and each measured something
> else:
>
> | Nearest existing test | What it actually measures |
> |---|---|
> | `test/production-write-gateway.js`, `handleLabelsRead` assertion | the labels **read**, not the write |
> | `test/production-write-gateway.js`, the `brief`-leakage assertion | a regex on this guard's *condition*, inside an unrelated claim, never naming the status |
> | `test/production-write-auth-matrix.js`, the `labels: false` client row | `clientOperationAllowed`, **which the labels write path never calls** |
>
> That last one matters most. The labels write is refused earlier and
> unconditionally, at `index.ts:5932-5935`:
>
> ```ts
> if ((operation === "labels" || operation === "description" || operation === "attachment")
>     && principal.kind === "client") {
>   throw new GatewayError(403, "operation_forbidden");
> }
> ```
>
> The policy table is never consulted, so a green auth matrix was never evidence
> about this gate. Five assertions were added to `test/production-write-gateway.js`
> which **execute that guard's real bytes** in a sandbox with a mocked
> `GatewayError`, rather than matching them with a regex: a client principal on
> `labels` yields `403 operation_forbidden`; so do `description` and
> `attachment`; a staff or service principal passes through; and `status` and
> `comment` are left to their own policy. The slice is anchored on the exact
> source text, so a reworded guard fails the test loudly instead of quietly
> asserting nothing. Confirmed to fail when the guard's condition is defeated.
>
> No live call. This half of check 6 is offline by construction — refusing a
> client principal is a property of the deployed source, and running it against
> production would mean authenticating as a real client.
>
> ### ⚠ Check 4 is only satisfiable by a STAFF principal — do NOT run it as the test client
>
> **Still true, and check 4 passed without contradicting it.** The storage
> session ran check 4 on the test *card*, not as the test *client*. The gate
> below excludes `principal.testOnly`, which is a property of the credential,
> not of the card's owner, so a staff principal writing to a test client's card
> reaches the shortcut normally. Keep the constraint: it is the principal that
> is excluded.
>
> This is a real constraint in the gateway, not a preference. The
> accepted-receipt replay shortcut is gated at `index.ts:5977-5978`:
>
> ```ts
> if (operation === "labels" && entity === "deliverable" && surface === "production"
>     && principal.kind === "staff" && ! principal.testOnly && body.legacy_parity !== true) {
> ```
>
> `! principal.testOnly` **excludes the test client**. A TEST replay never
> reaches the shortcut; it falls through to the generic response
> (`index.ts:6734-6753`), which carries **none** of `replayed`, `read_only` or
> `authority_source`. So running check 4 as `sidneylaruel` produces a response
> that fails the check for a reason that has nothing to do with idempotency,
> and reads as a regression when it is not one.
>
> **Consequence for B-3's resolution:** the test client can now exercise the
> label *write* lane, which is what #1414 delivered and what it was for. It
> **cannot** exercise the replay shortcut. Check 4 therefore still needs a staff
> principal on a real card, exactly as check 7 does, and B-3 being resolved does
> not change that. The earlier note here saying check 7 no longer needs the
> owner's named go-ahead was wrong on the same point and is withdrawn.
>
> Whether that exclusion is itself correct is a separate question and not one
> this file answers. It is deliberate — the comment above it says an accepted
> receipt is "a read-only result adoption, not renewed admission" — but nothing
> records why the test client is outside it.

Run them in this order; each one can fail without damaging the next.

**1. Read, both teams.** Open a card whose stored relation is `complete` and
confirm the picker lists the catalog and the current selection. Server-side this
is `index.ts:5608-5618` and it must make **no Linear request at all**.

**2. Write, one card, one label added then removed.** Then assert the receipt —
an HTTP 200 is not enough:

```sql
select status, processed_at, next_retry_at, last_error, linear_result,
       payload -> '_native_label_catalog_version' as marker
  from public.mirror_outbox
 where dedup_key = '<the dedup key>';
```

Required: `status = 'skipped'`, `next_retry_at` null, `last_error` null,
`linear_result = {"native_labels":true,"catalog_version":"<version_id>"}`, and
the marker equal to `<version_id>`. It is inserted **directly** as skipped — it
is never briefly `pending`, never new provider debt, and launches no drainer.

**3. The row actually changed.** `deliverables.linear_raw -> issue -> labelIds`
and `-> labels -> nodes` agree, sorted by id, and `pageInfo.hasNextPage` is
`false`.

**4. Exact replay is idempotent.** Re-send the identical request. No new receipt
and no new event may appear, and the response must carry
`replayed:true, read_only:true, authority:"syncview",
authority_source:"accepted_native_receipt", mirror.attempted:false`, plus the
same `catalog_version`.

Note where that response comes from: a dedicated gateway short-circuit at
`index.ts:5998-6001`, which runs **before** the main write path. The SQL
function has its own separate adoption arm
(`2026-09-06-native-label-writes.sql:141-148`) which returns the deliverables
row and raises `idempotency_conflict` if the retained receipt's marker, status
or `linear_result` disagree. Both paths exist; check the gateway fields on the
response and the receipt in SQL, because a green HTTP body does not prove the
receipt was left alone.

**5. Provider debt is conserved.** Count `mirror_outbox` rows that are `pending`
or `failed` for `operation='labels'` before and after. The number must not move,
and no drainer may restart. A newly native capability must not reclassify or
requeue existing provider receipts.

**6. The refusals fire.** A `client` principal → 403. A role outside
`admin|smm` → `native_label_scope_forbidden`. A stale `catalog_version` from an
old tab → 409 `native_label_catalog_changed`.

**7. Both teams, on real cards.** See B-3: there is no TEST path, so this
requires the owner's named go-ahead for a real client, or the parity migration
first.

### The rollback — `hold`, and why not `provider`

> ✅ **This is the live kill switch.** The capability is on, so this is no
> longer a contingency in a plan: it is the one statement that turns labels off
> safely, and it is the first thing to reach for if the lane misbehaves. Keep
> `version_id` as JSON `null` — a UUID here raises
> `native_label_catalog_config_invalid` and the gateway turns that into a 503,
> so a malformed rollback fails loudly rather than silently leaving `native` on.

```sql
update public.syncview_runtime_flags
   set value = '{"schema_version":1,"mode":"hold","version_id":null}'::jsonb
 where key = 'production_native_label_catalog';
```

`version_id` **must** be `null` here, or the capability read raises
`native_label_catalog_config_invalid`.

`hold` blocks fresh label writes with 503 `native_label_catalog_held` and
**keeps the compatible gateway**. `provider` is *not* real containment: the
provider path needs a live Linear credential, so it stops working the moment
Linear is gone — which is the whole reason this capability exists.

Never, per the foundation record: delete the flag to mimic pre-install absence;
strip the `_native_label_catalog_version` marker; requeue a skipped receipt;
disable the guards; or roll back to a gateway that would treat native work as
provider debt. **Preserve every catalog version, attestation, event, journal and
receipt.** Returning to `provider` is a separate reviewed reconciliation, not a
rollback. Withdrawing uninstalled source is reversible; deleting accepted data
is not.

---

## (d) What "Labels unavailable" becomes

### Today, on a native card

`handleLabelsRead` takes the provider branch, `linearIssueIdForLabels` returns
`""` because the card has neither `linear_issue_uuid` nor `linear_raw.issue.id`
(`index.ts:4499-4502`), and it throws 409 `linear_issue_unavailable`
(`index.ts:5619-5620`).

In the browser `_prodEnsureLabels` catches it and stores
`status:'error'`, with text from `_prodLabelErrorText` — which has no branch for
that code, so it falls to the default **"Labels could not be loaded. Retry to
check the current Linear state."** The control then renders, at
`index.html:58266-58267`:

```js
content = '<span class="prod-label-muted">Labels unavailable</span>';
info    = state.error || 'Labels unavailable';
```

and the popover renders the error state with a Retry button
(`index.html:58311-58313`) that re-fires a request which cannot ever succeed.

### After the flag is on — for a card whose stored relation is `complete`

`handleLabelsRead` takes the native branch (`index.ts:5608`) and returns
`catalog_version` plus the merged catalog and selection. The browser stores
`catalogVersion` from the payload (`index.html:53309`) and the control renders
the real chips, or `Add labels` when the selection is empty
(`index.html:58274-58277`):

```js
content = state.selected.length
    ? state.selected.map(_prodLabelChipHTML).join('')
    : '<span class="prod-label-muted">Add labels</span>';
```

The popover becomes the searchable catalog list (`index.html:58317-58333`), and
saving sends the version back (`index.html:58405`):

```js
const json = await _prodGatewayWrite(issue, 'labels', { label_ids: labelIds,
    ...(state.catalogVersion ? { catalog_version: state.catalogVersion } : {}) });
```

A tab holding a stale version gets 409 `native_label_catalog_changed`, which is
classified `reload` (`index.html:29143-29144`) — visible reload guidance, with
no Linear fallback. That is the intended behaviour.

### After the flag is on — for a natively-created card

> ⚠ **CORRECTED — it does NOT still say "Labels unavailable."** A natively
> created card gets the same editable list as any other complete card: the real
> chips, or `Add labels` when the selection is empty. The paragraph below is
> wrong for exactly the reason B-4's correction gives — the empty-but-complete
> relation is stamped by the gateway at intake, so `nativeLabelSnapshot`
> succeeds and `handleLabelsRead` never reaches the 409.
>
> It remains accurate for the **9 backfilled cards that have no Linear issue for
> other reasons**, and for any future card in that position. For those, the
> tooltip naming Linear is still the open cosmetic follow-up.

**It still says "Labels unavailable."** See B-4. The code changes from
`linear_issue_unavailable` to `native_label_state_incomplete`
(`index.ts:5611`), both render the same string, and `_prodLabelErrorText` still
has no branch for either — so the tooltip on a card that has no Linear issue
reads *"Retry to check the current Linear state."*

Two follow-ups this implies, neither in scope here:

- the seed migration in B-4, without which step 27 has nothing to demonstrate on
  native cards;
- a `_prodLabelErrorText` branch for `native_label_state_incomplete`, so the
  message stops naming Linear on a card that never had a Linear issue.

> Status of the two: the **first is done** (merged and applied in #1414, though
> for a different and smaller population than predicted — see B-4). The
> **second is still open**, and is now the only known rough edge left on this
> capability.

---

## Which lane needs the Linear API key

| Lane | Needs a Linear key? | Which |
|---|---|---|
| **The capture** (`scripts/linear-label-catalog-export.js`) | **Yes** | `LINEAR_API_KEY` / `LINEAR_API_TOKEN`, plus both team ids; half (b) also needs `SUPABASE_SERVICE_ROLE_KEY` |
| **production-write, provider label path** | **Yes** | `LINEAR_MIRROR_API_KEY`, read in `linearLabelsRequest` (`index.ts:841-843`); absent → 503 `label_catalog_unavailable` |
| **production-write, native label path** | **No** | `handleLabelsRead` returns at `index.ts:5612-5618` before `linearLabelSnapshot` is ever reached, and `production_labels_write` makes no outbound request |
| **Staging / the flag flip** | **No** | Both are pure Postgres, service role |

That asymmetry is the point of the capability: **turning it on is precisely what
removes the Linear credential from the label read and write path.** The credential
is needed once, to capture — and never again.

`LINEAR_MIRROR_API_KEY` is also read by `linear-outbound` and `workload-linear`,
which are out of scope here and keep their own need for it.

## Who runs the capture — not this session, and not the storage session

**Neither.** It is an owner action on the owner's machine, and the reasons are
not procedural fussiness:

1. It needs a live Linear credential and, for half (b), the Supabase service
   role key. Neither reaches a session, and the runbook already says so:
   *"These are for the owner. No session runs any of them."*
2. Its output is a **private** package carrying workspace label names, client
   slugs and card ids. This repository is public, and the identity-exposure gate
   fails on any client slug a change adds. The package must be written outside
   the repository and must never be committed, pasted or attached.
3. `--confirm=REVIEWED_COMPLETE_LINEAR_LABEL_EXPORT` asserts that *a human read
   the evidence and satisfied himself the export is the complete workspace
   catalog*. A session cannot truthfully make that assertion. It is the one
   input the whole immutable attestation rests on.

The pattern is the F27 capture in `CLAUDE.md`: the script exists, it carries what
it needs, it names its own output file, and it runs from any directory. Hand the
owner the command, not the GraphQL.

**If the owner ever delegates the package's custody** — reviewing
`review-evidence.json`, holding the private files, moving them to Drive — the
**storage session** is the right one, because private-package custody and the
Drive lane are already its job. That is a custody role only. It does not extend
to running the capture, and it does not extend to making the attestation, which
stays with the owner under point 3 above.

---

## Order of operations, once Gate 0 is green

1. **Gate 0** — Linear still answers. *(owner, read-only)*
2. **Resolve B-3** — parity migration, or a named real client. *(owner decision)*
3. **Resolve B-4** — the empty-relation seed migration for native cards. *(session, PR, not merged)*
4. **Capture**, both halves, in one window. Record the active row count. *(owner)*
5. **Verify** the four attestation items; `attest`. *(owner)*
6. **Confirm the two migrations are installed** and `prod_authority` is
   `syncview` for the team under test. *(read-only preflight, from the owner's
   machine — never for the first time inside the live step)*
7. **Stage** — `3-stage-attested.sql`, require `ok:true`. *(owner)*
8. **GATE** — explicit go-ahead for this one capability. *(owner)*
9. **Flip** — `4-capability-flag.sql`; then the readback in (c). *(owner)*
10. **Step 27 acceptance checks**, both teams. *(session + owner)*
11. **Step 28** — record the dependency this closes. *(session)*

Steps 1, 4, 5, 7 and 9 are the owner's alone.

> ✅ **Steps 1 through 9 ran on 2026-09-18, in this order, and are complete.**
> Gate 0 passed; B-3 was resolved by the parity migration and its `auth_kind`
> binding; B-4 turned out not to be a blocker at all; the capture was taken,
> verified and attested; staging returned `ok:true` and was **read back from
> `production_label_catalog_versions` at 19:45Z**; the flag went to `native` at
> 20:02:56Z on version `f55a7dd2`.
>
> ⏳ **Step 10 (execution map step 27) is IN PROGRESS.** Six of seven checks are
> measured; check 6 is **2 of its 3 refusals**, and 6b — a role outside
> `admin|smm` — was never run. See *Step 27 acceptance checks*.
>
> ⛔ **Step 11 (execution map step 28) is WITHDRAWN.** A closure was written and
> is now marked withdrawn in the checkpoint's dependency table rather than
> deleted, because the reasoning that produced a premature closure is worth more
> than a tidy file. It becomes valid when 6b is measured.
>
> Note for the next capability that comes through this sequence: steps 2 and 3
> here were both *blockers derived by reading rather than measuring*, and one of
> the two was simply not real. Run the cheap live gate first.
