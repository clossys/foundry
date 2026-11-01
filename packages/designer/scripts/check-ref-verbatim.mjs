#!/usr/bin/env node
/**
 * Ref-verbatim check over a consumer library (read-only, offline).
 *
 *   node check-ref-verbatim.mjs --root <consumer>/clossys --element <slot>/<element>/v<N>   one version, strict (pin gate)
 *   node check-ref-verbatim.mjs --root <consumer>/clossys --pinned                          every pin, against the baseline
 *   node check-ref-verbatim.mjs --root <consumer>/clossys --all                             every version directory
 *     [--components <components.json>] [--report <file>] [--release] [--json]
 *
 * Rule: every code file an element ships is the vendored reference file it
 * names in `lineage.source.files`, after the shadcn CLI 4.23.0 add-time
 * rewrites (ref-verbatim/normalize.mjs), plus only the allowed hunks
 * (ref-verbatim/diff.mjs): H-IMPORT, H-TOKEN, H-DATA, H-PROPS, H-LINK.
 * Anything else fails with one of the codes in CODES. check-provenance.mjs
 * stays the record-level gate; this check is the code-level one.
 *
 * `--pinned` and `--all` inventory, but never excuse, the pins listed in
 * scripts/ref-verbatim/baseline.json, which may only shrink: a row that is
 * not in BASELINE_CEILING below fails the run (REF-BASELINE). For legacy
 * records without `lineage.source.files`, reporting and pinning fail closed;
 * only direct non-strict checkElement callers may request an inferred mapping.
 * Exit 1 on any finding, 2 on a usage error.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configFromComponents, normalizeReference } from "./ref-verbatim/normalize.mjs";
import { replayDataFit } from "./ref-verbatim/data-fit.mjs";
import { ADAPTATION_KINDS, adaptationHash, recordedHunk, staticSingleOptionRow } from "./ref-verbatim/adaptations.mjs";
export { ADAPTATION_KINDS, adaptationHash };
import { diffSources, isEngineNeutral } from "./ref-verbatim/diff.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

export const CODES = [
  "REF-NO-SOURCE",
  "REF-NOT-VENDORED",
  "REF-FLAVOR",
  "REF-PRIMITIVE-AS-REF",
  "REF-FILE-UNMAPPED",
  "REF-HUNK-CLASS",
  "REF-HUNK-STRUCTURE",
  "REF-HUNK-LOGIC",
  "REF-HUNK-TEXT",
  "REF-NORMALIZE",
  "REF-ADAPTATION",
];

/**
 * Every row scripts/ref-verbatim/baseline.json may hold, frozen when the
 * gate landed (the pins that failed then). Rows may be removed from the
 * baseline file; a row that is not listed here fails the run. Never add here.
 */
