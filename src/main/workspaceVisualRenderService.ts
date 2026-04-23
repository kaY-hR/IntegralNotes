import { BrowserWindow, app } from "electron";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveWorkspaceMarkdownTarget } from "../shared/workspaceLinks";
import type { WorkspaceFileDocument } from "../shared/workspace";
import { WorkspaceService } from "./workspaceService";

const DEFAULT_RENDER_WAIT_MS = 1200;
const DEFAULT_RENDER_WIDTH = 1280;
const DEFAULT_WINDOW_HEIGHT = 900;
const MAX_RENDER_HEIGHT = 1800;
const MAX_RENDER_WAIT_MS = 5000;
const MAX_RENDER_WIDTH = 2200;
const MIN_RENDER_HEIGHT = 720;
const MIN_RENDER_WIDTH = 640;

export interface WorkspaceRenderedDocument {
  base64Data: string;
  height: number;
  mediaType: "image/png";
  path: string;
  renderReadiness: string;
  sourceKind: WorkspaceFileDocument["kind"];
  width: number;
}

export class WorkspaceVisualRenderService {
  constructor(private readonly workspaceService: WorkspaceService) {}

  async renderWorkspaceDocument(
    relativePath: string,
    options?: {
      waitMs?: number;
      width?: number;
    }
  ): Promise<WorkspaceRenderedDocument> {
    const document = await this.workspaceService.readWorkspaceFile(relativePath);

    if (document.kind !== "html" && document.kind !== "markdown" && document.kind !== "text") {
      throw new Error(
        `Unsupported document kind for visual rendering: ${document.kind} (${document.relativePath})`
      );
    }

    const absolutePath = this.workspaceService.getAbsolutePath(document.relativePath);
    const htmlDocument = await this.buildRenderableDocument(document, absolutePath);
    const width = clampNumber(options?.width ?? DEFAULT_RENDER_WIDTH, MIN_RENDER_WIDTH, MAX_RENDER_WIDTH);
    const waitMs = clampNumber(options?.waitMs ?? DEFAULT_RENDER_WAIT_MS, 0, MAX_RENDER_WAIT_MS);

    return this.captureHtmlDocument(htmlDocument, {
      path: document.relativePath,
      sourceKind: document.kind,
      waitMs,
      width
    });
  }

  private async buildRenderableDocument(
    document: WorkspaceFileDocument,
    absolutePath: string
  ): Promise<string> {
    const baseHref = `${pathToFileURL(path.dirname(absolutePath)).href.replace(/\/?$/u, "/")}`;
    const workspaceRootPath = this.workspaceService.currentRootPath;

    switch (document.kind) {
      case "html":
        return prepareHtmlDocumentForCapture(document.content ?? "", workspaceRootPath);
      case "markdown":
        return renderMarkdownSnapshotDocument(
          document.content ?? "",
          document.name,
          baseHref,
          workspaceRootPath
        );
      case "text":
        return createTextSnapshotDocument(document.content ?? "", document.name, baseHref, workspaceRootPath);
    }

    throw new Error(`Unsupported document kind for visual rendering: ${document.kind}`);
  }

