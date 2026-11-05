import { createElement, Fragment } from "react";
import { surfaceRuntimeRenderers } from "@clossys/designer/frames";
import { runtimeHash } from "@clossys/designer/catalog";
import type { RuntimeRenderInput } from "@clossys/designer/catalog";
import type { ReactNode } from "react";
import { bindContentCopy, ContentCopyBindingError } from "./content-route-copy.js";

export interface ContentSectionBinding {
  readonly libraryVersion: string;
  /** A real consumer-selected Designer runtime input, including its interaction port. */
  readonly input: RuntimeRenderInput<ReactNode>;
}

/** Designer's registered renderer owns every node; Publisher binds reviewed copy only. */
export function renderContentSection(binding: ContentSectionBinding, sectionId: string, configId: string, version: string,
  fields: Readonly<Record<string, string>>, locale: string) {
  const input = binding.input;
  const renderer = surfaceRuntimeRenderers[sectionId];
  if (!renderer || binding.libraryVersion !== version || input.fill.kind !== "section" || input.fill.leaf !== sectionId || input.fill.config !== configId
    || !input.fill.library || !input.fill.fill || input.selection.fill !== input.fill.fill
    || input.selection.leaf !== sectionId || input.selection.config !== configId || Object.keys(input.slots).length || input.pageHeader || input.stage) {
    throw new ContentCopyBindingError(sectionId, "registered-section-binding-required");
  }
  const values: Record<string, unknown> = {};
  for (const [slot, content] of Object.entries(input.content)) values[slot] = bindContentCopy(content.value, locale, undefined, slot);
  for (const [key, text] of Object.entries(fields)) {
    const parts = key.replace(/\[([^\]]+)\]/g, ".$1").split(".");
    if (parts.some(part => ["__proto__", "constructor", "prototype", ""].includes(part))) throw new ContentCopyBindingError(key, "copy-address");
    let parent = values;
    for (const part of parts.slice(0, -1)) {
      if (!parent[part] || typeof parent[part] !== "object") parent[part] = {};
      parent = parent[part] as Record<string, unknown>;
    }
    parent[parts.at(-1)!] = text;
  }
  const content = Object.fromEntries(Object.entries(values).map(([slot, value]) => {
    const original = input.content[slot];
    return [slot, { reference: original?.reference ?? { kind: "copy" as const, ref: `${sectionId}.${slot}` }, value, hash: runtimeHash(value) }];
  }));
  return createElement(Fragment, null, renderer.render({ ...input, locale, content: content as RuntimeRenderInput<ReactNode>["content"] }));
}
