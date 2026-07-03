#!/usr/bin/env bash
# overnight_runner.sh — autonomous, self-restarting SyncView test loop.
# Runs real-browser probes, scenario batches, and master lanes back-to-back.
# It logs failures and continues so an overnight run never stalls on one red case.
#
# Usage:
#   bash qa/overnight_runner.sh
#   RUN_HOURS=9 FULL_MASTER_EVERY=2 bash qa/overnight_runner.sh
#   RUN_ROUNDS=1 PROBE_LIMIT=2 SCN_LIMIT=1 CAL_LIMIT=1 MASTER_FAST_EVERY=0 bash qa/overnight_runner.sh
set -u

cd "$(dirname "$0")/.."
LOG=${OVERNIGHT_LOG:-qa/overnight_runner.log}
OUTDIR=${OVERNIGHT_OUTDIR:-qa/overnight-output}
PORT=${PORT:-8000}
PYTHON_BIN=${PYTHON_BIN:-python}
NODE_BIN=${NODE_BIN:-/c/Program Files/nodejs/node.exe}
COMMAND_TIMEOUT_SECONDS=${COMMAND_TIMEOUT_SECONDS:-1200}
if [ ! -x "$NODE_BIN" ]; then NODE_BIN=${NODE_BIN_FALLBACK:-node}; fi
export SXR_COURIER=${SXR_COURIER:-0}
export MASTER_CHANGE_NOTE=${MASTER_CHANGE_NOTE:-overnight autonomous SyncView QA}
mkdir -p "$OUTDIR"
LOCK_DIR=${OVERNIGHT_LOCK_DIR:-$OUTDIR/.overnight_runner.lock}

stamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "[$(stamp)] $*" | tee -a "$LOG"; }
slug() {
  local safe max tail head
  safe=$(echo "$1" | tr ' /,:|*?"' '_________' | tr -cd 'A-Za-z0-9_.=-')
  max=${OVERNIGHT_SAFE_SLUG_MAX:-160}
  if [ "${#safe}" -le "$max" ]; then printf '%s\n' "$safe"; return; fi
  tail=24
  if [ "$max" -le "$tail" ]; then printf '%s\n' "${safe:0:$max}"; return; fi
  head=$((max - tail - 1))
  printf '%s_%s\n' "${safe:0:$head}" "${safe: -$tail}"
}
port_ready() { curl -s -o /dev/null -w '%{http_code}' "http://localhost:${PORT}/index.html" 2>/dev/null | grep -q '^200$'; }

start_server() {
  SRV_PID=""
  if port_ready; then return 0; fi
  "$PYTHON_BIN" -m http.server "$PORT" >/tmp/syncview_overnight_http.log 2>&1 &
  SRV_PID=$!
  for _ in $(seq 1 40); do port_ready && return 0; sleep 0.25; done
  log "WARN server did not become ready on :${PORT}; pid=${SRV_PID}"
  return 1
}
stop_server() {
  if [ -n "${SRV_PID:-}" ]; then kill "$SRV_PID" 2>/dev/null || true; wait "$SRV_PID" 2>/dev/null || true; SRV_PID=""; fi
}

acquire_runner_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$" >"$LOCK_DIR/pid"
    return 0
  fi

  local existing
  existing=$(cat "$LOCK_DIR/pid" 2>/dev/null || true)
  if [ -n "$existing" ] && kill -0 "$existing" 2>/dev/null; then
    log "another overnight runner is active pid=$existing; exiting to avoid live-test collisions"
    exit 0
  fi

  log "removing stale overnight runner lock pid=${existing:-unknown}"
  rm -rf "$LOCK_DIR"
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$" >"$LOCK_DIR/pid"
    return 0
  fi

  log "could not acquire overnight runner lock at $LOCK_DIR; exiting"
  exit 0
}

release_runner_lock() {
  rm -rf "$LOCK_DIR" 2>/dev/null || true
}

