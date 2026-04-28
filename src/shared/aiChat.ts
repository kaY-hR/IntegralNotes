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

export interface AiChatMessage {
  attachments?: AiChatImageAttachment[];
  createdAt: string;
  diagnostics?: AiChatMessageDiagnostics | null;
  id: string;
  role: AiChatRole;
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
    "The open Markdown document in the prompt is the current editor state and may include unsaved changes; treat it as authoritative for the active note.",
    "Help the user converge on a Python analysis block. Ask a concise follow-up question if the request is underspecified.",
    "When the block is ready, implement it as a real workspace Python file by using writeWorkspaceFile.",
    "Use the implement-integral-block skill rules below as the system contract for the Python file.",
    "Prefer a new file under scripts/ai_blocks/ with a descriptive snake_case name unless the user asks for a specific path.",
    "Do not modify the active note. The app will insert the itg-notes block after you return.",
    "The script must expose a top-level @integral_block-decorated callable, normally def main(inputs, outputs, params) -> None.",
    "Do not group files with different roles or user intent into one .idts output just for convenience.",
    "Use .idts outputs only when multiple files of the same nature are generated as one set, such as per-input files or repeated artifacts with the same format and role.",
    "Make user-facing renderables their own output slots. This includes HTML reports, plots, images, SVG/PNG/JPEG/WebP files, readable Markdown/text reports, and other files the user is meant to inspect directly.",
    "Set auto_insert_to_work_note=True for user-facing renderable output slots that should appear under the block.",
    "Keep CSV/TSV/JSON and other machine-readable or intermediate outputs in separate output slots, with auto_insert_to_work_note omitted or false unless the user explicitly wants that file as the visible result.",
    "After saving the script and only when ready to insert, call the insertPythonBlock tool with scriptPath, functionName, and a short summary.",
    "Do not call insertPythonBlock before writeWorkspaceFile has saved the Python file.",
    "Do not return JSON as a substitute for insertPythonBlock."
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
  skillsDirectoryPath: string | null;
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
  sessionId?: string | null;
  sourceNotePath: string;
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

export interface SubmitInlinePythonBlockRequest {
  afterText: string;
  beforeText: string;
  context: AiChatContextSummary;
  documentMarkdown: string;
  history: AiChatMessage[];
  insertionPosition: number;
  prompt: string;
  sessionId?: string | null;
  sourceNotePath: string;
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
