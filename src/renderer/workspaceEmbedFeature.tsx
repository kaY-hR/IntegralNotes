import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type {
  EditorView,
  NodeView,
  NodeViewConstructor,
  ViewMutationRecord
} from "@milkdown/kit/prose/view";

import { Crepe } from "@milkdown/crepe";

import {
  imageBlockSchema,
  imageBlockView as standardImageBlockView
} from "@milkdown/kit/component/image-block";
import { inlineImageView } from "@milkdown/kit/component/image-inline";
import { imageSchema } from "@milkdown/kit/preset/commonmark";
import { $view } from "@milkdown/kit/utils";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { IntegralAssetCatalog } from "../shared/integral";
import type { ResolvedPluginViewer } from "../shared/plugins";
import type { WorkspaceDatasetManifestView } from "../shared/workspace";
import {
  extractWorkspaceEmbedHeight,
  resolveWorkspaceMarkdownTarget,
  withWorkspaceEmbedHeight
} from "../shared/workspaceLinks";
import { ExternalPluginFileViewer } from "./ExternalPluginFileViewer";
import { DatasetRenderableView } from "./IntegralAssetDialogs";
import {
  requestOpenManagedDataNote,
  requestOpenWorkspaceFile
} from "./workspaceOpenEvents";
import { ReadonlyMarkdownPreview } from "./ReadonlyMarkdownPreview";

type WorkspaceEmbedMode = "block" | "inline";

interface WorkspaceEmbedFeatureOptions {
  uploadImage: (file: File) => Promise<string>;
}

type WorkspaceEmbedOpenTarget =
  | {
      kind: "managed-data-note";
      targetId: string;
    }
  | {
      kind: "workspace-file";
      relativePath: string;
    };

interface WorkspaceEmbedResolutionBase {
  openTarget: WorkspaceEmbedOpenTarget | null;
}

type WorkspaceEmbedResolution =
  | (WorkspaceEmbedResolutionBase & {
      kind: "error";
      message: string;
    })
  | (WorkspaceEmbedResolutionBase & {
      kind: "frame";
      sandbox?: string;
      src?: string;
      srcDoc?: string;
      title: string;
    })
  | (WorkspaceEmbedResolutionBase & {
      alt: string;
      kind: "image";
      src: string;
    })
  | (WorkspaceEmbedResolutionBase & {
      datasetId: string;
      kind: "dataset-renderable";
    })
  | (WorkspaceEmbedResolutionBase & {
      kind: "loading";
    })
  | (WorkspaceEmbedResolutionBase & {
      kind: "markdown";
      markdown: string;
    })
  | (WorkspaceEmbedResolutionBase & {
      content: string;
      kind: "plugin";
      pluginViewer: ResolvedPluginViewer;
      relativePath: string;
      title: string;
    })
  | (WorkspaceEmbedResolutionBase & {
      kind: "unsupported";
      message: string;
    });

type DatasetRenderableEmbedResolution =
  | {
      kind: "error";
      message: string;
    }
  | {
      datasetId: string;
      kind: "ready";
    }
  | {
      kind: "loading";
    };

export function installWorkspaceEmbedFeature(
  editor: Crepe,
  options: WorkspaceEmbedFeatureOptions
): void {
  editor.editor.use(createWorkspaceInlineEmbedView(options));
  editor.editor.use(createWorkspaceBlockEmbedView(options));
}

function createWorkspaceInlineEmbedView(options: WorkspaceEmbedFeatureOptions) {
  return $view(
    imageSchema.node,
    (): NodeViewConstructor => (node, view, getPos) =>
      new WorkspaceEmbedBridgeNodeView("inline", node, view, getPos, options)
  );
}

function createWorkspaceBlockEmbedView(options: WorkspaceEmbedFeatureOptions) {
  return $view(
    imageBlockSchema.node,
    (): NodeViewConstructor => (node, view, getPos) =>
      new WorkspaceEmbedBridgeNodeView("block", node, view, getPos, options)
  );
}

class WorkspaceEmbedBridgeNodeView implements NodeView {
  readonly dom: HTMLElement;

  private readonly delegate: NodeView;
  private readonly delegateKind: "custom" | "standard";

