import { useEffect, useMemo, useState } from "react";

import {
  DEFAULT_AI_CHAT_SYSTEM_PROMPTS,
  type AiChatStatus,
  type AiChatSystemPrompts
} from "../shared/aiChat";

interface AIChatSettingsDialogProps {
  onClose: () => void;
  onError?: (message: string) => void;
  onStatusChange?: (status: AiChatStatus) => void;
  status?: AiChatStatus | null;
}

export function AIChatSettingsDialog({
  onClose,
  onError,
  onStatusChange,
  status: statusProp
}: AIChatSettingsDialogProps): JSX.Element {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [shellExecutablePathInput, setShellExecutablePathInput] = useState("");
  const [status, setStatus] = useState<AiChatStatus | null>(statusProp ?? null);
  const [systemPromptInputs, setSystemPromptInputs] = useState<AiChatSystemPrompts>(
    DEFAULT_AI_CHAT_SYSTEM_PROMPTS
  );

  const applyStatus = (nextStatus: AiChatStatus): void => {
    setStatus(nextStatus);
    onStatusChange?.(nextStatus);
  };

  const reportError = (error: unknown): void => {
    const message = toErrorMessage(error);
    setErrorMessage(message);
    onError?.(message);
  };

  useEffect(() => {
    if (statusProp !== undefined) {
      setStatus(statusProp);
    }
  }, [statusProp]);

  useEffect(() => {
    let cancelled = false;

    const loadStatus = async (): Promise<void> => {
      try {
        const nextStatus = await window.integralNotes.getAiChatStatus();

        if (!cancelled) {
          applyStatus(nextStatus);
        }
      } catch (error) {
        if (!cancelled) {
          reportError(error);
        }
      }
    };

    void loadStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!status) {
      return;
    }

    if (!selectedModelId || !status.availableModels.some((model) => model.id === selectedModelId)) {
      setSelectedModelId(status.selectedModelId ?? status.availableModels[0]?.id ?? "");
    }
  }, [selectedModelId, status]);

  useEffect(() => {
    if (!status) {
      return;
    }

    setShellExecutablePathInput(status.shellExecutablePath ?? "");
    setSystemPromptInputs(status.systemPrompts);
  }, [status]);

  const systemPromptInputsAreValid = useMemo(
    () =>
      systemPromptInputs.chatPanel.trim().length > 0 &&
      systemPromptInputs.inlineInsertion.trim().length > 0 &&
      systemPromptInputs.inlinePythonBlock.trim().length > 0 &&
      systemPromptInputs.promptlessContinuation.trim().length > 0,
    [systemPromptInputs]
  );

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

      applyStatus(nextStatus);
      setApiKeyInput("");
      setSelectedModelId(nextStatus.selectedModelId ?? nextStatus.availableModels[0]?.id ?? "");
      setShellExecutablePathInput(nextStatus.shellExecutablePath ?? "");
      setSystemPromptInputs(nextStatus.systemPrompts);
      onClose();
    } catch (error) {
      reportError(error);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleClearApiKey = async (): Promise<void> => {
    setErrorMessage(null);
    setIsSavingSettings(true);

    try {
      const nextStatus = await window.integralNotes.clearAiChatApiKey();
      applyStatus(nextStatus);
      setApiKeyInput("");
    } catch (error) {
      reportError(error);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleRefreshModels = async (): Promise<void> => {
    setErrorMessage(null);
    setIsRefreshingModels(true);

    try {
      const nextStatus = await window.integralNotes.refreshAiChatModels();
      applyStatus(nextStatus);
      setSelectedModelId(nextStatus.selectedModelId ?? nextStatus.availableModels[0]?.id ?? "");
    } catch (error) {
      reportError(error);
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

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog-card dialog-card--ai-chat-settings"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="dialog-card__header">
          <p className="dialog-card__eyebrow">AI Chat</p>
          <h2>AI Chat Settings</h2>
          <p>model、認証、chat / ?? / &gt;&gt; / @@ のsystem promptを設定します。</p>
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
                  保存すると、通常chat、??のAI挿入、&gt;&gt;のPython block生成、@@の続きを生成に反映されます。
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

              <label className="ai-chat-panel__settings-field ai-chat-panel__settings-field--wide">
                <span className="ai-chat-panel__context-label">@@ Promptless continuation</span>
                <textarea
                  className="ai-chat-panel__settings-input ai-chat-panel__settings-textarea"
                  onChange={(event) => {
                    updateSystemPromptInput("promptlessContinuation", event.target.value);
                  }}
                  rows={9}
                  value={systemPromptInputs.promptlessContinuation}
                />
              </label>

              {!systemPromptInputsAreValid ? (
                <p className="ai-chat-panel__note">
                  system prompt は4種類とも空にできません。既定値に戻す場合は Reset Prompts を使ってください。
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
                onClose();
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
              disabled={isSavingSettings || (!status?.apiKeyConfigured && apiKeyInput.trim().length === 0)}
              onClick={() => {
                void handleClearApiKey();
              }}
              type="button"
            >
              Clear Gateway Key
            </button>
            <button
              className="button button--primary"
              disabled={isSavingSettings || selectedModelId.length === 0 || !systemPromptInputsAreValid}
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
  );
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

function formatContextWindow(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  }

  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }

  return String(value);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
