# F42 Brick 1 — link-defect repair plan

> Status: **NON-AUTHORITY.** This document authorizes nothing. It does not apply a migration,
> deploy a function, or approve a write. The apply runs only inside a separate owner-approved
> window, after cloud review of this PR, and the apply itself takes a second review by Codex
> after 2026-07-28.
>
> Investigation and evidence: `docs/independence/F42_CARD_DELIVERABLE_LINKAGE_REPORT.md`.

## What this repairs, and what it deliberately does not

A `deliverable_crosswalk_mismatch` is a card whose deliverable **exists** but does not describe
that card, so `production_comment_card_import` refuses the row. Unlike a deferral it does **not**
resolve itself. There are 35 such comment rows live, all on the calendar surface, in three classes
that reproduce exactly against production data:

| Class | Reason string | Rows | Repaired here? |
| --- | --- | ---: | :--: |
| A | `crosswalk_fields:card_id,origin` | 27 | **yes** |
| B | `crosswalk_fields:team` | 6 | **yes** |
| C | `crosswalk_fields:card_id` | 2 | **no — owner ruling** |

This brick writes **only** the `deliverables` table. It never touches a card column, never touches
`production_comments`, never creates a row, and never deletes one. Every write is a field
correction on an existing row.

### Class A — the unstamped deliverable (27 rows)

The deliverable is still sitting at its `origin='manual'`, `card_id=NULL` default while a card
points at it. Live evidence that this is the mechanism, not a guess: **zero** of the 4,126
`origin='manual'` deliverables carry a `card_id`, and `scripts/b3-linkage-backfill.js` states in its
own header that it "never changes … deliverables" and only PATCHes the card tables. These 27 rows
are the residue of that card-side-only link write.

**Authoritative side: the card.** It names the deliverable it intends; the deliverable was simply
never stamped. The repair finishes the half-done link:

```
UPDATE deliverables SET origin = <'calendar'|'samples'>, card_id = <card.id>
```

Refused rather than guessed when any of these hold — each is a test case:

- the deliverable already claims a different card (`deliverable_already_claims_a_card`);
- its `origin` is not `manual` (`origin_is_not_manual`);
- `client_slug` or `team` disagree (`client_slug_disagrees`, `team_disagrees` — structurally
  unreachable for this field-set, kept as defence in depth);
- **its `kind` does not match the card slot** (`kind_does_not_match_the_card_slot`) — `team` alone is
  too coarse, because `team='video'` covers both `kind='video'` and `kind='other'`, and stamping a
  card onto the wrong kind creates a link the crosswalk accepts but that addresses the wrong
  artifact;
- **the card and the deliverable do not provably name the same Linear issue**
  (`linear_identity_unproven` when either side names none, `linear_identity_disagrees` when they
  differ). Without this the card is stamped onto whatever unclaimed deliverable happens to sit in
  its client+team space. Unproven is not permission;
- the write would collide with `deliverables_card_slot_unique`
  `(client_slug, origin, card_id, kind)` (`card_slot_unique_would_collide`);
- **the write would invalidate any current consumer** (`would_invalidate_consumer:<fields>`) — see
  below.

### Class B — team disagrees with kind (6 rows)

`origin`, `card_id` and `client_slug` all match, so the deliverable was genuinely born from this
card, but `team` disagrees with the component. The cause is 60 deliverables whose `kind` and `team`
are inconsistent (58 `kind='thumbnail', team='video'`; 2 `kind='video', team='graphics'`). The
crosswalk validates `team`; the card slot and `kind` imply the truth.

**Authoritative side: `kind` plus the card slot.** The repair corrects the one wrong field:

```
UPDATE deliverables SET team = <'graphics'|'video'>
```

Refused when `kind` does not imply the repair, or when `team` is already correct.

> The other 54 inconsistent rows are latent defects that will surface as soon as their cards gain
> comments. This brick repairs only the 6 that currently block an import; whether to correct all 60
> in the same window is **Q-B2** below.

### Every current consumer must survive the repair

A deliverable can be named by more than one card slot — `video_deliverable_id` alone governs video,
caption and title, and nothing stops two slots pointing at one row. The defect scan only sees slots
that **carry comments**, so a quiet, comment-free slot is invisible to it while still being a live
consumer.

That matters most for Class B: correcting `team` to satisfy a commented graphic slot can silently
**invalidate** a comment-free video slot on the same card that is crosswalk-clean today. The planner
therefore enumerates every `(surface, card, component)` slot naming each deliverable — commented or
not — and refuses any repair that would turn a currently-clean consumer into a mismatched one. A
consumer that is already mismatched cannot be made worse by a repair aimed at it, so only
currently-clean consumers veto.

