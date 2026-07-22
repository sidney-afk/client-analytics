'use strict';

// Non-Bash credential broker for the unattended runner. Bash evaluates
// startup controls before a script reaches line 1, so protected invocations
// enter here: Node captures the issuer, scrubs inherited interpreter controls,
// then releases one private pipe only after the platform process-tree
// guardian contains a blocked launch target.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const WINDOWS_SYSTEM_ROOT = 'C:\\Windows';
const WINDOWS_PROGRAM_FILES = 'C:\\Program Files';
const WINDOWS_PROGRAM_FILES_X86 = 'C:\\Program Files (x86)';
const WINDOWS_JOB_GUARD = path.join(ROOT, 'qa', 'windows_job_guard.ps1');
const WINDOWS_JOB_WORKER = path.join(ROOT, 'qa', 'windows_job_worker.js');
const WINDOWS_BASH_SUPERVISOR = path.join(ROOT, 'qa', 'windows_bash_supervisor.sh');
const POSIX_SESSION_GUARD = path.join(ROOT, 'qa', 'posix_session_guard.js');
const WINDOWS_GUARD_READY_TIMEOUT_MS = 60_000;
const mode = process.argv[2] || 'runner';
const scripts = {
  runner: path.join(ROOT, 'qa', 'overnight_runner.sh'),
  cron: path.join(ROOT, 'qa', 'overnight_cron_chunk.sh'),
};

if (!Object.hasOwn(scripts, mode) || process.argv.length !== 3) {
  console.error('REFUSED: expected overnight entry mode runner or cron');
  process.exit(64);
}

function environmentValue(source, wanted) {
  if (process.platform !== 'win32') return source[wanted];
  const match = Object.keys(source).find(name => name.toUpperCase() === wanted.toUpperCase());
  return match ? source[match] : undefined;
}

function normalizedWindowsPath(value) {
  return path.win32.normalize(String(value || '')).replace(/[\\/]+$/, '').toLowerCase();
}

function windowsHelperRootsAreTrusted() {
  if (process.platform !== 'win32') return true;
  const expectations = [
    ['SystemRoot', WINDOWS_SYSTEM_ROOT],
    ['WINDIR', WINDOWS_SYSTEM_ROOT],
    ['ProgramFiles', WINDOWS_PROGRAM_FILES],
    ['ProgramW6432', WINDOWS_PROGRAM_FILES],
    ['ProgramFiles(x86)', WINDOWS_PROGRAM_FILES_X86],
  ];
  return expectations.every(([name, expected]) => {
    const value = environmentValue(process.env, name);
    return value === undefined || normalizedWindowsPath(value) === normalizedWindowsPath(expected);
  });
}

if (!windowsHelperRootsAreTrusted()) {
  console.error('REFUSED: Windows protected helper roots are not trusted');
  process.exit(78);
}

// These controls are interpreted before this file executes. Their absence is
// a caller/scheduler trust precondition; this check is a visible diagnostic,
// not a claim that already-loaded startup code can be undone in-process.
const PRESTART_CONTROL_NAMES = Object.freeze([
  'NODE_OPTIONS',
  'LD_PRELOAD',
  'LD_AUDIT',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
]);
const inheritedPrestartControl = PRESTART_CONTROL_NAMES.find(name => (
  String(environmentValue(process.env, name) || '').trim()
));
if (inheritedPrestartControl) {
  console.error(`REFUSED: clear ${inheritedPrestartControl} before protected overnight entry`);
  process.exit(78);
}

const SCRUBBED_STARTUP_NAMES = new Set([
  ...PRESTART_CONTROL_NAMES,
  'SYNCVIEW_STAFF_KEY',
  'SYNCVIEW_TEST_CLIENT_TOKEN',
  'SYNCVIEW_STAFF_KEY_FD',
  '_OVN_STAFF_ISSUER',
  '_OVN_STAFF_FD',
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
  'NODE_PATH',
]);

