import path from "node:path";

import {
  installLocalPlugin,
  readPluginManifestFromDirectory,
  resolveIntegralNotesUserDataPath,
  resolveIntegralPluginInstallRootPath,
  sanitizePluginDirectoryName,
  uninstallLocalPlugin
} from "../../plugin-sdk/src/installer.js";

async function main() {
  const { command, pluginPaths, targetRootPath, userDataPath } = parseArgs(process.argv.slice(2));
  const effectiveUserDataPath = userDataPath ?? resolveDefaultDevUserDataPath();

  if (command === "where") {
    await handleWhere(pluginPaths, { targetRootPath, userDataPath: effectiveUserDataPath });
    return;
  }

  if (pluginPaths.length === 0) {
    throw new Error("plugin path を 1 つ以上指定してください。");
  }

  if (command === "install") {
    for (const pluginPath of pluginPaths) {
      const result = await installLocalPlugin({
        pluginRootPath: pluginPath,
        targetRootPath,
        userDataPath: effectiveUserDataPath
      });

      console.log(
        `installed ${result.manifest.id} -> ${result.installedPluginPath}`
      );
    }

    return;
  }

  if (command === "uninstall") {
    for (const pluginPath of pluginPaths) {
      const result = await uninstallLocalPlugin({
        pluginRootPath: pluginPath,
        targetRootPath,
        userDataPath: effectiveUserDataPath
      });

      console.log(
        `${result.removed ? "removed" : "missing"} ${result.pluginId} -> ${result.installedPluginPath}`
      );
    }

    return;
  }

  throw new Error(`未対応の command です: ${command}`);
}

function resolveDefaultDevUserDataPath() {
  if (process.env.INTEGRALNOTES_USER_DATA_DIR?.trim()) {
    return process.env.INTEGRALNOTES_USER_DATA_DIR.trim();
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA?.trim() || path.join(process.env.USERPROFILE || "", "AppData", "Roaming");
    return path.join(appData, "IntegralNotes-dev");
  }

  return undefined;
}

async function handleWhere(pluginPaths, options) {
  const resolvedUserDataPath = resolveIntegralNotesUserDataPath(options);
  const resolvedTargetRootPath = resolveIntegralPluginInstallRootPath(options);

  console.log(`userData: ${resolvedUserDataPath}`);
  console.log(`pluginRoot: ${resolvedTargetRootPath}`);

  for (const pluginPath of pluginPaths) {
    const resolvedPluginPath = path.resolve(pluginPath);
    const manifest = await readPluginManifestFromDirectory(resolvedPluginPath);
    const directoryName = sanitizePluginDirectoryName(manifest.id);
    console.log(`${manifest.id}: ${path.join(resolvedTargetRootPath, directoryName)}`);
  }
}

function parseArgs(args) {
  const [command = "where", ...rest] = args;
  const pluginPaths = [];
  let targetRootPath;
  let userDataPath;

  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];

    if (value === "--target-root") {
      targetRootPath = readNextValue(rest, ++index, "--target-root");
      continue;
    }

    if (value === "--user-data") {
      userDataPath = readNextValue(rest, ++index, "--user-data");
      continue;
    }

    pluginPaths.push(value);
  }

  return {
    command,
    pluginPaths,
    targetRootPath,
    userDataPath
  };
}

function readNextValue(args, index, optionName) {
  const value = args[index];

  if (!value || value.startsWith("--")) {
    throw new Error(`${optionName} の値が必要です。`);
  }

  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
