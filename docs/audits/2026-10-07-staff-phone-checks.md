# Staff phone check endings

These are the actual last six lines of each local check log, with trailing empty lines omitted. Failed iterations remain visible. Paths and captures remain local; no backend rows or images are included. Master-test and Production polish are failed gates. A baseline failure never counts as a pass.

## action-row-diagnostic.log

```text
ok detector controls: injected overlap and absent scroll lock fail; artifact lock passes
FAIL calendar-light-390: calendar-light-390: caption actions misaligned [{"name":"cal-cap-toggle","gap":16,"center":904,"height":44},{"name":"cal-cap-gen","gap":12,"center":900,"height":44}]
FAIL calendar-dark-390: calendar-dark-390: caption actions misaligned [{"name":"cal-cap-toggle","gap":16,"center":904,"height":44},{"name":"cal-cap-gen","gap":12,"center":900,"height":44}]
STAFF_PHONE_RULES: 6 states; 2 failures; 390/430 touch; synthetic transports; no live writes
```

## action-row-final.log

```text
ok detector controls: injected overlap and absent scroll lock fail; artifact lock passes
ok calendar-light-390 screen, menus, layout and scroll lock
ok calendar-dark-390 screen, menus, layout and scroll lock
ok calendar-light-430 screen, menus, layout and scroll lock
ok calendar-dark-430 screen, menus, layout and scroll lock
STAFF_PHONE_RULES: 28 states; 0 failures; 390/430 touch; synthetic transports; no live writes
```

## action-row-verified.log

```text
ok detector controls: injected overlap and absent scroll lock fail; artifact lock passes
FAIL calendar-light-390: calendar-light-390: caption actions misaligned
FAIL calendar-dark-390: calendar-dark-390: caption actions misaligned
FAIL calendar-light-430: calendar-light-430: caption actions misaligned
FAIL calendar-dark-430: calendar-dark-430: caption actions misaligned
STAFF_PHONE_RULES: 12 states; 4 failures; 390/430 touch; synthetic transports; no live writes
```

## admin.log

```text
KASPER_ADMIN_EXPANDED: 126 native states; 2326 checks; 2 failures; fictional data; no live writes.
FAIL client-edit: controls overlap [{"a":"#caIn_youtube_channel_id","b":"button.cc-btn","w":156,"h":36.953125},{"a":"#caIn_youtube_channel_id","b":"button.cc-btn.primary.ca-save","w":156,"h":38.953125}]
FAIL client-edit: controls overlap [{"a":"#caIn_youtube_channel_id","b":"button.cc-btn","w":156,"h":36.953125},{"a":"#caIn_youtube_channel_id","b":"button.cc-btn.primary.ca-save","w":156,"h":38.953125}]
```

## admin390-final.log

```text
FAIL credential-add: controls overlap [{"a":"#ccEditPassword","b":"button.cc-pass-toggle","w":44,"h":44}]
FAIL credential-platform: controls overlap [{"a":"button.cc-select-option.active","b":"#ccEditHandle","w":304,"h":22},{"a":"button.cc-select-option","b":"#ccEditHandle","w":304,"h":24},{"a":"button.cc-select-option","b":"#ccEditPassword","w":304,"h":28},{"a":"button.cc-select-option","b":"button.cc-pass-toggle","w":44,"h":27},{"a":"button.cc-select-option","b":"#ccEditPassword","w":304,"h":18},{"a":"button.cc-select-option","b":"button.cc-pass-toggle","w":44,"h":17},{"a":"button.cc-select-option","b":"#ccEditNotes","w":304,"h":34},{"a":"button.cc-select-option","b":"#ccEditNotes","w":304,"h":36.375},{"a":"button.cc-select-option","b":"#ccEditCancel","w":75.984375,"h":18.625},{"a":"button.cc-select-option","b":"#ccEditSave","w":58.90625,"h":18.625},{"a":"button.cc-select-option","b":"#ccEditCancel","w":75.984375,"h":25.375},{"a":"button.cc-select-option","b":"#ccEditSave","w":58.90625,"h":25.375},{"a":"#ccEditPassword","b":"button.cc-pass-toggle","w":44,"h":44}]
KASPER_ADMIN_EXPANDED: 126 native states; 2330 checks; 4 failures; fictional data; no live writes.
FAIL credential-add: controls overlap [{"a":"#ccEditPassword","b":"button.cc-pass-toggle","w":44,"h":44}]
FAIL credential-platform: controls overlap [{"a":"button.cc-select-option.active","b":"#ccEditHandle","w":304,"h":22},{"a":"button.cc-select-option","b":"#ccEditHandle","w":304,"h":24},{"a":"button.cc-select-option","b":"#ccEditPassword","w":304,"h":28},{"a":"button.cc-select-option","b":"button.cc-pass-toggle","w":44,"h":27},{"a":"button.cc-select-option","b":"#ccEditPassword","w":304,"h":18},{"a":"button.cc-select-option","b":"button.cc-pass-toggle","w":44,"h":17},{"a":"button.cc-select-option","b":"#ccEditNotes","w":304,"h":34},{"a":"button.cc-select-option","b":"#ccEditNotes","w":304,"h":36.375},{"a":"button.cc-select-option","b":"#ccEditCancel","w":75.984375,"h":18.625},{"a":"button.cc-select-option","b":"#ccEditSave","w":58.90625,"h":18.625},{"a":"button.cc-select-option","b":"#ccEditCancel","w":75.984375,"h":25.375},{"a":"button.cc-select-option","b":"#ccEditSave","w":58.90625,"h":25.375},{"a":"#ccEditPassword","b":"button.cc-pass-toggle","w":44,"h":44}]
```

