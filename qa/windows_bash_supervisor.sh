#!/usr/bin/env bash
# Windows-only trusted Bash supervisor. It is the sole process that receives
# the broker stdin: first the issuer line, then an optional INT/TERM control.
# The issuer is placed on a private descriptor for the protected script and is
# cleared before this process begins its credential-free control loop.
builtin set +x
builtin set +a
builtin set -u
builtin unset BASH_ENV ENV

_OVN_SUPERVISOR_PATH=${1-}
_OVN_SUPERVISOR_SCRIPT=${2-}
if [ -z "$_OVN_SUPERVISOR_PATH" ] || [ -z "$_OVN_SUPERVISOR_SCRIPT" ]; then
  builtin printf '%s\n' 'REFUSED: Windows Bash supervisor arguments unavailable' >&2
  builtin exit 70
fi

_OVN_SUPERVISOR_ISSUER=
IFS= builtin read -r _OVN_SUPERVISOR_ISSUER || _OVN_SUPERVISOR_ISSUER=
_OVN_SUPERVISOR_FD=
if [ -n "$_OVN_SUPERVISOR_ISSUER" ]; then
  shopt -u varredir_close
  command exec {_OVN_SUPERVISOR_FD}<<<"$_OVN_SUPERVISOR_ISSUER"
  SYNCVIEW_STAFF_KEY_FD=$_OVN_SUPERVISOR_FD
fi
_OVN_SUPERVISOR_ISSUER=
builtin unset _OVN_SUPERVISOR_ISSUER

(
  command exec 0</dev/null
  PATH=$_OVN_SUPERVISOR_PATH
  builtin unset MSYS2_ARG_CONV_EXCL
  builtin export PATH
  builtin source "$_OVN_SUPERVISOR_SCRIPT"
) &
_OVN_SUPERVISOR_CHILD=$!
if [ -n "$_OVN_SUPERVISOR_FD" ]; then
  command exec {_OVN_SUPERVISOR_FD}<&-
fi
builtin unset SYNCVIEW_STAFF_KEY_FD _OVN_SUPERVISOR_FD

while builtin kill -0 "$_OVN_SUPERVISOR_CHILD" 2>/dev/null; do
  _OVN_SUPERVISOR_CONTROL=
  IFS= builtin read -r -t 0.25 _OVN_SUPERVISOR_CONTROL
  _OVN_SUPERVISOR_READ=$?
  case "$_OVN_SUPERVISOR_READ" in
    0)
      case "$_OVN_SUPERVISOR_CONTROL" in
        INT|TERM)
          builtin kill -s "$_OVN_SUPERVISOR_CONTROL" "$_OVN_SUPERVISOR_CHILD" 2>/dev/null || :
          wait "$_OVN_SUPERVISOR_CHILD" 2>/dev/null || :
          if [ "$_OVN_SUPERVISOR_CONTROL" = INT ]; then builtin exit 130; fi
          builtin exit 143
          ;;
        COMPLETE) ;;
        *)
          builtin kill -TERM "$_OVN_SUPERVISOR_CHILD" 2>/dev/null || :
          wait "$_OVN_SUPERVISOR_CHILD" 2>/dev/null || :
          builtin exit 70
          ;;
      esac
      ;;
    1)
      builtin kill -TERM "$_OVN_SUPERVISOR_CHILD" 2>/dev/null || :
      wait "$_OVN_SUPERVISOR_CHILD" 2>/dev/null || :
      builtin exit 143
      ;;
    *) ;;
  esac
done

wait "$_OVN_SUPERVISOR_CHILD"
builtin exit $?
