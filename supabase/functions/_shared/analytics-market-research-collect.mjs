// Pure logic of the Market Research brief job, ported node by node from the n8n workflow
// "MARKET RESEARCH", branch generate-market-brief (docs/plans/2026-10-01-n8n-off-analytics.md,
// section 7 maps each function here to its n8n node). No network and no clock of its own: the
// caller passes `now` (a Date) or `nowMs`, so the same code runs in the Edge Function and in
// test/analytics-market-research-collect.js.
//
// Rules kept exactly as n8n has them, including the odd ones:
//   - a keyword whose scrape failed is skipped, the others go on; nothing from either platform
//     at all is an error (no brief);
//   - a reel is a candidate when it has views, is not older than 30 days (when it has a date),
//     and a platform's reels are scored 0.6 x views + 0.4 x shares, then ranked by percentile so
//     both platforms compete; the best 300 are kept;
//   - only reels with a video link are transcribed, in batches of 10 (the n8n merge puts a batch's
//     transcribed items before its untranscribed ones); a video under 500 KB or 25 MB and over, a
//     language other than English, fewer than 15 words, music, low confidence or repeated lyrics is
//     skipped; the hook is the first three sentences;
//   - only reels with 100,000 views or more reach the brief;
//   - the brief is one JSON text; its keywords are overwritten with the ones that were asked for; it is
//     stored cut into pieces of 45,000 characters (raw_json, raw_json_2, raw_json_3).
// One deliberate difference, with the same output: n8n transcribes all 300 ranked reels and drops those
// under 100,000 views afterwards; the port only transcribes the ones that can stay (TRANSCRIBE_MIN_VIEWS).

export const MODEL_DEFAULT = 'claude-opus-4-6';
export const MAX_TOKENS = 32000;
export const BATCH_SIZE = 10;
export const KEEP_TOP = 300;
export const BRIEF_MIN_VIEWS = 100000;
export const TRANSCRIBE_MIN_VIEWS = BRIEF_MIN_VIEWS;
export const MIN_VIDEO_BYTES = 512000;
export const MAX_VIDEO_BYTES = 26214400;
export const CHUNK = 45000;
const DAY_MS = 86400 * 1000;

// ---- keep only the fields the rules read (a search result carries megabytes of text) ----
// "Normalize Instagram Results2": one scraper answer for one keyword.
export function normalizeInstagram(items, keyword) {
  return items
    .filter(r => {
      const views = r.ig_play_count || r.play_count || r.video_play_count || 0;
      return views > 0;
    })
    .map(r => ({
      platform: 'instagram',
      code: r.code,
      keyword,
      username: r.user?.username || '',
      views: r.ig_play_count || r.play_count || r.video_play_count || 0,
      likes: r.like_count ?? 0,
      comments: r.comment_count || 0,
      shares: r.share_count || 0,
      caption: (r.caption?.text || '').substring(0, 150),
      url: `https://www.instagram.com/reel/${r.code}/`,
      videoUrl: r.video_url || '',
      date: r.taken_at_date || '',
    }));
}

// "Normalize TikTok2".
export function normalizeTikTok(items, keyword) {
  return items
    .filter(v => v.playCount > 0)
    .map(v => ({
      platform: 'tiktok',
      videoUrl: v.videoMeta?.subtitleLinks?.[0]?.downloadLink || '',
      code: v.id || v.webVideoUrl,
      keyword,
      username: v.authorMeta?.name || v.author?.uniqueId || '',
      views: v.playCount || 0,
      likes: v.diggCount || 0,
      comments: v.commentCount || 0,
      shares: v.shareCount || 0,
      caption: (v.text || '').substring(0, 150),
      url: v.webVideoUrl || `https://www.tiktok.com/@${v.authorMeta?.name}/video/${v.id}`,
      date: v.createTimeISO || '',
    }));
}

// "Code in JavaScript6": Instagram first, then TikTok; none at all is an error.
export function mergeScrapes(igReels, tkReels) {
  const allReels = [...igReels, ...tkReels];
  if (allReels.length === 0) throw new Error('No reels from either platform. Both scraping loops may have failed.');
  return allReels;
}

