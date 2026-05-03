import type { WorkspaceSnapshot } from "./workspace";

export type AiChatRole = "assistant" | "tool" | "user";

export interface AiChatImageAttachment {
  dataUrl: string;
  id: string;
  mediaType: string;
  name: string;
  sourcePath: string;
}

export interface AiChatToolTraceEntry {
  inputSummary: string;
  outputSummary: string;
  status: "error" | "success";
  stepNumber: number;
  toolName: string;
}

export interface AiChatMessageDiagnostics {
  finishReason: string | null;
  modelId: string | null;
  stepCount: number;
  toolTrace: AiChatToolTraceEntry[];
}

export interface AiChatSkillSummary {
  description: string;
  name: string;
  relativePath: string;
}

export interface AiChatSkillInvocation {
  description?: string;
  name: string;
  relativePath?: string;
}

export interface AiChatMessage {
  attachments?: AiChatImageAttachment[];
  createdAt: string;
  diagnostics?: AiChatMessageDiagnostics | null;
  id: string;
  role: AiChatRole;
  skillInvocations?: AiChatSkillInvocation[];
  text: string;
  toolTraceEntry?: AiChatToolTraceEntry | null;
}

export interface AiChatContextSummary {
  activeDocumentExcerpt: string | null;
  activeDocumentKind: string | null;
  activeDocumentName: string | null;
  activeRelativePath: string | null;
  selectedPaths: string[];
  workspaceRootName: string | null;
}

export interface AiChatModelOption {
  contextWindow: number | null;
  id: string;
  label: string;
  provider: string | null;
}

export interface AiChatSystemPrompts {
  chatPanel: string;
  inlineInsertion: string;
  inlinePythonBlock: string;
  promptlessContinuation: string;
}

export type InlineActionReadScope =
  | "current-document-only"
  | "current-document-and-selected-files"
  | "selected-files"
  | "same-folder"
  | "specific-dirs"
  | "entire-workspace";

export interface InlineActionDefinition {
  canAnswerOnly: boolean;
  canCreatePythonBlockDraft: boolean;
  canEditWorkspaceFiles: boolean;
  canInsertMarkdown: boolean;
  canRunShellCommand: boolean;
  description: string;
  name: string;
  promptRequired: boolean;
  readDirs: string[];
  readScope: InlineActionReadScope;
  relativePath: string;
  systemPrompt: string;
}

export interface SaveInlineActionRequest {
  canAnswerOnly: boolean;
  canCreatePythonBlockDraft: boolean;
  canEditWorkspaceFiles: boolean;
  canInsertMarkdown: boolean;
  canRunShellCommand: boolean;
  description: string;
  name: string;
  promptRequired: boolean;
  readDirs?: string[];
  readScope: InlineActionReadScope;
  systemPrompt: string;
}

