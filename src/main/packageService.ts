import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  INTEGRAL_PACKAGE_MANIFEST_FILENAME,
  isSafePackageId,
  parseIntegralPackageManifestText,
  parsePythonBlockExport,
  type IntegralPackageManifest
} from "../shared/packages";
import { getIntegralPackageRootPath } from "./pathTokens";

export interface ResolvedIntegralPackage {
  manifest: IntegralPackageManifest;
  manifestPath: string;
  rootPath: string;
}

export interface PackagePythonBlockExport {
  blockType: string;
  functionName: string;
  importedRootPath: string;
  manifest: IntegralPackageManifest;
  packageRootPath: string;
  scriptPath: string;
  sourceScriptPath: string;
  workspaceScriptPath: string;
}

export interface PackageRuntimePluginRoot {
  packageId: string;
  rootPath: string;
}

const WORKSPACE_PACKAGES_DIRECTORY = ".packages";

export async function readInstalledIntegralPackages(
  packageRootPath = getIntegralPackageRootPath()
): Promise<ResolvedIntegralPackage[]> {
  if (!packageRootPath) {
    return [];
  }

  return readPackagesFromRoot(packageRootPath);
}

export async function readWorkspaceImportedIntegralPackages(
  workspaceRootPath: string
): Promise<ResolvedIntegralPackage[]> {
  return readPackagesFromRoot(path.join(workspaceRootPath, WORKSPACE_PACKAGES_DIRECTORY));
}

export async function listExportedPackageSkillRootPaths(): Promise<string[]> {
  const packages = await readInstalledIntegralPackages();
  const roots: string[] = [];

  for (const resolvedPackage of packages) {
    for (const skillPath of resolvedPackage.manifest.exports.skills) {
      roots.push(path.join(resolvedPackage.rootPath, ...skillPath.split("/")));
    }
  }

  return roots;
}

export async function listExportedPackageRuntimePluginRootPaths(
  packageRootPath = getIntegralPackageRootPath()
): Promise<string[]> {
  const roots = await listExportedPackageRuntimePluginRoots(packageRootPath);

  return roots.map((item) => item.rootPath);
}

export async function listExportedPackageRuntimePluginRoots(
  packageRootPath = getIntegralPackageRootPath()
): Promise<PackageRuntimePluginRoot[]> {
  const packages = await readInstalledIntegralPackages(packageRootPath);
  const roots: PackageRuntimePluginRoot[] = [];

  for (const resolvedPackage of packages) {
    for (const pluginPath of resolvedPackage.manifest.exports.runtimePlugins) {
      roots.push({
        packageId: resolvedPackage.manifest.id,
        rootPath: path.join(resolvedPackage.rootPath, ...pluginPath.split("/"))
      });
    }
  }

  return roots;
}

export async function listPackagePythonBlockExports(
  workspaceRootPath: string
): Promise<PackagePythonBlockExport[]> {
  const [installedPackages, importedPackages] = await Promise.all([
    readInstalledIntegralPackages(),
    readWorkspaceImportedIntegralPackages(workspaceRootPath)
  ]);
  const installedById = new Map(installedPackages.map((item) => [item.manifest.id, item]));
  const packagesById = new Map<string, ResolvedIntegralPackage>();

  for (const installedPackage of installedPackages) {
    packagesById.set(installedPackage.manifest.id, installedPackage);
  }

  for (const importedPackage of importedPackages) {
    packagesById.set(importedPackage.manifest.id, importedPackage);
  }

  const exports: PackagePythonBlockExport[] = [];

  for (const resolvedPackage of packagesById.values()) {
    const installedPackage = installedById.get(resolvedPackage.manifest.id);
    const stockPackageRootPath = installedPackage?.rootPath ?? resolvedPackage.rootPath;
    const importedRootPath = resolveWorkspacePackageRootPath(
      workspaceRootPath,
      resolvedPackage.manifest.id
    );

    for (const exportValue of resolvedPackage.manifest.exports.pythonBlocks) {
      const parsed = parsePythonBlockExport(exportValue);

      if (!parsed) {
        continue;
      }

      const workspaceScriptPath = normalizeWorkspacePackageScriptPath(
        resolvedPackage.manifest.id,
        parsed.scriptPath
      );
      exports.push({
        blockType: `${workspaceScriptPath}:${parsed.functionName}`,
        functionName: parsed.functionName,
        importedRootPath,
        manifest: resolvedPackage.manifest,
        packageRootPath: stockPackageRootPath,
        scriptPath: parsed.scriptPath,
        sourceScriptPath: path.join(stockPackageRootPath, ...parsed.scriptPath.split("/")),
        workspaceScriptPath
      });
    }
  }

  return exports;
}

