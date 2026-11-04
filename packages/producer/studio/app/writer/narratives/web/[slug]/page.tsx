// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "narratives.page-story" },
  { slug: "narratives.screen" },
  { slug: "narratives.site-chrome" },
  { slug: "narratives.app-chrome" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("writer-narratives.web", slug))) notFound();
  return createElement(PublishedPage, { page: "writer-narratives.web", slug });
}
