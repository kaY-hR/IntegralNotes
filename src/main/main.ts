import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  shell,
  type IpcMainEvent,
  type MessageBoxOptions
} from "electron";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  toDataRegistrationDirectoryRelativePath,
  type SaveAppSettingsRequest
} from "../shared/appSettings";
import type {
  CreateDatasetRequest,
  CreateDatasetFromFileDialogRequest,
  CreateDatasetFromWorkspaceEntriesRequest,
  ExecuteIntegralBlockRequest,
  ResolveIntegralManagedDataTrackingIssueRequest,
  UndoIntegralBlockRequest
} from "../shared/integral";
import { normalizeIntegralSlotExtensions } from "../shared/integral";
import type {
  CopyEntriesRequest,
  CopyExternalEntriesRequest,
  CreateEntryRequest,
  DeleteEntriesRequest,
  DeleteEntryRequest,
  ExecuteIntegralActionRequest,
  MoveEntriesRequest,
  RenameEntryRequest,
  SaveClipboardImageRequest,
  SaveNoteImageRequest,
  SelectWorkspaceFileRequest,
  BeforeCloseResponse,
  ConfirmDiscardUnsavedChangesRequest,
  WorkspaceReplaceRequest,
  WorkspaceSearchRequest,
  WorkspaceSnapshot
} from "../shared/workspace";
import {
  PluginRegistry,
  resolveInstalledPluginRootPath
} from "./pluginRegistry";
import { AppSettingsService } from "./appSettingsService";
import { AiAgentService } from "./aiAgentService";
import { AiChatService } from "./aiChatService";
import { AiHostCommandService } from "./aiHostCommandService";
import { IntegralWorkspaceService } from "./integralWorkspaceService";
import { initializeNetworkProxyFromEnvironment } from "./networkProxy";
import { WorkspaceVisualRenderService } from "./workspaceVisualRenderService";
import { WorkspaceService } from "./workspaceService";

const execFileAsync = promisify(execFile);
const WORKSPACE_SELECTION_CLIPBOARD_FORMAT = "application/x-integralnotes-workspace-selection";

initializeNetworkProxyFromEnvironment();

function configureAutomationUserDataPath(): void {
  const configuredUserDataPath = process.env.INTEGRALNOTES_USER_DATA_DIR?.trim();

  if (!configuredUserDataPath) {
    return;
  }

  app.setPath("userData", path.resolve(configuredUserDataPath));
}

configureAutomationUserDataPath();

function resolveInitialWorkspacePath(): string | undefined {
  const configuredRootPath = process.env.INTEGRALNOTES_DEFAULT_WORKSPACE?.trim();

  if (configuredRootPath) {
    return path.resolve(configuredRootPath);
  }

  return undefined;
}

function toVSCodeFileUri(absolutePath: string): string {
  return `vscode://file${pathToFileURL(absolutePath).pathname}`;
}

async function readClipboardExternalPaths(): Promise<string[]> {
  if (process.platform !== "win32") {
    return [];
  }

  try {
    const command = [
      "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
      "$items = @(Get-Clipboard -Format FileDropList -ErrorAction SilentlyContinue | ForEach-Object { [string]$_ })",
      "if ($items.Count -eq 0) { '[]' } else { ConvertTo-Json -Compress -InputObject $items }"
    ].join("; ");
    const execution = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        command
      ],
      {
        windowsHide: true
      }
    );
    const stdout = (execution.stdout ?? "").trim();

    if (stdout.length === 0) {
      console.info("[Explorer/Main] FileDropList clipboard probe returned empty stdout");
      return [];
    }

    const parsed = JSON.parse(stdout);
    const normalizedPayload = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "string"
        ? [parsed]
        : [];

    if (normalizedPayload.length === 0) {
      console.info("[Explorer/Main] FileDropList clipboard probe returned unsupported payload", {
        stdout
      });
      return [];
    }

    const paths = normalizedPayload
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    console.info("[Explorer/Main] FileDropList clipboard probe", {
      pathCount: paths.length,
      paths
    });

    return paths;
  } catch (error) {
    console.error("[Explorer/Main] failed to read FileDropList clipboard payload", error);
    return [];
  }
}

