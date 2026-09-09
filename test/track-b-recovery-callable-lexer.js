'use strict';
// Actual exported classifier, offline SQL text only. No SQL execution claim.
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const recovery=require('../scripts/track-b-recovery-package');
const checks=[];const check=(name,fn)=>{fn();checks.push(name);};
const wrap=body=>'CREATE FUNCTION public.synthetic_wrapper() RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $outer$'+body+'$outer$';
const hit=body=>({schema:'public',name:'synthetic_wrapper',volatility:'i',security_definer:false,language:'plpgsql',body,body_sha256:'synthetic'});
const classify=body=>recovery.classifyCallable('public.synthetic_wrapper',[hit(body)],new Set(),new Set(),()=>{});
const calls=text=>[...recovery.callNamesIn(text)].sort();
const hidden="DECLARE marker text; BEGIN marker := '/*'; PERFORM public.synthetic_write(); marker := '*/'; RETURN true; END";
check('original literal-comment bypass refuses at reader and capture classifiers',()=>{
  assert.equal(recovery.functionPurity(wrap(hidden)).pure,false);
  assert.deepEqual(recovery.functionPurity(wrap(hidden)).calls,['public.synthetic_write']);
  assert.throws(()=>classify(hidden),/writing statement/);
});
check('unhidden original PERFORM negative remains refused',()=>assert.throws(()=>classify('BEGIN PERFORM public.synthetic_write(); RETURN true; END'),/writing statement/));
for(const literal of ["'/*'", "'--'", "'it''s /* --'", "E'escaped \\' /* --'", "$inner$/* -- public.fake()$inner$", "U&'\\0061 /* --'"]){
  check('literal cannot conceal following executed target '+literal,()=>{
    const body='BEGIN x := '+literal+'; RETURN public.synthetic_write(); END';
    assert.deepEqual(calls(body),['public.synthetic_write']);
    const visited=[];recovery.classifyCallable('public.synthetic_wrapper',[hit(body)],new Set(),new Set(),s=>visited.push(...calls(s)));
    assert.deepEqual(visited,['public.synthetic_write']);
  });
}
check('plain/e/dollar strings containing writing words create no false refusal',()=>{
  const body="BEGIN x := 'PERFORM public.fake(); /*'; y := E'DELETE -- \\'quoted\\''; z := $q$INSERT public.fake();$q$; RETURN true; END";
  assert.equal(recovery.functionPurity(wrap(body)).pure,true);
  assert.deepEqual(calls(body),[]);assert.equal(classify(body).class,'public_pure');
});
check('nested block and line comments hide only actual comment content',()=>{
  const body='BEGIN /* outer \' /* nested */ public.fake(); */ -- /* public.fake2()\n RETURN public.real(); END';
  assert.deepEqual(calls(body),['public.real']);
  assert.equal(recovery.functionPurity(wrap(body)).pure,true);
});
check('stripBlockComments leaves comment markers in every quoted token untouched',()=>{
  const text="'/*literal*/' E'--literal' \"/*identifier*/\" $q$/*dollar*/$q$ /* actual /* nested */ removed */ SELECT 1";
  assert.equal(recovery.stripBlockComments(text),"'/*literal*/' E'--literal' \"/*identifier*/\" $q$/*dollar*/$q$   SELECT 1");
});
check('dollar-body extraction ignores markers in comments and ordinary literals',()=>{
  const text="/* $fake$PERFORM public.fake()$fake$ */ CREATE FUNCTION public.f() RETURNS text LANGUAGE sql IMMUTABLE AS $body$ SELECT '$inside$' $body$";
  const parsed=recovery.stripDollarQuoted(text);assert.equal(parsed.bodies.length,1);
  assert.equal(parsed.bodies[0],"$body$ SELECT '$inside$' $body$");
  assert.equal(recovery.functionPurity(text.trim().replace(/^\/\*[\s\S]*?\*\/\s*/,'' )).pure,true);
});
check('Unicode dollar tags cannot turn the entire executable body into a literal',()=>{
  const text='CREATE FUNCTION public.f() RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $é$ BEGIN PERFORM public.synthetic_write(); RETURN true; END $é$';
  assert.equal(recovery.functionPurity(text).pure,false);assert.deepEqual(calls('x := $é$fake()$é$; public.real()'),['public.real']);
});
for(const name of ['public."synthetic_write"','"public".synthetic_write','"public" . /* gap */ "synthetic_write"']){
  check('quoted executable identity is retained '+name,()=>assert.deepEqual(calls(name+'()'),['public.synthetic_write']));
}
check('quoted target cannot be replaced by the old q not-a-function contract',()=>{
  const sql='CREATE TABLE public.t (id integer CHECK(public."synthetic_write"()))';
  assert.throws(()=>recovery.verifyCallableContract([sql],{callable_references:{q:{class:'not_a_function',name:'q'}},prerequisites:{required_extensions:[]}}),/outside the manifest/);
});
check('known quoted pure function and transitive real target pass exact reader contract',()=>{
  const fn='CREATE FUNCTION public."synthetic_wrapper"() RETURNS integer LANGUAGE sql IMMUTABLE AS $$SELECT pg_catalog.length(\'abc\')$$';
  const manifest={callable_references:{'public.synthetic_wrapper':{class:'public_pure',name:'synthetic_wrapper'},'pg_catalog.length':{class:'pg_catalog',name:'length'}},prerequisites:{required_extensions:[]}};
  assert.deepEqual(recovery.verifyCallableContract(['CREATE TABLE public.t (id integer CHECK(public."synthetic_wrapper"()>0))',fn],manifest).pure_functions,['synthetic_wrapper']);
});
check('quoted keyword names and lower/upper are real dependency candidates',()=>assert.deepEqual(calls('"select"(1), lower(x), upper(x), coalesce(x,0)'),['lower','select','upper']));
check('quoted writing-word identifiers are not writing statements',()=>assert.equal(recovery.functionPurity(wrap('DECLARE "update" text; BEGIN "update" := \'a\'; RETURN true; END')).pure,true));
for(const text of ['public."MixedCase"()','public."quote""name"()','public."dot.name"()','public.U&"synthetic_\\0077rite"()','database.public.fn()']){
  check('unrepresentable callable identity fails explicitly '+text,()=>assert.throws(()=>calls(text),/Unsupported callable identifier/));
}
for(const text of ["'unterminated",'"unterminated','/* unterminated', '$body$unterminated',"'ambiguous\\' next() '"]){
  check('malformed or mode-ambiguous text never classifies as empty '+text,()=>assert.throws(()=>calls(text),/Unterminated|Ambiguous/));
}
check('strings and comments cannot supply a fake IMMUTABLE modifier',()=>{
  assert.equal(recovery.functionPurity('CREATE FUNCTION public."IMMUTABLE"() RETURNS text LANGUAGE sql /* IMMUTABLE */ AS $$select \'IMMUTABLE\'$$').pure,false);
});
check('absent or malformed private body is refused instead of treated as empty',()=>{
  for(const body of [undefined,null,{},0])assert.throws(()=>recovery.classifyCallable('public.synthetic_wrapper',[hit(body)],new Set(),new Set(),()=>{}),/lacks a public callable body/);
});
check('query carries private prosrc directly and classification only returns hashes',()=>{
  assert.match(recovery.callableResolutionSql(['public.synthetic_wrapper']),/'body', prosrc/);
  const result=classify("BEGIN RETURN 'private sentinel'; END");
  assert.equal(JSON.stringify(result).includes('private sentinel'),false);assert.equal(Object.hasOwn(result,'body'),false);
  const source=fs.readFileSync(path.resolve(__dirname,'../scripts/track-b-recovery-package.js'),'utf8');
  assert.match(source,/resolveCallableContract\(query, seedTokens, edges, requiredExtensionNames\)/);
});
console.log(JSON.stringify({status:'PASS',passed:checks.length,checks,proof:'offline_actual_exports_no_SQL_execution'}));
