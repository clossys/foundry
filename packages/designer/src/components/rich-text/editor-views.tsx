import { MarkViewContent, NodeViewContent, NodeViewWrapper, useReactNodeView, type MarkViewProps } from "@tiptap/react";
import { Badge } from "../Badge.js";
import { Link } from "../Link.server.js";
import { SemanticContent } from "../SemanticContent.js";
import { Table } from "../Table.js";
import { RichTextCode, RichTextCallout, safeHref } from "./document.js";

export function RichTextLinkView({ mark }: MarkViewProps) {
  const href = safeHref(mark.attrs.href);
  return href ? <Link href={href} data-slot="rich-text-link"><MarkViewContent /></Link> : <SemanticContent as="span"><MarkViewContent /></SemanticContent>;
}
export function RichTextBadgeView() {
  return <Badge data-slot="rich-text-badge"><MarkViewContent /></Badge>;
}
export function RichTextCodeView() {
  return <RichTextCode><MarkViewContent /></RichTextCode>;
}
export function RichTextCodeBlockView() {
  return <NodeViewWrapper><RichTextCode block><NodeViewContent<"span"> as="span" /></RichTextCode></NodeViewWrapper>;
}
export function RichTextCalloutView() {
  return <NodeViewWrapper><RichTextCallout><NodeViewContent /></RichTextCallout></NodeViewWrapper>;
}
export function RichTextTableView() {
  const { nodeViewContentRef } = useReactNodeView();
  // The engine owns a tbody contentDOM; the Designer table owns its semantic
  // table shell. No nested tbody or interactive collection replaces its rows.
  return <NodeViewWrapper><Table.Document ref={nodeViewContentRef} data-node-view-content="" data-slot="rich-text-table" aria-label="Document table" /></NodeViewWrapper>;
}
