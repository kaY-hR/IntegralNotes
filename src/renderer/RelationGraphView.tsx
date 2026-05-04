import { MultiDirectedGraph } from "graphology";
import Sigma from "sigma";
import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type {
  RelationEdgeType,
  RelationGraphEdge,
  RelationGraphNode,
  RelationGraphSnapshot,
  RelationJsonValue,
  RelationNodeKind
} from "../shared/relationGraph";
import type { WorkspaceToolPluginRenderContext } from "./workspaceToolPlugins";

interface SigmaNodeAttributes {
  color: string;
  label: string;
  relationNodeId: string;
  size: number;
  x: number;
  y: number;
}

interface SigmaEdgeAttributes {
  color: string;
  label: string;
  size: number;
}

const ACTIVE_NEIGHBORHOOD_HOPS = 1;
const MAX_DRAG_PHYSICS_NODES = 400;
const DRAG_CLICK_SUPPRESS_DISTANCE = 0.08;
const DRAG_SPRING_STRENGTH = 0.038;
const DRAG_SPRING_DAMPING = 0.82;
const DRAG_SETTLE_VELOCITY = 0.0025;
const DRAG_MAX_STEP = 0.22;
const ACTIVE_PATH_KIND_PRIORITY: Record<RelationNodeKind, number> = {
  note: 0,
  "data-note": 1,
  file: 2,
  folder: 3,
  "python-callable": 4,
  block: 5
};
const NODE_KIND_COLORS: Record<RelationNodeKind, string> = {
  block: "#8a6f3d",
  "data-note": "#237b6c",
  file: "#5d7188",
  folder: "#b8773d",
  note: "#496fb0",
  "python-callable": "#8a558a"
};
const EDGE_TYPE_COLORS: Record<RelationEdgeType, string> = {
  "block-call": "#8a558a",
  "block-input": "#4f8b66",
  "block-output": "#bf6b4b",
  contains: "#9aa7b4",
  "dataset-member": "#237b6c",
  defines: "#8a558a",
  "markdown-link": "#496fb0"
};

