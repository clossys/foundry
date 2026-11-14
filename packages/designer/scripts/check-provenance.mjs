#!/usr/bin/env node
/**
 * Provenance check over a consumer's Designer slots (read-only).
 *
 *   node check-provenance.mjs --root <consumer>/clossys            pins + pending options
 *   node check-provenance.mjs --root <consumer>/clossys --all      every candidate
 *   node check-provenance.mjs --root <consumer>/clossys --element <slot>/<candidate>.json
 *                                                                  one candidate, strict (pin gate)
 *   node check-provenance.mjs --scan <dir>                         every element.json under dir;
 *                                                                  `__fixtures__` records are exempt
 *
 * Rule (src/catalog/rules/provenance.json): every item version is adopted
 * (`verbatim`) or customized (`customized`) from a trusted reference. Its
 * `lineage.source` names registry, item, version and hash; the registry is one of
 * references/manifest.json `registries` and the item, version and hash match a
 * manifest item. Fonts come from a `registry:font` item (shadcn or Fontsource);
 * themes from a shadcn theme preset. `original` is allowed only in a consumer-asset
 * slot (logo, brand marks, consumer media).
 *
 * Pins and candidates come only from the one slot-model reader (slot-pins.mjs). Default
 * scope is what the consumer pins or proposes: every pin and the newest unpinned
 * candidate of each slot (an option); a slot marked not needed proposes nothing. A pinned violator whose slot has a
 * passing pending option is reported as pending replacement, not failed: the owner
 * approves the pin. Exit 1 on any violation, 2 on a usage error.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { designerPins, pinLabel } from "./slot-pins.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const json = path => JSON.parse(readFileSync(path, "utf8"));

export function loadRule(path = join(packageRoot, "src/catalog/rules/provenance.json")) {
  return json(path);
}

export function loadManifest(path = join(packageRoot, "references/manifest.json")) {
  return json(path);
}

/**
 * The provenance logic lives in Producer's certify/source.ts (R03, slot-constitution.md W2-C), so
 * every agent's adopt check runs the same code; this script calls it. Producer is an optional
 * package, resolved by its public specifier as slot-pins.mjs does: only an unresolvable specifier
 * means Producer is absent (a named error on first use); once it resolves, a load error is real.
 */
const SOURCE_ANCHOR = "@clossys/producer/records/slots";
let sourceDir;
let sourceMissing;
try { sourceDir = new URL("../constitution/certify/", import.meta.resolve(SOURCE_ANCHOR)).href; }
catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND" && error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
  sourceMissing = error;
}
// A string-shaped `.js` specifier: a bundler's dev transform must not prepend a helper import above
// this file's shebang (it does for an opaque expression), so the script still parses under Vite.
const lifted = sourceDir ? await import(/* @vite-ignore */ `${sourceDir}source.js`) : undefined;
function source() {
  if (!lifted) throw new Error(`check-provenance runs Producer's certify/source.ts; install @clossys/producer (${SOURCE_ANCHOR} could not be resolved: ${sourceMissing?.message})`, { cause: sourceMissing });
  return lifted;
}

/** Findings for one item version's lineage against the rule and the manifest (certify/source.ts). */
export function lineageFindings(label, lineage, { rule = loadRule(), manifest = loadManifest() } = {}) {
  return source().lineageFindings(label, lineage, { rule, manifest });
}

/**
 * Lineage of one Designer candidate (registry item), certify/source.ts: `original` stays original,
 * `registry` is a verbatim adoption, `derived` is customized. `composition` and `npm` candidates are
 * verified by check-ref-verbatim: null here.
 */
export function candidateLineage(slot, item) {
  return source().candidateLineage(slot, item);
}

/** slot.json `notNeeded {reason, since, decidedBy}` as the slot loader accepts it (a malformed marker is not one). */
const notNeededSlot = doc => {
  const marker = doc?.notNeeded;
  return !!marker && typeof marker === "object" && ["reason", "since", "decidedBy"].every(field => typeof marker[field] === "string" && marker[field] !== "");
};

/**
 * Provenance of a consumer root (`<consumer>/clossys`), over the Designer slot pins read through
 * the one slot-model reader. Default scope is every pin and the newest unpinned candidate of each
 * slot (an option); `all` checks every candidate.
 * Returns { violations, pending, checked } where pending lists pinned violators whose
 * slot has a passing pending option.
 */
