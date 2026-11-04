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
import { basename, dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configFromComponents, mapImport, normalizeReference } from "./ref-verbatim/normalize.mjs";
import { replayDataFit } from "./ref-verbatim/data-fit.mjs";
import { ADAPTATION_KINDS, adaptationHash, recordedHunk, staticSingleOptionRow } from "./ref-verbatim/adaptations.mjs";
export { ADAPTATION_KINDS, adaptationHash };
import { loadTypeScript } from "./ref-verbatim/typescript.mjs";
import { diffSources, isEngineNeutral, tokenSwapAllowed } from "./ref-verbatim/diff.mjs";
import { DS_COMPONENT_LAYER, DS_FRAME_LANDMARKS, dsOnlyEvents } from "./ref-verbatim/ds-only.mjs";
export { DS_COMPONENT_LAYER, DS_FRAME_LANDMARKS, dsOnlyEvents };

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
  "REF-PART-PROOF",
  "REF-PART-CLOSURE",
  "REF-SELF-CITE",
  "REF-COMP-PART",
  "REF-COMP-IMPORT",
  "REF-COMP-UNUSED",
  "REF-COMP-MARKUP",
  "REF-COMP-USES",
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

/** Code extensions, shared with the section check. */
export const CODE_FILE = /\.(tsx|ts|jsx|js|mjs|cjs|mts|cts)$/;
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
    ui: overrides.ui,
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


