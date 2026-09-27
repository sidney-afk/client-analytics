# TikTok Upload queue can hide its first read failure — source-only proposal

**Source snapshot:** `3f5bd46e6086911ae2a7bb0d32507f03d5a44da8` on 2026-09-26. This is checked-in-source evidence, not a hosted or live reproduction. No runtime behavior changes in this review.

## Repeated pattern

OPEN_REPAIRS 209 records Workload showing a shorter board after an incomplete refresh without saying that rows went missing. The 2026-09-08 tweak-feedback review in the same ledger records a wrong-key read that returned an empty box instead of an error. Both confused an unproved read with a genuinely empty result. The TikTok Upload site below is a separate, current first-read path; no existing open PR or OPEN_REPAIRS entry was found for it.

## Source trace

1. `src/index/090-workload-popovers-navigation.js.part:1625-1626` creates the TikTok Upload view before mounting it. On mount, `src/index/300-tiktok-upload.js.part:1952-1970` paints the cached or pending rows with `_tkRenderQueue()` and only then starts `_tkFetchQueue()`.
2. `_tkRenderQueue()` sets `tkQueueCol.dataset.everLoaded = '1'` at `src/index/300-tiktok-upload.js.part:1778-1781`, even when no server list has been read. With no cache or pending row, its default Upcoming tab says “Nothing scheduled yet” (`:1827-1835`).
3. The fetch failure handler shows its error card only if that same element does **not** have `everLoaded` (`:1694-1719`). A source and built-page search found only the renderer setting this marker and this catch reading it; the mount path has already set it before the request can fail. The intended first-failure notice is unreachable on that path.
4. With no active, scheduled, or overdue row, `_tkNextPollDelay()` returns zero and `_tkScheduleNextPoll()` stops (`:1916-1935`). Returning to a visible tab or remounting does refetch (`:1970-1983`), but an idle page left open has no automatic retry.

**Source inference:** If the initial list request fails in a fresh browser with no local rows, the page says “Nothing scheduled yet,” shows no load error, and stays that way while the tab remains visible. It has not proved that the queue is empty. No live failure rate or affected upload is claimed.

## Separate fix to evaluate

Distinguish a successfully read server list from a queue that has merely been painted. On failure, keep any cached rows but show that the list is unverified; schedule a bounded retry even when the local queue is empty. An offline browser case should fail the first mocked list read with empty local storage, assert a visible load failure and retry, then return one server row and assert the false-empty message disappears. Keep upload, cancel, and retry writes outside that test. A runtime fix belongs in another PR.
