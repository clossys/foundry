import type { CopyRef, CopyResolver } from "@clossys/writer";
import { RenderError } from "../../internal/errors.js";
import { isSanctionedHref } from "../../internal/href.js";
import { renderAction } from "./SectionedViewActions.js";
import type { StatusViewProps } from "./StatusView.js";

/** Caller-owned copy and destinations for a page that is not available yet. */
export interface ConstructionStatusInput {
  title: CopyRef;
  description: CopyRef;
  action?: { label: CopyRef; href: string };
  destinations?: {
    label: CopyRef;
    items: readonly { id: string; heading: CopyRef; description?: CopyRef; href: string }[];
  };
}

function refuse(path: string): never {
  // Only authored positions appear here; caller values never enter an error.
  throw new RenderError("resolution-failed", `constructionStatusProps could not resolve ${path}.`);
}

function closedObject(value: unknown, keys: readonly string[], path: string): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !keys.includes(key))) refuse(path);
}

function resolveCopy(ref: CopyRef, path: string, resolver: CopyResolver): string {
  closedObject(ref, ["id", "locale", "values"], path);
  if (typeof ref.id !== "string" || ref.id.trim().length === 0) refuse(path);
  const resolution = resolver(ref);
  if (resolution === undefined || typeof resolution.text !== "string" || resolution.text.trim().length === 0) refuse(path);
  return resolution.text;
}

function href(value: string, path: string): string {
  if (!isSanctionedHref(value)) refuse(path);
  return value;
}

/**
 * Compose chrome-free StatusView props using Writer's CopyRef resolver.
 * All visible text is resolved caller copy; missing or blank copy refuses.
 * Supply an action, destinations, or both, and use the construction page kind
 * for the host route's metadata. SiteFrame owns the page's main landmark.
 */
export function constructionStatusProps(input: ConstructionStatusInput, resolveCopyId: CopyResolver):
  { status: string; subtitle: string } & Pick<StatusViewProps, "action" | "routes"> {
  closedObject(input, ["title", "description", "action", "destinations"], "input");
  if (input.action === undefined && input.destinations === undefined) refuse("action or destinations");
  const status = resolveCopy(input.title, "title", resolveCopyId);
  const subtitle = resolveCopy(input.description, "description", resolveCopyId);
  let action: StatusViewProps["action"];
  if (input.action !== undefined) {
    closedObject(input.action, ["label", "href"], "action");
    action = renderAction({
      id: "construction-action",
      label: resolveCopy(input.action.label, "action.label", resolveCopyId),
      href: href(input.action.href, "action.href"),
    }, "primary", "base", "md");
  }
  let routes: StatusViewProps["routes"];
  if (input.destinations !== undefined) {
    const destinations = input.destinations;
    closedObject(destinations, ["label", "items"], "destinations");
    if (!Array.isArray(destinations.items) || destinations.items.length < 1 || destinations.items.length > 6) refuse("destinations.items");
    const label = resolveCopy(destinations.label, "destinations.label", resolveCopyId);
    const seen = new Set<string>();
    // Array.from visits holes, so a sparse collection also refuses its position.
    const items = Array.from(destinations.items, (item, index) => {
      const path = `destinations.items[${index}]`;
      closedObject(item, ["id", "heading", "description", "href"], path);
      if (typeof item.id !== "string" || item.id.trim().length === 0 || seen.has(item.id)) refuse(`${path}.id`);
      seen.add(item.id);
      return {
        id: item.id,
        heading: resolveCopy(item.heading, `${path}.heading`, resolveCopyId),
        ...(item.description === undefined ? {} : { description: resolveCopy(item.description, `${path}.description`, resolveCopyId) }),
        href: href(item.href, `${path}.href`),
      };
    });
    routes = { label, items };
  }
  return { status, subtitle, ...(input.action === undefined ? {} : { action }), ...(routes === undefined ? {} : { routes }) };
}
