import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import type {
  CreateSourceDatasetRequest,
  CreateSourceDatasetFromWorkspaceEntriesRequest,
  CreateSourceDatasetResult,
  ExecuteIntegralBlockRequest,
  ExecuteIntegralBlockResult,
  ImportOriginalDataResult,
  IntegralAssetCatalog,
  IntegralBlockDocument,
  IntegralBlockTypeDefinition,
  IntegralDatasetInspection,
  IntegralDatasetSummary,
  IntegralManagedDataTrackingIssue,
  IntegralOriginalDataSummary,
  IntegralRenderableFile,
  ResolveIntegralManagedDataTrackingIssueRequest,
  IntegralSlotDefinition
} from "../shared/integral";
import {
  findInstalledPluginViewerByExtension,
  type InstalledPluginDefinition,
  type PluginViewerDataEncoding
} from "../shared/plugins";
import {
  resolveWorkspaceMarkdownTarget,
  toCanonicalWorkspaceTarget
} from "../shared/workspaceLinks";
import type {
  WorkspaceDatasetManifestMember,
  WorkspaceFileDocument
} from "../shared/workspace";
import { PluginRegistry } from "./pluginRegistry";
import { WorkspaceService, type WorkspaceMutation } from "./workspaceService";

const execFileAsync = promisify(execFile);

const DATA_DIRECTORY = "Data";
const DATASET_JSON_EXTENSION = ".idts";
const DATASETS_DIRECTORY = "datasets";
const STORE_DIRECTORY = ".store";
const STORE_METADATA_DIRECTORY = ".integral";
const STORE_DATASET_MANIFESTS_DIRECTORY = "datasets";
const STORE_OBJECTS_DIRECTORY = "objects";
const STORE_RUNTIME_DIRECTORY = "runtime";
const DATASET_STAGING_DIRECTORY = "materialized-datasets";
const PYTHON_SDK_WORKSPACE_IMPORT_ROOT_DIRECTORY = "scripts";
const PYTHON_SDK_WORKSPACE_PACKAGE_DIRECTORY = `${PYTHON_SDK_WORKSPACE_IMPORT_ROOT_DIRECTORY}/integral`;
const PYTHON_EDITOR_IMPORT_PATH = "./scripts";

const BUILTIN_DISPLAY_PLUGIN_ID = "core-display";
const GENERAL_ANALYSIS_PLUGIN_ID = "general-analysis";
const DISPLAY_BLOCK_TYPE = "dataset-view";
const SHIMADZU_PLUGIN_ID = "shimadzu-lc";
const SHIMADZU_BLOCK_TYPE = "run-sequence";
const STANDARD_GRAPHS_PLUGIN_ID = "integralnotes.standard-graphs";

const HTML_EXTENSIONS = new Set([".html"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".svg"]);
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".json", ".csv"]);

type ManagedDataVisibility = "hidden" | "visible";
type ManagedDataProvenance = "derived" | "source";
type OriginalDataRepresentation = "directory" | "file";
type DatasetRepresentation = "dataset-json" | "directory";

interface ManagedMetadataBase {
  createdAt: string;
  displayName: string;
  hash: string;
  id: string;
  path: string;
  provenance: ManagedDataProvenance;
  visibility: ManagedDataVisibility;
}

interface OriginalDataMetadata extends ManagedMetadataBase {
  entityType: "original-data";
  objectPath?: string;
  originalDataId: string;
  representation: OriginalDataRepresentation;
}

interface DatasetMetadata extends ManagedMetadataBase {
  createdByBlockId: string | null;
  dataPath?: string;
  datasetId: string;
  entityType: "dataset";
  kind: string;
  memberIds?: string[];
  name: string;
  representation: DatasetRepresentation;
}

type ManagedDataMetadata = OriginalDataMetadata | DatasetMetadata;

interface InspectableFileEntry {
  absolutePath: string;
  relativePath: string;
}

interface TrackableWorkspaceEntry {
  absolutePath: string;
  hash: string;
  kind: "directory" | "file";
  relativePath: string;
}

interface DatasetManifest {
  dataPath?: string;
  datasetId: string;
  kind: string;
  memberIds?: string[];
  name: string;
}

interface ReconcileMetadataResult<TMetadata> {
  issue?: IntegralManagedDataTrackingIssue;
  metadata: TMetadata;
}

interface PythonCallableSummary {
  blockType: string;
  description: string;
  displayName: string;
  functionName: string;
  inputSlots: IntegralSlotDefinition[];
  outputSlots: IntegralSlotDefinition[];
  relativePath: string;
}

interface ExecFileError extends Error {
  code?: number | string;
  stderr?: string;
  stdout?: string;
}

const PYTHON_CALLABLE_PATTERN =
  /@integral_block\s*\(([\s\S]*?)\)\s*(?:\r?\n)+\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gu;

const PYTHON_CALLABLE_RUNNER = String.raw`
import importlib.util
import json
import pathlib
import sys

script_path = pathlib.Path(sys.argv[1])
function_name = sys.argv[2]
args_path = pathlib.Path(sys.argv[3])
sdk_import_root = pathlib.Path(sys.argv[4])

if not sdk_import_root.exists():
    raise RuntimeError(f"Integral Python SDK import root was not found: {sdk_import_root}")

sys.path.insert(0, str(sdk_import_root))
payload = json.loads(args_path.read_text(encoding="utf-8"))

spec = importlib.util.spec_from_file_location("integral_user_module", script_path)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Failed to load module from {script_path}")

loaded_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(loaded_module)

target = getattr(loaded_module, function_name)

try:
    target(
        inputs=payload.get("inputs"),
        outputs=payload.get("outputs"),
        params=payload.get("params"),
    )
except TypeError:
    target(
        payload.get("inputs"),
        payload.get("outputs"),
        payload.get("params"),
    )
`;

