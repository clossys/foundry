// @vitest-environment node
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCatalog, libraryHash } from "../catalog-core/index.js";
import { completedCatalogLibrary } from "../catalog-core/__fixtures__/completed-catalog-library.js";
import { readNeeds, writeNeeds, setNeed, libraryFiles, writeLibrary, LibraryInputError } from "./fs-library.js";
import { main, dogfoodSources } from "./cli.js";
import type { DogfoodFinding } from "../catalog-core/dogfood.js";
let temporary: string, root: string;
const catalog = loadCatalog(), fixture = completedCatalogLibrary(catalog, { id: "example", kind: "consumer", author: "consumer", license: "UNLICENSED" }, "2026-10-24");
const gap = (line: number): DogfoodFinding => ({ code: "DF5", file: "src/Page.tsx", line, tag: "Widget", elementId: `src/Page.tsx#Widget@${line}`, raisedBy: "src/Page.tsx#Page", slotId: null, evidence: "Unknown visual Widget", missing: "Widget capability" });
beforeEach(async () => {
  temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "designer-needs-"))); root = join(temporary, "library");
  await fs.mkdir(join(root, "fills"), { recursive: true });
  for (const [name, content] of libraryFiles(catalog, fixture)) { await fs.mkdir(dirname(join(root, name)), { recursive: true }); await fs.writeFile(join(root, name), content); }
});
afterEach(async () => { await fs.rm(temporary, { recursive: true, force: true }); });
async function cli(...args: string[]) { const output: string[] = [], errors: string[] = []; const code = await main([...args, "--root", root], { out: text => output.push(text), error: text => errors.push(text) }); return { code, output: output.join("\n"), errors: errors.join("\n") }; }
describe("consumer NEED records", () => {
  it("does not create needs on reads and deduplicates evidence by parent plus missing capability", async () => {
    expect(await readNeeds(root)).toEqual([]); expect((await fs.readdir(root)).includes("needs")).toBe(false);
    const first = await writeNeeds(root, [gap(1), gap(2)], "2026-10-24T00:00:00Z");
    expect(first.map(row => row.id)).toEqual(["NEED-001"]); expect(first[0]?.evidence).toHaveLength(2);
    expect(await writeNeeds(root, [gap(1), gap(2)], "2026-10-25T00:00:00Z")).toEqual(first);
    expect((await readNeeds(root))[0]?.updatedAt).toBe("2026-10-24T00:00:00Z");
    await writeLibrary(root, catalog, { baseHash: libraryHash(fixture), changes: [] }); expect(await readNeeds(root)).toEqual(first);
  });
  it("never overwrites an existing record, uses next free id and supports validated forward status changes", async () => {
    const [original] = await writeNeeds(root, [gap(1)]);
    const next = await writeNeeds(root, [{ ...gap(2), missing: "Another capability" }]); expect(next.map(row => row.id)).toEqual(["NEED-001", "NEED-002"]);
    expect(next[0]).toEqual(original);
    const candidate = { library: "shadcn@aria", slotId: "components.widget", reason: "React Aria candidate" };
    expect((await setNeed(root, "NEED-001", { status: "proposed", candidate })).status).toBe("proposed");
    await expect(setNeed(root, "NEED-001", { status: "open" })).rejects.toThrow();
    await expect(setNeed(root, "NEED-001", { status: "proposed", id: "NEED-999" } as never)).rejects.toThrow();
    await expect(setNeed(root, "../escape", { status: "proposed" })).rejects.toThrow();
    await expect(setNeed(root, "NEED-002", { status: "closed" })).rejects.toThrow();
  });
  it("refuses malformed IDs, malformed JSON and symlinked paths before any write", async () => {
    await fs.mkdir(join(root, "needs")); await fs.writeFile(join(root, "needs/NEED-001.json"), "{}");
    await expect(writeNeeds(root, [gap(1)])).rejects.toBeInstanceOf(LibraryInputError);
    await fs.unlink(join(root, "needs/NEED-001.json")); await fs.writeFile(join(root, "needs/wrong.json"), "{}");
    await expect(readNeeds(root)).rejects.toThrow(); await fs.unlink(join(root, "needs/wrong.json"));
    await fs.rmdir(join(root, "needs")); await fs.mkdir(join(temporary, "outside")); await fs.symlink(join(temporary, "outside"), join(root, "needs"));
    await expect(writeNeeds(root, [gap(1)])).rejects.toThrow(); expect(await fs.readdir(join(temporary, "outside"))).toEqual([]);
  });
  it("walks real import/re-export edges, excluding lookalikes in strings and comments", async () => {
    const page = join(temporary, "Page.tsx"), fake = join(temporary, "Fake.tsx"), real = join(temporary, "Real.tsx"), barrel = join(temporary, "index.ts");
    await fs.writeFile(fake, "const Fake=()=> <button/>"); await fs.writeFile(real, "const Real=()=> <button/>");
    await fs.writeFile(barrel, 'export { Real } from "./Real.js";');
    await fs.writeFile(page, 'const decoy=\'import Fake from "./Fake.js"\'; /* import Fake from "./Fake.js"; */ import { Real } from "./index.js"; const Page=()=> <Real/>');
    const files = (await dogfoodSources([page], temporary)).files.map(row => row.file).sort();
    expect(files).toEqual(["Page.tsx", "Real.tsx", "index.ts"]);
  });
  it("shares the transaction lock and refuses retained transaction evidence", async () => {
    const lock = join(temporary, ".library-lock"); await fs.mkdir(lock);
    await expect(readNeeds(root)).rejects.toMatchObject({ code: "EEXIST" });
    await fs.rmdir(lock); await fs.mkdir(join(temporary, ".library-staging"));
    await expect(readNeeds(root)).rejects.toThrow("Unfinished library transaction");
    expect(await fs.readdir(join(temporary, ".library-staging"))).toEqual([]);
  });
  it("CLI defaults to zero writes, supports JSON needs listing and explicit dogfood write flag", async () => {
    const source = join(temporary, "Page.tsx"); await fs.writeFile(source, 'import Widget from "unknown-ui"; export const Page=()=> <Widget/>');
    expect((await cli("dogfood", source, "--json")).code).toBe(1); expect(await readNeeds(root)).toEqual([]);
    expect((await cli("dogfood", source, "--write-needs")).code).toBe(1); const records = await readNeeds(root); expect(records).toHaveLength(1);
    expect((await cli("dogfood", source, "--write-needs")).code).toBe(1); expect(await readNeeds(root)).toEqual(records);
    expect(JSON.parse((await cli("needs", "--status", "open,proposed", "--json")).output).needs).toHaveLength(1);
    const candidate = JSON.stringify({ library: "starter", slotId: "components.widget", reason: "candidate" });
    expect((await cli("needs", "set", "NEED-001", "--status", "proposed", "--candidate", candidate)).code).toBe(0);
    expect((await cli("status", "--write-needs")).code).toBe(2);
  });
});
