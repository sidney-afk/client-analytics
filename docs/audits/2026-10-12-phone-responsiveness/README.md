# Staff phone responsiveness and polish

Prepared on one branch. Not merged or deployed. All application data and save
traffic in these tests are fictional and intercepted; live client data was not
used. Browser checks run without taking focus from the owner's screen.

Open the [before/after gallery](gallery.html), [speed measurements](SPEED.md),
[raw before measurements](before-measurements.json),
[raw after measurements](after-measurements.json),
[check receipts](CHECKS.md), and [desktop pixel differences](desktop-parity.json), and
[populated desktop comparisons](desktop-populated-parity.json).

## Calendar

- A keyboard or browser toolbar changing the phone's height closed an open
  status or **Set all to** sheet. Height changes now keep it open; width changes
  and leaving phone mode still follow the original dismissal rules.
- Refresh and Retry replaced useful cards with skeletons and could discard the
  visible draft. Staff phones now use the existing background-refresh path
  whenever cards are already available. Errors keep the saved copy and native
  unsaved-state warnings; Retry still calls its original handler.
- Retry was a tiny span in the header. It is now a labelled, keyboard-accessible
  44 px action near the bottom of the phone, with space reserved underneath the
  content. It does not push the header down when an error arrives.
- A caption or field update scanned every card and every popup. Caption labels
  update locally; unchanged title sizes are reused. Ordinary touch actions no
  longer build a hover tooltip that the phone CSS hides. Explanatory labels
  retain their touch and keyboard help.
- Outside-click handling rewrote an already closed client search, making a
  caption tap scan unrelated menus. The phone path skips that redundant write.
  Unchanged viewport dimensions also avoid redundant style writes.
- Caption expansion reuses its measured height and observed width. A height-only
  resize notification no longer forces another width measurement. Text, font,
  reveal and width changes retain the native remeasurement path.

The test deliberately expands a long caption in a 20-card feed, not just an
empty page. New machine checks assert zero unchanged-title writes, zero hidden
ordinary tooltips, zero unrelated popup scans, zero width reads on a cached
caption tap, and locally correct Show more/Show less and ARIA state.

## Samples

The same height-change, retained refresh, accessible Retry, local field work and
closed-client-search rules apply. Samples retains its existing two-part review
workflow; no caption controls or decisions were added. Review and Sheet use the
shared staff-phone segmented control.

## Workload

The overloaded editor count previously wrapped three lines inside a circle. It
now fits a 44 px pill on one line, keeping the exact workload count, capacity,
overage and native detail action. The fixture schedules seven tasks against a
capacity of four and verifies both the visible count and the opened detail.
Week/Month, team and planning segments use the same phone styling.

## SyncLinear and other staff screens

Active/Backlog/All issues, Today Rings/Walk-through, upload platform/queue tabs,
Analytics detail tabs, Templates knowledge tabs and reviewer segments share one
phone-only shape, spacing, label size and selected surface. Dark selections use
the existing raised-surface variable. Existing actions and permissions remain.

The legacy reviewer/admin More sheet gained a labelled 44 px Close button and
readable enabled rows and group headings. Close calls the native More toggle;
the added heading is removed on returning to desktop.

## Measurement method and practical limits

The speed table covers 13 primary entries at 390 and 430, light and dark. Cold
content is the median of those four cells; tap is their slowest measured first
response. Each Tabs and More sheet opens and closes twice, with an inside tap,
touch Close and Escape. Calendar, Samples and SyncLinear also time a regular
native action. Other table rows time the main menus, not every individual button.

The profile disables cache, adds 150 ms RTT, uses 1.6 Mbps download / 0.75 Mbps
upload and 4x CPU slowdown. Local HTML/JS/CSS is gzip compressed, matching the
public serving response. Fictional backend replies add one RTT; their payloads
do not model real backend throughput. Browser performance and animation-frame
clocks remain native. Only Date is fixed for reproducible fixture dates.
Calendar/Samples cold entry includes selecting the fictional workspace after
bootstrap; Instagram includes the native platform switch.

Cold startup remains around several seconds on this deliberately constrained
profile. The shared script/bootstrap cost was not redesigned in this polish
change. Some dark 20-card caption trials still exceed the new 250 ms stress
budget; the recorded failures and final measurements are retained. These are
not physical-phone, deployed-service or live-save measurements, and this report
does not certify every arbitrary data combination as flawless.

Raw layout-shift entries include scripted fixture selection and mounting, so they
are not isolated live-service CLS scores. Refresh continuity is checked directly:
cards and the draft must remain visible while the read is pending and when it fails.

The complete native phone inventory and existing Expanded tests cover additional
dialogs, loading, empty, error and saving states. The reviewer/admin timing is
for its main entry; every admin subpage was not cold-timed independently.

The app CSS and JavaScript were edited in source fragments and built with
`npm run build:index`. Desktop proof compares exact pixels and computed styles at
1024, 1280, 1440 and 1920, with additional populated and phone-to-desktop fixtures.
Native desktop captures stay private; committed difference images contain only
the pixel difference, and the receipt records both original screenshot hashes.
Earlier mismatches and failed timing attempts remain described in CHECKS.

The existing Time Off fingerprint coupling passes under the CI single-file
preload. No unrelated public PTO evidence was regenerated.

## Security boundary

The owner explicitly allows the required identity gate to read roster names/slugs
for diff checking. That exception applies only to the leak check. All browser
and save tests retain the ban on other clients' real data. The earlier guarded
identity invocation was refused before making that roster read; its receipt is
kept in CHECKS alongside the final authorized result.
