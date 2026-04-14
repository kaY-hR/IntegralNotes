import { useState } from "react";

import type { IntegralOriginalDataSummary } from "../shared/integral";

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
  onSourceDatasetCreated: (datasetId: string) => void;
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
        onSelectDataset={(datasetId) => {
          onSourceDatasetCreated(datasetId);
        }}
      />
    );
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog-card dialog-card--data-registration">
        <div className="dialog-card__header">
          <p className="dialog-card__eyebrow">Data Intake</p>
          <h2>データ登録</h2>
          <p>元データの登録と source dataset 作成の入口をここに集約します。</p>
        </div>

        <div className="dialog-card__body dialog-card__body--data-registration">
          <section className="data-registration-card">
            <div>
              <strong>元データを登録</strong>
              <p>元データを file / directory 単位で workspace に取り込みます。</p>
            </div>
            <div className="data-registration-card__actions">
              <button
                className="button button--ghost"
                disabled={pendingAction !== null}
                onClick={() => {
                  void handleImport("files");
                }}
                type="button"
              >
                {pendingAction === "files" ? "登録中..." : "ファイルを元データ登録"}
              </button>
              <button
                className="button button--ghost"
                disabled={pendingAction !== null}
                onClick={() => {
                  void handleImport("directories");
                }}
                type="button"
              >
                {pendingAction === "directories" ? "登録中..." : "フォルダを元データ登録"}
              </button>
            </div>
          </section>

          <section className="data-registration-card">
            <div>
              <strong>Dataset を作成</strong>
              <p>複数の元データを選び、`links.json` ベースの source dataset を作成します。</p>
            </div>
            <div className="data-registration-card__actions">
              <button
                className="button button--primary"
                disabled={pendingAction !== null}
                onClick={() => {
                  setMode("source-dataset");
                }}
                type="button"
              >
                source dataset を作成
              </button>
            </div>
          </section>

          <div className="dialog-actions">
            <button className="button button--ghost" onClick={onClose} type="button">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
