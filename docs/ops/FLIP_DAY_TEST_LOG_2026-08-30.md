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

---

## Part 1 — the SMM journey

Tab A: SMM calendar for `sidneylaruel`. Tab B: Production (`?prod=1&d=…`).
Lane check (ground rule 7) on tab A at 18:11Z: **41 slugs, `sidneylaruel`
present** — item 70 did not fire on this session. `peekLinearOutbox()` 0,
`calCardJobs` 0.

Baseline before any writes: 8082 cards for the TEST client, **12 live**
(non-archived), 11 live carrying `video_deliverable_id`, 1 carrying
`graphic_deliverable_id`. The test estate is repaired (item 68).

### 1a. BOTH post — PASS on creation, FAIL on projection

Created via Create Post → "Video + Thumbnail" ("1 post → 2 sub-issues").

| Check | Result |
|---|---|
| Card appears | PASS — `p_native_34bbc3dc4045831ea92d3dd9d373_1`, "Video 1" |
| Carries BOTH native ids | **PASS** — `video_deliverable_id del_822ddcf0-…`, `graphic_deliverable_id del_a1b5a9ba-…` |
| Write target | **PASS** — `POST /functions/v1/calendar-upsert` → 200. No `webhook/linear-*`. |
| SyncView icon → `?prod=1&d=…` | PASS — opens the real sub-issue |
| Correct client / status / parent | PASS — VID-13659, "Sidney Laruel", Todo, under parent VID-13658 |
| Internal comment | **PASS** — `POST /functions/v1/production-comments`. No `webhook/linear-add-comment`. |
| Status change in Production | **PASS** — `POST /functions/v1/production-write` → 200 |
| `status_change` event, `legacy_parity: false` | **PASS** — event 90976, `todo → smm_approval`, `legacy_parity: false`, actor admin, surface `production` |
| Canonical row moved | PASS — `deliverables.status = smm_approval` @ 18:17:00Z |
| **Calendar card reflects it** | **FAIL — see below** |

The deep link uses `d=<del_…>` (the native deliverable id), not `d=<VID-…>` as
the playbook's shorthand says. Cosmetic; noted so the playbook can be corrected.

The Linear mirror is **server-side** (`mirror_outbox`), not a browser call: the
card's creation produced `mirror_out_create_link` and `mirror_out_echo_dropped`
events and live issues VID-13659 / GRA-7294, with **zero** `webhook/linear-*`
requests from the browser on any action. The post-create dialog says "Video and
Graphics are saved; the Linear mirror is still draining", which is accurate.

### FINDING A — item 12 / F50 on video, post-flip (**SUPERSEDED — see Correction A below**)

**A status change made in the Production tab never reaches the calendar card.**

| | value |
|---|---|
| canonical `deliverables.status` | `smm_approval`, `updated_at 2026-08-30T18:17:00Z` |
| card `calendar_posts.video_status` | `In Progress`, `video_status_at 2026-08-30T18:13:50Z` |
| elapsed when re-measured | 6 minutes (18:22:57Z) — still diverged |
| card row `updated_at` | 18:22:24Z — the row **was** touched, and still did not adopt the status |

Not realtime, not after a reload, not after six minutes. Reproduced on the same
card twice.

