# Staff phone state inventory

All rows use the generated native app and intercepted fictional transports. Every rendered overlay receives geometry and trusted touch/wheel background scroll checks. No captures or backend data are published.

The catalogue result is a composite: 460 passing rows from the full run plus four passing client-picker rows after correcting its retired selector. The full run remains recorded as exit 1 with four setup timeouts. This is not a claim that that standalone run was green.

## Rule matrix: 160 passing states on final source

| State | Controls checked | Active surface |
| --- | ---: | --- |
| today-light-390 | 3 | `body` |
| today-light-390-tabs | 12 | `dialog[open]` |
| today-light-390-more | 8 | `dialog[open]` |
| today-dark-390 | 3 | `body` |
| today-dark-390-tabs | 12 | `dialog[open]` |
| today-dark-390-more | 8 | `dialog[open]` |
| today-light-430 | 3 | `body` |
| today-light-430-tabs | 12 | `dialog[open]` |
| today-light-430-more | 8 | `dialog[open]` |
| today-dark-430 | 3 | `body` |
| today-dark-430-tabs | 12 | `dialog[open]` |
| today-dark-430-more | 8 | `dialog[open]` |
| calendar-light-390 | 34 | `body` |
| calendar-light-390-tabs | 12 | `dialog[open]` |
| calendar-light-390-more | 18 | `dialog[open]` |
| calendar-light-390-caption-open | 34 | `body` |
| calendar-light-390-set-all | 9 | `div.cal-fld-status-menu.open` |
| calendar-light-390-color | 5 | `div.cal-card-color-picker.is-open` |
| calendar-light-390-empty-caption | 32 | `body` |
| calendar-dark-390 | 34 | `body` |
| calendar-dark-390-tabs | 12 | `dialog[open]` |
| calendar-dark-390-more | 18 | `dialog[open]` |
| calendar-dark-390-caption-open | 34 | `body` |
| calendar-dark-390-set-all | 9 | `div.cal-fld-status-menu.open` |
| calendar-dark-390-color | 5 | `div.cal-card-color-picker.is-open` |
| calendar-dark-390-empty-caption | 32 | `body` |
| calendar-light-430 | 34 | `body` |
| calendar-light-430-tabs | 12 | `dialog[open]` |
| calendar-light-430-more | 18 | `dialog[open]` |
| calendar-light-430-caption-open | 34 | `body` |
| calendar-light-430-set-all | 9 | `div.cal-fld-status-menu.open` |
| calendar-light-430-color | 5 | `div.cal-card-color-picker.is-open` |
| calendar-light-430-empty-caption | 32 | `body` |
| calendar-dark-430 | 34 | `body` |
| calendar-dark-430-tabs | 12 | `dialog[open]` |
| calendar-dark-430-more | 18 | `dialog[open]` |
| calendar-dark-430-caption-open | 34 | `body` |
| calendar-dark-430-set-all | 9 | `div.cal-fld-status-menu.open` |
| calendar-dark-430-color | 5 | `div.cal-card-color-picker.is-open` |
| calendar-dark-430-empty-caption | 32 | `body` |
| sample-reviews-light-390 | 19 | `body` |
| sample-reviews-light-390-tabs | 12 | `dialog[open]` |
| sample-reviews-light-390-more | 12 | `dialog[open]` |
| sample-reviews-dark-390 | 19 | `body` |
| sample-reviews-dark-390-tabs | 12 | `dialog[open]` |
| sample-reviews-dark-390-more | 12 | `dialog[open]` |
| sample-reviews-light-430 | 19 | `body` |
| sample-reviews-light-430-tabs | 12 | `dialog[open]` |
| sample-reviews-light-430-more | 12 | `dialog[open]` |
| sample-reviews-dark-430 | 19 | `body` |
| sample-reviews-dark-430-tabs | 12 | `dialog[open]` |
| sample-reviews-dark-430-more | 12 | `dialog[open]` |
| templates-light-390 | 5 | `body` |
| templates-light-390-tabs | 12 | `dialog[open]` |
| templates-light-390-more | 8 | `dialog[open]` |
| templates-dark-390 | 5 | `body` |
| templates-dark-390-tabs | 12 | `dialog[open]` |
| templates-dark-390-more | 8 | `dialog[open]` |
| templates-light-430 | 5 | `body` |
| templates-light-430-tabs | 12 | `dialog[open]` |
| templates-light-430-more | 8 | `dialog[open]` |
| templates-dark-430 | 5 | `body` |
| templates-dark-430-tabs | 12 | `dialog[open]` |
| templates-dark-430-more | 8 | `dialog[open]` |
| filming-plans-light-390 | 12 | `body` |
| filming-plans-light-390-tabs | 12 | `dialog[open]` |
| filming-plans-light-390-more | 8 | `dialog[open]` |
| filming-plans-dark-390 | 12 | `body` |
| filming-plans-dark-390-tabs | 12 | `dialog[open]` |
| filming-plans-dark-390-more | 8 | `dialog[open]` |
| filming-plans-light-430 | 12 | `body` |
| filming-plans-light-430-tabs | 12 | `dialog[open]` |
| filming-plans-light-430-more | 8 | `dialog[open]` |
| filming-plans-dark-430 | 12 | `body` |
| filming-plans-dark-430-tabs | 12 | `dialog[open]` |
| filming-plans-dark-430-more | 8 | `dialog[open]` |
| tiktok-upload-light-390 | 14 | `body` |
| tiktok-upload-light-390-tabs | 12 | `dialog[open]` |
| tiktok-upload-light-390-more | 8 | `dialog[open]` |
| tiktok-upload-dark-390 | 14 | `body` |
| tiktok-upload-dark-390-tabs | 12 | `dialog[open]` |
| tiktok-upload-dark-390-more | 8 | `dialog[open]` |
| tiktok-upload-light-430 | 14 | `body` |
| tiktok-upload-light-430-tabs | 12 | `dialog[open]` |
| tiktok-upload-light-430-more | 8 | `dialog[open]` |
| tiktok-upload-dark-430 | 14 | `body` |
| tiktok-upload-dark-430-tabs | 12 | `dialog[open]` |
| tiktok-upload-dark-430-more | 8 | `dialog[open]` |
| home-light-390 | 9 | `body` |
| home-light-390-tabs | 12 | `dialog[open]` |
| home-light-390-more | 8 | `dialog[open]` |
| home-dark-390 | 9 | `body` |
| home-dark-390-tabs | 12 | `dialog[open]` |
| home-dark-390-more | 8 | `dialog[open]` |
| home-light-430 | 9 | `body` |
| home-light-430-tabs | 12 | `dialog[open]` |
| home-light-430-more | 8 | `dialog[open]` |
| home-dark-430 | 9 | `body` |
| home-dark-430-tabs | 12 | `dialog[open]` |
| home-dark-430-more | 8 | `dialog[open]` |
| workload-light-390 | 15 | `body` |
| workload-light-390-tabs | 12 | `dialog[open]` |
| workload-light-390-more | 8 | `dialog[open]` |
| workload-dark-390 | 15 | `body` |
| workload-dark-390-tabs | 12 | `dialog[open]` |
| workload-dark-390-more | 8 | `dialog[open]` |
| workload-light-430 | 15 | `body` |
| workload-light-430-tabs | 12 | `dialog[open]` |
| workload-light-430-more | 8 | `dialog[open]` |
| workload-dark-430 | 15 | `body` |
| workload-dark-430-tabs | 12 | `dialog[open]` |
| workload-dark-430-more | 8 | `dialog[open]` |
| production-light-390 | 11 | `body` |
| production-light-390-tabs | 12 | `dialog[open]` |
| production-light-390-more | 15 | `dialog[open]` |
| production-dark-390 | 11 | `body` |
| production-dark-390-tabs | 12 | `dialog[open]` |
| production-dark-390-more | 15 | `dialog[open]` |
| production-light-430 | 11 | `body` |
| production-light-430-tabs | 12 | `dialog[open]` |
| production-light-430-more | 15 | `dialog[open]` |
| production-dark-430 | 11 | `body` |
| production-dark-430-tabs | 12 | `dialog[open]` |
| production-dark-430-more | 15 | `dialog[open]` |
| linear-light-390 | 13 | `body` |
| linear-light-390-tabs | 12 | `dialog[open]` |
| linear-light-390-more | 8 | `dialog[open]` |
| linear-dark-390 | 13 | `body` |
| linear-dark-390-tabs | 12 | `dialog[open]` |
| linear-dark-390-more | 8 | `dialog[open]` |
| linear-light-430 | 13 | `body` |
| linear-light-430-tabs | 12 | `dialog[open]` |
| linear-light-430-more | 8 | `dialog[open]` |
| linear-dark-430 | 13 | `body` |
| linear-dark-430-tabs | 12 | `dialog[open]` |
| linear-dark-430-more | 8 | `dialog[open]` |
| kasper-light-390 | 5 | `body` |
| kasper-light-390-tabs | 15 | `dialog[open]` |
| kasper-light-390-more | 10 | `#kasperMoreMenu` |
| kasper-dark-390 | 5 | `body` |
| kasper-dark-390-tabs | 15 | `dialog[open]` |
| kasper-dark-390-more | 10 | `#kasperMoreMenu` |
| kasper-light-430 | 5 | `body` |
| kasper-light-430-tabs | 15 | `dialog[open]` |
| kasper-light-430-more | 10 | `#kasperMoreMenu` |
| kasper-dark-430 | 5 | `body` |
| kasper-dark-430-tabs | 15 | `dialog[open]` |
| kasper-dark-430-more | 10 | `#kasperMoreMenu` |
| time-off-light-390 | 9 | `body` |
| time-off-light-390-tabs | 12 | `dialog[open]` |
| time-off-light-390-more | 8 | `dialog[open]` |
| time-off-dark-390 | 9 | `body` |
| time-off-dark-390-tabs | 12 | `dialog[open]` |
| time-off-dark-390-more | 8 | `dialog[open]` |
| time-off-light-430 | 9 | `body` |
| time-off-light-430-tabs | 12 | `dialog[open]` |
| time-off-light-430-more | 8 | `dialog[open]` |
| time-off-dark-430 | 9 | `body` |
| time-off-dark-430-tabs | 12 | `dialog[open]` |
| time-off-dark-430-more | 8 | `dialog[open]` |

