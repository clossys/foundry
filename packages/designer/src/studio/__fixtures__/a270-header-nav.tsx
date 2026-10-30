/** Neutral header specimen payload; the existing registered Frame remains its owner. */
import type { ReactNode } from "react";
import type { CopyResolver } from "../../frames/site-frame/copy-contract.js";
import type { SiteShellInput } from "../../frames/site-frame/types.js";
import { resolveShell } from "../../frames/site-frame/internal/resolveShell.js";
import { importFoundryFrames } from "../../importers/foundry-frames.js";
import { runtimeHash, type RuntimeJson, type RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { surfaceRuntimeRenderers } from "../../runtime/index.js";

export const headerNavSpecimenCopy = {
  "example.header.home": "ExampleCo home",
  "example.header.brand": "ExampleCo",
  "example.header.skip": "Skip to content",
  "example.header.navigation": "Primary navigation",
  "example.header.menu": "Menu",
  "example.header.overview": "Overview",
  "example.header.features": "Features",
  "example.header.contact": "Contact",
  "example.header.start": "Get started",
} as const;

export const headerNavSpecimenShell: SiteShellInput = {
  brand: { assetId: "example-mark", label: { id: "example.header.home" }, wordmark: { id: "example.header.brand" }, variant: "lockup", size: "md" },
  skipLink: { id: "example.header.skip" },
  header: { surface: "solid", position: "static", tone: "base" },
  nav: {
    label: { id: "example.header.navigation" }, triggerLabel: { id: "example.header.menu" },
    links: [
      { href: "#overview", label: { id: "example.header.overview" }, isCurrent: true },
      { href: "#features", label: { id: "example.header.features" } },
      { href: "#contact", label: { id: "example.header.contact" } },
    ],
  },
  actions: [{ href: "#start", label: { id: "example.header.start" }, emphasis: "primary" }],
};

const mark = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath d='M4 4h24v24H4z'/%3E%3C/svg%3E";

/**
 * Uses the catalog's existing fill and registered renderer, after the same strict
 * Writer/asset resolution as SiteFrame. The Studio host supplies the selected
 * component provider and consumer-compiled CSS; this payload installs neither.
 */
export function createHeaderNavSpecimen(resolveCopy: CopyResolver, shell: SiteShellInput = headerNavSpecimenShell) {
  const resolved = resolveShell(shell, resolveCopy, () => ({ type: "image", src: mark, width: 32, height: 32, alt: "" }));
  const fill = importFoundryFrames().fills.find(row => row.$extensions["com.clossys.fill"].slot === "frames.site-header");
  if (!fill) throw new Error("NEED registered frames.site-header fill");
  const renderer = surfaceRuntimeRenderers["frames.site-header"];
  if (!renderer) throw new Error("NEED registered frames.site-header renderer");
  const values: Readonly<Record<string, RuntimeJson>> = {
    brand: { label: resolved.brand.label, wordmark: resolved.brand.wordmark ?? "", markSrc: resolved.brand.markSrc, size: resolved.brand.size },
    nav: { label: resolved.nav!.label, triggerLabel: resolved.nav!.triggerLabel, links: resolved.nav!.links.map((link, index) => ({ id: `example-nav-${index}`, ...link })) },
    actions: resolved.actions.map((action, index) => ({ id: `example-action-${index}`, href: action.href, label: action.label, variant: action.emphasis })),
  };
  const content = Object.fromEntries(Object.entries(values).map(([slot, value]) => [slot, {
    reference: { kind: "region" as const, ref: `specimen:frames.site-header/${slot}` }, value, hash: runtimeHash(value),
  }]));
  const input = {
    path: "frame", fill: { kind: "frame", leaf: "frames.site-header", fill: fill.$extensions["com.clossys.fill"].id },
    cell: { theme: "light", state: "default", width: 1280 }, profile: {}, slots: {},
    selection: { leaf: "frames.site-header", fill: fill.$extensions["com.clossys.fill"].id, config: null,
      members: [`surface.${resolved.header.surface}`, `tone.${resolved.header.tone}`, `position.${resolved.header.position ?? "static"}`],
      content: Object.fromEntries(Object.entries(content).map(([slot, item]) => [slot, item.reference])) }, content,
  } as unknown as RuntimeRenderInput<ReactNode>;
  return { slot: "frames.site-header" as const, fill, input, render: () => renderer.render(input) };
}
