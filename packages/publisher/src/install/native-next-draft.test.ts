import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CompositeCatalogData, CompositeLibraryData } from "@clossys/designer/catalog";
import { directoryRecordSource, recordStoreSource } from "../specimen/source.js";
import type { SpecimenRecordSource } from "../specimen/types.js";
import { installAndBind, resolveNativeNextDraft, type InstallPageRecord, type InstallPins, type NativeNextDraftCandidate, type ShadcnRunner } from "./index.js";

const fixtures = join(import.meta.dirname, "__fixtures__");
const requireHere = createRequire(import.meta.url);
const temps: string[] = [];
const json = async (name: string) => JSON.parse(await readFile(join(fixtures, name), "utf8"));
let page: InstallPageRecord, pins: InstallPins, copy: Record<string, string>;
let server: Server, registryUrl: string;

/** The real store seam, retaining the public fixture versions' actual file hashes. */
function sourceAt(root = join(fixtures, "library")): SpecimenRecordSource {
  const fixtures = directoryRecordSource({ roots: [root] });
  return recordStoreSource({
    async load(id, version) {
      const record = await fixtures.read(id, version);
      return record ? {
        id: record.id, version: record.version, kind: record.kind,
        files: record.sources!, preview: record.preview, contentHash: record.contentHash,
      } : undefined;
    },
  });
}
async function admissions(source = sourceAt()): Promise<Record<string, NativeNextDraftCandidate>> {
  return Object.fromEntries(await Promise.all(Object.entries(pins).map(async ([slot, pin]) => {
    const record = await source.read(`${slot}/${pin.element}`, pin.version);
    return [slot, { ...pin, contentHash: record!.contentHash }];
  })));
}
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), "native-next-draft-"));
  temps.push(dir);
  return dir;
}
const realRunner: ShadcnRunner = (args, { cwd }) => new Promise(done => {
  execFile(process.execPath, [requireHere.resolve("shadcn"), ...args], {
    cwd, env: { ...process.env, REGISTRY_URL: registryUrl }, timeout: 60_000,
  }, (error, stdout, stderr) => done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) }));
});

