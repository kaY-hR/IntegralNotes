interface JsonRecord {
  [key: string]: unknown;
}

export const PLUGIN_API_VERSION = "1";
export const PLUGIN_MANIFEST_FILENAME = "integral-plugin.json";
export const PLUGIN_RUNNER_PROTOCOL_VERSION = "1";

export type InstalledPluginOrigin = "builtin" | "external";

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

export interface PluginExecutableContribution {
  entry: string;
  protocolVersion: typeof PLUGIN_RUNNER_PROTOCOL_VERSION;
}

export interface PluginManifest {
  apiVersion: typeof PLUGIN_API_VERSION;
  blocks: PluginBlockContribution[];
  description: string;
  displayName: string;
  executable?: PluginExecutableContribution;
  id: string;
  namespace: string;
  renderer?: PluginRendererContribution;
  version: string;
}

export interface InstalledPluginSummary {
  blocks: string[];
  displayName: string;
  id: string;
  namespace: string;
  origin: InstalledPluginOrigin;
  sourcePath: string | null;
  version: string;
}

export const BUILTIN_PLUGIN_MANIFESTS = [
  {
    apiVersion: PLUGIN_API_VERSION,
    blocks: [
      {
        actions: [
          {
            busyLabel: "装置操作を送信中...",
            id: "execute",
            label: "装置操作を実行"
          }
        ],
        description: "勾配プログラムを可視化し、実行要求を main process へ渡します。",
        title: "LC Gradient",
        type: "LC.Method.Gradient"
      }
    ],
    description: "IntegralNotes 組み込みの LC 系 block 群です。",
    displayName: "IntegralNotes LC",
    id: "integralnotes.builtin.lc",
    namespace: "LC",
    version: "0.1.0"
  },
  {
    apiVersion: PLUGIN_API_VERSION,
    blocks: [
      {
        actions: [
          {
            busyLabel: "解析ジョブを起動中...",
            id: "analyze",
            label: "解析を実行"
          }
        ],
        description: "対象データを確認し、クロマトグラム解析要求を main process へ渡します。",
        title: "Chromatogram",
        type: "StandardGraphs.Chromatogram"
      }
    ],
    description: "IntegralNotes 組み込みのグラフ系 block 群です。",
    displayName: "IntegralNotes Standard Graphs",
    id: "integralnotes.builtin.standard-graphs",
    namespace: "StandardGraphs",
    version: "0.1.0"
  }
] as const satisfies readonly PluginManifest[];

export function findPluginBlockContribution(
  manifests: readonly PluginManifest[],
  blockType: string
): PluginBlockContribution | null {
  for (const manifest of manifests) {
    for (const block of manifest.blocks) {
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
  const renderer = parsePluginRendererContribution(manifest.renderer);
  const executable = parsePluginExecutableContribution(manifest.executable);

  if (blocks === null || blocks.length === 0 || renderer === null || executable === null) {
    return null;
  }

  return {
    apiVersion: PLUGIN_API_VERSION,
    blocks,
    description,
    displayName,
    executable: executable ?? undefined,
    id,
    namespace,
    renderer: renderer ?? undefined,
    version
  };
}

export function parsePluginManifestText(content: string): PluginManifest | null {
  try {
    return parsePluginManifest(JSON.parse(content));
  } catch {
    return null;
  }
}

export function toInstalledPluginSummary(
  manifest: PluginManifest,
  origin: InstalledPluginOrigin,
  sourcePath: string | null
): InstalledPluginSummary {
  return {
    blocks: manifest.blocks.map((block) => block.type),
    displayName: manifest.displayName,
    id: manifest.id,
    namespace: manifest.namespace,
    origin,
    sourcePath,
    version: manifest.version
  };
}

function parsePluginBlocks(value: unknown, namespace: string): PluginBlockContribution[] | null {
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
    !type.startsWith(`${namespace}.`)
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

function parsePluginExecutableContribution(value: unknown): PluginExecutableContribution | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isJsonRecord(value)) {
    return null;
  }

  const entry = readRelativeAssetPath(value.entry);
  const protocolVersion = readNonEmptyString(value.protocolVersion);

  if (entry === null || protocolVersion !== PLUGIN_RUNNER_PROTOCOL_VERSION) {
    return null;
  }

  return {
    entry,
    protocolVersion: PLUGIN_RUNNER_PROTOCOL_VERSION
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

  if (
    normalizedSegments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
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

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
