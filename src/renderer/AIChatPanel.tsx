import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";

import {
  DEFAULT_AI_CHAT_SYSTEM_PROMPTS,
  type AiChatContextSummary,
  type AiChatHistorySnapshot,
  type AiChatImageAttachment,
  type AiChatMessage,
  type AiChatSessionSummary,
  type AiChatSkillInvocation,
  type AiChatSkillSummary,
  type AiChatStatus,
  type AiChatStreamEvent,
  type AiChatSystemPrompts,
  type AiChatToolTraceEntry
} from "../shared/aiChat";
import {
  findActiveAiSkillTrigger,
  findExplicitAiSkillMentions,
  getAiSkillSuggestions,
  type AiSkillTextTrigger,
  toAiSkillInvocation
} from "../shared/aiChatSkills";
import type { WorkspaceFileDocument } from "../shared/workspace";
import { AiMarkdown } from "./AiMarkdown";
import { AiSkillChips } from "./AiSkillChips";
import { AiSkillCompletionList } from "./AiSkillCompletionList";

interface AIChatPanelProps {
  contextRelativePath: string | null;
  noteOverrides: Record<string, string>;
  selectedEntryPaths: string[];
  workspaceRevision: number;
  workspaceRootName: string | null;
}

interface AiSkillCompletionState extends AiSkillTextTrigger {
  selectedIndex: number;
}

