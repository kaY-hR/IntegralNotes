import type { WorkspaceEntry } from "../shared/workspace";

interface FileTreeProps {
  entries: WorkspaceEntry[];
  expandedPaths: Set<string>;
  selectedPath: string;
  onSelectEntry: (relativePath: string) => void;
  onToggleDirectory: (relativePath: string) => void;
  onOpenFile: (relativePath: string) => void;
}

export function FileTree({
  entries,
  expandedPaths,
  selectedPath,
  onSelectEntry,
  onToggleDirectory,
  onOpenFile
}: FileTreeProps): JSX.Element {
  return (
    <div className="file-tree">
      {entries.map((entry) => (
        <FileTreeNode
          entry={entry}
          expandedPaths={expandedPaths}
          key={entry.relativePath}
          selectedPath={selectedPath}
          onOpenFile={onOpenFile}
          onSelectEntry={onSelectEntry}
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
  entry,
  expandedPaths,
  selectedPath,
  onSelectEntry,
  onToggleDirectory,
  onOpenFile
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
      <button
        className={`tree-row${isSelected ? " is-selected" : ""}`}
        onClick={handleClick}
        type="button"
      >
        <span className="tree-row__caret">{isDirectory ? (isExpanded ? "▾" : "▸") : "·"}</span>
        <span className={`tree-row__icon tree-row__icon--${entry.kind}`}>
          {isDirectory ? "DIR" : "MD"}
        </span>
        <span className="tree-row__label">{entry.name}</span>
      </button>

      {isExpanded && entry.children && entry.children.length > 0 ? (
        <div className="tree-children">
          {entry.children.map((child) => (
            <FileTreeNode
              entry={child}
              expandedPaths={expandedPaths}
              key={child.relativePath}
              selectedPath={selectedPath}
              onOpenFile={onOpenFile}
              onSelectEntry={onSelectEntry}
              onToggleDirectory={onToggleDirectory}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
