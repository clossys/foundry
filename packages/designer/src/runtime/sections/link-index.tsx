import { NavGrid } from "../../blocks/NavGrid.js";
import type { NavGridItem } from "../../blocks/NavGrid.js";
import { Icon } from "../../components/Icon.js";
import * as icons from "../../icons/index.js";
import { anatomyOf, noop, recordsOf, refuseUnmapped, requireSlot, stringField, type SectionInputs, type SectionRenderer } from "./group-c-content.js";

const LEAF = "sections.link-index";
const GLYPHS = icons as unknown as Readonly<Record<string, icons.IconNode | undefined>>;

/**
 * links -> NavGrid.items (each a linked card, or an action card without an href); layout.cards is NavGrid's
 * only layout. The list and plain-grid layouts have no NavGrid API.
 */
export const linkIndexInputs: SectionInputs = { slots: ["links"], members: ["layout.cards"], unmapped: { members: ["layout.list", "layout.grid"] } };

export const renderLinkIndex: SectionRenderer = input => {
  refuseUnmapped(input, linkIndexInputs);
  const config = input.selection.config;
  if (config !== null && config !== "roles") throw new TypeError(`${LEAF}: unsupported configuration ${config}`);
  const items = recordsOf(LEAF, "links", requireSlot(input, LEAF, "links")).map((row, index): NavGridItem => {
    const id = stringField(row, "id"), title = stringField(row, "title") ?? stringField(row, "label");
    if (!id || !title) throw new TypeError(`${LEAF}: link ${index} needs an id and a title`);
    const description = stringField(row, "description"), href = stringField(row, "href"), glyphName = stringField(row, "icon");
    const glyph = glyphName ? GLYPHS[glyphName] : undefined;
    if (glyphName && !glyph) throw new TypeError(`${LEAF}: link ${id} names no registered glyph (${glyphName})`);
    const icon = glyph ? <Icon glyph={glyph} decorative /> : undefined;
    const details = recordsOf(LEAF, "links.details", row.details).map((detail, detailIndex) => {
      const label = stringField(detail, "label"), value = stringField(detail, "value");
      if (!label || !value) throw new TypeError(`${LEAF}: role detail requires Writer label and value`);
      return { id: stringField(detail, "id") ?? `${id}-${detailIndex}`, label, value };
    });
    if (config === "roles" && !href) throw new TypeError(`${LEAF}: role ${id} requires a destination`);
    const base = { id, title, ...(description ? { description } : {}), ...(icon ? { icon } : {}), details };
    return href ? { ...base, href } : { ...base, onSelect: noop };
  });
  const { heading } = anatomyOf(input);
  return <NavGrid heading={heading} items={items} config={config ?? undefined} />;
};