export function AIChatPanel({
  contextRelativePath,
  noteOverrides,
  selectedEntryPaths,
  workspaceRevision,
  workspaceRootName
}: AIChatPanelProps): JSX.Element {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [contextSummary, setContextSummary] = useState<AiChatContextSummary>({
    activeDocumentExcerpt: null,
    activeDocumentKind: null,
    activeDocumentName: null,
    activeRelativePath: contextRelativePath,
    selectedPaths: selectedEntryPaths,
    workspaceRootName
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [composerAttachments, setComposerAttachments] = useState<AiChatImageAttachment[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [historySnapshot, setHistorySnapshot] = useState<AiChatHistorySnapshot | null>(null);
  const [isContextDialogOpen, setIsContextDialogOpen] = useState(false);
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [isSessionMutating, setIsSessionMutating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [shellExecutablePathInput, setShellExecutablePathInput] = useState("");
  const [skillCompletion, setSkillCompletion] = useState<AiSkillCompletionState | null>(null);
  const [streamingAssistantText, setStreamingAssistantText] = useState("");
  const [streamingToolTrace, setStreamingToolTrace] = useState<AiChatToolTraceEntry[]>([]);
  const [status, setStatus] = useState<AiChatStatus | null>(null);
  const [systemPromptInputs, setSystemPromptInputs] = useState<AiChatSystemPrompts>(
    DEFAULT_AI_CHAT_SYSTEM_PROMPTS
  );
  const messagesRef = useRef<HTMLElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const activeStreamIdRef = useRef<string | null>(null);

  const applyHistoryMetadata = (snapshot: AiChatHistorySnapshot): void => {
    setHistorySnapshot(snapshot);
    setActiveSessionId(snapshot.activeSessionId);
  };

  const applyHistorySnapshot = (snapshot: AiChatHistorySnapshot): void => {
    applyHistoryMetadata(snapshot);
    setMessages(snapshot.activeSession.messages);
  };

  useEffect(() => {
    let cancelled = false;

    const loadHistory = async (): Promise<void> => {
      setIsLoadingHistory(true);

      try {
        const snapshot = await window.integralNotes.getAiChatHistory();

        if (!cancelled) {
          applyHistorySnapshot(snapshot);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(toErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingHistory(false);
        }
      }
    };

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadStatus = async (): Promise<void> => {
      try {
        const nextStatus = await window.integralNotes.getAiChatStatus();

        if (!cancelled) {
          setStatus(nextStatus);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(toErrorMessage(error));
        }
      }
    };

    void loadStatus();

    return () => {
      cancelled = true;
    };
  }, [workspaceRevision]);

  useEffect(() => {
    let cancelled = false;

    const loadContextSummary = async (): Promise<void> => {
      try {
        const nextSummary = await buildContextSummary({
          contextRelativePath,
          noteOverrides,
          selectedEntryPaths,
          workspaceRootName
        });

        if (!cancelled) {
          setContextSummary(nextSummary);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(toErrorMessage(error));
        }
      }
    };

    void loadContextSummary();

    return () => {
      cancelled = true;
    };
  }, [contextRelativePath, noteOverrides, selectedEntryPaths, workspaceRootName]);

  useEffect(() => {
    if (!status) {
      return;
    }

    if (!selectedModelId || !status.availableModels.some((model) => model.id === selectedModelId)) {
      setSelectedModelId(status.selectedModelId ?? status.availableModels[0]?.id ?? "");
    }
  }, [selectedModelId, status]);

  useEffect(() => {
    if (!isSettingsDialogOpen || !status) {
      return;
    }

    setSystemPromptInputs(status.systemPrompts);
    setShellExecutablePathInput(status.shellExecutablePath ?? "");
  }, [isSettingsDialogOpen, status]);

  useEffect(() => {
    const hasOpenDialog = isContextDialogOpen || isHistoryDialogOpen || isSettingsDialogOpen;

    document.body.classList.toggle("integral-dialog-open", hasOpenDialog);

    if (hasOpenDialog && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    return () => {
      document.body.classList.remove("integral-dialog-open");
    };
  }, [isContextDialogOpen, isHistoryDialogOpen, isSettingsDialogOpen]);

  useEffect(() => {
    if (!isContextDialogOpen && !isHistoryDialogOpen && !isSettingsDialogOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setIsContextDialogOpen(false);
        setIsHistoryDialogOpen(false);
        setIsSettingsDialogOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isContextDialogOpen, isHistoryDialogOpen, isSettingsDialogOpen]);

  useEffect(() => {
    return window.integralNotes.onAiChatStreamEvent((event: AiChatStreamEvent) => {
      if (event.id !== activeStreamIdRef.current) {
        return;
      }

      switch (event.type) {
        case "text-delta":
          if (event.textDelta) {
            setStreamingAssistantText((current) => `${current}${event.textDelta}`);
          }
          break;
        case "text-reset":
          setStreamingAssistantText("");
          break;
        case "tool-trace":
          if (event.toolTrace?.length) {
            setStreamingToolTrace((current) => [...current, ...(event.toolTrace ?? [])]);
          }
          break;
        case "error":
          setErrorMessage(event.message ?? "AI Chat streaming failed.");
          break;
        default:
          break;
      }
    });
  }, []);

  useEffect(() => {
    const container = messagesRef.current;

    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [isSubmitting, messages]);

  const composerHint = useMemo(() => {
    const attachmentSummary =
      composerAttachments.length > 0
        ? `${composerAttachments.length} image${composerAttachments.length === 1 ? "" : "s"} attached`
        : null;

    if (contextSummary.activeRelativePath) {
      return attachmentSummary
        ? `active: ${contextSummary.activeRelativePath} • ${attachmentSummary}`
        : `active: ${contextSummary.activeRelativePath}`;
    }

    return attachmentSummary
      ? `Context ボタンから active file / note の文脈を確認できます • ${attachmentSummary}`
      : "Context ボタンから active file / note の文脈を確認できます";
  }, [composerAttachments.length, contextSummary.activeRelativePath]);

  const runtimeModeLabel = useMemo(() => {
    if (!status) {
      return "Loading";
    }

    switch (status.implementationMode) {
      case "direct":
        return "Direct Runtime";
      case "gateway":
        return "Gateway Runtime";
      default:
        return "Stub Runtime";
    }
  }, [status]);

  const systemPromptInputsAreValid = useMemo(
    () =>
      systemPromptInputs.chatPanel.trim().length > 0 &&
      systemPromptInputs.inlineInsertion.trim().length > 0 &&
      systemPromptInputs.inlinePythonBlock.trim().length > 0,
    [systemPromptInputs]
  );
  const recognizedPromptSkills = useMemo<AiChatSkillInvocation[]>(
    () => findExplicitAiSkillMentions(prompt, status?.availableSkills ?? []),
    [prompt, status?.availableSkills]
  );
  const availableSkillInvocations = useMemo<AiChatSkillInvocation[]>(
    () => (status?.availableSkills ?? []).map(toAiSkillInvocation),
    [status?.availableSkills]
  );
  const visibleSkillSuggestions = useMemo(
    () =>
      skillCompletion
        ? getAiSkillSuggestions(status?.availableSkills ?? [], skillCompletion.query)
        : [],
    [skillCompletion, status?.availableSkills]
  );
  const selectedSkillSuggestionIndex =
    visibleSkillSuggestions.length === 0
      ? -1
      : Math.min(skillCompletion?.selectedIndex ?? 0, visibleSkillSuggestions.length - 1);

  const activeSessionTitle = historySnapshot?.activeSession.title ?? "New chat";
  const sessionCount = historySnapshot?.sessions.length ?? 0;

  const resolveActiveSessionId = async (): Promise<string> => {
    if (activeSessionId) {
      return activeSessionId;
    }

    const snapshot = await window.integralNotes.getAiChatHistory();
    applyHistorySnapshot(snapshot);
    setIsLoadingHistory(false);
    return snapshot.activeSessionId;
  };

  const persistSessionMessages = async (
    sessionId: string,
    nextMessages: AiChatMessage[]
  ): Promise<void> => {
    const snapshot = await window.integralNotes.saveAiChatSession({
      context: contextSummary,
      messages: nextMessages,
      sessionId
    });

    applyHistoryMetadata(snapshot);
  };

  const handleCreateSession = async (): Promise<void> => {
    if (isSubmitting || isSessionMutating) {
      return;
    }

    setErrorMessage(null);
    setIsSessionMutating(true);

    try {
      const snapshot = await window.integralNotes.createAiChatSession({
        context: contextSummary
      });

      applyHistorySnapshot(snapshot);
      setPrompt("");
      setComposerAttachments([]);
      setIsHistoryDialogOpen(false);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsSessionMutating(false);
    }
  };

  const handleSwitchSession = async (sessionId: string): Promise<void> => {
    if (isSubmitting || isSessionMutating || sessionId === activeSessionId) {
      setIsHistoryDialogOpen(false);
      return;
    }

    setErrorMessage(null);
    setIsSessionMutating(true);

    try {
      const snapshot = await window.integralNotes.switchAiChatSession(sessionId);

      applyHistorySnapshot(snapshot);
      setPrompt("");
      setComposerAttachments([]);
      setIsHistoryDialogOpen(false);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsSessionMutating(false);
    }
  };

  const handleDeleteSession = async (sessionId: string): Promise<void> => {
    if (isSubmitting || isSessionMutating) {
      return;
    }

    setErrorMessage(null);
    setIsSessionMutating(true);

    try {
      const snapshot = await window.integralNotes.deleteAiChatSession(sessionId);

      applyHistorySnapshot(snapshot);
      setPrompt("");
      setComposerAttachments([]);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsSessionMutating(false);
    }
  };

  const handleSaveSettings = async (): Promise<void> => {
    setErrorMessage(null);
    setIsSavingSettings(true);

    try {
      const nextStatus = await window.integralNotes.saveAiChatSettings({
        apiKey: apiKeyInput.trim().length > 0 ? apiKeyInput.trim() : undefined,
        modelId: selectedModelId || null,
        shellExecutablePath:
          shellExecutablePathInput.trim().length > 0 ? shellExecutablePathInput.trim() : null,
        systemPrompts: systemPromptInputs
      });

      setStatus(nextStatus);
      setApiKeyInput("");
      setSelectedModelId(nextStatus.selectedModelId ?? nextStatus.availableModels[0]?.id ?? "");
      setShellExecutablePathInput(nextStatus.shellExecutablePath ?? "");
      setSystemPromptInputs(nextStatus.systemPrompts);
      setIsSettingsDialogOpen(false);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleClearApiKey = async (): Promise<void> => {
    setErrorMessage(null);
    setIsSavingSettings(true);

    try {
      const nextStatus = await window.integralNotes.clearAiChatApiKey();
      setStatus(nextStatus);
      setApiKeyInput("");
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleRefreshModels = async (): Promise<void> => {
    setErrorMessage(null);
    setIsRefreshingModels(true);

    try {
      const nextStatus = await window.integralNotes.refreshAiChatModels();
      setStatus(nextStatus);
      setSelectedModelId(nextStatus.selectedModelId ?? nextStatus.availableModels[0]?.id ?? "");
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsRefreshingModels(false);
    }
  };

  const updateSystemPromptInput = (key: keyof AiChatSystemPrompts, value: string): void => {
    setSystemPromptInputs((current) => ({
      ...current,
      [key]: value
    }));
  };

  const syncSkillCompletion = (value: string, cursorPosition: number): void => {
    const trigger = findActiveAiSkillTrigger(value, cursorPosition);

    if (!trigger) {
      setSkillCompletion(null);
      return;
    }

    setSkillCompletion((current) => ({
      ...trigger,
      selectedIndex:
        current &&
        current.replaceFrom === trigger.replaceFrom &&
        current.replaceTo === trigger.replaceTo
          ? current.selectedIndex
          : 0
    }));
  };

  const updatePromptInput = (value: string, cursorPosition: number): void => {
    setPrompt(value);
    syncSkillCompletion(value, cursorPosition);
  };

  const insertPromptSkill = (skill: AiChatSkillSummary): void => {
    const completion = skillCompletion;

    if (!completion) {
      return;
    }

    const beforeText = prompt.slice(0, completion.replaceFrom);
    const afterText = prompt.slice(completion.replaceTo);
    const insertion = `$${skill.name}${afterText.length === 0 || !/^\s/u.test(afterText) ? " " : ""}`;
    const nextPrompt = `${beforeText}${insertion}${afterText}`;
    const nextCursorPosition = beforeText.length + insertion.length;

    setPrompt(nextPrompt);
    setSkillCompletion(null);
    window.requestAnimationFrame(() => {
      const textarea = composerTextareaRef.current;

      if (!textarea) {
        return;
      }

      textarea.focus();
      textarea.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  };

  const handlePromptKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void handleSubmit();
      return;
    }

    if (!skillCompletion) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setSkillCompletion(null);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();

      if (visibleSkillSuggestions.length === 0) {
        return;
      }

      const direction = event.key === "ArrowDown" ? 1 : -1;
      setSkillCompletion((current) =>
        current
          ? {
              ...current,
              selectedIndex:
                (selectedSkillSuggestionIndex + direction + visibleSkillSuggestions.length) %
                visibleSkillSuggestions.length
            }
          : current
      );
      return;
    }

    if ((event.key === "Enter" || event.key === "Tab") && selectedSkillSuggestionIndex >= 0) {
      const selectedSkill = visibleSkillSuggestions[selectedSkillSuggestionIndex];

      if (!selectedSkill) {
        return;
      }

      event.preventDefault();
      insertPromptSkill(selectedSkill);
    }
  };

  const handleSubmit = async (): Promise<void> => {
    const trimmedPrompt = prompt.trim();

    if (trimmedPrompt.length === 0 || isLoadingHistory || isSubmitting) {
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    let sessionId: string;

    try {
      sessionId = await resolveActiveSessionId();
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
      setIsSubmitting(false);
      return;
    }

    const userMessage: AiChatMessage = {
      attachments: composerAttachments.length > 0 ? composerAttachments : undefined,
      createdAt: new Date().toISOString(),
      id: createChatMessageId("user"),
      role: "user",
      skillInvocations:
        recognizedPromptSkills.length > 0 ? recognizedPromptSkills : undefined,
      text: trimmedPrompt
    };
    const nextHistory = [...messages.filter((message) => message.role !== "tool"), userMessage];
    const optimisticMessages = [...messages, userMessage];

    setMessages(optimisticMessages);
    setPrompt("");
    setSkillCompletion(null);
    setComposerAttachments([]);

    const streamId = createChatStreamId();
    activeStreamIdRef.current = streamId;
    setStreamingAssistantText("");
    setStreamingToolTrace([]);

    try {
      const result = await window.integralNotes.submitAiChat({
        context: contextSummary,
        history: nextHistory,
        prompt: trimmedPrompt,
        requestedSkills: recognizedPromptSkills,
        streamId
      });

      const finalMessages = [
        ...optimisticMessages.map((message) =>
          message.id === userMessage.id ? (result.userMessage ?? message) : message
        ),
        ...result.messages
      ];

      setMessages(finalMessages);
      try {
        await persistSessionMessages(sessionId, finalMessages);
      } catch (persistError) {
        setErrorMessage(`AI Chat 履歴の保存に失敗しました: ${toErrorMessage(persistError)}`);
      }
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
      setMessages(messages);
      setPrompt(trimmedPrompt);
      setComposerAttachments(userMessage.attachments ?? []);
    } finally {
      activeStreamIdRef.current = null;
      setStreamingAssistantText("");
      setStreamingToolTrace([]);
      setIsSubmitting(false);
    }
  };

  const handleAttachImages = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(event.target.files ?? []);

    if (files.length === 0) {
      return;
    }

    await attachImageFiles(files);
    event.target.value = "";
  };

  const handlePasteImages = async (event: ClipboardEvent<HTMLTextAreaElement>): Promise<void> => {
    if (isSubmitting) {
      return;
    }

    const files = extractImageFilesFromClipboardData(event.clipboardData);

    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    await attachImageFiles(files);
  };

  const attachImageFiles = async (files: readonly File[]): Promise<void> => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));

    if (imageFiles.length === 0) {
      return;
    }

    setErrorMessage(null);

    try {
      const nextAttachments = await Promise.all(imageFiles.map((file) => createImageAttachment(file)));
      setComposerAttachments((currentAttachments) =>
        mergeImageAttachments(currentAttachments, nextAttachments)
      );
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  };

  return (
    <section className="ai-chat-panel">
      <header className="ai-chat-panel__header">
        <div>
          <p className="ai-chat-panel__eyebrow">Workspace Agent</p>
          <h1 className="ai-chat-panel__title">AI Chat</h1>
          <p className="ai-chat-panel__description">
            panel 本体は chat を優先し、runtime 設定と current context は別 dialog に分離しています。
          </p>
        </div>

        <div className="ai-chat-panel__header-actions">
          <div className="ai-chat-panel__status">
            <span className="ai-chat-panel__pill" title={activeSessionTitle}>
              {isLoadingHistory ? "History loading" : activeSessionTitle}
            </span>
            <span className="ai-chat-panel__pill">{runtimeModeLabel}</span>
            <span className="ai-chat-panel__pill">{status?.providerLabel ?? "runtime status loading"}</span>
            <span className="ai-chat-panel__pill">
              MCP {status?.mcpEnabled ? "connected" : "not wired"}
            </span>
          </div>

          <button
            aria-label="AI Chat history"
            className="button button--ghost ai-chat-panel__icon-button"
            onClick={() => {
              setErrorMessage(null);
              setIsHistoryDialogOpen(true);
            }}
            title="History"
            type="button"
          >
            <HistoryIcon />
          </button>

          <button
            aria-label="AI Chat context"
            className="button button--ghost ai-chat-panel__icon-button"
            onClick={() => {
              setErrorMessage(null);
              setIsContextDialogOpen(true);
            }}
            title="Context"
            type="button"
          >
            <ContextIcon />
          </button>

          <button
            aria-label="AI Chat settings"
            className="button button--ghost ai-chat-panel__icon-button"
            onClick={() => {
              setErrorMessage(null);
              setIsSettingsDialogOpen(true);
            }}
            title="Settings"
            type="button"
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      <section className="ai-chat-panel__messages" ref={messagesRef}>
        {messages.length === 0 ? (
          <div className="ai-chat-panel__empty">
            <strong>{isLoadingHistory ? "履歴を読み込み中です。" : "まだ会話はありません。"}</strong>
            <span>history icon から過去の会話を復元し、settings icon から runtime 設定を確認できます。</span>
          </div>
        ) : (
          messages.map((message) => (
            <article
              className={`ai-chat-panel__message ai-chat-panel__message--${message.role}`}
              key={message.id}
            >
              <div className="ai-chat-panel__message-meta">
                <strong>
                  {message.role === "assistant"
                    ? "Assistant"
                    : message.role === "tool"
                      ? "Tool"
                      : "You"}
                </strong>
                <span>{formatMessageTime(message.createdAt)}</span>
              </div>

              <AiSkillChips skills={message.skillInvocations ?? []} />

              {message.attachments && message.attachments.length > 0 ? (
                <div className="ai-chat-panel__attachments">
                  {message.attachments.map((attachment) => (
                    <figure className="ai-chat-panel__attachment" key={attachment.id}>
                      <img
                        alt={attachment.name}
                        className="ai-chat-panel__attachment-image"
                        src={attachment.dataUrl}
                      />
                      <figcaption>{attachment.sourcePath}</figcaption>
                    </figure>
                  ))}
                </div>
              ) : null}

              {message.role === "tool" ? (
                <pre className="ai-chat-panel__message-body ai-chat-panel__message-body--plain">
                  {message.text}
                </pre>
              ) : (
                <AiMarkdown className="ai-chat-panel__message-body" text={message.text} />
              )}

              {message.role === "tool" && message.toolTraceEntry ? (
                <div className="ai-chat-panel__message-diagnostics">
                  <div className="ai-chat-panel__message-pills">
                    <span className="ai-chat-panel__message-pill">
                      tool: {message.toolTraceEntry.toolName}
                    </span>
                    <span className="ai-chat-panel__message-pill">
                      step: {message.toolTraceEntry.stepNumber + 1}
                    </span>
                    <span
                      className={`ai-chat-panel__trace-status ai-chat-panel__trace-status--${message.toolTraceEntry.status}`}
                    >
                      {message.toolTraceEntry.status}
                    </span>
                  </div>
                  <code className="ai-chat-panel__trace-line">
                    {message.toolTraceEntry.outputSummary}
                  </code>
                </div>
              ) : null}

              {message.role === "assistant" && message.diagnostics ? (
                <div className="ai-chat-panel__message-diagnostics">
                  <div className="ai-chat-panel__message-pills">
                    {message.diagnostics.modelId ? (
                      <span className="ai-chat-panel__message-pill">
                        model: {message.diagnostics.modelId}
                      </span>
                    ) : null}
                    <span className="ai-chat-panel__message-pill">
                      steps: {message.diagnostics.stepCount}
                    </span>
                    {message.diagnostics.toolTrace.length > 0 ? (
                      <span className="ai-chat-panel__message-pill">
                        tools: {message.diagnostics.toolTrace.length}
                      </span>
                    ) : null}
                    {message.diagnostics.finishReason ? (
                      <span className="ai-chat-panel__message-pill">
                        finish: {message.diagnostics.finishReason}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </article>
          ))
        )}

        {isSubmitting ? (
          <article className="ai-chat-panel__message ai-chat-panel__message--assistant">
            <div className="ai-chat-panel__message-meta">
              <strong>Assistant</strong>
              <span>{streamingAssistantText.length > 0 ? "streaming..." : "thinking..."}</span>
            </div>
            {streamingAssistantText.length > 0 ? (
              <AiMarkdown className="ai-chat-panel__message-body" text={streamingAssistantText} />
            ) : (
              <div className="ai-chat-panel__thinking">
                <span />
                <span />
                <span />
              </div>
            )}
            {streamingToolTrace.length > 0 ? (
              <div className="ai-chat-panel__message-diagnostics">
                <div className="ai-chat-panel__message-pills">
                  <span className="ai-chat-panel__message-pill">
                    live tools: {streamingToolTrace.length}
                  </span>
                </div>
                <div className="ai-chat-panel__trace-list">
                  {streamingToolTrace.map((entry, index) => (
                    <div className="ai-chat-panel__trace-entry" key={`${entry.toolName}-${index}`}>
                      <div className="ai-chat-panel__message-pills">
                        <span className="ai-chat-panel__message-pill">
                          {entry.toolName}
                        </span>
                        <span
                          className={`ai-chat-panel__trace-status ai-chat-panel__trace-status--${entry.status}`}
                        >
                          {entry.status}
                        </span>
                      </div>
                      <code className="ai-chat-panel__trace-line">
                        {entry.outputSummary || entry.inputSummary}
                      </code>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </article>
        ) : null}
      </section>

      <form
        className="ai-chat-panel__composer"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        {errorMessage ? <div className="ai-chat-panel__error">{errorMessage}</div> : null}

        <input
          accept="image/*"
          className="ai-chat-panel__file-input"
          multiple
          onChange={(event) => {
            void handleAttachImages(event);
          }}
          ref={attachmentInputRef}
          type="file"
        />

        <textarea
          className="ai-chat-panel__composer-input"
          disabled={isSubmitting}
          onClick={(event) => {
            syncSkillCompletion(event.currentTarget.value, event.currentTarget.selectionStart);
          }}
          onChange={(event) => {
            updatePromptInput(event.currentTarget.value, event.currentTarget.selectionStart);
          }}
          onKeyDown={(event) => {
            handlePromptKeyDown(event);
          }}
          onKeyUp={(event) => {
            if (
              event.key === "ArrowLeft" ||
              event.key === "ArrowRight" ||
              event.key === "Home" ||
              event.key === "End"
            ) {
              syncSkillCompletion(event.currentTarget.value, event.currentTarget.selectionStart);
            }
          }}
          onPaste={(event) => {
            void handlePasteImages(event);
          }}
          placeholder="workspace に対してやりたいことを書く"
          ref={composerTextareaRef}
          rows={5}
          value={prompt}
        />

        {skillCompletion ? (
          <AiSkillCompletionList
            onHighlight={(index) => {
              setSkillCompletion((current) =>
                current ? { ...current, selectedIndex: index } : current
              );
            }}
            onSelect={insertPromptSkill}
            selectedIndex={selectedSkillSuggestionIndex}
            skills={visibleSkillSuggestions}
          />
        ) : null}

        <AiSkillChips skills={recognizedPromptSkills} />

        {composerAttachments.length > 0 ? (
          <div className="ai-chat-panel__attachments ai-chat-panel__attachments--composer">
            {composerAttachments.map((attachment) => (
              <figure className="ai-chat-panel__attachment" key={attachment.id}>
                <img
                  alt={attachment.name}
                  className="ai-chat-panel__attachment-image"
                  src={attachment.dataUrl}
                />
                <figcaption>{attachment.sourcePath}</figcaption>
                <button
                  className="button button--ghost ai-chat-panel__attachment-remove"
                  onClick={() => {
                    setComposerAttachments((currentAttachments) =>
                      currentAttachments.filter((currentAttachment) => currentAttachment.id !== attachment.id)
                    );
                  }}
                  type="button"
                >
                  Remove
                </button>
              </figure>
            ))}
          </div>
        ) : null}

        <div className="ai-chat-panel__composer-actions">
          <span className="ai-chat-panel__composer-hint">{composerHint}</span>

          <div className="ai-chat-panel__composer-buttons">
            <button
              className="button button--ghost"
              disabled={isSubmitting}
              onClick={() => {
                attachmentInputRef.current?.click();
              }}
              type="button"
            >
              Attach Images
            </button>
            <button
              className="button button--ghost"
              disabled={isSubmitting || isSessionMutating}
              onClick={() => {
                void handleCreateSession();
              }}
              type="button"
            >
              New Chat
            </button>
            <button
              className="button button--primary"
              disabled={isSubmitting || isLoadingHistory || prompt.trim().length === 0}
              type="submit"
            >
              {isSubmitting ? "Sending..." : "Send"}
            </button>
          </div>
        </div>
      </form>

      {isHistoryDialogOpen ? (
        <div
          className="dialog-backdrop"
          onClick={() => {
            setIsHistoryDialogOpen(false);
          }}
        >
          <div
            className="dialog-card dialog-card--ai-chat-settings"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="dialog-card__header">
              <p className="dialog-card__eyebrow">AI Chat</p>
              <h2>Chat History</h2>
              <p>保存済みの会話を開き、続きから送信できます。</p>
            </div>

            <div className="dialog-card__body dialog-card__body--ai-chat-settings">
              <div className="ai-chat-panel__dialog-section">
                <div className="ai-chat-panel__settings-header">
                  <div>
                    <span className="ai-chat-panel__context-label">Sessions</span>
                    <h3 className="ai-chat-panel__section-title">
                      {sessionCount} saved chat{sessionCount === 1 ? "" : "s"}
                    </h3>
                  </div>

                  <button
                    className="button button--ghost"
                    disabled={isSessionMutating || isSubmitting}
                    onClick={() => {
                      void handleCreateSession();
                    }}
                    type="button"
                  >
                    New Chat
                  </button>
                </div>

                <div className="ai-chat-panel__session-list">
                  {historySnapshot?.sessions.map((session) => (
                    <div
                      className={`ai-chat-panel__session-row${
                        session.id === activeSessionId ? " ai-chat-panel__session-row--active" : ""
                      }`}
                      key={session.id}
                    >
                      <button
                        className="ai-chat-panel__session-main"
                        disabled={isSessionMutating || isSubmitting}
                        onClick={() => {
                          void handleSwitchSession(session.id);
                        }}
                        type="button"
                      >
                        <strong>{session.title}</strong>
                        <span>
                          {formatSessionTime(session.updatedAt)} · {session.messageCount} messages
                          {session.workspaceRootName ? ` · ${session.workspaceRootName}` : ""}
                        </span>
                        {session.lastMessageText ? <small>{session.lastMessageText}</small> : null}
                      </button>

                      <button
                        className="button button--ghost ai-chat-panel__session-delete"
                        disabled={isSessionMutating || isSubmitting}
                        onClick={() => {
                          void handleDeleteSession(session.id);
                        }}
                        title="Delete history"
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  )) ?? (
                    <div className="ai-chat-panel__empty ai-chat-panel__empty--compact">
                      <strong>履歴はまだありません。</strong>
                    </div>
                  )}
                </div>
              </div>

              {errorMessage ? <div className="ai-chat-panel__error">{errorMessage}</div> : null}

              <div className="dialog-actions">
                <button
                  className="button button--primary"
                  onClick={() => {
                    setIsHistoryDialogOpen(false);
                  }}
                  type="button"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isSettingsDialogOpen ? (
        <div
          className="dialog-backdrop"
          onClick={() => {
            setIsSettingsDialogOpen(false);
          }}
        >
          <div
            className="dialog-card dialog-card--ai-chat-settings"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="dialog-card__header">
              <p className="dialog-card__eyebrow">AI Chat</p>
              <h2>AI Chat Settings</h2>
              <p>model、認証、chat / ?? / &gt;&gt; のsystem promptを設定します。</p>
            </div>

            <div className="dialog-card__body dialog-card__body--ai-chat-settings">
              <div className="ai-chat-panel__dialog-section">
                <div className="ai-chat-panel__settings-header">
                  <div>
                    <span className="ai-chat-panel__context-label">Connection</span>
                    <h3 className="ai-chat-panel__section-title">Runtime Settings</h3>
                  </div>

                  <div className="ai-chat-panel__status">
                    <span className="ai-chat-panel__pill">
                      Runtime Auth {status?.runtimeAuthConfigured ? "Configured" : "Missing"}
                    </span>
                    <span className="ai-chat-panel__pill">
                      Models {status?.modelCatalogSource === "live" ? "Live" : "Fallback"}
                    </span>
                  </div>
                </div>

                <div className="ai-chat-panel__settings-grid">
                  <label className="ai-chat-panel__settings-field">
                    <span className="ai-chat-panel__context-label">AI Gateway API Key</span>
                    <input
                      autoFocus
                      className="ai-chat-panel__settings-input"
                      onChange={(event) => {
                        setApiKeyInput(event.target.value);
                      }}
                      placeholder={
                        status?.apiKeyConfigured
                          ? "保存済み。変更する場合のみ入力"
                          : "optional: AI Gateway を使う場合のみ入力"
                      }
                      type="password"
                      value={apiKeyInput}
                    />
                  </label>

                  <label className="ai-chat-panel__settings-field">
                    <span className="ai-chat-panel__context-label">Model</span>
                    <select
                      className="ai-chat-panel__settings-input"
                      onChange={(event) => {
                        setSelectedModelId(event.target.value);
                      }}
                      value={selectedModelId}
                    >
                      {status?.availableModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.id}
                          {typeof model.contextWindow === "number"
                            ? ` (${formatContextWindow(model.contextWindow)})`
                            : ""}
                        </option>
                      )) ?? <option value="">モデルを読み込み中</option>}
                    </select>
                  </label>

                  <label className="ai-chat-panel__settings-field ai-chat-panel__settings-field--wide">
                    <span className="ai-chat-panel__context-label">PowerShell executable path</span>
                    <input
                      className="ai-chat-panel__settings-input"
                      onChange={(event) => {
                        setShellExecutablePathInput(event.target.value);
                      }}
                      placeholder="未設定なら pwsh を優先し、Windows PowerShell へ fallback"
                      type="text"
                      value={shellExecutablePathInput}
                    />
                    <p className="ai-chat-panel__note">
                      runShellCommand tool はこの実行ファイルを `-NoProfile -NonInteractive` 付きで使います。
                    </p>
                  </label>
                </div>

                {status?.notes.length ? (
                  <div className="ai-chat-panel__notes">
                    {status.notes.map((note) => (
                      <p className="ai-chat-panel__note" key={note}>
                        {note}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="ai-chat-panel__dialog-section">
                <div className="ai-chat-panel__settings-header">
                  <div>
                    <span className="ai-chat-panel__context-label">Prompts</span>
                    <h3 className="ai-chat-panel__section-title">System Prompts</h3>
                    <p className="ai-chat-panel__description">
                      保存すると、通常chat、??のAI挿入、&gt;&gt;のPython block生成に反映されます。
                    </p>
                  </div>

                  <button
                    className="button button--ghost"
                    disabled={isSavingSettings}
                    onClick={() => {
                      setSystemPromptInputs(status?.defaultSystemPrompts ?? DEFAULT_AI_CHAT_SYSTEM_PROMPTS);
                    }}
                    type="button"
                  >
                    Reset Prompts
                  </button>
                </div>

                <div className="ai-chat-panel__prompt-settings">
                  <label className="ai-chat-panel__settings-field ai-chat-panel__settings-field--wide">
                    <span className="ai-chat-panel__context-label">AI Chat panel</span>
                    <textarea
                      className="ai-chat-panel__settings-input ai-chat-panel__settings-textarea"
                      onChange={(event) => {
                        updateSystemPromptInput("chatPanel", event.target.value);
                      }}
                      rows={7}
                      value={systemPromptInputs.chatPanel}
                    />
                  </label>

                  <label className="ai-chat-panel__settings-field ai-chat-panel__settings-field--wide">
                    <span className="ai-chat-panel__context-label">?? AI insertion</span>
                    <textarea
                      className="ai-chat-panel__settings-input ai-chat-panel__settings-textarea"
                      onChange={(event) => {
                        updateSystemPromptInput("inlineInsertion", event.target.value);
                      }}
                      rows={8}
                      value={systemPromptInputs.inlineInsertion}
                    />
                  </label>

                  <label className="ai-chat-panel__settings-field ai-chat-panel__settings-field--wide">
                    <span className="ai-chat-panel__context-label">&gt;&gt; Python block implementation</span>
                    <textarea
                      className="ai-chat-panel__settings-input ai-chat-panel__settings-textarea"
                      onChange={(event) => {
                        updateSystemPromptInput("inlinePythonBlock", event.target.value);
                      }}
                      rows={9}
                      value={systemPromptInputs.inlinePythonBlock}
                    />
                  </label>

                  {!systemPromptInputsAreValid ? (
                    <p className="ai-chat-panel__note">
                      system prompt は3種類とも空にできません。既定値に戻す場合は Reset Prompts を使ってください。
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="ai-chat-panel__dialog-meta">
                <span className="ai-chat-panel__composer-hint">
                  {status?.catalogRefreshedAt
                    ? `Catalog refreshed: ${formatCatalogTime(status.catalogRefreshedAt)}`
                    : "Catalog not loaded yet"}
                </span>
              </div>

              {errorMessage ? <div className="ai-chat-panel__error">{errorMessage}</div> : null}

              <div className="dialog-actions">
                <button
                  className="button button--ghost"
                  disabled={isSavingSettings || isRefreshingModels}
                  onClick={() => {
                    setErrorMessage(null);
                    setIsSettingsDialogOpen(false);
                  }}
                  type="button"
                >
                  Close
                </button>
                <button
                  className="button button--ghost"
                  disabled={isRefreshingModels}
                  onClick={() => {
                    void handleRefreshModels();
                  }}
                  type="button"
                >
                  {isRefreshingModels ? "Refreshing..." : "Refresh Models"}
                </button>
                <button
                  className="button button--ghost"
                  disabled={
                    isSavingSettings || (!status?.apiKeyConfigured && apiKeyInput.trim().length === 0)
                  }
                  onClick={() => {
                    void handleClearApiKey();
                  }}
                  type="button"
                >
                  Clear Gateway Key
                </button>
                <button
                  className="button button--primary"
                  disabled={
                    isSavingSettings || selectedModelId.length === 0 || !systemPromptInputsAreValid
                  }
                  onClick={() => {
                    void handleSaveSettings();
                  }}
                  type="button"
                >
                  {isSavingSettings ? "Saving..." : "Save Settings"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isContextDialogOpen ? (
        <div
          className="dialog-backdrop"
          onClick={() => {
            setIsContextDialogOpen(false);
          }}
        >
          <div
            className="dialog-card dialog-card--ai-chat-settings"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="dialog-card__header">
              <p className="dialog-card__eyebrow">AI Chat</p>
              <h2>Workspace Context</h2>
              <p>active file と current selection を chat panel から切り離して確認できます。</p>
            </div>

            <div className="dialog-card__body dialog-card__body--ai-chat-settings">
              <div className="ai-chat-panel__dialog-section">
                <div>
                  <span className="ai-chat-panel__context-label">Context</span>
                  <h3 className="ai-chat-panel__section-title">Current Workspace Context</h3>
                </div>

                <div className="ai-chat-panel__context-grid">
                  <div className="ai-chat-panel__context-field">
                    <span className="ai-chat-panel__context-label">Workspace</span>
                    <strong>{contextSummary.workspaceRootName ?? "(未選択)"}</strong>
                  </div>
                  <div className="ai-chat-panel__context-field">
                    <span className="ai-chat-panel__context-label">Active</span>
                    <strong>{contextSummary.activeRelativePath ?? "(なし)"}</strong>
                  </div>
                  <div className="ai-chat-panel__context-field">
                    <span className="ai-chat-panel__context-label">Selected Paths</span>
                    <strong>{contextSummary.selectedPaths.length}</strong>
                  </div>
                  <div className="ai-chat-panel__context-field">
                    <span className="ai-chat-panel__context-label">Skills</span>
                    <strong>
                      {status?.availableSkills.length ?? 0} available
                    </strong>
                  </div>
                </div>

                {availableSkillInvocations.length > 0 ? (
                  <div className="ai-chat-panel__context-field ai-chat-panel__context-field--wide">
                    <span className="ai-chat-panel__context-label">
                      {status?.skillsDirectoryPath ?? "Skills"}
                    </span>
                    <AiSkillChips skills={availableSkillInvocations} />
                  </div>
                ) : null}

                {contextSummary.activeDocumentExcerpt ? (
                  <div className="ai-chat-panel__excerpt">
                    <div className="ai-chat-panel__excerpt-header">
                      <span className="ai-chat-panel__context-label">Active Document Excerpt</span>
                      <strong>
                        {contextSummary.activeDocumentName ?? "(unknown)"}{" "}
                        {contextSummary.activeDocumentKind
                          ? `[${contextSummary.activeDocumentKind}]`
                          : ""}
                      </strong>
                    </div>
                    <pre>{contextSummary.activeDocumentExcerpt}</pre>
                  </div>
                ) : (
                  <p className="ai-chat-panel__note">active document excerpt は現在ありません。</p>
                )}
              </div>

              <div className="dialog-actions">
                <button
                  className="button button--primary"
                  onClick={() => {
                    setIsContextDialogOpen(false);
                  }}
                  type="button"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SettingsIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" className="ai-chat-panel__icon-svg" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 1.9v1.55" />
      <path d="M8 12.55v1.55" />
      <path d="m3.68 3.68 1.1 1.1" />
      <path d="m11.22 11.22 1.1 1.1" />
      <path d="M1.9 8h1.55" />
      <path d="M12.55 8h1.55" />
      <path d="m3.68 12.32 1.1-1.1" />
      <path d="m11.22 4.78 1.1-1.1" />
    </svg>
  );
}

function HistoryIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" className="ai-chat-panel__icon-svg" viewBox="0 0 16 16">
      <path d="M8 2.2a5.8 5.8 0 1 1-4.1 1.7" />
      <path d="M3.3 2.6v2.8h2.8" />
      <path d="M8 5.3V8l2 1.2" />
    </svg>
  );
}

function ContextIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" className="ai-chat-panel__icon-svg" viewBox="0 0 16 16">
      <path d="M2.4 3.2h11.2v9.6H2.4z" />
      <path d="M4.4 5.3h7.2" />
      <path d="M4.4 8h7.2" />
      <path d="M4.4 10.7h4.5" />
    </svg>
  );
}

async function buildContextSummary({
  contextRelativePath,
  noteOverrides,
  selectedEntryPaths,
  workspaceRootName
}: {
  contextRelativePath: string | null;
  noteOverrides: Record<string, string>;
  selectedEntryPaths: string[];
  workspaceRootName: string | null;
}): Promise<AiChatContextSummary> {
  if (!contextRelativePath) {
    return {
      activeDocumentExcerpt: null,
      activeDocumentKind: null,
      activeDocumentName: null,
      activeRelativePath: null,
      selectedPaths: selectedEntryPaths,
      workspaceRootName
    };
  }

  const overriddenContent = noteOverrides[contextRelativePath];

  if (typeof overriddenContent === "string") {
    return {
      activeDocumentExcerpt: clampExcerpt(overriddenContent),
      activeDocumentKind: "markdown",
      activeDocumentName: getPathLeafName(contextRelativePath),
      activeRelativePath: contextRelativePath,
      selectedPaths: selectedEntryPaths,
      workspaceRootName
    };
  }

  const document = await window.integralNotes.readWorkspaceFile(contextRelativePath);

  return {
    activeDocumentExcerpt: buildDocumentExcerpt(document),
    activeDocumentKind: document.kind,
    activeDocumentName: document.name,
    activeRelativePath: contextRelativePath,
    selectedPaths: selectedEntryPaths,
    workspaceRootName
  };
}

function buildDocumentExcerpt(document: WorkspaceFileDocument): string | null {
  if (document.datasetManifest) {
    const members = document.datasetManifest.members
      .slice(0, 6)
      .map((member) => member.displayName || member.relativePath || member.managedFileId);

    return clampExcerpt(
      [
        `dataset: ${document.datasetManifest.datasetName}`,
        `kind: ${document.datasetManifest.datasetKind}`,
        `members: ${members.length > 0 ? members.join(", ") : "(none)"}`,
        `note target: ${document.datasetManifest.noteTargetId}`
      ].join("\n")
    );
  }

  if (typeof document.content !== "string" || document.content.trim().length === 0) {
    return null;
  }

  if (document.kind === "html") {
    return clampExcerpt(document.content.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim());
  }

  if (document.kind === "image" || document.kind === "unsupported") {
    return null;
  }

  return clampExcerpt(document.content);
}

function clampExcerpt(value: string): string {
  const normalized = value.replace(/\r\n/gu, "\n").trim();

  if (normalized.length <= 640) {
    return normalized;
  }

  return `${normalized.slice(0, 640).trimEnd()}\n...`;
}

function formatMessageTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return value;
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatCatalogTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return value;
  }

  return date.toLocaleString([], {
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    day: "2-digit"
  });
}

function formatSessionTime(value: AiChatSessionSummary["updatedAt"]): string {
  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return value;
  }

  return date.toLocaleString([], {
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    day: "2-digit"
  });
}

function formatContextWindow(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  }

  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }

  return String(value);
}

function createChatMessageId(role: "assistant" | "tool" | "user"): string {
  return `chat-${role}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createChatStreamId(): string {
  return `chat-stream-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function extractImageFilesFromClipboardData(clipboardData: DataTransfer): File[] {
  const imageFiles: File[] = [];
  const seenKeys = new Set<string>();

  const pushImageFile = (file: File | null | undefined): void => {
    if (!file || !file.type.startsWith("image/")) {
      return;
    }

    const key = `${file.name}-${file.size}-${file.type}-${file.lastModified}`;
    if (seenKeys.has(key)) {
      return;
    }

    seenKeys.add(key);
    imageFiles.push(file);
  };

  for (const item of Array.from(clipboardData.items)) {
    if (item.kind !== "file") {
      continue;
    }

    pushImageFile(item.getAsFile());
  }

  for (const file of Array.from(clipboardData.files)) {
    pushImageFile(file);
  }

  return imageFiles;
}

async function createImageAttachment(file: File): Promise<AiChatImageAttachment> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name} is not an image file.`);
  }

  const sourcePath = window.integralNotes.getPathForFile(file) || file.name;

  return {
    dataUrl: await readFileAsDataUrl(file),
    id: createChatAttachmentId(sourcePath),
    mediaType: file.type || "image/*",
    name: file.name,
    sourcePath
  };
}

function mergeImageAttachments(
  currentAttachments: AiChatImageAttachment[],
  nextAttachments: AiChatImageAttachment[]
): AiChatImageAttachment[] {
  const attachmentsById = new Map(currentAttachments.map((attachment) => [attachment.id, attachment] as const));

  for (const attachment of nextAttachments) {
    attachmentsById.set(attachment.id, attachment);
  }

  return Array.from(attachmentsById.values());
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}.`));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Unexpected file reader result for ${file.name}.`));
        return;
      }

      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function createChatAttachmentId(sourcePath: string): string {
  return `chat-attachment-${sourcePath.replace(/[^a-z0-9]+/giu, "-").toLowerCase()}`;
}

function getPathLeafName(relativePath: string): string {
  const segments = relativePath.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? relativePath;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
