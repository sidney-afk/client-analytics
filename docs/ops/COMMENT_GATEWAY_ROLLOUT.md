# Comment-gateway rollout runsheet — Monday

**Who this is for.** The owner, alone, copy-paste only. This is the Monday
runsheet for turning ON the client-comment **front door** — the "Gateway
comment repair" that PR **#1065** merged on 2026-08-14 with its routing flag
shipped **OFF**. Nothing is live until you finish Step B below, and rollback at
any point is one SQL paste (flag off, no deploy).

**What it completes.** The FLIP_RUNBOOK's "GATEWAY COMMENT FRONT DOOR"
go-condition — a four-step chain (merge → EF deploy → flag flip → drilled
comment on both surfaces). Step 1 (merge) is done. This runsheet is steps 2–4.

**Public-repo rule (F64):** this file never names a client, slug, token, or
secret. The drill uses the TEST client (`<TEST_CLIENT>` in other runbooks);
everything private stays in the Supabase/GitHub/Linear UIs you paste into.

---

## Preconditions — check all three before starting

| # | Check | How | If it fails |
|---|---|---|---|
| P1 | **PR #1065 is merged on `main`** | `main`'s history shows "Gateway comment repair: client comments through the front door, flag-gated rollout (#1065)" (merged 2026-08-14). In the tree: `index.html` primes the flag (`CLIENT_COMMENT_GATEWAY_FLAG_KEY = 'client_comment_gateway_enabled'`) and `supabase/functions/production-write/policy.mjs` exports the front-door predicate `clientCommentFrontDoorTargetAllowed`. | Stop. Nothing below applies to a tree without the repair. |
| P2 | **The Pages deploy carries it** | Open <https://syncview.synchrosocial.com>, view page source (Ctrl+U), search for `client_comment_gateway_enabled` — expect **4** hits. (0 hits = the live site predates #1065.) Alternatively: GitHub → Actions → the "pages build and deployment" run for the #1065 merge commit is green. Verified 4/4 on 2026-08-14 when this runsheet was written; re-check Monday. | Wait for/ re-run the Pages deploy. Do not proceed: flipping the flag against a pre-#1065 frontend does nothing (the flag is only read by the new code), but the drill in Step C cannot pass. |
| P3 | **Full-roster enrollment (wave 3) is live** | Supabase **SQL Editor** (Dashboard → project `uzltbbrjidmjwwfakwve` — SQL Editor only, per FLIP_RUNBOOK): run the read-back block below. `write_ui_reroute_clients` must carry `updated_by = 'owner-enrollment-wave-3-full-roster'` (the stamp the FLIP_RUNBOOK enrollment ruling ordered) and its membership must be the full roster; the matching `flag_flips` row is expected at ledger id **52** (the next after wave 2's id 51). The roster slugs are deliberately not listed in this public file — read the live flag. | Stop and resolve enrollment first. Comments only reach the front door for **enrolled** clients, so an un-enrolled roster makes Step C's proof partial. Note: as of this runsheet, the wave-3 execution is **not yet recorded** in `EXECUTION_LOG.md` — if the live stamp confirms it, record it there too. |

Read-back for P3 (read-only; safe any time):

```sql
select key, value, updated_at, updated_by
from public.syncview_runtime_flags
where key in ('write_ui_reroute_clients', 'client_comment_gateway_enabled');

select id, key, old_value, new_value, ts, actor
from public.flag_flips
order by id desc
limit 5;
```

Expected before Step B: `client_comment_gateway_enabled` returns **no row** (or
exactly `{"enabled": false}`) — anything else, stop and diagnose. Only the
exact value `{"enabled": true}` is ON; absent/malformed/anything-else is
OFF/fail-legacy.

---

## Step A — deploy the `production-write` edge function

**The lane is "Deploy F27 Section 4 closures"**
(`.github/workflows/deploy-f27-section4-closures.yml`). Verified: its pins were
re-pinned 2026-08-14 for exactly this release — the fifth `production-write`
release, source closure `450fca94c8313746d3292f970de4a76f702d43fbf7aad4acb0d7d639fe9603be`,
which is the front-door code. It deploys all four closures
(`linear-outbound`, `production-write`, `deliverable-write`, `batch-write`) as
one reviewed operation; only `production-write`'s source moved, the other three
redeploy byte-identical.

Do **not** use "Deploy staff-sensitive edge functions"
(`deploy-onboarding-edge-functions.yml`) for this. Its manual Track-B set can
also push `production-write`, but without the Section-4 lane's pinned-fingerprint
verification — and the FLIP_RUNBOOK go-condition names the Section-4 workflow
explicitly.

**A.1 — capture the sealed prior-four bundle (owner-only, local).** The lane
requires two inputs that prove a rollback artifact exists before it touches
anything. Produce them exactly as the 2026-08-05 deploy request
(`docs/ops/DEPLOY_REQUEST_2026-08-05_SECTION4.md`) describes — on your machine,
never in CI or a session:

```text
PROJECT_REF=<private> SUPABASE_ACCESS_TOKEN=<private> \
node scripts/f27-edge-source-rollback.js capture \
  --slugs=linear-outbound,production-write,deliverable-write,batch-write \
  --bundle=<absolute private sealed file>
```

Require `provider_contract=PASS` in the receipt and note exactly two values:
the bundle's `sha256` and `byte_length`. The sealed file also uploads to the
`SyncView Backups/` Shared Drive root. Paste nothing else anywhere public.

**A.2 — dispatch.** GitHub → **Actions** → **Deploy F27 Section 4 closures** →
**Run workflow** (branch `main`), with exactly these five inputs:

| input | value |
|---|---|
| `commit_sha` | the current `main` head SHA, 40 lowercase hex (the lane refuses anything that is not the exact current `main` tip) |
| `operation` | `deploy-reviewed-release` |
| `confirm` | `DEPLOY_REVIEWED_F27_SECTION4_CLOSURES` |
| `rollback_bundle_sha256` | the `sha256` from A.1 |
| `rollback_bundle_byte_length` | the `byte_length` from A.1 |

Or from a terminal:

```text
gh workflow run deploy-f27-section4-closures.yml --ref main \
  -f commit_sha=<MAIN_HEAD_SHA> \
  -f operation=deploy-reviewed-release \
  -f confirm=DEPLOY_REVIEWED_F27_SECTION4_CLOSURES \
  -f rollback_bundle_sha256=<sealed_bundle_sha256> \
  -f rollback_bundle_byte_length=<sealed_bundle_byte_length>
```

**A.3 — approve the production Environment prompt IMMEDIATELY.** The job runs
in the `production` GitHub Environment (that is what holds the deploy secret),
so the run pauses at **"Review deployments"** until approved. Open the run and
click **Approve and deploy** right away: the lane validates that your
`commit_sha` is still the current `main` head when the job actually starts, so
a long wait during which `main` moves turns into a refused run.

**A.4 — verify the deploy succeeded.** All of:

- the run is **green**;
- its Summary says `Forward deployment: PASS`, `Deployed function count: 4`,
  and shows four per-function `deploy/readback: PASS` blocks;
- the Summary's **"Deployed versions — record these in `EXECUTION_LOG.md`"**
  table shows `production-write` at a NEW active version with source closure
  exactly `450fca94…` (full value above) and `verify_jwt=false` on all four;
- copy the printed `syncview_f27_section4_deployed_versions_v1` JSON block into
  `EXECUTION_LOG.md`, as the workflow instructs (that attestation is F51's
  answer to "what is actually running").

**Rollback for Step A:** same workflow, `operation=restore-captured-prior-four`,
`confirm=RESTORE_CAPTURED_F27_SECTION4_CLOSURES`, same two sealed-bundle values
from A.1. A failed or ambiguous forward run is **never retried forward** —
restore is the only correct response (full procedure:
`docs/ops/F27_INSTALL_RUNBOOK.md`). Note: with the flag still OFF, a Step A
problem has changed nothing a client can reach.

---

## Step B — flip `client_comment_gateway_enabled` ON

**Only after A.4 is green.** (Ordering cannot break anything — the frontend
fails legacy until both halves are live — but the go-condition orders it this
way, so keep the order.)

House discipline (FLIP_RUNBOOK §F6/F63): SQL Editor only; read back and retain
the exact prior row first (the P3 read-back above is that read — keep its
output); expected-state CAS; one-row assertion; immediate read-back.

This flag has never been primed, so the expected prior state is **either** no
row at all **or** exactly `{"enabled": false}`. The block below handles exactly
those two states — inserts if absent, CAS-updates from false — and refuses
anything else:

```sql
do $$ declare n integer; begin
  insert into public.syncview_runtime_flags (key, value, updated_by)
  values ('client_comment_gateway_enabled', '{"enabled": true}'::jsonb, 'owner-comment-gateway-on')
  on conflict (key) do update
    set value = '{"enabled": true}'::jsonb,
        updated_by = 'owner-comment-gateway-on'
    where public.syncview_runtime_flags.value = '{"enabled": false}'::jsonb;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'comment gateway ON refused: expected absent row or {"enabled": false}; read back'; end if;
end $$;
```

Immediately read back:

```sql
select key, value, updated_at, updated_by
from public.syncview_runtime_flags
where key = 'client_comment_gateway_enabled';
```

Require exactly `{"enabled": true}` with `updated_by = 'owner-comment-gateway-on'`.
Ledger note: the `flag_flips` trigger fires on UPDATE only — if the row was
**absent** and this paste inserted it, no `flag_flips` row appears and the
read-back above is the proof; do not chase a missing ledger entry. If the row
was updated from `false`, expect one new `flag_flips` row stamped
`owner-comment-gateway-on`.

What is now live: an **enrolled** client whose tab can build a verified gateway
context sends calendar-surface and unlinked-samples comments through the
gateway front door. Anything that cannot build the context stays fail-legacy —
never a raw refusal at the client. Open tabs pick the flag up via the realtime
flags subscription; allow ~30 s or a hard refresh.

**Rollback for Step B (also the rollback for Step C and the whole rollout) —
flag OFF, no deploy required:**

```sql
do $$ declare n integer; begin
  update public.syncview_runtime_flags
  set value = '{"enabled": false}'::jsonb, updated_by = 'owner-comment-gateway-off'
  where key = 'client_comment_gateway_enabled'
    and value = '{"enabled": true}'::jsonb;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'comment gateway OFF refused: expected {"enabled": true}; read back'; end if;
end $$;
```

Read the row back after it. OFF restores the exact PR #1064 stopgap routing
(all client comments legacy); the deployed EF sits unused and harmless.

---

## Step C — the drilled proof (this is the go-condition)

The chain is DONE only when step 4 of the FLIP_RUNBOOK's "GATEWAY COMMENT
FRONT DOOR" go-condition holds. Its exact wording
(`docs/ops/FLIP_RUNBOOK.md`, go-conditions block):

> **GATEWAY COMMENT FRONT DOOR — the repair now exists; "done" is a four-step
> chain, not a merge.** The repair for the 2026-08-13 `comment_forbidden`
> incident's real cause (the gateway's client-comment door refusing
> calendar-surface and unlinked-samples comments) is the "Gateway comment
> repair" PR **#1065** (branch `claude/gateway-comment-repair`; EXECUTION_LOG
> 2026-08-14). It is DONE — and F1's open comment question is ANSWERED — only
> when ALL FOUR hold, in this order:
> 1. that PR is **merged** (nothing changes at merge time: the routing flag ships OFF);
> 2. the production-write EF is **deployed via the Section-4 deploy workflow**
>    (`deploy-f27-section4-closures.yml`, re-pinned fingerprint `450fca94…` — the four-function
>    closure deploys as one operation);
> 3. the owner flips **`client_comment_gateway_enabled` to `{"enabled": true}`** (§F6
>    discipline: SQL Editor only, read back and retain the exact prior row first,
>    expected-state CAS, one-row write/readback; only the exact value `{"enabled": true}` is
>    ON — anything else, including an absent row, is OFF/fail-legacy) — flipped ONLY after
>    step 2, though no ordering can break: the frontend fails legacy until both halves are
>    live;
> 4. **one drilled client comment on EACH surface** — a real client link posting a comment on a
>    Calendar card AND on an unlinked Samples thread — verified to commit natively
>    (`production_comments` row) and mirror to Linear.
> Until step 4 completes, the PR #1064 stopgap still governs live traffic and the enrollment
> ruling's comment caveat (below) still stands. Rollback at any point = flag off (step 3
> reversed); no deploy required. If the owner instead chooses NOT to run this chain before F1,
> that is the explicit acceptance of full-roster graphics-comment darkness — say so out loud,
> do not let it happen by omission.

