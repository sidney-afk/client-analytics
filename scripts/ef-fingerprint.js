#!/usr/bin/env node
'use strict';

/**
 * Compare the repository-local source closure of Supabase Edge Functions at an
 * exact Git commit with the source closure returned by Supabase's read-only
 * Management API.
 *
 * The script never checks out a commit and never sends a mutating HTTP method.
 * Expected files are read with `git show`; live metadata and source are read
 * with GET /functions and GET /functions/:slug/body (multipart form-data).
 *
 * Usage:
 *   node scripts/ef-fingerprint.js <40-char-sha>
 *   node scripts/ef-fingerprint.js <sha> --slugs=a,b --format=markdown
 *   node scripts/ef-fingerprint.js <sha> --expected-only
 *   node scripts/ef-fingerprint.js <sha> --report-only
 *
 * Environment:
 *   SUPABASE_ACCESS_TOKEN  Management API token with edge_functions:read
 *   PROJECT_REF            Optional project ref override
 */

const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FUNCTIONS_PREFIX = 'supabase/functions/';
const API_ORIGIN = 'https://api.supabase.com';
const SOURCE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const INDEX_CANDIDATES = ['index.ts', 'index.tsx', 'index.js', 'index.mjs'];
const VALID_FORMATS = new Set(['text', 'markdown', 'json']);

function fail(message, code = 2) {
  console.error(`ef-fingerprint: ${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  const options = {
    sha: '',
    projectRef: String(process.env.PROJECT_REF || process.env.SUPABASE_PROJECT_REF || '').trim(),
    format: 'text',
    slugs: null,
    expectedOnly: false,
    reportOnly: false,
  };

  for (const arg of argv) {
    if (arg === '--expected-only') options.expectedOnly = true;
    else if (arg === '--report-only') options.reportOnly = true;
    else if (arg.startsWith('--project-ref=')) options.projectRef = arg.slice('--project-ref='.length).trim();
    else if (arg.startsWith('--format=')) options.format = arg.slice('--format='.length).trim();
    else if (arg.startsWith('--slugs=')) {
      options.slugs = arg.slice('--slugs='.length).split(',').map(value => value.trim()).filter(Boolean);
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/ef-fingerprint.js <40-char-sha> [--slugs=a,b] [--format=text|markdown|json] [--expected-only] [--report-only]');
      process.exit(0);
    } else if (!options.sha) options.sha = arg.trim().toLowerCase();
    else fail(`unexpected argument ${arg}`);
  }

  if (!/^[0-9a-f]{40}$/.test(options.sha)) fail('an exact 40-character lowercase Git commit SHA is required');
  if (!VALID_FORMATS.has(options.format)) fail(`unsupported format ${options.format}`);
  return options;
}

function git(args, encoding = 'utf8') {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: encoding === null ? null : encoding,
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || '').trim().split(/\r?\n/)[0] || `git exited ${result.status}`;
    throw new Error(detail);
  }
  return result.stdout;
}

function verifyCommit(sha) {
  const resolved = String(git(['rev-parse', '--verify', `${sha}^{commit}`])).trim().toLowerCase();
  if (resolved !== sha) throw new Error(`commit resolved to ${resolved || 'nothing'} instead of the pinned SHA`);
}

function listRepositoryFiles(sha) {
  return String(git(['ls-tree', '-r', '--name-only', sha, '--', 'supabase/functions', 'supabase/config.toml']))
    .split(/\r?\n/)
    .map(value => value.trim())
    .filter(Boolean)
    .sort();
}

function readGitFile(sha, file) {
  return git(['show', `${sha}:${file}`], null);
}

function sourceText(bytes) {
  return Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, '');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function closureFingerprint(files) {
  const hash = crypto.createHash('sha256');
  for (const [file, content] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const bytes = Buffer.from(content);
    hash.update(`${Buffer.byteLength(file, 'utf8')}:`);
    hash.update(file, 'utf8');
    hash.update(`\n${bytes.length}:`);
    hash.update(bytes);
    hash.update('\n');
  }
  return hash.digest('hex');
}

function localSpecifiers(source) {
  const specs = new Set();
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^"'`]*?\s+from\s*)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      const specifier = match[1].split(/[?#]/, 1)[0];
      if (specifier.startsWith('./') || specifier.startsWith('../')) specs.add(specifier);
    }
  }
  return [...specs];
}

