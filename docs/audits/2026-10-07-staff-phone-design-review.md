# Staff phone design follow-up

The first version solved the five interactions but made Calendar/Samples cards
look like stacks of oversized controls. That was a real design failure. This
follow-up stays in draft PR #1986 and uses the approved Expanded phone gallery
in PR #1950 as its reference, with the owner's explicit authority to make design
decisions. No merge or deployment is authorized.

## What looked wrong and what changed

| Observation | Rule and design decision | Native proof |
| --- | --- | --- |
| Platform glyphs, colour and file actions looked like primary buttons. | Metadata should be quiet and grouped by purpose. Keep 44 px touch boxes while reducing visible glyphs, backgrounds and shadows. | All 16 native Calendar/Samples width/theme/media combinations. |
| A large Archive X was easy to hit while using ordinary controls. | Destructive actions need deliberate discovery. Archive lives in More and keeps the existing confirmation. Copy-link shares that action sheet. | Trusted Archive tap, native confirmation, Cancel and visible-origin focus return. |
| Samples file links and reveal eye created needless lines. | Each row needs a distinct purpose. Files and More share a row; creative direction and reveal share a line. Calendar retains a second row for its warning and file group. | Main-card captures, no spare Samples tools row, primary-row height guard. |
| Thumbnail inset/padding made a box inside a box. | Card media should meet the card edge. Remove phone thumbnail padding and preserve native media handlers. | Loaded and fallback media, real thumbnail-error callbacks retain the same action nodes. |
| Generate and Show more mixed pill and rectangular treatments. | Actions for one field should align and share a treatment. Use the same quiet caption action shape and baseline. | Existing two-way caption checks, empty/expanded/keyboard captures. |
| The first compact More sheet inherited navigation styles. | An action sheet needs aligned icon/label rows and its own clear edges. Use a dedicated native dialog class. | Personally reviewed final open-More captures in every combination. |
| Cancelling Archive returned focus to its now-hidden button. | Chained dialogs must return focus to a visible origin. Resolve hidden action-sheet controls back to More. | A trusted interaction reproduced the failure before the fix and passed afterward. |

The [before/after gallery](2026-10-07-staff-phone-design/gallery.html) contains
matched native cards from the prior PR build and the revised build, plus the
final More sheets. These public screenshots contain fictional intercepted data.
Calendar includes the actual **No video linked** state. Native Samples has no
equivalent warning, so its missing-media state is labelled honestly.

## Look-and-fix loop

The artifact CSS/JS changed first, then was transplanted byte-identically into
the native fragments. The native thumbnail renderers need an explicit
`PORT-DELTA`: their existing `innerHTML` reset must retain the new tools container
and the original action nodes/listeners. Phone exit restores the original nodes
and labels for desktop. No backend writer or payload changed.

Four iterations rejected oversized legacy icon styling, redundant Samples rows,
incorrectly inherited sheet layout, and hidden-origin focus return. Passing a
geometry check did not approve an iteration. The final screenshots, including
the entire vertical extent of long forms, were personally inspected. The
[state-by-state notes](2026-10-07-staff-phone-design-states.md) record specific
decisions across every touched catalogue state, both widths and themes. Exact
duplicate image hashes reuse a reviewed image; visually distinct images do not.

Expansion reached three generations: quiet metadata and deliberate destruction;
purposeful rows, media edges and aligned field actions; then native refresh
preservation and visible chained focus return. The final pass yielded no further
ratified design change within the rendered evidence. Existing semantic colours,
workflow decisions and intentional contained horizontal planning/log regions
remain. No unresolved taste choice requires an owner decision.

Some fixture chart regions are blank and the reviewer Filming "empty" fixture
actually renders an invalid-response panel. Their actual screenshots were
reviewed; loaded-chart quality and a true empty Filming response are explicitly
unproven. This is not live populated-data or physical-phone proof.

## Verification and integration

