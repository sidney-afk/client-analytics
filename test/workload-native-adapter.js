'use strict';
// Offline registration only. SQL/capture execution requires the separate
// explicitly owned fixture rehearsal; no process-env connection is loaded.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const exact=require('../qa/workload-consistency/lossless-json'),adapter=require('../qa/workload-consistency/native-adapter');
const {compare}=require('../qa/workload-consistency/compare');
let checks=0;const check=(name,fn)=>{fn();checks++;};
check('exact bigint and decimal lexemes survive',()=>{const text='{"a":9007199254740993,"b":-123.456789012345678901,"c":1e+30}';assert.equal(exact.stringify(exact.parse(text)),text);});
check('same JavaScript number is not same captured number',()=>{assert.equal(Number('9007199254740993'),Number('9007199254740992'));assert.equal(exact.equal(exact.parse('9007199254740993'),exact.parse('9007199254740992')),false);});
check('number lexeme cannot be confused with a similarly shaped object',()=>assert.equal(exact.equal(exact.parse('1'),exact.parse('{"raw":"1"}')),false));
for(const text of ['{"x":1,"x":2}','01','+1','[1,]','{"a":}','{"a":"bad\nline"}','true false','1e','['.repeat(101)+'0'+']'.repeat(101)])check('malformed or ambiguous JSON refuses',()=>assert.throws(()=>exact.parse(text),/LOSSLESS_JSON_INVALID/));
check('safe browser numeric values convert explicitly',()=>assert.equal(exact.browserValue(exact.parse('42')),42));
check('unsafe browser number refuses instead of rounding',()=>assert.throws(()=>exact.browserValue(exact.parse('9007199254740993')),/UNSAFE_BROWSER_NUMBER/));
check('ignored native sort key remains exact while normal sort order cannot round',()=>{assert.equal(exact.browserValue(exact.parse('{"native_sort_key":9007199254740993}')).native_sort_key,'9007199254740993');assert.throws(()=>exact.browserValue(exact.parse('{"sort_order":9007199254740993}')),/UNSAFE_BROWSER_NUMBER/);});
const raw=nodes=>({issue:{labels:{nodes,pageInfo:{hasNextPage:false}}}});
check('complete empty label relation is represented',()=>assert.deepEqual(adapter.labels(raw([])),{complete:true,labels:[]}));
check('paged labels refuse completeness',()=>{const r=raw([]);r.issue.labels.pageInfo.hasNextPage=true;assert.equal(adapter.labels(r).complete,false);});
check('selected label IDs require complete matching set',()=>{const r=raw([{id:'a',name:'3× Workload'}]);r.issue.labelIds=['b'];assert.equal(adapter.labels(r).complete,false);});
check('duplicate IDs or names refuse',()=>{assert.equal(adapter.labels(raw([{id:'a',name:'A'},{id:'a',name:'B'}])).complete,false);assert.equal(adapter.labels(raw([{id:'a',name:'A'},{id:'b',name:'A'}])).complete,false);});
check('workload color and SQL ASCII-space trim remain exact',()=>assert.deepEqual(adapter.labels(raw([{id:' a ',name:' 3× Workload ',color:'#aabbcc'}])),{complete:true,labels:[{id:'a',name:'3× Workload',color:'#AABBCC'}]}));
check('non-string label scalar is explicitly unrepresented',()=>assert.throws(()=>adapter.labels(raw([{id:exact.parse('123'),name:'A'}])),/UNREPRESENTED/));
check('Unicode length matches PostgreSQL characters for nodes and selection',()=>{const text='🙂'.repeat(101),r=raw([{id:text,name:text}]);r.issue.labelIds=[text];assert.equal(adapter.labels(r).complete,true);assert.ok(text.length>200&&[...text].length===101);assert.equal(adapter.labels(raw([{id:'id',name:'🙂'.repeat(201)}])).complete,false);});
check('native no-provider-parent is work; imported no-parent is container',()=>{const b={linear_parent_ids:{}};assert.equal(adapter.container({id:'del_a',linear_issue_uuid:null,linear_raw:{}},b),false);assert.equal(adapter.container({id:'b1_a',linear_issue_uuid:null,linear_raw:{}},b),true);});
check('exact parent alias classifies structural container',()=>assert.equal(adapter.container({id:'del_a',linear_issue_uuid:'parent',linear_raw:{}},{linear_parent_ids:{video:{uuid:'parent'}}}),true));
const snapshot={schema:'workload-consistency/v1',native:[{id:'del_a',linearId:null,ownerId:'member',team:'video',kind:'video',scope:'synthetic',status:'todo',dueDate:null,archived:false,container:false}],
 workload:[],production:[],provider:[],calendar:[],samples:[],members:[{id:'member',active:true,teams:['video'],roles:['creative']}],expected:[],coverage:{native:{complete:true},workload:{complete:true},members:{complete:true}}};
check('existing comparator native scope detects missing native-only work',()=>{const r=compare(snapshot,{scope:'native_workload',eligibility:()=> 'eligible'});assert.equal(r.counts.native_missing_from_workload,1);assert.equal(r.counts.incomplete_input,undefined);assert.equal(r.populationVerdict,'UNPROVEN');});
check('historical default scope still requires all original surface coverage',()=>{const r=compare(snapshot);assert.ok(r.counts.incomplete_input>0);assert.ok(r.counts.production_absence_unproven>0);assert.equal(r.populationVerdict,'UNPROVEN');});
check('native mode cannot run without independent eligibility adapter',()=>assert.throws(()=>compare(snapshot,{scope:'native_workload'}),/NATIVE_ELIGIBILITY_REQUIRED/));
check('capture component remains a separate unchanged acquisition boundary',()=>{const source=fs.readFileSync(path.join(__dirname,'../qa/workload-consistency/native-capture.js'),'utf8');assert.ok(source.includes("native_comparison:'NOT_IMPLEMENTED'"));});
console.log('PASS '+checks+' offline native adapter controls; native SQL/browser population and G5 UNPROVEN in this lane');
