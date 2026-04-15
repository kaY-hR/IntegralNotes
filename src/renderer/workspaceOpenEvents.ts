export const OPEN_WORKSPACE_FILE_EVENT = "integral:open-workspace-file";
export const OPEN_MANAGED_DATA_NOTE_EVENT = "integral:open-managed-data-note";

export function requestOpenWorkspaceFile(relativePath: string): void {
  const normalizedPath = relativePath.trim();

  if (normalizedPath.length === 0) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<string>(OPEN_WORKSPACE_FILE_EVENT, {
      detail: normalizedPath
    })
  );
}

export function requestOpenManagedDataNote(targetId: string): void {
  const normalizedId = targetId.trim();

  if (normalizedId.length === 0) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<string>(OPEN_MANAGED_DATA_NOTE_EVENT, {
      detail: normalizedId
    })
  );
}
