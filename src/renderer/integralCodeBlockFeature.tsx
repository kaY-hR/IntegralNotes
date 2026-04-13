import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type {
  EditorView,
  NodeView,
  NodeViewConstructor,
  ViewMutationRecord
} from "@milkdown/kit/prose/view";
import type { Crepe } from "@milkdown/crepe";
import type { Root } from "react-dom/client";

import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import { $nodeSchema, $view } from "@milkdown/kit/utils";
import { useState } from "react";
import { createRoot } from "react-dom/client";

import type { ExecuteIntegralBlockResult, IntegralBlockDocument } from "../shared/integral";

import {
  ChunkPickerDialog,
  BlobPickerDialog,
  ChunkRenderableView
} from "./IntegralAssetDialogs";
import {
  INTEGRAL_BLOCK_LANGUAGE,
  getIntegralBlockDefinition,
  parseIntegralJsonBlock,
  renderIntegralBlockBody,
  type IntegralJsonBlock
} from "./integralBlockRegistry";

type MarkdownCodeNode = {
  lang?: string | null;
  type?: string;
  value?: unknown;
};

type RunState = {
  finishedAt: string | null;
  logLines: string[];
  startedAt: string | null;
  status: "error" | "idle" | "running" | "success";
  summary: string | null;
};

type SlotDialogState =
  | {
      kind: "blobs";
      slotName: string;
    }
  | {
      kind: "chunk";
      slotName: string;
    }
  | null;

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
}

class IntegralNotesBlockView implements NodeView {
  readonly dom: HTMLElement;

  private destroyed = false;
  private readonly root: Root;
  private runState: RunState = createIdleRunState();
  private selected = false;

  constructor(
    public node: ProseNode,
    public view: EditorView,
    public getPos: () => number | undefined
  ) {
    this.dom = document.createElement("div");
    this.dom.dataset.integralCodeBlock = "true";
    this.root = createRoot(this.dom);
    this.render();
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }

    const previousText = readIntegralNodeValue(this.node);
    const nextText = readIntegralNodeValue(node);
    const previousBlock = parseIntegralJsonBlock(INTEGRAL_BLOCK_LANGUAGE, previousText);
    const nextBlock = parseIntegralJsonBlock(INTEGRAL_BLOCK_LANGUAGE, nextText);
    this.node = node;

    if (
      previousBlock?.plugin !== nextBlock?.plugin ||
      previousBlock?.["block-type"] !== nextBlock?.["block-type"]
    ) {
      this.runState = createIdleRunState();
    }

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
  }

  private render(): void {
    if (this.destroyed) {
      return;
    }

    const rawText = readIntegralNodeValue(this.node);
    const parsed = parseIntegralDraft(rawText);

    this.root.render(
      <IntegralBlockPanel
        onAssignChunk={(slotName, chunkId) => {
          const result = applyIntegralBlockMutation(rawText, (currentBlock) => ({
            ...currentBlock,
            inputs: {
              ...currentBlock.inputs,
              [slotName]: chunkId
            }
          }));

          if (result.error) {
            this.runState = createErrorRunState(result.error);
            this.render();
            return;
          }

          this.applyTextChange(result.nextText);
        }}
        onRun={() => {
          void this.handleRun();
        }}
        parsed={parsed}
        runState={this.runState}
        selected={this.selected}
      />
    );
  }

  private applyTextChange(nextText: string): void {
    const currentText = readIntegralNodeValue(this.node);

    if (currentText === nextText) {
      return;
    }

    const position = this.getPos();

    if (position === undefined) {
      return;
    }

    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(position, undefined, {
        ...this.node.attrs,
        value: nextText
      })
    );
  }

  private async handleRun(): Promise<void> {
    if (this.runState.status === "running") {
      return;
    }

    const rawText = readIntegralNodeValue(this.node);
    const parsed = parseIntegralDraft(rawText);

    if (!parsed.block) {
      this.runState = createErrorRunState(parsed.error);
      this.render();
      return;
    }

    const blockDefinition = getIntegralBlockDefinition(
      parsed.block.plugin,
      parsed.block["block-type"]
    );

    if (!blockDefinition) {
      this.runState = createErrorRunState("block 定義が見つかりません。");
      this.render();
      return;
    }

    if (blockDefinition.executionMode !== "manual") {
      this.runState = {
        finishedAt: new Date().toISOString(),
        logLines: [],
        startedAt: new Date().toISOString(),
        status: "success",
        summary: "表示 block は実行不要です。"
      };
      this.render();
      return;
    }

    this.runState = {
      finishedAt: null,
      logLines: [],
      startedAt: new Date().toISOString(),
      status: "running",
      summary: "実行中..."
    };
    this.render();

    try {
      const result = await window.integralNotes.executeIntegralBlock({
        block: parsed.block
      });

      if (this.destroyed) {
        return;
      }

      this.runState = toRunState(result);
      this.applyTextChange(JSON.stringify(result.block, null, 2));
    } catch (error) {
      if (this.destroyed) {
        return;
      }

      this.runState = createErrorRunState(formatErrorMessage(error));
    }

    if (!this.destroyed) {
      this.render();
    }
  }
}