export function RelationGraphView(
  context: WorkspaceToolPluginRenderContext
): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma<SigmaNodeAttributes, SigmaEdgeAttributes> | null>(null);
  const [snapshot, setSnapshot] = useState<RelationGraphSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [enabledEdgeTypes, setEnabledEdgeTypes] = useState<Set<RelationEdgeType>>(new Set());

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setErrorMessage(null);

    window.integralNotes
      .getRelationGraphSnapshot()
      .then((nextSnapshot) => {
        if (cancelled) {
          return;
        }

        setSnapshot(nextSnapshot);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setErrorMessage(toErrorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [context.workspaceEntries, context.workspaceRevision, context.workspaceRootName]);

  const edgeTypes = useMemo(
    () =>
      Array.from(new Set(snapshot?.edges.map((edge) => edge.type) ?? [])).sort((left, right) =>
        left.localeCompare(right)
      ),
    [snapshot]
  );

  useEffect(() => {
    setEnabledEdgeTypes((current) => {
      const next = new Set(current);

      for (const edgeType of edgeTypes) {
        next.add(edgeType);
      }

      for (const edgeType of current) {
        if (!edgeTypes.includes(edgeType)) {
          next.delete(edgeType);
        }
      }

      return next;
    });
  }, [edgeTypes]);

  const activeNodeId = useMemo(
    () => (snapshot ? findNodeIdByPath(snapshot.nodes, context.contextRelativePath) : null),
    [context.contextRelativePath, snapshot]
  );
  const highlightedNodeIds = useMemo(
    () =>
      snapshot && activeNodeId
        ? collectNeighborhoodNodeIds(activeNodeId, snapshot.edges, ACTIVE_NEIGHBORHOOD_HOPS)
        : new Set<string>(),
    [activeNodeId, snapshot]
  );
  const matchingNodeIds = useMemo(
    () => (snapshot ? collectMatchingNodeIds(snapshot.nodes, searchQuery) : new Set<string>()),
    [searchQuery, snapshot]
  );

  useEffect(() => {
    const container = containerRef.current;

    if (!container || !snapshot) {
      return;
    }

    sigmaRef.current?.kill();
    sigmaRef.current = null;

    const graph = buildSigmaGraph(snapshot, {
      activeNodeId,
      enabledEdgeTypes,
      highlightedNodeIds,
      matchingNodeIds,
      searchQuery
    });
    const renderer = new Sigma(graph, container, {
      allowInvalidContainer: true,
      defaultEdgeColor: "#a0acb8",
      defaultNodeColor: "#63798f",
      labelDensity: 0.09,
      labelGridCellSize: 90,
      labelRenderedSizeThreshold: 8,
      renderEdgeLabels: false
    });

    let suppressNodeClickUntil = 0;
    const dragCleanup = registerNodeDragPhysics(graph, renderer, snapshot.edges, enabledEdgeTypes, {
      onDragEnd: (moved) => {
        if (moved) {
          suppressNodeClickUntil = window.performance.now() + 250;
        }
      }
    });

    renderer.on("clickNode", ({ node }: { node: string }) => {
      if (window.performance.now() < suppressNodeClickUntil) {
        return;
      }

      const relationNode = snapshot.nodes.find((candidate) => candidate.id === node);

      if (relationNode) {
        openRelationNode(context, relationNode);
      }
    });

    renderer.getCamera().animatedReset({ duration: 240 });
    sigmaRef.current = renderer;

    return () => {
      dragCleanup();
      renderer.kill();

      if (sigmaRef.current === renderer) {
        sigmaRef.current = null;
      }
    };
  }, [
    activeNodeId,
    context,
    enabledEdgeTypes,
    highlightedNodeIds,
    matchingNodeIds,
    searchQuery,
    snapshot
  ]);

  const nodeCount = snapshot?.nodeCount ?? 0;
  const edgeCount = snapshot?.edgeCount ?? 0;

  return (
    <div className="relation-graph">
      <header className="relation-graph__toolbar">
        <div className="relation-graph__summary">
          <strong>Relation Graph</strong>
          <span>{nodeCount} nodes</span>
          <span>{edgeCount} edges</span>
          {activeNodeId ? <span>active + {ACTIVE_NEIGHBORHOOD_HOPS} hops</span> : null}
        </div>

        <div className="relation-graph__controls">
          <input
            aria-label="Search graph nodes"
            className="relation-graph__search"
            onChange={(event) => {
              setSearchQuery(event.target.value);
            }}
            placeholder="Search"
            type="search"
            value={searchQuery}
          />
          <div className="relation-graph__edge-filters" aria-label="Edge filters">
            {edgeTypes.map((edgeType) => (
              <label className="relation-graph__edge-filter" key={edgeType}>
                <input
                  checked={enabledEdgeTypes.has(edgeType)}
                  onChange={() => {
                    setEnabledEdgeTypes((current) => {
                      const next = new Set(current);

                      if (next.has(edgeType)) {
                        next.delete(edgeType);
                      } else {
                        next.add(edgeType);
                      }

                      return next;
                    });
                  }}
                  type="checkbox"
                />
                <span
                  className="relation-graph__edge-swatch"
                  style={{ background: EDGE_TYPE_COLORS[edgeType] }}
                />
                <span>{edgeType}</span>
              </label>
            ))}
          </div>
        </div>
      </header>

      <div className="relation-graph__surface">
        {loading ? <div className="relation-graph__message">Loading graph...</div> : null}
        {errorMessage ? <div className="relation-graph__message">{errorMessage}</div> : null}
        {!loading && !errorMessage && snapshot && snapshot.nodes.length === 0 ? (
          <div className="relation-graph__message">No relation nodes.</div>
        ) : null}
        {!loading && !errorMessage && !snapshot ? (
          <div className="relation-graph__message">Open a workspace to show the graph.</div>
        ) : null}
        <div className="relation-graph__sigma" ref={containerRef} />
      </div>
    </div>
  );
}

function buildSigmaGraph(
  snapshot: RelationGraphSnapshot,
  options: {
    activeNodeId: string | null;
    enabledEdgeTypes: ReadonlySet<RelationEdgeType>;
    highlightedNodeIds: ReadonlySet<string>;
    matchingNodeIds: ReadonlySet<string>;
    searchQuery: string;
  }
): MultiDirectedGraph<SigmaNodeAttributes, SigmaEdgeAttributes> {
  const graph = new MultiDirectedGraph<SigmaNodeAttributes, SigmaEdgeAttributes>({
    allowSelfLoops: false
  });
  const nodeIds = new Set(snapshot.nodes.map((node) => node.id));
  const visibleEdges = collectVisibleEdges(snapshot.edges, options.enabledEdgeTypes, nodeIds);
  const positions = computeNodePositions(snapshot.nodes, visibleEdges);
  const hasSearch = options.searchQuery.trim().length > 0;
  const hasActive = options.activeNodeId !== null;

  for (const node of snapshot.nodes) {
    const position = positions.get(node.id) ?? { x: 0, y: 0 };
    const isActive = node.id === options.activeNodeId;
    const isHighlighted = options.highlightedNodeIds.has(node.id);
    const isSearchMatch = options.matchingNodeIds.has(node.id);
    const dimmedByActive = hasActive && !isHighlighted;
    const dimmedBySearch = hasSearch && !isSearchMatch;
    const baseColor = NODE_KIND_COLORS[node.kind];
    const color = isActive
      ? "#d14f3f"
      : dimmedBySearch || dimmedByActive
        ? "#c2cad2"
        : baseColor;
    const size = isActive ? 13 : isHighlighted || isSearchMatch ? 9 : node.kind === "folder" ? 6 : 7;

    graph.addNode(node.id, {
      color,
      label: node.label,
      relationNodeId: node.id,
      size,
      x: position.x,
      y: position.y
    });
  }

  for (const edge of visibleEdges) {
    if (!graph.hasNode(edge.sourceId) || !graph.hasNode(edge.targetId)) {
      continue;
    }

    const dimmed =
      (hasActive &&
        (!options.highlightedNodeIds.has(edge.sourceId) || !options.highlightedNodeIds.has(edge.targetId))) ||
      (hasSearch &&
        !options.matchingNodeIds.has(edge.sourceId) &&
        !options.matchingNodeIds.has(edge.targetId));

    graph.addDirectedEdgeWithKey(edge.id, edge.sourceId, edge.targetId, {
      color: dimmed ? "#d6dde4" : EDGE_TYPE_COLORS[edge.type],
      label: edge.type,
      size: edge.type === "contains" ? 1 : 1.5
    });
  }

  return graph;
}

function collectVisibleEdges(
  edges: readonly RelationGraphEdge[],
  enabledEdgeTypes: ReadonlySet<RelationEdgeType>,
  nodeIds: ReadonlySet<string>
): RelationGraphEdge[] {
  return edges.filter(
    (edge) =>
      enabledEdgeTypes.has(edge.type) &&
      nodeIds.has(edge.sourceId) &&
      nodeIds.has(edge.targetId)
  );
}

function registerNodeDragPhysics(
  graph: MultiDirectedGraph<SigmaNodeAttributes, SigmaEdgeAttributes>,
  renderer: Sigma<SigmaNodeAttributes, SigmaEdgeAttributes>,
  edges: readonly RelationGraphEdge[],
  enabledEdgeTypes: ReadonlySet<RelationEdgeType>,
  options: { onDragEnd: (moved: boolean) => void }
): () => void {
  const mouseCaptor = renderer.getMouseCaptor();
  const nodeIds = new Set(graph.nodes());
  const visibleEdges = collectVisibleEdges(edges, enabledEdgeTypes, nodeIds);
  const velocities = new Map<string, { x: number; y: number }>();
  let draggedNodeId: string | null = null;
  let dragStartPosition: { x: number; y: number } | null = null;
  let previousDragPosition: { x: number; y: number } | null = null;
  let animationFrame: number | null = null;
  const initialCameraPanning = renderer.getSetting("enableCameraPanning");
  let killed = false;

  const setVelocity = (nodeId: string, x: number, y: number): void => {
    velocities.set(nodeId, {
      x: clamp(x, -DRAG_MAX_STEP, DRAG_MAX_STEP),
      y: clamp(y, -DRAG_MAX_STEP, DRAG_MAX_STEP)
    });
  };

  const schedulePhysics = (): void => {
    if (animationFrame !== null || killed || graph.order === 0) {
      return;
    }

    animationFrame = window.requestAnimationFrame(tickPhysics);
  };

  const handleDownNode = (payload: { node: string; preventSigmaDefault(): void }): void => {
    if (!graph.hasNode(payload.node)) {
      return;
    }

    payload.preventSigmaDefault();
    draggedNodeId = payload.node;
    dragStartPosition = getNodePosition(graph, payload.node);
    previousDragPosition = dragStartPosition;
    setVelocity(payload.node, 0, 0);
    renderer.setSetting("enableCameraPanning", false);
    schedulePhysics();
  };

  const handleMouseMove = (coordinates: { x: number; y: number; preventSigmaDefault(): void }): void => {
    if (!draggedNodeId || !graph.hasNode(draggedNodeId)) {
      return;
    }

    coordinates.preventSigmaDefault();
    const graphPosition = renderer.viewportToGraph({ x: coordinates.x, y: coordinates.y });
    const previousPosition = previousDragPosition ?? graphPosition;

    graph.setNodeAttribute(draggedNodeId, "x", graphPosition.x);
    graph.setNodeAttribute(draggedNodeId, "y", graphPosition.y);
    setVelocity(draggedNodeId, graphPosition.x - previousPosition.x, graphPosition.y - previousPosition.y);
    previousDragPosition = graphPosition;
    schedulePhysics();
  };

  const stopDrag = (): void => {
    if (!draggedNodeId) {
      return;
    }

    const releasedNodeId = draggedNodeId;
    const endPosition = graph.hasNode(releasedNodeId)
      ? getNodePosition(graph, releasedNodeId)
      : previousDragPosition;
    const moved =
      !!dragStartPosition &&
      !!endPosition &&
      distanceBetween(dragStartPosition, endPosition) >= DRAG_CLICK_SUPPRESS_DISTANCE;

    draggedNodeId = null;
    dragStartPosition = null;
    previousDragPosition = null;
    renderer.setSetting("enableCameraPanning", initialCameraPanning);
    options.onDragEnd(moved);
    schedulePhysics();
  };

  const handleMouseUp = (): void => {
    stopDrag();
  };

  const handleMouseLeave = (): void => {
    stopDrag();
  };

  const tickPhysics = (): void => {
    animationFrame = null;

    if (killed) {
      return;
    }

    const shouldContinue = stepDragPhysics(graph, visibleEdges, velocities, draggedNodeId);

    renderer.refresh();

    if (shouldContinue || draggedNodeId !== null) {
      schedulePhysics();
    }
  };

  renderer.on("downNode", handleDownNode);
  mouseCaptor.on("mousemovebody", handleMouseMove);
  mouseCaptor.on("mouseup", handleMouseUp);
  mouseCaptor.on("mouseleave", handleMouseLeave);

  return () => {
    killed = true;
    draggedNodeId = null;
    renderer.setSetting("enableCameraPanning", initialCameraPanning);
    renderer.off("downNode", handleDownNode);
    mouseCaptor.off("mousemovebody", handleMouseMove);
    mouseCaptor.off("mouseup", handleMouseUp);
    mouseCaptor.off("mouseleave", handleMouseLeave);

    if (animationFrame !== null) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
  };
}

function stepDragPhysics(
  graph: MultiDirectedGraph<SigmaNodeAttributes, SigmaEdgeAttributes>,
  edges: readonly RelationGraphEdge[],
  velocities: Map<string, { x: number; y: number }>,
  draggedNodeId: string | null
): boolean {
  if (graph.order > MAX_DRAG_PHYSICS_NODES) {
    return false;
  }

  const deltas = new Map<string, { x: number; y: number }>();

  for (const nodeId of graph.nodes()) {
    deltas.set(nodeId, { x: 0, y: 0 });
  }

  for (const edge of edges) {
    if (!graph.hasNode(edge.sourceId) || !graph.hasNode(edge.targetId)) {
      continue;
    }

    const sourcePosition = getNodePosition(graph, edge.sourceId);
    const targetPosition = getNodePosition(graph, edge.targetId);
    const dx = targetPosition.x - sourcePosition.x;
    const dy = targetPosition.y - sourcePosition.y;
    const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 0.001);
    const restLength = edge.type === "contains" ? 0.95 : 1.2;
    const force = clamp((distance - restLength) * DRAG_SPRING_STRENGTH, -0.08, 0.08);
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;

    if (edge.sourceId !== draggedNodeId) {
      addDelta(deltas, edge.sourceId, fx, fy);
    }

    if (edge.targetId !== draggedNodeId) {
      addDelta(deltas, edge.targetId, -fx, -fy);
    }
  }

  let maxVelocity = 0;

  for (const nodeId of graph.nodes()) {
    if (nodeId === draggedNodeId) {
      continue;
    }

    const delta = deltas.get(nodeId) ?? { x: 0, y: 0 };
    const currentVelocity = velocities.get(nodeId) ?? { x: 0, y: 0 };
    const vx = clamp((currentVelocity.x + delta.x) * DRAG_SPRING_DAMPING, -DRAG_MAX_STEP, DRAG_MAX_STEP);
    const vy = clamp((currentVelocity.y + delta.y) * DRAG_SPRING_DAMPING, -DRAG_MAX_STEP, DRAG_MAX_STEP);

    if (Math.abs(vx) < DRAG_SETTLE_VELOCITY && Math.abs(vy) < DRAG_SETTLE_VELOCITY) {
      velocities.delete(nodeId);
      continue;
    }

    const position = getNodePosition(graph, nodeId);
    graph.setNodeAttribute(nodeId, "x", position.x + vx);
    graph.setNodeAttribute(nodeId, "y", position.y + vy);
    velocities.set(nodeId, { x: vx, y: vy });
    maxVelocity = Math.max(maxVelocity, Math.abs(vx), Math.abs(vy));
  }

  return maxVelocity >= DRAG_SETTLE_VELOCITY || draggedNodeId !== null;
}

