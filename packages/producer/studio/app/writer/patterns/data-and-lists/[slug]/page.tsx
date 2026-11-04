// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "patterns.feature-bullet" },
  { slug: "patterns.stat" },
  { slug: "patterns.pricing-item" },
  { slug: "patterns.table-header" },
  { slug: "patterns.table-caption" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("writer-patterns.data-and-lists", slug))) notFound();
  return createElement(PublishedPage, { page: "writer-patterns.data-and-lists", slug });
}
