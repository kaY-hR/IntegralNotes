import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type {
  ExecuteIntegralActionRequest,
  ExecuteIntegralActionResult,
  InstallPluginFromZipResult,
  UninstallPluginResult
} from "../shared/workspace";
import {
  PLUGIN_HOST_MODULE_EXPORT,
  PLUGIN_MANIFEST_FILENAME,
  parsePluginManifestText,
  toInstalledPluginDefinition,
  type InstalledPluginDefinition,
  type PluginHostModule,
  type PluginManifest
} from "../shared/plugins";

const LEGACY_SHIMADZU_PLUGIN_ID = "shimadzu.lc";
const LEGACY_SHIMADZU_BLOCK_TYPE = "LC.Method.Gradient";
const SHIMADZU_PLUGIN_ID = "shimadzu-lc";
const SHIMADZU_BLOCK_TYPE = "run-sequence";
const SHIMADZU_NAMESPACE = "shimadzu-lc";

interface PluginRegistryOptions {
  installRootPath: string;
}

interface ResolvedInstalledPlugin {
  definition: InstalledPluginDefinition;
  hostEntryPath: string | null;
  manifest: PluginManifest;
  rendererEntryPath: string | null;
  rootPath: string;
}

export class PluginRegistry {
  private readonly installRootPath: string;

  constructor(options: PluginRegistryOptions) {
    this.installRootPath = path.resolve(options.installRootPath);
  }

  getInstallRootPath(): string {
    return this.installRootPath;
  }

  async listInstalledPlugins(): Promise<InstalledPluginDefinition[]> {
    const plugins = await this.getResolvedPlugins();

    return plugins
      .map((plugin) => plugin.definition)
      .sort((left, right) => left.displayName.localeCompare(right.displayName, "ja"));
  }

  async loadRendererDocument(pluginId: string): Promise<string> {
    const plugin = await this.findPluginById(pluginId);

    if (!plugin || !plugin.rendererEntryPath) {
      throw new Error(`plugin renderer が見つかりません: ${pluginId}`);
    }

    return await prepareRendererDocument(
      await fs.readFile(plugin.rendererEntryPath, "utf8"),
      path.dirname(plugin.rendererEntryPath),
      plugin.rootPath
    );
  }

  async executeAction(
    request: ExecuteIntegralActionRequest
  ): Promise<ExecuteIntegralActionResult> {
    const plugin = await this.findPluginByBlockType(request.blockType);

    if (!plugin) {
      throw new Error(`block type に対応する plugin が見つかりません: ${request.blockType}`);
    }

    if (!plugin.hostEntryPath) {
      throw new Error(`plugin host が未定義です: ${plugin.definition.id}`);
    }

    const startedAt = new Date().toISOString();
    const runIntegralPluginAction = this.loadPluginHostRunner(plugin.hostEntryPath);
    const result = await Promise.resolve(
      runIntegralPluginAction({
        actionId: request.actionId,
        blockType: request.blockType,
        params: request.params,
        payload: request.payload,
        plugin: plugin.definition
      })
    );

    return {
      actionId: request.actionId,
      blockType: request.blockType,
      finishedAt: new Date().toISOString(),
      logLines: result.logLines,
      startedAt,
      status: "success",
      summary: result.summary
    };
  }

  async installPluginFromArchive(archivePath: string): Promise<InstallPluginFromZipResult> {
    const resolvedArchivePath = path.resolve(archivePath);
    const tempRootPath = await this.createTempInstallDirectory();

    try {
      await extractZipArchive(resolvedArchivePath, tempRootPath);

      const pluginSourceRootPath = await resolveExtractedPluginRootPath(tempRootPath);
      const manifestPath = path.join(pluginSourceRootPath, PLUGIN_MANIFEST_FILENAME);
      const manifest = parsePluginManifestText(await fs.readFile(manifestPath, "utf8"));

      if (manifest === null) {
        throw new Error(`plugin manifest が不正です: ${manifestPath}`);
      }

      await fs.mkdir(this.installRootPath, { recursive: true });

      const targetDirectoryName = sanitizePluginDirectoryName(manifest.id);
      const installedPluginPath = path.join(this.installRootPath, targetDirectoryName);

      assertPathInsideRoot(this.installRootPath, installedPluginPath);
      await fs.rm(installedPluginPath, { force: true, recursive: true });
      await fs.cp(pluginSourceRootPath, installedPluginPath, { force: true, recursive: true });

      const installedPlugin = await this.readPluginDirectory(installedPluginPath);

      if (!installedPlugin) {
        throw new Error(`plugin install 後の読込に失敗しました: ${manifest.id}`);
      }

      return {
        archivePath: resolvedArchivePath,
        installRootPath: this.installRootPath,
        plugin: installedPlugin.definition,
        targetDirectoryName
      };
    } finally {
      await fs.rm(tempRootPath, { force: true, recursive: true });
    }
  }