function scrubEnvironment(source) {
  const clean = { ...source };
  for (const name of Object.keys(clean)) {
    const folded = name.toUpperCase();
    if (SCRUBBED_STARTUP_NAMES.has(folded) || /^BASH_FUNC_.*%%$/i.test(name)) {
      delete clean[name];
    }
  }
  return clean;
}

let issuer = String(environmentValue(process.env, 'SYNCVIEW_STAFF_KEY') || '');
const childEnv = scrubEnvironment(process.env);
const callerPath = String(environmentValue(process.env, 'PATH') || '');
for (const name of Object.keys(childEnv)) {
  if (name.toUpperCase() === 'PATH') delete childEnv[name];
}
childEnv.PATH = callerPath;
let bash = '';
let child = null;
let pendingSignal = '';
let forwardedSignal = '';
let forceTimer = null;
let shutdownPipe = null;
let shutdownPipeReady = false;
let gatePipe = null;
let containmentTimer = null;
let sessionGuard = null;
let sessionGuardReady = false;
let sessionGuardClosed = false;
let sessionGuardResult = null;
let sessionGuardState = '';
let sessionCleanupTimer = null;
let runnerResult = null;
let windowsGuard = null;
let windowsGuardPipe = null;
let windowsGuardReady = false;
let windowsGuardClosed = false;
let windowsGuardResult = null;
let windowsGuardState = '';
let windowsFinishRun = null;
let containmentFailed = false;
const forceStops = new Set();

function removeSignalHandlers() {
  process.off('SIGINT', onInt);
  process.off('SIGTERM', onTerm);
}

function controlEnvironment() {
  const clean = scrubEnvironment(childEnv);
  delete clean.SYNCVIEW_STAFF_KEY_FD;
  delete clean.MSYS2_ARG_CONV_EXCL;
  return clean;
}

function windowsGuardEnvironment() {
  const clean = {
    SystemRoot: WINDOWS_SYSTEM_ROOT,
    WINDIR: WINDOWS_SYSTEM_ROOT,
    COMSPEC: path.join(WINDOWS_SYSTEM_ROOT, 'System32', 'cmd.exe'),
    PATH: `${path.join(WINDOWS_SYSTEM_ROOT, 'System32')};${WINDOWS_SYSTEM_ROOT}`,
  };
  for (const name of ['TEMP', 'TMP']) {
    const value = environmentValue(process.env, name);
    if (value) clean[name] = String(value);
  }
  return clean;
}

function posixGuardEnvironment() {
  return { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' };
}

function childAlive(target) {
  if (!target || !target.pid || target.exitCode !== null || target.signalCode !== null) return false;
  try {
    process.kill(target.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function runBoundedHelper(executable, args, options, timeoutMs, onDone) {
  let helper = null;
  let timer = null;
  let settled = false;
  let stdout = '';
  const finish = (ok, reason) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    onDone(ok, reason, stdout);
  };

  try {
    helper = spawn(executable, args, options);
  } catch {
    finish(false, 'spawn');
    return;
  }
  if (helper.stdout) {
    helper.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length > 1024 * 1024) {
        try { helper.kill('SIGKILL'); } catch {}
        helper.stdout.destroy();
        finish(false, 'output-limit');
      }
    });
  }
  helper.once('error', () => finish(false, 'error'));
  helper.once('close', code => finish(code === 0, `exit-${code}`));
  timer = setTimeout(() => {
    try { helper.kill('SIGKILL'); } catch {}
    if (helper.stdout) helper.stdout.destroy();
    if (helper.stderr) helper.stderr.destroy();
    helper.unref();
    finish(false, 'timeout');
  }, timeoutMs);
}

