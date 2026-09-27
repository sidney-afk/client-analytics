# Uncalled browser-function candidates (2026-09-26)

Source baseline: `3f5bd46e6086911ae2a7bb0d32507f03d5a44da8` (`origin/main`). This is a source-only audit; it does not establish live usage or authorize a deployment. It complements the [Linear-era inventory](2026-09-21-base-audit/A2-dead-code-inventory.md), whose reader and recovery boundaries still apply.

## Method and result

I parsed the classic browser script assembled from `src/index/manifest.txt` with the repository's `servedBytes` rule. Of 3,366 top-level function declarations, 55 names appeared exactly once in the committed `index.html`: their declaration. I then searched the 2,353 tracked files for those exact identifiers, excluding generated `index.html`. Ten had no mention in another tracked file. The table below is the small first review set, not a deletion list for every lexical match. The other 45 have test, documentation, or policy mentions that need a separate contract review before any removal; a mention does not establish a runtime call.

| Source declaration | Why it is a candidate | Disposition |
|---|---|---|
| `050-market-briefs.js.part`: `_tplFieldTextarea`, `_tplFieldColor`, `_tplRenderColorSetsEdit` | Render helpers with no assembled-page reference after their declarations and no other tracked-file mention. | Review as one Templates removal batch. |
| `060-templates-filming.js.part`: `_tplBrainSpecChips`, `_fpRerenderSurfaces` | Display/rerender helpers with no assembled-page reference after their declarations and no other tracked-file mention. | Review as a separate Templates/Filming batch. |
| `080-workload-render.js.part`: `renderOverdueStrip`, `renderInProgressStrip`, `renderTweaksNeededStrip` | Three thin wrappers around the still-used `renderEditorRollupStrip`, with no assembled-page reference after their declarations and no other tracked-file mention. | Remove wrappers only; retain the shared renderer and its active callers. |
| `300-tiktok-upload.js.part`: `_tkFormatQueueWhen` | Queue-time formatter with no assembled-page reference after its declaration and no other tracked-file mention. | Review separately with TikTok rendering checks. |
| `320-kasper-dashboard-replies.js.part`: `_filmsDatePretty` | Date formatter with no assembled-page reference after its declaration and no other tracked-file mention. | Report only: fragment 320 is protected by the backlog objective. |

This lexical test cannot prove that external scripts never call a global by constructing its name at runtime. Removal needs a fresh reference check, local behavior tests for the owning feature, and the repository's index build/check. `npm run check:index` requires the fragments to equal committed `index.html` byte for byte, and the index build writes `index.html` and `src/index/INDEX.md`. Both generated files are protected in this backlog, so even a true-dead-code deletion would fail the required index check. Source removal is blocked by that constraint; no source was removed in this report.
