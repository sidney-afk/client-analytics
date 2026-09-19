# Step 26/27 — native intake, and the legacy fallback it is meant to close

Execution map phase 7, for the capability that closes the **legacy provider
(Linear) fallback path for card creation** — the thing `native_intake_epochs`
turns on and the thing the client-facing intake form's `_submitLinearFormLegacy`
exits still can, in principle, defeat.

**Written as scoping, and still only scoping.** Every number below is a
read-only `select` against the live database, a direct read of committed
source, or a direct read-only call against the live Linear API, all run on
**2026-09-19**. From this repository: no SQL was written, no flag was moved,
no function was deployed, no n8n workflow was touched.

Companion documents:
[`LINEAR_EXIT_STEP26_NATIVE_IDENTIFIER_MINT.md`](LINEAR_EXIT_STEP26_NATIVE_IDENTIFIER_MINT.md)
is the worked precedent for this file's shape and the source of the "51
created, 36 nameless, 15 reached Linear" figure this file was asked to trace
to its route — its own B-4/B-5 sections record that figure as a measurement,
not an assumption, taken earlier the same day. [`docs/independence/LINEAR_EXIT_BRIEF_C.md`](../independence/LINEAR_EXIT_BRIEF_C.md)
is the standing work-item list for the browser side of the cutover and is
where the three legacy exits below are already tracked (items C3/C4).

---

## Read this before anything else: the central finding is a non-reproduction

**A fresh, independent measurement taken today does not reproduce the "15 of
51 reached Linear" figure.** Five separate read-only checks, cross-referencing
three internal tables, one internal log, and one live call to the Linear API
itself, all agree: since `native_intake_epochs` went live for both teams
(2026-09-18T00:16:38Z), **zero** cards show any trace of having reached
Linear. That is a materially different, more reassuring state than the
companion document recorded, and this file treats the gap between the two
measurements as the central open question rather than assuming either one is
wrong.

### The five checks, each independent of the others

| # | Check | Measured | Result |
|---|---|---|---|
| 1 | `mirror_outbox` create receipts for `entity='deliverable'` since the flag flip | `select status, count(*), count(*) filter (where coalesce(payload->>'_native_intake_epoch','')='') from mirror_outbox where entity='deliverable' and operation='create' and created_at >= '2026-09-18T00:16:38Z' group by 1` | **40 rows, all `status='skipped'`, all carrying the epoch marker. Zero with an empty epoch.** |
| 2 | `deliverables.linear_issue_uuid` for rows created since the flag flip | `select count(*), count(*) filter (where linear_issue_uuid is not null) from deliverables where created_at >= '2026-09-18T00:16:38Z'` | **40 total, 0 with a provider issue uuid.** Re-run against the task's own stated cutoff (2026-09-18T16:13:00Z — which turns out to be the flip time of a *different* capability, see the note below): **27 total, 0 with a provider issue uuid.** |
| 3 | `workload_issues` (the Linear-issue mirror table, kept current by `linear-inbound`) | `select max(synced_at), max(linear_created_at) from workload_issues` | Synced as recently as **2026-09-19 16:40:18Z** (today). The newest issue it has ever recorded for either team was created **2026-09-18T00:07:51Z — nine minutes *before* the flag flip.** Nothing newer exists in the mirror. |
| 4 | **Direct, live Linear API read** — not a local mirror | `mcp__Linear__list_issues` for team `VID` and team `GRA`, `createdAt >= 2026-09-18T00:16:00Z` | **Zero issues in either team.** This is the decisive check: it does not depend on our own sync being current, because it asks Linear itself. |
| 5 | `linear_intake_receipts` — the F44 legacy-webhook receipt log, written by n8n's own service role when (and only when) `_submitLinearFormLegacy` completes a create | `select max(requested_at) from linear_intake_receipts` | Newest row is dated **2026-08-10** — about **5.5 weeks before** the flag flip. The legacy client-intake webhook path has not completed a single submission since then. |

