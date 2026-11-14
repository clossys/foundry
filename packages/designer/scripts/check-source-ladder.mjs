#!/usr/bin/env node
/**
 * check:source-ladder (R2F-49, owner 2026-11-10): the component source ladder as a failing check.
 *
 * Owner rule, for every design element: L1 stock shadcn (React Aria base) first; else L2 the most
 * popular shadcn-compatible partner library part (MIT, Apache-2.0, BSD or ISC); else L3 question the
 * slot (delete, merge or compose stock); only then L4 a Foundry part with a recorded justification.
 *
 * A stock offer (`shadcn@aria`, `shadcn-charts`) needs no record. Every other offer row in
 * src/catalog/rules/source-roster.json carries a light `ladder` record, written in a few minutes:
 *   { rung: "L2"|"L3"|"L4", chosen: { id, url, stars, weeklyDownloads, licence },
 *     rejected: [<= 2 x { id, url, stars, weeklyDownloads, licence, reason }],
 *     slotNeeded (L4 only), category?, reason, checkedAt? }
 * at most 3 candidates in all (chosen plus rejected). A `studio-composition` or `brand-asset`
 * category row needs only `category` and `reason`.
 *
 * Rules (each finding names one):
 *   missing-ladder        a non-stock offer row has no `ladder`;
 *   ladder-fields         a required field is missing or malformed, or too many candidates;
 *   l4-justification      rung L4 without `slotNeeded` and `reason`;
 *   stock-available       a row's leaf has a stock item (vendored references/shadcn-aria index, or a
 *                         shadcn@aria fill) and the ladder records no concrete rejection of it;
 *   popularity            a rejected candidate with no one-line reason (a more popular candidate
 *                         left unexplained means the chosen part is not the most popular);
 *   licence               the chosen part's licence is not MIT, Apache-2.0, BSD or ISC;
 *   unrostered-component  a component module exported from src/components/index.ts maps to no
 *                         roster leaf.
 *
 * Consumer pins (foundry-audit-0006): the roster says what Foundry offers; the consumer's pins say what
 * was chosen. Every pinned Designer candidate under <consumer>/agents/designer/<slot>/, themes
 * included, is held to the same ladder:
 *   pin-stock-available   the pin's source.ref names a radix-base `shadcn/<item>` that the vendored
 *                         shadcn-aria tree also ships (ui, block, component or font), and the pin's
 *                         meta.element.reason does not name the aria twin (`shadcn-aria/<item>` or
 *                         `shadcn@aria/<item>`) to say why it was passed over;
 *   pin-stock-skipped     a components/assets/sections/frames pin whose leaf has a vendored aria stock
 *                         item, sourced from no shadcn-aria ref and with no reason naming that item;
 *   consumer-leaf-freeze  a consumer themes/assets/components slot id is in no owner-signed leaf
 *                         list (the signed freeze plus owner-signed amendments). An id listed only in
 *                         a pending-owner-ratification amendment is not signed and still fails; the
 *                         finding names the pending file.
 *
 * Offline only: it reads recorded numbers and vendored files, never the network. Dependency-free
 * (node builtins only), so it runs in check:gates' safety job.
 *
 * Usage: node scripts/check-source-ladder.mjs [--root <designer package dir>] [--consumer <consumer dir>] [--json]
 * The consumer defaults to <root>/../../clossys (this repository's dogfood consumer); a missing
 * consumer is unreadable input (exit 2), never a silent skip.
 * Exit 0 clean, 1 findings, 2 unreadable input.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const STOCK_SOURCES = Object.freeze(["shadcn@aria", "shadcn-charts"]);
export const RUNGS = Object.freeze(["L2", "L3", "L4"]);
export const CATEGORIES = Object.freeze(["studio-composition", "brand-asset", "icon-standard", "ecosystem-standard"]);
/** Categories whose rows need only `category` and `reason`. */
export const LIGHT_CATEGORIES = Object.freeze(["studio-composition", "brand-asset"]);
export const ALLOWED_LICENCES = Object.freeze(["MIT", "Apache-2.0", "BSD", "BSD-2-Clause", "BSD-3-Clause", "ISC"]);
export const LAYERS = Object.freeze(["components", "assets", "sections", "frames"]);
const STOCK_ITEM_TYPES = new Set(["registry:ui", "registry:block", "registry:component"]);
/** Aria items a consumer pin may take as stock: the component types plus fonts (themes.font-*). */
const PIN_STOCK_ITEM_TYPES = new Set([...STOCK_ITEM_TYPES, "registry:font"]);
export const FROZEN_LAYERS = Object.freeze(["themes", "assets", "components"]);
const PIN_SKIP_LAYERS = new Set(["components", "assets", "sections", "frames"]);
const MAX_REJECTED = 2, MAX_CANDIDATES = 3;

