import * as FlexLayout from "flexlayout-react";
import { useEffect, useMemo, useState } from "react";

import type {
  IntegralDatasetInspection,
  IntegralDatasetSummary,
  IntegralOriginalDataSummary
} from "../shared/integral";
import { ExternalPluginFileViewer } from "./ExternalPluginFileViewer";
import { requestOpenManagedDataNote } from "./workspaceOpenEvents";

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}

interface DatasetPickerDialogProps {
  acceptedKinds?: string[];
  defaultDatasetName?: string;
  onClose: () => void;
  onError: (message: string) => void;
  onImportedOriginalData?: (
    originalData: readonly IntegralOriginalDataSummary[],
    kind: "directories" | "files"
  ) => Promise<void> | void;
  onSelect: (datasetId: string) => void;
}

type DatasetPickerMode = "select" | "create";

export function DatasetPickerDialog({
  acceptedKinds,
  defaultDatasetName,
  onClose,
  onError,
  onImportedOriginalData,
  onSelect
}: DatasetPickerDialogProps): JSX.Element {
  const [mode, setMode] = useState<DatasetPickerMode>("select");
  const [datasets, setDatasets] = useState<IntegralDatasetSummary[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState("");

  useEffect(() => {
    void window.integralNotes
      .getIntegralAssetCatalog()
      .then((catalog) => {
        setDatasets(catalog.datasets);
      })
      .catch((error) => {
        onError(toErrorMessage(error));
      });
  }, [onError]);

  const sortedDatasets = useMemo(() => {
    return [...datasets].sort((left, right) => {
      const leftPreferred = acceptedKinds?.includes(left.kind) ?? false;
      const rightPreferred = acceptedKinds?.includes(right.kind) ?? false;

      if (leftPreferred !== rightPreferred) {
        return leftPreferred ? -1 : 1;
      }

      return right.createdAt.localeCompare(left.createdAt);
    });
  }, [acceptedKinds, datasets]);

  if (mode === "create") {
    return (
      <OriginalDataSelectionDialog
        confirmLabel="Dataset を作成して割り当て"
        defaultDatasetName={defaultDatasetName}
        description="データファイルを選んで新しい dataset を作成します。"
        onClose={() => {
          setMode("select");
        }}
        onError={onError}
        onImportedOriginalData={onImportedOriginalData}
        onSelect={async ({ datasetName, originalDataIds }) => {
          const result = await window.integralNotes.createSourceDataset({
            name: datasetName,
            originalDataIds
          });

          onSelect(result.dataset.datasetId);
        }}
        pendingLabel="作成中..."
        requireDatasetName
        title="新しい Dataset を作成"
      />
    );
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog-card dialog-card--asset-picker">
        <div className="dialog-card__header">
          <h2>データを割り当て</h2>
          <p>既存の dataset を選ぶか、新しく作成してください。</p>
        </div>

        <div className="dialog-card__body dialog-card__body--asset-picker">
          <div className="asset-picker__list">
            {sortedDatasets.length > 0 ? (
              sortedDatasets.map((dataset) => (
                <div className="asset-picker__row" key={dataset.datasetId}>
                  <label className="asset-picker__row-main">
                    <input
                      checked={selectedDatasetId === dataset.datasetId}
                      name="dataset-picker"
                      onChange={() => {
                        setSelectedDatasetId(dataset.datasetId);
                      }}
                      type="radio"
                    />
                    <div>
                      <strong>{dataset.name}</strong>
                      <div className="asset-picker__meta">
                        <span>{dataset.kind}</span>
                        <span>{dataset.representation}</span>
                        <span>{dataset.renderableCount} renderable</span>
                      </div>
                    </div>
                  </label>
                  <button
                    className="asset-picker__row-link asset-picker__row-link--note"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      requestOpenManagedDataNote(dataset.datasetId);
                    }}
                    type="button"
                  >
                    ノート
                  </button>
                </div>
              ))
            ) : (
              <div className="asset-picker__empty">割り当て可能な dataset がありません。</div>
            )}
          </div>

          <button
            className="asset-picker__create-link"
            onClick={() => {
              setMode("create");
            }}
            type="button"
          >
            データファイルから新しい dataset を作成
          </button>

          <div className="dialog-actions">
            <button className="button button--ghost" onClick={onClose} type="button">
              キャンセル
            </button>
            <button
              className="button button--primary"
              disabled={!selectedDatasetId}
              onClick={() => {
                onSelect(selectedDatasetId);
              }}
              type="button"
            >
              割り当て
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface OriginalDataPickerDialogProps {
  defaultDatasetName?: string;
  onClose: () => void;
  onError: (message: string) => void;
  onImportedOriginalData?: (
    originalData: readonly IntegralOriginalDataSummary[],
    kind: "directories" | "files"
  ) => Promise<void> | void;
  onSelectDataset: (datasetId: string) => void;
}

interface OriginalDataSelectionDialogProps {
  confirmLabel: string;
  defaultDatasetName?: string;
  description: string;
  initialSelectedOriginalDataIds?: readonly string[];
  onClose: () => void;
  onError: (message: string) => void;
  onImportedOriginalData?: (
    originalData: readonly IntegralOriginalDataSummary[],
    kind: "directories" | "files"
  ) => Promise<void> | void;
  onSelect: (selection: { datasetName: string; originalDataIds: string[] }) => Promise<void> | void;
  pendingLabel?: string;
  requireDatasetName?: boolean;
  title: string;
}

export function OriginalDataSelectionDialog({
  confirmLabel,
  defaultDatasetName,
  description,
  initialSelectedOriginalDataIds = [],
  onClose,
  onError,
  onImportedOriginalData,
  onSelect,
  pendingLabel,
  requireDatasetName = false,
  title
}: OriginalDataSelectionDialogProps): JSX.Element {
  const [originalData, setOriginalData] = useState<IntegralOriginalDataSummary[]>([]);
  const [selectedOriginalDataIds, setSelectedOriginalDataIds] = useState<Set<string>>(
    () => new Set(initialSelectedOriginalDataIds)
  );
  const [datasetName, setDatasetName] = useState(defaultDatasetName ?? "");
  const [pending, setPending] = useState(false);
  const selectionSeed = useMemo(
    () =>
      [...initialSelectedOriginalDataIds]
        .sort((left, right) => left.localeCompare(right, "ja"))
        .join("\u0000"),
    [initialSelectedOriginalDataIds]
  );
  const datasetNameSeed = defaultDatasetName ?? "";

  const reloadOriginalData = async (): Promise<void> => {
    const catalog = await window.integralNotes.getIntegralAssetCatalog();
    setOriginalData(catalog.originalData);
  };

  useEffect(() => {
    setSelectedOriginalDataIds(new Set(initialSelectedOriginalDataIds));
  }, [selectionSeed]);

  useEffect(() => {
    setDatasetName(defaultDatasetName ?? "");
  }, [datasetNameSeed, defaultDatasetName]);

  useEffect(() => {
    void reloadOriginalData().catch((error) => {
      onError(toErrorMessage(error));
    });
  }, [onError]);

  const importOriginalData = async (kind: "directories" | "files"): Promise<void> => {
    setPending(true);

    try {
      const result =
        kind === "files"
          ? await window.integralNotes.importOriginalDataFiles()
          : await window.integralNotes.importOriginalDataDirectories();

      if (!result) {
        return;
      }

      setSelectedOriginalDataIds((current) => {
        const next = new Set(current);
        result.originalData.forEach((entry) => next.add(entry.originalDataId));
        return next;
      });
      await reloadOriginalData();
      await onImportedOriginalData?.(result.originalData, kind);
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const commitSelection = async (): Promise<void> => {
    const normalizedDatasetName = datasetName.trim();

    if (requireDatasetName && normalizedDatasetName.length === 0) {
      onError("Dataset 名を入力してください。");
      return;
    }

    setPending(true);

    try {
      await onSelect({
        datasetName: normalizedDatasetName,
        originalDataIds: Array.from(selectedOriginalDataIds)
      });
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
          <h2>{title}</h2>
          <p>{description}</p>
        </div>

        <div className="dialog-card__body dialog-card__body--asset-picker">
          {requireDatasetName ? (
            <label className="dialog-field">
              <span>Dataset 名</span>
              <input
                disabled={pending}
                onChange={(event) => {
                  setDatasetName(event.target.value);
                }}
                placeholder="dataset 名を入力..."
                type="text"
                value={datasetName}
              />
            </label>
          ) : null}

          <div className="asset-picker__list-section">
            <div className="asset-picker__list-header">
              <span className="asset-picker__hint">
                {selectedOriginalDataIds.size > 0
                  ? `${selectedOriginalDataIds.size} 件選択中`
                  : "データファイルを選択"}
              </span>
              <span className="asset-picker__toolbar">
                <button
                  className="button button--ghost button--xs"
                  disabled={pending}
                  onClick={() => {
                    void importOriginalData("files");
                  }}
                  type="button"
                >
                  + ファイル
                </button>
                <button
                  className="button button--ghost button--xs"
                  disabled={pending}
                  onClick={() => {
                    void importOriginalData("directories");
                  }}
                  type="button"
                >
                  + フォルダ
                </button>
              </span>
            </div>

            <div className="asset-picker__list">
            {originalData.length > 0 ? (
              originalData.map((entry) => {
                const checked = selectedOriginalDataIds.has(entry.originalDataId);

                return (
                  <div className="asset-picker__row" key={entry.originalDataId}>
                    <label className="asset-picker__row-main">
                      <input
                        checked={checked}
                        onChange={() => {
                          setSelectedOriginalDataIds((current) => {
                            const next = new Set(current);

                            if (checked) {
                              next.delete(entry.originalDataId);
                            } else {
                              next.add(entry.originalDataId);
                            }

                            return next;
                          });
                        }}
                        type="checkbox"
                      />
                      <div>
                        <strong>{entry.displayName}</strong>
                        <div className="asset-picker__meta">
                          <span>{entry.representation}</span>
                          <span>{entry.visibility}</span>
                        </div>
                      </div>
                    </label>
                    <button
                      className="asset-picker__row-link asset-picker__row-link--note"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        requestOpenManagedDataNote(entry.originalDataId);
                      }}
                      type="button"
                    >
                      ノート
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="asset-picker__empty">データファイルがありません。先にデータを取り込んでください。</div>
            )}
            </div>
          </div>

          <div className="dialog-actions">
            <button className="button button--ghost" disabled={pending} onClick={onClose} type="button">
              キャンセル
            </button>
            <button
              className="button button--primary"
              disabled={pending || selectedOriginalDataIds.size === 0}
              onClick={() => {
                void commitSelection();
              }}
              type="button"
            >
              {pending ? pendingLabel ?? confirmLabel : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function OriginalDataPickerDialog({
  defaultDatasetName,
  onClose,
  onError,
  onImportedOriginalData,
  onSelectDataset
}: OriginalDataPickerDialogProps): JSX.Element {
  return (
    <OriginalDataSelectionDialog
      confirmLabel="Dataset を作成"
      defaultDatasetName={defaultDatasetName}
      description="データファイルを選んで新しい dataset を作成します。"
      onClose={onClose}
      onError={onError}
      onImportedOriginalData={onImportedOriginalData}
      onSelect={async ({ datasetName, originalDataIds }) => {
        const result = await window.integralNotes.createSourceDataset({
          name: datasetName,
          originalDataIds
        });

        onSelectDataset(result.dataset.datasetId);
      }}
      pendingLabel="作成中..."
      requireDatasetName
      title="新しい Dataset を作成"
    />
  );
}

export function DatasetRenderableView({ datasetId }: { datasetId: string | null }): JSX.Element {
  const [inspection, setInspection] = useState<IntegralDatasetInspection | null>(null);
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
              id: `renderable::${inspection.datasetId}::${renderable.relativePath}`,
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
    if (!datasetId) {
      setInspection(null);
      setError(null);
      return;
    }

    let cancelled = false;

    setInspection(null);
    setError(null);

    void window.integralNotes
      .inspectDataset(datasetId)
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
  }, [datasetId]);

  if (!datasetId) {
    return <div className="integral-renderable__empty">表示する dataset が未設定です。</div>;
  }

  if (error) {
    return <div className="integral-renderable__empty">{error}</div>;
  }

  if (!inspection) {
    return <div className="integral-renderable__empty">dataset を読み込み中...</div>;
  }

  if (inspection.renderables.length === 0) {
    return <div className="integral-renderable__empty">表示可能なファイルがありません。</div>;
  }

  const renderableFactory = (node: FlexLayout.TabNode): JSX.Element => {
    const renderable = node.getConfig() as IntegralDatasetInspection["renderables"][number];

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
        ) : renderable.kind === "plugin" && renderable.pluginViewer ? (
          <ExternalPluginFileViewer
            file={{
              content: renderable.data,
              name: renderable.name,
              pluginViewer: renderable.pluginViewer,
              relativePath: renderable.relativePath
            }}
            presentation="full"
            source={{
              datasetId: inspection.datasetId,
              datasetName: inspection.name,
              kind: "dataset-file"
            }}
          />
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
