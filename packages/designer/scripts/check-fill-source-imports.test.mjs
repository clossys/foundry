import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkFillSourceImports, createImportGraph } from "./check-fill-source-imports.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const source = path.join(repository, "packages/designer/src");
const scratch = path.join(repository, "coverage/tmp/a290-proc2");
fs.mkdirSync(scratch, { recursive: true });
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith(".js") && context.parentURL?.startsWith(pathToFileURL(source).href + "/")) {
      const candidate = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
      if (fs.existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(pathToFileURL(source).href + "/") && url.endsWith(".ts")) return { format: "module", source: stripTypeScriptTypes(fs.readFileSync(new URL(url), "utf8"), { mode: "transform" }), shortCircuit: true };
    return next(url, context);
  },
});
const { loadCatalogBundles } = await import(pathToFileURL(path.join(source, "catalog-bundles.ts")).href);
const { loadComponentRegistry } = await import(pathToFileURL(path.join(source, "catalog-core/component-registry.ts")).href);
const { applyComponentLibraryChange } = await import(pathToFileURL(path.join(source, "catalog-core/changeset-components.ts")).href);
const { resolveComponents, componentLibraryHash } = await import(pathToFileURL(path.join(source, "catalog-core/resolve-components.ts")).href);
const { emitComponents } = await import(pathToFileURL(path.join(source, "catalog-core/emit-components.ts")).href);
const { surfacePackageDocument, surfacePackageDescriptorHash } = await import(pathToFileURL(path.join(source, "catalog-core/surface-library.ts")).href);
const { emitSurfaces } = await import(pathToFileURL(path.join(source, "catalog-core/surface-emit.ts")).href);
hook.deregister();
const packageExports = { clsx: Object.keys(await import("clsx")), "tailwind-merge": Object.keys(await import("tailwind-merge")) };

function write(root, file, value) { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value)); return target; }
function nativeFixture(label) {
  const site = fs.mkdtempSync(path.join(scratch, label + "-")), library = path.join(site, "library");
  const bundles = loadCatalogBundles(), registry = loadComponentRegistry();
  const catalog = { slots: registry.slots, fills: bundles.componentFills };
  let native = { source: { kind: "consumer", author: "consumer", id: "import-check-fixture", license: "MIT" }, fills: [], files: [], adoptedAt: "2026-10-30" };
  native = applyComponentLibraryChange(catalog, native, { baseHash: componentLibraryHash(native), changes: [{ op: "adopt", slot: "components.card", source: "shadcn@aria" }] }, bundles.sourceBundles);
  const descriptor = Object.values(native.fills[0].components)[0];
  const tokens = Object.fromEntries(descriptor.reads.tokens.map((id, index) => [id, { property: `--fixture-${index}`, light: "1rem" }]));
  const profile = resolveComponents({ catalog, library: native, values: { tokens, assets: [] }, packageExports, evidence: { observations: {}, installedRac: { version: "1.19.0", instance: "react-aria-components" } } });
  assert.equal(profile.check.ok, true, JSON.stringify(profile.check.findings));
  for (const file of emitComponents(profile, ["component-index"])) write(library, file.path, file.content);
  for (const document of native.fills) write(library, `fills/${document.$extensions["com.clossys.fill"].slot}.json`, document);
  write(library, "resolved.json", { components: profile });
  write(site, "page.tsx", 'import { Card } from "./library/component-index.js"; export default function Page(){return <Card/>;}\n');
  const contract = write(site, "dogfood.json", { version: 1, sources: {}, pages: ["page.tsx"] });
  return { site, library, contract, repository, sourceHead: head };
}

test("production adoption + resolver + emitter provides an actual native import fixture", () => {
  const options = nativeFixture("pristine");
  const report = checkFillSourceImports(options);
  assert.equal(report.ok, true, JSON.stringify(report.violations));
  assert.deepEqual(report.leaves[0].imported, ["shadcn@aria/components.card"]);
  assert.ok(report.leaves[0].edges.length > 0);
});

