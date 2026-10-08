# Batch 3 — client Calendar loading

Branch: `codex/prism-phone-batch-3`. Parent: batch 2,
`8361c27b8f2ac9b7434e6799fc76502d92e0bd80`. Lighthouse merged batch 2
as `79a0dd143cd7c16517256f78790c8cf7a530f315` while batch 3 was being
prepared; Prism has not merged anything. Batch 3 targets main directly.

Current source hash:
`35a319476117fffce2e2be7b75d34b338a7538ed6fa6fd54820d71d200d17865`.

The client Calendar's Month and Week loading skeletons painted over its heading.
Month also displayed “Nothing scheduled” during loading. A separate 24-state
probe reproduced the defect after settling. At 390 pixels the loading panel
started at y=146, yet 64 Month and 14 Week skeleton elements escaped above it;
hit-testing the heading selected a skeleton line. This was a rendered defect,
not an inference from a green geometry suite.

Month and Week now use a compact, visibly labelled loading panel on client
phones. The existing desktop skeleton markup remains on the desktop branch.
CSS is inside the existing client-only, 767-pixel block. This changes no read,
write, authorization, database, workflow, or approval behavior.

[Before/after gallery](gallery.md), [HTML gallery](gallery.html),
[capture hashes](screenshots.json), and [personal review receipts](reviews.json)
cover twelve Month/Week width/theme cells. All twelve were personally inspected
at native pixels; the captures from the native navigation run match those
reviewed PNG bytes. Requested dark preference is recorded separately from the
effective light theme: client links intentionally force light in
`_syncviewThemeAllowed()` / `_syncviewApplyTheme()`.

The original full goal remains open. [Coverage](../COVERAGE.md) contains 335
native states, 2,010 cells and 280 discovery obligations. Only these twelve
current loading cells are accepted. Changing source invalidated previous
batch acceptance; their historical receipts remain intact.

Tooling repairs in this batch:

- The basic review fixture's SVG URL was not recognized by the production
  thumbnail classifier. It now uses an intercepted, supported Drive image and
  explicitly proves the thumbnail decoded.
- Detailed client runners accept the requested widths and both theme
  preferences, record the effective theme, capture viewport plus full page,
  and run serially. All Chrome runs are headless with no foreground calls.
- Calendar now captures its previously unphotographed Sheet CTA and caption
  draft, and independently checks all four native loading views.
- Samples Notes now covers both a safe unlinked refusal and the normal composer
  using an exact fictional crosswalk and canonical read. Binding is confined
  to that state so it does not alter the separate approval journey's route.
- Recovery screenshots are captured after restoring each client entry.
- Filming's newly discovered native month disclosure is now inventoried.
  Its fixture uses production's `Set` of months and native tab-count refresh,
  with checks for six cells, the covered-month document link and correct count.

Actual completed check tails:

```text
client-calendar-expanded: OK (4500 assertions; Review, Sheet, Month, Week, menus, drafts, loading, failure, empty, breakpoint; 375/390/430; requested light/dark, effective client light).
client-links-expanded: OK (2964 assertions; Samples Review/queue/Sheet, Analytics, menus, Notes, lightbox, draft, sending, failure, loading, empty, desktop restore; 375/390/430; requested light/dark, effective client light).
client-phone-review: OK (calendar + samples, 5 phone sizes each, light + dark, approve + request change)
check-modules: all checks passed
client-phone-css-scope: OK (6 block(s), 464 braces, all under @media (max-width: <=767px) and html.boot-client)
PHONE_COVERAGE: 334 native states; 2004 width/theme cells; 280 discovery obligations; 12 clean cells
```

Final source client reruns have completed. The Calendar run exercises native
view buttons while loading. Against the parent source the added regression
guard fails with:

```text
AssertionError [ERR_ASSERTION]: month: skeleton paints over the Calendar heading
```

Retained failed invocations: a reference asset route initially attempted to
read an uncopied favicon; missing static assets now fall through while missing
reference HTML/JS remains a 404. The first Notes repair added IDs without the
required crosswalk and canonical read, and timed out. Attaching a valid binding
throughout the whole journey then changed its approval route; confining the
binding to Notes restored the intended separate fixture journeys. The first
loading guard treated deliberately clipped organizer-strip elements as painted
overflow; the final guard checks heading coverage for every view and full
containment for the repaired timeline panel.

The existing admin phone suite has now completed on this source:

```text
KASPER_ADMIN_CHART: pinned production 4.4.0 bytes; 6 phone chart action/theme/desktop-restore states checked.
KASPER_ADMIN_EXPANDED: 420 native states; 8892 checks; 0 failures; fictional data; no live writes.
check-index: OK — assembled == working tree == committed (HEAD)
This change adds no client slug and no colleague's name ✅
repo-map-sync: 1118 passed, 0 failed
truth-sync: 515 passed, 0 failed
```

