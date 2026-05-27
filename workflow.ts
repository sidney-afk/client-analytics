import { workflow, node, trigger, sticky, placeholder, newCredential, expr } from '@n8n/workflow-sdk';

const TEST_CHANNEL_ID = 'C0B7D49KCD6';

const matchTopReelCode = `
const clients = $('Read Clients Info').all().map(i => i.json);
const videos  = $input.all().map(i => i.json);

const results = [];

for (const c of clients) {
  const name = c.client_name;
  const channelId = c.slack_channel_id;

  if (!name || !channelId) continue;

  const clientVids = videos.filter(v =>
    v.client_name === name &&
    (v.period || '').toLowerCase().includes('week')
  );

  if (clientVids.length === 0) continue;

  const latestDate = clientVids.reduce((max, v) => {
    const d = v.scraped_date || '';
    return d > max ? d : max;
  }, '');

  const fresh = latestDate
    ? clientVids.filter(v => (v.scraped_date || '') === latestDate)
    : clientVids;

  const parseNum = (val) => {
    if (!val) return 0;
    return parseInt(String(val).replace(/[^\\d]/g, ''), 10) || 0;
  };

  fresh.sort((a, b) => parseNum(b.views || b.view_count || b.play_count) - parseNum(a.views || a.view_count || a.play_count));
  const top = fresh[0];

  const views = parseNum(top.views || top.view_count || top.play_count);
  const caption = top.caption || top.title || top.description || top.post_caption || '';
  const videoUrl = top.video_url || top.url || top.link || top.post_url || '';
  const platform = (top.platform || 'instagram').toLowerCase();
  const likes = parseNum(top.likes || top.like_count);
  const comments = parseNum(top.comments || top.comment_count);
  const shares = parseNum(top.shares || top.share_count);

  results.push({
    json: {
      client_name: name,
      slack_channel_id: channelId,
      content_description: c.content_description || '',
      platform,
      video_url: videoUrl,
      caption: caption,
      views,
      likes,
      comments,
      shares,
      scraped_date: latestDate
    }
  });
}

return results.length > 0 ? results : [{ json: { _skip: true } }];
`;

const extractVideoUrlCode = `
const original = $('Match Top Reel Per Client').item.json;
const post = $input.item.json;

const videoUrl = post?.videoUrl
  || post?.video_url
  || post?.videoVersions?.[0]?.url
  || '';

return { json: { ...original, videoUrl } };
`;

const parseSandcastleCode = `
const matched = $('Match Top Reel Per Client').item.json;
const transcriptItem = $('Transcribe with Whisper').item.json;
const transcript = (transcriptItem?.text || '').trim();
const sandcastleResp = $json;

let competitors = [];

if (Array.isArray(sandcastleResp?.competitors)) {
  competitors = sandcastleResp.competitors;
} else if (Array.isArray(sandcastleResp?.data?.competitors)) {
  competitors = sandcastleResp.data.competitors;
} else if (Array.isArray(sandcastleResp?.results)) {
  competitors = sandcastleResp.results;
} else if (Array.isArray(sandcastleResp)) {
  competitors = sandcastleResp;
}

competitors = competitors.slice(0, 3).map((c) => ({
  name: c.name || c.handle || c.username || c.title || 'Unknown',
  handle: c.handle || c.username || '',
  url: c.url || c.link || c.profile_url || '',
  summary: c.summary || c.description || c.bio || c.latest_post || c.recent_activity || ''
}));

return { json: { ...matched, transcript, competitors } };
`;

