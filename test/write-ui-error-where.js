'use strict';
/*
 * OPEN_REPAIRS 643 (session Reviewguard, 2026-11-02): an uncaught error's report says what kind of error it was and
 * where it came from, even when that is not this site, and never its message.
 *
 * Seen: 20 Workload reports in half an hour (2 Nov, 18:03 to 18:31 UTC) all read "TypeError at workload:0:0". The
 * rejection's stack had no frame from this site, so the helper fell back to an empty file, which new URL() resolved to
 * the page's own address. Nothing in the report said which TypeError it was.
 *
 * Runs the helpers from 120 (shared by Kasper's board, the client link, Workload and the Calendar) in a sandbox:
 *   1. a frameless TypeError ("Failed to fetch") reads "TypeError failed_to_fetch", with no invented place;
 *   2. a frame on another site keeps only its scheme, host and file name: no path, no query (a token), no fragment;
 *   3. a browser extension's frame reads "extension", never its id;
 *   4. this site's own file drops its build hash and keeps line, column and a plain function name;
 *   5. Safari's and Firefox's "fn@url:l:c" stacks are read too; a cross-origin "Script error." is script_error;
 *   6. no message text is ever sent, and every result survives the server's detail redaction (clean_detail_v1).
 * On main 1 to 5 fail (1 reads "TypeError at workload:0:0").
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index', '120-calendar-flags-write-repair.js.part'), 'utf8');
const from = src.indexOf('    const WRITE_UI_ERR_KINDS');
const to = src.indexOf('    function _writeUiReviewEvent(');
const start = from >= 0 ? from : src.indexOf('    function _writeUiErrWhere(');
assert(start >= 0 && to > start, 'the error-where helpers are in 120');
const ctx = { URL, location: new URL('https://syncview.example.test/workload') };
vm.createContext(ctx);
vm.runInContext(src.slice(start, to) + '\nthis._writeUiErrWhere = _writeUiErrWhere; this._writeUiStackWhere = _writeUiStackWhere;', ctx);
const { _writeUiErrWhere: errWhere, _writeUiStackWhere: stackWhere } = ctx;

// The server's detail redaction (write_refusal_diagnostics.clean_detail_v1), so a report is checked as it is stored.
const clean = s => String(s || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '[redacted]')
  .replace(/(https?:\/\/|www\.)\S+/g, '[redacted]').replace(/[A-Za-z0-9_+/=.-]{24,}/g, '[redacted]').replace(/[0-9]{7,}/g, '[redacted]').trim().slice(0, 200);
const err = (name, message, stack) => { const e = new (name === 'TypeError' ? TypeError : Error)(message); e.name = name; e.stack = stack; return e; };
const SECRET = 'Card title words SECRET';
const results = [];
const check = (got, want, what) => { results.push(got); assert.equal(got, want, what); assert.equal(clean(got), got, what + ': survives the server redaction'); };

// 1. Frameless, as Chrome gives a failed fetch from a library.
check(stackWhere(err('TypeError', 'Failed to fetch', 'TypeError: Failed to fetch')), 'TypeError failed_to_fetch', '1: a frameless TypeError says what it is and invents no place');
check(stackWhere(err('TypeError', 'Load failed', 'TypeError: Load failed')), 'TypeError load_failed', '1: Safari\'s failed fetch');

// 2. Another site's script: scheme, host and the file's own name only.
const offsite = err('TypeError', "Cannot read properties of undefined (reading '" + SECRET + "')",
  "TypeError: Cannot read properties of undefined\n    at Object.subscribe (https://cdn.example.net/npm/lib@2/dist/umd/supabase.min.js?token=abcdefSECRETTOKEN0123456789#frag:2:4567)\n    at https://cdn.example.net/x.js:1:1");
check(stackWhere(offsite), 'TypeError cannot_read_properties at https cdn.example.net supabase.min.js', '2: an off-site frame keeps scheme, host and file name');

// 3. An extension's frame.
check(stackWhere(err('TypeError', 'x is not a function', 'TypeError: x is not a function\n    at chrome-extension://abcdefghijklmnopabcdefghijklmnop/content.js:10:20')), 'TypeError extension at extension', '3: an extension reads as the word extension');

// 4. This site's own split-build file: the hash dropped, line, column and the function name kept; our frame wins.
const own = err('TypeError', 'a is not iterable', 'TypeError: a is not iterable\n    at https://cdn.example.net/lib.js:1:1\n    at HTMLDocument.wlRenderBoard (https://syncview.example.test/js/sv-04-workload-1d9b3f5f40a0.js:711:26961)');
check(stackWhere(own), 'TypeError not_iterable at sv-04-workload.js:711:26961 in wlRenderBoard', '4: this site\'s own frame, without its build hash');
check(errWhere('TypeError', 'https://syncview.example.test/js/sv-11-core-47c0d0f70e53.js', 12, 34, 'boom is not defined'), 'TypeError not_defined at sv-11-core.js:12:34', '4: an uncaught error event, from its file');
check(errWhere('TypeError', 'https://syncview.example.test/workload', 4, 17, 'q is not a function'), 'TypeError not_a_function at workload:4:17', '4: the page\'s own inline script keeps its real line');

// 5. Safari and Firefox stacks; the cross-origin "Script error."; an empty file is no place at all.
check(stackWhere(err('TypeError', 'undefined is not an object', 'wlTick@https://syncview.example.test/js/sv-04-workload-1d9b3f5f40a0.js:9:8\n@https://syncview.example.test/js/sv-04-workload-1d9b3f5f40a0.js:1:2')), 'TypeError cannot_read_properties at sv-04-workload.js:9:8 in wlTick', '5: a Safari stack');
check(errWhere('', '', 0, 0, 'Script error.'), 'Error script_error', '5: a cross-origin Script error.');
check(errWhere('TypeError', '', 0, 0, ''), 'TypeError', '5: an empty file is no place (it read as the page, "workload:0:0")');
check(stackWhere(err('AbortError', 'signal is aborted without reason', 'AbortError: signal is aborted without reason')), 'AbortError aborted', '5: an abort');
check(stackWhere(err('TypeError', SECRET, 'TypeError: ' + SECRET)), 'TypeError other', '5: a message it does not know is "other", never the message');

// 6. Nothing from any message, path or query reaches a report.
const all = JSON.stringify(results);
for (const bad of ['SECRET', 'Card title', 'token', 'frag', '/npm/', 'abcdefghijklmnop', ':0:0', '1d9b3f5f40a0']) assert(!all.includes(bad), 'no report carries "' + bad + '": ' + all);
console.log('write-ui-error-where: an uncaught error says what kind it was and where, on or off this site, never its message ✅');
