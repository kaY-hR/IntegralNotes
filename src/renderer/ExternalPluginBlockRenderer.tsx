import { useEffect, useRef, useState } from "react";

import type {
  IntegralBlockDocument,
  IntegralBlockTypeDefinition
} from "../shared/integral";
import {
  PLUGIN_RENDER_ACTION_STATE_MESSAGE_TYPE,
  PLUGIN_RENDER_REQUEST_ACTION_MESSAGE_TYPE,
  PLUGIN_RENDER_SET_BLOCK_MESSAGE_TYPE,
  PLUGIN_RENDER_UPDATE_PARAMS_MESSAGE_TYPE,
  type PluginRenderActionStatePayload,
  type PluginRendererModel
} from "../shared/plugins";

interface ExternalPluginBlockRendererProps {
  block: IntegralBlockDocument;
  definition: IntegralBlockTypeDefinition;
  onUpdateParams: (nextParams: Record<string, unknown>) => void;
}

export function ExternalPluginBlockRenderer({
  block,
  definition,
  onUpdateParams
}: ExternalPluginBlockRendererProps): JSX.Element {
  const externalPlugin = definition.externalPlugin;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [rendererDocument, setRendererDocument] = useState<string | null>(null);
  const [frameRevision, setFrameRevision] = useState(0);
  const [frameReadyToken, setFrameReadyToken] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<PluginRenderActionStatePayload>(
    createIdleActionState()
  );

  useEffect(() => {
    if (externalPlugin?.rendererMode !== "iframe") {
      setRendererDocument(null);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    setRendererDocument(null);
    setLoadError(null);
    setFrameReadyToken(0);

    void window.integralNotes
      .loadPluginRendererDocument(externalPlugin.runtimePluginId)
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
  }, [externalPlugin?.rendererMode, externalPlugin?.runtimePluginId]);

  useEffect(() => {
    if (externalPlugin?.rendererMode !== "iframe") {
      return;
    }

    const frameWindow = iframeRef.current?.contentWindow;

    if (!frameWindow || !rendererDocument || frameReadyToken === 0) {
      return;
    }

    frameWindow.postMessage(
      {
        payload: toPluginRendererModel(block, definition),
        type: PLUGIN_RENDER_SET_BLOCK_MESSAGE_TYPE
      },
      "*"
    );
  }, [block, definition, externalPlugin?.rendererMode, frameReadyToken, rendererDocument]);

  useEffect(() => {
    const frameWindow = iframeRef.current?.contentWindow;

    if (!frameWindow || !rendererDocument || frameReadyToken === 0) {
      return;
    }

    frameWindow.postMessage(
      {
        payload: actionState,
        type: PLUGIN_RENDER_ACTION_STATE_MESSAGE_TYPE
      },
      "*"
    );
  }, [actionState, frameReadyToken, rendererDocument]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent): void => {
      const frameWindow = iframeRef.current?.contentWindow;

      if (event.source !== frameWindow || !isJsonRecord(event.data)) {
        return;
      }

      const messageType = typeof event.data.type === "string" ? event.data.type : "";

      if (messageType === PLUGIN_RENDER_UPDATE_PARAMS_MESSAGE_TYPE) {
        const payload = isJsonRecord(event.data.payload) ? event.data.payload : null;
        const params = payload && isJsonRecord(payload.params) ? payload.params : null;

        if (params) {
          onUpdateParams(params);
        }

        return;
      }

      if (messageType !== PLUGIN_RENDER_REQUEST_ACTION_MESSAGE_TYPE) {
        return;
      }

      const payload = isJsonRecord(event.data.payload) ? event.data.payload : null;
      const actionId =
        typeof payload?.actionId === "string" && payload.actionId.trim().length > 0
          ? payload.actionId.trim()
          : null;

      if (!actionId || !externalPlugin || actionState.status === "running") {
        return;
      }

      void executePluginAction(actionId);
    };

    const executePluginAction = async (actionId: string): Promise<void> => {
      if (!externalPlugin) {
        return;
      }

      const action = externalPlugin.actions?.find((candidate) => candidate.id === actionId);
      const startedAt = new Date().toISOString();

      setActionState({
        actionId,
        finishedAt: null,
        logLines: [],
        startedAt,
        status: "running",
        summary: action?.busyLabel ?? "plugin action を実行中..."
      });

      try {
        const result = await window.integralNotes.executeIntegralAction({
          actionId,
          blockType: externalPlugin.runtimeBlockType,
          params: block.params,
          payload: JSON.stringify(block, null, 2)
        });

        setActionState({
          actionId: result.actionId,
          finishedAt: result.finishedAt,
          logLines: result.logLines,
          startedAt: result.startedAt,
          status: "success",
          summary: result.summary
        });
      } catch (error) {
        setActionState({
          actionId,
          finishedAt: new Date().toISOString(),
          logLines: [toErrorMessage(error)],
          startedAt,
          status: "error",
          summary: "plugin action の実行に失敗しました。"
        });
      }
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [actionState.status, block, externalPlugin, onUpdateParams]);

  if (externalPlugin?.rendererMode !== "iframe") {
    return (
      <div className="integral-plugin-frame-shell integral-plugin-frame-shell--loading">
        custom renderer は未定義です。
      </div>
    );
  }

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
        plugin renderer を読み込み中...
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
        title={`${definition.pluginDisplayName} ${definition.title}`}
      />
    </div>
  );
}

function toPluginRendererModel(
  block: IntegralBlockDocument,
  definition: IntegralBlockTypeDefinition
): PluginRendererModel {
  const externalPlugin = definition.externalPlugin;

  if (!externalPlugin) {
    throw new Error("external plugin 情報が見つかりません。");
  }

  return {
    block: {
      params: isJsonRecord(block.params) ? block.params : {},
      type: externalPlugin.runtimeBlockType
    },
    blockDefinition: {
      actions: externalPlugin.actions?.map((action) => ({ ...action })),
      description: definition.description,
      title: definition.title,
      type: externalPlugin.runtimeBlockType
    },
    plugin: {
      description: definition.pluginDescription,
      displayName: definition.pluginDisplayName,
      id: externalPlugin.runtimePluginId,
      namespace: externalPlugin.namespace,
      origin: externalPlugin.origin,
      version: externalPlugin.version
    }
  };
}

function createIdleActionState(): PluginRenderActionStatePayload {
  return {
    actionId: null,
    finishedAt: null,
    logLines: [],
    startedAt: null,
    status: "idle",
    summary: null
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