function forceStopTree(target = child) {
  if (!target || !target.pid || forceStops.has(target.pid)) return;
  const ownedPosixSession = process.platform !== 'win32' && sessionGuardReady && target === child;
  if (!ownedPosixSession && !childAlive(target)) return;
  const targetPid = target.pid;
  forceStops.add(targetPid);
  const complete = () => forceStops.delete(targetPid);
  if (process.platform === 'win32') {
    const taskkill = path.join(WINDOWS_SYSTEM_ROOT, 'System32', 'taskkill.exe');
    runBoundedHelper(taskkill, ['/PID', String(targetPid), '/T', '/F'], {
      env: controlEnvironment(),
      stdio: 'ignore',
      windowsHide: true,
    }, 5_000, (ok, reason) => {
      if (!ok && childAlive(target)) {
        try { target.kill('SIGKILL'); } catch {}
        console.error(`REFUSED: overnight process-tree cleanup helper failed (${reason})`);
      }
      complete();
    });
    return;
  }
  if (sessionGuardReady && target === child) {
    runBoundedHelper(process.execPath, [POSIX_SESSION_GUARD, 'kill', String(targetPid)], {
      cwd: ROOT,
      env: posixGuardEnvironment(),
      stdio: 'ignore',
      detached: true,
    }, 20_000, (ok, reason) => {
      if (!ok) console.error(`REFUSED: POSIX session cleanup failed (${reason})`);
      complete();
    });
    return;
  }
  try { process.kill(-targetPid, 'SIGKILL'); }
  catch { try { target.kill('SIGKILL'); } catch {} }
  complete();
}

function forward(signal) {
  pendingSignal = signal;
  if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (forwardedSignal === signal) return;
  const target = child;

  if (!forceTimer) {
    forceTimer = setTimeout(() => forceStopTree(target), 35_000);
  }

  if (shutdownPipe && !shutdownPipeReady && process.platform === 'win32') return;
  forwardedSignal = signal;

  if (shutdownPipe && shutdownPipeReady && !shutdownPipe.destroyed) {
    const pipe = shutdownPipe;
    pipe.once('error', () => {
      if (childAlive(target)) forceStopTree(target);
    });
    pipe.end(`${signal === 'SIGINT' ? 'INT' : 'TERM'}\n`);
  } else if (process.platform === 'win32') {
    try { target.kill('SIGKILL'); }
    catch { if (childAlive(target)) forceStopTree(target); }
  } else {
    try { process.kill(-target.pid, signal); }
    catch { target.kill(signal); }
  }
}

function onInt() { forward('SIGINT'); }
function onTerm() { forward('SIGTERM'); }

// Register before Bash discovery or the asynchronous capability preflight. A
// signal received before a child exists is retained and forwarded on spawn.
process.on('SIGINT', onInt);
process.on('SIGTERM', onTerm);

function existing(candidate) {
  if (!candidate || !path.isAbsolute(candidate)) return '';
  try {
    const resolved = fs.realpathSync(candidate);
    return /(?:^|[\\/])bash(?:\.exe)?$/i.test(resolved) ? resolved : '';
  } catch {
    return '';
  }
}

function resolveBash() {
  const candidates = process.platform === 'win32'
    ? [
        path.join(WINDOWS_PROGRAM_FILES, 'Git', 'bin', 'bash.exe'),
        path.join(WINDOWS_PROGRAM_FILES, 'Git', 'usr', 'bin', 'bash.exe'),
        path.join(WINDOWS_PROGRAM_FILES_X86, 'Git', 'bin', 'bash.exe'),
      ]
    : ['/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/usr/bin/bash', '/bin/bash'];
  for (const candidate of candidates) {
    const resolved = existing(candidate);
    if (resolved) return resolved;
  }
  return '';
}

function bashPath(candidate) {
  const normalized = String(candidate || '').replace(/\\/g, '/');
  const drive = normalized.match(/^([A-Za-z]):\/(.*)$/);
  return drive ? `/${drive[1].toLowerCase()}/${drive[2]}` : normalized;
}

function bashPathList(value) {
  const raw = String(value || '');
  let converted = raw;
  if (process.platform === 'win32' && raw.includes(';')) {
    converted = raw.split(';').filter(Boolean).map(bashPath).join(':');
  }
  if (process.platform !== 'win32') return converted;
  const entries = converted.split(':').filter(Boolean);
  for (const required of ['/mingw64/bin', '/usr/bin', '/bin']) {
    if (!entries.includes(required)) entries.push(required);
  }
  return entries.join(':');
}

let capabilityTimer = null;
let settleTimer = null;
let brokerFinished = false;

