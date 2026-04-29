import { BrowserWindow, type IpcMain } from "electron";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { promises as fs } from "node:fs";
import type { Readable } from "node:stream";
import path from "node:path";

import type {
  AiHostCommandApprovalRequest,
  AiHostCommandApprovalResponse,
  AiHostCommandExecutionUpdate,
  AiHostCommandToolRequest,
  AiHostCommandToolResult,
  AiHostCommandWarning
} from "../shared/aiChat";
import { WorkspaceService } from "./workspaceService";

const DEFAULT_TIMEOUT_SECONDS = 60;
const MAX_TIMEOUT_SECONDS = 300;
const MODEL_OUTPUT_LIMIT = 20_000;
const POWERSHELL_ARGS_PREFIX = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"];
const DEFAULT_PWSH_ABSOLUTE_PATH = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";

type ApprovalResolver = (response: AiHostCommandApprovalResponse) => void;

interface RunningCommandState {
  cancelRequested: boolean;
  child: ChildProcessByStdio<null, Readable, Readable>;
  timeoutRequested: boolean;
}

export class AiHostCommandService {
  private readonly pendingApprovals = new Map<string, ApprovalResolver>();
  private readonly runningCommands = new Map<string, RunningCommandState>();

  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly getMainWindow: () => BrowserWindow | null
  ) {}

  registerIpcHandlers(ipcMain: IpcMain): void {
    ipcMain.handle(
      "ai-chat:respondHostCommandApproval",
      async (_event, response: AiHostCommandApprovalResponse) => {
        this.respondToApproval(response);
      }
    );
    ipcMain.handle("ai-chat:cancelHostCommand", async (_event, requestId: string) =>
      this.cancelExecution(requestId)
    );
  }

  async execute(
    request: AiHostCommandToolRequest,
    options: {
      shellExecutablePath?: string | null;
    } = {}
  ): Promise<AiHostCommandToolResult> {
    const workspaceRootPath = this.workspaceService.currentRootPath;

    if (!workspaceRootPath) {
      throw new Error("workspace folder is not open.");
    }

    const originalCommand = normalizeCommand(request.command);
    const purpose = request.purpose.trim();

    if (originalCommand.length === 0) {
      throw new Error("runShellCommand command is empty.");
    }

    if (purpose.length === 0) {
      throw new Error("runShellCommand purpose is empty.");
    }

    const workingDirectory = await resolveWorkingDirectory(
      workspaceRootPath,
      request.workingDirectory
    );
    const requestedTimeoutSeconds =
      typeof request.timeoutSeconds === "number" && Number.isFinite(request.timeoutSeconds)
        ? Math.floor(request.timeoutSeconds)
        : null;
    const effectiveTimeoutSeconds = clampTimeoutSeconds(requestedTimeoutSeconds);
    const shellExecutablePath = await resolveShellExecutablePath(options.shellExecutablePath);
    const warnings = analyzeCommandWarnings(originalCommand, {
      requestedTimeoutSeconds,
      workingDirectory: workingDirectory.relativePath
    });
    const requestId = createHostCommandRequestId();
    const approvalRequest: AiHostCommandApprovalRequest = {
      command: originalCommand,
      createdAt: new Date().toISOString(),
      effectiveTimeoutSeconds,
      id: requestId,
      purpose,
      requestedTimeoutSeconds,
      shellExecutablePath,
      warnings,
      workingDirectory: workingDirectory.relativePath || ".",
      workspaceRootPath
    };
    const approvalResponse = await this.requestApproval(approvalRequest);
    const approvedCommand = normalizeCommand(approvalResponse.command ?? originalCommand);
    const edited = approvedCommand !== originalCommand;

    if (approvalResponse.decision === "rejected") {
      return {
        edited,
        ...(edited ? { editedCommand: approvedCommand } : {}),
        exitCode: null,
        originalCommand,
        purpose,
        reason: normalizeOptionalString(approvalResponse.reason) ?? "Rejected by user.",
        shellExecutablePath,
        status: "rejected",
        stderr: "",
        stdout: "",
        timeoutSeconds: effectiveTimeoutSeconds,
        warningCodes: warnings.map((warning) => warning.code),
        workingDirectory: workingDirectory.relativePath || "."
      };
    }

    if (approvedCommand.length === 0) {
      return {
        edited,
        exitCode: null,
        originalCommand,
        purpose,
        reason: "Approved command was empty after user editing.",
        shellExecutablePath,
        status: "failed",
        stderr: "Approved command was empty after user editing.",
        stdout: "",
        timeoutSeconds: effectiveTimeoutSeconds,
        warningCodes: warnings.map((warning) => warning.code),
        workingDirectory: workingDirectory.relativePath || "."
      };
    }

    return this.runApprovedCommand({
      command: approvedCommand,
      effectiveTimeoutSeconds,
      edited,
      originalCommand,
      purpose,
      requestId,
      shellExecutablePath,
      warningCodes: warnings.map((warning) => warning.code),
      workingDirectoryAbsolutePath: workingDirectory.absolutePath,
      workingDirectoryRelativePath: workingDirectory.relativePath || "."
    });
  }

  private respondToApproval(response: AiHostCommandApprovalResponse): void {
    const resolver = this.pendingApprovals.get(response.id);

    if (!resolver) {
      return;
    }

    this.pendingApprovals.delete(response.id);
    resolver(response);
  }

  private cancelExecution(requestId: string): boolean {
    const running = this.runningCommands.get(requestId);

    if (!running) {
      return false;
    }

    running.cancelRequested = true;
    running.child.kill();
    return true;
  }

  private async requestApproval(
    request: AiHostCommandApprovalRequest
  ): Promise<AiHostCommandApprovalResponse> {
    const window = this.getMainWindow();

    if (!window || window.isDestroyed()) {
      return {
        decision: "rejected",
        id: request.id,
        reason: "Main window is not available for command approval."
      };
    }

    return new Promise<AiHostCommandApprovalResponse>((resolve) => {
      this.pendingApprovals.set(request.id, resolve);
      window.webContents.send("ai-chat:hostCommandApprovalRequest", request);
    });
  }

  private async runApprovedCommand({
    command,
    effectiveTimeoutSeconds,
    edited,
    originalCommand,
    purpose,
    requestId,
    shellExecutablePath,
    warningCodes,
    workingDirectoryAbsolutePath,
    workingDirectoryRelativePath
  }: {
    command: string;
    effectiveTimeoutSeconds: number;
    edited: boolean;
    originalCommand: string;
    purpose: string;
    requestId: string;
    shellExecutablePath: string;
    warningCodes: string[];
    workingDirectoryAbsolutePath: string;
    workingDirectoryRelativePath: string;
  }): Promise<AiHostCommandToolResult> {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let workspaceSyncError: string | undefined;
    let child: ChildProcessByStdio<null, Readable, Readable>;

    try {
      child = spawn(shellExecutablePath, [...POWERSHELL_ARGS_PREFIX, command], {
        cwd: workingDirectoryAbsolutePath,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
    } catch (error) {
      const message = toErrorMessage(error);
      try {
        await this.syncWorkspaceAfterExecution(requestId);
      } catch {
        // Keep the original spawn error as the tool result.
      }
      this.sendExecutionUpdate({
        exitCode: null,
        id: requestId,
        message,
        type: "failed"
      });
      return {
        edited,
        ...(edited ? { executedCommand: command } : {}),
        exitCode: null,
        originalCommand,
        purpose,
        reason: message,
        shellExecutablePath,
        status: "failed",
        stderr: message,
        stdout: "",
        timeoutSeconds: effectiveTimeoutSeconds,
        warningCodes,
        workingDirectory: workingDirectoryRelativePath
      };
    }

    const runningState: RunningCommandState = {
      cancelRequested: false,
      child,
      timeoutRequested: false
    };
    this.runningCommands.set(requestId, runningState);
    this.sendExecutionUpdate({
      id: requestId,
      type: "started"
    });

    const timeout = setTimeout(() => {
      const running = this.runningCommands.get(requestId);

      if (!running) {
        return;
      }

      running.timeoutRequested = true;
      running.child.kill();
      this.sendExecutionUpdate({
        id: requestId,
        message: `Command timed out after ${effectiveTimeoutSeconds}s.`,
        type: "timeout"
      });
    }, effectiveTimeoutSeconds * 1000);

    const execution = await new Promise<{
      error: Error | null;
      exitCode: number | null;
    }>((resolve) => {
      let settled = false;
      const settle = (value: { error: Error | null; exitCode: number | null }): void => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(value);
      };

      child.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stdout += text;
        this.sendExecutionUpdate({
          chunk: text,
          id: requestId,
          stream: "stdout",
          type: "stdout"
        });
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stderr += text;
        this.sendExecutionUpdate({
          chunk: text,
          id: requestId,
          stream: "stderr",
          type: "stderr"
        });
      });
      child.on("error", (error) => {
        settle({
          error,
          exitCode: null
        });
      });
      child.on("close", (exitCode) => {
        settle({
          error: null,
          exitCode
        });
      });
    });

    clearTimeout(timeout);
    this.runningCommands.delete(requestId);

    const durationMs = Date.now() - startedAt;
    const stdoutResult = truncateForModel(stdout);
    const stderrResult = truncateForModel(
      execution.error ? appendProcessError(stderr, execution.error) : stderr
    );
    const status = execution.error
      ? "failed"
      : runningState.timeoutRequested
        ? "timeout"
        : runningState.cancelRequested
          ? "cancelled"
          : "approved";

    try {
      await this.syncWorkspaceAfterExecution(requestId);
    } catch (error) {
      workspaceSyncError = toErrorMessage(error);
    }

    this.sendExecutionUpdate({
      durationMs,
      exitCode: execution.exitCode,
      id: requestId,
      message: workspaceSyncError,
      type: status === "approved" ? "finished" : status
    });

    return {
      durationMs,
      edited,
      ...(edited ? { executedCommand: command } : {}),
      exitCode: execution.exitCode,
      originalCommand,
      purpose,
      ...(execution.error ? { reason: toErrorMessage(execution.error) } : {}),
      shellExecutablePath,
      status,
      stderr: stderrResult.text,
      ...(stderrResult.truncated ? { stderrTruncated: true } : {}),
      stdout: stdoutResult.text,
      ...(stdoutResult.truncated ? { stdoutTruncated: true } : {}),
      timeoutSeconds: effectiveTimeoutSeconds,
      warningCodes,
      workingDirectory: workingDirectoryRelativePath,
      ...(workspaceSyncError ? { workspaceSyncError } : {})
    };
  }

  private sendExecutionUpdate(update: AiHostCommandExecutionUpdate): void {
    const window = this.getMainWindow();

    if (!window || window.isDestroyed()) {
      return;
    }

    window.webContents.send("ai-chat:hostCommandExecutionUpdate", update);
  }

  private async syncWorkspaceAfterExecution(requestId: string): Promise<void> {
    const window = this.getMainWindow();
    const snapshot = await this.workspaceService.syncWorkspace();

    if (!window || window.isDestroyed()) {
      return;
    }

    window.webContents.send("ai-chat:hostCommandWorkspaceSynced", {
      id: requestId,
      message: "AI CLI 実行後にワークスペースを同期しました。",
      snapshot
    });
  }
}

