'use strict';

// Windows Job target for protected overnight runs. The outer broker keeps the
// issuer until this blocked native process has been assigned to its Job. Only
// then is the first stdin line delivered and the trusted Bash supervisor
// launched; later stdin lines are credential-free control messages.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

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

function refuse(message, code = 70) {
  console.error(message);
  process.exit(code);
}

if (process.platform !== 'win32' || process.argv.length !== 6) {
  refuse('REFUSED: invalid Windows overnight Job worker invocation', 64);
}
if (Object.keys(process.env).some(name => (
  FORBIDDEN_ENV_NAMES.has(name.toUpperCase()) || /^BASH_FUNC_.*%%$/i.test(name)
))) {
  refuse('REFUSED: Windows overnight Job worker inherited a protected startup control', 78);
}

function trustedFile(candidate, basenamePattern) {
  if (!path.isAbsolute(candidate)) return '';
  try {
    const resolved = fs.realpathSync(candidate);
    return basenamePattern.test(path.basename(resolved)) ? resolved : '';
  } catch {
    return '';
  }
}

function trustedBash(candidate) {
  const resolved = trustedFile(candidate, /^bash\.exe$/i);
  if (!resolved) return '';
  const fixed = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ].flatMap(value => {
    try { return [fs.realpathSync(value).toLowerCase()]; }
    catch { return []; }
  });
  return fixed.includes(resolved.toLowerCase()) ? resolved : '';
}

const bash = trustedBash(process.argv[2]);
const supervisor = trustedFile(process.argv[3], /^windows_bash_supervisor\.sh$/);
const script = trustedFile(process.argv[4], /^overnight_(?:runner|cron_chunk)\.sh$/);
const childPath = String(process.argv[5] || '');
const expectedRoot = fs.realpathSync(path.resolve(__dirname, '..'));
const expectedQa = fs.realpathSync(path.join(expectedRoot, 'qa')).toLowerCase();
if (!bash || !supervisor || !script || !childPath
    || path.dirname(supervisor).toLowerCase() !== expectedQa
    || path.dirname(script).toLowerCase() !== expectedQa) {
  refuse('REFUSED: invalid Windows overnight Job worker target');
}

let input = '';
let issuerReceived = false;
let child = null;
let pendingControl = '';
let finished = false;
let forcedExitCode = null;

function finish(code) {
  if (finished) return;
  finished = true;
  process.stdin.pause();
  process.stdin.destroy();
  process.exitCode = code;
}

function forwardControl(control) {
  if (!['INT', 'TERM', 'COMPLETE'].includes(control)) {
    control = 'TERM';
    forcedExitCode = 70;
  }
  if (!child || !child.stdin || child.stdin.destroyed) {
    pendingControl = control;
    return;
  }
  child.stdin.end(`${control}\n`);
}

function launch(issuer) {
  const env = { ...process.env, MSYS2_ARG_CONV_EXCL: '*' };
  child = spawn(bash, [
    '--noprofile',
    '--norc',
    '-p',
    supervisor.replace(/\\/g, '/').replace(/^([A-Za-z]):\//, (_, drive) => `/${drive.toLowerCase()}/`),
    childPath,
    script.replace(/\\/g, '/').replace(/^([A-Za-z]):\//, (_, drive) => `/${drive.toLowerCase()}/`),
  ], {
    cwd: expectedRoot,
    env,
    stdio: ['pipe', 'inherit', 'inherit'],
    windowsHide: true,
  });
  child.stdin.on('error', () => {});
  child.once('error', () => finish(69));
  child.once('exit', (code, signal) => {
    const result = Number.isInteger(code) ? code : signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1;
    finish(forcedExitCode === null ? result : forcedExitCode);
  });
  child.stdin.write(`${issuer}\n`, () => {
    issuer = '';
    if (pendingControl) forwardControl(pendingControl);
  });
}

function acceptLine(line) {
  if (!issuerReceived) {
    issuerReceived = true;
    launch(line);
    return;
  }
  forwardControl(line);
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  if (input.length > 128 * 1024) refuse('REFUSED: Windows overnight Job worker control overflow');
  let newline;
  while ((newline = input.indexOf('\n')) !== -1) {
    const line = input.slice(0, newline).replace(/\r$/, '');
    input = input.slice(newline + 1);
    acceptLine(line);
  }
});
process.stdin.once('end', () => {
  if (!issuerReceived) {
    finish(69);
    return;
  }
  if (input) acceptLine(input.replace(/\r$/, ''));
  else if (child && child.stdin && !child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end('TERM\n');
});
process.stdin.once('error', () => {
  if (child && child.stdin && !child.stdin.destroyed) child.stdin.end('TERM\n');
  finish(70);
});
process.stdin.resume();