  constructor(
    private readonly mode: WorkspaceEmbedMode,
    public node: ProseNode,
    public view: EditorView,
    public getPos: () => number | undefined,
    private readonly options: WorkspaceEmbedFeatureOptions
  ) {
    this.delegateKind = shouldRenderWorkspaceEmbed(readWorkspaceEmbedSource(node))
      ? "custom"
      : "standard";
    this.cleanupLegacyImageEmbedMetadata();
    this.delegate = this.createDelegate(node);
    this.dom = this.delegate.dom;
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }

    const nextDelegateKind = shouldRenderWorkspaceEmbed(readWorkspaceEmbedSource(node))
      ? "custom"
      : "standard";

    if (nextDelegateKind !== this.delegateKind) {
      return false;
    }

    this.node = node;
    return this.delegate.update?.(node) ?? false;
  }

  selectNode(): void {
    this.delegate.selectNode?.();
  }

  deselectNode(): void {
    this.delegate.deselectNode?.();
  }

  stopEvent(event: Event): boolean {
    return this.delegate.stopEvent?.(event) ?? false;
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return this.delegate.ignoreMutation?.(mutation) ?? false;
  }

  destroy(): void {
    this.delegate.destroy?.();
  }

  private createDelegate(node: ProseNode): NodeView {
    if (this.delegateKind === "custom") {
      return new WorkspaceEmbedNodeView(this.mode, node, this.view, this.getPos, this.options);
    }

    return getStandardImageNodeViewConstructor(this.mode)(node, this.view, this.getPos);
  }

  private cleanupLegacyImageEmbedMetadata(): void {
    if (this.delegateKind !== "standard") {
      return;
    }

    const source = readWorkspaceEmbedSource(this.node);

    if (extractWorkspaceEmbedHeight(source) === null) {
      return;
    }

    const nextSource = withWorkspaceEmbedHeight(source, null);

    if (nextSource === source.trim()) {
      return;
    }

    queueMicrotask(() => {
      const position = this.getPos();

      if (position === undefined) {
        return;
      }

      const currentNode = this.view.state.doc.nodeAt(position);

      if (!currentNode || `${currentNode.attrs.src ?? ""}` !== source) {
        return;
      }

      this.view.dispatch(this.view.state.tr.setNodeAttribute(position, "src", nextSource));
    });
  }
}

class WorkspaceEmbedNodeView implements NodeView {
  readonly dom: HTMLElement;

  private destroyed = false;
  private readonly mode: WorkspaceEmbedMode;
  private readonly options: WorkspaceEmbedFeatureOptions;
  private readonly root: Root;
  private selected = false;

  constructor(
    mode: WorkspaceEmbedMode,
    public node: ProseNode,
    public view: EditorView,
    public getPos: () => number | undefined,
    options: WorkspaceEmbedFeatureOptions
  ) {
    this.mode = mode;
    this.options = options;
    this.dom = document.createElement(mode === "inline" ? "span" : "div");
    this.dom.dataset.workspaceEmbed = mode;
    this.root = createRoot(this.dom);
    this.render();
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }

    this.node = node;
    this.render();
    return true;
  }

  selectNode(): void {
    this.selected = true;
    this.render();
  }

  deselectNode(): void {
    this.selected = false;
    this.render();
  }

  stopEvent(event: Event): boolean {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return false;
    }

    return Boolean(
      target.closest(
        [
          "button",
          "input",
          "textarea",
          "label",
          "iframe",
          ".editor-workspace-embed__surface",
          ".editor-workspace-embed__resize-handle",
          ".editor-workspace-embed__empty",
          ".workspace-dataset-renderable-embed",
          ".integral-renderable-layout",
          ".integral-renderable-card",
          ".flexlayout__layout"
        ].join(", ")
      )
    );
  }

  ignoreMutation(_mutation: ViewMutationRecord): boolean {
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    this.root.unmount();
  }

  private render(): void {
    if (this.destroyed) {
      return;
    }

    const source = readWorkspaceEmbedSource(this.node);

    this.root.render(
      isDatasetRenderableWorkspaceTarget(source) ? (
        <WorkspaceDatasetRenderableEmbed selected={this.selected} source={source} />
      ) : (
        <WorkspaceEmbedPanel
          mode={this.mode}
          onChangeSource={(nextSource) => {
            this.updateSource(nextSource);
          }}
          selected={this.selected}
          source={source}
          uploadImage={this.options.uploadImage}
        />
      )
    );
  }

  private updateSource(nextSource: string): void {
    const position = this.getPos();

    if (position === undefined) {
      return;
    }

    this.view.dispatch(this.view.state.tr.setNodeAttribute(position, "src", nextSource));
  }
}

