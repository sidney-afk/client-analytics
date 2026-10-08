# Today empty view and Notes

An empty Today view showed five zero-item job tiles before its All clear panel.
Phone Notes used small, unfinished labels, and an unavailable Samples thread
invited typing without a composer. This batch removes those distractions while
retaining native controls, drafts and the existing authorization refusal.

- Empty Today omits the redundant job grid; nonempty jobs and loading retain it.
- Calendar/Samples Notes uses readable About and Type labels on phones.
- Unavailable empty Samples Notes shows one compact message in plain language.
  Available Notes restores its feed when opened afterward. Existing threads
  are not collapsed. Desktop restores its original labels, wording and layout.
- QA reuses the existing native fixtures with the owner's 393 x 852 and
  412 x 915 phone profiles. It fixes Today fixture setup before boot so empty,
  error and held loading screenshots actually depict those states. Calendar
  and Samples gain explicit native loading, no-posts, long-content and many-card
  setups. Clients gains normal loaded-empty and held-loading fixtures.

[Before/after gallery](gallery.md) contains 18 complete native viewport pairs.
[Personal reviews](reviews.json), [PNG receipts](screenshots.json) and
[source binding](source.json) identify the exact reviewed cells.
[Coverage](../COVERAGE.md) uses desktop 1440 x 900 and the two phone profiles;
staff uses light/dark and client pages use their supported light theme.
18 cells are CLEAN. Remaining cells and discovery obligations are OPEN.
This is a batch, not a clean full round or a fresh-eyes acceptance round.

[Checks](checks.json) records real terminal tails. [Desktop proof](desktop.json)
records 32 exact 1440 px pixel and computed-style pairs; raw live read-only desktop captures
remain private. Native fixture proofs additionally exercise loaded/empty/loading
Today in both themes and Notes opened cold and after a phone-to-desktop resize.
The existing 360/390/430 client CI assertions remain and are not weakened.
The full legacy staff inventory completed with 524 renders and zero problems.
This is a regression check, including out-of-scope tabs, rather than acceptance
of its historical device sizes. Finch discovery captures drawn with fallback
fonts remain unaccepted and are being retaken with verified fixture fonts.
The native Today/Notes gallery uses separate font-served fixtures.

Deferred work: Analytics loading geometry and TikTok's opaque account label
need native verification in the next batch. Clients supporting text needs measured contrast and a further
review; remaining native menus, card-detail states, full desktop state coverage
and the complete phone round remain open. Calendar Week header clipping was
refuted with native screenshots and control bounds, so no speculative change
was made. Filming, Quiz, Save problems and other unlisted surfaces are outside
the owner's narrowed review scope. The unfinished Filming prototype and failed
fixture attempts are preserved privately rather than presented as passing proof.

All published screenshots use fictional identities. All local browsers are
headless. No database changes, live mutations, n8n changes or merge by Prism.
Lighthouse reviews and merges. Hosted checks and live deployment are separate
from local proof and must not be inferred from this gallery.
