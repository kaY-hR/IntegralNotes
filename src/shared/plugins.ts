interface JsonRecord {
  [key: string]: unknown;
}

export const PLUGIN_API_VERSION = "1";
export const PLUGIN_HOST_MODULE_EXPORT = "runIntegralPluginAction";
export const PLUGIN_HOST_RUNTIME = "module";
export const PLUGIN_MANIFEST_FILENAME = "integral-plugin.json";
export const PLUGIN_RENDER_SET_BLOCK_MESSAGE_TYPE = "integral:set-block";
export const PLUGIN_RENDER_SET_VIEWER_MESSAGE_TYPE = "integral:set-viewer";
export const PLUGIN_RENDER_UPDATE_PARAMS_MESSAGE_TYPE = "integral:update-params";
export const PLUGIN_RENDER_REQUEST_ACTION_MESSAGE_TYPE = "integral:request-action";
export const PLUGIN_RENDER_ACTION_STATE_MESSAGE_TYPE = "integral:action-state";
export const PLUGIN_RENDER_MESSAGE_TYPE = PLUGIN_RENDER_SET_BLOCK_MESSAGE_TYPE;

export type InstalledPluginOrigin = "external";

export interface PluginActionContribution {
  busyLabel: string;
  id: string;
  label: string;
}

export interface PluginBlockContribution {
  actions?: PluginActionContribution[];
  description: string;
  title: string;
  type: string;
}

export interface PluginRendererContribution {
  entry: string;
  mode: "iframe";
}

export interface PluginViewerContribution {
  description: string;
  displayName: string;
  extensions: string[];
  id: string;
  renderer: PluginRendererContribution;
}

export interface PluginHostContribution {
  entry: string;
  runtime: typeof PLUGIN_HOST_RUNTIME;
}

export interface PluginManifest {
  apiVersion: typeof PLUGIN_API_VERSION;
  blocks?: PluginBlockContribution[];
  description: string;
  displayName: string;
  host?: PluginHostContribution;
  id: string;
  namespace: string;
  renderer?: PluginRendererContribution;
  version: string;
  viewers?: PluginViewerContribution[];
}

export interface InstalledPluginViewerDefinition {
  description: string;
  displayName: string;
  extensions: string[];
  id: string;
}

export interface InstalledPluginDefinition {
  blocks: PluginBlockContribution[];
  description: string;
  displayName: string;
  hasHost: boolean;
  hasRenderer: boolean;
  id: string;
  namespace: string;
  origin: InstalledPluginOrigin;
  sourcePath: string | null;
  version: string;
  viewers: InstalledPluginViewerDefinition[];
}

export interface PluginRendererBlock extends JsonRecord {
  params?: Record<string, unknown>;
  type: string;
}

export interface PluginRendererModel {
  block: PluginRendererBlock;
  blockDefinition: PluginBlockContribution;
  plugin: Pick<
    InstalledPluginDefinition,
    "description" | "displayName" | "id" | "namespace" | "origin" | "version"
  >;
}

export interface PluginRenderSetBlockMessage {
  payload: PluginRendererModel;
  type: typeof PLUGIN_RENDER_SET_BLOCK_MESSAGE_TYPE;
}

export type PluginViewerDataEncoding = "data-url" | "text";
export type PluginViewerPresentation = "embed" | "full";

export type PluginViewerFileSource =
  | {
      kind: "dataset-file";
      datasetId: string;
      datasetName: string;
    }
  | {
      kind: "workspace-file";
    };

export interface PluginViewerFileModel {
  data: string;
  dataEncoding: PluginViewerDataEncoding;
  mediaType: string;
  name: string;
  relativePath: string;
  source: PluginViewerFileSource;
}

export interface PluginViewerRendererModel {
  file: PluginViewerFileModel;
  presentation: PluginViewerPresentation;
  plugin: Pick<
    InstalledPluginDefinition,
    "description" | "displayName" | "id" | "namespace" | "origin" | "version"
  >;
  viewer: Pick<InstalledPluginViewerDefinition, "description" | "displayName" | "extensions" | "id">;
}

export interface PluginRenderSetViewerMessage {
  payload: PluginViewerRendererModel;
  type: typeof PLUGIN_RENDER_SET_VIEWER_MESSAGE_TYPE;
}

export interface PluginRenderUpdateParamsPayload {
  params: Record<string, unknown>;
}

export interface PluginRenderUpdateParamsMessage {
  payload: PluginRenderUpdateParamsPayload;
  type: typeof PLUGIN_RENDER_UPDATE_PARAMS_MESSAGE_TYPE;
}

export interface PluginRenderRequestActionPayload {
  actionId: string;
}

export interface PluginRenderRequestActionMessage {
  payload: PluginRenderRequestActionPayload;
  type: typeof PLUGIN_RENDER_REQUEST_ACTION_MESSAGE_TYPE;
}

export type PluginRenderActionStatus = "error" | "idle" | "running" | "success";

