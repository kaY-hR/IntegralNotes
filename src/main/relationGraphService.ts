import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  IntegralAssetCatalog,
  IntegralBlockTypeDefinition,
  IntegralDatasetSummary,
  IntegralManagedFileSummary
} from "../shared/integral";
import type {
  RelationEdgeType,
  RelationGraphEdge,
  RelationGraphNeighborhood,
  RelationGraphNeighborhoodRequest,
  RelationGraphNode,
  RelationGraphPathDistances,
  RelationGraphPathDistanceRequest,
  RelationGraphSnapshot,
  RelationJsonValue,
  RelationNodeKind
} from "../shared/relationGraph";
import type { WorkspaceEntry } from "../shared/workspace";
import { resolveWorkspaceMarkdownTarget } from "../shared/workspaceLinks";
import { type WorkspaceMutation, WorkspaceService } from "./workspaceService";

type SqlBindValue = Uint8Array | null | number | string;
type SqlBindParams = SqlBindValue[] | Record<string, SqlBindValue>;

interface SqlJsQueryResult {
  columns: string[];
  values: SqlBindValue[][];
}

interface SqlJsStatement {
  bind(params?: SqlBindParams): boolean;
  free(): boolean;
  get(): SqlBindValue[];
  getAsObject(params?: SqlBindParams): Record<string, SqlBindValue | undefined>;
  step(): boolean;
}

interface SqlJsDatabase {
  close(): void;
  exec(sql: string, params?: SqlBindParams): SqlJsQueryResult[];
  export(): Uint8Array;
  prepare(sql: string, params?: SqlBindParams): SqlJsStatement;
  run(sql: string, params?: SqlBindParams): SqlJsDatabase;
}

interface SqlJsStatic {
  Database: new (data?: Uint8Array) => SqlJsDatabase;
}

type InitSqlJs = (config?: { locateFile?: (fileName: string) => string }) => Promise<SqlJsStatic>;

const initSqlJs = require("sql.js") as InitSqlJs;

const RELATION_GRAPH_SCHEMA_VERSION = 2;
const STORE_DIRECTORY = ".store";
const STORE_METADATA_DIRECTORY = ".integral";
const RELATION_INDEX_FILE_NAME = "relation-index.sqlite";
const DATA_NOTE_DIRECTORY = "data-notes";
const INTEGRAL_BLOCK_LANGUAGE = "itg-notes";
const GENERAL_ANALYSIS_PLUGIN_ID = "general-analysis";
const MAX_NEIGHBORHOOD_HOPS = 6;
const PATH_KIND_PRIORITY: Record<RelationNodeKind, number> = {
  note: 0,
  "data-note": 1,
  file: 2,
  folder: 3,
  "python-callable": 4,
  block: 5
};
const INDEXED_TEXT_EXTENSIONS = new Set([".idts", ".md", ".py"]);
const RELATION_GRAPH_MUTATION_DEBOUNCE_MS = 250;
const WORKSPACE_SCAN_EXCLUDED_SEGMENTS = new Set([
  ".git",
  "dist",
  "dist-electron",
  "node_modules",
  "out"
]);
const SQLITE_WASM_PATH = require.resolve("sql.js/dist/sql-wasm.wasm") as string;

export interface RelationGraphServiceOptions {
  getAssetCatalog: () => Promise<IntegralAssetCatalog>;
  workspaceService: WorkspaceService;
}

interface DatabaseHandle {
  database: SqlJsDatabase;
  filePath: string;
  rootPath: string;
}

interface ExtractedRelationSet {
  edges: RelationGraphEdgeDraft[];
  nodes: RelationGraphNodeDraft[];
}

interface RelationGraphNodeDraft {
  id: string;
  kind: RelationNodeKind;
  label: string;
  metadata?: Record<string, RelationJsonValue>;
  noteTargetId?: string | null;
  path?: string | null;
}

interface RelationGraphEdgeDraft {
  metadata?: Record<string, RelationJsonValue>;
  sourceId: string;
  targetId: string;
  type: RelationEdgeType;
}

interface ScanOrigin {
  hash: string;
  kind: "dataset" | "file" | "folder";
  nodeId: string;
  path: string;
  relativePath: string | null;
}

interface FolderOrigin extends ScanOrigin {
  childNodeIds: string[];
  kind: "folder";
}

interface FileOrigin extends ScanOrigin {
  extension: string;
  kind: "file";
}

interface DatasetOrigin extends ScanOrigin {
  dataset: IntegralDatasetSummary;
  kind: "dataset";
}

type RelationOrigin = DatasetOrigin | FileOrigin | FolderOrigin;

interface ScanPlan {
  currentOriginPaths: Set<string>;
  origins: RelationOrigin[];
  structuralNodes: RelationGraphNodeDraft[];
}

interface ManagedPathMapping {
  id: string;
  isDirectory: boolean;
  path: string;
}

interface ScanContext {
  assetCatalog: IntegralAssetCatalog;
  blockTypeByKey: Map<string, IntegralBlockTypeDefinition>;
  managedIdToNodeId: Map<string, string>;
  managedPathMappings: ManagedPathMapping[];
  nodeByPath: Map<string, string>;
  rootName: string;
  rootPath: string;
}

interface RelationExtractor {
  extract: (origin: RelationOrigin, context: ScanContext) => Promise<ExtractedRelationSet>;
  id: string;
}

interface ParsedIntegralBlock {
  blockType: string;
  id: string;
  inputs: Record<string, string | null>;
  outputs: Record<string, string | null>;
  plugin: string;
}

export class RelationGraphService {
  private databaseHandle: DatabaseHandle | null = null;
  private operationQueue: Promise<void> = Promise.resolve();
  private pendingMutationFlushPromise: Promise<void> | null = null;
  private pendingMutationFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingMutations: WorkspaceMutation[] = [];
  private readonly getAssetCatalog: () => Promise<IntegralAssetCatalog>;
  private readonly workspaceService: WorkspaceService;

  constructor(options: RelationGraphServiceOptions) {
    this.getAssetCatalog = options.getAssetCatalog;
    this.workspaceService = options.workspaceService;
  }

  async getSnapshot(): Promise<RelationGraphSnapshot | null> {
    await this.prepareForFullSynchronization();

    return this.enqueue(async () => {
      const rootPath = this.workspaceService.currentRootPath;

      if (!rootPath) {
        return null;
      }

      await this.synchronizeInternal(rootPath);
      const database = (await this.getDatabase(rootPath)).database;
      const nodes = this.readNodes(database);
      const edges = this.readEdges(database);

      return {
        builtAt: new Date().toISOString(),
        edgeCount: edges.length,
        edges,
        nodeCount: nodes.length,
        nodes,
        rootPath,
        schemaVersion: RELATION_GRAPH_SCHEMA_VERSION
      };
    });
  }

  async getNeighborhood(
    request: RelationGraphNeighborhoodRequest
  ): Promise<RelationGraphNeighborhood | null> {
    await this.prepareForFullSynchronization();

    return this.enqueue(async () => {
      const rootPath = this.workspaceService.currentRootPath;

      if (!rootPath) {
        return null;
      }

      await this.synchronizeInternal(rootPath);
      const database = (await this.getDatabase(rootPath)).database;
      const nodes = this.readNodes(database);
      const edges = this.readEdges(database);
      const nodeById = new Map(nodes.map((node) => [node.id, node]));
      const originNodeId = request.originNodeId.trim();

      if (!nodeById.has(originNodeId)) {
        return null;
      }

      const maxHops = clampInteger(request.maxHops ?? 3, 0, MAX_NEIGHBORHOOD_HOPS);
      const includedNodeIds = collectNeighborhoodNodeIds(originNodeId, edges, maxHops);
      const includedEdges = edges.filter(
        (edge) => includedNodeIds.has(edge.sourceId) && includedNodeIds.has(edge.targetId)
      );

      return {
        edges: includedEdges,
        maxHops,
        nodes: [...includedNodeIds]
          .map((nodeId) => nodeById.get(nodeId))
          .filter((node): node is RelationGraphNode => node !== undefined),
        originNodeId
      };
    });
  }

