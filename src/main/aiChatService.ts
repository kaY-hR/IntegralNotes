import { safeStorage } from "electron";
import { tool, type ToolSet } from "ai";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import {
  DEFAULT_AI_CHAT_SYSTEM_PROMPTS,
  type AiChatContextSummary,
  type AiChatHistorySnapshot,
  type InlineAiTextInsertion,
  type AiChatImageAttachment,
  type AiChatModelOption,
  type AiChatMessage,
  type AiChatMessageDiagnostics,
  type AiChatSession,
  type AiChatSessionSummary,
  type AiChatStatus,
  type AiChatSystemPrompts,
  type AiChatToolTraceEntry,
  type InlinePythonBlockInsertion,
  type CreateAiChatSessionRequest,
  type SaveAiChatSettingsRequest,
  type SaveAiChatSessionRequest,
  type SubmitAiChatRequest,
  type SubmitAiChatResult,
  type SubmitInlineAiInsertionRequest,
  type SubmitInlineAiInsertionResult,
  type SubmitInlinePythonBlockRequest,
  type SubmitInlinePythonBlockResult
} from "../shared/aiChat";
import { AiAgentService, type AiAgentExecutionRuntime } from "./aiAgentService";
import { WorkspaceService } from "./workspaceService";

interface PersistedAiChatSettings {
  apiKeyCiphertext?: string;
  apiKeyPlaintext?: string;
  selectedModelId?: string | null;
  systemPrompts?: Partial<AiChatSystemPrompts>;
}

interface PersistedAiChatHistoryFile {
  activeSessionId: string | null;
  sessions: PersistedAiChatSession[];
  version: 1;
}

interface PersistedAiChatSession {
  createdAt: string;
  id: string;
  messages: AiChatMessage[];
  title: string;
  updatedAt: string;
  workspaceRootName: string | null;
  workspaceRootPath: string | null;
}

interface ModelCatalog {
  models: AiChatModelOption[];
  refreshedAt: string;
  source: "fallback" | "live";
}

type GatewayAuthSource =
  | "gateway-env"
  | "gateway-workspace-env"
  | "gateway-workspace-env-local"
  | "oidc-env"
  | "saved"
  | "unset";
type DirectProvider = "anthropic" | "openai";
type WorkspaceSecretSource = "process-env" | "unset" | "workspace-env" | "workspace-env-local";

interface ResolvedDirectProviderRuntime {
  apiKey: string;
  modelId: string;
  provider: DirectProvider;
  source: WorkspaceSecretSource;
}

type ResolvedAiRuntime =
  | {
      gatewayAuth: {
        source: GatewayAuthSource;
        token: string;
      };
      mode: "gateway";
      notes: string[];
      providerLabel: string;
      runtime: AiAgentExecutionRuntime;
    }
  | {
      directProvider: ResolvedDirectProviderRuntime;
      mode: "direct";
      notes: string[];
      providerLabel: string;
      runtime: AiAgentExecutionRuntime;
    }
  | {
      mode: "stub";
      notes: string[];
      providerLabel: string;
    };