## admin390-verified.log

```text
KASPER_ADMIN_EXPANDED: 126 native states; 2326 checks; 0 failures; fictional data; no live writes.
```

## admin430-verified.log

```text
KASPER_ADMIN_EXPANDED: 126 native states; 2326 checks; 0 failures; fictional data; no live writes.
```

## admin430.log

```text
KASPER_ADMIN_EXPANDED: 126 native states; 2326 checks; 4 failures; fictional data; no live writes.
FAIL credential-add: controls overlap [{"a":"#ccEditPassword","b":"button.cc-pass-toggle","w":44,"h":44}]
FAIL credential-platform: controls overlap [{"a":"button.cc-select-option.active","b":"#ccEditHandle","w":344,"h":22},{"a":"button.cc-select-option","b":"#ccEditHandle","w":344,"h":24},{"a":"button.cc-select-option","b":"#ccEditPassword","w":344,"h":28},{"a":"button.cc-select-option","b":"button.cc-pass-toggle","w":44,"h":27},{"a":"button.cc-select-option","b":"#ccEditPassword","w":344,"h":18},{"a":"button.cc-select-option","b":"button.cc-pass-toggle","w":44,"h":17},{"a":"button.cc-select-option","b":"#ccEditNotes","w":344,"h":34},{"a":"button.cc-select-option","b":"#ccEditNotes","w":344,"h":36.375},{"a":"button.cc-select-option","b":"#ccEditCancel","w":75.984375,"h":18.625},{"a":"button.cc-select-option","b":"#ccEditSave","w":58.90625,"h":18.625},{"a":"button.cc-select-option","b":"#ccEditCancel","w":75.984375,"h":25.375},{"a":"button.cc-select-option","b":"#ccEditSave","w":58.90625,"h":25.375},{"a":"#ccEditPassword","b":"button.cc-pass-toggle","w":44,"h":44}]
FAIL credential-add: controls overlap [{"a":"#ccEditPassword","b":"button.cc-pass-toggle","w":44,"h":44}]
FAIL credential-platform: controls overlap [{"a":"button.cc-select-option.active","b":"#ccEditHandle","w":344,"h":22},{"a":"button.cc-select-option","b":"#ccEditHandle","w":344,"h":24},{"a":"button.cc-select-option","b":"#ccEditPassword","w":344,"h":28},{"a":"button.cc-select-option","b":"button.cc-pass-toggle","w":44,"h":27},{"a":"button.cc-select-option","b":"#ccEditPassword","w":344,"h":18},{"a":"button.cc-select-option","b":"button.cc-pass-toggle","w":44,"h":17},{"a":"button.cc-select-option","b":"#ccEditNotes","w":344,"h":34},{"a":"button.cc-select-option","b":"#ccEditNotes","w":344,"h":36.375},{"a":"button.cc-select-option","b":"#ccEditCancel","w":75.984375,"h":18.625},{"a":"button.cc-select-option","b":"#ccEditSave","w":58.90625,"h":18.625},{"a":"button.cc-select-option","b":"#ccEditCancel","w":75.984375,"h":25.375},{"a":"button.cc-select-option","b":"#ccEditSave","w":58.90625,"h":25.375},{"a":"#ccEditPassword","b":"button.cc-pass-toggle","w":44,"h":44}]
```

## all-states-verified.log

```text
ok samples-tabs 430 dark
ok today-cleared 390 light
ok today-cleared 390 dark
ok today-cleared 430 light
ok today-cleared 430 dark
staff-phone-final-pass: 460 renders, 4 problems
```

## all-states.log

```text
ok samples-tabs 430 dark
ok today-cleared 390 light
ok today-cleared 390 dark
ok today-cleared 430 light
ok today-cleared 430 dark
staff-phone-final-pass: 460 renders, 20 problems
```

## artifact-source-committed.log

```text
staff-phone-rules-source: artifact CSS/JS transplanted byte-identically; 38 rules phone-capped and staff-scoped
```

## artifact-source-final.log

```text
staff-phone-rules-source: artifact CSS/JS transplanted byte-identically; 38 rules phone-capped and staff-scoped
```

## artifact-source-line-endings.log

```text
staff-phone-rules-source: artifact CSS/JS transplanted byte-identically; 38 rules phone-capped and staff-scoped
```

## artifact-source-rebased-verified.log

```text
      '/* STAFF-PHONE-RULES:END */'
  ],
  operator: 'deepStrictEqual'
}

Node.js v22.12.0
```

## artifact-source-rebased.log

```text
      '/* STAFF-PHONE-RULES:END */'
  ],
  operator: 'deepStrictEqual'
}

Node.js v22.12.0
```

## baseline-alert-digest.js.log

```text
  ok  the workflow reads the switch from a repository variable with no default
  ok  the switch has no "or true" fallback
  ok  the workflow records its own heartbeat
FAIL  accepted but unconfirmed delivery is reported as unconfirmed, so state would not move

1 alert-digest check(s) failed
```

## baseline-analytics-market-research-collect-function.js.log

```text
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:546:25) {
  code: 'ERR_UNSUPPORTED_ESM_URL_SCHEME'
}

Node.js v22.12.0
```

