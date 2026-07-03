#!/usr/bin/env bash
# Run one bounded slice of the overnight QA matrix. Designed for cron/no_agent
# so coverage continues even when a long Hermes background terminal gets SIGTERM.
set -u

cd "$(dirname "$0")/.."
mkdir -p qa/overnight-output
STATE=${OVERNIGHT_CRON_STATE:-qa/overnight-output/cron-chunk-state}
LOG=${OVERNIGHT_LOG:-qa/overnight_runner.log}
NODE_BIN=${NODE_BIN:-/c/Program Files/nodejs/node.exe}
COMMAND_TIMEOUT_SECONDS=${COMMAND_TIMEOUT_SECONDS:-900}
export SXR_COURIER=${SXR_COURIER:-0}
export COMMAND_TIMEOUT_SECONDS
export NODE_BIN

stamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "[$(stamp)] CRON $*" | tee -a "$LOG"; }

phase=${OVERNIGHT_CRON_PHASE:-}
if [ -z "$phase" ]; then
  if [ -f "$STATE" ]; then phase=$(cat "$STATE" 2>/dev/null || echo 0); else phase=0; fi
fi
case "$phase" in ''|*[!0-9]*) phase=0 ;; esac
phase=$((phase % 6))
next=$(((phase + 1) % 6))

run_cmd() {
  log "chunk phase=$phase start: $*"
  if [ "${OVERNIGHT_CRON_DRY_RUN:-0}" = "1" ]; then
    echo "DRY_RUN phase=$phase next=$next :: $*"
    return 0
  fi
  "$@"
  local ec=$?
  echo "$next" > "$STATE"
  log "chunk phase=$phase done exit=$ec next=$next"
  return $ec
}

common=(RUN_ROUNDS=1 TREE_EVERY=0 FULL_MASTER_EVERY=0 COMMIT_REPORT_EVERY_ROUND=0 COMMAND_TIMEOUT_SECONDS="$COMMAND_TIMEOUT_SECONDS" SXR_COURIER="$SXR_COURIER")

case "$phase" in
  0)
    run_cmd env "${common[@]}" RUN_PROBES=1 PROBE_OFFSET=0 PROBE_LIMIT=5 RUN_SCENARIOS=0 RUN_CALENDAR=0 MASTER_FAST_EVERY=0 RUN_UNIT=1 bash qa/overnight_runner.sh
    ;;
  1)
    run_cmd env "${common[@]}" RUN_PROBES=1 PROBE_OFFSET=5 PROBE_LIMIT=5 RUN_SCENARIOS=0 RUN_CALENDAR=1 CAL_LIMIT=4 MASTER_FAST_EVERY=0 RUN_UNIT=1 bash qa/overnight_runner.sh
    ;;
  2)
    run_cmd env "${common[@]}" RUN_PROBES=0 RUN_SCENARIOS=1 SCN_OFFSET=0 SCN_LIMIT=4 RUN_CALENDAR=0 MASTER_FAST_EVERY=0 RUN_UNIT=1 bash qa/overnight_runner.sh
    ;;
  3)
    run_cmd env "${common[@]}" RUN_PROBES=0 RUN_SCENARIOS=1 SCN_OFFSET=4 SCN_LIMIT=4 RUN_CALENDAR=0 MASTER_FAST_EVERY=0 RUN_UNIT=1 bash qa/overnight_runner.sh
    ;;
  4)
    run_cmd env "${common[@]}" RUN_PROBES=0 RUN_SCENARIOS=1 SCN_OFFSET=8 SCN_LIMIT=4 RUN_CALENDAR=0 MASTER_FAST_EVERY=0 RUN_UNIT=1 bash qa/overnight_runner.sh
    ;;
  5)
    run_cmd env "${common[@]}" RUN_PROBES=0 RUN_SCENARIOS=0 RUN_CALENDAR=1 CAL_LIMIT=4 MASTER_FAST_EVERY=1 RUN_UNIT=1 bash qa/overnight_runner.sh
    ;;
esac