export const BASELINE_CEILING = Object.freeze([
  "components.skip-nav/skip-nav@v1#sha256:2aa0a8d0170153bb145a14dfcc4414be82dc4b86c38b890313f18db61db8cdb4",
  "frames.module/studio-module@v1#sha256:fd088e6336f8d3b03fd0fc3c3ebdab6e00cfaf9f120e90fd2232b0879ebc7872",
  "frames.site-footer/site-footer@v1#sha256:8bc5d41e70c2a879f5ccd29b97de3d5fa0c90e53d9dfe010e8f078d77d17951a",
  "frames.site-header/site-header@v1#sha256:21873c6c01913cf9b82411b12edc70e3b2fb298e520d2fe5df5397d605787470",
  "frames.site-shell/site-shell@v1#sha256:bb5793e25c2d2bfd9c6b964f223ed57a14effb52461d08dcbaf2d1a7bef52969",
  "frames.studio-shell/studio-shell@v5#sha256:b5484448374b9371a86c7e2e536f4c6158f184423372d25c5af78257c598eb3f",
  "sections.call-to-action/call-to-action@v1#sha256:156749ca2971156ed2353984d4fb046892ee8178b9850a434b1292228fa29ba4",
  "sections.comparison/comparison@v2#sha256:54fc0a6f065560b2e673c0a61596935ceed7f321a95c33a19ba6440d6380f0c3",
  "sections.features/features@v2#sha256:7a9ac81716f754d208a1f9305542867202fff5f1c9f6dd74cb25f6d9bc7af390",
  "sections.form/contact-form@v2#sha256:56980397537f02cb18bebf7705a950fb4b70ad3b7938b42a9b2517e3d578e973",
  "sections.hero/hero@v2#sha256:0180f7b781628756e0ae46827e0698a9a931720112602eb35108739ea97fb6fc",
  "sections.legal-prose/legal-prose@v2#sha256:32491c726f5f6d9fc8b148467046f15677807d074ea3d794d52dc2a191db0aa3",
  "sections.module.checks/module-checks@v1#sha256:abf76369a04d24fa3c504b5532bd98c1e00a55b792d591960c73c5f1ceebbc2a",
  "sections.module.explorer/module-explorer@v1#sha256:f0211ba8426ad30640885ceaaf11d312207915d36efb1190ce7aa23f64cb78ae",
  "sections.module.outline/module-outline@v1#sha256:01362c221c9f471fb4898d428c92de8a3f9cacf97fdfe7b8c6cb27ddf3e24726",
  "sections.page-header/page-header@v1#sha256:ddd691fc0a52b28352617cd63b5a1f040ddfb823743d410de8a79f458deaed83",
  "sections.pricing/pricing@v2#sha256:a9549d9d33c878274c91f2624e9d8c20471d8cce4f2916b20de08f878c39599b",
  "sections.steps/steps@v2#sha256:64ce8fcb9a9200c4bbce8bcf35dc2f4debb07eecfb51b9c0ccc9be291bce0718",
  "sections.studio.agent-gallery/studio-agent-gallery@v3#sha256:d2eeb96c478da13e2a14bb9e4b0e4304ccaaea52121115279d921b10df5e899d",
  "sections.studio.checks/studio-checks@v1#sha256:c746dae76f3db9224c906705db343bbe1e3e96c4af4bb089f815ef23c8bf77e8",
  "sections.studio.contract/studio-contract@v1#sha256:4cccd0fd1ae6390804388a6b1a3c709bc23d4aba85835b2d668d3e3e2639741d",
  "sections.studio.history/studio-history@v1#sha256:afc0fc911775ac565e6df8a88abfd7ece8f5c3545f412355e157d2fd848aeee8",
  "sections.studio.home/studio-home@v2#sha256:3a8aa87264b75e35f5c566b305375ada8efc8d779e44d541c3ad1f3321c4c9b8",
  "sections.studio.leaf-header/studio-leaf-header@v1#sha256:1b61a0fc138401c99dc6de006a2b62e7d30f3c3ccf4c2c3f753a72e04e3503ab",
  "sections.studio.options/studio-options@v1#sha256:d04264150d45bf0d7ce1caeb0646b6605209d926198483640faf06c7ab2de369",
  "sections.studio.publications/studio-publications@v2#sha256:c2945681ba2ebbee6af2ec9d4b0d50ae07311d13ddf56b9cfad792f96c7f5948",
  "sections.studio.references/studio-references@v1#sha256:4faa7667cf6b9aa220ce982b4d9a502d39762e00ba2fa60906dfea7a98c103e5",
  "sections.studio.specimen/studio-specimen@v2#sha256:55b39a4888d8ba1da2e925dc93317b2c3f8b14322e3647247d7789f4db75c61b",
]);

const CODE_FILE = /\.(tsx|ts|jsx|js|mjs|cjs|mts|cts)$/;
const isCode = (file) => CODE_FILE.test(file) && !file.endsWith(".d.ts");
const globMatch = (pattern, slot) => (pattern.endsWith("*") ? slot.startsWith(pattern.slice(0, -1)) : pattern === slot);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const treeHash = (files) =>
  `sha256:${sha256(
    [...files]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((file) => `${file.sha256}  ${file.path}\n`)
      .join(""),
  )}`;

export const baselineKey = (row) => `${row.slot}/${row.element}@v${row.version}#${row.hash}`;

/** Engine family of a shadcn style: aria-nova → aria, radix-nova/new-york → radix, base-nova → base. */
export function engineFamily(style) {
  if (typeof style !== "string" || !style) return undefined;
  if (style.startsWith("aria")) return "aria";
  if (style.startsWith("base")) return "base";
  if (style.startsWith("radix") || style === "new-york" || style === "default") return "radix";
  return style;
}