## baseline-analytics-metrics-collect-function.js.log

```text
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:546:25) {
  code: 'ERR_UNSUPPORTED_ESM_URL_SCHEME'
}

Node.js v22.12.0
```

## baseline-analytics-top-videos-collect-function.js.log

```text
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:546:25) {
  code: 'ERR_UNSUPPORTED_ESM_URL_SCHEME'
}

Node.js v22.12.0
```

## baseline-b2-brief-link-rewrite.mjs.log

```text
  ok  editor shows a non-editable chip, never an <img>
  ok  chip serializes back to the exact source
  ok  editor shows a non-editable chip, never an <img>
  ok  chip serializes back to the exact source
FAIL  snapshot is 0600
1 failure(s)
```

## baseline-behav-wired-verified.log

```text
behav-wired failures: groupCollapse=false
{"globalNavLabelRouteSplit":true,"globalNavKeyboardExit":true,"detailDescriptionStableThroughPendingRefresh":true,"chip":true,"scopePillMatchesTabScale":true,"projectToolbarControls":true,"projectDetailKeepsTeamScope":true,"projectRowsUseIssueListMetadataAndWidth":true,"projectToolbarMenusAndDetailsToggle":true,"projectDisplayGroupingAndSubissues":true,"due":true,"avatar":true,"rowStatus":true,"subLive":true,"palette":true,"paletteSearch":true,"paletteRanksDirectMatches":true,"cmdkKey":true,"team":true,"topbarNoFakeFavorites":true,"chevron":true,"pring":true,"tabs":true,"boardScopeLabelStatic":true,"my":true,"kbStatus":true,"kbAssign":true,"kbDue":true,"kbProj":true,"kbSelectAll":true,"kbDelete":true,"pickerNum":true,"pickerArrow":true,"composerEsc":true,"selPersist":true,"copyCount":true,"personCross":true,"jkNav":true,"enterFocusOpen":true,"kfocusShortcut":true,"groupPartial":true,"emptyColumn":true,"emptyBoardColumnsStayStatic":true,"markdown":true,"paletteCommand":true,"submenuEscape":true,"menuNav":true,"menuNavEnter":true,"ppickNav":true,"pickerSwitch":true,"tabTrap":true,"groupProjectNav":true,"topCrumbsAreClickableControls":true,"scopeTeamPillSwitchesTeam":true,"scopeProjectPillOpensProject":true,"detailProjectCrumbOpensProject":true,"projectCrumbTeamNavigatesBoard":true,"detailPropHoverTransitions":true,"resolvedParentsMatchProjectedLinearLinks":true,"kbSelPriority":true,"cardLead":true,"cardTarget":true,"cardCount":true,"boardFilteredCountCopy":true,"boardFilteredNoMatchEmptyCopy":true,"subLeafNoHeader":true,"syncFocus":true,"cardMenu":true,"colCollapse":true,"calArrowNav":true,"calEscape":true,"subDueEmpty":true,"filterSubEscape":true,"groupCheckHit":true,"paletteCmdClearSel":true,"goParent":true,"brandRemoved":true,"kbFocusOverHover":true,"clearFilters":true,"filterValKeyNav":true,"underscoreMd":true,"pcardRightClick":true,"subRowShiftSelects":true,"scrollPreserve":true,"scrollBackNav":true,"dueFocusSync":true,"ctrlXGuard":true,"composerBoxClick":true,"filterArrowRight":true,"multiDueNoDate":true,"commentBodyWrap":true,"commentSignedOutStateNotSkeleton":true,"detailFileLinkLabel":true,"boardJK":true,"boardFirstJ":true,"boardArrowCol":true,"boardEnterOpen":true,"boardStatusKey":true,"listJKUnaffected":true,"ctrlClickSelect":true,"shiftClickGlyph":true,"shiftArrowSelect":true,"dueSubmenuFlip":true,"titleTooltip":true,"menuArrowUpWrap":true,"escClearsRing":true,"ringClearOnNav":true,"enterHoverOpens":true,"cmdASelectsCollapsed":true,"reconcileOnTab":true,"crumbTitleTooltip":true,"sideDueTooltip":true,"paletteWrap":true,"palettePersonKeepsTab":true,"calMonthNavFocus":true,"calTypedDate":true,"pcardNameTooltip":true,"filterBtnToggle":true,"bulkQuickStatus":true,"bulkCopyIssueId":true,"pickerNoResults":true,"composerHint":true,"pdetail":true,"brandNoMenu":true,"noCreateTrigger":true,"boardCardCmdSelect":true,"boardCardShiftRange":true,"boardCardPlainOpens":true,"boardCardCheckbox":true,"boardBulkStatus":true,"boardCardKbStatus":true,"boardCardEscClears":true,"boardCardNavClears":true,"detailScrollPreserve":true,"detailScrollNavBack":true,"boardXSelect":true,"filterSubNoResults":true,"sidebarMyIssues":true,"sidebarTeamProjects":true,"searchButtonOpensPalette":true,"cmdKOpensPalette":true,"paletteSearchFindsIssue":true,"paletteCommandSwitchesView":true,"groupCollapse":false,"groupCheckGuard":true,"filterMenuOpens":true,"filterSubSearchable":true,"filterAppliesLive":true,"combinedFiltersUniqueRows":true,"clearFiltersEmptySafe":true,"groupByAssignee":true,"groupByClient":true,"showSubIssuesDisplayRule":true,"orderingChangesRowOrder":true,"groupByChoicePersistsReload":true,"paletteSearchBrief":true,"rowClientChipProjectPath":true,"rowStatusGuard":true,"rowDueGuard":true,"contextStatusSubmenu":true,"contextCopyDeepLink":true,"keyboardArrowFocus":true,"keyboardEnterOpens":true,"keyboardStatusGuardOpens":true,"detailPropertyGuard":true,"boardColumnCollapse":true,"boardContextLeadUsesPersonIconGuarded":true,"noWriteRequests":true,"noConsoleErrors":true}
behav-wired recovered read retries: 0; navigation-aborted reads: 4
BEHAV_WIRED_FAILED_CHECKS groupCollapse
behav-wired deferred-B3: commentEdit, commentEditCancel, commentDelete, boardDrag, delCount, draftPersist, moveNoop, addSubKeepOpen, editedMarker, composerTextarea, favSection, favView, selReconcile, fFavorite, delSelPriority, commentEditBlurDiscards, fFromList, subDueEmptyNew, focusAfterDelete, delUndo, delUndoOrder, ctrlZUndo, nowLabel, activityLogged, commentDeleteUndo, childActivityLogged
behav-wired: 168/169 (guard mode)
```

