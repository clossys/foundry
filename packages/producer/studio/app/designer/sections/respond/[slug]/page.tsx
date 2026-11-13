// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "sections.empty-state" },
  { slug: "sections.error-state" },
  { slug: "sections.boundary-message" },
  { slug: "sections.notices" },
  { slug: "sections.consent" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("designer-sections.respond", slug))) notFound();
  return createElement(PublishedPage, { page: "designer-sections.respond", slug });
}
