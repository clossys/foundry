import { PageHeader } from "../../blocks/PageHeader.js";

import { actionsOf, noop, recordsOf, refuseUnmapped, requiredText, slotValue, stringField, textOf, type SectionInputs, type SectionRenderer } from "./group-c-content.js";
import { componentLeaf } from "../component-leaf.js";

const Breadcrumb = componentLeaf<typeof import("../../components/Breadcrumb.js").Breadcrumb>("components.breadcrumbs");
const Button = componentLeaf<typeof import("../../components/Button.js").Button>("components.button");

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
          {crumbs.map(crumb => <Breadcrumb.Item key={crumb.id} href={crumb.href}>{crumb.label}</Breadcrumb.Item>)}
        </Breadcrumb>
      ) : undefined}
      actions={actions.length ? actions : undefined}
    />
  );
};
