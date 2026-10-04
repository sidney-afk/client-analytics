# Client Calendar · Expanded phone batch

This slice builds the actual client Calendar in `src/index/`: Review with a post
open, Sheet, Month and Week. The owner can review this batch while the next batch is prepared from main.
Other staff screens and the remaining client screens are not built by this PR.

The title, Tabs and More share one row. Sheet uses comfortable separate cards;
Review keeps every component section visible inside an open post. The existing
Approve, Comment, Request change, Notes, media links, date controls, view switching
and permission checks remain. Organize and card size move into More. Section navigation
never writes: unsent drafts, pending decisions, sending and failed saves keep
explicit labels. Existing skeletons and saved-copy handling remain. Client links
stay light even if the browser has a saved dark preference.

Every new style is under `@media (max-width: 767px)` and starts with
`html.boot-client`. Phone markup and section behavior additionally require a
client link and that same width. Crossing back to desktop restores the original
client tabs. Staff phone design is a later slice.

## Review the screenshots

Open [the screenshot viewer](gallery.html) locally to select 360, 390 or 430,
compare before and after, and inspect the additional built states. Scroll inside
the phones. These images come from the real generated app with fictional data,
not a separate prototype. All visible names, cards and URLs in them are fixtures.
Unavailable media is shown honestly; no invented preview replaces it.

| View | 360 before / after | 390 before / after | 430 before / after |
| --- | --- | --- | --- |
| Review · post open | [Before](before/review-360.png) / [After](after/review-360.png) | [Before](before/review-390.png) / [After](after/review-390.png) | [Before](before/review-430.png) / [After](after/review-430.png) |
| Sheet | [Before](before/organizer-360.png) / [After](after/organizer-360.png) | [Before](before/organizer-390.png) / [After](after/organizer-390.png) | [Before](before/organizer-430.png) / [After](after/organizer-430.png) |
| Month | [Before](before/month-360.png) / [After](after/month-360.png) | [Before](before/month-390.png) / [After](after/month-390.png) | [Before](before/month-430.png) / [After](after/month-430.png) |
| Week | [Before](before/week-360.png) / [After](after/week-360.png) | [Before](before/week-390.png) / [After](after/week-390.png) | [Before](before/week-430.png) / [After](after/week-430.png) |

Additional images at all three widths: caption, thumbnail, thumbnail lightbox,
Tabs, More, Organize, date picker, Notes, native blank post suggestion, Month/Week post previews, sending,
save failure, loading, read failure and empty. The synthetic measurement receipt
is [after/measurements.json](after/measurements.json).

## Real browser and real saves

All local browser checks used visible Chrome. The candidate app was served from
the local branch while retaining the signed-in test client's existing backend.
This is candidate proof, not deployment proof.

The Expanded save proof clicked Approve and Request change at 390px
on a disposable test card. The normal app reader confirmed Approved with its
sign-off timestamp, then Tweaks Needed with the exact note saved. The card was
archived and read back as Archived. No other client was changed. The identity-free
receipt is [live-saves.json](live-saves.json). Read-only checks of all four views
at 360/390/430 confirmed light mode and no page overflow:
[live-layout.json](live-layout.json).

Offline browser gates check every visible control they visit, including disabled
controls, against 44px; editable fields against 16px; and page width against
sideways overflow. They also exercise native navigation, section drafts,
errors, keyboard dismissal/focus restoration and breakpoint changes. The
existing Calendar/Samples phone action gate still covers five phone sizes each,
including landscape. The transport gate retains its existing save assertions;
its conditional disclosure helper remains compatible with earlier folded layouts.

## Desktop and check results

The repaired desktop gate is taken from parked PR #1951, without its UI changes.
It compares the base's own assembled fragments with the candidate's assembled
fragments so a loader-versus-single-file mismatch cannot masquerade as a change.
The read relay also holds one in-memory response snapshot per pair, including
media failures: transient thumbnail responses had produced false differences on
Month and Week. Both sides now receive the exact same inputs; pixel/style
assertions, four retries and settle timings remain unchanged. A separate offline
relay check proves that cached responses cannot bypass the existing write refusal.
The final Expanded comparison passed **68/68** at 1024/1280/1440/1920 for every staff header tab and
the designated test client's views. Each width uses the unchanged gate timings
in visible Chrome. Raw client desktop images stay private because they contain
identities; the public equality/hashes receipt is `desktop-parity.json`.
Identity-free staff Calendar screenshot pairs are also included:
[1024 before](desktop/calendar-1024-before.png) / [after](desktop/calendar-1024-after.png),
[1280 before](desktop/calendar-1280-before.png) / [after](desktop/calendar-1280-after.png),
[1440 before](desktop/calendar-1440-before.png) / [after](desktop/calendar-1440-after.png),
[1920 before](desktop/calendar-1920-before.png) / [after](desktop/calendar-1920-after.png).
Public desktop captures include only the content below the staff header; the full native screenshots and all 68 whole-page comparisons remain in the private proof. Their exact PNG-byte comparison is [desktop/public-pairs.json](desktop/public-pairs.json).

The actual final lines of local checks are in `checks.txt`. Two checks have
known baseline failures and are **not green**: the Production write browser gate
fails its desktop editor placement assertion on unchanged main too; the full
unit lane has baseline failures reproduced on unchanged main. Those are reported
as failures, not waived. Required private-input profiles and hosted CI are
separate from the local proof.

No merge, deployment, database/schema change or n8n workflow edit was performed.
Lighthouse owns merging. Next action for the owner: review this checkpoint and
review the phone layout; revisions take priority over opening another PR.
The cumulative goal token count is reported in the handoff. It includes prior
work in this goal; a separate per-PR token count is not available.

## Saved copies and visible-browser setup

The viewport repair preserves the last visible layout when Chrome briefly uses
a 1-pixel measurement viewport during full-page capture. The phone gate proves
that this does not rebuild the phone shell or shift desktop Week, alongside its
normal phone/desktop breakpoint checks.

The final Expanded desktop and phone gates reused visible Chrome on a second
monitor. A private CDP transport creates background targets and refuses activation
requests; native window placement uses no-activate flags. The foreground window
was unchanged during the setup and the phone gate. No headless browser was used.

The final Month polish changes CSS only; its index hash is in the desktop receipt.
The verified Expanded decision-save and archived-card receipt precedes that
cosmetic polish and uses the same built JavaScript. A further confirmation run
saved Approve and Request change, then browser control restarted before the
fresh note readback and second cleanup could be verified. That final cleanup is
pending owner sign-in. No PR or final completion is claimed until it is resolved.
