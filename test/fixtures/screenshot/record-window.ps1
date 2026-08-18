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
. (Join-Path $PSScriptRoot "window-common.ps1")

$hwnd = Get-SfhWindow -TitleMatch $TitleMatch
$rect = Get-SfhWindowRect -Hwnd $hwnd

if (Test-Path $OutDir) {
  Remove-Item -Path (Join-Path $OutDir "*.png") -Force -ErrorAction SilentlyContinue
}
else {
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
}

$frameCount = [int]([math]::Round($Seconds * $Fps))
$interval = [int]([math]::Round(1000 / $Fps))
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

$skipped = 0
for ($i = 1; $i -le $frameCount; $i++) {
  # A frame can fail when the window is being activated: skip it rather than
  # stopping the whole recording
  try {
    $bmp = Get-SfhWindowBitmap -Hwnd $hwnd -Rect $rect -CropTop $CropTop
    $bmp.Save(
      (Join-Path $OutDir ("frame-{0:D4}.png" -f $i)),
      [System.Drawing.Imaging.ImageFormat]::Png
    )
    $bmp.Dispose()
  }
  catch {
    $skipped++
  }
  $due = $i * $interval
  $wait = $due - $stopwatch.ElapsedMilliseconds
  if ($wait -gt 0) {
    Start-Sleep -Milliseconds $wait
  }
}

Write-Output "recorded $($frameCount - $skipped)/$frameCount frames in $OutDir"
