import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import type {
  CreateDatasetRequest,
  CreateDatasetFromWorkspaceEntriesRequest,
  CreateDatasetResult,
  ExecuteIntegralBlockRequest,
  ExecuteIntegralBlockResult,
  ImportManagedFilesResult,
  IntegralAssetCatalog,
  IntegralBlockDocument,
  IntegralBlockTypeDefinition,
  IntegralDatasetInspection,
  IntegralDatasetSummary,
  IntegralManagedFileSummary,
  IntegralManagedDataTrackingIssue,
  IntegralRenderableFile,
  ResolveIntegralManagedDataTrackingIssueRequest,
  IntegralParamsSchema,
  IntegralSlotDefinition,
  UndoIntegralBlockRequest,
  UndoIntegralBlockResult
} from "../shared/integral";
import {
  createDefaultIntegralOutputPathWithRandomSuffix,
  getIntegralSlotPrimaryExtension,
  isIntegralBundleExtension,
  normalizeIntegralParams,
  normalizeIntegralParamsSchema,
  normalizeIntegralSlotExtension,
  normalizeIntegralSlotExtensions
} from "../shared/integral";
import {
  findInstalledPluginViewerByExtension,
  type InstalledPluginDefinition,
  type PluginViewerDataEncoding
} from "../shared/plugins";
import {
  removeWorkspaceMarkdownReferences,
  resolveWorkspaceMarkdownTarget,
  toCanonicalWorkspaceTarget
} from "../shared/workspaceLinks";
import {
  toAnalysisResultDirectoryRelativePath,
  toDataRegistrationDirectoryRelativePath
} from "../shared/appSettings";
import type {
  WorkspaceDatasetManifestMember,
  WorkspaceFileDocument
} from "../shared/workspace";
import type { AppSettingsService } from "./appSettingsService";
import { PluginRegistry } from "./pluginRegistry";
import { WorkspaceService, type WorkspaceMutation } from "./workspaceService";
import {
  serializeFrontmatterDocument,
  splitFrontmatterBlock
} from "./frontmatter";

const execFileAsync = promisify(execFile);

const DATASET_JSON_EXTENSION = ".idts";
const STORE_DIRECTORY = ".store";
const STORE_METADATA_DIRECTORY = ".integral";
const STORE_RUNTIME_DIRECTORY = "runtime";
const DATASET_STAGING_DIRECTORY = "materialized-datasets";
const INTEGRAL_BLOCK_LOG_DIRECTORY = "integral-block-logs";
const INTEGRAL_BLOCK_LOG_DATATYPE = "integral-notes/python-execution-log";
const PYTHON_SDK_WORKSPACE_IMPORT_ROOT_DIRECTORY = "scripts";
const PYTHON_SDK_WORKSPACE_PACKAGE_DIRECTORY = `${PYTHON_SDK_WORKSPACE_IMPORT_ROOT_DIRECTORY}/integral`;
const PYTHON_EDITOR_IMPORT_PATH = "./scripts";

const BUILTIN_DISPLAY_PLUGIN_ID = "core-display";
const GENERAL_ANALYSIS_PLUGIN_ID = "general-analysis";
const DISPLAY_BLOCK_TYPE = "dataset-view";
const SHIMADZU_PLUGIN_ID = "shimadzu-lc";
const SHIMADZU_BLOCK_TYPE = "run-sequence";
const STANDARD_GRAPHS_PLUGIN_ID = "integralnotes.standard-graphs";

const HTML_EXTENSIONS = new Set([".htm", ".html"]);
const IMAGE_EXTENSIONS = new Set([".bmp", ".gif", ".jpg", ".jpeg", ".png", ".svg", ".webp"]);
const TEXT_EXTENSIONS = new Set([
  ".bat",
  ".c",
  ".css",
  ".csv",
  ".env",
  ".ini",
  ".js",
  ".json",
  ".log",
  ".md",
  ".mjs",
  ".ps1",
  ".py",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".tsv",
  ".txt",
  ".xml",
  ".yaml",
  ".yml"
]);
const EXTERNAL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/u;
const AUTO_REGISTER_EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  ".next",
  ".store",
  ".turbo",
  ".vscode",
  "coverage",
  "dist",
  "node_modules",
  "out"
]);
const REFERENCE_CLEANUP_EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "out"
]);

type ManagedDataVisibility = "hidden" | "visible";
type ManagedDataProvenance = "derived" | "source";
type ManagedFileRepresentation = "directory" | "file";
type DatasetRepresentation = "dataset-json";

interface ManagedMetadataBase {
  createdAt: string;
  displayName: string;
  hash: string;
  id: string;
  noteTargetId?: string;
  path: string;
  visibility: ManagedDataVisibility;
}

interface DatasetMetadata extends ManagedMetadataBase {
  createdByBlockId: string | null;
  dataPath?: string;
  datatype: string | null;
  datasetId: string;
  entityType: "dataset";
  memberIds?: string[];
  name: string;
  provenance: ManagedDataProvenance;
  representation: DatasetRepresentation;
}

interface ManagedFileMetadata extends ManagedMetadataBase {
  createdByBlockId: string | null;
  datatype: string | null;
  entityType: "managed-file";
  representation: ManagedFileRepresentation;
}

type ManagedDataMetadata = DatasetMetadata | ManagedFileMetadata;

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
  datatype?: string;
  datasetId: string;
  memberIds?: string[];
  name: string;
  noteTargetId?: string;
}

interface ReconcileMetadataResult<TMetadata> {
  issue?: IntegralManagedDataTrackingIssue;
  metadata: TMetadata;
}

interface ReservedManagedPath {
  relativePath: string;
  representation: DatasetRepresentation | ManagedFileRepresentation;
}

