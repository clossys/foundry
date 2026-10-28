import type { ReactNode } from "react";
import { Button } from "../../components/Button.js";
import { Link } from "../../components/Link.js";
import type { RuntimeRenderInput, RuntimeJson } from "../../catalog-core/runtime-ports.js";
import { object, SectionContentError, text, type SectionContent } from "./group-a-content.js";

/** Live commands are consumer-owned and never enter the JSON content snapshot. */
export interface MessageSectionHost {
  readonly onAction?: (id: string) => void | Promise<void>;
  readonly pending?: boolean;
}

export function messageHost(input: RuntimeRenderInput<ReactNode>, content: SectionContent): MessageSectionHost {
  const host = input.sectionHost;
  if (host === undefined) return {};
  if (!host || typeof host !== "object" || Array.isArray(host)
    || Object.keys(host).some(key => key !== "onAction" && key !== "pending")
    || (host.onAction !== undefined && typeof host.onAction !== "function")
    || (host.pending !== undefined && typeof host.pending !== "boolean")) {
    throw new SectionContentError(content.leaf, "sectionHost accepts only onAction and pending");
  }
  return host as MessageSectionHost;
}

/** Reject undeclared nested data too, including framework error objects and callback-shaped JSON. */
export function messageFields(content: SectionContent, value: Readonly<Record<string, RuntimeJson>>, keys: readonly string[], path: string): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new SectionContentError(content.leaf, `${path}.${key} is not mapped`);
}

export function messageActions(content: SectionContent, host: MessageSectionHost, maximum: number): readonly ReactNode[] {
  const value = content.values.actions;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) throw new SectionContentError(content.leaf, `actions must contain between 1 and ${maximum} controls`);
  return value.map((value, index) => {
    const path = `actions.${index}`, action = object(content, value, path);
    messageFields(content, action, ["label", "href", "action"], path);
    const label = text(content, action.label, `${path}.label`);
    if ((action.href === undefined) === (action.action === undefined)) throw new SectionContentError(content.leaf, `${path} needs exactly one of href or action`);
    const variant = index === 0 ? "primary" : "secondary";
    if (action.href !== undefined) return <Link key={index} href={text(content, action.href, `${path}.href`)} buttonVariant={variant} isDisabled={host.pending} dir="auto">{label}</Link>;
    const id = text(content, action.action, `${path}.action`);
    if (!host.onAction) throw new SectionContentError(content.leaf, `${path}.action needs sectionHost.onAction`);
    return <Button key={index} type="button" variant={variant} isDisabled={host.pending} onPress={() => { void host.onAction!(id); }} dir="auto">{label}</Button>;
  });
}
