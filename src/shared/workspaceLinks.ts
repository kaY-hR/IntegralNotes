export interface WorkspacePathChange {
  nextPath: string;
  previousPath: string;
}

const FENCED_CODE_BLOCK_PATTERN = /```[\s\S]*?```/gu;
const MARKDOWN_LINK_PATTERN = /(!?\[[^\]\n]*\])\(([^)\n]+)\)/gu;
const EXTERNAL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/u;
const EMBED_HEIGHT_FRAGMENT_PATTERN = /#integral-embed-height=(\d+)$/u;
const BLOCK_FRAGMENT_PATTERN = /^#(BLK-[A-Za-z0-9_-]+)$/u;

export function toCanonicalWorkspaceTarget(relativePath: string): string {
  const normalized = normalizeWorkspaceRelativePath(relativePath);

  return normalized ? `/${normalized}` : "/";
}

export function extractWorkspaceEmbedHeight(target: string): number | null {
  const match = target.trim().match(EMBED_HEIGHT_FRAGMENT_PATTERN);

  if (!match) {
    return null;
  }

  const height = Number.parseInt(match[1] ?? "", 10);

  if (!Number.isFinite(height) || height <= 0) {
    return null;
  }

  return height;
}

export function withWorkspaceEmbedHeight(target: string, height: number | null): string {
  const { pathTarget } = splitWorkspaceMarkdownTarget(target);
  const normalizedTarget = pathTarget.trim();

  if (normalizedTarget.length === 0) {
    return normalizedTarget;
  }

  if (!height || !Number.isFinite(height) || height <= 0) {
    return normalizedTarget;
  }

  return `${normalizedTarget}#integral-embed-height=${Math.round(height)}`;
}

export function extractWorkspaceBlockId(target: string): string | null {
  const { metadataSuffix } = splitWorkspaceMarkdownTarget(target);
  const match = metadataSuffix.match(BLOCK_FRAGMENT_PATTERN);

  if (!match) {
    return null;
  }

  return match[1] ?? null;
}

export function resolveWorkspaceMarkdownTarget(target: string): string | null {
  const { pathTarget } = splitWorkspaceMarkdownTarget(target);
  const trimmed = pathTarget.trim();

  if (
    trimmed.length === 0 ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("//") ||
    trimmed.includes("?") ||
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

export function removeWorkspaceMarkdownReferences(
  markdown: string,
  targetPaths: readonly string[]
): string {
  if (targetPaths.length === 0 || markdown.length === 0) {
    return markdown;
  }

  const normalizedTargets = normalizeReferenceTargetPaths(targetPaths);

  if (normalizedTargets.length === 0) {
    return markdown;
  }

  let result = "";
  let previousIndex = 0;

  for (const match of markdown.matchAll(FENCED_CODE_BLOCK_PATTERN)) {
    const index = match.index ?? 0;
    const block = match[0];
    result += normalizeRemovedMarkdownReferenceWhitespace(
      removeMarkdownReferencesFromSegment(markdown.slice(previousIndex, index), normalizedTargets)
    );
    result += block;
    previousIndex = index + block.length;
  }

  result += normalizeRemovedMarkdownReferenceWhitespace(
    removeMarkdownReferencesFromSegment(markdown.slice(previousIndex), normalizedTargets)
  );
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

function removeMarkdownReferencesFromSegment(
  markdown: string,
  targetPaths: readonly string[]
): string {
  return markdown.replace(MARKDOWN_LINK_PATTERN, (fullMatch, _label, target) => {
    const resolvedPath = resolveWorkspaceMarkdownTarget(target);

    if (!resolvedPath) {
      return fullMatch;
    }

    return isRemovedWorkspaceReference(resolvedPath, targetPaths) ? "" : fullMatch;
  });
}

function normalizeReferenceTargetPaths(targetPaths: readonly string[]): string[] {
  return Array.from(
    new Set(
      targetPaths
        .map((targetPath) => {
          const resolvedPath = resolveWorkspaceMarkdownTarget(targetPath) ?? targetPath;
          return normalizeWorkspaceRelativePath(resolvedPath);
        })
        .filter((targetPath): targetPath is string => targetPath !== null)
    )
  );
}

function isRemovedWorkspaceReference(
  referencePath: string,
  targetPaths: readonly string[]
): boolean {
  return targetPaths.some(
    (targetPath) =>
      referencePath === targetPath || referencePath.startsWith(`${targetPath}/`)
  );
}

function normalizeRemovedMarkdownReferenceWhitespace(markdown: string): string {
  return markdown
    .replace(/[ \t]+$/gmu, "")
    .replace(/^[ \t]*(?:[-*+]|\d+\.)[ \t]*$/gmu, "")
    .replace(/\n{3,}/gu, "\n\n");
}

function rewriteWorkspaceTarget(target: string, pathChanges: WorkspacePathChange[]): string {
  const { metadataSuffix, pathTarget } = splitWorkspaceMarkdownTarget(target);
  const resolvedPath = resolveWorkspaceMarkdownTarget(pathTarget);

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

  return `${pathTarget.trimStart().startsWith("/") ? `/${rewrittenPath}` : rewrittenPath}${metadataSuffix}`;
}

function splitWorkspaceMarkdownTarget(target: string): {
  metadataSuffix: string;
  pathTarget: string;
} {
  const trimmed = target.trim();
  const match = trimmed.match(EMBED_HEIGHT_FRAGMENT_PATTERN);

  if (match && match.index !== undefined) {
    return {
      metadataSuffix: trimmed.slice(match.index),
      pathTarget: trimmed.slice(0, match.index)
    };
  }

  const hashIndex = trimmed.indexOf("#");

  if (hashIndex < 0) {
    return {
      metadataSuffix: "",
      pathTarget: trimmed
    };
  }

  return {
    metadataSuffix: trimmed.slice(hashIndex),
    pathTarget: trimmed.slice(0, hashIndex)
  };
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
