# Analytics tab: what first content waits on (2026-09-24)

Follow-up to `docs/audits/2026-09-23-speed-map.md` §4 (Analytics, 5,116 ms warm).
Read-only, staff view, live site and live backend. Readiness selector unchanged:
first `.cell-inner` with no `.sv-skeleton` descendant, 1440×950 Chromium.

**Rig caveat.** Measured from a cloud sandbox, not the owner's machine. Its proxy
drops and retries requests (`ERR_TOO_MANY_RETRIES` on the document, fonts,
runtime flags and sheets), so absolute times are slower and noisier than the speed
map's. The dependency chain and the "ms after key-verify" column are the
trustworthy numbers.

## 1. What first content waited on (before)

Every warm load, in order:

1. `key-verify` (staff identity). `init()` awaits it before anything else loads.
2. The **Metrics** and **Clients Info** Google Sheets, which only start once
   `key-verify` returns. First content painted right after the later of the two.

Nothing else gated it. TopVideos and the brief sheets were already off the path.

The saved copy that should have painted at step 2 never did. The browser held
it split across two stores: Metrics + Clients Info in localStorage (1.7 M
characters), and TopVideos + briefs in IndexedDB with no numbers half. The
localStorage loader required all five sheets in localStorage; the IndexedDB
loader required both halves in IndexedDB. Neither could paint. The split came
from the write path: when the extras overflowed localStorage, it deleted the
whole key (numbers included) and spilled only the extras.

## 2. Fix

- Both loaders paint the overview from Metrics + Clients Info alone. The extras
  are read from IndexedDB behind the paint; a client page still waits for them.
- An overflowing write moves everything the key held to IndexedDB, with the
  numbers keeping their original age.
- A live sheet load that fails no longer beats the saved copy to the paint.

## 3. Before and after

Same browser profile, same live data, the page served from `main` then from this
branch, 5 warm loads each.

| | painted | first content (ms from navigation) | after `key-verify` (ms) | sheets waited on |
|---|---|---|---|---|
| before | 2 of 5 (3 never painted in 45 s) | 9,003 · 11,344 | 5,860 · 6,335 | Metrics, Clients Info |
| after | 5 of 5 | 3,721 · 4,029 · 4,636 · 4,902 · 6,425 | 201 · 206 · 224 · 231 · 275 | none |

What is left before first content is the `key-verify` round trip, which is a
deliberate security gate (see the comment in `init()`), not Analytics' own data.

With Google Sheets blocked entirely, the overview and the test client's page both
fill from the saved copy.
