import { TableOfContents, type TableOfContentsItem } from "@clossys/designer/blocks";

const headings: readonly TableOfContentsItem[] = [
  { id: "overview", label: "Overview" },
  { id: "planning", label: "Planning" },
  { id: "budget", label: "Budget", level: 3 },
  { id: "schedule", label: "Schedule", level: 3 },
  { id: "review", label: "Review" },
  { id: "next-steps", label: "Next steps" },
];

function SidebarContents() {
  return <TableOfContents label="On this page" items={headings} />;
}

function InlineContents() {
  return <TableOfContents label="On this page" items={headings} presentation="inline" />;
}

export default function Example() { return <><SidebarContents /><InlineContents /></>; }