function resolveLocalImport(fromFile, specifier, inventory) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  if (!base.startsWith(FUNCTIONS_PREFIX)) throw new Error(`${fromFile} imports outside supabase/functions: ${specifier}`);
  const candidates = [];
  for (const extension of SOURCE_EXTENSIONS) candidates.push(base + extension);
  for (const index of INDEX_CANDIDATES) candidates.push(path.posix.join(base, index));
  const matches = [...new Set(candidates)].filter(candidate => inventory.has(candidate));
  if (matches.length === 0) throw new Error(`${fromFile} has unresolved local import ${specifier}`);
  return matches[0];
}

function entrypointFor(slug, inventory) {
  for (const name of INDEX_CANDIDATES) {
    const candidate = `${FUNCTIONS_PREFIX}${slug}/${name}`;
    if (inventory.has(candidate)) return candidate;
  }
  throw new Error(`${slug} has no supported entrypoint`);
}

function buildExpectedClosure(sha, slug, inventory, cache) {
  const pending = [entrypointFor(slug, inventory)];
  const closure = new Map();
  while (pending.length) {
    const file = pending.pop();
    if (closure.has(file)) continue;
    let source = cache.get(file);
    if (source === undefined) {
      source = Buffer.from(readGitFile(sha, file));
      cache.set(file, source);
    }
    closure.set(file.slice('supabase/'.length), source);
    for (const specifier of localSpecifiers(sourceText(source))) {
      const dependency = resolveLocalImport(file, specifier, inventory);
      if (!closure.has(dependency)) pending.push(dependency);
    }
  }
  return closure;
}

