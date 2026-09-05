'use strict';
/*
 * Pasting an image into a description: the browser half.
 *
 * Owner, 2026-08-31: "could you look into pasting images in the description?
 * ... same way it does in linear. So just a simple pasting of a screenshot or
 * whatever." And on 2026-09-05, on sizing: "avoid things where people paste
 * something and it looks huge or horrible."
 *
 * test/prod-description-images.js proves the RENDER half. This proves the
 * paste half by executing the real helpers out of index.html:
 *   - an image on the clipboard is intercepted, plain text is not;
 *   - the placeholder lands on its own line at the caret and is swapped for
 *     the markdown image, or removed on failure, without moving the caret;
 *   - the long-edge fit never upscales and PNG stays PNG;
 *   - a half-finished upload cannot be saved;
 *   - the rendered image is bounded in height and opens full size on click.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function grabFunc(signature) {
  const start = INDEX.indexOf(signature);
  if (start < 0) throw new Error('not found: ' + signature);
  let depth = 0, quote = '', comment = '', escaped = false;
  for (let i = INDEX.indexOf('{', start); i < INDEX.length; i++) {
    const c = INDEX[i], n = INDEX[i + 1];
    if (comment === 'line') { if (c === '\n') comment = ''; continue; }
    if (comment === 'block') { if (c === '*' && n === '/') { comment = ''; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && n === '/') { comment = 'line'; i++; continue; }
    if (c === '/' && n === '*') { comment = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return INDEX.slice(start, i + 1);
  }
  throw new Error('unclosed: ' + signature);
}
function grabLine(prefix) {
  const start = INDEX.indexOf(prefix);
  if (start < 0) throw new Error('not found: ' + prefix);
  const end = INDEX.indexOf('\n', start);
  return INDEX.slice(start, end).trim();
}

/* A minimal editor world: one state, one textarea, a draft-input hook that
   mirrors what the real one records. */
const ctx = {
  console,
  document: { get activeElement() { return ctx.textarea; } },
  renders: 0,
  toasts: [],
  state: null,
  textarea: null,
};
vm.createContext(ctx);
vm.runInContext([
  grabLine('const PROD_DESCRIPTION_IMAGE_MAX_EDGE ='),
  grabLine('const PROD_DESCRIPTION_IMAGE_MAX_BYTES ='),
  grabLine('const PROD_DESCRIPTION_IMAGE_TYPES ='),
  grabLine('const PROD_DESCRIPTION_IMAGE_PLACEHOLDER_RE ='),
  'let _prodDescriptionImageSeq = 0;',
  grabFunc('function _prodDescriptionImagePlaceholder('),
  grabFunc('function _prodDescriptionImageFit('),
  grabFunc('function _prodDescriptionImageOutputType('),
  grabFunc('function _prodDescriptionImageAlt('),
  grabFunc('function _prodDescriptionImageErrorText('),
  grabFunc('function _prodDescriptionTransferImages('),
  grabFunc('function _prodDescriptionPaste('),
  grabFunc('function _prodDescriptionInsertAtCaret('),
  grabFunc('function _prodDescriptionReplaceInDraft('),
  'function _prodDescriptionState() { return state; }',
  'function _prodDescriptionSourceInput() { return textarea; }',
  'function _prodDescriptionInsertImages(id, input, files) { this.inserted = files; }',
  'function _prodDescriptionDraftInput(id, value) { state.draft = value; }',
  'function _prodRender() { renders++; }',
  'this.fit = _prodDescriptionImageFit; this.outType = _prodDescriptionImageOutputType;',
  'this.alt = _prodDescriptionImageAlt; this.errText = _prodDescriptionImageErrorText;',
  'this.transfer = _prodDescriptionTransferImages; this.paste = _prodDescriptionPaste;',
  'this.insert = _prodDescriptionInsertAtCaret; this.replace = _prodDescriptionReplaceInDraft;',
  'this.placeholder = _prodDescriptionImagePlaceholder; this.PLACEHOLDER_RE = PROD_DESCRIPTION_IMAGE_PLACEHOLDER_RE;',
].join('\n'), ctx);

