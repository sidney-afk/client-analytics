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
- the write would collide with `deliverables_card_slot_unique`
  `(client_slug, origin, card_id, kind)` (`card_slot_unique_would_collide`).

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
| Digest pinning | `apply_digest` covers the scope policy, the fixture-exclusion list, and every write's `before`/`after` **and the full observed target row**. `--expected-digest` refuses on drift. |
| **`--expected-writes` (mandatory)** | Apply throws `expected_writes_required_for_apply` without it, and blocks on mismatch. The existing lane had only `SAFETY_CAP` (default 600) — a plan that grew from 26 writes to 599 would have proceeded. |
| Owner confirm token | `F42_CONFIRM_LINKAGE_REPAIR=REPAIR_LINK_DEFECTS`. |
| **Rollback artifact (mandatory)** | `--rollback-artifact` is required for apply. The artifact is written **before the first write** and flushed after every write, so a mid-run failure still reverses exactly the writes that landed. The existing lane wrote its artifact *after* the writes, so a throw left committed writes with no artifact. |
| Verification | An independent readback must report zero remaining defects; any disagreement is `GAPS`, never `APPLIED`. |
| Public-safety | The rendered summary is classification × surface × reason **counts only**. Asserted by test: the summary contains no card id, client slug or deliverable id. |

### Idempotency

Every write is a field correction to a known prior value. Re-running after a successful apply
re-plans from live data, finds the rows already crosswalk-clean, and produces **zero writes** —
which `applyEligibility` then reports as `no_writes_planned`. There is no double-apply hazard.

### Rollback

The private artifact records `{deliverable_id, restore, applied}` per row. Reversal is the inverse
`UPDATE` per row, in any order — the writes are independent. The artifact carries per-row
identities and must be retained privately; it is never uploaded to a public log.

## Ordering — this apply is blocked on the gate fix

Repairing a defect makes its card **crosswalk-valid**, which flips it to the canonical render path.
Before the canonical gate requires a valid link, a card whose comments are not yet imported would
render an empty canonical thread over its real legacy comments and persist the emptied `*_tweaks`
string on the next save.

**Therefore: the gate fix PR must be merged and deployed before this apply runs.** The repair PR may
be reviewed and merged independently; only the *window* is ordered.

Sequence for the window:

1. Gate fix deployed and verified.
2. Fresh `mode: plan` dispatch to regenerate defect-row identities — **never** reuse identities from
   an old run; they are ephemeral per-run by design.
3. Repair plan run → owner reviews counts + the Class C rulings → owner records the digest.
4. Repair apply, digest-pinned, `--expected-writes` set to the reviewed count, confirm token, rollback
   artifact path.
5. Readback confirms zero remaining defects.
6. Fresh F42 `mode: plan` → the 33 unblocked comment rows now appear as importable.

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

## Validation

`test/f42-linkage-defect-repair.js` — 42 checks covering: planner parity for all three classes,
Class A/B repair shape and before-state capture, Class C escalation, every authority refusal
(slot-unique collision, already-claimed, cross-client, unclassified shape), comment-free skip,
fixture exclusion for each workspace, digest determinism and drift, the video/caption/title
single-write collapse, contradictory-repair conflict, public-summary safety, and the full release
mechanics including artifact-before-write ordering and mid-run failure reversal.