## Complete known catalogue: 464 passing state receipts

| State | Width | Theme | Result source |
| --- | ---: | --- | --- |
| analytics-brief | 390 | dark | full run |
| analytics-brief | 390 | light | full run |
| analytics-brief | 430 | dark | full run |
| analytics-brief | 430 | light | full run |
| analytics-client-picker | 390 | dark | full run |
| analytics-client-picker | 390 | light | full run |
| analytics-client-picker | 430 | dark | full run |
| analytics-client-picker | 430 | light | full run |
| analytics-content-calendar | 390 | dark | full run |
| analytics-content-calendar | 390 | light | full run |
| analytics-content-calendar | 430 | dark | full run |
| analytics-content-calendar | 430 | light | full run |
| analytics-detail | 390 | dark | full run |
| analytics-detail | 390 | light | full run |
| analytics-detail | 430 | dark | full run |
| analytics-detail | 430 | light | full run |
| analytics-detail-dash | 390 | dark | full run |
| analytics-detail-dash | 390 | light | full run |
| analytics-detail-dash | 430 | dark | full run |
| analytics-detail-dash | 430 | light | full run |
| analytics-empty | 390 | dark | full run |
| analytics-empty | 390 | light | full run |
| analytics-empty | 430 | dark | full run |
| analytics-empty | 430 | light | full run |
| analytics-error | 390 | dark | full run |
| analytics-error | 390 | light | full run |
| analytics-error | 430 | dark | full run |
| analytics-error | 430 | light | full run |
| analytics-grid | 390 | dark | full run |
| analytics-grid | 390 | light | full run |
| analytics-grid | 430 | dark | full run |
| analytics-grid | 430 | light | full run |
| analytics-loading | 390 | dark | full run |
| analytics-loading | 390 | light | full run |
| analytics-loading | 430 | dark | full run |
| analytics-loading | 430 | light | full run |
| analytics-overview | 390 | dark | full run |
| analytics-overview | 390 | light | full run |
| analytics-overview | 430 | dark | full run |
| analytics-overview | 430 | light | full run |
| analytics-pin | 390 | dark | full run |
| analytics-pin | 390 | light | full run |
| analytics-pin | 430 | dark | full run |
| analytics-pin | 430 | light | full run |
| analytics-search | 390 | dark | full run |
| analytics-search | 390 | light | full run |
| analytics-search | 430 | dark | full run |
| analytics-search | 430 | light | full run |
| analytics-week | 390 | dark | full run |
| analytics-week | 390 | light | full run |
| analytics-week | 430 | dark | full run |
| analytics-week | 430 | light | full run |
| calendar-empty | 390 | dark | full run |
| calendar-empty | 390 | light | full run |
| calendar-empty | 430 | dark | full run |
| calendar-empty | 430 | light | full run |
| calendar-more | 390 | dark | full run |
| calendar-more | 390 | light | full run |
| calendar-more | 430 | dark | full run |
| calendar-more | 430 | light | full run |
| calendar-sheet | 390 | dark | full run |
| calendar-sheet | 390 | light | full run |
| calendar-sheet | 430 | dark | full run |
| calendar-sheet | 430 | light | full run |
| calendar-tabs | 390 | dark | full run |
| calendar-tabs | 390 | light | full run |
| calendar-tabs | 430 | dark | full run |
| calendar-tabs | 430 | light | full run |
| client-picker | 390 | dark | corrected focused run |
| client-picker | 390 | light | corrected focused run |
| client-picker | 430 | dark | corrected focused run |
| client-picker | 430 | light | corrected focused run |
| filming-add | 390 | dark | full run |
| filming-add | 390 | light | full run |
| filming-add | 430 | dark | full run |
| filming-add | 430 | light | full run |
| filming-edit | 390 | dark | full run |
| filming-edit | 390 | light | full run |
| filming-edit | 430 | dark | full run |
| filming-edit | 430 | light | full run |
| filming-empty | 390 | dark | full run |
| filming-empty | 390 | light | full run |
| filming-empty | 430 | dark | full run |
| filming-empty | 430 | light | full run |
| filming-error | 390 | dark | full run |
| filming-error | 390 | light | full run |
| filming-error | 430 | dark | full run |
| filming-error | 430 | light | full run |
| filming-list | 390 | dark | full run |
| filming-list | 390 | light | full run |
| filming-list | 430 | dark | full run |
| filming-list | 430 | light | full run |
| filming-loading | 390 | dark | full run |
| filming-loading | 390 | light | full run |
| filming-loading | 430 | dark | full run |
| filming-loading | 430 | light | full run |
| filming-saved-note | 390 | dark | full run |
| filming-saved-note | 390 | light | full run |
| filming-saved-note | 430 | dark | full run |
| filming-saved-note | 430 | light | full run |
| filming-search-none | 390 | dark | full run |
| filming-search-none | 390 | light | full run |
| filming-search-none | 430 | dark | full run |
| filming-search-none | 430 | light | full run |
| instagram-client-ready | 390 | dark | full run |
| instagram-client-ready | 390 | light | full run |
| instagram-client-ready | 430 | dark | full run |
| instagram-client-ready | 430 | light | full run |
| instagram-empty | 390 | dark | full run |
| instagram-empty | 390 | light | full run |
| instagram-empty | 430 | dark | full run |
| instagram-empty | 430 | light | full run |
| instagram-frame-cover | 390 | dark | full run |
| instagram-frame-cover | 390 | light | full run |
| instagram-frame-cover | 430 | dark | full run |
| instagram-frame-cover | 430 | light | full run |
| instagram-queue | 390 | dark | full run |
| instagram-queue | 390 | light | full run |
| instagram-queue | 430 | dark | full run |
| instagram-queue | 430 | light | full run |
| linear-assignee-picker | 390 | dark | full run |
| linear-assignee-picker | 390 | light | full run |
| linear-assignee-picker | 430 | dark | full run |
| linear-assignee-picker | 430 | light | full run |
| linear-backlog | 390 | dark | full run |
| linear-backlog | 390 | light | full run |
| linear-backlog | 430 | dark | full run |
| linear-backlog | 430 | light | full run |
| linear-client-picker | 390 | dark | full run |
| linear-client-picker | 390 | light | full run |
| linear-client-picker | 430 | dark | full run |
| linear-client-picker | 430 | light | full run |
| linear-detail | 390 | dark | full run |
| linear-detail | 390 | light | full run |
| linear-detail | 430 | dark | full run |
| linear-detail | 430 | light | full run |
| linear-display | 390 | dark | full run |
| linear-display | 390 | light | full run |
| linear-display | 430 | dark | full run |
| linear-display | 430 | light | full run |
| linear-due-picker | 390 | dark | full run |
| linear-due-picker | 390 | light | full run |
| linear-due-picker | 430 | dark | full run |
| linear-due-picker | 430 | light | full run |
| linear-empty | 390 | dark | full run |
| linear-empty | 390 | light | full run |
| linear-empty | 430 | dark | full run |
| linear-empty | 430 | light | full run |
| linear-error | 390 | dark | full run |
| linear-error | 390 | light | full run |
| linear-error | 430 | dark | full run |
| linear-error | 430 | light | full run |
| linear-filter | 390 | dark | full run |
| linear-filter | 390 | light | full run |
| linear-filter | 430 | dark | full run |
| linear-filter | 430 | light | full run |
| linear-list | 390 | dark | full run |
| linear-list | 390 | light | full run |
| linear-list | 430 | dark | full run |
| linear-list | 430 | light | full run |
| linear-loading | 390 | dark | full run |
| linear-loading | 390 | light | full run |
| linear-loading | 430 | dark | full run |
| linear-loading | 430 | light | full run |
| linear-more | 390 | dark | full run |
| linear-more | 390 | light | full run |
| linear-more | 430 | dark | full run |
| linear-more | 430 | light | full run |
| linear-project | 390 | dark | full run |
| linear-project | 390 | light | full run |
| linear-project | 430 | dark | full run |
| linear-project | 430 | light | full run |
| linear-search | 390 | dark | full run |
| linear-search | 390 | light | full run |
| linear-search | 430 | dark | full run |
| linear-search | 430 | light | full run |
| linear-status-picker | 390 | dark | full run |
| linear-status-picker | 390 | light | full run |
| linear-status-picker | 430 | dark | full run |
| linear-status-picker | 430 | light | full run |
| menu-client | 390 | dark | full run |
| menu-client | 390 | light | full run |
| menu-client | 430 | dark | full run |
| menu-client | 430 | light | full run |
| menu-more | 390 | dark | full run |
| menu-more | 390 | light | full run |
| menu-more | 430 | dark | full run |
| menu-more | 430 | light | full run |
| menu-tabs | 390 | dark | full run |
| menu-tabs | 390 | light | full run |
| menu-tabs | 430 | dark | full run |
| menu-tabs | 430 | light | full run |
| samples-empty | 390 | dark | full run |
| samples-empty | 390 | light | full run |
| samples-empty | 430 | dark | full run |
| samples-empty | 430 | light | full run |
| samples-more | 390 | dark | full run |
| samples-more | 390 | light | full run |
| samples-more | 430 | dark | full run |
| samples-more | 430 | light | full run |
| samples-sheet | 390 | dark | full run |
| samples-sheet | 390 | light | full run |
| samples-sheet | 430 | dark | full run |
| samples-sheet | 430 | light | full run |
| samples-tabs | 390 | dark | full run |
| samples-tabs | 390 | light | full run |
| samples-tabs | 430 | dark | full run |
| samples-tabs | 430 | light | full run |
| sheet-more | 390 | dark | full run |
| sheet-more | 390 | light | full run |
| sheet-more | 430 | dark | full run |
| sheet-more | 430 | light | full run |
| sheet-more-templates | 390 | dark | full run |
| sheet-more-templates | 390 | light | full run |
| sheet-more-templates | 430 | dark | full run |
| sheet-more-templates | 430 | light | full run |
| sheet-tabs | 390 | dark | full run |
| sheet-tabs | 390 | light | full run |
| sheet-tabs | 430 | dark | full run |
| sheet-tabs | 430 | light | full run |
| submit | 390 | dark | full run |
| submit | 390 | light | full run |
| submit | 430 | dark | full run |
| submit | 430 | light | full run |
| submit-add-video | 390 | dark | full run |
| submit-add-video | 390 | light | full run |
| submit-add-video | 430 | dark | full run |
| submit-add-video | 430 | light | full run |
| submit-banner | 390 | dark | full run |
| submit-banner | 390 | light | full run |
| submit-banner | 430 | dark | full run |
| submit-banner | 430 | light | full run |
| submit-client-chosen | 390 | dark | full run |
| submit-client-chosen | 390 | light | full run |
| submit-client-chosen | 430 | dark | full run |
| submit-client-chosen | 430 | light | full run |
| submit-client-menu | 390 | dark | full run |
| submit-client-menu | 390 | light | full run |
| submit-client-menu | 430 | dark | full run |
| submit-client-menu | 430 | light | full run |
| submit-filled | 390 | dark | full run |
| submit-filled | 390 | light | full run |
| submit-filled | 430 | dark | full run |
| submit-filled | 430 | light | full run |
| submit-no-match | 390 | dark | full run |
| submit-no-match | 390 | light | full run |
| submit-no-match | 430 | dark | full run |
| submit-no-match | 430 | light | full run |
| submit-saved-box | 390 | dark | full run |
| submit-saved-box | 390 | light | full run |
| submit-saved-box | 430 | dark | full run |
| submit-saved-box | 430 | light | full run |
| submit-status | 390 | dark | full run |
| submit-status | 390 | light | full run |
| submit-status | 430 | dark | full run |
| submit-status | 430 | light | full run |
| templates-client | 390 | dark | full run |
| templates-client | 390 | light | full run |
| templates-client | 430 | dark | full run |
| templates-client | 430 | light | full run |
| templates-client-brain-error | 390 | dark | full run |
| templates-client-brain-error | 390 | light | full run |
| templates-client-brain-error | 430 | dark | full run |
| templates-client-brain-error | 430 | light | full run |
| templates-client-brief-menu | 390 | dark | full run |
| templates-client-brief-menu | 390 | light | full run |
| templates-client-brief-menu | 430 | dark | full run |
| templates-client-brief-menu | 430 | light | full run |
| templates-client-change-box | 390 | dark | full run |
| templates-client-change-box | 390 | light | full run |
| templates-client-change-box | 430 | dark | full run |
| templates-client-change-box | 430 | light | full run |
| templates-client-edit | 390 | dark | full run |
| templates-client-edit | 390 | light | full run |
| templates-client-edit | 430 | dark | full run |
| templates-client-edit | 430 | light | full run |
| templates-client-empty | 390 | dark | full run |
| templates-client-empty | 390 | light | full run |
| templates-client-empty | 430 | dark | full run |
| templates-client-empty | 430 | light | full run |
| templates-client-facts | 390 | dark | full run |
| templates-client-facts | 390 | light | full run |
| templates-client-facts | 430 | dark | full run |
| templates-client-facts | 430 | light | full run |
| templates-client-links-many | 390 | dark | full run |
| templates-client-links-many | 390 | light | full run |
| templates-client-links-many | 430 | dark | full run |
| templates-client-links-many | 430 | light | full run |
| templates-client-loading | 390 | dark | full run |
| templates-client-loading | 390 | light | full run |
| templates-client-loading | 430 | dark | full run |
| templates-client-loading | 430 | light | full run |
| templates-client-spec-form | 390 | dark | full run |
| templates-client-spec-form | 390 | light | full run |
| templates-client-spec-form | 430 | dark | full run |
| templates-client-spec-form | 430 | light | full run |
| templates-index | 390 | dark | full run |
| templates-index | 390 | light | full run |
| templates-index | 430 | dark | full run |
| templates-index | 430 | light | full run |
| templates-index-error | 390 | dark | full run |
| templates-index-error | 390 | light | full run |
| templates-index-error | 430 | dark | full run |
| templates-index-error | 430 | light | full run |
| templates-index-pin-picker | 390 | dark | full run |
| templates-index-pin-picker | 390 | light | full run |
| templates-index-pin-picker | 430 | dark | full run |
| templates-index-pin-picker | 430 | light | full run |
| templates-index-pins | 390 | dark | full run |
| templates-index-pins | 390 | light | full run |
| templates-index-pins | 430 | dark | full run |
| templates-index-pins | 430 | light | full run |
| templates-index-pins-edit | 390 | dark | full run |
| templates-index-pins-edit | 390 | light | full run |
| templates-index-pins-edit | 430 | dark | full run |
| templates-index-pins-edit | 430 | light | full run |
| templates-index-search | 390 | dark | full run |
| templates-index-search | 390 | light | full run |
| templates-index-search | 430 | dark | full run |
| templates-index-search | 430 | light | full run |
| tiktok-cancel-confirm | 390 | dark | full run |
| tiktok-cancel-confirm | 390 | light | full run |
| tiktok-cancel-confirm | 430 | dark | full run |
| tiktok-cancel-confirm | 430 | light | full run |
| tiktok-client-ready | 390 | dark | full run |
| tiktok-client-ready | 390 | light | full run |
| tiktok-client-ready | 430 | dark | full run |
| tiktok-client-ready | 430 | light | full run |
| tiktok-empty | 390 | dark | full run |
| tiktok-empty | 390 | light | full run |
| tiktok-empty | 430 | dark | full run |
| tiktok-empty | 430 | light | full run |
| tiktok-no-account | 390 | dark | full run |
| tiktok-no-account | 390 | light | full run |
| tiktok-no-account | 430 | dark | full run |
| tiktok-no-account | 430 | light | full run |
| tiktok-options | 390 | dark | full run |
| tiktok-options | 390 | light | full run |
| tiktok-options | 430 | dark | full run |
| tiktok-options | 430 | light | full run |
| tiktok-photos-attached | 390 | dark | full run |
| tiktok-photos-attached | 390 | light | full run |
| tiktok-photos-attached | 430 | dark | full run |
| tiktok-photos-attached | 430 | light | full run |
| tiktok-photos-empty | 390 | dark | full run |
| tiktok-photos-empty | 390 | light | full run |
| tiktok-photos-empty | 430 | dark | full run |
| tiktok-photos-empty | 430 | light | full run |
| tiktok-post-error | 390 | dark | full run |
| tiktok-post-error | 390 | light | full run |
| tiktok-post-error | 430 | dark | full run |
| tiktok-post-error | 430 | light | full run |
| tiktok-posting | 390 | dark | full run |
| tiktok-posting | 390 | light | full run |
| tiktok-posting | 430 | dark | full run |
| tiktok-posting | 430 | light | full run |
| tiktok-queue-done | 390 | dark | full run |
| tiktok-queue-done | 390 | light | full run |
| tiktok-queue-done | 430 | dark | full run |
| tiktok-queue-done | 430 | light | full run |
| tiktok-queue-error | 390 | dark | full run |
| tiktok-queue-error | 390 | light | full run |
| tiktok-queue-error | 430 | dark | full run |
| tiktok-queue-error | 430 | light | full run |
| tiktok-queue-failed | 390 | dark | full run |
| tiktok-queue-failed | 390 | light | full run |
| tiktok-queue-failed | 430 | dark | full run |
| tiktok-queue-failed | 430 | light | full run |
| tiktok-queue-loading | 390 | dark | full run |
| tiktok-queue-loading | 390 | light | full run |
| tiktok-queue-loading | 430 | dark | full run |
| tiktok-queue-loading | 430 | light | full run |
| tiktok-queue-upcoming | 390 | dark | full run |
| tiktok-queue-upcoming | 390 | light | full run |
| tiktok-queue-upcoming | 430 | dark | full run |
| tiktok-queue-upcoming | 430 | light | full run |
| tiktok-schedule | 390 | dark | full run |
| tiktok-schedule | 390 | light | full run |
| tiktok-schedule | 430 | dark | full run |
| tiktok-schedule | 430 | light | full run |
| tiktok-video-attached | 390 | dark | full run |
| tiktok-video-attached | 390 | light | full run |
| tiktok-video-attached | 430 | dark | full run |
| tiktok-video-attached | 430 | light | full run |
| today-all-clear | 390 | dark | full run |
| today-all-clear | 390 | light | full run |
| today-all-clear | 430 | dark | full run |
| today-all-clear | 430 | light | full run |
| today-cleared | 390 | dark | full run |
| today-cleared | 390 | light | full run |
| today-cleared | 430 | dark | full run |
| today-cleared | 430 | light | full run |
| today-editor-all-clear | 390 | dark | full run |
| today-editor-all-clear | 390 | light | full run |
| today-editor-all-clear | 430 | dark | full run |
| today-editor-all-clear | 430 | light | full run |
| today-editor-deck | 390 | dark | full run |
| today-editor-deck | 390 | light | full run |
| today-editor-deck | 430 | dark | full run |
| today-editor-deck | 430 | light | full run |
| today-editor-list | 390 | dark | full run |
| today-editor-list | 390 | light | full run |
| today-editor-list | 430 | dark | full run |
| today-editor-list | 430 | light | full run |
| today-error | 390 | dark | full run |
| today-error | 390 | light | full run |
| today-error | 430 | dark | full run |
| today-error | 430 | light | full run |
| today-loading | 390 | dark | full run |
| today-loading | 390 | light | full run |
| today-loading | 430 | dark | full run |
| today-loading | 430 | light | full run |
| today-ring-open | 390 | dark | full run |
| today-ring-open | 390 | light | full run |
| today-ring-open | 430 | dark | full run |
| today-ring-open | 430 | light | full run |
| today-rings | 390 | dark | full run |
| today-rings | 390 | light | full run |
| today-rings | 430 | dark | full run |
| today-rings | 430 | light | full run |
| today-walk | 390 | dark | full run |
| today-walk | 390 | light | full run |
| today-walk | 430 | dark | full run |
| today-walk | 430 | light | full run |
| workload-client-picker | 390 | dark | full run |
| workload-client-picker | 390 | light | full run |
| workload-client-picker | 430 | dark | full run |
| workload-client-picker | 430 | light | full run |
| workload-clients-search | 390 | dark | full run |
| workload-clients-search | 390 | light | full run |
| workload-clients-search | 430 | dark | full run |
| workload-clients-search | 430 | light | full run |
| workload-editors-menu | 390 | dark | full run |
| workload-editors-menu | 390 | light | full run |
| workload-editors-menu | 430 | dark | full run |
| workload-editors-menu | 430 | light | full run |
| workload-empty | 390 | dark | full run |
| workload-empty | 390 | light | full run |
| workload-empty | 430 | dark | full run |
| workload-empty | 430 | light | full run |
| workload-error | 390 | dark | full run |
| workload-error | 390 | light | full run |
| workload-error | 430 | dark | full run |
| workload-error | 430 | light | full run |
| workload-loading | 390 | dark | full run |
| workload-loading | 390 | light | full run |
| workload-loading | 430 | dark | full run |
| workload-loading | 430 | light | full run |
| workload-month | 390 | dark | full run |
| workload-month | 390 | light | full run |
| workload-month | 430 | dark | full run |
| workload-month | 430 | light | full run |
| workload-plan-due | 390 | dark | full run |
| workload-plan-due | 390 | light | full run |
| workload-plan-due | 430 | dark | full run |
| workload-plan-due | 430 | light | full run |
| workload-popover | 390 | dark | full run |
| workload-popover | 390 | light | full run |
| workload-popover | 430 | dark | full run |
| workload-popover | 430 | light | full run |
| workload-week | 390 | dark | full run |
| workload-week | 390 | light | full run |
| workload-week | 430 | dark | full run |
| workload-week | 430 | light | full run |

