import type {
  InstalledPluginOrigin,
  PluginActionContribution,
  ResolvedPluginViewer
} from "./plugins";

export interface IntegralSlotDefinition {
  acceptedKinds?: string[];
  name: string;
  producedKind?: string;
}

export interface IntegralBlockOutputConfig {
  directory: string;
  name: string;
}

export interface IntegralExternalPluginDefinition {
  actions?: PluginActionContribution[];
  namespace: string;
  origin: InstalledPluginOrigin;
  rendererMode?: "iframe";
  runtimeBlockType: string;
  runtimePluginId: string;
  version: string;
}

export interface IntegralBlockDocument extends Record<string, unknown> {
  "block-type": string;
  id?: string;
  inputs: Record<string, string | null>;
  outputs: Record<string, string | null>;
  outputConfigs: Record<string, IntegralBlockOutputConfig | null>;
  params: Record<string, unknown>;
  plugin: string;
}

export interface IntegralBlockTypeDefinition {
  blockType: string;
  description: string;
  externalPlugin?: IntegralExternalPluginDefinition;
  executionMode: "display" | "manual";
  inputSlots: IntegralSlotDefinition[];
  outputSlots: IntegralSlotDefinition[];
  pluginDescription: string;
  pluginDisplayName: string;
  pluginId: string;
  source: "builtin" | "external-plugin" | "python-callable";
  title: string;
}

export type IntegralManagedDataVisibility = "visible" | "hidden";
export type IntegralManagedDataProvenance = "source" | "derived";
export type IntegralManagedDataEntityType = "original-data" | "dataset";
export type IntegralManagedDataTrackingIssueKind = "missing" | "relink";
export type IntegralOriginalDataRepresentation = "directory" | "file";
export type IntegralDatasetRepresentation = "dataset-json";

export interface IntegralOriginalDataSummary {
  createdAt: string;
  displayName: string;
  hash: string;
  originalDataId: string;
  path: string;
  provenance: IntegralManagedDataProvenance;
  representation: IntegralOriginalDataRepresentation;
  visibility: IntegralManagedDataVisibility;
}

export interface IntegralDatasetSummary {
  createdAt: string;
  createdByBlockId: string | null;
  datasetId: string;
  hash: string;
  hasRenderableFiles: boolean;
  kind: string;
  memberIds?: string[];
  name: string;
  path: string;
  provenance: IntegralManagedDataProvenance;
  representation: IntegralDatasetRepresentation;
  renderableCount: number;
  visibility: IntegralManagedDataVisibility;
}

export interface IntegralRenderableFile {
  data: string;
  kind: "html" | "image" | "plugin" | "text";
  name: string;
  pluginViewer?: ResolvedPluginViewer;
  relativePath: string;
}

export interface IntegralDatasetInspection extends IntegralDatasetSummary {
  fileNames: string[];
  renderables: IntegralRenderableFile[];
}

export interface IntegralAssetCatalog {
  datasets: IntegralDatasetSummary[];
  blockTypes: IntegralBlockTypeDefinition[];
  originalData: IntegralOriginalDataSummary[];
}

export interface IntegralManagedDataTrackingIssue {
  candidatePaths: string[];
  displayName: string;
  entityType: IntegralManagedDataEntityType;
  kind: IntegralManagedDataTrackingIssueKind;
  recordedHash: string;
  recordedPath: string;
  representation: IntegralOriginalDataRepresentation | IntegralDatasetRepresentation;
  targetId: string;
}

export interface ResolveIntegralManagedDataTrackingIssueRequest {
  action: "remove" | "relink";
  entityType: IntegralManagedDataEntityType;
  selectedPath?: string;
  targetId: string;
}

export interface ImportOriginalDataResult {
  originalData: IntegralOriginalDataSummary[];
}

export interface CreateSourceDatasetRequest {
  originalDataIds: string[];
  name?: string;
}

