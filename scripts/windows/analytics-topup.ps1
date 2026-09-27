# analytics-topup.ps1 - top up the Supabase copy of the Analytics Sheets.
#
# Runs from any folder. It finds the SyncView repo on this machine, loads the
# analytics mirror write key from %USERPROFILE%\.syncview\ (asking once, then
# saving it encrypted for this Windows user only), shows a dry run, and writes
# only after you type YES. Safe to re-run: rows already in Supabase are never
# doubled. The key is never printed and never leaves this machine except in
# the request to SyncView's own analytics-write function.
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:USERPROFILE '.syncview'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$repoFile = Join-Path $dir 'repo-path.txt'
$keyFile  = Join-Path $dir 'analytics-mirror-key.dpapi'
$marker   = 'scripts\sheets-mirror-backfill.js'

function Test-Repo($p) { $p -and (Test-Path (Join-Path $p $marker)) }

# 1. Find the repo: saved path, then the path the f27 capture script uses,
#    then a search of the user folder.
$repo = $null
if (Test-Path $repoFile) { $repo = (Get-Content $repoFile -Raw).Trim() }
if (-not (Test-Repo $repo)) {
  $repo = $null
  $f27 = Join-Path $dir 'f27-capture.ps1'
  if (Test-Path $f27) {
    foreach ($m in [regex]::Matches((Get-Content $f27 -Raw), '[A-Za-z]:\\[^"''\r\n;|]+')) {
      $p = $m.Value.TrimEnd('\', ' ')
      while ($p -and -not (Test-Repo $p) -and ($p -match '\\')) { $p = Split-Path $p -Parent }
      if (Test-Repo $p) { $repo = $p; break }
    }
  }
}
if (-not $repo) {
  Write-Host 'Looking for the SyncView repo in your user folder...'
  $hit = Get-ChildItem -Path $env:USERPROFILE -Filter 'sheets-mirror-backfill.js' -Recurse -Depth 6 -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like "*\$marker" } | Select-Object -First 1
  if ($hit) { $repo = Split-Path (Split-Path $hit.FullName -Parent) -Parent }
}
if (-not (Test-Repo $repo)) {
  throw 'Could not find the SyncView repo (client-analytics) with scripts\sheets-mirror-backfill.js. Pull the latest main in your copy of the repo, or put its full path in ' + $repoFile
}
Set-Content -Path $repoFile -Value $repo
Write-Host "Repo: $repo"

# 2. The write key: saved encrypted for this Windows user, or asked once.
if (Test-Path $keyFile) {
  $secure = Get-Content $keyFile -Raw | ConvertTo-SecureString
} else {
  $secure = Read-Host 'Paste the analytics mirror write key (hidden; saved encrypted for your Windows user only)' -AsSecureString
  $secure | ConvertFrom-SecureString | Set-Content -Path $keyFile
}
$key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if ($key.Length -lt 32) { Remove-Item $keyFile -ErrorAction SilentlyContinue; throw 'That key is too short (it is at least 32 characters). Run the line again and paste the full key.' }

# 3. Dry run, confirm, write.
Push-Location $repo
try {
  node scripts/sheets-mirror-backfill.js
  if ($LASTEXITCODE -ne 0) { throw 'The dry run failed; nothing was written.' }
  $answer = Read-Host 'Type YES to write these rows to Supabase'
  if ($answer -ne 'YES') { Write-Host 'Stopped. Nothing was written.'; return }
  $env:ANALYTICS_MIRROR_WRITE_KEY = $key
  node scripts/sheets-mirror-backfill.js --apply
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'The write failed. If it says the key was refused, delete' $keyFile 'and run the line again with the correct key.'
  } else { Write-Host 'Done. Supabase is topped up.' }
} finally {
  Remove-Item Env:\ANALYTICS_MIRROR_WRITE_KEY -ErrorAction SilentlyContinue
  $key = $null
  Pop-Location
}
