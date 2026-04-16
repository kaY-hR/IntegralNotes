import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  findInstalledPluginViewerByExtension,
  type InstalledPluginDefinition,
  type PluginViewerDataEncoding,
  type ResolvedPluginViewer
} from "../shared/plugins";
import {
  CopyEntriesRequest,
  CopyEntriesResult,
  CopyExternalEntriesRequest,
  CreateEntryRequest,
  CreateEntryResult,
  DeleteEntriesRequest,
  DeleteEntriesResult,
  DeleteEntryRequest,
  DeleteEntryResult,
  MoveEntriesRequest,
  MoveEntriesResult,
  NoteDocument,
  RenameEntryRequest,
  RenameEntryResult,
  SaveClipboardImageRequest,
  SaveClipboardImageResult,
  SaveNoteImageRequest,
  SaveNoteImageResult,
  WorkspaceEntry,
  WorkspaceReplaceFileResult,
  WorkspaceReplaceRequest,
  WorkspaceReplaceResult,
  WorkspaceSearchFileResult,
  WorkspaceSearchMatch,
  WorkspaceSearchRequest,
  WorkspaceSearchResult,
  WorkspaceEntryKind,
  WorkspaceFileDocument,
  WorkspaceSnapshot
} from "../shared/workspace";
import {
  toCanonicalWorkspaceTarget,
  type WorkspacePathChange,
  rewriteWorkspaceMarkdownReferences
} from "../shared/workspaceLinks";
import {
  buildDatasetDataNoteMarkdown,
  buildOriginalDataNoteMarkdown,
  normalizeDatasetDataNoteMetadata,
  normalizeOriginalDataNoteMetadata,
  resolveManagedDataNoteTabName
} from "./dataNote";
import {
  extractFrontmatterBody,
  hasFrontmatterBlock,
  replaceFrontmatterBody,
  serializeFrontmatterDocument,
  splitFrontmatterBlock
} from "./frontmatter";
import { type PluginRegistry } from "./pluginRegistry";

interface WorkspaceServiceOptions {
  initialRootPath?: string;
  stateFilePath: string;
}

interface PersistedWorkspaceState {
  rootPath?: string;
}

const DATA_DIRECTORY = "Data";
const STORE_DIRECTORY = ".store";
const STORE_METADATA_DIRECTORY = ".integral";
const DATA_NOTE_DIRECTORY = "data-notes";
const HTML_EXTENSIONS = new Set([".htm", ".html"]);
const IMAGE_EXTENSIONS = new Set([".bmp", ".gif", ".jpg", ".jpeg", ".png", ".svg", ".webp"]);
const TEXT_EXTENSIONS = new Set([
  ".bat",
  ".c",
  ".csv",
  ".css",
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
  ".txt",
  ".ts",
  ".tsx",
  ".tsv",
  ".xml",
  ".yaml",
  ".yml"
]);
const SEARCH_EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "out"
]);
const DEFAULT_WORKSPACE_SEARCH_MAX_RESULTS = 400;

interface ManagedDataNoteWritePlan {
  absolutePath: string;
  nextContent: string;
}

export type WorkspaceMutationKind = "create" | "delete" | "modify" | "move";

export interface WorkspaceMutation {
  kind: WorkspaceMutationKind;
  nextPath?: string;
  path: string;
  targetKind: WorkspaceEntryKind;
}

export type WorkspaceMutationListener = (
  mutations: readonly WorkspaceMutation[]
) => Promise<void> | void;

export class WorkspaceService {
  private rootPath: string | undefined;
  private readonly initialRootPath: string | undefined;
  private readonly mutationListeners = new Set<WorkspaceMutationListener>();
  private pluginRegistry: PluginRegistry | null = null;
  private readonly stateFilePath: string;

  constructor(options: WorkspaceServiceOptions) {
    this.initialRootPath = options.initialRootPath ? path.resolve(options.initialRootPath) : undefined;
    this.rootPath = this.initialRootPath;
    this.stateFilePath = options.stateFilePath;
  }

  get currentRootPath(): string | undefined {
    return this.rootPath;
  }

  setPluginRegistry(pluginRegistry: PluginRegistry): void {
    this.pluginRegistry = pluginRegistry;
  }

  async initialize(): Promise<void> {
    const persistedRootPath = await this.readPersistedRootPath();

    if (persistedRootPath) {
      this.rootPath = persistedRootPath;
    } else {
      this.rootPath = this.initialRootPath;
    }

    if (this.rootPath) {
      await this.ensureWorkspaceReady();
    }
  }

  async setRootPath(nextRootPath: string): Promise<WorkspaceSnapshot> {
    this.rootPath = path.resolve(nextRootPath);
    await this.ensureWorkspaceReady();
    await this.persistState();

    const snapshot = await this.getSnapshot();

    if (!snapshot) {
      throw new Error("ワークスペースフォルダが未設定です。");
    }

    return snapshot;
  }

  async ensureWorkspaceReady(): Promise<void> {
    const rootPath = this.getConfiguredRootPath();

    await fs.mkdir(rootPath, { recursive: true });
    await Promise.all([
      fs.mkdir(path.join(rootPath, STORE_DIRECTORY, STORE_METADATA_DIRECTORY, DATA_NOTE_DIRECTORY), {
        recursive: true
      }),
      fs.mkdir(path.join(rootPath, STORE_DIRECTORY, STORE_METADATA_DIRECTORY), { recursive: true })
    ]);
    await this.syncManagedDataNotesInternal(rootPath);
  }

  async syncManagedDataNotes(): Promise<void> {
    await this.syncManagedDataNotesInternal(this.getConfiguredRootPath());
  }

  addMutationListener(listener: WorkspaceMutationListener): () => void {
    this.mutationListeners.add(listener);

    return () => {
      this.mutationListeners.delete(listener);
    };
  }

  async getSnapshot(): Promise<WorkspaceSnapshot | null> {
    const rootPath = this.rootPath;

    if (!rootPath) {
      return null;
    }

    await this.ensureWorkspaceReady();

    return {
      rootName: path.basename(rootPath) || rootPath,
      rootPath,
      entries: await this.readDirectoryEntries("")
    };
  }