  async uninstallPlugin(pluginId: string): Promise<UninstallPluginResult> {
    const installedPlugin = await this.findPluginById(pluginId);
    const installedPluginPath =
      installedPlugin?.rootPath ?? path.join(this.installRootPath, sanitizePluginDirectoryName(pluginId));

    assertPathInsideRoot(this.installRootPath, installedPluginPath);

    if (!(await pathExists(installedPluginPath))) {
      return {
        installRootPath: this.installRootPath,
        installedPluginPath,
        pluginId,
        removed: false
      };
    }

    await fs.rm(installedPluginPath, { force: true, recursive: true });

    return {
      installRootPath: this.installRootPath,
      installedPluginPath,
      pluginId,
      removed: true
    };
  }

  private async getResolvedPlugins(): Promise<ResolvedInstalledPlugin[]> {
    const externalPlugins = await this.readPluginsFromRoot(this.installRootPath);
    return this.mergeResolvedPlugins(externalPlugins);
  }

  private async readPluginsFromRoot(rootPath: string): Promise<ResolvedInstalledPlugin[]> {
    let entries;

    try {
      entries = await fs.readdir(rootPath, { withFileTypes: true });
    } catch (error) {
      if (isMissingPathError(error)) {
        return [];
      }

      throw error;
    }

    const plugins = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => left.name.localeCompare(right.name, "ja"))
        .map((entry) => this.readPluginDirectory(path.join(rootPath, entry.name)))
    );

    return plugins.filter((plugin): plugin is ResolvedInstalledPlugin => plugin !== null);
  }

  private async readPluginDirectory(pluginRootPath: string): Promise<ResolvedInstalledPlugin | null> {
    const manifestPath = path.join(pluginRootPath, PLUGIN_MANIFEST_FILENAME);
    let content: string;

    try {
      content = await fs.readFile(manifestPath, "utf8");
    } catch (error) {
      if (isMissingPathError(error)) {
        return null;
      }

      throw error;
    }

    const manifest = parsePluginManifestText(content);

    if (manifest === null) {
      return null;
    }

    const normalizedManifest = normalizePluginManifest(manifest);

    return {
      definition: toInstalledPluginDefinition(normalizedManifest, "external", pluginRootPath),
      hostEntryPath: normalizedManifest.host
        ? path.join(pluginRootPath, ...normalizedManifest.host.entry.split("/"))
        : null,
      manifest: normalizedManifest,
      rendererEntryPath: normalizedManifest.renderer
        ? path.join(pluginRootPath, ...normalizedManifest.renderer.entry.split("/"))
        : null,
      rootPath: pluginRootPath
    };
  }

  private mergeResolvedPlugins(
    plugins: readonly ResolvedInstalledPlugin[]
  ): ResolvedInstalledPlugin[] {
    const merged: ResolvedInstalledPlugin[] = [];
    const seenPluginIds = new Set<string>();
    const seenBlockTypes = new Set<string>();

    for (const plugin of plugins) {
      if (seenPluginIds.has(plugin.definition.id)) {
        continue;
      }

      const filteredBlocks = plugin.manifest.blocks.filter((block) => !seenBlockTypes.has(block.type));

      if (filteredBlocks.length === 0) {
        continue;
      }

      filteredBlocks.forEach((block) => {
        seenBlockTypes.add(block.type);
      });
      seenPluginIds.add(plugin.definition.id);

      const manifest: PluginManifest = {
        ...plugin.manifest,
        blocks: filteredBlocks
      };

      merged.push({
        ...plugin,
        definition: toInstalledPluginDefinition(manifest, "external", plugin.rootPath),
        manifest
      });
    }

    return merged;
  }

  private async findPluginByBlockType(blockType: string): Promise<ResolvedInstalledPlugin | null> {
    const plugins = await this.getResolvedPlugins();

    for (const plugin of plugins) {
      if (plugin.manifest.blocks.some((block) => block.type === blockType)) {
        return plugin;
      }
    }

    return null;
  }

  private async findPluginById(pluginId: string): Promise<ResolvedInstalledPlugin | null> {
    const plugins = await this.getResolvedPlugins();

    return plugins.find((plugin) => plugin.definition.id === pluginId) ?? null;
  }

  private loadPluginHostRunner(hostEntryPath: string): PluginHostModule["runIntegralPluginAction"] {
    const resolvedHostPath = require.resolve(hostEntryPath);
    delete require.cache[resolvedHostPath];

    const loaded = require(resolvedHostPath) as unknown;
    const loadedRecord =
      typeof loaded === "object" && loaded !== null
        ? (loaded as Record<string, unknown>)
        : null;
    const directExport =
      loadedRecord?.[PLUGIN_HOST_MODULE_EXPORT] as PluginHostModule["runIntegralPluginAction"] | undefined;

    if (isPluginHostRunner(directExport)) {
      return directExport;
    }

    const defaultExport = loadedRecord?.default;

    if (isPluginHostRunner(defaultExport)) {
      return defaultExport;
    }

    if (
      typeof defaultExport === "object" &&
      defaultExport !== null &&
      isPluginHostRunner((defaultExport as Record<string, unknown>).runIntegralPluginAction)
    ) {
      return (defaultExport as Record<string, unknown>)
        .runIntegralPluginAction as PluginHostModule["runIntegralPluginAction"];
    }

    throw new Error(`plugin host export が不正です: ${hostEntryPath}`);
  }

  private async createTempInstallDirectory(): Promise<string> {
    const tempParentPath = path.join(path.dirname(this.installRootPath), ".plugin-install");
    await fs.mkdir(tempParentPath, { recursive: true });
    return fs.mkdtemp(path.join(tempParentPath, "extract-"));
  }
}

