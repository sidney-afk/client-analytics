'use strict';
/*
 * Descriptions can show a pasted image.
 *
 * Owner request, 2026-08-31: "could you look into pasting images in the
 * description? ... same way it does in linear. So just a simple pasting of a
 * screenshot or whatever."
 *
 * This is the RENDER half, and it is a prerequisite rather than the whole
 * feature: before it, `![alt](url)` in a description was not image syntax to
 * this app at all. The inner `[alt](url)` matched the link rule, so a pasted
 * screenshot rendered as a stray `!` followed by a blue link to a PNG. Nothing
 * anywhere turned it into a picture.
 *
 * WHY httpS ONLY, and why that is a security property rather than a style
 * choice. An `<img src>` is an execution surface: `javascript:` is the classic
 * XSS payload and `data:` lets a description carry its own bytes past every
 * content check. Plain `http:` would be blocked as mixed content on the live
 * site anyway, so admitting it would only produce a broken image with a worse
 * failure mode than a link. Anything that is not https therefore falls through
 * to the ordinary link rules, which is the honest outcome for a URL this cannot
 * display.
 *
 * The other rule worth keeping: `referrerpolicy="no-referrer"`. The SyncView
 * URL carries the client slug in its query string, and a remote image host has
 * no business being told which client's board is open.
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

/* Comment-aware: index.html comments are prose full of apostrophes and braces,
   which a quote-only matcher reads as code and then reports "unclosed" for a
   function that balances perfectly. */
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

/* The REAL renderer, executed. Nothing here is a reimplementation. */
const ctx = {};
vm.createContext(ctx);
vm.runInContext([
  grabFunc('function _calEsc('),
  grabFunc('function _prodNormalizeMarkdownLine('),
  grabFunc('function _prodMarkdownBlockish('),
  grabFunc('function _prodLinkifyInline('),
  grabFunc('function _prodLinkify('),
  'this.inline = _prodLinkifyInline; this.block = _prodLinkify;',
].join('\n'), ctx);
// Descriptions opt in; everything else does not. The inline helper is exercised
// with images ON below, because that is the only mode where they can appear.
const render = s => ctx.inline(s, true);

/* ---- 1. An https image becomes an image ---------------------------------- */

const shot = render('![shot](https://cdn.example.com/a.png)');
ok(/^<img /.test(shot), 'an https image renders as an img element');
ok(/src="https:\/\/cdn\.example\.com\/a\.png"/.test(shot), 'with the URL it was given');
ok(/alt="shot"/.test(shot), 'carrying its alt text');
ok(/referrerpolicy="no-referrer"/.test(shot),
  'and no referrer — the SyncView URL carries the client slug, and the image host must not learn which client is open');
ok(/loading="lazy"/.test(shot),
  'and lazily, so a description with several screenshots is not several full-size fetches on a panel nobody scrolled');
ok(!/<a /.test(shot),
  'and it is NOT also a link — before this, the inner [alt](url) matched the link rule and left a stray ! in front of an anchor');

ok(/alt="Pasted image"/.test(render('![](https://cdn.example.com/a.png)')),
  'an image with no alt still gets an accessible name rather than an empty one');

/* ---- 2. THE SECURITY PROPERTY: only https reaches an img src ------------- */

[
  ['javascript:alert(1)', 'javascript:'],
  ['data:image/png;base64,AAAA', 'data:'],
  ['vbscript:msgbox(1)', 'vbscript:'],
  ['JaVaScRiPt:alert(1)', 'mixed-case javascript:'],
  ['//evil.example.com/a.png', 'protocol-relative'],
].forEach(([url, label]) => {
  const out = render('![x](' + url + ')');
  ok(!/<img/.test(out), label + ' never becomes an image');
  ok(!/<a /.test(out), label + ' never becomes a link either — it stays inert text');
});

const httpOut = render('![x](http://cdn.example.com/a.png)');
ok(!/<img/.test(httpOut),
  'plain http never becomes an image — it would be blocked as mixed content anyway, so admitting it would only break more quietly');

/* ---- 3. Ordinary links are untouched ------------------------------------ */

