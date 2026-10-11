// Pure helpers for the thumbnail-titles functions, shared with the unit test.
//
// The spec is the retired n8n step "Generate Titles" (workflow VIDEO
// PRODUCTION AUTOMATION, webhook graphic-form), read only on 2026-10-09: it
// downloaded the client's filming plan and asked Claude for a 2 to 5 word
// title per video, which became the thumbnail sub-issue's description. It
// stopped when batches moved into SyncView (commit 598371e9, 2026-09-22).
// Nothing here talks to the network or the database.

// The n8n node's own instruction, kept word for word where it still applies.
// The video list, the filming plan and the answer format are appended by the
// function (like the transcript after a caption prompt), so a person editing
// the prompt only ever edits the instructions.
export const N8N_TITLE_PROMPT = [
  "You write short, punchy reel titles.",
  "",
  "For each video, write a title (2-5 words) using this approach:",
  "- Find the most quotable, surprising, or emotionally punchy phrase in that video",
  "- Either quote it directly or distill it to its sharpest form",
  "- NO descriptions, NO filler words, NO clinical language",
].join("\n");

export const STYLE_HEADER = "This client's style:";
// Facts about how the client talks to the agency, not how their content reads.
export const STYLE_EXCLUDE = /communication|talks? to us|relationship|source status|historical/i;

// ---------------------------------------------------------------------------
// The cleaner. The Brain's voice file is written for people who audit it: every
// line carries where it came from, which call, which segment, which date. None
// of that helps a title, and it buries the rules. This turns the written facts
// into a short style section with plain code, so the same file always gives the
// same prompt. Nothing here summarises or rewrites a sentence: it keeps a
// sentence whole (minus its source notes) or leaves it out, and a boundary
// sentence is never left out.
// ---------------------------------------------------------------------------

// A line that only says where something came from or how sure the Brain is.
const PROVENANCE_ALWAYS = /\bread off\b|\bthis part is\b|\bprompt row\b|\bnobody has (?:said|stated)\b|\bnothing (?:he|she|they) (?:has )?stated\b|\bhas never commented\b|\beverything above\b|\bin here\b|\bsupersede|\.(?:mp4|mov|md)\b|\bsource-authored\b|\bnot (?:measured|owner-approved)\b/i;
const PROVENANCE = /\bnot a complete\b|\bhistorical preference\b|source status|\bretrieved\b|\bcaptured\b|verbatim excerpt|source-authored|\bnot (?:measured|approved|owner-approved)\b|\bsegments? \d|^evidence\b|captionprompts|clients info|\bgemini\b|\bread from words only\b|\brule 6\b|\baccepted by\b|\bproposal\b|\binference\b|\bundated\b|\bnobody has stated\b|\bfathom\b|\bframe\.io\b|\bwas not captured\b|\bnot recorded\b|\bthese are (?:kasper|sidney)/i;
// A parenthetical or tail that is a reference, not content.
const REF_PAREN = /\b(?:19|20)\d\d\b|\bsegments?\b|\bnative\b|\bfathom\b|\bslack\b|\bsyncview\b|\bframe\.io\b|\bcalendar\b|\bcall\b|\btranscript\b|inputs\/|\.(?:mp4|md|mov)\b|\b\d+ of \d+\b|\bsource\b|\bV\d\b|\d\d:\d\d|^\s*\d\d-\d\d\s*$|^\s*\d+\s*$/i;
const MONTH_RE = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DATE_PIECES = [
  new RegExp(`\\b(?:on |since |from |in |by |between )?${MONTH_RE}\\.? \\d{1,2}(?:st|nd|rd|th)?(?:,? (?:19|20)\\d\\d)?(?: (?:and|to|through) ${MONTH_RE}?\\.? ?\\d{1,2}(?:st|nd|rd|th)?)?\\b`, "gi"),
  new RegExp(`\\b(?:on |since |from |in |by |between )?${MONTH_RE}\\.? (?:19|20)\\d\\d\\b`, "gi"),
  /\b(?:on |since |from |between |and |to |until )?(?:19|20)\d\d-\d\d-\d\d\b/gi,
  /\b(?:19|20)\d\d\b/g,
];

