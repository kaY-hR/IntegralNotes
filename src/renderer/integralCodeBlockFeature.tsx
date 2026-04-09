import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView, NodeView, NodeViewConstructor, ViewMutationRecord } from "@milkdown/kit/prose/view";
import type { Crepe } from "@milkdown/crepe";
import type { Root } from "react-dom/client";

import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import { $nodeSchema, $view } from "@milkdown/kit/utils";
import { createRoot } from "react-dom/client";

import type { ExecuteIntegralActionResult } from "../shared/workspace";

import {
  INTEGRAL_BLOCK_LANGUAGE,
  type IntegralJsonBlock,
  getIntegralBlockDefinition,
  parseIntegralJsonBlock,
  renderIntegralBlockBody
} from "./integralBlockRegistry";

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

type ExecutionState =
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

  private destroyed = false;
  private executionState: ExecutionState | null = null;
  private isBusy = false;
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
    const textChanged = previousText !== nextText;
    this.node = node;

    if (textChanged && this.executionState?.kind === "error") {
      this.executionState = null;
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

    return Boolean(target.closest("textarea, button, input, select, label"));
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
        executionState={this.executionState}
        isBusy={this.isBusy}
        onChangeText={this.handleTextChange}
        onExecute={this.handleExecute}
        onFormat={this.handleFormat}
        parsed={parsed}
        rawText={rawText}
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

  private handleFormat = (): void => {
    try {
      const formatted = JSON.stringify(JSON.parse(readIntegralNodeValue(this.node)), null, 2);
      this.executionState = null;
      this.handleTextChange(formatted);
    } catch (error) {
      this.executionState = {
        kind: "error",
        logLines: [formatErrorMessage(error)],
        summary: "JSON の整形に失敗しました。"
      };
      this.render();
    }
  };

  private handleExecute = async (): Promise<void> => {
    const rawText = readIntegralNodeValue(this.node);
    const parsed = parseIntegralDraft(rawText);

    if (!parsed.block) {
      this.executionState = {
        kind: "error",
        logLines: [parsed.error],
        summary: "JSON が不正なため実行できません。"
      };
      this.render();
      return;
    }

    const action = getIntegralBlockDefinition(parsed.block.type)?.action;

    if (!action) {
      this.executionState = {
        kind: "error",
        logLines: [`未対応の Integral action です: ${parsed.block.type}`],
        summary: "このブロックには実行アクションがありません。"
      };
      this.render();
      return;
    }

    this.isBusy = true;
    this.executionState = null;
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

      this.executionState = toExecutionState(result);

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

      this.executionState = {
        kind: "error",
        logLines: [formatErrorMessage(error)],
        summary: "Integral action の実行に失敗しました。"
      };

      traceIntegralCodeBlock({
        detail: {
          error: formatErrorMessage(error)
        },
        event: "execute-error",
        viewId: this.viewId
      });
    } finally {
      if (!this.destroyed) {
        this.isBusy = false;
        this.render();
      }
    }
  };
}

function IntegralCodeBlockPanel({
  executionState,
  isBusy,
  onChangeText,
  onExecute,
  onFormat,
  parsed,
  rawText,
  selected
}: {
  executionState: ExecutionState | null;
  isBusy: boolean;
  onChangeText: (nextText: string) => void;
  onExecute: () => void;
  onFormat: () => void;
  parsed: ParsedIntegralDraft;
  rawText: string;
  selected: boolean;
}): JSX.Element {
  const blockDefinition = parsed.block ? getIntegralBlockDefinition(parsed.block.type) : null;
  const actionDefinition = blockDefinition?.action;

  return (
    <div className={`integral-code-block${selected ? " integral-code-block--selected" : ""}`}>
      <div className="integral-code-block__toolbar">
        <div className="integral-code-block__meta">
          <span className="integral-code-block__badge integral-code-block__badge--accent">Integral</span>
          <span className="integral-code-block__badge">itg-notes</span>
          <span className="integral-code-block__badge">{parsed.block?.type ?? "invalid"}</span>
        </div>

        <div className="integral-code-block__actions">
          <button
            className="integral-code-block__button integral-code-block__button--ghost"
            onClick={onFormat}
            type="button"
          >
            整形
          </button>

          {actionDefinition ? (
            <button
              className="integral-code-block__button integral-code-block__button--primary"
              disabled={isBusy}
              onClick={onExecute}
              type="button"
            >
              {isBusy ? actionDefinition.busyLabel : actionDefinition.label}
            </button>
          ) : null}
        </div>
      </div>

      {parsed.block ? (
        <div className="integral-json-preview">
          <div className="integral-json-preview__header">
            <div>
              <p className="integral-json-preview__eyebrow">Integral Block</p>
              <h3 className="integral-json-preview__title">
                {blockDefinition?.title ?? parsed.block.type}
              </h3>
            </div>
            <code className="integral-json-preview__type">{parsed.block.type}</code>
          </div>

          <p className="integral-json-preview__description">
            {blockDefinition?.description ??
              "専用 renderer 未登録のため、汎用 Integral preview を表示しています。"}
          </p>

          {renderIntegralBlockBody(parsed.block)}
        </div>
      ) : (
        <div className="integral-code-block__result integral-code-block__result--error">
          <strong>Invalid Integral block</strong>
          <span>{parsed.error}</span>
        </div>
      )}

      <div className="integral-code-block__editor-shell">
        <textarea
          className="integral-code-block__editor"
          onChange={(event) => onChangeText(event.target.value)}
          spellCheck={false}
          value={rawText}
        />
        <p className="integral-code-block__helper">
          `itg-notes` は Integral 専用 node として扱われ、Markdown では ` ```itg-notes` で保存されます。
        </p>
      </div>

      {actionDefinition ? (
        <div className="integral-code-block__runbar">
          <p className="integral-code-block__runhint">
            実行ボタンは mock runner 経由で main process に処理を渡します。
          </p>
        </div>
      ) : null}

      {executionState ? (
        <div
          className={`integral-code-block__result integral-code-block__result--${executionState.kind}`}
        >
          <strong>{executionState.summary}</strong>

          {executionState.logLines.length > 0 ? (
            <ul className="integral-code-block__log">
              {executionState.logLines.map((line, index) => (
                <li key={`${index}-${line}`}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
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
  try {
    const parsed = JSON.parse(content);

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {
        block: null,
        error: "トップレベルは JSON object である必要があります。"
      };
    }

    if (typeof parsed.type !== "string" || parsed.type.trim().length === 0) {
      return {
        block: null,
        error: "`type` を持つ Integral block JSON が必要です。"
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
  } catch (error) {
    return {
      block: null,
      error: formatErrorMessage(error)
    };
  }
}

function toExecutionState(result: ExecuteIntegralActionResult): ExecutionState {
  return {
    kind: "success",
    logLines: result.logLines,
    summary: result.summary
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
