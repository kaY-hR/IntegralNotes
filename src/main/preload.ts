import { contextBridge, ipcRenderer } from "electron";

import type { IntegralNotesApi } from "../shared/workspace";

const api: IntegralNotesApi = {
  getWorkspaceSnapshot: () => ipcRenderer.invoke("workspace:getSnapshot"),
  openWorkspaceFolder: () => ipcRenderer.invoke("workspace:openFolder"),
  listInstalledPlugins: () => ipcRenderer.invoke("plugins:listInstalled"),
  readNote: (relativePath) => ipcRenderer.invoke("workspace:readNote", relativePath),
  saveNote: (relativePath, content) =>
    ipcRenderer.invoke("workspace:saveNote", relativePath, content),
  createEntry: (request) => ipcRenderer.invoke("workspace:createEntry", request),
  renameEntry: (request) => ipcRenderer.invoke("workspace:renameEntry", request),
  deleteEntry: (request) => ipcRenderer.invoke("workspace:deleteEntry", request),
  executeIntegralAction: (request) => ipcRenderer.invoke("integral:executeAction", request)
};

contextBridge.exposeInMainWorld("integralNotes", api);
