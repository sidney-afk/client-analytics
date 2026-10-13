# Phone round 2

One isolated worktree and one unmerged PR. Native app screenshots use intercepted fictional data only; no live client data or mutations. Staff phone CSS remains inside the existing phone scopes. Source fragments were built with `npm run build:index`.

[Before/after gallery](gallery.html), [native screenshot hashes](screenshots.json), and [real check tails](CHECKS.md).

## Owner feedback

1. **Client selection:** Change client is first in Tabs, with the current client displayed. It opens the same native picker sheet. More no longer contains it. Reviewer Overview stays in its own context; the duplicate native picker strip is no longer moved into Tabs.
2. **More:** Appearance, Tools and Account groups use icons and plain labels, with the same header/Close treatment as Tabs. Native tools, permissions and listeners remain. Sign out is last, separated from the other groups. Calendar's collaboration label is clearer on phones and restored when returning to desktop. Reopening More retains its controls.
3. **Statuses:** Earlier phone overrides painted component pills neutral and forced menu backgrounds transparent. Removing those overrides restores the existing desktop palette variables, including Scheduled and Posted. Both palettes and both themes are checked; each of the nine Calendar menu colours must match its native background/foreground variables. Selected ticks inherit their status foreground.
4. **Sheets:** The decorative handle becomes a 44 px close button with a centred grip and visible Close label. Tap, downward drag, touch drag and Escape use native cleanup, unlock the page and preserve option values. The five constructors create nine variants: Calendar video/thumbnail/caption/title, Set all and alternate-caption platform; Samples video/thumbnail and Set all. Each variant is exercised by every dismissal method. Tabs/More already have a labelled Close button and share their own shell, rather than the status-menu component.
5. **Thumbnails:** The later 160 px cropped strip is removed. Calendar/Samples card images, review previews, video tiles and reviewer posters retain natural proportions and use containment. Portrait, landscape and square card images are checked at phone widths; expanded Calendar/Samples review tiles are checked for natural proportions and no blur. Missing images keep their existing fallback; no provider preview or backend behaviour is invented.
6. **Fresh look:** More's oversized Close label, scrollbar, square/uneven tool rows and misplaced separators were corrected. Set all uses readable sentence case; coloured selections keep a visible tick. Calendar, Production, Samples and Today are revisited with the existing native phone harness.

## Larger follow-ups

- Calendar's full cards put component decisions after links/caption; a recognised tall preview makes these long cards longer. A status summary near the title would be a separate layout decision. This round preserves Expanded's full sections and existing action order.
- The inherited Calendar settings explanations still use small hover help. A consistent keyboard/touch explanation design deserves its own pass; this round preserves those explanations and controls.

No merge, deployment, n8n, Edge Function or database changes. The required identity check alone may read roster names/slugs, as previously authorised. Browser evidence is emulated touch Chromium, including visible-browser captures; physical phones and deployed behaviour are not claimed.

The existing hosted Production fast lane includes live readers without a test-client-only boundary. This PR explicitly defers that job for its branch before any browser work begins; it is NOT RUN, not a passing live proof. Other event policies remain unchanged and a unit test guards this refusal.
