# Staff Calendar · Expanded phone batch

This builds the actual staff Calendar Review, Sheet, Month and Week in
`src/index/`, in light and dark at 360, 390 and 430. It starts independently
from main. Selection and staff Samples are the next batch; client links and
admin layouts keep their existing paths.

The page title, Tabs and More share one row. Calendar Tools stays above the
content. More contains the native Organize, card size, setup, workspace picker
and account controls. Tabs delegates to the existing permitted navigation.
Review keeps the full Video, Thumbnail and Caption sections, their decisions,
notes and media. Sheet becomes comfortable individual cards. Month and Week
become vertical days. Consecutive empty days share a labelled Nothing scheduled
line; starting a native drag reveals every retained date target, and ending it
restores the grouping. Today and scheduled material remain visible. Opening a section never changes a decision. Pending decisions
say Saving until the native acknowledgement; failures remain visible.

All added styles are inside phone media queries capped at 767px and guarded by
the standalone staff Calendar marker. Desktop restores the original controls,
positions and menu state. Existing writers, permission checks, skeletons,
saved copies and drafts remain.

## See the product

Open [the screenshot viewer](gallery.html) locally to switch width, theme and
view. Scroll inside the phones; the additional buttons show built menus,
dialogs, empty states, loading and errors. These are screenshots of the real
generated product with fictional data and media, not a separate prototype.

| Screen | 360 before / after | 390 before / after | 430 before / after |
| --- | --- | --- | --- |
| Review · post open | [Before](before/review-light-360.png) / [After](after/review-light-360.png) | [Before](before/review-light-390.png) / [After](after/review-light-390.png) | [Before](before/review-light-430.png) / [After](after/review-light-430.png) |
| Sheet | [Before](before/sheet-light-360.png) / [After](after/sheet-light-360.png) | [Before](before/sheet-light-390.png) / [After](after/sheet-light-390.png) | [Before](before/sheet-light-430.png) / [After](after/sheet-light-430.png) |
| Month | [Before](before/month-light-360.png) / [After](after/month-light-360.png) | [Before](before/month-light-390.png) / [After](after/month-light-390.png) | [Before](before/month-light-430.png) / [After](after/month-light-430.png) |
| Week | [Before](before/week-light-360.png) / [After](after/week-light-360.png) | [Before](before/week-light-390.png) / [After](after/week-light-390.png) | [Before](before/week-light-430.png) / [After](after/week-light-430.png) |

There are 30 before and 318 after screenshots across both themes and all three
widths. They include Review queue and open post, Tabs, More, Organize, account, Quick jump,
Platform, Import including column mapping and post selection, caption prompt, Create Post and thumbnail-only creation,
Archived cards with rows/loading/empty/error, Notes, lightbox, status pickers,
date picker, archive confirmation, previews, saving, refused saves, read errors,
native skeletons and empty views. The phone acceptance receipt is
[after/measurements.json](after/measurements.json).

## Real browser and saves

Local work reused visible Chrome. Read-only checks on the designated TEST client
covered all four native views at all three widths, in both themes: no sideways
page scroll, controls at least 44px and fields at least 16px.

The real client Caption Approve and Request change buttons each returned HTTP
200. Fresh normal reads confirmed Approved and its timestamp, then Tweaks Needed,
the exact typed note and its timestamp. The owned disposable card was archived
through the normal app and read back as Archived. No other client was mutated.
The anonymous receipt is [live-saves.json](live-saves.json). Its source hash is
the candidate used for that pass. Both real client decisions were repeated after
the hosted-check fixes and the concurrent design update; fresh reads again
confirmed the saved decisions and note,
and the owned card was archived. The final import-only CSS adjustment enlarges
column toggles and stacks mapping fields; it does not touch the decisions.
This proves a local candidate, not deployment.

## Desktop and checks

The complete desktop gate compares 17 views at 1024, 1280, 1440 and 1920.
All 68 screenshots and computed-style comparisons are identical to main.
[The receipt](desktop/complete-parity.json) records every view. The public
Calendar image pairs are cropped below the real staff header to protect
identities; the comparison itself used the full screenshots.

The actual final check output is in [checks.txt](checks.txt). The Production
browser gate still fails its existing `PWG_PHASE_INPLACE_PLACE` check on unchanged
main (697×68 read view versus 682×92 editor); this batch does not repair Production.

Not claimed: native OS/iPhone hardware testing, deployment, credentials/admin
dialogs owned by the other session, a complete file-import write/readback pass,
or real staff approval writes. Import mapping and selection are verified using
fictional parsed rows. Staff action guards are exercised with fictional
transport; the real save proof exercises the important client decisions.
No backend, n8n workflow or database installation was performed, and nothing was
merged or deployed by Pocket.

### Thumbnail comparison dialog

The native comparison remains a full, vertically stacked Previous and Current view on phones. Close and Retry have 44px targets. Retry returns keyboard focus to Close while its temporary button is replaced, so Escape continues to work. All eight reader/image states are captured at every phone width in both themes. Only the assigned phone surfaces receive the change; the desktop gate is repeated afterward. No approval writer or decision rule changes in this follow-up. The real decision receipts above predate this dialog-only adjustment.

The shared-client check now opens the native client picker and card size through More on phones, with its original desktop assertions retained. Its local 1440px long-label failure also reproduces on unchanged main; no desktop navigation repair is included.
