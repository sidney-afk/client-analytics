#!/usr/bin/env bash
# Run one bounded slice of the overnight QA matrix. Designed for cron/no_agent
# so coverage continues even when a long Hermes background terminal gets SIGTERM.
builtin set +x
builtin set +a
builtin set -u
builtin unset BASH_ENV ENV

# Protected cron usage enters through `node qa/overnight_entry.js cron`.
# Ambient credentials mean the pre-Bash scrub boundary was bypassed.
builtin unset _OVN_STAFF_ISSUER _OVN_STAFF_FD
_OVN_STAFF_ISSUER=
_OVN_STAFF_FD=${SYNCVIEW_STAFF_KEY_FD-}
builtin export -n _OVN_STAFF_ISSUER _OVN_STAFF_FD 2>/dev/null || :
if [ -n "${SYNCVIEW_STAFF_KEY-}${SYNCVIEW_TEST_CLIENT_TOKEN-}" ]; then
  builtin unset SYNCVIEW_STAFF_KEY SYNCVIEW_TEST_CLIENT_TOKEN SYNCVIEW_STAFF_KEY_FD
  builtin printf '%s\n' "REFUSED: use node qa/overnight_entry.js cron for protected runs" >&2
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

# Stay in builtins while resolving the checked-in root. This keeps Bash's
# command-substitution plumbing out of unrelated child processes.
_OVN_SCRIPT_PATH=${BASH_SOURCE[0]}
case "$_OVN_SCRIPT_PATH" in
  */*) _OVN_SCRIPT_DIR=${_OVN_SCRIPT_PATH%/*}; [ -n "$_OVN_SCRIPT_DIR" ] || _OVN_SCRIPT_DIR=/ ;;
  *) _OVN_SCRIPT_DIR=. ;;
esac
builtin cd -- "$_OVN_SCRIPT_DIR/.."
builtin unset _OVN_SCRIPT_PATH _OVN_SCRIPT_DIR
mkdir -p qa/overnight-output
STATE=${OVERNIGHT_CRON_STATE:-qa/overnight-output/cron-chunk-state}
LOG=${OVERNIGHT_LOG:-qa/overnight_runner.log}
NODE_BIN=${NODE_BIN:-/c/Program Files/nodejs/node.exe}
COMMAND_TIMEOUT_SECONDS=${COMMAND_TIMEOUT_SECONDS:-900}
export SXR_COURIER=${SXR_COURIER:-0}
export COMMAND_TIMEOUT_SECONDS
export NODE_BIN

log() {
  local _ovn_log_stamp _ovn_log_status=0
  local -x TZ=UTC
  builtin printf -v _ovn_log_stamp '%(%Y-%m-%dT%H:%M:%SZ)T' -1
  builtin printf '[%s] CRON %s\n' "$_ovn_log_stamp" "$*" >> "$LOG" || _ovn_log_status=$?
  builtin trap '' PIPE
  builtin printf '[%s] CRON %s\n' "$_ovn_log_stamp" "$*" || :
  builtin trap - PIPE
  return "$_ovn_log_status"
}
_OVN_CRON_CHILD_PID=
_OVN_CRON_PENDING_SIGNAL=

cron_signal() {
  local label=$1 code=$2 pid=${_OVN_CRON_CHILD_PID:-}
  trap '' INT TERM
  if [ -n "$pid" ]; then
    kill -"$label" "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    _OVN_CRON_CHILD_PID=
  fi
  log "received $label; stopped active chunk"
  exit "$code"
}

trap 'cron_signal INT 130' INT
trap 'cron_signal TERM 143' TERM

phase=${OVERNIGHT_CRON_PHASE:-}
if [ -z "$phase" ]; then
  if [ -f "$STATE" ]; then phase=$(cat "$STATE" 2>/dev/null || echo 0); else phase=0; fi
fi
case "$phase" in ''|*[!0-9]*) phase=0 ;; esac
phase=$((phase % 6))
next=$(((phase + 1) % 6))

run_cmd() {
  local ec issuer_fd pid
  log "chunk phase=$phase start: $*"
  if [ "${OVERNIGHT_CRON_DRY_RUN:-0}" = "1" ]; then
    echo "DRY_RUN phase=$phase next=$next :: $*"
    return 0
  fi
  if [ -n "$_OVN_STAFF_ISSUER" ]; then
    shopt -u varredir_close
    exec {issuer_fd}<<<"$_OVN_STAFF_ISSUER"
    _OVN_CRON_PENDING_SIGNAL=
    trap '_OVN_CRON_PENDING_SIGNAL=INT' INT
    trap '_OVN_CRON_PENDING_SIGNAL=TERM' TERM
    BASH_ENV= ENV= SYNCVIEW_STAFF_KEY_FD=$issuer_fd "$@" &
    pid=$!
    _OVN_CRON_CHILD_PID=$pid
    exec {issuer_fd}<&-
  else
    _OVN_CRON_PENDING_SIGNAL=
    trap '_OVN_CRON_PENDING_SIGNAL=INT' INT
    trap '_OVN_CRON_PENDING_SIGNAL=TERM' TERM
    BASH_ENV= ENV= "$@" &
    pid=$!
    _OVN_CRON_CHILD_PID=$pid
  fi
  trap 'cron_signal INT 130' INT
  trap 'cron_signal TERM 143' TERM
  case "$_OVN_CRON_PENDING_SIGNAL" in
    INT) cron_signal INT 130 ;;
    TERM) cron_signal TERM 143 ;;
  esac
  wait "$pid"
  ec=$?
  trap '_OVN_CRON_PENDING_SIGNAL=INT' INT
  trap '_OVN_CRON_PENDING_SIGNAL=TERM' TERM
  _OVN_CRON_CHILD_PID=
  case "$_OVN_CRON_PENDING_SIGNAL" in
    INT) cron_signal INT 130 ;;
    TERM) cron_signal TERM 143 ;;
  esac
  trap 'cron_signal INT 130' INT
  trap 'cron_signal TERM 143' TERM
  case "$_OVN_CRON_PENDING_SIGNAL" in
    INT) cron_signal INT 130 ;;
    TERM) cron_signal TERM 143 ;;
  esac
  _OVN_CRON_PENDING_SIGNAL=
  echo "$next" > "$STATE"
  log "chunk phase=$phase done exit=$ec next=$next"
  return $ec
}

RUN_ROUNDS=1
TREE_EVERY=0
FULL_MASTER_EVERY=0
COMMIT_REPORT_EVERY_ROUND=0
export RUN_ROUNDS TREE_EVERY FULL_MASTER_EVERY COMMIT_REPORT_EVERY_ROUND

configure_chunk() {
  RUN_PROBES=$1
  PROBE_OFFSET=$2
  PROBE_LIMIT=$3
  RUN_SCENARIOS=$4
  SCN_OFFSET=$5
  SCN_LIMIT=$6
  RUN_CALENDAR=$7
  CAL_OFFSET=$8
  CAL_LIMIT=$9
  MASTER_FAST_EVERY=${10}
  RUN_UNIT=1
  export RUN_PROBES PROBE_OFFSET PROBE_LIMIT RUN_SCENARIOS SCN_OFFSET SCN_LIMIT
  export RUN_CALENDAR CAL_OFFSET CAL_LIMIT MASTER_FAST_EVERY RUN_UNIT
}

case "$phase" in
  0)
    configure_chunk 1 0 5 0 0 0 0 0 0 0
    run_cmd "$BASH" qa/overnight_runner.sh
    ;;
  1)
    configure_chunk 1 5 5 0 0 0 1 0 4 0
    run_cmd "$BASH" qa/overnight_runner.sh
    ;;
  2)
    configure_chunk 0 0 0 1 0 4 0 0 0 0
    run_cmd "$BASH" qa/overnight_runner.sh
    ;;
  3)
    configure_chunk 0 0 0 1 4 4 0 0 0 0
    run_cmd "$BASH" qa/overnight_runner.sh
    ;;
  4)
    configure_chunk 0 0 0 1 8 4 0 0 0 0
    run_cmd "$BASH" qa/overnight_runner.sh
    ;;
  5)
    configure_chunk 0 0 0 0 0 0 1 0 4 1
    run_cmd "$BASH" qa/overnight_runner.sh
    ;;
esac
