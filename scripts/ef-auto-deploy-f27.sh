#!/usr/bin/env bash
# ef-auto-deploy-f27.sh -- the Section 4 step of deploy-edge-functions-on-merge.yml.
#
# production-write, deliverable-write and batch-write are released ONLY by
# .github/workflows/deploy-f27-section4-closures.yml. This dispatches that lane
# with `capture` (it seals the live three into its rollback bundle itself, stores
# and verifies it, then deploys and attests) and waits for it. Every check that
# lane makes is its own and unchanged, including "commit_sha equals main's tip
# at dispatch time" and the pinned fingerprints.
#
# The Section 4 lane only accepts main's tip, and it does not look at what merged
# between the planned commit and the tip. So this dispatches only when the tip is
# the planned commit, or when nothing the lane plans from (functions, config,
# migrations, the planner, the Section 4 lane itself) changed in between, which
# makes the tip's three functions and migrations exactly the planned ones. If any
# did change, the tip's own run of the merge lane plans it with its migrations
# and its pins, so this run hands over (exit 3) instead of mixing versions.
# Needs: GH_TOKEN with actions: write, DEPLOY_COMMIT, GITHUB_REPOSITORY.
set -euo pipefail
lane=deploy-f27-section4-closures.yml
slugs=production-write,deliverable-write,batch-write
watched=(supabase/functions supabase/config.toml migrations supabase/migrations
  scripts/ef-auto-deploy-plan.js scripts/ef-fingerprint.js
  .github/workflows/deploy-edge-functions-on-merge.yml .github/workflows/deploy-f27-section4-closures.yml)

pins_match() {
  local sha="$1" pins fps
  pins="$(git show "$sha:.github/workflows/$lane" | sed -n -E 's/^ +(PRODUCTION_WRITE|DELIVERABLE_WRITE|BATCH_WRITE)_SOURCE_SHA256: *([0-9a-f]{64}) *$/\1 \2/p' | sort)"
  fps="$(node scripts/ef-fingerprint.js "$sha" --slugs="$slugs" --expected-only --format=json \
    | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));const n={"production-write":"PRODUCTION_WRITE","deliverable-write":"DELIVERABLE_WRITE","batch-write":"BATCH_WRITE"};console.log(r.results.map(x=>n[x.slug]+" "+x.expected_fingerprint).sort().join("\n"))')"
  [ -n "$pins" ] && [ "$pins" = "$fps" ]
}

# 0: the tip may be dispatched. 3: hand over to the tip's own run.
tip_is_safe() {
  local tip="$1"
  [ "$tip" = "$DEPLOY_COMMIT" ] && return 0
  if [ -n "$(git diff --name-only "$DEPLOY_COMMIT" "$tip" -- "${watched[@]}")" ]; then
    echo "Main moved on to $tip and the merges in between changed functions, migrations or this lane. Not dispatching Section 4 at a commit that was not planned." >> "$GITHUB_STEP_SUMMARY"
    echo "::warning::Section 4 is handed to the run of main's newer tip ($tip), which plans it with the migrations and pins of every merge in between."
    return 3
  fi
  echo "Main moved on to $tip, but nothing the lane plans from changed since $DEPLOY_COMMIT; the tip is dispatched."
  if ! pins_match "$tip"; then
    echo "::error::At main's tip the Section 4 lane's pins do not match the source of the three, so that lane would refuse. Re-pin it, then run this lane by hand."
    exit 1
  fi
}

attempt=1
while :; do
  git fetch -q origin main:refs/remotes/origin/main
  tip="$(git rev-parse origin/main)"
  tip_is_safe "$tip" || exit $?
  request="merge-$(printf '%s' "$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT-$attempt")"
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  gh workflow run "$lane" --repo "$GITHUB_REPOSITORY" --ref main \
    -f commit_sha="$tip" \
    -f operation=deploy-reviewed-release \
    -f confirm=DEPLOY_REVIEWED_F27_SECTION4_CLOSURES \
    -f rollback_bundle_sha256=capture \
    -f rollback_bundle_byte_length=capture \
    -f request_id="$request"
  run_id=""
  for _ in $(seq 1 30); do
    sleep 10
    run_id="$(gh api "repos/$GITHUB_REPOSITORY/actions/workflows/$lane/runs?event=workflow_dispatch&created=%3E%3D$started&per_page=20" \
      --jq "[.workflow_runs[] | select(.display_title | endswith(\"$request)\"))][0].id // \"\"")"
    [ -n "$run_id" ] && break
  done
  if [ -z "$run_id" ]; then echo "::error::The Section 4 run did not appear after dispatch"; exit 1; fi
  url="https://github.com/$GITHUB_REPOSITORY/actions/runs/$run_id"
  echo "Section 4 lane run: $url"
  echo "- Section 4 lane (capture, seal, store, deploy, attest): $url" >> "$GITHUB_STEP_SUMMARY"
  conclusion=""
  while :; do
    sleep 30
    read -r status conclusion < <(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$run_id" --jq '"\(.status) \(.conclusion // "")"')
    [ "$status" = completed ] && break
  done
  if [ "$conclusion" = success ]; then
    echo "- Section 4 release from \`$tip\`: PASS" >> "$GITHUB_STEP_SUMMARY"
    exit 0
  fi
  # The one race worth one more try: another merge landed between our tip read and
  # the dispatch, which the lane refuses in seconds before touching anything.
  # Only when the run failed in its first validation step (before any secret or
  # deploy), which is where a moved main is refused.
  failed_step="$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$run_id/jobs" \
    --jq '[.jobs[].steps[] | select(.conclusion == "failure")][0].name // ""')"
  git fetch -q origin main:refs/remotes/origin/main
  if [ "$attempt" = 1 ] && [ "$failed_step" = "Validate the reviewed Section 4 release and operation" ] \
    && [ "$(git rev-parse origin/main)" != "$tip" ]; then
    echo "::warning::Main moved during the dispatch; the Section 4 lane refused before deploying. Checking the new tip."
    attempt=2
    continue
  fi
  echo "::error::The Section 4 lane run ended '$conclusion': $url . A failed forward is never retried forward; the run summary there has the sealed bundle values for restore-captured-prior-three."
  exit 1
done