## baseline-behav-wired.log

```text
  requireStack: [
    'C:\\Users\\Sidney\\.syncview\\pocket-staff-phone-20261007\\baseline\\docs\\syncview-design\\tests\\behav-wired.js'
  ]
}

Node.js v22.12.0
```

## baseline-brain-parse.js.log

```text
    at #createModuleJob (node:internal/modules/esm/loader:507:36)
    at #getJobFromResolveResult (node:internal/modules/esm/loader:275:34)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:243:41)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:546:25) {
  code: 'ERR_UNSUPPORTED_ESM_URL_SCHEME'
}
```

## baseline-check.log

```text
test/overnight-runner-output-path.js: baseline exit 1
test/overnight-runner-singleton-lock.js: baseline exit 1
test/production-write-card-link.js: baseline exit 1
test/urgent-ping-fresh-round.js: baseline exit 1
test/write-refusal-browser-codes.js: baseline exit 1
BASELINE: 17/17 failing suites also fail at unchanged base
```

## baseline-clean-urls-routes.js.log

```text
    104, 116, 109, 108,
    ... 249 more items
  ]
}

Node.js v22.12.0
```

## baseline-client-onboarding-handler.js.log

```text
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:243:41)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:546:25) {
  code: 'ERR_UNSUPPORTED_ESM_URL_SCHEME'
}

Node.js v22.12.0
```

## baseline-client-profile-edit.js.log

```text
    at #createModuleJob (node:internal/modules/esm/loader:507:36)
    at #getJobFromResolveResult (node:internal/modules/esm/loader:275:34)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:243:41)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:546:25) {
  code: 'ERR_UNSUPPORTED_ESM_URL_SCHEME'
}
```

## baseline-client-reconcile-after-posted.js.log

```text
    at #createModuleJob (node:internal/modules/esm/loader:507:36)
    at #getJobFromResolveResult (node:internal/modules/esm/loader:275:34)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:243:41)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:546:25) {
  code: 'ERR_UNSUPPORTED_ESM_URL_SCHEME'
}
```

## baseline-filming-plan-tabs-source.js.log

```text
    at #createModuleJob (node:internal/modules/esm/loader:507:36)
    at #getJobFromResolveResult (node:internal/modules/esm/loader:275:34)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:243:41)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:546:25) {
  code: 'ERR_UNSUPPORTED_ESM_URL_SCHEME'
}
```

## baseline-key-verify-behavior.js.log

```text
    at TracingChannel.traceSync (node:diagnostics_channel:322:14)
    at wrapModuleLoad (node:internal/modules/cjs/loader:219:24)
    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:170:5)
    at node:internal/main/run_main_module:36:49

Node.js v22.12.0
```

## baseline-overnight-runner-output-path.js.log

```text
<3>WSL (14 - Relay) ERROR: CreateProcessCommon:818: execvpe(/bin/bash) failed: No such file or directory
```

## baseline-overnight-runner-singleton-lock.js.log

```text
fresh lock was not acquired
<3>WSL (20 - Relay) ERROR: CreateProcessCommon:818: execvpe(/bin/bash) failed: No such file or directory
```

## baseline-production-write-card-link.js.log

```text
    at #createModuleJob (node:internal/modules/esm/loader:507:36)
    at #getJobFromResolveResult (node:internal/modules/esm/loader:275:34)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:243:41)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:546:25) {
  code: 'ERR_UNSUPPORTED_ESM_URL_SCHEME'
}
```

## baseline-urgent-ping-fresh-round.js.log

```text
    at #createModuleJob (node:internal/modules/esm/loader:507:36)
    at #getJobFromResolveResult (node:internal/modules/esm/loader:275:34)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:243:41)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:546:25) {
  code: 'ERR_UNSUPPORTED_ESM_URL_SCHEME'
}
```

## baseline-write-refusal-browser-codes.js.log

```text
    at #createModuleJob (node:internal/modules/esm/loader:507:36)
    at #getJobFromResolveResult (node:internal/modules/esm/loader:275:34)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:243:41)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:546:25) {
  code: 'ERR_UNSUPPORTED_ESM_URL_SCHEME'
}
```

