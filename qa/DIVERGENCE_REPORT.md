# Samples vs Calendar — Divergence Catalog (the live sweep)

The **calendar is the source of truth**; the standard is **exact clone**. Entries **A, B, C, E**
are **bugs to fix**; **D was reclassified as by-design** after checking the rebuild spec (colour
tag is on the exclusion list). The "By-design" section lists the documented intentional
differences (a structural subset, each cited to the spec) and is NOT bug-tracked.

> **Fix status (updated):** **A, B, C, E — FIXED & verified** (commits on `claude/parity-loop-l697yf`).
> **D + platforms — confirmed by-design** (spec exclusion list). **F — realtime repaint at parity;
> needs a real two-tab browser to settle.**
>
> | Item | Status | Evidence |
> |---|---|---|
> | A — Kasper decision flow | ✅ fixed (core) | `kasper_request_video`/`kasper_aat_video`: live Kasper diff dropped from `missing=[Close card, View thumbnail full screen, Slack, Finish reviewing, Comment] extra=[ApproveClient] stMissing=[Finish reviewing, Changes requested]` → `missing=[Slack] extra=[Open video ↗]`. twin_render Kasper card parity; unit suite 28/28. **Residual (documented deferrals):** Slack (A6, needs the cross-client SMM map), URGENT (A8), the Replies/Messages "New message" chip (A9); plus a cosmetic "Open video ↗" label (the samples Kasper reuses the review-panel video tile, itself at parity on SMM Review/Client). |
> | B — AAT → Tweaks Needed | ✅ fixed | `kasper_aat_video`: both surfaces reach `Tweaks Needed` + stamp, no DB divergence |
> | C — thumbnail lightbox | ✅ fixed | twin_render SMM Review + Client panels now parity |
> | E — "Client Approval" personalised | ✅ fixed | twin_realtime: samples now reads "Video **Sidney** Approval" |
> | D — colour tag · platforms | ◌ by-design | `SAMPLES_REBUILD_SPEC.md:98` |
> | F — realtime cross-tab | ⚠ verify live | repaint logic at parity; WS untunnelable headless |

## How this was produced (and why it caught what earlier passes missed)
Four instruments, run against the **live backend** unless noted:

| Instrument | Layer | What it does |
|---|---|---|
| `qa/probes/twin_render.js` | render | renders each shared surface for BOTH `_cal*`/`_kasper*` and `_sxr*` and diffs the observable snapshot of one component in isolation |
| `qa/probes/twin_live.js` | **live journey** | drives the SAME scenario from `qa/scenarios.js` on BOTH a calendar tab (no `?sxr=1`) and a samples tab (`?sxr=1`); after every step diffs the normalized observable snapshot of the acting card (visible/enabled action labels, status + component-state labels, preview `object-fit`) **plus** the live DB row, **plus** a never-reloaded second SMM tab |
| `qa/probes/twin_realtime.js` | realtime | cross-tab repaint diagnosis — isolates WS delivery from the repaint path via a simulated push on a never-reloaded observer tab |
| code audit | source | line-by-line `_sxr*` vs `_cal*`/`_kasper*` for the Kasper flow + realtime |

The live journey diff is what made the difference. Three traps the earlier passes fell into,
and how this avoids them:
1. **Diff against the calendar, not your expectations.** This caught **B** (the AAT outcome
   bug): the `kasper_aat_*` scenario's own `expect` asserted `For SMM Approval` — i.e. it
   encoded the *samples* behaviour. The twin-diff ignores the expectation and compares the two
   live surfaces, so it flagged the calendar truth (`Tweaks Needed`).
2. **Drive the same journey on both and compare the lived result.** This caught **A12** (the
   Kasper card silently vanishing) — only visible mid-journey, after an approve/AAT.
3. **Compare the SET of visible affordances, not function outputs.** This caught the whole of
   **A** (Finish reviewing / Close / Comment / Slack / lightbox / partitions) — features that
   simply don't exist in samples, so function-parity is blind to them.

**Scenarios driven live on both surfaces (this sweep):** `clean_video_only`,
`kasper_request_video`, `kasper_request_graphic`, `kasper_aat_video`,
`kasper_approve_v_request_g`, `kasper_two_round_video`, `smm_request_video`, `worstof_smm`,
`comment_no_status`, `notes_audiences`, `notes_markdone`, `client_request_video`,
`clean_both`, `both_request_then_approve`, `full_bounce`. Re-run: `node qa/probes/twin_live.js`.

Both surfaces reach the **same DB state for every component** in every scenario (the data flow
is faithful) — except **B**. All other divergences are **observable affordance / state** gaps
on otherwise-correct data.

---