**Note on the task's own cutoff.** The brief for this investigation cited
2026-09-18T16:13Z as when the 51 cards' window opens. That timestamp is real
and measured (`flag_flips`, `key='production_native_ordinary_receipts'`,
both teams flip to native at **16:13:48–16:13:49Z**) — but it is a
**different capability** from the one that governs card creation.
`production_native_ordinary_receipts` recognizes native writes for *ordinary*
(non-create) operations — `status`, `due`, `title`, `priority`, `archive`,
`restore`, `parent`, `description`, `attachment`, and `comment` — per
`migrations/2026-09-10-syncview-retirement-native-ordinary-recognizer.sql`'s
`production_syncview_retirement_typed_native_receipt` function. It has no
branch for `operation='create'`; that branch is governed exclusively by
`native_intake_epochs`, which had already been live for both teams for
**16 hours** by the time `production_native_ordinary_receipts` flipped. So
whichever cutoff is used for "cards created since," the mechanism that would
make one of them reach Linear is the same one (native_intake_epochs), and
check 1 above covers both cutoffs.

**What this does *not* mean.** It does not mean the legacy fallback is
closed, and it does not mean the companion document's earlier count was
fabricated. Two honest readings survive, and this file does not pick between
them because nothing measured here can:

- **(i)** The earlier "15 reached Linear" measurement was itself imprecise —
  for example, it may have conflated *nameless* (no `linear_identifier` yet,
  because the native-identifier-mint capability was not seeded until several
  hours later, 03:16–03:28Z the next morning) with *reached Linear*, which
  are different claims. Every one of the 40 rows in check 1/2 above was in
  fact nameless until this morning's backfill (see `production_native_identifier_grants`:
  all 50 grant rows carry a `minted_at` between 2026-09-19T03:16:53Z and
  08:49:54Z, i.e. hours after the companion doc's own "15 reached Linear"
  line was written) — and a backfilled native name looks identical in shape
  (`VID-15000`, `GRA-8020`, …) to a real Linear name unless the grants table
  or the provider uuid column is also checked, which the companion doc's own
  B-4/B-5 measurement did do, so this reading is offered with real
  reservations, not as the likely answer.
- **(ii)** Fifteen cards genuinely did leak earlier on 2026-09-18, and
  whatever created them has since stopped, or the leaked receipts have aged
  out of every table this session can see. `mirror_outbox` create receipts
  are written once and their `payload`/`dedup_key` are protected from
  mutation by `production_native_intake_receipt_guard`'s `UPDATE` branch — so
  they are not "aged out" by any write path in the installed schema — but a
  row can still be **deleted** by a service-role operation this session's
  read-only key cannot see evidence of after the fact. This is a real gap:
  a `DELETE` from `mirror_outbox` leaves no tombstone.

**Gate 0 blocker.** Neither reading can be confirmed or ruled out with the
read-only access this session has. The query that would resolve it — read
directly by the owner, not this session, since it needs the full n8n/Linear
audit trail rather than another database table — is: **the n8n execution log
for the `video-form`/`graphic-form` webhooks and the Linear API's own
`auditEntries` (or equivalent workspace audit log) for 2026-09-18, filtered to
issue-create events on the VID/GRA teams.** That is the one source neither
this file's SQL nor its `mcp__Linear__list_issues` call can reach, because a
deleted issue's create event may or may not still appear in a list query
depending on how Linear's audit log treats deletions — this session did not
attempt to delete anything to test that, per the read-only mandate.

---

## What is real and still live, regardless of which reading is right

Two mechanisms exist in committed source today that **can** produce exactly
the leak the companion doc described, whether or not they are what produced
it on 2026-09-18. Closing the fallback means closing both, independent of
resolving the Gate 0 blocker above.

### Mechanism A — the client-intake form's three legacy exits

`_submitLinearFormRoutedOnce` (`index.html:51277`) is the router for the
client-facing intake form (the "Submit" dialog with the video/graphics
webhook fields) — a **separate surface** from the Calendar's Create Post,
which already routes exclusively through `production-write`. Reading it in
full (`index.html:51277-51314`) shows it falls through to
`_submitLinearFormLegacy` — which posts straight to the `video-form`/
`graphic-form` n8n webhook, **never touching `production-write`, never
writing a `mirror_outbox` row, and so never subject to `native_intake_epochs`
at all** — on three conditions:

