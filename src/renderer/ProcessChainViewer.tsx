import { useEffect, useMemo, useRef, useState } from "react";

import type {
  IntegralAssetCatalog,
  IntegralBlockDocument,
  IntegralBlockTypeDefinition
} from "../shared/integral";
import type { WorkspaceEntry } from "../shared/workspace";
import {
  resolveWorkspaceMarkdownTarget,
  toCanonicalWorkspaceTarget
} from "../shared/workspaceLinks";
import {
  INTEGRAL_BLOCK_LANGUAGE,
  parseIntegralBlockSource
} from "./integralBlockRegistry";

interface ProcessChainViewerProps {
  assetCatalog: IntegralAssetCatalog;
  contextRelativePath: string | null;
  noteOverrides: Record<string, string>;
  onOpenWorkspaceFile: (relativePath: string) => void;
  onOpenWorkspaceTarget: (target: string) => void;
  workspaceEntries: WorkspaceEntry[];
  workspaceRevision: number;
}

interface ParsedNoteBlock {
  block: IntegralBlockDocument;
  blockId: string | null;
  blockTypeKey: string;
  inputs: string[];
  nodeId: string;
  notePath: string;
  outputs: string[];
  title: string;
}

interface ProcessChainNode {
  category: "block" | "file";
  id: string;
  isMissing?: boolean;
  isRoot?: boolean;
  label: string;
  notePath?: string;
  path?: string;
  subtitle: string;
  target?: string;
}

interface ProcessChainEdge {
  id: string;
  source: string;
  target: string;
}

interface ProcessChainGraph {
  columns: Array<{
    depth: number;
    nodeIds: string[];
  }>;
  contextRelativePath: string | null;
  edges: ProcessChainEdge[];
  emptyMessage: string | null;
  nodeDepths: Record<string, number>;
  nodes: Record<string, ProcessChainNode>;
  rootNodeIds: string[];
}

interface ProcessChainNodePosition {
  height: number;
  inputPortX: number;
  left: number;
  outputPortX: number;
  portY: number;
  top: number;
  width: number;
}

type ProcessChainState =
  | {
      kind: "error";
      message: string;
    }
  | {
      kind: "loading";
    }
  | {
      graph: ProcessChainGraph;
      kind: "ready";
    };

const NODE_WIDTH = 252;
const NODE_HEIGHT = 92;
const COLUMN_GAP = 88;
const ROW_GAP = 20;
const GRAPH_PADDING = 28;

