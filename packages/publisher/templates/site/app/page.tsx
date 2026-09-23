import type { Metadata } from "next";
import { renderWebDocument, buildWebHeadMetadata } from "@clossys/publisher/web";
// Reads clossys/publisher/surfaces/home.json at build time (#1205: Publisher
// authors surface documents by reference; this route never inlines copy).
import homeSurface from "../../../clossys/publisher/surfaces/home.json" with { type: "json" };

export function generateMetadata(): Metadata {
  const head = buildWebHeadMetadata(homeSurface.meta);
  return { title: head.title, description: head.description };
}

export default function HomePage() {
  const { element } = renderWebDocument(homeSurface, {
    groups: homeSurface.groups ?? [],
  });
  return element;
}