function getNodePosition(
  graph: MultiDirectedGraph<SigmaNodeAttributes, SigmaEdgeAttributes>,
  nodeId: string
): { x: number; y: number } {
  return {
    x: graph.getNodeAttribute(nodeId, "x"),
    y: graph.getNodeAttribute(nodeId, "y")
  };
}

function distanceBetween(
  left: { x: number; y: number },
  right: { x: number; y: number }
): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function computeNodePositions(
  nodes: readonly RelationGraphNode[],
  edges: readonly RelationGraphEdge[]
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const sortedNodes = [...nodes].sort((left, right) =>
    `${left.kind} ${left.label} ${left.id}`.localeCompare(
      `${right.kind} ${right.label} ${right.id}`,
      "ja"
    )
  );
  const kindOrder: RelationNodeKind[] = [
    "folder",
    "note",
    "data-note",
    "block",
    "python-callable",
    "file"
  ];
  const grouped = new Map<RelationNodeKind, RelationGraphNode[]>();

  for (const node of sortedNodes) {
    const group = grouped.get(node.kind) ?? [];
    group.push(node);
    grouped.set(node.kind, group);
  }

  kindOrder.forEach((kind, kindIndex) => {
    const group = grouped.get(kind) ?? [];
    const groupAngle = (Math.PI * 2 * kindIndex) / kindOrder.length - Math.PI / 2;
    const groupCenter = {
      x: Math.cos(groupAngle) * 4.5,
      y: Math.sin(groupAngle) * 4.5
    };

    group.forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(group.length, 1);
      const radius = Math.max(0.5, Math.sqrt(group.length) * 0.42);
      positions.set(node.id, {
        x: groupCenter.x + Math.cos(angle) * radius,
        y: groupCenter.y + Math.sin(angle) * radius
      });
    });
  });

  if (nodes.length <= 250) {
    relaxPositions(sortedNodes, edges, positions);
  }

  return positions;
}

