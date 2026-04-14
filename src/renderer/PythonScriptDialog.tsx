import { useMemo, useState } from "react";

import type {
  IntegralBlockDocument,
  IntegralOriginalDataSummary,
  RegisterPythonScriptResult
} from "../shared/integral";

import { OriginalDataSelectionDialog } from "./IntegralAssetDialogs";
import { INTEGRAL_BLOCK_LANGUAGE } from "./integralBlockRegistry";

interface PythonScriptDialogProps {
  onClose: () => void;
  onError: (message: string) => void;
  onImportedOriginalData?: (
    originalData: readonly IntegralOriginalDataSummary[],
    kind: "directories" | "files"
  ) => Promise<void> | void;
  onRegistered: (result: RegisterPythonScriptResult, blockMarkdown: string) => void;
}

interface InputSlotDraft {
  originalDataIds: string[];
  id: string;
  name: string;
}

interface OutputSlotDraft {
  id: string;
  name: string;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}

function createInputSlotDraft(name = ""): InputSlotDraft {
  return {
    originalDataIds: [],
    id: crypto.randomUUID(),
    name
  };
}

function createOutputSlotDraft(name = ""): OutputSlotDraft {
  return {
    id: crypto.randomUUID(),
    name
  };
}

function normalizeSlotNames(values: string[]): string[] {
  return values.map((value) => value.trim()).filter((value) => value.length > 0);
}

function createBlockId(): string {
  return `BLK-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

function toIntegralCodeBlock(value: unknown): string {
  return [`\`\`\`${INTEGRAL_BLOCK_LANGUAGE}`, JSON.stringify(value, null, 2), "```"].join("\n");
}

