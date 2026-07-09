'use strict';
/*
 * Drive thumbnail access warning wiring.
 *
 * A private Google Drive thumbnail must not silently disappear on review/Kasper
 * surfaces. The main Sheet card already shows the full Drive-sharing warning;
 * this pins the compact review-strip and expanded review-preview paths to the
 * same warning helpers.
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

const reviewErr = grabFunc('_calOnReviewThumbError');
const calReviewCard = grabFunc('_calReviewCardHtml');
const calReviewPreview = grabFunc('_calReviewComponentPreview');
const sxrReviewCard = grabFunc('_sxrReviewCardHtml');
const sxrReviewPreview = grabFunc('_sxrReviewComponentPreview');
const sxrKasperCard = grabFunc('_sxrKasperRenderCard');
const kasperCard = grabFunc('_kasperRenderCard');

check('expanded review thumbnail errors use the full Drive warning',
  /img\.dataset\.drive === '1'[\s\S]*_calDriveWarnHtml\(\)/.test(reviewErr));
check('expanded review thumbnail errors still show a generic fallback for non-Drive images',
  /Thumbnail could not load\./.test(reviewErr));

check('calendar review collapsed thumbnail uses Drive-aware mini error handler',
  /_calThumbImgTag\(info, '_calOnMiniThumbError'\)/.test(calReviewCard));
check('calendar review expanded thumbnail uses Drive-aware review error handler',
  /_calThumbImgTag\(imgInfo, '_calOnReviewThumbError'\)/.test(calReviewPreview));

check('samples review collapsed thumbnail uses Drive-aware mini error handler',
  /_calThumbImgTag\(info, '_calOnMiniThumbError'\)/.test(sxrReviewCard));
check('samples review expanded thumbnail uses Drive-aware review error handler',
  /_calThumbImgTag\(info, '_calOnReviewThumbError'\)/.test(sxrReviewPreview));

check('samples Kasper queue thumbnail uses Drive-aware mini error handler',
  /_calThumbImgTag\(info, '_calOnMiniThumbError'\)/.test(sxrKasperCard));
check('calendar Kasper queue thumbnail uses Drive-aware mini error handler',
  /_calThumbImgTag\(thumbInfo, '_calOnMiniThumbError'\)/.test(kasperCard));

const badSilentHide = /info\.url[\s\S]{0,220}onerror="this\.style\.display='none'"/;
check('calendar review collapsed thumbnail no longer silently hides failed Drive images',
  !badSilentHide.test(calReviewCard));
check('samples review collapsed thumbnail no longer silently hides failed Drive images',
  !badSilentHide.test(sxrReviewCard));
check('samples Kasper collapsed thumbnail no longer silently hides failed Drive images',
  !badSilentHide.test(sxrKasperCard));

console.log(failures === 0
  ? '\nAll Drive thumbnail warning wiring checks passed.'
  : '\n' + failures + ' check(s) FAILED.');
process.exit(failures === 0 ? 0 : 1);
