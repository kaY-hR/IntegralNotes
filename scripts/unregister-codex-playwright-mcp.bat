@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%CD%"
for %%I in ("%ROOT%") do set "WORKTREE_NAME=%%~nxI"
set "MCP_NAME=integralnotes-playwright-%WORKTREE_NAME%"

if not "%~1"=="" (
  set "MCP_NAME=%~1"
)

where codex >nul 2>nul
if errorlevel 1 (
  echo ERROR: codex CLI was not found in PATH.
  exit /b 1
)

echo Removing Codex MCP server:
echo   name: %MCP_NAME%
echo.

call codex mcp remove "%MCP_NAME%"
if errorlevel 1 (
  echo.
  echo ERROR: failed to remove Codex MCP server.
  exit /b 1
)

echo.
echo Removed.