interface PythonCallableSummary {
  blockType: string;
  description: string;
  displayName: string;
  functionName: string;
  inputSlots: IntegralSlotDefinition[];
  outputSlots: IntegralSlotDefinition[];
  paramsSchema?: IntegralParamsSchema;
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
script_directory = str(script_path.parent)
if script_directory not in sys.path:
    sys.path.insert(1, script_directory)
payload = json.loads(args_path.read_text(encoding="utf-8"))

spec = importlib.util.spec_from_file_location("integral_user_module", script_path)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Failed to load module from {script_path}")

loaded_module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = loaded_module
try:
    spec.loader.exec_module(loaded_module)
except Exception:
    if sys.modules.get(spec.name) is loaded_module:
        del sys.modules[spec.name]
    raise

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
    private readonly pluginRegistry: PluginRegistry,
    private readonly appSettingsService: AppSettingsService
  ) {}

  async listAssetCatalog(): Promise<IntegralAssetCatalog> {
    await this.ensureIntegralWorkspaceReady();

    const [managedFiles, datasets, pythonCallables, externalPlugins] = await Promise.all([
      this.readManagedFileSummaries(),
      this.readDatasetSummaries(),
      this.readPythonCallableSummaries(),
      this.pluginRegistry.listInstalledPlugins()
    ]);

    return {
      datasets,
      blockTypes: buildBlockTypeCatalog(pythonCallables, externalPlugins),
      managedFiles
    };
  }

  async resolveManagedDataById(id: string): Promise<IntegralManagedFileSummary | null> {
    await this.ensureIntegralWorkspaceReady();

    const metadata =
      (await this.readDatasetMetadata(id.trim())) ??
      (await this.readManagedFileMetadata(id.trim()));

    return metadata ? this.toManagedFileSummary(metadata) : null;
  }

  async resolveManagedDataByPath(relativePath: string): Promise<IntegralManagedFileSummary | null> {
    await this.ensureIntegralWorkspaceReady();

    const workspacePath =
      resolveWorkspaceMarkdownTarget(relativePath) ?? normalizeRelativePath(relativePath);

    if (workspacePath.length === 0) {
      return null;
    }

    const metadata = await this.findManagedDataMetadataByPath(workspacePath);
    return metadata ? this.toManagedFileSummary(metadata) : null;
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

    let metadataList = await this.readManagedDataMetadataList();

    if (metadataList.length === 0) {
      return;
    }

    const deletedManagedData = collectManagedDataDeletedByWorkspaceMutations(
      mutations,
      metadataList
    );

    if (deletedManagedData.length > 0) {
      const deletedManagedDataIds = new Set<string>();

      for (const metadata of deletedManagedData) {
        if (deletedManagedDataIds.has(metadata.id)) {
          continue;
        }

        deletedManagedDataIds.add(metadata.id);
        await this.removeManagedDataMetadata(metadata, {
          syncManagedDataNotes: false
        });
      }

      metadataList = metadataList.filter((metadata) => !deletedManagedDataIds.has(metadata.id));
      await this.workspaceService.syncManagedDataNotes();

      if (metadataList.length === 0) {
        return;
      }
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

    const metadata =
      request.entityType === "dataset"
        ? await this.readDatasetMetadata(request.targetId)
        : await this.readManagedFileMetadata(request.targetId);

    if (!metadata) {
      throw new Error(
        request.entityType === "dataset"
          ? `dataset が見つかりません: ${request.targetId}`
          : `managed file が見つかりません: ${request.targetId}`
      );
    }

    if (request.action === "remove") {
      await this.removeManagedDataMetadata(metadata);
      return this.listManagedDataTrackingIssues();
    }

    const selectedPath = normalizeRelativePath(request.selectedPath ?? "");

    if (selectedPath.length === 0) {
      throw new Error("更新先の path を選択してください。");
    }

    await this.applyTrackedPathResolution(metadata, selectedPath);
    return this.listManagedDataTrackingIssues();
  }

  async importManagedFilePaths(sourcePaths: string[]): Promise<ImportManagedFilesResult> {
    await this.ensureIntegralWorkspaceReady();

    if (sourcePaths.length === 0) {
      throw new Error("managed file として登録するファイルまたはフォルダを選択してください。");
    }

    const importedManagedFiles: IntegralManagedFileSummary[] = [];

    for (const sourcePath of sourcePaths) {
      const metadata = await this.registerManagedFilePath(sourcePath, {
        syncManagedDataNotes: false
      });
      importedManagedFiles.push(this.toManagedFileSummary(metadata));
    }

    if (importedManagedFiles.length > 0) {
      await this.workspaceService.syncManagedDataNotes();
    }

    return {
      managedFiles: importedManagedFiles
    };
  }

  async createDataset(request: CreateDatasetRequest): Promise<CreateDatasetResult> {
    await this.ensureIntegralWorkspaceReady();

    const managedFileIds = request.managedFileIds
      .map((managedFileId) => managedFileId.trim())
      .filter((managedFileId) => managedFileId.length > 0);

    if (managedFileIds.length === 0) {
      throw new Error("dataset を作るには少なくとも 1 つの managed file が必要です。");
    }

    const uniqueManagedFileIds = Array.from(new Set(managedFileIds));
    const datasetId = createOpaqueId("DTS");
    const datasetName = normalizeDatasetName(request.name, datasetId);
    const manifestRelativePath =
      typeof request.manifestPath === "string" && request.manifestPath.trim().length > 0
        ? ensureOutputPathExtension(
            normalizePlannedWorkspaceOutputPath(request.manifestPath),
            DATASET_JSON_EXTENSION
          )
        : await this.createVisibleDatasetManifestRelativePath(
            await this.resolveDataRegistrationDirectory(),
            datasetName,
            datasetId
          );
    const manifestAbsolutePath = this.resolveWorkspacePath(manifestRelativePath);
    const memberIds: string[] = [];

    if (await pathExists(manifestAbsolutePath)) {
      throw new Error(`dataset manifest は既に存在します: ${manifestRelativePath}`);
    }

    for (const managedFileId of uniqueManagedFileIds) {
      const managedFileMetadata = await this.readManagedFileMetadata(managedFileId);

      if (managedFileMetadata === null) {
        throw new Error(`managed file が見つかりません: ${managedFileId}`);
      }

      memberIds.push(managedFileId);
    }

    const manifest: DatasetManifest = {
      datatype: request.datatype?.trim() || undefined,
      datasetId,
      memberIds,
      name: datasetName,
      noteTargetId: datasetId
    };
    const manifestContent = JSON.stringify(manifest, null, 2);
    await fs.mkdir(path.dirname(manifestAbsolutePath), { recursive: true });
    await fs.writeFile(manifestAbsolutePath, manifestContent, "utf8");

    const datasetMetadata: DatasetMetadata = {
      createdAt: new Date().toISOString(),
      createdByBlockId: null,
      datatype: request.datatype?.trim() || null,
      datasetId,
      displayName: datasetName,
      entityType: "dataset",
      hash: await this.computeManagedDataHash(manifestAbsolutePath, "dataset-json"),
      id: datasetId,
      memberIds,
      name: datasetName,
      noteTargetId: datasetId,
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

  async createDatasetFromWorkspaceEntries(
    request: CreateDatasetFromWorkspaceEntriesRequest
  ): Promise<CreateDatasetResult> {
    await this.ensureIntegralWorkspaceReady();

    const relativePaths = collapseNestedRelativePaths(request.relativePaths);

    if (relativePaths.length === 0) {
      throw new Error("dataset に追加するファイルまたはフォルダを選択してください。");
    }

    const managedFileIds: string[] = [];

    for (const relativePath of relativePaths) {
      const managedFileMetadata = await this.findManagedFileMetadataByPath(relativePath);

      if (managedFileMetadata) {
        managedFileIds.push(managedFileMetadata.id);
        continue;
      }

      const importResult = await this.importManagedFilePaths([this.resolveWorkspacePath(relativePath)]);
      const importedManagedFileId = importResult.managedFiles[0]?.id;

      if (!importedManagedFileId) {
        throw new Error(`${relativePath} を managed file として登録できませんでした。`);
      }

      managedFileIds.push(importedManagedFileId);
    }

    return this.createDataset({
      datatype: request.datatype,
      manifestPath: request.manifestPath,
      name: request.name,
      managedFileIds
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
      canOpenDataNote: true,
      datasetId: datasetMetadata.datasetId,
      createdAt: datasetMetadata.createdAt,
      createdByBlockId: datasetMetadata.createdByBlockId,
      datatype: datasetMetadata.datatype,
      fileNames: relativeFilePaths,
      hash: datasetMetadata.hash,
      hasRenderableFiles: renderables.length > 0,
      memberIds: datasetMetadata.memberIds,
      name: datasetMetadata.name,
      noteTargetId: normalizeManagedDataNoteTargetId(
        datasetMetadata.noteTargetId,
        datasetMetadata.datasetId
      ),
      path: datasetMetadata.path,
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
      this.readManagedDataNoteBody(
        normalizeManagedDataNoteTargetId(manifest.noteTargetId, manifest.datasetId)
      )
    ]);

    return {
      content: rawContent,
      datasetManifest: {
        dataPath: manifest.dataPath ?? null,
        datatype: manifest.datatype ?? null,
        datasetId: manifest.datasetId,
        datasetName: normalizeDatasetName(manifest.name, manifest.datasetId),
        members,
        noteMarkdown,
        noteTargetId: normalizeManagedDataNoteTargetId(manifest.noteTargetId, manifest.datasetId)
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

    const normalizedBlock = normalizeBlockDocument(
      request.block,
      definition,
      await this.resolveAnalysisResultDirectory()
    );
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
        summary: "表示 block は実行不要です。",
        workNoteMarkdownToAppend: null
      };
    }

    if (definition.source === "external-plugin") {
      return this.executeExternalPluginBlock(resolvedBlock, definition);
    }

    return this.executeGeneralAnalysisBlock(
      normalizedBlock,
      resolvedBlock,
      definition,
      request.sourceNotePath ?? null
    );
  }

  async undoBlock(request: UndoIntegralBlockRequest): Promise<UndoIntegralBlockResult> {
    await this.ensureIntegralWorkspaceReady();

    const blockId = request.block.id?.trim() ?? "";

    if (blockId.length === 0) {
      throw new Error("Undo 対象の block ID が見つかりません。");
    }

    const metadataList = await this.readManagedDataMetadataList();
    const outputReferenceIds = new Set(
      Object.values(request.block.outputs)
        .map((reference) => (typeof reference === "string" ? reference.trim() : ""))
        .filter((reference) => reference.length > 0)
    );
    const outputMetadata = metadataList.filter((metadata) => {
      if (metadata.createdByBlockId !== blockId) {
        return false;
      }

      return outputReferenceIds.size === 0 || outputReferenceIds.has(metadata.id);
    });

    if (outputMetadata.length === 0) {
      return {
        deletedRelativePaths: [],
        removedReferencePaths: [],
        updatedReferenceFiles: []
      };
    }

    const referencePaths = collectGeneratedOutputReferencePaths(outputMetadata);
    const deletionTargets = await this.collectGeneratedOutputDeletionTargets(outputMetadata);
    const deletedRelativePaths: string[] = [];

    if (deletionTargets.length > 0) {
      const deleteResult = await this.workspaceService.deleteEntries({
        targetPaths: deletionTargets
      });
      deletedRelativePaths.push(...deleteResult.deletedRelativePaths);
    }

    for (const metadata of outputMetadata) {
      if (await this.hasManagedDataMetadata(metadata)) {
        await this.removeManagedDataMetadata(metadata, {
          syncManagedDataNotes: false
        });
      }
    }

    await this.workspaceService.syncManagedDataNotes();
    const updatedReferenceFiles = await this.removeGeneratedOutputReferences(referencePaths);

    return {
      deletedRelativePaths,
      removedReferencePaths: referencePaths,
      updatedReferenceFiles
    };
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
    const sourcePackageRootPath = await resolveBundledPythonSdkPackageTemplatePath();
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
    definition: IntegralBlockTypeDefinition,
    sourceNotePath: string | null
  ): Promise<ExecuteIntegralBlockResult> {
    if (definition.pluginId !== GENERAL_ANALYSIS_PLUGIN_ID) {
      throw new Error(`未対応の plugin 実行です: ${definition.pluginId}`);
    }

    for (const inputSlot of definition.inputSlots) {
      const inputReference = resolvedBlock.inputs[inputSlot.name];

      if (!inputReference) {
        throw new Error(`input slot が未設定です: ${inputSlot.name}`);
      }

      await this.resolveInputExecutionPath(inputReference, inputSlot);
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

    const executionBlockId = sourceBlock.id ?? resolvedBlock.id ?? createOpaqueId("BLK");
    const runtimeRootPath = this.resolvePythonRuntimeRootPath(executionBlockId);
    await resetDirectory(runtimeRootPath);
    const outputDatasetMap = new Map<string, IntegralDatasetSummary>();
    const outputDatasetPlanMap = new Map<
      string,
      {
        createdAt: string;
        dataPath: string;
        datatype: string | null;
        datasetId: string;
        manifestPath: string;
        name: string;
        noteTargetId?: string;
      }
    >();
    const outputManagedFilePlanMap = new Map<
      string,
      {
        datatype: string | null;
        displayName: string;
        noteTargetId?: string;
        relativePath: string;
      }
    >();
    const outputMarkdownTargetMap = new Map<string, string>();
    const outputPaths: Record<string, string | null> = {};
    const inputPaths: Record<string, string | null> = {};

    for (const inputSlot of definition.inputSlots) {
      const inputReference = resolvedBlock.inputs[inputSlot.name];

      if (!inputReference) {
        inputPaths[inputSlot.name] = null;
        continue;
      }

      inputPaths[inputSlot.name] = await this.resolveInputExecutionPath(inputReference, inputSlot);
    }

    for (const outputSlot of definition.outputSlots) {
      const outputExtension =
        getIntegralSlotPrimaryExtension(outputSlot, DATASET_JSON_EXTENSION) ?? DATASET_JSON_EXTENSION;
      const createdAt = new Date();
      const plannedOutputPath = await this.resolvePlannedOutputPath(
        resolvedBlock.outputs[outputSlot.name] ?? null,
        outputSlot,
        definition.title
      );

      if (isIntegralBundleExtension(outputExtension)) {
        const nextDatasetId = createOpaqueId("DTS");
        const datasetName = resolveOutputDisplayName(plannedOutputPath, outputSlot.name);
        const datasetDataPath = plannedOutputPath;
        const datasetManifestPath = createDatasetManifestPathInDirectory(
          datasetDataPath,
          datasetName,
          nextDatasetId
        );
        const datasetAbsolutePath = this.resolveWorkspacePath(datasetDataPath);
        const datasetManifestAbsolutePath = this.resolveWorkspacePath(datasetManifestPath);

        if (await pathExists(datasetManifestAbsolutePath)) {
          throw new Error(
            `output folder 内の dataset manifest は既に存在します。削除するか別の folder を指定してください: ${datasetManifestPath}`
          );
        }

        await this.ensureOutputDatasetDirectory(datasetAbsolutePath, datasetDataPath);
        outputDatasetPlanMap.set(outputSlot.name, {
          createdAt: createdAt.toISOString(),
          dataPath: datasetDataPath,
          datatype: outputSlot.datatype?.trim() || null,
          datasetId: nextDatasetId,
          manifestPath: datasetManifestPath,
          name: datasetName,
          noteTargetId:
            (await this.resolveOutputSlotSharedNoteTargetId(outputSlot, resolvedBlock.inputs)) ??
            undefined
        });
        outputMarkdownTargetMap.set(outputSlot.name, toCanonicalWorkspaceTarget(datasetManifestPath));
        outputPaths[outputSlot.name] = datasetAbsolutePath;
        continue;
      }

      const outputRelativePath = plannedOutputPath;
      const outputAbsolutePath = this.resolveWorkspacePath(outputRelativePath);

      if (await pathExists(outputAbsolutePath)) {
        throw new Error(`output path は既に存在します。削除するか別の path を指定してください: ${outputRelativePath}`);
      }

      await fs.mkdir(path.dirname(outputAbsolutePath), { recursive: true });
      outputPaths[outputSlot.name] = outputAbsolutePath;
      outputMarkdownTargetMap.set(outputSlot.name, toCanonicalWorkspaceTarget(outputRelativePath));
      outputManagedFilePlanMap.set(outputSlot.name, {
        datatype: outputSlot.datatype?.trim() || null,
        displayName: resolveOutputDisplayName(outputRelativePath, outputSlot.name),
        noteTargetId:
          (await this.resolveOutputSlotSharedNoteTargetId(outputSlot, resolvedBlock.inputs)) ??
          undefined,
        relativePath: outputRelativePath
      });
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
      const finishedAt = new Date().toISOString();
      const errorMessage = [
        `${definition.title} の実行に失敗しました。`,
        stderr.trim() || stdout.trim() || executionError.message
      ]
        .filter(Boolean)
        .join("\n");

      await this.writePythonExecutionLogs(runtimeRootPath, stdout, stderr);
      await this.refreshOutputDatasetMetadata(outputDatasetMap);
      await this.refreshOutputManagedFileMetadata(
        outputManagedFilePlanMap,
        executionBlockId,
        { allowMissingOutputs: true }
      );
      const executionLogMarkdownTarget = await this.writeVisiblePythonExecutionLog({
        blockId: executionBlockId,
        definitionTitle: definition.title,
        errorMessage,
        finishedAt,
        startedAt,
        status: "error",
        stderr,
        stdout
      });
      await this.workspaceService.syncManagedDataNotes();

      return {
        block: {
          ...sourceBlock,
          inputs: {
            ...sourceBlock.inputs,
            ...resolvedBlock.inputs
          }
        },
        createdDatasets: [],
        executionLogMarkdownTarget,
        finishedAt,
        logLines: [],
        startedAt,
        status: "error",
        summary: executionLogMarkdownTarget
          ? `${definition.title} の実行に失敗しました。ログを保存しました。`
          : `${definition.title} の実行に失敗しました。`,
        workNoteMarkdownToAppend: null
      };
    }

    await this.writePythonExecutionLogs(runtimeRootPath, stdout, stderr);
    const createdOutputDatasetMap = await this.createOutputDatasetsFromPlans(
      outputDatasetPlanMap,
      sourceBlock.id ?? resolvedBlock.id ?? null
    );
    for (const [slotName, dataset] of createdOutputDatasetMap) {
      outputDatasetMap.set(slotName, dataset);
    }
    const createdManagedFileMap = await this.refreshOutputManagedFileMetadata(
      outputManagedFilePlanMap,
      sourceBlock.id ?? resolvedBlock.id ?? null
    );
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
    const outputReferences = Object.fromEntries(
      definition.outputSlots.map((slot) => {
        const datasetId = outputDatasetMap.get(slot.name)?.datasetId ?? null;
        const managedFileId = createdManagedFileMap.get(slot.name)?.id ?? null;
        return [
          slot.name,
          datasetId ?? managedFileId ?? null
        ];
      })
    );
    const executionLogMarkdownTarget = await this.writeVisiblePythonExecutionLog({
      blockId: executionBlockId,
      definitionTitle: definition.title,
      finishedAt,
      startedAt,
      status: "success",
      stderr,
      stdout
    });
    const workNoteMarkdownToAppend = buildWorkNoteProjectionMarkdown(
      definition.outputSlots.flatMap((slot) =>
        slot.autoInsertToWorkNote && outputMarkdownTargetMap.get(slot.name)
          ? [outputMarkdownTargetMap.get(slot.name)].filter((value): value is string => value !== undefined)
          : []
      )
    );

    if (sourceNotePath && sourceBlock.id) {
      await this.appendProjectedOutputsToDataNotes(
        sourceNotePath,
        sourceBlock.id,
        definition.outputSlots,
        resolvedBlock.inputs,
        Object.fromEntries(
          definition.outputSlots.map((slot) => [
            slot.name,
            outputMarkdownTargetMap.get(slot.name) ?? null
          ])
        )
      );
    }
    await this.workspaceService.syncManagedDataNotes();

    return {
      block: {
        ...sourceBlock,
        inputs: {
          ...sourceBlock.inputs,
          ...resolvedBlock.inputs
        },
        outputs: {
          ...sourceBlock.outputs,
          ...outputReferences
        }
      },
      createdDatasets,
      executionLogMarkdownTarget,
      finishedAt,
      logLines: [],
      startedAt,
      status: "success",
      summary: executionLogMarkdownTarget
        ? `${definition.title} を実行しました。ログを保存しました。`
        : `${definition.title} を実行しました。`,
      workNoteMarkdownToAppend
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

      const metadata = await this.resolveManagedDataReferenceMetadata(inputReference);

      if (metadata) {
        resolvedInputs[inputSlot.name] = metadata.id;
        continue;
      }

      const workspacePath =
        resolveWorkspaceMarkdownTarget(inputReference) ?? normalizeRelativePath(inputReference);

      if (workspacePath.length === 0 || (await this.resolveIfExists(workspacePath)) === null) {
        throw new Error(`input path が見つかりません: ${inputReference}`);
      }

      const managedData = await this.findManagedDataMetadataByPath(workspacePath);

      if (!managedData) {
        throw new Error(`input path は managed data として登録されていません: ${inputReference}`);
      }

      resolvedInputs[inputSlot.name] = managedData.id;
    }

    return {
      ...block,
      inputs: {
        ...block.inputs,
        ...resolvedInputs
      }
    };
  }

  private async resolveManagedDataReferenceMetadata(
    reference: string
  ): Promise<ManagedDataMetadata | null> {
    const normalizedReference = reference.trim();

    if (normalizedReference.length === 0) {
      return null;
    }

    return (
      (await this.readDatasetMetadata(normalizedReference)) ??
      (await this.readManagedFileMetadata(normalizedReference)) ??
      (await this.findManagedDataMetadataByPath(
        resolveWorkspaceMarkdownTarget(normalizedReference) ?? normalizeRelativePath(normalizedReference)
      ))
    );
  }

  private async findManagedDataMetadataByPath(relativePath: string): Promise<ManagedDataMetadata | null> {
    const datasetMetadata = await this.findDatasetMetadataByPath(relativePath);

    if (datasetMetadata) {
      return datasetMetadata;
    }

    return this.findManagedFileMetadataByPath(relativePath);
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
      summary: result.summary,
      workNoteMarkdownToAppend: null
    };
  }

  private async appendProjectedOutputsToDataNotes(
    sourceNotePath: string,
    sourceBlockId: string,
    outputSlots: readonly IntegralSlotDefinition[],
    resolvedInputs: Readonly<Record<string, string | null>>,
    outputReferences: Readonly<Record<string, string | null>>
  ): Promise<void> {
    const projectionTargets = new Map<string, Set<string>>();

    for (const outputSlot of outputSlots) {
      const outputReference = outputReferences[outputSlot.name] ?? null;
      const projectedInputSlots = this.resolveProjectedInputSlotNames(outputSlot);

      if (!outputReference || projectedInputSlots.length === 0) {
        continue;
      }

      for (const inputSlotName of projectedInputSlots) {
        const inputReference = resolvedInputs[inputSlotName] ?? null;

        if (!inputReference) {
          continue;
        }

        const noteRelativePath =
          await this.resolveProjectedManagedDataNoteRelativePath(inputReference);

        if (!noteRelativePath) {
          continue;
        }

        const projectedOutputs = projectionTargets.get(noteRelativePath) ?? new Set<string>();
        projectedOutputs.add(outputReference);
        projectionTargets.set(noteRelativePath, projectedOutputs);
      }
    }

    for (const [noteRelativePath, projectedOutputs] of projectionTargets) {
      const markdownToAppend = buildDataNoteProjectionMarkdown(
        sourceNotePath,
        sourceBlockId,
        [...projectedOutputs]
      );

      if (!markdownToAppend) {
        continue;
      }

      await this.appendMarkdownToNote(noteRelativePath, markdownToAppend);
    }
  }

  private resolveProjectedInputSlotNames(outputSlot: IntegralSlotDefinition): string[] {
    if (outputSlot.embedToSharedNote !== true) {
      return [];
    }

    const sharedTarget = outputSlot.shareNoteWithInput?.trim() ?? "";
    return sharedTarget.length > 0 ? [sharedTarget] : [];
  }

  private async resolveProjectedManagedDataNoteRelativePath(reference: string): Promise<string | null> {
    const metadata = await this.resolveManagedDataReferenceMetadata(reference);

    if (metadata?.entityType === "dataset") {
      return createManagedDataNoteRelativePath(
        normalizeManagedDataNoteTargetId(metadata.noteTargetId, metadata.datasetId)
      );
    }

    if (!metadata || !supportsManagedFileDataNote(metadata.path, metadata.representation)) {
      return null;
    }

    return createManagedDataNoteRelativePath(
      normalizeManagedDataNoteTargetId(metadata.noteTargetId, metadata.id)
    );
  }

  private async resolveOutputSlotSharedNoteTargetId(
    outputSlot: IntegralSlotDefinition,
    resolvedInputs: Readonly<Record<string, string | null>>
  ): Promise<string | null> {
    const sharedInputSlotName = outputSlot.shareNoteWithInput?.trim() ?? "";

    if (sharedInputSlotName.length === 0) {
      return null;
    }

    const inputReference = resolvedInputs[sharedInputSlotName] ?? null;

    if (!inputReference) {
      return null;
    }

    const metadata = await this.resolveManagedDataReferenceMetadata(inputReference);

    if (metadata?.entityType === "dataset") {
      return normalizeManagedDataNoteTargetId(metadata.noteTargetId, metadata.datasetId);
    }

    if (!metadata) {
      return null;
    }

    return normalizeManagedDataNoteTargetId(metadata.noteTargetId, metadata.id);
  }

  private async appendMarkdownToNote(relativePath: string, markdownToAppend: string): Promise<void> {
    const note = await this.workspaceService.readNote(relativePath);
    await this.workspaceService.saveNote(
      relativePath,
      appendMarkdownToNoteBody(note.content, markdownToAppend)
    );
  }

  private async collectGeneratedOutputDeletionTargets(
    metadataList: readonly ManagedDataMetadata[]
  ): Promise<string[]> {
    const candidates = metadataList.map((metadata) =>
      metadata.entityType === "dataset"
        ? normalizeRelativePath(metadata.dataPath ?? metadata.path)
        : normalizeRelativePath(metadata.path)
    );
    const existingCandidates: string[] = [];

    for (const candidate of collapseNestedRelativePaths(candidates)) {
      if (await pathExists(this.resolveWorkspacePath(candidate))) {
        existingCandidates.push(candidate);
      }
    }

    return existingCandidates;
  }

  private async hasManagedDataMetadata(metadata: ManagedDataMetadata): Promise<boolean> {
    return metadata.entityType === "dataset"
      ? (await this.readDatasetMetadata(metadata.datasetId)) !== null
      : (await this.readManagedFileMetadata(metadata.id)) !== null;
  }

  private async removeGeneratedOutputReferences(
    referencePaths: readonly string[]
  ): Promise<string[]> {
    if (referencePaths.length === 0) {
      return [];
    }

    const rootPath = this.getRootPath();
    const markdownPaths = await collectMarkdownRelativePathsForReferenceCleanup(rootPath);
    const updatedReferenceFiles: string[] = [];

    for (const relativePath of markdownPaths) {
      const absolutePath = this.resolveWorkspacePath(relativePath);
      const currentContent = await fs.readFile(absolutePath, "utf8").catch(() => null);

      if (currentContent === null) {
        continue;
      }

      const parsed = splitFrontmatterBlock(currentContent);
      const currentBody = parsed.frontmatter === null ? currentContent : parsed.body;
      const nextBody = removeWorkspaceMarkdownReferences(currentBody, referencePaths);

      if (nextBody === currentBody) {
        continue;
      }

      const nextContent =
        parsed.frontmatter === null
          ? nextBody
          : serializeFrontmatterDocument(parsed.frontmatter, nextBody);

      await fs.writeFile(absolutePath, nextContent, "utf8");
      updatedReferenceFiles.push(relativePath);
    }

    return updatedReferenceFiles;
  }

  private async writeDatasetMetadata(datasetId: string, metadata: DatasetMetadata): Promise<void> {
    await fs.mkdir(this.resolveStoreMetadataRootPath(), { recursive: true });
    await fs.writeFile(
      path.join(this.resolveStoreMetadataRootPath(), `${datasetId}.json`),
      JSON.stringify(metadata, null, 2),
      "utf8"
    );
  }

  private async writeManagedFileMetadata(
    managedFileId: string,
    metadata: ManagedFileMetadata
  ): Promise<void> {
    await fs.mkdir(this.resolveStoreMetadataRootPath(), { recursive: true });
    await fs.writeFile(
      path.join(this.resolveStoreMetadataRootPath(), `${managedFileId}.json`),
      JSON.stringify(metadata, null, 2),
      "utf8"
    );
  }

  private async writeDatasetManifest(relativePath: string, manifest: DatasetManifest): Promise<void> {
    const absolutePath = this.resolveWorkspacePath(relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, JSON.stringify(manifest, null, 2), "utf8");
  }

  private async writeDatasetNote(_metadata: DatasetMetadata): Promise<void> {
    await this.workspaceService.syncManagedDataNotes();
  }

  private async removeManagedDataMetadata(
    metadata: ManagedDataMetadata,
    options: {
      syncManagedDataNotes?: boolean;
    } = {}
  ): Promise<void> {
    const { syncManagedDataNotes = true } = options;

    await fs.rm(path.join(this.resolveStoreMetadataRootPath(), `${metadata.id}.json`), {
      force: true
    });

    if (metadata.entityType === "managed-file") {
      await this.removeManagedFileReferencesFromDatasets(metadata.id);
    }

    if (syncManagedDataNotes) {
      await this.workspaceService.syncManagedDataNotes();
    }
  }

  private async removeManagedFileReferencesFromDatasets(managedFileId: string): Promise<void> {
    const normalizedManagedFileId = managedFileId.trim();

    if (normalizedManagedFileId.length === 0) {
      return;
    }

    const metadataList = await this.readManagedDataMetadataList();

    for (const metadata of metadataList) {
      if (metadata.entityType !== "dataset") {
        continue;
      }

      const manifest = await this.readDatasetManifest(metadata.path);

      if (!manifest?.memberIds?.includes(normalizedManagedFileId)) {
        continue;
      }

      const nextManifest: DatasetManifest = {
        ...manifest,
        memberIds: manifest.memberIds.filter((memberId) => memberId !== normalizedManagedFileId)
      };

      await this.writeDatasetManifest(metadata.path, nextManifest);

      const nextMetadata: DatasetMetadata = {
        ...metadata
      };

      await this.refreshDatasetManifestFields(nextMetadata);
      nextMetadata.hash = await this.computeManagedDataHash(
        this.resolveWorkspacePath(nextMetadata.path),
        nextMetadata.representation
      );
      await this.writeDatasetMetadata(nextMetadata.datasetId, nextMetadata);
    }
  }

  private async autoRegisterWorkspaceManagedFiles(
    workspaceEntries: readonly TrackableWorkspaceEntry[],
    reservedManagedPaths: ReservedManagedPath[]
  ): Promise<number> {
    const candidates = workspaceEntries.filter((entry) =>
      isAutoRegisterableManagedFileEntry(entry, reservedManagedPaths)
    );

    if (candidates.length === 0) {
      return 0;
    }

    for (const candidate of candidates) {
      const normalizedPath = normalizeRelativePath(candidate.relativePath);
      const metadata: ManagedFileMetadata = {
        createdAt: new Date().toISOString(),
        createdByBlockId: null,
        datatype: null,
        displayName: path.posix.basename(normalizedPath),
        entityType: "managed-file",
        hash: candidate.hash,
        id: createOpaqueId("FL"),
        path: normalizedPath,
        representation: candidate.kind,
        visibility: inferVisibilityFromPath(normalizedPath, candidate.kind)
      };

      await this.writeManagedFileMetadata(metadata.id, metadata);
      reserveManagedPath(reservedManagedPaths, metadata.path, metadata.representation);
    }

    return candidates.length;
  }

  private async applyTrackedPathResolution(
    metadata: DatasetMetadata | ManagedFileMetadata,
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

    if (metadata.entityType === "dataset") {
      const nextMetadata: DatasetMetadata = {
        ...metadata,
        hash: await this.computeManagedDataHash(absolutePath, metadata.representation),
        path: nextPath,
        visibility: inferVisibilityFromPath(nextPath, metadata.representation)
      };

      await this.refreshDatasetManifestFields(nextMetadata);
      await this.writeDatasetMetadata(nextMetadata.datasetId, nextMetadata);
    } else {
      const nextMetadata: ManagedFileMetadata = {
        ...metadata,
        hash: await this.computeManagedDataHash(absolutePath, metadata.representation),
        path: nextPath,
        visibility: inferVisibilityFromPath(nextPath, metadata.representation)
      };

      await this.writeManagedFileMetadata(nextMetadata.id, nextMetadata);
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

  private async writeVisiblePythonExecutionLog({
    blockId,
    definitionTitle,
    errorMessage,
    finishedAt,
    startedAt,
    status,
    stderr,
    stdout
  }: {
    blockId: string;
    definitionTitle: string;
    errorMessage?: string;
    finishedAt: string;
    startedAt: string;
    status: "error" | "success";
    stderr: string;
    stdout: string;
  }): Promise<string | null> {
    const content = buildPythonExecutionLogText({
      definitionTitle,
      errorMessage,
      finishedAt,
      startedAt,
      status,
      stderr,
      stdout
    });

    if (!content) {
      return null;
    }

    const analysisResultDirectory = await this.resolveAnalysisResultDirectory();
    const safeBlockId = sanitizeFileStem(blockId) || createOpaqueId("BLK");
    const relativePath = normalizeRelativePath(
      `${analysisResultDirectory}/${INTEGRAL_BLOCK_LOG_DIRECTORY}/${safeBlockId}.log`
    );
    const absolutePath = this.resolveWorkspacePath(relativePath);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, "utf8");
    await this.refreshOutputManagedFileMetadata(
      new Map([
        [
          "executionLog",
          {
            datatype: INTEGRAL_BLOCK_LOG_DATATYPE,
            displayName: `${definitionTitle} execution log`,
            relativePath
          }
        ]
      ]),
      blockId
    );

    return toCanonicalWorkspaceTarget(relativePath);
  }

  private async readManagedFileMetadata(managedFileId: string): Promise<ManagedFileMetadata | null> {
    const rawMetadata = await readJsonFile<unknown>(
      path.join(this.resolveStoreMetadataRootPath(), `${managedFileId}.json`)
    );

    return normalizeManagedFileMetadata(rawMetadata);
  }

  private async readManagedDataMetadataList(): Promise<ManagedDataMetadata[]> {
    const metadataRootPath = this.resolveStoreMetadataRootPath();
    const entries = await fs.readdir(metadataRootPath, { withFileTypes: true });
    const metadataList = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".json")
        .map(async (entry) => {
          const rawMetadata = await readJsonFile<unknown>(path.join(metadataRootPath, entry.name));
          return (
            normalizeManagedFileMetadata(rawMetadata) ??
            normalizeDatasetMetadata(rawMetadata)
          );
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

  private async findManagedFileMetadataByPath(relativePath: string): Promise<ManagedFileMetadata | null> {
    const metadataRootPath = this.resolveStoreMetadataRootPath();
    const entries = await fs.readdir(metadataRootPath, { withFileTypes: true });
    const normalizedRelativePath = normalizeRelativePath(relativePath);

    for (const entry of entries) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") {
        continue;
      }

      const rawMetadata = await readJsonFile<unknown>(path.join(metadataRootPath, entry.name));
      const metadata = normalizeManagedFileMetadata(rawMetadata);

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

  private async readManagedFileSummaries(): Promise<IntegralManagedFileSummary[]> {
    const metadataList = await this.readManagedDataMetadataList();

    return metadataList
      .map((metadata) => this.toManagedFileSummary(metadata))
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
      canOpenDataNote: true,
      datasetId: metadata.datasetId,
      createdAt: metadata.createdAt,
      createdByBlockId: metadata.createdByBlockId,
      datatype: metadata.datatype,
      hash: metadata.hash,
      hasRenderableFiles: renderableCount > 0,
      memberIds: metadata.memberIds,
      name: metadata.name,
      noteTargetId: normalizeManagedDataNoteTargetId(metadata.noteTargetId, metadata.datasetId),
      path: metadata.path,
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

    const buffer = await fs.readFile(absolutePath);

    if (!buffer.includes(0)) {
      return {
        data: buffer.toString("utf8"),
        kind: "text",
        name: path.basename(relativePath),
        relativePath
      };
    }

    return null;
  }

  private async collectInspectableFiles(
    datasetRootPath: string,
    metadata: DatasetMetadata
  ): Promise<InspectableFileEntry[]> {
    const relativeFilePaths = await collectRelativeFiles(datasetRootPath);
    const rootRelativePath = normalizeRelativePath(metadata.dataPath ?? "");
    const manifestRelativePath = normalizeRelativePath(metadata.path);

    return relativeFilePaths
      .filter((relativePath) => {
        if (rootRelativePath.length === 0) {
          return true;
        }

        return normalizeRelativePath(`${rootRelativePath}/${relativePath}`) !== manifestRelativePath;
      })
      .map((relativePath) => ({
        absolutePath: path.join(datasetRootPath, relativePath),
        relativePath
      }))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath, "ja"));
  }

  private toManagedFileSummary(metadata: ManagedDataMetadata): IntegralManagedFileSummary {
    if (metadata.entityType === "dataset") {
      return {
        canOpenDataNote: true,
        createdAt: metadata.createdAt,
        createdByBlockId: metadata.createdByBlockId,
        datatype: metadata.datatype,
        displayName: metadata.name,
        entityType: metadata.entityType,
        hash: metadata.hash,
        id: metadata.datasetId,
        noteTargetId: normalizeManagedDataNoteTargetId(metadata.noteTargetId, metadata.datasetId),
        path: metadata.path,
        representation: metadata.representation,
        visibility: metadata.visibility
      };
    }

    return {
      canOpenDataNote: supportsManagedFileDataNote(metadata.path, metadata.representation),
      createdAt: metadata.createdAt,
      createdByBlockId: metadata.createdByBlockId,
      datatype: metadata.datatype,
      displayName: metadata.displayName,
      entityType: metadata.entityType,
      hash: metadata.hash,
      id: metadata.id,
      noteTargetId: normalizeManagedDataNoteTargetId(metadata.noteTargetId, metadata.id),
      path: metadata.path,
      representation: metadata.representation,
      visibility: metadata.visibility
    };
  }

  private resolveManagedFileContentPath(metadata: ManagedFileMetadata): string {
    return this.resolveWorkspacePath(metadata.path);
  }

  private isWorkspacePath(rootPath: string, absolutePath: string): boolean {
    const normalizedRelative = path.relative(rootPath, absolutePath);
    return normalizedRelative.length === 0 ||
      (!normalizedRelative.startsWith("..") && !path.isAbsolute(normalizedRelative));
  }

  private async registerManagedFilePath(
    sourcePath: string,
    options: {
      syncManagedDataNotes?: boolean;
    } = {}
  ): Promise<ManagedFileMetadata> {
    const { syncManagedDataNotes = true } = options;
    const rootPath = this.getRootPath();
    const resolvedSourcePath = path.resolve(sourcePath);
    const sourceStats = await fs.stat(resolvedSourcePath);
    const representation: ManagedFileRepresentation = sourceStats.isDirectory()
      ? "directory"
      : "file";
    const sourceInsideWorkspace = this.isWorkspacePath(rootPath, resolvedSourcePath);

    if (sourceInsideWorkspace) {
      this.assertRegisterableManagedFilePath(rootPath, resolvedSourcePath);
    }

    const managedFileId = createOpaqueId("FL");
    const visiblePath = await this.resolveManagedFileVisiblePath(
      rootPath,
      resolvedSourcePath,
      managedFileId,
      representation
    );
    const visibleAbsolutePath = this.resolveWorkspacePath(visiblePath);

    if (!sourceInsideWorkspace) {
      await fs.mkdir(path.dirname(visibleAbsolutePath), { recursive: true });
      await this.copyManagedFileIntoWorkspace(
        resolvedSourcePath,
        visibleAbsolutePath,
        representation
      );
    }

    const metadata: ManagedFileMetadata = {
      createdAt: new Date().toISOString(),
      displayName: path.basename(resolvedSourcePath),
      createdByBlockId: null,
      datatype: null,
      entityType: "managed-file",
      hash: await this.computeManagedDataHash(visibleAbsolutePath, representation),
      id: managedFileId,
      path: visiblePath,
      representation,
      visibility: inferVisibilityFromPath(visiblePath, representation)
    };

    await this.writeManagedFileMetadata(managedFileId, metadata);

    if (syncManagedDataNotes) {
      await this.workspaceService.syncManagedDataNotes();
    }

    return metadata;
  }

  private assertRegisterableManagedFilePath(rootPath: string, absolutePath: string): void {
    const normalizedRelative = path.relative(rootPath, absolutePath);

    if (normalizedRelative.length === 0) {
      throw new Error("ワークスペース root 自体は managed file 登録できません。");
    }

    const topLevelSegment = normalizedRelative.split(path.sep).filter(Boolean)[0] ?? "";

    if (topLevelSegment === STORE_DIRECTORY) {
      throw new Error("system 管理ディレクトリ配下は managed file 登録できません。");
    }
  }

  private async resolveManagedFileVisiblePath(
    rootPath: string,
    sourceAbsolutePath: string,
    managedFileId: string,
    representation: ManagedFileRepresentation
  ): Promise<string> {
    if (this.isWorkspacePath(rootPath, sourceAbsolutePath)) {
      return path.relative(rootPath, sourceAbsolutePath).split(path.sep).join("/");
    }

    const dataRegistrationDirectory = await this.resolveDataRegistrationDirectory();
    const dataRootPath = this.resolveWorkspacePath(dataRegistrationDirectory);
    await fs.mkdir(dataRootPath, { recursive: true });

    const preferredRelativePath = normalizeRelativePath(
      `${dataRegistrationDirectory}/${path.basename(sourceAbsolutePath)}`
    );
    const preferredAbsolutePath = this.resolveWorkspacePath(preferredRelativePath);

    if (!(await pathExists(preferredAbsolutePath))) {
      return preferredRelativePath;
    }

    return normalizeRelativePath(
      `${dataRegistrationDirectory}/${createVisibleAliasEntryName(
        path.basename(sourceAbsolutePath),
        managedFileId,
        representation
      )}`
    );
  }

  private async resolveDataRegistrationDirectory(): Promise<string> {
    const settings = await this.appSettingsService.getSettings();
    return toDataRegistrationDirectoryRelativePath(settings.dataRegistrationDirectory);
  }

  private async resolveAnalysisResultDirectory(): Promise<string> {
    const settings = await this.appSettingsService.getSettings();
    return toAnalysisResultDirectoryRelativePath(settings.analysisResultDirectory);
  }

  private async copyManagedFileIntoWorkspace(
    sourcePath: string,
    destinationPath: string,
    representation: ManagedFileRepresentation
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
    representation: ManagedFileRepresentation
  ): Promise<void> {
    if (representation === "directory") {
      await fs.symlink(targetPath, aliasPath, "junction");
      return;
    }

    await fs.link(targetPath, aliasPath);
  }

  private async createVisibleDatasetManifestRelativePath(
    directoryRelativePath: string,
    datasetName: string,
    datasetId: string
  ): Promise<string> {
    const normalizedDirectoryRelativePath = normalizeRelativePath(directoryRelativePath);
    const datasetsRootPath = this.resolveWorkspacePath(
      normalizedDirectoryRelativePath.length > 0 ? normalizedDirectoryRelativePath : "."
    );
    await fs.mkdir(datasetsRootPath, { recursive: true });

    const preferredStem = sanitizeFileStem(datasetName) || datasetId;
    let serial = 0;

    while (true) {
      const suffix = serial === 0 ? "" : `_${serial}`;
      const relativePath = normalizeRelativePath(
        `${normalizedDirectoryRelativePath}/${preferredStem}${suffix}${DATASET_JSON_EXTENSION}`
      );

      if (!(await pathExists(this.resolveWorkspacePath(relativePath)))) {
        return relativePath;
      }

      serial += 1;
    }
  }

  private async resolvePlannedOutputPath(
    outputReference: string | null,
    outputSlot: IntegralSlotDefinition,
    analysisDisplayName?: string | null
  ): Promise<string> {
    const outputExtension =
      getIntegralSlotPrimaryExtension(outputSlot, DATASET_JSON_EXTENSION) ?? DATASET_JSON_EXTENSION;
    const rawReference =
      typeof outputReference === "string" && outputReference.trim().length > 0
        ? outputReference.trim()
        : createDefaultIntegralOutputPathWithRandomSuffix(outputSlot, {
            analysisDisplayName,
            outputRoot: await this.resolveAnalysisResultDirectory()
          });

    if (await this.resolveManagedDataReferenceMetadata(rawReference)) {
      throw new Error(
        `実行済み block は再実行できません。削除して新しい block を作成してください: ${rawReference}`
      );
    }

    const normalizedPath = normalizePlannedWorkspaceOutputPath(rawReference);
    if (isIntegralBundleExtension(outputExtension)) {
      if (path.posix.extname(normalizedPath).toLowerCase() === DATASET_JSON_EXTENSION) {
        throw new Error(`.idts output には file path ではなく folder path を指定してください: ${rawReference}`);
      }

      this.resolveWorkspacePath(normalizedPath);
      return normalizedPath;
    }

    const outputPath = ensureOutputPathExtension(normalizedPath, outputExtension);

    this.resolveWorkspacePath(outputPath);
    return outputPath;
  }

  private async resolveInputExecutionPath(
    inputReference: string,
    inputSlot: IntegralSlotDefinition
  ): Promise<string> {
    const metadata = await this.resolveManagedDataReferenceMetadata(inputReference);

    if (!metadata) {
      throw new Error(`input managed data が見つかりません: ${inputReference}`);
    }

    if (metadata.entityType === "dataset") {
      return this.resolveDatasetReadablePath(metadata);
    }

    const absolutePath = this.resolveManagedFileContentPath(metadata);
    const stats = await fs.stat(absolutePath).catch(() => null);

    if (!stats) {
      throw new Error(`input path が見つかりません: ${metadata.path}`);
    }

    const allowedExtensions = normalizeIntegralSlotExtensions(inputSlot.extensions);
    const directExtension = normalizeIntegralSlotExtension(inputSlot.extension);
    const expectedExtensions = Array.from(
      new Set([...(allowedExtensions ?? []), ...(directExtension ? [directExtension] : [])])
    );

    if (expectedExtensions.length > 0 && stats.isFile()) {
      const actualExtension = path.extname(absolutePath).toLowerCase();

      if (!expectedExtensions.includes(actualExtension)) {
        throw new Error(
          `input slot '${inputSlot.name}' は ${expectedExtensions.join(", ")} のみ受け付けます: ${inputReference}`
        );
      }
    }

    return absolutePath;
  }

  private async resolveDatasetReadablePath(metadata: DatasetMetadata): Promise<string> {
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
      const managedFileMetadata = await this.readManagedFileMetadata(memberId);

      if (managedFileMetadata === null) {
        continue;
      }

      const entryName = createUniqueSourceMemberEntryName(
        managedFileMetadata.displayName,
        memberId,
        usedEntryNames
      );

      await this.createVisibleAlias(
        this.resolveManagedFileContentPath(managedFileMetadata),
        path.join(stagingRootPath, entryName),
        managedFileMetadata.representation
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
      (manifest.datatype !== undefined &&
        manifest.datatype !== null &&
        typeof manifest.datatype !== "string") ||
      (manifest.memberIds !== undefined &&
        (!Array.isArray(manifest.memberIds) ||
          !manifest.memberIds.every((item) => typeof item === "string"))) ||
      (manifest.dataPath !== undefined && typeof manifest.dataPath !== "string") ||
      (manifest.noteTargetId !== undefined && typeof manifest.noteTargetId !== "string")
    ) {
      return null;
    }

    return {
      dataPath:
        typeof manifest.dataPath === "string" && manifest.dataPath.trim().length > 0
          ? normalizeRelativePath(manifest.dataPath)
          : undefined,
      datatype:
        typeof manifest.datatype === "string" && manifest.datatype.trim().length > 0
          ? manifest.datatype.trim()
          : undefined,
      datasetId: manifest.datasetId.trim(),
      memberIds: Array.isArray(manifest.memberIds)
        ? manifest.memberIds.map((item) => item.trim()).filter(Boolean)
        : undefined,
      name: manifest.name,
      noteTargetId:
        typeof manifest.noteTargetId === "string" && manifest.noteTargetId.trim().length > 0
          ? manifest.noteTargetId.trim()
          : undefined
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
    metadata.datatype = manifest.datatype ?? null;
    metadata.noteTargetId = normalizeManagedDataNoteTargetId(
      manifest.noteTargetId,
      metadata.datasetId
    );
  }

  private async readDatasetManifestMember(
    managedFileId: string
  ): Promise<WorkspaceDatasetManifestMember> {
    const normalizedManagedFileId = managedFileId.trim();
    const metadata =
      normalizedManagedFileId.length > 0
        ? await this.readManagedFileMetadata(normalizedManagedFileId)
        : null;

    return {
      displayName:
        metadata?.displayName ??
        (normalizedManagedFileId.length > 0 ? normalizedManagedFileId : "(unknown)"),
      managedFileId: normalizedManagedFileId,
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
    representation: DatasetRepresentation | ManagedFileRepresentation
  ): Promise<string> {
    if (representation === "directory") {
      return computeDirectoryHash(absolutePath);
    }

    return computeFileHash(absolutePath);
  }

  private async ensureOutputDatasetDirectory(
    absolutePath: string,
    relativePath: string
  ): Promise<void> {
    const stats = await fs.stat(absolutePath).catch(() => null);

    if (stats === null) {
      await fs.mkdir(absolutePath, { recursive: true });
      return;
    }

    if (!stats.isDirectory()) {
      throw new Error(`output folder path は directory ではありません: ${relativePath}`);
    }

    const entries = await fs.readdir(absolutePath);

    if (entries.length > 0) {
      throw new Error(`output folder は空である必要があります: ${relativePath}`);
    }
  }

  private async createOutputDatasetsFromPlans(
    outputDatasetPlanMap: ReadonlyMap<
      string,
      {
        createdAt: string;
        dataPath: string;
        datatype: string | null;
        datasetId: string;
        manifestPath: string;
        name: string;
        noteTargetId?: string;
      }
    >,
    createdByBlockId: string | null
  ): Promise<Map<string, IntegralDatasetSummary>> {
    const createdDatasets = new Map<string, IntegralDatasetSummary>();

    for (const [slotName, plan] of outputDatasetPlanMap) {
      const manifest: DatasetManifest = {
        dataPath: plan.dataPath,
        datatype: plan.datatype ?? undefined,
        datasetId: plan.datasetId,
        name: plan.name,
        noteTargetId: normalizeManagedDataNoteTargetId(plan.noteTargetId, plan.datasetId)
      };
      const manifestAbsolutePath = this.resolveWorkspacePath(plan.manifestPath);
      await fs.mkdir(path.dirname(manifestAbsolutePath), { recursive: true });
      await fs.writeFile(manifestAbsolutePath, JSON.stringify(manifest, null, 2), "utf8");

      const metadata: DatasetMetadata = {
        createdAt: plan.createdAt,
        createdByBlockId,
        dataPath: plan.dataPath,
        datatype: plan.datatype,
        datasetId: plan.datasetId,
        displayName: plan.name,
        entityType: "dataset",
        hash: await this.computeManagedDataHash(manifestAbsolutePath, "dataset-json"),
        id: plan.datasetId,
        name: plan.name,
        noteTargetId: plan.noteTargetId,
        path: plan.manifestPath,
        provenance: "derived",
        representation: "dataset-json",
        visibility: "visible"
      };

      await this.writeDatasetMetadata(plan.datasetId, metadata);
      createdDatasets.set(slotName, await this.readDatasetSummary(plan.datasetId));
    }

    return createdDatasets;
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

  private async refreshOutputManagedFileMetadata(
    outputManagedFilePlanMap: ReadonlyMap<
      string,
      {
        datatype: string | null;
        displayName: string;
        noteTargetId?: string;
        relativePath: string;
      }
    >,
    createdByBlockId: string | null,
    options: { allowMissingOutputs?: boolean } = {}
  ): Promise<Map<string, IntegralManagedFileSummary>> {
    const createdManagedFiles = new Map<string, IntegralManagedFileSummary>();

    for (const [slotName, plan] of outputManagedFilePlanMap) {
      const existingPath = await this.resolveIfExists(plan.relativePath);

      if (!existingPath) {
        if (options.allowMissingOutputs === true) {
          continue;
        }

        throw new Error(`output path が作成されませんでした: ${plan.relativePath}`);
      }

      const stats = await fs.stat(existingPath);

      if (!stats.isFile() && !stats.isDirectory()) {
        throw new Error(`output path は file / directory ではありません: ${plan.relativePath}`);
      }

      const existingMetadata = await this.findManagedFileMetadataByPath(plan.relativePath);
      const nextMetadata: ManagedFileMetadata = {
        createdAt: existingMetadata?.createdAt ?? new Date().toISOString(),
        createdByBlockId,
        datatype: plan.datatype,
        displayName: plan.displayName,
        entityType: "managed-file",
        hash: await this.computeManagedDataHash(existingPath, stats.isDirectory() ? "directory" : "file"),
        id: existingMetadata?.id ?? createOpaqueId("FL"),
        noteTargetId: plan.noteTargetId ?? existingMetadata?.noteTargetId,
        path: plan.relativePath,
        representation: stats.isDirectory() ? "directory" : "file",
        visibility: inferVisibilityFromPath(plan.relativePath, stats.isDirectory() ? "directory" : "file")
      };

      await this.writeManagedFileMetadata(nextMetadata.id, nextMetadata);
      createdManagedFiles.set(slotName, this.toManagedFileSummary(nextMetadata));
    }

    return createdManagedFiles;
  }

  private async reconcileManagedDataMetadata(): Promise<boolean> {
    const metadataRootPath = this.resolveStoreMetadataRootPath();
    const entries = await fs.readdir(metadataRootPath, { withFileTypes: true });
    const workspaceEntries = await collectTrackableWorkspaceEntries(this.getRootPath());
    const managedFileMetadataList: ManagedFileMetadata[] = [];
    const datasetMetadataList: DatasetMetadata[] = [];
    const claimedPaths = new Set<string>();
    const reservedManagedPaths: ReservedManagedPath[] = [];
    const pendingIssues: IntegralManagedDataTrackingIssue[] = [];
    let hasChanges = false;

    for (const entry of entries) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") {
        continue;
      }

      const filePath = path.join(metadataRootPath, entry.name);
      const rawMetadata = await readJsonFile<unknown>(filePath);
      const managedFileMetadata = normalizeManagedFileMetadata(rawMetadata);

      if (managedFileMetadata) {
        managedFileMetadataList.push(managedFileMetadata);
        continue;
      }

      const datasetMetadata = normalizeDatasetMetadata(rawMetadata);

      if (!datasetMetadata) {
        continue;
      }
      datasetMetadataList.push(datasetMetadata);
    }

    for (const metadata of [...managedFileMetadataList, ...datasetMetadataList]) {
      if (await this.resolveIfExists(metadata.path)) {
        claimedPaths.add(metadata.path);
      }
    }

    for (const metadata of managedFileMetadataList) {
      const reconciled = await this.reconcileManagedFileMetadata(
        metadata,
        workspaceEntries,
        claimedPaths
      );

      if (reconciled.issue) {
        pendingIssues.push(reconciled.issue);
        reserveTrackingIssueCandidates(reservedManagedPaths, reconciled.issue);
      } else {
        reserveManagedPath(
          reservedManagedPaths,
          reconciled.metadata.path,
          reconciled.metadata.representation
        );
      }

      if (!areManagedFileMetadataEqual(metadata, reconciled.metadata)) {
        await this.writeManagedFileMetadata(reconciled.metadata.id, reconciled.metadata);
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
        reserveTrackingIssueCandidates(reservedManagedPaths, reconciled.issue);
      } else {
        reserveManagedPath(
          reservedManagedPaths,
          reconciled.metadata.path,
          reconciled.metadata.representation
        );
        if (reconciled.metadata.dataPath) {
          reserveManagedPath(reservedManagedPaths, reconciled.metadata.dataPath, "directory");
        }
      }

      if (!areDatasetMetadataEqual(metadata, reconciled.metadata)) {
        await this.writeDatasetMetadata(reconciled.metadata.datasetId, reconciled.metadata);
        hasChanges = true;
      }
    }

    const autoRegisteredCount = await this.autoRegisterWorkspaceManagedFiles(
      workspaceEntries,
      reservedManagedPaths
    );

    if (autoRegisteredCount > 0) {
      hasChanges = true;
    }

    this.pendingTrackingIssues = pendingIssues.sort((left, right) =>
      `${left.displayName} ${left.targetId}`.localeCompare(
        `${right.displayName} ${right.targetId}`,
        "ja"
      )
    );

    return hasChanges;
  }

  private async reconcileManagedFileMetadata(
    metadata: ManagedFileMetadata,
    workspaceEntries: readonly TrackableWorkspaceEntry[],
    claimedPaths: Set<string>
  ): Promise<ReconcileMetadataResult<ManagedFileMetadata>> {
    const nextMetadata: ManagedFileMetadata = {
      ...metadata
    };
    const currentVisiblePath = await this.resolveIfExists(metadata.path);

    if (currentVisiblePath) {
      nextMetadata.hash = await this.computeManagedDataHash(currentVisiblePath, metadata.representation);
      nextMetadata.visibility = inferVisibilityFromPath(metadata.path, metadata.representation);
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
      nextMetadata.visibility = inferVisibilityFromPath(
        matchedPath.relativePath,
        metadata.representation
      );
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
      nextMetadata.visibility = inferVisibilityFromPath(
        candidatePaths[0].relativePath,
        metadata.representation
      );
      claimedPaths.add(nextMetadata.path);
      return {
        metadata: nextMetadata
      };
    }

    if (candidatePaths.length > 1) {
      return {
        issue: buildRelinkTrackingIssue(nextMetadata, candidatePaths),
        metadata: nextMetadata
      };
    }

    return {
      issue: buildMissingTrackingIssue(nextMetadata),
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
      nextMetadata.visibility = inferVisibilityFromPath(metadata.path, metadata.representation);
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
      nextMetadata.visibility = inferVisibilityFromPath(
        matchedPath.relativePath,
        metadata.representation
      );
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
      nextMetadata.visibility = inferVisibilityFromPath(
        candidatePaths[0].relativePath,
        metadata.representation
      );
      await this.refreshDatasetManifestFields(nextMetadata);
      claimedPaths.add(nextMetadata.path);
      return {
        metadata: nextMetadata
      };
    }

    if (candidatePaths.length > 1) {
      return {
        issue: buildRelinkTrackingIssue(nextMetadata, candidatePaths),
        metadata: nextMetadata
      };
    }

    return {
      issue: buildMissingTrackingIssue(nextMetadata),
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
        datatype: "shimadzu-lc/raw-result",
        name: "raw-result"
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
    ...(callable.paramsSchema ? { paramsSchema: callable.paramsSchema } : {}),
    pluginDescription: "workspace の .py を走査する汎用 Python 解析 plugin",
    pluginDisplayName: "General Analysis",
    pluginId: GENERAL_ANALYSIS_PLUGIN_ID,
    source: "python-callable",
    title: callable.displayName
  };
}

function normalizeBlockDocument(
  block: IntegralBlockDocument,
  definition: IntegralBlockTypeDefinition,
  analysisResultDirectory?: string | null
): IntegralBlockDocument {
  const blockId =
    typeof block.id === "string" && block.id.trim().length > 0
      ? block.id.trim()
      : createOpaqueId("BLK");

  return {
    "block-type": definition.blockType,
    id: blockId,
    inputs: normalizeSlotMap(block.inputs, definition.inputSlots),
    outputs: normalizeOutputSlotMap(
      block.outputs,
      definition.outputSlots,
      definition.title,
      analysisResultDirectory
    ),
    params: normalizeIntegralParams(
      isJsonRecord(block.params) ? block.params : {},
      definition.paramsSchema
    ),
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

function normalizeOutputSlotMap(
  currentValue: Record<string, string | null> | undefined,
  slotDefinitions: readonly IntegralSlotDefinition[],
  analysisDisplayName?: string | null,
  outputRoot?: string | null
): Record<string, string | null> {
  const normalized: Record<string, string | null> = {};

  for (const slot of slotDefinitions) {
    const value = currentValue?.[slot.name];
    normalized[slot.name] =
      typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : createDefaultIntegralOutputPathWithRandomSuffix(slot, {
            analysisDisplayName,
            outputRoot
          });
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

function createOpaqueId(prefix: "ORD" | "BLK" | "DTS" | "FL"): string {
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
    const inputSlots = parsePythonSlotDefinitions(
      extractPythonKeywordSource(decoratorSource, "inputs"),
      "input"
    );
    const outputSlots = parsePythonSlotDefinitions(
      extractPythonKeywordSource(decoratorSource, "outputs"),
      "output"
    );
    const paramsSchema = normalizeIntegralParamsSchema(
      parsePythonLiteral(extractPythonKeywordSource(decoratorSource, "params"))
    );

    summaries.push({
      blockType: `${relativePath}:${functionName}`,
      description,
      displayName,
      functionName,
      inputSlots,
      outputSlots,
      ...(paramsSchema ? { paramsSchema } : {}),
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

  const items = splitTopLevelPythonItems(value, "[", "]");

  return items
    .map((item) => parsePythonStringLiteral(item))
    .filter((item): item is string => item !== null);
}

function parsePythonSlotDefinitions(
  value: string | null,
  direction: "input" | "output"
): IntegralSlotDefinition[] {
  const slotDefinitions: IntegralSlotDefinition[] = [];
  const seen = new Set<string>();

  for (const item of splitTopLevelPythonItems(value, "[", "]")) {
    const slotDefinition = parsePythonSlotDefinition(item, direction);

    if (!slotDefinition) {
      continue;
    }

    const normalizedKey = slotDefinition.name.toLowerCase();

    if (seen.has(normalizedKey)) {
      continue;
    }

    seen.add(normalizedKey);
    slotDefinitions.push(slotDefinition);
  }

  return slotDefinitions;
}

function parsePythonSlotDefinition(
  value: string,
  direction: "input" | "output"
): IntegralSlotDefinition | null {
  const normalizedString = parsePythonStringLiteral(value);

  if (normalizedString !== null) {
    const slotName = normalizeDiscoveredSlotNames([normalizedString])[0] ?? null;
    return slotName ? { name: slotName } : null;
  }

  const trimmed = value.trim();

  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }

  const name = parsePythonStringLiteral(extractPythonMappingValue(trimmed, "name"));
  const normalizedName = name ? normalizeDiscoveredSlotNames([name])[0] ?? null : null;

  if (!normalizedName) {
    return null;
  }

  const directExtension = normalizeIntegralSlotExtension(
    parsePythonStringLiteral(extractPythonMappingValue(trimmed, "extension"))
  );
  const listedExtensions = normalizeIntegralSlotExtensions(
    parsePythonStringArrayLiteral(extractPythonMappingValue(trimmed, "extensions"))
  );
  const normalizedExtensions = Array.from(
    new Set([...(listedExtensions ?? []), ...(directExtension ? [directExtension] : [])])
  );
  const datatypeValue = parsePythonStringLiteral(extractPythonMappingValue(trimmed, "datatype"));
  const autoInsertToWorkNote =
    direction === "output"
      ? parsePythonBooleanLiteral(extractPythonMappingValue(trimmed, "auto_insert_to_work_note")) ??
        false
      : false;
  const embedToSharedNote =
    direction === "output"
      ? parsePythonBooleanLiteral(extractPythonMappingValue(trimmed, "embed_to_shared_note")) ?? false
      : false;
  const sharedNoteWithInput =
    direction === "output"
      ? normalizeDiscoveredSlotNames([
          parsePythonStringLiteral(extractPythonMappingValue(trimmed, "share_note_with_input")) ?? ""
        ])[0] ?? null
      : null;

  return {
    autoInsertToWorkNote: direction === "output" ? autoInsertToWorkNote : undefined,
    datatype: datatypeValue ?? undefined,
    extension: direction === "output" ? directExtension ?? normalizedExtensions[0] : undefined,
    extensions: normalizedExtensions.length > 0 ? normalizedExtensions : undefined,
    name: normalizedName,
    shareNoteWithInput:
      direction === "output" && sharedNoteWithInput ? sharedNoteWithInput : undefined,
    embedToSharedNote: direction === "output" ? embedToSharedNote : undefined
  };
}

function parsePythonBooleanLiteral(value: string | null): boolean | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed === "True") {
    return true;
  }

  if (trimmed === "False") {
    return false;
  }

  return null;
}

function parsePythonLiteral(value: string | null): unknown {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  const stringValue = parsePythonStringLiteral(trimmed);

  if (stringValue !== null) {
    return stringValue;
  }

  if (trimmed === "True") {
    return true;
  }

  if (trimmed === "False") {
    return false;
  }

  if (trimmed === "None") {
    return null;
  }

  if (/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(trimmed)) {
    return Number(trimmed);
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return splitTopLevelPythonItems(trimmed, "[", "]")
      .map((item) => parsePythonLiteral(item))
      .filter((item) => item !== undefined);
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return parsePythonMappingLiteral(trimmed);
  }

  return undefined;
}

function parsePythonMappingLiteral(value: string): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {};

  for (const item of splitTopLevelPythonItems(value, "{", "}")) {
    const pair = splitTopLevelPythonMappingEntry(item);

    if (!pair) {
      continue;
    }

    const [rawKey, rawValue] = pair;
    const key = parsePythonStringLiteral(rawKey) ?? (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(rawKey.trim()) ? rawKey.trim() : null);

    if (!key) {
      continue;
    }

    const parsedValue = parsePythonLiteral(rawValue);

    if (parsedValue !== undefined) {
      result[key] = parsedValue;
    }
  }

  return result;
}

function splitTopLevelPythonItems(
  value: string | null,
  openToken: string,
  closeToken: string
): string[] {
  if (!value) {
    return [];
  }

  const trimmed = value.trim();

  if (trimmed === `${openToken}${closeToken}`) {
    return [];
  }

  if (!trimmed.startsWith(openToken) || !trimmed.endsWith(closeToken)) {
    return [];
  }

  const source = trimmed.slice(openToken.length, -closeToken.length);
  const items: string[] = [];
  let startIndex = 0;
  let quote: '"' | "'" | null = null;
  let bracketDepth = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
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
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }

    if (character === "," && bracketDepth === 0 && braceDepth === 0 && parenDepth === 0) {
      const item = source.slice(startIndex, index).trim();

      if (item.length > 0) {
        items.push(item);
      }

      startIndex = index + 1;
    }
  }

  const tail = source.slice(startIndex).trim();

  if (tail.length > 0) {
    items.push(tail);
  }

  return items;
}

function splitTopLevelPythonMappingEntry(value: string): [string, string] | null {
  let quote: '"' | "'" | null = null;
  let bracketDepth = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value.charAt(index);

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
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }

    if (character === ":" && bracketDepth === 0 && braceDepth === 0 && parenDepth === 0) {
      return [value.slice(0, index).trim(), value.slice(index + 1).trim()];
    }
  }

  return null;
}

function extractPythonMappingValue(source: string, key: string): string | null {
  const match = new RegExp(`(?:["']${escapeRegExp(key)}["']|${escapeRegExp(key)})\\s*:`, "u").exec(source);

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
      if (braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
        return source.slice(startIndex, index).trim().replace(/,$/u, "");
      }

      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }

    if (character === "(") {
      parenDepth += 1;
      continue;
    }

    if (character === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }

    if (character === "," && bracketDepth === 0 && braceDepth === 0 && parenDepth === 0) {
      return source.slice(startIndex, index).trim();
    }
  }

  return source.slice(startIndex).trim().replace(/,$/u, "");
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

function createDatasetManifestPathInDirectory(
  directoryRelativePath: string,
  datasetName: string,
  datasetId: string
): string {
  const normalizedDirectory = normalizeRelativePath(directoryRelativePath);
  const stem = sanitizeFileStem(path.posix.basename(datasetName)) || datasetId;
  return normalizeRelativePath(`${normalizedDirectory}/${stem}${DATASET_JSON_EXTENSION}`);
}

function createUniqueSourceMemberEntryName(
  originalName: string,
  managedFileId: string,
  usedEntryNames: Set<string>
): string {
  const trimmedName = originalName.trim();
  const baseName = trimmedName.length > 0 ? trimmedName : managedFileId;

  if (!usedEntryNames.has(baseName)) {
    usedEntryNames.add(baseName);
    return baseName;
  }

  const nextName = `${baseName}_${managedFileId}`;
  usedEntryNames.add(nextName);
  return nextName;
}

function createVisibleAliasEntryName(
  originalName: string,
  managedFileId: string,
  representation: ManagedFileRepresentation
): string {
  const trimmedName = originalName.trim();

  if (representation === "directory") {
    const baseName = trimmedName.length > 0 ? trimmedName : managedFileId;
    return `${baseName}_${managedFileId}`;
  }

  const extension = path.extname(trimmedName);
  const baseName = extension.length > 0 ? trimmedName.slice(0, -extension.length) : trimmedName;
  const normalizedBaseName = baseName.length > 0 ? baseName : managedFileId;
  return `${normalizedBaseName}_${managedFileId}${extension}`;
}

function sanitizeFileStem(value: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, "_")
    .replace(/[. ]+$/gu, "");
}

function normalizePlannedWorkspaceOutputPath(value: string): string {
  const workspaceTarget = resolveWorkspaceMarkdownTarget(value) ?? value;
  const trimmed = workspaceTarget.trim().replace(/\\/gu, "/");

  if (
    trimmed.length === 0 ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("//") ||
    trimmed.includes("?") ||
    trimmed.includes("#") ||
    EXTERNAL_SCHEME_PATTERN.test(trimmed)
  ) {
    throw new Error(`output path が不正です: ${value}`);
  }

  const withoutPrefix = trimmed
    .replace(/^\/+/u, "")
    .replace(/^\.\/+/u, "");
  const parts = withoutPrefix.split("/").filter(Boolean);

  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw new Error(`output path が不正です: ${value}`);
  }

  if (parts[0]?.toLowerCase() === STORE_DIRECTORY) {
    throw new Error(".store 配下は system 管理領域のため指定できません。");
  }

  return parts.join("/");
}