## build-alignment.log

```text
build-index: js/sv-02-templates-1f8752debcf4.js (103791 bytes)
build-index: js/sv-04-workload-6a22ae787f05.js (190261 bytes)
build-index: js/sv-14-tiktok-922f4985e782.js (122069 bytes)
build-index: js/sv-16-kasper-baedbf6dc851.js (298341 bytes)
build-index: wrote index.html (1283896 bytes) from 67 fragment(s)
build-index: wrote src/index/INDEX.md
```

## build-index-final.log

```text
build-index: js/sv-02-templates-1f8752debcf4.js (103791 bytes)
build-index: js/sv-04-workload-6a22ae787f05.js (190261 bytes)
build-index: js/sv-14-tiktok-922f4985e782.js (122069 bytes)
build-index: js/sv-16-kasper-baedbf6dc851.js (298341 bytes)
build-index: wrote index.html (1283857 bytes) from 67 fragment(s)
build-index: wrote src/index/INDEX.md
```

## build-index.log

```text
build-index: js/sv-02-templates-1f8752debcf4.js (103791 bytes)
build-index: js/sv-04-workload-6a22ae787f05.js (190261 bytes)
build-index: js/sv-14-tiktok-922f4985e782.js (122069 bytes)
build-index: js/sv-16-kasper-baedbf6dc851.js (298341 bytes)
build-index: wrote index.html (1283772 bytes) from 67 fragment(s)
build-index: wrote src/index/INDEX.md
```

## caption-hidden-verified.log

```text
nested popup allowed its underlying sheet to scroll

700 !== 100
```

## cards-final-source.log

```text
ok calendar-sheet 430 dark
ok samples-sheet 390 light
ok samples-sheet 390 dark
ok samples-sheet 430 light
ok samples-sheet 430 dark
staff-phone-final-pass: 8 renders, 0 problems
```

## catalogue-390.log

```text
ok samples-more 390 dark
ok samples-tabs 390 light
ok samples-tabs 390 dark
ok today-cleared 390 light
ok today-cleared 390 dark
staff-phone-final-pass: 230 renders, 2 problems
```

## catalogue-430.log

```text
ok samples-more 430 dark
ok samples-tabs 430 light
ok samples-tabs 430 dark
ok today-cleared 430 light
ok today-cleared 430 dark
staff-phone-final-pass: 230 renders, 2 problems
```

## check-index-committed.log

```text

check-index: assembled bytes — sha256=397bcb3f38ac4494950db140877ceadcda2973433bf910e813f9e914dbe1dd0e bytes=1283857
check-index: working-tree index.html — sha256=397bcb3f38ac4494950db140877ceadcda2973433bf910e813f9e914dbe1dd0e bytes=1283857
check-index: committed index.html (HEAD) — sha256=397bcb3f38ac4494950db140877ceadcda2973433bf910e813f9e914dbe1dd0e bytes=1283857

check-index: OK — assembled == working tree == committed (HEAD)
```

## check-index-final.log

```text
check-index: working-tree index.html — sha256=397bcb3f38ac4494950db140877ceadcda2973433bf910e813f9e914dbe1dd0e bytes=1283857
check-index: committed index.html (HEAD) — sha256=47b094c4715d96f855ec204736709e1c15dfc3bee44b9b51a3e5d89f59a8f225 bytes=1278801
check-index: FAIL — assembled bytes do not equal committed index.html (HEAD)
check-index: FAIL — working-tree index.html does not equal committed index.html (HEAD)

check-index: FAILED
```

## check-index-rebased.log

```text

check-index: assembled bytes — sha256=397bcb3f38ac4494950db140877ceadcda2973433bf910e813f9e914dbe1dd0e bytes=1283857
check-index: working-tree index.html — sha256=397bcb3f38ac4494950db140877ceadcda2973433bf910e813f9e914dbe1dd0e bytes=1283857
check-index: committed index.html (HEAD) — sha256=397bcb3f38ac4494950db140877ceadcda2973433bf910e813f9e914dbe1dd0e bytes=1283857

check-index: OK — assembled == working tree == committed (HEAD)
```

## check-index.log

```text
check-index: working-tree index.html — sha256=8b4e96856befe8ac5e7b9a45971a3dbdbccdd8f88672ed9bb08b1930222405e8 bytes=1282608
check-index: committed index.html (HEAD) — sha256=47b094c4715d96f855ec204736709e1c15dfc3bee44b9b51a3e5d89f59a8f225 bytes=1278801
check-index: FAIL — assembled bytes do not equal committed index.html (HEAD)
check-index: FAIL — working-tree index.html does not equal committed index.html (HEAD)

check-index: FAILED
```

## client-picker-final.log

```text
ok client-picker 390 light
ok client-picker 390 dark
ok client-picker 430 light
ok client-picker 430 dark
staff-phone-final-pass: 4 renders, 0 problems
```

## client-picker-verified.log

```text
FAIL client-picker 390 light: locator.tap: Timeout 30000ms exceeded.
FAIL client-picker 390 dark: locator.tap: Timeout 30000ms exceeded.
FAIL client-picker 430 light: locator.tap: Timeout 30000ms exceeded.
FAIL client-picker 430 dark: locator.tap: Timeout 30000ms exceeded.
staff-phone-final-pass: 0 renders, 4 problems
```

