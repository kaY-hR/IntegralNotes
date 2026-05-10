import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

import { BrowserWindow, dialog, shell } from "electron";

import type {
  ExtensionGlobalItemRequest,
  ExtensionManagementSnapshot,
  ExtensionMutationResult,
  ExtensionOpenItemRequest,
  ExtensionPackageRequest,
  ExtensionPackageSideSummary,
  ExtensionPythonCallableSummary,
  ExtensionRuntimeRequest,
  ExtensionRuntimeSummary,
  ExtensionScriptSummary,
  ExtensionSkillSummary,
  ExtensionWorkspaceItemRequest
} from "../shared/extensions";
import {
  INTEGRAL_PACKAGE_MANIFEST_FILENAME,
  parsePythonBlockExport,
  type IntegralPackageManifest
} from "../shared/packages";
import type { InstalledPluginDefinition } from "../shared/plugins";
import {
  installIntegralPackageFromSource,
  importIntegralPackageToWorkspace,
  readInstalledIntegralPackages,
  readIntegralPackageSourceDirectory,
  readWorkspaceImportedIntegralPackages,
  removeWorkspaceImportedIntegralPackage,
  resolveWorkspacePackageRootPath,
  uninstallInstalledIntegralPackage,
  type ResolvedIntegralPackage
} from "./packageService";
import {
  getIntegralGlobalRootPath,
  getIntegralPackageRootPath,
  getIntegralRuntimePluginRootPath,
  shortenPathWithTokens,
  toDisplayPath
} from "./pathTokens";
import type { PluginRegistry } from "./pluginRegistry";
import type { WorkspaceService } from "./workspaceService";

interface ExtensionManagementServiceOptions {
  getMainWindow: () => BrowserWindow | null;
  pluginRegistry: PluginRegistry;
  workspaceService: WorkspaceService;
}

type PackageSelection =
  | {
      kind: "directory";
      packageRootPath: string;
      resolvedPackage: ResolvedIntegralPackage;
    }
  | {
      kind: "zip";
      packageRootPath: string;
      resolvedPackage: ResolvedIntegralPackage;
      tempRootPath: string;
    };

const WORKSPACE_SCRIPT_EXCLUDED_DIRECTORY_NAMES = new Set([
  ".codex",
  ".git",
  ".integral-sdk",
  ".packages",
  ".store",
  "__pycache__",
  "coverage",
  "dist",
  "node_modules",
  "out"
]);
const PYTHON_CALLABLE_PATTERN =
  /@integral_block\s*\([\s\S]*?\)\s*(?:\r?\n)+\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gu;

export class ExtensionManagementService {
  private readonly getMainWindow: () => BrowserWindow | null;
  private readonly pluginRegistry: PluginRegistry;
  private readonly workspaceService: WorkspaceService;

  constructor(options: ExtensionManagementServiceOptions) {
    this.getMainWindow = options.getMainWindow;
    this.pluginRegistry = options.pluginRegistry;
    this.workspaceService = options.workspaceService;
  }

  async getSnapshot(): Promise<ExtensionManagementSnapshot> {
    const workspaceRootPath = this.workspaceService.currentRootPath ?? null;
    const globalRootPath = getIntegralGlobalRootPath();
    const globalSkillsRootPath = globalRootPath ? path.join(globalRootPath, "skills") : null;
    const globalScriptsRootPath = globalRootPath ? path.join(globalRootPath, "scripts") : null;
    const packageRootPath = getIntegralPackageRootPath();
    const runtimePluginRootPath = getIntegralRuntimePluginRootPath();

    const [
      workspaceSkills,
      workspaceScripts,
      globalSkills,
      globalScripts,
      standaloneRuntimePlugins,
      packages
    ] = await Promise.all([
      workspaceRootPath ? this.readWorkspaceSkills(workspaceRootPath) : Promise.resolve([]),
      workspaceRootPath ? this.readWorkspaceScripts(workspaceRootPath) : Promise.resolve([]),
      globalSkillsRootPath
        ? readSkillDirectories(globalSkillsRootPath, "global", shortenPathWithTokens(globalSkillsRootPath))
        : Promise.resolve([]),
      globalScriptsRootPath
        ? readScriptFiles(globalScriptsRootPath, "global", shortenPathWithTokens(globalScriptsRootPath))
        : Promise.resolve([]),
      this.readStandaloneRuntimePlugins(),
      this.readPackageSummaries(workspaceRootPath)
    ]);

    return {
      globalRootLabel: globalRootPath ? shortenPathWithTokens(globalRootPath) : null,
      globalScriptsRootLabel: globalScriptsRootPath ? shortenPathWithTokens(globalScriptsRootPath) : null,
      globalSkillsRootLabel: globalSkillsRootPath ? shortenPathWithTokens(globalSkillsRootPath) : null,
      packageRootLabel: packageRootPath ? shortenPathWithTokens(packageRootPath) : null,
      packages,
      runtimePluginRootLabel: runtimePluginRootPath ? shortenPathWithTokens(runtimePluginRootPath) : null,
      standaloneRuntimePlugins,
      workspaceRootLabel: workspaceRootPath ? toDisplayPath(workspaceRootPath) : null,
      workspaceRootName: workspaceRootPath ? path.basename(workspaceRootPath) : null,
      workspaceScripts,
      workspaceSkills,
      globalScripts,
      globalSkills
    };
  }

