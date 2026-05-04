export interface AppSettings {
  analysisResultDirectory: string;
  dataRegistrationDirectory: string;
  linkPickerRanking: LinkPickerRankingSettings;
  userId: string;
}

export interface LinkPickerRankingSettings {
  embedLinkExtensions: string[];
  normalLinkExtensions: string[];
}

export interface SaveAppSettingsRequest {
  analysisResultDirectory?: string;
  dataRegistrationDirectory?: string;
  linkPickerRanking?: Partial<LinkPickerRankingSettings>;
  userId?: string;
}

export const DEFAULT_ANALYSIS_RESULT_DIRECTORY = "\\analysis-result";
export const DEFAULT_DATA_REGISTRATION_DIRECTORY = "\\Data";
export const DEFAULT_USER_ID = "";
export const DEFAULT_LINK_PICKER_RANKING: LinkPickerRankingSettings = {
  embedLinkExtensions: [
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".svg",
    ".bmp",
    ".html",
    ".htm",
    ".md"
  ],
  normalLinkExtensions: [
    ".md",
    ".idts",
    ".csv",
    ".tsv",
    ".json",
    ".py",
    ".txt",
    ".html",
    ".htm"
  ]
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  analysisResultDirectory: DEFAULT_ANALYSIS_RESULT_DIRECTORY,
  dataRegistrationDirectory: DEFAULT_DATA_REGISTRATION_DIRECTORY,
  linkPickerRanking: DEFAULT_LINK_PICKER_RANKING,
  userId: DEFAULT_USER_ID
};

const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:/u;
const INVALID_WORKSPACE_PATH_SEGMENT_PATTERN = /[<>:"|?*\u0000-\u001F]/u;
const INVALID_USER_ID_PATTERN = /[\s<>:"/\\|?*\u0000-\u001F]/u;
const LINK_PICKER_EXTENSION_PATTERN = /^\.[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/u;

function normalizeWorkspaceDirectory(
  value: unknown,
  defaultValue: string,
  label: string
): string {
  const rawValue = typeof value === "string" ? value.trim() : "";

  if (rawValue.length === 0) {
    return defaultValue;
  }

  const slashNormalizedValue = rawValue.replace(/\\/gu, "/");

  if (WINDOWS_DRIVE_PATTERN.test(slashNormalizedValue) || slashNormalizedValue.startsWith("//")) {
    throw new Error(`${label}は workspace 内の相対フォルダを指定してください。`);
  }

  const segments = slashNormalizedValue
    .replace(/^\/+/u, "")
    .replace(/\/+$/u, "")
    .split("/")
    .filter(Boolean);

  if (segments.length === 0) {
    return defaultValue;
  }

  if (
    segments.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        INVALID_WORKSPACE_PATH_SEGMENT_PATTERN.test(segment)
    )
  ) {
    throw new Error(`${label}の path が不正です。`);
  }

  if (segments[0]?.toLowerCase() === ".store") {
    throw new Error(".store 配下は system 管理領域のため指定できません。");
  }

  return `\\${segments.join("\\")}`;
}

export function normalizeAnalysisResultDirectory(value: unknown): string {
  return normalizeWorkspaceDirectory(
    value,
    DEFAULT_ANALYSIS_RESULT_DIRECTORY,
    "解析結果フォルダ"
  );
}

export function normalizeDataRegistrationDirectory(value: unknown): string {
  return normalizeWorkspaceDirectory(
    value,
    DEFAULT_DATA_REGISTRATION_DIRECTORY,
    "データ登録フォルダ"
  );
}

export function toAnalysisResultDirectoryRelativePath(value: string): string {
  return normalizeAnalysisResultDirectory(value)
    .replace(/^\\+/u, "")
    .replace(/\\/gu, "/");
}

export function toDataRegistrationDirectoryRelativePath(value: string): string {
  return normalizeDataRegistrationDirectory(value)
    .replace(/^\\+/u, "")
    .replace(/\\/gu, "/");
}

export function normalizeUserId(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (normalized.length === 0) {
    return DEFAULT_USER_ID;
  }

  if (
    normalized === "." ||
    normalized === ".." ||
    INVALID_USER_ID_PATTERN.test(normalized)
  ) {
    throw new Error("ユーザーIDには空白やファイル名に使えない文字を含められません。");
  }

  return normalized;
}

export function normalizeLinkPickerRankingSettings(
  value: unknown,
  fallback: LinkPickerRankingSettings = DEFAULT_LINK_PICKER_RANKING
): LinkPickerRankingSettings {
  const record = isRecord(value) ? value : {};

  return {
    embedLinkExtensions: normalizeExtensionPriorityList(
      record.embedLinkExtensions,
      fallback.embedLinkExtensions,
      "埋め込みリンク優先拡張子"
    ),
    normalLinkExtensions: normalizeExtensionPriorityList(
      record.normalLinkExtensions,
      fallback.normalLinkExtensions,
      "通常リンク優先拡張子"
    )
  };
}

function normalizeExtensionPriorityList(
  value: unknown,
  fallback: readonly string[],
  label: string
): string[] {
  const sourceValues = Array.isArray(value) ? value : fallback;
  const normalizedValues: string[] = [];

  for (const rawValue of sourceValues) {
    if (typeof rawValue !== "string") {
      throw new Error(`${label}は拡張子のリストで指定してください。`);
    }

    const normalized = normalizeLinkPickerExtension(rawValue);

    if (!normalizedValues.includes(normalized)) {
      normalizedValues.push(normalized);
    }
  }

  return normalizedValues.length > 0 ? normalizedValues : [...fallback];
}

function normalizeLinkPickerExtension(value: string): string {
  const trimmed = value.trim();
  const normalized = (trimmed.startsWith(".") ? trimmed : `.${trimmed}`).toLowerCase();

  if (!LINK_PICKER_EXTENSION_PATTERN.test(normalized)) {
    throw new Error(`link picker の優先拡張子が不正です: ${value}`);
  }

  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
