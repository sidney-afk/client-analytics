# CODEX_EXIT_AUDIT_PROMPT.md — the pre-install audit handoff

Paste the block below into Codex. It is versioned here so the prompt and the state of the
programme cannot drift apart, and so a later session can see exactly what the auditor was and
was not told.

It deliberately hands over questions and locations, never conclusions: the point is an
independent verdict on work this repository's own sessions produced, so anything that reads as
a hint toward a specific answer has been removed on purpose. Written 2026-09-08, with the six
held PRs unmerged and nothing installed.

---

You are auditing a migration before it is installed. Nothing here has been merged or
installed yet, and the decision to proceed has not been made. Your job is to tell the
owner whether it is safe to proceed, and what is wrong. You are not here to approve it.

## The situation

Repo: `sidney-afk/client-analytics`, an internal operations app called SyncView. The whole
business runs on it: client content calendars, video and graphics production, editor
assignment, feedback and delivery. It is a single-file SPA (`index.html`) plus Supabase Edge
Functions plus Postgres migrations, and it is publicly readable.

SyncView currently depends on Linear. **The Linear account is being cancelled on
2026-09-15.** Work has been done over several days, by many separate agent sessions, to
remove that dependency. That work is finished as far as its authors are concerned and is
sitting in six unmerged pull requests.

Everything you are auditing was written by AI sessions, including the plan itself, the
ledger, the commit messages and the pull request descriptions. **Treat all of it as claims,
not as evidence.** A statement that something was verified is not a verification. Where a
claim matters to your conclusion, check it yourself against the code, the git history, the
workflow files, or by executing something, and say which of those you did.

## What to look at

The build under audit is the union of these six open pull requests. They are not merged, so
`main` does not contain the change:

- #1344, #1346, #1347, #1350, #1358, #1362

Other pull requests are open in this repo. Decide for yourself whether any of them bear on
this migration; do not assume the list of six is complete or that everything in it belongs.

Planning and coordination documents live in `docs/independence/` (including
`INDEPENDENCE_PLAN.md`, the `TRACK_A_*` / `TRACK_B_*` specs, `LINEAR_EXIT_LANES.md`,
`LINEAR_EXIT_BRIEF_A..F.md`, `LINEAR_EXIT_MASTER_SEQUENCE.md`, `LINEAR_EXIT_HANDOFF.md`,
`GO_LIVE_CHECKLIST.md`, `N8N_REPLACEMENT_PLAN.md`) and in `docs/ops/` (including
`MONITORING.md`, the F27 runbooks, `PRE_FLIP_HEALTH_CHECK.md`, `FLIP_RUNBOOK.md`,
`OPEN_REPAIRS.md`). `AGENTS.md`, `CLAUDE.md`, `REPO_MAP.md`, `ROLLBACK.md` and
`EXECUTION_LOG.md` are at the root.

**An early question, not a rhetorical one: which document is actually authoritative?** There
are several planning layers written at different times by different sessions. Establish for
yourself which one governs, whether any of them contradict each other, and whether more than
one plan for this migration exists. Do not assume the most recent or the most detailed one
wins.

Three practical notes so you do not waste time:

- The newest ledger entries and the newest copy of the master sequence are on the branch
  `claude/linear-removal-audit-s6iwvy`, not on `main`. Compare that branch against `main`
  early so you know which version of a document you are reading.
- Establish from `.github/workflows/` and the runbooks how each kind of change in this build
  actually reaches production and how long each takes. Do not take a document's description of
  this on trust.
- The six pull requests are separate unmerged branches. Their interactions are yours to judge:
  what order they must land in, whether any two of them touch the same code, and whether the
  union behaves like the sum of the parts.

## The four questions

Answer these four. They are the owner's questions, in his order of concern.

**1. Does the build actually deliver the strategy?**
Read the plan, then read the code. Does what was built do what the plan says needs doing?
Look for the gap in both directions: things the plan requires that the build does not do,
and things the build does that the plan never asked for. If the plan itself is wrong or
incomplete, say so; matching a bad plan is not success.

**2. Is the install strategy sound?**
Establish what the install sequence actually is, both from the documents and from what the code
requires. Is that order correct? What breaks if a step is done out of order, or half-done, or if
the person doing it stops in the middle? Where are the windows in which the system is in a mixed
state, and is each one survivable? Is every step something a single non-engineer owner can
actually execute, and does it say what to do when a step fails? Is there a way back from each
step, and has that way back been tested rather than described?

**3. Will breakage be caught?**
If something goes wrong during or after this migration, what tells anyone? Find the
monitoring, alerting and health checks that are supposed to cover it. Are they real, wired,
enabled and pointed at the right things, or only described in a document? What failures would
be silent, and how would anyone find out? Consider both the window during the migration and the
weeks after it.

**4. Is every Linear dependency accounted for?**
Inventory what still touches Linear anywhere: the browser, the Edge Functions, the database,
the n8n workflows, scheduled jobs, webhooks, and anything reading Linear identifiers out of
stored data. For each one, establish what happens to it on 2026-09-15 when the account dies,
and whether this build addresses it. Include the paths that only run rarely, and the ones that
fail quietly. Build the inventory from the code, not from the existing inventory documents;
then compare yours against theirs and report the difference.

## How to work

Ground every finding. Cite `file:line`, a commit, a workflow file, or the output of something
you ran. A finding with no evidence is a hypothesis, and should be labelled as one.

**Say when you cannot verify something.** A list of things you could not check is one of the
most useful things you can hand back, and it is worth more than a confident guess. Do not fill
a gap with a plausible assumption.

Disagreeing with the plan, with the build, or with both is a valid and wanted outcome. So is
concluding that a specific part is fine. Do not grade on effort, volume of work, or how
carefully something is documented; a well-written explanation of a wrong decision is still a
wrong decision. Equally, do not manufacture findings to seem thorough: if a thing is sound,
say it is sound and move on.

Do not treat a green CI run as evidence that the build is correct. Establish what CI actually
executes, what it skips, and under what conditions, before you rely on any of it.

You may run the test suites (`node test/run-all.js` and the individual suites under `test/`,
`qa/` and `docs/syncview-design/tests/`). Several suites need a disposable PostgreSQL 16; if
you can stand one up, do, and say so. Read what each suite actually asserts before you treat a
pass as proof of anything: a green suite proves what it checks, not what its name suggests.

The deadline is real and it is not an argument. If this is not safe to install, the answer is
that it is not safe to install, whatever the date is.

## Hard limits

- **Do not merge anything, do not deploy anything, do not dispatch any workflow, and do not
  push to `main`.** Merging to `main` publishes the live site immediately.
- **Do not edit, activate or run any n8n workflow.** They are live sales and production
  automation. Read-only.
- Do not write to production data. If you need to exercise something, the test client slug is
  `sidneylaruel`.
- The repository is public. No secrets, tokens, client display names or share-link tokens in
  anything you write, including commit messages and test output. Client slugs are fine.

## What to hand back

1. A one-paragraph bottom line: is this safe to install as it stands, and if not, what are the
   conditions.
2. The four questions answered, each as its own section.
3. A findings list ordered by severity. For each: what is wrong, the evidence, what breaks in
   practice and who notices, and what you would do about it.
4. An explicit list of what you could not verify and why.
5. Anything you found that none of the four questions asked about.
