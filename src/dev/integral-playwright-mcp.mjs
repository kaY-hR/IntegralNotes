#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { _electron as playwrightElectron } from "playwright-core";
import { z } from "zod";
import electronPath from "electron";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const HOST = "127.0.0.1";
const PORT = Number.parseInt(process.env.INTEGRALNOTES_PLAYWRIGHT_PORT ?? "5173", 10);
const DEV_SERVER_URL = process.env.INTEGRALNOTES_PLAYWRIGHT_DEV_SERVER_URL ?? `http://${HOST}:${PORT}`;
const MAIN_ENTRY = path.join(ROOT_DIR, "dist-electron", "main", "main.js");
const MAIN_SOURCE_DIR = path.join(ROOT_DIR, "src", "main");
const SHARED_SOURCE_DIR = path.join(ROOT_DIR, "src", "shared");
const RENDERER_SCRIPT = path.join(ROOT_DIR, "src", "dev", "start-renderer.cjs");
const TSC_BIN = path.join(path.dirname(require.resolve("typescript/package.json")), "bin", "tsc");
const DEFAULT_ARTIFACT_DIR = path.join(os.tmpdir(), "integralnotes-playwright-mcp");
const DEFAULT_USER_DATA_DIR = path.join(DEFAULT_ARTIFACT_DIR, "user-data");
const MAX_LOG_CHARS = 20000;
const DEFAULT_TIMEOUT_MS = 30000;

let electronApp = null;
let currentPage = null;
let rendererProcess = null;
let childLog = "";

function appendChildLog(prefix, chunk) {
  const text = chunk.toString("utf8");
  childLog = `${childLog}${prefix}${text}`;

  if (childLog.length > MAX_LOG_CHARS) {
    childLog = childLog.slice(childLog.length - MAX_LOG_CHARS);
  }
}

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

function canServeHttp(url) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const request = http.request(
      {
        host: parsed.hostname,
        port: Number.parseInt(parsed.port, 10) || 80,
        path: "/",
        method: "GET",
        timeout: 1500
      },
      (response) => {
        response.resume();
        resolve(Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 500));
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

async function waitUntil(label, timeoutMs, probe) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await probe()) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(`${label} timed out after ${timeoutMs}ms.${suffix}`);
}

function spawnBuffered(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      ...options.env
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  child.stdout.on("data", (chunk) => appendChildLog(options.logPrefix ?? "", chunk));
  child.stderr.on("data", (chunk) => appendChildLog(options.logPrefix ?? "", chunk));

  return child;
}

