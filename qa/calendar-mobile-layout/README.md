# Calendar mobile toolbar containment

Draft follow-up to baseline [PR #1281](https://github.com/sidney-afk/client-analytics/pull/1281). This is **ISOLATED_BROWSER** layout evidence, not deployed-health or persistence proof.

## Finding and bounded repair

At phone widths, the outer Calendar toolbar wraps but its middle flex row cannot. Review also reserves space for its hidden zoom control. Sheet adds Organize, pushing controls farther outside the document. The horizontally scrolling card strip is intentional and separate.

The repair adds three Calendar-only rules inside the existing 760px media query: wrap the middle row, let the view buttons wrap within their group, and align the social-profile menu inward when it follows Organize. A separate synthetic observation confirmed that this hidden, absolutely positioned menu otherwise still contributes document overflow. Card widths, strip scrolling, zoom semantics, JavaScript, writers, authentication, and other surfaces are unchanged.

## Reproduce

Use existing Node and Playwright Chromium. Set `CALENDAR_LAYOUT_OUTPUT` to an absolute directory **outside the checkout**, then run:

```text
node qa/calendar-mobile-layout/run.cjs
```

`CALENDAR_LAYOUT_SOURCE` optionally selects a preserved `index.html`; otherwise the checkout file is tested. `CALENDAR_LAYOUT_WIDTHS` defaults to `360,390,768,1440`. Each report records the exact HTML SHA-256, runner SHA-256, checkout head, Chromium version, UTC timestamps, assertions, geometry, and blocked request classes. The checkout head does not substitute for the tested HTML hash. Screenshots and reports stay outside tracked files.

The real source document and its renderers/event handlers run against six fictional cards. Client Review has two pending cards and Sheet four ready cards; the synthetic staff renderer has two SMM-review cards and six Sheet cards. Fixture setup seeds data and local display preferences. It does not prove staff authentication or server transitions.

Every routed request is fulfilled from local fixture bytes or aborted. No request is forwarded, including redirects. Service workers, WebSockets, beacon/keepalive, and extra transports are blocked; Chromium also runs without a proxy and with DNS disabled. A loopback canary independently checks fetch POST, unreviewed GET, XHR POST, beacon, keepalive, and WebSocket containment. Its deliberate negative probes are reported separately from application activity. Unknown resources remain blocked and counted.

## Review matrix and limits

The lane checks document and toolbar containment in Review/Sheet, expanded review controls and composer focus, keyboard Tab/Enter navigation, Organize and social-profile menus, Escape/focus restoration, Notes opening/composer/closing, actual touch panning or desktop wheel scrolling, and keyboard access to the final card. It never submits approvals, comments, changes, links, assignments, or dates.

Widths: 360, 390, 768, and 1440. Staff: light and dark. Client links: their source-defined light theme, with normal and reduced motion preferences. Synthetic screenshots cover each meaningful open state. CDN fonts, Chart, realtime, and unrelated reads are stubbed/blocked; real media providers, live persistence, authenticated staff access, other Calendar views, and other surfaces are **NOT_TESTED** by this lane.

The local human-audit skill is bound to Calendar only: source document versus the recorded baseline, allowed differences limited to the three mobile toolbar rules, this browser lane as the assertion lane, and repository unit/map/privacy checks as supporting gates. Unrelated Production parity and live-writing runners are outside this binding.

## Source and results

Recorded serving source: `a4925097aad2be1d8b4710e56da1220a19c850c5`, fetched again at `2026-09-05T07:16:17.6586833Z`. Baseline HTML SHA-256: `0fc2e652bcb03916a04c45ed8c3c40bb67940142214badacf7f898cecab89f5e`. Candidate HTML SHA-256: `763af01a09b5711b406aa314ee45adc1559d30393cfe909f38a03e5c98e47d9f`.

Chromium `141.0.7390.37`, identical runner SHA-256 `748879ec9747b21bd2e20aaecc55383f794a1513b72d90aaa0d73ba713c27baa`:

| ISOLATED_BROWSER pass (UTC, 2026-09-05) | Passed | Failed |
| --- | ---: | ---: |
| Recorded baseline, 07:37:46.315–07:38:12.601 | 547 | 72 |
| Candidate, 07:37:36.099–07:38:02.302 | 619 | 0 |

The candidate was tested as the four-line CSS addition on the recorded base; its content hash above is the tested source identity. All script blocks compare byte-for-byte equal. The 72 baseline failures remain failures: they are phone document overflow, unreachable toolbar controls, and the profile menu extending beyond the viewport. Every case completed; neither run had an uncaught page error or application business-write attempt. Both canaries received zero requests.

| Document width in synthetic fixture | Before at 360/390px | Candidate |
| --- | ---: | ---: |
| Client Review | 447 | 360 / 390 |
| Client Sheet | 578 | 360 / 390 |
| Staff Review | 508 | 360 / 390 |
| Staff Sheet | 639 | 360 / 390 |
| 768px / 1440px, both personas | Fits viewport | Fits viewport; all 24 measured toolbar states have identical geometry |

The earlier live baseline used different cards/fonts and measured 431/564px on a 390px client page; those live numbers are not replaced by these synthetic results. Review badges and fallback fonts explain why the fictional fixture's exact widths differ.

Candidate blocked resources: 104 image requests and 81 unrelated fetches; baseline: 104 and 83. These include intentionally unavailable surrounding assets/background reads and remain coverage limits. Their absence is not called provider health. No raw network capture or screenshot is published. Private evidence groups: `baseline-final/report.json`, `candidate-final/report.json`, and their persona/width/theme state screenshots. Visual inspection covered phone Review/Sheet, expanded client/staff review, profile menu, Notes, and staff dark mode; no remaining divergence was found within the three-rule Calendar toolbar scope.

The diff privacy gate (**LIVE_READ**, roster only) checked 51 identifying terms and found zero new matches. **OFFLINE_TEST:** `npm test` ran 07:34:48.478–07:38:47.491 UTC against the candidate HTML above: 398/399 suites passed. The unchanged `test/asset-access-any-team.js` fails on Windows with `ERR_UNSUPPORTED_ESM_URL_SCHEME` from its absolute drive-path import; this is not reported as a green suite. `repo-map-sync`, `truth-sync`, `system-map-sync`, and `git diff --check` passed. Raw unit output remains private.

## Next gate and rollback

Owner review of this draft and its synthetic evidence comes next. It has not been merged or deployed. After an owner-authorized Pages release, repeat the read-only baseline at 390px and record the actual served HTML hash; local success is not propagation proof. The live TEST workflow drill remains separately proposed in #1281 and is not executed here.

Pages-only rollback: revert this repair commit through the normal reviewed Pages flow. No Edge Function deployment, writer copy replacement, flag change, data restore, or monitoring installation is part of the repair or rollback.
