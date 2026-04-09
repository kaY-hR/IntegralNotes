import type { PluginBlockContribution } from "./manifest.js";

export declare const PLUGIN_RENDER_SET_BLOCK_MESSAGE_TYPE: "integral:set-block";
export declare const PLUGIN_RENDER_UPDATE_PARAMS_MESSAGE_TYPE: "integral:update-params";
export declare const PLUGIN_RENDER_MESSAGE_TYPE: "integral:set-block";

export interface PluginRendererBlock extends Record<string, unknown> {
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

export interface PostIntegralPluginParamsUpdateOptions {
  messageType?: string;
  target?: Window;
  targetOrigin?: string;
}

export declare function bindIntegralPluginRenderer(
  render: (model: PluginRendererModel) => void,
  options?: BindIntegralPluginRendererOptions
): () => void;

export declare function postIntegralPluginParamsUpdate(
  params: Record<string, unknown>,
  options?: PostIntegralPluginParamsUpdateOptions
): void;
