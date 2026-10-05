# Staff Samples and Calendar Selection · Expanded phones

This builds the actual staff Samples Review and Sheet, plus Calendar Selection,
in `src/index/` at 360, 390 and 430, in light and dark. The branch starts from
main and reuses Pocket's shared Calendar phone foundation. Other staff tabs,
admin pages and client layouts are outside this batch.

Samples gets the title, Tabs and More beside each other, with Samples Tools above
the content. More contains the native card size, setup, account, workspace and
Quick jump controls. Review keeps full Video and Thumbnail sections with the
existing decisions and notes beside their material. Sheet uses comfortable
individual cards. Its native Select control now remains available when switching
from Review on a phone. Selection actions sit at the bottom, with the count,
Done, Archive, colour choices and caption action preserved where applicable.

Only phone rules below 768px and standalone Calendar/Samples markers apply.
Desktop restores the original controls. Existing permissions, writers, drafts,
saved copies and skeletons remain. A pending decision stays visibly Saving until
acknowledged; a refusal stays visible rather than appearing finished.

## Before and after

Open [the screenshot viewer](gallery.html) locally to compare widths and themes.
These are screenshots of the generated product with fictional data and media,
not a separate prototype. Scroll within the phones to see the full sections.

| Screen | 360 before / after | 390 before / after | 430 before / after |
| --- | --- | --- | --- |
| Samples Review · open | [Before](before/samples-review-light-360.png) / [After](after/samples-review-light-360.png) | [Before](before/samples-review-light-390.png) / [After](after/samples-review-light-390.png) | [Before](before/samples-review-light-430.png) / [After](after/samples-review-light-430.png) |
| Samples Review · queue | [Before](before/samples-queue-light-360.png) / [After](after/samples-queue-light-360.png) | [Before](before/samples-queue-light-390.png) / [After](after/samples-queue-light-390.png) | [Before](before/samples-queue-light-430.png) / [After](after/samples-queue-light-430.png) |
| Samples Sheet | [Before](before/samples-sheet-light-360.png) / [After](after/samples-sheet-light-360.png) | [Before](before/samples-sheet-light-390.png) / [After](after/samples-sheet-light-390.png) | [Before](before/samples-sheet-light-430.png) / [After](after/samples-sheet-light-430.png) |
| Calendar Selection | [Before](before/calendar-selection-light-360.png) / [After](after/calendar-selection-light-360.png) | [Before](before/calendar-selection-light-390.png) / [After](after/calendar-selection-light-390.png) | [Before](before/calendar-selection-light-430.png) / [After](after/calendar-selection-light-430.png) |

There are 24 before and 192 after screenshots. They cover selection with zero and
one selected card, caption selection, archive confirmation, Tabs, More, Quick
jump, Notes, media, status menus, Set all, Create Post, archived rows/loading/
empty/error, Review and Sheet loading/empty/error, saving and refused saves.
[The measurements](after/measurements.json) record the native controls checked.

## Browser and real saves

All local browser passes reused visible Chrome. The phone gate passed 4,188
checks across both themes and all three widths, including no sideways page
scroll, 44px controls, 16px fields and restoration at desktop width.

Read-only native checks on the designated TEST client covered Samples Review
and Sheet at all three widths in both themes. The real client Video Approve and
Thumbnail Request change actions saved through the original writers. Fresh reads
confirmed Approved with its timestamp, then Tweaks Needed with the exact typed
note. Both decisions were repeated after the shared theme/Quick jump corrections
and after the final staff design update.
All observed decision writes returned HTTP 200. The owned disposable source was
archived through the native confirmation; fresh reads confirmed Archived and
both linked native work items in Backlog. No other client was mutated.
[The anonymous receipt](live-saves.json) separates the initial native-view pass
from the final decision repetition. This proves a local candidate, not deployment.

## Desktop and checks

The full desktop gate compares 17 views at 1024, 1280, 1440 and 1920. See
[the receipt](desktop/complete-parity.json) and [actual check tails](checks.txt).
Public desktop pairs are cropped below the real staff header to protect
identities; the gate compares the full screenshots and computed styles.

The Production gate has the existing `PWG_PHASE_INPLACE_PLACE` failure on
unchanged main (697×68 read view versus 682×92 editor). This batch does not
repair Production. Native OS/iPhone hardware, deployment, real staff approval
writes and admin/credentials dialogs are not claimed. A browser-controller
interruption required reconnecting before the native view measurement; the
final real decisions and cleanup were completed afterward.

No merge, deploy, workflow edit or database installation was performed by Pocket.

[Owned gallery coverage](owned-gallery-coverage.json) maps the 16 Pocket-owned
states to the four product PRs. The other gallery screens are assigned elsewhere.
