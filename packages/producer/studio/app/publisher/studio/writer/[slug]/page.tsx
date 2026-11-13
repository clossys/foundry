// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "page.writer-lexicon" },
  { slug: "page.writer-strings" },
  { slug: "page.writer-patterns" },
  { slug: "page.writer-passages" },
  { slug: "page.writer-narratives" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("publisher-studio.writer", slug))) notFound();
  return createElement(PublishedPage, { page: "publisher-studio.writer", slug });
}