function writeWorkspaceSelectionToClipboard(relativePaths: string[]): void {
  const normalizedPaths = Array.from(
    new Set(relativePaths.map((value) => value.trim()).filter((value) => value.length > 0))
  );

  clipboard.writeBuffer(
    WORKSPACE_SELECTION_CLIPBOARD_FORMAT,
    Buffer.from(JSON.stringify(normalizedPaths), "utf8")
  );
}

function formatDirtyPathList(dirtyPaths: string[]): string {
  const visiblePaths = dirtyPaths.slice(0, 12);
  const hiddenCount = dirtyPaths.length - visiblePaths.length;
  const visibleList = visiblePaths.map((relativePath) => `- ${relativePath}`).join("\n");

  return hiddenCount > 0 ? `${visibleList}\n- 他 ${hiddenCount} 件` : visibleList;
}

async function confirmDiscardUnsavedChanges(
  request: ConfirmDiscardUnsavedChangesRequest
): Promise<boolean> {
  const dirtyPaths = Array.from(
    new Set(request.dirtyPaths.map((value) => value.trim()).filter((value) => value.length > 0))
  );

  if (dirtyPaths.length === 0) {
    return true;
  }

  const isAppClose = request.scope === "app";
  const actionLabel = isAppClose ? "保存せず終了" : "保存せず閉じる";
  const message =
    dirtyPaths.length === 1
      ? `${dirtyPaths[0]} に未保存の変更があります。`
      : `${dirtyPaths.length} 件のファイルに未保存の変更があります。`;
  const options: MessageBoxOptions = {
    buttons: ["キャンセル", actionLabel],
    cancelId: 0,
    defaultId: 0,
    detail: `${formatDirtyPathList(dirtyPaths)}\n\n保存していない変更は失われます。`,
    message: `${message}${isAppClose ? "IntegralNotes を終了しますか？" : "このタブを閉じますか？"}`,
    noLink: true,
    title: "未保存の変更",
    type: "warning"
  };
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);

  return result.response === 1;
}

function requestBeforeCloseFromRenderer(window: BrowserWindow): Promise<boolean> {
  if (window.webContents.isDestroyed()) {
    return Promise.resolve(true);
  }

  const requestId = `before-close-${Date.now()}-${++closeConfirmationRequestSequence}`;

  return new Promise((resolve) => {
    let settled = false;
    const settle = (allowClose: boolean): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      ipcMain.removeListener("app:beforeCloseResponse", listener);
      resolve(allowClose);
    };
    const listener = (event: IpcMainEvent, response: BeforeCloseResponse): void => {
      if (event.sender !== window.webContents || response.requestId !== requestId) {
        return;
      }

      settle(response.allowClose);
    };
    const timeout = setTimeout(() => {
      settle(true);
    }, 5000);

    ipcMain.on("app:beforeCloseResponse", listener);
    window.webContents.send("app:beforeCloseRequest", { requestId });
  });
}

function registerUnsavedChangesCloseHandler(window: BrowserWindow): void {
  window.on("close", (event) => {
    if (closingAfterUnsavedConfirmation) {
      return;
    }

    event.preventDefault();

    if (closeConfirmationPending) {
      return;
    }

    closeConfirmationPending = true;
    void (async () => {
      try {
        const allowClose = await requestBeforeCloseFromRenderer(window);

        if (!allowClose || window.isDestroyed()) {
          return;
        }

        closingAfterUnsavedConfirmation = true;
        window.close();
      } finally {
        closeConfirmationPending = false;
      }
    })();
  });
}

function readWorkspaceSelectionFromClipboard(): string[] {
  try {
    if (!clipboard.has(WORKSPACE_SELECTION_CLIPBOARD_FORMAT)) {
      return [];
    }

    const parsed = JSON.parse(
      clipboard.readBuffer(WORKSPACE_SELECTION_CLIPBOARD_FORMAT).toString("utf8")
    );

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  } catch {
    return [];
  }
}

