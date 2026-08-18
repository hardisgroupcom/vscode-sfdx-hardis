<#
.SYNOPSIS
  Clicks (or scrolls) inside the VS Code window, for the documentation
  screenshot harness (src/test/ui/docScreenshots.test.ts).

.DESCRIPTION
  Webview panels keep part of their state inside the LWC (selected workspace,
  expanded section, active tab), out of reach of the extension host. Driving a
  real click is the only way to reach those states, so this script moves the
  physical cursor to a point expressed in capture coordinates and clicks there.

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
Set-SfhForeground -Hwnd $hwnd
$rect = Get-SfhWindowRect -Hwnd $hwnd

$targetX = $rect.Left + $X
$targetY = $rect.Top + $CropTop + $Y
[void][SfhWin]::SetCursorPos($targetX, $targetY)
Start-Sleep -Milliseconds 150

if ($Scroll -ne 0) {
  [SfhWin]::mouse_event([SfhWin]::MOUSEEVENTF_WHEEL, 0, 0, $Scroll * 120, [UIntPtr]::Zero)
  Write-Output "scrolled $Scroll at $targetX,$targetY"
}
else {
  [SfhWin]::mouse_event([SfhWin]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [SfhWin]::mouse_event([SfhWin]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
  Write-Output "clicked $targetX,$targetY"
}

# Park the cursor in the title bar: it is cropped out of the capture, so no
# hover state of the clicked element leaks into the screenshot
Start-Sleep -Milliseconds 200
[void][SfhWin]::SetCursorPos(
  [int](($rect.Left + $rect.Right) / 2),
  $rect.Top + 12
)