## Reviewer and admin: 252 passing states, 4652 assertions

| State | Width | Theme |
| --- | ---: | --- |
| review-empty | 390 | light |
| review-queue | 390 | light |
| review-open | 390 | light |
| review-finish-ready | 390 | light |
| review-single | 390 | light |
| review-unsaved | 390 | light |
| review-error | 390 | light |
| review-loading | 390 | light |
| messages-empty | 390 | light |
| messages | 390 | light |
| messages-compose | 390 | light |
| editors-empty | 390 | light |
| editors | 390 | light |
| editor-info | 390 | light |
| filming-empty | 390 | light |
| filming | 390 | light |
| filming-info | 390 | light |
| time-off-empty | 390 | light |
| time-off | 390 | light |
| time-off-error | 390 | light |
| sales-intake | 390 | light |
| hiring-empty | 390 | light |
| hiring | 390 | light |
| hiring-detail | 390 | light |
| hiring-error | 390 | light |
| onboarding-empty | 390 | light |
| credentials-empty | 390 | light |
| credentials | 390 | light |
| credentials-masked | 390 | light |
| credential-add | 390 | light |
| clients | 390 | light |
| client-detail | 390 | light |
| clients-error | 390 | light |
| quiz-empty | 390 | light |
| quiz | 390 | light |
| quiz-detail | 390 | light |
| quiz-error | 390 | light |
| ads-empty | 390 | light |
| ads | 390 | light |
| ads-error | 390 | light |
| save-problems-empty | 390 | light |
| save-problems | 390 | light |
| save-problems-error | 390 | light |
| more | 390 | light |
| tabs | 390 | light |
| tabs-client-picker | 390 | light |
| account | 390 | light |
| client-edit | 390 | light |
| credential-history | 390 | light |
| credential-platform | 390 | light |
| sales-date | 390 | light |
| sales-draft | 390 | light |
| review-note | 390 | light |
| review-lightbox | 390 | light |
| credentials-loading | 390 | light |
| quiz-loading | 390 | light |
| ads-loading | 390 | light |
| save-problems-loading | 390 | light |
| onboarding | 390 | light |
| onboarding-detail | 390 | light |
| onboarding-error | 390 | light |
| standalone-credentials | 390 | light |
| standalone-onboarding | 390 | light |
| review-empty | 390 | dark |
| review-queue | 390 | dark |
| review-open | 390 | dark |
| review-finish-ready | 390 | dark |
| review-single | 390 | dark |
| review-unsaved | 390 | dark |
| review-error | 390 | dark |
| review-loading | 390 | dark |
| messages-empty | 390 | dark |
| messages | 390 | dark |
| messages-compose | 390 | dark |
| editors-empty | 390 | dark |
| editors | 390 | dark |
| editor-info | 390 | dark |
| filming-empty | 390 | dark |
| filming | 390 | dark |
| filming-info | 390 | dark |
| time-off-empty | 390 | dark |
| time-off | 390 | dark |
| time-off-error | 390 | dark |
| sales-intake | 390 | dark |
| hiring-empty | 390 | dark |
| hiring | 390 | dark |
| hiring-detail | 390 | dark |
| hiring-error | 390 | dark |
| onboarding-empty | 390 | dark |
| credentials-empty | 390 | dark |
| credentials | 390 | dark |
| credentials-masked | 390 | dark |
| credential-add | 390 | dark |
| clients | 390 | dark |
| client-detail | 390 | dark |
| clients-error | 390 | dark |
| quiz-empty | 390 | dark |
| quiz | 390 | dark |
| quiz-detail | 390 | dark |
| quiz-error | 390 | dark |
| ads-empty | 390 | dark |
| ads | 390 | dark |
| ads-error | 390 | dark |
| save-problems-empty | 390 | dark |
| save-problems | 390 | dark |
| save-problems-error | 390 | dark |
| more | 390 | dark |
| tabs | 390 | dark |
| tabs-client-picker | 390 | dark |
| account | 390 | dark |
| client-edit | 390 | dark |
| credential-history | 390 | dark |
| credential-platform | 390 | dark |
| sales-date | 390 | dark |
| sales-draft | 390 | dark |
| review-note | 390 | dark |
| review-lightbox | 390 | dark |
| credentials-loading | 390 | dark |
| quiz-loading | 390 | dark |
| ads-loading | 390 | dark |
| save-problems-loading | 390 | dark |
| onboarding | 390 | dark |
| onboarding-detail | 390 | dark |
| onboarding-error | 390 | dark |
| standalone-credentials | 390 | dark |
| standalone-onboarding | 390 | dark |
| review-empty | 430 | light |
| review-queue | 430 | light |
| review-open | 430 | light |
| review-finish-ready | 430 | light |
| review-single | 430 | light |
| review-unsaved | 430 | light |
| review-error | 430 | light |
| review-loading | 430 | light |
| messages-empty | 430 | light |
| messages | 430 | light |
| messages-compose | 430 | light |
| editors-empty | 430 | light |
| editors | 430 | light |
| editor-info | 430 | light |
| filming-empty | 430 | light |
| filming | 430 | light |
| filming-info | 430 | light |
| time-off-empty | 430 | light |
| time-off | 430 | light |
| time-off-error | 430 | light |
| sales-intake | 430 | light |
| hiring-empty | 430 | light |
| hiring | 430 | light |
| hiring-detail | 430 | light |
| hiring-error | 430 | light |
| onboarding-empty | 430 | light |
| credentials-empty | 430 | light |
| credentials | 430 | light |
| credentials-masked | 430 | light |
| credential-add | 430 | light |
| clients | 430 | light |
| client-detail | 430 | light |
| clients-error | 430 | light |
| quiz-empty | 430 | light |
| quiz | 430 | light |
| quiz-detail | 430 | light |
| quiz-error | 430 | light |
| ads-empty | 430 | light |
| ads | 430 | light |
| ads-error | 430 | light |
| save-problems-empty | 430 | light |
| save-problems | 430 | light |
| save-problems-error | 430 | light |
| more | 430 | light |
| tabs | 430 | light |
| tabs-client-picker | 430 | light |
| account | 430 | light |
| client-edit | 430 | light |
| credential-history | 430 | light |
| credential-platform | 430 | light |
| sales-date | 430 | light |
| sales-draft | 430 | light |
| review-note | 430 | light |
| review-lightbox | 430 | light |
| credentials-loading | 430 | light |
| quiz-loading | 430 | light |
| ads-loading | 430 | light |
| save-problems-loading | 430 | light |
| onboarding | 430 | light |
| onboarding-detail | 430 | light |
| onboarding-error | 430 | light |
| standalone-credentials | 430 | light |
| standalone-onboarding | 430 | light |
| review-empty | 430 | dark |
| review-queue | 430 | dark |
| review-open | 430 | dark |
| review-finish-ready | 430 | dark |
| review-single | 430 | dark |
| review-unsaved | 430 | dark |
| review-error | 430 | dark |
| review-loading | 430 | dark |
| messages-empty | 430 | dark |
| messages | 430 | dark |
| messages-compose | 430 | dark |
| editors-empty | 430 | dark |
| editors | 430 | dark |
| editor-info | 430 | dark |
| filming-empty | 430 | dark |
| filming | 430 | dark |
| filming-info | 430 | dark |
| time-off-empty | 430 | dark |
| time-off | 430 | dark |
| time-off-error | 430 | dark |
| sales-intake | 430 | dark |
| hiring-empty | 430 | dark |
| hiring | 430 | dark |
| hiring-detail | 430 | dark |
| hiring-error | 430 | dark |
| onboarding-empty | 430 | dark |
| credentials-empty | 430 | dark |
| credentials | 430 | dark |
| credentials-masked | 430 | dark |
| credential-add | 430 | dark |
| clients | 430 | dark |
| client-detail | 430 | dark |
| clients-error | 430 | dark |
| quiz-empty | 430 | dark |
| quiz | 430 | dark |
| quiz-detail | 430 | dark |
| quiz-error | 430 | dark |
| ads-empty | 430 | dark |
| ads | 430 | dark |
| ads-error | 430 | dark |
| save-problems-empty | 430 | dark |
| save-problems | 430 | dark |
| save-problems-error | 430 | dark |
| more | 430 | dark |
| tabs | 430 | dark |
| tabs-client-picker | 430 | dark |
| account | 430 | dark |
| client-edit | 430 | dark |
| credential-history | 430 | dark |
| credential-platform | 430 | dark |
| sales-date | 430 | dark |
| sales-draft | 430 | dark |
| review-note | 430 | dark |
| review-lightbox | 430 | dark |
| credentials-loading | 430 | dark |
| quiz-loading | 430 | dark |
| ads-loading | 430 | dark |
| save-problems-loading | 430 | dark |
| onboarding | 430 | dark |
| onboarding-detail | 430 | dark |
| onboarding-error | 430 | dark |
| standalone-credentials | 430 | dark |
| standalone-onboarding | 430 | dark |

