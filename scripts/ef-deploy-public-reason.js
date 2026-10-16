#!/usr/bin/env node
'use strict';

// The Supabase CLI's own failure reason, safe for a PUBLIC run log.
//
// The Section 4 lane writes `supabase functions deploy` output to a private
// file and deletes it at cleanup, because the CLI prints the project ref, the
// dashboard URL and local paths. On 2026-10-16 (run 38933979961) the first
// production-write deploy through the new lanes failed in 1.6 seconds and the
// only public line was "failed or was ambiguous": the reason died with the file.
//
// This prints at most MAX_LINES lines, each prefixed `ef-deploy-reason: ` and at
// most MAX_CHARS long, and ONLY lines that match the allowlist below (the
// failure vocabulary of CLI 2.109.0 and of `docker run`/`docker pull`). Every
// printed line is redacted first: the project ref (from F27_PROJECT_REF or
// PROJECT_REF), anything shaped like a project ref, access tokens, JWTs,
// bearer values, e-mail addresses, and query strings. When nothing matches it
// prints only the line count, never a line.
//
// Usage: node scripts/ef-deploy-public-reason.js <private-deploy-log>
// Always exits 0: it explains a failure, it never decides one.

const fs = require('fs');

const PREFIX = 'ef-deploy-reason: ';
const MAX_LINES = 4;
const MAX_CHARS = 200;
const MAX_READ_BYTES = 1024 * 1024;

// How far the CLI got, from its own progress lines (kept as a fixed label).
const STAGES = [
  [/^Bundling Function: /, 'reached Docker bundling'],
  [/^Deploying Function: /, 'reached the upload'],
  [/^Uploading asset /, 'reached the server-side upload (no Docker bundle)'],
];

const ALLOW = [
  /failed to bundle function: exit \d+/i,
  /Error response from daemon: /i,
  /Unable to find image '[^']*' locally/i,
  /toomanyrequests|rate exceeded|too many requests/i,
  /pull access denied|manifest unknown|manifest for .* not found|denied: /i,
  /(?:TLS handshake timeout|i\/o timeout|connection refused|no such host|context deadline exceeded)/i,
  /failed to create docker (?:network|volume)/i,
  /docker: /i,
  /unexpected (?:list functions|deploy|update function|create function) status \d+/i,
  /failed to (?:list functions|deploy|read functions list)/i,
  /Failed reading config/i,
  /Invalid edge_runtime/i,
  /Could not find the `supabase-go` binary/i,
  /WARNING: Docker is not running/i,
  /No Functions specified or found/i,
  /are mutually exclusive/i,
  /--jobs cannot be used/i,
  /file path is a directory/i,
  /Skipping missing import map target/i,
  /(?:Invalid|Missing|Expired) access token|Unauthorized|Forbidden/i,
  /\b(?:ENOENT|EACCES|ENOTDIR|EPERM|ENOSPC)\b/,
  /^error: /i,
  /^Error: /,
];

function redact(line, projectRef) {
  let out = String(line);
  if (projectRef) out = out.split(projectRef).join('<project>');
  return out
    .replace(/\bsbp_[A-Za-z0-9_]+/g, '<token>')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g, '<jwt>')
    .replace(/\b(Bearer|Basic)\s+\S+/gi, '$1 <redacted>')
    .replace(/\b((?:access[_-]?)?token|secret|password|apikey|api[_-]?key|authorization)(\s*[=:]\s*)\S+/gi, '$1$2<redacted>')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
    .replace(/(https?:\/\/[^\s?#'"]+)[?#][^\s'"]*/gi, '$1')
    .replace(/\b[a-z]{20}\b/g, '<project>');
}

function clean(line) {
  return String(line)
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    // A line must never be read by the runner as a workflow command.
    .replace(/::/g, ': :')
    .trim();
}

// CLI 2.109.0 prints a fatal error as one JSON object:
// {"_tag":"Error","error":{"code":"UnknownError","message":"..."}}
function jsonReason(line) {
  if (!line.startsWith('{') || !line.includes('"_tag"')) return null;
  try {
    const parsed = JSON.parse(line);
    const error = parsed && parsed.error;
    if (!error || typeof error !== 'object') return null;
    const code = typeof error.code === 'string' ? error.code : 'Error';
    const message = typeof error.message === 'string' ? error.message : '';
    return `${code}: ${message}`;
  } catch (_) {
    return null;
  }
}

function publicReason(text, options = {}) {
  const projectRef = String(options.projectRef || '').trim();
  const lines = String(text || '').split(/\r?\n/).map(clean).filter(Boolean);
  let stage = '';
  const picked = [];
  for (const line of lines) {
    // A Bun crash prints excerpts of the CLI's own minified source as
    // "259 | ..."; they match words like Forbidden and say nothing.
    if (/^\d+ \| /.test(line) || line.length > 4000) continue;
    for (const [pattern, label] of STAGES) {
      if (pattern.test(line)) stage = label;
    }
    const candidate = jsonReason(line) || line;
    if (!ALLOW.some(pattern => pattern.test(candidate))) continue;
    const safe = redact(candidate, projectRef).slice(0, MAX_CHARS);
    if (!picked.includes(safe)) picked.push(safe);
  }
  const out = [];
  if (stage) out.push(`${PREFIX}stage: ${stage}`);
  // The last lines are the cause; earlier ones are usually warnings.
  for (const line of picked.slice(-(MAX_LINES - out.length))) out.push(PREFIX + line);
  if (!picked.length) out.push(`${PREFIX}no recognised CLI failure line (${lines.length} lines in the private log)`);
  return out;
}

function main(argv) {
  const file = argv[2];
  let text = '';
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const start = Math.max(0, size - MAX_READ_BYTES);
      const buffer = Buffer.alloc(size - start);
      fs.readSync(fd, buffer, 0, buffer.length, start);
      text = buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    process.stdout.write(`${PREFIX}the private deploy log was not written\n`);
    return;
  }
  const projectRef = process.env.F27_PROJECT_REF || process.env.PROJECT_REF || '';
  process.stdout.write(publicReason(text, { projectRef }).join('\n') + '\n');
}

if (require.main === module) {
  try { main(process.argv); } catch (_) { process.stdout.write(`${PREFIX}the reason could not be read\n`); }
}

module.exports = { publicReason, redact, MAX_LINES, MAX_CHARS, PREFIX };