function ensureOutputPathExtension(relativePath: string, extension: string): string {
  const normalizedExtension = normalizeIntegralSlotExtension(extension) ?? "";

  if (normalizedExtension.length === 0) {
    return relativePath;
  }

  const currentExtension = path.posix.extname(relativePath).toLowerCase();

  if (currentExtension.length === 0) {
    return `${relativePath}${normalizedExtension}`;
  }

  if (currentExtension !== normalizedExtension) {
    throw new Error(
      `output path の拡張子が slot 定義と一致しません: ${relativePath} (expected ${normalizedExtension})`
    );
  }

  return relativePath;
}

function resolveOutputDisplayName(relativePath: string, fallback: string): string {
  const baseName = path.posix.basename(relativePath);
  const extension = path.posix.extname(baseName);
  const stem = extension.length > 0 ? baseName.slice(0, -extension.length) : baseName;
  const normalized = stem.trim();
  return normalized.length > 0 ? normalized : fallback;
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
    (value.datatype === null || value.datatype === undefined || typeof value.datatype === "string") &&
    (value.displayName === undefined || typeof value.displayName === "string") &&
    value.representation === "dataset-json" &&
    (value.visibility === "visible" || value.visibility === "hidden") &&
    (value.provenance === "source" || value.provenance === "derived") &&
    (value.createdByBlockId === null ||
      value.createdByBlockId === undefined ||
      typeof value.createdByBlockId === "string") &&
    (value.dataPath === undefined || typeof value.dataPath === "string") &&
    (value.noteTargetId === undefined || typeof value.noteTargetId === "string") &&
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
      datatype: value.datatype ?? null,
      datasetId,
      displayName: name,
      entityType: "dataset",
      hash: value.hash,
      id: datasetId,
      dataPath:
        typeof value.dataPath === "string" && value.dataPath.trim().length > 0
          ? normalizeRelativePath(value.dataPath)
          : undefined,
      memberIds: value.memberIds,
      name,
      noteTargetId: normalizeManagedDataNoteTargetId(value.noteTargetId, datasetId),
      path: normalizeRelativePath(value.path),
      provenance: value.provenance,
      representation: value.representation,
      visibility: value.visibility
    };
  }

  return null;
}

