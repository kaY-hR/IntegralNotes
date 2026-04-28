import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
  ToolLoopAgent,
  createGateway,
  stepCountIs,
  tool,
  type LanguageModel,
  type ModelMessage,
  type ToolSet
} from "ai";
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { z } from "zod";

import type {
  AiChatContextSummary,
  AiChatMessage,
  AiChatMessageDiagnostics,
  AiChatToolTraceEntry
} from "../shared/aiChat";
import type { IntegralWorkspaceService } from "./integralWorkspaceService";
import { WorkspaceVisualRenderService } from "./workspaceVisualRenderService";
import { WorkspaceService } from "./workspaceService";

const AGENT_SKILLS_DESTINATION = ".integral-ai-skills";
const MAX_WORKSPACE_FILE_COUNT = 5_000;
const MAX_WORKSPACE_FILE_SIZE_BYTES = 1_000_000;
const MAX_WORKSPACE_IMAGE_SIZE_BYTES = 8_000_000;
const IMAGE_FILE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".heic",
  ".heif",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp"
]);
const SKIPPED_WORKSPACE_DIRECTORIES = new Set([
  ".git",
  ".integral-ai-skills",
  "dist",
  "dist-electron",
  "node_modules",
  "out"
]);
const TOOL_LOOP_MAX_STEPS = 8;
const WORKSPACE_MOUNT_PATH = "/workspace";

export type AiAgentExecutionRuntime =
  | {
      gatewayApiKey: string;
      mode: "gateway";
      modelId: string;
      providerOptions?: Record<string, unknown>;
    }
  | {
      apiKey: string;
      mode: "anthropic-direct";
      modelId: string;
    }
  | {
      apiKey: string;
      mode: "openai-direct";
      modelId: string;
    };

