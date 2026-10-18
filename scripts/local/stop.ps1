# Stop the local stack started by scripts\local\start.ps1.
#   powershell -ExecutionPolicy Bypass -File scripts\local\stop.ps1
$root  = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$local = Join-Path $root '.local'
$pids  = Join-Path $local 'pids'

foreach ($name in 'api', 'zk', 'neo4j') {
    $f = Join-Path $pids "$name.pid"
    if (Test-Path $f) {
        $id = Get-Content $f
        # taskkill /T also stops child processes (neo4j.bat -> java, uvicorn workers)
        taskkill /PID $id /T /F 2>$null | Out-Null
        Remove-Item $f
        Write-Host "  stopped $name"
    }
}
$pgData = Join-Path $local 'pgdata'
if (Test-Path (Join-Path $pgData 'postmaster.pid')) {
    & (Join-Path $local 'pgsql\bin\pg_ctl.exe') -D $pgData stop -m fast | Out-Null
    Write-Host "  stopped postgres"
}
