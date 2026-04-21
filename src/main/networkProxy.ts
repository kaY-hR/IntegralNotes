import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

interface ProxyConfiguration {
  httpProxy: string;
  httpsProxy: string;
  noProxy: string;
  sourceSummary: string[];
}

export function initializeNetworkProxyFromEnvironment(): void {
  const proxyConfiguration = resolveProxyConfiguration();

  if (!proxyConfiguration) {
    return;
  }

  mirrorStandardProxyEnvironment(proxyConfiguration);

  try {
    setGlobalDispatcher(
      new EnvHttpProxyAgent({
        httpProxy: proxyConfiguration.httpProxy || undefined,
        httpsProxy: proxyConfiguration.httpsProxy || undefined,
        noProxy: proxyConfiguration.noProxy || undefined
      })
    );

    console.info("[AI Chat/Main] configured global proxy dispatcher", {
      httpProxy: summarizeProxyUrl(proxyConfiguration.httpProxy),
      httpsProxy: summarizeProxyUrl(proxyConfiguration.httpsProxy),
      noProxy: proxyConfiguration.noProxy || null,
      sources: proxyConfiguration.sourceSummary
    });
  } catch (error) {
    console.warn("[AI Chat/Main] failed to configure global proxy dispatcher", error);
  }
}

function resolveProxyConfiguration(): ProxyConfiguration | null {
  const httpProxy = firstDefinedEnvValue([
    "HTTP_PROXY",
    "http_proxy",
    "PROXY_HTTP",
    "proxy_http"
  ]);
  const httpsProxy =
    firstDefinedEnvValue([
      "HTTPS_PROXY",
      "https_proxy",
      "PROXY_HTTPS",
      "proxy_https"
    ]) ?? httpProxy;
  const noProxy = firstDefinedEnvValue([
    "NO_PROXY",
    "no_proxy",
    "PROXY_NO",
    "proxy_no"
  ]);

  if (!httpProxy && !httpsProxy) {
    return null;
  }

  return {
    httpProxy: httpProxy ?? "",
    httpsProxy: httpsProxy ?? "",
    noProxy: noProxy ?? "",
    sourceSummary: [
      summarizeEnvSource(["HTTP_PROXY", "http_proxy", "PROXY_HTTP", "proxy_http"], httpProxy ?? ""),
      summarizeEnvSource(
        ["HTTPS_PROXY", "https_proxy", "PROXY_HTTPS", "proxy_https"],
        httpsProxy ?? ""
      ),
      summarizeEnvSource(["NO_PROXY", "no_proxy", "PROXY_NO", "proxy_no"], noProxy ?? "")
    ].filter((value): value is string => value !== null)
  };
}

function mirrorStandardProxyEnvironment(proxyConfiguration: ProxyConfiguration): void {
  assignEnvIfMissing(["HTTP_PROXY", "http_proxy"], proxyConfiguration.httpProxy);
  assignEnvIfMissing(["HTTPS_PROXY", "https_proxy"], proxyConfiguration.httpsProxy);

  if (proxyConfiguration.noProxy) {
    assignEnvIfMissing(["NO_PROXY", "no_proxy"], proxyConfiguration.noProxy);
  }
}

function assignEnvIfMissing(keys: readonly string[], value: string): void {
  if (!value) {
    return;
  }

  for (const key of keys) {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function firstDefinedEnvValue(keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = process.env[key]?.trim();

    if (value) {
      return value;
    }
  }

  return null;
}

function summarizeEnvSource(keys: readonly string[], resolvedValue: string): string | null {
  if (!resolvedValue) {
    return null;
  }

  const matchedKey = keys.find((key) => process.env[key]?.trim() === resolvedValue);
  return matchedKey ?? keys[0] ?? null;
}

function summarizeProxyUrl(value: string): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    const port = url.port ? `:${url.port}` : "";
    return `${url.protocol}//${url.hostname}${port}`;
  } catch {
    return "(configured)";
  }
}