// Rules about what NOT to do or what the client will not have. Wide on
// purpose: a false hit costs one line of prompt, a miss costs a rule.
export const BOUNDARY = /\b(?:never|don'?t|do not|doesn'?t want|does not want|didn'?t want|did not want|must not|mustn'?t|should not|shouldn'?t|cannot|can'?t|won'?t|will not|avoid(?:s|ed|ing)?|refus(?:e|es|ed|al)|reject(?:s|ed|ing)?|banned?|forbid(?:s|den)?|off[- ]limits|boundar(?:y|ies)|not (?:hers|his|theirs|okay|allowed|comfortable)|no (?:swearing|profanity|emoji|eyes emoji)|nothing is banned|without (?:her|his|their) (?:approval|ok|consent)|stop(?:s|ped)? using|drop|confidential|privacy|private|sensitive|off the record|not (?:to be )?(?:named|mentioned|shared|disclosed|used|public)|leave(?:s)? out|keep(?:s)? out)\b|^\W*no [a-z]/i;
// A choice between two wordings, only a rule when a word is quoted.
const PREFERENCE = /\b(?:she|he|they|[A-Z][a-z]+) (?:wanted|wants|prefers?|preferred|asked for|chose)\b[^.]*\b(?:instead of|rather than|to)\b|\bprefers?\b/;
// Of the rules, the ones about privacy, names and labels (the hardest limits).
const HARD_LIMIT = /\b(?:privacy|private|confidential|medical|diagnos\w*|patients?|names?|labels?|calls? (?:her|him|them|it)|referr?(?:ed|ing)|boundar(?:y|ies)|intimate|exposed|family|kids?|children|husband|wife|partner|religio\w*|politic\w*)\b/i;
const TONE_WORDS = /\b(?:warm|warmth|direct|blunt|playful|calm|gentle|confident|conversational|humou?r|funny|witty|sincere|honest|vulnerab\w*|authoritative|casual|formal|clinical|upbeat|candid|nurturing|empathetic|bold|punchy|faith|grounded|tender|empath\w*|unapologetic\w*|soften\w*)\b/i;
const HOOK_WORDS = /\b(?:hooks?|titles?|headlines?|cover text|on-screen text|sentence case|all caps|lowercase|capitali[sz]\w*|pov)\b/i;
const GEOMETRY = /\b(?:box|plate|font|colou?r|px|pixel|hex|placement|cent(?:re|er)|stroke|shadow|serif|safe zone|corner|rounded|gradient|logo|watermark|subtitles?|percent|frame height|banner|pill|panel|sticker|arrows?|overlay|green screen|split[- ]screen|zoom)\b|#[0-9a-f]{6}|\d+ ?%/i;

// Labels ("Pace.", "**Eye line and address.**") that head a line. The delivery
// ones describe how the person looks and moves on camera, read off video by a
// model: an inference about delivery, so only a sentence that states a rule
// (never, avoid, refuses ...) is kept from them.
const DELIVERY_LABEL = /^(?:pace|pauses?(?: and emphasis)?|eye line(?: and address)?|face and gestures|scripted or natural|delivery(?:\b.*)?|read from words only.*|how (?:they|he|she) close|swearing)$/i;
const TONE_LABEL = /^(?:tone|energy|sentence length and rhythm|voice|attitude|personality|register|humou?r|how (?:they|he|she) address(?:es)? the viewer|what (?:she|he|they) sounds? like.*)$/i;
const WORD_LABEL = /^(?:words(?: (?:and|&) phrases)?(?: (?:she|he|they) uses?)?|vocabulary(?: and signature phrases)?|signature phrases?|phrases)$/i;
const AVOID_LABEL = /^(?:words(?: and (?:patterns|openings))? (?:(?:she|he|they) )?(?:avoids?|to avoid)|avoid|banned.*)$/i;
const HOOK_LABEL = /^(?:how (?:they|he|she) open|openings?|hooks?|written hooks?|titles?|top hook text)$/i;

const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9À-ɏ ]+/g, " ").replace(/\s+/g, " ").trim();

