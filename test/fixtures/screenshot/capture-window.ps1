<#
.SYNOPSIS
  Captures the VS Code window to a PNG file, for the documentation screenshot
  harness (src/test/ui/docScreenshots.test.ts).

.DESCRIPTION
  Finds the Extension Development Host window, brings it to the foreground,
  maximizes it on first use, and saves its extended frame bounds (i.e. the
  window without the invisible resize shadow) as a PNG.

  The process is made DPI aware first, so on a scaled display (e.g. 125%) the
  capture uses real physical pixels (1920x1080 instead of 1536x864).

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

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class SfhWin {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out RECT value, int size);

  public const int SW_MAXIMIZE = 3;
  public const int SW_RESTORE = 9;
  public const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;

  // Brings a window to the front reliably (SetForegroundWindow alone is
  // refused when the caller does not own the foreground)
  public static void ForceForeground(IntPtr hWnd) {
    uint target = GetWindowThreadProcessId(hWnd, IntPtr.Zero);
    uint current = GetCurrentThreadId();
    AttachThreadInput(current, target, true);
    SetForegroundWindow(hWnd);
    AttachThreadInput(current, target, false);
  }
}
'@

[void][SfhWin]::SetProcessDPIAware()
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$candidates = Get-Process |
  Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$TitleMatch*" }
if (-not $candidates) {
  throw "No window matching '$TitleMatch' was found"
}
$hwnd = ($candidates | Select-Object -First 1).MainWindowHandle

if ($Maximize -and -not [SfhWin]::IsZoomed($hwnd)) {
  [void][SfhWin]::ShowWindow($hwnd, [SfhWin]::SW_MAXIMIZE)
  Start-Sleep -Milliseconds 700
}

[SfhWin]::ForceForeground($hwnd)
Start-Sleep -Milliseconds 350
if ([SfhWin]::GetForegroundWindow() -ne $hwnd) {
  # Second attempt: some window managers need a restore/maximize cycle
  [void][SfhWin]::ShowWindow($hwnd, [SfhWin]::SW_MAXIMIZE)
  [SfhWin]::ForceForeground($hwnd)
  Start-Sleep -Milliseconds 350
}

$rect = New-Object SfhWin+RECT
if ([SfhWin]::DwmGetWindowAttribute($hwnd, [SfhWin]::DWMWA_EXTENDED_FRAME_BOUNDS, [ref]$rect, 16) -ne 0) {
  [void][SfhWin]::GetWindowRect($hwnd, [ref]$rect)
}

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
$g.CopyFromScreen($left, $top, 0, 0, $bmp.Size)
$g.Dispose()
$bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Output "$OutFile ${width}x${height}"