function runBuffered(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        ...options.env
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    const timeout = setTimeout(() => {
      void killProcessTree(child).then(() => {
        reject(new Error(`${command} ${args.join(" ")} timed out after ${options.timeoutMs}ms`));
      });
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? 1}\n${stderr || stdout}`));
    });
  });
}

function killProcessTree(child) {
  if (!child || child.exitCode !== null || child.killed) {
    return Promise.resolve();
  }

  if (process.platform === "win32") {
    return new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true
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

async function ensureRendererStarted(timeoutMs) {
  if (await canServeHttp(DEV_SERVER_URL)) {
    return "reused";
  }

  if (!rendererProcess || rendererProcess.exitCode !== null) {
    rendererProcess = spawnBuffered(process.execPath, [RENDERER_SCRIPT], {
      logPrefix: "[renderer] "
    });
  }

  await waitUntil("renderer dev server", timeoutMs, () => canServeHttp(DEV_SERVER_URL));
  return "started";
}

async function ensureMainBuilt(rebuildMain, timeoutMs) {
  if (!rebuildMain && fsSync.existsSync(MAIN_ENTRY) && !(await isMainBuildStale())) {
    return "reused";
  }

  await runBuffered(process.execPath, [TSC_BIN, "-p", "tsconfig.node.json"], {
    timeoutMs,
    env: {
      ELECTRON_SKIP_BINARY_DOWNLOAD: "1"
    }
  });

  return "built";
}

async function getNewestMtimeMs(directoryPath) {
  let newest = 0;
  const entries = await fs.readdir(directoryPath, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      newest = Math.max(newest, await getNewestMtimeMs(entryPath));
      continue;
    }

    if (!/\.(cjs|mjs|ts|tsx)$/iu.test(entry.name)) {
      continue;
    }

    const stats = await fs.stat(entryPath);
    newest = Math.max(newest, stats.mtimeMs);
  }

  return newest;
}

async function isMainBuildStale() {
  const mainEntryStats = await fs.stat(MAIN_ENTRY).catch(() => null);

  if (!mainEntryStats) {
    return true;
  }

  const sourceMtimeMs = Math.max(
    await getNewestMtimeMs(MAIN_SOURCE_DIR),
    await getNewestMtimeMs(SHARED_SOURCE_DIR)
  );

  return sourceMtimeMs > mainEntryStats.mtimeMs;
}

async function getPage(timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!electronApp) {
    throw new Error("IntegralNotes is not launched. Call integral_launch first.");
  }

  if (currentPage && !currentPage.isClosed()) {
    return currentPage;
  }

  const openWindow = electronApp.windows().find((windowPage) => !windowPage.isClosed());
  currentPage = openWindow ?? (await electronApp.firstWindow({ timeout: timeoutMs }));
  currentPage.setDefaultTimeout(timeoutMs);

  return currentPage;
}

async function launchIntegralNotes(args) {
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (electronApp && !args.forceRelaunch) {
    const page = await getPage(timeoutMs);
    return {
      reusedApp: true,
      title: await page.title(),
      url: page.url()
    };
  }

  if (electronApp) {
    await closeIntegralNotes({ force: true, closeRenderer: false });
  }

  const rendererStatus = args.startRenderer === false ? "skipped" : await ensureRendererStarted(timeoutMs);
  const mainStatus = await ensureMainBuilt(Boolean(args.rebuildMain), timeoutMs);
  const resolvedWorkspacePath = args.workspacePath ? path.resolve(ROOT_DIR, args.workspacePath) : undefined;
  const userDataPath = path.resolve(args.userDataPath ?? DEFAULT_USER_DATA_DIR);

  await fs.mkdir(userDataPath, { recursive: true });

  electronApp = await playwrightElectron.launch({
    executablePath: String(electronPath),
    args: [MAIN_ENTRY],
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: DEV_SERVER_URL,
      INTEGRALNOTES_USER_DATA_DIR: userDataPath,
      ...(resolvedWorkspacePath ? { INTEGRALNOTES_DEFAULT_WORKSPACE: resolvedWorkspacePath } : {})
    },
    timeout: timeoutMs
  });
  electronApp.on("close", () => {
    electronApp = null;
    currentPage = null;
  });

  const page = await getPage(timeoutMs);
  await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs }).catch(() => undefined);

  return {
    reusedApp: false,
    rendererStatus,
    mainStatus,
    title: await page.title(),
    url: page.url(),
    workspacePath: resolvedWorkspacePath ?? null,
    userDataPath
  };
}

async function closeIntegralNotes(args = {}) {
  if (electronApp) {
    const appToClose = electronApp;
    electronApp = null;
    currentPage = null;

    if (args.force !== false) {
      await appToClose.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    } else {
      await appToClose.close().catch(() => undefined);
    }
  }

  if (args.closeRenderer && rendererProcess) {
    await killProcessTree(rendererProcess);
    rendererProcess = null;
  }

  return {
    closedApp: true,
    closedRenderer: Boolean(args.closeRenderer)
  };
}

function toolText(value) {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2)
      }
    ]
  };
}

function toolError(error) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: error instanceof Error ? error.message : String(error)
      }
    ]
  };
}

function selectLocator(page, args) {
  if (args.selector) {
    return page.locator(args.selector).first();
  }

  if (args.role && args.name) {
    return page.getByRole(args.role, {
      name: args.name,
      exact: args.exact ?? false
    }).first();
  }

  if (args.text) {
    return page.getByText(args.text, {
      exact: args.exact ?? false
    }).first();
  }

  throw new Error("Specify selector, role+name, or text.");
}

function clipJson(value, maxChars = 12000) {
  const text = typeof value === "undefined" ? "undefined" : JSON.stringify(value, null, 2);
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n... truncated ...` : text;
}

const timeoutSchema = z
  .number()
  .int()
  .min(1000)
  .max(120000)
  .optional()
  .describe("Timeout in milliseconds. Defaults to 30000.");

const locatorSchema = {
  selector: z.string().optional().describe("CSS selector or Playwright selector."),
  role: z.string().optional().describe("ARIA role, for example button, textbox, tab, link."),
  name: z.string().optional().describe("Accessible name used with role."),
  text: z.string().optional().describe("Visible text to locate."),
  exact: z.boolean().optional().describe("Use exact text/name matching."),
  timeoutMs: timeoutSchema
};

const server = new McpServer({
  name: "integralnotes-playwright",
  version: "0.1.0"
});

server.tool(
  "integral_launch",
  {
    workspacePath: z.string().optional().describe("Workspace path. Relative paths resolve from the repository root."),
    userDataPath: z.string().optional().describe("Automation-only Electron userData path."),
    rebuildMain: z.boolean().optional().describe("Run tsc for the Electron main process before launch."),
    startRenderer: z.boolean().optional().describe("Start or reuse the Vite renderer server. Defaults to true."),
    forceRelaunch: z.boolean().optional().describe("Close an existing Playwright-owned app before launching."),
    timeoutMs: timeoutSchema
  },
  async (args) => {
    try {
      return toolText(await launchIntegralNotes(args));
    } catch (error) {
      return toolError(error);
    }
  }
);

server.tool(
  "integral_status",
  {
    includeLogs: z.boolean().optional().describe("Include buffered child process logs.")
  },
  async (args) => {
    try {
      const launched = Boolean(electronApp);
      const page = launched ? await getPage() : null;

      return toolText({
        launched,
        title: page ? await page.title() : null,
        url: page ? page.url() : null,
        windows: electronApp ? electronApp.windows().length : 0,
        rendererOwned: Boolean(rendererProcess && rendererProcess.exitCode === null),
        logs: args.includeLogs ? childLog : undefined
      });
    } catch (error) {
      return toolError(error);
    }
  }
);

server.tool(
  "integral_snapshot",
  {
    maxTextLength: z.number().int().min(500).max(30000).optional().describe("Maximum body text chars.")
  },
  async (args) => {
    try {
      const page = await getPage();
      const snapshot = await page.evaluate((maxTextLength) => {
        const escapeCss = (value) => {
          if (globalThis.CSS?.escape) {
            return globalThis.CSS.escape(value);
          }

          return value.replace(/["\\]/gu, "\\$&");
        };
        const textOf = (element) => {
          const typedElement = element;
          const candidate =
            typedElement.getAttribute("aria-label") ??
            typedElement.getAttribute("title") ??
            typedElement.value ??
            typedElement.innerText ??
            typedElement.textContent ??
            "";

          return String(candidate).replace(/\s+/gu, " ").trim().slice(0, 160);
        };
        const isVisible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);

          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        const selectorOf = (element) => {
          const id = element.getAttribute("id");

          if (id) {
            return `#${escapeCss(id)}`;
          }

          const testId = element.getAttribute("data-testid");

          if (testId) {
            return `[data-testid="${escapeCss(testId)}"]`;
          }

          const ariaLabel = element.getAttribute("aria-label");

          if (ariaLabel) {
            return `${element.tagName.toLowerCase()}[aria-label="${escapeCss(ariaLabel)}"]`;
          }

          const parts = [];
          let cursor = element;

          while (cursor && cursor.nodeType === Node.ELEMENT_NODE && parts.length < 4) {
            const tagName = cursor.tagName.toLowerCase();
            const parent = cursor.parentElement;

            if (!parent) {
              parts.unshift(tagName);
              break;
            }

            const siblings = Array.from(parent.children).filter((sibling) => sibling.tagName === cursor.tagName);
            const index = siblings.indexOf(cursor) + 1;
            parts.unshift(siblings.length > 1 ? `${tagName}:nth-of-type(${index})` : tagName);
            cursor = parent;
          }

          return parts.join(" > ");
        };
        const interactiveSelector = [
          "button",
          "a[href]",
          "input",
          "textarea",
          "select",
          "[role='button']",
          "[role='link']",
          "[role='menuitem']",
          "[role='tab']",
          "[contenteditable='true']",
          "[tabindex]:not([tabindex='-1'])"
        ].join(",");
        const interactive = Array.from(document.querySelectorAll(interactiveSelector))
          .filter(isVisible)
          .slice(0, 100)
          .map((element, index) => ({
            index,
            selector: selectorOf(element),
            tag: element.tagName.toLowerCase(),
            role: element.getAttribute("role"),
            text: textOf(element)
          }));

        return {
          title: document.title,
          url: location.href,
          bodyText: (document.body?.innerText ?? "").slice(0, maxTextLength),
          interactive
        };
      }, args.maxTextLength ?? 12000);

      return toolText(snapshot);
    } catch (error) {
      return toolError(error);
    }
  }
);

server.tool("integral_click", locatorSchema, async (args) => {
  try {
    const page = await getPage(args.timeoutMs);
    await selectLocator(page, args).click({ timeout: args.timeoutMs ?? DEFAULT_TIMEOUT_MS });

    return toolText({ clicked: true });
  } catch (error) {
    return toolError(error);
  }
});

server.tool(
  "integral_fill",
  {
    ...locatorSchema,
    value: z.string().describe("Text to fill.")
  },
  async (args) => {
    try {
      const page = await getPage(args.timeoutMs);
      await selectLocator(page, args).fill(args.value, { timeout: args.timeoutMs ?? DEFAULT_TIMEOUT_MS });

      return toolText({ filled: true });
    } catch (error) {
      return toolError(error);
    }
  }
);

server.tool(
  "integral_press",
  {
    selector: z.string().optional().describe("Optional selector to focus before pressing."),
    key: z.string().describe("Playwright keyboard key, for example Enter, Escape, Control+S."),
    timeoutMs: timeoutSchema
  },
  async (args) => {
    try {
      const page = await getPage(args.timeoutMs);

      if (args.selector) {
        await page.locator(args.selector).first().press(args.key, { timeout: args.timeoutMs ?? DEFAULT_TIMEOUT_MS });
      } else {
        await page.keyboard.press(args.key);
      }

      return toolText({ pressed: args.key });
    } catch (error) {
      return toolError(error);
    }
  }
);

server.tool(
  "integral_wait_for",
  {
    ...locatorSchema,
    state: z.enum(["attached", "detached", "visible", "hidden"]).optional().describe("Selector wait state.")
  },
  async (args) => {
    try {
      const page = await getPage(args.timeoutMs);

      if (args.selector) {
        await page
          .locator(args.selector)
          .first()
          .waitFor({ state: args.state ?? "visible", timeout: args.timeoutMs ?? DEFAULT_TIMEOUT_MS });
      } else {
        await selectLocator(page, args).waitFor({ state: "visible", timeout: args.timeoutMs ?? DEFAULT_TIMEOUT_MS });
      }

      return toolText({ waited: true });
    } catch (error) {
      return toolError(error);
    }
  }
);

server.tool(
  "integral_evaluate",
  {
    expression: z.string().describe("JavaScript expression evaluated in the renderer page."),
    timeoutMs: timeoutSchema
  },
  async (args) => {
    try {
      const page = await getPage(args.timeoutMs);
      const result = await page.evaluate((expression) => {
        return globalThis.eval(expression);
      }, args.expression);

      return toolText(clipJson(result));
    } catch (error) {
      return toolError(error);
    }
  }
);

server.tool(
  "integral_screenshot",
  {
    path: z.string().optional().describe("Output PNG path. Defaults to a temp artifact directory."),
    fullPage: z.boolean().optional().describe("Capture full page."),
    timeoutMs: timeoutSchema
  },
  async (args) => {
    try {
      const page = await getPage(args.timeoutMs);
      const outputPath = path.resolve(
        args.path ?? path.join(DEFAULT_ARTIFACT_DIR, `screenshot-${Date.now()}.png`)
      );
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      const buffer = await page.screenshot({
        path: outputPath,
        fullPage: args.fullPage ?? true,
        timeout: args.timeoutMs ?? DEFAULT_TIMEOUT_MS
      });

      return {
        content: [
          {
            type: "text",
            text: `saved: ${outputPath}`
          },
          {
            type: "image",
            data: buffer.toString("base64"),
            mimeType: "image/png"
          }
        ]
      };
    } catch (error) {
      return toolError(error);
    }
  }
);

server.tool(
  "integral_close",
  {
    force: z.boolean().optional().describe("Force app exit through Electron app.exit(0). Defaults to true."),
    closeRenderer: z.boolean().optional().describe("Also stop the renderer dev server owned by this MCP process.")
  },
  async (args) => {
    try {
      return toolText(await closeIntegralNotes(args));
    } catch (error) {
      return toolError(error);
    }
  }
);

process.on("SIGINT", () => {
  void closeIntegralNotes({ force: true, closeRenderer: true }).finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void closeIntegralNotes({ force: true, closeRenderer: true }).finally(() => process.exit(0));
});

await server.connect(new StdioServerTransport());
console.error("[integral-playwright-mcp] ready");