## css-scope.log

```text
staff-phone-css-scope: OK (1 block(s), 360 braces, all under @media (max-width: <=767px) and body:has(.pocket-staff-bar))
```

## desktop-alignment-final.log

```text
ok   staff-navTiktokUpload @1280: pixels identical, computed styles identical (106666273fb6)
ok   staff-navTiktokUpload @1440: pixels identical, computed styles identical (d33a554a295f)
ok   staff-navTiktokUpload @1920: pixels identical, computed styles identical (d87f441ae10e)
ok   staff-navFilmingPlans @1440: pixels identical, computed styles identical (5d63f4d43ad2, attempts 2)
FAIL staff-navFilmingPlans @1280: pixels DIFFERENT, computed styles identical (a9913d89eb53, attempts 4)
ok   staff-navHome @1280: pixels identical, computed styles identical (58547f7cb09f)
```

## desktop-final.log

```text
ok   client-sample-reviews @1024: pixels identical, computed styles identical (7b698a748e34)
ok   client-sample-reviews @1280: pixels identical, computed styles identical (d869de825d13)
ok   client-sample-reviews @1440: pixels identical, computed styles identical (29e7eb2d8015)
ok   client-sample-reviews @1920: pixels identical, computed styles identical (f87764b62642)

70/72 desktop shots identical to 672b5a4d
```

## desktop-last.log

```text
ok   client-sample-reviews @1024: pixels identical, computed styles identical (7b698a748e34)
ok   client-sample-reviews @1280: pixels identical, computed styles identical (d869de825d13)
ok   client-sample-reviews @1440: pixels identical, computed styles identical (29e7eb2d8015)
ok   client-sample-reviews @1920: pixels identical, computed styles identical (f87764b62642)

71/72 desktop shots identical to 672b5a4d
```

## desktop-serial.log

```text
ok   client-sample-reviews @1024: pixels identical, computed styles identical (7b698a748e34)
ok   client-sample-reviews @1280: pixels identical, computed styles identical (d869de825d13)
ok   client-sample-reviews @1440: pixels identical, computed styles identical (29e7eb2d8015)
ok   client-sample-reviews @1920: pixels identical, computed styles identical (f87764b62642)

72/72 desktop shots identical to 672b5a4d
```

## desktop.log

```text
ok   staff-time-off @1024: pixels identical, computed styles identical (a82019276a64)
ok   staff-time-off @1280: pixels identical, computed styles identical (990302c517a9)
ok   staff-time-off @1440: pixels identical, computed styles identical (28c1b9d25607)
ok   staff-time-off @1920: pixels identical, computed styles identical (d4bf0f603e75)

48/48 desktop shots identical to 672b5a4d
```

## diff-check-followup.log

No terminal output; exit 0.

## diff-check.log

```text
warning: in the working copy of 'test/suite-classification.json', LF will be replaced by CRLF the next time Git touches it
```

## identity-initial.log

```text
  terms this change adds           0   (0 client slugs, 0 staff names)
  files carrying at least one      0   (any is a failure)

  WHERE (counts only — this tool never prints what it matched):

This change adds no client slug and no colleague's name ✅
```

## identity-push.log

```text
  terms this change adds           0   (0 client slugs, 0 staff names)
  files carrying at least one      0   (any is a failure)

  WHERE (counts only — this tool never prints what it matched):

This change adds no client slug and no colleague's name ✅
```

## identity-rebased.log

```text
  terms this change adds           0   (0 client slugs, 0 staff names)
  files carrying at least one      0   (any is a failure)

  WHERE (counts only — this tool never prints what it matched):

This change adds no client slug and no colleague's name ✅
```

## main-runtime-equivalence.log

No terminal output; exit 0.

## master.log

```text
================= MASTER SUMMARY =================
  unit       ❌ FAIL     unit suites FAILED · ⚠ timed out after 300s
  boot       ✅ pass     23 streamed visible-boot groups passed
  parity     ✅ pass     ✓ parity_logic.js  ✓ realtime_parity.js

❌ MASTER: one or more lanes FAILED
```

## popup-verified.log

```text
ok linear-assignee-picker 430 dark
ok linear-due-picker 390 light
ok linear-due-picker 390 dark
ok linear-due-picker 430 light
ok linear-due-picker 430 dark
staff-phone-final-pass: 20 renders, 0 problems
```

## prod-polish.log

```text
pixel-wired (dark): list, icon paths, palette, selection/actionbar, signed-out status/context/due guards, bulk menu anchor, filter pill, filtered empty state, board drag/scroll, detail, browser history, no-write, and console checks passed
pixel-wired: light and dark passes completed
pixel-wired screenshots: D:\Sidney\Documents\Synchro\atlas-client-analytics\.codex-tmp\prod-pixel-wired

prod-polish-gate (all) failed after 590.6s
  - Production wired behavior failed with exit 1
```

## repo-map-committed.log

```text
OK  REPO_MAP.md path `test/staff-calendar-phone-css-scope.js` exists
OK  REPO_MAP.md path `docs/syncview-design/tests/staff-calendar-expanded-browser.js` exists
OK  REPO_MAP.md path `docs/syncview-design/proofs/staff-calendar-expanded/README.md` exists
OK  REPO_MAP.md path `docs/syncview-design/tests/phone-thumbnail-comparison.js` exists

repo-map-sync: 1095 passed, 0 failed
```

