const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { getLocalDevRuntime } = require("./dev-local-config.cjs");

const localDevRuntime = getLocalDevRuntime(process.cwd());
const HOST = localDevRuntime.host;
const PORT = localDevRuntime.devPort;
const APP_MARKER_PATH = "/src/renderer/App.tsx";
const APP_MARKER_TEXT = "Open Folder";

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

function requestText(host, port, pathName) {
  return new Promise((resolve) => {
    const request = http.request(
      {
        host,
        port,
        path: pathName,
        method: "GET",
        timeout: 1500
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({
            ok: response.statusCode && response.statusCode >= 200 && response.statusCode < 300,
            body
          });
        });
      }
    );

    request.once("error", () => resolve({ ok: false, body: "" }));
    request.once("timeout", () => {
      request.destroy();
      resolve({ ok: false, body: "" });
    });
    request.end();
  });
}

async function main() {
  const tcpOpen = await canConnectTcp(HOST, PORT);

  if (tcpOpen) {
    const httpReady = await canServeHttp(HOST, PORT);

    if (!httpReady) {
      console.error(
        `[dev:renderer] Port ${PORT} is already in use, but it does not look like a reusable Vite server.`
      );
      process.exit(1);
      return;
    }

    const markerResponse = await requestText(HOST, PORT, APP_MARKER_PATH);

    if (!markerResponse.ok || !markerResponse.body.includes(APP_MARKER_TEXT)) {
      console.error(
        `[dev:renderer] Port ${PORT} is serving another app. Close the existing server or free the port before starting IntegralNotes.`
      );
      process.exit(1);
      return;
    }

    console.log(`[dev:renderer] Reusing existing renderer on http://${HOST}:${PORT}`);
    return;
  }

  const vitePackageJson = require.resolve("vite/package.json");
  const viteBin = path.join(path.dirname(vitePackageJson), "bin", "vite.js");
  const child = spawn(process.execPath, [viteBin, "--host", HOST, "--port", String(PORT), "--strictPort"], {
    stdio: "inherit",
    env: {
      ...process.env,
      INTEGRALNOTES_DEV_PORT: String(PORT)
    },
    cwd: process.cwd()
  });

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on("SIGINT", forwardSignal);
  process.on("SIGTERM", forwardSignal);

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
