import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    expect(draft.module).toMatch(/^"use client";/);
    expect(draft.module).toContain('from "../components/frames/plain-frame"');
    expect(draft.module).toContain('from "../components/sections/simple-hero"');
    expect(draft.module!.match(/^export /gm)).toEqual(["export "]);
    expect(draft).not.toHaveProperty("productionPinDocs");
    expect(JSON.stringify(pins)).toBe(originalPins);

    const dir = await temp();
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "native-draft", private: true, type: "module" }));
    await writeFile(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] }, jsx: "react-jsx" } }));
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
