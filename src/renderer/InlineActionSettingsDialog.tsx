import { useEffect, useMemo, useState } from "react";

import type {
  InlineActionDefinition,
  InlineActionReadScope,
  SaveInlineActionRequest
} from "../shared/aiChat";

interface InlineActionSettingsDialogProps {
  onChanged?: () => void;
  onClose: () => void;
  onError?: (message: string) => void;
}

const READ_SCOPE_OPTIONS: Array<{ label: string; value: InlineActionReadScope }> = [
  { label: "現在のMarkdownのみ", value: "current-document-only" },
  { label: "現在のMarkdown + 選択ファイル", value: "current-document-and-selected-files" },
  { label: "選択ファイルのみ", value: "selected-files" },
  { label: "同一フォルダ", value: "same-folder" },
  { label: "指定ディレクトリ", value: "specific-dirs" },
  { label: "ワークスペース全体", value: "entire-workspace" }
];

const DEFAULT_DRAFT: SaveInlineActionRequest = {
  canAnswerOnly: true,
  canCreatePythonBlockDraft: true,
  canEditWorkspaceFiles: true,
  canInsertMarkdown: true,
  canRunShellCommand: true,
  description: "",
  name: "",
  promptRequired: true,
  readDirs: [],
  readScope: "entire-workspace",
  systemPrompt: ""
};

