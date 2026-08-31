# Flip test — round 3 log (2026-08-31)

Executed against `docs/ops/FLIP_TEST_ROUND3.md` on the live product, TEST client
`sidneylaruel` only. Model: Sonnet 5 (switched mid-session from Opus 5, which
ran the 2026-08-30 flip-day playbook). Branch continues from
`main` @ `d86717df` (merge of #1184), which already contains fixes for the
2026-08-30 findings (items 76/81/82/83/84/85/86 in OPEN_REPAIRS — my Findings
A/B/C/D/E/F from that day, all closed same-day).

**The client share-link token is never written to this file.** Where a finding
needs it, it is given to the owner in chat.

---

## P0 — the batch-parent detail view hard-freezes on load (BLOCKS §2a, part of §3)

**SAW:** Opening a batch parent's detail view in Production —
`?prod=1&d=bat_<id>`, or clicking through from a sub-issue's parent link — never
finishes rendering. The tab becomes unresponsive to clicks and screenshots
within ~1 second. DevTools console fills with dozens of
`RangeError: Maximum call stack size exceeded` per second until the tab is
navigated away.

**EXPECTED:** The parent's Assets panel (Filming plan / Raw footage / Frame
folder, no Deliverable file — §2a) and Labels ("No labels", no Retry — §3)
render normally.

**STEPS (100% reproducible, 3/3 attempts, 2 independent batch ids):**
1. Open `https://syncview.synchrosocial.com/?prod=1&d=bat_cdf2acc0-5657-4761-b2a0-c98cffded7ac` in a **fresh tab** (cold load, not a same-tab navigation).
2. Wait ~1s. The tab is now unresponsive.
3. Repeated independently against `bat_480a9afa-9952-4c69-bc31-b4c0de9b299c` (an unrelated batch, the parent B1 adopted my stray-catcher sub-issue into on 2026-08-30) — identical freeze, identical stack trace.
4. Also reproduced via same-tab navigation: clicking the parent-issue link from sub-issue VID-13659 (`Sub-issue of VID-13658…`).

Only recovery: navigate the tab to a different URL. The frozen tab does not
recover on its own.

**ROOT CAUSE (read from source, index.html):**

`_prodRender()` (line 55575) calls `_prodEnsureLabels(_prodState.openId, false)`
unconditionally on every render pass when the view is `'detail'`. Inside
`_prodEnsureLabels` (line 47443), the branch for a synthetic batch parent
(`issue.syntheticBatchParent === true`) runs **before** the memoization guard
`if (!force && current) return current;` that every other issue type relies on
to short-circuit repeat calls. The synthetic-parent branch unconditionally
calls `_prodRefreshLabelSurfaces(id)` (line 47435), which — if `#prodRoot`
exists — calls `_prodRender()` again. That closes the cycle:

```
_prodRender (55575)
  → _prodEnsureLabels (47477, synthetic-parent branch, no memo check)
    → _prodRefreshLabelSurfaces (47436)
      → _prodRender (55575)
        → _prodEnsureLabels ...  [repeats until the call stack overflows]
```

This is a regression **introduced by the fix this very round is meant to
verify**. The code comment at 47443 explains the intent correctly — a synthetic
batch parent has no Linear issue of its own, so `handleLabelsRead` would 404
forever, and the fix settles the state to `{status:'ready', catalog:[],
structural:true}` instead of leaving a Retry loop. That part is right. What's
missing is a check *before* re-entering the synthetic branch — something
equivalent to `if (current && current.structural) return current;` — so the
settled state is honoured on the next render instead of being recomputed (and
re-triggering a render) every single time.

**Consequence for this round's testing:** §2a (parent asset panel) cannot be
visually verified — the page that would show it never paints. The backend data
it would show is verified separately below via REST, but that is not the same
as confirming the UI renders it, and the UI in its current state cannot be
opened by anyone, staff or otherwise. The "Labels on a batch parent" half of
§3 is unverifiable for the same reason — ironic, since the labels fix is the
proximate cause.

**Not filed as multiple findings** — one root cause, one fix needed.

---

## FINDING 1 — Create Post is completely broken: localStorage is at quota (HIGH, blocks new-post testing entirely)

