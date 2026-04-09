import type { PluginBlockContribution } from "./manifest.js";

export declare const PLUGIN_RENDER_MESSAGE_TYPE: "integral:set-block";

export interface PluginRendererBlock {
  params?: Record<string, unknown>;
  type: string;
}

export interface PluginRendererModel {
  block: PluginRendererBlock;
  blockDefinition: PluginBlockContribution;
  plugin: {
    description: string;
    displayName: string;
    id: string;
    namespace: string;
    origin: "external";
    version: string;
  };
}

export interface BindIntegralPluginRendererOptions {
  messageType?: string;
  target?: Window;
}

export declare function bindIntegralPluginRenderer(
  render: (model: PluginRendererModel) => void,
  options?: BindIntegralPluginRendererOptions
): () => void;
