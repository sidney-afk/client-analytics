# Staff phone feedback expansion

Status: built, review HOLD, not deployed. One branch (`codex/pocket-staff-phone`) and one draft [PR #1986](https://github.com/sidney-afk/client-analytics/pull/1986); owner merges. Raw screenshots and read-only TEST data remain outside the repository.

Binding: the existing Expanded staff phone experience at 390 and 430 pixels, touch, both themes. Artifact-first changes live in `docs/syncview-design/staff-phone-rules.{html,css,js}` and are transplanted verbatim into the source fragments. Existing native actions and transports remain the owners of persistence. The intended live inspection boundary is the designated TEST client; write journeys use intercepted fictional transports. The read-scope deviation below is an exception, not TEST-only proof.

Raw feedback, preserved before deriving the rules:

1. “With the tab menu (Today, Calendar, Samples...) open, scrolling scrolls the page behind it. Rule: nothing behind an open menu, sheet or dialog ever scrolls.”
2. “Calendar Sheet view card: the platform icons, the colour tag, the copy-link button, the "No video linked" text and the Frame.io folder icon at the bottom right overlap each other. Rule: nothing on a card overlaps anything else, at any phone width.”
3. “The Generate caption button is placed awkwardly. Rule: actions sit next to the thing they act on, aligned with the other actions.”
4. “Expand/collapse caption does not work. Rule: every toggle visibly toggles, both ways.”
5. “"Set all to": tapping inside the popup closes it. Rule: a popup never closes from a tap inside it, only outside, on Escape or on a close control.”

| Observation | Reproduction | Rule and repair | Machine guard |
| --- | --- | --- | --- |
| Page scrolls behind Tabs | Confirmed: background moved 600 pixels | G1: every open overlay locks background scrolling, including nested scrolling and animation entry | Wheel and trusted touch scroll checks, with an intentionally unlocked failing control |
| Calendar card tools overlap | Confirmed on live TEST cards | G1: independent content and controls never overlap; tools occupy a wrapping row in the native thumbnail subtree | Pairwise control and media-warning geometry detector with injected collision control |
| Generate caption placement | Confirmed | G1: actions sit beside their content, aligned with sibling actions | Native action row geometry and source/artifact coupling |
| Caption toggle fails | Long caption toggled both ways; the reported total failure was not reproduced. Empty captions incorrectly displayed a hidden toggle | G1: toggles visibly change both ways; hidden controls stay hidden and collapse has a visible label | Height, label, hidden-state and expanded-state assertions |
| Set all popup closes on inside tap | Not reproduced for header taps at either width. Native sheet padding taps did dismiss | G1: inside taps preserve overlays; native outside, Escape, Close and completed selections retain their meaning | Inside-padding, header, Escape and focus-return assertions |

G2 sibling rules: targets at least 44 by 44 pixels; fields at least 16 pixels; no sideways page overflow; safe top/bottom insets; focused fields inside the visual viewport; focus returns to the invoker. G3 discoveries: fixed TikTok and profile save bars covering fields, the Samples creative eye overlapping its field, credential password eye overlapping its field, sticky sheet headings covering scrolled controls, decorative ghost elements misclassified as overlays, and opening opacity transitions delaying locks. Repairs remain within the phone scope.

Inventory lanes: `qa/staff-phone-rules-browser.js` checks every top-level staff screen and its Tabs/More surfaces; `qa/staff-phone-final-pass.js --all-states` expands the existing Filming, Upload, Analytics, Calendar, Samples, Workload and Production catalogues; `kasper-admin-expanded-browser.js` covers review, messages, clients, credentials, hiring, sales, onboarding and PTO states. Every rendered overlay in these lanes receives the overlap detector and background scroll assertion. These are finite known catalogues, not a claim that arbitrary future states have already been tested.

Local matrix evidence: 160 rule states pass; the complete catalogue has 464 passing receipts (460 from the full sweep and four corrected client-picker cases); 252 reviewer/admin states pass 4652 assertions; 20 focused legacy-popup states pass. The catalogue full run itself exited 1 for four retired-selector setup timeouts, retained in the check report. Four focused cases pass after correcting that setup. The per-state [inventory](2026-10-07-staff-phone-states.md) lists the evidence for each state. Physical phone keyboard and operating-system bars, authenticated live writes, deployment and hosted CI remain unverified. Viewport keyboard simulation and safe-area CSS are local browser evidence.

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

Expansion termination: generations 1–3 produced the inventory above. The final known catalogue, admin and rule matrices produced no further confirmed ratified sibling. The three-generation cap ends this round; the combined passing receipts constitute a dry sweep of these known states, subject to the pending selection-closure interpretation below. No universal claim about future data or every possible content combination is made.

Owner decision list: decide whether choosing a popup option must also leave it open. Ordinary inside/header/padding taps are protected, but completed native selections and navigation still close their surface. This is an explicit exception to the literal R5 wording and is OWNER-LISTED pending clarification; the report does not claim that all interior action taps stay open. Recommendation: retain completion/navigation closure while preventing accidental interior dismissal. Also retain the single-PR override from this request; review the phone action-row layout in the artifact; retain failed required gates visibly rather than interpreting timeout as success. Proposed skill amendments: make full known-state catalogue selection explicit; require detector failing controls before reporting a dry expansion; preflight every required gate's backend read scope so aggregate live harnesses cannot silently exceed a TEST-only task. The skill itself was not edited.

Rollback: revert this PR and rebuild the index fragments. No database, Edge Function, runtime flag, automation or provider-wiring change.

Rule inventory counts: R1 touches six element-class rows in the 16-row repair table; R2 touches eight; R3 and R4 touch one and two respectively; R5 touches two dismissal classes plus the owner-listed completed-selection class. Width/theme permutations and actual native state names are enumerated in the linked inventory, rather than counting repeated screen instances as new rules.

Geometry limits: the detector compares independent interactive controls and card media warnings intersecting the viewport, excludes intentional ancestor containment, and tests the active leaf popup independently of its covered background. It catches actual rectangle intersections greater than one pixel. It does not claim arbitrary-text or below-fold universal coverage. Scroll checks snapshot the page and every background scroll container, exercise trusted touch and wheel, and explicitly verify nested parent lock, child scrolling, final unlock and scroll restoration.

Required broad gates remain red: master-test timed out its unit lane at 300 seconds; the independent complete unit run reports 17 failures in 684 suites. All 17 failing suites also fail on the unchanged original base. Production wired behavior is 168/169, with the same group-collapse failure on that base. Neither baseline comparison converts a failed gate into a pass. The pre-alignment full desktop gate passes 72/72 PNG-byte and computed-style pairs. A fresh full gate is running on the final caption-margin override; its result will be appended. All generated screenshot hashes reviewed so far are tracked privately.

[Actual final lines of every check, including failed iterations](2026-10-07-staff-phone-checks.md).

Late assertion discovery: an explicit caption-action row check exposed a four-pixel mismatch from an older phone selector overriding the artifact. The artifact now forces zero block margins and centered alignment, with a verbatim CSS transplant. The final source passes all 160 rule states, including four width/theme caption journeys passing 28 focused states; Calendar/Samples card geometry passes eight renders. Shared action-placement assertions now apply in the catalogue and admin lanes too. The earlier complete state receipts are reused for unchanged behavior; changed caption layout is covered by these focused repetitions and the final 160-state rule repetition.