The final native card suite covers 16 card states and 32 screenshots. Existing
rule, full catalogue and admin runs retain all assertions: 160 rule states,
an initial 232 catalogue renders per width, and final merged admin runs of
126 renders/2,474 checks per width. Failed later catalogue boot attempts are
retained below rather than counted as clean runs. These use fictional intercepted transports. The original
five interaction fixes and overlap/scroll-lock negative controls remain.

The workflow header now describes its separate lanes correctly.
`scripts/staff-phone-changed.js` gates the staff-phone-rules matrix on relevant
UI, artifact, harness or gate paths. Synchronize events compare their previous
head, so a docs-only update skips the matrix; opening a PR compares its base.
Source assertions and a historical docs-only diff verify both outcomes.

`origin/main` was merged, without rebase, into the existing branch in merge
commit `47ecd481`, then merged newly advanced main (`c8375c92`) in `5948ca2e` and the first-paint repair (`6a692504`) in `787c693d`, then main `8f66c36b` in merge `6a9bd7b6`. Repair 361 on main and 362 in open PR reservations were
occupied. A later reservation check found 363 occupied in other open PRs, so
this work initially reserved 364. A final scan of every open PR found a concurrent description reservation for 364 and an added ledger header for 365; this work now uses **366**, the next free number. The inherited main changes are preserved.

Before the second main merge, the complete local unit suite remains red: 17 of 685 suites fail. Every failing
suite also fails in a fresh detached main worktree, where 19 of 684 fail. Main's
two additional failures are not hidden; different checkout/environment effects
make this comparison evidence, not a claim of identical test environments.

Desktop proof and exact results are recorded in the
[check receipts](2026-10-07-staff-phone-design-checks.md). Failed and superseded
runs remain visible. A pixel mismatch is never accepted because styles match.
The repository's desktop parity gate is unchanged, and no tolerance, masking or
control-mode pass is substituted for its exact byte/style assertion.

## Native-flow follow-through

The expanded Calendar flow exposed three further defects: inline video/selection/poster layers incorrectly acquired modal scroll ownership; true Calendar/reviewer lightboxes were omitted; and touch previews retained a hover tooltip over their title. Artifact-first classification and phone CSS fixes preserve ordinary scrolling and lock actual lightboxes. A shared normal-screen assertion rejects phantom locks. The Create post stepper also had a 2 px painted collision because 44 px targets occupied 42 px grid columns; phone columns now reserve their full target size.

The expanded native Calendar runner now applies the shared overlap and touch/wheel scroll checks at every measured state. It passes all 9,450 existing checks across 360/390/430, light/dark. The detector clips DOM rectangles to their actual scrollport before comparing painted regions; adversarial controls verify both clipped-away non-collisions and real visible collisions. The original unlocked-background control first scrolls the viewport, so its geometry fixture explicitly resets the viewport before testing.

After the latest main merge, native card checks pass all 16 combinations, Calendar passes 9,450 checks, both admin widths pass 126 states/2,474 checks each, and the rule suite passes 160 states. The focused main-affected catalogue passes 80 renders. The older full catalogue repeat retained one fixture-boot timeout per width (different Templates client states); an exact 8-render replay of both states at both widths/themes passes. This is retained failure plus replay evidence, not a rewritten clean run.

Linux CI exposed a measurement race between closing the navigation sheet and applying the opening class to the status picker. The shared checker now waits two native animation frames before classifying ownership; the normal-screen assertion remains strict. The final local Calendar run passes with this sequencing. The hosted rerun is recorded separately.

Nine generated bundles introduced by intermediate, unreleased iterations of this PR were removed after regeneration. Current generated references and all bundles inherited from main are preserved. Before removal, the public identity gate hit its diff-buffer limit; that failure remains in the receipts. After the cleanup, the unchanged identity gate passes with zero added identities.

