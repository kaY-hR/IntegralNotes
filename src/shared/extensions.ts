export type ExtensionItemLocation = "global" | "workspace";

export type ExtensionItemKind = "package" | "runtime" | "script" | "skill";

export interface ExtensionPythonCallableSummary {
  blockType: string;
  functionName: string;
}

export interface ExtensionSkillSummary {
  displayName: string;
  id: string;
  location: ExtensionItemLocation;
  relativePath: string;
  rootLabel: string;
}

export interface ExtensionScriptSummary {
  callables: ExtensionPythonCallableSummary[];
  displayName: string;
  location: ExtensionItemLocation;
  relativePath: string;
  rootLabel: string;
}

export interface ExtensionRuntimeSummary {
  blocksCount: number;
  description: string;
  displayName: string;
  hasHost: boolean;
  hasRenderer: boolean;
  id: string;
  rootLabel: string | null;
  sidebarViewsCount: number;
  version: string;
  viewersCount: number;
}

export interface ExtensionPackagePythonBlockSummary {
  functionName: string;
  scriptPath: string;
  workspaceBlockType: string;
}

export interface ExtensionPackageSideSummary {
  displayName: string;
  pythonBlocks: ExtensionPackagePythonBlockSummary[];
  rootLabel: string;
  runtimePlugins: string[];
  sharedFiles: string[];
  skills: string[];
  version: string;
}

export interface ExtensionPackageSummary {
  displayName: string;
  global: ExtensionPackageSideSummary | null;
  id: string;
  workspace: ExtensionPackageSideSummary | null;
}

export interface ExtensionManagementSnapshot {
  globalRootLabel: string | null;
  globalScriptsRootLabel: string | null;
  globalSkillsRootLabel: string | null;
  packageRootLabel: string | null;
  packages: ExtensionPackageSummary[];
  runtimePluginRootLabel: string | null;
  standaloneRuntimePlugins: ExtensionRuntimeSummary[];
  workspaceRootLabel: string | null;
  workspaceRootName: string | null;
  workspaceScripts: ExtensionScriptSummary[];
  workspaceSkills: ExtensionSkillSummary[];
  globalScripts: ExtensionScriptSummary[];
  globalSkills: ExtensionSkillSummary[];
}

export interface ExtensionWorkspaceItemRequest {
  relativePath: string;
}

export interface ExtensionGlobalItemRequest {
  relativePath: string;
}

export interface ExtensionPackageRequest {
  packageId: string;
}

export interface ExtensionRuntimeRequest {
  pluginId: string;
}

export interface ExtensionOpenItemRequest {
  kind: ExtensionItemKind;
  location: ExtensionItemLocation;
  packageId?: string;
  pluginId?: string;
  relativePath?: string;
}

export interface ExtensionMutationResult {
  cancelled: boolean;
  message: string;
  pluginRuntimeChanged: boolean;
  workspaceChanged: boolean;
}
