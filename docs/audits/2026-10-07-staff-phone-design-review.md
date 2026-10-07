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
232 catalogue renders per width, and 126 admin renders/2,456 checks per width,
with no failures. These use fictional intercepted transports. The original
five interaction fixes and overlap/scroll-lock negative controls remain.

The workflow header now describes its separate lanes correctly.
`scripts/staff-phone-changed.js` gates the staff-phone-rules matrix on relevant
UI, artifact, harness or gate paths. Synchronize events compare their previous
head, so a docs-only update skips the matrix; opening a PR compares its base.
Source assertions and a historical docs-only diff verify both outcomes.

`origin/main` was merged, without rebase, into the existing branch in merge
commit `47ecd481`, then merged newly advanced main (`c8375c92`) in `5948ca2e`. Repair 361 on main and 362 in open PR reservations were
occupied. A later reservation check found 363 occupied in other open PRs, so
this work uses **364**. The inherited main changes are preserved.

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