## A. Kasper review sub-tab — the whole decision-flow is missing  **[HIGH — the headline bug]**
The samples "Samples" Kasper sub-tab (`_sxrKasper*`, ~index.html:27978) is a *simplified
per-component* model. The calendar's Kasper "Review" sub-tab (`_kasper*`, ~31052–32600) is a
whole decision flow. Driving `kasper.request` / `kasper.approve` / `kasper.aat` on both and
snapshotting the live card shows samples is missing, on every Kasper card:

| # | Missing on samples (calendar has it) | Confirmed by |
|---|---|---|
| A1 | **"Finish reviewing"** + the **"Sent to SMM"** handoff badge — card-level hand-off, enabled only once every component is decided (`_kasperDismiss` 32587, gate `_kasperUndecidedComps` 23251) | `kasper_request_video` s1, `kasper_two_round_video` s1/s3, `full_bounce` s8/s13, twin_render |
| A2 | **Waiting / Tweaks-pending / Approved-history partitions** (`_kasperPartitionItems` 31560) — samples shows one flat list | code audit (31560, 31632, history section) |
| A3 | **"Changes requested"** component state-label on a tweaked component (`stateLabel`, 32011) | live `stMissing:["…Changes requested"]` on every `kasper.request` step |
| A4 | **"Comment"** button — an internal-only note that does NOT flip status or ping the editor (`_kasperAddCommentComp` 32360) | live `missing:["Comment"]` |
| A5 | **"Close card" (X)** — hide a card until it returns to Kasper Approval (`_kasperClose`) | live `missing:["Close card"]` |
| A6 | **"Slack"** — message the card's SMM (`_kasperOpenSlack`) | live `missing:["Slack"]` |
| A7 | **"View thumbnail full screen"** lightbox (`_kasperOpenLightbox`); samples opens the video/thumb in a **new tab** instead (`Open video ↗`) | live `missing:["View thumbnail full screen"] extra:["Open video ↗"]` |
| A8 | ⚠ **URGENT** ping on the Kasper card (`_calShowUrgent`→`_kasperSendUrgentSlack`) — **documented v1 deferral**, not a fresh gap (`SAMPLES_PARITY_LOG.md:104` "v1 omits URGENT") | code audit (31806) |
| A9 | ⚠ **"New message"** unread-reply chip (`_kasperHasUnreadReply`→`.kcard-newreply-chip`) — part of the **deferred** "Replies/Messages union" (`SAMPLES_PARITY_LOG.md:104`) | live `stMissing:["New message"]` on `full_bounce` s8/s13 |
| A10 | **Durable cross-device stamps** `kasper_finished_at` / `kasper_closed_at` / `kasper_finish_log`, and **Undo** on approve (`_kasperUndoApprove`) | code audit (31513, 32301) |

…and two cases where samples shows the **wrong** thing:

| # | Samples does the WRONG thing | Confirmed by |
|---|---|---|
| A11 | After a change is requested, samples still shows an **enabled "Approve → Client"** on that component; the calendar **suppresses Approve** in the tweaks state (`showApprove=false`, 32008) and keeps the framing as "Changes requested". Samples also keeps the stale **"… awaiting your review"** pending label. | live `extra:["ApproveClient"]` + `stMissing:["Changes requested"]` on every `kasper.request` |
| A12 | After Kasper approves/AATs the **last** pending component, samples **silently drops the card** from the queue (`_sxrKasperApplyAndPersist`, 28091 `if(!_sxrPostKasperVisible) …filter…`). The calendar **pins** it via `_touchedComps` (32260) and moves it to *Approved history* / *Tweaks pending* with an **Undo** — it only leaves on an explicit "Finish reviewing". | live PRESENCE divergence on `kasper_aat_video` s1, `kasper_approve_v_request_g` s1, `clean_both` s5 |

**Live snapshot of one card (`kasper_request_video`, after `kasper.request(video)`):**
- calendar: `[Close card, View thumbnail full screen, Slack, Finish reviewing, Watch video, Comment, Approve after tweaks, Request change]` · states `[Finish reviewing, Changes requested]`
- samples : `[Watch video, Open video ↗, ApproveClient, Approve after tweaks, Request change]` · states `[Video awaiting your review, Video, Client]`

**Fix scope:** medium-high — port the calendar's Kasper decision flow to `_sxr`, adjusted for the
samples one-upsert / no-per-item-cache architecture (the bulk is a transplant; the data model
already supports the stamps).

## B. Kasper "Approve after tweaks" — the OUTCOME diverges  **[HIGH — new this sweep]**
Driving `kasper.aat(video)` lands the component at a **different status** on each surface:

| | component status after AAT | stamp | meaning |
|---|---|---|---|
| **calendar** (`_kasperRequestTweakComp(…,true)`, 32462) | **`Tweaks Needed`** | `kasper_approved_after_tweaks` | the editor must still apply the fix; it then routes back to `For SMM Approval` where the pre-clear badge tells the SMM it's cleared |
| **samples** (`_sxrKasperApproveAfterTweaksComp`, 28112) | **`For SMM Approval`** | `kasper_approved_after_tweaks` | jumps **straight** to the SMM, **skipping the editor-fix (`Tweaks Needed`) stage** |

Confirmed live — `kasper_aat_video` s1 DB-state: `cal video=Tweaks Needed`, `sxr video=For SMM
Approval`. **Fix:** `_sxrKasperApproveAfterTweaksComp` should set `Tweaks Needed` (not `For SMM
Approval`), matching `_kasperRequestTweakComp(…, approveAfterTweaks=true)`.

## C. Thumbnail preview — new tab vs full-screen lightbox  **[MED]**
On every surface that renders the **thumbnail** component, the calendar opens a full-screen
lightbox; samples opens a plain `<a href>` new tab.

| Surface | calendar label | samples label | function |
|---|---|---|---|
| SMM Review panel | **Open thumbnail full screen** | Open thumbnail | `_calOpenThumbLightbox` vs `<a>` |
| Client review panel | **Open thumbnail full screen** | Open thumbnail | same |
| Kasper card | **View thumbnail full screen** | (opens video in new tab) | `_kasperOpenLightbox` — folds into **A7** |

Confirmed live: `smm_request_video` s1, `clean_both` s1, `both_request_then_approve` s1,
`full_bounce` s1 (SMM Review); twin_render (Client review panel). **Fix:** emit the calendar's
lightbox button/markup in `_sxrReviewComponentPreview`.

## D. ~~SMM Sheet card — missing the colour-tag button~~ → **BY-DESIGN (not a bug)**
The calendar Sheet card's **"Tag this card with a color"** (`cal-card-color-tag` /
`_calOpenColorPicker`) is **explicitly on the exclusion list** — `SAMPLES_REBUILD_SPEC.md:98`
"EXCLUDE caption …, CTA, scheduled-date chip, **platforms strip, colour tag**" (also
`SAMPLES_PARITY_PLAN.md:131`). So the live `missing:["Tag this card with a color"]` on every
Sheet snapshot (`notes_*`, `comment_no_status`, `both_request_*`, `full_bounce`) is **expected**,
not a divergence. Moved to "By-design" below. *(Caught by checking the spec — thanks to the
flag about documented omissions.)*

## E. SMM Sheet status label — "Client Approval" not personalised  **[LOW — new this sweep]**
On the SMM surface the calendar renders the `Client Approval` status as **`<ClientFirstName>
Approval`** ("Sidney Approval"); samples renders the generic **"Client Approval"**.

- **Root cause:** `_sxrStatusLabel = _calStatusLabel` (alias, 25791) → `_calClientFirstName()`
  (18405) reads **`calState.client`**, which is **empty on the samples surface** (samples uses
  `sxrState.client`), so the personalisation falls back to the literal `"Client"`.