export interface PluginRenderActionStatePayload {
  actionId: string | null;
  finishedAt: string | null;
  logLines: string[];
  startedAt: string | null;
  status: PluginRenderActionStatus;
  summary: string | null;
}

export interface PluginRenderActionStateMessage {
  payload: PluginRenderActionStatePayload;
  type: typeof PLUGIN_RENDER_ACTION_STATE_MESSAGE_TYPE;
}

export interface PluginHostActionContext {
  actionId: string;
  blockType: string;
  params?: Record<string, unknown>;
  payload: string;
  plugin: InstalledPluginDefinition;
}

export interface PluginHostActionResult {
  logLines: string[];
  summary: string;
}

export interface PluginHostModule {
  runIntegralPluginAction: (
    context: PluginHostActionContext
  ) => Promise<PluginHostActionResult> | PluginHostActionResult;
}

export interface ResolvedPluginViewer {
  dataEncoding: PluginViewerDataEncoding;
  mediaType: string;
  pluginDescription: string;
  pluginDisplayName: string;
  pluginId: string;
  pluginNamespace: string;
  pluginVersion: string;
  viewerDescription: string;
  viewerDisplayName: string;
  viewerExtensions: string[];
  viewerId: string;
}

export function findInstalledPluginBlock(
  plugins: readonly InstalledPluginDefinition[],
  blockType: string
): { block: PluginBlockContribution; plugin: InstalledPluginDefinition } | null {
  for (const plugin of plugins) {
    const block = plugin.blocks.find((candidate) => candidate.type === blockType);

    if (block) {
      return {
        block,
        plugin
      };
    }
  }

  return null;
}

export function findInstalledPluginViewerByExtension(
  plugins: readonly InstalledPluginDefinition[],
  extension: string
): { plugin: InstalledPluginDefinition; viewer: InstalledPluginViewerDefinition } | null {
  const normalizedExtension = normalizePluginViewerExtension(extension);

  if (normalizedExtension === null) {
    return null;
  }

  for (const plugin of plugins) {
    const viewer = plugin.viewers.find((candidate) =>
      candidate.extensions.includes(normalizedExtension)
    );

    if (viewer) {
      return {
        plugin,
        viewer
      };
    }
  }

  return null;
}

export function findPluginBlockContribution(
  manifests: readonly PluginManifest[],
  blockType: string
): PluginBlockContribution | null {
  for (const manifest of manifests) {
    for (const block of manifest.blocks ?? []) {
      if (block.type === blockType) {
        return block;
      }
    }
  }

  return null;
}

export function parsePluginManifest(manifest: unknown): PluginManifest | null {
  if (!isJsonRecord(manifest)) {
    return null;
  }

  const apiVersion = readNonEmptyString(manifest.apiVersion);
  const id = readNonEmptyString(manifest.id);
  const namespace = readNonEmptyString(manifest.namespace);
  const displayName = readNonEmptyString(manifest.displayName);
  const description = readNonEmptyString(manifest.description);
  const version = readNonEmptyString(manifest.version);

  if (
    apiVersion !== PLUGIN_API_VERSION ||
    id === null ||
    namespace === null ||
    displayName === null ||
    description === null ||
    version === null
  ) {
    return null;
  }

  const blocks = parsePluginBlocks(manifest.blocks, namespace);
  const viewers = parsePluginViewers(manifest.viewers);
  const renderer = parsePluginRendererContribution(manifest.renderer);
  const host = parsePluginHostContribution(manifest.host);

  if (
    blocks === null ||
    viewers === null ||
    renderer === null ||
    host === null ||
    (blocks.length === 0 && viewers.length === 0)
  ) {
    return null;
  }

  return {
    apiVersion: PLUGIN_API_VERSION,
    blocks,
    description,
    displayName,
    host: host ?? undefined,
    id,
    namespace,
    renderer: renderer ?? undefined,
    version,
    viewers: viewers.length > 0 ? viewers : undefined
  };
}

export function parsePluginManifestText(content: string): PluginManifest | null {
  try {
    return parsePluginManifest(JSON.parse(content));
  } catch {
    return null;
  }
}

export function toInstalledPluginDefinition(
  manifest: PluginManifest,
  origin: InstalledPluginOrigin,
  sourcePath: string | null
): InstalledPluginDefinition {
  return {
    blocks: (manifest.blocks ?? []).map((block) => ({
      actions: block.actions?.map((action) => ({ ...action })),
      description: block.description,
      title: block.title,
      type: block.type
    })),
    description: manifest.description,
    displayName: manifest.displayName,
    hasHost: manifest.host !== undefined,
    hasRenderer: manifest.renderer !== undefined,
    id: manifest.id,
    namespace: manifest.namespace,
    origin,
    sourcePath,
    version: manifest.version,
    viewers: (manifest.viewers ?? []).map((viewer) => ({
      description: viewer.description,
      displayName: viewer.displayName,
      extensions: [...viewer.extensions],
      id: viewer.id
    }))
  };
}