export const DEFAULT_AI_CHAT_SYSTEM_PROMPTS: AiChatSystemPrompts = {
  chatPanel: [
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
    "If the user wants a real CLI command to run, use runShellCommand with command and purpose. The app will show an approval dialog before execution.",
    "Do not claim that real workspace files were saved unless the app explicitly tells you persistence happened."
  ].join("\n"),
  inlineInsertion: [
    "You are chatting inside the IntegralNotes inline Markdown insertion popup.",
    "This popup has the same workspace inspection and persistence tools as the main AI Chat panel, plus insertMarkdownAtCursor for committing the inline insertion.",
    "Use workspace tools when you need file evidence instead of guessing. Tool calls are allowed and expected when the request depends on workspace files.",
    "If you discover or receive an image path and need to inspect the image itself, use readWorkspaceImage.",
    "If Markdown or HTML layout, rendered charts, screenshots, or embedded visual content matter, use renderWorkspaceDocument. Do not judge HTML or image contents from filenames or source text alone.",
    "When reading Markdown and you find a linked or embedded .html/.htm file whose visual content matters, render that HTML path with renderWorkspaceDocument.",
    "If the user wants real workspace edits outside the insertion, use writeWorkspaceFile. bash/writeFile remains preview-only.",
    "If a real CLI command is needed, use runShellCommand with command and purpose. The app will ask the user for approval.",
    "The open Markdown document in the prompt is the current editor state and may include unsaved changes; treat it as authoritative for the active note.",
    "The user is usually asking for text to insert at the editor cursor, not for a general chat answer.",
    "The app provides Markdown before and after the cursor. The cursor is exactly between those two sections.",
    "Use the surrounding Markdown, the cursor position, and the user's latest request to infer the intended inserted content.",
    "If enough information is available, call insertMarkdownAtCursor with the exact Markdown text to insert.",
    "If the request is underspecified, ask one concise follow-up question and do not call insertMarkdownAtCursor.",
    "Do not answer with the inserted text as plain assistant prose. The insertion must be delivered through insertMarkdownAtCursor.",
    "Do not include greetings, explanations, labels, surrounding quotes, or code fences unless they are literally part of the inserted Markdown.",
    "Preserve the note's language, tone, indentation, list structure, heading level, table style, and surrounding whitespace."
  ].join("\n"),
  inlinePythonBlock: [
    "You are chatting inside the IntegralNotes inline Python block popup.",
    "This popup has the same workspace inspection and persistence tools as the main AI Chat panel, plus insertPythonBlock for committing the inline block insertion.",
    "Use workspace tools when you need file evidence instead of guessing. Tool calls are allowed and expected when the request depends on workspace files.",
    "If you discover or receive an image path and need to inspect the image itself, use readWorkspaceImage.",
    "If Markdown or HTML layout, rendered charts, screenshots, or embedded visual content matter, use renderWorkspaceDocument. Do not judge HTML or image contents from filenames or source text alone.",
    "When reading Markdown and you find a linked or embedded .html/.htm file whose visual content matters, render that HTML path with renderWorkspaceDocument.",
    "If a real CLI command is needed, use runShellCommand with command and purpose. The app will ask the user for approval.",
    "The open Markdown document in the prompt is the current editor state and may include unsaved changes; treat it as authoritative for the active note.",
    "Help the user converge on a Python analysis block. Ask a concise follow-up question if the request is underspecified.",
    "When the block is ready, implement it as a real workspace Python file by using writeWorkspaceFile.",
    "Use the implement-integral-block skill rules below as the system contract for the Python file.",
    "The integral SDK lives under the hidden .integral-sdk/python/ import root and is system-managed. Do not create or modify files under .integral-sdk when implementing a block.",
    "Before creating a new script, inspect existing workspace scripts such as scripts/**/*.py; if a suitable @integral_block callable already exists, prefer reusing or minimally updating it.",
    "Prefer a new file under scripts/ai_blocks/ with a descriptive snake_case name unless the user asks for a specific path.",
    "Do not modify the active note. The app will insert the itg-notes block after you return.",
    "The script must expose a top-level @integral_block-decorated callable, normally def main(inputs, outputs, params) -> None.",
    "Define user-editable Python block parameters only in the decorator with params={...}, using a Python literal JSON Schema subset.",
    "The supported params schema is root type object with properties whose type is string, number, integer, or boolean. Supported UI metadata: title, description, default, enum, minimum, maximum.",
    "Do not rely on hand-written YAML params that are not declared in the decorator. The app treats the decorator schema as the source of truth and removes schema-external params.",
    "For an input slot that should accept a .idts dataset, always declare extensions=[\".idts\"] in addition to any datatype. .idts is a bundle representation, not the datatype itself, and the input picker uses extensions for dataset candidates.",
    "Do not group files with different roles or user intent into one .idts output just for convenience.",
    "Use .idts outputs only when multiple files of the same nature are generated as one set, such as per-input files or repeated artifacts with the same datatype and role.",
    "When writing to a .idts output, treat outputs[slotName] as a directory path and create the member files inside that directory. Do not create the .idts manifest yourself.",
    "Use slot datatype as the semantic I/O compatibility label between analysis blocks. Prefer namespaced datatype values such as {user-id}/peak-table when the app prompt provides a user ID.",
    "Make user-facing renderables their own output slots. This includes HTML reports, plots, images, SVG/PNG/JPEG/WebP files, readable Markdown/text reports, and other files the user is meant to inspect directly.",
    "Set auto_insert_to_work_note=True for user-facing renderable output slots that should appear under the block.",
    "Keep CSV/TSV/JSON and other machine-readable or intermediate outputs in separate output slots, with auto_insert_to_work_note omitted or false unless the user explicitly wants that file as the visible result.",
    "After saving the script and only when ready to insert, call the insertPythonBlock tool with scriptPath, functionName, and a short summary.",
    "Do not call insertPythonBlock before writeWorkspaceFile has saved the Python file.",
    "Do not return JSON as a substitute for insertPythonBlock."
  ].join("\n"),
  promptlessContinuation: [
    "You are running inside the IntegralNotes @@ promptless continuation trigger.",
    "The user did not provide a prompt. Infer the next useful content from the open Markdown document, the cursor context, selected workspace paths, and workspace evidence when needed.",
    "The open Markdown document in the prompt is the current editor state and may include unsaved changes; treat it as authoritative for the active note.",
    "Use workspace tools when you need file evidence instead of guessing.",
    "If you discover or receive an image path and need to inspect the image itself, use readWorkspaceImage.",
    "If Markdown or HTML layout, rendered charts, screenshots, or embedded visual content matter, use renderWorkspaceDocument.",
    "If a real CLI command is needed, use runShellCommand with command and purpose. The app will ask the user for approval.",
    "Continue the note in its existing language, tone, heading level, indentation, list structure, table style, and surrounding whitespace.",
    "The continuation may be prose, bullet points, a Markdown table, an itg-notes block, or a Python analysis block implementation when that is the natural next step.",
    "Choose exactly one commit path.",
    "For normal Markdown continuation, call insertMarkdownAtCursor with exactly the Markdown that belongs at the cursor.",
    "For a Python analysis block, first save a real workspace Python file with writeWorkspaceFile, then call insertPythonBlock with the saved scriptPath and functionName.",
    "Do not ask follow-up questions in @@ mode. If uncertain, make a conservative continuation that fits the surrounding note.",
    "Do not answer with the inserted text as plain assistant prose. The insertion must be delivered through insertMarkdownAtCursor or insertPythonBlock.",
    "Do not include greetings, explanations, labels, surrounding quotes, or code fences unless they are literally part of the inserted Markdown or Python block content."
  ].join("\n")
};

