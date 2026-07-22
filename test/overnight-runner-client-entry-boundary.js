'use strict';

/*
 * F176: the unattended Bash entrypoints are credential brokers, not ambient
 * credential exporters. This guard launches the checked-in runner and cron
 * wrapper with synthetic credentials while harmless PATH shims observe the
 * actual child-process boundary. No network, browser, backend, or real Git
 * command or external network is used.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const {
  CLIENT_ENTRY_PROBE_FILES,
  probeNeedsClientEntry,
} = require('../qa/test-client-entry.js');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'qa', 'overnight_entry.js');
const WINDOWS_JOB_GUARD = path.join(ROOT, 'qa', 'windows_job_guard.ps1');
const WINDOWS_JOB_WORKER = path.join(ROOT, 'qa', 'windows_job_worker.js');
const WINDOWS_BASH_SUPERVISOR = path.join(ROOT, 'qa', 'windows_bash_supervisor.sh');
const POSIX_SESSION_GUARD = path.join(ROOT, 'qa', 'posix_session_guard.js');
const RUNNER = path.join(ROOT, 'qa', 'overnight_runner.sh');
const CRON = path.join(ROOT, 'qa', 'overnight_cron_chunk.sh');
const WINDOWS_GUARD_READY_TIMEOUT_MS = 60_000;
const STAFF_MARKER = 'f176-synthetic-staff-marker-7f9c';
const LEGACY_MARKER = 'f176-synthetic-legacy-marker-2a4e';
const INJECTION_MARKER = 'f176-startup-injection-marker-91bd';

function findBash() {
  for (const fixed of [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ]) {
    if (fs.existsSync(fixed)) return fixed;
  }
  const where = spawnSync('where.exe', ['bash'], { encoding: 'utf8' });
  const candidate = String(where.stdout || '').split(/\r?\n/)
    .map(v => v.trim())
    .find(value => /[\\/]Git[\\/].*bash\.exe$/i.test(value));
  if (candidate) return candidate;
  const check = spawnSync('bash', ['--version'], { encoding: 'utf8' });
  if (!check.error) return 'bash';
  return '';
}

function findPython() {
  const where = spawnSync('where.exe', ['python'], { encoding: 'utf8' });
  const candidate = String(where.stdout || '').split(/\r?\n/).map(v => v.trim()).find(Boolean);
  if (candidate) return candidate;
  for (const executable of ['python3', 'python']) {
    const check = spawnSync(executable, ['--version'], { encoding: 'utf8' });
    if (!check.error && check.status === 0) return executable;
  }
  return '';
}

function findCurl() {
  const shell = spawnSync(BASH, ['-lc', 'command -v curl'], { encoding: 'utf8' });
  const candidate = String(shell.stdout || '').split(/\r?\n/).map(v => v.trim()).find(Boolean);
  if (candidate) return candidate;
  const check = spawnSync('curl', ['--version'], { encoding: 'utf8' });
  return !check.error && check.status === 0 ? 'curl' : '';
}

const BASH = findBash();
const PYTHON = findPython();
const CURL = findCurl();
if (!BASH || !PYTHON || !CURL) {
  const message = 'overnight-runner-client-entry-boundary: bash/python/curl unavailable';
  if (process.env.CI) {
    console.error(message);
    process.exit(1);
  }
  console.log(`${message}; skipped outside CI`);
  process.exit(0);
}

function bashPath(value) {
  const normalized = path.resolve(value).replace(/\\/g, '/');
  const drive = normalized.match(/^([A-Za-z]):\/(.*)$/);
  return drive ? `/${drive[1].toLowerCase()}/${drive[2]}` : normalized;
}

function bashExecutable(value) {
  if (value.startsWith('/')) return value;
  return path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) ? bashPath(value) : value;
}

function writeExecutable(file, source) {
  fs.writeFileSync(file, source, 'utf8');
  fs.chmodSync(file, 0o755);
}

function commonShim(roleBody) {
  return String.raw`#!/usr/bin/bash
set -u
capture=${'${'}F176_CAPTURE:?}
staff=0
legacy=0
argstaff=0
arglegacy=0
private=0
stafffd=0
openfd=0
openfdnum=0
openfdpipe=0
openfdreg=0
openfdsamestdio=0
stdinpipe=0
[ "${'${'}SYNCVIEW_STAFF_KEY:-}" = "f176-synthetic-staff-marker-7f9c" ] && staff=1
[ "${'${'}SYNCVIEW_TEST_CLIENT_TOKEN:-}" = "f176-synthetic-legacy-marker-2a4e" ] && legacy=1
[ -n "${'${'}_OVN_STAFF_ISSUER+x}" ] && private=1
[ -n "${'${'}SYNCVIEW_STAFF_KEY_FD:-}" ] && stafffd=1
_ovn_fd_access=
_ovn_read_fd_access() {
  local _ovn_fdinfo=$1 _ovn_fd_key _ovn_fd_value
  _ovn_fd_access=
  while IFS=: read -r _ovn_fd_key _ovn_fd_value; do
    if [[ "$_ovn_fd_key" == flags ]]; then
      _ovn_fd_value=${'${'}_ovn_fd_value//[[:space:]]/}
      [[ "$_ovn_fd_value" =~ ^[0-7]+$ ]] || return 1
      _ovn_fd_access=$((8#$_ovn_fd_value & 3))
      return 0
    fi
  done < "$_ovn_fdinfo"
  return 1
}
for fd_path in /proc/$$/fd/*; do
  candidate=${'${'}fd_path##*/}
  case "$candidate" in
    0|1|2) ;;
    *)
      same_stdio_pipe=0
      same_stdio_inode=0
      candidate_access_ready=0
      if [[ -p "$fd_path" ]] && _ovn_read_fd_access "/proc/$$/fdinfo/$candidate"; then
        candidate_access=$_ovn_fd_access
        candidate_access_ready=1
      fi
      if [[ -p "$fd_path" ]]; then
        for stdio_fd in 0 1 2; do
          stdio_path=/proc/$$/fd/$stdio_fd
          if [[ -p "$stdio_path" ]] && [[ "$fd_path" -ef "$stdio_path" ]]; then
            same_stdio_inode=1
            if [[ "$candidate_access_ready" -eq 1 ]] \
              && _ovn_read_fd_access "/proc/$$/fdinfo/$stdio_fd" \
              && [[ "$_ovn_fd_access" == "$candidate_access" ]]; then
              same_stdio_pipe=1
            fi
          fi
        done
      fi
      [ "$same_stdio_inode" -eq 1 ] && openfdsamestdio=1
      if [[ "$fd_path" -ef "$0" ]] || [[ "$fd_path" -ef /dev/null ]]; then :
      elif [[ "$same_stdio_pipe" -eq 1 ]]; then :
      elif [[ -p "$fd_path" ]] || [[ -f "$fd_path" ]]; then
        openfd=1
        [ "$openfdnum" -eq 0 ] && openfdnum=$candidate
        [[ -p "$fd_path" ]] && openfdpipe=1
        [[ -f "$fd_path" ]] && openfdreg=1
      fi
      ;;
  esac
done
[ -p "/proc/$$/fd/0" ] && stdinpipe=1
staffvalues=0
legacyvalues=0
case " $* " in *"f176-synthetic-staff-marker-7f9c"*) argstaff=1 ;; esac
case " $* " in *"f176-synthetic-legacy-marker-2a4e"*) arglegacy=1 ;; esac
subject=unknown
${roleBody}
while IFS= read -r envname; do
  [ "${'${'}!envname-}" = "f176-synthetic-staff-marker-7f9c" ] && staffvalues=$((staffvalues + 1))
  [ "${'${'}!envname-}" = "f176-synthetic-legacy-marker-2a4e" ] && legacyvalues=$((legacyvalues + 1))
done < <(compgen -e)
printf '%s|%s|staff=%s|legacy=%s|argstaff=%s|arglegacy=%s|private=%s|stafffd=%s|openfd=%s|openfdnum=%s|openfdpipe=%s|openfdreg=%s|openfdsamestdio=%s|stdinpipe=%s|staffvalues=%s|legacyvalues=%s\n' "${'${'}F176_RUN_ID:-unknown}" "$subject" "$staff" "$legacy" "$argstaff" "$arglegacy" "$private" "$stafffd" "$openfd" "$openfdnum" "$openfdpipe" "$openfdreg" "$openfdsamestdio" "$stdinpipe" "$staffvalues" "$legacyvalues" >> "$capture"
`;
}

function parseArray(source, name) {
  const match = source.match(new RegExp(`(?:^|\\n)${name}=\\(\\r?\\n([\\s\\S]*?)\\r?\\n\\)`, 'm'));
  assert.ok(match, `overnight runner retains the ${name} schedule`);
  return [...match[1].matchAll(/qa\/probes\/([A-Za-z0-9_.-]+\.js)/g)].map(item => item[1]);
}

function readRecords(file) {
  return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => {
    const [run, subject, ...fields] = line.split('|');
    return {
      run,
      subject,
      ...Object.fromEntries(fields.map(field => {
        const [key, value] = field.split('=');
        return [key, Number(value)];
      })),
    };
  });
}

function assertObserved(records, run, subject) {
  const matches = records.filter(record => record.run === run && record.subject === subject);
  assert.ok(matches.length > 0, `${run} must exercise ${subject} through the actual Bash boundary`);
  return matches;
}

const allowedStaffSubjects = new Set(['node:sxr-client-persist', 'node:scenario', 'node:master']);
const allowedStdinPipeSubjects = new Set(['node:cleanup']);
function assertBoundaryRecords(records, run = '') {
  for (const record of records.filter(item => !run || item.run === run)) {
    assert.equal(record.legacy, 0, `${record.run} ${record.subject} inherited the forbidden legacy token`);
    assert.equal(record.argstaff, 0, `${record.run} ${record.subject} received the staff marker in argv`);
    assert.equal(record.arglegacy, 0, `${record.run} ${record.subject} received the legacy marker in argv`);
    assert.equal(record.private, 0, `${record.run} ${record.subject} inherited the broker's private shell variable`);
    assert.equal(record.stafffd, 0, `${record.run} ${record.subject} inherited the broker's secret-bearing descriptor`);
    assert.equal(
      record.openfd,
      0,
      `${record.run} ${record.subject} inherited data descriptor fd=${record.openfdnum} pipe=${record.openfdpipe} regular=${record.openfdreg}`,
    );
    if (!allowedStdinPipeSubjects.has(record.subject)) {
      assert.equal(record.stdinpipe, 0, `${record.run} ${record.subject} inherited the broker's stdin pipe`);
    }
    assert.equal(record.legacyvalues, 0, `${record.run} ${record.subject} inherited the legacy marker under another name`);
    assert.equal(
      record.staff,
      allowedStaffSubjects.has(record.subject) ? 1 : 0,
      `${record.run} ${record.subject} crossed the wrong staff-issuer boundary`,
    );
    assert.equal(
      record.staffvalues,
      allowedStaffSubjects.has(record.subject) ? 1 : 0,
      `${record.run} ${record.subject} inherited the staff marker under the wrong environment scope`,
    );
  }
}