function normalizeCommand(value: string): string {
  return value.replace(/\r\n?/gu, "\n").trim();
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function clampTimeoutSeconds(value: number | null): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_TIMEOUT_SECONDS;
  }

  return Math.max(1, Math.min(Math.floor(value), MAX_TIMEOUT_SECONDS));
}

async function resolveWorkingDirectory(
  workspaceRootPath: string,
  workingDirectory: string | undefined
): Promise<{
  absolutePath: string;
  relativePath: string;
}> {
  const normalizedInput = normalizeOptionalString(workingDirectory) ?? "";

  if (path.isAbsolute(normalizedInput)) {
    throw new Error("workingDirectory must be relative to the workspace root.");
  }

  const parts = normalizedInput
    .split(/[\\/]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== ".");
  const absolutePath = path.resolve(workspaceRootPath, ...parts);
  const relativePath = path.relative(workspaceRootPath, absolutePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("workingDirectory escapes the workspace root.");
  }

  const stats = await fs.stat(absolutePath).catch(() => null);

  if (!stats?.isDirectory()) {
    throw new Error(
      `workingDirectory does not exist or is not a directory: ${normalizedInput || "."}`
    );
  }

  return {
    absolutePath,
    relativePath: relativePath.split(path.sep).filter(Boolean).join("/")
  };
}

