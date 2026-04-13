import * as FlexLayout from "flexlayout-react";
import { useEffect, useRef, useState } from "react";

import type {
  IntegralBlobSummary,
  RegisterPythonScriptResult
} from "../shared/integral";
import type {
  CreateEntryResult,
  DeleteEntryResult,
  RenameEntryResult,
  UninstallPluginResult,
  WorkspaceEntry,
  WorkspaceEntryKind,
  WorkspaceSnapshot
} from "../shared/workspace";
import type { InstalledPluginDefinition } from "../shared/plugins";
import { DataRegistrationDialog } from "./DataRegistrationDialog";
import { FileTree, type FileTreeInlineEditorState } from "./FileTree";
import { resetIntegralPluginRuntime } from "./integralPluginRuntime";
import { MilkdownEditor } from "./MilkdownEditor";
import { PluginManagerDialog } from "./PluginManagerDialog";
import { PythonScriptDialog } from "./PythonScriptDialog";
import { WorkspaceDialog } from "./WorkspaceDialog";
import {
  INSERT_INTEGRAL_BLOCK_MARKDOWN_EVENT,
  OPEN_PYTHON_SCRIPT_DIALOG_EVENT
} from "./integralSnippetMenu";

interface OpenNoteTab {
  content: string;
  isSaving: boolean;
  modifiedAt: string;
  name: string;
  relativePath: string;
  savedContent: string;
}

interface DeleteDialogState {
  confirmLabel: string;
  description: string;
  targetKind: WorkspaceEntryKind;
  targetPath: string;
  title: string;
}

interface TreeContextMenuState {
  entry?: WorkspaceEntry;
  scope: "entry" | "root";
  x: number;
  y: number;
}

const MAIN_TABSET_ID = "editor-main";
const NEW_FILE_ICON_URL = new URL("./resources/ファイル追加.png", import.meta.url).href;
const NEW_FOLDER_ICON_URL = new URL("./resources/フォルダアイコン15.png", import.meta.url).href;

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

