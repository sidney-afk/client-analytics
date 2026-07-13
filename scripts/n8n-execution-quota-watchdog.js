'use strict';

const fs = require('fs');

const DEFAULT_BASE_URL = 'https://synchrosocial.app.n8n.cloud';
const DEFAULT_TIME_ZONE = 'America/Guatemala';
const DEFAULT_THRESHOLDS = Object.freeze([80, 90]);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function parseBoolean(value) {
  return /^(1|true|yes|on)$/i.test(clean(value));
}

function positiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be a positive number`);
  return parsed;
}

function parseThresholds(value) {
  const raw = clean(value);
  const thresholds = (raw ? raw.split(',') : DEFAULT_THRESHOLDS)
    .map(part => positiveNumber(part, 'threshold'))
    .sort((a, b) => a - b);
  if (!thresholds.length || thresholds.some(value => value >= 100)) {
    throw new Error('thresholds must contain percentages greater than 0 and less than 100');
  }
  return [...new Set(thresholds)];
}

function zonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date)
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, Number(part.value)]));
  return parts;
}

function zonedLocalToUtc(fields, timeZone) {
  const desired = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour || 0, fields.minute || 0, fields.second || 0);
  let guess = desired;
  for (let attempt = 0; attempt < 4; attempt++) {
    const rendered = zonedParts(new Date(guess), timeZone);
    const represented = Date.UTC(rendered.year, rendered.month - 1, rendered.day, rendered.hour, rendered.minute, rendered.second);
    const delta = desired - represented;
    guess += delta;
    if (delta === 0) break;
  }
  return new Date(guess);
}

function monthWindow(now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  // Constructing a formatter validates the IANA time zone before any network call.
  const current = zonedParts(now, timeZone);
  const nextMonth = current.month === 12
    ? { year: current.year + 1, month: 1 }
    : { year: current.year, month: current.month + 1 };
  const start = zonedLocalToUtc({ year: current.year, month: current.month, day: 1 }, timeZone);
  const end = zonedLocalToUtc({ ...nextMonth, day: 1 }, timeZone);
  return {
    key: `${current.year}-${String(current.month).padStart(2, '0')}`,
    start,
    end,
    timeZone,
  };
}

function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url, options, { fetchImpl = fetch, sleepImpl = sleep, attempts = 3 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(url, options);
      const text = await response.text();
      let parsed = null;
      try { parsed = text ? JSON.parse(text) : null; } catch (_error) { parsed = null; }
      if (response.ok) return parsed;
      const detail = clean(parsed && (parsed.message || parsed.error) || text).slice(0, 180);
      const error = new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
      error.status = response.status;
      if (!isRetryableStatus(response.status) || attempt === attempts) throw error;
      lastError = error;
    } catch (error) {
      if (error && error.status && !isRetryableStatus(error.status)) throw error;
      lastError = error;
      if (attempt === attempts) throw error;
    }
    await sleepImpl(500 * (2 ** (attempt - 1)));
  }
  throw lastError || new Error('request failed');
}

async function readMonthlyExecutionCount({
  baseUrl,
  apiKey,
  now = new Date(),
  timeZone = DEFAULT_TIME_ZONE,
  fetchImpl = fetch,
  sleepImpl = sleep,
} = {}) {
  if (!clean(apiKey)) throw new Error('N8N_API_KEY is required');
  const window = monthWindow(now, timeZone);
  const root = clean(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const effectiveEnd = new Date(Math.min(now.getTime(), window.end.getTime()));
  const url = new URL(`${root}/api/v1/insights/summary`);
  url.searchParams.set('startDate', window.start.toISOString());
  url.searchParams.set('endDate', effectiveEnd.toISOString());
  const payload = await fetchJson(url, {
    method: 'GET',
    headers: { 'X-N8N-API-KEY': apiKey, accept: 'application/json' },
  }, { fetchImpl, sleepImpl });
  const total = Number(payload && payload.total && payload.total.value);
  const failed = Number(payload && payload.failed && payload.failed.value);
  if (!Number.isFinite(total) || total < 0 || payload.total.unit !== 'count') {
    throw new Error('n8n Insights response did not contain a valid production execution total');
  }

  return {
    month: window.key,
    month_start: window.start.toISOString(),
    counted_through: effectiveEnd.toISOString(),
    time_zone: window.timeZone,
    execution_count: total,
    failed_count: Number.isFinite(failed) && failed >= 0 ? failed : null,
    source: 'n8n_insights_summary',
    complete: true,
  };
}

function evaluateThresholds({ count, cap, thresholds = DEFAULT_THRESHOLDS, alreadyAlerted = [] }) {
  const numericCap = positiveNumber(cap, 'monthly cap');
  const used = Number(count);
  if (!Number.isFinite(used) || used < 0) throw new Error('execution count must be zero or greater');
  const alerted = new Set(alreadyAlerted.map(Number));
  const percent = (used / numericCap) * 100;
  const due = thresholds.filter(threshold => percent >= threshold && !alerted.has(Number(threshold)));
  return {
    count: used,
    cap: numericCap,
    percent,
    remaining: Math.max(0, numericCap - used),
    overage: Math.max(0, used - numericCap),
    due,
  };
}

function alertPayload({ month, threshold, assessment, dryRun = false, runId = '' }) {
  const percent = assessment.percent.toFixed(1);
  return {
    type: `n8n_quota_${dryRun ? 'dry_run_' : ''}${threshold}`,
    issue_identifier: `month_${month}_used_${assessment.count}_cap_${assessment.cap}_remaining_${assessment.remaining}_pct_${percent}`,
    team: 'account',
    count: assessment.count,
    details: { run_id: clean(runId || 'local') },
  };
}

async function postAlert(webhookUrl, payload, options = {}) {
  if (!clean(webhookUrl)) throw new Error('N8N_QUOTA_ALERT_WEBHOOK is required when an alert is due');
  await fetchJson(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  }, options);
}

function appendFile(path, text) {
  if (clean(path)) fs.appendFileSync(path, text, 'utf8');
}

function output(name, value) {
  appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function summaryMarkdown(usage, assessment, thresholds, due, dryRun, sent) {
  return [
    '## n8n monthly execution quota',
    '',
    `- Month: \`${usage.month}\` (${usage.time_zone})`,
    `- Production executions: **${usage.execution_count}**`,
    `- Monthly cap: **${assessment.cap}**`,
    `- Usage: **${assessment.percent.toFixed(2)}%**`,
    `- Remaining headroom: **${assessment.remaining}**`,
    `- Thresholds: ${thresholds.map(value => `${value}%`).join(', ')}`,
    `- Alerts due: ${due.length ? due.map(value => `${value}%`).join(', ') : 'none'}`,
    `- Alerts sent: ${sent.length ? sent.map(value => `${value}%`).join(', ') : 'none'}`,
    `- Dry run: ${dryRun ? 'yes' : 'no'}`,
    `- Source: \`${usage.source}\``,
    '',
  ].join('\n');
}

