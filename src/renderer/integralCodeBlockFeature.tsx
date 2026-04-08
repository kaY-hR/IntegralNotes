import type { Editor } from "@milkdown/kit/core";
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView, NodeView, NodeViewConstructor } from "@milkdown/kit/prose/view";
import { $view } from "@milkdown/kit/utils";
import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import type {
  ExecuteIntegralActionRequest,
  ExecuteIntegralActionResult
} from "../shared/workspace";
import {
  getIntegralBlockDefinition,
  parseIntegralJsonBlock,
  renderIntegralBlockBody
} from "./integralBlockRegistry";

interface IntegralCodeBlockProps {
  editable: boolean;
  language: string;
  onChangeText: (nextText: string) => void;
  onExecuteAction: (request: ExecuteIntegralActionRequest) => Promise<ExecuteIntegralActionResult>;
  selected: boolean;
  text: string;
}

type ExecutionState =
  | {
      result?: undefined;
      status: "idle";
    }
  | {
      message?: undefined;
      result?: undefined;
      status: "pending";
    }
  | {
      message: string;
      result?: undefined;
      status: "error";
    }
  | {
      message?: undefined;
      result: ExecuteIntegralActionResult;
      status: "success";
    };

const integralCodeBlockView = $view(codeBlockSchema.node, () => {
  const constructor: NodeViewConstructor = (node, view, getPos) =>
    new IntegralCodeBlockNodeView(node, view, getPos as () => number);

  return constructor;
});

export function installIntegralCodeBlockFeature(editor: Editor): void {
  editor.use(integralCodeBlockView);
}

class IntegralCodeBlockNodeView implements NodeView {
  dom: HTMLElement;

  private readonly getPos: () => number;
  private node: ProseNode;
  private readonly root: Root;
  private selected = false;
  private readonly view: EditorView;

  constructor(node: ProseNode, view: EditorView, getPos: () => number) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.dom = document.createElement("div");
    this.dom.className = "integral-code-block-host";
    this.root = createRoot(this.dom);
    this.render();
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }

    this.node = node;
    this.render();
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

  stopEvent(): boolean {
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.root.unmount();
  }

  private render(): void {
    const language = String(this.node.attrs.language ?? "");

    this.root.render(
      <IntegralCodeBlock
        editable={this.view.editable}
        language={language}
        onChangeText={this.handleChangeText}
        onExecuteAction={this.handleExecuteAction}
        selected={this.selected}
        text={this.node.textContent}
      />
    );
  }

  private readonly handleChangeText = (nextText: string): void => {
    if (!this.view.editable) {
      return;
    }

    const pos = this.getPos();
    const from = pos + 1;
    const to = pos + this.node.nodeSize - 1;
    const content = nextText.length > 0 ? this.view.state.schema.text(nextText) : [];
    const transaction = this.view.state.tr.replaceWith(from, to, content);

    this.view.dispatch(transaction);
  };

  private readonly handleExecuteAction = (request: ExecuteIntegralActionRequest) =>
    window.integralNotes.executeIntegralAction(request);
}

