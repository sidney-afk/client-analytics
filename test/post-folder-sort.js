'use strict';
/*
 * The Post tab's folder sorting (plan row P2a, OPEN_REPAIRS 648): the pure function a dropped folder will go
 * through once P2 wires the drop zones (P2 waits for P1). It reads only file paths and says what each file is
 * for; it never reads a file, touches the page or posts anything. Every case from posting.md section 2,
 * "From files":
 *   - one video + one image + one text (the usual export folder): video, cover, caption;
 *   - hidden and system files (.DS_Store, Thumbs.db, ._*) skipped without a word;
 *   - type by extension, any case: video .mp4 .mov .m4v .webm, image .jpg .jpeg .png .webp, text .txt .md;
 *   - natural name order ("2" before "10");
 *   - several images: thumb* / cover* / thumbnail* is the cover; else, with one video, the person is asked;
 *     with no video they are a carousel in name order;
 *   - several videos: "This folder has 3 videos. Pick one.", in name order;
 *   - several text files: caption*.txt wins, else none fills and the reason is given;
 *   - everything else in one quiet line, "Ignored 2 files: .prproj, .wav";
 *   - two folders at once: refused, "Drop one folder at a time."
 *
 * Run: node --require ./test/helpers/single-file-index.js test/post-folder-sort.js
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { extractFunction } = require('./helpers/extract-function.js');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const sort = new Function(`${extractFunction(INDEX, 'svSortDroppedFiles')}\nreturn svSortDroppedFiles;`)();
const names = (list) => (list || []).map(f => f.path);
let checks = 0;
const ok = (fn, what) => { fn(); checks++; console.log('  ok  ' + what); };

ok(() => {
  const r = sort([{ path: 'Reel 15/final.mp4' }, { path: 'Reel 15/thumb.jpg' }, { path: 'Reel 15/caption.txt' }]);
  assert.equal(r.error, '');
  assert.equal(r.video.path, 'Reel 15/final.mp4');
  assert.equal(r.cover.path, 'Reel 15/thumb.jpg');
  assert.equal(r.caption.path, 'Reel 15/caption.txt');
  assert.deepEqual([r.ask, r.carousel, r.ignored, r.ignoredLine, r.captionNote], ['', [], [], '', '']);
}, 'the usual export folder: video, cover and caption');

ok(() => {
  const r = sort([{ path: 'F/.DS_Store' }, { path: 'F/Thumbs.db' }, { path: 'F/._final.mp4' }, { path: 'F/final.mp4' }, { path: 'F/sub/.hidden.txt' }]);
  assert.equal(r.video.path, 'F/final.mp4');
  assert.deepEqual(r.ignored, [], 'hidden and system files are not even listed as ignored');
  assert.equal(r.ignoredLine, '');
}, 'hidden and system files are skipped without a word');

ok(() => {
  const r = sort([{ path: 'F/A.MP4' }, { path: 'F/b.Mov' }, { path: 'F/c.m4v' }, { path: 'F/d.WEBM' },
    { path: 'F/e.JPG' }, { path: 'F/f.jpeg' }, { path: 'F/g.PNG' }, { path: 'F/h.webp' }, { path: 'F/i.TXT' }, { path: 'F/j.md' }]);
  assert.deepEqual(names(r.videos), ['F/A.MP4', 'F/b.Mov', 'F/c.m4v', 'F/d.WEBM']);
  assert.deepEqual(names(r.images), ['F/e.JPG', 'F/f.jpeg', 'F/g.PNG', 'F/h.webp']);
  assert.deepEqual(names(r.texts), ['F/i.TXT', 'F/j.md']);
}, 'type by extension, whatever the case');

ok(() => {
  const r = sort([{ path: 'F/img10.jpg' }, { path: 'F/img2.jpg' }, { path: 'F/img1.jpg' }]);
  assert.deepEqual(names(r.images), ['F/img1.jpg', 'F/img2.jpg', 'F/img10.jpg']);
}, 'natural name order: 2 before 10');

ok(() => {
  for (const cover of ['thumb_final.png', 'Cover.jpg', 'thumbnail-v2.webp']) {
    const r = sort([{ path: 'F/clip.mp4' }, { path: 'F/still-1.jpg' }, { path: 'F/' + cover }, { path: 'F/still-2.jpg' }]);
    assert.equal(r.cover.path, 'F/' + cover, cover + ' is the cover');
    assert.equal(r.ask, '');
  }
}, 'several images: one named thumb*, cover* or thumbnail* is the cover');

ok(() => {
  const r = sort([{ path: 'F/clip.mp4' }, { path: 'F/still-2.jpg' }, { path: 'F/still-1.jpg' }]);
  assert.equal(r.cover, null);
  assert.equal(r.ask, 'cover');
  assert.equal(r.askText, 'This folder has 2 images. Pick the cover.');
  assert.deepEqual(names(r.images), ['F/still-1.jpg', 'F/still-2.jpg'], 'offered in name order');
  assert.deepEqual(r.carousel, [], 'with a video, images are never a carousel');
}, 'several images and one video, none named as a cover: the person picks');

ok(() => {
  const r = sort([{ path: 'F/slide 3.png' }, { path: 'F/slide 1.png' }, { path: 'F/slide 2.png' }]);
  assert.equal(r.video, null);
  assert.equal(r.cover, null);
  assert.equal(r.ask, '');
  assert.deepEqual(names(r.carousel), ['F/slide 1.png', 'F/slide 2.png', 'F/slide 3.png']);
}, 'images and no video: a carousel in name order');

ok(() => {
  const r = sort([{ path: 'F/Version C.mp4' }, { path: 'F/Version A.mp4' }, { path: 'F/Version B.mov' }, { path: 'F/thumb.jpg' }]);
  assert.equal(r.video, null, 'no video is chosen for the person');
  assert.equal(r.ask, 'video');
  assert.equal(r.askText, 'This folder has 3 videos. Pick one.');
  assert.deepEqual(names(r.videos), ['F/Version A.mp4', 'F/Version B.mov', 'F/Version C.mp4']);
  assert.equal(r.cover.path, 'F/thumb.jpg', 'the cover is still found');
}, 'several videos: pick one, in name order');

ok(() => {
  const r = sort([{ path: 'F/clip.mp4' }, { path: 'F/notes.txt' }, { path: 'F/caption-final.txt' }, { path: 'F/brief.md' }]);
  assert.equal(r.caption.path, 'F/caption-final.txt');
  assert.equal(r.captionNote, '');
  const none = sort([{ path: 'F/clip.mp4' }, { path: 'F/notes.txt' }, { path: 'F/brief.md' }]);
  assert.equal(none.caption, null);
  assert.equal(none.captionNote, 'This folder has 2 text files and none is named caption, so the caption was not filled.');
}, 'several text files: caption*.txt wins, else none fills and the page says why');

ok(() => {
  const r = sort([{ path: 'F/clip.mp4' }, { path: 'F/project.prproj' }, { path: 'F/music.wav' }]);
  assert.deepEqual(names(r.ignored), ['F/music.wav', 'F/project.prproj']);
  assert.equal(r.ignoredLine, 'Ignored 2 files: .prproj, .wav');
  const more = sort([{ path: 'F/a.wav' }, { path: 'F/b.wav' }, { path: 'F/README' }]);
  assert.equal(more.ignoredLine, 'Ignored 3 files: .wav, README');
  const one = sort([{ path: 'F/clip.mp4' }, { path: 'F/a.wav' }]);
  assert.equal(one.ignoredLine, 'Ignored 1 file: .wav');
}, 'everything else is named in one quiet line; nothing is dropped silently');

ok(() => {
  const r = sort([{ path: 'Reel 1/a.mp4' }, { path: 'Reel 2/b.mp4' }]);
  assert.equal(r.error, 'Drop one folder at a time.');
  assert.deepEqual([r.video, r.videos, r.images, r.texts], [null, [], [], []], 'a refused drop fills nothing');
}, 'two folders at once: refused');

ok(() => {
  const r = sort([{ path: 'Reel/exports/final.mp4' }, { path: 'Reel/thumb.jpg' }]);
  assert.equal(r.error, '');
  assert.equal(r.video.path, 'Reel/exports/final.mp4', 'a file one folder down still counts');
  const loose = sort([{ path: 'final.mp4' }, { path: 'thumb.jpg' }]);
  assert.equal(loose.error, '', 'loose files dropped together are one drop, not two folders');
  assert.equal(loose.video.path, 'final.mp4');
}, 'a sub-folder is part of the same folder; loose files are one drop');

ok(() => {
  const r = sort([]);
  assert.deepEqual([r.error, r.video, r.cover, r.caption, r.ask], ['', null, null, null, '']);
  const input = [{ path: 'F/b.mp4' }, { path: 'F/a.mp4' }];
  const copy = JSON.parse(JSON.stringify(input));
  sort(input);
  assert.deepEqual(input, copy, 'the input list is not changed');
  const file = { name: 'x' };
  assert.equal(sort([{ path: 'F/clip.mp4', file }]).video.file, file, 'each entry comes back as given');
}, 'empty drop, input left alone, entries returned as given');

console.log(`post-folder-sort: ${checks} checks passed`);