export function ProcessChainViewer({
  assetCatalog,
  contextRelativePath,
  noteOverrides,
  onOpenWorkspaceFile,
  onOpenWorkspaceTarget,
  workspaceEntries,
  workspaceRevision
}: ProcessChainViewerProps): JSX.Element {
  const noteCacheRef = useRef<Map<string, string>>(new Map());
  const noteCacheRevisionRef = useRef(workspaceRevision);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [state, setState] = useState<ProcessChainState>({
    kind: "loading"
  });

  const indexableNotePaths = useMemo(
    () => collectIndexableNotePaths(workspaceEntries),
    [workspaceEntries]
  );

  useEffect(() => {
    let cancelled = false;

    const loadGraph = async (): Promise<void> => {
      setState({
        kind: "loading"
      });

      if (noteCacheRevisionRef.current !== workspaceRevision) {
        noteCacheRef.current.clear();
        noteCacheRevisionRef.current = workspaceRevision;
      }

      for (const [relativePath, content] of Object.entries(noteOverrides)) {
        noteCacheRef.current.set(relativePath, content);
      }

      const noteDocuments = await Promise.all(
        indexableNotePaths.map(async (relativePath) => {
          const overriddenContent = noteOverrides[relativePath];

          if (typeof overriddenContent === "string") {
            return {
              content: overriddenContent,
              relativePath
            };
          }

          const cachedContent = noteCacheRef.current.get(relativePath);
          if (typeof cachedContent === "string") {
            return {
              content: cachedContent,
              relativePath
            };
          }

          try {
            const note = await window.integralNotes.readNote(relativePath);
            noteCacheRef.current.set(relativePath, note.content);
            return {
              content: note.content,
              relativePath
            };
          } catch {
            return null;
          }
        })
      );

      if (cancelled) {
        return;
      }

      try {
        const graph = buildProcessChainGraph({
          assetCatalog,
          contextRelativePath,
          noteDocuments: noteDocuments.filter(
            (
              noteDocument
            ): noteDocument is {
              content: string;
              relativePath: string;
            } => noteDocument !== null
          ),
          workspaceEntries
        });

        setState({
          graph,
          kind: "ready"
        });
      } catch (error) {
        setState({
          kind: "error",
          message: toErrorMessage(error)
        });
      }
    };

    void loadGraph();

    return () => {
      cancelled = true;
    };
  }, [assetCatalog, contextRelativePath, indexableNotePaths, noteOverrides, refreshRevision, workspaceEntries, workspaceRevision]);

  const graph = state.kind === "ready" ? state.graph : null;
  const columnHeights = graph
    ? graph.columns.map((column) => calculateColumnHeight(column.nodeIds.length))
    : [];
  const graphWidth = graph
    ? graph.columns.length * NODE_WIDTH +
      Math.max(0, graph.columns.length - 1) * COLUMN_GAP +
      GRAPH_PADDING * 2
    : NODE_WIDTH + GRAPH_PADDING * 2;
  const graphHeight = graph
    ? Math.max(
        NODE_HEIGHT + GRAPH_PADDING * 2,
        ...columnHeights.map((columnHeight) => columnHeight + GRAPH_PADDING * 2)
      )
    : NODE_HEIGHT + GRAPH_PADDING * 2;
  const nodePositions = graph ? computeNodePositions(graph.columns) : {};
  const stats = graph
    ? {
        blockCount: Object.values(graph.nodes).filter((node) => node.category === "block").length,
        edgeCount: graph.edges.length,
        fileCount: Object.values(graph.nodes).filter((node) => node.category === "file").length
      }
    : null;

  if (state.kind === "loading") {
    return (
      <div className="process-chain-viewer process-chain-viewer--loading">
        <div className="process-chain-viewer__empty">
          <strong>Process chain を解析中です</strong>
          <span>現在の note / file に関連する block と file を集めています。</span>
        </div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="process-chain-viewer process-chain-viewer--error">
        <div className="process-chain-viewer__empty">
          <strong>Process chain を表示できません</strong>
          <span>{state.message}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="process-chain-viewer">
      <div className="process-chain-viewer__header">
        <div>
          <p className="process-chain-viewer__eyebrow">Process Chain</p>
          <h2 className="process-chain-viewer__title">
            {graph?.contextRelativePath ? graph.contextRelativePath : "対象の note / file がありません"}
          </h2>
        </div>
        <div className="process-chain-viewer__actions">
          {stats ? (
            <div className="process-chain-viewer__stats">
              <span className="process-chain-viewer__stat">{stats.blockCount} blocks</span>
              <span className="process-chain-viewer__stat">{stats.fileCount} files</span>
              <span className="process-chain-viewer__stat">{stats.edgeCount} edges</span>
            </div>
          ) : null}
          <button
            className="button button--ghost button--xs"
            onClick={() => {
              noteCacheRef.current = new Map(Object.entries(noteOverrides));
              setRefreshRevision((current) => current + 1);
            }}
            type="button"
          >
            Refresh
          </button>
        </div>
      </div>

      {graph?.emptyMessage ? (
        <div className="process-chain-viewer__empty">
          <strong>表示できる chain がありません</strong>
          <span>{graph.emptyMessage}</span>
        </div>
      ) : (
        <div className="process-chain-viewer__surface">
          <div
            className="process-chain-viewer__canvas"
            style={{
              height: `${graphHeight}px`,
              width: `${graphWidth}px`
            }}
          >
            <svg
              aria-hidden="true"
              className="process-chain-viewer__edges"
              height={graphHeight}
              viewBox={`0 0 ${graphWidth} ${graphHeight}`}
              width={graphWidth}
            >
              {graph?.edges.map((edge) => {
                const sourcePosition = nodePositions[edge.source];
                const targetPosition = nodePositions[edge.target];

                if (!sourcePosition || !targetPosition) {
                  return null;
                }

                const pathDefinition = buildEdgePath(sourcePosition, targetPosition);

                return (
                  <path
                    className="process-chain-viewer__edge"
                    d={pathDefinition}
                    key={edge.id}
                  />
                );
              })}
            </svg>

            {graph?.columns.map((column) => (
              <div
                className="process-chain-viewer__column"
                key={`column-${column.depth}`}
                style={{
                  left: `${GRAPH_PADDING + (column.depth - graph.columns[0].depth) * (NODE_WIDTH + COLUMN_GAP)}px`
                }}
              >
                <div className="process-chain-viewer__column-label">
                  {column.depth < 0
                    ? `-${Math.abs(column.depth)}`
                    : column.depth > 0
                      ? `+${column.depth}`
                      : "Root"}
                </div>
                {column.nodeIds.map((nodeId) => {
                  const node = graph.nodes[nodeId];
                  const nodePosition = nodePositions[nodeId];

                  if (!node || !nodePosition) {
                    return null;
                  }

                  const handleOpen = (): void => {
                    if (node.target) {
                      onOpenWorkspaceTarget(node.target);
                      return;
                    }

                    if (node.path) {
                      onOpenWorkspaceFile(node.path);
                    }
                  };

                  return (
                    <button
                      className={`process-chain-viewer__node process-chain-viewer__node--${node.category}${
                        node.isRoot ? " is-root" : ""
                      }${node.isMissing ? " is-missing" : ""}`}
                      key={node.id}
                      onClick={handleOpen}
                      style={{
                        top: `${nodePosition.top}px`
                      }}
                      title={node.subtitle}
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className="process-chain-viewer__node-port process-chain-viewer__node-port--input"
                      />
                      <span
                        aria-hidden="true"
                        className="process-chain-viewer__node-port process-chain-viewer__node-port--output"
                      />
                      <span className="process-chain-viewer__node-header">
                        <span className="process-chain-viewer__node-kind">
                          {node.category === "block" ? "Block" : "File"}
                        </span>
                        {node.isRoot ? (
                          <span className="process-chain-viewer__node-badge">Root</span>
                        ) : null}
                      </span>
                      <strong className="process-chain-viewer__node-label">{node.label}</strong>
                      <span className="process-chain-viewer__node-subtitle">{node.subtitle}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function buildProcessChainGraph({
  assetCatalog,
  contextRelativePath,
  noteDocuments,
  workspaceEntries
}: {
  assetCatalog: IntegralAssetCatalog;
  contextRelativePath: string | null;
  noteDocuments: Array<{
    content: string;
    relativePath: string;
  }>;
  workspaceEntries: WorkspaceEntry[];
}): ProcessChainGraph {
  const definitionMap = new Map<string, IntegralBlockTypeDefinition>();
  const datasetById = new Map<string, typeof assetCatalog.datasets[number]>();
  const datasetByPath = new Map<string, typeof assetCatalog.datasets[number]>();
  const managedFileById = new Map<string, typeof assetCatalog.managedFiles[number]>();
  const managedFileByPath = new Map<string, typeof assetCatalog.managedFiles[number]>();
  const workspaceFileMap = new Map<string, WorkspaceEntry>();

  for (const definition of assetCatalog.blockTypes) {
    definitionMap.set(`${definition.pluginId}::${definition.blockType}`, definition);
  }

  for (const dataset of assetCatalog.datasets) {
    datasetById.set(dataset.datasetId, dataset);
    datasetByPath.set(normalizeProcessChainPath(dataset.path), dataset);
    datasetByPath.set(toCanonicalWorkspaceTarget(normalizeProcessChainPath(dataset.path)), dataset);
  }

  for (const managedFile of assetCatalog.managedFiles) {
    managedFileById.set(managedFile.id, managedFile);
    managedFileByPath.set(normalizeProcessChainPath(managedFile.path), managedFile);
    managedFileByPath.set(
      toCanonicalWorkspaceTarget(normalizeProcessChainPath(managedFile.path)),
      managedFile
    );
  }

  collectWorkspaceFiles(workspaceEntries, workspaceFileMap);

  const resolveReferenceToPath = (reference: string | null): string | null => {
    if (!reference) {
      return null;
    }

    const trimmed = reference.trim();

    if (trimmed.length === 0) {
      return null;
    }

    const dataset = datasetById.get(trimmed) ?? datasetByPath.get(trimmed);
    if (dataset) {
      return normalizeProcessChainPath(dataset.path);
    }

    const managedFile = managedFileById.get(trimmed) ?? managedFileByPath.get(trimmed);
    if (managedFile) {
      return normalizeProcessChainPath(managedFile.path);
    }

    const workspaceTarget = resolveWorkspaceMarkdownTarget(trimmed);
    if (workspaceTarget) {
      return normalizeProcessChainPath(workspaceTarget);
    }

    const normalizedPath = normalizeProcessChainPath(trimmed);
    return normalizedPath.length > 0 ? normalizedPath : null;
  };

  const parsedBlocks: ParsedNoteBlock[] = noteDocuments.flatMap((noteDocument) =>
    parseNoteBlocks(noteDocument.relativePath, noteDocument.content, definitionMap, resolveReferenceToPath)
  );
  const blockByNodeId = new Map(parsedBlocks.map((block) => [block.nodeId, block] as const));
  const blockIdToNodeIds = new Map<string, string[]>();
  const consumerNodeIdsByFilePath = new Map<string, string[]>();
  const producerNodeIdsByFilePath = new Map<string, string[]>();

  for (const block of parsedBlocks) {
    if (!block.blockId) {
      continue;
    }

    const currentNodeIds = blockIdToNodeIds.get(block.blockId) ?? [];
    currentNodeIds.push(block.nodeId);
    blockIdToNodeIds.set(block.blockId, currentNodeIds);
  }

  for (const block of parsedBlocks) {
    for (const inputPath of block.inputs) {
      appendProcessChainIndex(consumerNodeIdsByFilePath, inputPath, block.nodeId);
    }

    for (const outputPath of block.outputs) {
      appendProcessChainIndex(producerNodeIdsByFilePath, outputPath, block.nodeId);
    }
  }

  for (const dataset of assetCatalog.datasets) {
    const normalizedPath = normalizeProcessChainPath(dataset.path);
    const producerNodeIds =
      dataset.createdByBlockId && dataset.createdByBlockId.length > 0
        ? blockIdToNodeIds.get(dataset.createdByBlockId) ?? []
        : [];

    for (const producerNodeId of producerNodeIds) {
      appendProcessChainIndex(producerNodeIdsByFilePath, normalizedPath, producerNodeId);
    }
  }

  for (const managedFile of assetCatalog.managedFiles) {
    const normalizedPath = normalizeProcessChainPath(managedFile.path);
    const producerNodeIds =
      managedFile.createdByBlockId && managedFile.createdByBlockId.length > 0
        ? blockIdToNodeIds.get(managedFile.createdByBlockId) ?? []
        : [];

    for (const producerNodeId of producerNodeIds) {
      appendProcessChainIndex(producerNodeIdsByFilePath, normalizedPath, producerNodeId);
    }
  }

  const nodes = new Map<string, ProcessChainNode>();
  const selectedEdges = new Map<string, ProcessChainEdge>();
  const selectedNodeIds = new Set<string>();

  const ensureFileNode = (relativePath: string): ProcessChainNode => {
    const normalizedPath = normalizeProcessChainPath(relativePath);
    const nodeId = `file:${normalizedPath}`;
    const existingNode = nodes.get(nodeId);

    if (existingNode) {
      return existingNode;
    }

    const dataset = datasetByPath.get(normalizedPath);
    const managedFile = managedFileByPath.get(normalizedPath);
    const workspaceEntry = workspaceFileMap.get(normalizedPath);
    const label = dataset?.name ?? managedFile?.displayName ?? workspaceEntry?.name ?? basename(normalizedPath);
    const subtitleParts = [normalizedPath];

    if (dataset) {
      subtitleParts.push(dataset.datatype ?? dataset.representation);
    } else if (managedFile?.datatype) {
      subtitleParts.push(managedFile.datatype);
    } else if (managedFile) {
      subtitleParts.push(managedFile.representation);
    } else if (!workspaceEntry) {
      subtitleParts.push("unresolved");
    }

    const nextNode: ProcessChainNode = {
      category: "file",
      id: nodeId,
      isMissing: !dataset && !managedFile && !workspaceEntry,
      label,
      path: normalizedPath,
      subtitle: subtitleParts.join(" · ")
    };

    nodes.set(nodeId, nextNode);
    return nextNode;
  };

  const ensureBlockNode = (block: ParsedNoteBlock): ProcessChainNode => {
    const existingNode = nodes.get(block.nodeId);

    if (existingNode) {
      return existingNode;
    }

    const nextNode: ProcessChainNode = {
      category: "block",
      id: block.nodeId,
      label: block.title,
      notePath: block.notePath,
      subtitle: `${block.notePath} · ${block.blockTypeKey}`,
      target:
        block.blockId && block.blockId.length > 0
          ? `${toCanonicalWorkspaceTarget(block.notePath)}#${block.blockId}`
          : toCanonicalWorkspaceTarget(block.notePath)
    };

    nodes.set(block.nodeId, nextNode);
    return nextNode;
  };

  const addEdge = (source: string, target: string): void => {
    const edgeId = `${source}->${target}`;

    if (!selectedEdges.has(edgeId)) {
      selectedEdges.set(edgeId, {
        id: edgeId,
        source,
        target
      });
    }
  };

  const includeNode = (node: ProcessChainNode, depth: number, rootNodeIdSet: ReadonlySet<string>): void => {
    selectedNodeIds.add(node.id);
    assignProcessChainDepth(node.id, depth, rootNodeIdSet, depthByNodeId);
  };

  for (const block of parsedBlocks) {
    ensureBlockNode(block);
  }

  const normalizedContextPath = contextRelativePath ? normalizeProcessChainPath(contextRelativePath) : null;
  const rootNodeIds =
    normalizedContextPath && normalizedContextPath.toLowerCase().endsWith(".md")
      ? parsedBlocks
          .filter((block) => block.notePath === normalizedContextPath)
          .map((block) => block.nodeId)
      : normalizedContextPath
        ? [ensureFileNode(normalizedContextPath).id]
        : [];
  const rootNodeIdSet = new Set(rootNodeIds);
  const depthByNodeId = new Map<string, number>();

  if (rootNodeIds.length === 0) {
    const emptyMessage =
      normalizedContextPath === null
        ? "ノートまたはファイルを開いてから Activity Bar の Process Chain を選んでください。"
        : normalizedContextPath.toLowerCase().endsWith(".md")
          ? "このノートには Integral block がありません。"
          : "このファイルに紐づく block / file chain はまだ見つかっていません。";

    return {
      columns: [],
      contextRelativePath: normalizedContextPath,
      edges: [],
      emptyMessage,
      nodeDepths: {},
      nodes: {},
      rootNodeIds: []
    };
  }
  const upstreamVisitedBlockIds = new Set<string>();
  const downstreamVisitedBlockIds = new Set<string>();

  const walkBlockUpstream = (blockNodeId: string, blockDepth: number): void => {
    const block = blockByNodeId.get(blockNodeId);

    if (!block) {
      return;
    }

    includeNode(ensureBlockNode(block), blockDepth, rootNodeIdSet);

    if (upstreamVisitedBlockIds.has(blockNodeId)) {
      return;
    }

    upstreamVisitedBlockIds.add(blockNodeId);

    for (const inputPath of block.inputs) {
      const fileNode = ensureFileNode(inputPath);
      includeNode(fileNode, blockDepth - 1, rootNodeIdSet);
      addEdge(fileNode.id, blockNodeId);

      const parentNodeIds =
        producerNodeIdsByFilePath.get(inputPath)?.filter((nodeId) => nodeId !== blockNodeId) ?? [];

      for (const parentNodeId of parentNodeIds) {
        const parentBlock = blockByNodeId.get(parentNodeId);

        if (!parentBlock) {
          continue;
        }

        includeNode(ensureBlockNode(parentBlock), blockDepth - 2, rootNodeIdSet);
        addEdge(parentNodeId, fileNode.id);
        walkBlockUpstream(parentNodeId, blockDepth - 2);
      }
    }
  };

  const walkBlockDownstream = (blockNodeId: string, blockDepth: number): void => {
    const block = blockByNodeId.get(blockNodeId);

    if (!block) {
      return;
    }

    includeNode(ensureBlockNode(block), blockDepth, rootNodeIdSet);

    if (downstreamVisitedBlockIds.has(blockNodeId)) {
      return;
    }

    downstreamVisitedBlockIds.add(blockNodeId);

    for (const outputPath of block.outputs) {
      const fileNode = ensureFileNode(outputPath);
      includeNode(fileNode, blockDepth + 1, rootNodeIdSet);
      addEdge(blockNodeId, fileNode.id);

      const childNodeIds =
        consumerNodeIdsByFilePath.get(outputPath)?.filter((nodeId) => nodeId !== blockNodeId) ?? [];

      for (const childNodeId of childNodeIds) {
        const childBlock = blockByNodeId.get(childNodeId);

        if (!childBlock) {
          continue;
        }

        includeNode(ensureBlockNode(childBlock), blockDepth + 2, rootNodeIdSet);
        addEdge(fileNode.id, childNodeId);
        walkBlockDownstream(childNodeId, blockDepth + 2);
      }
    }
  };

  if (normalizedContextPath?.toLowerCase().endsWith(".md")) {
    for (const rootNodeId of rootNodeIds) {
      const rootBlock = blockByNodeId.get(rootNodeId);

      if (!rootBlock) {
        continue;
      }

      includeNode(ensureBlockNode(rootBlock), 0, rootNodeIdSet);
    }

    for (const rootNodeId of rootNodeIds) {
      walkBlockUpstream(rootNodeId, 0);
      walkBlockDownstream(rootNodeId, 0);
    }
  } else if (normalizedContextPath) {
    const rootFileNode = ensureFileNode(normalizedContextPath);
    includeNode(rootFileNode, 0, rootNodeIdSet);

    const producerNodeIds = producerNodeIdsByFilePath.get(normalizedContextPath) ?? [];
    const consumerNodeIds = consumerNodeIdsByFilePath.get(normalizedContextPath) ?? [];

    for (const producerNodeId of producerNodeIds) {
      const producerBlock = blockByNodeId.get(producerNodeId);

      if (!producerBlock) {
        continue;
      }

      includeNode(ensureBlockNode(producerBlock), -1, rootNodeIdSet);
      addEdge(producerNodeId, rootFileNode.id);
      walkBlockUpstream(producerNodeId, -1);
    }

    for (const consumerNodeId of consumerNodeIds) {
      const consumerBlock = blockByNodeId.get(consumerNodeId);

      if (!consumerBlock) {
        continue;
      }

      includeNode(ensureBlockNode(consumerBlock), 1, rootNodeIdSet);
      addEdge(rootFileNode.id, consumerNodeId);
      walkBlockDownstream(consumerNodeId, 1);
    }
  }

  const filteredNodes = Object.fromEntries(
    Array.from(selectedNodeIds).map((nodeId) => {
      const node = nodes.get(nodeId);

      if (!node) {
        throw new Error(`process chain node が見つかりません: ${nodeId}`);
      }

      return [
        nodeId,
        {
          ...node,
          isRoot: rootNodeIds.includes(nodeId)
        }
      ] satisfies [string, ProcessChainNode];
    })
  );
  const filteredEdges = Array.from(selectedEdges.values()).filter(
    (edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target)
  );
  const nodeDepths = Object.fromEntries(Array.from(depthByNodeId.entries()));
  const columns = Array.from(
    Array.from(selectedNodeIds).reduce((map, nodeId) => {
      const depth = depthByNodeId.get(nodeId) ?? 0;
      const currentNodeIds = map.get(depth) ?? [];
      currentNodeIds.push(nodeId);
      map.set(depth, currentNodeIds);
      return map;
    }, new Map<number, string[]>()).entries()
  )
    .sort((left, right) => left[0] - right[0])
    .map(([depth, nodeIds]) => ({
      depth,
      nodeIds: nodeIds.sort((leftNodeId, rightNodeId) =>
        compareProcessChainNodes(filteredNodes[leftNodeId], filteredNodes[rightNodeId])
      )
    }));

  return {
    columns,
    contextRelativePath: normalizedContextPath,
    edges: filteredEdges,
    emptyMessage: null,
    nodeDepths,
    nodes: filteredNodes,
    rootNodeIds
  };
}

function parseNoteBlocks(
  notePath: string,
  markdown: string,
  definitionMap: ReadonlyMap<string, IntegralBlockTypeDefinition>,
  resolveReferenceToPath: (reference: string | null) => string | null
): ParsedNoteBlock[] {
  const blocks: ParsedNoteBlock[] = [];
  let blockIndex = 0;

  for (const match of markdown.matchAll(/```itg-notes\r?\n([\s\S]*?)\r?\n```/gu)) {
    const blockSource = match[1] ?? "";
    const parsed = parseIntegralBlockSource(INTEGRAL_BLOCK_LANGUAGE, blockSource);

    if (!parsed?.block) {
      continue;
    }

    const block = parsed.block;
    const definitionKey = `${block.plugin}::${block["block-type"]}`;
    const definition = definitionMap.get(definitionKey);
    const blockId = block.id?.trim() ?? null;

    blocks.push({
      block,
      blockId,
      blockTypeKey: definitionKey,
      inputs: Object.values(block.inputs)
        .map((reference) => resolveReferenceToPath(reference))
        .filter((reference): reference is string => reference !== null),
      nodeId: `block:${notePath}#${blockId ?? `index-${blockIndex}`}`,
      notePath,
      outputs: Object.values(block.outputs)
        .map((reference) => resolveReferenceToPath(reference))
        .filter((reference): reference is string => reference !== null),
      title: definition?.title ?? block["block-type"]
    });
    blockIndex += 1;
  }

  return blocks;
}

function appendProcessChainIndex(
  index: Map<string, string[]>,
  relativePath: string,
  nodeId: string
): void {
  const currentNodeIds = index.get(relativePath) ?? [];

  if (!currentNodeIds.includes(nodeId)) {
    currentNodeIds.push(nodeId);
    index.set(relativePath, currentNodeIds);
  }
}

function assignProcessChainDepth(
  nodeId: string,
  depth: number,
  rootNodeIdSet: ReadonlySet<string>,
  depthByNodeId: Map<string, number>
): void {
  if (rootNodeIdSet.has(nodeId)) {
    depthByNodeId.set(nodeId, 0);
    return;
  }

  const currentDepth = depthByNodeId.get(nodeId);

  if (
    currentDepth === undefined ||
    Math.abs(depth) < Math.abs(currentDepth) ||
    (Math.abs(depth) === Math.abs(currentDepth) && depth < currentDepth)
  ) {
    depthByNodeId.set(nodeId, depth);
  }
}

function computeNodePositions(
  columns: ProcessChainGraph["columns"]
): Record<string, ProcessChainNodePosition> {
  const positions: Record<string, ProcessChainNodePosition> = {};

  const firstDepth = columns[0]?.depth ?? 0;

  for (const column of columns) {
    const left = GRAPH_PADDING + (column.depth - firstDepth) * (NODE_WIDTH + COLUMN_GAP);
    const inputPortX = left - 1;
    const outputPortX = left + NODE_WIDTH + 1;

    column.nodeIds.forEach((nodeId, index) => {
      const top = GRAPH_PADDING + 24 + index * (NODE_HEIGHT + ROW_GAP);

      positions[nodeId] = {
        height: NODE_HEIGHT,
        inputPortX,
        left,
        outputPortX,
        portY: top + NODE_HEIGHT / 2,
        top,
        width: NODE_WIDTH
      };
    });
  }

  return positions;
}

function buildEdgePath(
  sourcePosition: ProcessChainNodePosition,
  targetPosition: ProcessChainNodePosition
): string {
  const sourceX = sourcePosition.outputPortX;
  const targetX = targetPosition.inputPortX;
  const sourceY = sourcePosition.portY;
  const targetY = targetPosition.portY;
  const controlOffset = Math.max(36, Math.abs(targetX - sourceX) * 0.45);

  return [
    `M ${sourceX} ${sourceY}`,
    `C ${sourceX + controlOffset} ${sourceY},`,
    `${targetX - controlOffset} ${targetY},`,
    `${targetX} ${targetY}`
  ].join(" ");
}

function collectIndexableNotePaths(entries: WorkspaceEntry[]): string[] {
  const notePaths: string[] = [];

  const visitEntries = (currentEntries: WorkspaceEntry[]): void => {
    for (const entry of currentEntries) {
      if (entry.kind === "file") {
        const normalizedPath = normalizeProcessChainPath(entry.relativePath);

        if (
          normalizedPath.toLowerCase().endsWith(".md") &&
          !normalizedPath.toLowerCase().startsWith(".store/")
        ) {
          notePaths.push(normalizedPath);
        }

        continue;
      }

      if (entry.children) {
        visitEntries(entry.children);
      }
    }
  };

  visitEntries(entries);
  return notePaths.sort((left, right) => left.localeCompare(right, "ja"));
}

function collectWorkspaceFiles(
  entries: WorkspaceEntry[],
  workspaceFileMap: Map<string, WorkspaceEntry>
): void {
  for (const entry of entries) {
    const normalizedPath = normalizeProcessChainPath(entry.relativePath);
    workspaceFileMap.set(normalizedPath, entry);

    if (entry.children) {
      collectWorkspaceFiles(entry.children, workspaceFileMap);
    }
  }
}

function calculateColumnHeight(nodeCount: number): number {
  return 24 + nodeCount * NODE_HEIGHT + Math.max(0, nodeCount - 1) * ROW_GAP;
}

function compareProcessChainNodes(left: ProcessChainNode, right: ProcessChainNode): number {
  if (left.isRoot !== right.isRoot) {
    return left.isRoot ? -1 : 1;
  }

  if (left.category !== right.category) {
    return left.category === "block" ? -1 : 1;
  }

  return `${left.label} ${left.subtitle}`.localeCompare(`${right.label} ${right.subtitle}`, "ja");
}

function normalizeProcessChainPath(relativePath: string): string {
  return relativePath
    .trim()
    .replace(/\\/gu, "/")
    .replace(/^\/+/u, "")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    .join("/");
}

function basename(relativePath: string): string {
  const parts = relativePath.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? relativePath;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}
