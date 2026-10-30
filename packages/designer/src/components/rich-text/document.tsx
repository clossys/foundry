import { createElement, Fragment, type ReactNode } from "react";
import type { JSONContent } from "@tiptap/react";
import { Badge } from "../preview-runtime/components/badge/badge.js";
import { Link } from "../Link.server.js";
import { SemanticContent } from "../SemanticContent.js";
import { Table } from "../Table.js";
import { RICH_TEXT_HEADINGS, RICH_TEXT_PARAGRAPH, RICH_TEXT_BULLETS, RICH_TEXT_ORDERED, RICH_TEXT_ITEM, RICH_TEXT_QUOTE, RICH_TEXT_PRE, RICH_TEXT_CODE, RICH_TEXT_CALLOUT, RICH_TEXT_RULE, RICH_TEXT_QUOTE_STYLE, RICH_TEXT_RULE_STYLE } from "./styles.js";

/** Document code and callout parts stay within the rich-text leaf. */
export function RichTextCode({ children, block = false }: { children: ReactNode; block?: boolean }) {
  const code = <SemanticContent as="code" data-slot="rich-text-code" className={RICH_TEXT_CODE}>{children}</SemanticContent>;
  return block ? createElement("pre", { className: RICH_TEXT_PRE }, code) : code;
}
export function RichTextCallout({ children }: { children: ReactNode }) {
  return <SemanticContent as="aside" data-slot="rich-text-callout" className={RICH_TEXT_CALLOUT} style={RICH_TEXT_QUOTE_STYLE}>{children}</SemanticContent>;
}

/** URI attributes never enter markup unfiltered, including direct JSON input. */
export function safeHref(value: unknown): string | undefined {
  if (typeof value !== "string" || /[\u0000-\u0020\u007f]/.test(value)) return undefined;
  return /^(?:https?:|mailto:|tel:|\/|#|\?|\.{1,2}\/)/i.test(value) || !/^[a-z][a-z\d+.-]*:/i.test(value) ? value : undefined;
}

function children(node: JSONContent): ReactNode {
  return node.content?.map((child, index) => <Fragment key={index}>{renderRichTextNode(child)}</Fragment>);
}

function RichTextTable({ node }: { node: JSONContent }) {
  const rows = node.content ?? [];
  const first = rows[0]?.content ?? [];
  const hasHeader = first.length > 0 && first.every(cell => cell.type === "tableHeader");
  const row = (value: JSONContent, index: number, header: boolean) => <Table.Document.Row key={index}>{value.content?.map((cell, cellIndex) => {
    const Cell = cell.type === "tableHeader" ? Table.Document.HeaderCell : Table.Document.Cell;
    return <Cell key={cellIndex} scope={cell.type === "tableHeader" ? header ? "col" : "row" : undefined} colSpan={Number(cell.attrs?.colspan) || 1} rowSpan={Number(cell.attrs?.rowspan) || 1}>{children(cell)}</Cell>;
  })}</Table.Document.Row>;
  return <Table.Document aria-label="Document table" data-slot="rich-text-table">
    {hasHeader ? <Table.Document.Head>{row(rows[0]!, 0, true)}</Table.Document.Head> : null}
    <Table.Document.Body>{rows.slice(hasHeader ? 1 : 0).map((value, index) => row(value, index, false))}</Table.Document.Body>
  </Table.Document>;
}

export function renderRichTextNode(node: JSONContent): ReactNode {
  if (node.type === "text") {
    let result: ReactNode = node.text ?? "";
    for (const mark of node.marks ?? []) {
      switch (mark.type) {
        case "bold": result = createElement("strong", null, result); break;
        case "italic": result = createElement("em", null, result); break;
        case "strike": result = createElement("s", null, result); break;
        case "underline": result = createElement("u", null, result); break;
        case "code": result = <RichTextCode>{result}</RichTextCode>; break;
        case "badge": result = <Badge variant="secondary" data-slot="rich-text-badge">{result}</Badge>; break;
        case "link": {
          const href = safeHref(mark.attrs?.href);
          if (href) result = <Link href={href}>{result}</Link>;
          break;
        }
      }
    }
    return result;
  }
  switch (node.type) {
    case "doc": return children(node);
    case "paragraph": return <SemanticContent as="p" className={RICH_TEXT_PARAGRAPH}>{children(node)}</SemanticContent>;
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
      return createElement(`h${level}`, { className: RICH_TEXT_HEADINGS[level] }, children(node));
    }
    case "bulletList": return createElement("ul", { className: RICH_TEXT_BULLETS }, children(node));
    case "orderedList": return createElement("ol", { start: Number(node.attrs?.start) || 1, className: RICH_TEXT_ORDERED }, children(node));
    case "listItem": return createElement("li", { className: RICH_TEXT_ITEM }, children(node));
    case "blockquote": return createElement("blockquote", { className: RICH_TEXT_QUOTE, style: RICH_TEXT_QUOTE_STYLE }, children(node));
    case "codeBlock": return <RichTextCode block>{children(node)}</RichTextCode>;
    case "hardBreak": return createElement("br");
    case "horizontalRule": return createElement("hr", { className: RICH_TEXT_RULE, style: RICH_TEXT_RULE_STYLE });
    case "callout": return <RichTextCallout>{children(node)}</RichTextCallout>;
    case "table": return <RichTextTable node={node} />;
    default: throw new TypeError(`RichText cannot render node ${node.type}`);
  }
}
