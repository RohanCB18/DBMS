# One-time setup of the portable local databases (no Docker, no admin rights).
#
#   powershell -ExecutionPolicy Bypass -File scripts\local\setup.ps1
#
# Expects the portable builds unpacked into .local\ (gitignored):
#   .local\pgsql\                      PostgreSQL 16 Windows binaries (EnterpriseDB zip)
#   .local\neo4j-community-5.26.x\     Neo4j 5 Community (neo4j.com zip)
# MongoDB is used from a local install/service (default mongodb://localhost:27017).
# Pass -Reset to wipe the PostgreSQL data directory and re-run the schema files.
param([switch]$Reset)
$ErrorActionPreference = 'Stop'

$root  = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$local = Join-Path $root '.local'
$pgBin = Join-Path $local 'pgsql\bin'
$pgData = Join-Path $local 'pgdata'
$neo4j = Get-ChildItem $local -Directory -Filter 'neo4j-community-*' | Select-Object -First 1
if (-not (Test-Path (Join-Path $pgBin 'initdb.exe'))) { throw "PostgreSQL binaries not found in $pgBin" }
if (-not $neo4j) { throw "Neo4j not found in $local" }

# ---------------------------------------------------------------- PostgreSQL
if ($Reset -and (Test-Path $pgData)) {
    & (Join-Path $pgBin 'pg_ctl.exe') -D $pgData stop -m fast 2>$null | Out-Null
    Remove-Item -Recurse -Force $pgData
}
if (-not (Test-Path (Join-Path $pgData 'PG_VERSION'))) {
    $pw = Join-Path $local 'pwfile.txt'
    [IO.File]::WriteAllText($pw, "ztdb`n")
    & (Join-Path $pgBin 'initdb.exe') -D $pgData -U ztdb --pwfile=$pw -A scram-sha-256 -E UTF8 --locale=C | Out-Host
    Remove-Item $pw
    Add-Content (Join-Path $pgData 'postgresql.conf') "`nport = 5544`nlisten_addresses = 'localhost'`n"
    $fresh = $true
}
& (Join-Path $PSScriptRoot 'start.ps1') -Only postgres
if ($fresh) {
    $env:PGPASSWORD = 'ztdb'
    $psql = Join-Path $pgBin 'psql.exe'
    & $psql -h localhost -p 5544 -U ztdb -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE ztdb" | Out-Host
    foreach ($f in Get-ChildItem (Join-Path $root 'db\postgres') -Filter '*.sql' | Sort-Object Name) {
        Write-Host "applying $($f.Name)"
        & $psql -h localhost -p 5544 -U ztdb -d ztdb -v ON_ERROR_STOP=1 -q -f $f.FullName | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "failed: $($f.Name)" }
    }
}

# ---------------------------------------------------------------- Neo4j
$auth = Join-Path $neo4j.FullName 'data\dbms\auth.ini'
if (-not (Test-Path $auth)) {
    & (Join-Path $neo4j.FullName 'bin\neo4j-admin.bat') dbms set-initial-password ztdb-neo4j | Out-Host
}
$conf = Join-Path $neo4j.FullName 'conf\neo4j.conf'
if (-not (Select-String -Path $conf -Pattern '^# ztdb settings' -Quiet)) {
    Add-Content $conf "`n# ztdb settings`nserver.memory.heap.max_size=512m`nserver.memory.pagecache.size=256m`n"
}

# ---------------------------------------------------------------- .env
$envFile = Join-Path $root '.env'
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $root '.env.example') $envFile
    (Get-Content $envFile) -replace '^MONGO_URI=.*', 'MONGO_URI=mongodb://localhost:27017' | Set-Content $envFile -Encoding ascii
    Write-Host "wrote .env (MongoDB on 27017)"
}
Write-Host "`nSetup done. Start everything with: powershell -File scripts\local\start.ps1"
