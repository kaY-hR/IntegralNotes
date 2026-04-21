import { safeStorage } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AiChatContextSummary,
  AiChatImageAttachment,
  AiChatModelOption,
  AiChatMessage,
  AiChatStatus,
  SaveAiChatSettingsRequest,
  SubmitAiChatRequest,
  SubmitAiChatResult
} from "../shared/aiChat";
import { AiAgentService, type AiAgentExecutionRuntime } from "./aiAgentService";
import { WorkspaceService } from "./workspaceService";

interface PersistedAiChatSettings {
  apiKeyCiphertext?: string;
  apiKeyPlaintext?: string;
  selectedModelId?: string | null;
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
const MAX_IMAGE_ATTACHMENT_FILE_BYTES = 8_000_000;
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
    private readonly settingsFilePath: string
  ) {}

  async getStatus(): Promise<AiChatStatus> {
    const workspaceRootPath = this.workspaceService.currentRootPath ?? null;
    const [catalog, settings] = await Promise.all([
      this.getModelCatalog(false),
      this.readPersistedSettings()
    ]);
    const selectedModelId = selectValidModelId(settings.selectedModelId ?? null, catalog.models);
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
      implementationMode: runtimeSelection.mode,
      mcpEnabled: true,
      modelCatalogSource: catalog.source,
      notes: [
        "Activity Bar から FlexLayout tab を開く UI は接続済みです。",
        "AI Gateway のモデル一覧は live fetch を試み、失敗時は fallback を使います。",
        describeGatewayAuthSource(gatewayAuth.source),
        ...runtimeSelection.notes,
        ...byokNotes
      ],
      providerLabel: runtimeSelection.providerLabel,
      selectedModelId,
      skillsDirectoryPath:
        workspaceRootPath === null ? null : path.join(workspaceRootPath, ".codex", "skills"),
      workspaceRootPath
    };
  }

  async saveSettings(request: SaveAiChatSettingsRequest): Promise<AiChatStatus> {
    const currentSettings = await this.readPersistedSettings();
    const nextSettings: PersistedAiChatSettings = {
      ...currentSettings,
      selectedModelId: request.modelId
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

  async submit(request: SubmitAiChatRequest): Promise<SubmitAiChatResult> {
    const prompt = request.prompt.trim();

    if (prompt.length === 0) {
      throw new Error("プロンプトが空です。");
    }

    const workspaceRootPath = this.workspaceService.currentRootPath ?? null;
    const [status, settings] = await Promise.all([this.getStatus(), this.readPersistedSettings()]);
    const selectedModelId = status.selectedModelId ?? FALLBACK_MODELS[0]?.id ?? "openai/gpt-5.4";
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
              runtimeSelection
            }))
          };
    const toolMessages = buildToolMessages(assistantMessage);

    return {
      messages: [...toolMessages, assistantMessage],
      userMessage: normalizedHistoryResult.updatedUserMessage
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
        selectedModelId: typeof parsed.selectedModelId === "string" ? parsed.selectedModelId : null
      };
    } catch {
      return {};
    }
  }

  private async writePersistedSettings(settings: PersistedAiChatSettings): Promise<void> {
    await fs.mkdir(path.dirname(this.settingsFilePath), { recursive: true });
    await fs.writeFile(this.settingsFilePath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
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
          `chat 送信は ${describeDirectProviderLabel(directProvider.provider)} + ToolLoopAgent を使います。workspace 探索は bash-tool、real save は writeWorkspaceFile、bash/writeFile は overlay preview 扱いです。`,
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
          "chat 送信は AI Gateway + ToolLoopAgent を使います。workspace 探索は bash-tool、real save は writeWorkspaceFile、bash/writeFile は overlay preview 扱いです。",
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
    runtimeSelection
  }: {
    context: AiChatContextSummary;
    history: SubmitAiChatRequest["history"];
    runtimeSelection: Extract<ResolvedAiRuntime, { mode: "direct" | "gateway" }>;
  }): Promise<Pick<AiChatMessage, "diagnostics" | "text">> {
    try {
      const result = await this.aiAgentService.submit({
        context,
        history,
        runtime: runtimeSelection.runtime
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

function buildStubResponse(
  prompt: string,
  context: AiChatContextSummary,
  historyLength: number,
  status: AiChatStatus
): string {
  const lines = [
    "AI Chat runtime stub が応答しています。",
    "現在は renderer -> preload -> main process の配線まで実装済みで、認証がある場合は direct provider または AI Gateway + ToolLoopAgent + bash-tool を使います。",
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
