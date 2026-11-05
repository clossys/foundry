/**
 * Shared JSON-content readers for the Frame runtime renderers. Every reader names its
 * leaf in the refusal, so a fill the package cannot honour fails loudly instead of rendering
 * invented chrome. Behaviour (navigation, actions, icons) comes from the host port only.
 */
import type { ReactNode } from "react";
import type { AppNavigationNode } from "../../blocks/app-navigation-tree.js";
import type { CommandMenuGroup } from "../../blocks/command-menu-types.js";
import type { FrameNavigate } from "../../blocks/frame-navigation.js";
import type { RuntimeFrameHost, RuntimeJson, RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";

export type FrameJson = Readonly<Record<string, RuntimeJson>>;
export type FrameHost = RuntimeFrameHost<ReactNode> | undefined;
export type FrameInput = Pick<RuntimeRenderInput<ReactNode>, "content" | "selection" | "slots" | "host" | "pageHeader">;

/** Every in-frame navigation awaits the host's pending-save guard first. */
export function guardedNavigate(host: FrameHost): FrameNavigate | undefined {
  if (!host) return undefined;
  return async href => {
    if (host.beforeNavigate && !(await host.beforeNavigate(href))) return;
    await host.navigate(href);
  };
}

export function frameContent(leaf: string) {
  const fail = (message: string): never => { throw new TypeError(`${leaf}: ${message}`); };
  const text = (value: RuntimeJson | undefined): string | undefined => typeof value === "string" && value.trim() ? value : undefined;
  const required = (value: RuntimeJson | undefined, at: string): string => text(value) ?? fail(`${at} must be non-empty text`);
  const record = (value: RuntimeJson | undefined): FrameJson | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as FrameJson : undefined;
  const records = (value: RuntimeJson | undefined): readonly FrameJson[] => Array.isArray(value) ? value.flatMap((row: RuntimeJson): FrameJson[] => { const found = record(row); return found ? [found] : []; }) : [];
  const number = (value: RuntimeJson | undefined, at: string): number => typeof value === "number" && Number.isFinite(value) ? value : fail(`${at} must be a number`);
  /** Refuses a content key the leaf's package export has no mapped prop for (never silently dropped). */
  const only = (input: Pick<FrameInput, "content">, slots: readonly string[]): void => {
    for (const key of Object.keys(input.content)) if (!slots.includes(key)) fail(`${key} content has no mapped prop`);
  };
  /** `href` navigates; `action` names a host command id. Exactly one is required. */
  const destination = (row: FrameJson, host: FrameHost, at: string): { href: string } | { onAction: () => void } => {
    const href = text(row.href), action = text(row.action);
    if ((href === undefined) === (action === undefined)) fail(`${at} needs exactly one of href or action`);
    return href !== undefined ? { href } : { onAction: () => host?.onCommand?.(action!) };
  };
  const icon = (row: FrameJson, host: FrameHost): { icon?: ReactNode } => {
    const id = text(row.icon), found = id === undefined ? undefined : host?.icons?.[id];
    return found === undefined ? {} : { icon: found };
  };
  /** A navigation tree: one disclosure level, every leaf a destination. */
  const navigationTree = (rows: readonly FrameJson[], host: FrameHost, at: string, depth = 0): AppNavigationNode[] => rows.map((row, index) => {
    const where = `${at}[${index}]`, children = records(row.children);
    const base = { id: required(row.id, where + ".id"), label: required(row.label, where + ".label"), ...icon(row, host) };
    if (depth === 0 && children.length) {
      const own = text(row.href) !== undefined || text(row.action) !== undefined ? destination(row, host, where) : {};
      return { ...base, ...own, children: navigationTree(children, host, where + ".children", 1) } as AppNavigationNode;
    }
    return { ...base, ...destination(row, host, where) } as AppNavigationNode;
  });
  /** Command groups: every item a destination, icons from the host port. */
  const commandGroups = (rows: readonly FrameJson[], host: FrameHost, at: string): CommandMenuGroup[] => rows.map((group, index) => ({
    id: required(group.id, `${at}[${index}].id`), label: required(group.label, `${at}[${index}].label`),
    items: records(group.items).map((item, position) => {
      const where = `${at}[${index}].items[${position}]`, description = text(item.description);
      return { id: required(item.id, where + ".id"), label: required(item.label, where + ".label"), ...(description ? { description } : {}), ...destination(item, host, where), ...icon(item, host) } as CommandMenuGroup["items"][number];
    }),
  }));
  return { fail, text, required, record, records, number, only, destination, icon, navigationTree, commandGroups };
}