export class AiAgentService {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceVisualRenderService: WorkspaceVisualRenderService,
    private readonly getIntegralWorkspaceService?: () => IntegralWorkspaceService | null
  ) {}

  async submit({
    context,
    history,
    runtime
  }: {
    context: AiChatContextSummary;
    history: AiChatMessage[];
    runtime: AiAgentExecutionRuntime;
  }): Promise<{
    diagnostics: AiChatMessageDiagnostics;
    text: string;
  }> {
    const { model, providerOptions } = this.createLanguageModel(runtime);
    const toolContext = await this.createToolContext();
    const agent = new ToolLoopAgent({
      instructions: buildAgentInstructions(context, toolContext),
      model,
      providerOptions: providerOptions as any,
      stopWhen: stepCountIs(TOOL_LOOP_MAX_STEPS),
      tools: toolContext.tools
    });
    const result = await agent.generate({
      messages: history.map(toModelMessage).filter(isDefined)
    });
    const toolTrace = buildToolTrace(result.steps);
    const text = result.text.trim();
    const responseText =
      text.length > 0
        ? text
        : buildFallbackAssistantText(toolTrace, result.finishReason ?? null);

    if (responseText.length === 0) {
      throw new Error("AI agent returned no assistant text.");
    }

    return {
      diagnostics: {
        finishReason: result.finishReason ?? null,
        modelId: result.steps.at(-1)?.model.modelId ?? runtime.modelId,
        stepCount: result.steps.length,
        toolTrace
      },
      text: responseText
    };
  }

  async generateForTask({
    context,
    instructions,
    maxSteps = TOOL_LOOP_MAX_STEPS,
    prompt,
    runtime,
    useWorkspaceTools
  }: {
    context: AiChatContextSummary;
    instructions: string;
    maxSteps?: number;
    prompt: string;
    runtime: AiAgentExecutionRuntime;
    useWorkspaceTools: boolean;
  }): Promise<{
    diagnostics: AiChatMessageDiagnostics;
    text: string;
  }> {
    const { model, providerOptions } = this.createLanguageModel(runtime);
    const toolContext = useWorkspaceTools
      ? await this.createToolContext()
      : {
          skillCount: 0,
          tools: {},
          workspaceMounted: false
        };
    const agent = new ToolLoopAgent({
      instructions: buildTaskInstructions(instructions, context, toolContext),
      model,
      providerOptions: providerOptions as any,
      stopWhen: stepCountIs(maxSteps),
      tools: toolContext.tools
    });
    const result = await agent.generate({
      messages: [
        {
          content: prompt,
          role: "user"
        }
      ]
    });
    const toolTrace = buildToolTrace(result.steps);
    const text = result.text.trim();
    const responseText =
      text.length > 0
        ? text
        : buildFallbackAssistantText(toolTrace, result.finishReason ?? null);

    if (responseText.length === 0) {
      throw new Error("AI agent returned no assistant text.");
    }

    return {
      diagnostics: {
        finishReason: result.finishReason ?? null,
        modelId: result.steps.at(-1)?.model.modelId ?? runtime.modelId,
        stepCount: result.steps.length,
        toolTrace
      },
      text: responseText
    };
  }

  private createLanguageModel(
    runtime: AiAgentExecutionRuntime
  ): {
    model: LanguageModel;
    providerOptions?: Record<string, unknown>;
  } {
    switch (runtime.mode) {
      case "gateway": {
        const gateway = createGateway({
          apiKey: runtime.gatewayApiKey
        });

        return {
          model: gateway(runtime.modelId),
          providerOptions: runtime.providerOptions
        };
      }

      case "anthropic-direct": {
        const anthropic = createAnthropic({
          apiKey: runtime.apiKey
        });

        return {
          model: anthropic(runtime.modelId as any)
        };
      }

      case "openai-direct": {
        const openai = createOpenAI({
          apiKey: runtime.apiKey
        });

        return {
          model: openai(runtime.modelId as any)
        };
      }
    }
  }

  private async createToolContext(): Promise<{
    skillCount: number;
    tools: ToolSet;
    workspaceMounted: boolean;
  }> {
    const workspaceRootPath = this.workspaceService.currentRootPath;

    if (!workspaceRootPath) {
      return {
      skillCount: 0,
        tools: {},
        workspaceMounted: false
      };
    }

    const { experimental_createSkillTool, createBashTool } =
      await importEsmModule<typeof import("bash-tool")>("bash-tool");
    const skillsDirectoryPath = path.join(workspaceRootPath, ".codex", "skills");
    const [workspaceFiles, skillToolkit] = await Promise.all([
      collectWorkspaceFiles(workspaceRootPath),
      (await directoryExists(skillsDirectoryPath))
        ? experimental_createSkillTool({
            destination: AGENT_SKILLS_DESTINATION,
            skillsDirectory: skillsDirectoryPath
          })
        : Promise.resolve(null)
    ]);
    const bashToolkit = await createBashTool({
      destination: WORKSPACE_MOUNT_PATH,
      extraInstructions: buildBashToolInstructions(skillToolkit?.instructions),
      files: {
        ...workspaceFiles,
        ...(skillToolkit?.files ?? {})
      },
      maxFiles: 0
    });
    const persistentWorkspaceTools = createPersistentWorkspaceTools(
      workspaceRootPath,
      this.workspaceService,
      this.workspaceVisualRenderService,
      this.getIntegralWorkspaceService
    );

    return {
      skillCount: skillToolkit?.skills.length ?? 0,
      tools: skillToolkit
        ? {
            ...persistentWorkspaceTools,
            skill: skillToolkit.skill,
            ...bashToolkit.tools
          }
        : { ...persistentWorkspaceTools, ...bashToolkit.tools },
      workspaceMounted: true
    };
  }
}

function buildAgentInstructions(
  context: AiChatContextSummary,
  toolContext: {
    skillCount: number;
    workspaceMounted: boolean;
  }
): string {
  const lines = [
    "You are the AI Chat inside IntegralNotes.",
    "Keep responses concise, practical, and focused on the current workspace.",
    "Use tools when you need to inspect files instead of guessing.",
    "For repository, code, configuration, file, or implementation questions, inspect the workspace with tools before answering even if an active excerpt is available.",
    "If the task requires concrete file evidence, search the workspace first.",
    "Always end with a short assistant answer after tool use. Never leave the final response empty.",
    "If you discover an image path and need to inspect the image itself, use readWorkspaceImage.",
    "If markdown/html layout or embedded charts matter, use renderWorkspaceDocument to inspect the rendered page visually.",
    "When reading markdown, if you find a linked or embedded .html/.htm file and the user is asking about its visual content, render that HTML path with renderWorkspaceDocument instead of judging from the markdown text alone.",
    "If the user wants real workspace edits, use writeWorkspaceFile. bash/writeFile remains preview-only.",
    "Do not claim that real workspace files were saved unless the app explicitly tells you persistence happened.",
    ""
  ];

  lines.push(buildWorkspaceContextInstructions(context, toolContext));

  return lines.join("\n");
}

