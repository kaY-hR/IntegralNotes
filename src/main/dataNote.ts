interface FrontmatterBlock {
  body: string;
  frontmatter: string | null;
}

type DataNoteTargetType = "original-data" | "dataset";

interface DataNoteSourceMember {
  entryName: string;
  originalDataId: string;
}

interface OriginalDataNoteMetadata {
  aliasRelativePath: string;
  createdAt: string;
  originalDataId: string;
  originalName: string;
  sourceKind: "directory" | "file";
  storeRelativePath: string;
}

interface DatasetDataNoteMetadata {
  createdAt: string;
  createdByBlockId: string | null;
  datasetId: string;
  kind: string;
  name?: string;
  sourceMembers?: DataNoteSourceMember[];
  storeRelativePath: string;
}

interface DataNoteTargetInfo {
  dataTargetType: DataNoteTargetType;
  targetId: string;
}

interface ExistingDataNoteFileAssignment {
  fileName: string;
  targetKey: string | null;
}

interface DesiredDataNoteFileAssignment {
  preferredLabel: string;
  targetKey: string;
}

const DATA_NOTE_TYPE = "data-note";
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?/u;
const DATA_NOTE_TYPE_PATTERN = /^\s*integralNoteType:\s*(?:"data-note"|'data-note'|data-note)\s*$/mu;
const COMMON_MANAGED_FRONTMATTER_KEYS = [
  "integralNoteType",
  "dataTargetType",
  "createdAt",
  "storeRelativePath"
] as const;
const ORIGINAL_DATA_MANAGED_FRONTMATTER_KEYS = [
  ...COMMON_MANAGED_FRONTMATTER_KEYS,
  "originalName",
  "originalDataId",
  "sourceKind",
  "aliasRelativePath"
] as const;
const DATASET_MANAGED_FRONTMATTER_KEYS = [
  ...COMMON_MANAGED_FRONTMATTER_KEYS,
  "datasetId",
  "name",
  "kind",
  "createdByBlockId",
  "sourceMembers"
] as const;

export type {
  DataNoteSourceMember,
  DataNoteTargetInfo,
  DataNoteTargetType,
  DatasetDataNoteMetadata,
  DesiredDataNoteFileAssignment,
  ExistingDataNoteFileAssignment,
  OriginalDataNoteMetadata
};

export function createOriginalDataNoteFileName(
  originalName: string,
  sequence = 1
): string {
  return createManagedDataNoteFileName(originalName, sequence);
}

export function createDatasetDataNoteFileName(
  datasetName: string,
  sequence = 1
): string {
  return createManagedDataNoteFileName(datasetName, sequence);
}

export function createDataNoteTargetKey(
  dataTargetType: DataNoteTargetType,
  targetId: string
): string {
  return `${dataTargetType}:${targetId.trim()}`;
}

export function resolveDatasetDataNoteName(
  metadata: Pick<DatasetDataNoteMetadata, "datasetId" | "name">
): string {
  const normalizedName = metadata.name?.trim();

  if (normalizedName && normalizedName.length > 0) {
    return normalizedName;
  }

  const fallbackId = metadata.datasetId.trim();
  return fallbackId.length > 0 ? fallbackId : "dataset";
}

export function parseDataNoteTargetInfo(markdown: string): DataNoteTargetInfo | null {
  const normalizedMarkdown = normalizeNewlines(markdown);
  const { frontmatter } = splitFrontmatterBlock(normalizedMarkdown);

  if (!isDataNoteFrontmatter(frontmatter) || frontmatter === null) {
    return null;
  }

  const dataTargetType = parseFrontmatterValue(frontmatter, "dataTargetType");

  if (dataTargetType === "original-data") {
    const originalDataId = parseFrontmatterValue(frontmatter, "originalDataId");
    return typeof originalDataId === "string" && originalDataId.trim().length > 0
      ? {
          dataTargetType,
          targetId: originalDataId.trim()
        }
      : null;
  }

  if (dataTargetType === "dataset") {
    const datasetId = parseFrontmatterValue(frontmatter, "datasetId");
    return typeof datasetId === "string" && datasetId.trim().length > 0
      ? {
          dataTargetType,
          targetId: datasetId.trim()
        }
      : null;
  }

  return null;
}

