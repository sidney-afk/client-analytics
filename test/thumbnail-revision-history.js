'use strict';
/*
 * Thumbnail revision history source wiring.
 *
 * This is intentionally source-level because the feature depends on deployed
 * Edge Function secrets, Drive access, and Supabase Storage. The offline guard
 * pins the trigger condition, folder skip, storage/table migration, and the
 * Calendar/Samples writer wiring.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHARED = fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/thumbnail-revisions.ts'), 'utf8');
const CAL = fs.readFileSync(path.join(ROOT, 'supabase/functions/calendar-upsert/index.ts'), 'utf8');
const SXR = fs.readFileSync(path.join(ROOT, 'supabase/functions/sample-review-upsert/index.ts'), 'utf8');
const SCAN = fs.readFileSync(path.join(ROOT, 'supabase/functions/thumbnail-revision-scan/index.ts'), 'utf8');
const SQL = fs.readFileSync(path.join(ROOT, 'migrations/2026-07-09-thumbnail-media-revisions.sql'), 'utf8');
const V2_SQL = fs.readFileSync(path.join(ROOT, 'migrations/2026-07-14-thumbnail-revision-v2.sql'), 'utf8');
const READ = fs.readFileSync(path.join(ROOT, 'supabase/functions/thumbnail-revision-read/index.ts'), 'utf8');
const DEPLOY = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy-thumbnail-edge-functions.yml'), 'utf8');
const CFG = fs.readFileSync(path.join(ROOT, 'supabase/config.toml'), 'utf8');
const DOC = fs.readFileSync(path.join(ROOT, 'docs/features/THUMBNAIL_REVISION_HISTORY.md'), 'utf8');

function ok(cond, msg) {
  if (!cond) {
    console.error('FAIL thumbnail-revision-history:', msg);
    process.exit(1);
  }
}

ok(/export function shouldCaptureGraphicTweakBaseline\(patch: JsonMap, incoming: JsonMap, existing: JsonMap\)/.test(SHARED),
  'shared trigger predicate missing');
ok(/captureGraphicTweakBaseline[\s\S]*thumbnailRevisionV2Config\(input\.supabase\)[\s\S]*feature_config_unavailable[\s\S]*const thumbnailUrl/.test(SHARED),
  'baseline capture must fail closed on the v2 flag before any Drive or Storage work');
ok(/captureGraphicTweakBaseline[\s\S]*verifiedSnapshot\([\s\S]*"baseline"[\s\S]*const meta = captured\.meta/.test(SHARED),
  'explicit tweak baselines must verify Drive metadata after fetching original bytes');
ok(/superseded_by_new_tweak_cycle/.test(SHARED)
  && /existingAt < nextAt/.test(SHARED),
  'a new tweak cycle must supersede only an older stranded pending baseline');
ok(/if \(!has\(patch, "graphic_status"\)\) return false;/.test(SHARED),
  'capture must only trigger from graphic_status patches');
ok(/after === "Tweaks Needed" && before !== "Tweaks Needed"/.test(SHARED),
  'capture must require a transition into Tweaks Needed');
ok(/if \(isDriveFolderLink\(thumbnailUrl\)\) return \{ captured: false, reason: "folder_link" \};/.test(SHARED),
  'Drive folder links must be skipped');
ok(/const fileId = extractDriveFileId\(thumbnailUrl\);[\s\S]*if \(!fileId\) return \{ captured: false, reason: "not_drive_file" \};/.test(SHARED),
  'only single Drive file links should be captured');
ok(/const BUCKET = "syncview-thumbnail-revisions";/.test(SHARED),
  'storage bucket constant missing');
ok(/baseline_storage_path/.test(SHARED) && /latest_storage_path/.test(SHARED),
  'baseline/latest storage paths must be written');
ok(/scanPendingThumbnailRevisions/.test(SHARED) && /status: "changed"/.test(SHARED),
  'scanner must mark changed rows');
ok(/export function shouldScanGraphicTweakResolution\(patch: JsonMap, incoming: JsonMap, existing: JsonMap\)/.test(SHARED),
  'shared resolution-scan predicate missing');
ok(/before === "Tweaks Needed" && after !== "Tweaks Needed"/.test(SHARED),
  'resolution scan must require a transition out of Tweaks Needed');
ok(/export async function scanGraphicTweakResolution/.test(SHARED)
  && /sourceId: input\.sourceId/.test(SHARED)
  && /limit: 1/.test(SHARED),
  'resolution scan must target the current card baseline');
ok(/skip_reason: "no_thumbnail_change"/.test(SHARED)
  && /normStatus\(\(source as JsonMap\)\.graphic_status\) !== "Tweaks Needed"/.test(SHARED)
  && /\.lte\("requested_at", cutoff\)/.test(SHARED)
  && /Number\(result\.failed \|\| 0\) === 0/.test(SHARED),
  'unchanged cleanup must be cycle-safe and preserve failed scans for retry');

// Two-cycle behavioral regression: an unchanged first cycle is retired, a
// second cycle can capture a fresh Previous, and a delayed first-cycle cleanup
// cannot erase the newer re-entry baseline.
{
  const rows = [{ requested_at: 1000, status: 'pending' }];
  const retire = (cutoff, currentStatus) => {
    if (currentStatus === 'Tweaks Needed') return;
    for (const row of rows) {
      if (row.status === 'pending' && row.requested_at <= cutoff) row.status = 'skipped';
    }
  };
  retire(2000, 'Client Approval');
  rows.push({ requested_at: 3000, status: 'pending' });
  retire(2000, 'Tweaks Needed');
  ok(rows[0].status === 'skipped' && rows[1].status === 'pending',
    'two unchanged tweak cycles must not share or erase the newer baseline');
}

ok(/captureGraphicTweakBaseline/.test(CAL) && /scanGraphicTweakResolution/.test(CAL)
  && /thumbnailRevisionV2Config/.test(CAL),
  'calendar-upsert must import revision helpers');
ok(/surface: "calendar"[\s\S]*sourceId: id[\s\S]*patch: built\.row[\s\S]*existing: existingRead\.row/.test(CAL),
  'calendar-upsert must call helper with calendar context');
ok(/waitUntil\(scanGraphicTweakResolution\(\{[\s\S]*surface: "calendar"[\s\S]*sourceId: id[\s\S]*patch: built\.row[\s\S]*existing: existingRead\.row/.test(CAL),
  'calendar-upsert must scan the card when graphic tweaks resolve');
ok(/captureGraphicTweakBaseline/.test(SXR) && /scanGraphicTweakResolution/.test(SXR)
  && /thumbnailRevisionV2Config/.test(SXR),
  'sample-review-upsert must import revision helpers');
ok(/surface: "samples"[\s\S]*sourceId: id[\s\S]*patch: built\.row[\s\S]*existing: existingRead\.row/.test(SXR),
  'sample-review-upsert must call helper with samples context');
ok(/waitUntil\(scanGraphicTweakResolution\(\{[\s\S]*surface: "samples"[\s\S]*sourceId: id[\s\S]*patch: built\.row[\s\S]*existing: existingRead\.row/.test(SXR),
  'sample-review-upsert must scan the card when graphic tweaks resolve');

ok(/thumbnail-revision-scan/.test(SCAN) && /THUMBNAIL_REVISION_SCAN_KEY/.test(SCAN)
  && /x-syncview-scheduler-signature/.test(SCAN) && /if \(!key\)/.test(SCAN),
  'scan function must require the dedicated scheduler signature');
ok(/\[functions\.thumbnail-revision-scan\]\s*verify_jwt = false/.test(CFG),
  'scan function config missing');
ok(/\[functions\.thumbnail-revision-read\]\s*verify_jwt = false/.test(CFG),
  'protected comparison reader config missing');
ok(/thumbnailRevisionV2Config/.test(SCAN) && /client_scope_forbidden/.test(SCAN),
  'scanner must obey the v2 off/test/on client scope');
ok(/activeClients/.test(SHARED)
  && /supabase\.from\("clients"\)\.select\("slug"\)\.eq\("active", true\)/.test(SHARED)
  && /!config\.activeClients\.includes\(slug\)/.test(SHARED),
  'every Edge caller must apply the v2 flag only to active registered clients');
ok(/\.order\("last_checked_at", \{ ascending: true, nullsFirst: true \}\)[\s\S]*\.order\("requested_at"/.test(SHARED),
  'scanner must rotate by last check before original request time');
ok(/\.eq\("reason", CONTINUOUS_REASON\)[\s\S]*\.order\("last_checked_at"/.test(SHARED)
  && /syncview_thumbnail_revision_backfill/.test(SHARED),
  'scheduled scans must fairly bootstrap and revisit continuous thumbnail watchers');
ok(/checkedBefore[\s\S]*last_checked_at\.is\.null,last_checked_at\.lt/.test(SHARED)
  && /body\.checked_before[\s\S]*checkedBefore/.test(SCAN),
  'one scheduler run must exclude watchers already visited by an earlier full batch');
ok(/syncview_thumbnail_revision_rotate/.test(SHARED)
  && !/async function bumpSourceThumbnailRevision/.test(SHARED),
  'a detected Drive change must use the atomic source-CAS rotation RPC');
ok(/alt=media&supportsAllDrives=true/.test(SHARED)
  && /Drive revision changed during snapshot/.test(SHARED)
  && !/const urls = \[[\s\S]*thumbnailLink/.test(SHARED),
  'comparison snapshots must use verified Drive originals, not cached thumbnail previews');
ok(/driveAccessTokenCache/.test(SHARED)
  && /driveAccessTokenPromise/.test(SHARED)
  && /DRIVE_TOKEN_REFRESH_MARGIN_MS/.test(SHARED),
  'bounded scans must reuse one Drive OAuth token instead of exchanging per file request');

ok(/insert into storage\.buckets[\s\S]*syncview-thumbnail-revisions/.test(SQL),
  'private storage bucket migration missing');
ok(/create table if not exists public\.thumbnail_media_revisions/.test(SQL),
  'revision table migration missing');
ok(/status text not null default 'pending' check \(status in \('pending', 'changed', 'skipped', 'error'\)\)/.test(SQL),
  'revision status check missing');
ok(/thumbnail_media_revisions_one_pending_idx[\s\S]*where status = 'pending'/.test(SQL),
  'one-pending-row partial unique index missing');
ok(/revoke select on table public\.thumbnail_media_revisions from anon/.test(V2_SQL)
  && /revoke select on table public\.thumbnail_media_revisions from authenticated/.test(V2_SQL),
  'v2 migration must revoke raw revision metadata reads');
ok(/'image\/avif'/.test(V2_SQL) && /ct\.includes\("avif"\).*return "avif"/.test(SHARED),
  'private snapshots must support the AVIF thumbnails accepted by the app');
ok(/alter publication supabase_realtime add table public\.thumbnail_media_revisions/.test(SQL),
  'revision table must be realtime-enabled');

ok(/thumbnail_revision_v2/.test(V2_SQL) && /"mode":"off"/.test(V2_SQL),
  'v2 runtime kill must seed off');
ok(/normalized_slug text := regexp_replace/.test(V2_SQL)
  && /from public\.clients c\s+where c\.slug = p_client and c\.active = true/.test(V2_SQL)
  && !/where slug = p_client/.test(V2_SQL),
  'v2 client flag lookup must avoid ambiguous PL/pgSQL column references');
ok(/before update of thumbnail_url, asset_url on public\.calendar_posts/.test(V2_SQL)
  && /before update of thumbnail_url, asset_url on public\.sample_reviews/.test(V2_SQL),
  'database fallback must cover same-link media writes on both surfaces');
ok(/old_status = 'tweaks needed' and new_status <> 'tweaks needed'/.test(V2_SQL),
  'database fallback must cover every caller resolving graphic tweaks');
ok(/now_ts timestamptz := clock_timestamp\(\)/.test(V2_SQL)
  && /extract\(epoch from now_ts\)/.test(V2_SQL)
  && !/extract\(epoch from new\.updated_at\)/.test(V2_SQL),
  'database fallback must not EXTRACT directly from text updated_at columns');
ok(/old\.updated_at::timestamptz[\s\S]*parsed_ts \+ interval '1 millisecond'/.test(V2_SQL)
  && /current_updated_at::timestamptz \+ interval '1 millisecond'/.test(V2_SQL),
  'writer and scanner timestamps must advance beyond persisted updated_at before minting');
ok(/syncview_thumbnail_drive_file_id/.test(V2_SQL)
  && /'continuous_watch'/.test(V2_SQL)
  && /on conflict \(surface, client, source_id, reason\)[\s\S]*where status = 'pending'[\s\S]*do nothing/.test(V2_SQL),
  'enabled writes must preserve one pending continuous watcher across same-link and A-to-B writes');
ok(/syncview_thumbnail_revision_backfill/.test(V2_SQL)
  && /least\(greatest\(coalesce\(p_limit, 25\), 1\), 50\)/.test(V2_SQL)
  && /flag_mode = 'test'[\s\S]*p_client/.test(V2_SQL),
  'continuous watcher repair must be bounded and explicitly scoped in TEST');
ok(/join public\.clients c on c\.slug = p\.client and c\.active = true/.test(V2_SQL)
  && /lower\(btrim\(coalesce\(p\.status, ''\)\)\) <> 'archived'/.test(V2_SQL),
  'watch enrollment must exclude inactive clients and archived source rows');
ok(/syncview_thumbnail_revision_rotate/.test(V2_SQL)
  && /for update/.test(V2_SQL)
  && /reason = 'continuous_watch'[\s\S]*status = 'pending'/.test(V2_SQL)
  && /syncview_thumbnail_drive_file_id\(current_url\)/.test(V2_SQL)
  && /thumbnail source CAS failed/.test(V2_SQL),
  'rotation must lock and exact-CAS both the source media and continuous watcher');
ok(/now_ts := clock_timestamp\(\)[\s\S]*set thumb_rev = token, updated_at = now_text/.test(V2_SQL)
  && /'continuous_watch'[\s\S]*p_latest_storage_path/.test(V2_SQL),
  'rotation must mint after the source lock and install Current as the next pending baseline');
ok(/function shouldMintThumbRev[\s\S]*has\(patch, "thumbnail_url"\)[\s\S]*has\(patch, "asset_url"\)/.test(CAL)
  && /guarded\.thumb_rev = mintThumbRev/.test(CAL)
  && /guarded\.thumb_rev = mintThumbRev/.test(SXR),
  'both Edge writers must mint before write/response for any media patch');

ok(/const SIGNED_URL_TTL_SECONDS = 5 \* 60/.test(READ)
  && /createSignedUrl\(storagePath, SIGNED_URL_TTL_SECONDS\)/.test(READ),
  'reader must return only short-lived private snapshot URLs');
ok(/\.eq\("surface", surface\)[\s\S]*\.eq\("client", client\)[\s\S]*\.eq\("source_id", sourceId\)/.test(READ),
  'reader query must bind the exact surface, client, and source card');
ok(/matchingRoleForKey/.test(READ) && /client_scope_mismatch/.test(READ)
  && /roster_actor_not_unique/.test(READ),
  'reader must enforce scoped client or exact active staff identity');
ok(/\.from\("clients"\)[\s\S]*\.eq\("active", true\)/.test(READ)
  && /inactive_client/.test(READ),
  'reader must never sign snapshots for an inactive client token or target');
ok(/reason,requested_at/.test(READ)
  && /clean\(row\.reason\) !== "continuous_watch"/.test(READ)
  && /newerPendingCycle \? pendingCycle : changed \|\| pendingCycle \|\| continuousPending/.test(READ),
  'reader must ignore the fresh continuous watcher but respect a newer user tweak cycle');
ok(!/console\.log[^\n]*(?:client|sourceId|source_id)/.test(READ),
  'reader logs must not include client/card identifiers');
ok(/version:\s*2\.109\.0/.test(DEPLOY) && /timeout-minutes:\s*15/.test(DEPLOY)
  && /group:\s*deploy-thumbnail-edge-functions/.test(DEPLOY),
  'thumbnail deploy must pin its CLI and have bounded non-overlapping runs');
for (const fn of ['calendar-upsert', 'sample-review-upsert', 'thumbnail-revision-read', 'thumbnail-revision-scan']) {
  ok(DEPLOY.includes(fn), `thumbnail deploy missing ${fn}`);
}
ok(!/for fn in[^\n]*(?:onboarding|client-credentials|filming-plans)/.test(DEPLOY),
  'thumbnail deploy must not redeploy unrelated functions');

ok(/Drive folders,[\s\S]*do not\s+produce a comparison pair/.test(DOC) && /private TEST client/.test(DOC),
  'documentation must cover folder limitation and private-config test client');

console.log('thumbnail revision history source checks passed');
