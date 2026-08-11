# Calendar → Organize menu (auto-organize by date)

**Contract: fully mocked, CI-safe.** These lanes serve `index.html` from a local
http server and abort every request that isn't to it. They never read from or
write to a live backend, and there is deliberately **no live lane** — the whole
point of the suite is that auto-organize performs no backend writes, and it
proves that by asserting on the requests it blocks.

```
npm run test:cal-organize              # interaction pass + 4 fuzz seeds
node qa/calendar-organize/run.js --quick
node qa/calendar-organize/run.js --seeds=12
```

## What it guards

The Sheet tab's ordering mode (Organize → *Auto-organize by date*) promises two
things, and both are easy to break from a distance:

1. **Flipping it off gives back the exact hand-dragged order.** Auto mode is a
   render-time sort — it never writes `order_index`. Any change that lets a
   write slip through while it's on silently destroys the SMM's manual order,
   with nothing left to restore.
2. **Dragging stays suspended while it's on.** The strip's drop handler derives
   `order_index` from DOM order. Under a date sort, one drag would persist the
   date order over the manual one.

## Lanes

- **`interact.js`** — drives the menu the way a person does: open, change
  several settings without it closing, dismiss by outside-click and by Escape,
  watch a card re-place itself when its date is edited, toggle back, and follow
  the pill across view tabs.

- **`stress.js`** — the round-trip proof. Seeds a calendar whose manual order is
  gappy and disagrees with date order, snapshots every `order_index`, then runs
  120 randomised operations (toggle, filters, date edits, select mode, view
  switches, caption focus), forcing a return to manual + no filters every 10th
  step and asserting the strip is identical to where it started. It also fires
  the strip's real `drop` handler while auto-organize is on — the exact code
  path that rewrites `order_index` — and asserts nothing moved and the reorder
  webhook was never reached. Takes a seed, so any failure reproduces:
  `node qa/calendar-organize/stress.js 20260811`.

## History

The fuzz caught a real bug on its first run: `_calPromoteBlankCard` promotes a
just-saved blank card in place with no re-render, and hardcoded
`draggable=true`. A post created while auto-organize was on became the only
draggable card on the strip — grip reading "Drag to reorder", handlers wired,
and the drop handler reachable again. Both halves of the fix are pinned here and
in `test/calendar-organize-menu.js`.

Source-level assertions live in `test/calendar-organize-menu.js` (they pin the
shape of the code); this folder pins what the app actually does.
