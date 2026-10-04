<#
.SYNOPSIS
Starts a program on a Windows desktop of its own, waits for it, and returns its exit code.

.DESCRIPTION
The UI test harness starts a real VS Code window (src/test/runUiTest.ts). On the desktop of the
person working, that window opens in front of their work and takes the focus, at every run.

A Windows session can hold several desktops, and only one is shown. A window created on another
desktop is never drawn on the one in use, never takes its focus, and is in no task bar. Every
process the program starts lands on that same desktop. The page is still rendered by Chromium,
so captures taken through the Chrome DevTools Protocol are the same.

Nothing here touches a window: no key sent, no pointer moved, no window activated or hidden.

.PARAMETER Executable
The program to start.

.PARAMETER Arguments
Its arguments, passed as they came.
#>
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string] $Executable,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $Arguments
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class HiddenDesktop
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateDesktopW(string name, IntPtr device, IntPtr devmode, int flags, uint access, IntPtr security);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool CloseDesktop(IntPtr desktop);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessW(string application, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string currentDirectory, ref STARTUPINFO startupInfo, out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int which);

    private const uint GENERIC_ALL = 0x10000000;
    private const int STARTF_USESTDHANDLES = 0x100;
    private const uint INFINITE = 0xFFFFFFFF;

    // Starts the command line on the named desktop of the interactive window station and waits.
    // Fails rather than falling back to the desktop in use: the point is that no window shows.
    public static int Run(string desktopName, string commandLine)
    {
        IntPtr desktop = CreateDesktopW(desktopName, IntPtr.Zero, IntPtr.Zero, 0, GENERIC_ALL, IntPtr.Zero);
        if (desktop == IntPtr.Zero)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateDesktop failed");
        }
        try
        {
            STARTUPINFO startup = new STARTUPINFO();
            startup.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            startup.lpDesktop = "WinSta0\\" + desktopName;
            // The output of the program goes where the output of this script goes
            startup.dwFlags = STARTF_USESTDHANDLES;
            startup.hStdInput = GetStdHandle(-10);
            startup.hStdOutput = GetStdHandle(-11);
            startup.hStdError = GetStdHandle(-12);
            PROCESS_INFORMATION process;
            if (!CreateProcessW(null, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, true, 0, IntPtr.Zero, null, ref startup, out process))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcess failed");
            }
            WaitForSingleObject(process.hProcess, INFINITE);
            uint exitCode;
            GetExitCodeProcess(process.hProcess, out exitCode);
            CloseHandle(process.hThread);
            CloseHandle(process.hProcess);
            return (int)exitCode;
        }
        finally
        {
            CloseDesktop(desktop);
        }
    }
}
"@

# One argument of a Windows command line: quoted when it holds a space or a quote, with the
# backslashes before a quote doubled, as CommandLineToArgvW reads them back
function ConvertTo-CommandLineArgument {
  param([string] $Value)
  if ($Value -ne "" -and $Value -notmatch '[\s"]') {
    return $Value
  }
  $escaped = $Value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1'
  return '"' + $escaped + '"'
}

$parts = @($Executable) + @($Arguments | Where-Object { $null -ne $_ })
$commandLine = ($parts | ForEach-Object { ConvertTo-CommandLineArgument $_ }) -join " "
$desktopName = if ($env:SFDX_HARDIS_UI_DESKTOP) { $env:SFDX_HARDIS_UI_DESKTOP } else { "sfdx-hardis-ui-harness" }

exit [HiddenDesktop]::Run($desktopName, $commandLine)
