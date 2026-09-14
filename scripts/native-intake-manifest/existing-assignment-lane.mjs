// Reuse the reviewed real-handler loader, transport denial and SQL request
// builder. No copied assignment handler or modeled business policy.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const original=fs.readFileSync(path.join(here,'assignee-lane.mjs'),'utf8');
const marker='/* ---------- 5. Journeys ---------- */';
if(original.split(marker).length!==2)throw Error('reviewed handler loader seam drift');
let prefix=original.split(marker)[0];
function once(needle,value){if(prefix.split(needle).length!==2)throw Error('loader seam drift');prefix=prefix.replace(needle,value);}
once("const HERE = path.dirname(fileURLToPath(import.meta.url));",'const HERE = '+JSON.stringify(here)+';');
once("from './supabase-shim.mjs';",'from '+JSON.stringify(pathToFileURL(path.join(here,'supabase-shim.mjs')).href)+';');
once("from './fault-shim.mjs';",'from '+JSON.stringify(pathToFileURL(path.join(here,'editor-projection-shim.mjs')).href)+';');
once("path.join(HERE, 'fault-shim.mjs')","path.join(HERE, 'editor-projection-shim.mjs')");
const runner=fs.mkdtempSync(path.join(os.tmpdir(),'existing-assignment-'));
try {
  const file=path.join(runner,'run.mjs');
  const journey=fs.readFileSync(path.join(here,'existing-assignment-journeys.mjs'),'utf8');
  fs.writeFileSync(file,prefix+'\nconst assignmentJourneySha='+JSON.stringify(createHash('sha256').update(journey).digest('hex'))+';\n'+journey);
  await import(pathToFileURL(file).href);
}finally {
  if(path.dirname(path.resolve(runner))!==path.resolve(os.tmpdir()))throw Error('unsafe scratch directory');
  fs.unlinkSync(path.join(runner,'run.mjs')); fs.rmdirSync(runner);
}
