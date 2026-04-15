import { useEffect, useState } from "react";

import type { IntegralManagedDataTrackingIssue } from "../shared/integral";

interface ManagedDataTrackingDialogProps {
  issue: IntegralManagedDataTrackingIssue;
  onClose: () => void;
  onConfirm: (selectedPath: string) => void;
  pending: boolean;
}

export function ManagedDataTrackingDialog({
  issue,
  onClose,
  onConfirm,
  pending
}: ManagedDataTrackingDialogProps): JSX.Element {
  const [selectedPath, setSelectedPath] = useState(issue.candidatePaths[0] ?? "");

  useEffect(() => {
    setSelectedPath(issue.candidatePaths[0] ?? "");
  }, [issue]);

  return (
    <div className="dialog-backdrop">
      <div className="dialog-card dialog-card--tracking">
        <div className="dialog-card__header">
          <p className="dialog-card__eyebrow">Managed Data Tracking</p>
          <h2>tracked path の確認</h2>
          <p>
            <strong>{issue.displayName}</strong> の recorded path が見つかりません。候補の中から現在の
            path を選んでください。
          </p>
        </div>

        <div className="dialog-card__body dialog-card__body--tracking">
          <dl className="tracking-dialog__summary">
            <div>
              <dt>ID</dt>
              <dd>{issue.targetId}</dd>
            </div>
            <div>
              <dt>種別</dt>
              <dd>{issue.entityType}</dd>
            </div>
            <div>
              <dt>recorded path</dt>
              <dd>{issue.recordedPath}</dd>
            </div>
            <div>
              <dt>recorded hash</dt>
              <dd>{issue.recordedHash}</dd>
            </div>
          </dl>

          <fieldset className="tracking-dialog__candidates">
            <legend>候補 path</legend>
            {issue.candidatePaths.map((candidatePath) => (
              <label key={candidatePath} className="tracking-dialog__candidate">
                <input
                  checked={candidatePath === selectedPath}
                  disabled={pending}
                  name={`tracking-${issue.targetId}`}
                  onChange={() => {
                    setSelectedPath(candidatePath);
                  }}
                  type="radio"
                />
                <span>{candidatePath}</span>
              </label>
            ))}
          </fieldset>

          <div className="dialog-actions">
            <button
              className="button button--ghost"
              disabled={pending}
              onClick={onClose}
              type="button"
            >
              後で確認
            </button>
            <button
              className="button button--primary"
              disabled={pending || selectedPath.length === 0}
              onClick={() => {
                onConfirm(selectedPath);
              }}
              type="button"
            >
              {pending ? "更新中..." : "この path で更新"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
