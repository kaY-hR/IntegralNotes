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

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: node was not found in PATH.
  exit /b 1
)

if not exist "%ROOT%\src\dev\integral-playwright-mcp.mjs" (
  echo ERROR: src\dev\integral-playwright-mcp.mjs was not found.
  echo Run this script from the IntegralNotes worktree root.
  exit /b 1
)

if not exist "%ROOT%\node_modules\@modelcontextprotocol\sdk" (
  echo ERROR: node_modules is not ready.
  echo Run npm install before registering this MCP server.
  exit /b 1
)

call node "%ROOT%\src\dev\ensure-local-dev-config.cjs"
if errorlevel 1 (
  echo.
  echo ERROR: failed to prepare local dev config.
  exit /b 1
)

echo.
echo Registering Codex MCP server:
echo   name: %MCP_NAME%
echo   root: %ROOT%
echo.

call codex mcp remove "%MCP_NAME%" >nul 2>nul
call codex mcp add "%MCP_NAME%" -- node "%ROOT%\src\dev\integral-playwright-mcp.mjs"
if errorlevel 1 (
  echo.
  echo ERROR: failed to register Codex MCP server.
  exit /b 1
)

echo.
echo Registered.
echo Restart Codex, then use MCP server "%MCP_NAME%".