beforeAll(async () => {
  [page, pins, copy] = await Promise.all([json("pages/home.json"), json("pins.json"), json("writer-copy.json")]);
  server = createServer((request, response) => {
    if (request.url?.startsWith("/r/colors/")) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ inlineColors: { light: {}, dark: {} }, cssVars: { light: {}, dark: {} }, cssVarsV4: { light: {}, dark: {} }, inlineColorsTemplate: "", cssVarsTemplate: "" }));
    } else { response.statusCode = 404; response.end("{}"); }
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  registryUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/r`;
});
afterAll(async () => {
  await new Promise<void>(done => server.close(() => done()));
  await Promise.all(temps.map(dir => rm(dir, { recursive: true, force: true })));
});

describe("resolveNativeNextDraft", () => {
  it("emits an unapproved Next entry from real native records, installs through the public seam, and renders Writer copy", async () => {
    const originalPins = JSON.stringify(pins);
    const source = sourceAt();
    const draft = await resolveNativeNextDraft({ page, candidates: await admissions(source), source, copy });
    expect(draft.findings).toEqual([]);
    expect(draft.status).toBe("DRAFT");
    expect(draft.approved).toBe(false);
    expect(draft.module).not.toContain('"use client"');
    expect(draft.module).toContain('import { PlainFrame as c0 }');
    expect(draft.module).toContain('import { SimpleHero as c1 }');
    expect(draft.module).not.toMatch(/Object\.values|typeof component|import \* as/);
    expect(draft.module).toContain('from "../components/frames/plain-frame"');
    expect(draft.module).toContain('from "../components/sections/simple-hero"');
    expect(draft.module!.match(/^export /gm)).toEqual(["export "]);
    expect(draft).not.toHaveProperty("productionPinDocs");
    expect(JSON.stringify(pins)).toBe(originalPins);

    const dir = await temp();
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "native-draft", private: true, type: "module" }));
    await writeFile(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { paths: { "@/*": ["./*"] }, jsx: "react-jsx" } }));
    await writeFile(join(dir, "components.json"), JSON.stringify({ $schema: "https://ui.shadcn.com/schema.json", style: "new-york", rsc: true, tsx: true, tailwind: { config: "", css: "app.css", baseColor: "neutral", cssVariables: true }, aliases: { components: "@/components", utils: "@/lib/utils", ui: "@/components/ui", lib: "@/lib", hooks: "@/hooks" } }));
    await writeFile(join(dir, "app.css"), "");
    const installed = await installAndBind({ ...draft.install!, substrate: dir, runner: realRunner });
    expect(installed.findings).toEqual([]);
    expect(installed.page).toEqual(draft.page);
    await mkdir(join(dir, "app"));
    await writeFile(join(dir, "app/page.tsx"), draft.module!);
    const esbuild = await import("esbuild");
    const built = await esbuild.build({
      entryPoints: [join(dir, "app/page.tsx")],
      bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic",
      plugins: [{ name: "host-react", setup(build) { build.onResolve({ filter: /^react(\/.*)?$/ }, args => ({ path: requireHere.resolve(args.path), external: true })); } }],
    });
    const out = join(dir, "draft.mjs");
    await writeFile(out, built.outputFiles[0]!.text);
    const entry = await import(pathToFileURL(out).href);
    const React = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const html = renderToStaticMarkup(React.createElement(entry.default));
    for (const text of Object.values(copy)) expect(html).toContain(text);
    expect(html).not.toMatch(/Sample site|Sample heading|Sample body/);
  }, 120_000);

  it("refuses changed actual source bytes before emitting output (hash-guard mutant sentinel)", async () => {
    const root = join(await temp(), "library");
    await cp(join(fixtures, "library"), root, { recursive: true });
    const source = sourceAt(root), candidates = await admissions(source);
    const file = join(root, "sections.hero/simple-hero/v1/simple-hero.json");
    await writeFile(file, (await readFile(file, "utf8")).replace("<h1", "<h2").replace("</h1>", "</h2>"));
    const draft = await resolveNativeNextDraft({ page, candidates, source, copy });
    expect(draft.findings).toEqual([expect.objectContaining({ code: "hash-mismatch", slot: "sections.hero" })]);
    expect(draft.module).toBeUndefined();
    expect(draft.install).toBeUndefined();
  });

  it.each(["missing", "hash", "id", "version"] as const)("refuses a %s admission or returned record", async variant => {
    const real = sourceAt(), candidates = await admissions(real);
    if (variant === "missing") delete candidates["sections.hero"];
    if (variant === "hash") candidates["sections.hero"] = { ...candidates["sections.hero"]!, contentHash: "" };
    const source: SpecimenRecordSource = { ...real, async read(id, version) {
      const record = await real.read(id, version);
      return record && id.startsWith("sections.hero/")
        ? { ...record, ...(variant === "id" ? { id: "sections.other/changed" } : {}), ...(variant === "version" ? { version: 2 } : {}) }
        : record;
    } };
    const draft = await resolveNativeNextDraft({ page, candidates, source, copy });
    expect(draft.findings.length).toBeGreaterThan(0);
    expect(draft.module).toBeUndefined();
    expect(draft.install).toBeUndefined();
  });

  it("refuses a newly referenced section without a current candidate", async () => {
    const draft = await resolveNativeNextDraft({ page: { ...page, sections: [...page.sections, "sections.other"] }, candidates: await admissions(), source: sourceAt(), copy });
    expect(draft.findings).toEqual([expect.objectContaining({ code: "unpinned-slot", slot: "sections.other" })]);
    expect(draft.module).toBeUndefined();
  });

  it("keeps verified bytes for installAndBind when the backing store changes afterward", async () => {
    const root = join(await temp(), "library");
    await cp(join(fixtures, "library"), root, { recursive: true });
    const source = sourceAt(root), candidates = await admissions(source);
    const draft = await resolveNativeNextDraft({ page, candidates, source, copy });
    await rm(join(root, "sections.hero"), { recursive: true });
    const selected = candidates["sections.hero"]!;
    const snapshot = await draft.install!.source.read(`sections.hero/${selected.element}`, selected.version);
    expect(snapshot!.contentHash).toBe(selected.contentHash);
    expect(snapshot!.payload.raw).toContain("SimpleHero");
    const again = await resolveNativeNextDraft({ page, candidates, source, copy });
    expect(again.findings).toEqual([expect.objectContaining({ code: "missing-record" })]);
    expect(again.module).toBeUndefined();
  });
});

/** Edit native fixture bytes first, then obtain fresh admissions from the real source adapter. */
async function withEntry(slot: "frames.plain" | "sections.hero", content: string, options: { export?: string; copyKeys?: string } = {}, root?: string) {
  if (!root) { root = join(await temp(), "library"); await cp(join(fixtures, "library"), root, { recursive: true }); }
  const element = pins[slot]!.element, dir = join(root, slot, element, "v1");
  const itemPath = join(dir, `${element}.json`), previewPath = join(dir, "preview.json");
  const item = JSON.parse(await readFile(itemPath, "utf8"));
  item.files[0].content = content;
  const preview = JSON.parse(await readFile(previewPath, "utf8"));
  preview.fixtures = { file: item.files[0].path, ...options, props: {} };
  await writeFile(itemPath, JSON.stringify(item));
  await writeFile(previewPath, JSON.stringify(preview));
  const source = sourceAt(root);
  if (options.copyKeys) {
    const record = await source.read(`${slot}/${element}`, 1);
    expect(record!.preview).toHaveProperty("copyKeys", options.copyKeys);
  }
  return { root, source };
}

const clientHero = `"use client";
import { useState } from "react";
export const copyKeys = { content: { heading: "hero.heading", body: ["hero.body"] } } as const;
export function Island({ copy }: { copy: { heading: string; body: string[] } }) {
  const [count, setCount] = useState(0);
  return <section><h1>{copy.heading}</h1><p>{copy.body[0]}</p><button onClick={() => setCount(count + 1)}>Count {count}</button></section>;
}`;

describe("native server/client module composition", () => {
  it("materializes a named client module's nested copyKeys from verified entry bytes", async () => {
    const { source } = await withEntry("sections.hero", clientHero, { export: "Island", copyKeys: "copyKeys.content" });
    const candidates = await admissions(source);
    const draft = await resolveNativeNextDraft({ page, candidates, source, copy });
    expect(draft.findings).toEqual([]);
    expect(draft.module).toContain('import { Island as c1 }');
    expect(draft.module).toContain(`"heading": ${JSON.stringify(copy["home.hero.heading"])}`);
    expect(draft.module).toContain('"body": [');
    expect(draft.module).not.toMatch(/copyKeys|use client|Object\.values|typeof component/);
    expect(draft.status).toBe("DRAFT");
    expect(draft.approved).toBe(false);
    const selected = candidates["sections.hero"]!;
    expect((await draft.install!.source.read(`sections.hero/${selected.element}`, selected.version))!.contentHash).toBe(selected.contentHash);
  });

  it.each([
    'export const copyKeys = imported;',
    'export const copyKeys = makeMap();',
    'export const copyKeys = { ...other };',
    'export const copyKeys = { ["heading"]: "hero.heading" };',
    'export const copyKeys = { heading: "hero.heading", heading: "hero.body" };',
    'export const copyKeys = { __proto__: "hero.heading" };',
    'export const copyKeys = { constructor: "hero.heading" };',
    'export const copyKeys = { prototype: "hero.heading" };',
    'export const copyKeys = { heading: "undeclared.port" };',
    'export const copyKeys = { heading: "hero.heading";',
    'export { copyKeys } from "./other";',
    'export const copyKeys = {}; export const copyKeys = {};',
  ])("refuses unsupported copy mapping without emitting a module or install: %s", async mapping => {
    const { source } = await withEntry("sections.hero", `export function Island() { return null; }\n${mapping}`, { export: "Island", copyKeys: "copyKeys" });
    const draft = await resolveNativeNextDraft({ page, candidates: await admissions(source), source, copy });
    expect(draft.findings).toEqual([expect.objectContaining({ code: "render-failed" })]);
    expect(draft.module).toBeUndefined();
    expect(draft.install).toBeUndefined();
    expect(draft.approved).toBe(false);
  });

  it.each([
    ["property mutation", 'copyKeys.heading = "hero.body";'],
    ["root reassignment", 'copyKeys = { heading: "hero.body" };'],
    ["alias", 'const alias = copyKeys; alias.heading = "hero.body";'],
    ["Object.assign", 'Object.assign(copyKeys, { heading: "hero.body" });'],
  ])("refuses a copy map with %s outside its literal declaration", async (_name, mutation) => {
    const content = `export function Island() { return null; }\nexport const copyKeys = { heading: "hero.heading" };\n${mutation}`;
    const { source } = await withEntry("sections.hero", content, { export: "Island", copyKeys: "copyKeys" });
    const draft = await resolveNativeNextDraft({ page, candidates: await admissions(source), source, copy });
    expect(draft.findings).toEqual([expect.objectContaining({ code: "render-failed", detail: expect.stringContaining("reference outside its literal declaration") })]);
    expect(draft.module).toBeUndefined();
    expect(draft.install).toBeUndefined();
    expect(draft.approved).toBe(false);
  });

  it.each([
    ['export default function Island() { return null; }', "default"],
    ['export const Island = () => null; export const copyKeys = {};', "Island"],
    ['export class Island { render() { return null; } }', "Island"],
  ])("selects an unambiguous native export without runtime reflection", async (content, name) => {
    const { source } = await withEntry("sections.hero", content);
    const draft = await resolveNativeNextDraft({ page, candidates: await admissions(source), source, copy });
    expect(draft.findings).toEqual([]);
    expect(draft.module).toContain(`import { ${name} as c1 }`);
  });

  it.each([
    'export function A() { return null; } export function B() { return null; }',
    'export { Island } from "./other";',
    'export const copyKeys = {};',
  ])("refuses an ambiguous or indirect undeclared component export", async content => {
    const { source } = await withEntry("sections.hero", content);
    const draft = await resolveNativeNextDraft({ page, candidates: await admissions(source), source, copy });
    expect(draft.findings).toEqual([expect.objectContaining({ code: "render-failed" })]);
    expect(draft.module).toBeUndefined();
    expect(draft.install).toBeUndefined();
  });
});

// LOCAL recipe: prepare a normal native consumer with real candidate packages and Next 16,
// then FOUNDRY_NATIVE_NEXT_ROOT=<consumer> npm test -w @clossys/publisher -- src/install/native-next-draft.test.ts
// The mandatory package globalSetup builds dist. Do not run this test in a source-only cloud session.
// Mutation proof: restoring the whole-page "use client" fails the real Designer server graph;
// replacing prepared copy data with client-module export reflection fails the Next client proxy.
// Provider mutation: in the generated layout value replace profile.components.components
// with {} while retaining its real selectionHash and descriptors; Next build must fail
// with "NEED component selection: components.link". Restore before the normal run.
it.skipIf(!process.env.FOUNDRY_NATIVE_NEXT_ROOT)("builds a genuine Next16 consumer with Designer SiteFrame and a native client island", async () => {
  const consumer = process.env.FOUNDRY_NATIVE_NEXT_ROOT!;
  const nativeRequire = createRequire(join(consumer, "package.json"));
  expect(JSON.parse(await readFile(nativeRequire.resolve("next/package.json"), "utf8")).version).toMatch(/^16\./);
  const dir = await mkdtemp(join(consumer, ".native-next-draft-")); temps.push(dir);
  const { loadCatalog, loadComponentRegistry, importFoundryComponents, applyLibraryChange, libraryHash, resolve } = await import("@clossys/designer/catalog");
  const components = await import("@clossys/designer/components");
  const catalog: CompositeCatalogData = { values: loadCatalog(), components: { slots: loadComponentRegistry().slots, fills: importFoundryComponents().fills } };
  const empty: CompositeLibraryData = { source: { id: "native-next-draft", kind: "consumer", author: "consumer", license: "MIT" }, adoptedAt: new Date().toISOString().slice(0, 10), values: { fills: [] }, components: { fills: [], files: [] } };
  const valueChanges = catalog.values.slots.filter(slot => slot.layer === "themes").flatMap(slot => {
    const offers = catalog.values.fills.filter(fill => fill.$extensions["com.clossys.fill"].slot === slot.id && fill.$extensions["com.clossys.fill"].mode !== "reference");
    const fill = ["foundry", "tailwind-default"].map(source => offers.find(fill => fill.$extensions["com.clossys.fill"].source === source)).find(Boolean) ?? offers[0];
    return fill ? [{ portion: "values" as const, change: { op: "adopt" as const, slot: slot.id, source: fill.$extensions["com.clossys.fill"].source } }] : [];
  });
  const componentOptions = { packageExports: { "@clossys/designer/components": Object.keys(components) } };
  const library = applyLibraryChange(catalog, empty, { baseHash: libraryHash(empty), changes: [...valueChanges, { portion: "components", change: { op: "adopt", slot: "components.link", source: "foundry" } }] }, { componentOptions });
  const profile = resolve({ catalog, library, componentOptions });
  const chosen = profile.components.components["components.link"]!;
  expect(chosen.origin.kind).toBe("adopted");
  if (chosen.origin.kind !== "adopted") throw new Error("native fixture requires adopted components.link");
  expect(chosen.origin.pin).toEqual(expect.objectContaining({ package: "@clossys/designer", export: "./components#Link" }));
  expect(profile.components.check.findings).toContainEqual(expect.objectContaining({ subject: "components.link", severity: "notice", message: "Source and runtime observations are unavailable" }));
  // Real adopted descriptors and source modules are runtime-pending, not qualified fills.
  const selection = { profile: { components: profile.components }, selectionHash: profile.components.selectionHash, descriptors: { "components.link": chosen.origin.sha256 } };
  const template = join(import.meta.dirname, "../../templates/site");
  await writeFile(join(dir, "package.json"), await readFile(join(template, "package.json")));
  await writeFile(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { paths: { "@/*": ["./*"] }, jsx: "react-jsx" } }));
  await writeFile(join(dir, "components.json"), JSON.stringify({ $schema: "https://ui.shadcn.com/schema.json", style: "new-york", rsc: true, tsx: true, tailwind: { config: "", css: "app.css", baseColor: "neutral", cssVariables: true }, aliases: { components: "@/components", utils: "@/lib/utils", ui: "@/components/ui", lib: "@/lib", hooks: "@/hooks" } }));
  await writeFile(join(dir, "app.css"), "");
  const frame = `import type { ReactNode } from "react";