export class IntegralWorkspaceService {
  private pendingTrackingIssues: IntegralManagedDataTrackingIssue[] = [];

  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly pluginRegistry: PluginRegistry
  ) {}

  async listAssetCatalog(): Promise<IntegralAssetCatalog> {
    await this.ensureIntegralWorkspaceReady();

    const [originalData, datasets, pythonCallables, externalPlugins] = await Promise.all([
      this.readOriginalDataSummaries(),
      this.readDatasetSummaries(),
      this.readPythonCallableSummaries(),
      this.pluginRegistry.listInstalledPlugins()
    ]);

    return {
      datasets,
      blockTypes: buildBlockTypeCatalog(pythonCallables, externalPlugins),
      originalData
    };
  }

  async listManagedDataTrackingIssues(): Promise<IntegralManagedDataTrackingIssue[]> {
    await this.ensureIntegralWorkspaceReady();
    return this.pendingTrackingIssues.map((issue) => ({
      ...issue,
      candidatePaths: [...issue.candidatePaths]
    }));
  }

  async handleWorkspaceMutations(mutations: readonly WorkspaceMutation[]): Promise<void> {
    if (mutations.length === 0) {
      return;
    }

    await this.workspaceService.ensureWorkspaceReady();

    const metadataList = await this.readManagedDataMetadataList();

    if (metadataList.length === 0) {
      return;
    }

    if (!this.shouldReconcileManagedDataMetadata(mutations, metadataList)) {
      return;
    }

    if (await this.reconcileManagedDataMetadata()) {
      await this.workspaceService.syncManagedDataNotes();
    }
  }

  async resolveManagedDataTrackingIssue(
    request: ResolveIntegralManagedDataTrackingIssueRequest
  ): Promise<IntegralManagedDataTrackingIssue[]> {
    await this.ensureIntegralWorkspaceReady();

    const selectedPath = normalizeRelativePath(request.selectedPath);

    if (selectedPath.length === 0) {
      throw new Error("更新先の path を選択してください。");
    }

    if (request.entityType === "original-data") {
      const metadata = await this.readOriginalDataMetadata(request.targetId);

      if (!metadata) {
        throw new Error(`元データが見つかりません: ${request.targetId}`);
      }

      await this.applyTrackedPathResolution(metadata, selectedPath);
    } else {
      const metadata = await this.readDatasetMetadata(request.targetId);

      if (!metadata) {
        throw new Error(`dataset が見つかりません: ${request.targetId}`);
      }

      await this.applyTrackedPathResolution(metadata, selectedPath);
    }

    return this.listManagedDataTrackingIssues();
  }

  async importOriginalDataPaths(sourcePaths: string[]): Promise<ImportOriginalDataResult> {
    await this.ensureIntegralWorkspaceReady();

    if (sourcePaths.length === 0) {
      throw new Error("元データとして登録するファイルまたはフォルダを選択してください。");
    }

    const importedOriginalData: IntegralOriginalDataSummary[] = [];

    for (const sourcePath of sourcePaths) {
      const rootPath = this.getRootPath();
      const resolvedSourcePath = path.resolve(sourcePath);
      const sourceStats = await fs.stat(resolvedSourcePath);
      const representation: OriginalDataRepresentation = sourceStats.isDirectory()
        ? "directory"
        : "file";
      const sourceInsideWorkspace = this.isWorkspacePath(rootPath, resolvedSourcePath);

      if (sourceInsideWorkspace) {
        this.assertRegisterableOriginalDataPath(rootPath, resolvedSourcePath);
      }

      const originalDataId = createOpaqueId("ORD");
      const visiblePath = await this.resolveOriginalDataVisiblePath(
        rootPath,
        resolvedSourcePath,
        originalDataId,
        representation
      );
      const visibleAbsolutePath = this.resolveWorkspacePath(visiblePath);

      if (!sourceInsideWorkspace) {
        await fs.mkdir(path.dirname(visibleAbsolutePath), { recursive: true });
        await this.copyOriginalDataIntoWorkspace(
          resolvedSourcePath,
          visibleAbsolutePath,
          representation
        );
      }

      const metadata: OriginalDataMetadata = {
        createdAt: new Date().toISOString(),
        displayName: path.basename(resolvedSourcePath),
        entityType: "original-data",
        hash: await this.computeManagedDataHash(visibleAbsolutePath, representation),
        id: originalDataId,
        originalDataId,
        path: visiblePath,
        provenance: "source",
        representation,
        visibility: inferVisibilityFromPath(visiblePath)
      };

      await this.writeOriginalDataMetadata(originalDataId, metadata);
      await this.writeOriginalDataNote(metadata);
      importedOriginalData.push(await this.toOriginalDataSummary(metadata));
    }

    return {
      originalData: importedOriginalData
    };
  }

  async createSourceDataset(request: CreateSourceDatasetRequest): Promise<CreateSourceDatasetResult> {
    await this.ensureIntegralWorkspaceReady();

    const originalDataIds = request.originalDataIds
      .map((originalDataId) => originalDataId.trim())
      .filter((originalDataId) => originalDataId.length > 0);

    if (originalDataIds.length === 0) {
      throw new Error("source dataset を作るには少なくとも 1 つの元データが必要です。");
    }

    const uniqueOriginalDataIds = Array.from(new Set(originalDataIds));
    const datasetId = createOpaqueId("DTS");
    const datasetName = normalizeDatasetName(request.name, datasetId);
    const manifestRelativePath = await this.createSourceDatasetManifestRelativePath(
      datasetName,
      datasetId
    );
    const manifestAbsolutePath = this.resolveWorkspacePath(manifestRelativePath);
    const memberIds: string[] = [];

    for (const originalDataId of uniqueOriginalDataIds) {
      const originalDataMetadata = await this.readOriginalDataMetadata(originalDataId);

      if (originalDataMetadata === null) {
        throw new Error(`元データが見つかりません: ${originalDataId}`);
      }

      memberIds.push(originalDataId);
    }

    const manifest: DatasetManifest = {
      datasetId,
      kind: "source-bundle",
      memberIds,
      name: datasetName
    };
    const manifestContent = JSON.stringify(manifest, null, 2);
    await fs.mkdir(path.dirname(manifestAbsolutePath), { recursive: true });
    await fs.writeFile(manifestAbsolutePath, manifestContent, "utf8");

    const datasetMetadata: DatasetMetadata = {
      createdAt: new Date().toISOString(),
      createdByBlockId: null,
      datasetId,
      displayName: datasetName,
      entityType: "dataset",
      hash: await this.computeManagedDataHash(manifestAbsolutePath, "dataset-json"),
      id: datasetId,
      kind: "source-bundle",
      memberIds,
      name: datasetName,
      path: manifestRelativePath,
      provenance: "source",
      representation: "dataset-json",
      visibility: "visible"
    };

    await this.writeDatasetMetadata(datasetId, datasetMetadata);
    await this.writeDatasetNote(datasetMetadata);

    return {
      dataset: await this.readDatasetSummary(datasetId)
    };
  }

  async createSourceDatasetFromWorkspaceEntries(
    request: CreateSourceDatasetFromWorkspaceEntriesRequest
  ): Promise<CreateSourceDatasetResult> {
    await this.ensureIntegralWorkspaceReady();

    const relativePaths = collapseNestedRelativePaths(request.relativePaths);

    if (relativePaths.length === 0) {
      throw new Error("dataset に追加するファイルまたはフォルダを選択してください。");
    }

    const originalDataIds: string[] = [];

    for (const relativePath of relativePaths) {
      const existingMetadata = await this.findOriginalDataMetadataByPath(relativePath);

      if (existingMetadata) {
        originalDataIds.push(existingMetadata.originalDataId);
        continue;
      }

      const importResult = await this.importOriginalDataPaths([this.resolveWorkspacePath(relativePath)]);
      const importedOriginalDataId = importResult.originalData[0]?.originalDataId;

      if (!importedOriginalDataId) {
        throw new Error(`${relativePath} を元データとして登録できませんでした。`);
      }

      originalDataIds.push(importedOriginalDataId);
    }

    return this.createSourceDataset({
      name: request.name,
      originalDataIds
    });
  }

  async inspectDataset(datasetId: string): Promise<IntegralDatasetInspection> {
    await this.ensureIntegralWorkspaceReady();

    const datasetMetadata = await this.readDatasetMetadata(datasetId);

    if (datasetMetadata === null) {
      throw new Error(`dataset が見つかりません: ${datasetId}`);
    }

    const datasetRootPath = await this.resolveDatasetReadablePath(datasetMetadata);
    const inspectableFiles = await this.collectInspectableFiles(datasetRootPath, datasetMetadata);
    const installedPlugins = await this.pluginRegistry.listInstalledPlugins();
    const relativeFilePaths = inspectableFiles.map((entry) => entry.relativePath);
    const renderables = (
      await Promise.all(
        inspectableFiles.map((entry) =>
          this.readRenderableFile(
            entry.absolutePath,
            entry.relativePath,
            installedPlugins
          )
        )
      )
    ).filter((renderable): renderable is IntegralRenderableFile => renderable !== null);

    return {
      datasetId: datasetMetadata.datasetId,
      createdAt: datasetMetadata.createdAt,
      createdByBlockId: datasetMetadata.createdByBlockId,
      fileNames: relativeFilePaths,
      hash: datasetMetadata.hash,
      hasRenderableFiles: renderables.length > 0,
      kind: datasetMetadata.kind,
      memberIds: datasetMetadata.memberIds,
      name: datasetMetadata.name,
      path: datasetMetadata.path,
      provenance: datasetMetadata.provenance,
      representation: datasetMetadata.representation,
      renderableCount: renderables.length,
      renderables,
      visibility: datasetMetadata.visibility
    };
  }

  async readSpecialWorkspaceFileDocument(relativePath: string): Promise<WorkspaceFileDocument | null> {
    await this.ensureIntegralWorkspaceReady();

    const normalizedRelativePath = normalizeRelativePath(relativePath);

    if (path.extname(normalizedRelativePath).toLowerCase() !== DATASET_JSON_EXTENSION) {
      return null;
    }

    const absolutePath = this.resolveWorkspacePath(normalizedRelativePath);
    const stats = await fs.stat(absolutePath);

    if (!stats.isFile()) {
      throw new Error("ファイルのみ開けます。");
    }

    const manifest = await this.readDatasetManifest(normalizedRelativePath);

    if (!manifest) {
      return null;
    }

    const [rawContent, members, noteMarkdown] = await Promise.all([
      fs.readFile(absolutePath, "utf8"),
      Promise.all(
        (manifest.memberIds ?? []).map((memberId) => this.readDatasetManifestMember(memberId))
      ),
      this.readManagedDataNoteBody(manifest.datasetId)
    ]);

    return {
      content: rawContent,
      datasetManifest: {
        dataPath: manifest.dataPath ?? null,
        datasetId: manifest.datasetId,
        datasetKind: manifest.kind,
        datasetName: normalizeDatasetName(manifest.name, manifest.datasetId),
        members,
        noteMarkdown,
        noteTargetId: manifest.datasetId
      },
      kind: "dataset-json",
      modifiedAt: stats.mtime.toISOString(),
      name: path.basename(normalizedRelativePath),
      relativePath: normalizedRelativePath
    };
  }

  async executeBlock(
    request: ExecuteIntegralBlockRequest
  ): Promise<ExecuteIntegralBlockResult> {
    await this.ensureIntegralWorkspaceReady();

    const catalog = await this.listAssetCatalog();
    const definition = catalog.blockTypes.find(
      (candidate) =>
        candidate.pluginId === request.block.plugin &&
        candidate.blockType === request.block["block-type"]
    );

    if (!definition) {
      throw new Error(
        `block 定義が見つかりません: ${request.block.plugin}/${request.block["block-type"]}`
      );
    }

    const normalizedBlock = normalizeBlockDocument(request.block, definition);
    const resolvedBlock = await this.resolveBlockInputReferences(normalizedBlock, definition);

    if (definition.executionMode === "display") {
      const now = new Date().toISOString();

      return {
        block: normalizedBlock,
        createdDatasets: [],
        finishedAt: now,
        logLines: [],
        startedAt: now,
        status: "success",
        summary: "表示 block は実行不要です。"
      };
    }

    if (definition.source === "external-plugin") {
      return this.executeExternalPluginBlock(resolvedBlock, definition);
    }

    return this.executeGeneralAnalysisBlock(normalizedBlock, resolvedBlock, definition);
  }

  private getRootPath(): string {
    const rootPath = this.workspaceService.currentRootPath;

    if (!rootPath) {
      throw new Error("ワークスペースフォルダが未設定です。");
    }

    return rootPath;
  }

  private async ensureIntegralWorkspaceReady(): Promise<void> {
    await this.workspaceService.ensureWorkspaceReady();
    await this.ensureWorkspacePythonSdkReady();
    await this.ensureWorkspacePythonEditorSettingsReady();

    if (await this.reconcileManagedDataMetadata()) {
      await this.workspaceService.syncManagedDataNotes();
    }
  }

  private resolveWorkspacePath(relativePath: string): string {
    const rootPath = this.getRootPath();
    const parts = relativePath.split(/[\\/]+/u).filter(Boolean);
    const absolutePath = path.resolve(rootPath, ...parts);
    const normalizedRelative = path.relative(rootPath, absolutePath);

    if (normalizedRelative.startsWith("..") || path.isAbsolute(normalizedRelative)) {
      throw new Error("ワークスペース外のパスにはアクセスできません。");
    }

    return absolutePath;
  }

  private resolveStoreMetadataRootPath(): string {
    return this.resolveWorkspacePath(`${STORE_DIRECTORY}/${STORE_METADATA_DIRECTORY}`);
  }

  private resolveDatasetStagingRootPath(datasetId: string): string {
    return this.resolveWorkspacePath(
      `${STORE_DIRECTORY}/${STORE_METADATA_DIRECTORY}/${DATASET_STAGING_DIRECTORY}/${datasetId}`
    );
  }

  private createHiddenDatasetManifestRelativePath(datasetId: string): string {
    return normalizeRelativePath(
      `${STORE_DIRECTORY}/${STORE_METADATA_DIRECTORY}/${STORE_DATASET_MANIFESTS_DIRECTORY}/${datasetId}${DATASET_JSON_EXTENSION}`
    );
  }

  private resolvePythonRuntimeRootPath(blockId: string): string {
    return this.resolveWorkspacePath(
      `${STORE_DIRECTORY}/${STORE_METADATA_DIRECTORY}/${STORE_RUNTIME_DIRECTORY}/${blockId}`
    );
  }

  private resolveWorkspacePythonSdkPackagePath(): string {
    return this.resolveWorkspacePath(PYTHON_SDK_WORKSPACE_PACKAGE_DIRECTORY);
  }

  private resolveWorkspacePythonSdkImportRootPath(): string {
    return this.resolveWorkspacePath(PYTHON_SDK_WORKSPACE_IMPORT_ROOT_DIRECTORY);
  }

  private async ensureWorkspacePythonSdkReady(): Promise<void> {
    const sourcePackageRootPath = resolveBundledPythonSdkPackageTemplatePath();
    const targetPackageRootPath = this.resolveWorkspacePythonSdkPackagePath();

    if (areSameNormalizedPath(sourcePackageRootPath, targetPackageRootPath)) {
      return;
    }

    await syncDirectoryContents(sourcePackageRootPath, targetPackageRootPath);
  }

  private async ensureWorkspacePythonEditorSettingsReady(): Promise<void> {
    const settingsPath = this.resolveWorkspacePath(".vscode/settings.json");
    const currentSettings = (await readJsonFile<unknown>(settingsPath)) ?? {};
    const settingsRecord = isJsonRecord(currentSettings) ? { ...currentSettings } : {};

    const analysisExtraPaths = appendUniqueStringSetting(
      settingsRecord["python.analysis.extraPaths"],
      PYTHON_EDITOR_IMPORT_PATH
    );
    const autoCompleteExtraPaths = appendUniqueStringSetting(
      settingsRecord["python.autoComplete.extraPaths"],
      PYTHON_EDITOR_IMPORT_PATH
    );

    const nextSettings = {
      ...settingsRecord,
      "python.analysis.extraPaths": analysisExtraPaths,
      "python.autoComplete.extraPaths": autoCompleteExtraPaths
    };

    if (JSON.stringify(settingsRecord) === JSON.stringify(nextSettings)) {
      return;
    }

    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`, "utf8");
  }

  private async executeGeneralAnalysisBlock(
    sourceBlock: IntegralBlockDocument,
    resolvedBlock: IntegralBlockDocument,
    definition: IntegralBlockTypeDefinition
  ): Promise<ExecuteIntegralBlockResult> {
    if (definition.pluginId !== GENERAL_ANALYSIS_PLUGIN_ID) {
      throw new Error(`未対応の plugin 実行です: ${definition.pluginId}`);
    }

    for (const inputSlot of definition.inputSlots) {
      const datasetId = resolvedBlock.inputs[inputSlot.name];

      if (!datasetId) {
        throw new Error(`input slot が未設定です: ${inputSlot.name}`);
      }

      if ((await this.readDatasetMetadata(datasetId)) === null) {
        throw new Error(`input dataset が見つかりません: ${datasetId}`);
      }
    }

    const callable = parsePythonCallableBlockType(definition.blockType);

    if (!callable) {
      throw new Error(`Python callable を解決できません: ${definition.blockType}`);
    }

    const callableAbsolutePath = this.resolveWorkspacePath(callable.relativePath);
    const callableStats = await fs.stat(callableAbsolutePath).catch(() => null);

    if (!callableStats?.isFile()) {
      throw new Error(`Python file が見つかりません: ${callable.relativePath}`);
    }

    const runtimeRootPath = this.resolvePythonRuntimeRootPath(sourceBlock.id ?? resolvedBlock.id ?? createOpaqueId("BLK"));
    await resetDirectory(runtimeRootPath);
    const outputDatasetMap = new Map<string, IntegralDatasetSummary>();
    const outputPaths: Record<string, string | null> = {};
    const inputPaths: Record<string, string | null> = {};

    for (const inputSlot of definition.inputSlots) {
      const datasetId = resolvedBlock.inputs[inputSlot.name];

      if (!datasetId) {
        inputPaths[inputSlot.name] = null;
        continue;
      }

      const metadata = await this.readDatasetMetadata(datasetId);

      if (metadata === null) {
        throw new Error(`input dataset が見つかりません: ${datasetId}`);
      }

      inputPaths[inputSlot.name] = await this.resolveDatasetReadablePath(metadata);
    }

    for (const outputSlot of definition.outputSlots) {
      const nextDatasetId = createOpaqueId("DTS");
      const datasetDataPath = createDatasetObjectRelativePath(nextDatasetId);
      const datasetManifestPath = this.createHiddenDatasetManifestRelativePath(nextDatasetId);
      const datasetAbsolutePath = this.resolveWorkspacePath(datasetDataPath);
      const datasetManifestAbsolutePath = this.resolveWorkspacePath(datasetManifestPath);
      const metadata: DatasetMetadata = {
        createdAt: new Date().toISOString(),
        createdByBlockId: sourceBlock.id ?? resolvedBlock.id ?? null,
        dataPath: datasetDataPath,
        datasetId: nextDatasetId,
        displayName: nextDatasetId,
        entityType: "dataset",
        hash: "",
        id: nextDatasetId,
        kind: outputSlot.producedKind?.trim() || `${resolvedBlock["block-type"]}.${outputSlot.name}`,
        name: nextDatasetId,
        path: datasetManifestPath,
        provenance: "derived",
        representation: "dataset-json",
        visibility: "hidden"
      };
      const manifest: DatasetManifest = {
        dataPath: datasetDataPath,
        datasetId: nextDatasetId,
        kind: metadata.kind,
        name: nextDatasetId
      };

      await fs.mkdir(datasetAbsolutePath, { recursive: true });
      await fs.mkdir(path.dirname(datasetManifestAbsolutePath), { recursive: true });
      await fs.writeFile(datasetManifestAbsolutePath, JSON.stringify(manifest, null, 2), "utf8");
      metadata.hash = await this.computeManagedDataHash(
        datasetManifestAbsolutePath,
        metadata.representation
      );
      await this.writeDatasetMetadata(nextDatasetId, metadata);
      await this.writeDatasetNote(metadata);

      const datasetSummary = await this.readDatasetSummary(nextDatasetId);
      outputDatasetMap.set(outputSlot.name, datasetSummary);
      outputPaths[outputSlot.name] = datasetAbsolutePath;
    }

    const startedAt = new Date().toISOString();
    const analysisArgs = {
      inputs: inputPaths,
      outputs: outputPaths,
      params: isJsonRecord(resolvedBlock.params) ? resolvedBlock.params : {}
    };

    await fs.writeFile(
      path.join(runtimeRootPath, "analysis-args.json"),
      JSON.stringify(analysisArgs, null, 2),
      "utf8"
    );

    const pythonCommand = resolvePythonCommand();
    let stdout = "";
    let stderr = "";

    try {
      const execution = await execFileAsync(
        pythonCommand,
        [
          "-c",
          PYTHON_CALLABLE_RUNNER,
          callableAbsolutePath,
          callable.functionName,
          path.join(runtimeRootPath, "analysis-args.json"),
          this.resolveWorkspacePythonSdkImportRootPath()
        ],
        {
          cwd: this.getRootPath(),
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true
        }
      );

      stdout = execution.stdout ?? "";
      stderr = execution.stderr ?? "";
    } catch (error) {
      const executionError = error as ExecFileError;
      stdout = executionError.stdout ?? "";
      stderr = executionError.stderr ?? "";

      await this.writePythonExecutionLogs(runtimeRootPath, stdout, stderr);
      await this.refreshOutputDatasetMetadata(outputDatasetMap);
      await this.workspaceService.syncManagedDataNotes();

      throw new Error(
        [
          `${definition.title} の実行に失敗しました。`,
          stderr.trim() || stdout.trim() || executionError.message
        ]
          .filter(Boolean)
          .join("\n")
      );
    }

    await this.writePythonExecutionLogs(runtimeRootPath, stdout, stderr);
    await this.refreshOutputDatasetMetadata(outputDatasetMap);
    await this.workspaceService.syncManagedDataNotes();

    const finishedAt = new Date().toISOString();
    const createdDatasets = (
      await Promise.all(
        definition.outputSlots.map(async (slot) => {
          const datasetId = outputDatasetMap.get(slot.name)?.datasetId;
          return datasetId ? this.readDatasetSummary(datasetId).catch(() => null) : null;
        })
      )
    ).filter((dataset): dataset is IntegralDatasetSummary => dataset !== null);
    const createdDatasetMap = new Map(
      createdDatasets.map((dataset) => [dataset.datasetId, dataset] as const)
    );
    const outputReferences = Object.fromEntries(
      definition.outputSlots.map((slot) => {
        const datasetId = outputDatasetMap.get(slot.name)?.datasetId ?? null;
        const dataset = datasetId ? createdDatasetMap.get(datasetId) ?? null : null;
        return [slot.name, dataset ? toCanonicalWorkspaceTarget(dataset.path) : null];
      })
    );

    return {
      block: {
        ...sourceBlock,
        outputs: {
          ...sourceBlock.outputs,
          ...outputReferences
        }
      },
      createdDatasets,
      finishedAt,
      logLines: [...splitLogLines(stdout), ...splitLogLines(stderr)],
      startedAt,
      status: "success",
      summary: `${definition.title} を実行しました。`
    };
  }

  private async resolveBlockInputReferences(
    block: IntegralBlockDocument,
    definition: IntegralBlockTypeDefinition
  ): Promise<IntegralBlockDocument> {
    const resolvedInputs: Record<string, string | null> = {};

    for (const inputSlot of definition.inputSlots) {
      const inputReference = block.inputs[inputSlot.name];

      if (!inputReference) {
        resolvedInputs[inputSlot.name] = null;
        continue;
      }

      const metadata = await this.resolveDatasetReferenceMetadata(inputReference);

      if (!metadata) {
        throw new Error(`input dataset が見つかりません: ${inputReference}`);
      }

      resolvedInputs[inputSlot.name] = metadata.datasetId;
    }

    return {
      ...block,
      inputs: {
        ...block.inputs,
        ...resolvedInputs
      }
    };
  }

  private async resolveDatasetReferenceMetadata(reference: string): Promise<DatasetMetadata | null> {
    const normalizedReference = reference.trim();

    if (normalizedReference.length === 0) {
      return null;
    }

    const datasetById = await this.readDatasetMetadata(normalizedReference);

    if (datasetById) {
      return datasetById;
    }

    const workspacePath =
      resolveWorkspaceMarkdownTarget(normalizedReference) ?? normalizeRelativePath(normalizedReference);

    if (workspacePath.length === 0) {
      return null;
    }

    return this.findDatasetMetadataByPath(workspacePath);
  }

  private async findDatasetMetadataByPath(relativePath: string): Promise<DatasetMetadata | null> {
    const normalizedRelativePath = normalizeRelativePath(relativePath);
    const metadataList = await this.readManagedDataMetadataList();

    return (
      metadataList.find(
        (metadata): metadata is DatasetMetadata =>
          metadata.entityType === "dataset" && metadata.path === normalizedRelativePath
      ) ?? null
    );
  }

  private async executeExternalPluginBlock(
    block: IntegralBlockDocument,
    definition: IntegralBlockTypeDefinition
  ): Promise<ExecuteIntegralBlockResult> {
    const externalPlugin = definition.externalPlugin;
    const defaultAction = externalPlugin?.actions?.[0];

    if (!externalPlugin) {
      throw new Error(`external plugin 情報が見つかりません: ${definition.pluginId}`);
    }

    if (!defaultAction) {
      throw new Error(`plugin action が定義されていません: ${definition.pluginId}`);
    }

    const result = await this.pluginRegistry.executeAction({
      actionId: defaultAction.id,
      blockType: externalPlugin.runtimeBlockType,
      params: block.params,
      payload: JSON.stringify(block, null, 2)
    });

    return {
      block,
      createdDatasets: [],
      finishedAt: result.finishedAt,
      logLines: result.logLines,
      startedAt: result.startedAt,
      status: "success",
      summary: result.summary
    };
  }

  private async writeOriginalDataMetadata(originalDataId: string, metadata: OriginalDataMetadata): Promise<void> {
    await fs.mkdir(this.resolveStoreMetadataRootPath(), { recursive: true });
    await fs.writeFile(
      path.join(this.resolveStoreMetadataRootPath(), `${originalDataId}.json`),
      JSON.stringify(metadata, null, 2),
      "utf8"
    );
  }

  private async writeDatasetMetadata(datasetId: string, metadata: DatasetMetadata): Promise<void> {
    await fs.mkdir(this.resolveStoreMetadataRootPath(), { recursive: true });
    await fs.writeFile(
      path.join(this.resolveStoreMetadataRootPath(), `${datasetId}.json`),
      JSON.stringify(metadata, null, 2),
      "utf8"
    );
  }

  private async writeOriginalDataNote(_metadata: OriginalDataMetadata): Promise<void> {
    await this.workspaceService.syncManagedDataNotes();
  }

  private async writeDatasetNote(_metadata: DatasetMetadata): Promise<void> {
    await this.workspaceService.syncManagedDataNotes();
  }

  private async applyTrackedPathResolution(
    metadata: OriginalDataMetadata | DatasetMetadata,
    selectedPath: string
  ): Promise<void> {
    const absolutePath = this.resolveWorkspacePath(selectedPath);
    const stats = await fs.stat(absolutePath);
    const expectedKind = metadata.representation === "directory" ? "directory" : "file";
    const actualKind = stats.isDirectory() ? "directory" : "file";

    if (expectedKind !== actualKind) {
      throw new Error("選択した path の種別が metadata と一致しません。");
    }

    if (metadata.representation === "dataset-json" && path.extname(selectedPath).toLowerCase() !== DATASET_JSON_EXTENSION) {
      throw new Error("dataset manifest (`*.idts`) を選択してください。");
    }

    const nextPath = normalizeRelativePath(selectedPath);

    if (metadata.entityType === "original-data") {
      const nextMetadata: OriginalDataMetadata = {
        ...metadata,
        hash: await this.computeManagedDataHash(absolutePath, metadata.representation),
        objectPath: undefined,
        path: nextPath,
        visibility: inferVisibilityFromPath(nextPath)
      };

      await this.writeOriginalDataMetadata(nextMetadata.originalDataId, nextMetadata);
    } else {
      const nextMetadata: DatasetMetadata = {
        ...metadata,
        hash: await this.computeManagedDataHash(absolutePath, metadata.representation),
        path: nextPath,
        visibility: inferVisibilityFromPath(nextPath)
      };

      await this.refreshDatasetManifestFields(nextMetadata);
      await this.writeDatasetMetadata(nextMetadata.datasetId, nextMetadata);
    }

    const hasChanges = await this.reconcileManagedDataMetadata();

    if (hasChanges) {
      await this.workspaceService.syncManagedDataNotes();
      return;
    }

    await this.workspaceService.syncManagedDataNotes();
  }

  private async writePythonExecutionLogs(
    scriptRootPath: string,
    stdout: string,
    stderr: string
  ): Promise<void> {
    await Promise.all([
      fs.writeFile(path.join(scriptRootPath, "stdout.log"), stdout, "utf8"),
      fs.writeFile(path.join(scriptRootPath, "stderr.log"), stderr, "utf8")
    ]);
  }

  private async readOriginalDataMetadata(originalDataId: string): Promise<OriginalDataMetadata | null> {
    const rawMetadata = await readJsonFile<unknown>(
      path.join(this.resolveStoreMetadataRootPath(), `${originalDataId}.json`)
    );

    return normalizeOriginalDataMetadata(rawMetadata);
  }

  private async readManagedDataMetadataList(): Promise<ManagedDataMetadata[]> {
    const metadataRootPath = this.resolveStoreMetadataRootPath();
    const entries = await fs.readdir(metadataRootPath, { withFileTypes: true });
    const metadataList = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".json")
        .map(async (entry) => {
          const rawMetadata = await readJsonFile<unknown>(path.join(metadataRootPath, entry.name));
          return normalizeOriginalDataMetadata(rawMetadata) ?? normalizeDatasetMetadata(rawMetadata);
        })
    );

    return metadataList.filter((metadata): metadata is ManagedDataMetadata => metadata !== null);
  }

  private shouldReconcileManagedDataMetadata(
    mutations: readonly WorkspaceMutation[],
    metadataList: readonly ManagedDataMetadata[]
  ): boolean {
    if (
      mutations.some((mutation) =>
        metadataList.some((metadata) => doesWorkspaceMutationAffectManagedData(mutation, metadata))
      )
    ) {
      return true;
    }

    if (this.pendingTrackingIssues.length === 0) {
      return false;
    }

    return mutations.some((mutation) => mutation.kind !== "modify");
  }

  private async findOriginalDataMetadataByPath(relativePath: string): Promise<OriginalDataMetadata | null> {
    const metadataRootPath = this.resolveStoreMetadataRootPath();
    const entries = await fs.readdir(metadataRootPath, { withFileTypes: true });
    const normalizedRelativePath = normalizeRelativePath(relativePath);

    for (const entry of entries) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") {
        continue;
      }

      const rawMetadata = await readJsonFile<unknown>(path.join(metadataRootPath, entry.name));
      const metadata = normalizeOriginalDataMetadata(rawMetadata);

      if (metadata && normalizeRelativePath(metadata.path) === normalizedRelativePath) {
        return metadata;
      }
    }

    return null;
  }

  private async readDatasetMetadata(datasetId: string): Promise<DatasetMetadata | null> {
    const rawMetadata = await readJsonFile<unknown>(
      path.join(this.resolveStoreMetadataRootPath(), `${datasetId}.json`)
    );

    return normalizeDatasetMetadata(rawMetadata);
  }

  private async readOriginalDataSummaries(): Promise<IntegralOriginalDataSummary[]> {
    const metadataRootPath = this.resolveStoreMetadataRootPath();
    const entries = await fs.readdir(metadataRootPath, { withFileTypes: true });
    const summaries = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".json")
        .map(async (entry) => {
          const rawMetadata = await readJsonFile<unknown>(path.join(metadataRootPath, entry.name));
          const metadata = normalizeOriginalDataMetadata(rawMetadata);

          return metadata ? this.toOriginalDataSummary(metadata) : null;
        })
    );

    return summaries
      .filter((summary): summary is IntegralOriginalDataSummary => summary !== null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  private async readDatasetSummaries(): Promise<IntegralDatasetSummary[]> {
    const metadataRootPath = this.resolveStoreMetadataRootPath();
    const entries = await fs.readdir(metadataRootPath, { withFileTypes: true });
    const summaries = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".json")
        .map(async (entry) => {
          const rawMetadata = await readJsonFile<unknown>(path.join(metadataRootPath, entry.name));
          const metadata = normalizeDatasetMetadata(rawMetadata);

          return metadata ? this.readDatasetSummary(metadata.datasetId).catch(() => null) : null;
        })
    );

    return summaries
      .filter((summary): summary is IntegralDatasetSummary => summary !== null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  private async readDatasetSummary(datasetId: string): Promise<IntegralDatasetSummary> {
    const metadata = await this.readDatasetMetadata(datasetId);

    if (metadata === null) {
      throw new Error(`dataset が見つかりません: ${datasetId}`);
    }

    const datasetRootPath = await this.resolveDatasetReadablePath(metadata);
    const inspectableFiles = await this.collectInspectableFiles(datasetRootPath, metadata);
    const installedPlugins = await this.pluginRegistry.listInstalledPlugins();
    const renderableCount = inspectableFiles.filter((entry) =>
      isRenderableExtension(path.extname(entry.relativePath), installedPlugins)
    ).length;

    return {
      datasetId: metadata.datasetId,
      createdAt: metadata.createdAt,
      createdByBlockId: metadata.createdByBlockId,
      hash: metadata.hash,
      hasRenderableFiles: renderableCount > 0,
      kind: metadata.kind,
      memberIds: metadata.memberIds,
      name: metadata.name,
      path: metadata.path,
      provenance: metadata.provenance,
      representation: metadata.representation,
      renderableCount,
      visibility: metadata.visibility
    };
  }

  private async readPythonCallableSummaries(): Promise<PythonCallableSummary[]> {
    const rootPath = this.getRootPath();
    const pythonRelativePaths = await collectWorkspacePythonRelativePaths(rootPath);
    const callables = (
      await Promise.all(
        pythonRelativePaths.map(async (relativePath) => {
          const absolutePath = this.resolveWorkspacePath(relativePath);
          const content = await fs.readFile(absolutePath, "utf8");
          return parsePythonCallableSource(relativePath, content);
        })
      )
    ).flat();

    return callables.sort((left, right) =>
      `${left.displayName} ${left.blockType}`.localeCompare(
        `${right.displayName} ${right.blockType}`,
        "ja"
      )
    );
  }

  private async readRenderableFile(
    absolutePath: string,
    relativePath: string,
    installedPlugins: readonly InstalledPluginDefinition[]
  ): Promise<IntegralRenderableFile | null> {
    const extension = path.extname(relativePath).toLowerCase();
    const pluginViewer = findInstalledPluginViewerByExtension(installedPlugins, extension);

    if (pluginViewer) {
      const payload = await readPluginViewerPayload(absolutePath, extension);

      return {
        data: payload.data,
        kind: "plugin",
        name: path.basename(relativePath),
        pluginViewer: buildResolvedPluginViewer(pluginViewer.plugin, pluginViewer.viewer, payload),
        relativePath
      };
    }

    if (HTML_EXTENSIONS.has(extension)) {
      return {
        data: injectHtmlBaseTag(await fs.readFile(absolutePath, "utf8"), path.dirname(absolutePath)),
        kind: "html",
        name: path.basename(relativePath),
        relativePath
      };
    }

    if (IMAGE_EXTENSIONS.has(extension)) {
      const buffer = await fs.readFile(absolutePath);

      return {
        data: `data:${inferMimeType(absolutePath)};base64,${buffer.toString("base64")}`,
        kind: "image",
        name: path.basename(relativePath),
        relativePath
      };
    }

    if (TEXT_EXTENSIONS.has(extension)) {
      return {
        data: await fs.readFile(absolutePath, "utf8"),
        kind: "text",
        name: path.basename(relativePath),
        relativePath
      };
    }

    return null;
  }

  private async collectInspectableFiles(
    datasetRootPath: string,
    _metadata: DatasetMetadata
  ): Promise<InspectableFileEntry[]> {
    const relativeFilePaths = await collectRelativeFiles(datasetRootPath);

    return relativeFilePaths
      .map((relativePath) => ({
        absolutePath: path.join(datasetRootPath, relativePath),
        relativePath
      }))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath, "ja"));
  }

  private async toOriginalDataSummary(
    metadata: OriginalDataMetadata
  ): Promise<IntegralOriginalDataSummary> {
    return {
      createdAt: metadata.createdAt,
      displayName: metadata.displayName,
      hash: metadata.hash,
      originalDataId: metadata.originalDataId,
      path: metadata.path,
      provenance: metadata.provenance,
      representation: metadata.representation,
      visibility: metadata.visibility
    };
  }

  private resolveOriginalDataContentPath(metadata: OriginalDataMetadata): string {
    return this.resolveWorkspacePath(metadata.path);
  }
  private isWorkspacePath(rootPath: string, absolutePath: string): boolean {
    const normalizedRelative = path.relative(rootPath, absolutePath);
    return normalizedRelative.length === 0 || (!normalizedRelative.startsWith("..") && !path.isAbsolute(normalizedRelative));
  }

  private assertRegisterableOriginalDataPath(rootPath: string, absolutePath: string): void {
    const normalizedRelative = path.relative(rootPath, absolutePath);

    if (normalizedRelative.length === 0) {
      throw new Error("ワークスペース root 自体は元データ登録できません。");
    }

    const topLevelSegment = normalizedRelative.split(path.sep).filter(Boolean)[0] ?? "";

    if (topLevelSegment === STORE_DIRECTORY) {
      throw new Error("system 管理ディレクトリ配下は元データ登録できません。");
    }
  }

  private async resolveOriginalDataVisiblePath(
    rootPath: string,
    sourceAbsolutePath: string,
    originalDataId: string,
    representation: OriginalDataRepresentation
  ): Promise<string> {
    if (this.isWorkspacePath(rootPath, sourceAbsolutePath)) {
      return path.relative(rootPath, sourceAbsolutePath).split(path.sep).join("/");
    }

    const dataRootPath = this.resolveWorkspacePath(DATA_DIRECTORY);
    await fs.mkdir(dataRootPath, { recursive: true });

    const preferredRelativePath = `${DATA_DIRECTORY}/${path.basename(sourceAbsolutePath)}`;
    const preferredAbsolutePath = this.resolveWorkspacePath(preferredRelativePath);

    if (!(await pathExists(preferredAbsolutePath))) {
      return preferredRelativePath;
    }

    return `${DATA_DIRECTORY}/${createVisibleAliasEntryName(
      path.basename(sourceAbsolutePath),
      originalDataId,
      representation
    )}`;
  }

  private async copyOriginalDataIntoWorkspace(
    sourcePath: string,
    destinationPath: string,
    representation: OriginalDataRepresentation
  ): Promise<void> {
    if (representation === "directory") {
      await fs.cp(sourcePath, destinationPath, { force: false, recursive: true });
      return;
    }

    await fs.copyFile(sourcePath, destinationPath);
  }

  private async createVisibleAlias(
    targetPath: string,
    aliasPath: string,
    representation: OriginalDataRepresentation
  ): Promise<void> {
    if (representation === "directory") {
      await fs.symlink(targetPath, aliasPath, "junction");
      return;
    }

    await fs.link(targetPath, aliasPath);
  }

  private async createSourceDatasetManifestRelativePath(
    datasetName: string,
    datasetId: string
  ): Promise<string> {
    const datasetsRootPath = this.resolveWorkspacePath(DATASETS_DIRECTORY);
    await fs.mkdir(datasetsRootPath, { recursive: true });

    const preferredStem = sanitizeFileStem(datasetName) || datasetId;
    let serial = 0;

    while (true) {
      const suffix = serial === 0 ? "" : `_${serial}`;
      const relativePath = `${DATASETS_DIRECTORY}/${preferredStem}${suffix}${DATASET_JSON_EXTENSION}`;

      if (!(await pathExists(this.resolveWorkspacePath(relativePath)))) {
        return relativePath;
      }

      serial += 1;
    }
  }

  private async resolveDatasetReadablePath(metadata: DatasetMetadata): Promise<string> {
    if (metadata.representation === "directory") {
      return this.resolveWorkspacePath(metadata.path);
    }

    const manifest = await this.readDatasetManifest(metadata.path);

    if (manifest?.dataPath) {
      return this.resolveWorkspacePath(manifest.dataPath);
    }

    return this.materializeSourceDataset(metadata, manifest);
  }

  private async materializeSourceDataset(
    metadata: DatasetMetadata,
    manifest?: DatasetManifest | null
  ): Promise<string> {
    const stagingRootPath = this.resolveDatasetStagingRootPath(metadata.datasetId);
    await resetDirectory(stagingRootPath);

    const memberIds = metadata.memberIds ?? manifest?.memberIds ?? [];
    const usedEntryNames = new Set<string>();

    for (const memberId of memberIds) {
      const originalDataMetadata = await this.readOriginalDataMetadata(memberId);

      if (originalDataMetadata === null) {
        continue;
      }

      const entryName = createUniqueSourceMemberEntryName(
        originalDataMetadata.displayName,
        memberId,
        usedEntryNames
      );

      await this.createVisibleAlias(
        this.resolveOriginalDataContentPath(originalDataMetadata),
        path.join(stagingRootPath, entryName),
        originalDataMetadata.representation
      );
    }

    return stagingRootPath;
  }

  private async readDatasetManifest(
    relativePath: string
  ): Promise<DatasetManifest | null> {
    const manifest = await readJsonFile<DatasetManifest>(
      this.resolveWorkspacePath(relativePath)
    );

    if (
      !manifest ||
      typeof manifest.datasetId !== "string" ||
      typeof manifest.name !== "string" ||
      typeof manifest.kind !== "string" ||
      (manifest.memberIds !== undefined &&
        (!Array.isArray(manifest.memberIds) ||
          !manifest.memberIds.every((item) => typeof item === "string"))) ||
      (manifest.dataPath !== undefined && typeof manifest.dataPath !== "string")
    ) {
      return null;
    }

    return {
      dataPath:
        typeof manifest.dataPath === "string" && manifest.dataPath.trim().length > 0
          ? normalizeRelativePath(manifest.dataPath)
          : undefined,
      datasetId: manifest.datasetId.trim(),
      kind: manifest.kind,
      memberIds: Array.isArray(manifest.memberIds)
        ? manifest.memberIds.map((item) => item.trim()).filter(Boolean)
        : undefined,
      name: manifest.name
    };
  }

  private async refreshDatasetManifestFields(metadata: DatasetMetadata): Promise<void> {
    if (metadata.representation !== "dataset-json") {
      return;
    }

    const manifest = await this.readDatasetManifest(metadata.path);

    if (!manifest) {
      return;
    }

    metadata.dataPath = manifest.dataPath;
    metadata.memberIds = manifest.memberIds;
    metadata.name = normalizeDatasetName(manifest.name, metadata.datasetId);
    metadata.displayName = metadata.name;
    metadata.kind = manifest.kind;
  }

  private async readDatasetManifestMember(
    originalDataId: string
  ): Promise<WorkspaceDatasetManifestMember> {
    const normalizedOriginalDataId = originalDataId.trim();
    const metadata =
      normalizedOriginalDataId.length > 0
        ? await this.readOriginalDataMetadata(normalizedOriginalDataId)
        : null;

    return {
      displayName:
        metadata?.displayName ??
        (normalizedOriginalDataId.length > 0 ? normalizedOriginalDataId : "(unknown)"),
      originalDataId: normalizedOriginalDataId,
      relativePath: metadata?.path ?? null,
      representation: metadata?.representation ?? null
    };
  }

  private async readManagedDataNoteBody(targetId: string): Promise<string | null> {
    const normalizedTargetId = targetId.trim();

    if (normalizedTargetId.length === 0) {
      return null;
    }

    try {
      const note = await this.workspaceService.readNote(
        `${STORE_DIRECTORY}/${STORE_METADATA_DIRECTORY}/data-notes/${normalizedTargetId}.md`
      );
      return note.content;
    } catch {
      return null;
    }
  }

  private async computeManagedDataHash(
    absolutePath: string,
    representation: OriginalDataRepresentation | DatasetRepresentation
  ): Promise<string> {
    if (representation === "directory") {
      return computeDirectoryHash(absolutePath);
    }

    return computeFileHash(absolutePath);
  }

  private async refreshOutputDatasetMetadata(
    outputDatasetMap: ReadonlyMap<string, IntegralDatasetSummary>
  ): Promise<void> {
    for (const summary of outputDatasetMap.values()) {
      const metadata = await this.readDatasetMetadata(summary.datasetId);

      if (metadata === null) {
        continue;
      }

      metadata.hash = await this.computeManagedDataHash(
        this.resolveWorkspacePath(metadata.path),
        metadata.representation
      );
      await this.writeDatasetMetadata(metadata.datasetId, metadata);
    }
  }

  private async reconcileManagedDataMetadata(): Promise<boolean> {
    const metadataRootPath = this.resolveStoreMetadataRootPath();
    const entries = await fs.readdir(metadataRootPath, { withFileTypes: true });
    const workspaceEntries = await collectTrackableWorkspaceEntries(this.getRootPath());
    const originalDataMetadataList: OriginalDataMetadata[] = [];
    const datasetMetadataList: DatasetMetadata[] = [];
    const claimedPaths = new Set<string>();
    const pendingIssues: IntegralManagedDataTrackingIssue[] = [];
    let hasChanges = false;

    for (const entry of entries) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") {
        continue;
      }

      const filePath = path.join(metadataRootPath, entry.name);
      const rawMetadata = await readJsonFile<unknown>(filePath);
      const originalDataMetadata = normalizeOriginalDataMetadata(rawMetadata);

      if (originalDataMetadata) {
        originalDataMetadataList.push(originalDataMetadata);
        continue;
      }

      const datasetMetadata = normalizeDatasetMetadata(rawMetadata);

      if (!datasetMetadata) {
        continue;
      }
      datasetMetadataList.push(datasetMetadata);
    }

    for (const metadata of [...originalDataMetadataList, ...datasetMetadataList]) {
      if (await this.resolveIfExists(metadata.path)) {
        claimedPaths.add(metadata.path);
      }
    }

    for (const metadata of originalDataMetadataList) {
      const reconciled = await this.reconcileOriginalDataMetadata(
        metadata,
        workspaceEntries,
        claimedPaths
      );

      if (reconciled.issue) {
        pendingIssues.push(reconciled.issue);
      }

      if (!areOriginalDataMetadataEqual(metadata, reconciled.metadata)) {
        await this.writeOriginalDataMetadata(reconciled.metadata.originalDataId, reconciled.metadata);
        hasChanges = true;
      }
    }

    for (const metadata of datasetMetadataList) {
      const reconciled = await this.reconcileDatasetMetadata(
        metadata,
        workspaceEntries,
        claimedPaths
      );

      if (reconciled.issue) {
        pendingIssues.push(reconciled.issue);
      }

      if (!areDatasetMetadataEqual(metadata, reconciled.metadata)) {
        await this.writeDatasetMetadata(reconciled.metadata.datasetId, reconciled.metadata);
        hasChanges = true;
      }
    }

    this.pendingTrackingIssues = pendingIssues.sort((left, right) =>
      `${left.displayName} ${left.targetId}`.localeCompare(
        `${right.displayName} ${right.targetId}`,
        "ja"
      )
    );

    return hasChanges;
  }

  private async reconcileOriginalDataMetadata(
    metadata: OriginalDataMetadata,
    workspaceEntries: readonly TrackableWorkspaceEntry[],
    claimedPaths: Set<string>
  ): Promise<ReconcileMetadataResult<OriginalDataMetadata>> {
    const nextMetadata: OriginalDataMetadata = {
      ...metadata,
      objectPath: undefined
    };
    const currentVisiblePath = await this.resolveIfExists(metadata.path);

    if (currentVisiblePath) {
      nextMetadata.hash = await this.computeManagedDataHash(currentVisiblePath, metadata.representation);
      nextMetadata.visibility = inferVisibilityFromPath(metadata.path);
      claimedPaths.add(metadata.path);
      return {
        metadata: nextMetadata
      };
    }

    const matchedPath = findUniqueMatchingPathByHash(
      workspaceEntries,
      metadata.hash,
      metadata.representation,
      claimedPaths
    );

    if (matchedPath) {
      nextMetadata.path = matchedPath.relativePath;
      nextMetadata.hash = await this.computeManagedDataHash(
        matchedPath.absolutePath,
        metadata.representation
      );
      nextMetadata.visibility = inferVisibilityFromPath(matchedPath.relativePath);
      claimedPaths.add(nextMetadata.path);

      return {
        metadata: nextMetadata
      };
    }

    const candidatePaths = findTrackingCandidatePaths(workspaceEntries, nextMetadata, claimedPaths);

    if (candidatePaths.length === 1) {
      nextMetadata.path = candidatePaths[0].relativePath;
      nextMetadata.hash = await this.computeManagedDataHash(
        candidatePaths[0].absolutePath,
        metadata.representation
      );
      nextMetadata.visibility = inferVisibilityFromPath(candidatePaths[0].relativePath);
      claimedPaths.add(nextMetadata.path);
      return {
        metadata: nextMetadata
      };
    }

    return {
      issue:
        candidatePaths.length > 1
          ? buildTrackingIssue(nextMetadata, candidatePaths)
          : undefined,
      metadata: nextMetadata
    };
  }

  private async reconcileDatasetMetadata(
    metadata: DatasetMetadata,
    workspaceEntries: readonly TrackableWorkspaceEntry[],
    claimedPaths: Set<string>
  ): Promise<ReconcileMetadataResult<DatasetMetadata>> {
    const nextMetadata = { ...metadata };
    const currentPath = await this.resolveIfExists(metadata.path);

    if (currentPath) {
      nextMetadata.hash = await this.computeManagedDataHash(currentPath, metadata.representation);
      nextMetadata.visibility = inferVisibilityFromPath(metadata.path);
      await this.refreshDatasetManifestFields(nextMetadata);
      claimedPaths.add(metadata.path);
      return {
        metadata: nextMetadata
      };
    }

    const matchedPath = findUniqueMatchingPathByHash(
      workspaceEntries,
      metadata.hash,
      metadata.representation,
      claimedPaths
    );

    if (matchedPath) {
      nextMetadata.path = matchedPath.relativePath;
      nextMetadata.hash = await this.computeManagedDataHash(
        matchedPath.absolutePath,
        metadata.representation
      );
      nextMetadata.visibility = inferVisibilityFromPath(matchedPath.relativePath);
      await this.refreshDatasetManifestFields(nextMetadata);
      claimedPaths.add(nextMetadata.path);

      return {
        metadata: nextMetadata
      };
    }

    const candidatePaths = findTrackingCandidatePaths(workspaceEntries, nextMetadata, claimedPaths);

    if (candidatePaths.length === 1) {
      nextMetadata.path = candidatePaths[0].relativePath;
      nextMetadata.hash = await this.computeManagedDataHash(
        candidatePaths[0].absolutePath,
        metadata.representation
      );
      nextMetadata.visibility = inferVisibilityFromPath(candidatePaths[0].relativePath);
      await this.refreshDatasetManifestFields(nextMetadata);
      claimedPaths.add(nextMetadata.path);
      return {
        metadata: nextMetadata
      };
    }

    return {
      issue:
        candidatePaths.length > 1
          ? buildTrackingIssue(nextMetadata, candidatePaths)
          : undefined,
      metadata: nextMetadata
    };
  }

  private async resolveIfExists(relativePath: string): Promise<string | null> {
    try {
      const absolutePath = this.resolveWorkspacePath(relativePath);
      return (await pathExists(absolutePath)) ? absolutePath : null;
    } catch {
      return null;
    }
  }
}

function buildBlockTypeCatalog(
  pythonCallables: readonly PythonCallableSummary[],
  externalPlugins: readonly InstalledPluginDefinition[]
): IntegralBlockTypeDefinition[] {
  return [
    buildDisplayBlockType(),
    ...pythonCallables.map((callable) => buildPythonCallableBlockType(callable)),
    ...buildExternalPluginBlockTypes(externalPlugins)
  ];
}

function buildExternalPluginBlockTypes(
  plugins: readonly InstalledPluginDefinition[]
): IntegralBlockTypeDefinition[] {
  const blockTypes: IntegralBlockTypeDefinition[] = [];
  const seenDefinitions = new Set<string>();

  for (const plugin of plugins) {
    if (plugin.id === STANDARD_GRAPHS_PLUGIN_ID) {
      continue;
    }

    for (const block of plugin.blocks) {
      const definition =
        plugin.id === SHIMADZU_PLUGIN_ID && block.type === SHIMADZU_BLOCK_TYPE
          ? buildShimadzuBlockType(plugin, block)
          : buildGenericExternalPluginBlockType(plugin, block);
      const definitionKey = `${definition.pluginId}:${definition.blockType}`;

      if (seenDefinitions.has(definitionKey)) {
        continue;
      }

      seenDefinitions.add(definitionKey);
      blockTypes.push(definition);
    }
  }

  return blockTypes.sort((left, right) =>
    `${left.pluginDisplayName} ${left.title}`.localeCompare(
      `${right.pluginDisplayName} ${right.title}`,
      "ja"
    )
  );
}

function buildShimadzuBlockType(
  plugin: InstalledPluginDefinition,
  block: InstalledPluginDefinition["blocks"][number]
): IntegralBlockTypeDefinition {
  return {
    blockType: SHIMADZU_BLOCK_TYPE,
    description: "LC のシーケンス条件を編集し、装置操作を実行します。",
    executionMode: "manual",
    externalPlugin: {
      actions: block.actions?.map((action) => ({ ...action })),
      namespace: plugin.namespace,
      origin: plugin.origin,
      rendererMode: plugin.hasRenderer ? "iframe" : undefined,
      runtimeBlockType: block.type,
      runtimePluginId: plugin.id,
      version: plugin.version
    },
    inputSlots: [
      {
        name: "method"
      }
    ],
    outputSlots: [
      {
        name: "raw-result",
        producedKind: "shimadzu-lc.raw-result"
      }
    ],
    pluginDescription: plugin.description,
    pluginDisplayName: plugin.displayName,
    pluginId: SHIMADZU_PLUGIN_ID,
    source: "external-plugin",
    title: "Run Sequence"
  };
}

function buildGenericExternalPluginBlockType(
  plugin: InstalledPluginDefinition,
  block: InstalledPluginDefinition["blocks"][number]
): IntegralBlockTypeDefinition {
  return {
    blockType: block.type,
    description: block.description,
    executionMode: "manual",
    externalPlugin: {
      actions: block.actions?.map((action) => ({ ...action })),
      namespace: plugin.namespace,
      origin: plugin.origin,
      rendererMode: plugin.hasRenderer ? "iframe" : undefined,
      runtimeBlockType: block.type,
      runtimePluginId: plugin.id,
      version: plugin.version
    },
    inputSlots: [],
    outputSlots: [],
    pluginDescription: plugin.description,
    pluginDisplayName: plugin.displayName,
    pluginId: plugin.id,
    source: "external-plugin",
    title: block.title
  };
}

function buildDisplayBlockType(): IntegralBlockTypeDefinition {
  return {
    blockType: DISPLAY_BLOCK_TYPE,
    description: "dataset 内の html / image / text を自動検出して標準表示します。",
    executionMode: "display",
    inputSlots: [
      {
        name: "source"
      }
    ],
    outputSlots: [],
    pluginDescription: "app 内蔵の標準表示 plugin",
    pluginDisplayName: "Core Display",
    pluginId: BUILTIN_DISPLAY_PLUGIN_ID,
    source: "builtin",
    title: "Dataset Viewer"
  };
}

function buildPythonCallableBlockType(
  callable: PythonCallableSummary
): IntegralBlockTypeDefinition {
  return {
    blockType: callable.blockType,
    description:
      callable.description.trim().length > 0
        ? callable.description
        : `${callable.relativePath}:${callable.functionName} を実行する Python block`,
    executionMode: "manual",
    inputSlots: callable.inputSlots,
    outputSlots: callable.outputSlots,
    pluginDescription: "workspace の .py を走査する汎用 Python 解析 plugin",
    pluginDisplayName: "General Analysis",
    pluginId: GENERAL_ANALYSIS_PLUGIN_ID,
    source: "python-callable",
    title: callable.displayName
  };
}

function normalizeBlockDocument(
  block: IntegralBlockDocument,
  definition: IntegralBlockTypeDefinition
): IntegralBlockDocument {
  const blockId =
    typeof block.id === "string" && block.id.trim().length > 0
      ? block.id.trim()
      : createOpaqueId("BLK");

  return {
    "block-type": definition.blockType,
    id: blockId,
    inputs: normalizeSlotMap(block.inputs, definition.inputSlots),
    outputs: normalizeSlotMap(block.outputs, definition.outputSlots),
    params: isJsonRecord(block.params) ? block.params : {},
    plugin: definition.pluginId
  };
}

function normalizeSlotMap(
  currentValue: Record<string, string | null> | undefined,
  slotDefinitions: readonly IntegralSlotDefinition[]
): Record<string, string | null> {
  const normalized: Record<string, string | null> = {};

  for (const slot of slotDefinitions) {
    const value = currentValue?.[slot.name];
    normalized[slot.name] =
      typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  return normalized;
}

function normalizeDatasetName(name: string | undefined, datasetId: string): string {
  const normalizedName = name?.trim();

  if (normalizedName && normalizedName.length > 0) {
    return normalizedName;
  }

  const normalizedDatasetId = datasetId.trim();
  return normalizedDatasetId.length > 0 ? normalizedDatasetId : "dataset";
}

function createOpaqueId(prefix: "ORD" | "BLK" | "DTS"): string {
  return `${prefix}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

async function collectWorkspacePythonRelativePaths(
  rootPath: string,
  currentRelativePath = ""
): Promise<string[]> {
  const currentAbsolutePath =
    currentRelativePath.length === 0
      ? rootPath
      : path.join(rootPath, ...currentRelativePath.split("/"));
  const entries = await fs.readdir(currentAbsolutePath, { withFileTypes: true });
  const pythonPaths: string[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "ja"))) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const nextRelativePath =
      currentRelativePath.length === 0 ? entry.name : `${currentRelativePath}/${entry.name}`;

    if (entry.isDirectory()) {
      pythonPaths.push(...(await collectWorkspacePythonRelativePaths(rootPath, nextRelativePath)));
      continue;
    }

    if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".py") {
      pythonPaths.push(nextRelativePath);
    }
  }

  return pythonPaths;
}

