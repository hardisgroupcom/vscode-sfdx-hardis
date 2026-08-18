<#
.SYNOPSIS
  Records the VS Code window as a sequence of PNG frames, for the animated
  documentation GIFs (src/test/ui/docScreenshots.test.ts).

.DESCRIPTION
  Started in the background by the screenshot harness, it grabs the window at a
  fixed frame rate while the test drives the UI. scripts/build-doc-images.py
  then assembles the frames into a GIF.

  Frames are written as frame-0001.png, frame-0002.png, ... in -OutDir.

.PARAMETER OutDir
  Folder receiving the frames (created if needed, emptied first).

.PARAMETER Seconds / Fps
  Duration and frame rate of the recording.
#>
param(
  [Parameter(Mandatory = $true)][string]$OutDir,
  [double]$Seconds = 12,
  [double]$Fps = 5,
  [string]$TitleMatch = "MyCompany-CRM",
  [int]$CropTop = 38
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class SfhRecord {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out RECT value, int size);
  public const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
}
'@

[void][SfhRecord]::SetProcessDPIAware()
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$proc = Get-Process |
  Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$TitleMatch*" } |
  Select-Object -First 1
if (-not $proc) {
  throw "No window matching '$TitleMatch' was found"
}
$hwnd = $proc.MainWindowHandle

$rect = New-Object SfhRecord+RECT
if ([SfhRecord]::DwmGetWindowAttribute($hwnd, [SfhRecord]::DWMWA_EXTENDED_FRAME_BOUNDS, [ref]$rect, 16) -ne 0) {
  [void][SfhRecord]::GetWindowRect($hwnd, [ref]$rect)
}
$left = $rect.Left
$top = $rect.Top + $CropTop
$width = $rect.Right - $rect.Left
$height = ($rect.Bottom - $rect.Top) - $CropTop

if (Test-Path $OutDir) {
  Remove-Item -Path (Join-Path $OutDir "*.png") -Force -ErrorAction SilentlyContinue
}
else {
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
}

$frameCount = [int]([math]::Round($Seconds * $Fps))
$interval = [int]([math]::Round(1000 / $Fps))
$bmp = New-Object System.Drawing.Bitmap $width, $height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

for ($i = 1; $i -le $frameCount; $i++) {
  $g.CopyFromScreen($left, $top, 0, 0, $bmp.Size)
  $bmp.Save(
    (Join-Path $OutDir ("frame-{0:D4}.png" -f $i)),
    [System.Drawing.Imaging.ImageFormat]::Png
  )
  $due = $i * $interval
  $wait = $due - $stopwatch.ElapsedMilliseconds
  if ($wait -gt 0) {
    Start-Sleep -Milliseconds $wait
  }
}

$g.Dispose()
$bmp.Dispose()
Write-Output "recorded $frameCount frames in $OutDir"
