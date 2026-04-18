import type {
  IntegralAssetCatalog,
  IntegralBlockTypeDefinition
} from "../shared/integral";

let assetCatalog: IntegralAssetCatalog = {
  datasets: [],
  blockTypes: [],
  managedFiles: []
};
let loadAssetCatalogPromise: Promise<void> | null = null;

export async function initializeIntegralPluginRuntime(): Promise<void> {
  if (loadAssetCatalogPromise) {
    return loadAssetCatalogPromise;
  }

  loadAssetCatalogPromise = window.integralNotes
    .getIntegralAssetCatalog()
    .then((catalog) => {
      assetCatalog = catalog;
    })
    .catch((error) => {
      loadAssetCatalogPromise = null;
      throw error;
    });

  return loadAssetCatalogPromise;
}

export function resetIntegralPluginRuntime(): void {
  assetCatalog = {
    datasets: [],
    blockTypes: [],
    managedFiles: []
  };
  loadAssetCatalogPromise = null;
}

export function getIntegralAssetCatalog(): IntegralAssetCatalog {
  return assetCatalog;
}

export function getInstalledIntegralBlockDefinition(
  pluginId: string,
  blockType: string
): IntegralBlockTypeDefinition | null {
  return (
    assetCatalog.blockTypes.find(
      (candidate) => candidate.pluginId === pluginId && candidate.blockType === blockType
    ) ?? null
  );
}

export function getAvailableIntegralBlockTypes(): readonly IntegralBlockTypeDefinition[] {
  return assetCatalog.blockTypes;
}


