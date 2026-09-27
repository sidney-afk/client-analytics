# Production archive: incomplete chronological comment cursor

Scope: source-only review of `supabase/functions/production-archive/index.ts` and its Production browser caller at `origin/main` `3f5bd46e` on 2026-09-26. No Edge Function, database, workflow, or provider was invoked; no runtime code was changed.

## Finding

An issue page can finish its comments while asset references or legacy comments still have pages. The reader then returns `comments_has_more: false` and `comments_next_at: null`, even when it returned a final comment row (`production-archive/index.ts:405-407, 428-442`). The browser stores that row's ID, but stores no matching timestamp (or retains a timestamp from the preceding comment page); its combined `hasMore` flag still permits a Load More request for the other lane (`src/index/210-production-state-writes.js.part:2600-2616, 2619-2641`).

That request declares `chrono_paging: true` with an ID-only or mismatched comment cursor. The reader accepts it because validation rejects a timestamp without an ID, but not an ID without its timestamp (`production-archive/index.ts:337-350`). It orders comments by `(created_at, id)` yet falls back to `id > comment_after` when the timestamp is absent (`:369-393`). If an earlier comment ID sorts after the final chronological ID, a reference-only continuation can return that earlier comment again; the browser appends it. An offline two-row model with IDs `pc_f0000000` then `pc_10000000` reproduces one repeated row. This is source and synthetic-model evidence, not a hosted failure or a claim that the required reference/legacy pages currently exist.

The existing archive order contract proves that ID order and chronological order can disagree, but does not cover a terminal comment page followed by another lane's page (`test/archive-comment-thread-order.js`).

## Proposed follow-up

Keep the last returned `(created_at, id)` pair accurate even when `comments_has_more` is false, while leaving that flag as the continuation signal. Reject or explicitly reset an incomplete chronological cursor, including one inherited across server versions. Add a fully mocked multi-lane browser/reader check in which comments finish before references, then assert that Load More adds no repeated or missing comments. Confirm the deployed reader version and caller behavior before any runtime change.
