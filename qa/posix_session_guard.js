'use strict';

// Credential-free POSIX session guardian. The caller must place the protected
// target in a distinct session before starting this process. Shutdown always
// targets live session membership; descendant PIDs are never enumerated or
// retained.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HELPER_TIMEOUT_MS = 2_000;
const HELPER_REAP_MS = 1_000;
const SIGNAL_GRACE_MS = 30_000;
const KILL_CONFIRM_MS = 5_000;
const POLL_MS = 50;
const MAX_HELPER_OUTPUT = 4 * 1024;
const MAX_CONTROL_INPUT = 64;

const FORBIDDEN_ENV_NAMES = new Set([
  'SYNCVIEW_STAFF_KEY',
  'SYNCVIEW_TEST_CLIENT_TOKEN',
  'SYNCVIEW_STAFF_KEY_FD',
  '_OVN_STAFF_ISSUER',
  '_OVN_STAFF_FD',
  'NODE_OPTIONS',
  'NODE_PATH',
  'LD_PRELOAD',
  'LD_AUDIT',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'BASH_ENV',
  'ENV',
  'SHELLOPTS',
  'BASHOPTS',
  'BASH_COMPAT',
  'BASH_LOADABLES_PATH',
  'BASH_XTRACEFD',
  'PS4',
  'PROMPT_COMMAND',
  'CDPATH',
  'GLOBIGNORE',
  'POSIXLY_CORRECT',
]);

const HELPER_ENV = Object.freeze({
  PATH: '/usr/bin:/bin',
  LANG: 'C',
  LC_ALL: 'C',
});

let terminalStateWritten = false;

// A lost status reader must not prevent the control-pipe EOF path from
// containing the watched session.
process.stdout.on('error', () => {});

function writeState(state, terminal = false) {
  if (terminal && terminalStateWritten) return;
  if (terminal) terminalStateWritten = true;
  process.stdout.write(`${state}\n`);
}

function environmentIsClean() {
  return !Object.keys(process.env).some(name => (
    FORBIDDEN_ENV_NAMES.has(name.toUpperCase())
    || /^BASH_FUNC_.*%%$/i.test(name)
  ));
}

function fixedTool(name, candidates) {
  const fixedDirectories = new Set(['/usr/bin', '/bin']);
  // Debian/Ubuntu ships /usr/bin/pkill as a root-owned link to the shared
  // /usr/bin/pgrep binary. Keep the checked pkill path as argv[0] so the
  // multi-call binary selects kill semantics; only its fixed system target is
  // allowed to differ by that reviewed name.
  const allowedResolvedNames = name === 'pkill' ? new Set(['pkill', 'pgrep']) : new Set([name]);
  for (const candidate of candidates) {
    try {
      if (path.basename(candidate) !== name || !fixedDirectories.has(path.dirname(candidate))) continue;
      fs.accessSync(candidate, fs.constants.X_OK);
      const resolved = fs.realpathSync(candidate);
      if (allowedResolvedNames.has(path.basename(resolved)) && fixedDirectories.has(path.dirname(resolved))) {
        return candidate;
      }
    } catch {
      // Keep checking only the fixed system locations.
    }
  }
  return '';
}

function parseSid(value) {
  if (!/^\d+$/.test(String(value || ''))) return 0;
  const sid = Number(value);
  return Number.isSafeInteger(sid) && sid > 1 && sid <= 0x7fffffff ? sid : 0;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runBoundedHelper(executable, args, timeoutMs = HELPER_TIMEOUT_MS) {
  return new Promise(resolve => {
    let child;
    let stdout = '';
    let finished = false;
    let deadline = null;
    let reapDeadline = null;
    let failure = '';

    const finish = (status, signal) => {
      if (finished) return;
      finished = true;
      if (deadline) clearTimeout(deadline);
      if (reapDeadline) clearTimeout(reapDeadline);
      resolve({ status, signal, stdout, failure });
    };

    const stop = reason => {
      if (!failure) failure = reason;
      try { child.kill('SIGKILL'); } catch {}
      if (!reapDeadline) {
        reapDeadline = setTimeout(() => {
          if (child.stdout) child.stdout.destroy();
          child.unref();
          finish(null, null);
        }, HELPER_REAP_MS);
      }
    };

    try {
      child = spawn(executable, args, {
        env: HELPER_ENV,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      resolve({ status: null, signal: null, stdout: '', failure: 'spawn' });
      return;
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length > MAX_HELPER_OUTPUT) stop('output');
    });
    child.once('error', () => {
      if (!failure) failure = 'spawn';
    });
    child.once('close', (status, signal) => finish(status, signal));
    deadline = setTimeout(() => stop('timeout'), timeoutMs);
  });
}

let PS = '';
let PKILL = '';

async function processSessionId(pid) {
  const result = await runBoundedHelper(PS, ['-o', 'sid=', '-p', String(pid)]);
  if (result.failure || result.status !== 0) throw new Error('ps');
  const values = result.stdout.trim().split(/\s+/).filter(Boolean);
  if (values.length !== 1 || !/^\d+$/.test(values[0])) throw new Error('ps-output');
  return Number(values[0]);
}

async function sessionHasMembers(sid) {
  const result = await runBoundedHelper(PKILL, ['-0', '-s', String(sid)]);
  if (result.failure) throw new Error('pkill-probe');
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error('pkill-probe-status');
}

async function signalSession(sid, signal) {
  const result = await runBoundedHelper(PKILL, [`-${signal}`, '-s', String(sid)]);
  if (result.failure) throw new Error('pkill-signal');
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error('pkill-signal-status');
}

async function waitForEmptySession(sid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (!await sessionHasMembers(sid)) return true;
    if (Date.now() >= deadline) break;
    await delay(POLL_MS);
  } while (true);
  return !await sessionHasMembers(sid);
}