## Final desktop parity: 72 passing pair receipts

The unmodified repository gate compared the final generated source with main `7f83b323`. The four-worker full invocation exits 1 at 70/72: Filming at 1280 and reviewer at 1024 have pixel differences with identical computed styles. Both pairs pass the same gate when repeated separately with one worker (1/1 each). The table combines those final-source receipts; it does not relabel the full invocation as a pass. The earlier source passed a standalone serial 72/72 gate against `672b5a4d`; that base and `7f83b323` have identical UI files. No parity assertion or threshold was changed.

| Page | Width | PNG SHA-256 (before = after) | Computed styles | Invocation |
| --- | ---: | --- | --- | --- |
| staff-navToday | 1024 | `6798827bd769866294371212f40c2ef82ea4c6937705ac7580976e0501e98b5b` | identical | full parallel |
| staff-navToday | 1280 | `dda661e0c800cd14df6f223e88464afd38e483717cd2429eb4ede3173d6e9c1e` | identical | full parallel |
| staff-navToday | 1440 | `c286e1d82635756ce123931b7075848c97aa2fac8260d36a99875f6ee782b2b7` | identical | full parallel |
| staff-navToday | 1920 | `7bc9e7d7723749d1bc955eff12ef52b81be1837dec233f49a004c34f4aa168cb` | identical | full parallel |
| staff-navCalendar | 1024 | `b292d80e30d85ab1c021d6765cbe34ab9a2d5106b6e249039a55d2fc3d51f331` | identical | full parallel |
| staff-navCalendar | 1280 | `35f1c6e299e87c759d882791c9217b1be2585e0f749120a7f9bb325269b07394` | identical | full parallel |
| staff-navCalendar | 1440 | `7e8a04160f7ddf8faf4ee4534d03c9198d17160a9650351d058929ff051c986a` | identical | full parallel |
| staff-navCalendar | 1920 | `3515bba69a1b29b5bf18b269a010a0b494724c54ec03cb1009a4aa32da1e2229` | identical | full parallel |
| staff-navSxr | 1024 | `8e209974f2298cececb3111612d3f263f1bcdaa994855d5160b7f7be979b7304` | identical | full parallel |
| staff-navSxr | 1280 | `ed0eb621f6305645fb6a94ac20304c5a3a6ba63c3037c7ffb4948cc30f3541ad` | identical | full parallel |
| staff-navSxr | 1440 | `ce5f7c0387a5842f289c1923079bd55a1fbd21aa9465de3337cdb3e74841fbdd` | identical | full parallel |
| staff-navSxr | 1920 | `d64380c21ad5bf16e8e53a5be6646d6d40f0cdcf8e452a542f3142033faa3094` | identical | full parallel |
| staff-navTemplates | 1024 | `f26a5c2834115a03065750fc40b0c941c605e4d31af261bde6979052acb200a1` | identical | full parallel |
| staff-navTemplates | 1280 | `624f286675a03d9be84815aa8b37c8e7a8bd13a5d8c96e16a248f33634b47c4b` | identical | full parallel |
| staff-navTemplates | 1440 | `76af22a3b7a755d67d7229281f9ab49113d9c7fecbe6e4e3f86b3bca47a6f94e` | identical | full parallel |
| staff-navTemplates | 1920 | `abc65e5e79f2f6da142327ebca746700896dad0a2d839d893780f05166d38486` | identical | full parallel |
| staff-navFilmingPlans | 1024 | `ddcc0a67d0fc598924b34171933d1d6a6c28371c28ec4b951d068f234df79eb1` | identical | full parallel |
| staff-navFilmingPlans | 1280 | `e0cc11df7541eece79b1159236c50f62f1a4b3a0f292e23af90354add22c7348` | identical | isolated serial repetition |
| staff-navFilmingPlans | 1440 | `5d63f4d43ad2db300f8a645716e5c46d79b439db853910ebcc45e8cc9c00c1e0` | identical | full parallel |
| staff-navFilmingPlans | 1920 | `f69f63fed9148ce1f7a71e1db5134f268bdc17490d6ec0946df8a210f5e81fa9` | identical | full parallel |
| staff-navTiktokUpload | 1024 | `bd3b874ff2852f01794c3ec66f69678bd3977205665896148a88d6f9df722769` | identical | full parallel |
| staff-navTiktokUpload | 1280 | `106666273fb6689d843422bcf5020d65cba1b27c73049a1c2f77883a3880f25e` | identical | full parallel |
| staff-navTiktokUpload | 1440 | `d33a554a295f23efdb85aa387556e504097f8a30455332418cba6ad854445e1a` | identical | full parallel |
| staff-navTiktokUpload | 1920 | `d87f441ae10ea93079f7968c82dbfe2d02f9b12ac90d2902db87702ca44a54f4` | identical | full parallel |
| staff-navHome | 1024 | `8c26e67ac6ddcf3264c565d0f313678d30b32309614f10fe8a006566a8aa5822` | identical | full parallel |
| staff-navHome | 1280 | `58547f7cb09f55bb090fc3074de0a1adbad6dafcc1ce7e7a43215fd8b95f975d` | identical | full parallel |
| staff-navHome | 1440 | `896e8593ad28ae1431b5b7e3285e2c97cd238c6891d4c771257b3e307c56fa7f` | identical | full parallel |
| staff-navHome | 1920 | `eda76107992198e2ab8f0c4e8cac2fdb7a3ec1afe5516c78d84f5a9741108eba` | identical | full parallel |
| staff-navWorkload | 1024 | `260caa24dd62cc28757234f545c34abaf6a8f6e91f8194982a0175c28b3f89de` | identical | full parallel |
| staff-navWorkload | 1280 | `e96202fa342e173bcf6da920e9442d09a96b8e0ac4f47646964cc7fbea505033` | identical | full parallel |
| staff-navWorkload | 1440 | `c06567030d36ac3f6919e77d565e3f1ee35498a3cd63de8cc556287ce8c9494e` | identical | full parallel |
| staff-navWorkload | 1920 | `b964434c8695dcfde91d5fd016e857889bf41bcc753da7641b847d38e96566c0` | identical | full parallel |
| staff-navProd | 1024 | `7cf17c287f067a5174af1272d47de3d3933da7756a1d3c549090e0b29e87be94` | identical | full parallel |
| staff-navProd | 1280 | `1b1b954bde6af40a2232b3c177f3ccaad8e098b991e1dcf19b0447ab1beb7c6b` | identical | full parallel |
| staff-navProd | 1440 | `9a7e4fa29e6a44cbe5d4325d87ac636ec01659e66c0ff243f8a2b2fb4ec47e88` | identical | full parallel |
| staff-navProd | 1920 | `21a6bcb772195b96a4404272f51557a42deac53c30c2613f7198c4670d8c35fd` | identical | full parallel |
| staff-navLinear | 1024 | `cf22bf546a1dd24f178e1d8a3e94dae110edf5824acaf2b193eaa7ab17759a98` | identical | full parallel |
| staff-navLinear | 1280 | `4235249bad936bf6f0e96b47a1ef69ac665609627ed7303f090cb2e88c9fb3a2` | identical | full parallel |
| staff-navLinear | 1440 | `03875f8041941dc46773ee9881d039381e5194a056f6336f0ef3b3923dad84f2` | identical | full parallel |
| staff-navLinear | 1920 | `53b291175396a9b6496a3b5b93e472eeded5e90a9aeb67eb319735dcbbf6e189` | identical | full parallel |
| staff-navKasper | 1024 | `c705b6157f769b38f375211c37dc4ab1a21e91ae738abdf6a831d52369bc56a2` | identical | isolated serial repetition |
| staff-navKasper | 1280 | `eec50bcbf43cafa835f4938b3d4b17690f63da69e282e5889f1b5635acfac8b5` | identical | full parallel |
| staff-navKasper | 1440 | `72fcdd8c9f61c0468f146849924227759ad903f752e0da647cbfda22df14b59f` | identical | full parallel |
| staff-navKasper | 1920 | `84c76badfb730bc6f7f5d9f53022ad1aceccdad887f1f9103f1b7a2efdb5cfdf` | identical | full parallel |
| staff-time-off | 1024 | `a82019276a641fae1add24d473b05ad2b7b96549be4ae8e5d6def29681bd58de` | identical | full parallel |
| staff-time-off | 1280 | `990302c517a9fb8571adfb0cffa2e982c3d93889f9949f376dbfc4d357bd0da0` | identical | full parallel |
| staff-time-off | 1440 | `28c1b9d25607d36f9e602d9c146e707683c8e3da4a1db8e2569b3f302410c8c8` | identical | full parallel |
| staff-time-off | 1920 | `d4bf0f603e7501acec654973e41d185b7cf0e449dd0c27635a9cb75bb0e7c601` | identical | full parallel |
| client-analytics | 1024 | `e3092a62a1fb52e64b4a42476297a6839e1c1abd8a0a0d911fd052f5a234f73d` | identical | full parallel |
| client-analytics | 1280 | `f2f3e2fab43acb6ccf8910351e837b821dd8dd59e93a2144c2a04aac41dc6f4f` | identical | full parallel |
| client-analytics | 1440 | `d11ef7ceab99bc7bf12dfb535f8d7bc978a171f7e8269f81b07fe63358fe4b6c` | identical | full parallel |
| client-analytics | 1920 | `aa6926766e3a88732c2676bca9a0a7429ce5ede45c923aaa0f8f0bba9b8367ba` | identical | full parallel |
| client-calendar | 1024 | `69fabd5010feb7c5ce0033014bf0390431e8d934f133d156de3f6420f22a5215` | identical | full parallel |
| client-calendar | 1280 | `fc7b056f7e75edcb055b97ed048191eadbd929e1d381a93ee0a946c45b944c3d` | identical | full parallel |
| client-calendar | 1440 | `6f0161af69d34a024491eb5650f4d45a22f36e81460a06343eabfbafe165d8e3` | identical | full parallel |
| client-calendar | 1920 | `de140d5698bd5bcbc6179cb6119c058ffd15a0e7c1ea0543b5a6a70dd2aaf5d8` | identical | full parallel |
| client-calendar-month | 1024 | `fd87a7eb83171f0feb2ec628adde4d8d422ddf5f21223a69b15977ded4b694f5` | identical | full parallel |
| client-calendar-month | 1280 | `1d6efccee1e9f24cdf273939be291ed412b8170ab3e27a89511cf2e377e65925` | identical | full parallel |
| client-calendar-month | 1440 | `bf3a4160985da8df790efef7f3d6079e48a29b605aa2e38e6dadd748bc06abda` | identical | full parallel |
| client-calendar-month | 1920 | `1c017ad49fb2b6baf4fe1773a3819718e9d8ed0d9cb2d57d62e955842218f35e` | identical | full parallel |
| client-calendar-week | 1024 | `73e9c10944b871c555411d7268a5482bdc1f2818abebfc2d064f4a281ef94d3e` | identical | full parallel |
| client-calendar-week | 1280 | `cc17e24f61191aa0c5a4b6742333c6c0a6bf47fc9d830726d888f388b0108fe4` | identical | full parallel |
| client-calendar-week | 1440 | `8b93b4376dc9d6c107f5d39727cca0cda8f133d8861d8d0032a9d33437f5e958` | identical | full parallel |
| client-calendar-week | 1920 | `16738aa687a3abab8a37f1092c89fcaa06c89c25ca3316c98a52651aac5212d3` | identical | full parallel |
| client-brief | 1024 | `69fabd5010feb7c5ce0033014bf0390431e8d934f133d156de3f6420f22a5215` | identical | full parallel |
| client-brief | 1280 | `fc7b056f7e75edcb055b97ed048191eadbd929e1d381a93ee0a946c45b944c3d` | identical | full parallel |
| client-brief | 1440 | `6f0161af69d34a024491eb5650f4d45a22f36e81460a06343eabfbafe165d8e3` | identical | full parallel |
| client-brief | 1920 | `de140d5698bd5bcbc6179cb6119c058ffd15a0e7c1ea0543b5a6a70dd2aaf5d8` | identical | full parallel |
| client-sample-reviews | 1024 | `7b698a748e3460af0ad5ddc5edd0353667f788d8a3702b1462e1eaadddda2f5e` | identical | full parallel |
| client-sample-reviews | 1280 | `d869de825d13001b395dea50c5b6fef102850c131cc5a597c103f6f974aad87d` | identical | full parallel |
| client-sample-reviews | 1440 | `29e7eb2d8015fe7b8a4e5b2fef1bf4edc665bc638c46a23b8e6257754851ebb0` | identical | full parallel |
| client-sample-reviews | 1920 | `f87764b626426a1b1a6f8c6c6194eff6820f990cb8955a139b057244524b062e` | identical | full parallel |