import { SiteFrame } from "@clossys/designer/frames";
export const copyKeys = { brand: "frame.title" } as const;
export function NativeFrame({ children, copy }: { children?: ReactNode; copy: { brand: string } }) {
  const resolveCopy = (ref: { id: string }) => ({ ref, text: copy.brand, recordId: ref.id, revision: "1", locale: "en", source: { kind: "consumer" as const, reference: "fixture" }, entryId: ref.id });
  return <SiteFrame shell={{ brand: { assetId: "mark", label: { id: "brand" }, size: "md", variant: "mark" }, skipLink: { id: "skip" } }} resolveCopy={resolveCopy} resolveAsset={() => ({ type: "image", src: "/mark.svg", width: 48, height: 48, alt: copy.brand })}>{children}</SiteFrame>;
}`;
  const first = await withEntry("frames.plain", frame, { export: "NativeFrame", copyKeys: "copyKeys" });
  const reused = join(await temp(), "reused"); await cp(first.root, reused, { recursive: true });
  const { source } = await withEntry("sections.hero", clientHero, { export: "Island", copyKeys: "copyKeys.content" }, reused);
  const draft = await resolveNativeNextDraft({ page, candidates: await admissions(source), source, copy });
  expect(draft.findings).toEqual([]);
  expect(draft.status).toBe("DRAFT"); expect(draft.approved).toBe(false);
  const installed = await installAndBind({ ...draft.install!, substrate: dir, runner: realRunner });
  expect(installed.findings).toEqual([]);
  expect(installed.page).toEqual(draft.page);
  await mkdir(join(dir, "app")); await mkdir(join(dir, "public"));
  await writeFile(join(dir, "app/page.tsx"), draft.module!);
  await writeFile(join(dir, "app/layout.tsx"), `"use client";
