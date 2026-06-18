# Headless-browser probes

These tests open the **real app** (`index.html`) in an invisible (“headless”)
Chrome and click through it like a person would — but automatically. Unlike the
plain `test/*.js` checks (which only inspect the code), these prove the feature
actually works *in a browser, against the real backend*.

They talk to the **live** Supabase + n8n backend, so they are deliberately
scoped to the test client **Sidney Laruel** (`sidneylaruel`) only, and every
probe **archives whatever it creates** so the calendar is left as it was.

## Run them
```bash
npm install            # one-time: downloads Playwright (the browser driver)
npx playwright install chromium   # one-time: downloads the headless browser
npm run test:headless  # serves the app, runs every probe_*.js, cleans up
```

## The fast checks (no browser, no backend)
```bash
npm test               # runs every test/*.js — milliseconds, safe, offline
```

## What's here
- `qalib.js` — shared helpers (launch the browser, open the app, talk to the backend).
- `probe_move.js` — paste a Linear link already on another card → **Move it here** moves it.
- `probe_move_blank.js` — the same, but onto a brand-new blank card (the exact reported flow).
- `run-headless.js` — serves the app and runs all the probes.

## CI
- `.github/workflows/test.yml` runs `npm test` automatically on every push/PR (fast, safe).
- `.github/workflows/headless-qa.yml` runs the headless probes **only when you click “Run workflow”** in the GitHub Actions tab — because they write to the live test calendar, they shouldn't fire on every commit.
