import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";

import type {
  CreateSourceDatasetRequest,
  ExecuteIntegralBlockRequest,
  RegisterPythonScriptRequest
} from "../shared/integral";
import type {
  CreateEntryRequest,
  DeleteEntryRequest,
  ExecuteIntegralActionRequest,
  RenameEntryRequest,
  WorkspaceSnapshot
} from "../shared/workspace";
import {
  PluginRegistry,
  resolveInstalledPluginRootPath
} from "./pluginRegistry";
import { IntegralWorkspaceService } from "./integralWorkspaceService";
import { WorkspaceService } from "./workspaceService";

function resolveInitialWorkspacePath(): string | undefined {
  const configuredRootPath = process.env.INTEGRALNOTES_DEFAULT_WORKSPACE?.trim();

  if (configuredRootPath) {
    return path.resolve(configuredRootPath);
  }

  return undefined;
}

function formatWindowTitle(snapshot: WorkspaceSnapshot | null): string {
  return snapshot ? `${snapshot.rootName} - IntegralNotes` : "IntegralNotes";
}

const workspaceService = new WorkspaceService({
  initialRootPath: resolveInitialWorkspacePath(),
  stateFilePath: path.join(app.getPath("userData"), "workspace-state.json")
});
const hasSingleInstanceLock = app.requestSingleInstanceLock();

let mainWindow: BrowserWindow | null = null;
let ipcRegistered = false;
let pluginRegistry: PluginRegistry | null = null;
let integralWorkspaceService: IntegralWorkspaceService | null = null;
const MIN_ZOOM_LEVEL = -3;
const MAX_ZOOM_LEVEL = 3;
const ZOOM_LEVEL_STEP = 0.5;

function clampZoomLevel(zoomLevel: number): number {
  return Math.max(MIN_ZOOM_LEVEL, Math.min(zoomLevel, MAX_ZOOM_LEVEL));
}

function adjustWindowZoom(window: BrowserWindow, direction: "in" | "out" | "reset"): void {
  if (direction === "reset") {
    window.webContents.setZoomLevel(0);
    return;
  }

  const currentZoomLevel = window.webContents.getZoomLevel();
  const delta = direction === "in" ? ZOOM_LEVEL_STEP : -ZOOM_LEVEL_STEP;
  window.webContents.setZoomLevel(clampZoomLevel(currentZoomLevel + delta));
}