async function main(env = process.env) {
  const now = env.N8N_QUOTA_NOW ? new Date(env.N8N_QUOTA_NOW) : new Date();
  const timeZone = clean(env.N8N_QUOTA_TIMEZONE || DEFAULT_TIME_ZONE);
  if (process.argv.includes('--month-key')) {
    console.log(`month=${monthWindow(now, timeZone).key}`);
    return;
  }

  const dryRun = parseBoolean(env.N8N_QUOTA_DRY_RUN);
  const sendDryRunAlert = dryRun && parseBoolean(env.N8N_QUOTA_SEND_DRY_RUN_ALERT);
  const capValue = dryRun && clean(env.N8N_QUOTA_CAP_OVERRIDE)
    ? env.N8N_QUOTA_CAP_OVERRIDE
    : env.N8N_MONTHLY_EXECUTION_CAP;
  const thresholdValue = dryRun && clean(env.N8N_QUOTA_THRESHOLDS_OVERRIDE)
    ? env.N8N_QUOTA_THRESHOLDS_OVERRIDE
    : '';
  const thresholds = parseThresholds(thresholdValue);
  const alreadyAlerted = DEFAULT_THRESHOLDS.filter(threshold => parseBoolean(env[`N8N_QUOTA_ALREADY_${threshold}`]));
  const usage = await readMonthlyExecutionCount({
    baseUrl: env.N8N_BASE_URL,
    apiKey: env.N8N_API_KEY,
    now,
    timeZone,
  });
  const assessment = evaluateThresholds({
    count: usage.execution_count,
    cap: capValue,
    thresholds,
    alreadyAlerted,
  });

  const shouldSend = !dryRun || sendDryRunAlert;
  const sent = [];
  for (const threshold of assessment.due) {
    if (!shouldSend) continue;
    await postAlert(env.N8N_QUOTA_ALERT_WEBHOOK, alertPayload({
      month: usage.month,
      threshold,
      assessment,
      dryRun,
      runId: env.GITHUB_RUN_ID,
    }));
    sent.push(threshold);
  }

  output('month', usage.month);
  output('execution_count', usage.execution_count);
  output('remaining', assessment.remaining);
  output('percent', assessment.percent.toFixed(4));
  output('dry_run', dryRun ? 'true' : 'false');
  for (const threshold of DEFAULT_THRESHOLDS) {
    output(`alert_${threshold}_sent`, !dryRun && sent.includes(threshold) ? 'true' : 'false');
  }
  appendFile(env.GITHUB_STEP_SUMMARY, summaryMarkdown(
    usage,
    assessment,
    thresholds,
    assessment.due,
    dryRun,
    sent,
  ));

  console.log(JSON.stringify({
    ok: true,
    dry_run: dryRun,
    usage,
    assessment: {
      count: assessment.count,
      cap: assessment.cap,
      percent: Number(assessment.percent.toFixed(4)),
      remaining: assessment.remaining,
      overage: assessment.overage,
      due_thresholds: assessment.due,
    },
    sent_thresholds: sent,
  }, null, 2));
}

module.exports = {
  DEFAULT_THRESHOLDS,
  alertPayload,
  evaluateThresholds,
  isRetryableStatus,
  monthWindow,
  parseThresholds,
  readMonthlyExecutionCount,
};

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}
