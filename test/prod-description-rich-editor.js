'use strict';
/*
 * The in-place description editor (2026-09-06).
 *
 * Owner: "when we click edit it shouldn't change the way we are viewing
 * things ... like linear ... we shouldn't see those weird brackets ... when
 * we paste an image we should just see the actual image ... when I click
 * edit and scroll down, it scrolls back up."
 *
 * This suite runs the PURE half of the module in Node (Markdown -> editor
 * HTML is string work) and pins the wiring contracts in index.html. The DOM
 * half -- serializer round trips, keys, the link card, the pixel-identical
 * placement over the read view -- runs in a real browser in
 * docs/syncview-design/tests/prod-write-gateway-browser.js.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const ARTIFACT = fs.readFileSync(path.join(__dirname, '..', 'docs', 'syncview-design', 'SyncView.html'), 'utf8');
let failed = 0;
function ok(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { failed++; console.log('FAIL  ' + msg); }
}
function grabFunc(src, signature) {
  const start = src.indexOf(signature);
  if (start < 0) throw new Error('missing ' + signature);
  let depth = 0;
  let i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unterminated ' + signature);
}

/* ---- 1. Markdown -> editor HTML, in Node ------------------------------ */
console.log('the editor is built from Markdown with every source form kept');
const ctx = {};
vm.createContext(ctx);
vm.runInContext([
  'const PROD_DESC_RICH_PLACEHOLDER_RE = /!\\[Uploading image (\\d+)…\\]\\(\\)/;',
  grabFunc(INDEX, 'function _prodDescRichAttr('),
  grabFunc(INDEX, 'function _prodDescRichInline('),
  grabFunc(INDEX, 'function _prodDescRichBlockHTML('),
  grabFunc(INDEX, 'function _prodDescRichBuild('),
  'this.build = _prodDescRichBuild; this.inline = _prodDescRichInline;',
].join('\n'), ctx);

const built = ctx.build('# Head\n\n- item\n* star\n---\n[label](https://x.com/a?b=1&c=2)\n[angle](<https://x.com/a b>)\nsee https://bare.example/path).\n![alt](https://cdn.example/x.png)\n![Uploading image 4…]()\n**bold** *em* __u__ _i_ `code`\n   \n');
ok(/<div class="prod-md-heading" data-md="h" data-md-prefix="# ">Head<\/div>/.test(built), 'a heading keeps its exact prefix');
ok(/<div class="prod-md-bullet" data-md="ul" data-md-prefix="- "><span class="prod-md-bullet-mark" contenteditable="false">•<\/span><span class="prod-md-bullet-text">item<\/span><\/div>/.test(built)
  && /data-md-prefix="\* "/.test(built),
  'a bullet keeps its marker, dash or star, with the same classes the read view draws');
ok(/<div class="prod-md-hr" data-md="hr" data-md-raw="---" contenteditable="false"><hr class="prod-md-rule"><\/div>/.test(built), 'a rule is a non-editable block');
ok(/<a href="https:\/\/x\.com\/a\?b=1&amp;c=2" data-md="named" target="_blank" rel="noopener noreferrer">label<\/a>/.test(built), 'a [label](url) link is an anchor tagged with its form');
ok(/<a href="https:\/\/x\.com\/a b" data-md="angle"/.test(built), 'the <url> form is tagged so it serializes back the same way');
ok(/<a href="https:\/\/bare\.example\/path" data-md="bare"[^>]*>https:\/\/bare\.example\/path<\/a>\)\./.test(built), 'a bare URL keeps its trailing punctuation outside the link');
ok(/<img class="prod-desc-image" src="https:\/\/cdn\.example\/x\.png" alt="alt" data-md="plain" loading="lazy" decoding="async" referrerpolicy="no-referrer">/.test(built), 'an image renders as the image');
ok(/<span class="prod-desc-uploading" data-md-placeholder="4" contenteditable="false">Uploading image…<\/span>/.test(built), 'an upload in flight renders as a chip, not as Markdown');
ok(/<strong data-md="bb">bold<\/strong> <em data-md="s">em<\/em> <strong data-md="uu">u<\/strong> <em data-md="u">i<\/em> <code>code<\/code>/.test(built), 'bold, italic and code keep which marker they came from');
ok(/<div class="prod-md-p" data-md="p" data-md-raw="   "><br><\/div>/.test(built), 'a whitespace-only line keeps its whitespace');
ok(/<div class="prod-md-p" data-md="p"><br><\/div>$/.test(built), 'a trailing newline is a trailing empty block');
ok(/<div class="prod-md-p prod-md-gap" data-md="p"><br><\/div><div class="prod-md-bullet"/.test(built)
  && !/prod-md-gap" data-md="p"><br><\/div><div class="prod-md-p"/.test(built),
  'the blank line beside a heading is kept in the model and collapsed on screen, where the read view draws none');
