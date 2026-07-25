# F42 card↔deliverable linkage brick — investigation report and design

> Status: **INVESTIGATION ONLY — NON-AUTHORITY.** This document authorizes nothing. It does not
> apply a migration, deploy a function, write to production, or approve an import. No service-role
> key was used at any point. Every live number below comes from HTTP GET against PostgREST with the
> **public anon key** already published in `index.html`, or from an already-public receipt in
> `EXECUTION_LOG.md` / the F42 runbook.
>
> Move 2 of the Linear-independence program · blocker #10 · prepared for owner review and cloud
> reviewer sign-off **before** any implementation PR. The eventual apply window takes a second
> review by Codex after 2026-07-28.

## Headline

**The linkage brick as scoped cannot work, and building it would make things worse.**

The brief assumes the 6,032 deferred comments are blocked by a *missing join key* — that Calendar
and Samples cards and Production deliverables are both sitting there, needing only to be matched.
They are not. Three findings, each verified live and each independently sufficient to stop the
card-side backfill:

1. **A card-side-only link can never produce an importable comment.** Of the 4,126 deliverables with
   `origin='manual'`, **exactly 0** carry a `card_id`. The crosswalk requires
   `deliverables.card_id = card.id` *and* `deliverables.origin ∈ {calendar, samples}`. Writing
   `card.video_deliverable_id` without writing the deliverable side produces
   `crosswalk_fields:card_id,origin` — a permanent **defect**, not a link.
2. **That is not a hypothesis — it already happened.** The 27 existing `card_id,origin` defects are
   the fossil record of exactly this operation. `scripts/b3-linkage-backfill.js` states in its own
   header that it "never changes … deliverables" and only PATCHes the card columns. Re-running that
   shape converts self-healing *deferrals* into permanent *defects*.
3. **A Linear-keyed match reaches 2 comment rows, not thousands.** Simulated against live data with
   the planner's exact predicates: T1 unique matches = **2**. The remaining 6,139 fail because
   **no deliverable exists to match**, not because the key is ambiguous (ambiguous = 0,
   claim-conflicts = 0).

The real blocker is not linkage. It is that **the Samples/SXR pipeline was never ingested into
`deliverables` at all** — 3 rows of 4,612 carry `origin='samples'`. There is nothing to link SXR
cards *to*. Recovering those comments requires **creating** deliverables, which is a materially
larger and riskier program than the brief describes and needs owner ratification, not just review.

Separately, and independently of all of the above: **the render flip is a data-destruction hazard,
not merely a display one.** Linking a card whose comments are not yet imported can cause the stored
legacy comment JSON to be overwritten with an empty array on the next save — on staff sessions too.

---

## 1. Join keys — how cards and deliverables can actually be related

### 1.1 The shapes

`deliverables` (`migrations/2026-07-06-b1-linear-data-model.sql:30-80`) is a Track-B B1 table:

```sql
create table if not exists public.deliverables (
  id text primary key,
  identifier text unique,
  batch_id text not null references public.batches(id),
  client_slug text not null references public.clients(slug),
  team text not null check (team in ('video','graphics')),
  kind text not null check (kind in ('video','thumbnail','other')),
  ...
  origin text not null default 'manual' check (origin in ('calendar','samples','manual')),
  card_id text,
  linear_issue_uuid text, linear_identifier text, linear_issue_url text, ...
);
-- Two-slot card linkage: resolve via client_slug + origin + card_id + kind.
create unique index deliverables_card_slot_unique
  on public.deliverables (client_slug, origin, card_id, kind)
  where card_id is not null and origin in ('calendar','samples');
```

The card side (`calendar_posts`, 52 cols; `sample_reviews`, 38 cols — both anon-readable) carries
four relevant columns: `video_deliverable_id`, `graphic_deliverable_id`, `linear_issue_id`,
`graphic_linear_issue_id`, plus `client` (there is **no** `client_slug` column on either card table;
the planner falls back to `client` at `scripts/f42-card-comment-import.js:625`).