  private async captureHtmlDocument(
    htmlDocument: string,
    options: {
      path: string;
      sourceKind: WorkspaceFileDocument["kind"];
      waitMs: number;
      width: number;
    }
  ): Promise<WorkspaceRenderedDocument> {
    const tempDirectoryPath = path.join(app.getPath("temp"), "integral-notes-ai-render");
    const tempFilePath = path.join(tempDirectoryPath, `${randomUUID()}.html`);
    let window: BrowserWindow | null = null;

    await fs.mkdir(tempDirectoryPath, { recursive: true });
    await fs.writeFile(tempFilePath, htmlDocument, "utf8");

    try {
      window = new BrowserWindow({
        backgroundColor: "#ffffff",
        height: DEFAULT_WINDOW_HEIGHT,
        paintWhenInitiallyHidden: true,
        show: false,
        useContentSize: true,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          spellcheck: false
        },
        width: options.width
      });

      const tempFileUrl = pathToFileURL(tempFilePath).href;

      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event, url) => {
        if (url !== tempFileUrl) {
          event.preventDefault();
        }
      });

      await window.loadFile(tempFilePath);
      const renderReadiness = await waitForVisualReadiness(window);

      if (options.waitMs > 0) {
        await delay(options.waitMs);
      }

      const contentHeight = await measureDocumentHeight(window);
      window.setContentSize(options.width, clampNumber(contentHeight, MIN_RENDER_HEIGHT, MAX_RENDER_HEIGHT));
      await settleAfterResize(window);

      const capturedImage = await window.webContents.capturePage();
      const size = capturedImage.getSize();

      return {
        base64Data: capturedImage.toPNG().toString("base64"),
        height: size.height,
        mediaType: "image/png",
        path: options.path,
        renderReadiness,
        sourceKind: options.sourceKind,
        width: size.width
      };
    } finally {
      if (window && !window.isDestroyed()) {
        window.destroy();
      }

      await fs.rm(tempFilePath, { force: true }).catch(() => undefined);
    }
  }
}

async function renderMarkdownSnapshotDocument(
  markdown: string,
  title: string,
  baseHref: string,
  workspaceRootPath: string | undefined
): Promise<string> {
  const { gfm, gfmHtml } = await importEsmModule<typeof import("micromark-extension-gfm")>(
    "micromark-extension-gfm"
  );
  const { micromark } = await importEsmModule<typeof import("micromark")>("micromark");
  const renderedBody = micromark(markdown, {
    allowDangerousHtml: true,
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()]
  });

  return createSnapshotShell({
    baseHref,
    bodyClassName: "workspace-render workspace-render--markdown",
    bodyHtml: `<article class="workspace-render__article">${rewriteWorkspaceRootUrls(
      renderedBody,
      workspaceRootPath
    )}</article>`,
    extraCss: `
      .workspace-render--markdown {
        padding: 28px 32px 48px;
      }

      .workspace-render__article {
        margin: 0 auto;
        max-width: 980px;
      }

      .workspace-render__article h1,
      .workspace-render__article h2,
      .workspace-render__article h3,
      .workspace-render__article h4,
      .workspace-render__article h5,
      .workspace-render__article h6 {
        color: #0f172a;
        line-height: 1.25;
        margin: 1.4em 0 0.55em;
      }

      .workspace-render__article p,
      .workspace-render__article li,
      .workspace-render__article blockquote {
        font-size: 15px;
        line-height: 1.72;
      }

      .workspace-render__article p,
      .workspace-render__article ul,
      .workspace-render__article ol,
      .workspace-render__article blockquote,
      .workspace-render__article pre,
      .workspace-render__article table {
        margin: 0 0 1rem;
      }

      .workspace-render__article img,
      .workspace-render__article video,
      .workspace-render__article iframe,
      .workspace-render__article canvas,
      .workspace-render__article svg {
        display: block;
        height: auto;
        max-width: 100%;
      }

      .workspace-render__article pre,
      .workspace-render__article code {
        font-family: "Cascadia Code", "Consolas", "SFMono-Regular", monospace;
      }

      .workspace-render__article pre {
        background: #111827;
        border-radius: 12px;
        color: #f8fafc;
        overflow: auto;
        padding: 14px 16px;
      }

      .workspace-render__article code {
        background: rgba(15, 23, 42, 0.08);
        border-radius: 6px;
        padding: 0.12rem 0.32rem;
      }

      .workspace-render__article pre code {
        background: transparent;
        padding: 0;
      }

      .workspace-render__article blockquote {
        background: rgba(14, 116, 144, 0.08);
        border-left: 4px solid #0891b2;
        border-radius: 10px;
        color: #164e63;
        margin-left: 0;
        padding: 10px 14px;
      }

      .workspace-render__article table {
        border-collapse: collapse;
        width: 100%;
      }

      .workspace-render__article th,
      .workspace-render__article td {
        border: 1px solid rgba(148, 163, 184, 0.4);
        padding: 8px 10px;
        text-align: left;
      }

      .workspace-render__article thead tr {
        background: rgba(226, 232, 240, 0.75);
      }
    `,
    title
  });
}

