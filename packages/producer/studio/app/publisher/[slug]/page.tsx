// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "page.home" },
  { slug: "page.director" },
  { slug: "page.designer" },
  { slug: "page.writer" },
  { slug: "page.publisher" },
  { slug: "publication.studio" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("publisher", slug))) notFound();
  return createElement(PublishedPage, { page: "publisher", slug });
}