export function assignDataNoteFileNames(
  existingFiles: readonly ExistingDataNoteFileAssignment[],
  desiredFiles: readonly DesiredDataNoteFileAssignment[]
): Map<string, string> {
  const desiredTargetKeys = new Set<string>();
  const orderedDesiredFiles: DesiredDataNoteFileAssignment[] = [];

  for (const desiredFile of desiredFiles) {
    if (desiredTargetKeys.has(desiredFile.targetKey)) {
      continue;
    }

    desiredTargetKeys.add(desiredFile.targetKey);
    orderedDesiredFiles.push(desiredFile);
  }

  const existingManagedFiles = new Map<string, string[]>();
  const reservedFileNames = new Set<string>();

  for (const existingFile of [...existingFiles].sort((left, right) =>
    left.fileName.localeCompare(right.fileName, "ja")
  )) {
    if (existingFile.targetKey === null || !desiredTargetKeys.has(existingFile.targetKey)) {
      reservedFileNames.add(existingFile.fileName.toLowerCase());
      continue;
    }

    const currentFiles = existingManagedFiles.get(existingFile.targetKey) ?? [];
    currentFiles.push(existingFile.fileName);
    existingManagedFiles.set(existingFile.targetKey, currentFiles);
  }

  for (const managedFiles of existingManagedFiles.values()) {
    managedFiles.sort((left, right) => left.localeCompare(right, "ja"));

    for (const duplicateFileName of managedFiles.slice(1)) {
      reservedFileNames.add(duplicateFileName.toLowerCase());
    }
  }

  const assignments = new Map<string, string>();

  for (const desiredFile of orderedDesiredFiles) {
    let sequence = 1;
    let candidateFileName = createManagedDataNoteFileName(desiredFile.preferredLabel, sequence);

    while (reservedFileNames.has(candidateFileName.toLowerCase())) {
      sequence += 1;
      candidateFileName = createManagedDataNoteFileName(desiredFile.preferredLabel, sequence);
    }

    assignments.set(desiredFile.targetKey, candidateFileName);
    reservedFileNames.add(candidateFileName.toLowerCase());
  }

  return assignments;
}

export function buildOriginalDataNoteMarkdown(
  metadata: OriginalDataNoteMetadata,
  existingContent?: string
): string {
  return buildDataNoteMarkdown({
    defaultBody: buildDefaultOriginalDataNoteBody(metadata),
    existingContent,
    frontmatterLines: [
      `integralNoteType: ${serializeYamlValue(DATA_NOTE_TYPE)}`,
      `dataTargetType: ${serializeYamlValue("original-data")}`,
      `originalName: ${serializeYamlValue(metadata.originalName)}`,
      `originalDataId: ${serializeYamlValue(metadata.originalDataId)}`,
      `sourceKind: ${serializeYamlValue(metadata.sourceKind)}`,
      `createdAt: ${serializeYamlValue(metadata.createdAt)}`,
      `aliasRelativePath: ${serializeYamlValue(metadata.aliasRelativePath)}`,
      `storeRelativePath: ${serializeYamlValue(metadata.storeRelativePath)}`
    ],
    generatedBodyCandidates: [
      buildLegacyOriginalDataNoteBody(metadata),
      buildDefaultOriginalDataNoteBody(metadata)
    ],
    legacyBodyExtractor: (normalizedExistingContent) =>
      extractLegacyOriginalDataNoteBody(normalizedExistingContent, metadata),
    managedKeys: ORIGINAL_DATA_MANAGED_FRONTMATTER_KEYS
  });
}