  async getPathDistances(
    request: RelationGraphPathDistanceRequest
  ): Promise<RelationGraphPathDistances | null> {
    await this.prepareForFullSynchronization();

    return this.enqueue(async () => {
      const rootPath = this.workspaceService.currentRootPath;

      if (!rootPath) {
        return null;
      }

      await this.synchronizeInternal(rootPath);
      const database = (await this.getDatabase(rootPath)).database;
      const nodes = this.readNodes(database);
      const edges = this.readEdges(database);
      const originPath = normalizeRelativePath(request.originPath);
      const maxHops = clampInteger(request.maxHops ?? 3, 0, MAX_NEIGHBORHOOD_HOPS);
      const originNodeId = findNodeIdByPath(nodes, originPath);

      if (!originNodeId) {
        return {
          distances: [],
          maxHops,
          originNodeId: null,
          originPath
        };
      }

      return {
        distances: collectPathDistances(
          nodes,
          collectNodeHopDistances(originNodeId, edges, maxHops),
          originPath
        ),
        maxHops,
        originNodeId,
        originPath
      };
    });
  }

  handleWorkspaceMutations(mutations: readonly WorkspaceMutation[]): void {
    if (mutations.length === 0) {
      return;
    }

    this.pendingMutations.push(...mutations);
    this.schedulePendingMutationFlush();
  }

  async synchronize(): Promise<void> {
    await this.prepareForFullSynchronization();

    await this.enqueue(async () => {
      const rootPath = this.workspaceService.currentRootPath;

      if (rootPath) {
        await this.synchronizeInternal(rootPath);
      }
    });
  }

  private async synchronizeInternal(rootPath: string): Promise<void> {
    const handle = await this.getDatabase(rootPath);
    const plan = await this.createScanPlan(rootPath);
    const originCount = readSingleNumber(handle.database, "SELECT COUNT(*) FROM origins");
    const rebuild = originCount === 0;

    if (rebuild) {
      handle.database.run("BEGIN TRANSACTION");
      try {
        clearRelationGraphTables(handle.database);
        handle.database.run("COMMIT");
      } catch (error) {
        handle.database.run("ROLLBACK");
        throw error;
      }
    }

    await this.applyScanPlan(handle.database, plan, {
      forceOriginPaths: rebuild ? plan.currentOriginPaths : new Set<string>(),
      removeStaleOrigins: true
    });
    await this.persistDatabase(handle);
  }

  private async applyWorkspaceMutations(mutations: readonly WorkspaceMutation[]): Promise<void> {
    if (mutations.length === 0) {
      return;
    }

    const rootPath = this.workspaceService.currentRootPath;

    if (!rootPath) {
      return;
    }

    const handle = await this.getDatabase(rootPath);
    const affectedPaths = collectAffectedOriginPaths(mutations);

    handle.database.run("BEGIN TRANSACTION");
    try {
      for (const mutation of mutations) {
        if (mutation.kind === "delete" || mutation.kind === "move") {
          this.deletePathSubtree(handle.database, normalizeRelativePath(mutation.path));
        }
      }

      handle.database.run("COMMIT");
    } catch (error) {
      handle.database.run("ROLLBACK");
      throw error;
    }

    const plan = await this.createScanPlan(rootPath);
    const affectedOrigins = plan.origins.filter(
      (origin) =>
        affectedPaths.has(origin.path) ||
        (origin.relativePath !== null && isPathInAffectedSet(origin.relativePath, affectedPaths))
    );

    await this.applyScanPlan(handle.database, plan, {
      forceOriginPaths: new Set(affectedOrigins.map((origin) => origin.path)),
      removeStaleOrigins: false
    });
    await this.persistDatabase(handle);
  }

  private async applyScanPlan(
    database: SqlJsDatabase,
    plan: ScanPlan,
    options: {
      forceOriginPaths: ReadonlySet<string>;
      removeStaleOrigins: boolean;
    }
  ): Promise<void> {
    const originHashes = this.readOriginHashes(database);

    database.run("BEGIN TRANSACTION");
    try {
      for (const node of plan.structuralNodes) {
        upsertNode(database, node);
      }

      if (options.removeStaleOrigins) {
        for (const originPath of originHashes.keys()) {
          if (!plan.currentOriginPaths.has(originPath)) {
            deleteOrigin(database, originPath);
          }
        }
      }

      for (const origin of plan.origins) {
        const previousHash = originHashes.get(origin.path);

        if (previousHash === origin.hash && !options.forceOriginPaths.has(origin.path)) {
          continue;
        }

        deleteOrigin(database, origin.path);
        upsertOrigin(database, origin);

        for (const extractor of RELATION_EXTRACTORS) {
          const extracted = await extractor.extract(origin, this.createContextFromPlan(plan));

          for (const node of extracted.nodes) {
            upsertNode(database, node);
          }

          for (const edge of extracted.edges) {
            upsertEdge(database, origin, edge);
          }
        }
      }

      deleteOrphanDerivedNodes(database);
      database.run("COMMIT");
    } catch (error) {
      database.run("ROLLBACK");
      throw error;
    }
  }

  private createContextFromPlan(plan: ScanPlan): ScanContext {
    const rootNode = plan.structuralNodes.find((node) => node.id === folderNodeId(""));

    return {
      assetCatalog: this.currentAssetCatalog,
      blockTypeByKey: this.currentBlockTypeByKey,
      managedIdToNodeId: this.currentManagedIdToNodeId,
      managedPathMappings: this.currentManagedPathMappings,
      nodeByPath: this.currentNodeByPath,
      rootName: rootNode?.label ?? "Workspace",
      rootPath: this.currentRootPathForContext
    };
  }

  private currentAssetCatalog: IntegralAssetCatalog = {
    blockTypes: [],
    datasets: [],
    managedFiles: []
  };
  private currentBlockTypeByKey = new Map<string, IntegralBlockTypeDefinition>();
  private currentManagedIdToNodeId = new Map<string, string>();
  private currentManagedPathMappings: ManagedPathMapping[] = [];
  private currentNodeByPath = new Map<string, string>();
  private currentRootPathForContext = "";

