// @vitest-environment node
import * as fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generateSelection, libraryHash, loadCatalog, stableStringify, type LibraryData } from "../catalog-core/index.js";
import { completedCatalogLibrary } from "../catalog-core/__fixtures__/completed-catalog-library.js";
import { libraryFiles } from "./fs-library.js";
import { main } from "./cli.js";

const catalog = loadCatalog(), bin = fileURLToPath(new URL("../../dist/library-cli/cli.js", import.meta.url));
let fixture: LibraryData, temporary: string, root: string;
beforeAll(() => { fixture = completedCatalogLibrary(catalog, { id: "example", kind: "consumer", author: "consumer", license: "UNLICENSED" }, "2026-10-23"); });
beforeEach(async () => {
  temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "designer-cli-"))); root = join(temporary, "library");
  await fs.mkdir(join(root, "fills"), { recursive: true });
  for (const [name, content] of libraryFiles(catalog, fixture)) {
    await fs.mkdir(dirname(join(root, name)), { recursive: true }); await fs.writeFile(join(root, name), content);
  }
});
afterEach(async () => { await fs.rm(temporary, { recursive: true, force: true }); });
async function invoke(...args: string[]) {
  const out: string[] = [], error: string[] = [];
  const code = await main(args, { out: text => out.push(text), error: text => error.push(text) });
  return { code, out: out.join("\n"), error: error.join("\n") };
}
const run = (...args: string[]) => invoke(...args, "--root", root);