function finish(code) {
  if (brokerFinished) return;
  brokerFinished = true;
  if (forceTimer) clearTimeout(forceTimer);
  if (capabilityTimer) clearTimeout(capabilityTimer);
  if (settleTimer) clearTimeout(settleTimer);
  if (containmentTimer) clearTimeout(containmentTimer);
  if (sessionCleanupTimer) clearTimeout(sessionCleanupTimer);
  issuer = '';
  shutdownPipeReady = false;
  removeSignalHandlers();
  process.exitCode = code;
}

function refuse(message) {
  console.error(message);
  finish(69);
}

function signalResult(signal) {
  return signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1;
}

function exitResult(code, signal) {
  return Number.isInteger(code) ? code : signalResult(signal);
}

function finishPosixRun() {
  if (!runnerResult || !sessionGuardClosed || brokerFinished) return;
  if (sessionCleanupTimer) clearTimeout(sessionCleanupTimer);
  sessionCleanupTimer = null;
  shutdownPipe = null;
  sessionGuard = null;
  const guardFailed = !sessionGuardResult
    || sessionGuardResult.code !== 0
    || sessionGuardResult.signal
    || sessionGuardState === 'ERROR'
    || sessionGuardState === 'STRAGGLERS';
  if (guardFailed || containmentFailed) {
    if (sessionGuardState === 'STRAGGLERS') {
      console.error('REFUSED: protected overnight session left descendant processes');
    } else if (!containmentFailed) {
      console.error('REFUSED: POSIX session containment cleanup failed');
    }
    finish(pendingSignal ? signalResult(pendingSignal) : 70);
    return;
  }
  finish(runnerResult.result);
}

function closeRunnerGates(runner, release) {
  const gate = gatePipe;
  gatePipe = null;
  const openGate = () => {
    if (!gate || gate.destroyed) return;
    gate.once('error', () => {
      containmentFailed = true;
      forceStopTree(runner);
    });
    gate.end(release ? 'GO\n' : undefined);
  };
  if (runner.stdin && !runner.stdin.destroyed) {
    runner.stdin.once('error', () => {
      if (release) {
        containmentFailed = true;
        forceStopTree(runner);
      }
    });
    if (release && issuer) {
      const delivered = issuer;
      issuer = '';
      runner.stdin.end(`${delivered}\n`, openGate);
      return;
    }
    runner.stdin.end();
  }
  issuer = '';
  openGate();
}

function failPosixContainment(runner, message) {
  if (!containmentFailed) console.error(message);
  containmentFailed = true;
  if (containmentTimer) clearTimeout(containmentTimer);
  containmentTimer = null;
  closeRunnerGates(runner, false);
  if (sessionGuard && !sessionGuard.killed && !sessionGuardClosed) {
    try { sessionGuard.kill('SIGKILL'); } catch {}
  }
  forceStopTree(runner);
}

