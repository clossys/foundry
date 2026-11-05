#!/usr/bin/env node
/**
 * Section shell lint over a consumer's pinned Designer slots (read-only).
 *
 *   node check-section-tokens.mjs --root <consumer>/clossys [--components <components.json>]
 *
 * `--components` names the consumer components.json the stock comparison replays the CLI add-time
 * rewrites with (as check-ref-verbatim --components); without it the root and its parent are read.
 * A consumer whose components.json lives elsewhere gets no stock exemption without it.
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
 * Pins are read only through the one slot-model reader (slot-pins.mjs).
 * `registry:ui|hook|lib` files are reference primitives and are not linted. The
 * one other exemption is stock code: a file of a `registry` candidate is skipped
 * only when the strict designer-ref-verbatim check passes for the candidate and
 * that file equals, with no hunk, the vendored reference file its
 * `meta.refVerbatim.files` maps it to. The shell rule is skipped only when every code file is such stock.
 * Exit 1 on any finding.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CODE_FILE, checkRegistryItem } from "./check-ref-verbatim.mjs";
import { designerSlotRecords } from "./slot-pins.mjs";

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

const codeFiles = item => (item.files ?? []).filter(file => CODE_FILE.test(file.path ?? ""));

/**
 * Code files of one pinned candidate that are byte-identical stock: the strict ref-verbatim check
 * passes for the candidate and each returned file equals, with no hunk, the vendored reference file
 * its `meta.refVerbatim.files` maps it to (raw or after the CLI add-time rewrites). Anything else is linted.
 */
export function stockFiles(root, entry, options = {}) {
  const stock = new Set();
  const code = codeFiles(entry.item);
  if (!code.length || entry.item.meta?.source?.kind !== "registry") return stock;
  try {
    const strict = checkRegistryItem(root, entry.slot, entry.item, { ...options, strict: true, slotDoc: entry.slotDoc });
    if (strict.status !== "pass" || strict.findings.length) return stock;
    const checked = new Map(strict.files.map(row => [row.file, row]));
    for (const file of code) {
      const row = checked.get(file.path);
      // Stock bytes: a recorded mapping with no hunk at all; an adapted file passes ref-verbatim but is linted.
      if (row?.status === "pass" && row.mapping === "recorded" && Array.isArray(row.hunks) && row.hunks.length === 0) stock.add(file.path);
    }
  } catch {
    return new Set();
  }
  return stock;
}

/** Item files the lint reads: code that is neither byte-identical stock nor a ui/hook/lib primitive. */
export function lintableFiles(item, stock = new Set()) {
  return codeFiles(item)
    .filter(file => !stock.has(file.path) && !/^registry:(?:ui|hook|lib)$/.test(file.type))
    .map(file => [file.path, String(file.content ?? "")]);
}

/** The element name a pinned candidate composes as (`@<ns>/<element>`). */
const elementOf = entry => entry.item.meta?.element?.id ?? entry.item.name;

/** Every finding for a consumer root (`<consumer>/clossys`); pins come only from the one slot-model reader. */
export function sectionShellFindings(root, catalog = loadCatalog(), options = {}) {
  const findings = [];
  const records = options.records ?? designerSlotRecords(root);
  const itemOf = slot => {
    const record = records.get(slot);
    return record?.pinned.item ? { slot, pin: record.pinned.pin, item: record.pinned.item, slotDoc: record.slotDoc } : null;
  };
  const pinnedSlots = [...records].filter(([, record]) => record.pinned.pin || record.pinned.error !== "is not pinned").map(([slot]) => slot);
  const band = itemOf("sections.band");
  const header = itemOf("sections.section-header");
  const bandContract = catalog.contracts.get("sections.band");
  if (!band) findings.push("shell: sections.band has no pinned item; every section composes it");
  else {
    const emitted = new Set(Object.keys(band.item.cssVars?.theme ?? {}).map(name => `--${name}`));
    for (const token of String(bandContract?.limits?.["emits.theme"] ?? "").split(",").filter(Boolean)) {
      if (!emitted.has(token)) findings.push(`shell: ${elementOf(band)} does not emit ${token} in cssVars.theme`);
    }
  }
  for (const slot of pinnedSlots.sort()) {
    const anatomy = catalog.anatomy.get(slot);
    const measure = catalog.contracts.get(slot)?.limits?.["compose.measure"];
    if (!anatomy?.band && !measure) continue;
    const entry = itemOf(slot);
    if (!entry) { findings.push(`shell: ${slot} pin ${records.get(slot).pinned.error}`); continue; }
    const stock = stockFiles(root, entry, options);
    const code = codeFiles(entry.item);
    if (code.length && code.every(file => stock.has(file.path))) continue;
    const element = elementOf(entry);
    const deps = new Set(entry.item.registryDependencies ?? []);
    const named = target => [...deps].some(dep => new RegExp(`^@[a-z0-9-]+/${elementOf(target)}$`).test(dep));
    if (band && !named(band)) findings.push(`shell: ${element} (${slot}) does not depend on the band ${elementOf(band)}`);
    if (anatomy?.header && header && slot !== "sections.section-header" && !named(header)) findings.push(`shell: ${element} (${slot}) does not depend on the section header ${elementOf(header)}`);
    if (anatomy?.header && !header) findings.push(`shell: ${slot} composes sections.section-header, which has no pinned item`);
    findings.push(...tokenFindings(element, lintableFiles(entry.item, stock)));
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
  const usage = "usage: check-section-tokens.mjs --root <consumer>/clossys [--components <components.json>]";
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) { console.log(usage); process.exit(0); }
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--root", "--components"].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith("--") || flags.has(argv[i])) { console.error(usage); process.exit(2); }
    flags.set(argv[i], argv[i + 1]);
  }
  if (!flags.has("--root")) { console.error(usage); process.exit(2); }
  const components = flags.has("--components") ? resolve(flags.get("--components")) : undefined;
  if (components && !existsSync(components)) { console.error(`check-section-tokens: --components ${components} does not exist`); process.exit(2); }
  const findings = sectionShellFindings(resolve(flags.get("--root")), loadCatalog(), { components });
  if (findings.length) { console.error(`check-section-tokens: FAIL (${findings.length})\n- ${findings.join("\n- ")}`); process.exit(1); }
  console.log("check-section-tokens: ok; shell, spacing, type, size, bleed");
}
