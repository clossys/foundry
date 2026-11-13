// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "components.field" },
  { slug: "components.form" },
  { slug: "components.text-field" },
  { slug: "components.search-field" },
  { slug: "components.checkbox" },
  { slug: "components.radio-group" },
  { slug: "components.switch" },
  { slug: "components.select" },
  { slug: "components.combo-box" },
  { slug: "components.toggle-group" },
  { slug: "components.tag-group" },
  { slug: "components.number-field" },
  { slug: "components.slider" },
  { slug: "components.date-field" },
  { slug: "components.date-picker" },
  { slug: "components.calendar" },
  { slug: "components.color-picker" },
  { slug: "components.file-trigger" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("designer-components.inputs", slug))) notFound();
  return createElement(PublishedPage, { page: "designer-components.inputs", slug });
}
