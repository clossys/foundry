// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "passages.hero" },
  { slug: "passages.logo-hero" },
  { slug: "passages.page-header" },
  { slug: "passages.logo-mark" },
  { slug: "passages.content" },
  { slug: "passages.article" },
  { slug: "passages.sectioned-document" },
  { slug: "passages.legal-prose" },
  { slug: "passages.features" },
  { slug: "passages.call-to-action" },
  { slug: "passages.testimonials" },
  { slug: "passages.logo-cloud" },
  { slug: "passages.people" },
  { slug: "passages.media" },
  { slug: "passages.gallery" },
  { slug: "passages.faq" },
  { slug: "passages.steps" },
  { slug: "passages.timeline" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("writer-passages.explain", slug))) notFound();
  return createElement(PublishedPage, { page: "writer-passages.explain", slug });
}