describe("designer-library CLI", () => {
  it("dogfood-consumer reads the actual selected root and rejects stale or missing inputs", async () => {
    const page = join(temporary, "Page.tsx"), contract = join(temporary, "contract.json");
    await fs.writeFile(page, 'import { PageHeaderModule } from "@clossys/designer/shell"; import "./library/theme.css"; const Page=()=> <PageHeaderModule id="example" header={data}/>');
    await fs.writeFile(contract, JSON.stringify({ version: 1, pages: ["Page.tsx"], sources: {} }));
    const call = () => run("dogfood-consumer", page, "--contract", contract, "--json");
    const good = await call();
    expect(good.code).toBe(0);
    expect(JSON.parse(good.out).findings).toEqual([]);
    const css = await fs.readFile(join(root, "theme.css"), "utf8");
    await fs.writeFile(join(root, "theme.css"), css.replace(/(--blur-glass:) [^;]+;/, "$1 999px;"));
    const stale = await call();
    expect(stale.code).toBe(1);
    expect(JSON.parse(stale.out).findings.some((row: { code: string; evidence: string }) => row.code === "DF2" && row.evidence.includes("value mismatch"))).toBe(true);
    expect((await invoke("dogfood-consumer", page, "--contract", contract, "--root", join(temporary, "missing"), "--json")).code).toBe(2);
    const absent = join(temporary, "absent-selection"); await fs.mkdir(absent);
    const missing = await invoke("dogfood-consumer", page, "--contract", contract, "--root", absent, "--json");
    expect(missing.code).toBe(1);
    expect(JSON.parse(missing.out).findings.some((row: { evidence: string }) => row.evidence.includes("Selected token library input unavailable"))).toBe(true);
  });
  it("dogfood-consumer forwards composite selected values without caller evidence", async () => {
    const { source, adoptedAt, ...values } = fixture;
    const composite = { source, adoptedAt, values, components: { fills: [], files: [] } };
    const { loadComponentRegistry } = await import("../catalog-core/component-registry.js");
    const compositeCatalog = { values: catalog, components: { slots: loadComponentRegistry().slots, fills: [] } };
    for (const [name, content] of libraryFiles(compositeCatalog, composite, ["tailwind-theme"])) {
      await fs.mkdir(dirname(join(root, name)), { recursive: true }); await fs.writeFile(join(root, name), content);
    }
    const page = join(temporary, "Page.tsx"), contract = join(temporary, "contract.json");
    await fs.writeFile(page, 'import { PageHeaderModule } from "@clossys/designer/shell"; import "./library/theme.css"; const Page=()=> <PageHeaderModule id="example" header={data}/>');
    await fs.writeFile(contract, JSON.stringify({ version: 1, pages: ["Page.tsx"], sources: {} }));
    const result = await run("dogfood-consumer", page, "--contract", contract, "--json");
    expect(result).toMatchObject({ code: 0, error: "" });
    expect(JSON.parse(result.out).findings).toEqual([]);
  });
  it("reports the consumer fills and exact base hash as JSON", async () => {
    const result = await run("status", "--json");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toEqual({ consumer: "example", baseHash: libraryHash(fixture), complete: true, slots: fixture.fills.map(fill => fill.$extensions["com.clossys.fill"].slot).sort() });
  });

  it("checks the full library and each supported layer", async () => {
    for (const layer of [undefined, "tokens", "assets", "components"]) {
      const result = await run("check", "--json", ...(layer ? ["--layer", layer] : []));
      expect(result.code).toBe(0); expect(JSON.parse(result.out).ok).toBe(true);
    }
  });

  it("fails a check with an engine error in both JSON and compiled-bin invocations", async () => {
    const damaged = { ...fixture, fills: fixture.fills.filter(fill => fill.$extensions["com.clossys.fill"].slot !== "tokens.blur") };
    await fs.unlink(join(root, "fills/tokens.blur.json"));
    await fs.writeFile(join(root, "selection.json"), stableStringify(generateSelection(damaged)));
    const result = await run("check", "--layer", "tokens", "--json");
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out)).toMatchObject({ ok: false, findings: expect.arrayContaining([expect.objectContaining({ severity: "error", subject: expect.stringContaining("tokens.blur") })]) });
    const compiled = spawnSync(process.execPath, [bin, "check", "--root", root], { encoding: "utf8" });
    expect(compiled.status).toBe(1); expect(compiled.stdout).toContain("Library check failed");
  });

  it("reports emission drift, repairs it and supports explicit engine targets", async () => {
    expect((await run("emit", "--check")).code).toBe(0);
    await fs.writeFile(join(root, "brand.css"), "drift\n");
    expect(await run("emit", "--check")).toMatchObject({ code: 1, out: expect.stringContaining("brand.css") });
    expect(await fs.readFile(join(root, "brand.css"), "utf8")).toBe("drift\n");
    expect((await run("emit", "--target", "css-brand", "--target", "notices")).code).toBe(0);
    expect((await run("emit", "--check")).code).toBe(0);
    expect((await run("emit", "--target", "web-icons")).code).toBe(2);
  });

  it("applies a supplied changeset only through the explicit apply command", async () => {
    const file = join(temporary, "changeset.json");
    await fs.writeFile(file, JSON.stringify({ baseHash: libraryHash(fixture), changes: [{ op: "author", slot: "tokens.blur", tokens: { glass: { $type: "dimension", $value: { value: 18, unit: "px" } } } }] }));
    expect((await run("status")).code).toBe(0);
    expect((await run("recommend")).code).toBe(2);
    expect(JSON.parse((await run("status", "--json")).out).baseHash).toBe(libraryHash(fixture));
    expect(await run("apply", "--changeset", file, "--json")).toMatchObject({ code: 0 });
    expect(JSON.parse((await run("status", "--json")).out).baseHash).not.toBe(libraryHash(fixture));
    expect(await run("apply", "--changeset", file)).toMatchObject({ code: 1, error: expect.stringContaining("baseHash") });
  });

  it("returns unavailable 2 for unimplemented layers and recommendations", async () => {
    for (const layer of ["sections", "frames"]) expect(await run("check", "--layer", layer)).toMatchObject({ code: 2, error: expect.stringContaining("unavailable") });
    expect(await run("recommend")).toMatchObject({ code: 2, error: expect.stringContaining("unavailable") });
  });

  it("fails invalid input as 2 without changing the library", async () => {
    for (const args of [["apply"], ["check", "--layer", "nope"], ["emit", "--json"], ["status", "--check"], ["status", "--root", root], ["check", "--target", "css-brand"], ["check", "--layer"], ["unknown"], ["check", "--wat"], ["apply", "--changeset", join(temporary, "missing.json")]]) expect((await run(...args)).code).toBe(2);
    expect((await invoke("check")).code).toBe(2);
    expect((await invoke("--help")).code).toBe(0);
    const file = join(temporary, "changes.json");
    await fs.writeFile(file, "{"); expect((await run("apply", "--changeset", file)).code).toBe(2);
    await fs.writeFile(file, JSON.stringify({ baseHash: libraryHash(fixture), changes: [{ op: "remove", slot: "../../outside" }] })); expect((await run("apply", "--changeset", file)).code).toBe(2);
    expect(JSON.parse((await run("status", "--json")).out).baseHash).toBe(libraryHash(fixture));
  });

  it("enforces the installed exit-code contract and server exports", async () => {
    const help = spawnSync(process.execPath, [bin, "--help"], { encoding: "utf8" }); expect(help.status).toBe(0); expect(help.stdout).toContain("Exit codes");
    const missing = spawnSync(process.execPath, [bin, "status"], { encoding: "utf8" }); expect(missing.status).toBe(2);
    const status = spawnSync(process.execPath, [bin, "status", "--root", root, "--json"], { encoding: "utf8" }); expect(status.status).toBe(0); expect(JSON.parse(status.stdout).baseHash).toBe(libraryHash(fixture));
    const server = await import("../catalog-core/server.js");
    expect(server.readLibrary).toBeTypeOf("function"); expect(server.writeLibrary).toBeTypeOf("function"); expect(server.libraryFiles).toBeTypeOf("function");
  });
});