// "Sort and Filter2".
export function sortAndFilter(flat, now) {
  const thirtyDaysAgo = new Date(now.getTime());
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const unique = Array.from(new Map(flat.map(r => [r.platform + '_' + r.code, r])).values());
  const valid = unique.filter(r => {
    if (!r.views || r.views <= 0) return false;
    if (r.date) return new Date(r.date) >= thirtyDaysAgo;
    return true;
  });
  const igVideos = valid.filter(r => r.platform === 'instagram');
  const tkVideos = valid.filter(r => r.platform === 'tiktok');
  function rankByScore(arr) {
    return arr
      .map(r => ({ ...r, rawScore: (r.views * 0.6) + ((r.shares || 0) * 0.4) }))
      .sort((a, b) => b.rawScore - a.rawScore)
      .map((r, i, all) => ({ ...r, score: 100 - (i / all.length * 100) }));
  }
  const combined = [...rankByScore(igVideos), ...rankByScore(tkVideos)]
    .sort((a, b) => b.score - a.score)
    .slice(0, KEEP_TOP);
  return combined.map((r, i) => ({ rank: i + 1, ...r }));
}

// Does this ranked reel need a download and a transcription at all? n8n tries every reel with a video link
// and then drops the ones under 100,000 views; those can never reach the brief.
export function needsTranscript(reel) {
  return Boolean(reel.videoUrl) && (reel.views || 0) >= TRANSCRIBE_MIN_VIEWS;
}

// "Check File Size", on the downloaded size in bytes (null: nothing was downloaded).
export function checkFileSize(bytes) {
  if (bytes == null) return 'no_binary';
  if (bytes < MIN_VIDEO_BYTES) return 'file_too_small';
  if (bytes >= MAX_VIDEO_BYTES) return 'file_too_large';
  return null;
}

// "Extract Hook1", on the Whisper answer of a video that passed the size check.
export function extractHook(whisperResult) {
  const skip = skipReason => ({ transcript: '', hook: null, hookSkipped: true, skipReason });
  if (!whisperResult || !whisperResult.language || whisperResult.error) return skip('transcribe_failed');
  const detectedLang = whisperResult.language || '';
  if (detectedLang !== 'en' && detectedLang !== 'english') return skip('not_english');
  const transcript = whisperResult.text || '';
  const words = transcript.trim().split(/\s+/);
  if (words.length < 15) return skip('too_short');
  const segments = whisperResult.segments || [];
  if (segments.length > 0) {
    const avgNoSpeech = segments.reduce((sum, s) => sum + (s.no_speech_prob || 0), 0) / segments.length;
    const avgLogprob = segments.reduce((sum, s) => sum + (s.avg_logprob || 0), 0) / segments.length;
    if (avgNoSpeech > 0.4) return skip('music_detected');
    if (avgLogprob < -1.2) return skip('low_confidence');
  }
  const wordFreq = {};
  words.forEach(w => {
    const clean = w.toLowerCase().replace(/[^a-z]/g, '');
    if (clean.length > 3) wordFreq[clean] = (wordFreq[clean] || 0) + 1;
  });
  const maxFreq = Math.max(...Object.values(wordFreq), 0);
  if (maxFreq / words.length > 0.15) return skip('repetitive_lyrics');
  const sentences = transcript.match(/[^.!?]+[.!?]+/g) || [transcript];
  const hook = sentences.slice(0, 3).join(' ').trim() || null;
  return { transcript, hook, hookSkipped: false };
}

// The reels in the order n8n hands them on: ranked order, ten at a time; inside a batch the ones that went
// through the transcription path (they have a video link) come first, then the ones without a link
// ("Code in JavaScript11"). `outcomes`: rank -> { transcript, hook, hookSkipped, skipReason? } for the
// reels that have a link; a link-less reel gets hook '' and transcript ''.
export function assembleReels(ranked, outcomes) {
  const out = [];
  for (let i = 0; i < ranked.length; i += BATCH_SIZE) {
    const batch = ranked.slice(i, i + BATCH_SIZE);
    const withLink = batch.filter(r => r.videoUrl);
    const without = batch.filter(r => !r.videoUrl);
    for (const r of withLink) {
      const o = outcomes[r.rank] ?? { transcript: '', hook: null, hookSkipped: true, skipReason: 'not_needed' };
      out.push({ ...r, ...o });
    }
    for (const r of without) out.push({ ...r, hook: r.hook || '', transcript: '' });
  }
  return out;
}

// "Deduplicate Final Results": first of each platform and code, 100,000 views or more.
export function dedupeFilter(reels) {
  const allReels = [];
  const seen = new Set();
  for (const reel of reels) {
    const key = (reel.platform || '') + '_' + (reel.code || reel.url || '');
    if (!seen.has(key)) { seen.add(key); allReels.push(reel); }
  }
  return allReels.filter(r => (r.views || 0) >= BRIEF_MIN_VIEWS);
}

