// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "assets.icon-chevron-down" },
  { slug: "assets.icon-chevron-up" },
  { slug: "assets.icon-chevron-left" },
  { slug: "assets.icon-chevron-right" },
  { slug: "assets.icon-arrow-right" },
  { slug: "assets.icon-external-link" },
  { slug: "assets.icon-home" },
  { slug: "assets.icon-panel-left" },
  { slug: "assets.icon-search" },
  { slug: "assets.icon-close" },
  { slug: "assets.icon-check" },
  { slug: "assets.icon-settings" },
  { slug: "assets.icon-list-view" },
  { slug: "assets.icon-grid-view" },
  { slug: "assets.icon-theme-light" },
  { slug: "assets.icon-theme-dark" },
  { slug: "assets.icon-theme-system" },
  { slug: "assets.icon-success" },
  { slug: "assets.icon-warning" },
  { slug: "assets.icon-danger" },
  { slug: "assets.icon-info" },
  { slug: "assets.icon-user" },
  { slug: "assets.icon-team" },
  { slug: "assets.icon-organization" },
  { slug: "assets.icon-website" },
  { slug: "assets.icon-institution" },
  { slug: "assets.icon-guide" },
  { slug: "assets.icon-document" },
  { slug: "assets.icon-document-approved" },
  { slug: "assets.icon-folder" },
  { slug: "assets.icon-date" },
  { slug: "assets.icon-time" },
  { slug: "assets.icon-payment" },
  { slug: "assets.icon-receipt" },
  { slug: "assets.icon-business" },
  { slug: "assets.icon-security" },
  { slug: "assets.icon-locked" },
  { slug: "assets.icon-legal" },
  { slug: "assets.icon-package" },
  { slug: "assets.icon-layers" },
  { slug: "assets.icon-integration" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("designer-assets.icons", slug))) notFound();
  return createElement(PublishedPage, { page: "designer-assets.icons", slug });
}