async function stopSession(sid, initialSignal) {
  if (!await sessionHasMembers(sid)) return true;
  await signalSession(sid, initialSignal);
  if (await waitForEmptySession(sid, SIGNAL_GRACE_MS)) return true;
  await signalSession(sid, 'KILL');
  return waitForEmptySession(sid, KILL_CONFIRM_MS);
}

async function verifyLiveSessionLeader(sid) {
  const leaderSid = await processSessionId(sid);
  if (leaderSid !== sid) return false;
  const guardianSid = await processSessionId(process.pid);
  if (guardianSid === sid) return false;
  return sessionHasMembers(sid);
}

async function failClosed(sid) {
  try {
    if (await sessionHasMembers(sid)) {
      await signalSession(sid, 'KILL');
      await waitForEmptySession(sid, KILL_CONFIRM_MS);
    }
  } catch {
    // The terminal ERROR state is the only public diagnostic.
  }
  writeState('ERROR', true);
  return 70;
}

async function handleWatchCommand(sid, command) {
  try {
    if (command === 'COMPLETE') {
      if (!await sessionHasMembers(sid)) {
        writeState('CLEAN', true);
        return 0;
      }
      await signalSession(sid, 'KILL');
      await waitForEmptySession(sid, KILL_CONFIRM_MS);
      writeState('STRAGGLERS', true);
      return 75;
    }

    if (command === 'INT' || command === 'TERM' || command === 'EOF') {
      const clean = await stopSession(sid, command === 'INT' ? 'INT' : 'TERM');
      writeState(clean ? 'CLEAN' : 'STRAGGLERS', true);
      return clean ? 0 : 75;
    }
  } catch {
    return failClosed(sid);
  }
  return failClosed(sid);
}

async function watchSession(sid) {
  let pendingSignal = '';
  let dispatch = command => { if (!pendingSignal) pendingSignal = command; };
  const onSigint = () => dispatch('INT');
  const onSigterm = () => dispatch('TERM');
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  let verified = false;
  try {
    verified = await verifyLiveSessionLeader(sid);
  } catch {
    verified = false;
  }
  if (!verified) {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    writeState('ERROR', true);
    return 70;
  }

  writeState('READY');
  return new Promise(resolve => {
    let terminal = false;
    let input = '';

    const cleanup = () => {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
      process.stdin.off('data', onData);
      process.stdin.off('end', onEnd);
      process.stdin.off('error', onError);
      process.stdin.pause();
    };

    const trigger = command => {
      if (terminal) return;
      terminal = true;
      cleanup();
      void handleWatchCommand(sid, command)
        .then(resolve)
        .catch(() => failClosed(sid).then(resolve));
    };
    dispatch = trigger;

    const acceptLine = line => {
      const command = line.trim();
      if (!command) return;
      trigger(['INT', 'TERM', 'COMPLETE'].includes(command) ? command : 'INVALID');
    };

    function onData(chunk) {
      input += chunk;
      if (input.length > MAX_CONTROL_INPUT) {
        trigger('INVALID');
        return;
      }
      const newline = input.indexOf('\n');
      if (newline === -1) return;
      const line = input.slice(0, newline).replace(/\r$/, '');
      input = input.slice(newline + 1);
      acceptLine(line);
    }

    function onEnd() {
      const final = input.trim();
      if (final) acceptLine(final);
      else trigger('EOF');
    }

    function onError() {
      trigger('INVALID');
    }

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onData);
    process.stdin.once('end', onEnd);
    process.stdin.once('error', onError);
    process.stdin.resume();
    if (pendingSignal) trigger(pendingSignal);
  });
}

async function killSession(sid) {
  try {
    const guardianSid = await processSessionId(process.pid);
    if (guardianSid === sid) {
      writeState('ERROR', true);
      return 70;
    }
    if (!await sessionHasMembers(sid)) {
      writeState('CLEAN', true);
      return 0;
    }
    await signalSession(sid, 'KILL');
    const clean = await waitForEmptySession(sid, KILL_CONFIRM_MS);
    writeState(clean ? 'CLEAN' : 'STRAGGLERS', true);
    return clean ? 0 : 75;
  } catch {
    writeState('ERROR', true);
    return 70;
  }
}

async function main() {
  if (process.platform === 'win32' || !environmentIsClean()) {
    writeState('ERROR', true);
    return 70;
  }
  if (process.argv.length !== 4 || !['watch', 'kill'].includes(process.argv[2])) {
    writeState('ERROR', true);
    return 64;
  }
  const sid = parseSid(process.argv[3]);
  if (!sid) {
    writeState('ERROR', true);
    return 64;
  }

  PS = fixedTool('ps', ['/usr/bin/ps', '/bin/ps']);
  PKILL = fixedTool('pkill', ['/usr/bin/pkill', '/bin/pkill']);
  if (!PS || !PKILL) {
    writeState('ERROR', true);
    return 70;
  }

  return process.argv[2] === 'watch' ? watchSession(sid) : killSession(sid);
}

main()
  .then(code => { process.exitCode = code; })
  .catch(() => {
    writeState('ERROR', true);
    process.exitCode = 70;
  });