function createTextSnapshotDocument(
  content: string,
  title: string,
  baseHref: string,
  workspaceRootPath: string | undefined
): string {
  return createSnapshotShell({
    baseHref,
    bodyClassName: "workspace-render workspace-render--text",
    bodyHtml: `<pre class="workspace-render__text">${escapeHtml(
      rewriteWorkspaceRootUrls(content, workspaceRootPath)
    )}</pre>`,
    extraCss: `
      .workspace-render--text {
        padding: 18px;
      }

      .workspace-render__text {
        background: #fbfcfd;
        border: 1px solid rgba(148, 163, 184, 0.35);
        border-radius: 12px;
        color: #1f2937;
        font-family: "Cascadia Code", "Consolas", "SFMono-Regular", monospace;
        font-size: 12px;
        line-height: 1.58;
        margin: 0;
        min-height: calc(100vh - 36px);
        overflow-wrap: anywhere;
        padding: 14px 16px;
        white-space: pre-wrap;
      }
    `,
    title
  });
}

function prepareHtmlDocumentForCapture(
  htmlDocument: string,
  workspaceRootPath: string | undefined
): string {
  const normalized = rewriteWorkspaceRootUrls(htmlDocument, workspaceRootPath);
  const captureStyle = `<style id="integral-ai-capture-style">
    html, body {
      background: #ffffff;
    }
  </style>`;

  if (normalized.includes("</head>")) {
    return normalized.replace("</head>", `${captureStyle}\n</head>`);
  }

  if (normalized.includes("<body")) {
    return normalized.replace(/<body(\s[^>]*)?>/iu, (match) => `${match}\n${captureStyle}`);
  }

  return `<!doctype html><html lang="ja"><head>${captureStyle}</head><body>${normalized}</body></html>`;
}

function createSnapshotShell(options: {
  baseHref: string;
  bodyClassName: string;
  bodyHtml: string;
  extraCss: string;
  title: string;
}): string {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
    >
    <base href="${escapeHtml(options.baseHref)}">
    <title>${escapeHtml(options.title)}</title>
    <style>
      :root {
        color-scheme: light;
      }

      html,
      body {
        margin: 0;
        min-height: 100%;
      }

      body {
        background: linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%);
        color: #111827;
        font-family: "Segoe UI", "Hiragino Sans", "Yu Gothic UI", sans-serif;
      }

      a {
        color: #0369a1;
      }

      ${options.extraCss}
    </style>
  </head>
  <body class="${options.bodyClassName}">
    ${options.bodyHtml}
  </body>