// Exact parts are a second, opt-in proof format. No legacy mapping/adaptation
// fallback applies when this field exists, including when it is malformed.
const partError = (detail, code = "REF-PART-PROOF") => { throw Object.assign(new Error(detail), { code }); };
const partRequire = (condition, detail, code) => { if (!condition) partError(detail, code); };
const partObject = (value, keys) => {
  partRequire(value && typeof value === "object" && !Array.isArray(value), "expected a closed proof object");
  partRequire(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), `proof fields must be exactly ${keys.join(", ")}`);
};
const partPath = value => typeof value === "string" && !!value && !/[\\\u0000:]/.test(value) && value.split("/").every(part => !!part && part !== "." && part !== "..");
const partHex = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const partNatural = value => Number.isSafeInteger(value) && value >= 0;
const partKeysEqual = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const partDecode = bytes => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
function partRead(base, file) {
  partRequire(partPath(file), "reference/payload path must remain inside its declared root");
  let path = base;
  for (const segment of file.split("/")) {
    path = join(path, segment);
    partRequire(!lstatSync(path).isSymbolicLink(), "exact proof cannot follow symlinks");
  }
  partRequire(lstatSync(path).isFile(), "exact proof requires a regular file");
  return readFileSync(path);
}
function partSlice(bytes, start, end) {
  partRequire(partNatural(start) && partNatural(end) && start < end && end <= bytes.length, "invalid UTF-8 byte boundaries");
  const slice = bytes.subarray(start, end);
  partDecode(slice); // A partial codepoint or invalid UTF-8 is never normalized.
  return slice;
}
function partParse(ts, text, file) {
  const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  partRequire(!parsed.parseDiagnostics.length, `unparseable exact source: ${file}`);
  return parsed;
}
function partEditAllowed(ts, original, file, edit, config, themeVars, imports) {
  const source = partParse(ts, original, file);
  const characterOffset = byte => partDecode(Buffer.from(original).subarray(0, byte)).length;
  const a = characterOffset(edit.start), b = characterOffset(edit.endExclusive);
  const nodes = [];
  const visit = node => { nodes.push(node); ts.forEachChild(node, visit); };
  visit(source);
  if (edit.kind === "import") {
    const node = nodes.find(node => ts.isStringLiteral(node) && node.getStart(source) + 1 === a && node.getEnd() - 1 === b
      && ((ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) && node.parent.moduleSpecifier === node));
    partRequire(node && node.text === edit.from && !/["'\\\r\n]/.test(edit.to)
      && imports.some(edge => edge.file === file && edge.specifier === edit.to), "import edit must relocate one unchanged static binding to a measured closure edge");
    partRequire(mapImport(edit.from, config.aliases) === edit.to, "import relocation is not an allowed native normalizer mapping");
    return;
  }
  if (edit.kind === "token") {
    const node = nodes.find(node => ts.isStringLiteral(node) && ts.isJsxAttribute(node.parent)
      && node.parent.name.getText(source) === "className" && a > node.getStart(source) && b < node.getEnd());
    partRequire(node && !/\s/.test(edit.from + edit.to) && tokenSwapAllowed(edit.from, edit.to, themeVars), "token edit must map one class token to a permitted semantic token");
    const left = original[a - 1], right = original[b];
    partRequire(/[\s"']/.test(left) && /[\s"']/.test(right), "token edit must cover a complete token");
    return;
  }
  partRequire(edit.kind === "data", "unknown exact-part adaptation");
  const node = nodes.find(node => node.getStart(source) === a && node.getEnd() === b && (ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isJsxText(node)));
  const parent = node?.parent;
  const jsx = node && (ts.isJsxText(node) || ts.isJsxAttribute(parent));
  const path = jsx ? /^\{([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\}$/.exec(edit.to)?.[1] : undefined;
  partRequire(path && !(ts.isJsxAttribute(parent) && /^(?:className|style|dangerouslySetInnerHTML|srcDoc)$|^on[A-Z]/.test(parent.name.getText(source))), "data edit must bind literal JSX data to a property path");
  const bindings = new Set();
  const bind = name => { if (ts.isIdentifier(name)) bindings.add(name.text); else for (const item of name.elements ?? []) if (ts.isBindingElement(item)) bind(item.name); };
  let ancestor = node;
  while (ancestor && !ts.isFunctionLike(ancestor)) ancestor = ancestor.parent;
  for (const parameter of ancestor?.parameters ?? []) bind(parameter.name);
  partRequire(bindings.has(path.split(".")[0]), "data binding must be rooted in a declared input parameter");
}
// Extraction units are complete top-level syntax, never arbitrary byte mosaics.
function partStatements(ts, source) {
  const allowed = node => ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isExportAssignment(node)
    || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node) || ts.isVariableStatement(node) || ts.isEnumDeclaration(node)
    || (ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression) && ["use client", "use server", "use strict"].includes(node.expression.text));
  partRequire(source.statements.length > 0 && source.statements.every(allowed), "exact extraction requires complete supported declarations/directives");
  return source.statements;
}
function partDeclarationRange(ts, whole, path, start, end) {
  const text = partDecode(whole), source = partParse(ts, text, path);
  const a = partDecode(whole.subarray(0, start)).length, b = partDecode(whole.subarray(0, end)).length;
  const selected = source.statements.filter(node => node.getStart(source) < b && node.getEnd() > a);
  partRequire(selected.length > 0 && selected.every(node => node.getStart(source) >= a && node.getEnd() <= b)
    && !text.slice(a, selected[0].getStart(source)).trim() && !text.slice(selected.at(-1).getEnd(), b).trim(), "source range cuts through syntax or includes unsupported framing bytes");
  const extracted = partParse(ts, partDecode(whole.subarray(start, end)), path);
  partStatements(ts, extracted);
}
const partStatementShape = (ts, text, path) => {
  const source = partParse(ts, text, path);
  return [...partStatements(ts, source)].map(node => [node.kind, node.getText(source)]);
};

function exactPartsCheck({ root, record, payload, codeFiles, readBytes, opts, slot, fail, files, options }) {
  const proof = record.lineage.exactParts;
  try {
    partObject(proof, ["schema", "payload", "files", "closure"]);
    partRequire(proof.schema === "ref-exact-parts/1", "unknown exact-part proof schema");
    for (const map of [proof.payload, proof.files]) partRequire(map && typeof map === "object" && !Array.isArray(map), "exact proof inventories must be objects");
    partRequire(partKeysEqual(Object.keys(proof.payload), payload) && new Set(payload).size === payload.length, "proof must hash the complete emitted payload inventory");
    partRequire(partKeysEqual(Object.keys(proof.files), codeFiles), "proof must cover every emitted executable file, including embedded sources");
    partRequire(codeFiles.length > 0 && !(record.lineage.adaptations?.length), "exact parts require code and use only explicit byte edits");
    const bytes = new Map();
    for (const file of new Set([...payload, ...codeFiles])) {
      partRequire(partPath(file) && !/^(node_modules|library)\//.test(file), "invalid or reserved exact payload path");
      const content = readBytes(file);
      partRequire(Buffer.isBuffer(content), `missing exact payload bytes: ${file}`);
      bytes.set(file, content);
      if (payload.includes(file)) partRequire(partHex(proof.payload[file]) && sha256(content) === proof.payload[file], `stale emitted payload hash: ${file}`);
    }
    partRequire(treeHash(payload.map(path => ({ path, sha256: sha256(bytes.get(path)) }))) === record.hash, "exact proof must bind the final canonical payload hash");
    const refs = [record.lineage.source, ...(record.lineage.parts ?? [])];
    const sources = refs.map((ref, index) => {
      partRequire(ref && typeof ref.registry === "string" && opts.manifest.registries?.[ref.registry], "untrusted exact source registry", "REF-NOT-VENDORED");
      const item = opts.manifest.items?.find(item => item.registry === ref.registry && item.name === ref.item && item.version === ref.version);
      partRequire(item && item.hash === ref.hash && Array.isArray(item.files) && item.files.length, "missing or stale exact source identity", "REF-NOT-VENDORED");
      if (/^(frames|sections)\./.test(slot)) {
        partRequire(item.type !== "registry:ui", "a primitive cannot qualify an exact section/frame part", "REF-PRIMITIVE-AS-REF");
        if (index === 0) partRequire(["registry:block", "registry:example"].includes(item.type), "an exact section/frame requires a real primary block or example", "REF-PRIMITIVE-AS-REF");
      }
      partRequire(["registry:block", "registry:example", "application:component", "registry:ui"].includes(item.type), "unsupported exact-part source kind", "REF-NOT-VENDORED");
      const registry = opts.manifest.registries[ref.registry];
      partRequire(typeof registry.upstream === "string" && /@[a-f0-9]{40}$/.test(registry.upstream), "exact upstream must identify an immutable full source revision", "REF-NOT-VENDORED");
      partRequire(item.license === registry.license && partPath(item.dir), "exact source license/root mismatch", "REF-NOT-VENDORED");
      const contents = new Map();
      for (const file of item.files) {
        partRequire(partPath(file.path) && !contents.has(file.path), "duplicate or invalid upstream path", "REF-NOT-VENDORED");
        const content = partRead(opts.referencesDir, `${item.dir}/${file.path}`);
        partRequire(content.length === file.bytes && sha256(content) === file.sha256, "whole upstream file hash/length differs", "REF-NOT-VENDORED");
        contents.set(file.path, content);
      }
      partRequire(treeHash([...contents].map(([path, content]) => ({ path, sha256: sha256(content) }))) === item.hash, "whole upstream item tree differs", "REF-NOT-VENDORED");
      return { item, registry, contents };
    });
    const components = loadComponents(root, opts.components);
    partRequire(components, "exact proof requires consumer components.json", "REF-FLAVOR");
    const config = configFromComponents(components.value);
    const ts = loadTypeScript();
    partObject(proof.closure, ["roots", "imports"]);
    partRequire(Array.isArray(proof.closure.roots) && proof.closure.roots.length && proof.closure.roots.every(file => codeFiles.includes(file))
      && new Set(proof.closure.roots).size === proof.closure.roots.length && Array.isArray(proof.closure.imports), "invalid exact executable roots", "REF-PART-CLOSURE");
    const used = new Set();
    for (const file of codeFiles) {
      const evidence = proof.files[file];
      partObject(evidence, ["sha256", "segments"]);
      partRequire(partHex(evidence.sha256) && sha256(bytes.get(file)) === evidence.sha256 && Array.isArray(evidence.segments) && evidence.segments.length, `invalid part evidence: ${file}`);
      let end = 0;
      const replay = [], statementShapes = [];
      for (const segment of evidence.segments) {
        partObject(segment, ["start", "endExclusive", "source", "edits"]);
        partRequire(segment.start === end && partNatural(segment.endExclusive) && segment.endExclusive > end, `unmapped/overlapping emitted bytes: ${file}`);
        const source = segment.source;
        partObject(source, ["reference", "path", "upstream", "fileSha256", "start", "endExclusive", "sha256", "license"]);
        partRequire(partNatural(source.reference) && source.reference < sources.length, "unknown exact source index");
        const bound = sources[source.reference];
        const whole = bound.contents.get(source.path);
        partRequire(whole && source.upstream === bound.registry.upstream && partHex(source.fileSha256) && sha256(whole) === source.fileSha256, "stale whole source/upstream binding", "REF-NOT-VENDORED");
        partDecode(whole);
        const slice = partSlice(whole, source.start, source.endExclusive);
        partRequire(partHex(source.sha256) && sha256(slice) === source.sha256, "stale exact source range hash");
        const license = source.license;
        partObject(license, ["path", "sha256", "payloadPath"]);
        const listed = opts.manifest.licenses?.find(row => row.path === license.path);
        partRequire(listed && bound.registry.licenseFiles?.includes(license.path) && partHex(license.sha256) && listed.sha256 === license.sha256, "unknown or stale source license", "REF-NOT-VENDORED");
        const licenseBytes = partRead(opts.referencesDir, license.path);
        partRequire(licenseBytes.length === listed.bytes && sha256(licenseBytes) === license.sha256
          && payload.includes(license.payloadPath) && bytes.get(license.payloadPath)?.equals(licenseBytes), "source/bundled license bytes differ", "REF-NOT-VENDORED");
        partDeclarationRange(ts, whole, source.path, source.start, source.endExclusive);
        const raw = partDecode(slice);
        const style = engineFamily(bound.registry.style);
        partRequire((style && style === engineFamily(config.style)) || isEngineNeutral(raw, source.path), "exact part has incompatible engine flavor", "REF-FLAVOR");
        partRequire(Array.isArray(segment.edits), "exact edits must be an array");
        const chunks = []; let offset = 0;
        for (const edit of segment.edits) {
          partObject(edit, ["kind", "start", "endExclusive", "from", "to"]);
          partRequire(["import", "token", "data"].includes(edit.kind) && typeof edit.from === "string" && !!edit.from && typeof edit.to === "string" && !!edit.to && edit.from !== edit.to
            && partNatural(edit.start) && edit.start >= offset, "unknown, empty or overlapping adaptation");
          const before = partSlice(slice, edit.start, edit.endExclusive);
          partRequire(before.equals(Buffer.from(edit.from)), "adaptation from bytes differ");
          partEditAllowed(ts, raw, file, edit, config, record.reads?.themeVars ?? [], proof.closure.imports);
          chunks.push(slice.subarray(offset, edit.start), Buffer.from(edit.to)); offset = edit.endExclusive;
        }
        chunks.push(slice.subarray(offset));
        const emitted = Buffer.concat(chunks);
        partRequire(emitted.length === segment.endExclusive - segment.start, "adaptation output byte range differs");
        statementShapes.push(...partStatementShape(ts, partDecode(emitted), file));
        replay.push(emitted); end = segment.endExclusive; used.add(source.reference);
      }
      partRequire(end === bytes.get(file).length && Buffer.concat(replay).equals(bytes.get(file)), `unmapped or altered emitted bytes: ${file}`);
      partRequire(JSON.stringify(statementShapes) === JSON.stringify(partStatementShape(ts, partDecode(bytes.get(file)), file)), "assembled bytes introduce syntax across extraction-unit boundaries");
      files.push({ file, status: "pass", mapping: "recorded", hunks: [] });
    }
    partRequire(used.size === refs.length, "unbound primary or additional source identity");
    exactPartClosure(ts, root, record, proof, bytes, codeFiles, opts, options, config);
  } catch (error) {
    fail(CODES.includes(error.code) ? error.code : "REF-PART-PROOF", error.message);
    for (const file of files) file.status = "fail";
  }
}


/** Parse and resolve an isolated module inventory. Never consult neighboring
 * Studio files, ambient module resolution, package caches or declaration-only
 * stand-ins for executable dependencies. Package/element roots are byte-bound.
 */
function exactPartClosure(ts, root, record, proof, payloadBytes, codeFiles, opts, options, config) {
  const need = (condition, message) => partRequire(condition, message, "REF-PART-CLOSURE");
  const declared = new Map();
  for (const edge of proof.closure.imports) {
    partObject(edge, ["file", "specifier", "target"]);
    need(partPath(edge.file) && typeof edge.specifier === "string" && edge.specifier.length, "invalid closure edge");
    const target = edge.target;
    need(target && ["payload", "npm", "element"].includes(target.kind), "unknown executable dependency kind");
    partObject(target, target.kind === "payload" ? ["kind", "path"] : target.kind === "npm"
      ? ["kind", "package", "version", "hash", "entry"] : ["kind", "slot", "element", "version", "hash", "entry"]);
    const key = `${edge.file}\0${edge.specifier}`;
    need(!declared.has(key), "duplicate closure resolution"); declared.set(key, edge);
  }
  const nodes = new Map(), npmRoots = new Map(), elementRoots = new Map(), resolutions = new Map(), edges = [], used = new Set();
  const payloadRoot = { kind: "payload", label: "", bytes: payloadBytes, record };
  const fileAt = (domain, file) => domain.label + file;
  const resolveRelative = (domain, file, specifier) => {
    const path = posix.normalize(posix.join(posix.dirname(file), specifier));
    need(partPath(path), "relative import escapes its materialization");
    const candidates = [path, ...[".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".mts", ".cts", ".d.ts"].map(ext => path + ext),
      ...["index.tsx", "index.ts", "index.jsx", "index.js", "index.mjs", "index.cjs", "index.d.ts"].map(name => `${path}/${name}`)]
      .filter(candidate => domain.bytes.has(candidate));
    need(candidates.length === 1, `missing or ambiguous isolated import ${file}: ${specifier}`);
    return candidates[0];
  };
  const npmRoot = target => {
    need(typeof target.package === "string" && /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(target.package)
      && typeof target.version === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(target.version)
      && record.deps?.npm?.[target.package] === target.version && /^sha256:[a-f0-9]{64}$/.test(target.hash), "npm closure requires an exact declared version and measured package digest");
    if (npmRoots.has(target.package)) {
      const domain = npmRoots.get(target.package);
      need(domain.hash === target.hash && domain.version === target.version, "conflicting npm dependency identity"); return domain;
    }
    const base = join(root, "node_modules", target.package);
    // Installed package symlinks are not an isolated consumer installation.
    let directory = root;
    for (const component of ["node_modules", ...target.package.split("/")]) { directory = join(directory, component); need(!lstatSync(directory).isSymbolicLink(), "npm closure cannot follow workspace symlinks"); }
    const bytes = new Map();
    const walk = (dir, prefix) => {
      for (const name of readdirSync(dir).sort()) {
        if (name === "node_modules") continue; // Every package resolves at the explicit root below.
        const path = prefix ? `${prefix}/${name}` : name, stat = lstatSync(join(dir, name));
        need(!stat.isSymbolicLink() && partPath(path), "invalid npm package entry");
        if (stat.isDirectory()) walk(join(dir, name), path);
        else { need(stat.isFile(), "npm closure requires regular package files"); bytes.set(path, readFileSync(join(dir, name))); }
      }
    };
    walk(base, "");
    const hash = treeHash([...bytes].map(([path, content]) => ({ path, sha256: sha256(content) })));
    const manifest = JSON.parse(partDecode(bytes.get("package.json")));
    need(hash === target.hash && manifest.name === target.package && manifest.version === target.version, "npm package bytes/identity changed");
    // A caller-supplied digest alone is not a trust anchor: rewriting package
    // bytes and that digest must still fail against the immutable vendored item.
    const anchors = (opts.manifest.items ?? []).filter(item => item.name === target.package && item.version === target.version && item.hash === target.hash);
    need(anchors.length === 1, "npm bytes require one exact trusted vendored source identity");
    const anchor = anchors[0], registry = opts.manifest.registries?.[anchor.registry];
    need(registry && /@[a-f0-9]{40}$/.test(registry.upstream ?? "") && partPath(anchor.dir)
      && anchor.license === registry.license && manifest.license === registry.license && Array.isArray(anchor.files)
      && partKeysEqual(anchor.files.map(file => file.path), bytes.keys()), "npm source revision/license/file inventory differs");
    for (const file of anchor.files) {
      const vendored = partRead(opts.referencesDir, `${anchor.dir}/${file.path}`);
      need(vendored.length === file.bytes && sha256(vendored) === file.sha256 && vendored.equals(bytes.get(file.path)), "npm source/package bytes differ from trusted whole-file hashes");
    }
    need(Array.isArray(registry.licenseFiles) && registry.licenseFiles.length > 0, "npm source has no trusted license");
    for (const path of registry.licenseFiles) {
      const license = opts.manifest.licenses?.find(row => row.path === path);
      const content = partRead(opts.referencesDir, path);
      need(license && content.length === license.bytes && sha256(content) === license.sha256
        && [...bytes.values()].some(file => file.equals(content)), "npm source/license bytes are stale or omitted from the package");
    }
    const domain = { kind: "npm", label: `node_modules/${target.package}/`, bytes, manifest, registry, hash, version: target.version, package: target.package };
    npmRoots.set(target.package, domain); return domain;
  };
  const elementRoot = target => {
    need(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(target.slot) && /^[a-z0-9][a-z0-9-]*$/.test(target.element)
      && partNatural(target.version) && target.version > 0 && /^sha256:[a-f0-9]{64}$/.test(target.hash), "invalid canonical dependency identity");
    need(record.deps?.elements?.some(dep => ["slot", "element", "version", "hash"].every(key => dep[key] === target[key])), "undeclared canonical dependency");
    const identity = `${target.slot}/${target.element}/v${target.version}`;
    if (elementRoots.has(identity)) { const domain = elementRoots.get(identity); need(domain.hash === target.hash, "conflicting canonical dependency"); return domain; }
    const base = join(root, "library", identity);
    const dependency = JSON.parse(partDecode(partRead(root, `library/${identity}/element.json`)));
    need(dependency.slot === target.slot && dependency.id === target.element && dependency.version === target.version
      && dependency.hash === target.hash && Array.isArray(dependency.payload), "canonical dependency identity differs");
    const bytes = new Map(dependency.payload.map(file => [file, partRead(base, file)]));
    need(bytes.size === dependency.payload.length && treeHash([...bytes].map(([path, content]) => ({ path, sha256: sha256(content) }))) === target.hash, "canonical dependency payload changed");
    const ancestors = options.exactAncestors ?? [];
    need(!ancestors.includes(identity), "cyclic canonical proof dependency");
    const checked = checkVersion(root, { slot: target.slot, element: target.element, version: target.version }, { ...options, strict: true, exactAncestors: [...ancestors, identity] });
    need(checked.findings.length === 0, "canonical dependency does not pass its actual strict source proof");
    const domain = { kind: "element", label: `library/${identity}/`, bytes, record: dependency, hash: target.hash };
    elementRoots.set(identity, domain); return domain;
  };
  const publicNpm = (domain, specifier, typeOnly) => {
    need(specifier === domain.package || specifier.startsWith(domain.package + "/"), "npm target differs from its import");
    const subpath = specifier === domain.package ? "." : "./" + specifier.slice(domain.package.length + 1);
    const exports = domain.manifest.exports;
    const selected = exports && typeof exports === "object" && !Array.isArray(exports) && Object.keys(exports).some(key => key.startsWith(".")) ? exports[subpath] : subpath === "." ? exports : undefined;
    const leaves = value => {
      if (typeof value === "string") { need(value.startsWith("./") && partPath(value.slice(2)), "unsupported npm export path"); return [value.slice(2)]; }
      need(value && typeof value === "object", "missing/conditional-null npm export");
      // A types condition is a declaration entry, never a runtime alternative.
      // Keep checking every other conditional branch against the byte proof.
      return Object.entries(value).filter(([condition]) => typeOnly || condition !== "types").flatMap(([, target]) => leaves(target));
    };
    if (exports !== undefined) return [...new Set(leaves(selected))];
    if (subpath !== ".") return [resolveRelative(domain, "root.js", subpath)];
    return [...new Set([domain.manifest.module, domain.manifest.main].filter(Boolean).map(path => path.replace(/^\.\//, "")))].length
      ? [...new Set([domain.manifest.module, domain.manifest.main].filter(Boolean).map(path => path.replace(/^\.\//, "")))] : ["index.js"];
  };
  const resolveEdge = (domain, file, request, typeOnly) => {
    const label = fileAt(domain, file), key = `${label}\0${request}`;
    const declaration = declared.get(key);
    need(declaration, `unrecorded executable/type import ${label}: ${request}`); used.add(key);
    const target = declaration.target;
    let destination, entries;
    if (target.kind === "payload") {
      need(domain.kind === "payload" && request.startsWith(".") && partPath(target.path), "payload imports must resolve inside their own inventory");
      destination = payloadRoot; entries = [resolveRelative(destination, file, request)];
      need(entries[0] === target.path, "payload import resolution differs");
    } else if (target.kind === "npm") {
      destination = npmRoot(target);
      entries = request.startsWith(".") && domain === destination ? [resolveRelative(domain, file, request)] : publicNpm(destination, request, typeOnly);
      need(entries.includes(target.entry), "npm entry is not its actual public/local resolution");
    } else {
      destination = elementRoot(target);
      need(partPath(target.entry), "invalid canonical entry");
      if (request.startsWith(".") && domain === destination) {
        entries = [resolveRelative(domain, file, request)]; need(entries[0] === target.entry, "canonical local edge differs");
      } else {
        // A canonical dependency exposes only the registry item's public entry,
        // never an arbitrary neighboring helper or a section deep-import alias.
        const registry = JSON.parse(partDecode(destination.bytes.get("registry-item.json")));
        need(request === `@elements/${target.slot}/${target.element}` && registry.files?.some(row => row.path === target.entry && /(?:^|\/)index\.[cm]?[jt]sx?$/.test(row.path)), "canonical import must name its verified public entry");
        entries = [target.entry];
      }
    }
    for (const entry of entries) {
      need(destination.bytes.has(entry) && partPath(entry) && (isCode(entry) || (typeOnly && entry.endsWith(".d.ts"))), "dependency has no executable/type source bytes");
      load(destination, entry, !typeOnly);
    }
    resolutions.set(key, entries.map(entry => fileAt(destination, entry)));
    return entries.map(entry => fileAt(destination, entry));
  };
  const scanned = new Set();
  const load = (domain, file, executable) => {
    const label = fileAt(domain, file), mode = `${label}\0${executable}`;
    need(!executable || !label.endsWith(".d.ts"), "declarations cannot stand in for executable code");
    if (scanned.has(mode)) return;
    scanned.add(mode);
    if (executable && domain.kind === "npm") {
      const style = engineFamily(domain.registry.style);
      need((style && style === engineFamily(config.style)) || isEngineNeutral(partDecode(domain.bytes.get(file)), file), "npm executable has incompatible engine flavor");
    }
    const source = nodes.get(label) ?? partParse(ts, partDecode(domain.bytes.get(file)), label);
    nodes.set(label, source);
    const imports = [];
    const inspect = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        need(ts.isStringLiteral(node.moduleSpecifier), "nonliteral module reference");
        const clause = node.importClause, bindings = clause?.namedBindings;
        need(!bindings || !ts.isNamespaceImport(bindings), "namespace imports require an unsupported export-usage proof");
        const named = ts.isExportDeclaration(node) ? node.exportClause : bindings;
        const typeOnly = !!node.isTypeOnly || !!clause?.isTypeOnly;
        const names = [];
        if (clause?.name) names.push("default");
        if (named && (ts.isNamedImports(named) || ts.isNamedExports(named))) for (const binding of named.elements) if (!binding.isTypeOnly || typeOnly) names.push((binding.propertyName ?? binding.name).text);
        const onlyTypes = typeOnly || (!clause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every(binding => binding.isTypeOnly));
        imports.push({ request: node.moduleSpecifier.text, names, typeOnly: onlyTypes || !executable });
      } else if (ts.isImportEqualsDeclaration(node)) partError("import-equals is not supported by the isolated ESM proof", "REF-PART-CLOSURE");
      else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        need(node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]), "dynamic module loading is not a finite executable closure");
        imports.push({ request: node.arguments[0].text, names: [], typeOnly: !executable });
      } else if (ts.isIdentifier(node) && node.text === "require") {
        need(ts.isCallExpression(node.parent) && node.parent.expression === node, "aliased require is not a finite executable closure");
      } else if ((ts.isIdentifier(node) && ["eval", "Function"].includes(node.text)) || (ts.isElementAccessExpression(node) && /(?:require|import|eval|Function)/.test(node.argumentExpression?.getText(source) ?? ""))) {
        partError("indirect code loading is not supported by exact closure", "REF-PART-CLOSURE");
      }
      ts.forEachChild(node, inspect);
    };
    inspect(source);
    for (const dependency of imports) edges.push({ ...dependency, targets: resolveEdge(domain, file, dependency.request, dependency.typeOnly) });
  };
  // Every emitted executable is checked, including files not reachable from roots.
  for (const file of codeFiles) load(payloadRoot, file, true);
  need(used.size === declared.size, "closure contains stale or unmeasured import edges");
  // The compiler sees only these byte-bound modules, with no ambient resolver.
  const sourcePath = label => `/__ref_exact__/${label}`;
  const compilerOptions = { target: ts.ScriptTarget.ES2022, noEmit: true, allowJs: true, checkJs: true, skipLibCheck: true, jsx: ts.JsxEmit.Preserve, module: ts.ModuleKind.ESNext, types: [] };
  const compilerLibDir = dirname(ts.getDefaultLibFilePath(compilerOptions));
  const standardLib = path => dirname(path) === compilerLibDir && /^lib(?:\.[a-z0-9.]+)?\.d\.ts$/.test(basename(path));
  const compilerLibs = new Map();
  const host = {
    getSourceFile: path => {
      if (path.startsWith("/__ref_exact__/")) return nodes.get(path.slice("/__ref_exact__/".length));
      if (!standardLib(path)) return undefined;
      if (!compilerLibs.has(path)) compilerLibs.set(path, ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true));
      return compilerLibs.get(path);
    }, getDefaultLibFileName: () => ts.getDefaultLibFilePath(compilerOptions),
    writeFile: () => {}, getCurrentDirectory: () => "/__ref_exact__", getDirectories: () => [],
    fileExists: path => nodes.has(path.slice("/__ref_exact__/".length)) || (standardLib(path) && existsSync(path)),
    readFile: path => nodes.get(path.slice("/__ref_exact__/".length))?.text ?? (standardLib(path) ? readFileSync(path, "utf8") : undefined),
    getCanonicalFileName: path => path, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n",
    resolveModuleNames: (names, containing) => names.map(name => {
      const labels = resolutions.get(`${containing.slice("/__ref_exact__/".length)}\0${name}`);
      return labels ? { resolvedFileName: sourcePath(labels[0]), extension: /\.[cm]?js$/.test(labels[0]) ? ts.Extension.Js : labels[0].endsWith(".d.ts") ? ts.Extension.Dts : labels[0].endsWith(".tsx") ? ts.Extension.Tsx : ts.Extension.Ts, isExternalLibraryImport: false } : undefined;
    }),
  };
  // Set virtual names before binding; actual source paths are never consulted.
  for (const [label, source] of nodes) source.fileName = sourcePath(label);
  const program = ts.createProgram([...nodes.keys()].map(sourcePath), compilerOptions, host);
  const checker = program.getTypeChecker();
  // A complete declaration can still reference a helper whose declaration or
  // import was dropped by extraction. Only compiler ES/DOM globals are ambient.
  const missingBinding = program.getSemanticDiagnostics().find(diagnostic => [2304, 2552].includes(diagnostic.code));
  need(!missingBinding, "isolated executable/type closure contains an undeclared binding");
  for (const edge of edges) for (const target of edge.targets) {
    const source = program.getSourceFile(sourcePath(target));
    const symbol = source && checker.getSymbolAtLocation(source);
    need(symbol, `dependency is not a module: ${target}`);
    const exports = new Map(checker.getExportsOfModule(symbol).map(symbol => [symbol.name, symbol]));
    for (const name of edge.names) {
      let exported = exports.get(name);
      if (exported && exported.flags & ts.SymbolFlags.Alias) exported = checker.getAliasedSymbol(exported);
      need(exported && (edge.typeOnly || (exported.flags & ts.SymbolFlags.Value)), `missing ${edge.typeOnly ? "type" : "executable"} export ${name}: ${target}`);
    }
  }
}

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
  const readPayload = (file, raw = false) => {
    if (!safePayload(file)) throw new Error("payload path must stay inside its version");
    if (embedded.has(file)) return raw ? Buffer.from(embedded.get(file)) : embedded.get(file);
    if (versionInput) return raw ? Buffer.from(versionInput.files[file]) : versionInput.files[file];
    let path = dir;
    for (const part of file.split("/")) { path = join(path, part); if (lstatSync(path).isSymbolicLink()) throw new Error("symlink payload is not a reference source"); }
    return raw ? readFileSync(path) : readFileSync(path, "utf8");
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

  if (!Object.hasOwn(record?.lineage ?? {}, "exactParts") && (opts.rule.consumerAssets?.slots ?? []).some((pattern) => globMatch(pattern, slot))) return result("exempt", { hash, note: "consumer-asset slot" });
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

  if (record?.lineage && Object.hasOwn(record.lineage, "exactParts")) {
    exactPartsCheck({ root, record, payload, codeFiles, readBytes: file => readPayload(file, true), opts, slot, fail, files, options });
    return result(findings.length ? "fail" : "pass", { hash, ref });
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
  if (candidate.meta?.source?.kind === "composition") return checkComposition(root, slot, candidate, options);
  return withSelfCitation(checkLineageItem(root, slot, candidate, options), candidate.meta?.source?.ref);
}

function checkLineageItem(root, slot, candidate, options = {}) {
  const opts = defaults(options);
  const refs = candidate.meta?.source?.ref ?? [];
  const source = candidate.meta?.source;
  const item = (opts.manifest.items ?? []).find(row => refs.includes(`${row.registry}/${row.name}@${row.version}`));
  const files = Object.fromEntries((candidate.files ?? []).map(file => [file.path, file.content]));
  if (Object.values(files).some(content => typeof content !== "string")) throw new Error("registry candidate must carry every payload file's content");
  const mapping = candidate.meta?.refVerbatim ?? {};
  const record = { payload: Object.keys(files), hash: treeHash(Object.entries(files).map(([path, content]) => ({ path, sha256: sha256(content) }))), deps: candidate.meta?.element?.deps, reads: candidate.meta?.element?.reads, lineage: {
    mode: source?.kind === "original" ? "original" : "customized",
    ...(item ? { source: { registry: item.registry, item: item.name, version: item.version, hash: item.hash, files: mapping.files } } : {}),
    adaptations: mapping.adaptations ?? [],
    ...(mapping.parts ? { parts: mapping.parts } : {}),
    ...(Object.hasOwn(mapping, "exactParts") ? { exactParts: mapping.exactParts } : {}),
  } };
  return checkVersion(root, { slot, element: candidate.name ?? "unknown", version: 1 }, options, { record, files });
}

// ---- self-citation ----------------------------------------------------------

/** A lineage reference into Foundry's own package folders (or the `foundry` registry) is no proof: it cites the code it is meant to check. */
const FOUNDRY_PACKAGE_PATH = /(?:^|[/"'@])packages\/[a-z0-9][a-z0-9-]*(?:[/"'@]|$)/;
export function selfCitation(ref) {
  if (typeof ref !== "string") return false;
  if (/^foundry\//.test(ref) || FOUNDRY_PACKAGE_PATH.test(ref)) return true;
  let rows = [];
  if (/^\s*[[{]/.test(ref)) {
    try { const value = JSON.parse(ref); rows = Array.isArray(value) ? value : [value]; } catch { rows = []; }
  }
  return rows.some(row => !!row && typeof row === "object" && (row.registry === "foundry" || Object.values(row).some(value => typeof value === "string" && FOUNDRY_PACKAGE_PATH.test(value))));
}
const refLabel = ref => (ref.length > 120 ? `${ref.slice(0, 117)}...` : ref);
const selfCiteFinding = (key, ref) => ({ element: key, code: "REF-SELF-CITE", detail: `lineage source ${refLabel(ref)} points into Foundry's own package folders; a pin cannot be proved against Foundry's own code` });

function withSelfCitation(checked, refs) {
  if (checked.status === "exempt" || !Array.isArray(refs)) return checked;
  for (const ref of refs) if (selfCitation(ref)) checked.findings.push(selfCiteFinding(checked.key, ref));
  if (checked.findings.length) checked.status = "fail";
  return checked;
}

// ---- composition ------------------------------------------------------------

const sameSet = (a, b) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());

/** Every Designer slot directory under agents/designer, by slot id (flat or nested layouts). */
function designerSlotDirs(root) {
  const dirs = new Map();
  const walk = dir => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === "candidates") continue;
      const child = join(dir, entry.name);
      if (existsSync(join(child, "slot.json"))) {
        const id = json(join(child, "slot.json")).id;
        if (typeof id === "string" && !dirs.has(id)) dirs.set(id, child);
      }
      walk(child);
    }
  };
  walk(join(root, "agents", "designer"));
  return dirs;
}

/** The pinned candidate of one slot, with its pin hash verified; `error` says why there is none. */
function pinnedCandidate(dir) {
  if (!dir) return { error: "is not a Designer slot in this consumer" };
  if (!existsSync(join(dir, "pin.json"))) return { error: "is not pinned" };
  const pin = json(join(dir, "pin.json"));
  if (!/^[a-z0-9][a-z0-9.-]*-v[1-9][0-9]*\.json$/.test(pin.candidate ?? "") || !existsSync(join(dir, "candidates", pin.candidate))) return { error: "pins a missing candidate" };
  const bytes = readFileSync(join(dir, "candidates", pin.candidate));
  if (sha256(bytes) !== pin.sha256) return { error: "has a pin sha256 that does not match its candidate" };
  return { pin, item: JSON.parse(bytes.toString("utf8")) };
}

/**
 * A stock part: pinned with registry lineage, verbatim (no recorded adaptations
 * or extra parts), passing the strict ref-verbatim check itself, with code.
 */
function stockPart(root, slot, dir, options) {
  const { error, item } = pinnedCandidate(dir);
  if (error) return { error };
  const kind = item.meta?.source?.kind;
  if (kind !== "registry") return { error: `is pinned with ${kind ?? "no"} lineage, not registry` };
  const mapping = item.meta?.refVerbatim ?? {};
  // Additional source parts are verbatim too (each is diffed against its own vendored file); recorded adaptations, or the byte-proof format, are not stock.
  if ((Array.isArray(mapping.adaptations) && mapping.adaptations.length) || Object.hasOwn(mapping, "exactParts")) return { error: "is pinned with recorded adaptations, not verbatim" };
  const checked = checkRegistryItem(root, slot, item, { ...options, strict: true, slotDoc: undefined });
  if (checked.status !== "pass") return { error: checked.status === "fail" ? `fails ref-verbatim itself (${[...new Set(checked.findings.map(f => f.code))].join(", ")})` : `has no checked code (${checked.status})` };
  const files = { ...(mapping.files ?? {}) };
  for (const extra of Array.isArray(mapping.parts) ? mapping.parts : []) Object.assign(files, extra?.files ?? {});
  const codeFiles = (item.files ?? []).filter(file => isCode(file.path) && files[file.path] !== undefined);
  return { item, vendored: Object.values(files), codeFiles };
}

const resolveModuleFile = base => {
  for (const path of [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    if (existsSync(path) && statSync(path).isFile()) return path;
  }
  return undefined;
};

/** The component layer package (@clossys/designer-ui) whose barrel and `@/` alias a composition's imports resolve through. */
function componentLayer(opts, componentsPath) {
  for (const dir of [opts.ui, componentsPath && dirname(componentsPath), join(packageRoot, "ui")].filter(Boolean)) {
    if (!existsSync(join(dir, "package.json"))) continue;
    const pkg = json(join(dir, "package.json"));
    const entry = typeof pkg.exports === "string" ? pkg.exports : pkg.exports?.["."] ?? pkg.main;
    if (pkg.name !== DS_COMPONENT_LAYER || typeof entry !== "string") continue;
    let aliasRoot;
    try {
      const target = json(join(dir, "tsconfig.json")).compilerOptions?.paths?.["@/*"]?.[0];
      if (typeof target === "string" && target.endsWith("/*")) aliasRoot = resolve(dir, target.slice(0, -2));
    } catch { aliasRoot = undefined; }
    return { dir, entry: resolve(dir, entry), aliasRoot, exports: new Map() };
  }
  return undefined;
}

/** Exported name -> the file that defines it, following re-exports inside the layer; null when ambiguous, `external:<spec>` outside it. */
function moduleExports(file, cache) {
  if (cache.has(file)) return cache.get(file);
  const map = new Map();
  cache.set(file, map);
  const ts = loadTypeScript();
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const set = (name, defined) => map.set(name, map.has(name) && map.get(name) !== defined ? null : defined);
  const target = spec => (spec.startsWith(".") ? resolveModuleFile(resolve(dirname(file), spec)) : undefined);
  const imported = new Map();
  for (const st of source.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings)) {
      for (const e of st.importClause.namedBindings.elements) imported.set(e.name.text, { spec: st.moduleSpecifier.text, name: (e.propertyName ?? e.name).text });
    }
  }
  const viaImport = local => {
    const imp = imported.get(local);
    if (!imp) return file;
    const inner = target(imp.spec);
    return inner ? moduleExports(inner, cache).get(imp.name) ?? null : `external:${imp.spec}`;
  };
  for (const st of source.statements) {
    if (ts.isExportDeclaration(st)) {
      const spec = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : undefined;
      const inner = spec !== undefined ? target(spec) : undefined;
      if (spec !== undefined && !inner) {
        if (st.exportClause && ts.isNamedExports(st.exportClause)) for (const e of st.exportClause.elements) set(e.name.text, `external:${spec}`);
        continue;
      }
      if (!st.exportClause) { for (const [name, defined] of moduleExports(inner, cache)) if (name !== "default") set(name, defined); continue; }
      if (!ts.isNamedExports(st.exportClause)) { set(st.exportClause.name.text, inner); continue; }
      for (const e of st.exportClause.elements) {
        const local = (e.propertyName ?? e.name).text;
        set(e.name.text, inner ? moduleExports(inner, cache).get(local) ?? null : viaImport(local));
      }
      continue;
    }
    if (!(ts.canHaveModifiers?.(st) ? ts.getModifiers(st) ?? [] : st.modifiers ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isVariableStatement(st)) { for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) set(d.name.text, file); }
    else if (st.name && ts.isIdentifier(st.name)) set(st.name.text, file);
  }
  return map;
}

/**
 * A `composition` source: the candidate's code only arranges declared stock parts.
 * - each part is a pinned registry slot, verbatim (no recorded adaptations) and
 *   strict-clean, and `files` names exactly the vendored reference paths its pin
 *   maps, additional source parts included (REF-COMP-PART);
 * - every UI import resolves (through the component layer's barrel or its `@/`
 *   alias) to a declared part's file, AST-identical to that part's pinned copy
 *   (zero ref-verbatim hunks of any class); any other import fails (REF-COMP-IMPORT);
 * - every declared part is imported (REF-COMP-UNUSED), and the slot's `uses`
 *   equal the declared parts (REF-COMP-USES);
 * - the ds-only markup rule (section form) holds: no styled raw element (REF-COMP-MARKUP);
 * - no lineage ref points into Foundry's package folders (REF-SELF-CITE).
 */
function checkComposition(root, slot, candidate, options = {}) {
  const opts = defaults(options);
  const element = candidate.name ?? "unknown";
  const key = `${slot}/${element}@v1`;
  const findings = [];
  const files = [];
  const fail = (code, detail, extra = {}) => findings.push({ element: key, code, detail, ...extra });
  const source = candidate.meta?.source ?? {};
  const payload = Object.fromEntries((candidate.files ?? []).map(file => [file.path, file.content]));
  if (Object.values(payload).some(content => typeof content !== "string")) throw new Error("registry candidate must carry every payload file's content");
  const hash = treeHash(Object.entries(payload).map(([path, content]) => ({ path, sha256: sha256(content) })));
  const result = () => ({ key, slot, element, version: 1, status: findings.length ? "fail" : "pass", files, findings, hash, ref: "composition" });

  for (const ref of Array.isArray(source.ref) ? source.ref : []) if (selfCitation(ref)) findings.push(selfCiteFinding(key, ref));
  if (candidate.meta?.refVerbatim !== undefined) fail("REF-ADAPTATION", "a composition records no refVerbatim mappings or adaptations: its code is checked against its parts");

  // Code: payload code files, plus code embedded in a registry JSON payload; a path-only entry must name a payload file.
  const code = new Map(Object.entries(payload).filter(([path]) => isCode(path)));
  for (const [path, text] of Object.entries(payload).filter(([path]) => path.endsWith(".json"))) {
    let value;
    try { value = JSON.parse(text); } catch { continue; }
    if (!Array.isArray(value?.files)) continue;
    for (const entry of value.files) {
      if (!isCode(entry?.path ?? "")) continue;
      if (typeof entry.content !== "string") { if (!code.has(entry.path) || !Object.hasOwn(payload, entry.path)) fail("REF-NO-SOURCE", `embedded code ${entry.path} has no content and is not a payload file`, { file: path }); }
      else if (code.has(entry.path)) { if (code.get(entry.path) !== entry.content) fail("REF-FILE-UNMAPPED", `embedded code ${entry.path} differs from the file of the same path`, { file: path }); }
      else code.set(entry.path, entry.content);
    }
  }

  const slotDirs = designerSlotDirs(root);
  const parts = Array.isArray(source.parts) ? source.parts : [];
  if (!parts.length) fail("REF-COMP-PART", "composition lineage needs parts: [{slot, files: [vendored reference paths]}]");
  const declared = new Map();
  for (const part of parts) {
    if (!part || typeof part.slot !== "string" || !Array.isArray(part.files) || !part.files.length || part.files.some(file => typeof file !== "string")) { fail("REF-COMP-PART", "each part must be {slot, files: [vendored reference paths]}"); continue; }
    if (declared.has(part.slot)) { fail("REF-COMP-PART", `${part.slot} is declared twice`); continue; }
    const stock = stockPart(root, part.slot, slotDirs.get(part.slot), options);
    if (stock.error) { fail("REF-COMP-PART", `${part.slot} ${stock.error}; a composition places only stock parts`); continue; }
    if (!sameSet(part.files, stock.vendored)) { fail("REF-COMP-PART", `${part.slot} files ${JSON.stringify(part.files)} are not its pin's vendored reference paths ${JSON.stringify(stock.vendored)}`); continue; }
    declared.set(part.slot, { ...stock, used: false });
  }

  const components = loadComponents(root, opts.components);
  const layer = componentLayer(opts, components?.path);
  const compared = new Map();
  let owners;
  const stockOwners = name => {
    if (!owners) {
      owners = new Map();
      for (const [id, dir] of slotDirs) {
        const { item } = pinnedCandidate(dir);
        if (item?.meta?.source?.kind !== "registry") continue;
        for (const file of item.files ?? []) if (isCode(file.path)) owners.set(basename(file.path), [...(owners.get(basename(file.path)) ?? []), id]);
      }
    }
    return owners.get(name) ?? [];
  };
  const shown = path => (layer && path.startsWith(layer.dir) ? `${DS_COMPONENT_LAYER}/${path.slice(layer.dir.length + 1)}` : path);
  const claim = (resolved, label, file) => {
    if (typeof resolved !== "string" || resolved.startsWith("external:")) {
      fail("REF-COMP-IMPORT", `${label} ${resolved === null ? "is exported ambiguously" : resolved ? `is re-exported from ${resolved.slice(9)}` : "does not resolve"} in the component layer; it is no declared part's vendored file`, { file });
      return;
    }
    const name = basename(resolved);
    const matches = [...declared].filter(([, part]) => part.codeFiles.some(entry => basename(entry.path) === name));
    if (matches.length !== 1) {
      const others = stockOwners(name);
      fail("REF-COMP-IMPORT", matches.length ? `${label} resolves to ${shown(resolved)}, which ${matches.map(([id]) => id).join(" and ")} all ship; declare one` : `${label} resolves to ${shown(resolved)}, ${others.length ? `the vendored file of ${others.join(" / ")}, which is not a declared part` : "which is not a stock part's vendored file"}`, { file });
      return;
    }
    const [id, part] = matches[0];
    const pinned = part.codeFiles.find(entry => basename(entry.path) === name);
    const at = `${id}:${resolved}`;
    if (!compared.has(at)) {
      let hunks;
      try { hunks = diffSources(pinned.content, pinned.path, readFileSync(resolved, "utf8"), name).hunks.length; } catch (error) { hunks = error.message; }
      compared.set(at, hunks);
    }
    const hunks = compared.get(at);
    if (hunks !== 0) fail("REF-COMP-IMPORT", `${label} resolves to ${shown(resolved)}, which differs from ${id}'s pinned copy (${typeof hunks === "number" ? `${hunks} hunk(s)` : hunks})`, { file });
    else part.used = true;
  };

  if (code.size && !layer) fail("REF-COMP-IMPORT", `no component layer package (${DS_COMPONENT_LAYER}) to resolve a composition's imports against`);
  for (const [file, text] of [...code].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const before = findings.length;
    let events = [];
    try { events = dsOnlyEvents(text, file, { kind: "section" }); } catch (error) { fail("REF-NORMALIZE", error.message, { file }); }
    for (const event of events) {
      if (event.type === "markup") { fail("REF-COMP-MARKUP", `<${event.tag} ${event.attr}>: styled raw markup is not composition; a composition renders only its stock parts`, { file }); continue; }
      if (event.type === "dynamic") { fail("REF-COMP-IMPORT", `dynamic import ${event.specifier}: a composition imports only its declared parts`, { file }); continue; }
      const { specifier, names } = event;
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        const local = posix.normalize(posix.join(posix.dirname(file), specifier));
        if (![local, `${local}.tsx`, `${local}.ts`, `${local}/index.tsx`, `${local}/index.ts`].some(path => code.has(path))) fail("REF-COMP-IMPORT", `${specifier} is neither a declared part nor a file of this composition`, { file });
        continue;
      }
      if (!layer) continue;
      if (specifier === DS_COMPONENT_LAYER) {
        for (const name of names) {
          if (name === "*" || name === "default") { fail("REF-COMP-IMPORT", `${name === "*" ? "a namespace import" : "a default import"} of ${DS_COMPONENT_LAYER} does not name the parts it places`, { file }); continue; }
          claim(moduleExports(layer.entry, layer.exports).get(name), `${name} from ${DS_COMPONENT_LAYER}`, file);
        }
        continue;
      }
      if (specifier.startsWith("@/") && layer.aliasRoot) {
        claim(resolveModuleFile(join(layer.aliasRoot, specifier.slice(2))), specifier, file);
        continue;
      }
      fail("REF-COMP-IMPORT", `${specifier} is not a declared stock part; a composition imports only parts of ${DS_COMPONENT_LAYER}`, { file });
    }
    const codes = [...new Set(findings.slice(before).map(f => f.code))];
    files.push({ file, mapping: "composition", hunks: [], codes, status: codes.length ? "fail" : "pass" });
  }
  for (const [id, part] of declared) if (!part.used) fail("REF-COMP-UNUSED", `${id} is a declared part, but no import resolves to its vendored files`);

  const doc = options.slotDoc ?? (slotDirs.get(slot) ? json(join(slotDirs.get(slot), "slot.json")) : undefined);
  const partSlots = parts.filter(part => typeof part?.slot === "string").map(part => part.slot);
  if (!doc) fail("REF-COMP-USES", `${slot} has no slot.json whose uses could match the declared parts`);
  else if (!Array.isArray(doc.uses) || !sameSet(doc.uses, partSlots)) fail("REF-COMP-USES", `slot.json uses ${JSON.stringify(doc.uses ?? [])} must equal the declared parts ${JSON.stringify([...partSlots].sort())}`);
  return result();
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
        const slotDoc = json(join(child, "slot.json"));
        const slot = slotDoc.id;
        if (!/^[a-z0-9][a-z0-9.-]*-v[1-9][0-9]*\.json$/.test(pin.candidate ?? "")) throw new Error(`invalid Designer pin candidate in ${slot}`);
        const bytes = readFileSync(join(child, "candidates", pin.candidate));
        const checked = checkRegistryItem(root, slot, JSON.parse(bytes.toString("utf8")), { ...options, strict: true, slotDoc });
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
