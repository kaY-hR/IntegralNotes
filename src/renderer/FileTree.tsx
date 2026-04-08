import { useEffect, useRef, useState } from "react";

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
  editingPending: boolean;
  editingState: FileTreeInlineEditorState | null;
  entries: WorkspaceEntry[];
  expandedPaths: Set<string>;
  selectedPath: string;
  onCancelEditing: () => void;
  onCreateEntry: (kind: WorkspaceEntryKind, entry: WorkspaceEntry) => void;
  onDeleteEntry: (entry: WorkspaceEntry) => void;
  onOpenFile: (relativePath: string) => void;
  onRenameEntry: (entry: WorkspaceEntry) => void;
  onSelectEntry: (relativePath: string) => void;
  onSubmitEditing: (value: string) => void;
  onToggleDirectory: (relativePath: string) => void;
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
  editingPending,
  editingState,
  entries,
  expandedPaths,
  selectedPath,
  onCancelEditing,
  onCreateEntry,
  onDeleteEntry,
  onOpenFile,
  onRenameEntry,
  onSelectEntry,
  onSubmitEditing,
  onToggleDirectory
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
          editingPending={editingPending}
          editingState={editingState}
          entry={entry}
          expandedPaths={expandedPaths}
          key={entry.relativePath}
          selectedPath={selectedPath}
          onCancelEditing={onCancelEditing}
          onCreateEntry={onCreateEntry}
          onDeleteEntry={onDeleteEntry}
          onOpenFile={onOpenFile}
          onRenameEntry={onRenameEntry}
          onSelectEntry={onSelectEntry}
          onSubmitEditing={onSubmitEditing}
          onToggleDirectory={onToggleDirectory}
        />
      ))}
    </div>
  );
}

interface FileTreeNodeProps extends FileTreeProps {
  entry: WorkspaceEntry;
}

function FileTreeNode({
  editingPending,
  editingState,
  entry,
  expandedPaths,
  selectedPath,
  onCancelEditing,
  onCreateEntry,
  onDeleteEntry,
  onOpenFile,
  onRenameEntry,
  onSelectEntry,
  onSubmitEditing,
  onToggleDirectory
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
  const isSelected = selectedPath === entry.relativePath || Boolean(renameState);
  const shouldRenderChildren =
    isExpanded && ((entry.children?.length ?? 0) > 0 || childCreateState !== null);

  const handleClick = (): void => {
    if (renameState) {
      return;
    }

    onSelectEntry(entry.relativePath);

    if (isDirectory) {
      onToggleDirectory(entry.relativePath);
      return;
    }

    onOpenFile(entry.relativePath);
  };

  return (
    <div className="tree-node">
      <div className={`tree-row${isSelected ? " is-selected" : ""}${renameState ? " is-editing" : ""}`}>
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
          <button className="tree-row__main" onClick={handleClick} type="button">
            <span className="tree-row__caret">{isDirectory ? (isExpanded ? "▾" : "▸") : "·"}</span>
            <span aria-hidden="true" className={`tree-row__icon tree-row__icon--${entry.kind}`} />
            <span className="tree-row__label">{entry.name}</span>
          </button>
        )}

        {!renameState ? (
          <div className="tree-row__actions">
            {isDirectory ? (
              <>
                <button
                  className="tree-action"
                  onClick={() => {
                    onSelectEntry(entry.relativePath);
                    onCreateEntry("file", entry);
                  }}
                  type="button"
                >
                  +N
                </button>
                <button
                  className="tree-action"
                  onClick={() => {
                    onSelectEntry(entry.relativePath);
                    onCreateEntry("directory", entry);
                  }}
                  type="button"
                >
                  +F
                </button>
              </>
            ) : null}
            <button
              className="tree-action"
              onClick={() => {
                onSelectEntry(entry.relativePath);
                onRenameEntry(entry);
              }}
              type="button"
            >
              Ren
            </button>
            <button
              className="tree-action tree-action--danger"
              onClick={() => {
                onSelectEntry(entry.relativePath);
                onDeleteEntry(entry);
              }}
              type="button"
            >
              Del
            </button>
          </div>
        ) : null}
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
              editingPending={editingPending}
              editingState={editingState}
              entry={child}
              expandedPaths={expandedPaths}
              key={child.relativePath}
              selectedPath={selectedPath}
              onCancelEditing={onCancelEditing}
              onCreateEntry={onCreateEntry}
              onDeleteEntry={onDeleteEntry}
              onOpenFile={onOpenFile}
              onRenameEntry={onRenameEntry}
              onSelectEntry={onSelectEntry}
              onSubmitEditing={onSubmitEditing}
              onToggleDirectory={onToggleDirectory}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
