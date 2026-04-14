export interface WorkspacePathChange {
  nextPath: string;
  previousPath: string;
}

const FENCED_CODE_BLOCK_PATTERN = /```[\s\S]*?```/gu;
const MARKDOWN_LINK_PATTERN = /(!?\[[^\]\n]*\])\(([^)\n]+)\)/gu;
const EXTERNAL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/u;

export function toCanonicalWorkspaceTarget(relativePath: string): string {
  const normalized = normalizeWorkspaceRelativePath(relativePath);

  return normalized ? `/${normalized}` : "/";
}

export function resolveWorkspaceMarkdownTarget(target: string): string | null {
  const trimmed = target.trim();

  if (
    trimmed.length === 0 ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("//") ||
    trimmed.includes("?") ||
    trimmed.includes("#") ||
    EXTERNAL_SCHEME_PATTERN.test(trimmed)
  ) {
    return null;
  }

  let normalized = trimmed.replace(/\\/gu, "/");

  try {
    normalized = decodeURI(normalized);
  } catch {
    return null;
  }

  if (normalized.startsWith("/")) {
    normalized = normalized.slice(1);
  }

  if (normalized.startsWith("./")) {
    normalized = normalized.replace(/^\.\/+/u, "");
  }

  return normalizeWorkspaceRelativePath(normalized);
}

export function rewriteWorkspaceMarkdownReferences(
  markdown: string,
  pathChanges: WorkspacePathChange[]
): string {
  if (pathChanges.length === 0 || markdown.length === 0) {
    return markdown;
  }

  const normalizedChanges = normalizePathChanges(pathChanges);

  if (normalizedChanges.length === 0) {
    return markdown;
  }

  let result = "";
  let previousIndex = 0;

  for (const match of markdown.matchAll(FENCED_CODE_BLOCK_PATTERN)) {
    const index = match.index ?? 0;
    const block = match[0];
    result += rewriteMarkdownSegment(markdown.slice(previousIndex, index), normalizedChanges);
    result += block;
    previousIndex = index + block.length;
  }

  result += rewriteMarkdownSegment(markdown.slice(previousIndex), normalizedChanges);
  return result;
}

function rewriteMarkdownSegment(markdown: string, pathChanges: WorkspacePathChange[]): string {
  return markdown.replace(MARKDOWN_LINK_PATTERN, (fullMatch, label, target) => {
    const rewrittenTarget = rewriteWorkspaceTarget(target, pathChanges);

    if (rewrittenTarget === target) {
      return fullMatch;
    }

    return `${label}(${rewrittenTarget})`;
  });
}

function rewriteWorkspaceTarget(target: string, pathChanges: WorkspacePathChange[]): string {
  const resolvedPath = resolveWorkspaceMarkdownTarget(target);

  if (!resolvedPath) {
    return target;
  }

  let rewrittenPath = resolvedPath;

  for (const pathChange of pathChanges) {
    if (rewrittenPath === pathChange.previousPath) {
      rewrittenPath = pathChange.nextPath;
      break;
    }

    if (rewrittenPath.startsWith(`${pathChange.previousPath}/`)) {
      rewrittenPath = `${pathChange.nextPath}${rewrittenPath.slice(pathChange.previousPath.length)}`;
      break;
    }
  }

  if (rewrittenPath === resolvedPath) {
    return target;
  }

  return target.trimStart().startsWith("/") ? `/${rewrittenPath}` : rewrittenPath;
}

function normalizePathChanges(pathChanges: WorkspacePathChange[]): WorkspacePathChange[] {
  const normalized: WorkspacePathChange[] = [];

  for (const pathChange of pathChanges) {
    const previousPath = normalizeWorkspaceRelativePath(pathChange.previousPath);
    const nextPath = normalizeWorkspaceRelativePath(pathChange.nextPath);

    if (!previousPath || !nextPath || previousPath === nextPath) {
      continue;
    }

    normalized.push({
      nextPath,
      previousPath
    });
  }

  return normalized;
}

function normalizeWorkspaceRelativePath(relativePath: string): string | null {
  const parts = relativePath
    .trim()
    .split(/[\\/]+/u)
    .filter(Boolean);

  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    return null;
  }

  return parts.join("/");
}
