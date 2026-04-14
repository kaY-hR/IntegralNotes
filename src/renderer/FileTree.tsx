import { type DragEvent, type MouseEvent, useEffect, useRef, useState } from "react";

import type { WorkspaceEntry, WorkspaceEntryKind } from "../shared/workspace";

export type FileTreeInlineEditorState =
  | {
      initialValue: string;
      kind: WorkspaceEntryKind;
      mode: "create";
      parentPath: string;
    }
  | {
      initialValue: string;
      kind: WorkspaceEntryKind;
      mode: "rename";
      targetPath: string;
    };

interface FileTreeProps {
  dropTargetPath: string | null;
  editingPending: boolean;
  editingState: FileTreeInlineEditorState | null;
  entries: WorkspaceEntry[];
  expandedPaths: Set<string>;
  primarySelectedPath: string;
  selectedPaths: ReadonlySet<string>;
  onActivateEntry: (entry: WorkspaceEntry, event: MouseEvent<HTMLButtonElement>) => void;
  onCancelEditing: () => void;
  onContextMenuEntry: (entry: WorkspaceEntry, x: number, y: number) => void;
  onDoubleActivateEntry: (entry: WorkspaceEntry, event: MouseEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onDragOverEntry: (entry: WorkspaceEntry, event: DragEvent<HTMLDivElement>) => void;
  onDragStartEntry: (entry: WorkspaceEntry, event: DragEvent<HTMLButtonElement>) => void;
  onDropEntry: (entry: WorkspaceEntry, event: DragEvent<HTMLDivElement>) => void;
  onSubmitEditing: (value: string) => void;
}

interface TreeInlineEditorProps {
  initialValue: string;
  kind: WorkspaceEntryKind;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}

function TreeInlineEditor({
  initialValue,
  kind,
  pending,
  onCancel,
  onSubmit
}: TreeInlineEditorProps): JSX.Element {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlurRef = useRef(false);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    const input = inputRef.current;

    if (!input) {
      return;
    }

    input.focus();
    input.select();
  }, []);

  const submit = (): void => {
    if (value.trim().length === 0) {
      onCancel();
      return;
    }

    onSubmit(value);
  };

  return (
    <input
      className="tree-inline-input"
      disabled={pending}
      onBlur={() => {
        if (skipBlurRef.current) {
          skipBlurRef.current = false;
          return;
        }

        if (pending) {
          return;
        }

        submit();
      }}
      onChange={(event) => {
        setValue(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          skipBlurRef.current = true;
          event.preventDefault();
          onCancel();
          return;
        }

        if (event.key === "Enter") {
          skipBlurRef.current = true;
          event.preventDefault();
          submit();
        }
      }}
      placeholder={kind === "file" ? "ノート名" : "フォルダ名"}
      ref={inputRef}
      spellCheck={false}
      type="text"
      value={value}
    />
  );
}

interface InlineTreeRowProps {
  editingPending: boolean;
  editingState: FileTreeInlineEditorState;
  onCancelEditing: () => void;
  onSubmitEditing: (value: string) => void;
}

function InlineTreeRow({
  editingPending,
  editingState,
  onCancelEditing,
  onSubmitEditing
}: InlineTreeRowProps): JSX.Element {
  return (
    <div className="tree-row is-editing">
      <div className="tree-row__main tree-row__main--editing">
        <span className="tree-row__caret">·</span>
        <span aria-hidden="true" className={`tree-row__icon tree-row__icon--${editingState.kind}`} />
        <TreeInlineEditor
          initialValue={editingState.initialValue}
          kind={editingState.kind}
          onCancel={onCancelEditing}
          onSubmit={onSubmitEditing}
          pending={editingPending}
        />
      </div>
    </div>
  );
}

export function FileTree({
  dropTargetPath,
  editingPending,
  editingState,
  entries,
  expandedPaths,
  primarySelectedPath,
  selectedPaths,
  onActivateEntry,
  onCancelEditing,
  onContextMenuEntry,
  onDoubleActivateEntry,
  onDragEnd,
  onDragOverEntry,
  onDragStartEntry,
  onDropEntry,
  onSubmitEditing
}: FileTreeProps): JSX.Element {
  const rootCreateState =
    editingState?.mode === "create" && editingState.parentPath.length === 0 ? editingState : null;

  return (
    <div className="file-tree">
      {rootCreateState ? (
        <InlineTreeRow
          editingPending={editingPending}
          editingState={rootCreateState}
          onCancelEditing={onCancelEditing}
          onSubmitEditing={onSubmitEditing}
        />
      ) : null}

      {entries.map((entry) => (
        <FileTreeNode
          dropTargetPath={dropTargetPath}
          editingPending={editingPending}
          editingState={editingState}
          entry={entry}
          expandedPaths={expandedPaths}
          key={entry.relativePath}
          primarySelectedPath={primarySelectedPath}
          selectedPaths={selectedPaths}
          onActivateEntry={onActivateEntry}
          onCancelEditing={onCancelEditing}
          onContextMenuEntry={onContextMenuEntry}
          onDoubleActivateEntry={onDoubleActivateEntry}
          onDragEnd={onDragEnd}
          onDragOverEntry={onDragOverEntry}
          onDragStartEntry={onDragStartEntry}
          onDropEntry={onDropEntry}
          onSubmitEditing={onSubmitEditing}
        />
      ))}
    </div>
  );
}

