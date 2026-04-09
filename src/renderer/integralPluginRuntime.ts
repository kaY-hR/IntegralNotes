import type { InstalledPluginDefinition } from "../shared/plugins";

import type {
  IntegralBlockActionDefinition,
  IntegralBlockDefinition
} from "./integralBlockRegistry";

let installedPlugins: InstalledPluginDefinition[] = [];
let loadInstalledPluginsPromise: Promise<void> | null = null;
const rendererDocumentCache = new Map<string, Promise<string>>();

export async function initializeIntegralPluginRuntime(): Promise<void> {
  if (loadInstalledPluginsPromise) {
    return loadInstalledPluginsPromise;
  }

  loadInstalledPluginsPromise = window.integralNotes
    .listInstalledPlugins()
    .then((plugins) => {
      installedPlugins = plugins;
    })
    .catch((error) => {
      loadInstalledPluginsPromise = null;
      throw error;
    });

  return loadInstalledPluginsPromise;
}

export function resetIntegralPluginRuntime(): void {
  installedPlugins = [];
  loadInstalledPluginsPromise = null;
  rendererDocumentCache.clear();
}

export function getInstalledIntegralBlockDefinition(type: string): IntegralBlockDefinition | null {
  for (const plugin of installedPlugins) {
    for (const block of plugin.blocks) {
      if (block.type === type) {
        return {
          actions: block.actions?.map(toIntegralBlockActionDefinition),
          description: block.description,
          hasRenderer: plugin.hasRenderer,
          pluginDescription: plugin.description,
          pluginDisplayName: plugin.displayName,
          pluginId: plugin.id,
          pluginNamespace: plugin.namespace,
          pluginOrigin: plugin.origin,
          pluginVersion: plugin.version,
          title: block.title,
          type: block.type
        };
      }
    }
  }

  return null;
}

export async function loadIntegralPluginRendererDocument(pluginId: string): Promise<string | null> {
  const plugin = installedPlugins.find((candidate) => candidate.id === pluginId);

  if (!plugin || !plugin.hasRenderer) {
    return null;
  }

  let pendingDocument = rendererDocumentCache.get(pluginId);

  if (!pendingDocument) {
    pendingDocument = window.integralNotes.loadPluginRendererDocument(pluginId);
    rendererDocumentCache.set(pluginId, pendingDocument);
  }

  try {
    return await pendingDocument;
  } catch (error) {
    rendererDocumentCache.delete(pluginId);
    throw error;
  }
}

function toIntegralBlockActionDefinition(action: {
  busyLabel: string;
  id: string;
  label: string;
}): IntegralBlockActionDefinition {
  return {
    busyLabel: action.busyLabel,
    id: action.id,
    label: action.label
  };
}
