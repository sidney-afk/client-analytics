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

ok(/import \{ captureGraphicTweakBaseline, scanGraphicTweakResolution \} from "\.\.\/_shared\/thumbnail-revisions\.ts";/.test(CAL),
  'calendar-upsert must import revision helpers');
ok(/surface: "calendar"[\s\S]*sourceId: id[\s\S]*patch: built\.row[\s\S]*existing: existingRead\.row/.test(CAL),
  'calendar-upsert must call helper with calendar context');
ok(/waitUntil\(scanGraphicTweakResolution\(\{[\s\S]*surface: "calendar"[\s\S]*sourceId: id[\s\S]*patch: built\.row[\s\S]*existing: existingRead\.row/.test(CAL),
  'calendar-upsert must scan the card when graphic tweaks resolve');
ok(/import \{ captureGraphicTweakBaseline, scanGraphicTweakResolution \} from "\.\.\/_shared\/thumbnail-revisions\.ts";/.test(SXR),
  'sample-review-upsert must import revision helpers');
ok(/surface: "samples"[\s\S]*sourceId: id[\s\S]*patch: built\.row[\s\S]*existing: existingRead\.row/.test(SXR),
  'sample-review-upsert must call helper with samples context');
ok(/waitUntil\(scanGraphicTweakResolution\(\{[\s\S]*surface: "samples"[\s\S]*sourceId: id[\s\S]*patch: built\.row[\s\S]*existing: existingRead\.row/.test(SXR),
  'sample-review-upsert must scan the card when graphic tweaks resolve');

ok(/thumbnail-revision-scan/.test(SCAN) && /THUMBNAIL_REVISION_SCAN_KEY/.test(SCAN),
  'scan function and optional key gate missing');
ok(/\[functions\.thumbnail-revision-scan\]\s*verify_jwt = false/.test(CFG),
  'scan function config missing');

ok(/insert into storage\.buckets[\s\S]*syncview-thumbnail-revisions/.test(SQL),
  'private storage bucket migration missing');
ok(/create table if not exists public\.thumbnail_media_revisions/.test(SQL),
  'revision table migration missing');
ok(/status text not null default 'pending' check \(status in \('pending', 'changed', 'skipped', 'error'\)\)/.test(SQL),
  'revision status check missing');
ok(/thumbnail_media_revisions_one_pending_idx[\s\S]*where status = 'pending'/.test(SQL),
  'one-pending-row partial unique index missing');
ok(/create policy "anon read thumbnail_media_revisions"/.test(SQL),
  'anon read policy missing for future UI');
ok(/alter publication supabase_realtime add table public\.thumbnail_media_revisions/.test(SQL),
  'revision table must be realtime-enabled');

ok(/Folder links are deliberately skipped/.test(DOC) && /sidneylaruel/.test(DOC),
  'documentation must cover folder limitation and test client');

console.log('thumbnail revision history source checks passed');