interface FileTreeNodeProps extends FileTreeProps {
  entry: WorkspaceEntry;
}

function FileTreeNode({
  dropTargetPath,
  editingPending,
  editingState,
  entry,
  expandedPaths,
  primarySelectedPath,
  selectedPaths,
  onActivateEntry,
  onCancelEditing,
  onContextMenuEntry,
  onDoubleActivateEntry,
  onDragEnd,
  onDragOverEntry,
  onDragStartEntry,
  onDropEntry,
  onSubmitEditing
}: FileTreeNodeProps): JSX.Element {
  const isDirectory = entry.kind === "directory";
  const isExpanded = isDirectory && expandedPaths.has(entry.relativePath);
  const renameState =
    editingState?.mode === "rename" && editingState.targetPath === entry.relativePath
      ? editingState
      : null;
  const childCreateState =
    editingState?.mode === "create" && editingState.parentPath === entry.relativePath
      ? editingState
      : null;
  const isSelected = selectedPaths.has(entry.relativePath) || Boolean(renameState);
  const isPrimarySelected = primarySelectedPath === entry.relativePath || Boolean(renameState);
  const isDropTarget = dropTargetPath === entry.relativePath;
  const shouldRenderChildren =
    isExpanded && ((entry.children?.length ?? 0) > 0 || childCreateState !== null);

  const handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    onContextMenuEntry(entry, event.clientX, event.clientY);
  };

  return (
    <div
      className="tree-node"
      onDragOver={(event) => {
        onDragOverEntry(entry, event);
      }}
      onDrop={(event) => {
        onDropEntry(entry, event);
      }}
    >
      <div
        className={`tree-row${isSelected ? " is-selected" : ""}${isPrimarySelected ? " is-primary-selected" : ""}${renameState ? " is-editing" : ""}${isDropTarget ? " is-drop-target" : ""}`}
        onContextMenu={handleContextMenu}
      >
        {renameState ? (
          <div className="tree-row__main tree-row__main--editing">
            <span className="tree-row__caret">{isDirectory ? (isExpanded ? "▾" : "▸") : "·"}</span>
            <span aria-hidden="true" className={`tree-row__icon tree-row__icon--${entry.kind}`} />
            <TreeInlineEditor
              initialValue={renameState.initialValue}
              kind={renameState.kind}
              onCancel={onCancelEditing}
              onSubmit={onSubmitEditing}
              pending={editingPending}
            />
          </div>
        ) : (
          <button
            className="tree-row__main"
            draggable
            onClick={(event) => {
              onActivateEntry(entry, event);
            }}
            onDoubleClick={(event) => {
              onDoubleActivateEntry(entry, event);
            }}
            onDragEnd={onDragEnd}
            onDragStart={(event) => {
              onDragStartEntry(entry, event);
            }}
            type="button"
          >
            <span className="tree-row__caret">{isDirectory ? (isExpanded ? "▾" : "▸") : "·"}</span>
            <span aria-hidden="true" className={`tree-row__icon tree-row__icon--${entry.kind}`} />
            <span className="tree-row__label">{entry.name}</span>
          </button>
        )}
      </div>

      {shouldRenderChildren ? (
        <div className="tree-children">
          {childCreateState ? (
            <InlineTreeRow
              editingPending={editingPending}
              editingState={childCreateState}
              onCancelEditing={onCancelEditing}
              onSubmitEditing={onSubmitEditing}
            />
          ) : null}

          {entry.children?.map((child) => (
            <FileTreeNode
              dropTargetPath={dropTargetPath}
              editingPending={editingPending}
              editingState={editingState}
              entry={child}
              expandedPaths={expandedPaths}
              key={child.relativePath}
              primarySelectedPath={primarySelectedPath}
              selectedPaths={selectedPaths}
              onActivateEntry={onActivateEntry}
              onCancelEditing={onCancelEditing}
              onContextMenuEntry={onContextMenuEntry}
              onDragEnd={onDragEnd}
              onDragOverEntry={onDragOverEntry}
              onDragStartEntry={onDragStartEntry}
              onDropEntry={onDropEntry}
              onSubmitEditing={onSubmitEditing}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