export async function importPackageScriptsForPythonBlock(
  workspaceRootPath: string,
  blockType: string,
  options: {
    overwrite: boolean;
  }
): Promise<{
  importedRootPath: string;
  packageId: string;
}> {
  const candidate = await findPackagePythonBlockExport(workspaceRootPath, blockType);

  if (!candidate) {
    throw new Error(`package Python block が見つかりません: ${blockType}`);
  }

  const targetRootPath = candidate.importedRootPath;
  const targetManifestPath = path.join(targetRootPath, INTEGRAL_PACKAGE_MANIFEST_FILENAME);
  const sourceSharedPath = path.join(candidate.packageRootPath, "shared");
  const sourceScriptsPath = path.join(candidate.packageRootPath, "scripts");
  const targetSharedPath = path.join(targetRootPath, "shared");
  const targetScriptsPath = path.join(targetRootPath, "scripts");

  if (await pathExists(targetRootPath)) {
    if (!options.overwrite) {
      throw new Error(`package は既に import 済みです: ${candidate.manifest.id}`);
    }

    await fs.rm(targetRootPath, { force: true, recursive: true });
  }

  await fs.mkdir(targetRootPath, { recursive: true });
  await fs.copyFile(candidate.manifestPath ?? path.join(candidate.packageRootPath, INTEGRAL_PACKAGE_MANIFEST_FILENAME), targetManifestPath);

  if (await pathExists(sourceScriptsPath)) {
    await fs.cp(sourceScriptsPath, targetScriptsPath, { force: true, recursive: true });
  } else {
    await fs.mkdir(targetScriptsPath, { recursive: true });
  }

  if (await pathExists(sourceSharedPath)) {
    await fs.cp(sourceSharedPath, targetSharedPath, { force: true, recursive: true });
  }

  return {
    importedRootPath: targetRootPath,
    packageId: candidate.manifest.id
  };
}

export async function importIntegralPackageToWorkspace(
  workspaceRootPath: string,
  packageId: string,
  options: {
    overwrite: boolean;
  }
): Promise<{
  importedRootPath: string;
  packageId: string;
}> {
  const installedPackage = await readInstalledIntegralPackageById(packageId);

  if (!installedPackage) {
    throw new Error(`global package が見つかりません: ${packageId}`);
  }

  const targetRootPath = resolveWorkspacePackageRootPath(workspaceRootPath, installedPackage.manifest.id);

  await copyPackageRuntimeAssetsToWorkspace(installedPackage, targetRootPath, options);

  return {
    importedRootPath: targetRootPath,
    packageId: installedPackage.manifest.id
  };
}

export async function removeWorkspaceImportedIntegralPackage(
  workspaceRootPath: string,
  packageId: string
): Promise<{
  importedRootPath: string;
  packageId: string;
  removed: boolean;
}> {
  assertSafePackageId(packageId);

  const workspacePackagesRootPath = path.join(workspaceRootPath, WORKSPACE_PACKAGES_DIRECTORY);
  const importedRootPath = path.join(workspacePackagesRootPath, packageId);

  assertPathInsideRoot(workspacePackagesRootPath, importedRootPath);

  if (!(await pathExists(importedRootPath))) {
    return {
      importedRootPath,
      packageId,
      removed: false
    };
  }

  await fs.rm(importedRootPath, { force: true, recursive: true });

  return {
    importedRootPath,
    packageId,
    removed: true
  };
}

