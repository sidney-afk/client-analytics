# F141 live browser drill evidence

Date: 2026-07-19

Scope: post-merge production-Pages verification on the TEST client `sidneylaruel` for PR #878. The owner authorized a verified Admin session for this drill after the original SMM-only attempt stopped before any test write.

## Release under test

- PR #878 head: `462bff2c7826998bf1f9f5e2f244430658ded3d0`
- Merged release: `8382d9bbdf52b389ac38289638c724d36ebb4bcf`
- Live `index.html` returned HTTP 200 and matched the merged local file byte-for-byte:
  `77809ebf895c021d898074e143fa1cc13348fe0afefb6bc1f5a48e534ff37f35`
- `sample-review-reorder` was `ACTIVE` v32 with `verify_jwt=false` and bundle
  `c3eca2418c4e598ef598475b45e1fbec692570ddbe52f2916130f1a968f98ba5`.

## Positive drill: create, drag, reload, persist

1. Created a disposable sample card through the live UI and waited for the temporary id and saving state to clear.
2. Dragged the settled card to the front through the live Samples reorder path.
3. Captured the browser response: HTTP 200 with `{"ok":true,"updated":2}` for two requested items.
4. Forced a full server-truth reload.
5. The disposable card remained first in both the rendered strip and the backend order.

Result: **PASS**.

Evidence:

- [Created and settled](01-positive-created-settled.png)
- [Persisted after server-truth reload](02-positive-persisted-after-server-reload.png)
- [Sanitized network capture](positive-network.json)

## Negative drill: unmatched ids fail closed

1. Restored the preexisting TEST order and placed the disposable card at the tail.
2. Started a real drag-to-front reorder.
3. At the browser request boundary, preserved the two-item request shape but replaced both ids with non-matching synthetic ids. No credential or request header was recorded.
4. The deployed function returned HTTP 200 with `{"ok":true,"updated":0}`.
5. The fixed client detected `updated < items.length`, restored the exact pre-drag DOM order, and displayed:
   - `Couldn't save the new order`
   - `It was put back — please try again.`
6. The backend `sample_reviews.order_index` fingerprint was identical before and after:
   `fd269a60d12db49980e68f1d773c626d062b3ad06070d77237998ab53f79d311`.

Result: **PASS**.

Evidence:

- [Optimistic front position before the response](03-negative-optimistic-before-response.png)
- [Exact revert with fail-closed notification](04-negative-reverted-with-notification.png)
- [Sanitized network capture](negative-network.json)

The positive persisted screenshot and negative optimistic screenshot are byte-identical because both intentionally capture the same visible front position before the negative response. Their shared SHA-256 is
`347984c6662fd884118e2f2f040a68f18b2410e854ead0f449e59bf4fd874fc3`.

## Cleanup and safety readback

- The disposable card was archived through the live UI.
- Independent REST readback found zero active rows whose name begins `F141 live drill`.
- The TEST client returned to one preexisting active row and its original order fingerprint:
  `6af631d0083514017570da22f891a4c0a400f86971ce6a4d58f39d6e08071fb5`.
- Frozen `calendar-upsert` remained `ACTIVE` v43 at
  `91ce449e8fd19b451f218572a0f42db385c64841b1f4b4b14ff27b76839a425f`.
- Frozen `sample-review-upsert` remained `ACTIVE` v44 at
  `50b63fbadcdf03d3de0fc04131dd9258f50aabd1631e59bcb6f57554e0b918fb`.
- No runtime flag, schema, n8n workflow, Linear object, or other Edge Function changed.

Screenshot SHA-256:

- `01-positive-created-settled.png`: `bedce5e01e2c71e3e4824f883201671df3db5c9f9150d3291f3bcefe4c086c45`
- `02-positive-persisted-after-server-reload.png`: `347984c6662fd884118e2f2f040a68f18b2410e854ead0f449e59bf4fd874fc3`
- `03-negative-optimistic-before-response.png`: `347984c6662fd884118e2f2f040a68f18b2410e854ead0f449e59bf4fd874fc3`
- `04-negative-reverted-with-notification.png`: `78dc6cb107659294268f3ad6eb42c72fc065ae13a54c8fa251def507ca89765b`
