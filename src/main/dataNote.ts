import {
  type FrontmatterBlock,
  normalizeMarkdownBody as normalizeBody,
  normalizeMarkdownNewlines as normalizeNewlines,
  serializeFrontmatterDocument,
  splitFrontmatterBlock
} from "./frontmatter";

type DataNoteTargetType = "dataset" | "original-data";
type ManagedDataVisibility = "hidden" | "visible";
type ManagedDataProvenance = "derived" | "source";
type OriginalDataRepresentation = "directory" | "file";
type DatasetRepresentation = "dataset-json" | "directory";

interface ManagedDataNoteMetadataBase {
  createdAt: string;
  displayName: string;
  hash: string;
  id: string;
  path: string;
  provenance: ManagedDataProvenance;
  visibility: ManagedDataVisibility;
}

export interface OriginalDataNoteMetadata extends ManagedDataNoteMetadataBase {
  entityType: "original-data";
  originalDataId: string;
  representation: OriginalDataRepresentation;
}

export interface DatasetDataNoteMetadata extends ManagedDataNoteMetadataBase {
  createdByBlockId: string | null;
  datasetId: string;
  entityType: "dataset";
  kind: string;
  memberIds?: string[];
  representation: DatasetRepresentation;
}

export interface DataNoteTargetInfo {
  dataTargetType: DataNoteTargetType;
  targetId: string;
}

const DATA_NOTE_TYPE = "data-note";
const DATA_NOTE_TYPE_PATTERN = /^\s*integralNoteType:\s*(?:"data-note"|'data-note'|data-note)\s*$/mu;
const COMMON_MANAGED_FRONTMATTER_KEYS = [
  "integralNoteType",
  "dataTargetType",
  "managedDataId",
  "entityType",
  "displayName",
  "representation",
  "path",
  "hash",
  "visibility",
  "provenance",
  "createdAt"
] as const;
const ORIGINAL_DATA_MANAGED_FRONTMATTER_KEYS = [
  ...COMMON_MANAGED_FRONTMATTER_KEYS,
  "originalDataId"
] as const;
const DATASET_MANAGED_FRONTMATTER_KEYS = [
  ...COMMON_MANAGED_FRONTMATTER_KEYS,
  "datasetId",
  "kind",
  "createdByBlockId",
  "memberIds"
] as const;

export function normalizeOriginalDataNoteMetadata(value: unknown): OriginalDataNoteMetadata | null {
  if (!isJsonRecord(value)) {
    return null;
  }

  if (
    value.entityType === "original-data" &&
    typeof value.id === "string" &&
    typeof value.displayName === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.path === "string" &&
    typeof value.hash === "string" &&
    (value.representation === "file" || value.representation === "directory") &&
    (value.visibility === "visible" || value.visibility === "hidden") &&
    (value.provenance === "source" || value.provenance === "derived")
  ) {
    return {
      createdAt: value.createdAt,
      displayName: value.displayName,
      entityType: "original-data",
      hash: value.hash,
      id: value.id.trim(),
      originalDataId: value.id.trim(),
      path: normalizeWorkspaceRelativePath(value.path),
      provenance: value.provenance,
      representation: value.representation,
      visibility: value.visibility
    };
  }

  if (
    typeof value.originalDataId === "string" &&
    typeof value.originalName === "string" &&
    typeof value.createdAt === "string" &&
    (value.sourceKind === "file" || value.sourceKind === "directory")
  ) {
    const preferredPath =
      typeof value.aliasRelativePath === "string"
        ? value.aliasRelativePath
        : typeof value.storeRelativePath === "string"
          ? value.storeRelativePath
          : null;

    if (!preferredPath) {
      return null;
    }

    const originalDataId = value.originalDataId.trim();
    const normalizedPath = normalizeWorkspaceRelativePath(preferredPath);

    return {
      createdAt: value.createdAt,
      displayName: value.originalName,
      entityType: "original-data",
      hash: typeof value.hash === "string" ? value.hash : "",
      id: originalDataId,
      originalDataId,
      path: normalizedPath,
      provenance: "source",
      representation: value.sourceKind,
      visibility: inferVisibilityFromPath(normalizedPath)
    };
  }

  return null;
}

