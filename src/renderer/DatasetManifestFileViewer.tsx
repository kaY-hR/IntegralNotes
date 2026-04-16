import { resolveWorkspaceMarkdownTarget } from "../shared/workspaceLinks";
import type { WorkspaceDatasetManifestView } from "../shared/workspace";
import {
  requestOpenManagedDataNote,
  requestOpenWorkspaceFile
} from "./workspaceOpenEvents";
import { ReadonlyMarkdownPreview } from "./ReadonlyMarkdownPreview";

interface DatasetManifestFileViewerProps {
  manifest: WorkspaceDatasetManifestView;
  onOpenInExternalApp?: (relativePath: string) => void;
}

export function DatasetManifestFileViewer({
  manifest,
  onOpenInExternalApp
}: DatasetManifestFileViewerProps): JSX.Element {
  const handleOpenNote = (): void => {
    requestOpenManagedDataNote(manifest.noteTargetId);
  };

  return (
    <div className="workspace-dataset-viewer">
      <section className="workspace-dataset-viewer__section">
        <div className="workspace-dataset-viewer__header">
          <div>
            <p className="workspace-dataset-viewer__eyebrow">Dataset</p>
            <h2 className="workspace-dataset-viewer__title">{manifest.datasetName}</h2>
          </div>
          <div className="workspace-dataset-viewer__summary">
            <span className="workspace-dataset-viewer__summary-chip">
              {manifest.members.length > 0 ? `${manifest.members.length} items` : "manifest"}
            </span>
            <span className="workspace-dataset-viewer__summary-chip">
              {manifest.datasetKind || "dataset"}
            </span>
            <span className="workspace-dataset-viewer__summary-chip">
              {manifest.datasetId}
            </span>
          </div>
        </div>
      </section>

      <section className="workspace-dataset-viewer__section">
        <div className="workspace-dataset-viewer__section-header">
          <h3>データ</h3>
          <span>{manifest.members.length} 件</span>
        </div>
        {manifest.members.length > 0 ? (
          <ul className="workspace-dataset-viewer__member-list">
            {manifest.members.map((member) => {
              const canOpenInWorkspace =
                member.relativePath !== null && member.representation === "file";
              const canOpenExternally =
                member.relativePath !== null &&
                (member.representation !== "file" || onOpenInExternalApp !== undefined);

              return (
                <li
                  className="workspace-dataset-viewer__member-card"
                  key={`${member.originalDataId}:${member.relativePath ?? "missing"}`}
                >
                  <div className="workspace-dataset-viewer__member-main">
                    <strong>{member.displayName}</strong>
                    <span>{member.originalDataId}</span>
                  </div>
                  <div className="workspace-dataset-viewer__member-meta">
                    <span>
                      {member.representation === "directory"
                        ? "directory"
                        : member.representation === "file"
                          ? "file"
                          : "unresolved"}
                    </span>
                    {member.relativePath ? (
                      canOpenInWorkspace ? (
                        <button
                          className="workspace-dataset-viewer__path-link"
                          onClick={() => {
                            requestOpenWorkspaceFile(member.relativePath ?? "");
                          }}
                          type="button"
                        >
                          {member.relativePath}
                        </button>
                      ) : canOpenExternally ? (
                        <button
                          className="workspace-dataset-viewer__path-link"
                          onClick={() => {
                            if (member.relativePath) {
                              onOpenInExternalApp?.(member.relativePath);
                            }
                          }}
                          type="button"
                        >
                          {member.relativePath}
                        </button>
                      ) : (
                        <code>{member.relativePath}</code>
                      )
                    ) : (
                      <span className="workspace-dataset-viewer__missing">
                        path が未解決です
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : manifest.dataPath ? (
          <div className="workspace-dataset-viewer__member-card">
            <div className="workspace-dataset-viewer__member-main">
              <strong>実データ</strong>
              <span>{manifest.datasetId}</span>
            </div>
            <div className="workspace-dataset-viewer__member-meta">
              <span>directory</span>
              {onOpenInExternalApp ? (
                <button
                  className="workspace-dataset-viewer__path-link"
                  onClick={() => {
                    onOpenInExternalApp(manifest.dataPath ?? "");
                  }}
                  type="button"
                >
                  {manifest.dataPath}
                </button>
              ) : (
                <code>{manifest.dataPath}</code>
              )}
            </div>
          </div>
        ) : (
          <div className="workspace-dataset-viewer__empty">
            manifest に表示可能な member 情報がありません。
          </div>
        )}
      </section>

      <section className="workspace-dataset-viewer__section workspace-dataset-viewer__section--note">
        <div className="workspace-dataset-viewer__section-header">
          <h3>ノート</h3>
          <span>{manifest.noteTargetId}</span>
        </div>
        {manifest.noteMarkdown && manifest.noteMarkdown.trim().length > 0 ? (
          <div
            aria-label="ノートを別タブで開く"
            className="workspace-dataset-viewer__note-surface"
            onClick={handleOpenNote}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") {
                return;
              }

              event.preventDefault();
              handleOpenNote();
            }}
            role="button"
            tabIndex={0}
            title="クリックしてノートを別タブで開く"
          >
            <ReadonlyMarkdownPreview
              className="workspace-dataset-viewer__note"
              content={manifest.noteMarkdown}
              proxyDomURL={proxyWorkspaceDatasetNoteImageUrl}
            />
          </div>
        ) : (
          <div className="workspace-dataset-viewer__empty">
            紐づくノートはまだありません。
          </div>
        )}
      </section>
    </div>
  );
}

async function proxyWorkspaceDatasetNoteImageUrl(url: string): Promise<string> {
  const relativePath = resolveWorkspaceMarkdownTarget(url);

  if (!relativePath) {
    return url;
  }

  try {
    return await window.integralNotes.resolveWorkspaceFileUrl(relativePath);
  } catch {
    return url;
  }
}