  private async createScanPlan(rootPath: string): Promise<ScanPlan> {
    await this.workspaceService.ensureWorkspaceReady();
    const [snapshot, assetCatalog] = await Promise.all([
      this.workspaceService.getSnapshot(),
      this.getAssetCatalog()
    ]);

    if (!snapshot) {
      return {
        currentOriginPaths: new Set(),
        origins: [],
        structuralNodes: []
      };
    }

    const structuralNodes: RelationGraphNodeDraft[] = [];
    const origins: RelationOrigin[] = [];
    const currentOriginPaths = new Set<string>();
    const nodeByPath = new Map<string, string>();
    const managedIdToNodeId = new Map<string, string>();
    const managedPathMappings: ManagedPathMapping[] = [];
    const blockTypeByKey = new Map<string, IntegralBlockTypeDefinition>();

    this.currentAssetCatalog = assetCatalog;
    this.currentBlockTypeByKey = blockTypeByKey;
    this.currentManagedIdToNodeId = managedIdToNodeId;
    this.currentManagedPathMappings = managedPathMappings;
    this.currentNodeByPath = nodeByPath;
    this.currentRootPathForContext = rootPath;

    for (const blockType of assetCatalog.blockTypes) {
      blockTypeByKey.set(blockDefinitionKey(blockType.pluginId, blockType.blockType), blockType);
    }

    await addManagedDataNodes({
      assetCatalog,
      managedIdToNodeId,
      managedPathMappings,
      nodeByPath,
      rootPath,
      structuralNodes
    });

    const rootNodeId = folderNodeId("");
    structuralNodes.push({
      id: rootNodeId,
      kind: "folder",
      label: snapshot.rootName,
      metadata: {
        workspaceRoot: rootPath
      },
      path: ""
    });

    await collectWorkspaceStructure({
      currentOriginPaths,
      entries: snapshot.entries,
      managedPathMappings,
      nodeByPath,
      origins,
      parentRelativePath: "",
      rootName: snapshot.rootName,
      rootPath,
      structuralNodes
    });

    await addDataNoteOrigins({
      assetCatalog,
      currentOriginPaths,
      managedIdToNodeId,
      origins,
      rootPath
    });

    for (const dataset of assetCatalog.datasets) {
      const nodeId = managedIdToNodeId.get(dataset.datasetId);

      if (!nodeId) {
        continue;
      }

      const origin: DatasetOrigin = {
        dataset,
        hash: dataset.hash,
        kind: "dataset",
        nodeId,
        path: datasetOriginPath(dataset.datasetId),
        relativePath: dataset.path
      };
      origins.push(origin);
      currentOriginPaths.add(origin.path);
    }

    return {
      currentOriginPaths,
      origins,
      structuralNodes
    };
  }

  private async getDatabase(rootPath: string): Promise<DatabaseHandle> {
    const filePath = relationIndexFilePath(rootPath);

    if (
      this.databaseHandle &&
      this.databaseHandle.rootPath === rootPath &&
      this.databaseHandle.filePath === filePath
    ) {
      return this.databaseHandle;
    }

    if (this.databaseHandle) {
      this.databaseHandle.database.close();
      this.databaseHandle = null;
    }

    const SQL = await initSqlJs({
      locateFile: () => SQLITE_WASM_PATH
    });
    const databaseBytes = await fs.readFile(filePath).catch(() => null);
    const database = databaseBytes ? new SQL.Database(new Uint8Array(databaseBytes)) : new SQL.Database();
    const handle = {
      database,
      filePath,
      rootPath
    };

    ensureSchema(database);
    this.databaseHandle = handle;
    return handle;
  }

  private readOriginHashes(database: SqlJsDatabase): Map<string, string> {
    const rows = queryRows(database, "SELECT origin_path, origin_hash FROM origins");
    return new Map(
      rows.map((row) => [String(row.origin_path), String(row.origin_hash ?? "")])
    );
  }

  private readNodes(database: SqlJsDatabase): RelationGraphNode[] {
    return queryRows(
      database,
      "SELECT id, kind, label, path, note_target_id, metadata FROM nodes ORDER BY kind, label, id"
    ).map((row) => ({
      id: String(row.id),
      kind: readNodeKind(row.kind),
      label: String(row.label),
      metadata: parseMetadata(row.metadata),
      noteTargetId: readNullableString(row.note_target_id),
      path: readNullableString(row.path)
    }));
  }

  private readEdges(database: SqlJsDatabase): RelationGraphEdge[] {
    return queryRows(
      database,
      [
        "SELECT id, source_id, target_id, type, origin_node_id, origin_path, origin_hash, metadata",
        "FROM edges",
        "ORDER BY type, source_id, target_id, id"
      ].join(" ")
    ).map((row) => ({
      id: String(row.id),
      metadata: parseMetadata(row.metadata),
      originHash: readNullableString(row.origin_hash),
      originNodeId: String(row.origin_node_id),
      originPath: String(row.origin_path),
      sourceId: String(row.source_id),
      targetId: String(row.target_id),
      type: readEdgeType(row.type)
    }));
  }

  private async persistDatabase(handle: DatabaseHandle): Promise<void> {
    await fs.mkdir(path.dirname(handle.filePath), { recursive: true });
    await fs.writeFile(handle.filePath, Buffer.from(handle.database.export()));
  }

  private schedulePendingMutationFlush(): void {
    if (this.pendingMutationFlushTimer) {
      return;
    }

    this.pendingMutationFlushTimer = setTimeout(() => {
      this.pendingMutationFlushTimer = null;
      void this.flushPendingMutationsNow();
    }, RELATION_GRAPH_MUTATION_DEBOUNCE_MS);
  }

  private async prepareForFullSynchronization(): Promise<void> {
    if (this.pendingMutationFlushTimer) {
      clearTimeout(this.pendingMutationFlushTimer);
      this.pendingMutationFlushTimer = null;
    }

    this.pendingMutations = [];

    while (this.pendingMutationFlushPromise) {
      await this.pendingMutationFlushPromise;
    }

    if (this.pendingMutationFlushTimer) {
      clearTimeout(this.pendingMutationFlushTimer);
      this.pendingMutationFlushTimer = null;
    }

    this.pendingMutations = [];
  }