export function buildDatasetDataNoteMarkdown(
  metadata: DatasetDataNoteMetadata,
  existingContent?: string
): string {
  const datasetName = resolveDatasetDataNoteName(metadata);
  const frontmatterLines = [
    `integralNoteType: ${serializeYamlValue(DATA_NOTE_TYPE)}`,
    `dataTargetType: ${serializeYamlValue("dataset")}`,
    `datasetId: ${serializeYamlValue(metadata.datasetId)}`,
    `name: ${serializeYamlValue(datasetName)}`,
    `kind: ${serializeYamlValue(metadata.kind)}`,
    `createdAt: ${serializeYamlValue(metadata.createdAt)}`,
    `createdByBlockId: ${serializeYamlValue(metadata.createdByBlockId)}`,
    `storeRelativePath: ${serializeYamlValue(metadata.storeRelativePath)}`
  ];

  if (metadata.sourceMembers && metadata.sourceMembers.length > 0) {
    frontmatterLines.push(`sourceMembers: ${serializeYamlValue(metadata.sourceMembers)}`);
  }

  return buildDataNoteMarkdown({
    defaultBody: buildDefaultDatasetNoteBody(metadata),
    existingContent,
    frontmatterLines,
    generatedBodyCandidates: [
      buildLegacyDatasetDataNoteBody(metadata),
      buildDefaultDatasetNoteBody(metadata)
    ],
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
  const frontmatter = parsed.frontmatter;

  if (!isDataNoteFrontmatter(frontmatter) || frontmatter === null) {
    return body;
  }

  return serializeFrontmatterDocument(frontmatter, normalizeBody(body));
}

export function isOriginalDataNoteMetadata(value: unknown): value is OriginalDataNoteMetadata {
  if (!isJsonRecord(value)) {
    return false;
  }

  return (
    typeof value.originalDataId === "string" &&
    typeof value.originalName === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.aliasRelativePath === "string" &&
    typeof value.storeRelativePath === "string" &&
    (value.sourceKind === "file" || value.sourceKind === "directory")
  );
}

export function isDatasetDataNoteMetadata(value: unknown): value is DatasetDataNoteMetadata {
  if (!isJsonRecord(value)) {
    return false;
  }

  const sourceMembers = value.sourceMembers;

  return (
    typeof value.datasetId === "string" &&
    typeof value.kind === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.storeRelativePath === "string" &&
    (value.name === undefined || typeof value.name === "string") &&
    (value.createdByBlockId === null || typeof value.createdByBlockId === "string") &&
    (sourceMembers === undefined ||
      (Array.isArray(sourceMembers) &&
        sourceMembers.every(
          (member) =>
            isJsonRecord(member) &&
            typeof member.entryName === "string" &&
            typeof member.originalDataId === "string"
        )))
  );
}

interface BuildDataNoteMarkdownOptions {
  defaultBody: string;
  existingContent?: string;
  frontmatterLines: string[];
  generatedBodyCandidates?: string[];
  legacyBodyExtractor?: (normalizedExistingContent: string) => string | null;
  managedKeys: readonly string[];
}

function buildDataNoteMarkdown({
  defaultBody,
  existingContent,
  frontmatterLines,
  generatedBodyCandidates = [],
  legacyBodyExtractor,
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
    legacyBodyExtractor
  );
  const frontmatter = buildMergedFrontmatter(frontmatterLines, parsed.frontmatter, managedKeys);

  return serializeFrontmatterDocument(frontmatter, body);
}

function resolveDataNoteBody(
  defaultBody: string,
  existingContent: string | undefined,
  parsed: FrontmatterBlock,
  generatedBodyCandidates: readonly string[],
  legacyBodyExtractor?: (normalizedExistingContent: string) => string | null
): string {
  if (existingContent === undefined) {
    return normalizeBody(defaultBody);
  }

  if (parsed.frontmatter !== null) {
    const normalizedBody = normalizeBody(parsed.body);
    const normalizedGeneratedBodies = generatedBodyCandidates.map((candidate) => normalizeBody(candidate));

    if (normalizedGeneratedBodies.includes(normalizedBody)) {
      return normalizeBody(defaultBody);
    }

    return normalizedBody;
  }

  const legacyBody = legacyBodyExtractor?.(existingContent) ?? null;

  if (legacyBody !== null) {
    return legacyBody;
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

function splitFrontmatterBlock(markdown: string): FrontmatterBlock {
  const match = FRONTMATTER_PATTERN.exec(markdown);

  if (!match) {
    return {
      body: markdown,
      frontmatter: null
    };
  }

  return {
    body: markdown.slice(match[0].length),
    frontmatter: match[1]
  };
}

function serializeFrontmatterDocument(frontmatter: string, body: string): string {
  const normalizedBody = normalizeBody(body);
  return `---\n${frontmatter}\n---\n${normalizedBody}`;
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

function extractLegacyOriginalDataNoteBody(
  markdown: string,
  metadata: OriginalDataNoteMetadata
): string | null {
  const lines = normalizeNewlines(markdown).split("\n");
  const expectedTitle = `# ${metadata.originalName}_${metadata.originalDataId}`;
  const expectedPrefixes = [
    expectedTitle,
    "",
    "- Original Name:",
    "- Original Data ID:",
    "- Source Kind:",
    "- Created At:",
    "- Alias Path:",
    "- Store Path:"
  ];

  if (lines.length < expectedPrefixes.length) {
    return null;
  }

  for (let index = 0; index < expectedPrefixes.length; index += 1) {
    const expected = expectedPrefixes[index];
    const current = lines[index] ?? "";

    if (index <= 1) {
      if (current !== expected) {
        return null;
      }

      continue;
    }

    if (!current.startsWith(expected)) {
      return null;
    }
  }

  const remainingBody = trimLeadingBlankLines(lines.slice(expectedPrefixes.length).join("\n"));

  if (remainingBody.length === 0) {
    return buildDefaultOriginalDataNoteBody(metadata);
  }

  return normalizeBody(remainingBody);
}

function buildDefaultOriginalDataNoteBody(metadata: OriginalDataNoteMetadata): string {
  return `# ${metadata.originalName}\n`;
}

function buildLegacyOriginalDataNoteBody(metadata: OriginalDataNoteMetadata): string {
  return `# ${metadata.originalName}_${metadata.originalDataId}\n`;
}

function buildDefaultDatasetNoteBody(metadata: DatasetDataNoteMetadata): string {
  return `# ${resolveDatasetDataNoteName(metadata)}\n`;
}

function buildLegacyDatasetDataNoteBody(metadata: DatasetDataNoteMetadata): string {
  return `# ${metadata.kind}_${metadata.datasetId}\n`;
}

function createManagedDataNoteFileName(label: string, sequence: number): string {
  const sanitizedLabel = sanitizeFileNameSegment(label);

  if (sequence <= 1) {
    return `${sanitizedLabel}.md`;
  }

  return `${sanitizedLabel}_${sequence}.md`;
}

function normalizeBody(body: string): string {
  const normalizedBody = normalizeNewlines(body);

  if (normalizedBody.length === 0) {
    return "";
  }

  return normalizedBody.endsWith("\n") ? normalizedBody : `${normalizedBody}\n`;
}

function trimLeadingBlankLines(value: string): string {
  return value.replace(/^(?:\s*\n)+/u, "");
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/gu, "\n");
}

function serializeYamlValue(value: unknown): string {
  return value === undefined ? "null" : JSON.stringify(value);
}

function sanitizeFileNameSegment(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, "_")
    .replace(/[. ]+$/gu, "");

  return sanitized.length > 0 ? sanitized : "data-note";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