  async readWorkspaceFile(relativePath: string): Promise<WorkspaceFileDocument> {
    this.getConfiguredRootPath();
    await this.ensureWorkspaceReady();

    const absolutePath = this.resolveWorkspacePath(relativePath);
    const stats = await fs.stat(absolutePath);

    if (!stats.isFile()) {
      throw new Error("ファイルのみ開けます。");
    }

    return this.readWorkspaceFileDocument(absolutePath, stats);
  }

  async readNote(relativePath: string): Promise<NoteDocument> {
    const document = await this.readWorkspaceFile(relativePath);

    if (document.kind !== "markdown" || document.content === null) {
      throw new Error("Markdownノートのみ開けます。");
    }

    return {
      content: document.content,
      kind: "markdown",
      modifiedAt: document.modifiedAt,
      name: document.name,
      relativePath: document.relativePath
    };
  }

  async saveNote(relativePath: string, content: string): Promise<NoteDocument> {
    this.getConfiguredRootPath();
    await this.ensureWorkspaceReady();

    const absolutePath = this.resolveWorkspacePath(relativePath);
    const stats = await fs.stat(absolutePath);

    if (!stats.isFile() || path.extname(absolutePath).toLowerCase() !== ".md") {
      throw new Error("Markdownノートのみ保存できます。");
    }

    const existingContent = await fs.readFile(absolutePath, "utf8");
    const nextContent = hasFrontmatterBlock(existingContent)
      ? replaceFrontmatterBody(existingContent, content)
      : content;

    if (existingContent !== nextContent) {
      await fs.writeFile(absolutePath, nextContent, "utf8");
      await this.emitWorkspaceMutations([
        {
          kind: "modify",
          path: relativePath,
          targetKind: "file"
        }
      ]);
    }

    return this.readNote(relativePath);
  }

  async searchWorkspaceText(request: WorkspaceSearchRequest): Promise<WorkspaceSearchResult> {
    const rootPath = this.getConfiguredRootPath();
    await this.ensureWorkspaceReady();

    const normalizedRequest = normalizeWorkspaceSearchRequest(request);

    if (normalizedRequest.query.length === 0) {
      return {
        files: [],
        searchedFileCount: 0,
        totalMatchCount: 0,
        truncated: false
      };
    }

    const candidateRelativePaths = await collectSearchCandidateRelativePaths(rootPath);
    const searchExpression = createWorkspaceSearchRegExp(normalizedRequest);
    const files: WorkspaceSearchFileResult[] = [];
    let searchedFileCount = 0;
    let totalMatchCount = 0;
    let truncated = false;

    for (const relativePath of candidateRelativePaths) {
      if (!shouldSearchWorkspaceFile(relativePath, normalizedRequest)) {
        continue;
      }

      const content = await readSearchableTextFile(this.resolveWorkspacePath(relativePath));

      if (content === null) {
        continue;
      }

      searchedFileCount += 1;

      const remainingCount = normalizedRequest.maxResults - totalMatchCount;

      if (remainingCount <= 0) {
        truncated = true;
        break;
      }

      const fileResult = collectWorkspaceSearchFileResult(content, searchExpression, relativePath, remainingCount);

      if (!fileResult) {
        continue;
      }

      files.push(fileResult.file);
      totalMatchCount += fileResult.file.matchCount;

      if (fileResult.truncated) {
        truncated = true;
        break;
      }
    }

    return {
      files,
      searchedFileCount,
      totalMatchCount,
      truncated
    };
  }

  async replaceWorkspaceText(request: WorkspaceReplaceRequest): Promise<WorkspaceReplaceResult> {
    const rootPath = this.getConfiguredRootPath();
    await this.ensureWorkspaceReady();

    const normalizedRequest = normalizeWorkspaceReplaceRequest(request);

    if (normalizedRequest.query.length === 0) {
      const snapshot = await this.getSnapshot();

      if (!snapshot) {
        throw new Error("ワークスペースフォルダが未設定です。");
      }

      return {
        files: [],
        replacedFileCount: 0,
        replacedMatchCount: 0,
        snapshot
      };
    }

    const candidateRelativePaths = await collectSearchCandidateRelativePaths(rootPath);
    const modifiedFiles: WorkspaceReplaceFileResult[] = [];
    const mutations: WorkspaceMutation[] = [];
    let replacedMatchCount = 0;

    for (const relativePath of candidateRelativePaths) {
      if (!shouldSearchWorkspaceFile(relativePath, normalizedRequest)) {
        continue;
      }

      const absolutePath = this.resolveWorkspacePath(relativePath);
      const content = await readSearchableTextFile(absolutePath);

      if (content === null) {
        continue;
      }

      const replacementPlan = createWorkspaceReplacement(content, normalizedRequest);

      if (replacementPlan === null) {
        continue;
      }

      await fs.writeFile(absolutePath, replacementPlan.content, "utf8");
      modifiedFiles.push({
        relativePath,
        replacedCount: replacementPlan.replacedCount
      });
      mutations.push({
        kind: "modify",
        path: relativePath,
        targetKind: "file"
      });
      replacedMatchCount += replacementPlan.replacedCount;
    }

    await this.emitWorkspaceMutations(mutations);

    const snapshot = await this.getSnapshot();

    if (!snapshot) {
      throw new Error("ワークスペースフォルダが未設定です。");
    }

    return {
      files: modifiedFiles,
      replacedFileCount: modifiedFiles.length,
      replacedMatchCount,
      snapshot
    };
  }

  async createEntry(request: CreateEntryRequest): Promise<CreateEntryResult> {
    this.getConfiguredRootPath();
    await this.ensureWorkspaceReady();

    const parentPath = this.resolveWorkspacePath(request.parentPath);
    const parentStats = await fs.stat(parentPath);

    if (!parentStats.isDirectory()) {
      throw new Error("作成先はフォルダである必要があります。");
    }

    const nextName = this.normalizeEntryName(request.name, request.kind, {
      defaultMarkdownExtension: request.kind === "file",
      requireMarkdownExtension: request.kind === "file"
    });
    const absolutePath = path.join(parentPath, nextName);

    if (request.kind === "directory") {
      await fs.mkdir(absolutePath);
    } else {
      await fs.writeFile(absolutePath, `# ${path.basename(nextName, ".md")}\n`, "utf8");
    }

    await this.emitWorkspaceMutations([
      {
        kind: "create",
        path: this.toRelativePath(absolutePath),
        targetKind: request.kind
      }
    ]);

    const snapshot = await this.getRequiredSnapshot();

    return {
      snapshot,
      entry: await this.getEntryByPath(this.toRelativePath(absolutePath))
    };
  }

