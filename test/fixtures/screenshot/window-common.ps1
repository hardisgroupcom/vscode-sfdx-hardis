<#
.SYNOPSIS
  Window helpers shared by the documentation screenshot scripts
  (capture-window.ps1, click-window.ps1, record-window.ps1).

.DESCRIPTION
  Dot-source it from a script of this folder:

      . (Join-Path $PSScriptRoot "window-common.ps1")

  It makes the process DPI aware (so coordinates and captures use physical
  pixels on a scaled display), loads the drawing assemblies, and exposes:

  - Get-SfhWindow      : handle of the VS Code window to work on
  - Set-SfhForeground  : bring that window to the front, reliably
  - Get-SfhWindowRect  : its frame, without the invisible resize shadow
#>

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
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out RECT value, int size);

  public const int SW_MAXIMIZE = 3;
  public const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint MOUSEEVENTF_WHEEL = 0x0800;

  // SetForegroundWindow alone is refused when the caller does not own the
  // foreground: attaching to the target thread first makes it work
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

function Get-SfhWindow {
  param([Parameter(Mandatory = $true)][string]$TitleMatch)
  $proc = Get-Process |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$TitleMatch*" } |
    Select-Object -First 1
  if (-not $proc) {
    throw "No window matching '$TitleMatch' was found"
  }
  return $proc.MainWindowHandle
}

function Set-SfhForeground {
  param(
    [Parameter(Mandatory = $true)][IntPtr]$Hwnd,
    [switch]$Maximize
  )
  if ($Maximize -and -not [SfhWin]::IsZoomed($Hwnd)) {
    [void][SfhWin]::ShowWindow($Hwnd, [SfhWin]::SW_MAXIMIZE)
    Start-Sleep -Milliseconds 700
  }
  [SfhWin]::ForceForeground($Hwnd)
  Start-Sleep -Milliseconds 350
  if ([SfhWin]::GetForegroundWindow() -ne $Hwnd) {
    # Second attempt: some window managers need a maximize/activate cycle
    [void][SfhWin]::ShowWindow($Hwnd, [SfhWin]::SW_MAXIMIZE)
    [SfhWin]::ForceForeground($Hwnd)
    Start-Sleep -Milliseconds 350
  }
}

function Get-SfhWindowRect {
  param([Parameter(Mandatory = $true)][IntPtr]$Hwnd)
  $rect = New-Object SfhWin+RECT
  # Extended frame bounds exclude the invisible resize border that
  # GetWindowRect includes on a maximized window
  if ([SfhWin]::DwmGetWindowAttribute($Hwnd, [SfhWin]::DWMWA_EXTENDED_FRAME_BOUNDS, [ref]$rect, 16) -ne 0) {
    [void][SfhWin]::GetWindowRect($Hwnd, [ref]$rect)
  }
  return $rect
}
