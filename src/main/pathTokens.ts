import path from "node:path";

const APP_DIRECTORY_NAME = "IntegralNotes";

interface PathToken {
  absolutePath: string;
  token: string;
}

export function getIntegralLocalDataRootPath(): string | null {
  const localAppDataPath = resolveLocalAppDataPath();
  return localAppDataPath ? path.join(localAppDataPath, APP_DIRECTORY_NAME) : null;
}

export function getIntegralGlobalRootPath(): string | null {
  const localRootPath = getIntegralLocalDataRootPath();
  return localRootPath ? path.join(localRootPath, "global") : null;
}

export function getIntegralPackageRootPath(): string | null {
  const localRootPath = getIntegralLocalDataRootPath();
  return localRootPath ? path.join(localRootPath, "packages") : null;
}

export function getIntegralRuntimePluginRootPath(): string | null {
  const localRootPath = getIntegralLocalDataRootPath();
  return localRootPath ? path.join(localRootPath, "runtime-plugins") : null;
}

export function getGlobalAnalysisScriptRootPaths(): string[] {
  const roots: string[] = [];
  const globalRootPath = getIntegralGlobalRootPath();

  if (globalRootPath) {
    roots.push(path.join(globalRootPath, "scripts"));
  }

  return roots;
}

export function getIntegralNotesGlobalSkillRootPaths(): string[] {
  const roots: string[] = [];
  const globalRootPath = getIntegralGlobalRootPath();

  if (globalRootPath) {
    roots.push(path.join(globalRootPath, "skills"));
  }

  return roots;
}

export function getLegacyIntegralExtensionRootPaths(): string[] {
  const roots: string[] = [];
  const localRootPath = getIntegralLocalDataRootPath();
  const appDataPath = resolveAppDataPath();

  if (localRootPath) {
    roots.push(
      path.join(localRootPath, "analysis-stock"),
      path.join(localRootPath, "plugins"),
      path.join(localRootPath, "skills")
    );
  }

  if (appDataPath) {
    roots.push(
      path.join(appDataPath, APP_DIRECTORY_NAME, "plugins"),
      path.join(appDataPath, `${APP_DIRECTORY_NAME}-dev`, "plugins")
    );
  }

  return roots;
}

export function shortenPathWithTokens(absolutePath: string): string {
  const resolvedPath = path.resolve(absolutePath);
  const token = findMatchingPathToken(resolvedPath);

  if (!token) {
    return toDisplayPath(resolvedPath);
  }

  const relativePath = path.relative(token.absolutePath, resolvedPath);

  if (relativePath.length === 0) {
    return token.token;
  }

  return `${token.token}/${toDisplayPath(relativePath)}`;
}

export function expandPathTokens(value: string): string {
  const trimmed = value.trim();

  for (const token of getPathTokens()) {
    if (trimmed === token.token) {
      return token.absolutePath;
    }

    const prefix = `${token.token}/`;

    if (trimmed.startsWith(prefix)) {
      return path.resolve(token.absolutePath, ...trimmed.slice(prefix.length).split(/[\\/]+/u));
    }
  }

  return trimmed;
}

export function toDisplayPath(value: string): string {
  return value.replace(/\\/gu, "/");
}

function findMatchingPathToken(absolutePath: string): PathToken | null {
  const normalizedPath = path.resolve(absolutePath).toLowerCase();
  const matches = getPathTokens()
    .filter((token) => {
      const normalizedRoot = path.resolve(token.absolutePath).toLowerCase();
      return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}${path.sep}`);
    })
    .sort((left, right) => right.absolutePath.length - left.absolutePath.length);

  return matches[0] ?? null;
}

function getPathTokens(): PathToken[] {
  const tokens: PathToken[] = [];
  const localAppDataPath = resolveLocalAppDataPath();
  const appDataPath = resolveAppDataPath();
  const userProfilePath = resolveUserProfilePath();

  if (localAppDataPath) {
    tokens.push({ absolutePath: path.resolve(localAppDataPath), token: "%LocalAppData%" });
  }

  if (appDataPath) {
    tokens.push({ absolutePath: path.resolve(appDataPath), token: "%AppData%" });
  }

  if (userProfilePath) {
    tokens.push({ absolutePath: path.resolve(userProfilePath), token: "%UserProfile%" });
  }

  return tokens;
}

function resolveLocalAppDataPath(): string | null {
  const configuredPath = process.env.LOCALAPPDATA?.trim();

  if (configuredPath) {
    return path.resolve(configuredPath);
  }

  const userProfilePath = resolveUserProfilePath();
  return userProfilePath ? path.join(userProfilePath, "AppData", "Local") : null;
}

function resolveAppDataPath(): string | null {
  const configuredPath = process.env.APPDATA?.trim();
  return configuredPath ? path.resolve(configuredPath) : null;
}

function resolveUserProfilePath(): string | null {
  const configuredPath = process.env.USERPROFILE?.trim() || process.env.HOME?.trim();
  return configuredPath ? path.resolve(configuredPath) : null;
}
