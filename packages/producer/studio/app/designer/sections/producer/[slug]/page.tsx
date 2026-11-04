// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "sections.producer.pipeline-header" },
  { slug: "sections.producer.pipeline-flow" },
  { slug: "sections.producer.step-sheet" },
  { slug: "sections.producer.pipeline-legend" },
  { slug: "sections.producer.team-strip" },
  { slug: "sections.producer.system-empty" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("designer-sections.producer", slug))) notFound();
  return createElement(PublishedPage, { page: "designer-sections.producer", slug });
}