const runnerSource = fs.readFileSync(RUNNER, 'utf8');
const cronSource = fs.readFileSync(CRON, 'utf8');
const entrySource = fs.readFileSync(ENTRY, 'utf8');
const posixGuardSource = fs.readFileSync(POSIX_SESSION_GUARD, 'utf8');
function assertBuiltinRootResolution(source, label) {
  assert.match(source, /_OVN_SCRIPT_PATH=\$\{BASH_SOURCE\[0\]\}/, `${label} captures its source path in Bash`);
  assert.match(
    source,
    /_OVN_SCRIPT_DIR=\$\{_OVN_SCRIPT_PATH%\/\*\}/,
    `${label} derives a slash-bearing parent without an external helper`,
  );
  assert.match(source, /\[ -n "\$_OVN_SCRIPT_DIR" \] \|\| _OVN_SCRIPT_DIR=\//, `${label} preserves a root-level path`);
  assert.match(source, /\*\) _OVN_SCRIPT_DIR=\. ;;/, `${label} handles a basename-only source path`);
  assert.match(source, /builtin cd -- "\$_OVN_SCRIPT_DIR\/\.\."/, `${label} enters the checked-in root with a builtin`);
  assert.match(
    source,
    /builtin unset _OVN_SCRIPT_PATH _OVN_SCRIPT_DIR/,
    `${label} clears its private path variables after root resolution`,
  );
  assert.doesNotMatch(
    source,
    /\$\(\s*(?:(?:command|builtin)\s+)?dirname\b/,
    `${label} startup cannot expose a command-substitution pipe to an external dirname`,
  );
}
assertBuiltinRootResolution(runnerSource, 'runner');
assertBuiltinRootResolution(cronSource, 'cron');
const samplesSchedule = parseArray(runnerSource, 'PROBES');
const calendarSchedule = parseArray(runnerSource, 'CAL_PROBES');
assert.equal(CLIENT_ENTRY_PROBE_FILES.length, 39, 'F176 remains bound to the reviewed 39-probe JS registry');
assert.deepEqual(
  samplesSchedule.filter(probeNeedsClientEntry),
  ['sxr_client_persist_guard.js'],
  'only the Samples persistence probe in the overnight array needs the issuer',
);
assert.deepEqual(
  calendarSchedule.filter(probeNeedsClientEntry),
  [],
  'Calendar/staff-only overnight probes remain issuer-free',
);
for (const file of [...samplesSchedule, ...calendarSchedule]) {
  assert.equal(fs.existsSync(path.join(ROOT, 'qa', 'probes', file)), true, `scheduled probe exists: ${file}`);
}
const runnerUsesRegistry = /probeNeedsClientEntry/.test(runnerSource);
const capableProbeMentions = (runnerSource.match(/sxr_client_persist_guard\.js/g) || []).length;
assert.match(
  cronSource,
  /BASH_ENV= ENV= SYNCVIEW_STAFF_KEY_FD=\$issuer_fd "\$@"/,
  'cron scrubs startup hooks while handing the descriptor directly to the final Bash broker',
);
assert.doesNotMatch(cronSource, /run_cmd\s+env\b/, 'cron keeps env wrappers outside the issuer descriptor path');
assert.match(
  entrySource,
  /delete clean\[name\]/,
  'the supported non-Bash entry scrubs startup hooks and ambient credentials before Bash',
);
assert.match(entrySource, /\^BASH_FUNC_\.\*%%\$/, 'the entry scrubs imported Bash functions');
assert.match(entrySource, /'SHELLOPTS'/, 'the entry scrubs inherited Bash options');
assert.match(entrySource, /name\.toUpperCase\(\)/, 'the Windows environment scrub is case-insensitive');
assert.match(entrySource, /childEnv\.PATH = callerPath/, 'the broker normalizes the native Windows Path key');
assert.match(entrySource, /builtin source \"\$2\"/, 'the entry invokes the trusted script through the source builtin');
assert.match(entrySource, /'\/mingw64\/bin', '\/usr\/bin', '\/bin'/, 'the Windows broker retains Git Bash runtime tools');
assert.match(
  entrySource,
  /const WINDOWS_GUARD_READY_TIMEOUT_MS = 60_000;/,
  'cold Windows Job initialization remains bounded while the issuer stays blocked',
);
assert.match(
  posixGuardSource,
  /name === 'pkill' \? new Set\(\['pkill', 'pgrep'\]\) : new Set\(\[name\]\)/,
  'the POSIX guardian accepts the reviewed Debian/Ubuntu pkill multi-call layout',
);
assert.match(
  posixGuardSource,
  /return candidate;/,
  'the POSIX guardian preserves pkill in argv[0] after validating its fixed system target',
);
assert.match(entrySource, /BASH_VERSINFO\[1\] >= 1/, 'the broker requires the Bash 5.1 wait contract');
assert.match(
  runnerSource,
  /wait -n -f -p finished "\$pid" "\$timer_pid"/,
  'the bounded runner waits on one operative process and one timer process',
);
assert.doesNotMatch(
  runnerSource,
  /\$\(\s*git\s+branch\b/,
  'runner startup must not launch Git inside a command-substitution descriptor channel',
);
for (const [source, label] of [[runnerSource, 'runner'], [cronSource, 'cron']]) {
  assert.doesNotMatch(
    source,
    /\$\(\s*stamp\s*\)/,
    `${label} logging must not launch a timestamp command-substitution descriptor channel`,
  );
  assert.match(
    source,
    /builtin printf -v _ovn_log_stamp '%\(%Y-%m-%dT%H:%M:%SZ\)T' -1/,
    `${label} logging uses the Bash UTC timestamp formatter without a helper process`,
  );
  assert.match(
    source,
    /local -x TZ=UTC/,
    `${label} exports UTC only inside the log function before rendering a literal-Z timestamp`,
  );
  assert.doesNotMatch(
    source,
    /\|\s*tee\b/,
    `${label} logging must not launch a pipeline helper with an inherited peer descriptor`,
  );
  assert.match(
    source,
    /builtin printf '\[%s\].*>> "\$LOG" \|\| _ovn_log_status=\$\?/,
    `${label} logging writes the same built-in-formatted line directly to its durable log`,
  );
  assert.match(
    source,
    />> "\$LOG" \|\| _ovn_log_status=\$\?\r?\n\s*builtin trap '' PIPE\r?\n\s*builtin printf/,
    `${label} durably appends before attempting its visible console write`,
  );
  assert.match(
    source,
    /builtin printf '\[%s\].*\|\| :\r?\n\s*builtin trap - PIPE/,
    `${label} bounds a closed-console SIGPIPE without creating a credential-bearing helper process`,
  );
  assert.match(
    source,
    /builtin trap - PIPE\r?\n\s*return "\$_ovn_log_status"/,
    `${label} restores PIPE handling and reports a failed durable append`,
  );
}
assert.match(
  runnerSource,
  /BASH_ENV= ENV= command sleep "\$COMMAND_TIMEOUT_SECONDS" &/,
  'the timeout is one external timer that bypasses startup-hook functions',
);
assert.equal(
  (runnerSource.match(/sleep 0\.25/g) || []).length,
  1,
  'only the short server-readiness loop may poll; command timeouts use one timer process',
);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'syncview-f176-'));
const bin = path.join(tmp, 'bin');
fs.mkdirSync(bin, { recursive: true });
const capture = path.join(tmp, 'capture.log');
fs.writeFileSync(capture, '', 'utf8');
const bashEnv = path.join(tmp, 'bash-env');
fs.writeFileSync(
  bashEnv,
  String.raw`export PATH='${bashPath(bin)}:/usr/local/bin:/usr/bin:/bin'
startup_staff=0
startup_legacy=0
startup_fd=0
startup_openfd=0
startup_stdinpipe=0
[ "${'${'}SYNCVIEW_STAFF_KEY:-}" = "f176-synthetic-staff-marker-7f9c" ] && startup_staff=1
[ "${'${'}SYNCVIEW_TEST_CLIENT_TOKEN:-}" = "f176-synthetic-legacy-marker-2a4e" ] && startup_legacy=1
[ -n "${'${'}SYNCVIEW_STAFF_KEY_FD:-}" ] && startup_fd=1
for candidate in 3 7 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31; do
  [ -e "/proc/$$/fd/$candidate" ] && startup_openfd=1
done
[ -p "/proc/$$/fd/0" ] && startup_stdinpipe=1
if [ "$startup_staff" -ne 0 ] || [ "$startup_legacy" -ne 0 ] || [ "$startup_fd" -ne 0 ]; then
  printf '%s|startup:bash-env|staff=%s|legacy=%s|argstaff=0|arglegacy=0|private=0|stafffd=%s|openfd=%s|stdinpipe=%s|staffvalues=%s|legacyvalues=%s\n' "${'${'}F176_RUN_ID:-unknown}" "$startup_staff" "$startup_legacy" "$startup_fd" "$startup_openfd" "$startup_stdinpipe" "$startup_staff" "$startup_legacy" >> "$F176_CAPTURE"
fi
sleep() {
  local staff=0 legacy=0 private=0 stafffd=0 openfd=0 stdinpipe=0 candidate
  [ "${'${'}SYNCVIEW_STAFF_KEY:-}" = "f176-synthetic-staff-marker-7f9c" ] && staff=1
  [ "${'${'}SYNCVIEW_TEST_CLIENT_TOKEN:-}" = "f176-synthetic-legacy-marker-2a4e" ] && legacy=1
  if [ -n "${'${'}_OVN_STAFF_ISSUER+x}" ]; then
    case "${'${'}_OVN_STAFF_ISSUER@a}" in *x*) private=1 ;; esac
  fi
  [ -n "${'${'}SYNCVIEW_STAFF_KEY_FD:-}" ] && stafffd=1
  for candidate in 3 7 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31; do
    [ -e "/proc/$$/fd/$candidate" ] && openfd=1
  done
  [ -p "/proc/$$/fd/0" ] && stdinpipe=1
  printf '%s|watchdog:sleep|staff=%s|legacy=%s|argstaff=0|arglegacy=0|private=%s|stafffd=%s|openfd=%s|stdinpipe=%s|staffvalues=%s|legacyvalues=%s\n' "${'${'}F176_RUN_ID:-unknown}" "$staff" "$legacy" "$private" "$stafffd" "$openfd" "$stdinpipe" "$staff" "$legacy" >> "$F176_CAPTURE"
  [ "${'${'}F176_FAST_GRACE:-0}" = "1" ] && [ "${'${'}1:-}" = "1" ] && return 0
  if [ "${'${'}F176_FAST_READINESS:-0}" = "1" ] && [ "${'${'}1:-}" = "0.25" ]; then
    /usr/bin/sleep 0.01
    return 0
  fi
  /usr/bin/sleep "$@"
}
`,
  'utf8',
);

writeExecutable(path.join(bin, 'node'), commonShim(String.raw`
case " $* " in
  *probeNeedsClientEntry*|*--probe-needs-client-entry*)
    subject=node:policy
    printf '%s|%s|staff=%s|legacy=%s|argstaff=%s|arglegacy=%s|private=%s|stafffd=%s|openfd=%s|stdinpipe=%s|staffvalues=%s|legacyvalues=%s\n' "${'${'}F176_RUN_ID:-unknown}" "$subject" "$staff" "$legacy" "$argstaff" "$arglegacy" "$private" "$stafffd" "$openfd" "$stdinpipe" "$staffvalues" "$legacyvalues" >> "$capture"
    exec /usr/bin/env -u SYNCVIEW_STAFF_KEY -u SYNCVIEW_TEST_CLIENT_TOKEN "$F176_REAL_NODE" "$@"
    ;;
  *sxr_client_persist_guard.js*) subject=node:sxr-client-persist ;;
  *run_scenarios.js*) subject=node:scenario ;;
  *qa/master.js*) subject=node:master ;;
  *test/run-all.js*) subject=node:unit ;;
  *p89_cal_create_via_ui.js*) subject=node:staff-only ;;
  *cal_*.js*|*p88_realtime_handler.js*) subject=node:calendar ;;
  *qa/probes/*.js*) subject=node:unknown-manual ;;
  " - ") subject=node:cleanup ;;
  *) subject=node:other ;;
esac
`) + String.raw`if [ "${'${'}F176_RESISTANT_TARGET:-0}" = "1" ] && [ "$subject" = "node:unknown-manual" ]; then
  trap '' TERM INT
  (
    trap '' TERM INT
    printf '%s\n' "$BASHPID" > "$F176_DESCENDANT_PID_FILE"
    while :; do /usr/bin/sleep 1; done
  ) &
  wait
elif [ "${'${'}F176_COMMAND_ROOT_EXIT:-0}" = "1" ] && [ "$subject" = "node:sxr-client-persist" ]; then
  (
    trap '' TERM INT
    printf '%s\n' "$BASHPID" > "$F176_COMMAND_ROOT_DESCENDANT_PID_FILE"
    while :; do /usr/bin/sleep 1; done
  ) &
  for _ in $(/usr/bin/seq 1 500); do
    [ -s "$F176_COMMAND_ROOT_DESCENDANT_PID_FILE" ] && break
    /usr/bin/sleep 0.01
  done
  [ -s "$F176_COMMAND_ROOT_DESCENDANT_PID_FILE" ] || exit 91
  exit 0
elif [ "${'${'}F176_SIGNAL_TARGET:-0}" = "1" ] && [ "$subject" = "node:sxr-client-persist" ]; then
  printf '%s\n' "$$" > "$F176_SIGNAL_PID_FILE"
  trap 'exit 143' TERM INT
  while :; do /usr/bin/sleep 1; done
elif [ "${'${'}F176_STOP_TARGET:-0}" = "1" ] && [ "$subject" = "node:unknown-manual" ]; then
  printf '%s\n' "$$" > "$F176_STOP_PID_FILE"
  kill -STOP "$$"
  printf '%s\n' resumed > "$F176_STOP_RESUMED_FILE"
elif [ "${'${'}F176_COMMAND_EXIT_124:-0}" = "1" ] && [ "$subject" = "node:unknown-manual" ]; then
  printf '%s\n' command-exit-124
  exit 124
elif [ "${'${'}F176_TIMER_FAILURE_TARGET:-0}" = "1" ] && [ "$subject" = "node:unknown-manual" ]; then
  trap 'exit 143' TERM INT
  while :; do /usr/bin/sleep 1; done
elif [ "${'${'}F176_CRON_SIGNAL_TARGET:-0}" = "1" ] && [ "$subject" = "node:unknown-manual" ]; then
  printf '%s\n' "$$" > "$F176_CRON_SIGNAL_PID_FILE"
  trap 'exit 143' TERM INT
  while :; do /usr/bin/sleep 1; done
fi
echo "PASS $subject"
exit 0
`);

writeExecutable(path.join(bin, 'curl'), commonShim('subject=server:readiness') + String.raw`
exec "$F176_REAL_CURL" "$@"
`);

writeExecutable(path.join(bin, 'python'), commonShim('subject=server:python') + String.raw`
if [ "${'${'}F176_SERVER_NEVER_READY:-0}" = "1" ]; then
  printf '%s\n' "$$" > "$F176_SERVER_PID_FILE"
  trap 'exit 143' TERM INT
  while :; do /usr/bin/sleep 0.1; done
fi
exec "$F176_REAL_PYTHON" "$@"
`);

writeExecutable(path.join(bin, 'timeout'), commonShim('subject=wrapper:timeout') + String.raw`
while [ "$#" -gt 0 ]; do
  case "$1" in
    --kill-after=*|-k) if [ "$1" = "-k" ]; then shift; fi; shift ;;
    --) shift; break ;;
    [0-9]*|[0-9]*s|[0-9]*m|[0-9]*h|[0-9]*d) shift; break ;;
    -*) shift ;;
    *) break ;;
  esac
done
exec "$@"
`);

writeExecutable(path.join(bin, 'sleep'), commonShim(String.raw`
case "${'${'}1:-}" in
  30) subject=timer:grace ;;
  *) subject=timer:deadline ;;
esac
`) + String.raw`if [ "${'${'}F176_FAST_GRACE:-0}" = "1" ] && [ "${'${'}1:-}" = "30" ]; then
  exit 0
fi
if [ "${'${'}F176_FAST_READINESS:-0}" = "1" ] && [ "${'${'}1:-}" = "0.25" ]; then
  exit 0
fi
if [ "${'${'}F176_SIGNAL_ON_TIMER_START:-0}" = "1" ] && [ "${'${'}1:-}" = "${'${'}COMMAND_TIMEOUT_SECONDS:-}" ]; then
  if [ -n "${'${'}F176_SIGNAL_BROKER_MARKER_FILE:-}" ]; then
    printf '%s\n' ready > "$F176_SIGNAL_BROKER_MARKER_FILE"
  else
    runner=$(cat "$OVERNIGHT_LOCK_DIR/pid")
    kill -TERM "$runner"
  fi
fi
if [ "${'${'}F176_TIMER_FAIL:-0}" = "1" ] && [ "${'${'}1:-}" = "${'${'}COMMAND_TIMEOUT_SECONDS:-}" ]; then
  /usr/bin/sleep 0.25
  exit 71
fi
exec /usr/bin/sleep "$@"
`);

writeExecutable(path.join(bin, 'seq'), commonShim('subject=helper:seq') + String.raw`
if [ "${'${'}F176_SERVER_NEVER_READY:-0}" = "1" ]; then
  /usr/bin/sleep 0.1
  printf '%s\n' 1
  exit 0
fi
exec /usr/bin/seq "$@"
`);

writeExecutable(path.join(bin, 'dirname'), commonShim('subject=helper:dirname') + String.raw`
exec /usr/bin/dirname "$@"
`);

writeExecutable(path.join(bin, 'rm'), commonShim('subject=helper:rm') + String.raw`
exec /usr/bin/rm "$@"
`);

writeExecutable(path.join(bin, 'git'), commonShim('subject=helper:git') + String.raw`
if [ "${'${'}1:-}" = "branch" ]; then echo fixture-branch; fi
exit 0
`);

writeExecutable(path.join(bin, 'env'), commonShim('subject=wrapper:env') + String.raw`
exec /usr/bin/env "$@"
`);

writeExecutable(path.join(bin, 'bash'), commonShim(String.raw`
case " $* " in *" qa/overnight_runner.sh "*) subject=wrapper:cron-bash ;; *) subject=wrapper:bash ;; esac
`) + String.raw`
exec /usr/bin/bash "$@"
`);

writeExecutable(path.join(bin, 'tee'), commonShim('subject=helper:log') + String.raw`
exec /usr/bin/tee "$@"
`);

function fixtureEnv(run, extra = {}) {
  const runDir = path.join(tmp, run);
  const out = path.join(runDir, 'out');
  fs.mkdirSync(out, { recursive: true });
  return {
    ...process.env,
    PATH: `${bashPath(bin)}:/usr/local/bin:/usr/bin:/bin`,
    BASH_ENV: bashPath(bashEnv),
    'BASH_FUNC_read%%': `() { builtin printf '${INJECTION_MARKER}:read\\n' >&2; builtin read "$@"; }`,
    'BASH_FUNC_source%%': `() { builtin printf '${INJECTION_MARKER}:source\\n' >&2; builtin source "$@"; }`,
    SHELLOPTS: 'xtrace',
    BASHOPTS: 'extdebug',
    BASH_XTRACEFD: '2',
    PS4: `${INJECTION_MARKER}:trace:`,
    NODE_OPTIONS: '',
    NODE_BIN: `${bashPath(bin)}/node`,
    NODE_BIN_FALLBACK: `${bashPath(bin)}/node`,
    PYTHON_BIN: bashExecutable(PYTHON),
    F176_CAPTURE: bashPath(capture),
    F176_REAL_CURL: bashExecutable(CURL),
    F176_REAL_NODE: bashPath(process.execPath),
    F176_REAL_PYTHON: bashExecutable(PYTHON),
    F176_RUN_ID: run,
    SYNCVIEW_STAFF_KEY: STAFF_MARKER,
    SYNCVIEW_TEST_CLIENT_TOKEN: LEGACY_MARKER,
    _OVN_STAFF_ISSUER: 'f176-preexisting-export-must-be-scrubbed',
    OVERNIGHT_LOG: bashPath(path.join(runDir, 'runner.log')),
    OVERNIGHT_OUTDIR: bashPath(out),
    OVERNIGHT_LOCK_DIR: bashPath(path.join(runDir, 'runner.lock')),
    COMMAND_TIMEOUT_SECONDS: '5',
    SXR_COURIER: '0',
    ...extra,
  };
}

const portLeaseRoot = path.join(os.tmpdir(), 'syncview-f176-port-leases');
fs.mkdirSync(portLeaseRoot, { recursive: true });
const activeFixtures = new Set();
let fixtureSequence = 0;
let cancellationPromise = null;

function controllerEnvironment() {
  if (process.platform !== 'win32') {
    return { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' };
  }
  const source = process.env;
  return {
    SystemRoot: source.SystemRoot || 'C:\\Windows',
    WINDIR: source.WINDIR || source.SystemRoot || 'C:\\Windows',
    COMSPEC: source.COMSPEC || 'C:\\Windows\\System32\\cmd.exe',
    PATH: '/mingw64/bin:/usr/bin:/bin',
    TEMP: source.TEMP || os.tmpdir(),
    TMP: source.TMP || os.tmpdir(),
  };
}

function runDistinctDescriptorClassificationFixture() {
  const fifo = path.join(tmp, 'descriptor-classification.fifo');
  const env = {
    ...controllerEnvironment(),
    F176_CAPTURE: bashPath(capture),
    F176_RUN_ID: 'descriptor-classification',
  };
  let result;
  try {
    result = spawnSync(BASH, [
      '--noprofile',
      '--norc',
      '-c',
      '/usr/bin/rm -f "$3" || exit 70; /usr/bin/mkfifo "$3" || exit 71; exec 7<> "$3" || exit 72; exec 1> "$3" || exit 73; exec 8< "$1" || exit 74; exec "$2" branch --show-current',
      'descriptor-classification',
      bashPath(__filename),
      bashPath(path.join(bin, 'git')),
      bashPath(fifo),
    ], {
      cwd: ROOT,
      env,
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });
  } finally {
    fs.rmSync(fifo, { force: true });
  }
  assert.equal(
    result.status,
    0,
    `distinct-descriptor classifier fixture failed status=${result.status}\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`,
  );
}

function runController(executable, args, timeoutMs = 5_000) {
  return new Promise(resolve => {
    let child = null;
    let stdout = '';
    let settled = false;
    let timer = null;
    const finish = (ok, reason) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ ok, reason, stdout });
    };
    try {
      child = spawn(executable, args, {
        env: controllerEnvironment(),
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
    } catch {
      finish(false, 'spawn');
      return;
    }
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length > 1024 * 1024) {
        try { child.kill('SIGKILL'); } catch {}
        child.stdout.destroy();
        finish(false, 'output-limit');
      }
    });
    child.once('error', () => finish(false, 'error'));
    child.once('close', code => finish(code === 0, `exit-${code}`));
    timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      child.stdout.destroy();
      child.unref();
      finish(false, 'timeout');
    }, timeoutMs);
  });
}