const buildClaudePromptCode = `
const data = $input.item.json;

const competitorList = (data.competitors || [])
  .map((c, i) => \`\${i + 1}. \${c.name}\${c.handle ? ' (' + c.handle + ')' : ''}: \${c.summary || 'No recent activity summary.'}\`)
  .join('\\n');

const prompt = \`You are a social media strategist. A client named "\${data.client_name}" creates content about: \${data.content_description || ''}

Their top-performing reel this week got \${data.views} views.

Platform: \${data.platform}
Caption: "\${data.caption || ''}"
Likes: \${data.likes}
Comments: \${data.comments}

VIDEO TRANSCRIPT:
\${data.transcript || 'No transcript available.'}

TOP 3 COMPETITORS IN THIS NICHE (from Sandcastle):
\${competitorList || 'No competitor data available.'}

Write a response with TWO sections, separated by the exact line "---":

SECTION 1 (under 280 chars, plain text, no markdown): Explain in 2-3 sentences WHY this reel likely performed so well. Focus on hook, content angle, or trend.

SECTION 2 (under 600 chars, plain text, no markdown): Briefly describe what each of the top 3 competitors is doing right now and what the client could learn from them. One short sentence per competitor.\`;

const body = JSON.stringify({
  model: "claude-sonnet-4-20250514",
  max_tokens: 800,
  messages: [{ role: "user", content: prompt }]
});

return { json: { ...data, claude_request_body: body } };
`;

const formatSlackCode = `
const inputItems = $('Build Claude Prompt').all();
const itemIndex = $itemIndex;
const data = inputItems[itemIndex].json;

const claudeResp = $json;
const fullAnalysis = (claudeResp.content && claudeResp.content[0] && claudeResp.content[0].text)
  || 'Great engagement this week!';

const parts = fullAnalysis.split(/^---$/m);
const whyAnalysis = (parts[0] || '').trim() || 'Great engagement this week!';
const competitorAnalysis = (parts[1] || '').trim();

const fmtNum = (n) => Number(n || 0).toLocaleString('en-US');
const views = fmtNum(data.views);
const likes = fmtNum(data.likes);
const comments = fmtNum(data.comments);
const platform = (data.platform || 'instagram').charAt(0).toUpperCase() + (data.platform || 'instagram').slice(1);
const videoUrl = data.video_url || '';

const blocks = [
  { type: 'header', text: { type: 'plain_text', text: '\\ud83d\\udd25 Top Reel of the Week', emoji: true } },
  { type: 'section', text: { type: 'mrkdwn', text: \`Hey *\${data.client_name}* team! Here's your top-performing reel this week:\` } },
  {
    type: 'section',
    fields: [
      { type: 'mrkdwn', text: \`*Platform:*\\n\${platform}\` },
      { type: 'mrkdwn', text: \`*Views:*\\n\${views}\` },
      { type: 'mrkdwn', text: \`*Likes:*\\n\${likes}\` },
      { type: 'mrkdwn', text: \`*Comments:*\\n\${comments}\` }
    ]
  },
  { type: 'section', text: { type: 'mrkdwn', text: \`*Caption:*\\n>\${data.caption ? (data.caption.length >= 200 ? data.caption.slice(0, 200) + '...' : data.caption) : 'N/A'}\` } },
  { type: 'divider' },
  { type: 'section', text: { type: 'mrkdwn', text: \`*Why it performed well:*\\n\${whyAnalysis}\` } }
];

const competitors = data.competitors || [];
if (competitors.length > 0) {
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: '\\ud83d\\udd0d Top 3 Competitors This Week', emoji: true }
  });
  if (competitorAnalysis) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: competitorAnalysis } });
  }
  const compFields = competitors.map((c) => {
    const linkText = c.url ? \`<\${c.url}|\${c.name}>\` : c.name;
    return { type: 'mrkdwn', text: \`*\${linkText}*\${c.handle ? '\\n' + c.handle : ''}\` };
  });
  blocks.push({ type: 'section', fields: compFields });
}

if (videoUrl && videoUrl !== '#') {
  blocks.push({
    type: 'actions',
    elements: [{
      type: 'button',
      text: { type: 'plain_text', text: '\\u25b6\\ufe0f Watch Reel', emoji: true },
      url: videoUrl,
      action_id: 'watch_reel'
    }]
  });
}

return {
  json: {
    client_name: data.client_name,
    text: 'Top reel of the week for ' + data.client_name + ': ' + views + ' views',
    blocks: JSON.stringify({ blocks: blocks })
  }
};
`;

