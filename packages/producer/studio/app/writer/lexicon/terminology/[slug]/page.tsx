// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "lexicon.brand-names" },
  { slug: "lexicon.preferred-terms" },
  { slug: "lexicon.avoid-terms" },
  { slug: "lexicon.avoid-patterns" },
  { slug: "lexicon.spelling-variant" },
  { slug: "lexicon.pronunciation" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("writer-lexicon.terminology", slug))) notFound();
  return createElement(PublishedPage, { page: "writer-lexicon.terminology", slug });
}
