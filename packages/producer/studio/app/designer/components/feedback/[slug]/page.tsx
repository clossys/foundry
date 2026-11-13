// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "components.banner" },
  { slug: "components.toast" },
  { slug: "components.empty" },
  { slug: "components.status-mark" },
  { slug: "components.progress-bar" },
  { slug: "components.spinner" },
  { slug: "components.skeleton" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("designer-components.feedback", slug))) notFound();
  return createElement(PublishedPage, { page: "designer-components.feedback", slug });
}
