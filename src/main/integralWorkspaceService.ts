import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import type {
  CreateSourceDatasetRequest,
  CreateSourceDatasetResult,
  ExecuteIntegralBlockRequest,
  ExecuteIntegralBlockResult,
  ImportOriginalDataResult,
  IntegralAssetCatalog,
  IntegralOriginalDataSummary,
  IntegralBlockDocument,
  IntegralBlockTypeDefinition,
  IntegralDatasetInspection,
  IntegralDatasetSummary,
  IntegralRenderableFile,
  IntegralScriptAssetSummary,
  IntegralSlotDefinition,
  PythonEntrySelection,
  RegisterPythonScriptRequest,
  RegisterPythonScriptResult
} from "../shared/integral";
import type { InstalledPluginDefinition } from "../shared/plugins";
import { PluginRegistry } from "./pluginRegistry";
import { WorkspaceService } from "./workspaceService";

const execFileAsync = promisify(execFile);

const DATA_CATALOG_DIRECTORY = "data-catalog";
const DATA_DIRECTORY = "Data";
const NOTES_DIRECTORY = "Notes";
const STORE_DIRECTORY = ".store";
const STORE_METADATA_DIRECTORY = ".integral";
const PYTHON_SCRIPTS_DIRECTORY = ".py-scripts";

const BUILTIN_DISPLAY_PLUGIN_ID = "core-display";
const GENERAL_ANALYSIS_PLUGIN_ID = "general-analysis";
const DISPLAY_BLOCK_TYPE = "dataset-view";
const SHIMADZU_PLUGIN_ID = "shimadzu-lc";
const SHIMADZU_BLOCK_TYPE = "run-sequence";
const STANDARD_GRAPHS_PLUGIN_ID = "integralnotes.standard-graphs";

const HTML_EXTENSIONS = new Set([".html"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".svg"]);
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".json", ".csv"]);

interface OriginalDataMetadata {
  aliasRelativePath: string;
  originalDataId: string;
  createdAt: string;
  originalName: string;
  storeRelativePath: string;
  sourceKind: "directory" | "file";
}

interface SourceDatasetMember {
  entryName: string;
  originalDataId: string;
}

interface DatasetMetadata {
  datasetId: string;
  createdAt: string;
  createdByBlockId: string | null;
  kind: string;
  sourceMembers?: SourceDatasetMember[];
  storeRelativePath: string;
}

interface InspectableFileEntry {
  absolutePath: string;
  relativePath: string;
}

interface PythonScriptManifest {
  createdAt: string;
  description: string;
  displayName: string;
  entry: string;
  inputSlots: IntegralSlotDefinition[];
  outputSlots: IntegralSlotDefinition[];
  scriptId: string;
}

interface ExecFileError extends Error {
  code?: number | string;
  stderr?: string;
  stdout?: string;
}