export function defaults(overrides = {}) {
  return {
    manifest: overrides.manifest ?? json(join(packageRoot, "references/manifest.json")),
    referencesDir: overrides.referencesDir ?? join(packageRoot, "references"),
    rule: overrides.rule ?? json(join(packageRoot, "src/catalog/rules/provenance.json")),
    baselinePath: overrides.baselinePath ?? join(packageRoot, "scripts/ref-verbatim/baseline.json"),
    ceiling: overrides.ceiling ?? BASELINE_CEILING,
    components: overrides.components,
    linkComponents: overrides.linkComponents ?? [],
  };
}

function loadComponents(root, explicit) {
  const candidates = explicit ? [explicit] : [join(root, "components.json"), join(root, "..", "components.json")];
  for (const path of candidates) if (existsSync(path)) return { path, value: json(path) };
  return undefined;
}

const parseSpec = (spec) => {
  const m = /^([a-z0-9-]+(?:\.[a-z0-9-]+)+)\/([a-z0-9-]+)\/v(\d+)$/.exec(spec);
  if (!m) throw new Error(`--element must be <slot>/<element>/v<N>, got ${spec}`);
  return { slot: m[1], element: m[2], version: Number(m[3]) };
};

/**
 * Check one element version. `strict` (the pin gate) requires
 * `lineage.source.files`; otherwise a unique basename match is accepted and
 * reported as inferred.
 * @returns {{ key, slot, element, version, hash, status, files, findings }}
 */