export interface AiChatStatus {
  apiKeyConfigured: boolean;
  runtimeAuthConfigured: boolean;
  availableModels: AiChatModelOption[];
  catalogRefreshedAt: string | null;
  defaultSystemPrompts: AiChatSystemPrompts;
  implementationMode: "direct" | "gateway" | "stub";
  mcpEnabled: boolean;
  modelCatalogSource: "fallback" | "live";
  notes: string[];
  providerLabel: string;
  selectedModelId: string | null;
  availableSkills: AiChatSkillSummary[];
  skillsDirectoryPath: string | null;
  shellExecutablePath: string | null;
  systemPrompts: AiChatSystemPrompts;
  workspaceRootPath: string | null;
}

export interface AiChatSessionSummary {
  createdAt: string;
  id: string;
  lastMessageText: string | null;
  messageCount: number;
  title: string;
  updatedAt: string;
  workspaceRootName: string | null;
  workspaceRootPath: string | null;
}

export interface AiChatSession extends AiChatSessionSummary {
  messages: AiChatMessage[];
}

export interface AiChatHistorySnapshot {
  activeSession: AiChatSession;
  activeSessionId: string;
  sessions: AiChatSessionSummary[];
}

export interface CreateAiChatSessionRequest {
  context: AiChatContextSummary;
}

export interface SaveAiChatSettingsRequest {
  apiKey?: string;
  modelId: string | null;
  shellExecutablePath?: string | null;
  systemPrompts?: Partial<AiChatSystemPrompts>;
}

export interface SaveAiChatSessionRequest {
  context: AiChatContextSummary;
  messages: AiChatMessage[];
  sessionId: string;
}

export interface SubmitAiChatRequest {
  context: AiChatContextSummary;
  history: AiChatMessage[];
  prompt: string;
  requestedSkills?: AiChatSkillInvocation[];
  streamId?: string | null;
}

export interface SubmitAiChatResult {
  messages: AiChatMessage[];
  userMessage?: AiChatMessage;
}

export interface SubmitInlineAiInsertionRequest {
  afterText: string;
  beforeText: string;
  context: AiChatContextSummary;
  documentMarkdown: string;
  history: AiChatMessage[];
  insertionPosition: number;
  prompt: string;
  requestedSkills?: AiChatSkillInvocation[];
  sessionId?: string | null;
  sourceNotePath: string;
  streamId?: string | null;
}

export interface InlineAiTextInsertion {
  summary?: string;
  text: string;
}

export interface SubmitInlineAiInsertionResult {
  insertion: InlineAiTextInsertion | null;
  messages: AiChatMessage[];
  sessionId: string;
  text?: string;
  userMessage: AiChatMessage;
}