function IntegralCodeBlock({
  editable,
  language,
  onChangeText,
  onExecuteAction,
  selected,
  text
}: IntegralCodeBlockProps): JSX.Element {
  const parsedBlock = parseIntegralJsonBlock(language, text);
  const blockDefinition = parsedBlock ? getIntegralBlockDefinition(parsedBlock.type) : null;
  const [displayMode, setDisplayMode] = useState<"json" | "ui">(parsedBlock ? "ui" : "json");
  const [executionState, setExecutionState] = useState<ExecutionState>({
    status: "idle"
  });

  useEffect(() => {
    if (!parsedBlock) {
      setDisplayMode("json");
    }
  }, [parsedBlock]);

  useEffect(() => {
    setExecutionState({
      status: "idle"
    });
  }, [text]);

  const showInteractiveView = parsedBlock !== null && displayMode === "ui";
  const helperText = getHelperText(language, parsedBlock);

  const runPrimaryAction = async (): Promise<void> => {
    if (!parsedBlock || !blockDefinition?.action) {
      return;
    }

    setExecutionState({
      status: "pending"
    });

    try {
      const result = await onExecuteAction({
        actionId: blockDefinition.action.id,
        blockType: parsedBlock.type,
        payload: text,
        params: parsedBlock.params
      });

      setExecutionState({
        result,
        status: "success"
      });
    } catch (error) {
      setExecutionState({
        message: toErrorMessage(error),
        status: "error"
      });
    }
  };

  return (
    <section className={`integral-code-block ${selected ? "integral-code-block--selected" : ""}`}>
      <div className="integral-code-block__toolbar">
        <div className="integral-code-block__meta">
          <span className="integral-code-block__badge">{language || "plain text"}</span>
          {parsedBlock ? (
            <span className="integral-code-block__badge integral-code-block__badge--accent">
              Integral Block
            </span>
          ) : null}
        </div>

        <div className="integral-code-block__actions">
          {parsedBlock && editable ? (
            <button
              className="integral-code-block__button integral-code-block__button--ghost"
              onClick={() => {
                setDisplayMode((currentMode) => (currentMode === "ui" ? "json" : "ui"));
              }}
              type="button"
            >
              {showInteractiveView ? "JSON編集" : "UI表示"}
            </button>
          ) : null}
        </div>
      </div>

      {showInteractiveView && parsedBlock ? (
        <InteractiveBlockCard
          block={parsedBlock}
          executionState={executionState}
          onRunPrimaryAction={runPrimaryAction}
          primaryAction={blockDefinition?.action}
        />
      ) : (
        <div className="integral-code-block__editor-shell">
          <textarea
            className="integral-code-block__editor"
            onChange={(event) => {
              onChangeText(event.target.value);
            }}
            readOnly={!editable}
            spellCheck={false}
            value={text}
          />
          <p className="integral-code-block__helper">{helperText}</p>
        </div>
      )}
    </section>
  );
}

function InteractiveBlockCard({
  block,
  executionState,
  onRunPrimaryAction,
  primaryAction
}: {
  block: NonNullable<ReturnType<typeof parseIntegralJsonBlock>>;
  executionState: ExecutionState;
  onRunPrimaryAction: () => Promise<void>;
  primaryAction: ReturnType<typeof getIntegralBlockDefinition>["action"];
}): JSX.Element {
  const blockDefinition = getIntegralBlockDefinition(block.type);

  return (
    <div className="integral-json-preview">
      <div className="integral-json-preview__header">
        <div>
          <p className="integral-json-preview__eyebrow">Interactive Integral Block</p>
          <h3 className="integral-json-preview__title">
            {blockDefinition?.title ?? block.type}
          </h3>
        </div>
        <code className="integral-json-preview__type">{block.type}</code>
      </div>

      <p className="integral-json-preview__description">
        {blockDefinition?.description ??
          "専用 action は未登録ですが、JSON は interactive block として認識されています。"}
      </p>

      {renderIntegralBlockBody(block)}

      {primaryAction ? (
        <div className="integral-code-block__runbar">
          <button
            className="integral-code-block__button integral-code-block__button--primary"
            disabled={executionState.status === "pending"}
            onClick={() => {
              void onRunPrimaryAction();
            }}
            type="button"
          >
            {executionState.status === "pending" ? primaryAction.busyLabel : primaryAction.label}
          </button>
          <span className="integral-code-block__runhint">
            実行要求は preload 経由で main process に渡します。
          </span>
        </div>
      ) : null}

      {executionState.status === "success" ? (
        <div className="integral-code-block__result integral-code-block__result--success">
          <strong>{executionState.result.summary}</strong>
          <span>
            {executionState.result.startedAt} -&gt; {executionState.result.finishedAt}
          </span>
          <ul className="integral-code-block__log">
            {executionState.result.logLines.map((logLine) => (
              <li key={logLine}>{logLine}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {executionState.status === "error" ? (
        <div className="integral-code-block__result integral-code-block__result--error">
          <strong>実行に失敗しました</strong>
          <span>{executionState.message}</span>
        </div>
      ) : null}
    </div>
  );
}

function getHelperText(
  language: string,
  parsedBlock: ReturnType<typeof parseIntegralJsonBlock>
): string {
  if (parsedBlock) {
    return "type を持つ JSON として認識されています。UI表示に戻せます。";
  }

  if (language.trim().toLowerCase() === "json") {
    return 'Interactive UI に変換するには、`type` を持つ JSON を入力してください。';
  }

  return "Integral UI の対象外です。通常のコードブロックとして編集できます。";
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "不明なエラーが発生しました。";
}