ok(!/\son[a-z]+=/.test(built), 'no handler attribute anywhere in the editor HTML');
const hostile = ctx.build('<img src=x onerror=alert(1)>\n[a](https://x.com/"onmouseover="alert(1))\n![p](javascript:alert(1))\n![d](data:image/png;base64,AAAA)');
ok(!/<img src=x/.test(hostile) && /&lt;img src=x onerror=alert\(1\)&gt;/.test(hostile), 'pasted HTML is text');
ok(/href="https:\/\/x\.com\/&quot;onmouseover=&quot;alert\(1"/.test(hostile), 'a quote in a URL cannot close the attribute');
ok(!/<img[^>]*javascript:/.test(hostile) && !/<img[^>]*data:/.test(hostile), 'only https images render as images');
ok(ctx.inline('*<em data-md="s">x</em>*') !== undefined && !/data-md="<em/.test(ctx.build('**a** *b*')),
  'marker attributes carry no * or _, so the bold pass cannot match inside a tag it produced');

/* ---- 2. The wiring in index.html ---------------------------------------- */
console.log('the panel edits in place, and Markdown is one toggle away');
const panel = grabFunc(INDEX, 'function _prodDescriptionPanelHTML(');
ok(/data-prod-description-control="rich" contenteditable="' \+ \(state\.saving \? 'false' : 'true'\) \+ '" role="textbox" aria-multiline="true" aria-label="Description"/.test(panel),
  'the visual editor is a contenteditable textbox, read-only while a save is in flight');
