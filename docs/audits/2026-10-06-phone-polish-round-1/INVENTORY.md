# First-round phone inventory

The preceding read-only audit visited the signed-in staff app and designated
test client link, then exercised native fictional-data journeys for reachable
menus, dialogs, loading, empty and error states at 360/390/430. Main changed
during that audit as the six phone redesigns merged, so historical screenshots
were separated from current findings. This round starts at the combined main
revision `cb413805923f2006e5f039c3e2a15ec81f296e1b`.

| Surface still using a desktop arrangement | Current disposition |
| --- | --- |
| Personal Time Off: header, request form, calendar, type/date menus, retry/loading states | Fixed in this round. It previously expanded to 657px, with small fields and controls. The redesigned admin Time Off dashboard was a separate surface. |
| Staff Analytics overview in its default table mode | Next round: the page fits, but metrics remain offscreen in a horizontal desktop table. |
| Calendar entered from a client's staff Analytics page | Next round: the embedded mode retains the old Organize/card-size/multiple-row toolbar. |
| Credentials entered from Calendar | Next round: sizing is already repaired, but a missing password still appears as a grey “empty” box rather than the clearer admin label. |

Staff sign-in had a coverage gap in the earlier audit. This round reaches the
actual entry form and name picker with a synthetic roster, and fixes the
confirmed small text and controls. No role key is entered or submitted.

The remaining staff Calendar, Samples, Selection, Templates, Filming Plans,
Submit, Today, Upload, Workload, Linear, reviewer and admin surfaces, plus client
Calendar, Samples and Analytics, have merged phone layouts. Their earlier
squeezed screenshots are historical, not new findings. That does not claim
every possible data or permission combination is covered.

Live Upload overflow was seen but not reproduced in the matching current-main
fixture; the served module filenames differed. It remains unproven and was not
changed. A small closed Analytics menu measurement and hidden native date
proxies were rejected as reachable-control findings.

The open-PR list was checked before editing. The owner explicitly released
shared-file conflicts from the superseded parked drafts and the two assurance
PRs. Edits here remain limited to personal Time Off, its shared shell/sign-in
rules, the required evidence and desktop gate. The new sales-findings PR has
no overlapping files. No previous phone branch was pushed.
