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
using System.Text;
using System.Runtime.InteropServices;

public class SfhWin {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr afterChild, string className, string windowTitle);
  [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr hWnd, ref POINT point);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", EntryPoint = "GetWindowThreadProcessId")] public static extern uint GetWindowProcessId(IntPtr hWnd, out uint pid);

  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

  // Visible top-level windows whose title contains the fragment. Get-Process only
  // reports one "main" window per process, and on some machines it reports none
  // for VS Code at all: enumerating the windows does not depend on that.
  public static IntPtr[] FindWindowsByTitle(string fragment) {
    System.Collections.Generic.List<IntPtr> found = new System.Collections.Generic.List<IntPtr>();
    EnumWindows((hWnd, lParam) => {
      if (IsWindowVisible(hWnd)) {
        StringBuilder title = new StringBuilder(512);
        GetWindowText(hWnd, title, title.Capacity);
        if (title.ToString().IndexOf(fragment, StringComparison.OrdinalIgnoreCase) >= 0) {
          found.Add(hWnd);
        }
      }
      return true;
    }, IntPtr.Zero);
    return found.ToArray();
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X, Y; }

  public const uint WM_MOUSEMOVE = 0x0200;
  public const uint WM_LBUTTONDOWN = 0x0201;
  public const uint WM_LBUTTONUP = 0x0202;
  public const uint WM_MOUSEWHEEL = 0x020A;
  public const int MK_LBUTTON = 0x0001;

  public static IntPtr MakeLParam(int x, int y) {
    return (IntPtr)((y << 16) | (x & 0xFFFF));
  }

  // Deepest child window under the given client point: Chromium renders in a
  // child HWND, and that is the window that handles the mouse messages
  public static IntPtr FindRenderWidget(IntPtr parent) {
    IntPtr intermediate = FindWindowEx(parent, IntPtr.Zero, "Intermediate D3D Window", null);
    IntPtr host = FindWindowEx(
      intermediate != IntPtr.Zero ? intermediate : parent,
      IntPtr.Zero, "Chrome_RenderWidgetHostHWND", null);
    return host != IntPtr.Zero ? host : parent;
  }
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out RECT value, int size);

  public const int SW_MAXIMIZE = 3;
  public const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
  // PrintWindow: render the whole window, including its DirectComposition
  // content. Unlike CopyFromScreen it also works on a locked session and
  // cannot capture another window that happens to be on top.
  public const uint PW_RENDERFULLCONTENT = 2;
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

# Handle cached by an earlier call of this run, when it is still a visible window of
# the same process. The cache is only good for the run that wrote it: Windows reuses
# handles, so an entry left by a previous VS Code can point at somebody else's window,
# and capturing it silently is worse than failing.
function Get-SfhCachedWindow {
  param([Parameter(Mandatory = $true)][string]$CacheFile)
  if (-not (Test-Path $CacheFile)) {
    return $null
  }
  $parts = ((Get-Content -Path $CacheFile -Raw).Trim() -split '\s+')
  if ($parts.Count -ne 2) {
    return $null
  }
  $cachedPid = [int]$parts[0]
  $cached = [IntPtr][int64]$parts[1]
  $ownerPid = [uint32]0
  if ([SfhWin]::IsWindow($cached) -and [SfhWin]::IsWindowVisible($cached)) {
    [void][SfhWin]::GetWindowProcessId($cached, [ref]$ownerPid)
  }
  if ($ownerPid -ne 0 -and $ownerPid -eq $cachedPid) {
    return $cached
  }
  return $null
}

function Get-SfhWindow {
  param([Parameter(Mandatory = $true)][string]$TitleMatch)
  # The handle is remembered between calls, because the title is not always
  # readable: while the extension host is busy VS Code reports an empty window
  # title, and a lookup by title then finds nothing at all. That state can last
  # longer than a panel takes to render (the Metadata Retriever queries the org
  # as it opens), and losing the screenshot over it is worse than reusing a
  # handle we already proved belongs to the right window.
  $cacheFile = Join-Path $env:TEMP ("sfh-window-" + ($TitleMatch -replace '[^A-Za-z0-9]', '_') + ".txt")
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $proc = Get-Process |
      Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$TitleMatch*" } |
      Select-Object -First 1
    if ($proc) {
      Set-Content -Path $cacheFile -Value ("$($proc.Id) " + [string][int64]$proc.MainWindowHandle) -Encoding ascii
      return $proc.MainWindowHandle
    }
    # A handle already proven to be the test VS Code wins over a new title match
    $proven = Get-SfhCachedWindow -CacheFile $cacheFile
    if ($proven) {
      return $proven
    }
    # Get-Process can miss the VS Code window entirely: look through the top-level windows,
    # and only accept one owned by a VS Code process (never a browser tab or an Explorer window
    # that happens to show the same title)
    foreach ($hwnd in [SfhWin]::FindWindowsByTitle($TitleMatch)) {
      $ownerPid = [uint32]0
      [void][SfhWin]::GetWindowProcessId($hwnd, [ref]$ownerPid)
      $owner = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
      if ($owner -and $owner.ProcessName -like "Code*") {
        Set-Content -Path $cacheFile -Value ("$ownerPid " + [string][int64]$hwnd) -Encoding ascii
        return $hwnd
      }
    }
    Start-Sleep -Milliseconds 500
  }
  Remove-Item -Path $cacheFile -Force -ErrorAction SilentlyContinue
  $seen = (Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } |
    ForEach-Object { "$($_.ProcessName): $($_.MainWindowTitle)" }) -join " | "
  throw "No window matching '$TitleMatch' was found. Open windows: $seen"
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

