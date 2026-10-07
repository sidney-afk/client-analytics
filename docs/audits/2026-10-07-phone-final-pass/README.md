# Staff Expanded phone final pass

Built from main `ed3d8386aeab9658827aed7ae20b399ec4a8d0b4`, following layout A
in PR #1950's branch. Repository changes only; not merged or deployed.

[Open the before/after gallery](gallery.html). Each of the 31 views has paired
360/390 px light/dark captures. After checks also cover 430 px: 186 renders and 310 pictures in total. The pictures
show the generated product with invented data and abstract fixture media.
They contain no real client images, client identities or live link tokens.

| Request | Change | Screenshot views |
|---|---|---|
| 1. Calendar/Samples More | Labelled native proxy actions replace the raw desktop badge, staff icon and Quick jump control. | calendar-more, samples-more |
| 2. Analytics overview | Cards are the phone default. The native table choice remains available; phone choices do not overwrite the desktop preference. | analytics-overview |
| 3. No selected client | Choose client opens the real picker from both empty screens. | calendar-empty, samples-empty |
| 4. Client picker | Upload, Analytics, Workload and Linear share a modal sheet with title, backdrop, close action, native search and native selection. | menu-client, analytics-client-picker, workload-client-picker, linear-client-picker |
| 5. Dark selection | Today, Upload and Calendar/Samples use a clearly raised selected surface. | today-rings, today-walk, tiktok-client-ready, instagram-client-ready, calendar-sheet, samples-sheet |
| 6. Calendar/Samples segments | Equal centred segments contain the Review count. | calendar-sheet, samples-sheet |
| 7. Workload | Legend counts have their own spacing; undated tasks have a comfortable section. | workload-week |
| 8. Analytics detail | Gains labels, dots and dates are readable; the stray divider is removed. | analytics-detail, analytics-overview |
| 9. Linear | Short phone breadcrumbs and inset panels avoid clipped icons and edge contact. Detail keeps Back and the issue ID through phone-only CSS, including after resizing; project rows give titles their own line and retain status/selection/date/assignee actions. | linear-list, linear-detail, linear-project |
| 10. Upload | Queue tabs fit one row, options wrap naturally, and browse wording says tap on phones and restores click on desktop without replacing the file chooser. | tiktok-client-ready |
| 11. Shared sheets | Four shells call one menu builder, with consistent labels, row sizes and close controls. Calendar's reviewer destination fits above the fold. | menu-tabs, menu-more, sheet-tabs, sheet-more, calendar-tabs, samples-tabs |
| 12. Templates brief | Visible action controls, intact colour chips and individual sections without the extra outer card. | templates-client, templates-client-edit, templates-client-spec-form |
| Smaller: Tools | Shared More sheets include the Tools label. | calendar-more, samples-more, sheet-more, menu-more |
| Smaller: Submit | Thumbnail issue only stays together at 360 px. | submit |
| Smaller: Today | Cleared time has its own column beside the title. | today-cleared |

The transport answers reads and writes locally. No backend decisions, client
comments, PTO requests or uploads were changed. Client-link layout scopes are
unchanged. New CSS stays within the existing staff phone scopes and uses
existing colour variables. Picker rows dispatch the original handlers; no
permission or save rule is replaced.

Verification and limits: The native Calendar and Samples suites pass
9,540 and 5,334 checks respectively. The focused Production layout pass has no
remaining phone clipping or parent-trail failures. Its desktop board-width
failure also occurs on unchanged main; intermittent pending-read failures
remain visible in the report. The gateway editor-size and behavior pending-read failures also
reproduce on unchanged main. Those failures are retained, not waived or reported
as passing. The refreshed PTO lifecycle passes 101 action/result screenshots and 35 coverage
gates. Exactly 97 original approved picture hashes are unchanged;
all 4 changed pictures were visually reviewed. Its two existing fixture warnings remain warnings.
The source coupling and public-evidence validation pass under the same single-file
preload as CI. The full desktop comparison passes: 72/72 PNG and computed-style comparisons are identical at 1024/1280/1440/1920. The [actual pixel diffs](desktop-diffs/manifest.json) contain zero changed pixels. Its optional
four-worker mode keeps the complete matrix, snapshot isolation, PNG/style checks
and all four retries; its default remains sequential. A native child-issue test
also confirms that resizing restores the original desktop parent breadcrumb
without rebuilding its markup.
Physical phones and a deployed version of this branch have not been tested.

[Real check output and retained failures](CHECKS.md). Main advanced by a documentation-only merge during verification; the app reference remained byte-for-byte unchanged.
