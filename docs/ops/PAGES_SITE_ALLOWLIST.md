# The published site is an allowlist (2026-09-29)

**Owner decision, 2026-09-29:** the repository stays public, and the live site
publishes only the files the app needs. Plan step 2 of
`docs/plans/2026-09-29-repo-private-plan.md`, done on its own.

## Why

Until now GitHub Pages served the repository root, so `syncview.synchrosocial.com`
also answered `/docs/...`, `/CLAUDE.md`, `/scripts/...`, `/migrations/...` and
`/supabase/...` to anyone. Measured live on 2026-09-29: 14 of 17 source addresses
probed returned 200 (`node scripts/pages-site.js probe`). Nothing the app loads
lives there. Publishing an allowlist removes the copies whether the repository is
public or private.

## What is published, and what is not

Published (120 files): `index.html`, `404.html` (the deep-link and onboarding-form
router), one stub page per top-level address (the list is the router's own `TOP`
list, `scripts/build-route-stubs.js`), `CNAME`, the three logo/favicon images, and
the folders the app loads at run time: `js/` (the split parts), `nav-icons/`,
`thumbnail-styles/`, `onboarding-ai/`, `onboarding-audio/`, `onboarding-video/`.

Not published: everything else, including `docs/`, `scripts/`, `migrations/`,
`supabase/`, `test/`, `qa/`, `src/`, `n8n-backups/`, the root `*.md` files and
`package.json`. **`thumbnails/`** (SyncThumbnails, a separate mock-up the app never
loads; its README calls its smart-picks mock data) is no longer served at
`/thumbnails/`. To serve it again, add `'thumbnails'` to `PUBLISHED_DIRS` in
`scripts/pages-site.js` (one line).

## How it works

- `scripts/pages-site.js build` copies the allowlist into `.pages-site/`.
- `.github/workflows/pages-site.yml` builds it, runs
  `test/pages-site-allowlist.js` (bytes and statuses against today's whole-repo
  serving; source addresses must 404; every repository path the page and scripts
  reference must be published) and
  `docs/syncview-design/tests/pages-site-browser.js` (32 addresses booted in a
  real browser), then uploads the folder as a one-day artifact. **Pull requests
  never deploy.** The deploy job runs only from `main`, and only when the
  repository's Pages source is "GitHub Actions". Until the owner switches that
  setting, the workflow builds and checks and deploys nothing, and the branch
  build keeps serving the site exactly as before.
- Adding a page: a new root `.html` that is neither `index`, `404` nor a route stub
  fails the build on purpose. A new runtime folder or file: add it to
  `PUBLISHED_DIRS` / `PUBLISHED_FILES`; the test fails if the app references a
  repository path that is not published.

## Switching it on (owner, in a quiet hour)

1. Merge the pull request. The `Pages site` run on `main` builds and checks; its
   summary says `Pages source: legacy` and it deploys nothing.
2. Settings, Pages, Build and deployment, Source: **GitHub Actions**.
3. Straight away: Actions, `Pages site`, **Run workflow** on `main`. This publishes
   the folder. (GitHub does not document whether the old content keeps serving in
   the gap between steps 2 and 3, so do them one after the other.)
4. Check: `node scripts/pages-site.js probe` should end with
   `0 app addresses failing, 0 of 17 source addresses still published` and exit 0.
   The command exits 1 while any app address fails or any source address is still
   published, so before the switch it exits 1 by design.
5. Confirm Settings, Pages still shows the custom domain with a passing DNS check
   and "Enforce HTTPS" on.

## Way back (one setting)

Settings, Pages, Build and deployment, Source: **Deploy from a branch**, branch
`main`, folder `/ (root)`. The next `Pages site` run reads the source, sees it is
no longer Actions and skips the deploy, so nothing else needs changing. This
re-publishes the whole repository (the exposure above comes back), so it is an
emergency exit, not a resting state.

## Evidence recorded with the change

- Local, offline, both against today's whole-repo serving and the site folder:
  `node docs/syncview-design/tests/pages-site-browser.js --compare` boots all 32
  addresses (15 staff pages, 4 deep links plus an unknown path, 5 onboarding and
  intake forms, the weekly report, 4 legacy entry links, 2 client share links)
  with identical outcome, js part counts and address-bar path from both, and 5
  source addresses answer 404 from the site folder and 200 from today's.
- The gate proves it can fail: removing `js/` from the list fails on a missing
  loader part; removing `thumbnail-styles/` fails on an unpublished referenced
  path; adding `docs/` or `CLAUDE.md` fails on a published source address; a stray
  root `.html` fails the build.
- Test client: nothing here writes or reads client data. Every backend call is
  answered empty and addresses use invented names, so no client name or slug
  appears in the change.
