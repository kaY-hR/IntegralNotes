import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import type {
  CreateSourceChunkRequest,
  CreateSourceChunkResult,
  ExecuteIntegralBlockRequest,
  ExecuteIntegralBlockResult,
  ImportBlobsResult,
  IntegralAssetCatalog,
  IntegralBlobSummary,
  IntegralBlockDocument,
  IntegralBlockTypeDefinition,
  IntegralChunkInspection,
  IntegralChunkSummary,
  IntegralRenderableFile,
  IntegralScriptAssetSummary,
  IntegralSlotDefinition,
  PythonEntrySelection,
  RegisterPythonScriptRequest,
  RegisterPythonScriptResult
} from "../shared/integral";
import { WorkspaceService } from "./workspaceService";

const execFileAsync = promisify(execFile);

const ARTIFACTS_DIRECTORY = "Artifacts";
const BLOBS_DIRECTORY = "blob";
const CHUNKS_DIRECTORY = ".chunk";
const PYTHON_SCRIPTS_DIRECTORY = ".py-scripts";

const BUILTIN_DISPLAY_PLUGIN_ID = "core-display";
const GENERAL_ANALYSIS_PLUGIN_ID = "general-analysis";
const DISPLAY_BLOCK_TYPE = "chunk-view";

const HTML_EXTENSIONS = new Set([".html"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".svg"]);
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".json", ".csv"]);

interface BlobMetadata {
  blobId: string;
  createdAt: string;
  originalName: string;
  sourceKind: "directory" | "file";
}

interface ChunkMetadata {
  chunkId: string;
  createdAt: string;
  createdByBlockId: string | null;
  kind: string;
}

interface SourceChunkLinks {
  members: Array<{
    blobId: string;
    target: string;
  }>;
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
  constructor(private readonly workspaceService: WorkspaceService) {}

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

    const [blobs, chunks, scripts] = await Promise.all([
      this.readBlobSummaries(),
      this.readChunkSummaries(),
      this.readPythonScriptSummaries()
    ]);

