# Audit: /home/user/synchrosocial (Astro site)

## Verdict
**Out of scope for the n8n/Linear-removal effort.** It is the public marketing site for synchrosocial.com — a fully static Astro 5 + Tailwind v4 site deployed to GitHub Pages. It has **zero code-level connection** to n8n, Linear, Supabase, Google Sheets/Apps Script, or the SyncView backend. Its only relationship to SyncView is two plain outbound hyperlinks (onboarding "fill in form" buttons) and documentation mentions.

## What it is
- Repo: `sidney-afk/synchrosocial` (git remote via local proxy: `http://local_proxy@127.0.0.1:41729/git/sidney-afk/synchrosocial`), latest commit `298ce20` (PR #20 merge, onboarding flash-content fix).
- Per `/home/user/synchrosocial/README.md`: "The Synchro Social website, rebuilt from Framer into clean, maintainable code." Framework Astro (static), styling Tailwind CSS v4, hosting GitHub Pages, domain `synchrosocial.com` (public/CNAME + `site` in astro.config.mjs both set to synchrosocial.com; `base: '/'`; redirect `/v2` → `/`).
- `package.json` dependencies: only `astro ^5.7.0`; devDeps `@tailwindcss/vite` + `tailwindcss ^4.1.0`. No supabase-js, no HTTP client, nothing else.
- Deploy: `/home/user/synchrosocial/.github/workflows/deploy.yml` — GitHub Actions Pages deploy on push to `main` (npm ci, astro build, upload/deploy `dist/`). No secrets, no env vars, no API calls in CI.

## Structure
- `src/pages/` (18 pages): `index.astro` (homepage), `apply.astro`, `ai.astro` (AI-clone VSL landing), `call.astro`, `event.astro`, `old.astro` (legacy homepage), `onboarding.astro` + `onboarding_step2..4.astro` (main purple funnel), `ai_onboarding.astro` + `ai_onboarding_step2..4.astro` (AI coral funnel), `thank-you.astro`, `privacypolicy.astro`, `terms-conditions.astro`, `404.astro`.
- `src/components/` (11): ApplyButton, Avatar, Button, IClosedEmbed, Icon, Logo, OnboardingStep, PlatformIcon, SiteFooter, SiteNav, VideoEmbed.
- `src/layouts/`: Layout.astro, Legal.astro. `src/styles/global.css` (brand purple / coral tokens). `src/data/caseStudies.js`.
- `public/`: fonts (Inter/Caveat woff2), client/reel images, one mp4, `ai-invite/` static hub (index.html + schedule.css), CNAME.
- `docs/`: `ECOSYSTEM_MAP.md` (funnel/booking map incl. mermaid diagram), `pixel-matching-playbook.md` (Framer-rebuild technique notes).

## Integration grep results (exhaustive, repo-wide excluding .git and package-lock)
- `supabase`: 0 hits. `n8n`: 0 hits. `webhook`: 0 hits. `script.google` / `macros/s` / Apps Script / Sheets / Airtable / Zapier / Make: 0 hits. `linear`: only CSS `linear-gradient(...)` matches (global.css, page classes) — no Linear-the-product references.
- No `fetch(`, `XMLHttpRequest`, `axios`, form `action=`, or POST anywhere in `src/` or `public/ai-invite/`. The site makes no API calls of any kind.
- All external URLs in `src/` are third-party embeds/links only: `app.iclosed.io` (booking widget — IClosedEmbed.astro lines 11/26/51, event.astro), `fast.wistia.net` (onboarding/apply videos), `www.youtube.com` / `player.vimeo.com` (VideoEmbed.astro), `api.fontshare.com`, `fonts.googleapis.com`/`gstatic.com`, `i.ytimg.com`, `www.linkedin.com`.

## The ONLY SyncView touchpoints (links, not integration)
1. `/home/user/synchrosocial/src/pages/onboarding_step2.astro` line 9: `const formUrl = "https://syncview.synchrosocial.com/?onboarding=1";` — used at line 27 as a plain `<Button href=... target="_blank">` link.
2. `/home/user/synchrosocial/src/pages/ai_onboarding_step2.astro` line 9: `const formUrl = "https://syncview.synchrosocial.com/?onboarding=ai";` — same pattern (line 22).
3. `docs/ECOSYSTEM_MAP.md` lines 46, 77-78, 89: documents SyncView as `syncview.synchrosocial.com`, "Internal Instagram analytics + content-ops dashboard (the `client-analytics` repo). Used by the team after a client signs; not part of booking." — documentation only.
4. README.md line 92-95 explains the link goes direct with `?onboarding=` query to skip a GitHub Pages 404-redirect hop; the SyncView app itself rewrites the address bar to `/onboarding_form` / `/ai_onboarding_form`.

## Implication for the migration
Nothing in this repo needs to change when n8n is removed or Linear is retired. The only fragile coupling is the **URL contract**: SyncView must keep honoring `https://syncview.synchrosocial.com/?onboarding=1` and `?onboarding=ai` (and its `/onboarding_form` / `/ai_onboarding_form` rewrite behavior), or these two marketing-site links break. That is the entire dependency surface. Useful side-fact for the orchestrator: `ECOSYSTEM_MAP.md` confirms SyncView's production URL is `syncview.synchrosocial.com` and that it is the `client-analytics` repo, and that the GitHub Pages account is `sidney-afk` (CNAME `www` → `sidney-afk.github.io`).

## KEY FACTS
- /home/user/synchrosocial is the public marketing site for synchrosocial.com — a fully static Astro 5 + Tailwind v4 site with no backend and no API calls.
- Verdict: OUT OF SCOPE for the n8n/Linear-removal effort; zero code references to n8n, Supabase, Linear, webhooks, Google Sheets/Apps Script, Zapier, Make, or Airtable (repo-wide grep, only CSS linear-gradient matches for 'linear').
- Sole runtime dependency in package.json is astro ^5.7.0; no supabase-js or HTTP client libraries exist.
- No fetch(), XMLHttpRequest, axios, form action, or POST exists anywhere in src/ or public/ — the site cannot write to anything.
- The only SyncView touchpoints are two plain outbound <a href> links: src/pages/onboarding_step2.astro line 9 (https://syncview.synchrosocial.com/?onboarding=1) and src/pages/ai_onboarding_step2.astro line 9 (https://syncview.synchrosocial.com/?onboarding=ai).
- Migration constraint: SyncView must continue honoring the ?onboarding=1 and ?onboarding=ai query entries (which it rewrites to /onboarding_form and /ai_onboarding_form) or these marketing-site buttons break — that is the entire dependency surface.
- External integrations are all third-party embeds/links only: iClosed booking (app.iclosed.io, IClosedEmbed.astro), Wistia videos, YouTube/Vimeo, Fontshare and Google Fonts.
- Deploys via GitHub Actions to GitHub Pages on push to main (.github/workflows/deploy.yml); no secrets or env vars in CI; custom domain synchrosocial.com via public/CNAME.
- Git remote is sidney-afk/synchrosocial; GitHub Pages account is sidney-afk (www CNAME -> sidney-afk.github.io per README).
- docs/ECOSYSTEM_MAP.md (lines 46, 89) confirms SyncView production URL is syncview.synchrosocial.com and identifies it as the client-analytics repo, described as internal Instagram analytics + content-ops used post-signing, not part of booking.
- Structure: 18 pages in src/pages (homepage, apply, ai VSL, call, event, old, two 4-step onboarding funnels, thank-you, legal, 404), 11 components in src/components, 2 layouts, src/data/caseStudies.js, static public/ai-invite hub.
- The site was rebuilt from Framer; docs/pixel-matching-playbook.md is a Framer-rebuild technique doc, unrelated to integrations.
- Latest commit 298ce20 (merge of PR #20, onboarding flash-content fix); recent work is all onboarding copy/video/link polish, no integration changes.

## UNKNOWNS
- Whether syncview.synchrosocial.com DNS/routing details (beyond what ECOSYSTEM_MAP.md documents) impose any shared-infrastructure coupling — DNS is managed in Namecheap outside both repos, so could not be verified from the filesystem.
- Whether iClosed booking events trigger any n8n workflows server-side (e.g. via iClosed webhooks configured in the iClosed dashboard) — nothing in this repo indicates it, but iClosed's own webhook config is external and not inspectable here; if such workflows exist they live in n8n/iClosed, not this codebase.