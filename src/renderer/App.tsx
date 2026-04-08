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
import { FileTree } from "./FileTree";
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

type DialogState =
  | {
      confirmLabel: string;
      description: string;
      initialValue: string;
      inputLabel: string;
      mode: "create";
      parentPath: string;
      requireInput: true;
      title: string;
      targetKind: WorkspaceEntryKind;
    }
  | {
      confirmLabel: string;
      description: string;
      initialValue: string;
      inputLabel: string;
      mode: "rename";
      requireInput: true;
      targetKind: WorkspaceEntryKind;
      targetPath: string;
      title: string;
    }
  | {
      confirmLabel: string;
      description: string;
      mode: "delete";
      requireInput: false;
      targetKind: WorkspaceEntryKind;
      targetPath: string;
      title: string;
    };

const MAIN_TABSET_ID = "editor-main";

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

export function App(): JSX.Element {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [openTabs, setOpenTabs] = useState<Record<string, OpenNoteTab>>({});
  const [selectedEntryPath, setSelectedEntryPath] = useState("");
  const [selectedTabId, setSelectedTabId] = useState<string | undefined>(undefined);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(["", "Experiments"]));
  const [statusMessage, setStatusMessage] = useState("Notes ワークスペースを読み込み中...");
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogPending, setDialogPending] = useState(false);
  const [model] = useState(() => createLayoutModel());
  const openTabsRef = useRef(openTabs);

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

  const refreshWorkspace = async (nextStatus?: string): Promise<void> => {
    setLoadingWorkspace(true);

    try {
      const snapshot = await window.integralNotes.getWorkspaceSnapshot();
      setWorkspace(snapshot);

      if (!hasEntry(snapshot.entries, selectedEntryPath)) {
        setSelectedEntryPath("");
      }

      if (nextStatus) {
        setStatusMessage(nextStatus);
      }
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

  const submitDialog = async (value: string): Promise<void> => {
    if (!dialog) {
      return;
    }

    setDialogPending(true);

    try {
      if (dialog.mode === "create") {
        const result = await window.integralNotes.createEntry({
          parentPath: dialog.parentPath,
          name: value,
          kind: dialog.targetKind
        });
        await handleCreateResult(result);
      }

      if (dialog.mode === "rename") {
        const result = await window.integralNotes.renameEntry({
          targetPath: dialog.targetPath,
          nextName: value
        });
        await handleRenameResult(result);
      }

      if (dialog.mode === "delete") {
        const result = await window.integralNotes.deleteEntry({
          targetPath: dialog.targetPath
        });
        handleDeleteResult(result);
      }

      setDialog(null);
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    } finally {
      setDialogPending(false);
    }
  };

  const openCreateDialog = (kind: WorkspaceEntryKind): void => {
    const basePath =
      selectedEntry?.kind === "directory"
        ? selectedEntry.relativePath
        : selectedEntry
          ? dirname(selectedEntry.relativePath)
          : "";

    setDialog({
      mode: "create",
      title: kind === "file" ? "新規ノート" : "新規フォルダ",
      description:
        basePath.length > 0
          ? `${basePath} 配下に作成します。`
          : "Notes 直下に作成します。",
      confirmLabel: kind === "file" ? "Create note" : "Create folder",
      inputLabel: kind === "file" ? "ノート名" : "フォルダ名",
      initialValue: "",
      parentPath: basePath,
      requireInput: true,
      targetKind: kind
    });
  };

  const openRenameDialog = (): void => {
    if (!selectedEntry) {
      setStatusMessage("リネーム対象を選択してください。");
      return;
    }

    setDialog({
      mode: "rename",
      title: "リネーム",
      description: `${selectedEntry.name} の名前を変更します。`,
      confirmLabel: "Rename",
      inputLabel: "新しい名前",
      initialValue: displayNameForRename(selectedEntry),
      requireInput: true,
      targetKind: selectedEntry.kind,
      targetPath: selectedEntry.relativePath
    });
  };

  const openDeleteDialog = (): void => {
    if (!selectedEntry) {
      setStatusMessage("削除対象を選択してください。");
      return;
    }

    setDialog({
      mode: "delete",
      title: "削除確認",
      description:
        selectedEntry.kind === "directory"
          ? `${selectedEntry.name} 配下も含めて削除します。`
          : `${selectedEntry.name} を削除します。`,
      confirmLabel: "Delete",
      requireInput: false,
      targetKind: selectedEntry.kind,
      targetPath: selectedEntry.relativePath
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
      <aside className="sidebar">
        <div className="sidebar__hero">
          <p className="sidebar__eyebrow">IntegralNotes</p>
          <h1>Research Notes Dock</h1>
          <p>Markdown エディタ、ノートツリー、自由配置タブを 1 画面にまとめた仮実装です。</p>
        </div>

        <div className="sidebar__panel">
          <div className="sidebar__panel-header">
            <div>
              <p className="sidebar__section-title">Workspace</p>
              <strong>{workspace?.rootName ?? "Notes"}</strong>
            </div>
            <button
              className="button button--ghost"
              onClick={() => {
                void refreshWorkspace("ワークスペースを更新しました");
              }}
              type="button"
            >
              Refresh
            </button>
          </div>

          <div className="sidebar__actions">
            <button
              className="button button--primary"
              onClick={() => {
                openCreateDialog("file");
              }}
              type="button"
            >
              + Note
            </button>
            <button
              className="button button--ghost"
              onClick={() => {
                openCreateDialog("directory");
              }}
              type="button"
            >
              + Folder
            </button>
          </div>

          <div className="sidebar__actions sidebar__actions--secondary">
            <button
              className="button button--ghost"
              onClick={openRenameDialog}
              type="button"
            >
              Rename
            </button>
            <button
              className="button button--danger button--subtle"
              onClick={openDeleteDialog}
              type="button"
            >
              Delete
            </button>
          </div>

          <div className="sidebar__tree">
            {loadingWorkspace && !workspace ? (
              <div className="sidebar__placeholder">Loading workspace...</div>
            ) : workspace ? (
              <FileTree
                entries={workspace.entries}
                expandedPaths={expandedPaths}
                selectedPath={selectedEntryPath}
                onOpenFile={(relativePath) => {
                  void openNote(relativePath);
                }}
                onSelectEntry={setSelectedEntryPath}
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
        <header className="workspace__header">
          <div>
            <p className="workspace__eyebrow">Editor Surface</p>
            <h2>{activeTab?.name ?? "No note selected"}</h2>
            <p className="workspace__path">
              {activeTab
                ? `${activeTab.relativePath}${isDirty(activeTab) ? "  |  unsaved changes" : ""}`
                : "左のツリーから Markdown ノートを開いてください。"}
            </p>
          </div>

          <div className="workspace__controls">
            <div className="workspace__status">{statusMessage}</div>
            <button
              className="button button--primary"
              disabled={!activeTab || activeTab.isSaving}
              onClick={() => {
                if (activeTab) {
                  void saveNote(activeTab.relativePath);
                }
              }}
              type="button"
            >
              {activeTab?.isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </header>

        <section className="workspace__layout">
          <FlexLayout.Layout
            factory={editorFactory}
            model={model}
            onModelChange={handleLayoutModelChange}
            onTabSetPlaceHolder={() => (
              <div className="layout-placeholder">
                <p className="layout-placeholder__eyebrow">Dock-Ready Editor</p>
                <h3>ノートを開くとここにタブが追加されます</h3>
                <p>FlexLayout の標準操作で、タブの分割・移動・最大化を試せます。</p>
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
                      openCreateDialog("file");
                    }}
                    type="button"
                  >
                    Create note
                  </button>
                </div>
              </div>
            )}
          />
        </section>
      </main>

      {dialog ? (
        <WorkspaceDialog
          confirmLabel={dialog.confirmLabel}
          danger={dialog.mode === "delete"}
          description={dialog.description}
          initialValue={dialog.requireInput ? dialog.initialValue : undefined}
          inputLabel={dialog.requireInput ? dialog.inputLabel : undefined}
          onClose={() => {
            if (!dialogPending) {
              setDialog(null);
            }
          }}
          onConfirm={(value) => {
            void submitDialog(value);
          }}
          pending={dialogPending}
          requireInput={dialog.requireInput}
          title={dialog.title}
        />
      ) : null}
    </div>
  );
}