### 1.2 What the crosswalk actually compares

`deliverableCrosswalkIssues()` (`scripts/f42-card-comment-import.js:307-344`), mirroring the RPC:

| Predicate | Comparison | Source of the expectation |
| --- | --- | --- |
| `origin` | case-insensitive | `SURFACE_ORIGIN`: calendar→`calendar`, sxr→`samples` (`:29`) |
| `team` | case-insensitive | `teamForComponent`: graphic→`graphics`, else `video` (`:407-409`) |
| `client_slug` | **case-sensitive**, trimmed | `row.client_slug \|\| row.client` (`:625`) |
| `card_id` | **case-sensitive**, trimmed | `row.id` |

Two mechanics that drive everything downstream:

- **`deliverableId()` (`:401-405`)**: `graphic` → `graphic_deliverable_id`; **`video`, `caption` and
  `title` all → `video_deliverable_id`.** One video link governs three components.
- **The crosswalk is evaluated per component, and a mismatch defers/defects that component's whole
  comment list** (`:652-667`).
- The crosswalk checks **`team`**, while the B3 matcher scopes candidates by **`kind`**. These are
  different columns and, as §3 shows, they disagree on 60 rows.

### 1.3 Candidate join keys — verdicts

| Key | Card side | Deliverable side | Uniqueness | Verdict |
| --- | --- | --- | --- | --- |
| `deliverable_id` (direct) | `video_/graphic_deliverable_id` | `id` (PK) | 1:1 | **PRIMARY** — but only 273 cal / 3 sxr cards carry one |
| Linear issue URL | `linear_issue_id`, `graphic_linear_issue_id` (store **full URLs**) | `linear_issue_url` | see below | **FALLBACK** — safe but near-empty reach |
| Linear identifier (`VID-nnn`) | derived from the URL | `linear_identifier` (4,609/4,612 populated) | see below | **FALLBACK** — same |
| `linear_issue_uuid` | absent on cards | present, unique partial index | — | **UNUSABLE** — card side has no UUID |
| `(client_slug, origin, card_id, kind)` | derivable | `deliverables_card_slot_unique` | unique by index | **PRIMARY for writes**, not for discovery |
| `name` / title | present both | `title` | not unique | **UNUSABLE** |
| `scheduled_date`, `order_index`, `thumbnail_file_id` | cal only / no counterpart | — | — | **UNUSABLE** |

Raw Linear-key multiplicity (before scoping) is poor: max multiplicity 139 on `sample_reviews`, 47
on `calendar_posts`. The worst offenders are QA fixtures (`https://linear.app/x/VID-CLEAN` ×139,
`.../issue/TEST-<n>/video` ×47). After scoping by `client_slug|kind`, ambiguity disappears entirely
— but so does nearly all reach (§2.3).

### 1.4 Live coverage — exact counts

Anon has **column-level** SELECT on `deliverables`: `id, identifier, batch_id, client_slug, team,
kind, title, status, origin, card_id, sort_key, linear_issue_uuid, linear_identifier,
linear_issue_url, linear_aliases, created_at, updated_at` are readable; `brief`, `linear_raw`,
`comments`, `file_url` return 401. That grant is exactly the F42 exporter's five crosswalk fields
plus the Linear keys, so **the whole deliverable side was measurable without a service-role read.**

Deliverable inventory (n=4,612):

| Cut | Count |
| --- | ---: |
| `origin='manual'` | 4,126 |
| `origin='calendar'` | 483 |
| `origin='samples'` | **3** |
| `card_id` NOT NULL | 473 |
| `card_id` NULL | 4,139 |
| `origin='manual'` AND `card_id` NOT NULL | **0** |
| `origin='calendar'` AND `card_id` NOT NULL | 470 |
| `origin='calendar'` AND `card_id` NULL | 13 |
| `linear_issue_url` populated | 4,609 |
| all 4,609 Linear URLs in workspace | `synchro-social` |

