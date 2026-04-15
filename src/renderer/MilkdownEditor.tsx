import { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { imageSchema, linkSchema } from "@milkdown/kit/preset/commonmark";
import type { Selection } from "@milkdown/kit/prose/state";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { insert, replaceAll } from "@milkdown/kit/utils";
import { type ReactNode, useEffect, useRef, useState } from "react";

import type { WorkspaceEntry, WorkspaceSnapshot } from "../shared/workspace";
import {
  resolveWorkspaceMarkdownTarget,
  toCanonicalWorkspaceTarget
} from "../shared/workspaceLinks";
import { installIntegralCodeBlockFeature } from "./integralCodeBlockFeature";
import { initializeIntegralPluginRuntime } from "./integralPluginRuntime";
import {
  createIntegralSnippetFeatureConfigs,
  INSERT_INTEGRAL_BLOCK_MARKDOWN_EVENT
} from "./integralSnippetMenu";
import { installWorkspaceEmbedFeature } from "./workspaceEmbedFeature";

interface MilkdownEditorProps {
  initialValue: string;
  isActive: boolean;
  onChange: (markdown: string) => void;
  onOpenWorkspaceFile: (relativePath: string) => void;
  onWorkspaceSnapshotChanged: (snapshot: WorkspaceSnapshot) => void;
  onWorkspaceLinkError: (message: string) => void;
  toolbar?: ReactNode;
  workspaceEntries: WorkspaceEntry[];
}

interface WorkspaceFileSuggestion {
  name: string;
  relativePath: string;
}

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

export function MilkdownEditor({
  initialValue,
  isActive,
  onChange,
  onOpenWorkspaceFile,
  onWorkspaceSnapshotChanged,
  onWorkspaceLinkError,
  toolbar,
  workspaceEntries
}: MilkdownEditorProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Crepe | null>(null);
  const onChangeRef = useRef(onChange);
  const onOpenWorkspaceFileRef = useRef(onOpenWorkspaceFile);
  const onWorkspaceSnapshotChangedRef = useRef(onWorkspaceSnapshotChanged);
  const onWorkspaceLinkErrorRef = useRef(onWorkspaceLinkError);
  const isActiveRef = useRef(isActive);
  const lastSyncedMarkdownRef = useRef(initialValue);
  const linkCompletionRef = useRef<LinkCompletionState | null>(null);
  const completionPanelRef = useRef<HTMLDivElement | null>(null);
  const workspaceFilesRef = useRef<WorkspaceFileSuggestion[]>(
    collectWorkspaceFileSuggestions(workspaceEntries)
  );
  const [linkCompletion, setLinkCompletion] = useState<LinkCompletionState | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

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
    }
  }, [isActive]);

  useEffect(() => {
    const nextWorkspaceFiles = collectWorkspaceFileSuggestions(workspaceEntries);
    workspaceFilesRef.current = nextWorkspaceFiles;
  }, [workspaceEntries]);

  useEffect(() => {
    linkCompletionRef.current = linkCompletion;
  }, [linkCompletion]);

  useEffect(() => {
    const completionPanel = completionPanelRef.current;

    if (!completionPanel || !linkCompletion) {
      return;
    }

    const selectedItem = completionPanel.querySelector<HTMLElement>(
      ".editor-link-completion__item--selected"
    );

    selectedItem?.scrollIntoView({
      block: "nearest"
    });
  }, [linkCompletion]);

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
          ...createIntegralSnippetFeatureConfigs(),
          [Crepe.Feature.ImageBlock]: {
            onUpload: handleImageUpload,
            proxyDomURL: proxyImageUrl
          }
        },
        root: rootElement,
        defaultValue: initialValue
      });

      installIntegralCodeBlockFeature(editor);
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
            return;
          }

          const view = ctx.get(editorViewCtx);
          setLinkCompletion(computeLinkCompletionState(view, selection));
        });
        listener.blur(() => {
          setLinkCompletion(null);
        });
      });

      editorRef.current = editor;
    })();

    return () => {
      shouldDestroyAfterCreate = true;

      if (editorRef.current === editor) {
        editorRef.current = null;
        void editor.destroy();
      }
    };
  }, []);

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

      onOpenWorkspaceFileRef.current(relativePath);
    };

    rootElement.addEventListener("keydown", handleEditorKeyDown, true);
    rootElement.addEventListener("click", handleEditorClick);

    return () => {
      rootElement.removeEventListener("keydown", handleEditorKeyDown, true);
      rootElement.removeEventListener("click", handleEditorClick);
    };
  }, []);

  useEffect(() => {
    const handleInsertBlockMarkdown = (event: Event): void => {
      if (!isActiveRef.current) {
        return;
      }

      const customEvent = event as CustomEvent<string>;
      const markdown = customEvent.detail;

      if (typeof markdown !== "string" || markdown.trim().length === 0) {
        return;
      }

      const editor = editorRef.current;

      if (!editor) {
        return;
      }

      editor.editor.action(insert(markdown));
    };

    window.addEventListener(
      INSERT_INTEGRAL_BLOCK_MARKDOWN_EVENT,
      handleInsertBlockMarkdown as EventListener
    );

    return () => {
      window.removeEventListener(
        INSERT_INTEGRAL_BLOCK_MARKDOWN_EVENT,
        handleInsertBlockMarkdown as EventListener
      );
    };
  }, []);

  const visibleSuggestions = linkCompletion
    ? getVisibleWorkspaceFileSuggestions(workspaceFilesRef.current, linkCompletion.query)
    : [];
  const selectedSuggestionIndex =
    visibleSuggestions.length === 0
      ? -1
      : Math.min(linkCompletion?.selectedIndex ?? 0, visibleSuggestions.length - 1);

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

  return (
    <div className="editor-shell">
      {toolbar ? <div className="editor-toolbar">{toolbar}</div> : null}
      <div
        className="editor-surface"
        ref={rootRef}
      />
      {linkCompletion ? (
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

function toWorkspaceLinkLabel(fileName: string): string {
  const lowerName = fileName.toLowerCase();

  if (!lowerName.endsWith(".md")) {
    return fileName;
  }

  return fileName.slice(0, -3);
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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}