function fakeTextarea(value, start, end) {
  return { tagName: 'TEXTAREA', value, selectionStart: start, selectionEnd: end == null ? start : end,
    setSelectionRange(s, e) { this.selectionStart = s; this.selectionEnd = e; } };
}
function reset(value, caret) {
  ctx.state = { draft: value, selectionStart: caret, selectionEnd: caret, editing: true, preview: false };
  ctx.textarea = fakeTextarea(value, caret);
  ctx.renders = 0;
}

/* ---- 1. Sizing: the long edge, never upscaled -------------------------- */
console.log('a pasted screenshot is sized before it travels');
let f = ctx.fit(3200, 1800, 1600);
ok(f.width === 1600 && f.height === 900 && f.scale === 0.5, 'a 2x Retina capture is halved to 1600 on the long edge');
f = ctx.fit(800, 600, 1600);
ok(f.width === 800 && f.height === 600 && f.scale === 1, 'a small image keeps its own pixels — never upscaled');
f = ctx.fit(1000, 4000, 1600);
ok(f.width === 400 && f.height === 1600, 'a tall capture is fitted by its HEIGHT, which is the long edge');
f = ctx.fit(0, 0, 1600);
ok(f.width === 1 && f.height === 1, 'nonsense dimensions clamp to a pixel rather than dividing by zero');
ok(ctx.outType('image/png') === 'image/png', 'PNG stays PNG — text and flat colour stay crisp, transparency survives');
ok(ctx.outType('image/webp') === 'image/jpeg' && ctx.outType('image/jpeg') === 'image/jpeg', 'anything else redrawn goes out as JPEG');
ok(/if \(type === 'image\/gif'\) return passThrough\(\);[\s\S]*createImageBitmap/.test(grabFunc('async function _prodDescriptionPrepareImage(')),
  'a GIF passes through untouched BEFORE any decode — redrawing it on a canvas would drop its frames');

/* ---- 2. Alt text -------------------------------------------------------- */
console.log('alt text is a name, not the clipboard\'s default');
ok(ctx.alt({ name: 'image.png' }, 3) === 'Pasted image 3', '"image.png" — what every clipboard paste is called — is not an alt text');
ok(ctx.alt({ name: 'Screenshot (2).png' }, 4) === 'Pasted image 4', 'nor is "Screenshot (2)"');
ok(ctx.alt({ name: 'homepage hero v2.png' }, 1) === 'homepage hero v2', 'a real filename is kept, minus its extension');
ok(ctx.alt({ name: 'a]b[c\nd.png' }, 1) === 'a b c d', 'brackets and newlines — the characters that would break ![alt](url) — are stripped');

/* ---- 3. The clipboard: images intercepted, text left alone ------------- */
console.log('only an image paste is intercepted');
const img = { kind: 'file', type: 'image/png', getAsFile: () => ({ name: 'image.png', type: 'image/png', size: 10 }) };
const txt = { kind: 'string', type: 'text/plain', getAsFile: () => null };
ok(ctx.transfer({ items: [txt] }, false).length === 0, 'a text-only clipboard yields no files');
ok(ctx.transfer({ items: [txt, img] }, false).length === 1, 'an image item among text yields the image');
ok(ctx.transfer({ items: [{ kind: 'file', type: 'application/pdf', getAsFile: () => ({}) }] }, false).length === 0, 'a non-image file is not an image');
ok(ctx.transfer({ items: [{ kind: 'file', type: 'image/png', getAsFile: () => null }] }, true).length === 1,
  'during a dragover the files are unreadable, so the probe answers from the item kind');
ok(ctx.transfer({ files: [{ type: 'image/jpeg' }, { type: 'text/plain' }] }, false).length === 1, 'a DataTransfer with only .files still works');

let prevented = 0;
const textEvent = { clipboardData: { items: [txt] }, preventDefault() { prevented++; } };
ok(ctx.paste(textEvent, 'd1') === true && prevented === 0,
  'THE RULE: a plain text paste returns true and is never preventDefault-ed — the browser\'s own paste happens');
