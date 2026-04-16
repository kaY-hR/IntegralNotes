export type SimpleYamlValue =
  | string
  | number
  | boolean
  | null
  | SimpleYamlObject
  | SimpleYamlValue[];

export interface SimpleYamlObject {
  [key: string]: SimpleYamlValue;
}

interface ParsedYamlLine {
  content: string;
  indent: number;
  lineNumber: number;
}

export function parseSimpleYamlDocument(content: string): SimpleYamlValue {
  const lines = tokenizeYamlLines(content);

  if (lines.length === 0) {
    return {};
  }

  const [value, nextIndex] = parseYamlBlock(lines, 0, lines[0]!.indent);

  if (nextIndex !== lines.length) {
    const nextLine = lines[nextIndex];
    throw new Error(`Unexpected YAML content at line ${nextLine?.lineNumber ?? nextIndex + 1}.`);
  }

  return value;
}

export function serializeSimpleYamlDocument(value: SimpleYamlValue): string {
  if (!isSimpleYamlObject(value)) {
    throw new Error("Root YAML value must be an object.");
  }

  return serializeYamlObject(value, 0);
}

function tokenizeYamlLines(content: string): ParsedYamlLine[] {
  return content
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line, index) => ({
      content: line.trimEnd(),
      lineNumber: index + 1
    }))
    .filter((line) => {
      const trimmed = line.content.trim();
      return trimmed.length > 0 && !trimmed.startsWith("#");
    })
    .map((line) => ({
      content: line.content.trimStart(),
      indent: line.content.length - line.content.trimStart().length,
      lineNumber: line.lineNumber
    }));
}

function parseYamlBlock(
  lines: ParsedYamlLine[],
  startIndex: number,
  indent: number
): [SimpleYamlValue, number] {
  const currentLine = lines[startIndex];

  if (!currentLine) {
    return [{}, startIndex];
  }

  if (currentLine.indent < indent) {
    return [{}, startIndex];
  }

  if (currentLine.content.startsWith("-")) {
    return parseYamlArray(lines, startIndex, indent);
  }

  return parseYamlObject(lines, startIndex, indent);
}

function parseYamlObject(
  lines: ParsedYamlLine[],
  startIndex: number,
  indent: number
): [SimpleYamlObject, number] {
  const result: SimpleYamlObject = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index]!;

    if (line.indent < indent) {
      break;
    }

    if (line.indent > indent) {
      throw new Error(`Unexpected indentation at line ${line.lineNumber}.`);
    }

    if (line.content.startsWith("-")) {
      throw new Error(`Array item is not allowed at line ${line.lineNumber}.`);
    }

    const separatorIndex = line.content.indexOf(":");

    if (separatorIndex <= 0) {
      throw new Error(`Invalid mapping entry at line ${line.lineNumber}.`);
    }

    const key = line.content.slice(0, separatorIndex).trim();
    const remainder = line.content.slice(separatorIndex + 1).trim();

    if (remainder.length > 0) {
      result[key] = parseYamlScalar(remainder);
      index += 1;
      continue;
    }

    const nextLine = lines[index + 1];

    if (!nextLine || nextLine.indent <= indent) {
      result[key] = {};
      index += 1;
      continue;
    }

    const [nestedValue, nextIndex] = parseYamlBlock(lines, index + 1, nextLine.indent);
    result[key] = nestedValue;
    index = nextIndex;
  }

  return [result, index];
}

function parseYamlArray(
  lines: ParsedYamlLine[],
  startIndex: number,
  indent: number
): [SimpleYamlValue[], number] {
  const result: SimpleYamlValue[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index]!;

    if (line.indent < indent) {
      break;
    }

    if (line.indent > indent) {
      throw new Error(`Unexpected indentation at line ${line.lineNumber}.`);
    }

    if (!line.content.startsWith("-")) {
      break;
    }

    const remainder = line.content.slice(1).trim();

    if (remainder.length > 0) {
      result.push(parseYamlScalar(remainder));
      index += 1;
      continue;
    }

    const nextLine = lines[index + 1];

    if (!nextLine || nextLine.indent <= indent) {
      result.push({});
      index += 1;
      continue;
    }

    const [nestedValue, nextIndex] = parseYamlBlock(lines, index + 1, nextLine.indent);
    result.push(nestedValue);
    index = nextIndex;
  }

  return [result, index];
}

function parseYamlScalar(value: string): SimpleYamlValue {
  if (value === "null") {
    return null;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (value === "{}") {
    return {};
  }

  if (value === "[]") {
    return [];
  }

  if (/^-?\d+(?:\.\d+)?$/u.test(value)) {
    return Number(value);
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return parseQuotedYamlString(value);
  }

  return value;
}

function parseQuotedYamlString(value: string): string {
  if (value.startsWith('"')) {
    return JSON.parse(value) as string;
  }

  return value
    .slice(1, -1)
    .replace(/\\'/gu, "'")
    .replace(/\\\\/gu, "\\")
    .replace(/\\n/gu, "\n");
}

function serializeYamlObject(value: SimpleYamlObject, indent: number): string {
  const lines: string[] = [];

  for (const [key, entryValue] of Object.entries(value)) {
    const prefix = `${" ".repeat(indent)}${key}:`;

    if (isInlineYamlValue(entryValue)) {
      lines.push(`${prefix} ${serializeInlineYamlValue(entryValue)}`);
      continue;
    }

    lines.push(prefix);
    lines.push(serializeYamlValue(entryValue, indent + 2));
  }

  return lines.join("\n");
}

function serializeYamlArray(value: SimpleYamlValue[], indent: number): string {
  const lines: string[] = [];

  for (const entryValue of value) {
    const prefix = `${" ".repeat(indent)}-`;

    if (isInlineYamlValue(entryValue)) {
      lines.push(`${prefix} ${serializeInlineYamlValue(entryValue)}`);
      continue;
    }

    lines.push(prefix);
    lines.push(serializeYamlValue(entryValue, indent + 2));
  }

  return lines.join("\n");
}

function serializeYamlValue(value: SimpleYamlValue, indent: number): string {
  if (Array.isArray(value)) {
    return serializeYamlArray(value, indent);
  }

  if (isSimpleYamlObject(value)) {
    return serializeYamlObject(value, indent);
  }

  return `${" ".repeat(indent)}${serializeInlineYamlValue(value)}`;
}

function isInlineYamlValue(value: SimpleYamlValue): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    (Array.isArray(value) && value.length === 0) ||
    (isSimpleYamlObject(value) && Object.keys(value).length === 0)
  );
}

function serializeInlineYamlValue(value: SimpleYamlValue): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return `${value}`;
  }

  if (typeof value === "string") {
    return shouldQuoteYamlString(value) ? JSON.stringify(value) : value;
  }

  if (Array.isArray(value)) {
    return "[]";
  }

  return "{}";
}

function shouldQuoteYamlString(value: string): boolean {
  if (value.length === 0) {
    return true;
  }

  if (["null", "true", "false"].includes(value)) {
    return true;
  }

  if (/^-?\d+(?:\.\d+)?$/u.test(value)) {
    return true;
  }

  return !/^[A-Za-z0-9_./:@+-]+$/u.test(value);
}

function isSimpleYamlObject(value: SimpleYamlValue): value is SimpleYamlObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