function buildTaskInstructions(
  instructions: string,
  context: AiChatContextSummary,
  toolContext: {
    skillCount: number;
    workspaceMounted: boolean;
  }
): string {
  return [
    instructions.trim(),
    "",
    buildWorkspaceContextInstructions(context, toolContext)
  ]
    .filter((part) => part.trim().length > 0)
    .join("\n");
}

function buildWorkspaceContextInstructions(
  context: AiChatContextSummary,
  toolContext: {
    skillCount: number;
    workspaceMounted: boolean;
  }
): string {
  const lines = [
    `workspace: ${context.workspaceRootName ?? "(not open)"}`,
    `active path: ${context.activeRelativePath ?? "(none)"}`,
    `workspace tools mounted: ${toolContext.workspaceMounted ? "yes" : "no"}`,
    `skills available: ${toolContext.skillCount}`
  ];

  if (context.activeDocumentName) {
    lines.push(`active document name: ${context.activeDocumentName}`);
  }

  if (context.activeDocumentKind) {
    lines.push(`active document kind: ${context.activeDocumentKind}`);
  }

  if (context.selectedPaths.length > 0) {
    lines.push(`selected paths: ${context.selectedPaths.join(", ")}`);
  }

  if (context.activeDocumentExcerpt) {
    lines.push("");
    lines.push("active document excerpt:");
    lines.push(context.activeDocumentExcerpt);
  }

  return lines.join("\n");
}

function buildBashToolInstructions(skillInstructions?: string): string {
  const lines = [
    `The local workspace is mounted at ${WORKSPACE_MOUNT_PATH}.`,
    "Use relative paths from the current working directory unless an absolute mounted path is clearer.",
    "The bash runtime supports rg, find, grep, ls, head, tail, sed, jq, cat, and related Unix-style commands.",
    "When the user asks about files beyond the active excerpt, start with rg/find/ls/readFile instead of answering from memory.",
    "Workspace files are preloaded into the sandbox for this request. Text files include real content; binary or oversized files may appear as placeholder stubs so they remain discoverable via find/ls.",
    "Use readWorkspaceImage when you need to inspect an image file in the real workspace by path.",
    "Use renderWorkspaceDocument when you need a visual rendering of a markdown/html/text workspace file, including embedded HTML charts.",
    "When markdown contains a linked or embedded .html/.htm path and visual content matters, call renderWorkspaceDocument on that HTML path rather than relying only on the markdown source.",
    "Any writes done through bash/writeFile are overlay-only preview changes. They do not persist to the real workspace yet.",
    "Use writeWorkspaceFile when you need to persist a real workspace text edit.",
    "Do not tell the user that files were saved; instead describe preview changes or proposed edits."
  ];

  if (skillInstructions && skillInstructions.trim().length > 0) {
    lines.push("");
    lines.push(skillInstructions.trim());
  }

  return lines.join("\n");
}

