// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "strings.actions" },
  { slug: "strings.navigation" },
  { slug: "strings.field-labels" },
  { slug: "strings.common" },
  { slug: "strings.statuses" },
  { slug: "strings.counters" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("writer-strings.interface", slug))) notFound();
  return createElement(PublishedPage, { page: "writer-strings.interface", slug });
}