export function normalizeDatasetDataNoteMetadata(value: unknown): DatasetDataNoteMetadata | null {
  if (!isJsonRecord(value)) {
    return null;
  }

  if (
    value.entityType === "dataset" &&
    typeof value.id === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.path === "string" &&
    typeof value.hash === "string" &&
    typeof value.kind === "string" &&
    (value.displayName === undefined || typeof value.displayName === "string") &&
    (value.representation === "directory" || value.representation === "dataset-json") &&
    (value.visibility === "visible" || value.visibility === "hidden") &&
    (value.provenance === "source" || value.provenance === "derived") &&
    (value.createdByBlockId === null ||
      value.createdByBlockId === undefined ||
      typeof value.createdByBlockId === "string") &&
    (value.memberIds === undefined ||
      (Array.isArray(value.memberIds) && value.memberIds.every((item) => typeof item === "string")))
  ) {
    const datasetId = value.id.trim();
    return {
      createdAt: value.createdAt,
      createdByBlockId: value.createdByBlockId ?? null,
      datasetId,
      displayName: normalizeDatasetName(value.displayName, datasetId),
      entityType: "dataset",
      hash: value.hash,
      id: datasetId,
      kind: value.kind,
      memberIds: value.memberIds,
      path: normalizeWorkspaceRelativePath(value.path),
      provenance: value.provenance,
      representation: value.representation,
      visibility: value.visibility
    };
  }

  if (
    typeof value.datasetId === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.kind === "string" &&
    typeof value.storeRelativePath === "string" &&
    (value.createdByBlockId === null ||
      value.createdByBlockId === undefined ||
      typeof value.createdByBlockId === "string")
  ) {
    const datasetId = value.datasetId.trim();
    const normalizedPath = normalizeWorkspaceRelativePath(value.storeRelativePath);
    const sourceMembers = Array.isArray(value.sourceMembers)
      ? value.sourceMembers
          .filter(
            (member) =>
              isJsonRecord(member) && typeof member.originalDataId === "string"
          )
          .map((member) => member.originalDataId)
      : undefined;

    return {
      createdAt: value.createdAt,
      createdByBlockId: value.createdByBlockId ?? null,
      datasetId,
      displayName: normalizeDatasetName(value.name, datasetId),
      entityType: "dataset",
      hash: typeof value.hash === "string" ? value.hash : "",
      id: datasetId,
      kind: value.kind,
      memberIds: sourceMembers,
      path: normalizedPath,
      provenance: value.createdByBlockId ? "derived" : "source",
      representation: "directory",
      visibility: inferVisibilityFromPath(normalizedPath)
    };
  }

  return null;
}

export function isOriginalDataNoteMetadata(value: unknown): value is OriginalDataNoteMetadata {
  return normalizeOriginalDataNoteMetadata(value) !== null;
}

export function isDatasetDataNoteMetadata(value: unknown): value is DatasetDataNoteMetadata {
  return normalizeDatasetDataNoteMetadata(value) !== null;
}

export function buildOriginalDataNoteMarkdown(
  metadata: OriginalDataNoteMetadata,
  existingContent?: string
): string {
  return buildManagedDataNoteMarkdown({
    defaultBody: buildTitleOnlyNoteBody(metadata.displayName),
    existingContent,
    frontmatterLines: [
      `integralNoteType: ${serializeYamlValue(DATA_NOTE_TYPE)}`,
      `dataTargetType: ${serializeYamlValue("original-data")}`,
      `managedDataId: ${serializeYamlValue(metadata.id)}`,
      `originalDataId: ${serializeYamlValue(metadata.originalDataId)}`,
      `entityType: ${serializeYamlValue(metadata.entityType)}`,
      `displayName: ${serializeYamlValue(metadata.displayName)}`,
      `representation: ${serializeYamlValue(metadata.representation)}`,
      `path: ${serializeYamlValue(metadata.path)}`,
      `hash: ${serializeYamlValue(metadata.hash)}`,
      `visibility: ${serializeYamlValue(metadata.visibility)}`,
      `provenance: ${serializeYamlValue(metadata.provenance)}`,
      `createdAt: ${serializeYamlValue(metadata.createdAt)}`
    ],
    generatedBodyCandidates: [
      buildLegacyOriginalDataNoteBody(metadata),
      buildTitleOnlyNoteBody(metadata.displayName)
    ],
    isGeneratedBody: (body) => isGeneratedDataNoteBody(body, metadata.displayName),
    managedKeys: ORIGINAL_DATA_MANAGED_FRONTMATTER_KEYS
  });
}

