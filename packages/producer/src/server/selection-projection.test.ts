import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";
import { emit, loadCatalog, resolve, stableStringify, type CompositeEngineInput } from "@clossys/designer/catalog";
import { parseConsumerDogfoodContract } from "@clossys/designer/catalog/dogfood/node";
import { studioProjectionFiles } from "./selection-projection.js";
import { main, studioSourcePacket, writeStudioCheckInputs } from "../../scripts/emit-studio-check-inputs.mjs";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const sourceHead = "a".repeat(40);
let directory: string;
let consumer: string;
let library: Map<string, string>;
let selectionHash: string;
let packet: Awaited<ReturnType<typeof studioSourcePacket>>;

async function disk(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(path: string, prefix = "") {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) await visit(join(path, entry.name), name + "/");
      else files[name] = await readFile(join(path, entry.name), "utf8");
    }
  }
  await visit(root); return files;
}

beforeAll(async () => {
  directory = await mkdtemp(join(await realpath(tmpdir()), "producer-proc2-inputs-"));
  consumer = join(directory, "consumer");
  await mkdir(consumer);
  // Minimal native engine fixture tests serialization, never Studio conformance.
  const input: CompositeEngineInput = {
    catalog: { values: loadCatalog(), components: { slots: [], fills: [], rules: [] }, surfaces: { slots: [], fills: [] } },
    library: { source: { id: "example", kind: "consumer", author: "consumer", license: "MIT" }, adoptedAt: "2026-10-30", values: { fills: [] }, components: { fills: [], files: [] }, surfaces: { version: 1, fills: [], files: [] } },
  };
  const profile = resolve(input);
  expect(profile.components.check.ok).toBe(true);
  expect(profile.surfaces!.check.ok).toBe(true);
  const files = new Map(emit(profile, ["component-index", "surface-index"]).map(file => [file.path, file.contents]));
  const bundled = await build({ stdin: { contents: files.get("component-index.ts")!, resolveDir: packageRoot, loader: "tsx" }, bundle: true, write: false, format: "esm", platform: "browser", logLevel: "silent" });
  const css = emit(profile.values, ["css-brand"], { header: false }).map(file => file.contents).join("");
  library = studioProjectionFiles({ input, profile, files, runtime: bundled.outputFiles[0]!.text, css });
  selectionHash = profile.selectionHash;
  packet = await studioSourcePacket();
}, 30_000);

