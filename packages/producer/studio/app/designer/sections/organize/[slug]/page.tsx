// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "sections.cards" },
  { slug: "sections.resource-list" },
  { slug: "sections.task-list" },
  { slug: "sections.comparison" },
  { slug: "sections.pricing" },
  { slug: "sections.stats" },
  { slug: "sections.status-list" },
  { slug: "sections.usage" },
  { slug: "sections.account-summary" },
  { slug: "sections.data-table" },
  { slug: "sections.data-grid" },
  { slug: "sections.record-detail" },
  { slug: "sections.activity-feed" },
  { slug: "sections.audit-log" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("designer-sections.organize", slug))) notFound();
  return createElement(PublishedPage, { page: "designer-sections.organize", slug });
}