  private flushPendingMutationsNow(): Promise<void> {
    if (this.pendingMutations.length === 0) {
      return this.pendingMutationFlushPromise ?? Promise.resolve();
    }

    const mutations = this.pendingMutations;
    this.pendingMutations = [];

    const flushPromise = this.enqueue(() => this.applyWorkspaceMutations(mutations))
      .catch((error) => {
        console.error("[RelationGraphService] relation graph mutation indexing failed", error);
      })
      .finally(() => {
        if (this.pendingMutationFlushPromise === flushPromise) {
          this.pendingMutationFlushPromise = null;
        }
      });

    this.pendingMutationFlushPromise = flushPromise;
    return flushPromise;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private deletePathSubtree(database: SqlJsDatabase, relativePath: string): void {
    const normalized = normalizeRelativePath(relativePath);

    if (normalized.length === 0) {
      return;
    }

    const candidateOriginPrefixes = [
      fileOriginPath(normalized),
      dataNoteOriginPath(normalized),
      folderOriginPath(normalized)
    ];

    for (const originPath of candidateOriginPrefixes) {
      deleteOriginPrefix(database, originPath);
    }

    const pathPrefix = `${normalized}/`;
    deleteRows(
      database,
      "DELETE FROM nodes WHERE path = ? OR path LIKE ?",
      [normalized, `${pathPrefix}%`]
    );
    deleteRows(
      database,
      "DELETE FROM edges WHERE source_id NOT IN (SELECT id FROM nodes) OR target_id NOT IN (SELECT id FROM nodes)"
    );
  }
}

const RELATION_EXTRACTORS: readonly RelationExtractor[] = [
  {
    id: "folder-contains",
    extract: async (origin) => {
      if (origin.kind !== "folder") {
        return emptyExtraction();
      }

      const folderOrigin = origin as FolderOrigin;
      return {
        nodes: [],
        edges: folderOrigin.childNodeIds
          .filter((childNodeId) => childNodeId !== folderOrigin.nodeId)
          .map((childNodeId) => ({
            sourceId: folderOrigin.nodeId,
            targetId: childNodeId,
            type: "contains" as const
          }))
      };
    }
  },
  {
    id: "markdown-links",
    extract: extractMarkdownLinks
  },
  {
    id: "integral-blocks",
    extract: extractIntegralBlocks
  },
  {
    id: "dataset-members",
    extract: async (origin, context) => {
      if (origin.kind !== "dataset") {
        return emptyExtraction();
      }

      const datasetOrigin = origin as DatasetOrigin;
      const memberIds = datasetOrigin.dataset.memberIds ?? [];

      return {
        nodes: [],
        edges: memberIds
          .map((memberId) => context.managedIdToNodeId.get(memberId.trim()))
          .filter((nodeId): nodeId is string => typeof nodeId === "string")
          .filter((nodeId) => nodeId !== datasetOrigin.nodeId)
          .map((nodeId) => ({
            metadata: {
              datasetId: datasetOrigin.dataset.datasetId
            },
            sourceId: datasetOrigin.nodeId,
            targetId: nodeId,
            type: "dataset-member" as const
          }))
      };
    }
  },
  {
    id: "python-callables",
    extract: async (origin, context) => {
      if (origin.kind !== "file" || !origin.relativePath?.toLowerCase().endsWith(".py")) {
        return emptyExtraction();
      }

      const nodes: RelationGraphNodeDraft[] = [];
      const edges: RelationGraphEdgeDraft[] = [];

      for (const definition of context.assetCatalog.blockTypes) {
        if (definition.source !== "python-callable") {
          continue;
        }

        const callable = parsePythonCallableBlockType(definition.blockType);

        if (!callable || callable.relativePath !== origin.relativePath) {
          continue;
        }

        const callableNode: RelationGraphNodeDraft = {
          id: pythonCallableNodeId(definition.blockType),
          kind: "python-callable",
          label: callable.functionName,
          metadata: {
            blockType: definition.blockType,
            description: definition.description,
            pluginId: definition.pluginId,
            relativePath: callable.relativePath,
            title: definition.title
          },
          path: callable.relativePath
        };

        nodes.push(callableNode);
        edges.push({
          metadata: {
            functionName: callable.functionName
          },
          sourceId: origin.nodeId,
          targetId: callableNode.id,
          type: "defines"
        });
      }

      return {
        edges,
        nodes
      };
    }
  }
];

async function extractMarkdownLinks(
  origin: RelationOrigin,
  context: ScanContext
): Promise<ExtractedRelationSet> {
  if (origin.kind !== "file" || origin.extension !== ".md" || !origin.relativePath) {
    return emptyExtraction();
  }

  const content = await readWorkspaceTextFile(context.rootPath, origin.relativePath);
  const nodes: RelationGraphNodeDraft[] = [];
  const edges: RelationGraphEdgeDraft[] = [];

  for (const link of collectMarkdownLinks(content)) {
    const targetPath = resolveLinkedWorkspacePath(origin.relativePath, link.target);

    if (!targetPath) {
      continue;
    }

    const targetNodeId = resolveNodeIdForPath(context, targetPath);

    if (!targetNodeId || targetNodeId === origin.nodeId) {
      continue;
    }

    edges.push({
      metadata: {
        label: link.label,
        line: link.lineNumber,
        target: link.target
      },
      sourceId: origin.nodeId,
      targetId: targetNodeId,
      type: "markdown-link"
    });
  }

  return {
    edges,
    nodes
  };
}

async function extractIntegralBlocks(
  origin: RelationOrigin,
  context: ScanContext
): Promise<ExtractedRelationSet> {
  if (origin.kind !== "file" || origin.extension !== ".md" || !origin.relativePath) {
    return emptyExtraction();
  }

  const content = await readWorkspaceTextFile(context.rootPath, origin.relativePath);
  const nodes: RelationGraphNodeDraft[] = [];
  const edges: RelationGraphEdgeDraft[] = [];

  for (const block of parseIntegralBlocks(content)) {
    const blockNode: RelationGraphNodeDraft = {
      id: blockNodeId(origin.relativePath, block.id),
      kind: "block",
      label: block.id,
      metadata: {
        blockId: block.id,
        blockType: block.blockType,
        plugin: block.plugin,
        sourceNotePath: origin.relativePath
      },
      path: origin.relativePath
    };
    nodes.push(blockNode);
    edges.push({
      metadata: {
        blockId: block.id
      },
      sourceId: origin.nodeId,
      targetId: blockNode.id,
      type: "contains"
    });

    const definition = context.blockTypeByKey.get(blockDefinitionKey(block.plugin, block.blockType));

    if (definition?.source === "python-callable") {
      const callable = parsePythonCallableBlockType(definition.blockType);
      const callableNodeId = pythonCallableNodeId(definition.blockType);
      nodes.push({
        id: callableNodeId,
        kind: "python-callable",
        label: callable?.functionName ?? definition.title,
        metadata: {
          blockType: definition.blockType,
          pluginId: definition.pluginId,
          relativePath: callable?.relativePath ?? null,
          title: definition.title
        },
        path: callable?.relativePath ?? null
      });
      edges.push({
        metadata: {
          blockType: definition.blockType
        },
        sourceId: blockNode.id,
        targetId: callableNodeId,
        type: "block-call"
      });
    }

    for (const [slotName, reference] of Object.entries(block.inputs)) {
      const targetNodeId = resolveManagedDataReference(context, reference);

      if (!targetNodeId || targetNodeId === blockNode.id) {
        continue;
      }

      edges.push({
        metadata: {
          slotName
        },
        sourceId: blockNode.id,
        targetId: targetNodeId,
        type: "block-input"
      });
    }

    for (const [slotName, reference] of Object.entries(block.outputs)) {
      const targetNodeId = resolveManagedDataReference(context, reference);

      if (!targetNodeId || targetNodeId === blockNode.id) {
        continue;
      }

      edges.push({
        metadata: {
          slotName
        },
        sourceId: blockNode.id,
        targetId: targetNodeId,
        type: "block-output"
      });
    }
  }

  return {
    edges,
    nodes
  };
}

async function addManagedDataNodes(options: {
  assetCatalog: IntegralAssetCatalog;
  managedIdToNodeId: Map<string, string>;
  managedPathMappings: ManagedPathMapping[];
  nodeByPath: Map<string, string>;
  rootPath: string;
  structuralNodes: RelationGraphNodeDraft[];
}): Promise<void> {
  const nonDataNodeIdByPath = new Map<string, string>();

  for (const managedFile of options.assetCatalog.managedFiles) {
    if (!(await workspacePathExists(options.rootPath, managedFile.path))) {
      continue;
    }

    const normalizedManagedPath = normalizeRelativePath(managedFile.path);
    const preferredNodeId = managedNodeId(managedFile);
    const existingPathNodeId = managedFile.canOpenDataNote
      ? undefined
      : nonDataNodeIdByPath.get(normalizedManagedPath);
    const nodeId = existingPathNodeId ?? preferredNodeId;

    options.managedIdToNodeId.set(managedFile.id, nodeId);
    addManagedPathMapping(options.managedPathMappings, managedFile.path, nodeId, managedFile.representation);
    options.nodeByPath.set(normalizedManagedPath, nodeId);

    if (!existingPathNodeId) {
      if (!managedFile.canOpenDataNote) {
        nonDataNodeIdByPath.set(normalizedManagedPath, nodeId);
      }

      options.structuralNodes.push(managedFileNode(managedFile, nodeId));
    }

    if (managedFile.canOpenDataNote && managedFile.noteTargetId) {
      options.nodeByPath.set(createDataNoteRelativePath(managedFile.noteTargetId), nodeId);
    }
  }

  for (const dataset of options.assetCatalog.datasets) {
    if (!(await workspacePathExists(options.rootPath, dataset.path))) {
      continue;
    }

    const nodeId = datasetNodeId(dataset);
    options.managedIdToNodeId.set(dataset.datasetId, nodeId);
    addManagedPathMapping(options.managedPathMappings, dataset.path, nodeId, "file");
    options.nodeByPath.set(normalizeRelativePath(dataset.path), nodeId);
    options.structuralNodes.push(datasetNode(dataset, nodeId));

    if (dataset.noteTargetId) {
      options.nodeByPath.set(createDataNoteRelativePath(dataset.noteTargetId), nodeId);
    }
  }

  options.managedPathMappings.sort(
    (left, right) => right.path.length - left.path.length || left.path.localeCompare(right.path, "ja")
  );
}

async function addDataNoteOrigins(options: {
  assetCatalog: IntegralAssetCatalog;
  currentOriginPaths: Set<string>;
  managedIdToNodeId: Map<string, string>;
  origins: RelationOrigin[];
  rootPath: string;
}): Promise<void> {
  const noteTargetIds = new Set<string>();

  for (const managedFile of options.assetCatalog.managedFiles) {
    if (managedFile.canOpenDataNote && managedFile.noteTargetId) {
      noteTargetIds.add(managedFile.noteTargetId);
    }
  }

  for (const dataset of options.assetCatalog.datasets) {
    if (dataset.canOpenDataNote && dataset.noteTargetId) {
      noteTargetIds.add(dataset.noteTargetId);
    }
  }

  for (const noteTargetId of noteTargetIds) {
    const relativePath = createDataNoteRelativePath(noteTargetId);
    const absolutePath = path.join(options.rootPath, ...relativePath.split("/"));
    const hash = await fileContentHash(absolutePath).catch(() => null);

    if (!hash) {
      continue;
    }

    const nodeId = dataNoteNodeId(noteTargetId);
    const origin: FileOrigin = {
      extension: ".md",
      hash,
      kind: "file",
      nodeId,
      path: dataNoteOriginPath(relativePath),
      relativePath
    };
    options.origins.push(origin);
    options.currentOriginPaths.add(origin.path);
  }
}

async function collectWorkspaceStructure(options: {
  currentOriginPaths: Set<string>;
  entries: WorkspaceEntry[];
  managedPathMappings: ManagedPathMapping[];
  nodeByPath: Map<string, string>;
  origins: RelationOrigin[];
  parentRelativePath: string;
  rootName: string;
  rootPath: string;
  structuralNodes: RelationGraphNodeDraft[];
}): Promise<string[]> {
  const childNodeIds: string[] = [];

  for (const entry of options.entries) {
    const relativePath = normalizeRelativePath(entry.relativePath);

    if (shouldSkipWorkspacePath(relativePath)) {
      continue;
    }

    const managedNodeIdForPath = options.nodeByPath.get(relativePath);

    if (!managedNodeIdForPath && isManagedDirectoryDescendant(relativePath, options.managedPathMappings)) {
      continue;
    }

    const nodeId =
      managedNodeIdForPath ??
      (entry.kind === "directory" ? folderNodeId(relativePath) : fileNodeId(relativePath));
    childNodeIds.push(nodeId);

    if (managedNodeIdForPath && entry.kind === "directory") {
      continue;
    }

    if (entry.kind === "directory") {
      options.structuralNodes.push({
        id: nodeId,
        kind: "folder",
        label: entry.name,
        metadata: {},
        path: relativePath
      });
      const childIds = await collectWorkspaceStructure({
        ...options,
        entries: entry.children ?? [],
        parentRelativePath: relativePath
      });
      const origin: FolderOrigin = {
        childNodeIds: childIds,
        hash: hashString(childIds.join("\n")),
        kind: "folder",
        nodeId,
        path: folderOriginPath(relativePath),
        relativePath
      };
      options.origins.push(origin);
      options.currentOriginPaths.add(origin.path);
      continue;
    }

    const extension = path.posix.extname(relativePath).toLowerCase();

    if (!managedNodeIdForPath) {
      options.structuralNodes.push({
        id: nodeId,
        kind: extension === ".md" ? "note" : "file",
        label: entry.name,
        metadata: {},
        path: relativePath
      });
    }

    if (INDEXED_TEXT_EXTENSIONS.has(extension)) {
      const absolutePath = path.join(options.rootPath, ...relativePath.split("/"));
      const origin: FileOrigin = {
        extension,
        hash: await fileContentHash(absolutePath),
        kind: "file",
        nodeId,
        path: fileOriginPath(relativePath),
        relativePath
      };
      options.origins.push(origin);
      options.currentOriginPaths.add(origin.path);
    }
  }

  if (options.parentRelativePath.length === 0) {
    const origin: FolderOrigin = {
      childNodeIds,
      hash: hashString(childNodeIds.join("\n")),
      kind: "folder",
      nodeId: folderNodeId(""),
      path: folderOriginPath(""),
      relativePath: ""
    };
    options.origins.push(origin);
    options.currentOriginPaths.add(origin.path);
  }

  return childNodeIds;
}

function isManagedDirectoryDescendant(
  relativePath: string,
  mappings: readonly ManagedPathMapping[]
): boolean {
  return mappings.some(
    (mapping) => mapping.isDirectory && relativePath.startsWith(`${mapping.path}/`)
  );
}

function managedFileNode(
  managedFile: IntegralManagedFileSummary,
  nodeId: string
): RelationGraphNodeDraft {
  const noteTargetId = managedFile.canOpenDataNote ? (managedFile.noteTargetId ?? managedFile.id) : null;

  return {
    id: nodeId,
    kind: noteTargetId ? "data-note" : managedFile.representation === "directory" ? "folder" : "file",
    label: managedFile.displayName,
    metadata: {
      canOpenDataNote: managedFile.canOpenDataNote,
      createdByBlockId: managedFile.createdByBlockId,
      datatype: managedFile.datatype,
      dataNotePath: noteTargetId ? createDataNoteRelativePath(noteTargetId) : null,
      entityType: managedFile.entityType,
      hash: managedFile.hash,
      managedDataId: managedFile.id,
      representation: managedFile.representation,
      visibility: managedFile.visibility
    },
    noteTargetId,
    path: managedFile.path
  };
}

function datasetNode(dataset: IntegralDatasetSummary, nodeId: string): RelationGraphNodeDraft {
  return {
    id: nodeId,
    kind: "data-note",
    label: dataset.name,
    metadata: {
      canOpenDataNote: dataset.canOpenDataNote,
      createdByBlockId: dataset.createdByBlockId,
      datasetId: dataset.datasetId,
      datatype: dataset.datatype,
      dataNotePath: createDataNoteRelativePath(dataset.noteTargetId ?? dataset.datasetId),
      entityType: "dataset",
      hash: dataset.hash,
      memberIds: dataset.memberIds ?? [],
      representation: dataset.representation,
      visibility: dataset.visibility
    },
    noteTargetId: dataset.noteTargetId ?? dataset.datasetId,
    path: dataset.path
  };
}

function managedNodeId(managedFile: IntegralManagedFileSummary): string {
  return managedFile.canOpenDataNote
    ? dataNoteNodeId(managedFile.noteTargetId ?? managedFile.id)
    : `managed:${managedFile.id}`;
}

function datasetNodeId(dataset: IntegralDatasetSummary): string {
  return dataNoteNodeId(dataset.noteTargetId ?? dataset.datasetId);
}

function addManagedPathMapping(
  mappings: ManagedPathMapping[],
  relativePath: string,
  id: string,
  representation: "directory" | "file" | "dataset-json"
): void {
  const normalized = normalizeRelativePath(relativePath);

  if (normalized.length === 0) {
    return;
  }

  mappings.push({
    id,
    isDirectory: representation === "directory",
    path: normalized
  });
}

function resolveNodeIdForPath(context: ScanContext, relativePath: string): string | null {
  const normalized = normalizeRelativePath(relativePath);
  const direct = context.nodeByPath.get(normalized);

  if (direct) {
    return direct;
  }

  for (const mapping of context.managedPathMappings) {
    if (mapping.isDirectory && normalized.startsWith(`${mapping.path}/`)) {
      return mapping.id;
    }
  }

  return null;
}

function resolveManagedDataReference(context: ScanContext, reference: string | null): string | null {
  if (!reference) {
    return null;
  }

  const trimmed = reference.trim();

  if (trimmed.length === 0) {
    return null;
  }

  return context.managedIdToNodeId.get(trimmed) ?? resolveNodeIdForPath(
    context,
    resolveWorkspaceMarkdownTarget(trimmed) ?? trimmed
  );
}

function collectMarkdownLinks(content: string): Array<{
  label: string;
  lineNumber: number;
  target: string;
}> {
  const links: Array<{
    label: string;
    lineNumber: number;
    target: string;
  }> = [];
  const fencedRanges = collectFencedCodeRanges(content);
  const pattern = /!?\[([^\]\n]*)\]\(([^)\n]+)\)/gu;

  for (const match of content.matchAll(pattern)) {
    const index = match.index ?? 0;

    if (isIndexInRanges(index, fencedRanges)) {
      continue;
    }

    const target = (match[2] ?? "").trim();

    if (target.length === 0) {
      continue;
    }

    links.push({
      label: (match[1] ?? "").trim(),
      lineNumber: countLineNumber(content, index),
      target
    });
  }

  return links;
}

