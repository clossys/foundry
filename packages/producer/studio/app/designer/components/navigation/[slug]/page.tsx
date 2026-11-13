// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "components.link" },
  { slug: "components.breadcrumbs" },
  { slug: "components.tabs" },
  { slug: "components.navigation-tree" },
  { slug: "components.sidebar" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("designer-components.navigation", slug))) notFound();
  return createElement(PublishedPage, { page: "designer-components.navigation", slug });
}