  async renameEntry(request: RenameEntryRequest): Promise<RenameEntryResult> {
    this.getConfiguredRootPath();
    await this.ensureWorkspaceReady();

    const sourcePath = this.resolveWorkspacePath(request.targetPath);
    const stats = await fs.stat(sourcePath);
    const kind: WorkspaceEntryKind = stats.isDirectory() ? "directory" : "file";
    const nextName = this.normalizeEntryName(request.nextName, kind);
    const destinationPath = path.join(path.dirname(sourcePath), nextName);

    if (destinationPath === sourcePath) {
      const snapshot = await this.getRequiredSnapshot();

      return {
        snapshot,
        entry: await this.getEntryByPath(this.toRelativePath(destinationPath)),
        previousRelativePath: request.targetPath
      };
    }

    await fs.rename(sourcePath, destinationPath);
    const nextRelativePath = this.toRelativePath(destinationPath);
    await this.rewriteMarkdownReferences([
      {
        nextPath: nextRelativePath,
        previousPath: request.targetPath
      }
    ]);
    await this.emitWorkspaceMutations([
      {
        kind: "move",
        nextPath: nextRelativePath,
        path: request.targetPath,
        targetKind: kind
      }
    ]);

    const snapshot = await this.getRequiredSnapshot();

    return {
      snapshot,
      entry: await this.getEntryByPath(nextRelativePath),
      previousRelativePath: request.targetPath
    };
  }

  async deleteEntry(request: DeleteEntryRequest): Promise<DeleteEntryResult> {
    this.getConfiguredRootPath();
    await this.ensureWorkspaceReady();

    const absolutePath = this.resolveWorkspacePath(request.targetPath);
    const stats = await fs.stat(absolutePath);
    const kind: WorkspaceEntryKind = stats.isDirectory() ? "directory" : "file";

    await fs.rm(absolutePath, { recursive: true, force: false });
    await this.emitWorkspaceMutations([
      {
        kind: "delete",
        path: request.targetPath,
        targetKind: kind
      }
    ]);

    const snapshot = await this.getRequiredSnapshot();

    return {
      snapshot,
      deletedRelativePath: request.targetPath,
      deletedKind: kind
    };
  }

  async deleteEntries(request: DeleteEntriesRequest): Promise<DeleteEntriesResult> {
    this.getConfiguredRootPath();
    await this.ensureWorkspaceReady();

    const targetPaths = collapseNestedRelativePaths(request.targetPaths);

    if (targetPaths.length === 0) {
      throw new Error("削除対象を選択してください。");
    }

    const deletionMutations = await Promise.all(
      targetPaths.map(async (targetPath) => {
        const stats = await fs.stat(this.resolveWorkspacePath(targetPath));
        const targetKind: WorkspaceEntryKind = stats.isDirectory() ? "directory" : "file";

        return {
          kind: "delete" as const,
          path: targetPath,
          targetKind
        };
      })
    );

    for (const targetPath of targetPaths) {
      await fs.rm(this.resolveWorkspacePath(targetPath), { recursive: true, force: false });
    }
    await this.emitWorkspaceMutations(deletionMutations);

    return {
      snapshot: await this.getRequiredSnapshot(),
      deletedRelativePaths: targetPaths
    };
  }

  async copyEntries(request: CopyEntriesRequest): Promise<CopyEntriesResult> {
    this.getConfiguredRootPath();
    await this.ensureWorkspaceReady();

    const destinationDirectoryPath = await this.ensureDirectoryPath(request.destinationDirectoryPath);
    const sourcePaths = collapseNestedRelativePaths(request.sourcePaths);

    if (sourcePaths.length === 0) {
      throw new Error("コピー対象を選択してください。");
    }

    const createdEntries: WorkspaceEntry[] = [];

    for (const sourcePath of sourcePaths) {
      createdEntries.push(
        await this.copyEntryIntoWorkspace(this.resolveWorkspacePath(sourcePath), destinationDirectoryPath)
      );
    }

    await this.emitWorkspaceMutations(
      createdEntries.map((entry) => ({
        kind: "create" as const,
        path: entry.relativePath,
        targetKind: entry.kind
      }))
    );

    return {
      createdEntries,
      snapshot: await this.getRequiredSnapshot()
    };
  }

  async moveEntries(request: MoveEntriesRequest): Promise<MoveEntriesResult> {
    this.getConfiguredRootPath();
    await this.ensureWorkspaceReady();

    const destinationDirectoryPath = await this.ensureDirectoryPath(request.destinationDirectoryPath);
    const sourcePaths = collapseNestedRelativePaths(request.sourcePaths);

    if (sourcePaths.length === 0) {
      throw new Error("移動対象を選択してください。");
    }

    const movedEntries: WorkspaceEntry[] = [];
    const previousRelativePaths: string[] = [];

    for (const sourcePath of sourcePaths) {
      const movedEntry = await this.moveEntryIntoWorkspace(sourcePath, destinationDirectoryPath);

      if (!movedEntry) {
        continue;
      }

      previousRelativePaths.push(sourcePath);
      movedEntries.push(movedEntry);
    }

    await this.rewriteMarkdownReferences(
      previousRelativePaths.map((previousPath, index) => ({
        nextPath: movedEntries[index]?.relativePath ?? previousPath,
        previousPath
      }))
    );
    await this.emitWorkspaceMutations(
      movedEntries.map((entry, index) => ({
        kind: "move" as const,
        nextPath: entry.relativePath,
        path: previousRelativePaths[index] ?? entry.relativePath,
        targetKind: entry.kind
      }))
    );

    return {
      movedEntries,
      previousRelativePaths,
      snapshot: await this.getRequiredSnapshot()
    };
  }