function resolveLinkedWorkspacePath(sourceRelativePath: string, target: string): string | null {
  const workspaceTarget = resolveWorkspaceMarkdownTarget(target);

  if (workspaceTarget) {
    return workspaceTarget;
  }

  const trimmed = target.trim();

  if (
    trimmed.length === 0 ||
    trimmed.startsWith("#") ||
    /^[a-zA-Z][a-zA-Z\d+.-]*:/u.test(trimmed)
  ) {
    return null;
  }

  const withoutFragment = trimmed.split("#")[0]?.split("?")[0] ?? "";

  if (withoutFragment.length === 0) {
    return null;
  }

  const sourceDirectory = path.posix.dirname(normalizeRelativePath(sourceRelativePath));
  const resolved = path.posix.normalize(path.posix.join(sourceDirectory === "." ? "" : sourceDirectory, withoutFragment));

  if (resolved.startsWith("../") || resolved === "..") {
    return null;
  }

  return normalizeRelativePath(resolved);
}

function parseIntegralBlocks(markdown: string): ParsedIntegralBlock[] {
  const blocks: ParsedIntegralBlock[] = [];
  const pattern = new RegExp(`\`\`\`${INTEGRAL_BLOCK_LANGUAGE}\\r?\\n([\\s\\S]*?)\\r?\\n\`\`\``, "gu");

  for (const match of markdown.matchAll(pattern)) {
    const source = match[1] ?? "";
    const block = parseIntegralBlockYaml(source);

    if (block) {
      blocks.push(block);
    }
  }

  return blocks;
}

