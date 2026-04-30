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
    }
  | {
      alignments: TableColumnAlignment[];
      headers: string[];
      rows: string[][];
      type: "table";
    };

type TableColumnAlignment = "center" | "left" | "right" | undefined;

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

    if (isTableStart(lines, index)) {
      const table = parseTableBlock(lines, index);
      blocks.push(table.block);
      index = table.nextIndex;
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
        isTableStart(lines, index) ||
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

    case "table":
      return (
        <div className="ai-markdown__table-scroll" key={index}>
          <table>
            <thead>
              <tr>
                {block.headers.map((header, cellIndex) => (
                  <th key={cellIndex} style={getTableCellStyle(block.alignments[cellIndex])}>
                    {renderInlineMarkdown(header, `table-${index}-head-${cellIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      style={getTableCellStyle(block.alignments[cellIndex])}
                    >
                      {renderInlineMarkdownWithBreaks(
                        cell,
                        `table-${index}-row-${rowIndex}-cell-${cellIndex}`
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "paragraph":
      return <p key={index}>{renderInlineMarkdownWithBreaks(block.content, `paragraph-${index}`)}</p>;
  }
}

function isTableStart(lines: string[], index: number): boolean {
  const headerLine = lines[index] ?? "";
  const separatorLine = lines[index + 1] ?? "";

  if (!hasUnescapedPipe(headerLine) || !hasUnescapedPipe(separatorLine)) {
    return false;
  }

  const headerCells = splitTableRow(headerLine);
  const separatorCells = splitTableRow(separatorLine);

  return (
    headerCells.some((cell) => cell.trim().length > 0) &&
    separatorCells.length > 0 &&
    separatorCells.every(isTableSeparatorCell)
  );
}

function parseTableBlock(
  lines: string[],
  startIndex: number
): { block: Extract<MarkdownBlock, { type: "table" }>; nextIndex: number } {
  const headerCells = splitTableRow(lines[startIndex] ?? "");
  const separatorCells = splitTableRow(lines[startIndex + 1] ?? "");
  const columnCount = Math.max(headerCells.length, separatorCells.length);
  const headers = normalizeTableRow(headerCells, columnCount);
  const alignments = normalizeTableAlignments(separatorCells.map(parseTableAlignment), columnCount);
  const rows: string[][] = [];
  let index = startIndex + 2;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (line.trim().length === 0 || !hasUnescapedPipe(line)) {
      break;
    }

    rows.push(normalizeTableRow(splitTableRow(line), columnCount));
    index += 1;
  }

  return {
    block: {
      alignments,
      headers,
      rows,
      type: "table"
    },
    nextIndex: index
  };
}

function normalizeTableRow(cells: string[], columnCount: number): string[] {
  return Array.from({ length: columnCount }, (_, index) => cells[index] ?? "");
}

function normalizeTableAlignments(
  alignments: TableColumnAlignment[],
  columnCount: number
): TableColumnAlignment[] {
  return Array.from({ length: columnCount }, (_, index) => alignments[index]);
}

function splitTableRow(line: string): string[] {
  let row = line.trim();

  if (row.startsWith("|")) {
    row = row.slice(1);
  }

  if (row.endsWith("|") && !isEscaped(row, row.length - 1)) {
    row = row.slice(0, -1);
  }

  const cells: string[] = [];
  let cell = "";

  for (let index = 0; index < row.length; index += 1) {
    const character = row[index] ?? "";

    if (character === "|" && !isEscaped(row, index)) {
      cells.push(normalizeTableCell(cell));
      cell = "";
      continue;
    }

    cell += character;
  }

  cells.push(normalizeTableCell(cell));

  return cells;
}

function normalizeTableCell(cell: string): string {
  return cell.trim().replace(/\\\|/gu, "|");
}

function isTableSeparatorCell(cell: string): boolean {
  return /^:?-{3,}:?$/u.test(cell.replace(/\s+/gu, ""));
}

function parseTableAlignment(cell: string): TableColumnAlignment {
  const marker = cell.replace(/\s+/gu, "");
  const alignsLeft = marker.startsWith(":");
  const alignsRight = marker.endsWith(":");

  if (alignsLeft && alignsRight) {
    return "center";
  }

  if (alignsRight) {
    return "right";
  }

  if (alignsLeft) {
    return "left";
  }

  return undefined;
}

function getTableCellStyle(alignment: TableColumnAlignment): { textAlign: TableColumnAlignment } | undefined {
  return alignment ? { textAlign: alignment } : undefined;
}

function hasUnescapedPipe(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "|" && !isEscaped(value, index)) {
      return true;
    }
  }

  return false;
}

function isEscaped(value: string, index: number): boolean {
  let slashCount = 0;

  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }

  return slashCount % 2 === 1;
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