  async copyExternalEntries(request: CopyExternalEntriesRequest): Promise<CopyEntriesResult> {
    this.getConfiguredRootPath();
    await this.ensureWorkspaceReady();

    const destinationDirectoryPath = await this.ensureDirectoryPath(request.destinationDirectoryPath);
    const sourceAbsolutePaths = normalizeAbsolutePaths(request.sourceAbsolutePaths);

    if (sourceAbsolutePaths.length === 0) {
      throw new Error("コピー対象を選択してください。");
    }

    const createdEntries: WorkspaceEntry[] = [];

    for (const sourceAbsolutePath of sourceAbsolutePaths) {
      createdEntries.push(await this.copyEntryIntoWorkspace(sourceAbsolutePath, destinationDirectoryPath));
    }

    await this.emitWorkspaceMutations(
      createdEntries.map((entry) => ({
        kind: "create" as const,
        path: entry.relativePath,
        targetKind: entry.kind
      }))
    );

    return {
      createdEntries,
      snapshot: await this.getRequiredSnapshot()
    };
  }

  async savePngImage(
    request: SaveClipboardImageRequest,
    content: Buffer
  ): Promise<SaveClipboardImageResult> {
    this.getConfiguredRootPath();
    await this.ensureWorkspaceReady();

    const destinationDirectoryPath = await this.ensureDirectoryPath(request.targetDirectoryPath);
    const entry = await this.writeBinaryFile(destinationDirectoryPath, "image.png", content);
    await this.emitWorkspaceMutations([
      {
        kind: "create",
        path: entry.relativePath,
        targetKind: entry.kind
      }
    ]);

    return {
      entry,
      snapshot: await this.getRequiredSnapshot()
    };
  }

  async saveNoteImage(
    request: SaveNoteImageRequest,
    content: Buffer
  ): Promise<SaveNoteImageResult> {
    this.getConfiguredRootPath();
    await this.ensureWorkspaceReady();

    const destinationDirectoryPath = this.resolveWorkspacePath(DATA_DIRECTORY);
    await fs.mkdir(destinationDirectoryPath, { recursive: true });

    const preferredFileName = createNoteImageFileName(
      request.originalFileName,
      request.contentType
    );
    const destinationPath = await createTimestampedImagePath(
      destinationDirectoryPath,
      preferredFileName
    );

    await fs.writeFile(destinationPath, content);

    const entry = await this.getEntryByPath(this.toRelativePath(destinationPath));
    await this.emitWorkspaceMutations([
      {
        kind: "create",
        path: entry.relativePath,
        targetKind: entry.kind
      }
    ]);

    return {
      entry,
      markdownTarget: toCanonicalWorkspaceTarget(entry.relativePath),
      snapshot: await this.getRequiredSnapshot()
    };
  }

  getAbsolutePath(relativePath: string): string {
    return this.resolveWorkspacePath(relativePath);
  }

  async resolveWorkspaceFileUrl(relativePath: string): Promise<string> {
    const absolutePath = this.resolveWorkspacePath(relativePath);
    const content = await fs.readFile(absolutePath);
    return `data:${inferMimeType(absolutePath)};base64,${content.toString("base64")}`;
  }

  private async ensureDirectoryPath(relativePath: string): Promise<string> {
    const absolutePath = this.resolveWorkspacePath(relativePath);
    const stats = await fs.stat(absolutePath);

    if (!stats.isDirectory()) {
      throw new Error("貼り付け先はフォルダである必要があります。");
    }

    return absolutePath;
  }

  private async copyEntryIntoWorkspace(
    sourceAbsolutePath: string,
    destinationDirectoryPath: string
  ): Promise<WorkspaceEntry> {
    const resolvedSourcePath = path.resolve(sourceAbsolutePath);
    const sourceStats = await fs.stat(resolvedSourcePath);
    const sourceKind: WorkspaceEntryKind = sourceStats.isDirectory() ? "directory" : "file";

    assertDestinationIsOutsideSource(resolvedSourcePath, destinationDirectoryPath, sourceKind, "copy");

    const destinationPath = await createCopyDestinationPath(
      destinationDirectoryPath,
      path.basename(resolvedSourcePath),
      sourceKind
    );

    if (sourceKind === "directory") {
      await fs.cp(resolvedSourcePath, destinationPath, { force: false, recursive: true });
    } else {
      await fs.copyFile(resolvedSourcePath, destinationPath);
    }

    return this.getEntryByPath(this.toRelativePath(destinationPath));
  }

  private async moveEntryIntoWorkspace(
    sourceRelativePath: string,
    destinationDirectoryPath: string
  ): Promise<WorkspaceEntry | null> {
    const sourcePath = this.resolveWorkspacePath(sourceRelativePath);
    const sourceStats = await fs.stat(sourcePath);
    const sourceKind: WorkspaceEntryKind = sourceStats.isDirectory() ? "directory" : "file";

    assertDestinationIsOutsideSource(sourcePath, destinationDirectoryPath, sourceKind, "move");

    const destinationPath = path.join(destinationDirectoryPath, path.basename(sourcePath));

    if (isSamePath(sourcePath, destinationPath)) {
      return null;
    }

    if (await pathExists(destinationPath)) {
      throw new Error(`${path.basename(destinationPath)} は既に存在します。`);
    }

    await fs.rename(sourcePath, destinationPath);

    return this.getEntryByPath(this.toRelativePath(destinationPath));
  }

  private async writeBinaryFile(
    destinationDirectoryPath: string,
    preferredFileName: string,
    content: Buffer
  ): Promise<WorkspaceEntry> {
    const destinationPath = await createAvailableImagePath(destinationDirectoryPath, preferredFileName);

    await fs.writeFile(destinationPath, content);

    return this.getEntryByPath(this.toRelativePath(destinationPath));
  }

  private async getEntryByPath(relativePath: string): Promise<WorkspaceEntry> {
    const absolutePath = this.resolveWorkspacePath(relativePath);
    const stats = await fs.stat(absolutePath);

    return this.buildEntry(absolutePath, relativePath, stats);
  }

  private async readDirectoryEntries(relativePath: string): Promise<WorkspaceEntry[]> {
    const absolutePath = this.resolveWorkspacePath(relativePath);
    const directoryEntries = await fs.readdir(absolutePath, { withFileTypes: true });

    const supportedEntries = directoryEntries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }

      return left.name.localeCompare(right.name, "ja");
    });

    const entries = await Promise.all(
      supportedEntries.map(async (entry) => {
        const entryAbsolutePath = path.join(absolutePath, entry.name);
        const entryRelativePath = this.combineRelativePath(relativePath, entry.name);
        const stats = await fs.stat(entryAbsolutePath);

        return this.buildEntry(entryAbsolutePath, entryRelativePath, stats);
      })
    );

    return entries;
  }

  private async buildEntry(
    absolutePath: string,
    relativePath: string,
    stats: Awaited<ReturnType<typeof fs.stat>>
  ): Promise<WorkspaceEntry> {
    if (stats.isDirectory()) {
      return {
        name: path.basename(absolutePath),
        relativePath,
        kind: "directory",
        modifiedAt: stats.mtime.toISOString(),
        children: await this.readDirectoryEntries(relativePath)
      };
    }

    return {
      name: path.basename(absolutePath),
      relativePath,
      kind: "file",
      modifiedAt: stats.mtime.toISOString()
    };
  }

  private async readWorkspaceFileDocument(
    absolutePath: string,
    stats: Awaited<ReturnType<typeof fs.stat>>
  ): Promise<WorkspaceFileDocument> {
    const relativePath = this.toRelativePath(absolutePath);
    const extension = path.extname(absolutePath).toLowerCase();

    if (extension === ".md") {
      const markdownContent = await fs.readFile(absolutePath, "utf8");
      const managedDataNoteTabName = resolveManagedDataNoteTabName(markdownContent);

      return {
        content: extractFrontmatterBody(markdownContent),
        kind: "markdown",
        modifiedAt: stats.mtime.toISOString(),
        name: managedDataNoteTabName ?? path.basename(absolutePath),
        relativePath
      };
    }

    const pluginViewer = await this.resolvePluginViewer(extension);

    if (pluginViewer) {
      const payload = await readPluginViewerPayload(absolutePath, extension);

      return {
        content: payload.data,
        kind: "plugin",
        modifiedAt: stats.mtime.toISOString(),
        name: path.basename(absolutePath),
        pluginViewer: buildResolvedPluginViewer(pluginViewer.plugin, pluginViewer.viewer, payload),
        relativePath
      };
    }

    if (HTML_EXTENSIONS.has(extension)) {
      return {
        content: injectHtmlBaseTag(await fs.readFile(absolutePath, "utf8"), path.dirname(absolutePath)),
        kind: "html",
        modifiedAt: stats.mtime.toISOString(),
        name: path.basename(absolutePath),
        relativePath
      };
    }

    if (IMAGE_EXTENSIONS.has(extension)) {
      const buffer = await fs.readFile(absolutePath);

      return {
        content: `data:${inferMimeType(absolutePath)};base64,${buffer.toString("base64")}`,
        kind: "image",
        modifiedAt: stats.mtime.toISOString(),
        name: path.basename(absolutePath),
        relativePath
      };
    }

    if (TEXT_EXTENSIONS.has(extension)) {
      return {
        content: await fs.readFile(absolutePath, "utf8"),
        kind: "text",
        modifiedAt: stats.mtime.toISOString(),
        name: path.basename(absolutePath),
        relativePath
      };
    }

    const buffer = await fs.readFile(absolutePath);

    if (isProbablyTextFile(buffer)) {
      return {
        content: buffer.toString("utf8"),
        kind: "text",
        modifiedAt: stats.mtime.toISOString(),
        name: path.basename(absolutePath),
        relativePath
      };
    }

    return {
      content: null,
      kind: "unsupported",
      modifiedAt: stats.mtime.toISOString(),
      name: path.basename(absolutePath),
      relativePath
    };
  }

  private async resolvePluginViewer(
    extension: string
  ): Promise<ReturnType<typeof findInstalledPluginViewerByExtension> | null> {
    if (!this.pluginRegistry) {
      return null;
    }

    const installedPlugins = await this.pluginRegistry.listInstalledPlugins();
    return findInstalledPluginViewerByExtension(installedPlugins, extension);
  }

  private async emitWorkspaceMutations(mutations: readonly WorkspaceMutation[]): Promise<void> {
    if (mutations.length === 0 || this.mutationListeners.size === 0) {
      return;
    }

    const normalizedMutations = mutations.map((mutation) => ({
      ...mutation,
      nextPath: mutation.nextPath ? normalizeRelativePath(mutation.nextPath) : undefined,
      path: normalizeRelativePath(mutation.path)
    }));

    for (const listener of this.mutationListeners) {
      await listener(normalizedMutations);
    }
  }

  private normalizeEntryName(
    name: string,
    kind: WorkspaceEntryKind,
    options: {
      defaultMarkdownExtension?: boolean;
      requireMarkdownExtension?: boolean;
    } = {}
  ): string {
    const trimmedName = name.trim();

    if (trimmedName.length === 0) {
      throw new Error("名前を入力してください。");
    }

    if (trimmedName === "." || trimmedName === ".." || /[\\/]/u.test(trimmedName)) {
      throw new Error("名前に使用できない文字が含まれています。");
    }

    if (kind === "directory") {
      return trimmedName;
    }

    const extension = path.extname(trimmedName).toLowerCase();

    if (options.defaultMarkdownExtension && extension.length === 0) {
      return `${trimmedName}.md`;
    }

    if (options.requireMarkdownExtension && extension !== ".md") {
      throw new Error("ノートは .md 拡張子のみ対応しています。");
    }

    return trimmedName;
  }

  private resolveWorkspacePath(relativePath: string): string {
    const rootPath = this.getConfiguredRootPath();
    const parts = relativePath
      .split(/[\\/]+/u)
      .filter(Boolean);
    const absolutePath = path.resolve(rootPath, ...parts);
    const normalizedRelative = path.relative(rootPath, absolutePath);

    if (normalizedRelative.startsWith("..") || path.isAbsolute(normalizedRelative)) {
      throw new Error("ワークスペース外のパスにはアクセスできません。");
    }

    return absolutePath;
  }

  private toRelativePath(absolutePath: string): string {
    return path.relative(this.getConfiguredRootPath(), absolutePath).split(path.sep).join("/");
  }

  private combineRelativePath(parentPath: string, name: string): string {
    return parentPath.length === 0 ? name : `${parentPath}/${name}`;
  }

  private async syncManagedDataNotesInternal(rootPath: string): Promise<void> {
    const metadataRootPath = path.join(rootPath, STORE_DIRECTORY, STORE_METADATA_DIRECTORY);
    const dataNoteRootPath = path.join(metadataRootPath, DATA_NOTE_DIRECTORY);
    const [metadataEntries, existingNoteEntries] = await Promise.all([
      fs.readdir(metadataRootPath, { withFileTypes: true }),
      fs.readdir(dataNoteRootPath, { withFileTypes: true })
    ]);
    const writePlans = (
      await Promise.all(
        metadataEntries
          .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".json")
          .map(async (entry) => {
            const metadata = await this.readJsonFile<unknown>(
              path.join(metadataRootPath, entry.name)
            );

            const originalDataMetadata = normalizeOriginalDataNoteMetadata(metadata);

            if (originalDataMetadata) {
              const absolutePath = path.join(
                dataNoteRootPath,
                `${originalDataMetadata.originalDataId.trim()}.md`
              );
              const existingContent = await readTextFileIfExists(absolutePath);

              return {
                absolutePath,
                nextContent: buildOriginalDataNoteMarkdown(originalDataMetadata, existingContent)
              } satisfies ManagedDataNoteWritePlan;
            }

            const datasetMetadata = normalizeDatasetDataNoteMetadata(metadata);

            if (!datasetMetadata) {
              return null;
            }

            const absolutePath = path.join(dataNoteRootPath, `${datasetMetadata.datasetId.trim()}.md`);
            const existingContent = await readTextFileIfExists(absolutePath);

            return {
              absolutePath,
              nextContent: buildDatasetDataNoteMarkdown(datasetMetadata, existingContent)
            } satisfies ManagedDataNoteWritePlan;
          })
      )
    )
      .filter((item): item is ManagedDataNoteWritePlan => item !== null)
      .sort((left, right) => left.absolutePath.localeCompare(right.absolutePath, "ja"));

    await Promise.all(
      writePlans.map(async (plan) => {
        const existingAssignedContent = await readTextFileIfExists(plan.absolutePath);

        if (normalizeForComparison(existingAssignedContent) === plan.nextContent) {
          return;
        }

        await fs.writeFile(plan.absolutePath, plan.nextContent, "utf8");
      })
    );

    const activeNoteNames = new Set(
      writePlans.map((plan) => path.basename(plan.absolutePath).toLowerCase())
    );

    await Promise.all(
      existingNoteEntries
        .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".md")
        .map(async (entry) => {
          if (activeNoteNames.has(entry.name.toLowerCase())) {
            return;
          }

          const absolutePath = path.join(dataNoteRootPath, entry.name);

          if (!(await pathExists(absolutePath))) {
            return;
          }

          await fs.rm(absolutePath, { force: false });
        })
    );
  }

  private async readJsonFile<T>(filePath: string): Promise<T | null> {
    try {
      const content = await fs.readFile(filePath, "utf8");
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  private async readPersistedRootPath(): Promise<string | undefined> {
    try {
      const stateContent = await fs.readFile(this.stateFilePath, "utf8");
      const state = JSON.parse(stateContent) as PersistedWorkspaceState;

      if (typeof state.rootPath !== "string" || state.rootPath.trim().length === 0) {
        return undefined;
      }

      const candidatePath = path.resolve(state.rootPath);
      const stats = await fs.stat(candidatePath);

      if (!stats.isDirectory()) {
        return undefined;
      }

      return candidatePath;
    } catch {
      return undefined;
    }
  }

  private async persistState(): Promise<void> {
    await fs.mkdir(path.dirname(this.stateFilePath), { recursive: true });

    const state: PersistedWorkspaceState = {
      rootPath: this.getConfiguredRootPath()
    };

    await fs.writeFile(this.stateFilePath, JSON.stringify(state, null, 2), "utf8");
  }

  private async getRequiredSnapshot(): Promise<WorkspaceSnapshot> {
    const snapshot = await this.getSnapshot();

    if (!snapshot) {
      throw new Error("ワークスペースフォルダが未設定です。");
    }

    return snapshot;
  }

  private getConfiguredRootPath(): string {
    if (!this.rootPath) {
      throw new Error("ワークスペースフォルダが未設定です。");
    }

    return this.rootPath;
  }

  private async rewriteMarkdownReferences(pathChanges: WorkspacePathChange[]): Promise<void> {
    const normalizedChanges = pathChanges.filter(
      (pathChange) =>
        pathChange.previousPath.trim().length > 0 &&
        pathChange.nextPath.trim().length > 0 &&
        pathChange.previousPath !== pathChange.nextPath
    );

    if (normalizedChanges.length === 0) {
      return;
    }

    const markdownPaths = await collectMarkdownRelativePaths(this.getConfiguredRootPath());

    await Promise.all(
      markdownPaths.map(async (relativePath) => {
        const absolutePath = this.resolveWorkspacePath(relativePath);
        const currentContent = await fs.readFile(absolutePath, "utf8");
        const parsed = splitFrontmatterBlock(currentContent);
        const currentBody = parsed.frontmatter === null ? currentContent : parsed.body;
        const nextBody = rewriteWorkspaceMarkdownReferences(currentBody, normalizedChanges);

        if (nextBody === currentBody) {
          return;
        }

        const nextContent =
          parsed.frontmatter === null
            ? nextBody
            : serializeFrontmatterDocument(parsed.frontmatter, nextBody);

        await fs.writeFile(absolutePath, nextContent, "utf8");
      })
    );
  }
}

interface NormalizedWorkspaceSearchRequest {
  caseSensitive: boolean;
  excludePatterns: RegExp[];
  includePatterns: RegExp[];
  maxResults: number;
  query: string;
  regex: boolean;
  wholeWord: boolean;
}

interface WorkspaceSearchFileCollectionResult {
  file: WorkspaceSearchFileResult;
  truncated: boolean;
}

interface WorkspaceReplacementPlan {
  content: string;
  replacedCount: number;
}

function isProbablyTextFile(buffer: Buffer): boolean {
  return !buffer.includes(0);
}

function normalizeWorkspaceSearchRequest(
  request: WorkspaceSearchRequest
): NormalizedWorkspaceSearchRequest {
  return {
    caseSensitive: request.caseSensitive ?? false,
    excludePatterns: parseWorkspaceSearchGlobExpression(request.excludePattern),
    includePatterns: parseWorkspaceSearchGlobExpression(request.includePattern),
    maxResults: clampWorkspaceSearchMaxResults(request.maxResults),
    query: request.query.trim(),
    regex: request.regex ?? false,
    wholeWord: request.wholeWord ?? false
  };
}

function normalizeWorkspaceReplaceRequest(
  request: WorkspaceReplaceRequest
): NormalizedWorkspaceSearchRequest & {
  replacement: string;
} {
  return {
    ...normalizeWorkspaceSearchRequest(request),
    replacement: request.replacement
  };
}

function clampWorkspaceSearchMaxResults(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_WORKSPACE_SEARCH_MAX_RESULTS;
  }

  return Math.max(1, Math.min(5000, Math.floor(value)));
}

