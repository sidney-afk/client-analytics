#!/usr/bin/env bash
# overnight_runner.sh — autonomous, self-restarting samples+calendar test loop.
# Runs probe files and scenario batches back-to-back against a child static
# server, appends PASS/FAIL to qa/overnight_runner.log, and NEVER stops on its
# own (a failing probe is logged and the loop moves on). Designed to be launched
# in the background and left running overnight.
#
#   bash qa/overnight_runner.sh            # infinite loop
#   RUN_ROUNDS=3 bash qa/overnight_runner.sh   # bounded (for testing the runner)
set -u
cd "$(dirname "$0")/.."
LOG=qa/overnight_runner.log
PORT=8000
stamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "[$(stamp)] $*" | tee -a "$LOG"; }

# Probe files to cycle (samples system + repros/concurrency/gating/linear/coldopen).
PROBES=(
  qa/probes/sxr_bug_repros.js
  qa/probes/sxr_concurrency.js
  qa/probes/sxr_gating_flags.js
  qa/probes/sxr_cold_open.js
  qa/probes/sxr_kasper_audit_holes.js
  qa/probes/sxr_linear_deep.js
  qa/probes/sxr_realtime_twin.js
  qa/probes/sxr_client_persist_guard.js
)
# NOTE: the 6 fixed-bug guards (bug_repros/audit_holes/gating_flags) now assert
# the FIX holds — a regression re-introducing any bug turns them red in the log.

# CONTENT-CALENDAR sweep (phase 3), COURIER-COMPATIBLE ONLY: the goldens and the
# p-manifest drive the browser with DIRECT egress (CI-only — in this sandbox the
# browser's egress is blocked, so they'd false-FAIL here; they run nightly on
# calendar-e2e-nightly.yml instead). In-session calendar coverage uses the
# courier-based probes: the realtime two-screen twin + the realtime handler probe.
CAL_PROBES=(
  qa/probes/cal_realtime_twin.js
  qa/probes/cal_linear_deep.js
  qa/probes/p88_realtime_handler.js
)
# Scenario batches (small groups so no single process trips SCN_TIMEOUT).
SCN_BATCHES=(
  "smm_reply_to_client_request_video,client_mixed_gating_video,audience_leak_guard_video"
  "resolve_via_kasper_video,resolve_via_client_video,resolve_via_approved_video,resolve_via_stay_video"
  "kasper_undo_video,kasper_finish_video,kasper_close_resurface_video"
  "linear_push_video_status,linear_push_graphic_isolated,linear_tweak_comment_video,linear_no_push_on_note"
  "full_bounce,lifecycle_mixed_kasper,client_request_both_roundtrip"
  "audit_trail_video,two_round_request_video,two_round_request_graphic"
)

run_one() {
  # $1 = label, $2 = command
  local label="$1"; shift
  python3 -m http.server "$PORT" >/dev/null 2>&1 &
  local SRV=$!
  sleep 1.5
  bash -c "$*" >/tmp/ovn_out.txt 2>&1
  local EC=$?
  kill "$SRV" 2>/dev/null
  local tail
  tail=$(grep -E 'pass=|SUMMARY|scenarios:|assertions:|✗' /tmp/ovn_out.txt | tail -4 | tr '\n' ' ')
  if [ $EC -eq 0 ]; then log "PASS  $label  | $tail"; else log "FAIL($EC)  $label  | $tail"; fi
  return 0
}

ROUND=0
log "==== overnight runner START (pid $$) ===="
while :; do
  ROUND=$((ROUND+1))
  log "---- round $ROUND ----"
  for p in "${PROBES[@]}"; do
    [ -f "$p" ] && run_one "probe:$(basename "$p")" "node $p"
  done
  for b in "${SCN_BATCHES[@]}"; do
    run_one "scn:$b" "node qa/probes/run_scenarios.js $b"
  done
  for p in "${CAL_PROBES[@]}"; do
    [ -f "$p" ] && run_one "cal:$(basename "$p")" "node $p"
  done
  # safety sweep: archive any stray sr_probe_/sr_scn_ seeds left behind
  node -e "const {supa,archiveSafe}=require('./qa/sxr_courier_lib.js');try{const r=supa('client=eq.sidneylaruel&status=neq.Archived&select=id');for(const x of (r||[])){if(/^sr_(scn|probe|test)/.test(x.id))archiveSafe(x.id);}}catch(e){}" 2>/dev/null
  log "round $ROUND done; unit gate:"; node test/run-all.js >/tmp/ovn_unit.txt 2>&1 && log "  unit GREEN" || log "  unit FAIL"
  if [ "${RUN_ROUNDS:-0}" != "0" ] && [ "$ROUND" -ge "${RUN_ROUNDS}" ]; then log "bounded stop after $ROUND rounds"; break; fi
done
