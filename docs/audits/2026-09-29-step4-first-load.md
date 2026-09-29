# Step 4: staff first load, split off vs split on (2026-09-29)

Plan: `docs/plans/2026-09-28-load-per-tab-plan.md`, step 4. Measured with
`node qa/lazy/first-load-measure.js --runs=5`: the page served locally with gzip, headless
Chromium, every load cold (a fresh browser context), median of 5, "ready" is DOMContentLoaded,
every request outside the local server answers empty. Sizes are compressed bytes on the wire
from the local server (the page, its scripts and fonts). "Before" is the plain single file,
"after" is the committed loader plus the parts a staff browser needs, with TikTok, Templates,
Workload and Kasper on demand.

## Staff first load

| profile | before: download / ready | after: download / ready | change |
|---|---|---|---|
| desktop | 1,553,362 B / 392 ms | 1,260,657 B / 295 ms | -292,705 B (-19%), -97 ms |
| phone, typical 4G | 1,523,327 B / 2,652 ms | 1,230,622 B / 1,768 ms | -292,705 B (-19%), -884 ms (-33%) |
| phone, slow | 1,523,327 B / 8,959 ms | 1,230,622 B / 7,014 ms | -292,705 B (-19%), -1,945 ms (-22%) |

Once the quiet background download of the four on-demand areas finishes (about 2.5 s after the
page is showing), the browser has 1,542,186 B, which is 18,859 B more than the single file: the
loader and the per-file overhead of 19 files instead of one. That is the cost of not
re-downloading the areas a staff member never opens.

Three quarters of the plan's estimated saving is still to come: only four of the nine areas are
split so far (SyncLinear was skipped by the owner; the others stay in core or were left).

## Client link (must not change)

| profile | before: download / ready | after: download / ready |
|---|---|---|
| phone, typical 4G | 1,507,268 B / 2,428 ms | 1,509,289 B / 2,163 ms |
| phone, slow | 1,507,268 B / 8,626 ms | 1,509,289 B / 8,319 ms |

A client link gets the whole script, unsplit, as one file (`js/sv-full-<hash>.js`) instead of
inline in the page: the same code, one extra request, +2,021 B. Times are within run to run
noise. (Desktop bytes for the client link vary by about 30 KB between runs because of an
unrelated extra request that only the unthrottled profile finishes in time; the throttled
profiles are stable.)

## The way back

- Everyone, for good: `node scripts/split-switch.js off`, commit `src/index/split.json`,
  `index.html` and `INDEX.md`, merge. `index.html` is the single file again in that one
  commit. The old `js/` files can stay (a page still open keeps working) and
  `node scripts/prune-split-js.js --delete` clears the unused ones later.
- One browser, right now: open the site once with `?split=0` (it remembers, on that browser
  only, and loads the single file); `?split=1` undoes it.
