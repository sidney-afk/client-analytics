# Fragment usage per screen, 2026-09-28

Written by `node qa/lazy/fragment-usage.js --write` (plan: `docs/plans/2026-09-28-load-per-tab-plan.md`, step 1).
Offline run: every backend answer is empty or synthetic. A mark means at least one function in that area was
called on that screen (code that runs just by loading does not count). Areas come from `src/index/areas.txt`.

| screen | core | editors | kasper | quick-jump | smm-clients | submit | synclinear | templates | tiktok | time-off | today | workload |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| client link: calendar | ● | ● | ● | ● |  | ● | ● | ● |  | ● |  | ● |
| client link: samples | ● | ● | ● | ● |  | ● | ● | ● |  | ● |  | ● |
| client link: analytics | ● | ● | ● | ● |  | ● | ● | ● |  | ● |  | ● |
| staff: Today | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| staff: Calendar | ● | ● | ● | ● |  | ● | ● | ● | ● | ● | ● | ● |
| staff: Samples | ● | ● | ● | ● |  | ● | ● | ● | ● | ● | ● | ● |
| staff: Templates | ● | ● | ● | ● |  | ● | ● | ● | ● | ● | ● | ● |
| staff: Filming Plans | ● | ● | ● | ● |  | ● | ● | ● | ● | ● | ● | ● |
| staff: TikTok Upload | ● | ● | ● | ● |  | ● | ● | ● | ● | ● | ● | ● |
| staff: Analytics | ● | ● | ● | ● |  | ● | ● | ● | ● | ● | ● | ● |
| staff: Workload | ● | ● | ● | ● |  | ● | ● | ● | ● | ● | ● | ● |
| staff: SyncLinear | ● | ● | ● | ● |  | ● | ● | ● | ● | ● | ● | ● |
| staff: Submit | ● | ● | ● | ● |  | ● | ● | ● | ● | ● | ● | ● |
| staff: Kasper | ● | ● | ● | ● |  | ● | ● | ● | ● | ● | ● | ● |

## Fragments called per screen

- **client link: calendar**: 040, 050, 060, 070, 090, 095, 096, 100, 110, 120, 125, 130, 131, 132, 133, 134, 140, 150, 160, 170, 180, 185, 190, 200, 220, 230, 240, 250, 260, 270, 280, 290, 320, 340
- **client link: samples**: 040, 060, 070, 090, 095, 096, 100, 110, 120, 125, 130, 131, 133, 134, 140, 150, 160, 170, 180, 185, 200, 220, 230, 240, 250, 260, 270, 280, 290, 320, 340
- **client link: analytics**: 040, 050, 060, 070, 090, 095, 096, 100, 110, 120, 125, 130, 131, 133, 134, 140, 150, 160, 180, 185, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 320, 340
- **staff: Today**: 040, 050, 060, 070, 080, 090, 095, 096, 097, 098, 100, 110, 120, 125, 130, 131, 134, 140, 150, 160, 180, 185, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 320, 340
- **staff: Calendar**: 040, 050, 060, 070, 080, 090, 095, 096, 097, 100, 110, 120, 125, 130, 131, 132, 133, 134, 140, 150, 160, 180, 185, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 320, 340
- **staff: Samples**: 040, 060, 070, 080, 090, 095, 096, 097, 100, 110, 120, 125, 130, 131, 133, 134, 140, 150, 160, 180, 185, 200, 220, 230, 240, 250, 260, 270, 280, 290, 300, 320, 340
- **staff: Templates**: 040, 050, 060, 070, 080, 090, 095, 096, 097, 100, 110, 120, 125, 130, 134, 140, 150, 160, 180, 185, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 320, 340
- **staff: Filming Plans**: 040, 050, 060, 070, 080, 090, 095, 096, 097, 100, 110, 120, 125, 130, 134, 140, 150, 160, 180, 185, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 320, 340
- **staff: TikTok Upload**: 040, 050, 060, 070, 080, 090, 095, 096, 097, 100, 110, 120, 125, 130, 134, 140, 150, 160, 180, 185, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 320, 340
- **staff: Analytics**: 040, 050, 060, 070, 080, 090, 095, 096, 097, 100, 110, 120, 125, 130, 134, 140, 150, 160, 180, 185, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 320, 340
- **staff: Workload**: 040, 050, 060, 070, 080, 090, 095, 096, 097, 100, 110, 120, 125, 130, 133, 134, 140, 150, 160, 180, 185, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 320, 340
- **staff: SyncLinear**: 040, 050, 060, 070, 080, 090, 095, 096, 097, 100, 110, 120, 125, 130, 131, 133, 134, 140, 150, 160, 180, 185, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 320, 340
- **staff: Submit**: 040, 050, 060, 070, 080, 090, 095, 096, 097, 100, 110, 120, 125, 130, 131, 134, 140, 150, 160, 180, 185, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 320, 340
- **staff: Kasper**: 040, 050, 060, 070, 080, 090, 095, 096, 097, 100, 110, 120, 125, 130, 131, 133, 134, 140, 150, 160, 180, 185, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 320, 330, 340

## Staff-only code a client link calls today

Each of these must move to core, or stop being called on a client link, before its area can load on demand.

- **editors**: `findBearer` (340), `getTipText` (340), `hide` (340), `isOptedOut` (340), `setupDatePicker` (340), `setupGlobalTooltip` (340)
- **kasper**: unnamed callbacks only
- **quick-jump**: `_svJumpWire` (096)
- **submit**: `_applyAllDataDependentChrome` (200), `_kasperAdminAllowed` (200), `_kasperApplyAccess` (200), `_linearResumeSubmissionHold` (200)
- **synclinear**: `_prodCanonicalCommentGate` (230), `_prodDescLinkPopWire` (240), `_prodEnabled` (210), `_prodRawIcon` (220)
- **templates**: `_isSmmWeeklyRoute` (060), `_syncviewNextNavEpoch` (060)
- **time-off**: `_calSetUpsertEfClients` (110), `_calSetUpsertFlagClientPromise` (110), `_calSetUpsertFlagPromise` (110), `_clientCommentSetGatewayEnabled` (110), `_settingsSetEfClients` (110), `_settingsSetFlagPromise` (110), `_writeUiSetRerouteClients` (110), `_writeUiSetRerouteFlagFailed` (110), `_writeUiSetRerouteFlagGeneration` (110), `_writeUiSetRerouteFlagPromise` (110), `_writeUiSetRerouteRosterUnusable` (110)
- **workload**: `_navFitSync` (090), `_navPillSync` (090), `getClientRoster` (070), `resync` (090), `watch` (090), `wlCanonicalClient` (070), `wlCreatePlanLive` (070), `wlInstallSnapshotWarmer` (070), `wlIsAllowedClient` (070), `wlMergeClientsFromSheet` (070), `wlNormalizeClient` (070), `wlReadDeadlinePref` (070)