const AI_GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";
const IMAGE_ATTACHMENT_EXTENSIONS = new Set([".bmp", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);
const MAX_PERSISTED_CHAT_SESSIONS = 50;
const MAX_IMAGE_ATTACHMENT_FILE_BYTES = 8_000_000;
const MAX_INLINE_AI_CONTEXT_CHARS = 6_000;
const MAX_INLINE_AI_DOCUMENT_CHARS = 30_000;
const TOOL_LOOP_INLINE_INSERTION_MAX_STEPS = 8;
const TOOL_LOOP_BLOCK_IMPLEMENTATION_MAX_STEPS = 8;
const WORKSPACE_ENV_FILENAMES = [".env.local", ".env"] as const;
const FALLBACK_MODELS: AiChatModelOption[] = [
  {
    contextWindow: 400_000,
    id: "openai/gpt-5.4",
    label: "GPT-5.4",
    provider: "openai"
  },
  {
    contextWindow: 1_000_000,
    id: "anthropic/claude-sonnet-4.6",
    label: "Claude Sonnet 4.6",
    provider: "anthropic"
  },
  {
    contextWindow: 1_000_000,
    id: "google/gemini-3-flash",
    label: "Gemini 3 Flash",
    provider: "google"
  }
];
const MODEL_EXCLUSION_TOKENS = [
  "audio",
  "dall-e",
  "embed",
  "embedding",
  "image",
  "imagen",
  "moderation",
  "omni-moderation",
  "rerank",
  "speech",
  "transcrib",
  "tts",
  "veo",
  "video"
];
const PREFERRED_MODEL_IDS = new Map(
  ["openai/gpt-5.4", "anthropic/claude-sonnet-4.6", "google/gemini-3-flash"].map(
    (modelId, index) => [modelId, index] as const
  )
);

export class AiChatService {
  private modelCatalogCache: ModelCatalog | null = null;

  constructor(
    private readonly aiAgentService: AiAgentService,
    private readonly workspaceService: WorkspaceService,
    private readonly settingsFilePath: string,
    private readonly historyFilePath: string
  ) {}

  async getStatus(): Promise<AiChatStatus> {
    const workspaceRootPath = this.workspaceService.currentRootPath ?? null;
    const [catalog, settings] = await Promise.all([
      this.getModelCatalog(false),
      this.readPersistedSettings()
    ]);
    const selectedModelId = selectValidModelId(settings.selectedModelId ?? null, catalog.models);
    const systemPrompts = resolveAiChatSystemPrompts(settings);
    const [gatewayAuth, runtimeSelection, byokNotes] = await Promise.all([
      resolveGatewayAuth(settings, workspaceRootPath),
      selectedModelId
        ? this.resolveRuntimeSelection({
            modelId: selectedModelId,
            settings,
            workspaceRootPath
          })
        : Promise.resolve<ResolvedAiRuntime>({
            mode: "stub",
            notes: ["モデルが未選択のため、runtime はまだ決まっていません。"],
            providerLabel: "Runtime not selected"
          }),
      buildByokStatusNotes(workspaceRootPath)
    ]);

    return {
      apiKeyConfigured: gatewayAuth.token.length > 0,
      runtimeAuthConfigured: runtimeSelection.mode !== "stub",
      availableModels: catalog.models,
      catalogRefreshedAt: catalog.refreshedAt,
      defaultSystemPrompts: DEFAULT_AI_CHAT_SYSTEM_PROMPTS,
      implementationMode: runtimeSelection.mode,
      mcpEnabled: false,
      modelCatalogSource: catalog.source,
      notes: [
        "Activity Bar から FlexLayout tab を開く UI は接続済みです。",
        "AI Gateway のモデル一覧は live fetch を試み、失敗時は fallback を使います。",
        "MCP client registry はまだ未実装です。現時点では add / enable する UI はありません。",
        describeGatewayAuthSource(gatewayAuth.source),
        ...runtimeSelection.notes,
        ...byokNotes
      ],
      providerLabel: runtimeSelection.providerLabel,
      selectedModelId,
      skillsDirectoryPath:
        workspaceRootPath === null ? null : path.join(workspaceRootPath, ".codex", "skills"),
      systemPrompts,
      workspaceRootPath
    };
  }

  async saveSettings(request: SaveAiChatSettingsRequest): Promise<AiChatStatus> {
    const currentSettings = await this.readPersistedSettings();
    const nextSettings: PersistedAiChatSettings = {
      ...currentSettings,
      selectedModelId: request.modelId,
      systemPrompts:
        request.systemPrompts === undefined
          ? resolveAiChatSystemPrompts(currentSettings)
          : normalizeAiChatSystemPrompts(request.systemPrompts)
    };

    if (typeof request.apiKey === "string") {
      applyPersistedApiKey(nextSettings, request.apiKey.trim());
    }

    await this.writePersistedSettings(nextSettings);
    return this.getStatus();
  }

  async clearApiKey(): Promise<AiChatStatus> {
    const currentSettings = await this.readPersistedSettings();
    applyPersistedApiKey(currentSettings, "");
    await this.writePersistedSettings(currentSettings);
    return this.getStatus();
  }

  async refreshModels(): Promise<AiChatStatus> {
    await this.getModelCatalog(true);
    return this.getStatus();
  }

  async getHistory(): Promise<AiChatHistorySnapshot> {
    const history = await this.readPersistedHistory();
    const ensuredHistory = ensurePersistedHistoryHasActiveSession(
      history,
      this.workspaceService.currentRootPath ?? null
    );

    if (ensuredHistory !== history) {
      await this.writePersistedHistory(ensuredHistory);
    }

    return buildHistorySnapshot(ensuredHistory);
  }

  async createSession(request: CreateAiChatSessionRequest): Promise<AiChatHistorySnapshot> {
    const history = await this.readPersistedHistory();
    const now = new Date().toISOString();
    const session = createPersistedChatSession({
      context: request.context,
      createdAt: now,
      messages: [],
      workspaceRootPath: this.workspaceService.currentRootPath ?? null
    });

    const nextHistory = normalizePersistedHistory({
      activeSessionId: session.id,
      sessions: [session, ...history.sessions],
      version: 1
    });

    await this.writePersistedHistory(nextHistory);
    return buildHistorySnapshot(nextHistory);
  }

  async saveSession(request: SaveAiChatSessionRequest): Promise<AiChatHistorySnapshot> {
    const history = await this.readPersistedHistory();
    const now = new Date().toISOString();
    const normalizedMessages = request.messages.map(normalizeAiChatMessageForPersistence).filter(isDefined);
    const existingSession = history.sessions.find((session) => session.id === request.sessionId);
    const nextSession: PersistedAiChatSession = existingSession
      ? {
          ...existingSession,
          messages: normalizedMessages,
          title: deriveSessionTitle(normalizedMessages, existingSession.title),
          updatedAt: now,
          workspaceRootName: request.context.workspaceRootName,
          workspaceRootPath: this.workspaceService.currentRootPath ?? null
        }
      : createPersistedChatSession({
          context: request.context,
          createdAt: now,
          messages: normalizedMessages,
          sessionId: request.sessionId,
          workspaceRootPath: this.workspaceService.currentRootPath ?? null
        });
    const nextHistory = normalizePersistedHistory({
      activeSessionId: nextSession.id,
      sessions: [nextSession, ...history.sessions.filter((session) => session.id !== nextSession.id)],
      version: 1
    });

    await this.writePersistedHistory(nextHistory);
    return buildHistorySnapshot(nextHistory);
  }

  async switchSession(sessionId: string): Promise<AiChatHistorySnapshot> {
    const history = await this.readPersistedHistory();

    if (!history.sessions.some((session) => session.id === sessionId)) {
      throw new Error("指定された AI Chat 履歴が見つかりません。");
    }

    const nextHistory = normalizePersistedHistory({
      ...history,
      activeSessionId: sessionId
    });

    await this.writePersistedHistory(nextHistory);
    return buildHistorySnapshot(nextHistory);
  }

  async deleteSession(sessionId: string): Promise<AiChatHistorySnapshot> {
    const history = await this.readPersistedHistory();
    const remainingSessions = history.sessions.filter((session) => session.id !== sessionId);
    const nextHistory = ensurePersistedHistoryHasActiveSession(
      normalizePersistedHistory({
        activeSessionId:
          history.activeSessionId === sessionId
            ? (remainingSessions[0]?.id ?? null)
            : history.activeSessionId,
        sessions: remainingSessions,
        version: 1
      }),
      this.workspaceService.currentRootPath ?? null
    );

    await this.writePersistedHistory(nextHistory);
    return buildHistorySnapshot(nextHistory);
  }

  async submit(request: SubmitAiChatRequest): Promise<SubmitAiChatResult> {
    const prompt = request.prompt.trim();

    if (prompt.length === 0) {
      throw new Error("プロンプトが空です。");
    }

    const workspaceRootPath = this.workspaceService.currentRootPath ?? null;
    const [status, settings] = await Promise.all([this.getStatus(), this.readPersistedSettings()]);
    const selectedModelId = status.selectedModelId ?? FALLBACK_MODELS[0]?.id ?? "openai/gpt-5.4";
    const systemPrompts = resolveAiChatSystemPrompts(settings);
    const normalizedHistoryResult = await normalizeAiChatHistory(request.history, workspaceRootPath);
    const runtimeSelection = await this.resolveRuntimeSelection({
      modelId: selectedModelId,
      settings,
      workspaceRootPath
    });
    const assistantCreatedAt = new Date().toISOString();
    const assistantMessage: AiChatMessage =
      runtimeSelection.mode === "stub"
        ? {
            createdAt: assistantCreatedAt,
            id: createChatMessageId("assistant"),
            role: "assistant",
            text: buildStubResponse(prompt, request.context, normalizedHistoryResult.history.length, status)
          }
        : {
            createdAt: assistantCreatedAt,
            id: createChatMessageId("assistant"),
            role: "assistant",
            ...(await this.submitWithAgentRuntime({
              context: request.context,
              history: normalizedHistoryResult.history,
              runtimeSelection,
              systemPrompt: systemPrompts.chatPanel
            }))
          };
    const toolMessages = buildToolMessages(assistantMessage);

    return {
      messages: [...toolMessages, assistantMessage],
      userMessage: normalizedHistoryResult.updatedUserMessage
    };
  }

  async submitInlineInsertion(
    request: SubmitInlineAiInsertionRequest
  ): Promise<SubmitInlineAiInsertionResult> {
    const prompt = request.prompt.trim();

    if (prompt.length === 0) {
      throw new Error("プロンプトが空です。");
    }

    const [{ runtimeSelection, status }, settings] = await Promise.all([
      this.resolveCurrentRuntimeSelection(),
      this.readPersistedSettings()
    ]);
    const systemPrompts = resolveAiChatSystemPrompts(settings);

    if (runtimeSelection.mode === "stub") {
      throw new Error(buildInlineRuntimeNotConfiguredMessage(status));
    }

    const normalizedPriorMessages = request.history
      .map(normalizeAiChatMessageForPersistence)
      .filter(isDefined);
    const userMessage: AiChatMessage = {
      createdAt: new Date().toISOString(),
      id: createChatMessageId("user"),
      role: "user",
      text: prompt
    };
    const conversationalMessages = [...normalizedPriorMessages, userMessage];
    const result = await this.generateTaskWithAgentRuntime({
      context: request.context,
      extraTools: createInlineMarkdownInsertionTools(),
      instructions: buildInlineInsertionInstructions(systemPrompts.inlineInsertion),
      maxSteps: TOOL_LOOP_INLINE_INSERTION_MAX_STEPS,
      prompt: buildInlineInsertionPrompt(request, conversationalMessages),
      runtimeSelection,
      useWorkspaceTools: true
    });
    const insertion = parseInlineMarkdownInsertion(result.diagnostics.toolTrace);
    const assistantMessage: AiChatMessage = {
      createdAt: new Date().toISOString(),
      diagnostics: result.diagnostics,
      id: createChatMessageId("assistant"),
      role: "assistant",
      text: result.text
    };
    const toolMessages = buildToolMessages(assistantMessage);
    const responseMessages = [...toolMessages, assistantMessage];
    const sessionId = await this.persistInlineAiSession({
      context: request.context,
      messages: [...conversationalMessages, ...responseMessages],
      sessionId: request.sessionId ?? null,
      workspaceRootPath: this.workspaceService.currentRootPath ?? null
    });

    return {
      insertion,
      messages: responseMessages,
      sessionId,
      ...(insertion ? { text: insertion.text } : {}),
      userMessage
    };
  }

  async submitInlinePythonBlock(
    request: SubmitInlinePythonBlockRequest
  ): Promise<SubmitInlinePythonBlockResult> {
    const prompt = request.prompt.trim();
    const workspaceRootPath = this.workspaceService.currentRootPath ?? null;

    if (prompt.length === 0) {
      throw new Error("プロンプトが空です。");
    }

    if (!workspaceRootPath) {
      throw new Error("workspace folder is not open.");
    }

    const [{ runtimeSelection, status }, settings] = await Promise.all([
      this.resolveCurrentRuntimeSelection(),
      this.readPersistedSettings()
    ]);
    const systemPrompts = resolveAiChatSystemPrompts(settings);

    if (runtimeSelection.mode === "stub") {
      throw new Error(buildInlineRuntimeNotConfiguredMessage(status));
    }

    const normalizedPriorMessages = request.history
      .map(normalizeAiChatMessageForPersistence)
      .filter(isDefined);
    const userMessage: AiChatMessage = {
      createdAt: new Date().toISOString(),
      id: createChatMessageId("user"),
      role: "user",
      text: prompt
    };
    const conversationalMessages = [...normalizedPriorMessages, userMessage];
    const skillPrompt = await readImplementIntegralBlockSkillPrompt(workspaceRootPath);
    const result = await this.generateTaskWithAgentRuntime({
      context: request.context,
      extraTools: createInlinePythonBlockTools(),
      instructions: buildInlinePythonBlockInstructions(systemPrompts.inlinePythonBlock, skillPrompt),
      maxSteps: TOOL_LOOP_BLOCK_IMPLEMENTATION_MAX_STEPS,
      prompt: buildInlinePythonBlockPrompt(request, conversationalMessages),
      runtimeSelection,
      useWorkspaceTools: true
    });
    const insertion = parseInlinePythonBlockInsertion(result.diagnostics.toolTrace);

    if (insertion) {
      const absoluteScriptPath = this.workspaceService.getAbsolutePath(insertion.scriptPath);
      const stats = await fs.stat(absoluteScriptPath).catch(() => null);

      if (!stats?.isFile()) {
        throw new Error(`AI が Python script を保存しませんでした: ${insertion.scriptPath}`);
      }

      const scriptSource = await fs.readFile(absoluteScriptPath, "utf8");

      if (!containsDiscoverableIntegralCallable(scriptSource, insertion.functionName)) {
        throw new Error(
          `${insertion.scriptPath} に @integral_block 直下の def ${insertion.functionName}(...) が見つかりません。`
        );
      }
    }

    const assistantMessage: AiChatMessage = {
      createdAt: new Date().toISOString(),
      diagnostics: result.diagnostics,
      id: createChatMessageId("assistant"),
      role: "assistant",
      text: result.text
    };
    const toolMessages = buildToolMessages(assistantMessage);
    const responseMessages = [...toolMessages, assistantMessage];
    const sessionId = await this.persistInlineAiSession({
      context: request.context,
      messages: [...conversationalMessages, ...responseMessages],
      sessionId: request.sessionId ?? null,
      workspaceRootPath
    });

    return {
      assistantText: result.text,
      ...(insertion
        ? {
            functionName: insertion.functionName,
            scriptPath: insertion.scriptPath
          }
        : {}),
      insertion,
      messages: responseMessages,
      sessionId,
      userMessage
    };
  }

  private async getModelCatalog(forceRefresh: boolean): Promise<ModelCatalog> {
    if (!forceRefresh && this.modelCatalogCache) {
      return this.modelCatalogCache;
    }

    try {
      const response = await fetch(AI_GATEWAY_MODELS_URL);

      if (!response.ok) {
        throw new Error(`AI Gateway model endpoint failed: ${response.status}`);
      }

      const payload = (await response.json()) as {
        data?: unknown;
      };
      const models = Array.isArray(payload.data)
        ? deduplicateModels(payload.data.map(normalizeGatewayModel).filter(isDefined))
        : [];

      if (models.length === 0) {
        throw new Error("AI Gateway model endpoint returned no usable chat models.");
      }

      this.modelCatalogCache = {
        models,
        refreshedAt: new Date().toISOString(),
        source: "live"
      };
      return this.modelCatalogCache;
    } catch {
      const fallbackCatalog: ModelCatalog = {
        models: FALLBACK_MODELS,
        refreshedAt: new Date().toISOString(),
        source: "fallback"
      };

      this.modelCatalogCache = fallbackCatalog;
      return fallbackCatalog;
    }
  }

  private async readPersistedSettings(): Promise<PersistedAiChatSettings> {
    try {
      const raw = await fs.readFile(this.settingsFilePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;

      if (!isRecord(parsed)) {
        return {};
      }

      return {
        apiKeyCiphertext:
          typeof parsed.apiKeyCiphertext === "string" ? parsed.apiKeyCiphertext : undefined,
        apiKeyPlaintext:
          typeof parsed.apiKeyPlaintext === "string" ? parsed.apiKeyPlaintext : undefined,
        selectedModelId: typeof parsed.selectedModelId === "string" ? parsed.selectedModelId : null,
        systemPrompts: normalizeAiChatSystemPrompts(parsed.systemPrompts)
      };
    } catch {
      return {};
    }
  }

  private async writePersistedSettings(settings: PersistedAiChatSettings): Promise<void> {
    await fs.mkdir(path.dirname(this.settingsFilePath), { recursive: true });
    await fs.writeFile(this.settingsFilePath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  }

  private async readPersistedHistory(): Promise<PersistedAiChatHistoryFile> {
    try {
      const raw = await fs.readFile(this.historyFilePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;

      return normalizePersistedHistory(parsed);
    } catch {
      return {
        activeSessionId: null,
        sessions: [],
        version: 1
      };
    }
  }

  private async writePersistedHistory(history: PersistedAiChatHistoryFile): Promise<void> {
    await fs.mkdir(path.dirname(this.historyFilePath), { recursive: true });
    await fs.writeFile(
      this.historyFilePath,
      `${JSON.stringify(normalizePersistedHistory(history), null, 2)}\n`,
      "utf8"
    );
  }

  private async persistInlineAiSession({
    context,
    messages,
    sessionId,
    workspaceRootPath
  }: {
    context: AiChatContextSummary;
    messages: AiChatMessage[];
    sessionId: string | null;
    workspaceRootPath: string | null;
  }): Promise<string> {
    const history = await this.readPersistedHistory();
    const now = new Date().toISOString();
    const normalizedSessionId = normalizeIdentifier(sessionId);
    const normalizedMessages = messages.map(normalizeAiChatMessageForPersistence).filter(isDefined);
    const existingSession = normalizedSessionId
      ? history.sessions.find((candidate) => candidate.id === normalizedSessionId)
      : undefined;
    const nextSession: PersistedAiChatSession = existingSession
      ? {
          ...existingSession,
          messages: normalizedMessages,
          title: deriveSessionTitle(normalizedMessages, existingSession.title),
          updatedAt: now,
          workspaceRootName: context.workspaceRootName,
          workspaceRootPath
        }
      : createPersistedChatSession({
          context,
          createdAt: now,
          messages: normalizedMessages,
          sessionId: normalizedSessionId ?? undefined,
          workspaceRootPath
        });
    const nextHistory = normalizePersistedHistory({
      activeSessionId: history.activeSessionId ?? nextSession.id,
      sessions: [nextSession, ...history.sessions.filter((session) => session.id !== nextSession.id)],
      version: 1
    });

    await this.writePersistedHistory(nextHistory);
    return nextSession.id;
  }

  private async resolveCurrentRuntimeSelection(): Promise<{
    runtimeSelection: ResolvedAiRuntime;
    status: AiChatStatus;
    workspaceRootPath: string | null;
  }> {
    const workspaceRootPath = this.workspaceService.currentRootPath ?? null;
    const [status, settings] = await Promise.all([this.getStatus(), this.readPersistedSettings()]);
    const selectedModelId = status.selectedModelId ?? FALLBACK_MODELS[0]?.id ?? "openai/gpt-5.4";
    const runtimeSelection = await this.resolveRuntimeSelection({
      modelId: selectedModelId,
      settings,
      workspaceRootPath
    });

    return {
      runtimeSelection,
      status,
      workspaceRootPath
    };
  }

  private async resolveRuntimeSelection({
    modelId,
    settings,
    workspaceRootPath
  }: {
    modelId: string;
    settings: PersistedAiChatSettings;
    workspaceRootPath: string | null;
  }): Promise<ResolvedAiRuntime> {
    const [directProvider, gatewayAuth] = await Promise.all([
      resolveDirectProviderRuntime(modelId, workspaceRootPath),
      resolveGatewayAuth(settings, workspaceRootPath)
    ]);

    if (directProvider) {
      return {
        directProvider,
        mode: "direct",
        notes: [
          `chat 送信は ${describeDirectProviderLabel(directProvider.provider)} + ToolLoopAgent を使います。workspace 探索は bash-tool、image path は readWorkspaceImage、md/html の見た目確認は renderWorkspaceDocument、real save は writeWorkspaceFile、bash/writeFile は overlay preview 扱いです。`,
          `${describeDirectProviderEnvKey(directProvider.provider)} を ${describeWorkspaceSecretSource(directProvider.source)} から使います。AI Gateway 認証は不要です。`
        ],
        providerLabel: describeDirectProviderLabel(directProvider.provider),
        runtime: buildDirectExecutionRuntime(directProvider)
      };
    }

    if (gatewayAuth.token.length > 0) {
      const providerOptions = await buildGatewayProviderOptions(modelId, workspaceRootPath);

      return {
        gatewayAuth,
        mode: "gateway",
        notes: [
          "chat 送信は AI Gateway + ToolLoopAgent を使います。workspace 探索は bash-tool、image path は readWorkspaceImage、md/html の見た目確認は renderWorkspaceDocument、real save は writeWorkspaceFile、bash/writeFile は overlay preview 扱いです。",
          providerOptions
            ? "選択中 model に対して provider-scoped BYOK credential も付与します。"
            : "選択中 model に対する provider-scoped BYOK credential は未検出です。"
        ],
        providerLabel: "Vercel AI Gateway",
        runtime: {
          gatewayApiKey: gatewayAuth.token,
          mode: "gateway",
          modelId,
          providerOptions
        }
      };
    }

    return {
      mode: "stub",
      notes: [
        "選択中 model を実行できる credential が未設定のため、chat 送信は stub 応答になります。",
        "anthropic/* は ANTHROPIC_API_KEY、openai/* は OPENAI_API_KEY を優先して使い、どちらも無い場合のみ AI Gateway を使います。"
      ],
      providerLabel: "Stub Runtime"
    };
  }

  private async submitWithAgentRuntime({
    context,
    history,
    runtimeSelection,
    systemPrompt
  }: {
    context: AiChatContextSummary;
    history: SubmitAiChatRequest["history"];
    runtimeSelection: Extract<ResolvedAiRuntime, { mode: "direct" | "gateway" }>;
    systemPrompt: string;
  }): Promise<Pick<AiChatMessage, "diagnostics" | "text">> {
    try {
      const result = await this.aiAgentService.submit({
        context,
        history,
        runtime: runtimeSelection.runtime,
        systemPrompt
      });

      return {
        diagnostics: result.diagnostics,
        text: result.text
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (runtimeSelection.mode === "gateway" && /Authentication failed|AI_GATEWAY_API_KEY|VERCEL_OIDC_TOKEN/iu.test(message)) {
        throw new Error(
          buildGatewayRequestErrorMessage({
            gatewayAuthSource: runtimeSelection.gatewayAuth.source,
            message,
            usedByok:
              runtimeSelection.runtime.mode === "gateway" &&
              runtimeSelection.runtime.providerOptions !== undefined
          })
        );
      }

      if (runtimeSelection.mode === "direct" && /401|403|authentication|api key|unauthorized/iu.test(message)) {
        throw new Error(buildDirectProviderRequestErrorMessage(runtimeSelection.directProvider, message));
      }

      throw error;
    }
  }

  private async generateTaskWithAgentRuntime({
    context,
    extraTools,
    instructions,
    maxSteps,
    prompt,
    runtimeSelection,
    useWorkspaceTools
  }: {
    context: AiChatContextSummary;
    extraTools?: ToolSet;
    instructions: string;
    maxSteps: number;
    prompt: string;
    runtimeSelection: Extract<ResolvedAiRuntime, { mode: "direct" | "gateway" }>;
    useWorkspaceTools: boolean;
  }): Promise<{
    diagnostics: AiChatMessageDiagnostics;
    text: string;
  }> {
    try {
      const result = await this.aiAgentService.generateForTask({
        context,
        extraTools,
        instructions,
        maxSteps,
        prompt,
        runtime: runtimeSelection.runtime,
        useWorkspaceTools
      });

      return {
        diagnostics: result.diagnostics,
        text: result.text
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (runtimeSelection.mode === "gateway" && /Authentication failed|AI_GATEWAY_API_KEY|VERCEL_OIDC_TOKEN/iu.test(message)) {
        throw new Error(
          buildGatewayRequestErrorMessage({
            gatewayAuthSource: runtimeSelection.gatewayAuth.source,
            message,
            usedByok:
              runtimeSelection.runtime.mode === "gateway" &&
              runtimeSelection.runtime.providerOptions !== undefined
          })
        );
      }

      if (runtimeSelection.mode === "direct" && /401|403|authentication|api key|unauthorized/iu.test(message)) {
        throw new Error(buildDirectProviderRequestErrorMessage(runtimeSelection.directProvider, message));
      }

      throw error;
    }
  }
}

function buildInlineRuntimeNotConfiguredMessage(status: AiChatStatus): string {
  const model = status.selectedModelId ? ` (${status.selectedModelId})` : "";

  return `AI runtime が未設定です${model}。AI Chat settings で model と credential を設定してください。`;
}

function buildInlineInsertionInstructions(systemPrompt: string): string {
  return normalizeAiChatSystemPromptValue(
    systemPrompt,
    DEFAULT_AI_CHAT_SYSTEM_PROMPTS.inlineInsertion
  );
}

function buildInlineInsertionPrompt(
  request: SubmitInlineAiInsertionRequest,
  messages: readonly AiChatMessage[]
): string {
  return [
    "Popup chat transcript:",
    formatInlinePythonBlockTranscript(messages),
    "",
    `Source note path: ${request.sourceNotePath}`,
    `Active path: ${request.context.activeRelativePath ?? "(none)"}`,
    `Insertion position: ${formatInlineInsertionPosition(request.insertionPosition)}`,
    `Open Markdown length: ${request.documentMarkdown.length} chars`,
    "",
    "Open Markdown document (current editor state):",
    truncateInlineDocument(request.documentMarkdown),
    "",
    "Markdown before cursor:",
    truncateInlineContext(request.beforeText, "tail"),
    "",
    "[CURSOR]",
    "",
    "Markdown after cursor:",
    truncateInlineContext(request.afterText, "head"),
    "",
    "Respond to the latest user message. If ready, call insertMarkdownAtCursor with exactly the Markdown that belongs at [CURSOR]."
  ].join("\n");
}

function createInlineMarkdownInsertionTools(): ToolSet {
  return {
    insertMarkdownAtCursor: tool({
      description:
        "Insert exact Markdown at the inline editor cursor. Call this only when the content is ready to insert. Do not use this for explanations or questions.",
      inputSchema: z.object({
        summary: z.string().optional(),
        text: z.string().min(1)
      }),
      execute: async ({ summary, text }) => ({
        summary: typeof summary === "string" ? summary : "",
        text
      })
    })
  };
}

function createInlinePythonBlockTools(): ToolSet {
  return {
    insertPythonBlock: tool({
      description:
        "Signal that the inline Python block popup should insert an itg-notes block for an already-saved workspace Python callable. Use this only after writeWorkspaceFile saved the .py file and the requested block is ready to insert.",
      inputSchema: z.object({
        functionName: z.string().min(1),
        scriptPath: z.string().min(1),
        summary: z.string().optional()
      }),
      execute: async ({ functionName, scriptPath, summary }) => ({
        functionName,
        scriptPath,
        summary: typeof summary === "string" ? summary : ""
      })
    })
  };
}

function parseInlineMarkdownInsertion(
  toolTrace: readonly AiChatToolTraceEntry[]
): InlineAiTextInsertion | null {
  const insertionTrace = [...toolTrace]
    .reverse()
    .find((entry) => entry.toolName === "insertMarkdownAtCursor" && entry.status === "success");

  if (!insertionTrace) {
    return null;
  }

  try {
    const parsed = JSON.parse(insertionTrace.outputSummary) as unknown;

    if (!isRecord(parsed) || typeof parsed.text !== "string" || parsed.text.length === 0) {
      throw new Error("invalid insertMarkdownAtCursor payload");
    }

    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";

    return {
      ...(summary ? { summary } : {}),
      text: parsed.text
    };
  } catch {
    throw new Error("insertMarkdownAtCursor tool の結果から挿入 Markdown を取得できませんでした。");
  }
}

function buildInlinePythonBlockInstructions(systemPrompt: string, skillPrompt: string): string {
  const lines = [
    normalizeAiChatSystemPromptValue(
      systemPrompt,
      DEFAULT_AI_CHAT_SYSTEM_PROMPTS.inlinePythonBlock
    ),
    ""
  ];

  if (skillPrompt.trim().length > 0) {
    lines.push(skillPrompt.trim());
  }

  return lines.join("\n");
}

function buildInlinePythonBlockPrompt(
  request: SubmitInlinePythonBlockRequest,
  messages: readonly AiChatMessage[]
): string {
  return [
    "Popup chat transcript:",
    formatInlinePythonBlockTranscript(messages),
    "",
    `Source note path: ${request.sourceNotePath}`,
    `Active path: ${request.context.activeRelativePath ?? "(none)"}`,
    `Insertion position: ${formatInlineInsertionPosition(request.insertionPosition)}`,
    `Open Markdown length: ${request.documentMarkdown.length} chars`,
    "",
    "Open Markdown document (current editor state):",
    truncateInlineDocument(request.documentMarkdown),
    "",
    "Text before cursor:",
    truncateInlineContext(request.beforeText, "tail"),
    "",
    "Text after cursor:",
    truncateInlineContext(request.afterText, "head"),
    "",
    "Respond to the latest user message. If ready, save the Python script with writeWorkspaceFile, then call insertPythonBlock. If more information is needed, ask one concise question and do not call insertPythonBlock."
  ].join("\n");
}

function formatInlinePythonBlockTranscript(messages: readonly AiChatMessage[]): string {
  return messages
    .filter((message) => message.role !== "tool")
    .map((message) => {
      const role = message.role === "assistant" ? "Assistant" : "User";
      return `${role}: ${message.text.trim()}`;
    })
    .join("\n\n");
}

async function readImplementIntegralBlockSkillPrompt(workspaceRootPath: string): Promise<string> {
  const candidateRoots = [
    path.join(workspaceRootPath, ".codex", "skills", "implement-integral-block"),
    path.join(workspaceRootPath, "Notes", ".codex", "skills", "implement-integral-block")
  ];

  for (const skillRootPath of candidateRoots) {
    const skillBody = await readTextIfExists(path.join(skillRootPath, "SKILL.md"));

    if (!skillBody) {
      continue;
    }

    const sdkReference = await readTextIfExists(
      path.join(skillRootPath, "references", "integral-sdk-interface.md")
    );
    const patternReference = await readTextIfExists(
      path.join(skillRootPath, "references", "block-implementation-patterns.md")
    );

    return [
      "# implement-integral-block skill",
      skillBody,
      sdkReference ? "# integral-sdk-interface reference\n\n" + sdkReference : "",
      patternReference ? "# block-implementation-patterns reference\n\n" + patternReference : ""
    ]
      .filter((part) => part.trim().length > 0)
      .join("\n\n");
  }

  return [
    "Use from integral import integral_block.",
    "The decorator supports display_name, description, inputs, and outputs.",
    "Slot objects support name, extension/extensions, format, auto_insert_to_work_note, share_note_with_input, and embed_to_shared_note.",
    "Do not group files with different roles or user intent into one .idts output just for convenience.",
    "Use .idts outputs only when multiple files of the same nature are generated as one set.",
    "Make user-facing renderables such as HTML reports, plots, images, SVG/PNG/JPEG/WebP files, and readable Markdown/text reports their own output slots.",
    "Set auto_insert_to_work_note=true for user-facing renderable output slots that should appear under the block.",
    "Keep CSV/TSV/JSON and other machine-readable or intermediate outputs in separate output slots, with auto_insert_to_work_note omitted or false unless the user explicitly wants that file as the visible result.",
    "Keep @integral_block(...) immediately above a top-level def main(inputs, outputs, params) -> None.",
    "Treat inputs and outputs as path dictionaries. Write outputs only to assigned output paths."
  ].join("\n");
}

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function parseInlinePythonBlockInsertion(
  toolTrace: readonly AiChatToolTraceEntry[]
): InlinePythonBlockInsertion | null {
  const insertionTrace = [...toolTrace]
    .reverse()
    .find((entry) => entry.toolName === "insertPythonBlock" && entry.status === "success");

  if (!insertionTrace) {
    return null;
  }

  const match = /^(.+\.py):([A-Za-z_][A-Za-z0-9_]*)(?:\s*\|\s*(.*))?$/u.exec(
    insertionTrace.outputSummary.trim()
  );

  if (!match) {
    throw new Error("insertPythonBlock tool の結果から script path / function name を取得できませんでした。");
  }

  const summary = match[3]?.trim();

  return {
    functionName: normalizeGeneratedFunctionName(match[2] ?? "main"),
    scriptPath: normalizeGeneratedScriptPath(match[1] ?? ""),
    ...(summary ? { summary } : {})
  };
}

function normalizeGeneratedScriptPath(scriptPath: string): string {
  const normalized = scriptPath.trim().replace(/\\/gu, "/").replace(/^\/+/u, "");
  const relativePath = path.posix.normalize(normalized);

  if (
    relativePath.length === 0 ||
    relativePath === "." ||
    relativePath.includes(":") ||
    relativePath.startsWith("../") ||
    relativePath.includes("/../") ||
    path.posix.extname(relativePath).toLowerCase() !== ".py"
  ) {
    throw new Error(`AI が返した script path が不正です: ${scriptPath}`);
  }

  return relativePath;
}

function normalizeGeneratedFunctionName(functionName: string): string {
  const normalized = functionName.trim();

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(normalized)) {
    throw new Error(`AI が返した function name が不正です: ${functionName}`);
  }

  return normalized;
}

function containsDiscoverableIntegralCallable(source: string, functionName: string): boolean {
  const escapedFunctionName = escapeRegExp(functionName);
  const expression = new RegExp(
    `@integral_block\\s*\\([\\s\\S]*?\\)\\s*(?:\\r?\\n)+\\s*def\\s+${escapedFunctionName}\\s*\\(`,
    "u"
  );

  return expression.test(source);
}

function truncateInlineContext(value: string, side: "head" | "tail"): string {
  if (value.length <= MAX_INLINE_AI_CONTEXT_CHARS) {
    return value;
  }

  return side === "head"
    ? value.slice(0, MAX_INLINE_AI_CONTEXT_CHARS)
    : value.slice(-MAX_INLINE_AI_CONTEXT_CHARS);
}

function truncateInlineDocument(value: string): string {
  if (value.length === 0) {
    return "(empty)";
  }

  if (value.length <= MAX_INLINE_AI_DOCUMENT_CHARS) {
    return value;
  }

  const halfLength = Math.floor(MAX_INLINE_AI_DOCUMENT_CHARS / 2);
  const omittedLength = value.length - MAX_INLINE_AI_DOCUMENT_CHARS;

  return [
    value.slice(0, halfLength),
    `[... truncated ${omittedLength} chars from the middle of the open Markdown document ...]`,
    value.slice(-halfLength)
  ].join("\n");
}

function formatInlineInsertionPosition(value: number): string {
  return Number.isFinite(value) ? `${Math.max(0, Math.floor(value))}` : "(unknown)";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function buildHistorySnapshot(history: PersistedAiChatHistoryFile): AiChatHistorySnapshot {
  const activeSession =
    history.sessions.find((session) => session.id === history.activeSessionId) ?? history.sessions[0];

  if (!activeSession) {
    throw new Error("AI Chat 履歴を初期化できませんでした。");
  }

  return {
    activeSession: buildSession(activeSession),
    activeSessionId: activeSession.id,
    sessions: history.sessions.map(buildSessionSummary)
  };
}

function buildSession(session: PersistedAiChatSession): AiChatSession {
  return {
    ...buildSessionSummary(session),
    messages: session.messages
  };
}

function buildSessionSummary(session: PersistedAiChatSession): AiChatSessionSummary {
  return {
    createdAt: session.createdAt,
    id: session.id,
    lastMessageText: getLastConversationalMessage(session.messages)?.text ?? null,
    messageCount: session.messages.filter((message) => message.role !== "tool").length,
    title: session.title,
    updatedAt: session.updatedAt,
    workspaceRootName: session.workspaceRootName,
    workspaceRootPath: session.workspaceRootPath
  };
}

function ensurePersistedHistoryHasActiveSession(
  history: PersistedAiChatHistoryFile,
  currentWorkspaceRootPath: string | null
): PersistedAiChatHistoryFile {
  const hasActiveSession = history.sessions.some((session) => session.id === history.activeSessionId);

  if (hasActiveSession) {
    return history;
  }

  if (history.sessions.length > 0) {
    return {
      ...history,
      activeSessionId: history.sessions[0].id
    };
  }

  const now = new Date().toISOString();
  const context = buildFallbackContextSummary(currentWorkspaceRootPath);
  const session = createPersistedChatSession({
    context,
    createdAt: now,
    messages: [],
    workspaceRootPath: currentWorkspaceRootPath
  });

  return {
    activeSessionId: session.id,
    sessions: [session],
    version: 1
  };
}

function buildFallbackContextSummary(currentWorkspaceRootPath: string | null): AiChatContextSummary {
  return {
    activeDocumentExcerpt: null,
    activeDocumentKind: null,
    activeDocumentName: null,
    activeRelativePath: null,
    selectedPaths: [],
    workspaceRootName: currentWorkspaceRootPath ? path.basename(currentWorkspaceRootPath) : null
  };
}

function createPersistedChatSession({
  context,
  createdAt,
  messages,
  sessionId,
  workspaceRootPath
}: {
  context: AiChatContextSummary;
  createdAt: string;
  messages: AiChatMessage[];
  sessionId?: string;
  workspaceRootPath: string | null;
}): PersistedAiChatSession {
  const normalizedMessages = messages.map(normalizeAiChatMessageForPersistence).filter(isDefined);

  return {
    createdAt,
    id: normalizeIdentifier(sessionId) ?? createChatSessionId(),
    messages: normalizedMessages,
    title: deriveSessionTitle(normalizedMessages, "New chat"),
    updatedAt: createdAt,
    workspaceRootName: context.workspaceRootName,
    workspaceRootPath
  };
}

function normalizePersistedHistory(value: unknown): PersistedAiChatHistoryFile {
  const rawSessions = isRecord(value) && Array.isArray(value.sessions) ? value.sessions : [];
  const uniqueSessions = new Map<string, PersistedAiChatSession>();

  for (const rawSession of rawSessions) {
    const session = normalizePersistedSession(rawSession);

    if (!session || uniqueSessions.has(session.id)) {
      continue;
    }

    uniqueSessions.set(session.id, session);
  }

  const sessions = Array.from(uniqueSessions.values())
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_PERSISTED_CHAT_SESSIONS);
  const activeSessionId =
    isRecord(value) && typeof value.activeSessionId === "string"
      ? normalizeIdentifier(value.activeSessionId)
      : null;

  return {
    activeSessionId:
      activeSessionId && sessions.some((session) => session.id === activeSessionId)
        ? activeSessionId
        : (sessions[0]?.id ?? null),
    sessions,
    version: 1
  };
}

function normalizePersistedSession(value: unknown): PersistedAiChatSession | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = normalizeIdentifier(value.id);

  if (!id) {
    return null;
  }

  const messages = Array.isArray(value.messages)
    ? value.messages.map(normalizeAiChatMessageForPersistence).filter(isDefined)
    : [];
  const createdAt = normalizeIsoTimestamp(value.createdAt) ?? getOldestMessageTimestamp(messages) ?? new Date().toISOString();
  const updatedAt = normalizeIsoTimestamp(value.updatedAt) ?? getNewestMessageTimestamp(messages) ?? createdAt;
  const persistedTitle = typeof value.title === "string" ? value.title.trim() : "";

  return {
    createdAt,
    id,
    messages,
    title: deriveSessionTitle(messages, persistedTitle || "New chat"),
    updatedAt,
    workspaceRootName: normalizeNullableString(value.workspaceRootName),
    workspaceRootPath: normalizeNullableString(value.workspaceRootPath)
  };
}

function normalizeAiChatMessageForPersistence(value: unknown): AiChatMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  const role = normalizeAiChatRole(value.role);

  if (
    !role ||
    typeof value.id !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.text !== "string"
  ) {
    return null;
  }

  const message: AiChatMessage = {
    createdAt: value.createdAt,
    id: value.id,
    role,
    text: value.text
  };
  const attachments = Array.isArray(value.attachments)
    ? value.attachments.map(normalizeImageAttachment).filter(isDefined)
    : [];
  const diagnostics = normalizeMessageDiagnostics(value.diagnostics);
  const toolTraceEntry = normalizeToolTraceEntry(value.toolTraceEntry);

  if (attachments.length > 0) {
    message.attachments = attachments;
  }

  if (diagnostics) {
    message.diagnostics = diagnostics;
  }

  if (toolTraceEntry) {
    message.toolTraceEntry = toolTraceEntry;
  }

  return message;
}

function normalizeImageAttachment(value: unknown): AiChatImageAttachment | null {
  if (
    !isRecord(value) ||
    typeof value.dataUrl !== "string" ||
    typeof value.id !== "string" ||
    typeof value.mediaType !== "string" ||
    typeof value.name !== "string" ||
    typeof value.sourcePath !== "string"
  ) {
    return null;
  }

  return {
    dataUrl: value.dataUrl,
    id: value.id,
    mediaType: value.mediaType,
    name: value.name,
    sourcePath: value.sourcePath
  };
}

function normalizeMessageDiagnostics(value: unknown): AiChatMessageDiagnostics | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    finishReason: typeof value.finishReason === "string" ? value.finishReason : null,
    modelId: typeof value.modelId === "string" ? value.modelId : null,
    stepCount:
      typeof value.stepCount === "number" && Number.isFinite(value.stepCount)
        ? Math.max(0, Math.floor(value.stepCount))
        : 0,
    toolTrace: Array.isArray(value.toolTrace)
      ? value.toolTrace.map(normalizeToolTraceEntry).filter(isDefined)
      : []
  };
}

function normalizeToolTraceEntry(value: unknown): AiChatToolTraceEntry | null {
  if (
    !isRecord(value) ||
    typeof value.inputSummary !== "string" ||
    typeof value.outputSummary !== "string" ||
    typeof value.toolName !== "string" ||
    (value.status !== "error" && value.status !== "success") ||
    typeof value.stepNumber !== "number" ||
    !Number.isFinite(value.stepNumber)
  ) {
    return null;
  }

  return {
    inputSummary: value.inputSummary,
    outputSummary: value.outputSummary,
    status: value.status,
    stepNumber: Math.max(0, Math.floor(value.stepNumber)),
    toolName: value.toolName
  };
}

function normalizeAiChatRole(value: unknown): AiChatMessage["role"] | null {
  return value === "assistant" || value === "tool" || value === "user" ? value : null;
}

function deriveSessionTitle(messages: readonly AiChatMessage[], fallbackTitle: string): string {
  const firstUserMessage = messages.find((message) => message.role === "user");
  const baseTitle =
    firstUserMessage?.text.replace(/\s+/gu, " ").trim() ||
    fallbackTitle.replace(/\s+/gu, " ").trim() ||
    "New chat";

  return baseTitle.length > 64 ? `${baseTitle.slice(0, 61).trimEnd()}...` : baseTitle;
}

function getLastConversationalMessage(messages: readonly AiChatMessage[]): AiChatMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message && message.role !== "tool") {
      return message;
    }
  }

  return null;
}