function checkVersion(root, target, options = {}, versionInput) {
  const opts = defaults(options);
  const { slot, element, version } = typeof target === "string" ? parseSpec(target) : target;
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(slot) || !/^[a-z0-9][a-z0-9-]*$/.test(element) || !Number.isInteger(version) || version < 1) throw new Error("invalid reference target");
  const key = `${slot}/${element}@v${version}`;
  const dir = join(root, "library", slot, element, `v${version}`);
  const findings = [];
  const files = [];
  const result = (status, extra = {}) => ({ key, slot, element, version, status, files, findings, ...extra });
  const fail = (code, detail, extra = {}) => findings.push({ element: key, code, detail, ...extra });

  const recordPath = join(dir, "element.json");
  if (!versionInput && !existsSync(dir)) {
    fail("REF-NO-SOURCE", "no library directory for this version");
    return result("fail");
  }
  const record = versionInput?.record ?? (existsSync(recordPath) ? json(recordPath) : undefined);
  const embedded = new Map();
  const safePayload = (file) => typeof file === "string" && !!file && !file.startsWith("/") && !file.includes("\\") && !file.includes("\u0000") && !file.split("/").includes("..");
  const readPayload = (file) => {
    if (!safePayload(file)) throw new Error("payload path must stay inside its version");
    if (embedded.has(file)) return embedded.get(file);
    if (versionInput) return versionInput.files[file];
    let path = dir;
    for (const part of file.split("/")) { path = join(path, part); if (lstatSync(path).isSymbolicLink()) throw new Error("symlink payload is not a reference source"); }
    return readFileSync(path, "utf8");
  };
  const meta = !record && existsSync(join(dir, "registry-item.json")) ? json(join(dir, "registry-item.json")).meta ?? {} : {};
  const mode = record ? record.lineage?.mode : meta.lineage;
  const source = record ? record.lineage?.source : meta.reference;
  const hash = record?.hash;
  const payload = record?.payload ?? readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile());
  if (!Array.isArray(payload) || payload.some(file => !safePayload(file))) {
    fail("REF-FILE-UNMAPPED", "payload paths must stay inside the version");
    return result("fail", { hash });
  }
  // Registry JSON is executable payload too: inspect every embedded source file.
  for (const file of payload.filter(file => file.endsWith(".json"))) {
    const value = JSON.parse(readPayload(file));
    if (!Array.isArray(value.files)) continue;
    for (const entry of value.files) {
      if (!isCode(entry.path ?? "")) continue;
      if (typeof entry.content !== "string") fail("REF-NO-SOURCE", `embedded code ${entry.path} has no content`, { file });
      else if (embedded.has(entry.path) || payload.includes(entry.path)) fail("REF-FILE-UNMAPPED", `duplicate embedded code path ${entry.path}`, { file });
      else embedded.set(entry.path, entry.content);
    }
  }
  const codeFiles = [...payload.filter(isCode), ...embedded.keys()].sort();
  const adaptations = record?.lineage?.adaptations ?? [];
  if (!Array.isArray(adaptations)) fail("REF-ADAPTATION", "lineage.adaptations must be an array");
  else for (const a of adaptations) {
    if (!a || !ADAPTATION_KINDS.includes(a.kind) || typeof a.reason !== "string" || !a.reason.trim() || !codeFiles.includes(a.file)
      || (a.kind !== "data-fit" && !/^sha256:[a-f0-9]{64}$/.test(a.hash ?? ""))) {
      fail("REF-ADAPTATION", "each adaptation requires a permitted kind, payload file, exact hunk hash and non-empty reason");
    }
  }

  if ((opts.rule.consumerAssets?.slots ?? []).some((pattern) => globMatch(pattern, slot))) return result("exempt", { hash, note: "consumer-asset slot" });
  if (mode === "original" || !source?.registry || !source?.item) {
    fail("REF-NO-SOURCE", mode === "original" ? `original code in ${slot}, which is not a consumer-asset slot` : `${mode ?? "no"} lineage without lineage.source`);
    return result("fail", { hash });
  }

  const ref = `${source.registry}/${source.item}@${source.version}`;
  const item = (opts.manifest.items ?? []).find((row) => row.registry === source.registry && row.name === source.item && row.version === source.version);
  if (!item) {
    fail("REF-NOT-VENDORED", `${ref} is not vendored in references/manifest.json`);
    return result("fail", { hash, ref });
  }
  let itemDir = join(opts.referencesDir, item.dir);
  const vendored = [];
  for (const file of item.files) {
    const path = join(itemDir, file.path);
    if (!existsSync(path)) {
      fail("REF-NOT-VENDORED", `${ref}: ${file.path} is missing from the vendored tree`);
      return result("fail", { hash, ref });
    }
    vendored.push({ path: file.path, sha256: sha256(readFileSync(path)) });
  }
  const actual = treeHash(vendored);
  if (actual !== item.hash || vendored.some((f, k) => f.sha256 !== item.files[k].sha256)) {
    fail("REF-NOT-VENDORED", `${ref}: vendored tree hash ${actual} != manifest ${item.hash}`);
    return result("fail", { hash, ref });
  }
  if (source.hash !== item.hash) {
    fail("REF-NOT-VENDORED", `${ref}: lineage.source.hash ${source.hash ?? "(none)"} != vendored ${item.hash}`);
    return result("fail", { hash, ref });
  }

  if (codeFiles.length === 0) return result(findings.length ? "fail" : "n/a", { hash, ref, note: "non-code payload has a verified registry source" });

  if (/^(frames|sections)\./.test(slot) && item.type === "registry:ui") {
    fail("REF-PRIMITIVE-AS-REF", `${slot} cites ${ref}, a registry:ui primitive; a frame or section must cite a registry:block or registry:example`);
  }

  // Additional parts have the same manifest/file-byte proof as the primary block.
  // A file has exactly one source; a part cannot override a primary mapping.
  const sources = [{ source, item, itemDir }];
  for (const part of record?.lineage?.parts ?? []) {
    const partItem = (opts.manifest.items ?? []).find(row => row.registry === part.registry && row.name === part.item && row.version === part.version);
    if (!partItem || part.hash !== partItem.hash || !part.files || !Object.keys(part.files).length) {
      fail("REF-NOT-VENDORED", "each additional part requires exact manifest identity/hash and file mappings");
      continue;
    }
    const dir = join(opts.referencesDir, partItem.dir);
    const bytes = partItem.files.map(file => ({ path: file.path, sha256: existsSync(join(dir, file.path)) ? sha256(readFileSync(join(dir, file.path))) : "missing" }));
    if (treeHash(bytes) !== partItem.hash || bytes.some((file, i) => file.sha256 !== partItem.files[i].sha256)) {
      fail("REF-NOT-VENDORED", `${partItem.dir}: additional part bytes differ from the manifest`);
      continue;
    }
    sources.push({ source: part, item: partItem, itemDir: dir });
  }
  const mapping = new Map();
  for (const file of codeFiles) {
    const recorded = sources.filter(row => row.source.files?.[file] !== undefined);
    if (recorded.length > 1) {
      fail("REF-FILE-UNMAPPED", `${file} has multiple source mappings`, { file });
      continue;
    }
    if (recorded.length === 1) {
      const row = recorded[0];
      const path = row.source.files[file];
      if (!row.item.files.some(entry => entry.path === path && isCode(path))) fail("REF-FILE-UNMAPPED", `${file} maps outside its exact source item`, { file });
      else mapping.set(file, { ...row, path, inferred: false });
      continue;
    }
    if (options.strict) {
      fail("REF-FILE-UNMAPPED", `${file} has no lineage.source.files or parts entry`, { file });
      continue;
    }
    const itemPaths = item.files.map(f => f.path).filter(p => p !== `${item.name}.json`);
    const named = itemPaths.filter(p => basename(p) === basename(file));
    const code = itemPaths.filter(isCode);
    const matches = named.length ? named : code.length === 1 ? code : [];
    if (matches.length === 1) mapping.set(file, { ...sources[0], path: matches[0], inferred: true });
    else fail("REF-FILE-UNMAPPED", `${file} has no recorded mapping or unique primary source`, { file });
  }

  // Flavor: the reference's engine must be the consumer's, unless the code is engine-neutral.
  const components = loadComponents(root, opts.components);
  let config;
  if (!components) {
    fail("REF-FLAVOR", "no components.json for this consumer (style, iconLibrary and aliases are required)");
  } else {
    config = configFromComponents(components.value);
    const consumer = engineFamily(config.style);
    for (const [file, target] of mapping) {
      const style = opts.manifest.registries?.[target.source.registry]?.style;
      if ((!consumer || consumer !== engineFamily(style)) && !isEngineNeutral(readFileSync(join(target.itemDir, target.path), "utf8"), target.path)) {
        fail("REF-FLAVOR", `${target.item.dir} is ${style ?? "unstyled"}; consumer is ${config.style ?? "unstyled"}`, { file });
      }
    }
  }

  for (const file of codeFiles) {
    const target = mapping.get(file);
    if (!target) {
      files.push({ file, status: "fail", codes: ["REF-FILE-UNMAPPED"] });
      continue;
    }
    const entry = { file, reference: target.path, mapping: target.inferred ? "inferred" : "recorded", hunks: [] };
    files.push(entry);
    if (!config) {
      entry.status = "skipped";
      continue;
    }
    try {
      const rawSource = readFileSync(join(target.itemDir, target.path), "utf8");
      let normalized = normalizeReference(rawSource, target.path, config);
      const candidate = readPayload(file);
      const recorded = Array.isArray(adaptations) ? adaptations : [];
      for (const adaptation of recorded.filter(a => a?.file === file && a.kind === "data-fit")) {
        normalized = adaptation.operation === "single-option-static-row"
          ? staticSingleOptionRow(normalized, target.path, adaptation)
          : replayDataFit(normalized, target.path, adaptation, { raw: rawSource, source: target.source, sources });
      }
      const { hunks } = diffSources(normalized, target.path, candidate, file, {
        themeVars: record?.reads?.themeVars ?? [],
        linkComponents: opts.linkComponents,
      });
      entry.hunks = hunks;
      for (const h of hunks) {
        if (!h.ok) fail(h.rule, h.detail, { file, reference: target.path, range: h.file, referenceRange: h.ref });
        else if (!recordedHunk(h, file, normalized, candidate, recorded)) fail("REF-ADAPTATION", `${h.rule}: unrecorded adaptation ${adaptationHash(h, normalized, candidate)}; each change requires its permitted kind and reason`, { file, reference: target.path, range: h.file, referenceRange: h.ref });
      }
    } catch (error) {
      fail("REF-NORMALIZE", error.message, { file, reference: target.path });
    }
    entry.codes = [...new Set(findings.filter((f) => f.file === file).map((f) => f.code))];
    entry.status = entry.codes.length ? "fail" : "pass";
  }
  return result(findings.length ? "fail" : "pass", { hash, ref });
}