function parsePythonCallableSource(relativePath: string, content: string): PythonCallableSummary[] {
  const summaries: PythonCallableSummary[] = [];

  for (const match of content.matchAll(PYTHON_CALLABLE_PATTERN)) {
    const decoratorSource = match[1] ?? "";
    const functionName = match[2]?.trim() ?? "";

    if (functionName.length === 0) {
      continue;
    }

    const displayName =
      parsePythonStringLiteral(extractPythonKeywordSource(decoratorSource, "display_name")) ??
      functionName;
    const description =
      parsePythonStringLiteral(extractPythonKeywordSource(decoratorSource, "description")) ?? "";
    const inputSlots = normalizeDiscoveredSlotNames(
      parsePythonStringArrayLiteral(extractPythonKeywordSource(decoratorSource, "inputs"))
    ).map((name) => ({ name }));
    const outputSlots = normalizeDiscoveredSlotNames(
      parsePythonStringArrayLiteral(extractPythonKeywordSource(decoratorSource, "outputs"))
    ).map((name) => ({ name }));

    summaries.push({
      blockType: `${relativePath}:${functionName}`,
      description,
      displayName,
      functionName,
      inputSlots,
      outputSlots,
      relativePath
    });
  }

  return summaries;
}

function extractPythonKeywordSource(source: string, key: string): string | null {
  const match = new RegExp(`${escapeRegExp(key)}\\s*=`, "u").exec(source);

  if (!match || match.index === undefined) {
    return null;
  }

  let index = match.index + match[0].length;

  while (index < source.length && /\s/u.test(source.charAt(index))) {
    index += 1;
  }

  const startIndex = index;
  let quote: '"' | "'" | null = null;
  let bracketDepth = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  let escaped = false;

  for (; index < source.length; index += 1) {
    const character = source.charAt(index);

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === "\\") {
        escaped = true;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === "[") {
      bracketDepth += 1;
      continue;
    }

    if (character === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (character === "{") {
      braceDepth += 1;
      continue;
    }

    if (character === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }

    if (character === "(") {
      parenDepth += 1;
      continue;
    }

    if (character === ")") {
      if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        return source.slice(startIndex, index).trim().replace(/,$/u, "");
      }

      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }

    if (character === "," && bracketDepth === 0 && braceDepth === 0 && parenDepth === 0) {
      return source.slice(startIndex, index).trim();
    }
  }

  return source.slice(startIndex).trim().replace(/,$/u, "");
}

