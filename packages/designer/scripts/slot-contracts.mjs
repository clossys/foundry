#!/usr/bin/env node
// Slot contracts (clossys.slot-contract/1) for the Home page section and frame L3 slots.
// Source-only: reads the slot catalog, references/manifest.json and the pinned reference
// folders, never the network. `--write` regenerates src/catalog/slot-contracts/*.json;
// `--check` fails when the committed files are stale or a reference does not resolve.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const json = path => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const args = process.argv.slice(2);
assert(args.length === 1 && ["--check", "--write"].includes(args[0]), "usage: slot-contracts.mjs --check|--write");

const SCHEMA = "clossys.slot-contract/1";
const PACKAGE = "designer";
const manifest = json("references/manifest.json");
const themeLeaves = json("src/catalog/slots/themes.json").map(slot => slot.id);

const ref = (registry, item) => {
  const row = manifest.items.find(entry => entry.registry === registry && entry.name === item);
  assert(row, `references/manifest.json has no ${registry}/${item}`);
  return { registry, item, version: row.version, hash: row.hash };
};
const mist = item => ref("tailark-oss", item);

// The Home page L3 slots. Every other mapped section or frame slot stays mapped with no
// contract (consumed-only rule). `blocked` names a reference the map requires but this
// package's references/ does not hold; the contract records it as a limit, never a ref.
const SEED = {
  sections: [
    { slot: "sections.hero", purpose: "Opening band of a marketing page: one heading, an optional eyebrow and description, up to two calls to action and optional media.", references: [mist("mist-hero-section-1")] },
    { slot: "sections.features", purpose: "Grid of product features, each a heading with an optional description and icon, under an optional section header.", references: [mist("mist-features-1")] },
    { slot: "sections.comparison", purpose: "Plan or product comparison table: rows of capabilities against columns of offers.", references: [mist("mist-comparator-1")] },
    { slot: "sections.pricing", purpose: "Pricing tiers, each with a name, price, feature list and one call to action.", references: [mist("mist-pricing-1")] },
    { slot: "sections.call-to-action", purpose: "Closing band that repeats the page's primary and secondary actions under one heading.", references: [mist("mist-call-to-action-1")] },
    { slot: "sections.steps", purpose: "Ordered process steps laid out as a horizontal timeline, each with a heading, optional description and ordinal.", references: [ref("diceui", "timeline")], limits: { orientation: "horizontal" } },
  ],
  frames: [
    { slot: "frames.site-header", purpose: "Marketing site header: brand, primary navigation and header actions, collapsing to a menu on small screens.", references: [mist("mist-hero-section-1-header")] },
    { slot: "frames.site-footer", purpose: "Marketing site footer: link columns, legal line and social links.", references: [mist("mist-footer-1")] },
    { slot: "frames.site-shell", purpose: "Marketing page shell: skip link, site header, main landmark, site footer and the toast region.", references: [mist("mist-hero-section-1-header"), mist("mist-footer-1"), ref("shadcn", "sonner")], limits: { skipTarget: "main-content", "references.blocked": "@diceui/skip-nav is not in references/" } },
  ],
};

