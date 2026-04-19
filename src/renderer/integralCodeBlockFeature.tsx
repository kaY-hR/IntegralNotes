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
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import type {
  ExecuteIntegralBlockResult,
  IntegralAssetCatalog,
  IntegralBlockDocument,
  IntegralBlockOutputConfig,
  IntegralDatasetSummary,
  IntegralManagedFileSummary,
  IntegralSlotDefinition
} from "../shared/integral";
import {
  getIntegralSlotPrimaryExtension,
  isIntegralBundleExtension,
  normalizeIntegralBlockOutputConfig,
  toIntegralOutputDirectoryRelativePath
} from "../shared/integral";
import {
  resolveWorkspaceMarkdownTarget,
  toCanonicalWorkspaceTarget
} from "../shared/workspaceLinks";

import {
  DatasetPickerDialog,
  DatasetRenderableView
} from "./IntegralAssetDialogs";
import { ExternalPluginBlockRenderer } from "./ExternalPluginBlockRenderer";
import { requestOpenManagedDataNote } from "./workspaceOpenEvents";
import {
  INTEGRAL_BLOCK_LANGUAGE,
  getIntegralBlockDefinition,
  parseIntegralBlockSource,
  renderIntegralBlockBody,
  serializeIntegralBlockContent,
  type IntegralJsonBlock
} from "./integralBlockRegistry";

interface IntegralCodeBlockFeatureOptions {
  onExecuteBlockResult?: (payload: {
    previousBlockSource: string;
    result: ExecuteIntegralBlockResult;
  }) => void;
  sourceNotePath?: string | null;
}

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

type SlotDialogState = {
  slotName: string;
} | null;

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

function createIntegralNotesView(options: IntegralCodeBlockFeatureOptions) {
  return $view(
    integralNotesBlockSchema.node,
    (): NodeViewConstructor => (node, view, getPos) =>
      new IntegralNotesBlockView(node, view, getPos, options)
  );
}

