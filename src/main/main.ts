import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";

import type {
  CreateEntryRequest,
  DeleteEntryRequest,
  ExecuteIntegralActionRequest,
  ExecuteIntegralActionResult,
  RenameEntryRequest
} from "../shared/workspace";
import { WorkspaceService } from "./workspaceService";

function resolveInitialWorkspacePath(): string {
  const configuredRootPath = process.env.INTEGRALNOTES_DEFAULT_WORKSPACE?.trim();

  if (configuredRootPath) {
    return path.resolve(configuredRootPath);
  }

  return path.join(app.getPath("documents"), "IntegralNotes");
}

const workspaceService = new WorkspaceService({
  initialRootPath: resolveInitialWorkspacePath(),
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
  ipcMain.handle("integral:executeAction", async (_event, request: ExecuteIntegralActionRequest) =>
    executeIntegralAction(request)
  );
}

async function executeIntegralAction(
  request: ExecuteIntegralActionRequest
): Promise<ExecuteIntegralActionResult> {
  const startedAt = new Date().toISOString();
  const block = parseIntegralPayload(request.payload);

  await wait(220);

  switch (`${request.blockType}:${request.actionId}`) {
    case "LC.Method.Gradient:execute": {
      const params = block?.params;
      const timeProgram = Array.isArray(params?.["time-prog"]) ? params["time-prog"] : [];
      const analysisTime = typeof params?.["analysis-time"] === "number" ? params["analysis-time"] : null;

      return {
        actionId: request.actionId,
        blockType: request.blockType,
        finishedAt: new Date().toISOString(),
        logLines: [
          "Mock runner selected",
          `Gradient points: ${timeProgram.length}`,
          analysisTime === null ? "Analysis time: unset" : `Analysis time: ${analysisTime} min`,
          "Future hook: spawn external instrument-control executable here"
        ],
        startedAt,
        status: "success",
        summary: "LC グラジエント操作の実行要求を main process が受理しました。"
      };
    }

    case "StandardGraphs.Chromatogram:analyze": {
      const params = block?.params;
      const datasets = Array.isArray(params?.data) ? params.data.filter((item) => typeof item === "string") : [];

      return {
        actionId: request.actionId,
        blockType: request.blockType,
        finishedAt: new Date().toISOString(),
        logLines: [
          "Mock runner selected",
          `Datasets: ${datasets.length}`,
          datasets.length > 0 ? `Input: ${datasets.join(", ")}` : "Input: not set",
          "Future hook: spawn analysis executable or submit batch job here"
        ],
        startedAt,
        status: "success",
        summary: "クロマトグラム解析要求を main process が受理しました。"
      };
    }

    default:
      throw new Error(`未対応の Integral action です: ${request.blockType} / ${request.actionId}`);
  }
}

function parseIntegralPayload(payload: string): { params?: Record<string, unknown>; type: string } | null {
  try {
    const parsed = JSON.parse(payload);

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    if (typeof parsed.type !== "string") {
      return null;
    }

    return {
      params:
        typeof parsed.params === "object" && parsed.params !== null && !Array.isArray(parsed.params)
          ? (parsed.params as Record<string, unknown>)
          : undefined,
      type: parsed.type
    };
  } catch {
    return null;
  }
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
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
