import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type {
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
  WorkspaceEntry,
  WorkspaceEntryKind,
  WorkspaceFileDocument,
  WorkspaceSnapshot
} from "../shared/workspace";
import {
  type WorkspacePathChange,
  rewriteWorkspaceMarkdownReferences
} from "../shared/workspaceLinks";
import {
  assignDataNoteFileNames,
  buildDatasetDataNoteMarkdown,
  buildOriginalDataNoteMarkdown,
  createDataNoteTargetKey,
  isDatasetDataNoteMetadata,
  isOriginalDataNoteMetadata,
  parseDataNoteTargetInfo
} from "./dataNote";
import {
  extractFrontmatterBody,
  hasFrontmatterBlock,
  replaceFrontmatterBody,
  serializeFrontmatterDocument,
  splitFrontmatterBlock
} from "./frontmatter";

interface WorkspaceServiceOptions {
  initialRootPath?: string;
  stateFilePath: string;
}

interface PersistedWorkspaceState {
  rootPath?: string;
}

const DATA_CATALOG_DIRECTORY = "data-catalog";
const STORE_DIRECTORY = ".store";
const STORE_METADATA_DIRECTORY = ".integral";
const PYTHON_SCRIPTS_DIRECTORY = ".py-scripts";
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

interface ExistingDataCatalogNote {
  absolutePath: string;
  content: string;
  fileName: string;
  targetKey: string | null;
}

interface ManagedDataNoteSyncItem {
  createdAt: string;
  preferredLabel: string;
  targetKey: string;
  writeContent: (existingContent?: string) => string;
}

interface ManagedDataNoteWritePlan {
  assignedAbsolutePath: string;
  assignedFileName: string;
  nextContent: string;
  sourceNote: ExistingDataCatalogNote | undefined;
}

export class WorkspaceService {
  private rootPath: string | undefined;
  private readonly initialRootPath: string | undefined;
  private readonly stateFilePath: string;

  constructor(options: WorkspaceServiceOptions) {
    this.initialRootPath = options.initialRootPath ? path.resolve(options.initialRootPath) : undefined;
    this.rootPath = this.initialRootPath;
    this.stateFilePath = options.stateFilePath;
  }

