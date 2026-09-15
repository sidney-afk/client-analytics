'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');const root=path.resolve(__dirname,'..');
function pinned(file,hash){const b=fs.readFileSync(path.join(root,file));if(crypto.createHash('sha256').update(b).digest('hex')!==hash)throw Error('WR101_SOURCE_DRIFT');return b.toString('utf8');}
function once(source,from,to){if(source.split(from).length!==2)throw Error('WR101_SEAM_DRIFT');return source.replace(from,to);}
function gateway(){let source=pinned('supabase/functions/production-write/index.ts','a13f4c27cc1666c814f43a506a694a1189dab38c4f5aa2d4d1b8458c18bc4767');
 source='import { captureRefusalContext, captureVerifiedPrincipal, reportGatewayRefusal } from "../_shared/write-refusal-diagnostics.mjs";\n'+source;
 source=once(source,'async function authenticate(','async function authenticateWithoutDiagnostics(');
 source+='\nasync function authenticate(supabase: SupabaseClient, req: Request, body: JsonMap, targetClientSlug: string): Promise<Principal> { const principal = await authenticateWithoutDiagnostics(supabase, req, body, targetClientSlug); captureVerifiedPrincipal(req, principal); return principal; }\n';
 source=once(source,'    if (!body || Array.isArray(body)) throw new GatewayError(400, "invalid_json");','    if (!body || Array.isArray(body)) throw new GatewayError(400, "invalid_json");\n    captureRefusalContext(req, body);');
 source=once(source,'      return json({ ok: false, error: error.code, ...(error.detail || {}) }, error.status);','      return await reportGatewayRefusal(supabase, req, error, json({ ok: false, error: error.code, ...(error.detail || {}) }, error.status));');
 return {source,separate_release_required:true,default_source_changed:false};}
function browser({endpoint}){if(!/^https:\/\/[a-z]{20}\.supabase\.co\/functions\/v1\/write-diagnostics$/.test(endpoint))throw Error('WR101_ENDPOINT');let source=pinned('index.html','f3330147d5530ca0b6ee2338f95ce30132bf3ab320c1371fe98ca85374e36cf0');
 const helper=`    let _writeRefusalBudget = 20;
    function _writeRefusalBeacon(surface, outcome, item, error) {
        if (outcome !== 'ui_write_failure' || _writeRefusalBudget <= 0) return;
        _writeRefusalBudget--;
        try {
            const identifiers = {};
            const context = _writeUiDiagnosticIds(item);
            for (const key of ['id','client_slug','card','component','comment','parent','request_id']) if (typeof context[key] === 'string' && context[key].length <= 256) identifiers[key] = context[key];
            const body = JSON.stringify({action:'browser_claim',surface,operation:item && item.kind,code:error && error.code,status:409,identifiers});
            if (new TextEncoder().encode(body).length > 2048) return;
            const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 1500);
            fetch(${JSON.stringify(endpoint)}, {method:'POST',headers:{'content-type':'application/json'},body,credentials:'omit',keepalive:true,signal:controller.signal}).catch(() => {}).finally(() => clearTimeout(timer));
        } catch (_) {}
    }
`;
 const seam='    function _writeUiQueueDiagnostic(surface, outcome, item, error) {';
 source=once(source,seam,helper+seam+'\n        _writeRefusalBeacon(surface, outcome, item, error);');
 return {source,separate_release_required:true,default_source_changed:false,browser_claims_verified:false,per_page_report_limit:20};}
module.exports={gateway,browser};