  async openItem(request: ExtensionOpenItemRequest): Promise<void> {
    const targetPath = await this.resolveOpenTargetPath(request);

    await openPathInFileManager(targetPath);
  }

  async installPackageFromDialog(): Promise<ExtensionMutationResult | null> {
    const selection = await this.selectPackageSource();

    if (!selection) {
      return null;
    }

    try {
      const existingPackage = await this.packageExistsInGlobal(selection.resolvedPackage.manifest.id);

      if (existingPackage) {
        const confirmed = await this.confirm({
          confirmLabel: "上書き",
          detail:
            `${selection.resolvedPackage.manifest.displayName} (${selection.resolvedPackage.manifest.id})\n\n` +
            "同じ package ID が既に Global にあります。",
          message: "Global package を上書きしますか？"
        });

        if (!confirmed) {
          return cancelledMutation("package install をキャンセルしました。");
        }
      }

      const installedPackage = await installIntegralPackageFromSource(selection.packageRootPath);

      return {
        cancelled: false,
        message: `${installedPackage.manifest.displayName} ${installedPackage.manifest.version} を Global に install しました。`,
        pluginRuntimeChanged: true,
        workspaceChanged: false
      };
    } finally {
      if (selection.kind === "zip") {
        await fs.rm(selection.tempRootPath, { force: true, recursive: true });
      }
    }
  }

  async importGlobalScriptToWorkspace(
    request: ExtensionGlobalItemRequest
  ): Promise<ExtensionMutationResult> {
    const workspaceRootPath = this.requireWorkspaceRootPath();
    const sourcePath = this.resolveGlobalScriptPath(request.relativePath);
    const sourceStats = await fs.stat(sourcePath);

    if (!sourceStats.isFile() || path.extname(sourcePath).toLowerCase() !== ".py") {
      throw new Error("workspace へ import できるのは Python script file だけです。");
    }

    const normalizedRelativePath = normalizeRelativePath(request.relativePath);
    const targetRelativePath = normalizeRelativePath(path.posix.join("scripts", normalizedRelativePath));
    const targetPath = resolvePathInsideRoot(workspaceRootPath, targetRelativePath);
    const exists = await pathExists(targetPath);

    if (exists) {
      const confirmed = await this.confirm({
        confirmLabel: "上書き",
        detail: `${targetRelativePath}\n\nGlobal stock から workspace script を上書き copy します。`,
        message: "既存の workspace script を上書きしますか？"
      });

      if (!confirmed) {
        return cancelledMutation("script import をキャンセルしました。");
      }
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);

    return {
      cancelled: false,
      message: `${targetRelativePath} を workspace に import しました。`,
      pluginRuntimeChanged: false,
      workspaceChanged: true
    };
  }

  async stockWorkspaceScriptOnGlobal(
    request: ExtensionWorkspaceItemRequest
  ): Promise<ExtensionMutationResult> {
    const workspaceRootPath = this.requireWorkspaceRootPath();
    const normalizedRelativePath = normalizeRelativePath(request.relativePath);
    const sourcePath = resolvePathInsideRoot(workspaceRootPath, normalizedRelativePath);
    const sourceStats = await fs.stat(sourcePath);

    if (!sourceStats.isFile() || path.extname(sourcePath).toLowerCase() !== ".py") {
      throw new Error("Global stock に追加できるのは Python script file だけです。");
    }

    const globalScriptsRootPath = this.requireGlobalScriptsRootPath();
    const destinationPath = resolvePathInsideRoot(globalScriptsRootPath, normalizedRelativePath);

    try {
      await this.copyToGlobalStockWithConfirm({
        destinationPath,
        detail: `${normalizedRelativePath}\n\nworkspace script を Global stock へ copy します。`,
        message: "Global script stock を上書きしますか？",
        sourcePath
      });
    } catch (error) {
      if (error instanceof CancelledExtensionOperationError) {
        return cancelledMutation(error.message);
      }

      throw error;
    }

    return {
      cancelled: false,
      message: `${normalizedRelativePath} を Global script stock に追加しました。`,
      pluginRuntimeChanged: false,
      workspaceChanged: false
    };
  }