// "Build Claude Input1".
export function buildClaudeInput(reels, { clientName, clientNiche, contentDescription, keywords }) {
  const allReels = reels || [];
  const usableReels = allReels.filter(r => r.transcript && r.hook && !r.hookSkipped);
  function sanitize(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '').replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
  }
  const instagramInTop = allReels.filter(r => r.platform === 'instagram').length;
  const tiktokInTop = allReels.filter(r => r.platform === 'tiktok').length;
  const transcriptBlock = usableReels.map((r) => [
    `REEL ${r.rank} | @${r.username || '?'} | ${(r.platform || '').toUpperCase()}`,
    `URL: ${r.url || ''}`,
    `Views: ${(r.views || 0).toLocaleString()} | Likes: ${r.likes || 0} | Shares: ${r.shares || 0}`,
    `Hook: ${sanitize(r.hook)}`,
    `Full Transcript: ${sanitize(r.transcript)}`,
    '---',
  ].join('\n')).join('\n\n');
  const landscapeBlock = allReels.map(r => [
    `Rank ${r.rank} | @${r.username || '?'} | ${(r.platform || '').toUpperCase()} | ${(r.views || 0).toLocaleString()} views | ${r.shares || 0} shares`,
    `Caption: ${sanitize(r.caption || '')}`,
    `URL: ${r.url || ''}`,
  ].join('\n')).join('\n\n');
  return {
    clientName: sanitize(clientName),
    clientNiche: sanitize(clientNiche),
    contentDescription: sanitize(contentDescription),
    keywords,
    transcriptBlock,
    landscapeBlock,
    totalReels: allReels.length,
    transcribedCount: usableReels.length,
    instagramInTop100: instagramInTop,
    tiktokInTop100: tiktokInTop,
    instagramScraped: instagramInTop,
    tiktokScraped: tiktokInTop,
  };
}

