import type { PluginBlockContribution } from "./manifest.js";

export declare const PLUGIN_RENDER_SET_BLOCK_MESSAGE_TYPE: "integral:set-block";
export declare const PLUGIN_RENDER_SET_SIDEBAR_VIEW_MESSAGE_TYPE: "integral:set-sidebar-view";
export declare const PLUGIN_RENDER_UPDATE_PARAMS_MESSAGE_TYPE: "integral:update-params";
export declare const PLUGIN_RENDER_REQUEST_ACTION_MESSAGE_TYPE: "integral:request-action";
export declare const PLUGIN_RENDER_ACTION_STATE_MESSAGE_TYPE: "integral:action-state";
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
    origin: "external" | "package";
    packageId: string | null;
    version: string;
  };
}

export type PluginRenderActionStatus = "error" | "idle" | "running" | "success";

export interface PluginRendererActionState {
  actionId: string | null;
  finishedAt: string | null;
  logLines: string[];
  startedAt: string | null;
  status: PluginRenderActionStatus;
  summary: string | null;
}

export interface PluginSidebarViewRendererModel {
  plugin: {
    description: string;
    displayName: string;
    id: string;
    namespace: string;
    origin: "external" | "package";
    packageId: string | null;
    version: string;
  };
  sidebarView: {
    description: string;
    icon: string | null;
    id: string;
    title: string;
  };
}

export interface BindIntegralPluginRendererOptions {
  messageType?: string;
  target?: Window;
}

export interface BindIntegralPluginActionStateOptions {
  messageType?: string;
  target?: Window;
}

export interface PostIntegralPluginParamsUpdateOptions {
  messageType?: string;
  target?: Window;
  targetOrigin?: string;
}

export interface PostIntegralPluginActionRequestOptions {
  messageType?: string;
  target?: Window;
  targetOrigin?: string;
}

export declare function bindIntegralPluginRenderer(
  render: (model: PluginRendererModel) => void,
  options?: BindIntegralPluginRendererOptions
): () => void;

export declare function bindIntegralPluginSidebarView(
  render: (model: PluginSidebarViewRendererModel) => void,
  options?: BindIntegralPluginRendererOptions
): () => void;

export declare function bindIntegralPluginActionState(
  render: (state: PluginRendererActionState) => void,
  options?: BindIntegralPluginActionStateOptions
): () => void;

export declare function postIntegralPluginParamsUpdate(
  params: Record<string, unknown>,
  options?: PostIntegralPluginParamsUpdateOptions
): void;

export declare function postIntegralPluginActionRequest(
  actionId: string,
  options?: PostIntegralPluginActionRequestOptions
): void;
