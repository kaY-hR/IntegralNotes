import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView, NodeView, NodeViewConstructor, ViewMutationRecord } from "@milkdown/kit/prose/view";
import type { Crepe } from "@milkdown/crepe";
import type { Root } from "react-dom/client";

import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import { $nodeSchema, $view } from "@milkdown/kit/utils";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  PLUGIN_RENDER_ACTION_STATE_MESSAGE_TYPE,
  PLUGIN_RENDER_REQUEST_ACTION_MESSAGE_TYPE,
  PLUGIN_RENDER_SET_BLOCK_MESSAGE_TYPE,
  PLUGIN_RENDER_UPDATE_PARAMS_MESSAGE_TYPE,
  type PluginRenderActionStateMessage,
  type PluginRenderActionStatePayload,
  type PluginRenderRequestActionMessage,
  type PluginRenderSetBlockMessage,
  type PluginRenderUpdateParamsMessage
} from "../shared/plugins";
import type { ExecuteIntegralActionResult } from "../shared/workspace";

import {
  INTEGRAL_BLOCK_LANGUAGE,
  type IntegralJsonBlock,
  getIntegralBlockDefinition,
  parseIntegralJsonBlock,
  renderIntegralBlockBody
} from "./integralBlockRegistry";
import { loadIntegralPluginRendererDocument } from "./integralPluginRuntime";

type MarkdownCodeNode = {
  lang?: string | null;
  type?: string;
  value?: unknown;
};

type TraceEntry = {
  at: string;
  detail?: Record<string, unknown>;
  event: string;
  seq: number;
  viewId: number;
};

type PanelMessage =
  | {
      kind: "error";
      logLines: string[];
      summary: string;
    }
  | {
      kind: "success";
      logLines: string[];
      summary: string;
    };

type ParsedIntegralDraft =
  | {
      block: IntegralJsonBlock;
      error: null;
    }
  | {
      block: null;
      error: string;
    };

const INTEGRAL_NOTES_NODE_ID = "integral_notes_block";

let nextTraceSeq = 0;
let nextViewId = 0;

const standardCodeBlockSchema = codeBlockSchema.extendSchema((prev) => (ctx) => {
  const schema = prev(ctx);

  return {
    ...schema,
    parseMarkdown: {
      ...schema.parseMarkdown,
      match: (node) =>
        schema.parseMarkdown.match(node) && !isIntegralMarkdownCode(node as MarkdownCodeNode)
    }
  };
});

const integralNotesBlockSchema = $nodeSchema(INTEGRAL_NOTES_NODE_ID, () => ({
  group: "block",
  atom: true,
  isolating: true,
  selectable: true,
  draggable: true,
  priority: 100,
  attrs: {
    value: {
      default: "",
      validate: "string"
    }
  },
  parseDOM: [
    {
      tag: `pre[data-type="${INTEGRAL_NOTES_NODE_ID}"]`,
      preserveWhitespace: "full",
      getAttrs: (dom) => ({
        value: dom.textContent ?? ""
      })
    }
  ],
  toDOM: (node) => [
    "pre",
    {
      "data-type": INTEGRAL_NOTES_NODE_ID,
      "data-language": INTEGRAL_BLOCK_LANGUAGE
    },
    ["code", {}, readIntegralNodeValue(node)]
  ],
  parseMarkdown: {
    match: (node) => isIntegralMarkdownCode(node as MarkdownCodeNode),
    runner: (state, node, type) => {
      state.addNode(type, {
        value: typeof node.value === "string" ? node.value : ""
      });
    }
  },
  toMarkdown: {
    match: (node) => node.type.name === INTEGRAL_NOTES_NODE_ID,
    runner: (state, node) => {
      state.addNode("code", undefined, readIntegralNodeValue(node), {
        lang: INTEGRAL_BLOCK_LANGUAGE
      });
    }
  }
}));

const INTEGRAL_NOTES_VIEW = $view(
  integralNotesBlockSchema.node,
  (): NodeViewConstructor => (node, view, getPos) =>
    new IntegralNotesBlockView(node, view, getPos)
);