export function installIntegralCodeBlockFeature(
  editor: Crepe,
  options: IntegralCodeBlockFeatureOptions = {}
): void {
  editor.editor.use(standardCodeBlockSchema);
  editor.editor.use(integralNotesBlockSchema);
  editor.editor.use(createIntegralNotesView(options));
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
    public getPos: () => number | undefined,
    private readonly options: IntegralCodeBlockFeatureOptions
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
    const previousBlock = parseIntegralBlockSource(INTEGRAL_BLOCK_LANGUAGE, previousText)?.block;
    const nextBlock = parseIntegralBlockSource(INTEGRAL_BLOCK_LANGUAGE, nextText)?.block;
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

    return Boolean(
      target.closest(
        "textarea, button, input, select, label, iframe, .integral-renderable-layout, .integral-renderable-card, .integral-renderable-card__image, .integral-renderable-card__text"
      )
    );
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
    this.dom.dataset.integralBlockId = parsed.block?.id ?? "";

    this.root.render(
      <IntegralBlockPanel
        onAssignInputReference={(slotName, inputReference) => {
          const result = applyIntegralBlockMutation(rawText, (currentBlock) => ({
            ...currentBlock,
            inputs: {
              ...currentBlock.inputs,
              [slotName]: inputReference
            }
          }));

          if (result.error) {
            this.runState = createErrorRunState(result.error);
            this.render();
            return;
          }

          this.applyTextChange(result.nextText);
        }}
        onUpdateOutputConfig={(slotName, nextOutputConfig) => {
          const result = applyIntegralBlockMutation(rawText, (currentBlock) => ({
            ...currentBlock,
            outputConfigs: {
              ...(currentBlock.outputConfigs ?? {}),
              [slotName]: nextOutputConfig
            }
          }));

          if (result.error) {
            this.runState = createErrorRunState(result.error);
            this.render();
            return;
          }

          this.applyTextChange(result.nextText);
        }}
        onUpdateParams={(nextParams) => {
          const result = applyIntegralBlockMutation(rawText, (currentBlock) => ({
            ...currentBlock,
            params: nextParams
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
        block: parsed.block,
        sourceNotePath: this.options.sourceNotePath ?? null
      });

      if (this.destroyed) {
        return;
      }

      this.runState = toRunState(result);

      if (this.options.onExecuteBlockResult) {
        this.options.onExecuteBlockResult({
          previousBlockSource: rawText,
          result
        });
      } else {
        this.applyTextChange(serializeIntegralBlockContent(result.block));
      }
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
  onAssignInputReference,
  onUpdateOutputConfig,
  onUpdateParams,
  onRun,
  parsed,
  runState,
  selected
}: {
  onAssignInputReference: (slotName: string, inputReference: string | null) => void;
  onUpdateOutputConfig: (slotName: string, nextOutputConfig: IntegralBlockOutputConfig) => void;
  onUpdateParams: (nextParams: Record<string, unknown>) => void;
  onRun: () => void;
  parsed: ParsedIntegralDraft;
  runState: RunState;
  selected: boolean;
}): JSX.Element {
  const [slotDialogState, setSlotDialogState] = useState<SlotDialogState>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [assetCatalog, setAssetCatalog] = useState<IntegralAssetCatalog>({
    blockTypes: [],
    datasets: [],
    managedFiles: []
  });

  useEffect(() => {
    if (!parsed.block) {
      return;
    }

    void window.integralNotes
      .getIntegralAssetCatalog()
      .then((catalog) => {
        setAssetCatalog(catalog);
      })
      .catch(() => {});
  }, [parsed.block?.id, runState.finishedAt]);

  const datasetMap = new Map<string, IntegralDatasetSummary>();
  const datasetPathMap = new Map<string, IntegralDatasetSummary>();
  const managedFileMap = new Map<string, IntegralManagedFileSummary>();
  const managedFilePathMap = new Map<string, IntegralManagedFileSummary>();

  for (const dataset of assetCatalog.datasets) {
    datasetMap.set(dataset.datasetId, dataset);
    datasetPathMap.set(dataset.path, dataset);
    datasetPathMap.set(toCanonicalWorkspaceTarget(dataset.path), dataset);
  }

  for (const managedFile of assetCatalog.managedFiles) {
    managedFileMap.set(managedFile.id, managedFile);
    managedFilePathMap.set(managedFile.path, managedFile);
    managedFilePathMap.set(toCanonicalWorkspaceTarget(managedFile.path), managedFile);
  }

  const resolveDataset = (datasetReference: string | null): IntegralDatasetSummary | null => {
    if (!datasetReference) {
      return null;
    }

    return (
      datasetMap.get(datasetReference) ??
      datasetPathMap.get(datasetReference) ??
      datasetPathMap.get(resolveWorkspaceMarkdownTarget(datasetReference) ?? datasetReference) ??
      null
    );
  };

  const resolveDatasetId = (datasetReference: string | null): string | null => {
    return resolveDataset(datasetReference)?.datasetId ?? null;
  };

  const resolveManagedFile = (reference: string | null): IntegralManagedFileSummary | null => {
    if (!reference) {
      return null;
    }

    return (
      managedFileMap.get(reference) ??
      managedFilePathMap.get(reference) ??
      managedFilePathMap.get(resolveWorkspaceMarkdownTarget(reference) ?? reference) ??
      null
    );
  };

  const toStoredDatasetReference = (datasetId: string): string => {
    const dataset = datasetMap.get(datasetId);

    if (!dataset) {
      return datasetId;
    }

    return toCanonicalWorkspaceTarget(dataset.path);
  };

  const latestOutputMap = new Map<string, IntegralDatasetSummary>();
  const blockDefinition = parsed.block
    ? getIntegralBlockDefinition(parsed.block.plugin, parsed.block["block-type"])
    : null;

  if (parsed.block?.id && blockDefinition) {
    for (const outputSlot of blockDefinition.outputSlots) {
      const expectedKind =
        outputSlot.producedKind?.trim() || `${parsed.block["block-type"]}.${outputSlot.name}`;
      const latestDataset = assetCatalog.datasets
        .filter(
          (dataset) =>
            dataset.createdByBlockId === parsed.block?.id && dataset.kind === expectedKind
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

      if (latestDataset) {
        latestOutputMap.set(outputSlot.name, latestDataset);
      }
    }
  }

  const formatDatasetLabel = (datasetReference: string | null): string => {
    if (!datasetReference) {
      return "未設定";
    }

    const dataset = resolveDataset(datasetReference);

    if (dataset) {
      return dataset.name;
    }

    const managedFile = resolveManagedFile(datasetReference);
    return managedFile?.displayName ?? datasetReference;
  };

  const selectInputReference = (slot: IntegralSlotDefinition, currentReference: string | null): void => {
    const primaryExtension = getIntegralSlotPrimaryExtension(slot, ".idts");

    if (isIntegralBundleExtension(primaryExtension)) {
      setInlineError(null);
      setSlotDialogState({ slotName: slot.name });
      return;
    }

    setInlineError(null);
    void window.integralNotes
      .selectWorkspaceFile({
        extensions: [slot.extension, ...(slot.extensions ?? [])].filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0
        ),
        initialRelativePath:
          currentReference === null
            ? null
            : (resolveWorkspaceMarkdownTarget(currentReference) ?? currentReference)
      })
      .then((selectedRelativePath) => {
        if (selectedRelativePath === null) {
          return;
        }

        onAssignInputReference(slot.name, toCanonicalWorkspaceTarget(selectedRelativePath));
      })
      .catch((error) => {
        setInlineError(formatErrorMessage(error));
      });
  };

  const resolveManagedDataNoteTarget = (
    reference: string | null
  ): {
    canOpenDataNote: boolean;
    displayName: string;
    targetId: string;
  } | null => {
    if (!reference) {
      return null;
    }

    const dataset = resolveDataset(reference);

    if (dataset) {
      return {
        canOpenDataNote: dataset.canOpenDataNote,
        displayName: dataset.name,
        targetId: dataset.noteTargetId ?? dataset.datasetId
      };
    }

    const managedFile = resolveManagedFile(reference);

    if (!managedFile) {
      return null;
    }

    return {
      canOpenDataNote: managedFile.canOpenDataNote,
      displayName: managedFile.displayName,
      targetId: managedFile.noteTargetId ?? managedFile.id
    };
  };

  const openManagedDataNote = (reference: string | null): void => {
    const managedData = resolveManagedDataNoteTarget(reference);

    if (!managedData || !managedData.canOpenDataNote) {
      return;
    }

    requestOpenManagedDataNote(managedData.targetId);
  };

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
  const isDisplayBlock =
    blockDefinition?.pluginId === "core-display" &&
    blockDefinition.executionMode === "display";
  const hasCustomRenderer =
    blockDefinition?.source === "external-plugin" &&
    blockDefinition.externalPlugin?.rendererMode === "iframe";

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
    const sourceDatasetRef = parsed.block.inputs.source ?? null;
    const sourceDatasetId = resolveDatasetId(sourceDatasetRef);
    const sourceManagedData = resolveManagedDataNoteTarget(sourceDatasetRef);
    const hasSourceNote = sourceManagedData?.canOpenDataNote === true;

    return (
      <div className={`integral-code-block integral-code-block--display${selected ? " integral-code-block--selected" : ""}`}>
        <div className="integral-display-block">
          <div className="integral-display-block__toolbar">
            <button
              className="integral-code-block__button integral-code-block__button--ghost integral-display-block__picker"
              onClick={() => {
                setInlineError(null);
                setSlotDialogState({ slotName: "source" });
              }}
              type="button"
            >
              {formatDatasetLabel(sourceDatasetRef)}
            </button>
            {hasSourceNote ? (
                <button
                  className="integral-slot-row__link integral-slot-row__link--note"
                  onClick={() => {
                    openManagedDataNote(sourceDatasetRef);
                  }}
                  type="button"
                >
                ノート
              </button>
            ) : null}
          </div>
          <DatasetRenderableView datasetId={sourceDatasetId} />
        </div>

        {inlineError ? (
          <div className="integral-code-block__result integral-code-block__result--error">
            <strong>{inlineError}</strong>
          </div>
        ) : null}

        {slotDialogState ? (
          <DatasetPickerDialog
            acceptedKinds={blockDefinition.inputSlots.find((slot) => slot.name === slotDialogState.slotName)?.acceptedKinds}
            defaultDatasetName={slotDialogState.slotName}
            onClose={() => {
              setSlotDialogState(null);
            }}
            onError={setInlineError}
            onSelect={(datasetId) => {
              onAssignInputReference(slotDialogState.slotName, toStoredDatasetReference(datasetId));
              setSlotDialogState(null);
            }}
          />
        ) : null}
      </div>
    );
  }

  const slotAssignments =
    blockDefinition.inputSlots.length > 0 || blockDefinition.outputSlots.length > 0 ? (
      <div className="integral-slot-list">
        {blockDefinition.inputSlots.length > 0 ? (
          <section className="integral-slot-section">
            <div className="integral-slot-section__header">
              <strong>Inputs</strong>
              <span>{blockDefinition.inputSlots.length} slots</span>
            </div>
            {blockDefinition.inputSlots.map((slot) => {
              const assignedReference = parsed.block.inputs[slot.name] ?? null;
              const assignedManagedData = resolveManagedDataNoteTarget(assignedReference);
              const isAssigned = assignedReference !== null;

              return (
                <div className="integral-slot-row" key={slot.name}>
                  <div className="integral-slot-row__meta">
                    <strong>{slot.name}</strong>
                    <span className={isAssigned ? "integral-slot-row__assigned" : "integral-slot-row__unassigned"}>
                      {formatDatasetLabel(assignedReference)}
                    </span>
                  </div>
                  {blockDefinition.executionMode === "manual" ? (
                    <div className="integral-slot-row__actions">
                      {isAssigned && assignedManagedData?.canOpenDataNote ? (
                        <button
                          className="integral-slot-row__link integral-slot-row__link--note"
                          onClick={() => {
                            openManagedDataNote(assignedReference);
                          }}
                          type="button"
                        >
                          ノート
                        </button>
                      ) : null}
                      <button
                        className="integral-code-block__button integral-code-block__button--ghost"
                        onClick={() => {
                          selectInputReference(slot, assignedReference);
                        }}
                        type="button"
                      >
                        {isAssigned
                          ? "変更"
                          : isIntegralBundleExtension(getIntegralSlotPrimaryExtension(slot, ".idts"))
                            ? "データを割り当て"
                            : "ファイルを割り当て"}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </section>
        ) : null}

        {blockDefinition.outputSlots.length > 0 ? (
          <section className="integral-slot-section">
            <div className="integral-slot-section__header">
              <strong>Outputs</strong>
              <span>{blockDefinition.outputSlots.length} slots</span>
            </div>
            {blockDefinition.outputSlots.map((slot) => {
              const outputSuffix = getIntegralSlotPrimaryExtension(slot, ".idts") ?? ".idts";
              const latestOutputReference = latestOutputMap.get(slot.name)?.datasetId ?? null;
              const outputManagedData =
                resolveManagedDataNoteTarget(latestOutputReference) ??
                resolveManagedDataNoteTarget(parsed.block.outputs[slot.name] ?? null);
              const outputReference = latestOutputReference ?? parsed.block.outputs[slot.name] ?? null;
              const outputConfig = resolveOutputConfig(
                parsed.block,
                slot.name,
                parsed.block.outputs[slot.name] ?? null
              );

              return (
                <div className="integral-slot-row integral-slot-row--output integral-output-slot-row" key={slot.name}>
                  <div className="integral-output-slot-row__main">
                    <div className="integral-output-slot-row__slot">
                      <strong>{slot.name}</strong>
                    </div>

                    <button
                      className="integral-output-slot-row__directory"
                      onClick={() => {
                        void window.integralNotes
                          .selectWorkspaceDirectory(resolveOutputDirectoryRelativePath(outputConfig.directory))
                          .then((selectedDirectory) => {
                            if (selectedDirectory === null) {
                              return;
                            }

                            setInlineError(null);
                            onUpdateOutputConfig(slot.name, {
                              ...outputConfig,
                              directory: selectedDirectory.length > 0 ? toCanonicalWorkspaceTarget(selectedDirectory) : "/"
                            });
                          })
                          .catch((error) => {
                            setInlineError(formatErrorMessage(error));
                          });
                      }}
                      type="button"
                    >
                      <FolderBadgeIcon />
                      <span>{formatOutputDirectoryLabel(outputConfig.directory)}</span>
                    </button>

                    <div className="integral-output-slot-row__name">
                      <input
                        className="integral-output-slot-row__name-input"
                        onChange={(event) => {
                          setInlineError(null);
                          onUpdateOutputConfig(slot.name, {
                            ...outputConfig,
                            name: event.target.value
                          });
                        }}
                        spellCheck={false}
                        type="text"
                        value={outputConfig.name}
                      />
                      <span className="integral-output-slot-row__suffix">{outputSuffix}</span>
                    </div>

                    {outputManagedData?.canOpenDataNote ? (
                      <div className="integral-slot-row__actions">
                        <button
                          className="integral-slot-row__link integral-slot-row__link--note"
                          onClick={() => {
                            openManagedDataNote(outputReference);
                          }}
                          title={outputManagedData ? `最新: ${outputManagedData.displayName}` : undefined}
                          type="button"
                        >
                          ノート
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </section>
        ) : null}
      </div>
    ) : null;

  if (hasCustomRenderer) {
    return (
      <div className={`integral-code-block${selected ? " integral-code-block--selected" : ""}`}>
        <div className="integral-json-preview integral-json-preview--compact">
          <div className="integral-json-preview__header">
            <h3 className="integral-json-preview__title">{blockDefinition.title}</h3>
            <code className="integral-json-preview__type">
              {parsed.block["block-type"]}
            </code>
          </div>

          {blockDefinition.description ? (
            <p className="integral-json-preview__description">{blockDefinition.description}</p>
          ) : null}

          <ExternalPluginBlockRenderer
            block={parsed.block}
            definition={blockDefinition}
            onUpdateParams={onUpdateParams}
          />

          {slotAssignments}
        </div>

        {inlineError ? (
          <div className="integral-code-block__result integral-code-block__result--error">
            <strong>{inlineError}</strong>
          </div>
        ) : null}

        {slotDialogState ? (
          <DatasetPickerDialog
            acceptedKinds={blockDefinition.inputSlots.find((slot) => slot.name === slotDialogState.slotName)?.acceptedKinds}
            defaultDatasetName={slotDialogState.slotName}
            onClose={() => {
              setSlotDialogState(null);
            }}
            onError={setInlineError}
            onSelect={(datasetId) => {
              onAssignInputReference(slotDialogState.slotName, toStoredDatasetReference(datasetId));
              setSlotDialogState(null);
            }}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className={`integral-code-block${selected ? " integral-code-block--selected" : ""}`}>
      <div className="integral-json-preview integral-json-preview--compact">
        <div className="integral-json-preview__header">
          <h3 className="integral-json-preview__title">{blockDefinition.title}</h3>
          <code className="integral-json-preview__type">
            {parsed.block["block-type"]}
          </code>
        </div>

        {blockDefinition.description ? (
          <p className="integral-json-preview__description">{blockDefinition.description}</p>
        ) : null}

        {slotAssignments}

        {blockDefinition.executionMode === "manual" && !hasCustomRenderer ? (
          <div className="integral-code-block__runbar">
            <button
              className="integral-code-block__button integral-code-block__button--primary"
              disabled={runState.status === "running"}
              onClick={onRun}
              type="button"
            >
              {runState.status === "running" ? "実行中..." : "Run"}
            </button>
          </div>
        ) : null}

      </div>

      {inlineError ? (
        <div className="integral-code-block__result integral-code-block__result--error">
          <strong>{inlineError}</strong>
        </div>
      ) : null}

      {runState.status !== "idle" ? <RunStateView runState={runState} /> : null}

      {slotDialogState ? (
        <DatasetPickerDialog
          acceptedKinds={blockDefinition.inputSlots.find((slot) => slot.name === slotDialogState.slotName)?.acceptedKinds}
          defaultDatasetName={slotDialogState.slotName}
          onClose={() => {
            setSlotDialogState(null);
          }}
          onError={setInlineError}
          onSelect={(datasetId) => {
            onAssignInputReference(slotDialogState.slotName, toStoredDatasetReference(datasetId));
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
  const source = parseIntegralBlockSource(INTEGRAL_BLOCK_LANGUAGE, content);

  if (!source) {
    return {
      block: null,
      error: `\`${INTEGRAL_BLOCK_LANGUAGE}\` YAML block として解釈できません。`
    };
  }

  return {
    block: source.block,
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
    nextText: serializeIntegralBlockContent(mutator(parsedDraft.block))
  };
}

function resolveOutputConfig(
  block: IntegralBlockDocument,
  slotName: string,
  latestOutputReference: string | null
): IntegralBlockOutputConfig {
  return normalizeIntegralBlockOutputConfig(
    block.outputConfigs?.[slotName],
    slotName,
    latestOutputReference
  );
}

function resolveOutputDirectoryRelativePath(directory: string): string | null {
  return toIntegralOutputDirectoryRelativePath(directory);
}

function formatOutputDirectoryLabel(directory: string): string {
  const relativePath = resolveOutputDirectoryRelativePath(directory);

  if (relativePath === null) {
    return "/Data/";
  }

  return relativePath.length > 0 ? `/${relativePath}/` : "/";
}

function FolderBadgeIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="integral-output-slot-row__directory-icon"
      viewBox="0 0 16 16"
    >
      <path
        d="M2.25 4.25h3.2l1.1 1.35h7.2v5.7a1.2 1.2 0 0 1-1.2 1.2H3.45a1.2 1.2 0 0 1-1.2-1.2z"
        fill="currentColor"
        opacity="0.24"
      />
      <path
        d="M2.25 4.25h3.2l1.1 1.35h7.2v5.7a1.2 1.2 0 0 1-1.2 1.2H3.45a1.2 1.2 0 0 1-1.2-1.2z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.1"
      />
    </svg>
  );
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
