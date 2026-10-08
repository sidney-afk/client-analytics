# Clients, loading and TikTok phone fixes

Clients had pale supporting labels, and closing its manager picker moved focus
to More after the native header repainted. Analytics loading retained a clipped
desktop table. Workload loading falsely claimed there was nothing overdue.
TikTok exposed an opaque provider identifier and pale instructional text.

- Clients fields, edit labels, menu metadata, history and research notes use
  readable supporting text. Manager dismissal follows the current trigger by
  stable ID, including Escape and backdrop dismissal after a native repaint.
- Analytics loading presents complete rounded phone cards with visible shapes,
  consistent spacing and a loading label. It retains the native table DOM.
- Workload loading keeps its unknown state without a false empty message.
  Its overview and calendar placeholders are visible in both themes.
- TikTok uses the selected client's trusted handle, with a plain selected-client
  fallback. Placeholders, preview headings and empty queue copy are readable.
  Provider routing and the existing chooser remain intact; desktop restores
  the original provider wording.

[Gallery](gallery.md) preserves 44 matched before/after pairs as complete pages,
with native viewport links. [Personal reviews](reviews.json) record 60 reviewed
phone cells at 393 x 852 and 412 x 915, light/dark: 56 CLEAN and four OPEN.
[PNG hashes](screenshots.json), [source binding](source.json) and
[capture/action receipts](capture-receipts.json) identify the exact evidence.
Full pages were inspected as unscaled chunks; viewports with different pixels
were separately inspected. Fixture fonts are served locally. Earlier failed
captures and intermediate attempts remain private historical evidence.

The native QA adds successful manager assignment and edit/save fixture actions,
search/list selection, research/history folds, Escape/backdrop focus return,
measured supporting-text contrast and font size, loader geometry and semantics,
and TikTok chooser/desktop restoration. Writes are intercepted fixture replies.
The before revision has eight reproduced picker-focus failures; the same
assertions pass after the fix. They were not weakened.

[Coverage](../COVERAGE.md) remains open for the full narrowed round and the
separate fresh-eyes round. Empty Clients still directs a person with zero
clients to search. That wording remains OPEN: main has a new Create client
flow that must be incorporated and reviewed before replacing the guidance.
Missing card-detail setups and remaining screen/action obligations also stay
OPEN. Old galleries do not transfer acceptance to this changed source.

[Checks](checks.json) contains actual terminal endings. [Desktop](desktop.json)
records exact 1440 px pixel and computed-style comparisons against the batch
parent, including phone-to-desktop restoration. These local fixture comparisons
do not claim deployed behavior. Hosted checks are a separate gate.

All screenshots use fictional identities. Chrome is headless throughout.
No database changes, n8n edits, live mutations or merge by Prism. This batch
is based on the preceding batch; Lighthouse reviews and merges each PR.
