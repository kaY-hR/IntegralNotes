@echo off
setlocal

set "SOURCE_DIR=%~dp0"
if "%SOURCE_DIR:~-1%"=="\" set "SOURCE_DIR=%SOURCE_DIR:~0,-1%"
set "TARGET_DIR=%LocalAppData%\IntegralNotes\plugins\dummy-vendor"

if "%LocalAppData%"=="" (
  echo LocalAppData is not defined.
  exit /b 1
)

echo Installing Dummy Vendor plugin...
echo Source: %SOURCE_DIR%
echo Target: %TARGET_DIR%

if not exist "%SOURCE_DIR%\blocks\demo_report.py" (
  echo Source file is missing: %SOURCE_DIR%\blocks\demo_report.py
  exit /b 1
)

if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"
if errorlevel 1 (
  echo Failed to create target directory: %TARGET_DIR%
  exit /b 1
)

if not exist "%TARGET_DIR%\blocks" mkdir "%TARGET_DIR%\blocks"
if errorlevel 1 (
  echo Failed to create target directory: %TARGET_DIR%\blocks
  exit /b 1
)

copy /Y "%SOURCE_DIR%\README.md" "%TARGET_DIR%\README.md" >nul
if errorlevel 1 (
  echo Failed to copy README.md
  exit /b 1
)

copy /Y "%SOURCE_DIR%\install-localappdata.bat" "%TARGET_DIR%\install-localappdata.bat" >nul
if errorlevel 1 (
  echo Failed to copy install-localappdata.bat
  exit /b 1
)

copy /Y "%SOURCE_DIR%\blocks\demo_report.py" "%TARGET_DIR%\blocks\demo_report.py" >nul
if errorlevel 1 (
  echo Failed to copy blocks\demo_report.py
  exit /b 1
)

echo Installed Dummy Vendor plugin to:
echo %TARGET_DIR%
exit /b 0