function parsePythonStringLiteral(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length < 2) {
    return null;
  }

  const quote = trimmed.charAt(0);

  if ((quote !== '"' && quote !== "'") || trimmed.charAt(trimmed.length - 1) !== quote) {
    return null;
  }

  const body = trimmed.slice(1, -1);
  return body
    .replace(/\\\\/gu, "\\")
    .replace(/\\n/gu, "\n")
    .replace(quote === '"' ? /\\"/gu : /\\'/gu, quote);
}

function parsePythonStringArrayLiteral(value: string | null): string[] {
  if (!value) {
    return [];
  }

  const trimmed = value.trim();

  if (trimmed === "[]") {
    return [];
  }

  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return [];
  }

  const items = trimmed.slice(1, -1).match(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/gu) ?? [];

  return items
    .map((item) => parsePythonStringLiteral(item))
    .filter((item): item is string => item !== null);
}

function normalizeDiscoveredSlotNames(slotNames: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const slotName of slotNames.map((item) => item.trim()).filter((item) => item.length > 0)) {
    if (/[\\/]/u.test(slotName)) {
      continue;
    }

    const lowered = slotName.toLowerCase();

    if (seen.has(lowered)) {
      continue;
    }

    seen.add(lowered);
    normalized.push(slotName);
  }

  return normalized;
}