function parseWorkspaceSearchGlobExpression(value: string | undefined): RegExp[] {
  if (!value) {
    return [];
  }

  return value
    .split(/[,\n]/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((pattern) => globPatternToRegExp(pattern));
}

function globPatternToRegExp(pattern: string): RegExp {
  const normalizedPattern = normalizeWorkspaceGlobPattern(pattern);
  let source = "";

  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const current = normalizedPattern[index];
    const next = normalizedPattern[index + 1];
    const nextNext = normalizedPattern[index + 2];

    if (current === "*" && next === "*" && nextNext === "/") {
      source += "(?:.*/)?";
      index += 2;
      continue;
    }

    if (current === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }

    if (current === "*") {
      source += "[^/]*";
      continue;
    }

    if (current === "?") {
      source += "[^/]";
      continue;
    }

    if (".+^${}()|[]\\".includes(current)) {
      source += `\\${current}`;
      continue;
    }

    source += current;
  }

  return new RegExp(`^${source}$`, "u");
}

function normalizeWorkspaceGlobPattern(pattern: string): string {
  const trimmed = pattern.trim().replace(/\\/gu, "/");
  const hasTrailingSlash = trimmed.endsWith("/");
  let normalized = normalizeRelativePath(trimmed).replace(/^\/+/u, "");

  if (normalized.length === 0) {
    return "**";
  }

  if (hasTrailingSlash) {
    normalized = `${normalized}**`;
  }

  if (!normalized.includes("/")) {
    normalized = `**/${normalized}`;
  }

  return normalized;
}