ctx.inserted = null;
const imageEvent = { clipboardData: { items: [img] }, preventDefault() { prevented++; }, currentTarget: {} };
ok(ctx.paste(imageEvent, 'd1') === false && prevented === 1 && ctx.inserted && ctx.inserted.length === 1,
  'an image paste is prevented and handed to the uploader');

/* ---- 4. The placeholder: own line, at the caret, swapped in place ------- */
console.log('the placeholder answers the keystroke and is replaced where it stands');
reset('Brief:', 6);
const ph = ctx.placeholder(1);
ctx.insert('d1', ctx.textarea, ph);
ok(ctx.textarea.value === 'Brief:\n' + ph, 'at the end of a line the placeholder goes on a new line');
ok(ctx.state.draft === ctx.textarea.value, 'and the draft is updated with it, so a re-render cannot lose it');
ok(ctx.textarea.selectionStart === ctx.textarea.value.length, 'caret sits after the placeholder');
ok(ctx.PLACEHOLDER_RE.test(ctx.state.draft), 'the save guard recognises it');

reset('one\ntwo', 2);
ctx.insert('d1', ctx.textarea, ph);
ok(ctx.textarea.value === 'on\n' + ph + '\ne\ntwo', 'mid-line, it gets a newline on both sides');

reset('', 0);
ctx.insert('d1', ctx.textarea, ph);
ok(ctx.textarea.value === ph, 'in an empty editor there are no stray newlines');

reset('Brief:\n' + ph + '\nAfter', 7 + ph.length + 6);
const md = '![Pasted image 1](https://x.supabase.co/storage/v1/object/public/syncview-description-images/abc.png)';
ok(ctx.replace('d1', ph, md) === true, 'the placeholder is found');
ok(ctx.textarea.value === 'Brief:\n' + md + '\nAfter', 'and swapped for the markdown image in place');
ok(ctx.state.draft === ctx.textarea.value, 'in the draft too');
ok(ctx.textarea.selectionStart === ctx.textarea.value.length, 'a caret that was after it moves with the text');

reset('Brief:\n' + ph + '\nAfter', 3);
ctx.replace('d1', ph, md);
ok(ctx.textarea.selectionStart === 3, 'a caret that was before it does not move');

reset('Brief:\n' + ph, 6);
ctx.replace('d1', ph, '');
ok(ctx.textarea.value === 'Brief:', 'a FAILED upload removes the placeholder and the line it was given — nothing half-done is left behind');
reset('Brief:\n' + ph + '\nAfter', 0);
ctx.replace('d1', ph, '');
ok(ctx.textarea.value === 'Brief:\nAfter', 'same when it sits between lines');

reset('gone', 0);
ok(ctx.replace('d1', ph, md) === false, 'a placeholder that is no longer in the draft (editor cancelled) is reported, not force-inserted');

ctx.textarea = null;
ctx.state = { draft: 'x\n' + ph, selectionStart: 0, selectionEnd: 0, editing: true, preview: true };
ctx.renders = 0;
ctx.replace('d1', ph, md);
ok(ctx.state.draft === 'x\n' + md && ctx.renders === 1, 'with the editor in Preview the draft is updated and the preview redrawn');

