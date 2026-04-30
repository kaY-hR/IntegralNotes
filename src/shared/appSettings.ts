export interface AppSettings {
  dataRegistrationDirectory: string;
}

export interface SaveAppSettingsRequest {
  dataRegistrationDirectory?: string;
}

export const DEFAULT_DATA_REGISTRATION_DIRECTORY = "\\Data";

export const DEFAULT_APP_SETTINGS: AppSettings = {
  dataRegistrationDirectory: DEFAULT_DATA_REGISTRATION_DIRECTORY
};

const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:/u;
const INVALID_WORKSPACE_PATH_SEGMENT_PATTERN = /[<>:"|?*\u0000-\u001F]/u;

export function normalizeDataRegistrationDirectory(value: unknown): string {
  const rawValue = typeof value === "string" ? value.trim() : "";

  if (rawValue.length === 0) {
    return DEFAULT_DATA_REGISTRATION_DIRECTORY;
  }

  const slashNormalizedValue = rawValue.replace(/\\/gu, "/");

  if (WINDOWS_DRIVE_PATTERN.test(slashNormalizedValue) || slashNormalizedValue.startsWith("//")) {
    throw new Error("データ登録フォルダは workspace 内の相対フォルダを指定してください。");
  }

  const segments = slashNormalizedValue
    .replace(/^\/+/u, "")
    .replace(/\/+$/u, "")
    .split("/")
    .filter(Boolean);

  if (segments.length === 0) {
    return DEFAULT_DATA_REGISTRATION_DIRECTORY;
  }

  if (
    segments.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        INVALID_WORKSPACE_PATH_SEGMENT_PATTERN.test(segment)
    )
  ) {
    throw new Error("データ登録フォルダの path が不正です。");
  }

  if (segments[0]?.toLowerCase() === ".store") {
    throw new Error(".store 配下は system 管理領域のため指定できません。");
  }

  return `\\${segments.join("\\")}`;
}

export function toDataRegistrationDirectoryRelativePath(value: string): string {
  return normalizeDataRegistrationDirectory(value)
    .replace(/^\\+/u, "")
    .replace(/\\/gu, "/");
}
