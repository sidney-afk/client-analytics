# Staff Expanded phone final pass

Built from main `ed3d8386aeab9658827aed7ae20b399ec4a8d0b4`, following layout A
in PR #1950's branch. Repository changes only; not merged or deployed.

[Open the before/after gallery](gallery.html). Each of the 29 views has paired
360/390 px light/dark captures. After checks also cover 430 px. The pictures
show the generated product with invented data and abstract fixture media.
They contain no real client images, client identities or live link tokens.

| Request | Change | Screenshot views |
|---|---|---|
| 1. Calendar/Samples More | Labelled native proxy actions replace the raw desktop badge, staff icon and Quick jump control. | calendar-more, samples-more |
| 2. Analytics overview | Cards are the phone default. The native table choice remains available; phone choices do not overwrite the desktop preference. | analytics-overview |
| 3. No selected client | Choose client opens the real picker from both empty screens. | calendar-empty, samples-empty |
| 4. Client picker | Upload, Analytics, Workload and Linear share a modal sheet with title, backdrop, close action, native search and native selection. | menu-client, analytics-client-picker, workload-client-picker, linear-client-picker |
| 5. Dark selection | Today, Upload and Calendar/Samples use a clearly raised selected surface. | today-rings, today-walk, tiktok-client-ready, calendar-sheet, samples-sheet |
| 6. Calendar/Samples segments | Equal centred segments contain the Review count. | calendar-sheet, samples-sheet |
| 7. Workload | Legend counts have their own spacing; undated tasks have a comfortable section. | workload-week |
| 8. Analytics detail | Gains labels, dots and dates are readable; the stray divider is removed. | analytics-detail |
| 9. Linear | Short phone breadcrumbs and inset panels avoid clipped icons and edge contact. Detail keeps Back and the issue ID. | linear-list, linear-detail |
| 10. Upload | Queue tabs fit one row, options wrap naturally, and browse wording says tap. | tiktok-client-ready |
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

Verification is being completed before publication. Exact check output,
desktop comparisons and the refreshed PTO evidence will be recorded here.
Physical phones and a deployed version of this branch have not been tested.
