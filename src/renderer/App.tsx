import * as FlexLayout from "flexlayout-react";
import { useEffect, useRef, useState } from "react";

import type {
  CreateEntryResult,
  DeleteEntryResult,
  RenameEntryResult,
  WorkspaceEntry,
  WorkspaceEntryKind,
  WorkspaceSnapshot
} from "../shared/workspace";
import { FileTree, type FileTreeInlineEditorState } from "./FileTree";
import { MilkdownEditor } from "./MilkdownEditor";
import { WorkspaceDialog } from "./WorkspaceDialog";

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
  entry: WorkspaceEntry;
  x: number;
  y: number;
}

const MAIN_TABSET_ID = "editor-main";
const NEW_FILE_ICON_URL = new URL("../../docs/00_履歴/ファイル追加.png", import.meta.url).href;
const NEW_FOLDER_ICON_URL = new URL("../../docs/00_履歴/フォルダアイコン15.png", import.meta.url).href;

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
  const [model] = useState(() => createLayoutModel());
  const openTabsRef = useRef(openTabs);
  const sidebarRef = useRef<HTMLElement>(null);

  const selectedEntry = workspace ? findEntryByPath(workspace.entries, selectedEntryPath) : undefined;
  const selectedTabPath = selectedTabId ? toRelativePathFromTabId(selectedTabId) : undefined;
  const activeTab = selectedTabPath ? openTabs[selectedTabPath] : undefined;

  useEffect(() => {
    openTabsRef.current = openTabs;
  }, [openTabs]);

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

  useEffect(() => {
    void refreshWorkspace();
  }, []);

  useEffect(() => {
    if (!workspace || Object.keys(openTabs).length > 0 || selectedTabId) {
      return;
    }

    const firstNote = findFirstNote(workspace.entries);

    if (!firstNote) {
      return;
    }

    void openNote(firstNote.relativePath);
  }, [workspace, openTabs, selectedTabId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") {
        return;
      }

      event.preventDefault();

      if (activeTab) {
        void saveNote(activeTab.relativePath);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
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
      setStatusMessage("ワークスペースを読み込み中です。");
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
        key={relativePath}
        onChange={(markdown) => {
          updateTabContent(relativePath, markdown);
        }}
      />
    );
  };

  return (
    <div className="app-shell">
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
      </header>

      <aside className="sidebar" ref={sidebarRef}>
        <div className="sidebar__panel">
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

          <div className="sidebar__tree">
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
              <div className="sidebar__placeholder">Workspace の取得に失敗しました。</div>
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
                <h3>Open a note to start editing</h3>
                <p>Use the explorer on the left or choose Open Folder.</p>
                <div className="layout-placeholder__actions">
                  <button
                    className="button button--primary"
                    onClick={() => {
                      const firstNote = workspace ? findFirstNote(workspace.entries) : undefined;

                      if (firstNote) {
                        void openNote(firstNote.relativePath);
                      }
                    }}
                    type="button"
                  >
                    Open first note
                  </button>
                  <button
                    className="button button--ghost"
                    onClick={() => {
                      startCreateInline("file");
                    }}
                    type="button"
                  >
                    New note
                  </button>
                </div>
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
          {contextMenu.entry.kind === "directory" ? (
            <>
              <button
                className="tree-context-menu__item"
                onClick={() => {
                  startCreateInline("file", contextMenu.entry);
                }}
                type="button"
              >
                New Note
              </button>
              <button
                className="tree-context-menu__item"
                onClick={() => {
                  startCreateInline("directory", contextMenu.entry);
                }}
                type="button"
              >
                New Folder
              </button>
              <div className="tree-context-menu__separator" />
            </>
          ) : null}

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
    </div>
  );
}