function launchPosixSessionGuard(runner) {
  let output = '';
  let buffered = '';
  try {
    sessionGuard = spawn(process.execPath, [POSIX_SESSION_GUARD, 'watch', String(runner.pid)], {
      cwd: ROOT,
      env: posixGuardEnvironment(),
      stdio: ['pipe', 'pipe', 'inherit'],
      windowsHide: true,
      detached: true,
    });
  } catch {
    failPosixContainment(runner, 'REFUSED: POSIX session containment failed to start');
    return;
  }
  shutdownPipe = sessionGuard.stdin;
  shutdownPipeReady = true;
  shutdownPipe.on('error', () => {
    if (!sessionGuardClosed && childAlive(runner)) {
      failPosixContainment(runner, 'REFUSED: POSIX session containment control failed');
    }
  });
  sessionGuard.stdout.setEncoding('utf8');
  sessionGuard.stdout.on('data', chunk => {
    if (brokerFinished) return;
    output += chunk;
    buffered += chunk;
    if (output.length > 512) {
      failPosixContainment(runner, 'REFUSED: POSIX session containment returned malformed output');
      return;
    }
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop();
    for (const line of lines) {
      if (line === 'READY' && !sessionGuardReady) {
        sessionGuardReady = true;
        if (containmentTimer) clearTimeout(containmentTimer);
        containmentTimer = null;
        closeRunnerGates(runner, !pendingSignal);
        if (pendingSignal && shutdownPipe && !shutdownPipe.destroyed && !shutdownPipe.writableEnded) {
          shutdownPipe.end(`${pendingSignal === 'SIGINT' ? 'INT' : 'TERM'}\n`);
        }
      } else if (line === 'CLEAN' || line === 'STRAGGLERS' || line === 'ERROR') {
        sessionGuardState = line;
      } else {
        failPosixContainment(runner, 'REFUSED: POSIX session containment returned malformed output');
      }
    }
  });
  sessionGuard.once('error', () => {
    failPosixContainment(runner, 'REFUSED: POSIX session containment failed');
  });
  sessionGuard.once('close', (code, signal) => {
    sessionGuardClosed = true;
    sessionGuardResult = { code, signal };
    if (containmentTimer) clearTimeout(containmentTimer);
    containmentTimer = null;
    if (!sessionGuardReady) {
      failPosixContainment(runner, 'REFUSED: POSIX session containment exited before READY');
    } else if (!runnerResult && !pendingSignal) {
      failPosixContainment(runner, 'REFUSED: POSIX session containment was lost');
    } else if (!runnerResult) {
      sessionCleanupTimer = setTimeout(() => {
        containmentFailed = true;
        forceStopTree(runner);
      }, 10_000);
    }
    finishPosixRun();
  });
  containmentTimer = setTimeout(() => {
    failPosixContainment(runner, 'REFUSED: POSIX session containment READY timed out');
  }, 10_000);
  if (pendingSignal) forward(pendingSignal);
}

