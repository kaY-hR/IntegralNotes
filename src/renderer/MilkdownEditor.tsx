import { Crepe } from "@milkdown/crepe";
import { editorViewCtx, parserCtx } from "@milkdown/kit/core";
import { imageSchema, linkSchema } from "@milkdown/kit/preset/commonmark";
import { Slice } from "@milkdown/kit/prose/model";
import type { Selection } from "@milkdown/kit/prose/state";
import { Selection as ProseSelection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { insert, replaceAll } from "@milkdown/kit/utils";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState
} from "react";

import type {
  ExecuteIntegralBlockResult,
  IntegralAssetCatalog,
  IntegralBlockTypeDefinition
} from "../shared/integral";
import type {
  AiChatContextSummary,
  AiChatMessage,
  AiChatSkillInvocation,
  AiChatSkillSummary,
  AiChatStreamEvent,
  AiChatToolTraceEntry,
  InlinePythonBlockInsertion,
  PromptlessContinuationInsertion
} from "../shared/aiChat";
import {
  findActiveAiSkillTrigger,
  findExplicitAiSkillMentions,
  getAiSkillSuggestions,
  type AiSkillTextTrigger
} from "../shared/aiChatSkills";
import type { WorkspaceEntry, WorkspaceSnapshot } from "../shared/workspace";
import {
  resolveWorkspaceMarkdownTarget,
  toCanonicalWorkspaceTarget
} from "../shared/workspaceLinks";
import { installIntegralCodeBlockFeature } from "./integralCodeBlockFeature";
import {
  getAvailableIntegralBlockTypes,
  initializeIntegralPluginRuntime
} from "./integralPluginRuntime";
import {
  GENERAL_ANALYSIS_PLUGIN_ID,
  INTEGRAL_BLOCK_LANGUAGE,
  createInitialIntegralBlock,
  createPythonIntegralBlockMarkdown,
  parseIntegralBlockSource,
  serializeIntegralBlockContent,
  toIntegralCodeBlock
} from "./integralBlockRegistry";
import { AiMarkdown } from "./AiMarkdown";
import { AiSkillChips } from "./AiSkillChips";
import { AiSkillCompletionList } from "./AiSkillCompletionList";
import { installWorkspaceEmbedFeature } from "./workspaceEmbedFeature";

interface MilkdownEditorProps {
  analysisResultDirectory?: string | null;
  focusedBlockId?: string | null;
  initialValue: string;
  isActive: boolean;
  onChange: (markdown: string) => void;
  onFocusedBlockHandled?: () => void;
  onIntegralAssetCatalogChanged: (catalog: IntegralAssetCatalog) => void;
  onOpenWorkspaceFile: (target: string) => void;
  onWorkspaceSnapshotChanged: (snapshot: WorkspaceSnapshot, statusMessage?: string) => void;
  onWorkspaceLinkError: (message: string) => void;
  relativePath: string;
  selectedEntryPaths: string[];
  toolbar?: ReactNode;
  workspaceEntries: WorkspaceEntry[];
  workspaceRootName: string | null;
}

interface WorkspaceFileSuggestion {
  name: string;
  relativePath: string;
}

const INTEGRAL_ERROR_BLOCK_LANGUAGE = "integral-error";
const INTEGRAL_LOG_BLOCK_LANGUAGE = "integral-log";
const INTEGRAL_EXECUTION_LOG_LANGUAGE_PATTERN = `${INTEGRAL_ERROR_BLOCK_LANGUAGE}|${INTEGRAL_LOG_BLOCK_LANGUAGE}`;
const INTEGRAL_EXECUTION_LOG_EMBED_DIRECTORY = "integral-block-logs";
const INTEGRAL_EXECUTION_LOG_EMBED_PATTERN = `!\\[\\]\\([^\\r\\n)]*${INTEGRAL_EXECUTION_LOG_EMBED_DIRECTORY}/[^\\r\\n)]*\\.log(?:#integral-embed-height=\\d+)?\\)`;
const INTEGRAL_BLOCK_WITH_OPTIONAL_EXECUTION_LOG_PATTERN = new RegExp(
  `(\`\`\`itg-notes\\r?\\n([\\s\\S]*?)\\r?\\n\`\`\`)(?:(?:\\r?\\n){2}(?:(\`{3,})(?:${INTEGRAL_EXECUTION_LOG_LANGUAGE_PATTERN})\\r?\\n[\\s\\S]*?\\r?\\n\\3|${INTEGRAL_EXECUTION_LOG_EMBED_PATTERN}))?`,
  "gu"
);

interface LinkCompletionState {
  kind: "embed" | "link";
  maxHeight: number;
  query: string;
  replaceFrom: number;
  replaceTo: number;
  selectedIndex: number;
  x: number;
  y: number;
}

interface AnalysisCompletionState {
  maxHeight: number;
  query: string;
  replaceFrom: number;
  replaceTo: number;
  selectedIndex: number;
  x: number;
  y: number;
}

type InlineAiMode = "insert-text" | "python-block" | "promptless-continuation";
type InlineAiTriggerMarker = "??" | ">>" | "@@";

interface InlineAiPromptState {
  afterText: string;
  anchorPos: number;
  beforeText: string;
  documentMarkdown: string;
  error: string | null;
  isSubmitting: boolean;
  messages: AiChatMessage[];
  mode: InlineAiMode;
  prompt: string;
  sessionId: string | null;
  streamId: string | null;
  streamingText: string;
  streamingToolTrace: AiChatToolTraceEntry[];
  x: number;
  y: number;
}

interface InlineAiPopupDragState {
  height: number;
  offsetX: number;
  offsetY: number;
  pointerId: number;
  width: number;
}

interface InlineAiSkillCompletionState extends AiSkillTextTrigger {
  selectedIndex: number;
}

interface InlineAiTriggerState {
  afterText: string;
  beforeText: string;
  marker: InlineAiTriggerMarker;
  mode: InlineAiMode;
  replaceFrom: number;
  replaceTo: number;
  x: number;
  y: number;
}

const INLINE_AI_INSERTION_PREVIEW_FRAME_MS = 24;
const INLINE_AI_INSERTION_PREVIEW_TARGET_FRAMES = 64;
const INLINE_AI_INSERTION_PREVIEW_MIN_CHUNK_SIZE = 2;
const INLINE_AI_POPUP_WIDTH = 520;

