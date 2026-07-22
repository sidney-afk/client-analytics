'use strict';

/*
 * Supabase provider adapter for f27-edge-source-rollback.js.
 *
 * Readback uses only Management API GETs. Restore materializes the private
 * capture into an isolated temporary Supabase project and invokes the exact
 * installed CLI with its hidden --use-docker hard selection. Exactness is
 * defined only by provider-returned source bytes/path inventory, entrypoint,
 * and verify_jwt. The adapter never supplements that closure from local files.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  dispositionValue,
  multipartBoundary,
  normalizeLivePath,
  parseMultipart,
} = require('./ef-fingerprint.js');

const API_ORIGIN = 'https://api.supabase.com';
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function assertSlug(value) {
  const slug = clean(value);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error('function slug is invalid');
  return slug;
}

function assertProjectRef(value) {
  const projectRef = clean(value);
  if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error('project ref must be 20 lowercase alphanumeric characters');
  return projectRef;
}

function runTool(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeout || 30_000,
    maxBuffer: 8 * 1024 * 1024,
    env: process.env,
  });
  if (result.error || result.status !== 0) throw new Error(`${options.label || command} failed`);
  return { stdout: clean(result.stdout), stderr: clean(result.stderr) };
}

function supabaseCliVersion() {
  const result = runTool('supabase', ['--version'], { label: 'Supabase CLI version check' });
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(result.stdout)) {
    throw new Error('Supabase CLI returned an invalid version');
  }
  return result.stdout;
}

function assertDockerAvailable() {
  const result = runTool('docker', ['info', '--format', '{{.ServerVersion}}'], {
    label: 'Docker bundler preflight',
    timeout: 30_000,
  });
  if (!result.stdout) throw new Error('Docker bundler preflight returned no server version');
  return result.stdout;
}

async function managementGet(url, token, accept = 'application/json') {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: accept },
    redirect: 'error',
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`Management API read returned HTTP ${response.status}`);
  return response;
}

async function functionMetadata(projectRef, slug, token) {
  const response = await managementGet(`${API_ORIGIN}/v1/projects/${projectRef}/functions`, token);
  const records = await response.json();
  if (!Array.isArray(records)) throw new Error('function list response was not an array');
  const matches = records.filter(record => clean(record && record.slug) === slug);
  if (matches.length !== 1) throw new Error('function list did not contain exactly one requested slug');
  return matches[0];
}

function metadataGeneration(metadata) {
  return {
    version: metadata && metadata.version,
    status: metadata && metadata.status,
    verifyJwt: metadata && metadata.verify_jwt,
    providerBundleHash: metadata && metadata.ezbr_sha256,
  };
}

function assertSameMetadataGeneration(before, after) {
  const first = metadataGeneration(before);
  const second = metadataGeneration(after);
  if (!Object.keys(first).every(key => Object.is(first[key], second[key]))) {
    throw new Error('function metadata changed during source body readback');
  }
  return second;
}

function sourceEntrypoint(rawEntrypoint, slug) {
  let value = clean(rawEntrypoint).replace(/\\/g, '/');
  if (value.startsWith('file:')) {
    let pathname;
    try { pathname = decodeURIComponent(new URL(value).pathname).replace(/\\/g, '/'); } catch (_) {
      throw new Error('provider returned an invalid entrypoint URL');
    }
    const modern = pathname.lastIndexOf(`/functions/${slug}/`);
    const legacy = pathname.lastIndexOf('/source/');
    if (modern >= 0) value = pathname.slice(modern + 1);
    else if (legacy >= 0) value = pathname.slice(legacy + 1);
    else value = path.posix.basename(pathname);
  }
  return normalizeLivePath(value, slug, value);
}

async function functionSource(projectRef, slug, token, metadata) {
  const response = await managementGet(
    `${API_ORIGIN}/v1/projects/${projectRef}/functions/${encodeURIComponent(slug)}/body`,
    token,
    'multipart/form-data',
  );
  const contentType = clean(response.headers.get('content-type'));
  if (!contentType.toLowerCase().startsWith('multipart/')) {
    throw new Error('function body was not a source multipart response');
  }
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_SOURCE_BYTES) throw new Error('function source exceeds the safety limit');
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > MAX_SOURCE_BYTES) throw new Error('function source exceeds the safety limit');
  const parts = parseMultipart(body, multipartBoundary(contentType));
  const sourceParts = [];
  let bodyMetadata = null;
  for (const part of parts) {
    const disposition = clean(part.headers.get('content-disposition'));
    const field = dispositionValue(disposition, 'name');
    const sourcePath = clean(part.headers.get('supabase-path') || dispositionValue(disposition, 'filename'));
    if (sourcePath) {
      sourceParts.push({ sourcePath, body: Buffer.from(part.body) });
      continue;
    }
    if (field === 'metadata') {
      if (bodyMetadata) throw new Error('provider repeated source metadata');
      try { bodyMetadata = JSON.parse(part.body.toString('utf8')); } catch (_) { throw new Error('provider source metadata is invalid'); }
    }
  }
  if (!sourceParts.length) throw new Error('provider returned no source files');
  const rawEntrypoint = clean(bodyMetadata && (bodyMetadata.deno2_entrypoint_path || bodyMetadata.entrypoint_path))
    || clean(metadata.entrypoint_path);
  if (!rawEntrypoint) throw new Error('provider omitted the entrypoint path');
  const files = new Map();
  for (const part of sourceParts) {
    const canonical = normalizeLivePath(part.sourcePath, slug, rawEntrypoint);
    if (files.has(canonical)) throw new Error(`provider repeated source path ${canonical}`);
    files.set(canonical, part.body);
  }
  return { files, entrypointPath: sourceEntrypoint(rawEntrypoint, slug) };
}

async function versionStableFunctionSource(projectRef, slug, token) {
  const before = await functionMetadata(projectRef, slug, token);
  const source = await functionSource(projectRef, slug, token, before);
  const after = await functionMetadata(projectRef, slug, token);
  assertSameMetadataGeneration(before, after);
  return { metadata: after, source };
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function materialize(spec, projectRef, root) {
  const slug = assertSlug(spec.slug);
  for (const [file, bytes] of spec.files) {
    const components = String(file).split('/');
    if (components[0] !== 'functions' || components.includes('..')) throw new Error('restore closure contains an unsafe path');
    const target = path.join(root, 'supabase', ...components);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, bytes, { mode: 0o600, flag: 'wx' });
  }
  const config = [
    `project_id = ${tomlString(projectRef)}`,
    '',
    `[functions.${slug}]`,
    'enabled = true',
    `verify_jwt = ${spec.verifyJwt ? 'true' : 'false'}`,
    `entrypoint = ${tomlString(`./${spec.entrypointPath}`)}`,
    '',
  ].join('\n');
  const configPath = path.join(root, 'supabase', 'config.toml');
  fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(configPath, config, { mode: 0o600, flag: 'wx' });
}

function createAdapter(options = {}) {
  const projectRef = assertProjectRef(options.projectRef || process.env.PROJECT_REF || process.env.SUPABASE_PROJECT_REF);
  const token = clean(options.accessToken || process.env.SUPABASE_ACCESS_TOKEN);
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is required');

  return {
    async readFunction(rawSlug) {
      const slug = assertSlug(rawSlug);
      const { metadata, source } = await versionStableFunctionSource(projectRef, slug, token);
      return {
        slug,
        version: metadata.version,
        status: metadata.status,
        verifyJwt: metadata.verify_jwt,
        entrypointPath: source.entrypointPath,
        files: source.files,
        providerBundleHash: clean(metadata.ezbr_sha256),
        provider: {
          adapter: 'supabase-management-readback-cli-docker-deploy',
          project_ref: projectRef,
          supabase_cli_version: supabaseCliVersion(),
          restore_adapter: 'local-docker-provider-source-redeploy',
        },
      };
    },

    async deployFunction(spec) {
      const slug = assertSlug(spec.slug);
      const captured = spec.capturedProvider || {};
      if (captured.adapter !== 'supabase-management-readback-cli-docker-deploy'
        || captured.project_ref !== projectRef) {
        throw new Error('captured provider identity does not match the restore target');
      }
      const cliVersion = supabaseCliVersion();
      if (captured.supabase_cli_version !== cliVersion) throw new Error('Supabase CLI version differs from the capture');
      assertDockerAvailable();
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'f27-edge-source-restore-'));
      try {
        materialize(spec, projectRef, root);
        const args = ['functions', 'deploy', slug, '--project-ref', projectRef, '--use-docker', '--yes'];
        if (!spec.verifyJwt) args.push('--no-verify-jwt');
        const result = runTool('supabase', args, {
          cwd: root,
          label: 'source-exact Edge Function redeploy',
          timeout: 15 * 60_000,
        });
        if (/Docker is not running|server-side/i.test(`${result.stdout}\n${result.stderr}`)) {
          throw new Error('local Docker bundling was not used');
        }
      } finally {
        try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
      }
    },
  };
}

module.exports = {
  assertSameMetadataGeneration,
  createAdapter,
  functionSource,
  materialize,
  metadataGeneration,
  sourceEntrypoint,
  supabaseCliVersion,
  versionStableFunctionSource,
};
