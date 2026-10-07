# Staff phone state inventory

All rows use the generated native app and intercepted fictional transports. Every rendered overlay receives geometry and trusted touch/wheel background scroll checks. No captures or backend data are published.

The catalogue result is a composite: 460 passing rows from the full run plus four passing client-picker rows after correcting its retired selector. The full run remains recorded as exit 1 with four setup timeouts. This is not a claim that that standalone run was green.

## Rule matrix: 160 passing states

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