Card-side link state:

| Surface | Rows | `video_deliverable_id` set | `graphic_deliverable_id` set |
| --- | ---: | ---: | ---: |
| `calendar_posts` | 5,639 | 273 (4.8%) | 278 (4.9%) |
| `sample_reviews` | 4,489 | **0** | **3** |

Note the calendar surface is also ~95% unlinked; the brief's framing ("only 3 of 1,722 Samples
cards") is correct but the calendar side is not meaningfully better.

Comment rows by class, per surface, computed with the planner's exact predicates:

| Class | calendar | sxr | total |
| --- | ---: | ---: | ---: |
| Comment rows total | 4,542 | 2,254 | 6,796 |
| **T0 — already crosswalk-clean (importable)** | 617 | **3** | 620 |
| **DEFECT — `deliverable_crosswalk_mismatch`** | **35** | 0 | 35 |
| `deliverable_not_found` (dangling) | 0 | 0 | 0 |
| Unlinked: no Linear link at all | 3,177 | 523 | 3,700 |
| Unlinked: link not a parseable `XXX-nnn` | 0 | 1,611 | 1,611 |
| Unlinked: identifier absent from `deliverables` | 711 | 110 | 821 |
| Unlinked: identifier exists, wrong client/kind | 0 | 7 | 7 |
| Unlinked: **ambiguous (>1 candidate)** | 0 | 0 | **0** |
| **T1 — unique scoped match available** | **2** | 0 | **2** |

**Reconciliation with the receipts.** T0 = 620 vs 615 applied; defects = 35 vs 35; sxr T0 = 3 vs "3
of 1,722". Totals 6,796 vs 6,681. The small drift is expected: the receipts are from the
2026-07-25 01:16Z snapshot, and this count sums the aliased `comments`/`video_comments` fields that
the planner later collapses (`:391-396`). **The 35 defects reproduce exactly, including their field
breakdown** (§3), which is the strongest available evidence that this simulation is faithful.

---

## 2. Why only 3 SXR cards are linked

### 2.1 The mechanism

Two writers touch these columns, and neither one links SXR:

1. **`scripts/b3-linkage-backfill.js`** — "Track B B3 Stage 3: one-time card linkage backfill … It
   fills only the additive B1 linkage slots on calendar_posts/sample_reviews when an existing Linear
   link resolves to an existing deliverable. **It never changes Linear links, deliverables**, flags,
   webhooks, or n8n" (`:3-8`). Its only write is `supabasePatch(table, client, id, body)` against
   the card tables (`:791-803`). Its plan phase does visit both surfaces (`:449-450`), but it can
   only link to a deliverable that already exists.
2. **The archive-promotion path** — the *only* code that creates deliverables here — is
   **calendar-only**: `buildTwinCounts(input.calendarPosts || [], [])` (`:604`, sample_reviews
   passed as a literal empty array) and `for (const card of input.calendarPosts || [])` (`:613`).
   It stamps `deliverable_origin: 'calendar'` (`:697`).

So: deliverables get created for calendar cards, never for Samples cards. SXR cards then have
nothing to resolve against, and the backfill writes nothing.

### 2.2 Confirmed by the data

`origin='samples'` deliverables: **3**. That is the entire Samples presence in the Production model,
and it exactly equals the 3 linked SXR cards. The SXR pipeline was never ingested.

Cross-checking the Linear key space, ignoring client scoping entirely (the most generous possible
test):

| Surface | Card links | Identifier found anywhere in `deliverables` | Miss |
| --- | ---: | ---: | ---: |
| calendar | 2,160 | 628 (29.1%) | 1,532 |
| sxr | 4,898 | **11 (0.2%)** | 4,887 |

All 4,609 deliverable Linear URLs live in the `synchro-social` workspace. Comment-bearing cards, by
the workspace their Linear link points at:

