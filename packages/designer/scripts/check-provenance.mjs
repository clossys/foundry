#!/usr/bin/env node
/**
 * Provenance check over a consumer library (read-only).
 *
 *   node check-provenance.mjs --root <consumer>/clossys            pins + pending options
 *   node check-provenance.mjs --root <consumer>/clossys --all      every version directory
 *   node check-provenance.mjs --root <consumer>/clossys --element <slot>/<element>/v<N>
 *                                                                  one version, strict (pin gate)
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
 * Default scope is what the consumer pins or proposes: every pin and the newest
 * unpinned version of each element (an option). A pinned violator whose slot has a
 * passing pending option is reported as pending replacement, not failed: the owner
 * approves the pin. Exit 1 on any violation, 2 on a usage error.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const json = path => JSON.parse(readFileSync(path, "utf8"));

export function loadRule(path = join(packageRoot, "src/catalog/rules/provenance.json")) {
  return json(path);
}

export function loadManifest(path = join(packageRoot, "references/manifest.json")) {
  return json(path);
}

const globMatch = (pattern, slot) => pattern.endsWith("*") ? slot.startsWith(pattern.slice(0, -1)) : pattern === slot;

/** Lineage of one version directory: element.json, else the registry item's meta (not yet seeded). */
export function lineageOf(dir) {
  const element = join(dir, "element.json");
  if (existsSync(element)) {
    const record = json(element);
    return { slot: record.slot, mode: record.lineage?.mode, source: record.lineage?.source };
  }
  const item = join(dir, "registry-item.json");
  if (existsSync(item)) {
    const meta = json(item).meta ?? {};
    return { slot: meta.leaf, mode: meta.lineage, source: meta.reference };
  }
  return null;
}

/** Findings for one item version's lineage against the rule and the manifest. */
export function lineageFindings(label, lineage, { rule = loadRule(), manifest = loadManifest() } = {}) {
  const findings = [];
  const { slot, mode, source } = lineage;
  const asset = (rule.consumerAssets?.slots ?? []).some(pattern => globMatch(pattern, slot ?? ""));
  if (mode === "original") {
    if (!asset) findings.push(`${label}: original item in ${slot}, which is not a consumer-asset slot; adopt or customize a trusted reference, or raise a NEED`);
    return findings;
  }
  if (mode !== "verbatim" && mode !== "customized") return [`${label}: lineage.mode ${JSON.stringify(mode)} is not verbatim, customized or original`];
  if (!source) return [`${label}: ${mode} item has no lineage.source`];
  for (const field of ["registry", "item", "version", "hash"]) {
    if (typeof source[field] !== "string" || source[field] === "") findings.push(`${label}: lineage.source has no ${field}`);
  }
  if (findings.length) return findings;
  const key = `${source.registry}/${source.item}@${source.version}`;
  if (!manifest.registries?.[source.registry]) return [`${label}: ${key} is from ${source.registry}, which is not a trusted registry (references/manifest.json)`];
  const found = (manifest.items ?? []).find(row => row.registry === source.registry && row.name === source.item && row.version === source.version);
  if (!found) return [`${label}: ${key} is not in the references manifest`];
  if (found.hash !== source.hash) findings.push(`${label}: ${key} hash ${source.hash} != manifest ${found.hash}`);
  const cls = (rule.classes ?? []).find(row => globMatch(row.slots, slot ?? ""));
  if (cls) {
    const typed = (cls.sourceTypes ?? []).includes(found.type);
    const named = (cls.sourceItems ?? []).includes(`${source.registry}/${source.item}`);
    if (!typed && !named) findings.push(`${label}: ${slot} must come from ${[...(cls.sourceTypes ?? []), ...(cls.sourceItems ?? [])].join(" or ")}; ${key} is ${found.type}`);
  }
  return findings;
}

