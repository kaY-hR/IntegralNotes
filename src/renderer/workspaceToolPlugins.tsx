import type { ReactNode } from "react";

import type { IntegralAssetCatalog } from "../shared/integral";
import type { WorkspaceEntry } from "../shared/workspace";
import { AIChatPanel } from "./AIChatPanel";
import { ProcessChainViewer } from "./ProcessChainViewer";

export interface WorkspaceToolPluginRenderContext {
  assetCatalog: IntegralAssetCatalog;
  contextRelativePath: string | null;
  noteOverrides: Record<string, string>;
  onOpenWorkspaceFile: (relativePath: string) => void;
  onOpenWorkspaceTarget: (target: string) => void;
  selectedEntryPaths: string[];
  workspaceEntries: WorkspaceEntry[];
  workspaceRevision: number;
  workspaceRootName: string | null;
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

function AIChatToolIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" className="activity-bar__icon-svg" viewBox="0 0 16 16">
      <path d="M2 3.2h12v7.1H7.2L4.1 13v-2.7H2z" />
      <path d="M4.8 5.7h6.4" />
      <path d="M4.8 8h4.6" />
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

const aiChatToolPlugin: WorkspaceToolPluginDefinition = {
  activityIcon: <AIChatToolIcon />,
  description: "workspace 文脈を渡して coding chat を行います。",
  id: "builtin:ai-chat",
  render: (context) => <AIChatPanel {...context} />,
  tabTitle: "AI Chat",
  title: "AI Chat"
};

export const workspaceToolPlugins: readonly WorkspaceToolPluginDefinition[] = [
  aiChatToolPlugin,
  processChainToolPlugin
];

export function findWorkspaceToolPlugin(
  pluginId: string
): WorkspaceToolPluginDefinition | undefined {
  return workspaceToolPlugins.find((plugin) => plugin.id === pluginId);
}
