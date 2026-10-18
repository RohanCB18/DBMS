# Start the local stack without Docker: PostgreSQL :5544, Neo4j :7687/:7474, zk-service :7000, API :8100,
# web dashboard :8090 (Vite, proxies /api to the API).
#
#   powershell -ExecutionPolicy Bypass -File scripts\local\start.ps1            # everything
#   powershell -ExecutionPolicy Bypass -File scripts\local\start.ps1 -Only postgres,neo4j
#
# Logs go to .local\logs\, process ids to .local\pids\. Stop with scripts\local\stop.ps1.
param([string[]]$Only = @('postgres', 'neo4j', 'zk', 'api', 'web'))
$ErrorActionPreference = 'Stop'

$root  = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$local = Join-Path $root '.local'
$logs  = Join-Path $local 'logs'
$pids  = Join-Path $local 'pids'
New-Item -ItemType Directory -Force $logs, $pids | Out-Null

function Test-Port([int]$port) {
    $c = New-Object Net.Sockets.TcpClient
    try { $c.Connect('127.0.0.1', $port); return $true } catch { return $false } finally { $c.Close() }
}

function Wait-Port([int]$port, [string]$name, [int]$seconds = 90) {
    for ($i = 0; $i -lt $seconds; $i++) {
        if (Test-Port $port) { Write-Host "  $name is up on :$port"; return }
        Start-Sleep -Seconds 1
    }
    throw "$name did not come up on :$port (see $logs)"
}

function Start-Bg([string]$name, [string]$file, [string[]]$arguments, [string]$dir) {
    $p = Start-Process -FilePath $file -ArgumentList $arguments -WorkingDirectory $dir -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logs "$name.log") -RedirectStandardError (Join-Path $logs "$name.err.log") -PassThru
    Set-Content (Join-Path $pids "$name.pid") $p.Id
}

if ($Only -contains 'postgres') {
    if (Test-Port 5544) { Write-Host "  postgres already running" }
    else {
        # Start-Process: pg_ctl's child inherits stdout, so capturing its output would never return
        Start-Process -FilePath (Join-Path $local 'pgsql\bin\pg_ctl.exe') -WindowStyle Hidden -ArgumentList @(
            '-D', "`"$(Join-Path $local 'pgdata')`"", '-l', "`"$(Join-Path $logs 'postgres.log')`"", 'start')
        Wait-Port 5544 'postgres'
    }
}

if ($Only -contains 'neo4j') {
    if (Test-Port 7687) { Write-Host "  neo4j already running" }
    else {
        $neo4j = Get-ChildItem $local -Directory -Filter 'neo4j-community-*' | Select-Object -First 1
        Start-Bg 'neo4j' (Join-Path $neo4j.FullName 'bin\neo4j.bat') @('console') $neo4j.FullName
        Wait-Port 7687 'neo4j' 120
    }
}

if ($Only -contains 'zk') {
    if (Test-Port 7000) { Write-Host "  zk-service already running" }
    else {
        Start-Bg 'zk' 'node' @('src/server.js') (Join-Path $root 'zk-service')
        Wait-Port 7000 'zk-service'
    }
}

if ($Only -contains 'api') {
    if (Test-Port 8100) { Write-Host "  api already running" }
    else {
        $py = Join-Path $root 'api\.venv\Scripts\python.exe'
        Start-Bg 'api' $py @('-m', 'uvicorn', 'app.main:app', '--port', '8100') (Join-Path $root 'api')
        Wait-Port 8100 'api'
        Write-Host "  Swagger UI: http://localhost:8100/docs"
    }
}

if ($Only -contains 'web') {
    if (Test-Port 8090) { Write-Host "  web already running" }
    else {
        $web = Join-Path $root 'web'
        if (-not (Test-Path (Join-Path $web 'node_modules'))) { Push-Location $web; npm install --no-audit --no-fund | Out-Null; Pop-Location }
        Start-Bg 'web' 'node' @('node_modules/vite/bin/vite.js', '--port', '8090', '--strictPort') $web
        Wait-Port 8090 'web'
        Write-Host "  Dashboard:  http://localhost:8090      Auditor portal: http://localhost:8090/audit"
    }
}