### Class C — bound to another card (2 rows)

A correctly-formed deliverable is bound to a **different** card. Authority is genuinely ambiguous:
repointing orphans the other card (which may already have imported comments under it); clearing the
pointing card's column returns its rows to the deferral bucket. **The runner never repairs Class C.**
It escalates each row into `plan.owner_rulings` with the specifics the owner needs — the card, the
component, the deliverable, the card it is currently bound to, and both options — in the
**runner-local plan only**, never in the public summary.

## Scope policy — QA-fixture exclusion

Cards whose Linear link points at a QA-fixture workspace are not client work and must never be
repaired or imported. Per the owner's **provisional** ruling, the excluded workspaces are:

```
x, sidtest, syn, acme
```

This is encoded as `scope.policy = 'defect-repair-clear-authority-only'` plus
`scope.excluded_linear_workspaces`, and **both are inputs to the apply digest** — so changing the
ruling moves the digest and refuses a stale apply. `scope.excluded_workspaces_ruling` records
`provisional_pending_owner_signoff_at_window`, and the public summary prints it, so no run can
present the exclusion as settled before the owner signs it off at the window.

Context for why this matters (report §7): only 936 of 6,796 comment rows belong to active clients;
5,860 belong to test or internal clients. The exclusion is the difference between repairing real
client work and repairing fixtures.

## Release mechanics

Mirrors the F42 lane, with two corrections the investigation found in the existing tooling.

| Control | Behaviour |
| --- | --- |
| Plan / apply split | `--input` alone plans and prints; nothing touches the database without `--apply`. |
| **Input manifest (verified before planning)** | The exporter emits row counts per surface, a content hash of exactly what it wrote, and a `generated_at`. The runner verifies all three **before it plans**, so a truncated, hand-edited or stale export can never become a production write. Snapshots older than 6 hours are refused. |
| Digest pinning | `apply_digest` covers the scope policy, the fixture-exclusion list, and every write's `before`/`after` **and the full observed target row**. |
| **`--expected-digest` (mandatory)** | Apply throws `expected_digest_required_for_apply` without it. An optional drift guard is not a guard — the one run that forgets the flag is the one that applies a plan nobody reviewed. |
| **`--expected-writes` (mandatory)** | Apply throws `expected_writes_required_for_apply` without it, and blocks on mismatch. The existing lane had only `SAFETY_CAP` (default 600) — a plan that grew from 26 writes to 599 would have proceeded. |
| Owner confirm token | `F42_CONFIRM_LINKAGE_REPAIR=REPAIR_LINK_DEFECTS`. |
| **Live CAS on every write** | Each PATCH filters on the **full observed target state** — all five crosswalk fields plus `kind`, with a planned NULL `card_id` as `is.null` — and uses `Prefer: return=representation`. A row that drifted since the export matches nothing, returns zero rows, and is recorded as a **per-row refusal**. No row is ever overwritten on the strength of its id alone. |
| **Strict apply verification** | Exactly one returned row carrying exactly the intended after-state is the only accepted outcome. Zero rows, more than one row, a missing representation body, or any field mismatch is a refusal. |
| **Readback (mandatory)** | Apply throws `readback_layer_required_for_apply` without a readback adapter, and an absent or unparseable reading is `readback_missing` — a GAP. "We could not check" never renders the same as "we checked and it was fine". |
| **Rollback artifact (mandatory, never clobbered)** | `--rollback-artifact` is required for apply. The runner **refuses to overwrite an existing artifact path** — that file is the only record of how to reverse a previous run. Each row is journalled **before** its PATCH is issued. |
| Public-safety | The rendered summary is classification × surface × reason **counts only**. Asserted by test: the summary contains no card id, client slug or deliverable id. The private snapshot carries **no comment bodies at all** — only per-component counts. |

### Readback semantics — success is NOT zero defects

The unruled Class C rows are **expected** to remain, because this brick deliberately never repairs
them. Success is therefore:

```
remaining_defects === expected_remaining_defects   (the unruled Class C set)
```

Both *more* and *fewer* remaining defects than that residue are a `GAPS` result. A run that reported
zero remaining defects would mean something repaired Class C without a ruling.

### Idempotency