export function installIntegralCodeBlockFeature(editor: Crepe): void {
  editor.editor.use(standardCodeBlockSchema);
  editor.editor.use(integralNotesBlockSchema);
  editor.editor.use(INTEGRAL_NOTES_VIEW);

  traceIntegralCodeBlock({
    event: "install-dedicated-node",
    viewId: 0
  });
}

class IntegralNotesBlockView implements NodeView {
  readonly dom: HTMLElement;

  private actionState: PluginRenderActionStatePayload = createIdleActionState();
  private destroyed = false;
  private panelMessage: PanelMessage | null = null;
  private readonly root: Root;
  private selected = false;
  private readonly viewId = ++nextViewId;

  constructor(
    public node: ProseNode,
    public view: EditorView,
    public getPos: () => number | undefined
  ) {
    this.dom = document.createElement("div");
    this.dom.dataset.integralCodeBlock = "true";
    this.root = createRoot(this.dom);
    this.render();

    traceIntegralCodeBlock({
      detail: toTraceDetail(node, getPos),
      event: "create-integral-node-view",
      viewId: this.viewId
    });
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }

    const previousText = readIntegralNodeValue(this.node);
    const nextText = readIntegralNodeValue(node);
    const previousBlockType = parseIntegralJsonBlock(INTEGRAL_BLOCK_LANGUAGE, previousText)?.type ?? null;
    const nextBlockType = parseIntegralJsonBlock(INTEGRAL_BLOCK_LANGUAGE, nextText)?.type ?? null;
    const textChanged = previousText !== nextText;
    this.node = node;

    if (previousBlockType !== nextBlockType) {
      this.actionState = createIdleActionState();
      this.panelMessage = null;
    } else if (textChanged && this.panelMessage?.kind === "error") {
      this.panelMessage = null;
    }

    this.render();

    traceIntegralCodeBlock({
      detail: {
        textChanged
      },
      event: "update-integral-node-view",
      viewId: this.viewId
    });