export class IntegralWorkspaceService {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly pluginRegistry: PluginRegistry
  ) {}

  async describePythonEntryFile(entryAbsolutePath: string): Promise<PythonEntrySelection> {
    await this.workspaceService.ensureWorkspaceReady();

    const resolvedEntryPath = path.resolve(entryAbsolutePath);
    const entryStats = await fs.stat(resolvedEntryPath);

    if (!entryStats.isFile() || path.extname(resolvedEntryPath).toLowerCase() !== ".py") {
      throw new Error("entry には .py ファイルを指定してください。");
    }

    return {
      autoIncludedFilePaths: await collectAutoIncludedPythonFiles(resolvedEntryPath),
      entryAbsolutePath: resolvedEntryPath,
      suggestedDisplayName: path.basename(resolvedEntryPath, ".py")
    };
  }

  async listAssetCatalog(): Promise<IntegralAssetCatalog> {
    await this.workspaceService.ensureWorkspaceReady();

    const [originalData, datasets, scripts, externalPlugins] = await Promise.all([
      this.readOriginalDataSummaries(),
      this.readDatasetSummaries(),
      this.readPythonScriptSummaries(),
      this.pluginRegistry.listInstalledPlugins()
    ]);

    return {
      datasets,
      blockTypes: buildBlockTypeCatalog(scripts, externalPlugins),
      originalData,
      scripts
    };
  }

  async importOriginalDataPaths(sourcePaths: string[]): Promise<ImportOriginalDataResult> {
    await this.workspaceService.ensureWorkspaceReady();

    if (sourcePaths.length === 0) {
      throw new Error("元データとして登録するファイルまたはフォルダを選択してください。");
    }

    const importedOriginalData: IntegralOriginalDataSummary[] = [];

    for (const sourcePath of sourcePaths) {
      const rootPath = this.getRootPath();
      const resolvedSourcePath = path.resolve(sourcePath);
      const sourceStats = await fs.stat(resolvedSourcePath);
      const sourceKind = sourceStats.isDirectory() ? "directory" : "file";
      const sourceInsideWorkspace = this.isWorkspacePath(rootPath, resolvedSourcePath);

      if (sourceInsideWorkspace) {
        this.assertRegisterableOriginalDataPath(rootPath, resolvedSourcePath);
      }

      const originalDataId = createOpaqueId("BLB");
      const storeRelativePath = createOriginalDataStoreRelativePath(
        originalDataId,
        path.basename(resolvedSourcePath),
        sourceKind
      );
      const aliasRelativePath = await this.resolveOriginalDataAliasRelativePath(
        rootPath,
        resolvedSourcePath,
        originalDataId,
        sourceKind
      );
      const storeAbsolutePath = this.resolveWorkspacePath(storeRelativePath);
      const aliasAbsolutePath = this.resolveWorkspacePath(aliasRelativePath);
      const metadata: OriginalDataMetadata = {
        aliasRelativePath,
        originalDataId,
        createdAt: new Date().toISOString(),
        originalName: path.basename(resolvedSourcePath),
        storeRelativePath,
        sourceKind
      };

      await fs.mkdir(path.dirname(storeAbsolutePath), { recursive: true });
      await fs.mkdir(path.dirname(aliasAbsolutePath), { recursive: true });

      if (sourceInsideWorkspace) {
        await fs.rename(resolvedSourcePath, storeAbsolutePath);
      } else {
        await this.copyOriginalDataIntoStore(resolvedSourcePath, storeAbsolutePath, sourceKind);
      }

      await this.createVisibleAlias(storeAbsolutePath, aliasAbsolutePath, metadata.sourceKind);

      await this.writeOriginalDataMetadata(originalDataId, metadata);
      await this.writeOriginalDataNote(metadata);
      importedOriginalData.push(this.toOriginalDataSummary(metadata));
    }

    return {
      originalData: importedOriginalData
    };
  }

  async createSourceDataset(request: CreateSourceDatasetRequest): Promise<CreateSourceDatasetResult> {
    await this.workspaceService.ensureWorkspaceReady();

    const originalDataIds = request.originalDataIds
      .map((originalDataId) => originalDataId.trim())
      .filter((originalDataId) => originalDataId.length > 0);

    if (originalDataIds.length === 0) {
      throw new Error("source dataset を作るには少なくとも 1 つの元データが必要です。");
    }

    const uniqueOriginalDataIds = Array.from(new Set(originalDataIds));
    const datasetId = createOpaqueId("CNK");
    const datasetRootPath = this.resolveDatasetRootPath(datasetId);
    const sourceMembers: SourceDatasetMember[] = [];
    const usedEntryNames = new Set<string>();

    await fs.mkdir(datasetRootPath, { recursive: true });

    for (const originalDataId of uniqueOriginalDataIds) {
      const originalDataMetadata = await this.readOriginalDataMetadata(originalDataId);

      if (originalDataMetadata === null) {
        throw new Error(`元データが見つかりません: ${originalDataId}`);
      }

      const entryName = createUniqueSourceMemberEntryName(
        originalDataMetadata.originalName,
        originalDataId,
        usedEntryNames
      );
      const originalDataPath = this.resolveOriginalDataStorePath(originalDataMetadata);

      await this.createVisibleAlias(
        originalDataPath,
        path.join(datasetRootPath, entryName),
        originalDataMetadata.sourceKind
      );
      sourceMembers.push({
        entryName,
        originalDataId
      });
    }

    const datasetMetadata: DatasetMetadata = {
      datasetId,
      createdAt: new Date().toISOString(),
      createdByBlockId: null,
      kind: "source-bundle",
      sourceMembers,
      storeRelativePath: createDatasetStoreRelativePath(datasetId)
    };

    await this.writeDatasetMetadata(datasetId, datasetMetadata);

    return {
      dataset: await this.readDatasetSummary(datasetId)
    };
  }

  async registerPythonScript(
    request: RegisterPythonScriptRequest
  ): Promise<RegisterPythonScriptResult> {
    await this.workspaceService.ensureWorkspaceReady();

    const resolvedEntryPath = path.resolve(request.entryAbsolutePath);
    const entryStats = await fs.stat(resolvedEntryPath);

    if (!entryStats.isFile() || path.extname(resolvedEntryPath).toLowerCase() !== ".py") {
      throw new Error("entry には .py ファイルを指定してください。");
    }

    const autoIncludedFilePaths = await collectAutoIncludedPythonFiles(resolvedEntryPath);
    const filePaths = Array.from(
      new Set([
        resolvedEntryPath,
        ...autoIncludedFilePaths,
        ...request.includedFilePaths.map((value) => path.resolve(value))
      ])
    );
    const normalizedInputSlots = normalizeSlotNames(request.inputSlotNames, "input slot");
    const normalizedOutputSlots = normalizeSlotNames(request.outputSlotNames, "output slot");
    const scriptId = createOpaqueId("PYS");
    const scriptRootPath = this.resolvePythonScriptRootPath(scriptId);
    const copiedBasenames = new Set<string>();

    await fs.mkdir(scriptRootPath, { recursive: true });

    for (const sourcePath of filePaths) {
      const sourceStats = await fs.stat(sourcePath);

      if (!sourceStats.isFile()) {
        throw new Error(`同梱対象はファイルのみ対応しています: ${sourcePath}`);
      }

      const basename = path.basename(sourcePath);
      const normalizedBasename = basename.toLowerCase();

      if (copiedBasenames.has(normalizedBasename)) {
        throw new Error(`フラット配置ではファイル名が衝突します: ${basename}`);
      }

      copiedBasenames.add(normalizedBasename);
      await fs.copyFile(sourcePath, path.join(scriptRootPath, basename));
    }

    const manifest: PythonScriptManifest = {
      createdAt: new Date().toISOString(),
      description: request.description.trim(),
      displayName:
        request.displayName.trim().length > 0
          ? request.displayName.trim()
          : path.basename(resolvedEntryPath, ".py"),
      entry: path.basename(resolvedEntryPath),
      inputSlots: normalizedInputSlots.map((name) => ({ name })),
      outputSlots: normalizedOutputSlots.map((name) => ({ name })),
      scriptId
    };

    await fs.writeFile(
      path.join(scriptRootPath, "script.json"),
      JSON.stringify(manifest, null, 2),
      "utf8"
    );

    const script = this.toScriptSummary(manifest);

    return {
      blockType: buildPythonBlockType(script),
      script
    };
  }

  async inspectDataset(datasetId: string): Promise<IntegralDatasetInspection> {
    await this.workspaceService.ensureWorkspaceReady();

    const datasetMetadata = await this.readDatasetMetadata(datasetId);

    if (datasetMetadata === null) {
      throw new Error(`dataset が見つかりません: ${datasetId}`);
    }

    const datasetRootPath = this.resolveDatasetRootPath(datasetId);
    const inspectableFiles = await this.collectInspectableFiles(datasetRootPath, datasetMetadata);
    const relativeFilePaths = inspectableFiles.map((entry) => entry.relativePath);
    const renderables = await Promise.all(
      inspectableFiles
        .filter((entry) => isRenderableExtension(path.extname(entry.relativePath)))
        .map((entry) => this.readRenderableFile(entry.absolutePath, entry.relativePath))
    );

    return {
      datasetId: datasetMetadata.datasetId,
      createdAt: datasetMetadata.createdAt,
      createdByBlockId: datasetMetadata.createdByBlockId,
      fileNames: relativeFilePaths,
      hasRenderableFiles: renderables.length > 0,
      kind: datasetMetadata.kind,
      renderableCount: renderables.length,
      renderables
    };
  }

  async executeBlock(
    request: ExecuteIntegralBlockRequest
  ): Promise<ExecuteIntegralBlockResult> {
    await this.workspaceService.ensureWorkspaceReady();

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
      return this.executeExternalPluginBlock(normalizedBlock, definition);
    }

    return this.executeGeneralAnalysisBlock(normalizedBlock, definition, catalog.scripts);
  }

  private getRootPath(): string {
    const rootPath = this.workspaceService.currentRootPath;

    if (!rootPath) {
      throw new Error("ワークスペースフォルダが未設定です。");
    }

    return rootPath;
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

  private resolveDatasetRootPath(datasetId: string): string {
    return this.resolveWorkspacePath(createDatasetStoreRelativePath(datasetId));
  }

  private resolvePythonScriptRootPath(scriptId: string): string {
    return this.resolveWorkspacePath(`${PYTHON_SCRIPTS_DIRECTORY}/${scriptId}`);
  }

  private async executeGeneralAnalysisBlock(
    block: IntegralBlockDocument,
    definition: IntegralBlockTypeDefinition,
    scripts: readonly IntegralScriptAssetSummary[]
  ): Promise<ExecuteIntegralBlockResult> {
    if (definition.pluginId !== GENERAL_ANALYSIS_PLUGIN_ID) {
      throw new Error(`未対応の plugin 実行です: ${definition.pluginId}`);
    }

    for (const inputSlot of definition.inputSlots) {
      const datasetId = block.inputs[inputSlot.name];

      if (!datasetId) {
        throw new Error(`input slot が未設定です: ${inputSlot.name}`);
      }

      if ((await this.readDatasetMetadata(datasetId)) === null) {
        throw new Error(`input dataset が見つかりません: ${datasetId}`);
      }
    }

    const script = scripts.find((candidate) => candidate.scriptId === definition.blockType);

    if (!script) {
      throw new Error(`Python script 資産が見つかりません: ${definition.blockType}`);
    }

    const scriptRootPath = this.resolvePythonScriptRootPath(script.scriptId);
    const outputDatasetMap = new Map<string, IntegralDatasetSummary>();
    const outputPaths: Record<string, string | null> = {};

    for (const outputSlot of definition.outputSlots) {
      const nextDatasetId = createOpaqueId("CNK");
      const metadata: DatasetMetadata = {
        datasetId: nextDatasetId,
        createdAt: new Date().toISOString(),
        createdByBlockId: block.id ?? null,
        kind: outputSlot.producedKind?.trim() || `${block["block-type"]}.${outputSlot.name}`,
        storeRelativePath: createDatasetStoreRelativePath(nextDatasetId)
      };

      await fs.mkdir(this.resolveDatasetRootPath(nextDatasetId), { recursive: true });
      await this.writeDatasetMetadata(nextDatasetId, metadata);

      const datasetSummary = await this.readDatasetSummary(nextDatasetId);
      outputDatasetMap.set(outputSlot.name, datasetSummary);
      outputPaths[outputSlot.name] = this.resolveDatasetRootPath(nextDatasetId);
    }

    const inputPaths = Object.fromEntries(
      definition.inputSlots.map((slot) => {
        const datasetId = block.inputs[slot.name];
        return [slot.name, datasetId ? this.resolveDatasetRootPath(datasetId) : null];
      })
    );
    const startedAt = new Date().toISOString();
    const analysisArgs = {
      inputs: inputPaths,
      outputs: outputPaths,
      params: {}
    };

    await fs.writeFile(
      path.join(scriptRootPath, "analysis-args.json"),
      JSON.stringify(analysisArgs, null, 2),
      "utf8"
    );

    const pythonCommand = resolvePythonCommand();
    let stdout = "";
    let stderr = "";

    try {
      const execution = await execFileAsync(pythonCommand, [script.entry], {
        cwd: scriptRootPath,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true
      });

      stdout = execution.stdout ?? "";
      stderr = execution.stderr ?? "";
    } catch (error) {
      const executionError = error as ExecFileError;
      stdout = executionError.stdout ?? "";
      stderr = executionError.stderr ?? "";

      await this.writePythonExecutionLogs(scriptRootPath, stdout, stderr);

      throw new Error(
        [
          `${script.displayName} の実行に失敗しました。`,
          stderr.trim() || stdout.trim() || executionError.message
        ]
          .filter(Boolean)
          .join("\n")
      );
    }

    await this.writePythonExecutionLogs(scriptRootPath, stdout, stderr);

    const finishedAt = new Date().toISOString();
    const createdDatasets = definition.outputSlots
      .map((slot) => outputDatasetMap.get(slot.name))
      .filter((dataset): dataset is IntegralDatasetSummary => dataset !== undefined);
    const nextOutputs = { ...block.outputs };

    for (const outputSlot of definition.outputSlots) {
      nextOutputs[outputSlot.name] = outputDatasetMap.get(outputSlot.name)?.datasetId ?? null;
    }

    return {
      block: {
        ...block,
        outputs: nextOutputs
      },
      createdDatasets,
      finishedAt,
      logLines: [...splitLogLines(stdout), ...splitLogLines(stderr)],
      startedAt,
      status: "success",
      summary: `${script.displayName} を実行しました。`
    };
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

  private async writeOriginalDataNote(metadata: OriginalDataMetadata): Promise<void> {
    const dataNotePath = this.resolveWorkspacePath(
      `${DATA_CATALOG_DIRECTORY}/${createOriginalDataNoteFileName(metadata.originalName, metadata.originalDataId)}`
    );
    const aliasRelativePath = path
      .relative(path.dirname(dataNotePath), this.resolveOriginalDataAliasPath(metadata))
      .split(path.sep)
      .join("/");
    const storeRelativePath = path
      .relative(
        path.dirname(dataNotePath),
        this.resolveOriginalDataStorePath(metadata)
      )
      .split(path.sep)
      .join("/");
    const lines = [
      `# ${metadata.originalName}_${metadata.originalDataId}`,
      "",
      `- Original Name: ${metadata.originalName}`,
      `- Original Data ID: ${metadata.originalDataId}`,
      `- Source Kind: ${metadata.sourceKind}`,
      `- Created At: ${metadata.createdAt}`,
      `- Alias Path: \`${aliasRelativePath}\``,
      `- Store Path: \`${storeRelativePath}\``
    ];

    await fs.writeFile(dataNotePath, `${lines.join("\n")}\n`, "utf8");
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
    return readJsonFile<OriginalDataMetadata>(
      path.join(this.resolveStoreMetadataRootPath(), `${originalDataId}.json`)
    );
  }

  private async readDatasetMetadata(datasetId: string): Promise<DatasetMetadata | null> {
    return readJsonFile<DatasetMetadata>(
      path.join(this.resolveStoreMetadataRootPath(), `${datasetId}.json`)
    );
  }

  private async readOriginalDataSummaries(): Promise<IntegralOriginalDataSummary[]> {
    const metadataRootPath = this.resolveStoreMetadataRootPath();
    const entries = await fs.readdir(metadataRootPath, { withFileTypes: true });
    const summaries = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".json")
        .map(async (entry) => {
          const metadata = await readJsonFile<OriginalDataMetadata>(path.join(metadataRootPath, entry.name));

          return metadata?.originalDataId ? this.toOriginalDataSummary(metadata) : null;
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
          const metadata = await readJsonFile<DatasetMetadata>(path.join(metadataRootPath, entry.name));

          return metadata?.datasetId ? this.readDatasetSummary(metadata.datasetId).catch(() => null) : null;
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

    const datasetRootPath = this.resolveDatasetRootPath(datasetId);
    const inspectableFiles = await this.collectInspectableFiles(datasetRootPath, metadata);
    const renderableCount = inspectableFiles.filter((entry) =>
      isRenderableExtension(path.extname(entry.relativePath))
    ).length;

    return {
      datasetId: metadata.datasetId,
      createdAt: metadata.createdAt,
      createdByBlockId: metadata.createdByBlockId,
      hasRenderableFiles: renderableCount > 0,
      kind: metadata.kind,
      renderableCount
    };
  }

  private async readPythonScriptSummaries(): Promise<IntegralScriptAssetSummary[]> {
    const scriptsRootPath = this.resolveWorkspacePath(PYTHON_SCRIPTS_DIRECTORY);
    const entries = await fs.readdir(scriptsRootPath, { withFileTypes: true });
    const scripts = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const manifest = await readJsonFile<PythonScriptManifest>(
            path.join(scriptsRootPath, entry.name, "script.json")
          );

          if (
            !manifest ||
            manifest.scriptId.trim().length === 0 ||
            manifest.entry.trim().length === 0 ||
            !(await pathExists(path.join(scriptsRootPath, entry.name, manifest.entry)))
          ) {
            return null;
          }

          return this.toScriptSummary(manifest);
        })
    );

    return scripts
      .filter((script): script is IntegralScriptAssetSummary => script !== null)
      .sort((left, right) => left.displayName.localeCompare(right.displayName, "ja"));
  }

  private async readRenderableFile(
    absolutePath: string,
    relativePath: string
  ): Promise<IntegralRenderableFile> {
    const extension = path.extname(relativePath).toLowerCase();

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

    return {
      data: await fs.readFile(absolutePath, "utf8"),
      kind: "text",
      name: path.basename(relativePath),
      relativePath
    };
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

  private toOriginalDataSummary(metadata: OriginalDataMetadata): IntegralOriginalDataSummary {
    return {
      aliasRelativePath: metadata.aliasRelativePath,
      dataNoteRelativePath: `${DATA_CATALOG_DIRECTORY}/${createOriginalDataNoteFileName(metadata.originalName, metadata.originalDataId)}`,
      originalDataId: metadata.originalDataId,
      createdAt: metadata.createdAt,
      originalName: metadata.originalName,
      storeRelativePath: metadata.storeRelativePath,
      sourceKind: metadata.sourceKind
    };
  }

  private resolveOriginalDataStorePath(metadata: OriginalDataMetadata): string {
    return this.resolveWorkspacePath(metadata.storeRelativePath);
  }

  private resolveOriginalDataAliasPath(metadata: OriginalDataMetadata): string {
    return this.resolveWorkspacePath(metadata.aliasRelativePath);
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

    if (
      [DATA_CATALOG_DIRECTORY, DATA_DIRECTORY, NOTES_DIRECTORY, PYTHON_SCRIPTS_DIRECTORY, STORE_DIRECTORY].includes(
        topLevelSegment
      )
    ) {
      throw new Error("system 管理ディレクトリ配下は元データ登録できません。");
    }
  }

  private async resolveOriginalDataAliasRelativePath(
    rootPath: string,
    sourceAbsolutePath: string,
    originalDataId: string,
    sourceKind: "directory" | "file"
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
      sourceKind
    )}`;
  }

  private async copyOriginalDataIntoStore(
    sourcePath: string,
    destinationPath: string,
    sourceKind: "directory" | "file"
  ): Promise<void> {
    if (sourceKind === "directory") {
      await fs.cp(sourcePath, destinationPath, { force: false, recursive: true });
      return;
    }

    await fs.copyFile(sourcePath, destinationPath);
  }

  private async createVisibleAlias(
    targetPath: string,
    aliasPath: string,
    sourceKind: "directory" | "file"
  ): Promise<void> {
    if (sourceKind === "directory") {
      await fs.symlink(targetPath, aliasPath, "junction");
      return;
    }

    await fs.link(targetPath, aliasPath);
  }

  private toScriptSummary(manifest: PythonScriptManifest): IntegralScriptAssetSummary {
    return {
      createdAt: manifest.createdAt,
      description: manifest.description,
      displayName: manifest.displayName,
      entry: manifest.entry,
      inputSlots: manifest.inputSlots,
      outputSlots: manifest.outputSlots,
      scriptId: manifest.scriptId
    };
  }
}

function buildBlockTypeCatalog(
  scripts: readonly IntegralScriptAssetSummary[],
  externalPlugins: readonly InstalledPluginDefinition[]
): IntegralBlockTypeDefinition[] {
  return [
    buildDisplayBlockType(),
    ...scripts.map((script) => buildPythonBlockType(script)),
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

function buildPythonBlockType(
  script: IntegralScriptAssetSummary
): IntegralBlockTypeDefinition {
  return {
    blockType: script.scriptId,
    description:
      script.description.trim().length > 0
        ? script.description
        : `${script.entry} を実行する Python block`,
    executionMode: "manual",
    inputSlots: script.inputSlots,
    outputSlots: script.outputSlots,
    pluginDescription: "workspace の .py-scripts を走査する汎用 Python 解析 plugin",
    pluginDisplayName: "General Analysis",
    pluginId: GENERAL_ANALYSIS_PLUGIN_ID,
    source: "python-script",
    title: script.displayName
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

async function collectAutoIncludedPythonFiles(entryAbsolutePath: string): Promise<string[]> {
  const entryDirectoryPath = path.dirname(entryAbsolutePath);
  const entries = await fs.readdir(entryDirectoryPath, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".py")
    .map((entry) => path.join(entryDirectoryPath, entry.name))
    .sort((left, right) => left.localeCompare(right, "ja"));
}

function normalizeSlotNames(slotNames: string[], label: string): string[] {
  const normalized = slotNames
    .map((slotName) => slotName.trim())
    .filter((slotName) => slotName.length > 0);

  if (normalized.some((slotName) => /[\\/]/u.test(slotName))) {
    throw new Error(`${label} に使用できない文字が含まれています。`);
  }

  const seen = new Set<string>();

  for (const slotName of normalized) {
    const lowered = slotName.toLowerCase();

    if (seen.has(lowered)) {
      throw new Error(`${label} が重複しています: ${slotName}`);
    }

    seen.add(lowered);
  }

  return normalized;
}

function createOpaqueId(prefix: "BLB" | "BLK" | "CNK" | "PYS"): string {
  return `${prefix}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function createOriginalDataStoreRelativePath(
  originalDataId: string,
  originalName: string,
  sourceKind: "directory" | "file"
): string {
  if (sourceKind === "directory") {
    return `${STORE_DIRECTORY}/${originalDataId}`;
  }

  const extension = path.extname(originalName.trim());
  return `${STORE_DIRECTORY}/${originalDataId}${extension}`;
}

function createDatasetStoreRelativePath(datasetId: string): string {
  return `${STORE_DIRECTORY}/${datasetId}`;
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
  sourceKind: "directory" | "file"
): string {
  const trimmedName = originalName.trim();

  if (sourceKind === "directory") {
    const baseName = trimmedName.length > 0 ? trimmedName : originalDataId;
    return `${baseName}_${originalDataId}`;
  }

  const extension = path.extname(trimmedName);
  const baseName = extension.length > 0 ? trimmedName.slice(0, -extension.length) : trimmedName;
  const normalizedBaseName = baseName.length > 0 ? baseName : originalDataId;
  return `${normalizedBaseName}_${originalDataId}${extension}`;
}

function createOriginalDataNoteFileName(originalName: string, originalDataId: string): string {
  const normalizedOriginalName = sanitizeFileNameSegment(originalName);
  return `${normalizedOriginalName}_${originalDataId}.md`;
}

function sanitizeFileNameSegment(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, "_")
    .replace(/[. ]+$/gu, "");

  return sanitized.length > 0 ? sanitized : "original-data";
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

function isRenderableExtension(extension: string): boolean {
  const normalized = extension.toLowerCase();
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

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}