const text = value => typeof value === "string" && value.trim().length > 0;
const count = value => Number.isInteger(value) && value >= 0;
const kebab = name => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z])([A-Z][a-z])/g, "$1-$2").toLowerCase();

/** Every token of an SPDX-style expression ("ISC AND MIT") must be an allowed licence. */
export function licenceAllowed(licence) {
  if (!text(licence)) return false;
  const tokens = licence.replace(/[()]/g, " ").split(/\s+/).filter(token => token && !/^(?:AND|OR)$/.test(token));
  return tokens.length > 0 && tokens.every(token => ALLOWED_LICENCES.includes(token));
}

/** Names a vendored stock item might go by for one leaf suffix. */
function stockNames(suffix) {
  return [...new Set([suffix, suffix.replace(/-/g, ""), suffix.replace(/s$/, ""), `${suffix}s`])];
}

function partFields(part, where, add, { numbers }) {
  if (!part || typeof part !== "object" || Array.isArray(part)) return add("ladder-fields", `${where} must be an object`);
  if (!text(part.id)) add("ladder-fields", `${where}.id is required`);
  if (!numbers) return;
  if (!text(part.url) || !/^https:\/\//.test(part.url)) add("ladder-fields", `${where}.url must be an https URL`);
  if (!count(part.stars)) add("ladder-fields", `${where}.stars must be a recorded non-negative integer`);
  if (!count(part.weeklyDownloads)) add("ladder-fields", `${where}.weeklyDownloads must be a recorded non-negative integer`);
  if (!text(part.licence)) add("ladder-fields", `${where}.licence is required`);
}

/**
 * Pure check over already-read inputs.
 * @param {object} input
 * @param {object} input.roster          parsed source-roster.json
 * @param {Set<string>} input.stockItems vendored shadcn-aria item names (ui, block, component)
 * @param {Set<string>} input.stockFills leaves with a shadcn@aria fill
 * @param {{file: string, names: string[]}[]} input.componentModules modules exported from components/index.ts
 * @param {Map<string, string>} [input.aliases] alias leaf suffix -> roster leaf
 * @param {{slot: string, candidate: string, refs: string[], reason: string}[]} [input.consumerPins] pinned consumer Designer candidates
 * @param {string[]} [input.consumerSlots] every consumer Designer slot id, pinned or not
 * @param {Set<string>} [input.pinStockItems] vendored shadcn-aria item names a pin may take (ui, block, component, font)
 * @param {{signed: Record<string, Set<string>>, pending: Map<string, string>}} [input.leafFreeze] owner-signed leaf ids per frozen layer; pending id -> amendment file
 */
export function checkSourceLadder({ roster, stockItems, stockFills, componentModules, aliases = new Map(), consumerPins = [], consumerSlots = [], pinStockItems = new Set(), leafFreeze }) {
  const findings = [];
  const leaves = new Set();
  for (const layer of LAYERS) for (const row of roster[layer] ?? []) for (const leaf of row.leaves ?? []) leaves.add(leaf);

  for (const layer of LAYERS) for (const row of roster[layer] ?? []) for (const offer of row.offers ?? []) {
    if (STOCK_SOURCES.includes(offer.source)) continue;
    const subject = `${layer}/${row.l2}/${offer.source}`;
    const add = (rule, detail) => findings.push({ rule, subject, detail });
    const ladder = offer.ladder;
    const rejected = Array.isArray(ladder?.rejected) ? ladder.rejected : [];

    // stock-available is judged whether or not a record exists.
    for (const leaf of offer.leaves ?? []) {
      const suffix = leaf.slice(leaf.indexOf(".") + 1);
      const items = stockNames(suffix).filter(name => stockItems.has(name));
      if (stockFills.has(leaf)) items.push(`fill:${leaf}`);
      if (!items.length) continue;
      const names = items.map(item => item.startsWith("fill:") ? suffix : item);
      const rejectedStock = rejected.some(entry => text(entry?.reason) && typeof entry.id === "string"
        && names.some(name => entry.id === `shadcn@aria/${name}` || entry.id === name));
      if (!rejectedStock) add("stock-available", `${leaf} has stock ${items.join(", ")} but source is ${offer.source}; record a concrete rejection (rejected[].id "shadcn@aria/${names[0]}" with a reason) or use stock`);
    }

    if (ladder === undefined) { add("missing-ladder", `non-stock offer (${(offer.leaves ?? []).join(", ")}) has no ladder record`); continue; }
    if (!ladder || typeof ladder !== "object" || Array.isArray(ladder)) { add("ladder-fields", "ladder must be an object"); continue; }

    if (ladder.category !== undefined && !CATEGORIES.includes(ladder.category)) add("ladder-fields", `category must be one of ${CATEGORIES.join(", ")}`);
    if (!text(ladder.reason)) add("ladder-fields", "reason is required");
    if (ladder.checkedAt !== undefined && !(typeof ladder.checkedAt === "string" && /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?$/.test(ladder.checkedAt))) add("ladder-fields", "checkedAt must be an ISO date");
    if (ladder.rejected !== undefined && !Array.isArray(ladder.rejected)) add("ladder-fields", "rejected must be an array");
    if (rejected.length > MAX_REJECTED) add("ladder-fields", `at most ${MAX_REJECTED} rejected candidates (${rejected.length} recorded)`);
    if (rejected.length + (ladder.chosen ? 1 : 0) > MAX_CANDIDATES) add("ladder-fields", `at most ${MAX_CANDIDATES} candidates in all`);
    rejected.forEach((entry, index) => partFields(entry, `rejected[${index}]`, add, { numbers: true }));
    const chosenStars = count(ladder.chosen?.stars) ? ladder.chosen.stars : -1;
    rejected.forEach((entry, index) => {
      if (!entry || typeof entry !== "object" || text(entry.reason)) return;
      const more = count(entry.stars) && entry.stars > chosenStars;
      add("popularity", `rejected[${index}] (${entry.id ?? "?"}) has no one-line reason${more ? `; it has more stars (${entry.stars}) than the chosen part` : ""}`);
    });
    if (ladder.chosen?.licence !== undefined && !licenceAllowed(ladder.chosen.licence)) add("licence", `chosen licence ${JSON.stringify(ladder.chosen.licence)} is not MIT, Apache-2.0, BSD or ISC`);
    if (LIGHT_CATEGORIES.includes(ladder.category)) continue;

    if (!RUNGS.includes(ladder.rung)) { add("ladder-fields", `rung must be one of ${RUNGS.join(", ")}`); continue; }
    if (ladder.rung === "L2") partFields(ladder.chosen, "chosen", add, { numbers: true });
    if (ladder.rung === "L3") partFields(ladder.chosen, "chosen", add, { numbers: false });
    if (ladder.rung === "L4" && (!text(ladder.slotNeeded) || !text(ladder.reason))) add("l4-justification", "rung L4 needs slotNeeded and reason");
    if (ladder.rung !== "L4" && ladder.slotNeeded !== undefined) add("ladder-fields", "slotNeeded is recorded only on rung L4");
  }

  for (const module of componentModules) {
    const base = path.basename(module.file).replace(/\.[cm]?[jt]sx?$/, "").replace(/\.(?:server|document)$/, "");
    const dirs = path.dirname(module.file).split("/").filter(part => part && part !== "." && part !== "components" && part !== "preview-runtime");
    const candidates = new Set([...module.names.map(kebab), kebab(base), ...dirs.slice(-1)]);
    candidates.delete("index");
    const rostered = [...candidates].some(name => LAYERS.some(layer => leaves.has(`${layer}.${name}`)) || leaves.has(aliases.get(name)));
    if (!rostered) findings.push({ rule: "unrostered-component", subject: `src/components/${module.file}`, detail: `exports ${module.names.join(", ")}; no roster row for ${[...candidates].join(" | ")}` });
  }
  findings.push(...checkConsumerPins({ consumerPins, pinStockItems }), ...checkConsumerLeafFreeze({ consumerSlots, leafFreeze }));
  return findings;
}

/** Whether a pin's reason names an aria item, which is how a pin records passing it over. */
const namesAria = (reason, item) => reason.includes(`shadcn-aria/${item}`) || reason.includes(`shadcn@aria/${item}`);

/** pin-stock-available and pin-stock-skipped over the consumer's pinned Designer candidates. Pure. */
export function checkConsumerPins({ consumerPins, pinStockItems }) {
  const findings = [];
  for (const pin of consumerPins) {
    const subject = `consumer/${pin.slot}`;
    const reason = typeof pin.reason === "string" ? pin.reason : "";
    const refs = Array.isArray(pin.refs) ? pin.refs.filter(ref => typeof ref === "string") : [];
    for (const ref of refs) {
      const match = /^shadcn\/([a-z0-9][a-z0-9-]*)@/.exec(ref);
      if (!match || !pinStockItems.has(match[1]) || namesAria(reason, match[1])) continue;
      findings.push({ rule: "pin-stock-available", subject, detail: `pinned ${pin.candidate} takes radix ${ref} but shadcn-aria ships ${match[1]}; use shadcn-aria/${match[1]} or say in meta.element.reason why shadcn-aria/${match[1]} was passed over` });
    }
    const layer = pin.slot.split(".")[0];
    if (!PIN_SKIP_LAYERS.has(layer)) continue;
    const suffix = pin.slot.split(".").at(-1);
    const items = stockNames(suffix).filter(name => pinStockItems.has(name) && !name.startsWith("font-"));
    if (!items.length || refs.some(ref => ref.startsWith("shadcn-aria/") || ref.startsWith("shadcn/")) || items.some(item => namesAria(reason, item))) continue;
    findings.push({ rule: "pin-stock-skipped", subject, detail: `pinned ${pin.candidate} has stock shadcn-aria/${items[0]} but is sourced from ${refs.join(", ") || "no ref"}; use stock or say in meta.element.reason why shadcn-aria/${items[0]} was passed over` });
  }
  return findings;
}

/** consumer-leaf-freeze: every consumer themes/assets/components slot id is an owner-signed leaf. Pure. */
export function checkConsumerLeafFreeze({ consumerSlots, leafFreeze }) {
  if (!leafFreeze) return [];
  const findings = [];
  for (const slot of [...new Set(consumerSlots)].sort()) {
    const layer = slot.split(".")[0];
    if (!FROZEN_LAYERS.includes(layer)) continue;
    if (leafFreeze.signed[layer]?.has(slot)) continue;
    const pending = leafFreeze.pending.get(slot);
    findings.push({ rule: "consumer-leaf-freeze", subject: `consumer/${slot}`, detail: `${slot} is in no owner-signed ${layer} leaf list${pending ? ` (listed only in ${pending}, pending owner ratification)` : ""}; retire the slot or get the leaf signed` });
  }
  return findings;
}

/** Read `export { A, B as C } from "./x.js"` value statements; PascalCase names mark an implementation module. */
export function componentModulesFrom(indexText) {
  const modules = new Map();
  for (const match of indexText.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").matchAll(/export\s*\{([^}]*)\}\s*from\s*"(\.\/[^"]+)"/g)) {
    const names = match[1].split(",").map(part => part.trim()).filter(part => part && !part.startsWith("type "))
      .flatMap(part => part.split(/\s+as\s+/).map(name => name.trim())).filter(name => /^[A-Z][a-z0-9]/.test(name));
    if (!names.length) continue;
    const file = match[2].replace(/^\.\//, "");
    modules.set(file, [...new Set([...(modules.get(file) ?? []), ...names])]);
  }
  return [...modules].map(([file, names]) => ({ file, names }));
}

/** COMPONENT_ALIASES "<verb>.<name>": "<leaf>" -> Map(name -> leaf). */
export function aliasesFrom(aliasText) {
  return new Map([...aliasText.matchAll(/"[a-z-]+\.([a-z0-9-]+)"\s*:\s*"([a-z]+\.[a-z0-9-]+)"/g)].map(match => [match[1], match[2]]));
}

/**
 * The owner-signed leaf ids per frozen layer, from the vendored freeze files: the signed freeze plus
 * every amendment whose status is owner-signed against the same signed head. Pending amendments map
 * id -> file so findings can name them.
 */
export function leafFreezeFrom(iaDir) {
  const readJson = file => JSON.parse(fs.readFileSync(path.join(iaDir, file), "utf8"));
  const signed = {}, pending = new Map();
  for (const layer of FROZEN_LAYERS) {
    const freeze = readJson(`${layer}.leaf-freeze.json`);
    if (!Array.isArray(freeze.leafIds) || !freeze.leafIds.length) throw new Error(`${layer}.leaf-freeze.json has no leafIds`);
    signed[layer] = new Set(freeze.leafIds);
  }
  for (const file of fs.readdirSync(iaDir).filter(name => /[.-]leaf-amendments\.json$/.test(name)).sort()) {
    const amendment = readJson(file);
    const layer = amendment.layer;
    if (!FROZEN_LAYERS.includes(layer) || !Array.isArray(amendment.addedLeafIds)) throw new Error(`${file} is not a leaf amendment`);
    const base = readJson(`${layer}.leaf-freeze.json`);
    if (amendment.status === "owner-signed" && amendment.baseSignedHead === base.signedHead) for (const id of amendment.addedLeafIds) signed[layer].add(id);
    else for (const id of amendment.addedLeafIds) pending.set(id, `src/catalog/ia/${file}`);
  }
  return { signed, pending };
}

/** Every consumer Designer slot id, and the pinned candidate's source refs and reason. */
export function consumerFrom(consumer) {
  const agents = path.join(consumer, "agents/designer");
  if (!fs.existsSync(agents)) throw new Error(`no consumer Designer slots at ${agents}`);
  const consumerSlots = [], consumerPins = [];
  for (const entry of fs.readdirSync(agents, { withFileTypes: true })) {
    if (!entry.isDirectory() || !fs.existsSync(path.join(agents, entry.name, "slot.json"))) continue;
    consumerSlots.push(entry.name);
    const pinFile = path.join(agents, entry.name, "pin.json");
    if (!fs.existsSync(pinFile)) continue;
    const name = JSON.parse(fs.readFileSync(pinFile, "utf8")).candidate;
    if (typeof name !== "string" || !name.endsWith(".json")) continue;
    const doc = JSON.parse(fs.readFileSync(path.join(agents, entry.name, "candidates", name), "utf8"));
    const refs = doc?.meta?.source?.ref;
    const reason = doc?.meta?.element?.reason;
    consumerPins.push({ slot: entry.name, candidate: name, refs: Array.isArray(refs) ? refs : [], reason: typeof reason === "string" ? reason : "" });
  }
  if (!consumerSlots.length) throw new Error(`no consumer Designer slots at ${agents}`);
  return { consumerSlots: consumerSlots.sort(), consumerPins: consumerPins.sort((a, b) => a.slot.localeCompare(b.slot)) };
}

export function loadInputs(designer, consumer = path.resolve(designer, "../../clossys")) {
  const read = file => fs.readFileSync(path.join(designer, file), "utf8");
  const roster = JSON.parse(read("src/catalog/rules/source-roster.json"));
  const vendored = path.join(designer, "references/shadcn-aria");
  const stockItems = new Set(), pinStockItems = new Set();
  for (const entry of fs.readdirSync(vendored, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.includes("@")) continue;
    const name = entry.name.slice(0, entry.name.lastIndexOf("@"));
    const file = path.join(vendored, entry.name, `${name}.json`);
    if (!fs.existsSync(file)) continue;
    const type = JSON.parse(fs.readFileSync(file, "utf8")).type;
    if (STOCK_ITEM_TYPES.has(type)) stockItems.add(name);
    if (PIN_STOCK_ITEM_TYPES.has(type)) pinStockItems.add(name);
  }
  if (!stockItems.size) throw new Error("Empty vendored shadcn-aria index");
  const fills = path.join(designer, "src/catalog/fills/shadcn@aria");
  const stockFills = new Set(fs.existsSync(fills) ? fs.readdirSync(fills).filter(file => file.endsWith(".json")).map(file => file.slice(0, -5)) : []);
  const components = path.join(designer, "src/components");
  const componentModules = componentModulesFrom(read("src/components/index.ts")).map(module => {
    const stem = module.file.replace(/\.[cm]?js$/, "");
    const file = [".tsx", ".ts", ".mts", ".js", ".mjs"].map(ext => stem + ext).find(candidate => fs.existsSync(path.join(components, candidate)));
    if (!file) throw new Error(`src/components/index.ts re-exports a missing module ${module.file}`);
    return { ...module, file };
  });
  if (!componentModules.length) throw new Error("No component modules exported from src/components/index.ts");
  const aliasFile = path.join(designer, "src/catalog/component-aliases.ts");
  const aliases = fs.existsSync(aliasFile) ? aliasesFrom(fs.readFileSync(aliasFile, "utf8")) : new Map();
  return { roster, stockItems, stockFills, componentModules, aliases, pinStockItems, leafFreeze: leafFreezeFrom(path.join(designer, "src/catalog/ia")), ...consumerFrom(consumer) };
}

export function summarize(findings) {
  const rows = new Set(findings.map(finding => finding.subject));
  const byRule = {};
  for (const finding of findings) byRule[finding.rule] = (byRule[finding.rule] ?? 0) + 1;
  return { failingRows: rows.size, findings: findings.length, byRule };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const rootIndex = args.indexOf("--root");
  const designer = rootIndex >= 0 ? path.resolve(args[rootIndex + 1] ?? ".") : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const consumerIndex = args.indexOf("--consumer");
  const consumer = consumerIndex >= 0 ? path.resolve(args[consumerIndex + 1] ?? ".") : undefined;
  try {
    const findings = checkSourceLadder(loadInputs(designer, consumer));
    const summary = summarize(findings);
    if (json) console.log(JSON.stringify({ gate: "source-ladder", ok: findings.length === 0, ...summary, violations: findings }, null, 2));
    else {
      for (const finding of findings) console.log(`${finding.rule}  ${finding.subject}  ${finding.detail}`);
      console.log(findings.length ? `source-ladder: FAIL, ${summary.failingRows} failing rows, ${summary.findings} findings ${JSON.stringify(summary.byRule)}` : "source-ladder: OK");
    }
    process.exitCode = findings.length ? 1 : 0;
  } catch (error) {
    console.error(`source-ladder: unreadable input: ${error.message}`);
    process.exitCode = 2;
  }
}
