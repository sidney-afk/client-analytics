# Deploy request — F27 Section 4 four-function lane (2026-08-05)

**This is a request, not an action. Nothing has been dispatched.** The lane is
`workflow_dispatch`-only from `main` and requires a typed confirmation string,
so it cannot start by accident. Bringing it here as its own approval is
deliberate: it is the owner-gated action, separate from everything else in this
branch, and everything else in this branch works without it.

---

## What it changes, in one line

`production-write` starts following Google Drive's 303 redirect when probing the
Graphics approval artifact, and starts writing the full attribution key set.

## Why now

Two things are waiting on it, and only these two.

**1. The Graphics approval artifact probe.** The repository's probe follows the
redirect; the deployed function does not. Verified by running the committed
probe logic against the owner's real file: hop 0 `303 application/binary` →
hop 1 `206 image/png` → `available`. Until this deploys, a correctly-shared file
keeps returning `artifact_not_resolvable` and the drill keeps parking
`graphics_approval_artifact`. **This is the reason to deploy.**

**2. The attribution stamp key set.** `production-write` now emits
`ancestor_issue_id: null` / `ancestor_distance: null` instead of omitting them.
This is correctness, **not** a prerequisite: the reconciler fix treats absent and
null as the same claim, so the soak signal is already clean against the
currently deployed function. If this deploy never happens, nothing regresses.

## Why it is one deploy and not two

The lane deploys all four functions serially with per-function readback. Only
`production-write` changed; `batch-write`, `deliverable-write` and
`linear-outbound` are byte-identical to the previously reviewed pins and are
redeployed unchanged. Splitting the probe fix from the stamp fix would mean
running this lane twice for one function's worth of change.

## The pins

Regenerated with `node scripts/ef-fingerprint.js <sha> --expected-only`.

| function | source closure SHA-256 | files | moved? |
|---|---|---:|---|
| `batch-write` | `86f9f187…d83d6a` | 2 | no |
| `deliverable-write` | `78df060b…074575` | 2 | no |
| `linear-outbound` | `008deee5…8cb98`&nbsp;(5) | 5 | no |
| `production-write` | `b974e809cb52066196072c665d4904ea7ba11856fe9112fd515765ed28f63171` | 5 | **yes** — was `2efe6ee3…d79d60e` |

`*_ENTRYPOINT_SHA256` is sha256 of the entrypoint **path string**, not the file
bytes, so it does not move when source changes. None of the four entrypoint
pins changed. `test/f27-section4-deploy-lane.js` recomputes all four closures
from the repository and fails if the workflow's pins disagree, so the pins
cannot silently drift from the tree they claim to describe.

## What must be true before dispatch

- [ ] This branch is **merged to `main`**. The lane requires
      `commit_sha == current main head`, and refuses to run otherwise.
- [ ] `RELEASE_SHA` is the merged `main` head, 40 lowercase hex characters.
- [ ] The sealed pre-DDL four-function capture's `sha256` and `byte_length` are
      to hand — they are required inputs and the lane verifies them
      independently before it touches anything.
- [ ] Supabase CLI 2.109.0 and a working Docker bundler are available to the
      runner (the lane checks both and stops if not).

## Dispatch

```text
gh workflow run deploy-f27-section4-closures.yml --ref main \
  -f commit_sha=<RELEASE_SHA> \
  -f operation=deploy-reviewed-release \
  -f confirm=DEPLOY_REVIEWED_F27_SECTION4_CLOSURES \
  -f rollback_bundle_sha256=<sealed_bundle_sha256> \
  -f rollback_bundle_byte_length=<sealed_bundle_byte_length>
```

## Rollback

Same lane, `operation=restore-captured-prior-four`, with its own separate
confirmation string. A failed or ambiguous forward response is **never** retried
forward — restore is the only correct response. Full procedure in
`docs/ops/F27_INSTALL_RUNBOOK.md`.

## What to expect afterwards

On the next **Production write gateway TEST drill** run, once
`PRODUCTION_WRITE_DRILL_GRAPHICS_ARTIFACT_URL` is also set
(`docs/ops/GRAPHICS_DRILL_ARTIFACT_SETUP.md`):

- `graphics_artifact_attached` becomes `true`
- `graphics_approval_artifact` leaves `parked_assertions`

`description_roundtrip` stays parked. It is unrelated to this deploy and this
deploy does not address it.

## What this deploy does NOT do

- It does not change any runtime flag, `prod_authority`, or n8n workflow.
- It does not deploy `linear-inbound` or the frozen client writers — the lane is
  structurally incapable of it, and there is a test asserting so.
- It does not flip the Graphics team to SyncView authority. That is a separate,
  later, owner-gated decision.
