#!/usr/bin/env node
/**
 * Section shell lint over a consumer library (read-only).
 *
 *   node check-section-tokens.mjs --root <consumer>/clossys
 *
 * For every pinned item whose slot composes `sections.band` (catalog anatomy) or
 * whose frame contract names `compose.measure`, the item must:
 *   - shell     list the pinned band (and, when the anatomy names it, the pinned
 *               section header) in `registryDependencies` as `@<ns>/<element>`;
 *   - spacing   take section padding and container width from the band tokens:
 *               no numeric spacing at section scale (12 and up), no named container
 *               width of 3xl and up, no `container`;
 *   - type      take display, heading, title, lead and figure sizes from the band
 *               type tokens: no `text-xl` and larger;
 *   - size      write no arbitrary length (`w-[36rem]`, `w-[200vw]`), no content-
 *               sized min width (`min-w-max`), no viewport width;
 *   - bleed     write no negative horizontal position offset, and no negative
 *               horizontal margin of 6 and up (small optical nudges stay).
 * The pinned band item must emit every token its contract names in `emits.theme`
 * through `cssVars.theme`.
 *
 * Verbatim vendored files (`meta.verbatim`) and `registry:ui|hook|lib` files are
 * reference primitives and are not linted. A verbatim stock pick (`meta.source.kind:
 * registry`, every code file mapped in `meta.refVerbatim.files`) keeps the reference's own
 * markup and classes, which designer-ref-verbatim gates; its mapped files are not linted
 * and it is not required to compose the band. Exit 1 on any finding.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const json = path => JSON.parse(readFileSync(path, "utf8"));

/** Class-like tokens in every string literal, variants and opacity modifiers removed. */
export function classTokens(code) {
  const clean = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const tokens = new Set();
  for (const m of clean.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) {
    for (const raw of (m[1] ?? m[2] ?? m[3]).split(/\s+/)) {
      if (!raw) continue;
      let depth = 0, cut = -1;
      for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch === "[" || ch === "(") depth++;
        else if (ch === "]" || ch === ")") depth--;
        else if (ch === ":" && depth === 0) cut = i;
      }
      tokens.add(raw.slice(cut + 1).replace(/^!|!$/g, "").replace(/\/(?:\d+|\[[^\]]*\]|\([^)]*\))$/, ""));
    }
  }
  return tokens;
}

const SECTION_SPACING = /^-?(?:p|m)[xytbse]?-(\d+(?:\.\d+)?)$|^(?:gap(?:-[xy])?|space-[xy])-(\d+(?:\.\d+)?)$/;
const CONTAINER = /^(?:container|max-w-(?:[3-7]xl|screen(?:-\w+)?))$/;
const TYPE = /^text-(?:xl|[2-9]xl)$/;
const ARBITRARY = /^-?(?:w|min-w|max-w|h|min-h|max-h|size|text|p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|inset(?:-[xy])?|top|right|bottom|left|start|end|translate-[xy]|basis|leading)-\[[^\]]*(?:\d(?:px|rem|em|ch|vw|vh|svw|dvw|%)|vw)[^\]]*\]$/;
const CONTENT_WIDTH = /^(?:min-w-(?:max|fit)|w-(?:max|screen)|min-w-screen)$/;
const BLEED = /^-(?:inset(?:-x)?|left|right|start|end|translate-x)-|^-m[xlrse]?-(?:[6-9]|\d{2,})(?:\.\d+)?$/;

/** Findings for one item's lintable code: `[file, source]` pairs. */
export function tokenFindings(element, files) {
  const findings = [];
  for (const [file, source] of files) {
    for (const token of classTokens(source)) {
      const at = `${element} ${file}: ${token}`;
      const spacing = SECTION_SPACING.exec(token);
      if (spacing && Number(spacing[1] ?? spacing[2]) >= 12) findings.push(`spacing: ${at} is section-scale spacing; use the band rhythm tokens (py-section, mt-stack, gap-stack)`);
      else if (CONTAINER.test(token)) findings.push(`spacing: ${at} is a container width; use the band measure (max-w-measure*)`);
      else if (TYPE.test(token)) findings.push(`type: ${at} is a ramp size; use text-display, text-heading, text-title, text-lead or text-figure`);
      else if (ARBITRARY.test(token)) findings.push(`size: ${at} is an arbitrary length`);
      else if (CONTENT_WIDTH.test(token)) findings.push(`size: ${at} sizes to content or viewport and can overflow the page`);
      else if (BLEED.test(token)) findings.push(`bleed: ${at} offsets past the measure`);
    }
  }
  return findings;
}

