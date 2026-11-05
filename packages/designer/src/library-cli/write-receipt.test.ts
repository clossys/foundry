// @vitest-environment node
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { libraryHash, loadCatalog, stableStringify, type ChangeSet } from "../catalog-core/index.js";
import { completedCatalogLibrary } from "../catalog-core/__fixtures__/completed-catalog-library.js";
import type { DogfoodFinding } from "../catalog-core/dogfood.js";
import { checkLibraryReceipt, emitLibrary, libraryFiles, readLibrary, setNeed, writeLibrary, writeNeeds } from "./fs-library.js";
import { DESIGNER_RECEIPT_FILE, type DesignerReceipt } from "./write-receipt.js";
import { main } from "./cli.js";

/**
 * DESIGNER-GATE: every designer write stamps the library receipt with its command, its inputs and a
 * content hash; the check fails when library files differ from what the last designer write recorded.
 */
const catalog = loadCatalog();
const fixture = completedCatalogLibrary(catalog, { id: "example", kind: "consumer", author: "consumer", license: "UNLICENSED" }, "2026-10-27");
let temporary: string, root: string;
beforeEach(async () => {
  temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "designer-receipt-"))); root = join(temporary, "library");
  await fs.mkdir(join(root, "fills"), { recursive: true });
  for (const [name, content] of libraryFiles(catalog, fixture)) { await fs.mkdir(dirname(join(root, name)), { recursive: true }); await fs.writeFile(join(root, name), content); }
});
afterEach(async () => { await fs.rm(temporary, { recursive: true, force: true }); });

const author = (base: string, px = 18): ChangeSet => ({ baseHash: base, changes: [{ op: "author", slot: "themes.radius", tokens: { default: { $type: "dimension", $value: { value: px, unit: "px" } } } }] });
const receipt = async (): Promise<DesignerReceipt> => JSON.parse(await fs.readFile(join(root, DESIGNER_RECEIPT_FILE), "utf8"));
const gap = (line: number): DogfoodFinding => ({ code: "DF5", file: "src/Page.tsx", line, tag: "Widget", elementId: `src/Page.tsx#Widget@${line}`, raisedBy: "src/Page.tsx#Page", slotId: null, evidence: "Unknown visual Widget", missing: "Widget capability" });
async function cli(...args: string[]) {
  const out: string[] = [], error: string[] = [];
  const code = await main([...args, "--root", root], { out: text => out.push(text), error: text => error.push(text) });
  return { code, out: out.join("\n"), error: error.join("\n") };
}
const fillPath = (slot: string) => join(root, "fills", `${slot}.json`);

