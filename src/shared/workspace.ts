import type { InstalledPluginSummary } from "./plugins";

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

export interface IntegralNotesApi {
  getWorkspaceSnapshot: () => Promise<WorkspaceSnapshot>;
  openWorkspaceFolder: () => Promise<WorkspaceSnapshot | null>;
  listInstalledPlugins: () => Promise<InstalledPluginSummary[]>;
  readNote: (relativePath: string) => Promise<NoteDocument>;
  saveNote: (relativePath: string, content: string) => Promise<NoteDocument>;
  createEntry: (request: CreateEntryRequest) => Promise<CreateEntryResult>;
  renameEntry: (request: RenameEntryRequest) => Promise<RenameEntryResult>;
  deleteEntry: (request: DeleteEntryRequest) => Promise<DeleteEntryResult>;
  executeIntegralAction: (
    request: ExecuteIntegralActionRequest
  ) => Promise<ExecuteIntegralActionResult>;
}