export async function installIntegralPackageFromSource(
  sourceRootPath: string,
  packageRootPath = getIntegralPackageRootPath()
): Promise<ResolvedIntegralPackage> {
  if (!packageRootPath) {
    throw new Error("%LocalAppData% を解決できません。");
  }

  const packageSourceRootPath = await resolveIntegralPackageSourceRootPath(path.resolve(sourceRootPath));
  const resolvedPackage = await readPackageDirectory(packageSourceRootPath);

  if (!resolvedPackage) {
    throw new Error(`package manifest が不正です: ${packageSourceRootPath}`);
  }

  const targetDirectoryName = sanitizePackageDirectoryName(resolvedPackage.manifest.id);
  const installedPackagePath = path.join(packageRootPath, targetDirectoryName);

  assertPathInsideRoot(packageRootPath, installedPackagePath);

  if (path.resolve(packageSourceRootPath) !== path.resolve(installedPackagePath)) {
    await fs.mkdir(packageRootPath, { recursive: true });
    await fs.rm(installedPackagePath, { force: true, recursive: true });
    await fs.cp(packageSourceRootPath, installedPackagePath, {
      filter: (sourcePath) => shouldCopyPackagePath(sourcePath, packageSourceRootPath),
      force: true,
      recursive: true
    });
  }

  const installedPackage = await readPackageDirectory(installedPackagePath);

  if (!installedPackage) {
    throw new Error(`package install 後の読込に失敗しました: ${resolvedPackage.manifest.id}`);
  }

  return installedPackage;
}

export async function installIntegralPackageFromArchive(
  archivePath: string,
  packageRootPath = getIntegralPackageRootPath()
): Promise<ResolvedIntegralPackage> {
  if (path.extname(archivePath).toLowerCase() !== ".zip") {
    throw new Error("package archive は zip のみ対応しています。");
  }

  if (process.platform !== "win32") {
    throw new Error("zip install は現在 Windows のみ対応しています。");
  }

  if (!packageRootPath) {
    throw new Error("%LocalAppData% を解決できません。");
  }

  const tempParentPath = path.join(path.dirname(packageRootPath), ".package-install");
  await fs.mkdir(tempParentPath, { recursive: true });
  const tempRootPath = await fs.mkdtemp(path.join(tempParentPath, "extract-"));

  try {
    await extractZipArchive(path.resolve(archivePath), tempRootPath);
    return await installIntegralPackageFromSource(tempRootPath, packageRootPath);
  } finally {
    await fs.rm(tempRootPath, { force: true, recursive: true });
  }
}

export async function uninstallInstalledIntegralPackage(
  packageId: string,
  packageRootPath = getIntegralPackageRootPath()
): Promise<{
  installedPackagePath: string;
  packageId: string;
  removed: boolean;
}> {
  if (!packageRootPath) {
    throw new Error("%LocalAppData% を解決できません。");
  }

  assertSafePackageId(packageId);

  const installedPackagePath = path.join(packageRootPath, sanitizePackageDirectoryName(packageId));

  assertPathInsideRoot(packageRootPath, installedPackagePath);

  if (!(await pathExists(installedPackagePath))) {
    return {
      installedPackagePath,
      packageId,
      removed: false
    };
  }

  await fs.rm(installedPackagePath, { force: true, recursive: true });

  return {
    installedPackagePath,
    packageId,
    removed: true
  };
}

export async function findPackagePythonBlockExport(
  workspaceRootPath: string,
  blockType: string
): Promise<(PackagePythonBlockExport & { manifestPath?: string }) | null> {
  const exports = await listPackagePythonBlockExports(workspaceRootPath);

  for (const candidate of exports) {
    if (candidate.blockType === blockType) {
      const manifestPath = path.join(candidate.packageRootPath, INTEGRAL_PACKAGE_MANIFEST_FILENAME);
      return {
        ...candidate,
        manifestPath
      };
    }
  }

  return null;
}

export function resolveWorkspacePackageRootPath(
  workspaceRootPath: string,
  packageId: string
): string {
  return path.join(workspaceRootPath, WORKSPACE_PACKAGES_DIRECTORY, packageId);
}

export async function readInstalledIntegralPackageById(
  packageId: string,
  packageRootPath = getIntegralPackageRootPath()
): Promise<ResolvedIntegralPackage | null> {
  assertSafePackageId(packageId);

  if (!packageRootPath) {
    return null;
  }

  return readPackageDirectory(path.join(packageRootPath, sanitizePackageDirectoryName(packageId)));
}

export async function readIntegralPackageSourceDirectory(
  sourceRootPath: string
): Promise<ResolvedIntegralPackage> {
  const packageSourceRootPath = await resolveIntegralPackageSourceRootPath(path.resolve(sourceRootPath));
  const resolvedPackage = await readPackageDirectory(packageSourceRootPath);

  if (!resolvedPackage) {
    throw new Error(`package manifest が不正です: ${packageSourceRootPath}`);
  }

  return resolvedPackage;
}

function normalizeWorkspacePackageScriptPath(packageId: string, scriptPath: string): string {
  return `${WORKSPACE_PACKAGES_DIRECTORY}/${packageId}/${scriptPath}`;
}