</html>`;
}

function rewriteWorkspaceRootUrls(html: string, workspaceRootPath: string | undefined): string {
  if (!workspaceRootPath || html.length === 0) {
    return html;
  }

  return html.replace(
    /\b(src|href)=("([^"]+)"|'([^']+)')/giu,
    (fullMatch, attributeName: string, quotedValue: string, doubleQuotedValue: string, singleQuotedValue: string) => {
      const rawTarget = doubleQuotedValue ?? singleQuotedValue ?? "";
      const relativePath = resolveWorkspaceMarkdownTarget(rawTarget);

      if (!relativePath) {
        return fullMatch;
      }

      const absolutePath = path.resolve(workspaceRootPath, ...relativePath.split("/"));
      const nextUrl = pathToFileURL(absolutePath).href;

      return `${attributeName}=${quotedValue[0]}${nextUrl}${quotedValue[0]}`;
    }
  );
}

async function measureDocumentHeight(window: BrowserWindow): Promise<number> {
  try {
    const result = await window.webContents.executeJavaScript(
      `(() => {
        const doc = document.documentElement;
        const body = document.body;
        const heights = [
          doc?.scrollHeight ?? 0,
          doc?.offsetHeight ?? 0,
          doc?.clientHeight ?? 0,
          body?.scrollHeight ?? 0,
          body?.offsetHeight ?? 0,
          body?.clientHeight ?? 0
        ];
        return Math.ceil(Math.max(...heights, ${MIN_RENDER_HEIGHT}));
      })()`,
      true
    );

    return typeof result === "number" && Number.isFinite(result)
      ? result + 24
      : DEFAULT_WINDOW_HEIGHT;
  } catch {
    return DEFAULT_WINDOW_HEIGHT;
  }
}

async function waitForVisualReadiness(window: BrowserWindow): Promise<string> {
  try {
    const result = await window.webContents.executeJavaScript(
      `(() => new Promise((resolve) => {
        const startTime = Date.now();
        const timeoutMs = 3500;
        const hasPositiveRect = (element) => {
          if (!element || typeof element.getBoundingClientRect !== "function") {
            return false;
          }

          const rect = element.getBoundingClientRect();
          return rect.width >= 24 && rect.height >= 24;
        };
        const allImagesReady = () => Array.from(document.images).every((image) => image.complete);
        const plotlyPlots = () => Array.from(document.querySelectorAll(".js-plotly-plot"));
        const plotlyReadyState = () => {
          const plots = plotlyPlots();

          if (plots.length === 0) {
            return null;
          }

          return plots.every((plot) => {
            if (!hasPositiveRect(plot)) {
              return false;
            }

            const visualSignals = Array.from(
              plot.querySelectorAll(".main-svg, svg, canvas, img")
            );
            return visualSignals.some((element) => hasPositiveRect(element));
          });
        };
        const genericVisualReady = () => {
          const visuals = Array.from(
            document.querySelectorAll("svg, canvas, img, video, iframe, object, embed")
          );

          if (visuals.length === 0) {
            return (document.body?.textContent ?? "").trim().length > 0;
          }

          return visuals.some((element) => hasPositiveRect(element));
        };
        const finish = (label) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve(label));
          });
        };
        const poll = async () => {
          if (document.readyState !== "complete") {
            if (Date.now() - startTime >= timeoutMs) {
              finish("timeout:dom-not-complete");
              return;
            }

            setTimeout(poll, 120);
            return;
          }

          if (document.fonts && document.fonts.status === "loading") {
            try {
              await Promise.race([
                document.fonts.ready,
                new Promise((nextResolve) => setTimeout(nextResolve, 200))
              ]);
            } catch {}
          }

          const plotlyState = plotlyReadyState();

          if (plotlyState === true) {
            finish("plotly-ready");
            return;
          }

          if (plotlyState === null && allImagesReady() && genericVisualReady()) {
            finish("visual-ready");
            return;
          }

          if (Date.now() - startTime >= timeoutMs) {
            if (plotlyState === false) {
              finish("timeout:plotly-pending");
              return;
            }

            finish("timeout:visual-pending");
            return;
          }

          setTimeout(poll, 120);
        };

        poll();
      }))()`,
      true
    );

    return typeof result === "string" && result.trim().length > 0 ? result.trim() : "unknown";
  } catch {
    return "unknown";
  }
}

async function settleAfterResize(window: BrowserWindow): Promise<void> {
  try {
    await window.webContents.executeJavaScript(
      `(() => new Promise((resolve) => {
        window.dispatchEvent(new Event("resize"));
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve(true));
        });
      }))()`,
      true
    );
  } catch {
    await delay(180);
    return;
  }

  await delay(120);
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function importEsmModule<T>(specifier: string): Promise<T> {
  const importer = new Function("specifier", "return import(specifier);") as (
    nextSpecifier: string
  ) => Promise<T>;

  return importer(specifier);
}
