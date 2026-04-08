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
  initialRootPath: string;
  stateFilePath: string;
}

interface PersistedWorkspaceState {
  rootPath?: string;
}

export class WorkspaceService {
  private rootPath: string;
  private readonly fallbackRootPath: string;
  private readonly stateFilePath: string;

  constructor(options: WorkspaceServiceOptions) {
    this.fallbackRootPath = path.resolve(options.initialRootPath);
    this.rootPath = this.fallbackRootPath;
    this.stateFilePath = options.stateFilePath;
  }

  get currentRootPath(): string {
    return this.rootPath;
  }

  async initialize(): Promise<void> {
    const persistedRootPath = await this.readPersistedRootPath();

    if (persistedRootPath) {
      this.rootPath = persistedRootPath;
    }

    await this.ensureWorkspaceReady();
  }

  async setRootPath(nextRootPath: string): Promise<WorkspaceSnapshot> {
    this.rootPath = path.resolve(nextRootPath);
    await this.ensureWorkspaceReady();
    await this.persistState();

    return this.getSnapshot();
  }

  async ensureWorkspaceReady(): Promise<void> {
    await fs.mkdir(this.rootPath, { recursive: true });
  }

  async getSnapshot(): Promise<WorkspaceSnapshot> {
    await this.ensureWorkspaceReady();

    return {
      rootName: path.basename(this.rootPath) || this.rootPath,
      rootPath: this.rootPath,
      entries: await this.readDirectoryEntries("")
    };
  }

  async readNote(relativePath: string): Promise<NoteDocument> {
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
    await this.ensureWorkspaceReady();

    const absolutePath = this.resolveWorkspacePath(relativePath);
    await fs.writeFile(absolutePath, content, "utf8");

    return this.readNote(relativePath);
  }

  async createEntry(request: CreateEntryRequest): Promise<CreateEntryResult> {
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

    return {
      snapshot: await this.getSnapshot(),
      entry: await this.getEntryByPath(this.toRelativePath(absolutePath))
    };
  }

  async renameEntry(request: RenameEntryRequest): Promise<RenameEntryResult> {
    await this.ensureWorkspaceReady();

    const sourcePath = this.resolveWorkspacePath(request.targetPath);
    const stats = await fs.stat(sourcePath);
    const kind: WorkspaceEntryKind = stats.isDirectory() ? "directory" : "file";
    const nextName = this.normalizeEntryName(request.nextName, kind);
    const destinationPath = path.join(path.dirname(sourcePath), nextName);

    if (destinationPath === sourcePath) {
      return {
        snapshot: await this.getSnapshot(),
        entry: await this.getEntryByPath(this.toRelativePath(destinationPath)),
        previousRelativePath: request.targetPath
      };
    }

    await fs.rename(sourcePath, destinationPath);

    return {
      snapshot: await this.getSnapshot(),
      entry: await this.getEntryByPath(this.toRelativePath(destinationPath)),
      previousRelativePath: request.targetPath
    };
  }

  async deleteEntry(request: DeleteEntryRequest): Promise<DeleteEntryResult> {
    await this.ensureWorkspaceReady();

    const absolutePath = this.resolveWorkspacePath(request.targetPath);
    const stats = await fs.stat(absolutePath);

    await fs.rm(absolutePath, { recursive: true, force: false });

    return {
      snapshot: await this.getSnapshot(),
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
    const parts = relativePath
      .split(/[\\/]+/u)
      .filter(Boolean);
    const absolutePath = path.resolve(this.rootPath, ...parts);
    const normalizedRelative = path.relative(this.rootPath, absolutePath);

    if (normalizedRelative.startsWith("..") || path.isAbsolute(normalizedRelative)) {
      throw new Error("ワークスペース外のパスにはアクセスできません。");
    }

    return absolutePath;
  }

  private toRelativePath(absolutePath: string): string {
    return path.relative(this.rootPath, absolutePath).split(path.sep).join("/");
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
      rootPath: this.rootPath
    };

    await fs.writeFile(this.stateFilePath, JSON.stringify(state, null, 2), "utf8");
  }
}
