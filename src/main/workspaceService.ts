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

const SAMPLE_WELCOME = `# IntegralNotes Prototype

このノートはワークスペース初期化時に自動生成されます。

## この仮実装でできること

- 左サイドバーで Notes フォルダのツリーを閲覧
- Markdown ノートの作成・リネーム・削除
- Milkdown で WYSIWYG 編集
- FlexLayout でタブを自由にドッキング

## 次の実装候補

1. ノートへの独自 UI ブロック挿入
2. 解析データの紐付け
3. サジェスト機能
`;

const SAMPLE_EXPERIMENT = `# 2026-04-08 実験メモ

## 目的

Gradient 条件の初期メモを残す。

## 手順

1. サンプル準備
2. 条件設定
3. クロマト確認

## 所感

- ここに考察を書き足していく
- 将来的には独自 UI ブロックを差し込む
`;

export class WorkspaceService {
  readonly rootPath: string;

  constructor(rootPath = path.resolve(process.cwd(), "Notes")) {
    this.rootPath = rootPath;
  }

  async ensureWorkspaceReady(): Promise<void> {
    await fs.mkdir(this.rootPath, { recursive: true });

    const visibleEntries = await fs.readdir(this.rootPath);

    if (visibleEntries.length > 0) {
      return;
    }

    await fs.mkdir(path.join(this.rootPath, "Experiments"), { recursive: true });
    await fs.writeFile(path.join(this.rootPath, "Welcome.md"), SAMPLE_WELCOME, "utf8");
    await fs.writeFile(
      path.join(this.rootPath, "Experiments", "2026-04-08.md"),
      SAMPLE_EXPERIMENT,
      "utf8"
    );
  }

  async getSnapshot(): Promise<WorkspaceSnapshot> {
    await this.ensureWorkspaceReady();

    return {
      rootName: path.basename(this.rootPath),
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
}
