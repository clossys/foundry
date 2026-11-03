// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "sections.form" },
  { slug: "sections.newsletter" },
  { slug: "sections.wizard" },
  { slug: "sections.settings" },
  { slug: "sections.column-mapper" },
  { slug: "sections.access-matrix" },
  { slug: "sections.chat" },
  { slug: "sections.sign-in-form" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("designer-sections.collect", slug))) notFound();
  return createElement(PublishedPage, { page: "designer-sections.collect", slug });
}
