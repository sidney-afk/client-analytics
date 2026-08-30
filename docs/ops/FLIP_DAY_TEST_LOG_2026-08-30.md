# Flip-day hands-on test log — 2026-08-30

Executed against the live product per `docs/ops/FLIP_DAY_TEST_PLAYBOOK.md`, two
days after F1(video). Writes touch only the TEST client `sidneylaruel`.

- Playbook source: `main` (PR #1177 merged 2026-08-30T18:01:52Z, merge commit
  `66c1291f`). Item 62 is therefore **FIXED** in the build under test, so the
  metadata banner appearing today would be a regression, not the known issue.
- Log branch: `claude/flip-test-log-2026-08-30`.
- No real client names, tokens, or share URLs appear in this file (ground rule 2).

## Status

| Part | Scenario | Result | Evidence |
|---|---|---|---|
| 0 | Perishable console evidence | **DONE — clean negative, with a scope caveat** | §Part 0 |
| 1 | SMM journey | in progress | |
| 2 | Kasper journey | pending | |
| 3 | Client journey | pending | |
| 4 | Production tab | pending | |
| 5 | Backend live checks (Linear) | pending | |
| 6 | Known-broken spot checks | pending | |
| 7 | Visual pass | pending | |

---

## Part 0 — perishable evidence, before any page load

**Captured 2026-08-30T18:06:21Z**, by the owner, from the DevTools console of an
already-open SyncView tab in **Opera** (path `/`, the `?Kasper=1&sxr=1` surface).
Opera was used because the pre-existing tab lived there; the Chrome extension
this session drives cannot reach Opera, and computer-use grants browsers
read-only access, so the owner ran the snippet. No SyncView page had been loaded
by this session at capture time.

### Result — all three probes empty

| Probe | Result |
|---|---|
| `peekWriteUiQueueDiagnostics()` | 50 rows, **all** `surface: "lifecycle"`, `outcome: "pagehide_snapshot"`, `kind: calendar:0\|sxr:0\|cards:0\|native-intake:0\|source-repairs:0`, `code: ""` |
| `peekLinearOutbox()` | `[]` |
| `syncview_calCardJobs_v1` | `[]` |

### What this actually proves

Three corrections to the playbook's premise, established by reading the code
rather than assuming:

1. **The first two probes are NOT perishable.** `peekWriteUiQueueDiagnostics()`
   reads `syncview_write_ui_queue_diag_v1` from **localStorage**
   (index.html:25573), a ring capped at the last 50 rows
   (`list.slice(-50)`, index.html:25570). `peekLinearOutbox()` reads
   `syncview_linear_outbox_v1`, also localStorage (index.html:29095-29107).
   Both survive page loads. Only `calCardJobs` is destroyed on load, by the
   authority-discard branch at index.html:45908. The playbook's "a page load
   drains the first" is wrong; the evidence was more robust than assumed.
2. **The window is bounded by the ring cap, not by retention.** Exactly 50 rows
   came back — the cap — so older rows were evicted. The observable window is
   `2026-08-27T00:21:48Z → 2026-08-30T18:06:00Z`. That window does cover the
   08-28 video flip and all of the post-flip period.
3. **The empty `calCardJobs` is corroborated, not merely absent.** If a queued
   calendar-card job had been discarded by the item-65 authority branch, it
   would have written a `surface: 'submission', outcome: 'discarded_authority'`
   row into the same ring (index.html:45910). There is not one. Nor is there a
   single `ui_write_failure`, `quarantined`, `drained`,
   `discarded_authority_flip`, or `source_gate_*` row. Across the whole window,
   in this profile, **no queued write was ever discarded, quarantined, drained,
   or failed** — and every pagehide snapshot recorded all five queues at zero.

### The scope caveat — this cannot settle item 69, and here is why

Item 70 nominates itself as item 69's mechanism and says the decisive evidence
is `peekWriteUiQueueDiagnostics()` "in that viewer's browser". **This is not
that browser.**

Item 69's lost write is a *client* approval — `client_video_approved_at =
2026-08-29T13:28:48Z` — made through the client share link, on the client's own
device. The profile sampled here is the owner's staff profile. localStorage is
origin-scoped, so any client-link use *in this same Opera profile* would have
shared this outbox — but it shows nothing.

The timeline closes it independently: the ring's rows run
`2026-08-29T00:25:50Z` then jump straight to `2026-08-30T18:06:00Z`. There is
**no pagehide anywhere near 2026-08-29T13:28Z**, so this profile had no SyncView
page close or hide at the moment the lost write happened.

**Verdict on Part 0:** a clean negative that *excludes the owner's Opera profile*
as the locus of item 69, and shows no silently-retained legacy work anywhere in
it. It neither confirms nor refutes item 70 as item 69's cause — the browser
that could do that is the client's, which is not reachable from here. Item 70
should stay INFERRED. Recommend the playbook's Part 0 be re-scoped: as written
it points at the wrong machine for the question it is trying to answer.

### Raw output

Captured verbatim; the 50 diagnostic rows are identical except for `at`.

```json
{
  "when": "2026-08-30T18:06:21.184Z",
  "origin": "https://syncview.synchrosocial.com",
  "path": "/",
  "queueDiagnostics": [
    {
      "at": "2026-08-27T00:21:48.425Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-27T01:02:48.414Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-27T01:02:48.518Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-27T01:03:48.336Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-27T14:55:36.557Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-27T15:23:37.053Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-27T15:53:38.620Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-27T16:29:07.697Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-27T16:59:08.930Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-27T17:29:11.049Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-27T17:40:00.346Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-27T17:40:31.536Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-27T17:44:18.951Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-27T19:24:36.715Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-27T19:25:37.561Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-27T20:20:36.724Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-27T20:21:36.587Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-27T20:22:07.416Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-27T20:26:01.845Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-27T21:12:37.076Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-27T21:12:37.149Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-27T21:16:37.029Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-27T21:16:37.214Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-28T00:07:21.958Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-28T00:07:36.490Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-28T00:08:26.529Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-28T00:08:36.926Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-28T00:37:23.500Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-28T03:00:42.542Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-28T14:33:24.725Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-28T14:33:33.957Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-28T14:35:30.940Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-28T14:42:14.550Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-28T14:46:42.479Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-28T15:03:25.815Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-28T15:03:34.840Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-28T15:03:42.377Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-28T18:45:31.079Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-28T18:49:14.915Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-28T19:38:18.110Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-28T21:08:25.130Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-28T21:09:30.322Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-28T23:51:29.662Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-28T23:51:48.119Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-28T23:55:37.354Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-28T23:57:49.144Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-29T00:25:37.759Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-29T00:25:39.678Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-29T00:25:50.744Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    },
    {
      "at": "2026-08-30T18:06:00.078Z",
      "surface": "lifecycle",
      "kind": "calendar:0|sxr:0|cards:0|native-intake:0|source-repairs:0",
      "outcome": "pagehide_snapshot",
      "code": ""
    }
  ],
  "linearOutbox": [],
  "calCardJobs": []
}
```
