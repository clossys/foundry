/**
 * Install-and-bind against a fixture consumer: two registry items (a frame and a hero
 * section) and one page record are installed into a temp substrate with the real shadcn
 * CLI, bound to Writer copy, and rendered. shadcn fetches only its base-color file
 * (`colors/<baseColor>.json`) for a local item; `REGISTRY_URL` points that at a loopback
 * stub, so the test makes no outside network request.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { directoryRecordSource } from "../specimen/source.js";
import { bindPage, installAndBind, installPage, resolvePage, type BoundPage, type InstallPageRecord, type InstallPins, type ShadcnRunner } from "./index.js";

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

  it("reports a copy slot the page binds to no Writer key", async () => {
    const { slots } = await resolvePage(page, pins, source);
    const unbound: InstallPageRecord = { ...page, bindings: { ...page.bindings, "frames.plain": {} } };
    const bound = bindPage({ page: unbound, slots, copy });
    expect(bound.findings).toEqual([expect.objectContaining({ code: "unbound-copy-slot", slot: "frames.plain" })]);
  });
});
