import {
  type FrontmatterBlock,
  normalizeMarkdownBody as normalizeBody,
  normalizeMarkdownNewlines as normalizeNewlines,
  serializeFrontmatterDocument,
  splitFrontmatterBlock
} from "./frontmatter";

type DataNoteTargetType = "dataset" | "managed-file";
type ManagedDataVisibility = "hidden" | "visible";
type ManagedDataProvenance = "derived" | "source";
type ManagedFileRepresentation = "directory" | "file";
type DatasetRepresentation = "dataset-json";

interface ManagedDataNoteMetadataBase {
  createdAt: string;
  displayName: string;
  hash: string;
  id: string;
  noteTargetId?: string;
  path: string;
  provenance?: ManagedDataProvenance;
  visibility: ManagedDataVisibility;
}

export interface DatasetDataNoteMetadata extends ManagedDataNoteMetadataBase {
  createdByBlockId: string | null;
  datatype: string | null;
  datasetId: string;
  entityType: "dataset";
  memberIds?: string[];
  representation: DatasetRepresentation;
}

export interface ManagedFileDataNoteMetadata extends ManagedDataNoteMetadataBase {
  createdByBlockId: string | null;
  datatype: string | null;
  entityType: "managed-file";
  representation: ManagedFileRepresentation;
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
  "noteTargetId",
  "visibility",
  "provenance",
  "createdAt"
] as const;
const DATASET_MANAGED_FRONTMATTER_KEYS = [
  ...COMMON_MANAGED_FRONTMATTER_KEYS,
  "datasetId",
  "datatype",
  "createdByBlockId",
  "memberIds"
] as const;
const MANAGED_FILE_FRONTMATTER_KEYS = [
  ...COMMON_MANAGED_FRONTMATTER_KEYS,
  "createdByBlockId",
  "datatype"
] as const;

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
    (value.datatype === null || value.datatype === undefined || typeof value.datatype === "string") &&
    (value.displayName === undefined || typeof value.displayName === "string") &&
    value.representation === "dataset-json" &&
    (value.visibility === "visible" || value.visibility === "hidden") &&
    (value.provenance === "source" || value.provenance === "derived") &&
    (value.createdByBlockId === null ||
      value.createdByBlockId === undefined ||
      typeof value.createdByBlockId === "string") &&
    (value.noteTargetId === undefined || typeof value.noteTargetId === "string") &&
    (value.memberIds === undefined ||
      (Array.isArray(value.memberIds) && value.memberIds.every((item) => typeof item === "string")))
  ) {
    const datasetId = value.id.trim();
    return {
      createdAt: value.createdAt,
      createdByBlockId: value.createdByBlockId ?? null,
      datatype: value.datatype ?? null,
      datasetId,
      displayName: normalizeDatasetName(value.displayName, datasetId),
      entityType: "dataset",
      hash: value.hash,
      id: datasetId,
      memberIds: value.memberIds,
      noteTargetId: normalizeManagedDataNoteTargetId(value.noteTargetId, datasetId),
      path: normalizeWorkspaceRelativePath(value.path),
      provenance: value.provenance,
      representation: value.representation,
      visibility: value.visibility
    };
  }

  return null;
}

export function normalizeManagedFileNoteMetadata(value: unknown): ManagedFileDataNoteMetadata | null {
  if (!isJsonRecord(value)) {
    return null;
  }

  if (
    value.entityType === "managed-file" &&
    typeof value.id === "string" &&
    typeof value.displayName === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.path === "string" &&
    typeof value.hash === "string" &&
    (value.representation === "file" || value.representation === "directory") &&
    (value.visibility === "visible" || value.visibility === "hidden") &&
    (value.createdByBlockId === null ||
      value.createdByBlockId === undefined ||
      typeof value.createdByBlockId === "string") &&
    (value.noteTargetId === undefined || typeof value.noteTargetId === "string") &&
    (value.datatype === null || value.datatype === undefined || typeof value.datatype === "string")
  ) {
    const managedDataId = value.id.trim();
    return {
      createdAt: value.createdAt,
      createdByBlockId: value.createdByBlockId ?? null,
      datatype: value.datatype ?? null,
      displayName: value.displayName,
      entityType: "managed-file",
      hash: value.hash,
      id: managedDataId,
      noteTargetId: normalizeManagedDataNoteTargetId(value.noteTargetId, managedDataId),
      path: normalizeWorkspaceRelativePath(value.path),
      representation: value.representation,
      visibility: value.visibility
    };
  }

  return null;
}

