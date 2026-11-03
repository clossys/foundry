// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "page.designer-themes" },
  { slug: "page.designer-assets" },
  { slug: "page.designer-components" },
  { slug: "page.designer-sections" },
  { slug: "page.designer-frames" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("publisher-studio.designer", slug))) notFound();
  return createElement(PublishedPage, { page: "publisher-studio.designer", slug });
}
