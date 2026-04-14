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

export interface IntegralBlobSummary {
  artifactRelativePath: string;
  blobId: string;
  createdAt: string;
  originalName: string;
  payloadRelativePath: string;
  sourceKind: "directory" | "file";
}

export interface IntegralChunkSummary {
  chunkId: string;
  createdAt: string;
  createdByBlockId: string | null;
  hasRenderableFiles: boolean;
  kind: string;
  renderableCount: number;
}

export interface IntegralRenderableFile {
  data: string;
  kind: "html" | "image" | "text";
  name: string;
  relativePath: string;
}

export interface IntegralChunkInspection extends IntegralChunkSummary {
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
  blobs: IntegralBlobSummary[];
  blockTypes: IntegralBlockTypeDefinition[];
  chunks: IntegralChunkSummary[];
  scripts: IntegralScriptAssetSummary[];
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

export interface ImportBlobsResult {
  blobs: IntegralBlobSummary[];
}

export interface CreateSourceChunkRequest {
  blobIds: string[];
}

export interface CreateSourceChunkResult {
  chunk: IntegralChunkSummary;
}

export interface ExecuteIntegralBlockRequest {
  block: IntegralBlockDocument;
}

export interface ExecuteIntegralBlockResult {
  block: IntegralBlockDocument;
  createdChunks: IntegralChunkSummary[];
  finishedAt: string;
  logLines: string[];
  startedAt: string;
  status: "success";
  summary: string;
}