/** Check the immutable legacy library version on disk. */
export function checkElement(root, target, options = {}) {
  return checkVersion(root, target, options);
}

/** Slot-model registry item: provenance stays in meta.source; exact file mappings
 * and adaptation reasons live in meta.refVerbatim. Missing evidence fails closed.
 */
export function checkRegistryItem(root, slot, candidate, options = {}) {
  const opts = defaults(options);
  const refs = candidate.meta?.source?.ref ?? [];
  const source = candidate.meta?.source;
  const item = (opts.manifest.items ?? []).find(row => refs.includes(`${row.registry}/${row.name}@${row.version}`));
  const files = Object.fromEntries((candidate.files ?? []).map(file => [file.path, file.content]));
  if (Object.values(files).some(content => typeof content !== "string")) throw new Error("registry candidate must carry every payload file's content");
  const mapping = candidate.meta?.refVerbatim ?? {};
  const record = { payload: Object.keys(files), reads: candidate.meta?.element?.reads, lineage: {
    mode: source?.kind === "original" ? "original" : "customized",
    ...(item ? { source: { registry: item.registry, item: item.name, version: item.version, hash: item.hash, files: mapping.files } } : {}),
    adaptations: mapping.adaptations ?? [],
  } };
  return checkVersion(root, { slot, element: candidate.name ?? "unknown", version: 1 }, options, { record, files });
}

