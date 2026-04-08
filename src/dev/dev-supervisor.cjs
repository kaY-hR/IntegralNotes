const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const electronPath = require("electron");

const HOST = "127.0.0.1";
const PORT = 5173;
const DEV_SERVER_URL = `http://${HOST}:${PORT}`;
const ROOT_DIR = process.cwd();
const MAIN_ENTRY = path.join(ROOT_DIR, "dist-electron", "main", "main.js");
const MAIN_OUTPUT_DIR = path.dirname(MAIN_ENTRY);
const RENDERER_SCRIPT = path.join(ROOT_DIR, "src", "dev", "start-renderer.cjs");
const TSC_BIN = path.join(path.dirname(require.resolve("typescript/package.json")), "bin", "tsc");

let shuttingDown = false;
let launchInProgress = false;
let pendingRestart = false;
let rendererProcess = null;
let mainWatchProcess = null;
let electronProcess = null;
let mainOutputWatcher = null;
let launchPollTimer = null;
let restartTimer = null;

function canConnectTcp(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });

    const finish = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };

    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(1200, () => finish(false));
  });
}

function canServeHttp(host, port) {
  return new Promise((resolve) => {
    const request = http.request(
      {
        host,
        port,
        path: "/",
        method: "GET",
        timeout: 1500
      },
      (response) => {
        response.resume();
        resolve(true);
      }
    );

    request.once("error", () => resolve(false));
    request.once("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.end();
  });
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function spawnManaged(command, args, options = {}) {
  return spawn(command, args, {
    cwd: ROOT_DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      ...options.env
    }
  });
}

function killProcessTree(child) {
  if (!child || child.exitCode !== null || child.killed) {
    return Promise.resolve();
  }

  if (process.platform === "win32") {
    return new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore"
      });

      killer.once("exit", () => resolve());
      killer.once("error", () => resolve());
    });
  }

  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  if (launchPollTimer) {
    clearInterval(launchPollTimer);
    launchPollTimer = null;
  }

  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  if (mainOutputWatcher) {
    mainOutputWatcher.close();
    mainOutputWatcher = null;
  }

  const children = [electronProcess, mainWatchProcess, rendererProcess].filter(Boolean);
  await Promise.all(children.map((child) => killProcessTree(child)));
  process.exit(exitCode);
}

function ensureMainOutputWatcher() {
  if (mainOutputWatcher || !exists(MAIN_OUTPUT_DIR)) {
    return;
  }

  mainOutputWatcher = fs.watch(MAIN_OUTPUT_DIR, { recursive: true }, (_eventType, filename) => {
    if (shuttingDown || !filename || !/\.(c?js|mjs)$/iu.test(filename)) {
      return;
    }

    if (restartTimer) {
      clearTimeout(restartTimer);
    }

    restartTimer = setTimeout(() => {
      restartTimer = null;

      if (shuttingDown) {
        return;
      }

      if (!electronProcess) {
        void maybeLaunchElectron();
        return;
      }

      pendingRestart = true;
      void killProcessTree(electronProcess);
    }, 180);
  });

  mainOutputWatcher.on("error", (error) => {
    console.error("[dev] Failed to watch Electron output.", error);
    void shutdown(1);
  });
}

async function isLaunchReady() {
  if (!exists(MAIN_ENTRY)) {
    return false;
  }

  const tcpOpen = await canConnectTcp(HOST, PORT);

  if (!tcpOpen) {
    return false;
  }

  return canServeHttp(HOST, PORT);
}

async function maybeLaunchElectron() {
  if (shuttingDown || launchInProgress || electronProcess) {
    return;
  }

  launchInProgress = true;

  try {
    const ready = await isLaunchReady();

    if (!ready || shuttingDown || electronProcess) {
      return;
    }

    ensureMainOutputWatcher();
    electronProcess = spawnManaged(String(electronPath), [MAIN_ENTRY], {
      env: {
        VITE_DEV_SERVER_URL: DEV_SERVER_URL
      }
    });

    electronProcess.once("exit", (code, signal) => {
      electronProcess = null;

      if (shuttingDown) {
        return;
      }

      if (pendingRestart) {
        pendingRestart = false;
        return;
      }

      if (signal || code === 0 || code === null) {
        void shutdown(0);
        return;
      }

      void shutdown(code ?? 1);
    });
  } finally {
    launchInProgress = false;
  }
}

function monitorRendererProcess(child) {
  child.once("exit", (code) => {
    rendererProcess = null;

    if (shuttingDown) {
      return;
    }

    if (code === 0) {
      void (async () => {
        await wait(300);

        if (!(await canServeHttp(HOST, PORT))) {
          console.error("[dev] Renderer process exited before the Vite server became reachable.");
          await shutdown(1);
        }
      })();
      return;
    }

    console.error(`[dev] Renderer process exited unexpectedly with code ${code ?? 1}.`);
    void shutdown(code ?? 1);
  });
}

function monitorMainWatchProcess(child) {
  child.once("exit", (code) => {
    mainWatchProcess = null;

    if (shuttingDown) {
      return;
    }

    console.error(`[dev] TypeScript watcher exited unexpectedly with code ${code ?? 1}.`);
    void shutdown(code ?? 1);
  });
}

async function main() {
  rendererProcess = spawnManaged(process.execPath, [RENDERER_SCRIPT]);
  monitorRendererProcess(rendererProcess);

  mainWatchProcess = spawnManaged(process.execPath, [
    TSC_BIN,
    "-p",
    "tsconfig.node.json",
    "--watch",
    "--preserveWatchOutput"
  ]);
  monitorMainWatchProcess(mainWatchProcess);

  launchPollTimer = setInterval(() => {
    void maybeLaunchElectron();
  }, 300);

  await maybeLaunchElectron();
}

process.on("SIGINT", () => {
  void shutdown(0);
});

process.on("SIGTERM", () => {
  void shutdown(0);
});

main().catch((error) => {
  console.error(error);
  void shutdown(1);
});