export function PythonScriptDialog({
  onClose,
  onError,
  onImportedOriginalData,
  onRegistered
}: PythonScriptDialogProps): JSX.Element {
  const [entryAbsolutePath, setEntryAbsolutePath] = useState("");
  const [autoIncludedFilePaths, setAutoIncludedFilePaths] = useState<string[]>([]);
  const [manualIncludedFilePaths, setManualIncludedFilePaths] = useState<string[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [inputSlots, setInputSlots] = useState<InputSlotDraft[]>([createInputSlotDraft("source")]);
  const [outputSlots, setOutputSlots] = useState<OutputSlotDraft[]>([createOutputSlotDraft("result")]);
  const [pending, setPending] = useState(false);
  const [slotPickerTargetId, setSlotPickerTargetId] = useState<string | null>(null);

  const bundledFilePaths = useMemo(
    () =>
      Array.from(
        new Set([
          entryAbsolutePath,
          ...autoIncludedFilePaths,
          ...manualIncludedFilePaths
        ].filter((value) => value.length > 0))
      ),
    [autoIncludedFilePaths, entryAbsolutePath, manualIncludedFilePaths]
  );

  const handleSelectEntry = async (): Promise<void> => {
    setPending(true);

    try {
      const selection = await window.integralNotes.browsePythonEntryFile();

      if (!selection) {
        return;
      }

      setEntryAbsolutePath(selection.entryAbsolutePath);
      setAutoIncludedFilePaths(selection.autoIncludedFilePaths);
      setManualIncludedFilePaths([]);
      setDisplayName((current) =>
        current.trim().length > 0 ? current : selection.suggestedDisplayName
      );
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const handleAddFiles = async (): Promise<void> => {
    setPending(true);

    try {
      const filePaths = await window.integralNotes.browsePythonSupportFiles(
        entryAbsolutePath || null
      );

      if (!filePaths) {
        return;
      }

      setManualIncludedFilePaths((current) =>
        Array.from(new Set([...current, ...filePaths])).filter(
          (candidate) =>
            candidate !== entryAbsolutePath &&
            !autoIncludedFilePaths.includes(candidate)
        )
      );
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const handleRegister = async (): Promise<void> => {
    if (!entryAbsolutePath) {
      onError("entry の Python ファイルを選択してください。");
      return;
    }

    const inputSlotNames = normalizeSlotNames(inputSlots.map((slot) => slot.name));
    const outputSlotNames = normalizeSlotNames(outputSlots.map((slot) => slot.name));

    if (inputSlotNames.length === 0) {
      onError("少なくとも 1 つ input slot 名を入力してください。");
      return;
    }

    if (outputSlotNames.length === 0) {
      onError("少なくとも 1 つ output slot 名を入力してください。");
      return;
    }

    setPending(true);

    try {
      const result = await window.integralNotes.registerPythonScript({
        description,
        displayName,
        entryAbsolutePath,
        includedFilePaths: bundledFilePaths,
        inputSlotNames,
        outputSlotNames
      });
      const inputEntries = await Promise.all(
        inputSlots
          .map((slot) => ({
            originalDataIds: slot.originalDataIds,
            name: slot.name.trim()
          }))
          .filter((slot) => slot.name.length > 0)
          .map(async (slot) => {
            if (slot.originalDataIds.length === 0) {
              return [slot.name, null] as const;
            }

            const sourceDataset = await window.integralNotes.createSourceDataset({
              originalDataIds: slot.originalDataIds
            });

            return [slot.name, sourceDataset.dataset.datasetId] as const;
          })
      );
      const initialBlock: IntegralBlockDocument = {
        "block-type": result.blockType.blockType,
        id: createBlockId(),
        inputs: Object.fromEntries(inputEntries),
        outputs: Object.fromEntries(
          outputSlots
            .map((slot) => [slot.name.trim(), null] as const)
            .filter(([slotName]) => slotName.length > 0)
        ),
        params: {},
        plugin: result.blockType.pluginId
      };

      onRegistered(result, toIntegralCodeBlock(initialBlock));
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const updateInputSlot = (slotId: string, updater: (slot: InputSlotDraft) => InputSlotDraft): void => {
    setInputSlots((current) =>
      current.map((slot) => (slot.id === slotId ? updater(slot) : slot))
    );
  };

  const updateOutputSlot = (slotId: string, updater: (slot: OutputSlotDraft) => OutputSlotDraft): void => {
    setOutputSlots((current) =>
      current.map((slot) => (slot.id === slotId ? updater(slot) : slot))
    );
  };

  return (
    <div className="dialog-backdrop">
      <div className="dialog-card dialog-card--python-script">
        <div className="dialog-card__header">
          <p className="dialog-card__eyebrow">General Analysis</p>
          <h2>Python Script 登録</h2>
          <p>script 資産を作成し、そのまま現在のノートへ Python block を挿入します。</p>
        </div>

        <div className="dialog-card__body dialog-card__body--python-script">
          <label className="dialog-field">
            <span>Entry</span>
            <button
              className="dialog-picker-button"
              disabled={pending}
              onClick={() => {
                void handleSelectEntry();
              }}
              type="button"
            >
              <strong>{entryAbsolutePath ? "Entry を変更" : "Entry を選択"}</strong>
              <span>{entryAbsolutePath || "未選択"}</span>
            </button>
          </label>

          <label className="dialog-field">
            <span>Display Name</span>
            <input
              disabled={pending}
              onChange={(event) => {
                setDisplayName(event.target.value);
              }}
              placeholder="PCA"
              type="text"
              value={displayName}
            />
          </label>

          <label className="dialog-field">
            <span>Description</span>
            <input
              disabled={pending}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
              placeholder="数値テーブルを解析する"
              type="text"
              value={description}
            />
          </label>

          <section className="python-script-dialog__bundle">
            <div className="python-script-dialog__bundle-header">
              <strong>同梱ファイル</strong>
              <button
                className="button button--ghost"
                disabled={pending || !entryAbsolutePath}
                onClick={() => {
                  void handleAddFiles();
                }}
                type="button"
              >
                追加ファイルを選択
              </button>
            </div>

            <ul className="python-script-dialog__file-list">
              {bundledFilePaths.length > 0 ? (
                bundledFilePaths.map((filePath) => (
                  <li key={filePath}>
                    <code>{filePath}</code>
                    {manualIncludedFilePaths.includes(filePath) ? (
                      <button
                        className="button button--ghost"
                        disabled={pending}
                        onClick={() => {
                          setManualIncludedFilePaths((current) =>
                            current.filter((candidate) => candidate !== filePath)
                          );
                        }}
                        type="button"
                      >
                        除外
                      </button>
                    ) : (
                      <span className="python-script-dialog__file-badge">
                        {filePath === entryAbsolutePath ? "entry" : "auto"}
                      </span>
                    )}
                  </li>
                ))
              ) : (
                <li className="python-script-dialog__file-list-empty">
                  entry を選択すると表示されます。
                </li>
              )}
            </ul>
          </section>

          <section className="python-slot-editor">
            <div className="python-slot-editor__header">
              <strong>Input Slots</strong>
            </div>

            <div className="python-slot-editor__rows">
              {inputSlots.map((slot) => (
                <div className="python-slot-editor__row" key={slot.id}>
                  <input
                    className="python-slot-editor__input"
                    disabled={pending}
                    onChange={(event) => {
                      updateInputSlot(slot.id, (current) => ({
                        ...current,
                        name: event.target.value
                      }));
                    }}
                    placeholder="slot名を入力..."
                    type="text"
                    value={slot.name}
                  />
                  <button
                    className="button button--ghost python-slot-editor__dataset-button"
                    disabled={pending}
                    onClick={() => {
                      setSlotPickerTargetId(slot.id);
                    }}
                    type="button"
                  >
                    {slot.originalDataIds.length > 0
                      ? `${slot.originalDataIds.length} 件の元データを選択中`
                      : "元データを選択..."}
                  </button>
                  <button
                    className="button button--ghost"
                    disabled={pending || inputSlots.length === 1}
                    onClick={() => {
                      setInputSlots((current) =>
                        current.filter((candidate) => candidate.id !== slot.id)
                      );
                    }}
                    type="button"
                  >
                    -
                  </button>
                </div>
              ))}
            </div>

            <button
              className="button button--ghost python-slot-editor__add"
              disabled={pending}
              onClick={() => {
                setInputSlots((current) => [...current, createInputSlotDraft()]);
              }}
              type="button"
            >
              +
            </button>
          </section>

          <section className="python-slot-editor">
            <div className="python-slot-editor__header">
              <strong>Output Slots</strong>
            </div>

            <div className="python-slot-editor__rows">
              {outputSlots.map((slot) => (
                <div className="python-slot-editor__row python-slot-editor__row--output" key={slot.id}>
                  <input
                    className="python-slot-editor__input"
                    disabled={pending}
                    onChange={(event) => {
                      updateOutputSlot(slot.id, (current) => ({
                        ...current,
                        name: event.target.value
                      }));
                    }}
                    placeholder="slot名を入力..."
                    type="text"
                    value={slot.name}
                  />
                  <button
                    className="button button--ghost"
                    disabled={pending || outputSlots.length === 1}
                    onClick={() => {
                      setOutputSlots((current) =>
                        current.filter((candidate) => candidate.id !== slot.id)
                      );
                    }}
                    type="button"
                  >
                    -
                  </button>
                </div>
              ))}
            </div>

            <button
              className="button button--ghost python-slot-editor__add"
              disabled={pending}
              onClick={() => {
                setOutputSlots((current) => [...current, createOutputSlotDraft()]);
              }}
              type="button"
            >
              +
            </button>
          </section>

          <div className="dialog-actions">
            <button className="button button--ghost" disabled={pending} onClick={onClose} type="button">
              Close
            </button>
            <button
              className="button button--primary"
              disabled={pending || !entryAbsolutePath}
              onClick={() => {
                void handleRegister();
              }}
              type="button"
            >
              {pending ? "登録中..." : "登録して挿入"}
            </button>
          </div>
        </div>
      </div>

      {slotPickerTargetId ? (
        <OriginalDataSelectionDialog
          confirmLabel="この元データを使う"
          description="選択した元データ群から、登録時に source dataset を自動作成します。"
          initialSelectedOriginalDataIds={
            inputSlots.find((slot) => slot.id === slotPickerTargetId)?.originalDataIds ?? []
          }
          onClose={() => {
            setSlotPickerTargetId(null);
          }}
          onError={onError}
          onImportedOriginalData={onImportedOriginalData}
          onSelect={(originalDataIds) => {
            updateInputSlot(slotPickerTargetId, (current) => ({
              ...current,
              originalDataIds
            }));
            setSlotPickerTargetId(null);
          }}
          title="Input 用元データを選択"
        />
      ) : null}
    </div>
  );
}


