// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "passages.cards" },
  { slug: "passages.resource-list" },
  { slug: "passages.task-list" },
  { slug: "passages.comparison" },
  { slug: "passages.pricing" },
  { slug: "passages.stats" },
  { slug: "passages.status-list" },
  { slug: "passages.usage" },
  { slug: "passages.account-summary" },
  { slug: "passages.data-table" },
  { slug: "passages.data-grid" },
  { slug: "passages.record-detail" },
  { slug: "passages.activity-feed" },
  { slug: "passages.audit-log" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("writer-passages.organize", slug))) notFound();
  return createElement(PublishedPage, { page: "writer-passages.organize", slug });
}