// shadcn/Tailwind v4 utilities a reference uses, mapped to the themes leaves that back them.
const COLOR = new Set(themeLeaves.map(id => id.slice("themes.".length)).filter(name => !/^(radius|spacing|shadow|tracking-tight|font-|animate-)/.test(name)));
const COLOR_PREFIX = /^(?:bg|text|border(?:-[trblxyse])?|ring|ring-offset|outline|fill|stroke|divide|from|via|to|shadow|placeholder|decoration|caret|accent)-(.+)$/;
const SPACING = /^-?(?:p[trblxyse]?|m[trblxyse]?|gap(?:-[xy])?|space-[xy]|size|w|h|min-[wh]|max-[wh]|inset(?:-[xy])?|top|left|right|bottom|start|end|translate-[xy]|scroll-[mp][trblxy]?|indent)-(?:\d+(?:\.\d+)?|px)$/;
function themeReads(source) {
  const reads = new Set();
  for (const raw of source.split(/[\s"'`{}(),]+/)) {
    const token = raw.split(":").pop().replace(/^!/, "").replace(/\/\d+$/, "");
    if (!token) continue;
    const color = COLOR_PREFIX.exec(token);
    if (color && COLOR.has(color[1])) reads.add(`themes.${color[1]}`);
    if (/^border(?:-[trblxyse])?(?:-\d+)?$/.test(token) || /^divide-[xy](?:-\d+)?$/.test(token)) reads.add("themes.border");
    if (/^rounded(?:-[trblse]{1,2})?(?:-(?:xs|sm|md|lg|xl|2xl|3xl|4xl|full))?$/.test(token)) reads.add("themes.radius");
    if (/^shadow(?:-(?:2xs|xs|sm|md|lg|xl|2xl))?$/.test(token)) reads.add("themes.shadow");
    if (/^font-(?:sans|mono|serif|heading)$/.test(token)) reads.add(`themes.${token}`);
    if (token === "tracking-tight") reads.add("themes.tracking-tight");
    if (/^animate-(?:marquee|marquee-vertical|shiny-text)$/.test(token)) reads.add(`themes.${token}`);
    if (SPACING.test(token)) reads.add("themes.spacing");
  }
  return [...reads].filter(id => themeLeaves.includes(id)).sort();
}

const files = dir => readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? files(path) : [path]; });
function referenceSource(reference) {
  const dir = resolve(root, "references", `${reference.registry}/${reference.item}@${reference.version}`);
  assert(existsSync(dir), `missing reference folder references/${relative(resolve(root, "references"), dir)}`);
  return files(dir).filter(path => /\.(?:tsx?|jsx?)$/.test(path)).sort().map(path => readFileSync(path, "utf8")).join("\n");
}

function contract(layer, seed, slot) {
  const definition = slot.contract;
  const allowedThemes = definition.allowedReads?.themes ?? [];
  const scanned = themeReads(seed.references.map(referenceSource).join("\n"));
  const limits = {};
  for (const port of definition.slots ?? []) if (port.max !== undefined) limits[`${port.name ?? port.id}.max`] = port.max;
  for (const field of definition.copy?.fields ?? []) if (field.maxLength?.en !== undefined) limits[`${field.key}.maxLength.en`] = field.maxLength.en;
  Object.assign(limits, seed.limits ?? {});
  const inputs = [
    ...(definition.copy?.fields ?? []).map(field => ({ name: field.key, kind: "copy", required: field.required === true })),
    ...(layer === "frames" ? (definition.slots ?? []).map(port => ({ name: port.name ?? port.id, kind: "cell", required: port.required === true })) : []),
    ...scanned.filter(id => allowedThemes.includes(id)).map(id => ({ name: id, kind: "theme", required: true })),
    ...(definition.allowedReads?.assets ?? []).map(id => ({ name: id, kind: "asset", required: false })),
  ];
  return {
    schema: SCHEMA, slot: seed.slot, package: PACKAGE, layer, purpose: seed.purpose, inputs,
    limits: Object.fromEntries(Object.entries(limits).sort(([a], [b]) => a < b ? -1 : 1)),
    references: seed.references, checkSuite: `designer.slot-contracts.${layer}`, specimenKind: "visual",
  };
}

let stale = 0;
for (const layer of ["sections", "frames"]) {
  const slots = new Map(json(`src/catalog/slots/${layer}.json`).map(slot => [slot.id, slot]));
  const contracts = SEED[layer].map(seed => {
    const slot = slots.get(seed.slot);
    assert(slot, `${seed.slot} is not a ${layer} slot`);
    return contract(layer, seed, slot);
  });
  const target = resolve(root, `src/catalog/slot-contracts/${layer}.json`);
  const bytes = JSON.stringify(contracts, null, 2) + "\n";
  if (args[0] === "--write") { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes); }
  else if (!existsSync(target) || readFileSync(target, "utf8") !== bytes) { console.error(`stale ${relative(root, target)}; run scripts/slot-contracts.mjs --write`); stale++; }
}
if (stale) process.exit(1);
console.log(JSON.stringify({ mode: args[0], sections: SEED.sections.length, frames: SEED.frames.length }));
