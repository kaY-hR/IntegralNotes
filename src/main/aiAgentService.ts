import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
  ToolLoopAgent,
  createGateway,
  hasToolCall,
  stepCountIs,
  tool,
  type LanguageModel,
  type ModelMessage,
  type ToolSet
} from "ai";
import { createHash } from "node:crypto";
import { promises as fs, type Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import {
  DEFAULT_AI_CHAT_SYSTEM_PROMPTS,
  type AiChatContextSummary,
  type AiHostCommandToolRequest,
  type AiHostCommandToolResult,
  type AiChatMessage,
  type AiChatMessageDiagnostics,
  type AiChatSkillInvocation,
  type AiChatToolTraceEntry,
  type InlineActionReadScope
} from "../shared/aiChat";
import { normalizeAiSkillNameKey } from "../shared/aiChatSkills";
import type { IntegralWorkspaceService } from "./integralWorkspaceService";
import { getGlobalSkillRootPaths } from "./pathTokens";
import { WorkspaceVisualRenderService } from "./workspaceVisualRenderService";
import { WorkspaceService } from "./workspaceService";

type AiAgentSystemPrompt = string | null | undefined;

function normalizeSystemPrompt(value: AiAgentSystemPrompt, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.replace(/\r\n?/g, "\n").trim();
  return normalized.length > 0 ? normalized : fallback;
}

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
  ".inline-action",
  ".integral-ai-skills",
  "dist",
  "dist-electron",
  "node_modules",
  "out"
]);
const TOOL_LOOP_MAX_STEPS = 8;
const WORKSPACE_MOUNT_PATH = "/workspace";
const AGENTS_INSTRUCTION_FILE_PROMPT = [
  "# AGENTS.md Instructions",
  "If an AGENTS.md file exists in the workspace root, read it before answering or acting on workspace files, then follow its instructions.",
  "Before creating, editing, or deleting a workspace file, check for AGENTS.md files in the target file's directory and every ancestor directory up to the workspace root. Read every applicable AGENTS.md before making the change.",
  "When multiple AGENTS.md files apply, treat the deeper file as more specific for files under that directory."
].join("\n");

interface AiHostCommandExecutor {
  execute(
    request: AiHostCommandToolRequest,
    options?: {
      shellExecutablePath?: string | null;
    }
  ): Promise<AiHostCommandToolResult>;
}

interface AiAgentHostCommandOptions {
  shellExecutablePath?: string | null;
}

export interface AiAgentWorkspaceToolPolicy {
  canEditWorkspaceFiles?: boolean;
  canRunShellCommand?: boolean;
  readDirs?: string[];
  readScope?: InlineActionReadScope;
}

interface AiAgentReadAccess {
  canRead: (relativePath: string) => boolean;
  description: string;
}

interface AiProviderBuiltInToolInfo {
  instructions: string[];
  tools: ToolSet;
}