describe("native Studio selection and generated dogfood inputs", () => {
  it("rejects unknown, duplicate and incomplete command arguments", async () => {
    for (const args of [["constructor", "value"], ["--root"], ["--root", ".", "--root", "."], ["--out", "out"]]) {
      await expect(main(args)).rejects.toThrow(/Usage|requires/);
    }
  });
  it("censuses the actual App Router pages and preserves their exact TSX", async () => {
    expect(parseConsumerDogfoodContract(packet.contract)).toEqual(packet.contract);
    const pages: string[] = [];
    async function visit(path: string, prefix: string) {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (entry.isDirectory()) await visit(join(path, entry.name), `${prefix}/${entry.name}`);
        else if (entry.name === "page.tsx") pages.push(`${prefix}/page.tsx`);
      }
    }
    await visit(join(packageRoot, "studio/app"), "studio/app");
    const projection = JSON.parse(await readFile(join(packageRoot, "studio/generated/studio-map.json"), "utf8"));
    pages.push(...projection.routes.map((route: { entry: { file: string } }) => route.entry.file));
    expect(packet.contract.pages).toEqual([...new Set(pages)].sort());
    for (const page of pages) expect(packet.files.get(page)).toBe(await readFile(join(packageRoot, page), "utf8"));
    for (const [module, target] of Object.entries(packet.contract.sources) as [string, string][]) {
      expect(packet.files.has(target)).toBe(true);
      expect(module).not.toMatch(/^@clossys\/designer(?:\/|$)|^next\/|^react-aria-components(?:\/|$)/);
    }
    const repeated = await studioSourcePacket();
    expect([...repeated.files].sort()).toEqual([...packet.files].sort());
  });

  it("writes byte-identical native resolved profile, indexes and source packets in fresh generations", async () => {
    const options = { root: consumer, sourceHead, selectionHash, packet, library };
    const first = await writeStudioCheckInputs({ ...options, output: join(consumer, ".clossys/check-inputs/first") });
    const second = await writeStudioCheckInputs({ ...options, output: join(consumer, ".clossys/check-inputs/second") });
    const a = await disk(first.output), b = await disk(second.output);
    expect(a).toEqual(b);
    expect(JSON.parse(a["library/resolved.json"]!)).toMatchObject({ selectionHash });
    for (const name of ["component-index.ts", "surface-index.ts", "runtime.js", "theme.css"]) expect(a[`library/${name}`]).toBe(library.get(name));
    expect(a["site/consumer-dogfood.json"]).toBe(stableStringify(packet.contract));
    expect(Object.values(a).some(value => value.includes(directory))).toBe(false);
    expect(first.site).toBe(consumer);
    expect(first.sources).toBe(join(first.output, "site"));
    expect(first.library.startsWith(consumer + "/")).toBe(true);
    const original = a["manifest.json"];
    await expect(writeStudioCheckInputs({ ...options, output: first.output })).rejects.toThrow();
    expect(await readFile(join(first.output, "manifest.json"), "utf8")).toBe(original);
  });

  it.each(["resolved.json", "component-index.ts", "surface-index.ts"])("refuses missing native %s before publishing an output", async name => {
    const incomplete = new Map(library); incomplete.delete(name);
    const output = join(consumer, ".clossys", `missing-${name}`);
    await expect(writeStudioCheckInputs({ root: consumer, sourceHead, selectionHash, packet, library: incomplete, output })).rejects.toThrow(/incomplete/);
    await expect(readFile(join(output, "manifest.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("enforces consumer containment and preserves the native Designer library-in-root rule", async () => {
    const nativeConsumer = join(directory, "native-consumer");
    await mkdir(nativeConsumer);
    const options = { root: nativeConsumer, sourceHead, selectionHash, packet, library };
    for (const output of [directory, nativeConsumer, "../escaped-inputs"]) {
      await expect(writeStudioCheckInputs({ ...options, output })).rejects.toThrow(/inside the consumer root/);
    }
    const emitted = await writeStudioCheckInputs(options);
    expect(emitted.output).toBe(join(nativeConsumer, ".clossys/check-inputs"));
    expect(emitted.site).toBe(nativeConsumer);
    const repository = dirname(dirname(packageRoot.replace(/\/$/, "")));
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();
    function native(site: string) {
      const args = [join(repository, "packages/designer/scripts/check-fill-source-imports.mjs"), "--site", site, "--library", emitted.library, "--contract", emitted.contract, "--source-head", head, "--json"];
      const result = spawnSync(process.execPath, args, { cwd: repository, encoding: "utf8" });
      expect(result.error).toBeUndefined();
      const report = JSON.parse(result.stdout);
      return { args, code: result.status, report, stderr: result.stderr };
    }
    const accepted = native(emitted.site);
    // The minimal native fixture intentionally has no leaf selection. Reaching
    // that separate check proves the unchanged containment rule accepted it.
    expect(accepted.code).toBe(2);
    expect(accepted.report.violations.some((row: { detail: string }) => row.detail === "Empty native leaf selection")).toBe(true);
    expect(accepted.report.violations.some((row: { detail: string }) => /library must be inside/.test(row.detail))).toBe(false);
    const rejected = native(emitted.sources);
    expect(rejected.code).toBe(2);
    expect(rejected.report.violations.some((row: { detail: string }) => row.detail === "Native library must be inside the consumer root")).toBe(true);
    await writeFile(join(directory, "native-containment.json"), JSON.stringify({ accepted, rejected }, null, 2));
  }, 30_000);

  it("refuses stale identity, missing page sources and a symlinked output", async () => {
    await expect(writeStudioCheckInputs({ root: consumer, sourceHead, selectionHash: "stale", packet, library, output: join(consumer, ".clossys/stale") })).rejects.toThrow(/stale/);
    const missing = { ...packet, files: new Map(packet.files) }; missing.files.delete(packet.contract.pages[0]);
    await expect(writeStudioCheckInputs({ root: consumer, sourceHead, selectionHash, packet: missing, library, output: join(consumer, ".clossys/missing-page") })).rejects.toThrow(/incomplete/);
    const real = join(consumer, "real-output"); await mkdir(real);
    const alias = join(consumer, "output-alias"); await symlink(real, alias, "dir");
    await expect(writeStudioCheckInputs({ root: consumer, sourceHead, selectionHash, packet, library, output: join(alias, "child") })).rejects.toThrow(/symbolic/);
    expect(await readdir(real)).toEqual([]);
  });

  it("derives added pages from real imports and rejects malformed or aliased source", async () => {
    const studio = join(directory, "project/studio");
    const page = join(studio, "app/page.tsx");
    await mkdir(dirname(page), { recursive: true });
    await writeFile(page, "export default function Page() { return <main>Example</main>; }\n");
    expect((await studioSourcePacket(studio)).contract.pages).toEqual(["studio/app/page.tsx"]);
    const extra = join(studio, "app/guide/page.tsx"); await mkdir(dirname(extra), { recursive: true });
    await writeFile(extra, "import Page from '../page'; export default Page;\n");
    expect((await studioSourcePacket(studio)).contract.pages).toEqual(["studio/app/guide/page.tsx", "studio/app/page.tsx"]);
    const bad = join(studio, "app/bad/page.tsx"); await mkdir(dirname(bad), { recursive: true });
    await writeFile(bad, "export default function Page() { return <main>; }\n");
    await expect(studioSourcePacket(studio)).rejects.toThrow(/invalid syntax/);
    // Preserve that malformed fixture and use a separate source root for the alias proof.
    const linked = join(directory, "linked/studio/app"); await mkdir(linked, { recursive: true });
    await symlink(page, join(linked, "page.tsx"));
    await expect(studioSourcePacket(dirname(linked))).rejects.toThrow(/symbolic/);
  });
});