const manualWebhookTrigger = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Manual Trigger (Webhook)',
    parameters: {
      httpMethod: 'POST',
      path: 'weekly-slack-top-reel-test',
      responseMode: 'responseNode',
      options: {}
    },
    position: [0, 240]
  },
  output: [{ body: {} }]
});

const readClientsInfo = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Read Clients Info',
    parameters: {
      resource: 'sheet',
      operation: 'read',
      documentId: { __rl: true, mode: 'list', value: '10QQnWOQY73Aj44R8AumYJzFpxMd_bZZiCMXkZ6QqAU8', cachedResultName: 'SYNCVIEW' },
      sheetName: { __rl: true, mode: 'name', value: 'Clients Info' },
      options: {}
    },
    credentials: { googleSheetsOAuth2Api: newCredential('Google Sheets') },
    position: [304, 112]
  },
  output: [{ client_name: 'Acme Coaching', slack_channel_id: 'C012345', content_description: 'fitness coaching reels for busy moms' }]
});

const readTopVideos = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Read TopVideos',
    parameters: {
      resource: 'sheet',
      operation: 'read',
      documentId: { __rl: true, mode: 'list', value: '10QQnWOQY73Aj44R8AumYJzFpxMd_bZZiCMXkZ6QqAU8', cachedResultName: 'SYNCVIEW' },
      sheetName: { __rl: true, mode: 'name', value: 'TopVideos' },
      filtersUI: { values: [{ lookupColumn: 'period', lookupValue: 'week' }] },
      options: { outputFormatting: { values: { general: 'FORMATTED_VALUE', date: 'FORMATTED_STRING' } } }
    },
    credentials: { googleSheetsOAuth2Api: newCredential('Google Sheets') },
    executeOnce: true,
    position: [560, 112]
  },
  output: [{ client_name: 'Acme Coaching', period: 'week', views: '50000', video_url: 'https://www.instagram.com/reel/abc123', scraped_date: '2026-05-27' }]
});

const matchTopReelPerClient = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Match Top Reel Per Client',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: matchTopReelCode
    },
    position: [832, 112]
  },
  output: [{
    client_name: 'Acme Coaching',
    slack_channel_id: 'C012345',
    content_description: 'fitness coaching reels for busy moms',
    platform: 'instagram',
    video_url: 'https://www.instagram.com/reel/abc123',
    caption: 'workout tips',
    views: 50000,
    likes: 1200,
    comments: 80,
    shares: 30,
    scraped_date: '2026-05-27'
  }]
});

const getVideoUrlViaApify = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Get Video URL via Apify',
    parameters: {
      method: 'POST',
      url: 'https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpQueryAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ directUrls: [$json.video_url], resultsLimit: 1, resultsType: "posts" }) }}'),
      options: { timeout: 120000 }
    },
    credentials: { httpQueryAuth: newCredential('Apify API') },
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 5000,
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
    position: [1056, 112]
  },
  output: [{ videoUrl: 'https://cdn.example.com/video.mp4' }]
});

const extractVideoUrl = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Extract Video URL',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode: extractVideoUrlCode
    },
    position: [1264, 112]
  },
  output: [{
    client_name: 'Acme Coaching',
    slack_channel_id: 'C012345',
    content_description: 'fitness coaching reels for busy moms',
    platform: 'instagram',
    video_url: 'https://www.instagram.com/reel/abc123',
    videoUrl: 'https://cdn.example.com/video.mp4',
    caption: 'workout tips',
    views: 50000,
    likes: 1200,
    comments: 80,
    shares: 30
  }]
});

