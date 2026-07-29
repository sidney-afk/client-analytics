'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  resolveWindowsSupabaseExecutable,
  supabaseCliInvocation,
} = require('../scripts/f27-edge-source-rollback-supabase-adapter.js');

const commandProcessor = 'C:\\Windows\\System32\\cmd.exe';
const firstDirectory = 'C:\\safe-first';
const secondDirectory = 'C:\\safe-second';
const firstCmd = path.win32.join(firstDirectory, 'supabase.cmd');
const secondExe = path.win32.join(secondDirectory, 'supabase.exe');
const files = new Set([commandProcessor.toLowerCase(), firstCmd.toLowerCase(), secondExe.toLowerCase()]);
const isFixtureFile = file => files.has(String(file).toLowerCase());
const environment = {
  Path: `${firstDirectory};${secondDirectory}`,
  ComSpec: commandProcessor,
};

assert.strictEqual(
  resolveWindowsSupabaseExecutable(environment, isFixtureFile),
  firstCmd,
  'Windows resolution must preserve PATH-directory precedence',
);

const cmdInvocation = supabaseCliInvocation(['--version'], {
  platform: 'win32',
  environment,
  isFile: isFixtureFile,
});
assert.deepStrictEqual(cmdInvocation, {
  command: `"${firstCmd}"`,
  args: ['--version'],
  shell: commandProcessor,
}, 'the npm .cmd shim must use an explicit, fully resolved Windows command processor invocation');

const executableOnly = new Set([commandProcessor.toLowerCase(), secondExe.toLowerCase()]);
const exeInvocation = supabaseCliInvocation(['--version'], {
  platform: 'win32',
  environment: { Path: secondDirectory, ComSpec: commandProcessor },
  isFile: file => executableOnly.has(String(file).toLowerCase()),
});
assert.deepStrictEqual(exeInvocation, {
  command: secondExe,
  args: ['--version'],
}, 'a native Windows executable must run directly without a shell');

assert.deepStrictEqual(
  supabaseCliInvocation(['--version'], { platform: 'linux' }),
  { command: 'supabase', args: ['--version'] },
  'non-Windows invocation must remain unchanged',
);

assert.throws(
  () => supabaseCliInvocation(['--version', '&', 'whoami'], {
    platform: 'win32',
    environment,
    isFile: isFixtureFile,
  }),
  /unsafe Windows shell characters/,
  'shell metacharacters must fail before the command processor is invoked',
);

const unsafeDirectory = 'C:\\unsafe&directory';
const unsafeCmd = path.win32.join(unsafeDirectory, 'supabase.cmd');
assert.throws(
  () => supabaseCliInvocation(['--version'], {
    platform: 'win32',
    environment: { Path: unsafeDirectory, ComSpec: commandProcessor },
    isFile: file => [unsafeCmd, commandProcessor].some(candidate => candidate.toLowerCase() === String(file).toLowerCase()),
  }),
  /unsafe Windows shell characters/,
  'a resolved shim path containing command-shell metacharacters must fail closed',
);

if (process.platform === 'win32') {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'f27 cli resolution '));
  try {
    const bin = path.join(temp, 'bin with spaces');
    const shim = path.join(bin, 'supabase.cmd');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(shim, '@echo off\r\nif "%~1"=="--version" (echo 9.8.7&exit /b 0)\r\nexit /b 9\r\n');
    const actualEnvironment = {
      Path: bin,
      ComSpec: process.env.ComSpec || process.env.COMSPEC,
    };
    const invocation = supabaseCliInvocation(['--version'], {
      platform: 'win32',
      environment: actualEnvironment,
    });
    const result = spawnSync(invocation.command, invocation.args, {
      encoding: 'utf8',
      shell: invocation.shell,
      windowsHide: true,
    });
    assert.strictEqual(result.status, 0, result.stderr || 'resolved .cmd shim did not execute');
    assert.strictEqual(result.stdout.trim(), '9.8.7');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

console.log('F27 Edge source Windows CLI resolution checks passed');