function parsePythonCallableBlockType(
  blockType: string
): {
  functionName: string;
  relativePath: string;
} | null {
  const separatorIndex = blockType.lastIndexOf(":");

  if (separatorIndex <= 0 || separatorIndex >= blockType.length - 1) {
    return null;
  }

  const relativePath = normalizeRelativePath(blockType.slice(0, separatorIndex));
  const functionName = blockType.slice(separatorIndex + 1).trim();

  if (
    relativePath.length === 0 ||
    path.extname(relativePath).toLowerCase() !== ".py" ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(functionName)
  ) {
    return null;
  }

  return {
    functionName,
    relativePath
  };
}

function createDatasetObjectRelativePath(datasetId: string): string {
  return `${STORE_DIRECTORY}/${STORE_OBJECTS_DIRECTORY}/${datasetId}`;
}

function createUniqueSourceMemberEntryName(
  originalName: string,
  originalDataId: string,
  usedEntryNames: Set<string>
): string {
  const trimmedName = originalName.trim();
  const baseName = trimmedName.length > 0 ? trimmedName : originalDataId;

  if (!usedEntryNames.has(baseName)) {
    usedEntryNames.add(baseName);
    return baseName;
  }

  const nextName = `${baseName}_${originalDataId}`;
  usedEntryNames.add(nextName);
  return nextName;
}

