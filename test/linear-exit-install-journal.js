'use strict';
const assert=require('assert/strict'),j=require('../scripts/linear-exit-install-journal');let n=0;
for(const sql of ['begin;savepoint x;commit;begin;rollback to x;commit;','commit;','begin;select 1;','copy x from stdin;','vacuum x;','create index concurrently x on y(z);','set search_path=public;select 1;','begin;set search_path=public;commit;','call x();','begin read only;select 1;commit;']){assert.throws(()=>j.chunks(sql));n++;}
assert.equal(j.chunks('begin;savepoint a;select 1;rollback to a;release a;commit;select 2;').length,2);n++;
assert.equal(j.chunks('create function f() returns text language sql as $$select \'commit;\'$$;').length,1);n++;
assert.throws(()=>j.compile(Buffer.from('{}'),'a'.repeat(64)));n++;
console.log('INSTALL_JOURNAL_OFFLINE_OK '+n);