  async stockWorkspaceSkillOnGlobal(
    request: ExtensionWorkspaceItemRequest
  ): Promise<ExtensionMutationResult> {
    const workspaceRootPath = this.requireWorkspaceRootPath();
    const normalizedRelativePath = normalizeRelativePath(request.relativePath);
    const sourcePath = resolvePathInsideRoot(workspaceRootPath, normalizedRelativePath);
    const sourceStats = await fs.stat(sourcePath);

    if (!sourceStats.isDirectory()) {
      throw new Error("Global stock に追加できる skill は directory だけです。");
    }

    const skillId = path.posix.basename(normalizedRelativePath);
    const globalSkillsRootPath = this.requireGlobalSkillsRootPath();
    const destinationPath = resolvePathInsideRoot(globalSkillsRootPath, skillId);

    try {
      await this.copyToGlobalStockWithConfirm({
        destinationPath,
        detail: `${normalizedRelativePath}\n\nworkspace skill を Global stock へ copy します。`,
        message: "Global skill stock を上書きしますか？",
        sourcePath
      });
    } catch (error) {
      if (error instanceof CancelledExtensionOperationError) {
        return cancelledMutation(error.message);
      }

      throw error;
    }

    return {
      cancelled: false,
      message: `${skillId} を Global skill stock に追加しました。`,
      pluginRuntimeChanged: false,
      workspaceChanged: false
    };
  }

  async deleteWorkspaceExtensionItem(
    request: ExtensionWorkspaceItemRequest
  ): Promise<ExtensionMutationResult> {
    const normalizedRelativePath = normalizeRelativePath(request.relativePath);
    const confirmed = await this.confirm({
      confirmLabel: "削除",
      detail: `${normalizedRelativePath}\n\nworkspace から削除します。この操作は元に戻せません。`,
      message: "workspace item を削除しますか?",
      type: "warning"
    });

    if (!confirmed) {
      return cancelledMutation("削除をキャンセルしました。");
    }

    await this.workspaceService.deleteEntry({ targetPath: normalizedRelativePath });

    return {
      cancelled: false,
      message: `${normalizedRelativePath} を削除しました。`,
      pluginRuntimeChanged: false,
      workspaceChanged: true
    };
  }

  async deleteGlobalScript(request: ExtensionGlobalItemRequest): Promise<ExtensionMutationResult> {
    const normalizedRelativePath = normalizeRelativePath(request.relativePath);
    const targetPath = this.resolveGlobalScriptPath(normalizedRelativePath);

    return await this.deleteGlobalItem({
      detail: `${shortenPathWithTokens(targetPath)}\n\nGlobal script stock から削除します。`,
      message: "Global script を削除しますか?",
      successMessage: `${normalizedRelativePath} を Global script stock から削除しました。`,
      targetPath
    });
  }

  async deleteGlobalSkill(request: ExtensionGlobalItemRequest): Promise<ExtensionMutationResult> {
    const normalizedRelativePath = normalizeRelativePath(request.relativePath);
    const targetPath = this.resolveGlobalSkillPath(normalizedRelativePath);

    return await this.deleteGlobalItem({
      detail: `${shortenPathWithTokens(targetPath)}\n\nGlobal skill stock から削除します。`,
      message: "Global skill を削除しますか?",
      successMessage: `${normalizedRelativePath} を Global skill stock から削除しました。`,
      targetPath
    });
  }

  async importPackage(request: ExtensionPackageRequest): Promise<ExtensionMutationResult> {
    const workspaceRootPath = this.requireWorkspaceRootPath();
    const packageId = readPackageId(request.packageId);
    const targetRootPath = resolveWorkspacePackageRootPath(workspaceRootPath, packageId);
    const exists = await pathExists(targetRootPath);

    if (exists) {
      const confirmed = await this.confirm({
        confirmLabel: "上書き",
        detail: `${packageId}\n\nworkspace の既存 package import を上書きします。`,
        message: "Package scripts/shared を再 import しますか？"
      });

      if (!confirmed) {
        return cancelledMutation("package import をキャンセルしました。");
      }
    }

    const result = await importIntegralPackageToWorkspace(workspaceRootPath, packageId, {
      overwrite: exists
    });

    return {
      cancelled: false,
      message: `${result.packageId} を Current Workspace に import しました。`,
      pluginRuntimeChanged: false,
      workspaceChanged: true
    };
  }