export function resolveInstalledPluginRootPath(userDataPath: string): string {
  return path.join(userDataPath, "plugins");
}

function normalizePluginManifest(manifest: PluginManifest): PluginManifest {
  if (manifest.id !== LEGACY_SHIMADZU_PLUGIN_ID && manifest.id !== SHIMADZU_PLUGIN_ID) {
    return manifest;
  }

  return {
    ...manifest,
    blocks: manifest.blocks.map((block) =>
      block.type === LEGACY_SHIMADZU_BLOCK_TYPE
        ? {
            ...block,
            title: "Run Sequence",
            type: SHIMADZU_BLOCK_TYPE
          }
        : block
    ),
    id: SHIMADZU_PLUGIN_ID,
    namespace: SHIMADZU_NAMESPACE
  };
}

async function resolveExtractedPluginRootPath(extractRootPath: string): Promise<string> {
  if (await pathExists(path.join(extractRootPath, PLUGIN_MANIFEST_FILENAME))) {
    return extractRootPath;
  }

  const entries = await fs.readdir(extractRootPath, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(extractRootPath, entry.name));
  const pluginRootPaths: string[] = [];

  for (const candidatePath of candidates) {
    if (await pathExists(path.join(candidatePath, PLUGIN_MANIFEST_FILENAME))) {
      pluginRootPaths.push(candidatePath);
    }
  }

  if (pluginRootPaths.length === 1) {
    return pluginRootPaths[0];
  }

  if (pluginRootPaths.length === 0) {
    throw new Error("zip 内に integral-plugin.json が見つかりません。");
  }

  throw new Error("zip 内に複数の plugin root が見つかりました。");
}

