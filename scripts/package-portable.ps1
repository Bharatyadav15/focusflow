param(
  [switch]$CreateShortcuts
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Root = Split-Path -Parent $PSScriptRoot
$Exe = Join-Path $Root "FocusFlow.exe"
$McpScript = Join-Path $Root "focusflow-mcp.mjs"
$OutDir = Join-Path $Root "release-portable"
$StageDir = Join-Path $OutDir "FocusFlow"
$ZipPath = Join-Path $OutDir "FocusFlow-Windows-Portable.zip"

if (-not (Test-Path $Exe)) {
  throw "FocusFlow.exe not found at $Exe. Build release first."
}

New-Item -ItemType Directory -Force -Path $StageDir | Out-Null
Copy-Item -Path $Exe -Destination (Join-Path $StageDir "FocusFlow.exe") -Force
if (Test-Path $McpScript) {
  Copy-Item -Path $McpScript -Destination (Join-Path $StageDir "focusflow-mcp.mjs") -Force
}

$InstallerPs1 = @'
$ErrorActionPreference = "Stop"
$AppDir = $PSScriptRoot
$ExePath = Join-Path $AppDir "FocusFlow.exe"
$StartMenu = [Environment]::GetFolderPath("Programs")
$ShortcutPath = Join-Path $StartMenu "FocusFlow.lnk"
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $ExePath
$Shortcut.WorkingDirectory = $AppDir
$Shortcut.Description = "FocusFlow Pomodoro, Calendar & Task Manager"
$Shortcut.Save()
Write-Host "Created Start Menu shortcut: $ShortcutPath"
'@
Set-Content -Path (Join-Path $StageDir "Install-StartMenu-Shortcut.ps1") -Value $InstallerPs1 -Encoding UTF8

if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Compress-Archive -Path "$StageDir\*" -DestinationPath $ZipPath -CompressionLevel Optimal

if ($CreateShortcuts) {
  & (Join-Path $StageDir "Install-StartMenu-Shortcut.ps1")
}

Get-Item $ZipPath | Select-Object Name, Length, LastWriteTime