// The user message of "Claude API1", character for character (only the clock is a parameter).
export function buildPrompt($json, nowMs) {
  return `You are a senior content strategist for a social media agency. Your job is to analyze viral content data and produce a research brief that a script writer can immediately use to create content for ${$json.clientName}.
CLIENT NICHE: ${$json.clientNiche}
CONTENT DESCRIPTION: ${$json.contentDescription || 'Not provided'}
HOW THIS BRIEF WAS BUILT:
- ${$json.instagramScraped} Instagram videos scraped across all keywords
- ${$json.tiktokScraped} TikTok videos scraped across all keywords
- Top ${$json.totalReels} selected by blended score of views and shares (${$json.instagramInTop100} Instagram, ${$json.tiktokInTop100} TikTok)
- All ${$json.transcribedCount} Instagram videos in the top ${$json.totalReels} were fully transcribed via Whisper AI
- TikTok videos included in landscape analysis only
- Target date range: last 30 days (applied at source for Instagram, filtered post-scrape for TikTok)
- Keywords used: ${$json.keywords ? $json.keywords.join(', ') : 'not specified'}
---
FULL MARKET LANDSCAPE (${$json.totalReels} videos):
${$json.landscapeBlock}
---
TRANSCRIBED VIDEOS (${$json.transcribedCount} Instagram videos):
${$json.transcriptBlock}
---
Write a research brief using EXACTLY this structure. The core framework for every insight is: WHAT IS WORKING → WHY IT WORKS → WHAT THIS MEANS FOR ${$json.clientName.toUpperCase()}.

CRITICAL ANALYTICAL FRAMEWORK:
When analyzing WHY content works, never stop at surface-level observations like "this topic resonates" or "this gets high shares." Go one layer deeper into the PSYCHOLOGICAL SHARING MECHANISM. Ask: what emotion does the viewer feel that makes them need to share this? Content goes viral not because of the topic itself but because it triggers an emotional impulse that can only be discharged through sharing. Examples of sharing mechanisms:
- Viewer feels injustice/imbalance → shares to a partner as a passive-aggressive signal ("see? this is what you do")
- Viewer feels validated in secret pain → shares to feel less alone or to say what they can't say themselves
- Viewer feels moral superiority → shares to publicly align with "the right side"
- Viewer feels shock/disbelief → shares because the emotional charge is too much to hold alone
- Viewer feels seen in something they've never named → saves/shares as proof they're not crazy
- Viewer feels desire or longing → shares to manifest or signal what they want from a partner
Every "WHY IT WORKS" or "WHY" line in every section must name the specific emotional trigger AND the sharing behavior it activates. Every "FOR ${$json.clientName.toUpperCase()}" recommendation must explain how to intentionally engineer that same emotional-to-action pipeline in their content. This framework applies to ALL sections — landscape, topic clusters, content angles, hooks, and gaps.
When writing any summary, synthesis, or conclusion — always briefly reference WHERE the insight comes from. Don't just state a conclusion; name the pattern or videos that led to it. Example: instead of "Effort imbalance content drives shares" say "Effort imbalance content (seen in 12 of the top 50 videos, including @handle's 500K-view reel) drives shares because..."

Use the CONTENT DESCRIPTION to understand what kind of content ${$json.clientName} creates so your recommendations are specific to their style, audience, and topics. Every "FOR ${$json.clientName.toUpperCase()}" line should reflect this.
RESEARCH BRIEF FOR ${$json.clientName.toUpperCase()}
Date: ${new Date(nowMs).toISOString().split('T')[0]}
Total videos: ${$json.totalReels} (${$json.instagramInTop100} Instagram, ${$json.tiktokInTop100} TikTok) | Transcripts: ${$json.transcribedCount}
---
SOURCES
List all ${$json.transcribedCount} transcribed videos. Format:
[rank]. [TITLE YOU CREATE BASED ON TRANSCRIPT] | @[username] | [views] views | [URL]
---
EXECUTIVE SUMMARY
2 sentences max. What is dominating this niche right now and the single biggest opportunity for ${$json.clientName}.
Then add one-line highlights for each section below. Each highlight must SUMMARIZE the entire section — blend all the insights into one cohesive takeaway, not just pick the single most important one:
LANDSCAPE: [one sentence synthesizing ALL landscape patterns into a unified direction]
TOPIC CLUSTERS: [one sentence blending all clusters into what topics dominate and why]
HOOKS: [one sentence summarizing the overall hook patterns across all analyzed hooks]
FILMING ANGLES: [one sentence condensing the overall angle strategy derived from the data]
GAP: [one sentence unifying all gaps into one strategic opportunity]
---
LANDSCAPE ANALYSIS
Based on ALL ${$json.totalReels} videos. Exactly 8 bullets. Each bullet:
**[LABEL IN CAPS]**
WHAT: [one line describing the content pattern]
EMOTIONAL TRIGGER: [what specific emotion does the viewer feel — injustice, validation, shame, recognition, moral outrage, etc.]
SHARING MECHANISM: [what does the viewer DO with that emotion — send it to someone as a message, post it to signal identity, save it as emotional armor, etc. Be specific about the social action.]
FOR ${$json.clientName.toUpperCase()}: [how to intentionally engineer this emotional trigger → sharing action pipeline in their content. Be specific.]
EXAMPLE: [URL]
SUPPORTING REELS: [list 3-5 URLs with @handle and view count that support this insight, format: @handle (views) URL — one per line]
---
TOPIC CLUSTERS
Exactly 5 clusters from ALL ${$json.totalReels} videos. Each cluster:
**[CLUSTER NAME]**
VIDEOS: [count] | TOP: [URL]
WHAT WORKS: [one line]
WHY: [one line — name the emotional trigger and the sharing behavior it activates]
FOR ${$json.clientName.toUpperCase()}: [one line]
SUPPORTING REELS: [list 3-5 URLs with @handle and view count from this cluster, format: @handle (views) URL — one per line]
---
DEEP HOOK ANALYSIS
IMPORTANT: Only include hooks from reels whose transcript is RELEVANT to ${$json.clientName}'s niche. Before including a reel, check its transcript against the CONTENT DESCRIPTION above. If the transcript is about a completely different topic (e.g. politics, news events, unrelated industries) that has no connection to ${$json.clientName}'s niche, SKIP IT entirely. Do not include it just because it has high views. A hook is only useful if the topic and messaging pattern can be adapted to ${$json.clientName}'s content.
For each RELEVANT transcribed video:
**REEL [rank] — @[username]** | [views] views | [URL]
HOOK TYPE: [Identity Disruption / Blunt Truth / Pattern Recognition / Question / Confession / Sensory / Credibility / other]
OPENING LINE: [exact first sentence from transcript]
TRANSCRIPT: [full transcript text, verbatim]
RELEVANCE: [one line explaining why this hook/topic is applicable to ${$json.clientName}'s niche]
STEAL THIS: Take the opening line and turn it into a fill-in-the-blank template. Keep the exact sentence structure, rhythm, and all connecting words. Replace only the niche-specific nouns, verbs, and adjectives with [...]. The result must be a skeleton someone can plug any topic into. Example: "So she's not younger than me, she's not skinnier than me" → "So she's not [...] than me, she's not [...] than me". One line only.
---
CONTENT ANGLES FOR ${$json.clientName.toUpperCase()}
20 concrete content angles. Each angle must be DERIVED FROM the landscape analysis and topic clusters above — not invented from scratch. For each angle, explain which landscape insight or topic cluster it comes from and why it would work. Use the best-fitting hook template from the STEAL THIS templates above.
Format:
**[NUMBER]. [ANGLE TITLE]**
ANGLE: [describe the angle — what is the content about and what perspective should ${$json.clientName} take]
HOOK: [write a ready-to-use hook line in ${$json.clientName}'s voice, based on the best-fitting STEAL THIS template from the hook analysis above]
WHY THIS WORKS: [explain which specific landscape insight(s) or topic cluster(s) this angle is based on, and what emotional trigger → sharing mechanism it activates. Reference the data — e.g. "Based on the EFFORT IMBALANCE landscape pattern (seen in 12 videos) — viewers feel injustice and share as a passive-aggressive signal to their partner"]
IMPORTANT: You only have transcripts, not video footage. Do NOT make claims about visual format, camera angles, editing style, or b-roll. Focus only on topic, hook, and messaging.
---
THE GAP
5 bullets. What is NOT being covered that ${$json.clientName} could own.
**[LABEL]**
GAP: [one line]
OPPORTUNITY FOR ${$json.clientName.toUpperCase()}: [one line — explain what emotional trigger this gap could activate and why viewers would share it]
---
No fluff. No generic observations. Every line must be evidence-based from the data. Include URLs wherever you reference a video.

CRITICAL OUTPUT FORMAT REQUIREMENT:
Your ENTIRE response must be a single valid JSON object. Do NOT wrap it in markdown code fences. Do NOT include any text before or after the JSON object. Return compact minified JSON with no unnecessary whitespace.

Map your analysis to this exact JSON schema:
{"clientName":"string","date":"YYYY-MM-DD","totalReels":number,"instagramInTop":number,"tiktokInTop":number,"transcribedCount":number,"keywords":["string"],"sources":[{"rank":number,"title":"string","handle":"string","views":"string","url":"string"}],"executiveSummary":{"summary":"string (2 sentences max)","highlights":{"landscape":"string","topicClusters":"string","hooks":"string","filmingAngles":"string","gap":"string"} },"landscapeAnalysis":[{"label":"string","what":"string","emotionalTrigger":"string","sharingMechanism":"string","forClient":"string","example":"string","supportingReels":[{"handle":"string","views":"string","url":"string"}] }],"topicClusters":[{"name":"string","videoCount":number,"topPerformer":"string","whatWorks":"string","why":"string","forClient":"string","supportingReels":[{"handle":"string","views":"string","url":"string"}] }],"hookAnalysis":[{"rank":number,"handle":"string","views":"string","url":"string","hookType":"string","openingLine":"string","stealThis":"string","transcript":"string","relevance":"string"}],"filmingAngles":[{"number":number,"angle":"string","hook":"string","whyThisWorks":"string"}],"theGap":[{"label":"string","gap":"string","opportunity":"string"}]}`;
}

