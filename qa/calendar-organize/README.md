# Calendar → Organize menu (auto-organize by date)

**Contract: fully mocked, CI-safe.** These lanes serve `index.html` from a local
http server and abort every request that isn't to it. They never read from or
write to a live backend, and there is deliberately **no live lane** — the whole
point of the suite is that auto-organize performs no backend writes, and it
proves that by asserting on the requests it blocks.

```
node qa/calendar-organize/run.js             # interaction pass + 4 fuzz seeds
node qa/calendar-organize/run.js --quick     # interaction pass + 1 seed
node qa/calendar-organize/run.js --seeds=12  # widen the fuzz
```

There is intentionally **no `npm` script** for this lane. `package.json` is
content-pinned by the F27 reviewed closure (`REVIEWED_BLOB_SHA256` in
`scripts/f27-reconciler-closure.js`), so adding one changes its sha256 and fails
`test/f27-reconciler-closure.js` with `REVIEWED_CLOSURE_BLOB_DRIFT` until an
owner re-attests the pin. Not worth spending a security attestation on a
convenience alias.

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
  webhook was never reached. Finally it round-trips the localStorage strip cache
  with the mode ON, covering "leave it on, close the laptop, come back": the
  cached rows must still carry their original `order_index` and rehydrate to the
  manual order, never the date order. Takes a seed, so any failure reproduces:
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

## Known limits of these lanes

- The strip cache assertions read the stored payload directly rather than going
  through `_calCacheRead`, which is authority-gated and returns `null` without a
  write-UI authority snapshot this synthetic harness cannot mint. The gate is an
  orthogonal auth concern; what these lanes care about is what lands on disk.
- Everything here is mocked. These lanes prove the app never *asks* to write —
  which is the property that matters — but they are not a live-data run.
