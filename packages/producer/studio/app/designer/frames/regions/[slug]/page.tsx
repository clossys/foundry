// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "frames.site-header" },
  { slug: "frames.app-header" },
  { slug: "frames.app-sidebar" },
  { slug: "frames.inspector" },
  { slug: "frames.site-footer" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("designer-frames.regions", slug))) notFound();
  return createElement(PublishedPage, { page: "designer-frames.regions", slug });
}
