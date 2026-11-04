// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "components.table" },
  { slug: "components.grid-list" },
  { slug: "components.tree" },
  { slug: "components.meter" },
  { slug: "components.badge" },
  { slug: "components.keyboard" },
  { slug: "components.avatar" },
  { slug: "components.media-player" },
  { slug: "components.icon" },
  { slug: "components.logo" },
  { slug: "components.chart-bar" },
  { slug: "components.chart-line" },
  { slug: "components.chart-area" },
  { slug: "components.chart-sparkline" },
  { slug: "components.chart-status-strip" },
  { slug: "components.chart-scatter" },
  { slug: "components.chart-heatmap" },
  { slug: "components.chart-range" },
  { slug: "components.chart-waterfall" },
  { slug: "components.semantic-content" },
  { slug: "components.rich-text" },
  { slug: "components.item" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("designer-components.display", slug))) notFound();
  return createElement(PublishedPage, { page: "designer-components.display", slug });
}
