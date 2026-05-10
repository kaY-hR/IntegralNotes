import { useEffect, useMemo, useState } from "react";

import type {
  ExtensionManagementSnapshot,
  ExtensionMutationResult,
  ExtensionPackageSummary,
  ExtensionRuntimeSummary,
  ExtensionScriptSummary,
  ExtensionSkillSummary
} from "../shared/extensions";
import type { WorkspaceToolPluginRenderContext } from "./workspaceToolPlugins";

type ExtensionAction = () => Promise<ExtensionMutationResult | null>;

type StandaloneRow =
  | {
      global: ExtensionSkillSummary | null;
      key: string;
      kind: "skill";
      label: string;
      workspace: ExtensionSkillSummary | null;
    }
  | {
      global: ExtensionScriptSummary | null;
      key: string;
      kind: "script";
      label: string;
      workspace: ExtensionScriptSummary | null;
    };

export function ExtensionsManagerView(
  context: WorkspaceToolPluginRenderContext
): JSX.Element {
  const [snapshot, setSnapshot] = useState<ExtensionManagementSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshSnapshot = async (): Promise<void> => {
    setLoading(true);
    setErrorMessage(null);

    try {
      setSnapshot(await window.integralNotes.getExtensionManagementSnapshot());
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshSnapshot();
  }, [context.workspaceRevision]);

  const skillRows = useMemo(
    () =>
      snapshot
        ? buildStandaloneRows("skill", snapshot.workspaceSkills, snapshot.globalSkills)
        : [],
    [snapshot]
  );
  const scriptRows = useMemo(
    () =>
      snapshot
        ? buildStandaloneRows("script", snapshot.workspaceScripts, snapshot.globalScripts)
        : [],
    [snapshot]
  );
  const busy = pendingAction !== null || loading;

  const runMutation = async (actionKey: string, action: ExtensionAction): Promise<void> => {
    setPendingAction(actionKey);
    setErrorMessage(null);

    try {
      const result = await action();

      if (!result) {
        context.onSetStatusMessage("package install をキャンセルしました。");
        return;
      }

      await handleMutationResult(result, context);
      await refreshSnapshot();
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
      context.onSetStatusMessage(toErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  };

  const openGlobalItem = async (
    kind: "package" | "runtime" | "script" | "skill",
    request: {
      packageId?: string;
      pluginId?: string;
      relativePath?: string;
    }
  ): Promise<void> => {
    setPendingAction(`open:${kind}:${request.relativePath ?? request.packageId ?? request.pluginId ?? ""}`);
    setErrorMessage(null);

    try {
      await window.integralNotes.openExtensionItem({
        kind,
        location: "global",
        packageId: request.packageId,
        pluginId: request.pluginId,
        relativePath: request.relativePath
      });
      context.onSetStatusMessage("対象をエクスプローラーで開きました。");
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
      context.onSetStatusMessage(toErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  };

  const openWorkspaceDirectory = async (relativePath: string): Promise<void> => {
    setPendingAction(`open:workspace:${relativePath}`);
    setErrorMessage(null);

    try {
      await window.integralNotes.openExtensionItem({
        kind: "skill",
        location: "workspace",
        relativePath
      });
      context.onSetStatusMessage(`${relativePath} をエクスプローラーで開きました。`);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
      context.onSetStatusMessage(toErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section className="extensions-manager">
      <header className="extensions-manager__header">
        <div>
          <p className="extensions-manager__eyebrow">Extensions</p>
          <h2 className="extensions-manager__title">拡張機能管理</h2>
          <p className="extensions-manager__description">
            Current Workspace と Global にある skill / script / runtime / package を管理します。
          </p>
        </div>
        <div className="extensions-manager__actions">
          <button
            className="button button--ghost"
            disabled={busy}
            onClick={() => {
              void refreshSnapshot();
            }}
            type="button"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button
            className="button button--primary"
            disabled={busy}
            onClick={() => {
              void runMutation("install-package", () => window.integralNotes.installExtensionPackage());
            }}
            type="button"
          >
            {pendingAction === "install-package" ? "Installing..." : "Install Package..."}
          </button>
        </div>
      </header>

      {snapshot ? (
        <div className="extensions-manager__roots">
          <span>
            <strong>Current Workspace</strong>
            {snapshot.workspaceRootName ?? "not opened"}
          </span>
          <span>
            <strong>Global</strong>
            {snapshot.globalRootLabel ?? "not available"}
          </span>
        </div>
      ) : null}

      {errorMessage ? <div className="extensions-manager__error">{errorMessage}</div> : null}

      <div className="extensions-grid extensions-grid--header">
        <div>Type / Item</div>
        <div>Current Workspace</div>
        <div>Global</div>
      </div>

      {snapshot ? (
        <>
          <ExtensionSection
            emptyLabel="standalone skill はありません。"
            rows={skillRows.map((row) =>
              renderSkillRow(row, {
                busy,
                onDeleteWorkspace: (relativePath) =>
                  runMutation(`delete-workspace-skill:${relativePath}`, () =>
                    window.integralNotes.deleteWorkspaceExtensionItem({ relativePath })
                  ),
                onOpenGlobal: (relativePath) => openGlobalItem("skill", { relativePath }),
                onOpenWorkspace: openWorkspaceDirectory,
                onStockWorkspace: (relativePath) =>
                  runMutation(`stock-workspace-skill:${relativePath}`, () =>
                    window.integralNotes.stockWorkspaceSkillOnGlobal({ relativePath })
                  ),
                onDeleteGlobal: (relativePath) =>
                  runMutation(`delete-global-skill:${relativePath}`, () =>
                    window.integralNotes.deleteGlobalSkill({ relativePath })
                  )
              })
            )}
            title="Skills"
          />

          <ExtensionSection
            emptyLabel="standalone script はありません。"
            rows={scriptRows.map((row) =>
              renderScriptRow(row, {
                busy,
                onDeleteWorkspace: (relativePath) =>
                  runMutation(`delete-workspace-script:${relativePath}`, () =>
                    window.integralNotes.deleteWorkspaceExtensionItem({ relativePath })
                  ),
                onImportGlobal: (relativePath) =>
                  runMutation(`import-global-script:${relativePath}`, () =>
                    window.integralNotes.importGlobalScriptToWorkspace({ relativePath })
                  ),
                onOpenGlobal: (relativePath) => openGlobalItem("script", { relativePath }),
                onOpenWorkspace: (relativePath) => {
                  context.onOpenWorkspaceFile(relativePath);
                  context.onSetStatusMessage(`${relativePath} を開きました。`);
                },
                onStockWorkspace: (relativePath) =>
                  runMutation(`stock-workspace-script:${relativePath}`, () =>
                    window.integralNotes.stockWorkspaceScriptOnGlobal({ relativePath })
                  ),
                onDeleteGlobal: (relativePath) =>
                  runMutation(`delete-global-script:${relativePath}`, () =>
                    window.integralNotes.deleteGlobalScript({ relativePath })
                  )
              })
            )}
            title="Scripts"
          />

          <ExtensionSection
            emptyLabel="standalone runtime plugin はありません。"
            rows={snapshot.standaloneRuntimePlugins.map((runtime) =>
              renderRuntimeRow(runtime, {
                busy,
                onOpen: (pluginId) => openGlobalItem("runtime", { pluginId }),
                onUninstall: (pluginId) =>
                  runMutation(`uninstall-runtime:${pluginId}`, () =>
                    window.integralNotes.uninstallStandaloneRuntimePlugin({ pluginId })
                  )
              })
            )}
            title="Standalone Runtime"
          />

          <ExtensionSection
            emptyLabel="package はありません。"
            rows={snapshot.packages.map((packageItem) =>
              renderPackageRow(packageItem, {
                busy,
                onImport: (packageId) =>
                  runMutation(`import-package:${packageId}`, () =>
                    window.integralNotes.importExtensionPackage({ packageId })
                  ),
                onInstallRepair: () =>
                  runMutation("install-repair-package", () =>
                    window.integralNotes.installExtensionPackage()
                  ),
                onOpenGlobal: (packageId) => openGlobalItem("package", { packageId }),
                onOpenWorkspace: (packageId) =>
                  openWorkspaceDirectory(`.packages/${packageId}`),
                onRemoveImport: (packageId) =>
                  runMutation(`remove-package-import:${packageId}`, () =>
                    window.integralNotes.removeExtensionPackageImport({ packageId })
                  ),
                onUninstall: (packageId) =>
                  runMutation(`uninstall-package:${packageId}`, () =>
                    window.integralNotes.uninstallExtensionPackage({ packageId })
                  )
              })
            )}
            title="Packages"
          />
        </>
      ) : (
        <div className="extensions-grid__empty">
          {loading ? "拡張機能を読み込んでいます。" : "拡張機能情報を読み込めませんでした。"}
        </div>
      )}
    </section>
  );
}

function ExtensionSection({
  emptyLabel,
  rows,
  title
}: {
  emptyLabel: string;
  rows: JSX.Element[];
  title: string;
}): JSX.Element {
  return (
    <section className="extensions-section">
      <div className="extensions-section__title">{title}</div>
      {rows.length > 0 ? rows : <div className="extensions-grid__empty">{emptyLabel}</div>}
    </section>
  );
}

function renderSkillRow(
  row: Extract<StandaloneRow, { kind: "skill" }>,
  actions: {
    busy: boolean;
    onDeleteGlobal: (relativePath: string) => Promise<void>;
    onDeleteWorkspace: (relativePath: string) => Promise<void>;
    onOpenGlobal: (relativePath: string) => Promise<void>;
    onOpenWorkspace: (relativePath: string) => Promise<void>;
    onStockWorkspace: (relativePath: string) => Promise<void>;
  }
): JSX.Element {
  return (
    <div className="extensions-grid extensions-row" key={row.key}>
      <ItemCell label={row.label} meta="skill" />
      <div className="extensions-cell">
        {row.workspace ? (
          <LocationPanel
            actions={[
              {
                label: "Open",
                onClick: () => actions.onOpenWorkspace(row.workspace?.relativePath ?? "")
              },
              {
                label: "Delete",
                onClick: () => actions.onDeleteWorkspace(row.workspace?.relativePath ?? "")
              },
              {
                label: "Stock on Global",
                onClick: () => actions.onStockWorkspace(row.workspace?.relativePath ?? "")
              }
            ]}
            disabled={actions.busy}
            item={row.workspace}
            status="present"
          />
        ) : (
          <EmptyCell />
        )}
      </div>
      <div className="extensions-cell">
        {row.global ? (
          <LocationPanel
            actions={[
              {
                label: "Open",
                onClick: () => actions.onOpenGlobal(row.global?.relativePath ?? "")
              },
              {
                label: "Delete",
                onClick: () => actions.onDeleteGlobal(row.global?.relativePath ?? "")
              }
            ]}
            disabled={actions.busy}
            item={row.global}
            status="available"
          />
        ) : (
          <EmptyCell />
        )}
      </div>
    </div>
  );
}

function renderScriptRow(
  row: Extract<StandaloneRow, { kind: "script" }>,
  actions: {
    busy: boolean;
    onDeleteGlobal: (relativePath: string) => Promise<void>;
    onDeleteWorkspace: (relativePath: string) => Promise<void>;
    onImportGlobal: (relativePath: string) => Promise<void>;
    onOpenGlobal: (relativePath: string) => Promise<void>;
    onOpenWorkspace: (relativePath: string) => void;
    onStockWorkspace: (relativePath: string) => Promise<void>;
  }
): JSX.Element {
  return (
    <div className="extensions-grid extensions-row" key={row.key}>
      <ItemCell label={row.label} meta="script" />
      <div className="extensions-cell">
        {row.workspace ? (
          <ScriptPanel
            actions={[
              {
                label: "Open",
                onClick: () => actions.onOpenWorkspace(row.workspace?.relativePath ?? "")
              },
              {
                label: "Delete",
                onClick: () => actions.onDeleteWorkspace(row.workspace?.relativePath ?? "")
              },
              {
                label: "Stock on Global",
                onClick: () => actions.onStockWorkspace(row.workspace?.relativePath ?? "")
              }
            ]}
            disabled={actions.busy}
            script={row.workspace}
            status="present"
          />
        ) : (
          <EmptyCell />
        )}
      </div>
      <div className="extensions-cell">
        {row.global ? (
          <ScriptPanel
            actions={[
              {
                label: "Open",
                onClick: () => actions.onOpenGlobal(row.global?.relativePath ?? "")
              },
              {
                label: "Import",
                onClick: () => actions.onImportGlobal(row.global?.relativePath ?? "")
              },
              {
                label: "Delete",
                onClick: () => actions.onDeleteGlobal(row.global?.relativePath ?? "")
              }
            ]}
            disabled={actions.busy}
            script={row.global}
            status="stock"
          />
        ) : (
          <EmptyCell />
        )}
      </div>
    </div>
  );
}

function renderRuntimeRow(
  runtime: ExtensionRuntimeSummary,
  actions: {
    busy: boolean;
    onOpen: (pluginId: string) => Promise<void>;
    onUninstall: (pluginId: string) => Promise<void>;
  }
): JSX.Element {
  return (
    <div className="extensions-grid extensions-row" key={runtime.id}>
      <ItemCell label={runtime.displayName} meta={`runtime / ${runtime.id}`} />
      <EmptyCell />
      <div className="extensions-cell">
        <div className="extensions-location">
          <div className="extensions-location__main">
            <span className="extensions-status extensions-status--global">installed</span>
            <code>{runtime.version}</code>
          </div>
          <p className="extensions-location__path">{runtime.rootLabel ?? runtime.id}</p>
          <div className="extensions-location__details">
            <span>{runtime.blocksCount} blocks</span>
            <span>{runtime.viewersCount} viewers</span>
            <span>{runtime.sidebarViewsCount} sidebar</span>
            {runtime.hasHost ? <span>host</span> : null}
            {runtime.hasRenderer ? <span>renderer</span> : null}
          </div>
          <ActionList
            actions={[
              {
                label: "Open",
                onClick: () => actions.onOpen(runtime.id)
              },
              {
                label: "Uninstall",
                onClick: () => actions.onUninstall(runtime.id)
              }
            ]}
            disabled={actions.busy}
          />
        </div>
      </div>
    </div>
  );
}

function renderPackageRow(
  packageItem: ExtensionPackageSummary,
  actions: {
    busy: boolean;
    onImport: (packageId: string) => Promise<void>;
    onInstallRepair: () => Promise<void>;
    onOpenGlobal: (packageId: string) => Promise<void>;
    onOpenWorkspace: (packageId: string) => Promise<void>;
    onRemoveImport: (packageId: string) => Promise<void>;
    onUninstall: (packageId: string) => Promise<void>;
  }
): JSX.Element {
  return (
    <div className="extensions-grid extensions-row extensions-row--package" key={packageItem.id}>
      <ItemCell label={packageItem.displayName} meta={`package / ${packageItem.id}`} />
      <div className="extensions-cell">
        {packageItem.workspace ? (
          <PackageSidePanel
            actions={[
              {
                label: "Open",
                onClick: () => actions.onOpenWorkspace(packageItem.id)
              },
              ...(packageItem.global
                ? [
                    {
                      label: "Reimport",
                      onClick: () => actions.onImport(packageItem.id)
                    }
                  ]
                : []),
              {
                label: "Remove Import",
                onClick: () => actions.onRemoveImport(packageItem.id)
              }
            ]}
            disabled={actions.busy}
            side={packageItem.workspace}
            status="imported"
          />
        ) : packageItem.global ? (
          <ActionOnlyPanel
            actions={[
              {
                label: "Import",
                onClick: () => actions.onImport(packageItem.id)
              }
            ]}
            disabled={actions.busy}
            status="not imported"
          />
        ) : (
          <EmptyCell />
        )}
      </div>
      <div className="extensions-cell">
        {packageItem.global ? (
          <PackageSidePanel
            actions={[
              {
                label: "Open",
                onClick: () => actions.onOpenGlobal(packageItem.id)
              },
              {
                label: "Uninstall Package",
                onClick: () => actions.onUninstall(packageItem.id)
              }
            ]}
            disabled={actions.busy}
            side={packageItem.global}
            status="installed"
          />
        ) : (
          <ActionOnlyPanel
            actions={[
              {
                label: "Install/Repair...",
                onClick: actions.onInstallRepair
              }
            ]}
            disabled={actions.busy}
            status="missing"
            warning
          />
        )}
      </div>
    </div>
  );
}

function ItemCell({ label, meta }: { label: string; meta: string }): JSX.Element {
  return (
    <div className="extensions-item-cell">
      <strong>{label}</strong>
      <span>{meta}</span>
    </div>
  );
}

function EmptyCell(): JSX.Element {
  return (
    <div className="extensions-cell extensions-cell--empty">
      <span>-</span>
    </div>
  );
}

function LocationPanel({
  actions,
  disabled,
  item,
  status
}: {
  actions: Array<{ label: string; onClick: () => void | Promise<void> }>;
  disabled: boolean;
  item: ExtensionSkillSummary;
  status: string;
}): JSX.Element {
  return (
    <div className="extensions-location">
      <div className="extensions-location__main">
        <span className="extensions-status">{status}</span>
        <code>{item.id}</code>
      </div>
      <p className="extensions-location__path">{item.relativePath}</p>
      <ActionList actions={actions} disabled={disabled} />
    </div>
  );
}

function ScriptPanel({
  actions,
  disabled,
  script,
  status
}: {
  actions: Array<{ label: string; onClick: () => void | Promise<void> }>;
  disabled: boolean;
  script: ExtensionScriptSummary;
  status: string;
}): JSX.Element {
  return (
    <div className="extensions-location">
      <div className="extensions-location__main">
        <span className="extensions-status">{status}</span>
        <code>{script.relativePath}</code>
      </div>
      {script.callables.length > 0 ? (
        <div className="extensions-location__details">
          {script.callables.map((callable) => (
            <span key={callable.blockType}>{callable.functionName}()</span>
          ))}
        </div>
      ) : null}
      <ActionList actions={actions} disabled={disabled} />
    </div>
  );
}

function PackageSidePanel({
  actions,
  disabled,
  side,
  status
}: {
  actions: Array<{ label: string; onClick: () => void | Promise<void> }>;
  disabled: boolean;
  side: NonNullable<ExtensionPackageSummary["global"]>;
  status: string;
}): JSX.Element {
  return (
    <div className="extensions-location">
      <div className="extensions-location__main">
        <span className="extensions-status">{status}</span>
        <code>{side.version}</code>
      </div>
      <p className="extensions-location__path">{side.rootLabel}</p>
      <PackageDetails side={side} />
      <ActionList actions={actions} disabled={disabled} />
    </div>
  );
}

function ActionOnlyPanel({
  actions,
  disabled,
  status,
  warning
}: {
  actions: Array<{ label: string; onClick: () => void | Promise<void> }>;
  disabled: boolean;
  status: string;
  warning?: boolean;
}): JSX.Element {
  return (
    <div className="extensions-location">
      <div className="extensions-location__main">
        <span className={`extensions-status${warning ? " extensions-status--warning" : ""}`}>
          {status}
        </span>
      </div>
      <ActionList actions={actions} disabled={disabled} />
    </div>
  );
}

function PackageDetails({
  side
}: {
  side: NonNullable<ExtensionPackageSummary["global"]>;
}): JSX.Element {
  const rows = [
    ["skills", side.skills],
    ["scripts", side.pythonBlocks.map((block) => `${block.scriptPath}:${block.functionName}`)],
    ["runtime", side.runtimePlugins],
    ["shared", side.sharedFiles]
  ] as const;

  return (
    <div className="extensions-package-details">
      {rows.map(([label, values]) => (
        <div className="extensions-package-details__row" key={label}>
          <span>{label}</span>
          <ValueList values={values} />
        </div>
      ))}
    </div>
  );
}

function ValueList({ values }: { values: readonly string[] }): JSX.Element {
  if (values.length === 0) {
    return <code>-</code>;
  }

  return (
    <div className="extensions-value-list">
      {values.map((value) => (
        <code key={value}>{value}</code>
      ))}
    </div>
  );
}

function ActionList({
  actions,
  disabled
}: {
  actions: Array<{ label: string; onClick: () => void | Promise<void> }>;
  disabled: boolean;
}): JSX.Element {
  return (
    <div className="extensions-actions">
      {actions.map((action) => (
        <button
          className="button button--ghost"
          disabled={disabled}
          key={action.label}
          onClick={() => {
            void action.onClick();
          }}
          type="button"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

function buildStandaloneRows(
  kind: "skill",
  workspaceItems: ExtensionSkillSummary[],
  globalItems: ExtensionSkillSummary[]
): Extract<StandaloneRow, { kind: "skill" }>[];
function buildStandaloneRows(
  kind: "script",
  workspaceItems: ExtensionScriptSummary[],
  globalItems: ExtensionScriptSummary[]
): Extract<StandaloneRow, { kind: "script" }>[];
function buildStandaloneRows(
  kind: "script" | "skill",
  workspaceItems: Array<ExtensionScriptSummary | ExtensionSkillSummary>,
  globalItems: Array<ExtensionScriptSummary | ExtensionSkillSummary>
): StandaloneRow[] {
  const rows = new Map<string, StandaloneRow>();

  for (const item of workspaceItems) {
    const key = getStandaloneRowKey(kind, item, "workspace");
    const current = rows.get(key);

    rows.set(key, {
      global: current?.global ?? null,
      key,
      kind,
      label: item.displayName,
      workspace: item
    } as StandaloneRow);
  }

  for (const item of globalItems) {
    const key = getStandaloneRowKey(kind, item, "global");
    const current = rows.get(key);

    rows.set(key, {
      global: item,
      key,
      kind,
      label: current?.label ?? item.displayName,
      workspace: current?.workspace ?? null
    } as StandaloneRow);
  }

  return Array.from(rows.values()).sort((left, right) =>
    left.label.localeCompare(right.label, "ja") || left.key.localeCompare(right.key, "ja")
  );
}

function getStandaloneRowKey(
  kind: "script" | "skill",
  item: ExtensionScriptSummary | ExtensionSkillSummary,
  location: "global" | "workspace"
): string {
  if (kind === "skill") {
    return `${kind}:${location}:${item.relativePath}`;
  }

  if (location === "workspace" && item.relativePath.startsWith("scripts/")) {
    return `${kind}:${item.relativePath.slice("scripts/".length)}`;
  }

  return `${kind}:${item.relativePath}`;
}

async function handleMutationResult(
  result: ExtensionMutationResult,
  context: WorkspaceToolPluginRenderContext
): Promise<void> {
  if (result.cancelled) {
    context.onSetStatusMessage(result.message);
    return;
  }

  if (result.workspaceChanged) {
    await context.onRefreshWorkspace(result.message);
  }

  if (result.pluginRuntimeChanged) {
    await context.onPluginRuntimeChanged(result.message);
  }

  if (!result.workspaceChanged && !result.pluginRuntimeChanged) {
    context.onSetStatusMessage(result.message);
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
