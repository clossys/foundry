#!/usr/bin/env node
// Slot contracts (clossys.slot-contract/1) for every canonical Designer L3 slot: themes,
// assets, components, sections and frames. Source-only: reads the slot catalog
// (src/catalog/slots/<layer>.json), the IA (src/catalog/ia/<layer>.json),
// scripts/slot-contract-overrides.json, references/manifest.json and the pinned reference
// folders, never the network. Each record is derived from the slot's embedded catalog
// contract; the overrides file supplies hand-written purposes, references and limits, and a
// slot whose references are listed there is a hand record that stays authoritative.
// `--write` regenerates src/catalog/slot-contracts/<layer>.json; `--check` fails when a
// committed file is stale or slotContractFindings reports anything, including a canonical
// slot without a record.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const json = path => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const args = process.argv.slice(2);
assert(args.length === 1 && ["--check", "--write"].includes(args[0]), "usage: slot-contracts.mjs --check|--write");

const SCHEMA = "clossys.slot-contract/1";
const PACKAGE = "designer";
const LAYERS = ["themes", "assets", "components", "sections", "frames"];
const manifest = json("references/manifest.json");
const overrides = json("scripts/slot-contract-overrides.json");
assert.equal(overrides.schema, "clossys.slot-contract-overrides/1");
const themeLeaves = json("src/catalog/slots/themes.json").map(slot => slot.id);

const ref = (registry, item) => {
  const row = manifest.items.find(entry => entry.registry === registry && entry.name === item);
  assert(row, `references/manifest.json has no ${registry}/${item}`);
  return { registry, item, version: row.version, hash: row.hash };
};
const named = spec => { const at = spec.indexOf("/"); return ref(spec.slice(0, at), spec.slice(at + 1)); };
// A slot's derived references: the direct manifest rows fetched for it, in manifest order.
const derivedRefs = id => manifest.items.filter(row => row.direct && (row.slots ?? []).includes(id)).map(row => ref(row.registry, row.name));

