// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "frames.site-shell" },
  { slug: "frames.document" },
  { slug: "frames.app-shell" },
  { slug: "frames.auth-shell" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("designer-frames.page-shells", slug))) notFound();
  return createElement(PublishedPage, { page: "designer-frames.page-shells", slug });
}