| Workspace | calendar cards / comments | sxr cards / comments |
| --- | ---: | ---: |
| `synchro-social` (production) | 235 / 916 | **1 / 17** |
| `(no link)` | 1,663 / 3,241 | 431 / 574 |
| `sidtest` | 171 / 212 | — |
| `syn` | 44 / 173 | 37 / 37 |
| `x` | — | 1,258 / 1,609 |
| `acme` | — | 11 / 11 |
| `syncsocial` | — | 6 / 6 |

**This materially changes the headline number.** At least **2,048 of the 6,796 comment rows sit on
cards whose Linear link points at a non-production workspace** — QA fixtures that should never be
imported at all. Only **933 comment rows** (916 calendar + 17 sxr) sit on cards demonstrably linked
into the real workspace. The remaining 3,815 rows carry no Linear link and cannot be classified from
anon-visible data; separating them needs the owner's client roster (`clients` returns 0 rows to
anon).

### 2.3 Is there a systematic key a backfill could use safely?

**Yes, and it is safe — but its reach is 2 comment rows.**

The B3 predicate (`exactUrlCandidateRows`, `:287-298`) is sound: non-archived, `client_slug` equal,
`kind` equal, normalized `linear_issue_url` equal, and require exactly one candidate. Simulated
live, it produces **zero ambiguity and zero claim conflicts**. It is simply starved of targets.

| Tier | Rule | Comment rows reached |
| --- | --- | ---: |
| **T1** | Exact normalized Linear URL, scoped `client_slug`+`kind`, exactly 1 non-archived candidate, target unclaimed | **2** |
| **T2** | Same, keyed on extracted `VID-nnn`/`GRA-nnn` identifier | **0** additional |
| **T3** | >1 candidate → owner adjudication | **0** |
| **T4** | No candidate exists — *the deliverable was never created* | **6,139** |

Both T1 rows additionally require a **deliverable-side write** (`card_and_deliverable: 2`;
`card_only: 0`) — consistent with §1.4's finding that no `manual` deliverable carries a `card_id`.

**Conclusion: there is no confidence tier at which a matching backfill recovers a meaningful number
of comments.** The 6,032 are not waiting on a key. They are waiting on a deliverable that does not
exist.

---

## 3. The 35 defects — mechanics and safe repair

Reproduced exactly from live data, matching the receipts row-for-row:

| Reason string | Count | Receipt |
| --- | ---: | ---: |
| `crosswalk_fields:card_id,origin` | **27** | 27 ✓ |
| `crosswalk_fields:team` | **6** | 6 ✓ |
| `crosswalk_fields:card_id` | **2** | 2 ✓ |

All 35 are on the calendar surface; sxr contributes 0.

### 3.1 Class A — `card_id,origin` (27 rows)

**Mechanically:** the card points at a deliverable whose `origin` is not `calendar` and whose
`card_id` does not equal the card's id. Given that **0 of 4,126 `manual` deliverables carry a
`card_id`**, this is precisely the signature of a deliverable still sitting at its
`origin='manual', card_id=NULL` default while a card points at it.

**Cause:** a card-side-only link write — i.e. exactly what `b3-linkage-backfill.js` does. These
defects are the residue of a previous run of the very operation this brick was scoped to perform.

**Authoritative side:** the **card**. The card names the deliverable it intends; the deliverable is
merely un-stamped. Repair = complete the link the writer left half-done.

**Safe repair:** for each row, `UPDATE deliverables SET origin='calendar', card_id=<card.id>` —
after asserting (a) `client_slug` and `team` already match, (b) no other card points at the same
deliverable, and (c) the write will not violate `deliverables_card_slot_unique` on
`(client_slug, origin, card_id, kind)`. Any row failing (c) is a genuine collision and must go to
the owner, not be auto-resolved.

### 3.2 Class B — `team` (6 rows)

**Mechanically:** `origin`, `card_id` and `client_slug` all match — the deliverable was genuinely
born from this card — but `deliverables.team` disagrees with `teamForComponent(component)`.

