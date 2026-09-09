'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-private-postgres-proof.ps1'), 'utf8');
assert.match(source, /ValidateSet\('All', 'Unit', 'F27'\)/);
assert.match(source, /postgres:\$Major/);
assert.match(source, /--publish '127\.0\.0\.1::5432'/);
assert.match(source, /Assert-CleanPostgresEnvironment/);
for (const forbidden of ['DATABASE_URL', 'SUPABASE_DB_URL', 'F27_DATABASE_URL', 'PGHOSTADDR', 'PGSERVICE', 'PGOPTIONS']) {
  assert.ok(source.includes(`'${forbidden}'`), `runner must reject inherited ${forbidden}`);
}
assert.match(source, /\$env:F63_REQUIRE_POSTGRES = '1'/);
assert.match(source, /\$env:ARTIFACT_REQUIRE_POSTGRES = '1'/);
assert.match(source, /test\/run-all\.js/);
assert.match(source, /scripts\/f27-team-rollback-proof\.sql/);
assert.match(source, /Require-Command 'psql'/);
assert.match(source, /F27_PROOF_OK/);
assert.match(source, /actualLabel -eq "\$RunId-\$suffix"/);
assert.match(source, /docker rm --force/i);
assert.doesNotMatch(source, /docker (?:pull|install)|winget|choco|Invoke-WebRequest/i);
assert.match(source, /\[IO\.Path\]::GetTempPath\(\)/);
console.log('private PostgreSQL proof runner contract passed');
