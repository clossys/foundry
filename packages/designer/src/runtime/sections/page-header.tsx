import { PageHeader } from "../../blocks/PageHeader.js";

import { actionsOf, noop, recordsOf, refuseUnmapped, requiredText, slotValue, stringField, textOf, type SectionInputs, type SectionRenderer } from "./group-c-content.js";
import { componentLeaf } from "../component-leaf.js";

type StockBreadcrumb = typeof import("../../components/preview-runtime/components/breadcrumbs/breadcrumb.js");
/** Stock anatomy (E2): the selected breadcrumb's own parts, never a Foundry `Breadcrumb.Item` compound. */
const Breadcrumb = componentLeaf<StockBreadcrumb["Breadcrumb"]>("components.breadcrumbs");
const BreadcrumbList = componentLeaf<StockBreadcrumb["BreadcrumbList"]>("components.breadcrumbs", "BreadcrumbList");
const BreadcrumbItem = componentLeaf<StockBreadcrumb["BreadcrumbItem"]>("components.breadcrumbs", "BreadcrumbItem");
const BreadcrumbLink = componentLeaf<StockBreadcrumb["BreadcrumbLink"]>("components.breadcrumbs", "BreadcrumbLink");
const BreadcrumbPage = componentLeaf<StockBreadcrumb["BreadcrumbPage"]>("components.breadcrumbs", "BreadcrumbPage");
const Button = componentLeaf<import("../component-leaf.js").ButtonLeaf>("components.button");

const LEAF = "sections.page-header";

/**
 * title, description -> PageHeader copy; breadcrumbs -> PageHeader.breadcrumb (a registered Breadcrumb trail);
 * actions -> PageHeader.actions (Buttons). The meta slot and the standard/record configurations have no
 * PageHeader API.
 */
export const pageHeaderInputs: SectionInputs = {
  slots: ["title", "description", "breadcrumbs", "actions"],
  members: [],
  unmapped: { slots: ["meta"], members: ["config.standard", "config.record"] },
};

export const renderPageHeader: SectionRenderer = input => {
  refuseUnmapped(input, pageHeaderInputs);
  const title = requiredText(input, LEAF, "title");
  const trail = slotValue(input, "breadcrumbs");
  const crumbs = recordsOf(LEAF, "breadcrumbs", trail).map((row, index) => {
    const id = stringField(row, "id") ?? `crumb-${index}`, label = stringField(row, "label");
    if (!label) throw new TypeError(`${LEAF}: breadcrumb ${index} needs a label`);
    return { id, label, href: stringField(row, "href") };
  });
  const actions = actionsOf(LEAF, "actions", slotValue(input, "actions"), 2).map((action, index) => {
    if (action.href) throw new TypeError(`${LEAF}: action ${action.label} has an href, but the contract allows Buttons only (NEED: components.link)`);
    return <Button key={action.id} variant={index === 0 ? "primary" : "secondary"} onPress={noop}>{action.label}</Button>;
  });
  return (
    <PageHeader
      title={title}
      description={textOf(slotValue(input, "description"))}
      breadcrumb={crumbs.length ? (
        <Breadcrumb aria-label={stringField(trail, "label")}>
          <BreadcrumbList>
            {crumbs.map((crumb, index) => <BreadcrumbItem key={crumb.id} id={crumb.id}>
              {crumb.href && index < crumbs.length - 1 ? <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink> : <BreadcrumbPage>{crumb.label}</BreadcrumbPage>}
            </BreadcrumbItem>)}
          </BreadcrumbList>
        </Breadcrumb>
      ) : undefined}
      actions={actions.length ? actions : undefined}
    />
  );
};
