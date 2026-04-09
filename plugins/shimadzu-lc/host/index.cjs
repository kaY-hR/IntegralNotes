"use strict";

module.exports.runIntegralPluginAction = async function runIntegralPluginAction(context) {
  const payload = parsePayload(context.payload);
  const params = payload?.params ?? {};
  const timeProgram = Array.isArray(params["time-prog"]) ? params["time-prog"] : [];
  const analysisTime =
    typeof params["analysis-time"] === "number" ? params["analysis-time"] : null;

  await wait(180);

  return {
    logLines: [
      `Plugin: ${context.plugin.displayName}`,
      `Action: ${context.actionId}`,
      `Gradient points: ${timeProgram.length}`,
      analysisTime === null ? "Analysis time: unset" : `Analysis time: ${analysisTime} min`,
      "Host module: shimadzu-lc/host/index.cjs"
    ],
    summary: "Shimadzu LC plugin が勾配プログラム action を受理しました。"
  };
};

function parsePayload(payload) {
  try {
    const parsed = JSON.parse(payload);

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function wait(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
