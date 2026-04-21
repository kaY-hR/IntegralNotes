export type AiChatRole = "assistant" | "user";

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
  createdAt: string;
  diagnostics?: AiChatMessageDiagnostics | null;
  id: string;
  role: AiChatRole;
  text: string;
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

export interface SaveAiChatSettingsRequest {
  apiKey?: string;
  modelId: string | null;
}

export interface SubmitAiChatRequest {
  context: AiChatContextSummary;
  history: AiChatMessage[];
  prompt: string;
}

export interface SubmitAiChatResult {
  assistantMessage: AiChatMessage;
}
