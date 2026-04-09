export declare const INTEGRAL_NOTES_PRODUCT_NAME: "IntegralNotes";
export declare const INTEGRAL_NOTES_PLUGIN_DIRECTORY: "plugins";

export interface PluginInstallerEnvironment {
  APPDATA?: string;
  INTEGRALNOTES_PLUGIN_INSTALL_ROOT?: string;
  INTEGRALNOTES_USER_DATA_PATH?: string;
  XDG_CONFIG_HOME?: string;
}

export interface PluginInstallerPathOptions {
  env?: PluginInstallerEnvironment;
  homeDirectory?: string;
  platform?: string;
  targetRootPath?: string;
  userDataPath?: string;
}

export interface BasicPluginManifest {
  id: string;
}

export interface InstallLocalPluginOptions extends PluginInstallerPathOptions {
  pluginRootPath: string;
  targetDirectoryName?: string;
}

export interface InstallLocalPluginResult {
  installedPluginPath: string;
  manifest: BasicPluginManifest;
  pluginRootPath: string;
  targetDirectoryName: string;
  targetRootPath: string;
}

export interface UninstallLocalPluginOptions extends PluginInstallerPathOptions {
  pluginId?: string;
  pluginRootPath?: string;
  targetDirectoryName?: string;
}

export interface UninstallLocalPluginResult {
  installedPluginPath: string;
  pluginId: string;
  removed: boolean;
  targetDirectoryName: string;
  targetRootPath: string;
}

export declare function installLocalPlugin(
  options: InstallLocalPluginOptions
): Promise<InstallLocalPluginResult>;

export declare function uninstallLocalPlugin(
  options: UninstallLocalPluginOptions
): Promise<UninstallLocalPluginResult>;

export declare function readPluginManifestFromDirectory(
  pluginRootPath: string
): Promise<BasicPluginManifest>;

export declare function resolveIntegralPluginInstallRootPath(
  options?: PluginInstallerPathOptions
): string;

export declare function resolveIntegralNotesUserDataPath(options?: PluginInstallerPathOptions): string;

export declare function sanitizePluginDirectoryName(pluginId: string): string;
