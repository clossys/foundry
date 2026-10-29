import { SectionHeader } from "../../blocks/SectionHeader.js";
import { Badge } from "../../selected-components/Badge.js";
import { StatusMark, type StatusMarkTone } from "../../selected-components/StatusMark.js";
import { Menu } from "../../selected-components/Menu.js";
import { Button } from "../../selected-components/Button.js";
import { Link } from "../../selected-components/Link.js";
import { actionsOf, memberOf, noop, refuseUnmapped, requiredText, recordsOf, stringField, isObject, slotValue, textOf, type SectionInputs, type SectionRenderer } from "./group-c-content.js";

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
  const level = selectedLevel === null || selectedLevel === "default" ? 2 : /^level-[2-6]$/.test(selectedLevel) ? Number(selectedLevel.slice(-1)) as 2 | 3 | 4 | 5 | 6 : (() => { throw new TypeError(`${LEAF}: unsupported level configuration ${selectedLevel}`); })();
  const stats = recordsOf(LEAF, "stats", slotValue(input, "stats")).map((row, index) => {
    const label = stringField(row, "label");
    if (!label) throw new TypeError(`${LEAF}: stat ${index} needs a resolved label`);
    const tone = stringField(row, "tone");
    if (tone && !["neutral", "info", "success", "warning", "danger"].includes(tone)) throw new TypeError(`${LEAF}: invalid stat tone`);
    return <Badge key={stringField(row, "id") ?? index}>{tone ? <StatusMark tone={tone as StatusMarkTone}>{label}</StatusMark> : label}</Badge>;
  });
  const actionValue = slotValue(input, "actions");
  const rawActions = Array.isArray(actionValue) ? actionValue : actionValue === undefined ? [] : [actionValue];
  const actions = actionsOf(LEAF, "actions", actionValue, 2).map((action, index) => {
    const raw = rawActions[index];
    const items = isObject(raw) ? raw.items : undefined;
    if (items !== undefined) return <Menu key={action.id} trigger={<Button variant="secondary">{action.label}</Button>}>{actionsOf(LEAF, "actions.items", items).map(item => <Menu.Item key={item.id} id={item.id} href={item.href} onAction={() => { const handler = input.sectionHost?.onAction; if (typeof handler === "function") handler(item.id); }}>{item.label}</Menu.Item>)}</Menu>;
    return action.href
      ? <Link key={action.id} href={action.href} variant="standalone">{action.label}</Link>
      : <Button key={action.id} variant={index === 0 ? "primary" : "secondary"} onPress={() => { const handler = input.sectionHost?.onAction; if (typeof handler === "function") handler(action.id); else noop(); }}>{action.label}</Button>;
  });
  return (
    <SectionHeader
      level={level}
      id={stringField(slotValue(input, "heading"), "id")}
      stats={stats.length ? stats : undefined}
      eyebrow={textOf(slotValue(input, "eyebrow"))}
      title={title}
      description={textOf(slotValue(input, "description"))}
      actions={actions.length ? actions : undefined}
      align={align as (typeof ALIGNS)[number] | undefined}
      density={density as (typeof DENSITIES)[number] | undefined}
    />
  );
};
