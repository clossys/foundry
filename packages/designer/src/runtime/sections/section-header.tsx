import { SectionHeader } from "../../blocks/SectionHeader.js";
import { Button } from "../../components/Button.js";
import { Link } from "../../components/Link.js";
import { actionsOf, memberOf, noop, refuseUnmapped, requiredText, slotValue, textOf, type SectionInputs, type SectionRenderer } from "./group-c-content.js";

const LEAF = "sections.section-header";
const ALIGNS = ["start", "center"] as const;
const DENSITIES = ["display", "standard", "compact"] as const;

/**
 * eyebrow, heading, description -> SectionHeader copy; actions -> SectionHeader.actions (a link with an href,
 * otherwise a button); align.* -> SectionHeader.align; density.* -> SectionHeader.density.
 */
export const sectionHeaderInputs: SectionInputs = {
  slots: ["eyebrow", "heading", "description", "actions"],
  members: ["align.start", "align.center", "density.display", "density.standard", "density.compact"],
};

export const renderSectionHeader: SectionRenderer = input => {
  refuseUnmapped(input, sectionHeaderInputs);
  const title = requiredText(input, LEAF, "heading");
  const align = memberOf(input, "align"), density = memberOf(input, "density");
  if (align !== undefined && !(ALIGNS as readonly string[]).includes(align)) throw new TypeError(`${LEAF}: align.${align} is not a SectionHeader alignment`);
  if (density !== undefined && !(DENSITIES as readonly string[]).includes(density)) throw new TypeError(`${LEAF}: density.${density} is not a SectionHeader density`);
  const actions = actionsOf(LEAF, "actions", slotValue(input, "actions"), 2).map((action, index) => action.href
    ? <Link key={action.id} href={action.href} variant="standalone">{action.label}</Link>
    : <Button key={action.id} variant={index === 0 ? "primary" : "secondary"} onPress={noop}>{action.label}</Button>);
  return (
    <SectionHeader
      eyebrow={textOf(slotValue(input, "eyebrow"))}
      title={title}
      description={textOf(slotValue(input, "description"))}
      actions={actions.length ? actions : undefined}
      align={align as (typeof ALIGNS)[number] | undefined}
      density={density as (typeof DENSITIES)[number] | undefined}
    />
  );
};