function normalizeManagedFileMetadata(value: unknown): ManagedFileMetadata | null {
  if (!isJsonRecord(value)) {
    return null;
  }

  if (
    value.entityType === "managed-file" &&
    typeof value.id === "string" &&
    typeof value.displayName === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.path === "string" &&
    typeof value.hash === "string" &&
    (value.representation === "file" || value.representation === "directory") &&
    (value.visibility === "visible" || value.visibility === "hidden") &&
    (value.createdByBlockId === null ||
      value.createdByBlockId === undefined ||
      typeof value.createdByBlockId === "string") &&
    (value.noteTargetId === undefined || typeof value.noteTargetId === "string") &&
    (value.datatype === null || value.datatype === undefined || typeof value.datatype === "string")
  ) {
    const managedFileId = value.id.trim();

    return {
      createdAt: value.createdAt,
      createdByBlockId: value.createdByBlockId ?? null,
      datatype: value.datatype ?? null,
      displayName: value.displayName,
      entityType: "managed-file",
      hash: value.hash,
      id: managedFileId,
      noteTargetId: normalizeManagedDataNoteTargetId(value.noteTargetId, managedFileId),
      path: normalizeRelativePath(value.path),
      representation: value.representation,
      visibility: value.visibility
    };
  }

  return null;
}