const link = render('[link](https://example.com/a.png)');
ok(/^<a /.test(link) && !/<img/.test(link),
  'a link to an image is still a link — only the ! form is an image');
const bare = render('https://example.com/a.png');
ok(/^<a /.test(bare) && !/<img/.test(bare),
  'and a bare URL is still autolinked, image extension or not');

const mixed = render('see ![a](https://e.com/a.png) and https://e.com/x');
ok(/<img/.test(mixed) && /<a /.test(mixed),
  'an image and a link in one line each render as themselves');

/* ---- 4. The alt text cannot break out of the attribute ------------------ */
/* _calEsc runs first and turns " into &quot;, so a crafted alt cannot close the
   attribute and add its own. Executed rather than assumed. */

const crafted = render('![" onerror="alert(1)](https://e.com/a.png)');
ok(!/onerror=/.test(crafted) || /&quot;/.test(crafted),
  'a quote in the alt text is escaped before it reaches the attribute');
/* Blank every quoted VALUE before looking for handler attributes. The first
   version of this check searched the raw string and failed on safe output: the
   payload's own text ` onerror=` sits inside the escaped alt value, where a
   browser reads it as characters, not as an attribute. Searching raw text for
   an attribute is the same mistake as searching source for a call — it finds
   the words rather than the structure. */
const attributesOnly = crafted.replace(/"[^"]*"/g, '""');
ok(!/\son[a-z]+=/i.test(attributesOnly),
  'and no event handler attribute can be injected through it — the payload stays inside the alt value, where it is text');
ok(/alt="&quot; onerror=&quot;alert\(1\)"/.test(crafted),
  'the quotes that would have closed the attribute are entity-encoded, which is what makes that true');

/* ---- 5. THE SHARED-RENDERER TRAP: comments must stay link-only --------- */
/* _prodLinkify draws descriptions, live comment bodies (_prodCommentHTML) AND
   archived comment bodies. Comments are the one surface CLIENTS write on,
   through their review links. Rendering an image unconditionally would let a
   comment author post a tracking pixel and have every staff browser that opens
   the thread fetch it — reporting the reader's IP and the exact moment they
   read it. referrerpolicy hides which page, not who or when.
   Raised by review on PR 1204, after the first version of this change did
   exactly that. */

const pixel = '![x](https://attacker.example/track)';

const asComment = ctx.block(pixel);
ok(!/<img/.test(asComment),
  'THE FINDING: a comment body renders NO image — a client-authored tracking pixel must not be fetched by the reader');
ok(/<a /.test(asComment),
  'it stays a link, so nothing is hidden from the reader — it simply is not loaded for them');

const asDescription = ctx.block(pixel, { images: true });
ok(/<img/.test(asDescription),
  'a description DOES render it — the write is admin/SMM only on both a deliverable and a batch parent, so the author is staff');

ok(ctx.block(pixel, {}) === asComment && ctx.block(pixel, null) === asComment,
  'and the default is OFF: an absent or empty option renders link-only, so a new caller that forgets the flag fails safe');

/* The flag has to reach every line shape, not just plain paragraphs. */
ok(!/<img/.test(ctx.block('# ' + pixel)) && /<img/.test(ctx.block('# ' + pixel, { images: true })),
  'the flag reaches heading lines');
ok(!/<img/.test(ctx.block('- ' + pixel)) && /<img/.test(ctx.block('- ' + pixel, { images: true })),
  'and bullet lines — a per-line renderer that dropped the flag on one shape would leak through it');

/* ---- 6. The style keeps a screenshot inside the panel ------------------- */

ok(/\.prod-desc-image \{[^}]*max-width: 100%/.test(INDEX),
  'a pasted screenshot is bounded by the panel rather than pushing it sideways');
ok(/\.prod-desc-image \{[^}]*height: auto/.test(INDEX),
  'and keeps its aspect ratio');
ok(/\.prod-desc-image \{[^}]*display: block/.test(INDEX),
  'and is a block, because an inline image inside white-space:pre-wrap leaves a stripe of blank line under it');

console.log(failures === 0
  ? '\ndescription image render checks passed'
  : '\n' + failures + ' description image check(s) failed');
process.exit(failures === 0 ? 0 : 1);