function launchWindowsRunnerContainment(runner) {
  const powershell = path.join(
    WINDOWS_SYSTEM_ROOT,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  let output = '';
  let buffered = '';
  let handled = false;
  const finishGuardedRun = () => {
    if (!runnerResult || !windowsGuardClosed || brokerFinished) return;
    if (sessionCleanupTimer) clearTimeout(sessionCleanupTimer);
    sessionCleanupTimer = null;
    const guardFailed = containmentFailed
      || !windowsGuardResult
      || windowsGuardResult.code !== 0
      || windowsGuardResult.signal
      || windowsGuardState !== 'CLEAN';
    if (guardFailed) {
      if (windowsGuardState === 'STRAGGLERS') {
        console.error('REFUSED: protected Windows overnight Job left descendant processes');
      } else if (!containmentFailed) {
        console.error('REFUSED: Windows process-tree containment cleanup failed');
      }
      finish(pendingSignal ? signalResult(pendingSignal) : 70);
      return;
    }
    finish(runnerResult.result);
  };
  const fail = message => {
    if (handled || brokerFinished) return;
    handled = true;
    containmentFailed = true;
    if (containmentTimer) clearTimeout(containmentTimer);
    containmentTimer = null;
    issuer = '';
    if (shutdownPipe && !shutdownPipe.destroyed) shutdownPipe.end();
    if (windowsGuardPipe && !windowsGuardPipe.destroyed) windowsGuardPipe.end();
    shutdownPipeReady = false;
    console.error(message);
    forceStopTree(runner);
    finish(windowsGuardReady ? 70 : 69);
    if (windowsGuard && !windowsGuardReady) {
      if (windowsGuard.stdout) windowsGuard.stdout.destroy();
      setImmediate(() => {
        try { windowsGuard.kill('SIGKILL'); } catch {}
      });
    }
  };

  try {
    windowsGuard = spawn(powershell, [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      WINDOWS_JOB_GUARD,
      '-OwnerProcessId',
      String(process.pid),
      '-ExpectedImagePath',
      fs.realpathSync(process.execPath),
      '-TargetProcessId',
      String(runner.pid),
      '-ExpectedTargetImagePath',
      fs.realpathSync(process.execPath),
    ], {
      cwd: ROOT,
      env: windowsGuardEnvironment(),
      stdio: ['pipe', 'pipe', 'inherit'],
      windowsHide: true,
    });
  } catch {
    fail('REFUSED: Windows process-tree containment failed to start');
    return;
  }

  windowsGuardPipe = windowsGuard.stdin;
  windowsGuardPipe.on('error', () => {
    if (!windowsGuardClosed && !brokerFinished) {
      fail('REFUSED: Windows process-tree containment control failed');
    }
  });
  windowsGuard.stdout.setEncoding('utf8');
  windowsGuard.stdout.on('data', chunk => {
    if (handled || brokerFinished) return;
    output += chunk;
    buffered += chunk;
    if (output.length > 512) {
      fail('REFUSED: Windows process-tree containment returned malformed output');
      return;
    }
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop();
    for (const line of lines) {
      if (line === 'READY' && !windowsGuardReady) {
        windowsGuardReady = true;
        if (containmentTimer) clearTimeout(containmentTimer);
        containmentTimer = null;
        const delivered = issuer;
        issuer = '';
        runner.stdin.write(`${delivered}\n`, () => {
          shutdownPipeReady = true;
          if (pendingSignal) forward(pendingSignal);
        });
      } else if (windowsGuardReady && ['CLEAN', 'STRAGGLERS', 'ERROR'].includes(line)) {
        windowsGuardState = line;
      } else {
        fail('REFUSED: Windows process-tree containment returned malformed output');
      }
    }
  });
  windowsGuard.once('error', () => {
    fail('REFUSED: Windows process-tree containment failed');
  });
  windowsGuard.once('close', (code, signal) => {
    windowsGuardClosed = true;
    windowsGuardResult = { code, signal };
    windowsGuardPipe = null;
    if (containmentTimer) clearTimeout(containmentTimer);
    containmentTimer = null;
    if (!windowsGuardReady) {
      fail('REFUSED: Windows process-tree containment exited before READY');
      return;
    }
    if (!runnerResult) {
      fail('REFUSED: Windows process-tree containment was lost');
      return;
    }
    finishGuardedRun();
  });
  containmentTimer = setTimeout(() => {
    fail('REFUSED: Windows process-tree containment READY timed out');
  }, WINDOWS_GUARD_READY_TIMEOUT_MS);
  windowsFinishRun = finishGuardedRun;
}

function launchRunner() {
  if (brokerFinished) return;
  child = null;
  forwardedSignal = '';
  runnerResult = null;
  sessionGuard = null;
  sessionGuardReady = false;
  sessionGuardClosed = false;
  sessionGuardResult = null;
  sessionGuardState = '';
  windowsGuard = null;
  windowsGuardPipe = null;
  windowsGuardReady = false;
  windowsGuardClosed = false;
  windowsGuardResult = null;
  windowsGuardState = '';
  windowsFinishRun = null;
  containmentFailed = false;
  const isPosix = process.platform !== 'win32';
  const stdio = [isPosix ? (issuer ? 'pipe' : 'ignore') : 'pipe', 'inherit', 'inherit'];
  if (isPosix) stdio.push('pipe');
  if (issuer && isPosix) childEnv.SYNCVIEW_STAFF_KEY_FD = '0';

  // MSYS normally rewrites path-looking argv before Bash receives it. Keep the
  // script and PATH arguments exact, then remove this control before line 1.
  childEnv.MSYS2_ARG_CONV_EXCL = '*';
  const sourceCommand = 'PATH=$1; builtin unset MSYS2_ARG_CONV_EXCL; builtin export PATH; builtin source "$2"';
  const command = 'builtin read -r _ovn_gate <&3 && [[ $_ovn_gate == GO ]] || builtin exit 70; builtin exec 3<&-; ' + sourceCommand;
  const runnerExecutable = isPosix ? bash : process.execPath;
  const runnerArgs = isPosix ? [
    '--noprofile',
    '--norc',
    '-p',
    '-c',
    command,
    'overnight-entry',
    bashPathList(childEnv.PATH),
    bashPath(scripts[mode]),
  ] : [
    WINDOWS_JOB_WORKER,
    fs.realpathSync(bash),
    WINDOWS_BASH_SUPERVISOR,
    scripts[mode],
    bashPathList(childEnv.PATH),
  ];
  const runner = spawn(runnerExecutable, runnerArgs, {
    cwd: ROOT,
    env: childEnv,
    stdio,
    windowsHide: true,
    detached: isPosix,
  });
  child = runner;
  gatePipe = isPosix ? runner.stdio[3] : null;

  runner.once('error', () => {
    if (isPosix) failPosixContainment(runner, 'REFUSED: overnight Bash entry failed to start');
    else refuse('REFUSED: Windows overnight Job worker failed to start');
  });
  runner.once('exit', (code, signal) => {
    if (brokerFinished) return;
    runnerResult = { code, signal, result: exitResult(code, signal) };
    if (!isPosix) {
      if (shutdownPipe && !shutdownPipe.destroyed && !shutdownPipe.writableEnded) {
        shutdownPipe.end();
      }
      shutdownPipe = null;
      shutdownPipeReady = false;
      if (windowsGuardPipe && !windowsGuardPipe.destroyed && !windowsGuardPipe.writableEnded) {
        windowsGuardPipe.end('COMPLETE\n');
      }
      if (!windowsGuardClosed && !sessionCleanupTimer) {
        sessionCleanupTimer = setTimeout(() => {
          containmentFailed = true;
          console.error('REFUSED: Windows process-tree cleanup confirmation timed out');
          try { windowsGuard.kill('SIGKILL'); } catch {}
          finish(pendingSignal ? signalResult(pendingSignal) : 70);
        }, 12_000);
      }
      if (windowsFinishRun) windowsFinishRun();
      return;
    }
    if (gatePipe && !gatePipe.destroyed) gatePipe.end();
    gatePipe = null;
    if (shutdownPipe && !shutdownPipe.destroyed && !shutdownPipe.writableEnded) {
      shutdownPipe.end('COMPLETE\n');
    }
    if (!sessionGuardClosed && !sessionCleanupTimer) {
      sessionCleanupTimer = setTimeout(() => {
        containmentFailed = true;
        console.error('REFUSED: POSIX session cleanup confirmation timed out');
        forceStopTree(runner);
      }, 50_000);
    }
    finishPosixRun();
  });

  if (isPosix) {
    launchPosixSessionGuard(runner);
  } else {
    shutdownPipe = runner.stdin;
    shutdownPipeReady = false;
    runner.stdin.on('error', () => {});
    launchWindowsRunnerContainment(runner);
  }
}

function launchCapabilityPreflight() {
  settleTimer = null;
  if (pendingSignal) {
    finish(signalResult(pendingSignal));
    return;
  }
  bash = resolveBash();
  if (!bash) {
    refuse('REFUSED: trusted Bash 5.1 or newer unavailable');
    return;
  }

  const preflight = spawn(bash, [
    '--noprofile',
    '--norc',
    '-p',
    '-c',
    '(( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) ))',
  ], {
    cwd: ROOT,
    env: controlEnvironment(),
    stdio: 'ignore',
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  child = preflight;
  forwardedSignal = '';
  let timedOut = false;
  capabilityTimer = setTimeout(() => {
    timedOut = true;
    forceStopTree(preflight);
  }, 10_000);

  preflight.once('error', () => refuse('REFUSED: trusted Bash capability preflight failed to start'));
  preflight.once('exit', (code, signal) => {
    if (brokerFinished) return;
    if (capabilityTimer) clearTimeout(capabilityTimer);
    capabilityTimer = null;
    if (pendingSignal) {
      finish(signalResult(pendingSignal));
      return;
    }
    if (timedOut || !Number.isInteger(code) || code !== 0 || signal) {
      refuse('REFUSED: trusted Bash 5.1 or newer unavailable');
      return;
    }
    launchRunner();
  });
  if (pendingSignal) forward(pendingSignal);
}

function launchProtectedEntry() {
  settleTimer = setTimeout(launchCapabilityPreflight, 50);
}

// Give an OS-delivered signal that raced Node startup one event-loop window to
// settle before capability discovery. The protected Bash remains blocked until
// its platform containment guardian reports READY.
launchProtectedEntry();
