import { useState } from "react";
import { PageBar, type PageBarPage } from "@clossys/designer/blocks";

const page: PageBarPage = {
  title: "Quarterly report",
  breadcrumb: [
    { id: "projects", label: "Projects", href: "/projects" },
    { id: "reporting", label: "Reporting", href: "/projects/reporting",
      siblings: [{ id: "planning", label: "Planning", href: "/projects/planning" }] },
    { id: "quarterly", label: "Quarterly report",
      siblings: [{ id: "annual", label: "Annual report", href: "/projects/reporting/annual" }] },
  ],
  status: "Draft", description: "Revenue and usage for the last three months.", updatedAt: "Updated 2 hours ago",
  actions: [
    { id: "share", label: "Share", primary: true, onAction: () => {} },
    { id: "export", label: "Export", href: "/projects/reporting/quarterly/export" },
    { id: "archive", label: "Archive", onAction: () => {} },
  ],
};

export function ReportBar() {
  const [width, setWidth] = useState<"contained" | "full">("contained");
  return <PageBar root={{ label: "Workspace", href: "/" }} page={page} width={width} onWidthChange={setWidth}
    workspaces={[{ id: "operations", label: "Operations", href: "/operations" }, { id: "research", label: "Research", href: "/research" }]}
    labels={{ breadcrumb: "Breadcrumb", collapsedBreadcrumb: "More breadcrumb levels", pageInfo: "Page information",
      fullWidth: "Use full width", containedWidth: "Use contained width", pageActions: "More page actions" }} />;
}

export default ReportBar;
