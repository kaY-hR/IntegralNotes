@echo off
setlocal

pushd "%~dp0\.."
call npm run dist:win
set "EXIT_CODE=%ERRORLEVEL%"

if "%EXIT_CODE%"=="0" (
  echo.
  echo Installer artifacts were generated under out\.
)

popd
exit /b %EXIT_CODE%
