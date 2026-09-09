'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-private-postgres-proof.ps1'), 'utf8');
assert.match(source, /^<#[\s\S]*\r?\n#>\r?\n\[CmdletBinding\(\)\]/);
assert.doesNotMatch(source, /^#>\]/m);
assert.match(source, /ValidateSet\('All', 'Unit', 'F27'\)/);
assert.match(source, /postgres:\$Major/);
assert.match(source, /--publish '127\.0\.0\.1::5432'/);
assert.match(source, /Assert-CleanPostgresEnvironment/);
for (const forbiddenPattern of ['PG', 'DATABASE_URL|SUPABASE_DB_URL', '_DATABASE_URL', 'F42_REHEARSAL_', 'NIR_', 'NATIVE_LABEL_PG_CONFIG', 'CARD_.*PG']) {
  assert.ok(source.includes(forbiddenPattern), `runner must reject inherited ${forbiddenPattern} selectors`);
}
assert.match(source, /\$env:F63_REQUIRE_POSTGRES = '1'/);
assert.match(source, /\$env:ARTIFACT_REQUIRE_POSTGRES = '1'/);
assert.match(source, /test\/run-all\.js/);
assert.match(source, /scripts\/f27-team-rollback-proof\.sql/);
assert.match(source, /Require-Command 'psql'/);
assert.match(source, /Start-Process[\s\S]*-RedirectStandardOutput[\s\S]*-RedirectStandardError/);
assert.doesNotMatch(source, /(?:\$Node|\$Psql)[^\r\n]*2>&1/);
assert.match(source, /F27_PROOF_OK/);
assert.match(source, /actualLabel -eq "\$RunId-\$suffix"/);
assert.match(source, /docker rm --force/i);
assert.doesNotMatch(source, /docker (?:pull|install)|winget|choco|Invoke-WebRequest/i);
assert.match(source, /\[IO\.Path\]::GetTempPath\(\)/);
console.log('private PostgreSQL proof runner contract passed');
