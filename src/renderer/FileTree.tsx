import type { WorkspaceEntry, WorkspaceEntryKind } from "../shared/workspace";

interface FileTreeProps {
  entries: WorkspaceEntry[];
  expandedPaths: Set<string>;
  selectedPath: string;
  onCreateEntry: (kind: WorkspaceEntryKind, entry: WorkspaceEntry) => void;
  onDeleteEntry: (entry: WorkspaceEntry) => void;
  onSelectEntry: (relativePath: string) => void;
  onToggleDirectory: (relativePath: string) => void;
  onOpenFile: (relativePath: string) => void;
  onRenameEntry: (entry: WorkspaceEntry) => void;
}

export function FileTree({
  entries,
  expandedPaths,
  selectedPath,
  onCreateEntry,
  onDeleteEntry,
  onSelectEntry,
  onToggleDirectory,
  onOpenFile,
  onRenameEntry
}: FileTreeProps): JSX.Element {
  return (
    <div className="file-tree">
      {entries.map((entry) => (
        <FileTreeNode
          entry={entry}
          expandedPaths={expandedPaths}
          key={entry.relativePath}
          selectedPath={selectedPath}
          onCreateEntry={onCreateEntry}
          onDeleteEntry={onDeleteEntry}
          onOpenFile={onOpenFile}
          onSelectEntry={onSelectEntry}
          onToggleDirectory={onToggleDirectory}
          onRenameEntry={onRenameEntry}
        />
      ))}
    </div>
  );
}

interface FileTreeNodeProps extends FileTreeProps {
  entry: WorkspaceEntry;
}

function FileTreeNode({
  entry,
  expandedPaths,
  selectedPath,
  onCreateEntry,
  onDeleteEntry,
  onSelectEntry,
  onToggleDirectory,
  onOpenFile,
  onRenameEntry
}: FileTreeNodeProps): JSX.Element {
  const isDirectory = entry.kind === "directory";
  const isExpanded = isDirectory && expandedPaths.has(entry.relativePath);
  const isSelected = selectedPath === entry.relativePath;

  const handleClick = (): void => {
    onSelectEntry(entry.relativePath);

    if (isDirectory) {
      onToggleDirectory(entry.relativePath);
      return;
    }

    onOpenFile(entry.relativePath);
  };

  return (
    <div className="tree-node">
      <div className={`tree-row${isSelected ? " is-selected" : ""}`}>
        <button className="tree-row__main" onClick={handleClick} type="button">
          <span className="tree-row__caret">{isDirectory ? (isExpanded ? "▾" : "▸") : "·"}</span>
          <span aria-hidden="true" className={`tree-row__icon tree-row__icon--${entry.kind}`} />
          <span className="tree-row__label">{entry.name}</span>
        </button>

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
      </div>

      {isExpanded && entry.children && entry.children.length > 0 ? (
        <div className="tree-children">
          {entry.children.map((child) => (
            <FileTreeNode
              entry={child}
              expandedPaths={expandedPaths}
              key={child.relativePath}
              selectedPath={selectedPath}
              onCreateEntry={onCreateEntry}
              onDeleteEntry={onDeleteEntry}
              onOpenFile={onOpenFile}
              onSelectEntry={onSelectEntry}
              onToggleDirectory={onToggleDirectory}
              onRenameEntry={onRenameEntry}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
