import {createHash} from 'node:crypto';
// Source transformation is exact and bounded; the serving capture is never edited.
export const helperSourceHashes = new Set([
  '8e8478cb8812688656fb5dee5fe022dd32090722da9db78f12556459de81cb51',
  'fb32db55aedb8955a577a8ad67185acd5da68475a3eeccbbb8f593c077e6d4c9',
]);
export function composeFollowupHelper(bytes) {
  const hash=createHash('sha256').update(bytes).digest('hex');
  if(!helperSourceHashes.has(hash))throw Error('FOLLOWUP_HELPER_SOURCE_DRIFT');
  let source=bytes.toString('utf8');
  const once=(old,next)=>{if(source.split(old).length!==2)throw Error('FOLLOWUP_HELPER_SEAM_DRIFT');source=source.replace(old,next);};
  const dependency='import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";';
  once(dependency,'');
  once('const { error } = await supabase.storage.from(BUCKET).upload(path, dl.bytes, {',
       'const { data: stored, error } = await supabase.storage.from(BUCKET).upload(path, dl.bytes, {');
  once('return { path, contentType: dl.contentType, bytes: dl.bytes.byteLength };',
       'if (!stored || typeof stored.path !== "string") throw new Error("immutable snapshot path missing");\n  return { path: stored.path, contentType: dl.contentType, bytes: dl.bytes.byteLength };');
  // Export a per-attempt factory so transport/deadline state cannot leak across
  // overlapping workers in an Edge isolate. No global fetch replacement.
  source=source.replaceAll('export ','');
  const generated=dependency+'\nexport function createFollowupHelpers(fetch: typeof globalThis.fetch) {\n'+source+
    '\nreturn {captureGraphicTweakBaseline,scanGraphicTweakResolution};\n}\n';
  return {source:generated,source_sha256:hash,candidate_sha256:createHash('sha256').update(generated).digest('hex')};
}
