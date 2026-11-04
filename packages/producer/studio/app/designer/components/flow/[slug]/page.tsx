// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "components.flow.base-node" },
  { slug: "components.flow.node-header" },
  { slug: "components.flow.base-handle" },
  { slug: "components.flow.labeled-handle" },
  { slug: "components.flow.edge" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("designer-components.flow", slug))) notFound();
  return createElement(PublishedPage, { page: "designer-components.flow", slug });
}
