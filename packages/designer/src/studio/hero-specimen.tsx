import { loadCatalog, applyLibraryChange, libraryHash, resolve } from "../catalog-core/index.js";
import { withA276BackdropGraphic } from "../catalog-assets/a276-backdrop-graphic.contribution.js";
import { BACKDROP_GRAPHIC_SLOT } from "../catalog-assets/backdrop-graphic.js";
import type { LibraryData, Resolved } from "../catalog-core/types.js";
/** Explicit synthetic Hero specimen. Copy is resolved through the declared Writer host port. */
import type { ReactNode } from "react";
import type { StillBackdropArt } from "../backdrop/consumer-art.js";
import { runtimeHash, type RuntimeContent, type RuntimeJson, type RuntimeRenderInput } from "../catalog-core/runtime-ports.js";
import type { SpecimenDataset } from "./specimen-dataset.js";
import type { CompositeResolved } from "../catalog-core/types.js";
import { renderHeroSection } from "../runtime/sections/hero.js";
import { plainJson } from "../runtime/sections/dataset-json.js";
import type { HeroBackdrop } from "../blocks/hero/hero-backdrop.js";
import type { HeroCopy } from "../runtime/sections/hero-copy.js";

export const HERO_SPECIMEN_COPY = {
  "header.eyebrow": "ExampleCo. workspace",
  "header.heading": "Give your next project a clear starting point",
  "header.description": "ExampleCo. brings the brief, shared decisions and next steps into one place.",
  "actions.primary.label": "Explore the workspace",
  "actions.secondary.label": "Read the guide",
  "media.title": "ExampleCo. workspace mark",
} as const satisfies HeroCopy;

/** Existing Studio dataset copy bound to the same Writer passage port. */
export function heroCopyFromDataset(dataset: SpecimenDataset): HeroCopy {
  const hero = dataset.sections.hero;
  return {
    "header.eyebrow": hero.eyebrow, "header.heading": hero.heading, "header.description": hero.description,
    "actions.primary.label": hero.primary, "actions.secondary.label": hero.secondary,
    "media.title": dataset.charts.bar.title,
  };
}

/** Inline geometry is the complete fixture; rendering it needs no remote asset. */
export const HERO_SPECIMEN_BACKDROP = {
  slot: "backdrop", purpose: "decorative", alt: "", width: 1600, height: 900,
  aspect: "16:9", fit: "cover", loading: "lazy", bytes: 128,
  backgroundToken: "--color-surface-base",
  source: { format: "svg", paths: [{ d: "M0 0H1600V900H0Z", fillToken: "--color-accent" }] },
} as const satisfies StillBackdropArt;
let graphicValues: Resolved | undefined;
export function heroGraphicSpecimenValues(): Resolved {
  if (graphicValues) return graphicValues;
  const base = loadCatalog();
  const catalog = base.slots.some(slot => slot.id === BACKDROP_GRAPHIC_SLOT) ? base : withA276BackdropGraphic(base);
  let library: LibraryData = { source: { id: "hero-specimen", kind: "consumer", author: "consumer", license: "MIT" }, fills: [], adoptedAt: "2026-10-30" };
  const changes = catalog.slots.filter(slot => slot.layer === "tokens").flatMap(slot => {
    const offers = catalog.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === slot.id && doc.$extensions["com.clossys.fill"].mode !== "reference");
    const chosen = offers.find(doc => doc.$extensions["com.clossys.fill"].source === "foundry") ?? offers[0];
    return chosen ? [{ op: "adopt" as const, slot: slot.id, source: chosen.$extensions["com.clossys.fill"].source }] : [];
  });
  changes.push({ op: "adopt", slot: BACKDROP_GRAPHIC_SLOT, source: "foundry" });
  library = applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes });
  graphicValues = resolve({ catalog, library });
  return graphicValues;
}
/** Four explicit owner-data choices. Unsupported live bindings remain visible NEEDs. */
export const HERO_BACKDROP_SPECIMENS = [
  { kind: "none", backdrop: { kind: "none" } },
  { kind: "image", backdrop: { kind: "image", image: HERO_SPECIMEN_BACKDROP } },
  { kind: "video", backdrop: { kind: "video", missingVideoMessage: "A video file has not been provided. The poster is shown.", poster: HERO_SPECIMEN_BACKDROP, muted: true, autoplay: true, loop: true, playsInline: true } },
  { kind: "graphic", backdrop: { kind: "graphic", asset: "asset.backdrop.graphic" } },
] as const satisfies readonly { readonly kind: string; readonly backdrop: HeroBackdrop }[];

