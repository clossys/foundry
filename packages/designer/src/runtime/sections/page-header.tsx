import { PageHeader } from "../../blocks/PageHeader.js";
import { Breadcrumb } from "../../components/Breadcrumb.js";
import { Button } from "../../components/Button.js";
import { editorialMetadata } from "./page-header-metadata.js";
import { actionsOf, noop, recordsOf, refuseUnmapped, requiredText, slotValue, stringField, textOf, type SectionInputs, type SectionRenderer } from "./group-c-content.js";

const LEAF = "sections.page-header";

/**
 * title, description -> PageHeader copy; breadcrumbs -> PageHeader.breadcrumb (a registered Breadcrumb trail);
 * actions -> PageHeader.actions (Buttons); meta carries Writer-owned editorial data.
 * Article and case-study are selected through the section configuration channel.
 */
export const pageHeaderInputs: SectionInputs = {
  slots: ["title", "description", "breadcrumbs", "actions", "meta"],
  members: [],
  unmapped: { members: ["config.standard", "config.record"] },
};

export const renderPageHeader: SectionRenderer = input => {
  refuseUnmapped(input, pageHeaderInputs);
  const title = requiredText(input, LEAF, "title");
  const config = input.selection.config;
  if (config !== null && config !== "article" && config !== "case-study") throw new TypeError(`${LEAF}: unsupported editorial configuration ${config}`);
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
      config={config ?? undefined}
      meta={editorialMetadata(slotValue(input, "meta"))}
      locale={input.locale}
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
