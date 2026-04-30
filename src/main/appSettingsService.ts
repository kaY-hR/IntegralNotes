import { promises as fs } from "node:fs";
import path from "node:path";

import {
  DEFAULT_APP_SETTINGS,
  normalizeAnalysisResultDirectory,
  normalizeDataRegistrationDirectory,
  normalizeUserId,
  type AppSettings,
  type SaveAppSettingsRequest
} from "../shared/appSettings";

export class AppSettingsService {
  constructor(private readonly settingsFilePath: string) {}

  async getSettings(): Promise<AppSettings> {
    return this.readPersistedSettings();
  }

  async saveSettings(request: SaveAppSettingsRequest): Promise<AppSettings> {
    const currentSettings = await this.readPersistedSettings();
    const nextSettings: AppSettings = {
      ...currentSettings,
      analysisResultDirectory:
        request.analysisResultDirectory === undefined
          ? currentSettings.analysisResultDirectory
          : normalizeAnalysisResultDirectory(request.analysisResultDirectory),
      dataRegistrationDirectory:
        request.dataRegistrationDirectory === undefined
          ? currentSettings.dataRegistrationDirectory
          : normalizeDataRegistrationDirectory(request.dataRegistrationDirectory),
      userId:
        request.userId === undefined
          ? currentSettings.userId
          : normalizeUserId(request.userId)
    };

    await this.writePersistedSettings(nextSettings);
    return nextSettings;
  }

  private async readPersistedSettings(): Promise<AppSettings> {
    try {
      const raw = await fs.readFile(this.settingsFilePath, "utf8");
      const parsed: unknown = JSON.parse(raw);

      if (!isRecord(parsed)) {
        return DEFAULT_APP_SETTINGS;
      }

      return {
        analysisResultDirectory: normalizeAnalysisResultDirectory(
          parsed.analysisResultDirectory
        ),
        dataRegistrationDirectory: normalizeDataRegistrationDirectory(
          parsed.dataRegistrationDirectory
        ),
        userId: normalizeUserId(parsed.userId)
      };
    } catch (error) {
      if (isNodeError(error) && error.code !== "ENOENT") {
        console.warn("[AppSettings] Failed to read persisted settings.", error);
      }

      return DEFAULT_APP_SETTINGS;
    }
  }

  private async writePersistedSettings(settings: AppSettings): Promise<void> {
    await fs.mkdir(path.dirname(this.settingsFilePath), { recursive: true });
    await fs.writeFile(this.settingsFilePath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
