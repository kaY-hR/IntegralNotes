interface OriginalDataNoteMetadata {
  aliasRelativePath: string;
  createdAt: string;
  originalDataId: string;
  originalName: string;
  sourceKind: "directory" | "file";
  storeRelativePath: string;
}

interface FrontmatterBlock {
  body: string;
  frontmatter: string | null;
}

const ORIGINAL_DATA_NOTE_TYPE = "data-note";
const MANAGED_FRONTMATTER_KEYS = [
  "integralNoteType",
  "originalName",
  "originalDataId",
  "sourceKind",
  "createdAt",
  "aliasRelativePath",
  "storeRelativePath"
] as const;

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?/u;
const ORIGINAL_DATA_NOTE_TYPE_PATTERN =
  /^\s*integralNoteType:\s*(?:"data-note"|'data-note'|data-note)\s*$/mu;

export type { OriginalDataNoteMetadata };

export function createOriginalDataNoteFileName(
  originalName: string,
  originalDataId: string
): string {
  const normalizedOriginalName = sanitizeFileNameSegment(originalName);
  return `${normalizedOriginalName}_${originalDataId}.md`;
}

export function buildOriginalDataNoteMarkdown(
  metadata: OriginalDataNoteMetadata,
  existingContent?: string
): string {
  const normalizedExistingContent =
    typeof existingContent === "string" ? normalizeNewlines(existingContent) : undefined;
  const parsed = normalizedExistingContent
    ? splitFrontmatterBlock(normalizedExistingContent)
    : { body: "", frontmatter: null };
  const body = resolveOriginalDataNoteBody(metadata, normalizedExistingContent, parsed);
  const frontmatter = buildMergedFrontmatter(metadata, parsed.frontmatter);

  return serializeFrontmatterDocument(frontmatter, body);
}

export function extractOriginalDataNoteBody(markdown: string): string {
  const normalizedMarkdown = normalizeNewlines(markdown);
  const parsed = splitFrontmatterBlock(normalizedMarkdown);

  if (!isOriginalDataNoteFrontmatter(parsed.frontmatter)) {
    return normalizedMarkdown;
  }

  return parsed.body;
}

export function hasOriginalDataNoteFrontmatter(markdown: string): boolean {
  return isOriginalDataNoteFrontmatter(splitFrontmatterBlock(normalizeNewlines(markdown)).frontmatter);
}

export function replaceOriginalDataNoteBody(markdown: string, body: string): string {
  const normalizedMarkdown = normalizeNewlines(markdown);
  const parsed = splitFrontmatterBlock(normalizedMarkdown);
  const frontmatter = parsed.frontmatter;

  if (!isOriginalDataNoteFrontmatter(frontmatter) || frontmatter === null) {
    return body;
  }

  return serializeFrontmatterDocument(frontmatter, normalizeBody(body));
}

function resolveOriginalDataNoteBody(
  metadata: OriginalDataNoteMetadata,
  existingContent: string | undefined,
  parsed: FrontmatterBlock
): string {
  if (existingContent === undefined) {
    return buildDefaultOriginalDataNoteBody(metadata);
  }

  if (parsed.frontmatter !== null) {
    return normalizeBody(parsed.body);
  }

  const legacyBody = extractLegacyOriginalDataNoteBody(existingContent, metadata);

  if (legacyBody !== null) {
    return legacyBody;
  }

  return normalizeBody(existingContent);
}

function buildMergedFrontmatter(
  metadata: OriginalDataNoteMetadata,
  existingFrontmatter: string | null
): string {
  const managedFrontmatter = [
    `integralNoteType: ${serializeYamlString(ORIGINAL_DATA_NOTE_TYPE)}`,
    `originalName: ${serializeYamlString(metadata.originalName)}`,
    `originalDataId: ${serializeYamlString(metadata.originalDataId)}`,
    `sourceKind: ${serializeYamlString(metadata.sourceKind)}`,
    `createdAt: ${serializeYamlString(metadata.createdAt)}`,
    `aliasRelativePath: ${serializeYamlString(metadata.aliasRelativePath)}`,
    `storeRelativePath: ${serializeYamlString(metadata.storeRelativePath)}`
  ].join("\n");

  const preservedFrontmatter = removeManagedFrontmatterLines(existingFrontmatter);

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

function isOriginalDataNoteFrontmatter(frontmatter: string | null): boolean {
  return Boolean(frontmatter && ORIGINAL_DATA_NOTE_TYPE_PATTERN.test(frontmatter));
}

function removeManagedFrontmatterLines(frontmatter: string | null): string {
  if (!frontmatter) {
    return "";
  }

  return frontmatter
    .split("\n")
    .filter((line) => !MANAGED_FRONTMATTER_KEYS.some((key) => new RegExp(`^\\s*${key}:`, "u").test(line)))
    .join("\n")
    .trim();
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
  return `# ${metadata.originalName}_${metadata.originalDataId}\n`;
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

function serializeYamlString(value: string): string {
  return JSON.stringify(value);
}

function sanitizeFileNameSegment(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, "_")
    .replace(/[. ]+$/gu, "");

  return sanitized.length > 0 ? sanitized : "original-data";
}
