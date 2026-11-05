// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "patterns.error-message" },
  { slug: "patterns.warning-message" },
  { slug: "patterns.confirmation" },
  { slug: "patterns.empty-state" },
  { slug: "patterns.hint" },
  { slug: "patterns.tooltip" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("writer-patterns.messages", slug))) notFound();
  return createElement(PublishedPage, { page: "writer-patterns.messages", slug });
}
