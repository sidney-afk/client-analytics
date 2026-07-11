# Samples realtime STATUS propagation — matrix, tests, vision verdict

**The principle:** a sample component's derived STATUS must update in real time —
no page refresh — in every view whenever it changes from any role. Three views:
(K) Kasper's review queue, (C) the client's review surface (`?c=` link), (S) the
SMM's Samples "Sheet" (organizer, the reported P1 surface) — and the SMM/Kasper
review surfaces.

## P1 bug (owner-reported)

When Kasper requested a change on a component, the SMM Sheet got the NOTE dot live
but the STATUS pill did **not** flip to "Tweaks Needed" until a manual refresh.

Root cause: the samples merge (`_sxrMergeServerRows`) had diverged from the
calendar's. It blanket-KEPT the local row for 5 min after any local status write
(`_sxrIsLocalStatusFresh`) — folding in the server's new COMMENT (note updates)
while keeping the stale local STATUS. The full render was then skipped as
"no visible change" (the LWW false-negative) and only the note dots refreshed.

Fix (faithful port of the calendar): `_sxrRecentSaveReconcile` (+
`_sxrIsStaleLinearRegress`, `_sxrReconcileHasGenuineTweak`) adopts, within the
local-fresh window, only the sub-statuses the server genuinely moved to a NEW
value (a peer's Tweaks-Needed / approval, which always lands a change-request
comment), refusing a bare stale Linear round-trip or a self-echo. Plus
`_sxrRepaintLiveStatus` — a focus-guarded (`_svPreserveFocus`, the PR-705 guard)
in-place status-pill repaint — added to the two realtime shortcut branches of
`loadSxrCards` so the pill flips live even when the full render is skipped or
deferred (user mid-edit), mirroring the existing note-dot refresh.

Path-agnostic: the change is in the browser's realtime *ingest*, so it works
identically for EF- and n8n-routed clients (confirmed below by running the whole
matrix under both routings).

## Realtime STATUS matrix (before → after)

`live` = the observing view's STATUS pill updates in real time (no refresh).
Observers marked `n/a` don't surface that status by design (e.g. the client never
sees in-flight internal work; Kasper's queue only holds Kasper-Approval cards).
Verified by `qa/sxr-multiview.js` (both EF and n8n) unless noted.

| # | Transition | Origin role | SMM Sheet (S) | Client review (C) | Kasper queue (K) |
|---|---|---|---|---|---|
| T1 | For SMM Approval → **Kasper Approval** | SMM | before: live · after: live | n/a (internal) | before: **stale** · after: **live** (card appears) |
| T2 | Kasper Approval → **Tweaks Needed** (request change) | Kasper | before: **STALE (P1)** · after: **LIVE** | n/a (hidden from client) | before: live · after: live (own) |
| T3 | Kasper Approval → **Client Approval** (approve) | Kasper | before: **stale** · after: **live** | before: **stale** · after: **live** (card appears) | before: live · after: live (leaves queue) |
| T4 | Client Approval → **Tweaks Needed** (request change) | Client | before: **STALE** · after: **LIVE** | before: live · after: live (own) | n/a |
| T5 | Client Approval → **Approved** (approve) | Client | before: **stale** · after: **live** | live (own) | n/a |
| T6 | For SMM Approval → **Tweaks Needed** (SMM request change) | SMM | live (own) | n/a | n/a |

The "before" column is the pre-fix behaviour: any observer that was
local-status-fresh (e.g. the SMM had just routed the card to Kasper) kept its
stale pill until a manual refresh — every **STALE**/**stale** cell above. The fix
is transition-agnostic (the merge adopts *any* genuine remote sub-status change
and the repaint repaints *all* pills), so a single change closes every cell; T1–T4
are the spanning set the harness drives directly (T5/T6 share the identical
ingest path).

Control: with the fix reverted (`git stash`), `qa/sxr-multiview.js` turns the T2
cell red — "SMM sheet status pill … still Kasper Approval" — reproducing the P1
bug and proving the harness catches it.

## Tests
- `test/samples-realtime-status-propagation.js` — 17 unit checks on the merge/reconcile (in `npm test`, 52/52 green).
- `qa/sxr-multiview.js` — 3-view real-browser harness (SMM Sheet + client review + Kasper queue), realtime transport emulated via the app's own subscription callbacks, run under EF and n8n routing.
- `qa/sxr-status-shots.js` — the before/after screenshots below.

## Vision verdict — before/after screenshots (dummy data, Sidney TEST)
| Shot | Verdict | Shows |
|---|---|---|
| `sxr-status-before-light.png` | ✅ | VIDEO pill = KASPER APPROVAL, Notes has no unread dot. |
| `sxr-status-after-light.png` | ✅ | VIDEO flipped to TWEAKS NEEDED live (no reload) + URGENT; Notes now ● 1. |
| `sxr-status-before-dark.png` | ✅ | Same "before" in dark — CSS-variable pill colors read correctly. |
| `sxr-status-after-dark.png` | ✅ | TWEAKS NEEDED + URGENT + note dot in dark — correct contrast, no clipping. |

Looks right (no layout breakage / overlap / clipping / wrong colors in either
theme) AND does the right thing (the derived status recomputed and repainted from
the same realtime event that lit the note). No ⚠️/❌.
