export const PLUGIN_RENDER_SET_BLOCK_MESSAGE_TYPE = "integral:set-block";
export const PLUGIN_RENDER_UPDATE_PARAMS_MESSAGE_TYPE = "integral:update-params";
export const PLUGIN_RENDER_REQUEST_ACTION_MESSAGE_TYPE = "integral:request-action";
export const PLUGIN_RENDER_ACTION_STATE_MESSAGE_TYPE = "integral:action-state";
export const PLUGIN_RENDER_MESSAGE_TYPE = PLUGIN_RENDER_SET_BLOCK_MESSAGE_TYPE;

export function bindIntegralPluginRenderer(render, options = {}) {
  return bindIntegralPluginMessage(render, {
    ...options,
    messageType: options.messageType ?? PLUGIN_RENDER_SET_BLOCK_MESSAGE_TYPE
  });
}

export function postIntegralPluginParamsUpdate(params, options = {}) {
  postIntegralPluginMessage(
    {
      params: isRecord(params) ? params : {}
    },
    {
      ...options,
      messageType: options.messageType ?? PLUGIN_RENDER_UPDATE_PARAMS_MESSAGE_TYPE
    }
  );
}

export function bindIntegralPluginActionState(render, options = {}) {
  return bindIntegralPluginMessage(render, {
    ...options,
    messageType: options.messageType ?? PLUGIN_RENDER_ACTION_STATE_MESSAGE_TYPE
  });
}

export function postIntegralPluginActionRequest(actionId, options = {}) {
  if (!isNonEmptyString(actionId)) {
    return;
  }

  postIntegralPluginMessage(
    {
      actionId
    },
    {
      ...options,
      messageType: options.messageType ?? PLUGIN_RENDER_REQUEST_ACTION_MESSAGE_TYPE
    }
  );
}

function bindIntegralPluginMessage(render, options = {}) {
  const target = options.target ?? window;
  const messageType = options.messageType;

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

function postIntegralPluginMessage(payload, options = {}) {
  const target = options.target ?? window.parent;
  const targetOrigin = options.targetOrigin ?? "*";
  const messageType = options.messageType;

  target.postMessage(
    {
      payload,
      type: messageType
    },
    targetOrigin
  );
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
