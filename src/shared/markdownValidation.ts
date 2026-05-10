import type { IntegralAssetCatalog } from "./integral";

export type MarkdownValidationSeverity = "error" | "warning";

export interface MarkdownValidationIssue {
  code: string;
  column: number;
  line: number;
  message: string;
  severity: MarkdownValidationSeverity;
}

export interface MarkdownValidationResult {
  issues: MarkdownValidationIssue[];
  ok: boolean;
}

export interface MarkdownValidationContext {
  assetCatalog?: IntegralAssetCatalog;
}

interface ScalarReference {
  column: number;
  line: number;
  value: string;
}

interface OutputReference extends ScalarReference {
  blockIndex: number;
  blockLine: number;
  blockId: string | null;
  slotName: string;
}

interface ParsedIntegralBlock {
  blockIndex: number;
  id: ScalarReference | null;
  outputs: OutputReference[];
  startLine: number;
}

const INTEGRAL_BLOCK_LANGUAGE = "itg-notes";

export function validateMarkdownDocument(
  markdown: string,
  context: MarkdownValidationContext = {}
): MarkdownValidationResult {
  const blocks = parseIntegralBlocks(markdown);
  const issues = [
    ...validateDuplicateBlockIds(blocks),
    ...validateDuplicateExecutedOutputs(blocks, context.assetCatalog)
  ];

  return {
    issues,
    ok: !issues.some((issue) => issue.severity === "error")
  };
}

export function formatMarkdownValidationIssues(
  issues: readonly MarkdownValidationIssue[]
): string {
  if (issues.length === 0) {
    return "";
  }

  return issues
    .map((issue) => {
      const location = issue.line > 0 ? `${issue.line}:${issue.column}` : "unknown";
      return `${location}: ${issue.message}`;
    })
    .join("\n");
}

function validateDuplicateBlockIds(
  blocks: readonly ParsedIntegralBlock[]
): MarkdownValidationIssue[] {
  const issues: MarkdownValidationIssue[] = [];
  const firstById = new Map<string, ScalarReference>();

  for (const block of blocks) {
    if (!block.id) {
      continue;
    }

    const normalizedId = block.id.value.trim();

    if (normalizedId.length === 0) {
      continue;
    }

    const first = firstById.get(normalizedId);

    if (first) {
      issues.push({
        code: "duplicate-integral-block-id",
        column: block.id.column,
        line: block.id.line,
        message: [
          `解析ブロックの識別情報が重複しています: ${normalizedId}`,
          `最初の出現は ${first.line}:${first.column} です。`,
          "ブロックをコピーして使う場合は、コピー側の `id:` 行を削除し、`out:` に入っている実行済み出力IDを `null` または新しい出力先パスに戻してください。"
        ].join(" "),
        severity: "error"
      });
      continue;
    }

    firstById.set(normalizedId, block.id);
  }

  return issues;
}

function validateDuplicateExecutedOutputs(
  blocks: readonly ParsedIntegralBlock[],
  assetCatalog: IntegralAssetCatalog | undefined
): MarkdownValidationIssue[] {
  const executedOutputIds = collectManagedDataIds(assetCatalog);

  if (executedOutputIds.size === 0) {
    return [];
  }

  const issues: MarkdownValidationIssue[] = [];
  const firstByOutputId = new Map<string, OutputReference>();

  for (const block of blocks) {
    for (const output of block.outputs) {
      if (!executedOutputIds.has(output.value)) {
        continue;
      }

      const first = firstByOutputId.get(output.value);

      if (first) {
        issues.push({
          code: "duplicate-integral-output-id",
          column: output.column,
          line: output.line,
          message: [
            `解析ブロックの実行済み出力IDが重複しています: ${output.value}`,
            `最初の出現は ${first.line}:${first.column} です。`,
            "ブロックをコピーして使う場合は、コピー側の `out:` に入っている実行済み出力IDを `null` または新しい出力先パスに戻してください。"
          ].join(" "),
          severity: "error"
        });
        continue;
      }

      firstByOutputId.set(output.value, output);
    }
  }

  return issues;
}

function collectManagedDataIds(assetCatalog: IntegralAssetCatalog | undefined): Set<string> {
  const ids = new Set<string>();

  for (const managedFile of assetCatalog?.managedFiles ?? []) {
    ids.add(managedFile.id);
  }

  for (const dataset of assetCatalog?.datasets ?? []) {
    ids.add(dataset.datasetId);
  }

  return ids;
}