function getOldestMessageTimestamp(messages: readonly AiChatMessage[]): string | null {
  return messages[0]?.createdAt ?? null;
}

function getNewestMessageTimestamp(messages: readonly AiChatMessage[]): string | null {
  return messages[messages.length - 1]?.createdAt ?? null;
}

function normalizeIdentifier(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : value;
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function resolveAiChatSystemPrompts(settings: PersistedAiChatSettings): AiChatSystemPrompts {
  return normalizeAiChatSystemPrompts(settings.systemPrompts);
}

function normalizeAiChatSystemPrompts(value: unknown): AiChatSystemPrompts {
  const prompts = isRecord(value) ? value : {};

  return {
    chatPanel: normalizeAiChatSystemPromptValue(
      prompts.chatPanel,
      DEFAULT_AI_CHAT_SYSTEM_PROMPTS.chatPanel
    ),
    inlineInsertion: normalizeAiChatSystemPromptValue(
      prompts.inlineInsertion,
      DEFAULT_AI_CHAT_SYSTEM_PROMPTS.inlineInsertion
    ),
    inlinePythonBlock: normalizeAiChatSystemPromptValue(
      prompts.inlinePythonBlock,
      DEFAULT_AI_CHAT_SYSTEM_PROMPTS.inlinePythonBlock
    )
  };
}

function normalizeAiChatSystemPromptValue(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.replace(/\r\n?/g, "\n").trim();
  return normalized.length > 0 ? normalized : fallback;
}

function createChatSessionId(): string {
  return `chat-session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildStubResponse(
  prompt: string,
  context: AiChatContextSummary,
  historyLength: number,
  status: AiChatStatus
): string {
  const lines = [
    "AI Chat runtime stub が応答しています。",
    "現在は renderer -> preload -> main process の配線まで実装済みで、認証がある場合は direct provider または AI Gateway + ToolLoopAgent + bash-tool を使います。画像は readWorkspaceImage、md/html の視覚レンダリングは renderWorkspaceDocument を使えます。",
    "実行可能な credential が無いときだけ stub に落ちます。",
    "",
    `provider: ${status.providerLabel}`,
    `selected model: ${status.selectedModelId ?? "(未選択)"}`,
    `gateway key configured: ${status.apiKeyConfigured ? "yes" : "no"}`,
    `runtime auth configured: ${status.runtimeAuthConfigured ? "yes" : "no"}`,
    `model catalog: ${status.modelCatalogSource} (${status.availableModels.length} models)`,
    "",
    `受信した prompt: ${prompt}`,
    `履歴メッセージ数: ${historyLength}`,
    "",
    "認識した context:"
  ];

  lines.push(`- workspace: ${context.workspaceRootName ?? "(workspace 未選択)"}`);
  lines.push(`- active path: ${context.activeRelativePath ?? "(なし)"}`);

  if (context.activeDocumentKind && context.activeDocumentName) {
    lines.push(`- active document: ${context.activeDocumentName} [${context.activeDocumentKind}]`);
  }

  if (context.selectedPaths.length > 0) {
    lines.push(`- selected paths: ${context.selectedPaths.join(", ")}`);
  } else {
    lines.push("- selected paths: (なし)");
  }

  if (context.activeDocumentExcerpt) {
    lines.push("");
    lines.push("active document excerpt:");
    lines.push(context.activeDocumentExcerpt);
  }

  lines.push("");
  lines.push("現在の残タスク:");
  lines.push("- host command 実行");
  lines.push("- repo local skills の深い統合");
  lines.push("- generic MCP client registry");

  return lines.join("\n");
}

async function buildGatewayProviderOptions(
  modelId: string,
  workspaceRootPath: string | null
): Promise<
  | {
      gateway: {
        byok: {
          anthropic?: Array<{ apiKey: string }>;
          openai?: Array<{ apiKey: string }>;
        };
      };
    }
  | undefined
> {
  const provider = getModelProvider(modelId);

  if (provider === "anthropic") {
    const anthropicApiKey = (
      await resolveWorkspaceSecretValue(workspaceRootPath, "ANTHROPIC_API_KEY")
    ).value;

    if (anthropicApiKey.length > 0) {
      return {
        gateway: {
          byok: {
            anthropic: [{ apiKey: anthropicApiKey }]
          }
        }
      };
    }
  }

  if (provider === "openai") {
    const openAiApiKey = (await resolveWorkspaceSecretValue(workspaceRootPath, "OPENAI_API_KEY"))
      .value;

    if (openAiApiKey.length > 0) {
      return {
        gateway: {
          byok: {
            openai: [{ apiKey: openAiApiKey }]
          }
        }
      };
    }
  }

  return undefined;
}

async function buildByokStatusNotes(workspaceRootPath: string | null): Promise<string[]> {
  const notes: string[] = [];
  const [anthropicKey, openAiKey] = await Promise.all([
    resolveWorkspaceSecretValue(workspaceRootPath, "ANTHROPIC_API_KEY"),
    resolveWorkspaceSecretValue(workspaceRootPath, "OPENAI_API_KEY")
  ]);

  if (anthropicKey.value.length > 0) {
    notes.push(
      `ANTHROPIC_API_KEY を検出しました (${describeWorkspaceSecretSource(anthropicKey.source)})。anthropic/* model では direct Anthropic runtime を優先します。`
    );
  }

  if (openAiKey.value.length > 0) {
    notes.push(
      `OPENAI_API_KEY を検出しました (${describeWorkspaceSecretSource(openAiKey.source)})。openai/* model では direct OpenAI runtime を優先します。`
    );
  }

  return notes;
}

function buildDirectExecutionRuntime(
  directProvider: ResolvedDirectProviderRuntime
): AiAgentExecutionRuntime {
  if (directProvider.provider === "anthropic") {
    return {
      apiKey: directProvider.apiKey,
      mode: "anthropic-direct",
      modelId: directProvider.modelId
    };
  }

  return {
    apiKey: directProvider.apiKey,
    mode: "openai-direct",
    modelId: directProvider.modelId
  };
}

function buildDirectProviderRequestErrorMessage(
  directProvider: ResolvedDirectProviderRuntime,
  message: string
): string {
  return `${message}\n\n${describeDirectProviderEnvKey(directProvider.provider)} を ${describeWorkspaceSecretSource(directProvider.source)} から使って ${describeDirectProviderLabel(directProvider.provider)} へ直接接続しました。必要なら key 値と model ID (${directProvider.modelId}) を確認してください。`;
}

function buildGatewayRequestErrorMessage({
  gatewayAuthSource,
  message,
  usedByok
}: {
  usedByok: boolean;
  gatewayAuthSource: GatewayAuthSource;
  message: string;
}): string {
  const gatewaySourceLabel = describeGatewayAuthSource(gatewayAuthSource);
  const byokHint = usedByok
    ? "ANTHROPIC_API_KEY / OPENAI_API_KEY などの BYOK credential は付与されていますが、AI Gateway 自体の認証には別途 AI_GATEWAY_API_KEY または VERCEL_OIDC_TOKEN が必要です。"
    : "AI Gateway を使うには AI_GATEWAY_API_KEY または VERCEL_OIDC_TOKEN が必要です。";

  return `${message}\n\n${gatewaySourceLabel}\n${byokHint}`;
}

function describeDirectProviderEnvKey(provider: DirectProvider): "ANTHROPIC_API_KEY" | "OPENAI_API_KEY" {
  return provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
}

function describeDirectProviderLabel(provider: DirectProvider): string {
  return provider === "anthropic" ? "Anthropic Direct API" : "OpenAI Direct API";
}

async function resolveDirectProviderRuntime(
  modelId: string,
  workspaceRootPath: string | null
): Promise<ResolvedDirectProviderRuntime | null> {
  const provider = getModelProvider(modelId);

  if (provider !== "anthropic" && provider !== "openai") {
    return null;
  }

  const envKey = describeDirectProviderEnvKey(provider);
  const resolvedSecret = await resolveWorkspaceSecretValue(workspaceRootPath, envKey);

  if (resolvedSecret.value.length === 0) {
    return null;
  }

  return {
    apiKey: resolvedSecret.value,
    modelId: toDirectProviderModelId(modelId, provider),
    provider,
    source: resolvedSecret.source
  };
}

function toDirectProviderModelId(modelId: string, provider: DirectProvider): string {
  const directModelId = modelId.includes("/") ? modelId.slice(modelId.indexOf("/") + 1) : modelId;

  if (provider === "anthropic") {
    return directModelId.replace(/(?<=\d)\.(?=\d)/gu, "-");
  }

  return directModelId;
}

function normalizeGatewayModel(value: unknown): AiChatModelOption | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }

  const id = value.id.trim();

  if (id.length === 0 || !isLikelyChatModel(id, typeof value.type === "string" ? value.type : null)) {
    return null;
  }

  return {
    contextWindow: typeof value.context_window === "number" ? value.context_window : null,
    id,
    label: typeof value.name === "string" && value.name.trim().length > 0 ? value.name.trim() : id,
    provider: id.includes("/") ? id.split("/", 1)[0] ?? null : null
  };
}

function deduplicateModels(models: AiChatModelOption[]): AiChatModelOption[] {
  const seen = new Map<string, AiChatModelOption>();

  for (const model of models) {
    if (!seen.has(model.id)) {
      seen.set(model.id, model);
    }
  }

  return Array.from(seen.values()).sort((left, right) => {
    const preferredLeft = PREFERRED_MODEL_IDS.get(left.id);
    const preferredRight = PREFERRED_MODEL_IDS.get(right.id);

    if (preferredLeft !== undefined || preferredRight !== undefined) {
      return (preferredLeft ?? Number.MAX_SAFE_INTEGER) - (preferredRight ?? Number.MAX_SAFE_INTEGER);
    }

    return left.id.localeCompare(right.id);
  });
}

function isLikelyChatModel(id: string, type: string | null): boolean {
  const normalizedId = id.toLowerCase();
  const normalizedType = type?.toLowerCase() ?? "";

  return !MODEL_EXCLUSION_TOKENS.some(
    (token) => normalizedId.includes(token) || normalizedType.includes(token)
  );
}

function selectValidModelId(
  candidate: string | null,
  availableModels: readonly AiChatModelOption[]
): string | null {
  if (candidate && availableModels.some((model) => model.id === candidate)) {
    return candidate;
  }

  return availableModels[0]?.id ?? null;
}

async function normalizeAiChatHistory(
  history: AiChatMessage[],
  workspaceRootPath: string | null
): Promise<{
  history: AiChatMessage[];
  updatedUserMessage?: AiChatMessage;
}> {
  const latestUserMessageIndex = [...history].map((message) => message.role).lastIndexOf("user");

  if (latestUserMessageIndex < 0) {
    return { history };
  }

  const latestUserMessage = history[latestUserMessageIndex];
  const resolvedAttachments = await resolvePromptImageAttachments(
    latestUserMessage.text,
    workspaceRootPath,
    latestUserMessage.attachments ?? []
  );

  if (areImageAttachmentsEquivalent(latestUserMessage.attachments ?? [], resolvedAttachments)) {
    return { history };
  }

  const updatedUserMessage: AiChatMessage = {
    ...latestUserMessage,
    attachments: resolvedAttachments
  };
  const nextHistory = history.slice();
  nextHistory[latestUserMessageIndex] = updatedUserMessage;

  return {
    history: nextHistory,
    updatedUserMessage
  };
}

async function resolvePromptImageAttachments(
  text: string,
  workspaceRootPath: string | null,
  existingAttachments: AiChatImageAttachment[]
): Promise<AiChatImageAttachment[]> {
  const attachmentsByKey = new Map<string, AiChatImageAttachment>();

  for (const attachment of existingAttachments) {
    attachmentsByKey.set(normalizeAttachmentSourceKey(attachment.sourcePath, workspaceRootPath), attachment);
  }

  for (const candidatePath of extractImagePathCandidates(text)) {
    const attachment = await resolveImageAttachmentFromCandidate(candidatePath, workspaceRootPath);

    if (!attachment) {
      continue;
    }

    attachmentsByKey.set(normalizeAttachmentSourceKey(attachment.sourcePath, workspaceRootPath), attachment);
  }

  return Array.from(attachmentsByKey.values());
}

function extractImagePathCandidates(text: string): string[] {
  const candidates = new Set<string>();
  const quotedPattern = /["']([^"'`\r\n]+\.(?:bmp|gif|jpe?g|png|svg|webp))["']/giu;
  const windowsAbsolutePattern = /[A-Za-z]:\\[^\s"'`]+?\.(?:bmp|gif|jpe?g|png|svg|webp)/gu;
  const unixLikePattern = /(?:\.{1,2}[\\/]|[A-Za-z0-9_\-./\\]+[\\/])[^\s"'`]+?\.(?:bmp|gif|jpe?g|png|svg|webp)/giu;

  for (const pattern of [quotedPattern, windowsAbsolutePattern, unixLikePattern]) {
    for (const match of text.matchAll(pattern)) {
      const candidate = (match[1] ?? match[0] ?? "").trim();

      if (candidate.length > 0) {
        candidates.add(candidate.replace(/[,.;:]+$/u, ""));
      }
    }
  }

  return Array.from(candidates);
}

async function resolveImageAttachmentFromCandidate(
  candidatePath: string,
  workspaceRootPath: string | null
): Promise<AiChatImageAttachment | null> {
  const resolvedAbsolutePath = resolveCandidateAbsolutePath(candidatePath, workspaceRootPath);

  if (!resolvedAbsolutePath) {
    return null;
  }

  const extension = path.extname(resolvedAbsolutePath).toLowerCase();

  if (!IMAGE_ATTACHMENT_EXTENSIONS.has(extension)) {
    return null;
  }

  try {
    const fileStats = await fs.stat(resolvedAbsolutePath);

    if (!fileStats.isFile() || fileStats.size > MAX_IMAGE_ATTACHMENT_FILE_BYTES) {
      return null;
    }

    const mediaType = inferImageMediaType(resolvedAbsolutePath);

    if (!mediaType) {
      return null;
    }

    const buffer = await fs.readFile(resolvedAbsolutePath);
    const sourcePath = toDisplayAttachmentPath(resolvedAbsolutePath, workspaceRootPath);

    return {
      dataUrl: `data:${mediaType};base64,${buffer.toString("base64")}`,
      id: createChatAttachmentId(sourcePath),
      mediaType,
      name: path.basename(resolvedAbsolutePath),
      sourcePath
    };
  } catch {
    return null;
  }
}

function resolveCandidateAbsolutePath(
  candidatePath: string,
  workspaceRootPath: string | null
): string | null {
  const trimmedCandidatePath = candidatePath.trim();

  if (trimmedCandidatePath.length === 0) {
    return null;
  }

  if (/^file:\/\//iu.test(trimmedCandidatePath)) {
    try {
      return path.resolve(fileURLToPath(new URL(trimmedCandidatePath)));
    } catch {
      return null;
    }
  }

  if (path.isAbsolute(trimmedCandidatePath)) {
    return path.resolve(trimmedCandidatePath);
  }

  if (!workspaceRootPath) {
    return null;
  }

  return path.resolve(workspaceRootPath, ...trimmedCandidatePath.split(/[\\/]+/u).filter(Boolean));
}

function inferImageMediaType(absolutePath: string): string | null {
  switch (path.extname(absolutePath).toLowerCase()) {
    case ".bmp":
      return "image/bmp";
    case ".gif":
      return "image/gif";
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

function toDisplayAttachmentPath(absolutePath: string, workspaceRootPath: string | null): string {
  if (!workspaceRootPath) {
    return absolutePath;
  }

  const relativePath = path.relative(workspaceRootPath, absolutePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return absolutePath;
  }

  return relativePath.split(path.sep).join("/");
}

function normalizeAttachmentSourceKey(sourcePath: string, workspaceRootPath: string | null): string {
  if (path.isAbsolute(sourcePath)) {
    return path.resolve(sourcePath).toLowerCase();
  }

  if (workspaceRootPath) {
    return path.resolve(workspaceRootPath, ...sourcePath.split(/[\\/]+/u).filter(Boolean)).toLowerCase();
  }

  return sourcePath.toLowerCase();
}

function areImageAttachmentsEquivalent(
  left: readonly AiChatImageAttachment[],
  right: readonly AiChatImageAttachment[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((attachment, index) => {
    const other = right[index];

    return (
      attachment.dataUrl === other?.dataUrl &&
      attachment.mediaType === other?.mediaType &&
      attachment.name === other?.name &&
      attachment.sourcePath === other?.sourcePath
    );
  });
}

function buildToolMessages(message: AiChatMessage): AiChatMessage[] {
  if (!message.diagnostics || message.diagnostics.toolTrace.length === 0) {
    return [];
  }

  return message.diagnostics.toolTrace.map((entry, index) => ({
    createdAt: message.createdAt,
    id: `${message.id}-tool-${index}`,
    role: "tool",
    text: entry.inputSummary,
    toolTraceEntry: entry
  }));
}

function applyPersistedApiKey(settings: PersistedAiChatSettings, apiKey: string): void {
  delete settings.apiKeyCiphertext;
  delete settings.apiKeyPlaintext;

  if (apiKey.length === 0) {
    return;
  }

  if (safeStorage.isEncryptionAvailable()) {
    settings.apiKeyCiphertext = safeStorage.encryptString(apiKey).toString("base64");
    return;
  }

  settings.apiKeyPlaintext = apiKey;
}

function decodePersistedApiKey(settings: PersistedAiChatSettings): string {
  if (typeof settings.apiKeyCiphertext === "string" && settings.apiKeyCiphertext.length > 0) {
    try {
      return safeStorage.decryptString(Buffer.from(settings.apiKeyCiphertext, "base64"));
    } catch {
      return "";
    }
  }

  return typeof settings.apiKeyPlaintext === "string" ? settings.apiKeyPlaintext : "";
}

function describeGatewayAuthSource(source: GatewayAuthSource): string {
  switch (source) {
    case "saved":
      return "AI Gateway auth source: saved API key";
    case "gateway-env":
      return "AI Gateway auth source: AI_GATEWAY_API_KEY environment variable";
    case "gateway-workspace-env-local":
      return "AI Gateway auth source: workspace .env.local AI_GATEWAY_API_KEY";
    case "gateway-workspace-env":
      return "AI Gateway auth source: workspace .env AI_GATEWAY_API_KEY";
    case "oidc-env":
      return "AI Gateway auth source: VERCEL_OIDC_TOKEN environment variable";
    default:
      return "AI Gateway auth source: not configured";
  }
}

function getModelProvider(modelId: string): string | null {
  const [provider] = modelId.split("/", 1);
  return provider?.trim().length ? provider.trim().toLowerCase() : null;
}

async function resolveGatewayAuth(
  settings: PersistedAiChatSettings,
  workspaceRootPath: string | null
): Promise<{
  source: GatewayAuthSource;
  token: string;
}> {
  const savedApiKey = decodePersistedApiKey(settings).trim();

  if (savedApiKey.length > 0) {
    return {
      source: "saved",
      token: savedApiKey
    };
  }

  const gatewayApiKey = await resolveWorkspaceSecretValue(workspaceRootPath, "AI_GATEWAY_API_KEY");

  if (gatewayApiKey.value.length > 0) {
    return {
      source:
        gatewayApiKey.source === "workspace-env-local"
          ? "gateway-workspace-env-local"
          : gatewayApiKey.source === "workspace-env"
            ? "gateway-workspace-env"
            : "gateway-env",
      token: gatewayApiKey.value
    };
  }

  const oidcToken = process.env.VERCEL_OIDC_TOKEN?.trim() ?? "";

  if (oidcToken.length > 0) {
    return {
      source: "oidc-env",
      token: oidcToken
    };
  }

  return {
    source: "unset",
    token: ""
  };
}

function describeWorkspaceSecretSource(source: WorkspaceSecretSource): string {
  switch (source) {
    case "process-env":
      return "process.env";
    case "workspace-env-local":
      return ".env.local";
    case "workspace-env":
      return ".env";
    default:
      return "not configured";
  }
}

async function resolveWorkspaceSecretValue(
  workspaceRootPath: string | null,
  key: string
): Promise<{
  source: WorkspaceSecretSource;
  value: string;
}> {
  const processValue = process.env[key]?.trim() ?? "";

  if (processValue.length > 0) {
    return {
      source: "process-env",
      value: processValue
    };
  }

  if (!workspaceRootPath) {
    return {
      source: "unset",
      value: ""
    };
  }

  for (const fileName of WORKSPACE_ENV_FILENAMES) {
    const filePath = path.join(workspaceRootPath, fileName);
    const parsedValue = await readWorkspaceEnvFileValue(filePath, key);

    if (parsedValue.length > 0) {
      return {
        source: fileName === ".env.local" ? "workspace-env-local" : "workspace-env",
        value: parsedValue
      };
    }
  }

  return {
    source: "unset",
    value: ""
  };
}

async function readWorkspaceEnvFileValue(filePath: string, key: string): Promise<string> {
  try {
    const fileContent = await fs.readFile(filePath, "utf8");
    const parsed = parseEnvFile(fileContent);
    return parsed[key]?.trim() ?? "";
  } catch {
    return "";
  }
}

function parseEnvFile(fileContent: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of fileContent.split(/\r?\n/gu)) {
    const trimmedLine = rawLine.trim();

    if (trimmedLine.length === 0 || trimmedLine.startsWith("#")) {
      continue;
    }

    const normalizedLine = trimmedLine.startsWith("export ")
      ? trimmedLine.slice("export ".length).trim()
      : trimmedLine;
    const separatorIndex = normalizedLine.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
      continue;
    }

    const rawValue = normalizedLine.slice(separatorIndex + 1).trim();
    values[key] = normalizeEnvValue(rawValue);
  }

  return values;
}

function normalizeEnvValue(rawValue: string): string {
  if (rawValue.length === 0) {
    return "";
  }

  if (
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
  ) {
    const quote = rawValue[0];
    const innerValue = rawValue.slice(1, -1);

    if (quote === '"') {
      return innerValue
        .replace(/\\n/gu, "\n")
        .replace(/\\r/gu, "\r")
        .replace(/\\"/gu, '"')
        .replace(/\\\\/gu, "\\");
    }

    return innerValue;
  }

  return rawValue.replace(/\s+#.*$/u, "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function createChatMessageId(role: "assistant" | "user"): string {
  return `chat-${role}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createChatAttachmentId(sourcePath: string): string {
  return `chat-attachment-${sourcePath.replace(/[^a-z0-9]+/giu, "-").toLowerCase()}`;
}