it("reads composite component slots in status and exposes component engine failures", async () => {
  const { syntheticSource } = await import("../catalog-core/__fixtures__/component-engine/synthetic.js");
  const { loadComponentRegistry } = await import("../catalog-core/component-registry.js");
  const source = syntheticSource();
  const composite = { source: fixture.source, values: { fills: fixture.fills, complete: fixture.complete }, components: { fills: [{ ...source.doc, $extensions: { "com.clossys.fill": { ...source.doc.$extensions["com.clossys.fill"], source: fixture.source.id } }, components: { button: { ...source.candidate, source: fixture.source.id, origin: { kind: "authored" as const, license: "MIT" } } } }], files: [source.file, source.notice] } };
  const compositeCatalog = { values: catalog, components: { slots: loadComponentRegistry().slots, fills: [] } };
  for (const [name, content] of libraryFiles(compositeCatalog, composite, [])) {
    await fs.mkdir(dirname(join(root, name)), { recursive: true }); await fs.writeFile(join(root, name), content);
  }
  const status = await run("status", "--json");
  expect(status.code).toBe(0); expect(JSON.parse(status.out).slots).toContain("components.button");
  const result = await run("check", "--layer", "components", "--json");
  expect(result.code).toBe(1); expect(JSON.parse(result.out).findings.some((row: { subject: string }) => row.subject === "components.button")).toBe(true);
});
it("supports explicitly empty surface layers/targets and keeps cross-layer errors visible",async()=>{
 const composite={source:fixture.source,values:{fills:fixture.fills,complete:fixture.complete},components:{fills:[],files:[]},surfaces:{version:1 as const,fills:[],files:[]}};
 const {loadComponentRegistry}=await import("../catalog-core/component-registry.js");const {loadSectionRegistry}=await import("../catalog-core/sections-contract.js");const compositeCatalog={values:catalog,components:{slots:loadComponentRegistry().slots,fills:[]},surfaces:{slots:loadSectionRegistry().slots,fills:[],transforms:[],rules:[],materializations:[]}};
 for(const [name,content] of libraryFiles(compositeCatalog,composite,[])){await fs.mkdir(dirname(join(root,name)),{recursive:true});await fs.writeFile(join(root,name),content);}
 expect((await run("status","--json")).code).toBe(0);for(const layer of ["sections","frames"])expect((await run("check","--layer",layer,"--json")).code).toBe(0);
 expect((await run("emit","--target","surface-index","--target","surfaces-consumption")).code).toBe(0);
 await fs.unlink(join(root,"fills/tokens.blur.json"));await fs.writeFile(join(root,"selection.json"),stableStringify(generateSelection({...fixture,fills:fixture.fills.filter(fill=>fill.$extensions["com.clossys.fill"].slot!=="tokens.blur")})));for(const layer of ["sections","frames"])expect((await run("check","--layer",layer,"--json")).code).toBe(1);
 const file=join(temporary,"too-many.json");const {libraryHash:wholeHash}=await import("../catalog-core/api.js");await fs.writeFile(file,JSON.stringify({baseHash:wholeHash(composite),changes:Array.from({length:257},()=>({portion:"surfaces",change:{op:"remove",slot:"sections.access-matrix"}}))}));expect((await run("apply","--changeset",file)).code).toBe(2);
});