# Grabs the pixels of a window into a Bitmap. PrintWindow asks the window to
# render itself, so it works even when the session is locked or the window is
# partly covered; screen copy is only the fallback.
function Get-SfhWindowBitmap {
  param(
    [Parameter(Mandatory = $true)][IntPtr]$Hwnd,
    [Parameter(Mandatory = $true)]$Rect,
    [int]$CropTop = 0,
    [int]$CropLeft = 0,
    [int]$CropRight = 0,
    [int]$CropBottom = 0
  )
  # PrintWindow renders from the window origin as GetWindowRect sees it, which
  # includes the invisible resize border; $Rect is the visible frame (DWM
  # extended bounds). The difference between the two is the offset of the
  # visible frame inside the rendered bitmap.
  $windowRect = New-Object SfhWin+RECT
  [void][SfhWin]::GetWindowRect($Hwnd, [ref]$windowRect)
  $renderWidth = $windowRect.Right - $windowRect.Left
  $renderHeight = $windowRect.Bottom - $windowRect.Top
  $frameLeft = $Rect.Left - $windowRect.Left
  $frameTop = $Rect.Top - $windowRect.Top

  $left = $frameLeft + $CropLeft
  $top = $frameTop + $CropTop
  $width = ($Rect.Right - $Rect.Left) - $CropLeft - $CropRight
  $height = ($Rect.Bottom - $Rect.Top) - $CropTop - $CropBottom
  if ($width -le 0 -or $height -le 0) {
    throw "Invalid capture size ${width}x${height}"
  }

  $full = New-Object System.Drawing.Bitmap $renderWidth, $renderHeight
  $graphics = [System.Drawing.Graphics]::FromImage($full)
  $hdc = $graphics.GetHdc()
  $printed = [SfhWin]::PrintWindow($Hwnd, $hdc, [SfhWin]::PW_RENDERFULLCONTENT)
  $graphics.ReleaseHdc($hdc)
  if (-not $printed) {
    try {
      # Screen copy fallback: the pixels are then at the visible frame position
      $graphics.CopyFromScreen($windowRect.Left, $windowRect.Top, 0, 0, $full.Size)
    }
    catch {
      $graphics.Dispose()
      $full.Dispose()
      throw "Window capture failed (PrintWindow and screen copy)"
    }
  }
  $graphics.Dispose()

  $cropped = $full.Clone(
    (New-Object System.Drawing.Rectangle $left, $top, $width, $height),
    $full.PixelFormat
  )
  $full.Dispose()
  return $cropped
}

# Clicks (or scrolls) at a point of the window without touching the physical
# cursor: the mouse messages are posted to the Chromium render widget. This is
# the only way that works when the session is locked, where a window cannot be
# brought to the foreground.
function Send-SfhWindowClick {
  param(
    [Parameter(Mandatory = $true)][IntPtr]$Hwnd,
    [Parameter(Mandatory = $true)][int]$ScreenX,
    [Parameter(Mandatory = $true)][int]$ScreenY,
    [int]$Scroll = 0
  )
  $target = [SfhWin]::FindRenderWidget($Hwnd)
  $point = New-Object SfhWin+POINT
  $point.X = $ScreenX
  $point.Y = $ScreenY
  [void][SfhWin]::ScreenToClient($target, [ref]$point)
  $lParam = [SfhWin]::MakeLParam($point.X, $point.Y)

  if ($Scroll -ne 0) {
    # WM_MOUSEWHEEL takes screen coordinates and the delta in the high word
    $wheelLParam = [SfhWin]::MakeLParam($ScreenX, $ScreenY)
    $wParam = [IntPtr](($Scroll * 120) -shl 16)
    [void][SfhWin]::PostMessage($target, [SfhWin]::WM_MOUSEWHEEL, $wParam, $wheelLParam)
    return
  }

  [void][SfhWin]::PostMessage($target, [SfhWin]::WM_MOUSEMOVE, [IntPtr]::Zero, $lParam)
  Start-Sleep -Milliseconds 40
  [void][SfhWin]::PostMessage($target, [SfhWin]::WM_LBUTTONDOWN, [IntPtr][SfhWin]::MK_LBUTTON, $lParam)
  Start-Sleep -Milliseconds 60
  [void][SfhWin]::PostMessage($target, [SfhWin]::WM_LBUTTONUP, [IntPtr]::Zero, $lParam)
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
