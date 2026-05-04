export type RelationNodeKind =
  | "block"
  | "data-note"
  | "file"
  | "folder"
  | "note"
  | "python-callable";

export type RelationEdgeType =
  | "block-call"
  | "block-input"
  | "block-output"
  | "contains"
  | "dataset-member"
  | "defines"
  | "markdown-link";

export type RelationJsonValue =
  | boolean
  | null
  | number
  | string
  | RelationJsonValue[]
  | {
      [key: string]: RelationJsonValue;
    };

export interface RelationGraphNode {
  id: string;
  kind: RelationNodeKind;
  label: string;
  metadata: Record<string, RelationJsonValue>;
  noteTargetId: string | null;
  path: string | null;
}

export interface RelationGraphEdge {
  id: string;
  metadata: Record<string, RelationJsonValue>;
  originHash: string | null;
  originNodeId: string;
  originPath: string;
  sourceId: string;
  targetId: string;
  type: RelationEdgeType;
}

export interface RelationGraphSnapshot {
  builtAt: string;
  edgeCount: number;
  edges: RelationGraphEdge[];
  nodeCount: number;
  nodes: RelationGraphNode[];
  rootPath: string;
  schemaVersion: number;
}

export interface RelationGraphNeighborhoodRequest {
  maxHops?: number;
  originNodeId: string;
}

export interface RelationGraphNeighborhood {
  edges: RelationGraphEdge[];
  maxHops: number;
  nodes: RelationGraphNode[];
  originNodeId: string;
}
