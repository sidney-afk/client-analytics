// The pure half of the owner alert relay client: the payload contract, the
// public-safety screen, and the POST. Shared by scripts/monitoring-alert-relay.js
// (Node, every repository-hosted monitor) and the monitoring-watchdog-tick Edge
// Function (Deno), so a page from either host has exactly the same shape.
// The relay contract itself -- why acceptance is 2xx, what the relay renders --
// is explained at the top of scripts/monitoring-alert-relay.js.
//
// Dependency free. Nothing here reads an environment variable: the webhook is
// always passed in. Delivery CONFIRMATION (polling the n8n API) stays in the
// Node script, because it needs an n8n API key the timer host does not hold.

// The relay renders these five and drops everything else. `text` is kept in the
// body so a plain Slack incoming webhook stays a valid target for this client
// too; the relay simply ignores it.
export const RELAY_RENDERED_FIELDS = Object.freeze(['type', 'issue_identifier', 'team', 'count', 'details.run_id']);

/*
 * Two more properties of `issue_identifier`, both measured off a real delivered
 * message (run 30945918826) rather than assumed:
 *
 *   1. the relay rewrites every non-alphanumeric character to `_`
 *   2. it truncates at ~100 characters
 *
 * The first dead-man's-switch page lost two of its four lane names to that
 * truncation. Silent truncation in an alert is its own defect — an operator
 * reads a complete-looking line and acts on a partial fact. So callers get a
 * budget they can build within, `fitSummary` trims on a separator boundary, and
 * anything dropped is reported explicitly rather than just vanishing.
 */
export const RELAY_SUMMARY_BUDGET = 96;

// Anything matching these must never reach a DM from this public repository.
export const FORBIDDEN_VALUE_PATTERNS = Object.freeze([
  /https?:\/\//i,                         // webhook URLs / private links
  /\beyJ[A-Za-z0-9_-]{10,}/,              // JWT-shaped credentials
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, // email addresses
]);

export function clean(value) {
  return String(value == null ? '' : value).trim();
}

export function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status < 600);
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Collapse a value into something the relay can render on one line: no
 * newlines, no control characters, bounded length.
 */
export function relayToken(value, maxLength = 240) {
  const text = clean(value).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}~` : text;
}

/**
 * Normalise to the alphabet the relay will render anyway, so the caller sees
 * the message the owner sees rather than a prettier local version of it.
 */
export function relayAlphabet(value) {
  return relayToken(value, 4000).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Fit `parts` into the relay's rendered budget, keeping the earliest (most
 * important) parts. When something has to go, say so in the message itself —
 * a page that quietly drops half its content is worse than one that admits it.
 */
export function fitSummary(parts, budget = RELAY_SUMMARY_BUDGET) {
  const tokens = (Array.isArray(parts) ? parts : [parts]).map(relayAlphabet).filter(Boolean);
  const join = list => list.join('_');
  if (join(tokens).length <= budget) return join(tokens);
  for (let keep = tokens.length - 1; keep > 0; keep--) {
    const dropped = tokens.length - keep;
    const candidate = join([...tokens.slice(0, keep), `plus${dropped}more`]);
    if (candidate.length <= budget) return candidate;
  }
  return join(tokens).slice(0, budget);
}

export function assertPublicSafe(payload) {
  const offenders = [];
  const walk = (value, path) => {
    if (value == null) return;
    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key);
      return;
    }
    const text = String(value);
    if (FORBIDDEN_VALUE_PATTERNS.some(pattern => pattern.test(text))) offenders.push(path);
  };
  walk(payload, '');
  if (offenders.length) {
    // Report the FIELD NAMES only. Echoing the offending value would put the
    // very thing we are refusing to send into a public Actions log.
    throw new Error(`alert payload carries non-public-safe fields: ${offenders.sort().join(', ')}`);
  }
  return true;
}

/**
 * Build the relay body. `issue_identifier` is the widest rendered field, so
 * callers should pack the human-readable summary of the incident into it --
 * that is the part of the DM an operator actually reads.
 */
export function relayPayload({ type, summary, summaryParts, team, count, runId, details = {}, text = '' }) {
  // Screen the RAW input first. `relayAlphabet` rewrites `:`, `/` and `@` to
  // `_`, which would turn a leaked URL or address into something the
  // forbidden-value patterns no longer recognise — normalising before
  // screening would defeat the screen entirely.
  assertPublicSafe({ type, summary, summaryParts, team, runId, details, text });
  const resolvedType = relayAlphabet(relayToken(type, 48)) || 'syncview_alert';
  // `summaryParts` is the preferred form: an ordered, most-important-first list
  // the client can trim visibly. A plain `summary` string is still accepted and
  // fitted the same way.
  const resolvedSummary = fitSummary(summaryParts || String(summary || '').split(' ')) || 'no_summary';
  const resolvedTeam = relayAlphabet(relayToken(team, 48)) || 'unknown';
  const payload = {
    // --- rendered by the relay ---
    type: resolvedType,
    issue_identifier: resolvedSummary,
    team: resolvedTeam,
    details: { ...details, run_id: relayToken(runId, 96) || 'local' },
    // --- ignored by the relay, kept for a plain Slack incoming webhook ---
    text: relayToken(text, 900) || `[SyncView] ${resolvedType}: ${resolvedSummary} team=${resolvedTeam}`,
    syncview_alert: true,
    source: 'repository-monitor',
  };
  if (Number.isFinite(Number(count))) payload.count = Number(count);
  assertPublicSafe(payload);
  return payload;
}

/**
 * POST the alert. Success is HTTP 2xx -- the relay's actual contract. The
 * response body is returned for diagnostics and deliberately NOT asserted on:
 * pinning it to one literal string is the defect this function replaces.
 */
export async function postAlert(payload, {
  webhook,
  fetchImpl = fetch,
  attempts = 3,
  sleepImpl = sleep,
} = {}) {
  const url = clean(webhook);
  if (!url) throw new Error('SLACK_ALERT_WEBHOOK is required when paging');
  let lastError = null;
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt++) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      lastError = new Error(`alert relay transport failure: ${clean(error && error.message).slice(0, 200)}`);
      if (attempt === attempts) throw lastError;
      await sleepImpl(500 * attempt);
      continue;
    }
    const body = await response.text().catch(() => '');
    if (response.status >= 200 && response.status < 300) {
      return { accepted: true, status: response.status, body: body.slice(0, 300) };
    }
    // The relay URL itself is a secret; never let it into an error string.
    lastError = new Error(`alert relay rejected the page with HTTP ${response.status}`);
    if (!isRetryableStatus(response.status) || attempt === attempts) throw lastError;
    await sleepImpl(500 * attempt);
  }
  throw lastError || new Error('alert relay did not accept the page');
}