function projectRefFromConfig(sha, inventory) {
  if (!inventory.has('supabase/config.toml')) return '';
  const config = sourceText(readGitFile(sha, 'supabase/config.toml'));
  const match = /^project_id\s*=\s*["']([a-z0-9]{20})["']/m.exec(config);
  return match ? match[1] : '';
}

function normalizeLivePath(name, slug, entrypointPath) {
  let value = String(name || '').replace(/\\/g, '/');
  let entrypoint = String(entrypointPath || '').replace(/\\/g, '/');
  if (entrypoint.startsWith('file:')) {
    try {
      const url = new URL(entrypoint);
      if (url.protocol !== 'file:') throw new Error('not a file URL');
      entrypoint = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    } catch (_) {
      throw new Error(`${slug} returned an invalid entrypoint file URL`);
    }
  }
  for (const [label, candidate] of [['source part', value], ['entrypoint', entrypoint]]) {
    if (!candidate || candidate.includes('\0') || candidate.startsWith('/')
      || /^[a-zA-Z]:\//.test(candidate) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)
      || candidate.split('/').includes('..')) {
      throw new Error(`${slug} returned an unsafe or empty ${label} path`);
    }
  }
  value = path.posix.normalize(value.replace(/^\.\//, ''));
  const normalizedEntrypoint = path.posix.normalize(entrypoint.replace(/^\.\//, ''));

  if (value.startsWith('functions/')) return value;
  if (value.startsWith('_shared/')) return `functions/${value}`;
  if (value.startsWith(`${slug}/`)) return `functions/${value}`;

  // Older deployments used generic roots such as source/index.ts. The API's
  // metadata identifies that entrypoint root, so map its files back to the
  // repository slug rather than treating the historical root as provenance.
  const entrypointRoot = path.posix.dirname(normalizedEntrypoint);
  if (entrypointRoot === '.' && !value.includes('/')) return `functions/${slug}/${value}`;
  if (entrypointRoot && entrypointRoot !== '.' && (value === entrypointRoot || value.startsWith(`${entrypointRoot}/`))) {
    const relative = path.posix.relative(entrypointRoot, value);
    return `functions/${slug}/${relative}`;
  }
  throw new Error(`${slug} returned an unmapped source part path`);
}

async function managementGet(url, token, accept = 'application/json') {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: accept },
    redirect: 'error',
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`GET ${new URL(url).pathname} returned HTTP ${response.status}`);
  return response;
}

async function fetchLiveFunctions(projectRef, token) {
  const response = await managementGet(`${API_ORIGIN}/v1/projects/${projectRef}/functions`, token);
  const records = await response.json();
  if (!Array.isArray(records)) throw new Error('function list response was not an array');
  const functions = new Map();
  for (const record of records) {
    const slug = String(record && record.slug || '');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error('function list response contained an invalid slug');
    if (functions.has(slug)) throw new Error(`function list response repeated slug ${slug}`);
    functions.set(slug, record);
  }
  return functions;
}

function multipartBoundary(contentType) {
  const match = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = match && (match[1] || match[2]);
  if (!boundary || boundary.length > 200 || /[\r\n]/.test(boundary)) throw new Error('multipart source response omitted a valid boundary');
  return boundary;
}

function dispositionValue(disposition, key) {
  const extended = new RegExp(`(?:^|;)\\s*${key}\\*=UTF-8''([^;]+)`, 'i').exec(disposition);
  if (extended) {
    try { return decodeURIComponent(extended[1]); } catch (_) { throw new Error(`invalid multipart ${key}`); }
  }
  const quoted = new RegExp(`(?:^|;)\\s*${key}="((?:\\\\.|[^"])*)"`, 'i').exec(disposition);
  if (quoted) return quoted[1].replace(/\\([\\"])/g, '$1');
  const bare = new RegExp(`(?:^|;)\\s*${key}=([^;\\s]+)`, 'i').exec(disposition);
  return bare ? bare[1] : '';
}

function parseMultipart(bytes, boundary) {
  const body = Buffer.from(bytes);
  const delimiter = Buffer.from(`--${boundary}`, 'utf8');
  const nextDelimiter = Buffer.from(`\r\n--${boundary}`, 'utf8');
  const headerBreak = Buffer.from('\r\n\r\n', 'utf8');
  const lineBreak = Buffer.from('\r\n', 'utf8');
  const parts = [];
  let cursor = 0;
  if (!body.subarray(0, delimiter.length).equals(delimiter)) throw new Error('malformed multipart source preamble');

  while (cursor < body.length) {
    if (!body.subarray(cursor, cursor + delimiter.length).equals(delimiter)) throw new Error('malformed multipart source delimiter');
    cursor += delimiter.length;
    if (body.subarray(cursor, cursor + 2).toString('ascii') === '--') break;
    if (!body.subarray(cursor, cursor + 2).equals(lineBreak)) throw new Error('malformed multipart source delimiter line');
    cursor += 2;
    const headerEnd = body.indexOf(headerBreak, cursor);
    if (headerEnd < 0) throw new Error('malformed multipart source headers');
    const headers = new Map();
    const headerText = body.subarray(cursor, headerEnd).toString('utf8');
    for (const line of headerText.split('\r\n')) {
      const colon = line.indexOf(':');
      if (colon <= 0) throw new Error('malformed multipart source header');
      const name = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      if (headers.has(name)) throw new Error(`duplicate multipart ${name} header`);
      headers.set(name, value);
    }
    const contentStart = headerEnd + headerBreak.length;
    let contentEnd = body.indexOf(nextDelimiter, contentStart);
    while (contentEnd >= 0) {
      const suffixStart = contentEnd + nextDelimiter.length;
      const suffix = body.subarray(suffixStart, suffixStart + 2).toString('ascii');
      if (suffix === '--' || suffix === '\r\n') break;
      contentEnd = body.indexOf(nextDelimiter, contentEnd + nextDelimiter.length);
    }
    if (contentEnd < 0) throw new Error('unterminated multipart source part');
    parts.push({ headers, body: body.subarray(contentStart, contentEnd) });
    cursor = contentEnd + 2;
  }
  return parts;
}

async function fetchLiveClosure(projectRef, slug, token, liveMetadata) {
  const response = await managementGet(
    `${API_ORIGIN}/v1/projects/${projectRef}/functions/${encodeURIComponent(slug)}/body`,
    token,
    'multipart/form-data',
  );
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.toLowerCase().startsWith('multipart/')) {
    throw new Error(`${slug} body response was not multipart source (raw ESZIP is unsupported)`);
  }
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > 128 * 1024 * 1024) throw new Error(`${slug} source response exceeded the 128 MiB safety limit`);
  const responseBytes = Buffer.from(await response.arrayBuffer());
  if (responseBytes.length > 128 * 1024 * 1024) throw new Error(`${slug} source response exceeded the 128 MiB safety limit`);
  const parts = parseMultipart(responseBytes, multipartBoundary(contentType));
  let metadataValue = '';
  const sourceParts = [];
  for (const part of parts) {
    const disposition = String(part.headers.get('content-disposition') || '');
    const name = dispositionValue(disposition, 'name');
    const partPath = String(part.headers.get('supabase-path') || dispositionValue(disposition, 'filename'));
    if (partPath) {
      sourceParts.push({ path: partPath, body: part.body });
      continue;
    }
    if (name === 'metadata') {
      if (metadataValue) throw new Error(`${slug} body response repeated source metadata`);
      metadataValue = part.body.toString('utf8');
      continue;
    }
    if (name === 'file') throw new Error(`${slug} body response included a file without a source path`);
  }

  let entrypointPath = '';
  if (metadataValue) {
    try {
      const metadata = JSON.parse(metadataValue);
      entrypointPath = String(metadata.deno2_entrypoint_path || metadata.entrypoint_path || '');
    } catch (_) {
      throw new Error(`${slug} body response had malformed source metadata`);
    }
  }
  entrypointPath ||= String(liveMetadata && liveMetadata.entrypoint_path || '');
  if (!entrypointPath) throw new Error(`${slug} body response omitted its entrypoint path`);

  const closure = new Map();
  for (const sourcePart of sourceParts) {
    const file = normalizeLivePath(sourcePart.path, slug, entrypointPath);
    if (closure.has(file)) throw new Error(`${slug} body response repeated canonical source path ${file}`);
    closure.set(file, Buffer.from(sourcePart.body));
  }
  if (closure.size === 0) throw new Error(`${slug} body response contained no repository-local source files`);
  return closure;
}

function compareClosures(expected, live) {
  const expectedPaths = [...expected.keys()].sort();
  const livePaths = [...live.keys()].sort();
  const missing = expectedPaths.filter(file => !live.has(file));
  const extra = livePaths.filter(file => !expected.has(file));
  const changed = expectedPaths.filter(file => live.has(file) && !Buffer.from(expected.get(file)).equals(Buffer.from(live.get(file))));
  return {
    pass: missing.length === 0 && extra.length === 0 && changed.length === 0,
    missing,
    extra,
    changed,
  };
}

async function mapLimit(values, limit, mapper) {
  const output = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return output;
}

function short(value) {
  return value ? String(value).slice(0, 12) : '-';
}

function reasonFor(result) {
  if (result.error) return result.error;
  const parts = [];
  if (result.status && result.status !== 'ACTIVE') parts.push(`status=${result.status}`);
  if (result.comparison) {
    if (result.comparison.missing.length) parts.push(`missing=${result.comparison.missing.join(',')}`);
    if (result.comparison.extra.length) parts.push(`extra=${result.comparison.extra.join(',')}`);
    if (result.comparison.changed.length) parts.push(`changed=${result.comparison.changed.join(',')}`);
  }
  return parts.join('; ') || 'source mismatch';
}

function renderText(report) {
  const lines = [
    'Edge Function source fingerprint provenance',
    `Pinned SHA: ${report.pinned_sha}`,
    `Mode: ${report.mode}`,
    `Project ref: ${report.project_ref || '-'}`,
    `Slugs: ${report.results.length}`,
    '',
  ];
  for (const result of report.results) {
    if (report.mode === 'expected-only') {
      lines.push(`EXPECTED ${result.slug} source=${result.expected_fingerprint} files=${result.expected_files}`);
      continue;
    }
    lines.push(`${result.result} ${result.slug} version=${result.version ?? '-'} source=${short(result.expected_fingerprint)} live=${short(result.live_fingerprint)} bundle=${short(result.bundle_fingerprint)} files=${result.expected_files}/${result.live_files ?? '-'}`);
    if (result.result !== 'PASS') lines.push(`  ${reasonFor(result)}`);
  }
  lines.push('', `Summary: ${report.summary.pass} PASS, ${report.summary.fail} FAIL, ${report.summary.error} ERROR`);
  return lines.join('\n');
}

function escapeCell(value) {
  return String(value ?? '-').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderMarkdown(report) {
  const lines = [
    '### Edge Function source fingerprints',
    '',
    `- Pinned SHA: \`${report.pinned_sha}\``,
    `- Comparison: ${report.mode === 'live-read-only' ? 'live read-only Supabase Management API GET' : 'expected source only; no live API call'}`,
    `- Project ref: \`${report.project_ref || '-'}\``,
    '',
    '| Slug | Result | Live version | Expected source | Live source | Deployed bundle | Files |',
    '|---|---:|---:|---|---|---|---:|',
  ];
  for (const result of report.results) {
    const resultText = report.mode === 'expected-only' ? 'EXPECTED' : result.result;
    lines.push(`| \`${escapeCell(result.slug)}\` | ${resultText} | ${escapeCell(result.version)} | \`${short(result.expected_fingerprint)}\` | \`${short(result.live_fingerprint)}\` | \`${short(result.bundle_fingerprint)}\` | ${result.expected_files}/${result.live_files ?? '-'} |`);
  }
  lines.push('', `**Result:** ${report.summary.pass} PASS, ${report.summary.fail} FAIL, ${report.summary.error} ERROR.`);
  const failures = report.results.filter(result => result.result === 'FAIL' || result.result === 'ERROR');
  for (const result of failures) lines.push(`- \`${result.slug}\`: ${escapeCell(reasonFor(result))}`);
  return lines.join('\n');
}

function render(report, format) {
  if (format === 'json') return JSON.stringify(report, null, 2);
  if (format === 'markdown') return renderMarkdown(report);
  return renderText(report);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  verifyCommit(options.sha);
  const files = listRepositoryFiles(options.sha);
  const inventory = new Set(files);
  const allSlugs = [...new Set(files
    .filter(file => file.startsWith(FUNCTIONS_PREFIX) && /\/index\.(?:ts|tsx|js|mjs)$/.test(file))
    .map(file => file.slice(FUNCTIONS_PREFIX.length).split('/')[0])
    .filter(slug => slug && slug !== '_shared'))].sort();
  if (allSlugs.length === 0) throw new Error('the pinned commit contains no Edge Function slugs');

  const slugs = options.slugs ? [...new Set(options.slugs)].sort() : allSlugs;
  const unknown = slugs.filter(slug => !allSlugs.includes(slug));
  if (unknown.length) throw new Error(`unknown slug(s) at pinned commit: ${unknown.join(', ')}`);

  const sourceCache = new Map();
  const expected = new Map(slugs.map(slug => {
    const closure = buildExpectedClosure(options.sha, slug, inventory, sourceCache);
    return [slug, { closure, fingerprint: closureFingerprint(closure) }];
  }));
  const projectRef = options.projectRef || projectRefFromConfig(options.sha, inventory);

  if (options.expectedOnly) {
    const results = slugs.map(slug => ({
      slug,
      result: 'EXPECTED',
      expected_fingerprint: expected.get(slug).fingerprint,
      expected_files: expected.get(slug).closure.size,
      version: null,
      live_fingerprint: null,
      live_files: null,
      bundle_fingerprint: null,
    }));
    const report = {
      schema_version: 1,
      pinned_sha: options.sha,
      project_ref: projectRef,
      mode: 'expected-only',
      algorithm: 'sha256(path-length:path\\ncontent-length:raw-git-source-bytes\\n) over sorted repository-local import closure',
      results,
      summary: { pass: 0, fail: 0, error: 0, expected: results.length },
    };
    console.log(render(report, options.format));
    return;
  }

  if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error('PROJECT_REF must be a 20-character Supabase project ref');
  const token = String(process.env.SUPABASE_ACCESS_TOKEN || '').trim();
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is required for the live read-only comparison');

  const liveMetadata = await fetchLiveFunctions(projectRef, token);
  const results = await mapLimit(slugs, 4, async slug => {
    const expectedRecord = expected.get(slug);
    const metadata = liveMetadata.get(slug);
    if (!metadata) {
      return {
        slug, result: 'FAIL', error: 'slug is absent from the live function list',
        expected_fingerprint: expectedRecord.fingerprint, expected_files: expectedRecord.closure.size,
        live_fingerprint: null, live_files: null, bundle_fingerprint: null, version: null, status: null,
      };
    }
    try {
      const liveClosure = await fetchLiveClosure(projectRef, slug, token, metadata);
      const liveFingerprint = closureFingerprint(liveClosure);
      const comparison = compareClosures(expectedRecord.closure, liveClosure);
      const active = String(metadata.status || '') === 'ACTIVE';
      return {
        slug,
        result: comparison.pass && active ? 'PASS' : 'FAIL',
        status: String(metadata.status || ''),
        version: metadata.version ?? null,
        verify_jwt: metadata.verify_jwt ?? null,
        expected_fingerprint: expectedRecord.fingerprint,
        live_fingerprint: liveFingerprint,
        bundle_fingerprint: String(metadata.ezbr_sha256 || ''),
        expected_files: expectedRecord.closure.size,
        live_files: liveClosure.size,
        comparison,
      };
    } catch (error) {
      return {
        slug, result: 'ERROR', error: String(error && error.message || error),
        status: String(metadata.status || ''), version: metadata.version ?? null,
        verify_jwt: metadata.verify_jwt ?? null,
        expected_fingerprint: expectedRecord.fingerprint, expected_files: expectedRecord.closure.size,
        live_fingerprint: null, live_files: null, bundle_fingerprint: String(metadata.ezbr_sha256 || ''),
      };
    }
  });

  const summary = {
    pass: results.filter(result => result.result === 'PASS').length,
    fail: results.filter(result => result.result === 'FAIL').length,
    error: results.filter(result => result.result === 'ERROR').length,
  };
  const report = {
    schema_version: 1,
    pinned_sha: options.sha,
    project_ref: projectRef,
    mode: 'live-read-only',
    algorithm: 'sha256(path-length:path\\ncontent-length:raw-git-source-bytes\\n) over sorted repository-local import closure',
    results,
    summary,
  };
  console.log(render(report, options.format));
  if (!options.reportOnly && (summary.fail || summary.error)) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => fail(String(error && error.message || error), 2));
} else {
  module.exports = {
    closureFingerprint,
    compareClosures,
    dispositionValue,
    multipartBoundary,
    normalizeLivePath,
    parseMultipart,
  };
}
