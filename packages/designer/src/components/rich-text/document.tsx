import { createElement, Fragment, type ReactNode } from "react";
import type { JSONContent } from "@tiptap/react";
import { Badge } from "../Badge.js";
import { Link } from "../Link.server.js";
import { SemanticContent } from "../SemanticContent.js";
import { Table } from "../Table.js";

// shadcn Typography's hierarchy, spacing, code and blockquote treatment, mapped
// to the consumer contract rather than fixed colours, sizes or a prose plugin.
export const RICH_TEXT_CLASSES = "font-body text-body text-ink-primary [overflow-wrap:anywhere] [&_p]:my-md [&_ul]:my-md [&_ul]:list-disc [&_ul]:ps-xl [&_ol]:my-md [&_ol]:list-decimal [&_ol]:ps-xl [&_li]:my-xs [&_h1]:mt-xl [&_h1]:mb-md [&_h1]:font-display [&_h1]:leading-heading [&_h1]:text-h1 [&_h1]:font-bold [&_h2]:mt-xl [&_h2]:mb-md [&_h2]:font-display [&_h2]:leading-heading [&_h2]:text-h2 [&_h2]:font-semibold [&_h3]:mt-lg [&_h3]:mb-sm [&_h3]:text-h3 [&_h3]:font-semibold [&_h4]:mt-lg [&_h4]:font-semibold [&_h5]:font-semibold [&_h6]:font-semibold [&_blockquote]:my-lg [&_blockquote]:border-s-(length:--ui-border-hairline) [&_blockquote]:border-line-base [&_blockquote]:ps-lg [&_blockquote]:italic [&_pre]:my-lg [&_pre]:overflow-x-auto [&_pre]:rounded-control [&_pre]:bg-surface-sunken [&_pre]:p-md [&_hr]:my-xl [&_hr]:border-line-base [&_.ProseMirror]:outline-none";

/** Document code and callout parts stay within the rich-text leaf. */
function RichTextCode({ children, block = false }: { children: ReactNode; block?: boolean }) {
  const code = <SemanticContent as="code" data-slot="rich-text-code" className="font-mono text-code-block text-ink-primary rounded-control bg-surface-sunken">{children}</SemanticContent>;
  return block ? createElement("pre", null, code) : code;
}
function RichTextCallout({ children }: { children: ReactNode }) {
  return <SemanticContent as="aside" data-slot="rich-text-callout" className="my-lg border-s-(length:--ui-border-hairline) border-line-base bg-surface-sunken px-lg py-md">{children}</SemanticContent>;
}

/** URI attributes never enter markup unfiltered, including direct JSON input. */
function safeHref(value: unknown): string | undefined {
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
  // React Aria collection keys share one namespace across headers and rows.
  const columns = first.map((cell, index) => ({ id: `column-${index}`, index, cell }));
  return <Table aria-label="Document table" data-slot="rich-text-table">
    <Table.Header columns={columns} className={hasHeader ? undefined : "sr-only"}>{({ id, index, cell }) => <Table.Column id={id} isRowHeader={index === 0}>{hasHeader ? children(cell) : String(index + 1)}</Table.Column>}</Table.Header>
    <Table.Body>{rows.slice(hasHeader ? 1 : 0).map((row, rowIndex) => <Table.Row key={rowIndex} id={`row-${rowIndex}`}>{(row.content ?? []).map((cell, index) => <Table.Cell key={index}>{children(cell)}</Table.Cell>)}</Table.Row>)}</Table.Body>
  </Table>;
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
        case "badge": result = <Badge data-slot="rich-text-badge">{result}</Badge>; break;
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
    case "paragraph": return <SemanticContent as="p">{children(node)}</SemanticContent>;
    case "heading": return createElement(`h${Math.min(6, Math.max(1, Number(node.attrs?.level) || 1))}`, null, children(node));
    case "bulletList": return createElement("ul", null, children(node));
    case "orderedList": return createElement("ol", { start: Number(node.attrs?.start) || 1 }, children(node));
    case "listItem": return createElement("li", null, children(node));
    case "blockquote": return createElement("blockquote", null, children(node));
    case "codeBlock": return <RichTextCode block>{children(node)}</RichTextCode>;
    case "hardBreak": return createElement("br");
    case "horizontalRule": return createElement("hr");
    case "callout": return <RichTextCallout>{children(node)}</RichTextCallout>;
    case "table": return <RichTextTable node={node} />;
    default: throw new TypeError(`RichText cannot render node ${node.type}`);
  }
}
