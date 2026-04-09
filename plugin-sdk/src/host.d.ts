export declare const PLUGIN_HOST_MODULE_EXPORT: "runIntegralPluginAction";

export interface PluginHostActionContext {
  actionId: string;
  blockType: string;
  params?: Record<string, unknown>;
  payload: string;
  plugin: {
    description: string;
    displayName: string;
    id: string;
    namespace: string;
    origin: "external";
    sourcePath: string | null;
    version: string;
  };
}

export interface PluginHostActionResult {
  logLines: string[];
  summary: string;
}

export declare function createPluginActionResult(result: PluginHostActionResult): PluginHostActionResult;

export declare function definePluginHost(
  runIntegralPluginAction: (
    context: PluginHostActionContext
  ) => Promise<PluginHostActionResult> | PluginHostActionResult
): {
  [PLUGIN_HOST_MODULE_EXPORT]: (
    context: PluginHostActionContext
  ) => Promise<PluginHostActionResult> | PluginHostActionResult;
};