const downloadVideo = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Download Video1',
    parameters: {
      url: expr('{{ $json.videoUrl }}'),
      options: {
        response: { response: { responseFormat: 'file' } },
        timeout: 30000
      }
    },
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 5000,
    onError: 'continueRegularOutput',
    position: [1488, 112]
  },
  output: [{}]
});

const transcribeWithWhisper = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Transcribe with Whisper',
    parameters: {
      method: 'POST',
      url: 'https://api.openai.com/v1/audio/transcriptions',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'multipart-form-data',
      bodyParameters: {
        parameters: [
          { name: 'file', value: '' },
          { name: 'model', value: 'whisper-1' },
          { name: 'response_format', value: 'verbose_json' }
        ]
      },
      options: {}
    },
    credentials: { httpHeaderAuth: newCredential('OpenAI Whisper') },
    onError: 'continueRegularOutput',
    position: [1696, 112]
  },
  output: [{ text: 'Sample transcribed text from the video.' }]
});

const sandcastleCompetitors = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Sandcastle - Find Top Competitors',
    parameters: {
      method: 'POST',
      url: placeholder('Sandcastle competitor search endpoint, e.g. https://api.sandcastle.io/v1/competitors/search'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ niche: $(\"Match Top Reel Per Client\").item.json.content_description, platform: $(\"Match Top Reel Per Client\").item.json.platform, limit: 3 }) }}'),
      options: { timeout: 60000 }
    },
    credentials: { httpHeaderAuth: newCredential('Sandcastle API') },
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 5000,
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
    position: [1904, 112]
  },
  output: [{
    competitors: [
      { name: 'Competitor One', handle: '@comp1', url: 'https://instagram.com/comp1', summary: 'Posting daily morning workout reels.' },
      { name: 'Competitor Two', handle: '@comp2', url: 'https://instagram.com/comp2', summary: 'Sharing meal prep tips for moms.' },
      { name: 'Competitor Three', handle: '@comp3', url: 'https://instagram.com/comp3', summary: 'Running a 30-day challenge with high engagement.' }
    ]
  }]
});

const parseSandcastle = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Parse Sandcastle Response',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode: parseSandcastleCode
    },
    position: [2112, 112]
  },
  output: [{
    client_name: 'Acme Coaching',
    slack_channel_id: 'C012345',
    content_description: 'fitness coaching reels for busy moms',
    platform: 'instagram',
    video_url: 'https://www.instagram.com/reel/abc123',
    caption: 'workout tips',
    views: 50000,
    likes: 1200,
    comments: 80,
    shares: 30,
    transcript: 'Sample transcribed text.',
    competitors: [
      { name: 'Competitor One', handle: '@comp1', url: 'https://instagram.com/comp1', summary: 'Daily morning workout reels.' }
    ]
  }]
});

const buildClaudePrompt = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Claude Prompt',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode: buildClaudePromptCode
    },
    position: [2320, 112]
  },
  output: [{
    client_name: 'Acme Coaching',
    slack_channel_id: 'C012345',
    content_description: 'fitness coaching reels for busy moms',
    platform: 'instagram',
    video_url: 'https://www.instagram.com/reel/abc123',
    caption: 'workout tips',
    views: 50000,
    likes: 1200,
    comments: 80,
    shares: 30,
    transcript: 'Sample transcribed text.',
    competitors: [],
    claude_request_body: '{"model":"claude-sonnet-4-20250514","max_tokens":800,"messages":[]}'
  }]
});

const claudeWhyItPerformed = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Claude – Why It Performed',
    parameters: {
      method: 'POST',
      url: 'https://api.anthropic.com/v1/messages',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          { name: 'anthropic-version', value: '2023-06-01' },
          { name: 'content-type', value: 'application/json' }
        ]
      },
      sendBody: true,
      contentType: 'raw',
      rawContentType: 'application/json',
      body: expr('{{ $json.claude_request_body }}'),
      options: {}
    },
    credentials: { httpHeaderAuth: newCredential('Anthropic API') },
    position: [2528, 112]
  },
  output: [{
    content: [{ text: 'This reel performed well because of its punchy hook.\n---\nCompetitor One is posting daily; competitor Two has strong meal prep angle; competitor Three runs challenges.' }]
  }]
});

