/**
 * Install-and-bind against a fixture consumer: two registry items (a frame and a hero
 * section) and one page record are installed into a temp substrate with the real shadcn
 * CLI, bound to Writer copy, and rendered. shadcn fetches only its base-color file
 * (`colors/<baseColor>.json`) for a local item; `REGISTRY_URL` points that at a loopback
 * stub, so the test makes no outside network request.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { directoryRecordSource, recordStoreSource } from "../specimen/source.js";
import { installedPath } from "../specimen/installed-path.js";
import { bindPage, installAndBind, installPage, isBlocking, reconcileInstalled, resolvePage, substrateDependencies, type BoundPage, type ResolvedSlot, type InstallPageRecord, type InstallPins, type ShadcnRunner } from "./index.js";

const fixtures = join(import.meta.dirname, "__fixtures__");
const json = async (name: string) => JSON.parse(await readFile(join(fixtures, name), "utf8"));
const requireHere = createRequire(import.meta.url);
const shadcnBin = requireHere.resolve("shadcn");
const source = directoryRecordSource({ roots: [join(fixtures, "library")] });

let page: InstallPageRecord, pins: InstallPins, copy: Record<string, string>;
let stub: Server, registryUrl: string;
const temps: string[] = [];

const realRunner = (calls: string[][]): ShadcnRunner => (args, { cwd }) => new Promise(done => {
  calls.push([...args]);
  execFile(process.execPath, [shadcnBin, ...args], { cwd, env: { ...process.env, REGISTRY_URL: registryUrl }, timeout: 60_000 }, (error, stdout, stderr) => {
    done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
  });
});

async function substrate(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "clossys-substrate-"));
  temps.push(dir);
  await writeFile(join(dir, "package.json"), `${JSON.stringify({ name: "substrate", private: true, type: "module" })}\n`);
  await writeFile(join(dir, "tsconfig.json"), `${JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] }, jsx: "react-jsx" } })}\n`);
  await writeFile(join(dir, "components.json"), `${JSON.stringify({ $schema: "https://ui.shadcn.com/schema.json", style: "new-york", rsc: false, tsx: true, tailwind: { config: "", css: "app.css", baseColor: "neutral", cssVariables: true }, aliases: { components: "@/components", utils: "@/lib/utils", ui: "@/components/ui", lib: "@/lib", hooks: "@/hooks" } })}\n`);
  await writeFile(join(dir, "app.css"), "");
  return dir;
}

/** Bundle the installed entries and render the bound page on the server. */
async function render(bound: BoundPage, dir: string): Promise<string> {
  const esbuild = await import("esbuild");
  const slots = [bound.frame, ...bound.sections];
  const entry = slots.map((slot, index) => `export * as s${index} from ${JSON.stringify(join(dir, slot.entry.file))};`).join("\n");
  const react = (name: string) => requireHere.resolve(name);
  const result = await esbuild.build({
    stdin: { contents: entry, resolveDir: dir, loader: "ts" }, bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic",
    plugins: [{ name: "host-react", setup(build) { build.onResolve({ filter: /^react(\/.*)?$/ }, args => ({ path: react(args.path), external: true })); } }],
  });
  const out = join(dir, ".clossys", "render.mjs");
  await writeFile(out, result.outputFiles[0]!.text);
  const modules = await import(pathToFileURL(out).href);
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const pick = (index: number) => {
    const mod = modules[`s${index}`], name = slots[index]!.entry.export;
    return name ? mod[name] : mod.default ?? Object.values(mod).find(value => typeof value === "function");
  };
  const sections = bound.sections.map((slot, index) => React.createElement(pick(index + 1), { key: slot.slot, ...slot.props }));
  return renderToStaticMarkup(React.createElement(pick(0), bound.frame.props, ...sections));
}

