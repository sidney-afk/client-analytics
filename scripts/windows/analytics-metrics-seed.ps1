# analytics-metrics-seed.ps1 - copy the PostTracking tab into Supabase so the shadow run
# of the daily metrics job starts from the same "yesterday" as n8n.
# (docs/plans/2026-10-01-n8n-off-analytics.md, step 6.)
#
# Runs from any folder. It finds the SyncView repo on this machine, loads the collect key
# from %USERPROFILE%\.syncview\ (asking once, then saving it encrypted for this Windows
# user only), shows a dry run (counts only) and writes only after you type YES. Safe to
# re-run before the first run of a day; the function refuses once today's run has started.
# The key is never printed and never leaves this machine except in the request to
# SyncView's own analytics-metrics-collect function.
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:USERPROFILE '.syncview'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$repoFile = Join-Path $dir 'repo-path.txt'
$keyFile  = Join-Path $dir 'analytics-collect-key.dpapi'
$marker   = 'scripts\analytics-metrics-shadow-seed.js'

function Test-Repo($p) { $p -and (Test-Path (Join-Path $p $marker)) }

# 1. Find the repo: saved path, then a search of the user folder.
$repo = $null
if (Test-Path $repoFile) { $repo = (Get-Content $repoFile -Raw).Trim() }
if (-not (Test-Repo $repo)) {
  $repo = $null
  Write-Host 'Looking for the SyncView repo in your user folder...'
  $hit = Get-ChildItem -Path $env:USERPROFILE -Filter 'analytics-metrics-shadow-seed.js' -Recurse -Depth 6 -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like "*\$marker" } | Select-Object -First 1
  if ($hit) { $repo = Split-Path (Split-Path $hit.FullName -Parent) -Parent }
}
if (-not (Test-Repo $repo)) {
  throw 'Could not find the SyncView repo (client-analytics) with scripts\analytics-metrics-shadow-seed.js. Pull the latest main in your copy of the repo, or put its full path in ' + $repoFile
}
Set-Content -Path $repoFile -Value $repo
Write-Host "Repo: $repo"

# 2. The collect key: saved encrypted for this Windows user, or asked once.
if (Test-Path $keyFile) {
  $secure = Get-Content $keyFile -Raw | ConvertTo-SecureString
} else {
  $secure = Read-Host 'Paste the ANALYTICS_COLLECT_KEY (hidden; saved encrypted for your Windows user only)' -AsSecureString
  $secure | ConvertFrom-SecureString | Set-Content -Path $keyFile
}
$key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if ($key.Length -lt 32) { Remove-Item $keyFile -ErrorAction SilentlyContinue; throw 'That key is too short (it is at least 32 characters). Run the line again and paste the full key.' }

# 3. Dry run, confirm, write.
Push-Location $repo
try {
  node scripts/analytics-metrics-shadow-seed.js
  if ($LASTEXITCODE -ne 0) { throw 'The dry run failed; nothing was written.' }
  $answer = Read-Host 'Type YES to copy these rows into Supabase'
  if ($answer -ne 'YES') { Write-Host 'Stopped. Nothing was written.'; return }
  $env:ANALYTICS_COLLECT_KEY = $key
  node scripts/analytics-metrics-shadow-seed.js --apply
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'The copy failed. If it says the key was refused, delete' $keyFile 'and run the line again with the correct key. If it says "run_in_progress", today''s shadow run has already started: wait until after 05:20 UTC and run it again.'
  } else { Write-Host 'Done. The shadow run can start tomorrow at 04:00 UTC.' }
} finally {
  Remove-Item Env:\ANALYTICS_COLLECT_KEY -ErrorAction SilentlyContinue
  $key = $null
  Pop-Location
}
