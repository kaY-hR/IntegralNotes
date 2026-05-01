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
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";

import type {
  ExecuteIntegralBlockResult,
  IntegralAssetCatalog,
  IntegralBlockDocument,
  IntegralDatasetSummary,
  IntegralManagedFileSummary,
  IntegralParamSchemaProperty,
  IntegralParamsSchema,
  IntegralParamValue,
  IntegralSlotDefinition,
  UndoIntegralBlockResult
} from "../shared/integral";
import {
  createDefaultIntegralOutputPath,
  getIntegralSlotPrimaryExtension,
  isIntegralBundleExtension,
  normalizeIntegralParams,
  normalizeIntegralSlotExtensions
} from "../shared/integral";
import type { WorkspaceEntry } from "../shared/workspace";
import {
  resolveWorkspaceMarkdownTarget,
  toCanonicalWorkspaceTarget
} from "../shared/workspaceLinks";

import {
  DatasetPickerDialog,
  DatasetRenderableView,
  IntegralAssetPreviewWindow,
  type IntegralAssetPreviewTarget
} from "./IntegralAssetDialogs";
import { ExternalPluginBlockRenderer } from "./ExternalPluginBlockRenderer";
import { requestOpenManagedDataNote } from "./workspaceOpenEvents";
import {
  INTEGRAL_BLOCK_LANGUAGE,
  createInitialIntegralBlock,
  getIntegralBlockDefinition,
  normalizeIntegralBlockInputReferencesWithCatalog,
  parseIntegralBlockSource,
  renderIntegralBlockBody,
  serializeIntegralBlockContent,
  type IntegralJsonBlock
} from "./integralBlockRegistry";