const formatSlackMessage = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Format Slack Message',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode: formatSlackCode
    },
    position: [2736, 112]
  },
  output: [{
    client_name: 'Acme Coaching',
    text: 'Top reel of the week for Acme Coaching: 50,000 views',
    blocks: '{"blocks":[]}'
  }]
});

const sendSlackMessage = node({
  type: 'n8n-nodes-base.slack',
  version: 2.4,
  config: {
    name: 'Send Slack Message (TEST CHANNEL)',
    parameters: {
      resource: 'message',
      operation: 'post',
      select: 'channel',
      channelId: { __rl: true, mode: 'id', value: TEST_CHANNEL_ID },
      messageType: 'block',
      blocksUi: expr('{{ $json.blocks }}'),
      text: expr('{{ $json.text }}'),
      otherOptions: {
        includeLinkToWorkflow: false,
        unfurl_links: false,
        unfurl_media: true
      }
    },
    credentials: { slackApi: newCredential('Slack Bot') },
    onError: 'continueRegularOutput',
    position: [2944, 112]
  },
  output: [{ ok: true, channel: TEST_CHANNEL_ID }]
});

const webhookResponse = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Webhook Response',
    parameters: {
      respondWith: 'json',
      responseBody: '={ "success": true, "message": "Weekly Slack updates sent (TEST RUN)" }',
      options: {}
    },
    position: [3168, 112]
  },
  output: [{ success: true }]
});

const safetyNote = sticky(
  '## TEST WORKFLOW — DO NOT ACTIVATE FOR PRODUCTION\n\nThis is a duplicate of "Weekly Slack – Top Reel of the Week" used to develop the Sandcastle competitor integration.\n\n**Safety measures:**\n- No schedule trigger — webhook-only, fires only when called manually.\n- All Slack messages go to **test channel C0B7D49KCD6** (hardcoded), regardless of what is in the Clients Info sheet.\n- Workflow is created inactive.\n\n**Before running:** fill in the Sandcastle API URL and credential on the "Sandcastle - Find Top Competitors" node.',
  [],
  { color: 3, position: [-40, -120], width: 600, height: 280 }
);

const sandcastleNote = sticky(
  '## Sandcastle Integration\n\nThis node calls the Sandcastle API to fetch the top 3 competitors per client. Configure:\n\n1. **URL** — replace placeholder with the real endpoint\n2. **Credential (httpHeaderAuth)** — header name + API key (e.g. `Authorization: Bearer ...`)\n3. **Body** — adjust the JSON if Sandcastle expects different field names (currently sends `niche`, `platform`, `limit: 3`)\n\nThe response is parsed by "Parse Sandcastle Response" which looks for `competitors`, `data.competitors`, or `results` arrays.',
  [],
  { color: 5, position: [1880, -180], width: 480, height: 260 }
);

export default workflow('weekly-slack-with-competitors-test', 'Weekly Slack – Top Reel + Competitors (TEST)')
  .add(safetyNote)
  .add(sandcastleNote)
  .add(manualWebhookTrigger)
  .to(readClientsInfo)
  .to(readTopVideos)
  .to(matchTopReelPerClient)
  .to(getVideoUrlViaApify)
  .to(extractVideoUrl)
  .to(downloadVideo)
  .to(transcribeWithWhisper)
  .to(sandcastleCompetitors)
  .to(parseSandcastle)
  .to(buildClaudePrompt)
  .to(claudeWhyItPerformed)
  .to(formatSlackMessage)
  .to(sendSlackMessage)
  .to(webhookResponse);
