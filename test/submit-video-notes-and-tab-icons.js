'use strict';
/*
 * Three owner requests from 2026-08-21, one file because all three are "the
 * Submit tab and the nav must say what the owner meant".
 *
 * 1. A PER-VIDEO NOTES BOX. Every video card had three link fields and nowhere
 *    to say what the video actually IS -- the titles in his filming doc had no
 *    home, and the only free-text box on the page was batch-level, so sixteen
 *    videos shared one note. The fourth field is a real textarea and its text
 *    becomes the Linear description of BOTH children: the video sub-issue
 *    (above the footage lines, because the editor reads the ask first) and the
 *    thumbnail sub-issue (alone -- a designer is not briefed by camera files).
 *
 *    The legacy n8n lane deliberately does NOT carry it per video: its payload
 *    is frozen by a deployed receipt contract that recomputes a hash over
 *    exactly array['audio','dueDate','main_cam','number','side_cam'], so a
 *    sixth key would make every legacy submission fail its own idempotency
 *    check. The notes ride that lane inside the batch note instead, which is
 *    already canonical, so the text is never silently dropped.
 *
 * 2. THE MIRROR TAB IS CALLED SyncLinear. Label only. The route, hash, id and
 *    navTo key stay `production` -- AGENTS.md forbids deriving routing from a
 *    visible label, and this suite pins that the two never merged.
 *
 * 3. PER-TAB ICONS AND A PER-TAB FAVICON. PNGs cannot inherit currentColor, so
 *    the icons are self-contained tiles; the favicon follows the ACTIVE ROUTE,
 *    which is why `production` maps to the synclinear art and `linear` to the
 *    submit art -- reversing them is the exact mistake the label/route split
 *    exists to prevent.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = process.env.SUBMIT_NOTES_SRC || path.join(ROOT, 'index.html');
const source = fs.readFileSync(SRC, 'utf8');
let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}
function extractFn(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('missing function: ' + name);
  let depth = 0, seen = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') { depth++; seen = true; }
    else if (ch === '}') { depth--; if (seen && depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
function extractConst(name) {
  const start = source.indexOf(`const ${name} = `);
  if (start < 0) throw new Error('missing const: ' + name);
  let depth = 0, seen = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') { depth++; seen = true; }
    else if (ch === '}') { depth--; if (seen && depth === 0) return source.slice(start, i + 2); }
    if (!seen && ch === ';') return source.slice(start, i + 1);
  }
  throw new Error('unbalanced const: ' + name);
}

/* ---- 1. the brief the two children actually receive ---------------------- */
const briefBox = {};
vm.createContext(briefBox);
vm.runInContext(
  extractFn('_linearVideoBrief') + '\n' + extractFn('_linearThumbnailBrief')
  + '\nthis.videoBrief = _linearVideoBrief; this.thumbBrief = _linearThumbnailBrief;',
  briefBox,
);
const { videoBrief, thumbBrief } = briefBox;
ok(typeof videoBrief === 'function' && typeof thumbBrief === 'function',
  'both brief composers extract and execute (harness is not vacuous)');

const FULL = {
  main_cam: 'https://dropbox/main.mp4',
  side_cam: '',
  audio: 'https://dropbox/aud.wav Start at 4:46 min',
  notes: 'Ranking things guys do on a first date p2',
};
const vb = videoBrief(FULL);
ok(vb.startsWith('Ranking things guys do on a first date p2'),
  'the video brief LEADS with the note, so the editor reads the ask before the assets');
ok(vb.includes('Main camera: https://dropbox/main.mp4') && vb.includes('Audio: https://dropbox/aud.wav Start at 4:46 min'),
  'the footage lines survive verbatim, including a timestamp typed after the link');
ok(!vb.includes('Side camera'), 'an empty side camera still contributes no line');
ok(/first date p2\n\nMain camera/.test(vb), 'note and assets are separated by a blank line, not run together');
ok(videoBrief({ main_cam: 'https://x/1' }) === 'Main camera: https://x/1',
  'with no note the video brief is byte-identical to the pre-change shape');
