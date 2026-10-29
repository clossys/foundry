import { SectionHeader } from "../../blocks/SectionHeader.js";
import { Badge } from "../../components/Badge.js";
import { StatusMark, type StatusMarkTone } from "../../components/StatusMark.js";
import { Menu } from "../../components/Menu.js";
import { Button } from "../../components/Button.js";
import { Link } from "../../components/Link.js";
import { actionsOf, memberOf, noop, refuseUnmapped, requiredText, recordsOf, stringField, slotValue, textOf, type SectionInputs, type SectionRenderer } from "./group-c-content.js";

const LEAF = "sections.section-header";
const ALIGNS = ["start", "center"] as const;
const DENSITIES = ["display", "standard", "compact"] as const;

/**
 * eyebrow, heading, description -> SectionHeader copy; actions -> SectionHeader.actions (a link with an href,
 * otherwise a button); align.* -> SectionHeader.align; density.* -> SectionHeader.density.
 */
export const sectionHeaderInputs: SectionInputs = {
  slots: ["eyebrow", "heading", "description", "actions", "stats"],
  members: ["align.start", "align.center", "density.display", "density.standard", "density.compact"],
};

export const renderSectionHeader: SectionRenderer = input => {
  refuseUnmapped(input, sectionHeaderInputs);
  const title = requiredText(input, LEAF, "heading");
  const align = memberOf(input, "align"), density = memberOf(input, "density");
  if (align !== undefined && !(ALIGNS as readonly string[]).includes(align)) throw new TypeError(`${LEAF}: align.${align} is not a SectionHeader alignment`);
  if (density !== undefined && !(DENSITIES as readonly string[]).includes(density)) throw new TypeError(`${LEAF}: density.${density} is not a SectionHeader density`);
  const selectedLevel = input.selection.config;
  const level = selectedLevel === null ? 2 : /^level-[2-6]$/.test(selectedLevel) ? Number(selectedLevel.slice(-1)) as 2 | 3 | 4 | 5 | 6 : (() => { throw new TypeError(`${LEAF}: unsupported level configuration ${selectedLevel}`); })();
  const stats = recordsOf(LEAF, "stats", slotValue(input, "stats")).map((row, index) => {
    const label = stringField(row, "label");
    if (!label) throw new TypeError(`${LEAF}: stat ${index} needs a resolved label`);
    const tone = stringField(row, "tone");
    if (tone && !["neutral", "info", "success", "warning", "danger"].includes(tone)) throw new TypeError(`${LEAF}: invalid stat tone`);
    return <Badge key={stringField(row, "id") ?? index}>{tone ? <StatusMark tone={tone as StatusMarkTone}>{label}</StatusMark> : label}</Badge>;
  });
  const allActions = actionsOf(LEAF, "actions", slotValue(input, "actions"));
  const overflow = allActions.slice(2);
  const overflowLabel = input.sectionHost?.overflowLabel;
  if (overflow.length && typeof overflowLabel !== "string") throw new TypeError(`${LEAF}: overflowLabel is required for more than two actions`);
  const actions = allActions.slice(0, 2).map((action, index) => action.href
    ? <Link key={action.id} href={action.href} variant="standalone">{action.label}</Link>
    : <Button key={action.id} variant={index === 0 ? "primary" : "secondary"} onPress={() => { const handler = input.sectionHost?.onAction; if (typeof handler === "function") handler(action.id); else noop(); }}>{action.label}</Button>);
  return (
    <SectionHeader
      level={level}
      id={stringField(slotValue(input, "heading"), "id")}
      stats={stats.length ? stats : undefined}
      eyebrow={textOf(slotValue(input, "eyebrow"))}
      title={title}
      description={textOf(slotValue(input, "description"))}
      actions={actions.length ? <>{actions}{overflow.length ? <Menu trigger={<Button variant="secondary">{overflowLabel as string}</Button>}>{overflow.map(action => <Menu.Item key={action.id} id={action.id} href={action.href} onAction={() => { const handler = input.sectionHost?.onAction; if (typeof handler === "function") handler(action.id); }}>{action.label}</Menu.Item>)}</Menu> : null}</> : undefined}
      align={align as (typeof ALIGNS)[number] | undefined}
      density={density as (typeof DENSITIES)[number] | undefined}
    />
  );
};
