import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { PLUGIN_MANIFEST_FILENAME } from "./manifest.js";

export const INTEGRAL_NOTES_PRODUCT_NAME = "IntegralNotes";
export const INTEGRAL_NOTES_PLUGIN_DIRECTORY = "runtime-plugins";

export async function installLocalPlugin(options) {
  const pluginRootPath = path.resolve(options.pluginRootPath);
  const manifest = await readPluginManifestFromDirectory(pluginRootPath);
  const targetRootPath = resolveIntegralPluginInstallRootPath(options);
  const targetDirectoryName =
    options.targetDirectoryName ?? sanitizePluginDirectoryName(manifest.id);
  const installedPluginPath = path.join(targetRootPath, targetDirectoryName);

  await fs.mkdir(targetRootPath, { recursive: true });
  assertPathInsideRoot(targetRootPath, installedPluginPath);
  await removeDirectoryIfExists(installedPluginPath);
  await fs.cp(pluginRootPath, installedPluginPath, {
    filter: (sourcePath) => shouldCopyPluginPath(sourcePath, pluginRootPath),
    force: true,
    recursive: true
  });

  return {
    installedPluginPath,
    manifest,
    pluginRootPath,
    targetDirectoryName,
    targetRootPath
  };
}

export async function uninstallLocalPlugin(options) {
  const targetRootPath = resolveIntegralPluginInstallRootPath(options);
  const pluginId = await resolvePluginId(options);
  const targetDirectoryName =
    options.targetDirectoryName ?? sanitizePluginDirectoryName(pluginId);
  const installedPluginPath = path.join(targetRootPath, targetDirectoryName);

  assertPathInsideRoot(targetRootPath, installedPluginPath);

  if (!(await pathExists(installedPluginPath))) {
    return {
      installedPluginPath,
      pluginId,
      removed: false,
      targetDirectoryName,
      targetRootPath
    };
  }

  await fs.rm(installedPluginPath, { force: true, recursive: true });

  return {
    installedPluginPath,
    pluginId,
    removed: true,
    targetDirectoryName,
    targetRootPath
  };
}

export async function readPluginManifestFromDirectory(pluginRootPath) {
  const manifestPath = path.join(path.resolve(pluginRootPath), PLUGIN_MANIFEST_FILENAME);
  const content = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(content);

  if (!isManifestLike(manifest)) {
    throw new Error(`plugin manifest が不正です: ${manifestPath}`);
  }

  return manifest;
}

export function resolveIntegralPluginInstallRootPath(options = {}) {
  const explicitTargetRoot = readNonEmptyString(options.targetRootPath);
  const envTargetRoot = readNonEmptyString(options.env?.INTEGRALNOTES_PLUGIN_INSTALL_ROOT);

  if (explicitTargetRoot) {
    return path.resolve(explicitTargetRoot);
  }

  if (envTargetRoot) {
    return path.resolve(envTargetRoot);
  }

  return path.join(resolveIntegralNotesLocalDataPath(options), INTEGRAL_NOTES_PLUGIN_DIRECTORY);
}

export function resolveIntegralNotesUserDataPath(options = {}) {
  const explicitUserDataPath = readNonEmptyString(options.userDataPath);
  const envUserDataPath = readNonEmptyString(options.env?.INTEGRALNOTES_USER_DATA_PATH);

  if (explicitUserDataPath) {
    return path.resolve(explicitUserDataPath);
  }

  if (envUserDataPath) {
    return path.resolve(envUserDataPath);
  }

  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDirectory = options.homeDirectory ?? os.homedir();

  if (platform === "win32") {
    const appData = readNonEmptyString(env.APPDATA) ?? path.join(homeDirectory, "AppData", "Roaming");
    return path.join(appData, INTEGRAL_NOTES_PRODUCT_NAME);
  }

  if (platform === "darwin") {
    return path.join(homeDirectory, "Library", "Application Support", INTEGRAL_NOTES_PRODUCT_NAME);
  }

  const xdgConfigHome =
    readNonEmptyString(env.XDG_CONFIG_HOME) ?? path.join(homeDirectory, ".config");
  return path.join(xdgConfigHome, INTEGRAL_NOTES_PRODUCT_NAME);
}

export function resolveIntegralNotesLocalDataPath(options = {}) {
  const explicitLocalDataPath = readNonEmptyString(options.localDataPath);
  const envLocalDataPath = readNonEmptyString(options.env?.INTEGRALNOTES_LOCAL_DATA_PATH);

  if (explicitLocalDataPath) {
    return path.resolve(explicitLocalDataPath);
  }

  if (envLocalDataPath) {
    return path.resolve(envLocalDataPath);
  }

  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDirectory = options.homeDirectory ?? os.homedir();

  if (platform === "win32") {
    const localAppData =
      readNonEmptyString(env.LOCALAPPDATA) ?? path.join(homeDirectory, "AppData", "Local");
    return path.join(localAppData, INTEGRAL_NOTES_PRODUCT_NAME);
  }

  if (platform === "darwin") {
    return path.join(homeDirectory, "Library", "Application Support", INTEGRAL_NOTES_PRODUCT_NAME);
  }

  const xdgDataHome =
    readNonEmptyString(env.XDG_DATA_HOME) ?? path.join(homeDirectory, ".local", "share");
  return path.join(xdgDataHome, INTEGRAL_NOTES_PRODUCT_NAME);
}

export function sanitizePluginDirectoryName(pluginId) {
  const sanitized = pluginId.trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-");

  if (sanitized.length === 0) {
    throw new Error("plugin id から install directory 名を生成できません。");
  }

  return sanitized;
}

async function resolvePluginId(options) {
  if (readNonEmptyString(options.pluginId)) {
    return options.pluginId.trim();
  }

  if (readNonEmptyString(options.pluginRootPath)) {
    const manifest = await readPluginManifestFromDirectory(options.pluginRootPath);
    return manifest.id;
  }

  throw new Error("pluginId または pluginRootPath が必要です。");
}

function shouldCopyPluginPath(sourcePath, pluginRootPath) {
  const relativePath = path.relative(pluginRootPath, sourcePath);

  if (relativePath === "") {
    return true;
  }

  const segments = relativePath.split(path.sep);

  return !segments.some((segment) =>
    segment === "node_modules" ||
    segment === ".git" ||
    segment === ".DS_Store" ||
    segment === "Thumbs.db"
  );
}

function assertPathInsideRoot(rootPath, targetPath) {
  const resolvedRootPath = path.resolve(rootPath);
  const resolvedTargetPath = path.resolve(targetPath);
  const relativePath = path.relative(resolvedRootPath, resolvedTargetPath);

  if (
    relativePath.length === 0 ||
    relativePath === "." ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`plugin install path が不正です: ${resolvedTargetPath}`);
  }
}

async function removeDirectoryIfExists(targetPath) {
  if (!(await pathExists(targetPath))) {
    return;
  }

  await fs.rm(targetPath, { force: true, recursive: true });
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function isManifestLike(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.id === "string" &&
    value.id.trim().length > 0
  );
}

function readNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
