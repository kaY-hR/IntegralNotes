import * as FlexLayout from "flexlayout-react";
import { type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from "react";

import type {
  IntegralOriginalDataSummary,
  RegisterPythonScriptResult
} from "../shared/integral";
import type {
  CopyEntriesResult,
  CreateEntryResult,
  DeleteEntriesResult,
  MoveEntriesResult,
  NoteDocument,
  RenameEntryResult,
  SaveClipboardImageResult,
  UninstallPluginResult,
  WorkspaceEntry,
  WorkspaceEntryKind,
  WorkspaceFileDocument,
  WorkspaceFileViewKind,
  WorkspaceSnapshot
} from "../shared/workspace";
import type { InstalledPluginDefinition } from "../shared/plugins";
import {
  type WorkspacePathChange,
  rewriteWorkspaceMarkdownReferences
} from "../shared/workspaceLinks";
import { DataRegistrationDialog } from "./DataRegistrationDialog";
import { FileTree, type FileTreeInlineEditorState } from "./FileTree";
import { resetIntegralPluginRuntime } from "./integralPluginRuntime";
import { MilkdownEditor } from "./MilkdownEditor";
import { PluginManagerDialog } from "./PluginManagerDialog";
import { PythonScriptDialog } from "./PythonScriptDialog";
import { WorkspaceFileViewer } from "./WorkspaceFileViewer";
import { WorkspaceDialog } from "./WorkspaceDialog";
import {
  INSERT_INTEGRAL_BLOCK_MARKDOWN_EVENT,
  OPEN_PYTHON_SCRIPT_DIALOG_EVENT
} from "./integralSnippetMenu";

type ReadonlyWorkspaceFileKind = Exclude<WorkspaceFileViewKind, "markdown">;

interface OpenMarkdownTab extends NoteDocument {
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

interface DatasetCreationDialogState {
  defaultName: string;
  relativePaths: string[];
}

interface ExplorerClipboardState {
  sourcePaths: string[];
}

const MAIN_TABSET_ID = "editor-main";
const NEW_FILE_ICON_URL = new URL("./resources/ファイル追加.png", import.meta.url).href;
const NEW_FOLDER_ICON_URL = new URL("./resources/フォルダアイコン15.png", import.meta.url).href;
const TREE_DRAG_MIME = "application/x-integralnotes-workspace-selection";

function createLayoutModel(): FlexLayout.Model {
  return FlexLayout.Model.fromJson({
    global: {
      splitterSize: 6,
      tabEnableRename: false,
      tabSetEnableDeleteWhenEmpty: false,
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
          enableDeleteWhenEmpty: false,
          children: []
        }
      ]
    }
  });
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

function createOpenTab(document: WorkspaceFileDocument): OpenWorkspaceTab {
  if (document.kind === "markdown") {
    return {
      content: document.content ?? "",
      isSaving: false,
      kind: "markdown",
      modifiedAt: document.modifiedAt,
      name: document.name,
      relativePath: document.relativePath,
      savedContent: document.content ?? ""
    };
  }

  return {
    content: document.content,
    kind: document.kind as ReadonlyWorkspaceFileKind,
    modifiedAt: document.modifiedAt,
    name: document.name,
    relativePath: document.relativePath
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

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "不明なエラーが発生しました。";
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

function clampContextMenuPosition(x: number, y: number): Pick<TreeContextMenuState, "x" | "y"> {
  const menuWidth = 196;
  const menuHeight = 360;

  return {
    x: Math.max(8, Math.min(x, window.innerWidth - menuWidth)),
    y: Math.max(8, Math.min(y, window.innerHeight - menuHeight))
  };
}

export function App(): JSX.Element {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [openTabs, setOpenTabs] = useState<Record<string, OpenWorkspaceTab>>({});
  const [selectedEntryPath, setSelectedEntryPath] = useState("");
  const [selectedEntryPaths, setSelectedEntryPaths] = useState<Set<string>>(new Set());
  const [selectedTabId, setSelectedTabId] = useState<string | undefined>(undefined);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [statusMessage, setStatusMessage] = useState("ワークスペースを読み込み中...");
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);
  const [deleteDialogPending, setDeleteDialogPending] = useState(false);
  const [inlineEditor, setInlineEditor] = useState<FileTreeInlineEditorState | null>(null);
  const [inlineEditorPending, setInlineEditorPending] = useState(false);
  const [contextMenu, setContextMenu] = useState<TreeContextMenuState | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [explorerClipboard, setExplorerClipboard] = useState<ExplorerClipboardState | null>(null);
  const [datasetCreationDialog, setDatasetCreationDialog] = useState<DatasetCreationDialogState | null>(null);
  const [datasetCreationPending, setDatasetCreationPending] = useState(false);
  const [pluginDialogOpen, setPluginDialogOpen] = useState(false);
  const [pluginDialogPendingAction, setPluginDialogPendingAction] = useState<string | null>(null);
  const [dataRegistrationDialogOpen, setDataRegistrationDialogOpen] = useState(false);
  const [pythonScriptDialogOpen, setPythonScriptDialogOpen] = useState(false);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPluginDefinition[]>([]);
  const [pluginInstallRootPath, setPluginInstallRootPath] = useState("");
  const [pluginCatalogRevision, setPluginCatalogRevision] = useState(0);
  const [model] = useState(() => createLayoutModel());
  const openTabsRef = useRef(openTabs);
  const shouldAutoOpenInitialFileRef = useRef(false);
  const sidebarRef = useRef<HTMLElement>(null);

  const selectedEntry = workspace ? findEntryByPath(workspace.entries, selectedEntryPath) : undefined;
  const selectedEntries = workspace ? findEntriesByPaths(workspace.entries, selectedEntryPaths) : [];
  const selectedTabPath = selectedTabId ? toRelativePathFromTabId(selectedTabId) : undefined;
  const activeTab = selectedTabPath ? openTabs[selectedTabPath] : undefined;
  const hasBlockingDialog =
    deleteDialog !== null ||
    datasetCreationDialog !== null ||
    dataRegistrationDialogOpen ||
    pythonScriptDialogOpen ||
    pluginDialogOpen;

  useEffect(() => {
    openTabsRef.current = openTabs;
  }, [openTabs]);

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

    setOpenTabs({});
    setSelectedTabId(undefined);
  };

  const clearWorkspace = (nextStatusMessage: string): void => {
    shouldAutoOpenInitialFileRef.current = false;
    setInlineEditor(null);
    setContextMenu(null);
    setDropTargetPath(null);
    setDeleteDialog(null);
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
    setInlineEditor(null);
    setContextMenu(null);
    setDropTargetPath(null);

    if (options.resetTabs) {
      shouldAutoOpenInitialFileRef.current = true;
      resetOpenTabs();
      setSelectedEntryPath("");
      setSelectedEntryPaths(new Set());
      setExpandedPaths(defaultExpandedPaths(snapshot.entries));
    } else {
      closeTabsMatching((relativePath) => !hasEntry(snapshot.entries, relativePath));
      setExpandedPaths((current) => reconcileExpandedPaths(current, snapshot.entries));

      if (!hasEntry(snapshot.entries, selectedEntryPath)) {
        setSelectedEntryPath("");
      }

      setSelectedEntryPaths((current) => {
        const next = new Set(Array.from(current).filter((entryPath) => hasEntry(snapshot.entries, entryPath)));

        if (selectedEntryPath.length > 0 && hasEntry(snapshot.entries, selectedEntryPath)) {
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

  const refreshWorkspace = async (nextStatus?: string): Promise<void> => {
    setLoadingWorkspace(true);

    try {
      const snapshot = await window.integralNotes.getWorkspaceSnapshot();

      if (!snapshot) {
        clearWorkspace(nextStatus ?? "ワークスペースフォルダが未設定です。フォルダを開いてください。");
        return;
      }

      applyWorkspaceSnapshot(snapshot, {
        resetTabs: workspace === null,
        statusMessage: nextStatus
      });
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    } finally {
      setLoadingWorkspace(false);
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

      applyWorkspaceSnapshot(snapshot, {
        resetTabs: true,
        statusMessage: `${snapshot.rootName} を開きました`
      });
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    } finally {
      setLoadingWorkspace(false);
    }
  };

  const refreshInstalledPluginState = async (nextStatusMessage?: string): Promise<void> => {
    try {
      const [plugins, installRootPath] = await Promise.all([
        window.integralNotes.listInstalledPlugins(),
        window.integralNotes.getPluginInstallRootPath()
      ]);

      setInstalledPlugins(plugins);
      setPluginInstallRootPath(installRootPath);

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
    await refreshInstalledPluginState(nextStatusMessage);
  };

  const refreshIntegralBlockCatalog = (nextStatusMessage?: string): void => {
    resetIntegralPluginRuntime();
    setPluginCatalogRevision((current) => current + 1);

    if (nextStatusMessage) {
      setStatusMessage(nextStatusMessage);
    }
  };

  const openPluginManager = (): void => {
    setPluginDialogOpen(true);
    void refreshInstalledPluginState();
  };

  const openDataRegistrationDialog = (): void => {
    setDataRegistrationDialogOpen(true);
  };

  const openPythonScriptDialog = (): void => {
    setPythonScriptDialogOpen(true);
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
      return findEntriesByPaths(workspace.entries, selectedEntryPaths);
    }

    if (selectedEntries.length > 0) {
      return selectedEntries;
    }

    return fallbackEntry ? [fallbackEntry] : [];
  };

  const handleImportedOriginalData = async (
    originalData: readonly IntegralOriginalDataSummary[],
    kind: "directories" | "files"
  ): Promise<void> => {
    const unit = kind === "files" ? "ファイル" : "フォルダ";
    await refreshWorkspace(`${originalData.length} 件の${unit}元データを登録しました。`);
  };

  const importOriginalDataFiles = async (): Promise<void> => {
    try {
      const result = await window.integralNotes.importOriginalDataFiles();

      if (!result) {
        setStatusMessage("元データ登録をキャンセルしました。");
        return;
      }

      await refreshWorkspace(`${result.originalData.length} 件のファイル元データを登録しました。`);
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    }
  };

  const importOriginalDataDirectories = async (): Promise<void> => {
    try {
      const result = await window.integralNotes.importOriginalDataDirectories();

      if (!result) {
        setStatusMessage("元データ登録をキャンセルしました。");
        return;
      }

      await refreshWorkspace(`${result.originalData.length} 件のフォルダ元データを登録しました。`);
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    }
  };

  const handlePythonScriptRegistered = (
    result: RegisterPythonScriptResult,
    blockMarkdown: string
  ): void => {
    setPythonScriptDialogOpen(false);
    refreshIntegralBlockCatalog(`${result.script.displayName} を登録しました。`);
    window.dispatchEvent(
      new CustomEvent(INSERT_INTEGRAL_BLOCK_MARKDOWN_EVENT, {
        detail: blockMarkdown
      })
    );
  };

  const installPluginFromZip = async (): Promise<void> => {
    setPluginDialogPendingAction("install");

    try {
      const result = await window.integralNotes.installPluginFromZip();

      if (!result) {
        setStatusMessage("plugin zip の選択をキャンセルしました。");
        return;
      }

      await synchronizePluginRuntime(
        `${result.plugin.displayName} ${result.plugin.version} をインストールしました`
      );
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    } finally {
      setPluginDialogPendingAction(null);
    }
  };

  const refreshPluginsFromDialog = async (): Promise<void> => {
    setPluginDialogPendingAction("refresh");

    try {
      await refreshInstalledPluginState("plugin 一覧を更新しました。");
    } finally {
      setPluginDialogPendingAction(null);
    }
  };

  const uninstallPlugin = async (pluginId: string): Promise<void> => {
    setPluginDialogPendingAction(`uninstall:${pluginId}`);

    try {
      const result: UninstallPluginResult = await window.integralNotes.uninstallPlugin(pluginId);
      const nextStatusMessage = result.removed
        ? `${pluginId} をアンインストールしました`
        : `${pluginId} は既に見つかりません`;

      await synchronizePluginRuntime(nextStatusMessage);
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    } finally {
      setPluginDialogPendingAction(null);
    }
  };

  useEffect(() => {
    void refreshWorkspace();
  }, []);

  useEffect(() => {
    const handleOpenPythonScriptDialog = (): void => {
      setPythonScriptDialogOpen(true);
    };

    window.addEventListener(
      OPEN_PYTHON_SCRIPT_DIALOG_EVENT,
      handleOpenPythonScriptDialog as EventListener
    );

    return () => {
      window.removeEventListener(
        OPEN_PYTHON_SCRIPT_DIALOG_EVENT,
        handleOpenPythonScriptDialog as EventListener
      );
    };
  }, []);

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
    const firstFile = findFirstFile(workspace.entries);

    if (!firstFile) {
      return;
    }

    void openNote(firstFile.relativePath);
  }, [workspace, openTabs, selectedTabId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
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
  }, [activeTab]);

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

      if (!sidebarRef.current?.contains(activeElement)) {
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
    explorerClipboard,
    inlineEditor,
    selectedEntry,
    selectedEntryPaths
  ]);

  const openNote = async (relativePath: string): Promise<void> => {
    await openWorkspaceFile(relativePath);
  };

  const openWorkspaceFile = async (
    relativePath: string,
    options?: { openUnsupportedExternally?: boolean }
  ): Promise<void> => {
    const existingTab = openTabs[relativePath];
    const tabId = toTabId(relativePath);
    const openUnsupportedExternally = options?.openUnsupportedExternally ?? false;

    selectSingleEntry(relativePath);

    if (existingTab) {
      if (
        openUnsupportedExternally &&
        (existingTab.kind === "unsupported" || existingTab.content === null)
      ) {
        await openPathInExternalApp(relativePath);
        return;
      }

      model.doAction(FlexLayout.Actions.selectTab(tabId));
      setSelectedTabId(tabId);
      setStatusMessage(
        isMarkdownTab(existingTab) ? `${existingTab.name} を編集中` : `${existingTab.name} を表示中`
      );
      return;
    }

    try {
      const document = await window.integralNotes.readWorkspaceFile(relativePath);

      if (
        openUnsupportedExternally &&
        (document.kind === "unsupported" || document.content === null)
      ) {
        await openPathInExternalApp(relativePath);
        return;
      }

      setOpenTabs((currentTabs) => ({
        ...currentTabs,
        [relativePath]: createOpenTab(document)
      }));

      const activeTabsetId =
        model.getActiveTabset()?.getId() ?? model.getNodeById(MAIN_TABSET_ID)?.getId() ?? MAIN_TABSET_ID;

      model.doAction(
        FlexLayout.Actions.addNode(
          {
            type: "tab",
            id: tabId,
            component: "editor",
            name: document.name,
            config: {
              relativePath: document.relativePath
            }
          },
          activeTabsetId,
          FlexLayout.DockLocation.CENTER,
          -1,
          true
        )
      );

      setSelectedTabId(tabId);
      setStatusMessage(`${document.name} を開きました`);
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

  const saveNote = async (relativePath: string): Promise<void> => {
    const tab = openTabs[relativePath];

    if (!isMarkdownTab(tab)) {
      return;
    }

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
      const savedNote = await window.integralNotes.saveNote(relativePath, tab.content);

      setOpenTabs((currentTabs) => {
        const currentTab = currentTabs[relativePath];

        if (!isMarkdownTab(currentTab)) {
          return currentTabs;
        }

        return {
          ...currentTabs,
          [relativePath]: {
            ...currentTab,
            content: savedNote.content,
            isSaving: false,
            modifiedAt: savedNote.modifiedAt,
            name: savedNote.name,
            savedContent: savedNote.content
          }
        };
      });

      syncTabLabel(relativePath, savedNote.name, false);
      setStatusMessage(`${savedNote.name} を保存しました`);
      await refreshWorkspace();
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
    setExplorerClipboard({ sourcePaths });
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
      if (explorerClipboard && explorerClipboard.sourcePaths.length > 0) {
        const result = await window.integralNotes.copyEntries({
          destinationDirectoryPath,
          sourcePaths: explorerClipboard.sourcePaths
        });

        handleCopyEntriesResult(
          result,
          result.createdEntries.length === 1
            ? `${result.createdEntries[0]?.name ?? "項目"} を貼り付けました`
            : `${result.createdEntries.length} 件を貼り付けました`
        );
        return;
      }

      if (window.integralNotes.clipboardHasImage()) {
        const result = await window.integralNotes.saveClipboardImage({
          targetDirectoryPath: destinationDirectoryPath
        });

        handleSaveClipboardImageResult(result);
        return;
      }

      setStatusMessage("貼り付け可能な explorer 項目または画像がありません。");
    } catch (error) {
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
      const result = await window.integralNotes.createSourceDatasetFromWorkspaceEntries({
        name: datasetName.trim(),
        relativePaths: datasetCreationDialog.relativePaths
      });

      setDatasetCreationDialog(null);
      setStatusMessage(`${result.dataset.name} (${result.dataset.datasetId}) を作成しました`);
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
    setDeleteDialog({
      title: "削除確認",
      description:
        entriesToDelete.length === 1
          ? entriesToDelete[0]?.kind === "directory"
            ? `${entriesToDelete[0]?.name ?? ""} 配下も含めて削除します。`
            : `${entriesToDelete[0]?.name ?? ""} を削除します。`
          : `${entriesToDelete.length} 件を削除します。フォルダ配下も含めて削除されます。`,
      confirmLabel: "Delete",
      targetPaths: collapseNestedSelection(entriesToDelete.map((entry) => entry.relativePath))
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

    const isAdditiveSelection = event.ctrlKey || event.metaKey;

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
    const hasExternalFiles = event.dataTransfer.files.length > 0;

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

      const sourceAbsolutePaths = Array.from(event.dataTransfer.files)
        .map((file) => (file as File & { path?: string }).path?.trim() ?? "")
        .filter((value) => value.length > 0);

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
        selectSingleEntry(relativePath);
      }

      return;
    }

    if (action.type === FlexLayout.Actions.ADD_NODE) {
      const nextTabId = action.data.json?.id as string | undefined;

      if (nextTabId) {
        setSelectedTabId(nextTabId);
      }
    }
  };

  const editorFactory = (node: FlexLayout.TabNode): JSX.Element => {
    const relativePath = node.getConfig()?.relativePath as string | undefined;

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
      return (
        <MilkdownEditor
          initialValue={tab.content}
          isActive={selectedTabPath === relativePath}
          key={`${relativePath}:${pluginCatalogRevision}`}
          onChange={(markdown) => {
            updateTabContent(relativePath, markdown);
          }}
          onOpenWorkspaceFile={(relativePath) => {
            void openWorkspaceFile(relativePath, {
              openUnsupportedExternally: true
            });
          }}
          onWorkspaceSnapshotChanged={(snapshot) => {
            applyWorkspaceSnapshot(snapshot, {
              statusMessage: "画像を workspace に保存しました"
            });
          }}
          onWorkspaceLinkError={(message) => {
            setStatusMessage(message);
          }}
          workspaceEntries={workspace?.entries ?? []}
        />
      );
    }

    return (
      <WorkspaceFileViewer
        file={tab}
        onOpenInExternalApp={(relativePath) => {
          void openPathInExternalApp(relativePath);
        }}
      />
    );
  };

  return (
    <div className="app-shell" data-dialog-open={hasBlockingDialog ? "true" : "false"}>
      <header className="app-menubar">
        <button
          className="button button--ghost button--menu"
          onClick={() => {
            void openWorkspaceFolder();
          }}
          type="button"
        >
          Open Folder
        </button>
        <button
          className="button button--ghost button--menu"
          onClick={openDataRegistrationDialog}
          type="button"
        >
          データ登録
        </button>
        <button
          className="button button--ghost button--menu"
          onClick={openPythonScriptDialog}
          type="button"
        >
          Python Scripts
        </button>
        <button
          className="button button--ghost button--menu"
          onClick={openPluginManager}
          type="button"
        >
          Plugins
        </button>
      </header>

      <aside className="sidebar" ref={sidebarRef}>
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
                  className="button button--ghost sidebar__action-text"
                  onClick={() => {
                    void refreshWorkspace("ワークスペースを更新しました");
                  }}
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
              const hasExternalFiles = event.dataTransfer.files.length > 0;

              if (!hasInternalPayload && !hasExternalFiles) {
                return;
              }

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

              const sourceAbsolutePaths = Array.from(event.dataTransfer.files)
                .map((file) => (file as File & { path?: string }).path?.trim() ?? "")
                .filter((value) => value.length > 0);

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
                entries={workspace.entries}
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
      </aside>

      <main className="workspace">
        <section className="workspace__layout" data-status={statusMessage}>
          <FlexLayout.Layout
            factory={editorFactory}
            model={model}
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
                  openDatasetCreationDialog(contextMenu.entry);
                }}
                type="button"
              >
                DataSetに追加
              </button>
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
          description="選択中の項目を元に source dataset を作成します。"
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
          onImportDirectories={() => importOriginalDataDirectories()}
          onImportFiles={() => importOriginalDataFiles()}
          onImportedOriginalData={handleImportedOriginalData}
          onSourceDatasetCreated={(datasetId) => {
            setDataRegistrationDialogOpen(false);
            setStatusMessage(`${datasetId} を source dataset として作成しました。`);
          }}
        />
      ) : null}

      {pythonScriptDialogOpen ? (
        <PythonScriptDialog
          onClose={() => {
            setPythonScriptDialogOpen(false);
          }}
          onError={setStatusMessage}
          onRegistered={handlePythonScriptRegistered}
        />
      ) : null}

      {pluginDialogOpen ? (
        <PluginManagerDialog
          installRootPath={pluginInstallRootPath}
          onClose={() => {
            if (pluginDialogPendingAction === null) {
              setPluginDialogOpen(false);
            }
          }}
          onInstall={() => {
            void installPluginFromZip();
          }}
          onRefresh={() => {
            void refreshPluginsFromDialog();
          }}
          onUninstall={(pluginId) => {
            void uninstallPlugin(pluginId);
          }}
          pendingAction={pluginDialogPendingAction}
          plugins={installedPlugins}
        />
      ) : null}
    </div>
  );
}
