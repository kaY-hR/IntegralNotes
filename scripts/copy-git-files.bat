@echo off
setlocal

rem Change TargetRoot in export-tracked-files.ps1 when reusing this script.
set "SCRIPT_DIR=%~dp0"
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%SCRIPT_DIR%export-tracked-files.ps1"
exit /b %ERRORLEVEL%
