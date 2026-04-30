import * as FlexLayout from "flexlayout-react";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type {
  IntegralAssetCatalog,
  IntegralDatasetInspection,
  IntegralDatasetSummary,
  IntegralManagedFileSummary
} from "../shared/integral";
import type { WorkspaceFileDocument } from "../shared/workspace";
import { resolveWorkspaceMarkdownTarget } from "../shared/workspaceLinks";
import { ExternalPluginFileViewer } from "./ExternalPluginFileViewer";
import { ReadonlyMarkdownPreview } from "./ReadonlyMarkdownPreview";
import { requestOpenManagedDataNote } from "./workspaceOpenEvents";

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}

interface DatasetPickerDialogProps {
  defaultDatasetName?: string;
  onClose: () => void;
  onError: (message: string) => void;
  onImportedManagedFiles?: (
    managedFiles: readonly IntegralManagedFileSummary[],
    kind: "directories" | "files"
  ) => Promise<void> | void;
  preferredDatatype?: string;
  onSelect: (datasetId: string) => void;
}

export function DatasetPickerDialog({
  defaultDatasetName,
  onClose,
  onError,
  preferredDatatype,
  onSelect
}: DatasetPickerDialogProps): JSX.Element {
  const [datasets, setDatasets] = useState<IntegralDatasetSummary[]>([]);
  const [pending, setPending] = useState(false);
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
      const leftPreferred =
        Boolean(preferredDatatype) && left.datatype === preferredDatatype;
      const rightPreferred =
        Boolean(preferredDatatype) && right.datatype === preferredDatatype;

      if (leftPreferred !== rightPreferred) {
        return leftPreferred ? -1 : 1;
      }

      return right.createdAt.localeCompare(left.createdAt);
    });
  }, [datasets, preferredDatatype]);

  const createDatasetFromFiles = async (): Promise<void> => {
    setPending(true);

    try {
      const result = await window.integralNotes.createDatasetFromFileDialog({
        datatype: preferredDatatype ?? null,
        defaultName: defaultDatasetName
      });

      if (!result) {
        return;
      }

      onSelect(result.dataset.datasetId);
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
          <h2>データを割り当て</h2>
          <p>既存の dataset を選ぶか、新しく作成してください。</p>
        </div>

        <div className="dialog-card__body dialog-card__body--asset-picker">
          <button
            className="asset-picker__create-link asset-picker__create-link--primary"
            disabled={pending}
            onClick={() => {
              void createDatasetFromFiles();
            }}
            type="button"
          >
            新しいデータセットを作る
          </button>

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
                        <span>{dataset.datatype ?? "datatype 未設定"}</span>
                        <span>{dataset.representation}</span>
                        <span>{dataset.renderableCount} renderable</span>
                      </div>
                    </div>
                  </label>
                  {dataset.canOpenDataNote ? (
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

          <div className="dialog-actions">
            <button className="button button--ghost" disabled={pending} onClick={onClose} type="button">
              キャンセル
            </button>
            <button
              className="button button--primary"
              disabled={pending || !selectedDatasetId}
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
                            <span>{entry.datatype ?? "datatype 未設定"}</span>
                            <span>{entry.path}</span>
                          </div>
                        </div>
                      </label>
                      {entry.canOpenDataNote ? (
                        <button
                          className="asset-picker__row-link asset-picker__row-link--note"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            requestOpenManagedDataNote(entry.noteTargetId ?? entry.id);
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

export type IntegralAssetPreviewTarget =
  | {
      datasetId: string;
      kind: "dataset";
    }
  | {
      kind: "managed-file";
      managedFileId: string;
    };

interface IntegralAssetPreviewAnchorLayout {
  width: number;
  x: number;
  y: number;
}

interface IntegralAssetPreviewWindowProps {
  anchorLayout: IntegralAssetPreviewAnchorLayout | null;
  assetCatalog: IntegralAssetCatalog;
  onClose: () => void;
  target: IntegralAssetPreviewTarget;
}

interface IntegralAssetPreviewLayout {
  height: number;
  width: number;
  x: number;
  y: number;
}

type IntegralAssetPreviewResolution =
  | {
      status: "loading";
      title: string;
    }
  | {
      message: string;
      status: "error";
      title: string;
    }
  | {
      file: WorkspaceFileDocument;
      status: "renderable-file";
      summary: IntegralManagedFileSummary;
      title: string;
    }
  | {
      markdown: string;
      sourceLabel: string;
      status: "markdown";
      title: string;
    }
  | {
      sourceLabel: string;
      status: "text";
      text: string;
      title: string;
    }
  | {
      dataset: IntegralDatasetSummary;
      notes: IntegralAssetPreviewNote[];
      status: "dataset";
      title: string;
    };

interface IntegralAssetPreviewNote {
  error?: string;
  key: string;
  markdown?: string;
  subtitle?: string;
  title: string;
}

const PREVIEW_MIN_WIDTH = 320;
const PREVIEW_MIN_HEIGHT = 240;
const PREVIEW_DEFAULT_WIDTH = 520;
const PREVIEW_DEFAULT_HEIGHT = 420;
const PREVIEW_MARGIN = 12;

export function IntegralAssetPreviewWindow({
  anchorLayout,
  assetCatalog,
  onClose,
  target
}: IntegralAssetPreviewWindowProps): JSX.Element {
  const [layout, setLayout] = useState<IntegralAssetPreviewLayout>(() =>
    computeInitialAssetPreviewLayout(anchorLayout)
  );
  const [resolution, setResolution] = useState<IntegralAssetPreviewResolution>({
    status: "loading",
    title: "Preview"
  });
  const removeDragListenersRef = useRef<() => void>(() => {});
  const targetKey = toAssetPreviewTargetKey(target);

  useEffect(() => {
    let cancelled = false;

    setResolution({
      status: "loading",
      title: "Preview"
    });

    void resolveIntegralAssetPreview(target, assetCatalog)
      .then((nextResolution) => {
        if (!cancelled) {
          setResolution(nextResolution);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setResolution({
            message: toErrorMessage(error),
            status: "error",
            title: "Preview"
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [assetCatalog, targetKey]);

  useLayoutEffect(() => {
    const handleResize = (): void => {
      setLayout((current) => clampAssetPreviewLayout(current));
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    return () => {
      removeDragListenersRef.current();
    };
  }, []);

  const startDrag = (
    mode: "move" | "resize",
    event: ReactPointerEvent<HTMLElement>
  ): void => {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const startLayout = layout;

    removeDragListenersRef.current();

    const handlePointerMove = (pointerEvent: PointerEvent): void => {
      pointerEvent.preventDefault();

      const deltaX = pointerEvent.clientX - startX;
      const deltaY = pointerEvent.clientY - startY;

      setLayout(
        clampAssetPreviewLayout(
          mode === "move"
            ? {
                ...startLayout,
                x: startLayout.x + deltaX,
                y: startLayout.y + deltaY
              }
            : {
                ...startLayout,
                height: startLayout.height + deltaY,
                width: startLayout.width + deltaX
              }
        )
      );
    };

    const handlePointerUp = (): void => {
      removeDragListenersRef.current();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    removeDragListenersRef.current = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      removeDragListenersRef.current = () => {};
    };
  };

  return (
    <div
      className="integral-asset-preview"
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      style={{
        height: `${layout.height}px`,
        left: `${layout.x}px`,
        top: `${layout.y}px`,
        width: `${layout.width}px`
      }}
    >
      <div
        className="integral-asset-preview__header"
        onPointerDown={(event) => {
          startDrag("move", event);
        }}
      >
        <div className="integral-asset-preview__title">
          <strong>{resolution.title}</strong>
          <span>{getAssetPreviewSubtitle(resolution)}</span>
        </div>
        <button
          aria-label="preview を閉じる"
          className="integral-asset-preview__close"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }}
          type="button"
        >
          ×
        </button>
      </div>

      <div className="integral-asset-preview__body">
        <IntegralAssetPreviewContent resolution={resolution} />
      </div>

      <div
        className="integral-asset-preview__resize"
        onPointerDown={(event) => {
          startDrag("resize", event);
        }}
        title="preview をリサイズ"
      />
    </div>
  );
}

function IntegralAssetPreviewContent({
  resolution
}: {
  resolution: IntegralAssetPreviewResolution;
}): JSX.Element {
  if (resolution.status === "loading") {
    return <div className="integral-asset-preview__status">preview を読み込み中...</div>;
  }

  if (resolution.status === "error") {
    return (
      <div className="integral-asset-preview__status integral-asset-preview__status--error">
        {resolution.message}
      </div>
    );
  }

  if (resolution.status === "renderable-file") {
    const { file } = resolution;

    if (file.kind === "html") {
      return (
        <iframe
          className="integral-asset-preview__frame"
          sandbox="allow-same-origin allow-scripts"
          srcDoc={file.content ?? ""}
          title={file.name}
        />
      );
    }

    if (file.kind === "image") {
      return (
        <img
          alt={file.name}
          className="integral-asset-preview__image"
          src={file.content ?? ""}
        />
      );
    }

    if (file.kind === "plugin" && file.pluginViewer) {
      return (
        <ExternalPluginFileViewer
          file={{
            content: file.content ?? "",
            name: file.name,
            pluginViewer: file.pluginViewer,
            relativePath: file.relativePath
          }}
          presentation="embed"
          source={{
            kind: "workspace-file"
          }}
        />
      );
    }

    return (
      <div className="integral-asset-preview__status">
        この file は preview できません。
      </div>
    );
  }

  if (resolution.status === "markdown") {
    return (
      <ReadonlyMarkdownPreview
        className="integral-asset-preview__markdown"
        content={resolution.markdown}
        proxyDomURL={proxyIntegralAssetPreviewImageUrl}
      />
    );
  }

  if (resolution.status === "text") {
    return <pre className="integral-asset-preview__text">{resolution.text}</pre>;
  }

  return (
    <div className="integral-asset-preview__dataset-notes">
      {resolution.notes.map((note) => (
        <section className="integral-asset-preview__note-card" key={note.key}>
          <header className="integral-asset-preview__note-header">
            <strong>{note.title}</strong>
            {note.subtitle ? <span>{note.subtitle}</span> : null}
          </header>
          {note.error ? (
            <div className="integral-asset-preview__status integral-asset-preview__status--error">
              {note.error}
            </div>
          ) : (
            <ReadonlyMarkdownPreview
              className="integral-asset-preview__markdown"
              content={note.markdown ?? ""}
              proxyDomURL={proxyIntegralAssetPreviewImageUrl}
            />
          )}
        </section>
      ))}
    </div>
  );
}

async function resolveIntegralAssetPreview(
  target: IntegralAssetPreviewTarget,
  assetCatalog: IntegralAssetCatalog
): Promise<IntegralAssetPreviewResolution> {
  if (target.kind === "dataset") {
    const dataset = assetCatalog.datasets.find(
      (candidate) => candidate.datasetId === target.datasetId
    );

    if (!dataset) {
      throw new Error(`dataset が見つかりません: ${target.datasetId}`);
    }

    const datasetNote = await readIntegralAssetPreviewNote({
      canOpenDataNote: dataset.canOpenDataNote,
      key: `dataset:${dataset.datasetId}`,
      subtitle: dataset.datatype ?? "datatype 未設定",
      targetId: dataset.noteTargetId ?? dataset.datasetId,
      title: dataset.name
    });
    const memberNotes = await Promise.all(
      (dataset.memberIds ?? []).map(async (memberId) => {
        const managedFile = assetCatalog.managedFiles.find(
          (candidate) => candidate.id === memberId
        );

        if (!managedFile) {
          return {
            error: "構成 file の metadata が見つかりません。",
            key: `member:${memberId}`,
            subtitle: memberId,
            title: memberId
          } satisfies IntegralAssetPreviewNote;
        }

        return readIntegralAssetPreviewNote({
          canOpenDataNote: managedFile.canOpenDataNote,
          key: `member:${managedFile.id}`,
          subtitle: managedFile.path,
          targetId: managedFile.noteTargetId ?? managedFile.id,
          title: managedFile.displayName
        });
      })
    );

    return {
      dataset,
      notes: [datasetNote, ...memberNotes],
      status: "dataset",
      title: dataset.name
    };
  }

  const managedFile = assetCatalog.managedFiles.find(
    (candidate) => candidate.id === target.managedFileId
  );

  if (!managedFile) {
    throw new Error(`managed file が見つかりません: ${target.managedFileId}`);
  }

  const file = await window.integralNotes.readWorkspaceFile(managedFile.path);

  if (file.kind === "html" || file.kind === "image" || (file.kind === "plugin" && file.pluginViewer)) {
    return {
      file,
      status: "renderable-file",
      summary: managedFile,
      title: managedFile.displayName
    };
  }

  if (managedFile.canOpenDataNote) {
    const note = await readIntegralAssetPreviewNote({
      canOpenDataNote: managedFile.canOpenDataNote,
      key: `managed-file:${managedFile.id}`,
      subtitle: managedFile.path,
      targetId: managedFile.noteTargetId ?? managedFile.id,
      title: managedFile.displayName
    });

    return note.error
      ? {
          message: note.error,
          status: "error",
          title: managedFile.displayName
        }
      : {
          markdown: note.markdown ?? "",
          sourceLabel: "DATA-NOTE",
          status: "markdown",
          title: managedFile.displayName
        };
  }

  if (file.kind === "markdown") {
    return {
      markdown: file.content ?? "",
      sourceLabel: "Markdown",
      status: "markdown",
      title: file.name
    };
  }

  if (file.kind === "text") {
    return {
      sourceLabel: "Text",
      status: "text",
      text: file.content ?? "",
      title: file.name
    };
  }

  return {
    message: "この file は preview できず、対応する data-note もありません。",
    status: "error",
    title: managedFile.displayName
  };
}

async function readIntegralAssetPreviewNote({
  canOpenDataNote,
  key,
  subtitle,
  targetId,
  title
}: {
  canOpenDataNote: boolean;
  key: string;
  subtitle?: string;
  targetId: string;
  title: string;
}): Promise<IntegralAssetPreviewNote> {
  if (!canOpenDataNote) {
    return {
      error: "data-note はありません。",
      key,
      subtitle,
      title
    };
  }

  try {
    const note = await window.integralNotes.readWorkspaceFile(
      createManagedDataNoteRelativePath(targetId)
    );

    return {
      key,
      markdown: note.content ?? "",
      subtitle,
      title
    };
  } catch (error) {
    return {
      error: toErrorMessage(error),
      key,
      subtitle,
      title
    };
  }
}

function getAssetPreviewSubtitle(resolution: IntegralAssetPreviewResolution): string {
  if (resolution.status === "renderable-file") {
    return resolution.summary.path;
  }

  if (resolution.status === "markdown" || resolution.status === "text") {
    return resolution.sourceLabel;
  }

  if (resolution.status === "dataset") {
    const memberCount = resolution.dataset.memberIds?.length ?? 0;
    return `${memberCount} members`;
  }

  return "";
}

function computeInitialAssetPreviewLayout(
  anchorLayout: IntegralAssetPreviewAnchorLayout | null
): IntegralAssetPreviewLayout {
  const width = Math.min(PREVIEW_DEFAULT_WIDTH, Math.max(PREVIEW_MIN_WIDTH, window.innerWidth - 24));
  const height = Math.min(
    PREVIEW_DEFAULT_HEIGHT,
    Math.max(PREVIEW_MIN_HEIGHT, window.innerHeight - 24)
  );

  if (!anchorLayout) {
    return clampAssetPreviewLayout({
      height,
      width,
      x: window.innerWidth - width - PREVIEW_MARGIN,
      y: PREVIEW_MARGIN
    });
  }

  const rightX = anchorLayout.x + anchorLayout.width + PREVIEW_MARGIN;
  const leftX = anchorLayout.x - width - PREVIEW_MARGIN;
  const x = rightX + width <= window.innerWidth - PREVIEW_MARGIN ? rightX : leftX;

  return clampAssetPreviewLayout({
    height,
    width,
    x,
    y: anchorLayout.y
  });
}

function clampAssetPreviewLayout(
  layout: IntegralAssetPreviewLayout
): IntegralAssetPreviewLayout {
  const maxWidth = Math.max(PREVIEW_MIN_WIDTH, window.innerWidth - PREVIEW_MARGIN * 2);
  const maxHeight = Math.max(PREVIEW_MIN_HEIGHT, window.innerHeight - PREVIEW_MARGIN * 2);
  const width = Math.min(Math.max(layout.width, PREVIEW_MIN_WIDTH), maxWidth);
  const height = Math.min(Math.max(layout.height, PREVIEW_MIN_HEIGHT), maxHeight);
  const maxX = Math.max(PREVIEW_MARGIN, window.innerWidth - width - PREVIEW_MARGIN);
  const maxY = Math.max(PREVIEW_MARGIN, window.innerHeight - height - PREVIEW_MARGIN);

  return {
    height,
    width,
    x: Math.min(Math.max(layout.x, PREVIEW_MARGIN), maxX),
    y: Math.min(Math.max(layout.y, PREVIEW_MARGIN), maxY)
  };
}

function toAssetPreviewTargetKey(target: IntegralAssetPreviewTarget): string {
  return target.kind === "dataset"
    ? `dataset:${target.datasetId}`
    : `managed-file:${target.managedFileId}`;
}

function createManagedDataNoteRelativePath(targetId: string): string {
  return `.store/.integral/data-notes/${targetId.trim()}.md`;
}

async function proxyIntegralAssetPreviewImageUrl(url: string): Promise<string> {
  const relativePath = resolveWorkspaceMarkdownTarget(url);

  if (!relativePath) {
    return url;
  }

  try {
    return await window.integralNotes.resolveWorkspaceFileUrl(relativePath);
  } catch {
    return url;
  }
}
