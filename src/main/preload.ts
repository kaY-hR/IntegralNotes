import { contextBridge, ipcRenderer, webFrame, webUtils } from "electron";

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
  createDataset: (request) => ipcRenderer.invoke("integral:createDataset", request),
  createDatasetFromWorkspaceEntries: (request) =>
    ipcRenderer.invoke("integral:createDatasetFromWorkspaceEntries", request),
  getWorkspaceSnapshot: () => ipcRenderer.invoke("workspace:getSnapshot"),
  openWorkspaceFolder: () => ipcRenderer.invoke("workspace:openFolder"),
  syncWorkspace: () => ipcRenderer.invoke("workspace:sync"),
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
  uninstallPlugin: (pluginId) => ipcRenderer.invoke("plugins:uninstall", pluginId),
  executeIntegralBlock: (request) => ipcRenderer.invoke("integral:executeBlock", request),
  executeIntegralAction: (request) => ipcRenderer.invoke("integral:executeAction", request),
  getAiChatStatus: () => ipcRenderer.invoke("ai-chat:getStatus"),
  saveAiChatSettings: (request) => ipcRenderer.invoke("ai-chat:saveSettings", request),
  clearAiChatApiKey: () => ipcRenderer.invoke("ai-chat:clearApiKey"),
  refreshAiChatModels: () => ipcRenderer.invoke("ai-chat:refreshModels"),
  submitAiChat: (request) => ipcRenderer.invoke("ai-chat:submit", request)
};

contextBridge.exposeInMainWorld("integralNotes", api);