  async removePackageImport(request: ExtensionPackageRequest): Promise<ExtensionMutationResult> {
    const workspaceRootPath = this.requireWorkspaceRootPath();
    const packageId = readPackageId(request.packageId);
    const confirmed = await this.confirm({
      confirmLabel: "削除",
      detail:
        `${packageId}\n\n` +
        "workspace .packages から削除します。既存 note の run 参照が解決できなくなる可能性があります。",
      message: "workspace package import を削除しますか?",
      type: "warning"
    });

    if (!confirmed) {
      return cancelledMutation("package import の削除をキャンセルしました。");
    }

    const result = await removeWorkspaceImportedIntegralPackage(workspaceRootPath, packageId);

    return {
      cancelled: false,
      message: result.removed
        ? `${packageId} の workspace import を削除しました。`
        : `${packageId} の workspace import は見つかりませんでした。`,
      pluginRuntimeChanged: false,
      workspaceChanged: true
    };
  }

  async uninstallPackage(request: ExtensionPackageRequest): Promise<ExtensionMutationResult> {
    const packageId = readPackageId(request.packageId);
    const confirmed = await this.confirm({
      confirmLabel: "Uninstall",
      detail:
        `${packageId}\n\n` +
        "Global package stock を削除します。package skill / runtime plugin / reimport は使えなくなります。",
      message: "Global package を uninstall しますか?",
      type: "warning"
    });

    if (!confirmed) {
      return cancelledMutation("package uninstall をキャンセルしました。");
    }

    const result = await uninstallInstalledIntegralPackage(packageId);

    return {
      cancelled: false,
      message: result.removed
        ? `${packageId} を Global から uninstall しました。`
        : `${packageId} は Global に見つかりませんでした。`,
      pluginRuntimeChanged: true,
      workspaceChanged: false
    };
  }

  async uninstallStandaloneRuntimePlugin(
    request: ExtensionRuntimeRequest
  ): Promise<ExtensionMutationResult> {
    const pluginId = readNonEmptyString(request.pluginId, "pluginId");
    const confirmed = await this.confirm({
      confirmLabel: "Uninstall",
      detail: `${pluginId}\n\nStandalone runtime plugin を Global から削除します。`,
      message: "Standalone runtime plugin を uninstall しますか?",
      type: "warning"
    });

    if (!confirmed) {
      return cancelledMutation("runtime plugin uninstall をキャンセルしました。");
    }

    const result = await this.pluginRegistry.uninstallPlugin(pluginId);

    return {
      cancelled: false,
      message: result.removed
        ? `${pluginId} を Global から uninstall しました。`
        : `${pluginId} は Global に見つかりませんでした。`,
      pluginRuntimeChanged: true,
      workspaceChanged: false
    };
  }

  private async readWorkspaceSkills(workspaceRootPath: string): Promise<ExtensionSkillSummary[]> {
    const roots = [
      {
        absolutePath: path.join(workspaceRootPath, ".codex", "skills"),
        relativePath: ".codex/skills"
      },
      {
        absolutePath: path.join(workspaceRootPath, "Notes", ".codex", "skills"),
        relativePath: "Notes/.codex/skills"
      }
    ];
    const skills = await Promise.all(
      roots.map((root) =>
        readSkillDirectories(
          root.absolutePath,
          "workspace",
          root.relativePath,
          root.relativePath
        )
      )
    );

    return skills.flat().sort(sortByDisplayNameThenPath);
  }

  private async readWorkspaceScripts(workspaceRootPath: string): Promise<ExtensionScriptSummary[]> {
    return readScriptFiles(
      workspaceRootPath,
      "workspace",
      toDisplayPath(workspaceRootPath),
      "",
      WORKSPACE_SCRIPT_EXCLUDED_DIRECTORY_NAMES
    );
  }

  private async readStandaloneRuntimePlugins(): Promise<ExtensionRuntimeSummary[]> {
    const installedPlugins = await this.pluginRegistry.listInstalledPlugins();

    return installedPlugins
      .filter((plugin) => plugin.origin === "external")
      .map((plugin) => toRuntimeSummary(plugin))
      .sort((left, right) => left.displayName.localeCompare(right.displayName, "ja"));
  }

