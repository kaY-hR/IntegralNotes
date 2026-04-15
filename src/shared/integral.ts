import type {
  InstalledPluginOrigin,
  PluginActionContribution
} from "./plugins";

export interface IntegralSlotDefinition {
  acceptedKinds?: string[];
  name: string;
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
  source: "builtin" | "external-plugin" | "python-script";
  title: string;
}

export type IntegralManagedDataVisibility = "visible" | "hidden";
export type IntegralManagedDataProvenance = "source" | "derived";
export type IntegralManagedDataEntityType = "original-data" | "dataset";
export type IntegralOriginalDataRepresentation = "directory" | "file";
export type IntegralDatasetRepresentation = "dataset-json" | "directory";

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
  kind: "html" | "image" | "text";
  name: string;
  relativePath: string;
}

export interface IntegralDatasetInspection extends IntegralDatasetSummary {
  fileNames: string[];
  renderables: IntegralRenderableFile[];
}

export interface IntegralScriptAssetSummary {
  createdAt: string;
  description: string;
  displayName: string;
  entry: string;
  inputSlots: IntegralSlotDefinition[];
  outputSlots: IntegralSlotDefinition[];
  scriptId: string;
}

export interface IntegralAssetCatalog {
  datasets: IntegralDatasetSummary[];
  blockTypes: IntegralBlockTypeDefinition[];
  originalData: IntegralOriginalDataSummary[];
  scripts: IntegralScriptAssetSummary[];
}

export interface IntegralManagedDataTrackingIssue {
  candidatePaths: string[];
  displayName: string;
  entityType: IntegralManagedDataEntityType;
  recordedHash: string;
  recordedPath: string;
  representation: IntegralOriginalDataRepresentation | IntegralDatasetRepresentation;
  targetId: string;
}

export interface ResolveIntegralManagedDataTrackingIssueRequest {
  entityType: IntegralManagedDataEntityType;
  selectedPath: string;
  targetId: string;
}

export interface PythonEntrySelection {
  autoIncludedFilePaths: string[];
  entryAbsolutePath: string;
  suggestedDisplayName: string;
}

export interface RegisterPythonScriptRequest {
  description: string;
  displayName: string;
  entryAbsolutePath: string;
  includedFilePaths: string[];
  inputSlotNames: string[];
  outputSlotNames: string[];
}

export interface RegisterPythonScriptResult {
  blockType: IntegralBlockTypeDefinition;
  script: IntegralScriptAssetSummary;
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