describe("designer write receipt: stamping at the source", () => {
  it("records the command, its inputs and the content hash of the written library", async () => {
    const changes = author(libraryHash(fixture));
    await writeLibrary(root, catalog, changes);
    const stamped = await receipt();
    expect(stamped.version).toBe(1);
    expect(stamped.writes).toHaveLength(1);
    const [entry] = stamped.writes;
    expect(entry).toMatchObject({ command: "writeLibrary", unreceipted: [] });
    expect(entry!.inputs).toMatchObject({ baseHash: changes.baseHash, changes: [{ op: "author", slot: "themes.radius" }] });
    expect(entry!.inputs.changeset).toMatch(/^sha256:[a-f0-9]{64}$/);
    const verdict = await checkLibraryReceipt(root);
    expect(verdict).toMatchObject({ ok: true, findings: [] });
    expect(entry!.contentHash).toBe(verdict.contentHash);
    expect(Object.keys(stamped.files)).toContain("fills/themes.radius.json");
    expect(Object.keys(stamped.files)).not.toContain(DESIGNER_RECEIPT_FILE);
  });

  it("names the CLI command that made the write", async () => {
    const changeset = join(temporary, "changes.json");
    await fs.writeFile(changeset, JSON.stringify(author(libraryHash(fixture))));
    expect(await cli("apply", "--changeset", changeset)).toMatchObject({ code: 0 });
    expect((await receipt()).writes.map(row => row.command)).toEqual(["designer-library apply"]);
    expect(await cli("emit")).toMatchObject({ code: 0 });
    // An emit that leaves every byte as receipted adds no entry; the receipt does not grow on no-ops.
    expect((await receipt()).writes.map(row => row.command)).toEqual(["designer-library apply"]);
  });

  it("stamps emit, NEED writes and the usage graph with their commands", async () => {
    await emitLibrary(root, catalog);
    expect((await receipt()).writes.map(row => row.command)).toEqual(["emitLibrary"]);
    await writeNeeds(root, [gap(1)], "2026-10-27T00:00:00Z");
    await setNeed(root, "NEED-001", { status: "proposed", candidate: { library: "shadcn@aria", slotId: "components.widget", reason: "React Aria candidate" } }, "2026-10-27T00:00:00Z");
    const stamped = await receipt();
    expect(stamped.writes.map(row => row.command)).toEqual(["emitLibrary", "writeNeeds", "setNeed"]);
    expect(stamped.writes[2]!.inputs).toMatchObject({ id: "NEED-001", status: "proposed" });
    expect(await cli("graph", "--write")).toMatchObject({ code: 0 });
    expect((await receipt()).writes.at(-1)!.command).toBe("designer-library graph --write");
    expect(await checkLibraryReceipt(root)).toMatchObject({ ok: true });
  });

  it("keeps the receipt canonical and outside the library content hash", async () => {
    await writeLibrary(root, catalog, author(libraryHash(fixture)));
    const text = await fs.readFile(join(root, DESIGNER_RECEIPT_FILE), "utf8");
    expect(text).toBe(stableStringify(JSON.parse(text)));
  });
});