function createManagedDataNoteRelativePath(targetId: string): string {
  return `${STORE_DIRECTORY}/${STORE_METADATA_DIRECTORY}/data-notes/${targetId.trim()}.md`;
}

function normalizeManagedDataNoteTargetId(value: unknown, fallbackId: string): string {
  const fallback = fallbackId.trim();
  const candidate = typeof value === "string" ? value.trim() : "";
  return candidate.length > 0 ? candidate : fallback;
}

function buildWorkNoteProjectionMarkdown(targets: readonly string[]): string | null {
  const normalizedTargets = Array.from(
    new Set(targets.map((target) => target.trim()).filter((target) => target.length > 0))
  );

  if (normalizedTargets.length === 0) {
    return null;
  }

  return normalizedTargets.map((target) => `![](${target})`).join("\n\n");
}

function buildDataNoteProjectionMarkdown(
  sourceNotePath: string,
  blockId: string,
  targets: readonly string[]
): string | null {
  const embedsMarkdown = buildWorkNoteProjectionMarkdown(targets);

  if (!embedsMarkdown) {
    return null;
  }

  return `${buildProvenanceLinkMarkdown(sourceNotePath, blockId)}\n\n${embedsMarkdown}`;
}

function buildProvenanceLinkMarkdown(sourceNotePath: string, blockId: string): string {
  const normalizedPath = normalizeRelativePath(sourceNotePath);
  const normalizedBlockId = blockId.trim();
  const target = `${toCanonicalWorkspaceTarget(normalizedPath)}#${normalizedBlockId}`;
  return `[${normalizedPath} / ${normalizedBlockId}](${target})`;
}