const versionDirs = libraryRoot => {
  const out = [];
  if (!existsSync(libraryRoot)) return out;
  for (const slot of readdirSync(libraryRoot).sort()) {
    const slotDir = join(libraryRoot, slot);
    if (!statSync(slotDir).isDirectory()) continue;
    for (const element of readdirSync(slotDir).sort()) {
      const elementDir = join(slotDir, element);
      if (!statSync(elementDir).isDirectory()) continue;
      for (const v of readdirSync(elementDir)) {
        const m = /^v(\d+)$/.exec(v);
        if (m) out.push({ slot, element, version: Number(m[1]), dir: join(elementDir, v) });
      }
    }
  }
  return out.sort((a, b) => a.slot.localeCompare(b.slot) || a.element.localeCompare(b.element) || a.version - b.version);
};

/**
 * Provenance of a consumer root (`<consumer>/clossys`).
 * Returns { violations, pending, checked } where pending lists pinned violators whose
 * slot has a passing pending option.
 */
export function provenanceFindings(root, { all = false, rule = loadRule(), manifest = loadManifest() } = {}) {
  const pins = existsSync(join(root, "selection.json")) ? json(join(root, "selection.json")).pins ?? {} : {};
  const dirs = versionDirs(join(root, "library"));
  const label = d => `${d.slot}/${d.element}@v${d.version}`;
  const check = d => {
    const lineage = lineageOf(d.dir);
    if (!lineage) return [`${label(d)}: no element.json or registry-item.json`];
    return lineageFindings(label(d), { ...lineage, slot: lineage.slot ?? d.slot }, { rule, manifest });
  };
  if (all) {
    const violations = dirs.flatMap(check);
    return { violations, pending: [], checked: dirs.map(label) };
  }
  const newest = new Map();
  for (const d of dirs) newest.set(`${d.slot}/${d.element}`, d);
  const pinned = dirs.filter(d => pins[d.slot]?.element === d.element && pins[d.slot]?.version === d.version);
  const options = [...newest.values()].filter(d => !(pins[d.slot]?.element === d.element && d.version <= pins[d.slot]?.version));
  const violations = [];
  const pending = [];
  const optionOk = new Map();
  for (const d of options) {
    const found = check(d);
    optionOk.set(d.slot, found.length === 0);
    violations.push(...found.map(f => `option ${f}`));
  }
  for (const d of pinned) {
    const found = check(d);
    if (found.length && optionOk.get(d.slot)) pending.push(...found.map(f => `pin ${f} (pending replacement by the slot's option)`));
    else violations.push(...found.map(f => `pin ${f}`));
  }
  for (const [slot, pin] of Object.entries(pins)) {
    if (!pinned.some(d => d.slot === slot)) violations.push(`pin ${slot}/${pin.element}@v${pin.version}: no library directory`);
  }
  return { violations, pending, checked: [...pinned, ...options].map(label) };
}

/** One version, strict: the gate the Designer skill runs before it pins. */
export function elementFindings(root, spec, { rule = loadRule(), manifest = loadManifest() } = {}) {
  const m = /^([a-z0-9-]+\.[a-z0-9-]+)\/([a-z0-9-]+)\/v(\d+)$/.exec(spec);
  if (!m) throw new Error(`--element must be <slot>/<element>/v<N>, got ${spec}`);
  const dir = join(root, "library", m[1], m[2], `v${m[3]}`);
  const lineage = lineageOf(dir);
  if (!lineage) return [`${spec}: no element.json or registry-item.json`];
  return lineageFindings(`${m[1]}/${m[2]}@v${m[3]}`, { ...lineage, slot: lineage.slot ?? m[1] }, { rule, manifest });
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
        violations.push(...lineageFindings(rel, { slot: record.slot, mode: record.lineage?.mode, source: record.lineage?.source }, { rule, manifest }));
      }
    }
  };
  visit(dir);
  return { violations, exempt, checked };
}

function main(argv) {
  const value = flag => {
    const at = argv.indexOf(flag);
    return at < 0 ? undefined : argv[at + 1];
  };
  const root = value("--root");
  const scan = value("--scan");
  const manifestPath = value("--manifest");
  if (!root && !scan) {
    console.error("usage: check-provenance.mjs --root <consumer>/clossys [--all | --element <slot>/<element>/v<N>] | --scan <dir> [--manifest <references/manifest.json>]");
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
  console.log(`check-provenance: ok; ${result.checked.length} version(s) checked, ${result.pending.length} pinned violator(s) pending replacement`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