  private async readPackageSummaries(
    workspaceRootPath: string | null
  ): Promise<ExtensionManagementSnapshot["packages"]> {
    const [installedPackages, importedPackages] = await Promise.all([
      readInstalledIntegralPackages(),
      workspaceRootPath
        ? readWorkspaceImportedIntegralPackages(workspaceRootPath)
        : Promise.resolve([])
    ]);
    const packageIds = new Set<string>();

    installedPackages.forEach((item) => packageIds.add(item.manifest.id));
    importedPackages.forEach((item) => packageIds.add(item.manifest.id));

    const installedById = new Map(installedPackages.map((item) => [item.manifest.id, item]));
    const importedById = new Map(importedPackages.map((item) => [item.manifest.id, item]));
    const summaries = await Promise.all(
      Array.from(packageIds)
        .sort((left, right) => left.localeCompare(right, "ja"))
        .map(async (packageId) => {
          const installedPackage = installedById.get(packageId) ?? null;
          const importedPackage = importedById.get(packageId) ?? null;
          const manifest = installedPackage?.manifest ?? importedPackage?.manifest;

          if (!manifest) {
            throw new Error(`package manifest が見つかりません: ${packageId}`);
          }

          return {
            displayName: manifest.displayName,
            global: installedPackage ? await toPackageSideSummary(installedPackage) : null,
            id: packageId,
            workspace: importedPackage ? await toPackageSideSummary(importedPackage) : null
          };
        })
    );

    return summaries;
  }