**How to run the drill.** Use the TEST client's client link (the
`?c=<display name>&t=<token>` link; a signed-in Admin/SMM can mint/copy it from
the share action if it is not at hand). The TEST client has been enrolled since
wave 1, so its comments are eligible for the front door.

**Drill 1 — Calendar surface.**
1. Open the TEST client link and go to the Calendar review screen.
2. Pick a card that is **Linear-linked** (it must name a native deliverable —
   a card with no native id cannot make a native write, and a card with no
   Linear issue cannot prove the mirror leg). Caveat: the TEST client's
   *graphics* project is unregistered in the f200 mapping
   (`PRE_FLIP_HEALTH_CHECK.md` context item), so prefer a **video**-component
   card, or a graphics card you have confirmed is Linear-linked.
3. Type a distinctive comment, e.g. `front-door drill — calendar — 2026-08-17 HH:MM`,
   and submit.

**Drill 2 — unlinked Samples thread.**
1. Same client link, Samples review.
2. Pick a thread that is **NOT linked to a calendar card** (an unlinked
   samples thread — the second population the front door exists for).
3. Type `front-door drill — unlinked samples — 2026-08-17 HH:MM` and submit.

**What the verifier watches — all three, for EACH drill:**

1. **The card/thread shows the comment** in the client view (and in the staff
   view) — no red refusal, no silent disappearance.
