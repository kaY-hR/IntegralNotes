import { type ReactNode } from "react";

interface AiMarkdownProps {
  className?: string;
  compact?: boolean;
  text: string;
}

type MarkdownBlock =
  | {
      content: string;
      language: string;
      type: "code";
    }
  | {
      content: string;
      level: 1 | 2 | 3;
      type: "heading";
    }
  | {
      content: string;
      type: "paragraph";
    }
  | {
      items: string[];
      ordered: boolean;
      type: "list";
    }
  | {
      content: string;
      type: "quote";
    };

export function AiMarkdown({ className, compact = false, text }: AiMarkdownProps): JSX.Element {
  const blocks = parseMarkdownBlocks(text);
  const rootClassName = [
    "ai-markdown",
    compact ? "ai-markdown--compact" : "",
    className ?? ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClassName}>
      {blocks.length > 0
        ? blocks.map((block, index) => renderMarkdownBlock(block, index))
        : null}
    </div>
  );
}

function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/gu, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    const fenceMatch = /^(`{3,}|~{3,})(.*)$/u.exec(line.trim());

    if (fenceMatch) {
      const fence = fenceMatch[1] ?? "```";
      const fenceChar = fence[0] ?? "`";
      const language = (fenceMatch[2] ?? "").trim();
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length) {
        const codeLine = lines[index] ?? "";
        const closingFenceMatch = new RegExp(`^${escapeRegExp(fenceChar)}{${fence.length},}\\s*$`, "u").exec(
          codeLine.trim()
        );

        if (closingFenceMatch) {
          index += 1;
          break;
        }

        codeLines.push(codeLine);
        index += 1;
      }

      blocks.push({
        content: codeLines.join("\n"),
        language,
        type: "code"
      });
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/u.exec(line);

    if (headingMatch) {
      blocks.push({
        content: (headingMatch[2] ?? "").trim(),
        level: Math.min(3, headingMatch[1]?.length ?? 1) as 1 | 2 | 3,
        type: "heading"
      });
      index += 1;
      continue;
    }

    const unorderedMatch = /^\s*[-*]\s+(.+)$/u.exec(line);
    const orderedMatch = /^\s*\d+[.)]\s+(.+)$/u.exec(line);

    if (unorderedMatch || orderedMatch) {
      const ordered = Boolean(orderedMatch);
      const items: string[] = [];

      while (index < lines.length) {
        const itemLine = lines[index] ?? "";
        const itemMatch = ordered
          ? /^\s*\d+[.)]\s+(.+)$/u.exec(itemLine)
          : /^\s*[-*]\s+(.+)$/u.exec(itemLine);

        if (!itemMatch) {
          break;
        }

        items.push((itemMatch[1] ?? "").trim());
        index += 1;
      }

      blocks.push({
        items,
        ordered,
        type: "list"
      });
      continue;
    }

    const quoteMatch = /^>\s?(.*)$/u.exec(line);

    if (quoteMatch) {
      const quoteLines: string[] = [];

      while (index < lines.length) {
        const currentQuoteMatch = /^>\s?(.*)$/u.exec(lines[index] ?? "");

        if (!currentQuoteMatch) {
          break;
        }

        quoteLines.push(currentQuoteMatch[1] ?? "");
        index += 1;
      }

      blocks.push({
        content: quoteLines.join("\n").trim(),
        type: "quote"
      });
      continue;
    }

    const paragraphLines: string[] = [];

    while (index < lines.length) {
      const paragraphLine = lines[index] ?? "";

      if (
        paragraphLine.trim().length === 0 ||
        /^(`{3,}|~{3,})/u.test(paragraphLine.trim()) ||
        /^(#{1,3})\s+/u.test(paragraphLine) ||
        /^\s*(?:[-*]|\d+[.)])\s+/u.test(paragraphLine) ||
        /^>\s?/u.test(paragraphLine)
      ) {
        break;
      }

      paragraphLines.push(paragraphLine);
      index += 1;
    }

    blocks.push({
      content: paragraphLines.join("\n").trim(),
      type: "paragraph"
    });
  }

  return blocks;
}

function renderMarkdownBlock(block: MarkdownBlock, index: number): ReactNode {
  switch (block.type) {
    case "code":
      return (
        <pre className="ai-markdown__code-block" key={index}>
          {block.language ? <span className="ai-markdown__code-language">{block.language}</span> : null}
          <code>{block.content}</code>
        </pre>
      );

    case "heading": {
      const Heading = `h${block.level}` as "h1" | "h2" | "h3";

      return (
        <Heading key={index}>
          {renderInlineMarkdown(block.content, `heading-${index}`)}
        </Heading>
      );
    }

    case "list": {
      const List = block.ordered ? "ol" : "ul";

      return (
        <List key={index}>
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(item, `list-${index}-${itemIndex}`)}</li>
          ))}
        </List>
      );
    }

    case "quote":
      return (
        <blockquote key={index}>
          {renderInlineMarkdownWithBreaks(block.content, `quote-${index}`)}
        </blockquote>
      );

    case "paragraph":
      return <p key={index}>{renderInlineMarkdownWithBreaks(block.content, `paragraph-${index}`)}</p>;
  }
}

function renderInlineMarkdownWithBreaks(value: string, keyPrefix: string): ReactNode[] {
  const lines = value.split("\n");
  const nodes: ReactNode[] = [];

  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) {
      nodes.push(<br key={`${keyPrefix}-br-${lineIndex}`} />);
    }

    nodes.push(...renderInlineMarkdown(line, `${keyPrefix}-line-${lineIndex}`));
  });

  return nodes;
}

function renderInlineMarkdown(value: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;

  while (cursor < value.length) {
    const token = findNextInlineToken(value, cursor);

    if (!token) {
      nodes.push(value.slice(cursor));
      break;
    }

    if (token.start > cursor) {
      nodes.push(value.slice(cursor, token.start));
    }

    const key = `${keyPrefix}-${nodes.length}`;

    switch (token.type) {
      case "code":
        nodes.push(<code key={key}>{token.content}</code>);
        break;
      case "bold":
        nodes.push(<strong key={key}>{renderInlineMarkdown(token.content, `${key}-bold`)}</strong>);
        break;
      case "italic":
        nodes.push(<em key={key}>{renderInlineMarkdown(token.content, `${key}-italic`)}</em>);
        break;
      case "link":
        nodes.push(renderInlineLink(token.label, token.url, key));
        break;
    }

    cursor = token.end;
  }

  return nodes;
}

type InlineToken =
  | {
      content: string;
      end: number;
      start: number;
      type: "bold" | "code" | "italic";
    }
  | {
      end: number;
      label: string;
      start: number;
      type: "link";
      url: string;
    };

function findNextInlineToken(value: string, offset: number): InlineToken | null {
  for (let index = offset; index < value.length; index += 1) {
    if (value[index] === "`") {
      const end = value.indexOf("`", index + 1);

      if (end > index + 1) {
        return {
          content: value.slice(index + 1, end),
          end: end + 1,
          start: index,
          type: "code"
        };
      }
    }

    if (value.startsWith("**", index) || value.startsWith("__", index)) {
      const marker = value.slice(index, index + 2);
      const end = value.indexOf(marker, index + 2);

      if (end > index + 2) {
        return {
          content: value.slice(index + 2, end),
          end: end + 2,
          start: index,
          type: "bold"
        };
      }
    }

    if (value[index] === "*" || value[index] === "_") {
      const marker = value[index] ?? "";

      if (value[index + 1] !== marker) {
        const end = value.indexOf(marker, index + 1);

        if (end > index + 1) {
          return {
            content: value.slice(index + 1, end),
            end: end + 1,
            start: index,
            type: "italic"
          };
        }
      }
    }

    if (value[index] === "[") {
      const labelEnd = value.indexOf("](", index + 1);

      if (labelEnd > index + 1) {
        const urlEnd = value.indexOf(")", labelEnd + 2);

        if (urlEnd > labelEnd + 2) {
          return {
            end: urlEnd + 1,
            label: value.slice(index + 1, labelEnd),
            start: index,
            type: "link",
            url: value.slice(labelEnd + 2, urlEnd)
          };
        }
      }
    }
  }

  return null;
}

function renderInlineLink(label: string, rawUrl: string, key: string): ReactNode {
  const children = renderInlineMarkdown(label, `${key}-link`);
  const safeUrl = normalizeSafeMarkdownLinkUrl(rawUrl);

  if (!safeUrl) {
    return (
      <span className="ai-markdown__link ai-markdown__link--disabled" key={key} title={rawUrl}>
        {children}
      </span>
    );
  }

  return (
    <a className="ai-markdown__link" href={safeUrl} key={key} rel="noreferrer" target="_blank">
      {children}
    </a>
  );
}

function normalizeSafeMarkdownLinkUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();

  if (/^(https?:|mailto:)/iu.test(trimmed)) {
    return trimmed;
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