This is **not new** — it is OPEN_REPAIRS **item 12 (F50, "creative status
projection")**, found 2026-08-09 — but item 12 was written as a *prediction*
about the graphics flip ("the morning after the flip, a graphics status change
would land in `deliverables` and reach no reviewer or client surface"). This is
the first hands-on confirmation that it is **live for VIDEO**, two days after
F1(video), on the surface this test day is built around.

Re-verified item 12's own evidence today, and one line of it has drifted:

- item 12 says grep for `calendar_posts|video_status|graphic_status` in
  `supabase/functions/production-write/index.ts` returns **zero** matches.
- Today: `video_status|graphic_status` → **0** (the substance holds exactly),
  but `calendar_posts` → **2**, a later read-only thumbnail fallback
  (`graphicsApprovalArtifactCandidate`, index.ts:3656-3686). It reads the card;
  it still never writes a status to it.

Severity is worth restating in post-flip terms: every Production-tab status
change — the round-trip this playbook asks for on *every card* — is invisible to
the SMM calendar, and by the same column reads, to Kasper and the client.

### FINDING B — `#calendar/<slug>` renders the analytics roster on load (MEDIUM, new)

Loading the SMM calendar deep link does not mount the calendar.

- Reproduced 3×: hard reload, `#workload` → `#calendar/sidneylaruel`, and a
  direct navigation. Persisted >45 s each time.
- App state at the time: `currentNav: "calendar"`, `calState.client: "Sidney
  Laruel"`, `wlIsAllowedClient → true`, pins `["Sidney Laruel"]` — but
  **`document.getElementById('calView')` is `null`** and `cal-card` count is 0.
  The nav pill shows Calendar as active while the body still holds the
  analytics roster. No error, no empty state.
- Recovery: clicking the already-active **Calendar** nav button mounts it
  (`calView: true`, 204 cards).
- It worked on the very first cold load of the session, before prefs/pins were
  written; every load after that failed.

Consequence: the SMM's bookmarked calendar URL — the exact shape the owner
supplied for this test — opens on the all-client analytics table instead of the
client's calendar, silently.

### 1e. Linear link slot, post-flip contract — PASS

- `_writeUiLinkSlotSealed('video')` and `('graphics')` both **true**.
- Zero "Change the linked …" affordances in the DOM. The only slot control is
  the cross, "Remove this video/graphic sub-issue link" — which
  `test/write-ui-link-slot-seal.js` pins as required ("CLEARING an existing link
  must stay possible (it is the repair)"). Sealed as designed.
- **No banners at all** — no orange missing-metadata banner, no parent-linked
  banner. Item 62's fix is live in this build.
- Linear-open icons: the newly created card renders **only** the two SyncView
  Production links. 12 Linear-open anchors exist on the surface, all on older
  cards. Noted for the owner's open product question.

### 1b / 1c — PASS

| Post type | Card | Native ids | Toast |
|---|---|---|---|
| Video only | `p_native_6ac03d0b41d2ad6e9ae9aef42037_1` | `video_deliverable_id` only, graphic **null** | "The video is saved; the Linear mirror is still draining." |
| Thumbnail only | `p_native_c05f65564a6b9b1e8d35eeaa75d3_1` | `graphic_deliverable_id` only (GRA-7296), video **null** | "The thumbnail is saved; ..." |

Dialog copy is correct per mode ("1 post -> 2 sub-issues" / "1 post -> 1 sub-issue").
The video-only card renders **THUMBNAIL N/A** greyed and the thumbnail-only card
renders **VIDEO N/A** — the item-64 shape, checked in Part 6.

### 1d — fields survive. PASS

Thumbnail URL (owner-supplied Drive image), video URL (owner-supplied Frame
link) and caption all persisted; the thumbnail image renders on the card. A
later CTA edit also persisted. Write target captured first-party:
`POST /functions/v1/calendar-upsert`, and the payload carries **only the changed
field** — e.g. `{"client":"sidneylaruel","post":{"id":"p_native_34bbc...._1","cta":"..."}}`.
No `webhook/linear-*` on any field write.

> **Instrumentation note.** The browser-extension network capture proved
> unreliable — it reported "no requests" for writes that demonstrably landed
> (the CTA save at 18:31:26.697Z). Every negative claimed here about
> `webhook/linear-*` from 18:40Z on is therefore backed by a **first-party
> recorder** patched over `window.fetch` / `XMLHttpRequest.open` /
> `navigator.sendBeacon` in the page, not by the extension capture.

---

## FINDING C — a card status moved to the Linear value with no SyncView actor and no event (HIGH, mechanism undetermined)

This is the Part 5b signal the playbook says to capture and report immediately.

**Timeline (all UTC, card `p_native_34bbc3dc4045831ea92d3dd9d373_1` /
`del_822ddcf0-325f-412f-929f-85370b8517e3`):**

| time | what |
|---|---|
| 18:16:59 | I set the deliverable to `smm_approval` from the Production tab (`production-write`, event 90976, `legacy_parity: false`) |
| 18:18:09, 18:22:57 | measured: card `video_status = "In Progress"`, `video_status_at = 18:13:50` |
| 18:26:27 | **I set VID-13659 to `Approved` in Linear and cleared its assignee** (Part 5b) |
| 18:26:27.685 | `foreign_write_detected`, `detect_only: true` — correct |
| ~18:29:30 | screenshot: card pill still reads **IN PROGRESS** |
| **18:31:26.83** | **card `video_status` = `"Approved"`, `video_status_at` stamped** — the exact Linear value |
| 18:32:54 on | canonical `deliverables.status` still `smm_approval`, `updated_at 18:17:00` — **never moved** |

The **canonical row held** (detect-only did its job) but the **card adopted the
foreign Linear value**, with **no `status_change` event, no actor, and no
explanation** — the same shape as item 69, in the opposite direction. The
client-facing surface now reads "Approved" for a deliverable whose canonical row
says it is still awaiting SMM approval.

**Mechanism: not determined. Seven candidates ruled out** by code and by live
experiment rather than assumed:

1. `_calReconcileLinearStatuses`, the v1 Linear-to-calendar pull that writes
   `_calPendingEdits[..].video_status` (index.html:32164-32220) — **excluded**:
   it early-returns under v2 and `_calV2Ready()` is **true** on the live tab.
   Its own comment names this exact symptom as why it was disabled.
2. n8n **"SyncView Calendar - Linear Status Sync"** (`MJbMZ789B5ExZz9x`, the
   inbound Linear-to-post status sync) — **excluded**: `active: false`.
3. n8n "Linear Reconcile Trigger" (`AkiFmromoDkmsh39`) — **excluded**: `active: false`.
4. `supabase/functions/linear-inbound` — **excluded**: `handleIssueEvent` hits
   `isDetectOnlyTeam` and returns `{ok, detect_only:true}` *before* any field
   write (index.ts:759-772); `maintainCardLinkage` only ever writes the
   `video_deliverable_id` / `graphic_deliverable_id` slots, never a status.
5. `production-write` — **excluded**: zero matches for `video_status|graphic_status` (Finding A).
6. Browser persisting a drifted in-memory status on save — **excluded**: the
   captured `calendar-upsert` body carries only the changed field.
7. A server-side timer pull — **excluded so far**: I then set Linear to
   **`Scheduled` at 18:34:02** and the card did **not** adopt it over the next
   ten minutes (still `Approved`, `video_status_at` unchanged), across two
   further card saves at 18:40:36 and 18:42:43.

A freshness guard keyed on a recently-touched card row would explain (7) — my
own edits kept resetting it. The card was left deliberately untouched from
18:42:43 to re-test that window cleanly; result recorded in the Part 6 section.

**Why it matters:** a phantom status the client can see, produced by a foreign
Linear edit, with no trail. Item 69 asks whether a write can be lost on the
native path; this is the same class of damage arriving from the other side, and
it survived detect-only.

---

## Part 4 — Production tab as a first-class surface

| Check | Result |
|---|---|
| Cold deep link `?prod=1&d=<del_...>` in a fresh tab | **PASS** — opens the right detail; the "Needs attribution" breadcrumb during load is only the skeleton placeholder and resolves correctly |
| Team scope All / Video / Graphics | **PASS** — Todo 579 all-teams to 426 Video; breadcrumb and URL (`&team=video`) both track |
| Client filter | **PASS** |
| No unattributed leak into a client view | **PASS** — VID-164 ("Needs attribution") is present in All-teams/Video but **absent** once the client filter is applied |
| Create is closed | **PASS** — "+ New issue" is gated: *"Posts are created on the content calendar, not in Production. Use Create Post on the client's Calendar or Samples tab."* |
| Item 73 (2023 stray) | **CONFIRMED as described** — VID-164 sits at the top of Active with a "Needs attribution" badge. Not re-filed. |

### Positive finding — the attribution write-guard holds

While filtering, keystrokes reached the issue list instead of the search box and
triggered a shortcut on the selected **VID-164** row (unattributed, not the TEST
client). The app refused with *"Client attribution needs repair before writing."*
The first-party recorder showed **7 requests and zero writes** (no
POST/PATCH/PUT/DELETE), and Linear confirms VID-164 untouched
(`updatedAt 2024-09-15T23:05:12Z`). The guard refuses **before** the network,
not after. Ground rule 1 intact.

---

## Part 5 — backend live checks (Linear access available)

### 5a. The stray catcher, end to end — PASS (the audit's highest-value test)

Created **VID-13660** directly in Linear at **18:26:08Z** under the TEST client's
video parent VID-13658 (project "Sidney Laruel", team Video).

The `b1_incremental_refresh` window that ran **18:30:54.950 to 18:30:55.258Z**
imported it — **4 min 47 s** after creation, well inside the ~30 min expectation:

| field | value |
|---|---|
| `stray_catcher` | `true` |
| `changed_issue_count` | **8** (prior runs: 0) |
| `operational_count` | 7 |
| `writes.deliverable_rpc_writes` | **1** — a real write |
| `writes.archive_upserts` | 1 |
| `batch_parent_adoptions` | `minted_id b1_b_0ff536dc...`, `adopted_id bat_480a9afa...`, `parent_uuids [16f333f4..., 4c03b1f5...]` — **two** parent uuids, the both-team map |
| per-issue event | `actor: codex-b1-incremental`, `linear_issue_uuid 3906cca3-...`, `incremental: true` |

The imported row: `b1_d_3906cca3c17a4ac79381bdd0e48b4a7e`, **`client_slug:
sidneylaruel`**, `team: video`, `batch_id: bat_480a9afa-9952-4c69-bc31-b4c0de9b299c`,
status `todo`.

The three preceding runs (17:30:49, 17:50:32, 18:00:48) all recorded
`changed_issue_count: 0` and `deliverable_rpc_writes: 0` — the "green no-op"
state the audit could not distinguish from a silently broken importer.
**It is not broken.** B1 imports a Linear-born sub-issue, attributes it to the
right client, and adopts it into a both-team parent map.

### 5b. Detect-only, both directions — PASS on the canonical row, FAIL on the card

Changed the status **and** cleared the assignee on VID-13659 at 18:26:27, then
set a second distinct status at 18:34:02.

- deliverable did **not** move — `deliverables.status` stayed `smm_approval`. **PASS**
- `foreign_write_detected` appeared for both changes (18:26:27.685, 18:34:13.370), `detect_only: true`. **PASS**
- the calendar card **did** adopt the first Linear value. **FAIL** — Finding C.

---

## Part 7 — visual pass (running)

### FINDING D — mojibake in a live client-attribution badge (LOW, new)

Production list, row VID-12569 ("TEST"), orange attribution badge renders the
client name followed by a double-encoded separator and " provisional".
Codepoints confirm `194, 183` — `U+00C2` then `U+00B7`, i.e. the UTF-8 bytes for
the middle dot decoded as Latin-1. Cosmetic, but it sits on a badge whose whole
job is to state who owns a row.

### Other visual observations

- Post-create dialog "the Linear mirror is still draining" is **accurate**, not
  stale copy: the mirror is a server-side `mirror_outbox`, and the card
  genuinely gained VID-13659 / GRA-7294 moments later.
- The newly created card renders **only** the two SyncView Production links; the
  12 `linear.app` anchors on the surface all belong to older cards.
- The Production detail badge flips from "Preview - read-only" to **"Native
  writes"** once loaded — correct for a SyncView-authoritative team.

---

## CORRECTION A — Finding A was called too early, and Finding C is its other half

Findings A and C were written before I found the component that explains both.
They are one mechanism, and the correct account is below. **Finding A as
originally written — "a Production status change never reaches the calendar
card" — is wrong**, and Correction A supersedes it.

### What actually carries status to the card after the flip

`scripts/linear-sync-reconcile.js` is the flip's status projection. Its own
comment block (lines 309-323) states the per-component authority modes:

```
 *   linear                       -> bidirectional, exactly as always.
 *   syncview + outbound "live"   -> PULL-ONLY. Linear→card repairs run
 *     (that is the flip's status projection); card→Linear pushes are
 *     suppressed, because the native gateway + outbound mirror own that
 *     direction now ...
 *   syncview + outbound off/shadow -> detect-only, as before the flip.
 *   write_safe false             -> detect-only, everything, as always.
```

so post-flip the intended chain is:

`production-write → deliverables → mirror_outbox → Linear → reconciler (pull-only) → calendar_posts`

Cadence: the workflow is **dispatch-only**, driven by the monitored n8n pager
`qllIDZPkdNAPRj0b` **every 15 minutes** (`.github/workflows/linear-sync-reconcile.yml`).

### Consequences for both findings

- **Finding A.** I measured the card for **6 minutes** after a Production status
  change and reported that it never arrives. That is inside one projection
  cycle, so the measurement could not support the claim. `production-write`
  genuinely never writes the card (zero matches for `video_status|graphic_status`
  — that part stands, and item 12's code claim is still accurate), but a
  different component delivers the projection. **Retracted.**
- **Finding C.** The "no actor, no event" card write is this reconciler, writing
  `calendar_posts` directly through `calendar-upsert-post`. That is why there is
  no `deliverable_events` row: the reconciler is not a gateway writer. The
  ~12 min 24 s lag I measured (Linear 18:34:02 → card 18:46:26.65) is one
  15-minute cycle. The freshness guard I inferred is real and documented: the
  ledger uses the DB-stamped `calendar_posts.video_status_at` as the card-side
  change time, which is why my own edits kept deferring adoption.

### What remains a real finding, restated correctly

The projection is **most-recent-action-wins**, not "canonical wins":

1. **A foreign Linear edit can overwrite the card**, which is the client-facing
   surface, for a team where Linear is no longer authoritative. That is what
   happened twice today (`Approved` at 18:31:26, `Scheduled` at 18:46:26) — both
   times against a canonical row that read `smm_approval` throughout.
2. **The card can disagree with the canonical row indefinitely**, because the
   two are written by different components in different directions:
   `production-write` writes `deliverables` and never the card; the reconciler
   writes the card and never `deliverables`. Nothing reconciles those two — only
   card↔Linear.
3. **The projection carries no audit trail.** A card status that a client acts on
   can change with no `deliverable_events` row, no actor and no `status_change`
   — the exact evidentiary gap that made item 69 hard to diagnose.

Whether the intended path completes end to end is measured in Correction B.

---

## CORRECTION B — the Production round-trip DOES complete end to end (measured)

Clean test, no intervention: set the deliverable from the **Production tab** and
then left the card alone.

| time | event |
|---|---|
| 18:50:53.70 | `production-write` → `status_change` to `kasper_approval`, `legacy_parity: false` |
| 18:50:53.78 | canonical `deliverables.status = kasper_approval` |
| 18:50:56.83 | `mirror_out_echo_dropped` — mirror pushed it to Linear |
| **19:01:32.86** | **card `video_status = "Kasper Approval"`** |

**Elapsed 10 min 39 s**, unattended. The intended chain
`production-write → deliverables → mirror_outbox → Linear → reconciler (pull-only) → calendar_posts`
**works**. Finding A is definitively retracted: the Production-tab round-trip the
playbook calls "the point of the day" completes; it is just slow, bounded by the
15-minute reconciler dispatch.

### The calendar pill, by contrast, updates both sides immediately

Same card family, status driven from the **calendar pill** instead:

| time | what |
|---|---|
| 18:54:21.799 | `POST /functions/v1/production-write` → canonical `smm_approval` @ 18:54:21.88, `status_change`, `legacy_parity: false` |
| 18:54:22.720 | `POST /functions/v1/calendar-upsert` → card `For SMM Approval` @ 18:54:22.66 |

Payload captured first-party:
`{"client":"sidneylaruel","post":{"id":"p_native_6ac03d0b…_1","video_status":"For SMM Approval","status":"In Progress"}}`.
Repeated for `Kasper Approval` at 18:54:57/18:54:58 — both writes, both surfaces,
sub-second, no `webhook/linear-*`. **1f PASS.**

So the two surfaces differ by design: the **pill** writes canonical *and* card
synchronously; the **Production tab** writes canonical only and lets the
projection carry it ~10-15 minutes later. Both arrive. That asymmetry is the
real content of item 12 / F50, and it is a latency and audit-trail issue, not a
lost write.

---

## Part 2 — the Kasper journey

### FINDING E — Kasper's review queue cannot see ANY natively-created card (HIGH, new, client-affecting)

**Part 2 cannot be executed on the native path, because its premise fails.**

Kasper's review queue is loaded by `_kasperLoadReview` →
`_kasperFetchAllRelevantPosts` (index.html:68440), which fetches
**every allowed client's calendar from one source**:

```
const CALENDAR_GET_URL = 'https://synchrosocial.app.n8n.cloud/webhook/calendar-get';   // index.html:21544
const resp = await fetch(CALENDAR_GET_URL + '?client=' + encodeURIComponent(slug) + ...)
```

That is the **n8n, Google-Sheets-backed** webhook — the pre-flip store. Measured
against it live:

| probe | result |
|---|---|
| `calendar-get?client=sidneylaruel` | 8089 posts, **0** with a `p_native_` id |
| same response, native columns | **`video_deliverable_id` / `graphic_deliverable_id` do not exist** in the row schema at all (it still carries the Sheets `row_number` column) |
| search by my Linear identifiers (VID-13659, VID-13661, VID-13662, GRA-7296) | **0 matches** |
| `soniachopra` / `kasperhytonen` / `chelseyscaffidi` / `daniellerobin` | 79 / 6 / 63 / 370 posts, **0 native ids** in every one |

**Live end-to-end proof.** The video-only TEST card was driven to
`Kasper Approval` through the calendar pill at **18:54:57**, confirmed on both
sides (`deliverables.status = kasper_approval`, `calendar_posts.video_status =
"Kasper Approval"`). `_sxrCompKasperVisible` requires only
`video_status === 'Kasper Approval'` for a video component — no date, no link
condition. Yet:

- `_kasperState.items` after a queue load stamped **18:55:48** (i.e. *after* the
  change) held **25 items across 8 clients, and `sidneylaruel` was not among them**;
- none of the three cards created today appear anywhere in the Kasper DOM.

So every card created through **Create Post** since the flip is invisible to
Kasper. The queue is not stale — the TEST client's sheet was written as recently
as 18:27:45 today — but those writes come from an automated drill
(`p_lindeep_*`), not from the native path. The native store and the store Kasper
reads have simply diverged.

**Consequence.** The SMM → Kasper hand-off, the second of the three role
journeys this day exists to prove, is broken for every post-flip card. Parts 2's
tweak / undo / approve / finish-reviewing steps could not be exercised at all.

### Secondary observation — `calendar-get` returns an empty 200 for some clients

`alaynabellquist` and `lukecutting` returned **HTTP 200 with an empty body**
(JSON parse failure), and `jessicawinterstern` returned `posts: []` — while
Kasper's rendered queue shows cards for those same clients. A per-client fan-out
that silently accepts an empty 200 drops that client from the queue without a
word. Worth a look independently of Finding E.
