// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "sections.specimen-swatch" },
  { slug: "sections.specimen-color-ramp" },
  { slug: "sections.specimen-type-ladder" },
  { slug: "sections.specimen-spacing-ladder" },
  { slug: "sections.specimen-radius-ladder" },
  { slug: "sections.specimen-motion-player" },
  { slug: "sections.specimen-asset-grid" },
  { slug: "sections.specimen-icon-grid" },
  { slug: "sections.specimen-variant-matrix" },
  { slug: "sections.specimen-section-viewports" },
  { slug: "sections.specimen-frame-viewports" },
  { slug: "sections.specimen-rich-passage" },
  { slug: "sections.specimen-copy-in-context" },
  { slug: "sections.specimen-page-viewports" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("designer-sections.specimens", slug))) notFound();
  return createElement(PublishedPage, { page: "designer-sections.specimens", slug });
}
