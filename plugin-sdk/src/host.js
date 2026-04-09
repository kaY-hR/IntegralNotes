export const PLUGIN_HOST_MODULE_EXPORT = "runIntegralPluginAction";

export function createPluginActionResult({ logLines = [], summary }) {
  return {
    logLines,
    summary
  };
}

export function definePluginHost(runIntegralPluginAction) {
  return {
    [PLUGIN_HOST_MODULE_EXPORT]: runIntegralPluginAction
  };
}
