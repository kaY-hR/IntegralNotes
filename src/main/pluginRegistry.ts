import { promises as fs } from "node:fs";
import path from "node:path";

import {
  BUILTIN_PLUGIN_MANIFESTS,
  PLUGIN_MANIFEST_FILENAME,
  parsePluginManifestText,
  toInstalledPluginSummary,
  type InstalledPluginSummary,
  type PluginManifest
} from "../shared/plugins";

interface PluginRegistryOptions {
  builtinManifests?: readonly PluginManifest[];
  installRootPath: string;
}

export class PluginRegistry {
  private readonly builtinManifests: readonly PluginManifest[];
  private readonly installRootPath: string;

  constructor(options: PluginRegistryOptions) {
    this.builtinManifests = options.builtinManifests ?? BUILTIN_PLUGIN_MANIFESTS;
    this.installRootPath = path.resolve(options.installRootPath);
  }

  async listInstalledPlugins(): Promise<InstalledPluginSummary[]> {
    const builtinPlugins = this.builtinManifests.map((manifest) =>
      toInstalledPluginSummary(manifest, "builtin", null)
    );
    const externalPlugins = await this.readExternalPlugins();

    return [...builtinPlugins, ...externalPlugins].sort((left, right) => {
      if (left.origin !== right.origin) {
        return left.origin === "builtin" ? -1 : 1;
      }

      return left.displayName.localeCompare(right.displayName, "ja");
    });
  }

  private async readExternalPlugins(): Promise<InstalledPluginSummary[]> {
    let entries;

    try {
      entries = await fs.readdir(this.installRootPath, { withFileTypes: true });
    } catch (error) {
      if (isMissingPathError(error)) {
        return [];
      }

      throw error;
    }

    const plugins = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => this.readExternalPlugin(path.join(this.installRootPath, entry.name)))
    );

    return plugins.filter((plugin): plugin is InstalledPluginSummary => plugin !== null);
  }

  private async readExternalPlugin(pluginRootPath: string): Promise<InstalledPluginSummary | null> {
    const manifestPath = path.join(pluginRootPath, PLUGIN_MANIFEST_FILENAME);
    let content: string;

    try {
      content = await fs.readFile(manifestPath, "utf8");
    } catch (error) {
      if (isMissingPathError(error)) {
        return null;
      }

      throw error;
    }

    const manifest = parsePluginManifestText(content);

    if (manifest === null) {
      return null;
    }

    return toInstalledPluginSummary(manifest, "external", pluginRootPath);
  }
}

export function resolvePluginInstallRootPath(userDataPath: string): string {
  return path.join(userDataPath, "plugins");
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