Every write is a field correction to a known prior value. Re-running after a successful apply
re-plans from live data, finds the rows already crosswalk-clean, and produces **zero writes** —
which `applyEligibility` then reports as `no_writes_planned`. There is no double-apply hazard.
The CAS predicate makes this stronger still: even a stale plan replayed against repaired rows
matches nothing and refuses every row.

### Rollback, and what crash recovery reads

The private artifact carries two lists:

- **`planned[]`** — every row the runner intended to write, with its `before` state. **This is what
  crash recovery restores from.** Restoring `before` on a row that was never written is a no-op,
  because the row is already in that state, so after an uncontrolled crash the safe reversal is to
  restore `before` for every *planned* row, in any order.
- **`attempted[]`** — the narrower record of rows the runner actually issued a write for, useful for
  reconciliation but **not** the recovery input.

Reversal is the inverse `UPDATE` per row; the writes are independent so order does not matter. NULL
and `''` are preserved distinctly, so a NULL `card_id` is restored as NULL — restoring `''` would
leave the row in a state it was never in, and one that still satisfies `card_id IS NOT NULL` in the
partial unique index. The artifact carries per-row identities and must be retained privately; it is
never uploaded to a public log.

## Ordering — this apply is blocked on the gate fix

Repairing a defect makes its card **crosswalk-valid**, which flips it to the canonical render path.
Before the canonical gate requires a valid link, a card whose comments are not yet imported would
render an empty canonical thread over its real legacy comments and persist the emptied `*_tweaks`
string on the next save.

**Therefore: the gate fix PR must be merged and deployed before this apply runs.** The repair PR may
be reviewed and merged independently; only the *window* is ordered.

### The window must end with the comment import APPLY, not a plan

Repairing a link and stopping is not a finished state. Between the repair and the import, the 33
affected cards are **crosswalk-valid but not yet imported** — precisely the window in which the
canonical surface has a valid link and an empty canonical thread. The gate fix makes that state
*safe* (legacy is preserved and still rendered), but it is still a half-migrated surface, and
leaving it open across sittings means every later reader depends on that fallback holding. The
repair and the import therefore complete **in the same sitting**.

**Owner-confirmed write freeze.** For the whole interval from the repair export to the import
readback, no staff or client comment writes may land on the affected cards, and no linkage-affecting
edit may be made to their deliverables. The owner confirms the freeze is in force before step 4 and
releases it only after step 8. Without it, a comment written between repair and import lands in the
legacy array of a card the import has already read, and the two sides diverge silently.

Sequence for the window:

1. Gate fix deployed and verified in the live app.
2. **Owner confirms the write freeze is in force** over the affected cards.
3. Fresh repair export → the runner verifies its manifest (counts + content hash + freshness).
4. Fresh F42 `mode: plan` dispatch to regenerate defect-row identities — **never** reuse identities
   from an old run; they are ephemeral per-run by design.
5. Repair plan run → owner reviews the counts and the Class C rulings → owner records the digest.
6. **Repair apply** — digest-pinned (`--expected-digest`), `--expected-writes` at the reviewed
   count, confirm token, rollback artifact path. Per-row CAS refuses anything that drifted.
7. Repair readback → `remaining_defects === expected_remaining_defects` (the unruled Class C set).
8. **F42 comment import APPLY** — not a plan. The 33 unblocked comment rows are imported in the same
   sitting, through the existing digest-pinned, owner-confirmed F42 apply lane.
9. Import readback confirms the expected canonical count.
10. **Classified `legacy_retained` breakdown** (below) — not a raw count.
11. Owner **releases the write freeze**.

### Step 10 — the `legacy_retained` convergence breakdown

After the import, cards whose canonical thread does not demonstrably carry their legacy content stay
on the legacy render and report `legacy_retained`. A raw count of those cards is **not readable**:
several classes are expected to be non-zero forever, so a non-zero total says nothing on its own.

Report one bucket per hold reason:

| Bucket | Hold reason | Expected |
| --- | --- | --- |
| **(a)** | Legacy row the importer rejects — missing id, unparseable JSON, JSON non-array, Samples plaintext. The row can never enter the canonical thread, and the guard holds the card for exactly that row. | non-zero forever |
| **(b)** | Epoch-vs-empty timestamp. Legacy seeders mint `created_at: ''`; the importer maps empty to the epoch, so the provenance keys can never match. | non-zero forever |
| **(c)** | Audience divergence. A staff reply carries no audience of its own and inherits `client` from its root in the legacy view, while the canonical client view filters per-row and drops it. Held so the client never loses a message. **Open owner question — see below.** | non-zero forever |
| **(d)** | Duplicate collapse, and any normalization difference in the raw body (trailing whitespace, CRLF vs LF), where canonical carries fewer copies than legacy. | non-zero forever |
| **(e)** | **Content mismatch** — canonical genuinely does not carry the legacy content, for none of the above reasons. | **should be zero** |
| **(f)** | Unrepresentable legacy state — a row carrying `hidden: true`, which `production_comments` cannot store. Measured live: 6 comment rows across 4 cards. | non-zero forever, and tiny |