async function copyPackageRuntimeAssetsToWorkspace(
  resolvedPackage: ResolvedIntegralPackage,
  targetRootPath: string,
  options: {
    overwrite: boolean;
  }
): Promise<void> {
  const targetManifestPath = path.join(targetRootPath, INTEGRAL_PACKAGE_MANIFEST_FILENAME);
  const sourceSharedPath = path.join(resolvedPackage.rootPath, "shared");
  const sourceScriptsPath = path.join(resolvedPackage.rootPath, "scripts");
  const targetSharedPath = path.join(targetRootPath, "shared");
  const targetScriptsPath = path.join(targetRootPath, "scripts");

  if (await pathExists(targetRootPath)) {
    if (!options.overwrite) {
      throw new Error(`package は既に import 済みです: ${resolvedPackage.manifest.id}`);
    }

    await fs.rm(targetRootPath, { force: true, recursive: true });
  }

  await fs.mkdir(targetRootPath, { recursive: true });
  await fs.copyFile(resolvedPackage.manifestPath, targetManifestPath);

  if (await pathExists(sourceScriptsPath)) {
    await fs.cp(sourceScriptsPath, targetScriptsPath, { force: true, recursive: true });
  } else {
    await fs.mkdir(targetScriptsPath, { recursive: true });
  }

  if (await pathExists(sourceSharedPath)) {
    await fs.cp(sourceSharedPath, targetSharedPath, { force: true, recursive: true });
  }
}

async function readPackagesFromRoot(rootPath: string): Promise<ResolvedIntegralPackage[]> {
  const entries = await fs.readdir(rootPath, { withFileTypes: true }).catch(() => []);
  const packages = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name, "ja"))
      .map((entry) => readPackageDirectory(path.join(rootPath, entry.name)))
  );

  return packages.filter((item): item is ResolvedIntegralPackage => item !== null);
}

async function readPackageDirectory(packageRootPath: string): Promise<ResolvedIntegralPackage | null> {
  const manifestPath = path.join(packageRootPath, INTEGRAL_PACKAGE_MANIFEST_FILENAME);
  const content = await fs.readFile(manifestPath, "utf8").catch(() => null);

  if (!content) {
    return null;
  }

  const manifest = parseIntegralPackageManifestText(content);

  if (!manifest) {
    return null;
  }

  return {
    manifest,
    manifestPath,
    rootPath: packageRootPath
  };
}

export async function resolveIntegralPackageSourceRootPath(sourceRootPath: string): Promise<string> {
  if (await pathExists(path.join(sourceRootPath, INTEGRAL_PACKAGE_MANIFEST_FILENAME))) {
    return sourceRootPath;
  }

  const entries = await fs.readdir(sourceRootPath, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(sourceRootPath, entry.name));
  const packageRootPaths: string[] = [];

  for (const candidatePath of candidates) {
    if (await pathExists(path.join(candidatePath, INTEGRAL_PACKAGE_MANIFEST_FILENAME))) {
      packageRootPaths.push(candidatePath);
    }
  }

  if (packageRootPaths.length === 1) {
    return packageRootPaths[0];
  }

  if (packageRootPaths.length === 0) {
    throw new Error("package root に integral-package.json が見つかりません。");
  }

  throw new Error("複数の package root が見つかりました。");
}

async function extractZipArchive(archivePath: string, destinationPath: string): Promise<void> {
  await fs.mkdir(destinationPath, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const command = [
      `Expand-Archive -LiteralPath ${toPowerShellLiteral(archivePath)}`,
      `-DestinationPath ${toPowerShellLiteral(destinationPath)}`,
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

function shouldCopyPackagePath(sourcePath: string, packageRootPath: string): boolean {
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

function assertSafePackageId(packageId: string): void {
  if (!isSafePackageId(packageId)) {
    throw new Error(`package id が不正です: ${packageId}`);
  }
}

function sanitizePackageDirectoryName(packageId: string): string {
  assertSafePackageId(packageId);
  return packageId.trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-");
}

function assertPathInsideRoot(rootPath: string, targetPath: string): void {
  const resolvedRootPath = path.resolve(rootPath);
  const resolvedTargetPath = path.resolve(targetPath);
  const relativePath = path.relative(resolvedRootPath, resolvedTargetPath);

  if (
    relativePath.length === 0 ||
    relativePath === "." ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`package path が不正です: ${resolvedTargetPath}`);
  }
}

function toPowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
