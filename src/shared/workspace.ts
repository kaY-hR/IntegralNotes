import type { InstalledPluginDefinition } from "./plugins";
import type {
  CreateSourceChunkRequest,
  CreateSourceChunkResult,
  ExecuteIntegralBlockRequest,
  ExecuteIntegralBlockResult,
  ImportBlobsResult,
  IntegralAssetCatalog,
  IntegralChunkInspection,
  PythonEntrySelection,
  RegisterPythonScriptRequest,
  RegisterPythonScriptResult
} from "./integral";

export type WorkspaceEntryKind = "directory" | "file";

export interface WorkspaceEntry {
  name: string;
  relativePath: string;
  kind: WorkspaceEntryKind;
  modifiedAt: string;
  children?: WorkspaceEntry[];
}

export interface WorkspaceSnapshot {
  rootName: string;
  rootPath: string;
  entries: WorkspaceEntry[];
}

export interface NoteDocument {
  relativePath: string;
  name: string;
  content: string;
  modifiedAt: string;
}

export interface CreateEntryRequest {
  parentPath: string;
  name: string;
  kind: WorkspaceEntryKind;
}

export interface RenameEntryRequest {
  targetPath: string;
  nextName: string;
}

export interface DeleteEntryRequest {
  targetPath: string;
}

export interface CreateEntryResult {
  snapshot: WorkspaceSnapshot;
  entry: WorkspaceEntry;
}

export interface RenameEntryResult {
  snapshot: WorkspaceSnapshot;
  entry: WorkspaceEntry;
  previousRelativePath: string;
}

export interface DeleteEntryResult {
  snapshot: WorkspaceSnapshot;
  deletedRelativePath: string;
  deletedKind: WorkspaceEntryKind;
}

export interface ExecuteIntegralActionRequest {
  actionId: string;
  blockType: string;
  payload: string;
  params?: Record<string, unknown>;
}

export interface ExecuteIntegralActionResult {
  actionId: string;
  blockType: string;
  finishedAt: string;
  logLines: string[];
  startedAt: string;
  status: "success";
  summary: string;
}

export interface InstallPluginFromZipResult {
  archivePath: string;
  installRootPath: string;
  plugin: InstalledPluginDefinition;
  targetDirectoryName: string;
}

export interface UninstallPluginResult {
  installRootPath: string;
  installedPluginPath: string;
  pluginId: string;
  removed: boolean;
}

export interface IntegralNotesApi {
  browsePythonEntryFile: () => Promise<PythonEntrySelection | null>;
  browsePythonSupportFiles: (entryAbsolutePath: string | null) => Promise<string[] | null>;
  createSourceChunk: (request: CreateSourceChunkRequest) => Promise<CreateSourceChunkResult>;
  getWorkspaceSnapshot: () => Promise<WorkspaceSnapshot | null>;
  openWorkspaceFolder: () => Promise<WorkspaceSnapshot | null>;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  getIntegralAssetCatalog: () => Promise<IntegralAssetCatalog>;
  importBlobDirectories: () => Promise<ImportBlobsResult | null>;
  importBlobFiles: () => Promise<ImportBlobsResult | null>;
  inspectChunk: (chunkId: string) => Promise<IntegralChunkInspection>;
  getPluginInstallRootPath: () => Promise<string>;
  listInstalledPlugins: () => Promise<InstalledPluginDefinition[]>;
  installPluginFromZip: () => Promise<InstallPluginFromZipResult | null>;
  loadPluginRendererDocument: (pluginId: string) => Promise<string>;
  registerPythonScript: (
    request: RegisterPythonScriptRequest
  ) => Promise<RegisterPythonScriptResult>;
  readNote: (relativePath: string) => Promise<NoteDocument>;
  saveNote: (relativePath: string, content: string) => Promise<NoteDocument>;
  createEntry: (request: CreateEntryRequest) => Promise<CreateEntryResult>;
  renameEntry: (request: RenameEntryRequest) => Promise<RenameEntryResult>;
  deleteEntry: (request: DeleteEntryRequest) => Promise<DeleteEntryResult>;
  uninstallPlugin: (pluginId: string) => Promise<UninstallPluginResult>;
  executeIntegralBlock: (
    request: ExecuteIntegralBlockRequest
  ) => Promise<ExecuteIntegralBlockResult>;
  executeIntegralAction: (
    request: ExecuteIntegralActionRequest
  ) => Promise<ExecuteIntegralActionResult>;
}