function findFirstNote(entries: WorkspaceEntry[]): WorkspaceEntry | undefined {
  for (const entry of entries) {
    if (entry.kind === "file") {
      return entry;
    }

    if (entry.children) {
      const childNote = findFirstNote(entry.children);

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

function isDirty(tab: OpenNoteTab | undefined): boolean {
  return Boolean(tab && tab.content !== tab.savedContent);
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
  const menuWidth = 188;
  const menuHeight = 196;

  return {
    x: Math.max(8, Math.min(x, window.innerWidth - menuWidth)),
    y: Math.max(8, Math.min(y, window.innerHeight - menuHeight))
  };
}

export function App(): JSX.Element {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [openTabs, setOpenTabs] = useState<Record<string, OpenNoteTab>>({});
  const [selectedEntryPath, setSelectedEntryPath] = useState("");
  const [selectedTabId, setSelectedTabId] = useState<string | undefined>(undefined);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [statusMessage, setStatusMessage] = useState("ワークスペースを読み込み中...");
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);
  const [deleteDialogPending, setDeleteDialogPending] = useState(false);
  const [inlineEditor, setInlineEditor] = useState<FileTreeInlineEditorState | null>(null);
  const [inlineEditorPending, setInlineEditorPending] = useState(false);
  const [contextMenu, setContextMenu] = useState<TreeContextMenuState | null>(null);
  const [pluginDialogOpen, setPluginDialogOpen] = useState(false);
  const [pluginDialogPendingAction, setPluginDialogPendingAction] = useState<string | null>(null);
  const [dataRegistrationDialogOpen, setDataRegistrationDialogOpen] = useState(false);
  const [pythonScriptDialogOpen, setPythonScriptDialogOpen] = useState(false);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPluginDefinition[]>([]);
  const [pluginInstallRootPath, setPluginInstallRootPath] = useState("");
  const [pluginCatalogRevision, setPluginCatalogRevision] = useState(0);
  const [model] = useState(() => createLayoutModel());
  const openTabsRef = useRef(openTabs);
  const shouldAutoOpenInitialNoteRef = useRef(false);
  const sidebarRef = useRef<HTMLElement>(null);

  const selectedEntry = workspace ? findEntryByPath(workspace.entries, selectedEntryPath) : undefined;
  const selectedTabPath = selectedTabId ? toRelativePathFromTabId(selectedTabId) : undefined;
  const activeTab = selectedTabPath ? openTabs[selectedTabPath] : undefined;
  const hasBlockingDialog =
    deleteDialog !== null ||
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
    shouldAutoOpenInitialNoteRef.current = false;
    setInlineEditor(null);
    setContextMenu(null);
    setDeleteDialog(null);
    resetOpenTabs();
    setWorkspace(null);
    setSelectedEntryPath("");
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

    if (options.resetTabs) {
      shouldAutoOpenInitialNoteRef.current = true;
      resetOpenTabs();
      setSelectedEntryPath("");
      setExpandedPaths(defaultExpandedPaths(snapshot.entries));
    } else {
      closeTabsMatching((relativePath) => !hasEntry(snapshot.entries, relativePath));
      setExpandedPaths((current) => reconcileExpandedPaths(current, snapshot.entries));

      if (!hasEntry(snapshot.entries, selectedEntryPath)) {
        setSelectedEntryPath("");
      }
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

  const handleImportedBlobs = async (
    blobs: readonly IntegralBlobSummary[],
    kind: "directories" | "files"
  ): Promise<void> => {
    const unit = kind === "files" ? "ファイル" : "フォルダ";
    await refreshWorkspace(`${blobs.length} 件の${unit} blob を登録しました。`);
  };

  const importBlobFiles = async (): Promise<void> => {
    try {
      const result = await window.integralNotes.importBlobFiles();

      if (!result) {
        setStatusMessage("blob 登録をキャンセルしました。");
        return;
      }

      await refreshWorkspace(`${result.blobs.length} 件のファイル blob を登録しました。`);
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    }
  };

  const importBlobDirectories = async (): Promise<void> => {
    try {
      const result = await window.integralNotes.importBlobDirectories();

      if (!result) {
        setStatusMessage("blob 登録をキャンセルしました。");
        return;
      }

      await refreshWorkspace(`${result.blobs.length} 件のフォルダ blob を登録しました。`);
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
      !shouldAutoOpenInitialNoteRef.current ||
      Object.keys(openTabs).length > 0 ||
      selectedTabId
    ) {
      return;
    }

    shouldAutoOpenInitialNoteRef.current = false;
    const firstNote = findFirstNote(workspace.entries);

    if (!firstNote) {
      return;
    }

    void openNote(firstNote.relativePath);
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

      if (activeTab) {
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

      if (inlineEditor || deleteDialog || !selectedEntry) {
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

      if (event.key === "F2") {
        event.preventDefault();
        setContextMenu(null);
        startRenameInline(selectedEntry);
        return;
      }

      if (event.key === "Delete") {
        event.preventDefault();
        setContextMenu(null);
        openDeleteDialog(selectedEntry);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu, deleteDialog, inlineEditor, selectedEntry]);

  const openNote = async (relativePath: string): Promise<void> => {
    const existingTab = openTabs[relativePath];
    const tabId = toTabId(relativePath);

    setSelectedEntryPath(relativePath);

    if (existingTab) {
      model.doAction(FlexLayout.Actions.selectTab(tabId));
      setSelectedTabId(tabId);
      setStatusMessage(`${existingTab.name} を編集中`);
      return;
    }

    try {
      const note = await window.integralNotes.readNote(relativePath);

      setOpenTabs((currentTabs) => ({
        ...currentTabs,
        [relativePath]: {
          content: note.content,
          isSaving: false,
          modifiedAt: note.modifiedAt,
          name: note.name,
          relativePath: note.relativePath,
          savedContent: note.content
        }
      }));

      const activeTabsetId =
        model.getActiveTabset()?.getId() ?? model.getNodeById(MAIN_TABSET_ID)?.getId() ?? MAIN_TABSET_ID;

      model.doAction(
        FlexLayout.Actions.addNode(
          {
            type: "tab",
            id: tabId,
            component: "editor",
            name: note.name,
            config: {
              relativePath: note.relativePath
            }
          },
          activeTabsetId,
          FlexLayout.DockLocation.CENTER,
          -1,
          true
        )
      );

      setSelectedTabId(tabId);
      setStatusMessage(`${note.name} を開きました`);
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    }
  };

  const saveNote = async (relativePath: string): Promise<void> => {
    const tab = openTabs[relativePath];

    if (!tab) {
      return;
    }

    setOpenTabs((currentTabs) => ({
      ...currentTabs,
      [relativePath]: {
        ...currentTabs[relativePath],
        isSaving: true
      }
    }));

    try {
      const savedNote = await window.integralNotes.saveNote(relativePath, tab.content);

      setOpenTabs((currentTabs) => ({
        ...currentTabs,
        [relativePath]: {
          ...currentTabs[relativePath],
          content: savedNote.content,
          isSaving: false,
          modifiedAt: savedNote.modifiedAt,
          name: savedNote.name,
          savedContent: savedNote.content
        }
      }));

      syncTabLabel(relativePath, savedNote.name, false);
      setStatusMessage(`${savedNote.name} を保存しました`);
      await refreshWorkspace();
    } catch (error) {
      setOpenTabs((currentTabs) => ({
        ...currentTabs,
        [relativePath]: {
          ...currentTabs[relativePath],
          isSaving: false
        }
      }));
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
    setSelectedEntryPath(result.entry.relativePath);

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
    setWorkspace(result.snapshot);
    setSelectedEntryPath(result.entry.relativePath);

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

  const handleDeleteResult = (result: DeleteEntryResult): void => {
    setWorkspace(result.snapshot);
    setSelectedEntryPath("");

    if (result.deletedKind === "file") {
      closeTabsMatching((relativePath) => relativePath === result.deletedRelativePath);
    } else {
      closeTabsMatching(
        (relativePath) =>
          relativePath === result.deletedRelativePath ||
          relativePath.startsWith(`${result.deletedRelativePath}/`)
      );

      setExpandedPaths((current) => {
        const next = new Set<string>();

        for (const entryPath of current) {
          if (
            entryPath === result.deletedRelativePath ||
            entryPath.startsWith(`${result.deletedRelativePath}/`)
          ) {
            continue;
          }

          next.add(entryPath);
        }

        return next;
      });
    }

    setStatusMessage(`${basename(result.deletedRelativePath)} を削除しました`);
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
    setSelectedEntryPath(baseEntry?.relativePath ?? "");
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
    const entry = targetEntry ?? selectedEntry;

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
    setSelectedEntryPath(entry.relativePath);
    setStatusMessage(`${entry.name} をリネームします。名前を編集してください。`);
  };

  const openDeleteDialog = (targetEntry?: WorkspaceEntry): void => {
    const entry = targetEntry ?? selectedEntry;

    if (!entry) {
      setStatusMessage("削除対象を選択してください。");
      return;
    }

    setInlineEditor(null);
    setContextMenu(null);
    setDeleteDialog({
      title: "削除確認",
      description:
        entry.kind === "directory"
          ? `${entry.name} 配下も含めて削除します。`
          : `${entry.name} を削除します。`,
      confirmLabel: "Delete",
      targetKind: entry.kind,
      targetPath: entry.relativePath
    });
  };

  const submitDeleteDialog = async (): Promise<void> => {
    if (!deleteDialog) {
      return;
    }

    setDeleteDialogPending(true);

    try {
      const result = await window.integralNotes.deleteEntry({
        targetPath: deleteDialog.targetPath
      });

      handleDeleteResult(result);
      setDeleteDialog(null);
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    } finally {
      setDeleteDialogPending(false);
    }
  };

  const openTreeContextMenu = (entry: WorkspaceEntry, x: number, y: number): void => {
    const position = clampContextMenuPosition(x, y);

    setSelectedEntryPath(entry.relativePath);
    setContextMenu({
      entry,
      scope: "entry",
      x: position.x,
      y: position.y
    });
  };

  const openTreeRootContextMenu = (x: number, y: number): void => {
    const position = clampContextMenuPosition(x, y);

    setSelectedEntryPath("");
    setContextMenu({
      scope: "root",
      x: position.x,
      y: position.y
    });
  };

  const updateTabContent = (relativePath: string, nextContent: string): void => {
    const currentTab = openTabsRef.current[relativePath];

    if (!currentTab || currentTab.content === nextContent) {
      return;
    }

    const nextTab: OpenNoteTab = {
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
        setSelectedEntryPath(relativePath);
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
      return <div className="editor-empty">ノートを選択してください。</div>;
    }

    const tab = openTabs[relativePath];

    if (!tab) {
      return (
        <div className="editor-empty">
          ノートの状態が見つかりません。サイドバーから再度開いてください。
        </div>
      );
    }

    return (
      <MilkdownEditor
        initialValue={tab.content}
        isActive={selectedTabPath === relativePath}
        key={`${relativePath}:${pluginCatalogRevision}`}
        onChange={(markdown) => {
          updateTabContent(relativePath, markdown);
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
            className="sidebar__tree"
            onClick={(event) => {
              if (!workspace) {
                return;
              }

              const target = event.target as HTMLElement | null;

              if (target?.closest(".tree-row")) {
                return;
              }

              setSelectedEntryPath("");
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
          >
            {loadingWorkspace && !workspace ? (
              <div className="sidebar__placeholder">Loading workspace...</div>
            ) : workspace ? (
              <FileTree
                editingPending={inlineEditorPending}
                editingState={inlineEditor}
                entries={workspace.entries}
                expandedPaths={expandedPaths}
                selectedPath={selectedEntryPath}
                onCancelEditing={() => {
                  if (!inlineEditorPending) {
                    setInlineEditor(null);
                  }
                }}
                onContextMenuEntry={openTreeContextMenu}
                onOpenFile={(relativePath) => {
                  void openNote(relativePath);
                }}
                onSelectEntry={setSelectedEntryPath}
                onSubmitEditing={(value) => {
                  void submitInlineEditor(value);
                }}
                onToggleDirectory={(relativePath) => {
                  setExpandedPaths((current) => {
                    const next = new Set(current);

                    if (next.has(relativePath)) {
                      next.delete(relativePath);
                    } else {
                      next.add(relativePath);
                    }

                    return next;
                  });
                }}
              />
            ) : (
              <div className="sidebar__empty-state">
                <p className="sidebar__section-title">Workspace</p>
                <h2>ワークスペースが未設定です</h2>
                <p>ノートを表示するフォルダを選ぶと、ここにエクスプローラーを表示します。</p>
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
                <h3>{workspace ? "ノートを選択してください" : "ワークスペースを開いてください"}</h3>
                <p>
                  {workspace
                    ? "左のエクスプローラーからノートを開くか、新しいノートを作成してください。"
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
                New Note
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
                New Folder
              </button>
            </>
          ) : null}

          {contextMenu.scope === "entry" && contextMenu.entry ? (
            <>
              {contextMenu.entry.kind === "directory" ? <div className="tree-context-menu__separator" /> : null}
              <button
                className="tree-context-menu__item"
                onClick={() => {
                  startRenameInline(contextMenu.entry);
                }}
                type="button"
              >
                Rename
              </button>
              <button
                className="tree-context-menu__item tree-context-menu__item--danger"
                onClick={() => {
                  openDeleteDialog(contextMenu.entry);
                }}
                type="button"
              >
                Delete
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

      {dataRegistrationDialogOpen ? (
        <DataRegistrationDialog
          onClose={() => {
            setDataRegistrationDialogOpen(false);
          }}
          onError={setStatusMessage}
          onImportDirectories={() => importBlobDirectories()}
          onImportFiles={() => importBlobFiles()}
          onImportedBlobs={handleImportedBlobs}
          onSourceChunkCreated={(chunkId) => {
            setDataRegistrationDialogOpen(false);
            setStatusMessage(`${chunkId} を source chunk として作成しました。`);
          }}
        />
      ) : null}

      {pythonScriptDialogOpen ? (
        <PythonScriptDialog
          onClose={() => {
            setPythonScriptDialogOpen(false);
          }}
          onError={setStatusMessage}
          onImportedBlobs={handleImportedBlobs}
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