function relaxPositions(
  nodes: readonly RelationGraphNode[],
  edges: readonly RelationGraphEdge[],
  positions: Map<string, { x: number; y: number }>
): void {
  for (let iteration = 0; iteration < 120; iteration += 1) {
    const deltas = new Map<string, { x: number; y: number }>();

    for (const node of nodes) {
      deltas.set(node.id, { x: 0, y: 0 });
    }

    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const left = nodes[leftIndex]!;
        const right = nodes[rightIndex]!;
        const leftPosition = positions.get(left.id) ?? { x: 0, y: 0 };
        const rightPosition = positions.get(right.id) ?? { x: 0, y: 0 };
        const dx = leftPosition.x - rightPosition.x;
        const dy = leftPosition.y - rightPosition.y;
        const distanceSquared = Math.max(dx * dx + dy * dy, 0.08);
        const force = 0.018 / distanceSquared;
        const distance = Math.sqrt(distanceSquared);
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;

        addDelta(deltas, left.id, fx, fy);
        addDelta(deltas, right.id, -fx, -fy);
      }
    }

    for (const edge of edges) {
      const sourcePosition = positions.get(edge.sourceId);
      const targetPosition = positions.get(edge.targetId);

      if (!sourcePosition || !targetPosition) {
        continue;
      }

      const dx = targetPosition.x - sourcePosition.x;
      const dy = targetPosition.y - sourcePosition.y;
      const force = 0.006;
      addDelta(deltas, edge.sourceId, dx * force, dy * force);
      addDelta(deltas, edge.targetId, -dx * force, -dy * force);
    }

    for (const [nodeId, delta] of deltas) {
      const position = positions.get(nodeId);

      if (!position) {
        continue;
      }

      positions.set(nodeId, {
        x: position.x + delta.x,
        y: position.y + delta.y
      });
    }
  }
}