export function isDatasetDataNoteMetadata(value: unknown): value is DatasetDataNoteMetadata {
  return normalizeDatasetDataNoteMetadata(value) !== null;
}

export function isManagedFileNoteMetadata(value: unknown): value is ManagedFileDataNoteMetadata {
  return normalizeManagedFileNoteMetadata(value) !== null;
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
    `noteTargetId: ${serializeYamlValue(normalizeManagedDataNoteTargetId(metadata.noteTargetId, metadata.id))}`,
    `visibility: ${serializeYamlValue(metadata.visibility)}`,
    `provenance: ${serializeYamlValue(metadata.provenance)}`,
    `createdAt: ${serializeYamlValue(metadata.createdAt)}`,
    `datatype: ${serializeYamlValue(metadata.datatype)}`,
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

export function buildManagedFileNoteMarkdown(
  metadata: ManagedFileDataNoteMetadata,
  existingContent?: string
): string {
  const frontmatterLines = [
    `integralNoteType: ${serializeYamlValue(DATA_NOTE_TYPE)}`,
    `dataTargetType: ${serializeYamlValue("managed-file")}`,
    `managedDataId: ${serializeYamlValue(metadata.id)}`,
    `entityType: ${serializeYamlValue(metadata.entityType)}`,
    `displayName: ${serializeYamlValue(metadata.displayName)}`,
    `representation: ${serializeYamlValue(metadata.representation)}`,
    `path: ${serializeYamlValue(metadata.path)}`,
    `hash: ${serializeYamlValue(metadata.hash)}`,
    `noteTargetId: ${serializeYamlValue(normalizeManagedDataNoteTargetId(metadata.noteTargetId, metadata.id))}`,
    `visibility: ${serializeYamlValue(metadata.visibility)}`,
    `createdAt: ${serializeYamlValue(metadata.createdAt)}`,
    `createdByBlockId: ${serializeYamlValue(metadata.createdByBlockId)}`,
    `datatype: ${serializeYamlValue(metadata.datatype)}`
  ];

  return buildManagedDataNoteMarkdown({
    defaultBody: buildTitleOnlyNoteBody(metadata.displayName),
    existingContent,
    frontmatterLines,
    generatedBodyCandidates: [buildTitleOnlyNoteBody(metadata.displayName)],
    isGeneratedBody: (body) => isGeneratedDataNoteBody(body, metadata.displayName),
    managedKeys: MANAGED_FILE_FRONTMATTER_KEYS
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

  if (dataTargetType === "managed-file") {
    const managedDataId = parseFrontmatterValue(frontmatter, "managedDataId");

    return typeof managedDataId === "string" && managedDataId.trim().length > 0
      ? {
          dataTargetType,
          targetId: managedDataId.trim()
        }
      : null;
  }

  return null;
}

export function resolveManagedDataNoteTabName(markdown: string): string | null {
  const normalizedMarkdown = normalizeNewlines(markdown);
  const { frontmatter } = splitFrontmatterBlock(normalizedMarkdown);

  if (!isDataNoteFrontmatter(frontmatter) || frontmatter === null) {
    return null;
  }

  const displayName = parseFrontmatterValue(frontmatter, "displayName");

  if (typeof displayName !== "string") {
    return null;
  }

  return `${resolveManagedDataNoteName(displayName)} のノート`;
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

function buildLegacyDatasetNoteBody(metadata: DatasetDataNoteMetadata): string {
  return `# ${metadata.datasetId}\n`;
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

function normalizeWorkspaceRelativePath(relativePath: string): string {
  return relativePath
    .split(/[\\/]+/u)
    .filter(Boolean)
    .join("/");
}

function normalizeManagedDataNoteTargetId(value: unknown, fallbackId: string): string {
  const fallback = fallbackId.trim();
  const candidate = typeof value === "string" ? value.trim() : "";
  return candidate.length > 0 ? candidate : fallback;
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