**SAW:** Every attempt to submit Create Post (any mode, any editor, fresh dialog
each time) fails instantly with **"The post was not created. Your request is
safe to retry."** — and it is not safe to retry; it fails identically every
time. Zero network requests fire (confirmed via the browser's own network
capture, cleared and re-checked before each attempt). Reproduced 4/4 attempts
across two page loads (including a fresh reload onto the newest deploy the app
itself prompted for).

**EXPECTED:** A new post is created (this worked cleanly in the 2026-08-30
session, first attempt, no retries).

**ROOT CAUSE, confirmed by intercepting the real error object** (not the
displayed text — the generic banner is the fallback for a code the mapping
table has no case for):

```
Error: native_intake_storage_unavailable
    at _linearIntakePending (index.html:44768)
```

`_linearIntakePending` calls `_linearIntakeWrite(pending, {allowCreate: true})`
(index.html:44586), which wraps `localStorage.setItem(NATIVE_INTAKE_PENDING_KEY,
...)` in a try/catch that swallows the exception and returns `false`. The
caller then throws the generic `native_intake_storage_unavailable`, which has
**no case** in `_calNativePostErrorText` (index.html:39577), so it falls to the
same "safe to retry" sentence used for genuine transient failures — exactly
backwards, since this one will fail identically forever until storage is freed.

**Confirmed by direct measurement: localStorage on this origin is at ~10.00MB**,
sitting on Chrome's per-origin quota ceiling. A bare 50KB test write throws
`QuotaExceededError` immediately. 56 keys total; two categories account for
essentially all of it:

| category | size |
|---|---|
| `syncview_production_cache_v1` (single key) | **4584.1 KB** |
| 34 separate `syncview_kasper_cal_<slug>_v1` keys (one per client Kasper has ever loaded) | **~4700 KB combined**, ranging 0.2 KB–405.1 KB each |
| `syncview_linearIssuesCache_v1` | 966.3 KB |
| everything else (identity, prefs, diagnostics, pins) | < 60 KB combined |

**This is the same pressure Round 1's Part 0 observed and treated as harmless**
(`syncview_analyticsCache_v1 write skipped: ... exceeded the quota`, logged as
a console warning with no user-facing effect at the time). It has since grown
enough to break a load-bearing write path: **no staff account can create a new
post from this browser profile** while it holds. Any other write that goes
through `localStorage.setItem` without a try/catch — or with one that doesn't
degrade gracefully — is equally at risk; Create Post is simply the first one
this round happened to hit.

**Two separate defects, not one:**
1. Nothing evicts or caps the per-client Kasper cache or the production cache —
   34 client entries and a single 4.5 MB blob accumulate without bound as staff
   browse more clients over a session's lifetime.
