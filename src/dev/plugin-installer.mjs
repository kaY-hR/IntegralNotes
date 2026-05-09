import path from "node:path";
import { promises as fs } from "node:fs";

import {
  installLocalPlugin,
  readPluginManifestFromDirectory,
  resolveIntegralNotesLocalDataPath,
  resolveIntegralNotesUserDataPath,
  resolveIntegralPluginInstallRootPath,
  sanitizePluginDirectoryName,
  uninstallLocalPlugin
} from "../../plugin-sdk/src/installer.js";

const PACKAGE_MANIFEST_FILENAME = "integral-package.json";

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
      if (await isPackageDirectory(pluginPath)) {
        const result = await installLocalPackage({
          packageRootPath: pluginPath,
          targetRootPath
        });

        console.log(
          `installed package ${result.manifest.id} -> ${result.installedPackagePath}`
        );
        continue;
      }

      const result = await installLocalPlugin({
        pluginRootPath: pluginPath,
        targetRootPath,
        userDataPath: effectiveUserDataPath
      });

      console.log(`installed ${result.manifest.id} -> ${result.installedPluginPath}`);
    }

    return;
  }

  if (command === "uninstall") {
    for (const pluginPath of pluginPaths) {
      if (await isPackageDirectory(pluginPath)) {
        const result = await uninstallLocalPackage({
          packageRootPath: pluginPath,
          targetRootPath
        });

        console.log(
          `${result.removed ? "removed" : "missing"} package ${result.packageId} -> ${result.installedPackagePath}`
        );
        continue;
      }

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
  const resolvedPackageRootPath = resolveIntegralPackageInstallRootPath(options);

  console.log(`userData: ${resolvedUserDataPath}`);
  console.log(`pluginRoot: ${resolvedTargetRootPath}`);
  console.log(`packageRoot: ${resolvedPackageRootPath}`);

  for (const pluginPath of pluginPaths) {
    const resolvedPluginPath = path.resolve(pluginPath);
    if (await isPackageDirectory(resolvedPluginPath)) {
      const manifest = await readPackageManifestFromDirectory(resolvedPluginPath);
      console.log(`${manifest.id}: ${path.join(resolvedPackageRootPath, sanitizePluginDirectoryName(manifest.id))}`);
      continue;
    }

    const manifest = await readPluginManifestFromDirectory(resolvedPluginPath);
    const directoryName = sanitizePluginDirectoryName(manifest.id);
    console.log(`${manifest.id}: ${path.join(resolvedTargetRootPath, directoryName)}`);
  }
}

async function installLocalPackage(options) {
  const packageRootPath = path.resolve(options.packageRootPath);
  const manifest = await readPackageManifestFromDirectory(packageRootPath);
  const targetRootPath = resolveIntegralPackageInstallRootPath(options);
  const targetDirectoryName = sanitizePluginDirectoryName(manifest.id);
  const installedPackagePath = path.join(targetRootPath, targetDirectoryName);

  await fs.mkdir(targetRootPath, { recursive: true });
  assertPathInsideRoot(targetRootPath, installedPackagePath);
  await fs.rm(installedPackagePath, { force: true, recursive: true });
  await fs.cp(packageRootPath, installedPackagePath, {
    filter: (sourcePath) => shouldCopyPackagePath(sourcePath, packageRootPath),
    force: true,
    recursive: true
  });

  return {
    installedPackagePath,
    manifest,
    packageRootPath,
    targetDirectoryName,
    targetRootPath
  };
}

async function uninstallLocalPackage(options) {
  const targetRootPath = resolveIntegralPackageInstallRootPath(options);
  const manifest = await readPackageManifestFromDirectory(options.packageRootPath);
  const packageId = manifest.id;
  const targetDirectoryName = sanitizePluginDirectoryName(packageId);
  const installedPackagePath = path.join(targetRootPath, targetDirectoryName);

  assertPathInsideRoot(targetRootPath, installedPackagePath);

  if (!(await pathExists(installedPackagePath))) {
    return {
      installedPackagePath,
      packageId,
      removed: false,
      targetDirectoryName,
      targetRootPath
    };
  }

  await fs.rm(installedPackagePath, { force: true, recursive: true });

  return {
    installedPackagePath,
    packageId,
    removed: true,
    targetDirectoryName,
    targetRootPath
  };
}

function resolveIntegralPackageInstallRootPath(options = {}) {
  const explicitTargetRoot = readNonEmptyString(options.targetRootPath);
  const envTargetRoot = readNonEmptyString(process.env.INTEGRALNOTES_PACKAGE_INSTALL_ROOT);

  if (explicitTargetRoot) {
    return path.resolve(explicitTargetRoot);
  }

  if (envTargetRoot) {
    return path.resolve(envTargetRoot);
  }

  return path.join(resolveIntegralNotesLocalDataPath(options), "packages");
}

async function isPackageDirectory(packageRootPath) {
  return pathExists(path.join(path.resolve(packageRootPath), PACKAGE_MANIFEST_FILENAME));
}

async function readPackageManifestFromDirectory(packageRootPath) {
  const manifestPath = path.join(path.resolve(packageRootPath), PACKAGE_MANIFEST_FILENAME);
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

  if (!manifest || typeof manifest !== "object" || typeof manifest.id !== "string") {
    throw new Error(`package manifest が不正です: ${manifestPath}`);
  }

  return manifest;
}

function shouldCopyPackagePath(sourcePath, packageRootPath) {
  const relativePath = path.relative(packageRootPath, sourcePath);

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

function assertPathInsideRoot(rootPath, targetPath) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  const relativePath = path.relative(resolvedRoot, resolvedTarget);

  if (relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))) {
    return;
  }

  throw new Error(`target path が install root の外です: ${resolvedTarget}`);
}

function readNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
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