  get currentRootPath(): string | undefined {
    return this.rootPath;
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
      fs.mkdir(path.join(rootPath, DATA_CATALOG_DIRECTORY), { recursive: true }),
      fs.mkdir(path.join(rootPath, STORE_DIRECTORY, STORE_METADATA_DIRECTORY), { recursive: true }),
      fs.mkdir(path.join(rootPath, PYTHON_SCRIPTS_DIRECTORY), { recursive: true })
    ]);
    await this.syncDataCatalogNotes(rootPath);
  }

  async syncManagedDataCatalogNotes(): Promise<void> {
    await this.syncDataCatalogNotes(this.getConfiguredRootPath());
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
    }

    return this.readNote(relativePath);
  }

  async createEntry(request: CreateEntryRequest): Promise<CreateEntryResult> {
    this.getConfiguredRootPath();
    await this.ensureWorkspaceReady();

    const parentPath = this.resolveWorkspacePath(request.parentPath);
    const parentStats = await fs.stat(parentPath);

    if (!parentStats.isDirectory()) {
      throw new Error("作成先はフォルダである必要があります。");
    }

    const nextName = this.normalizeEntryName(request.name, request.kind);
    const absolutePath = path.join(parentPath, nextName);

    if (request.kind === "directory") {
      await fs.mkdir(absolutePath);
    } else {
      await fs.writeFile(absolutePath, `# ${path.basename(nextName, ".md")}\n`, "utf8");
    }

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

    await fs.rm(absolutePath, { recursive: true, force: false });

    const snapshot = await this.getRequiredSnapshot();

    return {
      snapshot,
      deletedRelativePath: request.targetPath,
      deletedKind: stats.isDirectory() ? "directory" : "file"
    };
  }

  async deleteEntries(request: DeleteEntriesRequest): Promise<DeleteEntriesResult> {
    this.getConfiguredRootPath();
    await this.ensureWorkspaceReady();

    const targetPaths = collapseNestedRelativePaths(request.targetPaths);

    if (targetPaths.length === 0) {
      throw new Error("削除対象を選択してください。");
    }

    for (const targetPath of targetPaths) {
      await fs.rm(this.resolveWorkspacePath(targetPath), { recursive: true, force: false });
    }

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

    return {
      entry,
      snapshot: await this.getRequiredSnapshot()
    };
  }

  getAbsolutePath(relativePath: string): string {
    return this.resolveWorkspacePath(relativePath);
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

    const supportedEntries = directoryEntries
      .filter((entry) => this.isVisibleEntry(entry.name, entry.isDirectory()))
      .sort((left, right) => {
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

      return {
        content: extractFrontmatterBody(markdownContent),
        kind: "markdown",
        modifiedAt: stats.mtime.toISOString(),
        name: path.basename(absolutePath),
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

  private normalizeEntryName(name: string, kind: WorkspaceEntryKind): string {
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

    if (extension.length === 0) {
      return `${trimmedName}.md`;
    }

    if (extension !== ".md") {
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

  private isVisibleEntry(name: string, isDirectory: boolean): boolean {
    if (name.startsWith(".")) {
      return false;
    }

    return isDirectory || name.length > 0;
  }

  private async syncDataCatalogNotes(rootPath: string): Promise<void> {
    const metadataRootPath = path.join(rootPath, STORE_DIRECTORY, STORE_METADATA_DIRECTORY);
    const dataCatalogRootPath = path.join(rootPath, DATA_CATALOG_DIRECTORY);
    const [metadataEntries, dataCatalogEntries] = await Promise.all([
      fs.readdir(metadataRootPath, { withFileTypes: true }),
      fs.readdir(dataCatalogRootPath, { withFileTypes: true })
    ]);
    const syncItems = (
      await Promise.all(
        metadataEntries
          .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".json")
          .map(async (entry) => {
            const metadata = await this.readJsonFile<unknown>(
              path.join(metadataRootPath, entry.name)
            );

            if (isOriginalDataNoteMetadata(metadata)) {
              return {
                createdAt: metadata.createdAt,
                preferredLabel: metadata.originalName.trim(),
                targetKey: createDataNoteTargetKey("original-data", metadata.originalDataId),
                writeContent: (existingContent?: string) =>
                  buildOriginalDataNoteMarkdown(metadata, existingContent)
              } satisfies ManagedDataNoteSyncItem;
            }

            if (!isDatasetDataNoteMetadata(metadata)) {
              return null;
            }

            const normalizedStoreRelativePath = metadata.storeRelativePath
              .split(/[\\/]+/u)
              .filter(Boolean)
              .join("/");
            const canonicalFileRelativePaths = (
              await collectRelativeFilesIfExists(path.join(rootPath, normalizedStoreRelativePath))
            ).map((relativePath) => `${normalizedStoreRelativePath}/${relativePath}`);

            return {
              createdAt: metadata.createdAt,
              preferredLabel: metadata.name?.trim() || metadata.datasetId.trim(),
              targetKey: createDataNoteTargetKey("dataset", metadata.datasetId),
              writeContent: (existingContent?: string) =>
                buildDatasetDataNoteMarkdown(
                  metadata,
                  existingContent,
                  canonicalFileRelativePaths
                )
            } satisfies ManagedDataNoteSyncItem;
          })
      )
    )
      .filter((item): item is ManagedDataNoteSyncItem => item !== null)
      .sort((left, right) => {
        const createdAtComparison = left.createdAt.localeCompare(right.createdAt);

        if (createdAtComparison !== 0) {
          return createdAtComparison;
        }

        return left.targetKey.localeCompare(right.targetKey, "ja");
      });

    const existingDataCatalogNotes = (
      await Promise.all(
        dataCatalogEntries
          .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".md")
          .map(async (entry) => {
            const absolutePath = path.join(dataCatalogRootPath, entry.name);
            const content = await readTextFileIfExists(absolutePath);

            if (content === undefined) {
              return null;
            }

            const targetInfo = parseDataNoteTargetInfo(content);

            return {
              absolutePath,
              content,
              fileName: entry.name,
              targetKey: targetInfo
                ? createDataNoteTargetKey(targetInfo.dataTargetType, targetInfo.targetId)
                : null
            } satisfies ExistingDataCatalogNote;
          })
      )
    ).filter((entry): entry is ExistingDataCatalogNote => entry !== null);

    const existingNotesByTarget = new Map<string, ExistingDataCatalogNote[]>();

    for (const existingNote of existingDataCatalogNotes) {
      if (existingNote.targetKey === null) {
        continue;
      }

      const currentNotes = existingNotesByTarget.get(existingNote.targetKey) ?? [];
      currentNotes.push(existingNote);
      currentNotes.sort((left, right) => left.fileName.localeCompare(right.fileName, "ja"));
      existingNotesByTarget.set(existingNote.targetKey, currentNotes);
    }

    const assignments = assignDataNoteFileNames(
      existingDataCatalogNotes.map((note) => ({
        fileName: note.fileName,
        targetKey: note.targetKey
      })),
      syncItems.map((item) => ({
        preferredLabel: item.preferredLabel,
        targetKey: item.targetKey
      }))
    );
    const writePlans: ManagedDataNoteWritePlan[] = [];

    for (const item of syncItems) {
      const assignedFileName = assignments.get(item.targetKey);

      if (!assignedFileName) {
        continue;
      }

      const sourceNotes = existingNotesByTarget.get(item.targetKey) ?? [];
      const sourceNote =
        sourceNotes.find(
          (candidate) => candidate.fileName.toLowerCase() === assignedFileName.toLowerCase()
        ) ?? sourceNotes[0];

      writePlans.push({
        assignedAbsolutePath: path.join(dataCatalogRootPath, assignedFileName),
        assignedFileName,
        nextContent: item.writeContent(sourceNote?.content),
        sourceNote
      });
    }
    const finalAssignedFileNames = new Set(
      writePlans.map((plan) => plan.assignedFileName.toLowerCase())
    );

    await Promise.all(
      writePlans.map(async (plan) => {
        const existingAssignedContent = await readTextFileIfExists(plan.assignedAbsolutePath);

        if (normalizeForComparison(existingAssignedContent) === plan.nextContent) {
          return;
        }

        await fs.writeFile(plan.assignedAbsolutePath, plan.nextContent, "utf8");
      })
    );

    await Promise.all(
      writePlans.map(async (plan) => {
        if (!plan.sourceNote) {
          return;
        }

        if (
          plan.sourceNote.fileName.toLowerCase() === plan.assignedFileName.toLowerCase() ||
          finalAssignedFileNames.has(plan.sourceNote.fileName.toLowerCase())
        ) {
          return;
        }

        await fs.rm(plan.sourceNote.absolutePath, { force: false });
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

function isProbablyTextFile(buffer: Buffer): boolean {
  return !buffer.includes(0);
}

function collapseNestedRelativePaths(relativePaths: string[]): string[] {
  const normalized = Array.from(
    new Set(
      relativePaths
        .map((value) => value.trim())
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

async function collectRelativeFilesIfExists(
  rootPath: string,
  basePath = rootPath
): Promise<string[]> {
  try {
    const entries = await fs.readdir(rootPath, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "ja"))) {
      const absolutePath = path.join(rootPath, entry.name);

      if (entry.isDirectory()) {
        files.push(...(await collectRelativeFilesIfExists(absolutePath, basePath)));
        continue;
      }

      files.push(path.relative(basePath, absolutePath).split(path.sep).join("/"));
    }

    return files;
  } catch {
    return [];
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
    case ".bmp":
      return "image/bmp";
    case ".gif":
      return "image/gif";
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

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}


