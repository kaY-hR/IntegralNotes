import * as FlexLayout from "flexlayout-react";
import { useEffect, useMemo, useState } from "react";

import type {
  IntegralDatasetInspection,
  IntegralDatasetSummary,
  IntegralManagedFileSummary
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
  onImportedManagedFiles?: (
    managedFiles: readonly IntegralManagedFileSummary[],
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
  onImportedManagedFiles,
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
      <ManagedFileSelectionDialog
        confirmLabel="Dataset を作成して割り当て"
        defaultDatasetName={defaultDatasetName}
        description="managed file を選んで新しい dataset を作成します。"
        onClose={() => {
          setMode("select");
        }}
        onError={onError}
        onImportedManagedFiles={onImportedManagedFiles}
        onSelect={async ({ datasetName, relativePaths }) => {
          const result = await window.integralNotes.createDatasetFromWorkspaceEntries({
            name: datasetName,
            relativePaths
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
                  {dataset.hasDataNote ? (
                    <button
                      className="asset-picker__row-link asset-picker__row-link--note"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        requestOpenManagedDataNote(dataset.noteTargetId ?? dataset.datasetId);
                      }}
                      type="button"
                    >
                      ノート
                    </button>
                  ) : null}
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
            managed file から新しい dataset を作成
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

interface ManagedFilePickerDialogProps {
  defaultDatasetName?: string;
  onClose: () => void;
  onError: (message: string) => void;
  onImportedManagedFiles?: (
    managedFiles: readonly IntegralManagedFileSummary[],
    kind: "directories" | "files"
  ) => Promise<void> | void;
  onSelectDataset: (dataset: IntegralDatasetSummary) => void;
}

interface ManagedFileSelectionDialogProps {
  confirmLabel: string;
  defaultDatasetName?: string;
  description: string;
  initialSelectedRelativePaths?: readonly string[];
  onClose: () => void;
  onError: (message: string) => void;
  onImportedManagedFiles?: (
    managedFiles: readonly IntegralManagedFileSummary[],
    kind: "directories" | "files"
  ) => Promise<void> | void;
  onSelect: (selection: { datasetName: string; relativePaths: string[] }) => Promise<void> | void;
  pendingLabel?: string;
  requireDatasetName?: boolean;
  title: string;
}

export function ManagedFileSelectionDialog({
  confirmLabel,
  defaultDatasetName,
  description,
  initialSelectedRelativePaths = [],
  onClose,
  onError,
  onImportedManagedFiles,
  onSelect,
  pendingLabel,
  requireDatasetName = false,
  title
}: ManagedFileSelectionDialogProps): JSX.Element {
  const [managedFiles, setManagedFiles] = useState<IntegralManagedFileSummary[]>([]);
  const [selectedRelativePaths, setSelectedRelativePaths] = useState<Set<string>>(
    () => new Set(initialSelectedRelativePaths)
  );
  const [datasetName, setDatasetName] = useState(defaultDatasetName ?? "");
  const [pending, setPending] = useState(false);
  const selectionSeed = useMemo(
    () =>
      [...initialSelectedRelativePaths]
        .sort((left, right) => left.localeCompare(right, "ja"))
        .join("\u0000"),
    [initialSelectedRelativePaths]
  );
  const datasetNameSeed = defaultDatasetName ?? "";

  const reloadSelectableManagedFiles = async (): Promise<void> => {
    const catalog = await window.integralNotes.getIntegralAssetCatalog();
    setManagedFiles(
      [...catalog.managedFiles]
        .filter((entry) => entry.visibility === "visible" && entry.representation !== "dataset-json")
        .sort((left, right) =>
          `${left.displayName} ${left.path}`.localeCompare(`${right.displayName} ${right.path}`, "ja")
        )
    );
  };

  useEffect(() => {
    setSelectedRelativePaths(new Set(initialSelectedRelativePaths));
  }, [selectionSeed]);

  useEffect(() => {
    setDatasetName(defaultDatasetName ?? "");
  }, [datasetNameSeed, defaultDatasetName]);

  useEffect(() => {
    void reloadSelectableManagedFiles().catch((error) => {
      onError(toErrorMessage(error));
    });
  }, [onError]);

  const importManagedFiles = async (kind: "directories" | "files"): Promise<void> => {
    setPending(true);

    try {
      const result =
        kind === "files"
          ? await window.integralNotes.importManagedFileFiles()
          : await window.integralNotes.importManagedFileDirectories();

      if (!result) {
        return;
      }

      setSelectedRelativePaths((current) => {
        const next = new Set(current);
        result.managedFiles.forEach((entry) => next.add(entry.path));
        return next;
      });
      await reloadSelectableManagedFiles();
      await onImportedManagedFiles?.(result.managedFiles, kind);
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
        relativePaths: Array.from(selectedRelativePaths)
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
                {selectedRelativePaths.size > 0
                  ? `${selectedRelativePaths.size} 件選択中`
                  : "managed file を選択"}
              </span>
              <span className="asset-picker__toolbar">
                <button
                  className="button button--ghost button--xs"
                  disabled={pending}
                  onClick={() => {
                    void importManagedFiles("files");
                  }}
                  type="button"
                >
                  + ファイル
                </button>
                <button
                  className="button button--ghost button--xs"
                  disabled={pending}
                  onClick={() => {
                    void importManagedFiles("directories");
                  }}
                  type="button"
                >
                  + フォルダ
                </button>
              </span>
            </div>

            <div className="asset-picker__list">
              {managedFiles.length > 0 ? (
                managedFiles.map((entry) => {
                  const checked = selectedRelativePaths.has(entry.path);

                  return (
                    <div className="asset-picker__row" key={entry.id}>
                      <label className="asset-picker__row-main">
                        <input
                          checked={checked}
                          onChange={() => {
                            setSelectedRelativePaths((current) => {
                              const next = new Set(current);

                              if (checked) {
                                next.delete(entry.path);
                              } else {
                                next.add(entry.path);
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
                            <span>{entry.format ?? "format 未設定"}</span>
                            <span>{entry.path}</span>
                          </div>
                        </div>
                      </label>
                      {entry.hasDataNote ? (
                        <button
                          className="asset-picker__row-link asset-picker__row-link--note"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            requestOpenManagedDataNote(entry.id);
                          }}
                          type="button"
                        >
                          ノート
                        </button>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <div className="asset-picker__empty">
                  選択可能な managed file がありません。先にファイルを取り込むか、workspace 内に file を用意してください。
                </div>
              )}
            </div>
          </div>

          <div className="dialog-actions">
            <button className="button button--ghost" disabled={pending} onClick={onClose} type="button">
              キャンセル
            </button>
            <button
              className="button button--primary"
              disabled={pending || selectedRelativePaths.size === 0}
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

export function ManagedFilePickerDialog({
  defaultDatasetName,
  onClose,
  onError,
  onImportedManagedFiles,
  onSelectDataset
}: ManagedFilePickerDialogProps): JSX.Element {
  return (
    <ManagedFileSelectionDialog
      confirmLabel="Dataset を作成"
      defaultDatasetName={defaultDatasetName}
      description="managed file を選んで新しい dataset を作成します。"
      onClose={onClose}
      onError={onError}
      onImportedManagedFiles={onImportedManagedFiles}
      onSelect={async ({ datasetName, relativePaths }) => {
        const result = await window.integralNotes.createDatasetFromWorkspaceEntries({
          name: datasetName,
          relativePaths
        });

        onSelectDataset(result.dataset);
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