export function MilkdownEditor({
  analysisResultDirectory,
  focusedBlockId,
  initialValue,
  isActive,
  onChange,
  onFocusedBlockHandled,
  onIntegralAssetCatalogChanged,
  onOpenWorkspaceFile,
  onWorkspaceSnapshotChanged,
  onWorkspaceLinkError,
  relativePath,
  selectedEntryPaths,
  toolbar,
  workspaceEntries,
  workspaceRootName
}: MilkdownEditorProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Crepe | null>(null);
  const inlineAiPopupRef = useRef<HTMLFormElement | null>(null);
  const inlineAiDragStateRef = useRef<InlineAiPopupDragState | null>(null);
  const analysisResultDirectoryRef = useRef<string | null>(analysisResultDirectory ?? null);
  const onChangeRef = useRef(onChange);
  const onFocusedBlockHandledRef = useRef(onFocusedBlockHandled);
  const onIntegralAssetCatalogChangedRef = useRef(onIntegralAssetCatalogChanged);
  const onOpenWorkspaceFileRef = useRef(onOpenWorkspaceFile);
  const onWorkspaceSnapshotChangedRef = useRef(onWorkspaceSnapshotChanged);
  const onWorkspaceLinkErrorRef = useRef(onWorkspaceLinkError);
  const isActiveRef = useRef(isActive);
  const lastSyncedMarkdownRef = useRef(initialValue);
  const focusedBlockIdRef = useRef(focusedBlockId ?? null);
  const linkCompletionRef = useRef<LinkCompletionState | null>(null);
  const analysisCompletionRef = useRef<AnalysisCompletionState | null>(null);
  const inlineAiPromptRef = useRef<InlineAiPromptState | null>(null);
  const inlineAiTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const activeInlineAiStreamIdRef = useRef<string | null>(null);
  const completionPanelRef = useRef<HTMLDivElement | null>(null);
  const focusClearTimerRef = useRef<number | null>(null);
  const selectedEntryPathsRef = useRef<string[]>(selectedEntryPaths);
  const workspaceFilesRef = useRef<WorkspaceFileSuggestion[]>(
    collectWorkspaceFileSuggestions(workspaceEntries)
  );
  const workspaceEntriesRef = useRef<WorkspaceEntry[]>(workspaceEntries);
  const workspaceRootNameRef = useRef<string | null>(workspaceRootName);
  const [linkCompletion, setLinkCompletion] = useState<LinkCompletionState | null>(null);
  const [analysisCompletion, setAnalysisCompletion] = useState<AnalysisCompletionState | null>(null);
  const [inlineAiPrompt, setInlineAiPrompt] = useState<InlineAiPromptState | null>(null);
  const [inlineAiSkillCompletion, setInlineAiSkillCompletion] =
    useState<InlineAiSkillCompletionState | null>(null);
  const [availableAiSkills, setAvailableAiSkills] = useState<AiChatSkillSummary[]>([]);

  useEffect(() => {
    analysisResultDirectoryRef.current = analysisResultDirectory ?? null;
  }, [analysisResultDirectory]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onFocusedBlockHandledRef.current = onFocusedBlockHandled;
  }, [onFocusedBlockHandled]);

  useEffect(() => {
    onIntegralAssetCatalogChangedRef.current = onIntegralAssetCatalogChanged;
  }, [onIntegralAssetCatalogChanged]);

  useEffect(() => {
    onOpenWorkspaceFileRef.current = onOpenWorkspaceFile;
  }, [onOpenWorkspaceFile]);

  useEffect(() => {
    onWorkspaceSnapshotChangedRef.current = onWorkspaceSnapshotChanged;
  }, [onWorkspaceSnapshotChanged]);

  useEffect(() => {
    onWorkspaceLinkErrorRef.current = onWorkspaceLinkError;
  }, [onWorkspaceLinkError]);

  useEffect(() => {
    isActiveRef.current = isActive;

    if (!isActive) {
      setLinkCompletion(null);
      setAnalysisCompletion(null);
      activeInlineAiStreamIdRef.current = null;
      inlineAiDragStateRef.current = null;
      setInlineAiSkillCompletion(null);
      setInlineAiPrompt(null);
    }
  }, [isActive]);

  useEffect(() => {
    const nextWorkspaceFiles = collectWorkspaceFileSuggestions(workspaceEntries);
    workspaceFilesRef.current = nextWorkspaceFiles;
    workspaceEntriesRef.current = workspaceEntries;
  }, [workspaceEntries]);

  useEffect(() => {
    selectedEntryPathsRef.current = selectedEntryPaths;
  }, [selectedEntryPaths]);

  useEffect(() => {
    workspaceRootNameRef.current = workspaceRootName;
  }, [workspaceRootName]);

  useEffect(() => {
    let cancelled = false;

    const loadAvailableAiSkills = async (): Promise<void> => {
      try {
        const status = await window.integralNotes.getAiChatStatus();

        if (!cancelled) {
          setAvailableAiSkills(status.availableSkills);
        }
      } catch {
        if (!cancelled) {
          setAvailableAiSkills([]);
        }
      }
    };

    void loadAvailableAiSkills();

    return () => {
      cancelled = true;
    };
  }, [workspaceRootName]);

  useEffect(() => {
    linkCompletionRef.current = linkCompletion;
  }, [linkCompletion]);

  useEffect(() => {
    analysisCompletionRef.current = analysisCompletion;
  }, [analysisCompletion]);

  useEffect(() => {
    inlineAiPromptRef.current = inlineAiPrompt;
  }, [inlineAiPrompt]);

  useEffect(() => {
    return window.integralNotes.onAiChatStreamEvent((event: AiChatStreamEvent) => {
      if (event.id !== activeInlineAiStreamIdRef.current) {
        return;
      }

      setInlineAiPrompt((current) => {
        if (!current || current.streamId !== event.id) {
          return current;
        }

        let next = current;

        switch (event.type) {
          case "text-delta":
            if (event.textDelta) {
              next = {
                ...current,
                streamingText: `${current.streamingText}${event.textDelta}`
              };
            }
            break;
          case "text-reset":
            next = {
              ...current,
              streamingText: ""
            };
            break;
          case "tool-trace":
            if (event.toolTrace?.length) {
              next = {
                ...current,
                streamingToolTrace: [...current.streamingToolTrace, ...(event.toolTrace ?? [])]
              };
            }
            break;
          case "error":
            next = {
              ...current,
              error: event.message ?? "Inline AI streaming failed."
            };
            break;
          default:
            break;
        }

        inlineAiPromptRef.current = next;
        return next;
      });
    });
  }, []);

  useEffect(() => {
    if (!inlineAiPrompt || inlineAiPrompt.mode === "promptless-continuation") {
      return;
    }

    window.setTimeout(() => {
      inlineAiTextareaRef.current?.focus();
    }, 0);
  }, [inlineAiPrompt?.anchorPos, inlineAiPrompt?.mode]);

  useEffect(() => {
    focusedBlockIdRef.current = focusedBlockId ?? null;
  }, [focusedBlockId]);

  useEffect(() => {
    const completionPanel = completionPanelRef.current;

    if (!completionPanel || (!linkCompletion && !analysisCompletion)) {
      return;
    }

    const selectedItem = completionPanel.querySelector<HTMLElement>(
      ".editor-link-completion__item--selected"
    );

    selectedItem?.scrollIntoView({
      block: "nearest"
    });
  }, [analysisCompletion, linkCompletion]);

  useEffect(() => {
    const rootElement = rootRef.current;

    if (!rootElement) {
      return;
    }

    let shouldDestroyAfterCreate = false;
    let editor: Crepe | null = null;

    void (async () => {
      try {
        await initializeIntegralPluginRuntime();
      } catch (error) {
        console.error("Failed to initialize plugin runtime.", error);
      }

      if (shouldDestroyAfterCreate) {
        return;
      }

      const handleImageUpload = async (file: File): Promise<string> => {
        try {
          const content = new Uint8Array(await file.arrayBuffer());
          const result = await window.integralNotes.saveNoteImage(
            {
              contentType: file.type,
              originalFileName: file.name
            },
            content
          );

          onWorkspaceSnapshotChangedRef.current(result.snapshot);
          return result.markdownTarget;
        } catch (error) {
          const message = toErrorMessage(error);
          onWorkspaceLinkErrorRef.current(message);
          throw error;
        }
      };

      const proxyImageUrl = async (url: string): Promise<string> => {
        const relativePath = resolveWorkspaceMarkdownTarget(url);

        if (!relativePath) {
          return url;
        }

        try {
          return await window.integralNotes.resolveWorkspaceFileUrl(relativePath);
        } catch {
          return url;
        }
      };

      editor = new Crepe({
        featureConfigs: {
          [Crepe.Feature.ImageBlock]: {
            onUpload: handleImageUpload,
            proxyDomURL: proxyImageUrl
          }
        },
        root: rootElement,
        defaultValue: initialValue
      });

      installIntegralCodeBlockFeature(editor, {
        getAnalysisResultDirectory: () => analysisResultDirectoryRef.current,
        getWorkspaceEntries: () => workspaceEntriesRef.current,
        onExecuteBlockError: ({ errorMessage }) => {
          onWorkspaceLinkErrorRef.current(errorMessage);
        },
        onExecuteBlockResult: ({ previousBlockSource, result }) => {
          const nextMarkdown = applyIntegralExecutionResultToMarkdown(
            editor.getMarkdown(),
            previousBlockSource,
            result
          );

          if (nextMarkdown === null) {
            onWorkspaceLinkErrorRef.current("実行結果を現在のノートへ反映できませんでした。");
            return;
          }

          editor?.editor.action((ctx) => {
            replaceAll(nextMarkdown)(ctx);
          });
          lastSyncedMarkdownRef.current = nextMarkdown;
          onChangeRef.current(nextMarkdown);
        },
        sourceNotePath: relativePath
      });
      installWorkspaceEmbedFeature(editor, {
        uploadImage: handleImageUpload
      });

      await editor.create();

      if (shouldDestroyAfterCreate) {
        void editor.destroy();
        return;
      }

      editor.on((listener) => {
        listener.markdownUpdated((_ctx, markdown) => {
          lastSyncedMarkdownRef.current = markdown;
          onChangeRef.current(markdown);
        });
        listener.selectionUpdated((ctx, selection) => {
          if (!isActiveRef.current) {
            setLinkCompletion(null);
            setAnalysisCompletion(null);
            return;
          }

          const view = ctx.get(editorViewCtx);
          const inlineTrigger = computeInlineAiTriggerState(view, selection);

          if (inlineTrigger && !inlineAiPromptRef.current) {
            if (inlineTrigger.mode === "promptless-continuation") {
              startPromptlessContinuation(view, inlineTrigger);
            } else {
              openInlineAiPrompt(view, inlineTrigger);
            }
            return;
          }

          if (inlineAiPromptRef.current) {
            setLinkCompletion(null);
            setAnalysisCompletion(null);
            return;
          }

          setLinkCompletion(computeLinkCompletionState(view, selection));
          setAnalysisCompletion(computeAnalysisCompletionState(view, selection));
        });
        listener.blur(() => {
          setLinkCompletion(null);
          setAnalysisCompletion(null);
        });
      });

      editorRef.current = editor;
      window.setTimeout(() => {
        focusPendingIntegralBlock();
      }, 0);
    })();

    return () => {
      shouldDestroyAfterCreate = true;

      if (editorRef.current === editor) {
        editorRef.current = null;
        void editor.destroy();
      }

      if (focusClearTimerRef.current !== null) {
        window.clearTimeout(focusClearTimerRef.current);
        focusClearTimerRef.current = null;
      }
    };
  }, [relativePath]);

  useEffect(() => {
    const editor = editorRef.current;

    if (!editor || initialValue === lastSyncedMarkdownRef.current) {
      return;
    }

    editor.editor.action((ctx) => {
      replaceAll(initialValue)(ctx);
    });
    lastSyncedMarkdownRef.current = initialValue;
  }, [initialValue]);

  useEffect(() => {
    const rootElement = rootRef.current;

    if (!rootElement) {
      return;
    }

    const handleEditorKeyDown = (event: KeyboardEvent): void => {
      if (!isActiveRef.current) {
        return;
      }

      const analysisState = analysisCompletionRef.current;

      if (analysisState) {
        const suggestions = getVisibleIntegralBlockSuggestions(
          getAvailableIntegralBlockTypes(),
          analysisState.query
        );

        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setAnalysisCompletion(null);
          return;
        }

        if (suggestions.length === 0) {
          return;
        }

        if (event.key === "ArrowDown") {
          event.preventDefault();
          event.stopPropagation();
          setAnalysisCompletion((current) =>
            current
              ? {
                  ...current,
                  selectedIndex: (current.selectedIndex + 1) % suggestions.length
                }
              : current
          );
          return;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          setAnalysisCompletion((current) =>
            current
              ? {
                  ...current,
                  selectedIndex: (current.selectedIndex - 1 + suggestions.length) % suggestions.length
                }
              : current
          );
          return;
        }

        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          event.stopPropagation();
          const selectedSuggestion =
            suggestions[Math.min(analysisState.selectedIndex, suggestions.length - 1)];

          if (selectedSuggestion) {
            insertIntegralBlock(selectedSuggestion);
          }
        }

        return;
      }

      const completionState = linkCompletionRef.current;

      if (!completionState) {
        return;
      }

      const matches = getVisibleWorkspaceFileSuggestions(
        workspaceFilesRef.current,
        completionState.query
      );

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setLinkCompletion(null);
        return;
      }

      if (matches.length === 0) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        setLinkCompletion((current) =>
          current
            ? {
                ...current,
                selectedIndex: (current.selectedIndex + 1) % matches.length
              }
            : current
        );
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setLinkCompletion((current) =>
          current
            ? {
                ...current,
                selectedIndex: (current.selectedIndex - 1 + matches.length) % matches.length
              }
            : current
        );
        return;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        const selectedCandidate =
          matches[Math.min(completionState.selectedIndex, matches.length - 1)];

        if (selectedCandidate) {
          if (completionState.kind === "embed") {
            insertWorkspaceEmbed(selectedCandidate);
          } else {
            insertWorkspaceLink(selectedCandidate);
          }
        }
      }
    };

    const handleEditorClick = (event: MouseEvent): void => {
      const target = event.target;

      if (!(target instanceof HTMLElement)) {
        return;
      }

      const anchor = target.closest("a[href]");

      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      const rawTarget = anchor.getAttribute("href");

      if (!rawTarget) {
        return;
      }

      const relativePath = resolveWorkspaceMarkdownTarget(rawTarget);

      if (!relativePath) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      onOpenWorkspaceFileRef.current(rawTarget);
    };

    rootElement.addEventListener("keydown", handleEditorKeyDown, true);
    rootElement.addEventListener("click", handleEditorClick);

    return () => {
      rootElement.removeEventListener("keydown", handleEditorKeyDown, true);
      rootElement.removeEventListener("click", handleEditorClick);
    };
  }, []);

  const visibleSuggestions = linkCompletion
    ? getVisibleWorkspaceFileSuggestions(workspaceFilesRef.current, linkCompletion.query)
    : [];
  const selectedSuggestionIndex =
    visibleSuggestions.length === 0
      ? -1
      : Math.min(linkCompletion?.selectedIndex ?? 0, visibleSuggestions.length - 1);
  const visibleIntegralBlockSuggestions = analysisCompletion
    ? getVisibleIntegralBlockSuggestions(getAvailableIntegralBlockTypes(), analysisCompletion.query)
    : [];
  const selectedIntegralBlockSuggestionIndex =
    visibleIntegralBlockSuggestions.length === 0
      ? -1
      : Math.min(
          analysisCompletion?.selectedIndex ?? 0,
          visibleIntegralBlockSuggestions.length - 1
        );
  const visibleInlineAiSkillSuggestions = inlineAiSkillCompletion
    ? getAiSkillSuggestions(availableAiSkills, inlineAiSkillCompletion.query)
    : [];
  const selectedInlineAiSkillSuggestionIndex =
    visibleInlineAiSkillSuggestions.length === 0
      ? -1
      : Math.min(
          inlineAiSkillCompletion?.selectedIndex ?? 0,
          visibleInlineAiSkillSuggestions.length - 1
        );

  const openInlineAiPrompt = (view: EditorView, trigger: InlineAiTriggerState): void => {
    const nextPrompt: InlineAiPromptState = {
      afterText: trigger.afterText,
      anchorPos: trigger.replaceFrom,
      beforeText: trigger.beforeText,
      documentMarkdown: lastSyncedMarkdownRef.current,
      error: null,
      isSubmitting: false,
      messages: [],
      mode: trigger.mode,
      prompt: "",
      sessionId: null,
      streamId: null,
      streamingText: "",
      streamingToolTrace: [],
      x: trigger.x,
      y: trigger.y
    };

    inlineAiPromptRef.current = nextPrompt;
    setInlineAiPrompt(nextPrompt);
    setInlineAiSkillCompletion(null);
    setLinkCompletion(null);
    setAnalysisCompletion(null);

    const transaction = view.state.tr.delete(trigger.replaceFrom, trigger.replaceTo);
    transaction.setSelection(TextSelection.create(transaction.doc, trigger.replaceFrom));
    view.dispatch(transaction.scrollIntoView());
  };

  const startPromptlessContinuation = (view: EditorView, trigger: InlineAiTriggerState): void => {
    const streamId = createInlineAiStreamId();
    const nextPrompt: InlineAiPromptState = {
      afterText: trigger.afterText,
      anchorPos: trigger.replaceFrom,
      beforeText: trigger.beforeText,
      documentMarkdown: lastSyncedMarkdownRef.current,
      error: null,
      isSubmitting: true,
      messages: [],
      mode: "promptless-continuation",
      prompt: "",
      sessionId: null,
      streamId,
      streamingText: "",
      streamingToolTrace: [],
      x: trigger.x,
      y: trigger.y
    };

    inlineAiPromptRef.current = nextPrompt;
    activeInlineAiStreamIdRef.current = streamId;
    setInlineAiPrompt(nextPrompt);
    setInlineAiSkillCompletion(null);
    setLinkCompletion(null);
    setAnalysisCompletion(null);

    const transaction = view.state.tr.delete(trigger.replaceFrom, trigger.replaceTo);
    transaction.setSelection(TextSelection.create(transaction.doc, trigger.replaceFrom));
    view.dispatch(transaction.scrollIntoView());

    void submitPromptlessContinuation(nextPrompt);
  };

  const closeInlineAiPrompt = (): void => {
    if (inlineAiPromptRef.current?.isSubmitting) {
      return;
    }

    inlineAiDragStateRef.current = null;
    inlineAiPromptRef.current = null;
    activeInlineAiStreamIdRef.current = null;
    setInlineAiSkillCompletion(null);
    setInlineAiPrompt(null);
    editorRef.current?.editor.action((ctx) => {
      ctx.get(editorViewCtx).focus();
    });
  };

  const syncInlineAiSkillCompletion = (prompt: string, cursorPosition: number): void => {
    const trigger = findActiveAiSkillTrigger(prompt, cursorPosition);

    if (!trigger) {
      setInlineAiSkillCompletion(null);
      return;
    }

    setInlineAiSkillCompletion((current) => ({
      ...trigger,
      selectedIndex:
        current &&
        current.replaceFrom === trigger.replaceFrom &&
        current.replaceTo === trigger.replaceTo
          ? current.selectedIndex
          : 0
    }));
  };

  const updateInlineAiPrompt = (prompt: string, cursorPosition?: number): void => {
    setInlineAiPrompt((current) => {
      if (!current) {
        return current;
      }

      const next = { ...current, error: null, prompt };
      inlineAiPromptRef.current = next;
      return next;
    });
    syncInlineAiSkillCompletion(prompt, cursorPosition ?? prompt.length);
  };

  const updateInlineAiPromptPosition = (x: number, y: number): void => {
    setInlineAiPrompt((current) => {
      if (!current) {
        return current;
      }

      const next = { ...current, x, y };
      inlineAiPromptRef.current = next;
      return next;
    });
  };

  const insertInlineAiSkill = (skill: AiChatSkillSummary): void => {
    const current = inlineAiPromptRef.current;
    const completion = inlineAiSkillCompletion;

    if (!current || !completion) {
      return;
    }

    const beforeText = current.prompt.slice(0, completion.replaceFrom);
    const afterText = current.prompt.slice(completion.replaceTo);
    const insertion = `$${skill.name}${afterText.length === 0 || !/^\s/u.test(afterText) ? " " : ""}`;
    const nextPrompt = `${beforeText}${insertion}${afterText}`;
    const nextCursorPosition = beforeText.length + insertion.length;

    setInlineAiSkillCompletion(null);
    updateInlineAiPrompt(nextPrompt, nextCursorPosition);
    setInlineAiSkillCompletion(null);
    window.requestAnimationFrame(() => {
      const textarea = inlineAiTextareaRef.current;

      if (!textarea) {
        return;
      }

      textarea.focus();
      textarea.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  };

  const handleInlineAiPromptKeyDown = (
    event: ReactKeyboardEvent<HTMLTextAreaElement>
  ): void => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      setInlineAiSkillCompletion(null);
      void submitInlineAiPrompt();
      return;
    }

    if (inlineAiSkillCompletion) {
      if (event.key === "Escape") {
        event.preventDefault();
        setInlineAiSkillCompletion(null);
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();

        if (visibleInlineAiSkillSuggestions.length === 0) {
          return;
        }

        const direction = event.key === "ArrowDown" ? 1 : -1;
        setInlineAiSkillCompletion((current) =>
          current
            ? {
                ...current,
                selectedIndex:
                  (selectedInlineAiSkillSuggestionIndex +
                    direction +
                    visibleInlineAiSkillSuggestions.length) %
                  visibleInlineAiSkillSuggestions.length
              }
            : current
        );
        return;
      }

      if (
        (event.key === "Enter" || event.key === "Tab") &&
        selectedInlineAiSkillSuggestionIndex >= 0
      ) {
        const selectedSkill = visibleInlineAiSkillSuggestions[selectedInlineAiSkillSuggestionIndex];

        if (!selectedSkill) {
          return;
        }

        event.preventDefault();
        insertInlineAiSkill(selectedSkill);
        return;
      }
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeInlineAiPrompt();
    }
  };

  const startInlineAiPopupDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!event.isPrimary || event.button !== 0) {
      return;
    }

    const target = event.target;

    if (target instanceof HTMLElement && target.closest("button")) {
      return;
    }

    const popupElement = inlineAiPopupRef.current;

    if (!popupElement) {
      return;
    }

    const popupRect = popupElement.getBoundingClientRect();
    inlineAiDragStateRef.current = {
      height: popupRect.height,
      offsetX: event.clientX - popupRect.left,
      offsetY: event.clientY - popupRect.top,
      pointerId: event.pointerId,
      width: popupRect.width
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveInlineAiPopupDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const dragState = inlineAiDragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    updateInlineAiPromptPosition(
      clampPopupCoordinate(event.clientX - dragState.offsetX, dragState.width, window.innerWidth),
      clampPopupCoordinate(event.clientY - dragState.offsetY, dragState.height, window.innerHeight)
    );
    event.preventDefault();
  };

  const stopInlineAiPopupDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const dragState = inlineAiDragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    inlineAiDragStateRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const playInlineAiInsertionPreview = async (
    streamId: string,
    markdown: string
  ): Promise<boolean> => {
    const previewText = markdown.trim();

    if (previewText.length === 0) {
      return true;
    }

    const chunkSize = Math.max(
      INLINE_AI_INSERTION_PREVIEW_MIN_CHUNK_SIZE,
      Math.ceil(previewText.length / INLINE_AI_INSERTION_PREVIEW_TARGET_FRAMES)
    );

    for (
      let visibleLength = chunkSize;
      visibleLength < previewText.length;
      visibleLength += chunkSize
    ) {
      const current = inlineAiPromptRef.current;

      if (
        !current ||
        current.streamId !== streamId ||
        activeInlineAiStreamIdRef.current !== streamId
      ) {
        return false;
      }

      const next = {
        ...current,
        streamingText: previewText.slice(0, visibleLength)
      };

      inlineAiPromptRef.current = next;
      setInlineAiPrompt(next);

      await waitInlineAiInsertionPreviewFrame();
    }

    const current = inlineAiPromptRef.current;

    if (
      !current ||
      current.streamId !== streamId ||
      activeInlineAiStreamIdRef.current !== streamId
    ) {
      return false;
    }

    const next = {
      ...current,
      streamingText: previewText
    };

    inlineAiPromptRef.current = next;
    setInlineAiPrompt(next);
    await waitInlineAiInsertionPreviewFrame();

    return true;
  };

  const submitInlineAiPrompt = async (): Promise<void> => {
    const current = inlineAiPromptRef.current;
    const editor = editorRef.current;

    if (!current || !editor || current.isSubmitting || current.prompt.trim().length === 0) {
      return;
    }

    const requestedSkills = findExplicitAiSkillMentions(current.prompt, availableAiSkills);
    const streamId = createInlineAiStreamId();
    const submittingState = {
      ...current,
      error: null,
      isSubmitting: true,
      streamId,
      streamingText: "",
      streamingToolTrace: []
    };

    activeInlineAiStreamIdRef.current = streamId;
    inlineAiPromptRef.current = submittingState;
    setInlineAiSkillCompletion(null);
    setInlineAiPrompt(submittingState);

    try {
      if (current.mode === "insert-text") {
        const result = await window.integralNotes.submitInlineAiInsertion({
          afterText: current.afterText,
          beforeText: current.beforeText,
          context: buildInlineAiContextSummary(current),
          documentMarkdown: current.documentMarkdown,
          history: current.messages,
          insertionPosition: current.anchorPos,
          prompt: current.prompt,
          requestedSkills,
          sessionId: current.sessionId,
          sourceNotePath: relativePath,
          streamId
        });
        const nextMessages = [...current.messages, result.userMessage, ...result.messages];

        if (!result.insertion) {
          const nextState = {
            ...current,
            error: null,
            isSubmitting: false,
            messages: nextMessages,
            prompt: "",
            sessionId: result.sessionId,
            streamId: null,
            streamingText: "",
            streamingToolTrace: []
          };

          activeInlineAiStreamIdRef.current = null;
          inlineAiPromptRef.current = nextState;
          setInlineAiPrompt(nextState);
          return;
        }

        const shouldInsert = await playInlineAiInsertionPreview(streamId, result.insertion.text);

        if (!shouldInsert) {
          return;
        }

        insertMarkdownAtPosition(
          current.anchorPos,
          prependInlineAiTranscript(
            result.insertion.text,
            buildInlineAiTranscript(nextMessages)
          ),
          {
            marker: "??",
            originalAfterText: current.afterText
          }
        );
      } else {
        const result = await window.integralNotes.submitInlinePythonBlock({
          afterText: current.afterText,
          beforeText: current.beforeText,
          context: buildInlineAiContextSummary(current),
          documentMarkdown: current.documentMarkdown,
          history: current.messages,
          insertionPosition: current.anchorPos,
          prompt: current.prompt,
          requestedSkills,
          sessionId: current.sessionId,
          sourceNotePath: relativePath,
          streamId
        });
        const nextMessages = [...current.messages, result.userMessage, ...result.messages];

        if (!result.insertion) {
          const nextState = {
            ...current,
            error: null,
            isSubmitting: false,
            messages: nextMessages,
            prompt: "",
            sessionId: result.sessionId,
            streamId: null,
            streamingText: "",
            streamingToolTrace: []
          };

          activeInlineAiStreamIdRef.current = null;
          inlineAiPromptRef.current = nextState;
          setInlineAiPrompt(nextState);
          return;
        }

        await insertInlinePythonBlockResult(
          current.anchorPos,
          result.insertion,
          current.afterText,
          buildInlineAiTranscript(nextMessages)
        );
      }

      inlineAiPromptRef.current = null;
      activeInlineAiStreamIdRef.current = null;
      setInlineAiPrompt(null);
    } catch (error) {
      const nextState = {
        ...current,
        error: toErrorMessage(error),
        isSubmitting: false,
        streamId: null,
        streamingText: "",
        streamingToolTrace: []
      };

      activeInlineAiStreamIdRef.current = null;
      inlineAiPromptRef.current = nextState;
      setInlineAiPrompt(nextState);
    }
  };

  const submitPromptlessContinuation = async (
    current: InlineAiPromptState
  ): Promise<void> => {
    const editor = editorRef.current;
    const streamId = current.streamId;

    if (!editor || current.mode !== "promptless-continuation" || !streamId) {
      return;
    }

    try {
      const result = await window.integralNotes.submitPromptlessContinuation({
        afterText: current.afterText,
        beforeText: current.beforeText,
        context: buildInlineAiContextSummary(current),
        documentMarkdown: current.documentMarkdown,
        history: current.messages,
        insertionPosition: current.anchorPos,
        sessionId: current.sessionId,
        sourceNotePath: relativePath,
        streamId
      });
      const nextMessages = [...current.messages, result.userMessage, ...result.messages];

      if (!result.insertion) {
        const nextState = {
          ...current,
          error: "AI が挿入内容を確定しませんでした。必要なら ?? で明示的に指示してください。",
          isSubmitting: false,
          messages: nextMessages,
          sessionId: result.sessionId,
          streamId: null,
          streamingText: "",
          streamingToolTrace: []
        };

        activeInlineAiStreamIdRef.current = null;
        inlineAiPromptRef.current = nextState;
        setInlineAiPrompt(nextState);
        return;
      }

      await insertPromptlessContinuationResult(
        current.anchorPos,
        result.insertion,
        current.afterText,
        streamId
      );

      inlineAiPromptRef.current = null;
      activeInlineAiStreamIdRef.current = null;
      setInlineAiPrompt(null);
    } catch (error) {
      const nextState = {
        ...current,
        error: toErrorMessage(error),
        isSubmitting: false,
        streamId: null,
        streamingText: "",
        streamingToolTrace: []
      };

      activeInlineAiStreamIdRef.current = null;
      inlineAiPromptRef.current = nextState;
      setInlineAiPrompt(nextState);
    }
  };

  const insertPromptlessContinuationResult = async (
    anchorPos: number,
    insertion: PromptlessContinuationInsertion,
    originalAfterText: string,
    streamId: string
  ): Promise<void> => {
    if (insertion.kind === "markdown") {
      const shouldInsert = await playInlineAiInsertionPreview(streamId, insertion.markdown.text);

      if (!shouldInsert) {
        return;
      }

      insertMarkdownAtPosition(anchorPos, insertion.markdown.text, {
        marker: "@@",
        originalAfterText
      });
      return;
    }

    await insertInlinePythonBlockResult(
      anchorPos,
      insertion.pythonBlock,
      originalAfterText,
      "",
      "@@"
    );
  };

  const insertMarkdownAtPosition = (
    position: number,
    markdown: string,
    triggerCleanup?: { marker: InlineAiTriggerMarker; originalAfterText: string }
  ): void => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    editor.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const parsedDocument = ctx.get(parserCtx)(markdown);

      if (!parsedDocument) {
        return;
      }

      const from = Math.max(0, Math.min(position, view.state.doc.content.size));
      let to = from;

      if (triggerCleanup && !triggerCleanup.originalAfterText.startsWith(triggerCleanup.marker)) {
        const markerTo = Math.min(
          from + triggerCleanup.marker.length,
          view.state.doc.content.size
        );
        const markerAtPosition = view.state.doc.textBetween(from, markerTo, "\n", "\0");

        if (markerAtPosition === triggerCleanup.marker) {
          to = markerTo;
        }
      }

      const insertedSlice = new Slice(parsedDocument.content, 0, 0);
      const transaction = view.state.tr.replaceRange(from, to, insertedSlice);
      const nextSelectionPosition = Math.min(
        from + insertedSlice.size,
        transaction.doc.content.size
      );
      transaction.setSelection(
        ProseSelection.near(transaction.doc.resolve(nextSelectionPosition), -1)
      );
      view.dispatch(transaction.scrollIntoView());
      view.focus();
    });
  };

  const insertInlinePythonBlockResult = async (
    anchorPos: number,
    insertion: InlinePythonBlockInsertion,
    originalAfterText: string,
    transcript: string,
    marker: InlineAiTriggerMarker = ">>"
  ): Promise<void> => {
    const snapshot = await window.integralNotes.syncWorkspace();

    if (snapshot) {
      onWorkspaceSnapshotChangedRef.current(
        snapshot,
        `${insertion.scriptPath} を AI で作成しました`
      );
    }

    const catalog = await window.integralNotes.getIntegralAssetCatalog();
    onIntegralAssetCatalogChangedRef.current(catalog);

    const blockType = `${insertion.scriptPath}:${insertion.functionName}`;
    const definition =
      catalog.blockTypes.find(
        (candidate) =>
          candidate.pluginId === GENERAL_ANALYSIS_PLUGIN_ID && candidate.blockType === blockType
      ) ?? null;
    const blockMarkdown = definition
      ? toIntegralCodeBlock(
          serializeIntegralBlockContent(
            createInitialIntegralBlock(definition, {
              outputRoot: analysisResultDirectoryRef.current
            })
          )
        )
      : createPythonIntegralBlockMarkdown(blockType, {
          outputRoot: analysisResultDirectoryRef.current
        });

    insertMarkdownAtPosition(
      anchorPos,
      prependInlineAiTranscript(blockMarkdown, transcript),
      {
        marker,
        originalAfterText
      }
    );
  };

  const buildInlineAiContextSummary = (state: InlineAiPromptState): AiChatContextSummary => ({
    activeDocumentExcerpt: buildInlineAiExcerpt(state),
    activeDocumentKind: "markdown",
    activeDocumentName: getFileName(relativePath),
    activeRelativePath: relativePath,
    selectedPaths: selectedEntryPathsRef.current,
    workspaceRootName: workspaceRootNameRef.current
  });

  const insertWorkspaceLink = (suggestion: WorkspaceFileSuggestion): void => {
    const editor = editorRef.current;
    const completionState = linkCompletionRef.current;

    if (!editor || !completionState) {
      return;
    }

    const label = toWorkspaceLinkLabel(suggestion.name);
    const href = toCanonicalWorkspaceTarget(suggestion.relativePath);

    editor.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const markType = linkSchema.type(ctx);
      const transaction = view.state.tr.insertText(
        label,
        completionState.replaceFrom,
        completionState.replaceTo
      );
      const mark = markType.create({
        href,
        title: null
      });

      transaction.addMark(
        completionState.replaceFrom,
        completionState.replaceFrom + label.length,
        mark
      );
      transaction.setSelection(
        TextSelection.create(transaction.doc, completionState.replaceFrom + label.length)
      );
      view.dispatch(transaction.scrollIntoView());
      view.focus();
    });

    setLinkCompletion(null);
  };

  const insertWorkspaceEmbed = (suggestion: WorkspaceFileSuggestion): void => {
    const editor = editorRef.current;
    const completionState = linkCompletionRef.current;

    if (!editor || !completionState) {
      return;
    }

    const href = toCanonicalWorkspaceTarget(suggestion.relativePath);

    editor.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const imageNode = imageSchema.type(ctx).create({
        alt: "",
        src: href,
        title: ""
      });

      const transaction = view.state.tr.replaceWith(
        completionState.replaceFrom,
        completionState.replaceTo,
        imageNode
      );
      const cursorPosition = Math.min(
        completionState.replaceFrom + imageNode.nodeSize,
        transaction.doc.content.size
      );

      transaction.setSelection(TextSelection.create(transaction.doc, cursorPosition));
      view.dispatch(transaction.scrollIntoView());
      view.focus();
    });

    setLinkCompletion(null);
  };

  const insertIntegralBlock = (definition: IntegralBlockTypeDefinition): void => {
    const editor = editorRef.current;
    const completionState = analysisCompletionRef.current;

    if (!editor || !completionState) {
      return;
    }

    const block = createInitialIntegralBlock(definition, {
      outputRoot: analysisResultDirectoryRef.current
    });
    const blockMarkdown = toIntegralCodeBlock(serializeIntegralBlockContent(block));

    editor.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const transaction = view.state.tr.delete(completionState.replaceFrom, completionState.replaceTo);
      transaction.setSelection(TextSelection.create(transaction.doc, completionState.replaceFrom));
      view.dispatch(transaction.scrollIntoView());
      insert(blockMarkdown)(ctx);
    });

    analysisCompletionRef.current = null;
    setAnalysisCompletion(null);
    window.setTimeout(() => {
      focusInsertedIntegralBlockField(block.id ?? "");
    }, 0);
  };

  const focusInsertedIntegralBlockField = (blockId: string, attempt = 0): void => {
    const rootElement = rootRef.current;

    if (!blockId || !rootElement) {
      return;
    }

    const blockElement = findIntegralBlockElement(rootElement, blockId);

    if (!blockElement) {
      if (attempt < 16) {
        window.setTimeout(() => {
          focusInsertedIntegralBlockField(blockId, attempt + 1);
        }, 40);
      }

      return;
    }

    clearFocusedIntegralBlocks(rootElement);
    blockElement.classList.add("integral-code-block--focused");
    blockElement.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });

    const focusTarget =
      blockElement.querySelector<HTMLElement>('[data-integral-focus-target="primary"]') ??
      blockElement.querySelector<HTMLElement>("input, textarea, button, select");

    if (focusTarget) {
      focusTarget.focus({
        preventScroll: true
      });
    }

    if (focusClearTimerRef.current !== null) {
      window.clearTimeout(focusClearTimerRef.current);
    }

    focusClearTimerRef.current = window.setTimeout(() => {
      blockElement.classList.remove("integral-code-block--focused");
      focusClearTimerRef.current = null;
    }, 2200);
  };

  const focusPendingIntegralBlock = (): void => {
    const blockId = focusedBlockIdRef.current?.trim() ?? "";
    const rootElement = rootRef.current;

    if (!blockId || !rootElement || !editorRef.current) {
      return;
    }

    clearFocusedIntegralBlocks(rootElement);
    const blockElement = findIntegralBlockElement(rootElement, blockId);

    if (!blockElement) {
      onFocusedBlockHandledRef.current?.();
      return;
    }

    blockElement.classList.add("integral-code-block--focused");
    blockElement.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });

    if (focusClearTimerRef.current !== null) {
      window.clearTimeout(focusClearTimerRef.current);
    }

    focusClearTimerRef.current = window.setTimeout(() => {
      blockElement.classList.remove("integral-code-block--focused");
      focusClearTimerRef.current = null;
    }, 2200);

    onFocusedBlockHandledRef.current?.();
  };

  useEffect(() => {
    if (!focusedBlockId || !isActive) {
      return;
    }

    const timer = window.setTimeout(() => {
      focusPendingIntegralBlock();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [focusedBlockId, initialValue, isActive]);

  const inlineAiPromptSkills: AiChatSkillInvocation[] = inlineAiPrompt
    ? findExplicitAiSkillMentions(inlineAiPrompt.prompt, availableAiSkills)
    : [];

  return (
    <div className="editor-shell">
      {toolbar ? <div className="editor-toolbar">{toolbar}</div> : null}
      <div
        className="editor-surface"
        ref={rootRef}
      />
      {inlineAiPrompt ? (
        <form
          className="editor-ai-popup"
          onSubmit={(event) => {
            event.preventDefault();
            void submitInlineAiPrompt();
          }}
          ref={inlineAiPopupRef}
          style={{
            left: `${inlineAiPrompt.x}px`,
            top: `${inlineAiPrompt.y}px`
          }}
        >
          <div
            className="editor-ai-popup__header"
            onPointerCancel={stopInlineAiPopupDrag}
            onPointerDown={startInlineAiPopupDrag}
            onPointerMove={moveInlineAiPopupDrag}
            onPointerUp={stopInlineAiPopupDrag}
          >
            <strong>
              {inlineAiPrompt.mode === "insert-text"
                ? "AI 挿入"
                : inlineAiPrompt.mode === "python-block"
                  ? "Python block 生成"
                  : "@@ 続き生成"}
            </strong>
            <button
              aria-label="閉じる"
              className="editor-ai-popup__close"
              disabled={inlineAiPrompt.isSubmitting}
              onClick={closeInlineAiPrompt}
              type="button"
            >
              ×
            </button>
          </div>
          {inlineAiPrompt.messages.length > 0 || inlineAiPrompt.isSubmitting ? (
            <div className="editor-ai-popup__messages">
              {inlineAiPrompt.messages.map((message) => (
                <article
                  className={`editor-ai-popup__message editor-ai-popup__message--${message.role}`}
                  key={message.id}
                >
                  <span className="editor-ai-popup__message-role">
                    {formatInlineAiMessageRole(message)}
                  </span>
                  <AiSkillChips compact skills={message.skillInvocations ?? []} />
                  {message.role === "tool" ? (
                    <pre className="editor-ai-popup__message-text editor-ai-popup__message-text--plain">
                      {formatInlineAiMessageText(message)}
                    </pre>
                  ) : (
                    <AiMarkdown
                      className="editor-ai-popup__message-text"
                      compact
                      text={message.text}
                    />
                  )}
                </article>
              ))}
              {inlineAiPrompt.isSubmitting ? (
                <article className="editor-ai-popup__message editor-ai-popup__message--assistant">
                  <span className="editor-ai-popup__message-role">
                    {inlineAiPrompt.streamingText.length > 0 ? "Assistant streaming" : "Assistant"}
                  </span>
                  {inlineAiPrompt.streamingText.length > 0 ? (
                    <AiMarkdown
                      className="editor-ai-popup__message-text"
                      compact
                      text={inlineAiPrompt.streamingText}
                    />
                  ) : (
                    <div className="editor-ai-popup__thinking">
                      <span />
                      <span />
                      <span />
                    </div>
                  )}
                  {inlineAiPrompt.streamingToolTrace.length > 0 ? (
                    <div className="editor-ai-popup__tool-trace">
                      {inlineAiPrompt.streamingToolTrace.map((entry, index) => (
                        <code key={`${entry.toolName}-${index}`}>
                          {entry.toolName}: {entry.outputSummary || entry.inputSummary}
                        </code>
                      ))}
                    </div>
                  ) : null}
                </article>
              ) : null}
            </div>
          ) : null}
          {inlineAiPrompt.mode === "promptless-continuation" ? (
            <>
              <div className="editor-ai-popup__status">
                {inlineAiPrompt.isSubmitting
                  ? "@@ から続きを生成しています"
                  : "@@ の処理を停止しました"}
              </div>
              {inlineAiPrompt.error ? (
                <div className="editor-ai-popup__error">{inlineAiPrompt.error}</div>
              ) : null}
              {!inlineAiPrompt.isSubmitting ? (
                <div className="editor-ai-popup__actions">
                  <button
                    className="button button--ghost button--xs"
                    onClick={closeInlineAiPrompt}
                    type="button"
                  >
                    閉じる
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <textarea
                className="editor-ai-popup__input"
                disabled={inlineAiPrompt.isSubmitting}
                onClick={(event) => {
                  syncInlineAiSkillCompletion(
                    event.currentTarget.value,
                    event.currentTarget.selectionStart
                  );
                }}
                onChange={(event) => {
                  updateInlineAiPrompt(
                    event.currentTarget.value,
                    event.currentTarget.selectionStart
                  );
                }}
                onKeyDown={(event) => {
                  handleInlineAiPromptKeyDown(event);
                }}
                onKeyUp={(event) => {
                  if (
                    event.key === "ArrowLeft" ||
                    event.key === "ArrowRight" ||
                    event.key === "Home" ||
                    event.key === "End"
                  ) {
                    syncInlineAiSkillCompletion(
                      event.currentTarget.value,
                      event.currentTarget.selectionStart
                    );
                  }
                }}
                placeholder={
                  inlineAiPrompt.mode === "insert-text"
                    ? inlineAiPrompt.messages.length > 0
                      ? "追加の指示や回答を入力"
                      : "挿入したい内容を指示"
                    : inlineAiPrompt.messages.length > 0
                      ? "追加の指示や回答を入力"
                      : "実装したい解析 block を指示"
                }
                ref={inlineAiTextareaRef}
                rows={4}
                value={inlineAiPrompt.prompt}
              />
              {inlineAiSkillCompletion ? (
                <AiSkillCompletionList
                  compact
                  onHighlight={(index) => {
                    setInlineAiSkillCompletion((current) =>
                      current ? { ...current, selectedIndex: index } : current
                    );
                  }}
                  onSelect={insertInlineAiSkill}
                  selectedIndex={selectedInlineAiSkillSuggestionIndex}
                  skills={visibleInlineAiSkillSuggestions}
                />
              ) : null}
              <AiSkillChips compact skills={inlineAiPromptSkills} />
              {inlineAiPrompt.error ? (
                <div className="editor-ai-popup__error">{inlineAiPrompt.error}</div>
              ) : null}
              <div className="editor-ai-popup__actions">
                <button
                  className="button button--ghost button--xs"
                  disabled={inlineAiPrompt.isSubmitting}
                  onClick={closeInlineAiPrompt}
                  type="button"
                >
                  キャンセル
                </button>
                <button
                  className="button button--primary button--xs"
                  disabled={inlineAiPrompt.isSubmitting || inlineAiPrompt.prompt.trim().length === 0}
                  type="submit"
                >
                  {inlineAiPrompt.isSubmitting
                    ? "送信中..."
                    : inlineAiPrompt.messages.length > 0
                      ? "返信"
                      : "送信"}
                </button>
              </div>
            </>
          )}
        </form>
      ) : null}
      {analysisCompletion ? (
        <div
          className="editor-link-completion"
          ref={completionPanelRef}
          style={{
            left: `${analysisCompletion.x}px`,
            maxHeight: `${analysisCompletion.maxHeight}px`,
            top: `${analysisCompletion.y}px`
          }}
        >
          {visibleIntegralBlockSuggestions.length > 0 ? (
            visibleIntegralBlockSuggestions.map((definition, index) => (
              <button
                className={`editor-link-completion__item${
                  index === selectedIntegralBlockSuggestionIndex
                    ? " editor-link-completion__item--selected"
                    : ""
                }`}
                key={`${definition.pluginId}:${definition.blockType}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertIntegralBlock(definition);
                }}
                type="button"
              >
                <span className="editor-link-completion__name">{definition.title}</span>
                <span className="editor-link-completion__path">{definition.blockType}</span>
              </button>
            ))
          ) : (
            <div className="editor-link-completion__empty">一致する解析 block がありません。</div>
          )}
        </div>
      ) : linkCompletion ? (
        <div
          className="editor-link-completion"
          ref={completionPanelRef}
          style={{
            left: `${linkCompletion.x}px`,
            maxHeight: `${linkCompletion.maxHeight}px`,
            top: `${linkCompletion.y}px`
          }}
        >
          {visibleSuggestions.length > 0 ? (
            visibleSuggestions.map((suggestion, index) => (
              <button
                className={`editor-link-completion__item${
                  index === selectedSuggestionIndex ? " editor-link-completion__item--selected" : ""
                }`}
                key={suggestion.relativePath}
                onMouseDown={(event) => {
                  event.preventDefault();
                  if (linkCompletion.kind === "embed") {
                    insertWorkspaceEmbed(suggestion);
                  } else {
                    insertWorkspaceLink(suggestion);
                  }
                }}
                type="button"
              >
                <span className="editor-link-completion__name">{suggestion.name}</span>
                <span className="editor-link-completion__path">{suggestion.relativePath}</span>
              </button>
            ))
          ) : (
            <div className="editor-link-completion__empty">一致する file がありません。</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function collectWorkspaceFileSuggestions(entries: WorkspaceEntry[]): WorkspaceFileSuggestion[] {
  const suggestions: WorkspaceFileSuggestion[] = [];

  const visitEntries = (currentEntries: WorkspaceEntry[]): void => {
    for (const entry of currentEntries) {
      if (entry.kind === "file") {
        suggestions.push({
          name: entry.name,
          relativePath: entry.relativePath
        });
      }

      if (entry.children) {
        visitEntries(entry.children);
      }
    }
  };

  visitEntries(entries);
  suggestions.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, "ja")
  );
  return suggestions;
}

function computeInlineAiTriggerState(
  view: EditorView,
  selection: Selection
): InlineAiTriggerState | null {
  if (!selection.empty) {
    return null;
  }

  const { $from, from } = selection;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, "\n", "\0");
  const currentLineBefore = textBefore.slice(textBefore.lastIndexOf("\n") + 1);
  const marker: InlineAiTriggerMarker | null =
    currentLineBefore === "??"
      ? "??"
      : currentLineBefore === ">>"
        ? ">>"
        : currentLineBefore === "@@"
          ? "@@"
          : null;

  if (!marker) {
    return null;
  }

  const replaceFrom = from - marker.length;
  const replaceTo = from;

  try {
    const coords = view.coordsAtPos(from);
    const popupLayout = computePopupLayout(coords);

    return {
      afterText: view.state.doc.textBetween(replaceTo, view.state.doc.content.size, "\n", "\0"),
      beforeText: view.state.doc.textBetween(0, replaceFrom, "\n", "\0"),
      marker,
      mode:
        marker === "??"
          ? "insert-text"
          : marker === ">>"
            ? "python-block"
            : "promptless-continuation",
      replaceFrom,
      replaceTo,
      x: clampPopupCoordinate(coords.left, INLINE_AI_POPUP_WIDTH, window.innerWidth),
      y: popupLayout.y
    };
  } catch {
    return null;
  }
}

function formatInlineAiMessageRole(message: AiChatMessage): string {
  if (message.role === "assistant") {
    return "Assistant";
  }

  if (message.role === "tool") {
    return "Tool";
  }

  return "You";
}

function formatInlineAiMessageText(message: AiChatMessage): string {
  if (message.role !== "tool" || !message.toolTraceEntry) {
    return message.text;
  }

  return [
    `tool: ${message.toolTraceEntry.toolName}`,
    `status: ${message.toolTraceEntry.status}`,
    `input: ${message.toolTraceEntry.inputSummary}`,
    `output: ${message.toolTraceEntry.outputSummary}`
  ].join("\n");
}

function createInlineAiStreamId(): string {
  return `inline-ai-stream-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function waitInlineAiInsertionPreviewFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, INLINE_AI_INSERTION_PREVIEW_FRAME_MS);
  });
}

function computeLinkCompletionState(
  view: EditorView,
  selection: Selection
): LinkCompletionState | null {
  if (!selection.empty) {
    return null;
  }

  const { $from, from } = selection;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, "\n", "\0");

  const embedMatch = /!\[([^\[\]]*)$/u.exec(textBefore);

  if (embedMatch) {
    const query = embedMatch[1] ?? "";
    const replaceFrom = from - query.length - 2;

    try {
      const coords = view.coordsAtPos(from);
      const popupLayout = computePopupLayout(coords);
      return {
        kind: "embed",
        maxHeight: popupLayout.maxHeight,
        query,
        replaceFrom,
        replaceTo: from,
        selectedIndex: 0,
        x: clampPopupCoordinate(coords.left, 360, window.innerWidth),
        y: popupLayout.y
      };
    } catch {
      return null;
    }
  }

  const bangMatch = /(?:^|[\s>([{])!([^\s!]*)$/u.exec(textBefore);

  if (bangMatch) {
    const query = bangMatch[1] ?? "";
    const prefix = bangMatch[0] ?? "";
    const bangOffset = prefix.lastIndexOf("!");
    const replaceFrom = from - (prefix.length - bangOffset);

    try {
      const coords = view.coordsAtPos(from);
      const popupLayout = computePopupLayout(coords);
      return {
        kind: "embed",
        maxHeight: popupLayout.maxHeight,
        query,
        replaceFrom,
        replaceTo: from,
        selectedIndex: 0,
        x: clampPopupCoordinate(coords.left, 360, window.innerWidth),
        y: popupLayout.y
      };
    } catch {
      return null;
    }
  }

  const linkMatch = /\[([^\[\]]*)$/u.exec(textBefore);

  if (!linkMatch) {
    return null;
  }

  const bracketIndex = linkMatch.index;

  if (bracketIndex > 0 && textBefore.charAt(bracketIndex - 1) === "!") {
    return null;
  }

  const query = linkMatch[1] ?? "";
  const replaceFrom = from - query.length - 1;

  try {
    const coords = view.coordsAtPos(from);
    const popupLayout = computePopupLayout(coords);
    return {
      kind: "link",
      maxHeight: popupLayout.maxHeight,
      query,
      replaceFrom,
      replaceTo: from,
      selectedIndex: 0,
      x: clampPopupCoordinate(coords.left, 360, window.innerWidth),
      y: popupLayout.y
    };
  } catch {
    return null;
  }
}

function computeAnalysisCompletionState(
  view: EditorView,
  selection: Selection
): AnalysisCompletionState | null {
  if (!selection.empty) {
    return null;
  }

  const { $from, from } = selection;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, "\n", "\0");
  const analysisMatch = /(?:^|[\s])>([^\n>]*)$/u.exec(textBefore);

  if (!analysisMatch) {
    return null;
  }

  const query = analysisMatch[1] ?? "";
  const prefix = analysisMatch[0] ?? "";
  const markerOffset = prefix.lastIndexOf(">");
  const replaceFrom = from - (prefix.length - markerOffset);

  try {
    const coords = view.coordsAtPos(from);
    const popupLayout = computePopupLayout(coords);
    return {
      maxHeight: popupLayout.maxHeight,
      query,
      replaceFrom,
      replaceTo: from,
      selectedIndex: 0,
      x: clampPopupCoordinate(coords.left, 360, window.innerWidth),
      y: popupLayout.y
    };
  } catch {
    return null;
  }
}

function getVisibleWorkspaceFileSuggestions(
  suggestions: WorkspaceFileSuggestion[],
  query: string
): WorkspaceFileSuggestion[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("ja");
  const ranked = suggestions
    .map((suggestion) => ({
      score: scoreWorkspaceSuggestion(suggestion, normalizedQuery),
      suggestion
    }))
    .filter((entry) => entry.score < Number.POSITIVE_INFINITY)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }

      return left.suggestion.relativePath.localeCompare(right.suggestion.relativePath, "ja");
    });

  return ranked.map((entry) => entry.suggestion);
}

function getVisibleIntegralBlockSuggestions(
  definitions: readonly IntegralBlockTypeDefinition[],
  query: string
): IntegralBlockTypeDefinition[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("ja");
  const ranked = definitions
    .filter((definition) => definition.source === "python-callable")
    .map((definition) => ({
      definition,
      score: scoreIntegralBlockSuggestion(definition, normalizedQuery)
    }))
    .filter((entry) => entry.score < Number.POSITIVE_INFINITY)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }

      return `${left.definition.title} ${left.definition.blockType}`.localeCompare(
        `${right.definition.title} ${right.definition.blockType}`,
        "ja"
      );
    });

  return ranked.map((entry) => entry.definition);
}

function scoreWorkspaceSuggestion(
  suggestion: WorkspaceFileSuggestion,
  normalizedQuery: string
): number {
  if (normalizedQuery.length === 0) {
    return 0;
  }

  const lowerName = suggestion.name.toLocaleLowerCase("ja");
  const lowerPath = suggestion.relativePath.toLocaleLowerCase("ja");
  const linkLabel = toWorkspaceLinkLabel(suggestion.name).toLocaleLowerCase("ja");

  if (lowerName.startsWith(normalizedQuery) || linkLabel.startsWith(normalizedQuery)) {
    return 0;
  }

  if (lowerName.includes(normalizedQuery) || linkLabel.includes(normalizedQuery)) {
    return 1;
  }

  if (lowerPath.startsWith(normalizedQuery)) {
    return 2;
  }

  if (lowerPath.includes(normalizedQuery)) {
    return 3;
  }

  return Number.POSITIVE_INFINITY;
}

function scoreIntegralBlockSuggestion(
  definition: IntegralBlockTypeDefinition,
  normalizedQuery: string
): number {
  if (normalizedQuery.length === 0) {
    return 0;
  }

  const lowerTitle = definition.title.toLocaleLowerCase("ja");
  const lowerBlockType = definition.blockType.toLocaleLowerCase("ja");
  const lowerDescription = definition.description.toLocaleLowerCase("ja");

  if (lowerTitle.startsWith(normalizedQuery)) {
    return 0;
  }

  if (lowerTitle.includes(normalizedQuery)) {
    return 1;
  }

  if (lowerBlockType.startsWith(normalizedQuery)) {
    return 2;
  }

  if (lowerBlockType.includes(normalizedQuery) || lowerDescription.includes(normalizedQuery)) {
    return 3;
  }

  return Number.POSITIVE_INFINITY;
}

function toWorkspaceLinkLabel(fileName: string): string {
  const lowerName = fileName.toLowerCase();

  if (!lowerName.endsWith(".md")) {
    return fileName;
  }

  return fileName.slice(0, -3);
}

function buildInlineAiExcerpt(state: InlineAiPromptState): string {
  return [
    `open document source: ${state.documentMarkdown.length > 0 ? "current editor state" : "(empty)"}`,
    `insertion position: ${state.anchorPos}`,
    `open markdown length: ${state.documentMarkdown.length} chars`,
    "",
    "before cursor:",
    truncateInlinePopupContext(state.beforeText, "tail"),
    "",
    "after cursor:",
    truncateInlinePopupContext(state.afterText, "head")
  ].join("\n");
}

function buildInlineAiTranscript(messages: readonly AiChatMessage[]): string {
  return messages
    .filter((message) => message.role !== "tool")
    .map((message) => {
      const text = message.text.trim();

      if (text.length === 0) {
        return null;
      }

      const role = message.role === "assistant" ? "Assistant" : "User";
      return `${role}:\n${text}`;
    })
    .filter((entry): entry is string => typeof entry === "string")
    .join("\n\n");
}

function prependInlineAiTranscript(markdown: string, transcript: string): string {
  const trimmedMessage = transcript.trim();

  if (trimmedMessage.length === 0) {
    return markdown;
  }

  return `${toMarkdownCodeFence(trimmedMessage)}\n\n${markdown}`;
}

function toMarkdownCodeFence(content: string, language = ""): string {
  const longestFence = Array.from(content.matchAll(/`{3,}/gu)).reduce(
    (maxLength, match) => Math.max(maxLength, match[0]?.length ?? 0),
    0
  );
  const fence = "`".repeat(Math.max(3, longestFence + 1));
  const normalizedLanguage = language.trim();
  const fenceHeader = normalizedLanguage.length > 0 ? `${fence}${normalizedLanguage}` : fence;

  return `${fenceHeader}\n${content}\n${fence}`;
}

function truncateInlinePopupContext(value: string, side: "head" | "tail"): string {
  const maxLength = 2000;

  if (value.length <= maxLength) {
    return value;
  }

  return side === "head"
    ? `${value.slice(0, maxLength)}\n[truncated ${value.length - maxLength} chars]`
    : `[truncated ${value.length - maxLength} chars]\n${value.slice(-maxLength)}`;
}

function getFileName(relativePath: string): string {
  const normalizedPath = relativePath.replace(/\\/gu, "/");
  const segments = normalizedPath.split("/");
  return segments[segments.length - 1] ?? normalizedPath;
}

function clampPopupCoordinate(value: number, panelSize: number, viewportSize: number): number {
  return Math.max(12, Math.min(value, viewportSize - panelSize - 12));
}

function computePopupLayout(coords: { bottom: number; top: number }): { maxHeight: number; y: number } {
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

function clearFocusedIntegralBlocks(rootElement: HTMLElement): void {
  for (const blockElement of rootElement.querySelectorAll<HTMLElement>(".integral-code-block--focused")) {
    blockElement.classList.remove("integral-code-block--focused");
  }
}

function findIntegralBlockElement(rootElement: HTMLElement, blockId: string): HTMLElement | null {
  const selectorBlockId =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(blockId)
      : blockId.replace(/["\\]/gu, "\\$&");

  return rootElement.querySelector<HTMLElement>(`[data-integral-block-id="${selectorBlockId}"]`);
}

function applyIntegralExecutionResultToMarkdown(
  markdown: string,
  previousBlockSource: string,
  result: ExecuteIntegralBlockResult
): string | null {
  const normalizedPreviousBlockSource = normalizeMarkdownForComparison(previousBlockSource);
  const nextBlockMarkdown = toIntegralCodeBlock(serializeIntegralBlockContent(result.block));
  const appendMarkdown = result.workNoteMarkdownToAppend?.trim() ?? "";
  const executionLogMarkdown = result.executionLogMarkdownTarget?.trim()
    ? `![](${result.executionLogMarkdownTarget.trim()})`
    : "";
  const markdownToAppend = [executionLogMarkdown, appendMarkdown].filter(Boolean).join("\n\n");
  const nextBlockId = result.block.id?.trim() ?? "";
  let hasReplaced = false;

  const nextMarkdown = markdown.replace(
    INTEGRAL_BLOCK_WITH_OPTIONAL_EXECUTION_LOG_PATTERN,
    (fullMatch, _blockMarkdown, blockSource) => {
      if (hasReplaced) {
        return fullMatch;
      }

      const rawBlockSource = typeof blockSource === "string" ? blockSource : "";
      const parsed = parseIntegralBlockSource(INTEGRAL_BLOCK_LANGUAGE, rawBlockSource);
      const parsedBlockId = parsed?.block.id?.trim() ?? "";
      const matchesById =
        nextBlockId.length > 0 && parsedBlockId.length > 0 && parsedBlockId === nextBlockId;
      const matchesBySource =
        normalizeMarkdownForComparison(rawBlockSource) === normalizedPreviousBlockSource;

      if (!matchesById && !matchesBySource) {
        return fullMatch;
      }

      hasReplaced = true;
      return markdownToAppend.length > 0
        ? `${nextBlockMarkdown}\n\n${markdownToAppend}`
        : nextBlockMarkdown;
    }
  );

  return hasReplaced ? nextMarkdown : null;
}

function normalizeMarkdownForComparison(value: string): string {
  return value.replace(/\r\n/gu, "\n").trim();
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}
