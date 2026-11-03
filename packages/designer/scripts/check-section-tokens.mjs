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
 * `registry:ui|hook|lib` files are reference primitives and are not linted. The
 * one other exemption is stock code: a file is skipped only when its bytes hash
 * to the manifest-verified vendored reference file that the version's
 * element.json maps it to in `lineage.source.files` (raw, or after the shadcn
 * CLI add-time rewrites), and the strict designer-ref-verbatim check passes for
 * that version with every registry-item.json code file in its payload. The shell
 * rule is skipped only when every code file is such stock. Self-declared `meta`
 * claims are never read. Exit 1 on any finding.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CODE_FILE, checkElement, defaults as refDefaults } from "./check-ref-verbatim.mjs";
import { configFromComponents, normalizeReference } from "./ref-verbatim/normalize.mjs";

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

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const codeFiles = item => (item.files ?? []).filter(file => CODE_FILE.test(file.path ?? ""));

/**
 * Code files of one library version that are byte-identical stock: the strict
 * ref-verbatim check passes for the version and covers every registry-item.json
 * code file, and each returned file's bytes hash to the vendored reference file
 * that element.json `lineage.source.files` maps it to (manifest-verified), raw or
 * after the CLI add-time rewrites. Anything else is linted.
 */
export function stockFiles(root, entry, options = {}) {
  const stock = new Set();
  const code = codeFiles(entry.item);
  const recordPath = join(entry.dir, "element.json");
  if (!code.length || !existsSync(recordPath)) return stock;
  try {
    const record = json(recordPath);
    const source = record.lineage?.source;
    const mapped = source?.files;
    if (!mapped || typeof mapped !== "object" || Array.isArray(mapped)) return stock;
    const strict = checkElement(root, { slot: entry.slot, element: entry.pin.element, version: entry.pin.version }, { ...options, strict: true });
    if (strict.status !== "pass" || strict.findings.length) return stock;
    const checked = new Map(strict.files.map(row => [row.file, row]));
    const payload = new Set(Array.isArray(record.payload) ? record.payload : []);
    // The strict pass must cover every code file the lint would read.
    if (!code.every(file => payload.has(file.path) && checked.get(file.path)?.status === "pass" && checked.get(file.path)?.mapping === "recorded")) return stock;
    const opts = refDefaults(options);
    const ref = (opts.manifest.items ?? []).find(row => row.registry === source.registry && row.name === source.item && row.version === source.version && row.hash === source.hash);
    if (!ref) return stock;
    const components = [options.components, join(root, "components.json"), join(root, "..", "components.json")].find(path => path && existsSync(path));
    const config = components ? configFromComponents(json(components)) : undefined;
    for (const file of code) {
      const path = mapped[file.path];
      const manifestFile = typeof path === "string" ? ref.files.find(row => row.path === path) : undefined;
      if (!manifestFile || checked.get(file.path)?.reference !== path) continue;
      const rawBytes = readFileSync(join(opts.referencesDir, ref.dir, path));
      if (sha256(rawBytes) !== manifestFile.sha256) continue;
      const stockHashes = new Set([manifestFile.sha256]);
      if (config) stockHashes.add(sha256(normalizeReference(rawBytes.toString("utf8"), path, config)));
      if (stockHashes.has(sha256(readFileSync(join(entry.dir, file.path))))) stock.add(file.path);
    }
  } catch {
    return new Set();
  }
  return stock;
}

/** Item files the lint reads: code that is neither byte-identical stock nor a ui/hook/lib primitive. */
export function lintableFiles(item, dir, stock = new Set()) {
  return codeFiles(item)
    .filter(file => !stock.has(file.path) && !/^registry:(?:ui|hook|lib)$/.test(file.type))
    .map(file => [file.path, readFileSync(join(dir, file.path), "utf8")]);
}

/** Every finding for a consumer root (`<consumer>/clossys`). */
export function sectionShellFindings(root, catalog = loadCatalog(), options = {}) {
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
    const stock = stockFiles(root, entry, options);
    const code = codeFiles(entry.item);
    if (code.length && code.every(file => stock.has(file.path))) continue;
    const deps = new Set(entry.item.registryDependencies ?? []);
    const named = target => [...deps].some(dep => new RegExp(`^@[a-z0-9-]+/${target.pin.element}$`).test(dep));
    if (band && !named(band)) findings.push(`shell: ${entry.pin.element} (${slot}) does not depend on the band ${band.pin.element}`);
    if (anatomy?.header && header && slot !== "sections.section-header" && !named(header)) findings.push(`shell: ${entry.pin.element} (${slot}) does not depend on the section header ${header.pin.element}`);
    if (anatomy?.header && !header) findings.push(`shell: ${slot} composes sections.section-header, which has no pinned item`);
    findings.push(...tokenFindings(entry.pin.element, lintableFiles(entry.item, entry.dir, stock)));
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