    return {
      blobs,
      blockTypes: buildBlockTypeCatalog(scripts),
      chunks,
      scripts
    };
  }

  async importBlobPaths(sourcePaths: string[]): Promise<ImportBlobsResult> {
    await this.workspaceService.ensureWorkspaceReady();

    if (sourcePaths.length === 0) {
      throw new Error("blob として登録するファイルまたはフォルダを選択してください。");
    }

    const importedBlobs: IntegralBlobSummary[] = [];

    for (const sourcePath of sourcePaths) {
      const resolvedSourcePath = path.resolve(sourcePath);
      const sourceStats = await fs.stat(resolvedSourcePath);
      const blobId = createOpaqueId("BLB");
      const blobRootPath = this.resolveBlobRootPath(blobId);
      const payloadRootPath = path.join(blobRootPath, "payload");
      const metadata: BlobMetadata = {
        blobId,
        createdAt: new Date().toISOString(),
        originalName: path.basename(resolvedSourcePath),
        sourceKind: sourceStats.isDirectory() ? "directory" : "file"
      };

      await fs.mkdir(payloadRootPath, { recursive: true });

      if (sourceStats.isDirectory()) {
        await fs.cp(resolvedSourcePath, payloadRootPath, { force: true, recursive: true });
      } else {
        await fs.copyFile(resolvedSourcePath, path.join(payloadRootPath, path.basename(resolvedSourcePath)));
      }

      await this.writeBlobMetadata(blobId, metadata);
      await this.writeBlobArtifactNote(metadata);
      importedBlobs.push(this.toBlobSummary(metadata));
    }

    return {
      blobs: importedBlobs
    };
  }

  async createSourceChunk(request: CreateSourceChunkRequest): Promise<CreateSourceChunkResult> {
    await this.workspaceService.ensureWorkspaceReady();

    const blobIds = request.blobIds
      .map((blobId) => blobId.trim())
      .filter((blobId) => blobId.length > 0);

    if (blobIds.length === 0) {
      throw new Error("source chunk を作るには少なくとも 1 つの blob が必要です。");
    }

    const uniqueBlobIds = Array.from(new Set(blobIds));
    const chunkId = createOpaqueId("CNK");
    const chunkRootPath = this.resolveChunkRootPath(chunkId);
    const chunkMetadata: ChunkMetadata = {
      chunkId,
      createdAt: new Date().toISOString(),
      createdByBlockId: null,
      kind: "source-bundle"
    };
    const links: SourceChunkLinks = {
      members: []
    };

    await fs.mkdir(chunkRootPath, { recursive: true });

    for (const blobId of uniqueBlobIds) {
      const blobMetadata = await this.readBlobMetadata(blobId);

      if (blobMetadata === null) {
        throw new Error(`blob が見つかりません: ${blobId}`);
      }

      links.members.push({
        blobId,
        target: path
          .relative(chunkRootPath, path.join(this.resolveBlobRootPath(blobId), "payload"))
          .split(path.sep)
          .join("/")
      });
    }

    await this.writeChunkMetadata(chunkId, chunkMetadata);
    await fs.writeFile(path.join(chunkRootPath, "links.json"), JSON.stringify(links, null, 2), "utf8");

    return {
      chunk: await this.readChunkSummary(chunkId)
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

  async inspectChunk(chunkId: string): Promise<IntegralChunkInspection> {
    await this.workspaceService.ensureWorkspaceReady();

    const chunkMetadata = await this.readChunkMetadata(chunkId);

    if (chunkMetadata === null) {
      throw new Error(`chunk が見つかりません: ${chunkId}`);
    }

    const chunkRootPath = this.resolveChunkRootPath(chunkId);
    const inspectableFiles = await this.collectInspectableFiles(chunkRootPath, chunkMetadata);
    const relativeFilePaths = inspectableFiles.map((entry) => entry.relativePath);
    const renderables = await Promise.all(
      inspectableFiles
        .filter((entry) => isRenderableExtension(path.extname(entry.relativePath)))
        .map((entry) => this.readRenderableFile(entry.absolutePath, entry.relativePath))
    );

    return {
      chunkId: chunkMetadata.chunkId,
      createdAt: chunkMetadata.createdAt,
      createdByBlockId: chunkMetadata.createdByBlockId,
      fileNames: relativeFilePaths,
      hasRenderableFiles: renderables.length > 0,
      kind: chunkMetadata.kind,
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
        createdChunks: [],
        finishedAt: now,
        logLines: [],
        startedAt: now,
        status: "success",
        summary: "表示 block は実行不要です。"
      };
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

  private resolveBlobRootPath(blobId: string): string {
    return this.resolveWorkspacePath(`${BLOBS_DIRECTORY}/${blobId}`);
  }

  private resolveChunkRootPath(chunkId: string): string {
    return this.resolveWorkspacePath(`${CHUNKS_DIRECTORY}/${chunkId}`);
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
      const chunkId = block.inputs[inputSlot.name];

      if (!chunkId) {
        throw new Error(`input slot が未設定です: ${inputSlot.name}`);
      }

      if ((await this.readChunkMetadata(chunkId)) === null) {
        throw new Error(`input chunk が見つかりません: ${chunkId}`);
      }
    }

    const script = scripts.find((candidate) => candidate.scriptId === definition.blockType);

    if (!script) {
      throw new Error(`Python script 資産が見つかりません: ${definition.blockType}`);
    }

    const scriptRootPath = this.resolvePythonScriptRootPath(script.scriptId);
    const outputChunkMap = new Map<string, IntegralChunkSummary>();
    const outputPaths: Record<string, string | null> = {};

    for (const outputSlot of definition.outputSlots) {
      const nextChunkId = createOpaqueId("CNK");
      const metadata: ChunkMetadata = {
        chunkId: nextChunkId,
        createdAt: new Date().toISOString(),
        createdByBlockId: block.id ?? null,
        kind: outputSlot.producedKind?.trim() || `${block["block-type"]}.${outputSlot.name}`
      };

      await fs.mkdir(this.resolveChunkRootPath(nextChunkId), { recursive: true });
      await this.writeChunkMetadata(nextChunkId, metadata);

      const chunkSummary = await this.readChunkSummary(nextChunkId);
      outputChunkMap.set(outputSlot.name, chunkSummary);
      outputPaths[outputSlot.name] = this.resolveChunkRootPath(nextChunkId);
    }

    const inputPaths = Object.fromEntries(
      definition.inputSlots.map((slot) => {
        const chunkId = block.inputs[slot.name];
        return [slot.name, chunkId ? this.resolveChunkRootPath(chunkId) : null];
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
    const createdChunks = definition.outputSlots
      .map((slot) => outputChunkMap.get(slot.name))
      .filter((chunk): chunk is IntegralChunkSummary => chunk !== undefined);
    const nextOutputs = { ...block.outputs };

    for (const outputSlot of definition.outputSlots) {
      nextOutputs[outputSlot.name] = outputChunkMap.get(outputSlot.name)?.chunkId ?? null;
    }

    return {
      block: {
        ...block,
        outputs: nextOutputs
      },
      createdChunks,
      finishedAt,
      logLines: [...splitLogLines(stdout), ...splitLogLines(stderr)],
      startedAt,
      status: "success",
      summary: `${script.displayName} を実行しました。`
    };
  }

  private async writeBlobMetadata(blobId: string, metadata: BlobMetadata): Promise<void> {
    await fs.mkdir(this.resolveBlobRootPath(blobId), { recursive: true });
    await fs.writeFile(
      path.join(this.resolveBlobRootPath(blobId), "blob.json"),
      JSON.stringify(metadata, null, 2),
      "utf8"
    );
  }

  private async writeChunkMetadata(chunkId: string, metadata: ChunkMetadata): Promise<void> {
    await fs.mkdir(this.resolveChunkRootPath(chunkId), { recursive: true });
    await fs.writeFile(
      path.join(this.resolveChunkRootPath(chunkId), "chunk.json"),
      JSON.stringify(metadata, null, 2),
      "utf8"
    );
  }

  private async writeBlobArtifactNote(metadata: BlobMetadata): Promise<void> {
    const artifactPath = this.resolveWorkspacePath(`${ARTIFACTS_DIRECTORY}/${metadata.blobId}.md`);
    const payloadRelativePath = path
      .relative(path.dirname(artifactPath), path.join(this.resolveBlobRootPath(metadata.blobId), "payload"))
      .split(path.sep)
      .join("/");
    const lines = [
      `# ${metadata.originalName}_${metadata.blobId}`,
      "",
      `- Original Name: ${metadata.originalName}`,
      `- Blob ID: ${metadata.blobId}`,
      `- Source Kind: ${metadata.sourceKind}`,
      `- Created At: ${metadata.createdAt}`,
      `- Payload: \`${payloadRelativePath}\``
    ];

    await fs.writeFile(artifactPath, `${lines.join("\n")}\n`, "utf8");
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

  private async readBlobMetadata(blobId: string): Promise<BlobMetadata | null> {
    return readJsonFile<BlobMetadata>(path.join(this.resolveBlobRootPath(blobId), "blob.json"));
  }

  private async readChunkMetadata(chunkId: string): Promise<ChunkMetadata | null> {
    return readJsonFile<ChunkMetadata>(path.join(this.resolveChunkRootPath(chunkId), "chunk.json"));
  }

  private async readBlobSummaries(): Promise<IntegralBlobSummary[]> {
    const blobsRootPath = this.resolveWorkspacePath(BLOBS_DIRECTORY);
    const entries = await fs.readdir(blobsRootPath, { withFileTypes: true });
    const summaries = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const metadata = await readJsonFile<BlobMetadata>(
            path.join(blobsRootPath, entry.name, "blob.json")
          );

          return metadata ? this.toBlobSummary(metadata) : null;
        })
    );

    return summaries
      .filter((summary): summary is IntegralBlobSummary => summary !== null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  private async readChunkSummaries(): Promise<IntegralChunkSummary[]> {
    const chunksRootPath = this.resolveWorkspacePath(CHUNKS_DIRECTORY);
    const entries = await fs.readdir(chunksRootPath, { withFileTypes: true });
    const summaries = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => this.readChunkSummary(entry.name).catch(() => null))
    );

    return summaries
      .filter((summary): summary is IntegralChunkSummary => summary !== null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  private async readChunkSummary(chunkId: string): Promise<IntegralChunkSummary> {
    const metadata = await this.readChunkMetadata(chunkId);

    if (metadata === null) {
      throw new Error(`chunk が見つかりません: ${chunkId}`);
    }

    const chunkRootPath = this.resolveChunkRootPath(chunkId);
    const inspectableFiles = await this.collectInspectableFiles(chunkRootPath, metadata);
    const renderableCount = inspectableFiles.filter((entry) =>
      isRenderableExtension(path.extname(entry.relativePath))
    ).length;

    return {
      chunkId: metadata.chunkId,
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
    chunkRootPath: string,
    metadata: ChunkMetadata
  ): Promise<InspectableFileEntry[]> {
    if (metadata.kind !== "source-bundle") {
      const relativeFilePaths = (await collectRelativeFiles(chunkRootPath)).filter(
        (relativePath) => relativePath !== "chunk.json" && relativePath !== "links.json"
      );

      return relativeFilePaths.map((relativePath) => ({
        absolutePath: path.join(chunkRootPath, relativePath),
        relativePath
      }));
    }

    const links = await readJsonFile<SourceChunkLinks>(path.join(chunkRootPath, "links.json"));

    if (!links) {
      return [];
    }

    const inspectableFiles: InspectableFileEntry[] = [];

    for (const member of links.members) {
      const payloadRootPath = this.resolveSourceBundleTargetPath(chunkRootPath, member.target);

      if (!(await pathExists(payloadRootPath))) {
        continue;
      }

      const blobMetadata = await this.readBlobMetadata(member.blobId);
      const memberLabel = blobMetadata?.originalName?.trim() || member.blobId;
      const memberFiles = await collectRelativeFiles(payloadRootPath);

      for (const relativePath of memberFiles) {
        inspectableFiles.push({
          absolutePath: path.join(payloadRootPath, relativePath),
          relativePath: toInspectableSourcePath(memberLabel, relativePath)
        });
      }
    }

    return inspectableFiles.sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath, "ja")
    );
  }

  private resolveSourceBundleTargetPath(chunkRootPath: string, target: string): string {
    const absolutePath = path.resolve(chunkRootPath, target);
    const rootPath = this.getRootPath();
    const normalizedRelative = path.relative(rootPath, absolutePath);

    if (normalizedRelative.startsWith("..") || path.isAbsolute(normalizedRelative)) {
      throw new Error("source chunk links.json がワークスペース外を指しています。");
    }

    return absolutePath;
  }

  private toBlobSummary(metadata: BlobMetadata): IntegralBlobSummary {
    return {
      artifactRelativePath: `${ARTIFACTS_DIRECTORY}/${metadata.blobId}.md`,
      blobId: metadata.blobId,
      createdAt: metadata.createdAt,
      originalName: metadata.originalName,
      payloadRelativePath: `${BLOBS_DIRECTORY}/${metadata.blobId}/payload`,
      sourceKind: metadata.sourceKind
    };
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
  scripts: readonly IntegralScriptAssetSummary[]
): IntegralBlockTypeDefinition[] {
  return [buildDisplayBlockType(), ...scripts.map((script) => buildPythonBlockType(script))];
}

function toInspectableSourcePath(memberLabel: string, relativePath: string): string {
  const normalizedRelativePath = relativePath.split(path.sep).join("/");

  if (normalizedRelativePath === memberLabel) {
    return memberLabel;
  }

  if (normalizedRelativePath.startsWith(`${memberLabel}/`)) {
    return normalizedRelativePath;
  }

  return `${memberLabel}/${normalizedRelativePath}`;
}

function buildDisplayBlockType(): IntegralBlockTypeDefinition {
  return {
    blockType: DISPLAY_BLOCK_TYPE,
    description: "chunk 内の html / image / text を自動検出して標準表示します。",
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
    title: "Chunk Viewer"
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
