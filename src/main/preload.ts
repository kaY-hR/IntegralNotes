import { contextBridge, ipcRenderer, webFrame, webUtils, type IpcRendererEvent } from "electron";

import type { IntegralNotesApi } from "../shared/workspace";

const MIN_ZOOM_LEVEL = -3;
const MAX_ZOOM_LEVEL = 3;
const ZOOM_LEVEL_STEP = 0.5;

function clampZoomLevel(zoomLevel: number): number {
  return Math.max(MIN_ZOOM_LEVEL, Math.min(zoomLevel, MAX_ZOOM_LEVEL));
}

function adjustZoomLevel(direction: "in" | "out" | "reset"): void {
  if (direction === "reset") {
    webFrame.setZoomLevel(0);
    return;
  }

  const currentZoomLevel = webFrame.getZoomLevel();
  const delta = direction === "in" ? ZOOM_LEVEL_STEP : -ZOOM_LEVEL_STEP;
  webFrame.setZoomLevel(clampZoomLevel(currentZoomLevel + delta));
}

const api: IntegralNotesApi = {
  logRendererEvent: (request) => ipcRenderer.invoke("app:rendererLog", request),
  confirmDiscardUnsavedChanges: (request) =>
    ipcRenderer.invoke("app:confirmDiscardUnsavedChanges", request),
  onBeforeCloseRequest: (handler) => {
    const listener = (_event: IpcRendererEvent, request: Parameters<typeof handler>[0]) => {
      handler(request);
    };

    ipcRenderer.on("app:beforeCloseRequest", listener);
    return () => {
      ipcRenderer.removeListener("app:beforeCloseRequest", listener);
    };
  },
  respondBeforeClose: (response) => ipcRenderer.send("app:beforeCloseResponse", response),
  getAppSettings: () => ipcRenderer.invoke("app-settings:get"),
  saveAppSettings: (request) => ipcRenderer.invoke("app-settings:save", request),
  createDataset: (request) => ipcRenderer.invoke("integral:createDataset", request),
  createDatasetFromFileDialog: (request) =>
    ipcRenderer.invoke("integral:createDatasetFromFileDialog", request),
  createDatasetFromWorkspaceEntries: (request) =>
    ipcRenderer.invoke("integral:createDatasetFromWorkspaceEntries", request),
  getWorkspaceSnapshot: () => ipcRenderer.invoke("workspace:getSnapshot"),
  openWorkspaceFolder: () => ipcRenderer.invoke("workspace:openFolder"),
  syncWorkspace: () => ipcRenderer.invoke("workspace:sync"),
  applyWorkspaceTemplate: () => ipcRenderer.invoke("workspace:applyTemplate"),
  zoomIn: () => adjustZoomLevel("in"),
  zoomOut: () => adjustZoomLevel("out"),
  resetZoom: () => adjustZoomLevel("reset"),
  getIntegralAssetCatalog: () => ipcRenderer.invoke("integral:getAssetCatalog"),
  listManagedDataTrackingIssues: () => ipcRenderer.invoke("integral:listManagedDataTrackingIssues"),
  importManagedFileDirectories: () => ipcRenderer.invoke("integral:importManagedFileDirectories"),
  importManagedFileFiles: () => ipcRenderer.invoke("integral:importManagedFileFiles"),
  inspectDataset: (datasetId) => ipcRenderer.invoke("integral:inspectDataset", datasetId),
  selectWorkspaceDirectory: (initialRelativePath) =>
    ipcRenderer.invoke("workspace:selectDirectory", initialRelativePath),
  selectWorkspaceFile: (request) => ipcRenderer.invoke("workspace:selectFile", request),
  getPluginInstallRootPath: () => ipcRenderer.invoke("plugins:getInstallRootPath"),
  listInstalledPlugins: () => ipcRenderer.invoke("plugins:listInstalled"),
  installPluginFromZip: () => ipcRenderer.invoke("plugins:installFromZip"),
  loadPluginRendererDocument: (pluginId) => ipcRenderer.invoke("plugins:loadRendererDocument", pluginId),
  loadPluginSidebarViewDocument: (pluginId, sidebarViewId) =>
    ipcRenderer.invoke("plugins:loadSidebarViewDocument", pluginId, sidebarViewId),
  loadPluginViewerDocument: (pluginId, viewerId) =>
    ipcRenderer.invoke("plugins:loadViewerDocument", pluginId, viewerId),
  resolveManagedDataTrackingIssue: (request) =>
    ipcRenderer.invoke("integral:resolveManagedDataTrackingIssue", request),
  readWorkspaceFile: (relativePath) => ipcRenderer.invoke("workspace:readFile", relativePath),
  readNote: (relativePath) => ipcRenderer.invoke("workspace:readNote", relativePath),
  searchWorkspaceText: (request) => ipcRenderer.invoke("workspace:searchText", request),
  replaceWorkspaceText: (request) => ipcRenderer.invoke("workspace:replaceText", request),
  saveNote: (relativePath, content) =>
    ipcRenderer.invoke("workspace:saveNote", relativePath, content),
  createEntry: (request) => ipcRenderer.invoke("workspace:createEntry", request),
  renameEntry: (request) => ipcRenderer.invoke("workspace:renameEntry", request),
  deleteEntry: (request) => ipcRenderer.invoke("workspace:deleteEntry", request),
  deleteEntries: (request) => ipcRenderer.invoke("workspace:deleteEntries", request),
  copyEntries: (request) => ipcRenderer.invoke("workspace:copyEntries", request),
  moveEntries: (request) => ipcRenderer.invoke("workspace:moveEntries", request),
  copyExternalEntries: (request) => ipcRenderer.invoke("workspace:copyExternalEntries", request),
  saveClipboardImage: (request) => ipcRenderer.invoke("workspace:saveClipboardImage", request),
  saveNoteImage: (request, content) => ipcRenderer.invoke("workspace:saveNoteImage", request, content),
  getPathForFile: (file) =>
    webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0]),
  writeWorkspaceSelectionToClipboard: (relativePaths) =>
    ipcRenderer.send("workspace:writeWorkspaceSelectionToClipboard", relativePaths),
  readWorkspaceSelectionFromClipboard: () =>
    ipcRenderer.invoke("workspace:readWorkspaceSelectionFromClipboard"),
  writeClipboardText: (text) => ipcRenderer.send("workspace:writeClipboardText", text),
  clipboardHasImage: () => ipcRenderer.invoke("workspace:clipboardHasImage"),
  readClipboardExternalPaths: () => ipcRenderer.invoke("workspace:readClipboardExternalPaths"),
  resolveWorkspaceFileUrl: (relativePath) => ipcRenderer.invoke("workspace:resolveFileUrl", relativePath),
  openPathInExternalApp: (relativePath) =>
    ipcRenderer.invoke("workspace:openPathInExternalApp", relativePath),
  openPathInFileManager: (relativePath) =>
    ipcRenderer.invoke("workspace:openPathInFileManager", relativePath),
  openWorkspaceInVSCode: () => ipcRenderer.invoke("workspace:openWorkspaceInVSCode"),
  uninstallPlugin: (pluginId) => ipcRenderer.invoke("plugins:uninstall", pluginId),
  executeIntegralBlock: (request) => ipcRenderer.invoke("integral:executeBlock", request),
  undoIntegralBlock: (request) => ipcRenderer.invoke("integral:undoBlock", request),
  executeIntegralAction: (request) => ipcRenderer.invoke("integral:executeAction", request),
  getAiChatStatus: () => ipcRenderer.invoke("ai-chat:getStatus"),
  saveAiChatSettings: (request) => ipcRenderer.invoke("ai-chat:saveSettings", request),
  clearAiChatApiKey: () => ipcRenderer.invoke("ai-chat:clearApiKey"),
  refreshAiChatModels: () => ipcRenderer.invoke("ai-chat:refreshModels"),
  getAiChatHistory: () => ipcRenderer.invoke("ai-chat:getHistory"),
  createAiChatSession: (request) => ipcRenderer.invoke("ai-chat:createSession", request),
  saveAiChatSession: (request) => ipcRenderer.invoke("ai-chat:saveSession", request),
  switchAiChatSession: (sessionId) => ipcRenderer.invoke("ai-chat:switchSession", sessionId),
  deleteAiChatSession: (sessionId) => ipcRenderer.invoke("ai-chat:deleteSession", sessionId),
  listInlineActions: () => ipcRenderer.invoke("ai-chat:listInlineActions"),
  saveInlineAction: (request) => ipcRenderer.invoke("ai-chat:saveInlineAction", request),
  deleteInlineAction: (name) => ipcRenderer.invoke("ai-chat:deleteInlineAction", name),
  submitAiChat: (request) => ipcRenderer.invoke("ai-chat:submit", request),
  submitInlineAction: (request) => ipcRenderer.invoke("ai-chat:submitInlineAction", request),
  submitInlineAiInsertion: (request) => ipcRenderer.invoke("ai-chat:submitInlineInsertion", request),
  submitInlinePythonBlock: (request) => ipcRenderer.invoke("ai-chat:submitInlinePythonBlock", request),
  submitPromptlessContinuation: (request) =>
    ipcRenderer.invoke("ai-chat:submitPromptlessContinuation", request),
  onAiHostCommandApprovalRequest: (handler) => {
    const listener = (_event: IpcRendererEvent, request: Parameters<typeof handler>[0]) => {
      handler(request);
    };

    ipcRenderer.on("ai-chat:hostCommandApprovalRequest", listener);
    return () => {
      ipcRenderer.removeListener("ai-chat:hostCommandApprovalRequest", listener);
    };
  },
  respondAiHostCommandApproval: (response) =>
    ipcRenderer.invoke("ai-chat:respondHostCommandApproval", response),
  cancelAiHostCommandExecution: (requestId) =>
    ipcRenderer.invoke("ai-chat:cancelHostCommand", requestId),
  onAiHostCommandExecutionUpdate: (handler) => {
    const listener = (_event: IpcRendererEvent, update: Parameters<typeof handler>[0]) => {
      handler(update);
    };

    ipcRenderer.on("ai-chat:hostCommandExecutionUpdate", listener);
    return () => {
      ipcRenderer.removeListener("ai-chat:hostCommandExecutionUpdate", listener);
    };
  },
  onAiHostCommandWorkspaceSynced: (handler) => {
    const listener = (_event: IpcRendererEvent, event: Parameters<typeof handler>[0]) => {
      handler(event);
    };

    ipcRenderer.on("ai-chat:hostCommandWorkspaceSynced", listener);
    return () => {
      ipcRenderer.removeListener("ai-chat:hostCommandWorkspaceSynced", listener);
    };
  },
  onAiChatStreamEvent: (handler) => {
    const listener = (_event: IpcRendererEvent, event: Parameters<typeof handler>[0]) => {
      handler(event);
    };

    ipcRenderer.on("ai-chat:streamEvent", listener);
    return () => {
      ipcRenderer.removeListener("ai-chat:streamEvent", listener);
    };
  }
};

contextBridge.exposeInMainWorld("integralNotes", api);


