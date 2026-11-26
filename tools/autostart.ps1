# MarketLens proxy autostart (Windows). ASCII only: Windows PowerShell 5.1 misreads UTF-8 without BOM.
#
#   powershell -File tools\autostart.ps1 install   start the proxy at every sign-in (hidden) and start it now
#   powershell -File tools\autostart.ps1 remove    undo install (does not stop a running proxy)
#   powershell -File tools\autostart.ps1 start     start it now, hidden
#   powershell -File tools\autostart.ps1 stop      stop the running proxy
#   powershell -File tools\autostart.ps1 status
#
# install only puts one shortcut in your Startup folder (shell:startup); nothing else on the system changes.
# Output of the hidden proxy goes to var\proxy.log and var\proxy.err.log (overwritten at each start).
param([ValidateSet('install', 'remove', 'start', 'stop', 'status')][string]$Action = 'status')

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$server = Join-Path $root 'server'
$var = Join-Path $root 'var'
$link = Join-Path ([Environment]::GetFolderPath('Startup')) 'MarketLens Proxy.lnk'

function Get-ProxyPort {
  $port = 8787
  $envFile = Join-Path $root '.env'
  if (Test-Path $envFile) {
    $m = Select-String -Path $envFile -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1
    if ($m) { $port = [int]$m.Matches[0].Groups[1].Value }
  }
  $port
}

# The process listening on the proxy port, only if it looks like the proxy (node ... index.js).
function Get-ProxyProcess {
  $conn = Get-NetTCPConnection -LocalPort (Get-ProxyPort) -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $conn) { return $null }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)"
  if ($proc -and $proc.Name -eq 'node.exe' -and $proc.CommandLine -match 'index\.js') { return $proc }
  Write-Warning "Port $(Get-ProxyPort) is in use by another program (pid $($conn.OwningProcess))."
  $null
}

function Start-Proxy {
  if (Get-NetTCPConnection -LocalPort (Get-ProxyPort) -State Listen -ErrorAction SilentlyContinue) {
    Write-Output "Port $(Get-ProxyPort) is already in use: the proxy is probably running."
    return
  }
  $node = (Get-Command node).Source
  New-Item -ItemType Directory -Force $var | Out-Null
  Start-Process -FilePath $node -ArgumentList 'index.js' -WorkingDirectory $server -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $var 'proxy.log') -RedirectStandardError (Join-Path $var 'proxy.err.log')
  Write-Output "Started. http://127.0.0.1:$(Get-ProxyPort)/  (log: var\proxy.log)"
}

switch ($Action) {
  'install' {
    if (-not (Test-Path (Join-Path $server 'node_modules'))) { throw "Run 'npm install' in server\ first." }
    $ps = (Get-Command powershell).Source
    $shell = New-Object -ComObject WScript.Shell
    $s = $shell.CreateShortcut($link)
    $s.TargetPath = $ps
    $s.Arguments = "-NoProfile -WindowStyle Hidden -File `"$PSCommandPath`" start"
    $s.WorkingDirectory = $root
    $s.WindowStyle = 7
    $s.Description = 'MarketLens local proxy (read-only market data, 127.0.0.1 only)'
    $s.Save()
    Write-Output "Installed: $link"
    Start-Proxy
  }
  'remove' {
    if (Test-Path $link) { Remove-Item $link; Write-Output "Removed: $link" } else { Write-Output 'Not installed.' }
  }
  'start' { Start-Proxy }
  'stop' {
    $p = Get-ProxyProcess
    if ($p) { Stop-Process -Id $p.ProcessId; Write-Output "Stopped (pid $($p.ProcessId))." } else { Write-Output 'Not running.' }
  }
  'status' {
    Write-Output ("Autostart: " + $(if (Test-Path $link) { 'installed' } else { 'not installed' }))
    $p = Get-ProxyProcess
    Write-Output ("Proxy:     " + $(if ($p) { "running (pid $($p.ProcessId)), http://127.0.0.1:$(Get-ProxyPort)/" } else { 'not running' }))
  }
}