  private async selectPackageSource(): Promise<PackageSelection | null> {
    const mainWindow = this.getMainWindow();

    if (!mainWindow) {
      throw new Error("main window is not available.");
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Install Package",
      filters: [
        {
          name: "Package ZIP",
          extensions: ["zip"]
        }
      ],
      properties: ["openFile", "openDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const selectedPath = result.filePaths[0];
    const selectedStats = await fs.stat(selectedPath);

    if (selectedStats.isDirectory()) {
      const resolvedPackage = await readIntegralPackageSourceDirectory(selectedPath);

      return {
        kind: "directory",
        packageRootPath: resolvedPackage.rootPath,
        resolvedPackage
      };
    }

    if (selectedStats.isFile() && path.extname(selectedPath).toLowerCase() === ".zip") {
      return this.extractPackageZipSelection(selectedPath);
    }

    throw new Error("package install は integral-package.json を含む folder または zip を選択してください。");
  }

  private async extractPackageZipSelection(archivePath: string): Promise<PackageSelection> {
    if (process.platform !== "win32") {
      throw new Error("zip install は現在 Windows のみ対応しています。");
    }

    const packageRootPath = getIntegralPackageRootPath();

    if (!packageRootPath) {
      throw new Error("%LocalAppData% を解決できません。");
    }

    const tempParentPath = path.join(path.dirname(packageRootPath), ".package-install");
    await fs.mkdir(tempParentPath, { recursive: true });
    const tempRootPath = await fs.mkdtemp(path.join(tempParentPath, "extract-"));

    try {
      await extractZipArchive(path.resolve(archivePath), tempRootPath);
      const resolvedPackage = await readIntegralPackageSourceDirectory(tempRootPath);

      return {
        kind: "zip",
        packageRootPath: resolvedPackage.rootPath,
        resolvedPackage,
        tempRootPath
      };
    } catch (error) {
      await fs.rm(tempRootPath, { force: true, recursive: true });
      throw error;
    }
  }

  private async packageExistsInGlobal(packageId: string): Promise<boolean> {
    const packageRootPath = getIntegralPackageRootPath();

    if (!packageRootPath) {
      return false;
    }

    return pathExists(path.join(packageRootPath, packageId, INTEGRAL_PACKAGE_MANIFEST_FILENAME));
  }

  private async copyToGlobalStockWithConfirm(options: {
    destinationPath: string;
    detail: string;
    message: string;
    sourcePath: string;
  }): Promise<void> {
    const exists = await pathExists(options.destinationPath);

    if (exists) {
      const confirmed = await this.confirm({
        confirmLabel: "上書き",
        detail: options.detail,
        message: options.message
      });

      if (!confirmed) {
        throw new CancelledExtensionOperationError("Global stock copy をキャンセルしました。");
      }

      await fs.rm(options.destinationPath, { force: true, recursive: true });
    }

    await fs.mkdir(path.dirname(options.destinationPath), { recursive: true });

    const sourceStats = await fs.stat(options.sourcePath);

    if (sourceStats.isDirectory()) {
      await fs.cp(options.sourcePath, options.destinationPath, { force: true, recursive: true });
      return;
    }

    await fs.copyFile(options.sourcePath, options.destinationPath);
  }

  private async deleteGlobalItem(options: {
    detail: string;
    message: string;
    successMessage: string;
    targetPath: string;
  }): Promise<ExtensionMutationResult> {
    const confirmed = await this.confirm({
      confirmLabel: "削除",
      detail: options.detail,
      message: options.message,
      type: "warning"
    });

    if (!confirmed) {
      return cancelledMutation("削除をキャンセルしました。");
    }

    await fs.rm(options.targetPath, { force: true, recursive: true });

    return {
      cancelled: false,
      message: options.successMessage,
      pluginRuntimeChanged: false,
      workspaceChanged: false
    };
  }

  private async resolveOpenTargetPath(request: ExtensionOpenItemRequest): Promise<string> {
    if (request.location === "workspace") {
      const relativePath = readNonEmptyString(request.relativePath, "relativePath");
      return this.workspaceService.getAbsolutePath(normalizeRelativePath(relativePath));
    }

    switch (request.kind) {
      case "package": {
        const packageId = readPackageId(request.packageId);
        const packageRootPath = this.requirePackageRootPath();
        return resolvePathInsideRoot(packageRootPath, packageId);
      }
      case "runtime": {
        const pluginId = readNonEmptyString(request.pluginId, "pluginId");
        const plugin = (await this.pluginRegistry.listInstalledPlugins()).find(
          (candidate) => candidate.id === pluginId && candidate.origin === "external"
        );

        if (!plugin?.sourcePath) {
          throw new Error(`runtime plugin が見つかりません: ${pluginId}`);
        }

        return plugin.sourcePath;
      }
      case "script": {
        const relativePath = readNonEmptyString(request.relativePath, "relativePath");
        return this.resolveGlobalScriptPath(relativePath);
      }
      case "skill": {
        const relativePath = readNonEmptyString(request.relativePath, "relativePath");
        return this.resolveGlobalSkillPath(relativePath);
      }
      default:
        throw new Error("未対応の extension item です。");
    }
  }

  private requireWorkspaceRootPath(): string {
    const workspaceRootPath = this.workspaceService.currentRootPath;

    if (!workspaceRootPath) {
      throw new Error("workspace folder is not open.");
    }

    return workspaceRootPath;
  }

  private requireGlobalScriptsRootPath(): string {
    const globalRootPath = getIntegralGlobalRootPath();

    if (!globalRootPath) {
      throw new Error("%LocalAppData% を解決できません。");
    }

    return path.join(globalRootPath, "scripts");
  }

  private requireGlobalSkillsRootPath(): string {
    const globalRootPath = getIntegralGlobalRootPath();

    if (!globalRootPath) {
      throw new Error("%LocalAppData% を解決できません。");
    }

    return path.join(globalRootPath, "skills");
  }

  private requirePackageRootPath(): string {
    const packageRootPath = getIntegralPackageRootPath();

    if (!packageRootPath) {
      throw new Error("%LocalAppData% を解決できません。");
    }

    return packageRootPath;
  }

  private resolveGlobalScriptPath(relativePath: string): string {
    return resolvePathInsideRoot(this.requireGlobalScriptsRootPath(), normalizeRelativePath(relativePath));
  }

  private resolveGlobalSkillPath(relativePath: string): string {
    return resolvePathInsideRoot(this.requireGlobalSkillsRootPath(), normalizeRelativePath(relativePath));
  }

  private async confirm(options: {
    confirmLabel: string;
    detail: string;
    message: string;
    type?: "question" | "warning";
  }): Promise<boolean> {
    const mainWindow = this.getMainWindow();
    const dialogOptions = {
      buttons: ["キャンセル", options.confirmLabel],
      cancelId: 0,
      defaultId: 0,
      detail: options.detail,
      message: options.message,
      noLink: true,
      type: options.type ?? "question"
    };
    const result = mainWindow
      ? await dialog.showMessageBox(mainWindow, dialogOptions)
      : await dialog.showMessageBox(dialogOptions);

    return result.response === 1;
  }
}

async function readSkillDirectories(
  rootPath: string,
  location: "global" | "workspace",
  rootLabel: string,
  workspaceRelativeRootPath = ""
): Promise<ExtensionSkillSummary[]> {
  const entries = await fs.readdir(rootPath, { withFileTypes: true }).catch(() => []);
  const skills = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name, "ja"))
      .map(async (entry) => {
        const skillRootPath = path.join(rootPath, entry.name);
        const skillMarkdownPath = path.join(skillRootPath, "SKILL.md");

        if (!(await pathExists(skillMarkdownPath))) {
          return null;
        }

        const relativePath =
          location === "workspace"
            ? normalizeRelativePath(path.posix.join(workspaceRelativeRootPath, entry.name))
            : entry.name;
        const displayName = await readSkillDisplayName(skillMarkdownPath, entry.name);

        return {
          displayName,
          id: entry.name,
          location,
          relativePath,
          rootLabel
        };
      })
  );

  return skills.filter((skill): skill is ExtensionSkillSummary => skill !== null);
}

