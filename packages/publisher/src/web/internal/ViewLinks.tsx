import { useId, type ReactElement } from "react";
import { Item, Items, SectionHeader } from "@clossys/designer/blocks/server";
import type { ItemData } from "@clossys/designer/blocks/server";

/** Caller-owned heading and destinations for a quiet view-level link collection. */
export interface ViewLinksInput {
  label: string;
  items: readonly (ItemData & { href: string })[];
}

const MESSAGES = {
  StatusView: {
    array: "StatusView: routes must provide an item array.",
    label: "StatusView: routes need a nonblank label.",
    count: "StatusView: routes allow at most six linked items.",
    dense: "StatusView: routes need a dense item array.",
    destination: "StatusView: every route needs a destination.",
  },
  LegalView: {
    array: "LegalView: related must provide an item array.",
    label: "LegalView: related needs a nonblank label.",
    count: "LegalView: related allows at most six linked items.",
    dense: "LegalView: related needs a dense item array.",
    destination: "LegalView: every related item needs a destination.",
  },
} as const;

/** Keep collection-specific bounds here; Item and Items own content and link validation. */
export function renderViewLinks(value: ViewLinksInput | undefined, owner: keyof typeof MESSAGES): ReactElement | null {
  if (value === undefined) return null;
  const messages = MESSAGES[owner];
  if (!value || typeof value !== "object" || !Array.isArray(value.items)) throw new TypeError(messages.array);
  if (value.items.length === 0) return null;
  if (typeof value.label !== "string" || value.label.trim().length === 0) throw new TypeError(messages.label);
  if (value.items.length > 6) throw new RangeError(messages.count);
  for (let index = 0; index < value.items.length; index++) {
    if (!Object.hasOwn(value.items, index)) throw new TypeError(messages.dense);
    const item = value.items[index];
    if (!item || typeof item !== "object" || typeof item.href !== "string") throw new TypeError(messages.destination);
  }
  return <ViewLinksSection value={value} />;
}

/** Allocate the label reference only for a rendered collection; omitted-view bytes stay unchanged. */
function ViewLinksSection({ value }: { value: ViewLinksInput }): ReactElement {
  const headingId = useId();
  return <section aria-labelledby={headingId} className="flex flex-col gap-lg">
    <SectionHeader id={headingId} level={2} density="compact" title={value.label} />
    {value.items.length === 1
      ? <Item {...value.items[0]!} treatment="plain" size="standard" ground="base" headingLevel={3} />
      : <Items items={value.items} arrangement="rows" columns={1} treatment="plain" size="standard" scale="item" ground="base" headingLevel={3} />}
  </section>;
}
