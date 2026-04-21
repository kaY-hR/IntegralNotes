import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { ToolLoopAgent, createGateway, stepCountIs, type LanguageModel, type ToolSet } from "ai";
import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  AiChatContextSummary,
  AiChatMessage,
  AiChatMessageDiagnostics,
  AiChatToolTraceEntry
} from "../shared/aiChat";
import { WorkspaceService } from "./workspaceService";

const AGENT_SKILLS_DESTINATION = ".integral-ai-skills";
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
  constructor(private readonly workspaceService: WorkspaceService) {}

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
      messages: history.map(toModelMessage)
    });
    const text = result.text.trim();

    if (text.length === 0) {
      throw new Error("AI agent returned no assistant text.");
    }

    return {
      diagnostics: {
        finishReason: result.finishReason ?? null,
        modelId: result.steps.at(-1)?.model.modelId ?? runtime.modelId,
        stepCount: result.steps.length,
        toolTrace: buildToolTrace(result.steps)
      },
      text
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

    const [{ experimental_createSkillTool, createBashTool }, { Bash, OverlayFs }] = await Promise.all([
      importEsmModule<typeof import("bash-tool")>("bash-tool"),
      importEsmModule<typeof import("just-bash")>("just-bash")
    ]);
    const overlay = new OverlayFs({
      mountPoint: WORKSPACE_MOUNT_PATH,
      root: workspaceRootPath
    });
    const bash = new Bash({
      cwd: overlay.getMountPoint(),
      fs: overlay
    });
    const skillsDirectoryPath = path.join(workspaceRootPath, ".codex", "skills");
    const skillToolkit = (await directoryExists(skillsDirectoryPath))
      ? await experimental_createSkillTool({
          destination: AGENT_SKILLS_DESTINATION,
          skillsDirectory: skillsDirectoryPath
        })
      : null;
    const bashToolkit = await createBashTool({
      destination: WORKSPACE_MOUNT_PATH,
      extraInstructions: buildBashToolInstructions(skillToolkit?.instructions),
      files: skillToolkit?.files,
      sandbox: bash
    });

    return {
      skillCount: skillToolkit?.skills.length ?? 0,
      tools: skillToolkit ? { skill: skillToolkit.skill, ...bashToolkit.tools } : bashToolkit.tools,
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
    "Do not claim that real workspace files were saved unless the app explicitly tells you persistence happened.",
    ""
  ];

  lines.push(`workspace: ${context.workspaceRootName ?? "(not open)"}`);
  lines.push(`active path: ${context.activeRelativePath ?? "(none)"}`);
  lines.push(`workspace tools mounted: ${toolContext.workspaceMounted ? "yes" : "no"}`);
  lines.push(`skills available: ${toolContext.skillCount}`);

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
    "Any writes done through bash/writeFile are overlay-only preview changes. They do not persist to the real workspace yet.",
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

async function importEsmModule<T>(specifier: string): Promise<T> {
  const importer = new Function("specifier", "return import(specifier);") as (
    nextSpecifier: string
  ) => Promise<T>;

  return importer(specifier);
}

function toModelMessage(message: AiChatMessage): {
  content: string;
  role: "assistant" | "user";
} {
  return {
    content: message.text,
    role: message.role
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

  return "success";
}

function summarizeToolInput(toolName: string, input: unknown): string {
  if (toolName === "bash" && isRecord(input) && typeof input.command === "string") {
    return truncateTraceText(input.command);
  }

  if ((toolName === "readFile" || toolName === "writeFile") && isRecord(input)) {
    const pathValue = typeof input.path === "string" ? input.path : "(unknown path)";

    if (toolName === "writeFile") {
      const contentLength =
        typeof input.content === "string" || Buffer.isBuffer(input.content)
          ? input.content.length
          : null;

      return contentLength === null ? pathValue : `${pathValue} (${contentLength} chars)`;
    }

    return pathValue;
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

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
