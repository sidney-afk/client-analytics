# Calendar hosted-check follow-up

The batch introduced a host/browser date mismatch: the runner started using
Guatemala browser time, but the populated fixture kept using the host's date.
At about 02:10 UTC the host was already October 8 while the browser was still
October 7, so the fixture scheduled content tomorrow. Main's runner used the
host's zone in both places and did not enter that state. The mismatch exposed
an existing empty Today layout defect: its 36 px marker shrank to 34 x 36 px at
360 px. The old product source also failed when exercised with the new runner;
that comparison does not claim main's original CI failed.

The shared phone-only Month/Week marker now refuses flex shrink. The browser
runner additionally checks an empty Today in both views at every width,
independent of the host timezone. The populated fixture now also uses the
browser's zone. The original 36 px assertion remains intact and reports
measured dimensions on failure.
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

The final timezone correction changes only the fixture runner and explanation;
the product source, gallery pixels and 72-pair desktop proof above are unchanged.
The populated Today assertion now also proves that the normal fixture lands
on the browser's current day. The UTC-host rerun's actual final line is:

```text
client-calendar-expanded: OK (4668 assertions; Review, Sheet, Month, Week, menus, drafts, loading, failure, empty, breakpoint; 360/390/430; requested light/dark, effective client light).
```

On 2026-10-08 the owner narrowed subsequent review rounds to desktop 1440,
iPhone 393 x 852 and Android 412 x 915, on Today, staff/client Calendar,
Samples, card detail, Clients, TikTok upload, Analytics, Workload and Ads.
Quiz and Save problems are excluded. The older galleries and width matrix
remain historical proof; they do not certify the new device matrix.
