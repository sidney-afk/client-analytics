// The "live" step of the daily analytics jobs (docs/plans/2026-10-01-n8n-off-analytics.md,
// section 8b). Shared by analytics-metrics-collect and analytics-top-videos-collect.
//
// In live mode a job writes the real tables the pages read (analytics_metrics,
// analytics_top_videos) as well as its own shadow state. The rows go through the SAME
// preparation analytics-write applies (prepareRows in sheets-mirror.mjs: the client slug
// rule, the date check, the row fingerprint row_hash, the occurrence number, the extra
// column), so a row written here is stored exactly as the same row arriving through
// analytics-write would be. Only the source differs: LIVE_SOURCE.
//
// analytics-write itself does not accept LIVE_SOURCE (its WRITE_SOURCES are unchanged):
// only these two jobs write it, through their own commit functions.
import { prepareRows } from './sheets-mirror.mjs';

export const LIVE_SOURCE = 'edge';

// The flag's mode. Anything that is not exactly "shadow" or "live" is off.
export function collectMode(flags) {
  const mode = flags && typeof flags === 'object' ? flags.mode : null;
  return mode === 'shadow' || mode === 'live' ? mode : 'off';
}

// A whole-dataset receipt may only be written when the run covers every active client:
// a flag with a `clients` list covers only those clients.
export function coversEveryClient(flags) {
  const list = flags && Array.isArray(flags.clients) ? flags.clients.map(c => String(c ?? '').trim()).filter(Boolean) : [];
  return list.length === 0;
}

// The real-table records for one client's rows of the day. Refuses (throws) rather than
// writing anything doubtful: a row analytics-write would reject, a row whose client slug
// is not the queue's client, or a row dated another day than the run.
/**
 * @param {'metrics'|'top_videos'} dataset
 * @param {Array<Record<string, unknown>>} rows  the n8n-shaped rows (what n8n posts to analytics-write)
 * @param {{ runId: string, clientSlug: string, runDate: string }} opts
 */
export async function liveRecords(dataset, rows, { runId, clientSlug, runDate }) {
  if (dataset !== 'metrics' && dataset !== 'top_videos') throw new Error('live_dataset_not_allowed');
  const { records, rejected } = await prepareRows(dataset, rows, { source: LIVE_SOURCE, runId, runPart: 0, priorCounts: null });
  if (rejected.length) throw new Error('live_row_rejected:' + rejected.map(r => r.reason).join(','));
  const day = dataset === 'metrics' ? 'date' : 'scraped_date';
  for (const r of records) {
    if (r.client_slug !== clientSlug) throw new Error('live_row_slug_mismatch');
    if (r[day] !== runDate) throw new Error('live_row_wrong_day');
  }
  return records;
}
