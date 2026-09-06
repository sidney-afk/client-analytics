/*
 * Loads the REPOSITORY sources of the two card writers, calendar-upsert and
 * sample-review-upsert, into this Node process through the same seam
 * load-gateway.mjs uses (supabase-js -> SQL shim, Deno.env -> process.env,
 * Deno.serve captured, relative imports resolved to repository files).
 *
 * WHAT THIS IS AND IS NOT. The lane needs the writers' WRITE SEMANTICS
 * (buildIncoming, applyGuards, writeCalendarRow / writeSampleRow, events) to
 * drive a genuine browser materialization payload into the disposable card
 * tables. The repository sources carry a fail-closed staff/client auth helper;
 * the SERVING v48 / v49 bodies are, by owner directive, un-gated and are not
 * this source. Nothing here proves those serving bodies. The lane authenticates
 * with a fixture staff key so the repository handler reaches its write path.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SHIM = path.join(ROOT, 'scripts', 'native-intake-manifest', 'supabase-shim.mjs');

function rewriteOnce(source, needle, replacement, file) {
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + 1) >= 0) {
    throw new Error(`writer seam does not match ${file} exactly once: ${needle}`);
  }
  return source.replace(needle, replacement);
}

async function loadOne(slug) {
  const file = path.join(ROOT, 'supabase', 'functions', slug, 'index.ts');
  let source = fs.readFileSync(file, 'utf8');
  source = rewriteOnce(source,
    'import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";',
    `import { createClient, SupabaseClient } from "${pathToFileURL(SHIM).href}";`, slug);
  source = rewriteOnce(source, 'from "../_shared/browser-write-auth.ts";',
    `from "${pathToFileURL(path.join(ROOT, 'supabase', 'functions', '_shared', 'browser-write-auth.ts')).href}";`, slug);
  source = rewriteOnce(source, 'from "../_shared/thumbnail-revisions.ts";',
    `from "${pathToFileURL(path.join(ROOT, 'supabase', 'functions', '_shared', 'thumbnail-revisions.ts')).href}";`, slug);
  source = rewriteOnce(source, 'Deno.serve(', 'globalThis.__nirServe(', slug);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nir-writer-'));
  const rewritten = path.join(scratch, slug + '.rewritten.ts');
  fs.writeFileSync(rewritten, source);
  let handler = null;
  globalThis.__nirServe = fn => { handler = fn; };
  await import(pathToFileURL(rewritten).href);
  if (typeof handler !== 'function') throw new Error(`Deno.serve handler was not captured for ${slug}`);
  return { handler, scratch };
}

/* Requires globalThis.Deno / EdgeRuntime / fetch to be installed already by
   load-gateway.mjs (same process). Returns one `post(slug, body, source)`
   helper that performs a browser-shaped write through the chosen writer. */
export async function loadWriters() {
  const calendar = await loadOne('calendar-upsert');
  const samples = await loadOne('sample-review-upsert');
  async function post(slug, body, source = 'submission-native') {
    const writer = slug === 'sample-review-upsert' ? samples : calendar;
    const req = new Request(`http://writers.fixture.invalid/functions/v1/${slug}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-syncview-key': 'fixture-admin-key',
        'x-syncview-source': source,
      },
      body: JSON.stringify(body),
    });
    return writer.handler(req);
  }
  return { post, scratches: [calendar.scratch, samples.scratch] };
}