beforeAll(async () => {
  [page, pins, copy] = await Promise.all([json("pages/home.json"), json("pins.json"), json("writer-copy.json")]);
  stub = createServer((request, response) => {
    if (request.url?.startsWith("/r/colors/")) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ inlineColors: { light: {}, dark: {} }, cssVars: { light: {}, dark: {} }, cssVarsV4: { light: {}, dark: {} }, inlineColorsTemplate: "", cssVarsTemplate: "" }));
    } else { response.statusCode = 404; response.end("{}"); }
  });
  await new Promise<void>(done => stub.listen(0, "127.0.0.1", done));
  const address = stub.address();
  registryUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/r`;
});
afterAll(async () => {
  await new Promise(done => stub.close(done));
  await Promise.all(temps.map(dir => rm(dir, { recursive: true, force: true })));
});

describe("installAndBind", () => {
  it("installs two pinned registry items for one page, binds every copy slot, and renders", async () => {
    const dir = await substrate();
    const calls: string[][] = [];
    const result = await installAndBind({ page, pins, source, substrate: dir, runner: realRunner(calls), copy });
    expect(result.findings).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(calls.every(args => args[0] === "add" && !args.some(arg => /[;&|]/.test(arg)))).toBe(true);
    expect(result.installed.map(row => [row.id, row.status])).toEqual([["frames.plain/plain-frame", "installed"], ["sections.hero/simple-hero", "installed"]]);
    const bound = result.page!;
    expect(bound.frame.copy).toEqual({ "frame.title": "site.name" });
    expect(bound.sections[0]!.copy).toEqual({ "hero.body": "home.hero.body", "hero.heading": "home.hero.heading" });
    const html = await render(bound, dir);
    for (const text of Object.values(copy)) expect(html).toContain(text);
    expect(html).toMatch(/^<main data-frame="plain"><header>.*<\/header><section data-section="hero">/);
    for (const sample of ["Sample site", "Sample heading", "Sample body."]) expect(html).not.toContain(sample);
  }, 120_000);

  it("is a no-op on a second install of the same pinned items", async () => {
    const dir = await substrate();
    const calls: string[][] = [];
    await installPage({ page, pins, source, substrate: dir, runner: realRunner(calls) });
    const again = await installPage({ page, pins, source, substrate: dir, runner: realRunner(calls) });
    expect(calls).toHaveLength(2);
    expect(again.findings).toEqual([]);
    expect(again.installed.map(row => row.status)).toEqual(["unchanged", "unchanged"]);
  }, 120_000);

  it("reports an installed file that no longer matches its recorded hash", async () => {
    const dir = await substrate();
    await installPage({ page, pins, source, substrate: dir, runner: realRunner([]) });
    await writeFile(join(dir, "components", "sections", "simple-hero.tsx"), "export function SimpleHero() { return null; }\n");
    const again = await installPage({ page, pins, source, substrate: dir, runner: realRunner([]) });
    expect(again.findings).toEqual([expect.objectContaining({ code: "hash-mismatch", slot: "sections.hero" })]);
  }, 120_000);
});

describe("unpinned and unbound slots", () => {
  const never: ShadcnRunner = async () => { throw new Error("the runner must not run"); };

  it("fails a page record that references an unpinned slot, and installs nothing", async () => {
    const dir = await substrate();
    const withPricing: InstallPageRecord = { ...page, sections: [...page.sections, "sections.pricing"] };
    const result = await installAndBind({ page: withPricing, pins, source, substrate: dir, runner: never, copy });
    expect(result.page).toBeUndefined();
    expect(result.installed).toEqual([]);
    expect(result.findings).toEqual([{ code: "unpinned-slot", slot: "sections.pricing", detail: "home: slot sections.pricing has no pinned registry item" }]);
  });

  it("reports a missing Writer key instead of falling back to sample copy", async () => {
    const { slots, findings } = await resolvePage(page, pins, source);
    expect(findings).toEqual([]);
    const { "home.hero.body": _dropped, ...partial } = copy;
    const bound = bindPage({ page, slots, copy: partial });
    expect(bound.page).toBeUndefined();
    expect(bound.findings).toEqual([expect.objectContaining({ code: "missing-copy-key", slot: "sections.hero" })]);
  });

  it("renders a copy slot the page binds to no Writer key empty, with an info finding", async () => {
    const { slots } = await resolvePage(page, pins, source);
    const unbound: InstallPageRecord = { ...page, bindings: { ...page.bindings, "frames.plain": {} } };
    const bound = bindPage({ page: unbound, slots, copy });
    expect(bound.findings).toEqual([expect.objectContaining({ code: "unbound-copy-slot", slot: "frames.plain", severity: "info" })]);
    expect(bound.findings.some(isBlocking)).toBe(false);
    expect(bound.page).toBeDefined();
    expect(Object.values(bound.page!.frame.text)).toEqual([""]);
  });
});

describe("declared copy slots", () => {
  // A hero whose fixtures read preview Writer keys and whose element declares its copy slots.
  const hero = {
    name: "simple-hero", type: "registry:block",
    files: [{ path: "simple-hero.tsx", type: "registry:component", target: "components/sections/simple-hero.tsx", content: "export function SimpleHero() { return null; }\n" }],
  };
  const declared = [
    { slot: "hero.heading", prop: "heading", previewKey: "home.hero.heading" },
    { slot: "hero.body", prop: "body", previewKey: "home.hero.body" },
  ];
  const sourceWith = (preview: Record<string, unknown>) => recordStoreSource({
    async load(id, version) {
      if (id !== "sections.hero/simple-hero" || version !== 1) return undefined;
      return { id, version: 1, kind: "visual", files: [{ path: "simple-hero.json", content: JSON.stringify(hero) }], preview, contentHash: "" };
    },
  });
  const heroPins: InstallPins = { "sections.hero": { element: "simple-hero", version: 1 } };
  const fixtures = { heading: { $copy: "home.hero.heading" }, body: { $copy: "home.hero.body" } };
  const writer = { "home.hero.heading": "Home heading", "home.hero.body": "Home body", "hero.body": "Same-named key", "about.heading": "About heading" };

  it("binds only the declared slot names; an unbound slot renders empty, never its preview key or a same-named key", async () => {
    const about: InstallPageRecord = { id: "about", frame: "sections.hero", sections: [], copy: { "hero.heading": "about.heading" } };
    const { slots, findings } = await resolvePage(about, heroPins, sourceWith({ fixtures, copySlots: declared }));
    expect(findings).toEqual([]);
    expect(slots[0]!.copySlots).toEqual(["hero.body", "hero.heading"]);
    expect(slots[0]!.previewCopy).toEqual({ "hero.heading": "home.hero.heading", "hero.body": "home.hero.body" });
    expect(slots[0]!.props).toEqual({ heading: { $copy: "hero.heading" }, body: { $copy: "hero.body" } });
    const bound = bindPage({ page: about, slots, copy: writer });
    expect(bound.page!.frame.text).toEqual({ "hero.heading": "About heading", "hero.body": "" });
    // The frame's props carry its (empty) children alongside the bound copy.
    expect(bound.page!.frame.props).toEqual({ heading: "About heading", body: "", children: [] });
    expect(bound.findings).toEqual([expect.objectContaining({ code: "unbound-copy-slot", slot: "sections.hero", severity: "info" })]);
  });

  it("refuses a fixture $copy the element does not declare, and a declared prop that holds no preview key", async () => {
    const page: InstallPageRecord = { id: "home", frame: "sections.hero", sections: [] };
    const extra = await resolvePage(page, heroPins, sourceWith({ fixtures: { ...fixtures, note: { $copy: "home.note" } }, copySlots: declared }));
    expect(extra.findings).toEqual([expect.objectContaining({ code: "invalid-copy-slot", slot: "sections.hero", detail: expect.stringContaining("home.note is not a declared copy slot") })]);
    const moved = await resolvePage(page, heroPins, sourceWith({ fixtures, copySlots: [{ ...declared[0]!, prop: "title" }, declared[1]] }));
    expect(moved.findings).toEqual([expect.objectContaining({ code: "invalid-copy-slot", detail: expect.stringContaining("prop title") }), expect.objectContaining({ code: "invalid-copy-slot", detail: expect.stringContaining("home.hero.heading is not a declared copy slot") })]);
  });
});

describe("substrate dependencies", () => {
  it("unions every slot's npm dependencies, splitting a version range from the name", () => {
    const slot = (dependencies: string[]) => ({ dependencies }) as unknown as ResolvedSlot;
    expect(substrateDependencies([slot(["lucide-react", "@base-ui/react@^1.2.0"]), slot(["lucide-react", "sonner"])]))
      .toEqual({ "@base-ui/react": "^1.2.0", "lucide-react": "latest", sonner: "latest" });
  });
});

describe("registry files without an install path", () => {
  const item = (files: { path: string; type: string; target?: string }[]) => ({
    name: "card", type: "registry:ui", files: files.map(file => ({ ...file, content: file.path.endsWith(".tsx") ? "export function Card() { return null; }\n" : "# notes\n" })),
  });
  const sourceOf = (value: unknown) => recordStoreSource({
    async load(id, version) {
      if (id !== "components.card/card" || version !== 1) return undefined;
      return { id, version: 1, kind: "visual", files: [{ path: "card.json", content: JSON.stringify(value) }], preview: {}, contentHash: "" };
    },
  });
  const cardPage: InstallPageRecord = { id: "p", frame: "components.card", sections: [] };
  const cardPins: InstallPins = { "components.card": { element: "card", version: 1 } };

  it("skips a non-code registry file with no target (a LICENCE.md) and installs the code", async () => {
    const { slots, findings } = await resolvePage(cardPage, cardPins, sourceOf(item([{ path: "LICENCE.md", type: "registry:file" }, { path: "card.tsx", type: "registry:ui" }])));
    expect(findings).toEqual([]);
    expect(slots.map(slot => slot.files)).toEqual([["components/ui/card.tsx"]]);
    expect(JSON.parse(slots[0]!.item).files.map((file: { path: string }) => file.path)).toEqual(["card.tsx"]);
  });

  it("still fails a code file with no target or known type", async () => {
    const { findings } = await resolvePage(cardPage, cardPins, sourceOf(item([{ path: "card.tsx", type: "registry:file" }])));
    expect(findings).toEqual([{ code: "not-a-registry-item", slot: "components.card", detail: "components.card/card: a registry file has no target or known type" }]);
  });
  it("places a registry:example without a target in the components directory, as shadcn does", async () => {
    const { slots, findings } = await resolvePage(cardPage, cardPins, sourceOf(item([{ path: "card-example.tsx", type: "registry:example" }])));
    expect(findings).toEqual([]);
    expect(slots.map(slot => slot.files)).toEqual([["components/card-example.tsx"]]);
  });
});

describe("slot-id registry dependencies", () => {
  const record = (id: string, value: unknown) => ({ id, version: 1, kind: "visual" as const, files: [{ path: "item.json", content: JSON.stringify(value) }], preview: {}, contentHash: "" });
  const items: Record<string, unknown> = {
    "sections.strip/strip": { name: "strip", type: "registry:block", registryDependencies: ["components.badge", "separator"], files: [{ path: "strip.tsx", type: "registry:component", target: "components/strip/index.tsx", content: "export function Strip() { return null; }\n" }] },
    "components.badge/badge": { name: "badge", type: "registry:ui", files: [{ path: "badge.tsx", type: "registry:ui", content: "export function Badge() { return null; }\n" }] },
  };
  const libSource = recordStoreSource({ async load(id, version) { return version === 1 && items[id] ? record(id, items[id]) : undefined; } });
  const stripPage: InstallPageRecord = { id: "p", frame: "sections.strip", sections: [] };

  it("installs a dependency named by its pinned slot id from that slot's record, not through shadcn", async () => {
    const stripPins: InstallPins = { "sections.strip": { element: "strip", version: 1 }, "components.badge": { element: "badge", version: 1 } };
    const { slots, findings } = await resolvePage(stripPage, stripPins, libSource);
    expect(findings).toEqual([]);
    expect(slots.map(slot => [slot.slot, slot.role])).toEqual([["components.badge", "dependency"], ["sections.strip", "frame"]]);
    expect(JSON.parse(slots[1]!.item).registryDependencies).toEqual(["separator"]);
  });

  it("leaves an unpinned slot-shaped name to shadcn", async () => {
    const { slots } = await resolvePage(stripPage, { "sections.strip": { element: "strip", version: 1 } }, libSource);
    expect(JSON.parse(slots[0]!.item).registryDependencies).toEqual(["components.badge", "separator"]);
  });
});

describe("a slot installed at another version", () => {
  // shadcn add, as far as these items need it: each file written at its installed path.
  const writeRunner: ShadcnRunner = async (args, { cwd }) => {
    const item = JSON.parse(await readFile(args[1]!, "utf8"));
    for (const file of item.files) {
      const path = join(cwd, installedPath(file)!);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.content);
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  const typography = (target?: string) => ({ path: "utils.js", type: "registry:lib", ...(target ? { target } : {}), content: "module.exports = { isObject() {} }\n" });
  const items: Record<string, unknown> = {
    // sections.article v1 installed the typography plugin's utils.js at lib/utils.js; v2 under lib/typography.
    "sections.article/article@1": { name: "article", type: "registry:lib", files: [typography()] },
    "sections.article/article@2": { name: "article", type: "registry:lib", files: [typography("lib/typography/utils.js")] },
    "sections.document/document@1": { name: "document", type: "registry:lib", files: [typography()] },
  };
  const libSource = recordStoreSource({
    async load(id, version) {
      const value = items[`${id}@${version}`];
      return value ? { id, version, kind: "visual", files: [{ path: "item.json", content: JSON.stringify(value) }], preview: {}, contentHash: "" } : undefined;
    },
  });
  const articlePage: InstallPageRecord = { id: "p", frame: "sections.article", sections: [] };
  const documentPage: InstallPageRecord = { id: "d", frame: "sections.document", sections: [] };
  const v1: InstallPins = { "sections.article": { element: "article", version: 1 }, "sections.document": { element: "document", version: 1 } };
  const v2: InstallPins = { ...v1, "sections.article": { element: "article", version: 2 } };

  const install = (page: InstallPageRecord, pins: InstallPins, dir: string, ownedSubstrate = true) => installPage({ page, pins, source: libSource, substrate: dir, runner: writeRunner, ownedSubstrate });

  it("removes a file the previous version wrote that the new one no longer ships, in a substrate clossys owns", async () => {
    const dir = await substrate();
    await install(articlePage, v1, dir);
    expect(existsSync(join(dir, "lib", "utils.js"))).toBe(true);
    const again = await install(articlePage, v2, dir);
    expect(again.findings).toEqual([]);
    expect(existsSync(join(dir, "lib", "typography", "utils.js"))).toBe(true);
    expect(existsSync(join(dir, "lib", "utils.js"))).toBe(false);
    const manifest = JSON.parse(await readFile(join(dir, ".clossys", "install.json"), "utf8"));
    expect(Object.keys(manifest.items["sections.article"].files)).toEqual(["lib/typography/utils.js"]);
  });

  it("only reports a replaced file in a consumer's own project, even with the recorded bytes", async () => {
    const dir = await substrate();
    await install(articlePage, v1, dir, false);
    const again = await install(articlePage, v2, dir, false);
    expect(again.findings).toEqual([expect.objectContaining({ code: "replaced-file", slot: "sections.article", severity: "info" })]);
    expect(again.findings.every(finding => !isBlocking(finding))).toBe(true);
    expect(await readFile(join(dir, "lib", "utils.js"), "utf8")).toBe("module.exports = { isObject() {} }\n");
  });

  it("never removes a replaced file whose real path leaves the substrate", async () => {
    const dir = await substrate(), elsewhere = await substrate();
    // lib/ is a link to a directory outside the substrate: v1's lib/utils.js lands there, with the recorded bytes.
    await mkdir(join(elsewhere, "lib"), { recursive: true });
    await symlink(join(elsewhere, "lib"), join(dir, "lib"));
    await install(articlePage, v1, dir);
    expect(existsSync(join(elsewhere, "lib", "utils.js"))).toBe(true);
    const again = await install(articlePage, v2, dir);
    expect(again.findings).toEqual([expect.objectContaining({ code: "replaced-file", slot: "sections.article", detail: expect.stringContaining("outside the substrate") })]);
    expect(existsSync(join(elsewhere, "lib", "utils.js"))).toBe(true);
  });

  it("keeps a replaced file another installed item claims, or one changed since install", async () => {
    const dir = await substrate();
    await install(articlePage, v1, dir);
    await install(documentPage, v1, dir);
    expect((await install(articlePage, v2, dir)).findings).toEqual([]);
    expect(existsSync(join(dir, "lib", "utils.js"))).toBe(true);

    const other = await substrate();
    await install(articlePage, v1, other);
    await writeFile(join(other, "lib", "utils.js"), "export const edited = true;\n");
    const again = await install(articlePage, v2, other);
    expect(again.findings).toEqual([expect.objectContaining({ code: "hash-mismatch", slot: "sections.article" })]);
    expect(await readFile(join(other, "lib", "utils.js"), "utf8")).toBe("export const edited = true;\n");
  });

  it("reconciles a substrate to new pins before any page reinstalls: a slot at another version or no longer pinned goes", async () => {
    const dir = await substrate();
    await install(articlePage, v1, dir);
    await install(documentPage, v1, dir);
    // Current pins: nothing to do.
    expect(await reconcileInstalled(dir, v1)).toEqual([]);
    expect(existsSync(join(dir, "lib", "utils.js"))).toBe(true);
    // sections.article moves to v2: its entry goes, and lib/utils.js stays while sections.document claims it.
    expect(await reconcileInstalled(dir, v2)).toEqual([]);
    expect(existsSync(join(dir, "lib", "utils.js"))).toBe(true);
    // sections.document's pin is removed: nothing claims lib/utils.js any more.
    expect(await reconcileInstalled(dir, { "sections.article": v2["sections.article"]! })).toEqual([]);
    expect(existsSync(join(dir, "lib", "utils.js"))).toBe(false);
    const manifest = JSON.parse(await readFile(join(dir, ".clossys", "install.json"), "utf8"));
    expect(manifest.items).toEqual({});
  });
});