The index SHA256 is
`05ef2a5c25a1b3e20bfcd9996aac3faf8baa161ab0301c31f0361e72b5d2a4aa`
(1,314,399 bytes). The identity guard was run after staging all new generated
assets and evidence. Desktop 72-cell parity against the parent, final staff
checks, final source client reruns, and focused 32-state desktop loading
comparisons have completed. The branch has uploaded; hosted checks will be
tracked on this batch's PR. No deployment or finish-line claim is made.

Focused desktop loading follow-through has completed:

```text
CLIENT_LOADING_DESKTOP: 32/32 exact PNG, native markup and computed-style pairs
```

[Safe desktop hashes](desktop-loading.json) cover the four native Calendar
loading views at 1024/1280/1440/1920 with both preferences, against batch 2.
Raw desktop pictures stay private. The initial private reference invocation
aborted because its Windows path was not normalized before the containment
check; that failed invocation remains retained. The normalized reference and
after captures match exactly. Broad 72-cell parity has also completed with exact PNG and style matches.

Further work remains on staff screens, Filming help/copy, Notes wording and
small supporting labels, long/many-item and refused-save states, and complete
personal review of client captures beyond these loading panels. None is an
accepted exception. A complete clean round and a separate fresh review are
still required.

Final frozen-source follow-through:

```text
STAFF_PHONE_RULES: 240 states; 0 failures; 375/390/430 touch; synthetic transports; no live writes
STAFF_PHONE_DESIGN: 24 native card states; 0 failures; fictional intercepted transports
72/72 desktop shots identical to 8361c27b8f2ac9b7434e6799fc76502d92e0bd80
```

The exact terminal tails are also retained in [check tails](checks.json). [Desktop hashes](desktop.json)
prove every broad comparison and preserve the gate's attempt counts. No pixel
tolerance, exclusion or gate weakening was used. The 32 additional loading
pairs compare native markup and computed styles as well as exact PNG bytes.

The expanded all-state staff capture is still running independently of these
completed checks. Screenshots alone do not mark coverage clean. Personal review
of all 48 new card/action captures (six width/theme cells for each of eight
states) leaves them OPEN: light placeholders and the alternate-caption action
look too faint; the gap between media actions and card title needs native
geometry/context verification; icon-only destinations need first-time-user
review. These are observations to investigate, not accepted exceptions or
unverified claims of broken behavior. Admin Filming/Clients review also remains
OPEN, including help copy, supporting-label contrast and unlisted disclosures.
Only the twelve repaired client loading cells are currently accepted.
[Source-bound open observations](open-review-observations.json) also record
eighteen Notes/refused-save viewport reviews. Tiny incomplete Notes selector
labels and internal refusal wording need repair; the refusal capture's missing
header needs independent settled geometry proof before becoming a finding.

A separate 375/light probe held the same native refusal state for another
700 milliseconds. Its modal header and 44-pixel Close button are on screen
(header y=84.40625; Close y=100.40625). The missing-header candidate is refuted
at that cell; the earlier screenshot remains retained as a capture artifact,
not product layout proof. The settled picture still shows “Start the
conversation — type below” above “Notes are not available”, so the contradictory
empty/refusal copy remains OPEN. The probe's actual tail is:

```text
client-links-expanded: OK (494 assertions; Samples Review/queue/Sheet, Analytics, menus, Notes, lightbox, draft, sending, failure, loading, empty, desktop restore; 375; requested light, effective client light).
```

The added Filming disclosure and three existing Filming states pass a focused
six-cell rerun:

```text
KASPER_ADMIN_EXPANDED: 24 native states; 396 checks; 0 failures; fictional data; no live writes.
PHONE_COVERAGE: 335 native states; 2010 width/theme cells; 280 discovery obligations; 12 clean cells
```

That first focused rerun used fallback fonts and is retained for native-action
proof only. The complete admin rerun with the intended local fonts and pinned
Chart.js bytes has now completed:

```text
KASPER_ADMIN_CHART: pinned production 4.4.0 bytes; 6 phone chart action/theme/desktop-restore states checked.
KASPER_ADMIN_EXPANDED: 426 native states; 9012 checks; 0 failures; fictional data; no live writes.
```

[Independent settled disclosure measurements](filming-disclosure.json) bind
all six personally viewed captures to this source. The container is flex even
though its phone rule sets three grid columns. Tiles wrap 4+2 at 375/390 and
5+1 at 430; mixed 58/44-pixel heights and up to 14.5-pixel label offsets look
uneven. Uncovered month labels have 1.89:1 contrast in light. The row has no
keyboard role/tab stop, and the disclosure's only visible cue is a tiny caret.
These remain OPEN product repairs for the next batch. No fixture correction
is being called a product count/month bug. The first metadata printer expected
an explicit light-theme attribute; light uses the default, so the retained
failed print was corrected to record requested/effective themes separately.
Seventy-two source-bound open visual observations are now recorded.
