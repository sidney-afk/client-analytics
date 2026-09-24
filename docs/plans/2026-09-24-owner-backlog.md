# Owner backlog (written 2026-09-24)

Two owner requests to plan later. Neither is started. Each needs its own plan
PR before any work begins.

## 1. Make this repository private without paying for Actions

**Goal:** make `client-analytics` private at no extra cost.

**Idea from the owner:** move scheduled jobs and automation that run on GitHub
Actions to Supabase (pg_cron for schedules, Edge Functions for the work).

**Things the plan must answer first:**
- GitHub Pages hosts the live site from this repo today. Pages from a
  **private** repo needs a paid GitHub plan. The plan must choose a new host
  first (for example Supabase Storage, Cloudflare Pages or Vercel), or accept
  that cost.
- Private repos on the free plan still get a monthly allowance of free Actions
  minutes. Measure current monthly minutes before assuming it must all move.
- Inventory every workflow in `.github/workflows/`: which are **schedules**
  (candidates for pg_cron), which are **deploy lanes** (Section 4,
  single-function, need the owner's click and GitHub secrets), and which are
  **PR checks** (tests; these only exist on GitHub).
- Public-repo rules in `CLAUDE.md` (identity gate, no slugs) can relax once
  private, but keep them until the switch is done.

## 2. SyncView version 2 (Supabase + Next.js), built in parallel

**Goal:** build a new SyncView on Supabase and Next.js beside the current one,
and switch everyone over only once it is proven.

**Shape agreed so far:**
- Built in parallel. The current app keeps running and keeps getting fixes.
- Switch-over only after the owner is sure it works, ideally screen by screen,
  with the old app as the fallback.
- The current app's modularization (C3) continues. Clear module boundaries make
  each screen's behaviour easier to copy and test against.

**The plan must cover:** hosting and cost, sign-in and staff roles, the client
approve and request-changes flows (the owner's top priority), how v1 and v2
share one database safely, and how to prove parity before switching anyone.
