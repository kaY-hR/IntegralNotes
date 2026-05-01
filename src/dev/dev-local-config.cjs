const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const CONFIG_FILE_NAME = ".integralnotes-dev.local.json";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_DEV_PORT = 5173;
const PORT_SCAN_LIMIT = 200;

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

function parsePort(value, fallback) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number.parseInt(value.trim(), 10)
        : NaN;

  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : fallback;
}

function toSafeWorktreeId(rootDir) {
  const baseName = path.basename(rootDir).replace(/[^a-zA-Z0-9._-]+/g, "-") || "worktree";
  const hash = crypto.createHash("sha1").update(path.resolve(rootDir)).digest("hex").slice(0, 8);

  return `${baseName}-${hash}`;
}

function defaultPortForRoot(rootDir) {
  const hash = crypto.createHash("sha1").update(path.resolve(rootDir)).digest();
  const value = hash.readUInt32BE(0);

  return DEFAULT_DEV_PORT + (value % 800);
}

function resolveLocalPath(rootDir, value, fallback) {
  const candidate = typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;

  return path.resolve(rootDir, candidate);
}

function getConfigPath(rootDir = process.cwd()) {
  return path.join(path.resolve(rootDir), CONFIG_FILE_NAME);
}

function readLocalDevConfig(rootDir = process.cwd()) {
  const configPath = getConfigPath(rootDir);
  const rawConfig = readJsonFile(configPath);

  return rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig) ? rawConfig : {};
}

function getLocalDevRuntime(rootDir = process.cwd()) {
  const resolvedRootDir = path.resolve(rootDir);
  const config = readLocalDevConfig(resolvedRootDir);
  const worktreeId = toSafeWorktreeId(resolvedRootDir);
  const defaultArtifactRoot = path.join(os.tmpdir(), "integralnotes-playwright-mcp", worktreeId);
  const devPort = parsePort(
    process.env.INTEGRALNOTES_DEV_PORT ?? config.devPort,
    DEFAULT_DEV_PORT
  );
  const playwrightPort = parsePort(
    process.env.INTEGRALNOTES_PLAYWRIGHT_PORT ??
      process.env.INTEGRALNOTES_DEV_PORT ??
      config.playwrightPort ??
      config.devPort,
    devPort
  );

  return {
    config,
    configPath: getConfigPath(resolvedRootDir),
    devPort,
    devServerUrl: `http://${DEFAULT_HOST}:${devPort}`,
    host: DEFAULT_HOST,
    playwrightArtifactDir: resolveLocalPath(
      resolvedRootDir,
      process.env.INTEGRALNOTES_PLAYWRIGHT_ARTIFACT_DIR ?? config.playwrightArtifactDir,
      path.join(defaultArtifactRoot, "artifacts")
    ),
    playwrightPort,
    playwrightUserDataDir: resolveLocalPath(
      resolvedRootDir,
      process.env.INTEGRALNOTES_PLAYWRIGHT_USER_DATA_DIR ?? config.playwrightUserDataDir,
      path.join(defaultArtifactRoot, "user-data")
    ),
    rootDir: resolvedRootDir,
    worktreeId
  };
}

function isPortAvailable(port, host = DEFAULT_HOST) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function findAvailablePort(preferredPort, host = DEFAULT_HOST) {
  for (let offset = 0; offset < PORT_SCAN_LIMIT; offset += 1) {
    const port = preferredPort + offset;

    if (port > 65535) {
      break;
    }

    if (await isPortAvailable(port, host)) {
      return port;
    }
  }

  throw new Error(`No available dev port found from ${preferredPort}.`);
}

async function ensureLocalDevConfig(rootDir = process.cwd()) {
  const resolvedRootDir = path.resolve(rootDir);
  const configPath = getConfigPath(resolvedRootDir);

  if (fs.existsSync(configPath)) {
    return {
      created: false,
      runtime: getLocalDevRuntime(resolvedRootDir)
    };
  }

  const worktreeId = toSafeWorktreeId(resolvedRootDir);
  const artifactRoot = path.join(os.tmpdir(), "integralnotes-playwright-mcp", worktreeId);
  const devPort = await findAvailablePort(defaultPortForRoot(resolvedRootDir));
  const config = {
    devPort,
    playwrightArtifactDir: path.join(artifactRoot, "artifacts"),
    playwrightUserDataDir: path.join(artifactRoot, "user-data")
  };

  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  return {
    created: true,
    runtime: getLocalDevRuntime(resolvedRootDir)
  };
}

module.exports = {
  CONFIG_FILE_NAME,
  DEFAULT_DEV_PORT,
  DEFAULT_HOST,
  ensureLocalDevConfig,
  getLocalDevRuntime,
  readLocalDevConfig
};