function parseIntegralBlockYaml(source: string): ParsedIntegralBlock | null {
  const lines = source.replace(/\r\n?/gu, "\n").split("\n");
  const topLevel = readTopLevelYamlScalars(lines);
  const run = topLevel.get("run");
  const use = topLevel.get("use");
  let plugin = topLevel.get("plugin") ?? "";
  let blockType = topLevel.get("block-type") ?? "";

  if (run) {
    plugin = GENERAL_ANALYSIS_PLUGIN_ID;
    blockType = run;
  } else if (use) {
    const separatorIndex = use.indexOf("/");

    if (separatorIndex > 0 && separatorIndex < use.length - 1) {
      plugin = use.slice(0, separatorIndex).trim();
      blockType = use.slice(separatorIndex + 1).trim();
    }
  }

  if (!plugin || !blockType) {
    return null;
  }

  return {
    blockType,
    id: topLevel.get("id") ?? createSyntheticBlockId(source),
    inputs: readYamlScalarMap(lines, ["in", "inputs"]),
    outputs: readYamlScalarMap(lines, ["out", "outputs"]),
    plugin
  };
}

function readTopLevelYamlScalars(lines: readonly string[]): Map<string, string> {
  const result = new Map<string, string>();

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.trim().length === 0 || line.trimStart().startsWith("#")) {
      continue;
    }

    const indent = line.length - line.trimStart().length;

    if (indent !== 0) {
      continue;
    }

    const separatorIndex = line.indexOf(":");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (value.length > 0) {
      result.set(key, unquoteYamlScalar(value));
    }
  }

  return result;
}

function readYamlScalarMap(lines: readonly string[], keys: readonly string[]): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  let activeIndent: number | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const indent = line.length - line.trimStart().length;

    if (activeIndent === null) {
      if (keys.some((key) => trimmed === `${key}:`)) {
        activeIndent = indent;
      }
      continue;
    }

    if (indent <= activeIndent) {
      activeIndent = null;
      continue;
    }

    const separatorIndex = trimmed.indexOf(":");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();

    if (rawValue.length === 0 || rawValue === "null") {
      result[key] = null;
      continue;
    }

    if (rawValue.startsWith("{") || rawValue.startsWith("[") || rawValue.includes(": ")) {
      continue;
    }

    result[key] = unquoteYamlScalar(rawValue);
  }

  return result;
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function parsePythonCallableBlockType(blockType: string): {
  functionName: string;
  relativePath: string;
} | null {
  const separatorIndex = blockType.lastIndexOf(":");

  if (separatorIndex <= 0 || separatorIndex >= blockType.length - 1) {
    return null;
  }

  return {
    functionName: blockType.slice(separatorIndex + 1).trim(),
    relativePath: normalizeRelativePath(blockType.slice(0, separatorIndex))
  };
}

function ensureSchema(database: SqlJsDatabase): void {
  database.run(
    [
      "CREATE TABLE IF NOT EXISTS metadata (",
      "key TEXT PRIMARY KEY,",
      "value TEXT NOT NULL",
      ")",
      ";",
      "CREATE TABLE IF NOT EXISTS nodes (",
      "id TEXT PRIMARY KEY,",
      "kind TEXT NOT NULL,",
      "label TEXT NOT NULL,",
      "path TEXT,",
      "note_target_id TEXT,",
      "metadata TEXT NOT NULL,",
      "updated_at TEXT NOT NULL",
      ")",
      ";",
      "CREATE TABLE IF NOT EXISTS origins (",
      "origin_path TEXT PRIMARY KEY,",
      "origin_node_id TEXT NOT NULL,",
      "origin_hash TEXT NOT NULL,",
      "updated_at TEXT NOT NULL",
      ")",
      ";",
      "CREATE TABLE IF NOT EXISTS edges (",
      "id TEXT PRIMARY KEY,",
      "source_id TEXT NOT NULL,",
      "target_id TEXT NOT NULL,",
      "type TEXT NOT NULL,",
      "origin_node_id TEXT NOT NULL,",
      "origin_path TEXT NOT NULL,",
      "origin_hash TEXT,",
      "metadata TEXT NOT NULL,",
      "updated_at TEXT NOT NULL",
      ")",
      ";",
      "CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id)",
      ";",
      "CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id)",
      ";",
      "CREATE INDEX IF NOT EXISTS idx_edges_origin ON edges(origin_path)",
      ";",
      "CREATE INDEX IF NOT EXISTS idx_nodes_path ON nodes(path)"
    ].join(" ")
  );

  const schemaVersion = readMetadata(database, "schemaVersion");

  if (schemaVersion !== String(RELATION_GRAPH_SCHEMA_VERSION)) {
    clearRelationGraphTables(database);
    writeMetadata(database, "schemaVersion", String(RELATION_GRAPH_SCHEMA_VERSION));
  }
}

