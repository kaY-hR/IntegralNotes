import * as FlexLayout from "flexlayout-react";
import {
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type {
  IntegralAssetCatalog,
  IntegralManagedDataTrackingIssue,
  IntegralManagedFileSummary,
  ResolveIntegralManagedDataTrackingIssueRequest
} from "../shared/integral";
import type {
  AiHostCommandApprovalRequest,
  AiHostCommandExecutionUpdate
} from "../shared/aiChat";
import type {
  AppSettings,
  SaveAppSettingsRequest
} from "../shared/appSettings";
import { DEFAULT_LINK_PICKER_RANKING } from "../shared/appSettings";
import type {
  CopyEntriesResult,
  CreateEntryResult,
  DeleteEntriesResult,
  MoveEntriesResult,
  NoteDocument,
  RenameEntryResult,
  SaveClipboardImageResult,
  WorkspaceEntry,
  WorkspaceEntryKind,
  WorkspaceFileDocument,
  WorkspaceFileViewKind,
  WorkspaceReplaceResult,
  WorkspaceSearchRequest,
  WorkspaceSearchResult,
  WorkspaceSnapshot
} from "../shared/workspace";
import type { InstalledPluginDefinition } from "../shared/plugins";
import {
  extractWorkspaceBlockId,
  resolveWorkspaceMarkdownTarget,
  type WorkspacePathChange,
  rewriteWorkspaceMarkdownReferences
} from "../shared/workspaceLinks";
import { ActivityBar, type ActivityBarItem } from "./ActivityBar";
import { DataRegistrationDialog } from "./DataRegistrationDialog";
import { ExternalPluginSidebarView } from "./ExternalPluginSidebarView";
import { FileTree, type FileTreeInlineEditorState } from "./FileTree";
import {
  resetIntegralPluginRuntime,
  setIntegralPluginRuntimeCatalog
} from "./integralPluginRuntime";
import { normalizeIntegralBlockInputReferencesInMarkdown } from "./integralBlockRegistry";
import { ManagedDataTrackingDialog } from "./ManagedDataTrackingDialog";
import { MilkdownEditor } from "./MilkdownEditor";
import { findWorkspaceToolPlugin, workspaceToolPlugins } from "./workspaceToolPlugins";
import { RawMarkdownEditor } from "./RawMarkdownEditor";
import { SearchSidebarView, type SearchSidebarState } from "./SearchSidebarView";
import { WorkspaceFileViewer } from "./WorkspaceFileViewer";
import { WorkspaceDialog } from "./WorkspaceDialog";
import {
  OPEN_MANAGED_DATA_NOTE_EVENT,
  OPEN_WORKSPACE_FILE_EVENT
} from "./workspaceOpenEvents";
import { AIChatSettingsDialog } from "./AIChatSettingsDialog";
import { AppSettingsDialog } from "./AppSettingsDialog";
import { InlineActionSettingsDialog } from "./InlineActionSettingsDialog";

type ReadonlyWorkspaceFileKind = Exclude<WorkspaceFileViewKind, "markdown">;
type MarkdownEditorMode = "wysiwyg" | "text";

interface OpenMarkdownTab extends NoteDocument {
  editorMode: MarkdownEditorMode;
  isSaving: boolean;
  savedContent: string;
}

interface OpenReadonlyTab extends WorkspaceFileDocument {
  kind: ReadonlyWorkspaceFileKind;
}

type OpenWorkspaceTab = OpenMarkdownTab | OpenReadonlyTab;

interface DeleteDialogState {
  confirmLabel: string;
  description: string;
  targetPaths: string[];
  title: string;
}

interface TreeContextMenuState {
  entry?: WorkspaceEntry;
  scope: "entry" | "root";
  x: number;
  y: number;
}

type AppMenuId = "file" | "settings" | "tools";

interface AppMenuCommand {
  disabled?: boolean;
  label: string;
  onSelect: () => void;
  title?: string;
}

interface AppMenuSection {
  commands: AppMenuCommand[];
}

interface AppMenuDefinition {
  id: AppMenuId;
  label: string;
  sections: AppMenuSection[];
}

interface DatasetCreationDialogState {
  defaultName: string;
  relativePaths: string[];
}

interface ManagedDataTarget {
  displayName: string;
  targetId: string;
}

type HostCommandDialogStatus =
  | "awaiting-approval"
  | "cancelled"
  | "completed"
  | "failed"
  | "responding"
  | "running"
  | "timeout";

interface HostCommandDialogState {
  command: string;
  durationMs?: number;
  exitCode?: number | null;
  message?: string;
  rejectReason: string;
  request: AiHostCommandApprovalRequest;
  status: HostCommandDialogStatus;
  stderr: string;
  stdout: string;
}

interface OpenWorkspaceFileOptions {
  preserveFocus?: boolean;
  openUnsupportedExternally?: boolean;
  tabNameOverride?: string;
}

const MAIN_TABSET_ID = "editor-main";
const BUILTIN_EXPLORER_SIDEBAR_VIEW_ID = "builtin:explorer";
const BUILTIN_SEARCH_SIDEBAR_VIEW_ID = "builtin:search";
const WORKSPACE_TOOL_TAB_ID_PREFIX = "workspace-tool::";
const NEW_FILE_ICON_URL = new URL("./resources/ファイル追加.png", import.meta.url).href;
const NEW_FOLDER_ICON_URL = new URL("./resources/フォルダアイコン15.png", import.meta.url).href;
const TREE_DRAG_MIME = "application/x-integralnotes-workspace-selection";

interface SidebarViewDefinition {
  activityIcon: ReactNode;
  id: string;
  render: () => JSX.Element;
  title: string;
}

function ExplorerVisibilityIcon({
  showHiddenEntries
}: {
  showHiddenEntries: boolean;
}): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="sidebar__action-icon-svg"
      viewBox="0 0 18 16"
    >
      <path d="M1.5 8c1.82-3.03 4.86-4.75 7.5-4.75S14.68 4.97 16.5 8c-1.82 3.03-4.86 4.75-7.5 4.75S3.32 11.03 1.5 8Z" />
      <circle cx="9" cy="8" r="2.2" />
      {!showHiddenEntries ? <path d="M3 14 15 2" /> : null}
    </svg>
  );
}

function ExplorerCollapseAllIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="sidebar__action-icon-svg"
      viewBox="0 0 18 16"
    >
      <path d="M4 4.5h10" />
      <path d="M4 11.5h10" />
      <path d="m6 8 3-3 3 3" />
      <path d="m6 14 3-3 3 3" />
    </svg>
  );
}

function ExplorerSidebarIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" className="activity-bar__icon-svg" viewBox="0 0 16 16">
      <path d="M1.5 3.25h4.1l1.1 1.35h7.8v7.9H1.5z" />
      <path d="M1.5 4.6h13v7.9H1.5z" />
    </svg>
  );
}

function SearchSidebarIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" className="activity-bar__icon-svg" viewBox="0 0 16 16">
      <circle cx="6.5" cy="6.5" r="3.75" />
      <path d="m9.4 9.4 4.1 4.1" />
    </svg>
  );
}

function SidebarTextIcon({ label }: { label: string }): JSX.Element {
  return <span className="activity-bar__icon-label">{label}</span>;
}

function toSidebarIconLabel(value: string): string {
  const normalized = value.replace(/\s+/gu, "").slice(0, 2).toUpperCase();
  return normalized.length > 0 ? normalized : "?";
}

function createEmptyIntegralAssetCatalog(): IntegralAssetCatalog {
  return {
    blockTypes: [],
    datasets: [],
    managedFiles: []
  };
}

function createDefaultSearchSidebarState(): SearchSidebarState {
  return {
    caseSensitive: false,
    excludePattern: "",
    includePattern: "",
    query: "",
    regex: false,
    replacement: "",
    showFileFilters: false,
    showReplace: false,
    wholeWord: false
  };
}

function createLayoutModel(): FlexLayout.Model {
  const model = FlexLayout.Model.fromJson({
    global: {
      splitterSize: 6,
      tabEnableRename: false,
      tabSetEnableDeleteWhenEmpty: true,
      tabSetEnableMaximize: true,
      tabSetEnableTabScrollbar: true
    },
    layout: {
      type: "row",
      children: [
        {
          id: MAIN_TABSET_ID,
          type: "tabset",
          weight: 100,
          enableDeleteWhenEmpty: true,
          children: []
        }
      ]
    }
  });

  model.setOnCreateTabSet((tabNode) => {
    if (tabNode) {
      return { enableDeleteWhenEmpty: true };
    }

    return { enableDeleteWhenEmpty: true };
  });

  return model;
}

function toTabId(relativePath: string): string {
  return `note::${relativePath}`;
}

function toRelativePathFromTabId(tabId: string): string | undefined {
  if (!tabId.startsWith("note::")) {
    return undefined;
  }

  return tabId.slice("note::".length);
}

function toWorkspaceToolTabId(toolId: string): string {
  return `${WORKSPACE_TOOL_TAB_ID_PREFIX}${toolId}`;
}

function toWorkspaceToolIdFromTabId(tabId: string): string | undefined {
  if (!tabId.startsWith(WORKSPACE_TOOL_TAB_ID_PREFIX)) {
    return undefined;
  }

  return tabId.slice(WORKSPACE_TOOL_TAB_ID_PREFIX.length);
}

function findEntryByPath(entries: WorkspaceEntry[], relativePath: string): WorkspaceEntry | undefined {
  for (const entry of entries) {
    if (entry.relativePath === relativePath) {
      return entry;
    }

    if (entry.children) {
      const childMatch = findEntryByPath(entry.children, relativePath);

      if (childMatch) {
        return childMatch;
      }
    }
  }

  return undefined;
}

function hasEntry(entries: WorkspaceEntry[], relativePath: string): boolean {
  if (relativePath.length === 0) {
    return true;
  }

  return findEntryByPath(entries, relativePath) !== undefined;
}

function basename(relativePath: string): string {
  const parts = relativePath.split("/");
  return parts[parts.length - 1] ?? relativePath;
}

function displayNameForRename(entry: WorkspaceEntry): string {
  if (entry.kind === "file" && entry.name.toLowerCase().endsWith(".md")) {
    return entry.name.slice(0, -3);
  }

  return entry.name;
}

function dirname(relativePath: string): string {
  const parts = relativePath.split("/").filter(Boolean);

  if (parts.length <= 1) {
    return "";
  }

  return parts.slice(0, -1).join("/");
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath
    .split(/[\\/]+/u)
    .filter(Boolean)
    .join("/");
}

function isHiddenWorkspaceEntry(entry: WorkspaceEntry): boolean {
  const segments = normalizeRelativePath(entry.relativePath)
    .split("/")
    .filter(Boolean);

  if (segments.length === 0) {
    return false;
  }

  const parentSegments = segments.slice(0, -1);
  const leafSegment = segments[segments.length - 1] ?? "";

  return parentSegments.some(isHiddenWorkspaceDirectorySegment) ||
    (entry.kind === "directory"
      ? isHiddenWorkspaceDirectorySegment(leafSegment)
      : leafSegment.startsWith("."));
}

function isHiddenWorkspacePath(relativePath: string): boolean {
  const normalizedPath = normalizeRelativePath(relativePath);

  if (normalizedPath.length === 0) {
    return false;
  }

  const segments = normalizedPath.split("/").filter(Boolean);
  const parentSegments = segments.slice(0, -1);
  const leafSegment = segments[segments.length - 1] ?? "";

  return parentSegments.some(isHiddenWorkspaceDirectorySegment) || leafSegment.startsWith(".");
}

function isHiddenWorkspaceDirectorySegment(segment: string): boolean {
  return segment.startsWith(".") || segment.startsWith("_");
}

function filterWorkspaceEntries(
  entries: WorkspaceEntry[],
  showHiddenEntries: boolean
): WorkspaceEntry[] {
  if (showHiddenEntries) {
    return entries;
  }

  return entries.flatMap((entry) => {
    if (isHiddenWorkspaceEntry(entry)) {
      return [];
    }

    if (!entry.children) {
      return [entry];
    }

    return [
      {
        ...entry,
        children: filterWorkspaceEntries(entry.children, showHiddenEntries)
      }
    ];
  });
}

function createManagedDataNoteRelativePath(targetId: string): string {
  const normalizedId = targetId.trim();
  return `.store/.integral/data-notes/${normalizedId}.md`;
}

function createManagedDataNoteTabName(displayName: string): string {
  return `${displayName} のノート`;
}

function findManagedDataTargetById(
  catalog: IntegralAssetCatalog,
  targetId: string
): ManagedDataTarget | null {
  const normalizedTargetId = targetId.trim();

  if (normalizedTargetId.length === 0) {
    return null;
  }

  const managedFile = catalog.managedFiles.find(
    (entry) =>
      entry.canOpenDataNote &&
      (entry.id === normalizedTargetId || (entry.noteTargetId ?? entry.id) === normalizedTargetId)
  );

  if (managedFile) {
    return {
      displayName: managedFile.displayName,
      targetId: managedFile.noteTargetId ?? managedFile.id
    };
  }

  const dataset = catalog.datasets.find(
    (entry) =>
      entry.canOpenDataNote &&
      (entry.datasetId === normalizedTargetId ||
        (entry.noteTargetId ?? entry.datasetId) === normalizedTargetId)
  );

  if (dataset) {
    return {
      displayName: dataset.name,
      targetId: dataset.noteTargetId ?? dataset.datasetId
    };
  }

  return null;
}

function findManagedDataTargetForPath(
  catalog: IntegralAssetCatalog,
  relativePath: string
): ManagedDataTarget | null {
  const normalizedRelativePath = normalizeRelativePath(relativePath);

  if (normalizedRelativePath.length === 0) {
    return null;
  }

  const matches: Array<
    ManagedDataTarget & {
      isExactMatch: boolean;
      matchedPath: string;
    }
  > = [];

  const collectMatch = (
    displayName: string,
    targetId: string,
    managedPath: string,
    representation: "directory" | "file" | "dataset-json"
  ): void => {
    const normalizedManagedPath = normalizeRelativePath(managedPath);

    if (normalizedManagedPath.length === 0) {
      return;
    }

    const isExactMatch = normalizedRelativePath === normalizedManagedPath;
    const isDirectoryMatch =
      representation === "directory" &&
      normalizedRelativePath.startsWith(`${normalizedManagedPath}/`);

    if (!isExactMatch && !isDirectoryMatch) {
      return;
    }

    matches.push({
      displayName,
      isExactMatch,
      matchedPath: normalizedManagedPath,
      targetId
    });
  };

  for (const entry of catalog.managedFiles) {
    if (!entry.canOpenDataNote) {
      continue;
    }

    collectMatch(
      entry.displayName,
      entry.noteTargetId ?? entry.id,
      entry.path,
      entry.representation
    );
  }

  for (const entry of catalog.datasets) {
    if (!entry.canOpenDataNote) {
      continue;
    }

    collectMatch(
      entry.name,
      entry.noteTargetId ?? entry.datasetId,
      entry.path,
      entry.representation
    );
  }

  matches.sort((left, right) => {
    if (left.isExactMatch !== right.isExactMatch) {
      return left.isExactMatch ? -1 : 1;
    }

    if (left.matchedPath.length !== right.matchedPath.length) {
      return right.matchedPath.length - left.matchedPath.length;
    }

    return left.displayName.localeCompare(right.displayName, "ja");
  });

  const [bestMatch] = matches;

  return bestMatch
    ? {
        displayName: bestMatch.displayName,
        targetId: bestMatch.targetId
      }
    : null;
}

function collectManagedDataTargetsForPaths(
  catalog: IntegralAssetCatalog,
  relativePaths: readonly string[]
): ManagedDataTarget[] {
  const normalizedPaths = relativePaths.map((relativePath) => normalizeRelativePath(relativePath));
  const matches = new Map<string, ManagedDataTarget>();

  const collectMatches = (
    displayName: string,
    targetId: string,
    managedPath: string,
    representation: "directory" | "file" | "dataset-json"
  ): void => {
    const normalizedManagedPath = normalizeRelativePath(managedPath);

    if (
      normalizedManagedPath.length === 0 ||
      !normalizedPaths.some((relativePath) =>
        doWorkspacePathsOverlapForManagedDelete(relativePath, normalizedManagedPath, representation)
      )
    ) {
      return;
    }

    matches.set(targetId, {
      displayName,
      targetId
    });
  };

  for (const entry of catalog.managedFiles) {
    collectMatches(entry.displayName, entry.noteTargetId ?? entry.id, entry.path, entry.representation);
  }

  for (const entry of catalog.datasets) {
    collectMatches(entry.name, entry.noteTargetId ?? entry.datasetId, entry.path, entry.representation);
  }

  return Array.from(matches.values()).sort((left, right) =>
    `${left.displayName} ${left.targetId}`.localeCompare(
      `${right.displayName} ${right.targetId}`,
      "ja"
    )
  );
}