import type { ReactNode } from "react";
import { ConsumerComponentProvider, type ConsumerComponentSelection } from "@clossys/designer/frames";
import { Link } from "@clossys/designer/components";
const value: ConsumerComponentSelection = { profile: ${JSON.stringify(selection.profile)}, selectionHash: ${JSON.stringify(selection.selectionHash)}, descriptors: ${JSON.stringify(selection.descriptors)}, modules: { "@clossys/designer/components": { Link } } };
export default function Layout({children}: {children: ReactNode}) { return <html lang="en"><body><ConsumerComponentProvider value={value}>{children}</ConsumerComponentProvider></body></html>; }
`);
  await writeFile(join(dir, "public/mark.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><circle cx="24" cy="24" r="20"/></svg>');
  const result = await new Promise<{ code: number; stdout: string; stderr: string }>(done => execFile(process.execPath, [nativeRequire.resolve("next/dist/bin/next"), "build"], { cwd: dir, timeout: 180_000 }, (error, stdout, stderr) => done({ code: error ? 1 : 0, stdout, stderr })));
  expect(result, JSON.stringify(result)).toMatchObject({ code: 0 });
  const html = await readFile(join(dir, ".next/server/app/index.html"), "utf8");
  expect(html).toContain('id="publisher-main-content"');
  for (const text of Object.values(copy)) expect(html).toContain(text);
  expect(html).toContain("Count ");
  const manifest = await readFile(join(dir, ".next/server/app/page_client-reference-manifest.js"), "utf8");
  expect(manifest).toContain("simple-hero.tsx");
  expect(manifest).not.toContain("plain-frame.tsx");
}, 240_000);
