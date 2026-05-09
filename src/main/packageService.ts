import { promises as fs } from "node:fs";
import path from "node:path";

import {
  INTEGRAL_PACKAGE_MANIFEST_FILENAME,
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

function normalizeWorkspacePackageScriptPath(packageId: string, scriptPath: string): string {
  return `${WORKSPACE_PACKAGES_DIRECTORY}/${packageId}/${scriptPath}`;
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

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