export function claudeRequest(prompt, model = MODEL_DEFAULT) {
  return { model, max_tokens: MAX_TOKENS, messages: [{ role: 'user', content: prompt }] };
}

// "Code in JavaScript1": the answer text to the stored row. keywords: the ones that were asked for.
export function parseBrief(raw, keywords, now) {
  const cleaned = String(raw)
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  let clientName = '';
  let date = new Date(now).toISOString().split('T')[0];
  const nameMatch = cleaned.match(/"clientName"\s*:\s*"([^"]+)"/);
  if (nameMatch) clientName = nameMatch[1];
  const dateMatch = cleaned.match(/"date"\s*:\s*"([^"]+)"/);
  if (dateMatch) date = dateMatch[1];
  const actualKeywords = keywords || [];
  let rawJson = cleaned;
  try {
    const parsed = JSON.parse(cleaned);
    if (actualKeywords.length > 0) parsed.keywords = actualKeywords;
    rawJson = JSON.stringify(parsed);
  } catch (_e) {
    rawJson = cleaned;
  }
  const part1 = rawJson.substring(0, CHUNK);
  const part2 = rawJson.length > CHUNK ? rawJson.substring(CHUNK, CHUNK * 2) : '';
  const part3 = rawJson.length > CHUNK * 2 ? rawJson.substring(CHUNK * 2) : '';
  return { clientName, date, rawJson: part1, rawJson2: part2, rawJson3: part3 };
}

export function configured(value) {
  const normalized = String(value ?? '').trim();
  return Boolean(normalized && normalized.toUpperCase() !== 'N/A');
}