function appendMarkdownToNoteBody(existingBody: string, markdownToAppend: string): string {
  const normalizedExistingBody = existingBody.replace(/\r\n/gu, "\n");
  const normalizedMarkdownToAppend = markdownToAppend.trim();

  if (normalizedMarkdownToAppend.length === 0) {
    return normalizedExistingBody;
  }

  if (normalizedExistingBody.trim().length === 0) {
    return `${normalizedMarkdownToAppend}\n`;
  }

  const separator = normalizedExistingBody.endsWith("\n\n")
    ? ""
    : normalizedExistingBody.endsWith("\n")
      ? "\n"
      : "\n\n";

  return `${normalizedExistingBody}${separator}${normalizedMarkdownToAppend}\n`;
}

function supportsManagedFileDataNote(
  relativePath: string,
  representation: ManagedFileRepresentation
): boolean {
  if (representation !== "file") {
    return true;
  }

  return !path.posix.basename(normalizeRelativePath(relativePath)).toLowerCase().endsWith(".md");
}

function areDatasetMetadataEqual(left: DatasetMetadata, right: DatasetMetadata): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function areManagedFileMetadataEqual(left: ManagedFileMetadata, right: ManagedFileMetadata): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function inferVisibilityFromPath(
  relativePath: string,
  representation: DatasetRepresentation | ManagedFileRepresentation
): ManagedDataVisibility {
  const normalizedPath = normalizeRelativePath(relativePath);

  if (normalizedPath.length === 0) {
    return "visible";
  }

  const segments = normalizedPath.split("/").filter(Boolean);
  const parentSegments = segments.slice(0, -1);
  const leafSegment = segments[segments.length - 1] ?? "";
  const hasHiddenDirectory = parentSegments.some(isHiddenDirectorySegment) ||
    (representation === "directory" && isHiddenDirectorySegment(leafSegment));

  if (hasHiddenDirectory || leafSegment.startsWith(".")) {
    return "hidden";
  }

  return "visible";
}