function createWorkspaceSearchRegExp(
  request: Pick<NormalizedWorkspaceSearchRequest, "caseSensitive" | "query" | "regex" | "wholeWord">
): RegExp {
  const baseSource = request.regex ? request.query : escapeRegExp(request.query);
  const source = request.wholeWord ? `\\b(?:${baseSource})\\b` : baseSource;
  const flags = request.caseSensitive ? "gu" : "giu";

  try {
    return new RegExp(source, flags);
  } catch (error) {
    throw new Error(
      `検索パターンが不正です: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function shouldSearchWorkspaceFile(
  relativePath: string,
  request: Pick<NormalizedWorkspaceSearchRequest, "excludePatterns" | "includePatterns">
): boolean {
  const normalizedRelativePath = normalizeRelativePath(relativePath);

  if (
    request.excludePatterns.length > 0 &&
    request.excludePatterns.some((pattern) => pattern.test(normalizedRelativePath))
  ) {
    return false;
  }

  if (request.includePatterns.length === 0) {
    return true;
  }

  return request.includePatterns.some((pattern) => pattern.test(normalizedRelativePath));
}

async function collectSearchCandidateRelativePaths(
  rootPath: string,
  currentPath: string = rootPath
): Promise<string[]> {
  const directoryEntries = await fs.readdir(currentPath, { withFileTypes: true });
  const relativePaths: string[] = [];

  for (const entry of directoryEntries) {
    const absolutePath = path.join(currentPath, entry.name);
    const relativePath = path.relative(rootPath, absolutePath).split(path.sep).join("/");

    if (entry.isDirectory()) {
      if (SEARCH_EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
        continue;
      }

      relativePaths.push(...(await collectSearchCandidateRelativePaths(rootPath, absolutePath)));
      continue;
    }

    if (entry.isFile()) {
      relativePaths.push(relativePath);
    }
  }

  return relativePaths.sort((left, right) => left.localeCompare(right, "ja"));
}

async function readSearchableTextFile(absolutePath: string): Promise<string | null> {
  const extension = path.extname(absolutePath).toLowerCase();

  if (IMAGE_EXTENSIONS.has(extension)) {
    return null;
  }

  if (TEXT_EXTENSIONS.has(extension) || HTML_EXTENSIONS.has(extension)) {
    return fs.readFile(absolutePath, "utf8");
  }

  const buffer = await fs.readFile(absolutePath);

  if (!isProbablyTextFile(buffer)) {
    return null;
  }

  return buffer.toString("utf8");
}

function collectWorkspaceSearchFileResult(
  content: string,
  searchExpression: RegExp,
  relativePath: string,
  maxMatches: number
): WorkspaceSearchFileCollectionResult | null {
  const matches = collectWorkspaceSearchMatches(content, searchExpression, maxMatches);

  if (matches.items.length === 0) {
    return matches.truncated
      ? {
          file: {
            matchCount: 0,
            matches: [],
            relativePath
          },
          truncated: true
        }
      : null;
  }

  return {
    file: {
      matchCount: matches.items.length,
      matches: matches.items,
      relativePath
    },
    truncated: matches.truncated
  };
}

function collectWorkspaceSearchMatches(
  content: string,
  searchExpression: RegExp,
  maxMatches: number
): {
  items: WorkspaceSearchMatch[];
  truncated: boolean;
} {
  const items: WorkspaceSearchMatch[] = [];
  const lines = content.replace(/\r\n?/gu, "\n").split("\n");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (items.length >= maxMatches) {
      return {
        items,
        truncated: true
      };
    }

    const lineText = lines[lineIndex] ?? "";
    const expression = new RegExp(searchExpression.source, searchExpression.flags);
    let match: RegExpExecArray | null = expression.exec(lineText);

    while (match) {
      if (items.length >= maxMatches) {
        return {
          items,
          truncated: true
        };
      }

      const matchText = match[0] ?? "";
      const startIndex = match.index;
      const endIndex = startIndex + Math.max(matchText.length, 1);

      items.push({
        endColumn: endIndex + 1,
        lineNumber: lineIndex + 1,
        lineText,
        startColumn: startIndex + 1
      });

      if (matchText.length === 0) {
        expression.lastIndex += 1;
      }

      match = expression.exec(lineText);
    }
  }

  return {
    items,
    truncated: false
  };
}

function createWorkspaceReplacement(
  content: string,
  request: NormalizedWorkspaceSearchRequest & {
    replacement: string;
  }
): WorkspaceReplacementPlan | null {
  const countExpression = createWorkspaceSearchRegExp(request);
  let replacedCount = 0;

  content.replace(countExpression, () => {
    replacedCount += 1;
    return "";
  });

  if (replacedCount === 0) {
    return null;
  }

  const applyExpression = createWorkspaceSearchRegExp(request);
  const nextContent = request.regex
    ? content.replace(applyExpression, request.replacement)
    : content.replace(applyExpression, () => request.replacement);

  return {
    content: nextContent,
    replacedCount
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath
    .split(/[\\/]+/u)
    .filter(Boolean)
    .join("/");
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
    if (collapsed.some((existing) => isSameOrDescendantRelativePath(candidate, existing))) {
      continue;
    }

    collapsed.push(candidate);
  }

  return collapsed;
}

function normalizeAbsolutePaths(absolutePaths: string[]): string[] {
  return Array.from(
    new Set(
      absolutePaths
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .map((value) => path.resolve(value))
    )
  );
}

function isSameOrDescendantRelativePath(candidate: string, base: string): boolean {
  if (candidate === base) {
    return true;
  }

  return candidate.startsWith(`${base}/`);
}

function isSamePath(leftPath: string, rightPath: string): boolean {
  const normalizedLeft = path.resolve(leftPath);
  const normalizedRight = path.resolve(rightPath);

  if (process.platform === "win32") {
    return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  }

  return normalizedLeft === normalizedRight;
}

function isDescendantPath(candidatePath: string, parentPath: string): boolean {
  const relativePath = path.relative(parentPath, candidatePath);

  if (relativePath.length === 0) {
    return true;
  }

  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function assertDestinationIsOutsideSource(
  sourcePath: string,
  destinationDirectoryPath: string,
  sourceKind: WorkspaceEntryKind,
  operation: "copy" | "move"
): void {
  if (sourceKind !== "directory") {
    return;
  }

  if (isDescendantPath(destinationDirectoryPath, sourcePath)) {
    throw new Error(`${path.basename(sourcePath)} の配下へは ${operation} できません。`);
  }
}

async function createCopyDestinationPath(
  destinationDirectoryPath: string,
  sourceName: string,
  sourceKind: WorkspaceEntryKind
): Promise<string> {
  const preferredPath = path.join(destinationDirectoryPath, sourceName);

  if (!(await pathExists(preferredPath))) {
    return preferredPath;
  }

  const extension = sourceKind === "file" ? path.extname(sourceName) : "";
  const stem = sourceKind === "file" ? path.basename(sourceName, extension) : sourceName;

  for (let serial = 1; serial < 10000; serial += 1) {
    const suffix = serial === 1 ? " copy" : ` copy ${serial}`;
    const nextName = `${stem}${suffix}${extension}`;
    const candidatePath = path.join(destinationDirectoryPath, nextName);

    if (!(await pathExists(candidatePath))) {
      return candidatePath;
    }
  }

  throw new Error(`${sourceName} のコピー先を確保できませんでした。`);
}

async function createAvailableImagePath(
  destinationDirectoryPath: string,
  preferredFileName: string
): Promise<string> {
  const preferredPath = path.join(destinationDirectoryPath, preferredFileName);

  if (!(await pathExists(preferredPath))) {
    return preferredPath;
  }

  const extension = path.extname(preferredFileName);
  const stem = path.basename(preferredFileName, extension);

  for (let serial = 2; serial < 10000; serial += 1) {
    const candidatePath = path.join(destinationDirectoryPath, `${stem}_${serial}${extension}`);

    if (!(await pathExists(candidatePath))) {
      return candidatePath;
    }
  }

  throw new Error(`${preferredFileName} の保存先を確保できませんでした。`);
}

async function createTimestampedImagePath(
  destinationDirectoryPath: string,
  preferredFileName: string
): Promise<string> {
  const extension = path.extname(preferredFileName);
  const timestamp = formatLocalTimestamp(new Date());

  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const randomSuffix = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0");
    const candidatePath = path.join(
      destinationDirectoryPath,
      `${timestamp}-${randomSuffix}${extension}`
    );

    if (!(await pathExists(candidatePath))) {
      return candidatePath;
    }
  }

  throw new Error("画像の保存先を確保できませんでした。");
}

function createNoteImageFileName(
  originalFileName: string | undefined,
  contentType: string | undefined
): string {
  return `image${inferImageExtension(originalFileName, contentType)}`;
}

function inferImageExtension(
  originalFileName: string | undefined,
  contentType: string | undefined
): string {
  const fileNameExtension = path.extname(originalFileName?.trim() ?? "").toLowerCase();

  if (IMAGE_EXTENSIONS.has(fileNameExtension)) {
    return fileNameExtension;
  }

  switch ((contentType ?? "").trim().toLowerCase()) {
    case "image/bmp":
      return ".bmp";
    case "image/gif":
      return ".gif";
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/svg+xml":
      return ".svg";
    case "image/webp":
      return ".webp";
    default:
      return ".png";
  }
}

function formatLocalTimestamp(value: Date): string {
  const year = value.getFullYear().toString().padStart(4, "0");
  const month = (value.getMonth() + 1).toString().padStart(2, "0");
  const day = value.getDate().toString().padStart(2, "0");
  const hour = value.getHours().toString().padStart(2, "0");
  const minute = value.getMinutes().toString().padStart(2, "0");

  return `${year}${month}${day}-${hour}${minute}`;
}

async function collectMarkdownRelativePaths(
  rootPath: string,
  currentPath: string = rootPath
): Promise<string[]> {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  const relativePaths: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      relativePaths.push(...(await collectMarkdownRelativePaths(rootPath, absolutePath)));
      continue;
    }

    if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".md") {
      relativePaths.push(path.relative(rootPath, absolutePath).split(path.sep).join("/"));
    }
  }

  return relativePaths;
}

async function readTextFileIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
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

function normalizeForComparison(value: string | undefined): string | undefined {
  return value?.replace(/\r\n?/gu, "\n");
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
): ResolvedPluginViewer {
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

  if (TEXT_EXTENSIONS.has(extension)) {
    return {
      data: await fs.readFile(absolutePath, "utf8"),
      dataEncoding: "text",
      mediaType
    };
  }

  const buffer = await fs.readFile(absolutePath);

  if (isProbablyTextFile(buffer)) {
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


