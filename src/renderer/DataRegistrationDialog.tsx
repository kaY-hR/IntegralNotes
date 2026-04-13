import { useState } from "react";

import type { IntegralBlobSummary } from "../shared/integral";

import { BlobPickerDialog } from "./IntegralAssetDialogs";

interface DataRegistrationDialogProps {
  onClose: () => void;
  onError: (message: string) => void;
  onImportDirectories: () => Promise<void>;
  onImportFiles: () => Promise<void>;
  onImportedBlobs?: (
    blobs: readonly IntegralBlobSummary[],
    kind: "directories" | "files"
  ) => Promise<void> | void;
  onSourceChunkCreated: (chunkId: string) => void;
}

type DataRegistrationMode = "menu" | "source-chunk";

export function DataRegistrationDialog({
  onClose,
  onError,
  onImportDirectories,
  onImportFiles,
  onImportedBlobs,
  onSourceChunkCreated
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

  if (mode === "source-chunk") {
    return (
      <BlobPickerDialog
        onClose={() => {
          setMode("menu");
        }}
        onError={onError}
        onImportedBlobs={onImportedBlobs}
        onSelectChunk={(chunkId) => {
          onSourceChunkCreated(chunkId);
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
          <p>blob 登録と source chunk 作成の入口をここに集約します。</p>
        </div>

        <div className="dialog-card__body dialog-card__body--data-registration">
          <section className="data-registration-card">
            <div>
              <strong>Blob を登録</strong>
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
                {pendingAction === "files" ? "登録中..." : "ファイルを blob 登録"}
              </button>
              <button
                className="button button--ghost"
                disabled={pendingAction !== null}
                onClick={() => {
                  void handleImport("directories");
                }}
                type="button"
              >
                {pendingAction === "directories" ? "登録中..." : "フォルダを blob 登録"}
              </button>
            </div>
          </section>

          <section className="data-registration-card">
            <div>
              <strong>Chunk を作成</strong>
              <p>複数 blob を選び、`links.json` ベースの source chunk を作成します。</p>
            </div>
            <div className="data-registration-card__actions">
              <button
                className="button button--primary"
                disabled={pendingAction !== null}
                onClick={() => {
                  setMode("source-chunk");
                }}
                type="button"
              >
                source chunk を作成
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
