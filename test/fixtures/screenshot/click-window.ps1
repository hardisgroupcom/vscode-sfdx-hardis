<#
.SYNOPSIS
  Clicks (or scrolls) inside the VS Code window, for the documentation
  screenshot harness (src/test/ui/docScreenshots.test.ts).

.DESCRIPTION
  Webview panels keep part of their state inside the LWC (selected workspace,
  expanded section, active tab), out of reach of the extension host. Driving a
  real click is the only way to reach those states.

  The click is sent as a window message to the Chromium render widget, so it
  works even when the window is not in the foreground - including on a locked
  session, where no window can be activated at all.

  X and Y are relative to the top-left corner of the PNG produced by
  capture-window.ps1, i.e. the window frame minus -CropTop pixels. Coordinates
  are physical pixels (see window-common.ps1), so they can be read straight
  from the captured image.

.PARAMETER X / Y
  Point to click, in capture coordinates.

.PARAMETER CropTop
  Same value as the capture, so both use the same coordinate system.

.PARAMETER Scroll
  Mouse wheel notches to send instead of a click (negative scrolls down).
#>
param(
  [Parameter(Mandatory = $true)][int]$X,
  [Parameter(Mandatory = $true)][int]$Y,
  [string]$TitleMatch = "MyCompany-CRM",
  [int]$CropTop = 38,
  [int]$Scroll = 0
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "window-common.ps1")

$hwnd = Get-SfhWindow -TitleMatch $TitleMatch
$rect = Get-SfhWindowRect -Hwnd $hwnd

$targetX = $rect.Left + $X
$targetY = $rect.Top + $CropTop + $Y

Send-SfhWindowClick -Hwnd $hwnd -ScreenX $targetX -ScreenY $targetY -Scroll $Scroll

if ($Scroll -ne 0) {
  Write-Output "scrolled $Scroll at $targetX,$targetY"
}
else {
  Write-Output "clicked $targetX,$targetY"
}
