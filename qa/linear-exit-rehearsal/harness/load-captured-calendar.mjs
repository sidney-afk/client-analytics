import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export const captureHashes = {
  'functions/calendar-upsert/index.ts': '5592a10798acabe2670e61867edbab73847c6eda65b0b2253b7f86756851fada',
  'functions/_shared/thumbnail-revisions.ts': 'fb32db55aedb8955a577a8ad67185acd5da68475a3eeccbbb8f593c077e6d4c9',
};
export async function loadCapturedCalendar() {
  const captureRoot = path.resolve(process.env.PROOF_HARNESS_ROOT, '../serving');
  for (const [file, expected] of Object.entries(captureHashes)) {
    const actual = createHash('sha256').update(fs.readFileSync(path.join(captureRoot, file))).digest('hex');
    if (actual !== expected) throw Error('captured source hash mismatch: ' + file);
  }
  let source = fs.readFileSync(path.join(captureRoot, 'functions/calendar-upsert/index.ts'), 'utf8');
  function once(needle, replacement) {
    if (source.split(needle).length !== 2) throw Error('captured writer seam drift: ' + needle);
    source = source.replace(needle, replacement);
  }
  once('"npm:@supabase/supabase-js@2.49.8"', JSON.stringify(pathToFileURL(path.join(process.env.PROOF_HARNESS_ROOT, 'sdk.mjs')).href));
  once('"../_shared/thumbnail-revisions.ts"', JSON.stringify(pathToFileURL(path.join(captureRoot, 'functions/_shared/thumbnail-revisions.ts')).href));
  once('Deno.serve(', 'globalThis.__capturedCalendarServe(');
  const generated = path.join(process.env.PROOF_OUTPUT_ROOT, 'captured-calendar-generated.ts');
  fs.writeFileSync(generated, source);
  let handler;
  globalThis.__capturedCalendarServe = value => { handler = value; };
  await import(pathToFileURL(generated).href);
  if (typeof handler !== 'function') throw Error('captured Calendar handler not loaded');
  return {post(body, headers) {
    return handler(new Request('http://captured.fixture.invalid/functions/v1/calendar-upsert', {
      method: 'POST', headers, body: JSON.stringify(body),
    }));
  }};
}
