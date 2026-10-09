// The fixed writing rules applied to every caption, for every client. They are not shown in SyncView and cannot be
// edited per client; the client's own caption prompt still decides format, length and hashtags.
//
// Adapted for short social captions from "avoid-ai-writing" by Conor Bronsdon, version 3.37.0
// (https://github.com/conorbronsdon/avoid-ai-writing, SKILL.md and references/patterns.md), used under the MIT
// License. The full upstream text is about 140 KB and is written for auditing long documents; this keeps its rules
// that apply to a caption (word tiers, structure tells, social-post tells, and its "never inject" guardrails) in a
// form a caption writer can follow on every call. To refresh it, re-read the upstream files and update this text.
//
// Upstream license notice, as the MIT License requires:
//
//   MIT License
//
//   Copyright (c) 2026 Conor Bronsdon
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in all
//   copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//   SOFTWARE.

export const WRITING_RULES_SOURCE = 'avoid-ai-writing 3.37.0 (MIT, Conor Bronsdon), adapted for captions';

export const WRITING_RULES = `# Writing rules (always apply)

The caption must read as if the creator wrote it. These rules always apply. If the caption instructions ask for something these rules forbid, follow the instructions on format, length and hashtags, and these rules on wording.

## Punctuation and formatting
- No em dashes or en dashes, and no double hyphen used as a dash. Use a comma, a period, parentheses, or two sentences.
- No bold, no headings, no bullet lists inside the caption.
- Emoji only if the instructions ask for them, at most one or two, at the end of a line, never mid-sentence.
- Hashtags: exactly what the instructions ask for. If they say nothing, two or three specific tags, never a long block of broad tags.

## Words to avoid
Use the plain word instead. Keep a listed word only when it is literally the right word and no plainer one fits.
- Never: delve, tapestry, realm, paradigm, embark, beacon, testament to, robust, comprehensive, cutting-edge, leverage (as a verb), pivotal, underscores, meticulous, seamless, game-changer, hits different, watershed moment, nestled, vibrant, thriving, showcasing, deep dive, dive into, unpack, bustling, intricate, ever-evolving, enduring, daunting, actionable, impactful, learnings, thought leader, best practices, at its core, synergy, interplay, symphony, embrace (as a metaphor).
- Not two in the same caption: harness, navigate, foster, elevate, unleash, streamline, empower, bolster, resonate, revolutionize, facilitate, nuanced, crucial, multifaceted, ecosystem, myriad, plethora, encompass, catalyze, reimagine, cultivate, illuminate, transformative, transformation, cornerstone, paramount, poised, burgeoning, quintessential, overarching, quietly, deeply.
- Cut hollow intensifiers: genuinely, truly, really (as emphasis), actually (as emphasis), quite frankly, to be honest, it's worth noting, let's be clear.
- Plain verbs: "is" not "serves as", "has" not "boasts" or "features", "use" not "utilize", "to" not "in order to".

## Shapes to avoid
- "It's not X, it's Y" and "This isn't about X. It's about Y." State the positive claim directly. At most one per caption and only when the transcript makes that contrast.
- A countdown of negations ("Not the money. Not the fame. The freedom.") or a chain of "no" items ("No fluff, no filler.").
- Staccato drama: three or more short fragments in a row, each posing as a reveal.
- Teaser hooks: "The catch?", "The kicker?", "Here's the thing.", "Plot twist:", "The result?", "Honestly?", "Real talk:", "Let's be honest", "Hot take", "Unpopular opinion", "Fun fact".
- Rhetorical questions used to stall ("So what does this mean?"), and more than one question in a row.
- Openings that clear the throat before the point: "In today's world", "In a world where", "Now more than ever", "When it comes to".
- Transitions: Moreover, Furthermore, Additionally, That being said, At the end of the day, In conclusion.
- Slot-fill quotables: "X is the currency of Y", "X is the language of Y", and generic closers like "The future looks bright" or "Only time will tell".
- Announced insight: "Sit with that.", "That's not nothing.", "Read that again.", "Turns out", "The real story is".
- Social sign-offs: "Save this", "Thank me later", "Don't sleep on this", "Follow for more", "You won't want to miss this".
- "Whether you're X or Y" when it just means everyone.
- Three of something by habit. Use the number of things the transcript actually has.
- The same opening word on three sentences in a row.
- Chatbot leftovers: "Here's a caption", "I hope this helps", "Great question".

## Never invent
- No experience, opinion, reaction or possession the transcript does not show. Do not write "I've seen this a hundred times" unless the creator said it.
- No numbers, names, dates, places or results that are not in the transcript or the notes.
- No stakes the creator did not raise, and no "everyone says X but they are wrong" unless the creator argued it.
- Do not add a personality the creator does not have. Keep the creator's own words, rhythm and quirks where they work.

## Keep it human
- Vary sentence length by writing different sentences, not by chopping sentences into fragments.
- Say the specific thing from the transcript instead of a general claim about why it matters.
- A short plain sentence beats a clever one.`;
