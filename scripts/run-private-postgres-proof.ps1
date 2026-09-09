<#
.SYNOPSIS
Runs the repository's private disposable PostgreSQL proofs on Windows.

.DESCRIPTION
Prerequisites: Docker Desktop must be running, Node.js 22 or newer must be on
PATH, and the PostgreSQL psql client must be on PATH. This script installs
nothing and accepts no database URL or credential.

.EXAMPLE
& .\scripts\run-private-postgres-proof.ps1
#>]
[CmdletBinding()]
param(
  [ValidateSet('All', 'Unit', 'F27')]
  [string]$Lane = 'All'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Require-Command([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) { throw "Missing prerequisite: $Name must already be installed and on PATH." }
  return $command.Source
}

function Assert-CleanPostgresEnvironment {
  $routingNames = @(
    'DATABASE_URL', 'SUPABASE_DB_URL', 'F27_DATABASE_URL', 'F27_DISPOSABLE_DATABASE_URL',
    'PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE',
    'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS'
  )
  $present = @($routingNames | Where-Object { [Environment]::GetEnvironmentVariable($_, 'Process') })
  if ($present.Count -gt 0) {
    throw ('Refusing inherited database routing environment: ' + ($present -join ', ') +
      '. Open a clean PowerShell window or remove those process variables first.')
  }
}

function Invoke-Checked([string]$Program, [string[]]$Arguments) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Program exited with code $LASTEXITCODE." }
}

function Invoke-PostgresLane {
  param(
    [Parameter(Mandatory = $true)][ValidateSet(16, 17)][int]$Major,
    [Parameter(Mandatory = $true)][string]$Kind,
    [Parameter(Mandatory = $true)][string]$Docker,
    [Parameter(Mandatory = $true)][string]$Node,
    [Parameter(Mandatory = $true)][string]$Psql,
    [Parameter(Mandatory = $true)][string]$RunId,
    [Parameter(Mandatory = $true)][string]$LogPath
  )

  $suffix = [Guid]::NewGuid().ToString('N').Substring(0, 12)
  $containerName = "syncview-pg-proof-$Major-$suffix"
  $ownerLabel = "syncview.private-pg-proof=$RunId-$suffix"
  $containerId = $null
  $password = [Guid]::NewGuid().ToString('N')

  try {
    $containerId = (& $Docker run --detach --name $containerName --label $ownerLabel `
      --publish '127.0.0.1::5432' --env "POSTGRES_PASSWORD=$password" "postgres:$Major")
    if ($LASTEXITCODE -ne 0 -or -not $containerId) { throw "Could not start the disposable PostgreSQL $Major container." }
    $containerId = $containerId.Trim()
    if ($containerId -notmatch '^[0-9a-f]{12,64}$') { throw 'Docker returned an invalid container identifier.' }

    $portText = (& $Docker port $containerId '5432/tcp')
    if ($LASTEXITCODE -ne 0 -or $portText -notmatch '^127\.0\.0\.1:(\d{1,5})$') {
      throw 'Docker did not bind PostgreSQL to one literal loopback port.'
    }
    $port = [int]$Matches[1]
    if ($port -lt 1 -or $port -gt 65535) { throw 'Docker returned an invalid PostgreSQL port.' }

    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      & $Docker exec $containerId pg_isready -U postgres -d postgres *> $null
      if ($LASTEXITCODE -eq 0) { $ready = $true; break }
      Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw "Disposable PostgreSQL $Major did not become ready within 30 seconds." }

    $env:PGHOST = '127.0.0.1'
    $env:PGPORT = [string]$port
    $env:PGUSER = 'postgres'
    $env:PGPASSWORD = $password
    $env:PGDATABASE = 'postgres'
    $env:PGSSLMODE = 'disable'

    if ($Kind -eq 'Unit') {
      $env:F63_REQUIRE_POSTGRES = '1'
      $env:ARTIFACT_REQUIRE_POSTGRES = '1'
      & $Node test/run-all.js 2>&1 | Tee-Object -FilePath $LogPath -Append
      if ($LASTEXITCODE -ne 0) { throw "PostgreSQL 16 unit lane failed with code $LASTEXITCODE." }
    } else {
      & $Psql -X -v ON_ERROR_STOP=1 -f scripts/f27-team-rollback-proof.sql 2>&1 |
        Tee-Object -FilePath $LogPath -Append
      if ($LASTEXITCODE -ne 0) { throw "PostgreSQL 17 F27 lane failed with code $LASTEXITCODE." }
      if (-not (Select-String -Path $LogPath -SimpleMatch 'F27_PROOF_OK' -Quiet)) {
        throw 'F27 proof completed without its required terminal marker.'
      }
    }
  } finally {
    Remove-Item Env:F63_REQUIRE_POSTGRES -ErrorAction SilentlyContinue
    Remove-Item Env:ARTIFACT_REQUIRE_POSTGRES -ErrorAction SilentlyContinue
    foreach ($name in @('PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE')) {
      Remove-Item "Env:$name" -ErrorAction SilentlyContinue
    }
    if ($containerId) {
      $actualLabel = (& $Docker inspect --format '{{ index .Config.Labels "syncview.private-pg-proof" }}' $containerId 2>$null)
      if ($LASTEXITCODE -eq 0 -and $actualLabel -eq "$RunId-$suffix") {
        & $Docker rm --force $containerId *> $null
        if ($LASTEXITCODE -ne 0) { Write-Warning "Cleanup failed for disposable container $containerName ($containerId)." }
      } else {
        Write-Warning "Cleanup refused because container ownership could not be reverified: $containerName ($containerId)."
      }
    }
  }
}

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location $repoRoot
Assert-CleanPostgresEnvironment
$docker = Require-Command 'docker'
$node = Require-Command 'node'
$psql = Require-Command 'psql'
Invoke-Checked $docker @('version')
$nodeMajor = [int]((& $node --version).TrimStart('v').Split('.')[0])
if ($LASTEXITCODE -ne 0 -or $nodeMajor -lt 22) { throw 'Node.js 22 or newer is required.' }

$runId = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '-' +
  [Guid]::NewGuid().ToString('N').Substring(0, 8)
$resultRoot = Join-Path ([IO.Path]::GetTempPath()) "syncview-private-pg-proof\$runId"
New-Item -ItemType Directory -Path $resultRoot | Out-Null

try {
  if ($Lane -in @('All', 'Unit')) {
    Invoke-PostgresLane -Major 16 -Kind Unit -Docker $docker -Node $node -Psql $psql -RunId $runId `
      -LogPath (Join-Path $resultRoot 'postgres16-unit.log')
  }
  if ($Lane -in @('All', 'F27')) {
    Invoke-PostgresLane -Major 17 -Kind F27 -Docker $docker -Node $node -Psql $psql -RunId $runId `
      -LogPath (Join-Path $resultRoot 'postgres17-f27.log')
  }
  Set-Content -LiteralPath (Join-Path $resultRoot 'RESULT.txt') -Encoding ASCII `
    -Value "PASS lane=$Lane completed_utc=$((Get-Date).ToUniversalTime().ToString('o'))"
  Write-Host "PASS: private disposable PostgreSQL proof completed. Results: $resultRoot"
} catch {
  Set-Content -LiteralPath (Join-Path $resultRoot 'RESULT.txt') -Encoding ASCII `
    -Value "FAIL lane=$Lane completed_utc=$((Get-Date).ToUniversalTime().ToString('o'))"
  Write-Error "Private PostgreSQL proof failed. Results: $resultRoot`n$($_.Exception.Message)"
  exit 1
}
