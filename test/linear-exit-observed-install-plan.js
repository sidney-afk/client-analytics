'use strict';
const assert=require('assert/strict'),api=require('../scripts/linear-exit-observed-install-plan');
const sql="begin;\r\ncreate function public.synthetic_transport() returns text language sql as $$select E'line\\r\\n';\r\n$$;\r\ncommit;\r\n";
assert.equal(api.sqlTransport(sql),sql);
assert.equal(api.sqlTransport('\\set ON_ERROR_STOP on\r\n'+sql),sql);
for(const bad of ['\\set ON_ERROR_STOP off\n'+sql,'\\i other.sql\n'+sql,'begin;\n\\set ON_ERROR_STOP on\ncommit;','\\set ON_ERROR_STOP on\n\\set ON_ERROR_STOP on\n'+sql])assert.throws(()=>api.sqlTransport(bad));
assert.throws(()=>api.build({tables:[],functions:[]}),/exact starting public catalog required/);
console.log('OBSERVED_INSTALL_PLAN_OFFLINE_OK 7; full transition not proved');
