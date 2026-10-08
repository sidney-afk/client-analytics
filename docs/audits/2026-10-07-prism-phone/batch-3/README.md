# Batch 3 — client Calendar loading (in progress)

Branch: `codex/prism-phone-batch-3`. Parent: batch 2,
`8361c27b8f2ac9b7434e6799fc76502d92e0bd80`. Batch 2 remains open for
Lighthouse; Prism has not merged anything. No batch 3 PR has been published yet.

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

The original full goal remains open. [Coverage](../COVERAGE.md) contains 334
native states, 2,004 cells and 280 discovery obligations. Only these twelve
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

Actual completed check tails:

```text
client-calendar-expanded: OK (4500 assertions; Review, Sheet, Month, Week, menus, drafts, loading, failure, empty, breakpoint; 375/390/430; requested light/dark, effective client light).
client-links-expanded: OK (2964 assertions; Samples Review/queue/Sheet, Analytics, menus, Notes, lightbox, draft, sending, failure, loading, empty, desktop restore; 375/390/430; requested light/dark, effective client light).
client-phone-review: OK (calendar + samples, 5 phone sizes each, light + dark, approve + request change)
check-modules: all checks passed
client-phone-css-scope: OK (6 block(s), 464 braces, all under @media (max-width: <=767px) and html.boot-client)
PHONE_COVERAGE: 334 native states; 2004 width/theme cells; 280 discovery obligations; 12 clean cells
```

The links/basic tails above precede the product change and need their final
source rerun. The final Calendar run exercises native view buttons while
loading. Against the parent source the added regression guard fails with:

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

Desktop 72-cell parity against the parent and the existing admin phone suite
are running. Final staff checks, final source client reruns, focused desktop
loading comparisons, identity guard, index/HEAD proof, hosted checks, and PR
publication remain pending. No deployment or finish-line claim is made.

Further work remains on staff screens, Filming help/copy, Notes wording and
small supporting labels, long/many-item and refused-save states, and complete
personal review of client captures beyond these loading panels. None is an
accepted exception. A complete clean round and a separate fresh review are
still required.
