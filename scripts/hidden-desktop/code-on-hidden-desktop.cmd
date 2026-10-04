@echo off
rem VS Code of the UI test harness, started on a Windows desktop of its own: see run-on-hidden-desktop.ps1
rem SFDX_HARDIS_UI_CODE_EXE is the real executable, set by src/test/runUiTest.ts
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0run-on-hidden-desktop.ps1" "%SFDX_HARDIS_UI_CODE_EXE%" %*
exit /b %ERRORLEVEL%
