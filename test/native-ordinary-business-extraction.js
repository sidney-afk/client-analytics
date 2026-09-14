'use strict';
const fs=require('fs'),assert=require('assert/strict');
const source=fs.readFileSync('test/native-ordinary-receipts-postgres.js','utf8'),helper=fs.readFileSync('test/helpers/native-ordinary-business-assertions.js','utf8');
// Historical source follows repository LF checkout policy; frozen helper retains tested bytes.
// Only CRLF transport is ignored when comparing these verbatim source sections.
const lines=s=>s.replace(/\r\n/g,'\n');
const sections=[source.slice(source.indexOf('const literal ='),source.indexOf('async function main()')),source.slice(source.indexOf('    const deliverableCases ='),source.indexOf('    // The gateway has no non-comment batch')),source.slice(source.indexOf('    const commentAddEvent ='),source.indexOf('    // Accepted native replay precedes'))];
for(let i=0;i<sections.length;i++)assert.equal(lines(helper.split('// BEGIN ORIGINAL SECTION '+i+'\n')[1].split('// END ORIGINAL SECTION '+i+'\n')[0]),lines(sections[i]));
console.log('NATIVE_ORDINARY_BUSINESS_EXTRACTION_OK 3 verbatim sections modulo checkout CRLF; no runtime claim');
