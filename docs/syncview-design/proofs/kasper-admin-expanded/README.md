# Expanded phone layout: review dashboard and admin pages

This is the real product, built from main in the source fragments. Comfortable cards and full sections follow layout A from the approved gallery in PR #1950. Regular actions stay beside their material. Existing decisions, permissions, writers and saved drafts are retained.

Open [the comparison gallery](gallery.html). Select a state, 360/390/430 width and light/dark. Previous and Next move through all 63 captured states. Before and after use the same fictional data and actual product renderers. The gallery also works from a downloaded folder.

## Coverage

The 63 states cover Review, Messages, Editors, Filming, Time Off, Sales Intake, Hiring Process, Onboarding, Client Credentials, Clients, Quiz Leads, Ad Performance and Save Problems. Standalone staff Onboarding and Credentials are included. Menus, date pickers, detail views, credential editing/history, client editing, review notes/lightbox, empty views, loading placeholders and refusal messages are included where listed in the gallery.

There are 378 before screenshots and 378 after screenshots: every captured state at 360, 390 and 430, in both appearances. The prior full phone pass ran 6,480 checks with zero failures, including page overflow, 44px targets, 16px fields, menu dismissal, focus return and draft preservation when resizing to desktop. Native hidden input proxies are measured through their real clickable labels or branded controls.

The existing client-admin browser suite also exercises editing, a refused Sheet save, retained rows after a failed refresh, permission exclusions and sign-out cleanup. The existing staff-onboarding browser suite covers populated, refused and empty reads. These are intercepted tests; they perform no live writes.

## Lighthouse corrections

The phone heading uses the same Tabs chevron and small three-dot SVG as Calendar. Review/Messages/Filming stays on the reviewer dashboard only. Review part actions share one row, enabled Finish reviewing has an active appearance, and native disclosure and close controls stay beside the card heading/actions. Empty credential values say No password saved; actual values remain masked. History/Add and the credential toolbar fit single rows. Hiring role/status chips scroll in single rows and the unused detail placeholder is hidden. Message titles wrap to two lines. Phone-to-desktop restores the original DOM, labels and controls.

The final phone follow-up hides both hiring scrollbars while retaining touch/keyboard scrolling. Finish reviewing stays on one line; its disabled state uses the standard 55 percent opacity with stronger text, while the enabled state stays fully opaque. The queue-hide action is labelled Hide card, because it differs from Collapse. Only new is a small switch at the top of each message list and invokes the original unread filter. Tests toggle it both ways and verify the original controls and labels return at desktop widths. All 378 after screenshots were re-shot in visible Chrome. The Messages fixture now uses the native caption-comment field and includes both a read conversation and an unread reply; matching main screenshots were refreshed with the same fictional data.

The last reviewer corrections use the same three equal phone columns for Review, Messages and Filming, including the Review-specific older CSS case. The message badge reads New on phones and restores its full original text on desktop. The current focused pass refreshed 120 screenshots at 360/390/430 in light/dark, including reviewer menus, with 2,448 checks and zero failures. The requested 390 comparisons are in the same gallery. Unaffected admin captures are retained and are not claimed as newly shot.

The Time Off lifecycle harness now reaches the original staff account menu through the phone More sheet after returning from the reviewer dashboard. Its 101 newly captured action/result screenshots were visually reviewed and published with the current source fingerprint; 35 lifecycle coverage gates passed. The separate PTO UI browser check passed with 31 mocked calls. Neither test connects to a live write transport.

## Desktop proof

The repaired existing `qa/client-phone/desktop-parity.js` compares main with this branch at 1024, 1280, 1440 and 1920. It keeps screenshot and computed-style equality strict. Before is assembled from main's fragments so both sides use the same serving format. Matched read responses stay in memory; they are never written into public proof.

The initial PR populated native-fixture comparison covers 18 review/admin states at all four desktop widths in both themes: 144/144 PNGs and computed-style snapshots are identical. During these deliberately seeded snapshots only, focus/pageshow/visibility refresh is suppressed to prevent fictional counters being replaced by empty mocked background reads. This is presentation proof, not lifecycle-refresh proof. One native input placeholder had two raster variants on both unchanged main and the branch; a strictly byte-identical pair from repeated captures is retained, with both variants recorded in `desktop/raster-retries.json`. See [the desktop receipt](desktop/summary.json) for the final results and hashes. Raw screenshots from live test-client reads stay private. Public screenshots contain fictional people, workspaces and abstract media; the fixture substitutes images and blocks media playback.

## Boundaries and limits

- These are branch screenshots, not proof of deployment. Nothing was merged or deployed.
- No database or workflow was changed. No real admin data was saved. Client-link approval surfaces and their branches are outside this PR.
- Fixture error, loading and unsaved views use the product's own state/render functions. They prove presentation, not an actual hosted outage or live persistence.
- The Production gateway browser check has an existing desktop inline-editor placement failure on unchanged main. Its exact output is in [checks.txt](checks.txt); this PR does not change that editor.
- The fixture captures the states named in the gallery. It does not claim every possible combination of all administrative data or a live hiring/credential/PTO write.

The prior full Windows unit run found 17 platform-related failures; every failing suite also failed on unchanged main. The complete Linux run of node test/run-all.js passed all 676 classified unit suites on product commit 9bb9962f025fd155c60f731de8f04cdced158dc1, with 92 required profiles explicitly NOT_RUN in this lane. It used the same repository tests and assertions, full historical Git objects, and a private standard Linux filesystem. Early environment-setup attempts were failures and are not claimed as passing proof.

See [actual check output](checks.txt). Tests used the existing visible Chrome; the owner's sign-in was retained. Overlapping dialog-based browser checks produced inconclusive protocol errors, then were rerun without that overlap.

Source: `src/index/020-styles-surfaces.css.part`, `src/index/321-kasper-dashboard-replies.js.part`, and the native account export in `src/index/100-onboarding-staff-controls.js.part`. Build with `npm run build:index`. The phone scope guard rejects any rule outside a media query capped at 767px or outside this surface's marker.
