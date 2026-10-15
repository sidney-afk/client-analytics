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

## Every pop-up closes the same way (layers)

Every pop-up, menu, dropdown, expanded panel, sheet and modal on the staff
screens joins the shared layer list in `src/index/041-core-layers.js.part`
(`svLayerOpen`, `svLayerOverlay`, `svLayerRelease`). One key listener and one
pointer listener serve the whole site, so the five rules cannot drift:

1. Escape closes it. With two open, Escape closes only the top one.
2. A click outside closes it. A click inside never does.
3. Focus returns to the button that opened it, on Escape, on a pick and on an
   outside click onto empty space (not when the click landed on another control).
4. Closing never loses typed text. The pop-up keeps its OWN close routine (the one
   that saves, keeps a draft, or asks "discard?"). The layer list only decides
   when to call it, and a close the pop-up refuses leaves it open.
5. A background refresh never closes it or takes its focus. A redrawn pop-up
   calls `svLayerOpen` again with the same key; `svLayerTouches` lets a redraw of
   the page around an open pop-up wait.

A new pop-up must register itself. `docs/syncview-design/tests/popup-behaviour-browser.js`
opens each registered surface with a real click and checks all five rules at
desktop width and at 390px; add one entry per new surface. The client link pages
(`?c=`) do not register layers: their approve and request-changes code is not
touched by this work.

## Explain through the label, not an icon

- Keep warnings, validation, policy boundaries, and recovery actions visible.
  Never put information required to complete a task only in a tooltip.
- Labels are hover-explainable. When a stat, field, or section needs
  supplemental explanation, make its visible label or title the help trigger
  and put the short, plain-English explanation in shared `data-tip` help.
- Do not add info-icon badges: no circled `i`, standalone `i`, question mark, or
  separate help-icon control beside the label. Give the label itself a subtle,
  non-layout-shifting hover and focus affordance.
- The shared SyncView explanation must stay visible while the pointer remains
  over its label and show the same content on keyboard focus. Pointer leave,
  blur, or Escape dismisses it.
- On touch or other no-hover devices, tapping the label toggles its explanation
  and tapping elsewhere dismisses it. A help tap must not accidentally open or
  change the associated field. Explainable labels must remain keyboard
  reachable and expose the same explanation to assistive technology.
- Explanation placement must stay inside the viewport in light and dark themes.
  Decorative explanation motion must be disabled under
  `prefers-reduced-motion`.
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

## Dark mode colour

- One meaning, one colour. Success is `--up` green (`#4ade80`), warning is amber
  (`#fbbf24`) or orange (`#fb923c`), error is `--dn` red (`#f87171`); the same
  hue is used for the solid button, the pill, the ink and the icon.
- A solid action button (Approve, Request change, delete) takes its fill and its
  label from the `--ok-solid-*`, `--warn-solid-*` and `--err-solid-*` tokens. In
  dark mode they are a bright fill with a dark label; never put `--white` or a
  fixed white on a fill, because `--white` is the dark surface in dark mode.
- A disabled control keeps a readable label (`--disabled-fg`) and says "off"
  through a quieter fill, not by fading its text with `opacity`.
- `node test/dark-contrast.js` enforces WCAG AA in dark mode (4.5 to 1 text, 3 to 1
  icons and focus rings) for the named colour pairs and for every rule that sets
  a colour and a background from tokens. Add a pair there when you add a new
  family of colours. A colour on one rule and its background on another is not
  visible to it, so those still need a screenshot check.

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
- open-dropdown, open-calendar, focused-stepper, validation, empty, dark-theme,
  and mobile visual checks in the feature's review evidence;
- explainable-label checks for sustained pointer hover, keyboard focus with
  Escape and blur dismissal, touch tap with tap-away dismissal, no accidental
  field activation, viewport containment, and reduced-motion behavior.

For sensitive features, use synthetic examples in tests, mockups, screenshots,
and public documentation. Never use real client, staff, HR, credential, or
balance data as design fixtures.
