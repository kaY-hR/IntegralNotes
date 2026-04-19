import type { ReactNode } from "react";

import type { IntegralAssetCatalog } from "../shared/integral";
import type { WorkspaceEntry } from "../shared/workspace";
import { ProcessChainViewer } from "./ProcessChainViewer";

export interface WorkspaceToolPluginRenderContext {
  assetCatalog: IntegralAssetCatalog;
  contextRelativePath: string | null;
  noteOverrides: Record<string, string>;
  onOpenWorkspaceFile: (relativePath: string) => void;
  onOpenWorkspaceTarget: (target: string) => void;
  workspaceEntries: WorkspaceEntry[];
}

export interface WorkspaceToolPluginDefinition {
  activityIcon: ReactNode;
  description: string;
  id: string;
  render: (context: WorkspaceToolPluginRenderContext) => JSX.Element;
  tabTitle: string;
  title: string;
}

function ProcessChainToolIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" className="activity-bar__icon-svg" viewBox="0 0 16 16">
      <circle cx="3" cy="8" r="1.55" />
      <circle cx="8" cy="3" r="1.55" />
      <circle cx="13" cy="8" r="1.55" />
      <circle cx="8" cy="13" r="1.55" />
      <path d="M4.35 7.15 6.9 4.4" />
      <path d="M9.1 4.4 11.65 7.15" />
      <path d="M11.65 8.85 9.1 11.6" />
      <path d="M6.9 11.6 4.35 8.85" />
    </svg>
  );
}

const processChainToolPlugin: WorkspaceToolPluginDefinition = {
  activityIcon: <ProcessChainToolIcon />,
  description: "現在の note / file を起点に、関連する block と file の chain を辿って表示します。",
  id: "builtin:process-chain-viewer",
  render: (context) => <ProcessChainViewer {...context} />,
  tabTitle: "Process Chain",
  title: "Process Chain"
};

export const workspaceToolPlugins: readonly WorkspaceToolPluginDefinition[] = [
  processChainToolPlugin
];

export function findWorkspaceToolPlugin(
  pluginId: string
): WorkspaceToolPluginDefinition | undefined {
  return workspaceToolPlugins.find((plugin) => plugin.id === pluginId);
}
