// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "sections.module.checks" },
  { slug: "sections.module.outline" },
  { slug: "sections.studio.checks" },
  { slug: "sections.studio.contract" },
  { slug: "sections.studio.history" },
  { slug: "sections.studio.home" },
  { slug: "sections.studio.leaf-header" },
  { slug: "sections.studio.options" },
  { slug: "sections.studio.page-header" },
  { slug: "sections.studio.page-tabs" },
  { slug: "sections.studio.publications" },
  { slug: "sections.studio.references" },
  { slug: "sections.studio.slot-groups" },
  { slug: "sections.studio.specimen" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("designer-sections.extensions", slug))) notFound();
  return createElement(PublishedPage, { page: "designer-sections.extensions", slug });
}