run_one() {
  local label="$1"; shift
  local safe out ec tail
  safe=$(slug "$label")
  out="$OUTDIR/$(date -u +%Y%m%dT%H%M%SZ)_${safe}.log"
  log "START $label"
  start_server || true
  if command -v timeout >/dev/null 2>&1; then
    timeout --kill-after=30s "$COMMAND_TIMEOUT_SECONDS" "$@" >"$out" 2>&1
  else
    "$@" >"$out" 2>&1
  fi
  ec=$?
  stop_server
  tail=$(grep -E 'PASS |FAIL |pass=|fail=|SUMMARY|MASTER:|scenarios:|assertions:|All .*passed|RESULT:|✗|❌|✅' "$out" | tail -8 | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g')
  if [ $ec -eq 0 ]; then log "PASS  $label  | $tail"; else log "FAIL($ec)  $label  | $tail  | output=$out"; fi
  return 0
}

cleanup_seeds() {
  "$NODE_BIN" - <<'NODE' >>"$LOG" 2>&1 || true
const L = require('./qa/sxr_courier_lib.js');
const sampleName = /^(SCN |UI Create|UI Rapid|UI Reorder|UI Remote|UI Reload|UI Batch|UI Workflow|P91 UI RT|MID MERGE|DBG STATUS|OVN |P9\d |SXR )/;
const calName = /^(CAL UI|DBG CAL|P89|UI CAL|OVN CAL|CAL RT|P9\d )/;
const arr = x => Array.isArray(x) ? x : [];
let archivedS = 0, archivedC = 0;
try {
  const rows = arr(L.supa('client=eq.sidneylaruel&or=(status.neq.Archived,status.is.null)&select=id,name,status&limit=1000'));
  for (const r of rows) if (/^sr_(scn|probe|test|mr|ovn)/.test(String(r.id || '')) || sampleName.test(String(r.name || ''))) { try { L.archiveSafe(r.id); archivedS++; } catch {} }
} catch {}
try {
  const rows = arr(L.supaCal('client=eq.sidneylaruel&or=(status.neq.Archived,status.is.null)&select=id,name,status&limit=1000'));
  for (const r of rows) if (calName.test(String(r.name || ''))) { try { L.archiveCalSafe(r.id); archivedC++; } catch {} }
} catch {}
let liveS = 0, liveC = 0;
try { liveS = arr(L.supa('client=eq.sidneylaruel&or=(status.neq.Archived,status.is.null)&select=id,name,status&limit=1000')).filter(r => sampleName.test(String(r.name || ''))).length; } catch {}
try { liveC = arr(L.supaCal('client=eq.sidneylaruel&or=(status.neq.Archived,status.is.null)&select=id,name,status&limit=1000')).filter(r => calName.test(String(r.name || ''))).length; } catch {}
console.log(`[${new Date().toISOString()}] cleanup archived samples=${archivedS} calendar=${archivedC}; live_test_rows sample_reviews=${liveS} calendar_posts=${liveC}`);
NODE
}

maybe_commit_report() {
  if [ "${COMMIT_REPORT_EVERY_ROUND:-0}" = "1" ]; then
    git add qa/overnight_runner.log qa/overnight-output qa/OVERNIGHT_TEST_REPORT.md >/dev/null 2>&1 || true
    git diff --cached --quiet || git commit -m "test: update overnight QA log" >/dev/null 2>&1 || true
    git push >/dev/null 2>&1 || true
  fi
}

# Samples, calendar, and realtime probes. Missing probes are skipped.
PROBES=(
  qa/probes/sxr_bug_repros.js
  qa/probes/sxr_concurrency.js
  qa/probes/sxr_gating_flags.js
  qa/probes/sxr_cold_open.js
  qa/probes/sxr_kasper_audit_holes.js
  qa/probes/sxr_linear_deep.js
  qa/probes/sxr_realtime_twin.js
  qa/probes/sxr_client_persist_guard.js
  qa/probes/p90_merge_midsave_keep.js
  qa/probes/p91_ui_realtime_multitab.js
)
CAL_PROBES=(
  qa/probes/cal_realtime_twin.js
  qa/probes/cal_linear_deep.js
  qa/probes/p88_realtime_handler.js
  qa/probes/p89_cal_create_via_ui.js
)
SCN_BATCHES=(
  "create_via_ui,create_via_ui_rename,create_then_archive_race,create_rename_rename_race,create_drag_reorder_persist,create_during_remote_merge,create_survives_reload,create_many_via_ui,create_via_ui_workflow_video"
  "clean_both,clean_video_only,smm_alt_to_client,smm_request_video,kasper_request_video,kasper_aat_video,client_request_video,client_approve_video"
  "smm_request_graphic,kasper_request_graphic,kasper_aat_graphic,client_request_graphic,client_approve_graphic"
  "worstof_inprogress,worstof_smm,notes_audiences,notes_markdone,comment_no_status,note_internal_video,note_client_video,note_internal_graphic,note_client_graphic"
  "aat_continuation_video,smm_request_fix_approve_video,kasper_request_fix_approve_video,client_request_fix_approve_video,two_round_request_video"
  "aat_continuation_graphic,smm_request_fix_approve_graphic,kasper_request_fix_approve_graphic,client_request_fix_approve_graphic,two_round_request_graphic"
  "both_request_then_approve,full_bounce,aat_full_path_video,kasper_two_round_video,client_two_round_video,note_then_request_video"
  "aat_full_path_graphic,kasper_two_round_graphic,client_two_round_graphic,note_then_request_graphic,client_request_both_roundtrip,lifecycle_mixed_kasper"
  "kasper_approve_v_request_g,client_approve_v_request_g,smm_v_kasper_g_route,mixed_stage_smm_kasper,worstof_client_boundary,worstof_kasper_vs_client"
  "client_comment_video,client_comment_graphic,smm_comment_video,client_comment_then_approve_video,kasper_comment_internal_video,smm_reply_to_client_request_video,client_mixed_gating_video,audience_leak_guard_video"
  "resolve_via_kasper_video,resolve_via_client_video,resolve_via_approved_video,resolve_via_stay_video,resolve_via_kasper_graphic,reopen_tweak_video,delete_comment_video,kasper_undo_video,kasper_finish_video,kasper_close_resurface_video"
  "linear_push_video_status,linear_push_graphic_isolated,linear_tweak_comment_video,linear_no_push_on_note,audit_trail_video"
)

ROUND=0
START_TS=$(date +%s)
MAX_SECONDS=0
if [ "${RUN_HOURS:-0}" != "0" ]; then MAX_SECONDS=$((RUN_HOURS * 3600)); fi
acquire_runner_lock
trap 'stop_server 2>/dev/null || true; release_runner_lock' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
log "==== overnight runner START pid=$$ branch=$(git branch --show-current) node=$NODE_BIN python=$PYTHON_BIN sxr_courier=$SXR_COURIER run_hours=${RUN_HOURS:-infinite} ===="

while :; do
  ROUND=$((ROUND + 1))
  log "---- round $ROUND ----"

  i=0
  for p in "${PROBES[@]}"; do
    [ -f "$p" ] || continue
    i=$((i + 1)); [ "${PROBE_LIMIT:-0}" != "0" ] && [ "$i" -gt "${PROBE_LIMIT}" ] && break
    run_one "probe:$(basename "$p")" "$NODE_BIN" "$p"
    cleanup_seeds
  done

  i=0
  for b in "${SCN_BATCHES[@]}"; do
    i=$((i + 1)); [ "${SCN_LIMIT:-0}" != "0" ] && [ "$i" -gt "${SCN_LIMIT}" ] && break
    run_one "scn:$b" "$NODE_BIN" qa/probes/run_scenarios.js "$b"
    cleanup_seeds
  done

  i=0
  for p in "${CAL_PROBES[@]}"; do
    [ -f "$p" ] || continue
    i=$((i + 1)); [ "${CAL_LIMIT:-0}" != "0" ] && [ "$i" -gt "${CAL_LIMIT}" ] && break
    run_one "calendar:$(basename "$p")" "$NODE_BIN" "$p"
    cleanup_seeds
  done

  if [ "${MASTER_FAST_EVERY:-1}" != "0" ] && [ $((ROUND % MASTER_FAST_EVERY)) -eq 0 ]; then
    run_one "master:fast" env SXR_COURIER="$SXR_COURIER" MASTER_CHANGE_NOTE="$MASTER_CHANGE_NOTE" "$NODE_BIN" qa/master.js --profile=fast --no-server
  fi
  # Tree/full master are intentionally opt-in for unattended marathons: the flat
  # library + fast master already cover the same branches continuously, while a
  # single very-long tree run can stall the loop for hours on Windows.
  if [ "${TREE_EVERY:-0}" != "0" ] && [ $((ROUND % TREE_EVERY)) -eq 0 ]; then
    run_one "master:tree" env SXR_COURIER="$SXR_COURIER" MASTER_CHANGE_NOTE="$MASTER_CHANGE_NOTE" "$NODE_BIN" qa/master.js --lane=tree --no-server
  fi
  if [ "${FULL_MASTER_EVERY:-0}" != "0" ] && [ $((ROUND % FULL_MASTER_EVERY)) -eq 0 ]; then
    run_one "master:full" env SXR_COURIER="$SXR_COURIER" MASTER_CHANGE_NOTE="$MASTER_CHANGE_NOTE" "$NODE_BIN" qa/master.js --profile=full --no-server
  fi

  cleanup_seeds
  run_one "unit:run-all" "$NODE_BIN" test/run-all.js
  log "round $ROUND done"
  maybe_commit_report

  if [ "${RUN_ROUNDS:-0}" != "0" ] && [ "$ROUND" -ge "${RUN_ROUNDS}" ]; then log "bounded stop after $ROUND rounds"; break; fi
  if [ "$MAX_SECONDS" -gt 0 ]; then
    now=$(date +%s)
    if [ $((now - START_TS)) -ge "$MAX_SECONDS" ]; then log "bounded stop after RUN_HOURS=${RUN_HOURS}"; break; fi
  fi
done
log "==== overnight runner STOP pid=$$ ===="