/* ---- 5. Wiring in the page --------------------------------------------- */
console.log('the editor and the save path are wired');
const panel = grabFunc('function _prodDescriptionPanelHTML(');
ok(/onpaste="return _prodDescriptionPaste\(event,/.test(panel) && /ondrop="return _prodDescriptionDrop\(event,/.test(panel),
  'the description textarea carries the paste and drop handlers');
ok(/Paste or drop an image to add it/.test(panel), 'and says so in a visible hint, not a tooltip');
ok(/state\.uploading > 0 \? ' disabled'/.test(panel), 'Save renders disabled while an upload is in flight');
const save = grabFunc('async function _prodSaveDescription(');
ok(/PROD_DESCRIPTION_IMAGE_PLACEHOLDER_RE\.test\(description\)/.test(save) && /still uploading/.test(save),
  'and the save refuses a draft that still carries a placeholder — the literal "Uploading image" must never reach Linear');
const post = grabFunc('async function _prodDescriptionPostImage(');
ok(/_syncviewEfHeaders\(/.test(post) && /'Content-Type': prepared\.type/.test(post) && /body: prepared\.blob/.test(post),
  'the upload is raw bytes under the staff headers, labelled with the type the browser produced');
ok(!/FormData|base64|readAsDataURL/.test(post + grabFunc('async function _prodDescriptionPrepareImage(')),
  'no base64 and no data: URL detour — the bytes travel as bytes');
ok(post.includes('/^https:\\/\\/[^\\s)]+$/.test(url)'),
  'only an https URL from the function is accepted into the markdown');
ok(/const PROD_DESCRIPTION_IMAGE_EF_URL = CAL_SUPABASE_URL \+ '\/functions\/v1\/description-image-upload';/.test(INDEX),
  'the endpoint is composed from the Supabase base like its siblings');

/* ---- 6. Display: bounded height, click to open ------------------------- */
console.log('a rendered image is bounded and opens full size');
ok(/\.prod-desc-image \{[^}]*max-height: 360px/.test(INDEX), 'a tall screenshot is capped at 360px in the panel');
ok(/\.prod-desc-image \{[^}]*width: auto[^}]*height: auto/.test(INDEX) || /\.prod-desc-image \{[^}]*height: auto[^}]*width: auto/.test(INDEX),
  'with both dimensions auto so the aspect ratio holds under the cap');
ok(/\.prod-desc-image \{[^}]*cursor: zoom-in/.test(INDEX), 'and a zoom-in cursor that says it can be opened');
const opener = grabFunc('function _prodDescriptionImageOpen(');
ok(/closest\('img\.prod-desc-image'\)/.test(opener) && /\/\^https:\\\/\\\/\/\.test\(src\)/.test(opener) && /window\.open\(src, '_blank', 'noopener,noreferrer'\)/.test(opener),
  'a click on a description image opens it in a new tab — https only, delegated so no handler attribute sits on the img');
ok(/document\.addEventListener\('click', _prodDescriptionImageOpen\)/.test(INDEX), 'the opener is wired to click');
/* Codex on #1310: an unfocusable <img> with a click listener is mouse-only. */
const tag = grabFunc('function _prodLinkifyInline(');
ok(/tabindex="0" role="link"/.test(tag), 'the rendered image is focusable with link semantics');
const keyOpener = INDEX.slice(INDEX.indexOf("document.addEventListener('keydown', function (event) {", INDEX.indexOf('_prodDescriptionImageOpen)')), INDEX.indexOf('_prodDescriptionImageOpen(event);') + 40);
ok(/event\.key !== 'Enter' && event\.key !== ' '/.test(keyOpener) && /_prodDescriptionImageOpen\(event\)/.test(keyOpener),
  'and Enter or Space on the focused image opens it, through the same opener as the click');
ok(/\.prod-desc-image:focus-visible \{[^}]*outline/.test(INDEX), 'with a visible focus ring');

/* ---- 7. Error copy ------------------------------------------------------ */
console.log('a refusal says why');
ok(/PNG, JPEG, WebP or GIF/.test(ctx.errText({ code: 'image_type_mismatch' })), 'a bytes/label mismatch reads as an unsupported type, in words');
ok(/4 MB/.test(ctx.errText({ code: 'image_too_large' })), 'too large names the number');
ok(/sign-in/.test(ctx.errText({ status: 401 })), 'a 401 asks for sign-in');
ok(/not available yet/.test(ctx.errText({ status: 404 })), 'a 404 — the function not deployed yet — says so instead of blaming the image');
ok(/unchanged/.test(ctx.errText({})), 'the default says the description was left alone');

console.log(failures === 0
  ? '\ndescription image paste checks passed'
  : '\n' + failures + ' description image paste check(s) failed');
process.exit(failures === 0 ? 0 : 1);
