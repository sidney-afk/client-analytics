'use strict';
/*
 * Samples Sheet input and horizontal scroll polish.
 *
 * Guards the two interaction fixes that keep the rebuilt Samples Sheet aligned
 * with the calendar Sheet: vertical wheel gestures slide the horizontal strip,
 * and editing text inside a card cannot leak keyboard/drag behavior to the card.
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return INDEX.slice(at, j + 1);
    }
  }
  throw new Error('unbalanced braces: ' + name);
}

let failures = 0;
function check(label, cond) {
  if (cond) console.log('  ok  ' + label);
  else { console.log('FAIL  ' + label); failures++; }
}

const creativeHtml = grabFunc('_sxrCreativeDirectionHtml');
const dragLock = grabFunc('_sxrTextDragLock');
const focus = grabFunc('_sxrOnTextEditFocus');
const blur = grabFunc('_sxrOnTextEditBlur');
const key = grabFunc('_sxrOnTextEditKey');
const wireStrip = grabFunc('_sxrWireStrip');

check('Samples creative-direction textarea wires focus, blur, and key isolation handlers',
  /onfocus="_sxrOnTextEditFocus\(this\)"/.test(creativeHtml) &&
  /onblur="_sxrOnTextEditBlur\(this\)"/.test(creativeHtml) &&
  /onkeydown="_sxrOnTextEditKey\(event\)"/.test(creativeHtml));

check('Samples text focus disables card dragging while the field is active',
  /card\.setAttribute\('draggable', 'false'\);/.test(dragLock));

check('Samples text blur restores the previous draggable value',
  /card\.setAttribute\('draggable', card\.dataset\.sxrDragPrev\);/.test(dragLock) &&
  /delete card\.dataset\.sxrDragPrev;/.test(dragLock));

check('Samples text focus also autosizes textarea content',
  /_sxrTextDragLock\(el, true\);/.test(focus) &&
  /_sxrAutosize\(el\);/.test(focus));

check('Samples text blur flushes through the existing save path',
  /_sxrTextDragLock\(el, false\);/.test(blur) &&
  /_sxrOnFieldBlur\(el\);/.test(blur));

check('Samples text key events stop at the textarea without preventing native typing',
  /if \(e\) e\.stopPropagation\(\);/.test(key) &&
  !/preventDefault/.test(key));

check('Samples Sheet uses the calendar horizontal wheel helper',
  /_calWireShiftScroll\(strip\);/.test(wireStrip));

check('Samples Sheet uses the same drag-edge autoscroll helper as Calendar',
  /_calWireDragEdgeScroll\(strip\);/.test(wireStrip));

console.log(failures === 0
  ? '\nAll Samples input/scroll polish checks passed.'
  : '\n' + failures + ' check(s) FAILED.');
process.exit(failures === 0 ? 0 : 1);
