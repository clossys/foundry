// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "components.studio.card-grid" },
  { slug: "components.studio.card-stack" },
  { slug: "components.studio.text-link" },
  { slug: "components.studio.sidebar-static-row" },
  { slug: "components.studio.home-grid" },
  { slug: "components.studio.specimen-frame" },
  { slug: "components.studio.specimen-figure" },
  { slug: "components.studio.block-viewer-iframe" },
  { slug: "components.studio.specimen-document" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("designer-components.studio", slug))) notFound();
  return createElement(PublishedPage, { page: "designer-components.studio", slug });
}
