import * as FlexLayout from "flexlayout-react";
import { useEffect, useMemo, useState } from "react";

import type {
  IntegralBlobSummary,
  IntegralChunkInspection,
  IntegralChunkSummary
} from "../shared/integral";

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}

interface ChunkPickerDialogProps {
  acceptedKinds?: string[];
  onClose: () => void;
  onError: (message: string) => void;
  onSelect: (chunkId: string) => void;
}

export function ChunkPickerDialog({
  acceptedKinds,
  onClose,
  onError,
  onSelect
}: ChunkPickerDialogProps): JSX.Element {
  const [chunks, setChunks] = useState<IntegralChunkSummary[]>([]);
  const [selectedChunkId, setSelectedChunkId] = useState("");

  useEffect(() => {
    void window.integralNotes
      .getIntegralAssetCatalog()
      .then((catalog) => {
        setChunks(catalog.chunks);
      })
      .catch((error) => {
        onError(toErrorMessage(error));
      });
  }, [onError]);

  const sortedChunks = useMemo(() => {
    return [...chunks].sort((left, right) => {
      const leftPreferred = acceptedKinds?.includes(left.kind) ?? false;
      const rightPreferred = acceptedKinds?.includes(right.kind) ?? false;

      if (leftPreferred !== rightPreferred) {
        return leftPreferred ? -1 : 1;
      }

      return right.createdAt.localeCompare(left.createdAt);
    });
  }, [acceptedKinds, chunks]);

  return (
    <div className="dialog-backdrop">
      <div className="dialog-card dialog-card--asset-picker">
        <div className="dialog-card__header">
          <p className="dialog-card__eyebrow">Chunk Picker</p>
          <h2>Chunk を選択</h2>
          <p>slot には 1 つの chunk だけを割り当てます。</p>
        </div>

        <div className="dialog-card__body dialog-card__body--asset-picker">
          {acceptedKinds && acceptedKinds.length > 0 ? (
            <p className="asset-picker__hint">候補 kind: {acceptedKinds.join(", ")}</p>
          ) : null}

          <div className="asset-picker__list">
            {sortedChunks.length > 0 ? (
              sortedChunks.map((chunk) => (
                <label className="asset-picker__row" key={chunk.chunkId}>
                  <input
                    checked={selectedChunkId === chunk.chunkId}
                    name="chunk-picker"
                    onChange={() => {
                      setSelectedChunkId(chunk.chunkId);
                    }}
                    type="radio"
                  />
                  <div>
                    <strong>{chunk.chunkId}</strong>
                    <div className="asset-picker__meta">
                      <span>{chunk.kind}</span>
                      <span>{chunk.renderableCount} renderable</span>
                    </div>
                  </div>
                </label>
              ))
            ) : (
              <div className="asset-picker__empty">登録済み chunk がありません。</div>
            )}
          </div>

          <div className="dialog-actions">
            <button className="button button--ghost" onClick={onClose} type="button">
              Close
            </button>
            <button
              className="button button--primary"
              disabled={!selectedChunkId}
              onClick={() => {
                onSelect(selectedChunkId);
              }}
              type="button"
            >
              Select
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface BlobPickerDialogProps {
  onClose: () => void;
  onError: (message: string) => void;
  onSelectChunk: (chunkId: string) => void;
}

export function BlobPickerDialog({
  onClose,
  onError,
  onSelectChunk
}: BlobPickerDialogProps): JSX.Element {
  const [blobs, setBlobs] = useState<IntegralBlobSummary[]>([]);
  const [selectedBlobIds, setSelectedBlobIds] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);

  const reloadBlobs = async (): Promise<void> => {
    const catalog = await window.integralNotes.getIntegralAssetCatalog();
    setBlobs(catalog.blobs);
  };

  useEffect(() => {
    void reloadBlobs().catch((error) => {
      onError(toErrorMessage(error));
    });
  }, [onError]);

  const importBlobs = async (kind: "files" | "directories"): Promise<void> => {
    setPending(true);

    try {
      const result =
        kind === "files"
          ? await window.integralNotes.importBlobFiles()
          : await window.integralNotes.importBlobDirectories();

      if (!result) {
        return;
      }

      setSelectedBlobIds((current) => {
        const next = new Set(current);
        result.blobs.forEach((blob) => next.add(blob.blobId));
        return next;
      });
      await reloadBlobs();
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const createSourceChunk = async (): Promise<void> => {
    setPending(true);

    try {
      const result = await window.integralNotes.createSourceChunk({
        blobIds: Array.from(selectedBlobIds)
      });

      onSelectChunk(result.chunk.chunkId);
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="dialog-backdrop">
      <div className="dialog-card dialog-card--asset-picker">
        <div className="dialog-card__header">
          <p className="dialog-card__eyebrow">Blob Picker</p>
          <h2>Blob から source chunk を作成</h2>
          <p>複数 blob を選ぶと app が `source-bundle` chunk を生成します。</p>
        </div>

        <div className="dialog-card__body dialog-card__body--asset-picker">
          <div className="asset-picker__toolbar">
            <button className="button button--ghost" disabled={pending} onClick={() => {
              void importBlobs("files");
            }} type="button">
              ファイルを追加
            </button>
            <button className="button button--ghost" disabled={pending} onClick={() => {
              void importBlobs("directories");
            }} type="button">
              フォルダを追加
            </button>
          </div>

          <div className="asset-picker__list">
            {blobs.length > 0 ? (
              blobs.map((blob) => {
                const checked = selectedBlobIds.has(blob.blobId);

                return (
                  <label className="asset-picker__row" key={blob.blobId}>
                    <input
                      checked={checked}
                      onChange={() => {
                        setSelectedBlobIds((current) => {
                          const next = new Set(current);

                          if (checked) {
                            next.delete(blob.blobId);
                          } else {
                            next.add(blob.blobId);
                          }

                          return next;
                        });
                      }}
                      type="checkbox"
                    />
                    <div>
                      <strong>{blob.blobId}</strong>
                      <div className="asset-picker__meta">
                        <span>{blob.originalName}</span>
                        <span>{blob.sourceKind}</span>
                      </div>
                    </div>
                  </label>
                );
              })
            ) : (
              <div className="asset-picker__empty">登録済み blob がありません。</div>
            )}
          </div>

          <div className="dialog-actions">
            <button className="button button--ghost" disabled={pending} onClick={onClose} type="button">
              Close
            </button>
            <button
              className="button button--primary"
              disabled={pending || selectedBlobIds.size === 0}
              onClick={() => {
                void createSourceChunk();
              }}
              type="button"
            >
              {pending ? "作成中..." : "Create Source Chunk"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChunkRenderableView({ chunkId }: { chunkId: string | null }): JSX.Element {
  const [inspection, setInspection] = useState<IntegralChunkInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const model = useMemo(() => {
    if (!inspection || inspection.renderables.length === 0) {
      return null;
    }

    return FlexLayout.Model.fromJson({
      global: {
        splitterSize: 6,
        tabEnableRename: false,
        tabSetEnableDeleteWhenEmpty: false,
        tabSetEnableMaximize: false,
        tabSetEnableTabScrollbar: true
      },
      layout: {
        type: "row",
        children: [
          {
            type: "tabset",
            weight: 100,
            enableDeleteWhenEmpty: false,
            children: inspection.renderables.map((renderable) => ({
              type: "tab",
              id: `renderable::${inspection.chunkId}::${renderable.relativePath}`,
              component: "renderable",
              name: renderable.name,
              config: renderable
            }))
          }
        ]
      }
    });
  }, [inspection]);

  useEffect(() => {
    if (!chunkId) {
      setInspection(null);
      setError(null);
      return;
    }

    let cancelled = false;

    setInspection(null);
    setError(null);

    void window.integralNotes
      .inspectChunk(chunkId)
      .then((result) => {
        if (!cancelled) {
          setInspection(result);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(toErrorMessage(nextError));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [chunkId]);

  if (!chunkId) {
    return <div className="integral-renderable__empty">表示対象 chunk が未設定です。</div>;
  }

  if (error) {
    return <div className="integral-renderable__empty">{error}</div>;
  }

  if (!inspection) {
    return <div className="integral-renderable__empty">chunk を読み込み中...</div>;
  }

  if (inspection.renderables.length === 0) {
    return <div className="integral-renderable__empty">表示可能なファイルがありません。</div>;
  }

  const renderableFactory = (node: FlexLayout.TabNode): JSX.Element => {
    const renderable = node.getConfig() as IntegralChunkInspection["renderables"][number];

    return (
      <section className="integral-renderable-card">
        {renderable.kind === "html" ? (
          <iframe
            className="integral-renderable-card__frame"
            sandbox="allow-same-origin allow-scripts"
            srcDoc={renderable.data}
            title={renderable.name}
          />
        ) : renderable.kind === "image" ? (
          <img alt={renderable.name} className="integral-renderable-card__image" src={renderable.data} />
        ) : (
          <pre className="integral-renderable-card__text">{renderable.data}</pre>
        )}
      </section>
    );
  };

  return (
    <div className="integral-renderable-layout">
      <FlexLayout.Layout factory={renderableFactory} model={model!} />
    </div>
  );
}