ok(videoBrief({}) === '', 'an empty card still yields an empty brief, never a stray separator');
ok(thumbBrief(FULL) === 'Ranking things guys do on a first date p2',
  'the thumbnail brief is the note ALONE — no camera or audio links reach the designer');
ok(thumbBrief({ main_cam: 'https://x/1', audio: 'https://x/2' }) === '',
  'a card with links but no note gives the thumbnail nothing, so the server may still generate');
ok(thumbBrief({ notes: '   padded   ' }) === 'padded', 'the thumbnail brief is trimmed');

/* ---- 2. both children are planned with those briefs ---------------------- */
const itemsBox = { PROD_CREATED_STATUS: 'todo' };
vm.createContext(itemsBox);
vm.runInContext(
  extractFn('_linearVideoBrief') + '\n' + extractFn('_linearThumbnailBrief') + '\n'
  + extractFn('_linearIntakeItems') + '\nthis.items = _linearIntakeItems;',
  itemsBox,
);
const items = itemsBox.items('both', [FULL, { main_cam: 'https://x/2' }], 'submission:abc-123', 'submission');
const video1 = items.find(i => i.team === 'video' && i.videoNumber === 1);
const graphic1 = items.find(i => i.team === 'graphics' && i.videoNumber === 1);
const graphic2 = items.find(i => i.team === 'graphics' && i.videoNumber === 2);
ok(items.length === 4, 'video + thumbnail mode plans one pair per video');
ok(video1.brief.includes(FULL.notes) && video1.brief.includes('Main camera'),
  'the planned VIDEO item carries the note and the footage');
ok(graphic1.brief === FULL.notes,
  'the planned THUMBNAIL item carries the note — this is what puts it on the GRA sub-issue');
ok(graphic2.brief === '',
  'a note-less video plans an empty thumbnail brief instead of inheriting its neighbour');
ok(video1.card_id === graphic1.card_id && video1.card_id !== items.find(i => i.videoNumber === 2).card_id,
  'the pair still shares one card id and does not collide with the next video');

/* ---- 3. the favicon follows the ROUTE, never the label ------------------- */
const favBox = {};
vm.createContext(favBox);
vm.runInContext(
  extractConst('SYNCVIEW_DEFAULT_FAVICON') + '\n' + extractConst('SYNCVIEW_TAB_FAVICONS') + '\n'
  + extractFn('_syncviewFaviconFor') + '\n' + extractFn('_syncviewApplyTabFavicon')
  + '\nthis.favFor = _syncviewFaviconFor; this.apply = _syncviewApplyTabFavicon;'
  + '\nthis.DEFAULT = SYNCVIEW_DEFAULT_FAVICON;',
  favBox,
);
const { favFor, apply, DEFAULT } = favBox;
ok(typeof favFor === 'function', 'the favicon resolver extracts and executes');
ok(favFor('production') === 'nav-icons/synclinear-favicon.png',
  'route `production` (the tab labelled SyncLinear) resolves to the synclinear mark');
ok(favFor('linear') === 'nav-icons/submit-favicon.png',
  'route `linear` (the tab labelled Submit) resolves to the submit mark — the split is not crossed');
ok(favFor('home') === 'nav-icons/analytics-favicon.png', 'route `home` resolves to the Analytics mark');
ok(favFor('sample-reviews') === 'nav-icons/samples-favicon.png', 'the samples route resolves to its own mark');
ok(favFor('onboarding') === 'synchro-social-favicon.png',
  'onboarding keeps SynchroSocial branding instead of being overwritten by the SyncView default');
ok(favFor('kasper') === DEFAULT && favFor('time-off') === DEFAULT && favFor('') === DEFAULT,
  'a route with no designed icon falls back to the SyncView mark rather than keeping the previous tab');