## repo-map-rebased.log

```text
OK  REPO_MAP.md path `test/staff-calendar-phone-css-scope.js` exists
OK  REPO_MAP.md path `docs/syncview-design/tests/staff-calendar-expanded-browser.js` exists
OK  REPO_MAP.md path `docs/syncview-design/proofs/staff-calendar-expanded/README.md` exists
OK  REPO_MAP.md path `docs/syncview-design/tests/phone-thumbnail-comparison.js` exists

repo-map-sync: 1095 passed, 0 failed
```

## repo-map.log

```text
OK  REPO_MAP.md path `test/staff-calendar-phone-css-scope.js` exists
OK  REPO_MAP.md path `docs/syncview-design/tests/staff-calendar-expanded-browser.js` exists
OK  REPO_MAP.md path `docs/syncview-design/proofs/staff-calendar-expanded/README.md` exists
OK  REPO_MAP.md path `docs/syncview-design/tests/phone-thumbnail-comparison.js` exists

repo-map-sync: 1095 passed, 0 failed
```

## rules-complete.log

```text
ok kasper-dark-430 screen, menus, layout and scroll lock
ok time-off-light-390 screen, menus, layout and scroll lock
ok time-off-dark-390 screen, menus, layout and scroll lock
ok time-off-light-430 screen, menus, layout and scroll lock
ok time-off-dark-430 screen, menus, layout and scroll lock
STAFF_PHONE_RULES: 156 states; 0 failures; 390/430 touch; synthetic transports; no live writes
```

## rules-final-source.log

```text
ok sample-reviews-dark-430 screen, menus, layout and scroll lock
ok templates-light-390 screen, menus, layout and scroll lock
ok templates-dark-390 screen, menus, layout and scroll lock
ok templates-light-430 screen, menus, layout and scroll lock
ok templates-dark-430 screen, menus, layout and scroll lock
ok filming-plans-light-390 screen, menus, layout and scroll lock
```

## rules-final.log

```text
ok kasper-dark-430 screen, menus, layout and scroll lock
ok time-off-light-390 screen, menus, layout and scroll lock
ok time-off-dark-390 screen, menus, layout and scroll lock
ok time-off-light-430 screen, menus, layout and scroll lock
ok time-off-dark-430 screen, menus, layout and scroll lock
STAFF_PHONE_RULES: 144 states; 4 failures; 390/430 touch; synthetic transports; no live writes
```

## rules-initial.log

```text
+     w: 44
+   }
+ ]
- []

STAFF_PHONE_RULES: 4 states; 2 failures; 390/430 touch; synthetic transports; no live writes
```

## rules-last.log

```text
ok kasper-dark-430 screen, menus, layout and scroll lock
ok time-off-light-390 screen, menus, layout and scroll lock
ok time-off-dark-390 screen, menus, layout and scroll lock
ok time-off-light-430 screen, menus, layout and scroll lock
ok time-off-dark-430 screen, menus, layout and scroll lock
STAFF_PHONE_RULES: 156 states; 0 failures; 390/430 touch; synthetic transports; no live writes
```

## rules-verified.log

```text
ok kasper-dark-430 screen, menus, layout and scroll lock
ok time-off-light-390 screen, menus, layout and scroll lock
ok time-off-dark-390 screen, menus, layout and scroll lock
ok time-off-light-430 screen, menus, layout and scroll lock
ok time-off-dark-430 screen, menus, layout and scroll lock
STAFF_PHONE_RULES: 160 states; 0 failures; 390/430 touch; synthetic transports; no live writes
```

## rules.log

```text
+ actual - expected

+ '[class*="-overlay"]'
- 'body'

STAFF_PHONE_RULES: 120 states; 24 failures; 390/430 touch; synthetic transports; no live writes
```

## sweep.log

```text
ok samples-tabs 430 dark
ok today-cleared 390 light
ok today-cleared 390 dark
ok today-cleared 430 light
ok today-cleared 430 dark
staff-phone-final-pass: 120 renders, 8 problems
```

## unit-final.log

```text
write UI native-target and gateway-before-source durability checks passed
staff-phone-css-scope: OK (1 block(s), 360 braces, all under @media (max-width: <=767px) and body:has(.pocket-staff-bar))
finch-phone-css-scope: OK (1 block(s), 367 braces, all under @media (max-width: <=767px) and html.fph-on)

17 of 684 unit suite(s) failed ❌
failed suites: test/client-onboarding-handler.js, test/clean-urls-routes.js, test/b2-brief-link-rewrite.mjs, test/alert-digest.js, test/analytics-market-research-collect-function.js, test/analytics-metrics-collect-function.js, test/analytics-top-videos-collect-function.js, test/brain-parse.js, test/client-profile-edit.js, test/client-reconcile-after-posted.js, test/filming-plan-tabs-source.js, test/key-verify-behavior.js, test/overnight-runner-output-path.js, test/overnight-runner-singleton-lock.js, test/production-write-card-link.js, test/urgent-ping-fresh-round.js, test/write-refusal-browser-codes.js
```

## unit.log