function clearRelationGraphTables(database: SqlJsDatabase): void {
  database.run("DELETE FROM edges");
  database.run("DELETE FROM nodes");
  database.run("DELETE FROM origins");
}

function upsertNode(database: SqlJsDatabase, node: RelationGraphNodeDraft): void {
  database.run(
    [
      "INSERT INTO nodes(id, kind, label, path, note_target_id, metadata, updated_at)",
      "VALUES (?, ?, ?, ?, ?, ?, ?)",
      "ON CONFLICT(id) DO UPDATE SET",
      "kind = excluded.kind,",
      "label = excluded.label,",
      "path = COALESCE(excluded.path, nodes.path),",
      "note_target_id = COALESCE(excluded.note_target_id, nodes.note_target_id),",
      "metadata = excluded.metadata,",
      "updated_at = excluded.updated_at"
    ].join(" "),
    [
      node.id,
      node.kind,
      node.label,
      node.path ?? null,
      node.noteTargetId ?? null,
      serializeMetadata(node.metadata ?? {}),
      new Date().toISOString()
    ]
  );
}

function upsertOrigin(database: SqlJsDatabase, origin: RelationOrigin): void {
  database.run(
    [
      "INSERT INTO origins(origin_path, origin_node_id, origin_hash, updated_at)",
      "VALUES (?, ?, ?, ?)",
      "ON CONFLICT(origin_path) DO UPDATE SET",
      "origin_node_id = excluded.origin_node_id,",
      "origin_hash = excluded.origin_hash,",
      "updated_at = excluded.updated_at"
    ].join(" "),
    [origin.path, origin.nodeId, origin.hash, new Date().toISOString()]
  );
}

function upsertEdge(
  database: SqlJsDatabase,
  origin: RelationOrigin,
  edge: RelationGraphEdgeDraft
): void {
  if (edge.sourceId === edge.targetId) {
    return;
  }

  const id = edgeId(origin.path, edge);
  database.run(
    [
      "INSERT INTO edges(",
      "id, source_id, target_id, type, origin_node_id, origin_path, origin_hash, metadata, updated_at",
      ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "ON CONFLICT(id) DO UPDATE SET",
      "source_id = excluded.source_id,",
      "target_id = excluded.target_id,",
      "type = excluded.type,",
      "origin_node_id = excluded.origin_node_id,",
      "origin_path = excluded.origin_path,",
      "origin_hash = excluded.origin_hash,",
      "metadata = excluded.metadata,",
      "updated_at = excluded.updated_at"
    ].join(" "),
    [
      id,
      edge.sourceId,
      edge.targetId,
      edge.type,
      origin.nodeId,
      origin.path,
      origin.hash,
      serializeMetadata(edge.metadata ?? {}),
      new Date().toISOString()
    ]
  );
}

function deleteOrigin(database: SqlJsDatabase, originPath: string): void {
  database.run("DELETE FROM edges WHERE origin_path = ?", [originPath]);
  database.run("DELETE FROM origins WHERE origin_path = ?", [originPath]);
}

function deleteOriginPrefix(database: SqlJsDatabase, originPathPrefix: string): void {
  database.run("DELETE FROM edges WHERE origin_path = ? OR origin_path LIKE ?", [
    originPathPrefix,
    `${originPathPrefix}/%`
  ]);
  database.run("DELETE FROM origins WHERE origin_path = ? OR origin_path LIKE ?", [
    originPathPrefix,
    `${originPathPrefix}/%`
  ]);
}

function deleteOrphanDerivedNodes(database: SqlJsDatabase): void {
  database.run(
    [
      "DELETE FROM nodes",
      "WHERE kind IN ('block', 'python-callable')",
      "AND id NOT IN (SELECT source_id FROM edges)",
      "AND id NOT IN (SELECT target_id FROM edges)"
    ].join(" ")
  );
}

function readMetadata(database: SqlJsDatabase, key: string): string | null {
  const rows = queryRows(database, "SELECT value FROM metadata WHERE key = ?", [key]);
  return rows.length > 0 ? readNullableString(rows[0]?.value) : null;
}

function writeMetadata(database: SqlJsDatabase, key: string, value: string): void {
  database.run(
    "INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value]
  );
}

function queryRows(
  database: SqlJsDatabase,
  sql: string,
  params?: SqlBindParams
): Array<Record<string, SqlBindValue | undefined>> {
  const statement = database.prepare(sql);

  try {
    if (params) {
      statement.bind(params);
    }

    const rows: Array<Record<string, SqlBindValue | undefined>> = [];

    while (statement.step()) {
      rows.push(statement.getAsObject());
    }

    return rows;
  } finally {
    statement.free();
  }
}

function readSingleNumber(database: SqlJsDatabase, sql: string): number {
  const rows = database.exec(sql);
  const value = rows[0]?.values[0]?.[0];
  return typeof value === "number" ? value : Number(value ?? 0);
}

function deleteRows(database: SqlJsDatabase, sql: string, params?: SqlBindParams): void {
  database.run(sql, params);
}

function emptyExtraction(): ExtractedRelationSet {
  return {
    edges: [],
    nodes: []
  };
}

function collectAffectedOriginPaths(mutations: readonly WorkspaceMutation[]): Set<string> {
  const affected = new Set<string>();

  for (const mutation of mutations) {
    const normalizedPath = normalizeRelativePath(mutation.path);

    if (normalizedPath.length > 0) {
      affected.add(fileOriginPath(normalizedPath));
      affected.add(folderOriginPath(normalizedPath));
      affected.add(folderOriginPath(path.posix.dirname(normalizedPath) === "." ? "" : path.posix.dirname(normalizedPath)));
    }

    if (mutation.nextPath) {
      const nextPath = normalizeRelativePath(mutation.nextPath);
      affected.add(fileOriginPath(nextPath));
      affected.add(folderOriginPath(nextPath));
      affected.add(folderOriginPath(path.posix.dirname(nextPath) === "." ? "" : path.posix.dirname(nextPath)));
    }
  }

  return affected;
}

function isPathInAffectedSet(relativePath: string, affectedOrigins: ReadonlySet<string>): boolean {
  const normalized = normalizeRelativePath(relativePath);
  return affectedOrigins.has(fileOriginPath(normalized)) || affectedOrigins.has(folderOriginPath(normalized));
}

async function readWorkspaceTextFile(rootPath: string, relativePath: string): Promise<string> {
  return fs.readFile(path.join(rootPath, ...normalizeRelativePath(relativePath).split("/")), "utf8");
}

async function fileContentHash(absolutePath: string): Promise<string> {
  const content = await fs.readFile(absolutePath);
  return hashBuffer(content);
}

async function workspacePathExists(rootPath: string, relativePath: string): Promise<boolean> {
  try {
    await fs.stat(path.join(rootPath, ...normalizeRelativePath(relativePath).split("/")));
    return true;
  } catch {
    return false;
  }
}

function shouldSkipWorkspacePath(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath);
  const segments = normalized.split("/").filter(Boolean);

  if (segments.length === 0) {
    return false;
  }

  if (segments[0] === STORE_DIRECTORY) {
    return true;
  }

  return segments.some((segment) => WORKSPACE_SCAN_EXCLUDED_SEGMENTS.has(segment));
}

