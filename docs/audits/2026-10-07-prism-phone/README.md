# Prism phone review

Status: ACTIVE. The finish line has not been reached. A complete visually clean
round and a separate fresh-review round are both still required. Lighthouse
reviews and merges; Prism does not merge.

Browser execution preference (owner, 2026-10-07): use headless Chrome with no
foreground calls, so screenshot checks do not interrupt other applications.
This supersedes the earlier visible-browser setup for Prism's ongoing review.
Retain the same native product fixtures, action assertions and screenshot review.

[Batch 3](batch-3/README.md) records the client Calendar loading and empty Today
marker repairs. Its [CI follow-up](batch-3/ci-followup/README.md) has 24 personally
reviewed matrix pairs on the current source, plus two 360 px Month comparisons.
The original 72 broad desktop and 32 focused loading proofs remain historical;
the changed source now has 72/72 additional exact desktop pairs. Hosted rechecks
remain a separate pending gate.
The full phone finish line remains OPEN.

[Coverage](COVERAGE.md) lists the native scenarios and all width/theme cells.
[Machine-readable coverage](coverage.json) also tracks ten discovery obligations
for every staff tab, reviewer/admin subtab, personal Time Off and client review
surface. Missing setups remain OPEN. Screenshots and passing geometry never
automatically turn a cell CLEAN. Reviews must identify the exact capture hash.
Changing source fragments invalidates previously clean cells in the generator.

[Batch 1 before/after gallery](batch-1/gallery.md) includes 36 matched pairs;
[HTML gallery](batch-1/gallery.html) is also available for local viewing.
[Personal review receipts](batch-1/reviews.json) identify 36 clean cells by exact
PNG hash. This is bounded state evidence, not a clean full round.

[Batch 2 before/after gallery](batch-2/gallery.md) contains 78 matched Ads/Quiz
pairs, with [78 historical visual receipts](batch-2/reviews.json). Its
[repair and evidence notes](batch-2/README.md) identify the exact source and
remaining work. Current source invalidated earlier batch acceptance. The matrix
accepts twelve batch 3 loading cells; earlier reviews remain available separately.

## Batch 1: Save problems and coverage tooling

Branch: `codex/prism-phone-batch-1`. Base:
`1c64ddee5250071af478db45f2332c275072259d`.

Confirmed visual findings and repairs:

- A wide log hid the error and recovery message to the right with no phone
  scrolling cue. Phone records now stack labelled fields vertically and put the
  error and message first. Long messages and unbroken references wrap.
- Filter controls had different starting positions and changed arrangement at
  430 pixels. Their labels and controls now align in three equal-width rows.
- The loading log used Calendar media/action skeletons extending several phone
  screens. It now shows a compact, labelled loading panel on phones.
- The inherited admin Filming empty fixture returned an invalid response. Its
  transport now returns a successful empty list, with an explicit empty-state
  assertion. This repairs evidence, not a deployed backend.

All product CSS sits inside the existing owned admin phone block and a
`max-width:767px` query. No save request, authorization, database or workflow
changes. The client runner now checks both themes and captures the card,
individual panels, confirmation, draft and action result. The staff/admin
runners expose their existing inventories; admin accepts all requested widths.
The existing expanded client Calendar/Samples/Analytics journeys also expose
their inventories. The source redirects stale client Brief history to Calendar
(`050-market-briefs.js.part`, `render()`); its phone redirect proof is listed
separately for discovery. A catalogue entry
does not claim a screenshot, a dark-painted client page or a passing journey.

Regression guards cover field containment, recovery-first order, every visible
field label, filter alignment, compact loading and native filter/Refresh reads.
All five native read actions are intercepted and their payloads are checked.

## Still open

The broad staff captures, most detailed human reviews, missing refused-save and
content-stress setups, client loading/error/refused-save journeys and the fresh
review round remain OPEN. The twelve-record stress case has passing containment
checks; its entire long screenshot still requires detailed visual review.
The Filming information icon remains an open design-standard issue for a later
batch, rather than an accepted exception. Personal review of its valid empty
state also found unexplained "source-of-truth tab" instructions. Batch 2 repairs
the Ads/Quiz Calendar loading placeholders, Ads' narrowed Refresh control and
faint captions, and Quiz's excessive control spacing. The populated tables,
longer timelines and detailed stress states remain separate OPEN work.
Client captures requested with dark preferences currently paint light; this
must be recorded as the effective theme. Batch 3 repairs the supported thumbnail
fixture and verifies image decoding; valid embedded-video coverage remains OPEN.

Initial staff captures used fallback fonts; final accepted captures must use the
intended local font assets. Raw broad captures remain private until visually
reviewed for both quality and fixture-only content. No physical-phone,
deployment or live-save claim is made.

Desktop parity is a required batch gate. Preserve every failed invocation;
pixel differences with matching computed styles are failures until investigated.
The default gate could not resolve its token without a staff key. The existing
private read-only adapter uses the configured credential to select only the TEST
review token; it performs no issuing, rotation or database write. Raw live
desktop images stay private. Only hash/pixel-difference receipts may be public.

[Desktop receipts](batch-1/desktop.json) cover all 72 distinct page/width cells
with exact PNG bytes and matching computed styles: 71 matches in the final
frozen-source invocation plus one passing unchanged-gate Kasper/1280 replay.
The final full invocation remains FAILED at 71/72; its ten-pixel mismatch and
the earlier 70/72 invocation are retained. The mismatch's cause is UNPROVEN.
No tolerance, exclusion or gate change was used. This proves the batch's desktop
comparisons, not deployment or the unfinished phone round.

Rollback: revert this batch and run `npm run build:index`.
