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

$dir = Split-Path -Parent $OutFile
if ($dir -and -not (Test-Path $dir)) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

$bmp = Get-SfhWindowBitmap -Hwnd $hwnd -Rect $rect `
  -CropTop $CropTop -CropLeft $CropLeft -CropRight $CropRight -CropBottom $CropBottom
$width = $bmp.Width
$height = $bmp.Height
$bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Output "$OutFile ${width}x${height}"