async function directoryExists(targetPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(targetPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function collectWorkspaceFiles(workspaceRootPath: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  let loadedFileCount = 0;

  const walk = async (currentDirectoryPath: string): Promise<void> => {
    if (loadedFileCount >= MAX_WORKSPACE_FILE_COUNT) {
      return;
    }

    let entries: Dirent[];

    try {
      entries = await fs.readdir(currentDirectoryPath, {
        withFileTypes: true
      });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (loadedFileCount >= MAX_WORKSPACE_FILE_COUNT) {
        return;
      }

      const entryPath = path.join(currentDirectoryPath, entry.name);

      if (entry.isDirectory()) {
        if (SKIPPED_WORKSPACE_DIRECTORIES.has(entry.name)) {
          continue;
        }

        await walk(entryPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const relativePath = normalizeRelativeWorkspacePath(workspaceRootPath, entryPath);

      if (!relativePath) {
        continue;
      }

      const fileContent = await createWorkspaceSnapshotEntry(entryPath, relativePath);

      if (fileContent === null) {
        continue;
      }

      files[relativePath] = fileContent;
      loadedFileCount += 1;
    }
  };

  await walk(workspaceRootPath);
  return files;
}

function normalizeRelativeWorkspacePath(
  workspaceRootPath: string,
  entryPath: string
): string | null {
  const relativePath = path.relative(workspaceRootPath, entryPath);

  if (relativePath.length === 0 || relativePath.startsWith("..")) {
    return null;
  }

  return relativePath.replace(/\\/gu, "/");
}

async function tryReadWorkspaceTextFile(filePath: string): Promise<string | null> {
  try {
    const buffer = await fs.readFile(filePath);

    if (buffer.length > MAX_WORKSPACE_FILE_SIZE_BYTES || buffer.includes(0)) {
      return null;
    }

    return buffer.toString("utf8");
  } catch {
    return null;
  }
}

async function createWorkspaceSnapshotEntry(
  filePath: string,
  relativePath: string
): Promise<string | null> {
  const textContent = await tryReadWorkspaceTextFile(filePath);

  if (textContent !== null) {
    return textContent;
  }

  const fileStats = await fs.stat(filePath).catch(() => null);

  if (!fileStats?.isFile()) {
    return null;
  }

  return buildWorkspacePlaceholder(relativePath, fileStats.size);
}

function buildWorkspacePlaceholder(relativePath: string, fileSizeBytes: number): string {
  const extension = path.extname(relativePath).toLowerCase();
  const fileKind = IMAGE_FILE_EXTENSIONS.has(extension) ? "image" : "binary-or-unloaded";
  const lines = [
    "[workspace snapshot placeholder]",
    `path: ${relativePath}`,
    `kind: ${fileKind}`,
    `sizeBytes: ${fileSizeBytes}`,
    "note: The file exists in the real workspace, but its binary or oversized contents were not loaded into the bash snapshot.",
    "note: Use find/ls to discover it. If you need to inspect an image by path, call readWorkspaceImage."
  ];

  return lines.join("\n");
}

async function importEsmModule<T>(specifier: string): Promise<T> {
  const importer = new Function("specifier", "return import(specifier);") as (
    nextSpecifier: string
  ) => Promise<T>;

  return importer(specifier);
}

function createPersistentWorkspaceTools(
  workspaceRootPath: string,
  workspaceService: WorkspaceService,
  workspaceVisualRenderService: WorkspaceVisualRenderService,
  getIntegralWorkspaceService?: () => IntegralWorkspaceService | null
): ToolSet {
  return {
    resolveManagedDataByPath: tool({
      description:
        "Resolve a workspace path to the managed data ID and metadata used by IntegralNotes. Use this before writing itg-notes block inputs from paths.",
      inputSchema: z.object({
        path: z.string().min(1)
      }),
      execute: async ({ path: targetPath }) => {
        const integralWorkspaceService = getIntegralWorkspaceService?.() ?? null;

        if (!integralWorkspaceService) {
          throw new Error("Integral workspace service is not ready.");
        }

        const result = await integralWorkspaceService.resolveManagedDataByPath(targetPath);

        if (!result) {
          throw new Error(`Managed data was not found for path: ${targetPath}`);
        }

        return result;
      }
    }),
    resolveManagedDataById: tool({
      description:
        "Resolve an IntegralNotes managed data ID to its current workspace path and metadata. Use this when reading executed itg-notes block inputs or outputs.",
      inputSchema: z.object({
        id: z.string().min(1)
      }),
      execute: async ({ id }) => {
        const integralWorkspaceService = getIntegralWorkspaceService?.() ?? null;

        if (!integralWorkspaceService) {
          throw new Error("Integral workspace service is not ready.");
        }

        const result = await integralWorkspaceService.resolveManagedDataById(id);

        if (!result) {
          throw new Error(`Managed data was not found for ID: ${id}`);
        }

        return result;
      }
    }),
    renderWorkspaceDocument: tool({
      description:
        "Render a markdown/html/text workspace file in a hidden browser and return a screenshot for visual inspection. Use this when layout, charts, or rendered appearance matter.",
      inputSchema: z.object({
        path: z.string().min(1),
        waitMs: z.number().int().min(0).max(5000).optional(),
        width: z.number().int().min(640).max(2200).optional()
      }),
      execute: async ({ path: targetPath, waitMs, width }) => {
        const relativePath = normalizeWorkspaceRelativePath(targetPath);

        return workspaceVisualRenderService.renderWorkspaceDocument(relativePath, {
          waitMs,
          width
        });
      },
      toModelOutput: ({ output }) => ({
        type: "content",
        value: [
          {
            text: `Workspace document rendered: ${output.path} (${output.sourceKind}, ${output.width}x${output.height}, ${output.renderReadiness})`,
            type: "text"
          },
          {
            data: output.base64Data,
            mediaType: output.mediaType,
            type: "image-data"
          }
        ]
      })
    }),
    readWorkspaceImage: tool({
      description:
        "Load an image file from the real workspace and send it back to the model for visual inspection. Use this when you discover an image path and need to examine the image contents.",
      inputSchema: z.object({
        path: z.string().min(1)
      }),
      execute: async ({ path: targetPath }) => {
        const relativePath = normalizeWorkspaceRelativePath(targetPath);
        const absolutePath = resolveWorkspaceAbsolutePath(workspaceRootPath, relativePath);
        const fileStats = await fs.stat(absolutePath).catch(() => null);

        if (!fileStats?.isFile()) {
          throw new Error(`Image file not found: ${relativePath}`);
        }

        if (fileStats.size > MAX_WORKSPACE_IMAGE_SIZE_BYTES) {
          throw new Error(
            `Image file is too large to inspect (${fileStats.size} bytes): ${relativePath}`
          );
        }

        const mediaType = inferWorkspaceImageMediaType(relativePath);

        if (!mediaType) {
          throw new Error(`Unsupported image file type: ${relativePath}`);
        }

        const buffer = await fs.readFile(absolutePath);

        return {
          base64Data: buffer.toString("base64"),
          mediaType,
          path: relativePath,
          sizeBytes: fileStats.size
        };
      },
      toModelOutput: ({ output }) => ({
        type: "content",
        value: [
          {
            text: `Workspace image loaded: ${output.path} (${output.mediaType}, ${output.sizeBytes} bytes)`,
            type: "text"
          },
          {
            data: output.base64Data,
            mediaType: output.mediaType,
            type: "image-data"
          }
        ]
      })
    }),
    writeWorkspaceFile: tool({
      description:
        "Persist UTF-8 text changes to a real workspace file. Use this for actual saves; bash/writeFile is preview-only.",
      inputSchema: z.object({
        content: z.string(),
        createIfMissing: z.boolean().default(false),
        path: z.string().min(1)
      }),
      execute: async ({ content, createIfMissing, path: targetPath }) => {
        const relativePath = normalizeWorkspaceRelativePath(targetPath);
        const absolutePath = resolveWorkspaceAbsolutePath(workspaceRootPath, relativePath);
        const fileStats = await fs.stat(absolutePath).catch(() => null);
        const existed = fileStats !== null;

        if (fileStats?.isDirectory()) {
          throw new Error(`Cannot write directory: ${relativePath}`);
        }

        if (!existed && !createIfMissing) {
          throw new Error(`Target file does not exist: ${relativePath}`);
        }

        if (path.extname(relativePath).toLowerCase() === ".md" && existed) {
          const note = await workspaceService.saveNote(relativePath, content);

          return {
            created: false,
            path: note.relativePath,
            saved: true
          };
        }

        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, content, "utf8");

        return {
          created: !existed,
          path: relativePath,
          saved: true
        };
      }
    })
  };
}

function toModelMessage(message: AiChatMessage): ModelMessage | null {
  if (message.role === "tool") {
    return null;
  }

  if (message.role === "assistant") {
    return {
      content: message.text,
      role: "assistant"
    };
  }

  if (message.attachments && message.attachments.length > 0) {
    return {
      content: [
        {
          text: message.text,
          type: "text"
        },
        ...message.attachments.map((attachment) => ({
          image: attachment.dataUrl,
          type: "image" as const
        }))
      ],
      role: "user"
    };
  }

  return {
    content: message.text,
    role: "user"
  };
}

function buildToolTrace(
  steps: Array<{
    stepNumber: number;
    toolCalls: Array<{ input: unknown; toolCallId: string; toolName: string }>;
    toolResults: Array<{ input: unknown; output: unknown; toolCallId: string; toolName: string }>;
  }>
): AiChatToolTraceEntry[] {
  const entries: AiChatToolTraceEntry[] = [];

  for (const step of steps) {
    const resultsByCallId = new Map(
      step.toolResults.map((result) => [result.toolCallId, result] as const)
    );

    for (const toolCall of step.toolCalls) {
      const toolResult = resultsByCallId.get(toolCall.toolCallId);
      entries.push({
        inputSummary: summarizeToolInput(toolCall.toolName, toolCall.input),
        outputSummary: summarizeToolOutput(toolCall.toolName, toolResult?.output),
        status: determineToolTraceStatus(toolCall.toolName, toolResult?.output),
        stepNumber: step.stepNumber,
        toolName: toolCall.toolName
      });
    }
  }

  return entries;
}

function determineToolTraceStatus(
  toolName: string,
  output: unknown
): "error" | "success" {
  if (toolName === "bash" && isRecord(output) && typeof output.exitCode === "number") {
    return output.exitCode === 0 ? "success" : "error";
  }

  if (
    toolName === "renderWorkspaceDocument" &&
    isRecord(output) &&
    typeof output.renderReadiness === "string"
  ) {
    return output.renderReadiness.startsWith("timeout:") ? "error" : "success";
  }

  return "success";
}

function summarizeToolInput(toolName: string, input: unknown): string {
  if (toolName === "bash" && isRecord(input) && typeof input.command === "string") {
    return truncateTraceText(input.command);
  }

  if ((toolName === "readFile" || toolName === "writeFile" || toolName === "writeWorkspaceFile") && isRecord(input)) {
    const pathValue = typeof input.path === "string" ? input.path : "(unknown path)";

    if (toolName === "writeFile" || toolName === "writeWorkspaceFile") {
      const contentLength =
        typeof input.content === "string" || Buffer.isBuffer(input.content)
          ? input.content.length
          : null;

      return contentLength === null ? pathValue : `${pathValue} (${contentLength} chars)`;
    }

    return pathValue;
  }

  if (toolName === "readWorkspaceImage" && isRecord(input) && typeof input.path === "string") {
    return input.path;
  }

  if (toolName === "renderWorkspaceDocument" && isRecord(input) && typeof input.path === "string") {
    const pathValue = input.path;
    const widthValue =
      typeof input.width === "number" && Number.isFinite(input.width) ? ` @${input.width}px` : "";
    const waitValue =
      typeof input.waitMs === "number" && Number.isFinite(input.waitMs)
        ? ` wait ${input.waitMs}ms`
        : "";

    return `${pathValue}${widthValue}${waitValue}`;
  }

  if (toolName === "resolveManagedDataByPath" && isRecord(input) && typeof input.path === "string") {
    return input.path;
  }

  if (toolName === "resolveManagedDataById" && isRecord(input) && typeof input.id === "string") {
    return input.id;
  }

  return summarizeUnknownValue(input);
}

function summarizeToolOutput(toolName: string, output: unknown): string {
  if (toolName === "bash" && isRecord(output)) {
    const exitCode =
      typeof output.exitCode === "number" ? `exit ${output.exitCode}` : "exit ?";
    const stdout =
      typeof output.stdout === "string" && output.stdout.trim().length > 0
        ? `stdout: ${truncateTraceText(output.stdout.trim())}`
        : null;
    const stderr =
      typeof output.stderr === "string" && output.stderr.trim().length > 0
        ? `stderr: ${truncateTraceText(output.stderr.trim())}`
        : null;

    return [exitCode, stdout, stderr].filter(isDefined).join(" | ");
  }

  if (toolName === "readFile" && isRecord(output) && typeof output.content === "string") {
    return `${output.content.length} chars`;
  }

  if (toolName === "writeFile" && isRecord(output) && typeof output.success === "boolean") {
    return output.success ? "overlay preview updated" : "write reported failure";
  }

  if (toolName === "writeWorkspaceFile" && isRecord(output) && typeof output.path === "string") {
    const created =
      typeof output.created === "boolean" ? (output.created ? "created" : "updated") : "saved";

    return `${created}: ${output.path}`;
  }

  if (toolName === "readWorkspaceImage" && isRecord(output) && typeof output.path === "string") {
    const mediaType =
      typeof output.mediaType === "string" ? output.mediaType : "image/*";
    const sizeBytes =
      typeof output.sizeBytes === "number" ? `${output.sizeBytes} bytes` : "size unknown";

    return `${output.path} | ${mediaType} | ${sizeBytes}`;
  }

  if (toolName === "renderWorkspaceDocument" && isRecord(output) && typeof output.path === "string") {
    const sourceKind =
      typeof output.sourceKind === "string" ? output.sourceKind : "document";
    const width =
      typeof output.width === "number" && Number.isFinite(output.width) ? output.width : "?";
    const height =
      typeof output.height === "number" && Number.isFinite(output.height) ? output.height : "?";
    const renderReadiness =
      typeof output.renderReadiness === "string" && output.renderReadiness.trim().length > 0
        ? output.renderReadiness.trim()
        : "rendered";

    return `${output.path} | ${sourceKind} | ${width}x${height} | ${renderReadiness}`;
  }

  if (
    (toolName === "resolveManagedDataByPath" || toolName === "resolveManagedDataById") &&
    isRecord(output) &&
    typeof output.id === "string" &&
    typeof output.path === "string"
  ) {
    return `${output.id} -> ${output.path}`;
  }

  return summarizeUnknownValue(output);
}

function summarizeUnknownValue(value: unknown): string {
  if (value === undefined) {
    return "(no result)";
  }

  if (typeof value === "string") {
    return truncateTraceText(value);
  }

  try {
    return truncateTraceText(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function truncateTraceText(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();

  if (normalized.length <= 180) {
    return normalized;
  }

  return `${normalized.slice(0, 177).trimEnd()}...`;
}

function buildFallbackAssistantText(
  toolTrace: readonly AiChatToolTraceEntry[],
  finishReason: string | null
): string {
  if (toolTrace.length === 0) {
    return "";
  }

  const recentEntries = toolTrace.slice(-3);
  const lines = [
    "モデルの最終テキストが空だったため、tool 実行結果を要約します。"
  ];

  if (finishReason) {
    lines.push(`finish: ${finishReason}`);
  }

  for (const entry of recentEntries) {
    lines.push(`${entry.toolName}: ${entry.outputSummary}`);
  }

  const latestErrorEntry = [...toolTrace].reverse().find((entry) => entry.status === "error");

  if (latestErrorEntry) {
    lines.push(`latest error: ${latestErrorEntry.toolName}: ${latestErrorEntry.outputSummary}`);
  }

  return lines.join("\n");
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function normalizeWorkspaceRelativePath(targetPath: string): string {
  return targetPath
    .trim()
    .replace(/^[\\/]+/gu, "")
    .split(/[\\/]+/u)
    .filter(Boolean)
    .join("/");
}

function resolveWorkspaceAbsolutePath(workspaceRootPath: string, targetPath: string): string {
  const absolutePath = path.resolve(workspaceRootPath, ...targetPath.split("/").filter(Boolean));
  const normalizedRelativePath = path.relative(workspaceRootPath, absolutePath);

  if (normalizedRelativePath.startsWith("..") || path.isAbsolute(normalizedRelativePath)) {
    throw new Error(`Path escapes workspace root: ${targetPath}`);
  }

  return absolutePath;
}

function inferWorkspaceImageMediaType(targetPath: string): string | null {
  switch (path.extname(targetPath).toLowerCase()) {
    case ".avif":
      return "image/avif";
    case ".bmp":
      return "image/bmp";
    case ".gif":
      return "image/gif";
    case ".heic":
      return "image/heic";
    case ".heif":
      return "image/heif";
    case ".jpeg":
    case ".jpg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    default:
      return null;
  }
}
