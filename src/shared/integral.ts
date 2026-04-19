import type {
  InstalledPluginOrigin,
  PluginActionContribution,
  ResolvedPluginViewer
} from "./plugins";

export interface IntegralSlotDefinition {
  acceptedKinds?: string[];
  autoInsertToWorkNote?: boolean;
  embedToSharedNote?: boolean;
  extension?: string;
  extensions?: string[];
  format?: string;
  name: string;
  shareNoteWithInput?: string;
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
export type IntegralManagedDataEntityType = "managed-file" | "dataset";
export type IntegralManagedDataTrackingIssueKind = "missing" | "relink";
export type IntegralManagedFileContentRepresentation = "directory" | "file";
export type IntegralDatasetRepresentation = "dataset-json";
export type IntegralManagedFileRepresentation =
  | IntegralManagedFileContentRepresentation
  | IntegralDatasetRepresentation;

export interface IntegralManagedFileSummary {
  createdAt: string;
  createdByBlockId: string | null;
  displayName: string;
  entityType: IntegralManagedDataEntityType;
  format: string | null;
  hash: string;
  hasDataNote: boolean;
  id: string;
  noteTargetId?: string;
  path: string;
  representation: IntegralManagedFileRepresentation;
  visibility: IntegralManagedDataVisibility;
}

export interface IntegralDatasetSummary {
  createdAt: string;
  createdByBlockId: string | null;
  datasetId: string;
  hash: string;
  hasDataNote: boolean;
  hasRenderableFiles: boolean;
  kind: string;
  memberIds?: string[];
  name: string;
  noteTargetId?: string;
  path: string;
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
  managedFiles: IntegralManagedFileSummary[];
}

export interface IntegralManagedDataTrackingIssue {
  candidatePaths: string[];
  displayName: string;
  entityType: IntegralManagedDataEntityType;
  kind: IntegralManagedDataTrackingIssueKind;
  recordedHash: string;
  recordedPath: string;
  representation: IntegralManagedFileRepresentation;
  targetId: string;
}

export interface ResolveIntegralManagedDataTrackingIssueRequest {
  action: "remove" | "relink";
  entityType: IntegralManagedDataEntityType;
  selectedPath?: string;
  targetId: string;
}

export interface ImportManagedFilesResult {
  managedFiles: IntegralManagedFileSummary[];
}

export interface CreateDatasetRequest {
  managedFileIds: string[];
  name?: string;
}

export interface CreateDatasetFromWorkspaceEntriesRequest {
  name?: string;
  relativePaths: string[];
}

export interface CreateDatasetResult {
  dataset: IntegralDatasetSummary;
}

export interface ExecuteIntegralBlockRequest {
  block: IntegralBlockDocument;
  sourceNotePath?: string | null;
}

export interface ExecuteIntegralBlockResult {
  block: IntegralBlockDocument;
  createdDatasets: IntegralDatasetSummary[];
  finishedAt: string;
  logLines: string[];
  startedAt: string;
  status: "success";
  summary: string;
  workNoteMarkdownToAppend: string | null;
}

const DEFAULT_OUTPUT_DIRECTORY = "/Data";
const EXTERNAL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/u;

export function normalizeIntegralSlotExtension(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().toLowerCase();

  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

export function normalizeIntegralSlotExtensions(
  values: readonly string[] | null | undefined
): string[] | undefined {
  if (!values) {
    return undefined;
  }

  const normalized = Array.from(
    new Set(
      values
        .map((value) => normalizeIntegralSlotExtension(value))
        .filter((value): value is string => value !== null)
    )
  );

  return normalized.length > 0 ? normalized : undefined;
}

export function getIntegralSlotPrimaryExtension(
  slot: Pick<IntegralSlotDefinition, "extension" | "extensions">,
  fallback: string | null = null
): string | null {
  const direct = normalizeIntegralSlotExtension(slot.extension);

  if (direct) {
    return direct;
  }

  const listed = normalizeIntegralSlotExtensions(slot.extensions)?.[0] ?? null;
  return listed ?? normalizeIntegralSlotExtension(fallback);
}

export function isIntegralBundleExtension(value: string | null | undefined): boolean {
  return normalizeIntegralSlotExtension(value) === ".idts";
}

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
