import { Children, isValidElement, type ReactNode } from "react";
import type { ItemData, ItemSpan, ItemsProps } from "./types.js";

/** Own keys only: inherited Object names are never span values. */
export const ITEM_SPAN_UNITS: Readonly<Record<ItemSpan, number>> = { third: 4, half: 6, "two-thirds": 8, full: 12 };

/** Shared ordered-row policy; the caller supplies its existing diagnostic vocabulary. */
export function assertOrderedRows(spans: readonly ItemSpan[], messages: { count: (n: number) => string; unknown: (i: number, span: unknown) => string; overflow: (i: number) => string; incomplete: string }): void {
  if (spans.length < 2 || spans.length > 6) throw new RangeError(messages.count(spans.length));
  let filled = 0;
  spans.forEach((span, index) => {
    if (typeof span !== "string" || !Object.hasOwn(ITEM_SPAN_UNITS, span)) throw new RangeError(messages.unknown(index, span));
    filled += ITEM_SPAN_UNITS[span];
    if (filled > 12) throw new RangeError(messages.overflow(index));
    if (filled === 12) filled = 0;
  });
  if (filled !== 0) throw new RangeError(messages.incomplete);
}

/** The existing card geometry at tablet: only a third stranded in a row expands. */
const TABLET_UNITS: Readonly<Record<ItemSpan, number>> = { third: 6, half: 6, "two-thirds": 12, full: 12 };
export function loneTabletThirds(spans: readonly ItemSpan[]): boolean[] {
  const lone = spans.map(() => false);
  let index = 0;
  while (index < spans.length) {
    const span = spans[index]!;
    const next = spans[index + 1];
    if (TABLET_UNITS[span] === 6 && (next === undefined || TABLET_UNITS[next] === 12)) {
      lone[index] = span === "third";
      index += 1;
    } else index += TABLET_UNITS[span] === 6 ? 2 : 1;
  }
  return lone;
}
const LEAF_CONTENT_TAGS = new Set(["img", "svg", "canvas", "audio", "video", "iframe", "object", "embed", "input", "meter", "progress", "hr"]);