function createVisibleAliasEntryName(
  originalName: string,
  originalDataId: string,
  representation: OriginalDataRepresentation
): string {
  const trimmedName = originalName.trim();

  if (representation === "directory") {
    const baseName = trimmedName.length > 0 ? trimmedName : originalDataId;
    return `${baseName}_${originalDataId}`;
  }

  const extension = path.extname(trimmedName);
  const baseName = extension.length > 0 ? trimmedName.slice(0, -extension.length) : trimmedName;
  const normalizedBaseName = baseName.length > 0 ? baseName : originalDataId;
  return `${normalizedBaseName}_${originalDataId}${extension}`;
}

function sanitizeFileStem(value: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, "_")
    .replace(/[. ]+$/gu, "");
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath
    .split(/[\\/]+/u)
    .filter(Boolean)
    .join("/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function collapseNestedRelativePaths(relativePaths: string[]): string[] {
  const normalized = Array.from(
    new Set(
      relativePaths
        .map((value) => normalizeRelativePath(value.trim()))
        .filter((value) => value.length > 0)
    )
  ).sort((left, right) => left.length - right.length || left.localeCompare(right, "ja"));
  const collapsed: string[] = [];

  for (const candidate of normalized) {
    if (collapsed.some((existing) => candidate === existing || candidate.startsWith(`${existing}/`))) {
      continue;
    }

    collapsed.push(candidate);
  }

  return collapsed;
}

