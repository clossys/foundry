/**
 * Fixed sample content for Section blocks, used by board previews of planned
 * Sections defaults. Sample copy only: no network images, no live data, and
 * no claim about any consumer's content.
 */
import type { ReactNode } from "react";
import { Button } from "../components/Button.js";
import { Link } from "../components/Link.js";
import { CallToAction } from "./CallToAction.js";
import { RecordCards } from "./RecordCards.js";
import { ConsentBanner } from "./ConsentBanner.js";
import { DataTable } from "./DataTable.js";
import { ErrorState } from "./ErrorState.js";
import { Gallery } from "./Gallery.js";
import { NoticeList } from "./NoticeList.js";
import { StatGroup } from "./StatGroup.js";

const noop = () => {};
const frame = (label: string): ReactNode => (
  <svg role="img" aria-label={label} viewBox="0 0 16 10" width="100%"><rect width="16" height="10" fill="currentColor" opacity="0.12" /></svg>
);
interface OrderRow { id: string; customer: string; status: string; total: string }
const ORDERS: readonly OrderRow[] = [
  { id: "1042", customer: "Northwind", status: "Shipped", total: "$1,280.00" },
  { id: "1043", customer: "Contoso", status: "Processing", total: "$640.00" },
  { id: "1044", customer: "Fabrikam", status: "Delivered", total: "$2,015.50" },
];

/** Sample renderers by blocks export name. */
export const SECTION_BLOCK_SAMPLES: Readonly<Record<string, () => ReactNode>> = {
  CallToAction: () => <CallToAction eyebrow="Get started" title="Ship your next launch with one library" description="Start free. Invite your team when you are ready." primaryAction={<Link href="#start" buttonVariant="primary">Start free</Link>} secondaryAction={<Link href="#sales" buttonVariant="secondary">Talk to sales</Link>} />,
  RecordCards: () => <RecordCards records={[
    { id: "brand", title: "Brand refresh", description: "New marks, colour and type for the spring launch.", href: "#brand", badge: { label: "Active", variant: "success" }, meta: "Updated 2 days ago" },
    { id: "docs", title: "Docs site", description: "Guides and reference for the public API.", href: "#docs", badge: { label: "Review", variant: "warning" }, meta: "Updated today" },
    { id: "billing", title: "Billing portal", description: "Self-serve plans and invoices.", href: "#billing", meta: "Updated last week" },
  ]} />,
  ConsentBanner: () => <ConsentBanner title="Cookies on this site" body="We use analytics cookies to understand how the site is used. You can change your choice at any time." acceptLabel="Accept analytics" rejectLabel="Reject analytics" onAccept={noop} onReject={noop} privacyLink={<Link href="#privacy">Privacy policy</Link>} />,
  DataTable: () => <DataTable<OrderRow> aria-label="Orders" rows={ORDERS} rowKey={row => row.id} columns={[
    { id: "id", header: "Order", cell: row => row.id, isRowHeader: true, format: "id" },
    { id: "customer", header: "Customer", cell: row => row.customer },
    { id: "status", header: "Status", cell: row => row.status },
    { id: "total", header: "Total", cell: row => row.total },
  ]} />,
  ErrorState: () => <ErrorState kind="failure" code="Error 503" title="This page did not load" description="The service is busy. Your work is saved; try again in a moment." retry={<Button variant="primary" size="md" onPress={noop}>Try again</Button>} report={<Link href="#status">Check service status</Link>} />,
  Gallery: () => <Gallery label="Workspace screens" labels={{ close: "Close image", enlarge: "Enlarge image" }} images={[
    { id: "overview", label: "Workspace overview", media: frame("Workspace overview"), caption: "Overview" },
    { id: "editor", label: "Page editor", media: frame("Page editor"), caption: "Editor" },
    { id: "library", label: "Component library", media: frame("Component library"), caption: "Library" },
  ]} />,
  NoticeList: () => <NoticeList label="Account notices" onDismiss={noop} notices={[
    { id: "trial", tone: "warning", title: "Trial ends in 3 days.", message: "Choose a plan to keep your projects.", action: <Link href="#plans">See plans</Link> },
    { id: "export", tone: "success", message: "Your export is ready to download." },
    { id: "maintenance", tone: "info", title: "Scheduled maintenance.", message: "Saving is paused on Sunday from 02:00 to 02:30 UTC.", dismissible: false },
  ]} />,
  StatGroup: () => <StatGroup items={[
    { id: "active", label: "Active users", value: "2,481", delta: "+12%", trend: "up", description: "vs. last 30 days" },
    { id: "conversion", label: "Conversion", value: "3.4%", delta: "-0.2 pts", trend: "down", description: "vs. last 30 days" },
    { id: "revenue", label: "Revenue", value: "$48.2k", delta: "+4%", trend: "up", description: "vs. last 30 days" },
    { id: "churn", label: "Churn", value: "1.1%", delta: "0 pts", trend: "neutral", description: "vs. last 30 days" },
  ]} />,
};
