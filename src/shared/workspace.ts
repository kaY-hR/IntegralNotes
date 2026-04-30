import type {
  InstalledPluginDefinition,
  ResolvedPluginViewer
} from "./plugins";
import type {
  AppSettings,
  SaveAppSettingsRequest
} from "./appSettings";
import type {
  CreateAiChatSessionRequest,
  AiChatHistorySnapshot,
  AiHostCommandApprovalRequest,
  AiHostCommandApprovalResponse,
  AiHostCommandExecutionUpdate,
  AiHostCommandWorkspaceSyncedEvent,
  AiChatStreamEvent,
  SaveAiChatSettingsRequest,
  SaveAiChatSessionRequest,
  AiChatStatus,
  SubmitAiChatRequest,
  SubmitAiChatResult,
  SubmitInlineAiInsertionRequest,
  SubmitInlineAiInsertionResult,
  SubmitPromptlessContinuationRequest,
  SubmitPromptlessContinuationResult,
  SubmitInlinePythonBlockRequest,
  SubmitInlinePythonBlockResult
} from "./aiChat";
import type {
  CreateDatasetRequest,
  CreateDatasetFromWorkspaceEntriesRequest,
  CreateDatasetResult,
  ExecuteIntegralBlockRequest,
  ExecuteIntegralBlockResult,
  ImportManagedFilesResult,
  IntegralAssetCatalog,
  IntegralDatasetInspection,
  IntegralManagedDataTrackingIssue,
  ResolveIntegralManagedDataTrackingIssueRequest
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

export interface WorkspaceDatasetManifestMember {
  displayName: string;
  managedFileId: string;
  relativePath: string | null;
  representation: "directory" | "file" | null;
}

export interface WorkspaceDatasetManifestView {
  dataPath: string | null;
  datasetId: string;
  datasetName: string;
  datatype: string | null;
  members: WorkspaceDatasetManifestMember[];
  noteMarkdown: string | null;
  noteTargetId: string;
}

export type WorkspaceFileViewKind =
  | "dataset-json"
  | "markdown"
  | "html"
  | "image"
  | "plugin"
  | "text"
  | "unsupported";

export interface WorkspaceFileDocument {
  relativePath: string;
  name: string;
  content: string | null;
  datasetManifest?: WorkspaceDatasetManifestView;
  kind: WorkspaceFileViewKind;
  modifiedAt: string;
  pluginViewer?: ResolvedPluginViewer;
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

export interface WorkspaceSearchRequest {
  caseSensitive?: boolean;
  excludePattern?: string;
  includePattern?: string;
  maxResults?: number;
  query: string;
  regex?: boolean;
  wholeWord?: boolean;
}

export interface WorkspaceSearchMatch {
  endColumn: number;
  lineNumber: number;
  lineText: string;
  startColumn: number;
}

export interface WorkspaceSearchFileResult {
  matchCount: number;
  matches: WorkspaceSearchMatch[];
  relativePath: string;
}

export interface WorkspaceSearchResult {
  files: WorkspaceSearchFileResult[];
  searchedFileCount: number;
  totalMatchCount: number;
  truncated: boolean;
}

export interface WorkspaceReplaceRequest extends WorkspaceSearchRequest {
  replacement: string;
}

export interface WorkspaceReplaceFileResult {
  relativePath: string;
  replacedCount: number;
}

export interface WorkspaceReplaceResult {
  files: WorkspaceReplaceFileResult[];
  replacedFileCount: number;
  replacedMatchCount: number;
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

export interface SelectWorkspaceFileRequest {
  extensions?: string[];
  initialRelativePath?: string | null;
}

export interface IntegralNotesApi {
  getAppSettings: () => Promise<AppSettings>;
  saveAppSettings: (request: SaveAppSettingsRequest) => Promise<AppSettings>;
  createDataset: (request: CreateDatasetRequest) => Promise<CreateDatasetResult>;
  createDatasetFromWorkspaceEntries: (
    request: CreateDatasetFromWorkspaceEntriesRequest
  ) => Promise<CreateDatasetResult>;
  getWorkspaceSnapshot: () => Promise<WorkspaceSnapshot | null>;
  openWorkspaceFolder: () => Promise<WorkspaceSnapshot | null>;
  syncWorkspace: () => Promise<WorkspaceSnapshot | null>;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  getIntegralAssetCatalog: () => Promise<IntegralAssetCatalog>;
  listManagedDataTrackingIssues: () => Promise<IntegralManagedDataTrackingIssue[]>;
  importManagedFileDirectories: () => Promise<ImportManagedFilesResult | null>;
  importManagedFileFiles: () => Promise<ImportManagedFilesResult | null>;
  inspectDataset: (datasetId: string) => Promise<IntegralDatasetInspection>;
  selectWorkspaceDirectory: (initialRelativePath?: string | null) => Promise<string | null>;
  selectWorkspaceFile: (request?: SelectWorkspaceFileRequest | null) => Promise<string | null>;
  getPluginInstallRootPath: () => Promise<string>;
  listInstalledPlugins: () => Promise<InstalledPluginDefinition[]>;
  installPluginFromZip: () => Promise<InstallPluginFromZipResult | null>;
  loadPluginRendererDocument: (pluginId: string) => Promise<string>;
  loadPluginSidebarViewDocument: (pluginId: string, sidebarViewId: string) => Promise<string>;
  loadPluginViewerDocument: (pluginId: string, viewerId: string) => Promise<string>;
  resolveManagedDataTrackingIssue: (
    request: ResolveIntegralManagedDataTrackingIssueRequest
  ) => Promise<IntegralManagedDataTrackingIssue[]>;
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
  getPathForFile: (file: unknown) => string;
  writeWorkspaceSelectionToClipboard: (relativePaths: string[]) => void;
  readWorkspaceSelectionFromClipboard: () => Promise<string[]>;
  writeClipboardText: (text: string) => void;
  clipboardHasImage: () => Promise<boolean>;
  readClipboardExternalPaths: () => Promise<string[]>;
  searchWorkspaceText: (request: WorkspaceSearchRequest) => Promise<WorkspaceSearchResult>;
  replaceWorkspaceText: (request: WorkspaceReplaceRequest) => Promise<WorkspaceReplaceResult>;
  resolveWorkspaceFileUrl: (relativePath: string) => Promise<string>;
  openPathInExternalApp: (relativePath: string) => Promise<void>;
  openPathInFileManager: (relativePath?: string | null) => Promise<void>;
  openWorkspaceInVSCode: () => Promise<void>;
  uninstallPlugin: (pluginId: string) => Promise<UninstallPluginResult>;
  executeIntegralBlock: (
    request: ExecuteIntegralBlockRequest
  ) => Promise<ExecuteIntegralBlockResult>;
  executeIntegralAction: (
    request: ExecuteIntegralActionRequest
  ) => Promise<ExecuteIntegralActionResult>;
  getAiChatStatus: () => Promise<AiChatStatus>;
  saveAiChatSettings: (request: SaveAiChatSettingsRequest) => Promise<AiChatStatus>;
  clearAiChatApiKey: () => Promise<AiChatStatus>;
  refreshAiChatModels: () => Promise<AiChatStatus>;
  getAiChatHistory: () => Promise<AiChatHistorySnapshot>;
  createAiChatSession: (request: CreateAiChatSessionRequest) => Promise<AiChatHistorySnapshot>;
  saveAiChatSession: (request: SaveAiChatSessionRequest) => Promise<AiChatHistorySnapshot>;
  switchAiChatSession: (sessionId: string) => Promise<AiChatHistorySnapshot>;
  deleteAiChatSession: (sessionId: string) => Promise<AiChatHistorySnapshot>;
  submitAiChat: (request: SubmitAiChatRequest) => Promise<SubmitAiChatResult>;
  submitInlineAiInsertion: (
    request: SubmitInlineAiInsertionRequest
  ) => Promise<SubmitInlineAiInsertionResult>;
  submitInlinePythonBlock: (
    request: SubmitInlinePythonBlockRequest
  ) => Promise<SubmitInlinePythonBlockResult>;
  submitPromptlessContinuation: (
    request: SubmitPromptlessContinuationRequest
  ) => Promise<SubmitPromptlessContinuationResult>;
  onAiHostCommandApprovalRequest: (
    handler: (request: AiHostCommandApprovalRequest) => void
  ) => () => void;
  respondAiHostCommandApproval: (response: AiHostCommandApprovalResponse) => Promise<void>;
  cancelAiHostCommandExecution: (requestId: string) => Promise<boolean>;
  onAiHostCommandExecutionUpdate: (
    handler: (update: AiHostCommandExecutionUpdate) => void
  ) => () => void;
  onAiHostCommandWorkspaceSynced: (
    handler: (event: AiHostCommandWorkspaceSyncedEvent) => void
  ) => () => void;
  onAiChatStreamEvent: (handler: (event: AiChatStreamEvent) => void) => () => void;
}


