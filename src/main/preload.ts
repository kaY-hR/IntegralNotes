import { contextBridge, ipcRenderer, webFrame } from "electron";

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
  browsePythonEntryFile: () => ipcRenderer.invoke("integral:browsePythonEntryFile"),
  browsePythonSupportFiles: (entryAbsolutePath) =>
    ipcRenderer.invoke("integral:browsePythonSupportFiles", entryAbsolutePath),
  createSourceChunk: (request) => ipcRenderer.invoke("integral:createSourceChunk", request),
  getWorkspaceSnapshot: () => ipcRenderer.invoke("workspace:getSnapshot"),
  openWorkspaceFolder: () => ipcRenderer.invoke("workspace:openFolder"),
  zoomIn: () => adjustZoomLevel("in"),
  zoomOut: () => adjustZoomLevel("out"),
  resetZoom: () => adjustZoomLevel("reset"),
  getIntegralAssetCatalog: () => ipcRenderer.invoke("integral:getAssetCatalog"),
  importBlobDirectories: () => ipcRenderer.invoke("integral:importBlobDirectories"),
  importBlobFiles: () => ipcRenderer.invoke("integral:importBlobFiles"),
  inspectChunk: (chunkId) => ipcRenderer.invoke("integral:inspectChunk", chunkId),
  getPluginInstallRootPath: () => ipcRenderer.invoke("plugins:getInstallRootPath"),
  listInstalledPlugins: () => ipcRenderer.invoke("plugins:listInstalled"),
  installPluginFromZip: () => ipcRenderer.invoke("plugins:installFromZip"),
  loadPluginRendererDocument: (pluginId) => ipcRenderer.invoke("plugins:loadRendererDocument", pluginId),
  registerPythonScript: (request) => ipcRenderer.invoke("integral:registerPythonScript", request),
  readNote: (relativePath) => ipcRenderer.invoke("workspace:readNote", relativePath),
  saveNote: (relativePath, content) =>
    ipcRenderer.invoke("workspace:saveNote", relativePath, content),
  createEntry: (request) => ipcRenderer.invoke("workspace:createEntry", request),
  renameEntry: (request) => ipcRenderer.invoke("workspace:renameEntry", request),
  deleteEntry: (request) => ipcRenderer.invoke("workspace:deleteEntry", request),
  uninstallPlugin: (pluginId) => ipcRenderer.invoke("plugins:uninstall", pluginId),
  executeIntegralBlock: (request) => ipcRenderer.invoke("integral:executeBlock", request),
  executeIntegralAction: (request) => ipcRenderer.invoke("integral:executeAction", request)
};

contextBridge.exposeInMainWorld("integralNotes", api);
