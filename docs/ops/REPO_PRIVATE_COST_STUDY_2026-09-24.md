# Making this repo private: cost study (2026-09-24)

Read-only research. Nothing was changed in GitHub settings, workflows or Supabase.

## Answers

| Question | Answer | Source |
|---|---|---|
| Does Pages work from a private repo on the current plan? | **No, if the account is on GitHub Free.** Free serves Pages only from public repos; Pro, Team and Enterprise serve Pages from private repos. The plan itself is not readable with this session's token, so confirm at github.com/settings/billing. | [GitHub's plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans) |
| Actions minutes, last 30 days | **About 67,000 run-minutes** (18,976 runs, 2026-08-26 to 2026-09-24). Billed minutes are higher: GitHub rounds each *job* up to a whole minute and the biggest PR checks run 2 to 3 jobs. Last-7-day pace, after the Linear lanes were retired: ~14,800 run-minutes/week, i.e. **~63,000/month, likely 80,000+ billed**. | Actions REST API, summed below |
| Free minutes for a private repo | Free: 2,000/month. Pro: 3,000. Team: 3,000. Public repos: unlimited, free. Overage on the standard Linux runner: $0.006/minute. | [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) |
| What Pro costs and covers | $4/month (as listed on github.com/pricing; the docs pages do not print the price). Adds Pages in private repos, 3,000 Actions minutes, protected branches, code owners, 2 GB Packages storage. | [Pricing](https://github.com/pricing), [plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans) |

**Bottom line:** at today's usage a private repo on Pro would overspend its 3,000 minutes about 20 to 25 times over, roughly **$350 to $500/month** in overage. Pages is not the expensive part; Actions is.

## Minutes by workflow, last 30 days

Run-minutes = run wall time rounded up per run. Per-job rounding adds more (sampled: calendar-unit-tests 3 jobs, production-polish-gate 3 jobs, linear-exit-preparation-ci 2 jobs).

| Run-min | Runs | Workflow | Note |
|---:|---:|---|---|
| 12,921 | 2,050 | calendar-unit-tests | PR check |
| 11,882 | 2,475 | linear-sync-reconcile | file since removed |
| 6,812 | 2,662 | sample-linear-reconcile | file since removed |
| 6,373 | 2,657 | linear-outbound-drain | schedule removed, dispatch only |
| 5,573 | 1,421 | b1-linear-incremental-refresh | file since removed |
| 4,602 | 1,102 | production-polish-gate | PR check |
| 3,276 | 805 | linear-deliverables-reconcile | schedule removed 2026-09-20 |
| 3,143 | 1,046 | pto-ui-tests | PR check |
| 2,411 | 30 | calendar-e2e-nightly | schedule |
| 2,160 | 1,058 | client-entry-visible-boot | PR check |
| 1,671 | 111 | track-b-backup | schedule |
| 883 | 503 | linear-exit-preparation-ci | PR check |
| 776 | 426 | edge-function-type-ratchet | PR check |
| 772 | 30 | samples-e2e-nightly | schedule |
| 645 | 573 | tiktok-carousel-browser-journey | PR check |
| 548 | 382 | pages-build-deployment | GitHub Pages build |
| 540 | 217 | thumbnail-revision-scan | schedule |
| 467 | 230 | f27-team-rollback-proof | PR check |
| ~1,300 | ~1,100 | all others (30 workflows) | each under 250 |

Last 7 days, top five: calendar-unit-tests 6,494, production-polish-gate 1,400, pto-ui-tests 902, calendar-e2e-nightly 845, linear-exit-preparation-ci 655. **PR checks are now roughly two thirds of all minutes.**

Note: the "every 5 minutes" crons fire far less often than written (native-notification-sender ran 48 times in 30 days), because GitHub drops scheduled runs under load. Their minutes are tiny.

## Every workflow in .github/workflows (47)

### Schedules (18): could move to Supabase pg_cron, with caveats
pg_cron runs SQL inside the database. A lane that only calls an Edge Function or runs SQL moves cleanly (pg_cron + pg_net). A lane that drives a real browser or runs Node scripts does not.

| Workflow | Moves to pg_cron? |
|---|---|
| native-notification-sender, native-intake-completion, rename-propagation-drain, thumbnail-revision-scan, outbox-debt-census, syncview-retirement-census, workload-source-freshness, card-calendar-status-drift, native-intake-completion-monitor, native-notification-monitor, n8n-execution-quota-watchdog, assurance-ledger-freshness | Likely yes, if each is (or becomes) an Edge Function call. Check each script first. |
| monitoring-deadman, monitoring-crosscheck | **Keep off Supabase.** They exist to watch Supabase from a second host; moving them in defeats the point. |
| calendar-e2e-nightly, samples-e2e-nightly, dawn-check | No: real-browser tests. |
| track-b-backup | No: a backup of the database should not run inside the database it backs up. |

### Deploy and manual lanes (19): dispatch or push-to-main, stay on GitHub
deploy-client-review-link, deploy-description-image-upload, deploy-f27-section4-closures, deploy-hiring-applications, deploy-hiring-automation, deploy-onboarding-edge-functions, deploy-pto-edge-functions, deploy-single-function, deploy-thumbnail-edge-functions, crosswalk-phase2-repair, client-signoff-reconcile, f27-post-contract-capture, f42-card-comment-import, graphics-f2-preflight, linear-deliverables-reconcile, linear-outbound-drain, monitoring-cutover-proof, native-notification-preview, track-b-recovery-rehearsal. Together well under 200 minutes/month.

### PR checks (10): must stay on GitHub
calendar-unit-tests, client-entry-visible-boot, edge-function-type-ratchet, f27-team-rollback-proof, f42-apply-rehearsal, graphics-f2-evidence, linear-exit-preparation-ci, production-polish-gate, pto-ui-tests, tiktok-carousel-browser-journey.

## Recommendation

1. **Cheapest overall: stay public ($0).** Nothing else is free at this volume.
2. **Cheapest safe private path: Pro ($4/month) plus a self-hosted runner.** A self-hosted runner is a computer you own (a small always-on cloud server, about $5 to $10/month, or a spare machine) that GitHub sends jobs to; its minutes do not count against the 3,000. Point the 10 PR checks and 3 browser nightlies at it (`runs-on: self-hosted`), leave the light schedules and deploy lanes on GitHub's runners, where they fit inside 3,000. Expected total: about **$10 to $15/month**. Check GitHub's current terms for any per-minute platform fee on self-hosted runners before committing.
3. **Do not** go private on Pro with today's workflows unchanged: about $350 to $500/month.
4. Set an Actions spending limit of $0 before flipping to private, so a miscount stops jobs instead of billing.
5. Before flipping, confirm the custom domain survives the Pages source re-check.

Moving schedules to pg_cron saves little now (a few thousand minutes, mostly the browser nightlies that cannot move), so it is optional, not the lever.
