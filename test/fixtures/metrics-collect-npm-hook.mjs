// Offline loader for test/analytics-metrics-collect-function.js: the Edge
// Function imports the Supabase client by an npm: specifier Node cannot
// resolve, so it is pointed at an in-memory stand-in.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const stub = pathToFileURL(path.join(path.dirname(new URL(import.meta.url).pathname), 'metrics-collect-supabase-stub.mjs')).href;
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('npm:@supabase/supabase-js')) return { url: stub, shortCircuit: true };
  return next(specifier, context);
}
