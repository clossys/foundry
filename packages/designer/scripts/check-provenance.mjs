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

const globMatch = (pattern, slot) => pattern.endsWith("*") ? slot.startsWith(pattern.slice(0, -1)) : pattern === slot;

/** One reference (the source, or a part) against the manifest: trusted registry, listed item, same hash. Returns the manifest row. */
function referenceFindings(label, at, ref, manifest, findings, { hashed = true } = {}) {
  const missing = ["registry", "item", "version", ...(hashed ? ["hash"] : [])].filter(field => typeof ref?.[field] !== "string" || ref[field] === "");
  if (missing.length) { findings.push(...missing.map(field => `${label}: ${at} has no ${field}`)); return undefined; }
  const key = `${ref.registry}/${ref.item}@${ref.version}`;
  if (!manifest.registries?.[ref.registry]) { findings.push(`${label}: ${key} is from ${ref.registry}, which is not a trusted registry (references/manifest.json)`); return undefined; }
  const found = (manifest.items ?? []).find(row => row.registry === ref.registry && row.name === ref.item && row.version === ref.version);
  if (!found) { findings.push(`${label}: ${key} is not in the references manifest`); return undefined; }
  if (hashed && found.hash !== ref.hash) findings.push(`${label}: ${key} hash ${ref.hash} != manifest ${found.hash}`);
  return found;
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
  for (const ref of lineage.unresolved ?? []) findings.push(`${label}: lineage cites ${typeof ref === "string" ? ref : JSON.stringify(ref)}, which is not a reference-manifest row id (<registry>/<item>@<version>)`);
  if (!source) return [...findings, `${label}: ${mode} item has no lineage.source`];
  const found = referenceFindings(label, "lineage.source", source, manifest, findings);
  if (!found) return findings;
  for (const [index, part] of (lineage.parts ?? []).entries()) referenceFindings(label, `lineage.parts[${index}]`, part, manifest, findings, { hashed: lineage.partsHashed !== false || typeof part?.hash === "string" });
  const cls = (rule.classes ?? []).find(row => globMatch(row.slots, slot ?? ""));
  if (cls) {
    const typed = (cls.sourceTypes ?? []).includes(found.type);
    const named = (cls.sourceItems ?? []).includes(`${source.registry}/${source.item}`);
    if (!typed && !named) findings.push(`${label}: ${slot} must come from ${[...(cls.sourceTypes ?? []), ...(cls.sourceItems ?? [])].join(" or ")}; ${source.registry}/${source.item}@${source.version} is ${found.type}`);
  }
  return findings;
}

/** One `source.ref` entry as a reference-manifest row id, `<registry>/<item>@<version>`; anything else is null (unresolved). */
function parseRef(ref) {
  if (typeof ref !== "string") return null;
  const m = /^([^/@{}\s]+)\/([^@{}\s]+)@([^@{}\s]+)$/.exec(ref);
  return m ? { registry: m[1], item: m[2], version: m[3] } : null;
}

/** `source.ref` entries that all name the consumer's own Designer asset slots (`clossys/agents/designer/assets.<slot>[/candidates/<file>.json]`). */
const CONSUMER_ASSET_REF = /^clossys\/agents\/designer\/assets\.[a-z0-9-]+(?:\/candidates\/[a-z0-9-]+-v[1-9][0-9]*\.json)?$/;
const consumerOwnDerivation = refs => Array.isArray(refs) && refs.length > 0 && refs.every(ref => typeof ref === "string" && CONSUMER_ASSET_REF.test(ref));

/**
 * Lineage of one Designer candidate (registry item): `original` stays original, `registry` is a
 * verbatim adoption, `derived` is customized; the first reference is the source, the rest are parts.
 * `composition` and `npm` candidates cite pinned slots or an npm package, not a registry item, and
 * are verified by check-ref-verbatim: null here.
 */
export function candidateLineage(slot, item) {
  const source = item?.meta?.source ?? {};
  if (source.kind === "original") return { slot, mode: "original" };
  if (source.kind === "composition" || source.kind === "npm") return null;
  // Derived only from the consumer's own Designer asset slots (no registry item, no outside file): the
  // consumer's own artwork, so it is an original and passes only in a consumer-asset slot.
  if (source.kind === "derived" && consumerOwnDerivation(source.ref)) return { slot, mode: "original" };
  const mode = source.kind === "registry" ? "verbatim" : source.kind === "derived" ? "customized" : source.kind;
  // Derived and adopted lineage cites reference-manifest row ids (and the consumer's own asset
  // slots) only: any other entry (a JSON object, a self-lineage version, a file path) is an
  // unresolved citation and fails.
  const cited = Array.isArray(source.ref) ? source.ref : [];
  const unresolved = cited.filter(ref => !parseRef(ref) && !(typeof ref === "string" && CONSUMER_ASSET_REF.test(ref)));
  const [first, ...parts] = cited.map(parseRef).filter(Boolean);
  // `source.hash` is the first reference's manifest hash; a further ref is a part named by registry, item and version.
  const ref = first ? { ...first, hash: source.hash } : first;
  // A candidate's part refs carry no hash of their own: they must still be trusted manifest items.
  return { slot, mode, source: ref, parts, partsHashed: false, unresolved };
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