function addDelta(
  deltas: Map<string, { x: number; y: number }>,
  nodeId: string,
  x: number,
  y: number
): void {
  const current = deltas.get(nodeId);

  if (!current) {
    return;
  }

  current.x += x;
  current.y += y;
}

function findNodeIdByPath(
  nodes: readonly RelationGraphNode[],
  relativePath: string | null
): string | null {
  const normalizedPath = normalizeRelativePath(relativePath ?? "");

  if (normalizedPath.length === 0) {
    return null;
  }

  const exactPathNode = nodes
    .filter((node) => node.path === normalizedPath)
    .sort(
      (left, right) =>
        ACTIVE_PATH_KIND_PRIORITY[left.kind] - ACTIVE_PATH_KIND_PRIORITY[right.kind] ||
        left.label.localeCompare(right.label, "ja") ||
        left.id.localeCompare(right.id)
    )[0];

  return (
    exactPathNode?.id ??
    nodes.find((node) => metadataString(node.metadata, "dataNotePath") === normalizedPath)?.id ??
    null
  );
}

function collectNeighborhoodNodeIds(
  originNodeId: string,
  edges: readonly RelationGraphEdge[],
  maxHops: number
): Set<string> {
  const included = new Set([originNodeId]);
  let frontier = new Set([originNodeId]);

  for (let hop = 0; hop < maxHops; hop += 1) {
    const next = new Set<string>();

    for (const edge of edges) {
      if (frontier.has(edge.sourceId) && !included.has(edge.targetId)) {
        next.add(edge.targetId);
      }

      if (frontier.has(edge.targetId) && !included.has(edge.sourceId)) {
        next.add(edge.sourceId);
      }
    }

    if (next.size === 0) {
      break;
    }

    for (const nodeId of next) {
      included.add(nodeId);
    }

    frontier = next;
  }

  return included;
}