test("wrong actual native import fails with unchanged source metadata, then pristine passes", () => {
  const pristine = nativeFixture("mutation-pristine");
  const candidateSite = fs.mkdtempSync(path.join(scratch, "mutation-candidate-"));
  fs.cpSync(pristine.site, candidateSite, { recursive: true });
  const options = { ...pristine, site: candidateSite, library: path.join(candidateSite, "library"), contract: path.join(candidateSite, "dogfood.json") };
  const entry = path.join(options.library, "components/card/index.ts"), original = fs.readFileSync(entry, "utf8");
  assert.ok(original.includes('from "./card"'));
  write(options.library, "components/card/wrong.tsx", "export function Card(){return <aside/>;}\n");
  fs.writeFileSync(entry, original.replace('from "./card"', 'from "./wrong"'));
  const report = checkFillSourceImports(options);
  assert.equal(report.ok, false);
  assert.ok(report.violations.some(row => row.code === "source-import-mismatch"));
  const child = spawnSync(process.execPath, [path.join(repository, "packages/designer/scripts/check-fill-source-imports.mjs"), "--site", options.site, "--library", options.library, "--contract", options.contract, "--source-head", head, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(child.status, 1, child.stderr);
  assert.equal(JSON.parse(child.stdout).ok, false);
  assert.equal(checkFillSourceImports(pristine).ok, true);
  write(candidateSite, "mutation-proof.json", { mutation: "actual emitted native card import changed; resolved.json and fill metadata unchanged", sourceHead: head, candidate: options.site, mutantExit: child.status, pristineExit: 0, violations: report.violations });
});

test("metadata-only selection, missing catalog and stale head fail closed", () => {
  assert.equal(checkFillSourceImports({ repository, sourceHead: head }).exitStatus, 2);
  const options = nativeFixture("missing-index");
  fs.renameSync(path.join(options.library, "component-index.ts"), path.join(options.library, "component-index.saved.ts"));
  assert.equal(checkFillSourceImports(options).ok, false);
  const stale = checkFillSourceImports({ ...options, sourceHead: "0".repeat(40) });
  assert.equal(stale.exitStatus, 2);
  assert.match(stale.violations[0].detail, /Stale source head/);
  const noCatalog = fs.mkdtempSync(path.join(scratch, "no-catalog-"));
  assert.equal(checkFillSourceImports({ ...options, repository: noCatalog }).exitStatus, 2);
});

test("native adoption hashes and actual pinned source bytes cannot be replaced by metadata claims", () => {
  const options = nativeFixture("source-bytes");
  const actual = path.join(options.library, "components/card/card.tsx");
  fs.appendFileSync(actual, "\n// candidate source mutation\n");
  assert.ok(checkFillSourceImports(options).violations.some(row => /Actual source bytes differ/.test(row.detail)));
  const metadata = nativeFixture("source-origin");
  const file = path.join(metadata.library, "resolved.json"), profile = JSON.parse(fs.readFileSync(file, "utf8"));
  profile.components.components["components.card"].origin.source = "foundry";
  fs.writeFileSync(file, JSON.stringify(profile));
  assert.equal(checkFillSourceImports(metadata).ok, false);
});

test("declared sections and frames require real installed import bindings too", () => {
  const options = nativeFixture("surface-bindings"), fills = {};
  for (const slot of ["sections.hero", "frames.site-shell"]) {
    const document = JSON.parse(fs.readFileSync(path.join(source, `catalog/fills/foundry/${slot}.json`), "utf8"));
    const meta = document.$extensions["com.clossys.fill"], fill = Object.values(document[slot.split(".")[0]])[0];
    const origin = { kind: "package", source: meta.source, fill: meta.id, pin: meta.pin, license: meta.license, descriptorHash: surfacePackageDescriptorHash(fill), adoptedAt: "2026-10-30" };
    const adopted = surfacePackageDocument({ source: { id: "import-check-fixture" } }, fill, origin);
    fills[slot] = { document: adopted };
    write(options.library, `fills/${slot}.json`, adopted);
  }
  const surfaces = { version: 1, consumer: "import-check-fixture", selectionHash: "sha256:" + "0".repeat(64), fills, files: [], check: { ok: true, findings: [] } };
  for (const file of emitSurfaces(surfaces, ["surface-index"])) write(options.library, file.path, file.contents);
  const file = path.join(options.library, "resolved.json"), profile = JSON.parse(fs.readFileSync(file, "utf8"));
  write(options.library, "resolved.json", { ...profile, surfaces });
  const report = checkFillSourceImports(options);
  assert.equal(report.scope.leaves, 3);
  for (const slot of Object.keys(fills)) assert.ok(report.violations.some(row => row.slot === slot && row.code === "source-provenance"), JSON.stringify(report.violations));
});

test("re-export aliases preserve source identity and unresolved cycles fail closed", () => {
  const options = nativeFixture("alias");
  const index = path.join(options.library, "component-index.ts");
  const original = fs.readFileSync(index, "utf8");
  write(options.library, "alias.ts", original);
  fs.writeFileSync(index, 'export { Card as Card } from "./alias.js";\n');
  assert.equal(checkFillSourceImports(options).ok, true);
  fs.writeFileSync(index, 'export { Card } from "./cycle.js";\n');
  write(options.library, "cycle.ts", 'export { Card } from "./component-index.js";\n');
  assert.equal(checkFillSourceImports(options).ok, false);
});

test("unsupported dynamic component binding never receives import credit", () => {
  const root = fs.mkdtempSync(path.join(scratch, "dynamic-"));
  const entry = write(root, "entry.tsx", "export function Page({Target}) {return <Target/>;}\n");
  const graph = createImportGraph({ roots: [entry], repository });
  assert.ok(graph.renderClosure(graph.exported(entry, "Page")).findings.some(row => /dynamic/.test(row.detail)));
});