async function collectRelativeFiles(rootPath: string, basePath = rootPath): Promise<string[]> {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "ja"))) {
    const absolutePath = path.join(rootPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectRelativeFiles(absolutePath, basePath)));
      continue;
    }

    files.push(path.relative(basePath, absolutePath).split(path.sep).join("/"));
  }

  return files;
}

async function collectTrackableWorkspaceEntries(
  rootPath: string,
  currentRelativePath = ""
): Promise<TrackableWorkspaceEntry[]> {
  const absolutePath =
    currentRelativePath.length === 0
      ? rootPath
      : path.join(rootPath, ...currentRelativePath.split("/"));
  const entries = await fs.readdir(absolutePath, { withFileTypes: true });
  const collected: TrackableWorkspaceEntry[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "ja"))) {
    if (currentRelativePath.length === 0 && entry.name.startsWith(".")) {
      continue;
    }

    const nextRelativePath = currentRelativePath.length === 0
      ? entry.name
      : `${currentRelativePath}/${entry.name}`;
    const entryAbsolutePath = path.join(absolutePath, entry.name);

    if (entry.isDirectory()) {
      collected.push({
        absolutePath: entryAbsolutePath,
        hash: await computeDirectoryHash(entryAbsolutePath),
        kind: "directory",
        relativePath: nextRelativePath
      });
      collected.push(...(await collectTrackableWorkspaceEntries(rootPath, nextRelativePath)));
      continue;
    }

    collected.push({
      absolutePath: entryAbsolutePath,
      hash: await computeFileHash(entryAbsolutePath),
      kind: "file",
      relativePath: nextRelativePath
    });
  }

  return collected;
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }

    throw error;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resetDirectory(targetPath: string): Promise<void> {
  if (await pathExists(targetPath)) {
    await fs.rm(targetPath, { force: false, recursive: true });
  }

  await fs.mkdir(targetPath, { recursive: true });
}

async function syncDirectoryContents(sourceRootPath: string, targetRootPath: string): Promise<void> {
  const sourceEntries = await fs.readdir(sourceRootPath, { withFileTypes: true });
  await fs.mkdir(targetRootPath, { recursive: true });

  for (const entry of sourceEntries) {
    if (entry.name === "__pycache__") {
      continue;
    }

    const sourcePath = path.join(sourceRootPath, entry.name);
    const targetPath = path.join(targetRootPath, entry.name);

    if (entry.isDirectory()) {
      await syncDirectoryContents(sourcePath, targetPath);
      continue;
    }

    const sourceContent = await fs.readFile(sourcePath);
    const targetContent = await fs.readFile(targetPath).catch(() => null);

    if (targetContent !== null && Buffer.compare(sourceContent, targetContent) === 0) {
      continue;
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, sourceContent);
  }
}

function areSameNormalizedPath(leftPath: string, rightPath: string): boolean {
  return path.resolve(leftPath) === path.resolve(rightPath);
}

function appendUniqueStringSetting(currentValue: unknown, nextValue: string): string[] {
  const values = Array.isArray(currentValue)
    ? currentValue.filter((value): value is string => typeof value === "string")
    : [];

  return values.includes(nextValue) ? values : [...values, nextValue];
}

async function computeFileHash(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await fs.readFile(filePath));
  return `sha256:${hash.digest("hex").toUpperCase()}`;
}

async function computeDirectoryHash(directoryPath: string): Promise<string> {
  const entries = await collectDirectoryHashEntries(directoryPath);
  const hash = createHash("sha256");
  hash.update(JSON.stringify(entries));
  return `tree:${hash.digest("hex").toUpperCase()}`;
}

async function collectDirectoryHashEntries(directoryPath: string, basePath = directoryPath): Promise<object[]> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const hashedEntries: object[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "ja"))) {
    const absolutePath = path.join(directoryPath, entry.name);
    const relativePath = path.relative(basePath, absolutePath).split(path.sep).join("/");

    if (entry.isDirectory()) {
      hashedEntries.push({
        hash: await computeDirectoryHash(absolutePath),
        path: relativePath,
        type: "directory"
      });
      continue;
    }

    hashedEntries.push({
      hash: await computeFileHash(absolutePath),
      path: relativePath,
      type: "file"
    });
  }

  return hashedEntries;
}

function normalizeOriginalDataMetadata(value: unknown): OriginalDataMetadata | null {
  if (!isJsonRecord(value)) {
    return null;
  }

  if (
    value.entityType === "original-data" &&
    typeof value.id === "string" &&
    typeof value.displayName === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.path === "string" &&
    typeof value.hash === "string" &&
    (value.representation === "file" || value.representation === "directory") &&
    (value.visibility === "visible" || value.visibility === "hidden") &&
    (value.provenance === "source" || value.provenance === "derived")
  ) {
    const originalDataId = value.id.trim();

    return {
      createdAt: value.createdAt,
      displayName: value.displayName,
      entityType: "original-data",
      hash: value.hash,
      id: originalDataId,
      objectPath: typeof value.objectPath === "string" ? normalizeRelativePath(value.objectPath) : undefined,
      originalDataId,
      path: normalizeRelativePath(value.path),
      provenance: value.provenance,
      representation: value.representation,
      visibility: value.visibility
    };
  }

  if (
    typeof value.originalDataId === "string" &&
    typeof value.originalName === "string" &&
    typeof value.createdAt === "string" &&
    (value.sourceKind === "file" || value.sourceKind === "directory") &&
    typeof value.storeRelativePath === "string"
  ) {
    const originalDataId = value.originalDataId.trim();
    const pathValue =
      typeof value.aliasRelativePath === "string" ? value.aliasRelativePath : value.storeRelativePath;

    return {
      createdAt: value.createdAt,
      displayName: value.originalName,
      entityType: "original-data",
      hash: typeof value.hash === "string" ? value.hash : "",
      id: originalDataId,
      objectPath: normalizeRelativePath(value.storeRelativePath),
      originalDataId,
      path: normalizeRelativePath(pathValue),
      provenance: "source",
      representation: value.sourceKind,
      visibility: inferVisibilityFromPath(pathValue)
    };
  }

  return null;
}