/** Empty optional copy is omitted; authored numeric zero remains content. Opaque component output is not inspected. */
export function hasContent(node: ReactNode): boolean {
  return Children.toArray(node).some((child) => {
    if (typeof child === "string") return child.trim().length > 0;
    if (isValidElement(child)) {
      const props = child.props as { children?: ReactNode };
      if (typeof child.type === "string") return LEAF_CONTENT_TAGS.has(child.type) || hasContent(props.children);
      return typeof child.type !== "symbol" || hasContent(props.children);
    }
    return true;
  });
}
const CONTROL_TAGS = new Set(["a", "button", "input", "select", "textarea", "summary", "details", "label", "iframe", "object", "embed"]);
const PHRASING_TAGS = new Set(["abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "del", "dfn", "em", "i", "img", "ins", "kbd", "mark", "picture", "q", "ruby", "rp", "rt", "s", "samp", "small", "source", "span", "strong", "sub", "sup", "time", "u", "var", "wbr", "svg", "g", "path", "circle", "ellipse", "line", "polyline", "polygon", "rect", "text", "tspan", "defs", "symbol", "use", "clippath", "mask", "pattern", "lineargradient", "radialgradient", "stop", "filter", "fegaussianblur", "fecolormatrix", "feoffset", "feblend", "fecomposite", "femerge", "femergenode", "title", "desc", "foreignobject", "math", "mrow", "mi", "mo", "mn", "ms", "mtext", "msub", "msup", "msubsup", "mfrac", "msqrt", "mroot", "mstyle", "mpadded", "mphantom", "mfenced", "menclose", "semantics", "annotation"]);
const TRIGGER_CONTROL_ROLES = new Set(["button", "link", "checkbox", "radio", "switch", "textbox", "combobox", "listbox", "option", "menuitem", "menuitemcheckbox", "menuitemradio", "slider", "spinbutton", "tab", "treeitem"]);
function invalidTrigger(node: ReactNode): boolean {
  return invalidTriggerIn(node, false);
}
function invalidTriggerIn(node: ReactNode, inSvg: boolean): boolean {
  return Children.toArray(node).some(child => {
    if (!isValidElement(child)) return false;
    const props = child.props as Record<string, unknown>;
    const native = typeof child.type === "string" ? child.type.toLowerCase() : undefined;
    const editable = props.contentEditable === true || (typeof props.contentEditable === "string" && ["", "true", "plaintext-only"].includes(props.contentEditable.toLowerCase()));
    const focusable = (typeof props.tabIndex === "number" && Number.isFinite(props.tabIndex)) || (typeof props.tabIndex === "string" && props.tabIndex.trim() !== "" && Number.isFinite(Number(props.tabIndex)));
    const svg = native === "svg" || inSvg;
    const resource = svg && (native === "use" || native === "image");
    return (native !== undefined && !PHRASING_TAGS.has(native) && !(native === "image" && svg)) || editable || focusable || (typeof props.role === "string" && props.role.split(/\s+/).some(role => TRIGGER_CONTROL_ROLES.has(role))) || (props.href !== undefined && !resource) || props.onClick !== undefined || props.onPress !== undefined || invalidTriggerIn(props.children as ReactNode, native === "foreignobject" ? false : svg);
  });
}
function hasControl(node: ReactNode): boolean {
  return hasControlIn(node, false);
}
function hasControlIn(node: ReactNode, inSvg: boolean): boolean {
  return Children.toArray(node).some((child) => {
    if (!isValidElement(child)) return false;
    const props = child.props as Record<string, unknown>;
    const native = typeof child.type === "string";
    const editable = props.contentEditable === true || (typeof props.contentEditable === "string" && ["", "true", "plaintext-only"].includes(props.contentEditable.toLowerCase()));
    const focusable = (typeof props.tabIndex === "number" && Number.isFinite(props.tabIndex)) || (typeof props.tabIndex === "string" && props.tabIndex.trim() !== "" && Number.isFinite(Number(props.tabIndex)));
    const media = (child.type === "audio" || child.type === "video") && Boolean(props.controls);
    const tag = native ? (child.type as string).toLowerCase() : undefined;
    const svg = tag === "svg" || inSvg;
    const resource = svg && (tag === "use" || tag === "image");
    return (native && (CONTROL_TAGS.has(child.type as string) || editable || focusable || media)) || (props.href !== undefined && !resource) || props.onClick !== undefined || props.onPress !== undefined || hasControlIn(props.children as ReactNode, tag === "foreignobject" ? false : svg);
  });
}
/** The public item guard reads supplied elements recursively, without executing opaque components. */
export function assertItemData(item: ItemData): void {
  if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id.trim() || !hasContent(item.heading)) throw new TypeError("Item: a stable id and nonblank heading are required.");
  if ((item as ItemData & { featured?: unknown }).featured !== undefined) throw new TypeError("Item: featured is retired; select the collection's treatment instead.");
  if (item.badge !== undefined && (!item.badge || !hasContent(item.badge.label) || (item.badge.tone !== undefined && !["neutral", "success", "warning", "danger", "info"].includes(item.badge.tone)))) throw new TypeError("Item: badge needs a label and an existing Badge tone.");
  if (item.figure !== undefined) {
    const figure = item.figure;
    if (!figure || !hasContent(figure.value) || (figure.trend !== undefined && (!hasContent(figure.delta) || !["up", "down", "neutral"].includes(figure.trend)))) throw new TypeError("Item: figure needs a value; trend needs a delta and an existing direction.");
    if (item.visual !== undefined) throw new TypeError("Item: figure and visual cannot share an item.");
  }
  if (item.status !== undefined) {
    if (!item.status || !hasContent(item.status.label) || !["success", "warning", "danger", "info", "neutral"].includes(item.status.tone)) throw new TypeError("Item: status needs a visible label and an existing StatusMark tone.");
    if (item.badge !== undefined) throw new TypeError("Item: status and badge cannot share an item.");
  }
  if (item.href !== undefined) {
    if (!isSanctionedHref(item.href)) throw new TypeError("Item: href must be an anchor, one-origin path, HTTP(S) URL or explicit mail link.");
    if ([item.heading, item.description, item.eyebrow, item.icon, item.meta, item.visual, item.badge?.label, item.figure?.value, item.figure?.delta, item.status?.label].some(hasControl)) throw new TypeError(`Item: linked item "${item.id}" cannot contain another interactive target.`);
  }
}
/** Mirrors the package's server-view route boundary, without importing another package. */
function isSanctionedHref(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value) || value.includes("\\")) return false;
  if (value.startsWith("#")) return true;
  if (value.startsWith("/")) return !value.startsWith("//");
  if (value.toLowerCase().startsWith("mailto:")) return value.slice(7).trim().length > 0;
  try { const url = new URL(value); return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password; } catch { return false; }
}
function normalizedDestination(href: string): string {
  const hash = href.indexOf("#");
  const base = hash > 0 ? href.slice(0, hash) : href;
  return base.length > 1 && base.endsWith("/") ? base.slice(0, -1) : base;
}
export function assertItemAxes(treatment: unknown, size: unknown, ground: unknown): void {
  if (!["plain", "rule", "plate"].includes(treatment as string) || !["standard", "display"].includes(size as string) || !["base", "sunken", "inverse"].includes(ground as string)) throw new TypeError("Item: unknown treatment, size or ground.");
}
/** Private collection anatomy; ordered and disclosure behavior take precedence over shape. */
export function collectionProfile(props: ItemsProps): "sequence" | "index" | "explain" {
  if (props.order !== undefined && props.order !== "none") return "sequence";
  if (props.reveal === "disclose" || props.arrangement === "rows") return "index";
  return "explain";
}
/** Only the existing row/plate axes admit a third tile column. Other row contracts stay unchanged. */
function admitsThreeColumnTiles(props: ItemsProps): boolean {
  return props.arrangement === "rows" && props.treatment === "plate" &&
    (props.order === undefined || props.order === "none") &&
    (props.reveal === undefined || props.reveal === "all") && props.groups === undefined &&
    props.items.every(item => item.href !== undefined);
}
export function assertItems(props: ItemsProps): number | undefined {
  if (Object.hasOwn(props, "emphasis")) throw new TypeError("Items: emphasis is retired; use scale instead.");
  const { items, arrangement, groups, scale = "item", treatment = "plain", size = "standard", ground = "base", order = "none", reveal = "all" } = props;
  assertItemAxes(treatment, size, ground);
  if (!["none", "numbered", "connected"].includes(order) || !["all", "disclose"].includes(reveal)) throw new TypeError("Items: unknown order or reveal.");
  if (order !== "connected" && [props.lanes, props.end, props.endLabel, props.caption].some(value => value !== undefined)) throw new TypeError("Items: lanes, end and caption belong to connected order.");
  if (props.end !== undefined && props.end !== "ends" && props.end !== "continues") throw new TypeError("Items: unknown end.");
  if (!["columns", "rows", "bento", "stacked"].includes(arrangement) || !["item", "statement"].includes(scale) || (props.headingLevel !== undefined && props.headingLevel !== 3 && props.headingLevel !== 4)) throw new TypeError("Items: unknown arrangement, scale or heading level.");
  if (!Array.isArray(items)) throw new TypeError("Items: items must be an array.");
  const ids = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    if (!Object.hasOwn(items, i)) throw new TypeError("Items: items must be a dense array.");
    const item = items[i]!; assertItemData(item);
    if (ids.has(item.id)) throw new TypeError("Items: item ids must be unique."); ids.add(item.id);
  }
  const columns = props.columns === undefined ? (arrangement === "columns" ? 3 : arrangement === "rows" ? 1 : undefined) : props.columns;
  if ((arrangement === "bento" || arrangement === "stacked") && props.columns !== undefined) throw new TypeError("Items: bento and stacked do not take columns.");
  const count = items.length;
  const figures = items.filter(item => item.figure !== undefined).length;
  if (figures !== 0 && figures !== count) throw new TypeError("Items: every item must carry a figure or none may carry one.");
  if (figures && (arrangement === "bento" || scale === "statement" || reveal === "disclose")) throw new TypeError("Items: figure belongs to columns, rows or stacked without statement or disclosure.");
  if (scale === "statement" && items.some(item => item.status !== undefined)) throw new TypeError("Items: status does not belong to statement collections.");
  if (order === "connected") {
    if ((arrangement !== "columns" && arrangement !== "stacked") || count < 3 || count > 5 || (arrangement === "columns" && columns !== 2 && columns !== 3)) throw new RangeError("Items: connected order needs columns or stacked with 3-5 steps.");
    if (count === 4 && props.lanes === undefined) console.warn("Items: connected sequences read best with three or five steps.");
    if (hasContent(props.caption) && !items.some(item => hasContent(item.visual))) throw new TypeError("Items: a connected caption requires a visual.");
  }
  if (arrangement === "columns" && order !== "connected" && !((columns === 2 && [2, 4, 6].includes(count)) || (columns === 3 && [3, 6].includes(count)))) throw new RangeError("Items: columns need two columns with 2/4/6 items or three columns with 3/6 items.");
  if (arrangement === "rows" && columns === 3) {
    if (!admitsThreeColumnTiles(props) || ![3, 6].includes(count)) throw new RangeError("Items: three-column rows need three or six ungrouped linked plates with no order or disclosure.");
  } else if (arrangement === "rows" && (count < 2 || count > 8 || (columns !== 1 && columns !== 2) || (columns === 2 && count % 2 !== 0))) throw new RangeError("Items: rows need 2-8 items, even in two columns.");
  if (arrangement === "stacked" && order !== "connected" && (count < 2 || count > 4)) throw new RangeError("Items: stacked needs 2-4 items.");
  if (props.lanes !== undefined) {
    if (order !== "connected" || !["columns", "stacked"].includes(arrangement) || count < 3 || count > 5 || !Array.isArray(props.lanes) || props.lanes.length !== 2) throw new TypeError("Items: two lanes belong to connected columns or stacked sequences.");
    const laneIds = new Set<string>();
    for (let i = 0; i < 2; i++) {
      const lane = props.lanes[i];
      if (!Object.hasOwn(props.lanes, i) || !lane || typeof lane.id !== "string" || !lane.id.trim() || laneIds.has(lane.id) || !hasContent(lane.label)) throw new TypeError("Items: lanes need two unique stable ids and nonblank labels.");
      laneIds.add(lane.id);
    }
    if (items[0]!.lane !== props.lanes[0]!.id || items.some(item => !laneIds.has(item.lane!)) || new Set(items.map(item => item.lane)).size !== 2) throw new TypeError("Items: start in the first lane, use both lanes, and reference known lane ids.");
  } else if (items.some(item => item.lane !== undefined)) throw new TypeError("Items: item lane references require lanes.");
  if (reveal === "disclose") {
    if (arrangement !== "rows" || count < 4 || count > 6 || order === "connected") throw new RangeError("Items: disclosure needs four to six rows.");
    for (const item of items) {
      if (!hasContent(item.description) || item.href !== undefined || item.visual !== undefined || [item.heading, item.icon, item.eyebrow, item.meta, item.badge?.label, item.status?.label].some(invalidTrigger)) throw new TypeError("Items: disclosure needs an answer and phrasing-only trigger slots without controls, href or visual.");
    }
  }
  if (arrangement === "bento") assertOrderedRows(items.map((item) => item.span === undefined ? "half" : item.span), { count: (n) => `Items: bento needs 2-6 items, got ${n}.`, unknown: (i, span) => `Items: item ${i} has unknown span ${String(span)}.`, overflow: (i) => `Items: item ${i} overflows its 12-unit row.`, incomplete: "Items: bento must fill ordered 12-unit rows." });
  else if (items.some((item) => item.span !== undefined)) throw new TypeError("Items: spans belong to bento only.");
  if (scale === "statement") {
    if (arrangement !== "columns" || columns !== 3 || count !== 3 || treatment === "plate") throw new TypeError("Items: statement needs three columns, three items and plain or rule treatment.");
    const excluded = ["icon", "eyebrow", "meta", "visual", "href", "featured", "span", "lane"] as const;
    if (items.some((item) => excluded.some((key) => (item as unknown as Record<string, unknown>)[key] !== undefined))) throw new TypeError("Items: statement items take heading, description and optional badge only.");
  }
  const links = items.filter((item) => item.href !== undefined);
  if (links.length && links.length !== count) throw new TypeError("Items: link every item or none.");
  if (links.length > 6) throw new RangeError("Items: at most six linked items.");
  if (new Set(links.map((item) => normalizedDestination(item.href!))).size !== links.length) throw new TypeError("Items: linked destinations must be unique.");
  if (groups !== undefined) {
    if (arrangement !== "rows" || !Array.isArray(groups)) throw new TypeError("Items: labelled groups belong to rows.");
    if (groups.length < 2 || groups.length > 4) throw new RangeError("Items: groups need 2-4 groups.");
    const groupIds = new Set<string>(); const members = new Set<string>();
    for (const group of groups) {
      if (!group || typeof group.id !== "string" || !group.id.trim() || groupIds.has(group.id) || !hasContent(group.label)) throw new TypeError("Items: groups need unique stable ids and nonblank labels.");
      groupIds.add(group.id);
      if (!Array.isArray(group.items) || group.items.length < 2 || group.items.length > 4) throw new RangeError("Items: each group needs 2-4 item ids.");
      for (const id of group.items) {
        if (!ids.has(id) || members.has(id)) throw new TypeError("Items: group membership must reference each item exactly once."); members.add(id);
      }
    }
    if (members.size !== count) throw new TypeError("Items: groups must include every item.");
  }
  return columns;
}
