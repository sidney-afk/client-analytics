# Final phone batch: native pickers, readable sheets and truthful loading

The New client manager control now uses the branded picker on a phone, including
loading, empty, unavailable, busy and refused-save states. Workload separates
identical-looking post groups without redirecting their native actions. Card
detail sheets have readable metadata, comfortable links and editors, and a
contained menu. Onboarding instructions and pending Analytics labels are readable.

The reported Clients loading heading loss was refuted in the native held-read
fixture at both phones and themes. Its heading and actions already persist on
main. This batch adds lifecycle evidence rather than claiming a product repair.

The full discovery round found more repairs: false empty Calendar loading,
faint or oversized loading placeholders, tiny preview labels, low-contrast
placeholders, a tiny Pin close glyph, crowded month filter rows, faint Today and
Workload labels, and obsolete disconnected-upload instructions. A shared overlay
focus race also overrode the manager menu's correct native focus restoration
after resizing; it now preserves that native restoration.

All Expanded drafts were personally reviewed before applying their product
changes. Rejected drafts include invalid nested `:has()` selectors and selectors
that missed the client loading wrappers. Native geometry guards cover the
corrected cases. Headless Chrome preserves the owner's foreground game.

The final round also repaired wrapping post-title editors, cramped caption menus,
faint prompt and Calendar helper text, desktop keyboard instructions on touch
screens, the card comment footer overflowing its sheet, tiny Analytics controls,
crowded Workload timelines, and overlapping TikTok queue metadata. Calendar
archive confirmation now describes the native archive rather than a retired
spreadsheet. These changes are phone-scoped; native actions and save payloads
retain their existing behavior.

## Acceptance status

**Finish line reached for the narrowed scope:** the complete round and the
separate fresh-eyes round both conclude, “this is good, nothing looks weird.”
Lighthouse's independent spot-check and hosted CI remain pending. There are no
OPEN phone cells or discovery obligations in this scope.

[Coverage](../COVERAGE.md) inventories 279 states, 1,452 device/theme cells and
85 discovery obligations. Phone cells bind exact PNG hashes to their personal
review and passing action lane. Desktop cells point to the identity matrix;
they do not claim 279 separate desktop-state screenshots. Two legacy client
Samples confirmation cells are inapplicable: native client approval saves
directly; the destination chooser is staff-only. Today has no save control;
its editing/refusal journeys are covered in Calendar, Samples and card detail.

[Full round](round-full.json): 2,761 native captures. [Fresh-eyes
round](round-fresh.json): 2,756 independent captures. Every screenshot was
personally examined in unscaled crops; identical pixels within one round share
judgment, with no review carried from the first round to the second. Counts
include viewport, scroll-stop, full-page and preserved settling captures.
[Complete gallery](gallery-all.html), [70 before/after pairs](GALLERY.md), and
[Expanded drafts](gallery-expanded.html) are available for independent review.
Images contain fictional fixtures and retain their original PNG bytes.

[Desktop identity proof](desktop.json): 182 exact 1440 × 900 screenshot and
computed-style pairs, including cold loads and phone-to-desktop restoration.
All PNG byte hashes match main; all computed styles match without tolerance.
Desktop images stay private because their navigation retains native identity
labels; public receipts contain hashes. The baseline is freshly fetched main
`1be85475fb8ccc97df9518dfed412980d39e4c47`, which includes batch 6.

[Action receipts](round-full-actions.json), [fresh action
receipts](round-fresh-actions.json), and [every preserved check's actual final
lines](check-receipts.json) distinguish accepted runs from historical failures.
Three corrupted QA Unicode expectations were restored exactly and rerun;
no assertion was relaxed. An empty-thumbnail fixture could race the native
delayed focus and retain text. Its original captures were rejected; explicit
empty-value guards now pass before and after independent recaptures in each
round. [Restoration details](qa-restorations.json) preserve these limitations.

Devices: iPhone 393 × 852 and Android 412 × 915. Staff light/dark; client links
use their native light theme. Desktop proof compares exact 1440 PNG bytes and
all computed styles, including cold loads and phone-to-desktop transitions.

All data is fictional and transports are intercepted. No live writes, database
changes, n8n edits or GitHub merge. Hosted checks and Lighthouse acceptance are
separate gates. Earlier failed receipts are preserved alongside corrections.

These are headless Chromium device fixtures, not physical-device or deployed
production proof. Keyboard resizing is simulated, and TikTok media fixtures
exercise queue controls rather than real playback or provider delivery. All
main actions are exercised against intercepted transports; no live client was
mutated. Quiz, Save problems, unlisted tabs and rare states outside Today,
Calendar and Samples remain excluded by the owner's narrowed scope.
