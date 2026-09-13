'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {Cluster,FOUNDATION_SQL}=require('../scripts/f42-apply-rehearsal');
const control=require('../scripts/linear-exit-control-companion').forProfile(process.argv.includes('--diagnostics')?'core+diagnostics':'core');
assert.equal(process.env.F63_REQUIRE_POSTGRES,'1');const c=new Cluster();assert.equal(c.host,'127.0.0.1');
try{c.start();c.exec(FOUNDATION_SQL.slice(0,FOUNDATION_SQL.indexOf('create table if not exists public.team_members')));c.exec(control.sourceSql());const catalog=c.scalarJson('set search_path=pg_catalog,public;'+control.catalogSql());for(const name of control.NAMES)assert(catalog[name].table);fs.writeFileSync(path.join(process.env.PROOF_OUTPUT_ROOT,'control-schema.private.json'),JSON.stringify({classification:'ISOLATED_SOURCE_CONTROL_SCHEMA',owners:control.OWNERS,catalog},null,2)+'\n',{flag:'wx'});console.log('LINEAR_EXIT_CONTROL_SCHEMA_OK');}finally{c.stop();}
