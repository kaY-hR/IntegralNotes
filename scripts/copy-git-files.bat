@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%SCRIPT_DIR%export-tracked-files.ps1" %*
exit /b %ERRORLEVEL%