```text
write UI native-target and gateway-before-source durability checks passed
staff-phone-css-scope: OK (1 block(s), 360 braces, all under @media (max-width: <=767px) and body:has(.pocket-staff-bar))
finch-phone-css-scope: OK (1 block(s), 367 braces, all under @media (max-width: <=767px) and html.fph-on)

18 of 684 unit suite(s) failed ❌
failed suites: test/client-onboarding-handler.js, test/clean-urls-routes.js, test/b2-brief-link-rewrite.mjs, test/alert-digest.js, test/analytics-market-research-collect-function.js, test/analytics-metrics-collect-function.js, test/analytics-top-videos-collect-function.js, test/brain-parse.js, test/client-profile-edit.js, test/client-reconcile-after-posted.js, test/filming-plan-tabs-source.js, test/key-verify-behavior.js, test/overnight-runner-output-path.js, test/overnight-runner-singleton-lock.js, test/production-write-card-link.js, test/repo-map-sync.js, test/urgent-ping-fresh-round.js, test/write-refusal-browser-codes.js
```

## Production polish child-suite endings

The aggregate-read scope deviation applies to the wired behavior/pixel lanes. These are preserved framework summaries, not TEST-only live evidence.

### Production boot budget

```text
prod-boot-budget: ready=202ms dcl=117ms, Production boot source, visible root, and no Analytics skeleton leak passed
```

### Tab switch during boot (Phase D)

```text
tab-switch-boot: 10 tabs checked (navToday, navCalendar, navSxr, navTemplates, navFilmingPlans, navTiktokUpload, navWorkload, navProd, navLinear, navKasper)
tab-switch-boot: PASS
```

### Saved submission never traps (Submit + Create Post)

```text
PASS Create Post: the saved post is not left half-marked
PASS Create Post: nothing was sent
saved-submission: PASS
```

### Templates page works for a client with no row yet

```text
PASS the saved link shows on the page
PASS no page errors:
templates-no-row-browser: all passed
```

### Clean tab addresses and default landing

```text
PASS a client share link still lands on its calendar
PASS the share link address is untouched
clean-address-landing: PASS
```

### Onboarding page from the staff menu

```text
PASS a failed read shows its message
PASS an empty list shows its message
staff-onboarding-page: PASS
```

### Today phone actions on one line

```text
PASS 390px deck: no label is cut off
PASS 390px walk-through shows Open card, SyncLinear and Skip
today-phone-actions: PASS
```

### Production structure subset

```text
prod-structure-subset: artifact sidebar, list rows, status glyphs, detail cards, projects board, read-only controls, 0 recovered read retries, and 0 navigation-aborted reads passed
```

### Production read-only smoke

```text
SMOKE_STAGE mobile_detail
SMOKE_STAGE no_write_requests
prod-readonly-smoke: list, team filter, client filter, detail, deep link, batch link, projects board, mobile, guarded controls, no-write requests, and console checks passed
```

### Production comment thread

```text
prod-comments-browser: staff thread plus exact verified client-link SXR canonical projection passed
```

### Production component feedback

```text
  ok  keyboard retry and 360/768/desktop light/dark layouts preserve readable content
  ok  existing focus restoration keeps the feedback retry across failed refresh
Production feedback browser: 13 PASS; actual component source, fictional transport, zero external requests.
```

### Production write gateway

```text
--- phase: calendar_native_intake ---
--- phase: archive_park_sub_issues ---
prod-write-gateway-browser: mirror operations plus Submit and Calendar native intake passed
```

### Archived cards restore

```text
  ok  client link: forcing the opener does nothing and writes nothing

archived-restore-browser: all checks passed
```

### Calendar Frame folder button

```text
  ok  no browser errors []

calendar-frame-folder-button-browser: all checks passed
```

### Production interaction inventory

```text
prod-interaction-inventory: click states list:35, listSelected:30, filteredEmpty:24, detail:22, board:70, boardSelected:70, project:70, right-click menus, 16 hover tips, no writes/errors passed
```

### Production accessibility/focus

```text
prod-a11y-focus: 0 axe findings (0 serious/critical after scoped rules), control names, containment, focus/scroll, palette jump, Escape, keyboard navigation, 0 recovered read retries and 0 navigation-aborted reads passed
```

### Production layout polish

```text
prod-layout-polish: desktop, compact desktop, and mobile list/filter/project/card/menu clipping checks plus 0 recovered read retries and 0 navigation-aborted reads passed
```

### TikTok preview placeholder clearance

```text
[{"label":"video","overlap":false,"textRight":1107,"railLeft":1124},{"label":"photo","overlap":false,"textRight":1107,"railLeft":1124}]
tiktok-preview-empty-clearance-browser: placeholder clears the action rail ✅
```

### Kasper hiring reload

```text
[{"label":"fresh open","rendered":true,"path":"/kasper/hiring-process"},{"label":"reload 1","rendered":true,"path":"/kasper/hiring-process"},{"label":"reload 2","rendered":true,"path":"/kasper/hiring-process"}]
kasper-hiring-reload-browser: hiring renders on open and on every reload ✅
```

### Production wired behavior

```text
behav-wired: 168/169 (guard mode)
behav-wired failures: groupCollapse=false
BEHAV_WIRED_FAILED_CHECKS groupCollapse
```

### Production pixel parity

```text
pixel-wired (dark): list, icon paths, palette, selection/actionbar, signed-out status/context/due guards, bulk menu anchor, filter pill, filtered empty state, board drag/scroll, detail, browser history, no-write, and console checks passed
pixel-wired: light and dark passes completed
pixel-wired screenshots: D:\Sidney\Documents\Synchro\atlas-client-analytics\.codex-tmp\prod-pixel-wired
```
