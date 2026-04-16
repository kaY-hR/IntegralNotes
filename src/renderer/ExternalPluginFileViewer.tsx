import { useEffect, useRef, useState } from "react";

import {
  PLUGIN_RENDER_SET_VIEWER_MESSAGE_TYPE,
  type PluginViewerFileSource,
  type PluginViewerRendererModel,
  type ResolvedPluginViewer
} from "../shared/plugins";

interface ExternalPluginFileViewerProps {
  file: {
    content: string;
    name: string;
    pluginViewer: ResolvedPluginViewer;
    relativePath: string;
  };
  source: PluginViewerFileSource;
}

export function ExternalPluginFileViewer({
  file,
  source
}: ExternalPluginFileViewerProps): JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [rendererDocument, setRendererDocument] = useState<string | null>(null);
  const [frameRevision, setFrameRevision] = useState(0);
  const [frameReadyToken, setFrameReadyToken] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setRendererDocument(null);
    setLoadError(null);
    setFrameReadyToken(0);

    void window.integralNotes
      .loadPluginViewerDocument(file.pluginViewer.pluginId, file.pluginViewer.viewerId)
      .then((document) => {
        if (cancelled) {
          return;
        }

        setRendererDocument(document);
        setFrameRevision((current) => current + 1);
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(toErrorMessage(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [file.pluginViewer.pluginId, file.pluginViewer.viewerId]);

  useEffect(() => {
    const frameWindow = iframeRef.current?.contentWindow;

    if (!frameWindow || !rendererDocument || frameReadyToken === 0) {
      return;
    }

    frameWindow.postMessage(
      {
        payload: toPluginViewerRendererModel(file, source),
        type: PLUGIN_RENDER_SET_VIEWER_MESSAGE_TYPE
      },
      "*"
    );
  }, [file, frameReadyToken, rendererDocument, source]);

  if (loadError) {
    return (
      <div className="integral-plugin-frame-shell integral-plugin-frame-shell--loading">
        {loadError}
      </div>
    );
  }

  if (!rendererDocument) {
    return (
      <div className="integral-plugin-frame-shell integral-plugin-frame-shell--loading">
        plugin viewer を読み込み中...
      </div>
    );
  }

  return (
    <div className="integral-plugin-frame-shell">
      <iframe
        className="integral-plugin-frame"
        key={frameRevision}
        onLoad={() => {
          setFrameReadyToken(Date.now());
        }}
        ref={iframeRef}
        sandbox="allow-same-origin allow-scripts"
        srcDoc={rendererDocument}
        title={`${file.pluginViewer.pluginDisplayName} ${file.pluginViewer.viewerDisplayName}`}
      />
    </div>
  );
}

function toPluginViewerRendererModel(
  file: ExternalPluginFileViewerProps["file"],
  source: PluginViewerFileSource
): PluginViewerRendererModel {
  return {
    file: {
      data: file.content,
      dataEncoding: file.pluginViewer.dataEncoding,
      mediaType: file.pluginViewer.mediaType,
      name: file.name,
      relativePath: file.relativePath,
      source
    },
    plugin: {
      description: file.pluginViewer.pluginDescription,
      displayName: file.pluginViewer.pluginDisplayName,
      id: file.pluginViewer.pluginId,
      namespace: file.pluginViewer.pluginNamespace,
      origin: "external",
      version: file.pluginViewer.pluginVersion
    },
    viewer: {
      description: file.pluginViewer.viewerDescription,
      displayName: file.pluginViewer.viewerDisplayName,
      extensions: [...file.pluginViewer.viewerExtensions],
      id: file.pluginViewer.viewerId
    }
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}
