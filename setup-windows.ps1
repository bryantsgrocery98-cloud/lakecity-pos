# One-time setup on the register computer: desktop icon + start at login.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbs = Join-Path $root 'start-pos-hidden.vbs'
$icon = Join-Path $root 'pos.ico'
$name = 'Bryants POS'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js is not installed. Install it from https://nodejs.org first.' -ForegroundColor Red
  Read-Host 'Press Enter to close'; exit 1
}
if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  Write-Host 'Installing the POS parts (one time, needs internet)...'
  Push-Location $root; & npm.cmd install --omit=dev --no-audit --no-fund; Pop-Location
}

$shell = New-Object -ComObject WScript.Shell
function Make-Shortcut($where) {
  $lnk = $shell.CreateShortcut((Join-Path $where "$name.lnk"))
  $lnk.TargetPath = 'wscript.exe'
  $lnk.Arguments = '"' + $vbs + '"'
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation = $icon
  $lnk.Description = 'Open the register'
  $lnk.Save()
}
$desktop = [Environment]::GetFolderPath('Desktop')
$startup = [Environment]::GetFolderPath('Startup')
Make-Shortcut $desktop
Make-Shortcut $startup

Write-Host ''
Write-Host "Done. '$name' is on the desktop and will start when you sign in." -ForegroundColor Green
Write-Host 'Starting it now...'
Start-Process wscript.exe -ArgumentList ('"' + $vbs + '"') -WorkingDirectory $root
Start-Sleep 3