async function armWindowsHarnessContainment() {
  if (process.platform !== 'win32') return;
  const powershell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  await new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
    const guard = spawn(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', WINDOWS_JOB_GUARD,
      '-OwnerProcessId', String(process.pid),
      '-ExpectedImagePath', fs.realpathSync(process.execPath),
    ], {
      cwd: ROOT,
      env: controllerEnvironment(),
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      guard.stdout.destroy();
      try { guard.kill('SIGKILL'); } catch {}
      reject(new Error('Windows fixture containment READY timed out'));
    }, WINDOWS_GUARD_READY_TIMEOUT_MS);
    const fail = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      guard.stdout.destroy();
      try { guard.kill('SIGKILL'); } catch {}
      reject(error);
    };
    guard.stdout.setEncoding('utf8');
    guard.stdout.on('data', chunk => {
      if (settled) return;
      output += chunk;
      if (output.length > 128) {
        fail(new Error('Windows fixture containment returned malformed READY output'));
        return;
      }
      const lines = output.split(/\r?\n/).filter(Boolean);
      if (lines.length !== 1 || lines[0] !== 'READY' || !/\r?\n/.test(output)) return;
      settled = true;
      clearTimeout(timer);
      guard.stdout.destroy();
      guard.unref();
      resolve();
    });
    guard.once('error', () => fail(new Error('Windows fixture containment failed to start')));
    guard.once('exit', code => {
      if (!settled) fail(new Error(`Windows fixture containment exited before READY (${code})`));
    });
  });
}

async function reserveFixturePort() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve);
    });
    const address = server.address();
    const port = address && typeof address === 'object' ? address.port : 0;
    const lease = path.join(portLeaseRoot, String(port));
    let leased = false;
    try {
      fs.mkdirSync(lease);
      fs.writeFileSync(path.join(lease, 'owner'), `${process.pid}\n`, 'utf8');
      leased = true;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') {
        await new Promise(resolve => server.close(resolve));
        throw error;
      }
    }
    await new Promise(resolve => server.close(resolve));
    if (leased) return { port, lease };
  }
  throw new Error('unable to reserve an isolated F176 fixture port');
}

