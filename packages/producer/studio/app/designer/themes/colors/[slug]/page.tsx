// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "themes.background" },
  { slug: "themes.foreground" },
  { slug: "themes.card" },
  { slug: "themes.card-foreground" },
  { slug: "themes.popover" },
  { slug: "themes.popover-foreground" },
  { slug: "themes.primary" },
  { slug: "themes.primary-foreground" },
  { slug: "themes.secondary" },
  { slug: "themes.secondary-foreground" },
  { slug: "themes.accent" },
  { slug: "themes.accent-foreground" },
  { slug: "themes.destructive" },
  { slug: "themes.success" },
  { slug: "themes.warning" },
  { slug: "themes.info" },
  { slug: "themes.muted" },
  { slug: "themes.muted-foreground" },
  { slug: "themes.border" },
  { slug: "themes.input" },
  { slug: "themes.ring" },
  { slug: "themes.chart-1" },
  { slug: "themes.chart-2" },
  { slug: "themes.chart-3" },
  { slug: "themes.chart-4" },
  { slug: "themes.chart-5" },
  { slug: "themes.sidebar" },
  { slug: "themes.sidebar-foreground" },
  { slug: "themes.sidebar-primary" },
  { slug: "themes.sidebar-primary-foreground" },
  { slug: "themes.sidebar-accent" },
  { slug: "themes.sidebar-accent-foreground" },
  { slug: "themes.sidebar-border" },
  { slug: "themes.sidebar-ring" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("designer-themes.colors", slug))) notFound();
  return createElement(PublishedPage, { page: "designer-themes.colors", slug });
}