export function buildDatasetDataNoteMarkdown(
  metadata: DatasetDataNoteMetadata,
  existingContent?: string
): string {
  const frontmatterLines = [
    `integralNoteType: ${serializeYamlValue(DATA_NOTE_TYPE)}`,
    `dataTargetType: ${serializeYamlValue("dataset")}`,
    `managedDataId: ${serializeYamlValue(metadata.id)}`,
    `datasetId: ${serializeYamlValue(metadata.datasetId)}`,
    `entityType: ${serializeYamlValue(metadata.entityType)}`,
    `displayName: ${serializeYamlValue(metadata.displayName)}`,
    `representation: ${serializeYamlValue(metadata.representation)}`,
    `path: ${serializeYamlValue(metadata.path)}`,
    `hash: ${serializeYamlValue(metadata.hash)}`,
    `visibility: ${serializeYamlValue(metadata.visibility)}`,
    `provenance: ${serializeYamlValue(metadata.provenance)}`,
    `createdAt: ${serializeYamlValue(metadata.createdAt)}`,
    `kind: ${serializeYamlValue(metadata.kind)}`,
    `createdByBlockId: ${serializeYamlValue(metadata.createdByBlockId)}`
  ];

  if (metadata.memberIds && metadata.memberIds.length > 0) {
    frontmatterLines.push(`memberIds: ${serializeYamlValue(metadata.memberIds)}`);
  }

  return buildManagedDataNoteMarkdown({
    defaultBody: buildTitleOnlyNoteBody(metadata.displayName),
    existingContent,
    frontmatterLines,
    generatedBodyCandidates: [
      buildLegacyDatasetNoteBody(metadata),
      buildTitleOnlyNoteBody(metadata.displayName)
    ],
    isGeneratedBody: (body) => isGeneratedDataNoteBody(body, metadata.displayName),
    managedKeys: DATASET_MANAGED_FRONTMATTER_KEYS
  });
}

export function extractDataNoteBody(markdown: string): string {
  const normalizedMarkdown = normalizeNewlines(markdown);
  const parsed = splitFrontmatterBlock(normalizedMarkdown);

  if (!isDataNoteFrontmatter(parsed.frontmatter)) {
    return normalizedMarkdown;
  }

  return parsed.body;
}

export function hasDataNoteFrontmatter(markdown: string): boolean {
  return isDataNoteFrontmatter(splitFrontmatterBlock(normalizeNewlines(markdown)).frontmatter);
}

export function replaceDataNoteBody(markdown: string, body: string): string {
  const normalizedMarkdown = normalizeNewlines(markdown);
  const parsed = splitFrontmatterBlock(normalizedMarkdown);

  if (!isDataNoteFrontmatter(parsed.frontmatter) || parsed.frontmatter === null) {
    return normalizeBody(body);
  }

  return serializeFrontmatterDocument(parsed.frontmatter, normalizeBody(body));
}

export function parseDataNoteTargetInfo(markdown: string): DataNoteTargetInfo | null {
  const normalizedMarkdown = normalizeNewlines(markdown);
  const { frontmatter } = splitFrontmatterBlock(normalizedMarkdown);

  if (!isDataNoteFrontmatter(frontmatter) || frontmatter === null) {
    return null;
  }

  const dataTargetType = parseFrontmatterValue(frontmatter, "dataTargetType");

  if (dataTargetType === "original-data") {
    const originalDataId =
      parseFrontmatterValue(frontmatter, "originalDataId") ??
      parseFrontmatterValue(frontmatter, "managedDataId");

    return typeof originalDataId === "string" && originalDataId.trim().length > 0
      ? {
          dataTargetType,
          targetId: originalDataId.trim()
        }
      : null;
  }

  if (dataTargetType === "dataset") {
    const datasetId =
      parseFrontmatterValue(frontmatter, "datasetId") ??
      parseFrontmatterValue(frontmatter, "managedDataId");

    return typeof datasetId === "string" && datasetId.trim().length > 0
      ? {
          dataTargetType,
          targetId: datasetId.trim()
        }
      : null;
  }

  return null;
}

interface BuildDataNoteMarkdownOptions {
  defaultBody: string;
  existingContent?: string;
  frontmatterLines: string[];
  generatedBodyCandidates?: string[];
  isGeneratedBody?: (normalizedBody: string) => boolean;
  managedKeys: readonly string[];
}

function buildManagedDataNoteMarkdown({
  defaultBody,
  existingContent,
  frontmatterLines,
  generatedBodyCandidates = [],
  isGeneratedBody,
  managedKeys
}: BuildDataNoteMarkdownOptions): string {
  const normalizedExistingContent =
    typeof existingContent === "string" ? normalizeNewlines(existingContent) : undefined;
  const parsed = normalizedExistingContent
    ? splitFrontmatterBlock(normalizedExistingContent)
    : { body: "", frontmatter: null };
  const body = resolveDataNoteBody(
    defaultBody,
    normalizedExistingContent,
    parsed,
    generatedBodyCandidates,
    isGeneratedBody
  );
  const frontmatter = buildMergedFrontmatter(frontmatterLines, parsed.frontmatter, managedKeys);

  return serializeFrontmatterDocument(frontmatter, body);
}