/** Item files the lint reads: code that is neither verbatim vendored nor a ui/hook/lib primitive. */
/** Code files of a verbatim stock pick: a `registry` source whose files are mapped to the reference. */
export function verbatimPickFiles(item) {
  if (item.meta?.source?.kind !== "registry") return new Set();
  const mapped = item.meta?.refVerbatim?.files;
  return new Set(mapped && typeof mapped === "object" ? Object.keys(mapped) : []);
}

/** True when every code file of the item is a mapped verbatim reference file. */
export function isVerbatimPick(item) {
  const mapped = verbatimPickFiles(item);
  const code = (item.files ?? []).filter(file => /\.(?:tsx?|jsx?)$/.test(file.path));
  return code.length > 0 && code.every(file => mapped.has(file.path));
}

export function lintableFiles(item, dir) {
  const verbatim = new Set([...(item.meta?.verbatim ?? []).map(row => row.file), ...verbatimPickFiles(item)]);
  return (item.files ?? [])
    .filter(file => /\.(?:tsx?|jsx?)$/.test(file.path) && !verbatim.has(file.path) && !/^registry:(?:ui|hook|lib)$/.test(file.type))
    .map(file => [file.path, readFileSync(join(dir, file.path), "utf8")]);
}

/** Every finding for a consumer root (`<consumer>/clossys`). */
export function sectionShellFindings(root, catalog = loadCatalog()) {
  const findings = [];
  const selection = json(join(root, "selection.json"));
  const pins = selection.pins ?? {};
  const itemOf = slot => {
    const pin = pins[slot];
    if (!pin) return null;
    const dir = join(root, "library", slot, pin.element, `v${pin.version}`);
    const file = join(dir, "registry-item.json");
    return existsSync(file) ? { slot, pin, dir, item: json(file) } : null;
  };
  const band = itemOf("sections.band");
  const header = itemOf("sections.section-header");
  const bandContract = catalog.contracts.get("sections.band");
  if (!band) findings.push("shell: sections.band has no pinned item; every section composes it");
  else {
    const emitted = new Set(Object.keys(band.item.cssVars?.theme ?? {}).map(name => `--${name}`));
    for (const token of String(bandContract?.limits?.["emits.theme"] ?? "").split(",").filter(Boolean)) {
      if (!emitted.has(token)) findings.push(`shell: ${band.pin.element} does not emit ${token} in cssVars.theme`);
    }
  }
  for (const slot of Object.keys(pins).sort()) {
    const anatomy = catalog.anatomy.get(slot);
    const measure = catalog.contracts.get(slot)?.limits?.["compose.measure"];
    if (!anatomy?.band && !measure) continue;
    const entry = itemOf(slot);
    if (!entry) { findings.push(`shell: ${slot} pin has no library item`); continue; }
    if (isVerbatimPick(entry.item)) continue;
    const deps = new Set(entry.item.registryDependencies ?? []);
    const named = target => [...deps].some(dep => new RegExp(`^@[a-z0-9-]+/${target.pin.element}$`).test(dep));
    if (band && !named(band)) findings.push(`shell: ${entry.pin.element} (${slot}) does not depend on the band ${band.pin.element}`);
    if (anatomy?.header && header && slot !== "sections.section-header" && !named(header)) findings.push(`shell: ${entry.pin.element} (${slot}) does not depend on the section header ${header.pin.element}`);
    if (anatomy?.header && !header) findings.push(`shell: ${slot} composes sections.section-header, which has no pinned item`);
    findings.push(...tokenFindings(entry.pin.element, lintableFiles(entry.item, entry.dir)));
  }
  return findings;
}

export function loadCatalog() {
  const slots = [...json(join(packageRoot, "src/catalog/slots/sections.json")), ...json(join(packageRoot, "src/catalog/slots/frames.json"))];
  const contracts = [...json(join(packageRoot, "src/catalog/slot-contracts/sections.json")), ...json(join(packageRoot, "src/catalog/slot-contracts/frames.json"))];
  return {
    anatomy: new Map(slots.map(slot => [slot.id, slot.contract?.anatomy ?? null])),
    contracts: new Map(contracts.map(row => [row.slot, row])),
  };
}

// Resolve argv[1] so a node_modules/.bin symlink launch still runs the CLI.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const usage = "usage: check-section-tokens.mjs --root <consumer>/clossys";
  if (process.argv.includes("--help")) { console.log(usage); process.exit(0); }
  const at = process.argv.indexOf("--root");
  if (at < 0 || !process.argv[at + 1]) { console.error(usage); process.exit(2); }
  const findings = sectionShellFindings(resolve(process.argv[at + 1]));
  if (findings.length) { console.error(`check-section-tokens: FAIL (${findings.length})\n- ${findings.join("\n- ")}`); process.exit(1); }
  console.log("check-section-tokens: ok; shell, spacing, type, size, bleed");
}
