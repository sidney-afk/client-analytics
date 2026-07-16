# SyncView UI design standards

This is the default acceptance contract for new or materially changed SyncView
interfaces. It captures recurring owner feedback so a feature is not considered
finished merely because its data and happy-path click work.

## Branded controls are mandatory

- Do not expose browser/OS-native select menus, date popups, or number-spinner
  arrows in a branded staff or client workflow.
- Reuse the neutral `sv-select`, `sv-date`, and `sv-stepper` primitives in
  `index.html`. They preserve real form values and change events while giving
  SyncView consistent light/dark styling.
- A select must support disabled options, outside-click close, Escape with focus
  return, Arrow Up/Down, Home/End, Enter/Space, typeahead, and complete
  combobox/listbox/option semantics.
- A date control must use the in-app calendar, honor live `min`/`max`, retain the
  server-provided policy date when one exists, support arrow and Page Up/Down
  keyboard movement, and return focus on selection or Escape.
- A numeric control must hide native spinner chrome and expose clear minus/plus
  buttons. It must clamp to the current business bounds; signed admin controls
  and bounded end-user controls are different configurations.

## Explain without adding noise

- Keep warnings, validation, policy boundaries, and recovery actions visible.
  Never put information required to complete a task only in a tooltip.
- Move supplemental definitions into short, plain-English `data-tip` help on a
  focusable info button. The shared tooltip must work on pointer hover and
  keyboard focus.
- Prefer a short heading plus contextual help over repeating a paragraph under
  every card. Labels should say what a value is; tooltips may explain how it is
  calculated or when it changes.

## Hierarchy, color, and layout

- Design around the user's next decision: primary status, primary action,
  personal history, then supporting context. Do not give every data block equal
  size or visual weight.
- Use color to identify a stable meaning such as type, status, warning, or
  selection. Typography and position carry hierarchy; avoid filling every card
  with saturated color.
- Avoid a page made only of same-sized boxes. Use a summary strip, a clear main
  workspace, compact activity rows, progressive disclosure, or a contextual
  rail when those better match the task.
- Use existing theme tokens only. Every state must remain legible in light and
  dark themes.

## Interaction and responsive acceptance

Every new control or layout is reviewed at approximately 360 px, 768 px, and a
desktop width. Acceptance includes:

- mouse, keyboard, and touch-equivalent operation;
- visible hover, focus-visible, disabled, error, loading, empty, and success
  states;
- 44 px touch targets where space permits, no clipped popovers, and no
  unintended horizontal page overflow;
- meaningful labels and ARIA state, logical tab order, Escape behavior, and
  focus restoration;
- reduced-motion-safe transitions and no interaction that depends on hover;
- open-dropdown, open-calendar, focused-stepper, tooltip, validation, empty,
  dark-theme, and mobile visual checks in the feature's review evidence.

For sensitive features, use synthetic examples in tests, mockups, screenshots,
and public documentation. Never use real client, staff, HR, credential, or
balance data as design fixtures.
