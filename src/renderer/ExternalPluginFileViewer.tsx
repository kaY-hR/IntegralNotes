import { useEffect, useRef, useState } from "react";

import {
  PLUGIN_RENDER_SET_VIEWER_MESSAGE_TYPE,
  PLUGIN_VIEWER_RESOLVE_WORKSPACE_FILE_URL_MESSAGE_TYPE,
  PLUGIN_VIEWER_RESOLVE_WORKSPACE_FILE_URL_RESULT_MESSAGE_TYPE,
  type PluginViewerResolveWorkspaceFileUrlMessage,
  type PluginViewerResolveWorkspaceFileUrlResultMessage,
  type PluginViewerFileSource,
  type PluginViewerPresentation,
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
  presentation?: PluginViewerPresentation;
  source: PluginViewerFileSource;
}

export function ExternalPluginFileViewer({
  file,
  presentation = "full",
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
        payload: toPluginViewerRendererModel(file, source, presentation),
        type: PLUGIN_RENDER_SET_VIEWER_MESSAGE_TYPE
      },
      "*"
    );
  }, [file, frameReadyToken, presentation, rendererDocument, source]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>): void => {
      const frameWindow = iframeRef.current?.contentWindow;

      if (!frameWindow || event.source !== frameWindow) {
        return;
      }

      if (!isPluginViewerResolveWorkspaceFileUrlMessage(event.data)) {
        return;
      }

      void resolvePluginViewerWorkspaceFileUrl(event.data, file.relativePath, frameWindow);
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [file.relativePath]);

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

async function resolvePluginViewerWorkspaceFileUrl(
  message: PluginViewerResolveWorkspaceFileUrlMessage,
  viewerFileRelativePath: string,
  frameWindow: Window
): Promise<void> {
  const { path, requestId } = message.payload;

  try {
    const relativePath = resolveViewerRelativePath(path, viewerFileRelativePath);
    const url = await window.integralNotes.resolveWorkspaceFileUrl(relativePath);

    postPluginViewerWorkspaceFileUrlResult(frameWindow, {
      path,
      relativePath,
      requestId,
      url
    });
  } catch (error) {
    postPluginViewerWorkspaceFileUrlResult(frameWindow, {
      error: toErrorMessage(error),
      path,
      requestId
    });
  }
}

function postPluginViewerWorkspaceFileUrlResult(
  frameWindow: Window,
  payload: PluginViewerResolveWorkspaceFileUrlResultMessage["payload"]
): void {
  frameWindow.postMessage(
    {
      payload,
      type: PLUGIN_VIEWER_RESOLVE_WORKSPACE_FILE_URL_RESULT_MESSAGE_TYPE
    } satisfies PluginViewerResolveWorkspaceFileUrlResultMessage,
    "*"
  );
}

function toPluginViewerRendererModel(
  file: ExternalPluginFileViewerProps["file"],
  source: PluginViewerFileSource,
  presentation: PluginViewerPresentation
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
    presentation,
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

function resolveViewerRelativePath(requestedPath: string, viewerFileRelativePath: string): string {
  const trimmedPath = requestedPath.trim();

  if (trimmedPath.length === 0) {
    throw new Error("path が空です。");
  }

  if (trimmedPath.startsWith("//") || /^[A-Za-z][A-Za-z\d+.-]*:/u.test(trimmedPath)) {
    throw new Error("workspace file ではない path は解決できません。");
  }

  let normalizedPath = trimmedPath.replace(/\\/gu, "/");

  try {
    normalizedPath = decodeURI(normalizedPath);
  } catch {
    throw new Error("path を decode できません。");
  }

  if (normalizedPath.startsWith("/")) {
    return normalizedPath.replace(/^\/+/u, "");
  }

  const baseDirectory = dirname(viewerFileRelativePath);
  return [baseDirectory, normalizedPath].filter(Boolean).join("/");
}

function dirname(relativePath: string): string {
  const parts = relativePath.replace(/\\/gu, "/").split("/").filter(Boolean);

  if (parts.length <= 1) {
    return "";
  }

  return parts.slice(0, -1).join("/");
}

function isPluginViewerResolveWorkspaceFileUrlMessage(
  value: unknown
): value is PluginViewerResolveWorkspaceFileUrlMessage {
  if (!isRecord(value) || value.type !== PLUGIN_VIEWER_RESOLVE_WORKSPACE_FILE_URL_MESSAGE_TYPE) {
    return false;
  }

  const payload = value.payload;
  return (
    isRecord(payload) &&
    typeof payload.requestId === "string" &&
    typeof payload.path === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}