**Cause found:** `deliverables` contains **60 rows whose `kind` and `team` are inconsistent** — 58
with `kind='thumbnail', team='video'` and 2 with `kind='video', team='graphics'`. The crosswalk
validates `team`; the matcher and the card slot imply `kind`. A card's `graphic_deliverable_id`
correctly points at its `kind='thumbnail'` deliverable, which carries the wrong `team`.

**Authoritative side:** the **`kind` column plus the card slot**. `kind='thumbnail'` in the graphic
slot is unambiguous; `team` is the corrupted field.

**Safe repair:** `UPDATE deliverables SET team='graphics' WHERE kind='thumbnail' AND team='video'`
(and the mirror), scoped to the affected ids only. This is a one-field correction with no linkage
change. Worth noting the other 54 inconsistent rows are latent defects that will surface as soon as
their cards gain comments — repairing all 60 is cheaper than repairing 6 twice.

### 3.3 Class C — `card_id` only (2 rows)

**Mechanically:** `origin='calendar'`, `team` and `client_slug` all match, but `card_id` names a
*different* card. A correctly-formed calendar deliverable is bound to card X while card Y points at
it.

**Cause:** most likely a duplicated/cloned card carrying its source's `video_deliverable_id`, or a
manual re-point.

**Authoritative side: genuinely ambiguous — this one needs an owner ruling.** Repointing the
deliverable to card Y would orphan card X (and X may already have imported comments under it).
Clearing card Y's column returns those rows to the deferral bucket. Both are defensible; the data
cannot decide. **Open question Q3.**

---

## 4. Design — what the brick should actually be

Given §1–§3, the honest design is **not** the card-side backfill in the brief. It is three separable
bricks, in a mandatory order.

### 4.0 Non-negotiable correction to the model

**A link is a two-sided atomic write or it is not a link.** Any operation that writes
`card.<x>_deliverable_id` without also stamping `deliverables.card_id`/`origin` must be treated as
prohibited, because it demonstrably manufactures permanent defects (§3.1) while flipping the card to
the canonical render path (§4.2). This must be encoded as a refusal in the tool, not a convention.

Corollary: `docs/independence/F42_CARD_COMMENT_IMPORT_RUNBOOK.md:68` — "Resolves itself once the card
is linked; a later plan picks the rows up automatically" — is **true only when the deliverable was
born from that card**. It should be corrected, because it is what makes a card-side-only backfill
sound harmless.

### 4.1 Brick 1 — Defect repair (small, safe, do this first)

Scope: the 35 defect rows plus the 60 `kind`/`team`-inconsistent deliverables.

- Class A (27) and Class B (6) are mechanical, authority is clear, repair is a bounded `UPDATE` on
  `deliverables` only — no card writes, no new rows.
- Class C (2) is held for an owner ruling and never auto-repaired.
- Regenerate identities with a fresh `mode: plan` dispatch at the start of the session (defect-row
  identities are ephemeral per run, `RUNBOOK.md:75-77`).
- **Expected gain: 33 comment rows become importable**, and the remaining 54 latent `team` rows stop
  being future defects.

This brick is worth doing on its own merits and carries the lowest risk in the program.

### 4.2 Brick 2 — The render-flip prerequisite (BLOCKING for anything that links a card)