**Buckets (a)–(d) and (f) are the known-permanent baseline.** Only **(e)** is a signal, and only (e)
should be investigated. A window that ends with (e) at zero has converged, whatever the total says.

Also worth recording at the window: `deleted: true` legacy rows (2,701 live) keep their body in the
card array while the canonical side blanks it, so any card that has ever had a comment soft-deleted
falls into (e) on the staff path today. That asymmetry is pre-existing and unfixed; expect it to
dominate (e) until it is addressed, and subtract it before treating (e) as a signal.

### Open owner question — the audience divergence behind bucket (c)

The legacy client view applies **root-audience inheritance** (a reply inherits its root's audience);
the canonical client view filters **per-row**. So adoption itself changes what a client can see: a
staff reply visible today would disappear.

The gate refuses to adopt in that case, which is the safe outcome, and cloud review has ruled that
the canonical client render must **not** be changed to root-inherit — widening what clients can see
is a privacy-direction product change that belongs to the owner, not to a hardening PR. Until the
owner rules, threads with unaudienced staff replies under client roots hold on legacy indefinitely
and are counted in bucket (c).

If step 8 cannot run — for any reason, including a blocked F42 plan — the window does not close
clean. Either roll the repair back with the artifact, or hold the freeze and finish the import
before releasing it. A repaired-but-unimported cohort left across sittings is an accepted-residual
decision for the owner to make explicitly, not a default.

## Expected outcome

- **33 comment rows** move from permanently-defective to importable (27 Class A + 6 Class B).
- **2 rows** await the owner ruling (Class C).
- Against the 327 production comment rows still outstanding after the existing import, this is
  roughly **10%** — not the 0.5%-of-6,032 the raw blocker number implies.

## Open questions for the owner

- **Q-B1 — Class C ruling.** For each of the 2 rows: repoint the deliverable to this card, or clear
  this card's pointer? The plan presents both options with the specifics. *Blocks 2 rows.*
- **Q-B2 — Repair all 60 kind/team rows, or only the 6 that block now?** Repairing all 60 prevents
  the same defect resurfacing as those cards gain comments. *Blocks nothing; changes write count.*
- **Q-B3 — Final sign-off on the fixture-exclusion list.** `x, sidtest, syn, acme` is provisional.
  *Blocks the apply digest being treated as final.*

## Tooling

| File | Role |
| --- | --- |
| `scripts/f42-linkage-repair-export.js` | Produces the private snapshot the runner plans from — card identity, link columns, Linear links, deliverable crosswalk + `kind` + Linear identity, per-component comment **counts**, and the manifest. Carries **no comment bodies**. |
| `scripts/f42-linkage-defect-repair.js` | Plans, gates and applies the repair. Ships the production PostgREST adapter (CAS patch + readback), attached only for a real `--apply`. |

## Validation

`test/f42-linkage-defect-repair.js` — **70 checks**: planner parity for all three classes; Class A/B
repair shape and NULL-faithful before-state; Class C escalation; every authority refusal
(slot-unique collision, already-claimed, cross-client, unclassified shape, wrong `kind`, unproven
and disagreeing Linear identity, would-invalidate-consumer); comment-free skip; fixture exclusion per
workspace; manifest verification against truncated/edited/stale/future exports; digest determinism
and drift; the video/caption/title single-write collapse; contradictory-repair conflict;
public-summary safety; CAS predicate construction and every refusal shape; readback semantics
including the Class C residue; and the full release mechanics — mandatory digest, writes, token,
artifact and readback, journal-before-patch ordering, artifact-overwrite refusal, and mid-run
failure reversal.

`test/f42-linkage-repair-export.js` — **18 checks**: contract and shape, manifest acceptance by the
runner, per-component count arithmetic, projection scope, and the public-safety assertions that no
comment body, brief or `linear_raw` reaches the snapshot — plus an end-to-end check that the runner
plans a Class A repair directly from exporter output.
