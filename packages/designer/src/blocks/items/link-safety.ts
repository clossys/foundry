import { Children, isValidElement, type ReactNode } from "react";
import type { ItemData } from "./types.js";

/**
 * The one Item link-safety implementation: the stock Item composition, Items
 * and Publisher's view links all call it. Pure and server-safe (react-server
 * keeps Children and isValidElement); it reads supplied elements recursively
 * and never executes opaque components.
 */
const CONTROL_TAGS = new Set(["a", "button", "input", "select", "textarea", "summary", "details", "label", "iframe", "object", "embed"]);

/** An anchor, one-origin path, credential-free HTTP(S) URL or explicit mail link; every other scheme (javascript:, data:, ...) is refused. */
export function isSanctionedItemHref(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value) || value.includes("\\")) return false;
  if (value.startsWith("#")) return true;
  if (value.startsWith("/")) return !value.startsWith("//");
  if (value.toLowerCase().startsWith("mailto:")) return value.slice(7).trim().length > 0;
  try { const url = new URL(value); return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password; } catch { return false; }
}

/** A native control, focus target, editable region, media controls, link or press handler anywhere in the supplied node. */
export function hasInteractiveTarget(node: ReactNode): boolean {
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

/** The item slots a linked item renders inside its single link. */
export type ItemLinkSlots = Pick<ItemData, "id" | "href" | "heading" | "description" | "eyebrow" | "icon" | "meta" | "visual" | "badge" | "figure" | "status">;

/** Refuses an unsanctioned destination, then any second interactive target inside a linked item. Unlinked items pass. */
export function assertItemLink(item: ItemLinkSlots): void {
  if (item.href === undefined) return;
  if (!isSanctionedItemHref(item.href)) throw new TypeError("Item: href must be an anchor, one-origin path, HTTP(S) URL or explicit mail link.");
  if ([item.heading, item.description, item.eyebrow, item.icon, item.meta, item.visual, item.badge?.label, item.figure?.value, item.figure?.delta, item.status?.label].some(hasInteractiveTarget)) throw new TypeError(`Item: linked item "${item.id}" cannot contain another interactive target.`);
}
