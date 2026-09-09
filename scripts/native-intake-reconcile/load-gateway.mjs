/*
 * Loads the REAL supabase/functions/production-write/index.ts into this Node
 * process, exactly as scripts/native-intake-manifest/native-only-lane.mjs does
 * at PR1302 head 8cb5cba91bc33fb17599b8f2a38625ae07f7743d. Kept as a module so
 * the reconcile lane does not carry a third copy of the seam inline; the seam
 * itself is unchanged and stated exactly:
 *   1. the `npm:@supabase/supabase-js` import  -> ../native-intake-manifest/supabase-shim.mjs
 *   2. `Deno.env.get`                           -> process.env
 *   3. `Deno.serve(handler)`                    -> captures `handler` for direct calls
 *   4. `globalThis.fetch`                       -> a recording fake; nothing leaves the process
 * Relative imports resolve to the repository files. A needle that does not
 * match exactly once aborts the lane, so the seam is bound to the current file.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
const FN_DIR = path.join(ROOT, 'supabase', 'functions', 'production-write');
const SHIM = path.join(ROOT, 'scripts', 'native-intake-manifest', 'supabase-shim.mjs');

function rewriteOnce(source, needle, replacement) {
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + 1) >= 0) {
    throw new Error('gateway seam does not match production-write/index.ts exactly once: ' + needle);
  }
  return source.replace(needle, replacement);
}

export async function loadGateway() {
  let source = fs.readFileSync(path.join(FN_DIR, 'index.ts'), 'utf8');
  source = rewriteOnce(source,
    'import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";',
    `import { createClient, SupabaseClient } from "${pathToFileURL(SHIM).href}";`);
  source = rewriteOnce(source, 'from "../_shared/staff-role-auth.ts";',
    `from "${pathToFileURL(path.join(ROOT, 'supabase', 'functions', '_shared', 'staff-role-auth.ts')).href}";`);
  source = rewriteOnce(source, 'from "./policy.mjs";', `from "${pathToFileURL(path.join(FN_DIR, 'policy.mjs')).href}";`);
  source = rewriteOnce(source, 'from "./selected-label-pages.mjs";',
    `from "${pathToFileURL(path.join(FN_DIR, 'selected-label-pages.mjs')).href}";`);
  source = rewriteOnce(source, 'from "../_shared/linear-create-id.mjs";',
    `from "${pathToFileURL(path.join(ROOT, 'supabase', 'functions', '_shared', 'linear-create-id.mjs')).href}";`);
  source = rewriteOnce(source, 'Deno.serve(', 'globalThis.__nirServe(');

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nir-reconcile-'));
  const rewritten = path.join(scratch, 'production-write.rewritten.ts');
  fs.writeFileSync(rewritten, source);

  globalThis.Deno = { env: { get: name => process.env[name] } };
  const background = [];
  globalThis.EdgeRuntime = { waitUntil: promise => { background.push(Promise.resolve(promise).catch(() => null)); } };

  /* The recording fetch. `linear` defaults to 'down': native completion must
     never need the provider, and the lane asserts the request log stays empty
     of provider and drainer traffic. */
  const net = { linear: 'down', requests: [] };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch (_e) { body = null; }
    net.requests.push({ url, op: body && body.query ? String(body.query).slice(0, 40) : null });
    if (url.startsWith('https://api.linear.app/')) {
      if (net.linear === 'down') throw new TypeError('fetch failed: provider unreachable');
      const query = String(body && body.query || '');
      const variables = body && body.variables || {};
      if (/ProductionWriteProjectScope/.test(query)) {
        return new Response(JSON.stringify({ data: { project: {
          id: variables.id, name: 'Fixture Project',
          teams: { nodes: [{ id: 'team_fixture_video', key: 'VID' }, { id: 'team_fixture_graphics', key: 'GRA' }] },
        } } }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    }
    if (/\/functions\/v1\/linear-outbound$/.test(url)) {
      return new Response(JSON.stringify({ ok: false, error: 'drainer_unavailable_in_proof' }), { status: 503 });
    }
    if (/rest\/v1\/rpc\/b4_service_role_probe/.test(url)) return new Response('false', { status: 200 });
    return new Response('', { status: 500 });
  };

  process.env.SUPABASE_URL = 'http://supabase.fixture.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service-role-key';
  process.env.ROLE_KEY_ADMIN = 'fixture-admin-key';
  process.env.ROLE_KEY_SMM = 'fixture-smm-key';
  process.env.ROLE_KEY_CREATIVE = 'fixture-creative-key';
  process.env.LINEAR_READ_API_KEY = 'fixture-linear-read-key';
  delete process.env.GRAPHIC_TITLE_API_KEY;

  let handler = null;
  globalThis.__nirServe = fn => { handler = fn; };
  await import(pathToFileURL(rewritten).href);
  if (typeof handler !== 'function') throw new Error('Deno.serve handler was not captured');

  /* The browser's own item builder, so request payloads are what Submit sends. */
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const { extractFunction } = await import(pathToFileURL(path.join(ROOT, 'test', 'helpers', 'extract-function.js')).href)
    .then(m => m.default || m);
  const createdStatus = /const PROD_CREATED_STATUS = '([a-z_]+)';/.exec(html);
  if (!createdStatus) throw new Error('missing const PROD_CREATED_STATUS in index.html');
  const browser = { console, PROD_CREATED_STATUS: createdStatus[1] };
  vm.createContext(browser);
  vm.runInContext([
    extractFunction(html, '_linearVideoBrief'),
    extractFunction(html, '_linearThumbnailBrief'),
    extractFunction(html, '_linearIntakeItems'),
  ].join('\n'), browser);

  const STAFF = { 'x-syncview-key': 'fixture-admin-key', 'x-syncview-actor': 'Fixture Admin' };
  async function post(body, headers = STAFF) {
    const req = new Request('http://gateway.fixture.invalid/functions/v1/production-write', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const response = await handler(req);
    const json = await response.json().catch(() => ({}));
    await Promise.all(background.splice(0));
    return { status: response.status, json };
  }
  const stamps = new Map();
  function stamp(rid) {
    if (!stamps.has(rid)) stamps.set(rid, new Date(Date.now() - 1000).toISOString());
    return stamps.get(rid);
  }
  let seq = 0;
  function requestId(lane = 'submission') { seq += 1; return `${lane}:00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`; }
  function rootBody(mode, rid, overrides = {}) {
    const videos = [{ number: 1, main_cam: 'cam', side_cam: '', audio: '', notes: 'fixture note', dueDate: '2026-09-12' }];
    const items = browser._linearIntakeItems(mode, videos, rid);
    return {
      operation: 'intake_create', surface: 'submission', client_slug: 'fixture-client',
      request_id: rid, source_edited_at: stamp(rid),
      batch: { name: 'Fixture batch ' + rid.slice(-4), description: 'fixture notes', notes: 'fixture notes', filming_doc_url: null, footage_folder_url: null },
      items,
      ...overrides,
    };
  }
  return { handler, net, background, browser, post, STAFF, stamp, requestId, rootBody, scratch };
}
