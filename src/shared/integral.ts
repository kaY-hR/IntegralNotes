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
  canOpenDataNote: boolean;
  createdByBlockId: string | null;
  displayName: string;
  entityType: IntegralManagedDataEntityType;
  format: string | null;
  hash: string;
  id: string;
  noteTargetId?: string;
  path: string;
  representation: IntegralManagedFileRepresentation;
  visibility: IntegralManagedDataVisibility;
}

export interface IntegralDatasetSummary {
  canOpenDataNote: boolean;
  createdAt: string;
  createdByBlockId: string | null;
  datasetId: string;
  hash: string;
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
const OUTPUT_PATH_SUFFIX_BASE = 36 ** 3;

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

export function createIntegralOutputPathRandomSuffix(): string {
  return Math.floor(Math.random() * OUTPUT_PATH_SUFFIX_BASE)
    .toString(36)
    .padStart(3, "0")
    .toUpperCase();
}

export function createDefaultIntegralOutputPath(
  slot: IntegralSlotDefinition,
  suffix = ""
): string {
  const extension = getIntegralSlotPrimaryExtension(slot, ".idts") ?? ".idts";
  const stem = slot.name.trim().length > 0 ? slot.name.trim() : "output";
  const normalizedSuffix = suffix.trim().replace(/^_+/u, "");
  const suffixSegment = normalizedSuffix.length > 0 ? `_${normalizedSuffix}` : "";
  return `${DEFAULT_OUTPUT_DIRECTORY}/${stem}${suffixSegment}${extension}`;
}

export function createDefaultIntegralOutputPathWithRandomSuffix(
  slot: IntegralSlotDefinition
): string {
  return createDefaultIntegralOutputPath(slot, createIntegralOutputPathRandomSuffix());
}
