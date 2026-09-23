'use strict';
/*
 * One fixture table for the title name rule. test/title-name-rule-drift.js runs
 * it through the source module, the browser copy and policy.mjs's parser, and
 * test/rename-propagation-postgres.js runs it through the SQL copy. Invisible
 * characters are built with fromCharCode so no editor can silently change them.
 */
const ch = (n) => String.fromCharCode(n);
const NBSP = ch(0xa0);
const LS = ch(0x2028);
const BOM = ch(0xfeff);
const IDEO = ch(0x3000);
const DASH = ch(0x2014);
const SEP = ' ' + DASH + ' ';
const long160 = 'x'.repeat(160);
const long161 = 'x'.repeat(161);
const emoji = String.fromCodePoint(0x1f3ac);
const emoji160 = emoji.repeat(160); // 160 code points, 320 UTF-16 units

// Titles for parsing.
const TITLES = [
  'Video 3',
  'Video 3' + SEP + 'a' + SEP + 'b',
  'Video 3 - x',
  'Video 3' + SEP,
  ' Video 3' + SEP + 'x ',
  NBSP + 'Video 3' + SEP + 'x' + BOM,
  'Video 03',
  'video 3',
  'Video 0',
  'Sample Thumbnail 12' + SEP + emoji + ' name',
  'Thumbnail 7' + SEP + 'line' + LS + 'break',
  'Thumbnail 7' + SEP + 'line\nbreak',
  'Video 3  ' + DASH + ' x',
  'Promo clip FINAL - edit 2',
  '',
  '   ',
  'Video 99999999999999999999' + SEP + 'huge',
  'Sample Video 1',
  'Sample  Video 1',
];

// [oldTitle, newName, expected] -- expected is pinned by the owner's rules
// (docs/ops/RENAME_PLAN.md section D), not derived from any implementation.
const RENAMES = [
  ['Video 4', 'Gym day', { ok: true, title: 'Video 4' + SEP + 'Gym day', changed: true }],
  ['Video 4' + SEP + 'Something else', 'New', { ok: true, title: 'Video 4' + SEP + 'New', changed: true }],
  ['Promo clip FINAL - edit 2', 'Promo B', { ok: true, title: 'Promo B', changed: true }],
  ['Thumbnail 4', 'B', { ok: true, title: 'Thumbnail 4' + SEP + 'B', changed: true }],
  ['Video 4', 'X' + SEP + 'part 3', { ok: true, title: 'Video 4' + SEP + 'X' + SEP + 'part 3', changed: true }],
  ['Video 4' + SEP + 'Gym', '', { ok: true, title: 'Video 4', changed: true }],
  ['Video 4' + SEP + 'Gym', '  ' + NBSP + '\n', { ok: true, title: 'Video 4', changed: true }],
  ['Promo clip', '', { ok: false, reason: 'empty_name_not_propagated' }],
  ['Promo clip', 'Video 7', { ok: false, reason: 'name_would_look_numbered' }],
  ['Promo clip', 'Video 7' + SEP + 'x', { ok: false, reason: 'name_would_look_numbered' }],
  ['Video 4', 'Video 7', { ok: true, title: 'Video 4' + SEP + 'Video 7', changed: true }],
  ['Video 4', long160, { ok: true, title: 'Video 4' + SEP + long160, changed: true }],
  ['Video 4', long161, { ok: false, reason: 'name_too_long' }],
  ['Video 4', emoji160, { ok: true, title: 'Video 4' + SEP + emoji160, changed: true }],
  ['Video 4', emoji160 + emoji, { ok: false, reason: 'name_too_long' }],
  ['Sample Thumbnail 2' + SEP + 'Old', '  New \t name  ', { ok: true, title: 'Sample Thumbnail 2' + SEP + 'New name', changed: true }],
  ['Video 4' + SEP + 'Same', 'Same', { ok: true, title: 'Video 4' + SEP + 'Same', changed: false }],
  ['  Video 4' + SEP + 'Same  ', 'Same', { ok: true, title: 'Video 4' + SEP + 'Same', changed: false }],
  ['Video 4', 'a\nb' + LS + 'c' + IDEO + 'd', { ok: true, title: 'Video 4' + SEP + 'a b c d', changed: true }],
  ['Video 3 - x', 'y', { ok: true, title: 'y', changed: true }],
  ['', 'fresh', { ok: true, title: 'fresh', changed: true }],
];

const NAMES_OF = [
  ['Video 4', ''],
  ['Video 4' + SEP + 'Launch', 'Launch'],
  ['Promo clip ', 'Promo clip'],
  ['Video 3' + SEP + 'a' + SEP + 'b', 'a' + SEP + 'b'],
];

module.exports = { TITLES, RENAMES, NAMES_OF, SEP };
