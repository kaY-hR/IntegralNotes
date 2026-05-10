interface JsonRecord {
  [key: string]: unknown;
}

export const INTEGRAL_PACKAGE_API_VERSION = "1";
export const INTEGRAL_PACKAGE_MANIFEST_FILENAME = "integral-package.json";

export interface IntegralPackageExports {
  pythonBlocks: string[];
  runtimePlugins: string[];
  skills: string[];
}

export interface IntegralPackageManifest {
  apiVersion: typeof INTEGRAL_PACKAGE_API_VERSION;
  displayName: string;
  exports: IntegralPackageExports;
  id: string;
  version: string;
}

export function parseIntegralPackageManifestText(content: string): IntegralPackageManifest | null {
  try {
    return parseIntegralPackageManifest(JSON.parse(content));
  } catch {
    return null;
  }
}

export function parseIntegralPackageManifest(value: unknown): IntegralPackageManifest | null {
  if (!isJsonRecord(value)) {
    return null;
  }

  const apiVersion = readNonEmptyString(value.apiVersion);
  const id = readNonEmptyString(value.id);
  const displayName = readNonEmptyString(value.displayName);
  const version = readNonEmptyString(value.version);
  const rawExports = value.exports;

  if (
    apiVersion !== INTEGRAL_PACKAGE_API_VERSION ||
    id === null ||
    displayName === null ||
    version === null ||
    !isSafePackageId(id) ||
    !isJsonRecord(rawExports)
  ) {
    return null;
  }

  const exportsValue: IntegralPackageExports = {
    pythonBlocks: readExportPathArray(rawExports.pythonBlocks).filter(isSafePythonBlockExport),
    runtimePlugins: readExportPathArray(rawExports.runtimePlugins).filter(isSafePackageRelativePath),
    skills: readExportPathArray(rawExports.skills).filter(isSafePackageRelativePath)
  };

  return {
    apiVersion,
    displayName,
    exports: exportsValue,
    id,
    version
  };
}

export function isSafePackageId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value);
}

export function isSafePackageRelativePath(value: string): boolean {
  const normalized = normalizePackagePath(value);

  return (
    normalized.length > 0 &&
    normalized !== "." &&
    !normalized.startsWith("../") &&
    !normalized.includes("/../") &&
    !normalized.includes(":") &&
    !normalized.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  );
}

export function parsePythonBlockExport(value: string): {
  functionName: string;
  scriptPath: string;
} | null {
  const separatorIndex = value.lastIndexOf(":");

  if (separatorIndex <= 0 || separatorIndex >= value.length - 1) {
    return null;
  }

  const scriptPath = normalizePackagePath(value.slice(0, separatorIndex));
  const functionName = value.slice(separatorIndex + 1).trim();

  if (
    !isSafePackageRelativePath(scriptPath) ||
    !scriptPath.startsWith("scripts/") ||
    !scriptPath.toLowerCase().endsWith(".py") ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(functionName)
  ) {
    return null;
  }

  return {
    functionName,
    scriptPath
  };
}

export function normalizePackagePath(value: string): string {
  return value.trim().replace(/\\/gu, "/").replace(/^\/+/u, "");
}

function isSafePythonBlockExport(value: string): boolean {
  return parsePythonBlockExport(value) !== null;
}

function readExportPathArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? normalizePackagePath(item) : ""))
    .filter((item) => item.length > 0);
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
