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
  are physical pixels (the process is made DPI aware), so they can be read
  straight from the captured image.

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

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class SfhClick {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out RECT value, int size);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint MOUSEEVENTF_WHEEL = 0x0800;
  public const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;

  public static void ForceForeground(IntPtr hWnd) {
    uint target = GetWindowThreadProcessId(hWnd, IntPtr.Zero);
    uint current = GetCurrentThreadId();
    AttachThreadInput(current, target, true);
    SetForegroundWindow(hWnd);
    AttachThreadInput(current, target, false);
  }
}
'@

[void][SfhClick]::SetProcessDPIAware()

$proc = Get-Process |
  Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$TitleMatch*" } |
  Select-Object -First 1
if (-not $proc) {
  throw "No window matching '$TitleMatch' was found"
}
$hwnd = $proc.MainWindowHandle
[SfhClick]::ForceForeground($hwnd)
Start-Sleep -Milliseconds 250

$rect = New-Object SfhClick+RECT
if ([SfhClick]::DwmGetWindowAttribute($hwnd, [SfhClick]::DWMWA_EXTENDED_FRAME_BOUNDS, [ref]$rect, 16) -ne 0) {
  [void][SfhClick]::GetWindowRect($hwnd, [ref]$rect)
}

$targetX = $rect.Left + $X
$targetY = $rect.Top + $CropTop + $Y
[void][SfhClick]::SetCursorPos($targetX, $targetY)
Start-Sleep -Milliseconds 150

if ($Scroll -ne 0) {
  [SfhClick]::mouse_event([SfhClick]::MOUSEEVENTF_WHEEL, 0, 0, $Scroll * 120, [UIntPtr]::Zero)
  Write-Output "scrolled $Scroll at $targetX,$targetY"
}
else {
  [SfhClick]::mouse_event([SfhClick]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [SfhClick]::mouse_event([SfhClick]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
  Write-Output "clicked $targetX,$targetY"
}

# Park the cursor in the title bar: it is cropped out of the capture, so no
# hover state of the clicked element leaks into the screenshot
Start-Sleep -Milliseconds 200
[void][SfhClick]::SetCursorPos(
  [int](($rect.Left + $rect.Right) / 2),
  $rect.Top + 12
)
