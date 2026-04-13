import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  CreateEntryRequest,
  CreateEntryResult,
  DeleteEntryRequest,
  DeleteEntryResult,
  NoteDocument,
  RenameEntryRequest,
  RenameEntryResult,
  WorkspaceEntry,
  WorkspaceEntryKind,
  WorkspaceSnapshot
} from "../shared/workspace";

interface WorkspaceServiceOptions {
  initialRootPath?: string;
  stateFilePath: string;
}

interface PersistedWorkspaceState {
  rootPath?: string;
}

interface BlobArtifactMetadata {
  blobId: string;
  createdAt?: string;
  originalName?: string;
  sourceKind?: "directory" | "file";
}

interface ChunkArtifactMetadata {
  kind?: string;
}

interface SourceChunkLinks {
  members?: Array<{
    blobId: string;
    target: string;
  }>;
}

const NOTES_DIRECTORY = "Notes";
const ARTIFACTS_DIRECTORY = "Artifacts";
const BLOBS_DIRECTORY = ".blob";
const LEGACY_BLOBS_DIRECTORY = "blob";
const CHUNKS_DIRECTORY = "chunk";
const LEGACY_CHUNKS_DIRECTORY = ".chunk";
const PYTHON_SCRIPTS_DIRECTORY = ".py-scripts";

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
    await this.migrateLegacyIntegralStorageLayout(rootPath);
    await Promise.all([
      fs.mkdir(path.join(rootPath, NOTES_DIRECTORY), { recursive: true }),
      fs.mkdir(path.join(rootPath, ARTIFACTS_DIRECTORY), { recursive: true }),
      fs.mkdir(path.join(rootPath, BLOBS_DIRECTORY), { recursive: true }),
      fs.mkdir(path.join(rootPath, CHUNKS_DIRECTORY), { recursive: true }),
      fs.mkdir(path.join(rootPath, PYTHON_SCRIPTS_DIRECTORY), { recursive: true })
    ]);
    await this.migrateLegacyBlobArtifactNotes(rootPath);
    await Promise.all([
      this.syncBlobArtifactNotes(rootPath),
      this.syncSourceChunkLinks(rootPath)
    ]);
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

  async readNote(relativePath: string): Promise<NoteDocument> {
    this.getConfiguredRootPath();
    await this.ensureWorkspaceReady();

    const absolutePath = this.resolveWorkspacePath(relativePath);
    const stats = await fs.stat(absolutePath);

    if (!stats.isFile() || path.extname(absolutePath).toLowerCase() !== ".md") {
      throw new Error("Markdownノートのみ開けます。");
    }

    return {
      relativePath: this.toRelativePath(absolutePath),
      name: path.basename(absolutePath),
      content: await fs.readFile(absolutePath, "utf8"),
      modifiedAt: stats.mtime.toISOString()
    };
  }

  async saveNote(relativePath: string, content: string): Promise<NoteDocument> {
    this.getConfiguredRootPath();
    await this.ensureWorkspaceReady();

    const absolutePath = this.resolveWorkspacePath(relativePath);
    await fs.writeFile(absolutePath, content, "utf8");

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

    const snapshot = await this.getRequiredSnapshot();

    return {
      snapshot,
      entry: await this.getEntryByPath(this.toRelativePath(destinationPath)),
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

    return isDirectory || path.extname(name).toLowerCase() === ".md";
  }

  private async migrateLegacyIntegralStorageLayout(rootPath: string): Promise<void> {
    await this.migrateDirectory(path.join(rootPath, LEGACY_BLOBS_DIRECTORY), path.join(rootPath, BLOBS_DIRECTORY));
    await this.migrateDirectory(path.join(rootPath, LEGACY_CHUNKS_DIRECTORY), path.join(rootPath, CHUNKS_DIRECTORY));
  }

  private async migrateDirectory(legacyPath: string, nextPath: string): Promise<void> {
    if (!(await this.pathExists(legacyPath))) {
      return;
    }

    if (!(await this.pathExists(nextPath))) {
      await fs.rename(legacyPath, nextPath);
      return;
    }

    const entries = await fs.readdir(legacyPath, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.join(legacyPath, entry.name);
      const destinationPath = path.join(nextPath, entry.name);

      if (await this.pathExists(destinationPath)) {
        continue;
      }

      await fs.rename(sourcePath, destinationPath);
    }

    const remainingEntries = await fs.readdir(legacyPath);

    if (remainingEntries.length === 0) {
      await fs.rmdir(legacyPath);
    }
  }

  private async migrateLegacyBlobArtifactNotes(rootPath: string): Promise<void> {
    const blobsRootPath = path.join(rootPath, BLOBS_DIRECTORY);
    const artifactsRootPath = path.join(rootPath, ARTIFACTS_DIRECTORY);
    const entries = await fs.readdir(blobsRootPath, { withFileTypes: true });

    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const metadata = await this.readJsonFile<BlobArtifactMetadata>(
            path.join(blobsRootPath, entry.name, "blob.json")
          );

          if (!metadata?.blobId) {
            return;
          }

          const nextArtifactPath = path.join(
            artifactsRootPath,
            createBlobArtifactFileName(metadata.originalName ?? metadata.blobId, metadata.blobId)
          );

          if (await this.pathExists(nextArtifactPath)) {
            return;
          }

          const legacyArtifactPath = path.join(artifactsRootPath, `${metadata.blobId}.md`);

          if (!(await this.pathExists(legacyArtifactPath))) {
            return;
          }

          await fs.rename(legacyArtifactPath, nextArtifactPath);
        })
    );
  }

  private async syncBlobArtifactNotes(rootPath: string): Promise<void> {
    const blobsRootPath = path.join(rootPath, BLOBS_DIRECTORY);
    const artifactsRootPath = path.join(rootPath, ARTIFACTS_DIRECTORY);
    const entries = await fs.readdir(blobsRootPath, { withFileTypes: true });

    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const metadata = await this.readJsonFile<BlobArtifactMetadata>(
            path.join(blobsRootPath, entry.name, "blob.json")
          );

          if (!metadata?.blobId) {
            return;
          }

          const originalName = metadata.originalName?.trim() || metadata.blobId;
          const artifactPath = path.join(
            artifactsRootPath,
            createBlobArtifactFileName(originalName, metadata.blobId)
          );
          const payloadRelativePath = path
            .relative(path.dirname(artifactPath), path.join(blobsRootPath, metadata.blobId, "payload"))
            .split(path.sep)
            .join("/");
          const lines = [
            `# ${originalName}_${metadata.blobId}`,
            "",
            `- Original Name: ${originalName}`,
            `- Blob ID: ${metadata.blobId}`,
            `- Source Kind: ${metadata.sourceKind ?? "file"}`,
            metadata.createdAt ? `- Created At: ${metadata.createdAt}` : null,
            `- Payload: \`${payloadRelativePath}\``
          ].filter((line): line is string => line !== null);

          await fs.writeFile(artifactPath, `${lines.join("\n")}\n`, "utf8");
        })
    );
  }

  private async syncSourceChunkLinks(rootPath: string): Promise<void> {
    const chunksRootPath = path.join(rootPath, CHUNKS_DIRECTORY);
    const entries = await fs.readdir(chunksRootPath, { withFileTypes: true });

    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const chunkRootPath = path.join(chunksRootPath, entry.name);
          const metadata = await this.readJsonFile<ChunkArtifactMetadata>(
            path.join(chunkRootPath, "chunk.json")
          );

          if (metadata?.kind !== "source-bundle") {
            return;
          }

          const links = await this.readJsonFile<SourceChunkLinks>(path.join(chunkRootPath, "links.json"));

          if (!links?.members || links.members.length === 0) {
            return;
          }

          const nextLinks: SourceChunkLinks = {
            members: links.members.map((member) => ({
              blobId: member.blobId,
              target: path
                .relative(chunkRootPath, path.join(rootPath, BLOBS_DIRECTORY, member.blobId, "payload"))
                .split(path.sep)
                .join("/")
            }))
          };

          if (JSON.stringify(nextLinks) === JSON.stringify(links)) {
            return;
          }

          await fs.writeFile(
            path.join(chunkRootPath, "links.json"),
            JSON.stringify(nextLinks, null, 2),
            "utf8"
          );
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

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
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
}

function createBlobArtifactFileName(originalName: string, blobId: string): string {
  const normalizedOriginalName = sanitizeFileNameSegment(originalName);
  return `${normalizedOriginalName}_${blobId}.md`;
}

function sanitizeFileNameSegment(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, "_")
    .replace(/[. ]+$/gu, "");

  return sanitized.length > 0 ? sanitized : "blob";
}