function isHiddenDirectorySegment(segment: string): boolean {
  return segment.startsWith(".") || segment.startsWith("_");
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

function collectManagedDataDeletedByWorkspaceMutations(
  mutations: readonly WorkspaceMutation[],
  metadataList: readonly ManagedDataMetadata[]
): ManagedDataMetadata[] {
  const deleteMutations = mutations.filter((mutation) => mutation.kind === "delete");

  if (deleteMutations.length === 0) {
    return [];
  }

  return metadataList.filter((metadata) =>
    deleteMutations.some((mutation) => doWorkspacePathsOverlap(metadata.path, mutation.path))
  );
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
  representation: DatasetRepresentation | ManagedFileRepresentation,
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
  metadata: DatasetMetadata | ManagedFileMetadata,
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
  metadata: DatasetMetadata | ManagedFileMetadata
): Set<string> {
  const candidateNames = new Set<string>();
  const recordedBaseName = path.posix.basename(metadata.path);

  if (recordedBaseName.length > 0) {
    candidateNames.add(recordedBaseName);
  }

  if (metadata.entityType === "managed-file") {
    const displayName = metadata.displayName.trim();

    if (displayName.length > 0) {
      candidateNames.add(displayName);
      candidateNames.add(path.posix.basename(displayName));
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

function collectGeneratedOutputReferencePaths(
  metadataList: readonly ManagedDataMetadata[]
): string[] {
  const referencePaths = new Set<string>();

  for (const metadata of metadataList) {
    if (metadata.entityType === "dataset") {
      const dataPath = normalizeRelativePath(metadata.dataPath ?? "");

      if (dataPath.length > 0) {
        referencePaths.add(dataPath);
      }

      referencePaths.add(normalizeRelativePath(metadata.path));
      continue;
    }

    referencePaths.add(normalizeRelativePath(metadata.path));
  }

  return [...referencePaths]
    .filter((relativePath) => relativePath.length > 0)
    .sort((left, right) => left.localeCompare(right, "ja"));
}

async function collectMarkdownRelativePathsForReferenceCleanup(
  rootPath: string,
  currentPath: string = rootPath
): Promise<string[]> {
  const entries = await fs.readdir(currentPath, { withFileTypes: true }).catch(() => []);
  const relativePaths: string[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "ja"))) {
    const absolutePath = path.join(currentPath, entry.name);
    const relativePath = path.relative(rootPath, absolutePath).split(path.sep).join("/");

    if (entry.isDirectory()) {
      if (REFERENCE_CLEANUP_EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
        continue;
      }

      relativePaths.push(
        ...(await collectMarkdownRelativePathsForReferenceCleanup(rootPath, absolutePath))
      );
      continue;
    }

    if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".md") {
      relativePaths.push(relativePath);
    }
  }

  return relativePaths;
}

function doesEntryMatchRepresentation(
  entry: TrackableWorkspaceEntry,
  representation: DatasetRepresentation | ManagedFileRepresentation
): boolean {
  return (representation === "directory" && entry.kind === "directory") ||
    (representation !== "directory" && entry.kind === "file");
}

function buildRelinkTrackingIssue(
  metadata: DatasetMetadata | ManagedFileMetadata,
  candidatePaths: readonly TrackableWorkspaceEntry[]
): IntegralManagedDataTrackingIssue {
  return {
    candidatePaths: candidatePaths
      .map((candidate) => candidate.relativePath)
      .sort((left, right) => left.localeCompare(right, "ja")),
    displayName: metadata.displayName,
    entityType: metadata.entityType,
    kind: "relink",
    recordedHash: metadata.hash,
    recordedPath: metadata.path,
    representation: metadata.representation,
    targetId: metadata.id
  };
}

function buildMissingTrackingIssue(
  metadata: DatasetMetadata | ManagedFileMetadata
): IntegralManagedDataTrackingIssue {
  return {
    candidatePaths: [],
    displayName: metadata.displayName,
    entityType: metadata.entityType,
    kind: "missing",
    recordedHash: metadata.hash,
    recordedPath: metadata.path,
    representation: metadata.representation,
    targetId: metadata.id
  };
}

function reserveManagedPath(
  reservedManagedPaths: ReservedManagedPath[],
  relativePath: string,
  representation: DatasetRepresentation | ManagedFileRepresentation
): void {
  const normalizedPath = normalizeRelativePath(relativePath);

  if (
    normalizedPath.length === 0 ||
    reservedManagedPaths.some(
      (reservedPath) =>
        reservedPath.representation === representation &&
        normalizeRelativePath(reservedPath.relativePath) === normalizedPath
    )
  ) {
    return;
  }

  reservedManagedPaths.push({
    relativePath: normalizedPath,
    representation
  });
}

function reserveTrackingIssueCandidates(
  reservedManagedPaths: ReservedManagedPath[],
  issue: IntegralManagedDataTrackingIssue
): void {
  for (const candidatePath of issue.candidatePaths) {
    reserveManagedPath(reservedManagedPaths, candidatePath, issue.representation);
  }
}

function isAutoRegisterableManagedFileEntry(
  entry: TrackableWorkspaceEntry,
  reservedManagedPaths: readonly ReservedManagedPath[]
): boolean {
  if (entry.kind !== "file") {
    return false;
  }

  const normalizedRelativePath = normalizeRelativePath(entry.relativePath);

  if (normalizedRelativePath.length === 0) {
    return false;
  }

  const pathSegments = normalizedRelativePath.split("/").filter(Boolean);

  if (
    pathSegments.length === 0 ||
    pathSegments.slice(0, -1).some(isHiddenDirectorySegment) ||
    (pathSegments[pathSegments.length - 1] ?? "").startsWith(".") ||
    pathSegments.some((segment) => AUTO_REGISTER_EXCLUDED_DIRECTORY_NAMES.has(segment))
  ) {
    return false;
  }

  return !isReservedManagedPath(normalizedRelativePath, reservedManagedPaths);
}

function isReservedManagedPath(
  relativePath: string,
  reservedManagedPaths: readonly ReservedManagedPath[]
): boolean {
  const normalizedRelativePath = normalizeRelativePath(relativePath);

  return reservedManagedPaths.some((reservedPath) => {
    const normalizedReservedPath = normalizeRelativePath(reservedPath.relativePath);

    if (reservedPath.representation === "directory") {
      return normalizedRelativePath === normalizedReservedPath ||
        normalizedRelativePath.startsWith(`${normalizedReservedPath}/`);
    }

    return normalizedRelativePath === normalizedReservedPath;
  });
}

function resolvePythonCommand(): string {
  const configured = process.env.INTEGRALNOTES_PYTHON?.trim();
  return configured && configured.length > 0 ? configured : "python";
}

function buildPythonExecutionLogText({
  definitionTitle,
  errorMessage,
  finishedAt,
  startedAt,
  status,
  stderr,
  stdout
}: {
  definitionTitle: string;
  errorMessage?: string;
  finishedAt: string;
  startedAt: string;
  status: "error" | "success";
  stderr: string;
  stdout: string;
}): string | null {
  const normalizedStdout = stdout.trimEnd();
  const normalizedStderr = stderr.trimEnd();
  const normalizedErrorMessage = errorMessage?.trim() ?? "";

  if (
    status === "success" &&
    normalizedStdout.length === 0 &&
    normalizedStderr.length === 0
  ) {
    return null;
  }

  return [
    `${definitionTitle} execution log`,
    "",
    `status: ${status}`,
    `startedAt: ${startedAt}`,
    `finishedAt: ${finishedAt}`,
    ...(normalizedErrorMessage.length > 0 ? ["", "error:", normalizedErrorMessage] : []),
    ...(normalizedStderr.length > 0 ? ["", "stderr:", normalizedStderr] : []),
    ...(normalizedStdout.length > 0 ? ["", "stdout:", normalizedStdout] : [])
  ].join("\n");
}

async function resolveBundledPythonSdkPackageTemplatePath(): Promise<string> {
  const developmentSourcePath = path.resolve(__dirname, "../../Notes/scripts/integral");
  const legacyDevelopmentSourcePath = path.resolve(__dirname, "../../scripts/integral");
  const packagedSourcePath = path.join(
    process.resourcesPath,
    "workspace-template",
    "scripts",
    "integral"
  );
  const legacyPackagedSourcePath = path.join(process.resourcesPath, "python-sdk", "integral");
  const candidatePaths = process.env.VITE_DEV_SERVER_URL
    ? [developmentSourcePath, legacyDevelopmentSourcePath, packagedSourcePath, legacyPackagedSourcePath]
    : [packagedSourcePath, legacyPackagedSourcePath, developmentSourcePath, legacyDevelopmentSourcePath];

  for (const candidatePath of candidatePaths) {
    if (await pathExists(candidatePath)) {
      return candidatePath;
    }
  }

  return candidatePaths[0] ?? developmentSourcePath;
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
    case ".csv":
      return "text/csv";
    case ".html":
    case ".htm":
      return "text/html";
    case ".json":
      return "application/json";
    case ".bmp":
      return "image/bmp";
    case ".gif":
      return "image/gif";
    case ".md":
    case ".txt":
    case ".tsv":
    case ".xml":
    case ".yaml":
    case ".yml":
      return "text/plain";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
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
