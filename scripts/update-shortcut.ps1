$sh = New-Object -ComObject WScript.Shell
$target = 'D:\06 Projects\_build\cargo-target\axonix\release\Axonix\Axonix.exe'
$workingDirectory = Split-Path -Parent $target
$shortcuts = @(
  'D:\06 Projects\Axonix\Project AXONIX\AXONIX\Axonix.lnk',
  (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Axonix.lnk')
)

foreach ($shortcutPath in $shortcuts) {
  if (-not (Test-Path -LiteralPath $shortcutPath)) {
    Write-Warning "Shortcut not found: $shortcutPath"
    continue
  }
  $sc = $sh.CreateShortcut($shortcutPath)
  $sc.TargetPath = $target
  $sc.Arguments = ''
  $sc.WorkingDirectory = $workingDirectory
  $sc.IconLocation = "$target,0"
  $sc.Save()
  Write-Host "Updated shortcut target: $shortcutPath"
}
