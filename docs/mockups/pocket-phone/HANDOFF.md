# Complete Pocket design handoff for Claude

**Review the interactive work before proposing implementation. This is a draft
design PR. No product code, merge, deployment or new client mutation is authorized.**

Start with [gallery/gallery.html](gallery/gallery.html), downloaded and opened
locally in visible Chrome. GitHub renders its source rather than running it.
The file is standalone and works offline. Explore every tab and state, both
directions and both themes; scroll inside the phones to reach the lower sections.

## What is supplied

The [complete ZIP](pocket-phone-review.zip) bundles the gallery, sources, boards,
notes and evidence. Extract it and open `gallery/gallery.html`; the remaining
files are available beside it for source review.

| Artifact | Purpose |
|---|---|
| `gallery/gallery.html` | Complete interactive gallery: 45 states × A/B × light/dark = 180 phone presentations. Local fonts, media, styles and fixtures are embedded. |
| `gallery/gallery-shell.html` | Editable gallery navigation, group/state descriptions, theme controls and A/B comparison shell. |
| `gallery/phone-shell.html` | Editable phone frame, title row, Tabs/More, overlay and preview notice. |
| `gallery/preview.js` | Complete preview renderer and local interaction handlers. Writes and external link opening are disconnected. |
| `gallery/original-skin.css` | Captured native styling used by the prototype; unused external asset URLs removed for portability. |
| `gallery/phone-polish.css` | The complete phone layout and light/dark polish developed in this design session. It is not loaded by the product. |
| `gallery/snapshots.json` | All 60 screen and menu DOM structures, with sensitive content replaced by examples. No executable native event handlers. |
| `gallery/states.json` | All 45 selectable states and their visible titles. Public fixture route identifiers are normalized where necessary. |
| `gallery/calendar-thumbnail.png` | The test-content thumbnail already used in the approved comparison boards. |
| `gallery/example-chart.svg` | Synthetic illustration replacing private global advertising data. Not a live result or an invented client analytics result. |
| `gallery/fonts/`, `gallery/fonts.css` | Local Plus Jakarta Sans weights and the upstream SIL Open Font License. |
| `gallery/build-gallery.cjs` | Rebuilds the standalone gallery from these sources; no application output is touched. |
| `gallery/check-gallery.cjs` | Reproducible visible-Chrome checks of the exported preview. Requires the repository's Playwright dependency and installed Chrome. |
| `gallery/check-privacy.cjs` | Read-only export scan against the current public roster, including test identifiers; reports counts without printing identities. |
| `gallery/check-source-equality.cjs` | Reproduce the byte comparison against a separate checkout of this PR's merge base. |
| `gallery/desktop-visible-adapter.cjs` | Portable version of the earlier headful desktop-gate adapter. Existing assertions/timings remain intact; required private inputs are not supplied. |
| `calendar-comparison.png`, `review-comparison.png` | The original curated before/proposed and client/Kasper comparison boards. |
| `evidence/qa-*.json` | Complete original layout, menu, interaction, bottom-section and gallery measurement reports, before portable export. |
| `evidence/design-findings.json` | Earlier measurements that drove polishing. Historical issues, not the final result; compare the final measurement reports. |
| `evidence/section-structure.json`, `evidence/export-structure.json` | Captured section inventory and the complete public-export structure inventory. |
| `preview-checks.txt`, `pr-checks.txt`, `export-checks.txt` | Original prototype results, earlier PR gates and the separate export verification. Red/unproven results stay red/unproven. |
| `README.md` | Owner decisions, workflow-preservation contract, state inventory and future implementation gates. |

The public package preserves the full design and interaction work. Raw signed-in
captures, actual review URLs, account/contact/credential details, private message
bodies, sensitive HR values and private runtime inputs stay excluded. Global
administrative examples are illustrative. Empty client queues and empty client
analytics remain empty; populated review examples are explicitly labelled.

## Design decisions and polishing already completed

- Removed the separate phone branding/workspace header. Tabs and More share the
  title row; Calendar Tools stay above the cards. Organize and card sizing are
  reached through More.
- Developed both Expanded and Compact placements for every surface. Compact
  uses disclosure for long forms, workload details, messages and review sections.
  Collapsing a section does not change its decision or completion state.
- Tuned light/dark surfaces, text contrast, fields, menus, card spacing, lower
  sections and long tables. Week views show the current seven-day range on phones.
- Kept Calendar caption, CTA, dates, media, component statuses, selection and
  notes in their familiar course of actions. Added preview exploration of alternate
  caption platforms, switching, draft retention and removal confirmation.
- Kept three separate Calendar review decisions and two Samples decisions.
  Typing a review note disables approval and enables comment/change choices;
  clearing the draft restores the original enabled state.
- Preserved Collaborative client caption/CTA/date editing and Suggest a post,
  with existing card names locked. The staff Clients section is not treated as
  a public client-link role.
- Preserved Kasper's queue, example review, routing controls and completion gate,
  with its secondary sections available through navigation and More.
- Corrected platform visibility: TikTok video/carousel and Instagram video with
  image/frame cover use separate captured forms. Only the selected platform's
  form/action footer is displayed. Instagram has no photo-carousel choice.
- Retained native hidden/disabled states so loading, missing-media and action
  gates are not exposed by broad preview CSS. File picking and business writes
  remain disconnected; the prototype is not production upload functionality.
- Kept all three Submit choices. Compact retains one expanded video and the
  existing batch actions near the bottom. Today, Workload and Linear retain
  their current queues, detail structures and existing route meanings.

## Reproduce the preview checks

Opening the gallery needs no dependencies. Rebuilding needs only Node:

```text
node docs/mockups/pocket-phone/gallery/build-gallery.cjs
```

From the extracted ZIP's root, the equivalent command is
`node gallery/build-gallery.cjs`. Browser verification needs a repository
checkout with its Playwright dependency; it is not needed just to use the ZIP.

With repository dependencies installed and Chrome available, run the prototype
checks into a new local directory, outside tracked evidence:

```text
node docs/mockups/pocket-phone/gallery/check-gallery.cjs <local-report-directory>
```

Set `POCKET_CAPTURE=1` to capture every state in both themes with both layouts
shown together. The checks cover 360/375/390/430 portrait and 667/740 landscape
widths. They launch visible Chrome, never headless. They are separate from the
existing product phone gates and desktop screenshot-diff gates. Preview passes
cannot clear a product or deployment gate.

## What Claude should do next

Review every state and the recorded interactions against the desktop workflow.
Report concrete remaining design or behavior inconsistencies with the affected
tab/state, A/B direction and theme. Call out unproven loading, saved-copy,
recovery, focus and keyboard behavior; do not infer those from static fixtures.

Help the owner decide placements and a starting tab. The owner has not selected
the first implementation slice. Do not turn this design packet into a multi-tab
product implementation PR. After the owner's go, work one tab per PR using its
own `src/index` fragments and `npm run build:index`. Phone rules belong inside
phone-width media queries. Desktop must remain unchanged and needs the existing
gates plus before/after desktop screenshot diffs on every implementation PR.

The earlier desktop gate is still FAIL/UNPROVEN as recorded in `pr-checks.txt`.
The matching baseline truth/unit failures are not repaired by this export.
Only the designated test workspace may be used for a future live browser pass.
No identity or secret may be committed, including in screenshots. Run the
identity exposure check after committing, keep `OPEN_REPAIRS` append-only,
and leave merging to Lighthouse. Pocket never merges.

No live data was changed while packaging this offline handoff. Earlier capture
issued one test review link through Share; it changed no post status or message.
Actual token usage is not exposed by this session and is not estimated.