ok(/class="prod-description-rich prod-desc' \+/.test(panel), 'it carries the read view\'s own class, so it is typeset identically');
ok(/_prodDescRichBuild\(state\.draft\)/.test(panel), 'and is built from the draft on every render');
ok(/data-prod-description-control="markdown-tab" aria-pressed="' \+ \(source \? 'true' : 'false'\)/.test(panel), 'the Markdown toggle is a pressed/unpressed button');
ok(/data-prod-description-source-notice/.test(panel), 'a description that opened as Markdown says why');
ok(/data-prod-desc-click-edit="1" onclick="return _prodDescriptionBodyClick\(event,/.test(panel) && /const clickEdit = writable && state\.status === 'ready' && !state\.refreshing;/.test(panel),
  'the read view is click-to-edit only where the write gate is open and the text is current');
ok(/'No description\.'/.test(panel) && !/Add a description…'/.test(panel.slice(panel.indexOf('const body'))), 'the empty read state keeps its contracted copy');
ok(/data-prod-description-edit="1"/.test(panel), 'the Edit button stays, for the keyboard and for the gate\'s refusal copy');
ok(/data-prod-description-count-quiet="1"/.test(panel) && /\.prod-description-count\.is-quiet \{ display: none; \}/.test(INDEX),
  'the character count is silent until it matters');
ok(/'Paste or drop an image to add it'/.test(panel) || /Paste or drop an image to add it/.test(panel), 'the paste hint is still a visible sentence');

const begin = grabFunc(INDEX, 'function _prodBeginDescriptionEdit(');
ok(/state\.source = !_prodDescRichRoundTrips\(state\.draft\);/.test(begin) && /cannot keep exactly, so it opened as Markdown/.test(begin),
  'Edit falls back to Markdown, and says so, when the text would not survive the visual editor byte for byte');
ok(/_prodFocusDescriptionControl\(id, _prodDescriptionEditorControl\(state\), options\)/.test(begin), 'focus goes to whichever editor opened, with the click point');
const mode = grabFunc(INDEX, 'function _prodSetDescriptionMode(');
ok(/if \(!toSource && !_prodDescRichRoundTrips\(state\.draft\)\)/.test(mode) && /Keep editing it as Markdown/.test(mode), 'the toggle back to visual is refused, with a reason, for the same Markdown');
ok(/state\.caretBlock = parts\.length - 1;/.test(mode) && /state\.selectionStart = offset;/.test(mode), 'the caret crosses the toggle in both directions');

const focus = grabFunc(INDEX, 'function _prodFocusDescriptionControl(');
const restore = grabFunc(INDEX, 'function _prodRestoreDescriptionFocus(');
const keep = grabFunc(INDEX, 'function _prodDescriptionKeepScroll(');
ok(/_prodDescriptionKeepScroll\(\(\) => \{/.test(focus) && /_prodDescriptionKeepScroll\(\(\) => \{/.test(restore),
  'every focus and caret restore runs under the scroll lock');
ok(/const top = pane \? pane\.scrollTop : 0;/.test(keep) && /if \(pane && pane\.scrollTop !== top\) pane\.scrollTop = top;/.test(keep) && /window\.scrollTo\(x, y\)/.test(keep),
  'which puts the detail pane and the window back where they were: the edit-then-scroll-jumps-back report');
ok(/document\.caretRangeFromPoint\(options\.point\.x, options\.point\.y\)/.test(focus), 'a click on the text puts the caret where the click landed');
ok(/const anchor = target\.querySelectorAll\('a'\)\[options\.link\];/.test(focus) && /_prodDescLinkPopShow\(anchor, true\)/.test(focus),
  'Edit from a link card on the read view reopens the card on the same link in the editor');

const keydown = grabFunc(INDEX, 'function _prodDescriptionEditorKeydown(');
ok(/toLowerCase\(\) === 'k'/.test(keydown) && /_prodDescRichAnchorAtCaret\(root\) \|\| _prodDescRichMakeLink\(root, '', ''\)/.test(keydown), 'Ctrl/Cmd+K edits the link at the caret or makes one');
ok(/_prodDescRichKeydown\(event, root\)/.test(keydown) && /event\.key === 'Escape'/.test(keydown) && /event\.key === 'Enter'/.test(keydown),
  'the block keys are the editor\'s; Escape and Ctrl+Enter keep their meaning');
const paste = grabFunc(INDEX, 'function _prodDescriptionPaste(');
ok(/_prodDescRichMakeLink\(input, text\.trim\(\)\)/.test(paste) && /_prodDescRichInsertText\(input, text\)/.test(paste) && /_prodDescriptionRichRebuild\(id, input\)/.test(paste),
  'pasted text lands as blocks, a URL over a selection becomes its link, and pasted Markdown is rendered on landing');
ok(/if \(!rich \|\| !text\) return true;/.test(paste), 'the textarea keeps the browser\'s own paste');
const insert = grabFunc(INDEX, 'function _prodDescriptionInsertAtCaret(');
const replace = grabFunc(INDEX, 'function _prodDescriptionReplaceInDraft(');
ok(/return _prodDescriptionRichInsertLine\(id, rich, text\)/.test(insert), 'an image placeholder goes on its own line in the visual editor too');
ok(/rich\.querySelector\('\[data-md-placeholder="' \+ n \+ '"\]'\)/.test(replace) && /_prodDescRichInline\(replacement\)/.test(replace),
  'and is swapped for the image in the DOM when the URL comes back');
ok(/_prodDescRichIsEmpty\(_prodDescRichContainer\(block\)\) && rich\.children\.length > 1\) block\.remove\(\)/.test(replace), 'a failed upload takes its line with it, as in the textarea');
const save = grabFunc(INDEX, 'async function _prodSaveDescription(');
ok(!/_prodFocusDescriptionControl\(id, 'source'\)/.test(save) && /_prodFocusDescriptionControl\(id, _prodDescriptionEditorControl\(state\)\)/.test(save),
  'a refused save returns focus to whichever editor is open');
const cancel = grabFunc(INDEX, 'function _prodCancelDescriptionEdit(');
ok(/state\.source = false;/.test(cancel) && /_prodDescLinkPopHide\(true\)/.test(cancel), 'Cancel closes the link card and forgets the mode');
ok(/document\.addEventListener\('desc-link-edit'/.test(INDEX) && /_prodBeginDescriptionEdit\(panel\.getAttribute\('data-prod-description'\), \{ link: index \}\)/.test(INDEX),
  'the read view\'s link card hands its Edit to the panel');

/* ---- 3. The look: one box for reading and editing ----------------------- */
console.log('reading and editing share one box');
ok(/\.prod-description \.prod-description-body, \.prod-description \.prod-description-rich \{ margin: 0 -6px; padding: 3px 6px; border-radius: 6px; min-height: 30px; \}/.test(INDEX),
  'read view and editor have the same margin and padding, so the text does not move when editing starts');
ok(/\.prod-description-rich \{ position: relative; outline: none; box-shadow: 0 0 0 1px var\(--prod-accent\)/.test(INDEX), 'the editor adds a hairline ring and nothing else');
ok(!/\.prod-description-rich \{[^}]*max-height/.test(INDEX) && !/\.prod-description-rich \{[^}]*overflow/.test(INDEX), 'and no height cap or inner scroll box');
ok(/\.prod-description-body\[data-prod-desc-click-edit\] \{ cursor: text; \}/.test(INDEX), 'the read view shows a text cursor where a click edits');
ok(/\.prod-desc \.prod-md-gap \{ display: none; \}/.test(INDEX), 'the collapsed blank line generates no box, so margins collapse as in the read view');
ok(/\.prod-linkpop \{ position: fixed; z-index: 10000;/.test(INDEX), 'the link card sits with the toast, under the tooltip');
const linkify = grabFunc(INDEX, 'function _prodLinkify(');
ok(/const blockPart = part => /.test(linkify) && /!blockPart\(part\) \? '<br>' : ''/.test(linkify),
  'the read renderer no longer draws a spare empty line after a heading, rule, bullet or image');

/* ---- 4. Artifact first ---------------------------------------------------- */
console.log('the artifact carries the same editor');
ok(/function descRichBuild\(/.test(ARTIFACT) && /function descRichSerialize\(/.test(ARTIFACT) && /function descLinkPopShow\(/.test(ARTIFACT), 'the module lives in the design artifact');
ok(/class="d-desc-text d-descrich" id="descedit" contenteditable="true"/.test(ARTIFACT) && /data-desc-click-edit="1"/.test(ARTIFACT),
  'and the artifact edits in place through it, with the textarea kept as the fallback');
ok(/\.d-desc \.md-gap\{display:none\}/.test(ARTIFACT), 'with the same collapsed-gap rule');
const fidelity = fs.readFileSync(path.join(__dirname, 'port-fidelity-check.js'), 'utf8');
ok(/\['descRichBuild', '_prodDescRichBuild'\]/.test(fidelity) && /\['descLinkPopApply', '_prodDescLinkPopApply'\]/.test(fidelity), 'every module function is a mapped port');

if (failed) { console.log(`\n${failed} in-place description editor check(s) failed`); process.exit(1); }
console.log('in-place description editor checks passed');