function formatWindowTitle(snapshot: WorkspaceSnapshot | null): string {
  return snapshot ? `${snapshot.rootName} - IntegralNotes` : "IntegralNotes";
}

function toWorkspaceRelativePathOrThrow(
  rootPath: string,
  absolutePath: string,
  label: string
): string {
  const selectedPath = path.resolve(absolutePath);
  const relativePath = path.relative(rootPath, selectedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath) || relativePath.length === 0) {
    throw new Error(`${label}は workspace 内を指定してください。`);
  }

  return relativePath.split(path.sep).join("/");
}

function appendIdtsExtensionIfMissing(absolutePath: string): string {
  return path.extname(absolutePath).toLowerCase() === ".idts"
    ? absolutePath
    : `${absolutePath}.idts`;
}

function sanitizeDatasetDialogDefaultName(value: string | undefined): string {
  const normalized = `${value ?? ""}`
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, "_")
    .replace(/[. ]+$/gu, "");

  return normalized.length > 0 ? normalized : "dataset";
}

const workspaceService = new WorkspaceService({
  initialRootPath: resolveInitialWorkspacePath(),
  stateFilePath: path.join(app.getPath("userData"), "workspace-state.json")
});
const appSettingsService = new AppSettingsService(
  path.join(app.getPath("userData"), "app-settings.json")
);
const workspaceVisualRenderService = new WorkspaceVisualRenderService(workspaceService);
const aiHostCommandService = new AiHostCommandService(workspaceService, () => mainWindow);
const aiAgentService = new AiAgentService(
  workspaceService,
  workspaceVisualRenderService,
  () => integralWorkspaceService,
  aiHostCommandService
);
const aiChatService = new AiChatService(
  aiAgentService,
  workspaceService,
  appSettingsService,
  path.join(app.getPath("userData"), "ai-chat-settings.json"),
  path.join(app.getPath("userData"), "ai-chat-history.json"),
  () => integralWorkspaceService
);
const hasSingleInstanceLock = app.requestSingleInstanceLock();

let mainWindow: BrowserWindow | null = null;
let ipcRegistered = false;
let pluginRegistry: PluginRegistry | null = null;
let integralWorkspaceService: IntegralWorkspaceService | null = null;
let closingAfterUnsavedConfirmation = false;
let closeConfirmationPending = false;
let closeConfirmationRequestSequence = 0;
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

function registerDevelopmentShortcuts(window: BrowserWindow): void {
  if (!process.env.VITE_DEV_SERVER_URL) {
    return;
  }

  window.webContents.on("before-input-event", (event, input) => {
    const key = input.key.toLowerCase();

    if (key === "f12" || ((input.control || input.meta) && input.shift && key === "i")) {
      event.preventDefault();

      if (window.webContents.isDevToolsOpened()) {
        window.webContents.closeDevTools();
      } else {
        window.webContents.openDevTools({ mode: "detach" });
      }
    }
  });
}