export function provenanceFindings(root, { all = false, rule = loadRule(), manifest = loadManifest(), entries = designerPins(root, { all: true }) } = {}) {
  const check = entry => {
    if (entry.error) return [`${pinLabel(entry)}: ${entry.error}`];
    const lineage = candidateLineage(entry.slot, entry.item);
    return lineage ? lineageFindings(pinLabel(entry), lineage, { rule, manifest }) : [];
  };
  if (all) return { violations: entries.flatMap(check), pending: [], checked: entries.map(pinLabel) };
  const bySlot = new Map();
  for (const entry of entries) bySlot.set(entry.slot, [...(bySlot.get(entry.slot) ?? []), entry]);
  const violations = [];
  const pending = [];
  const checked = [];
  for (const [, list] of bySlot) {
    const pinned = list.find(entry => entry.pin);
    const newest = list.at(-1);
    // A slot the consumer marked not needed (slot.json `notNeeded`, no pin: the one loader's `not-needed`
    // state) proposes nothing, so it has no option; `--all` still checks its candidates.
    const declined = !pinned && notNeededSlot(newest?.slotDoc);
    const option = newest && !declined && !newest.pin && (!pinned || list.indexOf(newest) > list.indexOf(pinned)) ? newest : undefined;
    let optionOk = false;
    if (option) {
      const found = check(option);
      optionOk = found.length === 0;
      violations.push(...found.map(f => `option ${f}`));
      checked.push(pinLabel(option));
    }
    if (pinned) {
      const found = check(pinned);
      if (found.length && optionOk) pending.push(...found.map(f => `pin ${f} (pending replacement by the slot's option)`));
      else violations.push(...found.map(f => `pin ${f}`));
      checked.push(pinLabel(pinned));
    }
  }
  return { violations, pending, checked };
}

/** One candidate, strict: the gate the Designer skill runs before it pins (`<slot>/<candidate>`). */
export function elementFindings(root, spec, { rule = loadRule(), manifest = loadManifest() } = {}) {
  const m = /^([a-z0-9-]+(?:\.[a-z0-9-]+)+)\/([a-z0-9][a-z0-9.-]*-v[1-9][0-9]*\.json)$/.exec(spec);
  if (!m) throw new Error(`--element must be <slot>/<candidate>.json, got ${spec}`);
  const entry = designerPins(root, { all: true }).find(row => row.slot === m[1] && row.candidate.name === m[2]);
  if (!entry) return [`${spec}: no such Designer candidate`];
  if (entry.error) return [`${spec}: ${entry.error}`];
  const lineage = candidateLineage(entry.slot, entry.item);
  return lineage ? lineageFindings(spec, lineage, { rule, manifest }) : [];
}

/** Every clossys.element/1 record under dir. Records inside `__fixtures__` are test fixtures: listed, exempt. */
export function scanFindings(dir, { rule = loadRule(), manifest = loadManifest() } = {}) {
  const violations = [];
  const exempt = [];
  let checked = 0;
  const visit = at => {
    for (const name of readdirSync(at).sort()) {
      if (name === "node_modules" || name === "dist" || name === ".git") continue;
      const full = join(at, name);
      const stat = statSync(full);
      if (stat.isDirectory()) visit(full);
      else if (name === "element.json") {
        let record;
        try { record = json(full); } catch { continue; }
        if (record?.schema !== "clossys.element/1") continue;
        const rel = relative(dir, full).split(sep).join("/");
        if (rel.split("/").includes("__fixtures__")) { exempt.push(rel); continue; }
        checked++;
        violations.push(...lineageFindings(rel, { slot: record.slot, mode: record.lineage?.mode, source: record.lineage?.source, parts: record.lineage?.parts }, { rule, manifest }));
      }
    }
  };
  visit(dir);
  return { violations, exempt, checked };
}

const USAGE = "usage: check-provenance.mjs --root <consumer>/clossys [--all | --element <slot>/<candidate>.json] | --scan <dir> [--manifest <references/manifest.json>]";

function main(argv) {
  if (argv.includes("--help")) { console.log(USAGE); return 0; }
  const value = flag => {
    const at = argv.indexOf(flag);
    return at < 0 ? undefined : argv[at + 1];
  };
  const root = value("--root");
  const scan = value("--scan");
  const manifestPath = value("--manifest");
  if (!root && !scan) {
    console.error(USAGE);
    return 2;
  }
  const options = { rule: loadRule(), manifest: loadManifest(manifestPath ? resolve(manifestPath) : undefined) };
  if (scan) {
    const result = scanFindings(resolve(scan), options);
    if (result.violations.length) {
      console.error(`check-provenance: FAIL (${result.violations.length})\n- ${result.violations.join("\n- ")}`);
      return 1;
    }
    console.log(`check-provenance: ok; ${result.checked} record(s) referenced, ${result.exempt.length} fixture record(s) exempt`);
    return 0;
  }
  const element = value("--element");
  if (element) {
    const findings = elementFindings(resolve(root), element, options);
    if (findings.length) {
      console.error(`check-provenance: REFUSE pin (${findings.length})\n- ${findings.join("\n- ")}`);
      return 1;
    }
    console.log(`check-provenance: ok; ${element} is from a trusted reference or is a consumer asset`);
    return 0;
  }
  const result = provenanceFindings(resolve(root), { ...options, all: argv.includes("--all") });
  for (const p of result.pending) console.log(`pending: ${p}`);
  if (result.violations.length) {
    console.error(`check-provenance: FAIL (${result.violations.length})\n- ${result.violations.join("\n- ")}`);
    return 1;
  }
  console.log(`check-provenance: ok; ${result.checked.length} candidate(s) checked, ${result.pending.length} pinned violator(s) pending replacement`);
  return 0;
}

// Resolve argv[1] so a node_modules/.bin symlink launch still runs the CLI.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
