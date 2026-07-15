# Git-history PII purge runbook (2026-07-14)

Status: **owner-coordinated incident procedure; not yet executed**

This runbook removes private operational snapshots that were committed to this
public repository. Reviewed schema-only replacements exist in an access-restricted
local incident package, not this public branch. An anonymous GitHub comparison
proved that an exact-path `-diff` guard still expanded the historical row deletions,
so the clean files must be restored only inside the rewritten history.

Do not run this procedure during ordinary development. It intentionally changes
commit IDs across the repository and requires a scheduled write freeze, an
owner-approved force-push window, GitHub Support follow-up, and fresh clones for
every collaborator.

Official references:

- [GitHub: Removing sensitive data from a repository](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)
- [`git-filter-repo` sensitive-data-removal documentation](https://github.com/newren/git-filter-repo/blob/main/Documentation/git-filter-repo.txt)

## Confirmed affected paths

The audit records only counts and data categories; it deliberately omits all
private values.

| Current path | Historical aliases to remove | Historical payload |
|---|---|---|
| `migrations/legacy-onboarding-migration.sql` | `legacy-onboarding-migration.sql`; `migrations/legacy-onboarding-migration.sql` | 21 onboarding rows; 54 email-shaped occurrences; a contact-phone field in every row; questionnaire/contact fields |
| `migrations/2026-07-09-filming-plans-source.sql` | `migrations/2026-07-09-filming-plans-source.sql` | 30 rows containing client identifiers, private document URLs/IDs, and source/updater attribution |
| `migrations/samples-supabase-migration.sql` | `samples-supabase-migration.sql`; `migrations/samples-supabase-migration.sql` | 19 rows containing client/card identifiers, 18 private media URLs, creative direction, comments, approvals, reviewer attribution, and timestamps |

The private clean-tree audit covered all 34 SQL files under `migrations/`. With the
schema-only replacements applied there, it found zero email-shaped strings, zero HTTP(S)
URLs, zero `COPY` payloads, and no literal row inserts for the three affected
tables. Other remaining `INSERT` statements are schema/RPC logic, public-safe
runtime defaults, or storage configuration; no other literal real-person or
client snapshot was confirmed.

The five path spellings above must all be passed to the history-rewrite tool.
Removing only the current paths would leave the earlier root-level copies
reachable.

## Required owner decisions and preparation

1. Merge all non-migration security remediation first. Do **not** publish the three
   row-removal diffs through an ordinary public PR.
2. Pick a maintenance window and name one rewrite operator. The operator must
   receive an explicit owner **GO** immediately before the force-push.
3. Announce a repository write freeze covering pushes, merges, release jobs,
   Pages deployments, bots, and any automation that writes Git refs.
4. Merge or close every open pull request. Record which branches must survive;
   recreate them from rewritten `main` later instead of merging their old
   histories.
5. Record branch-protection settings, required checks, default branch, Pages
   configuration, and `git ls-remote --refs origin` in an access-restricted
   incident folder. Never put the incident evidence back in this repository.
6. Export the three reviewed schema-only migration files from the access-restricted
   local incident package. Record their SHA-256 hashes. The export must contain no
   historical row payloads and must never be pushed before the rewrite.
7. Create an encrypted, access-restricted incident backup if legal or response
   needs require one. It must never be pushed or used as a normal clone.
8. Inventory forks, local clones, self-hosted runner workspaces, deploy mirrors,
   package caches, Pages caches, and public Actions artifacts. History rewriting
   cannot erase copies outside the rewritten repository.
9. Temporarily relax only the protections necessary for the scheduled mirror
   force-push. Restore the recorded protections immediately afterward.

## Tool and clone requirements

- Use `git-filter-repo` **2.47.0 or newer**. Confirm the installed package
  version with the package manager and confirm that
  `--sensitive-data-removal` appears in `git filter-repo -h`.
- Work in a fresh, disposable **mirror clone** made after the non-migration
  remediation has merged and the write freeze starts. Do not reuse a developer clone. A normal clone is
  not suitable for the final `--mirror` push because it carries local
  remote-tracking refs that should not be published as server refs.
- Do not use `--no-fetch`, `--partial`, `--refs`, or a shallow clone. The
  sensitive-data mode must discover every reachable remote ref.
- Do not have multiple operators independently rewrite separate clones. Their
  replacement histories can diverge even when the intent is identical.

Example setup (replace the repository URL and expected SHA with the exact
owner-reviewed values):

```powershell
git clone --mirror <canonical-repository-url> history-purge-2026-07-14.git
Set-Location history-purge-2026-07-14.git
git rev-parse --is-bare-repository
git rev-parse refs/heads/main
python -m pip show git-filter-repo
git filter-repo -h | Select-String -- '--sensitive-data-removal'
```

The bare-repository check must return `true`, and `refs/heads/main` must equal
the expected clean merged commit before continuing.

## Rewrite all affected history

Run the rewrite once, with every historical alias in the same invocation:

```powershell
git filter-repo --sensitive-data-removal --invert-paths `
  --path legacy-onboarding-migration.sql `
  --path migrations/legacy-onboarding-migration.sql `
  --path migrations/2026-07-09-filming-plans-source.sql `
  --path samples-supabase-migration.sql `
  --path migrations/samples-supabase-migration.sql
```

This deliberately removes even the clean current copies from rewritten refs so
that no earlier file identity accidentally keeps an unsafe blob. Create a
temporary normal clone from the rewritten local mirror, restore only the three
reviewed schema-only files from the external clean export, verify their recorded
hashes, and make one new commit on rewritten `main`:

```powershell
Set-Location ..
git clone .\history-purge-2026-07-14.git history-purge-restore
Set-Location history-purge-restore
git switch main
Copy-Item -LiteralPath <clean-export>\legacy-onboarding-migration.sql -Destination migrations\legacy-onboarding-migration.sql
Copy-Item -LiteralPath <clean-export>\2026-07-09-filming-plans-source.sql -Destination migrations\2026-07-09-filming-plans-source.sql
Copy-Item -LiteralPath <clean-export>\samples-supabase-migration.sql -Destination migrations\samples-supabase-migration.sql
Get-FileHash migrations\legacy-onboarding-migration.sql -Algorithm SHA256
Get-FileHash migrations\2026-07-09-filming-plans-source.sql -Algorithm SHA256
Get-FileHash migrations\samples-supabase-migration.sql -Algorithm SHA256
git add -- migrations/legacy-onboarding-migration.sql migrations/2026-07-09-filming-plans-source.sql migrations/samples-supabase-migration.sql
git commit -m "Restore schema-only data migrations after history purge"
git push origin main
Set-Location ..\history-purge-2026-07-14.git
```

Compare all three hashes with the pre-rewrite manifest. A mismatch is a stop
condition.

The temporary restore clone's `origin` is the local rewritten mirror, not
GitHub. `git-filter-repo` may remove GitHub's `origin` from the mirror as a
safety measure. Do not re-add the GitHub remote until local validation is
complete.

## Local validation before any push

1. Review `.git/filter-repo/changed-refs` and
   `.git/filter-repo/first-changed-commits`. Save copies in the restricted
   incident folder.
2. Count affected pull-request heads without printing content:

   ```powershell
   (Select-String -Path .git/filter-repo/changed-refs -Pattern '^refs/pull/.*/head$').Count
   ```

3. Confirm the three unsafe row-insert signatures have no historical commit.
   These commands print commit hashes only; every result must be empty:

   ```powershell
   git log --all -S'insert into public.legacy_onboarding' --format='%H' --no-patch
   git log --all -S'insert into public.filming_plans' --format='%H' --no-patch
   git log --all -S'insert into public.content_samples' --format='%H' --no-patch
   ```

4. Confirm the two root-level aliases are absent from all rewritten refs. These
   commands must be empty:

   ```powershell
   git log --all --format='%H' -- legacy-onboarding-migration.sql
   git log --all --format='%H' -- samples-supabase-migration.sql
   ```

5. Confirm each current migration has exactly the single schema-only restoration
   history expected after the rewrite. Review hashes and filenames only; do not
   print file contents in a shared terminal or log. Delete the temporary
   restore clone before the remote mirror push so it cannot be mistaken for the
   push source.
6. Repeat the count-only migration audit and the full repository test suite.
7. Recreate any branch that must survive from rewritten `main`, applying only
   reviewed clean changes. Never merge an old branch or old PR head.
8. Re-run `git ls-remote --refs <canonical-repository-url>` and compare it with
   the freeze snapshot. If any remote ref changed after the freeze, stop and
   restart coordination; do not force-push over unknown work.

If any check fails before the push, discard the disposable clone, correct the
procedure, and start again from a fresh clone. No remote rollback is needed.

## Owner-authorized force-push window

Only after the final owner **GO**:

```powershell
git remote add origin <canonical-repository-url>
git push --force --mirror origin
```

GitHub's pull-request refs are read-only, so failures limited to
`refs/pull/*` are expected. Any other rejected ref is a failure: stop, record
the output privately, correct protection/ref handling, and do not declare the
purge complete.

Immediately after the push:

1. Restore branch protections, required checks, Pages settings, and the normal
   automation schedule.
2. Keep the write freeze in place until remote and anonymous verification is
   complete.
3. Trigger a clean Pages deployment from rewritten `main` and invalidate any
   repository-backed deployment cache that may retain old blobs.
4. Do not recover by pushing the pre-rewrite backup. That would republish the
   private history. If remediation fails after the push, perform a new clean
   rewrite and escalate through the incident owner.

## GitHub Support cleanup

The mirror push cannot update GitHub's read-only pull-request refs or guarantee
immediate removal of cached commit views. Open a GitHub Support request as soon
as the rewritten refs are live. Provide, in the private support ticket:

- repository owner and name;
- the count of affected pull-request heads from `changed-refs`;
- the contents of `first-changed-commits` (commit IDs only);
- a request to dereference/delete affected PR refs, run server-side garbage
  collection, remove cached commit/blob views, and purge orphaned LFS objects if
  the filter report identifies any;
- representative old raw/blob URLs, supplied only in the private ticket;
- confirmation that this is a real-person privacy incident in a public repo.

PR diffs and comments tied to rewritten commits may become unavailable. That is
an expected tradeoff and should be included in the maintenance announcement.

GitHub Support determines what it can purge under its sensitive-data policy.
The repository owner must track the ticket through explicit confirmation; a
successful force-push alone is not closure.

## Anonymous post-push proof

Use a signed-out browser and a fresh anonymous clone from a separate directory
or machine. Do not rely on the operator clone.

Required evidence:

1. The current raw URLs for the three migration paths return schema-only files.
   Count-only scanning finds zero email-shaped strings, zero HTTP(S) URLs, zero
   `COPY` payloads, and zero literal data inserts for the three affected tables.
2. The two old root-level raw URLs return `404`.
3. Known old commit/blob/raw URLs no longer render after GitHub Support confirms
   cache and PR-ref cleanup.
4. In the fresh clone, the three `git log -S` commands above return no hashes,
   and the root-alias history commands return no hashes.
5. `git fsck --no-reflogs --unreachable` does not expose an affected blob in the
   fresh anonymous clone.
6. The newest public Actions artifacts and Pages output contain no person fields
   or data-bearing migration snapshots. Artifact cleanup is tracked separately
   but is part of incident closure.

Save statuses, counts, timestamps, deployment SHA, and Support ticket reference
in the restricted incident record. Do not save private values or response
bodies in public CI logs, issues, PRs, or this repository.

## Reclone requirements

Before lifting the freeze, every collaborator and automation owner must:

1. Export uncommitted work as a reviewed patch outside the repository.
2. Delete or quarantine the old clone; do not run `git pull`, merge, fetch-and-
   push, or push any branch from it.
3. Make a fresh clone after anonymous verification passes.
4. Recreate necessary branches from rewritten `main`, applying only reviewed
   clean patches. Rebase/cherry-pick intentionally; never merge the old history.
5. Replace self-hosted runner workspaces, deploy mirrors, and long-lived build
   caches. Hosted ephemeral runners will receive the new history on their next
   clean checkout.
6. Ask fork owners to delete/recreate or independently sanitize their forks.
   A public fork can keep the removed objects available.

An old clone can recontaminate the repository with a single push. Reclone
acknowledgements are therefore a required closure gate, not optional hygiene.

## Closure checklist

- [ ] Non-migration remediation merged; schema-only files remain private until restoration inside the rewrite.
- [ ] Owner-approved freeze announced and remote refs captured.
- [ ] All open PRs merged or closed; retained branches documented.
- [ ] `git-filter-repo` 2.47+ used once in a fresh disposable clone.
- [ ] All five historical path spellings removed.
- [ ] Only hash-matched schema-only files restored.
- [ ] Local deny-path/history checks passed before push.
- [ ] Owner gave final force-push GO.
- [ ] Mirror push succeeded except expected read-only PR-ref failures.
- [ ] Protections and deployment settings restored.
- [ ] GitHub Support confirmed PR-ref/cache/garbage-collection handling.
- [ ] Anonymous raw URLs and a fresh anonymous clone are clean.
- [ ] Public artifacts and Pages output are clean.
- [ ] Collaborators, runners, deploy mirrors, and relevant forks were recloned or sanitized.
- [ ] Restricted incident record contains counts, timestamps, SHAs, and Support reference only.

Do not rotate or disable unrelated shared integration credentials as part of
this history-only procedure. Credential changes require their own caller and
consumer audit.
