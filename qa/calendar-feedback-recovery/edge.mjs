// Loads the ACTUAL Edge Function handlers in-process: production-write (the
// candidate working tree, or an exact git revision for baseline proof) and the
// repository calendar-upsert writer (not evidence of its frozen serving body).
// Only the npm supabase import is replaced by the seam
// factory; relative imports resolve to their real files. External fetch is
// refused and background work is collected so tests can drain it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SUPABASE_IMPORT = 'import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";';
const secret = { SUPABASE_URL: 'https://supabase.synthetic.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', ROLE_KEY_ADMIN: 'synthetic-admin' };
const state = { handler: null, background: [], externalRequests: 0, clientFactory: null };
globalThis.Deno = { env: { get: name => secret[name] }, serve: fn => { state.handler = fn; } };
globalThis.EdgeRuntime = { waitUntil: promise => { state.background.push(Promise.resolve(promise).catch(() => null)); } };
globalThis.fetch = async () => { state.externalRequests++; throw new Error('external_fetch_refused'); };
globalThis.__cfrClientFactory = () => { assert.ok(state.clientFactory, 'seam factory unset'); return state.clientFactory(); };
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cfr-edge-'));

function rewriteOnce(source, needle, value) {
  assert.equal(source.split(needle).length, 2, 'seam must match exactly once: ' + needle);
  return source.replace(needle, value);
}
function readSource(file, revision) {
  return revision ? execFileSync('git', ['show', `${revision}:${file}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
    : fs.readFileSync(path.join(ROOT, file), 'utf8');
}
async function loadFunction(slug, relatives, revision, tag) {
  const file = `supabase/functions/${slug}/index.ts`;
  let text = readSource(file, revision);
  const sourceSha = sha(text);
  const shim = 'data:text/javascript,' + encodeURIComponent('export class SupabaseClient {} export function createClient(){return globalThis.__cfrClientFactory();}');
  text = rewriteOnce(text, SUPABASE_IMPORT, `import { createClient, SupabaseClient } from "${shim}";`);
  const dir = path.join(tmp, tag);
  fs.mkdirSync(dir, { recursive: true });
  for (const relative of relatives) {
    let target;
    if (revision && relative.startsWith('./')) {
      const localFile = `supabase/functions/${slug}/${relative.slice(2)}`;
      target = path.join(dir, relative.slice(2));
      fs.writeFileSync(target, readSource(localFile, revision));
    } else target = path.resolve(ROOT, `supabase/functions/${slug}`, relative);
    text = rewriteOnce(text, `from "${relative}";`, `from "${pathToFileURL(target).href}";`);
  }
  const out = path.join(dir, 'index.ts');
  fs.writeFileSync(out, text);
  state.handler = null;
  await import(pathToFileURL(out).href);
  assert.equal(typeof state.handler, 'function', 'Deno.serve captured');
  return { handler: state.handler, source_sha256: sourceSha, revision: revision || 'working-tree' };
}
export async function loadProductionWrite(revision = null) {
  return loadFunction('production-write', ['../_shared/staff-role-auth.ts', './selected-label-pages.mjs', '../_shared/linear-create-id.mjs', './policy.mjs'], revision, 'production-write-' + (revision || 'candidate'));
}
export async function loadCalendarUpsert() {
  return loadFunction('calendar-upsert', ['../_shared/browser-write-auth.ts', '../_shared/thumbnail-revisions.ts', '../_shared/native-card-materialization.mjs'], null, 'calendar-upsert-repository');
}
export function useSeam(factory) { state.clientFactory = factory; }
export async function drainBackground() { const pending = state.background.splice(0); await Promise.all(pending); return pending.length; }
export function externalRequests() { return state.externalRequests; }
export async function invoke(handler, payload, headers = {}) {
  const request = new Request('https://gateway.synthetic.invalid/functions/v1/x', { method: 'POST',
    headers: { 'content-type': 'application/json', ...headers }, body: typeof payload === 'string' ? payload : JSON.stringify(payload) });
  const response = await handler(request);
  const text = await response.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: response.status, body, headers: Object.fromEntries(response.headers.entries()) };
}
export function cleanup() { fs.rmSync(tmp, { recursive: true, force: true }); }