interface IntegralCodeBlockFeatureOptions {
  getAnalysisResultDirectory?: () => string | null;
  getWorkspaceEntries?: () => WorkspaceEntry[];
  onExecuteBlockError?: (payload: {
    errorMessage: string;
    previousBlockSource: string;
  }) => void;
  onExecuteBlockResult?: (payload: {
    previousBlockSource: string;
    result: ExecuteIntegralBlockResult;
  }) => void;
  onUndoBlockResult?: (payload: {
    nextBlockSource: string;
    previousBlockSource: string;
    result: UndoIntegralBlockResult;
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

type SlotFieldPickerState =
  | {
      datatype?: string;
      extensions?: string[];
      fieldKey: string;
      kind: "input-dataset";
      query: string;
      selectedIndex: number;
      slotName: string;
    }
  | {
      datatype?: string;
      extensions?: string[];
      fieldKey: string;
      kind: "input-file";
      query: string;
      selectedIndex: number;
      slotName: string;
    };

interface PickerOption {
  action?: "create-dataset";
  description: string;
  label: string;
  previewTarget?: IntegralAssetPreviewTarget;
  value: string;
}

interface PickerPopupLayout {
  maxHeight: number;
  width: number;
  x: number;
  y: number;
}

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
        "textarea, button, input, select, label, iframe, pre, code, .integral-code-block__log-text, .integral-renderable-layout, .integral-renderable-card, .integral-renderable-card__image, .integral-renderable-card__text"
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
          analysisResultDirectory={this.options.getAnalysisResultDirectory?.() ?? null}
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
        onReplaceInputReferences={(inputReferences) => {
          const result = applyIntegralBlockMutation(rawText, (currentBlock) => ({
            ...currentBlock,
            inputs: inputReferences
          }));

          if (result.error) {
            this.runState = createErrorRunState(result.error);
            this.render();
            return;
          }

          this.applyTextChange(result.nextText);
        }}
        onAssignOutputReference={(slotName, outputReference) => {
          const result = applyIntegralBlockMutation(rawText, (currentBlock) => ({
            ...currentBlock,
            outputs: {
              ...currentBlock.outputs,
              [slotName]: outputReference
            }
          }));

          if (result.error) {
            this.runState = createErrorRunState(result.error);
            this.render();
            return;
          }

          this.applyTextChange(result.nextText);
        }}
        onDeleteBlock={() => {
          this.deleteBlock();
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
        onUndo={() => {
          void this.handleUndo();
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

  private deleteBlock(): void {
    const position = this.getPos();

    if (position === undefined) {
      return;
    }

    this.view.dispatch(this.view.state.tr.delete(position, position + this.node.nodeSize));
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

      const errorMessage = formatErrorMessage(error);
      this.runState = createErrorRunState(errorMessage);
      this.options.onExecuteBlockError?.({
        errorMessage,
        previousBlockSource: rawText
      });
    }

    if (!this.destroyed) {
      this.render();
    }
  }

  private async handleUndo(): Promise<void> {
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

    this.runState = {
      finishedAt: null,
      logLines: [],
      startedAt: new Date().toISOString(),
      status: "running",
      summary: "Undo 中..."
    };
    this.render();

    try {
      const result = await window.integralNotes.undoIntegralBlock({
        block: parsed.block
      });

      if (this.destroyed) {
        return;
      }

      const nextBlockSource = serializeIntegralBlockContent(
        createInitialIntegralBlock(blockDefinition, {
          outputRoot: this.options.getAnalysisResultDirectory?.() ?? null
        })
      );

      this.runState = createIdleRunState();

      if (this.options.onUndoBlockResult) {
        this.options.onUndoBlockResult({
          nextBlockSource,
          previousBlockSource: rawText,
          result
        });
      } else {
        this.applyTextChange(nextBlockSource);
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
  analysisResultDirectory,
  onAssignInputReference,
  onAssignOutputReference,
  onDeleteBlock,
  onReplaceInputReferences,
  onUpdateParams,
  onRun,
  onUndo,
  parsed,
  runState,
  selected
}: {
  analysisResultDirectory?: string | null;
  onAssignInputReference: (slotName: string, inputReference: string | null) => void;
  onAssignOutputReference: (slotName: string, outputReference: string | null) => void;
  onDeleteBlock: () => void;
  onReplaceInputReferences: (inputReferences: Record<string, string | null>) => void;
  onUpdateParams: (nextParams: Record<string, unknown>) => void;
  onRun: () => void;
  onUndo: () => void;
  parsed: ParsedIntegralDraft;
  runState: RunState;
  selected: boolean;
}): JSX.Element {
  const [slotDialogState, setSlotDialogState] = useState<SlotDialogState>(null);
  const [slotFieldPicker, setSlotFieldPicker] = useState<SlotFieldPickerState | null>(null);
  const [slotFieldPickerLayout, setSlotFieldPickerLayout] = useState<PickerPopupLayout | null>(
    null
  );
  const [slotFieldPreviewTarget, setSlotFieldPreviewTarget] =
    useState<IntegralAssetPreviewTarget | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [assetCatalog, setAssetCatalog] = useState<IntegralAssetCatalog>({
    blockTypes: [],
    datasets: [],
    managedFiles: []
  });
  const slotFieldRefs = useRef<Record<string, HTMLElement | null>>({});

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

  useEffect(() => {
    if (!parsed.block) {
      return;
    }

    const normalizedBlock = normalizeIntegralBlockInputReferencesWithCatalog(
      parsed.block,
      assetCatalog
    );

    if (normalizedBlock === parsed.block) {
      return;
    }

    onReplaceInputReferences(normalizedBlock.inputs);
  }, [assetCatalog, onReplaceInputReferences, parsed.block]);

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

  const resolveStoredOutputReference = (
    reference: string | null
  ): IntegralDatasetSummary | IntegralManagedFileSummary | null => {
    if (!reference) {
      return null;
    }

    return datasetMap.get(reference) ?? managedFileMap.get(reference) ?? null;
  };

  const isExecutedOutputReference = (
    reference: string | null,
    blockId: string | undefined
  ): boolean => {
    if (!blockId) {
      return false;
    }

    const managedData = resolveStoredOutputReference(reference);
    return managedData?.createdByBlockId === blockId;
  };

  const toStoredDatasetReference = (datasetId: string): string => {
    return datasetId;
  };
  const blockDefinition = parsed.block
    ? getIntegralBlockDefinition(parsed.block.plugin, parsed.block["block-type"])
    : null;

  useEffect(() => {
    setSlotFieldPicker(null);
    setSlotFieldPickerLayout(null);
    setSlotFieldPreviewTarget(null);
  }, [parsed.block?.id]);

  useEffect(() => {
    if (!slotFieldPicker) {
      setSlotFieldPreviewTarget(null);
    }
  }, [slotFieldPicker]);

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

  const toWorkspaceReferenceFieldValue = (reference: string | null): string => {
    if (!reference) {
      return "";
    }

    const dataset = resolveDataset(reference);

    if (dataset) {
      return toCanonicalWorkspaceTarget(dataset.path);
    }

    const managedFile = resolveManagedFile(reference);

    if (managedFile) {
      return toCanonicalWorkspaceTarget(managedFile.path);
    }

    const relativePath = resolveWorkspaceMarkdownTarget(reference);
    return relativePath ? toCanonicalWorkspaceTarget(relativePath) : reference;
  };

  const registerSlotFieldRef =
    (fieldKey: string) =>
    (element: HTMLElement | null): void => {
      slotFieldRefs.current[fieldKey] = element;
    };

  const openSlotFieldPicker = (
    nextPicker: Omit<SlotFieldPickerState, "selectedIndex">
  ): void => {
    setInlineError(null);
    setSlotFieldPicker((current) => {
      if (
        current &&
        current.fieldKey === nextPicker.fieldKey &&
        current.kind === nextPicker.kind &&
        current.slotName === nextPicker.slotName
      ) {
        return current;
      }

      return {
        ...nextPicker,
        selectedIndex: 0
      };
    });
  };

  const updateSlotFieldPickerQuery = (fieldKey: string, query: string): void => {
    setSlotFieldPreviewTarget(null);
    setSlotFieldPicker((current) => {
      if (!current || current.fieldKey !== fieldKey) {
        return current;
      }

      return {
        ...current,
        query,
        selectedIndex: 0
      };
    });
  };

  const closeSlotFieldPicker = (fieldKey?: string): void => {
    setSlotFieldPreviewTarget(null);
    setSlotFieldPicker((current) => {
      if (!current) {
        return current;
      }

      if (fieldKey && current.fieldKey !== fieldKey) {
        return current;
      }

      return null;
    });
  };

  const resolveInputReferenceFromFieldQuery = (
    picker: SlotFieldPickerState,
    query: string
  ): string | null | undefined => {
    const trimmedQuery = query.trim();

    if (trimmedQuery.length === 0) {
      return null;
    }

    if (picker.kind === "input-dataset") {
      const dataset = resolveDataset(trimmedQuery);
      return dataset ? toStoredDatasetReference(dataset.datasetId) : undefined;
    }

    const managedFile = resolveManagedFile(trimmedQuery);
    return managedFile ? managedFile.id : undefined;
  };

  const commitSlotFieldPickerQuery = (fieldKey: string): void => {
    const picker = slotFieldPicker;

    if (!picker || picker.fieldKey !== fieldKey) {
      return;
    }

    const nextReference = resolveInputReferenceFromFieldQuery(picker, picker.query);

    if (nextReference === undefined) {
      return;
    }

    setInlineError(null);
    onAssignInputReference(picker.slotName, nextReference);
  };

  const clearInputReference = (slotName: string, fieldKey: string): void => {
    setInlineError(null);
    onAssignInputReference(slotName, null);
    setSlotFieldPicker((current) =>
      current?.fieldKey === fieldKey
        ? {
            ...current,
            query: "",
            selectedIndex: 0
          }
        : current
    );
  };

  const chooseOutputDirectory = async (
    slotName: string,
    outputReference: string | null
  ): Promise<void> => {
    try {
      const selectedPath = await window.integralNotes.selectWorkspaceDirectory(
        resolveWorkspaceMarkdownTarget(outputReference ?? "") ?? outputReference
      );

      if (!selectedPath) {
        return;
      }

      onAssignOutputReference(slotName, toCanonicalWorkspaceTarget(selectedPath));
    } catch (error) {
      setInlineError(toErrorMessage(error));
    }
  };

  const handleSlotFieldBlur = (fieldKey: string): void => {
    window.setTimeout(() => {
      commitSlotFieldPickerQuery(fieldKey);
      closeSlotFieldPicker(fieldKey);
    }, 0);
  };

  const pickerOptions =
    slotFieldPicker === null
      ? []
      : resolveSlotFieldPickerOptions({
          assetCatalog,
          slotFieldPicker,
          toStoredDatasetReference
        });
  const selectedSlotFieldOption =
    pickerOptions.length === 0 || slotFieldPicker === null
      ? null
      : pickerOptions[Math.min(slotFieldPicker.selectedIndex, pickerOptions.length - 1)] ?? null;
  const slotFieldPopupId =
    parsed.block.id && slotFieldPicker
      ? `integral-slot-picker-${parsed.block.id}-${slotFieldPicker.fieldKey}`
      : undefined;

  const commitSlotFieldPickerOption = (
    option: PickerOption,
    picker: SlotFieldPickerState | null = slotFieldPicker
  ): void => {
    if (!picker) {
      return;
    }

    setInlineError(null);

    if (option.action === "create-dataset") {
      void (async () => {
        try {
          const result = await window.integralNotes.createDatasetFromFileDialog({
            datatype: picker.datatype ?? null,
            defaultName: picker.slotName
          });

          if (!result) {
            return;
          }

          const nextCatalog = await window.integralNotes.getIntegralAssetCatalog();
          setAssetCatalog(nextCatalog);
          onAssignInputReference(picker.slotName, toStoredDatasetReference(result.dataset.datasetId));
          closeSlotFieldPicker(picker.fieldKey);
        } catch (error) {
          setInlineError(toErrorMessage(error));
        }
      })();
      return;
    }

    onAssignInputReference(picker.slotName, option.value);
    closeSlotFieldPicker(picker.fieldKey);
  };

  const handleSlotFieldKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>,
    fieldKey: string
  ): void => {
    const picker = slotFieldPicker;

    if (!picker || picker.fieldKey !== fieldKey) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSlotFieldPicker((current) =>
        current && current.fieldKey === fieldKey
          ? {
              ...current,
              selectedIndex:
                pickerOptions.length === 0 ? 0 : (current.selectedIndex + 1) % pickerOptions.length
            }
          : current
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSlotFieldPicker((current) =>
        current && current.fieldKey === fieldKey
          ? {
              ...current,
              selectedIndex:
                pickerOptions.length === 0
                  ? 0
                  : (current.selectedIndex - 1 + pickerOptions.length) % pickerOptions.length
            }
          : current
      );
      return;
    }

    if (event.key === "Enter") {
      if (!selectedSlotFieldOption) {
        return;
      }

      event.preventDefault();
      commitSlotFieldPickerOption(selectedSlotFieldOption, picker);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeSlotFieldPicker(fieldKey);
    }
  };

  useLayoutEffect(() => {
    if (!slotFieldPicker) {
      setSlotFieldPickerLayout(null);
      return;
    }

    const updateLayout = (): void => {
      const anchorElement = slotFieldRefs.current[slotFieldPicker.fieldKey];

      if (!anchorElement) {
        setSlotFieldPickerLayout(null);
        return;
      }

      const rect = anchorElement.getBoundingClientRect();
      const popupWidth = Math.min(Math.max(rect.width, 320), Math.max(320, window.innerWidth - 24));
      const popupLayout = computeSlotFieldPopupLayout(rect);

      setSlotFieldPickerLayout({
        maxHeight: popupLayout.maxHeight,
        width: popupWidth,
        x: clampSlotFieldPopupCoordinate(rect.left, popupWidth, window.innerWidth),
        y: popupLayout.y
      });
    };

    updateLayout();
    window.addEventListener("resize", updateLayout);
    window.addEventListener("scroll", updateLayout, true);

    return () => {
      window.removeEventListener("resize", updateLayout);
      window.removeEventListener("scroll", updateLayout, true);
    };
  }, [slotFieldPicker]);

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
  const isExecutedBlock =
    blockDefinition?.executionMode === "manual" &&
    blockDefinition.outputSlots.length > 0 &&
    blockDefinition.outputSlots.every((slot) =>
      isExecutedOutputReference(parsed.block.outputs[slot.name] ?? null, parsed.block.id)
    );
  const paramsForm = blockDefinition?.paramsSchema ? (
    <IntegralParamsForm
      disabled={isExecutedBlock || runState.status === "running"}
      onUpdateParams={(nextParams) => {
        setInlineError(null);
        onUpdateParams(normalizeIntegralParams(nextParams, blockDefinition.paramsSchema));
      }}
      params={parsed.block.params}
      schema={blockDefinition.paramsSchema}
    />
  ) : null;

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
            defaultDatasetName={slotDialogState.slotName}
            onClose={() => {
              setSlotDialogState(null);
            }}
            onError={setInlineError}
            preferredDatatype={blockDefinition.inputSlots.find((slot) => slot.name === slotDialogState.slotName)?.datatype}
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
      <>
        <div className="integral-slot-list">
          {blockDefinition.inputSlots.length > 0 ? (
            <section className="integral-slot-section">
              <div className="integral-slot-section__header">
                <strong>Inputs</strong>
                <span>{blockDefinition.inputSlots.length} slots</span>
              </div>
              {blockDefinition.inputSlots.map((slot, index) => {
                const assignedReference = parsed.block.inputs[slot.name] ?? null;
                const assignedManagedData = resolveManagedDataNoteTarget(assignedReference);
                const fieldKey = `input:${slot.name}`;
                const isBundleInput = isIntegralBundleExtension(
                  getIntegralSlotPrimaryExtension(slot, ".idts")
                );
                const isPickerOpen = slotFieldPicker?.fieldKey === fieldKey;
                const fieldValue = isPickerOpen
                  ? slotFieldPicker.query
                  : toWorkspaceReferenceFieldValue(assignedReference);
                const placeholder = isBundleInput ? "dataset / .idts を選択" : "workspace file を選択";

                return (
                  <div className="integral-slot-row" key={slot.name}>
                    <div className="integral-slot-row__meta">
                      <strong>{slot.name}</strong>
                    </div>

                    {blockDefinition.executionMode === "manual" && !isExecutedBlock ? (
                      <div className="integral-slot-row__field">
                        <div className="integral-slot-row__input-wrap">
                          <input
                            aria-autocomplete="list"
                            aria-controls={isPickerOpen ? slotFieldPopupId : undefined}
                            aria-expanded={isPickerOpen}
                            className="integral-slot-row__field-input"
                            data-integral-focus-target={index === 0 ? "primary" : undefined}
                            onBlur={() => {
                              handleSlotFieldBlur(fieldKey);
                            }}
                            onChange={(event) => {
                              const nextQuery = event.target.value;
                              updateSlotFieldPickerQuery(fieldKey, nextQuery);

                              if (nextQuery.trim().length === 0 && assignedReference) {
                                clearInputReference(slot.name, fieldKey);
                              }
                            }}
                            onFocus={(event) => {
                              openSlotFieldPicker(
                                isBundleInput
                                  ? {
                                      datatype: slot.datatype,
                                      extensions: normalizeIntegralSlotExtensions([
                                        slot.extension ?? "",
                                        ...(slot.extensions ?? [])
                                      ]),
                                      fieldKey,
                                      kind: "input-dataset",
                                      query: toWorkspaceReferenceFieldValue(assignedReference),
                                      slotName: slot.name
                                    }
                                  : {
                                      datatype: slot.datatype,
                                      extensions: normalizeIntegralSlotExtensions([
                                        slot.extension ?? "",
                                        ...(slot.extensions ?? [])
                                      ]),
                                      fieldKey,
                                      kind: "input-file",
                                      query: toWorkspaceReferenceFieldValue(assignedReference),
                                      slotName: slot.name
                                    }
                              );
                              event.currentTarget.select();
                            }}
                            onKeyDown={(event) => {
                              handleSlotFieldKeyDown(event, fieldKey);
                            }}
                            placeholder={placeholder}
                            ref={registerSlotFieldRef(fieldKey)}
                            spellCheck={false}
                            type="text"
                            value={fieldValue}
                          />
                          {assignedReference ? (
                            <button
                              aria-label={`${slot.name} input をクリア`}
                              className="integral-slot-row__clear"
                              onClick={() => {
                                clearInputReference(slot.name, fieldKey);
                              }}
                              onMouseDown={(event) => {
                                event.preventDefault();
                              }}
                              title="入力をクリア"
                              type="button"
                            >
                              x
                            </button>
                          ) : null}
                        </div>
                        <span
                          className={
                            assignedReference
                              ? "integral-slot-row__assigned"
                              : "integral-slot-row__unassigned"
                          }
                        >
                          {assignedReference ? formatDatasetLabel(assignedReference) : "未設定"}
                        </span>
                      </div>
                    ) : (
                      <div className="integral-slot-row__field">
                        <span
                          className={
                            assignedReference
                              ? "integral-slot-row__assigned"
                              : "integral-slot-row__unassigned"
                          }
                        >
                          {assignedReference ? formatDatasetLabel(assignedReference) : "未設定"}
                        </span>
                      </div>
                    )}

                    {assignedManagedData?.canOpenDataNote ? (
                      <div className="integral-slot-row__actions">
                        <button
                          className="integral-slot-row__link integral-slot-row__link--note"
                          onClick={() => {
                            openManagedDataNote(assignedReference);
                          }}
                          tabIndex={-1}
                          type="button"
                        >
                          ノート
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
              {blockDefinition.outputSlots.map((slot, index) => {
                const outputReference = parsed.block.outputs[slot.name] ?? null;
                const outputManagedData = resolveManagedDataNoteTarget(outputReference);
                const outputFieldValue = outputManagedData
                  ? toWorkspaceReferenceFieldValue(outputReference)
                  : outputReference ?? "";
                const isBundleOutput = isIntegralBundleExtension(
                  getIntegralSlotPrimaryExtension(slot, ".idts")
                );
                const outputPlaceholder = createDefaultIntegralOutputPath(slot, "A1B", {
                  analysisDisplayName: blockDefinition.title,
                  outputRoot: analysisResultDirectory,
                  timestamp: isBundleOutput ? "yyyyMMddHHmm" : undefined
                });

                return (
                  <div
                    className="integral-slot-row integral-slot-row--output integral-output-slot-row"
                    key={slot.name}
                  >
                    <div className="integral-output-slot-row__main">
                      <div className="integral-output-slot-row__slot">
                        <strong>{slot.name}</strong>
                      </div>

                      <div className="integral-output-slot-row__path">
                        <input
                          className="integral-output-slot-row__path-input"
                          data-integral-focus-target={
                            blockDefinition.inputSlots.length === 0 && index === 0
                              ? "primary"
                              : undefined
                          }
                          disabled={isExecutedBlock}
                          onChange={(event) => {
                            setInlineError(null);
                            onAssignOutputReference(
                              slot.name,
                              event.target.value.trim().length > 0 ? event.target.value : null
                            );
                          }}
                          placeholder={outputPlaceholder}
                          spellCheck={false}
                          type="text"
                          value={outputFieldValue}
                        />
                        {isBundleOutput && !isExecutedBlock ? (
                          <button
                            className="button button--ghost button--xs"
                            onClick={() => {
                              void chooseOutputDirectory(slot.name, outputReference);
                            }}
                            type="button"
                          >
                            選択
                          </button>
                        ) : null}
                      </div>

                      {outputManagedData?.canOpenDataNote ? (
                        <div className="integral-slot-row__actions">
                          <button
                            className="integral-slot-row__link integral-slot-row__link--note"
                            onClick={() => {
                              openManagedDataNote(outputReference);
                            }}
                            tabIndex={-1}
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

        {slotFieldPicker && slotFieldPickerLayout
          ? createPortal(
              <div
                className="editor-link-completion integral-slot-picker"
                id={slotFieldPopupId}
                style={{
                  left: `${slotFieldPickerLayout.x}px`,
                  maxHeight: `${slotFieldPickerLayout.maxHeight}px`,
                  top: `${slotFieldPickerLayout.y}px`,
                  width: `${slotFieldPickerLayout.width}px`
                }}
              >
                {pickerOptions.length > 0 ? (
                  pickerOptions.map((option, index) => (
                    <button
                      className={`editor-link-completion__item${
                        index === Math.min(slotFieldPicker.selectedIndex, pickerOptions.length - 1)
                          ? " editor-link-completion__item--selected"
                          : ""
                      }`}
                      key={`${slotFieldPicker.fieldKey}:${option.value}`}
                      onFocus={() => {
                        setSlotFieldPreviewTarget(option.previewTarget ?? null);
                      }}
                      onMouseEnter={() => {
                        setSlotFieldPreviewTarget(option.previewTarget ?? null);
                      }}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        commitSlotFieldPickerOption(option);
                      }}
                      type="button"
                    >
                      <span className="editor-link-completion__name">{option.label}</span>
                      <span className="editor-link-completion__path">{option.description}</span>
                    </button>
                  ))
                ) : (
                  <div className="editor-link-completion__empty">
                    {formatSlotFieldPickerEmptyMessage(slotFieldPicker)}
                  </div>
                )}
              </div>,
              document.body
            )
          : null}

        {slotFieldPicker && slotFieldPickerLayout && slotFieldPreviewTarget
          ? createPortal(
              <IntegralAssetPreviewWindow
                anchorLayout={slotFieldPickerLayout}
                assetCatalog={assetCatalog}
                onClose={() => {
                  setSlotFieldPreviewTarget(null);
                }}
                target={slotFieldPreviewTarget}
              />,
              document.body
            )
          : null}
      </>
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

          {paramsForm}

          {slotAssignments}
        </div>

        {inlineError ? (
          <div className="integral-code-block__result integral-code-block__result--error">
            <strong>{inlineError}</strong>
          </div>
        ) : null}

        {slotDialogState ? (
          <DatasetPickerDialog
            defaultDatasetName={slotDialogState.slotName}
            onClose={() => {
              setSlotDialogState(null);
            }}
            onError={setInlineError}
            preferredDatatype={blockDefinition.inputSlots.find((slot) => slot.name === slotDialogState.slotName)?.datatype}
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

        {paramsForm}

        {slotAssignments}

        {blockDefinition.executionMode === "manual" && !hasCustomRenderer ? (
          <div className="integral-code-block__runbar">
            {isExecutedBlock ? (
              <div className="integral-code-block__runbar-actions">
                <button
                  className="integral-code-block__button integral-code-block__button--ghost"
                  disabled={runState.status === "running"}
                  onClick={onUndo}
                  type="button"
                >
                  {runState.status === "running" ? "Undo 中..." : "Undo"}
                </button>
                <button
                  className="integral-code-block__button integral-code-block__button--ghost"
                  disabled={runState.status === "running"}
                  onClick={onDeleteBlock}
                  type="button"
                >
                  Delete
                </button>
              </div>
            ) : (
              <button
                className="integral-code-block__button integral-code-block__button--primary"
                disabled={runState.status === "running"}
                onClick={onRun}
                type="button"
              >
                {runState.status === "running" ? "実行中..." : "Run"}
              </button>
            )}
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
          defaultDatasetName={slotDialogState.slotName}
          onClose={() => {
            setSlotDialogState(null);
          }}
          onError={setInlineError}
          preferredDatatype={blockDefinition.inputSlots.find((slot) => slot.name === slotDialogState.slotName)?.datatype}
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
  const [copyStatus, setCopyStatus] = useState<"copied" | "idle">("idle");
  const kind =
    runState.status === "success"
      ? "success"
      : runState.status === "running"
        ? "success"
        : "error";
  const logText = runState.logLines.join("\n").trim();

  const copyLog = async (): Promise<void> => {
    if (!logText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(logText);
      setCopyStatus("copied");
      window.setTimeout(() => {
        setCopyStatus("idle");
      }, 1200);
    } catch {
      setCopyStatus("idle");
    }
  };

  return (
    <div className={`integral-code-block__result integral-code-block__result--${kind}`}>
      <div className="integral-code-block__result-header">
        <strong>{runState.summary ?? "block を実行しました。"}</strong>
        {logText ? (
          <button
            className="integral-code-block__button integral-code-block__button--ghost integral-code-block__copy-button"
            onClick={() => {
              void copyLog();
            }}
            type="button"
          >
            {copyStatus === "copied" ? "Copied" : "Copy"}
          </button>
        ) : null}
      </div>

      {logText ? (
        <pre className="integral-code-block__log-text">
          <code>{logText}</code>
        </pre>
      ) : null}
    </div>
  );
}

function IntegralParamsForm({
  disabled,
  onUpdateParams,
  params,
  schema
}: {
  disabled: boolean;
  onUpdateParams: (nextParams: Record<string, unknown>) => void;
  params: Record<string, unknown>;
  schema: IntegralParamsSchema;
}): JSX.Element | null {
  const entries = Object.entries(schema.properties);

  if (entries.length === 0) {
    return null;
  }

  const normalizedParams = normalizeIntegralParams(params, schema);

  return (
    <section className="integral-slot-section integral-param-section">
      <div className="integral-slot-section__header">
        <strong>Params</strong>
        <span>{entries.length} fields</span>
      </div>

      {entries.map(([name, property]) => (
        <IntegralParamField
          disabled={disabled}
          key={name}
          name={name}
          onChange={(value) => {
            onUpdateParams({
              ...normalizedParams,
              [name]: value
            });
          }}
          property={property}
          value={(normalizedParams[name] ?? null) as IntegralParamValue}
        />
      ))}
    </section>
  );
}

function IntegralParamField({
  disabled,
  name,
  onChange,
  property,
  value
}: {
  disabled: boolean;
  name: string;
  onChange: (value: IntegralParamValue) => void;
  property: IntegralParamSchemaProperty;
  value: IntegralParamValue;
}): JSX.Element {
  const label = property.title?.trim() || name;

  return (
    <div className="integral-param-row">
      <label className="integral-param-row__meta">
        <strong>{label}</strong>
        <span>{name}</span>
      </label>

      <div className="integral-param-row__field">
        <IntegralParamControl
          disabled={disabled}
          onChange={onChange}
          property={property}
          value={value}
        />
        {property.description ? (
          <span className="integral-param-row__description">{property.description}</span>
        ) : null}
      </div>
    </div>
  );
}

function IntegralParamControl({
  disabled,
  onChange,
  property,
  value
}: {
  disabled: boolean;
  onChange: (value: IntegralParamValue) => void;
  property: IntegralParamSchemaProperty;
  value: IntegralParamValue;
}): JSX.Element {
  if (property.enum && property.enum.length > 0) {
    const selectedIndex = property.enum.findIndex((item) => item === value);

    return (
      <select
        className="integral-param-row__input"
        disabled={disabled}
        onChange={(event) => {
          const optionIndex = Number(event.target.value);
          onChange(Number.isInteger(optionIndex) ? property.enum?.[optionIndex] ?? null : null);
        }}
        value={selectedIndex >= 0 ? `${selectedIndex}` : ""}
      >
        <option value="">未設定</option>
        {property.enum.map((option, index) => (
          <option key={`${index}:${String(option)}`} value={`${index}`}>
            {String(option)}
          </option>
        ))}
      </select>
    );
  }

  if (property.type === "boolean") {
    return (
      <select
        className="integral-param-row__input"
        disabled={disabled}
        onChange={(event) => {
          onChange(
            event.target.value === "true"
              ? true
              : event.target.value === "false"
                ? false
                : null
          );
        }}
        value={value === true ? "true" : value === false ? "false" : ""}
      >
        <option value="">未設定</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  if (property.type === "number" || property.type === "integer") {
    return (
      <input
        className="integral-param-row__input"
        disabled={disabled}
        max={property.maximum}
        min={property.minimum}
        onChange={(event) => {
          const rawValue = event.target.value.trim();

          if (rawValue.length === 0) {
            onChange(null);
            return;
          }

          const numericValue = Number(rawValue);

          if (!Number.isFinite(numericValue)) {
            onChange(null);
            return;
          }

          onChange(property.type === "integer" ? Math.trunc(numericValue) : numericValue);
        }}
        step={property.type === "integer" ? 1 : "any"}
        type="number"
        value={typeof value === "number" ? `${value}` : ""}
      />
    );
  }

  return (
    <input
      className="integral-param-row__input"
      disabled={disabled}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      type="text"
      value={typeof value === "string" ? value : ""}
    />
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

function resolveSlotFieldPickerOptions({
  assetCatalog,
  slotFieldPicker,
  toStoredDatasetReference
}: {
  assetCatalog: IntegralAssetCatalog;
  slotFieldPicker: SlotFieldPickerState;
  toStoredDatasetReference: (datasetId: string) => string;
}): PickerOption[] {
  const normalizedQuery = slotFieldPicker.query.trim().toLocaleLowerCase("ja");

  if (slotFieldPicker.kind === "input-dataset") {
    const preferredDatatype = slotFieldPicker.datatype?.trim() ?? "";
    const allowedExtensions =
      slotFieldPicker.extensions?.filter((value) => value.trim().length > 0) ?? [];
    const createOption: PickerOption = {
      action: "create-dataset",
      description: "任意 file を選び、保存先 .idts を指定",
      label: "新しいデータセットを作る",
      value: "__create-dataset__"
    };

    const datasetOptions = assetCatalog.datasets
      .map((dataset) => {
        const lowerPath = dataset.path.toLocaleLowerCase("ja");
        const matchesDatatype =
          preferredDatatype.length > 0 && dataset.datatype === preferredDatatype;
        const matchesExtension = allowedExtensions.some((extension) => lowerPath.endsWith(extension));
        return {
          description: `${toCanonicalWorkspaceTarget(dataset.path)}${dataset.datatype ? `  ${dataset.datatype}` : ""}`,
          label: dataset.name,
          previewTarget: {
            datasetId: dataset.datasetId,
            kind: "dataset"
          },
          priority:
            preferredDatatype.length === 0 && allowedExtensions.length === 0
              ? 0
              : matchesDatatype
                ? 0
                : matchesExtension
                  ? 1
                  : Number.POSITIVE_INFINITY,
          value: toStoredDatasetReference(dataset.datasetId)
        };
      })
      .filter((option) => option.priority < Number.POSITIVE_INFINITY)
      .sort((left, right) => {
        return (
          left.priority - right.priority ||
          scorePickerOption(left, normalizedQuery) - scorePickerOption(right, normalizedQuery)
        );
      })
      .filter((option) => scorePickerOption(option, normalizedQuery) < Number.POSITIVE_INFINITY)
      .map(({ priority: _priority, ...option }) => option);

    if (
      normalizedQuery.length === 0 ||
      scorePickerOption(createOption, normalizedQuery) < Number.POSITIVE_INFINITY
    ) {
      return [createOption, ...datasetOptions];
    }

    return datasetOptions;
  }

  if (slotFieldPicker.kind === "input-file") {
    const preferredDatatype = slotFieldPicker.datatype?.trim() ?? "";
    const allowedExtensions = slotFieldPicker.extensions ?? [];

    return assetCatalog.managedFiles
      .filter((managedFile) => managedFile.entityType === "managed-file")
      .map((managedFile) => {
        const lowerPath = managedFile.path.toLocaleLowerCase("ja");
        const matchesDatatype =
          preferredDatatype.length > 0 && managedFile.datatype === preferredDatatype;
        const matchesExtension = allowedExtensions.some((extension) => lowerPath.endsWith(extension));
        return {
          description: `${toCanonicalWorkspaceTarget(managedFile.path)}${managedFile.datatype ? `  ${managedFile.datatype}` : ""}`,
          label: managedFile.displayName,
          previewTarget: {
            kind: "managed-file",
            managedFileId: managedFile.id
          },
          priority:
            preferredDatatype.length === 0 && allowedExtensions.length === 0
              ? 0
              : matchesDatatype
                ? 0
                : matchesExtension
                  ? 1
                  : Number.POSITIVE_INFINITY,
          value: managedFile.id
        };
      })
      .filter((option) => option.priority < Number.POSITIVE_INFINITY)
      .sort((left, right) => {
        return (
          left.priority - right.priority ||
          scorePickerOption(left, normalizedQuery) - scorePickerOption(right, normalizedQuery)
        );
      })
      .filter((option) => scorePickerOption(option, normalizedQuery) < Number.POSITIVE_INFINITY)
      .map(({ priority: _priority, ...option }) => option);
  }
}

function scorePickerOption(option: PickerOption, normalizedQuery: string): number {
  if (option.action === "create-dataset") {
    return 0;
  }

  if (normalizedQuery.length === 0) {
    return 0;
  }

  const lowerLabel = option.label.toLocaleLowerCase("ja");
  const lowerDescription = option.description.toLocaleLowerCase("ja");

  if (lowerLabel.startsWith(normalizedQuery)) {
    return 0;
  }

  if (lowerLabel.includes(normalizedQuery)) {
    return 1;
  }

  if (lowerDescription.startsWith(normalizedQuery)) {
    return 2;
  }

  if (lowerDescription.includes(normalizedQuery)) {
    return 3;
  }

  return Number.POSITIVE_INFINITY;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatSlotFieldPickerEmptyMessage(slotFieldPicker: SlotFieldPickerState): string {
  return slotFieldPicker.kind === "input-dataset"
    ? "一致する dataset がありません。"
    : "一致する file がありません。";
}

function clampSlotFieldPopupCoordinate(
  value: number,
  panelSize: number,
  viewportSize: number
): number {
  return Math.max(12, Math.min(value, viewportSize - panelSize - 12));
}

function computeSlotFieldPopupLayout(coords: {
  bottom: number;
  top: number;
}): {
  maxHeight: number;
  y: number;
} {
  const preferredMaxHeight = 320;
  const margin = 12;
  const offset = 8;
  const minimumHeight = 96;
  const availableBelow = Math.max(0, window.innerHeight - coords.bottom - margin);
  const availableAbove = Math.max(0, coords.top - margin);
  const openBelow = availableBelow >= minimumHeight || availableBelow >= availableAbove;

  if (openBelow) {
    const maxHeight = Math.max(
      Math.min(preferredMaxHeight, availableBelow),
      Math.min(preferredMaxHeight, availableAbove, minimumHeight)
    );

    return {
      maxHeight,
      y: Math.max(margin, coords.bottom + offset)
    };
  }

  const maxHeight = Math.max(
    Math.min(preferredMaxHeight, availableAbove),
    Math.min(preferredMaxHeight, availableBelow, minimumHeight)
  );

  return {
    maxHeight,
    y: Math.max(margin, coords.top - maxHeight - offset)
  };
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
    return normalizeIpcErrorMessage(error.message);
  }

  return typeof error === "string" ? normalizeIpcErrorMessage(error) : "Unknown error";
}

function normalizeIpcErrorMessage(message: string): string {
  return message
    .replace(/^Error invoking remote method '[^']+': Error:\s*/u, "")
    .trim();
}