function relationIndexFilePath(rootPath: string): string {
  return path.join(rootPath, STORE_DIRECTORY, STORE_METADATA_DIRECTORY, RELATION_INDEX_FILE_NAME);
}

function createDataNoteRelativePath(noteTargetId: string): string {
  return `${STORE_DIRECTORY}/${STORE_METADATA_DIRECTORY}/${DATA_NOTE_DIRECTORY}/${noteTargetId}.md`;
}

function folderNodeId(relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  return `folder:${normalized.length > 0 ? normalized : "/"}`;
}

function fileNodeId(relativePath: string): string {
  return `file:${normalizeRelativePath(relativePath)}`;
}

function dataNoteNodeId(noteTargetId: string): string {
  return `data-note:${noteTargetId.trim()}`;
}

function blockNodeId(notePath: string, blockId: string): string {
  return `block:${normalizeRelativePath(notePath)}#${blockId}`;
}

function pythonCallableNodeId(blockType: string): string {
  return `python:${blockType.trim()}`;
}

function fileOriginPath(relativePath: string): string {
  return `file:${normalizeRelativePath(relativePath)}`;
}

function dataNoteOriginPath(relativePath: string): string {
  return `data-note:${normalizeRelativePath(relativePath)}`;
}

function folderOriginPath(relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  return `folder:${normalized.length > 0 ? normalized : "/"}`;
}

function datasetOriginPath(datasetId: string): string {
  return `dataset:${datasetId.trim()}`;
}

function edgeId(originPath: string, edge: RelationGraphEdgeDraft): string {
  return `edge:${hashString(
    JSON.stringify({
      metadata: edge.metadata ?? {},
      originPath,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      type: edge.type
    })
  )}`;
}

function blockDefinitionKey(pluginId: string, blockType: string): string {
  return `${pluginId.trim()}/${blockType.trim()}`;
}

function collectFencedCodeRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];

  for (const match of content.matchAll(/```[\s\S]*?```/gu)) {
    const start = match.index ?? 0;
    ranges.push([start, start + match[0].length]);
  }

  return ranges;
}

function isIndexInRanges(index: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function countLineNumber(content: string, index: number): number {
  let line = 1;

  for (let cursor = 0; cursor < index; cursor += 1) {
    if (content[cursor] === "\n") {
      line += 1;
    }
  }

  return line;
}

function createSyntheticBlockId(source: string): string {
  return `BLK-${hashString(source).slice(0, 8).toUpperCase()}`;
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

function collectNodeHopDistances(
  originNodeId: string,
  edges: readonly RelationGraphEdge[],
  maxHops: number
): Map<string, number> {
  const adjacency = new Map<string, Set<string>>();

  for (const edge of edges) {
    addAdjacentNode(adjacency, edge.sourceId, edge.targetId);
    addAdjacentNode(adjacency, edge.targetId, edge.sourceId);
  }

  const distances = new Map<string, number>([[originNodeId, 0]]);
  let frontier = new Set([originNodeId]);

  for (let hop = 1; hop <= maxHops; hop += 1) {
    const next = new Set<string>();

    for (const nodeId of frontier) {
      for (const adjacentNodeId of adjacency.get(nodeId) ?? []) {
        if (!distances.has(adjacentNodeId)) {
          next.add(adjacentNodeId);
        }
      }
    }

    if (next.size === 0) {
      break;
    }

    for (const nodeId of next) {
      distances.set(nodeId, hop);
    }

    frontier = next;
  }

  return distances;
}

function collectPathDistances(
  nodes: readonly RelationGraphNode[],
  nodeDistances: ReadonlyMap<string, number>,
  originPath: string
): RelationGraphPathDistances["distances"] {
  const pathDistances = new Map<string, { hop: number; nodeIds: string[]; path: string }>();
  const normalizedOriginPath = normalizeRelativePath(originPath);

  for (const node of nodes) {
    const hop = nodeDistances.get(node.id);

    if (hop === undefined) {
      continue;
    }

    for (const nodePath of collectNodePathAliases(node)) {
      if (nodePath === normalizedOriginPath) {
        continue;
      }

      const current = pathDistances.get(nodePath);

      if (!current) {
        pathDistances.set(nodePath, {
          hop,
          nodeIds: [node.id],
          path: nodePath
        });
        continue;
      }

      if (hop < current.hop) {
        current.hop = hop;
        current.nodeIds = [node.id];
        continue;
      }

      if (hop === current.hop && !current.nodeIds.includes(node.id)) {
        current.nodeIds.push(node.id);
      }
    }
  }

  return [...pathDistances.values()]
    .map((distance) => ({
      ...distance,
      nodeIds: [...distance.nodeIds].sort((left, right) => left.localeCompare(right, "ja"))
    }))
    .sort((left, right) => left.hop - right.hop || left.path.localeCompare(right.path, "ja"));
}

function collectNodePathAliases(node: RelationGraphNode): string[] {
  const aliases = new Set<string>();

  for (const value of [node.path, metadataString(node.metadata, "dataNotePath")]) {
    const normalized = normalizeRelativePath(value ?? "");

    if (normalized.length > 0) {
      aliases.add(normalized);
    }
  }

  return [...aliases];
}

function findNodeIdByPath(
  nodes: readonly RelationGraphNode[],
  relativePath: string
): string | null {
  const normalizedPath = normalizeRelativePath(relativePath);

  if (normalizedPath.length === 0) {
    return null;
  }

  const exactPathNode = nodes
    .filter((node) => node.path === normalizedPath)
    .sort(
      (left, right) =>
        PATH_KIND_PRIORITY[left.kind] - PATH_KIND_PRIORITY[right.kind] ||
        left.label.localeCompare(right.label, "ja") ||
        left.id.localeCompare(right.id)
    )[0];

  return (
    exactPathNode?.id ??
    nodes.find((node) => metadataString(node.metadata, "dataNotePath") === normalizedPath)?.id ??
    null
  );
}

function addAdjacentNode(adjacency: Map<string, Set<string>>, fromNodeId: string, toNodeId: string): void {
  const adjacent = adjacency.get(fromNodeId) ?? new Set<string>();
  adjacent.add(toNodeId);
  adjacency.set(fromNodeId, adjacent);
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath
    .trim()
    .replace(/\\/gu, "/")
    .split("/")
    .filter((part) => part.length > 0 && part !== ".")
    .join("/");
}

function hashString(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function hashBuffer(value: Buffer): string {
  return createHash("sha1").update(value).digest("hex");
}

function serializeMetadata(metadata: Record<string, RelationJsonValue>): string {
  return JSON.stringify(metadata);
}

function parseMetadata(value: unknown): Record<string, RelationJsonValue> {
  if (typeof value !== "string" || value.trim().length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isJsonRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function metadataString(
  metadata: Readonly<Record<string, RelationJsonValue>>,
  key: string
): string | null {
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}

function isJsonRecord(value: unknown): value is Record<string, RelationJsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNodeKind(value: unknown): RelationNodeKind {
  const kind = String(value);

  if (
    kind === "block" ||
    kind === "data-note" ||
    kind === "file" ||
    kind === "folder" ||
    kind === "note" ||
    kind === "python-callable"
  ) {
    return kind;
  }

  return "file";
}

function readEdgeType(value: unknown): RelationEdgeType {
  const type = String(value);

  if (
    type === "block-call" ||
    type === "block-input" ||
    type === "block-output" ||
    type === "contains" ||
    type === "dataset-member" ||
    type === "defines" ||
    type === "markdown-link"
  ) {
    return type;
  }

  return "markdown-link";
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.round(value)));
}