async function readScriptFiles(
  rootPath: string,
  location: "global" | "workspace",
  rootLabel: string,
  relativeRootPath = "",
  excludedDirectoryNames = new Set(["__pycache__"])
): Promise<ExtensionScriptSummary[]> {
  const relativePaths = await collectPythonScriptRelativePaths(rootPath, "", excludedDirectoryNames);
  const scripts = await Promise.all(
    relativePaths.map(async (relativePath) => {
      const absolutePath = path.join(rootPath, ...relativePath.split("/"));
      const content = await fs.readFile(absolutePath, "utf8").catch(() => "");
      const itemRelativePath =
        relativeRootPath.length > 0
          ? normalizeRelativePath(path.posix.join(relativeRootPath, relativePath))
          : relativePath;

      return {
        callables: parsePythonCallables(itemRelativePath, content),
        displayName: path.posix.basename(relativePath),
        location,
        relativePath: itemRelativePath,
        rootLabel
      };
    })
  );

  return scripts.sort(sortByDisplayNameThenPath);
}

async function collectPythonScriptRelativePaths(
  rootPath: string,
  currentRelativePath: string,
  excludedDirectoryNames: ReadonlySet<string>
): Promise<string[]> {
  const absolutePath =
    currentRelativePath.length > 0
      ? path.join(rootPath, ...currentRelativePath.split("/"))
      : rootPath;
  const entries = await fs.readdir(absolutePath, { withFileTypes: true }).catch(() => []);
  const scripts: string[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "ja"))) {
    if (entry.isDirectory() && excludedDirectoryNames.has(entry.name)) {
      continue;
    }

    const nextRelativePath =
      currentRelativePath.length > 0 ? `${currentRelativePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      scripts.push(
        ...(await collectPythonScriptRelativePaths(rootPath, nextRelativePath, excludedDirectoryNames))
      );
      continue;
    }

    if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".py") {
      scripts.push(nextRelativePath);
    }
  }

  return scripts;
}

function parsePythonCallables(scriptPath: string, content: string): ExtensionPythonCallableSummary[] {
  const callables: ExtensionPythonCallableSummary[] = [];
  const seenFunctionNames = new Set<string>();

  for (const match of content.matchAll(PYTHON_CALLABLE_PATTERN)) {
    const functionName = match[1]?.trim() ?? "";

    if (functionName.length === 0 || seenFunctionNames.has(functionName)) {
      continue;
    }

    seenFunctionNames.add(functionName);
    callables.push({
      blockType: `${scriptPath}:${functionName}`,
      functionName
    });
  }

  return callables;
}

async function readSkillDisplayName(skillMarkdownPath: string, fallback: string): Promise<string> {
  const content = await fs.readFile(skillMarkdownPath, "utf8").catch(() => "");
  const frontmatterName = /^---\s*[\r\n]+([\s\S]*?)---/u.exec(content)?.[1]
    ?.split(/\r?\n/u)
    .map((line) => /^name:\s*(.+)\s*$/u.exec(line)?.[1]?.trim())
    .find((value): value is string => Boolean(value && value.length > 0));

  if (frontmatterName) {
    return frontmatterName.replace(/^["']|["']$/gu, "");
  }

  const heading = /^#\s+(.+)$/mu.exec(content)?.[1]?.trim();
  return heading && heading.length > 0 ? heading : fallback;
}

async function toPackageSideSummary(
  resolvedPackage: ResolvedIntegralPackage
): Promise<ExtensionPackageSideSummary> {
  return {
    displayName: resolvedPackage.manifest.displayName,
    pythonBlocks: resolvedPackage.manifest.exports.pythonBlocks
      .map((exportValue) => toPackagePythonBlockSummary(resolvedPackage.manifest, exportValue))
      .filter((item): item is NonNullable<typeof item> => item !== null),
    rootLabel: shortenPathWithTokens(resolvedPackage.rootPath),
    runtimePlugins: resolvedPackage.manifest.exports.runtimePlugins.map((value) => toDisplayPackageItem(value)),
    sharedFiles: await collectPackageSharedFiles(resolvedPackage.rootPath),
    skills: resolvedPackage.manifest.exports.skills.map((value) => toDisplayPackageItem(value)),
    version: resolvedPackage.manifest.version
  };
}

function toPackagePythonBlockSummary(
  manifest: IntegralPackageManifest,
  exportValue: string
): ExtensionPackageSideSummary["pythonBlocks"][number] | null {
  const parsed = parsePythonBlockExport(exportValue);

  if (!parsed) {
    return null;
  }

  return {
    functionName: parsed.functionName,
    scriptPath: parsed.scriptPath,
    workspaceBlockType: `.packages/${manifest.id}/${parsed.scriptPath}:${parsed.functionName}`
  };
}

async function collectPackageSharedFiles(packageRootPath: string): Promise<string[]> {
  const sharedRootPath = path.join(packageRootPath, "shared");

  if (!(await pathExists(sharedRootPath))) {
    return [];
  }

  return collectRelativeFiles(sharedRootPath, "", new Set(["__pycache__"]));
}

async function collectRelativeFiles(
  rootPath: string,
  currentRelativePath = "",
  excludedDirectoryNames: ReadonlySet<string> = new Set()
): Promise<string[]> {
  const absolutePath =
    currentRelativePath.length > 0
      ? path.join(rootPath, ...currentRelativePath.split("/"))
      : rootPath;
  const entries = await fs.readdir(absolutePath, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "ja"))) {
    if (entry.isDirectory() && excludedDirectoryNames.has(entry.name)) {
      continue;
    }

    const nextRelativePath =
      currentRelativePath.length > 0 ? `${currentRelativePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      files.push(...(await collectRelativeFiles(rootPath, nextRelativePath, excludedDirectoryNames)));
      continue;
    }

    if (entry.isFile()) {
      files.push(nextRelativePath);
    }
  }

  return files;
}