/** The pin gate: strict findings for one element version (an empty array means it may be pinned). */
export function refVerbatimFindings(root, target, options = {}) {
  return checkElement(root, target, { ...options, strict: true }).findings;
}

function versionDirs(libraryRoot) {
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
        if (m) out.push({ slot, element, version: Number(m[1]) });
      }
    }
  }
  return out.sort((a, b) => a.slot.localeCompare(b.slot) || a.element.localeCompare(b.element) || a.version - b.version);
}

/** Baseline rows and the REF-BASELINE findings for rows outside the ceiling. */
export function loadBaseline(options = {}) {
  const opts = defaults(options);
  const findings = [];
  if (!existsSync(opts.baselinePath)) return { rows: [], findings };
  const file = json(opts.baselinePath);
  const rows = Array.isArray(file.rows) ? file.rows : [];
  const ceiling = new Set(opts.ceiling);
  for (const row of rows) {
    if (!ceiling.has(baselineKey(row))) {
      findings.push({ element: `${row.slot}/${row.element}@v${row.version}`, code: "REF-BASELINE", detail: `baseline row ${baselineKey(row)} is not in BASELINE_CEILING; the baseline may only shrink` });
    }
  }
  return { rows, findings };
}

/**
 * `--pinned` (every pin) or `--all` (every version directory), with a shrink-only inventory. Baseline findings still fail; no release exemption.
 * @returns {{ mode, elements, findings, baselined, stale }}
 */
export function refVerbatimReport(root, { all = false, ...options } = {}) {
  const pins = existsSync(join(root, "selection.json")) ? json(join(root, "selection.json")).pins ?? {} : {};
  const targets = all
    ? versionDirs(join(root, "library"))
    : Object.entries(pins).map(([slot, pin]) => ({ slot, element: pin.element, version: pin.version, pinHash: pin.hash }));
  const { rows, findings: baselineFindings } = loadBaseline(options);
  // A row outside the ceiling is itself a finding and excuses nothing.
  const ceiling = new Set(defaults(options).ceiling);
  const baseline = new Set(rows.map(baselineKey).filter((k) => ceiling.has(k)));
  const used = new Set();
  const elements = [];
  const findings = [...baselineFindings];
  const baselined = [];
  for (const target of targets) {
    const checked = checkElement(root, target, { ...options, strict: true });
    const key = baselineKey({ ...target, hash: checked.hash ?? target.pinHash });
    if (checked.status === "fail" && baseline.has(key)) {
      used.add(key);
      baselined.push(checked.key);
      elements.push({ ...checked, status: "baselined" });
      findings.push(...checked.findings);
      continue;
    }
    elements.push(checked);
    findings.push(...checked.findings);
  }
  const agentDir = join(root, "agents", "designer");
  const walkSlots = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === "candidates") continue;
      const child = join(dir, entry.name);
      const pinPath = join(child, "pin.json");
      if (existsSync(pinPath)) {
        const pin = json(pinPath);
        const slot = json(join(child, "slot.json")).id;
        if (!/^[a-z0-9][a-z0-9.-]*-v[1-9][0-9]*\.json$/.test(pin.candidate ?? "")) throw new Error(`invalid Designer pin candidate in ${slot}`);
        const bytes = readFileSync(join(child, "candidates", pin.candidate));
        const checked = checkRegistryItem(root, slot, JSON.parse(bytes.toString("utf8")), { ...options, strict: true });
        if (sha256(bytes) !== pin.sha256) checked.findings.push({ element: checked.key, code: "REF-NO-SOURCE", detail: "slot pin sha256 does not match candidate bytes" });
        if (checked.findings.length) checked.status = "fail";
        elements.push(checked);
        findings.push(...checked.findings);
      }
      walkSlots(child);
    }
  };
  if (!all) walkSlots(agentDir);
  const stale = rows.map(baselineKey).filter((k) => !used.has(k));
  return { mode: all ? "all" : "pinned", root, elements, findings, baselined, stale };
}

