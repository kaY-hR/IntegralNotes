export interface FrontmatterBlock {
  body: string;
  frontmatter: string | null;
}

const FRONTMATTER_PATTERN = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n)?/u;

export function splitFrontmatterBlock(markdown: string): FrontmatterBlock {
  const match = FRONTMATTER_PATTERN.exec(markdown);

  if (!match) {
    return {
      body: markdown,
      frontmatter: null
    };
  }

  return {
    body: normalizeMarkdownNewlines(markdown.slice(match[0].length)),
    frontmatter: normalizeMarkdownNewlines(match[1] ?? "")
  };
}

export function hasFrontmatterBlock(markdown: string): boolean {
  return splitFrontmatterBlock(markdown).frontmatter !== null;
}

export function extractFrontmatterBody(markdown: string): string {
  const parsed = splitFrontmatterBlock(markdown);
  return parsed.frontmatter === null ? markdown : parsed.body;
}

export function replaceFrontmatterBody(markdown: string, body: string): string {
  const parsed = splitFrontmatterBlock(markdown);

  if (parsed.frontmatter === null) {
    return body;
  }

  return serializeFrontmatterDocument(parsed.frontmatter, body);
}

export function serializeFrontmatterDocument(frontmatter: string, body: string): string {
  const normalizedFrontmatter = normalizeMarkdownNewlines(frontmatter);
  const normalizedBody = normalizeMarkdownBody(body);
  return `---\n${normalizedFrontmatter}\n---\n${normalizedBody}`;
}

export function normalizeMarkdownBody(body: string): string {
  const normalizedBody = normalizeMarkdownNewlines(body);

  if (normalizedBody.length === 0) {
    return "";
  }

  return normalizedBody.endsWith("\n") ? normalizedBody : `${normalizedBody}\n`;
}

export function normalizeMarkdownNewlines(value: string): string {
  return value.replace(/\r\n?/gu, "\n");
}