2. **The native thread has it**: a new `production_comments` row for that
   comment (visible through the staff Production view's thread, or a read-only
   select on `production_comments` for the drill timestamp). This is the
   "commits natively" half — a comment that only rode the legacy n8n lane
   produces no such row and does NOT pass the drill.
3. **Linear has it**: the mirrored comment appears on the linked Linear issue
   (the outbound mirror drains it; allow the drain a few minutes).

Both drills green = step 4 holds = the go-condition is satisfied and F1's open
comment question is ANSWERED. Record the drill (timestamps, card/thread, the
three observations) in `EXECUTION_LOG.md`.

**Rollback for Step C:** a failed drill is a stop, not a judgement call — run
the Step B OFF block, read it back (clients are instantly back on the PR #1064
stopgap routing), and diagnose before re-flipping. Do not leave the flag ON
with a red drill.

---

## Step D — flip week

With A–C green, the Wed/Thu graphics flip window proceeds **per the
FLIP_RUNBOOK go-conditions block** — this runsheet closes only the front-door
condition. Still open there, flip morning:

- **a GREEN production write drill that morning** (the scheduled ~04:17Z
  drill; a red drill on flip morning is a hard stop, not a judgement call), and
- **a fresh flip-night machine chain** — fresh pre-f2 evidence + binder, fresh
  scheduled drainer, fresh literal `GO` per the runbook's hard pre-flight (the
  2026-08-11 staging GO does not carry).

One-line reminder: **re-authorize the n8n connector** (claude.ai connector
settings) before flip week — guard verification needs it (reading the two n8n
authority guards, and the owner-approved drainer-dispatch node toggle during
the clear-air window), and it currently reads unauthenticated in sessions.

**Rollback for Step D:** not from this runsheet — the flip carries its own
rollback machinery (F2 kill, F27 §R2) in `docs/ops/FLIP_RUNBOOK.md`. The
front-door flag needs no change at flip time in either direction.

---

## Rollback summary — one line per step

| Step | Rollback |
|---|---|
| Preconditions | Nothing to roll back — a failed check is a stop. |
| A — EF deploy | Same lane, `operation=restore-captured-prior-four`, `confirm=RESTORE_CAPTURED_F27_SECTION4_CLOSURES`, the A.1 sealed-bundle values. Never retry a failed forward. |
| B — flag ON | The OFF block in Step B (CAS from `{"enabled": true}`, stamp `owner-comment-gateway-off`), then read back. No deploy required. |
| C — drilled proof | Flag OFF (same block); the PR #1064 stopgap resumes governing all client comments; diagnose before re-flipping. |
| D — flip week | Governed by `FLIP_RUNBOOK.md` (F2 kill / F27 §R2), not this file. |