const summary = (elements) => {
  const counts = { pass: 0, fail: 0, baselined: 0, exempt: 0, "n/a": 0 };
  const fileCounts = { pass: 0, fail: 0, skipped: 0 };
  for (const e of elements) {
    counts[e.status] = (counts[e.status] ?? 0) + 1;
    for (const f of e.files) fileCounts[f.status] = (fileCounts[f.status] ?? 0) + 1;
  }
  return { elements: counts, files: fileCounts };
};

function main(argv) {
  const value = (flag) => {
    const at = argv.indexOf(flag);
    return at < 0 ? undefined : argv[at + 1];
  };
  const root = value("--root");
  const element = value("--element");
  const mode = argv.includes("--all") ? "all" : argv.includes("--pinned") ? "pinned" : undefined;
  if (!root || (!element && !mode) || (element && mode)) {
    console.error("usage: check-ref-verbatim.mjs --root <consumer>/clossys (--element <slot>/<element>/v<N> | --pinned | --all) [--components <components.json>] [--report <file>] [--release] [--json]");
    return 2;
  }
  const options = {
    components: value("--components") ? resolve(value("--components")) : undefined,
    baselinePath: value("--baseline") ? resolve(value("--baseline")) : undefined,
  };
  let report;
  try {
    if (element) {
      const checked = checkElement(resolve(root), element, { ...options, strict: true });
      report = { mode: "element", root: resolve(root), elements: [checked], findings: checked.findings, baselined: [], stale: [] };
    } else {
      report = refVerbatimReport(resolve(root), { ...options, all: mode === "all" });
    }
  } catch (error) {
    console.error(`check-ref-verbatim: ${error.message}`);
    return 2;
  }
  if (argv.includes("--release")) for (const row of loadBaseline(options).rows) {
    report.findings.push({ element: `${row.slot}/${row.element}@v${row.version}`, code: "REF-BASELINE", detail: "release requires an empty ref-verbatim baseline; resolve and remove this row" });
  }
  report.summary = summary(report.elements);
  const reportPath = resolve(value("--report") ?? join("reports", "ref-verbatim.json"));
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  if (argv.includes("--json")) console.log(JSON.stringify(report.summary));
  for (const e of report.elements) {
    const fileLine = e.files.map((f) => `${f.file}:${f.status}${f.mapping === "inferred" ? "(inferred)" : ""}`).join(" ");
    console.log(`${e.status.padEnd(9)} ${e.key}${fileLine ? `  ${fileLine}` : ""}`);
  }
  if (report.stale.length) console.log(`${report.stale.length} baseline row(s) not pinned here (listed under "stale" in the report; remove a row once no consumer pins it)`);
  if (report.findings.length) {
    const lines = report.findings.map((f) => `${f.code} ${f.element}${f.file ? ` ${f.file}` : ""}${f.range ? `:${f.range.start.line}-${f.range.end.line}` : ""}: ${f.detail}`);
    console.error(`check-ref-verbatim: ${element ? "REFUSE pin" : "FAIL"} (${report.findings.length})\n- ${lines.join("\n- ")}\nreport: ${reportPath}`);
    return 1;
  }
  const s = report.summary.elements;
  console.log(`check-ref-verbatim: ok; ${s.pass} pass, ${s.baselined} baselined, ${s.exempt} exempt, ${s["n/a"]} without code; report: ${reportPath}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
