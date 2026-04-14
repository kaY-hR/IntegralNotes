import type { InstalledPluginDefinition } from "./plugins";
import type {
  CreateSourceDatasetRequest,
  CreateSourceDatasetFromWorkspaceEntriesRequest,
  CreateSourceDatasetResult,
  ExecuteIntegralBlockRequest,
  ExecuteIntegralBlockResult,
  ImportOriginalDataResult,
  IntegralAssetCatalog,
  IntegralDatasetInspection,
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
  kind: "markdown";
  relativePath: string;
  name: string;
  content: string;
  modifiedAt: string;
}

export type WorkspaceFileViewKind = "markdown" | "html" | "image" | "text" | "unsupported";

export interface WorkspaceFileDocument {
  relativePath: string;
  name: string;
  content: string | null;
  kind: WorkspaceFileViewKind;
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

export interface DeleteEntriesRequest {
  targetPaths: string[];
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

export interface DeleteEntriesResult {
  snapshot: WorkspaceSnapshot;
  deletedRelativePaths: string[];
}

export interface CopyEntriesRequest {
  destinationDirectoryPath: string;
  sourcePaths: string[];
}

export interface CopyEntriesResult {
  createdEntries: WorkspaceEntry[];
  snapshot: WorkspaceSnapshot;
}

export interface MoveEntriesRequest {
  destinationDirectoryPath: string;
  sourcePaths: string[];
}

export interface MoveEntriesResult {
  movedEntries: WorkspaceEntry[];
  previousRelativePaths: string[];
  snapshot: WorkspaceSnapshot;
}

export interface CopyExternalEntriesRequest {
  destinationDirectoryPath: string;
  sourceAbsolutePaths: string[];
}

export interface SaveClipboardImageRequest {
  targetDirectoryPath: string;
}

export interface SaveClipboardImageResult {
  entry: WorkspaceEntry;
  snapshot: WorkspaceSnapshot;
}

export interface SaveNoteImageRequest {
  contentType?: string;
  originalFileName?: string;
}

export interface SaveNoteImageResult {
  entry: WorkspaceEntry;
  markdownTarget: string;
  snapshot: WorkspaceSnapshot;
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
  createSourceDataset: (request: CreateSourceDatasetRequest) => Promise<CreateSourceDatasetResult>;
  createSourceDatasetFromWorkspaceEntries: (
    request: CreateSourceDatasetFromWorkspaceEntriesRequest
  ) => Promise<CreateSourceDatasetResult>;
  getWorkspaceSnapshot: () => Promise<WorkspaceSnapshot | null>;
  openWorkspaceFolder: () => Promise<WorkspaceSnapshot | null>;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  getIntegralAssetCatalog: () => Promise<IntegralAssetCatalog>;
  importOriginalDataDirectories: () => Promise<ImportOriginalDataResult | null>;
  importOriginalDataFiles: () => Promise<ImportOriginalDataResult | null>;
  inspectDataset: (datasetId: string) => Promise<IntegralDatasetInspection>;
  getPluginInstallRootPath: () => Promise<string>;
  listInstalledPlugins: () => Promise<InstalledPluginDefinition[]>;
  installPluginFromZip: () => Promise<InstallPluginFromZipResult | null>;
  loadPluginRendererDocument: (pluginId: string) => Promise<string>;
  registerPythonScript: (
    request: RegisterPythonScriptRequest
  ) => Promise<RegisterPythonScriptResult>;
  readWorkspaceFile: (relativePath: string) => Promise<WorkspaceFileDocument>;
  readNote: (relativePath: string) => Promise<NoteDocument>;
  saveNote: (relativePath: string, content: string) => Promise<NoteDocument>;
  createEntry: (request: CreateEntryRequest) => Promise<CreateEntryResult>;
  renameEntry: (request: RenameEntryRequest) => Promise<RenameEntryResult>;
  deleteEntry: (request: DeleteEntryRequest) => Promise<DeleteEntryResult>;
  deleteEntries: (request: DeleteEntriesRequest) => Promise<DeleteEntriesResult>;
  copyEntries: (request: CopyEntriesRequest) => Promise<CopyEntriesResult>;
  moveEntries: (request: MoveEntriesRequest) => Promise<MoveEntriesResult>;
  copyExternalEntries: (request: CopyExternalEntriesRequest) => Promise<CopyEntriesResult>;
  saveClipboardImage: (request: SaveClipboardImageRequest) => Promise<SaveClipboardImageResult>;
  saveNoteImage: (request: SaveNoteImageRequest, content: Uint8Array) => Promise<SaveNoteImageResult>;
  writeClipboardText: (text: string) => void;
  clipboardHasImage: () => boolean;
  resolveWorkspaceFileUrl: (relativePath: string) => Promise<string>;
  openPathInExternalApp: (relativePath: string) => Promise<void>;
  uninstallPlugin: (pluginId: string) => Promise<UninstallPluginResult>;
  executeIntegralBlock: (
    request: ExecuteIntegralBlockRequest
  ) => Promise<ExecuteIntegralBlockResult>;
  executeIntegralAction: (
    request: ExecuteIntegralActionRequest
  ) => Promise<ExecuteIntegralActionResult>;
}


