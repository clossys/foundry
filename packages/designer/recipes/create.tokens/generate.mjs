#!/usr/bin/env node
/**
 * create.tokens generator: turns one direction's decided values (a spec) into the theme candidate
 * (a shadcn `registry:theme` item with `cssVars` and the DTCG file `clossys/<slot>.json`). The model
 * decides the values and the Director reason in the diverge stage; this tool only plumbs them, so a
 * draft has one shape whatever direction it came from.
 *
 *   node packages/designer/recipes/create.tokens/generate.mjs <spec.json> [--root <dir>] > draft.json
 *
 * Deterministic (R15.5): the same spec and slot contract give identical bytes. It reads two files
 * and writes stdout; no clock (createdAt comes from the spec), no network, no randomness.
 *
 * Spec: { slot, members: { <member>: { <mode>: value } }, reason, source: { kind, ref[], hash?,
 * license }, provenance?: { <member>: { sourceLabel, sourceVariable, base? } }, creator?: { model,
 * by }, createdAt?, font?: { <member>: { kind, dependency } }, dependencies?: [], cssScope?: "theme" }.
 * The slot contract (slot.json `contract`) fixes `$type`, the member names, the modes and the CSS
 * variable each member emits.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const DIMENSION = /^(-?\d*\.?\d+)(px|rem|em|%|ch|vh|vw)$/;

/** The CSS text of one value of `$type`. */
export function cssOf(type, value) {
  if (type === "fontFamily") {
    if (!Array.isArray(value) || !value.length || value.some(item => typeof item !== "string" || !item.trim())) throw new Error("a fontFamily value is a non-empty list of family names");
    return value.map(name => /[\s'"]/.test(name) && !/^(?:sans-serif|serif|monospace|system-ui|ui-[a-z-]+)$/.test(name) ? `'${name.replace(/'/g, "\\'")}'` : name).join(", ");
  }
  if (typeof value !== "string" || !value.trim()) throw new Error(`a ${type} value is a non-empty CSS string`);
  return value.trim();
}

/** The DTCG `$value` of one value of `$type` (a dimension is {value, unit}; the rest are kept). */
export function dtcgOf(type, value) {
  if (type === "dimension" && typeof value === "string") {
    const match = DIMENSION.exec(value.trim());
    if (match) return { unit: match[2], value: Number(match[1]) };
  }
  return value;
}

/** Sorts object keys so the bytes never depend on the spec's key order. */
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
}

/**
 * The theme candidate for `spec` under `contract`. Throws with the fix when the spec does not fit
 * the contract: a member outside the closed set, a missing mode, no reason or no source.
 */
export function generate(spec, contract) {
  if (!isRecord(spec)) throw new Error("the spec is not a JSON object");
  if (!isRecord(contract) || contract.kind !== "token") throw new Error("the slot contract is not a token contract (contract.kind token)");
  const slot = spec.slot;
  if (typeof slot !== "string" || !/^themes\.[a-z0-9-]+$/.test(slot)) throw new Error("spec.slot must be a themes.<leaf> slot id");
  const leaf = slot.slice("themes.".length);
  const type = contract.$type;
  const modes = Array.isArray(contract.modes) && contract.modes.length ? contract.modes : ["light"];
  const names = isRecord(contract.members) && Array.isArray(contract.members.names) ? contract.members.names : Object.keys(contract.emit ?? {});
  const emit = isRecord(contract.emit) ? contract.emit : {};
  const members = isRecord(spec.members) ? spec.members : {};
  const given = Object.keys(members);
  const unknown = given.filter(name => !names.includes(name));
  if (unknown.length) throw new Error(`members ${unknown.join(", ")} are not in the contract's closed set (${names.join(", ")})`);
  const absent = names.filter(name => !given.includes(name));
  if (absent.length) throw new Error(`members ${absent.join(", ")} have no value; the contract names ${names.join(", ")}`);
  if (typeof spec.reason !== "string" || !/director:[a-z]/.test(spec.reason)) throw new Error("spec.reason must cite director:<trait> (a reference value is a base, not a reason)");
  if (!isRecord(spec.source) || typeof spec.source.kind !== "string") throw new Error("spec.source must give kind, ref[] and license");

  const scope = spec.cssScope === "theme" ? "theme" : undefined;
  const cssVars = {};
  const tokens = {};
  for (const name of names) {
    const raw = members[name];
    const byMode = isRecord(raw) && Object.keys(raw).length && Object.keys(raw).every(key => modes.includes(key)) ? raw : { [modes[0]]: raw };
    for (const mode of modes) if (byMode[mode] === undefined) throw new Error(`member ${name} has no ${mode} value; the contract's modes are ${modes.join(", ")}`);
    const first = byMode[modes[0]];
    const extensions = { "com.clossys.css": { raw: cssOf(type, first) } };
    if (modes.length > 1) extensions["com.clossys.modes"] = Object.fromEntries(modes.slice(1).map(mode => [mode, dtcgOf(type, byMode[mode])]));
    const provenance = isRecord(spec.provenance) ? spec.provenance[name] : undefined;
    if (isRecord(provenance)) extensions["com.clossys.provenance"] = provenance;
    const font = isRecord(spec.font) ? spec.font[name] : undefined;
    if (isRecord(font)) extensions["com.clossys.font"] = font;
    tokens[name] = { $type: type, $value: dtcgOf(type, first), $extensions: extensions };
    const variable = typeof emit[name] === "string" ? emit[name].replace(/^--/, "") : undefined;
    if (!variable || type === "fontFamily") continue;
    for (const mode of scope ? ["theme"] : modes) {
      cssVars[mode] ??= {};
      cssVars[mode][variable] = cssOf(type, scope ? first : byMode[mode]);
    }
  }
  const creator = isRecord(spec.creator) ? spec.creator : { agent: "designer" };
  const element = {
    id: leaf, package: "designer", layer: "themes", slot, kind: "registry:theme",
    license: typeof spec.source.license === "string" ? spec.source.license : "MIT",
    creator: { agent: "designer", ...creator },
    reason: spec.reason,
    ...(typeof spec.createdAt === "string" ? { createdAt: spec.createdAt } : {}),
    deps: { npm: {}, registry: [] },
    reads: { copyKeys: [], themeVars: [] },
  };
  const item = {
    name: leaf,
    type: "registry:theme",
    ...(Array.isArray(spec.dependencies) && spec.dependencies.length ? { dependencies: [...spec.dependencies] } : {}),
    ...(Object.keys(cssVars).length ? { cssVars } : {}),
    files: [{ path: `clossys/${slot}.json`, type: "registry:file", content: `${JSON.stringify({ themes: { [leaf]: sorted(tokens) } }, null, 2)}\n` }],
    meta: { slot, source: sorted(spec.source), element },
  };
  return item;
}

/** The candidate bytes for `spec` read against the slot's contract under `root`. */
export function generateBytes(spec, root) {
  const slotDoc = JSON.parse(readFileSync(join(root, "clossys", "agents", "designer", spec.slot, "slot.json"), "utf8"));
  return `${JSON.stringify(generate(spec, slotDoc.contract), null, 2)}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--root");
  const root = at >= 0 ? resolve(args[at + 1] ?? ".") : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  if (at >= 0) args.splice(at, 2);
  if (args.length !== 1) { process.stderr.write("Usage: node generate.mjs <spec.json> [--root <dir>]\n"); process.exitCode = 2; }
  else {
    try { process.stdout.write(generateBytes(JSON.parse(readFileSync(resolve(args[0]), "utf8")), root)); }
    catch (error) { process.stderr.write(`create.tokens generate: ${error.message}\n`); process.exitCode = 1; }
  }
}
