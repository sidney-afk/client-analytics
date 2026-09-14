import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {captureHashes} from './load-captured-calendar.mjs';
// Preparation candidate only. Original serving capture remains immutable.
export async function loadAtomicCalendar({sdkModulePath}={}) {
 const captureRoot=path.resolve(process.env.PROOF_HARNESS_ROOT,'../serving');
 for(const [file,expected] of Object.entries(captureHashes)){
  if(createHash('sha256').update(fs.readFileSync(path.join(captureRoot,file))).digest('hex')!==expected)throw Error('ATOMIC_CAPTURE_HASH_MISMATCH');
 }
 const {compose}=await import('../../../scripts/linear-exit-atomic-writer-compose.js');
 const production=compose('calendar',fs.readFileSync(path.join(captureRoot,'functions/calendar-upsert/index.ts')));
 let source=production.source;
 function once(old,next){if(source.split(old).length!==2)throw Error('ATOMIC_SOURCE_SEAM_DRIFT');source=source.replace(old,next);}
 once('"npm:@supabase/supabase-js@2.49.8"',JSON.stringify(pathToFileURL(sdkModulePath||path.join(process.env.PROOF_HARNESS_ROOT,'sdk.mjs')).href));
 once('"../_shared/thumbnail-revisions.ts"',JSON.stringify(pathToFileURL(path.join(captureRoot,'functions/_shared/thumbnail-revisions.ts')).href));
 once('Deno.serve(','globalThis.__atomicCalendarServe(');
 const generated=path.join(process.env.PROOF_OUTPUT_ROOT,'atomic-calendar-candidate.ts');fs.writeFileSync(generated,source);
 let handler;globalThis.__atomicCalendarServe=h=>handler=h;await import(pathToFileURL(generated).href);
 if(typeof handler!=='function')throw Error('ATOMIC_HANDLER_MISSING');
 return {production_sha256:production.sha256,source_sha256:createHash('sha256').update(source).digest('hex'),post(body,headers){return handler(new Request('http://atomic.fixture.invalid/functions/v1/calendar-upsert',{method:'POST',headers,body:JSON.stringify(body)}));}};
}