export interface CreateSourceDatasetFromWorkspaceEntriesRequest {
  name?: string;
  relativePaths: string[];
}

export interface CreateSourceDatasetResult {
  dataset: IntegralDatasetSummary;
}

export interface ExecuteIntegralBlockRequest {
  block: IntegralBlockDocument;
}

export interface ExecuteIntegralBlockResult {
  block: IntegralBlockDocument;
  createdDatasets: IntegralDatasetSummary[];
  finishedAt: string;
  logLines: string[];
  startedAt: string;
  status: "success";
  summary: string;
}

const DEFAULT_OUTPUT_DIRECTORY = "/Data";
const EXTERNAL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/u;

export function createDefaultIntegralBlockOutputConfig(
  slotName: string,
  latestOutputReference?: string | null
): IntegralBlockOutputConfig {
  const manifestTarget = parseIntegralOutputManifestReference(latestOutputReference);

  if (manifestTarget) {
    return manifestTarget;
  }

  return {
    directory: DEFAULT_OUTPUT_DIRECTORY,
    name: slotName
  };
}

export function normalizeIntegralBlockOutputConfig(
  value: Partial<IntegralBlockOutputConfig> | null | undefined,
  slotName: string,
  latestOutputReference?: string | null
): IntegralBlockOutputConfig {
  const defaults = createDefaultIntegralBlockOutputConfig(slotName, latestOutputReference);
  const normalizedDirectory =
    typeof value?.directory === "string"
      ? normalizeIntegralOutputDirectory(value.directory)
      : null;

  return {
    directory: normalizedDirectory ?? defaults.directory,
    name: typeof value?.name === "string" ? value.name : defaults.name
  };
}

export function normalizeIntegralOutputDirectory(value: string): string | null {
  const trimmed = value.trim().replace(/\\/gu, "/");

  if (trimmed.length === 0 || trimmed === "/") {
    return trimmed === "/" ? "/" : null;
  }

  if (
    trimmed.startsWith("#") ||
    trimmed.startsWith("//") ||
    trimmed.includes("?") ||
    trimmed.includes("#") ||
    EXTERNAL_SCHEME_PATTERN.test(trimmed)
  ) {
    return null;
  }

  let normalized = trimmed;

  if (normalized.startsWith("/")) {
    normalized = normalized.slice(1);
  }

  if (normalized.startsWith("./")) {
    normalized = normalized.replace(/^\.\/+/u, "");
  }

  const parts = normalized
    .split(/[\\/]+/u)
    .filter(Boolean);

  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    return null;
  }

  return `/${parts.join("/")}`;
}

export function toIntegralOutputDirectoryRelativePath(value: string): string | null {
  const normalized = normalizeIntegralOutputDirectory(value);

  if (normalized === null) {
    return null;
  }

  return normalized === "/" ? "" : normalized.slice(1);
}

export function parseIntegralOutputManifestReference(
  value: string | null | undefined
): IntegralBlockOutputConfig | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().replace(/\\/gu, "/");

  if (
    trimmed.length === 0 ||
    trimmed.toLowerCase() === "auto" ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("//") ||
    trimmed.includes("?") ||
    trimmed.includes("#") ||
    EXTERNAL_SCHEME_PATTERN.test(trimmed)
  ) {
    return null;
  }

  let normalized = trimmed;

  if (normalized.startsWith("/")) {
    normalized = normalized.slice(1);
  }

  if (normalized.startsWith("./")) {
    normalized = normalized.replace(/^\.\/+/u, "");
  }

  const parts = normalized
    .split(/[\\/]+/u)
    .filter(Boolean);

  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    return null;
  }

  const fileName = parts[parts.length - 1] ?? "";

  if (!fileName.toLowerCase().endsWith(".idts")) {
    return null;
  }

  const directoryParts = parts.slice(0, -1);

  return {
    directory: directoryParts.length === 0 ? "/" : `/${directoryParts.join("/")}`,
    name: fileName.slice(0, -".idts".length)
  };
}