export interface AiAgentStreamCallbacks {
  onTextDelta?: (textDelta: string) => void;
  onTextReset?: () => void;
  onToolTrace?: (toolTrace: AiChatToolTraceEntry[]) => void;
}

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
    private readonly getIntegralWorkspaceService?: () => IntegralWorkspaceService | null,
    private readonly hostCommandExecutor?: AiHostCommandExecutor
  ) {}

  async submit({
    context,
    history,
    runtime,
    hostCommand,
    systemPrompt,
    stream
  }: {
    context: AiChatContextSummary;
    hostCommand?: AiAgentHostCommandOptions;
    history: AiChatMessage[];
    runtime: AiAgentExecutionRuntime;
    stream?: AiAgentStreamCallbacks;
    systemPrompt?: string | null;
  }): Promise<{
    diagnostics: AiChatMessageDiagnostics;
    text: string;
  }> {
    const { model, providerBuiltInTools, providerOptions } = this.createLanguageModel(runtime);
    const toolContext = await this.createToolContext(context, hostCommand);
    const tools = {
      ...toolContext.tools,
      ...(providerBuiltInTools?.tools ?? {})
    };
    const agent = new ToolLoopAgent({
      instructions: buildAgentInstructions(
        context,
        toolContext,
        systemPrompt,
        providerBuiltInTools
      ),
      model,
      providerOptions: providerOptions as any,
      stopWhen: stepCountIs(TOOL_LOOP_MAX_STEPS),
      tools
    });
    const messages = history.map(toModelMessage).filter(isDefined);

    if (stream) {
      return this.runStreamingAgent({
        agent,
        messages,
        runtime,
        stream
      });
    }

    const result = await agent.generate({
      messages
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
    extraTools,
    instructions,
    maxSteps = TOOL_LOOP_MAX_STEPS,
    prompt,
    runtime,
    hostCommand,
    stream,
    terminalToolNames,
    useWorkspaceTools,
    workspaceToolPolicy
  }: {
    context: AiChatContextSummary;
    extraTools?: ToolSet;
    hostCommand?: AiAgentHostCommandOptions;
    instructions: string;
    maxSteps?: number;
    prompt: string;
    runtime: AiAgentExecutionRuntime;
    stream?: AiAgentStreamCallbacks;
    terminalToolNames?: readonly string[];
    useWorkspaceTools: boolean;
    workspaceToolPolicy?: AiAgentWorkspaceToolPolicy;
  }): Promise<{
    diagnostics: AiChatMessageDiagnostics;
    text: string;
  }> {
    const { model, providerBuiltInTools, providerOptions } = this.createLanguageModel(runtime);
    const toolContext = useWorkspaceTools
      ? await this.createToolContext(context, hostCommand, workspaceToolPolicy)
      : {
          readScopeDescription: "workspace tools disabled",
          skillCount: 0,
          tools: {},
          workspaceMounted: false
        };
    const tools = {
      ...toolContext.tools,
      ...(providerBuiltInTools?.tools ?? {}),
      ...(extraTools ?? {})
    };
    const stopWhen =
      terminalToolNames && terminalToolNames.length > 0
        ? [stepCountIs(maxSteps), ...terminalToolNames.map((toolName) => hasToolCall(toolName))]
        : stepCountIs(maxSteps);
    const agent = new ToolLoopAgent({
      instructions: buildTaskInstructions(
        instructions,
        context,
        toolContext,
        providerBuiltInTools
      ),
      model,
      providerOptions: providerOptions as any,
      stopWhen,
      tools
    });
    const messages: ModelMessage[] = [
      {
        content: prompt,
        role: "user"
      }
    ];

    if (stream) {
      return this.runStreamingAgent({
        agent,
        messages,
        runtime,
        stream
      });
    }

    const result = await agent.generate({
      messages
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

  private async runStreamingAgent({
    agent,
    messages,
    runtime,
    stream
  }: {
    agent: ToolLoopAgent<never, any, any>;
    messages: ModelMessage[];
    runtime: AiAgentExecutionRuntime;
    stream: AiAgentStreamCallbacks;
  }): Promise<{
    diagnostics: AiChatMessageDiagnostics;
    text: string;
  }> {
    const result = await agent.stream({
      messages,
      onStepFinish: (stepResult) => {
        const toolTrace = buildToolTrace([stepResult as any]);

        if (toolTrace.length > 0) {
          stream.onToolTrace?.(toolTrace);
        }
      }
    });
    let responseText = "";
    let hasSeenStep = false;

    for await (const part of result.fullStream) {
      if (part.type === "start-step") {
        if (hasSeenStep) {
          stream.onTextReset?.();
        }

        hasSeenStep = true;
        responseText = "";
        continue;
      }

      if (part.type === "text-delta") {
        responseText += part.text;
        stream.onTextDelta?.(part.text);
        continue;
      }

      if (part.type === "error") {
        throw new Error(toStreamErrorMessage(part.error));
      }
    }

    const [steps, finishReason] = await Promise.all([result.steps, result.finishReason]);
    const toolTrace = buildToolTrace(steps as any);
    const text = responseText.trim();
    const finalResponseText =
      text.length > 0 ? text : buildFallbackAssistantText(toolTrace, finishReason ?? null);

    if (finalResponseText.length === 0) {
      throw new Error("AI agent returned no assistant text.");
    }

    return {
      diagnostics: {
        finishReason: finishReason ?? null,
        modelId: steps.at(-1)?.model.modelId ?? runtime.modelId,
        stepCount: steps.length,
        toolTrace
      },
      text: finalResponseText
    };
  }

  private createLanguageModel(
    runtime: AiAgentExecutionRuntime
  ): {
    model: LanguageModel;
    providerBuiltInTools?: AiProviderBuiltInToolInfo;
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
          model: anthropic(runtime.modelId as any),
          providerBuiltInTools: buildAnthropicBuiltInTools(anthropic)
        };
      }

      case "openai-direct": {
        const openai = createOpenAI({
          apiKey: runtime.apiKey
        });

        return {
          model: openai(runtime.modelId as any),
          providerBuiltInTools: buildOpenAiBuiltInTools(openai)
        };
      }
    }
  }

  private async createToolContext(
    context: AiChatContextSummary,
    hostCommand?: AiAgentHostCommandOptions,
    workspaceToolPolicy?: AiAgentWorkspaceToolPolicy
  ): Promise<{
    readScopeDescription: string;
    skillCount: number;
    tools: ToolSet;
    workspaceMounted: boolean;
  }> {
    const workspaceRootPath = this.workspaceService.currentRootPath;

    if (!workspaceRootPath) {
      return {
        readScopeDescription: "workspace not open",
        skillCount: 0,
        tools: {},
        workspaceMounted: false
      };
    }

    const effectivePolicy = normalizeWorkspaceToolPolicy(workspaceToolPolicy);
    const readAccess = createReadAccess(context, effectivePolicy);
    const { experimental_createSkillTool, createBashTool } =
      await importEsmModule<typeof import("bash-tool")>("bash-tool");
    const mergedSkillsDirectoryPath = await prepareAgentSkillsDirectory(workspaceRootPath);
    const [workspaceFiles, skillToolkit] = await Promise.all([
      collectWorkspaceFiles(workspaceRootPath, readAccess),
      mergedSkillsDirectoryPath
        ? experimental_createSkillTool({
            destination: AGENT_SKILLS_DESTINATION,
            skillsDirectory: mergedSkillsDirectoryPath
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
      this.getIntegralWorkspaceService,
      this.hostCommandExecutor,
      hostCommand,
      effectivePolicy,
      readAccess
    );

    return {
      readScopeDescription: readAccess.description,
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
    readScopeDescription?: string;
    skillCount: number;
    workspaceMounted: boolean;
  },
  systemPrompt?: string | null,
  providerBuiltInTools?: AiProviderBuiltInToolInfo
): string {
  const lines = [
    normalizeSystemPrompt(systemPrompt, DEFAULT_AI_CHAT_SYSTEM_PROMPTS.chatPanel),
    "",
    AGENTS_INSTRUCTION_FILE_PROMPT,
    ""
  ];

  lines.push(buildWorkspaceContextInstructions(context, toolContext));
  lines.push(...buildProviderBuiltInToolInstructionLines(providerBuiltInTools));

  return lines.join("\n");
}

function buildTaskInstructions(
  instructions: string,
  context: AiChatContextSummary,
  toolContext: {
    readScopeDescription?: string;
    skillCount: number;
    workspaceMounted: boolean;
  },
  providerBuiltInTools?: AiProviderBuiltInToolInfo
): string {
  return [
    instructions.trim(),
    "",
    AGENTS_INSTRUCTION_FILE_PROMPT,
    "",
    buildWorkspaceContextInstructions(context, toolContext),
    ...buildProviderBuiltInToolInstructionLines(providerBuiltInTools)
  ]
    .filter((part) => part.trim().length > 0)
    .join("\n");
}

function buildProviderBuiltInToolInstructionLines(
  providerBuiltInTools?: AiProviderBuiltInToolInfo
): string[] {
  if (!providerBuiltInTools || providerBuiltInTools.instructions.length === 0) {
    return [];
  }

  return ["", ...providerBuiltInTools.instructions];
}

function buildWorkspaceContextInstructions(
  context: AiChatContextSummary,
  toolContext: {
    readScopeDescription?: string;
    skillCount: number;
    workspaceMounted: boolean;
  }
): string {
  const lines = [
    `workspace: ${context.workspaceRootName ?? "(not open)"}`,
    `active path: ${context.activeRelativePath ?? "(none)"}`,
    `workspace tools mounted: ${toolContext.workspaceMounted ? "yes" : "no"}`,
    `workspace read scope: ${toolContext.readScopeDescription ?? "entire workspace"}`,
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
    "Use runShellCommand only when you need a real host PowerShell command. It always asks the user for approval first, and the user may edit or reject the command.",
    "Do not tell the user that files were saved; instead describe preview changes or proposed edits."
  ];

  if (skillInstructions && skillInstructions.trim().length > 0) {
    lines.push("");
    lines.push(skillInstructions.trim());
  }

  return lines.join("\n");
}

function buildOpenAiBuiltInTools(openai: ReturnType<typeof createOpenAI>): AiProviderBuiltInToolInfo {
  return {
    instructions: [
      "Provider built-in web_search is available through OpenAI. Use it only when the user asks for current public web information or when an answer materially depends on external facts that may have changed.",
      "Do not use web_search for workspace/source-code questions unless the user explicitly asks for external web evidence."
    ],
    tools: {
      web_search: openai.tools.webSearch({
        externalWebAccess: true,
        searchContextSize: "medium"
      })
    }
  };
}

function buildAnthropicBuiltInTools(
  anthropic: ReturnType<typeof createAnthropic>
): AiProviderBuiltInToolInfo {
  return {
    instructions: [
      "Provider built-in web_search is available through Anthropic. Use it only when the user asks for current public web information or when an answer materially depends on external facts that may have changed.",
      "Do not use web_search for workspace/source-code questions unless the user explicitly asks for external web evidence."
    ],
    tools: {
      web_search: anthropic.tools.webSearch_20250305({
        maxUses: 5
      })
    }
  };
}

async function directoryExists(targetPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(targetPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function prepareAgentSkillsDirectory(workspaceRootPath: string): Promise<string | null> {
  const sourceRoots = [
    path.join(workspaceRootPath, ".codex", "skills"),
    path.join(workspaceRootPath, "Notes", ".codex", "skills"),
    ...getGlobalSkillRootPaths()
  ];
  const existingRoots: string[] = [];

  for (const sourceRoot of sourceRoots) {
    if (await directoryExists(sourceRoot)) {
      existingRoots.push(sourceRoot);
    }
  }

  if (existingRoots.length === 0) {
    return null;
  }

  const targetRoot = path.join(
    os.tmpdir(),
    "integralnotes-ai-skills",
    createHash("sha1").update(path.resolve(workspaceRootPath)).digest("hex").slice(0, 12)
  );
  const seenSkillNames = new Set<string>();
  const copiedDirectoryNames = new Set<string>();
  let copiedSkillCount = 0;

  await fs.rm(targetRoot, { force: true, recursive: true });
  await fs.mkdir(targetRoot, { recursive: true });

  for (const sourceRoot of existingRoots) {
    const entries = await fs.readdir(sourceRoot, { withFileTypes: true }).catch(() => []);

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "ja"))) {
      if (!entry.isDirectory()) {
        continue;
      }

      const sourceSkillPath = path.join(sourceRoot, entry.name);
      const skillName = await readSkillName(sourceSkillPath, entry.name);

      if (!skillName) {
        continue;
      }

      const skillKey = normalizeAiSkillNameKey(skillName);

      if (seenSkillNames.has(skillKey)) {
        continue;
      }

      seenSkillNames.add(skillKey);
      const destinationName = createUniqueSkillDirectoryName(entry.name, copiedDirectoryNames);
      await fs.cp(sourceSkillPath, path.join(targetRoot, destinationName), { recursive: true });
      copiedSkillCount += 1;
    }
  }

  return copiedSkillCount > 0 ? targetRoot : null;
}

function createUniqueSkillDirectoryName(name: string, usedNames: Set<string>): string {
  const normalizedName = name.trim().replace(/[^A-Za-z0-9._-]+/gu, "-") || "skill";
  let candidate = normalizedName;
  let suffix = 2;

  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${normalizedName}-${suffix}`;
    suffix += 1;
  }

  usedNames.add(candidate.toLowerCase());
  return candidate;
}

async function readSkillName(skillDirectoryPath: string, fallbackName: string): Promise<string | null> {
  const skillFilePath = path.join(skillDirectoryPath, "SKILL.md");
  const content = await fs.readFile(skillFilePath, "utf8").catch(() => null);

  if (content === null) {
    return null;
  }

  const frontmatterMatch = /^---\s*\n([\s\S]*?)\n---/u.exec(content);
  const frontmatter = frontmatterMatch?.[1] ?? "";
  const nameLine = frontmatter
    .split(/\r?\n/u)
    .map((line) => /^name:\s*(.*)$/u.exec(line))
    .find((match): match is RegExpExecArray => match !== null);
  const name = nameLine?.[1]?.trim().replace(/^["']|["']$/gu, "") || fallbackName;

  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(name) ? name : null;
}

async function collectWorkspaceFiles(
  workspaceRootPath: string,
  readAccess: AiAgentReadAccess
): Promise<Record<string, string>> {
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

      if (!relativePath || !readAccess.canRead(relativePath)) {
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

function normalizeWorkspaceToolPolicy(
  policy?: AiAgentWorkspaceToolPolicy
): Required<AiAgentWorkspaceToolPolicy> {
  return {
    canEditWorkspaceFiles: policy?.canEditWorkspaceFiles ?? true,
    canRunShellCommand: policy?.canRunShellCommand ?? true,
    readDirs: policy?.readDirs ?? [],
    readScope: policy?.readScope ?? "entire-workspace"
  };
}

function createReadAccess(
  context: AiChatContextSummary,
  policy: Required<AiAgentWorkspaceToolPolicy>
): AiAgentReadAccess {
  const activePath = normalizeWorkspaceAccessPath(context.activeRelativePath ?? "");
  const selectedPaths = context.selectedPaths.map(normalizeWorkspaceAccessPath).filter(Boolean);
  const readDirs = policy.readDirs.map(normalizeWorkspaceAccessPath).filter(Boolean);

  switch (policy.readScope) {
    case "current-document-only": {
      return {
        canRead: (relativePath) =>
          activePath.length > 0 && normalizeWorkspaceAccessPath(relativePath) === activePath,
        description: "current document only"
      };
    }

    case "current-document-and-selected-files": {
      const allowedPaths = new Set([activePath, ...selectedPaths].filter(Boolean));
      return {
        canRead: (relativePath) => isAllowedByPathSet(relativePath, allowedPaths),
        description: "current document and selected files"
      };
    }

    case "selected-files": {
      const allowedPaths = new Set(selectedPaths);
      return {
        canRead: (relativePath) => isAllowedByPathSet(relativePath, allowedPaths),
        description: "selected files"
      };
    }

    case "same-folder": {
      const activeDirectory = activePath.length > 0 ? path.posix.dirname(activePath) : "";
      return {
        canRead: (relativePath) => {
          const normalizedPath = normalizeWorkspaceAccessPath(relativePath);
          if (activeDirectory === ".") {
            return !normalizedPath.includes("/");
          }
          return (
            normalizedPath === activeDirectory ||
            normalizedPath.startsWith(`${activeDirectory}/`)
          );
        },
        description: "same folder as active document"
      };
    }

    case "specific-dirs": {
      return {
        canRead: (relativePath) =>
          readDirs.some((directoryPath) =>
            isPathInsideDirectory(normalizeWorkspaceAccessPath(relativePath), directoryPath)
          ),
        description:
          readDirs.length > 0 ? `specific dirs: ${readDirs.join(", ")}` : "specific dirs: none"
      };
    }

    case "entire-workspace":
    default:
      return {
        canRead: () => true,
        description: "entire workspace"
      };
  }
}

function normalizeWorkspaceAccessPath(value: string): string {
  return value
    .trim()
    .replace(/\\/gu, "/")
    .replace(/^\/+/u, "")
    .split("/")
    .filter(Boolean)
    .join("/");
}

function isAllowedByPathSet(relativePath: string, allowedPaths: ReadonlySet<string>): boolean {
  const normalizedPath = normalizeWorkspaceAccessPath(relativePath);

  for (const allowedPath of allowedPaths) {
    if (normalizedPath === allowedPath || isPathInsideDirectory(normalizedPath, allowedPath)) {
      return true;
    }
  }

  return false;
}

function isPathInsideDirectory(relativePath: string, directoryPath: string): boolean {
  return (
    directoryPath.length > 0 &&
    (relativePath === directoryPath || relativePath.startsWith(`${directoryPath}/`))
  );
}

function assertCanReadWorkspacePath(readAccess: AiAgentReadAccess, relativePath: string): void {
  if (!readAccess.canRead(relativePath)) {
    throw new Error(
      `Workspace read scope (${readAccess.description}) does not allow reading: ${relativePath}`
    );
  }
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
  getIntegralWorkspaceService?: () => IntegralWorkspaceService | null,
  hostCommandExecutor?: AiHostCommandExecutor,
  hostCommandOptions?: AiAgentHostCommandOptions,
  workspaceToolPolicy: Required<AiAgentWorkspaceToolPolicy> = normalizeWorkspaceToolPolicy(),
  readAccess: AiAgentReadAccess = {
    canRead: () => true,
    description: "entire workspace"
  }
): ToolSet {
  const tools: ToolSet = {
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
        assertCanReadWorkspacePath(readAccess, relativePath);

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
        assertCanReadWorkspacePath(readAccess, relativePath);
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
  };

  if (workspaceToolPolicy.canEditWorkspaceFiles) {
    tools.writeWorkspaceFile = tool({
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
    });
  }

  if (workspaceToolPolicy.canRunShellCommand && hostCommandExecutor) {
    tools.runShellCommand = tool({
      description:
        "Run a real PowerShell-compatible command in the user's workspace after explicit user approval. Use this when a live command is needed, such as running tests, scripts, package installers, or workspace-generating commands. The user sees and can edit or reject the command before execution. Provide a concise purpose so the user can judge the request.",
      inputSchema: z.object({
        command: z.string().min(1),
        purpose: z.string().min(1),
        timeoutSeconds: z.number().int().min(1).optional(),
        workingDirectory: z.string().optional()
      }),
      execute: async ({ command, purpose, timeoutSeconds, workingDirectory }) =>
        hostCommandExecutor.execute(
          {
            command,
            purpose,
            ...(typeof timeoutSeconds === "number" ? { timeoutSeconds } : {}),
            ...(typeof workingDirectory === "string" ? { workingDirectory } : {})
          },
          {
            shellExecutablePath: hostCommandOptions?.shellExecutablePath ?? null
          }
        )
    });
  }

  return tools;
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

  const userText = buildModelUserMessageText(message.text, message.skillInvocations ?? []);

  if (message.attachments && message.attachments.length > 0) {
    return {
      content: [
        {
          text: userText,
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
    content: userText,
    role: "user"
  };
}

function buildModelUserMessageText(
  text: string,
  skillInvocations: readonly AiChatSkillInvocation[]
): string {
  if (skillInvocations.length === 0) {
    return text;
  }

  return [
    `Explicit skills requested: ${skillInvocations.map((skill) => skill.name).join(", ")}`,
    "",
    text
  ].join("\n");
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
  if (toolName === "runShellCommand" && isRecord(output)) {
    if (output.status === "approved") {
      return typeof output.exitCode === "number" && output.exitCode === 0 ? "success" : "error";
    }

    return "error";
  }

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
  if (toolName === "runShellCommand" && isRecord(input)) {
    const command = typeof input.command === "string" ? input.command : "";
    const purpose = typeof input.purpose === "string" ? input.purpose : "";
    const workingDirectory =
      typeof input.workingDirectory === "string" && input.workingDirectory.trim().length > 0
        ? ` @ ${input.workingDirectory.trim()}`
        : "";

    return truncateTraceText(
      [purpose.trim(), `${command.trim()}${workingDirectory}`].filter(Boolean).join(" | ")
    );
  }

  if (toolName === "bash" && isRecord(input) && typeof input.command === "string") {
    return truncateTraceText(input.command);
  }

  if (toolName === "web_search") {
    if (isRecord(input) && typeof input.query === "string" && input.query.trim().length > 0) {
      return truncateTraceText(input.query.trim());
    }

    return "provider web search";
  }

  if (toolName === "skill" && isRecord(input)) {
    const skillName = ["skillName", "skill", "name", "id"]
      .map((key) => input[key])
      .find((value) => typeof value === "string" && value.trim().length > 0);

    return typeof skillName === "string" ? `skill: ${skillName.trim()}` : "skill invocation";
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

  if (toolName === "insertPythonBlock" && isRecord(input)) {
    const scriptPath = typeof input.scriptPath === "string" ? input.scriptPath : "(unknown script)";
    const functionName =
      typeof input.functionName === "string" ? input.functionName : "(unknown function)";

    return `${scriptPath}:${functionName}`;
  }

  if (toolName === "createPythonBlockDraft" && isRecord(input)) {
    const scriptPath = typeof input.scriptPath === "string" ? input.scriptPath : "(unknown script)";
    const functionName =
      typeof input.functionName === "string" ? input.functionName : "(unknown function)";

    return `${scriptPath}:${functionName}`;
  }

  if (toolName === "insertMarkdownAtCursor" && isRecord(input)) {
    const textLength = typeof input.text === "string" ? input.text.length : null;

    return textLength === null ? "markdown insertion" : `${textLength} chars`;
  }

  return summarizeUnknownValue(input);
}

function summarizeToolOutput(toolName: string, output: unknown): string {
  if (toolName === "runShellCommand" && isRecord(output)) {
    const status = typeof output.status === "string" ? output.status : "unknown";
    const exitCode =
      typeof output.exitCode === "number"
        ? `exit ${output.exitCode}`
        : output.exitCode === null
          ? "exit null"
          : "exit ?";
    const edited = output.edited === true ? "edited" : "original";
    const stdout =
      typeof output.stdout === "string" && output.stdout.trim().length > 0
        ? `stdout: ${truncateTraceText(output.stdout.trim())}`
        : null;
    const stderr =
      typeof output.stderr === "string" && output.stderr.trim().length > 0
        ? `stderr: ${truncateTraceText(output.stderr.trim())}`
        : null;
    const reason =
      typeof output.reason === "string" && output.reason.trim().length > 0
        ? `reason: ${truncateTraceText(output.reason.trim())}`
        : null;

    return [status, exitCode, edited, stdout, stderr, reason].filter(isDefined).join(" | ");
  }

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

  if (toolName === "web_search") {
    return summarizeProviderWebSearchOutput(output);
  }

  if (toolName === "skill") {
    return summarizeSkillToolOutput(output);
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

  if (
    toolName === "insertPythonBlock" &&
    isRecord(output) &&
    typeof output.scriptPath === "string" &&
    typeof output.functionName === "string"
  ) {
    const summary =
      typeof output.summary === "string" && output.summary.trim().length > 0
        ? ` | ${truncateTraceText(output.summary.trim())}`
        : "";

    return `${output.scriptPath}:${output.functionName}${summary}`;
  }

  if (
    toolName === "insertMarkdownAtCursor" &&
    isRecord(output) &&
    typeof output.text === "string"
  ) {
    return JSON.stringify({
      summary: typeof output.summary === "string" ? output.summary : "",
      text: output.text
    });
  }

  if (
    toolName === "createPythonBlockDraft" &&
    isRecord(output) &&
    typeof output.markdown === "string"
  ) {
    return `${output.markdown.length} chars`;
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

function summarizeSkillToolOutput(output: unknown): string {
  if (isRecord(output)) {
    const skillName = ["skillName", "skill", "name", "id"]
      .map((key) => output[key])
      .find((value) => typeof value === "string" && value.trim().length > 0);
    const summary = ["summary", "description", "message"]
      .map((key) => output[key])
      .find((value) => typeof value === "string" && value.trim().length > 0);

    return [skillName, summary]
      .filter((value): value is string => typeof value === "string")
      .map((value) => truncateTraceText(value))
      .join(" | ") || summarizeUnknownValue(output);
  }

  return summarizeUnknownValue(output);
}

function summarizeProviderWebSearchOutput(output: unknown): string {
  if (Array.isArray(output)) {
    const sources = output
      .map((item) => {
        if (!isRecord(item)) {
          return null;
        }

        const title = typeof item.title === "string" ? item.title.trim() : "";
        const url = typeof item.url === "string" ? item.url.trim() : "";

        return [title, url].filter(Boolean).join(" ");
      })
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .slice(0, 3);

    return truncateTraceText(
      [`${output.length} search result(s)`, ...sources].filter(Boolean).join(" | ")
    );
  }

  if (isRecord(output)) {
    const action = isRecord(output.action)
      ? [
          typeof output.action.type === "string" ? output.action.type : null,
          typeof output.action.query === "string" ? output.action.query : null,
          typeof output.action.url === "string" ? output.action.url : null
        ]
          .filter(isDefined)
          .join(": ")
      : null;
    const sources = Array.isArray(output.sources)
      ? output.sources
          .map((source) =>
            isRecord(source) && typeof source.url === "string" ? source.url.trim() : null
          )
          .filter((value): value is string => typeof value === "string" && value.length > 0)
          .slice(0, 3)
      : [];

    const summary = [action, ...sources].filter(isDefined).join(" | ");

    return summary.length > 0 ? truncateTraceText(summary) : summarizeUnknownValue(output);
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

function toStreamErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
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