function doWorkspacePathsOverlapForManagedDelete(
  selectedPath: string,
  managedPath: string,
  representation: "directory" | "file" | "dataset-json"
): boolean {
  if (representation === "directory") {
    return selectedPath === managedPath ||
      selectedPath.startsWith(`${managedPath}/`) ||
      managedPath.startsWith(`${selectedPath}/`);
  }

  return selectedPath === managedPath || managedPath.startsWith(`${selectedPath}/`);
}

function createPathChange(previousPath: string, nextPath: string): WorkspacePathChange | null {
  const normalizedPreviousPath = normalizeRelativePath(previousPath);
  const normalizedNextPath = normalizeRelativePath(nextPath);

  if (
    normalizedPreviousPath.length === 0 ||
    normalizedNextPath.length === 0 ||
    normalizedPreviousPath === normalizedNextPath
  ) {
    return null;
  }

  return {
    nextPath: normalizedNextPath,
    previousPath: normalizedPreviousPath
  };
}

function createRenamePathChanges(result: RenameEntryResult): WorkspacePathChange[] {
  const pathChange = createPathChange(result.previousRelativePath, result.entry.relativePath);

  return pathChange ? [pathChange] : [];
}

function createMovePathChanges(result: MoveEntriesResult): WorkspacePathChange[] {
  const pathChanges: WorkspacePathChange[] = [];

  for (let index = 0; index < result.previousRelativePaths.length; index += 1) {
    const previousPath = result.previousRelativePaths[index];
    const nextPath = result.movedEntries[index]?.relativePath;
    const pathChange = nextPath ? createPathChange(previousPath, nextPath) : null;

    if (pathChange) {
      pathChanges.push(pathChange);
    }
  }

  return pathChanges;
}

function collapseNestedSelection(relativePaths: Iterable<string>): string[] {
  const normalized = Array.from(
    new Set(
      Array.from(relativePaths)
        .map((value) => normalizeRelativePath(value))
        .filter((value) => value.length > 0)
    )
  ).sort((left, right) => left.length - right.length || left.localeCompare(right, "ja"));
  const collapsed: string[] = [];

  for (const candidate of normalized) {
    if (collapsed.some((existing) => candidate === existing || candidate.startsWith(`${existing}/`))) {
      continue;
    }

    collapsed.push(candidate);
  }

  return collapsed;
}

function findEntriesByPaths(entries: WorkspaceEntry[], relativePaths: Iterable<string>): WorkspaceEntry[] {
  return collapseNestedSelection(relativePaths)
    .map((relativePath) => findEntryByPath(entries, relativePath))
    .filter((entry): entry is WorkspaceEntry => entry !== undefined);
}

function flattenVisibleTreeEntries(
  entries: WorkspaceEntry[],
  expandedPaths: ReadonlySet<string>
): WorkspaceEntry[] {
  const flattened: WorkspaceEntry[] = [];

  for (const entry of entries) {
    flattened.push(entry);

    if (
      entry.kind === "directory" &&
      entry.children &&
      expandedPaths.has(entry.relativePath)
    ) {
      flattened.push(...flattenVisibleTreeEntries(entry.children, expandedPaths));
    }
  }

  return flattened;
}

function findSelectionRangePaths(
  visibleEntries: WorkspaceEntry[],
  anchorPath: string,
  targetPath: string
): string[] {
  const visiblePaths = visibleEntries.map((entry) => entry.relativePath);
  const targetIndex = visiblePaths.indexOf(targetPath);

  if (targetIndex < 0) {
    return targetPath.length > 0 ? [targetPath] : [];
  }

  const anchorIndex = visiblePaths.indexOf(anchorPath);
  const rangeAnchorIndex = anchorIndex >= 0 ? anchorIndex : targetIndex;
  const startIndex = Math.min(rangeAnchorIndex, targetIndex);
  const endIndex = Math.max(rangeAnchorIndex, targetIndex);

  return visiblePaths.slice(startIndex, endIndex + 1);
}

function hasExternalTransferFiles(dataTransfer: DataTransfer): boolean {
  if (dataTransfer.types.includes("Files")) {
    return true;
  }

  return Array.from(dataTransfer.items).some((item) => item.kind === "file");
}

function collectExternalTransferAbsolutePaths(dataTransfer: DataTransfer): string[] {
  const absolutePaths = new Set<string>();
  const collectAbsolutePath = (file: File | null): void => {
    if (!file) {
      return;
    }

    let absolutePath = "";

    try {
      absolutePath = window.integralNotes.getPathForFile(file).trim();
    } catch (error) {
      console.error("[Explorer] failed to resolve dropped file path", error);
    }

    if (absolutePath.length > 0) {
      absolutePaths.add(absolutePath);
    }
  };

  Array.from(dataTransfer.files).forEach((file) => {
    collectAbsolutePath(file);
  });
  Array.from(dataTransfer.items)
    .filter((item) => item.kind === "file")
    .forEach((item) => {
      collectAbsolutePath(item.getAsFile());
    });

  return Array.from(absolutePaths);
}

function getEntryDirectoryPath(entry: WorkspaceEntry | undefined): string {
  if (!entry) {
    return "";
  }

  return entry.kind === "directory" ? entry.relativePath : dirname(entry.relativePath);
}

function joinWorkspaceAbsolutePath(rootPath: string, relativePath: string): string {
  if (relativePath.length === 0) {
    return rootPath;
  }

  const separator = rootPath.includes("\\") ? "\\" : "/";
  const normalizedRootPath = rootPath.replace(/[\\/]+$/u, "");
  return `${normalizedRootPath}${separator}${relativePath.split("/").join(separator)}`;
}

function createDefaultDatasetName(entries: readonly WorkspaceEntry[]): string {
  if (entries.length === 1) {
    const [entry] = entries;
    return entry.kind === "file" ? entry.name.replace(/\.[^.]+$/u, "") : entry.name;
  }

  return "";
}

function findFirstFile(entries: WorkspaceEntry[]): WorkspaceEntry | undefined {
  for (const entry of entries) {
    if (entry.kind === "file") {
      return entry;
    }

    if (entry.children) {
      const childNote = findFirstFile(entry.children);

      if (childNote) {
        return childNote;
      }
    }
  }

  return undefined;
}

function collectDirectoryPaths(
  entries: WorkspaceEntry[],
  directoryPaths: Set<string> = new Set<string>()
): Set<string> {
  for (const entry of entries) {
    if (entry.kind !== "directory") {
      continue;
    }

    directoryPaths.add(entry.relativePath);

    if (entry.children) {
      collectDirectoryPaths(entry.children, directoryPaths);
    }
  }

  return directoryPaths;
}

function defaultExpandedPaths(entries: WorkspaceEntry[]): Set<string> {
  return new Set(
    entries.filter((entry) => entry.kind === "directory").map((entry) => entry.relativePath)
  );
}

function reconcileExpandedPaths(
  currentExpandedPaths: Set<string>,
  entries: WorkspaceEntry[]
): Set<string> {
  const availableDirectoryPaths = collectDirectoryPaths(entries);

  return new Set(
    Array.from(currentExpandedPaths).filter((entryPath) => availableDirectoryPaths.has(entryPath))
  );
}

function isMarkdownTab(tab: OpenWorkspaceTab | undefined): tab is OpenMarkdownTab {
  return Boolean(tab && tab.kind === "markdown");
}

function isDirty(tab: OpenWorkspaceTab | undefined): boolean {
  return Boolean(isMarkdownTab(tab) && tab.content !== tab.savedContent);
}

function getDirtyTabPaths(tabs: Record<string, OpenWorkspaceTab>): string[] {
  return Object.values(tabs)
    .filter((tab): tab is OpenMarkdownTab => isMarkdownTab(tab) && isDirty(tab))
    .map((tab) => tab.relativePath);
}

function createOpenTab(document: WorkspaceFileDocument, nameOverride?: string): OpenWorkspaceTab {
  const name = nameOverride ?? document.name;

  if (document.kind === "markdown") {
    return {
      content: document.content ?? "",
      editorMode: "wysiwyg",
      isSaving: false,
      kind: "markdown",
      modifiedAt: document.modifiedAt,
      name,
      relativePath: document.relativePath,
      savedContent: document.content ?? ""
    };
  }

  return {
    ...document,
    content: document.content,
    kind: document.kind as ReadonlyWorkspaceFileKind,
    name,
  };
}

function findSelectedTabId(model: FlexLayout.Model): string | undefined {
  let selectedTabId: string | undefined;

  model.visitNodes((node) => {
    if (node.getType() !== "tab") {
      return;
    }

    const tabNode = node as FlexLayout.TabNode;

    if (tabNode.isSelected()) {
      selectedTabId = tabNode.getId();
    }
  });

  return selectedTabId;
}

function findAdjacentLayoutTabId(
  model: FlexLayout.Model,
  selectedTabId: string | undefined,
  direction: -1 | 1
): string | undefined {
  const currentTabId =
    selectedTabId && model.getNodeById(selectedTabId) ? selectedTabId : findSelectedTabId(model);

  if (!currentTabId) {
    return undefined;
  }

  const currentNode = model.getNodeById(currentTabId);

  if (!currentNode || currentNode.getType() !== "tab") {
    return undefined;
  }

  const parentNode = currentNode.getParent();

  if (!parentNode || parentNode.getType() !== "tabset") {
    return undefined;
  }

  const tabIds = parentNode
    .getChildren()
    .filter((node): node is FlexLayout.TabNode => node.getType() === "tab")
    .map((node) => node.getId());

  if (tabIds.length < 2) {
    return undefined;
  }

  const currentIndex = tabIds.indexOf(currentTabId);

  if (currentIndex < 0) {
    return undefined;
  }

  return tabIds[(currentIndex + direction + tabIds.length) % tabIds.length];
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "不明なエラーが発生しました。";
}

function applyHostCommandExecutionUpdate(
  current: HostCommandDialogState | null,
  update: AiHostCommandExecutionUpdate
): HostCommandDialogState | null {
  if (!current || current.request.id !== update.id) {
    return current;
  }

  switch (update.type) {
    case "started":
      return {
        ...current,
        status: "running"
      };
    case "stdout":
      return {
        ...current,
        stdout: `${current.stdout}${update.chunk ?? ""}`
      };
    case "stderr":
      return {
        ...current,
        stderr: `${current.stderr}${update.chunk ?? ""}`
      };
    case "finished":
      return {
        ...current,
        durationMs: update.durationMs,
        exitCode: update.exitCode ?? null,
        message: update.message,
        status: "completed"
      };
    case "timeout":
      return {
        ...current,
        durationMs: update.durationMs,
        exitCode: update.exitCode ?? null,
        message: update.message ?? current.message,
        status: "timeout"
      };
    case "cancelled":
      return {
        ...current,
        durationMs: update.durationMs,
        exitCode: update.exitCode ?? null,
        message: update.message ?? current.message,
        status: "cancelled"
      };
    case "failed":
      return {
        ...current,
        durationMs: update.durationMs,
        exitCode: update.exitCode ?? null,
        message: update.message ?? current.message,
        status: "failed"
      };
  }
}

function createWorkspaceSearchRequest(
  state: SearchSidebarState,
  overrides: Partial<WorkspaceSearchRequest> = {}
): WorkspaceSearchRequest {
  return {
    caseSensitive: state.caseSensitive,
    excludePattern: state.excludePattern,
    includePattern: state.includePattern,
    maxResults: 400,
    query: state.query,
    regex: state.regex,
    wholeWord: state.wholeWord,
    ...overrides
  };
}

function isEditableElement(element: HTMLElement | null): boolean {
  if (!element) {
    return false;
  }

  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.isContentEditable ||
    element.closest("[contenteditable='true']") !== null
  );
}

function isZoomModifierPressed(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey;
}

function isZoomOutShortcut(event: KeyboardEvent): boolean {
  return (
    isZoomModifierPressed(event) &&
    (event.key === "-" || event.key === "_" || event.code === "Minus" || event.code === "NumpadSubtract")
  );
}

function isZoomInShortcut(event: KeyboardEvent): boolean {
  if (!isZoomModifierPressed(event)) {
    return false;
  }

  if (
    event.key === "+" ||
    event.key === "=" ||
    event.code === "Equal" ||
    event.code === "NumpadAdd"
  ) {
    return true;
  }

  return event.shiftKey && (event.code === "Semicolon" || event.key === ":" || event.key === ";");
}

function isZoomResetShortcut(event: KeyboardEvent): boolean {
  return isZoomModifierPressed(event) && (event.key === "0" || event.code === "Digit0" || event.code === "Numpad0");
}

function isLayoutTabSwitchShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key === "Tab";
}

function isCloseSelectedLayoutTabShortcut(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "w"
  );
}

function clampContextMenuPosition(x: number, y: number): Pick<TreeContextMenuState, "x" | "y"> {
  const menuWidth = 196;
  const menuHeight = 360;

  return {
    x: Math.max(8, Math.min(x, window.innerWidth - menuWidth)),
    y: Math.max(8, Math.min(y, window.innerHeight - menuHeight))
  };
}

