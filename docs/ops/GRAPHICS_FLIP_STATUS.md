# Graphics flip — blocking status

Created 2026-08-05. This file did not exist before; it was opened to hold one
blocker that is materially worse than it first looked.

---

## BLOCKER 1 — a Drive-hosted graphics deliverable cannot pass SMM approval

**Severity: WAVE-1 ENROLLMENT blocker, not a flip blocker.** It fires days
before the flip, and it will look like "the new plumbing is broken."

### The defect

`assertGraphicsApprovalArtifact` probes `deliverable.file_url` and refuses the
transition unless the probe returns `available`. The probe cannot fetch a Google
Drive or Google Docs URL **at all**:

`assetProbeUrl` rewrites a Drive share link to
`drive.google.com/uc?export=download&id=…`. `assetProbeRedirectAllowed` then
re-validates that derived URL through `assetUrlType`, whose `providerQuerySafe`
allowed only `usp, dl, raw, download, id, tab, rlkey, resourcekey`. **`export`
was not among them**, so the gateway judged its own probe URL `invalid`,
`drive.google.com` is not in the redirect host allowlist, and
`boundedAssetFetch` threw `asset_redirect_invalid` at hop 0 — without ever
making a request. The Docs path failed identically on `format=pdf`.

Dropbox worked, because `raw` and `rlkey` were already listed. **That is why
this survived**: it looked like a provider quirk rather than a structural
disagreement between two functions.

Confirmed live by run `31034175188`:
`result_code: asset_unavailable_redirect_invalid`.

### Why enrollment, not the flip, is the trigger

The browser routes a client's writes to `production-write` only when that
client's slug is in `write_ui_reroute_clients`
(`_writeUiRerouteUseGateway`, `index.html:23177`). **Enrollment scope is what
keeps real client work off these paths today — not the code.**

Once a client is enrolled, the UI sets

```js
let legacyParity = !!intent.legacyOnly || authority[intent.team] === 'linear';
```

so a still-Linear-authoritative Graphics team takes the **legacy parity lane**
rather than being refused. `authorityLane` then permits parity exactly where
`legacyParityAllowed` does — and that is the whole exposure:

| surface / operation | today, Graphics on `linear` |
|---|---|
| `production` / `status` | refused before the gate (`legacy_parity_not_allowed`) |
| **`calendar` / `status`** | **parity allowed → reaches the artifact gate** |
| **`sxr` / `status`** | **parity allowed → reaches the artifact gate** |
| **`submission` / `intake_create`** | **parity allowed → reaches the artifact gate** |
| **`calendar` / `intake_create`** | **parity allowed → reaches the artifact gate** |

The Calendar UI sends `surface: 'calendar', operation: 'status'`
(`index.html:29375`). So an enrolled client, moving a Graphics item to
**SMM Approval from the Calendar**, hits `assertGraphicsApprovalArtifact`
**today**, with Graphics still on Linear authority. A Drive-hosted artifact is
then refused `409 artifact_not_resolvable`.

**The owner's reading was right, and the mechanism is worse than "authority
protects us until the flip":** the parity lane routes Linear-authoritative
teams *past* the authority refusal and *into* the artifact gate. Only
`surface='production'` is protected today, and that is the one surface the
Calendar does not use for status.

### Call sites

| line | path | protected today? |
|---|---|---|
| `:3594` | main native write, `status` → `smm_approval` | only on `surface='production'`; **exposed via calendar/sxr parity** |
| `:3560` | the same gate on `reconcile_only`, deliberately placed **before** authority resolution | **no** |
| `:4497` | intake, rows with `team=graphics` and `status=smm_approval` | **no** — intake routes Linear authority through parity rather than refusing |

### What it would have looked like

Wave-1 enrollment includes a client with real Graphics volume. Their designer's
work lives in Google Drive. The first time anyone moved one of those graphics to
SMM Approval, the gateway would refuse it — four or five days before the flip,
with the flip nowhere in the frame, presenting as the new gateway being broken
for graphics generally.

### Fix

`export` and `format` added to `SAFE_ASSET_QUERY_KEYS`
(`production-write/policy.mjs`). Neither is a credential —
`CREDENTIAL_QUERY_KEY` still rejects token, auth, key, secret, signature,
expires, credential and policy — and neither turns a folder into a file.

The durable part is `test/asset-probe-url-policy.js`, which holds the
**property**: every URL `assetProbeUrl` constructs must pass `assetUrlType`.
`assetProbeUrl` was moved into `policy.mjs` beside `assetUrlType` so that
property is expressible at all. Written before the fix, it failed 7 checks on
the then-current code — every Drive and Docs case, Dropbox passing — and passes
21 after. A future provider added with an unlisted query key now fails in CI
rather than in production.

### Status

- [x] Root cause identified and confirmed live
- [x] Property test written, demonstrated failing, then passing
- [x] Fix committed
- [ ] **Deployed** — inert until the four-function lane runs. **The blocker is
      not cleared until then.**
- [ ] Re-verified by a drill run with a Drive-hosted artifact reaching
      `available`

### A correction this entry supersedes

`docs/ops/GRAPHICS_DRILL_ARTIFACT_SETUP.md` previously told the reader that the
committed probe followed Google's 303 and that a rejection therefore meant a
stale deployment. That was wrong, and it came from a hand-written replica of the
probe that invented an allowance for `drive.google.com` the real code does not
have. The owner was twice asked to re-check sharing settings that were already
correct. Corrected in place.