export interface SubmitInlineActionRequest {
  actionName: string;
  afterText: string;
  beforeText: string;
  context: AiChatContextSummary;
  documentMarkdown: string;
  history: AiChatMessage[];
  insertionPosition: number;
  prompt: string;
  requestedSkills?: AiChatSkillInvocation[];
  sessionId?: string | null;
  sourceNotePath: string;
  streamId?: string | null;
}

export interface SubmitInlineActionResult {
  action: InlineActionDefinition;
  insertion: InlineAiTextInsertion | null;
  messages: AiChatMessage[];
  sessionId: string;
  text?: string;
  userMessage: AiChatMessage;
}

export interface SubmitInlinePythonBlockRequest {
  afterText: string;
  beforeText: string;
  context: AiChatContextSummary;
  documentMarkdown: string;
  history: AiChatMessage[];
  insertionPosition: number;
  prompt: string;
  requestedSkills?: AiChatSkillInvocation[];
  sessionId?: string | null;
  sourceNotePath: string;
  streamId?: string | null;
}

export interface InlinePythonBlockInsertion {
  functionName: string;
  scriptPath: string;
  summary?: string;
}

export interface SubmitInlinePythonBlockResult {
  assistantText?: string;
  functionName?: string;
  insertion: InlinePythonBlockInsertion | null;
  messages: AiChatMessage[];
  scriptPath?: string;
  sessionId: string;
  userMessage: AiChatMessage;
}

export interface SubmitPromptlessContinuationRequest {
  afterText: string;
  beforeText: string;
  context: AiChatContextSummary;
  documentMarkdown: string;
  history: AiChatMessage[];
  insertionPosition: number;
  sessionId?: string | null;
  sourceNotePath: string;
  streamId?: string | null;
}

export type PromptlessContinuationInsertion =
  | {
      kind: "markdown";
      markdown: InlineAiTextInsertion;
    }
  | {
      kind: "python-block";
      pythonBlock: InlinePythonBlockInsertion;
    };

export interface SubmitPromptlessContinuationResult {
  assistantText?: string;
  insertion: PromptlessContinuationInsertion | null;
  messages: AiChatMessage[];
  sessionId: string;
  userMessage: AiChatMessage;
}

export interface AiHostCommandWarning {
  code: string;
  message: string;
}

export interface AiHostCommandApprovalRequest {
  command: string;
  createdAt: string;
  effectiveTimeoutSeconds: number;
  id: string;
  purpose: string;
  requestedTimeoutSeconds: number | null;
  shellExecutablePath: string;
  warnings: AiHostCommandWarning[];
  workingDirectory: string;
  workspaceRootPath: string;
}

export interface AiHostCommandApprovalResponse {
  command?: string;
  decision: "approved" | "rejected";
  id: string;
  reason?: string;
}

export interface AiHostCommandExecutionUpdate {
  chunk?: string;
  durationMs?: number;
  exitCode?: number | null;
  id: string;
  message?: string;
  stream?: "stderr" | "stdout";
  type: "cancelled" | "failed" | "finished" | "started" | "stderr" | "stdout" | "timeout";
}

export interface AiHostCommandWorkspaceSyncedEvent {
  id: string;
  message: string;
  snapshot: WorkspaceSnapshot | null;
}

export interface AiHostCommandToolRequest {
  command: string;
  purpose: string;
  timeoutSeconds?: number;
  workingDirectory?: string;
}

export type AiHostCommandToolResultStatus =
  | "approved"
  | "cancelled"
  | "failed"
  | "rejected"
  | "timeout";

export interface AiHostCommandToolResult {
  durationMs?: number;
  edited: boolean;
  editedCommand?: string;
  executedCommand?: string;
  exitCode: number | null;
  originalCommand: string;
  purpose: string;
  reason?: string;
  shellExecutablePath?: string;
  status: AiHostCommandToolResultStatus;
  stderr: string;
  stderrTruncated?: boolean;
  stdout: string;
  stdoutTruncated?: boolean;
  timeoutSeconds?: number;
  warningCodes?: string[];
  workingDirectory?: string;
  workspaceSyncError?: string;
}

export type AiChatStreamEventType =
  | "error"
  | "finished"
  | "started"
  | "text-delta"
  | "text-reset"
  | "tool-trace";

export interface AiChatStreamEvent {
  createdAt?: string;
  id: string;
  message?: string;
  textDelta?: string;
  toolTrace?: AiChatToolTraceEntry[];
  type: AiChatStreamEventType;
}
