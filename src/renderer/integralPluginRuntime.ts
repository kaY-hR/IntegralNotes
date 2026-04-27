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
let catalogLoadVersion = 0;

export async function initializeIntegralPluginRuntime(): Promise<void> {
  if (loadAssetCatalogPromise) {
    return loadAssetCatalogPromise;
  }

  const loadVersion = catalogLoadVersion;
  loadAssetCatalogPromise = window.integralNotes
    .getIntegralAssetCatalog()
    .then((catalog) => {
      if (loadVersion === catalogLoadVersion) {
        assetCatalog = catalog;
      }
    })
    .catch((error) => {
      if (loadVersion === catalogLoadVersion) {
        loadAssetCatalogPromise = null;
      }
      throw error;
    });

  return loadAssetCatalogPromise;
}

export function setIntegralPluginRuntimeCatalog(catalog: IntegralAssetCatalog): void {
  catalogLoadVersion += 1;
  assetCatalog = catalog;
  loadAssetCatalogPromise = Promise.resolve();
}

export function resetIntegralPluginRuntime(): void {
  catalogLoadVersion += 1;
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


