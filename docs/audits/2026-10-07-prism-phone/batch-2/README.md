# Prism batch 2: Ads and Quiz on phones

Branch: `codex/prism-phone-batch-2`. Before capture commit:
`d4410a8449a848085b8a63dec05ef09cd8c7fb39`. Desktop comparison base:
`1770cc7104ac4fc7de5eeef7decc75e8c287550a`; its product fragments and built
index match the before capture commit. Lighthouse merged batch 1; Prism did not.

After source hash:
`7e94758fe7a6ba0f0b8dfe33ce152606f443c8b6461fc2855e0538cfa7273a96`.

[Before/after gallery](gallery.md), [HTML gallery](gallery.html),
[exact screenshot hashes](screenshots.json), [personal review receipts](reviews.json),
[current coverage](../COVERAGE.md), [actual check tails](checks.md).

## What changed

- Ads and Quiz loading states inherited six Calendar media/action skeletons
  extending over 5,000 pixels. Phone utility loading now uses one labelled
  160-pixel panel, shared with Save problems.
- Ads' Refresh label overflowed its narrowed button. The phone description now
  gets its own row; Refresh retains its padding and readable type.
- Ads' supporting captions were approximately 11 pixels, with insufficient
  light-theme contrast. Phone metric and section captions now use 13-pixel
  secondary text. Statistic labels reserve consistent room for wrapping.
- Nested empty sections and doubled card margins made the filled Ads dashboard
  unnecessarily long. Empty sections now sit within their existing panels.
- Ads' canvas legend provided small tap targets and dark-theme chart labels were
  faint. Phone series controls use native 44-pixel buttons that invoke the actual
  Chart.js dataset toggle. Axes use the current theme and intended font.
- Short phone chart dates preserve the ISO calendar day west of UTC; October 1
  stays October 1. The check asserts explicit October, DST-boundary and year-end
  dates, rather than deriving its expectation from the implementation.
- Quiz's Refresh/search spacing is compact. Both utility empty states use plain
  phone copy. Crossing to desktop restores the original copy and chart options.

Product CSS remains inside the existing owned `max-width:767px` block. Chart
presentation and copy changes activate only with that phone marker. Data,
calculations, transport, authorization and native filtering remain unchanged.

## Evidence and fixture repairs

The gallery contains 78 matched state/width/theme pairs, with both viewport and
full-content captures: 312 fixture images. All 78 named cells were personally
reviewed, or exactly match an inspected PNG with passing native action checks.
The final complete admin capture replay matches all 156 after images byte for
byte. This accepts these named states only; it is not a complete clean round.

The runner now uses the exact pinned production Chart.js 4.4.0 bytes, verified
by SHA-256. It checks native series taps, Enter/Space, theme changes, focus
preservation, desktop restoration, date ranges, name/email search and failed
Refresh/retry reads. Every data/action request is answered by a fictional local
transport. No live write or database change was made.

Earlier Ads/Quiz error fixtures incorrectly rendered successful empty screens.
Their load state now produces the native error screen, with an explicit assertion.
The booking fixture uses the real aggregate field; range fixtures use ascending
dates. These are evidence repairs, not backend changes.

Chrome's full-page mobile capture clipped short pages despite correct viewport
renders. Ordinary short screens now retain their real viewport, while long pages
also receive full-content captures. A PNG-dimension guard prevents accepting the
clipped artifact. Public label substitution is idempotent and settles two frames
before style measurement; this removed the reproduced desktop header-fit timing
mismatch. Original failures remain recorded in the check audit.

The owner requested headless Chrome with no foreground calls. The installed
Chrome launch was verified to include `--headless`; no visible-window adapter is
used for this batch's final checks.

## Still open

The coverage matrix has 1,974 width/theme cells and 280 discovery obligations.
The other cells remain OPEN. In particular, longer/mixed-year Ads timelines,
populated lead/ad tables, long Quiz names/answers, filtered-empty views, remaining
staff/client states, refused saves and the complete fresh-review round still need
their own valid fixtures, screenshots and action evidence. They are subsequent
work, not accepted exceptions.

The independent Filming information icon and unexplained empty instructions,
client thumbnail fallback and effective client-theme verification remain open.
Batch 1's historical Save problems reviews do not automatically carry into a
new source round: none of the current replay PNGs matched their earlier hashes.
They require current visual receipts despite passing regression guards.

Desktop's current broad comparison is a required gate before this batch is
published. Filled Ads already matches eight exact PNG/style pairs. Raw live TEST
captures remain private; only safe comparison metadata is published.

Rollback: revert this batch and run `npm run build:index`. Prism does not merge.