export function InlineActionSettingsDialog({
  onChanged,
  onClose,
  onError
}: InlineActionSettingsDialogProps): JSX.Element {
  const [actions, setActions] = useState<InlineActionDefinition[]>([]);
  const [draft, setDraft] = useState<SaveInlineActionRequest>(DEFAULT_DRAFT);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const selectedAction = useMemo(
    () => actions.find((action) => action.name === selectedName) ?? null,
    [actions, selectedName]
  );
  const readDirsText = (draft.readDirs ?? []).join("\n");
  const canSave = draft.name.trim().length > 0 && draft.systemPrompt.trim().length > 0;

  const reportError = (error: unknown): void => {
    const message = toErrorMessage(error);
    setErrorMessage(message);
    onError?.(message);
  };

  const loadActions = async (): Promise<void> => {
    try {
      const nextActions = await window.integralNotes.listInlineActions();
      setActions(nextActions);

      if (!selectedName && nextActions.length > 0) {
        applyActionToDraft(nextActions[0]);
      }
    } catch (error) {
      reportError(error);
    }
  };

  useEffect(() => {
    void loadActions();
  }, []);

  const applyActionToDraft = (action: InlineActionDefinition): void => {
    setSelectedName(action.name);
    setDraft({
      canAnswerOnly: action.canAnswerOnly,
      canCreatePythonBlockDraft: action.canCreatePythonBlockDraft,
      canEditWorkspaceFiles: action.canEditWorkspaceFiles,
      canInsertMarkdown: action.canInsertMarkdown,
      canRunShellCommand: action.canRunShellCommand,
      description: action.description,
      name: action.name,
      promptRequired: action.promptRequired,
      readDirs: action.readDirs,
      readScope: action.readScope,
      systemPrompt: action.systemPrompt
    });
    setErrorMessage(null);
  };

  const updateDraft = <Key extends keyof SaveInlineActionRequest>(
    key: Key,
    value: SaveInlineActionRequest[Key]
  ): void => {
    setDraft((current) => ({
      ...current,
      [key]: value
    }));
  };

  const handleCreateNew = (): void => {
    setSelectedName(null);
    setDraft({
      ...DEFAULT_DRAFT,
      readDirs: [],
      systemPrompt: [
        "You are running inside an IntegralNotes inline action.",
        "Follow the user's instruction and commit the result with the available tools."
      ].join("\n")
    });
    setErrorMessage(null);
  };

  const handleSave = async (): Promise<void> => {
    setIsPending(true);
    setErrorMessage(null);

    try {
      const saved = await window.integralNotes.saveInlineAction(draft);
      const nextActions = await window.integralNotes.listInlineActions();
      setActions(nextActions);
      applyActionToDraft(saved);
      onChanged?.();
    } catch (error) {
      reportError(error);
    } finally {
      setIsPending(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!selectedAction) {
      return;
    }

    setIsPending(true);
    setErrorMessage(null);

    try {
      const nextActions = await window.integralNotes.deleteInlineAction(selectedAction.name);
      setActions(nextActions);

      if (nextActions.length > 0) {
        applyActionToDraft(nextActions[0]);
      } else {
        handleCreateNew();
      }

      onChanged?.();
    } catch (error) {
      reportError(error);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog-card dialog-card--inline-action-settings"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="dialog-card__header">
          <p className="dialog-card__eyebrow">Inline Action</p>
          <h2>Inline Action Settings</h2>
          <p>
            .inline-action/*.md をGUIから編集します。@@ でpicker、?? は @@auto-continue、
            &gt;&gt; は @@make-python-block です。
          </p>
        </div>

        <div className="dialog-card__body dialog-card__body--inline-action-settings">
          <aside className="inline-action-settings__list">
            <button
              className="button button--primary button--xs"
              onClick={handleCreateNew}
              type="button"
            >
              新規作成
            </button>
            {actions.map((action) => (
              <button
                className={`inline-action-settings__list-item${
                  action.name === selectedName ? " inline-action-settings__list-item--active" : ""
                }`}
                key={action.name}
                onClick={() => {
                  applyActionToDraft(action);
                }}
                type="button"
              >
                <strong>@@{action.name}</strong>
                <span>{action.description || action.relativePath}</span>
              </button>
            ))}
          </aside>

          <section className="inline-action-settings__form">
            <div className="inline-action-settings__grid">
              <label className="dialog-field">
                <span>Command</span>
                <input
                  onChange={(event) => {
                    updateDraft("name", event.target.value);
                  }}
                  placeholder="my-action"
                  type="text"
                  value={draft.name}
                />
              </label>

              <label className="dialog-field">
                <span>Description</span>
                <input
                  onChange={(event) => {
                    updateDraft("description", event.target.value);
                  }}
                  placeholder="pickerに表示する説明"
                  type="text"
                  value={draft.description}
                />
              </label>
            </div>

            <label className="inline-action-settings__prompt-field">
              <span>Prompt</span>
              <textarea
                onChange={(event) => {
                  updateDraft("systemPrompt", event.target.value);
                }}
                placeholder="この inline action の system prompt"
                rows={10}
                value={draft.systemPrompt}
              />
            </label>

            <div className="inline-action-settings__checks">
              <label>
                <input
                  checked={draft.promptRequired}
                  onChange={(event) => {
                    updateDraft("promptRequired", event.target.checked);
                  }}
                  type="checkbox"
                />
                User prompt required
              </label>
              <label>
                <input
                  checked={draft.canInsertMarkdown}
                  onChange={(event) => {
                    updateDraft("canInsertMarkdown", event.target.checked);
                  }}
                  type="checkbox"
                />
                insertMarkdownAtCursor
              </label>
              <label>
                <input
                  checked={draft.canEditWorkspaceFiles}
                  onChange={(event) => {
                    updateDraft("canEditWorkspaceFiles", event.target.checked);
                  }}
                  type="checkbox"
                />
                workspace file edit
              </label>
              <label>
                <input
                  checked={draft.canRunShellCommand}
                  onChange={(event) => {
                    updateDraft("canRunShellCommand", event.target.checked);
                  }}
                  type="checkbox"
                />
                shell command
              </label>
              <label>
                <input
                  checked={draft.canCreatePythonBlockDraft}
                  onChange={(event) => {
                    updateDraft("canCreatePythonBlockDraft", event.target.checked);
                  }}
                  type="checkbox"
                />
                Python block draft
              </label>
              <label>
                <input
                  checked={draft.canAnswerOnly}
                  onChange={(event) => {
                    updateDraft("canAnswerOnly", event.target.checked);
                  }}
                  type="checkbox"
                />
                answer-only allowed
              </label>
            </div>

            <div className="inline-action-settings__grid">
              <label className="dialog-field">
                <span>Read scope</span>
                <select
                  onChange={(event) => {
                    updateDraft("readScope", event.target.value as InlineActionReadScope);
                  }}
                  value={draft.readScope}
                >
                  {READ_SCOPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="inline-action-settings__dirs-field">
                <span>Read dirs</span>
                <textarea
                  disabled={draft.readScope !== "specific-dirs"}
                  onChange={(event) => {
                    updateDraft(
                      "readDirs",
                      event.target.value
                        .split(/\r?\n/gu)
                        .map((line) => line.trim())
                        .filter(Boolean)
                    );
                  }}
                  placeholder={"specific-dirs のときだけ使用\n例: docs\n例: scripts"}
                  rows={4}
                  value={readDirsText}
                />
              </label>
            </div>

            {errorMessage ? <div className="dialog-error">{errorMessage}</div> : null}

            <div className="dialog-actions">
              <button
                className="button button--ghost"
                disabled={isPending}
                onClick={onClose}
                type="button"
              >
                閉じる
              </button>
              <button
                className="button button--ghost"
                disabled={isPending || !selectedAction}
                onClick={() => {
                  void handleDelete();
                }}
                type="button"
              >
                削除
              </button>
              <button
                className="button button--primary"
                disabled={isPending || !canSave}
                onClick={() => {
                  void handleSave();
                }}
                type="button"
              >
                保存
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