// Splits at sentence ends but never inside a quotation.
export function splitSentences(text) {
  const out = [];
  let cur = "", curly = 0, straight = false, paren = 0;
  const t = String(text || "");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    cur += ch;
    if (ch === "“") curly++;
    else if (ch === "”" && curly > 0) curly--;
    else if (ch === '"') straight = !straight;
    else if (ch === "(") paren++;
    else if (ch === ")" && paren > 0) paren--;
    const open = curly > 0 || straight;
    if (!open && !paren && /[.!?]/.test(ch) && /\s/.test(t[i + 1] || " ")) {
      const next = t.slice(i + 1).trimStart()[0] || "";
      const abbr = /\b(?:vs|e\.g|i\.e|etc|approx|dr|mr|mrs|ms)\.$/i.test(cur.trim()) || /[\]_]\.$/.test(cur);
      if (!abbr && (next === "" || /[A-Z"“*‘'(]/.test(next))) { out.push(cur.trim()); cur = ""; }
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// One sentence with its source notes taken off: markdown marks, reference
// parentheses, dates. Quotations are put aside first and restored untouched.
export function cleanSentence(raw) {
  const quotes = [];
  let s = String(raw || "").replace(/<!--[\s\S]*?-->/g, " ").replace(/^\s*(?:[-*>]\s+|\d+\.\s+)+/, "");
  s = s.replace(/\s*\b(?:in |from |see |per )?client\.[a-z0-9-]+\.[a-z0-9.-]*[a-z0-9]/gi, "");
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/`([^`]+)`/g, "“$1”").replace(/[`*]{1,3}/g, "");
  s = s.replace(/(?:“[^”]*”|"[^"]*")/g, (m) => { quotes.push(m); return `\u0001${quotes.length - 1}\u0001`; });
  s = s.replace(/\s*\(([^()]*)\)/g, (m, inner) => (REF_PAREN.test(inner.replace(/\u0001\d+\u0001/g, "")) ? "" : m));
  for (const re of DATE_PIECES) s = s.replace(re, "");
  s = s.replace(/^\s*from [“"]?[a-z]+\.[a-z-]+[”"]?:\s*/i, "").replace(/^\s*(?:historical )?(?:evidence|source)\b[^:]{0,40}:\s*/i, "");
  s = s.replace(/^\s*from \u0001(\d+)\u0001:\s*/i, (m, i) => (/^[“"]?[a-z]+\.[a-z-]+[”"]?$/i.test(quotes[Number(i)]) ? "" : m));
  s = s.replace(/^\s*(?:addition|added|superseded in part|updated?)\b[^:]{0,60}:\s*/i, "")
    .replace(/\s+(?:on|in|since|from|by|between|and)\s*(?=[,;:.]|$)/gi, "")
    .replace(/\s+([,;:.!?])/g, "$1").replace(/([,;:])\s*(?=[,;:.])/g, "").replace(/\s{2,}/g, " ").trim();
  s = s.replace(/\u0001(\d+)\u0001/g, (m, i) => quotes[Number(i)]).replace(/^[,;:.\s]+/, "").trim();
  return s;
}

// A sentence joined by a semicolon is two statements. When the whole sentence is not a writing
// instruction (a subtitle note beside a title rule), each half is judged on its own.
function splitClauses(sentence) {
  if (!notWritingReason(cleanSentence(sentence))) return [sentence];
  const parts = [];
  let cur = "", curly = 0, straight = false, paren = 0;
  for (let i = 0; i < sentence.length; i++) {
    const ch = sentence[i];
    if (ch === "“") curly++; else if (ch === "”" && curly > 0) curly--; else if (ch === '"') straight = !straight;
    else if (ch === "(") paren++; else if (ch === ")" && paren > 0) paren--;
    if (ch === ";" && curly === 0 && !straight && !paren && cur.trim().length >= 20 && sentence.slice(i + 1).trim().length >= 20) { parts.push(cur.trim() + "."); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// "**Pace.** Calm..." or "Pace. Calm..." -> { label: "pace", raw: "Pace", rest: "Calm..." }.
function splitLabel(line) {
  const t = String(line || "").replace(/^\s*(?:[-*]\s+)/, "").trim();
  let m = /^\*\*([^*]{2,80}?)\*\*[:.]?\s*(.*)$/.exec(t);
  if (!m) m = /^([A-Z][A-Za-z' ,/&-]{2,60}?)\.\s+(?=[A-Z"“*])(.*)$/.exec(t);
  if (!m || !m[2]) return { label: "", raw: "", rest: t };
  const raw = m[1].trim().replace(/[.:]+$/, "");
  return { label: raw.toLowerCase(), raw, rest: m[2].trim() };
}

const TITLE_CASE = (t) => t[0].toUpperCase() + t.slice(1);
const stripQuotes = (t) => t.replace(/(?:“[^”]*”|"[^"]*")/g, " ");
// A prohibition or a stated wish, outside any quotation (a quoted sample of speech that holds the word is no rule).
const STRONG = /^\W*never\b|^\W*(?:almost )?no [a-z]|\b(?:drop|do not|don'?t|must not|should not|shouldn'?t|avoid(?:s|ed)?|refus\w*|reject(?:s|ed)?|banned?|forbid\w*)\b/i;
export const isRule = (t) => { const bare = stripQuotes(t); return BOUNDARY.test(bare) || PREFERENCE.test(bare); };
// A quoted example this long is a sample of the voice, not a word they use: first 12 words kept.
const shortQuote = (t) => t.replace(/“([^”]*)”|"([^"]*)"/g, (q, a, b) => {
  const words = (a || b || "").trim().split(/\s+/);
  return words.length > 12 ? `“${words.slice(0, 12).join(" ")}…”` : q;
});

// Avoid and Boundaries hold only instructions about what to write. A rule
// sentence that is really something else is left out, with the reason.
const NOT_WRITING = [
  ["visual", /\b(?:subtitles?|fonts?|colou?rs?|gold|serif|hex|highlights?|thumbnails?|covers?|screen grabs?|images?|photos?|plates?|boxes|safe zone|stroke|shadow|gradient|logo|overlay)\b/i],
  ["delivery", /\b(?:on camera|camera|lens|eye line|eye contact|gestures?|pace|words a minute|pauses?|fillers?|talking head)\b/i],
  ["research", /\b(?:who to ask|next step|the (?:real )?open question|unresolved|loose end|nobody|never (?:been |yet )?(?:decided|made|written|stated|said|spoken|filled|objected)|not (?:written|stated|recorded|verified|established|a rule|permission|a complete)|do(?:es)? not (?:establish|prove|verify|describe|mix)|do not extrapolate|named no|is not asking|in (?:this|these|the) (?:video|videos|openings?)\b|openings? read\b|in any of the (?:five|\d+)\b|is adopted|this supplies|not a (?:general )?ban|a license to|kept here|deliberately|own-word evidence|evidence (?:for|that)|the source|this (?:fact|file|page|record)|no row exists|no caption prompt|has never commented|inference|both brands|two different (?:writers|voices))\b/i],
  ["past", /\b(?:caught|was told|were told|crossed it|logged as|handed the decision|reworded|published|posted|shipped|before we started|corrections? from|review (?:note|comment)s?|our (?:hook|scripts?|captions?) (?:said|used|crossed)|every caption (?:was|were)|rejected (?:the same caption|captions?\b|a caption))\b/i],
];
export function notWritingReason(text) {
  const bare = stripQuotes(text);
  for (const [why, re] of NOT_WRITING) if (re.test(bare)) return why;
  return "";
}

// Content words of a line, for spotting a line already said in the same section.
const words = (t) => new Set(norm(t).split(" ").filter((w) => w.length > 3 || /^\d+$/.test(w) || w === "not" || w === "no"));
function dedupeLines(lines) {
  const sets = lines.map(words);
  return lines.filter((_l, i) => !lines.some((_m, j) => {
    if (i === j || !sets[i].size) return false;
    const covered = [...sets[i]].filter((w) => sets[j].has(w)).length / sets[i].size;
    return covered >= 0.95 && (sets[j].size > sets[i].size || (sets[j].size === sets[i].size && j < i));
  }));
}

// The Brain wraps long lines by hand. A block is one bullet or one paragraph,
// with its wrapped lines joined back together.
function blocks(body) {
  const out = [];
  let cur = "";
  for (const line of String(body || "").replace(/\r\n/g, "\n").split("\n")) {
    const text = line.trim();
    if (!text || /^#/.test(text)) { if (cur) out.push(cur); cur = ""; continue; }
    if (/^(?:[-*]\s|\d+\.\s|\*\*[^*]{2,80}\*\*)/.test(text) || (cur && /^>/.test(cur) !== /^>/.test(text))) { if (cur) out.push(cur); cur = text; continue; }
    cur = cur ? `${cur} ${text.replace(/^>\s?/, "")}` : text;
  }
  if (cur) out.push(cur);
  return out;
}

// A fact whose heading is a list of things to avoid: each bold label in it is a rule.
const RULE_HEADING = /avoid|banned|never/i;

// Every kept sentence of the facts, cleaned, in source order. `kind` comes from
// the line's label ("tone", "words", "avoid", "hooks", "delivery", "rule", or ""
// for plain prose) and `line` ties the sentences of one line together.
export function styleSentences(facts) {
  const out = [];
  let line = 0;
  for (const f of facts || []) {
    for (const raw of blocks(f.body)) {
      line++;
      const { label, raw: labelRaw, rest } = splitLabel(raw);
      const kind = DELIVERY_LABEL.test(label) ? "delivery" : TONE_LABEL.test(label) ? "tone" : WORD_LABEL.test(label) ? "words" : AVOID_LABEL.test(label) ? "avoid"
        : HOOK_LABEL.test(label) ? "hooks" : "";
      const meta = { label, line, heading: String(f.heading || ""), file: String(f.file || "") };
      // A label that is itself a rule ("Never the word ...", or any label in a list of things to avoid) is a sentence of its own.
      if (label && !kind && (isRule(labelRaw) || RULE_HEADING.test(f.heading || ""))) {
        const text = cleanSentence(`${labelRaw}.`);
        if (text.replace(/[^A-Za-z]/g, "").length >= 6) out.push({ text: TITLE_CASE(text), kind: "rule", ...meta });
        // What follows a rule label is its evidence (who asked, when, in what words), not a second rule.
        if (!isRule(labelRaw)) meta.evidence = true;
      }
      if (label && !isRule(labelRaw) && /^(?:research|past)$/.test(notWritingReason(labelRaw))) meta.evidence = true;
      for (const piece of splitSentences(rest).flatMap(splitClauses)) {
        const text = cleanSentence(piece);
        if (PROVENANCE_ALWAYS.test(text) || (PROVENANCE.test(text) && !isRule(text))) continue;
        if (text.replace(/[^A-Za-z]/g, "").length < 12) continue;
        out.push({ text: TITLE_CASE(text), kind: meta.evidence && !isRule(text) ? "evidence" : kind, ...meta });
      }
    }
  }
  return out;
}

// Drops a sentence already said: equal, or contained in a longer one.
function dedupe(items) {
  const keys = items.map((i) => norm(i.text));
  return items.filter((it, idx) => !keys.some((k, j) => j !== idx && k.length > keys[idx].length && k.includes(keys[idx]))
    && keys.indexOf(keys[idx]) === idx);
}

const LINE_MAX = 320;
// A reviewer's or the team's comment, not the client's own words.
const REVIEWER = /\b(?:they|he|she|we|kasper|eva|luke|ludmila|team|client)\s+(?:said|asked|wrote|requested|told|rejected)\b|\basked for\b|\bplease\b|:\)|\bshould be\b|\bcould we\b/i;

// The sentences of one labelled line, joined, as long as they fit. A sentence
// that states a prohibition never goes over the edge: it becomes a line of its own.
function lineTexts(items, withLabel) {
  const out = [];
  let text = "";
  for (const it of items) {
    const next = shortQuote(it.text);
    if (text && (text + " " + next).length > LINE_MAX) {
      if (!isRule(it.text)) continue;
      out.push(text);
      text = next;
      continue;
    }
    text = text ? `${text} ${next}` : next;
  }
  if (text) out.push(text);
  const label = withLabel && items[0].label && !isRule(items[0].label) ? `${TITLE_CASE(items[0].label)}: ` : "";
  return out.filter((t) => t.length > 12).map((t, i) => (i === 0 ? label + t : t));
}

// Trims a list of lines to `max`, but a line that states a prohibition is never the one trimmed.
function capKeepingRules(lines, max) {
  const rule = lines.map((l) => isRule(l));
  const room = Math.max(2, max - rule.filter(Boolean).length);
  let seen = 0;
  return lines.filter((_l, i) => rule[i] || ++seen <= room);
}

// Every line of the style section, and every line left out with the reason.
export function styleParts(facts) {
  const all = dedupe(styleSentences(facts));
  const rules = { boundary: [], avoid: [] }, tone = new Map(), hooks = new Map(), vocab = new Map(), dropped = [];
  for (const s of all) {
    if (s.kind === "delivery") { dropped.push({ text: s.text, why: "delivery" }); continue; }
    if (s.kind === "evidence") { dropped.push({ text: s.text, why: "evidence for a rule" }); continue; }
    const bare = stripQuotes(s.text);
    const preferenceOnly = !BOUNDARY.test(bare) && PREFERENCE.test(bare) && s.kind !== "rule" && s.kind !== "avoid";
    // A line headed as tone, words or hooks stays there unless it states a plain prohibition.
    const stays = (s.kind === "tone" || s.kind === "words" || s.kind === "hooks") && !STRONG.test(bare);
    const rule = !stays && (s.kind === "rule" || s.kind === "avoid" || isRule(s.text)) && !(preferenceOnly && !/“|"/.test(s.text));
    if (rule) {
      const why = notWritingReason(s.text);
      if (why) { dropped.push({ text: s.text, why }); continue; }
      (HARD_LIMIT.test(bare) ? rules.boundary : rules.avoid).push(s.text);
      continue;
    }
    if (s.kind === "words") {
      if (REVIEWER.test(s.text)) { dropped.push({ text: s.text, why: "reviewer comment, not their words" }); continue; }
      vocab.set(s.line, [...(vocab.get(s.line) || []), s]);
      continue;
    }
    const why = notWritingReason(s.text);
    if (why === "research" || why === "past") { dropped.push({ text: s.text, why }); continue; }
    if (/please|:\)|could we say/i.test(s.text)) { dropped.push({ text: s.text, why: "reviewer comment, not their words" }); continue; }
    const toneLine = s.kind === "tone" || preferenceOnly || (s.file === "voice" && !s.kind && TONE_WORDS.test(s.text) && s.text.length <= LINE_MAX);
    const hookLine = (s.kind === "hooks" || HOOK_WORDS.test(s.text)) && !GEOMETRY.test(s.text) && !/please|:\)|could we say/i.test(s.text);
    const into = toneLine ? tone : hookLine ? hooks : null;
    if (into) into.set(s.line, [...(into.get(s.line) || []), s]);
  }
  const vocabLines = dedupeLines([...vocab.values()].flatMap((v) => lineTexts(v, false))).slice(0, 3);
  // Quoted words from vocabulary sentences that the lines above do not already show.
  const shown = vocabLines.join(" ");
  const seen = new Set(), phrases = [];
  for (const v of vocab.values()) for (const s of v) for (const m of s.text.matchAll(/“([^”]{2,60})”|"([^"]{2,60})"/g)) {
    const q = (m[1] || m[2]).trim().replace(/[.,;:]+$/, "");
    if (q.split(/\s+/).length > 10 || q.length < 3 || /^\d+$/.test(q) || REVIEWER.test(q) || seen.has(q.toLowerCase()) || shown.includes(q)) continue;
    seen.add(q.toLowerCase());
    phrases.push(q);
  }
  return {
    tone: capKeepingRules(dedupeLines([...tone.values()].flatMap((v) => lineTexts(v, false))), 6),
    words: [...(phrases.length ? [phrases.slice(0, 24).map((w) => `“${w}”`).join(", ")] : []), ...vocabLines],
    hooks: capKeepingRules(dedupeLines([...hooks.values()].flatMap((v) => lineTexts(v, true))), 5),
    avoid: dedupeLines(rules.avoid),
    boundary: dedupeLines(rules.boundary),
    dropped,
  };
}

// The style section: tone, words they use, how hooks are written, what to
// avoid, and every boundary. Tone, words and hooks are trimmed to the most
// useful lines; avoid and boundary lines are never trimmed.
export function styleSectionFor(facts) {
  const p = styleParts(facts);
  const parts = [];
  const block = (title, items) => { if (items.length) parts.push(`${title}\n${items.map((i) => `- ${i}`).join("\n")}`); };
  block("Tone:", p.tone);
  block("Words and phrases they use:", p.words);
  block("How hooks and titles are written:", p.hooks);
  block("Avoid:", p.avoid);
  block("Boundaries (never break these):", p.boundary);
  return parts.join("\n\n");
}

// The default prompt for one client: the n8n instruction word for word, then
// the client's short style section when the Brain has written facts. A bare
// string is read as one unlabelled fact. Staff edit the result.
export function defaultPromptFor(facts) {
  const list = typeof facts === "string" ? (facts.trim() ? [{ file: "voice", heading: "", body: facts }] : []) : facts;
  const style = styleSectionFor(list);
  return style ? `${N8N_TITLE_PROMPT}\n\n${STYLE_HEADER}\n\n${style}` : N8N_TITLE_PROMPT;
}

// The prompt actually used: what staff saved, else the seeded default, else
// the plain n8n instruction.
export function effectivePrompt(row) {
  const saved = String((row && row.prompt) || "").trim();
  if (saved) return saved;
  const seeded = String((row && row.default_prompt) || "").trim();
  return seeded || N8N_TITLE_PROMPT;
}

// Labelled exactly as the Submit tab's generated line is, so a designer can
// always tell a machine line from one a person wrote.
export const AI_LABEL = "Thumbnail title (generated by AI): ";
export const NEEDS_INFO = "Needs info: ";
export const MIN_PLAN_CHARS = 300;
export const MAX_TITLE_CHARS = 80;
export const MAX_TITLE_WORDS = 8;

export const NEEDS_INFO_TEXT = Object.freeze({
  no_plan: "no filming plan is linked to this client in SyncView, so no thumbnail title was written. Add the title here by hand.",
  plan_unreadable: "the client's filming plan could not be opened (it may not be shared by link), so no thumbnail title was written. Add the title here by hand.",
  plan_empty: "the client's filming plan is empty, so no thumbnail title was written. Add the title here by hand.",
  no_month_tab: "the client's filming plan has no tab for {month}, so no thumbnail title was written. Add the title here by hand.",
  no_match: "this post could not be matched to a video in the filming plan{post}, so no thumbnail title was written. Add the title here by hand.",
  not_grounded: "the suggested title did not use the filming plan's own words, so it was not used. Add the title here by hand.",
  generation_failed: "a thumbnail title could not be generated after several tries. Add the title here by hand.",
});

export function needsInfoLine(code, vars = {}) {
  let text = NEEDS_INFO_TEXT[code] || NEEDS_INFO_TEXT.generation_failed;
  text = text.replace("{month}", String(vars.month || "this month"));
  const post = String(vars.post || "").replace(/[\r\n]+/g, " ").trim().slice(0, 80);
  text = text.replace("{post}", post ? ` (post "${post}")` : "");
  return NEEDS_INFO + text;
}

export function titleLine(title) {
  return AI_LABEL + String(title || "").trim();
}

// "Video 4", "Video 4 — Launch", "Reel #4", "VIDEO4- ADS" -> 4.
export function numberFromCardName(name) {
  const m = /^\s*(?:video|vid|reel|short)\s*#?\s*(\d{1,3})(?!\d)/i.exec(String(name || ""));
  return m ? Number(m[1]) : null;
}

// A bare "Thumbnail 4" (or "Sample Thumbnail 4") inside a batch of several
// posts is the Submit tab's video number. A single-post batch numbers its
// one item 1 whatever the post is, so that 1 says nothing about the plan.
export function numberFromItemTitle(title, thumbnailsInBatch) {
  if (!(Number(thumbnailsInBatch) > 1)) return null;
  const m = /^\s*(?:sample\s+)?thumbnail\s+(\d{1,3})\s*$/i.exec(String(title || ""));
  return m ? Number(m[1]) : null;
}

// The name part of "Thumbnail 4 — Launch hook" or of the card name, for the
// model to match by topic when there is no number.
export function postNameFor(cardName, itemTitle) {
  const card = String(cardName || "").trim();
  if (card) return card.slice(0, 200);
  const m = /^\s*(?:sample\s+)?thumbnail\s+\d+\s*[—–-]\s*(.+)$/i.exec(String(itemTitle || ""));
  return m ? m[1].trim().slice(0, 200) : "";
}

export const MONTHS = ["january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december"];

export function monthLabel(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const m = MONTHS[d.getUTCMonth()];
  return m[0].toUpperCase() + m.slice(1) + " " + d.getUTCFullYear();
}

// Week tabs. Some plans keep one Docs tab per WEEK instead of per month:
// "Week of Sept 28", "Week of July 20th", "Wk of 9/28", sometimes with a year.
// Returns the week's start date (UTC midnight) or null. A name with no year
// takes the year that puts the start on or before the post, so a December
// week still fits a post made in early January.
const MONTH_ABBR = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
export const WEEK_WINDOW_DAYS = 35;

export function weekStart(name, createdAt) {
  const text = String(name || "").toLowerCase();
  if (!/\b(week|wk)\b/.test(text)) return null;
  let month = -1, day = 0, year = 0;
  const named = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s*(20\d\d))?/.exec(text);
  const numeric = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(text);
  if (named) {
    month = MONTH_ABBR[named[1]];
    day = Number(named[2]);
    year = named[3] ? Number(named[3]) : 0;
  } else if (numeric) {
    month = Number(numeric[1]) - 1;
    day = Number(numeric[2]);
    year = numeric[3] ? Number(numeric[3].length === 2 ? "20" + numeric[3] : numeric[3]) : 0;
  } else {
    return null;
  }
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return null;
  const build = (y) => {
    const d = new Date(Date.UTC(y, month, day));
    return d.getUTCMonth() === month ? d : null; // "Feb 30" is not a date
  };
  if (year) return build(year);
  const y = created.getUTCFullYear();
  const same = build(y);
  return same && same.getTime() <= created.getTime() ? same : build(y - 1);
}

// The week tab whose start is the latest one on or before the post, and no
// more than WEEK_WINDOW_DAYS before it. Two tabs with the same start date are
// ambiguous and pick nothing.
export function pickWeekTab(list, createdAt) {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return null;
  const windowMs = WEEK_WINDOW_DAYS * 24 * 3600 * 1000;
  const fits = list
    .map((t) => ({ t, start: weekStart(t.name, createdAt) }))
    .filter((x) => x.start && x.start.getTime() <= created.getTime() && created.getTime() - x.start.getTime() <= windowMs)
    .sort((a, b) => b.start.getTime() - a.start.getTime());
  if (!fits.length) return null;
  if (fits.length > 1 && fits[0].start.getTime() === fits[1].start.getTime()) return null;
  return fits[0].t;
}

// Pick the filming-plan tab for the month the post was created in. The house
// format keeps one Docs tab per month. A tab whose NAME carries the month (and
// the year, when the name has one) wins; then the month the tab's text talks
// about most; then, for plans kept one tab per week, the latest week starting
// on or before the post (within WEEK_WINDOW_DAYS); then, when the Doc has a
// single tab, that tab. Nothing that fits is reported, never guessed: a wrong
// tab means a wrong video.
export function pickTab(tabs, createdAt, tabMonthOf) {
  const list = (tabs || []).filter((t) => String(t.text || "").trim());
  if (!list.length) return { tab: null, reason: "plan_empty" };
  const d = new Date(createdAt);
  const month = MONTHS[Number.isNaN(d.getTime()) ? new Date().getUTCMonth() : d.getUTCMonth()];
  const year = String(Number.isNaN(d.getTime()) ? new Date().getUTCFullYear() : d.getUTCFullYear());
  const yearOk = (label) => {
    const years = String(label || "").match(/\b20\d\d\b/g);
    return !years || years.includes(year);
  };
  // Week tabs are matched by their start date below, never by the month word in their name.
  const monthTabs = list.filter((t) => !weekStart(t.name, createdAt));
  const byName = monthTabs.filter((t) => String(t.name || "").toLowerCase().includes(month) && yearOk(t.name));
  if (byName.length === 1) return { tab: byName[0], reason: "" };
  if (byName.length > 1) {
    const exactYear = byName.filter((t) => String(t.name).includes(year));
    if (exactYear.length === 1) return { tab: exactYear[0], reason: "" };
  }
  const byText = monthTabs.filter((t) => {
    const label = String((tabMonthOf ? tabMonthOf(t.text) : "") || "").toLowerCase();
    return label.startsWith(month) && yearOk(label);
  });
  if (byText.length === 1) return { tab: byText[0], reason: "" };
  const week = pickWeekTab(list, createdAt);
  if (week) return { tab: week, reason: "" };
  if (list.length === 1) return { tab: list[0], reason: "" };
  return { tab: null, reason: "no_month_tab" };
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "for", "from",
  "has", "have", "how", "in", "into", "is", "it", "its", "of", "on", "or", "that",
  "the", "their", "them", "then", "they", "this", "to", "was", "were", "what",
  "when", "which", "why", "will", "with", "you", "your", "not", "dont", "just",
  "more", "most", "than", "about", "every", "never", "always",
]);