function parsePluginBlocks(value: unknown, namespace: string): PluginBlockContribution[] | null {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const blocks: PluginBlockContribution[] = [];
  const seenTypes = new Set<string>();

  for (const item of value) {
    const block = parsePluginBlockContribution(item, namespace);

    if (block === null || seenTypes.has(block.type)) {
      return null;
    }

    seenTypes.add(block.type);
    blocks.push(block);
  }

  return blocks;
}

function parsePluginViewers(value: unknown): PluginViewerContribution[] | null {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const viewers: PluginViewerContribution[] = [];
  const seenIds = new Set<string>();
  const seenExtensions = new Set<string>();

  for (const item of value) {
    const viewer = parsePluginViewerContribution(item);

    if (viewer === null || seenIds.has(viewer.id)) {
      return null;
    }

    for (const extension of viewer.extensions) {
      if (seenExtensions.has(extension)) {
        return null;
      }

      seenExtensions.add(extension);
    }

    seenIds.add(viewer.id);
    viewers.push(viewer);
  }

  return viewers;
}

function parsePluginBlockContribution(value: unknown, namespace: string): PluginBlockContribution | null {
  if (!isJsonRecord(value)) {
    return null;
  }

  const type = readNonEmptyString(value.type);
  const title = readNonEmptyString(value.title);
  const description = readNonEmptyString(value.description);
  const actions = parsePluginActionContributions(value.actions);

  if (
    type === null ||
    title === null ||
    description === null ||
    actions === null ||
    !isValidPluginBlockType(type, namespace)
  ) {
    return null;
  }

  return {
    actions: actions.length > 0 ? actions : undefined,
    description,
    title,
    type
  };
}

function parsePluginViewerContribution(value: unknown): PluginViewerContribution | null {
  if (!isJsonRecord(value)) {
    return null;
  }

  const id = readNonEmptyString(value.id);
  const displayName = readNonEmptyString(value.displayName);
  const description = readNonEmptyString(value.description);
  const extensions = parsePluginViewerExtensions(value.extensions);
  const renderer = parsePluginRendererContribution(value.renderer);

  if (
    id === null ||
    displayName === null ||
    description === null ||
    extensions === null ||
    extensions.length === 0 ||
    renderer === null ||
    renderer === undefined ||
    !isValidPluginViewerId(id)
  ) {
    return null;
  }

  return {
    description,
    displayName,
    extensions,
    id,
    renderer
  };
}

function isValidPluginBlockType(type: string, namespace: string): boolean {
  if (type.startsWith(`${namespace}.`)) {
    return true;
  }

  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(type);
}

function isValidPluginViewerId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(id);
}

function parsePluginViewerExtensions(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const extensions: string[] = [];
  const seenExtensions = new Set<string>();

  for (const item of value) {
    const extension = normalizePluginViewerExtension(item);

    if (extension === null || seenExtensions.has(extension)) {
      return null;
    }

    seenExtensions.add(extension);
    extensions.push(extension);
  }

  return extensions;
}

function parsePluginActionContributions(value: unknown): PluginActionContribution[] | null {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const actions: PluginActionContribution[] = [];
  const seenIds = new Set<string>();

  for (const item of value) {
    if (!isJsonRecord(item)) {
      return null;
    }

    const id = readNonEmptyString(item.id);
    const label = readNonEmptyString(item.label);
    const busyLabel = readNonEmptyString(item.busyLabel);

    if (id === null || label === null || busyLabel === null || seenIds.has(id)) {
      return null;
    }

    seenIds.add(id);
    actions.push({
      busyLabel,
      id,
      label
    });
  }

  return actions;
}

function parsePluginRendererContribution(value: unknown): PluginRendererContribution | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isJsonRecord(value)) {
    return null;
  }

  const entry = readRelativeAssetPath(value.entry);
  const mode = readNonEmptyString(value.mode);

  if (entry === null || mode !== "iframe") {
    return null;
  }

  return {
    entry,
    mode: "iframe"
  };
}

function parsePluginHostContribution(value: unknown): PluginHostContribution | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isJsonRecord(value)) {
    return null;
  }

  const entry = readRelativeAssetPath(value.entry);
  const runtime = readNonEmptyString(value.runtime);

  if (entry === null || runtime !== PLUGIN_HOST_RUNTIME) {
    return null;
  }

  return {
    entry,
    runtime: PLUGIN_HOST_RUNTIME
  };
}

function readRelativeAssetPath(value: unknown): string | null {
  const entry = readNonEmptyString(value);

  if (
    entry === null ||
    entry.startsWith("/") ||
    entry.startsWith("\\") ||
    /^[A-Za-z]:/u.test(entry)
  ) {
    return null;
  }

  const normalizedSegments = entry.split(/[\\/]+/u);

  if (normalizedSegments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return null;
  }

  return normalizedSegments.join("/");
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function normalizePluginViewerExtension(value: unknown): string | null {
  const extension = readNonEmptyString(value);

  if (extension === null) {
    return null;
  }

  const normalized = extension.toLowerCase();

  if (!/^\.[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(normalized)) {
    return null;
  }

  return normalized;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}