// Class-wide section rules, recorded on every contract that composes the band.
const SECTION_RULES = {
  "rule.spacing": "section padding, gutter and container width come from sections.band tokens; no numeric section-scale spacing, container width or arbitrary size",
  "rule.type": "display, heading, title, lead and figure sizes come from the band type tokens; no text-xl and larger, no arbitrary text size",
  "rule.decoration": "decorative UI renders only inside a bound media, backdrop or records slot with content; no empty boxes",
  "rule.copy": "every visible label, including table corner and row-header cells, binds a declared copy field; never delete UI for a missing Writer key",
  "rule.overflow": "no horizontal page overflow at 375, 768 and 1280; content fits the measure instead of scrolling or bleeding",
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
// Theme reads a rendered slot makes: those its references use and the slot allows (required);
// with no reference to read, every allowed read (optional).
function themeInputs(definition, references) {
  const allowed = definition.allowedReads?.themes ?? [];
  if (!references.length) return allowed.map(id => ({ name: id, kind: "theme", required: false }));
  return themeReads(references.map(referenceSource).join("\n")).filter(id => allowed.includes(id)).map(id => ({ name: id, kind: "theme", required: true }));
}
const assetInputs = definition => (definition.allowedReads?.assets ?? []).map(id => ({ name: id, kind: "asset", required: false }));

// Section and frame records: copy keys, regions, theme and asset reads, and the section shell.
function composed(layer, override, definition, references) {
  const limits = {};
  for (const port of definition.slots ?? []) if (port.max !== undefined) limits[`${port.name ?? port.id}.max`] = port.max;
  for (const field of definition.copy?.fields ?? []) if (field.maxLength?.en !== undefined) limits[`${field.key}.maxLength.en`] = field.maxLength.en;
  const anatomy = definition.anatomy ?? {};
  if (anatomy.band) Object.assign(limits, { "compose.band": anatomy.band, ...SECTION_RULES });
  if (anatomy.header) limits["compose.header"] = anatomy.header;
  if (override.limits?.["compose.measure"]) Object.assign(limits, { "rule.spacing": SECTION_RULES["rule.spacing"], "rule.overflow": SECTION_RULES["rule.overflow"] });
  const copy = definition.copy?.fields ?? [];
  // Frames bind their regions as cells; a section with no copy binds its regions instead.
  const cells = layer === "frames" || !copy.length ? (definition.slots ?? []) : [];
  const inputs = [
    ...copy.map(field => ({ name: field.key, kind: "copy", required: field.required === true })),
    ...cells.map(port => ({ name: port.name ?? port.id, kind: "cell", required: port.required === true })),
    ...themeInputs(definition, references),
    ...assetInputs(definition),
  ];
  return { inputs, limits };
}

const MODES = modes => modes.length === 2 ? `${modes[0]} and ${modes[1]} modes` : `${modes.join(", ")} mode`;
const list = names => names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
const TOKEN = { color: "Color", duration: "Motion", fontFamily: "Font family", dimension: "Dimension", shadow: "Shadow", number: "Number" };
const VALUE = { svg: "SVG", glyph: "Glyph", rules: "Rules" };
const title = id => { const name = id.slice(id.indexOf(".") + 1).replace(/-/g, " "); return name[0].toUpperCase() + name.slice(1); };

// Theme tokens: one value per member, emitted as the member's CSS variable in every mode.
function token(definition, where) {
  const members = definition.members.names;
  const vars = members.map(member => definition.emit[member]);
  return {
    purpose: `${TOKEN[definition.$type]} token emitted as ${list(vars)} (${definition.tier} tier; ${MODES(definition.modes)}), under ${where}.`,
    inputs: members.map(member => ({ name: member, kind: "data", required: true, description: `DTCG ${definition.$type} value for ${definition.emit[member]} in ${MODES(definition.modes)}` })),
    limits: { "$type": definition.$type, tier: definition.tier, modes: definition.modes.join(","), "members.mode": definition.members.mode, ...Object.fromEntries(members.map(member => [`emit.${member}`, definition.emit[member]])) },
  };
}

// Assets: one file per closed member (optional members marked), or an open set of named entries.
function asset(definition, where) {
  const open = definition.members.mode === "open";
  const members = open ? [] : definition.members.names;
  const optional = new Set(definition.optional ?? []);
  const kindOf = member => definition.memberKinds?.[member] ?? definition.valueKind;
  const limits = { valueKind: definition.valueKind, modes: definition.modes.join(","), "members.mode": definition.members.mode };
  if (open) limits["members.pattern"] = definition.members.pattern;
  if (definition.grid !== undefined) limits.grid = definition.grid;
  for (const member of members) if (kindOf(member) !== definition.valueKind) limits[`member.${member}.kind`] = kindOf(member);
  return {
    purpose: `${VALUE[definition.valueKind]} asset ${open ? "with an open set of named entries" : `with ${members.length === 1 ? "member" : "members"} ${list(members)}`}${definition.grid ? ` on a ${definition.grid}px grid` : ""}, under ${where}.`,
    inputs: open
      ? [{ name: "entries", kind: "data", required: true, description: `named ${definition.valueKind} entries whose names match ${definition.members.pattern}` }]
      : members.map(member => ({ name: member, kind: "data", required: !optional.has(member), description: `${kindOf(member)} file for the ${member} member` })),
    limits,
  };
}

// Components: props and member axes, theme and asset reads, and what the component composes.
function component(id, definition, where, references) {
  const axes = new Map();
  for (const name of definition.members?.names ?? []) { const [axis, value] = name.split("."); axes.set(axis, [...(axes.get(axis) ?? []), ...(value ? [value] : [])]); }
  const props = definition.props ?? [];
  const limits = { root: definition.root, "members.mode": definition.members.mode, members: definition.members.names.join(",") };
  if (definition.apg) limits.apg = definition.apg;
  if (definition.composes?.length) limits["compose.components"] = definition.composes.join(",");
  return {
    purpose: `${title(id)} component (root ${definition.root}${definition.apg ? `; APG ${definition.apg} pattern` : ""}), under ${where}.`,
    inputs: [
      ...props.map(name => ({ name, kind: "prop", required: false })),
      ...[...axes].filter(([axis]) => !props.includes(axis)).map(([axis, values]) => ({ name: axis, kind: "prop", required: false, description: values.length ? `member axis: ${values.join(" | ")}` : "member flag" })),
      ...themeInputs(definition, references),
      ...assetInputs(definition),
    ],
    limits,
  };
}

function record(layer, slot, where) {
  const override = overrides.slots[slot.id] ?? {};
  const definition = slot.contract;
  const references = override.references ? override.references.map(named) : derivedRefs(slot.id);
  const derived = layer === "themes" ? token(definition, where)
    : layer === "assets" ? asset(definition, where)
    : layer === "components" ? component(slot.id, definition, where, references)
    : composed(layer, override, definition, references);
  const purpose = override.purpose ?? derived.purpose;
  assert(purpose, `${slot.id} needs a purpose in scripts/slot-contract-overrides.json`);
  const limits = { ...derived.limits, ...(slot.requires?.length ? { requires: slot.requires.join(",") } : {}), ...(override.limits ?? {}) };
  return {
    schema: SCHEMA, slot: slot.id, package: PACKAGE, layer, purpose, inputs: derived.inputs,
    limits: Object.fromEntries(Object.entries(limits).sort(([a], [b]) => a < b ? -1 : 1)),
    references, checkSuite: `designer.slot-contracts.${layer}`, specimenKind: specimen(layer, slot),
  };
}

// The checker is TypeScript: Node with type stripping loads the source, older Node the build.
const checker = await import(pathToFileURL(resolve(root, "src/catalog-core/slot-contracts.ts")).href)
  .catch(() => import(pathToFileURL(resolve(root, "dist/catalog-core/slot-contracts.js")).href))
  .catch(() => { throw new Error("slot-contracts: cannot load the checker; use Node 22.18+ or run npm run build first"); });
const specimen = (layer, slot) => checker.specimenKindFor(layer, slot);
const referencesRoot = resolve(root, "references");
const folderExists = dir => existsSync(join(referencesRoot, dir)) && statSync(join(referencesRoot, dir)).isDirectory();

let stale = 0;
const findings = [];
const counts = {};
for (const layer of LAYERS) {
  const catalog = json(`src/catalog/slots/${layer}.json`);
  const where = new Map();
  for (const l1 of json(`src/catalog/ia/${layer}.json`).nodes) for (const l2 of l1.children ?? []) for (const id of l2.leaves ?? []) where.set(id, `${l1.label} / ${l2.label}`);
  assert.deepEqual([...where.keys()].sort(), catalog.map(slot => slot.id).sort(), `${layer}: IA leaves and slot catalog differ`);
  for (const id of Object.keys(overrides.slots)) if (id.startsWith(`${layer}.`)) assert(catalog.some(slot => slot.id === id), `override ${id} is not a ${layer} slot`);
  // Overridden slots first, in overrides order (the hand records lead), then catalog order.
  const rank = id => { const at = Object.keys(overrides.slots).indexOf(id); return at < 0 ? Infinity : at; };
  const ordered = catalog.map((slot, index) => ({ slot, index })).sort((a, b) => rank(a.slot.id) - rank(b.slot.id) || a.index - b.index).map(({ slot }) => slot);
  const contracts = ordered.map(slot => record(layer, slot, where.get(slot.id)));
  const target = resolve(root, `src/catalog/slot-contracts/${layer}.json`);
  const bytes = JSON.stringify(contracts, null, 2) + "\n";
  if (args[0] === "--write") { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes); }
  else if (!existsSync(target) || readFileSync(target, "utf8") !== bytes) { console.error(`stale ${relative(root, target)}; run scripts/slot-contracts.mjs --write`); stale++; }
  // Coverage and findings are measured on the committed file, so a stale file cannot pass.
  const committed = existsSync(target) ? JSON.parse(readFileSync(target, "utf8")) : [];
  findings.push(...checker.slotContractFindings(committed, { layer, slots: catalog, manifest, folderExists }));
  counts[layer] = `${catalog.filter(slot => committed.some(row => row.slot === slot.id)).length}/${catalog.length}`;
}
for (const finding of findings) console.error(`finding ${finding}`);
const total = Object.values(counts).reduce((sum, count) => sum + Number(count.split("/")[0]), 0);
const canonical = Object.values(counts).reduce((sum, count) => sum + Number(count.split("/")[1]), 0);
console.log(JSON.stringify({ mode: args[0], coverage: `${total}/${canonical}`, findings: findings.length, stale, layers: counts }));
if (stale || findings.length) process.exit(1);