function toRuntimeSummary(plugin: InstalledPluginDefinition): ExtensionRuntimeSummary {
  return {
    blocksCount: plugin.blocks.length,
    description: plugin.description,
    displayName: plugin.displayName,
    hasHost: plugin.hasHost,
    hasRenderer: plugin.hasRenderer,
    id: plugin.id,
    rootLabel: plugin.sourcePath ? shortenPathWithTokens(plugin.sourcePath) : null,
    sidebarViewsCount: plugin.sidebarViews.length,
    version: plugin.version,
    viewersCount: plugin.viewers.length
  };
}

function toDisplayPackageItem(value: string): string {
  return value.split("/").filter(Boolean).at(-1) ?? value;
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

async function openPathInFileManager(targetPath: string): Promise<void> {
  const stats = await fs.stat(targetPath);

  if (stats.isDirectory()) {
    const errorMessage = await shell.openPath(targetPath);

    if (errorMessage.trim().length > 0) {
      throw new Error(errorMessage);
    }

    return;
  }

  shell.showItemInFolder(targetPath);
}

function resolvePathInsideRoot(rootPath: string, relativePath: string): string {
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  const targetPath = path.resolve(rootPath, ...normalizedRelativePath.split("/"));

  assertPathInsideRoot(rootPath, targetPath);

  return targetPath;
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
    throw new Error(`extension path が不正です: ${resolvedTargetPath}`);
  }
}

function normalizeRelativePath(relativePath: string): string {
  const normalized = relativePath
    .trim()
    .replace(/\\/gu, "/")
    .split("/")
    .filter(Boolean)
    .join("/");

  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.includes(":") ||
    normalized.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(`relative path が不正です: ${relativePath}`);
  }

  return normalized;
}

function readPackageId(value: string | undefined): string {
  const packageId = readNonEmptyString(value, "packageId");

  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(packageId)) {
    throw new Error(`packageId が不正です: ${packageId}`);
  }

  return packageId;
}

function readNonEmptyString(value: string | undefined, name: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";

  if (trimmed.length === 0) {
    throw new Error(`${name} is required.`);
  }

  return trimmed;
}

function sortByDisplayNameThenPath<
  TItem extends { displayName: string; relativePath: string }
>(left: TItem, right: TItem): number {
  return (
    left.displayName.localeCompare(right.displayName, "ja") ||
    left.relativePath.localeCompare(right.relativePath, "ja")
  );
}

function cancelledMutation(message: string): ExtensionMutationResult {
  return {
    cancelled: true,
    message,
    pluginRuntimeChanged: false,
    workspaceChanged: false
  };
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

class CancelledExtensionOperationError extends Error {}
