export declare const PLUGIN_API_VERSION: "1";
export declare const PLUGIN_HOST_RUNTIME_MODULE: "module";
export declare const PLUGIN_MANIFEST_FILENAME: "integral-plugin.json";
export declare const PLUGIN_RENDERER_MODE_IFRAME: "iframe";

export interface PluginActionContribution {
  busyLabel: string;
  id: string;
  label: string;
}

export interface PluginBlockContribution {
  actions?: PluginActionContribution[];
  description: string;
  title: string;
  type: string;
}

export interface PluginViewerContribution {
  description: string;
  displayName: string;
  extensions: string[];
  id: string;
  renderer: PluginRendererContribution;
}

export interface PluginSidebarViewContribution {
  description: string;
  icon?: string;
  id: string;
  renderer: PluginRendererContribution;
  title: string;
}

export interface PluginRendererContribution {
  entry: string;
  mode: typeof PLUGIN_RENDERER_MODE_IFRAME;
}

export interface PluginHostContribution {
  entry: string;
  runtime: typeof PLUGIN_HOST_RUNTIME_MODULE;
}

export interface PluginManifest {
  apiVersion: typeof PLUGIN_API_VERSION;
  blocks?: PluginBlockContribution[];
  description: string;
  displayName: string;
  host?: PluginHostContribution;
  id: string;
  namespace: string;
  renderer?: PluginRendererContribution;
  sidebarViews?: PluginSidebarViewContribution[];
  version: string;
  viewers?: PluginViewerContribution[];
}

export declare function definePluginManifest<T extends PluginManifest>(manifest: T): T;