function registerWindowZoomHandlers(window: BrowserWindow): void {
  window.webContents.on("zoom-changed", (event, zoomDirection) => {
    event.preventDefault();
    adjustWindowZoom(window, zoomDirection);
  });
}

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: "#edf0f3",
    title: "IntegralNotes Prototype",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  registerWindowZoomHandlers(mainWindow);

  if (!process.env.VITE_DEV_SERVER_URL) {
    mainWindow.removeMenu();
  }

  const snapshot = await workspaceService.getSnapshot();
  mainWindow.setTitle(formatWindowTitle(snapshot));

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpcHandlers(): void {
  if (ipcRegistered) {
    return;
  }

  ipcRegistered = true;

  ipcMain.handle("workspace:getSnapshot", async () => {
    const snapshot = await workspaceService.getSnapshot();
    mainWindow?.setTitle(formatWindowTitle(snapshot));
    return snapshot;
  });
  ipcMain.handle("workspace:openFolder", async () => {
    if (!mainWindow) {
      return null;
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: "ワークスペースフォルダを開く",
      defaultPath: workspaceService.currentRootPath ?? app.getPath("documents"),
      properties: ["openDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const snapshot = await workspaceService.setRootPath(result.filePaths[0]);
    mainWindow.setTitle(formatWindowTitle(snapshot));

    return snapshot;
  });
  ipcMain.handle("integral:getAssetCatalog", async () => getIntegralWorkspaceService().listAssetCatalog());
  ipcMain.handle("integral:importOriginalDataFiles", async () => {
    if (!mainWindow) {
      throw new Error("main window is not available.");
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      defaultPath: workspaceService.currentRootPath ?? app.getPath("documents"),
      properties: ["openFile", "multiSelections"],
      title: "Import Files as Original Data"
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return getIntegralWorkspaceService().importOriginalDataPaths(result.filePaths);
  });
  ipcMain.handle("integral:importOriginalDataDirectories", async () => {
    if (!mainWindow) {
      throw new Error("main window is not available.");
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      defaultPath: workspaceService.currentRootPath ?? app.getPath("documents"),
      properties: ["openDirectory", "multiSelections"],
      title: "Import Folders as Original Data"
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return getIntegralWorkspaceService().importOriginalDataPaths(result.filePaths);
  });
  ipcMain.handle("integral:createSourceDataset", async (_event, request: CreateSourceDatasetRequest) =>
    getIntegralWorkspaceService().createSourceDataset(request)
  );
  ipcMain.handle("integral:inspectDataset", async (_event, datasetId: string) =>
    getIntegralWorkspaceService().inspectDataset(datasetId)
  );
  ipcMain.handle("integral:browsePythonEntryFile", async () => {
    if (!mainWindow) {
      throw new Error("main window is not available.");
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      defaultPath: workspaceService.currentRootPath ?? app.getPath("documents"),
      filters: [
        {
          extensions: ["py"],
          name: "Python"
        }
      ],
      properties: ["openFile"],
      title: "Select Python Entry"
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return getIntegralWorkspaceService().describePythonEntryFile(result.filePaths[0]);
  });
  ipcMain.handle("integral:browsePythonSupportFiles", async (_event, entryAbsolutePath: string | null) => {
    if (!mainWindow) {
      throw new Error("main window is not available.");
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      defaultPath:
        entryAbsolutePath && entryAbsolutePath.trim().length > 0
          ? path.dirname(entryAbsolutePath)
          : workspaceService.currentRootPath ?? app.getPath("documents"),
      properties: ["openFile", "multiSelections"],
      title: "Select Additional Bundled Files"
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths;
  });
  ipcMain.handle(
    "integral:registerPythonScript",
    async (_event, request: RegisterPythonScriptRequest) =>
      getIntegralWorkspaceService().registerPythonScript(request)
  );
  ipcMain.handle("integral:executeBlock", async (_event, request: ExecuteIntegralBlockRequest) =>
    getIntegralWorkspaceService().executeBlock(request)
  );
  ipcMain.handle("plugins:getInstallRootPath", async () => getPluginRegistry().getInstallRootPath());
  ipcMain.handle("plugins:listInstalled", async () => getPluginRegistry().listInstalledPlugins());
  ipcMain.handle("plugins:installFromZip", async () => {
    if (!mainWindow) {
      throw new Error("main window is not available.");
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Install Plugin from ZIP",
      filters: [
        {
          name: "Plugin ZIP",
          extensions: ["zip"]
        }
      ],
      properties: ["openFile"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return getPluginRegistry().installPluginFromArchive(result.filePaths[0]);
  });
  ipcMain.handle("plugins:loadRendererDocument", async (_event, pluginId: string) =>
    getPluginRegistry().loadRendererDocument(pluginId)
  );
  ipcMain.handle("plugins:uninstall", async (_event, pluginId: string) =>
    getPluginRegistry().uninstallPlugin(pluginId)
  );
  ipcMain.handle("workspace:readNote", async (_event, relativePath: string) =>
    workspaceService.readNote(relativePath)
  );
  ipcMain.handle("workspace:readFile", async (_event, relativePath: string) =>
    workspaceService.readWorkspaceFile(relativePath)
  );
  ipcMain.handle(
    "workspace:saveNote",
    async (_event, relativePath: string, content: string) =>
      workspaceService.saveNote(relativePath, content)
  );
  ipcMain.handle("workspace:createEntry", async (_event, request: CreateEntryRequest) =>
    workspaceService.createEntry(request)
  );
  ipcMain.handle("workspace:renameEntry", async (_event, request: RenameEntryRequest) =>
    workspaceService.renameEntry(request)
  );
  ipcMain.handle("workspace:deleteEntry", async (_event, request: DeleteEntryRequest) =>
    workspaceService.deleteEntry(request)
  );
  ipcMain.handle("integral:executeAction", async (_event, request: ExecuteIntegralActionRequest) =>
    getPluginRegistry().executeAction(request)
  );
}

function getPluginRegistry(): PluginRegistry {
  if (pluginRegistry === null) {
    throw new Error("plugin registry is not ready.");
  }

  return pluginRegistry;
}

function getIntegralWorkspaceService(): IntegralWorkspaceService {
  if (integralWorkspaceService === null) {
    throw new Error("integral workspace service is not ready.");
  }

  return integralWorkspaceService;
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    await workspaceService.initialize();
    pluginRegistry = new PluginRegistry({
      installRootPath: resolveInstalledPluginRootPath(app.getPath("userData"))
    });
    integralWorkspaceService = new IntegralWorkspaceService(workspaceService, pluginRegistry);
    registerIpcHandlers();
    await createMainWindow();

    app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createMainWindow();
      }
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});