1. **A stale `LINEAR_RECEIPTS_KEY` already sits in `localStorage`**
   (`index.html:51282`). This is deliberate: an in-flight F44 receipt from
   before a cutover must finish on the identity that already owns it. But it
   means any browser that still holds an old receipt — from a failed
   submission, a reopened tab, or a receipt that predates the 2026-09-15
   webhook retirement referenced in `LINEAR_EXIT_BRIEF_C.md` — takes this
   exit regardless of team epoch state.
2. **The `_writeUiRerouteUseGatewayWhenReady` routing helper is missing**
   (`index.html:51289`) — a partially-cached page shell (an old service
   worker cache, a slow/incomplete script load).
3. **`useGateway` resolves `false`** (`index.html:51312`) — today this can
   only happen for a genuinely unenrolled client, since a *failed* read of
   `write_ui_reroute_clients` now fails toward the gateway, not toward
   Linear (`_writeUiRerouteUseGatewayFailClosed`, `index.html:28033-28046`,
   fixed 2026-09-07 per its own comment). Measured live: **all 43 active
   clients are enrolled in `write_ui_reroute_clients`, and the allowlist
   holds no extra entries** — a 1:1 match, both directions. So exit 3 is
   currently unreachable for any real client; it remains reachable for a
   mistyped or since-deactivated client name.

`docs/independence/LINEAR_EXIT_BRIEF_C.md` already tracks closing this
(items **C3** and **C4**) — lift its work-item text rather than re-deriving
it. It is not done: `grep -c 'webhook/video-form\|webhook/graphic-form'
index.html` returns matches at `index.html:14154` and `:50753` today, and
`test/cutover-fix-pack-ui.js`/`test/native-intake-ui-source.js` assert only
that these constants are not *fetched with `sendOptions`* — not that they, or
`_submitLinearFormOnce`/`_submitLinearFormLegacy`, are gone.

### Mechanism B — a batch that straddles a flag flip is pinned to the old epoch

`production_intake_epoch_read` (`migrations/2026-09-05-native-only-intake.sql:35-73`)
resolves each team's epoch for a new receipt in this order: an existing
manifest's recorded epoch, then an existing per-team `mirror_outbox` receipt's
epoch, then — the branch that matters here — **whether a `batch`-entity
`create` receipt already exists for this `batch_id`**. If it does
(`v_history`), **every child of that batch gets an empty epoch, unconditionally,
even one committed after a later flag flip.** The comment at line 58 says
this in as many words: *"A pre-manifest root receipt pins the WHOLE root to
its old provider lane, including a child that did not commit before
interruption."* This is a deliberate durability guarantee (an interrupted
multi-video submission should not fork onto two different epochs mid-batch),
but it is also, structurally, a window in which a card created *after* the
flag reads "native" still drains to Linear normally — for as long as its
batch's root receipt predates the flip. Nothing in this session's checks
proves this window closed cleanly on 2026-09-18; check 1 above just shows
that whatever batches exist **today** all resolved to the new epoch, which is
consistent with either "the window already passed uneventfully" or "the
straddling batches from that window already finished draining and their
receipts are gone."

---

## Blockers

| | Blocker | Shape |
|---|---|---|
| **B-1** | The "15 reached Linear" figure does not reproduce today across 5 independent checks (3 tables, 1 log, 1 live Linear API read) | unresolved measurement gap — see Gate 0 |
| **B-2** | Two live code paths (Mechanism A, Mechanism B) can still produce exactly this leak, whether or not they did on 2026-09-18 | still-open code work |
| **B-3** | `linear_outbound_enabled` is still `{"mode":"live"}` — the drain worker exists and will act on any receipt that does resolve to an empty epoch, from either mechanism | depends on the identifier-mint capability's own step 28, which is itself not yet closed (its check 7 is open per that file) |
| **B-4** | No standing alert exists for "a `deliverable`-entity create receipt landed with an empty epoch after the flip." Every check above was assembled by hand, once, for this file. A future leak (from either mechanism) would only be caught the same manual way, and only if someone thought to look | missing observability |
| **B-5** | This session cannot rule out a deleted `mirror_outbox` row as the explanation for the companion doc's 15 — that would leave no trace any read-only query here can see | out of reach of read-only DB access; needs the n8n/Linear audit trail directly |

---

## (a) What needs code

