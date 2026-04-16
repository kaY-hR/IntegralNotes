import { useEffect, useRef, useState } from "react";

import {
  PLUGIN_RENDER_SET_SIDEBAR_VIEW_MESSAGE_TYPE,
  type InstalledPluginDefinition
} from "../shared/plugins";

interface ExternalPluginSidebarViewProps {
  plugin: InstalledPluginDefinition;
  sidebarView: InstalledPluginDefinition["sidebarViews"][number];
}

export function ExternalPluginSidebarView({
  plugin,
  sidebarView
}: ExternalPluginSidebarViewProps): JSX.Element {
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
      .loadPluginSidebarViewDocument(plugin.id, sidebarView.id)
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
  }, [plugin.id, sidebarView.id]);

  useEffect(() => {
    const frameWindow = iframeRef.current?.contentWindow;

    if (!frameWindow || !rendererDocument || frameReadyToken === 0) {
      return;
    }

    frameWindow.postMessage(
      {
        payload: {
          plugin: {
            description: plugin.description,
            displayName: plugin.displayName,
            id: plugin.id,
            namespace: plugin.namespace,
            origin: plugin.origin,
            version: plugin.version
          },
          sidebarView: {
            description: sidebarView.description,
            icon: sidebarView.icon,
            id: sidebarView.id,
            title: sidebarView.title
          }
        },
        type: PLUGIN_RENDER_SET_SIDEBAR_VIEW_MESSAGE_TYPE
      },
      "*"
    );
  }, [frameReadyToken, plugin, rendererDocument, sidebarView]);

  if (loadError) {
    return (
      <div className="sidebar-plugin-view sidebar-plugin-view--status">
        <p className="sidebar__eyebrow">Plugin View</p>
        <strong>{sidebarView.title}</strong>
        <span>{loadError}</span>
      </div>
    );
  }

  if (!rendererDocument) {
    return (
      <div className="sidebar-plugin-view sidebar-plugin-view--status">
        <p className="sidebar__eyebrow">Plugin View</p>
        <strong>{sidebarView.title}</strong>
        <span>plugin sidebar view を読み込み中...</span>
      </div>
    );
  }

  return (
    <div className="sidebar-plugin-view">
      <iframe
        className="sidebar-plugin-view__frame"
        key={frameRevision}
        onLoad={() => {
          setFrameReadyToken(Date.now());
        }}
        ref={iframeRef}
        sandbox="allow-same-origin allow-scripts"
        srcDoc={rendererDocument}
        title={`${plugin.displayName} ${sidebarView.title}`}
      />
    </div>
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}