function IntegralBlockPanel({
  onAssignChunk,
  onRun,
  parsed,
  runState,
  selected
}: {
  onAssignChunk: (slotName: string, chunkId: string) => void;
  onRun: () => void;
  parsed: ParsedIntegralDraft;
  runState: RunState;
  selected: boolean;
}): JSX.Element {
  const [slotDialogState, setSlotDialogState] = useState<SlotDialogState>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);

  if (!parsed.block) {
    return (
      <div className={`integral-code-block${selected ? " integral-code-block--selected" : ""}`}>
        <div className="integral-code-block__result integral-code-block__result--error">
          <strong>Invalid Integral block</strong>
          <span>{parsed.error}</span>
        </div>
      </div>
    );
  }

  const blockDefinition = getIntegralBlockDefinition(parsed.block.plugin, parsed.block["block-type"]);
  const isDisplayBlock =
    blockDefinition?.pluginId === "core-display" &&
    blockDefinition.blockType === "chunk-view";

  if (!blockDefinition) {
    return (
      <div className={`integral-code-block${selected ? " integral-code-block--selected" : ""}`}>
        <div className="integral-json-preview">
          <div className="integral-json-preview__header">
            <div>
              <p className="integral-json-preview__eyebrow">Integral Block</p>
              <h3 className="integral-json-preview__title">Unknown Block</h3>
            </div>
            <code className="integral-json-preview__type">
              {parsed.block.plugin}/{parsed.block["block-type"]}
            </code>
          </div>
          {renderIntegralBlockBody(parsed.block)}
        </div>
      </div>
    );
  }

  if (isDisplayBlock) {
    return (
      <div className={`integral-code-block integral-code-block--display${selected ? " integral-code-block--selected" : ""}`}>
        <div className="integral-display-block">
          <button
            className="integral-code-block__button integral-code-block__button--ghost integral-display-block__picker"
            onClick={() => {
              setInlineError(null);
              setSlotDialogState({ kind: "chunk", slotName: "source" });
            }}
            type="button"
          >
            {parsed.block.inputs.source ?? "chunk を選択"}
          </button>

          <ChunkRenderableView chunkId={parsed.block.inputs.source ?? null} />
        </div>

        {inlineError ? (
          <div className="integral-code-block__result integral-code-block__result--error">
            <strong>{inlineError}</strong>
          </div>
        ) : null}

        {slotDialogState?.kind === "chunk" ? (
          <ChunkPickerDialog
            acceptedKinds={blockDefinition.inputSlots.find((slot) => slot.name === slotDialogState.slotName)?.acceptedKinds}
            onClose={() => {
              setSlotDialogState(null);
            }}
            onError={setInlineError}
            onSelect={(chunkId) => {
              onAssignChunk(slotDialogState.slotName, chunkId);
              setSlotDialogState(null);
            }}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className={`integral-code-block${selected ? " integral-code-block--selected" : ""}`}>
      <div className="integral-json-preview">
        <div className="integral-json-preview__header">
          <div>
            <p className="integral-json-preview__eyebrow">{blockDefinition.pluginDisplayName}</p>
            <h3 className="integral-json-preview__title">{blockDefinition.title}</h3>
          </div>
          <code className="integral-json-preview__type">
            {parsed.block.plugin}/{parsed.block["block-type"]}
          </code>
        </div>

        <p className="integral-json-preview__description">{blockDefinition.description}</p>

        {renderIntegralBlockBody(parsed.block)}

        <section className="integral-json-preview__section">
          <div className="integral-json-preview__section-header">
            <span>Slot Assignments</span>
            <span>{blockDefinition.executionMode === "manual" ? "editable" : "display"}</span>
          </div>

          <div className="integral-slot-list">
            {blockDefinition.inputSlots.map((slot) => (
              <div className="integral-slot-row" key={slot.name}>
                <div className="integral-slot-row__meta">
                  <strong>{slot.name}</strong>
                  <span>{parsed.block.inputs[slot.name] ?? "未設定"}</span>
                </div>
                <div className="integral-slot-row__actions">
                  <button className="integral-code-block__button integral-code-block__button--ghost" onClick={() => {
                    setInlineError(null);
                    setSlotDialogState({ kind: "chunk", slotName: slot.name });
                  }} type="button">
                    Chunk
                  </button>
                  <button className="integral-code-block__button integral-code-block__button--ghost" onClick={() => {
                    setInlineError(null);
                    setSlotDialogState({ kind: "blobs", slotName: slot.name });
                  }} type="button">
                    Blob
                  </button>
                </div>
              </div>
            ))}

            {blockDefinition.outputSlots.map((slot) => (
              <div className="integral-slot-row integral-slot-row--output" key={slot.name}>
                <div className="integral-slot-row__meta">
                  <strong>{slot.name}</strong>
                  <span>{parsed.block.outputs[slot.name] ?? "null"}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {blockDefinition.executionMode === "manual" ? (
          <div className="integral-code-block__runbar">
            <button
              className="integral-code-block__button integral-code-block__button--primary"
              disabled={runState.status === "running"}
              onClick={onRun}
              type="button"
            >
              {runState.status === "running" ? "実行中..." : "Run"}
            </button>
            <p className="integral-code-block__runhint">
              `analysis-args.json` を生成し、`.py-scripts/PYS-.../` で Python を実行します。
            </p>
          </div>
        ) : null}

      </div>

      {inlineError ? (
        <div className="integral-code-block__result integral-code-block__result--error">
          <strong>{inlineError}</strong>
        </div>
      ) : null}

      {runState.status !== "idle" ? <RunStateView runState={runState} /> : null}

      {slotDialogState?.kind === "chunk" ? (
        <ChunkPickerDialog
          acceptedKinds={blockDefinition.inputSlots.find((slot) => slot.name === slotDialogState.slotName)?.acceptedKinds}
          onClose={() => {
            setSlotDialogState(null);
          }}
          onError={setInlineError}
          onSelect={(chunkId) => {
            onAssignChunk(slotDialogState.slotName, chunkId);
            setSlotDialogState(null);
          }}
        />
      ) : null}

      {slotDialogState?.kind === "blobs" ? (
        <BlobPickerDialog
          onClose={() => {
            setSlotDialogState(null);
          }}
          onError={setInlineError}
          onSelectChunk={(chunkId) => {
            onAssignChunk(slotDialogState.slotName, chunkId);
            setSlotDialogState(null);
          }}
        />
      ) : null}
    </div>
  );
}

function RunStateView({ runState }: { runState: RunState }): JSX.Element {
  const kind =
    runState.status === "success"
      ? "success"
      : runState.status === "running"
        ? "success"
        : "error";

  return (
    <div className={`integral-code-block__result integral-code-block__result--${kind}`}>
      <strong>{runState.summary ?? "block を実行しました。"}</strong>

      {runState.logLines.length > 0 ? (
        <ul className="integral-code-block__log">
          {runState.logLines.map((line, index) => (
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

function applyIntegralBlockMutation(
  content: string,
  mutator: (block: IntegralBlockDocument) => IntegralBlockDocument
): {
  error: string | null;
  nextText: string;
} {
  const parsedDraft = parseIntegralDraft(content);

  if (!parsedDraft.block) {
    return {
      error: parsedDraft.error,
      nextText: content
    };
  }

  return {
    error: null,
    nextText: JSON.stringify(mutator(parsedDraft.block), null, 2)
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

    if (typeof parsed.plugin !== "string" || parsed.plugin.trim().length === 0) {
      return {
        error: "`plugin` を持つ Integral block JSON が必要です。",
        record: null
      };
    }

    if (typeof parsed["block-type"] !== "string" || parsed["block-type"].trim().length === 0) {
      return {
        error: "`block-type` を持つ Integral block JSON が必要です。",
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

function createIdleRunState(): RunState {
  return {
    finishedAt: null,
    logLines: [],
    startedAt: null,
    status: "idle",
    summary: null
  };
}

function createErrorRunState(message: string): RunState {
  return {
    finishedAt: new Date().toISOString(),
    logLines: [message],
    startedAt: null,
    status: "error",
    summary: "Integral block の処理に失敗しました。"
  };
}

function toRunState(result: ExecuteIntegralBlockResult): RunState {
  return {
    finishedAt: result.finishedAt,
    logLines: result.logLines,
    startedAt: result.startedAt,
    status: "success",
    summary: result.summary
  };
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