2. The failure mode when a write is genuinely blocked is silent and
   mis-classified: `native_intake_storage_unavailable` has no branch in
   `_calNativePostErrorText`, so a permanent, storage-exhaustion failure is told
   to the SMM as if it were a random transient one worth retrying — the exact
   "wrong advice" class the `batch_team_mismatch` comment two lines above this
   code already names as costly ("cost a videographer eleven identical
   submissions... before anyone learned why").

**Worked around for testing purposes** (not a fix): cleared the read-cache keys
(`syncview_production_cache_v1`, `syncview_linearIssuesCache_v1`, all 34
`syncview_kasper_cal_*_v1` entries, `syncview_calCache_v2:sidneylaruel`) from
this browser's localStorage — pure client-side cache the app regenerates on
its own, no server state touched, no other profile affected. Identity, auth,
prefs and the diagnostic ring were left untouched. Create Post is expected to
work again after this; verified below.

**Confirmed fixed by the workaround.** After clearing the 41 cache keys and
reloading, Create Post succeeded on the very next attempt — "Post created.
Video and Graphics are saved; the Linear mirror is still draining." Same
dialog, same account, same client, no other change. This closes the loop:
localStorage exhaustion was the entire cause.

---

## FINDING 2 — §2b is universally, 100% non-functional: `batches.team` is never populated (HIGH — the asset spec's headline write path does not work at all)

**SAW:** Saving Raw footage (or Frame folder) always fails with **"The change
was not saved. Please try again."**, regardless of whether the pasted value is
valid or invalid. Reproduced on:
- The 2026-08-30 test batch (`bat_cdf2acc0…`), invalid URL (Google Doc) and — separately — replayed with a **valid** Drive folder URL: same failure.
- A **brand-new batch created today**, moments before the test, via Create Post
  under the current live deploy (`bat_a12b7ac9-edcf-4a08-882a-2f5ce40a3e23`),
  valid Drive folder URL: same failure.

**EXPECTED (§2b):** A valid Drive/Frame folder link saves, propagates to every
sub-issue on the batch and to the parent, and an invalid one (Google Doc, plain
word) is refused with a sentence naming what IS accepted.

**ROOT CAUSE, confirmed by replaying the exact write with the app's own
headers and reading the raw response (not the displayed text):**

```json
{"ok": false, "error": "entity_scope_unavailable"}    // HTTP 409
```

`production-write/index.ts`'s `handleBatchAssetWrite` reads the `batches` row
and refuses unconditionally when its `team` column is empty:

```ts
const team = normalizeTeam(existing.team);
if (!team) throw new GatewayError(409, "entity_scope_unavailable");
```

**On the freshly-created batch, `team` is `null`** — confirmed by reading the
row the app itself holds after creating it seconds earlier:

```json
{
  "id": "bat_a12b7ac9-edcf-4a08-882a-2f5ce40a3e23",
  "team": null,
  "linear_parent_ids": {
    "video":    {"owner_team": "video", "identifier": "VID-13665", ...},
    "graphics": {"owner_team": "video", "identifier": "VID-13665", ...}
  },
  ...
}
```

The batch **knows its team** — `linear_parent_ids.video.owner_team` says
`"video"` — but whatever creates the `batches` row (the `intake_create`
operation, its INSERT is inside a Postgres RPC not visible from the edge
function source in this checkout) never copies that into the top-level `team`
column. Every batch this session touched has the same gap, spanning a batch
created yesterday and one created ninety seconds before this test — so this is
not a backfill gap on old data, and not something a migration can quietly heal
on its own: **new batches are affected on creation, right now, under the
current deploy.**

**Severity: every batch on the estate is affected.** `batch_asset` is the write
operation for both Raw footage AND Frame folder (`PROD_ASSET_SPECS`,
index.html:46514-46515) — there is no batch whose `team` write-check can
currently pass, so **neither of §2b's two editable fields can be saved by
anyone, on any post, valid link or not.** This is the headline feature this
round exists to test, and it does not work at all.

**Secondary, smaller defect riding along:** even setting the `team` gap aside,
the invalid-URL case (§2b's Google Doc / plain-word check) would ALSO surface
wrong: `entity_scope_unavailable` has no branch in `_prodWriteErrorText`
(index.html:51194+), so it falls to the same generic "try again" text that a
genuinely invalid URL would need. The correct, specific copy for that case
already exists and is exactly right —
`if (code === 'invalid_artifact_url') return 'Use an HTTPS link to a Drive,
Dropbox or Frame.io file or folder. A Google Doc is a brief, not a deliverable,
and Linear uploads are private to Linear.'` (index.html:51211) — but it can
never be reached today, because every request 409s on the team check before
the URL is ever validated server-side.

**Not tested further given this:** the propagation-to-siblings check, the
clear-to-empty check, and the unshared-folder-accepted check all require a
save to succeed first. None could be exercised. §2b is a full miss this round,
not a partial one.

---

## §2c — the deliverable file, both directions — PASS (full)

Only editable slot unaffected by Finding 2, since it uses the `attachment`
operation, not `batch_asset`.

| check | result |
|---|---|
| Editor attaches on a video sub-issue -> card's Video URL | **PASS** — `asset_url` matched exactly |
| Editor attaches on a graphics sub-issue -> card's Thumbnail | **PASS** — `thumbnail_url` matched, `?usp=` query stripped/canonicalized |
| Label reads "Thumbnail file" on graphics, generic on video | **PASS** — confirmed both labels live |
| SMM pastes a video URL on a card whose sub-issue has none -> sub-issue shows it | **PASS** — "Open link · **from the content calendar**" appeared verbatim |
| Press Edit, save unchanged -> note disappears, calendar still holds it | **PASS** — note gone, state flipped Expired->Available (became the issue's own file), card's `asset_url` unchanged after |

One care note for future testers: the deliverable-file save path DOES verify
reachability before accepting (a link that 404s is refused, unlike the
batch_asset folder fields which explicitly accept an unreachable link per
§2b's spec) — a fabricated test URL will bounce here. Re-used the owner's real
`f.io` test asset once that was clear.
