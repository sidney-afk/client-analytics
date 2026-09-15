'use strict';
const assert=require('node:assert/strict'),{prepare}=require('../scripts/prepare-urgent-editor-website-only');
const code="const syncUrl = 'https://syncview.synchrosocial.com/?prod=1&d=' + encodeURIComponent(parse.identifier) + '#production';\nlet text = 'URGENT TWEAKS NEEDED\\nClient: ' + client + '\\nBy when: ASAP\\nSyncView: ' + syncUrl + '\\nLinear: ' + issue;\nreturn {text};";
const input={nodes:[{name:'synthetic',parameters:{jsCode:code}},{parameters:{channel:'unchanged',text:'{{$json.text}}'}}],connections:{synthetic:{main:[]}},settings:{unchanged:true}};
const out=prepare(input);assert.equal(input.nodes[0].parameters.jsCode,code);assert.deepEqual(out.connections,input.connections);assert.deepEqual(out.nodes[1],input.nodes[1]);assert.deepEqual(out.settings,input.settings);
function render(s){return Function('parse','client','issue',s)({identifier:'SYN-123'},'Synthetic','https://linear.app/synthetic').text;}
assert.equal(render(out.nodes[0].parameters.jsCode),render(code).split('\nLinear: ')[0]);assert.match(render(out.nodes[0].parameters.jsCode),/SyncView: https:\/\/syncview/);
assert.throws(()=>prepare(out));assert.throws(()=>prepare({nodes:[]}));assert.throws(()=>prepare({nodes:[input.nodes[0],input.nodes[0]]}));assert.throws(()=>prepare({nodes:[{parameters:{jsCode:code.replace('https://syncview.','https://different.')}}]}));
console.log('URGENT_EDITOR_WEBSITE_ONLY_OK: exact one-line preparation, recipient/graph preserved, four drift refusals; no network');
