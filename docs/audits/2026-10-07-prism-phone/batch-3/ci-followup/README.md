# Calendar hosted-check follow-up

The two hosted failures on PR #1994 exposed an existing empty Today marker
defect: a 36 px marker shrank to 34 x 36 px at 360 px when the fixture scheduled
content tomorrow. The UTC host and Guatemala browser made that state repeatable.
The exact prior batch also failed. This is a phone layout defect, not a reason
to weaken the test.

The shared phone-only Month/Week marker now refuses flex shrink. The browser
runner additionally checks an empty Today in both views at every width,
independent of the host timezone. It reports measured dimensions on failure.
No desktop rule, transport, backend or persistence changes.

Current source: `c2221cd8405981e3fc2d3ff551bd648d937c053e37b97aea5112b277e83e4963`.
Current generated index: `77ddae125eb67370d185c7a0d0bcd31bdc1105471fad109335ffe41da52b4b8e`.

[Gallery](gallery.md), [PNG receipts](screenshots.json), [personal reviews](reviews.json),
and [current coverage](../../COVERAGE.md) record 24 clean matrix cells: Month/Week
loading and empty Today at 375/390/430, requested light/dark, effective client
light. Two additional 360 px Month cells were reviewed. All other cells stay OPEN.
The original screenshots and failed hosted log remain historical evidence.

Actual focused check tail:

```text
client-calendar-expanded: OK (6208 assertions; Review, Sheet, Month, Week, menus, drafts, loading, failure, empty, breakpoint; 360/375/390/430; requested light/dark, effective client light).
```

[Desktop proof](desktop.json) now records 72/72 exact PNG and computed-style pairs
against the exact pre-follow-up head. The original batch 3 proof against batch 2
and 32 focused loading pairs remain historical evidence. [Actual check tails](checks.json)
include the final-source Calendar, module, scope, map, truth, index and exposure checks.
Hosted rechecks remain pending. The 696-render staff sweep finished with zero
reported problems on the initial source, but its screenshots await personal
review and do not certify this changed source. No full round or fresh-review
acceptance is claimed. Notes wording, media coverage and Filming discoveries
remain OPEN for subsequent batches because they need their own fixes and proof.
