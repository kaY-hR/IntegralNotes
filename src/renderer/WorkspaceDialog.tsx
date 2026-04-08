import { useEffect, useState } from "react";

interface WorkspaceDialogProps {
  confirmLabel: string;
  danger?: boolean;
  description: string;
  initialValue?: string;
  inputLabel?: string;
  onClose: () => void;
  onConfirm: (value: string) => void;
  pending: boolean;
  requireInput: boolean;
  title: string;
}

export function WorkspaceDialog({
  confirmLabel,
  danger = false,
  description,
  initialValue = "",
  inputLabel,
  onClose,
  onConfirm,
  pending,
  requireInput,
  title
}: WorkspaceDialogProps): JSX.Element {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue, title]);

  return (
    <div className="dialog-backdrop">
      <div className="dialog-card">
        <div className="dialog-card__header">
          <p className="dialog-card__eyebrow">Workspace Action</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>

        <form
          className="dialog-card__body"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm(value);
          }}
        >
          {requireInput ? (
            <label className="dialog-field">
              <span>{inputLabel}</span>
              <input
                autoFocus
                onChange={(event) => {
                  setValue(event.target.value);
                }}
                placeholder="名前を入力"
                type="text"
                value={value}
              />
            </label>
          ) : null}

          <div className="dialog-actions">
            <button
              className="button button--ghost"
              disabled={pending}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className={`button ${danger ? "button--danger" : "button--primary"}`}
              disabled={pending || (requireInput && value.trim().length === 0)}
              type="submit"
            >
              {pending ? "処理中..." : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