The hosted suite remains a distinct gate. Superseded failing/cancelled runs are retained; the final source-hash rerun must not be described as passing while queued. Broad unit and entry gates are reported with their actual conclusions. No physical-phone, deployment or full loaded-chart claim is made from these intercepted screenshots.

## Strict desktop result

The unchanged repository gate `qa/client-phone/desktop-parity.js` provides **72/72 exact matches** against merged main `8f66c36b503ebb3a881cf20f27dca48607e750ab`. Runs at 1024/1280/1440 each passed 18/18. The initial 1920 run passed 17/18 and failed the reviewer PNG despite identical styles; its failure is retained. A focused rerun using the gate's existing `PARITY_ONLY=staff-navKasper` option passed 1/1 with exact PNG bytes and computed styles. This is 71 initial exact comparisons plus one passing replay, not a rewritten four-width clean run. Every PNG buffer and every element computed-style hash must match. `PARITY_WORKERS=1` and `PARITY_W` use the gate's existing options. The private relay restricts live client token reads to the designated TEST and GET; staff fixtures are offline. No control mode, tolerance, mask, renderer override or edited gate is used for this result. Each captured image was personally inspected; identical hashes reuse earlier review. Earlier 69/72 and 71/72 runs remain failures in the receipts, rather than being changed into passes.

A final adversarial detector case placed overlapping controls in a viewport-fixed popup outside an overflow-clipped ancestor. The earlier clipping calculation incorrectly clipped that fixed popup away. The case failed before the correction and remains mandatory afterward. The detector now respects fixed-position containing blocks, without weakening overlap or target assertions. The final Calendar replay still passes all 9,450 checks.

The hosted 09f9a14e unit lane failed exactly one of 686 suites: the comment-stripping policy found the raw block-comment regex in this PR's new source guard. That is an attributed regression, not an inherited failure. The guard now uses `test/helpers/strip-comments.js`. A private Windows adapter gives the existing honesty test its intended tracked-file census with `execFileSync` arguments; the unchanged prior source fails, and the repaired source passes. The first stock Windows check did not exercise that census because shell quoting returned no files, and is not used as clean proof.

## Final merged-main review

Main `8f66c36b` also introduced the concurrent Clients profile design, preserved in merge `6a9bd7b6`. I reviewed the final 252 admin captures and 32 card/action captures. The search and All clients controls share a line, profile contact/actions form their own group, and Cancel/Save remain together in edit mode. The inherited light-theme metadata is deliberately subdued; it does not require a new card redesign. The final Calendar and Samples utilities, warnings, captions and More sheets remain coherent at both widths/themes. No further design change survived this pass.

The final native suites pass 16 card combinations, 160 rule states, 9,450 expanded Calendar checks, and 126 admin states/2,474 checks at each width. Hosted run `37680056732` on UI head `c6734775` passes all 686 classified unit suites and split-preview; 96 required profiles are explicitly NOT_RUN in the unit lane. Hosted entry and both full phone jobs now pass. Each width passes 232 catalogue renders with zero problems and 126 reviewer/admin states with 2,478 checks on Linux (the local Windows run recorded 2,474).

Process improvement proposed for a future skill revision: require explicit visual critique and native card composition review alongside geometry assertions. Passing geometry must never approve a visual iteration. The skill itself was not modified.

## Final hosted result

Calendar workflow [37680056732](https://github.com/sidney-afk/client-analytics/actions/runs/37680056732) is **SUCCESS** on UI head `c6734775`: all nine jobs pass. Each width passes 80 rule states, eight card combinations, 232 full catalogue renders/zero problems, and 126 admin states/2,478 checks. Unit passes 686 classified suites with 96 required profiles NOT_RUN; split-preview and entry gates pass. Superseded failures remain in the receipts. Docs-only head `56356d6f` runs the file classifier and **skips staff-phone-rules**, verified in GitHub run `37682406692`; it does not change UI bytes.