const mark = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cpath d='M10 10H90V90H10Z' fill='currentColor'/%3E%3C/svg%3E";
export const HERO_SPECIMEN_CONTENT = {
  header: {},
  actions: { primary: { href: "#example-workspace" }, secondary: { href: "#example-guide" } },
  media: { kind: "mark", src: mark },
  backdrop: HERO_SPECIMEN_BACKDROP,
} as const satisfies Readonly<Record<string, RuntimeJson>>;

/** Every registered member gets an explicit case; the scrim cases include checked art. */
export const HERO_MEMBER_SPECIMENS = [
  { member: "layout.editorial", members: ["layout.editorial", "ground.base", "size.display", "backdrop.scrim.light"] },
  { member: "layout.split", members: ["layout.split", "ground.base", "size.display", "backdrop.scrim.light"] },
  { member: "layout.full-bleed", members: ["layout.full-bleed", "ground.base", "size.display", "backdrop.scrim.light"] },
  { member: "ground.base", members: ["layout.editorial", "ground.base", "size.display", "backdrop.scrim.light"] },
  { member: "ground.inverse", members: ["layout.editorial", "ground.inverse", "size.display", "backdrop.scrim.light"] },
  { member: "backdrop.scrim.light", members: ["layout.full-bleed", "ground.inverse", "size.display", "backdrop.scrim.light"] },
  { member: "backdrop.scrim.strong", members: ["layout.full-bleed", "ground.inverse", "size.display", "backdrop.scrim.strong"] },
  { member: "size.display", members: ["layout.editorial", "ground.base", "size.display", "backdrop.scrim.light"] },
  { member: "size.compact", members: ["layout.editorial", "ground.base", "size.compact", "backdrop.scrim.light"] },
  { member: "size.default", members: ["layout.editorial", "ground.base", "size.default", "backdrop.scrim.light"] },
] as const;
export const HERO_PREVIEW_MEMBERS = ["layout.split", "ground.base", "size.display", "backdrop.scrim.light"] as const;

export function heroSpecimenInput(members: readonly string[] = HERO_PREVIEW_MEMBERS, backdrop: HeroBackdrop = HERO_SPECIMEN_BACKDROP): RuntimeRenderInput<ReactNode> {
  const source = { entry: "index.ts", files: { "index.ts": 'export { GROUP_A_SECTION_RENDERERS } from "@clossys/designer/runtime/sections/group-a";\n' }, dependencies: {} };
  const content: Record<string, RuntimeContent> = Object.fromEntries(Object.entries({ ...HERO_SPECIMEN_CONTENT, backdrop }).map(([slot, value]) => {
    const kinds = { header: "region", actions: "action", media: "media", backdrop: "media" } as const;
    const reference = { kind: kinds[slot as keyof typeof kinds], ref: `specimen:example/hero.${slot}` };
    const json = plainJson(value, `hero.${slot}`);
    return [slot, { reference, value: json, hash: runtimeHash(json) }];
  }));
  return {
    path: "sections.hero-specimen.0",
    fill: { kind: "section", library: "foundry", fill: "foundry/sections.hero", leaf: "sections.hero", config: null, slots: Object.keys(content), members: HERO_MEMBER_SPECIMENS.map(row => row.member), states: ["default"], renderer: { id: "package:sections.hero", source, sourceHash: runtimeHash(source) } },
    cell: { theme: "light", state: "default", width: 1280 },
    selection: { leaf: "sections.hero", fill: "foundry/sections.hero", config: null, members, content: Object.fromEntries(Object.entries(content).map(([slot, row]) => [slot, row.reference])) },
    content, slots: {}, profile: { values: backdrop && "kind" in backdrop && backdrop.kind === "graphic" ? heroGraphicSpecimenValues() : undefined } as CompositeResolved,
    sectionHost: { heroCopy: HERO_SPECIMEN_COPY },
  };
}

/** Mount inside the consumer's actual ComponentProvider and Suspense boundary. */
export function HeroSpecimen({ members = HERO_PREVIEW_MEMBERS, backdrop = HERO_SPECIMEN_BACKDROP }: { readonly members?: readonly string[]; readonly backdrop?: HeroBackdrop }) {
  return renderHeroSection(heroSpecimenInput(members, backdrop));
}