async function createMainWindow(): Promise<void> {
  closingAfterUnsavedConfirmation = false;
  closeConfirmationPending = false;
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
  registerDevelopmentShortcuts(mainWindow);
  registerUnsavedChangesCloseHandler(mainWindow);
  mainWindow.removeMenu();

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

  ipcMain.handle(
    "app:confirmDiscardUnsavedChanges",
    async (_event, request: ConfirmDiscardUnsavedChangesRequest) =>
      confirmDiscardUnsavedChanges(request)
  );
  ipcMain.handle("app-settings:get", async () => appSettingsService.getSettings());
  ipcMain.handle("app-settings:save", async (_event, request: SaveAppSettingsRequest) =>
    appSettingsService.saveSettings(request)
  );
  ipcMain.handle("workspace:getSnapshot", async () => {
    const snapshot = await workspaceService.getSnapshot();
    mainWindow?.setTitle(formatWindowTitle(snapshot));
    return snapshot;
  });
  ipcMain.handle("workspace:sync", async () => {
    const snapshot = await workspaceService.syncWorkspace();
    mainWindow?.setTitle(formatWindowTitle(snapshot));
    return snapshot;
  });
  ipcMain.handle("workspace:applyTemplate", async () => {
    if (!mainWindow) {
      throw new Error("main window is not available.");
    }

    const rootPath = workspaceService.currentRootPath;

    if (!rootPath) {
      throw new Error("workspace folder is not open.");
    }

    const result = await dialog.showMessageBox(mainWindow, {
      buttons: ["キャンセル", "初期化/更新"],
      cancelId: 0,
      defaultId: 0,
      detail:
        `${rootPath}\n\n` +
        "workspace template の同じ相対パスにあるファイルで上書きします。template から削除されたファイルは削除しません。",
      message: "現在の workspace を template で初期化/更新しますか？",
      noLink: true,
      title: "Workspace の初期化/更新",
      type: "warning"
    });

    if (result.response !== 1) {
      return null;
    }

    const applyResult = await workspaceService.applyWorkspaceTemplate();
    mainWindow.setTitle(formatWindowTitle(applyResult.snapshot));

    return applyResult;
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
    ipcMain.handle("workspace:selectDirectory", async (_event, initialRelativePath?: string | null) => {
      if (!mainWindow) {
        throw new Error("main window is not available.");
      }

    const rootPath = workspaceService.currentRootPath;

    if (!rootPath) {
      throw new Error("workspace folder is not open.");
    }

    const normalizedInitialRelativePath =
      typeof initialRelativePath === "string"
        ? initialRelativePath
            .trim()
            .split(/[\\/]+/u)
            .filter(Boolean)
        : [];
    const defaultPath =
      normalizedInitialRelativePath.length > 0
        ? path.resolve(rootPath, ...normalizedInitialRelativePath)
        : rootPath;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "保存先フォルダを選択",
      defaultPath,
      properties: ["openDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const selectedPath = path.resolve(result.filePaths[0]);
    const relativePath = path.relative(rootPath, selectedPath);

    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new Error("workspace 内のフォルダを選択してください。");
    }

      return relativePath.split(path.sep).join("/");
    });
    ipcMain.handle("workspace:selectFile", async (_event, request?: SelectWorkspaceFileRequest | null) => {
      if (!mainWindow) {
        throw new Error("main window is not available.");
      }

      const rootPath = workspaceService.currentRootPath;

      if (!rootPath) {
        throw new Error("workspace folder is not open.");
      }

      const normalizedExtensions = normalizeIntegralSlotExtensions(request?.extensions) ?? [];
      const normalizedInitialRelativePath =
        typeof request?.initialRelativePath === "string"
          ? request.initialRelativePath
              .trim()
              .split(/[\\/]+/u)
              .filter(Boolean)
          : [];
      const defaultPath =
        normalizedInitialRelativePath.length > 0
          ? path.resolve(rootPath, ...normalizedInitialRelativePath)
          : rootPath;
      const result = await dialog.showOpenDialog(mainWindow, {
        title: "入力ファイルを選択",
        defaultPath,
        filters:
          normalizedExtensions.length > 0
            ? [
                {
                  name: "Allowed Files",
                  extensions: normalizedExtensions.map((extension) => extension.slice(1))
                }
              ]
            : undefined,
        properties: ["openFile"]
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      const selectedPath = path.resolve(result.filePaths[0]);
      const relativePath = path.relative(rootPath, selectedPath);

      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw new Error("workspace 内のファイルを選択してください。");
      }

      const normalizedRelativePath = relativePath.split(path.sep).join("/");

      if (normalizedExtensions.length > 0) {
        const selectedExtension = path.extname(selectedPath).toLowerCase();

        if (!normalizedExtensions.includes(selectedExtension)) {
          throw new Error(`許可されていない拡張子です: ${normalizedRelativePath}`);
        }
      }

      return normalizedRelativePath;
    });
    ipcMain.handle("integral:getAssetCatalog", async () => getIntegralWorkspaceService().listAssetCatalog());
  ipcMain.handle("integral:listManagedDataTrackingIssues", async () =>
    getIntegralWorkspaceService().listManagedDataTrackingIssues()
  );
  ipcMain.handle("integral:importManagedFileFiles", async () => {
    if (!mainWindow) {
      throw new Error("main window is not available.");
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      defaultPath: workspaceService.currentRootPath ?? app.getPath("documents"),
      properties: ["openFile", "multiSelections"],
      title: "Import Files as Managed Files"
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return getIntegralWorkspaceService().importManagedFilePaths(result.filePaths);
  });
  ipcMain.handle("integral:importManagedFileDirectories", async () => {
    if (!mainWindow) {
      throw new Error("main window is not available.");
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      defaultPath: workspaceService.currentRootPath ?? app.getPath("documents"),
      properties: ["openDirectory", "multiSelections"],
      title: "Import Folders as Managed Files"
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return getIntegralWorkspaceService().importManagedFilePaths(result.filePaths);
  });
  ipcMain.handle("integral:createDataset", async (_event, request: CreateDatasetRequest) =>
    getIntegralWorkspaceService().createDataset(request)
  );
  ipcMain.handle(
    "integral:createDatasetFromFileDialog",
    async (_event, request?: CreateDatasetFromFileDialogRequest | null) => {
      if (!mainWindow) {
        throw new Error("main window is not available.");
      }

      const rootPath = workspaceService.currentRootPath;

      if (!rootPath) {
        throw new Error("workspace folder is not open.");
      }

      const fileResult = await dialog.showOpenDialog(mainWindow, {
        defaultPath: rootPath,
        properties: ["openFile", "multiSelections"],
        title: "Dataset に含めるファイルを選択"
      });

      if (fileResult.canceled || fileResult.filePaths.length === 0) {
        return null;
      }

      const settings = await appSettingsService.getSettings();
      const dataRegistrationDirectory = toDataRegistrationDirectoryRelativePath(
        settings.dataRegistrationDirectory
      );
      const defaultName = sanitizeDatasetDialogDefaultName(request?.defaultName);
      const defaultPath = path.join(rootPath, dataRegistrationDirectory, `${defaultName}.idts`);
      const saveResult = await dialog.showSaveDialog(mainWindow, {
        defaultPath,
        filters: [
          {
            extensions: ["idts"],
            name: "IntegralNotes Dataset"
          }
        ],
        title: "Dataset manifest の保存先を選択"
      });

      if (saveResult.canceled || !saveResult.filePath) {
        return null;
      }

      const manifestAbsolutePath = appendIdtsExtensionIfMissing(saveResult.filePath);
      const manifestPath = toWorkspaceRelativePathOrThrow(
        rootPath,
        manifestAbsolutePath,
        "dataset manifest 保存先"
      );
      const imported = await getIntegralWorkspaceService().importManagedFilePaths(
        fileResult.filePaths
      );

      return getIntegralWorkspaceService().createDataset({
        datatype: request?.datatype ?? null,
        managedFileIds: imported.managedFiles.map((file) => file.id),
        manifestPath,
        name: path.basename(manifestPath, ".idts")
      });
    }
  );
  ipcMain.handle(
    "integral:createDatasetFromWorkspaceEntries",
    async (_event, request: CreateDatasetFromWorkspaceEntriesRequest) =>
      getIntegralWorkspaceService().createDatasetFromWorkspaceEntries(request)
  );
  ipcMain.handle("integral:inspectDataset", async (_event, datasetId: string) =>
    getIntegralWorkspaceService().inspectDataset(datasetId)
  );
  ipcMain.handle(
    "integral:resolveManagedDataTrackingIssue",
    async (_event, request: ResolveIntegralManagedDataTrackingIssueRequest) =>
      getIntegralWorkspaceService().resolveManagedDataTrackingIssue(request)
  );
  ipcMain.handle("integral:executeBlock", async (_event, request: ExecuteIntegralBlockRequest) =>
    getIntegralWorkspaceService().executeBlock(request)
  );
  ipcMain.handle("integral:undoBlock", async (_event, request: UndoIntegralBlockRequest) =>
    getIntegralWorkspaceService().undoBlock(request)
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
  ipcMain.handle(
    "plugins:loadSidebarViewDocument",
    async (_event, pluginId: string, sidebarViewId: string) =>
      getPluginRegistry().loadSidebarViewDocument(pluginId, sidebarViewId)
  );
  ipcMain.handle(
    "plugins:loadViewerDocument",
    async (_event, pluginId: string, viewerId: string) =>
      getPluginRegistry().loadViewerDocument(pluginId, viewerId)
  );
  ipcMain.handle("plugins:uninstall", async (_event, pluginId: string) =>
    getPluginRegistry().uninstallPlugin(pluginId)
  );
  ipcMain.handle("workspace:readNote", async (_event, relativePath: string) =>
    workspaceService.readNote(relativePath)
  );
  ipcMain.handle("workspace:searchText", async (_event, request: WorkspaceSearchRequest) =>
    workspaceService.searchWorkspaceText(request)
  );
  ipcMain.handle("workspace:replaceText", async (_event, request: WorkspaceReplaceRequest) =>
    workspaceService.replaceWorkspaceText(request)
  );
  ipcMain.handle("workspace:readFile", async (_event, relativePath: string) => {
    const specialDocument =
      path.extname(relativePath).toLowerCase() === ".idts"
        ? await getIntegralWorkspaceService().readSpecialWorkspaceFileDocument(relativePath)
        : null;

    if (specialDocument) {
      return specialDocument;
    }

    return workspaceService.readWorkspaceFile(relativePath);
  });
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
  ipcMain.handle("workspace:deleteEntries", async (_event, request: DeleteEntriesRequest) =>
    workspaceService.deleteEntries(request)
  );
  ipcMain.handle("workspace:copyEntries", async (_event, request: CopyEntriesRequest) =>
    workspaceService.copyEntries(request)
  );
  ipcMain.handle("workspace:moveEntries", async (_event, request: MoveEntriesRequest) =>
    workspaceService.moveEntries(request)
  );
  ipcMain.handle("workspace:copyExternalEntries", async (_event, request: CopyExternalEntriesRequest) =>
    workspaceService.copyExternalEntries(request)
  );
  ipcMain.on("workspace:writeWorkspaceSelectionToClipboard", (_event, relativePaths: string[]) => {
    writeWorkspaceSelectionToClipboard(relativePaths);
  });
  ipcMain.handle("workspace:readWorkspaceSelectionFromClipboard", async () =>
    readWorkspaceSelectionFromClipboard()
  );
  ipcMain.on("workspace:writeClipboardText", (_event, text: string) => {
    clipboard.writeText(text);
  });
  ipcMain.handle("workspace:clipboardHasImage", async () => !clipboard.readImage().isEmpty());
  ipcMain.handle("workspace:readClipboardExternalPaths", async () => readClipboardExternalPaths());
  ipcMain.handle("workspace:saveClipboardImage", async (_event, request: SaveClipboardImageRequest) => {
    const image = clipboard.readImage();

    if (image.isEmpty()) {
      throw new Error("クリップボードに画像がありません。");
    }

    return workspaceService.savePngImage(request, image.toPNG());
  });
  ipcMain.handle(
    "workspace:saveNoteImage",
    async (_event, request: SaveNoteImageRequest, content: Uint8Array) =>
      workspaceService.saveNoteImage(request, Buffer.from(content))
  );
  ipcMain.handle("workspace:resolveFileUrl", async (_event, relativePath: string) =>
    workspaceService.resolveWorkspaceFileUrl(relativePath)
  );
  ipcMain.handle("workspace:openPathInExternalApp", async (_event, relativePath: string) => {
    const errorMessage = await shell.openPath(workspaceService.getAbsolutePath(relativePath));

    if (errorMessage.trim().length > 0) {
      throw new Error(errorMessage);
    }
  });
  ipcMain.handle("workspace:openPathInFileManager", async (_event, relativePath?: string | null) => {
    const rootPath = workspaceService.currentRootPath;

    if (!rootPath) {
      throw new Error("workspace folder is not open.");
    }

    const targetPath =
      relativePath && relativePath.trim().length > 0
        ? workspaceService.getAbsolutePath(relativePath)
        : rootPath;
    const stats = await fs.stat(targetPath);

    if (stats.isDirectory()) {
      const errorMessage = await shell.openPath(targetPath);

      if (errorMessage.trim().length > 0) {
        throw new Error(errorMessage);
      }

      return;
    }

    shell.showItemInFolder(targetPath);
  });
  ipcMain.handle("workspace:openWorkspaceInVSCode", async () => {
    const rootPath = workspaceService.currentRootPath;

    if (!rootPath) {
      throw new Error("workspace folder is not open.");
    }

    await shell.openExternal(toVSCodeFileUri(rootPath));
  });
  ipcMain.handle("integral:executeAction", async (_event, request: ExecuteIntegralActionRequest) =>
    getPluginRegistry().executeAction(request)
  );
  ipcMain.handle("ai-chat:getStatus", async () => aiChatService.getStatus());
  ipcMain.handle("ai-chat:saveSettings", async (_event, request) => aiChatService.saveSettings(request));
  ipcMain.handle("ai-chat:clearApiKey", async () => aiChatService.clearApiKey());
  ipcMain.handle("ai-chat:refreshModels", async () => aiChatService.refreshModels());
  ipcMain.handle("ai-chat:getHistory", async () => aiChatService.getHistory());
  ipcMain.handle("ai-chat:createSession", async (_event, request) => aiChatService.createSession(request));
  ipcMain.handle("ai-chat:saveSession", async (_event, request) => aiChatService.saveSession(request));
  ipcMain.handle("ai-chat:switchSession", async (_event, sessionId) => aiChatService.switchSession(sessionId));
  ipcMain.handle("ai-chat:deleteSession", async (_event, sessionId) => aiChatService.deleteSession(sessionId));
  ipcMain.handle("ai-chat:listInlineActions", async () => aiChatService.listInlineActions());
  ipcMain.handle("ai-chat:saveInlineAction", async (_event, request) =>
    aiChatService.saveInlineAction(request)
  );
  ipcMain.handle("ai-chat:deleteInlineAction", async (_event, name) =>
    aiChatService.deleteInlineAction(name)
  );
  ipcMain.handle("ai-chat:submit", async (event, request) =>
    aiChatService.submit(request, {
      onStreamEvent: (streamEvent) => {
        event.sender.send("ai-chat:streamEvent", streamEvent);
      }
    })
  );
  ipcMain.handle("ai-chat:submitInlineAction", async (event, request) =>
    aiChatService.submitInlineAction(request, {
      onStreamEvent: (streamEvent) => {
        event.sender.send("ai-chat:streamEvent", streamEvent);
      }
    })
  );
  ipcMain.handle("ai-chat:submitInlineInsertion", async (event, request) =>
    aiChatService.submitInlineInsertion(request, {
      onStreamEvent: (streamEvent) => {
        event.sender.send("ai-chat:streamEvent", streamEvent);
      }
    })
  );
  ipcMain.handle("ai-chat:submitInlinePythonBlock", async (event, request) =>
    aiChatService.submitInlinePythonBlock(request, {
      onStreamEvent: (streamEvent) => {
        event.sender.send("ai-chat:streamEvent", streamEvent);
      }
    })
  );
  ipcMain.handle("ai-chat:submitPromptlessContinuation", async (event, request) =>
    aiChatService.submitPromptlessContinuation(request, {
      onStreamEvent: (streamEvent) => {
        event.sender.send("ai-chat:streamEvent", streamEvent);
      }
    })
  );
  aiHostCommandService.registerIpcHandlers(ipcMain);
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
    workspaceService.setPluginRegistry(pluginRegistry);
    integralWorkspaceService = new IntegralWorkspaceService(
      workspaceService,
      pluginRegistry,
      appSettingsService
    );
    workspaceService.addMutationListener((mutations) =>
      getIntegralWorkspaceService().handleWorkspaceMutations(mutations)
    );
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


