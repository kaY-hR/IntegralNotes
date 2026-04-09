import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  readPluginManifestFromDirectory,
  sanitizePluginDirectoryName
} from "../../plugin-sdk/src/installer.js";

async function main() {
  const { command, outRootPath, pluginPaths } = parseArgs(process.argv.slice(2));

  if (command !== "package") {
    throw new Error(`未対応の command です: ${command}`);
  }

  if (pluginPaths.length === 0) {
    throw new Error("plugin path を 1 つ以上指定してください。");
  }

  for (const pluginPath of pluginPaths) {
    const result = await packagePlugin(pluginPath, outRootPath);
    console.log(`packaged ${result.pluginId} -> ${result.outputDirectoryPath}`);
  }
}

async function packagePlugin(pluginPath, outRootPath) {
  const pluginRootPath = path.resolve(pluginPath);
  const manifest = await readPluginManifestFromDirectory(pluginRootPath);
  const pluginId = manifest.id;
  const pluginDirectoryName = sanitizePluginDirectoryName(pluginId);
  const pluginVersion = readVersion(manifest);
  const zipFileName = `${pluginDirectoryName}-${pluginVersion}.zip`;
  const installScriptName = `install-${pluginDirectoryName}.bat`;
  const uninstallScriptName = `uninstall-${pluginDirectoryName}.bat`;
  const outputDirectoryPath = path.resolve(outRootPath, pluginDirectoryName);
  const stagingRootPath = path.join(outputDirectoryPath, ".staging");
  const stagedPluginParentPath = path.join(stagingRootPath, `${pluginDirectoryName}-${pluginVersion}`);
  const stagedPluginRootPath = path.join(stagedPluginParentPath, pluginDirectoryName);
  const zipPath = path.join(outputDirectoryPath, zipFileName);

  await fs.rm(outputDirectoryPath, { force: true, recursive: true });
  await fs.mkdir(stagedPluginRootPath, { recursive: true });
  await copyPluginDirectory(pluginRootPath, stagedPluginRootPath);
  await compressPluginDirectory(stagedPluginRootPath, zipPath);
  await fs.writeFile(
    path.join(outputDirectoryPath, installScriptName),
    buildInstallBat({
      pluginDirectoryName,
      pluginId,
      zipFileName
    }),
    "utf8"
  );
  await fs.writeFile(
    path.join(outputDirectoryPath, uninstallScriptName),
    buildUninstallBat({
      pluginDirectoryName,
      pluginId
    }),
    "utf8"
  );
  await fs.rm(stagingRootPath, { force: true, recursive: true });

  return {
    outputDirectoryPath,
    pluginId,
    zipPath
  };
}

async function copyPluginDirectory(sourcePath, destinationPath) {
  await fs.cp(sourcePath, destinationPath, {
    filter: (currentSourcePath) => shouldCopyPath(currentSourcePath, sourcePath),
    force: true,
    recursive: true
  });
}

async function compressPluginDirectory(sourcePath, zipPath) {
  await fs.mkdir(path.dirname(zipPath), { recursive: true });

  if (process.platform !== "win32") {
    throw new Error("plugin package builder は現在 Windows のみ対応しています。");
  }

  await new Promise((resolve, reject) => {
    const command = [
      `Compress-Archive -LiteralPath ${toPowerShellLiteral(sourcePath)}`,
      `-DestinationPath ${toPowerShellLiteral(zipPath)}`,
      "-Force"
    ].join(" ");

    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        command
      ],
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }

        resolve();
      }
    );
  });
}

function parseArgs(args) {
  const [command = "package", ...rest] = args;
  const pluginPaths = [];
  let outRootPath = "plugins/dist";

  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];

    if (value === "--out-root") {
      outRootPath = readNextValue(rest, ++index, "--out-root");
      continue;
    }

    pluginPaths.push(value);
  }

  return {
    command,
    outRootPath,
    pluginPaths
  };
}

function readNextValue(args, index, optionName) {
  const value = args[index];

  if (!value || value.startsWith("--")) {
    throw new Error(`${optionName} の値が必要です。`);
  }

  return value;
}

function readVersion(manifest) {
  return typeof manifest.version === "string" && manifest.version.trim().length > 0
    ? manifest.version.trim()
    : "0.0.0";
}

function shouldCopyPath(currentSourcePath, pluginRootPath) {
  const relativePath = path.relative(pluginRootPath, currentSourcePath);

  if (relativePath === "") {
    return true;
  }

  const segments = relativePath.split(path.sep);

  return !segments.some((segment) =>
    segment === "node_modules" ||
    segment === ".git" ||
    segment === ".DS_Store" ||
    segment === "Thumbs.db" ||
    segment === "dist"
  );
}

function buildInstallBat({ pluginDirectoryName, pluginId, zipFileName }) {
  return [
    "@echo off",
    "setlocal",
    'set "SCRIPT_DIR=%~dp0"',
    `set "ZIP_PATH=%SCRIPT_DIR%${zipFileName}"`,
    'set "INSTALL_ROOT=%APPDATA%\\IntegralNotes\\plugins"',
    `set "TARGET_DIR=%INSTALL_ROOT%\\${pluginDirectoryName}"`,
    `set "PLUGIN_FOLDER=${pluginDirectoryName}"`,
    `set "PLUGIN_ID=${pluginId}"`,
    'set "TEMP_ROOT=%TEMP%\\IntegralNotesPluginInstall\\%PLUGIN_FOLDER%-%RANDOM%%RANDOM%"',
    'echo Installing %PLUGIN_ID% to "%TARGET_DIR%"...',
    "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^",
    '  "$ErrorActionPreference=\'Stop\'; $zip=$env:ZIP_PATH; $pluginFolder=$env:PLUGIN_FOLDER; $target=$env:TARGET_DIR; $tempRoot=$env:TEMP_ROOT; New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null; Expand-Archive -LiteralPath $zip -DestinationPath $tempRoot -Force; $source=Join-Path $tempRoot $pluginFolder; if (!(Test-Path -LiteralPath $source)) { throw \'plugin folder not found in zip.\' }; $installRoot=Split-Path -Parent $target; New-Item -ItemType Directory -Force -Path $installRoot | Out-Null; if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force; }; Copy-Item -LiteralPath $source -Destination $target -Recurse -Force; Remove-Item -LiteralPath $tempRoot -Recurse -Force;"',
    "if errorlevel 1 goto error",
    'echo Installed %PLUGIN_ID%.',
    "exit /b 0",
    ":error",
    'echo Failed to install %PLUGIN_ID%.',
    "exit /b 1",
    ""
  ].join("\r\n");
}

function buildUninstallBat({ pluginDirectoryName, pluginId }) {
  return [
    "@echo off",
    "setlocal",
    'set "INSTALL_ROOT=%APPDATA%\\IntegralNotes\\plugins"',
    `set "TARGET_DIR=%INSTALL_ROOT%\\${pluginDirectoryName}"`,
    `set "PLUGIN_ID=${pluginId}"`,
    'echo Removing %PLUGIN_ID% from "%TARGET_DIR%"...',
    "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^",
    '  "$ErrorActionPreference=\'Stop\'; $target=$env:TARGET_DIR; if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force; }"',
    "if errorlevel 1 goto error",
    'echo Removed %PLUGIN_ID%.',
    "exit /b 0",
    ":error",
    'echo Failed to remove %PLUGIN_ID%.',
    "exit /b 1",
    ""
  ].join("\r\n");
}

function toPowerShellLiteral(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