function parseIntegralBlocks(markdown: string): ParsedIntegralBlock[] {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const blocks: ParsedIntegralBlock[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const opening = parseFenceOpening(lines[index] ?? "");

    if (!opening) {
      continue;
    }

    const closingIndex = findFenceClosing(lines, index + 1, opening);
    const language = opening.info.trim().split(/\s+/u)[0]?.toLowerCase() ?? "";

    if (language === INTEGRAL_BLOCK_LANGUAGE) {
      const sourceLines = lines.slice(index + 1, closingIndex < 0 ? lines.length : closingIndex);
      const sourceStartLine = index + 2;
      const block = parseIntegralBlockSource(
        sourceLines,
        sourceStartLine,
        blocks.length
      );
      blocks.push(block);
    }

    if (closingIndex >= 0) {
      index = closingIndex;
    }
  }

  return blocks;
}

function parseIntegralBlockSource(
  sourceLines: readonly string[],
  sourceStartLine: number,
  blockIndex: number
): ParsedIntegralBlock {
  const id = readTopLevelScalar(sourceLines, sourceStartLine, "id");
  const blockId = id?.value ?? null;

  return {
    blockIndex,
    id,
    outputs: readTopLevelScalarMap(sourceLines, sourceStartLine, ["out", "outputs"]).map(
      (entry) => ({
        ...entry,
        blockId,
        blockIndex,
        blockLine: sourceStartLine,
        slotName: entry.key
      })
    ),
    startLine: sourceStartLine
  };
}

function readTopLevelScalar(
  lines: readonly string[],
  sourceStartLine: number,
  key: string
): ScalarReference | null {
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";

    if (isIgnorableYamlLine(rawLine) || countIndent(rawLine) !== 0) {
      continue;
    }

    const entry = parseYamlKeyValue(rawLine);

    if (!entry || entry.key !== key) {
      continue;
    }

    const value = parseYamlScalarString(entry.rawValue);

    if (value === null) {
      return null;
    }

    return {
      column: entry.valueColumn,
      line: sourceStartLine + index,
      value
    };
  }

  return null;
}

function readTopLevelScalarMap(
  lines: readonly string[],
  sourceStartLine: number,
  keys: readonly string[]
): Array<ScalarReference & { key: string }> {
  const entries: Array<ScalarReference & { key: string }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";

    if (isIgnorableYamlLine(rawLine) || countIndent(rawLine) !== 0) {
      continue;
    }

    const section = parseYamlKeyValue(rawLine);

    if (!section || !keys.includes(section.key)) {
      continue;
    }

    for (let childIndex = index + 1; childIndex < lines.length; childIndex += 1) {
      const childLine = lines[childIndex] ?? "";

      if (isIgnorableYamlLine(childLine)) {
        continue;
      }

      if (countIndent(childLine) === 0) {
        break;
      }

      const child = parseYamlKeyValue(childLine);

      if (!child) {
        continue;
      }

      const value = parseYamlScalarString(child.rawValue);

      if (value === null) {
        continue;
      }

      entries.push({
        column: child.valueColumn,
        key: child.key,
        line: sourceStartLine + childIndex,
        value
      });
    }
  }

  return entries;
}

function parseFenceOpening(line: string): { char: string; info: string; length: number } | null {
  const match = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/u.exec(line);

  if (!match) {
    return null;
  }

  const marker = match[1] ?? "";

  return {
    char: marker[0] ?? "`",
    info: match[2] ?? "",
    length: marker.length
  };
}

function findFenceClosing(
  lines: readonly string[],
  startIndex: number,
  opening: { char: string; length: number }
): number {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (
      trimmed.length >= opening.length &&
      trimmed.split("").every((char) => char === opening.char)
    ) {
      return index;
    }
  }

  return -1;
}

function parseYamlKeyValue(
  line: string
): { key: string; rawValue: string; valueColumn: number } | null {
  const separatorIndex = line.indexOf(":");

  if (separatorIndex <= 0) {
    return null;
  }

  const key = line.slice(0, separatorIndex).trim();

  if (key.length === 0 || key.startsWith("#")) {
    return null;
  }

  return {
    key,
    rawValue: line.slice(separatorIndex + 1),
    valueColumn: separatorIndex + 2
  };
}

function parseYamlScalarString(rawValue: string): string | null {
  const value = stripYamlComment(rawValue).trim();
  const normalizedValue = value.toLowerCase();

  if (
    value.length === 0 ||
    normalizedValue === "null" ||
    normalizedValue === "~" ||
    normalizedValue === "undefined"
  ) {
    return null;
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    const unquoted = value.slice(1, -1).trim();
    return unquoted.length > 0 ? unquoted : null;
  }

  return value;
}

function stripYamlComment(value: string): string {
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if ((char === '"' || char === "'") && (index === 0 || value[index - 1] !== "\\")) {
      quote = quote === char ? null : quote ?? char;
      continue;
    }

    if (char === "#" && quote === null && (index === 0 || /\s/u.test(value[index - 1] ?? ""))) {
      return value.slice(0, index);
    }
  }

  return value;
}

function isIgnorableYamlLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length === 0 || trimmed.startsWith("#");
}

function countIndent(line: string): number {
  return line.length - line.trimStart().length;
}
