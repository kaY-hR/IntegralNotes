import { useEffect, useState } from "react";

import {
  DEFAULT_ANALYSIS_RESULT_DIRECTORY,
  DEFAULT_DATA_REGISTRATION_DIRECTORY,
  DEFAULT_USER_ID,
  type AppSettings,
  type SaveAppSettingsRequest
} from "../shared/appSettings";

interface AppSettingsDialogProps {
  onClose: () => void;
  onOpenAiSettings: () => void;
  onSave: (request: SaveAppSettingsRequest) => Promise<void>;
  pending: boolean;
  settings: AppSettings | null;
}

export function AppSettingsDialog({
  onClose,
  onOpenAiSettings,
  onSave,
  pending,
  settings
}: AppSettingsDialogProps): JSX.Element {
  const [analysisResultDirectoryInput, setAnalysisResultDirectoryInput] = useState(
    settings?.analysisResultDirectory ?? DEFAULT_ANALYSIS_RESULT_DIRECTORY
  );
  const [dataRegistrationDirectoryInput, setDataRegistrationDirectoryInput] = useState(
    settings?.dataRegistrationDirectory ?? DEFAULT_DATA_REGISTRATION_DIRECTORY
  );
  const [userIdInput, setUserIdInput] = useState(settings?.userId ?? DEFAULT_USER_ID);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setAnalysisResultDirectoryInput(
      settings?.analysisResultDirectory ?? DEFAULT_ANALYSIS_RESULT_DIRECTORY
    );
    setDataRegistrationDirectoryInput(
      settings?.dataRegistrationDirectory ?? DEFAULT_DATA_REGISTRATION_DIRECTORY
    );
    setUserIdInput(settings?.userId ?? DEFAULT_USER_ID);
  }, [settings]);

  const handleSave = async (): Promise<void> => {
    setErrorMessage(null);

    try {
      await onSave({
        analysisResultDirectory: analysisResultDirectoryInput,
        dataRegistrationDirectory: dataRegistrationDirectoryInput,
        userId: userIdInput
      });
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog-card dialog-card--app-settings"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="dialog-card__header">
          <h2>設定</h2>
          <p>本体設定とAI関連設定を変更します。</p>
        </div>

        <div className="dialog-card__body dialog-card__body--app-settings">
          <section className="app-settings-dialog__section">
            <label className="dialog-field">
              <span>データ登録フォルダ</span>
              <input
                autoFocus
                disabled={pending}
                onChange={(event) => {
                  setDataRegistrationDirectoryInput(event.target.value);
                }}
                placeholder={DEFAULT_DATA_REGISTRATION_DIRECTORY}
                type="text"
                value={dataRegistrationDirectoryInput}
              />
            </label>
            <p className="app-settings-dialog__note">
              外部ファイルやフォルダを managed file として取り込むときの workspace 内配置先です。
            </p>
          </section>

          <section className="app-settings-dialog__section">
            <label className="dialog-field">
              <span>解析結果フォルダ</span>
              <input
                disabled={pending}
                onChange={(event) => {
                  setAnalysisResultDirectoryInput(event.target.value);
                }}
                placeholder={DEFAULT_ANALYSIS_RESULT_DIRECTORY}
                type="text"
                value={analysisResultDirectoryInput}
              />
            </label>
            <p className="app-settings-dialog__note">
              `.idts` output の既定保存先 root として使います。
            </p>
          </section>

          <section className="app-settings-dialog__section">
            <label className="dialog-field">
              <span>ユーザーID</span>
              <input
                disabled={pending}
                onChange={(event) => {
                  setUserIdInput(event.target.value);
                }}
                placeholder="例: shimadzu"
                spellCheck={false}
                type="text"
                value={userIdInput}
              />
            </label>
            <p className="app-settings-dialog__note">
              LLM が datatype 名に名前空間を付けるときの既定 prefix として使います。
            </p>
          </section>

          <section className="app-settings-dialog__section">
            <div className="app-settings-dialog__section-header">
              <strong>AI関連設定</strong>
              <button
                className="button button--ghost"
                disabled={pending}
                onClick={onOpenAiSettings}
                type="button"
              >
                AI関連設定
              </button>
            </div>
          </section>

          {errorMessage ? <div className="ai-chat-panel__error">{errorMessage}</div> : null}

          <div className="dialog-actions">
            <button className="button button--ghost" disabled={pending} onClick={onClose} type="button">
              閉じる
            </button>
            <button
              className="button button--primary"
              disabled={pending}
              onClick={() => {
                void handleSave();
              }}
              type="button"
            >
              {pending ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
