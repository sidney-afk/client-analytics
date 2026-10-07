# Staff phone feedback expansion

Status: implementation and verification in progress; not deployed. One branch and one draft PR; owner merges. Raw screenshots and read-only TEST data remain outside the repository.

Binding: the existing Expanded staff phone experience at 390 and 430 pixels, touch, both themes. Artifact-first changes live in `docs/syncview-design/staff-phone-rules.{html,css,js}` and are transplanted verbatim into the source fragments. Existing native actions and transports remain the owners of persistence. Live inspection uses only the designated TEST client; write journeys use intercepted fictional transports.

| Observation | Reproduction | Rule and repair | Machine guard |
| --- | --- | --- | --- |
| Page scrolls behind Tabs | Confirmed: background moved 600 pixels | G1: every open overlay locks background scrolling, including nested scrolling and animation entry | Wheel and trusted touch scroll checks, with an intentionally unlocked failing control |
| Calendar card tools overlap | Confirmed on live TEST cards | G1: independent content and controls never overlap; tools occupy a wrapping row in the native thumbnail subtree | Pairwise control and media-warning geometry detector with injected collision control |
| Generate caption placement | Confirmed | G1: actions sit beside their content, aligned with sibling actions | Native action row geometry and source/artifact coupling |
| Caption toggle fails | Long caption toggled both ways; the reported total failure was not reproduced. Empty captions incorrectly displayed a hidden toggle | G1: toggles visibly change both ways; hidden controls stay hidden and collapse has a visible label | Height, label, hidden-state and expanded-state assertions |
| Set all popup closes on inside tap | Not reproduced for header taps at either width. Native sheet padding taps did dismiss | G1: inside taps preserve overlays; native outside, Escape, Close and completed selections retain their meaning | Inside-padding, header, Escape and focus-return assertions |

G2 sibling rules: targets at least 44 by 44 pixels; fields at least 16 pixels; no sideways page overflow; safe top/bottom insets; focused fields inside the visual viewport; focus returns to the invoker. G3 discoveries: fixed TikTok and profile save bars covering fields, the Samples creative eye overlapping its field, credential password eye overlapping its field, sticky sheet headings covering scrolled controls, decorative ghost elements misclassified as overlays, and opening opacity transitions delaying locks. Repairs remain within the phone scope.

Inventory lanes: `qa/staff-phone-rules-browser.js` checks every top-level staff screen and its Tabs/More surfaces; `qa/staff-phone-final-pass.js --all-states` expands the existing Filming, Upload, Analytics, Calendar, Samples, Workload and Production catalogues; `kasper-admin-expanded-browser.js` covers review, messages, clients, credentials, hiring, sales, onboarding and PTO states. Every rendered overlay in these lanes receives the overlap detector and background scroll assertion. These are finite known catalogues, not a claim that arbitrary future states have already been tested.

Verification receipts and dry sweep counts will be appended after the final runs. Physical phone keyboard and operating-system bars, authenticated live writes, deployment and hosted CI remain unverified. Viewport keyboard simulation and safe-area CSS are local browser evidence.

Read-scope deviation: the existing Production polish gate and its unchanged-base behavior comparison used their default aggregate live read transport, exceeding this request's TEST-only read scope. No writes occurred. This was discovered after those runs; no further aggregate reads were made. Their private screenshots and data are excluded from public artifacts and from TEST-only proof. The phone rule and catalogue lanes use intercepted fictional transports; desktop client parity uses read-only designated TEST data.

Expanded inventory repairs, each at both widths and themes:

| Native element class | Rule | Outcome and assertion |
| --- | --- | --- |
| Every staff screen's Tabs and More | R1, R5, R9 | Fixed locks; trusted touch/wheel background snapshots, inside padding, Escape and focus return |
| Calendar and Samples card platform chips | R2, R6 | Fixed wrapping tool row; rectangle intersections and target sizes |
| Card colour, copy, archive and folder controls | R2, R6 | Fixed adjacent tool row; geometry plus native folder regression lane |
| Card media warning | R2 | Fixed full-width row; text-warning/control intersections |
| Caption Generate, cancel and expand controls | R3, R4 | Fixed action row and collapse label; action geometry, height in both directions, aria state |
| Empty-caption toggle | R4, R11 | Fixed native hidden-state precedence; hidden property and computed display assertion |
| Set all and colour popups | R1, R5, R9 | Fixed background lock and Escape/focus paths; header/padding stays open |
| Nested client picker and sheet | R1, R10 | Fixed topmost scroll ownership; parent remains locked and child can scroll |
| Production search, status, assignee and date pickers | R1, R6 | Fixed legacy surface discovery and search target size; all focused states pass |
| Decorative search overlay | R10 | Refuted as a modal; noninteractive decoration excluded from modal detection |
| TikTok submit bar | R2, R8, R11 | Fixed field-covering positioning; upload state geometry |
| Profile Save/Cancel bar | R2, R11 | Fixed field-covering sticky positioning; admin edit geometry |
| Samples creative eye | R2, R6 | Fixed control below field; rule matrix geometry |
| Credential password eye | R2, R6 | Fixed adjacent independent control; admin add/platform geometry |
| Sheet heading and scrolling content | R2, R10, R11 | Fixed flex layout with independently scrolling body; menu/admin state checks |
| Focused caption field | R7, R8 | Fixed viewport response and bounded textarea; reduced viewport rectangle assertion |

Gate verdicts: requested rules R1–R5 and requested sibling rules R6–R9 are owner-ratified by this task; R10–R11 preserve those same requirements in nested/hidden states. None changes an existing permission or write boundary. Save, upload, caption generation and review mutations retain their native handlers and are phase-bounded at intercepted fictional transport in this audit. Native long-caption toggling and Set all header dismissal were unreproduced observations, not invented findings. Arbitrary future screens and physical device behavior remain unproven.

Expansion termination: generations 1–3 produced the inventory above. Final catalogue, admin and rule sweeps determine whether any further ratified sibling remains; a zero-problem result is a dry sweep of these known states, not a universal claim about future data.

Owner decision list: retain the single-PR override from this request; review the phone action-row layout in the artifact; retain failed required gates visibly rather than interpreting timeout as success. Proposed skill amendments: make full known-state catalogue selection explicit; require detector failing controls before reporting a dry expansion; preflight every required gate's backend read scope so aggregate live harnesses cannot silently exceed a TEST-only task. The skill itself was not edited.

Rollback: revert this PR and rebuild the index fragments. No database, Edge Function, runtime flag, automation or provider-wiring change.