| Surface | Change needed |
|---|---|
| `index.html` — `_submitLinearFormRoutedOnce`/`_submitLinearFormLegacy`/`_submitLinearFormOnce`/`_linearAwaitCreate`/`_linearTargetForTeam`/`VIDEO_FORM_WEBHOOK`/`GRAPHIC_FORM_WEBHOOK` | Close Mechanism A per `LINEAR_EXIT_BRIEF_C.md` **C3** then **C4**: replace the stale-receipt and missing-helper exits with a visible hold (surface the receipt key, tell the owner, do not POST), decide with the owner what an unenrolled client should see post-cutover (C3's own text flags this as an owner decision), then delete the now-dead legacy submit path entirely once nothing reaches it. Run `node docs/syncview-design/tests/prod-write-gateway-browser.js` before pushing, per CLAUDE.md's rule for any Create/Calendar/Production write-surface change. |
| `migrations/2026-09-05-native-only-intake.sql` — `production_intake_epoch_read` | **Owner decision, not an obvious fix.** The pinned-root-history rule (Mechanism B) is a deliberate durability guarantee, not a bug. Closing it outright (drop the `v_history` branch) would let an interrupted multi-video batch fork mid-batch onto two epochs, which is its own class of bug. The safer change is a **time-box**: only pin to the old epoch when the root receipt is younger than some bound (e.g. the longest observed submission-to-completion gap), so a batch that has been "in flight" for days does not silently keep draining forever. This needs the owner's judgement on the bound, not a session's guess. |
| *(new)* a standing check for B-4 | A read-only view or scheduled query — `select * from mirror_outbox where entity='deliverable' and operation='create' and created_at > <flip_ts> and coalesce(payload->>'_native_intake_epoch','')=''` — surfaced somewhere a human will see it (a Workload panel badge, a daily digest) rather than requiring another ad hoc investigation like this one next time. Whether this lives in `index.html` (a read-only panel) or needs a new Edge Function endpoint is a scoping question of its own; a read-only panel needs no deploy lane at all. |

---

## (b) Which deploy lane

**Depends entirely on which piece above gets built, and none of it is built
yet.**

| Lane | Needed for |
|---|---|
| `deploy-f27-section4-closures.yml` (`linear-outbound`, `production-write`, `deliverable-write`, `batch-write`) | Only if the fix touches `production-write` or `linear-outbound` source — for example, if the time-box on Mechanism B is enforced *inside* `production-write` rather than left as a database function, or if `linear_outbound_enabled` is flipped to `off` as part of this work. **Needs the sealed four-function rollback bundle captured first**, per CLAUDE.md — run `& "$env:USERPROFILE\.syncview\f27-capture.ps1"` from any directory, drag the printed `.sourcebundle` into the `SyncView Backups/` Shared Drive root **before** dispatching, then paste `sealed_bundle_sha256`/`sealed_bundle_byte_length` from the receipt. |
| `deploy-f27-linear-inbound.yml` (`linear-inbound`) | Not needed for anything scoped here — nothing above touches `linear-inbound`. |
| *(no lane)* | Closing Mechanism A (`index.html` only) and adding a read-only observability panel (`index.html` only, or a new SQL view) need **no deploy lane at all** — they ship via the normal GitHub Pages push, same as any other `index.html` change. |

**Do not fold a `production-write`/`linear-outbound` change into the same PR
as the `index.html` legacy-exit closure.** They have different blast radii,
different test gates, and only one of them needs the sealed capture.

---

## (c) The flag or switch

**`native_intake_epochs` is already at its target state** —
`{"video":{"epoch":"native-video-20260917","enabled":true},"graphics":{"epoch":"native-graphics-20260917","enabled":true}}`,
live since 2026-09-18T00:16:38Z. There is nothing to flip here; this
capability's own switch is done.

The switch that actually closes the fallback structurally is
**`linear_outbound_enabled`**, currently `{"mode":"live"}`. Per
`LINEAR_EXIT_STEP26_NATIVE_IDENTIFIER_MINT.md`'s own step 28, flipping it to
`{"mode":"off"}` is **gated on that capability's closure**, which is itself
not yet recorded closed (its check 7 — a real graphics card after its own
flip — is open per that file). This file adds two more preconditions to that
same gate, both new:

- Mechanism A must be closed (the two/three legacy UI exits deleted or turned
  into a visible hold), because turning outbound off does not stop a card
  from posting straight to the `video-form`/`graphic-form` webhook — that
  path never touches `linear_outbound_enabled` at all.
- Mechanism B's time-box (or an owner decision to accept it unbounded) must
  be recorded, because a straddling batch drains through the **create**
  path, not the outbound-drain path that this flag governs — the same "it
  never touches the flag you just turned off" problem as Mechanism A.

So `linear_outbound_enabled → off` closes the *drain* half of the legacy
route (already documented as still executing per the identifier-mint doc's
own step 28 section) but closes **neither** of the two mechanisms this file
found, because neither one goes through the outbound drain. This is worth
stating plainly: turning outbound off is necessary but not sufficient to
close "native intake's legacy fallback for card creation."

---

## Step 27 acceptance checks

Modeled on the identifier-mint doc's rule: each check is closed only when
every clause in its own text is measured, not assumed.

| # | Check | How it is measured | Where |
|---|---|---|---|
| **1** | Re-run the five-channel Gate 0 check and get the same zero-leak result again, on a later date | Repeat all five queries in the Gate 0 table verbatim, including the live `mcp__Linear__list_issues` call — not just the local tables, which is exactly the gap B-1/B-5 describe | live, read-only + 1 external API read |
| **2** | Mechanism A's three exits are gone from source | `grep -c 'webhook/video-form\|webhook/graphic-form' index.html` returns **0**, and `grep -c '_submitLinearFormLegacy\|_submitLinearFormOnce' index.html` returns 0 (or only in `test/` files exercising the deletion) | source, read-only |
| **3** | The stale-receipt and missing-helper exits were replaced with a visible hold, not silently deleted with no message | Read the replaced code path directly; a client/staff hitting either condition sees a message naming the receipt key or the shell problem, per `LINEAR_EXIT_BRIEF_C.md` C3's own text | source, read-only |
| **4** | The unenrolled-client exit's owner decision is recorded | The go-ahead for C3 names what an unenrolled client sees post-cutover (a hold, an error, or automatic native routing) — not left to whatever the code already does | recorded, not inferred |
| **5** | Mechanism B's time-box (or the owner's decision to leave it unbounded) is recorded and, if bounded, enforced | Either a diff to `production_intake_epoch_read` with the bound, or a written owner acceptance of the unbounded pin, cited by date | source or recorded decision |
| **6** | The B-4 observability gap is closed | The new view/panel/query exists, is reachable without another ad hoc investigation, and a synthetic test (a deliberately empty-epoch `mirror_outbox` row inserted **against a disposable database**, never production) proves it surfaces | offline test + live read (view existence only) |
| **7** | `linear_outbound_enabled` flips to `{"mode":"off"}` only after checks 1–6 above AND the identifier-mint capability's own step 28 close together | `select value from syncview_runtime_flags where key='linear_outbound_enabled'` reads `{"mode":"off"}`, dated after every other check above | live, read-only |

