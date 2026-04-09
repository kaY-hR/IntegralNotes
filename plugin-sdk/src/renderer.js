export const PLUGIN_RENDER_SET_BLOCK_MESSAGE_TYPE = "integral:set-block";
export const PLUGIN_RENDER_UPDATE_PARAMS_MESSAGE_TYPE = "integral:update-params";
export const PLUGIN_RENDER_MESSAGE_TYPE = PLUGIN_RENDER_SET_BLOCK_MESSAGE_TYPE;

export function bindIntegralPluginRenderer(render, options = {}) {
  const target = options.target ?? window;
  const messageType = options.messageType ?? PLUGIN_RENDER_SET_BLOCK_MESSAGE_TYPE;

  const handleMessage = (event) => {
    if (!event?.data || event.data.type !== messageType) {
      return;
    }

    render(event.data.payload);
  };

  target.addEventListener("message", handleMessage);

  return () => {
    target.removeEventListener("message", handleMessage);
  };
}

export function postIntegralPluginParamsUpdate(params, options = {}) {
  const target = options.target ?? window.parent;
  const targetOrigin = options.targetOrigin ?? "*";
  const messageType = options.messageType ?? PLUGIN_RENDER_UPDATE_PARAMS_MESSAGE_TYPE;

  target.postMessage(
    {
      payload: {
        params: isRecord(params) ? params : {}
      },
      type: messageType
    },
    targetOrigin
  );
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