async function resolveShellExecutablePath(configuredPath: string | null | undefined): Promise<string> {
  const normalizedConfiguredPath = normalizeOptionalString(configuredPath);

  if (normalizedConfiguredPath) {
    return normalizedConfiguredPath;
  }

  if (process.platform === "win32") {
    if (await fileExists(DEFAULT_PWSH_ABSOLUTE_PATH)) {
      return DEFAULT_PWSH_ABSOLUTE_PATH;
    }

    return (await findExecutableOnPath("pwsh.exe")) ?? "powershell.exe";
  }

  return (await findExecutableOnPath("pwsh")) ?? "pwsh";
}

async function findExecutableOnPath(executableName: string): Promise<string | null> {
  const pathValue = process.env.PATH ?? "";
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
  const namesToTry = path.extname(executableName)
    ? [executableName]
    : extensions.map((extension) => `${executableName}${extension.toLowerCase()}`);

  for (const directoryPath of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const name of namesToTry) {
      const candidatePath = path.join(directoryPath, name);

      if (await fileExists(candidatePath)) {
        return candidatePath;
      }
    }
  }

  return null;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

function analyzeCommandWarnings(
  command: string,
  context: {
    requestedTimeoutSeconds: number | null;
    workingDirectory: string;
  }
): AiHostCommandWarning[] {
  const warnings: AiHostCommandWarning[] = [];
  const normalized = command.toLowerCase();

  if (context.requestedTimeoutSeconds !== null && context.requestedTimeoutSeconds > MAX_TIMEOUT_SECONDS) {
    warnings.push({
      code: "timeout-clamped",
      message: `Requested timeout ${context.requestedTimeoutSeconds}s exceeds the ${MAX_TIMEOUT_SECONDS}s maximum and will be clamped.`
    });
  }

  if (/(^|[\s;&|])(?:remove-item|rm|del|erase|rmdir|rd)\b/u.test(normalized)) {
    warnings.push({
      code: "destructive-command",
      message: "Command appears to remove files or directories."
    });
  }

  if (/(invoke-webrequest|invoke-restmethod|\biwr\b|\birm\b|\bcurl\b|\bwget\b)/u.test(normalized)) {
    warnings.push({
      code: "network-command",
      message: "Command appears to access the network."
    });
  }

  if (/(^|[\s;&|])(?:npm\s+install|npm\s+i|pnpm\s+add|yarn\s+add|pip\s+install|python\s+-m\s+pip\s+install)\b/u.test(normalized)) {
    warnings.push({
      code: "dependency-install",
      message: "Command appears to install dependencies."
    });
  }

  if (/(start-process|\bstart\s+["']?[^"'\s]+|\binvoke-item\b|\bii\b)/u.test(normalized)) {
    warnings.push({
      code: "external-process",
      message: "Command appears to launch an external process or application."
    });
  }

  if (/(^|[^\w])(?:[a-z]:\\|\\\\|\/users\/|\/etc\/|\/var\/|\/tmp\/|\.\.\\|\.\.\/)/iu.test(command)) {
    warnings.push({
      code: "workspace-escape-risk",
      message: "Command mentions paths that may point outside the workspace."
    });
  }

  if (context.workingDirectory.length > 0) {
    warnings.push({
      code: "subdirectory-cwd",
      message: `Command will run from workspace subdirectory: ${context.workingDirectory}`
    });
  }

  return deduplicateWarnings(warnings);
}

function deduplicateWarnings(warnings: AiHostCommandWarning[]): AiHostCommandWarning[] {
  const seen = new Set<string>();
  const result: AiHostCommandWarning[] = [];

  for (const warning of warnings) {
    if (seen.has(warning.code)) {
      continue;
    }

    seen.add(warning.code);
    result.push(warning);
  }

  return result;
}

function truncateForModel(text: string): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= MODEL_OUTPUT_LIMIT) {
    return {
      text,
      truncated: false
    };
  }

  return {
    text: text.slice(0, MODEL_OUTPUT_LIMIT),
    truncated: true
  };
}

function appendProcessError(stderr: string, error: Error): string {
  const message = error.message.trim();

  if (message.length === 0 || stderr.includes(message)) {
    return stderr;
  }

  return stderr.length > 0 ? `${stderr}\n${message}` : message;
}

function createHostCommandRequestId(): string {
  return `host-command-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