function resolveDataNoteBody(
  defaultBody: string,
  existingContent: string | undefined,
  parsed: FrontmatterBlock,
  generatedBodyCandidates: readonly string[],
  isGeneratedBody?: (normalizedBody: string) => boolean
): string {
  if (existingContent === undefined) {
    return normalizeBody(defaultBody);
  }

  if (parsed.frontmatter !== null) {
    const normalizedBody = normalizeBody(parsed.body);
    const normalizedGeneratedBodies = generatedBodyCandidates.map((candidate) => normalizeBody(candidate));

    if (
      normalizedGeneratedBodies.includes(normalizedBody) ||
      isGeneratedBody?.(normalizedBody) === true
    ) {
      return normalizeBody(defaultBody);
    }

    return normalizedBody;
  }

  return normalizeBody(existingContent);
}

function buildMergedFrontmatter(
  managedFrontmatterLines: string[],
  existingFrontmatter: string | null,
  managedKeys: readonly string[]
): string {
  const managedFrontmatter = managedFrontmatterLines.join("\n");
  const preservedFrontmatter = removeManagedFrontmatterLines(existingFrontmatter, managedKeys);

  if (preservedFrontmatter.length === 0) {
    return managedFrontmatter;
  }

  return `${managedFrontmatter}\n${preservedFrontmatter}`;
}

function buildTitleOnlyNoteBody(displayName: string): string {
  return `# ${resolveManagedDataNoteName(displayName)}\n`;
}

function buildLegacyOriginalDataNoteBody(metadata: OriginalDataNoteMetadata): string {
  return `# ${metadata.displayName}_${metadata.originalDataId}\n`;
}

function buildLegacyDatasetNoteBody(metadata: DatasetDataNoteMetadata): string {
  return `# ${metadata.kind}_${metadata.datasetId}\n`;
}

function isGeneratedDataNoteBody(body: string, displayName: string): boolean {
  const normalizedBody = normalizeBody(body);
  const lines = normalizedBody.split("\n");
  const expectedTitle = `# ${resolveManagedDataNoteName(displayName)}`;

  if ((lines[0] ?? "") !== expectedTitle) {
    return false;
  }

  const remainingBody = trimLeadingBlankLines(lines.slice(1).join("\n"));

  if (remainingBody.length === 0) {
    return true;
  }

  return remainingBody.split("\n").every((line) => /^- \[[^\]\n]+\]\([^)]+\)(?: .*)?$/u.test(line));
}

function resolveManagedDataNoteName(displayName: string): string {
  const normalized = displayName.trim();
  return normalized.length > 0 ? normalized : "managed-data";
}

function normalizeDatasetName(displayName: unknown, datasetId: string): string {
  if (typeof displayName === "string" && displayName.trim().length > 0) {
    return displayName;
  }

  const normalizedDatasetId = datasetId.trim();
  return normalizedDatasetId.length > 0 ? normalizedDatasetId : "dataset";
}

function isDataNoteFrontmatter(frontmatter: string | null): boolean {
  return Boolean(frontmatter && DATA_NOTE_TYPE_PATTERN.test(frontmatter));
}

function removeManagedFrontmatterLines(frontmatter: string | null, managedKeys: readonly string[]): string {
  if (!frontmatter) {
    return "";
  }

  return frontmatter
    .split("\n")
    .filter((line) => !managedKeys.some((key) => new RegExp(`^\\s*${key}:`, "u").test(line)))
    .join("\n")
    .trim();
}

function parseFrontmatterValue(frontmatter: string, key: string): unknown {
  const match = new RegExp(`^\\s*${escapeRegExp(key)}:\\s*(.+)$`, "mu").exec(frontmatter);

  if (!match) {
    return undefined;
  }

  const serializedValue = match[1].trim();

  try {
    return JSON.parse(serializedValue);
  } catch {
    return serializedValue;
  }
}

function inferVisibilityFromPath(relativePath: string): ManagedDataVisibility {
  return relativePath.startsWith(".store/") ? "hidden" : "visible";
}

function normalizeWorkspaceRelativePath(relativePath: string): string {
  return relativePath
    .split(/[\\/]+/u)
    .filter(Boolean)
    .join("/");
}

function trimLeadingBlankLines(value: string): string {
  return value.replace(/^(?:\s*\n)+/u, "");
}

function serializeYamlValue(value: unknown): string {
  return value === undefined ? "null" : JSON.stringify(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