`_prodCanonicalCommentGate` (`index.html:46111-46129`) sets `linked` purely from
`_writeUiNativeId(post, component)` — the card's deliverable id. Setting the column flips the card
from the legacy path to the canonical path immediately. On a linked card, an unready or
non-authorized canonical read returns `[]` (`index.html:96` of the PR #937 diff), and PR #937's
legacy fallback is taken **only when `!linked`**.

**This is worse than an empty render.** The calendar projection writes the empty result back into
the card object unconditionally — the branch at `index.html:46089-46091` calls
`_calSetCommentsFor(post, component, projected)` with `projected = []`, and it is **not gated on
`_isClientLink`**, so staff sessions do it too. `_calSetCommentsFor` (`index.html:24253-24270`)
zeroes both the parsed array and the wire string (`*_tweaks`). The next save then persists the
emptied column. **Result: durable loss of stored comment history on a card that was linked before
its comments were imported.**

Because one `video_deliverable_id` governs **video, caption and title** (`:401-405`), a single link
write exposes three components, and a perfectly successful video import still leaves `caption` and
`title` receiving `[]`.

**Required before any linking write ships:** guard the **write** path, not just the render path —
`_calSetCommentsFor` and `_writeUiPersistCanonicalCommentProjection` must refuse to serialize an
empty canonical projection over a non-empty stored value. Note that a naive "fall back when the
canonical thread is empty" rule is wrong twice over: it would resurrect deliberately deleted
comments, and it inverts an invariant asserted in
`test/production-client-comment-card-binding.js:279-309`. The correct predicate is provenance —
*this deliverable has never had a canonical import or lifecycle event* — which requires a
runner-local service-role read, not a client-side check.

### 4.3 Brick 3 — Deliverable creation (the only path that actually recovers the 6,032)

This is the real work, and it is a bigger program than the brief anticipates. To make an SXR card's
comments importable you must **mint** a deliverable: `origin='samples'`, `card_id`, `client_slug`,
`team` matching the component, `kind`, a `title`, and a **`batch_id` that must already exist**
(`batch_id text not null references public.batches(id)`), plus a `clients(slug)` row. So it creates
rows in up to three tables per card.

Order of operations, per card-component slot, all-or-nothing:

1. Ensure `clients` row exists (refuse if not — do not create clients).
2. Ensure/create the `batches` row (deterministic id, as `b3-linkage-backfill.js` already does).
3. Insert the `deliverable` with `origin`/`card_id`/`team`/`kind` **already correct**, so it is
   crosswalk-clean at birth and can never become a Class A defect.
4. Only then PATCH the card column.
5. Refuse the whole slot if `deliverables_card_slot_unique` would collide.

**Do not run step 4 until F42 has imported that card's comments** — or until Brick 2 has shipped.

**Scope control.** Before minting ~2,000 production rows, the fixture population must be excluded:
at least 2,048 comment rows sit on cards pointing at non-production Linear workspaces (§2.2).
Minting deliverables for QA fixtures would pollute the Production model permanently. This needs the
owner's client roster to resolve the 3,815 unclassifiable rows (**Q1**).

### 4.4 Lane conventions (inherited from F42 — reuse, do not reinvent)

- **plan/apply split**, plan is source-only and never writes.
- **Public-safety**: the rendered run summary carries **classification × surface × reason counts
  only** — never card ids, client slugs, or bodies. Per-row identity stays in the runner-local plan.
  This is the pattern at `scripts/f42-card-comment-apply.js` and the F42 workflow; it is a hard
  requirement, and note that F42 already drops PostgREST `details`/`hint` precisely because a
  constraint violation echoes the offending row into a public log.
- **Digest pinning + drift guard**: apply re-derives from a fresh export and refuses unless the
  digest matches the reviewed plan. The digest must cover both sides of every intended write.
- **Owner confirm token** in the environment, plus `workflow_dispatch` pinned to a 40-char SHA
  already on `origin/main`.
- **Idempotency**: every write is `NULL → value`; re-running is a no-op. Re-apply must be asserted
  green in rehearsal.
- **Rehearsal**: extend `scripts/f42-apply-rehearsal.js`'s disposable-PostgreSQL pattern with
  public-safe fixtures covering each defect class and each creation path.

**Guard correction:** `--expected-writes` **does not exist** anywhere in `scripts/` (0 hits). The
only numeric guards in `b3-linkage-backfill.js` are `SAFETY_CAP` (default **600** — far above any
planned write count) and `EXPECTED_PROMOTIONS`, whose drift check sits inside `if (PROMOTE_ARCHIVE)`
and governs archive promotions only. A mandatory `--expected-writes=N` must be **built**, not
assumed, and `SAFETY_CAP` must default to the planned count.

**Rollback correction:** `b3-linkage-backfill.js` writes its `--details-json` artifact *after*
`applyPlan`, and any verification throw exits before it is written — a mid-run failure leaves
committed writes with no artifact and no ledger row. The artifact must be written **before** the
first write, appended per write, made mandatory for apply, and the ledger write moved to a `finally`.

### 4.5 Expected coverage gain — honest arithmetic

| Brick | Comment rows unlocked | Confidence |
| --- | ---: | --- |
| Brick 1 (defect repair, Classes A+B) | **33** | High — mechanical, reproduced exactly |
| Brick 1 (Class C) | 2 | Blocked on owner ruling |
| T1/T2 matching backfill | **2** | High — measured, zero ambiguity |
| Brick 3 (creation), production-only cut | ≤ **933** demonstrably-production rows; up to ~4,750 if the 3,815 unclassifiable rows are real | Low — depends entirely on Q1 |
| Never recoverable without creation | 6,139 | High |

**The brief's premise — that a linkage backfill converts a large share of the 6,032 — is not
supported.** Matching recovers 2. Everything else requires minting deliverables, and a meaningful
fraction of the 6,032 is QA fixture data that should be excluded rather than imported.

### 4.6 What stays unlinkable, and why

- **3,700 comment rows** on cards with no Linear link at all — no key of any kind exists.
- **1,611 rows** on SXR cards whose link is a non-standard identifier (`.../x/VID-CLEAN`) — fixtures.
- **821 rows** whose identifier is real but has no `deliverables` row — the Linear issue was never
  ingested.
- All of the above become linkable *only* by creation (Brick 3), and only for cards that represent
  real client work.

### 4.7 Rollback

- Brick 1: record before-values for the ≤35 `deliverables` rows; inverse is a single `UPDATE` back.
- Brick 3: every write is additive (`NULL → value`, new rows). Inverse = null the card columns and
  delete the minted deliverable/batch rows by their recorded ids. The private before/after artifact
  is the rollback source and must exist before the first write.
- Neither brick touches `production_comments`, so no imported comment is ever at risk.

### 4.8 Files an implementation PR would touch

| File | Change |
| --- | --- |
| `scripts/f42-linkage-plan.js` (new) | Source-only planner: classify every slot into defect class / T1 / creation-candidate / unlinkable; emit public-safe counts + runner-local per-row plan |
| `scripts/f42-linkage-apply.js` (new) | Digest-pinned, token-gated, two-sided atomic writer with mandatory `--expected-writes` and pre-write rollback artifact |
| `scripts/f42-apply-rehearsal.js` | Add fixtures + assertions for each defect class, two-sided write, idempotent re-apply, and mid-run-kill rollback |
| `index.html` | Brick 2: guard `_calSetCommentsFor` / `_writeUiPersistCanonicalCommentProjection` against empty-over-non-empty |
| `test/production-client-comment-card-binding.js` | Update the invariant deliberately, with the reversal called out |
| `.github/workflows/f42-linkage.yml` (new) | `workflow_dispatch` plan/apply lane, pinned SHA, enum-only summary |
| `docs/independence/F42_CARD_COMMENT_IMPORT_RUNBOOK.md` | Correct the "resolves itself" claim (§4.0) |

---

## 5. Open questions for the owner

1. **Q1 — Fixture boundary.** Which client slugs are real production clients? 2,048 comment rows are
   demonstrably on fixture-linked cards and 3,815 are unclassifiable from anon data. *Blocks the
   entire coverage estimate and Brick 3's scope.*
2. **Q2 — Is deliverable creation authorized at all?** Brick 3 mints thousands of `deliverables`,
   `batches` (and possibly `clients`) rows in production. This is a materially bigger commitment
   than "linkage" implies. *Blocks Brick 3.*
3. **Q3 — Class C authority.** For the 2 rows where a valid deliverable is bound to a different
   card: repoint the deliverable, or clear the pointing card's column? *Blocks 2 rows of Brick 1.*
4. **Q4 — Ship Brick 1 alone?** Defect repair is +33 rows, low risk, no card writes, no render flip.
   Recommend yes, as a standalone PR. *Blocks nothing; needs a go.*
5. **Q5 — Brick 2 invariant reversal.** Guarding the write path changes behavior asserted in a
   shipped test. Route through the decision register as a `D-nn`? *Blocks Brick 2.*
6. **Q6 — Anon column grant on `deliverables`.** `card_id`, `client_slug`, `origin`, `team`,
   `linear_*` and `title` are world-readable with the published anon key. Intended, or an
   over-grant to close? *Independent of this program; flagging because it was found here.*

---

## 6. Evidence appendix

Every claim below was verified this session. Live probes: HTTP GET, public anon key, no writes.

**Code**
- Crosswalk predicates & case sensitivity — `scripts/f42-card-comment-import.js:307-344`
- `SURFACE_ORIGIN` calendar/samples — `:29`
- `deliverableId()`: video/caption/title → `video_deliverable_id` — `:401-405`
- `teamForComponent()` — `:407-409`
- `client_slug` falls back to `client` — `:625`
- Per-component defer/defect, whole list — `:652-667`
- Defect reason string `crosswalk_fields:<sorted>` — `:341`
- B3 "never changes deliverables" — `scripts/b3-linkage-backfill.js:3-8`
- B3 card-only PATCH — `:791-803`
- B3 promotion is calendar-only — `:604`, `:613`
- B3 exact-URL candidate predicate — `:287-298`
- `SAFETY_CAP` default 600 — `:27`, enforced `:935-936`; `EXPECTED_PROMOTIONS` promotion-scoped — `:33`, `:924-928`
- `--expected-writes` absent repo-wide — `grep -rn "expected-writes\|EXPECTED_WRITES" scripts/` → 0
- Rollback artifact written after writes — `:993-999`
- `deliverables` DDL, `deliverables_card_slot_unique` — `migrations/2026-07-06-b1-linear-data-model.sql:30-80`
- `batches` DDL (target of the `batch_id` NOT NULL FK declared in `deliverables`) — `:6-28`
- Canonical gate `linked` = card's deliverable id — `index.html:46111-46129`
- Empty projection written into card, not gated on `_isClientLink` — `index.html:46083-46096`
- `_calSetCommentsFor` zeroes array + wire string — `index.html:24253-24270`
- PR #937 legacy fallback only when `!linked` — commit `96d87bc`
- Shipped invariant asserting no fallback on linked cards — `test/production-client-comment-card-binding.js:279-309`

**Live probes (anon, read-only)**
- `deliverables` anon column grants: 17 columns 200, `brief`/`linear_raw`/`comments`/`file_url` 401
- Deliverable inventory, origin/team/kind/card_id cross-tabs — §1.4
- `origin='manual' AND card_id NOT NULL` = **0**
- `kind`/`team` inconsistency = 58 + 2 = **60**
- Card link state per surface — §1.4
- Comment-row classification per surface — §1.4 (planner predicates reimplemented exactly)
- **Defect reproduction 27 / 6 / 2 — matches the receipts exactly**
- Linear key multiplicity and workspace distribution — §1.3, §2.2

**Not verified / explicitly unknown**
- Which client slugs are production vs fixture (`clients` returns 0 rows to anon) — Q1.
- Whether the 3,815 no-Linear-link comment rows represent real client work.
- `production_comments` contents (service-role only), so "has this deliverable ever been imported?"
  could not be evaluated live — it is assumed to require a runner-local service-role read.
- Triggers on `deliverables`/card-column UPDATE were not enumerated; an implementation PR must.

---

*Prepared as an investigation deliverable. No migration applied, no function deployed, no production
write performed, no service-role key used.*