function collectMatchingNodeIds(
  nodes: readonly RelationGraphNode[],
  query: string
): Set<string> {
  const normalizedQuery = query.trim().toLowerCase();

  if (normalizedQuery.length === 0) {
    return new Set();
  }

  return new Set(
    nodes
      .filter((node) =>
        [
          node.label,
          node.path ?? "",
          node.noteTargetId ?? "",
          metadataString(node.metadata, "blockType"),
          metadataString(node.metadata, "managedDataId"),
          metadataString(node.metadata, "datasetId")
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      )
      .map((node) => node.id)
  );
}

function openRelationNode(
  context: WorkspaceToolPluginRenderContext,
  node: RelationGraphNode
): void {
  if (node.kind === "block") {
    const notePath = metadataString(node.metadata, "sourceNotePath");
    const blockId = metadataString(node.metadata, "blockId");

    if (notePath && blockId) {
      context.onOpenWorkspaceTarget(`/${notePath}#${blockId}`);
      return;
    }
  }

  if (node.kind === "data-note" && node.noteTargetId) {
    context.onOpenWorkspaceFile(`.store/.integral/data-notes/${node.noteTargetId}.md`);
    return;
  }

  if (node.kind === "python-callable") {
    const relativePath = metadataString(node.metadata, "relativePath") || node.path;

    if (relativePath) {
      context.onOpenWorkspaceFile(relativePath);
      return;
    }
  }

  if (node.path && node.kind !== "folder") {
    context.onOpenWorkspaceFile(node.path);
  }
}

function metadataString(
  metadata: Record<string, RelationJsonValue>,
  key: string
): string {
  const value = metadata[key];
  return typeof value === "string" ? value : "";
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath
    .trim()
    .replace(/\\/gu, "/")
    .split("/")
    .filter(Boolean)
    .join("/");
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