ok(DEFAULT === 'syncview-favicon.png', 'the fallback is the existing root mark, which is unchanged');

// _syncviewApplyTabFavicon against a minimal DOM: it must create the link when
// absent, update it, and NOT rewrite an identical href (that re-fetch is what
// makes a tab icon blink on every render).
function fakeDom() {
  const link = { rel: '', type: '', _attrs: {}, writes: 0,
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
    setAttribute(k, v) { this._attrs[k] = v; this.writes++; } };
  const head = { appendChild(el) { this.appended = el; } };
  return {
    link, head,
    document: {
      head,
      querySelector(sel) { return sel === 'link[rel="icon"]' ? (this._link || null) : null; },
      createElement() { return link; },
      _link: null,
    },
  };
}
let dom = fakeDom();
favBox.document = dom.document;
vm.runInContext('_syncviewApplyTabFavicon("calendar")', favBox);
ok(dom.head.appended === dom.link && dom.link.rel === 'icon',
  'a document with no icon link gets one created rather than throwing');
ok(dom.link.getAttribute('href') === 'nav-icons/calendar-favicon.png', 'the created link points at the route mark');

dom = fakeDom();
dom.document._link = dom.link;
dom.link.setAttribute('href', 'nav-icons/calendar-favicon.png');
const writesBefore = dom.link.writes;
favBox.document = dom.document;
vm.runInContext('_syncviewApplyTabFavicon("calendar")', favBox);
ok(dom.link.writes === writesBefore, 'an identical href is NOT rewritten, so the tab icon does not blink');
vm.runInContext('_syncviewApplyTabFavicon("workload")', favBox);
ok(dom.link.getAttribute('href') === 'nav-icons/workload-favicon.png' && dom.link.writes === writesBefore + 1,
  'a real route change writes exactly once');
favBox.document = { querySelector() { throw new Error('hostile DOM'); } };
let threw = false;
try { vm.runInContext('_syncviewApplyTabFavicon("home")', favBox); } catch (e) { threw = true; }
ok(!threw, 'a hostile/absent DOM can never take down navigation');

/* ---- 4. the markup the browser actually ships --------------------------- */
const navBlock = (source.match(/<div class="header-nav" id="headerNav">([\s\S]*?)<div class="header-actions">/) || [])[1] || '';
ok(navBlock.length > 500, 'the nav block extracts (harness is not vacuous)');
ok(!/<div/.test(navBlock),
  'no <div> was introduced inside #headerNav — a nested one truncates the samples-retirement extractor');
/* Icons are painted through a CSS mask so they inherit currentColor: one
   asset serves the light strip, the dark theme and the near-black active pill.
   Pin the whole chain — every tab declares a class, every class has a mask
   rule, and every rule names a file that exists — because a broken link in it
   is invisible (an unmasked span is simply blank, not an error). */
const iconClasses = [...navBlock.matchAll(/class="header-nav-ico (ico-[a-z]+)"/g)].map(m => m[1]);
ok(iconClasses.length === 9, 'nine visible tabs declare an owner-designed icon (found ' + iconClasses.length + ')');
ok(new Set(iconClasses).size === iconClasses.length, 'every tab gets a DISTINCT icon — none is pasted twice');
ok(/\.header-nav-btn \.header-nav-ico \{[^}]*background-color: currentColor;/.test(source),
  'the icon is filled with currentColor, so it follows the theme and inverts on the active pill');
ok(/\.header-nav-btn \.header-nav-ico \{[^}]*mask-size: contain;/.test(source),
  'the artwork is used as a mask rather than drawn, which is what makes the fill possible');
