# Step 5: client link first load, split off vs split on (2026-09-29)

Plan: `docs/plans/2026-09-28-load-per-tab-plan.md`, step 5. Measured with
`node qa/lazy/first-load-measure.js --runs=5`, the same method as step 4
(`docs/audits/2026-09-29-step4-first-load.md`): the page served locally with gzip, headless
Chromium, every load cold (a fresh browser context), median of 5, "ready" is DOMContentLoaded,
every request outside the local server answers empty. Sizes are compressed bytes on the wire
from the local server. "Before" is the plain single file. "After" is the committed loader plus
the parts a client link needs, with TikTok, Templates, Workload and Kasper on demand and never
downloaded in the background on a client link.

## Client link first load (Calendar review link, synthetic test client)

| profile | before: download / ready | after: download / ready | change |
|---|---|---|---|
| desktop | 1,556,545 B / 323 ms | 1,260,971 B / 225 ms | -295,574 B (-19%), -98 ms (-30%) |
| phone, typical 4G | 1,526,510 B / 2,460 ms | 1,230,936 B / 1,515 ms | -295,574 B (-19%), -945 ms (-38%) |
| phone, slow | 1,526,510 B / 8,838 ms | 1,230,936 B / 6,716 ms | -295,574 B (-19%), -2,122 ms (-24%) |

"Once prefetched" equals "at load" for a client link (1,230,936 B on the phone profiles): a client
link never downloads the on-demand areas in the background, and `split-load-browser.js` fails if it
does. Staff are unchanged from step 4 (same run: 2,699 to 1,850 ms on 4G).

The plan's baseline estimate for a client link was about 825 KB and about 1.7 s on 4G. Two thirds of
that estimate is not reached yet because only four of the nine areas are split: the rest of the
staff-only code still sits in the always-loaded part.

## The way back

- Everyone: `node scripts/split-switch.js off`, commit `src/index/split.json`, `index.html` and
  `src/index/INDEX.md`, merge. `index.html` is the single file again.
- Client links only: `node scripts/split-switch.js clients off`, commit, merge. Staff keep the parts.
- One browser: open the link once with `?split=0` (it remembers, on that browser only, and loads the
  single file); `?split=1` undoes it. On a client link this works only after the fix in the plan's "Step 5 fix"
  section (the first release of step 5 refused the key with "This link isn't valid").
