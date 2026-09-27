# SyncView startup footprint and speed opportunities (2026-09-26)

Source baseline: `3f5bd46e6086911ae2a7bb0d32507f03d5a44da8`. This is a local, anonymous measurement and source-only proposal. It did not contact the live SyncView site, sign in, change data, or run a deploy. The [2026-09-24 speed map](2026-09-24-speed-map.md) is separate, historical staff-tab evidence on a different rig.

## Measured footprint

The committed page is 5,805,108 bytes: 4,922,301 served JavaScript bytes across 37 fragments, 772,627 CSS bytes across two fragments, and 110,180 HTML bytes. Compressing the whole page locally at gzip level 9 gives 1,405,642 bytes; local Brotli gives 1,003,226 bytes. Those are codec estimates, **not** observed hosting transfer sizes. JavaScript alone compresses to 891,660 Brotli bytes, and CSS to 98,356. The largest raw fragment is `020-styles-surfaces.css.part` at 431,977 bytes; the next is `010-styles-foundation.css.part` at 340,650 bytes.

Five fresh Playwright Chromium contexts loaded the committed page from a loopback server at 1440×900. Every external request was aborted, and service workers were blocked; no backend response or CDN/font body was measured. Medians were first contentful paint **96 ms** (84–112), DOMContentLoaded **192 ms** (190–222), and load **201 ms** (198–230). These numbers describe fast local parsing with missing external dependencies, **not** real user readiness or a hosted speed score. `npm run check:index` separately confirms the page matches its source fragments.

Each isolated load attempted the same 19 resources after the main document: 10 local images (favicon plus nine navigation icons, 44,163 transfer bytes including local response overhead), two CDN scripts (Chart.js and Supabase JS), one font stylesheet, and six public-key Supabase GETs (one team roster, four individual runtime flags, one batch of flags). All nine external requests were blocked by the route guard. The source also declares preconnects for Supabase, Fonts, Docs, and n8n; preconnect work is not represented in the resource count.

## Five proposals, ranked by likely user impact

| Proposal | Estimated gain and evidence | Guard to preserve |
|---|---|---|
| 1. Profile and shorten the staff `key-verify` critical path. | The separate 2026-09-24 staff speed map measured a roughly 1.0-second shared warm-load floor while waiting on this check. A **200–500 ms target** is a hypothesis until the same rig profiles the function and caller promises; page-byte changes alone cannot remove that floor. | Do not display private data or permit writes before authorization completes. |
| 2. Load noninitial tab JavaScript only when its tab opens. | If 25–50% of the 891,660-byte compressed JS could move out of initial HTML, first-load transfer would fall by roughly **220–450 kB**, with 1.2–2.5 MB less raw JS to parse. This is a range from file size, not a measured implementation gain. | Keep cross-tab globals, event handlers, and fragment/module ordering intact; prototype one tab first. |
| 3. Reuse the early batch of runtime flags during boot. | The offline trace saw one batched flag GET plus four individual flag GETs. Reusing the batch for initial display could remove **up to four startup requests**; latency gain is unknown because requests may overlap. | Per-write freshness, authority routing, and refusal behavior must keep their existing guards. |
| 4. Load Chart.js on the first chart view, instead of the entry page. | The source loads this version-pinned CDN script on every startup. Defer **one external request**; the locally installed Chart.js 4.4.0 UMD distribution compresses to about **60 kB Brotli**, only a proxy for the CDN's `.min.js` transfer. | Existing chart wait/error handling must still work if the CDN is slow or unavailable. |
| 5. Split styles needed only by later routes. | CSS is 98,356 bytes Brotli as one independent body. Moving roughly 25–50% of route-specific rules suggests **25–50 kB** less compressed startup data; shared selectors may reduce that saving. | Verify phone and desktop visuals across every affected route before removing any rule. |

The local observations establish payload and request opportunities, not causal performance gains. Any implementation should be a separate small PR with before/after measurements on the same hosted or isolated rig and no weakening of identity or write guards.