function WorkspaceEmbedPanel({
  mode,
  onChangeSource,
  selected,
  source,
  uploadImage
}: {
  mode: WorkspaceEmbedMode;
  onChangeSource: (nextSource: string) => void;
  selected: boolean;
  source: string;
  uploadImage: (file: File) => Promise<string>;
}): JSX.Element {
  const cleanupResizeListenersRef = useRef<(() => void) | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [draftSource, setDraftSource] = useState(source);
  const [resolution, setResolution] = useState<WorkspaceEmbedResolution>(createLoadingResolution());
  const [surfaceHeight, setSurfaceHeight] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const persistedSurfaceHeight = extractWorkspaceEmbedHeight(source);

  useEffect(() => {
    setDraftSource(source);
    cleanupResizeListenersRef.current?.();
    cleanupResizeListenersRef.current = null;
    setSurfaceHeight(extractWorkspaceEmbedHeight(source));
    setUploadError(null);
  }, [source]);

  useEffect(() => {
    if (source.trim().length === 0) {
      setResolution(createLoadingResolution());
      return;
    }

    let cancelled = false;
    const openTarget = getWorkspaceFileOpenTarget(source);

    setResolution(createLoadingResolution(openTarget));

    void resolveWorkspaceEmbed(source).then((nextResolution) => {
      if (!cancelled) {
        setResolution(nextResolution);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [source]);

  const rootClassName = [
    "editor-workspace-embed",
    mode === "inline" ? "editor-workspace-embed--inline" : "editor-workspace-embed--block",
    selected ? "editor-workspace-embed--selected" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const defaultSurfaceHeight = getDefaultEmbedHeight(mode, resolution.kind);
  const minimumSurfaceHeight = getMinimumEmbedHeight(mode, resolution.kind);
  const shouldAutoSizeImage =
    resolution.kind === "image" && persistedSurfaceHeight === null && surfaceHeight === null;
  const currentSurfaceHeight = shouldAutoSizeImage
    ? null
    : clampNumber(surfaceHeight ?? defaultSurfaceHeight, minimumSurfaceHeight, 1200);
  const openTarget = resolution.kind === "loading" ? null : resolution.openTarget;

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const surfaceElement = surfaceRef.current;

    if (!surfaceElement) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    cleanupResizeListenersRef.current?.();

    const startHeight = surfaceElement.getBoundingClientRect().height;
    const startY = event.clientY;
    let latestHeight = Math.round(startHeight);
    const canPersistHeight = resolveWorkspaceMarkdownTarget(source) !== null;

    const handleResizePointerMove = (pointerEvent: PointerEvent): void => {
      const nextHeight = Math.round(
        clampNumber(startHeight + (pointerEvent.clientY - startY), minimumSurfaceHeight, 1200)
      );

      latestHeight = nextHeight;
      setSurfaceHeight(nextHeight);
    };

    const cleanupResizeListeners = (): void => {
      window.removeEventListener("pointermove", handleResizePointerMove);
      window.removeEventListener("pointerup", handleResizePointerUp);
    };

    const handleResizePointerUp = (): void => {
      cleanupResizeListeners();
      cleanupResizeListenersRef.current = null;

      if (!canPersistHeight) {
        return;
      }

      const nextSource =
        resolution.kind === "image"
          ? withWorkspaceEmbedHeight(
              source,
              persistedSurfaceHeight === null && Math.abs(latestHeight - startHeight) <= 1
                ? null
                : latestHeight
            )
          : withWorkspaceEmbedHeight(
              source,
              normalizePersistedEmbedHeight(latestHeight, defaultSurfaceHeight)
            );

      if (nextSource !== source.trim()) {
        onChangeSource(nextSource);
      }
    };

    cleanupResizeListenersRef.current = cleanupResizeListeners;
    window.addEventListener("pointermove", handleResizePointerMove);
    window.addEventListener("pointerup", handleResizePointerUp);
  };

  useEffect(
    () => () => {
      cleanupResizeListenersRef.current?.();
      cleanupResizeListenersRef.current = null;
    },
    []
  );

  if (source.trim().length === 0) {
    return (
      <div className={rootClassName}>
        <div className="editor-workspace-embed__empty">
          <div className="editor-workspace-embed__empty-title">画像または workspace path を指定</div>
          <div className="editor-workspace-embed__empty-row">
            <input
              className="editor-workspace-embed__input"
              onChange={(event) => {
                setDraftSource(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") {
                  return;
                }

                event.preventDefault();
                onChangeSource(draftSource.trim());
              }}
              placeholder="/Data/example.png または /notes/preview.html"
              type="text"
              value={draftSource}
            />
            <button
              className="button button--ghost button--xs"
              onClick={() => {
                onChangeSource(draftSource.trim());
              }}
              type="button"
            >
              反映
            </button>
          </div>
          <div className="editor-workspace-embed__empty-actions">
            <input
              accept="image/*"
              className="editor-workspace-embed__file-input"
              onChange={(event) => {
                const file = event.target.files?.[0];

                if (!file) {
                  return;
                }

                setUploadError(null);
                void uploadImage(file)
                  .then((uploadedTarget) => {
                    onChangeSource(uploadedTarget);
                  })
                  .catch((error) => {
                    setUploadError(toErrorMessage(error));
                  })
                  .finally(() => {
                    if (event.target instanceof HTMLInputElement) {
                      event.target.value = "";
                    }
                  });
              }}
              ref={fileInputRef}
              type="file"
            />
            <button
              className="button button--ghost button--xs"
              onClick={() => {
                fileInputRef.current?.click();
              }}
              type="button"
            >
              画像を選択
            </button>
          </div>
          {uploadError ? (
            <div className="editor-workspace-embed__status editor-workspace-embed__status--error">
              {uploadError}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={rootClassName}>
      {openTarget ? <WorkspaceEmbedOpenAction openTarget={openTarget} /> : null}
      <div
        className="editor-workspace-embed__surface"
        ref={surfaceRef}
        style={{
          height: currentSurfaceHeight === null ? undefined : `${currentSurfaceHeight}px`
        }}
      >
        {resolution.kind === "loading" ? (
          <div className="editor-workspace-embed__status">読み込み中...</div>
        ) : null}

        {resolution.kind === "image" ? (
          <img alt={resolution.alt} className="editor-workspace-embed__image" src={resolution.src} />
        ) : null}

        {resolution.kind === "frame" ? (
          <iframe
            className="editor-workspace-embed__frame"
            sandbox={resolution.sandbox}
            src={resolution.src}
            srcDoc={resolution.srcDoc}
            title={resolution.title}
          />
        ) : null}

        {resolution.kind === "markdown" ? (
          <ReadonlyMarkdownPreview
            className="editor-workspace-embed__markdown"
            content={resolution.markdown}
            proxyDomURL={proxyWorkspaceEmbedImageUrl}
          />
        ) : null}

        {resolution.kind === "dataset-renderable" ? (
          <div className="editor-workspace-embed__dataset">
            <DatasetRenderableView datasetId={resolution.datasetId} />
          </div>
        ) : null}

        {resolution.kind === "plugin" ? (
          <div className="editor-workspace-embed__plugin">
            <ExternalPluginFileViewer
              file={{
                content: resolution.content,
                name: resolution.title,
                pluginViewer: resolution.pluginViewer,
                relativePath: resolution.relativePath
              }}
              presentation="embed"
              source={{
                kind: "workspace-file"
              }}
            />
          </div>
        ) : null}

        {resolution.kind === "unsupported" ? (
          <div className="editor-workspace-embed__status">{resolution.message}</div>
        ) : null}

        {resolution.kind === "error" ? (
          <div className="editor-workspace-embed__status editor-workspace-embed__status--error">
            {resolution.message}
          </div>
        ) : null}

        <div
          className="editor-workspace-embed__resize-handle"
          onPointerDown={handleResizePointerDown}
          title="縦方向にリサイズ"
        />
      </div>
    </div>
  );
}

function WorkspaceDatasetRenderableEmbed({
  selected,
  source
}: {
  selected: boolean;
  source: string;
}): JSX.Element {
  const [resolution, setResolution] = useState<DatasetRenderableEmbedResolution>({
    kind: "loading"
  });
  const openTarget = getWorkspaceFileOpenTarget(source);

  useEffect(() => {
    let cancelled = false;

    setResolution({
      kind: "loading"
    });

    void resolveDatasetRenderableEmbed(source).then((nextResolution) => {
      if (!cancelled) {
        setResolution(nextResolution);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [source]);

  const className = [
    "workspace-dataset-renderable-embed",
    selected ? "workspace-dataset-renderable-embed--selected" : ""
  ]
    .filter(Boolean)
    .join(" ");

  if (resolution.kind === "loading") {
    return (
      <div className={className}>
        {openTarget ? <WorkspaceEmbedOpenAction openTarget={openTarget} /> : null}
        <div className="workspace-dataset-renderable-embed__status">dataset を読み込み中...</div>
      </div>
    );
  }

  if (resolution.kind === "error") {
    return (
      <div className={className}>
        {openTarget ? <WorkspaceEmbedOpenAction openTarget={openTarget} /> : null}
        <div className="workspace-dataset-renderable-embed__status workspace-dataset-renderable-embed__status--error">
          {resolution.message}
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {openTarget ? <WorkspaceEmbedOpenAction openTarget={openTarget} /> : null}
      <DatasetRenderableView datasetId={resolution.datasetId} />
    </div>
  );
}

function WorkspaceEmbedOpenAction({
  openTarget
}: {
  openTarget: WorkspaceEmbedOpenTarget;
}): JSX.Element {
  return (
    <div className="editor-workspace-embed__toolbar">
      <button
        className="button button--ghost button--xs editor-workspace-embed__open-button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openWorkspaceEmbedTarget(openTarget);
        }}
        title={getWorkspaceEmbedOpenActionTitle(openTarget)}
        type="button"
      >
        別タブで開く
      </button>
    </div>
  );
}

async function resolveWorkspaceEmbed(source: string): Promise<WorkspaceEmbedResolution> {
  const trimmedSource = source.trim();
  const displaySource =
    extractWorkspaceEmbedHeight(trimmedSource) !== null
      ? withWorkspaceEmbedHeight(trimmedSource, null)
      : trimmedSource;
  const relativePath = resolveWorkspaceMarkdownTarget(trimmedSource);
  const workspaceFileOpenTarget = relativePath
    ? {
        kind: "workspace-file",
        relativePath
      }
    : null;

  if (!relativePath) {
    return {
      alt: displaySource || "External image",
      kind: "image",
      openTarget: null,
      src: displaySource,
    };
  }

  try {
    const file = await window.integralNotes.readWorkspaceFile(relativePath);
    const extension = getLowercaseExtension(relativePath);

    if (extension === ".svg") {
      return {
        kind: "frame",
        openTarget: workspaceFileOpenTarget,
        src: file.content ?? "",
        title: file.name
      };
    }

    if (file.kind === "html") {
      return {
        kind: "frame",
        openTarget: workspaceFileOpenTarget,
        sandbox: "allow-same-origin allow-scripts",
        srcDoc: file.content ?? "",
        title: file.name
      };
    }

    if (file.kind === "image") {
      return {
        alt: file.name,
        kind: "image",
        openTarget: workspaceFileOpenTarget,
        src: file.content ?? "",
      };
    }

    if (file.kind === "text") {
      return {
        kind: "frame",
        openTarget: workspaceFileOpenTarget,
        srcDoc: createTextFrameDocument(file.content ?? "", file.name),
        title: file.name
      };
    }

    if (file.kind === "markdown") {
      return {
        kind: "markdown",
        markdown: file.content ?? "",
        openTarget: workspaceFileOpenTarget
      };
    }

    if (file.kind === "plugin" && file.pluginViewer) {
      return {
        content: file.content ?? "",
        kind: "plugin",
        openTarget: workspaceFileOpenTarget ?? {
          kind: "workspace-file",
          relativePath
        },
        pluginViewer: file.pluginViewer,
        relativePath,
        title: file.name
      };
    }

    if (file.kind === "dataset-json") {
      if (file.datasetManifest?.datasetId) {
        return {
          datasetId: file.datasetManifest.datasetId,
          kind: "dataset-renderable",
          openTarget: workspaceFileOpenTarget
        };
      }

      return {
        kind: "unsupported",
        message: "`.idts` manifest を読み取れませんでした。",
        openTarget: workspaceFileOpenTarget
      };
    }

    const managedDataNote = await resolveManagedDataNoteFallback(relativePath);

    if (managedDataNote) {
      return managedDataNote;
    }

    return {
      kind: "unsupported",
      message: "この file は埋め込み表示に未対応です。",
      openTarget: workspaceFileOpenTarget
    };
  } catch (error) {
    return {
      kind: "error",
      message: toErrorMessage(error),
      openTarget: workspaceFileOpenTarget
    };
  }
}

async function resolveDatasetRenderableEmbed(
  source: string
): Promise<DatasetRenderableEmbedResolution> {
  const relativePath = resolveWorkspaceMarkdownTarget(source.trim());

  if (!relativePath || getLowercaseExtension(relativePath) !== ".idts") {
    return {
      kind: "error",
      message: "`.idts` dataset を解決できません。"
    };
  }

  try {
    const file = await window.integralNotes.readWorkspaceFile(relativePath);

    if (file.kind !== "dataset-json" || !file.datasetManifest?.datasetId) {
      return {
        kind: "error",
        message: "`.idts` manifest を読み取れませんでした。"
      };
    }

    return {
      datasetId: file.datasetManifest.datasetId,
      kind: "ready"
    };
  } catch (error) {
    return {
      kind: "error",
      message: toErrorMessage(error)
    };
  }
}

async function resolveManagedDataNoteFallback(
  relativePath: string
): Promise<WorkspaceEmbedResolution | null> {
  const catalog = await window.integralNotes.getIntegralAssetCatalog();
  const target = findManagedDataTargetForPath(catalog, relativePath);

  if (!target) {
    return null;
  }

  try {
    const notePath = createManagedDataNoteRelativePath(target.targetId);
    const note = await window.integralNotes.readWorkspaceFile(notePath);

    return {
      kind: "markdown",
      markdown: note.content ?? "",
      openTarget: {
        kind: "managed-data-note",
        targetId: target.targetId
      }
    };
  } catch (error) {
    return {
      kind: "error",
      message: toErrorMessage(error),
      openTarget: {
        kind: "managed-data-note",
        targetId: target.targetId
      }
    };
  }
}

function createLoadingResolution(
  openTarget: WorkspaceEmbedOpenTarget | null = null
): WorkspaceEmbedResolution {
  return {
    kind: "loading",
    openTarget
  };
}

function getWorkspaceFileOpenTarget(source: string): WorkspaceEmbedOpenTarget | null {
  const relativePath = resolveWorkspaceMarkdownTarget(source.trim());

  if (!relativePath) {
    return null;
  }

  return {
    kind: "workspace-file",
    relativePath
  };
}

function openWorkspaceEmbedTarget(openTarget: WorkspaceEmbedOpenTarget): void {
  if (openTarget.kind === "managed-data-note") {
    requestOpenManagedDataNote(openTarget.targetId);
    return;
  }

  requestOpenWorkspaceFile(openTarget.relativePath);
}

function getWorkspaceEmbedOpenActionTitle(openTarget: WorkspaceEmbedOpenTarget): string {
  return openTarget.kind === "managed-data-note"
    ? "対応するノートを別タブで開く"
    : "対応するファイルを別タブで開く";
}

function readWorkspaceEmbedSource(node: ProseNode): string {
  return `${node.attrs.src ?? ""}`;
}

function shouldRenderWorkspaceEmbed(source: string): boolean {
  const relativePath = resolveWorkspaceMarkdownTarget(source.trim());

  if (!relativePath) {
    return false;
  }

  return !STANDARD_IMAGE_EXTENSIONS.has(getLowercaseExtension(relativePath));
}

function isDatasetRenderableWorkspaceTarget(source: string): boolean {
  const relativePath = resolveWorkspaceMarkdownTarget(source.trim());
  return relativePath !== null && getLowercaseExtension(relativePath) === ".idts";
}

function getStandardImageNodeViewConstructor(mode: WorkspaceEmbedMode): NodeViewConstructor {
  const viewPlugin = (
    mode === "inline" ? inlineImageView : standardImageBlockView
  ) as ViewPluginWithConstructor;

  if (typeof viewPlugin.view !== "function") {
    throw new Error(`Milkdown ${mode} image view is not initialized.`);
  }

  return viewPlugin.view;
}

function getLowercaseExtension(relativePath: string): string {
  const normalized = relativePath.trim().toLowerCase();
  const slashIndex = normalized.lastIndexOf("/");
  const baseName = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  const dotIndex = baseName.lastIndexOf(".");

  return dotIndex >= 0 ? baseName.slice(dotIndex) : "";
}

function getDefaultEmbedHeight(
  mode: WorkspaceEmbedMode,
  resolutionKind: WorkspaceEmbedResolution["kind"]
): number {
  const compact = mode === "inline";

    switch (resolutionKind) {
      case "image":
        return compact ? 220 : 280;
      case "error":
      case "loading":
      case "unsupported":
        return compact ? 140 : 180;
      case "frame":
      case "dataset-renderable":
      case "plugin":
      case "markdown":
        return compact ? 220 : 320;
    default:
      return compact ? 220 : 280;
  }
}

function getMinimumEmbedHeight(
  mode: WorkspaceEmbedMode,
  resolutionKind: WorkspaceEmbedResolution["kind"]
): number {
  if (resolutionKind === "error" || resolutionKind === "loading" || resolutionKind === "unsupported") {
    return mode === "inline" ? 96 : 120;
  }

  return mode === "inline" ? 140 : 180;
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function normalizePersistedEmbedHeight(height: number, defaultHeight: number): number | null {
  return Math.abs(height - defaultHeight) <= 1 ? null : height;
}

function createTextFrameDocument(content: string, title: string): string {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
      }

      html,
      body {
        height: 100%;
        margin: 0;
        background: #fbfcfd;
        color: #1f2733;
        font-family: "Consolas", "SFMono-Regular", "Courier New", monospace;
      }

      pre {
        box-sizing: border-box;
        margin: 0;
        min-height: 100vh;
        padding: 12px 14px;
        white-space: pre-wrap;
        word-break: break-word;
        line-height: 1.5;
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <pre>${escapeHtml(content)}</pre>
  </body>
</html>`;
}

async function proxyWorkspaceEmbedImageUrl(url: string): Promise<string> {
  const relativePath = resolveWorkspaceMarkdownTarget(url);

  if (!relativePath) {
    return url;
  }

  try {
    return await window.integralNotes.resolveWorkspaceFileUrl(relativePath);
  } catch {
    return url;
  }
}

const STANDARD_IMAGE_EXTENSIONS = new Set([
  ".apng",
  ".avif",
  ".bmp",
  ".gif",
  ".heic",
  ".heif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".tif",
  ".tiff",
  ".webp"
]);

type ViewPluginWithConstructor = {
  view?: NodeViewConstructor;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

interface ManagedDataTarget {
  displayName: string;
  targetId: string;
}

function createManagedDataNoteRelativePath(targetId: string): string {
  return `.store/.integral/data-notes/${targetId.trim()}.md`;
}

function findManagedDataTargetForPath(
  catalog: IntegralAssetCatalog,
  relativePath: string
): ManagedDataTarget | null {
  const normalizedRelativePath = normalizeRelativePath(relativePath);

  if (normalizedRelativePath.length === 0) {
    return null;
  }

  const matches: Array<
    ManagedDataTarget & {
      isExactMatch: boolean;
      matchedPath: string;
    }
  > = [];

  const collectMatch = (
    displayName: string,
    targetId: string,
    managedPath: string,
    representation: "dataset-json" | "directory" | "file"
  ): void => {
    const normalizedManagedPath = normalizeRelativePath(managedPath);

    if (normalizedManagedPath.length === 0) {
      return;
    }

    const isExactMatch = normalizedRelativePath === normalizedManagedPath;
    const isDirectoryMatch =
      representation === "directory" &&
      normalizedRelativePath.startsWith(`${normalizedManagedPath}/`);

    if (!isExactMatch && !isDirectoryMatch) {
      return;
    }

    matches.push({
      displayName,
      isExactMatch,
      matchedPath: normalizedManagedPath,
      targetId
    });
  };

  for (const entry of catalog.managedFiles) {
    if (!entry.hasDataNote) {
      continue;
    }

    collectMatch(entry.displayName, entry.id, entry.path, entry.representation);
  }

  matches.sort((left, right) => {
    if (left.isExactMatch !== right.isExactMatch) {
      return left.isExactMatch ? -1 : 1;
    }

    if (left.matchedPath.length !== right.matchedPath.length) {
      return right.matchedPath.length - left.matchedPath.length;
    }

    return left.displayName.localeCompare(right.displayName, "ja");
  });

  const [bestMatch] = matches;

  return bestMatch
    ? {
        displayName: bestMatch.displayName,
        targetId: bestMatch.targetId
      }
    : null;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath
    .split(/[\\/]+/u)
    .filter(Boolean)
    .join("/");
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "不明なエラーが発生しました。";
}
