param(
 [Parameter(Mandatory=$true)][string]$PgBin,
 [ValidateSet('unit','f27','journey','optional','composition','notifications','recovery','deferred-defaults','upstream-ledger','recovery-upstream-ledger','installation-order','installation-resume','installation-interruption','preflight','preflight-installed','view-provenance','priority-companion','priority-snapshot','priority-restore','priority-application-schema','priority-application-supplement','priority-observed-baseline','priority-application-recovery','sequence-consistency','sequence-application','credential-schema','credential-recovery','retirement-freeze','calendar-freeze','native-signoff','complete-application-recovery','card-atomic-admission','card-atomic-handlers','application-dml-admission','followup-worker','followup-outcome-proof','admission-preflight','provider-debt-disposition')][string]$Lane='journey',
 [ValidateSet('repository-negative','captured-positive')][string]$ServingMode,
 [switch]$RecoveryPostgres17,
 [switch]$SequenceBounds,
 [switch]$NativeIdentifiers,
 [switch]$EncryptedCredentials,
 [switch]$DeferredEvents,
 [switch]$ReconcilerIntegration,
 [switch]$ApplicationDataV2,
 [string]$OutputRoot
)
# Windows, preinstalled PG16/17 + Node22+ + Git Bash only. No installation or
# hosted calls. Evidence uses a disposable local cluster, not production proof.
$ErrorActionPreference='Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This runner requires Windows.' }
if ($Lane -eq 'journey' -and !$ServingMode) { throw 'Journey requires explicit -ServingMode.' }
if ($ApplicationDataV2 -and $Lane -ne 'complete-application-recovery') { throw 'ApplicationDataV2 is restricted to complete-application-recovery.' }
if ($ReconcilerIntegration -and $Lane -ne 'native-signoff') { throw 'ReconcilerIntegration is restricted to native-signoff.' }
if ($DeferredEvents -and $Lane -ne 'calendar-freeze') { throw 'DeferredEvents is restricted to calendar-freeze.' }
if ($EncryptedCredentials -and $Lane -ne 'credential-recovery') { throw 'EncryptedCredentials is restricted to credential-recovery.' }
if ($NativeIdentifiers -and $Lane -ne 'priority-application-recovery') { throw 'NativeIdentifiers is restricted to priority-application-recovery.' }
if ($SequenceBounds -and $Lane -ne 'priority-application-recovery') { throw 'SequenceBounds is restricted to priority-application-recovery.' }
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$pgPath=(Resolve-Path -LiteralPath $PgBin).Path
foreach ($binary in @('initdb.exe','pg_ctl.exe','psql.exe','postgres.exe')) {
 if (!(Test-Path -LiteralPath (Join-Path $pgPath $binary) -PathType Leaf)) { throw "Missing PostgreSQL binary: $binary" }
}
$pgVersion=(& (Join-Path $pgPath 'postgres.exe') --version) -join ''
if ($LASTEXITCODE -ne 0 -or $pgVersion -notmatch '\b(16|17)\.') { throw 'Preinstalled PostgreSQL 16 or 17 required.' }
$pgMajor=$Matches[1]
if ($RecoveryPostgres17 -and $Lane -ne 'recovery-upstream-ledger') { throw 'RecoveryPostgres17 is restricted to recovery-upstream-ledger.' }
$expectedMajor=if ($Lane -in @('f27','priority-observed-baseline','priority-application-recovery','sequence-consistency','sequence-application','credential-schema','credential-recovery','retirement-freeze','calendar-freeze','native-signoff','complete-application-recovery','card-atomic-admission','card-atomic-handlers','application-dml-admission','followup-worker','followup-outcome-proof','admission-preflight','provider-debt-disposition') -or $RecoveryPostgres17) { '17' } else { '16' }
if ($pgMajor -ne $expectedMajor) { throw "Lane $Lane requires PostgreSQL $expectedMajor binaries." }
$node=(Get-Command node -CommandType Application -ErrorAction Stop).Source
$nodeVersion=(& $node --version) -join ''
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) { throw 'Node 22 or newer required.' }
$repoRoot=(& $node -e "process.stdout.write(require('fs').realpathSync(process.argv[1]))" $repoRoot) -join ''
if ($LASTEXITCODE -ne 0 -or !$repoRoot) { throw 'Cannot resolve physical repository path.' }
$git=(Get-Command git -CommandType Application -ErrorAction Stop).Source
$gitRoot=Split-Path (Split-Path $git -Parent) -Parent
$bash=Join-Path $gitRoot 'bin\bash.exe'
if (!(Test-Path -LiteralPath $bash -PathType Leaf)) { throw 'Git Bash bin/bash.exe must be installed alongside Git.' }
$routingPattern='(?i)^(PG|F42_|NIR_|WORKLOAD_TEST_|TRACK_B_RECOVERY_TEST_|SUPABASE|DATABASE_URL|NATIVE_|F63_|ARTIFACT_|INTAKE_MANIFEST_|PROOF_)|_DATABASE_URL$'
$inherited=@([Environment]::GetEnvironmentVariables('Process').Keys | Where-Object { [string]$_ -match $routingPattern })
if ($inherited.Count) { throw ('Inherited database/proof environment refused (names only): '+($inherited -join ', ')) }
if (!$OutputRoot) { $OutputRoot=[IO.Path]::GetTempPath() }
$outputBase=[IO.Path]::GetFullPath($OutputRoot)
if (!(Test-Path -LiteralPath $outputBase -PathType Container)) { throw 'OutputRoot must be an existing private directory outside the repository.' }
$outputBase=(Resolve-Path -LiteralPath $outputBase).Path
$outputBase=(& $node -e "process.stdout.write(require('fs').realpathSync(process.argv[1]))" $outputBase) -join ''
if ($LASTEXITCODE -ne 0 -or !$outputBase) { throw 'Cannot resolve physical output path.' }
if ($outputBase.TrimEnd('\') -eq $repoRoot.TrimEnd('\') -or $outputBase.StartsWith($repoRoot.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Private evidence must remain outside repository.' }
$owner=[Guid]::NewGuid().ToString('N')
$runRoot=Join-Path $outputBase ('linear-exit-'+$Lane+'-'+$owner)
New-Item -ItemType Directory -Path $runRoot -ErrorAction Stop | Out-Null
$ownerFile=Join-Path $runRoot 'OWNER'
[IO.File]::WriteAllText($ownerFile,$owner)
$data=Join-Path $runRoot 'data'
$pwFile=Join-Path $runRoot 'init-password'
$password=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
$savedEnvironment=@{}
$priorLocation=Get-Location
$result=1

function Set-ProofEnvironment([string]$Name,[string]$Value) {
 if (!$savedEnvironment.ContainsKey($Name)) { $savedEnvironment[$Name]=[Environment]::GetEnvironmentVariable($Name,'Process') }
 [Environment]::SetEnvironmentVariable($Name,$Value,'Process')
}
function Quote-WindowsArgument([string]$Value) {
 # CommandLineToArgvW quoting, including trailing backslashes and embedded quotes.
 return '"'+[regex]::Replace([regex]::Replace($Value,'(\\*)"','$1$1\"'),'(\\+)$','$1$1')+'"'
}
function Invoke-Hidden([string]$Program,[string[]]$Arguments,[string]$LogName) {
 $argumentText=($Arguments | ForEach-Object { Quote-WindowsArgument $_ }) -join ' '
 $child=Start-Process -FilePath $Program -ArgumentList $argumentText -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runRoot ($LogName+'.log')) -RedirectStandardError (Join-Path $runRoot ($LogName+'-error.log'))
 $childHandle=$child.Handle
 try { $child.WaitForExit(); return $child.ExitCode } finally { $child.Dispose() }
}
function Assert-OwnedData {
 if (!(Test-Path -LiteralPath $ownerFile) -or [IO.File]::ReadAllText($ownerFile) -cne $owner) { throw 'Cluster ownership marker mismatch; refusing lifecycle operation.' }
 if ([IO.Path]::GetFullPath($data) -cne (Join-Path ([IO.Path]::GetFullPath($runRoot)) 'data')) { throw 'Cluster path escaped owned run directory.' }
 foreach ($entry in @($runRoot,$data)) {
  if ((Test-Path -LiteralPath $entry) -and ((Get-Item -LiteralPath $entry).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Cluster path must not be a reparse point.' }
 }
 if (Test-Path -LiteralPath (Join-Path $data 'postmaster.pid')) {
  $pidLines=Get-Content -LiteralPath (Join-Path $data 'postmaster.pid')
  if ($pidLines.Count -lt 2 -or [IO.Path]::GetFullPath($pidLines[1]) -ine [IO.Path]::GetFullPath($data)) { throw 'Postmaster data path mismatch; refusing stop.' }
 }
}
try {
 Assert-OwnedData
 [IO.File]::WriteAllText($pwFile,$password)
 $initExit=Invoke-Hidden (Join-Path $pgPath 'initdb.exe') @('-D',$data,'-U','postgres','--auth=scram-sha-256',('--pwfile='+$pwFile),'--encoding=UTF8','--locale=C') 'init'
 if ($initExit -ne 0) { $result=$initExit; throw 'initdb failed; see private logs.' }
 Remove-Item -LiteralPath $pwFile
 $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
 try { $listener.Start(); $port=$listener.LocalEndpoint.Port } finally { $listener.Stop() }
 [IO.File]::AppendAllText((Join-Path $data 'postgresql.conf'),"`nlisten_addresses = '127.0.0.1'`nport = $port`n")
 Assert-OwnedData
 $startExit=Invoke-Hidden (Join-Path $pgPath 'pg_ctl.exe') @('-D',$data,'-l',(Join-Path $runRoot 'server.log'),'-w','start') 'start'
 if ($startExit -ne 0) { $result=$startExit; throw 'pg_ctl startup failed; see private logs.' }
 Set-ProofEnvironment 'PATH' ($pgPath+';'+(Split-Path $bash -Parent)+';'+$env:PATH)
 $settings=@{
  PGHOST='127.0.0.1';PGPORT=[string]$port;PGUSER='postgres';PGPASSWORD=$password;PGDATABASE='postgres';PGSSLMODE='disable';PGCLIENTENCODING='UTF8';
  NATIVE_CARD_TEST_PSQL=(Join-Path $pgPath 'psql.exe');NATIVE_LABEL_TEST_PSQL=(Join-Path $pgPath 'psql.exe');NATIVE_IDENTIFIER_MINT_PSQL=(Join-Path $pgPath 'psql.exe');
  F63_REQUIRE_POSTGRES='1';ARTIFACT_REQUIRE_POSTGRES='1';WORKLOAD_TEST_CONFIRM='LOCAL_DISPOSABLE_ONLY';WORKLOAD_TEST_REQUIRE='1';WORKLOAD_TEST_PSQL=(Join-Path $pgPath 'psql.exe');WORKLOAD_TEST_PORT=[string]$port;WORKLOAD_TEST_PASSWORD=$password;
  PROOF_REPO_ROOT=$repoRoot;PROOF_OUTPUT_ROOT=$runRoot;PROOF_HARNESS_ROOT=(Join-Path $PSScriptRoot 'harness')
 }
 foreach ($key in $settings.Keys) { Set-ProofEnvironment $key $settings[$key] }
 if ($ServingMode) { Set-ProofEnvironment 'PROOF_SERVING_MODE' $ServingMode }
 if ($ApplicationDataV2) { Set-ProofEnvironment 'PROOF_APPLICATION_DATA_VERSION' 'v2' }
 Set-Location -LiteralPath $repoRoot
 $program=$node
 $entry=Join-Path $repoRoot 'test\run-all.js'
 if ($Lane -eq 'journey') { $entry=Join-Path $env:PROOF_HARNESS_ROOT 'bootstrap.cjs' }
 if ($Lane -eq 'optional') { $entry=Join-Path $env:PROOF_HARNESS_ROOT 'optional.cjs' }
 if ($Lane -in @('priority-snapshot','priority-restore')) {
  if (!(Test-Path -LiteralPath (Join-Path $pgPath 'pg_dump.exe') -PathType Leaf)) { throw 'Priority snapshot requires the supplied pg_dump binary.' }
  $entry=if ($Lane -eq 'priority-restore') { Join-Path $repoRoot 'test\linear-exit-priority-restore-postgres.js' } else { Join-Path $repoRoot 'test\linear-exit-priority-snapshot-postgres.js' }
 }
 if ($Lane -in @('priority-application-schema','priority-application-supplement','priority-observed-baseline')) { $entry=Join-Path $repoRoot 'test\linear-exit-priority-application-schema.js' }
 if ($Lane -eq 'priority-application-recovery') {
  if (!(Test-Path -LiteralPath (Join-Path $pgPath 'pg_dump.exe') -PathType Leaf)) { throw 'Application recovery requires pg_dump.' }
  $entry=Join-Path $repoRoot 'test\linear-exit-priority-application-recovery.js'
 }
 if ($Lane -eq 'retirement-freeze') { $entry=Join-Path $repoRoot 'test\linear-exit-retirement-freeze-postgres.js' }
 if ($Lane -eq 'calendar-freeze') { $entry=Join-Path $repoRoot 'test\linear-exit-calendar-freeze-postgres.js' }
 if ($Lane -eq 'card-atomic-admission') { $entry=Join-Path $repoRoot 'test\linear-exit-card-atomic-admission.js' }
 if ($Lane -eq 'card-atomic-handlers') { $entry=Join-Path $repoRoot 'test\linear-exit-card-atomic-handlers.js' }
 if ($Lane -eq 'application-dml-admission') { $entry=Join-Path $repoRoot 'test\linear-exit-application-dml-admission.js' }
 if ($Lane -eq 'followup-worker') { $entry=Join-Path $repoRoot 'test\linear-exit-followup-worker-postgres.js' }
 if ($Lane -eq 'followup-outcome-proof') { $entry=Join-Path $repoRoot 'test\linear-exit-followup-outcome-proof.js' }
 if ($Lane -eq 'admission-preflight') { $entry=Join-Path $repoRoot 'test\linear-exit-admission-preflight-postgres.js' }
 if ($Lane -eq 'provider-debt-disposition') { $entry=Join-Path $repoRoot 'test\linear-exit-provider-debt-disposition.js' }
 if ($Lane -eq 'complete-application-recovery') { $entry=Join-Path $repoRoot 'test\linear-exit-complete-application-recovery.js' }
 if ($Lane -eq 'native-signoff') { $entry=Join-Path $repoRoot 'test\linear-exit-native-signoff-postgres.js' }
 if ($Lane -eq 'credential-recovery') { $entry=Join-Path $repoRoot 'test\linear-exit-credential-recovery.js' }
 if ($Lane -eq 'credential-schema') { $entry=Join-Path $repoRoot 'test\linear-exit-credential-schema.js' }
 if ($Lane -eq 'sequence-application') { $entry=Join-Path $repoRoot 'test\linear-exit-sequence-application.js' }
 if ($Lane -eq 'sequence-consistency') { $entry=Join-Path $repoRoot 'test\linear-exit-sequence-consistency-postgres.js' }
 if ($Lane -eq 'priority-companion') { $entry=Join-Path $repoRoot 'test\linear-exit-priority-companion-postgres.js' }
 if ($Lane -eq 'view-provenance') { $entry=Join-Path $repoRoot 'test\linear-exit-view-provenance.js' }
 if ($Lane -eq 'preflight-installed') { $entry=Join-Path $repoRoot 'test\linear-exit-deploy-preflight-ordered.js' }
 if ($Lane -eq 'preflight') { $entry=Join-Path $repoRoot 'test\linear-exit-deploy-preflight-postgres.js' }
 if ($Lane -eq 'installation-interruption') { $entry=Join-Path $repoRoot 'test\linear-exit-install-interruption.js' }
 if ($Lane -eq 'installation-resume') { $entry=Join-Path $repoRoot 'test\linear-exit-install-resume.js' }
 if ($Lane -eq 'installation-order') { $entry=Join-Path $repoRoot 'test\linear-exit-install-order.js' }
 if ($Lane -eq 'composition') { $entry=Join-Path $repoRoot 'test\linear-exit-owner-composition.js' }
 if ($Lane -eq 'upstream-ledger') { $entry=Join-Path $repoRoot 'test\linear-exit-upstream-ledger.js' }
 if ($Lane -eq 'notifications') { $entry=Join-Path $repoRoot 'test\native-notifications-postgres.js' }
 if ($Lane -eq 'deferred-defaults') { $entry=Join-Path $repoRoot 'test\track-b-recovery-deferred-defaults-postgres.js' }
 if ($Lane -in @('recovery','recovery-upstream-ledger')) {
  $dumpBinary=Join-Path $pgPath 'pg_dump.exe'
  if (!(Test-Path -LiteralPath $dumpBinary -PathType Leaf)) { throw 'Recovery lane requires the supplied PostgreSQL pg_dump binary.' }
  $entry=Join-Path $repoRoot 'scripts\track-b-recovery-rehearsal.js'
  $recoverySettings=@{
   TRACK_B_RECOVERY_TEST_CONFIRM='LOCAL_DISPOSABLE_ONLY';TRACK_B_RECOVERY_TEST_CORPUS='history-v11';
   TRACK_B_RECOVERY_TEST_PGHOST='127.0.0.1';TRACK_B_RECOVERY_TEST_PGPORT=[string]$port;
   TRACK_B_RECOVERY_TEST_PGUSER='postgres';TRACK_B_RECOVERY_TEST_PGPASSWORD=$password;
   TRACK_B_RECOVERY_TEST_PSQL=(Join-Path $pgPath 'psql.exe');TRACK_B_RECOVERY_TEST_PG_DUMP=$dumpBinary;
   TRACK_B_RECOVERY_TEST_OUTPUT=(Join-Path $runRoot 'recovery')
  }
  if ($Lane -eq 'recovery-upstream-ledger') { $recoverySettings['TRACK_B_RECOVERY_TEST_UPSTREAM_LEDGER']='1' }
  foreach ($key in $recoverySettings.Keys) { Set-ProofEnvironment $key $recoverySettings[$key] }
 }
 $arguments=@($entry)
 if ($Lane -in @('calendar-freeze','card-atomic-handlers')) { $arguments=@('--experimental-strip-types',$entry) }
 if ($SequenceBounds) { $arguments+= '--sequence-bounds' }
 if ($NativeIdentifiers) { $arguments+= '--native-identifiers' }
 if ($EncryptedCredentials) { $arguments+= '--encrypted' }
 if ($DeferredEvents) { $arguments+= '--deferred-events' }
 if ($ReconcilerIntegration) { $arguments+= '--reconciler-integration' }
 if ($Lane -in @('priority-application-supplement','priority-observed-baseline')) { $arguments+= '--supplement-three' }
 if ($Lane -eq 'priority-observed-baseline') { $arguments+= '--observed-backup' }
 if ($Lane -eq 'f27') { $program=Join-Path $pgPath 'psql.exe';$arguments=@('-X','-v','ON_ERROR_STOP=1','-f',(Join-Path $repoRoot 'scripts\f27-team-rollback-proof.sql')) }
 $result=Invoke-Hidden $program $arguments 'unit'
 if ($result -eq 0 -and $ReconcilerIntegration) {
  if (!(Select-String -LiteralPath (Join-Path $runRoot 'unit.log') -SimpleMatch 'LINEAR_EXIT_NATIVE_SIGNOFF_INTEGRATION_OK' -Quiet)) { throw 'Required SQL reconciler integration marker missing.' }
 }
 if ($result -eq 0 -and $DeferredEvents) {
  if (!(Select-String -LiteralPath (Join-Path $runRoot 'unit.log') -SimpleMatch 'LINEAR_EXIT_CALENDAR_DEFERRED_GAP_PROVEN' -Quiet)) { throw 'Required deferred Calendar marker missing.' }
 }

 if ($result -eq 0 -and $EncryptedCredentials) {
  if (!(Select-String -LiteralPath (Join-Path $runRoot 'unit.log') -SimpleMatch 'LINEAR_EXIT_CREDENTIAL_ENCRYPTED_RECOVERY_OK' -Quiet)) { throw 'Required encrypted credential recovery marker missing.' }
 }
 if ($result -eq 0 -and $NativeIdentifiers) {
  if (!(Select-String -LiteralPath (Join-Path $runRoot 'unit.log') -SimpleMatch 'LINEAR_EXIT_NATIVE_IDENTIFIER_RECOVERY_OK' -Quiet)) { throw 'Required native identifier recovery marker missing.' }
 }
 if ($result -eq 0 -and $SequenceBounds) {
  if (!(Select-String -LiteralPath (Join-Path $runRoot 'unit.log') -SimpleMatch 'LINEAR_EXIT_SEQUENCE_BOUNDS_OK' -Quiet)) { throw 'Required sequence bounds proof marker missing.' }
 }
 if ($result -eq 0 -and $Lane -in @('recovery','recovery-upstream-ledger')) {
  $recoveryDirectories=@(Get-ChildItem -LiteralPath (Join-Path $runRoot 'recovery') -Directory -Filter 'schema-history-v11-*')
  if ($recoveryDirectories.Count -ne 1) { throw 'Expected exactly one owned versioned recovery run.' }
  $recoveryReport=Get-Content -LiteralPath (Join-Path $recoveryDirectories[0].FullName 'REPORT.private.json') -Raw | ConvertFrom-Json
  if ($Lane -eq 'recovery-upstream-ledger' -and $recoveryReport.upstream_ledger_verified -ne $true) { throw 'Required restored upstream ledger proof missing.' }
  if ($recoveryReport.status -ne 'PASS' -or $recoveryReport.corpus -ne 'history-v11' -or $recoveryReport.table_count -ne 52) { throw 'Required versioned recovery proof report missing or incompatible.' }
 }
 if ($result -eq 0 -and $Lane -in @('composition','f27','notifications','upstream-ledger','installation-order','installation-resume','installation-interruption','preflight','preflight-installed','view-provenance','priority-companion','priority-snapshot','priority-restore','priority-application-schema','priority-application-supplement','priority-observed-baseline','priority-application-recovery','sequence-consistency','sequence-application','credential-schema','credential-recovery','retirement-freeze','calendar-freeze','native-signoff','complete-application-recovery','card-atomic-admission','card-atomic-handlers','application-dml-admission','followup-worker','followup-outcome-proof','admission-preflight','provider-debt-disposition')) {
  $marker=if ($Lane -eq 'provider-debt-disposition') { 'LINEAR_EXIT_PROVIDER_DEBT_DISPOSITION_OK' } elseif ($Lane -eq 'admission-preflight') { 'LINEAR_EXIT_ADMISSION_PREFLIGHT_POSTGRES_OK' } elseif ($Lane -eq 'followup-outcome-proof') { 'LINEAR_EXIT_FOLLOWUP_OUTCOME_PROOF_OK' } elseif ($Lane -eq 'followup-worker') { 'LINEAR_EXIT_FOLLOWUP_WORKER_POSTGRES_OK' } elseif ($Lane -eq 'application-dml-admission') { 'LINEAR_EXIT_APPLICATION_DML_ADMISSION_OK' } elseif ($Lane -eq 'card-atomic-handlers') { 'LINEAR_EXIT_CARD_ATOMIC_HANDLERS_OK' } elseif ($Lane -eq 'card-atomic-admission') { 'LINEAR_EXIT_CARD_ATOMIC_ADMISSION_OK' } elseif ($Lane -eq 'complete-application-recovery') { 'LINEAR_EXIT_COMPLETE_APPLICATION_RECOVERY_OK' } elseif ($Lane -eq 'native-signoff') { 'LINEAR_EXIT_NATIVE_SIGNOFF_VERIFIER_OK' } elseif ($Lane -eq 'calendar-freeze') { 'LINEAR_EXIT_CALENDAR_FREEZE_GAP_PROVEN' } elseif ($Lane -eq 'retirement-freeze') { 'LINEAR_EXIT_GLOBAL_FREEZE_UNPROVEN' } elseif ($Lane -eq 'credential-recovery') { 'LINEAR_EXIT_CREDENTIAL_RECOVERY_OK' } elseif ($Lane -eq 'credential-schema') { 'LINEAR_EXIT_CREDENTIAL_SCHEMA_OK' } elseif ($Lane -eq 'sequence-application') { 'LINEAR_EXIT_SEQUENCE_APPLICATION_OK' } elseif ($Lane -eq 'sequence-consistency') { 'LINEAR_EXIT_SEQUENCE_CONSISTENCY_OK' } elseif ($Lane -eq 'priority-application-recovery') { 'LINEAR_EXIT_PRIORITY_APPLICATION_RECOVERY_OK' } elseif ($Lane -eq 'priority-observed-baseline') { 'LINEAR_EXIT_PRIORITY_OBSERVED_BASELINE_OK' } elseif ($Lane -in @('priority-application-schema','priority-application-supplement')) { 'LINEAR_EXIT_PRIORITY_APPLICATION_SCHEMA_OK' } elseif ($Lane -eq 'priority-restore') { 'LINEAR_EXIT_PRIORITY_RESTORE_OK' } elseif ($Lane -eq 'priority-snapshot') { 'LINEAR_EXIT_PRIORITY_SNAPSHOT_OK' } elseif ($Lane -eq 'priority-companion') { 'LINEAR_EXIT_PRIORITY_COMPANION_POSTGRES_OK' } elseif ($Lane -eq 'view-provenance') { 'LINEAR_EXIT_VIEW_PROVENANCE_OK' } elseif ($Lane -eq 'preflight-installed') { 'LINEAR_EXIT_PREFLIGHT_ORDERED_OK' } elseif ($Lane -eq 'preflight') { 'LINEAR_EXIT_PREFLIGHT_POSTGRES_OK' } elseif ($Lane -eq 'installation-interruption') { 'LINEAR_EXIT_INSTALL_INTERRUPTION_OK' } elseif ($Lane -eq 'installation-resume') { 'LINEAR_EXIT_INSTALL_RESUME_OK' } elseif ($Lane -eq 'installation-order') { 'LINEAR_EXIT_INSTALL_ORDER_OK' } elseif ($Lane -eq 'upstream-ledger') { 'LINEAR_EXIT_UPSTREAM_LEDGER_OK' } elseif ($Lane -eq 'composition') { 'LINEAR_EXIT_OWNER_COMPOSITION_OK' } elseif ($Lane -eq 'notifications') { 'ok native notifications PostgreSQL proof' } else { 'F27_PROOF_OK' }
  if (!(Select-String -LiteralPath (Join-Path $runRoot 'unit.log') -SimpleMatch $marker -Quiet)) { throw 'Required proof completion marker missing; zero exit alone is insufficient.' }
 }
 if ($result -eq 0 -and $Lane -eq 'deferred-defaults') {
  $marker='PASS PG deferred default proof: direct and SQL-inner raising generators not invoked; token bytes/defaults retained; omitted columns trigger real failure; late failure restores empty target'
  if (!(Select-String -LiteralPath (Join-Path $runRoot 'unit.log') -SimpleMatch $marker -Quiet)) { throw 'Required deferred-default completion marker missing; zero exit alone is insufficient.' }
 }
} catch {
 [IO.File]::WriteAllText((Join-Path $runRoot 'runner-error.log'),$_.Exception.Message)
 if ($result -eq 0) { $result=1 }
} finally {
 try {
  Assert-OwnedData
  # A failed start can still leave a postmaster; never rely on a success flag.
  if (Test-Path -LiteralPath (Join-Path $data 'postmaster.pid')) {
   $stopExit=Invoke-Hidden (Join-Path $pgPath 'pg_ctl.exe') @('-D',$data,'-m','fast','-w','stop') 'stop'
   if ($stopExit -ne 0) { if ($result -eq 0) { $result=$stopExit };[IO.File]::WriteAllText((Join-Path $runRoot 'cleanup-error.log'),'PostgreSQL stop failed; owned cluster may require inspection.') }
  }
  if (Test-Path -LiteralPath $pwFile) { Remove-Item -LiteralPath $pwFile }
 } catch { if ($result -eq 0) { $result=1 };[IO.File]::WriteAllText((Join-Path $runRoot 'cleanup-error.log'),$_.Exception.Message) }
 foreach ($key in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($key,$savedEnvironment[$key],'Process') }
 Set-Location -LiteralPath $priorLocation.Path
 [IO.File]::WriteAllText((Join-Path $runRoot 'RESULT.txt'),"exit=$result lane=$Lane PG$pgMajor portable Windows; no hosted proof")
 Write-Output "Private PG$pgMajor result: $runRoot; exit=$result"
}
exit $result
