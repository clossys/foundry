// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "sections.hero" },
  { slug: "sections.logo-hero" },
  { slug: "sections.page-header" },
  { slug: "sections.logo-mark" },
  { slug: "sections.content" },
  { slug: "sections.article" },
  { slug: "sections.sectioned-document" },
  { slug: "sections.legal-prose" },
  { slug: "sections.features" },
  { slug: "sections.call-to-action" },
  { slug: "sections.testimonials" },
  { slug: "sections.logo-cloud" },
  { slug: "sections.people" },
  { slug: "sections.media" },
  { slug: "sections.gallery" },
  { slug: "sections.faq" },
  { slug: "sections.steps" },
  { slug: "sections.timeline" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("designer-sections.explain", slug))) notFound();
  return createElement(PublishedPage, { page: "designer-sections.explain", slug });
}
