'use strict';
/* The pure half of thumbnail-folder-resolve's folder_preview action (OPEN_REPAIRS 710): which folder id a link names,
 * first image BY NAME, and what a folder listing means. No network, no Deno. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');
const { stripTypeScriptTypes } = require('module');
const src = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'thumbnail-folder-resolve', 'index.ts'), 'utf8');
const pick = (from, to) => { const a = src.indexOf(from), b = src.indexOf(to); assert(a > 0 && b > a, 'marker ' + from); return src.slice(a, b); };
const code = [
  pick('function clean(', 'function hostOf('), pick('function isDriveFolderLink(', 'function extractDriveFileId('),
  pick('function addScheme(', 'function hostOf('),
  pick('const IMAGE_NAME_RE', 'async function listFolderPublic'),
].join('\n').replace(/export (function|type)/g, '$1');
const js = stripTypeScriptTypes(code);
const ctx = { URL }; vm.createContext(ctx); vm.runInContext(js + '\nthis.driveFolderId=driveFolderId;this.sortByName=sortByName;this.judgeListing=judgeListing;this.slugOf=slugOf;', ctx);
const { driveFolderId, sortByName, judgeListing, slugOf } = ctx;
const ID = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0';
assert.strictEqual(driveFolderId('https://drive.google.com/drive/folders/' + ID + '?usp=sharing'), ID);
assert.strictEqual(driveFolderId('drive.google.com/drive/u/0/folders/' + ID), ID);
assert.strictEqual(driveFolderId('https://drive.google.com/folderview?id=' + ID), ID);
assert.strictEqual(driveFolderId('https://drive.google.com/file/d/' + ID + '/view'), '', 'a file link is not a folder');
assert.strictEqual(driveFolderId('https://example.com/folders/' + ID), '');
assert.deepStrictEqual(Array.from(sortByName([{ name: '10.png' }, { name: '2.png' }, { name: '01.png' }]), x => x.name), ['01.png', '2.png', '10.png'], 'names sort the way a person reads them');
const f = (id, name, mimeType) => ({ id, name, mimeType });
assert.strictEqual(judgeListing([]).state, 'empty');
const a = judgeListing([f('c', '03.png', 'image/png'), f('a', '01.png', 'image/png'), f('b', '02.png', 'image/png')]);
assert.deepStrictEqual({ ...a }, { state: 'ok', count: 3, has_video: false, first_file_id: 'a' }, 'first image by name, not by list order');
const v = judgeListing([f('v', '00.mp4', 'video/mp4'), f('z', '09.jpg', 'image/jpeg'), f('y', '08.JPG', 'application/octet-stream')]);
assert.deepStrictEqual({ ...v }, { state: 'ok', count: 2, has_video: true, first_file_id: 'y' }, 'a video is noted, never previewed');
assert.strictEqual(judgeListing([f('d', 'notes.pdf', 'application/pdf')]).state, 'no_images');
assert.strictEqual(slugOf('Sidney Test-Client'), 'sidneytestclient');
// the function refuses without the flag and never reads Drive through the service account for a folder
assert(/previewAllowed/.test(src) && /clients/.test(src) && !/all === true/.test(pick('async function previewAllowed', 'async function folderPreview')), 'only listed clients; "all" is not honoured');
const listFn = pick('async function listFolderPublic', 'async function previewAllowed');
assert(!/serviceAccountToken|Authorization/.test(listFn), 'folder listing uses the API key only, so an unshared folder reads as not_shared');
console.log('carousel-folder-preview-resolver: ok');