describe("designer write receipt: the check", () => {
  it("fails a library that no designer write has stamped", async () => {
    const verdict = await checkLibraryReceipt(root);
    expect(verdict.ok).toBe(false);
    expect(verdict.findings.map(row => row.code)).toEqual(["DR1"]);
  });

  it("fails a hand-edited fill and passes again once the edit is reverted (mutation proof)", async () => {
    await writeLibrary(root, catalog, author(libraryHash(fixture)));
    const original = await fs.readFile(fillPath("themes.radius"), "utf8");
    await fs.writeFile(fillPath("themes.radius"), original.replace("\"value\": 18", "\"value\": 24"));
    const verdict = await checkLibraryReceipt(root);
    expect(verdict.ok).toBe(false);
    expect(verdict.findings).toEqual([expect.objectContaining({ code: "DR3", path: "fills/themes.radius.json" })]);
    await fs.writeFile(fillPath("themes.radius"), original);
    expect(await checkLibraryReceipt(root)).toMatchObject({ ok: true, findings: [] });
  });

  it("fails added and removed library files", async () => {
    await writeLibrary(root, catalog, author(libraryHash(fixture)));
    await fs.writeFile(join(root, "extra.css"), ":root{}\n");
    await fs.rm(join(root, "brand.css"));
    const verdict = await checkLibraryReceipt(root);
    expect(verdict.findings.filter(row => row.code === "DR3").map(row => row.path).sort()).toEqual(["brand.css", "extra.css"]);
  });

  it("does not let a later designer write launder an earlier hand edit", async () => {
    await writeLibrary(root, catalog, author(libraryHash(fixture)));
    const original = await fs.readFile(fillPath("themes.radius"), "utf8");
    await fs.writeFile(fillPath("themes.radius"), original.replace("\"value\": 18", "\"value\": 24"));
    await emitLibrary(root, catalog);
    const stamped = await receipt();
    expect(stamped.writes.at(-1)).toMatchObject({ command: "emitLibrary", unreceipted: ["fills/themes.radius.json"] });
    const verdict = await checkLibraryReceipt(root);
    expect(verdict.ok).toBe(false);
    expect(verdict.findings).toEqual([expect.objectContaining({ code: "DR4", path: "fills/themes.radius.json" })]);
  });

  it("accepts a regeneration that restores hand-edited generated output to its receipted bytes", async () => {
    await writeLibrary(root, catalog, author(libraryHash(fixture)));
    await fs.writeFile(join(root, "brand.css"), "drift\n");
    expect((await checkLibraryReceipt(root)).findings.map(row => row.code)).toEqual(["DR3"]);
    await emitLibrary(root, catalog);
    expect(await checkLibraryReceipt(root)).toMatchObject({ ok: true, findings: [] });
  });

  it("ignores agent input records and records them only as command inputs", async () => {
    await writeLibrary(root, catalog, author(libraryHash(fixture)));
    await fs.writeFile(join(root, "decisions.json"), "[]\n");
    await fs.writeFile(join(root, "component-observations.json"), JSON.stringify({ packageExports: {} }));
    expect(await checkLibraryReceipt(root)).toMatchObject({ ok: true });
  });

  it("fails a forged or malformed receipt", async () => {
    await writeLibrary(root, catalog, author(libraryHash(fixture)));
    const stamped = await receipt();
    await fs.writeFile(join(root, DESIGNER_RECEIPT_FILE), stableStringify({ ...stamped, files: { ...stamped.files, "fills/themes.radius.json": "sha256:" + "0".repeat(64) } }));
    expect((await checkLibraryReceipt(root)).findings.map(row => row.code)).toContain("DR2");
    await fs.writeFile(join(root, DESIGNER_RECEIPT_FILE), "{");
    expect((await checkLibraryReceipt(root)).findings.map(row => row.code)).toEqual(["DR2"]);
  });

  it("fails when the receipt history is not an append-only extension of a base receipt", async () => {
    await writeLibrary(root, catalog, author(libraryHash(fixture)));
    const base = await receipt();
    await writeLibrary(root, catalog, author(libraryHash(await readLibrary(root, catalog)), 20));
    expect(await checkLibraryReceipt(root, { base })).toMatchObject({ ok: true });
    // Deleting the receipt and re-stamping restarts history: the base comparison catches the truncation.
    await fs.rm(join(root, DESIGNER_RECEIPT_FILE));
    await emitLibrary(root, catalog);
    const verdict = await checkLibraryReceipt(root, { base });
    expect(verdict.ok).toBe(false);
    expect(verdict.findings.map(row => row.code)).toEqual(["DR5"]);
  });

  it("is a CLI command with check exit codes", async () => {
    expect(await cli("receipt")).toMatchObject({ code: 1 });
    await writeLibrary(root, catalog, author(libraryHash(fixture)));
    const passed = await cli("receipt", "--json");
    expect(passed.code).toBe(0);
    expect(JSON.parse(passed.out)).toMatchObject({ ok: true, findings: [] });
    const original = await fs.readFile(fillPath("themes.radius"), "utf8");
    await fs.writeFile(fillPath("themes.radius"), original.replace("\"value\": 18", "\"value\": 24"));
    const failed = await cli("receipt");
    expect(failed.code).toBe(1);
    expect(failed.out).toContain("DR3 fills/themes.radius.json");
    await fs.writeFile(fillPath("themes.radius"), original);
    const basePath = join(temporary, "base-receipt.json");
    await fs.writeFile(basePath, JSON.stringify({ version: 1, files: {}, writes: [] }));
    expect((await cli("receipt", "--base", basePath)).code).toBe(0);
    await fs.writeFile(basePath, JSON.stringify({ version: 1, files: {}, writes: [{ command: "other", inputs: {}, contentHash: "sha256:" + "1".repeat(64), unreceipted: [] }] }));
    const truncated = await cli("receipt", "--base", basePath);
    expect(truncated.code).toBe(1);
    expect(truncated.out).toContain("DR5");
  });
});