    return true;
  }

  selectNode(): void {
    this.selected = true;
    this.render();
  }

  deselectNode(): void {
    this.selected = false;
    this.render();
  }

  stopEvent(event: Event): boolean {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return false;
    }

    return Boolean(target.closest("textarea, button, input, select, label, iframe"));
  }

  ignoreMutation(_mutation: ViewMutationRecord): boolean {
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    this.root.unmount();

    traceIntegralCodeBlock({
      detail: toTraceDetail(this.node, this.getPos),
      event: "destroy-integral-node-view",
      viewId: this.viewId
    });
  }

  private render(): void {
    if (this.destroyed) {
      return;
    }

    const rawText = readIntegralNodeValue(this.node);
    const parsed = parseIntegralDraft(rawText);

    this.root.render(
      <IntegralCodeBlockPanel
        actionState={this.actionState}
        onParamsChange={this.handleParamsChange}
        onRequestAction={this.handleActionRequest}
        panelMessage={this.panelMessage}
        parsed={parsed}
        selected={this.selected}
      />
    );
  }

  private handleTextChange = (nextText: string): void => {
    const currentText = readIntegralNodeValue(this.node);

    if (currentText === nextText) {
      return;
    }

    const position = this.getPos();

    if (position === undefined) {
      traceIntegralCodeBlock({
        detail: {
          reason: "missing-position"
        },
        event: "edit-skipped",
        viewId: this.viewId
      });
      return;
    }

    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(position, undefined, {
        ...this.node.attrs,
        value: nextText
      })
    );

    traceIntegralCodeBlock({
      detail: {
        nextLength: nextText.length
      },
      event: "edit-apply",
      viewId: this.viewId
    });
  };

  private handleParamsChange = (nextParams: Record<string, unknown>): void => {
    const rawText = readIntegralNodeValue(this.node);
    const result = applyIntegralBlockParamsUpdate(rawText, nextParams);

    if (result.error) {
      this.panelMessage = {
        kind: "error",
        logLines: [result.error],
        summary: "plugin renderer の変更を JSON に反映できませんでした。"
      };
      this.render();
      return;
    }

    if (!result.changed) {
      return;
    }

    this.panelMessage = null;
    this.handleTextChange(result.nextText);

    traceIntegralCodeBlock({
      detail: {
        blockType: parseIntegralJsonBlock(INTEGRAL_BLOCK_LANGUAGE, result.nextText)?.type ?? null,
        paramKeys: Object.keys(nextParams)
      },
      event: "plugin-params-update",
      viewId: this.viewId
    });
  };

  private handleActionRequest = async (actionId: string): Promise<void> => {
    if (!actionId.trim() || this.actionState.status === "running") {
      return;
    }

    const rawText = readIntegralNodeValue(this.node);
    const parsed = parseIntegralDraft(rawText);

    if (!parsed.block) {
      this.actionState = createActionErrorState(
        actionId,
        "JSON が不正なため実行できません。",
        [parsed.error]
      );
      this.render();
      return;
    }

    const actions = getIntegralBlockDefinition(parsed.block.type)?.actions ?? [];
    const action = actions.find((candidate) => candidate.id === actionId);

    if (!action) {
      this.actionState = createActionErrorState(
        actionId,
        "このブロックには実行アクションがありません。",
        [`未対応の Integral action です: ${parsed.block.type}`]
      );
      this.render();
      return;
    }

    this.actionState = {
      actionId: action.id,
      finishedAt: null,
      logLines: [],
      startedAt: new Date().toISOString(),
      status: "running",
      summary: action.busyLabel
    };
    this.panelMessage = null;
    this.render();

    traceIntegralCodeBlock({
      detail: {
        actionId: action.id,
        blockType: parsed.block.type
      },
      event: "execute-start",
      viewId: this.viewId
    });

    try {
      const result = await window.integralNotes.executeIntegralAction({
        actionId: action.id,
        blockType: parsed.block.type,
        params: parsed.block.params,
        payload: rawText
      });

      if (this.destroyed) {
        return;
      }

      this.actionState = toActionState(result);

      traceIntegralCodeBlock({
        detail: {
          actionId: result.actionId,
          status: result.status
        },
        event: "execute-success",
        viewId: this.viewId
      });
    } catch (error) {
      if (this.destroyed) {
        return;
      }

      this.actionState = createActionErrorState(action.id, "Integral action の実行に失敗しました。", [
        formatErrorMessage(error)
      ]);

      traceIntegralCodeBlock({
        detail: {
          error: formatErrorMessage(error)
        },
        event: "execute-error",
        viewId: this.viewId
      });
    }

    if (!this.destroyed) {
      this.render();
    }
  };
}

function IntegralCodeBlockPanel({
  actionState,
  onParamsChange,
  onRequestAction,
  panelMessage,
  parsed,
  selected
}: {
  actionState: PluginRenderActionStatePayload;
  onParamsChange: (nextParams: Record<string, unknown>) => void;
  onRequestAction: (actionId: string) => void;
  panelMessage: PanelMessage | null;
  parsed: ParsedIntegralDraft;
  selected: boolean;
}): JSX.Element {
  const blockDefinition = parsed.block ? getIntegralBlockDefinition(parsed.block.type) : null;

  return (
    <div className={`integral-code-block${selected ? " integral-code-block--selected" : ""}`}>
      {parsed.block ? (
        blockDefinition?.hasRenderer ? (
          <>
            <PluginRendererPanel
              actionState={actionState}
              block={parsed.block}
              blockDefinition={blockDefinition}
              onParamsChange={onParamsChange}
              onRequestAction={onRequestAction}
            />
            {panelMessage ? <PanelMessageView message={panelMessage} /> : null}
          </>
        ) : (
          <IntegralBlockFallbackPanel
            actionState={actionState}
            block={parsed.block}
            blockDefinition={blockDefinition}
            onRequestAction={onRequestAction}
            panelMessage={panelMessage}
          />
        )
      ) : (
        <div className="integral-code-block__result integral-code-block__result--error">
          <strong>Invalid Integral block</strong>
          <span>{parsed.error}</span>
        </div>
      )}
    </div>
  );
}

