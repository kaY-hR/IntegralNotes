import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";

import type {
  CreateEntryRequest,
  DeleteEntryRequest,
  RenameEntryRequest
} from "../shared/workspace";
import { WorkspaceService } from "./workspaceService";

const workspaceService = new WorkspaceService({
  initialRootPath: path.resolve(process.cwd(), "Notes"),
  stateFilePath: path.join(app.getPath("userData"), "workspace-state.json")
});
const hasSingleInstanceLock = app.requestSingleInstanceLock();

let mainWindow: BrowserWindow | null = null;
let ipcRegistered = false;

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

  const snapshot = await workspaceService.getSnapshot();
  mainWindow.setTitle(`${snapshot.rootName} - IntegralNotes`);

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
    mainWindow?.setTitle(`${snapshot.rootName} - IntegralNotes`);
    return snapshot;
  });
  ipcMain.handle("workspace:openFolder", async () => {
    if (!mainWindow) {
      return null;
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: "ワークスペースフォルダを開く",
      defaultPath: workspaceService.currentRootPath,
      properties: ["openDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const snapshot = await workspaceService.setRootPath(result.filePaths[0]);
    mainWindow.setTitle(`${snapshot.rootName} - IntegralNotes`);

    return snapshot;
  });
  ipcMain.handle("workspace:readNote", async (_event, relativePath: string) =>
    workspaceService.readNote(relativePath)
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
