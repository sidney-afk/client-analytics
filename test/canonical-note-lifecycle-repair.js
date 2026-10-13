'use strict';
// The one-time repair for Calendar notes done/deleted only in legacy
// (OPEN_REPAIRS, Mender 2026-10-13): dry run by default, counts only, and
// apply can never reopen or undelete a canonical note.
const assert = require('assert/strict');
const r = require('../scripts/canonical-note-lifecycle-repair.js');

const dry = r.build([]);
assert.doesNotMatch(dry, /\bupdate\b/i, 'the default is a dry run with no write');
assert.doesNotMatch(dry, /\bbody\b|author_name/, 'the dry run never selects note text or names');
assert.match(dry, /count\(\*\)/);
assert.throws(() => r.build(['--apply']), /needs --client/, 'apply needs an explicit scope');
assert.throws(() => r.build(['--client=x\'; drop']), /bad --client/);
const apply = r.build(['--apply', '--client=fixture-client']);
assert.match(apply, /p\.client = 'fixture-client'/);
assert.doesNotMatch(apply, /(resolved_at|deleted_at)\s*=\s*null/i, 'apply never clears resolved_at or deleted_at');
assert.match(apply, /p\.want_resolve and c\.resolved_at is null and c\.deleted_at is null/);
assert.match(apply, /p\.want_delete and c\.deleted_at is null/);
assert.match(apply, /native_comment_id = l\.lid/, 'native id is the preferred match');
assert.match(apply, /having count\(\*\) = 1/, 'a created_at match must be unique');
assert.doesNotMatch(r.build(['--apply', '--all']), /p\.client =/);
console.log('canonical-note-lifecycle-repair: dry run by default, never reopens ✅');