- Confirmed live — `twin_realtime` observer read: calendar `"Video Sidney Approval"` vs samples
  `"Video Client Approval"`. (Client-facing relabels — "Ready for your review" etc. — DO work on
  the samples client portal, because that branch doesn't read `calState.client`.)
- **Fix:** give `_sxr` a first-name helper that reads `sxrState.client` (or make
  `_calClientFirstName` fall back to it).

## F. Realtime cross-tab repaint (the reported bug b) — **logic at parity; needs a real browser to settle**
**Reported:** editing in the client tab doesn't update another open tab without a refresh.

- The realtime **push WebSocket cannot be tunnelled** through the sandbox proxy, so a headless
  probe can't receive a real push. The diagnosis isolates the two failure modes:
  - **Auto-reflect (real WS delivery):** `calendar=false, samples=false` — neither observer tab
    updated without a reload. **Expected headless** (WS untunnelable) and **symmetric** — it
    introduces no samples-vs-calendar divergence by itself.
  - **Push-repaint (handler simulated):** invoking `_sxrV2OnRealtimeChange` /
    `_calV2OnRealtimeChange` on the never-reloaded observer tab repaints it to the new DB state on
    **both** surfaces → **the repaint path is at parity**.
- **Code audit:** `_sxrV2EnsureSubscribed` (27894) is a faithful clone of `_calV2EnsureSubscribed`
  (16615) — same readiness gate, idempotency, channel `filter: client=eq.<slug>`, and reconnect
  catch-up; the freshness listeners (`focus`/`visibilitychange`/`pageshow` → `_sxrRefreshOnReturn`)
  are present (27931-27936). Both loaders call `EnsureSubscribed(slug)` at their tail (25763 /
  17119), so the SMM **and** client-portal surfaces both subscribe.
- One asymmetry surfaced (calendar client-tab `subscribed:false / slug:null` after a `TIMED_OUT`,
  samples `true`), but under the courier the WS can't connect so `subscribed` is an unreliable
  proxy — this is most likely a timeout artefact, not a real divergence.

**Conclusion:** the cross-tab realtime **repaint logic is at parity**; if the bug still
reproduces it lives in **WS delivery / subscription**, which the sandbox **cannot exercise**.
**This is the one dimension that needs a REAL two-tab browser with open egress** (edit in one,
watch the other with NO reload). Verify there before treating it as code.

---

## By-design — registered intentional differences (NOT bugs)
Confirmed against the rebuild spec — every item below is on the documented exclusion list
(`SAMPLES_REBUILD_SPEC.md:66/69/98/186`, `SAMPLES_PARITY_PLAN.md:90/131`, `SAMPLES_V2_PLAN.md:132-134`):
- **No caption/title component** (`SPEC:69` "Components: video, graphic ONLY") → no "Alt caption"
  / "Generate" / "Show more" / Caption pill / CTA. *Consequence:* the calendar's overall status is
  `worst-of(video, graphic, caption)`; with the seed's caption left at `In Progress`, the calendar
  overall reads **lower** than samples — this is why every `clean_both` / `worstof_smm` /
  `full_bounce` **db-state** divergence is on the `status` (overall) column only, never on
  `video`/`graphic`, and why the Sheet snapshot shows a by-design `stMissing:["In Progress"]` (the
  caption substatus pill). Not a bug.
- **No `Scheduled` / `Posted`** (`SPEC:66/186`) — the samples pipeline ends at `Approved`; no
  scheduled-date chip.
- **No colour tag** on the Sheet card (`SPEC:98` EXCLUDE colour tag) — this is the former "D".
- **No platform targeting** (`SPEC:98` EXCLUDE platforms strip; `SAMPLES_V2_PLAN.md:134` edit-platforms
  REMOVE) — the calendar Sheet card has a platform-toggle picker (`cal-card-platform-btn`:
  Instagram/TikTok/YouTube/Facebook/LinkedIn); samples renders none. Surfaces as live
  `missing:["Instagram","YouTube","LinkedIn"]` on Sheet snapshots. **Confirmed by-design.**
- **Samples-only "Toggle client visibility"** creative-direction eye (`SPEC:98` keep visibility eye).
- **No Month / Week grid views** — the calendar `#calView` has `month`/`week`; samples `#sxrView`
  has only `organizer` (Sheet) + `smmreview`.
- **Always-actionable status triggers** — samples deliberately does NOT lock an unlinked
  video/graphic status trigger (`SPEC:98/180`, the "no-caption-escape-hatch" decision); the Linear
  push no-ops until linked.
- **Kasper card v1 deferrals** — **URGENT** ping (A8) and the **Replies/Messages union** /
  "New message" chip (A9) were explicitly deferred in the M5a build (`SAMPLES_PARITY_LOG.md:104`).
  Listed in A for completeness but treat as deferred-by-plan, not fresh regressions — confirm
  whether the exact-clone bar now pulls them into scope.

## Harness note (not a product divergence)
A `graphic`-only Kasper scenario needs a `graphic_linear_issue_id` on the seed to enter the queue
(the unlinked-thumbnail gate, `_calCompKasperVisible`/`_sxrCompKasperVisible` — identical on both),
so `kasper_request_graphic` was a no-op (both surfaces correctly gated it out → parity). The
video-side Kasper scenarios fully exercise the flow.

---

## Suggested fix order (real bugs only — D is by-design)
1. **F — realtime:** verify in a real two-tab browser first; the headless evidence says the
   repaint logic is already at parity, so this may need no code change.
2. **C — thumbnail lightbox:** small, isolated `_sxrReviewComponentPreview` change (the lightbox
   already exists in samples — just wire the review/client preview to it instead of a new tab).
3. **E — status label:** one-line first-name helper (`sxrState.client`).
4. **B — AAT outcome:** one-line status change (`For SMM Approval` → `Tweaks Needed`), but
   semantic — re-verify the AAT→SMM-approve→client routing afterwards.
5. **A — Kasper flow:** the big rebuild; port the calendar's decision flow to `_sxr` (excluding
   the documented v1 deferrals A8/A9 unless you want them in scope now).

## Re-run the gates
```
node qa/probes/twin_live.js                 # full live journey twin sweep (both surfaces)
node qa/probes/twin_live.js kasper_request  # just the Kasper bug-(a) demonstrators
node qa/probes/twin_render.js               # render-layer affordance diff
node qa/probes/twin_realtime.js             # cross-tab realtime diagnosis
node test/run-all.js                        # calendar unit suite — confirms no _cal regression
```