function PluginRendererPanel({
  actionState,
  block,
  blockDefinition,
  onParamsChange,
  onRequestAction
}: {
  actionState: PluginRenderActionStatePayload;
  block: IntegralJsonBlock;
  blockDefinition: NonNullable<ReturnType<typeof getIntegralBlockDefinition>>;
  onParamsChange: (nextParams: Record<string, unknown>) => void;
  onRequestAction: (actionId: string) => void;
}): JSX.Element {
  const [rendererDocument, setRendererDocument] = useState<string | null>(null);
  const [rendererError, setRendererError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const postRenderModel = (): void => {
    const frameWindow = iframeRef.current?.contentWindow;

    if (!frameWindow) {
      return;
    }

    const message: PluginRenderSetBlockMessage = {
      payload: {
        block,
        blockDefinition: {
          actions: blockDefinition.actions,
          description: blockDefinition.description,
          title: blockDefinition.title,
          type: blockDefinition.type
        },
        plugin: {
          description: blockDefinition.pluginDescription,
          displayName: blockDefinition.pluginDisplayName,
          id: blockDefinition.pluginId,
          namespace: blockDefinition.pluginNamespace,
          origin: blockDefinition.pluginOrigin,
          version: blockDefinition.pluginVersion
        }
      },
      type: PLUGIN_RENDER_SET_BLOCK_MESSAGE_TYPE
    };

    frameWindow.postMessage(message, "*");
  };

  const postActionState = (): void => {
    const frameWindow = iframeRef.current?.contentWindow;

    if (!frameWindow) {
      return;
    }

    const message: PluginRenderActionStateMessage = {
      payload: actionState,
      type: PLUGIN_RENDER_ACTION_STATE_MESSAGE_TYPE
    };

    frameWindow.postMessage(message, "*");
  };

  useEffect(() => {
    let cancelled = false;

    setRendererDocument(null);
    setRendererError(null);

    void loadIntegralPluginRendererDocument(blockDefinition.pluginId)
      .then((document) => {
        if (cancelled) {
          return;
        }

        if (document === null) {
          setRendererError("plugin renderer が未登録です。");
          return;
        }

        setRendererDocument(document);
      })
      .catch((error) => {
        if (!cancelled) {
          setRendererError(formatErrorMessage(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [blockDefinition.pluginId]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent): void => {
      const frameWindow = iframeRef.current?.contentWindow;

      if (!frameWindow || event.source !== frameWindow) {
        return;
      }

      if (isPluginRenderUpdateParamsMessage(event.data)) {
        onParamsChange(event.data.payload.params);
        return;
      }

      if (isPluginRenderRequestActionMessage(event.data)) {
        onRequestAction(event.data.payload.actionId);
      }
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [onParamsChange, onRequestAction]);

  useEffect(() => {
    if (!rendererDocument) {
      return;
    }

    postRenderModel();
  }, [block, blockDefinition, rendererDocument]);

  useEffect(() => {
    if (!rendererDocument) {
      return;
    }

    postActionState();
  }, [actionState, rendererDocument]);

  if (rendererError) {
    return (
      <IntegralBlockFallbackPanel
        actionState={actionState}
        block={block}
        blockDefinition={blockDefinition}
        onRequestAction={onRequestAction}
        panelMessage={{
          kind: "error",
          logLines: [rendererError],
          summary: "Plugin renderer の読込に失敗しました。"
        }}
      />
    );
  }

  if (!rendererDocument) {
    return (
      <div className="integral-plugin-frame-shell integral-plugin-frame-shell--loading">
        <span>Plugin renderer を読み込み中...</span>
      </div>
    );
  }

  return (
    <div className="integral-plugin-frame-shell">
      <iframe
        className="integral-plugin-frame"
        onLoad={() => {
          postRenderModel();
          postActionState();
        }}
        ref={iframeRef}
        sandbox="allow-scripts"
        srcDoc={rendererDocument}
        title={`${blockDefinition.title} plugin renderer`}
      />
    </div>
  );
}

function IntegralBlockFallbackPanel({
  actionState,
  block,
  blockDefinition,
  onRequestAction,
  panelMessage
}: {
  actionState: PluginRenderActionStatePayload;
  block: IntegralJsonBlock;
  blockDefinition: ReturnType<typeof getIntegralBlockDefinition>;
  onRequestAction: (actionId: string) => void;
  panelMessage: PanelMessage | null;
}): JSX.Element {
  const actionDefinitions = blockDefinition?.actions ?? [];

  return (
    <>
      <div className="integral-json-preview">
        <div className="integral-json-preview__header">
          <div>
            <p className="integral-json-preview__eyebrow">Integral Block</p>
            <h3 className="integral-json-preview__title">
              {blockDefinition?.title ?? block.type}
            </h3>
          </div>
          <code className="integral-json-preview__type">{block.type}</code>
        </div>

        <p className="integral-json-preview__description">
          {blockDefinition?.description ??
            "専用 renderer 未登録のため、汎用 Integral preview を表示しています。"}
        </p>

        {renderIntegralBlockBody(block)}

        {actionDefinitions.length > 0 ? (
          <div className="integral-code-block__runbar">
            <div className="integral-code-block__actions">
              {actionDefinitions.map((actionDefinition) => (
                <button
                  className="integral-code-block__button integral-code-block__button--primary"
                  disabled={actionState.status === "running"}
                  key={actionDefinition.id}
                  onClick={() => onRequestAction(actionDefinition.id)}
                  type="button"
                >
                  {actionState.status === "running" && actionState.actionId === actionDefinition.id
                    ? actionDefinition.busyLabel
                    : actionDefinition.label}
                </button>
              ))}
            </div>
            <p className="integral-code-block__runhint">
              実行ボタンは plugin host module 経由で main process に処理を渡します。
            </p>
          </div>
        ) : null}
      </div>

      {panelMessage ? <PanelMessageView message={panelMessage} /> : null}
      {actionState.status !== "idle" ? <ActionStateView actionState={actionState} /> : null}
    </>
  );
}

function PanelMessageView({ message }: { message: PanelMessage }): JSX.Element {
  return (
    <div className={`integral-code-block__result integral-code-block__result--${message.kind}`}>
      <strong>{message.summary}</strong>

      {message.logLines.length > 0 ? (
        <ul className="integral-code-block__log">
          {message.logLines.map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ActionStateView({
  actionState
}: {
  actionState: PluginRenderActionStatePayload;
}): JSX.Element {
  const kind =
    actionState.status === "success"
      ? "success"
      : actionState.status === "running"
        ? "success"
        : "error";

  return (
    <div className={`integral-code-block__result integral-code-block__result--${kind}`}>
      <strong>{actionState.summary ?? "Integral action を実行しました。"}</strong>

      {actionState.logLines.length > 0 ? (
        <ul className="integral-code-block__log">
          {actionState.logLines.map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function isIntegralMarkdownCode(node: MarkdownCodeNode): boolean {
  return node.type === "code" && `${node.lang ?? ""}`.trim().toLowerCase() === INTEGRAL_BLOCK_LANGUAGE;
}

function readIntegralNodeValue(node: ProseNode): string {
  return `${node.attrs.value ?? ""}`;
}

function parseIntegralDraft(content: string): ParsedIntegralDraft {
  const parsedRecord = parseIntegralRecord(content);

  if (!parsedRecord.record) {
    return {
      block: null,
      error: parsedRecord.error ?? "Unknown error"
    };
  }

  const block = parseIntegralJsonBlock(INTEGRAL_BLOCK_LANGUAGE, content);

  if (!block) {
    return {
      block: null,
      error: `\`${INTEGRAL_BLOCK_LANGUAGE}\` block として解釈できません。`
    };
  }

  return {
    block,
    error: null
  };
}

function applyIntegralBlockParamsUpdate(
  content: string,
  nextParams: Record<string, unknown>
): {
  changed: boolean;
  error: string | null;
  nextText: string;
} {
  const parsedRecord = parseIntegralRecord(content);

  if (!parsedRecord.record) {
    return {
      changed: false,
      error: parsedRecord.error ?? "Unknown error",
      nextText: content
    };
  }

  const currentParams = isJsonRecord(parsedRecord.record.params) ? parsedRecord.record.params : {};
  const normalizedParams = { ...nextParams };

  if (JSON.stringify(currentParams) === JSON.stringify(normalizedParams)) {
    return {
      changed: false,
      error: null,
      nextText: content
    };
  }

  return {
    changed: true,
    error: null,
    nextText: formatIntegralJson({
      ...parsedRecord.record,
      params: normalizedParams
    })
  };
}

function parseIntegralRecord(content: string): {
  error: string | null;
  record: Record<string, unknown> | null;
} {
  try {
    const parsed = JSON.parse(content);

    if (!isJsonRecord(parsed)) {
      return {
        error: "トップレベルは JSON object である必要があります。",
        record: null
      };
    }

    if (typeof parsed.type !== "string" || parsed.type.trim().length === 0) {
      return {
        error: "`type` を持つ Integral block JSON が必要です。",
        record: null
      };
    }

    return {
      error: null,
      record: parsed
    };
  } catch (error) {
    return {
      error: formatErrorMessage(error),
      record: null
    };
  }
}

function isPluginRenderUpdateParamsMessage(
  value: unknown
): value is PluginRenderUpdateParamsMessage {
  return (
    isJsonRecord(value) &&
    value.type === PLUGIN_RENDER_UPDATE_PARAMS_MESSAGE_TYPE &&
    isJsonRecord(value.payload) &&
    isJsonRecord(value.payload.params)
  );
}

function isPluginRenderRequestActionMessage(
  value: unknown
): value is PluginRenderRequestActionMessage {
  return (
    isJsonRecord(value) &&
    value.type === PLUGIN_RENDER_REQUEST_ACTION_MESSAGE_TYPE &&
    isJsonRecord(value.payload) &&
    typeof value.payload.actionId === "string" &&
    value.payload.actionId.trim().length > 0
  );
}

function formatIntegralJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function toActionState(result: ExecuteIntegralActionResult): PluginRenderActionStatePayload {
  return {
    actionId: result.actionId,
    finishedAt: result.finishedAt,
    logLines: result.logLines,
    startedAt: result.startedAt,
    status: "success",
    summary: result.summary
  };
}

function createActionErrorState(
  actionId: string | null,
  summary: string,
  logLines: string[]
): PluginRenderActionStatePayload {
  return {
    actionId,
    finishedAt: new Date().toISOString(),
    logLines,
    startedAt: null,
    status: "error",
    summary
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

function toTraceDetail(
  node: ProseNode,
  getPos: () => number | undefined
): Record<string, unknown> {
  const value = readIntegralNodeValue(node);

  return {
    blockType: parseIntegralJsonBlock(INTEGRAL_BLOCK_LANGUAGE, value)?.type ?? null,
    pos: getPos(),
    textLength: value.length
  };
}

function traceIntegralCodeBlock({
  detail,
  event,
  viewId
}: Omit<TraceEntry, "at" | "seq">): void {
  if (!import.meta.env.DEV) {
    return;
  }

  const entry: TraceEntry = {
    at: new Date().toISOString(),
    detail,
    event,
    seq: ++nextTraceSeq,
    viewId
  };

  const traceWindow = window as Window & {
    __integralMilkdownTrace__?: TraceEntry[];
  };

  traceWindow.__integralMilkdownTrace__ ??= [];
  traceWindow.__integralMilkdownTrace__.push(entry);

  if (traceWindow.__integralMilkdownTrace__.length > 200) {
    traceWindow.__integralMilkdownTrace__.shift();
  }

  console.debug("[IntegralMilkdownTrace]", entry);
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return typeof error === "string" ? error : "Unknown error";
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
