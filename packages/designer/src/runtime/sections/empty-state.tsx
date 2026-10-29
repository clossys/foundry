import type { ReactNode } from "react";
import { EmptyState } from "../../blocks/EmptyState.js";
import { Button } from "../../selected-components/Button.js";
import { Icon } from "../../selected-components/Icon.js";
import { Link } from "../../selected-components/Link.js";
import * as icons from "../../icons/index.js";
import { actionsOf, anatomyOf, noop, refuseUnmapped, requiredAnatomy, slotValue, stringField, type SectionInputs, type SectionRenderer } from "./group-c-content.js";

const LEAF = "sections.empty-state";
const GLYPHS = icons as unknown as Readonly<Record<string, icons.IconNode | undefined>>;

/**
 * illustration -> EmptyState.icon (a registered glyph by name); actions -> EmptyState.action. The title is
 * anatomy copy no contract slot carries; kind and scope members have no EmptyState API.
 */
export const emptyStateInputs: SectionInputs = {
  slots: ["illustration", "actions"],
  members: [],
  unmapped: { members: ["kind.empty", "kind.no-results", "kind.first-use", "scope.region", "scope.page"] },
};

export const renderEmptyState: SectionRenderer = input => {
  refuseUnmapped(input, emptyStateInputs);
  const title = requiredAnatomy(input, LEAF, "heading");
  const { description } = anatomyOf(input);
  const illustration = slotValue(input, "illustration");
  let icon: ReactNode = null;
  if (illustration !== undefined) {
    const name = stringField(illustration, "icon"), glyph = name ? GLYPHS[name] : undefined;
    if (!glyph) throw new TypeError(`${LEAF}: illustration names no registered glyph (${name ?? "none"})`);
    const label = stringField(illustration, "label");
    icon = label ? <Icon glyph={glyph} label={label} size="lg" /> : <Icon glyph={glyph} decorative size="lg" />;
  }
  const actions = actionsOf(LEAF, "actions", slotValue(input, "actions"), 2).map((action, index) => action.href
    ? <Link key={action.id} href={action.href} variant="standalone">{action.label}</Link>
    : <Button key={action.id} variant={index === 0 ? "primary" : "secondary"} onPress={noop}>{action.label}</Button>);
  return <EmptyState title={title} description={description} icon={icon} action={actions.length ? actions : undefined} />;
};
