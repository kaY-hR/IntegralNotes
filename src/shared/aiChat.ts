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

export interface AiChatStatus {
  apiKeyConfigured: boolean;
  runtimeAuthConfigured: boolean;
  availableModels: AiChatModelOption[];
  catalogRefreshedAt: string | null;
  implementationMode: "direct" | "gateway" | "stub";
  mcpEnabled: boolean;
  modelCatalogSource: "fallback" | "live";
  notes: string[];
  providerLabel: string;
  selectedModelId: string | null;
  skillsDirectoryPath: string | null;
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
  prompt: string;
}

export interface SubmitInlineAiInsertionResult {
  text: string;
}

export interface SubmitInlinePythonBlockRequest {
  afterText: string;
  beforeText: string;
  context: AiChatContextSummary;
  prompt: string;
  sourceNotePath: string;
}

export interface SubmitInlinePythonBlockResult {
  assistantText: string;
  functionName: string;
  scriptPath: string;
}