function normalizeDatasetMetadata(value: unknown): DatasetMetadata | null {
  if (!isJsonRecord(value)) {
    return null;
  }

  if (
    value.entityType === "dataset" &&
    typeof value.id === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.path === "string" &&
    typeof value.hash === "string" &&
    typeof value.kind === "string" &&
    (value.displayName === undefined || typeof value.displayName === "string") &&
    (value.representation === "directory" || value.representation === "dataset-json") &&
    (value.visibility === "visible" || value.visibility === "hidden") &&
    (value.provenance === "source" || value.provenance === "derived") &&
    (value.createdByBlockId === null ||
      value.createdByBlockId === undefined ||
      typeof value.createdByBlockId === "string") &&
    (value.dataPath === undefined || typeof value.dataPath === "string") &&
    (value.memberIds === undefined ||
      (Array.isArray(value.memberIds) && value.memberIds.every((item) => typeof item === "string")))
  ) {
    const datasetId = value.id.trim();
    const name = normalizeDatasetName(
      typeof value.displayName === "string" ? value.displayName : undefined,
      datasetId
    );

    return {
      createdAt: value.createdAt,
      createdByBlockId: value.createdByBlockId ?? null,
      datasetId,
      displayName: name,
      entityType: "dataset",
      hash: value.hash,
      id: datasetId,
      kind: value.kind,
      dataPath:
        typeof value.dataPath === "string" && value.dataPath.trim().length > 0
          ? normalizeRelativePath(value.dataPath)
          : undefined,
      memberIds: value.memberIds,
      name,
      path: normalizeRelativePath(value.path),
      provenance: value.provenance,
      representation: value.representation,
      visibility: value.visibility
    };
  }

  if (
    typeof value.datasetId === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.kind === "string" &&
    typeof value.storeRelativePath === "string" &&
    (value.createdByBlockId === null ||
      value.createdByBlockId === undefined ||
      typeof value.createdByBlockId === "string")
  ) {
    const datasetId = value.datasetId.trim();
    const memberIds = Array.isArray(value.sourceMembers)
      ? value.sourceMembers
          .filter(
            (item) => isJsonRecord(item) && typeof item.originalDataId === "string"
          )
          .map((item) => item.originalDataId)
      : undefined;
    const name = normalizeDatasetName(
      typeof value.name === "string" ? value.name : undefined,
      datasetId
    );

    return {
      createdAt: value.createdAt,
      createdByBlockId: value.createdByBlockId ?? null,
      dataPath:
        typeof value.dataPath === "string" && value.dataPath.trim().length > 0
          ? normalizeRelativePath(value.dataPath)
          : undefined,
      datasetId,
      displayName: name,
      entityType: "dataset",
      hash: typeof value.hash === "string" ? value.hash : "",
      id: datasetId,
      kind: value.kind,
      memberIds,
      name,
      path: normalizeRelativePath(value.storeRelativePath),
      provenance: value.createdByBlockId ? "derived" : "source",
      representation: "directory",
      visibility: inferVisibilityFromPath(value.storeRelativePath)
    };
  }

  return null;
}

function areOriginalDataMetadataEqual(
  left: OriginalDataMetadata,
  right: OriginalDataMetadata
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function areDatasetMetadataEqual(left: DatasetMetadata, right: DatasetMetadata): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function inferVisibilityFromPath(relativePath: string): ManagedDataVisibility {
  return normalizeRelativePath(relativePath).startsWith(".store/") ? "hidden" : "visible";
}

function doesWorkspaceMutationAffectManagedData(
  mutation: WorkspaceMutation,
  metadata: ManagedDataMetadata
): boolean {
  if (doWorkspacePathsOverlap(metadata.path, mutation.path)) {
    return true;
  }

  return typeof mutation.nextPath === "string" && doWorkspacePathsOverlap(metadata.path, mutation.nextPath);
}

function doWorkspacePathsOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizeRelativePath(left);
  const normalizedRight = normalizeRelativePath(right);

  return normalizedLeft === normalizedRight ||
    normalizedLeft.startsWith(`${normalizedRight}/`) ||
    normalizedRight.startsWith(`${normalizedLeft}/`);
}

function findUniqueMatchingPathByHash(
  entries: readonly TrackableWorkspaceEntry[],
  targetHash: string,
  representation: OriginalDataRepresentation | DatasetRepresentation,
  claimedPaths: ReadonlySet<string>
): TrackableWorkspaceEntry | null {
  if (targetHash.trim().length === 0) {
    return null;
  }

  const matches = entries.filter((entry) => {
    if (claimedPaths.has(entry.relativePath) || entry.hash !== targetHash) {
      return false;
    }

    return doesEntryMatchRepresentation(entry, representation);
  });

  return matches.length === 1 ? matches[0] : null;
}

function findTrackingCandidatePaths(
  entries: readonly TrackableWorkspaceEntry[],
  metadata: OriginalDataMetadata | DatasetMetadata,
  claimedPaths: ReadonlySet<string>
): TrackableWorkspaceEntry[] {
  const candidateNames = collectTrackingCandidateNames(metadata);

  if (candidateNames.size === 0) {
    return [];
  }

  return entries.filter((entry) => {
    if (claimedPaths.has(entry.relativePath) || !doesEntryMatchRepresentation(entry, metadata.representation)) {
      return false;
    }

    return candidateNames.has(path.posix.basename(entry.relativePath));
  });
}

function collectTrackingCandidateNames(
  metadata: OriginalDataMetadata | DatasetMetadata
): Set<string> {
  const candidateNames = new Set<string>();
  const recordedBaseName = path.posix.basename(metadata.path);

  if (recordedBaseName.length > 0) {
    candidateNames.add(recordedBaseName);
  }

  if (metadata.entityType === "original-data") {
    const displayName = metadata.displayName.trim();

    if (displayName.length > 0) {
      candidateNames.add(displayName);
    }

    return candidateNames;
  }

  const datasetName = metadata.name.trim();

  if (datasetName.length === 0) {
    return candidateNames;
  }

  candidateNames.add(datasetName);

  if (metadata.representation === "dataset-json") {
    candidateNames.add(`${sanitizeFileStem(datasetName) || metadata.datasetId}${DATASET_JSON_EXTENSION}`);
  }

  return candidateNames;
}

function doesEntryMatchRepresentation(
  entry: TrackableWorkspaceEntry,
  representation: OriginalDataRepresentation | DatasetRepresentation
): boolean {
  return (representation === "directory" && entry.kind === "directory") ||
    (representation !== "directory" && entry.kind === "file");
}

function buildTrackingIssue(
  metadata: OriginalDataMetadata | DatasetMetadata,
  candidatePaths: readonly TrackableWorkspaceEntry[]
): IntegralManagedDataTrackingIssue {
  return {
    candidatePaths: candidatePaths
      .map((candidate) => candidate.relativePath)
      .sort((left, right) => left.localeCompare(right, "ja")),
    displayName: metadata.displayName,
    entityType: metadata.entityType,
    recordedHash: metadata.hash,
    recordedPath: metadata.path,
    representation: metadata.representation,
    targetId: metadata.id
  };
}

function splitLogLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

function resolvePythonCommand(): string {
  const configured = process.env.INTEGRALNOTES_PYTHON?.trim();
  return configured && configured.length > 0 ? configured : "python";
}

function resolveBundledPythonSdkPackageTemplatePath(): string {
  if (process.env.VITE_DEV_SERVER_URL) {
    return path.resolve(__dirname, "../../scripts/integral");
  }

  return path.join(process.resourcesPath, "python-sdk", "integral");
}

function isRenderableExtension(
  extension: string,
  installedPlugins: readonly InstalledPluginDefinition[]
): boolean {
  const normalized = extension.toLowerCase();

  if (findInstalledPluginViewerByExtension(installedPlugins, normalized)) {
    return true;
  }

  return (
    HTML_EXTENSIONS.has(normalized) ||
    IMAGE_EXTENSIONS.has(normalized) ||
    TEXT_EXTENSIONS.has(normalized)
  );
}

function injectHtmlBaseTag(document: string, baseDirectoryPath: string): string {
  if (/<base\s/iu.test(document)) {
    return document;
  }

  const baseHref = escapeHtmlAttribute(pathToFileURL(`${baseDirectoryPath}${path.sep}`).href);
  const baseTag = `<base href="${baseHref}">`;

  if (/<head(\s[^>]*)?>/iu.test(document)) {
    return document.replace(/<head(\s[^>]*)?>/iu, (match) => `${match}\n    ${baseTag}`);
  }

  if (/<html(\s[^>]*)?>/iu.test(document)) {
    return document.replace(/<html(\s[^>]*)?>/iu, (match) => `${match}\n  <head>${baseTag}</head>`);
  }

  return `${baseTag}\n${document}`;
}

function inferMimeType(assetPath: string): string {
  switch (path.extname(assetPath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json";
    case ".csv":
      return "text/csv";
    case ".md":
    case ".txt":
      return "text/plain";
    case ".html":
      return "text/html";
    default:
      return "application/octet-stream";
  }
}

function buildResolvedPluginViewer(
  plugin: InstalledPluginDefinition,
  viewer: InstalledPluginDefinition["viewers"][number],
  payload: {
    dataEncoding: PluginViewerDataEncoding;
    mediaType: string;
  }
) {
  return {
    dataEncoding: payload.dataEncoding,
    mediaType: payload.mediaType,
    pluginDescription: plugin.description,
    pluginDisplayName: plugin.displayName,
    pluginId: plugin.id,
    pluginNamespace: plugin.namespace,
    pluginVersion: plugin.version,
    viewerDescription: viewer.description,
    viewerDisplayName: viewer.displayName,
    viewerExtensions: [...viewer.extensions],
    viewerId: viewer.id
  };
}

async function readPluginViewerPayload(
  absolutePath: string,
  extension: string
): Promise<{
  data: string;
  dataEncoding: PluginViewerDataEncoding;
  mediaType: string;
}> {
  const mediaType = inferMimeType(absolutePath);
  const buffer = await fs.readFile(absolutePath);

  if (TEXT_EXTENSIONS.has(extension) || !buffer.includes(0)) {
    return {
      data: buffer.toString("utf8"),
      dataEncoding: "text",
      mediaType
    };
  }

  return {
    data: `data:${mediaType};base64,${buffer.toString("base64")}`,
    dataEncoding: "data-url",
    mediaType
  };
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}