function waitForOwnedClose(state, timeoutMs) {
  if (state.closed) return Promise.resolve(true);
  return Promise.race([
    state.closedPromise.then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

async function teardownOwnedFixture(state) {
  if (!state || state.closed) return true;
  if (state.teardownPromise) return state.teardownPromise;
  state.teardownPromise = (async () => {
    const targetPid = state.child.pid;
    let controllerClean = true;

    if (process.platform === 'win32') {
      const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
      await runController(taskkill, ['/PID', String(targetPid), '/T', '/F'], 5_000);
    } else {
      const controller = await runController(
        process.execPath,
        [POSIX_SESSION_GUARD, 'kill', String(targetPid)],
        20_000,
      );
      const terminalState = String(controller.stdout || '').trim();
      controllerClean = controller.ok && terminalState === 'CLEAN';
      if (!controllerClean) {
        const publicState = ['CLEAN', 'STRAGGLERS', 'ERROR'].includes(terminalState)
          ? terminalState
          : 'MALFORMED';
        state.teardownDiagnostic = `${controller.reason}/${publicState}`;
      }
    }
    const closed = await waitForOwnedClose(state, 5_000);
    return controllerClean && closed;
  })();
  const confirmed = await state.teardownPromise;
  if (!confirmed) state.teardownPromise = null;
  return confirmed;
}

async function teardownActiveFixtures() {
  let clean = true;
  for (const state of [...activeFixtures]) {
    if (!await teardownOwnedFixture(state)) clean = false;
  }
  return clean && activeFixtures.size === 0;
}

function handleGuardSignal(signal) {
  if (cancellationPromise) return;
  cancellationPromise = (async () => {
    console.error(`F176 guard received ${signal}; stopping owned fixtures`);
    const clean = await teardownActiveFixtures();
    console.error(`F176 cancellation evidence retained at ${tmp}`);
    if (clean) process.exit(signal === 'SIGINT' ? 130 : 143);
    process.exitCode = 1;
    console.error('F176 cancellation teardown was not confirmed; process remains attached');
  })();
}

function onGuardInt() { handleGuardSignal('SIGINT'); }
function onGuardTerm() { handleGuardSignal('SIGTERM'); }
process.once('SIGINT', onGuardInt);
process.once('SIGTERM', onGuardTerm);

async function runOwnedFixture(executable, args, options, timeoutMs) {
  const reservation = await reserveFixturePort();
  const env = { ...(options.env || {}) };
  for (const name of Object.keys(env)) {
    if (name.toUpperCase() === 'PORT') delete env[name];
  }
  env.PORT = String(reservation.port);

  return new Promise(resolve => {
    let child;
    try {
      child = spawn(executable, args, {
        ...options,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      let reportedError = error;
      try { fs.rmSync(reservation.lease, { recursive: true, force: true }); }
      catch (cleanupError) { reportedError = cleanupError; }
      resolve({ status: null, signal: null, stdout: '', stderr: '', error: reportedError });
      return;
    }

    const evidenceName = String(env.F176_RUN_ID || `owned-${++fixtureSequence}`)
      .replace(/[^A-Za-z0-9_.-]/g, '_');
    const evidenceDir = path.join(tmp, evidenceName);
    const state = {
      child,
      closed: false,
      closedPromise: null,
      resolveClosed: null,
      teardownPromise: null,
    };
    state.closedPromise = new Promise(resolveClosed => { state.resolveClosed = resolveClosed; });
    activeFixtures.add(state);
    let stdout = '';
    let stderr = '';
    let launchError = null;
    let timedOut = false;
    let settled = false;
    const persistOutput = () => {
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(path.join(evidenceDir, 'fixture.stdout.log'), stdout, 'utf8');
      fs.writeFileSync(path.join(evidenceDir, 'fixture.stderr.log'), stderr, 'utf8');
    };
    const finish = (status, signal, error) => {
      if (settled) return;
      settled = true;
      resolve({ status, signal, stdout, stderr, error });
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { launchError = error; });
    const timer = setTimeout(async () => {
      timedOut = true;
      const confirmed = await teardownOwnedFixture(state);
      if (!confirmed) {
        try { persistOutput(); } catch {}
        const diagnostic = state.teardownDiagnostic ? ` (${state.teardownDiagnostic})` : '';
        console.error(`F176 fixture teardown was not confirmed${diagnostic}; evidence retained at ${evidenceDir}`);
        process.exit(1);
      }
    }, timeoutMs);
    child.once('close', (code, signal) => {
      state.closed = true;
      clearTimeout(timer);
      let error = launchError;
      try {
        persistOutput();
        fs.rmSync(reservation.lease, { recursive: true, force: true });
      } catch (cleanupError) {
        if (!error) error = cleanupError;
      } finally {
        activeFixtures.delete(state);
        state.resolveClosed();
        if (timedOut) {
          error = new Error(`fixture timed out after ${timeoutMs}ms`);
          error.code = 'ETIMEDOUT';
        }
        finish(code, signal, error);
      }
    });
  });
}

async function runScript(script, env, bashOptions = [], expectedStatuses = [0]) {
  const harnessEnv = { ...env };
  for (const name of Object.keys(harnessEnv)) {
    if (/^BASH_FUNC_.*%%$/.test(name) || [
      'SHELLOPTS',
      'BASHOPTS',
      'BASH_XTRACEFD',
      'PS4',
    ].includes(name)) delete harnessEnv[name];
  }
  const result = await runOwnedFixture(BASH, [...bashOptions, bashPath(script)], {
    cwd: ROOT,
    env: harnessEnv,
  }, Number(process.env.F176_FIXTURE_TIMEOUT_MS || 120_000));
  if (result.error) {
    throw new Error(
      `${path.basename(script)} fixture process failed: ${result.error.message}`
        + `\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`,
    );
  }
  assert.equal(
    expectedStatuses.includes(result.status),
    true,
    `${path.basename(script)} fixture failed status=${result.status}\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`,
  );
  return result;
}

async function runEntry(mode, env, expectedStatuses = [0]) {
  const result = await runOwnedFixture(process.execPath, [ENTRY, mode], {
    cwd: ROOT,
    env,
  }, Number(process.env.F176_FIXTURE_TIMEOUT_MS || 120_000));
  if (result.error) {
    throw new Error(
      `overnight entry ${mode} failed: ${result.error.message}`
        + `\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`,
    );
  }
  assert.equal(
    expectedStatuses.includes(result.status),
    true,
    `overnight entry ${mode} failed status=${result.status}\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`,
  );
  return result;
}

async function runEarlyBrokerSignalFixture() {
  const lock = path.join(tmp, 'broker-early-signal', 'runner.lock');
  const env = fixtureEnv('broker-early-signal', {
    F176_ENTRY_NATIVE: ENTRY,
    F176_LOCK_NATIVE: lock,
    RUN_ROUNDS: '1',
    RUN_PROBES: '1',
    PROBE_OFFSET: '0',
    PROBE_LIMIT: '1',
    RUN_SCENARIOS: '0',
    RUN_CALENDAR: '0',
    MASTER_FAST_EVERY: '0',
    RUN_UNIT: '0',
    COMMIT_REPORT_EVERY_ROUND: '0',
  });
  const helper = String.raw`
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, [process.env.F176_ENTRY_NATIVE, 'runner'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ['ignore', 'inherit', 'inherit'],
});
const deadline = setTimeout(() => {
  try { child.kill('SIGKILL'); } catch {}
  process.exit(113);
}, 10_000);
setTimeout(() => child.kill('SIGTERM'), 25);
child.once('exit', (code, signal) => {
  clearTimeout(deadline);
  setTimeout(() => {
    const signaled = (Number.isInteger(code) && code !== 0) || signal === 'SIGTERM';
    const lockExists = fs.existsSync(process.env.F176_LOCK_NATIVE);
    if (!signaled || lockExists) console.error('early-signal code=' + code + ' signal=' + signal + ' lock=' + lockExists);
    process.exit(signaled && !lockExists ? 0 : 112);
  }, 750);
});
`;
  const result = await runOwnedFixture(process.execPath, ['-e', helper], {
    cwd: ROOT,
    env,
  }, 15_000);
  if (result.error) {
    throw new Error(`early broker signal fixture failed: ${result.error.message}`);
  }
  assert.equal(
    result.status,
    0,
    `early broker signal fixture failed status=${result.status}\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`,
  );
  return result;
}

async function runSignalFixture() {
  const signalPidFile = path.join(tmp, 'signal', 'target.pid');
  const signalLock = path.join(tmp, 'signal', 'runner.lock');
  const signalDriver = path.join(tmp, 'signal-driver.js');
  fs.writeFileSync(signalDriver, String.raw`'use strict';
const fs = require('node:fs');
let emitted = false;
const poll = setInterval(() => {
  if (emitted) return;
  if (!fs.existsSync(process.env.F176_SIGNAL_PID_NATIVE)) return;
  if (!fs.existsSync(process.env.F176_SIGNAL_LOCK_NATIVE)) return;
  emitted = true;
  clearInterval(poll);
  console.log('broker-signal-emitted');
  process.emit('SIGTERM');
}, 10);
const deadline = setTimeout(() => {
  clearInterval(poll);
  console.error('broker-signal-deadline');
  process.exit(114);
}, 30_000);
deadline.unref();
process.argv = [process.execPath, process.env.F176_SIGNAL_ENTRY_NATIVE, 'runner'];
require(process.env.F176_SIGNAL_ENTRY_NATIVE);
`, 'utf8');
  const env = fixtureEnv('signal', {
    F176_SIGNAL_ENTRY_NATIVE: ENTRY,
    F176_SIGNAL_PID_NATIVE: signalPidFile,
    F176_SIGNAL_LOCK_NATIVE: signalLock,
    F176_SIGNAL_TARGET: '1',
    F176_FAST_GRACE: '1',
    F176_SIGNAL_PID_FILE: bashPath(signalPidFile),
    COMMAND_TIMEOUT_SECONDS: '60',
    RUN_ROUNDS: '1',
    RUN_PROBES: '1',
    PROBE_OFFSET: '7',
    PROBE_LIMIT: '1',
    RUN_SCENARIOS: '0',
    RUN_CALENDAR: '0',
    MASTER_FAST_EVERY: '0',
    RUN_UNIT: '0',
    COMMIT_REPORT_EVERY_ROUND: '0',
  });
  const result = await runOwnedFixture(process.execPath, [signalDriver], {
    cwd: ROOT,
    env,
  }, Number(process.env.F176_FIXTURE_TIMEOUT_MS || 120_000));
  if (result.error) {
    throw new Error(`runner signal fixture failed: ${result.error.message}`);
  }
  assert.equal(
    result.status,
    143,
    `runner signal fixture failed status=${result.status}\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`,
  );
  assert.equal(fs.existsSync(signalLock), false, 'runner TERM releases the singleton lock');
  assert.match(result.stdout, /received TERM; stopping runner/, 'runner TERM cleanup is visible');
  return result;
}

async function runCronSignalFixture() {
  const targetPidFile = path.join(tmp, 'cron-signal', 'target.pid');
  const signalLock = path.join(tmp, 'cron-signal', 'runner.lock');
  const signalDriver = path.join(tmp, 'cron-signal-driver.js');
  fs.writeFileSync(signalDriver, String.raw`'use strict';
const fs = require('node:fs');
let emitted = false;
const poll = setInterval(() => {
  if (emitted) return;
  if (!fs.existsSync(process.env.F176_CRON_SIGNAL_PID_NATIVE)) return;
  if (!fs.existsSync(process.env.F176_CRON_SIGNAL_LOCK_NATIVE)) return;
  emitted = true;
  clearInterval(poll);
  console.log('cron-broker-signal-emitted');
  process.emit('SIGTERM');
}, 10);
const deadline = setTimeout(() => {
  clearInterval(poll);
  console.error('cron-broker-signal-deadline');
  process.exit(115);
}, 30_000);
deadline.unref();
process.argv = [process.execPath, process.env.F176_CRON_SIGNAL_ENTRY_NATIVE, 'cron'];
require(process.env.F176_CRON_SIGNAL_ENTRY_NATIVE);
`, 'utf8');
  const env = fixtureEnv('cron-signal', {
    F176_CRON_SIGNAL_ENTRY_NATIVE: ENTRY,
    F176_CRON_SIGNAL_PID_NATIVE: targetPidFile,
    F176_CRON_SIGNAL_LOCK_NATIVE: signalLock,
    F176_CRON_SIGNAL_TARGET: '1',
    F176_CRON_SIGNAL_PID_FILE: bashPath(targetPidFile),
    F176_FAST_GRACE: '1',
    OVERNIGHT_CRON_PHASE: '0',
    OVERNIGHT_CRON_STATE: bashPath(path.join(tmp, 'cron-signal', 'state')),
    COMMAND_TIMEOUT_SECONDS: '60',
  });
  const result = await runOwnedFixture(process.execPath, [signalDriver], {
    cwd: ROOT,
    env,
  }, Number(process.env.F176_FIXTURE_TIMEOUT_MS || 120_000));
  if (result.error) {
    throw new Error(`cron signal fixture failed: ${result.error.message}`);
  }
  assert.equal(
    result.status,
    143,
    `cron signal fixture failed status=${result.status}\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`,
  );
  assert.equal(fs.existsSync(signalLock), false, 'cron TERM releases the nested runner lock');
  return result;
}

async function runLaunchSignalFixture() {
  const marker = path.join(tmp, 'launch-signal', 'broker-signal-ready');
  const lock = path.join(tmp, 'launch-signal', 'runner.lock');
  const driver = path.join(tmp, 'launch-signal-driver.js');
  fs.writeFileSync(driver, String.raw`'use strict';
const fs = require('node:fs');
let emitted = false;
const poll = setInterval(() => {
  if (emitted || !fs.existsSync(process.env.F176_LAUNCH_SIGNAL_MARKER_NATIVE)) return;
  emitted = true;
  clearInterval(poll);
  console.log('launch-handoff-signal-emitted');
  process.emit('SIGTERM');
}, 10);
const deadline = setTimeout(() => {
  clearInterval(poll);
  console.error('launch-handoff-signal-deadline');
  process.exit(116);
}, 30_000);
deadline.unref();
process.argv = [process.execPath, process.env.F176_LAUNCH_SIGNAL_ENTRY_NATIVE, 'runner'];
require(process.env.F176_LAUNCH_SIGNAL_ENTRY_NATIVE);
`, 'utf8');
  const env = fixtureEnv('launch-signal', {
    F176_LAUNCH_SIGNAL_ENTRY_NATIVE: ENTRY,
    F176_LAUNCH_SIGNAL_MARKER_NATIVE: marker,
    F176_SIGNAL_BROKER_MARKER_FILE: bashPath(marker),
    F176_SIGNAL_ON_TIMER_START: '1',
    F176_FAST_GRACE: '1',
    F176_TIMER_FAILURE_TARGET: '1',
    COMMAND_TIMEOUT_SECONDS: '60',
    RUN_ROUNDS: '1',
    RUN_PROBES: '1',
    PROBE_OFFSET: '0',
    PROBE_LIMIT: '1',
    RUN_SCENARIOS: '0',
    RUN_CALENDAR: '0',
    MASTER_FAST_EVERY: '0',
    RUN_UNIT: '0',
    COMMIT_REPORT_EVERY_ROUND: '0',
  });
  const result = await runOwnedFixture(process.execPath, [driver], {
    cwd: ROOT,
    env,
  }, Number(process.env.F176_FIXTURE_TIMEOUT_MS || 120_000));
  if (result.error) {
    throw new Error(`launch-handoff signal fixture failed: ${result.error.message}`);
  }
  assert.equal(
    result.status,
    143,
    `launch-handoff signal fixture failed status=${result.status}\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`,
  );
  assert.equal(fs.existsSync(lock), false, 'launch-handoff TERM releases the singleton lock');
  return result;
}

async function runStopFixture() {
  const stopPidFile = path.join(tmp, 'stop', 'target.pid');
  const resumedFile = path.join(tmp, 'stop', 'resumed');
  const stopHarness = path.join(tmp, 'stop-harness.sh');
  writeExecutable(stopHarness, String.raw`#!/usr/bin/bash
set -u
SYNCVIEW_STAFF_KEY='f176-synthetic-staff-marker-7f9c' SYNCVIEW_TEST_CLIENT_TOKEN='f176-synthetic-legacy-marker-2a4e' "$F176_REAL_NODE" "$F176_ENTRY" runner &
runner_job=$!
for _ in $(/usr/bin/seq 1 400); do
  [ -s "$F176_STOP_PID_FILE" ] && [ -s "$OVERNIGHT_LOCK_DIR/pid" ] && break
  /usr/bin/sleep 0.05
done
[ -s "$F176_STOP_PID_FILE" ] && [ -s "$OVERNIGHT_LOCK_DIR/pid" ] || { kill -TERM "$runner_job" 2>/dev/null || true; wait "$runner_job" 2>/dev/null || true; exit 96; }
target=$(cat "$F176_STOP_PID_FILE")
kill -CONT "$target"
wait "$runner_job"
[ -s "$F176_STOP_RESUMED_FILE" ] || exit 97
/usr/bin/grep -q 'PASS  probe:sxr_bug_repros.js' "$OVERNIGHT_LOG" || exit 98
exit 0
`);
  return runScript(stopHarness, fixtureEnv('stop', {
    SYNCVIEW_STAFF_KEY: '',
    SYNCVIEW_TEST_CLIENT_TOKEN: '',
    F176_ENTRY: bashPath(ENTRY),
    F176_RUNNER: bashPath(RUNNER),
    F176_STOP_TARGET: '1',
    F176_STOP_PID_FILE: bashPath(stopPidFile),
    F176_STOP_RESUMED_FILE: bashPath(resumedFile),
    F176_FAST_GRACE: '1',
    COMMAND_TIMEOUT_SECONDS: '5',
    RUN_ROUNDS: '1',
    RUN_PROBES: '1',
    PROBE_OFFSET: '0',
    PROBE_LIMIT: '1',
    RUN_SCENARIOS: '0',
    RUN_CALENDAR: '0',
    MASTER_FAST_EVERY: '0',
    RUN_UNIT: '0',
    COMMIT_REPORT_EVERY_ROUND: '0',
  }));
}

async function runLowFdFixture() {
  const lowFdHarness = path.join(tmp, 'low-fd-harness.sh');
  writeExecutable(lowFdHarness, String.raw`#!/usr/bin/bash
set -u
exec 0</dev/null
exec 7<<<'f176-synthetic-staff-marker-7f9c'
SYNCVIEW_STAFF_KEY_FD=7
export SYNCVIEW_STAFF_KEY_FD
source "$F176_RUNNER"
ec=$?
exec 7<&-
exit "$ec"
`);
  return runScript(lowFdHarness, fixtureEnv('low-fd', {
    SYNCVIEW_STAFF_KEY: '',
    SYNCVIEW_TEST_CLIENT_TOKEN: '',
    F176_RUNNER: bashPath(RUNNER),
    COMMAND_TIMEOUT_SECONDS: '5',
    RUN_ROUNDS: '1',
    RUN_PROBES: '1',
    PROBE_OFFSET: '7',
    PROBE_LIMIT: '1',
    RUN_SCENARIOS: '0',
    RUN_CALENDAR: '0',
    MASTER_FAST_EVERY: '0',
    RUN_UNIT: '0',
    COMMIT_REPORT_EVERY_ROUND: '0',
  }), ['-a']);
}

async function runOwnedCleanupFixture() {
  const source = String.raw`
const { spawn } = require('node:child_process');
const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'ignore',
});
console.log('descendant=' + descendant.pid);
setInterval(() => {}, 1000);
`;
  const result = await runOwnedFixture(process.execPath, ['-e', source], {
    cwd: ROOT,
    env: controllerEnvironment(),
  }, 250);
  assert.equal(result.error && result.error.code, 'ETIMEDOUT', 'the owned fixture deadline is visible');
  assert.equal(activeFixtures.size, 0, 'the timed-out fixture tree is closed before assertions continue');
  const match = result.stdout.match(/descendant=(\d+)/);
  assert.ok(match, 'the owned fixture launched a real descendant');
  const descendantPid = Number(match[1]);
  let descendantAlive = true;
  for (let attempt = 0; attempt < 50 && descendantAlive; attempt += 1) {
    try { process.kill(descendantPid, 0); }
    catch { descendantAlive = false; }
    if (descendantAlive) await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(descendantAlive, false, 'the owned fixture deadline removes its exact descendant tree');
  return result;
}

async function runBrokerForceStopFixture() {
  const forceRoot = path.join(tmp, 'broker-force-root');
  const forceQa = path.join(forceRoot, 'qa');
  fs.mkdirSync(forceQa, { recursive: true });
  const forceEntry = path.join(forceQa, 'overnight_entry.js');
  const forceJobGuard = path.join(forceQa, 'windows_job_guard.ps1');
  const forceJobWorker = path.join(forceQa, 'windows_job_worker.js');
  const forceSupervisor = path.join(forceQa, 'windows_bash_supervisor.sh');
  const forcePosixGuard = path.join(forceQa, 'posix_session_guard.js');
  const forceRunner = path.join(forceQa, 'overnight_runner.sh');
  const forceDriver = path.join(forceQa, 'drive-force-stop.js');
  fs.copyFileSync(ENTRY, forceEntry);
  fs.copyFileSync(WINDOWS_JOB_GUARD, forceJobGuard);
  fs.copyFileSync(WINDOWS_JOB_WORKER, forceJobWorker);
  fs.copyFileSync(WINDOWS_BASH_SUPERVISOR, forceSupervisor);
  fs.copyFileSync(POSIX_SESSION_GUARD, forcePosixGuard);
  writeExecutable(forceRunner, String.raw`#!/usr/bin/bash
set -u
printf '%s\n' "$BASHPID" > "$F176_FORCE_PID_FILE"
trap '' TERM INT
while :; do /usr/bin/sleep 1; done
`);

  const targetPidFile = path.join(tmp, 'broker-force-stop', 'target.pid');
  fs.writeFileSync(forceDriver, String.raw`'use strict';
const fs = require('node:fs');
const started = Date.now();
let emitted = false;
process.argv = [process.execPath, process.env.F176_FORCE_ENTRY_NATIVE, 'runner'];
require(process.env.F176_FORCE_ENTRY_NATIVE);
const poll = setInterval(() => {
  if (emitted || !fs.existsSync(process.env.F176_FORCE_PID_NATIVE)) return;
  emitted = true;
  clearInterval(poll);
  console.log('force-stop-signal-emitted');
  process.emit('SIGTERM');
}, 10);
process.once('exit', () => {
  console.log('forced-stop-elapsed=' + Math.floor((Date.now() - started) / 1000));
});
`, 'utf8');
  const env = fixtureEnv('broker-force-stop', {
    F176_FORCE_ENTRY_NATIVE: forceEntry,
    F176_FORCE_PID_NATIVE: targetPidFile,
    F176_FORCE_PID_FILE: bashPath(targetPidFile),
  });
  const result = await runOwnedFixture(process.execPath, [forceDriver], {
    cwd: forceRoot,
    env,
  }, 60_000);
  if (result.error) {
    throw new Error(
      `broker force-stop fixture failed: ${result.error.message}`
        + `\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`,
    );
  }
  assert.equal(result.status, 1, `broker force-stop fixture failed status=${result.status}`);
  const elapsed = Number((result.stdout.match(/forced-stop-elapsed=(\d+)/) || [])[1]);
  assert.equal(Number.isInteger(elapsed) && elapsed >= 30 && elapsed <= 55, true, `unexpected force-stop elapsed=${elapsed}`);
  const targetPid = fs.readFileSync(targetPidFile, 'utf8').trim();
  const targetAlive = spawnSync(BASH, ['-lc', `kill -0 ${targetPid} 2>/dev/null`]);
  assert.notEqual(targetAlive.status, 0, 'the broker force-stop removes its resistant child tree');
  return result;
}

async function waitForNativePidGone(pid, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(Number(pid), 0); }
    catch { return true; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  try { process.kill(Number(pid), 0); }
  catch { return true; }
  return false;
}

async function waitForBashPidGone(pid, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = spawnSync(BASH, ['-lc', `kill -0 ${pid} 2>/dev/null`]);
    if (probe.status !== 0) return true;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return spawnSync(BASH, ['-lc', `kill -0 ${pid} 2>/dev/null`]).status !== 0;
}

async function runAbruptBrokerDeathFixture() {
  const descendantPidFile = path.join(tmp, 'broker-abrupt', 'descendant.pid');
  const lock = path.join(tmp, 'broker-abrupt', 'runner.lock');
  const driver = path.join(tmp, 'broker-abrupt-driver.js');
  fs.writeFileSync(driver, String.raw`'use strict';
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, [process.env.F176_ABRUPT_ENTRY_NATIVE, 'runner'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ['ignore', 'inherit', 'inherit'],
});
let killed = false;
const poll = setInterval(() => {
  if (killed) return;
  if (!fs.existsSync(process.env.F176_ABRUPT_DESCENDANT_NATIVE)) return;
  if (!fs.existsSync(process.env.F176_ABRUPT_LOCK_NATIVE)) return;
  killed = true;
  clearInterval(poll);
  console.log('broker-abrupt-kill');
  try { child.kill('SIGKILL'); } catch { process.exit(122); }
}, 10);
const deadline = setTimeout(() => {
  clearInterval(poll);
  try { child.kill('SIGKILL'); } catch {}
  process.exit(123);
}, 30_000);
child.once('exit', (code, signal) => {
  clearTimeout(deadline);
  clearInterval(poll);
  const failed = killed && ((Number.isInteger(code) && code !== 0) || signal);
  console.log('broker-abrupt-exit=' + code + ' signal=' + signal);
  setTimeout(() => process.exit(failed ? 0 : 124), 1500);
});
`, 'utf8');
  const env = fixtureEnv('broker-abrupt', {
    F176_ABRUPT_ENTRY_NATIVE: ENTRY,
    F176_ABRUPT_DESCENDANT_NATIVE: descendantPidFile,
    F176_ABRUPT_LOCK_NATIVE: lock,
    F176_RESISTANT_TARGET: '1',
    F176_DESCENDANT_PID_FILE: bashPath(descendantPidFile),
    COMMAND_TIMEOUT_SECONDS: '60',
    RUN_ROUNDS: '1',
    RUN_PROBES: '1',
    PROBE_OFFSET: '0',
    PROBE_LIMIT: '1',
    RUN_SCENARIOS: '0',
    RUN_CALENDAR: '0',
    MASTER_FAST_EVERY: '0',
    RUN_UNIT: '0',
    COMMIT_REPORT_EVERY_ROUND: '0',
  });
  const result = await runOwnedFixture(process.execPath, [driver], {
    cwd: ROOT,
    env,
  }, 45_000);
  if (result.error) {
    throw new Error(
      `abrupt broker-death fixture failed: ${result.error.message}`
        + `\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`,
    );
  }
  assert.equal(result.status, 0, `abrupt broker-death fixture failed status=${result.status}`);
  assert.equal(fs.existsSync(descendantPidFile), true, 'abrupt broker fixture reached the protected workload');
  const descendantPid = fs.readFileSync(descendantPidFile, 'utf8').trim();
  assert.match(descendantPid, /^\d+$/, 'abrupt broker fixture recorded its descendant pid');
  assert.equal(
    await waitForBashPidGone(descendantPid),
    true,
    'broker death after READY removes the resistant Bash descendant tree',
  );
  return result;
}

async function runWindowsJobRootExitFixture() {
  if (process.platform !== 'win32') return null;
  const descendantPidFile = path.join(tmp, 'windows-root-exit', 'descendant.pid');
  const worker = path.join(tmp, 'windows-root-exit-worker.js');
  fs.writeFileSync(worker, String.raw`'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const clean = {
  SystemRoot: process.env.SystemRoot || 'C:\\Windows',
  WINDIR: process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows',
  COMSPEC: process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe',
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
};
const powershell = path.join(clean.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const guard = spawn(powershell, [
  '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
  '-File', process.env.F176_WINDOWS_JOB_GUARD_NATIVE,
  '-OwnerProcessId', String(process.pid),
  '-ExpectedImagePath', process.execPath,
], {
  env: clean,
  stdio: ['ignore', 'pipe', 'ignore'],
  windowsHide: true,
});
let output = '';
let ready = false;
const fail = code => {
  try { guard.kill('SIGKILL'); } catch {}
  process.exit(code);
};
const deadline = setTimeout(() => fail(125), ${WINDOWS_GUARD_READY_TIMEOUT_MS});
guard.stdout.setEncoding('utf8');
guard.stdout.on('data', chunk => {
  if (ready) return;
  output += chunk;
  if (output.length > 128) return fail(126);
  if (!/^READY\r?\n$/.test(output)) return;
  ready = true;
  clearTimeout(deadline);
  guard.stdout.destroy();
  guard.unref();
  const descendantSource = "const fs=require('node:fs');fs.writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000);";
  const descendant = spawn(process.execPath, ['-e', descendantSource, process.env.F176_WINDOWS_DESCENDANT_NATIVE], {
    env: clean,
    stdio: 'ignore',
    windowsHide: true,
  });
  descendant.unref();
  const childDeadline = setTimeout(() => process.exit(127), 5_000);
  const poll = setInterval(() => {
    if (!fs.existsSync(process.env.F176_WINDOWS_DESCENDANT_NATIVE)) return;
    clearInterval(poll);
    clearTimeout(childDeadline);
    process.exit(0);
  }, 10);
});
guard.once('error', () => fail(128));
guard.once('exit', () => { if (!ready) fail(129); });
`, 'utf8');
  const env = fixtureEnv('windows-root-exit', {
    F176_WINDOWS_JOB_GUARD_NATIVE: WINDOWS_JOB_GUARD,
    F176_WINDOWS_DESCENDANT_NATIVE: descendantPidFile,
  });
  const result = await runOwnedFixture(process.execPath, [worker], {
    cwd: ROOT,
    env,
  }, WINDOWS_GUARD_READY_TIMEOUT_MS + 30_000);
  if (result.error) {
    throw new Error(`Windows root-exit Job fixture failed: ${result.error.message}`);
  }
  assert.equal(result.status, 0, `Windows root-exit Job fixture failed status=${result.status}`);
  assert.equal(fs.existsSync(descendantPidFile), true, 'Windows Job fixture launched a detached descendant');
  const descendantPid = fs.readFileSync(descendantPidFile, 'utf8').trim();
  assert.match(descendantPid, /^\d+$/, 'Windows Job fixture recorded a native descendant pid');
  assert.equal(
    await waitForNativePidGone(descendantPid),
    true,
    'closing the owner Job kills a descendant after the root exits first',
  );
  return result;
}

async function runRuntimeRootExitFixture() {
  const fixtureRoot = path.join(tmp, 'runtime-root-exit-root');
  const fixtureQa = path.join(fixtureRoot, 'qa');
  fs.mkdirSync(fixtureQa, { recursive: true });
  const fixtureEntry = path.join(fixtureQa, 'overnight_entry.js');
  const fixtureJobGuard = path.join(fixtureQa, 'windows_job_guard.ps1');
  const fixtureJobWorker = path.join(fixtureQa, 'windows_job_worker.js');
  const fixtureSupervisor = path.join(fixtureQa, 'windows_bash_supervisor.sh');
  const fixturePosixGuard = path.join(fixtureQa, 'posix_session_guard.js');
  const fixtureRunner = path.join(fixtureQa, 'overnight_runner.sh');
  const descendantPidFile = path.join(tmp, 'runtime-root-exit', 'descendant.pid');
  fs.copyFileSync(ENTRY, fixtureEntry);
  fs.copyFileSync(WINDOWS_JOB_GUARD, fixtureJobGuard);
  fs.copyFileSync(WINDOWS_JOB_WORKER, fixtureJobWorker);
  fs.copyFileSync(WINDOWS_BASH_SUPERVISOR, fixtureSupervisor);
  fs.copyFileSync(POSIX_SESSION_GUARD, fixturePosixGuard);
  writeExecutable(fixtureRunner, String.raw`#!/usr/bin/bash
set -u
"$F176_REAL_NODE" -e '
  const fs = require("node:fs");
  fs.writeFileSync(process.env.F176_ROOT_DESCENDANT_NATIVE, String(process.pid));
  for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
    try { process.on(signal, () => {}); } catch {}
  }
  setInterval(() => {}, 1000);
' </dev/null >/dev/null 2>&1 &
for _ in $(/usr/bin/seq 1 500); do
  [ -s "$F176_ROOT_DESCENDANT_PID_FILE" ] && break
  /usr/bin/sleep 0.01
done
[ -s "$F176_ROOT_DESCENDANT_PID_FILE" ] || exit 91
exit 0
`);
  const result = await runOwnedFixture(process.execPath, [fixtureEntry, 'runner'], {
    cwd: fixtureRoot,
    env: fixtureEnv('runtime-root-exit', {
      SYNCVIEW_STAFF_KEY: '',
      SYNCVIEW_TEST_CLIENT_TOKEN: '',
      F176_ROOT_DESCENDANT_NATIVE: descendantPidFile,
      F176_ROOT_DESCENDANT_PID_FILE: bashPath(descendantPidFile),
    }),
  }, 45_000);
  if (result.error) {
    throw new Error(
      `runtime root-exit fixture failed: ${result.error.message}`
        + `\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`,
    );
  }
  assert.equal(result.status, 70, `runtime root-exit fixture failed status=${result.status}`);
  assert.match(
    `${result.stdout || ''}\n${result.stderr || ''}`,
    /left descendant processes/,
    'leader-first exit is a visible containment failure instead of false success',
  );
  assert.equal(fs.existsSync(descendantPidFile), true, 'root-exit fixture launched a resistant descendant');
  const descendantPid = fs.readFileSync(descendantPidFile, 'utf8').trim();
  assert.equal(
    await waitForNativePidGone(descendantPid),
    true,
    'normal Bash leader exit cannot leave its descendant session or Job behind',
  );
  return result;
}

async function runWindowsContainmentRefusalFixture() {
  if (process.platform !== 'win32') return null;
  const refusalRoot = path.join(tmp, 'windows-containment-refusal-root');
  const refusalQa = path.join(refusalRoot, 'qa');
  fs.mkdirSync(refusalQa, { recursive: true });
  const refusalEntry = path.join(refusalQa, 'overnight_entry.js');
  const refusalGuard = path.join(refusalQa, 'windows_job_guard.ps1');
  const refusalWorker = path.join(refusalQa, 'windows_job_worker.js');
  const refusalSupervisor = path.join(refusalQa, 'windows_bash_supervisor.sh');
  const refusalRunner = path.join(refusalQa, 'overnight_runner.sh');
  const marker = path.join(tmp, 'windows-containment-refusal', 'runner-reached');
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.copyFileSync(ENTRY, refusalEntry);
  fs.copyFileSync(WINDOWS_JOB_WORKER, refusalWorker);
  fs.copyFileSync(WINDOWS_BASH_SUPERVISOR, refusalSupervisor);
  fs.writeFileSync(refusalGuard, "exit 71\n", 'utf8');
  writeExecutable(refusalRunner, String.raw`#!/usr/bin/bash
printf 'runner-reached\n' > "$F176_CONTAINMENT_REFUSAL_MARKER"
exit 0
`);
  const result = await runOwnedFixture(process.execPath, [refusalEntry, 'runner'], {
    cwd: refusalRoot,
    env: fixtureEnv('windows-containment-refusal', {
      F176_CONTAINMENT_REFUSAL_MARKER: bashPath(marker),
    }),
  }, 30_000);
  if (result.error) {
    throw new Error(`Windows containment-refusal fixture failed: ${result.error.message}`);
  }
  assert.equal(result.status, 69, `Windows containment-refusal fixture failed status=${result.status}`);
  assert.match(
    `${result.stdout || ''}\n${result.stderr || ''}`,
    /REFUSED: Windows process-tree containment/,
    'containment readiness failure is visible before Bash launch',
  );
  assert.equal(fs.existsSync(marker), false, 'containment failure releases no issuer and launches no runner');
  return result;
}

async function runWindowsGuardCrashFixture() {
  if (process.platform !== 'win32') return null;
  const descendantPidFile = path.join(tmp, 'windows-guard-crash', 'descendant.pid');
  const lock = path.join(tmp, 'windows-guard-crash', 'runner.lock');
  const driver = path.join(tmp, 'windows-guard-crash-driver.js');
  fs.writeFileSync(driver, String.raw`'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const clean = {
  SystemRoot: process.env.SystemRoot || 'C:\\Windows',
  WINDIR: process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows',
  COMSPEC: process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe',
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
};
const powershell = path.join(clean.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const taskkill = path.join(clean.SystemRoot, 'System32', 'taskkill.exe');
const broker = spawn(process.execPath, [process.env.F176_GUARD_CRASH_ENTRY_NATIVE, 'runner'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ['ignore', 'inherit', 'inherit'],
});
let stopping = false;
const fail = code => {
  try { broker.kill('SIGKILL'); } catch {}
  process.exit(code);
};
const deadline = setTimeout(() => fail(130), 30_000);
const poll = setInterval(() => {
  if (stopping) return;
  if (!fs.existsSync(process.env.F176_GUARD_CRASH_DESCENDANT_NATIVE)) return;
  if (!fs.existsSync(process.env.F176_GUARD_CRASH_LOCK_NATIVE)) return;
  stopping = true;
  clearInterval(poll);
  const query = [
    '$p=' + broker.pid,
    '$m=@(Get-CimInstance Win32_Process -Filter "ParentProcessId = ' + broker.pid + '" | Where-Object { $_.CommandLine -like "*windows_job_guard.ps1*" })',
    'if($m.Count -ne 1){exit 3}',
    '[Console]::Out.WriteLine($m[0].ProcessId)',
  ].join(';');
  const finder = spawn(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', query,
  ], { env: clean, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  let output = '';
  finder.stdout.setEncoding('utf8');
  finder.stdout.on('data', chunk => { output += chunk; });
  finder.once('close', code => {
    const guardPid = output.trim();
    if (code !== 0 || !/^\d+$/.test(guardPid)) return fail(131);
    console.log('guard-crash-pid=' + guardPid);
    const killer = spawn(taskkill, ['/PID', guardPid, '/F'], {
      env: clean,
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.once('close', killCode => { if (killCode !== 0) fail(132); });
    killer.once('error', () => fail(133));
  });
  finder.once('error', () => fail(134));
}, 10);
broker.once('exit', (code, signal) => {
  clearInterval(poll);
  clearTimeout(deadline);
  const failed = stopping && ((Number.isInteger(code) && code !== 0) || signal);
  console.log('guard-crash-broker-exit=' + code + ' signal=' + signal);
  setTimeout(() => process.exit(failed ? 0 : 135), 1500);
});
`, 'utf8');
  const env = fixtureEnv('windows-guard-crash', {
    F176_GUARD_CRASH_ENTRY_NATIVE: ENTRY,
    F176_GUARD_CRASH_DESCENDANT_NATIVE: descendantPidFile,
    F176_GUARD_CRASH_LOCK_NATIVE: lock,
    F176_RESISTANT_TARGET: '1',
    F176_DESCENDANT_PID_FILE: bashPath(descendantPidFile),
    COMMAND_TIMEOUT_SECONDS: '60',
    RUN_ROUNDS: '1',
    RUN_PROBES: '1',
    PROBE_OFFSET: '0',
    PROBE_LIMIT: '1',
    RUN_SCENARIOS: '0',
    RUN_CALENDAR: '0',
    MASTER_FAST_EVERY: '0',
    RUN_UNIT: '0',
    COMMIT_REPORT_EVERY_ROUND: '0',
  });
  const result = await runOwnedFixture(process.execPath, [driver], {
    cwd: ROOT,
    env,
  }, 45_000);
  if (result.error) {
    throw new Error(
      `Windows guard-crash fixture failed: ${result.error.message}`
        + `\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`,
    );
  }
  assert.equal(result.status, 0, `Windows guard-crash fixture failed status=${result.status}`);
  assert.match(
    `${result.stdout || ''}\n${result.stderr || ''}`,
    /REFUSED: Windows process-tree containment (?:was lost|control failed)/,
    'guard death after READY is a visible containment failure',
  );
  assert.equal(fs.existsSync(descendantPidFile), true, 'guard-crash fixture reached the protected workload');
  const descendantPid = fs.readFileSync(descendantPidFile, 'utf8').trim();
  assert.equal(
    await waitForBashPidGone(descendantPid),
    true,
    'guard death after READY closes the Job and removes the resistant tree',
  );
  return result;
}

async function runWindowsHelperRootRefusalFixture() {
  if (process.platform !== 'win32') return null;
  const fakeRoot = path.join(tmp, 'windows-fake-helper-root');
  const fakeProgramFiles = path.join(tmp, 'windows-fake-program-files');
  const driver = path.join(tmp, 'windows-helper-root-refusal-driver.js');
  const fakePowershell = path.join(fakeRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const fakeBash = path.join(fakeProgramFiles, 'Git', 'bin', 'bash.exe');
  fs.mkdirSync(path.dirname(fakePowershell), { recursive: true });
  fs.mkdirSync(path.dirname(fakeBash), { recursive: true });
  fs.writeFileSync(fakePowershell, 'not-a-system-helper', 'utf8');
  fs.writeFileSync(fakeBash, 'not-a-trusted-shell', 'utf8');
  fs.writeFileSync(driver, String.raw`'use strict';
const helperRootNames = new Set(['SYSTEMROOT', 'WINDIR', 'PROGRAMFILES', 'PROGRAMW6432', 'PROGRAMFILES(X86)']);
for (const name of Object.keys(process.env)) {
  if (helperRootNames.has(name.toUpperCase())) delete process.env[name];
}
Object.assign(process.env, {
  SystemRoot: process.env.F176_FAKE_SYSTEM_ROOT,
  WINDIR: process.env.F176_FAKE_SYSTEM_ROOT,
  ProgramFiles: process.env.F176_FAKE_PROGRAM_FILES,
  ProgramW6432: process.env.F176_FAKE_PROGRAM_FILES,
  'ProgramFiles(x86)': process.env.F176_FAKE_PROGRAM_FILES,
});
process.argv = [process.execPath, process.env.F176_ENTRY_NATIVE, 'runner'];
require(process.env.F176_ENTRY_NATIVE);
`, 'utf8');
  const env = fixtureEnv('windows-helper-root-refusal', {
    F176_ENTRY_NATIVE: ENTRY,
    F176_FAKE_SYSTEM_ROOT: fakeRoot,
    F176_FAKE_PROGRAM_FILES: fakeProgramFiles,
  });
  const result = await runOwnedFixture(process.execPath, [driver], {
    cwd: ROOT,
    env,
  }, 30_000);
  if (result.error) {
    throw new Error(`Windows helper-root refusal fixture failed: ${result.error.message}`);
  }
  assert.equal(result.status, 78, `Windows helper-root refusal fixture failed status=${result.status}`);
  assert.match(
    `${result.stdout || ''}\n${result.stderr || ''}`,
    /REFUSED: Windows protected helper roots are not trusted/,
    'caller-controlled Windows helper roots are rejected visibly before containment',
  );
  assert.equal(
    readRecords(capture).some(record => record.run === 'windows-helper-root-refusal'),
    false,
    'a fake Windows helper root cannot reach Bash or receive the issuer',
  );
  return result;
}

async function runPosixGuardCrashFixture() {
  if (process.platform === 'win32') return null;
  const descendantPidFile = path.join(tmp, 'posix-guard-crash', 'descendant.pid');
  const lock = path.join(tmp, 'posix-guard-crash', 'runner.lock');
  const driver = path.join(tmp, 'posix-guard-crash-driver.js');
  fs.writeFileSync(driver, String.raw`'use strict';
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const broker = spawn(process.execPath, [process.env.F176_POSIX_GUARD_CRASH_ENTRY, 'runner'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ['ignore', 'inherit', 'inherit'],
});
const ps = ['/usr/bin/ps', '/bin/ps'].find(candidate => fs.existsSync(candidate));
let stopping = false;
const fail = code => {
  try { broker.kill('SIGKILL'); } catch {}
  process.exit(code);
};
const deadline = setTimeout(() => fail(140), 30_000);
const poll = setInterval(() => {
  if (stopping || !ps) return;
  if (!fs.existsSync(process.env.F176_POSIX_GUARD_CRASH_DESCENDANT)) return;
  if (!fs.existsSync(process.env.F176_POSIX_GUARD_CRASH_LOCK)) return;
  stopping = true;
  clearInterval(poll);
  const finder = spawn(ps, ['-eo', 'pid=,ppid=,args='], {
    env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  let output = '';
  finder.stdout.setEncoding('utf8');
  finder.stdout.on('data', chunk => { output += chunk; });
  finder.once('close', code => {
    if (code !== 0) return fail(141);
    const guard = output.split(/\r?\n/).map(line => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      return match ? { pid: Number(match[1]), ppid: Number(match[2]), args: match[3] } : null;
    }).find(row => row && row.ppid === broker.pid && row.args.includes('posix_session_guard.js') && row.args.includes('watch'));
    if (!guard) return fail(142);
    console.log('posix-guard-crash-pid=' + guard.pid);
    try { process.kill(guard.pid, 'SIGKILL'); }
    catch { return fail(143); }
  });
  finder.once('error', () => fail(144));
}, 10);
broker.once('exit', (code, signal) => {
  clearInterval(poll);
  clearTimeout(deadline);
  const failed = stopping && ((Number.isInteger(code) && code !== 0) || signal);
  console.log('posix-guard-crash-broker-exit=' + code + ' signal=' + signal);
  setTimeout(() => process.exit(failed ? 0 : 145), 500);
});
`, 'utf8');
  const result = await runOwnedFixture(process.execPath, [driver], {
    cwd: ROOT,
    env: fixtureEnv('posix-guard-crash', {
      F176_POSIX_GUARD_CRASH_ENTRY: ENTRY,
      F176_POSIX_GUARD_CRASH_DESCENDANT: descendantPidFile,
      F176_POSIX_GUARD_CRASH_LOCK: lock,
      F176_RESISTANT_TARGET: '1',
      F176_DESCENDANT_PID_FILE: descendantPidFile,
      COMMAND_TIMEOUT_SECONDS: '60',
      RUN_ROUNDS: '1',
      RUN_PROBES: '1',
      PROBE_OFFSET: '0',
      PROBE_LIMIT: '1',
      RUN_SCENARIOS: '0',
      RUN_CALENDAR: '0',
      MASTER_FAST_EVERY: '0',
      RUN_UNIT: '0',
      COMMIT_REPORT_EVERY_ROUND: '0',
    }),
  }, 45_000);
  if (result.error) {
    throw new Error(
      `POSIX guard-crash fixture failed: ${result.error.message}`
        + `\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`,
    );
  }
  assert.equal(result.status, 0, `POSIX guard-crash fixture failed status=${result.status}`);
  assert.match(
    `${result.stdout || ''}\n${result.stderr || ''}`,
    /REFUSED: POSIX session containment was lost/,
    'guardian death after READY is a visible containment failure',
  );
  assert.equal(fs.existsSync(descendantPidFile), true, 'POSIX guard-crash fixture reached the protected workload');
  const descendantPid = fs.readFileSync(descendantPidFile, 'utf8').trim();
  assert.equal(
    await waitForBashPidGone(descendantPid),
    true,
    'guardian death invokes emergency KILL and removes the resistant session',
  );
  return result;
}

async function main() {
  let directResult;
  let cronResult;
  let missingIssuerResult;
  let timeoutResult;
  let commandRootExitResult;
  let signalResult;
  let cronSignalResult;
  let stopResult;
  let lowFdResult;
  let launchSignalResult;
  let zeroTimeoutResult;
  let command124Result;
  let timerFailureResult;
  let nativePathResult = null;
  let nodeOptionsResult;
  let mixedCaseResult = null;
  let serverFailureResult;
  let earlyBrokerSignalResult;
  let ownedCleanupResult;
  let brokerForceStopResult;
  let abruptBrokerDeathResult;
  let windowsJobRootExitResult = null;
  let runtimeRootExitResult;
  let windowsHelperRootRefusalResult = null;
  let windowsContainmentRefusalResult = null;
  let windowsGuardCrashResult = null;
  let posixGuardCrashResult = null;
  let guardPassed = false;
  try {
  await armWindowsHarnessContainment();
  runDistinctDescriptorClassificationFixture();
  windowsHelperRootRefusalResult = await runWindowsHelperRootRefusalFixture();
  nodeOptionsResult = await runEntry('runner', fixtureEnv('node-options', {
    NODE_OPTIONS: '--no-warnings',
  }), [78]);
  assert.match(
    `${nodeOptionsResult.stdout || ''}\n${nodeOptionsResult.stderr || ''}`,
    /REFUSED: clear NODE_OPTIONS/,
    'the broker visibly diagnoses a violated pre-Node startup trust precondition',
  );
  const loaderControlResult = await runEntry('runner', fixtureEnv('loader-control', {
    LD_LIBRARY_PATH: bashPath(path.join(tmp, 'synthetic-loader-path')),
  }), [78]);
  assert.match(
    `${loaderControlResult.stdout || ''}\n${loaderControlResult.stderr || ''}`,
    /REFUSED: clear LD_LIBRARY_PATH/,
    'the broker visibly diagnoses an inherited OS loader control',
  );
  ownedCleanupResult = await runOwnedCleanupFixture();
  windowsJobRootExitResult = await runWindowsJobRootExitFixture();
  runtimeRootExitResult = await runRuntimeRootExitFixture();
  windowsContainmentRefusalResult = await runWindowsContainmentRefusalFixture();
  earlyBrokerSignalResult = await runEarlyBrokerSignalFixture();
  signalResult = await runSignalFixture();
  assertBoundaryRecords(readRecords(capture), 'signal');
  cronSignalResult = await runCronSignalFixture();
  assertBoundaryRecords(readRecords(capture), 'cron-signal');
  const cronSignalOutput = `${cronSignalResult.stdout || ''}\n${cronSignalResult.stderr || ''}`;
  assert.match(cronSignalOutput, /received TERM; stopping runner/, 'cron TERM reaches the nested runner');
  assert.match(
    cronSignalOutput,
    /CRON received TERM; stopped active chunk/,
    'cron reports the outer chunk shutdown visibly',
  );
  stopResult = await runStopFixture();
  lowFdResult = await runLowFdFixture();
  launchSignalResult = await runLaunchSignalFixture();
  assert.equal(
    fs.existsSync(path.join(tmp, 'launch-signal', 'runner.lock')),
    false,
    'a signal during launch handoff still releases the singleton lock',
  );
  assert.match(
    fs.readFileSync(path.join(tmp, 'launch-signal', 'runner.log'), 'utf8'),
    /received TERM; stopping runner/,
    'a signal during launch handoff is serviced immediately',
  );
  directResult = await runEntry('runner', fixtureEnv('direct', {
    COMMAND_TIMEOUT_SECONDS: '0005',
    RUN_ROUNDS: '1',
    RUN_PROBES: '0',
    RUN_SCENARIOS: '1',
    SCN_LIMIT: '1',
    RUN_CALENDAR: '1',
    CAL_OFFSET: '2',
    CAL_LIMIT: '2',
    MASTER_FAST_EVERY: '1',
    TREE_EVERY: '0',
    FULL_MASTER_EVERY: '0',
    RUN_UNIT: '1',
    COMMIT_REPORT_EVERY_ROUND: '1',
  }));
  const cronState = path.join(tmp, 'cron', 'state');
  cronResult = await runEntry('cron', fixtureEnv('cron', {
    OVERNIGHT_CRON_PHASE: '1',
    OVERNIGHT_CRON_STATE: bashPath(cronState),
  }));
  assert.equal(fs.readFileSync(cronState, 'utf8').trim(), '2', 'successful protected cron advances its phase');
  assert.match(
    fs.readFileSync(path.join(tmp, 'cron', 'runner.log'), 'utf8'),
    /CRON chunk phase=1 done exit=0 next=2/,
    'successful protected cron completes visibly',
  );
  if (process.platform === 'win32') {
    const nativePathKey = Object.keys(process.env).find(name => name.toUpperCase() === 'PATH');
    assert.ok(nativePathKey, 'Windows exposes its native caller Path');
    const nativeEnv = fixtureEnv('native-path', {
      NODE_BIN: 'node',
      NODE_BIN_FALLBACK: 'node',
      RUN_ROUNDS: '1',
      RUN_PROBES: '1',
      PROBE_OFFSET: '0',
      PROBE_LIMIT: '1',
      RUN_SCENARIOS: '0',
      RUN_CALENDAR: '0',
      MASTER_FAST_EVERY: '0',
      RUN_UNIT: '0',
      COMMIT_REPORT_EVERY_ROUND: '0',
    });
    for (const name of Object.keys(nativeEnv)) {
      if (name.toUpperCase() === 'PATH') delete nativeEnv[name];
    }
    nativeEnv[nativePathKey] = `${bin}${path.delimiter}${process.env[nativePathKey] || ''}`;
    nativePathResult = await runEntry('runner', nativeEnv);
    const nativePathOutput = `${nativePathResult.stdout || ''}\n${nativePathResult.stderr || ''}`;
    assert.match(nativePathOutput, /PASS  probe:sxr_bug_repros\.js/, 'native Windows Path retains its caller-only Node shim');
    assert.doesNotMatch(
      nativePathOutput,
      /command not found|No such file or directory|not recognized/i,
      'the broker preserves native caller tools and appends trusted Git Bash runtime tools',
    );

    const mixedEnv = fixtureEnv('mixed-case', {
      RUN_ROUNDS: '1',
      RUN_PROBES: '1',
      PROBE_OFFSET: '7',
      PROBE_LIMIT: '1',
      RUN_SCENARIOS: '0',
      RUN_CALENDAR: '0',
      MASTER_FAST_EVERY: '0',
      RUN_UNIT: '0',
      COMMIT_REPORT_EVERY_ROUND: '0',
    });
    for (const name of Object.keys(mixedEnv)) {
      if (['SYNCVIEW_STAFF_KEY', 'SYNCVIEW_TEST_CLIENT_TOKEN'].includes(name.toUpperCase())) delete mixedEnv[name];
    }
    mixedEnv.SyncView_Staff_Key = STAFF_MARKER;
    mixedEnv.SyNcViEw_TeSt_ClIeNt_ToKeN = LEGACY_MARKER;
    mixedCaseResult = await runEntry('runner', mixedEnv);
  }
  missingIssuerResult = await runEntry('runner', fixtureEnv('missing', {
    SYNCVIEW_STAFF_KEY: '',
    RUN_ROUNDS: '1',
    RUN_PROBES: '1',
    PROBE_OFFSET: '7',
    PROBE_LIMIT: '1',
    RUN_SCENARIOS: '0',
    RUN_CALENDAR: '0',
    MASTER_FAST_EVERY: '0',
    RUN_UNIT: '0',
    COMMIT_REPORT_EVERY_ROUND: '0',
  }));
  const descendantPidFile = path.join(tmp, 'timeout', 'descendant.pid');
  timeoutResult = await runEntry('runner', fixtureEnv('timeout', {
    F176_RESISTANT_TARGET: '1',
    F176_FAST_GRACE: '1',
    F176_DESCENDANT_PID_FILE: bashPath(descendantPidFile),
    COMMAND_TIMEOUT_SECONDS: '1',
    RUN_ROUNDS: '1',
    RUN_PROBES: '1',
    PROBE_OFFSET: '0',
    PROBE_LIMIT: '1',
    RUN_SCENARIOS: '0',
    RUN_CALENDAR: '0',
    MASTER_FAST_EVERY: '0',
    RUN_UNIT: '0',
    COMMIT_REPORT_EVERY_ROUND: '0',
  }));
  assert.equal(fs.existsSync(descendantPidFile), true, 'timeout fixture started a resistant descendant');
  const descendantPid = fs.readFileSync(descendantPidFile, 'utf8').trim();
  assert.match(descendantPid, /^\d+$/, 'timeout fixture recorded a numeric descendant pid');
  const descendantAlive = spawnSync(BASH, ['-lc', `kill -0 ${descendantPid} 2>/dev/null`]);
  assert.notEqual(descendantAlive.status, 0, 'timeout KILL boundary must remove a TERM-resistant descendant');

  const commandRootDescendantPidFile = path.join(tmp, 'command-root-exit', 'descendant.pid');
  commandRootExitResult = await runEntry('runner', fixtureEnv('command-root-exit', {
    F176_COMMAND_ROOT_EXIT: '1',
    F176_FAST_GRACE: '1',
    F176_COMMAND_ROOT_DESCENDANT_PID_FILE: bashPath(commandRootDescendantPidFile),
    COMMAND_TIMEOUT_SECONDS: '60',
    RUN_ROUNDS: '1',
    RUN_PROBES: '1',
    PROBE_OFFSET: '7',
    PROBE_LIMIT: '1',
    RUN_SCENARIOS: '0',
    RUN_CALENDAR: '0',
    MASTER_FAST_EVERY: '0',
    RUN_UNIT: '0',
    COMMIT_REPORT_EVERY_ROUND: '0',
  }));
  assert.equal(
    fs.existsSync(commandRootDescendantPidFile),
    true,
    'protected command root-exit fixture launched a resistant descendant',
  );
  const commandRootDescendantPid = fs.readFileSync(commandRootDescendantPidFile, 'utf8').trim();
  assert.equal(
    await waitForBashPidGone(commandRootDescendantPid),
    true,
    'a protected command leader cannot leave its credential-bearing process group behind',
  );
  assert.match(
    `${commandRootExitResult.stdout || ''}\n${commandRootExitResult.stderr || ''}`,
    /REFUSED: overnight command left descendant processes after its leader exited/,
    'protected command leader-first exit fails visibly before the next command',
  );

  zeroTimeoutResult = await runEntry('runner', fixtureEnv('zero-timeout', {
    COMMAND_TIMEOUT_SECONDS: '0',
    RUN_ROUNDS: '1',
    RUN_PROBES: '1',
    PROBE_OFFSET: '0',
    PROBE_LIMIT: '1',
    RUN_SCENARIOS: '0',
    RUN_CALENDAR: '0',
    MASTER_FAST_EVERY: '0',
    RUN_UNIT: '0',
    COMMIT_REPORT_EVERY_ROUND: '0',
  }));
  command124Result = await runEntry('runner', fixtureEnv('command-124', {
    F176_COMMAND_EXIT_124: '1',
    COMMAND_TIMEOUT_SECONDS: '5',
    RUN_ROUNDS: '1',
    RUN_PROBES: '1',
    PROBE_OFFSET: '0',
    PROBE_LIMIT: '1',
    RUN_SCENARIOS: '0',
    RUN_CALENDAR: '0',
    MASTER_FAST_EVERY: '0',
    RUN_UNIT: '0',
    COMMIT_REPORT_EVERY_ROUND: '0',
  }));
  timerFailureResult = await runEntry('runner', fixtureEnv('timer-failure', {
    F176_TIMER_FAIL: '1',
    F176_FAST_GRACE: '1',
    F176_TIMER_FAILURE_TARGET: '1',
    COMMAND_TIMEOUT_SECONDS: '5',
    RUN_ROUNDS: '1',
    RUN_PROBES: '1',
    PROBE_OFFSET: '0',
    PROBE_LIMIT: '1',
    RUN_SCENARIOS: '0',
    RUN_CALENDAR: '0',
    MASTER_FAST_EVERY: '0',
    RUN_UNIT: '0',
    COMMIT_REPORT_EVERY_ROUND: '0',
  }));

  const serverPidFile = path.join(tmp, 'server-failure', 'server.pid');
  serverFailureResult = await runEntry('runner', fixtureEnv('server-failure', {
    PYTHON_BIN: `${bashPath(bin)}/python`,
    F176_SERVER_NEVER_READY: '1',
    F176_FAST_READINESS: '1',
    F176_SERVER_PID_FILE: bashPath(serverPidFile),
    RUN_ROUNDS: '1',
    RUN_PROBES: '1',
    PROBE_OFFSET: '0',
    PROBE_LIMIT: '1',
    RUN_SCENARIOS: '0',
    RUN_CALENDAR: '0',
    MASTER_FAST_EVERY: '0',
    RUN_UNIT: '0',
    COMMIT_REPORT_EVERY_ROUND: '0',
  }));
  assert.equal(fs.existsSync(serverPidFile), true, 'failed-readiness fixture started its owned server');
  const failedServerPid = fs.readFileSync(serverPidFile, 'utf8').trim();
  assert.match(failedServerPid, /^\d+$/, 'failed-readiness fixture recorded its server pid');
  const failedServerAlive = spawnSync(BASH, ['-lc', `kill -0 ${failedServerPid} 2>/dev/null`]);
  assert.notEqual(failedServerAlive.status, 0, 'failed readiness stops and reaps the owned server');
  assert.match(
    fs.readFileSync(path.join(tmp, 'server-failure', 'runner.log'), 'utf8'),
    /FAIL\(server\)/,
    'failed readiness is visible instead of leaving an indefinite skeleton or process',
  );
  brokerForceStopResult = await runBrokerForceStopFixture();
  assert.match(
    `${brokerForceStopResult.stdout || ''}\n${brokerForceStopResult.stderr || ''}`,
    /forced-stop-elapsed=/,
    'the actual broker force-stops a resistant child tree after its bounded grace window',
  );
  abruptBrokerDeathResult = await runAbruptBrokerDeathFixture();
  assert.match(
    `${abruptBrokerDeathResult.stdout || ''}\n${abruptBrokerDeathResult.stderr || ''}`,
    /broker-abrupt-kill/,
    'an actual broker crash after READY is driven and observed',
  );
  windowsGuardCrashResult = await runWindowsGuardCrashFixture();
  posixGuardCrashResult = await runPosixGuardCrashFixture();

  const allRecords = readRecords(capture);
  const descriptorRecords = assertObserved(allRecords, 'descriptor-classification', 'helper:git');
  assert.equal(descriptorRecords.length, 1, 'the distinct-descriptor classifier fixture records one helper boundary');
  assert.equal(descriptorRecords[0].openfd, 1, 'a distinct inherited data descriptor remains visible');
  assert.equal(descriptorRecords[0].openfdnum, 7, 'the classifier identifies the deliberately inherited descriptor');
  assert.equal(descriptorRecords[0].openfdpipe, 1, 'a distinct inherited pipe remains classified as a pipe');
  assert.equal(descriptorRecords[0].openfdreg, 1, 'a distinct inherited file remains classified as a regular file');
  assert.equal(
    descriptorRecords[0].openfdsamestdio,
    1,
    'an opposite-access descriptor sharing the stdout pipe inode remains visible',
  );
  const records = allRecords.filter(record => record.run !== 'descriptor-classification');
  assertBoundaryRecords(records);

  for (const subject of [
    'node:scenario',
    'node:master',
    'node:staff-only',
    'node:calendar',
    'node:cleanup',
    'node:unit',
    'server:readiness',
    'helper:rm',
    'helper:git',
  ]) assertObserved(records, 'direct', subject);
  assert.equal(
    records.some(record => record.subject === 'helper:log'),
    false,
    'runner and cron logging stay inside Bash and launch no tee helper',
  );
  assert.equal(
    assertObserved(records, 'direct', 'helper:git').length,
    3,
    'the report path invokes only its expected Git add, diff, and push helpers',
  );
  assert.equal(
    records.some(record => record.run !== 'direct' && record.subject === 'helper:git'),
    false,
    'runner and cron startup launch no Git helper inside command substitution',
  );
  assert.equal(
    records.some(record => record.subject === 'wrapper:timeout'),
    false,
    'an external timeout wrapper must not sit between the broker and operative Node',
  );
  assertObserved(records, 'cron', 'wrapper:env');
  assert.equal(
    records.some(record => record.run === 'cron' && record.subject === 'wrapper:cron-bash'),
    false,
    'cron must hand the issuer descriptor directly to the final Bash broker',
  );
  assert.equal(
    records.some(record => record.subject === 'helper:dirname'),
    false,
    'runner and cron resolve their checked-in root without launching an unrelated dirname helper',
  );
  assertObserved(records, 'cron', 'node:sxr-client-persist');
  assertObserved(records, 'signal', 'node:sxr-client-persist');
  assertObserved(records, 'cron-signal', 'node:unknown-manual');
  assertObserved(records, 'stop', 'node:unknown-manual');
  assertObserved(records, 'low-fd', 'node:sxr-client-persist');
  if (process.platform === 'win32') {
    assertObserved(records, 'native-path', 'node:unknown-manual');
    assertObserved(records, 'mixed-case', 'node:sxr-client-persist');
  }
  assertObserved(records, 'launch-signal', 'timer:deadline');
  assertObserved(records, 'timeout', 'node:unknown-manual');
  assertObserved(records, 'timeout', 'timer:deadline');
  assertObserved(records, 'timeout', 'timer:grace');
  assertObserved(records, 'command-root-exit', 'node:sxr-client-persist');
  assertObserved(records, 'command-root-exit', 'timer:grace');
  assertObserved(records, 'zero-timeout', 'node:unknown-manual');
  assertObserved(records, 'command-124', 'node:unknown-manual');
  assertObserved(records, 'timer-failure', 'node:unknown-manual');
  assertObserved(records, 'server-failure', 'server:python');
  assert.equal(
    records.some(record => record.run === 'zero-timeout' && record.subject === 'timer:deadline'),
    false,
    'COMMAND_TIMEOUT_SECONDS=0 launches no timer process',
  );
  assert.equal(
    records.some(record => record.run === 'command-124' && record.subject === 'timer:grace'),
    false,
    'an operative command exit 124 is preserved and is not mistaken for timer expiry',
  );
  assert.equal(
    records.some(record => record.run === 'missing' && record.subject === 'node:sxr-client-persist'),
    false,
    'a protected final Node process must not launch without the private issuer',
  );
  assert.equal(
    records.some(record => record.subject === 'startup:bash-env'),
    false,
    'the supported Node entry must scrub BASH_ENV before credential-bearing Bash startup',
  );
  const missingIssuerDurable = [
    missingIssuerResult.stdout,
    missingIssuerResult.stderr,
    ...fs.readdirSync(path.join(tmp, 'missing', 'out'))
      .map(file => fs.readFileSync(path.join(tmp, 'missing', 'out', file), 'utf8')),
  ].join('\n');
  assert.match(
    missingIssuerDurable,
    /REFUSED: protected TEST-client issuer unavailable/,
    'a missing issuer fails closed with a visible refusal',
  );
  const timeoutDurable = [
    timeoutResult.stdout,
    timeoutResult.stderr,
    commandRootExitResult.stdout,
    commandRootExitResult.stderr,
    signalResult.stdout,
    signalResult.stderr,
    cronSignalResult.stdout,
    cronSignalResult.stderr,
    fs.readFileSync(path.join(tmp, 'timeout', 'runner.log'), 'utf8'),
  ].join('\n');
  assert.match(
    timeoutDurable,
    /FAIL\(124\)/,
    'the credential-free parent watchdog preserves the bounded timeout result',
  );
  const command124Durable = [
    fs.readFileSync(path.join(tmp, 'command-124', 'runner.log'), 'utf8'),
    ...fs.readdirSync(path.join(tmp, 'command-124', 'out'))
      .map(file => fs.readFileSync(path.join(tmp, 'command-124', 'out', file), 'utf8')),
  ].join('\n');
  assert.match(command124Durable, /FAIL\(124\)/, 'an operative command exit 124 remains its exact result');
  assert.match(command124Durable, /command-exit-124/, 'the operative 124 output remains durable');
  const timerFailureDurable = [
    timerFailureResult.stdout,
    timerFailureResult.stderr,
    fs.readFileSync(path.join(tmp, 'timer-failure', 'runner.log'), 'utf8'),
    ...fs.readdirSync(path.join(tmp, 'timer-failure', 'out'))
      .map(file => fs.readFileSync(path.join(tmp, 'timer-failure', 'out', file), 'utf8')),
  ].join('\n');
  assert.match(
    timerFailureDurable,
    /REFUSED: credential-free timeout timer failed/,
    'timer infrastructure failure is visible instead of masquerading as timeout',
  );
  assert.match(timerFailureDurable, /FAIL\(125\)/, 'timer infrastructure failure has a distinct exit class');

  const publicOutput = [
    directResult.stdout,
    directResult.stderr,
    cronResult.stdout,
    cronResult.stderr,
    missingIssuerResult.stdout,
    missingIssuerResult.stderr,
    timeoutResult.stdout,
    timeoutResult.stderr,
    commandRootExitResult.stdout,
    commandRootExitResult.stderr,
    signalResult.stdout,
    signalResult.stderr,
    cronSignalResult.stdout,
    cronSignalResult.stderr,
    stopResult.stdout,
    stopResult.stderr,
    lowFdResult.stdout,
    lowFdResult.stderr,
    launchSignalResult.stdout,
    launchSignalResult.stderr,
    zeroTimeoutResult.stdout,
    zeroTimeoutResult.stderr,
    command124Result.stdout,
    command124Result.stderr,
    timerFailureResult.stdout,
    timerFailureResult.stderr,
    nodeOptionsResult.stdout,
    nodeOptionsResult.stderr,
    loaderControlResult.stdout,
    loaderControlResult.stderr,
    nativePathResult && nativePathResult.stdout,
    nativePathResult && nativePathResult.stderr,
    mixedCaseResult && mixedCaseResult.stdout,
    mixedCaseResult && mixedCaseResult.stderr,
    serverFailureResult.stdout,
    serverFailureResult.stderr,
    earlyBrokerSignalResult.stdout,
    earlyBrokerSignalResult.stderr,
    ownedCleanupResult.stdout,
    ownedCleanupResult.stderr,
    brokerForceStopResult.stdout,
    brokerForceStopResult.stderr,
    abruptBrokerDeathResult.stdout,
    abruptBrokerDeathResult.stderr,
    windowsJobRootExitResult && windowsJobRootExitResult.stdout,
    windowsJobRootExitResult && windowsJobRootExitResult.stderr,
    runtimeRootExitResult.stdout,
    runtimeRootExitResult.stderr,
    windowsHelperRootRefusalResult && windowsHelperRootRefusalResult.stdout,
    windowsHelperRootRefusalResult && windowsHelperRootRefusalResult.stderr,
    windowsContainmentRefusalResult && windowsContainmentRefusalResult.stdout,
    windowsContainmentRefusalResult && windowsContainmentRefusalResult.stderr,
    windowsGuardCrashResult && windowsGuardCrashResult.stdout,
    windowsGuardCrashResult && windowsGuardCrashResult.stderr,
    posixGuardCrashResult && posixGuardCrashResult.stdout,
    posixGuardCrashResult && posixGuardCrashResult.stderr,
  ]
    .filter(Boolean)
    .join('\n');
  assert.equal(publicOutput.includes(STAFF_MARKER), false, 'staff marker leaked to runner/cron output');
  assert.equal(publicOutput.includes(LEGACY_MARKER), false, 'legacy marker leaked to runner/cron output');
  assert.equal(publicOutput.includes(INJECTION_MARKER), false, 'an inherited interpreter control executed');
  for (const run of [
    'direct', 'cron', 'missing', 'timeout', 'command-root-exit', 'signal', 'cron-signal', 'stop', 'low-fd', 'launch-signal',
    'zero-timeout', 'command-124', 'timer-failure', 'node-options', 'loader-control', 'native-path', 'mixed-case',
    'server-failure', 'broker-early-signal', 'broker-force-stop', 'broker-abrupt',
    'windows-root-exit', 'runtime-root-exit', 'windows-helper-root-refusal', 'windows-containment-refusal',
    'windows-guard-crash', 'posix-guard-crash',
  ]) {
    const runDir = path.join(tmp, run);
    const files = [path.join(runDir, 'runner.log')];
    const out = path.join(runDir, 'out');
    if (fs.existsSync(out)) {
      for (const file of fs.readdirSync(out)) files.push(path.join(out, file));
    }
    const durableOutput = files.filter(fs.existsSync).map(file => fs.readFileSync(file, 'utf8')).join('\n');
    assert.equal(durableOutput.includes(STAFF_MARKER), false, `${run} logs leaked the staff marker`);
    assert.equal(durableOutput.includes(LEGACY_MARKER), false, `${run} logs leaked the legacy marker`);
    assert.equal(durableOutput.includes(INJECTION_MARKER), false, `${run} logs contain startup-injection output`);
  }
  assert.equal(
    runnerUsesRegistry,
    true,
    'the Bash broker must ask the exported JS registry instead of maintaining a second capability allowlist',
  );
  assert.equal(
    capableProbeMentions,
    1,
    'the capable probe may appear in the schedule, but not in a duplicate Bash credential allowlist',
  );
  guardPassed = true;
  } finally {
    process.off('SIGINT', onGuardInt);
    process.off('SIGTERM', onGuardTerm);
    if (cancellationPromise) await cancellationPromise;
    const teardownConfirmed = await teardownActiveFixtures();
    if (guardPassed && teardownConfirmed && !process.env.F176_KEEP_FIXTURE) {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } else {
      console.error(`F176 fixture retained at ${tmp}`);
      if (!teardownConfirmed) console.error('F176 fixture teardown was not confirmed');
    }
  }

  console.log('overnight runner client-entry boundary: actual runner + cron credential matrix passed');
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