export function normalizedText(value) {
  return String(value || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ");
}

// Grounding, loosened from the Submit tab's all-words rule because the n8n
// instruction asks the model to DISTILL a phrase, not only quote it: at least
// half of the title's significant words, and at least one, must already appear
// in the filming plan. An invented line (the 2026-08-17 incident: colours,
// wardrobe, camera direction) shares almost no words with a plan and fails.
export function grounded(title, planNormalized) {
  const significant = normalizedText(title).split(" ")
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  if (!significant.length) return false;
  const hits = significant.filter((w) => planNormalized.includes(w.replace(/s$/, ""))).length;
  return hits >= 1 && hits * 2 >= significant.length;
}

export function titleShapeOk(title) {
  const t = String(title || "").trim();
  if (!t || t.length > MAX_TITLE_CHARS || /[\r\n]/.test(t)) return false;
  return t.split(/\s+/).length <= MAX_TITLE_WORDS;
}

export const SYSTEM_PROMPT = [
  "You title thumbnails for a social media agency from a client's filming plan.",
  "The user message gives the client's title instructions, a list of posts and the filming plan.",
  "",
  "Matching each post to a video in the plan:",
  "- When a post has a videoNumber, it is that video counted sequentially from the top of the plan. The plan's own numbering may restart or be inconsistent; ignore it.",
  "- When a post has no videoNumber, match it by its postName to the one video whose topic it clearly names.",
  "- If a post cannot be matched with confidence, leave it out. Leaving it out is always better than guessing.",
  "",
  "Write only from what the plan says about that video. Never invent facts, names, places, colours, wardrobe or any art direction.",
  "",
  'Respond ONLY with valid JSON, an array like [{"key": "p1", "title": "Your Title Here"}]. Use the keys you were given.',
].join("\n");

export function userMessage(prompt, posts, planText) {
  const list = posts.map((p) => JSON.stringify({
    key: p.key,
    ...(p.videoNumber ? { videoNumber: p.videoNumber } : {}),
    ...(p.postName ? { postName: p.postName } : {}),
  })).join("\n");
  return `${prompt}\n\nPosts to title:\n${list}\n\nFilming plan:\n${String(planText || "").slice(0, 20000)}`;
}

// Pull the JSON array of answers out of the model's text. The answer may be
// bare JSON, fenced JSON anywhere in the text, or JSON after a sentence of
// prose, and that prose (or the plan it quotes) can itself hold brackets such
// as a "[11]" footnote. So every "[" is tried as a start, with every "]" after
// it as an end, longest first, and the first slice that parses to an array of
// objects wins. Returns null when there is none.
export function extractJsonArray(text) {
  const raw = String(text || "");
  const candidates = [];
  for (const m of raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.push(m[1].trim());
  candidates.push(raw.trim());
  for (const c of candidates) {
    try { const v = JSON.parse(c); if (Array.isArray(v)) return v; } catch (_e) { /* try slices */ }
  }
  const ends = [];
  for (let i = raw.length - 1; i >= 0; i--) if (raw[i] === "]") ends.push(i);
  let tries = 0;
  for (let i = 0; i < raw.length && tries < 400; i++) {
    if (raw[i] !== "[") continue;
    for (const j of ends) {
      if (j <= i) break;
      if (++tries > 400) break;
      try {
        const v = JSON.parse(raw.slice(i, j + 1));
        if (Array.isArray(v) && (v.length === 0 || v.some((x) => x && typeof x === "object"))) return v;
      } catch (_e) { /* next */ }
    }
  }
  return null;
}

// Read the model's answer into key -> title. Anything malformed is ignored.
// error is a short code when no answer list could be read at all.
export function parseTitles(content, keys) {
  const text = (Array.isArray(content) ? content : [])
    .filter((part) => part && part.type === "text")
    .map((part) => String(part.text || ""))
    .join("\n");
  const parsed = extractJsonArray(text);
  const wanted = new Set(keys);
  const out = new Map();
  if (!Array.isArray(parsed)) return { ok: false, titles: out, error: text.trim() ? "answer_not_json" : "answer_empty" };
  for (const row of parsed) {
    const key = row && typeof row.key === "string" ? row.key : "";
    const title = row && typeof row.title === "string" ? row.title.trim().replace(/^["“]|["”]$/g, "").trim() : "";
    if (!wanted.has(key) || !title || out.has(key)) continue;
    out.set(key, title);
  }
  return { ok: true, titles: out, error: "" };
}

// The short reason stored in thumbnail_title_queue.last_error. Never a title,
// a plan line or a client name: a code, an HTTP status and the provider's own
// error type at most, cut to 200 characters.
export function shortError(code, detail) {
  const d = String(detail || "").replace(/[\r\n]+/g, " ").replace(/[^\w .:/-]/g, "").trim();
  return (String(code || "error") + (d ? ": " + d : "")).slice(0, 200);
}

// Asked once more, in the same request thread, when an answer came back with
// no readable list.
export const JSON_ONLY_FOLLOWUP = 'Reply again with ONLY the JSON array, like [{"key": "p1", "title": "Your Title Here"}], and nothing else. Leave out any post you cannot match.';

// The line written for one post, given the model's title (or none).
export function resolveLine(post, title, planNormalized) {
  if (!title) return { state: "needs_info", outcome: "no_match", text: needsInfoLine("no_match", { post: post.postName }) };
  if (!titleShapeOk(title) || !grounded(title, planNormalized)) {
    return { state: "needs_info", outcome: "not_grounded", text: needsInfoLine("not_grounded") };
  }
  return { state: "written", outcome: "title", text: titleLine(title) };
}

// A flag value is {"clients": [...]} where "*" means every client.
export function clientOn(flagValue, slug) {
  const clients = flagValue && Array.isArray(flagValue.clients) ? flagValue.clients : [];
  return clients.includes("*") || clients.includes(String(slug || ""));
}
