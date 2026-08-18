<#
.SYNOPSIS
  Captures the VS Code window to a PNG file, for the documentation screenshot
  harness (src/test/ui/docScreenshots.test.ts).

.DESCRIPTION
  Finds the Extension Development Host window, brings it to the foreground,
  maximizes it on first use, and saves its extended frame bounds (i.e. the
  window without the invisible resize shadow) as a PNG. The capture uses real
  physical pixels, even on a scaled display (see window-common.ps1).

.PARAMETER OutFile
  Path of the PNG file to write.

.PARAMETER TitleMatch
  Substring identifying the VS Code window to capture.

.PARAMETER Maximize
  Maximize the window before capturing.

.PARAMETER CropTop / CropLeft / CropRight / CropBottom
  Optional number of pixels to remove from each side of the window capture.
#>
param(
  [Parameter(Mandatory = $true)][string]$OutFile,
  [string]$TitleMatch = "Visual Studio Code",
  [switch]$Maximize,
  [int]$CropTop = 0,
  [int]$CropLeft = 0,
  [int]$CropRight = 0,
  [int]$CropBottom = 0
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "window-common.ps1")

$hwnd = Get-SfhWindow -TitleMatch $TitleMatch
Set-SfhForeground -Hwnd $hwnd -Maximize:$Maximize
$rect = Get-SfhWindowRect -Hwnd $hwnd

$left = $rect.Left + $CropLeft
$top = $rect.Top + $CropTop
$width = ($rect.Right - $rect.Left) - $CropLeft - $CropRight
$height = ($rect.Bottom - $rect.Top) - $CropTop - $CropBottom
if ($width -le 0 -or $height -le 0) {
  throw "Invalid capture size ${width}x${height}"
}

$dir = Split-Path -Parent $OutFile
if ($dir -and -not (Test-Path $dir)) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

$bmp = New-Object System.Drawing.Bitmap $width, $height
$g = [System.Drawing.Graphics]::FromImage($bmp)
# CopyFromScreen throws while the desktop is unavailable (window being
# activated, session locking): retry a few times before giving up
$captured = $false
for ($attempt = 1; $attempt -le 3 -and -not $captured; $attempt++) {
  try {
    $g.CopyFromScreen($left, $top, 0, 0, $bmp.Size)
    $captured = $true
  }
  catch {
    Start-Sleep -Milliseconds 600
  }
}
$g.Dispose()
if (-not $captured) {
  $bmp.Dispose()
  throw "Screen capture failed: is the session locked?"
}
$bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Output "$OutFile ${width}x${height}"
