import { DatasetManifestFileViewer } from "./DatasetManifestFileViewer";
import { ExternalPluginFileViewer } from "./ExternalPluginFileViewer";
import type { WorkspaceFileDocument } from "../shared/workspace";

interface WorkspaceFileViewerAction {
  buttonLabel: string;
  buttonTitle?: string;
  onOpen: () => void;
}

interface WorkspaceFileViewerProps {
  file: WorkspaceFileDocument;
  managedDataAction?: WorkspaceFileViewerAction;
  onOpenInExternalApp?: (relativePath: string) => void;
}

export function WorkspaceFileViewer({
  file,
  managedDataAction,
  onOpenInExternalApp
}: WorkspaceFileViewerProps): JSX.Element {
  if (file.kind === "unsupported" || file.content === null) {
    return (
      <div className="workspace-file-viewer workspace-file-viewer--empty">
        <div className="workspace-file-viewer__message">
          <strong>{file.name}</strong>
          <p>この形式はまだ main app 上で表示できません。</p>
          <div className="workspace-file-viewer__actions">
            {managedDataAction ? (
              <button
                className="button button--note"
                onClick={() => {
                  managedDataAction.onOpen();
                }}
                title={managedDataAction.buttonTitle}
                type="button"
              >
                {managedDataAction.buttonLabel}
              </button>
            ) : null}
            <button
              className="button button--primary"
              onClick={() => {
                onOpenInExternalApp?.(file.relativePath);
              }}
              type="button"
            >
              外部アプリで開く
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-file-viewer">
      {managedDataAction ? (
        <div className="workspace-file-viewer__toolbar">
          <button
            className="button button--note button--xs"
            onClick={() => {
              managedDataAction.onOpen();
            }}
            title={managedDataAction.buttonTitle}
            type="button"
          >
            {managedDataAction.buttonLabel}
          </button>
        </div>
      ) : null}
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
        ) : file.kind === "plugin" && file.pluginViewer ? (
          <ExternalPluginFileViewer
            file={{
              content: file.content ?? "",
              name: file.name,
              pluginViewer: file.pluginViewer,
              relativePath: file.relativePath
            }}
            presentation="full"
            source={{
              kind: "workspace-file"
            }}
          />
        ) : file.kind === "dataset-json" && file.datasetManifest ? (
          <DatasetManifestFileViewer
            manifest={file.datasetManifest}
            onOpenInExternalApp={onOpenInExternalApp}
          />
        ) : (
          <pre className="integral-renderable-card__text workspace-file-viewer__text">{file.content}</pre>
        )}
      </section>
    </div>
  );
}