---

## Step 28 — the closure sense

**"Done" is not "a check ran once and found nothing."** That is exactly the
gap between this file and the companion doc it was asked to explain: the
companion doc's own earlier measurement *did* find something, and this file's
later measurement did not, and neither measurement alone proves the fallback
is closed or open. Done means:

- Mechanism A is gone from source (step 27 check 2), not merely unreachable
  for today's roster.
- Mechanism B is either bounded or explicitly, recordedly accepted unbounded
  by the owner (step 27 check 5) — not silently left as a comment in a
  migration that a future session has to rediscover the way this one did.
- A **standing** check exists (step 27 check 6) so the next time a card does
  reach Linear after native intake is supposed to have closed that door,
  someone finds out from a panel or a digest, not from a five-query manual
  audit run once, by hand, weeks after the fact.
- `linear_outbound_enabled` reads `{"mode":"off"}` (step 27 check 7), and at
  that point the "legacy route unreachable" claim can finally be made for
  **card creation** specifically — which the identifier-mint doc was
  explicit it could not yet claim for the drain side of ordinary writes.

Until all four hold, the honest status of "native intake's legacy fallback"
is the same shape the identifier-mint doc used for its own dependency row:
**replacement built and largely proven, legacy route not yet provably
unreachable** — open, with what it is waiting on named here rather than left
implicit.
