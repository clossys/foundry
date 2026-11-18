// @vitest-environment node
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCatalog } from "../catalog-core/index.js";
import { completedCatalogLibrary } from "../catalog-core/__fixtures__/completed-catalog-library.js";
import { needWhy } from "../catalog-core/dogfood.js";
import { libraryFiles } from "./fs-library.js";
import { main, dogfoodSources } from "./cli.js";
import { queueConsumerOf, readQueueRequests } from "./queue-requests.js";
// foundry-build-0048 U8 (Q1): a missing capability is a request in Producer's queue (clossys.queue-entry/2), never a
// NEED file of the Designer's own; dogfood only reads the open entries about Designer slots and writes nothing.
let temporary: string, consumer: string, root: string;
const catalog = loadCatalog(), fixture = completedCatalogLibrary(catalog, { id: "example", kind: "consumer", author: "consumer", license: "UNLICENSED" }, "2026-10-24");
const entry = (id: string, kind: "slot" | "change" | "fix", fields: Record<string, unknown> = {}) => ({ schema: "clossys.queue-entry/2", id, kind, from: "designer/sections.hero", assignee: "designer", target: "designer/components.widget", status: "open", why: needWhy("src/Page.tsx#Page", "Widget capability"), source: "cli", ...fields });
async function file(kind: string, doc: { id: string }) { const dir = join(consumer, "agents/producer", `queue.${kind}`, "entries"); await fs.mkdir(dir, { recursive: true }); await fs.writeFile(join(dir, `${doc.id}.json`), JSON.stringify(doc)); }
async function tree(dir: string): Promise<string[]> { const out: string[] = []; for (const each of await fs.readdir(dir, { withFileTypes: true })) { const path = join(dir, each.name); if (each.isDirectory()) out.push(...(await tree(path)).map(row => `${each.name}/${row}`)); else out.push(`${each.name}:${(await fs.readFile(path)).toString("base64")}`); } return out.sort(); }
beforeEach(async () => {
  temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "designer-requests-"))); consumer = join(temporary, "clossys"); root = join(consumer, "agents/designer/library");
  await fs.mkdir(join(consumer, "agents/producer"), { recursive: true }); await fs.mkdir(join(root, "fills"), { recursive: true });
  for (const [name, content] of libraryFiles(catalog, fixture)) { await fs.mkdir(dirname(join(root, name)), { recursive: true }); await fs.writeFile(join(root, name), content); }
});
afterEach(async () => { await fs.rm(temporary, { recursive: true, force: true }); });
async function cli(...args: string[]) { const output: string[] = [], errors: string[] = []; const code = await main([...args, "--root", root], { out: text => output.push(text), error: text => errors.push(text) }); return { code, output: output.join("\n"), errors: errors.join("\n") }; }
describe("Designer requests live in Producer's queue", () => {
  it("finds the consumer above the library and reads only open queue-entry/2 entries about Designer slots", async () => {
    expect(await queueConsumerOf(root)).toBe(consumer);
    expect(await readQueueRequests(consumer)).toEqual([]);
    await file("slot", entry("2026-11-17-slot-widget", "slot"));
    await file("change", entry("2026-11-17-change-widget", "change", { why: "repin" }));
    await file("fix", entry("2026-11-17-fix-closed", "fix", { status: "closed" }));
    await file("fix", entry("2026-11-17-fix-writer", "fix", { target: "writer/copy.hero" }));
    await file("fix", { ...entry("2026-11-17-fix-legacy", "fix"), schema: "clossys.queue-entry/1" });
    await file("slot", entry("2026-11-17-slot-wrong-kind", "change"));
    const dir = join(consumer, "agents/producer/queue.slot/entries"); await fs.writeFile(join(dir, "broken.json"), "{");
    expect(await readQueueRequests(consumer)).toEqual([{ id: "2026-11-17-change-widget", why: "repin" }, { id: "2026-11-17-slot-widget", why: needWhy("src/Page.tsx#Page", "Widget capability") }]);
  });
  it("dogfood links a finding to its open queue entry, prints the request command for one with none, and writes nothing", async () => {
    const source = join(temporary, "Page.tsx"); await fs.writeFile(source, 'import Widget from "unknown-ui"; export const Page=()=> <Widget/>');
    const before = await tree(temporary);
    const probe = await cli("dogfood", source, "--json");
    expect(probe.code).toBe(1);
    const gap = (JSON.parse(probe.output) as { findings: { raisedBy: string; missing?: string; needId?: string }[] }).findings.find(row => row.missing)!;
    expect(gap.needId).toBeUndefined();
    const why = needWhy(gap.raisedBy, gap.missing!);
    const unfiled = await cli("dogfood", source);
    expect(unfiled.code).toBe(1);
    expect(unfiled.output).toContain(`no open request; file one: clossys request --target designer/<slot> --from <requester slot> --why "${why}"`);
    expect(unfiled.output).toContain("0 open requests");
    expect(await tree(temporary)).toEqual(before);
    await file("slot", entry("2026-11-17-slot-widget", "slot", { why }));
    await file("change", entry("2026-11-17-change-other", "change", { why: "something else" }));
    const filed = await tree(temporary);
    const json = await cli("dogfood", source, "--json");
    expect(json.code).toBe(1);
    const report = JSON.parse(json.output) as { needs: string[]; findings: { needId?: string; missing?: string }[] };
    expect(report.needs).toEqual(["2026-11-17-slot-widget"]);
    expect(report.findings.filter(row => row.missing).every(row => row.needId === "2026-11-17-slot-widget")).toBe(true);
    expect((await cli("dogfood", source)).output).toContain("(request 2026-11-17-slot-widget)");
    expect((await cli("dogfood", source, "--consumer", join(temporary, "elsewhere"))).output).toContain("0 open requests");
    expect(await tree(temporary)).toEqual(filed);
    await expect(fs.stat(join(root, "needs"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("retires the needs command and the NEED write flags", async () => {
    const source = join(temporary, "Page.tsx"); await fs.writeFile(source, "export const Page=()=> null");
    expect((await cli("needs")).code).toBe(2);
    expect((await cli("dogfood", source, "--write-needs")).code).toBe(2);
    expect((await cli("status", "--consumer", consumer)).code).toBe(2);
  });
  it("dogfood still refuses a missing root and shares the library transaction lock", async () => {
    const source = join(temporary, "Page.tsx"); await fs.writeFile(source, "export const Page=()=> null");
    expect((await main(["dogfood", source, "--root", join(temporary, "missing")], { out: () => undefined, error: () => undefined }))).toBe(2);
    const lock = join(dirname(root), ".library-lock"); await fs.mkdir(lock);
    expect((await cli("dogfood", source)).code).toBe(2);
    await fs.rmdir(lock); await fs.mkdir(join(dirname(root), ".library-staging"));
    const staged = await cli("dogfood", source);
    expect(staged.code).toBe(2); expect(await fs.readdir(join(dirname(root), ".library-staging"))).toEqual([]);
  });
  it("walks real import/re-export edges, excluding lookalikes in strings and comments", async () => {
    const page = join(temporary, "Page.tsx"), fake = join(temporary, "Fake.tsx"), real = join(temporary, "Real.tsx"), barrel = join(temporary, "index.ts");
    await fs.writeFile(fake, "const Fake=()=> <button/>"); await fs.writeFile(real, "const Real=()=> <button/>");
    await fs.writeFile(barrel, 'export { Real } from "./Real.js";');
    await fs.writeFile(page, 'const decoy=\'import Fake from "./Fake.js"\'; /* import Fake from "./Fake.js"; */ import { Real } from "./index.js"; const Page=()=> <Real/>');
    const files = (await dogfoodSources([page], temporary)).files.map(row => row.file).sort();
    expect(files).toEqual(["Page.tsx", "Real.tsx", "index.ts"]);
  });
});