export function App(): JSX.Element {
  const [assetCatalog, setAssetCatalog] = useState<IntegralAssetCatalog>(
    createEmptyIntegralAssetCatalog()
  );
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [showHiddenEntries, setShowHiddenEntries] = useState(false);
  const [openTabs, setOpenTabs] = useState<Record<string, OpenWorkspaceTab>>({});
  const [selectedEntryPath, setSelectedEntryPath] = useState("");
  const [selectedEntryPaths, setSelectedEntryPaths] = useState<Set<string>>(new Set());
  const [selectedTabId, setSelectedTabId] = useState<string | undefined>(undefined);
  const [lastFocusedWorkspaceTabPath, setLastFocusedWorkspaceTabPath] = useState<string | null>(null);
  const [pendingFocusedBlockByPath, setPendingFocusedBlockByPath] = useState<Record<string, string>>(
    {}
  );
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [statusMessage, setStatusMessage] = useState("ワークスペースを読み込み中...");
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [trackingIssues, setTrackingIssues] = useState<IntegralManagedDataTrackingIssue[]>([]);
  const [trackingDialogDismissed, setTrackingDialogDismissed] = useState(false);
  const [trackingResolutionPending, setTrackingResolutionPending] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);
  const [deleteDialogPending, setDeleteDialogPending] = useState(false);
  const [inlineEditor, setInlineEditor] = useState<FileTreeInlineEditorState | null>(null);
  const [inlineEditorPending, setInlineEditorPending] = useState(false);
  const [contextMenu, setContextMenu] = useState<TreeContextMenuState | null>(null);
  const [activeAppMenuId, setActiveAppMenuId] = useState<AppMenuId | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [datasetCreationDialog, setDatasetCreationDialog] = useState<DatasetCreationDialogState | null>(null);
  const [datasetCreationPending, setDatasetCreationPending] = useState(false);
  const [activeSidebarViewId, setActiveSidebarViewId] = useState(BUILTIN_EXPLORER_SIDEBAR_VIEW_ID);
  const [searchSidebarState, setSearchSidebarState] = useState<SearchSidebarState>(
    createDefaultSearchSidebarState()
  );
  const [workspaceSearchResult, setWorkspaceSearchResult] = useState<WorkspaceSearchResult | null>(
    null
  );
  const [workspaceSearchPending, setWorkspaceSearchPending] = useState(false);
  const [workspaceReplacePending, setWorkspaceReplacePending] = useState(false);
  const [workspaceSearchError, setWorkspaceSearchError] = useState<string | null>(null);
  const [dataRegistrationDialogOpen, setDataRegistrationDialogOpen] = useState(false);
  const [appSettingsDialogOpen, setAppSettingsDialogOpen] = useState(false);
  const [aiSettingsDialogOpen, setAiSettingsDialogOpen] = useState(false);
  const [inlineActionSettingsDialogOpen, setInlineActionSettingsDialogOpen] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [appSettingsPending, setAppSettingsPending] = useState(false);
  const [hostCommandDialog, setHostCommandDialog] = useState<HostCommandDialogState | null>(null);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPluginDefinition[]>([]);
  const [pluginCatalogRevision, setPluginCatalogRevision] = useState(0);
  const [model] = useState(() => createLayoutModel());
  const openTabsRef = useRef(openTabs);
  const pendingTabCloseConfirmationRef = useRef<Set<string>>(new Set());
  const shouldAutoOpenInitialFileRef = useRef(false);
  const sidebarPanelRef = useRef<HTMLElement>(null);
  const workspaceSearchSequenceRef = useRef(0);

  const visibleWorkspaceEntries = workspace
    ? filterWorkspaceEntries(workspace.entries, showHiddenEntries)
    : [];
  const visibleTreeEntries = flattenVisibleTreeEntries(visibleWorkspaceEntries, expandedPaths);
  const selectedEntry = findEntryByPath(visibleWorkspaceEntries, selectedEntryPath);
  const selectedEntries = findEntriesByPaths(visibleWorkspaceEntries, selectedEntryPaths);
  const selectedTabPath = selectedTabId ? toRelativePathFromTabId(selectedTabId) : undefined;
  const activeTab = selectedTabPath ? openTabs[selectedTabPath] : undefined;
  const activeWorkspaceContextPath = selectedTabPath ?? lastFocusedWorkspaceTabPath;
  const activeTrackingIssue = trackingDialogDismissed ? null : (trackingIssues[0] ?? null);
  const hasBlockingDialog =
    activeTrackingIssue !== null ||
    deleteDialog !== null ||
    datasetCreationDialog !== null ||
    dataRegistrationDialogOpen ||
    appSettingsDialogOpen ||
    aiSettingsDialogOpen ||
    inlineActionSettingsDialogOpen ||
    hostCommandDialog !== null;

  useEffect(() => {
    openTabsRef.current = openTabs;
  }, [openTabs]);

  const confirmDiscardDirtyTabs = async (
    dirtyPaths: string[],
    scope: "app" | "tab"
  ): Promise<boolean> => {
    try {
      return await window.integralNotes.confirmDiscardUnsavedChanges({
        dirtyPaths,
        scope
      });
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
      return false;
    }
  };

  useEffect(() => {
    const unsubscribe = window.integralNotes.onBeforeCloseRequest((request) => {
      void (async () => {
        const dirtyPaths = getDirtyTabPaths(openTabsRef.current);
        const allowClose =
          dirtyPaths.length === 0 ? true : await confirmDiscardDirtyTabs(dirtyPaths, "app");

        window.integralNotes.respondBeforeClose({
          allowClose,
          requestId: request.requestId
        });
      })();
    });

    return unsubscribe;
  }, []);

  const openMarkdownContentOverrides = useMemo(
    () =>
      Object.fromEntries(
        Object.values(openTabs)
          .filter((tab): tab is OpenMarkdownTab => isMarkdownTab(tab))
          .map((tab) => [tab.relativePath, tab.content] as const)
      ),
    [openTabs]
  );

  useEffect(() => {
    document.body.classList.toggle("integral-dialog-open", hasBlockingDialog);

    if (hasBlockingDialog && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    return () => {
      document.body.classList.remove("integral-dialog-open");
    };
  }, [hasBlockingDialog]);

  const syncTabLabel = (relativePath: string, nextName: string, dirty: boolean): void => {
    const tabId = toTabId(relativePath);

    if (!model.getNodeById(tabId)) {
      return;
    }

    const label = dirty ? `${nextName} *` : nextName;
    model.doAction(FlexLayout.Actions.renameTab(tabId, label));
  };

  const resetOpenTabs = (): void => {
    for (const relativePath of Object.keys(openTabsRef.current)) {
      const tabId = toTabId(relativePath);

      if (model.getNodeById(tabId)) {
        model.doAction(FlexLayout.Actions.deleteTab(tabId));
      }
    }

    for (const toolPlugin of workspaceToolPlugins) {
      const tabId = toWorkspaceToolTabId(toolPlugin.id);

      if (model.getNodeById(tabId)) {
        model.doAction(FlexLayout.Actions.deleteTab(tabId));
      }
    }

    setOpenTabs({});
    setLastFocusedWorkspaceTabPath(null);
    setSelectedTabId(undefined);
  };

  const invalidateWorkspaceRuntime = (): void => {
    resetIntegralPluginRuntime();
    setPluginCatalogRevision((current) => current + 1);
  };

  const clearWorkspace = (nextStatusMessage: string): void => {
    shouldAutoOpenInitialFileRef.current = false;
    setInlineEditor(null);
    setContextMenu(null);
    setDropTargetPath(null);
    setAssetCatalog(createEmptyIntegralAssetCatalog());
    setDeleteDialog(null);
    setTrackingIssues([]);
    setTrackingDialogDismissed(false);
    invalidateWorkspaceRuntime();
    resetOpenTabs();
    setWorkspace(null);
    setSelectedEntryPath("");
    setSelectedEntryPaths(new Set());
    setExpandedPaths(new Set());
    setStatusMessage(nextStatusMessage);
  };

  const applyWorkspaceSnapshot = (
    snapshot: WorkspaceSnapshot,
    options: {
      resetTabs?: boolean;
      statusMessage?: string;
    } = {}
  ): void => {
    const visibleSnapshotEntries = filterWorkspaceEntries(snapshot.entries, showHiddenEntries);

    setInlineEditor(null);
    setContextMenu(null);
    setDropTargetPath(null);

    if (options.resetTabs) {
      shouldAutoOpenInitialFileRef.current = true;
      resetOpenTabs();
      setSelectedEntryPath("");
      setSelectedEntryPaths(new Set());
      setExpandedPaths(defaultExpandedPaths(visibleSnapshotEntries));
    } else {
      closeTabsMatching(
        (relativePath) =>
          !hasEntry(visibleSnapshotEntries, relativePath) && !isHiddenWorkspacePath(relativePath)
      );
      setExpandedPaths((current) => reconcileExpandedPaths(current, visibleSnapshotEntries));

      if (!hasEntry(visibleSnapshotEntries, selectedEntryPath)) {
        setSelectedEntryPath("");
      }

      setSelectedEntryPaths((current) => {
        const next = new Set(
          Array.from(current).filter((entryPath) => hasEntry(visibleSnapshotEntries, entryPath))
        );

        if (selectedEntryPath.length > 0 && hasEntry(visibleSnapshotEntries, selectedEntryPath)) {
          next.add(selectedEntryPath);
        }

        return next;
      });
    }

    setWorkspace(snapshot);

    if (options.statusMessage) {
      setStatusMessage(options.statusMessage);
    }
  };

  const refreshManagedDataTrackingIssues = async (): Promise<void> => {
    try {
      const issues = await window.integralNotes.listManagedDataTrackingIssues();
      setTrackingIssues(issues);
      setTrackingDialogDismissed(false);
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    }
  };

  const refreshAssetCatalog = async (): Promise<void> => {
    const catalog = await window.integralNotes.getIntegralAssetCatalog();
    setIntegralPluginRuntimeCatalog(catalog);
    setAssetCatalog(catalog);
  };

  const refreshWorkspace = async (
    nextStatus?: string,
    options: {
      reloadWorkspaceRuntime?: boolean;
    } = {}
  ): Promise<void> => {
    setLoadingWorkspace(true);

    try {
      if (options.reloadWorkspaceRuntime) {
        invalidateWorkspaceRuntime();
      }

      const snapshot = options.reloadWorkspaceRuntime
        ? await window.integralNotes.syncWorkspace()
        : await window.integralNotes.getWorkspaceSnapshot();

      if (!snapshot) {
        clearWorkspace(nextStatus ?? "ワークスペースフォルダが未設定です。フォルダを開いてください。");
        return;
      }

      applyWorkspaceSnapshot(snapshot, {
        resetTabs: workspace === null,
        statusMessage: nextStatus
      });
      await Promise.all([refreshManagedDataTrackingIssues(), refreshAssetCatalog()]);
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    } finally {
      setLoadingWorkspace(false);
    }
  };

  const runWorkspaceSync = (): void => {
    if (!workspace) {
      setStatusMessage("ワークスペースフォルダを開いてください。");
      return;
    }

    if (loadingWorkspace) {
      return;
    }

    void refreshWorkspace("ワークスペースを更新しました", {
      reloadWorkspaceRuntime: true
    });
  };

  useEffect(() => {
    return window.integralNotes.onAiHostCommandApprovalRequest((request) => {
      setHostCommandDialog({
        command: request.command,
        rejectReason: "",
        request,
        status: "awaiting-approval",
        stderr: "",
        stdout: ""
      });
      setStatusMessage(`AI CLI 実行の承認待ち: ${request.purpose}`);
    });
  }, []);

  useEffect(() => {
    return window.integralNotes.onAiHostCommandExecutionUpdate((update) => {
      setHostCommandDialog((current) => applyHostCommandExecutionUpdate(current, update));
    });
  }, []);

  useEffect(() => {
    return window.integralNotes.onAiHostCommandWorkspaceSynced((event) => {
      if (event.snapshot) {
        applyWorkspaceSnapshot(event.snapshot, {
          statusMessage: event.message
        });
        void Promise.all([refreshManagedDataTrackingIssues(), refreshAssetCatalog()]);
        return;
      }

      setStatusMessage(event.message);
    });
  });

  const updateHostCommand = (command: string): void => {
    setHostCommandDialog((current) =>
      current
        ? {
            ...current,
            command
          }
        : current
    );
  };

  const updateHostCommandRejectReason = (rejectReason: string): void => {
    setHostCommandDialog((current) =>
      current
        ? {
            ...current,
            rejectReason
          }
        : current
    );
  };

  const approveHostCommand = async (): Promise<void> => {
    const current = hostCommandDialog;

    if (!current || current.status !== "awaiting-approval") {
      return;
    }

    setHostCommandDialog({
      ...current,
      status: "responding"
    });

    try {
      await window.integralNotes.respondAiHostCommandApproval({
        command: current.command,
        decision: "approved",
        id: current.request.id
      });
      setHostCommandDialog((latest) =>
        latest?.request.id === current.request.id
          ? {
              ...latest,
              status: "running"
            }
          : latest
      );
    } catch (error) {
      setHostCommandDialog((latest) =>
        latest?.request.id === current.request.id
          ? {
              ...latest,
              message: toErrorMessage(error),
              status: "failed"
            }
          : latest
      );
    }
  };

  const rejectHostCommand = async (): Promise<void> => {
    const current = hostCommandDialog;

    if (!current || current.status !== "awaiting-approval") {
      return;
    }

    setHostCommandDialog({
      ...current,
      status: "responding"
    });

    try {
      await window.integralNotes.respondAiHostCommandApproval({
        command: current.command,
        decision: "rejected",
        id: current.request.id,
        reason: current.rejectReason
      });
      setHostCommandDialog(null);
      setStatusMessage("AI CLI 実行を拒否しました。");
    } catch (error) {
      setHostCommandDialog((latest) =>
        latest?.request.id === current.request.id
          ? {
              ...latest,
              message: toErrorMessage(error),
              status: "failed"
            }
          : latest
      );
    }
  };

  const cancelHostCommand = async (): Promise<void> => {
    const current = hostCommandDialog;

    if (!current || (current.status !== "running" && current.status !== "responding")) {
      return;
    }

    try {
      const cancelled = await window.integralNotes.cancelAiHostCommandExecution(current.request.id);
      setHostCommandDialog((latest) =>
        latest?.request.id === current.request.id
          ? {
              ...latest,
              message: cancelled ? "Cancel requested." : "Command is not running yet.",
              status: cancelled ? "running" : latest.status
            }
          : latest
      );
    } catch (error) {
      setHostCommandDialog((latest) =>
        latest?.request.id === current.request.id
          ? {
              ...latest,
              message: toErrorMessage(error)
            }
          : latest
      );
    }
  };

  const reloadWorkspaceTabsFromDisk = async (relativePaths: Iterable<string>): Promise<void> => {
    const reloadTargets = Array.from(new Set(Array.from(relativePaths))).filter((relativePath) => {
      const tab = openTabsRef.current[relativePath];

      return Boolean(tab) && (!isMarkdownTab(tab) || !isDirty(tab));
    });

    if (reloadTargets.length === 0) {
      return;
    }

    const documents = await Promise.all(
      reloadTargets.map(async (relativePath) => {
        try {
          return await window.integralNotes.readWorkspaceFile(relativePath);
        } catch {
          return null;
        }
      })
    );
    const updates = documents.flatMap((document) => {
      if (!document) {
        return [];
      }

      const currentTab = openTabsRef.current[document.relativePath];

      if (!currentTab || (isMarkdownTab(currentTab) && isDirty(currentTab))) {
        return [];
      }

      const nextTab = createOpenTab(document, currentTab.name);

      if (isMarkdownTab(currentTab) && isMarkdownTab(nextTab)) {
        nextTab.editorMode = currentTab.editorMode;
      }

      return [
        {
          relativePath: document.relativePath,
          tab: nextTab
        }
      ];
    });

    if (updates.length === 0) {
      return;
    }

    setOpenTabs((currentTabs) => {
      let hasChanged = false;
      const nextTabs = { ...currentTabs };

      for (const update of updates) {
        const currentTab = currentTabs[update.relativePath];

        if (!currentTab || (isMarkdownTab(currentTab) && isDirty(currentTab))) {
          continue;
        }

        nextTabs[update.relativePath] = update.tab;
        hasChanged = true;
      }

      return hasChanged ? nextTabs : currentTabs;
    });

    for (const update of updates) {
      syncTabLabel(update.relativePath, update.tab.name, false);
    }
  };

  const runWorkspaceSearch = async (
    stateOverride?: SearchSidebarState
  ): Promise<WorkspaceSearchResult | null> => {
    const effectiveState = stateOverride ?? searchSidebarState;
    const query = effectiveState.query.trim();
    const request = createWorkspaceSearchRequest(effectiveState);
    const requestSequence = workspaceSearchSequenceRef.current + 1;

    workspaceSearchSequenceRef.current = requestSequence;

    if (!workspace || query.length === 0) {
      setWorkspaceSearchPending(false);
      setWorkspaceSearchResult(null);
      setWorkspaceSearchError(null);
      return null;
    }

    setWorkspaceSearchPending(true);
    setWorkspaceSearchError(null);

    try {
      const result = await window.integralNotes.searchWorkspaceText(request);

      if (workspaceSearchSequenceRef.current !== requestSequence) {
        return result;
      }

      setWorkspaceSearchResult(result);
      return result;
    } catch (error) {
      if (workspaceSearchSequenceRef.current === requestSequence) {
        setWorkspaceSearchResult(null);
        setWorkspaceSearchError(toErrorMessage(error));
      }

      return null;
    } finally {
      if (workspaceSearchSequenceRef.current === requestSequence) {
        setWorkspaceSearchPending(false);
      }
    }
  };

  const replaceWorkspaceSearchResults = async (): Promise<void> => {
    const query = searchSidebarState.query.trim();

    if (!workspace || query.length === 0) {
      return;
    }

    const dirtyTabPaths = new Set(
      Object.values(openTabsRef.current)
        .filter((tab): tab is OpenMarkdownTab => isMarkdownTab(tab) && isDirty(tab))
        .map((tab) => tab.relativePath)
    );
    const conflictingDirtyPath = workspaceSearchResult?.files
      .map((file) => file.relativePath)
      .find((relativePath) => dirtyTabPaths.has(relativePath));

    if (conflictingDirtyPath) {
      setWorkspaceSearchError(
        `${conflictingDirtyPath} は未保存変更があります。保存してから一括置換してください。`
      );
      return;
    }

    setWorkspaceReplacePending(true);
    setWorkspaceSearchError(null);

    try {
      const result: WorkspaceReplaceResult = await window.integralNotes.replaceWorkspaceText({
        ...createWorkspaceSearchRequest(searchSidebarState),
        replacement: searchSidebarState.replacement
      });

      applyWorkspaceSnapshot(result.snapshot, {
        statusMessage:
          result.replacedMatchCount > 0
            ? `${result.replacedFileCount} files / ${result.replacedMatchCount} matches を置換しました`
            : "置換対象はありませんでした"
      });
      await Promise.all([
        reloadWorkspaceTabsFromDisk(result.files.map((file) => file.relativePath)),
        refreshManagedDataTrackingIssues(),
        refreshAssetCatalog()
      ]);
      await runWorkspaceSearch();
    } catch (error) {
      setWorkspaceSearchError(toErrorMessage(error));
    } finally {
      setWorkspaceReplacePending(false);
    }
  };

  const openWorkspaceFolder = async (): Promise<void> => {
    setLoadingWorkspace(true);

    try {
      const snapshot = await window.integralNotes.openWorkspaceFolder();

      if (!snapshot) {
        setStatusMessage("フォルダ選択をキャンセルしました。");
        return;
      }

      invalidateWorkspaceRuntime();
      applyWorkspaceSnapshot(snapshot, {
        resetTabs: true,
        statusMessage: `${snapshot.rootName} を開きました`
      });
      await Promise.all([refreshManagedDataTrackingIssues(), refreshAssetCatalog()]);
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    } finally {
      setLoadingWorkspace(false);
    }
  };

  const applyWorkspaceTemplate = async (): Promise<void> => {
    if (!workspace) {
      setStatusMessage("ワークスペースフォルダを開いてください。");
      return;
    }

    setLoadingWorkspace(true);

    try {
      const result = await window.integralNotes.applyWorkspaceTemplate();

      if (!result) {
        setStatusMessage("初期化/更新をキャンセルしました。");
        return;
      }

      invalidateWorkspaceRuntime();
      applyWorkspaceSnapshot(result.snapshot, {
        statusMessage:
          `template を展開しました: ${result.copiedFileCount} files` +
          (result.skippedEntryCount > 0 ? ` / skipped ${result.skippedEntryCount}` : "")
      });
      await Promise.all([
        reloadWorkspaceTabsFromDisk(result.updatedRelativePaths),
        refreshManagedDataTrackingIssues(),
        refreshAssetCatalog()
      ]);
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    } finally {
      setLoadingWorkspace(false);
    }
  };

  const resolveTrackingIssue = async (
    action: ResolveIntegralManagedDataTrackingIssueRequest["action"],
    selectedPath?: string
  ): Promise<void> => {
    const issue = activeTrackingIssue;

    if (!issue) {
      return;
    }

    setTrackingResolutionPending(true);

    try {
      await window.integralNotes.resolveManagedDataTrackingIssue({
        action,
        entityType: issue.entityType,
        selectedPath,
        targetId: issue.targetId
      });
      resetIntegralPluginRuntime();
      setPluginCatalogRevision((current) => current + 1);
      await refreshWorkspace(
        action === "remove"
          ? `${issue.displayName} を管理対象から外しました。`
          : `${issue.displayName} の tracked path を更新しました。`
      );
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    } finally {
      setTrackingResolutionPending(false);
    }
  };

  const refreshInstalledPluginState = async (nextStatusMessage?: string): Promise<void> => {
    try {
      const plugins = await window.integralNotes.listInstalledPlugins();

      setInstalledPlugins(plugins);

      if (nextStatusMessage) {
        setStatusMessage(nextStatusMessage);
      }
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    }
  };

  const synchronizePluginRuntime = async (nextStatusMessage: string): Promise<void> => {
    resetIntegralPluginRuntime();
    setPluginCatalogRevision((current) => current + 1);
    await Promise.all([refreshInstalledPluginState(nextStatusMessage), refreshAssetCatalog()]);
  };

  const selectSidebarView = (viewId: string): void => {
    setContextMenu(null);
    setDropTargetPath(null);

    if (viewId !== BUILTIN_EXPLORER_SIDEBAR_VIEW_ID) {
      setInlineEditor(null);
    }

    setActiveSidebarViewId(viewId);
  };

  const openExtensionsManager = (): void => {
    openWorkspaceToolPlugin("builtin:extensions");
  };

  const openWorkspaceToolPlugin = (toolId: string): void => {
    const toolPlugin = findWorkspaceToolPlugin(toolId);

    if (!toolPlugin) {
      setStatusMessage(`workspace tool plugin が見つかりません: ${toolId}`);
      return;
    }

    const tabId = toWorkspaceToolTabId(toolPlugin.id);

    if (model.getNodeById(tabId)) {
      model.doAction(FlexLayout.Actions.selectTab(tabId));
      setSelectedTabId(tabId);
      setStatusMessage(`${toolPlugin.tabTitle} を表示中`);
      return;
    }

    const activeTabsetId =
      model.getActiveTabset()?.getId() ?? model.getNodeById(MAIN_TABSET_ID)?.getId() ?? MAIN_TABSET_ID;

    model.doAction(
      FlexLayout.Actions.addNode(
        {
          type: "tab",
          id: tabId,
          component: "editor",
          name: toolPlugin.tabTitle,
          config: {
            kind: "workspace-tool",
            toolId: toolPlugin.id
          }
        },
        activeTabsetId,
        FlexLayout.DockLocation.CENTER,
        -1,
        true
      )
    );

    setSelectedTabId(tabId);
    setStatusMessage(`${toolPlugin.tabTitle} を開きました`);
  };

  const openDataRegistrationDialog = (): void => {
    setDataRegistrationDialogOpen(true);
  };

  const loadAppSettings = async (): Promise<void> => {
    setAppSettingsPending(true);

    try {
      setAppSettings(await window.integralNotes.getAppSettings());
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    } finally {
      setAppSettingsPending(false);
    }
  };

  const openAppSettingsDialog = (): void => {
    setAppSettingsDialogOpen(true);
    void loadAppSettings();
  };

  const openInlineActionSettingsDialog = (): void => {
    setInlineActionSettingsDialogOpen(true);
  };

  const saveAppSettings = async (request: SaveAppSettingsRequest): Promise<void> => {
    setAppSettingsPending(true);

    try {
      const nextSettings = await window.integralNotes.saveAppSettings(request);
      setAppSettings(nextSettings);
      setAppSettingsDialogOpen(false);
      setStatusMessage("設定を保存しました。");
    } finally {
      setAppSettingsPending(false);
    }
  };

  const toggleHiddenEntriesVisibility = (): void => {
    const nextShowHiddenEntries = !showHiddenEntries;
    const nextVisibleEntries = workspace
      ? filterWorkspaceEntries(workspace.entries, nextShowHiddenEntries)
      : [];

    setShowHiddenEntries(nextShowHiddenEntries);
    setContextMenu(null);
    setDropTargetPath(null);
    setExpandedPaths((current) => reconcileExpandedPaths(current, nextVisibleEntries));

    if (!hasEntry(nextVisibleEntries, selectedEntryPath)) {
      setSelectedEntryPath("");
    }

    setSelectedEntryPaths(
      new Set(Array.from(selectedEntryPaths).filter((entryPath) => hasEntry(nextVisibleEntries, entryPath)))
    );
    setStatusMessage(
      nextShowHiddenEntries ? "hidden フォルダを表示しました。" : "hidden フォルダを非表示にしました。"
    );
  };

  const collapseAllExplorerEntries = (): void => {
    setInlineEditor(null);
    setContextMenu(null);
    setDropTargetPath(null);
    setExpandedPaths(new Set());
    setStatusMessage("Explorer のフォルダを全て畳みました。");
  };

  const replaceSelection = (relativePaths: Iterable<string>, primaryPath = ""): void => {
    const normalizedPaths = collapseNestedSelection(relativePaths);
    setSelectedEntryPath(primaryPath);
    setSelectedEntryPaths(new Set(normalizedPaths));
  };

  const selectSingleEntry = (relativePath: string): void => {
    replaceSelection(relativePath.length > 0 ? [relativePath] : [], relativePath);
  };

  const toggleEntrySelection = (entry: WorkspaceEntry): void => {
    setSelectedEntryPath(entry.relativePath);
    setSelectedEntryPaths((current) => {
      const next = new Set(current);

      if (next.has(entry.relativePath)) {
        next.delete(entry.relativePath);
      } else {
        next.add(entry.relativePath);
      }

      return new Set(collapseNestedSelection(next));
    });
  };

  const getActiveSelectionEntries = (fallbackEntry?: WorkspaceEntry): WorkspaceEntry[] => {
    if (!workspace) {
      return [];
    }

    if (fallbackEntry && selectedEntryPaths.has(fallbackEntry.relativePath)) {
      return findEntriesByPaths(visibleWorkspaceEntries, selectedEntryPaths);
    }

    if (selectedEntries.length > 0) {
      return selectedEntries;
    }

    return fallbackEntry ? [fallbackEntry] : [];
  };

  const handleImportedManagedFiles = async (
    managedFiles: readonly IntegralManagedFileSummary[],
    kind: "directories" | "files"
  ): Promise<void> => {
    const unit = kind === "files" ? "ファイル" : "フォルダ";
    await refreshWorkspace(`${managedFiles.length} 件の${unit}を managed file として登録しました。`);
  };

  const importManagedFileFiles = async (): Promise<void> => {
    try {
      const result = await window.integralNotes.importManagedFileFiles();

      if (!result) {
        setStatusMessage("ファイル登録をキャンセルしました。");
        return;
      }

      await refreshWorkspace(`${result.managedFiles.length} 件のファイルを登録しました。`);
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    }
  };

  const importManagedFileDirectories = async (): Promise<void> => {
    try {
      const result = await window.integralNotes.importManagedFileDirectories();

      if (!result) {
        setStatusMessage("フォルダ登録をキャンセルしました。");
        return;
      }

      await refreshWorkspace(`${result.managedFiles.length} 件のフォルダを登録しました。`);
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    }
  };

  useEffect(() => {
    void refreshWorkspace();
    void loadAppSettings();
  }, []);

  useEffect(() => {
    void refreshInstalledPluginState();
  }, []);

  useEffect(() => {
    if (!workspace || searchSidebarState.query.trim().length === 0) {
      workspaceSearchSequenceRef.current += 1;
      setWorkspaceSearchPending(false);
      setWorkspaceSearchResult(null);
      setWorkspaceSearchError(null);
      return;
    }

    setWorkspaceSearchPending(true);
    setWorkspaceSearchError(null);

    const debounceHandle = window.setTimeout(() => {
      void runWorkspaceSearch();
    }, 240);

    return () => {
      window.clearTimeout(debounceHandle);
    };
  }, [
    workspace?.rootPath,
    searchSidebarState.caseSensitive,
    searchSidebarState.excludePattern,
    searchSidebarState.includePattern,
    searchSidebarState.query,
    searchSidebarState.regex,
    searchSidebarState.wholeWord
  ]);

  useEffect(() => {
    const handleOpenWorkspaceFileEvent = (event: Event): void => {
      const customEvent = event as CustomEvent<string>;
      const rawTarget = `${customEvent.detail ?? ""}`.trim();

      if (rawTarget.length === 0) {
        return;
      }

      void openWorkspaceTarget(rawTarget);
    };
    const handleOpenManagedDataNoteEvent = (event: Event): void => {
      const customEvent = event as CustomEvent<string>;
      const targetId = `${customEvent.detail ?? ""}`.trim();

      if (targetId.length === 0) {
        return;
      }

      void openManagedDataNote(targetId);
    };

    window.addEventListener(
      OPEN_WORKSPACE_FILE_EVENT,
      handleOpenWorkspaceFileEvent as EventListener
    );
    window.addEventListener(
      OPEN_MANAGED_DATA_NOTE_EVENT,
      handleOpenManagedDataNoteEvent as EventListener
    );

    return () => {
      window.removeEventListener(
        OPEN_WORKSPACE_FILE_EVENT,
        handleOpenWorkspaceFileEvent as EventListener
      );
      window.removeEventListener(
        OPEN_MANAGED_DATA_NOTE_EVENT,
        handleOpenManagedDataNoteEvent as EventListener
      );
    };
  }, [assetCatalog, openTabs, workspace]);

  useEffect(() => {
    if (
      !workspace ||
      !shouldAutoOpenInitialFileRef.current ||
      Object.keys(openTabs).length > 0 ||
      selectedTabId
    ) {
      return;
    }

    shouldAutoOpenInitialFileRef.current = false;
    const firstFile = findFirstFile(visibleWorkspaceEntries);

    if (!firstFile) {
      return;
    }

    void openNote(firstFile.relativePath);
  }, [visibleWorkspaceEntries, workspace, openTabs, selectedTabId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "F5" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        runWorkspaceSync();
        return;
      }

      if (isZoomInShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        window.integralNotes.zoomIn();
        return;
      }

      if (isZoomOutShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        window.integralNotes.zoomOut();
        return;
      }

      if (isZoomResetShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        window.integralNotes.resetZoom();
        return;
      }

      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") {
        return;
      }

      event.preventDefault();

      if (isMarkdownTab(activeTab)) {
        void saveNote(activeTab.relativePath);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [activeTab, loadingWorkspace, workspace]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null;

      if (target?.closest(".tree-context-menu")) {
        return;
      }

      setContextMenu(null);
    };

    const closeContextMenu = (): void => {
      setContextMenu(null);
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("blur", closeContextMenu);
    window.addEventListener("resize", closeContextMenu);
    document.addEventListener("scroll", closeContextMenu, true);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("blur", closeContextMenu);
      window.removeEventListener("resize", closeContextMenu);
      document.removeEventListener("scroll", closeContextMenu, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!activeAppMenuId) {
      return;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null;

      if (target?.closest(".app-menubar")) {
        return;
      }

      setActiveAppMenuId(null);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setActiveAppMenuId(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [activeAppMenuId]);

  useEffect(() => {
    if (hasBlockingDialog) {
      setActiveAppMenuId(null);
    }
  }, [hasBlockingDialog]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && contextMenu) {
        event.preventDefault();
        setContextMenu(null);
        return;
      }

      if (inlineEditor || deleteDialog || datasetCreationDialog) {
        return;
      }

      const target = event.target as HTMLElement | null;

      if (isEditableElement(target)) {
        return;
      }

      const activeElement = document.activeElement as HTMLElement | null;

      if (activeSidebarViewId !== BUILTIN_EXPLORER_SIDEBAR_VIEW_ID) {
        return;
      }

      if (!sidebarPanelRef.current?.contains(activeElement)) {
        if (
          (event.ctrlKey || event.metaKey) &&
          ["c", "v"].includes(event.key.toLowerCase())
        ) {
          console.info("[Explorer] ignored shortcut because sidebar is not focused", {
            activeElementTag: activeElement?.tagName ?? null,
            activeElementClassName: activeElement?.className ?? null,
            key: event.key
          });
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
        event.preventDefault();
        copySelectedEntriesToClipboard();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
        event.preventDefault();
        void pasteIntoWorkspace();
        return;
      }

      if (event.key === "F2") {
        event.preventDefault();
        setContextMenu(null);
        startRenameInline();
        return;
      }

      if (event.key === "Delete") {
        event.preventDefault();
        setContextMenu(null);
        openDeleteDialog();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    contextMenu,
    datasetCreationDialog,
    deleteDialog,
    activeSidebarViewId,
    inlineEditor,
    selectedEntry,
    selectedEntryPaths
  ]);

  const clearPendingFocusedBlock = (relativePath: string): void => {
    setPendingFocusedBlockByPath((current) => {
      if (!(relativePath in current)) {
        return current;
      }

      const nextState = { ...current };
      delete nextState[relativePath];
      return nextState;
    });
  };

  const openWorkspaceTarget = async (
    rawTarget: string,
    options?: OpenWorkspaceFileOptions
  ): Promise<void> => {
    const relativePath = resolveWorkspaceMarkdownTarget(rawTarget);

    if (!relativePath) {
      return;
    }

    const blockId = extractWorkspaceBlockId(rawTarget);

    if (blockId) {
      setPendingFocusedBlockByPath((current) => ({
        ...current,
        [relativePath]: blockId
      }));
    }

    try {
      await openWorkspaceFile(relativePath, options);
    } catch (error) {
      if (blockId) {
        clearPendingFocusedBlock(relativePath);
      }

      throw error;
    }
  };

  const openNote = async (relativePath: string): Promise<void> => {
    await openWorkspaceTarget(relativePath);
  };

  const openManagedDataNote = async (targetId: string): Promise<void> => {
    const managedDataTarget = findManagedDataTargetById(assetCatalog, targetId);

    if (!managedDataTarget) {
      setStatusMessage("対応する data-note はありません。");
      return;
    }

    await openWorkspaceFile(createManagedDataNoteRelativePath(managedDataTarget.targetId), {
      tabNameOverride: managedDataTarget
        ? createManagedDataNoteTabName(managedDataTarget.displayName)
        : undefined
    });
  };

  const syncTreeSelectionForPath = (relativePath: string): void => {
    if (!workspace || !hasEntry(visibleWorkspaceEntries, relativePath)) {
      return;
    }

    selectSingleEntry(relativePath);
  };

  const openWorkspaceFile = async (
    relativePath: string,
    options?: OpenWorkspaceFileOptions
  ): Promise<void> => {
    const existingTab = openTabs[relativePath];
    const tabId = toTabId(relativePath);
    const preserveFocus = options?.preserveFocus ?? false;
    const openUnsupportedExternally = options?.openUnsupportedExternally ?? false;
    const tabNameOverride = options?.tabNameOverride;

    if (!preserveFocus) {
      syncTreeSelectionForPath(relativePath);
    }

    if (existingTab) {
      if (tabNameOverride && existingTab.name !== tabNameOverride) {
        const renamedTab = {
          ...existingTab,
          name: tabNameOverride
        };

        setOpenTabs((currentTabs) => ({
          ...currentTabs,
          [relativePath]: renamedTab
        }));
        syncTabLabel(relativePath, tabNameOverride, isDirty(renamedTab));
      }

      if (
        openUnsupportedExternally &&
        (existingTab.kind === "unsupported" || existingTab.content === null)
      ) {
        await openPathInExternalApp(relativePath);
        return;
      }

      if (!preserveFocus) {
        model.doAction(FlexLayout.Actions.selectTab(tabId));
        setSelectedTabId(tabId);
        setLastFocusedWorkspaceTabPath(relativePath);
      }
      setStatusMessage(
        preserveFocus
          ? `${tabNameOverride ?? existingTab.name} をバックグラウンドで開きました`
          : isMarkdownTab(existingTab)
            ? `${tabNameOverride ?? existingTab.name} を編集中`
            : `${tabNameOverride ?? existingTab.name} を表示中`
      );
      return;
    }

    try {
      const document = await window.integralNotes.readWorkspaceFile(relativePath);

      if (document.kind === "dataset-json" && document.datasetManifest) {
        await openWorkspaceFile(createManagedDataNoteRelativePath(document.datasetManifest.noteTargetId), {
          ...options,
          tabNameOverride: createManagedDataNoteTabName(document.datasetManifest.datasetName)
        });
        return;
      }

      if (
        openUnsupportedExternally &&
        (document.kind === "unsupported" || document.content === null)
      ) {
        await openPathInExternalApp(relativePath);
        return;
      }

      const nextTab = createOpenTab(document, tabNameOverride);

      setOpenTabs((currentTabs) => ({
        ...currentTabs,
        [relativePath]: nextTab
      }));

      const activeTabsetId =
        model.getActiveTabset()?.getId() ?? model.getNodeById(MAIN_TABSET_ID)?.getId() ?? MAIN_TABSET_ID;

      model.doAction(
        FlexLayout.Actions.addNode(
          {
            type: "tab",
            id: tabId,
            component: "editor",
            name: nextTab.name,
            config: {
              relativePath: document.relativePath
            }
          },
          activeTabsetId,
          FlexLayout.DockLocation.CENTER,
          -1,
          !preserveFocus
        )
      );

      if (!preserveFocus) {
        setSelectedTabId(tabId);
        setLastFocusedWorkspaceTabPath(relativePath);
      }
      setStatusMessage(
        preserveFocus ? `${nextTab.name} をバックグラウンドで開きました` : `${nextTab.name} を開きました`
      );
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    }
  };

  const applyLinkUpdatesToOpenTabs = (
    pathChanges: WorkspacePathChange[],
    shouldSkip: (relativePath: string) => boolean = () => false
  ): void => {
    if (pathChanges.length === 0) {
      return;
    }

    setOpenTabs((currentTabs) => {
      let hasChanged = false;
      const nextTabs: Record<string, OpenWorkspaceTab> = { ...currentTabs };

      for (const [relativePath, tab] of Object.entries(currentTabs)) {
        if (!isMarkdownTab(tab) || shouldSkip(relativePath)) {
          continue;
        }

        const nextContent = rewriteWorkspaceMarkdownReferences(tab.content, pathChanges);
        const nextSavedContent = rewriteWorkspaceMarkdownReferences(tab.savedContent, pathChanges);

        if (nextContent === tab.content && nextSavedContent === tab.savedContent) {
          continue;
        }

        nextTabs[relativePath] = {
          ...tab,
          content: nextContent,
          savedContent: nextSavedContent
        };
        hasChanged = true;
      }

      return hasChanged ? nextTabs : currentTabs;
    });
  };

  const saveNote = async (relativePath: string, contentOverride?: string): Promise<void> => {
    const tab = openTabsRef.current[relativePath];

    if (!isMarkdownTab(tab)) {
      return;
    }

    const contentToSave = contentOverride ?? tab.content;

    setOpenTabs((currentTabs) => {
      const currentTab = currentTabs[relativePath];

      if (!isMarkdownTab(currentTab)) {
        return currentTabs;
      }

      return {
        ...currentTabs,
        [relativePath]: {
          ...currentTab,
          isSaving: true
        }
      };
    });

    try {
      const normalizedContent = normalizeIntegralBlockInputReferencesInMarkdown(
        contentToSave,
        assetCatalog
      );
      const savedNote = await window.integralNotes.saveNote(relativePath, normalizedContent);
      let isStillDirty = false;

      setOpenTabs((currentTabs) => {
        const currentTab = currentTabs[relativePath];

        if (!isMarkdownTab(currentTab)) {
          return currentTabs;
        }

        const hasNewerContent =
          currentTab.content !== contentToSave && currentTab.content !== savedNote.content;
        const nextTab: OpenMarkdownTab = {
          ...currentTab,
          content: hasNewerContent ? currentTab.content : savedNote.content,
          isSaving: false,
          modifiedAt: savedNote.modifiedAt,
          name: savedNote.name,
          savedContent: savedNote.content
        };
        isStillDirty = isDirty(nextTab);

        return {
          ...currentTabs,
          [relativePath]: nextTab
        };
      });

      syncTabLabel(relativePath, savedNote.name, isStillDirty);
      setStatusMessage(`${savedNote.name} を保存しました`);
    } catch (error) {
      setOpenTabs((currentTabs) => {
        const currentTab = currentTabs[relativePath];

        if (!isMarkdownTab(currentTab)) {
          return currentTabs;
        }

        return {
          ...currentTabs,
          [relativePath]: {
            ...currentTab,
            isSaving: false
          }
        };
      });
      setStatusMessage(toErrorMessage(error));
    }
  };

  const closeWorkspaceTabImmediately = (relativePath: string): void => {
    const tabId = toTabId(relativePath);

    if (model.getNodeById(tabId)) {
      model.doAction(FlexLayout.Actions.deleteTab(tabId));
    }

    setOpenTabs((currentTabs) => {
      if (!(relativePath in currentTabs)) {
        return currentTabs;
      }

      const nextTabs = { ...currentTabs };
      delete nextTabs[relativePath];
      return nextTabs;
    });
    setSelectedTabId(findSelectedTabId(model));
  };

  const requestCloseDirtyTab = (relativePath: string): void => {
    if (pendingTabCloseConfirmationRef.current.has(relativePath)) {
      return;
    }

    pendingTabCloseConfirmationRef.current.add(relativePath);
    void (async () => {
      try {
        const tab = openTabsRef.current[relativePath];

        if (!isDirty(tab)) {
          closeWorkspaceTabImmediately(relativePath);
          return;
        }

        const shouldDiscard = await confirmDiscardDirtyTabs([relativePath], "tab");

        if (shouldDiscard) {
          closeWorkspaceTabImmediately(relativePath);
        }
      } finally {
        pendingTabCloseConfirmationRef.current.delete(relativePath);
      }
    })();
  };

  const closeTabsMatching = (predicate: (relativePath: string) => boolean): void => {
    const targetPaths = Object.keys(openTabsRef.current).filter(predicate);

    if (targetPaths.length === 0) {
      return;
    }

    for (const relativePath of targetPaths) {
      const tabId = toTabId(relativePath);

      if (model.getNodeById(tabId)) {
        model.doAction(FlexLayout.Actions.deleteTab(tabId));
      }
    }

    setOpenTabs((currentTabs) => {
      let changed = false;
      const nextTabs = { ...currentTabs };

      for (const relativePath of targetPaths) {
        if (relativePath in nextTabs) {
          delete nextTabs[relativePath];
          changed = true;
        }
      }

      return changed ? nextTabs : currentTabs;
    });
  };

  const syncSelectedLayoutTab = (tabId: string | undefined): void => {
    setSelectedTabId(tabId);

    if (!tabId) {
      return;
    }

    const relativePath = toRelativePathFromTabId(tabId);

    if (relativePath) {
      setLastFocusedWorkspaceTabPath(relativePath);
      syncTreeSelectionForPath(relativePath);
    }
  };

  const selectLayoutTab = (tabId: string): void => {
    if (!model.getNodeById(tabId)) {
      return;
    }

    model.doAction(FlexLayout.Actions.selectTab(tabId));
    syncSelectedLayoutTab(tabId);
  };

  const selectAdjacentLayoutTab = (direction: -1 | 1): void => {
    const nextTabId = findAdjacentLayoutTabId(model, selectedTabId, direction);

    if (nextTabId) {
      selectLayoutTab(nextTabId);
    }
  };

  const closeSelectedLayoutTab = (): void => {
    const currentTabId =
      selectedTabId && model.getNodeById(selectedTabId) ? selectedTabId : findSelectedTabId(model);

    if (!currentTabId || !model.getNodeById(currentTabId)) {
      return;
    }

    const relativePath = toRelativePathFromTabId(currentTabId);

    if (relativePath) {
      requestCloseDirtyTab(relativePath);
      return;
    }

    model.doAction(FlexLayout.Actions.deleteTab(currentTabId));
    syncSelectedLayoutTab(findSelectedTabId(model));
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (hasBlockingDialog) {
        return;
      }

      if (isLayoutTabSwitchShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        selectAdjacentLayoutTab(event.shiftKey ? -1 : 1);
        return;
      }

      if (isCloseSelectedLayoutTabShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        closeSelectedLayoutTab();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  });

  const handleCreateResult = async (result: CreateEntryResult): Promise<void> => {
    setWorkspace(result.snapshot);
    replaceSelection([result.entry.relativePath], result.entry.relativePath);

    if (result.entry.kind === "directory") {
      setExpandedPaths((current) => {
        const next = new Set(current);
        next.add(result.entry.relativePath);
        return next;
      });
      setStatusMessage(`${result.entry.name} を作成しました`);
      return;
    }

    setStatusMessage(`${result.entry.name} を作成しました`);
    await openNote(result.entry.relativePath);
  };

  const handleRenameResult = async (result: RenameEntryResult): Promise<void> => {
    const pathChanges = createRenamePathChanges(result);
    setWorkspace(result.snapshot);
    replaceSelection([result.entry.relativePath], result.entry.relativePath);
    applyLinkUpdatesToOpenTabs(pathChanges, (relativePath) => relativePath === result.previousRelativePath);

    if (result.entry.kind === "file") {
      closeTabsMatching((relativePath) => relativePath === result.previousRelativePath);
      setStatusMessage(`${result.entry.name} にリネームしました`);
      await openNote(result.entry.relativePath);
      return;
    }

    closeTabsMatching(
      (relativePath) =>
        relativePath === result.previousRelativePath ||
        relativePath.startsWith(`${result.previousRelativePath}/`)
    );

    setExpandedPaths((current) => {
      const next = new Set<string>();

      for (const entryPath of current) {
        if (entryPath === result.previousRelativePath) {
          next.add(result.entry.relativePath);
          continue;
        }

        if (entryPath.startsWith(`${result.previousRelativePath}/`)) {
          next.add(entryPath.replace(result.previousRelativePath, result.entry.relativePath));
          continue;
        }

        next.add(entryPath);
      }

      next.add(result.entry.relativePath);
      return next;
    });

    setStatusMessage(`${result.entry.name} にリネームしました`);
  };

  const handleDeleteEntriesResult = (result: DeleteEntriesResult): void => {
    setWorkspace(result.snapshot);
    replaceSelection([], "");

    closeTabsMatching((relativePath) =>
      result.deletedRelativePaths.some(
        (deletedPath) => relativePath === deletedPath || relativePath.startsWith(`${deletedPath}/`)
      )
    );

    setExpandedPaths((current) => {
      const next = new Set<string>();

      for (const entryPath of current) {
        if (
          result.deletedRelativePaths.some(
            (deletedPath) => entryPath === deletedPath || entryPath.startsWith(`${deletedPath}/`)
          )
        ) {
          continue;
        }

        next.add(entryPath);
      }

      return next;
    });

    setStatusMessage(
      result.deletedRelativePaths.length === 1
        ? `${basename(result.deletedRelativePaths[0] ?? "")} を削除しました`
        : `${result.deletedRelativePaths.length} 件を削除しました`
    );
  };

  const handleCopyEntriesResult = (result: CopyEntriesResult, summary: string): void => {
    setWorkspace(result.snapshot);

    const createdPaths = result.createdEntries.map((entry) => entry.relativePath);
    replaceSelection(createdPaths, createdPaths[0] ?? "");
    setStatusMessage(summary);
  };

  const handleMoveEntriesResult = (result: MoveEntriesResult): void => {
    if (result.movedEntries.length === 0) {
      setStatusMessage("移動先が変わりませんでした。");
      return;
    }

    const pathChanges = createMovePathChanges(result);
    setWorkspace(result.snapshot);

    const movedPaths = result.movedEntries.map((entry) => entry.relativePath);
    replaceSelection(movedPaths, movedPaths[0] ?? "");
    applyLinkUpdatesToOpenTabs(pathChanges, (relativePath) =>
      result.previousRelativePaths.some(
        (previousPath) => relativePath === previousPath || relativePath.startsWith(`${previousPath}/`)
      )
    );
    closeTabsMatching((relativePath) =>
      result.previousRelativePaths.some(
        (previousPath) => relativePath === previousPath || relativePath.startsWith(`${previousPath}/`)
      )
    );
    setExpandedPaths((current) => {
      const next = new Set<string>();

      for (const entryPath of current) {
        let rewrittenPath = entryPath;

        for (let index = 0; index < result.previousRelativePaths.length; index += 1) {
          const previousPath = result.previousRelativePaths[index];
          const nextPath = result.movedEntries[index]?.relativePath;

          if (!nextPath) {
            continue;
          }

          if (rewrittenPath === previousPath) {
            rewrittenPath = nextPath;
            break;
          }

          if (rewrittenPath.startsWith(`${previousPath}/`)) {
            rewrittenPath = rewrittenPath.replace(previousPath, nextPath);
            break;
          }
        }

        next.add(rewrittenPath);
      }

      result.movedEntries
        .filter((entry) => entry.kind === "directory")
        .forEach((entry) => next.add(entry.relativePath));

      return next;
    });
    setStatusMessage(
      result.movedEntries.length === 1
        ? `${result.movedEntries[0]?.name ?? "項目"} を移動しました`
        : `${result.movedEntries.length} 件を移動しました`
    );
  };

  const handleSaveClipboardImageResult = (result: SaveClipboardImageResult): void => {
    setWorkspace(result.snapshot);
    replaceSelection([result.entry.relativePath], result.entry.relativePath);
    setStatusMessage(`${result.entry.name} を貼り付けました`);
  };

  const getPasteDestinationDirectoryPath = (targetEntry?: WorkspaceEntry): string => {
    const baseEntry = targetEntry ?? selectedEntry;
    return getEntryDirectoryPath(baseEntry);
  };

  const copySelectedEntriesToClipboard = (targetEntry?: WorkspaceEntry): void => {
    const entriesToCopy = getActiveSelectionEntries(targetEntry);

    if (entriesToCopy.length === 0) {
      setStatusMessage("コピー対象を選択してください。");
      return;
    }

    const sourcePaths = collapseNestedSelection(entriesToCopy.map((entry) => entry.relativePath));
    window.integralNotes.writeWorkspaceSelectionToClipboard(sourcePaths);
    setContextMenu(null);
    setStatusMessage(
      sourcePaths.length === 1 ? `${basename(sourcePaths[0] ?? "")} をコピーしました` : `${sourcePaths.length} 件をコピーしました`
    );
  };

  const pasteIntoWorkspace = async (targetEntry?: WorkspaceEntry): Promise<void> => {
    if (!workspace) {
      setStatusMessage("ワークスペースフォルダを開いてください。");
      return;
    }

    const destinationDirectoryPath = getPasteDestinationDirectoryPath(targetEntry);

    try {
      const workspaceSelectionPaths = collapseNestedSelection(
        await window.integralNotes.readWorkspaceSelectionFromClipboard()
      );

      if (workspaceSelectionPaths.length > 0) {
        const result = await window.integralNotes.copyEntries({
          destinationDirectoryPath,
          sourcePaths: workspaceSelectionPaths
        });

        handleCopyEntriesResult(
          result,
          result.createdEntries.length === 1
            ? `${result.createdEntries[0]?.name ?? "項目"} を貼り付けました`
            : `${result.createdEntries.length} 件を貼り付けました`
        );
        return;
      }

      const externalClipboardPaths = await window.integralNotes.readClipboardExternalPaths();

      console.info("[Explorer] external clipboard probe", {
        destinationDirectoryPath,
        externalClipboardPaths
      });

      if (externalClipboardPaths.length > 0) {
        const result = await window.integralNotes.copyExternalEntries({
          destinationDirectoryPath,
          sourceAbsolutePaths: externalClipboardPaths
        });

        handleCopyEntriesResult(
          result,
          result.createdEntries.length === 1
            ? `${result.createdEntries[0]?.name ?? "項目"} を貼り付けました`
            : `${result.createdEntries.length} 件を貼り付けました`
        );
        return;
      }

      if (await window.integralNotes.clipboardHasImage()) {
        const result = await window.integralNotes.saveClipboardImage({
          targetDirectoryPath: destinationDirectoryPath
        });

        handleSaveClipboardImageResult(result);
        return;
      }

      setStatusMessage("貼り付け可能なファイル・フォルダ・画像がありません。");
    } catch (error) {
      console.error("[Explorer] failed to paste into workspace", error);
      setStatusMessage(toErrorMessage(error));
    } finally {
      setContextMenu(null);
    }
  };

  const copyEntryPathsToClipboard = (
    mode: "absolute" | "relative",
    targetEntry?: WorkspaceEntry
  ): void => {
    if (!workspace) {
      return;
    }

    const entriesToCopy = getActiveSelectionEntries(targetEntry);

    if (entriesToCopy.length === 0) {
      setStatusMessage("コピー対象を選択してください。");
      return;
    }

    const values = entriesToCopy.map((entry) =>
      mode === "absolute"
        ? joinWorkspaceAbsolutePath(workspace.rootPath, entry.relativePath)
        : entry.relativePath
    );
    window.integralNotes.writeClipboardText(values.join("\n"));
    setContextMenu(null);
    setStatusMessage(
      mode === "absolute"
        ? "パスをクリップボードへコピーしました"
        : "相対パスをクリップボードへコピーしました"
    );
  };

  const openDatasetCreationDialog = (targetEntry?: WorkspaceEntry): void => {
    const entriesToAdd = getActiveSelectionEntries(targetEntry);

    if (entriesToAdd.length === 0) {
      setStatusMessage("dataset に追加する項目を選択してください。");
      return;
    }

    setContextMenu(null);
    setDatasetCreationDialog({
      defaultName: createDefaultDatasetName(entriesToAdd),
      relativePaths: collapseNestedSelection(entriesToAdd.map((entry) => entry.relativePath))
    });
  };

  const submitDatasetCreationDialog = async (datasetName: string): Promise<void> => {
    if (!datasetCreationDialog) {
      return;
    }

    setDatasetCreationPending(true);

    try {
      const result = await window.integralNotes.createDatasetFromWorkspaceEntries({
        name: datasetName.trim(),
        relativePaths: datasetCreationDialog.relativePaths
      });

      setDatasetCreationDialog(null);
      setStatusMessage(`${result.dataset.name} を作成しました`);
      await refreshWorkspace();
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    } finally {
      setDatasetCreationPending(false);
    }
  };

  const openPathInExternalApp = async (relativePath: string): Promise<void> => {
    try {
      await window.integralNotes.openPathInExternalApp(relativePath);
      setStatusMessage(`${basename(relativePath)} を既定アプリで開きました`);
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    }
  };

  const openPathInFileManager = async (relativePath?: string | null): Promise<void> => {
    try {
      await window.integralNotes.openPathInFileManager(relativePath ?? null);
      setContextMenu(null);
      setStatusMessage(
        relativePath && relativePath.trim().length > 0
          ? `${basename(relativePath)} をエクスプローラーで開きました`
          : `${workspace?.rootName ?? "workspace"} をエクスプローラーで開きました`
      );
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    }
  };

  const openWorkspaceInVSCode = async (): Promise<void> => {
    try {
      await window.integralNotes.openWorkspaceInVSCode();
      setStatusMessage(`${workspace?.rootName ?? "workspace"} をVSCodeで開きました`);
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    }
  };

  const addPythonScriptToUserStock = async (relativePath: string): Promise<void> => {
    try {
      const result = await window.integralNotes.addPythonScriptToUserStock(relativePath);
      setContextMenu(null);
      setStatusMessage(`${result.fileName} をユーザーストックに追加しました: ${result.stockPath}`);
      await refreshAssetCatalog();
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    }
  };

  const submitInlineEditor = async (value: string): Promise<void> => {
    if (!inlineEditor) {
      return;
    }

    setInlineEditorPending(true);

    try {
      if (inlineEditor.mode === "create") {
        const result = await window.integralNotes.createEntry({
          parentPath: inlineEditor.parentPath,
          name: value,
          kind: inlineEditor.kind
        });

        setInlineEditor(null);
        await handleCreateResult(result);
      }

      if (inlineEditor.mode === "rename") {
        const result = await window.integralNotes.renameEntry({
          targetPath: inlineEditor.targetPath,
          nextName: value
        });

        setInlineEditor(null);
        await handleRenameResult(result);
      }
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    } finally {
      setInlineEditorPending(false);
    }
  };

  const startCreateInline = (kind: WorkspaceEntryKind, targetEntry?: WorkspaceEntry): void => {
    if (!workspace) {
      setStatusMessage("ワークスペースフォルダを開いてください。");
      return;
    }

    const baseEntry = targetEntry ?? selectedEntry;
    const basePath =
      baseEntry?.kind === "directory"
        ? baseEntry.relativePath
        : baseEntry
          ? dirname(baseEntry.relativePath)
          : "";
    const locationLabel = basePath.length > 0 ? `${basePath} 配下` : `${workspace.rootName} 直下`;

    setDeleteDialog(null);
    setContextMenu(null);
    setInlineEditor({
      mode: "create",
      initialValue: "",
      kind,
      parentPath: basePath
    });
    replaceSelection(baseEntry ? [baseEntry.relativePath] : [], baseEntry?.relativePath ?? "");
    setStatusMessage(
      `${locationLabel}に${kind === "file" ? "ノート" : "フォルダ"}を作成します。名前を入力してください。`
    );

    if (basePath.length > 0) {
      setExpandedPaths((current) => {
        const next = new Set(current);
        next.add(basePath);
        return next;
      });
    }
  };

  const startRenameInline = (targetEntry?: WorkspaceEntry): void => {
    const entriesToRename = getActiveSelectionEntries(targetEntry);
    const entry = targetEntry ?? selectedEntry;

    if (entriesToRename.length > 1) {
      setStatusMessage("複数選択時は名前を変更できません。");
      return;
    }

    if (!entry) {
      setStatusMessage("リネーム対象を選択してください。");
      return;
    }

    setDeleteDialog(null);
    setContextMenu(null);
    setInlineEditor({
      mode: "rename",
      initialValue: displayNameForRename(entry),
      kind: entry.kind,
      targetPath: entry.relativePath
    });
    replaceSelection([entry.relativePath], entry.relativePath);
    setStatusMessage(`${entry.name} をリネームします。名前を編集してください。`);
  };

  const openDeleteDialog = (targetEntry?: WorkspaceEntry): void => {
    const entriesToDelete = getActiveSelectionEntries(targetEntry);

    if (entriesToDelete.length === 0) {
      setStatusMessage("削除対象を選択してください。");
      return;
    }

    setInlineEditor(null);
    setContextMenu(null);
    const targetPaths = collapseNestedSelection(entriesToDelete.map((entry) => entry.relativePath));
    const managedTargets = collectManagedDataTargetsForPaths(assetCatalog, targetPaths);
    const cleanupDescription =
      managedTargets.length > 0
        ? ` 対象に managed data が ${managedTargets.length} 件含まれるため、対応する metadata / data-note も削除し、必要なら関連する dataset の .idts も更新します。`
        : "";
    setDeleteDialog({
      title: "削除確認",
      description:
        entriesToDelete.length === 1
          ? entriesToDelete[0]?.kind === "directory"
            ? `${entriesToDelete[0]?.name ?? ""} 配下も含めて削除します。${cleanupDescription}`
            : `${entriesToDelete[0]?.name ?? ""} を削除します。${cleanupDescription}`
          : `${entriesToDelete.length} 件を削除します。フォルダ配下も含めて削除されます。${cleanupDescription}`,
      confirmLabel: "Delete",
      targetPaths
    });
  };

  const submitDeleteDialog = async (): Promise<void> => {
    if (!deleteDialog) {
      return;
    }

    setDeleteDialogPending(true);

    try {
      const result = await window.integralNotes.deleteEntries({
        targetPaths: deleteDialog.targetPaths
      });

      handleDeleteEntriesResult(result);
      setDeleteDialog(null);
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    } finally {
      setDeleteDialogPending(false);
    }
  };

  const openTreeContextMenu = (entry: WorkspaceEntry, x: number, y: number): void => {
    const position = clampContextMenuPosition(x, y);
    focusExplorerSidebar();

    if (!selectedEntryPaths.has(entry.relativePath)) {
      replaceSelection([entry.relativePath], entry.relativePath);
    } else {
      setSelectedEntryPath(entry.relativePath);
    }

    setContextMenu({
      entry,
      scope: "entry",
      x: position.x,
      y: position.y
    });
  };

  const openTreeRootContextMenu = (x: number, y: number): void => {
    const position = clampContextMenuPosition(x, y);
    focusExplorerSidebar();

    replaceSelection([], "");
    setContextMenu({
      scope: "root",
      x: position.x,
      y: position.y
    });
  };

  const handleActivateEntry = (entry: WorkspaceEntry, event: ReactMouseEvent<HTMLButtonElement>): void => {
    if (inlineEditor) {
      return;
    }

    focusExplorerSidebar();
    const isAdditiveSelection = event.ctrlKey || event.metaKey;

    if (event.shiftKey) {
      const rangePaths = findSelectionRangePaths(
        visibleTreeEntries,
        selectedEntryPath,
        entry.relativePath
      );

      if (isAdditiveSelection) {
        replaceSelection(new Set([...selectedEntryPaths, ...rangePaths]), entry.relativePath);
      } else {
        replaceSelection(rangePaths, entry.relativePath);
      }

      setContextMenu(null);
      return;
    }

    if (isAdditiveSelection) {
      event.preventDefault();
      toggleEntrySelection(entry);
      return;
    }

    selectSingleEntry(entry.relativePath);
    setContextMenu(null);

    if (entry.kind === "directory") {
      setExpandedPaths((current) => {
        const next = new Set(current);

        if (next.has(entry.relativePath)) {
          next.delete(entry.relativePath);
        } else {
          next.add(entry.relativePath);
        }

        return next;
      });
      return;
    }

    void openNote(entry.relativePath);
  };

  const handleDoubleActivateEntry = async (
    entry: WorkspaceEntry,
    event: ReactMouseEvent<HTMLButtonElement>
  ): Promise<void> => {
    if (entry.kind !== "file") {
      return;
    }

    event.preventDefault();
    const existingTab = openTabsRef.current[entry.relativePath];

    if (existingTab?.kind === "unsupported" || existingTab?.content === null) {
      await openPathInExternalApp(entry.relativePath);
      return;
    }

    if (existingTab) {
      return;
    }

    try {
      const document = await window.integralNotes.readWorkspaceFile(entry.relativePath);

      if (document.kind === "unsupported" || document.content === null) {
        await openPathInExternalApp(entry.relativePath);
      }
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    }
  };

  const handleDragStartEntry = (
    entry: WorkspaceEntry,
    event: ReactDragEvent<HTMLButtonElement>
  ): void => {
    const dragPaths = selectedEntryPaths.has(entry.relativePath)
      ? collapseNestedSelection(selectedEntryPaths)
      : [entry.relativePath];

    if (!selectedEntryPaths.has(entry.relativePath)) {
      replaceSelection([entry.relativePath], entry.relativePath);
    }

    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData(TREE_DRAG_MIME, JSON.stringify(dragPaths));
    event.dataTransfer.setData("text/plain", dragPaths.join("\n"));
  };

  const handleDragOverEntry = (entry: WorkspaceEntry, event: ReactDragEvent<HTMLDivElement>): void => {
    const hasInternalPayload = event.dataTransfer.types.includes(TREE_DRAG_MIME);
    const hasExternalFiles = hasExternalTransferFiles(event.dataTransfer);

    if (!hasInternalPayload && !hasExternalFiles) {
      return;
    }

    event.preventDefault();
    const destinationPath = getEntryDirectoryPath(entry);
    setDropTargetPath(entry.relativePath);
    event.dataTransfer.dropEffect = hasInternalPayload && !(event.ctrlKey || event.metaKey) ? "move" : "copy";

    if (destinationPath.length === 0 && entry.kind !== "directory") {
      setDropTargetPath(entry.relativePath);
    }
  };

  const handleDragEnd = (): void => {
    setDropTargetPath(null);
  };

  const handleDropOnEntry = async (
    entry: WorkspaceEntry,
    event: ReactDragEvent<HTMLDivElement>
  ): Promise<void> => {
    event.preventDefault();
    setDropTargetPath(null);
    const destinationDirectoryPath = getEntryDirectoryPath(entry);

    try {
      if (event.dataTransfer.types.includes(TREE_DRAG_MIME)) {
        const payload = event.dataTransfer.getData(TREE_DRAG_MIME);
        const sourcePaths = collapseNestedSelection(JSON.parse(payload) as string[]);

        if (event.ctrlKey || event.metaKey) {
          const result = await window.integralNotes.copyEntries({
            destinationDirectoryPath,
            sourcePaths
          });

          handleCopyEntriesResult(
            result,
            result.createdEntries.length === 1
              ? `${result.createdEntries[0]?.name ?? "項目"} をコピーしました`
              : `${result.createdEntries.length} 件をコピーしました`
          );
          return;
        }

        const result = await window.integralNotes.moveEntries({
          destinationDirectoryPath,
          sourcePaths
        });

        handleMoveEntriesResult(result);
        return;
      }

      const sourceAbsolutePaths = collectExternalTransferAbsolutePaths(event.dataTransfer);

      console.info("[Explorer] external drop on entry", {
        destinationDirectoryPath,
        fileCount: event.dataTransfer.files.length,
        itemKinds: Array.from(event.dataTransfer.items).map((item) => item.kind),
        types: Array.from(event.dataTransfer.types),
        sourceAbsolutePaths
      });

      if (sourceAbsolutePaths.length === 0) {
        return;
      }

      const result = await window.integralNotes.copyExternalEntries({
        destinationDirectoryPath,
        sourceAbsolutePaths
      });

      handleCopyEntriesResult(
        result,
        result.createdEntries.length === 1
          ? `${result.createdEntries[0]?.name ?? "項目"} を取り込みました`
          : `${result.createdEntries.length} 件を取り込みました`
      );
    } catch (error) {
      console.error("[Explorer] failed to handle external drop on entry", error);
      setStatusMessage(toErrorMessage(error));
    }
  };

  const updateTabContent = (relativePath: string, nextContent: string): void => {
    const currentTab = openTabsRef.current[relativePath];

    if (!isMarkdownTab(currentTab) || currentTab.content === nextContent) {
      return;
    }

    const nextTab: OpenMarkdownTab = {
      ...currentTab,
      content: nextContent
    };

    setOpenTabs((currentTabs) => ({
      ...currentTabs,
      [relativePath]: nextTab
    }));

    syncTabLabel(relativePath, currentTab.name, isDirty(nextTab));
  };

  const setMarkdownEditorMode = (
    relativePath: string,
    nextEditorMode: MarkdownEditorMode
  ): void => {
    const currentTab = openTabsRef.current[relativePath];

    if (!isMarkdownTab(currentTab) || currentTab.editorMode === nextEditorMode) {
      return;
    }

    setOpenTabs((currentTabs) => {
      const activeTab = currentTabs[relativePath];

      if (!isMarkdownTab(activeTab) || activeTab.editorMode === nextEditorMode) {
        return currentTabs;
      }

      return {
        ...currentTabs,
        [relativePath]: {
          ...activeTab,
          editorMode: nextEditorMode
        }
      };
    });

    setStatusMessage(
      nextEditorMode === "text"
        ? `${currentTab.name} を Markdown 編集で編集中`
        : `${currentTab.name} を見たまま編集で編集中`
    );
  };

  const handleLayoutAction = (action: FlexLayout.Action): FlexLayout.Action | undefined => {
    if (action.type !== FlexLayout.Actions.DELETE_TAB) {
      return action;
    }

    const relativePath = toRelativePathFromTabId(action.data.node as string);

    if (!relativePath || !isDirty(openTabsRef.current[relativePath])) {
      return action;
    }

    requestCloseDirtyTab(relativePath);
    return undefined;
  };

  const handleLayoutModelChange = (
    nextModel: FlexLayout.Model,
    action: FlexLayout.Action
  ): void => {
    if (action.type === FlexLayout.Actions.DELETE_TAB) {
      const relativePath = toRelativePathFromTabId(action.data.node as string);

      if (relativePath) {
        setOpenTabs((currentTabs) => {
          const nextTabs = { ...currentTabs };
          delete nextTabs[relativePath];
          return nextTabs;
        });
      }

      setSelectedTabId(findSelectedTabId(nextModel));
      return;
    }

    if (action.type === FlexLayout.Actions.SELECT_TAB) {
      const nextTabId = action.data.tabNode as string;
      const relativePath = toRelativePathFromTabId(nextTabId);

      setSelectedTabId(nextTabId);

      if (relativePath) {
        setLastFocusedWorkspaceTabPath(relativePath);
        syncTreeSelectionForPath(relativePath);
      }

      return;
    }

    if (action.type === FlexLayout.Actions.ADD_NODE) {
      const nextTabId = findSelectedTabId(nextModel);

      if (nextTabId) {
        setSelectedTabId(nextTabId);
        const relativePath = toRelativePathFromTabId(nextTabId);

        if (relativePath) {
          setLastFocusedWorkspaceTabPath(relativePath);
        }
      }
    }
  };

  const editorFactory = (node: FlexLayout.TabNode): JSX.Element => {
    const nodeConfig = node.getConfig() as
      | {
          kind?: string;
          relativePath?: string;
          toolId?: string;
        }
      | undefined;
    const toolId =
      nodeConfig?.kind === "workspace-tool" ? nodeConfig.toolId : toWorkspaceToolIdFromTabId(node.getId());

    if (toolId) {
      const toolPlugin = findWorkspaceToolPlugin(toolId);

      if (!toolPlugin) {
        return (
          <div className="editor-empty">
            対応する workspace tool plugin が見つかりません。
          </div>
        );
      }

      return toolPlugin.render({
        assetCatalog,
        contextRelativePath: activeWorkspaceContextPath ?? null,
        noteOverrides: openMarkdownContentOverrides,
        onOpenWorkspaceFile: (relativePath) => {
          void openWorkspaceFile(relativePath, {
            preserveFocus: true,
            openUnsupportedExternally: true
          });
        },
        onOpenWorkspaceTarget: (target) => {
          void openWorkspaceTarget(target, {
            preserveFocus: true,
            openUnsupportedExternally: true
          });
        },
        onPluginRuntimeChanged: synchronizePluginRuntime,
        onRefreshWorkspace: refreshWorkspace,
        onSetStatusMessage: setStatusMessage,
        selectedEntryPaths: Array.from(selectedEntryPaths).sort((left, right) =>
          left.localeCompare(right)
        ),
        workspaceEntries: workspace?.entries ?? [],
        workspaceRevision: pluginCatalogRevision,
        workspaceRootName: workspace?.rootName ?? null
      });
    }

    const relativePath = nodeConfig?.relativePath;

    if (!relativePath) {
      return <div className="editor-empty">ファイルを選択してください。</div>;
    }

    const tab = openTabs[relativePath];

    if (!tab) {
      return (
        <div className="editor-empty">
          ファイルの状態が見つかりません。サイドバーから再度開いてください。
        </div>
      );
    }

    if (isMarkdownTab(tab)) {
      const toggleLabel = tab.editorMode === "wysiwyg" ? "Markdown編集" : "見たまま編集";
      const managedDataTarget = findManagedDataTargetForPath(assetCatalog, relativePath);
      const editorToolbar = (
        <>
          {managedDataTarget ? (
            <button
              className="button button--note button--xs"
              onClick={() => {
                void openManagedDataNote(managedDataTarget.targetId);
              }}
              title={`${managedDataTarget.displayName} に対応するノートを別タブで開きます。`}
              type="button"
            >
              ノートを開く
            </button>
          ) : null}
          <button
            className="button button--ghost button--xs editor-mode-toggle"
            onClick={() => {
              setMarkdownEditorMode(
                relativePath,
                tab.editorMode === "wysiwyg" ? "text" : "wysiwyg"
              );
            }}
            title={
              tab.editorMode === "wysiwyg"
                ? "本文を Markdown テキストとして編集します。frontmatter は保持されます。"
                : "本文を見たまま編集に戻します。frontmatter は保持されます。"
            }
            type="button"
          >
            {toggleLabel}
          </button>
        </>
      );

      if (tab.editorMode === "text") {
        return (
          <RawMarkdownEditor
            isActive={selectedTabPath === relativePath}
            onChange={(markdown) => {
              updateTabContent(relativePath, markdown);
            }}
            toolbar={editorToolbar}
            value={tab.content}
          />
        );
      }

      return (
        <MilkdownEditor
          focusedBlockId={pendingFocusedBlockByPath[relativePath] ?? null}
          initialValue={tab.content}
          isActive={selectedTabPath === relativePath}
          key={`${relativePath}:${tab.editorMode}:${pluginCatalogRevision}`}
          analysisResultDirectory={appSettings?.analysisResultDirectory ?? null}
          linkPickerRanking={appSettings?.linkPickerRanking ?? DEFAULT_LINK_PICKER_RANKING}
          onChange={(markdown) => {
            updateTabContent(relativePath, markdown);
          }}
          onFocusedBlockHandled={() => {
            clearPendingFocusedBlock(relativePath);
          }}
          onIntegralAssetCatalogChanged={(catalog) => {
            setIntegralPluginRuntimeCatalog(catalog);
            setAssetCatalog(catalog);
          }}
          onOpenWorkspaceFile={(target) => {
            void openWorkspaceTarget(target, {
              openUnsupportedExternally: true
            });
          }}
          onRequestSave={(markdown) => saveNote(relativePath, markdown)}
          onWorkspaceSnapshotChanged={(snapshot, statusMessage) => {
            applyWorkspaceSnapshot(snapshot, {
              statusMessage: statusMessage ?? "画像を workspace に保存しました"
            });
          }}
          onWorkspaceLinkError={(message) => {
            setStatusMessage(message);
          }}
          relativePath={relativePath}
          selectedEntryPaths={Array.from(selectedEntryPaths).sort((left, right) =>
            left.localeCompare(right)
          )}
          toolbar={editorToolbar}
          workspaceEntries={visibleWorkspaceEntries}
          workspaceRootName={workspace?.rootName ?? null}
        />
      );
    }

    const managedDataTarget = findManagedDataTargetForPath(assetCatalog, relativePath);

    return (
      <WorkspaceFileViewer
        file={tab}
        managedDataAction={
          managedDataTarget
            ? {
                buttonLabel: "ノートを開く",
                buttonTitle: `${managedDataTarget.displayName} に対応するノートを別タブで開きます。`,
                onOpen: () => {
                  void openManagedDataNote(managedDataTarget.targetId);
                }
              }
            : undefined
        }
        onOpenInExternalApp={(relativePath) => {
          void openPathInExternalApp(relativePath);
        }}
      />
    );
  };

  const renderExplorerSidebarView = (): JSX.Element => (
    <div className="sidebar__panel">
      {workspace ? (
        <div className="sidebar__panel-header">
          <div className="sidebar__panel-actions">
            <button
              aria-label="New note"
              className="button button--icon"
              onClick={() => {
                startCreateInline("file");
              }}
              title="New note"
              type="button"
            >
              <img alt="" className="sidebar__action-icon" draggable={false} src={NEW_FILE_ICON_URL} />
            </button>
            <button
              aria-label="New folder"
              className="button button--icon"
              onClick={() => {
                startCreateInline("directory");
              }}
              title="New folder"
              type="button"
            >
              <img alt="" className="sidebar__action-icon" draggable={false} src={NEW_FOLDER_ICON_URL} />
            </button>
            <button
              aria-label={showHiddenEntries ? "hidden フォルダを非表示" : "hidden フォルダを表示"}
              aria-pressed={showHiddenEntries}
              className="button button--icon"
              onClick={toggleHiddenEntriesVisibility}
              title={showHiddenEntries ? "hidden フォルダを非表示にします" : "hidden フォルダを表示します"}
              type="button"
            >
              <ExplorerVisibilityIcon showHiddenEntries={showHiddenEntries} />
            </button>
            <button
              aria-label="全て畳む"
              className="button button--icon"
              disabled={expandedPaths.size === 0}
              onClick={collapseAllExplorerEntries}
              title="全て畳む"
              type="button"
            >
              <ExplorerCollapseAllIcon />
            </button>
            <button
              className="button button--ghost sidebar__action-text"
              disabled={loadingWorkspace}
              onClick={runWorkspaceSync}
              type="button"
            >
              Sync
            </button>
          </div>
        </div>
      ) : null}

      <div
        className={`sidebar__tree${dropTargetPath === "" ? " is-drop-target" : ""}`}
        onClick={(event) => {
          if (!workspace) {
            return;
          }

          focusExplorerSidebar();

          const target = event.target as HTMLElement | null;

          if (target?.closest(".tree-row")) {
            return;
          }

          replaceSelection([], "");
          setContextMenu(null);
        }}
        onContextMenu={(event) => {
          if (!workspace) {
            return;
          }

          focusExplorerSidebar();

          const target = event.target as HTMLElement | null;

          if (target?.closest(".tree-row")) {
            return;
          }

          event.preventDefault();
          openTreeRootContextMenu(event.clientX, event.clientY);
        }}
        onDragLeave={(event) => {
          const relatedTarget = event.relatedTarget as Node | null;

          if (relatedTarget && event.currentTarget.contains(relatedTarget)) {
            return;
          }

          setDropTargetPath(null);
        }}
        onDragOver={(event) => {
          const hasInternalPayload = event.dataTransfer.types.includes(TREE_DRAG_MIME);
          const hasExternalFiles = hasExternalTransferFiles(event.dataTransfer);

          if (!hasInternalPayload && !hasExternalFiles) {
            return;
          }

          focusExplorerSidebar();

          if ((event.target as HTMLElement | null)?.closest(".tree-row")) {
            return;
          }

          event.preventDefault();
          setDropTargetPath("");
          event.dataTransfer.dropEffect =
            hasInternalPayload && !(event.ctrlKey || event.metaKey) ? "move" : "copy";
        }}
        onDrop={(event) => {
          if ((event.target as HTMLElement | null)?.closest(".tree-row")) {
            return;
          }

          focusExplorerSidebar();
          event.preventDefault();
          setDropTargetPath(null);

          const internalPayload = event.dataTransfer.getData(TREE_DRAG_MIME);

          if (internalPayload.length > 0) {
            const sourcePaths = collapseNestedSelection(JSON.parse(internalPayload) as string[]);

            if (event.ctrlKey || event.metaKey) {
              void window.integralNotes
                .copyEntries({
                  destinationDirectoryPath: "",
                  sourcePaths
                })
                .then((result) => {
                  handleCopyEntriesResult(
                    result,
                    result.createdEntries.length === 1
                      ? `${result.createdEntries[0]?.name ?? "項目"} をコピーしました`
                      : `${result.createdEntries.length} 件をコピーしました`
                  );
                })
                .catch((error) => {
                  setStatusMessage(toErrorMessage(error));
                });
              return;
            }

            void window.integralNotes
              .moveEntries({
                destinationDirectoryPath: "",
                sourcePaths
              })
              .then((result) => {
                handleMoveEntriesResult(result);
              })
              .catch((error) => {
                setStatusMessage(toErrorMessage(error));
              });
            return;
          }

          const sourceAbsolutePaths = collectExternalTransferAbsolutePaths(event.dataTransfer);

          console.info("[Explorer] external drop on root", {
            destinationDirectoryPath: "",
            fileCount: event.dataTransfer.files.length,
            itemKinds: Array.from(event.dataTransfer.items).map((item) => item.kind),
            types: Array.from(event.dataTransfer.types),
            sourceAbsolutePaths
          });

          if (sourceAbsolutePaths.length === 0) {
            return;
          }

          void window.integralNotes
            .copyExternalEntries({
              destinationDirectoryPath: "",
              sourceAbsolutePaths
            })
            .then((result) => {
              handleCopyEntriesResult(
                result,
                result.createdEntries.length === 1
                  ? `${result.createdEntries[0]?.name ?? "項目"} を取り込みました`
                  : `${result.createdEntries.length} 件を取り込みました`
              );
            })
            .catch((error) => {
              console.error("[Explorer] failed to handle external drop on root", error);
              setStatusMessage(toErrorMessage(error));
            });
        }}
      >
        {loadingWorkspace && !workspace ? (
          <div className="sidebar__placeholder">Loading workspace...</div>
        ) : workspace ? (
          <FileTree
            dropTargetPath={dropTargetPath}
            editingPending={inlineEditorPending}
            editingState={inlineEditor}
            entries={visibleWorkspaceEntries}
            expandedPaths={expandedPaths}
            primarySelectedPath={selectedEntryPath}
            selectedPaths={selectedEntryPaths}
            onActivateEntry={handleActivateEntry}
            onCancelEditing={() => {
              if (!inlineEditorPending) {
                setInlineEditor(null);
              }
            }}
            onContextMenuEntry={openTreeContextMenu}
            onDoubleActivateEntry={handleDoubleActivateEntry}
            onDragEnd={handleDragEnd}
            onDragOverEntry={handleDragOverEntry}
            onDragStartEntry={handleDragStartEntry}
            onDropEntry={(entry, event) => {
              void handleDropOnEntry(entry, event);
            }}
            onSubmitEditing={(value) => {
              void submitInlineEditor(value);
            }}
          />
        ) : (
          <div className="sidebar__empty-state">
            <p className="sidebar__section-title">Workspace</p>
            <h2>ワークスペースが未設定です</h2>
            <p>ファイルを表示するフォルダを選ぶと、ここにエクスプローラーを表示します。</p>
            <button
              className="button button--primary"
              onClick={() => {
                void openWorkspaceFolder();
              }}
              type="button"
            >
              フォルダを開く
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const renderSearchSidebarView = (): JSX.Element => (
    <SearchSidebarView
      errorMessage={workspaceSearchError}
      onChange={setSearchSidebarState}
      onOpenResult={(relativePath) => {
        void openWorkspaceFile(relativePath);
      }}
      onReplaceAll={() => {
        void replaceWorkspaceSearchResults();
      }}
      onSearchNow={() => {
        void runWorkspaceSearch();
      }}
      replacePending={workspaceReplacePending}
      result={workspaceSearchResult}
      searchPending={workspaceSearchPending}
      state={searchSidebarState}
    />
  );

  const sidebarViewDefinitions: SidebarViewDefinition[] = [
    {
      activityIcon: <ExplorerSidebarIcon />,
      id: BUILTIN_EXPLORER_SIDEBAR_VIEW_ID,
      render: renderExplorerSidebarView,
      title: "Explorer"
    },
    {
      activityIcon: <SearchSidebarIcon />,
      id: BUILTIN_SEARCH_SIDEBAR_VIEW_ID,
      render: renderSearchSidebarView,
      title: "Search"
    },
    ...installedPlugins.flatMap((plugin) =>
      plugin.sidebarViews.map((sidebarView) => ({
        activityIcon: (
          <SidebarTextIcon label={toSidebarIconLabel(sidebarView.icon ?? sidebarView.title)} />
        ),
        id: `plugin:${plugin.id}:${sidebarView.id}`,
        render: () => <ExternalPluginSidebarView plugin={plugin} sidebarView={sidebarView} />,
        title: `${plugin.displayName}: ${sidebarView.title}`
      }))
    )
  ];
  const activityBarItems: ActivityBarItem[] = sidebarViewDefinitions.map((view) => ({
    icon: view.activityIcon,
    id: view.id,
    title: view.title
  })).concat(
    workspaceToolPlugins.map((toolPlugin) => ({
      icon: toolPlugin.activityIcon,
      id: toolPlugin.id,
      isActive: selectedTabId === toWorkspaceToolTabId(toolPlugin.id),
      title: toolPlugin.title
    }))
  );
  const activeSidebarView =
    sidebarViewDefinitions.find((view) => view.id === activeSidebarViewId) ?? sidebarViewDefinitions[0];

  const focusExplorerSidebar = (): void => {
    if (activeSidebarViewId !== BUILTIN_EXPLORER_SIDEBAR_VIEW_ID) {
      return;
    }

    sidebarPanelRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!sidebarViewDefinitions.some((view) => view.id === activeSidebarViewId)) {
      setActiveSidebarViewId(BUILTIN_EXPLORER_SIDEBAR_VIEW_ID);
    }
  }, [activeSidebarViewId, sidebarViewDefinitions]);

  const runAppMenuCommand = (command: AppMenuCommand): void => {
    if (command.disabled) {
      return;
    }

    setActiveAppMenuId(null);
    command.onSelect();
  };

  const appMenuDefinitions: AppMenuDefinition[] = [
    {
      id: "file",
      label: "ファイル",
      sections: [
        {
          commands: [
            {
              label: "フォルダを開く",
              onSelect: () => {
                void openWorkspaceFolder();
              }
            },
            {
              disabled: !workspace,
              label: "VSCodeで開く",
              onSelect: () => {
                void openWorkspaceInVSCode();
              },
              title: workspace ? `${workspace.rootPath} をVSCodeで開きます` : "ワークスペースフォルダを開いてください"
            }
          ]
        },
        {
          commands: [
            {
              disabled: !workspace || loadingWorkspace,
              label: "初期化/更新",
              onSelect: () => {
                void applyWorkspaceTemplate();
              },
              title: workspace ? "workspace template を強制上書き展開します" : "ワークスペースフォルダを開いてください"
            },
            {
              label: "データ登録",
              onSelect: openDataRegistrationDialog
            }
          ]
        }
      ]
    },
    {
      id: "tools",
      label: "ツール",
      sections: [
        {
          commands: [
            {
              label: "Extensions",
              onSelect: openExtensionsManager
            }
          ]
        }
      ]
    },
    {
      id: "settings",
      label: "設定",
      sections: [
        {
          commands: [
            {
              label: "本体設定",
              onSelect: openAppSettingsDialog
            },
            {
              disabled: !workspace,
              label: "Inline Actions",
              onSelect: openInlineActionSettingsDialog,
              title: workspace ? ".inline-action を編集します" : "ワークスペースフォルダを開いてください"
            }
          ]
        }
      ]
    }
  ];

  return (
    <div className="app-shell" data-dialog-open={hasBlockingDialog ? "true" : "false"}>
      <header aria-label="Application menu" className="app-menubar">
        {appMenuDefinitions.map((menu) => {
          const isOpen = activeAppMenuId === menu.id;

          return (
            <div className="app-menubar__menu" key={menu.id}>
              <button
                aria-expanded={isOpen}
                aria-haspopup="menu"
                className={`button button--ghost button--menu app-menubar__button${isOpen ? " is-active" : ""}`}
                onClick={() => {
                  setActiveAppMenuId(isOpen ? null : menu.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActiveAppMenuId(menu.id);
                  }
                }}
                onMouseEnter={() => {
                  if (activeAppMenuId) {
                    setActiveAppMenuId(menu.id);
                  }
                }}
                type="button"
              >
                {menu.label}
              </button>
              {isOpen ? (
                <div className="app-menubar__dropdown" role="menu">
                  {menu.sections.map((section, sectionIndex) => (
                    <div className="app-menubar__section" key={`${menu.id}-${sectionIndex}`}>
                      {section.commands.map((command) => (
                        <button
                          className="app-menubar__item"
                          disabled={command.disabled}
                          key={command.label}
                          onClick={() => {
                            runAppMenuCommand(command);
                          }}
                          role="menuitem"
                          title={command.title}
                          type="button"
                        >
                          {command.label}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </header>

      <ActivityBar
        activeItemId={activeSidebarView.id}
        items={activityBarItems}
        onSelect={(viewId) => {
          if (findWorkspaceToolPlugin(viewId)) {
            openWorkspaceToolPlugin(viewId);
            return;
          }

          selectSidebarView(viewId);
        }}
      />

      <aside
        className="sidebar-panel"
        data-sidebar-view={activeSidebarView.id}
        ref={sidebarPanelRef}
        tabIndex={-1}
      >
        {activeSidebarView.render()}
      </aside>

      <main className="workspace">
        <section className="workspace__layout" data-status={statusMessage}>
          <FlexLayout.Layout
            factory={editorFactory}
            model={model}
            onAction={handleLayoutAction}
            onModelChange={handleLayoutModelChange}
            onTabSetPlaceHolder={() => (
              <div className="layout-placeholder">
                <p className="layout-placeholder__eyebrow">Editor</p>
                <h3>{workspace ? "ファイルを選択してください" : "ワークスペースを開いてください"}</h3>
                <p>
                  {workspace
                    ? "左のエクスプローラーからファイルを開くか、新しいノートを作成してください。"
                    : "左のパネルからフォルダを開くと、ここにエディターを表示します。"}
                </p>
              </div>
            )}
          />
        </section>
      </main>

      {hostCommandDialog ? (
        <div className="dialog-backdrop">
          <div className="dialog-card dialog-card--host-command">
            <div className="dialog-card__header">
              <p className="dialog-card__eyebrow">AI CLI Approval</p>
              <h2>PowerShell command の実行確認</h2>
              <p>
                LLM が real workspace 上で CLI 実行を要求しています。内容を確認し、必要なら編集してください。
              </p>
            </div>

            <div className="dialog-card__body dialog-card__body--host-command">
              <div className="host-command-dialog__summary">
                <div className="host-command-dialog__field">
                  <span>Purpose</span>
                  <strong>{hostCommandDialog.request.purpose}</strong>
                </div>
                <div className="host-command-dialog__field">
                  <span>Working Directory</span>
                  <strong>{hostCommandDialog.request.workingDirectory}</strong>
                </div>
                <div className="host-command-dialog__field">
                  <span>Timeout</span>
                  <strong>
                    {hostCommandDialog.request.effectiveTimeoutSeconds}s
                    {hostCommandDialog.request.requestedTimeoutSeconds &&
                    hostCommandDialog.request.requestedTimeoutSeconds !==
                      hostCommandDialog.request.effectiveTimeoutSeconds
                      ? ` (requested ${hostCommandDialog.request.requestedTimeoutSeconds}s)`
                      : ""}
                  </strong>
                </div>
                <div className="host-command-dialog__field">
                  <span>Shell</span>
                  <strong>{hostCommandDialog.request.shellExecutablePath}</strong>
                </div>
              </div>

              {hostCommandDialog.request.warnings.length > 0 ? (
                <div className="host-command-dialog__warnings">
                  <strong>Strong warning</strong>
                  {hostCommandDialog.request.warnings.map((warning) => (
                    <p key={warning.code}>
                      {warning.code}: {warning.message}
                    </p>
                  ))}
                </div>
              ) : null}

              <label className="host-command-dialog__label">
                <span>Command</span>
                <textarea
                  className="host-command-dialog__command"
                  disabled={hostCommandDialog.status !== "awaiting-approval"}
                  onChange={(event) => {
                    updateHostCommand(event.target.value);
                  }}
                  rows={8}
                  value={hostCommandDialog.command}
                />
              </label>

              {hostCommandDialog.status === "awaiting-approval" ? (
                <label className="host-command-dialog__label">
                  <span>Reject message</span>
                  <textarea
                    className="host-command-dialog__reject"
                    onChange={(event) => {
                      updateHostCommandRejectReason(event.target.value);
                    }}
                    placeholder="reject する場合、LLMへ返す理由を入力できます。"
                    rows={3}
                    value={hostCommandDialog.rejectReason}
                  />
                </label>
              ) : null}

              {hostCommandDialog.status !== "awaiting-approval" ? (
                <div className="host-command-dialog__output">
                  <div className="host-command-dialog__output-header">
                    <span>Status: {hostCommandDialog.status}</span>
                    <span>
                      exit:{" "}
                      {hostCommandDialog.exitCode === undefined
                        ? "running"
                        : hostCommandDialog.exitCode === null
                          ? "null"
                          : hostCommandDialog.exitCode}
                    </span>
                    {hostCommandDialog.durationMs ? (
                      <span>{Math.round(hostCommandDialog.durationMs / 100) / 10}s</span>
                    ) : null}
                  </div>

                  {hostCommandDialog.message ? (
                    <p className="host-command-dialog__message">{hostCommandDialog.message}</p>
                  ) : null}

                  <div className="host-command-dialog__streams">
                    <div>
                      <span>stdout</span>
                      <pre>{hostCommandDialog.stdout || "(empty)"}</pre>
                    </div>
                    <div>
                      <span>stderr</span>
                      <pre>{hostCommandDialog.stderr || "(empty)"}</pre>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="dialog-actions">
                {hostCommandDialog.status === "awaiting-approval" ? (
                  <>
                    <button
                      className="button button--ghost"
                      onClick={() => {
                        void rejectHostCommand();
                      }}
                      type="button"
                    >
                      Reject
                    </button>
                    <button
                      className="button button--primary"
                      disabled={hostCommandDialog.command.trim().length === 0}
                      onClick={() => {
                        void approveHostCommand();
                      }}
                      type="button"
                    >
                      Approve & Run
                    </button>
                  </>
                ) : hostCommandDialog.status === "running" || hostCommandDialog.status === "responding" ? (
                  <button
                    className="button button--ghost"
                    onClick={() => {
                      void cancelHostCommand();
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                ) : (
                  <button
                    className="button button--primary"
                    onClick={() => {
                      setHostCommandDialog(null);
                    }}
                    type="button"
                  >
                    Close
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {contextMenu ? (
        <div
          className="tree-context-menu"
          style={{
            left: contextMenu.x,
            top: contextMenu.y
          }}
        >
          {contextMenu.scope === "root" || contextMenu.entry?.kind === "directory" ? (
            <>
              <button
                className="tree-context-menu__item"
                onClick={() => {
                  startCreateInline("file", contextMenu.scope === "entry" ? contextMenu.entry : undefined);
                }}
                type="button"
              >
                新しいノート
              </button>
              <button
                className="tree-context-menu__item"
                onClick={() => {
                  startCreateInline(
                    "directory",
                    contextMenu.scope === "entry" ? contextMenu.entry : undefined
                  );
                }}
                type="button"
              >
                新しいフォルダ
              </button>
              {contextMenu.scope === "root" ? (
                <>
                  <div className="tree-context-menu__separator" />
                  <button
                    className="tree-context-menu__item"
                    onClick={() => {
                      void pasteIntoWorkspace();
                    }}
                    type="button"
                  >
                    貼り付け
                  </button>
                  <button
                    className="tree-context-menu__item"
                    onClick={() => {
                      void openPathInFileManager(null);
                    }}
                    type="button"
                  >
                    エクスプローラーで開く
                  </button>
                </>
              ) : null}
            </>
          ) : null}

          {contextMenu.scope === "entry" && contextMenu.entry ? (
            <>
              <div className="tree-context-menu__separator" />
              <button
                className="tree-context-menu__item"
                onClick={() => {
                  copySelectedEntriesToClipboard(contextMenu.entry);
                }}
                type="button"
              >
                コピー
              </button>
              <button
                className="tree-context-menu__item"
                onClick={() => {
                  void pasteIntoWorkspace(contextMenu.entry);
                }}
                type="button"
              >
                貼り付け
              </button>
              <button
                className="tree-context-menu__item"
                onClick={() => {
                  startRenameInline(contextMenu.entry);
                }}
                type="button"
              >
                名前を変更
              </button>
              <button
                className="tree-context-menu__item"
                onClick={() => {
                  copyEntryPathsToClipboard("absolute", contextMenu.entry);
                }}
                type="button"
              >
                パスのコピー
              </button>
              <button
                className="tree-context-menu__item"
                onClick={() => {
                  copyEntryPathsToClipboard("relative", contextMenu.entry);
                }}
                type="button"
              >
                相対パスのコピー
              </button>
              <button
                className="tree-context-menu__item"
                onClick={() => {
                  void openPathInFileManager(contextMenu.entry?.relativePath);
                }}
                type="button"
              >
                エクスプローラーで開く
              </button>
              <button
                className="tree-context-menu__item"
                onClick={() => {
                  openDatasetCreationDialog(contextMenu.entry);
                }}
                type="button"
              >
                DataSetに追加
              </button>
              {contextMenu.entry.kind === "file" &&
              contextMenu.entry.name.toLowerCase().endsWith(".py") ? (
                <button
                  className="tree-context-menu__item"
                  onClick={() => {
                    void addPythonScriptToUserStock(contextMenu.entry?.relativePath ?? "");
                  }}
                  type="button"
                >
                  ユーザーストックに追加
                </button>
              ) : null}
              <button
                className="tree-context-menu__item tree-context-menu__item--danger"
                onClick={() => {
                  openDeleteDialog(contextMenu.entry);
                }}
                type="button"
              >
                削除
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {activeTrackingIssue?.kind === "relink" ? (
        <ManagedDataTrackingDialog
          issue={activeTrackingIssue}
          onClose={() => {
            if (!trackingResolutionPending) {
              setTrackingDialogDismissed(true);
            }
          }}
          onConfirm={(selectedPath) => {
            void resolveTrackingIssue("relink", selectedPath);
          }}
          pending={trackingResolutionPending}
        />
      ) : null}

      {activeTrackingIssue?.kind === "missing" ? (
        <WorkspaceDialog
          confirmLabel="管理対象から外す"
          danger
          description={`${activeTrackingIssue.displayName} は recorded path (${activeTrackingIssue.recordedPath}) と hash の両方で追跡できません。管理対象から外し、紐づく data-note も整理します。`}
          onClose={() => {
            if (!trackingResolutionPending) {
              setTrackingDialogDismissed(true);
            }
          }}
          onConfirm={() => {
            void resolveTrackingIssue("remove");
          }}
          pending={trackingResolutionPending}
          requireInput={false}
          title="管理対象の削除確認"
        />
      ) : null}

      {deleteDialog ? (
        <WorkspaceDialog
          confirmLabel={deleteDialog.confirmLabel}
          danger
          description={deleteDialog.description}
          onClose={() => {
            if (!deleteDialogPending) {
              setDeleteDialog(null);
            }
          }}
          onConfirm={() => {
            void submitDeleteDialog();
          }}
          pending={deleteDialogPending}
          requireInput={false}
          title={deleteDialog.title}
        />
      ) : null}

      {datasetCreationDialog ? (
        <WorkspaceDialog
          confirmLabel="作成"
          description="選択中の項目を元に新しい dataset を作成します。"
          initialValue={datasetCreationDialog.defaultName}
          inputLabel="Dataset 名"
          onClose={() => {
            if (!datasetCreationPending) {
              setDatasetCreationDialog(null);
            }
          }}
          onConfirm={(value) => {
            void submitDatasetCreationDialog(value);
          }}
          pending={datasetCreationPending}
          requireInput
          title="DataSetに追加"
        />
      ) : null}

      {dataRegistrationDialogOpen ? (
        <DataRegistrationDialog
          onClose={() => {
            setDataRegistrationDialogOpen(false);
          }}
          onError={setStatusMessage}
          onImportDirectories={() => importManagedFileDirectories()}
          onImportFiles={() => importManagedFileFiles()}
          onImportedManagedFiles={handleImportedManagedFiles}
          onDatasetCreated={(dataset) => {
            setDataRegistrationDialogOpen(false);
            setStatusMessage(`${dataset.name} を作成しました。`);
          }}
        />
      ) : null}

      {appSettingsDialogOpen ? (
        <AppSettingsDialog
          onClose={() => {
            setAppSettingsDialogOpen(false);
          }}
          onOpenAiSettings={() => {
            setAiSettingsDialogOpen(true);
          }}
          onSave={saveAppSettings}
          pending={appSettingsPending}
          settings={appSettings}
        />
      ) : null}

      {aiSettingsDialogOpen ? (
        <AIChatSettingsDialog
          onClose={() => {
            setAiSettingsDialogOpen(false);
          }}
          onError={setStatusMessage}
        />
      ) : null}

      {inlineActionSettingsDialogOpen ? (
        <InlineActionSettingsDialog
          onChanged={() => {
            window.dispatchEvent(new Event("integral-inline-actions-changed"));
            setStatusMessage("Inline Action を保存しました。");
          }}
          onClose={() => {
            setInlineActionSettingsDialogOpen(false);
          }}
          onError={setStatusMessage}
        />
      ) : null}

    </div>
  );
}
