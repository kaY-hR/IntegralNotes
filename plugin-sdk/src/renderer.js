export const PLUGIN_RENDER_MESSAGE_TYPE = "integral:set-block";

export function bindIntegralPluginRenderer(render, options = {}) {
  const target = options.target ?? window;
  const messageType = options.messageType ?? PLUGIN_RENDER_MESSAGE_TYPE;

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
