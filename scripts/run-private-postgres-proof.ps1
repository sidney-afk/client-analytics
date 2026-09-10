<#
.SYNOPSIS
Runs the repository's private disposable PostgreSQL proofs on Windows.

.DESCRIPTION
Prerequisites: Docker Desktop must be running, Node.js 22 or newer must be on
PATH, and the PostgreSQL psql client must be on PATH. This script installs
nothing and accepts no database URL or credential.

.EXAMPLE
& .\scripts\run-private-postgres-proof.ps1
#>
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
  $present = @([Environment]::GetEnvironmentVariables('Process').Keys | Where-Object {
    $name = [string]$_
    $name -match '^(?i:PG)' -or $name -match '(?i:_DATABASE_URL)$' -or
      $name -match '^(?i:DATABASE_URL|SUPABASE_DB_URL)$' -or
      $name -match '^(?i:WORKLOAD_TEST_)' -or $name -match '^(?i:F42_REHEARSAL_)' -or $name -match '^(?i:NIR_)' -or
      $name -match '^(?i:NATIVE_LABEL_PG_CONFIG)$' -or $name -match '^(?i:CARD_.*PG)' -or
      $name -match '^(?i:NATIVE_CARD_TEST_PSQL|NATIVE_LABEL_TEST_PSQL|NATIVE_IDENTIFIER_MINT_PSQL)$' -or
      $name -match '^(?i:F63_REQUIRE_POSTGRES|ARTIFACT_REQUIRE_POSTGRES|INTAKE_MANIFEST_REQUIRE_POSTGRES)$'
  } | Sort-Object)
  if ($present.Count -gt 0) {
    throw ('Refusing inherited database routing environment: ' + ($present -join ', ') +
      '. Open a clean PowerShell window or remove those process variables first.')
  }
}

function Invoke-LoggedProcess {
  param(
    [Parameter(Mandatory = $true)][string]$Program,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$LogPath
  )
  $stdoutPath = "$LogPath.stdout-$([Guid]::NewGuid().ToString('N'))"
  $stderrPath = "$LogPath.stderr-$([Guid]::NewGuid().ToString('N'))"
  try {
    $process = Start-Process -FilePath $Program -ArgumentList $Arguments -NoNewWindow -Wait -PassThru `
      -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    foreach ($streamPath in @($stdoutPath, $stderrPath)) {
      if (Test-Path -LiteralPath $streamPath) {
        $lines = @(Get-Content -LiteralPath $streamPath)
        if ($lines.Count -gt 0) {
          $lines | Add-Content -LiteralPath $LogPath
          foreach ($line in $lines) { Write-Host $line }
        }
      }
    }
    return $process.ExitCode
  } finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
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
    # Windows PowerShell treats native stderr (including a normal image pull)
    # as an error when callers redirect streams. Judge Docker by its exit code.
    $dockerPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      $containerId = (& $Docker run --detach --name $containerName --label $ownerLabel `
        --publish '127.0.0.1::5432' --env "POSTGRES_PASSWORD=$password" "postgres:$Major")
      $dockerExit = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $dockerPreference
    }
    if ($dockerExit -ne 0 -or -not $containerId) { throw "Could not start the disposable PostgreSQL $Major container." }
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
    $env:PGCLIENTENCODING = 'UTF8'

    if ($Kind -eq 'Unit') {
      $env:F63_REQUIRE_POSTGRES = '1'
      $env:ARTIFACT_REQUIRE_POSTGRES = '1'
      $env:WORKLOAD_TEST_CONFIRM = 'LOCAL_DISPOSABLE_ONLY'
      $env:WORKLOAD_TEST_REQUIRE = '1'
      $env:WORKLOAD_TEST_PSQL = $Psql
      $env:WORKLOAD_TEST_PORT = [string]$port
      $env:WORKLOAD_TEST_PASSWORD = $password
      $env:NATIVE_CARD_TEST_PSQL = $Psql
      $env:NATIVE_LABEL_TEST_PSQL = $Psql
      $env:NATIVE_IDENTIFIER_MINT_PSQL = $Psql
      $exitCode = Invoke-LoggedProcess -Program $Node -Arguments @('test/run-all.js') -LogPath $LogPath
      if ($exitCode -ne 0) { throw "PostgreSQL 16 unit lane failed with code $exitCode." }
    } else {
      $exitCode = Invoke-LoggedProcess -Program $Psql `
        -Arguments @('-X', '-v', 'ON_ERROR_STOP=1', '-f', 'scripts/f27-team-rollback-proof.sql') `
        -LogPath $LogPath
      if ($exitCode -ne 0) { throw "PostgreSQL 17 F27 lane failed with code $exitCode." }
      if (-not (Select-String -Path $LogPath -SimpleMatch 'F27_PROOF_OK' -Quiet)) {
        throw 'F27 proof completed without its required terminal marker.'
      }
    }
  } finally {
    Remove-Item Env:F63_REQUIRE_POSTGRES -ErrorAction SilentlyContinue
    Remove-Item Env:ARTIFACT_REQUIRE_POSTGRES -ErrorAction SilentlyContinue
    foreach ($name in @('WORKLOAD_TEST_CONFIRM','WORKLOAD_TEST_REQUIRE','WORKLOAD_TEST_PSQL','WORKLOAD_TEST_PORT','WORKLOAD_TEST_PASSWORD')) {
      Remove-Item "Env:$name" -ErrorAction SilentlyContinue
    }
    foreach ($name in @('NATIVE_CARD_TEST_PSQL','NATIVE_LABEL_TEST_PSQL','NATIVE_IDENTIFIER_MINT_PSQL')) {
      Remove-Item "Env:$name" -ErrorAction SilentlyContinue
    }
    foreach ($name in @('PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE','PGCLIENTENCODING')) {
      Remove-Item "Env:$name" -ErrorAction SilentlyContinue
    }
    if ($containerId) {
      # Avoid embedded quotes stripped by Windows PowerShell's native argument
      # marshalling. Read only labels, never the container credential environment.
      $labelJson = (& $Docker inspect --format '{{json .Config.Labels}}' $containerId 2>$null)
      $inspectExit = $LASTEXITCODE
      $actualLabel = $null
      if ($inspectExit -eq 0 -and $labelJson) {
        $labels = $labelJson | ConvertFrom-Json
        $ownerProperty = $labels.PSObject.Properties['syncview.private-pg-proof']
        if ($ownerProperty) { $actualLabel = $ownerProperty.Value }
      }
      if ($inspectExit -eq 0 -and $actualLabel -eq "$RunId-$suffix") {
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

$originalPath = $env:PATH
try {
  # Git Bash runs the local shell-only fixtures. Windows' bash.exe may instead
  # target Docker's WSL distribution, which has no /bin/bash.
  $git = Get-Command git -ErrorAction SilentlyContinue
  if ($git) {
    $gitRoot = Split-Path (Split-Path $git.Source -Parent) -Parent
    $gitBashDirectory = Join-Path $gitRoot 'bin'
    if (Test-Path -LiteralPath (Join-Path $gitBashDirectory 'bash.exe')) {
      $env:PATH = $gitBashDirectory + ';' + $env:PATH
    }
  }
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
} finally {
  $env:PATH = $originalPath
}
