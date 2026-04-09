"use strict";

module.exports.runIntegralPluginAction = async function runIntegralPluginAction(context) {
  const payload = parsePayload(context.payload);
  const params = payload?.params ?? {};
  const datasets = Array.isArray(params.data)
    ? params.data.filter((item) => typeof item === "string" && item.trim().length > 0)
    : [];

  await wait(160);

  return {
    logLines: [
      `Plugin: ${context.plugin.displayName}`,
      `Action: ${context.actionId}`,
      `Datasets: ${datasets.length}`,
      datasets.length > 0 ? `Input: ${datasets.join(", ")}` : "Input: not set",
      "Host module: standard-graphs/host/index.cjs"
    ],
    summary: "Standard Graphs plugin がクロマトグラム解析 action を受理しました。"
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
