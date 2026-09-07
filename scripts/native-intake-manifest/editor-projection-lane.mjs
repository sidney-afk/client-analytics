// Reuse the reviewed actual-handler loader, SQL foundation and request builder.
// Only its finite journey section is replaced; old assignee tests stay intact.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const original=fs.readFileSync(path.join(here,'assignee-lane.mjs'),'utf8');
const marker='/* ---------- 5. Journeys ---------- */';
if(original.split(marker).length!==2) throw Error('reviewed loader seam drift');
let prefix=original.split(marker)[0];
function once(needle,value) {if(prefix.split(needle).length!==2) throw Error('loader seam drift');prefix=prefix.replace(needle,value);}
once("const HERE = path.dirname(fileURLToPath(import.meta.url));",'const HERE = '+JSON.stringify(here)+';');
once("from './supabase-shim.mjs';",'from '+JSON.stringify(pathToFileURL(path.join(here,'supabase-shim.mjs')).href)+';');
once("from './fault-shim.mjs';",'from '+JSON.stringify(pathToFileURL(path.join(here,'editor-projection-shim.mjs')).href)+';');
once("path.join(HERE, 'fault-shim.mjs')","path.join(HERE, 'editor-projection-shim.mjs')");
const runner=fs.mkdtempSync(path.join(os.tmpdir(),'intake-editor-lane-'));
try {
  const file=path.join(runner,'run.mjs');
  fs.writeFileSync(file,prefix+fs.readFileSync(path.join(here,'editor-projection-journeys.mjs'),'utf8'));
  await import(pathToFileURL(file).href);
} finally {
  if(path.dirname(path.resolve(runner))!==path.resolve(os.tmpdir())) throw Error('unsafe scratch directory');
  fs.unlinkSync(path.join(runner,'run.mjs')); fs.rmdirSync(runner);
}
