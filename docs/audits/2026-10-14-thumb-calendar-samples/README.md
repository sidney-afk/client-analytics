# Thumb — Calendar and Samples phone build

Owner approved [mockup #2082](https://github.com/sidney-afk/client-analytics/pull/2082).
This implementation changes staff phones only. It is prepared for review, not
merged or deployed. [Actual screen gallery](gallery.html).

- Sheet opens as a three-column thumbnail grid. Grid/List is always in reach;
  List retains the existing editable cards and all their handlers. Display
  preference persists separately for Calendar and Samples.
- A tile pushes into its native card editor, with a back arrow. Back restores
  the collection, scroll position, tile focus and edited values. Browser Back
  consumes only this phone navigation entry, without remounting its client.
- Review posts / Review samples is the collection's single primary action.
  Selection and Calendar's bulk captions move into More. This follows the
  approved workflow judgment: scan and review before publication; bulk work is
  supporting work. Existing component approval guards and writers remain native.
- More groups Work on content, View & organize, Preferences, and Tools & account.
  Profile links leave the toolbar. Native sort/status/card-size controls,
  permissions, archive, imports, client collaboration, prompts, credentials,
  appearance, quick jump and account controls remain available.
- Main gained Notify client during the build. The branch was refreshed onto
  `b98f90f9e903d873358388a446430d4bbc082a07`; that existing button is preserved
  in More's content group with its native permission, confirmation and send path.
- Calendar's Month/Week share the Calendar view sheet. Samples keeps its
  existing video/graphic contract, without adding dates or a caption writer.
- Headers and the primary action remain in place while content scrolls inside
  the viewport. Selection uses its own clipped list and action region, so the
  bar does not cover live card controls. Sheets retain scroll locking, Escape,
  inside taps, outside dismissal and focus restoration.

No database, Edge Function, auth, client-link, notification delivery or writer
contract was changed. All browser evidence uses intercepted fictional fixtures;
no live mutation or message was sent. No real client or staff identity is used
as new evidence. Physical-device and deployed behavior are not claimed.

## Verification

[Check receipts](CHECKS.md) retain real command tails, earlier failures and their
resolution. The primary regression suite captures 25 states in both themes at
390 and 430; the 50 required 390px light/dark images are in the gallery. The
desktop folder contains an exact before/after 1440px pair plus its equality
receipt; the public images omit the unchanged staff header for identity hygiene.
The private run compares the full desktop and all computed styles.

The shared phone artifact itself is unchanged and remains byte-identical to its
source. The new styles are separately staff-scoped and capped at 767px, and new
nodes are mounted only for standalone staff Calendar/Samples. Desktop resize
restores the original controls and removes the phone presentation.

## Intentional test journey changes

No assertion was skipped, no CI exception was added, and no existing test was
disabled. The CI phone job also runs the new `qa/staff-phone-collections.js`.

| Existing runner | Why its journey changed |
|---|---|
| `staff-phone-browser.js` | Shared visible-control helpers enter List, choose Month/Week through Calendar, and expand Content tools. |
| `qa/staff-phone-final-pass.js` | Existing editable-card cases enter List; segment measurements include visible buttons; Month/Week use the new chooser. |
| `qa/staff-phone-rules-browser.js` | Caption/status regression journeys enter the retained List. |
| `qa/staff-phone-design-browser.js` | Existing native card/action checks enter List. |
| `qa/staff-phone-round-two.js` | Assert the four approved More sections instead of Appearance/Tools/Account. |
| `qa/staff-phone-responsiveness.js` | Grid tiles count as useful content; only visible view segments are measured; all strict performance assertions remain. |
| `staff-calendar-expanded-browser.js` | Use List, the Calendar chooser and the Content tools disclosure. |
| `staff-selection-samples-browser.js` | Use List and More → Select cards instead of the loose toolbar button. |
| `notify-client-browser.js` | Open More to reach the native phone action; retain desktop placement and all colour, target, permission and request assertions. |
| `calendar-refresh-scroll-browser.js` | Scroll and measure the actual phone content region; enter the retained editable List for its existing Sheet journey. All movement, focus, caret and pixel assertions remain unchanged. |

Background refresh now captures the phone content scroller itself, in addition to its nested scrollers. Grid tiles have stable IDs and participate in the existing anchor/focus restoration. The collection suite also prepends a complete row and asserts visible tile position and focus in both areas, widths and themes. Existing screenshot provenance remains the capture version; this follow-up changes restoration and stable IDs, without changing the pictured layout.

The shared popup suite also enters the retained List and covers the new Calendar view sheet. The populated desktop helper now assembles both builds in the same format, matching the existing desktop-parity gate; pixel and style equality assertions are unchanged.

## Review and recovery

Keep this PR unmerged. Workload is a separate fresh-main PR. Messages remains
last and may begin only after #2083 merges. Closing the mockup PR after this
build PR opens records approval; it does not authorize merging this build.

If a merged release later needs recovery, revert this implementation PR and
rebuild its generated assets. There are no data migrations or backfills to undo.