for (const cls of iconClasses) {
  const rule = new RegExp('\\.' + cls + " \\{ -webkit-mask-image: url\\('nav-icons/([a-z-]+)\\.png'\\); mask-image: url\\('nav-icons/([a-z-]+)\\.png'\\); \\}");
  const m = source.match(rule);
  ok(!!m, cls + ' has a mask rule declaring both the prefixed and standard property');
  if (m) {
    ok(m[1] === m[2], cls + ' points both mask properties at the same file');
    ok(fs.existsSync(path.join(ROOT, 'nav-icons', m[1] + '.png')), 'nav-icons/' + m[1] + '.png exists on disk');
    ok(fs.existsSync(path.join(ROOT, 'nav-icons', m[1] + '-favicon.png')), 'nav-icons/' + m[1] + '-favicon.png exists on disk');
  }
}
ok(!/<img[^>]*header-nav-ico/.test(navBlock),
  'the icons are masked spans, not <img> — an <img> paints its own pixels and cannot take the theme colour');
ok(/id="navProd"[\s\S]{0,400}?>\s*SyncLinear\s*<\/a>/.test(navBlock), 'the mirror tab reads SyncLinear');
ok(/id="navProd"[\s\S]{0,400}?href="#production"/.test(navBlock) || /href="#production"[\s\S]{0,400}?id="navProd"/.test(navBlock),
  'the mirror tab kept its #production hash — the rename was label-only');
ok(/id="navLinear"[\s\S]{0,400}?>\s*Submit\s*<\/a>/.test(navBlock), 'the Submit tab is untouched');
ok(!/>\s*Linear\s*<\/a>/.test(navBlock), 'no tab is still labelled the bare word Linear');

// The per-video notes field: rendered, renumbered, collected, persisted.
const cardFn = extractFn('renderVideoCard');
ok(/id="vid_notes_\$\{num\}"/.test(cardFn), 'the video card renders a per-video notes control');
ok(/<textarea[^>]*class="linear-textarea linear-video-notes"/.test(cardFn),
  'it is a real multi-line textarea sharing the batch-notes styling, not another one-line input');
ok(/_calEsc\(data\.notes \|\| ''\)/.test(cardFn),
  'the saved value is HTML-escaped on re-render — a note containing </textarea> cannot break the form');
ok(!/onkeydown="onVideoLinkKeydown/.test(cardFn.split('vid_notes_')[1] || ''),
  'the notes box does NOT take the link keydown handler, which would eat Shift and block capitals');
const renumber = extractFn('renumberVideoCards');
ok(/\[id\^="vid_notes_"\]/.test(renumber) && /notes\.id = 'vid_notes_' \+ newNum/.test(renumber),
  'removing a video renumbers the notes field too, so a note can never follow the wrong video');
ok((source.match(/vid_notes_' \+ (num|id)\)/g) || []).length >= 3,
  'the draft and both submit collectors all read the notes field');
ok(/notes: document\.getElementById\('vid_notes_' \+ num\)\?\.value \|\| ''/.test(source),
  'the local draft persists notes, so a refresh mid-typing does not lose them');

// The frozen legacy contract must not have grown a sixth video key.
const legacy = source.slice(source.indexOf('This exact five-field object') - 2600, source.indexOf('This exact five-field object') + 400);
const legacyPush = legacy.slice(legacy.indexOf('videos.push({'));
const legacyLiteral = legacyPush.slice(0, legacyPush.indexOf('});') + 1);
const legacyKeys = [...legacyLiteral.matchAll(/^\s*([A-Za-z_]+)\s*[,:]/gm)].map(m => m[1]).sort();
ok(legacyKeys.join(',') === 'audio,dueDate,main_cam,number,side_cam',
  'the legacy video object still has exactly its five contract fields (got: ' + legacyKeys.join(',') + ')');
ok(/videoNotes\.push\('Video ' \+ number \+ ' notes: '/.test(legacy),
  'legacy submissions fold the notes into the batch note instead of dropping them');
ok(/getElementById\('vid_notes_' \+ id\)/.test(legacy),
  'the legacy lane reads the note by the CARD id, like every field beside it, not by sequence number');

if (failures) { console.error('\n' + failures + ' failure(s)'); process.exit(1); }
console.log('\nall green');
