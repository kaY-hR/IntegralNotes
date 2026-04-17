import { useState } from "react";

import type {
  IntegralDatasetSummary,
  IntegralOriginalDataSummary
} from "../shared/integral";

import { OriginalDataPickerDialog } from "./IntegralAssetDialogs";

interface DataRegistrationDialogProps {
  onClose: () => void;
  onError: (message: string) => void;
  onImportDirectories: () => Promise<void>;
  onImportFiles: () => Promise<void>;
  onImportedOriginalData?: (
    originalData: readonly IntegralOriginalDataSummary[],
    kind: "directories" | "files"
  ) => Promise<void> | void;
  onSourceDatasetCreated: (dataset: IntegralDatasetSummary) => void;
}

type DataRegistrationMode = "menu" | "source-dataset";

export function DataRegistrationDialog({
  onClose,
  onError,
  onImportDirectories,
  onImportFiles,
  onImportedOriginalData,
  onSourceDatasetCreated
}: DataRegistrationDialogProps): JSX.Element {
  const [mode, setMode] = useState<DataRegistrationMode>("menu");
  const [pendingAction, setPendingAction] = useState<"directories" | "files" | null>(null);

  const handleImport = async (kind: "directories" | "files"): Promise<void> => {
    setPendingAction(kind);

    try {
      if (kind === "files") {
        await onImportFiles();
      } else {
        await onImportDirectories();
      }
    } finally {
      setPendingAction(null);
    }
  };

  if (mode === "source-dataset") {
    return (
      <OriginalDataPickerDialog
        onClose={() => {
          setMode("menu");
        }}
        onError={onError}
        onImportedOriginalData={onImportedOriginalData}
        onSelectDataset={(dataset) => {
          onSourceDatasetCreated(dataset);
        }}
      />
    );
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog-card dialog-card--data-registration">
        <div className="dialog-card__header">
          <h2>データ登録</h2>
          <p>データファイルの取り込みと dataset の作成</p>
        </div>

        <div className="dialog-card__body dialog-card__body--data-registration">
          <section className="data-registration-card">
            <strong>データファイルを取り込む</strong>
            <p>外部のファイルやフォルダを workspace に登録します。</p>
            <div className="data-registration-card__actions">
              <button
                className="button button--ghost"
                disabled={pendingAction !== null}
                onClick={() => {
                  void handleImport("files");
                }}
                type="button"
              >
                {pendingAction === "files" ? "登録中..." : "ファイル"}
              </button>
              <button
                className="button button--ghost"
                disabled={pendingAction !== null}
                onClick={() => {
                  void handleImport("directories");
                }}
                type="button"
              >
                {pendingAction === "directories" ? "登録中..." : "フォルダ"}
              </button>
            </div>
          </section>

          <section className="data-registration-card">
            <strong>Dataset を作成</strong>
            <p>登録済みのデータファイルを組み合わせて dataset を作成します。</p>
            <div className="data-registration-card__actions">
              <button
                className="button button--primary"
                disabled={pendingAction !== null}
                onClick={() => {
                  setMode("source-dataset");
                }}
                type="button"
              >
                作成する
              </button>
            </div>
          </section>

          <div className="dialog-actions">
            <button className="button button--ghost" onClick={onClose} type="button">
              閉じる
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
