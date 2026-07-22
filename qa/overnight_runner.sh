#!/usr/bin/env bash
# overnight_runner.sh — autonomous, self-restarting SyncView test loop.
# Runs real-browser probes, scenario batches, and master lanes back-to-back.
# It logs failures and continues so an overnight run never stalls on one red case.
#
# Protected usage enters through the non-Bash broker so BASH_ENV/ENV are
# scrubbed before Bash startup:
#   node qa/overnight_entry.js runner
#   RUN_HOURS=9 FULL_MASTER_EVERY=2 node qa/overnight_entry.js runner
#   RUN_ROUNDS=1 PROBE_LIMIT=2 SCN_LIMIT=1 CAL_LIMIT=1 MASTER_FAST_EVERY=0 node qa/overnight_entry.js runner
builtin set +x
builtin set +a
builtin set -u
builtin unset BASH_ENV ENV

# The unattended runner accepts a private descriptor only. Ambient credentials
# mean the non-Bash entry boundary was bypassed and must fail before any child.
builtin unset _OVN_STAFF_ISSUER _OVN_STAFF_FD
_OVN_STAFF_ISSUER=
_OVN_STAFF_FD=${SYNCVIEW_STAFF_KEY_FD-}
builtin export -n _OVN_STAFF_ISSUER _OVN_STAFF_FD 2>/dev/null || :
if [ -n "${SYNCVIEW_STAFF_KEY-}${SYNCVIEW_TEST_CLIENT_TOKEN-}" ]; then
  builtin unset SYNCVIEW_STAFF_KEY SYNCVIEW_TEST_CLIENT_TOKEN SYNCVIEW_STAFF_KEY_FD
  builtin printf '%s\n' "REFUSED: use node qa/overnight_entry.js runner for protected runs" >&2
  builtin exit 78
fi
builtin unset SYNCVIEW_STAFF_KEY SYNCVIEW_TEST_CLIENT_TOKEN SYNCVIEW_STAFF_KEY_FD
if [ -n "$_OVN_STAFF_FD" ]; then
  case "$_OVN_STAFF_FD" in
    ''|*[!0-9]*)
      builtin printf '%s\n' "REFUSED: invalid TEST-client issuer descriptor" >&2
      builtin exit 78
      ;;
    1|2)
      builtin unset _OVN_STAFF_FD
      builtin printf '%s\n' "REFUSED: issuer descriptor overlaps output" >&2
      builtin exit 78
      ;;
    *)
      if [ "$_OVN_STAFF_FD" = 0 ]; then
        IFS= builtin read -r _OVN_STAFF_ISSUER || _OVN_STAFF_ISSUER=
        command exec 0</dev/null
      else
        IFS= builtin read -r -u "$_OVN_STAFF_FD" _OVN_STAFF_ISSUER || _OVN_STAFF_ISSUER=
        command exec {_OVN_STAFF_FD}<&-
      fi
      ;;
  esac
  if [ -z "$_OVN_STAFF_ISSUER" ]; then
    builtin printf '%s\n' "REFUSED: TEST-client issuer descriptor was empty" >&2
    builtin exit 78
  fi
fi
builtin unset _OVN_STAFF_FD

