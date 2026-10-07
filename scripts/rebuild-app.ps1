<#
  rebuild-app.ps1 — rebuild the Axonix desktop app safely and relaunch it.

  Run from anywhere:
    powershell -NoProfile -ExecutionPolicy Bypass -File "<repo>\scripts\rebuild-app.ps1"

  What it does, in order, and why:
    1. Finds the owner's REAL data file and snapshots it (finance-data-guard.mjs).
       Agent shells in the Claude desktop app run in an MSIX sandbox that
       redirects %LOCALAPPDATA% to a private copy; the guard reaches the real
       file through \\localhost\C$ and refuses to guess if it cannot.
    2. Closes a running Axonix gracefully — the exe is locked while it runs,
       and a graceful close lets the app finish its 250ms save.
    3. Stops ONLY the Vite dev server on port 5273 — never every node.exe.
       A live dev server makes a broken production build look like it works
       (BUILD.md).
    4. Builds and packages the unified desktop app (node scripts/build-app.mjs).
    5. Relaunches the app THROUGH EXPLORER, so it runs outside any sandbox and
       opens the real file. (Started directly from a sandboxed shell, the app
       would open the stale copy — on 2026-09-13 that made the owner's data
       look deleted. The app now refuses to start in a sandbox at all.)
       Then proves it: a new startup backup must land in the REAL backups
       folder, and the app's own log must show the embedded frontend.
    6. Verifies every pre-existing record is still present and unchanged.

  Exit code 0 only if all six pass.
#>
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$ui = Join-Path $repo 'ui'
$exe = 'D:\06 Projects\_build\cargo-target\axonix\release\Axonix\Axonix.exe'
$guard = Join-Path $PSScriptRoot 'finance-data-guard.mjs'

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }

# 1. Find the real data and protect it first.
Step 'Locating the real data file'
$where = & node $guard where
$where | ForEach-Object { Write-Host $_ }
$dataFile = ($where | Where-Object { $_ -like 'DATA *' }) -replace '^DATA ', ''
if (($where | Where-Object { $_ -like 'REAL *' }) -ne 'REAL yes') { throw 'Cannot prove which data file is real from this shell. Run from a normal terminal.' }
$dataDir = Split-Path -Parent $dataFile
$realBackups = Join-Path $dataDir 'backups'
$realLog = Join-Path $dataDir 'logs\axonix-app.log'
$shadows = @($where | Where-Object { $_ -like 'SHADOW *' } | ForEach-Object { ($_ -replace '^SHADOW ', '') -replace '\s+\(sandbox copy.*$', '' })

Step 'Snapshotting finance data'
$snap = & node $guard snapshot 'pre-rebuild'
if ($LASTEXITCODE -ne 0) { throw 'snapshot failed' }
$snap | ForEach-Object { Write-Host $_ }
$backup = ($snap | Where-Object { $_ -like 'BACKUP *' }) -replace '^BACKUP ', ''

# 2. Close the running app gracefully.
Step 'Closing Axonix if it is running'
$running = Get-Process Axonix, axonix-app -ErrorAction SilentlyContinue
if ($running) {
  # One window per round: CloseMainWindow reaches a single window, and the
  # Storeroom can be open in a window of its own beside Axonix.
  for ($round = 0; $round -lt 3; $round++) {
    $alive = Get-Process Axonix, axonix-app -ErrorAction SilentlyContinue
    if (-not $alive) { break }
    $alive | ForEach-Object { [void]$_.CloseMainWindow() }
    $alive | Wait-Process -Timeout 5 -ErrorAction SilentlyContinue
  }
  $still = Get-Process Axonix, axonix-app -ErrorAction SilentlyContinue
  if ($still) { $still | Stop-Process -Force; Start-Sleep -Milliseconds 800 }
}

# 3. Stop only the Vite dev server.
Step 'Stopping the Vite dev server on 5273 (if any)'
Get-NetTCPConnection -LocalPort 5273 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

# 4. Build.
Step 'Building the unified desktop app (Home, Finance, Social)'
Push-Location $ui
try { & node scripts/build-app.mjs; if ($LASTEXITCODE -ne 0) { throw 'app build failed' } } finally { Pop-Location }

# 5. Relaunch outside any sandbox and prove it opened the real file.
Step 'Relaunching Axonix through Explorer'
& $exe --sandbox-check
if ($LASTEXITCODE -eq 10) { Write-Host 'This shell is sandboxed; Explorer starts the app outside it.' }
$startupBefore = @(Get-ChildItem $realBackups -Filter '*-startup.json' -ErrorAction SilentlyContinue | ForEach-Object Name)
$shadowBefore = @($shadows | ForEach-Object { Get-ChildItem (Join-Path $_ 'backups') -Filter '*-startup.json' -ErrorAction SilentlyContinue | ForEach-Object FullName })
Start-Process explorer.exe -ArgumentList "`"$exe`""

$deadline = (Get-Date).AddSeconds(30)
do {
  Start-Sleep -Milliseconds 800
  $newReal = @(Get-ChildItem $realBackups -Filter '*-startup.json' -ErrorAction SilentlyContinue | Where-Object { $startupBefore -notcontains $_.Name })
  $newShadow = @($shadows | ForEach-Object { Get-ChildItem (Join-Path $_ 'backups') -Filter '*-startup.json' -ErrorAction SilentlyContinue | Where-Object { $shadowBefore -notcontains $_.FullName } })
} until ($newReal.Count -gt 0 -or $newShadow.Count -gt 0 -or (Get-Date) -gt $deadline)

if ($newShadow.Count -gt 0) {
  Get-Process Axonix, axonix-app -ErrorAction SilentlyContinue | ForEach-Object { [void]$_.CloseMainWindow() }
  throw "The app opened a SANDBOX copy ($($newShadow[0].FullName)), not the real data. It was closed. Launch Axonix from its shortcut."
}
if ($newReal.Count -eq 0) { throw "The app did not open the real data file within 30s. Check that it started, and $realLog." }

$text = if (Test-Path $realLog) { Get-Content $realLog -Raw } else { '' }
if ($text -notmatch 'frontend source: embedded dist dev_mode=false') { throw "App is NOT serving the embedded frontend. See $realLog" }
if ($text -notmatch 'read_finance_data requested') { throw "App did not read the finance data. See $realLog" }
Write-Host "App opened the real data ($($newReal[0].Name)) and is serving the embedded frontend." -ForegroundColor Green
Start-Sleep -Seconds 2   # let the first save settle

# 6. Prove the data survived.
Step 'Verifying the owner''s data'
if ($backup) {
  & node $guard verify $backup
  if ($LASTEXITCODE -ne 0) { throw "Data check FAILED. The pre-rebuild copy is at $backup" }
} else {
  Write-Host 'No data file existed before the rebuild; nothing to verify.'
}

Write-Host "`nRebuilt, relaunched on the real data, data intact." -ForegroundColor Green