async function extractZipArchive(archivePath: string, destinationPath: string): Promise<void> {
  if (path.extname(archivePath).toLowerCase() !== ".zip") {
    throw new Error("plugin install は zip のみ対応しています。");
  }

  if (process.platform !== "win32") {
    throw new Error("zip install は現在 Windows のみ対応しています。");
  }

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

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function sanitizePluginDirectoryName(pluginId: string): string {
  const sanitized = pluginId.trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-");

  if (sanitized.length === 0) {
    throw new Error("plugin id から install directory 名を生成できません。");
  }

  return sanitized;
}

function toPowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function prepareRendererDocument(
  document: string,
  rendererDirectoryPath: string,
  pluginRootPath: string
): Promise<string> {
  const inlinedDocument = await inlineLocalAssetReferences(
    injectRendererBaseTag(document, rendererDirectoryPath),
    rendererDirectoryPath,
    pluginRootPath
  );

  return inlinedDocument;
}

function injectRendererBaseTag(document: string, rendererDirectoryPath: string): string {
  if (/<base\s/iu.test(document)) {
    return document;
  }

  const baseHref = escapeHtmlAttribute(pathToFileURL(`${rendererDirectoryPath}${path.sep}`).href);
  const baseTag = `<base href="${baseHref}">`;

  if (/<head(\s[^>]*)?>/iu.test(document)) {
    return document.replace(/<head(\s[^>]*)?>/iu, (match) => `${match}\n    ${baseTag}`);
  }

  if (/<html(\s[^>]*)?>/iu.test(document)) {
    return document.replace(/<html(\s[^>]*)?>/iu, (match) => `${match}\n  <head>${baseTag}</head>`);
  }

  return `${baseTag}\n${document}`;
}

async function inlineLocalAssetReferences(
  document: string,
  rendererDirectoryPath: string,
  pluginRootPath: string
): Promise<string> {
  const assetCache = new Map<string, Promise<string>>();
  let nextDocument = document;

  nextDocument = await replaceAsync(
    nextDocument,
    /\b(src|href|poster)=("([^"]+)"|'([^']+)')/giu,
    async (match, attributeName: string, quotedValue: string, doubleQuotedValue: string, singleQuotedValue: string) => {
      const assetPath = doubleQuotedValue || singleQuotedValue;
      const dataUrl = await tryReadAssetAsDataUrl(
        assetPath,
        rendererDirectoryPath,
        pluginRootPath,
        assetCache
      );

      if (dataUrl === null) {
        return match;
      }

      const quote = quotedValue.startsWith("'") ? "'" : '"';
      return `${attributeName}=${quote}${dataUrl}${quote}`;
    }
  );

  nextDocument = await replaceAsync(
    nextDocument,
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/giu,
    async (match, _quote: string, assetPath: string) => {
      const dataUrl = await tryReadAssetAsDataUrl(
        assetPath,
        rendererDirectoryPath,
        pluginRootPath,
        assetCache
      );

      if (dataUrl === null) {
        return match;
      }

      return `url("${dataUrl}")`;
    }
  );

  return nextDocument;
}

async function tryReadAssetAsDataUrl(
  assetPath: string,
  rendererDirectoryPath: string,
  pluginRootPath: string,
  assetCache: Map<string, Promise<string>>
): Promise<string | null> {
  if (!shouldInlineAssetReference(assetPath)) {
    return null;
  }

  const normalizedAssetPath = assetPath.split(/[?#]/u, 1)[0];

  if (normalizedAssetPath.length === 0) {
    return null;
  }

  const resolvedAssetPath = path.resolve(rendererDirectoryPath, normalizedAssetPath);

  try {
    assertPathInsideRoot(pluginRootPath, resolvedAssetPath);
  } catch {
    return null;
  }

  if (!(await pathExists(resolvedAssetPath))) {
    return null;
  }

  let pendingDataUrl = assetCache.get(resolvedAssetPath);

  if (!pendingDataUrl) {
    pendingDataUrl = fs.readFile(resolvedAssetPath).then((buffer) => {
      const mimeType = inferMimeType(resolvedAssetPath);
      return `data:${mimeType};base64,${buffer.toString("base64")}`;
    });
    assetCache.set(resolvedAssetPath, pendingDataUrl);
  }

  return await pendingDataUrl;
}

function shouldInlineAssetReference(assetPath: string): boolean {
  const trimmed = assetPath.trim();

  if (trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith("//")) {
    return false;
  }

  return !/^(?:[a-z][a-z0-9+\-.]*:|[a-z]:[\\/])/iu.test(trimmed);
}

function inferMimeType(assetPath: string): string {
  switch (path.extname(assetPath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".ico":
      return "image/x-icon";
    case ".css":
      return "text/css";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "text/javascript";
    case ".json":
      return "application/json";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".ttf":
      return "font/ttf";
    case ".otf":
      return "font/otf";
    default:
      return "application/octet-stream";
  }
}

async function replaceAsync(
  input: string,
  pattern: RegExp,
  replacer: (...args: string[]) => Promise<string>
): Promise<string> {
  const matches = [...input.matchAll(pattern)];

  if (matches.length === 0) {
    return input;
  }

  let cursor = 0;
  let output = "";

  for (const match of matches) {
    const matchText = match[0];
    const matchIndex = match.index ?? 0;
    output += input.slice(cursor, matchIndex);
    output += await replacer(...(match as unknown as string[]));
    cursor = matchIndex + matchText.length;
  }

  output += input.slice(cursor);
  return output;
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
    throw new Error(`plugin install path が不正です: ${resolvedTargetPath}`);
  }
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isPluginHostRunner(
  value: unknown
): value is PluginHostModule["runIntegralPluginAction"] {
  return typeof value === "function";
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}