# Resolve the checked-in root without a command substitution. An external
# dirname launched inside `$(...)` can inherit Bash's private substitution pipe
# on some POSIX hosts, creating an unrelated child descriptor channel.
_OVN_SCRIPT_PATH=${BASH_SOURCE[0]}
case "$_OVN_SCRIPT_PATH" in
  */*) _OVN_SCRIPT_DIR=${_OVN_SCRIPT_PATH%/*}; [ -n "$_OVN_SCRIPT_DIR" ] || _OVN_SCRIPT_DIR=/ ;;
  *) _OVN_SCRIPT_DIR=. ;;
esac
builtin cd -- "$_OVN_SCRIPT_DIR/.."
builtin unset _OVN_SCRIPT_PATH _OVN_SCRIPT_DIR
LOG=${OVERNIGHT_LOG:-qa/overnight_runner.log}
OUTDIR=${OVERNIGHT_OUTDIR:-qa/overnight-output}
PORT=${PORT:-8000}
PYTHON_BIN=${PYTHON_BIN:-python}
NODE_BIN=${NODE_BIN:-/c/Program Files/nodejs/node.exe}
COMMAND_TIMEOUT_SECONDS=${COMMAND_TIMEOUT_SECONDS:-1200}
case "$COMMAND_TIMEOUT_SECONDS" in
  ''|*[!0-9]*|??????????*) COMMAND_TIMEOUT_SECONDS=1200 ;;
  *) COMMAND_TIMEOUT_SECONDS=$((10#$COMMAND_TIMEOUT_SECONDS)) ;;
esac
if [ ! -x "$NODE_BIN" ]; then NODE_BIN=${NODE_BIN_FALLBACK:-node}; fi
export SXR_COURIER=${SXR_COURIER:-0}
export MASTER_CHANGE_NOTE=${MASTER_CHANGE_NOTE:-overnight autonomous SyncView QA}
_OVN_ACTIVE_COMMAND_PID=
_OVN_ACTIVE_TIMER_PID=
_OVN_PENDING_SIGNAL=
SRV_PID=
mkdir -p "$OUTDIR"
LOCK_DIR=${OVERNIGHT_LOCK_DIR:-$OUTDIR/.overnight_runner.lock}

log() {
  local _ovn_log_stamp _ovn_log_status=0
  local -x TZ=UTC
  builtin printf -v _ovn_log_stamp '%(%Y-%m-%dT%H:%M:%SZ)T' -1
  builtin printf '[%s] %s\n' "$_ovn_log_stamp" "$*" >> "$LOG" || _ovn_log_status=$?
  builtin trap '' PIPE
  builtin printf '[%s] %s\n' "$_ovn_log_stamp" "$*" || :
  builtin trap - PIPE
  return "$_ovn_log_status"
}
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
  if port_ready; then
    log "REFUSE port :${PORT} is already occupied; protected client URLs require an owned silent server"
    return 1
  fi
  _OVN_PENDING_SIGNAL=
  trap '_OVN_PENDING_SIGNAL=INT' INT
  trap '_OVN_PENDING_SIGNAL=TERM' TERM
  env -u SYNCVIEW_STAFF_KEY -u SYNCVIEW_TEST_CLIENT_TOKEN "$PYTHON_BIN" -c '
import http.server, os, sys
if os.environ.get("SYNCVIEW_STAFF_KEY") or os.environ.get("SYNCVIEW_TEST_CLIENT_TOKEN"):
    raise SystemExit(78)
http.server.test(HandlerClass=http.server.SimpleHTTPRequestHandler, port=int(sys.argv[1]), bind="127.0.0.1")
' "$PORT" >/dev/null 2>&1 &
  SRV_PID=$!
  restore_run_signal_handlers
  for _ in $(seq 1 40); do
    if ! kill -0 "$SRV_PID" 2>/dev/null; then
      log "REFUSE owned server exited before readiness on :${PORT}"
      SRV_PID=""
      return 1
    fi
    port_ready && return 0
    sleep 0.25
  done
  log "WARN server did not become ready on :${PORT}; pid=${SRV_PID}"
  stop_server
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

probe_needs_client_entry() {
  local candidate=${1-}
  # Ask the existing immutable JS registry. The realpath check prevents a
  # registered basename outside qa/probes (or through a symlink) from gaining
  # the issuer capability.
  command "$NODE_BIN" -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const { probeNeedsClientEntry } = require("./qa/test-client-entry.js");
    const root = fs.realpathSync(path.resolve("qa/probes"));
    let candidate;
    try { candidate = fs.realpathSync(path.resolve(process.argv[1] || "")); }
    catch { process.exit(1); }
    process.exit(
      path.dirname(candidate) === root
      && probeNeedsClientEntry(path.basename(candidate))
        ? 0 : 1
    );
  ' "$candidate" >/dev/null 2>&1
}

command_needs_client_entry() {
  [ "$#" -ge 2 ] || return 1
  [ "$1" = "$NODE_BIN" ] || return 1
  case "$2" in
    qa/master.js|qa/probes/run_scenarios.js)
      return 0
      ;;
    qa/probes/*.js)
      probe_needs_client_entry "$2"
      ;;
    *)
      return 1
      ;;
  esac
}

command_group_alive() {
  local pid=${1-}
  [ -n "$pid" ] && kill -0 -- "-$pid" 2>/dev/null
}

terminate_command_tree() {
  local pid=${1-}
  local leader_reaped=${2:-0}
  local killer_pid finished attempt
  [ -n "$pid" ] || return 0

  # Reap the leader as soon as it cooperates while one credential-free timer
  # preserves the former 30-second descendant grace period. `command` bypasses
  # any BASH_ENV-provided function, and the parent owns the final KILL.
  BASH_ENV= ENV= command sleep 30 &
  killer_pid=$!
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  finished=
  if [ "$leader_reaped" = 1 ]; then
    if command_group_alive "$pid"; then
      wait -f "$killer_pid" 2>/dev/null || true
      finished=$killer_pid
    fi
  else
    wait -n -f -p finished "$pid" "$killer_pid" 2>/dev/null || true
    case "${finished-}" in
      "$pid")
        if command_group_alive "$pid"; then
          finished=
          wait -n -f -p finished "$killer_pid" 2>/dev/null || true
        fi
        ;;
      "$killer_pid") ;;
    esac
  fi
  if command_group_alive "$pid"; then
    kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  fi
  if [ "${finished-}" != "$killer_pid" ]; then
    kill -TERM -- "-$killer_pid" 2>/dev/null || kill -TERM "$killer_pid" 2>/dev/null || true
    wait "$killer_pid" 2>/dev/null || true
  fi
  [ "$leader_reaped" = 1 ] || wait "$pid" 2>/dev/null || true
  for attempt in {1..100}; do
    command_group_alive "$pid" || return 0
    BASH_ENV= ENV= command sleep 0.05
  done
  return 1
}

terminate_active_command() {
  local pid=${_OVN_ACTIVE_COMMAND_PID:-}
  [ -n "$pid" ] || return 0
  terminate_command_tree "$pid"
  _OVN_ACTIVE_COMMAND_PID=
}

stop_active_timer() {
  local pid=${_OVN_ACTIVE_TIMER_PID:-}
  [ -n "$pid" ] || return 0
  kill -TERM "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  _OVN_ACTIVE_TIMER_PID=
}

restore_run_signal_handlers() {
  case "$_OVN_PENDING_SIGNAL" in
    INT) signal_shutdown INT 130 ;;
    TERM) signal_shutdown TERM 143 ;;
  esac
  trap 'signal_shutdown INT 130' INT
  trap 'signal_shutdown TERM 143' TERM
  # Close the narrow check-to-trap race: a signal delivered before the direct
  # handlers were restored was recorded by the pending-only handler.
  case "$_OVN_PENDING_SIGNAL" in
    INT) signal_shutdown INT 130 ;;
    TERM) signal_shutdown TERM 143 ;;
  esac
  _OVN_PENDING_SIGNAL=
}

run_bounded_command() {
  local out=$1
  shift
  local needs_issuer=0 pid ec timer_pid first_ec finished
  local monitor_was_on=0

  command_needs_client_entry "$@" && needs_issuer=1
  if [ "$needs_issuer" -eq 1 ] && [ -z "$_OVN_STAFF_ISSUER" ]; then
    printf '%s\n' "REFUSED: protected TEST-client issuer unavailable" >"$out"
    return 78
  fi

  # Job control gives the operative Node process its own group so Chromium
  # descendants receive the same TERM/KILL boundary as the former timeout
  # wrapper. The waiting parent and its single timer remain credential-free.
  case $- in *m*) monitor_was_on=1 ;; esac
  [ "$monitor_was_on" -eq 1 ] || set -m
  # Keep shutdown deferred through launch, wait, and local reaping. A signal is
  # serviced only after the completed PID has been cleared from active state.
  _OVN_PENDING_SIGNAL=
  trap '_OVN_PENDING_SIGNAL=INT' INT
  trap '_OVN_PENDING_SIGNAL=TERM' TERM
  if [ "$needs_issuer" -eq 1 ]; then
    SYNCVIEW_STAFF_KEY="$_OVN_STAFF_ISSUER" command "$@" >"$out" 2>&1 &
  else
    command "$@" >"$out" 2>&1 &
  fi
  pid=$!
  _OVN_ACTIVE_COMMAND_PID=$pid
  timer_pid=
  if [ "$COMMAND_TIMEOUT_SECONDS" -gt 0 ]; then
    BASH_ENV= ENV= command sleep "$COMMAND_TIMEOUT_SECONDS" &
    timer_pid=$!
    _OVN_ACTIVE_TIMER_PID=$timer_pid
  fi
  case "$_OVN_PENDING_SIGNAL" in
    INT) signal_shutdown INT 130 ;;
    TERM) signal_shutdown TERM 143 ;;
  esac
  trap 'signal_shutdown INT 130' INT
  trap 'signal_shutdown TERM 143' TERM
  case "$_OVN_PENDING_SIGNAL" in
    INT) signal_shutdown INT 130 ;;
    TERM) signal_shutdown TERM 143 ;;
  esac

  finished=
  if [ -n "$timer_pid" ]; then
    wait -n -f -p finished "$pid" "$timer_pid"
  else
    wait -n -f -p finished "$pid"
  fi
  first_ec=$?
  trap '_OVN_PENDING_SIGNAL=INT' INT
  trap '_OVN_PENDING_SIGNAL=TERM' TERM
  case "${finished-}" in
    "$pid") _OVN_ACTIVE_COMMAND_PID= ;;
    "$timer_pid") _OVN_ACTIVE_TIMER_PID= ;;
  esac
  case "$_OVN_PENDING_SIGNAL" in
    INT) signal_shutdown INT 130 ;;
    TERM) signal_shutdown TERM 143 ;;
  esac

  if [ "${finished-}" = "$pid" ]; then
    ec=$first_ec
    _OVN_ACTIVE_COMMAND_PID=
    stop_active_timer
    if command_group_alive "$pid"; then
      if terminate_command_tree "$pid" 1; then
        printf '%s\n' "REFUSED: overnight command left descendant processes after its leader exited" >>"$out"
        ec=125
      else
        printf '%s\n' "REFUSED: overnight command descendant cleanup could not be confirmed" >>"$out"
        ec=126
      fi
    fi
  elif [ -n "$timer_pid" ] && [ "${finished-}" = "$timer_pid" ]; then
    if [ "$first_ec" -eq 0 ]; then
      ec=124
    else
      ec=125
    fi
    terminate_command_tree "$pid" || {
      ec=126
      printf '%s\n' "REFUSED: overnight command descendant cleanup could not be confirmed" >>"$out"
    }
    _OVN_ACTIVE_COMMAND_PID=
    if [ "$ec" -eq 125 ]; then
      printf '%s\n' "REFUSED: credential-free timeout timer failed" >>"$out"
    fi
  else
    stop_active_timer
    if terminate_command_tree "$pid"; then
      ec=125
    else
      ec=126
      printf '%s\n' "REFUSED: overnight command descendant cleanup could not be confirmed" >>"$out"
    fi
    _OVN_ACTIVE_COMMAND_PID=
    printf '%s\n' "REFUSED: timeout coordination failed" >>"$out"
  fi
  [ "$monitor_was_on" -eq 1 ] || set +m
  restore_run_signal_handlers
  return "$ec"
}

shutdown_runner() {
  stop_active_timer
  terminate_active_command
  stop_server 2>/dev/null || true
  release_runner_lock
}

signal_shutdown() {
  local label=$1 code=$2
  trap '' INT TERM
  log "received $label; stopping runner"
  shutdown_runner
  trap - EXIT
  exit "$code"
}

run_one() {
  local label="$1"; shift
  local safe out ec tail
  safe=$(slug "$label")
  out="$OUTDIR/$(date -u +%Y%m%dT%H%M%SZ)_${safe}.log"
  log "START $label"
  if ! start_server; then
    printf '%s\n' "REFUSED: owned silent static server unavailable on :${PORT}" >"$out"
    log "FAIL(server)  $label  | protected client route was not opened | output=$out"
    return 0
  fi
  run_bounded_command "$out" "$@"
  ec=$?
  stop_server
  tail=$(grep -E 'PASS |FAIL |REFUSED:|pass=|fail=|SUMMARY|MASTER:|scenarios:|assertions:|All .*passed|RESULT:|✗|❌|✅' "$out" | tail -8 | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g')
  if [ $ec -eq 0 ]; then log "PASS  $label  | $tail"; else log "FAIL($ec)  $label  | $tail  | output=$out"; fi
  if [ $ec -eq 126 ]; then exit 126; fi
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
trap 'shutdown_runner' EXIT
trap 'signal_shutdown INT 130' INT
trap 'signal_shutdown TERM 143' TERM
acquire_runner_lock
log "==== overnight runner START pid=$$ node=$NODE_BIN python=$PYTHON_BIN sxr_courier=$SXR_COURIER run_hours=${RUN_HOURS:-infinite} ===="

while :; do
  ROUND=$((ROUND + 1))
  log "---- round $ROUND ----"

  if [ "${RUN_PROBES:-1}" != "0" ]; then
    i=0; ran=0
    for p in "${PROBES[@]}"; do
      [ -f "$p" ] || continue
      i=$((i + 1)); [ "$i" -le "${PROBE_OFFSET:-0}" ] && continue
      ran=$((ran + 1)); [ "${PROBE_LIMIT:-0}" != "0" ] && [ "$ran" -gt "${PROBE_LIMIT}" ] && break
      run_one "probe:$(basename "$p")" "$NODE_BIN" "$p"
      cleanup_seeds
    done
  fi

  if [ "${RUN_SCENARIOS:-1}" != "0" ]; then
    i=0; ran=0
    for b in "${SCN_BATCHES[@]}"; do
      i=$((i + 1)); [ "$i" -le "${SCN_OFFSET:-0}" ] && continue
      ran=$((ran + 1)); [ "${SCN_LIMIT:-0}" != "0" ] && [ "$ran" -gt "${SCN_LIMIT}" ] && break
      run_one "scn:$b" "$NODE_BIN" qa/probes/run_scenarios.js "$b"
      cleanup_seeds
    done
  fi

  if [ "${RUN_CALENDAR:-1}" != "0" ]; then
    i=0; ran=0
    for p in "${CAL_PROBES[@]}"; do
      [ -f "$p" ] || continue
      i=$((i + 1)); [ "$i" -le "${CAL_OFFSET:-0}" ] && continue
      ran=$((ran + 1)); [ "${CAL_LIMIT:-0}" != "0" ] && [ "$ran" -gt "${CAL_LIMIT}" ] && break
      run_one "calendar:$(basename "$p")" "$NODE_BIN" "$p"
      cleanup_seeds
    done
  fi

  if [ "${MASTER_FAST_EVERY:-1}" != "0" ] && [ $((ROUND % MASTER_FAST_EVERY)) -eq 0 ]; then
    run_one "master:fast" "$NODE_BIN" qa/master.js --profile=fast --no-server
  fi
  # Tree/full master are intentionally opt-in for unattended marathons: the flat
  # library + fast master already cover the same branches continuously, while a
  # single very-long tree run can stall the loop for hours on Windows.
  if [ "${TREE_EVERY:-0}" != "0" ] && [ $((ROUND % TREE_EVERY)) -eq 0 ]; then
    run_one "master:tree" "$NODE_BIN" qa/master.js --lane=tree --no-server
  fi
  if [ "${FULL_MASTER_EVERY:-0}" != "0" ] && [ $((ROUND % FULL_MASTER_EVERY)) -eq 0 ]; then
    run_one "master:full" "$NODE_BIN" qa/master.js --profile=full --no-server
  fi

  cleanup_seeds
  if [ "${RUN_UNIT:-1}" != "0" ]; then run_one "unit:run-all" "$NODE_BIN" test/run-all.js; fi
  log "round $ROUND done"
  maybe_commit_report

  if [ "${RUN_ROUNDS:-0}" != "0" ] && [ "$ROUND" -ge "${RUN_ROUNDS}" ]; then log "bounded stop after $ROUND rounds"; break; fi
  if [ "$MAX_SECONDS" -gt 0 ]; then
    now=$(date +%s)
    if [ $((now - START_TS)) -ge "$MAX_SECONDS" ]; then log "bounded stop after RUN_HOURS=${RUN_HOURS}"; break; fi
  fi
done
log "==== overnight runner STOP pid=$$ ===="
