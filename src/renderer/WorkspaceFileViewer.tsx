import type { WorkspaceFileDocument } from "../shared/workspace";

interface WorkspaceFileViewerProps {
  file: WorkspaceFileDocument;
}

export function WorkspaceFileViewer({ file }: WorkspaceFileViewerProps): JSX.Element {
  if (file.kind === "unsupported" || file.content === null) {
    return (
      <div className="workspace-file-viewer workspace-file-viewer--empty">
        <div className="workspace-file-viewer__message">
          <strong>{file.name}</strong>
          <p>この形式はまだ main app 上で表示できません。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-file-viewer">
      <section className="integral-renderable-card workspace-file-viewer__card">
        {file.kind === "html" ? (
          <iframe
            className="integral-renderable-card__frame workspace-file-viewer__frame"
            sandbox="allow-same-origin allow-scripts"
            srcDoc={file.content}
            title={file.name}
          />
        ) : file.kind === "image" ? (
          <img
            alt={file.name}
            className="integral-renderable-card__image workspace-file-viewer__image"
            src={file.content}
          />
        ) : (
          <pre className="integral-renderable-card__text workspace-file-viewer__text">{file.content}</pre>
        )}
      </section>
    </div>
  );
}


